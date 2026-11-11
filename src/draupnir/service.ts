// Draupnir en marche : rangement des automatisations, déclencheurs (planning, webhook, Saga, flux,
// pages surveillées), journal des exécutions, création à partir d'une phrase, import d'un workflow n8n.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextRun, parseCron } from '../cron/cron.ts';
import { checkFlow, execute, normalize, type Deps, type Execution, type FlowNode, type Item, type Workflow } from './engine.ts';
import { runCode } from './code.ts';
import { CATALOG, NODES, parseFeed } from './nodes.ts';

const KEEP_RUNS = 40;

export class Draupnir {
  private timers = new Map<string, Array<ReturnType<typeof setTimeout>>>();
  private hits = new Map<string, number[]>();
  private running = new Set<string>();
  readonly dir: string;
  private deps: Deps;
  private hooks: { onRun?(ex: Execution): void };
  constructor(home: string, deps: Deps, hooks: { onRun?(ex: Execution): void } = {}) {
    this.hooks = hooks;
    // Sous-automatisations et code isolé : branchés ici pour que chaque nœud y ait accès.
    this.deps = { code: runCode, ...deps, runFlow: (idOrName, items, depth) => this.call(idOrName, items, depth) };
    this.dir = join(home, 'draupnir');
    for (const d of ['flows', 'runs', 'state', 'corbeille', 'versions']) mkdirSync(join(this.dir, d), { recursive: true });
  }

