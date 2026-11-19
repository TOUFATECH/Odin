// Les données privées des réglages (numéros de téléphone, adresses mail, identifiants des propriétaires, position de
// la maison) ne sont jamais écrites en clair : ni dans les fichiers du dossier d'Odin, ni dans les copies d'annulation,
// ni dans la base d'Odin. Elles sont chiffrées champ par champ avec la clé de la machine (vault.ts : chiffrerChamp) ;
// Odin les lit déchiffrées en mémoire, la page reçoit ce qu'elle recevait déjà.
import { readFileSync, writeFileSync } from 'node:fs';
import { champChiffre, chiffrerChamp, dechiffrerChamp } from './vault.ts';

/** Un chemin dans un objet de réglages ; « * » = chaque clé de l'objet à cet endroit. */
export type Chemin = readonly string[];

/** config.json : propriétaires des messageries (identifiants Telegram, numéros, adresses), numéro Signal, compte mail. */
export const PRIVES_CONFIG: Chemin[] = [
  ['channels', '*', 'owners'], ['channels', 'signal', 'number'], ['channels', 'whatsapp', 'phoneId'],
  ['mail', 'user'], ['mail', 'from'], ['calendar', 'caldavUser'],
];
/** réglages.json des applis : la position de la maison (Hestia), les informations des personnes de Persona. */
export const PRIVES_APPLIS: Record<string, Chemin[]> = {
  gladsheim: [['lat'], ['lon']],
  var: [['people', '*', 'naissance'], ['people', '*', 'langue']],
};
/** Réglages gardés dans la mémoire d'Odin (memoire/kv.jsonl) : les numéros du réveil. */
export const PRIVES_KV: Record<string, Chemin[]> = {
  alarm: [['phone'], ['twilioFrom'], ['haPhone']],
};

type Obj = Record<string, unknown>;
const estObjet = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Valeur vide : rien à cacher (et les valeurs par défaut restent lisibles). */
const vide = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Parcourt les valeurs d'un objet aux chemins donnés : f(parent, clé). « * » entre aussi dans un tableau (chaque élément). */
function parcourir(o: unknown, chemins: readonly Chemin[], f: (parent: Obj, cle: string) => void): void {
  const pas = (n: unknown, c: Chemin): void => {
    if (!c.length) return;
    const [k, ...reste] = c;
    if (!estObjet(n) && !(k === '*' && Array.isArray(n))) return;
    const o = n as Obj;
    for (const cle of k === '*' ? Object.keys(o) : [k]) {
      if (!(cle in o)) continue;
      if (reste.length) pas(o[cle], reste); else f(o, cle);
    }
  };
  for (const c of chemins) pas(o, c);
}
const copie = <T>(o: T): T => (o === undefined ? o : JSON.parse(JSON.stringify(o)) as T);

/** Une copie de l'objet où les valeurs privées sont chiffrées (celles déjà chiffrées restent telles quelles). */
export function fermer<T>(home: string, o: T, chemins: readonly Chemin[]): T {
  const c = copie(o);
  parcourir(c, chemins, (p, k) => { const v = p[k]; if (!vide(v) && !champChiffre(v)) p[k] = chiffrerChamp(home, JSON.stringify(v)); });
  return c;
}

let dejaDit = false;
/** Déchiffre une valeur (toute valeur « odc1: ») ; illisible (clé de la machine perdue) : undefined. */
function ouvrirValeur(home: string, v: string): unknown {
  try { return JSON.parse(dechiffrerChamp(home, v)); } catch (e) {
    if (!dejaDit) { dejaDit = true; console.error(`[réglages] valeur privée illisible (${(e as Error).message}) : à ressaisir dans Réglages`); }
    return undefined;
  }
}
/** Une copie de l'objet où chaque valeur chiffrée (n'importe où) est déchiffrée ; illisible : la clé est retirée. */
export function ouvrir<T>(home: string, o: T): T {
  const pas = (n: unknown): unknown => {
    if (champChiffre(n)) return ouvrirValeur(home, n);
    if (Array.isArray(n)) return n.map(pas);
    if (estObjet(n)) { const r: Obj = {}; for (const [k, v] of Object.entries(n)) { const x = pas(v); if (x !== undefined || v === undefined) r[k] = x; } return r; }
    return n;
  };
  return pas(o) as T;
}

/** Reste-t-il une valeur privée en clair (à chiffrer : migration) ? */
export function enClair(o: unknown, chemins: readonly Chemin[]): boolean {
  let oui = false;
  parcourir(o, chemins, (p, k) => { if (!vide(p[k]) && !champChiffre(p[k])) oui = true; });
  return oui;
}

/** Migration d'un réglages.json encore en clair : la position de la maison est aussi ramenée à ~100 m. */
export function migrerAppli(id: string, s: Record<string, unknown>): void {
  if (id !== 'gladsheim') return;
  for (const k of ['lat', 'lon']) { const v = Number(s[k]); if (s[k] !== '' && s[k] !== undefined && Number.isFinite(v)) s[k] = Math.round(v * 1e3) / 1e3; }
}

/** Les chemins privés d'un réglages.json d'appli (aucun pour la plupart). */
export const privesAppli = (id: string): Chemin[] => PRIVES_APPLIS[id] ?? [];

/** Une coordonnée gardée arrondie à 3 décimales (~100 m) : assez pour la météo et l'heure, pas pour trouver la maison. */
export const arrondirPosition = (x: number): number => Math.round(x * 1e3) / 1e3;

/** Un fichier JSON entièrement privé (positions de la famille) : écrit chiffré d'un bloc. */
export function ecrireFichierPrive(home: string, fichier: string, o: unknown): void {
  writeFileSync(fichier, chiffrerChamp(home, JSON.stringify(o)), { mode: 0o600 });
}
/** Lit un fichier écrit par ecrireFichierPrive (ou encore en clair, ancien Odin) ; illisible ou absent : undefined. */
export function lireFichierPrive<T>(home: string, fichier: string): T | undefined {
  try { const t = readFileSync(fichier, 'utf8'); return JSON.parse(champChiffre(t) ? dechiffrerChamp(home, t) : t) as T; } catch { return undefined; }
}

/** Un texte de kv (JSON) dont les champs privés sont chiffrés ; texte non JSON : rendu tel quel. */
export function fermerKv(home: string, cle: string, valeur: string): string {
  const ch = PRIVES_KV[cle]; if (!ch || !valeur) return valeur;
  try { const o = JSON.parse(valeur) as unknown; return enClair(o, ch) ? JSON.stringify(fermer(home, o, ch)) : valeur; } catch { return valeur; }
}
/** Le texte de kv déchiffré (pour Odin, en mémoire). */
export function ouvrirKv(home: string, cle: string, valeur: string): string {
  if (!PRIVES_KV[cle] || !valeur.includes('odc1:')) return valeur;
  try { return JSON.stringify(ouvrir(home, JSON.parse(valeur) as unknown)); } catch { return valeur; }
}
