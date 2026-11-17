// Syrinx — le rangement sur le disque (source de vérité), sous ctx.dir = ~/.odin/valhalla/syrinx/ :
//   analyses/<id>.json   {v, id, quand, sourceRef, shaFichier, taille, mtime, duree, contenu} ; `contenu` est CHIFFRÉ
//                        (clé de la machine) : ni transcription, ni résumé, ni étiquette en clair ;
//   empreintes/<id>.bin  paires (code u32, t u32) petit-boutiennes : reconnaître un son déjà entendu ;
//   corrections.json     ce que le propriétaire a corrigé (500 au plus) : quand, son, instants en clair ; le libellé et le
//                        plongement (tiré du son) CHIFFRÉS dans `contenu` ;
//   mesures.json         la vitesse mesurée ici (les 50 dernières).
// Fichiers en 0o600, dossiers en 0o700. En MODE PRIVÉ, aucune écriture n'est faite : chaque fonction d'écriture le dit.
// Un double (déjà chiffré) part dans la base SYRINX_ODIN quand elle est prête (base.ts).
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../vault.ts';
import type { AnalyseSon, EmpreinteSon, Mesure } from '../../audio/contrat.ts';
import type { SensSon } from './ligne-de-temps.ts';
import { noterBase } from './base.ts';

export interface EnteteSon { v: 1; id: string; quand: string; sourceRef: string; shaFichier: string; taille: number; mtime: number; duree: number; contenu: string }
export interface Correction { quand: string; analyse: string; debut?: number; fin?: number; cle?: string; libelle: string; plongement?: number[] }
export type MesureRangee = Mesure & { quand: string };
/** Le résultat d'une écriture : rangée, ou sautée (mode privé) avec la raison. */
export type Rangement<T> = { range: true; valeur: T } | { range: false; raison: string };

const PRIVE = 'mode privé : rien n\'est rangé (ni analyse, ni empreinte, ni correction, ni mesure)';
const MAX_CORRECTIONS = 500, MAX_MESURES = 50, MAX_INDEX_SONS = 2000, MAX_INDEX_PAIRES = 4_000_000;
const ID = /^[0-9a-f]{16}$/;

