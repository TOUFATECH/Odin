// Valhalla en marche : démarre les modules, leurs surveillances, le fil d'alertes (envoyées sur ta
// messagerie selon leur gravité), les événements entre modules (réflexes et Talos), et le choix du
// bon module pour un besoin, avec ou sans IA.

import { Metrics, setMetrics } from './metrics.ts';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { understand, type Understood } from './huginn.ts';
import type { Action, ActionResult, Alert, AlertIn, By, Level, Manip, ModCtx, Module, NotifyOpts } from './types.ts';

const RANK: Record<Level, number> = { info: 0, moyenne: 1, haute: 2, critique: 3 };
const ICON: Record<Level, string> = { info: 'ℹ️', moyenne: '🟡', haute: '🟠', critique: '🔴' };
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface ValhallaDeps {
  notify?(text: string, o?: NotifyOpts): Promise<void>;
  ask?(text: string): Promise<string>;
  fetch?: typeof fetch;
  now?(): Date;
  /** exécution de commande (remplaçable dans les tests) */
  run?: ModCtx['run'];
  /** niveau d'autonomie d'Odin (Heimdall) : en « breaker », Odin décide seul de garder ses manips */
  autonomy?(): 'prudent' | 'equilibre' | 'autonome' | 'breaker';
}

export class Valhalla {
  readonly events = new EventEmitter();
  readonly dir: string;
  private mods = new Map<string, Module>();
  private ctxs = new Map<string, ModCtx>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private alertsFile: string;
  private recent = new Map<string, number>();
  private deps: ValhallaDeps;
  constructor(home: string, modules: Module[], deps: ValhallaDeps = {}) {
    this.deps = deps;
    this.dir = join(home, 'valhalla');
    mkdirSync(this.dir, { recursive: true });
    this.alertsFile = join(this.dir, 'alertes.jsonl');
    for (const m of modules) this.mods.set(m.id, m);
    this.events.setMaxListeners(100);
    // Les mesures gardées dans le temps (courbes, déclencheurs, tableaux de bord).
    this.metrics = new Metrics(join(this.dir, 'mesures'), deps.now ? () => deps.now!().getTime() : Date.now); setMetrics(this.metrics);
  }
  readonly metrics: Metrics;

  modules(): Module[] { return [...this.mods.values()]; }
  module(id: string): Module | undefined {
    const n = norm(id);
    return this.mods.get(id) ?? this.modules().find((m) => norm(m.name) === n || norm(m.id) === n || (m.modes ?? []).some((x) => norm(x).startsWith(n)) || m.from.some((x) => norm(x) === n));
  }

