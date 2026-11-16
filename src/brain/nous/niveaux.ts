// Les trois niveaux d'une réponse, et qui répond seul. Inspiré du fonctionnement du cerveau (arbitrage par
// l'incertitude, suivi des conflits, valeur attendue du contrôle) — une IMAGE, pas une mesure du cerveau.
//  - N1 (réflexe)  : Noûs et des contrôles éclair ; aucun grand modèle appelé.
//  - N2 (vérifié)  : Noûs et UN fait du Cerveau.
//  - N3 (réfléchi) : le chemin complet d'Odin (raisonnement, outils, grand modèle si réglé).
// Un sujet sensible est TOUJOURS en N3 ; Noûs n'y déclenche jamais d'action.
//
// Module pur : décisions prises à partir de nombres mesurés (fiabilité, calibration), jamais d'un hasard.

import { wilsonLow } from './compteurs.ts';

export type Niveau = 1 | 2 | 3;

/** Seuils écrits (réglables côté config). */
export const SEUILS = {
  reflexe: 0.90,       // borne basse de Wilson exigée pour le réflexe N1
  essaisMin: 30,       // nombre d'essais/duels notés exigé
  calibMax: 0.05,      // écart de calibration maximal sur le domaine
  margeConflit: 0.10,  // écart de proba moyenne sous lequel deux propositions de Noûs sont « presque à égalité »
  confFaible: 0.70,    // en dessous, la surface reprend la main
  enjeuFaible: 0.30,   // enjeu au-dessus duquel le réflexe N1 est refusé
  coutSurface: 0.10,   // coût normalisé d'un passage en surface (temps, appel payant)
  erreursPourN3: 2,    // nombre d'erreurs dans la fenêtre qui fait redescendre en N3
} as const;

/** Ce que le domaine a mesuré jusqu'ici. */
export interface EtatDomaine {
  succes: number;          // essais réussis (pour la fiabilité de Wilson)
  essais: number;          // essais ou duels notés
  ece: number;             // écart de calibration mesuré sur le domaine (0 = parfait)
  erreursRecentes: number; // erreurs dans la fenêtre de vigilance (10 demandes ou 24 h)
  vigilance: boolean;      // une période de vigilance est ouverte
  surpriseMoyenne: number; // erreur de prédiction moyenne du domaine
  seuilSurprise: number;   // au-dessus, la surface reprend la main
}

/** Les signaux de la demande en cours (fournis par le profond et la surface). */
export interface Signaux {
  sensible: boolean;              // sécurité, argent, santé, action sur une appli
  reversible: boolean;            // la réponse/action est réversible
  margeNoos: number;              // écart de proba entre les deux meilleures propositions de Noûs
  contreditFait: boolean;         // la proposition contredit un fait écrit ou confirmé
  odinNoosDesaccord: boolean;     // le chemin rapide d'Odin et Noûs ne sont pas d'accord
  predictionRecenteEchouee: boolean;
  confiance: number;              // confiance calibrée de la proposition (0–1)
  nouvelle: boolean;              // demande nouvelle (pas de voisin proche)
  appuiCerveau: boolean;          // un fait du Cerveau appuie la réponse
  enjeu: number;                  // 0–1 : irréversible, argent, données personnelles, message envoyé
}

export function etatDomaineVide(): EtatDomaine {
  return { succes: 0, essais: 0, ece: 0, erreursRecentes: 0, vigilance: false, surpriseMoyenne: 0, seuilSurprise: 0.3 };
}

/** Fiabilité mesurée du domaine : borne basse de Wilson sur les essais notés. */
export function fiabilite(d: EtatDomaine): number {
  return wilsonLow(d.succes, d.essais);
}

/**
 * Une alerte de conflit réveille la surface (N3). Conditions (contrat) :
 *  - les deux meilleures propositions de Noûs sont presque à égalité (marge < margeConflit) ;
 *  - la proposition contredit un fait écrit ou confirmé ;
 *  - le chemin rapide d'Odin et Noûs ne sont pas d'accord ;
 *  - une prédiction récente a échoué ;
 *  - l'erreur de prédiction du domaine dépasse son seuil (surprise).
 */
