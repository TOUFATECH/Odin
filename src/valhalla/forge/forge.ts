// Le moteur commun d'Andromède (ISO) et de Hermès (logiciels) :
//   - un dossier choisi (disque, ou partage réseau monté : /mnt/nas/iso…) ;
//   - Odin y reconnaît ce que tu as déjà, suit ce que tu choisis, et aux jours et à l'heure que tu programmes
//     (ou à une date), vérifie les sites officiels, télécharge la nouvelle version, contrôle l'empreinte publiée
//     par l'éditeur, puis ne garde que les N dernières versions (2 par défaut : l'ancienne et la nouvelle) ;
//   - historique de tout (vérifié, téléchargé, remplacé, supprimé, échec), bulles de la mascotte à chaque
//     événement, et un résumé chaque jour à l'heure choisie.
import { journalDe } from '../base/journal.ts';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Action, ModCtx, Module, Param, Section, Tone } from '../types.ts';
import { cmpVersion, customSource, type Kind, type Release, type Source } from './sources.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
export interface Plan { days: number[]; at: string; date?: string; auto: boolean }
export interface Found { source: Source; version: string; path: string; size: number; mtime: number }
export interface Event { at: number; what: 'vérifié' | 'nouvelle version' | 'téléchargé' | 'supprimé' | 'échec' | 'empreinte fausse' | 'mis de côté' | 'repéré' | 'intègre' | 'abîmé'; source: string; name: string; version?: string; file?: string; size?: number; sha256?: string; ms?: number; detail?: string }
interface Job { source: string; name: string; file: string; version: string; done: number; total?: number; started: number; ctrl: AbortController }
interface Custom { id: string; name: string; repo?: string; url?: string; pattern: string; sha256?: string }

