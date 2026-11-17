// L'ordonnancement jour/nuit de l'apprentissage de Noûs, avec la PORTE DE QUALITÉ et le RETOUR ARRIÈRE.
// Règle d'or : ne jamais gêner Odin, ne jamais empirer.
//  - Jour : 1 fil, ~2 min, étape 1 seulement, arrêt dès qu'Odin doit répondre (gateway.aborts.size > 0) ou
//    que la machine est chargée. Les poids EN SERVICE ne changent pas (séance sur une copie de travail).
//  - Nuit : jusqu'à 8 h, 3 fils, les trois étapes, rejeu espacé. Les poids en service ne changent qu'à un
//    point de reprise qui fait MIEUX sur le banc tenu à part ; retour arrière automatique si la perte diverge.
//
// Le moteur (lot A) est décrit ici par une interface minimale, structurellement compatible avec l'Entraîneur
// du contrat §2, pour que l'ordonnancement se teste avec un faux moteur avant l'intégration.

import type { Lot } from './etapes.ts';

/** Avancée d'une séance (contrat §2). */
export interface Avancee { pas: number; morceauxVus: number; perte: number; tempsMs: number; interrompue: boolean; /** Exemples sans rien à apprendre (comptés à part). */ sansCible?: number }
/** Réglages d'une séance (contrat §2). */
export interface SeanceOpts { dureeMs: number; fils: number; signal: AbortSignal; graine: number }

/** Ce dont l'ordonnancement se sert dans le moteur (sous-ensemble de l'Entraîneur du contrat). */
export interface EntraineurMin {
  seance(lots: Iterable<Lot> | AsyncIterable<Lot>, o: SeanceOpts): Promise<Avancee>;
  perteSur(jeu: Int32Array[]): Promise<number>; // banc tenu à part, PORTE DE QUALITÉ
  ecrire(n: number): Promise<string>;            // écrit reprise-<n>.bin d'un seul coup
  revenirA(n: number): Promise<void>;            // retour arrière
}

/** La perte a-t-elle divergé ? (valeur infinie ou non numérique, ou qui remonte au-delà d'une marge). */
export function divergence(perteAvant: number, perteApres: number): boolean {
  if (!Number.isFinite(perteApres)) return true;
  if (!Number.isFinite(perteAvant)) return false; // pas de point de comparaison fiable
  return perteApres > perteAvant * 1.01; // remontée nette (1 % de marge contre le bruit)
}

/** Porte de qualité : le nouveau réseau ne passe en service que s'il fait STRICTEMENT mieux sur le banc. */
export function porteDeQualite(perteAvant: number, perteApres: number): boolean {
  return Number.isFinite(perteApres) && Number.isFinite(perteAvant) && perteApres < perteAvant;
}

/** Faut-il s'arrêter maintenant ? Dès qu'Odin doit répondre, ou que la machine dépasse la charge maximale. */
export function doitSArreter(abortsActifs: number, charge: number, chargeMax: number): boolean {
  return abortsActifs > 0 || (Number.isFinite(charge) && charge > chargeMax);
}

/** Dépendances d'une séance de nuit. Le banc et les lots sont fournis par la « vie » (corpus/étapes). */
export interface NuitDeps {
  entraineur: EntraineurMin;
  banc: () => Int32Array[];
  lots: () => Iterable<Lot> | AsyncIterable<Lot>;
  dernierPoint: number; // numéro du dernier point de reprise en service
  graine: number;
  heuresNuit: number;
  filsNuit: number;
  signal: AbortSignal;
}

/** Le résultat d'une séance de nuit. */
export interface BilanNuit {
  misEnService: boolean;
  raison: 'mieux' | 'pas-mieux' | 'divergence' | 'interrompue';
  perteAvant: number;
  perteApres: number;
  point?: number;
  avancee?: Avancee;
}

/**
 * Une séance de nuit : mesurer la perte, s'entraîner, remesurer. Mettre en service seulement si c'est mieux ;
 * revenir en arrière si ça diverge ou si ce n'est pas mieux. Les poids en service ne reculent jamais.
 */
export async function seanceDeNuit(deps: NuitDeps): Promise<BilanNuit> {
  const { entraineur: e } = deps;
  // Retour arrière sûr : on ne revient QUE s'il existe vraiment un point de reprise EN SERVICE (un réseau neuf n'en
  // a aucun : dernierPoint < 0, on garde alors le réseau courant). Et une panne du retour arrière ne remonte jamais
  // jusqu'au fil d'Odin : on l'avale (le garde-fou « une panne du calcul n'arrête jamais Odin »).
  const revenirSansRisque = async (): Promise<void> => {
    if (!(deps.dernierPoint >= 0)) return;
    try { await e.revenirA(deps.dernierPoint); } catch { /* on garde le réseau courant */ }
  };
  const perteAvant = await e.perteSur(deps.banc());
  const avancee = await e.seance(deps.lots(), {
    dureeMs: Math.max(0, deps.heuresNuit) * 3_600_000,
    fils: Math.max(1, deps.filsNuit),
    signal: deps.signal,
    graine: deps.graine,
  });
  const perteApres = await e.perteSur(deps.banc());

  if (divergence(perteAvant, perteApres)) {
    await revenirSansRisque();
    return { misEnService: false, raison: 'divergence', perteAvant, perteApres, avancee };
  }
  if (!porteDeQualite(perteAvant, perteApres)) {
    await revenirSansRisque();
    return { misEnService: false, raison: avancee.interrompue ? 'interrompue' : 'pas-mieux', perteAvant, perteApres, avancee };
  }
  const point = deps.dernierPoint + 1;
  await e.ecrire(point);
  return { misEnService: true, raison: 'mieux', perteAvant, perteApres, point, avancee };
}

/** Une petite séance de jour : étape 1, 1 fil, ~2 min, arrêt au signal. Ne change pas les poids en service. */
export async function seanceDeJour(e: EntraineurMin, lots: Iterable<Lot> | AsyncIterable<Lot>, o: { signal: AbortSignal; graine: number; dureeMs?: number }): Promise<Avancee> {
  return e.seance(lots, { dureeMs: o.dureeMs ?? 120_000, fils: 1, signal: o.signal, graine: o.graine });
}