export function conflit(s: Signaux, d: EtatDomaine): boolean {
  return (
    s.margeNoos < SEUILS.margeConflit ||
    s.contreditFait ||
    s.odinNoosDesaccord ||
    s.predictionRecenteEchouee ||
    d.surpriseMoyenne > d.seuilSurprise
  );
}

/**
 * Le réflexe N1 est-il autorisé pour ce domaine ? Toutes les conditions doivent tenir :
 *  (a) non sensible et réversible ; (b) fiabilité ≥ 0,90 (Wilson) sur ≥ 30 essais ;
 *  (c) écart de calibration ≤ 0,05 ; (d) aucune alerte de conflit ;
 *  (e) aucune erreur pendant la période de vigilance.
 */
export function reflexeAutorise(d: EtatDomaine, s: Signaux, seuilReflexe: number = SEUILS.reflexe): boolean {
  if (s.sensible || !s.reversible) return false;
  if (d.essais < SEUILS.essaisMin) return false;
  if (fiabilite(d) < seuilReflexe) return false;
  if (d.ece > SEUILS.calibMax) return false;
  if (conflit(s, d)) return false;
  if (d.vigilance && d.erreursRecentes > 0) return false;
  return true;
}

/** Valeur du contrôle : passer en surface (N3) si l'enjeu × l'incertitude dépasse le coût d'un passage. */
export function valeurDuControle(s: Signaux, coutSurface: number = SEUILS.coutSurface): boolean {
  const incertitude = 1 - Math.max(0, Math.min(1, s.confiance));
  return s.enjeu * incertitude > coutSurface;
}

/**
 * Choisit le niveau d'une demande. Un sujet sensible ou un conflit force N3. Un domaine fiable, calibré,
 * à faible enjeu et réversible donne N1. Sinon, un fait du Cerveau donne N2 ; sinon N3. Aucun hasard.
 */
export function choisirNiveau(d: EtatDomaine, s: Signaux, o: { seuilReflexe?: number; coutSurface?: number } = {}): Niveau {
  if (s.sensible) return 3;
  if (conflit(s, d)) return 3;
  if (s.confiance < SEUILS.confFaible || s.nouvelle) return s.appuiCerveau ? 2 : 3;
  if (valeurDuControle(s, o.coutSurface)) return 3;
  if (reflexeAutorise(d, s, o.seuilReflexe) && s.reversible && s.enjeu <= SEUILS.enjeuFaible) return 1;
  if (s.appuiCerveau) return 2;
  return 3;
}

/**
 * Met à jour l'état du domaine après un résultat observé. Une erreur ouvre la vigilance ; deux erreurs dans
 * la fenêtre signalent qu'il faut redescendre en N3 (à l'appelant de ne plus autoriser N1). `fenetreOuverte`
 * borne la fenêtre de vigilance (10 demandes ou 24 h gérées par l'appelant).
 */
export function appliquerResultat(d: EtatDomaine, juste: boolean, confiance: number): EtatDomaine {
  const essais = d.essais + 1;
  const succes = d.succes + (juste ? 1 : 0);
  const erreursRecentes = juste ? d.erreursRecentes : d.erreursRecentes + 1;
  const vigilance = juste ? d.vigilance : true;
  // La surprise moyenne suit l'écart entre la confiance annoncée et le résultat (lissage simple).
  const ecart = Math.abs((Number.isFinite(confiance) ? confiance : 0) - (juste ? 1 : 0));
  const surpriseMoyenne = 0.8 * d.surpriseMoyenne + 0.2 * ecart;
  return { ...d, essais, succes, erreursRecentes, vigilance, surpriseMoyenne };
}

/** Faut-il redescendre en N3 (deux erreurs ou plus dans la fenêtre de vigilance) ? */
export function redescendreEnN3(d: EtatDomaine): boolean {
  return d.erreursRecentes >= SEUILS.erreursPourN3;
}