  // ---------------- Rangement
  private file = (id: string) => join(this.dir, 'flows', `${id.replace(/[^\w-]/g, '')}.json`);
  list(): Workflow[] {
    return readdirSync(join(this.dir, 'flows')).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(this.dir, 'flows', f), 'utf8')) as Workflow; } catch { return undefined; } }).filter((w): w is Workflow => Boolean(w)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
  get(id: string): Workflow | undefined { const f = this.file(id); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as Workflow : this.list().find((w) => w.name.toLowerCase() === id.toLowerCase()); }
  save(input: Partial<Workflow>): Workflow {
    const old = input.id ? this.get(input.id) : undefined;
    const wf = normalize({ ...input, createdAt: old?.createdAt ?? input.createdAt });
    // Webhook : chaque déclencheur reçoit un chemin secret (l'adresse ne se devine pas).
    for (const n of wf.nodes) if ((n.type === 'déclencheur.webhook' || n.type === 'déclencheur.formulaire') && !String(n.params.chemin ?? '').match(/^[\w-]{12,}$/)) n.params.chemin = randomBytes(12).toString('base64url');
    const err = checkFlow(wf, CATALOG);
    if (err) throw new Error(err);
    // Historique : la version précédente est gardée (20 dernières), restaurable.
    if (old) {
      const vd = join(this.dir, 'versions', wf.id); mkdirSync(vd, { recursive: true });
      writeFileSync(join(vd, `${Date.now()}.json`), JSON.stringify(old));
      const all = readdirSync(vd).sort(); for (const f of all.slice(0, Math.max(0, all.length - 20))) renameSync(join(vd, f), join(this.dir, 'corbeille', `v-${wf.id}-${f}`));
    }
    writeFileSync(this.file(wf.id), JSON.stringify(wf, null, 2));
    this.arm(wf);
    return wf;
  }
  /** Corbeille (récupérable), jamais d'effacement direct. */
  trash(id: string): void { const w = this.get(id); if (!w) throw new Error('automatisation introuvable'); this.disarm(w.id); renameSync(this.file(w.id), join(this.dir, 'corbeille', `${w.id}-${Date.now()}.json`)); }
  versions(id: string): Array<{ at: number; name: string; nodes: number }> {
    const vd = join(this.dir, 'versions', id); if (!existsSync(vd)) return [];
    return readdirSync(vd).sort().reverse().map((f) => { const w = JSON.parse(readFileSync(join(vd, f), 'utf8')) as Workflow; return { at: Number(f.replace('.json', '')), name: w.name, nodes: w.nodes.length }; });
  }
  restore(id: string, at: number): Workflow { const f = join(this.dir, 'versions', id, `${at}.json`); if (!existsSync(f)) throw new Error('version introuvable'); return this.save({ ...JSON.parse(readFileSync(f, 'utf8')) as Workflow, id }); }
  setActive(id: string, on: boolean): Workflow { const w = this.get(id); if (!w) throw new Error('automatisation introuvable'); return this.save({ ...w, active: on }); }
  runs(id?: string, n = 20): Execution[] {
    const files = id ? [`${id}.json`] : readdirSync(join(this.dir, 'runs'));
    return files.flatMap((f) => { try { return JSON.parse(readFileSync(join(this.dir, 'runs', f), 'utf8')) as Execution[]; } catch { return []; } }).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, n);
  }
  private record(ex: Execution): void {
    const f = join(this.dir, 'runs', `${ex.workflowId}.json`);
    let all: Execution[] = []; try { all = JSON.parse(readFileSync(f, 'utf8')); } catch { /* premier */ }
    writeFileSync(f, JSON.stringify([ex, ...all].slice(0, KEEP_RUNS)));
    this.hooks.onRun?.(ex);
  }
  private state<T>(key: string, v?: T): T | undefined {
    const f = join(this.dir, 'state', `${createHash('sha1').update(key).digest('hex').slice(0, 16)}.json`);
    if (v !== undefined) { writeFileSync(f, JSON.stringify(v)); return v; }
    try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return undefined; }
  }

  // ---------------- Exécuter
  async run(id: string, items?: Item[], mode: Execution['mode'] = 'manuel', trigger?: string, opts: { depth?: number; stopAfter?: string; pinned?: Record<string, Array<Record<string, unknown>>> } = {}): Promise<Execution> {
    const wf = this.get(id); if (!wf) throw new Error('automatisation introuvable');
    // Une même automatisation ne tourne pas deux fois en même temps (sauf test manuel).
    const key = `${wf.id}:${trigger ?? ''}`;
    if (mode === 'déclencheur' && this.running.has(key)) return { id: '', workflowId: wf.id, name: wf.name, mode, status: 'erreur', startedAt: new Date().toISOString(), ms: 0, nodes: {}, error: 'déjà en cours' };
    this.running.add(key);
    try {
      const ex = await execute(wf, CATALOG, this.deps, { node: trigger, items, mode, ...opts });
      this.record(ex);
      if (ex.status === 'erreur' && mode === 'déclencheur') {
        if (wf.settings?.notifyOnError !== false) await this.deps.notify?.(`⚠️ Draupnir — « ${wf.name} » a échoué${ex.failedNode ? ` à l'étape « ${ex.failedNode} »` : ''} : ${ex.error}`).catch(() => {});
        // Automatisations « Quand une automatisation échoue » (jamais pour elles-mêmes : pas de boucle).
        if (!wf.nodes.some((n) => n.type === 'déclencheur.erreur')) for (const w of this.list().filter((x) => x.active)) for (const n of w.nodes.filter((x) => x.type === 'déclencheur.erreur' && !x.disabled)) {
          if (n.params.surveille && String(n.params.surveille).toLowerCase() !== wf.name.toLowerCase()) continue;
          void this.fire(w.id, n.name, [{ json: { automatisation: wf.name, étape: ex.failedNode ?? '', erreur: ex.error ?? '', exécution: ex.id, date: ex.startedAt } }]);
        }
      }
      return ex;
    } finally { this.running.delete(key); }
  }

  /** Sous-automatisation : démarre par « Appelée par une automatisation » (sinon son premier déclencheur). */
  async call(idOrName: string, items: Item[], depth: number): Promise<Item[]> {
    const wf = this.get(idOrName); if (!wf) throw new Error(`automatisation introuvable : ${idOrName}`);
    const start = wf.nodes.find((n) => n.type === 'déclencheur.appel') ?? wf.nodes.find((n) => CATALOG.get(n.type)?.trigger);
    const ex = await this.run(wf.id, items, 'déclencheur', start?.name, { depth });
    if (ex.status !== 'succès') throw new Error(`« ${wf.name} » : ${ex.error}`);
    const ends = wf.nodes.filter((n) => !(wf.connections[n.name] ?? []).some((o) => o?.length) && ex.nodes[n.name]);
    return (ends.length ? ends : [wf.nodes.at(-1)!]).flatMap((n) => (ex.nodes[n.name]?.items ?? []).map((j) => ({ json: j })));
  }

  /** Formulaire public : sa définition (titre, champs) pour l'afficher. */
  form(path: string): { title: string; intro: string; thanks: string; fields: Array<{ key: string; label: string; required: boolean; kind: 'text' | 'long' | 'email' | 'choix'; choices: string[] }> } | undefined {
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.formulaire' && !x.disabled)) {
      if (String(n.params.chemin) !== path) continue;
      const fields = String(n.params.champs ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const req = /\*/.test(l), kind = /\(long\)/i.test(l) ? 'long' : /\(email\)/i.test(l) ? 'email' : /\(choix:/i.test(l) ? 'choix' : 'text';
        const choices = /\(choix:\s*([^)]*)\)/i.exec(l)?.[1].split('|').map((x) => x.trim()).filter(Boolean) ?? [];
        const label = l.replace(/\(.*?\)/g, '').replace(/\*/g, '').trim();
        return { key: label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'champ', label, required: req, kind: kind as 'text' | 'long' | 'email' | 'choix', choices };
      });
      return { title: String(n.params.titre ?? 'Formulaire'), intro: String(n.params.description ?? ''), thanks: String(n.params.merci ?? 'Merci.'), fields };
    }
    return undefined;
  }
  async submitForm(path: string, data: Record<string, unknown>): Promise<{ ok: boolean; error?: string; thanks?: string }> {
    const def = this.form(path); if (!def) return { ok: false, error: 'formulaire inconnu' };
    const clean: Record<string, string> = {};
    for (const f of def.fields) {
      const v = String(data[f.key] ?? '').trim().slice(0, f.kind === 'long' ? 10_000 : 500);
      if (f.required && !v) return { ok: false, error: `« ${f.label} » est obligatoire` };
      if (v && f.kind === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { ok: false, error: `« ${f.label} » : adresse invalide` };
      if (v && f.kind === 'choix' && !f.choices.includes(v)) return { ok: false, error: `« ${f.label} » : choix invalide` };
      clean[f.key] = v;
    }
    const now = Date.now(), h = (this.hits.get(`f:${path}`) ?? []).filter((t) => now - t < 60_000);
    if (h.length >= 20) return { ok: false, error: 'trop d\'envois, réessaie dans une minute' };
    h.push(now); this.hits.set(`f:${path}`, h);
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.formulaire' && String(x.params.chemin) === path)) void this.fire(wf.id, n.name, [{ json: { ...clean, $formulaire: def.title, $date: new Date(now).toISOString() } }]);
    return { ok: true, thanks: def.thanks };
  }

  // ---------------- Déclencheurs
  start(): void { for (const w of this.list()) this.arm(w); }
  stop(): void { for (const id of [...this.timers.keys()]) this.disarm(id); }
  private disarm(id: string): void { for (const t of this.timers.get(id) ?? []) { clearTimeout(t); clearInterval(t); } this.timers.delete(id); }
  private arm(wf: Workflow): void {
    this.disarm(wf.id);
    if (!wf.active) return;
    const ts: Array<ReturnType<typeof setTimeout>> = [];
    for (const n of wf.nodes) {
      if (n.disabled) continue;
      const p = n.params ?? {};
      if (n.type === 'déclencheur.planning') {
        if (p.mode === 'intervalle') ts.push(setInterval(() => void this.fire(wf.id, n.name, [{ json: { heure: new Date().toISOString() } }]), Math.max(1, Number(p.minutes) || 60) * 60_000));
        else {
          const expr = String(p.cron || '30 7 * * *');
          try { parseCron(expr); } catch { continue; }
          const plan = () => { const at = nextRun(expr, new Date()).getTime() - Date.now(); const t = setTimeout(() => { void this.fire(wf.id, n.name, [{ json: { heure: new Date().toISOString() } }]); plan(); }, Math.min(at, 2 ** 31 - 1)); ts.push(t); };
          plan();
        }
      } else if (n.type === 'déclencheur.flux' || n.type === 'déclencheur.surveille') {
        const every = Math.max(5, Number(p.minutes) || 30) * 60_000;
        const tick = () => void this.poll(wf.id, n.name).catch(() => {});
        ts.push(setTimeout(tick, 5_000), setInterval(tick, every));
      }
    }
    this.timers.set(wf.id, ts);
  }
  private async fire(id: string, node: string, items: Item[]): Promise<Execution | undefined> {
    const wf = this.get(id); if (!wf?.active) return undefined;
    return this.run(id, items, 'déclencheur', node);
  }
  /** Flux et pages surveillées : la première lecture sert de référence, puis seules les nouveautés déclenchent. */
  async poll(id: string, nodeName: string): Promise<number> {
    const wf = this.get(id), n = wf?.nodes.find((x) => x.name === nodeName); if (!wf || !n) return 0;
    const f = this.deps.fetch ?? fetch, url = String(n.params.url ?? '');
    if (!/^https?:\/\//.test(url)) return 0;
    const r = await f(url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Odin-Draupnir/1.0' } });
    if (!r.ok) return 0;
    const text = await r.text(), key = `${wf.id}:${n.name}:${url}`;
    if (n.type === 'déclencheur.flux') {
      const items = parseFeed(text), seen = new Set(this.state<string[]>(key) ?? []), first = !this.state<string[]>(key);
      const fresh = items.filter((x) => !seen.has(x.id));
      this.state(key, [...new Set([...items.map((x) => x.id), ...seen])].slice(0, 500));
      if (first || !fresh.length) return 0;
      await this.fire(wf.id, n.name, fresh.map((x) => ({ json: { ...x } })));
      return fresh.length;
    }
    const plain = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const want = String(n.params.contient ?? '').trim();
    const hash = createHash('sha1').update(plain).digest('hex'), prev = this.state<{ hash: string; text: string }>(key);
    this.state(key, { hash, text: plain.slice(0, 4000) });
    if (!prev || prev.hash === hash || (want && !plain.toLowerCase().includes(want.toLowerCase()))) return 0;
    await this.fire(wf.id, n.name, [{ json: { url, extrait: plain.slice(0, 1500), avant: prev.text.slice(0, 1500) } }]);
    return 1;
  }
  /** Changement dans Saga → automatisations « Quand Saga change » qui correspondent. */
  async onSaga(e: { kind: string; path: string; title?: string; type?: string }): Promise<void> {
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.saga' && !x.disabled)) {
      const p = n.params ?? {}, quand = String(p.quand ?? 'créée');
      if (e.path.startsWith('Draupnir/')) continue;
      if (quand !== 'tout' && quand !== e.kind) continue;
      if (p.dossier && !e.path.startsWith(`${String(p.dossier).replace(/\/$/, '')}/`)) continue;
      if (p.type && String(p.type) !== e.type) continue;
      await this.fire(wf.id, n.name, [{ json: { événement: e.kind, chemin: e.path, titre: e.title ?? '', type: e.type ?? '' } }]);
    }
  }
  /** Événement ou alerte d'une appli d'Odin → automatisations « Quand une appli signale ». */
  async onModule(e: { module: string; name: string; type: string; level?: string; data: Record<string, unknown> }): Promise<void> {
    const RANK: Record<string, number> = { info: 0, moyenne: 1, haute: 2, critique: 3 };
    const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.module' && !x.disabled)) {
      const p = n.params ?? {}, want = norm(String(p.module ?? ''));
      if (!want || (want !== norm(e.module) && want !== norm(e.name))) continue;
      const ev = norm(String(p.événement ?? ''));
      if (ev && ev !== norm(e.type)) continue;
      if (e.type === 'alerte' && (RANK[e.level ?? 'info'] ?? 0) < (RANK[String(p.niveau ?? 'haute')] ?? 2)) continue;
      await this.fire(wf.id, n.name, [{ json: { appli: e.name, événement: e.type, ...(e.level ? { niveau: e.level } : {}), ...e.data } }]);
    }
  }
  /** Appel d'un webhook : chemin secret, 60 appels par minute au plus. */
  async webhook(path: string, body: unknown, query: Record<string, string>, method: string): Promise<{ status: number; body: unknown }> {
    for (const wf of this.list().filter((w) => w.active)) for (const n of wf.nodes.filter((x) => x.type === 'déclencheur.webhook' && !x.disabled)) {
      if (String(n.params.chemin) !== path) continue;
      const now = Date.now(), h = (this.hits.get(path) ?? []).filter((t) => now - t < 60_000);
      if (h.length >= 60) return { status: 429, body: { error: 'trop d\'appels' } };
      h.push(now); this.hits.set(path, h);
      const items: Item[] = [{ json: { ...(body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : { corps: body }), $requête: { méthode: method, paramètres: query } } }];
      if (n.params.réponse === 'à la fin') { const ex = await this.fire(wf.id, n.name, items); if (ex?.response) return ex.response; const last = ex && Object.values(ex.nodes).at(-1); return { status: ex?.status === 'succès' ? 200 : 500, body: { ok: ex?.status === 'succès', résultat: last?.items ?? [], error: ex?.error } }; }
      void this.fire(wf.id, n.name, items);
      return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: { error: 'webhook inconnu' } };
  }
}

