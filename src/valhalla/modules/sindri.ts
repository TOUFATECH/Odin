// Phénix — le forgeron des sauvegardes : un seul moteur pour tout sauvegarder (dossiers, Thot, Odin,
// partages des PC du foyer en mode « Oïkos », exports de machines virtuelles en mode « Osiris »).
// Chiffré (AES-256-GCM) avant d'écrire, compressé (niveau au choix), dédupliqué (un même morceau n'est stocké
// qu'une fois). Sauvegardes complètes, incrémentielles (ce qui a changé depuis la dernière) ou différentielles
// (ce qui a changé depuis la dernière complète), comme Cobian ou UrBackup ; rotation (derniers, jours, semaines,
// mois) qui garde toujours la chaîne dont une sauvegarde gardée a besoin. Destinations : disque, serveur SFTP,
// partage réseau (copie vérifiée). Commandes avant et après (avec ton accord). Restauration par le navigateur :
// parcourir une version, télécharger un fichier, remettre un dossier ou tout.
// Agent des PC (../sindri/agent.ts, installé par Satellites) : chaque PC pousse lui-même, toutes les heures, ce qui a
// changé (instantané VSS sous Windows quand il le peut) ; restauration sur le PC depuis le navigateur.
// Image disque complète (../sindri/image.ts) : le disque entier d'un poste (dd / partclone, VSS + copie brute,
// hdiutil / asr), rangée comme le reste (dédupliquée, chiffrée, vérifiée, rotation), remise sur un disque.

import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync, utimesSync, chmodSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { ModCtx, Module, Section } from '../types.ts';
import { walk } from './ullr.ts';
import { decrire, essayer, lireDestination, transportDe, type Destination, type Transport } from '../sindri/transport.ts';
import { actionsAgentSindri, lancerAgent } from '../sindri/agent.ts';
import { actionsImage, faireImage, type InfoImage } from '../sindri/image.ts';
import { tacheEnPause } from '../automatismes.ts';
import { dateMurale, fuseauOdin, murale } from '../../draupnir/rythme.ts';

/** L'identifiant Talos de la tâche d'un plan (sans « : », stable tant que le plan garde son nom). */
export const tacheDuPlan = (p: { name: string }) => `plan-${p.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sans-nom'}`;

const CHUNK = 1024 * 1024;
export type TypeSauvegarde = 'complète' | 'incrémentielle' | 'différentielle';
export type Compression = 'aucune' | 'rapide' | 'normale' | 'forte';
const NIVEAU: Record<Compression, number> = { aucune: 0, rapide: 1, normale: 6, forte: 9 };
export interface FileEntry { path: string; size: number; mtime: number; mode: number; chunks: string[] }
export interface Snapshot {
  id: string; at: string; plan: string; paths: string[];
  /** les fichiers lus pour cette sauvegarde (tous pour une complète, ceux qui ont changé sinon) */
  files: FileEntry[]; bytes: number; added: number;
  /** absent : complète (anciennes sauvegardes) */
  type?: TypeSauvegarde;
  /** incrémentielle : la sauvegarde d'avant ; différentielle : la dernière complète */
  parent?: string;
  /** incrémentielle ou différentielle : tous les fichiers présents ce jour-là (les autres ont été effacés depuis) */
  present?: string[];
  /** sauvegarde poussée par l'agent d'un PC */
  poste?: { nom: string; vss: boolean; sautes: number; ouverts?: string[] };
  /** image disque complète : les pièces du disque (voir ../sindri/image.ts) */
  image?: InfoImage;
}
export interface Plan {
  name: string; paths: string[]; repo: string; at: string; keep: { last: number; daily: number; weekly: number; monthly: number };
  /** machines virtuelles à figer (instantané Hydre) avant la sauvegarde */ vms?: number[]; exclude?: string[];
  /** la sorte de sauvegarde voulue (une complète est refaite tous les `completeTous` jours) */ schema?: TypeSauvegarde; completeTous?: number;
  compression?: Compression;
  /** où vont les sauvegardes (absent : le dossier `repo`) */ destination?: Destination;
  /** destination distante : garder aussi la copie sur la machine d'Odin (restauration rapide) */ garderLocal?: boolean;
  /** commandes lancées avant et après (accord du propriétaire à l'enregistrement) */ avant?: string; apres?: string;
  /** plan d'un PC du foyer : le poste dont l'agent pousse ses sauvegardes (rien n'est lancé d'ici à heure fixe) */ agent?: string;
  /** plan d'image disque : le poste et son disque (vide : le disque du système) */ image?: { poste: string; disque?: string };
  /** une sauvegarde tous les N jours (images disque ; absent : chaque jour) */ tousLes?: number;
}

export class Repo {
  readonly root: string; private key: Buffer; private mac: Buffer; private niveau: number;
  /** morceaux déjà présents sur la destination (pas besoin de les garder ici) */
  connus?: Set<string>;
  constructor(root: string, password: string, o: { niveau?: number; connus?: Set<string> } = {}) {
    this.root = root; this.niveau = o.niveau ?? 6; this.connus = o.connus;
    mkdirSync(join(root, 'data'), { recursive: true }); mkdirSync(join(root, 'snapshots'), { recursive: true });
    const cf = join(root, 'config');
    let salt: Buffer;
    if (existsSync(cf)) { const c = JSON.parse(readFileSync(cf, 'utf8')); salt = Buffer.from(c.salt, 'hex'); this.derive(password, salt); if (this.check(Buffer.from(c.check, 'base64')) !== 'sindri') throw new Error('mot de passe du dépôt incorrect'); }
    else { salt = randomBytes(16); this.derive(password, salt); writeFileSync(cf, JSON.stringify({ v: 1, salt: salt.toString('hex'), check: this.seal(Buffer.from('sindri')).toString('base64') })); }
    this.key ??= Buffer.alloc(0); this.mac ??= Buffer.alloc(0);
  }
  private derive(pw: string, salt: Buffer) { const k = scryptSync(pw, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); this.key = k.subarray(0, 32); this.mac = k.subarray(32); }
  private check(b: Buffer): string { try { return this.open(b).toString(); } catch { return ''; } }
  /** Compressé (gzip, niveau du plan ; 0 = stocké tel quel) puis chiffré (AES-256-GCM). */
  seal(plain: Buffer): Buffer { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.key, iv); const z = gzipSync(plain, { level: this.niveau }); const body = Buffer.concat([c.update(z), c.final()]); return Buffer.concat([iv, c.getAuthTag(), body]); }
  open(b: Buffer): Buffer { const d = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return gunzipSync(Buffer.concat([d.update(b.subarray(28)), d.final()])); }
  /** Identifiant d'un morceau : empreinte à clé (on ne peut pas deviner le contenu à partir du nom). */
  id(plain: Buffer): string { return createHmac('sha256', this.mac).update(plain).digest('hex'); }
  chunkPath(id: string) { return join(this.root, 'data', id.slice(0, 2), id); }
  has(id: string) { return existsSync(this.chunkPath(id)) || Boolean(this.connus?.has(id)); }
  put(plain: Buffer): { id: string; added: boolean } { const id = this.id(plain); if (this.has(id)) return { id, added: false }; mkdirSync(dirname(this.chunkPath(id)), { recursive: true }); const tmp = `${this.chunkPath(id)}.tmp`; writeFileSync(tmp, this.seal(plain)); renameSync(tmp, this.chunkPath(id)); return { id, added: true }; }
  get(id: string): Buffer { return this.open(readFileSync(this.chunkPath(id))); }
  saveSnapshot(s: Snapshot) { writeFileSync(join(this.root, 'snapshots', s.id), this.seal(Buffer.from(JSON.stringify(s)))); }
  snapshots(): Snapshot[] { return readdirSync(join(this.root, 'snapshots')).filter((f) => !f.endsWith('.oublié') && !f.endsWith('.part') && !f.endsWith('.tmp')).map((f) => JSON.parse(this.open(readFileSync(join(this.root, 'snapshots', f))).toString()) as Snapshot).sort((a, b) => b.at.localeCompare(a.at)); }
  forget(id: string) { renameSync(join(this.root, 'snapshots', id), join(this.root, 'snapshots', `${id}.oublié`)); }
}
/** Le chemin d'un morceau dans un dépôt (« data/ab/abcdef… »). Pur. */
export const chunkRel = (id: string) => `data/${id.slice(0, 2)}/${id}`;

