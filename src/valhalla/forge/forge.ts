// Le moteur commun d'Andromède (ISO) et de Hermès (logiciels) :
//   - un dossier choisi (disque, ou partage réseau monté : /mnt/nas/iso…) ;
//   - Odin y reconnaît ce que tu as déjà, suit ce que tu choisis, et aux jours et à l'heure que tu programmes
//     (ou à une date), vérifie les sites officiels, télécharge la nouvelle version, contrôle l'empreinte publiée
//     par l'éditeur, puis ne garde que les N dernières versions (2 par défaut : l'ancienne et la nouvelle) ;
//   - historique de tout (vérifié, téléchargé, remplacé, supprimé, échec), bulles de la mascotte à chaque
//     événement, et un résumé chaque jour à l'heure choisie.
import { journalDe } from '../base/journal.ts';
import { createHash } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, win32, type PlatformPath } from 'node:path';
import type { Action, ModCtx, Module, Param, Section, Tone } from '../types.ts';
import { canauxDe, cmpVersion, customSource, versionsDe, type Kind, type Release, type Source, type VersionCatalogue } from './sources.ts';
import './catalogue.ts';
import { chercherEnLigne, entrees, filtrer, iconeDe, metaDe, motifDe, reconnaitre, sourceHomebrew, valeursFiltres, type EntreeStore, type IndexEtat, type SuiviHomebrew, type Vue } from './store.ts';
import type { Fiche } from './bibliotheque.ts';
import { tacheEnPause } from '../automatismes.ts';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { hoteInterdit } from '../lien.ts';
import { isPrivateHost } from '../../heimdall/policy.ts';
import { fuseauOdin, instant, lireHeure, murale, prochaine } from '../../draupnir/rythme.ts';

const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
export interface Plan { days: number[]; at: string; date?: string; auto: boolean }
export interface Found { source: Source; version: string; path: string; size: number; mtime: number }
export interface Event { at: number; what: 'vérifié' | 'nouvelle version' | 'téléchargé' | 'supprimé' | 'échec' | 'empreinte fausse' | 'mis de côté' | 'repéré' | 'intègre' | 'abîmé' | 'rangé dans old'; source: string; name: string; version?: string; file?: string; size?: number; sha256?: string; ms?: number; detail?: string; /** l'adresse d'origine du téléchargement */ url?: string; /** l'empreinte publiée par l'éditeur a été vérifiée */ editeur?: boolean }
interface Job { source: string; name: string; file: string; version: string; done: number; total?: number; started: number; ctrl: AbortController }
interface Custom { id: string; name: string; repo?: string; url?: string; pattern: string; sha256?: string }

// ---------------- Pur ----------------
const NATIF: PlatformPath = process.platform === 'win32' ? win32 : posix;
const SYSTEME_POSIX = /^\/(?:etc|bin|sbin|usr|boot|proc|sys|dev|lib|lib64|var\/lib)(?:\/|$)/;
/** Un dossier de Windows qu'on ne confie pas à une appli : la racine d'un lecteur (ou d'un partage), le dossier de Windows,
 * Program Files, ou le profil d'un autre utilisateur (ni celui de `home`, ni celui du compte qui fait tourner Odin). Sans tenir compte des majuscules, comme Windows. */
export function systemeWindows(p: string, home: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const r = win32.resolve(p).toLowerCase(), racine = win32.parse(r).root, haut = r.slice(racine.length).split(win32.sep)[0];
  if (!haut) return true;
  const dans = (d: string | undefined) => { if (!d) return false; const x = win32.resolve(d).toLowerCase(); return r === x || r.startsWith(x.endsWith(win32.sep) ? x : x + win32.sep); };
  if (['windows', 'program files', 'program files (x86)'].includes(haut) || [env.SystemRoot, env.windir, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].some(dans)) return true;
  if (haut !== 'users') return false;
  const profil = r.slice(racine.length).split(win32.sep)[1] ?? '';
  return !profil || !(dans(home) || profil === (env.USERNAME ?? '').toLowerCase());
}
/** Le même chemin Windows écrit comme sous Linux, sans son lecteur (« D:\etc\iso » → « /etc/iso »), en minuscules. */
export const sansLecteur = (p: string): string => { const r = win32.resolve(p).toLowerCase(); return posix.join('/', ...r.slice(win32.parse(r).root.length).split(win32.sep)); };
/** Le chemin tel que Windows le voit vraiment : la plus longue partie qui existe déjà, dépliée (nom court « PROGRA~1 »,
 * jonction, lien), suivie du reste. Ailleurs que sous Windows, ou si rien n'est lisible : le chemin tel quel. */
export function cheminReelWindows(p: string): string {
  if (process.platform !== 'win32') return p;
  let d = win32.resolve(p); const reste: string[] = [];
  for (;;) {
    try { return win32.join(realpathSync.native(d), ...reste); } catch { /* on remonte d'un cran */ }
    const haut = win32.dirname(d); if (haut === d) return p; reste.unshift(win32.basename(d)); d = haut;
  }
}
/** Un dossier système, refusé comme dossier de rangement : ceux de Linux (et sous Windows, ces mêmes noms sur n'importe
 * quel lecteur, plus ceux de Windows, vérifiés aussi sur le chemin réel ; un « : » après le lecteur, qui viserait un flux
 * NTFS, est refusé). `chemins` et `reel` : les règles de chemin du système, à changer seulement pour un essai. */
