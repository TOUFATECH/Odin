// Le comptable de la mémoire vive d'Odin : UN seul endroit où tout ce qu'Odin garde en mémoire pour aller plus vite
// (notes du Cerveau, recherche par le sens, aiguilleur de Soul…) demande sa part. Sans lui, trois caches qui se
// serviraient chacun « sur le libre » prendraient la mémoire trois fois.
//
//  - budgetLibreMo() : ce qu'on a le droit de prendre MAINTENANT, en mégaoctets. Calculé sur la mémoire LIBRE de la
//    machine (jamais sur le total) : on retire une marge laissée au système et aux autres programmes, on n'en prend
//    qu'une part, et on retire ce qui est déjà réservé. Volontairement prudent : une réservation déjà remplie compte
//    deux fois (elle a fait baisser la mémoire libre ET elle est retirée) ; mieux vaut un cache refusé qu'une machine
//    à court de mémoire.
//  - reserver(nom, mo) : réserve `mo` pour `nom` (remplace sa réservation d'avant : un cache qui grandit redemande son
//    total). Refuse (false) si le budget ne suffit pas ; la réservation d'avant reste alors telle quelle.
//  - rendre(nom) : rend tout ce que `nom` avait réservé.
//  - surPression(fn) : `fn` est appelée quand la machine manque de mémoire (la mémoire libre passe sous la marge) :
//    chacun vide ce qu'il garde puis rend sa part. Odin reste juste sans ses caches, seulement plus lent.
//
// La pression est vue à chaque demande au comptable, et par un coup d'œil toutes les 10 s (minuterie qui ne retient
// pas Odin ouvert). Pour les essais et les machines particulières : ODIN_MEMOIRE_LIBRE_MO remplace la mémoire libre
// lue sur la machine, ODIN_MEMOIRE_MARGE_MO la marge, ODIN_MEMOIRE_PLAFOND_MO le plafond de tout ce qui est réservé.

import { freemem } from 'node:os';

/** Marge laissée au système et aux autres programmes (Mo), sauf réglage. */
const MARGE_MO = 512;
/** Part de la mémoire disponible (libre − marge) qu'Odin s'autorise, pour tout ce qu'il garde ensemble. */
const PART = 0.5;
/** Plafond de tout ce qui est réservé ensemble (Mo), sauf réglage : même une machine très libre n'est pas vidée. */
const PLAFOND_MO = 4096;
/** Coup d'œil à la pression, en ms. */
const COUP_D_OEIL_MS = 10_000;

const reserves = new Map<string, number>();
const avertis = new Set<() => void>();
let minuterie: ReturnType<typeof setInterval> | undefined;
let enPression = false;

function nombreEnv(nom: string): number | undefined {
  const v = process.env[nom];
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
const libreMo = () => nombreEnv('ODIN_MEMOIRE_LIBRE_MO') ?? freemem() / 1_048_576;
const margeMo = () => nombreEnv('ODIN_MEMOIRE_MARGE_MO') ?? MARGE_MO;
const plafondMo = () => nombreEnv('ODIN_MEMOIRE_PLAFOND_MO') ?? PLAFOND_MO;
const totalReserve = (sauf?: string) => { let t = 0; for (const [k, v] of reserves) if (k !== sauf) t += v; return t; };

/**
 * La machine manque-t-elle de mémoire ? Alors tous ceux qui gardent quelque chose vident (une fois par passage sous la
 * marge : on ne revide pas en boucle tant qu'on y reste, mais on revide si quelqu'un a re-réservé entre-temps).
 */
function verifierPression(): boolean {
  const sous = libreMo() < margeMo();
  if (!sous) { enPression = false; return false; }
  if (enPression && totalReserve() === 0) return true;
  enPression = true;
  for (const fn of [...avertis]) { try { fn(); } catch { /* un cache qui échoue à se vider n'empêche pas les autres */ } }
  return true;
}

/** Budget disponible pour `nom` (sa propre réservation d'avant comptée comme rendue). */
function budgetPour(nom?: string): number {
  if (verifierPression()) return 0;
  const autres = totalReserve(nom);
  const disponible = Math.floor((libreMo() - margeMo()) * PART) - autres;
  return Math.max(0, Math.min(disponible, plafondMo() - autres));
}

/** Ce qu'on a le droit de prendre maintenant (Mo), calculé sur la mémoire libre moins une marge, jamais sur le total. */
export function budgetLibreMo(): number { return budgetPour(); }

/** Réserve `mo` mégaoctets pour `nom` (remplace sa réservation d'avant). Refuse si le budget ne suffit pas. */
export function reserver(nom: string, mo: number): boolean {
  if (!nom || !Number.isFinite(mo) || mo < 0) return false;
  if (mo > budgetPour(nom)) return false;
  reserves.set(nom, mo);
  return true;
}

/** Rend tout ce que `nom` avait réservé. */
export function rendre(nom: string): void { reserves.delete(nom); }

/** `fn` sera appelée quand la machine manque de mémoire : vider ce qu'on garde, puis `rendre`. */
export function surPression(fn: () => void): void {
  avertis.add(fn);
  if (!minuterie) { minuterie = setInterval(verifierPression, COUP_D_OEIL_MS); minuterie.unref?.(); }
}