/**
 * Ce que contient une sauvegarde : pour une complète, ses fichiers ; pour une incrémentielle ou différentielle,
 * la sauvegarde dont elle dépend, plus ce qui a changé, moins ce qui a été effacé. Pur.
 */
export function vue(all: Snapshot[], s: Snapshot): Map<string, FileEntry> {
  const byId = new Map(all.map((x) => [x.id, x])), chain: Snapshot[] = []; let cur: Snapshot | undefined = s;
  while (cur) {
    chain.unshift(cur); if (!cur.parent) break;
    if (chain.length > 5000) throw new Error('chaîne de sauvegardes trop longue');
    const p = byId.get(cur.parent); if (!p) throw new Error(`la sauvegarde ${cur.id} dépend de ${cur.parent}, qui manque`); cur = p;
  }
  const map = new Map<string, FileEntry>();
  for (const c of chain) {
    for (const f of c.files) map.set(f.path, f);
    if (c.present) { const garde = new Set(c.present); for (const k of [...map.keys()]) if (!garde.has(k)) map.delete(k); }
  }
  return map;
}

/** Une sauvegarde : complète (tout est relu), incrémentielle ou différentielle (seuls les fichiers changés, d'après taille et date). */
export function sauvegarder(repo: Repo, plan: Pick<Plan, 'name' | 'paths' | 'exclude'>, type: TypeSauvegarde = 'complète', now = new Date(), all = type === 'complète' ? [] : repo.snapshots()): Snapshot {
  const mine = all.filter((x) => x.plan === plan.name);
  const ref = type === 'incrémentielle' ? mine[0] : type === 'différentielle' ? mine.find((x) => (x.type ?? 'complète') === 'complète') : undefined;
  const avant = ref ? vue(all, ref) : new Map<string, FileEntry>(), present: string[] = [];
  const files: FileEntry[] = []; let bytes = 0, added = 0;
  const ex = (plan.exclude ?? []).map((x) => new RegExp(x));
  for (const root of plan.paths) for (const f of walk(resolve(root))) {
    if (ex.some((r) => r.test(f))) continue;
    let st; try { st = statSync(f); } catch { continue; }
    present.push(f);
    const old = avant.get(f); if (old && old.size === st.size && old.mtime === st.mtimeMs) continue;
    const chunks: string[] = []; let fd: number;
    try { fd = openSync(f, 'r'); } catch { present.pop(); continue; }
    try { const buf = Buffer.alloc(CHUNK); let n: number; while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) { const r = repo.put(Buffer.from(buf.subarray(0, n))); chunks.push(r.id); if (r.added) added += n; } } finally { closeSync(fd); }
    files.push({ path: f, size: st.size, mtime: st.mtimeMs, mode: st.mode & 0o777, chunks }); bytes += st.size;
  }
  const s: Snapshot = { id: `${now.toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`, at: now.toISOString(), plan: plan.name, paths: plan.paths, files, bytes, added, type: ref ? type : 'complète', ...(ref ? { parent: ref.id, present } : {}) };
  repo.saveSnapshot(s);
  return s;
}
/** Une sauvegarde complète (comme avant). */
export function backup(repo: Repo, plan: Pick<Plan, 'name' | 'paths' | 'exclude'>, now = new Date()): Snapshot { return sauvegarder(repo, plan, 'complète', now); }
/** Où va un fichier restauré, sous le dossier cible : « /home/a/x » → cible/home/a/x ; « C:\\Users\\a\\x » → cible\\C\\Users\\a\\x. */
export const under = (target: string, path: string) => join(target, path.replace(/^([A-Za-z]):/, '$1').replace(/^[\\/]+/, ''));
export const contenu = (repo: Repo, snap: Snapshot) => (snap.parent ? [...vue(repo.snapshots(), snap).values()] : snap.files);
function ecrire(repo: Repo, f: FileEntry, out: string) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.concat(f.chunks.map((c) => repo.get(c))));
  try { chmodSync(out, f.mode); utimesSync(out, new Date(f.mtime), new Date(f.mtime)); } catch { /* droits */ }
}
/** Restaure une sauvegarde (ou les chemins qui contiennent `filter`) sous `target` ; `target` vide : chaque fichier à sa place. */
export function restore(repo: Repo, snap: Snapshot, target: string, filter = ''): number {
  let n = 0;
  for (const f of contenu(repo, snap)) { if (filter && !f.path.includes(filter)) continue; ecrire(repo, f, target ? under(target, f.path) : f.path); n++; }
  return n;
}
export function verify(repo: Repo, snap: Snapshot): { ok: number; bad: string[] } { const bad: string[] = []; let ok = 0; for (const id of new Set(contenu(repo, snap).flatMap((f) => f.chunks))) { try { repo.get(id); ok++; } catch { bad.push(id); } } return { ok, bad }; }
/** Rétention : garde les N derniers, puis un par jour, semaine, mois. Renvoie les instantanés à oublier. */
export function toForget(snaps: Snapshot[], keep: Plan['keep']): Snapshot[] {
  const sorted = [...snaps].sort((a, b) => b.at.localeCompare(a.at)), kept = new Set<string>();
  sorted.slice(0, keep.last).forEach((s) => kept.add(s.id));
  const bucket = (fmt: (d: Date) => string, n: number) => { const seen = new Set<string>(); for (const s of sorted) { const k = fmt(new Date(s.at)); if (seen.size >= n) break; if (!seen.has(k)) { seen.add(k); kept.add(s.id); } } };
  bucket((d) => d.toISOString().slice(0, 10), keep.daily);
  bucket((d) => { const t = new Date(d); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); }, keep.weekly);
  bucket((d) => d.toISOString().slice(0, 7), keep.monthly);
  return sorted.filter((s) => !kept.has(s.id));
}
/** La rotation qui ne casse rien : une sauvegarde gardée garde aussi celles dont elle dépend. Pur. */
export function aOublier(snaps: Snapshot[], keep: Plan['keep']): Snapshot[] {
  const f = new Set(toForget(snaps, keep).map((s) => s.id)), byId = new Map(snaps.map((s) => [s.id, s])), garde = new Set(snaps.filter((s) => !f.has(s.id)).map((s) => s.id));
  for (const id of [...garde]) { let c = byId.get(id); while (c?.parent && !garde.has(c.parent)) { garde.add(c.parent); c = byId.get(c.parent); } }
  return snaps.filter((s) => !garde.has(s.id));
}
/** La sorte de sauvegarde à faire aujourd'hui : une complète si aucune depuis `completeTous` jours. Pur. */
export function typeDuJour(p: Pick<Plan, 'schema' | 'completeTous'>, mine: Snapshot[], now: Date): TypeSauvegarde {
  const sch = p.schema ?? 'complète'; if (sch === 'complète') return 'complète';
  const full = mine.filter((s) => (s.type ?? 'complète') === 'complète').sort((a, b) => b.at.localeCompare(a.at))[0];
  return !full || now.getTime() - Date.parse(full.at) >= Math.max(1, p.completeTous ?? 7) * 864e5 - 3600_000 ? 'complète' : sch;
}