  // ---------------- Contexte d'un module
  ctx(id: string): ModCtx {
    const have = this.ctxs.get(id); if (have) return have;
    const dir = join(this.dir, id); mkdirSync(dir, { recursive: true });
    const sf = join(dir, 'réglages.json');
    const settings: Record<string, unknown> = existsSync(sf) ? JSON.parse(readFileSync(sf, 'utf8')) : {};
    const c: ModCtx = {
      home: join(this.dir, '..'), dir, settings,
      // Écriture sûre : le dossier est recréé s'il a disparu, et le fichier est remplacé d'un coup (jamais à moitié écrit).
      saveSettings: (patch) => { Object.assign(settings, patch); mkdirSync(dir, { recursive: true }); const tmp = `${sf}.tmp`; writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 }); renameSync(tmp, sf); },
      alert: (a) => this.alert(id, a),
      emit: (type, data = {}) => { this.events.emit('event', { module: id, type, data, at: (this.deps.now?.() ?? new Date()).toISOString() }); },
      run: this.deps.run ?? run,
      has: async (cmd) => (await (this.deps.run ?? run)('sh', ['-c', `command -v ${cmd.replace(/[^\w.-]/g, '')}`])).code === 0,
      fetch: this.deps.fetch ?? fetch,
      notify: async (t, o) => { await this.deps.notify?.(t, o); },
      ask: this.deps.ask,
      call: (m, a, input = {}, why, o) => this.act(m, a, input, o?.interne ? { by: 'toi' } : { by: 'réflexe', why: why ?? `réflexe de ${this.mods.get(id)?.name ?? id}` }),
      now: () => this.deps.now?.() ?? new Date(),
      alerts: (o) => this.alerts(o),
      ack: (ids) => this.ack(ids),
      modules: () => this.modules(),
      order: (text) => this.order(text, `appli:${id}`),
    };
    this.ctxs.set(id, c);
    return c;
  }

  // ---------------- Démarrage
  async start(): Promise<void> {
    for (const m of this.modules()) {
      try { await m.start?.(this.ctx(m.id)); } catch (e) { this.alert(m.id, { level: 'moyenne', title: `${m.name} n'a pas pu démarrer`, detail: (e as Error).message, key: `start:${m.id}` }); }
      if (m.watch) {
        const tick = async () => { try { await m.watch!.run(this.ctx(m.id)); } catch (e) { this.alert(m.id, { level: 'info', title: `${m.name} : surveillance en échec`, detail: (e as Error).message, key: `watch:${m.id}` }); } };
        this.timers.push(setTimeout(tick, 20_000 + Math.random() * 20_000) as unknown as ReturnType<typeof setInterval>, setInterval(tick, m.watch.every * 1000));
      }
    }
  }
  stop(): void { if (this.extraTimer) clearTimeout(this.extraTimer); this.extraTimer = undefined; for (const t of this.timers) { clearInterval(t); clearTimeout(t); } this.timers = []; for (const m of this.modules()) { try { m.stop?.(); } catch { /* rien */ } } try { this.metrics.flush(); } catch { /* disque */ } }

  // ---------------- Actions
  action(moduleId: string, actionId: string): { m: Module; a: Action } | undefined {
    const m = this.module(moduleId); const a = m?.actions.find((x) => x.id === actionId || norm(x.label) === norm(actionId));
    return m && a ? { m, a } : undefined;
  }
  /**
   * `auto` : appel sans personne (automatisation, autre assistant) → les actions graves sont refusées.
   * `by` : qui agit. Tout ce qui n'est pas « toi » et qui change quelque chose est noté dans le
   * journal des manips : tu es prévenu, et tu peux garder ou annuler.
   */
  async act(moduleId: string, actionId: string, input: Record<string, unknown> = {}, o: { auto?: boolean; by?: By; why?: string } = {}): Promise<ActionResult> {
    const f = this.action(moduleId, actionId);
    if (!f) return { ok: false, text: `Action inconnue : ${moduleId} → ${actionId}` };
    const why = f.a.grave?.(input, this.ctx(f.m.id));
    if (o.auto && why) return { ok: false, text: `${f.m.name} · ${f.a.label} : action grave (${why}), elle demande ton accord et ne part pas d'une automatisation.` };
    for (const p of f.a.params ?? []) if (p.required && (input[p.key] === undefined || input[p.key] === '')) return { ok: false, text: `Il manque « ${p.label} ».` };
    const by: By = o.by ?? (o.auto ? 'automatisation' : 'toi');
    try {
      const r = await f.a.run(this.ctx(f.m.id), input);
      this.events.emit('action', { module: f.m.id, action: f.a.id, ok: r.ok !== false, by });
      if (r.ok !== false && by !== 'toi' && !f.a.read && !f.a.quiet) this.noteManip(f.m, f.a, input, r, by, o.why);
      return { ok: true, ...r };
    } catch (e) { this.events.emit('action', { module: f.m.id, action: f.a.id, ok: false, by }); return { ok: false, text: `${f.m.name} · ${f.a.label} : ${(e as Error).message}` }; }
  }

  /** Niveau d'autonomie d'Odin (prudent, équilibré, autonome, Breaker). */
  autonomy(): 'prudent' | 'equilibre' | 'autonome' | 'breaker' { return this.deps.autonomy?.() ?? 'equilibre'; }

  /**
   * Une demande en français, comprise SANS IA (Logos) puis exécutée. `confirm` : tu as confirmé une
   * action grave (sinon elle n'est pas lancée : la réponse dit ce qu'il faut confirmer).
   */
  async order(text: string, session = 'principal', o: { by?: By; confirm?: boolean } = {}): Promise<ActionResult & { understood?: Understood; confirm?: string }> {
    const u = await understand(this, text, session);
    if (!u) return { ok: false, text: 'Je n\'ai pas compris quelle appli utiliser. Dis-le avec le nom de l\'appli ou de la chose (« arrête le conteneur web », « bannis 203.0.113.9 », « les alertes »).' };
    if (u.kind === 'say' || u.kind === 'ask') return { ok: true, text: u.text, understood: u };
    if (u.kind === 'manip') { const r = await this.decide(u.id, u.keep); return { ok: r.ok, text: r.text, understood: u }; }
    const f = this.action(u.module, u.action)!;
    const why = f.a.grave?.(u.input, this.ctx(f.m.id));
    if (why && !o.confirm) return { ok: false, text: `${u.label} : ${why}. C'est une action grave : confirme-la.`, confirm: why, understood: u };
    const r = await this.act(u.module, u.action, u.input, { by: o.by ?? 'toi' });
    return { ...r, text: `${u.label}\n${r.text}`, understood: u };
  }

  // ---------------- Manips : ce qu'Odin a fait sans que tu le demandes (garder / annuler)
  private get manipsFile(): string { return join(this.dir, 'manips.json'); }
  private readManips(): Manip[] { try { const l = JSON.parse(readFileSync(this.manipsFile, 'utf8')) as Manip[]; return Array.isArray(l) ? l : []; } catch { return []; } }
  private writeManips(l: Manip[]): void { const tmp = `${this.manipsFile}.tmp`; writeFileSync(tmp, JSON.stringify(l.slice(-500))); renameSync(tmp, this.manipsFile); }
  private told: number[] = [];
  private extra = 0;
  private extraTimer?: ReturnType<typeof setTimeout>;
  private noteManip(m: Module, a: Action, input: Record<string, unknown>, r: ActionResult, by: By, why?: string): void {
    const now = this.deps.now?.() ?? new Date(), all = this.readManips();
    let id = ''; do { id = Math.random().toString(36).slice(2, 6); } while (!/^[a-z]/.test(id) || all.some((x) => x.id === id));
    let undo: Manip['undo']; try { undo = a.undo?.(input, r, this.ctx(m.id)); } catch { /* pas d'annulation proposée */ }
    // Les mots de passe et jetons éventuels des réglages ne sont jamais recopiés dans le journal.
    const safe = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, (a.params ?? []).find((p) => p.key === k)?.kind === 'password' || /mot_?de_?passe|password|secret|jeton|token|cle\b|clé/i.test(k) ? '•••' : typeof v === 'string' ? v.slice(0, 300) : v]));
    const breaker = this.deps.autonomy?.() === 'breaker';
    // Simple tenue de registre par réflexe (une fiche créée, une configuration rangée au coffre) : rien à
    // annuler, rien à décider — c'est noté dans le journal, sans te déranger.
    const bookkeeping = by === 'réflexe' && !undo;
    const manip: Manip = { id, at: now.toISOString(), module: m.id, action: a.id, label: `${m.name} · ${a.label}`, input: safe, text: r.text.split('\n')[0].slice(0, 300), by, why, undo, state: breaker || bookkeeping ? 'gardée' : 'à décider', ...(breaker ? { decidedBy: 'Odin (mode Breaker)', decidedAt: now.toISOString() } : bookkeeping ? { decidedBy: 'réflexe (rien à annuler)', decidedAt: now.toISOString() } : {}) };
    try { this.writeManips([...all, manip]); } catch { /* disque plein ou dossier disparu : la manip reste faite, le journal non */ }
    this.events.emit('manip', manip);
    if (bookkeeping) return;
    // Tu es prévenu : au plus 3 messages par 10 minutes, puis un seul message de rattrapage.
    const t = now.getTime(); this.told = this.told.filter((x) => t - x < 600_000);
    if (this.told.length >= 3) {
      this.extra++;
      this.extraTimer ??= setTimeout(() => { const n = this.extra; this.extra = 0; this.extraTimer = undefined; if (n) void this.deps.notify?.(`🤖 J'ai fait ${n} autre(s) manip(s) entre-temps. Dis « mes manips » pour les voir, « garde tout » ou « annule <code> ».`).catch(() => {}); }, 600_000);
      (this.extraTimer as { unref?: () => void }).unref?.();
      return;
    }
    this.told.push(t);
    void this.deps.notify?.(this.manipText(manip)).catch(() => {});
  }
  /** Le message envoyé pour une manip (aussi lu par la mascotte). */
  manipText(x: Manip): string {
    const who = { odin: 'de moi-même', 'réflexe': 'par réflexe', automatisation: 'par une automatisation', assistant: 'à la demande d\'un autre assistant', toi: '' }[x.by];
    const tail = x.state === 'à décider' ? (x.undo ? ` Réponds « garde ${x.id} » ou « annule ${x.id} ».` : ` Je ne sais pas l'annuler tout seul. Réponds « garde ${x.id} » pour la valider.`)
      : x.state === 'gardée' && x.decidedBy?.startsWith('Odin') ? ` Je la garde (mode Breaker).${x.undo ? ` « annule ${x.id} » pour revenir en arrière.` : ''}` : '';
    return `🤖 Manip faite ${who} : ${x.label} — ${x.text}${x.why ? ` (${x.why})` : ''}.${tail}`;
  }
  manips(o: { state?: Manip['state']; limit?: number; module?: string } = {}): Manip[] {
    let l = this.readManips().reverse();
    if (o.state) l = l.filter((x) => x.state === o.state);
    if (o.module) l = l.filter((x) => x.module === o.module);
    return l.slice(0, o.limit ?? 100);
  }
  /** « garde » ou « annule » une manip (`id`, ou « tout » / « dernière »). Annuler lance l'action inverse. */
  async decide(id: string, keep: boolean, by = 'toi'): Promise<{ ok: boolean; text: string; manips: Manip[] }> {
    const all = this.readManips(), now = (this.deps.now?.() ?? new Date()).toISOString();
    const want = id.trim().toLowerCase();
    const pick = /^(tout|toutes|tous)$/.test(want) ? all.filter((x) => x.state === 'à décider') : /^(derni[eè]re|dernier|la derni[eè]re)$/.test(want) || !want ? all.filter((x) => x.state !== 'annulée').slice(-1) : all.filter((x) => x.id === want);
    if (!pick.length) return { ok: false, text: want && !/^(tout|toutes|tous|derni)/.test(want) ? `Je ne trouve pas la manip « ${id} ». Dis « mes manips » pour voir les codes.` : 'Aucune manip en attente.', manips: [] };
    const out: string[] = []; let ok = true;
    for (const x of pick) {
      if (keep) { if (x.state === 'annulée') { out.push(`${x.label} : déjà annulée.`); ok = false; continue; } x.state = 'gardée'; x.decidedBy = by; x.decidedAt = now; out.push(`✓ Gardé : ${x.label} — ${x.text}`); continue; }
      if (x.state === 'annulée') { out.push(`${x.label} : déjà annulée.`); continue; }
      if (!x.undo) { out.push(`✗ ${x.label} : je ne sais pas l'annuler tout seul (${x.text}).`); ok = false; continue; }
      const r = await this.act(x.undo.module ?? x.module, x.undo.action, x.undo.input, { by: 'toi' });
      if (r.ok === false) { out.push(`✗ ${x.label} : l'annulation a échoué (${r.text.slice(0, 160)}).`); ok = false; continue; }
      x.state = 'annulée'; x.decidedBy = by; x.decidedAt = now; out.push(`↩ Annulé : ${x.label} (${x.undo.label}).`);
    }
    this.writeManips(all);
    for (const x of pick) this.events.emit('manip', x);
    return { ok, text: out.join('\n'), manips: pick };
  }

  // ---------------- Alertes
  alert(module: string, a: AlertIn): Alert | undefined {
    const now = this.deps.now?.() ?? new Date();
    const key = `${module}:${a.key ?? a.title}`;
    const last = this.recent.get(key);
    // Même alerte dans les 6 h : comptée, pas renvoyée.
    if (last && now.getTime() - last < 6 * 3600_000) { this.bump(key); return undefined; }
    this.recent.set(key, now.getTime());
    const al: Alert = { ...a, id: Math.random().toString(36).slice(2, 10), at: now.toISOString(), module, count: 1, key };
    appendFileSync(this.alertsFile, `${JSON.stringify(al)}\n`);
    this.events.emit('alert', al);
    const min = (this.settings().alertLevel as Level) ?? 'haute';
    if (RANK[a.level] >= RANK[min]) {
      const m = this.mods.get(module);
      // Une alerte critique passe même en « Ne pas déranger » ; une photo (caméra) part avec le message.
      void this.deps.notify?.(`${ICON[a.level]} ${m?.name ?? module} — ${a.title}${a.detail ? `\n${a.detail}` : ''}`, { urgent: a.level === 'critique', ...(a.photo ? { photo: a.photo } : {}) }).catch(() => {});
    }
    return al;
  }
  private bump(key: string): void { this.counts.set(key, (this.counts.get(key) ?? 1) + 1); }
  private counts = new Map<string, number>();
  alerts(o: { module?: string; level?: Level; q?: string; limit?: number } = {}): Alert[] {
    if (!existsSync(this.alertsFile)) return [];
    const acked = this.acked();
    let all = readFileSync(this.alertsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Alert).reverse();
    all = all.map((a) => ({ ...a, ack: acked.has(a.id), count: this.counts.get(a.key ?? '') ?? a.count }));
    if (o.module) all = all.filter((a) => a.module === o.module);
    if (o.level) all = all.filter((a) => RANK[a.level] >= RANK[o.level!]);
    if (o.q) { const q = norm(o.q); all = all.filter((a) => norm(`${a.title} ${a.detail ?? ''} ${a.module}`).includes(q)); }
    return all.slice(0, o.limit ?? 200);
  }
  private acked(): Set<string> { try { return new Set(JSON.parse(readFileSync(join(this.dir, 'alertes-vues.json'), 'utf8'))); } catch { return new Set(); } }
  ack(ids: string[]): void { const s = this.acked(); for (const i of ids) s.add(i); writeFileSync(join(this.dir, 'alertes-vues.json'), JSON.stringify([...s].slice(-5000))); }

  settings(): Record<string, unknown> { try { return JSON.parse(readFileSync(join(this.dir, 'réglages.json'), 'utf8')); } catch { return {}; } }
  saveSettings(patch: Record<string, unknown>): void { writeFileSync(join(this.dir, 'réglages.json'), JSON.stringify({ ...this.settings(), ...patch }, null, 2)); }

  // ---------------- Choisir le module pour un besoin (sans IA : mots-clés)
  find(need: string): Array<{ m: Module; score: number; action?: Action }> {
    const t = ` ${norm(need).replace(/[^\w\s-]/g, ' ')} `;
    const hit = (w: string) => { const n = norm(w); return n.includes(' ') ? t.includes(n) : new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t); };
    return this.modules().map((m) => {
      let score = 0;
      for (const w of m.words) if (hit(w)) score += w.includes(' ') ? 3 : 2;
      if (hit(m.name)) score += 5;
      for (const x of m.from) if (hit(x)) score += 4;
      for (const x of m.modes ?? []) if (hit(x.split(' ')[0])) score += 3;
      let action: Action | undefined, best = 0;
      for (const a of m.actions) { const s = (a.words ?? []).filter(hit).length * 2 + (hit(a.label) ? 2 : 0); if (s > best) { best = s; action = a; } }
      return { m, score: score + best, action };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  }
  describe(m: Module): string {
    return `**${m.name}** (${m.family}) — ${m.what}\nCe qu'il fait :\n${m.does.map((d) => `- ${d}`).join('\n')}${m.modes?.length ? `\nModes : ${m.modes.join(', ')}` : ''}\nActions : ${m.actions.map((a) => `${a.label}${a.grave ? ' (avec ton accord)' : ''}`).join(' · ')}\nReprend les fonctions de : ${m.from.join(', ')}.`;
  }
}

/** Commande système avec délai ; sudo -n si demandé (jamais de mot de passe tapé). */
export function run(cmd: string, args: string[], o: { timeoutMs?: number; input?: string; sudo?: boolean } = {}): Promise<{ code: number; out: string; err: string }> {
  const [c, a] = o.sudo && process.getuid?.() !== 0 ? ['sudo', ['-n', cmd, ...args]] : [cmd, args];
  return new Promise((resolve) => {
    const p = execFile(c, a, { timeout: o.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (err, out, er) => resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, out: String(out), err: String(er || (err && !out ? err.message : '')) }));
    if (o.input !== undefined) { p.stdin?.end(o.input); }
  });
}