export function dossierSysteme(abs: string, home: string, chemins: PlatformPath = NATIF, reel: (p: string) => string = cheminReelWindows): boolean {
  if (SYSTEME_POSIX.test(abs)) return true;
  if (chemins !== win32) return false;
  const windows = (p: string) => { const r = win32.resolve(p); return r.slice(win32.parse(r).root.length).includes(':') || SYSTEME_POSIX.test(sansLecteur(r)) || systemeWindows(r, home); };
  return windows(abs) || windows(reel(abs));
}
/** Le prochain passage programmé après `now` (jours de la semaine + heure, ou une date), à l'heure du lieu d'Odin. Pur. */
export function nextRun(p: Plan, now: Date, fuseau?: string): Date | undefined {
  const heure = lireHeure(p.at); if (!heure) return undefined;
  return prochaine(p.date ? { genre: 'une_fois', date: p.date, heure } : { genre: 'semaine', jours: p.days, heure }, now, fuseau);
}
/** Le passage est-il dû (heure passée aujourd'hui, pas encore fait depuis) ? Heure du lieu d'Odin. Pur. */
export function due(p: Plan, now: Date, last: number, fuseau?: string): boolean {
  const heure = lireHeure(p.at); if (!heure) return false;
  const tz = fuseauOdin(fuseau), [h, m] = heure.split(':').map(Number);
  if (p.date) { const [y, mo, d] = p.date.split('-').map(Number), t = instant(y, mo, d, h, m, tz); return now >= t && last < t.getTime(); }
  const w = murale(now.getTime(), tz), at = instant(w.y, w.mo, w.d, h, m, tz);
  return p.days.includes(w.wd) && now >= at && last < at.getTime();
}
/** Reconnaît les fichiers d'un dossier (2 niveaux). Pur sauf la lecture du dossier. */
export function scan(root: string, sources: Source[], avecOld = false): { found: Found[]; unknown: string[] } {
  const found: Found[] = [], unknown: string[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[] = []; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n.startsWith('.')) continue; const p = join(dir, n); let st; try { st = statSync(p); } catch { continue; }
      // « old » : les anciennes versions mises de côté (Andromède) ; elles ne comptent pas comme versions suivies.
      if (st.isDirectory()) { if (depth < 2 && (n !== 'old' || avecOld)) walk(p, depth + (n === 'old' ? 0 : 1)); continue; }
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
/**
 * Le ménage « old » : les autres versions de la même source passent dans « old » à côté de la nouvelle ; dans
 * chaque « old », une seule version est gardée (la plus récente) et les autres sont supprimées. Pur (sauf la
 * lecture des dossiers « old »).
 */
export function rangerOld(found: Found[], nouveau: string, src: Source): { deplacer: Array<{ de: string; vers: string }>; supprimer: Found[] } {
  const oldDir = join(dirname(nouveau), 'old');
  const deplacer = found.filter((f) => f.path !== nouveau && f.source.id === src.id).map((f) => ({ de: f.path, vers: join(oldDir, basename(f.path)), f }));
  // Ce qui sera dans « old » : ce qui y est déjà + ce qu'on y met ; on garde la version la plus récente.
  const deja: Found[] = []; try { for (const n of readdirSync(oldDir)) { const v = src.match.exec(n)?.[1]; if (v) { const p = join(oldDir, n), st = statSync(p); deja.push({ source: src, version: v, path: p, size: st.size, mtime: st.mtimeMs }); } } } catch { /* pas encore de « old » */ }
  const tous = [...deja, ...deplacer.map((d) => ({ ...d.f, path: d.vers }))].sort((a, b) => cmpVersion(b.version, a.version) || b.mtime - a.mtime);
  const garde = tous[0]?.path, supprimer = tous.filter((x) => x.path !== garde);
  // Une version qu'on allait déplacer puis supprimer : supprimée directement à sa place d'origine.
  return { deplacer: deplacer.filter((d) => d.vers === garde).map(({ de, vers }) => ({ de, vers })), supprimer: supprimer.map((x) => deplacer.find((d) => d.vers === x.path)?.f ?? x) };
}
export const sizeText = (n?: number) => (n === undefined ? '—' : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} Go` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);
export const sha256File = (p: string) => new Promise<string>((ok, ko) => { const h = createHash('sha256'); createReadStream(p).on('data', (c) => h.update(c)).on('end', () => ok(h.digest('hex'))).on('error', ko); });
/** Un pavé de couleur avec les initiales (quand l'icône de l'éditeur n'est pas disponible). */
export function monogram(name: string, color: string): string {
  const t = name.replace(/\(.*\)/, '').split(/[\s-]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase().replace(/[<&"]/g, '');
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="${/^#[0-9a-f]{6}$/i.test(color) ? color : '#6B7280'}"/><text x="20" y="26" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">${t}</text></svg>`).toString('base64')}`;
}

/** Un nom de fichier que Windows détournerait : flux caché (« a:b »), caractère interdit, nom réservé (CON, NUL, COM1…),
 *  point ou espace final. Pur. */
export const nomDetourne = (n: string): boolean => /[<>:"|?*\u0000-\u001f]/.test(n) || /[. ]$/.test(n) || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i.test(n);
/** Une adresse d'où une source officielle peut télécharger : https, et un site public (jamais la machine d'Odin, une
 *  adresse de la maison, un nom local, ni les métadonnées d'un hébergeur). Lève une erreur claire. Pur. */
export function adresseOfficielle(raw: string): URL {
  let u: URL; try { u = new URL(raw); } catch { throw new Error('adresse de téléchargement refusée : illisible'); }
  if (u.protocol !== 'https:') throw new Error(`adresse de téléchargement refusée : https seulement (reçu ${u.protocol.replace(/:$/, '')})`);
  if (u.username || u.password) throw new Error('adresse de téléchargement refusée : identifiants dans l\'adresse');
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || hoteInterdit(h) || isPrivateHost(h) || (!isIP(h) && !h.includes('.'))) throw new Error(`adresse de téléchargement refusée : ${h || '?'} n'est pas un site public (machine d'Odin, maison ou nom local)`);
  return u;
}
/** La résolution DNS du système : un nom public qui mène à une adresse de la maison est refusé aussi. */
export const RESOLUTION_SYSTEME = async (h: string): Promise<string[]> => (await lookup(h, { all: true })).map((a) => a.address);
export async function hotePublic(u: URL, resoudre?: (h: string) => Promise<string[]>): Promise<void> {
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase(); if (!resoudre || isIP(h)) return;
  let l: string[]; try { l = await resoudre(h); } catch { throw new Error(`adresse de téléchargement refusée : ${h} ne se résout pas`); }
  if (!l.length || l.some((a) => hoteInterdit(a) || isPrivateHost(a))) throw new Error(`adresse de téléchargement refusée : ${h} mène à une adresse de la maison ou de la machine`);
}

/** Télécharge en reprenant un fichier entamé, en calculant l'empreinte au fil de l'eau, avec un débit maximum.
 *  `surete` (sources officielles) : https et site public seulement, chaque redirection revérifiée avant d'être suivie.
 *  `surete.lienTape` : le premier lien a été tapé par le propriétaire et vérifié par l'appelant (il peut être en http,
 *  ou de la maison avec son accord) ; les redirections, elles, restent revérifiées comme celles d'un site officiel. */
export async function download(fetchFn: (u: string, i?: RequestInit) => Promise<Response>, r: Release, dir: string, o: { signal?: AbortSignal; rate?: number; progress?: (done: number, total?: number) => void; /** avant d'écrire le moindre octet : peut refuser (ex. pas assez de place) */ avant?: (reste: number | undefined) => void; surete?: { resoudre?: (h: string) => Promise<string[]>; lienTape?: boolean } } = {}): Promise<{ path: string; size: number; sha256: string; checked: boolean }> {
  const name = basename(r.file); if (!name || name !== r.file.split('/').pop() || /[\\/]|^\.\.?$/.test(name) || nomDetourne(name)) throw new Error('nom de fichier invalide');
  if (o.surete && !o.surete.lienTape) await hotePublic(adresseOfficielle(r.url), o.surete.resoudre);
  mkdirSync(dir, { recursive: true });
  const part = join(dir, `.${name}.part`), final = join(dir, name), h = createHash('sha256');
  let have = existsSync(part) ? statSync(part).size : 0;
  if (have) await new Promise<void>((ok, ko) => createReadStream(part).on('data', (c) => h.update(c)).on('end', ok).on('error', ko));
  const init = (): RequestInit => ({ headers: { 'user-agent': 'Odin-Eitri/1', ...(have ? { range: `bytes=${have}-` } : {}) }, signal: o.signal, redirect: o.surete ? 'manual' : 'follow' });
  let res = await fetchFn(r.url, init());
  // Une source officielle : chaque redirection (miroir) est revérifiée avant d'être suivie, jamais vers la maison ni en http.
  for (let k = 0, url = r.url; o.surete && res.status >= 300 && res.status < 400; k++) {
    const loc = res.headers.get('location'); await res.body?.cancel().catch(() => {});
    if (!loc || k >= 10) throw new Error(k >= 10 ? 'trop de redirections' : `le site répond ${res.status} sans adresse`);
    const u = adresseOfficielle(new URL(loc, url).toString()); await hotePublic(u, o.surete.resoudre);
    url = u.toString(); res = await fetchFn(url, init());
  }
  if (have && res.status === 200) { have = 0; h.destroy(); await res.body?.cancel().catch(() => {}); return download(fetchFn, r, (rmSync(part, { force: true }), dir), o); } // le serveur ne sait pas reprendre
  if (!res.ok && res.status !== 206) throw new Error(`le site répond ${res.status}`);
  const total = (Number(res.headers.get('content-length')) || 0) + have || r.size;
  // Refuser AVANT d'écrire (disque plein…), jamais au milieu : ce qui reste à recevoir est connu maintenant.
  if (o.avant) { try { o.avant(total ? Math.max(0, total - have) : undefined); } catch (e) { await res.body?.cancel().catch(() => {}); throw e; } }
  const fh = await open(part, have ? 'a' : 'w'); let done = have, ko: unknown; const t0 = Date.now();
  try {
    const reader = res.body!.getReader();
    // Délai d'inactivité : si plus rien n'arrive pendant 2 min, on coupe au lieu de bloquer sans fin.
    const lire = () => { let m: ReturnType<typeof setTimeout>; return Promise.race([reader.read(), new Promise<never>((_, ko) => { m = setTimeout(() => { reader.cancel().catch(() => {}); ko(new Error('téléchargement interrompu : plus rien reçu depuis 2 min')); }, 120_000); })]).finally(() => clearTimeout(m!)); };
    for (;;) {
      const { done: end, value } = await lire(); if (end) break;
      h.update(value); await fh.write(value); done += value.length; o.progress?.(done, total);
      // Débit maximum (Mo/s) : on attend ce qu'il faut.
      if (o.rate) { const ahead = (done - have) / (o.rate * 1024 * 1024) * 1000 - (Date.now() - t0); if (ahead > 20) await new Promise((w) => setTimeout(w, Math.min(ahead, 2000))); }
    }
  } catch (e) { ko = e; } finally { await fh.close(); }
  if (ko) {
    // Disque plein au milieu : le morceau entamé est effacé (sinon le disque reste plein), et rien n'est marqué prêt.
    if ((ko as { code?: string }).code === 'ENOSPC') { rmSync(part, { force: true }); throw Object.assign(new Error('le disque est plein : le morceau entamé a été effacé, rien n\'est gardé. Fais de la place puis relance.'), { code: 'PLACE' }); }
    throw ko;
  }
  const sum = h.digest('hex');
  if (r.sha256 && sum !== r.sha256.toLowerCase()) { rmSync(part, { force: true }); throw Object.assign(new Error(`empreinte fausse : attendu ${r.sha256.slice(0, 16)}…, reçu ${sum.slice(0, 16)}…`), { code: 'SHA' }); }
  renameSync(part, final);
  return { path: final, size: done, sha256: sum, checked: !!r.sha256 };
}

// ---------------- La file de téléchargement (un à la fois) ----------------
/** La place libre sur le disque d'un dossier (octets), ou rien si elle ne se lit pas. Remplaçable pour les essais. */
export const espaceDisque = { libre(dir: string): number | undefined { try { const f = statfsSync(dir); const n = Number(f.bavail) * Number(f.bsize); return Number.isFinite(n) ? n : undefined; } catch { return undefined; } } };
/** Ce qu'on laisse toujours libre en plus du fichier (le disque ne finit jamais plein à ras). */
export const MARGE_DISQUE = 512 * 1024 ** 2;
/** Un téléchargement qui attend son tour : une source du catalogue et une version publiée par l'éditeur. */
export interface ElementFile { source: string; nom: string; version: string; taille?: number; ajoute: number }
export const FILE_MAX = 20;
/** Une version du dossier correspond-elle à celle du catalogue ? (« 42-1.1 » est la 42 publiée sous ce nom.) Pur. */
export const memeVersion = (present: string, voulue: string): boolean => present === voulue || present.startsWith(`${voulue}-`) || present.startsWith(`${voulue}.`);
/** Une version telle qu'elle arrive d'une page : du texte court, sans chemin ni caractère étrange ; sinon ''. Pur. */
export const versionPropre = (x: unknown): string => { const t = typeof x === 'string' ? x.trim() : ''; return t.length <= 60 && /^[\w.+~-]+$/.test(t) ? t : ''; };
/** La file telle que gardée dans les réglages, relue avec méfiance (forme, doublons, longueur). Pur. */
export function fileRevue(x: unknown): ElementFile[] {
  const out: ElementFile[] = [], vus = new Set<string>();
  for (const e of Array.isArray(x) ? x : []) {
    if (!e || typeof e !== 'object') continue; const o = e as Record<string, unknown>, src = typeof o.source === 'string' ? o.source.slice(0, 120) : '', v = versionPropre(o.version);
    if (!src || !v || vus.has(`${src}\n${v}`)) continue; vus.add(`${src}\n${v}`);
    out.push({ source: src, nom: typeof o.nom === 'string' ? o.nom.slice(0, 120) : src, version: v, ...(Number(o.taille) > 0 ? { taille: Number(o.taille) } : {}), ajoute: Number(o.ajoute) || 0 });
    if (out.length >= FILE_MAX) break;
  }
  return out;
}
/** Pas assez de place : le texte du refus, ou rien. `besoin` : ce qui reste à recevoir ; `retenu` : ce que la file réserve déjà. Pur. */
export function refusPlace(besoin: number | undefined, libre: number | undefined, retenu = 0): string | undefined {
  if (!besoin || libre === undefined) return undefined;
  return libre - retenu < besoin + MARGE_DISQUE ? `pas assez de place sur le disque : il faut ${sizeText(besoin + MARGE_DISQUE)} (fichier et marge), il reste ${sizeText(Math.max(0, libre - retenu))}${retenu ? ' en comptant la file' : ''}. Rien n'a été téléchargé.` : undefined;
}

// ---------------- L'appli ----------------
export interface ForgeOpts {
  id: string; name: string; kind: Kind; noun: string; nouns: string; from: string[]; upstream: string[]; words: string[];
  sources: Source[]; defaultDir: string; what: string; extraDoes?: string[];
  /** Après un téléchargement réussi (ex. l'antivirus pour les logiciels). Rend un motif pour mettre de côté. */
  after?: (ctx: ModCtx, path: string, src: Source, rel?: Release & { checked?: boolean; sha?: string }) => Promise<string | undefined>;
  /**
   * Les anciennes versions vont dans un sous-dossier « old » à côté de la nouvelle (une seule ancienne gardée par
   * source, la plus vieille est supprimée), au lieu de garder N versions côte à côte. `deplace` est prévenu de
   * chaque déplacement (`vers` vide : fichier supprimé) pour que ceux qui s'en servent suivent (Hydre).
   */
  old?: { deplace?: (ctx: ModCtx, l: Array<{ de: string; vers: string; nouveau: string }>) => Promise<void> };
  /** La bibliothèque du dossier (fiches : antivirus, empreinte, système…), pour l'onglet « Disponibles ». */
  bibliotheque?: (ctx: ModCtx) => Promise<Fiche[]>;
  /** La surveillance (chaque mois par défaut) : son réglage en clair et le prochain passage. */
  surveillance?: (ctx: ModCtx) => Promise<{ texte: string; prochaine?: string }>;
  /** Des sections de plus dans l'onglet « Réglages » (vérification planifiée, import…). */
  reglages?: (ctx: ModCtx) => Promise<Section[]> | Section[];
  /** L'action qui montre la fiche d'un fichier de la bibliothèque (réglage `nom` : son identifiant). */
  fiche?: { action: string; module?: string };
}