// ---------------- Dépôt, destination, commandes ----------------
const s = (v: unknown) => String(v ?? '');
export const plans = (ctx: ModCtx): Plan[] => (ctx.settings.plans as Plan[] | undefined) ?? [];
export const distant = (p: Plan) => Boolean(p.destination && p.destination.genre !== 'disque');
export const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'plan';
/** Le dossier du dépôt sur la machine d'Odin : la destination si c'est un disque, sinon une copie de travail. */
export const racine = (ctx: ModCtx, p: Plan) => (distant(p) ? join(ctx.dir, 'caches', slug(p.name)) : p.destination?.dossier ?? p.repo);
const motDePasse = () => { const pw = process.env.SINDRI_PASSWORD; if (!pw) throw new Error('mot de passe des sauvegardes absent : range-le dans le coffre (SINDRI_PASSWORD)'); return pw; };
function repoOf(_ctx: ModCtx, path: string, p?: Plan, connus?: Set<string>): Repo { return new Repo(path, motDePasse(), { niveau: NIVEAU[p?.compression ?? 'normale'] ?? 6, ...(connus ? { connus } : {}) }); }
export const depot = (ctx: ModCtx, p: Plan) => repoOf(ctx, racine(ctx, p), p);
/** Ouvre le dépôt d'un plan ; pour une destination distante, rapatrie d'abord la configuration et l'index s'ils manquent ici. */
export async function ouvrir(ctx: ModCtx, p: Plan, t?: Transport, loin?: Map<string, number>): Promise<Repo> {
  const root = racine(ctx, p);
  if (t && loin) {
    const manque = [...loin.keys()].filter((r) => (r === 'config' || (r.startsWith('snapshots/') && !r.endsWith('.oublié'))) && !existsSync(join(root, r)));
    if (manque.length) await t.recuperer(manque.map((rel) => ({ rel, local: join(root, rel) })));
  }
  const connus = loin ? new Set([...loin.keys()].filter((r) => r.startsWith('data/')).map((r) => r.split('/').pop()!)) : undefined;
  return repoOf(ctx, root, p, connus);
}
function fichiersLocaux(root: string, base = ''): Array<[string, number]> {
  const out: Array<[string, number]> = []; let noms: string[] = []; try { noms = readdirSync(join(root, base)); } catch { return out; }
  for (const n of noms) { const rel = base ? `${base}/${n}` : n; let st; try { st = statSync(join(root, rel)); } catch { continue; } if (st.isDirectory()) out.push(...fichiersLocaux(root, rel)); else if (st.isFile() && !n.endsWith('.tmp') && !n.endsWith('.part')) out.push([rel, st.size]); }
  return out;
}
/** Envoie à la destination ce qu'elle n'a pas (morceaux, puis index, puis configuration), vérifie tailles et présence. */
export async function envoyerDepot(repo: Repo, t: Transport, garderLocal = true, loin?: Map<string, number>): Promise<{ envoyes: number; octets: number }> {
  const deja = loin ?? await t.liste(), locaux = fichiersLocaux(repo.root), oublies = locaux.filter(([r]) => r.endsWith('.oublié')).map(([r]) => r.slice(0, -'.oublié'.length));
  const a = locaux.filter(([r]) => !r.endsWith('.oublié') && deja.get(r) !== statSync(join(repo.root, r)).size);
  const ordre = (r: string) => (r.startsWith('data/') ? 0 : r.startsWith('snapshots/') ? 1 : 2);
  a.sort((x, y) => ordre(x[0]) - ordre(y[0]));
  for (const k of [0, 1, 2]) await t.envoyer(a.filter(([r]) => ordre(r) === k).map(([rel]) => ({ local: join(repo.root, rel), rel })));
  const apres = await t.liste(), faux = a.filter(([r, n]) => apres.get(r) !== n);
  if (faux.length) throw new Error(`${faux.length} fichier(s) mal arrivés sur ${t.nom} (ex. ${faux[0][0]}) : la copie n'est pas sûre`);
  const vieux = oublies.filter((r) => apres.has(r)); if (vieux.length) await t.effacer(vieux);
  if (!garderLocal) for (const [r] of locaux) if (r.startsWith('data/')) { rmSync(join(repo.root, r), { force: true }); repo.connus ??= new Set(); repo.connus.add(r.split('/').pop()!); }
  return { envoyes: a.length, octets: a.reduce((n, [, o]) => n + o, 0) };
}
/** Rapatrie les morceaux qui manquent ici (destination distante sans copie locale) avant de restaurer. */
export async function rapatrier(ctx: ModCtx, p: Plan, repo: Repo, ids: string[]): Promise<number> {
  const manque = [...new Set(ids)].filter((id) => !existsSync(repo.chunkPath(id))); if (!manque.length) return 0;
  if (!p.destination || !distant(p)) throw new Error(`${manque.length} morceau(x) manquent dans le dépôt`);
  await transportDe(ctx.home, p.destination).recuperer(manque.map((id) => ({ rel: chunkRel(id), local: repo.chunkPath(id) })));
  return manque.length;
}
/** Une commande avant ou après la sauvegarde : « sh -c » (son 1er argument dit où on en est), « cmd /c » sous Windows. */
async function commande(ctx: ModCtx, cmd: string, etat: 'avant' | 'réussie' | 'échouée'): Promise<{ ok: boolean; texte: string }> {
  const r = process.platform === 'win32' ? await ctx.run('cmd', ['/d', '/s', '/c', cmd], { timeoutMs: 1_800_000 }) : await ctx.run('sh', ['-c', cmd, 'odin-sauvegarde', etat], { timeoutMs: 1_800_000 });
  return { ok: r.code === 0, texte: ((r.code === 0 ? r.out : r.err || r.out).trim().split('\n').at(-1) ?? '').slice(0, 160) || `code ${r.code}` };
}
export const human = (b: number) => { const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${Math.round(b * 10) / 10} ${u[i]}`; };
/** Les sauvegardes en cours, par plan : la surveillance et « Lancer maintenant » ne sauvegardent pas deux fois en même temps. */
const PLANS_EN_COURS = new Map<string, Promise<string>>();
function runPlan(ctx: ModCtx, p: Plan, forcer?: TypeSauvegarde): Promise<string> {
  const deja = PLANS_EN_COURS.get(p.name);
  if (deja) return deja;
  const x = runPlanSeul(ctx, p, forcer).finally(() => PLANS_EN_COURS.delete(p.name));
  PLANS_EN_COURS.set(p.name, x);
  return x;
}
async function runPlanSeul(ctx: ModCtx, p: Plan, forcer?: TypeSauvegarde): Promise<string> {
  // PC du foyer : c'est l'agent du poste qui sauvegarde (Satellites le lance) ; image disque : tout le disque du poste.
  if (p.agent) return lancerAgent(ctx, p);
  if (p.image) return faireImage(ctx, p);
  // Mode Osiris (lien Phénix → Hydre) : un instantané de chaque machine virtuelle du plan, juste avant la sauvegarde.
  const vmNotes: string[] = [];
  for (const vmid of p.vms ?? []) { const r = await ctx.call('ymir', 'instantane', { vmid, nom: `sindri-${ctx.now().toISOString().slice(0, 10).replace(/-/g, '')}` }, `avant la sauvegarde « ${p.name} »`).catch((e) => ({ ok: false, text: (e as Error).message })); vmNotes.push(`${r.ok === false ? '✗' : '✓'} machine ${vmid}`); }
  if (p.avant) { const r = await commande(ctx, p.avant, 'avant'); if (!r.ok) throw new Error(`la commande d'avant a échoué (${r.texte}) : sauvegarde annulée`); }
  let ok = false, texte = '';
  try {
    const t = p.destination && distant(p) ? transportDe(ctx.home, p.destination) : undefined, loin = t ? await t.liste() : undefined;
    const repo = await ouvrir(ctx, p, t, loin), t0 = Date.now(), all = repo.snapshots(), type = forcer ?? typeDuJour(p, all.filter((x) => x.plan === p.name), ctx.now());
    const snap = sauvegarder(repo, p, type, ctx.now(), type === 'complète' ? [] : all);
    const old = aOublier(repo.snapshots().filter((x) => x.plan === p.name), p.keep); for (const o of old) repo.forget(o.id);
    let envoi = '';
    if (t) { const e = await envoyerDepot(repo, t, p.garderLocal !== false, loin); envoi = ` Copiée et vérifiée sur ${t.nom} (${e.envoyes} fichier(s), ${human(e.octets)}).`; }
    const last = { at: ctx.now().toISOString(), ok: true, files: snap.files.length, bytes: snap.bytes, added: snap.added, type: snap.type, ms: Date.now() - t0 };
    ctx.saveSettings({ last: { ...((ctx.settings.last as Record<string, unknown>) ?? {}), [p.name]: last } });
    ctx.emit('sauvegarde_ok', { plan: p.name, fichiers: snap.files.length, octets: snap.bytes, type: snap.type ?? 'complète' });
    texte = `💾 ${p.name} : ${snap.files.length} fichiers (${human(snap.bytes)}), ${human(snap.added)} de nouveau, en ${Math.round((Date.now() - t0) / 1000)} s — sauvegarde ${snap.type}${snap.parent ? ` (sur celle du ${snap.parent.slice(0, 10)})` : ''}.${old.length ? ` ${old.length} ancien(s) instantané(s) retiré(s).` : ''}${envoi}${vmNotes.length ? ` Instantanés des machines virtuelles : ${vmNotes.join(', ')}.` : ''}`;
    ok = true;
  } finally {
    if (p.apres) { const r = await commande(ctx, p.apres, ok ? 'réussie' : 'échouée'); if (ok) texte += r.ok ? ' Commande d\'après : faite.' : ` ⚠ Commande d'après en échec (${r.texte}).`; }
  }
  return texte;
}
/** Le plan et la sauvegarde d'un identifiant d'instantané (sans réseau). */
export function trouverInstantane(ctx: ModCtx, id: string): { p: Plan; repo: Repo; snap: Snapshot } {
  for (const p of plans(ctx)) { if (!existsSync(join(racine(ctx, p), 'config'))) continue; const repo = depot(ctx, p), snap = repo.snapshots().find((x) => x.id === id); if (snap) return { p, repo, snap }; }
  throw new Error('instantané introuvable');
}
const norm = (x: string) => x.replace(/\\/g, '/');
/** Le contenu d'un dossier d'une sauvegarde : ses sous-dossiers (avec taille) et ses fichiers. Pur. */
export function dossierDe(fichiers: FileEntry[], dossier: string, racines: string[] = []): { dossiers: Array<{ nom: string; chemin: string; fichiers: number; octets: number }>; fichiers: Array<{ nom: string; chemin: string; octets: number; mtime: number }> } {
  const d = norm(dossier).replace(/\/+$/, '');
  if (!d) return { dossiers: racines.map((r) => { const k = `${norm(r).replace(/\/+$/, '')}/`, l = fichiers.filter((f) => norm(f.path).startsWith(k)); return { nom: r, chemin: norm(r), fichiers: l.length, octets: l.reduce((n, f) => n + f.size, 0) }; }), fichiers: [] };
  const pre = `${d}/`, dirs = new Map<string, { fichiers: number; octets: number }>(), out: Array<{ nom: string; chemin: string; octets: number; mtime: number }> = [];
  for (const f of fichiers) {
    const p = norm(f.path); if (!p.startsWith(pre)) continue;
    const reste = p.slice(pre.length), k = reste.indexOf('/');
    if (k < 0) out.push({ nom: reste, chemin: f.path, octets: f.size, mtime: f.mtime });
    else { const n = reste.slice(0, k), x = dirs.get(n) ?? { fichiers: 0, octets: 0 }; x.fichiers++; x.octets += f.size; dirs.set(n, x); }
  }
  return { dossiers: [...dirs].sort(([a], [b]) => a.localeCompare(b)).map(([nom, x]) => ({ nom, chemin: `${pre}${nom}`, ...x })), fichiers: out.sort((a, b) => a.nom.localeCompare(b.nom)) };
}
const dlDir = (ctx: ModCtx) => join(ctx.dir, 'telechargements');
function menageTelechargements(ctx: ModCtx) { try { for (const n of readdirSync(dlDir(ctx))) { const p = join(dlDir(ctx), n); if (Date.now() - statSync(p).mtimeMs > 3600_000) rmSync(p, { recursive: true, force: true }); } } catch { /* rien */ } }
/** Restaure UN fichier d'une sauvegarde dans le dossier des téléchargements et rend sa référence. */
function versTelechargement(ctx: ModCtx, repo: Repo, f: FileEntry): { nom: string; ref: string } {
  menageTelechargements(ctx);
  const k = randomBytes(6).toString('hex'), nom = basename(norm(f.path)).replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120) || 'fichier', out = join(dlDir(ctx), k, nom);
  ecrire(repo, f, out); return { nom, ref: `dl/${k}/${nom}` };
}
const QUAND_TXT: Record<TypeSauvegarde, string> = { 'complète': 'complète à chaque fois', 'incrémentielle': 'incrémentielle', 'différentielle': 'différentielle' };
const resumePlan = (p: Plan) => `${p.schema && p.schema !== 'complète' ? `${QUAND_TXT[p.schema]} (complète tous les ${p.completeTous ?? 7} j)` : 'complète'} · ${p.compression ?? 'normale'} · chaque jour à ${p.at}`;
const paramsDestination = [
  { key: 'destination', label: 'Destination', kind: 'select' as const, options: ['disque', 'sftp', 'partage'], default: 'disque', help: 'disque (USB, disque monté, \\\\nas\\partage sous Windows), serveur SFTP / SSH, ou partage réseau Windows / NAS' },
  { key: 'depot', label: 'Dossier de destination', kind: 'text' as const, required: true, help: 'disque : chemin absolu ; SFTP : dossier sur le serveur (/srv/sauvegardes) ; partage : dossier dans le partage' },
  { key: 'poste', label: 'Serveur ou poste (SFTP, partage)', kind: 'text' as const, default: '', help: 'un poste du coffre des machines, ou sftp://compte@adresse (clé SSH d\'Odin)' },
  { key: 'partage', label: 'Nom du partage (partage réseau)', kind: 'text' as const, default: '' },
];