const dAnalyses = (dir: string) => join(dir, 'analyses');
const dEmpreintes = (dir: string) => join(dir, 'empreintes');
function ecrireSur(f: string, contenu: string | Uint8Array): void {
  const t = `${f}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(t, contenu, { mode: 0o600 }); renameSync(t, f);
}
const dossier = (d: string) => mkdirSync(d, { recursive: true, mode: 0o700 });

/** Le SHA-256 d'un fichier, calculé en flux (jamais tout le fichier en mémoire), AVANT toute analyse. */
export function shaFichierFlux(f: string): Promise<string> {
  return new Promise((ok, ko) => {
    const h = createHash('sha256'), r = createReadStream(f);
    r.on('data', (b) => h.update(b)); r.on('error', ko); r.on('end', () => ok(h.digest('hex')));
  });
}

// ------------------------------------------------------------------ Les en-têtes (en mémoire, rechargés à la demande)
const entetes = new Map<string, EnteteSon[]>();
function lireEntetes(dir: string): EnteteSon[] {
  const deja = entetes.get(dir); if (deja) return deja;
  const l: EnteteSon[] = [];
  let noms: string[] = []; try { noms = readdirSync(dAnalyses(dir)); } catch { /* rien de rangé */ }
  for (const n of noms) {
    if (!/^[0-9a-f]{16}\.json$/.test(n)) continue;
    try { const e = JSON.parse(readFileSync(join(dAnalyses(dir), n), 'utf8')) as EnteteSon; if (e?.v === 1 && ID.test(e.id)) l.push(e); } catch { /* fichier abîmé : ignoré */ }
  }
  l.sort((a, b) => b.quand.localeCompare(a.quand));
  entetes.set(dir, l);
  return l;
}
/** (essais, et après une purge) oublie ce qui est gardé en mémoire. */
export function oublierMagasin(dir?: string): void { if (dir) { entetes.delete(dir); index.delete(dir); plongements.delete(dir); } else { entetes.clear(); index.clear(); plongements.clear(); } }

/** Les sons rangés, du plus récent au plus ancien (en-têtes seulement, rien de déchiffré). */
export const listerSons = (dir: string): EnteteSon[] => lireEntetes(dir);
/** Un son déjà analysé, retrouvé par le SHA-256 de son fichier (pour ne pas l'analyser deux fois). */
export const trouverParShaFichier = (dir: string, sha: string): EnteteSon | undefined => lireEntetes(dir).find((e) => e.shaFichier === sha);
export const enteteDe = (dir: string, id: string): EnteteSon | undefined => (ID.test(id) ? lireEntetes(dir).find((e) => e.id === id) : undefined);

/** Le contenu déchiffré d'un son rangé (ou undefined si illisible). */
export function lireContenu(home: string, e: EnteteSon): { analyse: AnalyseSon; sens?: SensSon } | undefined {
  try { return JSON.parse(dechiffrerChamp(home, e.contenu)) as { analyse: AnalyseSon; sens?: SensSon }; } catch { return undefined; }
}

/** Range une analyse (chiffrée) et son empreinte ; rend son identifiant. Rien en mode privé. */
export function rangerAnalyse(ctx: { dir: string }, home: string, x: { sourceRef: string; shaFichier: string; taille: number; mtime: number; analyse: AnalyseSon; sens?: SensSon; empreinte?: EmpreinteSon; prive: boolean; quand?: Date }): Rangement<string> {
  if (x.prive) return { range: false, raison: PRIVE };
  const dir = ctx.dir; dossier(dAnalyses(dir));
  const id = randomBytes(8).toString('hex'), quand = (x.quand ?? new Date()).toISOString();
  const contenu = chiffrerChamp(home, JSON.stringify({ analyse: x.analyse, sens: x.sens }));
  const e: EnteteSon = { v: 1, id, quand, sourceRef: x.sourceRef.slice(0, 300), shaFichier: x.shaFichier, taille: x.taille, mtime: x.mtime, duree: x.analyse.duree, contenu };
  ecrireSur(join(dAnalyses(dir), `${id}.json`), JSON.stringify(e));
  const lignes: Array<[string, ...Array<string | number>]> = [['son_pose', id, quand, e.sourceRef, e.shaFichier, e.duree, contenu]];
  if (x.empreinte && x.empreinte.codes.length) {
    dossier(dEmpreintes(dir));
    const n = Math.min(x.empreinte.codes.length, x.empreinte.instants.length), b = Buffer.alloc(n * 8);
    for (let i = 0; i < n; i++) { b.writeUInt32LE(x.empreinte.codes[i] >>> 0, i * 8); b.writeUInt32LE(x.empreinte.instants[i] >>> 0, i * 8 + 4); }
    ecrireSur(join(dEmpreintes(dir), `${id}.bin`), b);
    // Une seule ligne pour toute l'empreinte (jamais une écriture par code) : des paires [code, instant] en JSON.
    const paires: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) paires.push([x.empreinte.codes[i] >>> 0, x.empreinte.instants[i] >>> 0]);
    lignes.push(['empreintes_pose', id, JSON.stringify(paires)]);
    ajouterIndex(dir, id, x.empreinte.codes.subarray(0, n), x.empreinte.instants.subarray(0, n));
  }
  noterBase(dir, ...lignes);
  entetes.get(dir)?.unshift(e);
  if (x.analyse.sons.plongement?.length) plongements.get(dir)?.set(id, Float32Array.from(x.analyse.sons.plongement));
  return { range: true, valeur: id };
}

/** L'empreinte rangée d'un son (paires code, instant). */
export function lireEmpreinte(dir: string, id: string): EmpreinteSon | undefined {
  if (!ID.test(id)) return undefined;
  try {
    const b = readFileSync(join(dEmpreintes(dir), `${id}.bin`)), n = Math.floor(b.length / 8);
    const codes = new Uint32Array(n), instants = new Uint32Array(n);
    for (let i = 0; i < n; i++) { codes[i] = b.readUInt32LE(i * 8); instants[i] = b.readUInt32LE(i * 8 + 4); }
    return { sha: '', codes, instants };
  } catch { return undefined; }
}

// ------------------------------------------------------------------ Plongements (déchiffrés une fois, gardés en mémoire)
const plongements = new Map<string, Map<string, Float32Array | null>>();
/** Le plongement d'un son rangé (192 nombres), déchiffré une seule fois puis gardé en mémoire ; undefined s'il n'y en a pas. */
export function plongementDe(dir: string, home: string, e: EnteteSon): Float32Array | undefined {
  let m = plongements.get(dir); if (!m) { m = new Map(); plongements.set(dir, m); }
  if (!m.has(e.id)) { const p = lireContenu(home, e)?.analyse.sons.plongement; m.set(e.id, p?.length ? Float32Array.from(p) : null); }
  return m.get(e.id) ?? undefined;
}

// ------------------------------------------------------------------ Index des empreintes (chargé à la demande)
interface IndexEmpreintes { ids: string[]; parCode: Map<number, number[]>; paires: number }
const index = new Map<string, IndexEmpreintes>();
/** Ajoute l'empreinte d'un son qu'on vient de ranger à l'index déjà chargé (sans tout relire). */
function ajouterIndex(dir: string, id: string, codes: Uint32Array, instants: Uint32Array): void {
  const ix = index.get(dir); if (!ix) return;
  if (ix.paires + codes.length > MAX_INDEX_PAIRES) { index.delete(dir); return; } // trop gros : rechargé à la demande (les plus récents)
  const k = ix.ids.push(id) - 1; ix.paires += codes.length;
  for (let i = 0; i < codes.length; i++) { const l = ix.parCode.get(codes[i]); if (l) l.push(k, instants[i]); else ix.parCode.set(codes[i], [k, instants[i]]); }
}
/** Un code présent dans trop de sons ne dit rien (silence, bruit de fond) : il est ignoré au vote. */
const MAX_PAR_CODE = 400;
/** L'index code → (son, instant) des 2000 sons les plus récents (borné en paires pour tenir en mémoire). */
export function indexEmpreintes(dir: string): IndexEmpreintes {
  const deja = index.get(dir); if (deja) return deja;
  const ids: string[] = [], parCode = new Map<number, number[]>();
  let paires = 0;
  for (const e of lireEntetes(dir).slice(0, MAX_INDEX_SONS)) {
    const emp = lireEmpreinte(dir, e.id); if (!emp) continue;
    if (paires + emp.codes.length > MAX_INDEX_PAIRES) break;
    const k = ids.push(e.id) - 1; paires += emp.codes.length;
    for (let i = 0; i < emp.codes.length; i++) { const l = parCode.get(emp.codes[i]); if (l) l.push(k, emp.instants[i]); else parCode.set(emp.codes[i], [k, emp.instants[i]]); }
  }
  const r = { ids, parCode, paires }; index.set(dir, r); return r;
}
/** Les paires de l'index qui partagent un code avec l'empreinte demandée (forme attendue par voterEmpreinte). */
export function candidatsEmpreinte(dir: string, q: EmpreinteSon, max = 200_000): Array<{ id: string; code: number; t: number }> {
  const ix = indexEmpreintes(dir), out: Array<{ id: string; code: number; t: number }> = [];
  for (const c of new Set(q.codes)) {
    const l = ix.parCode.get(c); if (!l || l.length / 2 > MAX_PAR_CODE) continue;
    for (let i = 0; i < l.length && out.length < max; i += 2) out.push({ id: ix.ids[l[i]], code: c, t: l[i + 1] });
    if (out.length >= max) break;
  }
  return out;
}

// ------------------------------------------------------------------ Corrections et mesures
function lireListe<T>(f: string): T[] { try { const l = JSON.parse(readFileSync(f, 'utf8')) as T[]; return Array.isArray(l) ? l : []; } catch { return []; } }
/** Une correction telle qu'elle est rangée : le libellé et le plongement sont dans `contenu`, chiffré. */
interface CorrectionRangee { quand: string; analyse: string; debut?: number; fin?: number; contenu?: string; libelle?: string; cle?: string; plongement?: number[] }
const lireRangees = (dir: string): CorrectionRangee[] => lireListe<CorrectionRangee>(join(dir, 'corrections.json'));
/** Les corrections, déchiffrées (sans `home` : seulement quand, son et instants, le libellé reste vide). */
export function lireCorrections(dir: string, home?: string): Correction[] {
  const out: Correction[] = [];
  for (const r of lireRangees(dir)) {
    let secret: { libelle?: string; cle?: string; plongement?: number[] } = { libelle: r.libelle, cle: r.cle, plongement: r.plongement };
    if (r.contenu) {
      if (!home) secret = {};
      else try { secret = JSON.parse(dechiffrerChamp(home, r.contenu)) as typeof secret; } catch { continue; }
    }
    out.push({ quand: r.quand, analyse: r.analyse, ...(r.debut !== undefined ? { debut: r.debut } : {}), ...(r.fin !== undefined ? { fin: r.fin } : {}), ...(secret.cle ? { cle: secret.cle } : {}), libelle: String(secret.libelle ?? ''), ...(secret.plongement ? { plongement: secret.plongement } : {}) });
  }
  return out;
}
export function ajouterCorrection(dir: string, home: string, c: Correction, prive: boolean): Rangement<Correction> {
  if (prive) return { range: false, raison: PRIVE };
  dossier(dir);
  const contenu = chiffrerChamp(home, JSON.stringify({ libelle: c.libelle, cle: c.cle, plongement: c.plongement }));
  const r: CorrectionRangee = { quand: c.quand, analyse: c.analyse, ...(c.debut !== undefined ? { debut: c.debut } : {}), ...(c.fin !== undefined ? { fin: c.fin } : {}), contenu };
  ecrireSur(join(dir, 'corrections.json'), JSON.stringify([r, ...lireRangees(dir)].slice(0, MAX_CORRECTIONS)));
  try { noterBase(dir, ['correction_pose', c.quand, c.analyse, chiffrerChamp(home, c.libelle.slice(0, 200)), contenu]); } catch { /* la base n'est qu'un double */ }
  return { range: true, valeur: c };
}
export const lireMesures = (dir: string): MesureRangee[] => lireListe<MesureRangee>(join(dir, 'mesures.json'));
export function ajouterMesures(dir: string, ms: Mesure[], prive: boolean, quand = new Date()): Rangement<number> {
  if (prive) return { range: false, raison: PRIVE };
  if (!ms.length) return { range: true, valeur: 0 };
  dossier(dir);
  const q = quand.toISOString(), neuves = ms.map((m) => ({ etape: m.etape, ms: Number(m.ms) || 0, xTempsReel: Number(m.xTempsReel) || 0, quand: q }));
  // Les 50 dernières PASSES (une passe = toutes ses étapes) : on garde par date.
  const l = [...lireMesures(dir), ...neuves], dates = [...new Set(l.map((m) => m.quand))].sort().slice(-MAX_MESURES);
  ecrireSur(join(dir, 'mesures.json'), JSON.stringify(l.filter((m) => dates.includes(m.quand))));
  noterBase(dir, ...neuves.map((m): [string, string, string, number, number] => ['mesure_pose', q, m.etape, m.ms, m.xTempsReel]));
  return { range: true, valeur: neuves.length };
}
/** La médiane des mesures d'une étape (sur les 50 dernières passes). */
export function medianeMesures(dir: string, etape: Mesure['etape']): { ms: number; xTempsReel: number; n: number } | undefined {
  const l = lireMesures(dir).filter((m) => m.etape === etape); if (!l.length) return undefined;
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  return { ms: med(l.map((m) => m.ms)), xTempsReel: med(l.map((m) => m.xTempsReel)), n: l.length };
}

// ------------------------------------------------------------------ Purge
/**
 * Oublie les sons de plus de `jours` jours : analyses, empreintes, corrections liées, et les fichiers déposés dans
 * l'atelier. Rend le nombre de sons effacés et de fichiers d'atelier retirés.
 */
export function purger(ctx: { dir: string }, jours: number, maintenant = new Date()): { sons: number; atelier: number; corrections: number } {
  const dir = ctx.dir, limite = maintenant.getTime() - Math.max(0, jours) * 86_400_000;
  const vieux = lireEntetes(dir).filter((e) => Date.parse(e.quand) < limite).map((e) => e.id);
  for (const id of vieux) {
    rmSync(join(dAnalyses(dir), `${id}.json`), { force: true });
    rmSync(join(dEmpreintes(dir), `${id}.bin`), { force: true });
  }
  const effaces = new Set(vieux), avant = lireRangees(dir);
  const gardees = avant.filter((c) => !effaces.has(c.analyse) && Date.parse(c.quand) >= limite);
  if (gardees.length !== avant.length) ecrireSur(join(dir, 'corrections.json'), JSON.stringify(gardees));
  noterBase(dir, ...vieux.flatMap((id): Array<[string, string]> => [['son_retire', id], ['empreintes_retire', id], ['corrections_retire', id]]));
  let atelier = 0;
  try {
    const a = join(dir, 'atelier');
    for (const n of readdirSync(a)) {
      const f = join(a, n);
      try { const st = statSync(f); if (st.isFile() && st.mtimeMs < limite) { rmSync(f, { force: true }); atelier++; } } catch { /* disparu */ }
    }
  } catch { /* pas d'atelier */ }
  oublierMagasin(dir);
  return { sons: vieux.length, atelier, corrections: avant.length - gardees.length };
}

/** Y a-t-il quelque chose de rangé ? */
export const aDesSons = (dir: string): boolean => existsSync(dAnalyses(dir)) && lireEntetes(dir).length > 0;
