// Mesure de la machine — ce qu'elle peut faire tourner, d'après de VRAIS chiffres (vitesse de calcul, mémoire libre),
// jamais d'après une promesse. Sert à refuser poliment un modèle trop gros AVANT de le charger, et à conseiller la
// bonne taille. Sur un petit processeur sans carte graphique, seuls les petits modèles sont utilisables : on le dit.
//
// On réutilise les noyaux de calcul de Noûs (src/brain/nous/wasm.ts) : le même produit de matrices qui sert au
// moteur donne la vitesse brute (GFLOP/s), sans refaire de banc à part.

import { freemem } from 'node:os';
import { noyaux } from '../nous/wasm.ts';
import type { CapaciteMachine } from './types.ts';

const MO = 1024 * 1024;

/** Mesure la vitesse brute de la machine (GFLOP/s) sur un produit de matrices, via les noyaux de Noûs. */
export async function capaciteMachine(): Promise<CapaciteMachine> {
  const gflops = Math.max(0.01, noyaux().mesure(192));
  const ramLibreMo = Math.floor(freemem() / MO);
  // Un modèle doit tenir à l'aise en mémoire (poids lus par morceaux, mais déquantification et mémoire des clés/
  // valeurs ont besoin de place). On garde une marge : au plus la moitié de la mémoire libre.
  const octetsMax = Math.floor((ramLibreMo * MO) * 0.5);
  return { gflops, ramLibreMo, octetsMax };
}

/** Vrai si un modèle de cette taille (octets du fichier) peut être chargé sans dépasser la mémoire. Note : c'est une
 *  borne GROSSIÈRE (taille sur le disque). La décision fine de chargement se fait sur la GÉOMÉTRIE réelle du modèle,
 *  via memoireNecessaireOctets ci-dessous, car un fichier Q4 pèse ~7× plus une fois déquantifié en flottants. */
export function peutCharger(tailleOctets: number, cap: CapaciteMachine): boolean {
  return tailleOctets > 0 && tailleOctets <= cap.octetsMax;
}

/**
 * Mémoire résidente estimée d'un modèle une fois chargé, d'après sa GÉOMÉTRIE (pas la taille du fichier) :
 *   - les poids sont TOUS matérialisés en flottants 32 bits : ~4 octets par paramètre (environ 7× un fichier Q4) ;
 *   - la mémoire d'attention : L couches × 2 (clés + valeurs) × Tmax positions × kvDim × 4 octets.
 * C'est cette valeur qui doit décider si la machine peut tenir le modèle, et qui permet de refuser poliment un modèle
 * à géométrie démesurée AVANT d'allouer quoi que ce soit.
 */
export function memoireNecessaireOctets(parametres: number, L: number, Tmax: number, kvDim: number): number {
  const poids = Math.max(0, parametres) * 4;
  const kv = Math.max(0, L) * 2 * Math.max(0, Tmax) * Math.max(0, kvDim) * 4;
  return poids + kv;
}

/** Estime le nombre de paramètres encore « utilisable » (quelques morceaux par seconde) d'après la vitesse mesurée. */
function parametresUtilisables(gflops: number): number {
  // Un pas de génération fait ~2 opérations par paramètre (produit matrice-vecteur). Pour viser ~3 morceaux/s :
  //   morceaux/s ≈ gflops·1e9 / (2·paramètres)  ⇒  paramètres ≈ gflops·1e9 / (2·3).
  const vise = 3;
  return (gflops * 1e9) / (2 * vise);
}

/** Conseille, en toutes lettres, la taille de modèle raisonnable sur cette machine, avec le chiffre mesuré. */
export function tailleConseillee(cap: CapaciteMachine): string {
  const paramsMax = parametresUtilisables(cap.gflops);
  const milliards = paramsMax / 1e9;
  const ramGo = (cap.ramLibreMo / 1024).toFixed(1);
  let taille: string;
  if (milliards < 1.2) taille = 'un petit modèle (environ 1 milliard de paramètres, quantifié en Q4 ≈ 0,7 Go)';
  else if (milliards < 3.5) taille = 'un modèle jusqu\'à 3 milliards de paramètres (quantifié en Q4 ≈ 2 Go)';
  else taille = 'un modèle jusqu\'à 7 milliards de paramètres (quantifié en Q4 ≈ 4,5 Go)';
  return `Vitesse de calcul mesurée : ${cap.gflops.toFixed(1)} GFLOP/s, ${ramGo} Go de mémoire libre. `
    + `Sur cette machine (sans carte graphique), vise ${taille}. `
    + 'Métis affiche la vitesse réelle de chaque modèle une fois mesuré.';
}