// ---------------- Pur ----------------
/** Le prochain passage programmé après `now` (jours de la semaine + heure, ou une date). Pur. */
export function nextRun(p: Plan, now: Date): Date | undefined {
  const [h, m] = p.at.split(':').map(Number);
  if (p.date) { const d = new Date(`${p.date}T${p.at}:00`); return d > now ? d : undefined; }
  for (let k = 0; k <= 7; k++) { const d = new Date(now); d.setDate(d.getDate() + k); d.setHours(h, m, 0, 0); if (d > now && p.days.includes(d.getDay())) return d; }
  return undefined;
}
/** Le passage est-il dû (heure passée aujourd'hui, pas encore fait depuis) ? Pur. */
export function due(p: Plan, now: Date, last: number): boolean {
  const [h, m] = p.at.split(':').map(Number), at = new Date(now); at.setHours(h, m, 0, 0);
  if (p.date) { const d = new Date(`${p.date}T${p.at}:00`); return now >= d && last < d.getTime(); }
  return p.days.includes(now.getDay()) && now >= at && last < at.getTime();
}
/** Reconnaît les fichiers d'un dossier (2 niveaux). Pur sauf la lecture du dossier. */
export function scan(root: string, sources: Source[]): { found: Found[]; unknown: string[] } {
  const found: Found[] = [], unknown: string[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[] = []; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith('.')) continue; const p = join(dir, n); let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth < 2) walk(p, depth + 1); continue; }
      const src = sources.find((x) => x.match.test(n)); const v = src ? src.match.exec(n)?.[1] : undefined;
      if (src && v) found.push({ source: src, version: v, path: p, size: st.size, mtime: st.mtimeMs }); else unknown.push(relative(root, p));
    }
  };
  walk(root, 0);
  return { found, unknown };
}
/** Les fichiers à supprimer pour n'en garder que `keep` par source (les plus anciennes versions). Pur. */
export function toPrune(found: Found[], keep: number): Found[] {
  const by = new Map<string, Found[]>(); for (const f of found) by.set(f.source.id, [...(by.get(f.source.id) ?? []), f]);
  return [...by.values()].flatMap((l) => l.sort((a, b) => cmpVersion(b.version, a.version) || b.mtime - a.mtime).slice(Math.max(1, keep)));
}
export const sizeText = (n?: number) => (n === undefined ? '—' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} Go` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
export const sha256File = (p: string) => new Promise<string>((ok, ko) => { const h = createHash('sha256'); createReadStream(p).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
/** Un pavé de couleur avec les initiales (quand l'icône de l'éditeur n'est pas disponible). */
export function monogram(name: string, color: string): string {
  const t = name.replace(/\(.*\)/, '').split(/[\s-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase().replace(/[<&"]/g, '');
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="${/^#[0-9a-f]{6}$/i.test(color) ? color : '#6B7280'}"/><text x="20" y="26" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">${t}</text></svg>`).toString('base64')}`;
}

/** Télécharge en reprenant un fichier entamé, en calculant l'empreinte au fil de l'eau, avec un débit maximum. */
export async function download(fetchFn: (u: string, i?: RequestInit) => Promise<Response>, r: Release, dir: string, o: { signal?: AbortSignal; rate?: number; progress?: (done: number, total?: number) => void } = {}): Promise<{ path: string; size: number; sha256: string; checked: boolean }> {
  mkdirSync(dir, { recursive: true });
  const name = basename(r.file); if (!name || name !== r.file.split('/').pop() || /[\\/]|^\.\.?$/.test(name)) throw new Error('nom de fichier invalide');
  const part = join(dir, `.${name}.part`), final = join(dir, name), h = createHash('sha256');
  let have = existsSync(part) ? statSync(part).size : 0;
  if (have) await new Promise<void>((ok, ko) => createReadStream(part).on('data', (c) => h.update(c)).on('end', ok).on('error', ko));
  const res = await fetchFn(r.url, { headers: { 'user-agent': 'Odin-Eitri/1', ...(have ? { range: `bytes=${have}-` } : {}) }, signal: o.signal, redirect: 'follow' });
  if (have && res.status === 200) { have = 0; h.destroy(); return download(fetchFn, r, (rmSync(part, { force: true }), dir), o); } // le serveur ne sait pas reprendre
  if (!res.ok && res.status !== 206) throw new Error(`le site répond ${res.status}`);
  const total = (Number(res.headers.get('content-length')) || 0) + have || r.size;
  const fh = await open(part, have ? 'a' : 'w'); let done = have; const t0 = Date.now();
  try {
    const reader = res.body!.getReader();
    for (;;) {
      const { done: end, value } = await reader.read(); if (end) break;
      h.update(value); await fh.write(value); done += value.length; o.progress?.(done, total);
      // Débit maximum (Mo/s) : on attend ce qu'il faut.
      if (o.rate) { const ahead = (done - have) / (o.rate * 1024 * 1024) * 1000 - (Date.now() - t0); if (ahead > 20) await new Promise((w) => setTimeout(w, Math.min(ahead, 2000))); }
    }
  } finally { await fh.close(); }
  const sum = h.digest('hex');
  if (r.sha256 && sum !== r.sha256.toLowerCase()) { rmSync(part, { force: true }); throw Object.assign(new Error(`empreinte fausse : attendu ${r.sha256.slice(0, 16)}…, reçu ${sum.slice(0, 16)}…`), { code: 'SHA' }); }
  renameSync(part, final);
  return { path: final, size: done, sha256: sum, checked: !!r.sha256 };
}

// ---------------- L'appli ----------------
export interface ForgeOpts {
  id: string; name: string; kind: Kind; noun: string; nouns: string; from: string[]; upstream: string[]; words: string[];
  sources: Source[]; defaultDir: string; what: string; extraDoes?: string[];
  /** Après un téléchargement réussi (ex. l'antivirus pour les logiciels). Rend un motif pour mettre de côté. */
  after?: (ctx: ModCtx, path: string, src: Source) => Promise<string | undefined>;
}

export function forgeModule(o: ForgeOpts): Module & { _jobs: () => Job[]; _cycle: (ctx: ModCtx, why: string) => Promise<string> } {
  const jobs = new Map<string, Job>(); let running = false;
  const icons = new Map<string, string>();
  const root = (ctx: ModCtx) => s(ctx.settings.dossier) || join(ctx.home, o.defaultDir);
  const plan = (ctx: ModCtx): Plan => ({ days: [5], at: '03:00', auto: true, ...(ctx.settings.plan as Partial<Plan> | undefined) });
  const keep = (ctx: ModCtx) => Math.max(1, Math.min(5, Number(ctx.settings.garder) || 2));
  const customs = (ctx: ModCtx) => ((ctx.settings.customs as Custom[] | undefined) ?? []).map((c) => customSource({ ...c, kind: o.kind }));
  const all = (ctx: ModCtx) => [...o.sources, ...customs(ctx)];
  const followed = (ctx: ModCtx) => new Set((ctx.settings.suivis as string[] | undefined) ?? []);
  const byName = (ctx: ModCtx, q: unknown) => { const t = s(q).trim().toLowerCase(); const x = all(ctx).find((y) => y.id === t || y.name.toLowerCase() === t) ?? all(ctx).find((y) => y.name.toLowerCase().includes(t) && t.length >= 3); if (!x) throw new Error(`${o.noun} inconnu : « ${s(q)} » (voir le catalogue)`); return x; };
  // L'historique : dans la base d'Odin dès qu'elle est prête (journal « forge_<appli> »), sinon historique.jsonl.
  const hj = (ctx: ModCtx) => journalDe<Event>(ctx, `forge_${basename(ctx.dir)}`, 'historique.jsonl', { garder: 2000 });
  const log = (ctx: ModCtx, e: Omit<Event, 'at'>) => { try { hj(ctx).ajouter({ at: Date.now(), ...e } as Event); } catch { /* disque plein */ } };
  const history = (ctx: ModCtx, n = 200): Event[] => hj(ctx).tout().slice(-n).reverse();
  const latestCache = new Map<string, { at: number; r?: Release; err?: string }>();
  const getLatest = async (ctx: ModCtx, src: Source, fresh = false): Promise<Release> => {
    const c = latestCache.get(src.id); if (!fresh && c && Date.now() - c.at < 3600_000) { if (c.r) return c.r; throw new Error(c.err); }
    if (!src.latest) throw new Error(src.manual ?? 'pas de source officielle automatique');
    try { const r = await src.latest(ctx.fetch as never); latestCache.set(src.id, { at: Date.now(), r }); return r; } catch (e) { latestCache.set(src.id, { at: Date.now(), err: (e as Error).message }); throw e; }
  };
  const tracked = (ctx: ModCtx, f: Found[]) => { const ids = followed(ctx); for (const x of f) ids.add(x.source.id); return all(ctx).filter((x) => ids.has(x.id)); };
  const icon = async (ctx: ModCtx, src: Source): Promise<string> => {
    const k = src.id; if (icons.has(k)) return icons.get(k)!;
    const file = join(ctx.dir, 'icones', `${k.replace(/[^\w-]/g, '_')}.json`);
    try { const c = JSON.parse(readFileSync(file, 'utf8')) as { uri: string }; icons.set(k, c.uri); return c.uri; } catch { /* pas encore */ }
    let uri = monogram(src.name, src.color);
    if (src.icon) {
      try {
        const r = await ctx.fetch(src.icon, { signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Odin-Eitri/1' } }); const t = (r.headers.get('content-type') ?? '').split(';')[0].trim();
        const b = Buffer.from(await r.arrayBuffer());
        if (r.ok && /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|webp|gif)$/.test(t) && b.length > 0 && b.length < 96 * 1024) uri = `data:${t};base64,${b.toString('base64')}`;
      } catch { /* hors ligne : pavé de couleur */ }
      try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ uri })); } catch { /* */ }
    }
    icons.set(k, uri); return uri;
  };
  const say = (ctx: ModCtx, level: 'info' | 'moyenne' | 'haute' | 'critique', title: string, detail: string, extra: Record<string, unknown> = {}) => ctx.alert({ level, title, detail, key: `${o.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...extra });

  /** Télécharge la dernière version d'une source, puis range et fait le ménage. */
  async function fetchOne(ctx: ModCtx, src: Source, rel: Release): Promise<string> {
    const dir = join(root(ctx), src.family === 'Ajoutés par toi' ? 'Autres' : src.name.replace(/\s*\(.*\)\s*$/, '').replace(/[^\w .+-]/g, '').trim() || src.id);
    const ctrl = new AbortController(), job: Job = { source: src.id, name: src.name, file: rel.file, version: rel.version, done: 0, total: rel.size, started: Date.now(), ctrl };
    jobs.set(src.id, job);
    say(ctx, 'info', `⬇ ${src.name} ${rel.version} : téléchargement`, `${rel.file}${rel.size ? ` (${sizeText(rel.size)})` : ''} depuis le site officiel.`);
    try {
      const r = await download(ctx.fetch as never, rel, dir, { signal: ctrl.signal, rate: Number(ctx.settings.debit) || undefined, progress: (d, t) => { job.done = d; job.total = t; } });
      const ms = Date.now() - job.started;
      const hold = o.after ? await o.after(ctx, r.path, src).catch(() => undefined) : undefined;
      if (hold) { const aside = join(root(ctx), '.mis-de-cote'); mkdirSync(aside, { recursive: true }); renameSync(r.path, join(aside, basename(r.path))); log(ctx, { what: 'mis de côté', source: src.id, name: src.name, version: rel.version, file: rel.file, detail: hold }); say(ctx, 'critique', `${src.name} ${rel.version} mis de côté`, `L'antivirus a trouvé : ${hold}. Le fichier n'a pas remplacé l'ancienne version.`, { steps: ['Ne lance pas ce fichier', 'Regarde le détail dans Asclépios', 'Garde l\'ancienne version en attendant'] }); return `🛡 ${src.name} ${rel.version} mis de côté (antivirus : ${hold}).`; }
      log(ctx, { what: 'téléchargé', source: src.id, name: src.name, version: rel.version, file: rel.file, size: r.size, sha256: r.sha256, ms, detail: r.checked ? 'empreinte de l\'éditeur vérifiée' : 'l\'éditeur ne publie pas d\'empreinte' });
      // Ménage : seulement les N dernières versions.
      const pruned = toPrune(scan(root(ctx), [src]).found, keep(ctx));
      for (const p of pruned) { rmSync(p.path, { force: true }); log(ctx, { what: 'supprimé', source: src.id, name: src.name, version: p.version, file: basename(p.path), size: p.size, detail: `on garde ${keep(ctx)} version(s)` }); }
      say(ctx, 'info', `✅ ${src.name} ${rel.version} téléchargé`, `${sizeText(r.size)} en ${Math.max(1, Math.round(ms / 1000))} s · ${r.checked ? 'empreinte de l\'éditeur vérifiée' : 'sans empreinte publiée par l\'éditeur'}${pruned.length ? ` · ancienne version retirée : ${pruned.map((p) => p.version).join(', ')}` : ''}.`);
      ctx.emit('telecharge', { nom: src.name, version: rel.version, fichier: r.path });
      return `✅ ${src.name} ${rel.version} (${sizeText(r.size)})${r.checked ? ', empreinte vérifiée' : ''}${pruned.length ? ` · retiré : ${pruned.map((p) => p.version).join(', ')}` : ''}`;
    } catch (e) {
      const err = e as Error & { code?: string };
      if (ctrl.signal.aborted) { log(ctx, { what: 'échec', source: src.id, name: src.name, version: rel.version, detail: 'annulé' }); return `⏹ ${src.name} : annulé (le fichier entamé reprendra la prochaine fois).`; }
      log(ctx, { what: err.code === 'SHA' ? 'empreinte fausse' : 'échec', source: src.id, name: src.name, version: rel.version, detail: err.message });
      say(ctx, err.code === 'SHA' ? 'critique' : 'moyenne', err.code === 'SHA' ? `${src.name} : empreinte fausse, fichier jeté` : `${src.name} : téléchargement raté`, err.message, { steps: err.code === 'SHA' ? ['Le fichier reçu n\'est pas celui publié par l\'éditeur : il a été supprimé', 'Réessaie plus tard (miroir pas à jour ?)', 'Si ça recommence, préviens l\'éditeur'] : ['Vérifie la connexion Internet', 'Vérifie la place sur le disque', 'Réessaie : le téléchargement reprend où il s\'était arrêté'], fix: { action: 'telecharger', input: { nom: src.id }, label: 'Réessayer' } });
      return `❌ ${src.name} : ${err.message}`;
    } finally { jobs.delete(src.id); }
  }

  /** Un passage : vérifie chaque suivi, télécharge ce qui est nouveau (si « auto »), puis rend compte. */
  async function cycle(ctx: ModCtx, why: string, only?: Source, force = false): Promise<string> {
    if (running) return 'Un passage est déjà en cours.';
    running = true;
    try {
      const r0 = root(ctx); mkdirSync(r0, { recursive: true });
      const sc = scan(r0, all(ctx)), list = only ? [only] : tracked(ctx, sc.found), out: string[] = [];
      for (const src of list) {
        const mine = sc.found.filter((f) => f.source.id === src.id).sort((a, b) => cmpVersion(b.version, a.version)), have = mine[0]?.version;
        let rel: Release;
        try { rel = await getLatest(ctx, src, true); } catch (e) {
          if (src.manual) { out.push(`ℹ ${src.name}${have ? ` ${have}` : ''} : ${src.manual} ${src.page}`); continue; }
          log(ctx, { what: 'échec', source: src.id, name: src.name, detail: `vérification : ${(e as Error).message}` }); out.push(`❌ ${src.name} : ${(e as Error).message}`); continue;
        }
        if (have && cmpVersion(rel.version, have) <= 0 && !force) { log(ctx, { what: 'vérifié', source: src.id, name: src.name, version: have, detail: 'à jour' }); out.push(`✔ ${src.name} ${have} : à jour`); continue; }
        log(ctx, { what: 'nouvelle version', source: src.id, name: src.name, version: rel.version, detail: have ? `tu as ${have}` : 'pas encore dans le dossier' });
        if (!plan(ctx).auto && why === 'programmé') { say(ctx, 'info', `🆕 ${src.name} ${rel.version} disponible`, have ? `Tu as ${have}.` : 'Pas encore dans ton dossier.', { fix: { action: 'telecharger', input: { nom: src.id }, label: 'Télécharger' } }); out.push(`🆕 ${src.name} ${rel.version} disponible (tu as ${have ?? 'rien'})`); continue; }
        out.push(await fetchOne(ctx, src, rel));
      }
      ctx.saveSettings({ lastRun: Date.now() });
      return out.length ? out.join('\n') : `Rien à suivre : choisis des ${o.nouns} dans le catalogue, ou mets les tiens dans ${r0}.`;
    } finally { running = false; }
  }

  const PLAN: Param[] = [
    { key: 'jours', label: 'Jours (lun, mar… ou « tous »)', kind: 'text', default: 'ven' },
    { key: 'heure', label: 'Heure (HH:MM)', kind: 'text', default: '03:00' },
    { key: 'date', label: 'Ou une seule date (AAAA-MM-JJ)', kind: 'text', default: '' },
    { key: 'auto', label: 'Télécharger tout seul (sinon : me prévenir)', kind: 'boolean', default: true },
  ];
  const actions: Action[] = [
    { id: 'etat', label: 'État', what: `Ce qui est suivi, à jour ou en retard, et le prochain passage`, read: true, words: [`état des ${o.nouns}`, 'état', 'etat'], run: async (ctx) => {
      const sc = scan(root(ctx), all(ctx)), list = tracked(ctx, sc.found), nx = nextRun(plan(ctx), new Date());
      const data = { dossier: root(ctx), fichiers: sc.found.map((f) => ({ source: f.source.id, nom: f.source.name, version: f.version, chemin: f.path, taille: f.size })) };
      return { data, text: `${o.name} · dossier ${root(ctx)} · ${list.length} ${o.nouns} suivi(s) · ${sc.found.length} fichier(s) reconnu(s)${sc.unknown.length ? `, ${sc.unknown.length} non reconnu(s)` : ''} · on garde ${keep(ctx)} version(s)\nProchain passage : ${nx ? nx.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'aucun'}${jobs.size ? `\nEn cours : ${[...jobs.values()].map((j) => `${j.name} ${j.total ? Math.round((j.done / j.total) * 100) : '?'} %`).join(', ')}` : ''}` };
    } },
    { id: 'dossier', label: 'Choisir le dossier', what: `Où ranger les ${o.nouns} : un disque, ou un partage réseau monté (ex. /mnt/nas/${o.kind === 'iso' ? 'iso' : 'logiciels'})`, params: [{ key: 'chemin', label: 'Dossier', kind: 'text', required: true }], words: [`dossier des ${o.nouns}`, `emplacement des ${o.nouns}`], run: (ctx, i) => {
      const p = s(i.chemin).trim(); if (!isAbsolute(p) && !p.startsWith('~/')) throw new Error('donne un chemin complet (ex. /mnt/nas/iso)');
      const abs = p.startsWith('~/') ? join(ctx.home, p.slice(2)) : resolve(p);
      if (/^\/(?:etc|bin|sbin|usr|boot|proc|sys|dev|lib|lib64|var\/lib)(?:\/|$)/.test(abs)) throw new Error('dossier système : choisis un dossier à toi');
      mkdirSync(abs, { recursive: true }); const probe = join(abs, `.odin-${o.id}`); writeFileSync(probe, 'ok'); rmSync(probe);
      ctx.saveSettings({ dossier: abs }); const sc = scan(abs, all(ctx));
      return { text: `📁 ${o.name} range dans ${abs}. ${sc.found.length} ${o.noun}(s) reconnu(s)${sc.unknown.length ? `, ${sc.unknown.length} non reconnu(s)` : ''}.` };
    } },
    { id: 'catalogue', label: 'Catalogue', what: `Les ${o.nouns} qu'Odin sait trouver sur les sites officiels`, read: true, words: [`catalogue des ${o.nouns}`, 'catalogue'], run: (ctx) => {
      const f = followed(ctx); const fam = [...new Set(all(ctx).map((x) => x.family))];
      return { text: fam.map((g) => `${g} :\n${all(ctx).filter((x) => x.family === g).map((x) => `- ${f.has(x.id) ? '★ ' : ''}${x.name} (${x.id}) — ${x.about}${x.manual ? ' · manuel' : ''}`).join('\n')}`).join('\n') };
    } },
    { id: 'suivre', label: `Suivre`, what: `Odin garde ce ${o.noun} à jour dans le dossier`, params: [{ key: 'nom', label: o.noun[0].toUpperCase() + o.noun.slice(1), kind: 'text', required: true }], words: [`suivre un ${o.noun}`, 'suivre'], run: (ctx, i) => { const x = byName(ctx, i.nom); ctx.saveSettings({ suivis: [...new Set([...followed(ctx), x.id])] }); return { text: `★ ${x.name} suivi${x.manual ? ` (manuel : ${x.manual})` : ' : téléchargé au prochain passage, ou tout de suite avec « Télécharger »'}.` }; }, undo: (i) => ({ action: 'ne_plus_suivre', input: { nom: i.nom }, label: 'Ne plus suivre' }) },
    { id: 'ne_plus_suivre', label: 'Ne plus suivre', what: 'Les fichiers restent dans le dossier', quick: false, params: [{ key: 'nom', label: o.noun, kind: 'text', required: true }], run: (ctx, i) => { const x = byName(ctx, i.nom); ctx.saveSettings({ suivis: [...followed(ctx)].filter((y) => y !== x.id) }); return { text: `☆ ${x.name} n'est plus suivi (s'il est dans le dossier, il reste reconnu).` }; } },
    { id: 'verifier', label: 'Vérifier les mises à jour', what: 'Compare avec les sites officiels, sans rien télécharger', read: true, words: [`vérifie les mises à jour des ${o.nouns}`, `nouvelles versions des ${o.nouns}`], run: async (ctx) => {
      const sc = scan(root(ctx), all(ctx)), list = tracked(ctx, sc.found); if (!list.length) return { text: `Rien de suivi pour l'instant.` };
      const lines = await Promise.all(list.map(async (src) => { const have = sc.found.filter((f) => f.source.id === src.id).map((f) => f.version).sort(cmpVersion).pop(); try { const r = await getLatest(ctx, src, true); return `${have && cmpVersion(r.version, have) >= 0 && cmpVersion(r.version, have) === 0 ? '✔' : '🆕'} ${src.name} : ${have ?? 'rien'} → ${r.version}`; } catch (e) { return src.manual ? `ℹ ${src.name} ${have ?? ''} : manuel (${src.page})` : `❌ ${src.name} : ${(e as Error).message}`; } }));
      return { text: lines.join('\n') };
    } },
    { id: 'mettre_a_jour', label: 'Tout mettre à jour', what: 'Vérifie et télécharge maintenant tout ce qui est nouveau', words: [`mets à jour les ${o.nouns}`, `mettre à jour les ${o.nouns}`], run: async (ctx) => ({ text: await cycle(ctx, 'demande') }) },
    { id: 'telecharger', label: 'Télécharger', what: `La dernière version d'un ${o.noun}, maintenant (il devient suivi)`, params: [{ key: 'nom', label: o.noun, kind: 'text', required: true }], words: [`télécharge un ${o.noun}`, 'télécharge', 'telecharge'], run: async (ctx, i) => { const x = byName(ctx, i.nom); if (x.manual) return { ok: false, text: `${x.name} : ${x.manual}\nPage officielle : ${x.page}` }; ctx.saveSettings({ suivis: [...new Set([...followed(ctx), x.id])] }); return { text: await cycle(ctx, 'demande', x) }; } },
    { id: 'annuler', label: 'Arrêter le téléchargement', what: 'Le fichier entamé reprendra la prochaine fois', quick: false, params: [{ key: 'nom', label: `${o.noun} (vide : tous)`, kind: 'text', default: '' }], run: (ctx, i) => { const l = [...jobs.values()].filter((j) => !s(i.nom).trim() || j.source === byName(ctx, i.nom).id); l.forEach((j) => j.ctrl.abort()); return { text: l.length ? `⏹ Arrêté : ${l.map((j) => j.name).join(', ')}.` : 'Aucun téléchargement en cours.' }; } },
    { id: 'programmer', label: 'Programmer', what: 'Jours et heure des vérifications (ou une date), et téléchargement automatique ou non', params: PLAN, words: [`programme les mises à jour des ${o.nouns}`, 'programmer'], run: (ctx, i) => {
      const hm = /^(\d{1,2})[:h](\d{2})?$/.exec(s(i.heure).trim() || '03:00'); if (!hm || Number(hm[1]) > 23 || Number(hm[2] ?? 0) > 59) throw new Error('heure sous la forme 03:00');
      const at = `${hm[1].padStart(2, '0')}:${hm[2] ?? '00'}`, j = s(i.jours).trim().toLowerCase();
      const days = !j || /^(tous|tous les jours|chaque jour)$/.test(j) ? [0, 1, 2, 3, 4, 5, 6] : j.split(/[,\s]+/).filter(Boolean).map((x) => JOURS.indexOf(x.slice(0, 3)));
      if (days.some((x) => x < 0)) throw new Error('jours : lun, mar, mer, jeu, ven, sam, dim, ou « tous »');
      const date = s(i.date).trim(); if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date sous la forme 2026-12-01');
      const p: Plan = { days, at, ...(date ? { date } : {}), auto: i.auto !== false }; ctx.saveSettings({ plan: p });
      const nx = nextRun(p, new Date());
      return { text: `🗓 ${date ? `Le ${date}` : days.length === 7 ? 'Tous les jours' : `Chaque ${days.map((d) => JOURS[d]).join(', ')}`} à ${at} : ${p.auto ? 'vérification et téléchargement' : 'vérification, et je te préviens'}. Prochain : ${nx ? nx.toLocaleString('fr-FR') : 'aucun'}.` };
    } },
    { id: 'garder', label: 'Versions à garder', what: '2 par défaut : l\'ancienne et la nouvelle', quick: false, params: [{ key: 'nombre', label: 'Nombre (1 à 5)', kind: 'number', default: 2 }], run: (ctx, i) => { const n = Math.max(1, Math.min(5, Number(i.nombre) || 2)); ctx.saveSettings({ garder: n }); return { text: `On garde ${n} version(s) de chaque ${o.noun}.` }; } },
    { id: 'resume', label: 'Résumé du jour', what: 'L\'heure du résumé quotidien (téléchargements, mises à jour, changements)', quick: false, params: [{ key: 'heure', label: 'Heure (HH:MM, vide : pas de résumé)', kind: 'text', default: '19:00' }], run: (ctx, i) => { const h = s(i.heure).trim(); if (h && !/^\d{2}:\d{2}$/.test(h)) throw new Error('heure sous la forme 19:00'); ctx.saveSettings({ resume: h || 'non' }); return { text: h ? `📰 Résumé chaque jour à ${h}.` : 'Plus de résumé quotidien.' }; } },
    { id: 'debit', label: 'Débit maximum', what: 'Pour ne pas saturer la connexion (0 : sans limite)', quick: false, params: [{ key: 'mo', label: 'Mo/s', kind: 'number', default: 0 }], run: (ctx, i) => { const n = Math.max(0, Number(i.mo) || 0); ctx.saveSettings({ debit: n }); return { text: n ? `Débit limité à ${n} Mo/s.` : 'Débit sans limite.' }; } },
    { id: 'ajouter_source', label: `Ajouter un ${o.noun} à suivre`, what: 'Un dépôt GitHub (proprietaire/projet) ou une adresse directe officielle, avec le motif du nom de fichier', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'depot', label: 'Dépôt GitHub (proprietaire/projet)', kind: 'text', default: '' }, { key: 'adresse', label: 'Ou adresse directe (https)', kind: 'text', default: '' }, { key: 'motif', label: 'Nom du fichier avec {version}', kind: 'text', required: true, help: 'ex. MonOutil-{version}-x64.exe' }, { key: 'empreinte', label: 'Empreinte SHA-256 (adresse directe)', kind: 'text', default: '' }], run: (ctx, i) => {
      const name = s(i.nom).trim().slice(0, 60), repo = s(i.depot).trim(), url = s(i.adresse).trim(), sha = s(i.empreinte).trim().toLowerCase();
      if (!name) throw new Error('donne un nom'); if (!repo && !url) throw new Error('donne un dépôt GitHub ou une adresse');
      if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('dépôt sous la forme proprietaire/projet');
      if (url && !/^https:\/\//.test(url)) throw new Error('adresse en https seulement'); if (sha && !/^[a-f0-9]{64}$/.test(sha)) throw new Error('empreinte SHA-256 invalide');
      const c: Custom = { id: `perso-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, name, ...(repo ? { repo } : {}), ...(url ? { url } : {}), pattern: s(i.motif).trim(), ...(sha ? { sha256: sha } : {}) };
      customSource({ ...c, kind: o.kind }); // vérifie le motif
      if (all(ctx).some((x) => x.id === c.id)) throw new Error('ce nom existe déjà');
      ctx.saveSettings({ customs: [...((ctx.settings.customs as Custom[] | undefined) ?? []), c], suivis: [...new Set([...followed(ctx), c.id])] });
      return { text: `➕ ${name} ajouté et suivi (${repo ? `dépôt ${repo}` : url}).` };
    }, undo: (i) => ({ action: 'retirer_source', input: { nom: i.nom }, label: 'Retirer' }) },
    { id: 'retirer_source', label: 'Retirer un ajout', what: 'Retire une source ajoutée par toi (les fichiers restent)', quick: false, params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }], run: (ctx, i) => { const x = byName(ctx, i.nom); if (!x.custom) throw new Error('seulement les sources ajoutées par toi'); ctx.saveSettings({ customs: ((ctx.settings.customs as Custom[] | undefined) ?? []).filter((c) => c.id !== x.id), suivis: [...followed(ctx)].filter((y) => y !== x.id) }); return { text: `🗑 ${x.name} retiré.` }; } },
    { id: 'controler', label: 'Contrôler les fichiers', what: 'Recalcule l\'empreinte de chaque fichier et la compare à celle du téléchargement (fichier abîmé ?)', read: true, words: [`contrôle les ${o.nouns}`, 'intégrité'], run: async (ctx) => {
      const sc = scan(root(ctx), all(ctx)), known = new Map(history(ctx, 5000).filter((e) => e.what === 'téléchargé' && e.sha256 && e.file).map((e) => [e.file!, e.sha256!]));
      const out: string[] = [];
      for (const f of sc.found) { const want = known.get(basename(f.path)); if (!want) { out.push(`· ${basename(f.path)} : pas téléchargé par Odin (rien à comparer)`); continue; } const got = await sha256File(f.path); const ok = got === want; log(ctx, { what: ok ? 'intègre' : 'abîmé', source: f.source.id, name: f.source.name, version: f.version, file: basename(f.path) }); if (!ok) say(ctx, 'haute', `${basename(f.path)} est abîmé`, 'Son empreinte ne correspond plus au téléchargement : retélécharge-le.', { fix: { action: 'telecharger', input: { nom: f.source.id }, label: 'Retélécharger' } }); out.push(`${ok ? '✔' : '❌'} ${basename(f.path)}`); }
      return { text: out.join('\n') || 'Aucun fichier reconnu.' };
    } },
    { id: 'historique', label: 'Historique', what: 'Tout ce qui s\'est passé : vérifications, téléchargements, remplacements, échecs', read: true, words: [`historique des ${o.nouns}`, 'historique des téléchargements'], params: [{ key: 'n', label: 'Combien', kind: 'number', default: 30 }], run: (ctx, i) => ({ text: history(ctx, Math.max(1, Math.min(500, Number(i.n) || 30))).map((e) => `- ${new Date(e.at).toLocaleString('fr-FR')} · ${e.what} · ${e.name}${e.version ? ` ${e.version}` : ''}${e.size ? ` · ${sizeText(e.size)}` : ''}${e.detail ? ` · ${e.detail}` : ''}`).join('\n') || 'Rien pour l\'instant.' }) },
  ];

  const mod: Module & { _jobs: () => Job[]; _cycle: (ctx: ModCtx, why: string) => Promise<string> } = {
    id: o.id, name: o.name, family: 'Données', what: o.what,
    does: [`reconnaît les ${o.nouns} déjà dans ton dossier (disque ou partage réseau monté)`, 'télécharge depuis les sites officiels seulement, empreinte de l\'éditeur vérifiée, reprise si coupure, débit maximum', 'vérifie aux jours et à l\'heure que tu programmes (ou à une date) ; télécharge tout seul ou te prévient', 'garde 2 versions (l\'ancienne et la nouvelle), nombre réglable', 'historique de tout, contrôle des fichiers abîmés, résumé chaque jour, bulles de la mascotte à chaque événement', 'icônes des éditeurs, catalogue, sources à toi (dépôt GitHub ou adresse officielle)', ...(o.extraDoes ?? [])],
    from: o.from, upstream: o.upstream, words: o.words, actions,
    async view(ctx) {
      const r0 = root(ctx), sc = scan(r0, all(ctx)), list = tracked(ctx, sc.found), f = followed(ctx), now = new Date(), nx = nextRun(plan(ctx), now), p = plan(ctx);
      const cards = await Promise.all(list.map(async (src) => {
        const mine = sc.found.filter((x) => x.source.id === src.id).sort((a, b) => cmpVersion(b.version, a.version)), c = latestCache.get(src.id), j = jobs.get(src.id);
        const newer = c?.r && (!mine[0] || cmpVersion(c.r.version, mine[0].version) > 0);
        const state = j ? `téléchargement ${j.total ? `${Math.round((j.done / j.total) * 100)} %` : sizeText(j.done)}` : src.manual ? 'manuel' : newer ? `nouvelle version ${c!.r!.version}` : mine[0] ? (c?.r ? 'à jour' : 'pas encore vérifié') : 'pas encore téléchargé';
        return { icon: await icon(ctx, src), title: src.name, sub: mine.length ? mine.map((m) => `${m.version} · ${sizeText(m.size)}`).join(' — ') : 'aucune version dans le dossier', badge: state, tone: (j ? 'attention' : newer || (!mine.length && !src.manual) ? 'attention' : src.manual ? undefined : 'bon') as Tone | undefined, progress: j?.total ? j.done / j.total : undefined, meta: src.family,
          actions: [...(j ? [{ action: 'annuler', label: 'Arrêter', input: { nom: src.id } }] : src.manual ? [] : [{ action: 'telecharger', label: newer || !mine.length ? 'Télécharger' : 'Retélécharger', input: { nom: src.id } }]), ...(f.has(src.id) ? [{ action: 'ne_plus_suivre', label: 'Ne plus suivre', input: { nom: src.id } }] : [])] };
      }));
      const others = await Promise.all(all(ctx).filter((x) => !list.includes(x)).map(async (src) => ({ icon: await icon(ctx, src), title: src.name, sub: src.about, meta: src.family, badge: src.manual ? 'manuel' : '', actions: [{ action: 'suivre', label: 'Suivre', input: { nom: src.id } }] })));
      const h = history(ctx, 40), today = h.filter((e) => new Date(e.at).toDateString() === now.toDateString());
      const sections: Section[] = [
        { kind: 'cards', title: `Mes ${o.nouns}`, items: cards, empty: `Rien de suivi : choisis dans le catalogue ci-dessous, ou mets tes ${o.nouns} dans ${r0}.` },
        ...(sc.unknown.length ? [{ kind: 'list' as const, title: 'Fichiers non reconnus', items: sc.unknown.slice(0, 30).map((u) => ({ title: u, detail: '« Ajouter un suivi » avec le dépôt ou l\'adresse officielle pour qu\'Odin le garde à jour' })) }] : []),
        { kind: 'table', title: 'Historique', columns: ['Quand', 'Quoi', o.noun[0].toUpperCase() + o.noun.slice(1), 'Version', 'Taille', 'Détail'], empty: 'Rien pour l\'instant.', rows: h.map((e) => ({ cells: [new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), e.what, e.name, e.version ?? '—', e.size ? sizeText(e.size) : '—', e.detail ?? ''], tone: (/échec|fausse|abîmé|mis de côté/.test(e.what) ? 'mauvais' : e.what === 'téléchargé' ? 'bon' : undefined) as Tone | undefined })) },
        { kind: 'cards', title: 'Catalogue (sites officiels)', items: others, empty: 'Tout le catalogue est suivi.' },
      ];
      return {
        subtitle: `${r0} · ${list.length} suivi(s) · ${p.date ? `le ${p.date}` : p.days.length === 7 ? 'tous les jours' : p.days.map((d) => JOURS[d]).join(', ')} à ${p.at}${p.auto ? '' : ' (prévenir seulement)'}`,
        kpis: [
          { label: 'Suivis', value: String(list.length) },
          { label: 'À mettre à jour', value: String(list.filter((src) => { const c = latestCache.get(src.id), m = sc.found.filter((x) => x.source.id === src.id).map((x) => x.version).sort(cmpVersion).pop(); return c?.r && (!m || cmpVersion(c.r.version, m) > 0); }).length), tone: 'attention' },
          { label: 'Aujourd\'hui', value: `${today.filter((e) => e.what === 'téléchargé').length} téléchargé(s)`, tone: today.some((e) => /échec|fausse/.test(e.what)) ? 'mauvais' : 'bon' },
          { label: 'Place prise', value: sizeText(sc.found.reduce((a, b) => a + b.size, 0)) },
          { label: 'Prochain passage', value: nx ? nx.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'aucun' },
        ],
        sections,
        side: [
          { kind: 'form', title: 'Dossier', action: 'dossier', submit: 'Choisir', params: [{ key: 'chemin', label: 'Dossier (disque ou partage monté)', kind: 'text', required: true, default: r0 }] },
          { kind: 'form', title: 'Programmation', action: 'programmer', submit: 'Programmer', params: PLAN.map((x) => ({ ...x, default: x.key === 'jours' ? (p.days.length === 7 ? 'tous' : p.days.map((d) => JOURS[d]).join(', ')) : x.key === 'heure' ? p.at : x.key === 'date' ? p.date ?? '' : p.auto })) },
          { kind: 'form', title: `Ajouter un suivi`, action: 'ajouter_source', submit: 'Ajouter', params: actions.find((a) => a.id === 'ajouter_source')!.params! },
        ],
      };
    },
    // Chaque minute : passage programmé, et le résumé du jour.
    watch: { every: 60, async run(ctx) {
      const now = new Date();
      if (due(plan(ctx), now, Number(ctx.settings.lastRun) || 0)) { const t = await cycle(ctx, 'programmé'); if (/❌/.test(t)) ctx.emit('passage', { resultat: t }); }
      const rh = s(ctx.settings.resume) || '19:00';
      if (rh !== 'non' && due({ days: [0, 1, 2, 3, 4, 5, 6], at: rh, auto: true }, now, Number(ctx.settings.lastSummary) || 0)) {
        ctx.saveSettings({ lastSummary: now.getTime() });
        const ev = history(ctx, 1000).filter((e) => e.at >= now.getTime() - 864e5), n = (w: Event['what']) => ev.filter((e) => e.what === w);
        const dl = n('téléchargé'), bad = ev.filter((e) => /échec|fausse|abîmé|mis de côté/.test(e.what)), nv = n('nouvelle version'), rm = n('supprimé');
        ctx.alert({ level: bad.length ? 'moyenne' : 'info', title: `📰 ${o.name} : le résumé du jour`, detail: dl.length || bad.length || nv.length ? [dl.length ? `${dl.length} téléchargé(s) : ${dl.map((e) => `${e.name} ${e.version}`).join(', ')}` : '', nv.length ? `${nv.length} nouvelle(s) version(s) vue(s)` : '', rm.length ? `${rm.length} ancienne(s) version(s) retirée(s)` : '', bad.length ? `${bad.length} souci(s) : ${bad.map((e) => `${e.name} (${e.what})`).join(', ')}` : ''].filter(Boolean).join(' · ') : `Rien de neuf : tout est à jour. Prochain passage : ${nextRun(plan(ctx), now)?.toLocaleString('fr-FR') ?? 'aucun'}.`, key: `${o.id}-resume-${now.toDateString()}` });
      }
    } },
    _jobs: () => [...jobs.values()],
    _cycle: (ctx, why) => cycle(ctx, why),
  };
  return mod;
}