// ---------------------------------------------------------------- Créer à partir d'une phrase

export function catalogText(): string {
  return NODES.map((n) => `- ${n.type}${n.trigger ? ' (DÉCLENCHEUR)' : ''} — ${n.what}${n.outputs ? ` Sorties : ${typeof n.outputs === 'function' ? 'une par cas + autre' : n.outputs.join(', ')}.` : ''}\n  réglages : ${n.params.map((p) => `${p.key}${p.options ? ` (${p.options.join('|')})` : ''}`).join(', ') || 'aucun'}`).join('\n');
}
export function flowPrompt(): string {
  return `Tu écris des automatisations pour Draupnir, le moteur d'automatisations d'Odin. Réponds UNIQUEMENT par un objet JSON :
{"name":"…","nodes":[{"name":"…","type":"…","params":{…},"position":[x,y]}],"connections":{"NomSource":[[{"node":"NomCible"}],[…sortie 2…]]},"settings":{"description":"…"}}
Règles : exactement un déclencheur au début ; noms de nœuds uniques et courts en français ; positions de gauche à droite (x += 220) ; « Si » a deux sorties (oui, non) ;
les données passent d'un nœud à l'autre en éléments ; dans les réglages, {{ $json.champ }} insère un champ de l'élément courant, {{ $node["Nom"].json.champ }} celui d'un nœud précédent, {{ $today }} la date.
Pour qu'Odin résume, trie ou rédige : odin.demander ; pour prévenir le propriétaire : odin.prévenir ; pour garder dans le Cerveau : saga.écrire.
Planning : cron à 5 champs, heure locale. N'invente aucun type de nœud.
Nœuds disponibles :
${catalogText()}`;
}
export function parseFlowJson(text: string): Partial<Workflow> {
  const m = /\{[\s\S]*\}/.exec(text.replace(/```(?:json)?/g, ''));
  if (!m) throw new Error('pas de JSON dans la réponse');
  return JSON.parse(m[0]) as Partial<Workflow>;
}
export async function flowFromDescription(llm: (system: string, user: string) => Promise<string>, description: string): Promise<Partial<Workflow>> {
  let last = '';
  for (let k = 0; k < 2; k++) {
    try {
      const wf = parseFlowJson(await llm(flowPrompt(), k ? `${description}\n\nTa réponse précédente était refusée : ${last}. Corrige.` : description));
      const err = checkFlow(normalize(wf), CATALOG);
      if (!err) return { ...wf, active: false, origin: 'odin' };
      last = err;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`automatisation impossible à écrire : ${last}`);
}

// ---------------------------------------------------------------- Importer un workflow n8n

const N8N_MAP: Record<string, (p: Record<string, unknown>) => { type: string; params: Record<string, unknown> }> = {
  'n8n-nodes-base.manualTrigger': () => ({ type: 'déclencheur.manuel', params: {} }),
  'n8n-nodes-base.scheduleTrigger': (p) => { const r = ((p.rule as { interval?: Array<Record<string, unknown>> })?.interval ?? [])[0] ?? {}; return r.field === 'cronExpression' ? { type: 'déclencheur.planning', params: { mode: 'cron', cron: r.expression } } : r.field === 'minutes' || r.minutesInterval ? { type: 'déclencheur.planning', params: { mode: 'intervalle', minutes: r.minutesInterval ?? 60 } } : { type: 'déclencheur.planning', params: { mode: 'cron', cron: `${r.triggerAtMinute ?? 0} ${r.triggerAtHour ?? 8} * * *` } }; },
  'n8n-nodes-base.cron': () => ({ type: 'déclencheur.planning', params: { mode: 'cron', cron: '0 8 * * *' } }),
  'n8n-nodes-base.webhook': () => ({ type: 'déclencheur.webhook', params: {} }),
  'n8n-nodes-base.rssFeedReadTrigger': (p) => ({ type: 'déclencheur.flux', params: { url: p.feedUrl, minutes: 30 } }),
  'n8n-nodes-base.rssFeedRead': (p) => ({ type: 'web.flux', params: { url: p.url } }),
  'n8n-nodes-base.httpRequest': (p) => ({ type: 'web.requête', params: { méthode: p.method ?? 'GET', url: p.url, corps: p.jsonBody ?? p.body ?? '' } }),
  'n8n-nodes-base.if': () => ({ type: 'logique.si', params: {} }),
  'n8n-nodes-base.filter': () => ({ type: 'logique.filtre', params: {} }),
  'n8n-nodes-base.set': () => ({ type: 'données.définir', params: {} }),
  'n8n-nodes-base.splitOut': (p) => ({ type: 'données.éclater', params: { champ: p.fieldToSplitOut } }),
  'n8n-nodes-base.aggregate': () => ({ type: 'données.regrouper', params: {} }),
  'n8n-nodes-base.limit': (p) => ({ type: 'données.limiter', params: { nombre: p.maxItems ?? 5 } }),
  'n8n-nodes-base.sort': () => ({ type: 'données.trier', params: {} }),
  'n8n-nodes-base.removeDuplicates': () => ({ type: 'données.dédoublonner', params: {} }),
  'n8n-nodes-base.wait': (p) => ({ type: 'logique.attendre', params: { secondes: p.amount ?? 60 } }),
  'n8n-nodes-base.noOp': () => ({ type: 'logique.fin', params: {} }),
};
/** Convertit un workflow n8n (JSON exporté) : les nœuds connus sont traduits, les autres signalés à refaire. */
export function importN8n(src: { name?: string; nodes?: Array<{ name: string; type: string; parameters?: Record<string, unknown>; position?: [number, number] }>; connections?: Record<string, { main?: Array<Array<{ node: string }>> }> }): { flow: Partial<Workflow>; todo: string[] } {
  const todo: string[] = [];
  const nodes: FlowNode[] = (src.nodes ?? []).filter((n) => n.type !== 'n8n-nodes-base.stickyNote').map((n): FlowNode => {
    const m = N8N_MAP[n.type];
    if (!m) { todo.push(`${n.name} (${n.type.replace(/^.*\./, '')})`); return { name: n.name, type: 'logique.fin', params: {}, position: n.position, note: `À refaire : nœud ${n.type} non traduit`, disabled: true }; }
    return { name: n.name, ...m(n.parameters ?? {}), position: n.position };
  });
  const connections = Object.fromEntries(Object.entries(src.connections ?? {}).map(([k, v]) => [k, (v.main ?? []).map((o) => (o ?? []).map((l) => ({ node: l.node })))]));
  if (!nodes.some((n) => CATALOG.get(n.type)?.trigger)) nodes.unshift({ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [0, 200] });
  return { flow: { name: src.name ?? 'Automatisation importée', nodes, connections, active: false, origin: 'import' }, todo };
}

/** Modèles prêts. */
export function templates(): Array<{ id: string; name: string; what: string; flow: Partial<Workflow> }> {
  const L = (from: string, to: string | string[]) => ({ [from]: [(Array.isArray(to) ? to : [to]).map((node) => ({ node }))] });
  return [
    { id: 'point-matin', name: 'Point du matin', what: 'Chaque jour à 7 h 30 : ce qui demande ton attention, résumé par Odin et envoyé si utile.', flow: { name: 'Point du matin', nodes: [
      { name: 'Chaque matin', type: 'déclencheur.planning', params: { mode: 'cron', cron: '30 7 * * *' }, position: [0, 200] },
      { name: 'Attention', type: 'saga.attention', params: {}, position: [220, 200] },
      { name: 'Regrouper', type: 'données.regrouper', params: { champ: 'points' }, position: [440, 200] },
      { name: 'Rédiger', type: 'odin.demander', params: { consigne: 'Fais-moi un point du matin court à partir de : {{ $json.points }}. Commence par le plus urgent. S\'il n\'y a rien, réponds RIEN.', envoyer: 'si utile' }, position: [660, 200] },
    ] as unknown as Workflow['nodes'], connections: { ...L('Chaque matin', 'Attention'), ...L('Attention', 'Regrouper'), ...L('Regrouper', 'Rédiger') } } },
    { id: 'flux-saga', name: 'Flux vers Saga', what: 'Chaque nouvel article d\'un flux (blog, chaîne YouTube) résumé et rangé dans Captures.', flow: { name: 'Flux vers Saga', nodes: [
      { name: 'Nouvel article', type: 'déclencheur.flux', params: { url: 'https://exemple.com/flux.xml', minutes: 60 }, position: [0, 200] },
      { name: 'Résumer', type: 'odin.demander', params: { consigne: 'Résume en 5 lignes cet article : {{ $json.titre }} — {{ $json.résumé }} ({{ $json.lien }})', pour: 'par élément' }, position: [220, 200] },
      { name: 'Ranger', type: 'saga.écrire', params: { mode: 'créer', titre: '{{ $json.titre }}', type: 'capture', contenu: '{{ $json.réponse }}\n\nSource : {{ $json.lien }}' }, position: [440, 200] },
    ] as unknown as Workflow['nodes'], connections: { ...L('Nouvel article', 'Résumer'), ...L('Résumer', 'Ranger') } } },
    { id: 'formulaire', name: 'Formulaire → Runes', what: 'Un webhook reçoit une demande (formulaire de site) et l\'ajoute à la base Clients, puis te prévient.', flow: { name: 'Formulaire vers Runes', nodes: [
      { name: 'Formulaire', type: 'déclencheur.webhook', params: { réponse: 'tout de suite' }, position: [0, 200] },
      { name: 'Ajouter le contact', type: 'runes.ajouter', params: { base: 'personne', titre: '{{ $json.nom }}', propriétés: '{ "email": "{{ $json.email }}", "message": "{{ $json.message }}" }' }, position: [220, 200] },
      { name: 'Prévenir', type: 'odin.prévenir', params: { texte: '📩 Nouvelle demande de {{ $json.nom }} : {{ $json.message }}' }, position: [440, 200] },
    ] as unknown as Workflow['nodes'], connections: { ...L('Formulaire', 'Ajouter le contact'), ...L('Ajouter le contact', 'Prévenir') } } },
    { id: 'surveille', name: 'Surveiller une page', what: 'Prévient quand une page change (prix, stock, annonce).', flow: { name: 'Surveiller une page', nodes: [
      { name: 'La page change', type: 'déclencheur.surveille', params: { url: 'https://exemple.com', minutes: 60 }, position: [0, 200] },
      { name: 'Ce qui a changé', type: 'odin.demander', params: { consigne: 'Avant : {{ $json.avant }}\nMaintenant : {{ $json.extrait }}\nDis en une phrase ce qui a changé sur {{ $json.url }}. Si rien d\'important, réponds RIEN.', envoyer: 'si utile' }, position: [220, 200] },
    ] as unknown as Workflow['nodes'], connections: L('La page change', 'Ce qui a changé') } },
    { id: 'nouvelle-tache', name: 'Nouvelle tâche → rappel', what: 'Quand une tâche est créée dans Saga, Odin te la confirme avec son échéance.', flow: { name: 'Nouvelle tâche', nodes: [
      { name: 'Tâche créée', type: 'déclencheur.saga', params: { quand: 'créée', type: 'tâche' }, position: [0, 200] },
      { name: 'Prévenir', type: 'odin.prévenir', params: { texte: '📝 Nouvelle tâche : {{ $json.titre }}' }, position: [220, 200] },
    ] as unknown as Workflow['nodes'], connections: L('Tâche créée', 'Prévenir') } },
  ];
}

