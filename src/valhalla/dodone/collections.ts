// Dodone · le modèle : collections (avec leurs dossiers) de requêtes, et environnements de variables {{nom}}.
// Rangés dans le journal « dodone » (base DODONE_ODIN) sous forme de versions : la dernière version d'un identifiant
// fait foi. Les valeurs secrètes n'y sont JAMAIS : seulement leur nom ({{JETON}}), la valeur est au coffre.
import { randomBytes } from 'node:crypto';

export type GenreTest = 'code' | 'temps' | 'json_existe' | 'json_egal' | 'json_contient';
export interface Test { genre: GenreTest; chemin?: string; valeur?: string }
export interface Entete { nom: string; valeur: string }
export interface Requete { id: string; nom: string; dossier?: string; methode: string; url: string; entetes: Entete[]; corps?: string; tests: Test[] }
export interface Collection { id: string; nom: string; requetes: Requete[]; variables: Record<string, string>; maj: string; supprime?: boolean; signalements?: string[] }
export interface Environnement { id: string; nom: string; variables: Record<string, string>; maj: string; supprime?: boolean }
export type Version = { at: string; genre: 'collection'; c: Collection } | { at: string; genre: 'environnement'; e: Environnement };

export const nouvelId = () => randomBytes(5).toString('hex');
export const METHODES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** L'état courant : la dernière version de chaque identifiant (sans les supprimés). Pur. */
export function etatCourant(versions: Version[]): { collections: Collection[]; environnements: Environnement[] } {
  const c = new Map<string, Collection>(), e = new Map<string, Environnement>();
  for (const v of versions) { if (v.genre === 'collection') c.set(v.c.id, v.c); else e.set(v.e.id, v.e); }
  return { collections: [...c.values()].filter((x) => !x.supprime), environnements: [...e.values()].filter((x) => !x.supprime) };
}

const VAR = /\{\{\s*([\w.-]+)\s*\}\}/g;
/**
 * Remplace les {{variables}} (puis {{@base64 texte}}). Une variable inconnue reste telle quelle : dans {{@base64 …}},
 * rien n'est alors encodé, pour que l'envoi la voie manquer (jamais « bob:{{MOT » encodé en douce). Le texte encodé
 * va jusqu'au dernier }} de la ligne : un mot de passe qui contient « } » est encodé en entier. Pur.
 */
export function substituer(t: string, vars: Record<string, string>): string {
  return t.replace(VAR, (m, n: string) => (Object.prototype.hasOwnProperty.call(vars, n) ? vars[n] : m))
    .replace(/\{\{@base64 ([^\n]*)\}\}/g, (m, x: string) => (VAR_RESTE.test(x) ? m : Buffer.from(x, 'utf8').toString('base64')));
}
const VAR_RESTE = /\{\{\s*[\w.-]+\s*\}\}/;
/** Les variables utilisées dans un texte. Pur. */
export const variablesDe = (t: string): string[] => [...new Set([...t.matchAll(VAR)].map((m) => m[1]))];

/** Lit un chemin JSON simple (a.b[0].c). Pur. */
export function cheminJson(obj: unknown, chemin: string): { existe: boolean; valeur?: unknown } {
  const parts = chemin.replace(/^\$\.?/, '').split(/\.|\[(\d+)\]/).filter((x) => x !== undefined && x !== '');
  let v: unknown = obj;
  for (const p of parts) {
    if (v === null || typeof v !== 'object') return { existe: false };
    const k = Array.isArray(v) && /^\d+$/.test(p) ? Number(p) : p;
    if (!(k in (v as Record<string | number, unknown>))) return { existe: false };
    v = (v as Record<string | number, unknown>)[k];
  }
  return { existe: true, valeur: v };
}

/** Lit les tests écrits un par ligne : « code = 200 », « temps < 500 », « json a.b existe », « json a.b = x », « json a.b contient x ». Pur. */
export function lireTests(t: string): Test[] {
  const out: Test[] = [];
  for (const l of t.split('\n').map((x) => x.trim()).filter(Boolean)) {
    let m: RegExpExecArray | null;
    if ((m = /^code\s*=+\s*(\d{3})$/i.exec(l))) out.push({ genre: 'code', valeur: m[1] });
    else if ((m = /^temps\s*<\s*(\d+)\s*(ms)?$/i.exec(l))) out.push({ genre: 'temps', valeur: m[1] });
    else if ((m = /^json\s+(\S+)\s+existe$/i.exec(l))) out.push({ genre: 'json_existe', chemin: m[1] });
    else if ((m = /^json\s+(\S+)\s+contient\s+(.+)$/i.exec(l))) out.push({ genre: 'json_contient', chemin: m[1], valeur: m[2] });
    else if ((m = /^json\s+(\S+)\s*=+\s*(.+)$/i.exec(l))) out.push({ genre: 'json_egal', chemin: m[1], valeur: m[2] });
    else throw new Error(`test illisible : « ${l} » (ex. code = 200, temps < 500, json data.id existe)`);
  }
  return out;
}
export function texteTest(t: Test): string {
  switch (t.genre) {
    case 'code': return `code = ${t.valeur}`;
    case 'temps': return `temps < ${t.valeur} ms`;
    case 'json_existe': return `json ${t.chemin} existe`;
    case 'json_egal': return `json ${t.chemin} = ${t.valeur}`;
    case 'json_contient': return `json ${t.chemin} contient ${t.valeur}`;
  }
}
/** Lit des en-têtes écrits un par ligne (« Nom: valeur »). Pur. */
export function lireEntetes(t: string): Entete[] {
  const out: Entete[] = [];
  for (const l of t.split('\n')) { const m = /^\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*:\s*(.*)$/.exec(l); if (m) out.push({ nom: m[1], valeur: m[2].trim() }); }
  return out;
}
/** Lit des variables écrites une par ligne (« nom=valeur »). Pur. */
export function lireVariables(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of t.split('\n')) { const m = /^\s*([\w.-]+)\s*=\s*(.*)$/.exec(l); if (m) out[m[1]] = m[2].trim(); }
  return out;
}