export const sindri: Module = {
  id: 'sindri', name: 'Phénix', family: 'Machines',
  what: 'Les sauvegardes : dossiers, PC du foyer (agent toutes les heures) et images disque complètes ; complètes, incrémentielles ou différentielles, compressées et chiffrées, vers un disque, un serveur SFTP ou un partage réseau, avec rotation, et la restauration par le navigateur.',
  does: ['sauvegarde complète, incrémentielle (ce qui a changé depuis la dernière) ou différentielle (depuis la dernière complète), une complète refaite régulièrement', 'compression au choix (aucune, rapide, normale, forte) et chiffrement AES-256 avant d\'écrire quoi que ce soit', 'déduplication : un morceau identique n\'est stocké qu\'une fois', 'destinations : disque (USB, disque monté), serveur SFTP / SSH, partage réseau Windows ou NAS, copie vérifiée', 'commandes avant et après la sauvegarde (avec ton accord)', 'rotation (derniers, jours, semaines, mois) qui garde toujours la chaîne d\'une sauvegarde gardée', 'restauration par le navigateur : parcourir une version, télécharger un fichier, remettre un dossier ou tout', 'vérification de l\'intégrité chaque semaine', 'mode Oïkos : partages des PC du foyer', 'mode Osiris : exports de machines virtuelles', 'alerte si une sauvegarde échoue ou prend du retard', 'agent sur les PC du foyer (installé par Satellites) : sauvegarde incrémentielle toutes les heures vers Odin, instantané VSS des fichiers ouverts sous Windows, restauration sur le PC depuis le navigateur (avec ton accord)', 'image disque complète d\'un poste (Linux : partclone ou dd ; Windows : VSS et copie brute ; Mac : hdiutil, remise par asr), dédupliquée, vérifiée, avec rotation, remise sur un disque (avec ton accord)'],
  from: ['Restic', 'UrBackup', 'Cobian Backup', 'Proxmox Backup Server'], upstream: ['restic/restic', 'uroni/urbackup_backend', 'proxmox/proxmox-backup'],
  modes: ['Oïkos · PC du foyer', 'Osiris · machines virtuelles'],
  words: ['sauvegarde', 'sauvegardes', 'sauvegarder', 'backup', 'restaurer', 'restauration', 'récupérer un fichier', 'récupère un fichier', 'instantane', 'instantané', 'archive', 'incrémentielle', 'incrementielle', 'différentielle', 'differentielle', 'cobian', 'urbackup'],
  actions: [
    { id: 'plans', label: 'Plans de sauvegarde', what: 'Ce qui est sauvegardé, où et quand', read: true, words: ['plans', 'quoi est sauvegarde'], run: (ctx) => { const l = (ctx.settings.last as Record<string, { at: string; ok: boolean; files: number }>) ?? {}; return { text: plans(ctx).map((p) => `- ${p.name} : ${p.paths.join(', ')} → ${p.destination ? decrire(p.destination) : p.repo} · ${resumePlan(p)} · dernière : ${l[p.name] ? `${l[p.name].ok ? '✓' : '✗'} ${l[p.name].at.slice(0, 16).replace('T', ' ')}` : 'jamais'}`).join('\n') || 'Aucun plan.' }; } },
    { id: 'creer', label: 'Nouveau plan', what: 'Quoi, où, quand, quelle sorte de sauvegarde', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'dossiers', label: 'Dossiers (un par ligne)', kind: 'textarea', required: true }, ...paramsDestination, { key: 'heure', label: 'Heure', kind: 'text', default: '02:00' },
      { key: 'sorte', label: 'Sorte de sauvegarde', kind: 'select', options: ['incrémentielle', 'différentielle', 'complète'], default: 'incrémentielle' }, { key: 'complete_tous', label: 'Une complète tous les (jours)', kind: 'number', default: 7 }, { key: 'compression', label: 'Compression', kind: 'select', options: ['normale', 'rapide', 'forte', 'aucune'], default: 'normale' },
      { key: 'garder_local', label: 'Garder aussi une copie sur la machine d\'Odin (SFTP, partage)', kind: 'boolean', default: true }, { key: 'exclure', label: 'Exclure (motifs, un par ligne, ex. \\.tmp$)', kind: 'textarea', default: '' },
      { key: 'derniers', label: 'Garder les N dernières', kind: 'number', default: 3 }, { key: 'jours', label: 'Puis une par jour (jours)', kind: 'number', default: 7 }, { key: 'semaines', label: 'Puis une par semaine (semaines)', kind: 'number', default: 4 }, { key: 'mois', label: 'Puis une par mois (mois)', kind: 'number', default: 12 }],
    run: async (ctx, i) => {
      const n = (v: unknown, d: number, max: number) => { const x = v === undefined || v === '' ? d : Math.floor(Number(v)); return Number.isFinite(x) ? Math.min(max, Math.max(0, x)) : d; };
      const dest = lireDestination({ genre: i.destination, dossier: i.depot, poste: i.poste, partage: i.partage }); if (!dest) throw new Error('où ranger les sauvegardes ?');
      const sorte = (['complète', 'incrémentielle', 'différentielle'].includes(s(i.sorte)) ? s(i.sorte) : 'complète') as TypeSauvegarde, comp = (['aucune', 'rapide', 'normale', 'forte'].includes(s(i.compression)) ? s(i.compression) : 'normale') as Compression;
      const exclude = s(i.exclure).split('\n').map((x) => x.trim()).filter(Boolean); for (const e of exclude) { try { new RegExp(e); } catch { throw new Error(`motif d'exclusion invalide : ${e}`); } }
      const ancien = plans(ctx).find((x) => x.name === s(i.nom));
      const p: Plan = { ...(ancien ?? {}), name: s(i.nom), paths: s(i.dossiers).split('\n').map((x) => x.trim()).filter(Boolean), repo: dest.genre === 'disque' ? dest.dossier : '', at: /^\d\d:\d\d$/.test(s(i.heure)) ? s(i.heure) : '02:00', keep: { last: n(i.derniers, 3, 1000), daily: n(i.jours, 7, 3650), weekly: n(i.semaines, 4, 520), monthly: n(i.mois, 12, 240) }, schema: sorte, completeTous: Math.max(1, n(i.complete_tous, 7, 365)), compression: comp, ...(dest.genre === 'disque' && !ancien?.destination ? {} : { destination: dest }), garderLocal: i.garder_local !== false && i.garder_local !== 'false', ...(exclude.length ? { exclude } : {}) };
      if (dest.genre === 'disque') delete p.destination;
      if (!p.name || !p.paths.length) throw new Error('un nom et au moins un dossier');
      for (const d of p.paths) if (!existsSync(d)) throw new Error(`dossier introuvable : ${d}`);
      let essai = '';
      if (p.destination) { const t = transportDe(ctx.home, p.destination); essai = ` Destination : ${await essayer(t)}.`; await ouvrir(ctx, p, t, await t.liste()); }
      else repoOf(ctx, p.repo, p);
      ctx.saveSettings({ plans: [...plans(ctx).filter((x) => x.name !== p.name), p] });
      return { text: `🗓 Plan « ${p.name} » : ${resumePlan(p)}, ${p.paths.length} dossier(s) → ${p.destination ? decrire(p.destination) : p.repo}.${essai}` };
    } },
    { id: 'commandes', label: 'Commandes avant et après', what: 'Une commande lancée avant chaque sauvegarde du plan (arrêter un service, vider une base…) et une après ; son premier argument dit « avant », « réussie » ou « échouée »', quick: false,
      params: [{ key: 'plan', label: 'Plan', kind: 'text', required: true }, { key: 'avant', label: 'Avant (vide : aucune)', kind: 'text', default: '' }, { key: 'apres', label: 'Après (vide : aucune)', kind: 'text', default: '' }],
      grave: (i) => (s(i.avant).trim() || s(i.apres).trim() ? `lancer à chaque sauvegarde de « ${s(i.plan)} » : ${[s(i.avant).trim() && `avant « ${s(i.avant).trim().slice(0, 100)} »`, s(i.apres).trim() && `après « ${s(i.apres).trim().slice(0, 100)} »`].filter(Boolean).join(', ')} (avec les droits d'Odin)` : undefined),
      run: (ctx, i) => {
        const p = plans(ctx).find((x) => x.name === s(i.plan)); if (!p) throw new Error('plan inconnu');
        const avant = s(i.avant).trim(), apres = s(i.apres).trim(); if (/[\0\r\n]/.test(avant + apres) || avant.length > 2000 || apres.length > 2000) throw new Error('une commande sur une seule ligne (2000 caractères au plus)');
        ctx.saveSettings({ plans: plans(ctx).map((x) => { if (x.name !== p.name) return x; const y = { ...x }; if (avant) y.avant = avant; else delete y.avant; if (apres) y.apres = apres; else delete y.apres; return y; }) });
        return { text: `⚙ Plan « ${p.name} » : ${avant ? 'une commande avant' : 'rien avant'}, ${apres ? 'une commande après' : 'rien après'}.` };
      } },
    { id: 'machines', label: 'Machines virtuelles du plan (Osiris)', what: 'Avant chaque sauvegarde de ce plan, Hydre prend un instantané de ces machines virtuelles', params: [{ key: 'plan', label: 'Plan', kind: 'text', required: true }, { key: 'vms', label: 'Numéros des machines (séparés par des virgules ; vide = aucune)', kind: 'text', default: '' }], run: (ctx, i) => {
      const p = plans(ctx).find((x) => x.name === s(i.plan)); if (!p) throw new Error('plan inconnu');
      const vms = s(i.vms).split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 1e9);
      ctx.saveSettings({ plans: plans(ctx).map((x) => (x.name === p.name ? { ...x, vms } : x)) });
      return { text: vms.length ? `🧊 Plan « ${p.name} » : instantané des machines ${vms.join(', ')} avant chaque sauvegarde.` : `Plan « ${p.name} » : plus d'instantané de machine virtuelle.` };
    } },
    { id: 'sauvegarder', label: 'Sauvegarder maintenant', what: 'Lance un plan tout de suite (la sorte du jour, ou celle demandée)', params: [{ key: 'plan', label: 'Plan', kind: 'text', required: true }, { key: 'sorte', label: 'Sorte (vide : celle du plan)', kind: 'select', options: ['', 'complète', 'incrémentielle', 'différentielle'], default: '' }], words: ['sauvegarde maintenant', 'lance la sauvegarde'], run: async (ctx, i) => {
      const p = plans(ctx).find((x) => x.name === s(i.plan)) ?? plans(ctx)[0]; if (!p) throw new Error('aucun plan');
      const sorte = ['complète', 'incrémentielle', 'différentielle'].includes(s(i.sorte)) ? s(i.sorte) as TypeSauvegarde : undefined;
      return { text: await runPlan(ctx, p, sorte) };
    } },
    { id: 'instantanes', label: 'Instantanés', what: 'Les versions disponibles d\'un plan', read: true, params: [{ key: 'plan', label: 'Plan', kind: 'text' }], run: (ctx, i) => { const p = plans(ctx).find((x) => x.name === s(i.plan)) ?? plans(ctx)[0]; if (!p) return { text: 'Aucun plan.' }; const l = depot(ctx, p).snapshots().filter((x) => x.plan === p.name); return { text: l.map((x) => `- ${x.id} · ${x.at.slice(0, 16).replace('T', ' ')} · ${x.type ?? 'complète'} · ${x.files.length} fichiers lus · ${human(x.bytes)}`).join('\n') || 'Aucun instantané.', data: l.map((x) => ({ id: x.id, at: x.at, type: x.type ?? 'complète', parent: x.parent, files: x.files.length })) }; } },
    { id: 'chercher', label: 'Chercher un fichier', what: 'Dans quelles versions se trouve un fichier', read: true, params: [{ key: 'nom', label: 'Nom ou bout de chemin', kind: 'text', required: true }], words: ['retrouve', 'retrouver', 'version d hier', 'ancien'], run: (ctx, i) => { const out: string[] = []; for (const p of plans(ctx)) { if (!existsSync(join(racine(ctx, p), 'config'))) continue; const repo = depot(ctx, p); for (const sn of repo.snapshots()) for (const f of sn.files) if (f.path.includes(s(i.nom))) out.push(`- ${sn.at.slice(0, 16).replace('T', ' ')} · ${f.path} (${human(f.size)}) · instantané ${sn.id}`); } return { text: out.slice(0, 40).join('\n') || 'Introuvable dans les sauvegardes.' }; } },
    { id: 'parcourir', label: 'Parcourir une sauvegarde', what: 'Les dossiers et fichiers d\'une version, comme dans l\'explorateur, avec un bouton pour télécharger chaque fichier', read: true, params: [{ key: 'instantane', label: 'Instantané (vide : le plus récent du premier plan)', kind: 'text', default: '' }, { key: 'dossier', label: 'Dossier (vide : la racine)', kind: 'text', default: '' }], run: (ctx, i) => {
      let r: { p: Plan; repo: Repo; snap: Snapshot };
      if (s(i.instantane).trim()) r = trouverInstantane(ctx, s(i.instantane).trim());
      else { const p = plans(ctx).find((x) => existsSync(join(racine(ctx, x), 'config'))); if (!p) throw new Error('aucune sauvegarde'); const repo = depot(ctx, p), snap = repo.snapshots().find((x) => x.plan === p.name); if (!snap) throw new Error('aucune sauvegarde'); r = { p, repo, snap }; }
      const tout = contenu(r.repo, r.snap), d = dossierDe(tout, s(i.dossier), r.snap.paths);
      const lignes = [...d.dossiers.map((x) => `📁 ${x.nom}/ · ${x.fichiers} fichier(s), ${human(x.octets)}`), ...d.fichiers.map((x) => `📄 ${x.nom} · ${human(x.octets)} · ${new Date(x.mtime).toLocaleString('fr-FR')}`)];
      const local = (f: { chemin: string }) => (tout.find((x) => x.path === f.chemin)?.chunks ?? []).every((c) => existsSync(r.repo.chunkPath(c)));
      return { text: `${r.p.name} · ${r.snap.at.slice(0, 16).replace('T', ' ')} (${r.snap.type ?? 'complète'}) · ${s(i.dossier) || 'racine'}\n${lignes.join('\n') || '(vide)'}`, data: { instantane: r.snap.id, ...d },
        fichiers: d.fichiers.filter(local).slice(0, 20).map((f) => ({ nom: f.nom, ref: `f/${r.snap.id}/${Buffer.from(f.chemin).toString('base64url')}` })) };
    } },
    { id: 'telecharger', label: 'Télécharger un fichier', what: 'Prépare un fichier d\'une sauvegarde pour le télécharger dans le navigateur (rapatrié de la destination si besoin)', read: true, params: [{ key: 'instantane', label: 'Instantané', kind: 'text', required: true }, { key: 'chemin', label: 'Chemin du fichier', kind: 'text', required: true }], run: async (ctx, i) => {
      const { p, repo, snap } = trouverInstantane(ctx, s(i.instantane).trim()), f = contenu(repo, snap).find((x) => x.path === s(i.chemin) || norm(x.path) === norm(s(i.chemin)));
      if (!f) throw new Error('ce fichier n\'est pas dans cette sauvegarde');
      await rapatrier(ctx, p, repo, f.chunks);
      const d = versTelechargement(ctx, repo, f); return { text: `📄 ${d.nom} prêt (${human(f.size)}).`, fichiers: [d] };
    } },
    { id: 'restaurer', label: 'Restaurer', what: 'Remet des fichiers d\'un instantané dans un dossier, ou à leur place d\'origine (avec ton accord)', words: ['récupère un fichier', 'récupérer un fichier', 'restaure la sauvegarde'], params: [{ key: 'instantane', label: 'Instantané', kind: 'text', required: true }, { key: 'filtre', label: 'Seulement les chemins contenant', kind: 'text' }, { key: 'vers', label: 'Restaurer dans (vide : un dossier à part)', kind: 'text', default: '' }, { key: 'a_sa_place', label: 'À leur place d\'origine (par-dessus)', kind: 'boolean', default: false }],
      grave: (i) => (i.a_sa_place === true || i.a_sa_place === 'true' || s(i.vers) === '/' ? 'restaurer par-dessus les fichiers actuels (ils seront remplacés par ceux de la sauvegarde)' : undefined), run: async (ctx, i) => {
      const { p, repo, snap } = trouverInstantane(ctx, s(i.instantane));
      const place = i.a_sa_place === true || i.a_sa_place === 'true' || s(i.vers) === '/';
      const tout = contenu(repo, snap).filter((f) => !s(i.filtre) || f.path.includes(s(i.filtre)));
      const venus = await rapatrier(ctx, p, repo, tout.flatMap((f) => f.chunks));
      const to = place ? '' : s(i.vers) || join(ctx.dir, 'restaurés', snap.id); const n = restore(repo, snap, to, s(i.filtre));
      return { text: `↩ ${n} fichier(s) restauré(s) ${place ? 'à leur place d\'origine' : `dans ${to}`}${venus ? ` (${venus} morceau(x) rapatrié(s) de ${p.destination ? decrire(p.destination) : 'la destination'})` : ''}.` };
    } },
    { id: 'verifier', label: 'Vérifier', what: 'Relit et déchiffre le dernier instantané de chaque plan', read: true, words: ['verifie les sauvegardes', 'verifie mes sauvegardes', 'teste les sauvegardes', 'teste mes sauvegardes'], run: (ctx) => { const out: string[] = []; for (const p of plans(ctx)) { if (!existsSync(join(racine(ctx, p), 'config'))) continue; const repo = depot(ctx, p); const sn = repo.snapshots().find((x) => x.plan === p.name); if (!sn) continue; if (distant(p) && p.garderLocal === false) { out.push(`· ${p.name} : copie seulement sur ${p.destination ? decrire(p.destination) : 'la destination'} (vérifiée à chaque envoi)`); continue; } const v = verify(repo, sn); out.push(`${v.bad.length ? '✗' : '✓'} ${p.name} : ${v.ok} morceaux lisibles${v.bad.length ? `, ${v.bad.length} ABÎMÉS` : ''}`); if (v.bad.length) ctx.alert({ level: 'critique', title: `Sauvegarde ${p.name} abîmée`, detail: `${v.bad.length} morceaux illisibles`, key: `verify:${p.name}` }); } return { text: out.join('\n') || 'Aucun plan.' }; } },
    { id: 'purger', label: 'Libérer la place des vieilles versions', what: 'Efface pour de bon les versions retirées par la rotation et les morceaux que plus aucune version n\'utilise (ici et sur la destination)', quick: false, params: [{ key: 'plan', label: 'Plan', kind: 'text', required: true }],
      grave: (i) => `effacer définitivement les vieilles versions du plan « ${s(i.plan)} » (celles déjà retirées par la rotation)`, run: async (ctx, i) => {
        const p = plans(ctx).find((x) => x.name === s(i.plan)); if (!p) throw new Error('plan inconnu');
        const repo = depot(ctx, p), garde = new Set(repo.snapshots().flatMap((sn) => contenu(repo, sn).flatMap((f) => f.chunks)));
        const locaux = fichiersLocaux(repo.root), oublies = locaux.filter(([r]) => r.endsWith('.oublié')), morts = locaux.filter(([r]) => r.startsWith('data/') && !garde.has(r.split('/').pop()!));
        for (const [r] of [...oublies, ...morts]) rmSync(join(repo.root, r), { force: true });
        let loin = 0;
        if (p.destination && distant(p)) { const t = transportDe(ctx.home, p.destination), l = await t.liste(), x = [...l.keys()].filter((r) => (r.startsWith('data/') && !garde.has(r.split('/').pop()!)) || (r.startsWith('snapshots/') && !existsSync(join(repo.root, r)))); await t.effacer(x); loin = x.length; }
        return { text: `🧹 ${p.name} : ${oublies.length} vieille(s) version(s) et ${morts.length} morceau(x) effacés (${human(morts.reduce((n, [, o]) => n + o, 0))})${loin ? `, ${loin} fichier(s) sur la destination` : ''}.` };
      } },
    ...actionsAgentSindri,
    ...actionsImage,
  ],
  view(ctx) {
    const l = (ctx.settings.last as Record<string, { at: string; ok: boolean; files: number; bytes: number; added: number; type?: string; error?: string }>) ?? {};
    const ps = plans(ctx), late = ps.filter((p) => !l[p.name] || Date.now() - Date.parse(l[p.name].at) > 36 * 3600_000);
    const versions: Section[] = [];
    for (const p of ps) {
      let snaps: Snapshot[] = []; try { if (process.env.SINDRI_PASSWORD && existsSync(join(racine(ctx, p), 'config'))) snaps = depot(ctx, p).snapshots().filter((x) => x.plan === p.name); } catch { /* dépôt illisible : montré vide */ }
      versions.push({ kind: 'table', onglet: 'Restaurer', title: `Versions · ${p.name}`, columns: ['Quand', 'Sorte', 'Fichiers lus', 'Taille'], empty: 'Aucune version pour l\'instant.', rows: snaps.slice(0, 15).map((x) => ({ cells: [x.at.slice(0, 16).replace('T', ' '), x.type ?? 'complète', String(x.files.length), human(x.bytes)], actions: [{ action: 'parcourir', label: 'Parcourir', input: { instantane: x.id } }, { action: 'restaurer', label: 'Tout restaurer à part', input: { instantane: x.id } }] })) });
    }
    return {
      subtitle: process.env.SINDRI_PASSWORD ? 'Tout est compressé et chiffré avant de partir.' : '⚠ Range d\'abord un mot de passe de sauvegarde dans le coffre (SINDRI_PASSWORD).',
      tabs: ['Phénix · dossiers', 'Oïkos · PC du foyer', 'Osiris · machines virtuelles'],
      onglets: ['Plans', 'Restaurer', 'Nouveau'],
      kpis: [{ label: 'Plans', value: String(ps.length) }, { label: 'En retard', value: String(late.length), tone: late.length ? 'attention' : 'bon' }, { label: 'Dernière réussie', value: Object.values(l).filter((x) => x.ok).sort((a, b) => b.at.localeCompare(a.at))[0]?.at.slice(0, 16).replace('T', ' ') ?? '—' }],
      sections: [
        { kind: 'table', onglet: 'Plans', title: 'Plans', columns: ['Plan', 'Dossiers', 'Destination', 'Sorte', 'Dernière'], empty: 'Aucun plan : crée-en un (onglet Nouveau).', rows: ps.map((p) => ({ cells: [p.name, p.paths.join(', '), p.destination ? decrire(p.destination) : p.repo, resumePlan(p), l[p.name] ? `${l[p.name].ok ? '✓' : '✗'} ${l[p.name].at.slice(5, 16).replace('T', ' ')} · ${l[p.name].type ?? 'complète'} · ${human(l[p.name].bytes ?? 0)}` : 'jamais'], tone: !l[p.name] ? 'attention' : l[p.name].ok ? 'bon' : 'mauvais', actions: [{ action: 'sauvegarder', label: 'Maintenant', input: { plan: p.name } }, { action: 'sauvegarder', label: 'Complète', input: { plan: p.name, sorte: 'complète' } }, { action: 'instantanes', label: 'Versions', input: { plan: p.name } }] })) },
        { kind: 'form', onglet: 'Restaurer', title: 'Restaurer sur le PC', action: 'restaurer_pc', submit: 'Restaurer sur le PC', params: actionsAgentSindri.find((a) => a.id === 'restaurer_pc')?.params ?? [], aide: 'Pour les plans « PC · … » : l\'agent du PC remet les fichiers (avec ton accord).' },
        { kind: 'form', onglet: 'Nouveau', title: 'Image disque d\'un poste', action: 'image_plan', submit: 'Créer', params: actionsImage.find((a) => a.id === 'image_plan')?.params ?? [], aide: 'L\'agent des PC s\'installe depuis Satellites (« Installer la sauvegarde »).' },
        ...versions,
        { kind: 'form', onglet: 'Restaurer', title: 'Parcourir une sauvegarde', action: 'parcourir', submit: 'Ouvrir', params: [{ key: 'instantane', label: 'Instantané (vide : le plus récent)', kind: 'text', default: '' }, { key: 'dossier', label: 'Dossier (vide : la racine)', kind: 'text', default: '' }], aide: 'Chaque fichier du dossier ouvert a son bouton « Télécharger ».' },
        { kind: 'form', onglet: 'Restaurer', title: 'Télécharger un fichier', action: 'telecharger', submit: 'Préparer', params: [{ key: 'instantane', label: 'Instantané', kind: 'text', required: true }, { key: 'chemin', label: 'Chemin du fichier', kind: 'text', required: true }] },
        { kind: 'form', onglet: 'Restaurer', title: 'Retrouver un fichier', action: 'chercher', submit: 'Chercher', params: [{ key: 'nom', label: 'Nom ou bout de chemin', kind: 'text', required: true }] },
        { kind: 'form', onglet: 'Restaurer', title: 'Restaurer', action: 'restaurer', submit: 'Restaurer', params: sindri.actions.find((a) => a.id === 'restaurer')?.params ?? [], aide: 'Par défaut dans un dossier à part ; « à leur place d\'origine » demande ton accord.' },
        { kind: 'form', onglet: 'Nouveau', title: 'Nouveau plan', action: 'creer', submit: 'Créer', params: sindri.actions.find((a) => a.id === 'creer')?.params ?? [], aide: 'Une destination distante est essayée tout de suite (écriture puis relecture).' },
        { kind: 'form', onglet: 'Nouveau', title: 'Commandes avant et après', action: 'commandes', submit: 'Enregistrer', params: sindri.actions.find((a) => a.id === 'commandes')?.params ?? [], aide: 'Elles demandent ton accord, une fois, à l\'enregistrement.' },
      ],
    };
  },
  /** Un fichier d'une sauvegarde remis au navigateur : préparé par « Télécharger », ou restauré à la demande (morceaux présents ici). */
  retrait(ctx, ref) {
    if (ref.startsWith('dl/')) { const f = resolve(dlDir(ctx), ref.slice(3)); return f.startsWith(resolve(dlDir(ctx)) + sep) && existsSync(f) && statSync(f).isFile() ? f : undefined; }
    const m = /^f\/([\w-]{10,80})\/([A-Za-z0-9_-]{1,800})$/.exec(ref); if (!m) return undefined;
    try {
      const { repo, snap } = trouverInstantane(ctx, m[1]), chemin = Buffer.from(m[2], 'base64url').toString(), f = contenu(repo, snap).find((x) => x.path === chemin);
      if (!f || !f.chunks.every((c) => existsSync(repo.chunkPath(c)))) return undefined;
      const d = versTelechargement(ctx, repo, f); return join(dlDir(ctx), d.ref.slice(3));
    } catch { return undefined; }
  },
  // Talos : une tâche par plan lancé d'ici (« Sauvegarde <plan> », tous les jours à l'heure du plan, réglable).
  taches: (ctx) => plans(ctx).filter((p) => !p.agent).map((p) => ({
    id: tacheDuPlan(p), nom: `Sauvegarde ${p.name}`, quoi: `${p.image ? 'Image disque' : p.paths.join(', ')} → ${p.destination ? decrire(p.destination) : p.repo}`,
    rythme: () => ((p.tousLes ?? 1) > 1 ? { genre: 'libre' as const, texte: `Tous les ${p.tousLes} jours à ${p.at.replace(/^0(\d)/, '$1').replace(':00', ' h').replace(':', ' h ')}` } : { genre: 'jour' as const, heure: p.at }),
    ...((p.tousLes ?? 1) > 1 ? {} : { permis: ['jour' as const], regler: (c: ModCtx, r: { genre: string; heure?: string }) => { if (r.genre !== 'jour' || !r.heure) throw new Error('Une sauvegarde se règle à une heure, chaque jour.'); c.saveSettings({ plans: plans(c).map((q) => (q.name === p.name ? { ...q, at: r.heure! } : q)) }); } }),
    lancer: { action: 'sauvegarder', input: { plan: p.name } },
    dernier: (c: ModCtx) => { const x = (c.settings.last as Record<string, { at: string; ok?: boolean }> | undefined)?.[p.name]; return x ? { at: x.at, ok: x.ok !== false } : undefined; },
  })),
  watch: { every: 60, async run(ctx) {
    // L'heure murale du lieu d'Odin (celle que Talos écrit), pas celle de la machine.
    const now = ctx.now(), hm = dateMurale(now).heure, dimanche = murale(now.getTime(), fuseauOdin()).wd === 0;
    const l = (ctx.settings.last as Record<string, { at: string }>) ?? {};
    for (const p of plans(ctx)) {
      const tous = (p.tousLes ?? 1) * 864e5, retard = p.agent ? 7 * 864e5 : tous + 26 * 3600_000;
      if (p.at === hm && !tacheEnPause('sindri', tacheDuPlan(p)) && (!l[p.name] || now.getTime() - Date.parse(l[p.name].at) > (p.tousLes ? tous - 3600_000 : 3600_000))) {
        try { await runPlan(ctx, p); } catch (e) { ctx.saveSettings({ last: { ...l, [p.name]: { at: now.toISOString(), ok: false, error: (e as Error).message } } }); ctx.alert({ level: 'haute', title: `Sauvegarde « ${p.name} » échouée`, detail: (e as Error).message, key: `fail:${p.name}` }); ctx.emit('sauvegarde_echec', { plan: p.name, erreur: (e as Error).message }); }
      } else if (l[p.name] && now.getTime() - Date.parse(l[p.name].at) > Math.max(50 * 3600_000, retard)) ctx.alert({ level: 'haute', title: `Sauvegarde « ${p.name} » en retard`, detail: `Dernière : ${l[p.name].at.slice(0, 16).replace('T', ' ')}`, key: `late:${p.name}` });
    }
    if (dimanche && hm === '04:30') await Promise.resolve(sindri.actions.find((x) => x.id === 'verifier')!.run(ctx, {})).catch(() => undefined);
  } },
};
