// Les trois étapes de l'apprentissage, À L'ÉCHELLE D'ODIN, côté « vie » (le lot B pilote ; le moteur, lot A,
// exécute). Ce module FABRIQUE les lots donnés au moteur, sans jamais rien tirer de Math.random : tout le
// hasard vient d'une graine rangée dans le point de reprise (essais reproductibles).
//
//  1. PRÉ-ENTRAÎNEMENT : prédire le morceau suivant, sur tout ce qu'Odin lit. Rejeu anti-oubli à chaque lot :
//     ~50 % de nouveau, ~30 % d'ancien tiré à la graine, ~20 % de rappel actif.
//  2. AJUSTEMENT : des paires demande → réponse avec des jetons de rôle (on n'apprend pas « sur la demande »).
//  3. ALIGNEMENT : exemples pondérés par |note − confiance| (au moins 0,1) ; la préférence du duel se joue
//     côté moteur (la gagnante plus probable que la perdante).
//
// Score d'importance et espacement (J+1, J+3, J+7, J+30) décident de ce qui est rejoué et avec quel poids.

import type { ExempleCorpus } from './corpus.ts';

/** Le format d'un lot donné au moteur (contrat §2 ; structurellement compatible avec l'export du moteur). */
export interface Lot { entrees: Int32Array[]; roles?: Int32Array[]; poidsExemple?: Float32Array }

// ---------------------------------------------------------------------------------------------------
// Hasard à graine (mulberry32). Pas de Math.random : la graine est rangée dans le point de reprise.
export function prng(graine: number): () => number {
  let a = graine >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tire `n` éléments d'un tableau sans remise, avec la graine (mélange de Fisher–Yates partiel). */
export function tirer<T>(xs: readonly T[], n: number, rng: () => number): T[] {
  const a = xs.slice();
  const m = Math.min(n, a.length);
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, m);
}

// ---------------------------------------------------------------------------------------------------
// Importance et espacement.

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** Signaux mesurés (aucune émotion simulée) qui donnent l'importance d'un exemple. */
export interface SignauxImportance { correction: boolean; surprise: number; repetitions: number; marque: boolean; nouveaute: number }

/** importance = 1 + 3×correction + 2×surprise + 1×log(1+répétitions) + 2×marquage + 1×nouveauté. */
export function importance(s: SignauxImportance): number {
  return 1
    + 3 * (s.correction ? 1 : 0)
    + 2 * clamp01(s.surprise)
    + 1 * Math.log1p(Math.max(0, s.repetitions || 0))
    + 2 * (s.marque ? 1 : 0)
    + 1 * clamp01(s.nouveaute);
}

const JOUR = 86_400_000;
/** Un exemple important revient aux nuits J+1, J+3, J+7 et J+30 (au lieu d'être répété dix fois la même nuit). */
export const ESPACEMENT = [1, 3, 7, 30] as const;
const SEUIL_IMPORTANT = 3; // au-dessus, on applique l'espacement complet ; sinon seulement J+1.

/** Cet exemple doit-il être rejoué cette nuit, selon son âge (en nuits) et son importance ? */
export function aRejouerCetteNuit(exempleAt: number, maintenant: number, imp: number): boolean {
  const nuits = Math.floor(Math.max(0, maintenant - exempleAt) / JOUR);
  if (nuits <= 0) return false;
  if (imp >= SEUIL_IMPORTANT) return (ESPACEMENT as readonly number[]).includes(nuits);
  return nuits === 1;
}

// ---------------------------------------------------------------------------------------------------
// Composition d'un lot (rejeu anti-oubli 50 / 30 / 20).

