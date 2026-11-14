// Ulysse · ce qui est gardé sur le disque, dans le dossier de l'appli (tout ce dossier est fermé aux outils de
// fichiers et à l'IA : voir SECRET_FILES dans heimdall/policy.ts).
//   choix.json                       ce que chaque membre a choisi : historique éteint, allumé ou en pause, durée de
//                                    conservation, trajets montrés ou non au propriétaire ; le journal de ses accords ;
//                                    ses lieux nommés ; les périodes effacées ou en pause.
//   positions/<membre>/<jour>.jsonl  une ligne par position gardée : [heure, latitude, longitude, précision, vitesse, altitude].
//   exports/<membre>/<jeton>/…gpx    les fichiers GPX préparés pour un téléchargement (effacés au bout d'une heure).
// Rien n'est gardé pour un membre dont l'historique n'est pas allumé. Ces fonctions ne reçoivent que le dossier :
// Hestia, qui reçoit les positions, peut ainsi alimenter l'historique sans passer par le journal des actions.
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pt } from './trajets.ts';

export type Etat = 'éteint' | 'allumé' | 'pause';
/** Une ligne du journal des accords : quand, qui (le membre lui-même ou le propriétaire), quoi ; `detail` : ce que seul celui qui voit les trajets peut lire (quelle période a été effacée). */
export interface Note { at: number; par: string; quoi: string; detail?: string }
/** Un lieu nommé par le membre (« Maison », « Bureau »). */
export interface Lieu { id: string; nom: string; lat: number; lon: number; rayon: number }
export interface Choix {
  etat: Etat;
  /** depuis quand l'historique est allumé : rien d'antérieur n'est gardé */ depuis?: number;
  /** début de la pause en cours */ pauseDepuis?: number;
  /** jours de conservation */ conservation: number;
  /** le membre accepte que le propriétaire voie ses trajets */ visible: boolean;
  journal: Note[]; lieux: Lieu[];
  /** périodes sans position par choix (pause, effacement) : aucun trajet n'est tracé à travers */ coupures: Array<[number, number]>;
}
export const CONSERVATIONS = [30, 90, 365];
export const JOUR = 86_400_000;
const neuf = (): Choix => ({ etat: 'éteint', conservation: 90, visible: false, journal: [], lieux: [], coupures: [] });

