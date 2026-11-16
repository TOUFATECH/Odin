// Gabarits de taille de Noûs, et le petit banc qui choisit la taille au premier lancement.
//
// La taille est fixée par la MESURE de la machine, pas par l'envie. Un grand modèle de langue, ce sont des milliards
// de poids ; la machine de la maison est un petit processeur sans carte graphique. Le réseau de Noûs est donc PETIT.
// Trois gabarits (largeurs multiples de 16) :
//   petit  C=64  / 4 couches / 2 têtes  (~0,47 M poids) — réservé aux essais.
//   moyen  C=128 / 8 couches / 4 têtes  (~2,1 M poids)  — le choix par défaut, mesuré sur la machine de travail.
//   grand  C=256 / 8 couches / 8 têtes  (~8,4 M poids)  — palier ultérieur, seulement si la machine suit.
// Vocabulaire 4096 et contexte 128 pour les trois (au-delà, la tête liée et l'attention en T² coûtent trop).

import { Reseau, disposition } from './calcul.ts';

export type TailleNom = 'petit' | 'moyen' | 'grand';
export interface Hyper { taille: TailleNom; C: number; couches: number; tetes: number; vocab: number; contexte: number; poids: number }

/** Les gabarits, sans le nombre de poids (calculé par la disposition). */
export const TAILLES: Record<TailleNom, Omit<Hyper, 'poids'>> = {
  petit: { taille: 'petit', C: 64, couches: 4, tetes: 2, vocab: 4096, contexte: 128 },
  moyen: { taille: 'moyen', C: 128, couches: 8, tetes: 4, vocab: 4096, contexte: 128 },
  grand: { taille: 'grand', C: 256, couches: 8, tetes: 8, vocab: 4096, contexte: 128 },
};

/** Complète un gabarit avec son nombre réel de poids. */
export function avecPoids(h: Omit<Hyper, 'poids'>): Hyper {
  const plein: Hyper = { ...h, poids: 0 };
  plein.poids = disposition(plein).total;
  return plein;
}
/** Le gabarit nommé, poids compris. */
export function hyperDe(taille: TailleNom): Hyper { return avecPoids(TAILLES[taille]); }

const ORDRE: TailleNom[] = ['petit', 'moyen', 'grand'];

/**
 * Banc rapide au premier lancement : mesure la vitesse d'entraînement du petit gabarit, l'extrapole aux autres par
 * le rapport des poids, et renvoie la plus grande taille (≤ cible) que la machine peut entraîner utilement. Ne
 * dépasse jamais ce qu'elle peut tenir. Par défaut on vise « moyen ».
 */
export async function mesurerEtChoisir(o: { cible?: TailleNom } = {}): Promise<Hyper> {
  const cible = o.cible ?? 'moyen';
  const petit = hyperDe('petit');
  const r = new Reseau(petit); r.initialiser(1);
  const ids = new Int32Array(petit.contexte);
  for (let i = 0; i < ids.length; i++) ids[i] = (i * 2654435761) % petit.vocab;
  // chauffe
  r.jeterGrad(); r.perteEtGrad(ids); r.jeterGrad();
  const t0 = performance.now(); let toks = 0, iters = 0;
  do { r.jeterGrad(); r.perteEtGrad(ids); r.jeterGrad(); toks += ids.length; iters++; } while (performance.now() - t0 < 200 && iters < 60);
  const secs = (performance.now() - t0) / 1000;
  const mpsPetit = toks / secs; // morceaux/s, 1 fil, gabarit petit
  // extrapolation grossière : le coût par pas est ~proportionnel au nombre de poids (à contexte égal).
  const estime = (h: Hyper): number => mpsPetit * (petit.poids / h.poids);
  const PLANCHER = 80; // en dessous, une nuit ne suffirait pas à remplir le réseau : on n'y va pas.
  const maxIdx = ORDRE.indexOf(cible);
  let choix: TailleNom = 'petit';
  for (let i = 0; i <= maxIdx; i++) { const h = hyperDe(ORDRE[i]); if (estime(h) >= PLANCHER) choix = ORDRE[i]; }
  return hyperDe(choix);
}
