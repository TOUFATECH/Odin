// Noûs — l'OUBLI. Quand le propriétaire efface un souvenir (« oublie ça », corbeille, effacement depuis une appli), ce que
// Soul en a appris doit partir aussi, et ne plus pouvoir revenir :
//   1. le souvenir est noté dans le registre des oublis (`cerveau-reseau/oublis.json`) : son identifiant et des EMPREINTES
//      de ses lignes (jamais le texte : garder le texte oublié serait ne pas l'oublier) ;
//   2. les exemples encore dans la file d'attente qui le portent sont retirés tout de suite ; le pilote d'entraînement
//      jette la tranche qu'il avait préparée ;
//   3. au passage suivant du lecteur de la file, les tranches du corpus sont relues une fois et réécrites sans eux ;
//   4. tout exemple qui arrive ensuite et porte ce souvenir (même identifiant, ou une ligne de même empreinte) est écarté.
// Les lignes sont comparées sur une forme REPLIÉE (sans accents, casse, ponctuation ni espaces) : la même phrase sans
// son point final, avec une minuscule, ou précédée d'un mot (« Note : … ») est reconnue — les longues lignes aussi
// quand elles sont CONTENUES dans une autre. Aucune hypothèse de langue : lettres et chiffres de toutes les écritures.
// Ce qui ne s'efface PAS exemple par exemple : les POIDS déjà entraînés et les morceaux du découpage. Seul un retour à un
// point de reprise antérieur, ou un réentraînement, le fait ; la page le dit.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileApprentissage } from './deps.ts';
import { nettoyagePourNous } from './entree.ts';

/** Bornes du registre ; FENETRE : une longue ligne oubliée est aussi reconnue DANS une autre (son début replié). */
export const OUBLIS_MAX = 100_000, LIGNE_MIN = 12, FENETRE = 40;

export interface RegistreOublisJson { version: 1; ids: number[]; cles: string[]; fenetres?: string[]; aPurger: boolean }

/**
 * La forme repliée d'un texte pour comparer : sans accents ni casse, sans ponctuation ni espaces — seulement les lettres
 * et les chiffres, de toutes les écritures. « Le code est caché. » = « le code est cache ». Pur.
 */