/** Le jour (heure de la machine d'Odin) d'un instant : « 2026-11-12 ». */
export function cleJour(t: number): string { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
/** Minuit (heure de la machine d'Odin) au début d'un jour ; `plus` : tant de jours après. */
export function debutJour(cle: string, plus = 0): number { const [y, m, d] = cle.split('-').map(Number); return new Date(y, m - 1, d + plus).getTime(); }
export const jourValide = (cle: string) => /^\d{4}-\d{2}-\d{2}$/.test(cle) && cleJour(debutJour(cle)) === cle;

// ---------------- Les soucis d'écriture (pour l'alerte de l'appli, sans aucune position) ----------------
const soucis = new Map<string, { at: number; quoi: string }>();
const signaler = (dir: string, quoi: string, at = Date.now()) => { soucis.set(dir, { at, quoi }); };
/** Le dernier souci de lecture ou d'écriture de ce dossier, s'il y en a un ; `oublie` : il a été signalé. */
export function souci(dir: string, oublie = false): { at: number; quoi: string } | undefined { const x = soucis.get(dir); if (oublie) soucis.delete(dir); return x; }

// ---------------- Les choix des membres ----------------
const fichierChoix = (dir: string) => join(dir, 'choix.json');
const cache = new Map<string, { sig: string; tous: Record<string, Choix> }>();
function propre(c: Partial<Choix> | undefined): Choix {
  const d = neuf(); if (!c || typeof c !== 'object') return d;
  return {
    etat: c.etat === 'allumé' || c.etat === 'pause' ? c.etat : 'éteint',
    ...(Number.isFinite(c.depuis) ? { depuis: Number(c.depuis) } : {}), ...(Number.isFinite(c.pauseDepuis) ? { pauseDepuis: Number(c.pauseDepuis) } : {}),
    conservation: CONSERVATIONS.includes(Number(c.conservation)) ? Number(c.conservation) : d.conservation, visible: c.visible === true,
    journal: Array.isArray(c.journal) ? c.journal.filter((n) => n && Number.isFinite(n.at)).map((n) => ({ at: Number(n.at), par: String(n.par ?? ''), quoi: String(n.quoi ?? ''), ...(n.detail ? { detail: String(n.detail) } : {}) })) : [],
    lieux: Array.isArray(c.lieux) ? c.lieux.filter((l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lon)).map((l) => ({ id: String(l.id), nom: String(l.nom ?? ''), lat: Number(l.lat), lon: Number(l.lon), rayon: Number(l.rayon) || 150 })) : [],
    coupures: Array.isArray(c.coupures) ? c.coupures.filter((x) => Array.isArray(x) && Number.isFinite(x[0]) && Number.isFinite(x[1]) && x[1] >= x[0]).map((x) => [Number(x[0]), Number(x[1])] as [number, number]) : [],
  };
}
/** Les choix de tous les membres. Un fichier illisible est mis de côté (jamais écrasé) et tout le monde repasse à « éteint ». */
export function tousLesChoix(dir: string): Record<string, Choix> {
  const f = fichierChoix(dir);
  let sig = ''; try { const st = statSync(f); sig = `${st.size}:${st.mtimeMs}`; } catch { cache.delete(dir); return {}; }
  const vu = cache.get(dir); if (vu && vu.sig === sig) return vu.tous;
  let tous: Record<string, Choix> = {};
  try {
    const brut = JSON.parse(readFileSync(f, 'utf8')) as Record<string, Partial<Choix>>;
    if (!brut || typeof brut !== 'object' || Array.isArray(brut)) throw new Error('forme inattendue');
    for (const [id, c] of Object.entries(brut)) if (/^[0-9a-z_-]{1,40}$/i.test(id)) tous[id] = propre(c);
  } catch {
    tous = {};
    try { renameSync(f, join(dir, `choix.illisible-${Date.now()}.json`)); } catch { /* disque en lecture seule */ }
    signaler(dir, 'le fichier des choix des membres était illisible : il est mis de côté, et l\'historique de chacun est repassé à « éteint »');
    cache.delete(dir); return tous;
  }
  cache.set(dir, { sig, tous });
  return tous;
}
/** Le choix d'un membre (éteint tant qu'il n'a rien choisi). Copie : la modifier ne change rien sur le disque. */
export function choixDe(dir: string, id: string): Choix { return propre(tousLesChoix(dir)[id]); }
/** Change le choix d'un membre et l'écrit d'un coup (jamais un fichier à moitié écrit). */
export function changer(dir: string, id: string, fn: (c: Choix) => void): Choix {
  const tous = { ...tousLesChoix(dir) }, c = propre(tous[id]);
  fn(c); c.journal = c.journal.slice(-200); c.coupures = fusion(c.coupures);
  tous[id] = c;
  ecrireChoix(dir, tous);
  return c;
}
function ecrireChoix(dir: string, tous: Record<string, Choix>): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = fichierChoix(dir), tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify(tous), { mode: 0o600 }); renameSync(tmp, f);
  cache.delete(dir);
}
/** Les périodes qui se touchent n'en font qu'une. */
function fusion(l: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [a, b] of [...l].sort((x, y) => x[0] - y[0])) { const d = out.at(-1); if (d && a <= d[1] + 1000) d[1] = Math.max(d[1], b); else out.push([a, b]); }
  return out;
}
/** Les périodes sans position par choix, pause en cours comprise (elle va jusqu'à `now`). */
export function coupuresDe(c: Choix, now: number): Array<[number, number]> {
  return fusion([...c.coupures, ...(c.etat === 'pause' && c.pauseDepuis !== undefined ? [[c.pauseDepuis, now] as [number, number]] : [])]);
}

// ---------------- Les positions ----------------
const dossierDe = (dir: string, id: string) => join(dir, 'positions', id);
const idValide = (id: string) => /^[0-9a-z_-]{1,40}$/i.test(id);
const dernier = new Map<string, string>(), balaye = new Map<string, number>();
const ligne = (p: Pt) => { const l: Array<number | null> = [Math.round(p.t), p.lat, p.lon, p.acc ?? null, p.vel ?? null, p.alt ?? null]; while (l.length > 3 && l[l.length - 1] === null) l.pop(); return JSON.stringify(l); };
function lireFichier(f: string): Pt[] {
  let brut = ''; try { brut = readFileSync(f, 'utf8'); } catch { return []; }
  const out: Pt[] = [];
  for (const l of brut.split('\n')) {
    if (!l) continue;
    // Une ligne coupée (machine éteinte pendant l'écriture) est ignorée, les autres restent lisibles.
    try { const a = JSON.parse(l) as Array<number | null>; if (Array.isArray(a) && Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2])) out.push({ t: a[0]!, lat: a[1]!, lon: a[2]!, ...(a[3] != null ? { acc: a[3] } : {}), ...(a[4] != null ? { vel: a[4] } : {}), ...(a[5] != null ? { alt: a[5] } : {}) }); } catch { /* ligne abîmée */ }
  }
  return out;
}
function ecrireFichier(f: string, pts: Pt[]): void {
  if (!pts.length) { rmSync(f, { force: true }); return; }
  const tmp = `${f}.tmp`; writeFileSync(tmp, pts.map(ligne).join('\n') + '\n', { mode: 0o600 }); renameSync(tmp, f);
}
/** Les jours pour lesquels des positions sont gardées, du plus ancien au plus récent. */
export function joursGardes(dir: string, id: string): string[] {
  if (!idValide(id)) return [];
  try { return readdirSync(dossierDe(dir, id)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).map((n) => n.slice(0, 10)).sort(); } catch { return []; }
}
/**
 * Une position vient d'arriver pour ce membre. Elle n'est gardée que si son historique est allumé, et seulement si elle
 * a été prise après l'allumage (à la seconde près : OwnTracks date ses positions à la seconde), hors d'une pause ou
 * d'une période effacée, et dans la durée de conservation (un téléphone resté sans réseau envoie ses positions plus
 * tard, avec leur heure d'origine).
 */