/** Compose un lot : ~50 % de nouveau (en tête), ~30 % d'ancien tiré à la graine, ~20 % de rappel actif. */
export function composerLot(
  nouveaux: readonly ExempleCorpus[],
  anciens: readonly ExempleCorpus[],
  rappelActif: readonly ExempleCorpus[],
  taille: number,
  rng: () => number,
): ExempleCorpus[] {
  const nNouveau = Math.round(0.5 * taille);
  const nAncien = Math.round(0.3 * taille);
  const nRappel = Math.max(0, taille - nNouveau - nAncien);
  const part = [
    ...nouveaux.slice(0, nNouveau),
    ...tirer(anciens, nAncien, rng),
    ...tirer(rappelActif, nRappel, rng),
  ];
  // Mélange final à la graine pour ne pas présenter les trois blocs dans l'ordre.
  return tirer(part, part.length, rng);
}

/** Étape 1 : un lot de pré-entraînement = les morceaux des exemples (prédire le morceau suivant). */
export function lotPreEntrainement(exemples: readonly ExempleCorpus[]): Lot {
  return { entrees: exemples.map((e) => e.morceaux) };
}

// ---------------------------------------------------------------------------------------------------
// Étape 2 : ajustement avec jetons de rôle.

/** Les identifiants de jetons de rôle (réservés par le découpage du moteur), passés par l'appelant. */
export interface JetonsRole { demandeDebut: number; reponseDebut: number; fin: number }

/**
 * LA forme d'une paire « demande → réponse », la même à l'entraînement et à l'usage (défaut 2 de l'entraînement) :
 * [USER] demande [ASSISTANT] réponse [EOS]. Des jetons de rôle, aucun mot : rien ne dépend d'une langue.
 * (Valeurs de SPECIAUX, decoupage.ts : USER = 3, ASSISTANT = 4, EOS = 2.)
 */
export const JETONS_ROLE: JetonsRole = { demandeDebut: 3, reponseDebut: 4, fin: 2 };
/** Une demande présentée au réseau à l'usage (proposer, score) : [USER] demande [ASSISTANT]. */
export function formeDemande(demande: ArrayLike<number>, j: JetonsRole = JETONS_ROLE): Int32Array { return Int32Array.from([j.demandeDebut, ...Array.from(demande), j.reponseDebut]); }
/** Une réponse à juger (score) : réponse [EOS]. */
export function formeReponse(reponse: ArrayLike<number>, j: JetonsRole = JETONS_ROLE): Int32Array { return Int32Array.from([...Array.from(reponse), j.fin]); }

/** Construit une entrée demande → réponse et son masque de rôles (0 = ne pas apprendre sur la demande). */
export function paireAjustement(demande: Int32Array, reponse: Int32Array, jetons: JetonsRole): { entree: Int32Array; roles: Int32Array } {
  const entree = Int32Array.from([jetons.demandeDebut, ...demande, jetons.reponseDebut, ...reponse, jetons.fin]);
  const roles = new Int32Array(entree.length);
  // On apprend seulement à partir du jeton « réponse » (compris) jusqu'à la fin.
  const debutReponse = 1 + demande.length; // position du jeton reponseDebut
  for (let i = debutReponse; i < entree.length; i++) roles[i] = 1;
  return { entree, roles };
}

/** Garde seulement ce qui peut servir à l'ajustement (étape 2) : exemples fiables, hors simple lecture. */
export function filtrerPourAjustement(ex: readonly ExempleCorpus[]): ExempleCorpus[] {
  return ex.filter((e) => e.fiable && e.sorte !== 'lecture');
}

// ---------------------------------------------------------------------------------------------------
// Étape 3 : alignement pondéré.

/** Poids d'un exemple d'alignement : |note − confiance|, au moins 0,1. Une proposition sûre et refusée
 *  apprend beaucoup ; une proposition sûre et acceptée, presque rien. */
export function poidsAlignement(note: number, confiance: number): number {
  const n = clamp01(note), c = clamp01(confiance);
  return Math.max(0.1, Math.abs(n - c));
}

/** Construit le tableau de poids d'exemples pour un lot d'alignement. */
export function poidsLot(notes: readonly number[], confiances: readonly number[]): Float32Array {
  const n = Math.min(notes.length, confiances.length);
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = poidsAlignement(notes[i], confiances[i]);
  return w;
}