export function plierComparable(t: string): string {
  return String(t ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
const hacher = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 24);
/** L'empreinte d'une ligne, sur sa forme repliée. Pure. */
export const cleLigne = (ligne: string): string => hacher(plierComparable(ligne));
/** L'empreinte du DÉBUT replié d'une longue ligne (FENETRE caractères), ou rien si elle est courte. */
const fenetreDe = (ligne: string): string | undefined => { const p = plierComparable(ligne); return p.length >= FENETRE ? hacher(p.slice(0, FENETRE)) : undefined; };

/** Les lignes d'un texte qui comptent pour l'oubli (assez longues pour ne pas emporter des lignes banales). Pur. */
export function lignesOubli(texte: string): string[] {
  return String(texte ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => plierComparable(l).length >= LIGNE_MIN);
}

const fichier = (home: string) => join(home, 'cerveau-reseau', 'oublis.json');

export function lireOublis(home: string): RegistreOublisJson {
  try {
    const j = JSON.parse(readFileSync(fichier(home), 'utf8')) as RegistreOublisJson;
    if (j && j.version === 1 && Array.isArray(j.ids) && Array.isArray(j.cles)) return { version: 1, ids: j.ids.filter(Number.isFinite), cles: j.cles.filter((x) => typeof x === 'string'), fenetres: Array.isArray(j.fenetres) ? j.fenetres.filter((x) => typeof x === 'string') : [], aPurger: j.aPurger === true };
  } catch { /* pas encore de registre, ou abîmé : on repart d'un registre vide (rien n'est perdu de la mémoire) */ }
  return { version: 1, ids: [], cles: [], fenetres: [], aPurger: false };
}

export function ecrireOublis(home: string, r: RegistreOublisJson): void {
  mkdirSync(join(home, 'cerveau-reseau'), { recursive: true });
  const tmp = `${fichier(home)}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, ids: r.ids.slice(-OUBLIS_MAX), cles: r.cles.slice(-OUBLIS_MAX), fenetres: (r.fenetres ?? []).slice(-OUBLIS_MAX), aPurger: r.aPurger }), { mode: 0o600 });
  renameSync(tmp, fichier(home));
}

/** Prévenus à chaque oubli (le pilote d'entraînement jette la tranche qu'il avait préparée). */
export const quandOubli = new Set<(home: string) => void>();

/** Un filtre rapide sur le registre (ensembles en mémoire). */
export interface FiltreOublis { ids: Set<number>; cles: Set<string>; fenetres: Set<string>; vide: boolean }
export function filtreOublis(r: RegistreOublisJson): FiltreOublis {
  const fen = r.fenetres ?? [];
  return { ids: new Set(r.ids), cles: new Set(r.cles), fenetres: new Set(fen), vide: !r.ids.length && !r.cles.length && !fen.length };
}

/** Une ligne est-elle oubliée ? Égale (forme repliée) à une ligne oubliée, ou CONTENANT le début d'une longue ligne oubliée. */
function ligneOubliee(l: string, f: FiltreOublis): boolean {
  const p = plierComparable(l);
  if (p.length < LIGNE_MIN) return false;
  if (f.cles.has(hacher(p))) return true;
  if (f.fenetres.size && p.length >= FENETRE) for (let i = 0; i + FENETRE <= p.length; i++) if (f.fenetres.has(hacher(p.slice(i, i + FENETRE)))) return true;
  return false;
}

/**
 * Ce qui reste d'un texte une fois retirées les lignes oubliées (ou `undefined` si l'exemple entier est oublié : même
 * identifiant de souvenir, ou plus rien d'utile). Pur.
 */
export function sansOublis(texte: string, idSouvenir: number | undefined, f: FiltreOublis): string | undefined {
  if (f.vide) return texte;
  if (idSouvenir !== undefined && f.ids.has(idSouvenir)) return undefined;
  const lignes = String(texte ?? '').split(/\r?\n/);
  const gardees = lignes.filter((l) => !ligneOubliee(l, f));
  if (gardees.length === lignes.length) return texte;
  const reste = gardees.join('\n');
  return reste.trim() ? reste : undefined;
}

/**
 * Note l'oubli d'un souvenir (ou d'un texte : une note mise à la corbeille). Retire tout de suite de la file ce qui le
 * porte et prévient le pilote ; le corpus sera purgé au prochain passage du lecteur de la file. Ne lève jamais.
 */
export function noterOubli(home: string, o: { id?: number; texte?: string }, file?: FileApprentissage): void {
  try {
    if (!home) return;
    const r = lireOublis(home);
    const propre = nettoyagePourNous(String(o.texte ?? ''));
    const lignes = [...lignesOubli(String(o.texte ?? '')), ...lignesOubli(propre)];
    const cles = new Set(lignes.map(cleLigne));
    if (Number.isFinite(o.id)) r.ids.push(Number(o.id));
    for (const c of cles) r.cles.push(c);
    r.fenetres = [...(r.fenetres ?? []), ...new Set(lignes.map(fenetreDe).filter((x): x is string => Boolean(x)))];
    if (!cles.size && !Number.isFinite(o.id)) return;
    r.aPurger = true;
    ecrireOublis(home, r);
    const f = filtreOublis(r);
    file?.retirerSi?.((e) => sansOublis(e.texte || `${e.demande}\n${e.reponse}`, e.idSouvenir, f) === undefined);
    for (const g of quandOubli) { try { g(home); } catch { /* jamais bloquant */ } }
  } catch { /* l'oubli de la mémoire ne dépend jamais de Noûs */ }
}