export function forgeModule(o: ForgeOpts): Module & { _jobs: () => Job[]; _cycle: (ctx: ModCtx, why: string) => Promise<string>; _file: () => Promise<void> } {
  const jobs = new Map<string, Job>(); let running = false;
  const icons = new Map<string, string>();
  const root = (ctx: ModCtx) => s(ctx.settings.dossier) || join(ctx.home, o.defaultDir);
  const plan = (ctx: ModCtx): Plan => ({ days: [5], at: '03:00', auto: true, ...(ctx.settings.plan as Partial<Plan> | undefined) });
  const keep = (ctx: ModCtx) => Math.max(1, Math.min(5, Number(ctx.settings.garder) || 2));
  const customs = (ctx: ModCtx) => ((ctx.settings.customs as Custom[] | undefined) ?? []).map((c) => customSource({ ...c, kind: o.kind }));
  /** Les applications venues d'un index en ligne (Homebrew) et mises en surveillance : suivies comme le catalogue. */
  const enLigne = (ctx: ModCtx) => ((ctx.settings.homebrew as SuiviHomebrew[] | undefined) ?? []).flatMap((x) => { try { return [sourceHomebrew(x)]; } catch { return []; } });
  const all = (ctx: ModCtx) => [...o.sources, ...customs(ctx), ...enLigne(ctx)];
  /** Ce que tu as retiré de la surveillance : plus vérifié, même si un fichier est dans le dossier. */
  const ignores = (ctx: ModCtx) => new Set((ctx.settings.ignores as string[] | undefined) ?? []);
  /** La dernière version vue de chaque source (gardée : sert au Store, aux Disponibles et aux Surveillés). */
  const vues = (ctx: ModCtx): Record<string, Vue> => (ctx.settings.vues as Record<string, Vue> | undefined) ?? {};
  const noterVue = (ctx: ModCtx, id: string, v: Vue) => { const l = { ...vues(ctx), [id]: v }; ctx.saveSettings({ vues: l }); };
  const followed = (ctx: ModCtx) => new Set((ctx.settings.suivis as string[] | undefined) ?? []);
  // Le nom exact (ou l'identifiant) d'abord. Un MORCEAU de nom (« serv », « linux », « windows ») ne vaut que s'il ne
  // désigne qu'un seul ; plusieurs : Odin demande lequel et rien ne part (jamais « le premier venu » : une phrase dite
  // ne lance pas le téléchargement d'un autre système que celui voulu).
  const byName = (ctx: ModCtx, q: unknown) => {
    const t = s(q).trim().toLowerCase(), l = all(ctx);
    const x = l.find((y) => y.id === t || y.name.toLowerCase() === t); if (x) return x;
    const m = t.length >= 3 ? l.filter((y) => y.name.toLowerCase().includes(t)) : [];
    if (m.length === 1) return m[0];
    if (m.length > 1) throw new Error(`plusieurs ${o.nouns} conviennent pour « ${s(q).slice(0, 60)} » : ${m.slice(0, 6).map((y) => `« ${y.name} »`).join(', ')}${m.length > 6 ? '…' : ''}. Lequel ? Redis-le avec son nom entier. Rien n'est fait.`);
    throw new Error(`${o.noun} inconnu : « ${s(q)} » (voir le catalogue)`);
  };
  /** Les autres du même nom de famille (« debian » : aussi « Debian (DVD complet) ») : dits après coup, pour ne pas se tromper de variante. */
  const memeFamille = (ctx: ModCtx, q: unknown, x: Source): string => {
    if (s(q).trim().toLowerCase() !== x.id) return '';
    const f = all(ctx).filter((y) => y.id !== x.id && y.kind === x.kind && y.id.startsWith(`${x.id}-`));
    return f.length ? `\nℹ C'est « ${x.name} » qui est pris. Il existe aussi : ${f.slice(0, 4).map((y) => `« ${y.name} »`).join(', ')} — dis son nom entier pour celui-là (et « arrête le téléchargement » si ce n'était pas le bon).` : '';
  };
  // L'historique : dans la base d'Odin dès qu'elle est prête (journal « forge_<appli> »), sinon historique.jsonl.
  const hj = (ctx: ModCtx) => journalDe<Event>(ctx, `forge_${basename(ctx.dir)}`, 'historique.jsonl', { garder: 2000 });
  const log = (ctx: ModCtx, e: Omit<Event, 'at'>) => { try { hj(ctx).ajouter({ at: Date.now(), ...e } as Event); } catch { /* disque plein */ } };
  const history = (ctx: ModCtx, n = 200): Event[] => hj(ctx).tout().slice(-n).reverse();
  const latestCache = new Map<string, { at: number; r?: Release; err?: string }>();
  const getLatest = async (ctx: ModCtx, src: Source, fresh = false): Promise<Release> => {
    const c = latestCache.get(src.id); if (!fresh && c && Date.now() - c.at < 3600_000) { if (c.r) return c.r; throw new Error(c.err); }
    if (!src.latest) throw new Error(src.manual ?? 'pas de source officielle automatique');
    try {
      const r = await src.latest(ctx.fetch as never, ctx.settings); latestCache.set(src.id, { at: Date.now(), r });
      const avant = vues(ctx)[src.id];
      noterVue(ctx, src.id, { version: r.version, at: Date.now(), ...(r.size ?? (avant?.version === r.version ? avant.taille : undefined) ? { taille: r.size ?? avant!.taille } : {}), ...(r.sha256 ? { sha256: r.sha256.toLowerCase() } : {}), url: r.url });
      return r;
    } catch (e) { latestCache.set(src.id, { at: Date.now(), err: (e as Error).message }); const avant = vues(ctx)[src.id]; if (!src.manual) noterVue(ctx, src.id, { ...(avant ?? { version: '' }), at: Date.now(), erreur: (e as Error).message.slice(0, 160) }); throw e; }
  };
  /** La taille d'un fichier annoncée par le site (demande d'en-têtes seulement) ; rien si le site ne la donne pas. */
  const tailleDe = async (ctx: ModCtx, url: string): Promise<number | undefined> => { try { const r = await ctx.fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Odin-Eitri/1' } }); const n = Number(r.headers.get('content-length')); return r.ok && n > 0 ? n : undefined; } catch { return undefined; } };
  /** Relit la dernière version (et la taille) de ces sources sur leurs sites officiels, six à la fois ; une source en panne n'arrête pas les autres. */
  const actualiser = async (ctx: ModCtx, l: Source[]): Promise<void> => {
    const file = l.filter((x) => x.latest); let k = 0;
    await Promise.all(Array.from({ length: Math.min(6, file.length) }, async () => { for (;;) { const src = file[k++]; if (!src) return; try { const r = await getLatest(ctx, src, true); if (!vues(ctx)[src.id]?.taille) { const n = r.size ?? await tailleDe(ctx, r.url); if (n) noterVue(ctx, src.id, { ...vues(ctx)[src.id], taille: n }); } } catch { /* notée dans les versions vues */ } } }));
  };
  /** Les fichiers du dossier reconnus autrement que par leur nom (empreinte de l'éditeur, contenu lu) : source → versions. Tenu à jour par « Disponibles ». */
  const reconnus = (ctx: ModCtx): Record<string, string[]> => (ctx.settings.reconnus as Record<string, string[]> | undefined) ?? {};
  /** Les versions présentes de chaque source : par le nom des fichiers, et par ce qu'Odin a reconnu autrement. */
  const presentsDe = (ctx: ModCtx, found: Found[]) => { const m = new Map<string, string[]>(); for (const x of found) m.set(x.source.id, [...(m.get(x.source.id) ?? []), x.version]); for (const [id, l] of Object.entries(reconnus(ctx))) m.set(id, [...new Set([...(m.get(id) ?? []), ...l])]); return m; };
  const tracked = (ctx: ModCtx, f: Found[]) => { const ids = followed(ctx); for (const x of f) ids.add(x.source.id); for (const x of Object.keys(reconnus(ctx))) ids.add(x); for (const x of ignores(ctx)) ids.delete(x); return all(ctx).filter((x) => ids.has(x.id)); };
  /** Les entrées du Store : tout le catalogue, avec ce qui est présent, surveillé, en cours, et la dernière version vue. */
  const catalogueStore = (ctx: ModCtx, found: Found[]): EntreeStore[] => {
    const pres = presentsDe(ctx, found), enFile = new Map<string, string[]>();
    for (const y of fileDe(ctx)) enFile.set(y.source, [...(enFile.get(y.source) ?? []), y.version]);
    const en = [...jobs.values()].map((j) => ({ source: j.source, version: j.version })), p = prepare;
    return entrees({ sources: all(ctx), presents: pres, suivis: new Set(tracked(ctx, found).map((x) => x.id)), vues: vues(ctx), enCours: new Set([...jobs.keys(), ...(p ? [p.source] : [])]), versions: Object.fromEntries(Object.entries(versionsVues(ctx)).map(([k, v]) => [k, Array.isArray(v?.liste) ? v.liste : []])), enFile, telecharge: Object.fromEntries([...en, ...(p ? [{ source: p.source, version: p.version }] : [])].map((x) => [x.source, x.version])) });
  };
  const surveiller = (ctx: ModCtx, id: string) => ctx.saveSettings({ suivis: [...new Set([...followed(ctx), id])], ignores: [...ignores(ctx)].filter((y) => y !== id) });
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

  /** Télécharge une version d'une source (la dernière, ou celle choisie dans le catalogue), puis range et fait le ménage. */
  async function fetchOne(ctx: ModCtx, src: Source, rel: Release): Promise<string> {
    const dir = join(root(ctx), src.family === 'Ajoutés par toi' ? 'Autres' : src.name.replace(/\s*\(.*\)\s*$/, '').replace(/[^\w .+-]/g, '').trim() || src.id);
    const ctrl = new AbortController(), job: Job = { source: src.id, name: src.name, file: rel.file, version: rel.version, done: 0, total: rel.size, started: Date.now(), ctrl };
    jobs.set(src.id, job);
    try {
      // Jamais un fichier non vérifié : si l'éditeur publie une empreinte pour ce fichier et qu'elle manque, rien ne part.
      if (rel.empreinteAttendue && !rel.sha256) throw Object.assign(new Error('l\'éditeur publie une empreinte pour ce fichier, mais Odin ne l\'a pas trouvée : rien n\'a été téléchargé'), { code: 'SANS_EMPREINTE' });
      // La place : refusée AVANT (taille annoncée, puis taille donnée par le site au début de la réponse), jamais au milieu.
      mkdirSync(dir, { recursive: true });
      const part = join(dir, `.${basename(rel.file)}.part`), deja = existsSync(part) ? statSync(part).size : 0;
      const place = (reste: number | undefined) => { const refus = refusPlace(reste, espaceDisque.libre(dir)); if (refus) throw Object.assign(new Error(refus), { code: 'PLACE' }); };
      if (rel.size) place(Math.max(0, rel.size - deja));
      say(ctx, 'info', `⬇ ${src.name} ${rel.version} : téléchargement`, `${rel.file}${rel.size ? ` (${sizeText(rel.size)})` : ''} depuis le site officiel.`);
      const r = await download(ctx.fetch as never, rel, dir, { signal: ctrl.signal, rate: Number(ctx.settings.debit) || undefined, progress: (d, t) => { job.done = d; job.total = t; }, avant: place,
        // Site officiel : https et site public seulement, chaque redirection revérifiée (et, sur le vrai réseau, ce à quoi le nom mène).
        surete: { ...(ctx.fetch === globalThis.fetch ? { resoudre: RESOLUTION_SYSTEME } : {}) } });
      const ms = Date.now() - job.started;
      const hold = o.after ? await o.after(ctx, r.path, src, { ...rel, checked: r.checked, sha: r.sha256 }).catch(() => undefined) : undefined;
      if (hold) { const aside = join(root(ctx), '.mis-de-cote'); mkdirSync(aside, { recursive: true }); /* déjà parti en quarantaine (Asclépios) : rien à déplacer */ if (existsSync(r.path)) renameSync(r.path, join(aside, basename(r.path))); log(ctx, { what: 'mis de côté', source: src.id, name: src.name, version: rel.version, file: rel.file, detail: hold }); say(ctx, 'critique', `${src.name} ${rel.version} mis de côté`, `L'antivirus a trouvé : ${hold}. Le fichier n'a pas remplacé l'ancienne version.`, { steps: ['Ne lance pas ce fichier', 'Regarde le détail dans Asclépios', 'Garde l\'ancienne version en attendant'] }); return `🛡 ${src.name} ${rel.version} mis de côté (antivirus : ${hold}).`; }
      log(ctx, { what: 'téléchargé', source: src.id, name: src.name, version: rel.version, file: rel.file, size: r.size, sha256: r.sha256, ms, url: rel.url, editeur: r.checked, detail: r.checked ? 'empreinte de l\'éditeur vérifiée' : 'l\'éditeur ne publie pas d\'empreinte' });
      // Ménage : seulement les N dernières versions (ou : l'ancienne dans « old », une seule gardée). Une version plus
      // ancienne choisie dans le catalogue (une plus récente est déjà là) se range à côté : rien n'est déplacé ni effacé.
      let pruned: Found[] = [];
      const plusRecente = scan(root(ctx), [src]).found.some((x) => x.path !== r.path && cmpVersion(x.version, rel.version) > 0);
      if (plusRecente) { /* rien à ranger */ } else if (o.old) {
        const r2 = rangerOld(scan(root(ctx), [src]).found, r.path, src);
        for (const m of r2.deplacer) { mkdirSync(dirname(m.vers), { recursive: true }); renameSync(m.de, m.vers); log(ctx, { what: 'rangé dans old', source: src.id, name: src.name, file: basename(m.de), detail: `remplacé par ${rel.version}` }); }
        for (const x of r2.supprimer) { rmSync(x.path, { force: true }); log(ctx, { what: 'supprimé', source: src.id, name: src.name, version: x.version, file: basename(x.path), size: x.size, detail: 'une seule ancienne version gardée (old)' }); }
        pruned = r2.supprimer;
        const l = [...r2.deplacer.map((m) => ({ de: m.de, vers: m.vers, nouveau: r.path })), ...r2.supprimer.map((x) => ({ de: x.path, vers: '', nouveau: r.path }))];
        if (l.length) await o.old.deplace?.(ctx, l).catch(() => undefined);
      } else {
        pruned = toPrune(scan(root(ctx), [src]).found, keep(ctx));
        for (const p of pruned) { rmSync(p.path, { force: true }); log(ctx, { what: 'supprimé', source: src.id, name: src.name, version: p.version, file: basename(p.path), size: p.size, detail: `on garde ${keep(ctx)} version(s)` }); }
      }
      say(ctx, 'info', `✅ ${src.name} ${rel.version} téléchargé`, `${sizeText(r.size)} en ${Math.max(1, Math.round(ms / 1000))} s · ${r.checked ? 'empreinte de l\'éditeur vérifiée' : 'sans empreinte publiée par l\'éditeur'}${pruned.length ? ` · ancienne version retirée : ${pruned.map((p) => p.version).join(', ')}` : ''}.`);
      ctx.emit('telecharge', { nom: src.name, version: rel.version, fichier: r.path });
      return `✅ ${src.name} ${rel.version} (${sizeText(r.size)})${r.checked ? ', empreinte vérifiée' : ''}${pruned.length ? ` · retiré : ${pruned.map((p) => p.version).join(', ')}` : ''}`;
    } catch (e) {
      const err = e as Error & { code?: string };
      if (ctrl.signal.aborted) { log(ctx, { what: 'échec', source: src.id, name: src.name, version: rel.version, detail: 'annulé' }); return `⏹ ${src.name} : annulé (le fichier entamé reprendra la prochaine fois).`; }
      log(ctx, { what: err.code === 'SHA' ? 'empreinte fausse' : 'échec', source: src.id, name: src.name, version: rel.version, detail: err.message });
      if (err.code === 'PLACE' || err.code === 'SANS_EMPREINTE') {
        say(ctx, 'haute', err.code === 'PLACE' ? `${src.name} ${rel.version} : pas assez de place` : `${src.name} ${rel.version} : empreinte introuvable`, err.message, { steps: err.code === 'PLACE' ? ['Fais de la place dans le dossier (ou choisis un dossier sur un autre disque)', 'Relance le téléchargement : rien n\'a été écrit'] : ['Réessaie plus tard (site de l\'éditeur en cours de mise à jour ?)', 'Ou prends une autre version'] });
        return `❌ ${src.name} ${rel.version} : ${err.message}`;
      }
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
        const have = [...(presentsDe(ctx, sc.found).get(src.id) ?? [])].sort((a, b) => cmpVersion(b, a))[0];
        let rel: Release;
        try { rel = await getLatest(ctx, src, true); } catch (e) {
          if (src.manual) { out.push(`ℹ ${src.name}${have ? ` ${have}` : ''} : ${src.manual} ${src.page}`); continue; }
          log(ctx, { what: 'échec', source: src.id, name: src.name, detail: `vérification : ${(e as Error).message}` }); out.push(`❌ ${src.name} : ${(e as Error).message}`); continue;
        }
        if (have && cmpVersion(rel.version, have) <= 0 && !force) { log(ctx, { what: 'vérifié', source: src.id, name: src.name, version: have, detail: 'à jour' }); out.push(`✔ ${src.name} ${have} : à jour`); continue; }
        log(ctx, { what: 'nouvelle version', source: src.id, name: src.name, version: rel.version, detail: have ? `tu as ${have}` : 'pas encore dans le dossier' });
        if (!plan(ctx).auto && why === 'programmé') { say(ctx, 'info', `🆕 ${src.name} ${rel.version} disponible`, have ? `Tu as ${have}.` : 'Pas encore dans ton dossier.', { fix: { action: 'telecharger', input: { nom: src.id }, label: 'Télécharger' } }); out.push(`🆕 ${src.name} ${rel.version} disponible (tu as ${have ?? 'rien'})`); continue; }
        // Le lien demandé au dernier moment (Microsoft) ; un refus de l'éditeur : la page officielle, rien n'est contourné.
        if (rel.obtenir) { try { rel = await rel.obtenir(); } catch (e) { rel = { ...rel, manuel: (e as Error).message }; } }
        if (rel.note) { say(ctx, 'info', `ℹ ${src.name} ${rel.version}`, rel.note); out.push(`ℹ ${src.name} : ${rel.note}`); }
        if (rel.manuel) { const pg = rel.page ?? src.page; log(ctx, { what: 'échec', source: src.id, name: src.name, version: rel.version, detail: `pas de lien : ${rel.manuel}` }); say(ctx, 'moyenne', `🆕 ${src.name} ${rel.version} : à prendre sur la page officielle`, `${have ? `Tu as ${have}. ` : ''}${rel.manuel} ${pg}`, { steps: ['Ouvre la page officielle', 'Télécharge l\'ISO dans la langue voulue', 'Dépose-la dans le dossier : Odin la reconnaît et vérifie l\'empreinte publiée'] }); out.push(`🆕 ${src.name} ${rel.version} disponible (tu as ${have ?? 'rien'}) : ${rel.manuel} ${pg}`); continue; }
        out.push(await fetchOne(ctx, src, rel));
      }
      ctx.saveSettings({ lastRun: Date.now() });
      return out.length ? out.join('\n') : `Rien à suivre : choisis des ${o.nouns} dans le catalogue, ou mets les tiens dans ${r0}.`;
    } finally { running = false; pomper(ctx); }
  }

  // ---------------- Plusieurs versions, et la file de téléchargement (un à la fois) ----------------
  /** Les versions lues sur le site officiel (gardées : la page les montre sans relire le site). */
  // Gardées aussi en mémoire : chaque action a sa copie des réglages, la file et les versions lues restent les mêmes pour toutes.
  // (une mémoire par dossier de l'appli : deux Odin dans le même processus, comme dans les essais, ne se mélangent pas)
  const memoires = new Map<string, { file?: ElementFile[]; vv: Record<string, { at: number; liste: VersionCatalogue[] }>; vc: Map<string, { at: number; l: Release[] }> }>();
  const memoire = (ctx: ModCtx) => { let m = memoires.get(ctx.dir); if (!m) { m = { vv: {}, vc: new Map() }; memoires.set(ctx.dir, m); } return m; };
  const versionsVues = (ctx: ModCtx): Record<string, { at: number; liste: VersionCatalogue[] }> => {
    const v = ctx.settings.versionsVues; return { ...(v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, { at: number; liste: VersionCatalogue[] }> : {}), ...memoire(ctx).vv };
  };
  /** Les versions publiées d'une source (une par série), lues sur son site officiel ; gardées une heure. */
  const versionsLues = async (ctx: ModCtx, src: Source, fresh = false): Promise<Release[]> => {
    const c = memoire(ctx).vc.get(src.id); if (!fresh && c && Date.now() - c.at < 3600_000) return c.l;
    const l = await versionsDe(ctx.fetch as never, src, ctx.settings);
    memoire(ctx).vc.set(src.id, { at: Date.now(), l });
    memoire(ctx).vv[src.id] = { at: Date.now(), liste: canauxDe(src, l) };
    ctx.saveSettings({ versionsVues: versionsVues(ctx) });
    return l;
  };
  const fileDe = (ctx: ModCtx): ElementFile[] => { const m = memoire(ctx); return (m.file ??= fileRevue(ctx.settings.file)); };
  const ecrireFile = (ctx: ModCtx, l: ElementFile[]) => { memoire(ctx).file = l; ctx.saveSettings({ file: l }); };
  /** Celui qu'on prépare (lien et empreinte lus sur le site) avant que le téléchargement commence. */
  let prepare: ElementFile | undefined;
  /** « Arrêter » pendant la préparation : rien ne part ensuite. */
  let prepareArrete = false;
  let pompe: Promise<void> | undefined;
  /** Les versions présentes d'une source (dans le dossier, ou reconnues autrement). */
  const versionsPresentes = (ctx: ModCtx, id: string) => presentsDe(ctx, scan(root(ctx), all(ctx), true).found).get(id) ?? [];
  /** Télécharge UNE version choisie : seulement une version publiée par le site officiel de la source (jamais une adresse reçue). */
  async function telechargerVersion(ctx: ModCtx, x: ElementFile): Promise<string> {
    const src = all(ctx).find((y) => y.id === x.source); if (!src) return `❌ ${x.nom} : n'est plus au catalogue.`;
    if (src.manual) return `ℹ ${src.name} : ${src.manual} ${src.page}`;
    if (versionsPresentes(ctx, src.id).some((p) => memeVersion(p, x.version))) return `✔ ${src.name} ${x.version} : déjà dans ton dossier.`;
    let rel: Release | undefined;
    // La version telle que listée (« 42 ») ou telle que publiée sous son nom complet (« 42-1.1 », la dernière lue autrement).
    try { const l = await versionsLues(ctx, src); rel = l.find((r) => r.version === x.version) ?? l.find((r) => memeVersion(x.version, r.version)); } catch (e) { log(ctx, { what: 'échec', source: src.id, name: src.name, version: x.version, detail: `vérification : ${(e as Error).message}` }); return `❌ ${src.name} : ${(e as Error).message}`; }
    if (!rel) return `❌ ${src.name} ${x.version} : cette version n'est plus publiée sur le site officiel.`;
    if (rel.obtenir) { try { rel = await rel.obtenir(); } catch (e) { rel = { ...rel, manuel: (e as Error).message }; } }
    if (rel.manuel) { const pg = rel.page ?? src.page; log(ctx, { what: 'échec', source: src.id, name: src.name, version: x.version, detail: `pas de lien : ${rel.manuel}` }); return `🆕 ${src.name} ${x.version} : ${rel.manuel} ${pg}`; }
    if (!memeVersion(rel.version, x.version) && !memeVersion(x.version, rel.version)) return `❌ ${src.name} ${x.version} : le site officiel ne donne plus cette version.`;
    // Arrêté pendant la préparation (lien et empreinte en lecture) : rien ne part.
    if (prepareArrete) { log(ctx, { what: 'échec', source: src.id, name: src.name, version: x.version, detail: 'annulé avant le début' }); return `⏹ ${src.name} ${x.version} : arrêté avant le début, rien n'a été téléchargé.`; }
    surveiller(ctx, src.id);
    return fetchOne(ctx, src, rel);
  }
  /** Lance le suivant de la file s'il n'y a rien en cours (un seul téléchargement à la fois). Ne bloque pas. */
  function pomper(ctx: ModCtx): Promise<void> {
    if (pompe) return pompe;
    if (running || !fileDe(ctx).length) return Promise.resolve();
    pompe = (async () => {
      try {
        for (;;) {
          if (running) return;
          const l = fileDe(ctx), x = l[0]; if (!x) return;
          running = true; prepare = x; prepareArrete = false; ecrireFile(ctx, l.slice(1));
          let t: string;
          try { t = await telechargerVersion(ctx, x); } catch (e) { t = `❌ ${x.nom} ${x.version} : ${(e as Error).message}`; } finally { prepare = undefined; prepareArrete = false; running = false; }
          if (/^(❌|🆕|ℹ)/u.test(t)) say(ctx, 'moyenne', `${x.nom} ${x.version} : pas téléchargé`, t.replace(/^\S+\s*/u, ''));
        }
      } finally { pompe = undefined; }
    })();
    return pompe;
  }
  /** Ce qui se télécharge et ce qui attend : pour la page. */
  const etatFile = (ctx: ModCtx) => {
    const j = [...jobs.values()][0];
    const enCours = j ? { source: j.source, nom: j.name, version: j.version, recu: j.done, ...(j.total ? { total: j.total, pct: Math.min(100, Math.round((j.done / j.total) * 100)) } : {}) } : prepare ? { source: prepare.source, nom: prepare.nom, version: prepare.version, recu: 0, prepare: true } : undefined;
    return { ...(enCours ? { enCours } : {}), file: fileDe(ctx) };
  };
  /** Ajoute une version à la file (vérifiée avant : déjà là, déjà en file, place sur le disque), puis lance la file. */
  function ajouterALaFile(ctx: ModCtx, src: Source, version: string, taille?: number): { ok: boolean; text: string; data: ReturnType<typeof etatFile> } {
    const l = fileDe(ctx), j = jobs.get(src.id), nom = `${src.name} ${version}`;
    const non = (text: string) => ({ ok: false, text, data: etatFile(ctx) });
    if (versionsPresentes(ctx, src.id).some((p) => memeVersion(p, version))) return non(`${nom} est déjà dans ton dossier.`);
    if ((j && j.version === version) || (prepare && prepare.source === src.id && prepare.version === version)) return non(`${nom} se télécharge déjà.`);
    if (l.some((y) => y.source === src.id && y.version === version)) return non(`${nom} est déjà dans la file.`);
    if (l.length >= FILE_MAX) return non(`La file est pleine (${FILE_MAX}) : attends qu'elle avance.`);
    // La place, avant : ce fichier, plus ce que la file et le téléchargement en cours vont encore prendre.
    const retenu = l.reduce((n, y) => n + (y.taille ?? 0), 0) + [...jobs.values()].reduce((n, y) => n + Math.max(0, (y.total ?? 0) - y.done), 0);
    mkdirSync(root(ctx), { recursive: true });
    const refus = refusPlace(taille, espaceDisque.libre(root(ctx)), retenu); if (refus) return non(`${nom} : ${refus}`);
    const avant = l[l.length - 1] ?? (j ? { nom: j.name, version: j.version } : prepare);
    ecrireFile(ctx, [...l, { source: src.id, nom: src.name, version, ...(taille ? { taille } : {}), ajoute: Date.now() }]);
    surveiller(ctx, src.id);
    void pomper(ctx);
    return { ok: true, text: avant ? `⏳ ${nom} attend son tour (après ${avant.nom} ${avant.version}) : un téléchargement à la fois.` : `⬇ ${nom} : téléchargement lancé depuis le site officiel.`, data: etatFile(ctx) };
  }

  // ---------------- Disponibles et Surveillés (les mêmes données pour les actions, la page et le Store) ----------------
  interface Disponible { id: string; nom: string; chemin: string; taille: number; icone: string; antivirus: string; ancienne: boolean; catalogue?: string; source?: string; versionReconnue?: string; par?: string; derniere?: string; etat: string; manuel?: boolean }
  /** Ce qui est dans le dossier, comparé au catalogue : nom du fichier, empreinte de l'éditeur, ce qui est lu dans le fichier. */
  async function disponibles(ctx: ModCtx): Promise<Disponible[]> {
    const sc = scan(root(ctx), all(ctx)), V = vues(ctx), S = all(ctx);
    const fiches: Fiche[] = o.bibliotheque ? await o.bibliotheque(ctx).catch(() => [] as Fiche[]) : sc.found.map((x) => ({ id: x.path, nom: basename(x.path), chemin: x.path, taille: x.size, ajoute: x.mtime, origine: 'déposée' as const }));
    const autres: Record<string, string[]> = {};
    const l = fiches.map((x) => {
      const r = x.ancienne ? { ...reconnaitre(x, S, V), etat: 'ancienne version (old)' } : reconnaitre(x, S, V), m = r.source ? metaDe(r.source) : undefined;
      return { id: x.id, nom: x.nom, chemin: x.chemin, taille: x.taille, icone: x.icone ?? iconeDe(o.kind, { systeme: x.systeme ?? m?.systeme ?? 'Autre', nom: x.detail ?? x.nom, type: m?.type ?? '' }), antivirus: x.antivirus?.verdict ?? 'non analysé', ancienne: Boolean(x.ancienne),
        ...(r.source ? { catalogue: r.source.name, source: r.source.id, ...(r.source.manual ? { manuel: true } : {}) } : {}), ...(r.version ? { versionReconnue: r.version } : {}), ...(r.par ? { par: r.par } : {}), ...(r.derniere ? { derniere: r.derniere } : {}), etat: r.etat };
    });
    // Un fichier renommé mais reconnu (empreinte, contenu) est surveillé comme les autres : sa source et sa version sont retenues.
    for (const x of fiches) { if (x.ancienne) continue; const r = reconnaitre(x, S, V); if (r.source && r.par !== 'nom' && r.version) autres[r.source.id] = [...new Set([...(autres[r.source.id] ?? []), r.version])]; }
    if (JSON.stringify(autres) !== JSON.stringify(reconnus(ctx))) ctx.saveSettings({ reconnus: autres });
    return l;
  }
  /** Ce qui est surveillé : versions présentes, dernière version vue, téléchargement en cours, prochaine vérification. */
  async function surveilles(ctx: ModCtx): Promise<{ texte: string; prochaine?: string; surveilles: Array<{ id: string; nom: string; icone: string; famille: string; presents: string[]; derniere?: string; vuLe?: number; erreur?: string; etat: string; manuel?: string; enCours?: { recu: number; total?: number; pct?: number } }> }> {
    const sc = scan(root(ctx), all(ctx)), V = vues(ctx), now = new Date(), p = plan(ctx);
    const surv = !ctx.settings.plan && o.surveillance ? await o.surveillance(ctx).catch(() => undefined) : undefined;
    const prochain = surv?.prochaine ? new Date(surv.prochaine) : nextRun(p, now);
    const texte = surv?.texte ?? `Vérification ${p.date ? `le ${p.date}` : p.days.length === 7 ? 'tous les jours' : `chaque ${p.days.map((d) => JOURS[d]).join(', ')}`} à ${p.at}${p.auto ? '' : ' (prévenir seulement)'}.`;
    return { texte, ...(prochain ? { prochaine: prochain.toISOString() } : {}), surveilles: tracked(ctx, sc.found).map((src) => {
      const la = [...(presentsDe(ctx, sc.found).get(src.id) ?? [])].sort((a, b) => cmpVersion(b, a)), v = V[src.id], j = jobs.get(src.id), m = metaDe(src), derniere = v?.version || undefined;
      const etat = j ? 'en cours' : src.manual ? 'manuel' : derniere && (!la[0] || cmpVersion(derniere, la[0]) > 0) ? `nouvelle version ${derniere}` : la[0] ? (derniere ? 'à jour' : 'pas encore vérifié') : 'pas encore téléchargé';
      return { id: src.id, nom: src.name, icone: iconeDe(o.kind, { systeme: m.systeme, nom: src.name, type: m.type }), famille: src.family, presents: la, ...(derniere ? { derniere, vuLe: v!.at } : {}), ...(v?.erreur ? { erreur: v.erreur } : {}), etat, ...(src.manual ? { manuel: src.manual } : {}),
        ...(j ? { enCours: { recu: j.done, ...(j.total ? { total: j.total, pct: Math.min(100, Math.round((j.done / j.total) * 100)) } : {}) } } : {}) };
    }) };
  }

  // Par la parole (maquette « Systèmes », lot S11) : « télécharge la dernière Debian », dans les langues que Logos comprend.
  // « Télécharger » prend déjà la dernière version publiée : « la dernière » n'ajoute aucun réglage, seulement des mots
  // compris. Pour les ISO seulement (Andromède) ; des expressions entières, jamais un verbe seul (il compterait pour
  // toutes les phrases qui commencent par lui, et ôterait à une autre appli le verbe qu'elle est seule à porter).
  const MOTS_TELECHARGER_DITS = o.kind !== 'iso' ? [] : ['télécharge la dernière', 'télécharge le dernier', 'télécharge la dernière version', 'récupère la dernière', 'récupère le dernier',
    'download the latest', 'download the latest version', 'get the latest',
    'descarga la última', 'descarga el último', 'descarga la última versión', 'bájate la última', 'bájate el último',
    'lade das neueste', 'lade die neueste', 'lade den neuesten', 'lade die neueste version', 'lade das neueste herunter'];
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
      if (dossierSysteme(abs, homedir())) throw new Error('dossier système : choisis un dossier à toi');
      mkdirSync(abs, { recursive: true }); const probe = join(abs, `.odin-${o.id}`); writeFileSync(probe, 'ok'); rmSync(probe);
      ctx.saveSettings({ dossier: abs }); const sc = scan(abs, all(ctx));
      return { text: `📁 ${o.name} range dans ${abs}. ${sc.found.length} ${o.noun}(s) reconnu(s)${sc.unknown.length ? `, ${sc.unknown.length} non reconnu(s)` : ''}.` };
    } },
    { id: 'catalogue', label: 'Catalogue', what: `Les ${o.nouns} qu'Odin sait trouver sur les sites officiels`, read: true, words: [`catalogue des ${o.nouns}`, 'catalogue'], run: (ctx) => {
      const f = followed(ctx); const fam = [...new Set(all(ctx).map((x) => x.family))];
      return { text: fam.map((g) => `${g} :\n${all(ctx).filter((x) => x.family === g).map((x) => `- ${f.has(x.id) ? '★ ' : ''}${x.name} (${x.id}) — ${x.about}${x.manual ? ' · manuel' : ''}`).join('\n')}`).join('\n') };
    } },
    { id: 'suivre', label: `Suivre`, what: `Odin garde ce ${o.noun} à jour dans le dossier`, params: [{ key: 'nom', label: o.noun[0].toUpperCase() + o.noun.slice(1), kind: 'text', required: true }], words: [`suivre un ${o.noun}`, 'suivre'], run: (ctx, i) => { const x = byName(ctx, i.nom); surveiller(ctx, x.id); return { text: `★ ${x.name} suivi${x.manual ? ` (manuel : ${x.manual})` : ' : téléchargé au prochain passage, ou tout de suite avec « Télécharger »'}.` }; }, undo: (i) => ({ action: 'ne_plus_suivre', input: { nom: i.nom }, label: 'Ne plus suivre' }) },
    { id: 'ne_plus_suivre', label: 'Ne plus suivre', what: 'Les fichiers restent dans le dossier', quick: false, params: [{ key: 'nom', label: o.noun, kind: 'text', required: true }], run: (ctx, i) => { const x = byName(ctx, i.nom); ctx.saveSettings({ suivis: [...followed(ctx)].filter((y) => y !== x.id), ignores: [...new Set([...ignores(ctx), x.id])] }); return { text: `☆ ${x.name} n'est plus suivi : Odin ne le vérifie plus (s'il est dans le dossier, il reste reconnu et rien n'est effacé).` }; } },
    { id: 'verifier', label: 'Vérifier les mises à jour', what: 'Compare avec les sites officiels, sans rien télécharger', read: true, words: [`vérifie les mises à jour des ${o.nouns}`, `nouvelles versions des ${o.nouns}`], run: async (ctx) => {
      const sc = scan(root(ctx), all(ctx)), list = tracked(ctx, sc.found); if (!list.length) return { text: `Rien de suivi pour l'instant.` };
      const lines = await Promise.all(list.map(async (src) => { const have = sc.found.filter((f) => f.source.id === src.id).map((f) => f.version).sort(cmpVersion).pop(); try { const r = await getLatest(ctx, src, true); return `${have && cmpVersion(r.version, have) >= 0 && cmpVersion(r.version, have) === 0 ? '✔' : '🆕'} ${src.name} : ${have ?? 'rien'} → ${r.version}`; } catch (e) { return src.manual ? `ℹ ${src.name} ${have ?? ''} : manuel (${src.page})` : `❌ ${src.name} : ${(e as Error).message}`; } }));
      return { text: lines.join('\n') };
    } },
    { id: 'mettre_a_jour', label: 'Tout mettre à jour', what: 'Vérifie et télécharge maintenant tout ce qui est nouveau', words: [`mets à jour les ${o.nouns}`, `mettre à jour les ${o.nouns}`], run: async (ctx) => ({ text: await cycle(ctx, 'demande') }) },
    { id: 'telecharger', label: 'Télécharger', what: `La dernière version d'un ${o.noun}, maintenant (il devient suivi) ; si un téléchargement est déjà en cours, il attend son tour dans la file`, proprietaireSeul: true, params: [{ key: 'nom', label: o.noun, kind: 'text', required: true }], words: [`télécharge un ${o.noun}`, 'télécharge', 'telecharge', ...MOTS_TELECHARGER_DITS], run: async (ctx, i) => {
      const x = byName(ctx, i.nom); if (x.manual) return { ok: false, text: `${x.name} : ${x.manual}\nPage officielle : ${x.page}\nDépose le fichier dans : ${root(ctx)}` };
      // Un seul téléchargement à la fois : s'il y en a un, celui-ci attend son tour (la dernière version publiée).
      // « debian » dit seul prend « Debian (netinst) » : la réponse le dit, et nomme les autres du même nom (DVD complet…).
      const aussi = memeFamille(ctx, i.nom, x);
      if (running || jobs.size) { let rel: Release; try { rel = await getLatest(ctx, x); } catch (e) { return { ok: false, text: `❌ ${x.name} : ${(e as Error).message}` }; } const r = ajouterALaFile(ctx, x, rel.version, rel.size ?? (vues(ctx)[x.id]?.version === rel.version ? vues(ctx)[x.id]?.taille : undefined)); return { ...r, text: `${r.text}${aussi}` }; }
      surveiller(ctx, x.id); return { text: `${await cycle(ctx, 'demande', x)}${aussi}` };
    } },
    { id: 'annuler', label: 'Arrêter le téléchargement', what: 'Le fichier entamé reprendra la prochaine fois ; la file continue avec le suivant', quick: false, proprietaireSeul: true, params: [{ key: 'nom', label: `${o.noun} (vide : tous)`, kind: 'text', default: '' }], run: (ctx, i) => {
      const tous = !s(i.nom).trim(), id = tous ? '' : byName(ctx, i.nom).id, l = [...jobs.values()].filter((j) => tous || j.source === id); l.forEach((j) => j.ctrl.abort());
      // Celui qu'on prépare (lien et empreinte en lecture) : arrêté aussi, il ne partira pas.
      const p = prepare && !prepareArrete && !jobs.has(prepare.source) && (tous || prepare.source === id) ? prepare : undefined; if (p) prepareArrete = true;
      const noms = [...l.map((j) => j.name), ...(p ? [`${p.nom} ${p.version}`] : [])];
      return { text: noms.length ? `⏹ Arrêté : ${noms.join(', ')}.` : 'Aucun téléchargement en cours.' };
    } },
    { id: 'versions', label: 'Versions publiées', what: `Les versions d'un ${o.noun} publiées sur son site officiel (une par série : la dernière, les plus anciennes), sans rien télécharger`, read: true, external: true, quick: false,
      params: [{ key: 'nom', label: o.noun, kind: 'text', required: true }, { key: 'actualiser', label: 'Relire le site officiel', kind: 'boolean', default: false }], run: async (ctx, i) => {
        const x = byName(ctx, i.nom);
        if (x.manual || !x.latest) return { ok: true, text: `${x.name} : ${x.manual ?? 'pas de source officielle automatique'} ${x.page}`, data: { id: x.id, versions: [] as VersionCatalogue[], manuel: x.manual ?? '', page: x.page, presents: versionsPresentes(ctx, x.id) } };
        let l: Release[]; try { l = await versionsLues(ctx, x, i.actualiser === true || i.actualiser === 'true'); } catch (e) { return { ok: false, text: `❌ ${x.name} : ${(e as Error).message}` }; }
        const v = canauxDe(x, l), t = vues(ctx)[x.id];
        // La taille connue de la dernière version (lue avec elle) complète la liste.
        const versions = v.map((y) => (!y.taille && t?.taille && t.version === y.version ? { ...y, taille: t.taille } : y));
        return { text: `${x.name} : ${versions.map((y) => `${y.version} (${y.canal})`).join(', ') || 'aucune version lue'}`, data: { id: x.id, versions, presents: versionsPresentes(ctx, x.id), file: fileDe(ctx).filter((y) => y.source === x.id).map((y) => y.version) } };
      } },
    { id: 'file', label: 'File de téléchargement', what: 'Ce qui se télécharge (un à la fois) et ce qui attend son tour', read: true, quick: false, run: (ctx) => {
      const e = etatFile(ctx);
      return { text: [e.enCours ? `En cours : ${e.enCours.nom} ${e.enCours.version}${'pct' in e.enCours && e.enCours.pct !== undefined ? ` (${e.enCours.pct} %)` : ''}` : 'Rien en cours.', ...e.file.map((y, k) => `${k + 1}. ${y.nom} ${y.version}${y.taille ? ` · ${sizeText(y.taille)}` : ''}`)].join('\n'), data: e };
    } },
    { id: 'mettre_en_file', label: 'Ajouter à la file de téléchargement', what: `Une version d'un ${o.noun}, publiée sur son site officiel : elle se télécharge à son tour (un à la fois), empreinte vérifiée`, quick: false, proprietaireSeul: true,
      params: [{ key: 'nom', label: o.noun, kind: 'text', required: true }, { key: 'version', label: 'Version (vide : la dernière)', kind: 'text', default: '' }], run: async (ctx, i) => {
        const x = byName(ctx, i.nom);
        if (x.manual || !x.latest) return { ok: false, text: `${x.name} est à déposer : ${x.manual ?? 'pas de téléchargement automatique'}\nPage officielle : ${x.page}\nDépose le fichier dans : ${root(ctx)}` };
        const voulue = i.version === undefined || i.version === '' ? '' : versionPropre(i.version);
        if (i.version !== undefined && i.version !== '' && !voulue) return { ok: false, text: 'Version illisible : rien n\'a été ajouté.' };
        // Seulement une version que le site officiel publie (lue ici, jamais reçue de la page avec une adresse).
        let l: Release[]; try { l = voulue ? await versionsLues(ctx, x) : [await getLatest(ctx, x)]; } catch (e) { return { ok: false, text: `❌ ${x.name} : ${(e as Error).message}` }; }
        const rel = voulue ? l.find((r) => r.version === voulue) : l[0];
        if (!rel) return { ok: false, text: `${x.name} ${voulue} : cette version n'est pas publiée sur le site officiel.` };
        const t = vues(ctx)[x.id];
        return ajouterALaFile(ctx, x, rel.version, rel.size ?? (t?.version === rel.version ? t.taille : undefined));
      } },
    { id: 'retirer_de_la_file', label: 'Retirer de la file', what: 'Retire un téléchargement qui attend son tour (rien n\'est effacé)', quick: false, proprietaireSeul: true,
      params: [{ key: 'nom', label: o.noun, kind: 'text', required: true }, { key: 'version', label: 'Version (vide : toutes)', kind: 'text', default: '' }], run: (ctx, i) => {
        if (i.version !== undefined && i.version !== '' && !versionPropre(i.version)) return { ok: false, text: 'Version illisible : rien n\'a été retiré.' };
        const x = byName(ctx, i.nom), v = versionPropre(i.version), l = fileDe(ctx), reste = l.filter((y) => !(y.source === x.id && (!v || y.version === v)));
        const j = jobs.get(x.id), p = prepare;
        if (reste.length === l.length) return { ok: false, text: (j && (!v || j.version === v)) || (p && p.source === x.id && (!v || p.version === v)) ? `${x.name} se télécharge déjà : utilise « Arrêter ».` : `${x.name}${v ? ` ${v}` : ''} n'est pas dans la file.` };
        ecrireFile(ctx, reste);
        return { text: `${x.name}${v ? ` ${v}` : ''} retiré de la file.`, data: etatFile(ctx) };
      } },
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
    // ---------------- Le Store, les Disponibles, les Surveillés ----------------
    { id: 'store', label: 'Store', what: `Ce qui se télécharge depuis les dépôts officiels : catalogue (filtre par système, famille, architecture, ${o.kind === 'iso' ? 'type' : 'catégorie'} ; recherche par nom) et, si tu le demandes, les index officiels en ligne`, read: true, external: true,
      params: [{ key: 'q', label: 'Nom', kind: 'text', default: '' }, { key: 'systeme', label: 'Système', kind: 'text', default: '' }, { key: 'famille', label: 'Famille', kind: 'text', default: '' }, { key: 'arch', label: 'Architecture', kind: 'text', default: '' }, { key: 'type', label: o.kind === 'iso' ? 'Type (bureau, serveur, utilitaire…)' : 'Catégorie', kind: 'text', default: '' }, { key: 'enligne', label: 'Chercher aussi dans les index officiels en ligne', kind: 'boolean', default: false }, { key: 'actualiser', label: 'Relire les versions sur les sites officiels', kind: 'boolean', default: false }],
      words: ['store', `store des ${o.nouns}`, `cherche un ${o.noun}`], run: async (ctx, i) => {
        const vrai = (v: unknown) => v === true || v === 'true', f = { q: s(i.q), systeme: s(i.systeme), famille: s(i.famille), arch: s(i.arch), type: s(i.type) };
        let sc = scan(root(ctx), all(ctx));
        if (vrai(i.actualiser)) { const ids = new Set(filtrer(catalogueStore(ctx, sc.found), f).map((e) => e.id)); await actualiser(ctx, all(ctx).filter((x) => ids.has(x.id))); sc = scan(root(ctx), all(ctx)); }
        const tout = catalogueStore(ctx, sc.found), local = filtrer(tout, f);
        // Les index en ligne : chacun répond ou non ; en panne, le catalogue local répond seul.
        let index: IndexEtat[] = [], dehors: EntreeStore[] = [];
        if (vrai(i.enligne) && f.q.trim()) { const r = await chercherEnLigne(ctx.fetch as never, o.kind, f.q, ctx.dir).catch((e) => ({ resultats: [] as EntreeStore[], index: [{ index: 'en ligne', ok: false, n: 0, erreur: (e as Error).message }] })); index = r.index; dehors = filtrer(r.resultats, { systeme: f.systeme, arch: f.arch }); }
        const l = [...local, ...dehors];
        const ligne = (e: EntreeStore) => `- ${e.nom}${e.version ? ` ${e.version}` : ''} · ${e.systeme} · ${e.type} · ${e.arch}${e.taille ? ` · ${sizeText(e.taille)}` : ''} · ${e.etat}${e.enLigne ? ` · ${e.famille}` : ''}`;
        return { text: [`${local.length} sur ${tout.length} au catalogue${dehors.length ? `, ${dehors.length} en ligne` : ''}.`, ...l.slice(0, 80).map(ligne), ...index.map((x) => (x.ok ? `· ${x.index} : ${x.n} résultat(s)` : `· ${x.index} : en panne (${x.erreur}) — le catalogue local répond seul`))].join('\n'), data: { entrees: l, total: tout.length, filtres: valeursFiltres(tout), index, dossier: root(ctx) } };
      } },
    { id: 'telecharger_en_ligne', label: 'Télécharger depuis un index en ligne', what: `Un ${o.noun} trouvé dans un index officiel en ligne (Homebrew, GitHub) : téléchargé par l'antivirus d'abord, puis surveillé`, external: true, proprietaireSeul: true,
      params: [{ key: 'index', label: 'Index', kind: 'select', options: ['homebrew', 'github'], required: true }, { key: 'ref', label: 'Référence (nom dans l\'index, ou propriétaire/projet)', kind: 'text', required: true }, { key: 'fichier', label: 'Fichier (GitHub)', kind: 'text', default: '' }, { key: 'version', label: 'Version (GitHub)', kind: 'text', default: '' }, { key: 'nom', label: 'Nom affiché', kind: 'text', default: '' }], run: async (ctx, i) => {
        const index = s(i.index), ref = s(i.ref).trim(), nom = s(i.nom).trim().slice(0, 60);
        if (index === 'homebrew') {
          if (o.kind !== 'logiciel') throw new Error('Homebrew ne publie que des logiciels');
          const essai = sourceHomebrew({ ref, name: nom || ref }), rel = await essai.latest!(ctx.fetch as never);
          const l = (ctx.settings.homebrew as SuiviHomebrew[] | undefined) ?? [];
          if (!l.some((x) => x.ref === ref)) ctx.saveSettings({ homebrew: [...l, { ref, name: nom || ref, ...(rel.page ? { page: rel.page } : {}) }] });
          surveiller(ctx, essai.id);
          return { text: await cycle(ctx, 'demande', all(ctx).find((x) => x.id === essai.id)!) };
        }
        if (index === 'github') {
          if (!/^[\w.-]+\/[\w.-]+$/.test(ref)) throw new Error('dépôt sous la forme proprietaire/projet');
          const motif = motifDe(s(i.fichier).trim(), s(i.version).trim()); if (!motif) throw new Error('le nom de ce fichier ne contient pas sa version : ajoute-le par « Ajouter une source officielle » en écrivant le motif toi-même');
          const base = nom || `${ref.split('/')[1]} (${(/\.([a-z0-9]+)$/i.exec(s(i.fichier))?.[1] ?? 'fichier').toLowerCase()})`, id = `perso-${base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
          const c: Custom = { id, name: base, repo: ref, pattern: motif }; customSource({ ...c, kind: o.kind });
          if (!all(ctx).some((x) => x.id === id)) ctx.saveSettings({ customs: [...((ctx.settings.customs as Custom[] | undefined) ?? []), c] });
          surveiller(ctx, id);
          return { text: await cycle(ctx, 'demande', all(ctx).find((x) => x.id === id)!) };
        }
        throw new Error('index inconnu (une application Flathub s\'installe avec Flatpak : il n\'y a pas de fichier à télécharger)');
      } },
    { id: 'disponibles', label: 'Disponibles', what: `Ce qui est déjà dans ton dossier, comparé au catalogue : de quel ${o.noun} il s'agit, et s'il existe une version plus récente`, read: true, words: [`${o.nouns} disponibles`, 'disponibles'], run: async (ctx) => {
      const l = await disponibles(ctx);
      return { text: l.map((x) => `- ${x.nom} · ${x.catalogue ? `${x.catalogue}${x.versionReconnue ? ` ${x.versionReconnue}` : ''} (reconnu par ${x.par})` : 'pas au catalogue'} · ${x.etat === 'nouvelle version' ? `nouvelle version ${x.derniere}` : x.etat}`).join('\n') || `Rien dans ${root(ctx)}.`, data: { dossier: root(ctx), fichiers: l } };
    } },
    { id: 'surveilles', label: 'Surveillés', what: `Ce qu'Odin garde à jour : dernière version vue, prochaine vérification, téléchargement en cours`, read: true, words: [`${o.nouns} surveillés`, 'surveillés', 'surveilles'], run: async (ctx) => {
      const r = await surveilles(ctx);
      return { text: [`${r.texte} Prochaine vérification : ${r.prochaine ? new Date(r.prochaine).toLocaleString('fr-FR') : 'aucune'}.`, ...r.surveilles.map((x) => `- ${x.nom} · ${x.presents.length ? `dans le dossier : ${x.presents.join(', ')}` : 'pas encore dans le dossier'} · dernière version vue : ${x.derniere ?? '—'} · ${x.enCours ? `téléchargement ${x.enCours.pct !== undefined ? `${x.enCours.pct} %` : sizeText(x.enCours.recu)}` : x.etat}`)].join('\n') || 'Rien de surveillé.', data: r };
    } },
    { id: 'tournee', quick: false, label: 'Tournée de surveillance', what: 'Vérifie tout ce qui est surveillé et télécharge ce qui est nouveau (ou te prévient, selon ton réglage) : c\'est ce que fait la surveillance, chaque mois par défaut', run: async (ctx) => ({ text: await cycle(ctx, 'programmé') }) },
    { id: 'historique', label: 'Historique', what: 'Tout ce qui s\'est passé : vérifications, téléchargements, remplacements, échecs', read: true, words: [`historique des ${o.nouns}`, 'historique des téléchargements'], params: [{ key: 'n', label: 'Combien', kind: 'number', default: 30 }], run: (ctx, i) => ({ text: history(ctx, Math.max(1, Math.min(500, Number(i.n) || 30))).map((e) => `- ${new Date(e.at).toLocaleString('fr-FR')} · ${e.what} · ${e.name}${e.version ? ` ${e.version}` : ''}${e.size ? ` · ${sizeText(e.size)}` : ''}${e.detail ? ` · ${e.detail}` : ''}`).join('\n') || 'Rien pour l\'instant.' }) },
  ];

  const mod: Module & { _jobs: () => Job[]; _cycle: (ctx: ModCtx, why: string) => Promise<string>; _file: () => Promise<void> } = {
    id: o.id, name: o.name, family: 'Données', what: o.what,
    does: [`reconnaît les ${o.nouns} déjà dans ton dossier (disque ou partage réseau monté)`, 'télécharge depuis les sites officiels seulement, empreinte de l\'éditeur vérifiée, reprise si coupure, débit maximum', 'vérifie aux jours et à l\'heure que tu programmes (ou à une date) ; télécharge tout seul ou te prévient', 'garde 2 versions (l\'ancienne et la nouvelle), nombre réglable', 'historique de tout, contrôle des fichiers abîmés, résumé chaque jour, bulles de la mascotte à chaque événement', 'icônes des éditeurs, catalogue, sources à toi (dépôt GitHub ou adresse officielle)', ...(o.extraDoes ?? [])],
    from: o.from, upstream: o.upstream, words: o.words, actions,
    async view(ctx) {
      const r0 = root(ctx), sc = scan(r0, all(ctx)), list = tracked(ctx, sc.found), now = new Date(), p = plan(ctx);
      const S = 'Store', D = 'Disponibles', W = 'Surveillés', R = 'Réglages';
      const [dispo, surv] = await Promise.all([disponibles(ctx), surveilles(ctx)]);
      const quand = surv.prochaine ? new Date(surv.prochaine).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'aucune';
      // Surveillés : ce qu'Odin garde à jour (dernière version vue, prochaine vérification, téléchargement en cours).
      const cards = surv.surveilles.map((x) => {
        const mine = sc.found.filter((y) => y.source.id === x.id).sort((a, b) => cmpVersion(b.version, a.version));
        const state = x.enCours ? `téléchargement ${x.enCours.pct !== undefined ? `${x.enCours.pct} %` : sizeText(x.enCours.recu)}` : x.etat;
        return { icon: x.icone, title: x.nom, sub: mine.length ? mine.map((m) => `${m.version} · ${sizeText(m.size)}`).join(' — ') : x.presents.length ? `${x.presents.join(', ')} (fichier reconnu dans le dossier)` : 'aucune version dans le dossier', badge: state, tone: (x.enCours || /nouvelle version|pas encore téléchargé/.test(x.etat) ? 'attention' : x.manuel ? undefined : 'bon') as Tone | undefined, progress: x.enCours?.total ? x.enCours.recu / x.enCours.total : undefined,
          meta: `${x.famille} · dernière version vue : ${x.derniere ?? '—'}${x.erreur ? ` (site en panne : ${x.erreur})` : ''} · prochaine vérification : ${quand}`,
          actions: [...(x.enCours ? [{ action: 'annuler', label: 'Arrêter', input: { nom: x.id } }] : x.manuel ? [] : [{ action: 'telecharger', label: /nouvelle version|pas encore/.test(x.etat) ? 'Télécharger' : 'Retélécharger', input: { nom: x.id } }]), { action: 'ne_plus_suivre', label: 'Retirer', input: { nom: x.id } }] };
      });
      // Store : tout le catalogue des dépôts officiels (la page dessinée y ajoute la recherche, les filtres et les index en ligne).
      const st = catalogueStore(ctx, sc.found), fv = valeursFiltres(st);
      const storeCards = st.map((e) => ({ icon: e.icone, title: e.nom, sub: `${e.systeme} · ${e.type} · ${e.arch} — ${e.about}`, meta: `${e.version ? `version ${e.version}` : 'version : pas encore relue'}${e.taille ? ` · ${sizeText(e.taille)}` : ''}${e.presents.length ? ` · dans le dossier : ${e.presents.join(', ')}` : ''}${e.manuel ? ` · ${e.page}` : ''}`,
        badge: e.surveille && e.etat === 'à télécharger' ? 'surveillé' : e.etat, tone: (e.etat === 'à jour' ? 'bon' : e.etat === 'nouvelle version' || e.etat === 'en cours' ? 'attention' : 'neutre') as Tone, actions: e.manuel ? [] : [{ action: 'telecharger', label: e.presents.length ? 'Retélécharger' : 'Télécharger', input: { nom: e.id } }] }));
      // Disponibles : ce qui est déjà là, reconnu et comparé au catalogue.
      const dispoCards = dispo.map((x) => ({ icon: x.icone, title: x.nom, sub: x.catalogue ? `${x.catalogue}${x.versionReconnue ? ` ${x.versionReconnue}` : ''} · reconnu par ${x.par}` : 'pas au catalogue (ajoute sa source officielle pour le suivre)', meta: `${sizeText(x.taille)} · antivirus : ${x.antivirus}${x.derniere ? ` · dernière version vue : ${x.derniere}` : ''}`,
        badge: x.etat === 'nouvelle version' ? `nouvelle version ${x.derniere}` : x.etat, tone: (x.etat === 'à jour' ? 'bon' : x.etat === 'nouvelle version' ? 'attention' : 'neutre') as Tone,
        actions: [...(o.fiche ? [{ action: o.fiche.action, label: 'Fiche', input: { nom: x.id, iso: x.id }, ...(o.fiche.module ? { module: o.fiche.module } : {}) }] : []), ...(x.etat === 'nouvelle version' && x.source && !x.manuel ? [{ action: 'telecharger', label: 'Mettre à jour', input: { nom: x.source } }] : [])] }));
      const h = history(ctx, 40), today = h.filter((e) => new Date(e.at).toDateString() === now.toDateString());
      const plus = o.reglages ? await o.reglages(ctx) : [];
      const sections: Section[] = [
        { kind: 'form', onglet: S, title: 'Chercher dans le Store', action: 'store', submit: 'Chercher', params: [{ key: 'q', label: 'Nom', kind: 'text', default: '' }, { key: 'systeme', label: 'Système', kind: 'select', options: ['tous', ...fv.systemes], default: 'tous' }, { key: 'type', label: o.kind === 'iso' ? 'Type' : 'Catégorie', kind: 'select', options: ['tous', ...fv.types], default: 'tous' }, { key: 'arch', label: 'Architecture', kind: 'select', options: ['tous', ...fv.archs], default: 'tous' }, { key: 'enligne', label: 'Chercher aussi dans les index officiels en ligne', kind: 'boolean', default: false }], aide: `Uniquement les sites et dépôts officiels des éditeurs. ${o.kind === 'iso' ? 'En ligne : les fichiers publiés par un projet sur GitHub (écris « propriétaire/projet »).' : 'En ligne : Homebrew (macOS), Flathub (Linux), GitHub (« propriétaire/projet »).'}` },
        { kind: 'cards', onglet: S, title: `Store (${st.length})`, items: storeCards, empty: 'Catalogue vide.' },
        { kind: 'form', onglet: S, title: 'Ajouter une source officielle', action: 'ajouter_source', submit: 'Ajouter', params: actions.find((a) => a.id === 'ajouter_source')!.params!, aide: 'Pas au catalogue ? Donne le dépôt GitHub du projet ou l\'adresse officielle du fichier : il sera surveillé comme les autres.' },
        { kind: 'cards', onglet: D, title: `Dans ton dossier (${dispo.length})`, items: dispoCards, empty: `Rien dans ${r0} pour l'instant : télécharge depuis le Store, ou dépose tes ${o.nouns} dans ce dossier.` },
        ...(sc.unknown.length ? [{ kind: 'list' as const, onglet: D, title: 'Fichiers non reconnus', items: sc.unknown.slice(0, 30).map((u) => ({ title: u, detail: '« Ajouter une source officielle » (onglet Store) avec le dépôt ou l\'adresse officielle pour qu\'Odin le garde à jour' })) }] : []),
        { kind: 'cards', onglet: W, title: `Mes ${o.nouns}`, items: cards, empty: `Rien de surveillé : télécharge depuis le Store (il sera surveillé tout seul), ou mets tes ${o.nouns} dans ${r0}.` },
        { kind: 'actions', onglet: W, title: 'Surveillance', boutons: [{ action: 'mettre_a_jour', label: 'Vérifier et télécharger maintenant', primary: true }, { action: 'verifier', label: 'Vérifier seulement' }], aide: `${surv.texte} Prochaine vérification : ${quand}. Ce qui est déjà là n'est retéléchargé que s'il existe une version plus récente (l'ancienne va dans « old »).` },
        { kind: 'form', onglet: R, title: 'Dossier', action: 'dossier', submit: 'Choisir', params: [{ key: 'chemin', label: 'Dossier (disque ou partage monté)', kind: 'text', required: true, default: r0 }], aide: `Odin y range ses téléchargements et y reconnaît tout ${o.noun} déposé à la main.` },
        ...plus.map((x) => ({ ...x, onglet: R })),
        { kind: 'form', onglet: R, title: 'Programmation à jours fixes (facultatif)', action: 'programmer', submit: 'Programmer', params: PLAN.map((x) => ({ ...x, default: x.key === 'jours' ? (p.days.length === 7 ? 'tous' : p.days.map((d) => JOURS[d]).join(', ')) : x.key === 'heure' ? p.at : x.key === 'date' ? p.date ?? '' : p.auto })), aide: 'Sans programmation, la surveillance suit la vérification de la bibliothèque (chaque mois par défaut).' },
        { kind: 'table', onglet: R, title: 'Historique', columns: ['Quand', 'Quoi', o.noun[0].toUpperCase() + o.noun.slice(1), 'Version', 'Taille', 'Détail'], empty: 'Rien pour l\'instant.', rows: h.map((e) => ({ cells: [new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), e.what, e.name, e.version ?? '—', e.size ? sizeText(e.size) : '—', e.detail ?? ''], tone: (/échec|fausse|abîmé|mis de côté/.test(e.what) ? 'mauvais' : e.what === 'téléchargé' ? 'bon' : 'neutre') as Tone })) },
      ];
      return {
        subtitle: `${r0} · ${list.length} surveillé(s) · ${surv.texte}`,
        onglets: [S, D, W, R],
        ...(jobs.size ? { refreshMs: 3000 } : {}),
        kpis: [
          { label: 'Surveillés', value: String(list.length) },
          { label: 'À mettre à jour', value: String(surv.surveilles.filter((x) => /nouvelle version/.test(x.etat)).length) },
          { label: 'Aujourd\'hui', value: `${today.filter((e) => e.what === 'téléchargé').length} téléchargé(s)`, tone: today.some((e) => /échec|fausse/.test(e.what)) ? 'mauvais' : 'bon' },
          { label: 'Place prise', value: sizeText(sc.found.reduce((a, b) => a + b.size, 0)) },
          { label: 'Prochaine vérification', value: quand },
        ],
        sections,
      };
    },
    // Talos : la tournée (recherche des nouvelles versions), aux jours programmés ou avec la vérification de la bibliothèque.
    taches: () => [{
      id: 'tournee', nom: o.kind === 'iso' ? 'Recherche de nouvelles ISO' : 'Recherche de nouvelles versions',
      quoi: `Vérifie tout ce qui est surveillé et télécharge ce qui est nouveau (ou te prévient, selon ton réglage).`,
      rythme: (ctx) => { const p = ctx.settings.plan ? plan(ctx) : undefined; return p ? (p.date ? { genre: 'une_fois', date: p.date, heure: p.at } : { genre: 'semaine', jours: p.days, heure: p.at }) : { genre: 'libre', texte: o.kind === 'iso' ? 'avec la vérification des ISO de Hydre' : 'avec la vérification de la bibliothèque' }; },
      permis: ['semaine', 'une_fois'],
      regler: (ctx, r) => {
        const avant = plan(ctx);
        if (r.genre === 'semaine') ctx.saveSettings({ plan: { days: r.jours, at: r.heure, auto: avant.auto } });
        else if (r.genre === 'une_fois') ctx.saveSettings({ plan: { days: avant.days, at: r.heure, date: r.date, auto: avant.auto } });
        else throw new Error('La tournée se programme à jours fixes chaque semaine, ou une seule fois.');
      },
      lancer: { action: 'tournee' },
      dernier: (ctx) => (Number(ctx.settings.lastRun) ? { at: new Date(Number(ctx.settings.lastRun)).toISOString() } : undefined),
      prochain: (ctx, now) => (ctx.settings.plan ? nextRun(plan(ctx), now) : undefined),
    }],
    // Chaque minute : passage programmé, et le résumé du jour.
    watch: { every: 60, async run(ctx) {
      const now = new Date();
      // La file reprend après un redémarrage d'Odin (ce que tu as mis en file attend toujours son tour).
      void pomper(ctx);
      // Le passage « jours et heure » seulement si tu l'as programmé ; sinon c'est la surveillance de la bibliothèque (chaque mois par défaut) qui lance le passage.
      if (ctx.settings.plan && due(plan(ctx), now, Number(ctx.settings.lastRun) || 0) && !tacheEnPause(o.id, 'tournee')) { const t = await cycle(ctx, 'programmé'); if (/❌/.test(t)) ctx.emit('passage', { resultat: t }); }
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
    _file: () => pompe ?? Promise.resolve(),
  };
  return mod;
}