export function nourrir(dir: string, id: string, p: Pt, now: number): 'gardée' | 'non gardée' {
  if (!idValide(id) || !existsSync(fichierChoix(dir))) return 'non gardée';
  const c = tousLesChoix(dir)[id];
  if (!c || c.etat !== 'allumé' || !Number.isFinite(p.t) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return 'non gardée';
  if (p.t > now + 60_000 || p.t < now - c.conservation * JOUR || (c.depuis !== undefined && p.t + 1000 < c.depuis) || c.coupures.some(([a, b]) => p.t >= a && p.t <= b)) return 'non gardée';
  const l = ligne(p), cle = `${dir}\n${id}`;
  if (dernier.get(cle) === l) return 'gardée';
  try {
    const d = dossierDe(dir, id); mkdirSync(d, { recursive: true, mode: 0o700 });
    appendFileSync(join(d, `${cleJour(p.t)}.jsonl`), `${l}\n`, { mode: 0o600 });
    dernier.set(cle, l);
  } catch (e) { signaler(dir, `l'historique ne peut plus être écrit (${(e as NodeJS.ErrnoException).code ?? 'erreur d\'écriture'})`, now); return 'non gardée'; }
  // Le ménage des vieilles positions : au plus une fois par heure et par membre à l'arrivée d'une position.
  if (now - (balaye.get(cle) ?? 0) > 3_600_000) { balaye.set(cle, now); try { balayer(dir, id, now); } catch { /* le ménage repassera */ } }
  return 'gardée';
}
/** Les positions gardées d'un membre entre deux instants (`de` compris, `a` non compris), dans l'ordre. */
export function positions(dir: string, id: string, de: number, a: number): Pt[] {
  if (!idValide(id) || a <= de) return [];
  const k0 = cleJour(de), k1 = cleJour(a - 1), out: Pt[] = [];
  for (const j of joursGardes(dir, id)) if (j >= k0 && j <= k1) for (const p of lireFichier(join(dossierDe(dir, id), `${j}.jsonl`))) if (p.t >= de && p.t < a) out.push(p);
  return out.sort((x, y) => x.t - y.t);
}
/** La dernière position gardée avant `t` (en remontant de `jours` jours au plus), ou la première à partir de `t`. */
export function voisine(dir: string, id: string, t: number, sens: 'avant' | 'apres', jours = 7): Pt | undefined {
  const l = joursGardes(dir, id);
  if (sens === 'avant') {
    const k = cleJour(t - 1), min = cleJour(t - jours * JOUR);
    for (const j of l.filter((x) => x <= k && x >= min).reverse()) { const p = lireFichier(join(dossierDe(dir, id), `${j}.jsonl`)).filter((x) => x.t < t).sort((x, y) => x.t - y.t).at(-1); if (p) return p; }
    return undefined;
  }
  const k = cleJour(t), max = cleJour(t + jours * JOUR);
  for (const j of l.filter((x) => x >= k && x <= max)) { const p = lireFichier(join(dossierDe(dir, id), `${j}.jsonl`)).filter((x) => x.t >= t).sort((x, y) => x.t - y.t)[0]; if (p) return p; }
  return undefined;
}
/** Efface les positions d'un membre entre deux instants (`de` et `a` compris). Rend combien ont été effacées. */
export function effacer(dir: string, id: string, de: number, a: number): number {
  if (!idValide(id) || a < de) return 0;
  const k0 = cleJour(de), k1 = cleJour(a); let n = 0;
  for (const j of joursGardes(dir, id)) {
    if (j < k0 || j > k1) continue;
    const f = join(dossierDe(dir, id), `${j}.jsonl`), pts = lireFichier(f), reste = pts.filter((p) => p.t < de || p.t > a);
    if (reste.length !== pts.length) { n += pts.length - reste.length; ecrireFichier(f, reste); }
  }
  dernier.delete(`${dir}\n${id}`);
  return n;
}
/** Combien de positions sont gardées pour ce membre (pour dire ce qu'un effacement va retirer). */
export function compter(dir: string, id: string, de = 0, a = Number.MAX_SAFE_INTEGER): number {
  const k0 = cleJour(Math.max(0, de)), k1 = a >= 8.64e15 ? '9999-99-99' : cleJour(a); let n = 0;
  for (const j of joursGardes(dir, id)) if (j >= k0 && j <= k1) n += lireFichier(join(dossierDe(dir, id), `${j}.jsonl`)).filter((p) => p.t >= de && p.t <= a).length;
  return n;
}
/**
 * La conservation : efface les positions plus vieilles que la durée choisie par le membre (au point près, pas au
 * jour près), et oublie les coupures devenues trop vieilles. Si le membre a éteint son historique, tout est effacé.
 * Un membre dont le choix n'est plus connu (fichier des choix abîmé) n'est pas touché : rien n'est détruit par erreur.
 */
export function balayer(dir: string, id: string, now: number): number {
  if (!idValide(id) || !tousLesChoix(dir)[id]) return 0;
  const c = choixDe(dir, id), limite = c.etat === 'éteint' ? Infinity : now - c.conservation * JOUR, kl = Number.isFinite(limite) ? cleJour(limite) : '9999-99-99';
  let n = 0;
  for (const j of joursGardes(dir, id)) {
    if (j > kl) break;
    const f = join(dossierDe(dir, id), `${j}.jsonl`), pts = lireFichier(f), reste = j < kl ? [] : pts.filter((p) => p.t >= limite);
    if (reste.length !== pts.length || !pts.length) { n += pts.length - reste.length; ecrireFichier(f, reste); }
  }
  if (c.coupures.some(([, b]) => b < limite) && Number.isFinite(limite)) changer(dir, id, (x) => { x.coupures = x.coupures.filter(([, b]) => b >= limite); });
  if (n) dernier.delete(`${dir}\n${id}`);
  return n;
}
/** Efface tout ce qui est gardé pour un membre (positions, fichiers préparés) ; `choix` : ses choix et son journal aussi (membre retiré). */
export function oublier(dir: string, id: string, choix = false): void {
  if (!idValide(id)) return;
  rmSync(dossierDe(dir, id), { recursive: true, force: true }); rmSync(join(dir, 'exports', id), { recursive: true, force: true });
  dernier.delete(`${dir}\n${id}`); balaye.delete(`${dir}\n${id}`);
  if (choix && tousLesChoix(dir)[id]) { const tous = { ...tousLesChoix(dir) }; delete tous[id]; ecrireChoix(dir, tous); }
}
/** Les membres pour lesquels quelque chose est gardé (choix ou positions). */
export function membresConnus(dir: string): string[] {
  let l: string[] = []; try { l = readdirSync(join(dir, 'positions')); } catch { /* rien encore */ }
  return [...new Set([...Object.keys(tousLesChoix(dir)), ...l])].filter(idValide);
}

// ---------------- Les fichiers préparés (GPX) ----------------
/** Range un fichier à télécharger et rend sa référence (« exports/<membre>/<jeton>/<nom> »). */
export function deposer(dir: string, id: string, nom: string, contenu: string): string {
  const jeton = randomBytes(12).toString('hex'), sur = nom.replace(/[^\w.() -]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'trajets.gpx';
  const d = join(dir, 'exports', id, jeton); mkdirSync(d, { recursive: true, mode: 0o700 });
  writeFileSync(join(d, sur), contenu, { mode: 0o600 });
  return `exports/${id}/${jeton}/${sur}`;
}
/** Le chemin d'un fichier préparé (ou rien : référence mal formée, fichier parti) ; `id` : seulement s'il est à ce membre. */
export function retrouver(dir: string, ref: string, id?: string): string | undefined {
  const m = /^exports\/([0-9a-z_-]{1,40})\/([0-9a-f]{24})\/([\w.() -]{1,80})$/i.exec(ref);
  if (!m || m[3].startsWith('.') || (id !== undefined && m[1] !== id)) return undefined;
  const f = join(dir, 'exports', m[1], m[2], m[3]);
  try { return statSync(f).isFile() ? f : undefined; } catch { return undefined; }
}
/** Efface les fichiers préparés depuis plus d'une heure. */
export function menageExports(dir: string, now: number): void {
  let membres: string[] = []; try { membres = readdirSync(join(dir, 'exports')); } catch { return; }
  for (const id of membres) {
    let jetons: string[] = []; try { jetons = readdirSync(join(dir, 'exports', id)); } catch { continue; }
    for (const j of jetons) { try { if (now - statSync(join(dir, 'exports', id, j)).mtimeMs > 3_600_000) rmSync(join(dir, 'exports', id, j), { recursive: true, force: true }); } catch { /* déjà parti */ } }
  }
}
