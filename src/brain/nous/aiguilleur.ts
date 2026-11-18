// Noûs — L'AIGUILLEUR SANS RÉSEAU (étape É1 de la note « Soul et tous les sens »).
//
// Une demande dite en mots de tous les jours, dans n'importe quelle langue, doit mener à la bonne appli puis à la bonne
// action. L'aiguilleur le fait SANS réseau de neurones et sans rien d'extérieur :
//   1. la matière : toutes les façons de dire qu'Odin connaît déjà (paires de corpus-depart.ts, demandes-langues.ts,
//      demandes-v2.ts ; tournures par appli et par action de src/langue/langues/*.json ; mots, noms, descriptions des
//      applis et de leurs actions ; survol du guide ; usages ; la matière par langue src/brain/nous/matiere/<code>.json,
//      lue par matiere.ts ; corrections validées par le propriétaire) ;
//   2. le calcul : des n-grammes de caractères (aucun découpage en mots : le chinois et le japonais passent comme le
//      reste), pondérés TF-IDF (l'IDF compte aussi combien d'applis partagent un n-gramme), sur la forme d'origine ET sur
//      la forme sans accents ; les plus proches voisins votent pour une appli, le centre de chaque appli (cosinus avec la
//      somme de ses paires) s'y ajoute, puis, dans l'appli, les voisins votent pour une action ; fusion facultative par
//      les rangs avec la recherche par mots ;
//   3. la décision : une confiance (régression logistique sur la marge, la part du premier, la ressemblance du plus
//      proche voisin, l'accord avec les mots, la part de l'action, la part de la demande que la matière connaît et la
//      part de « pas encore »), réglée par validation croisée SUR LA MATIÈRE (jamais sur un banc), et trois issues :
//      « seul » (il répond), « trois » (il propose trois choix), « main » (il ne sait pas : hors du champ d'Odin, rien de
//      ressemblant dans la matière, ou trop incertain) ;
//   4. les corrections du propriétaire, gardées dans un petit fichier du dossier d'Odin et relues à l'ouverture ; une
//      paire venue d'un contenu extérieur est refusée ;
//   5. les relances : le tour précédent et l'appli active comptent dans le choix ;
//   6. (tour 6) chaque appli pèse aussi par la part de la demande que ses meilleures paires expliquent ENSEMBLE, puis un
//      second temps (reclasse.ts) départage les trois premières avec un petit modèle appris par validation croisée sur
//      la matière ; l'ancien calcul reste disponible (CALCUL_TOUR5) ;
//   7. (tour 7) le second temps reçoit jusqu'à cinq candidates (celles dont la part du vote compte encore, voir
//      nbCandidates), et l'action dans les trois premières applis est choisie par ce qui oppose les actions de l'appli
//      (action.ts : voisins re-pondérés et modèle par appli, appris sur la matière) ; le calcul du tour 6 reste
//      disponible (CALCUL_TOUR6).
// Rien ne suppose le français. Rien n'est branché dans le produit à ce stade : le banc (test/soul-banc) le mesure.
//
// À TENIR AU BRANCHEMENT (relecture du 17/11, M7) :
//   - `apprendre` n'est appelé que depuis un GESTE du propriétaire dans l'interface (il choisit la bonne appli), jamais
//     depuis le texte d'un message, d'une page, d'un document ou d'une automatisation : la provenance « proprietaire »
//     n'est qu'une chaîne, c'est l'appelant qui la garantit ;
//   - une action qui n'est pas en lecture seule demande toujours confirmation, même en « seul » (`confirmer` de la
//     réponse) : une paire apprise suffit à faire proposer une action voisine.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DEMANDES_EXEMPLES } from './corpus-depart.ts';
import { DEMANDES_V2 } from './demandes-v2.ts';
import { langues } from '../../langue/tables.ts';
import { DOSSIER_MATIERE, lireMatiere, type BilanMatiere } from './matiere.ts';
import { NB_TRAITS, Reclasseur, ajusterReclasse, codeDuReclasse, noterReclasse, ordreReclasse, type ModeleReclasse, type TotauxReclasse } from './reclasse.ts';
import { choisirAction, codeDeAction } from './action.ts';

// ------------------------------------------------------------------------------------------------ types
export type DecisionAiguilleur = 'seul' | 'trois' | 'main';
/** Une façon de dire reliée à une appli (null : hors du champ d'Odin, « pas encore ») et, si on la connaît, à une action. */
export interface Paire {
  texte: string; appli: string | null; action: string | null; source: string; poids?: number; demande?: boolean;
  /** Groupe des phrases sœurs (traductions alignées de la matière, « appli.action#n ») : même pli en validation croisée. */
  groupe?: string;
}
export interface ChoixAiguilleur { appli: string | null; action: string | null; score: number }
export interface ReponseAiguilleur {
  choix: ChoixAiguilleur[]; decision: DecisionAiguilleur; confiance: number;
  /** Pourquoi cette issue (court, pour le journal). */
  raison: string;
  /** Le premier choix n'est pas une action connue en lecture seule : le faire demande confirmation, même en « seul ». */
  confirmer: boolean;
  /**
   * « seul » dit que l'APPLI est sûre ; l'action l'est-elle aussi (seconde confiance, réglée à part) ? Sinon, Odin ouvre
   * l'appli et demande quelle action (relecture du tour 2, G1). Toujours faux hors de « seul » ou sans action proposée.
   */
  actionSure: boolean;
  /** Confiance dans l'action du premier choix (absente sans action proposée). */
  confianceAction?: number;
  /** Part de la demande que la matière connaît (entre 0 et 1 ; absente pour une demande vide). */
  couverture?: number;
}
export interface ContexteAiguilleur { precedent?: string; appli?: string; actionPrecedente?: string; [cle: string]: unknown }
/** Ce que l'aiguilleur lit d'une appli (forme de src/valhalla/types.ts, sans rien d'autre). */
export interface ModuleMatiere {
  id: string; name: string; what?: string; does?: string[]; words?: string[]; from?: string[]; modes?: string[];
  actions: Array<{ id: string; label: string; what?: string; words?: string[]; read?: boolean }>;
}
/** La recherche par mots (appsFor) remise à plat : appli, action éventuelle, score. */
export type MotsFn = (phrase: string) => Array<{ appli: string; action: string | null; score: number }>;

export interface Reglages {
  /** Longueurs des n-grammes de caractères. */
  nMin: number; nMax: number;
  /** Nombre de voisins qui votent, et puissance appliquée à leur ressemblance. */
  k: number; puissance: number;
  /** Fusion par les rangs avec les mots : poids des mots (0 : sans les mots) et constante de rang. */
  poidsMots: number; rangR: number;
  /** Relance : part ajoutée à l'appli active, poids du vote du tour précédent. */
  bonusContexte: number; poidsPrecedent: number;
  /**
   * Comment l'appli active compte (relecture G3). Sa part ajoutée (bonusContexte) est multipliée par :
   *   « fixe »   1 (l'ancienne règle : elle détourne les demandes nettes) ;
   *   « net »    1 − la part de la meilleure autre appli ;
   *   « part »   la part qu'a déjà l'appli active ;
   *   « proche » la part de l'appli active rapportée à celle de la meilleure appli (« pas encore » non compté ; défaut) :
   *              elle ne départage que si elle est déjà en lice.
   * Mesuré sur le seul jeu de développement (361 directes, n-grammes seuls, carnet soul-v3, tour 2) : avec une appli
   * active FAUSSE, justes 124 / 154 / 180 / 179 (180 sans contexte) ; avec l'appli active juste, 331 / 304 / 211 / 239.
   */
  contexte: 'fixe' | 'net' | 'part' | 'proche';
  /** Précision visée pour « seul » et, pour « trois », justesse visée dans les trois premiers (validation croisée). */
  viseSeul: number; viseTrois: number;
  /** Poids d'une demande apprise (phrase entière) face à un mot ou un libellé. */
  poidsDemande: number;
  /** Correction de la taille de la matière : le vote d'une appli est divisé par (nombre de ses paires) ^ prior. */
  prior: number;
  /** Poids du vote « hors du champ » (les phrases « pas encore » se ressemblent entre elles par leur tournure). */
  poidsHorsChamp: number;
  /**
   * Comment les voisins votent (tour 2, « applis aimants ») :
   *   « voisins » les K plus proches, toutes applis mêlées (l'ancienne règle : une appli riche en paires en place plus) ;
   *   « appli »   chaque appli (et « pas encore ») vote avec ses `parAppli` meilleures paires seulement : elle pèse pareil,
   *               quel que soit son nombre d'actions ou d'exemples ;
   *   « centre »  chaque appli est résumée par le centre de ses paires (cosinus de la demande avec ce centre).
   */
  vote: 'voisins' | 'appli' | 'centre';
  parAppli: number;
  /**
   * Part de la demande que la matière connaît (masse des n-grammes porteurs de lettres ou de chiffres déjà vus, entre 0
   * et 1) en dessous de laquelle rien ne ressemble vraiment : l'aiguilleur passe la main sans liste (tour 2).
   */
  couvertureMin: number;
  /**
   * Longueur minimale (en caractères) des n-grammes comptés dans la couverture (1 : tous). Essayé à 3 (relecture du tour
   * 2, M3) : une phrase vietnamienne restait couverte à 0,25 (0,27 avec tous) et des demandes chinoises et coréennes
   * connues tombaient à 0,06 : gardé à 1.
   */
  couvertureNMin: number;
  /**
   * Couverture en dessous de laquelle l'aiguilleur ne décide pas (ni « seul » ni « trois ») : il passe la main et ses
   * choix ne sont que des pistes. Réglé par une validation croisée où chaque pli retire une langue entière (relecture du
   * tour 2, M3) : sous 0,6, les demandes d'une langue retirée avaient l'appli juste en « seul » 86 % des fois au mieux et
   * la bonne appli dans les trois 61 % au mieux ; à partir de 0,6, 96,4 % et 88,0 %.
   */
  couvertureDecider: number;
  /**
   * Règles par défaut quand deux applis sont vraiment possibles (préférences du propriétaire) : si les deux premières
   * sont une paire (préférée, autre) et que la préférée a au moins (1 − margePreference) fois la part de l'autre, la
   * préférée passe devant. 0 : jamais.
   */
  margePreference: number;
  /**
   * « Pas encore » passe en premier dès que sa part atteint ce rapport à celle de la première appli (1 : seulement s'il
   * est déjà premier ; plus bas : il l'emporte plus tôt). Réglé par validation croisée sur la matière.
   */
  rapportHorsChamp: number;
  /** Part au plus des demandes du champ que la régression « hors du champ » peut y envoyer (validation croisée). 0 : sans elle. */
  perteHorsChamp: number;
  /** Part des centres d'applis ajoutée au vote des voisins (0 : sans ; sans effet si `vote` vaut « centre »). */
  poidsCentre: number;
  /** Puissance de l'IDF compté par appli (n-grammes partagés par beaucoup d'applis : moins de poids). 0 : sans. */
  idfAppli: number;
  /** Validation croisée par groupes (même source, même appli, même action dans le même pli) plutôt que phrase par phrase. */
  plisGroupes: boolean;
  /** Au plus ce nombre de cas testés par la validation croisée (choisis par empreinte, sans hasard) : la calibration reste rapide. */
  casMax: number;
  /**
   * Part EXPLIQUÉE de la demande (tour 6) : pour chaque appli, ses `expliqueParAppli` paires les plus proches ; la part
   * de la demande (masse de ses n-grammes porteurs d'une lettre ou d'un chiffre, d'au moins `expliqueNMin` caractères)
   * que ces paires contiennent ENSEMBLE, chaque n-gramme compté une fois par appli. La part de vote de l'appli est
   * multipliée par cette part à la puissance `explique`, puis renormée. Une appli qui gagne par plusieurs paires
   * reprenant le même mot recule devant celle qui explique l'action ET l'objet. 0 : sans (le calcul du tour 5).
   */
  explique: number; expliqueParAppli: number; expliqueNMin: number;
  /**
   * Le second temps (tour 6, reclasse.ts) : les trois premières applis du vote sont départagées par un petit modèle
   * appris par validation croisée sur la matière. false : sans (le calcul du tour 5). Lissages du bayésien naïf
   * (`reclasseAlpha`, `reclasseBeta`), passes du modèle local (`reclasseTours`), et écart de note au-dessus duquel une
   * autre appli passe devant la première (`reclasseMarge`).
   */
  reclasser: boolean; reclasseAlpha: number; reclasseBeta: number; reclasseTours: number; reclasseMarge: number;
  /**
   * (tour 7) Combien des premières du vote vont au second temps : les trois premières toujours, puis, jusqu'à
   * `candidatesSecond`, chaque suivante tant que sa part atteint `candidatesRapport` fois celle de la première (voir
   * nbCandidates). 3 : le calcul du tour 6. Les trois choix rendus restent les trois premiers de la liste revue.
   */
  candidatesSecond: number; candidatesRapport: number;
  /**
   * (tour 7, action.ts) L'action dans les trois premières applis : voisins re-pondérés par la rareté de chaque n-gramme
   * parmi les actions de l'appli (puissance `actionRarete` ; 0 : les voisins du tour 6), mélangés au modèle de l'appli
   * (part `actionModele` ; 0 : sans), appris en `actionTours` passes à partir du pas `actionPas`. La part de cette action
   * ne sert qu'à la confiance dans l'ACTION : la confiance dans l'appli et le choix de l'appli n'en dépendent pas.
   */
  actionRarete: number; actionModele: number; actionTours: number; actionPas: number;
}
/**
 * Réglages par défaut : choisis par validation croisée sur la matière (carnet soul-v3, sections de l'aiguilleur). Tour 2
 * (17/11, matière fr + en) : centres d'applis ×4, IDF par appli ^0,5, « pas encore » devant dès la moitié de la part de
 * la première appli, préférence du propriétaire à 10 % près, « seul » visé à 95 %. `couvertureMin` (0,02) est posé à la
 * main : la matière ne couvre pas encore les écritures qu'il protège, la validation croisée ne peut pas le régler.
 * Après la relecture du tour 2 (matière des 15 langues) : « seul » visé sur l'appli (l'action a sa propre confiance),
 * `couvertureDecider` 0,6 réglé en retirant une langue entière par pli.
 * Tour 3 (795 phrases de matière ajoutées dans les 15 langues) : « seul » visé à 97 %. Visé à 95 %, le seuil tiré de la
 * validation croisée baissait et « décide seul et se trompe d'appli » passait de 4 à 6 sur le jeu de travail ; à 97 %,
 * 1 erreur pour 81 décisions seules.
 * Tour 4 (1 230 phrases de plus, 82 actions, 15 langues) : la validation croisée teste 10 000 cas au plus (1 500
 * avant). Avec 1 500 cas tirés, le seuil « seul » visé à 97 % sautait selon le tirage (sur le jeu de travail : aucune
 * décision seule avec la nouvelle matière, 84 avec l'ancienne dont 1 fausse) ; avec 10 000 et 40 000 cas il ne bouge
 * plus (0,908 tous les deux) et « décide seul et se trompe d'appli » tombe à 0 (30 décisions seules, dont 7 avec la
 * bonne appli mais une autre action). Calibration plus longue,
 * gardée sur le disque comme avant.
 */
export const REGLAGES: Reglages = {
  nMin: 1, nMax: 4, k: 25, puissance: 2, poidsMots: 0.3, rangR: 3, bonusContexte: 0.35, poidsPrecedent: 0.3, contexte: 'proche', viseSeul: 0.97, viseTrois: 0.85, poidsDemande: 2, prior: 0, poidsHorsChamp: 1,
  vote: 'voisins', parAppli: 3, couvertureMin: 0.02, couvertureNMin: 1, couvertureDecider: 0.6, margePreference: 0.1, casMax: 10_000, idfAppli: 0.5, poidsCentre: 4, rapportHorsChamp: 0.5, perteHorsChamp: 0, plisGroupes: false,
  explique: 0.5, expliqueParAppli: 5, expliqueNMin: 1, reclasser: true, reclasseAlpha: 0.1, reclasseBeta: 0.5, reclasseTours: 5, reclasseMarge: 1,
  candidatesSecond: 5, candidatesRapport: 0.2, actionRarete: 2, actionModele: 0.3, actionTours: 4, actionPas: 1,
};
/**
 * Le calcul du tour 5 (sans part expliquée ni second temps), gardé derrière le même contrat : `reglages: CALCUL_TOUR5`.
 * Tour 6 (carnet soul-v3-tour-6) : réglés sur une moitié du jeu de travail (rang pair), mesurés sur l'autre (rang
 * impair, 243 demandes du champ), la bonne appli du premier coup passe de 203 (tour 5) à 216 avec les deux, sans décision
 * seule fausse de plus ni hors champ qui agit seul.
 */
export const CALCUL_TOUR5: Partial<Reglages> = { explique: 0, reclasser: false, candidatesSecond: 3, candidatesRapport: 0, actionRarete: 0, actionModele: 0 };
/**
 * Le calcul du tour 6 (second temps sur les trois premières seulement, action par les voisins simples), gardé derrière
 * le même contrat : `reglages: CALCUL_TOUR6`. Tour 7 (carnet soul-v3-tour-7) : réglés sur la moitié A du jeu de travail
 * (rang pair), mesurés sur la moitié B (rang impair, 243 demandes du champ) : appli du premier coup 216 → 217, appli +
 * action 145 → 155, « seul » 24 (appli fausse 0, action fausse 7) inchangé, hors champ agit seul 0/17 inchangé.
 */
export const CALCUL_TOUR6: Partial<Reglages> = { candidatesSecond: 3, candidatesRapport: 0, actionRarete: 0, actionModele: 0 };

/**
 * Quand deux applis sont vraiment possibles, celle que le propriétaire préfère (règle du 17/11) : [préférée, autre].
 * Sauvegarder une base de données → Arche (skuld) plutôt que Phénix (sindri) ; les appareils sur le réseau → Sphinx
 * (vidarr) plutôt que Constellation (appareils) ; allumer un ordinateur → Satellites (hermod) plutôt que Constellation.
 */
export const PREFERENCES: ReadonlyArray<readonly [string, string]> = [['skuld', 'sindri'], ['vidarr', 'appareils'], ['hermod', 'appareils']];

export const HORS_CHAMP = '∅';
/** Ressemblance (cosinus) à partir de laquelle une correction du propriétaire est « la même demande ». */
export const CORRECTION_IDENTIQUE = 0.9;
export const LONGUEUR_MAX = 2000;

// ------------------------------------------------------------------------------------------------ normalisation
// Caractères de contrôle (et séparateurs de ligne Unicode) : remplacés par une espace.
export const CONTROLE = /[\p{Cc}\u2028\u2029]/gu;
/**
 * Voyelles et signes de lecture qu'on n'écrit presque jamais au quotidien : niqqud et cantillation hébreux
 * (U+0591–U+05C7, sans les ponctuations U+05BE, U+05C0, U+05C3, U+05C6) et harakat arabes (U+064B–U+065F, U+0670).
 * Retirés dès le nettoyage : « مُوسِيقَى » et « موسيقى » sont la même demande.
 */
const VOYELLES_ECRITES = /[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u064b-\u065f\u0670]/g;
/**
 * Minuscules, NFKC (pleine chasse, demi-chasse, ligatures « ﬁ » ramenées à la forme simple), sans niqqud ni harakat,
 * sans caractères de contrôle, espaces resserrées, bornée à LONGUEUR_MAX caractères.
 */
export function nettoyer(t: unknown): string {
  let s = typeof t === 'string' ? t : String(t ?? '');
  if (s.length > LONGUEUR_MAX * 4) s = s.slice(0, LONGUEUR_MAX * 4);
  s = s.replace(CONTROLE, ' ').normalize('NFKC').replace(VOYELLES_ECRITES, '').toLowerCase().replace(/\s+/gu, ' ').trim();
  const cps = [...s];
  return cps.length > LONGUEUR_MAX ? cps.slice(0, LONGUEUR_MAX).join('') : s;
}
/**
 * Les signes qu'on écrit ou non selon l'envie : accents latins (U+0300–U+036F), niqqud et cantillation hébreux
 * (U+0591–U+05C7, sans les ponctuations U+05BE, U+05C0, U+05C3, U+05C6), harakat arabes (U+064B–U+065F, U+0670).
 * Le devanagari, le japonais et le coréen gardent leurs signes : ils changent le mot.
 */
const SIGNES_FACULTATIFS = /[\u0300-\u036f\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u064b-\u065f\u0670]/g;
/** La forme sans signes facultatifs. */
export const replier = (s: string): string => s.normalize('NFD').replace(SIGNES_FACULTATIFS, '').normalize('NFC');
/** Clé d'une phrase : nettoyée, repliée, sans ponctuation (doublons de la validation croisée, corrections refaites). */
export const cleTexte = (t: unknown): string => replier(nettoyer(t)).replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
/** Comparaison simple de deux chaînes (ne dépend d'aucune langue de la machine). */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Les n-grammes de caractères d'un texte déjà nettoyé, sur la forme d'origine et la forme sans accents. */
export function ngrammes(s: string, nMin: number, nMax: number, into = new Map<string, number>()): Map<string, number> {
  const formes = [s]; const r = replier(s); if (r !== s) formes.push(r);
  for (const f of formes) {
    const c = [...` ${f} `];
    for (let i = 0; i < c.length; i++) {
      let g = '';
      for (let n = 1; n <= nMax && i + n <= c.length; n++) {
        g += c[i + n - 1];
        if (n >= nMin && g !== ' ') into.set(g, (into.get(g) ?? 0) + 1);
      }
    }
  }
  return into;
}

// ------------------------------------------------------------------------------------------------ index TF-IDF
/** Rang de l'appli et poids de vote de chaque paire de base, et deux petits tableaux de travail (remis à zéro après usage). */
export interface TablesVote { cles: string[]; rangDe: Int32Array; poids: Float64Array; somme: Float64Array; vu: Uint8Array }
/**
 * Le cœur d'un index : vocabulaire des n-grammes, IDF, listes inversées (début de chaque liste, paires, poids). Il ne
 * dépend que des paires de base et des réglages ; il n'est jamais modifié une fois fait (les retraits et les ajouts
 * vivent dans l'instance), ce qui permet de le garder prêt et de le partager. `normes` et `tables` sont calculés à la
 * première demande et gardés avec lui.
 */
export interface CoeurIndex {
  vocab: Map<string, number>; idf: Float64Array; debut: Int32Array; postDoc: Int32Array | Uint16Array; postPoids: Float32Array; facteurInconnu: number;
  normes?: Map<string, number>; tables?: TablesVote;
}
/**
 * Le texte du code dont dépend le cœur d'un index (pour l'empreinte d'une préparation gardée) : un changement du
 * découpage, du nettoyage ou du calcul de l'index la rend périmée.
 */
export function codeDuCoeur(): string {
  return [IndexNgrammes.toString(), ngrammes.toString(), nettoyer.toString(), replier.toString(), String(CONTROLE), String(VOYELLES_ECRITES), String(SIGNES_FACULTATIFS), LONGUEUR_MAX, HORS_CHAMP, cmp.toString(), poidsDe.toString()].join('\n\u0001\n');
}
/**
 * Index inversé des paires (n-grammes TF-IDF, vecteurs normés), avec des ajouts tardifs (corrections) parcourus à part.
 * Une paire peut être retirée (correction refaite) : elle ne vote plus. Les ajouts sont peu nombreux : au-delà de
 * AJOUTS_AVANT_REPLI, l'aiguilleur reconstruit l'index avec eux (voir `apprendre` dans creerAiguilleurSync).
 */
export class IndexNgrammes {
  readonly paires: Paire[];
  readonly reglages: Reglages;
  private vocab: Map<string, number>;
  private idf: Float64Array;
  private debut: Int32Array; private postDoc: Int32Array | Uint16Array; private postPoids: Float32Array;
  /** Le cœur (ce qui ne change pas d'une instance à l'autre pour la même matière) : partageable, jamais modifié. */
  private c: CoeurIndex;
  private scores: Float32Array;
  private ajouts: Array<{ paire: Paire; vec: Map<string, number>; retire: boolean }> = [];
  private nBase: number;
  private masque: Uint8Array;
  /** Les n-grammes des ajouts (corrections) : ils comptent dans la couverture (ceux d'un ajout retiré aussi). */
  private grammesAjoutes = new Set<string>();
  /** Facteur de l'IDF par appli d'un n-gramme jamais vu (1 sans IDF par appli). */
  private facteurInconnu = 1;

  /**
   * `coeur` (facultatif) : un cœur déjà préparé pour EXACTEMENT ces paires et ces réglages (voir aiguilleur-pret.ts, qui
   * le vérifie par empreinte) ; il est partagé tel quel, sans copie. Sans lui, le cœur est calculé ici.
   */
  constructor(paires: Paire[], reglages: Reglages, coeur?: CoeurIndex) {
    this.paires = paires.slice(); this.reglages = reglages;
    const N = this.paires.length; this.nBase = N;
    this.scores = new Float32Array(N);
    this.masque = new Uint8Array(N);
    if (coeur) {
      this.c = coeur; this.vocab = coeur.vocab; this.idf = coeur.idf; this.debut = coeur.debut; this.postDoc = coeur.postDoc; this.postPoids = coeur.postPoids; this.facteurInconnu = coeur.facteurInconnu;
      return;
    }
    this.vocab = new Map<string, number>();
    const tfs = this.paires.map((p) => ngrammes(nettoyer(p.texte), reglages.nMin, reglages.nMax));
    const df: number[] = [];
    for (const tf of tfs) for (const g of tf.keys()) { let id = this.vocab.get(g); if (id === undefined) { id = df.length; this.vocab.set(g, id); df.push(0); } df[id]++; }
    this.idf = new Float64Array(df.length);
    for (let i = 0; i < df.length; i++) this.idf[i] = Math.log((N + 1) / (df[i] + 1)) + 1;
    if (reglages.idfAppli > 0) {
      // Un n-gramme que beaucoup d'applis partagent ne dit pas laquelle : son poids baisse (IDF compté par appli).
      const applis = [...new Set(this.paires.map((p) => p.appli ?? HORS_CHAMP))].sort(cmp), rang = new Map(applis.map((a, i) => [a, i]));
      const ordre = this.paires.map((_, i) => i).sort((x, y) => rang.get(this.paires[x].appli ?? HORS_CHAMP)! - rang.get(this.paires[y].appli ?? HORS_CHAMP)! || x - y);
      const dfA = new Int32Array(df.length), vu = new Int32Array(df.length).fill(-1);
      for (const d of ordre) { const a = rang.get(this.paires[d].appli ?? HORS_CHAMP)!; for (const g of tfs[d].keys()) { const id = this.vocab.get(g)!; if (vu[id] !== a) { vu[id] = a; dfA[id]++; } } }
      const A = applis.length;
      for (let i = 0; i < df.length; i++) this.idf[i] *= Math.pow(Math.log((A + 1) / (dfA[i] + 1)) + 1, reglages.idfAppli);
      this.facteurInconnu = Math.pow(Math.log(A + 1) + 1, reglages.idfAppli);
    }
    const compte = new Int32Array(df.length + 1);
    const vecs = tfs.map((tf) => {
      const ids: number[] = [], ws: number[] = []; let nn = 0;
      for (const [g, c] of tf) { const id = this.vocab.get(g)!; const w = (1 + Math.log(c)) * this.idf[id]; ids.push(id); ws.push(w); nn += w * w; }
      const inv = nn > 0 ? 1 / Math.sqrt(nn) : 0;
      for (let i = 0; i < ws.length; i++) ws[i] *= inv;
      for (const id of ids) compte[id + 1]++;
      return { ids, ws };
    });
    for (let i = 1; i < compte.length; i++) compte[i] += compte[i - 1];
    this.debut = Int32Array.from(compte);
    const total = compte[compte.length - 1];
    // Forme compacte : moins de 65 536 paires, l'indice d'une paire tient sur deux octets au lieu de quatre (mêmes valeurs).
    this.postDoc = N <= 0xffff ? new Uint16Array(total) : new Int32Array(total); this.postPoids = new Float32Array(total);
    const pos = Int32Array.from(compte.subarray(0, df.length));
    vecs.forEach((v, d) => { for (let i = 0; i < v.ids.length; i++) { const p = pos[v.ids[i]]++; this.postDoc[p] = d; this.postPoids[p] = v.ws[i]; } });
    this.c = { vocab: this.vocab, idf: this.idf, debut: this.debut, postDoc: this.postDoc, postPoids: this.postPoids, facteurInconnu: this.facteurInconnu };
  }

  /** Le cœur de l'index (pour le garder prêt : aiguilleur-pret.ts). Ne pas le modifier. */
  get coeur(): CoeurIndex { return this.c; }

  private get normesC(): Map<string, number> | undefined { return this.c.normes; }
  private set normesC(m: Map<string, number> | undefined) { this.c.normes = m; }
  /**
   * Norme du centre de chaque appli (somme des vecteurs normés de ses paires de base, pondérés par `poids`) : le
   * cosinus de la requête avec ce centre vaut Σ poids·ressemblance / norme. Calculée une fois (paires retirées comprises).
   */
  normesCentres(poids: (p: Paire) => number): Map<string, number> {
    if (this.normesC) return this.normesC;
    const applis = [...new Set(this.paires.map((p) => p.appli ?? HORS_CHAMP))].sort(cmp), rang = new Map(applis.map((a, i) => [a, i]));
    const rangDe = Int32Array.from(this.paires.map((p) => rang.get(p.appli ?? HORS_CHAMP)!)), pd = Float64Array.from(this.paires.map(poids));
    const somme = new Float64Array(applis.length), carre = new Float64Array(applis.length), touche: number[] = [];
    for (let g = 0; g + 1 < this.debut.length; g++) {
      for (let p = this.debut[g]; p < this.debut[g + 1]; p++) { const a = rangDe[this.postDoc[p]]; if (somme[a] === 0) touche.push(a); somme[a] += pd[this.postDoc[p]] * this.postPoids[p]; }
      for (const a of touche) { carre[a] += somme[a] * somme[a]; somme[a] = 0; }
      touche.length = 0;
    }
    this.normesC = new Map(applis.map((a, i) => [a, Math.sqrt(carre[i])]));
    return this.normesC;
  }


  /**
   * Pour chaque paire de BASE : le rang de son appli (« pas encore » compris) et son poids de vote, calculés une fois
   * (le vote n'appelle plus `cle` ni `poidsDe` pour chacune des milliers de paires touchées à chaque demande). Les mêmes
   * nombres que l'ancien calcul : seuls les accès changent.
   */
  tablesVote(poids: (p: Paire) => number): TablesVote {
    if (this.c.tables) return this.c.tables;
    const cles = [...new Set(this.paires.map((p) => p.appli ?? HORS_CHAMP))].sort(cmp), rang = new Map(cles.map((a, i) => [a, i]));
    this.c.tables = { cles, rangDe: Int32Array.from(this.paires.map((p) => rang.get(p.appli ?? HORS_CHAMP)!)), poids: Float64Array.from(this.paires.map(poids)), somme: new Float64Array(cles.length), vu: new Uint8Array(cles.length) };
    return this.c.tables;
  }
  private dense = new Float64Array(0);
  /**
   * Les ressemblances rangées par indice de paire (tableau plein, zéro ailleurs), à la place d'une table d'association
   * refaite à chaque demande. À rendre propre par `viderDense(idx)` aussitôt lu.
   */
  remplirDense(idx: number[], sim: number[]): Float64Array {
    if (this.dense.length < this.taille) this.dense = new Float64Array(Math.max(this.taille, this.dense.length * 2));
    for (let i = 0; i < idx.length; i++) this.dense[idx[i]] = sim[i];
    return this.dense;
  }
  viderDense(idx: number[]): void { for (const d of idx) this.dense[d] = 0; }

  get taille(): number { return this.nBase + this.ajouts.length; }
  get grammes(): number { return this.vocab.size; }
  /** Ajouts parcourus un par un à chaque demande (retirés compris). */
  get enAttente(): number { return this.ajouts.length; }
  paire(i: number): Paire { return i < this.nBase ? this.paires[i] : this.ajouts[i - this.nBase].paire; }
  /** La paire vote-t-elle encore ? */
  vivante(i: number): boolean { return i < this.nBase ? this.masque[i] === 0 : i < this.taille && !this.ajouts[i - this.nBase].retire; }
  /** Retire une paire (de base ou ajoutée) : elle ne vote plus. */
  retirer(i: number): void { if (i < this.nBase) this.masque[i] = 1; else if (i < this.taille) this.ajouts[i - this.nBase].retire = true; }
  /** Les paires qui votent encore (pour reconstruire l'index). */
  vivantes(): Paire[] { const out: Paire[] = []; for (let i = 0; i < this.taille; i++) if (this.vivante(i)) out.push(this.paire(i)); return out; }

  /**
   * La part de la requête que la matière connaît : masse (carré des poids du vecteur normé) des n-grammes porteurs d'une
   * lettre ou d'un chiffre déjà vus, rapportée à celle de tous les n-grammes porteurs d'une lettre ou d'un chiffre.
   */
  couverture(q: Map<string, number>): number {
    let connu = 0, tout = 0;
    const nMin = this.reglages.couvertureNMin ?? 1;
    for (const [g, w] of q) { if (!/[\p{L}\p{N}]/u.test(g) || (nMin > 1 && [...g].length < nMin)) continue; tout += w * w; if (this.vocab.has(g) || this.grammesAjoutes.has(g)) connu += w * w; }
    return tout > 0 ? connu / tout : 0;
  }

  /** Le vecteur normé d'une requête (les n-grammes inconnus comptent dans la norme : une demande étrangère à toute la matière ressemble moins). */
  vecteur(texte: string): Map<string, number> {
    const tf = ngrammes(nettoyer(texte), this.reglages.nMin, this.reglages.nMax);
    const v = new Map<string, number>(); let nn = 0;
    const idfInconnu = (Math.log((this.nBase + 1) / 1) + 1) * this.facteurInconnu;
    for (const [g, c] of tf) { const id = this.vocab.get(g); const w = (1 + Math.log(c)) * (id === undefined ? idfInconnu : this.idf[id]); v.set(g, w); nn += w * w; }
    const inv = nn > 0 ? 1 / Math.sqrt(nn) : 0;
    for (const [g, w] of v) v.set(g, w * inv);
    return v;
  }

  /** Ajoute une paire après coup (une correction) : les poids IDF restent ceux de la matière de base. */
  ajouter(p: Paire): void {
    const tf = ngrammes(nettoyer(p.texte), this.reglages.nMin, this.reglages.nMax);
    const v = new Map<string, number>(); let nn = 0;
    const idfInconnu = (Math.log((this.nBase + 1) / 2) + 1) * this.facteurInconnu;
    for (const [g, c] of tf) { const id = this.vocab.get(g); const w = (1 + Math.log(c)) * (id === undefined ? idfInconnu : this.idf[id]); v.set(g, w); nn += w * w; }
    const inv = nn > 0 ? 1 / Math.sqrt(nn) : 0;
    for (const [g, w] of v) v.set(g, w * inv);
    this.ajouts.push({ paire: p, vec: v, retire: false });
    for (const g of v.keys()) this.grammesAjoutes.add(g);
  }

  /**
   * Les ressemblances (cosinus) de la requête avec chaque paire. `exclu` (facultatif) écarte des paires de base (validation
   * croisée). Rend un tableau creux : indices touchés et leurs scores.
   */
  ressemblances(texte: string, exclu?: Uint8Array): { idx: number[]; sim: number[]; couverture: number; q: Map<string, number> } {
    const q = this.vecteur(texte);
    const s = this.scores, touches: number[] = [];
    for (const [g, w] of q) {
      const id = this.vocab.get(g); if (id === undefined) continue;
      for (let p = this.debut[id], fin = this.debut[id + 1]; p < fin; p++) {
        const d = this.postDoc[p];
        if (s[d] === 0) touches.push(d);
        s[d] += w * this.postPoids[p];
      }
    }
    const idx: number[] = [], sim: number[] = [];
    for (const d of touches) { const x = s[d]; s[d] = 0; if (x > 0 && !(exclu && exclu[d]) && this.masque[d] === 0) { idx.push(d); sim.push(x); } }
    this.ajouts.forEach((a, i) => { if (a.retire) return; let x = 0; for (const [g, w] of q) { const y = a.vec.get(g); if (y) x += w * y; } if (x > 0) { idx.push(this.nBase + i); sim.push(x); } });
    return { idx, sim, couverture: this.couverture(q), q };
  }

  private marque = new Int32Array(0);
  /**
   * La part de la requête `q` que les paires retenues de chaque appli expliquent ENSEMBLE (réglage `explique`). Les
   * paires retenues : `retenues[a]` (indices dans `idx`) pour l'appli de rang `a` de `cles`. Chaque n-gramme de la
   * requête porteur d'une lettre ou d'un chiffre (au moins `nMin` caractères) compte sa masse (carré de son poids normé)
   * UNE fois pour chaque appli dont une paire retenue le contient. Rend une part entre 0 et 1 par rang d'appli.
   */
  expliquer(q: Map<string, number>, idx: number[], retenues: number[][], nMin: number): Float64Array {
    const nA = retenues.length, E = new Float64Array(nA), vu = new Int32Array(nA).fill(-1);
    if (this.marque.length < this.nBase) this.marque = new Int32Array(this.nBase);
    const marque = this.marque, ajoutsRetenus: Array<[Map<string, number>, number]> = [];
    for (let a = 0; a < nA; a++) for (const i of retenues[a]) { const d = idx[i]; if (d < this.nBase) marque[d] = a + 1; else ajoutsRetenus.push([this.ajouts[d - this.nBase].vec, a]); }
    let tout = 0, gi = 0;
    for (const [g, w] of q) {
      gi++;
      if ((nMin > 1 && [...g].length < nMin) || !/[\p{L}\p{N}]/u.test(g)) continue;
      const m = w * w; tout += m;
      const id = this.vocab.get(g);
      if (id !== undefined) for (let p = this.debut[id], fin = this.debut[id + 1]; p < fin; p++) { const a = marque[this.postDoc[p]]; if (a > 0 && vu[a - 1] !== gi) { vu[a - 1] = gi; E[a - 1] += m; } }
      for (const [vec, a] of ajoutsRetenus) if (vu[a] !== gi && vec.has(g)) { vu[a] = gi; E[a] += m; }
    }
    for (let a = 0; a < nA; a++) for (const i of retenues[a]) { const d = idx[i]; if (d < this.nBase) marque[d] = 0; }
    if (tout > 0) for (let a = 0; a < nA; a++) E[a] /= tout;
    return E;
  }
}

// ------------------------------------------------------------------------------------------------ la matière
const sansAccent = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Toutes les paires d'apprentissage du dépôt, reliées aux applis et actions qui existent vraiment. */
export function matiere(modules: ModuleMatiere[], o: { usages?: Array<{ need: string; chain: string[] }>; survol?: Record<string, { phrase: string; faire: string[] }>; corrections?: Paire[]; parLangue?: Paire[] } = {}): Paire[] {
  const out: Paire[] = [];
  const parId = new Map(modules.map((m) => [m.id, m]));
  const actionExiste = (m: string, a: string) => Boolean(parId.get(m)?.actions.some((x) => x.id === a));
  const pousser = (texte: unknown, appli: string | null, action: string | null, source: string, demande = false, poids = 1) => {
    const t = typeof texte === 'string' ? texte.trim() : '';
    if (t) out.push({ texte: t, appli, action, source, poids, demande });
  };
  // 1. Les applis et leurs actions (leur vraie définition).
  for (const m of modules) {
    pousser(m.name, m.id, null, 'module:nom');
    pousser(m.what, m.id, null, 'module:quoi');
    for (const d of m.does ?? []) pousser(d, m.id, null, 'module:fait');
    for (const w of m.words ?? []) pousser(w, m.id, null, 'module:mots');
    for (const w of m.from ?? []) pousser(w, m.id, null, 'module:origine');
    for (const w of m.modes ?? []) pousser(w, m.id, null, 'module:modes');
    for (const a of m.actions) {
      pousser(a.label, m.id, a.id, 'action:libelle');
      pousser(a.what, m.id, a.id, 'action:quoi');
      for (const w of a.words ?? []) pousser(w, m.id, a.id, 'action:mots');
    }
  }
  // 2. Les tournures des langues (src/langue/langues/*.json) : « appli » ou « appli.action », et ce qui n'est « pas encore ».
  for (const t of langues().values()) {
    for (const [cle, mots] of Object.entries(t.applis)) {
      const [id, act] = cle.split('.');
      if (!parId.has(id)) continue;
      const a = act && actionExiste(id, act) ? act : null;
      for (const w of mots) pousser(w, id, a, `langue:${t.code}`);
    }
    for (const mots of Object.values(t.pasEncoreMots)) for (const w of mots) pousser(w, null, null, `langue:${t.code}:pas-encore`);
  }
  // 3. Les demandes de tous les jours (v2), et les demandes réelles résolues (corpus de départ, plusieurs langues).
  for (const d of DEMANDES_V2) {
    if (d.module === 'aucune') { pousser(d.demande, null, null, `v2:${d.langue}`, true); continue; }
    if (!parId.has(d.module)) continue;
    pousser(d.demande, d.module, actionExiste(d.module, d.action) ? d.action : null, `v2:${d.langue}`, true);
  }
  for (const ex of DEMANDES_EXEMPLES) {
    const m = parId.get(ex.module); if (!m) continue;
    const a = m.actions.find((x) => ex.action.test(x.id) || ex.action.test(sansAccent(x.label)));
    pousser(ex.demande, m.id, a?.id ?? null, 'exemples', true);
  }
  // 4. Le guide (survol) et les usages connus (la première appli de la chaîne).
  for (const [id, s] of Object.entries(o.survol ?? {})) if (parId.has(id)) { pousser(s.phrase, id, null, 'survol'); for (const f of s.faire) pousser(f, id, null, 'survol'); }
  for (const u of o.usages ?? []) if (u.chain[0] && parId.has(u.chain[0])) pousser(u.need, u.chain[0], null, 'usages', false, 0.5);
  // 5. La matière par langue (src/brain/nous/matiere/<code>.json), déjà vérifiée par son chargeur.
  for (const p of o.parLangue ?? []) if (p.appli === null || (parId.has(p.appli) && (p.action === null || actionExiste(p.appli, p.action)))) out.push({ ...p });
  // 6. Les corrections validées par le propriétaire.
  for (const c of o.corrections ?? []) out.push({ ...c, demande: true, poids: c.poids ?? 2 });
  return out;
}

// ------------------------------------------------------------------------------------------------ le vote
interface Candidat {
  appli: string; part: number; action: string | null; partAction: number;
  /** (tour 7) Part de l'action choisie par action.ts (confiance dans l'action seulement) ; absente : l'action du tour 6. */
  partActionC?: number;
}
interface Vote {
  candidats: Candidat[]; sim1: number; motsTete: string | null; motsVide: boolean;
  /** Part de la demande que la matière connaît (voir IndexNgrammes.couverture). */
  couverture: number;
  /** Part du vote « pas encore », même quand il n'est pas premier. */
  partHorsChamp: number;
  /** Une correction du propriétaire presque identique à la demande a mis son appli en tête (le second temps n'y touche pas). */
  correction?: boolean;
  /**
   * Une correction du propriétaire est parmi les voisines de la demande et désigne l'appli en tête (une paraphrase d'une
   * correction, même loin de « presque identique ») : le second temps, qui ne voit pas les corrections, n'y touche pas.
   */
  correctionTete?: boolean;
}

const cle =(p: Paire) => p.appli ?? HORS_CHAMP;
const poidsDe = (p: Paire, R: Reglages) => (p.poids ?? 1) * (p.demande ? R.poidsDemande : 1) * (p.appli === null ? R.poidsHorsChamp : 1);

/**
 * La part de la demande que les `expliqueParAppli` paires les plus proches de chaque appli expliquent ensemble (voir le
 * réglage `explique` et IndexNgrammes.expliquer), par clé d'appli (« pas encore » compris).
 */
function explication(ix: IndexNgrammes, idx: number[], sim: number[], q: Map<string, number>): Map<string, number> {
  const R = ix.reglages, t = ix.tablesVote((p) => poidsDe(p, R)), nA = t.cles.length, nb = ix.paires.length, M = Math.max(1, R.expliqueParAppli | 0);
  let rangAjout: Map<string, number> | undefined;
  // Les M paires les plus ressemblantes de chaque appli (ressemblance décroissante, puis indice croissant).
  const top: number[][] = Array.from({ length: nA }, () => []);
  const avant = (i: number, j: number) => sim[i] > sim[j] || (sim[i] === sim[j] && idx[i] < idx[j]);
  for (let i = 0; i < idx.length; i++) {
    const d = idx[i];
    let a: number;
    if (d < nb) a = t.rangDe[d];
    else { rangAjout ??= new Map(t.cles.map((k, r) => [k, r])); const r = rangAjout.get(cle(ix.paire(d))); if (r === undefined) continue; a = r; }
    const l = top[a];
    if (l.length === M && !avant(i, l[M - 1])) continue;
    let j = l.length < M ? l.push(i) - 1 : M - 1;
    while (j > 0 && avant(i, l[j - 1])) { l[j] = l[j - 1]; j--; }
    l[j] = i;
  }
  const E = ix.expliquer(q, idx, top, R.expliqueNMin ?? 1), out = new Map<string, number>();
  t.cles.forEach((k, a) => out.set(k, E[a]));
  return out;
}

/** Les parts de chaque appli (et de « pas encore ») d'après des ressemblances, selon la règle de vote (normées à 1). */
function partager(ix: IndexNgrammes, parAppli: Map<string, number[]>, idx: number[], sim: number[], q?: Map<string, number>): { parts: Map<string, number>; sim1: number } {
  const R = ix.reglages;
  const out = new Map<string, number>();
  let tot = 0, sim1 = 0;
  for (const s of sim) if (s > sim1) sim1 = s;
  if (R.vote === 'appli') {
    // Chaque appli vote avec ses `parAppli` meilleures paires : le nombre de ses paires ne compte plus.
    const m = Math.max(1, R.parAppli | 0), meilleurs = new Map<string, number[]>();
    for (let i = 0; i < idx.length; i++) {
      const p = ix.paire(idx[i]); const w = Math.pow(sim[i], R.puissance) * poidsDe(p, R); const k = cle(p);
      let l = meilleurs.get(k); if (!l) meilleurs.set(k, l = []);
      if (l.length < m) { l.push(w); l.sort((x, y) => y - x); } else if (w > l[m - 1]) { l[m - 1] = w; l.sort((x, y) => y - x); }
    }
    for (const [k, l] of meilleurs) { let s = 0; for (const w of l) s += w; out.set(k, s); tot += s; }
  } else if (R.vote === 'centre') {
    const c = centres(ix, idx, sim); for (const [k, x] of c) { out.set(k, x); tot += x; }
  } else {
    // Les K plus proches (dans l'ordre : ressemblance décroissante, puis indice croissant).
    const ordre = kPlusProches(idx, sim, R.k);
    for (const i of ordre) { const p = ix.paire(idx[i]); const w = Math.pow(sim[i], R.puissance) * poidsDe(p, R); out.set(cle(p), (out.get(cle(p)) ?? 0) + w); tot += w; }
    if (R.prior > 0) { tot = 0; for (const [a, w] of out) { const x = w / Math.pow(Math.max(1, parAppli.get(a)?.length ?? 1), R.prior); out.set(a, x); tot += x; } }
  }
  if (tot > 0) for (const [a, w] of out) out.set(a, w / tot);
  if (R.poidsCentre > 0 && R.vote !== 'centre') {
    // Mélange : les voisins, plus (poidsCentre ×) les centres des applis ; renormé.
    const c = centres(ix, idx, sim); let tc = 0; for (const x of c.values()) tc += x;
    if (tc > 0) { let t = 0; for (const [k, x] of c) out.set(k, (out.get(k) ?? 0) + R.poidsCentre * x / tc); for (const x of out.values()) t += x; for (const [k, x] of out) out.set(k, x / t); }
  }
  if ((R.explique ?? 0) > 0 && q && out.size) {
    // Tour 6 : chaque appli pèse aussi par la part de la demande que ses meilleures paires expliquent ensemble.
    const E = explication(ix, idx, sim, q), nv = new Map<string, number>(); let t = 0;
    for (const [k, x] of out) { const y = x * Math.pow(E.get(k) ?? 0, R.explique); nv.set(k, y); t += y; }
    if (t > 0) for (const [k, y] of nv) out.set(k, y / t);
  }
  return { parts: out, sim1 };
}

/**
 * Les `k` premiers indices (dans `idx`/`sim`) selon l'ordre « ressemblance décroissante, puis indice de paire
 * croissant » : exactement `idx.map((_, i) => i).sort(…).slice(0, k)`, sans trier les milliers de paires touchées
 * (l'ordre est total : deux paires n'ont jamais le même indice, le résultat est le même que le tri complet).
 */
export function kPlusProches(idx: number[], sim: number[], k: number): number[] {
  if (REFERENCE || !Number.isInteger(k) || k <= 0 || k >= idx.length) return idx.map((_, i) => i).sort((a, b) => sim[b] - sim[a] || idx[a] - idx[b]).slice(0, k);
  const top: number[] = [];
  const avant = (a: number, b: number) => sim[a] > sim[b] || (sim[a] === sim[b] && idx[a] < idx[b]);
  for (let i = 0; i < idx.length; i++) {
    if (top.length === k && !avant(i, top[k - 1])) continue;
    let j = top.length < k ? top.push(i) - 1 : k - 1;
    while (j > 0 && avant(i, top[j - 1])) { top[j] = top[j - 1]; j--; }
    top[j] = i;
  }
  return top;
}

/** Le cosinus de la requête avec le centre de chaque appli (paires de base seulement), à la puissance `puissance`. */
function centres(ix: IndexNgrammes, idx: number[], sim: number[]): Map<string, number> {
  const R = ix.reglages, normes = ix.normesCentres((p) => poidsDe(p, R)), out = new Map<string, number>();
  if (REFERENCE) {
    const somme = new Map<string, number>();
    for (let i = 0; i < idx.length; i++) { if (idx[i] >= ix.paires.length) continue; const p = ix.paire(idx[i]); somme.set(cle(p), (somme.get(cle(p)) ?? 0) + poidsDe(p, R) * sim[i]); }
    for (const [k, x] of somme) { const nn = normes.get(k) ?? 0; if (nn > 0) out.set(k, Math.pow(x / nn, R.puissance)); }
    return out;
  }
  // Mêmes sommes, dans le même ordre, que l'ancienne table d'association par appli ; les applis gardent l'ordre où la
  // demande les a touchées pour la première fois (l'ordre de la table rendue, donc des sommes qui suivent).
  const t = ix.tablesVote((p) => poidsDe(p, R)), nb = ix.paires.length, ordre: number[] = [];
  for (let i = 0; i < idx.length; i++) { const d = idx[i]; if (d >= nb) continue; const a = t.rangDe[d]; if (!t.vu[a]) { t.vu[a] = 1; ordre.push(a); } t.somme[a] += t.poids[d] * sim[i]; }
  for (const a of ordre) { const x = t.somme[a], k = t.cles[a]; t.somme[a] = 0; t.vu[a] = 0; const nn = normes.get(k) ?? 0; if (nn > 0) out.set(k, Math.pow(x / nn, R.puissance)); }
  return out;
}

/** Le vote des voisins (et des mots), sans décision. */
function voter(ix: IndexNgrammes, parAppli: Map<string, number[]>, phrase: string, ctx: ContexteAiguilleur | undefined, mots: MotsFn | undefined, exclu?: Uint8Array, preferences: ReadonlyArray<readonly [string, string]> = PREFERENCES): Vote {
  const R = ix.reglages;
  const { idx, sim, couverture, q } = ix.ressemblances(phrase, exclu);
  const { parts, sim1 } = partager(ix, parAppli, idx, sim, q);
  // Relance : le tour précédent vote un peu, l'appli active reçoit une part.
  if (ctx && (ctx.precedent || ctx.appli)) {
    if (typeof ctx.precedent === 'string' && ctx.precedent.trim()) {
      const pr = ix.ressemblances(ctx.precedent, exclu);
      const p2 = partager(ix, parAppli, pr.idx, pr.sim, pr.q).parts;
      for (const [a, w] of p2) if (a !== HORS_CHAMP) parts.set(a, (parts.get(a) ?? 0) + R.poidsPrecedent * w);
    }
    if (typeof ctx.appli === 'string' && parAppli.has(ctx.appli)) {
      // L'appli active ne prend une part que si la phrase ne désigne pas nettement une AUTRE appli (relecture G3).
      let t = 0, autre = 0; for (const w of parts.values()) t += w;
      for (const [a, w] of parts) if (a !== ctx.appli && a !== HORS_CHAMP && t > 0) autre = Math.max(autre, w / t);
      let max = 0; for (const [a2, w] of parts) if (a2 !== HORS_CHAMP) max = Math.max(max, w);
      const pa = parts.get(ctx.appli) ?? 0;
      const f = R.contexte === 'fixe' ? 1 : R.contexte === 'part' ? (t > 0 ? pa / t : 0) : R.contexte === 'proche' ? (max > 0 ? pa / max : 0) : 1 - autre;
      parts.set(ctx.appli, (parts.get(ctx.appli) ?? 0) + R.bonusContexte * f);
    }
    let t3 = 0; for (const w of parts.values()) t3 += w;
    if (t3 > 0) for (const [a, w] of parts) parts.set(a, w / t3);
  }
  // Ordre des applis : les voisins, fusionnés par les rangs avec les mots si on les a.
  let classement = [...parts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([a]) => a);
  const m = mots ? safeMots(mots, phrase) : [];
  const motsTete = m[0]?.appli ?? null;
  if (R.poidsMots > 0 && m.length) {
    const rr = new Map<string, number>();
    classement.forEach((a, i) => rr.set(a, 1 / (R.rangR + i + 1)));
    m.forEach((x, i) => { if (parAppli.has(x.appli)) rr.set(x.appli, (rr.get(x.appli) ?? 0) + R.poidsMots / (R.rangR + i + 1)); });
    classement = [...rr.entries()].sort((a, b) => b[1] - a[1] || (parts.get(b[0]) ?? 0) - (parts.get(a[0]) ?? 0) || cmp(a[0], b[0])).map(([a]) => a);
  }
  // « Pas encore » passe devant dès que sa part atteint `rapportHorsChamp` fois celle de la première appli.
  const iHC = classement.indexOf(HORS_CHAMP);
  if (iHC > 0 && R.rapportHorsChamp < 1 && (parts.get(HORS_CHAMP) ?? 0) >= R.rapportHorsChamp * (parts.get(classement[0]) ?? 0)) { classement.splice(iHC, 1); classement.unshift(HORS_CHAMP); }
  // Deux applis vraiment possibles et presque à égalité : la règle par défaut du propriétaire tranche.
  if (R.margePreference > 0 && classement.length >= 2) {
    const [x, y] = classement, px = parts.get(x) ?? 0, py = parts.get(y) ?? 0;
    if (preferences.some(([pref, autre]) => pref === y && autre === x) && py >= (1 - R.margePreference) * px) { classement[0] = y; classement[1] = x; }
  }
  // Une correction du propriétaire presque identique à la demande l'emporte toujours (les centres d'applis ne la
  // comptent pas : elle doit gagner même face à une appli dont le centre ressemble plus).
  let corr = -1, simCorr = 0;
  for (let i = 0; i < idx.length; i++) if (sim[i] > simCorr && ix.paire(idx[i]).source === 'correction') { simCorr = sim[i]; corr = idx[i]; }
  const correction = corr >= 0 && simCorr >= CORRECTION_IDENTIQUE;
  if (correction) {
    const k = cle(ix.paire(corr)), j = classement.indexOf(k);
    if (j !== 0) { if (j > 0) classement.splice(j, 1); classement.unshift(k); }
  }
  let correctionTete = false;
  for (let i = 0; i < idx.length && !correctionTete; i++) { const p = ix.paire(idx[i]); if (p.source === 'correction' && sim[i] > 0 && cle(p) === classement[0]) correctionTete = true; }
  // Pour chaque appli candidate : l'action, par les ressemblances de ses propres paires.
  // Les ressemblances par indice de paire : un tableau plein (l'ancien chemin : une table d'association refaite ici).
  const dense = REFERENCE ? undefined : ix.remplirDense(idx, sim), carte = REFERENCE ? new Map(idx.map((d, i) => [d, sim[i]])) : undefined;
  const candidats: Candidat[] = classement.slice(0, 5).map((a, rang) => {
    if (a === HORS_CHAMP) return { appli: a, part: parts.get(a) ?? 0, action: null, partAction: 0 };
    const parAction = new Map<string, number[]>();
    for (const d of parAppli.get(a) ?? []) { const s = dense ? dense[d] : carte!.get(d); if (!s) continue; const p = ix.paire(d); if (!p.action) continue; const l = parAction.get(p.action) ?? []; l.push(s * (p.poids ?? 1)); parAction.set(p.action, l); }
    let best: string | null = null, bs = 0, tot2 = 0;
    for (const [act, l] of [...parAction.entries()].sort((x, y) => cmp(x[0], y[0]))) {
      const s = l.sort((x, y) => y - x).slice(0, 3).reduce((u, v) => u + v * v, 0);
      tot2 += s; if (s > bs) { bs = s; best = act; }
    }
    // (tour 7) Dans les trois premières, l'action par ce qui OPPOSE les actions de l'appli (action.ts) ; `bs` reste
    // celui du tour 6 (relance, et confiance dans l'appli).
    let nouveau: { action: string; part: number } | undefined;
    if (rang < 3 && (R.actionRarete > 0 || R.actionModele > 0)) {
      const simple = () => new Map([...parAction.entries()].map(([k, l]) => [k, l.slice(0, 3).reduce((u, v) => u + v * v, 0)]));
      nouveau = choisirAction(ix, a, parAppli.get(a) ?? [], q, R.actionRarete, R.actionModele, { tours: R.actionTours, pas: R.actionPas, l2: 1e-4, poidsDemande: R.poidsDemande }, exclu, (d) => (dense ? dense[d] : carte!.get(d)) ?? 0, simple);
    }
    // Relance sans indice d'action dans la phrase : l'action précédente si on reste dans la même appli.
    if (ctx?.appli === a && typeof ctx.actionPrecedente === 'string' && (!best || bs < 0.04)) { best = ctx.actionPrecedente; bs = Math.max(bs, 0.04); tot2 = Math.max(tot2, bs); }
    else if (nouveau) return { appli: a, part: parts.get(a) ?? 0, action: nouveau.action, partAction: tot2 > 0 ? bs / tot2 : 0, partActionC: nouveau.part };
    const mx = m.find((x) => x.appli === a);
    if (!best && mx?.action) { best = mx.action; bs = 1; tot2 = 1; }
    return { appli: a, part: parts.get(a) ?? 0, action: best, partAction: tot2 > 0 ? bs / tot2 : 0 };
  });
  if (!REFERENCE) ix.viderDense(idx);
  return { candidats, sim1, motsTete, motsVide: m.length === 0, couverture, partHorsChamp: parts.get(HORS_CHAMP) ?? 0, correction, correctionTete };
}

function safeMots(mots: MotsFn, phrase: string): Array<{ appli: string; action: string | null; score: number }> {
  try { return (mots(phrase) ?? []).filter((x) => x && typeof x.appli === 'string'); } catch { return []; }
}

/**
 * L'ANCIEN chemin du vote (tri complet des paires touchées, tables d'association refaites à chaque demande), gardé
 * comme référence : les essais vérifient que le chemin rapide rend exactement les mêmes réponses. Jamais en service.
 */
let REFERENCE = false;
export function cheminDeReference(oui: boolean): void { REFERENCE = oui; }

/** Les signes dont on tire la confiance. */
function signes(v: Vote): number[] {
  const c = v.candidats, p1 = c[0]?.part ?? 0, p2 = c[1]?.part ?? 0;
  const marge = p1 > 0 ? Math.max(0, (p1 - p2) / p1) : 0;
  const accord = v.motsVide ? 0.5 : v.motsTete === c[0]?.appli ? 1 : 0;
  return [1, marge, p1, Math.min(1, v.sim1), accord, c[0]?.partAction ?? 0, v.couverture, v.partHorsChamp];
}
/** (tour 7) Les signes de la confiance dans l'ACTION : la part de l'action est celle d'action.ts quand il l'a choisie. */
function signesAction(v: Vote): number[] { const x = signes(v), c = v.candidats[0]; if (c?.partActionC !== undefined) x[5] = c.partActionC; return x; }
/** Nombre de signes (et donc de poids de la calibration). */
export const NB_SIGNES = 8;
const sigmoide = (z: number) => 1 / (1 + Math.exp(-z));

// ------------------------------------------------------------------------------------------------ calibration
export interface Calibration {
  /** Confiance dans l'APPLI du premier choix (un poids par signe) ; « seul » et « trois » se règlent sur elle. */
  poids: number[]; seuilSeul: number; seuilTrois: number; cas: number;
  /** Confiance dans l'ACTION quand l'appli est juste (un poids par signe, ou aucun) et son seuil (relecture du tour 2, G1). */
  poidsAction?: number[]; seuilAction?: number;
  /** Régression « hors du champ » (un poids par signe, ou aucun) et son seuil ; cas du champ qu'elle y envoie, cas hors champ qu'elle trouve (validation croisée). */
  poidsHorsChamp?: number[]; seuilHorsChamp?: number; champVersHorsChamp?: number; horsChampRegle?: number; justesse1: number; justesse3: number; /** Cas du champ dont l'appli est juste au 1er rang (part). */ appli1?: number; horsChamp: { n: number; justes: number }; ms: number;
  /** Le second temps (tour 6, reclasse.ts) : poids appris par validation croisée sur la matière, et ce qu'il y donne. */
  reclasse?: ModeleReclasse; reclasseCas?: number; reclasseAppli1?: number }
export interface CasValidation { appli: string | null; action: string | null; vote: Vote; juste1: boolean; juste3: boolean; appliJuste: boolean; /** L'appli attendue est dans les trois premiers. */ appliJuste3?: boolean }

/** Pli d'une paire pour la validation croisée (même clé de texte → même pli : un doublon ne se retrouve jamais des deux côtés). */
export function pli(texte: string, plis: number): number { return hacher(texte) % plis; }
/** Empreinte FNV-1a de la clé de texte (pli, et choix des cas testés quand il y en a trop). */
function hacher(texte: string): number {
  let h = 2166136261; for (const ch of cleTexte(texte)) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/**
 * Validation croisée sur la matière : chaque demande apprise est retirée (avec son pli) puis aiguillée. Toute AUTRE paire
 * de même clé de texte (un mot de module identique à la demande, par exemple) est retirée avec elle (relecture P5).
 * `ignorer` (facultatif) : paires jamais testées ni votantes (les corrections du propriétaire : la calibration ne dépend
 * que de la matière du dépôt).
 */
export function validationCroisee(ix: IndexNgrammes, parAppli: Map<string, number[]>, mots: MotsFn | undefined, plis = 5, ignorer?: Uint8Array, preferences: ReadonlyArray<readonly [string, string]> = PREFERENCES,
  surPli?: (exclu: Uint8Array, cas: Array<{ i: number; cas: CasValidation }>) => void): CasValidation[] {
  const N = ix.paires.length;
  const pliDe = new Int16Array(N).fill(-1);
  const cles = ix.paires.map((p) => cleTexte(p.texte));
  const pliDeCle = new Map<string, number>();
  // Plis groupés (réglage `plisGroupes`) : toutes les phrases d'une même action, d'une même source (un fichier de
  // matière, une langue de v2…) tombent dans le même pli : une phrase testée n'a plus de « jumelle » du même rédacteur.
  const grouper = ix.reglages.plisGroupes;
  // Les phrases sœurs de la matière (traductions alignées, même `groupe`) tombent toujours dans le même pli (relecture du
  // tour 2, M1) : sinon la traduction d'une phrase testée vote pour elle et la validation croisée est trop belle.
  ix.paires.forEach((p, i) => { if (p.demande && !(ignorer && ignorer[i])) { pliDe[i] = grouper ? hacher(`${p.source} ${p.appli ?? ''} ${p.action ?? ''}`) % plis : p.groupe ? hacher(`groupe ${p.groupe}`) % plis : pli(p.texte, plis); pliDeCle.set(cles[i], pliDe[i]); } });
  // Trop de demandes : on n'en teste qu'une sur `pas`, choisie par l'empreinte de son texte (sans hasard). Les autres
  // restent retirées avec leur pli (elles ne votent pas pour leurs voisines du même pli).
  let n = 0; for (let i = 0; i < N; i++) if (pliDe[i] >= 0) n++;
  const pas = Math.max(1, Math.ceil(n / Math.max(1, ix.reglages.casMax)));
  // Les demandes « pas encore », rares, sont toujours testées.
  const teste = (i: number) => pas === 1 || ix.paires[i].appli === null || Math.floor(hacher(ix.paires[i].texte) / plis) % pas === 0;
  const out: CasValidation[] = [];
  for (let f = 0; f < plis; f++) {
    const exclu = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (pliDe[i] === f || pliDeCle.get(cles[i]) === f || (ignorer && ignorer[i])) exclu[i] = 1;
    const duPli: Array<{ i: number; cas: CasValidation }> = [];
    for (let i = 0; i < N; i++) {
      if (pliDe[i] !== f || !teste(i)) continue;
      const p = ix.paires[i], v = voter(ix, parAppli, p.texte, undefined, mots, exclu, preferences);
      const attendu = cle(p), c = v.candidats;
      const ok = (x: Candidat | undefined) => Boolean(x && x.appli === attendu && (attendu === HORS_CHAMP || p.action === null || x.action === p.action));
      out.push({ appli: p.appli, action: p.action, vote: v, appliJuste: c[0]?.appli === attendu, appliJuste3: c.slice(0, 3).some((x) => x.appli === attendu), juste1: ok(c[0]), juste3: c.slice(0, 3).some(ok) });
      if (surPli) duPli.push({ i, cas: out[out.length - 1] });
    }
    // Le second temps (tour 6) tire ses exemples de chaque pli tant que ses paires sont retirées.
    if (surPli) surPli(exclu, duPli);
  }
  return out;
}

/** Régression logistique (descente de gradient déterministe, petite pénalité L2) : confiance = P(appli + action justes au 1er rang). */
export function ajusterLogistique(X: number[][], y: number[], tours = 400, pas = 0.5, l2 = 1e-3): number[] {
  const d = X[0]?.length ?? 0, w = new Array<number>(d).fill(0);
  if (!X.length) return w;
  for (let t = 0; t < tours; t++) {
    const g = new Array<number>(d).fill(0);
    for (let i = 0; i < X.length; i++) { let z = 0; for (let j = 0; j < d; j++) z += w[j] * X[i][j]; const e = sigmoide(z) - y[i]; for (let j = 0; j < d; j++) g[j] += e * X[i][j]; }
    for (let j = 0; j < d; j++) w[j] -= pas * (g[j] / X.length + (j ? l2 * w[j] : 0));
  }
  return w;
}

/** Le seuil le plus bas tel que, parmi les cas de confiance au moins égale, la part juste atteigne `vise` (au moins `min` cas). */
export function seuilPour(conf: number[], juste: boolean[], vise: number, min = 30): number {
  const o = conf.map((c, i) => [c, juste[i] ? 1 : 0] as const).sort((a, b) => b[0] - a[0]);
  let ok = 0, best = Infinity;
  for (let i = 0; i < o.length; i++) {
    ok += o[i][1];
    // On ne coupe qu'entre deux confiances différentes.
    if (i + 1 < o.length && o[i + 1][0] === o[i][0]) continue;
    if (i + 1 >= min && ok / (i + 1) >= vise) best = o[i][0];
  }
  return best === Infinity ? 1.01 : best;
}

export function calibrer(cas: CasValidation[], R: Reglages): Calibration {
  const t0 = performance.now();
  // Seuls les cas où l'aiguilleur peut décider (couverture suffisante) règlent ses seuils.
  const dans = cas.filter((c) => c.appli !== null && c.vote.candidats[0]?.appli !== HORS_CHAMP && c.vote.couverture >= Math.max(R.couvertureMin, R.couvertureDecider ?? 0));
  // Relecture du tour 2 (G1) : réglée sur appli + action, « seul » n'était plus jamais atteint avec la matière des 15
  // langues (les cas les plus sûrs avaient l'appli juste 30 fois sur 30 mais l'action 28 fois sur 30). « seul » et
  // « trois » se règlent donc sur l'APPLI ; l'action a sa propre confiance, réglée sur les cas dont l'appli est juste et
  // qui attendent une action précise. « seul » sans action sûre : Odin ouvre l'appli et demande l'action.
  const X = dans.map((c) => signes(c.vote)), y = dans.map((c) => (c.appliJuste ? 1 : 0));
  const poids = ajusterLogistique(X, y);
  const conf = X.map((x) => sigmoide(x.reduce((s, v, j) => s + v * poids[j], 0)));
  const seuilSeul = seuilPour(conf, dans.map((c) => c.appliJuste), R.viseSeul);
  const seuilTrois = Math.min(seuilSeul, seuilPour(conf, dans.map((c) => c.appliJuste3 ?? c.juste3), R.viseTrois));
  const avecAction = dans.filter((c) => c.appliJuste && c.action !== null && c.vote.candidats[0]?.action);
  const poidsAction = avecAction.length ? ajusterLogistique(avecAction.map((c) => signesAction(c.vote)), avecAction.map((c) => (c.juste1 ? 1 : 0))) : [];
  const confA = avecAction.map((c) => sigmoide(signesAction(c.vote).reduce((s, v, j) => s + v * poidsAction[j], 0)));
  const seuilAction = poidsAction.length ? seuilPour(confA, avecAction.map((c) => c.juste1), R.viseSeul) : 1.01;
  // « Pas encore » : une seconde régression (mêmes signes) dit si la demande est hors du champ. Son seuil est le plus
  // bas qui ne fait pas perdre plus de `perteHorsChamp` des demandes du champ (comptées sur celles dont la première
  // appli n'est pas déjà « pas encore »).
  const vus = cas.filter((c) => c.vote.couverture >= R.couvertureMin && c.vote.candidats[0]?.appli !== HORS_CHAMP);
  const hcVus = vus.filter((c) => c.appli === null).length;
  const poidsHorsChamp = hcVus >= 5 ? ajusterLogistique(vus.map((c) => signes(c.vote)), vus.map((c) => (c.appli === null ? 1 : 0))) : [];
  const pHC = (c: CasValidation) => (poidsHorsChamp.length ? sigmoide(signes(c.vote).reduce((s, v, j) => s + v * poidsHorsChamp[j], 0)) : 0);
  const champ = vus.filter((c) => c.appli !== null).map(pHC).sort((a, b) => b - a);
  const perdus = Math.floor(R.perteHorsChamp * champ.length);
  const seuilHorsChamp = !poidsHorsChamp.length || R.perteHorsChamp <= 0 || !champ.length ? 1.01 : Math.min(1.01, champ[perdus] + 1e-9);
  const versHC = (c: CasValidation) => c.vote.candidats[0]?.appli === HORS_CHAMP || (c.vote.couverture >= R.couvertureMin && pHC(c) >= seuilHorsChamp);
  const hc = cas.filter((c) => c.appli === null);
  return {
    poids, seuilSeul, seuilTrois, poidsAction, seuilAction, cas: cas.length, poidsHorsChamp, seuilHorsChamp,
    champVersHorsChamp: cas.filter((c) => c.appli !== null && c.vote.candidats[0]?.appli !== HORS_CHAMP && versHC(c)).length,
    horsChampRegle: hc.filter(versHC).length,
    justesse1: cas.length ? cas.filter((c) => c.juste1).length / cas.length : 0,
    justesse3: cas.length ? cas.filter((c) => c.juste3).length / cas.length : 0,
    appli1: (() => { const ch = cas.filter((c) => c.appli !== null); return ch.length ? ch.filter((c) => c.appliJuste).length / ch.length : 0; })(),
    horsChamp: { n: hc.length, justes: hc.filter((c) => c.juste1).length }, ms: Math.round(performance.now() - t0),
  };
}

// ------------------------------------------------------------------------------------------------ le second temps (tour 6)
/** Le second temps de chaque cœur d'index, par réglages (fait une fois : un cœur partagé le partage aussi). */
const RECLASSEURS = new WeakMap<CoeurIndex, Map<string, Reclasseur>>();
function reclasseurDe(ix: IndexNgrammes): Reclasseur {
  const R = ix.reglages, k = JSON.stringify([R.reclasseAlpha, R.reclasseBeta, R.reclasseTours, R.poidsDemande]);
  let m = RECLASSEURS.get(ix.coeur); if (!m) RECLASSEURS.set(ix.coeur, m = new Map());
  let rc = m.get(k);
  if (!rc) { rc = new Reclasseur(ix, { alpha: R.reclasseAlpha, beta: R.reclasseBeta, tours: R.reclasseTours, pasLocal: 1, poidsDemande: R.poidsDemande }); m.set(k, rc); }
  return rc;
}
/** Au moins ce nombre d'exemples (validation croisée) pour apprendre le second temps ; sinon, il ne sert pas. */
export const RECLASSE_EXEMPLES_MIN = 30;

/**
 * Un exemple pour le second temps, tiré d'un cas de la validation croisée (la paire testée, retirée avec son pli) : les
 * traits de ses candidates (les trois premières du vote, sans « pas encore ») et le rang de la bonne appli. Rien si
 * « pas encore » est en tête, si la bonne appli n'est pas parmi elles ou s'il n'y a qu'une candidate.
 */
export function exempleReclasse(rc: Reclasseur, p: Paire, vote: Vote, tot: TotauxReclasse, exclu: Uint8Array): { X: number[][]; y: number } | undefined {
  const e = candidatesReclasse(p, vote, nbCandidates(vote.candidats, rc.ix.reglages));
  if (!e) return undefined;
  const X = rc.traits(e.texte, e.S, e.parts, tot, exclu);
  return X.length ? { X, y: e.y } : undefined;
}
/**
 * (tour 7) Combien des premières du vote vont au second temps : les trois premières toujours, puis, jusqu'à
 * `candidatesSecond`, chaque suivante tant que sa part atteint `candidatesRapport` fois celle de la première.
 */
export function nbCandidates(c: ReadonlyArray<{ part: number }>, R: Reglages): number {
  const K = Math.max(3, R.candidatesSecond ?? 3), p0 = c[0]?.part ?? 0;
  let n = Math.min(3, c.length);
  while (n < Math.min(K, c.length) && c[n].part >= (R.candidatesRapport ?? 0) * p0) n++;
  return n;
}
/** Ce dont un exemple du second temps a besoin (la demande, ses `K` premières candidates, leurs parts, le rang de la bonne), ou rien (voir exempleReclasse). */
function candidatesReclasse(p: Paire, vote: Vote, K: number): { texte: string; S: string[]; parts: number[]; y: number } | undefined {
  if (p.appli === null) return undefined;
  const c3 = vote.candidats.slice(0, K);
  if (!c3.length || c3[0].appli === HORS_CHAMP) return undefined;
  const c = c3.filter((x) => x.appli !== HORS_CHAMP), S = c.map((x) => x.appli), y = S.indexOf(p.appli);
  if (S.length < 2 || y < 0) return undefined;
  return { texte: p.texte, S, parts: c.map((x) => x.part), y };
}
/**
 * Les exemples d'un pli, dans l'ordre de ses cas : exactement ceux que exempleReclasse rendrait un par un, mais le modèle
 * local n'est appris qu'une fois pour les cas qui ont les mêmes candidates (Reclasseur.traitsLot). `partage` : ESSAIS
 * SEULEMENT (partagerSecondTemps) ; Odin ne le passe jamais hors essai, rien n'y est alors ni gardé ni repris.
 */
export function exemplesReclasse(rc: Reclasseur, cas: Array<{ p: Paire; vote: Vote }>, tot: TotauxReclasse, exclu: Uint8Array, partage?: { cle: string; table: Map<string, number[][]> }): Array<{ X: number[][]; y: number }> {
  const lot = cas.map((x) => candidatesReclasse(x.p, x.vote, nbCandidates(x.vote.candidats, rc.ix.reglages))).filter((e) => e !== undefined);
  // Partage (essais, voir partagerSecondTemps) : des traits déjà calculés pour EXACTEMENT les mêmes entrées (même index,
  // mêmes phrases retirées, même demande, mêmes candidates et mêmes parts, au dernier chiffre près) sont repris.
  const cles = partage ? lot.map((e) => `${partage.cle}\u0001${e.texte}\u0001${e.S.join('\u0002')}\u0001${e.parts.map(String).join('\u0002')}`) : undefined;
  const aFaire = cles ? lot.map((_, j) => j).filter((j) => !partage!.table.has(cles[j])) : lot.map((_, j) => j);
  const faits = rc.traitsLot(aFaire.map((j) => lot[j]), tot, exclu), Xs: number[][][] = new Array(lot.length);
  aFaire.forEach((j, n) => { Xs[j] = faits[n]; if (cles) partage!.table.set(cles[j], faits[n]); });
  if (cles) { lot.forEach((_, j) => { Xs[j] ??= partage!.table.get(cles[j])!; }); PARTAGE_VU.repris += lot.length - aFaire.length; PARTAGE_VU.calcules += aFaire.length; }
  const out: Array<{ X: number[][]; y: number }> = [];
  lot.forEach((e, j) => { if (Xs[j].length) out.push({ X: Xs[j], y: e.y }); });
  return out;
}

/**
 * Partage des traits du second temps entre deux calibrations du même processus (ESSAIS seulement : un essai qui refait
 * la calibration par l'ancien chemin du vote puis par le nouveau). Un trait n'est repris que pour des entrées
 * identiques (voir exemplesReclasse) : si les deux chemins votent différemment, il est recalculé et l'écart se voit.
 * Hors essai, rien n'est partagé ni gardé.
 */
let PARTAGE: Map<string, number[][]> | undefined;
const PARTAGE_VU = { repris: 0, calcules: 0 };
export function partagerSecondTemps(oui: boolean): void { PARTAGE = oui ? new Map() : undefined; PARTAGE_VU.repris = 0; PARTAGE_VU.calcules = 0; }
/** Traits repris et calculés depuis partagerSecondTemps(true). */
export function partageSecondTempsVu(): { repris: number; calcules: number } { return { ...PARTAGE_VU }; }
/** La clé d'un pli pour le partage : tout l'index (paires, réglages) et les phrases retirées. */
function clePartage(ix: IndexNgrammes, exclu: Uint8Array): string {
  const h = createHash('sha256');
  h.update(JSON.stringify(ix.reglages));
  for (const p of ix.paires) h.update(`${JSON.stringify([p.texte, p.appli, p.action, p.poids ?? null, p.demande ?? null, p.source, p.groupe ?? null])}\n`);
  h.update(exclu);
  return h.digest('hex');
}

/** Apprend les poids du second temps sur les exemples de la validation croisée ; rien en dessous de RECLASSE_EXEMPLES_MIN. */
export function apprendreReclasse(exemples: Array<{ X: number[][]; y: number }>, R: Reglages): Pick<Calibration, 'reclasse' | 'reclasseCas' | 'reclasseAppli1'> {
  if (exemples.length < RECLASSE_EXEMPLES_MIN) return {};
  const m = ajusterReclasse(exemples);
  let justes = 0;
  for (const e of exemples) if (ordreReclasse(noterReclasse(m, e.X), R.reclasseMarge)[0] === e.y) justes++;
  return { reclasse: m, reclasseCas: exemples.length, reclasseAppli1: justes / exemples.length };
}

// ------------------------------------------------------------------------------------------------ corrections du propriétaire
export const fichierCorrections = (home: string): string => join(home, 'cerveau-reseau', 'aiguilleur-corrections.json');
/** Seule provenance acceptée : le propriétaire lui-même a validé le choix. Tout le reste (page, document, courriel,
 *  automatisation, autre personne…) est refusé : un contenu extérieur ne doit jamais apprendre à Odin où envoyer une demande.
 *  Ce n'est qu'une chaîne : c'est l'appelant qui garantit qu'elle vient d'un geste du propriétaire (voir l'en-tête). */
export const PROVENANCE_ACCEPTEE = 'proprietaire';
export const CORRECTIONS_MAX = 10_000;
/** Longueur maximale d'une demande apprise (caractères), à l'apprentissage comme à la relecture. */
export const DEMANDE_MAX = 500;
/** Taille maximale du fichier de corrections : 10 000 demandes de 500 caractères de 4 octets et leurs champs y tiennent. Au-delà, il n'est pas lu. */
export const CORRECTIONS_OCTETS_MAX = 24 * 1024 * 1024;
/** Au-delà de ce nombre d'ajouts parcourus un par un, l'index est reconstruit avec eux. */
export const AJOUTS_AVANT_REPLI = 256;
export interface Correction { demande: string; appli: string | null; action: string | null; provenance: string; quand?: string }

/**
 * Les corrections gardées, relues avec les MÊMES bornes qu'à l'apprentissage (relecture M3) : fichier de
 * CORRECTIONS_OCTETS_MAX au plus (sinon non lu, et c'est dit), demandes de DEMANDE_MAX caractères au plus, une seule par
 * phrase (la dernière l'emporte), les CORRECTIONS_MAX plus récentes. Ce qui est écarté est compté.
 */
export function lireCorrectionsBilan(home: string): { corrections: Correction[]; ignorees: number; raison?: string } {
  const f = fichierCorrections(home);
  let octets: number;
  try { octets = statSync(f).size; } catch { return { corrections: [], ignorees: 0 }; }
  if (octets > CORRECTIONS_OCTETS_MAX) return { corrections: [], ignorees: 0, raison: `fichier de corrections trop gros (${octets} octets, ${CORRECTIONS_OCTETS_MAX} au plus) : non lu` };
  let brut: unknown[];
  try { const j = JSON.parse(readFileSync(f, 'utf8')) as { corrections?: unknown }; brut = Array.isArray(j?.corrections) ? j.corrections : []; }
  catch { return { corrections: [], ignorees: 0, raison: 'fichier de corrections illisible : non lu' }; }
  const parCle = new Map<string, Correction>();
  let ignorees = 0;
  for (const c of brut) {
    const x = c as Correction;
    const ok = typeof x?.demande === 'string' && x.provenance === PROVENANCE_ACCEPTEE && (x.appli === null || typeof x.appli === 'string')
      && x.demande.trim() !== '' && [...x.demande].length <= DEMANDE_MAX;
    if (!ok) { ignorees++; continue; }
    const k = cleTexte(x.demande);
    if (!k) { ignorees++; continue; }
    if (parCle.has(k)) { ignorees++; parCle.delete(k); }
    const appli = x.appli === 'aucune' ? null : x.appli;
    parCle.set(k, { demande: x.demande, appli, action: appli !== null && typeof x.action === 'string' ? x.action : null, provenance: x.provenance, quand: typeof x.quand === 'string' ? x.quand : undefined });
  }
  const tout = [...parCle.values()], garde = tout.slice(-CORRECTIONS_MAX);
  return { corrections: garde, ignorees: ignorees + tout.length - garde.length };
}
/** Les corrections gardées (absent, illisible ou trop gros : aucune). */
export function lireCorrections(home: string): Correction[] { return lireCorrectionsBilan(home).corrections; }

/**
 * Garde une correction (demande, appli, action) validée par le propriétaire. Refuse ce qui ne vient pas de lui, une
 * demande vide ou trop longue, une appli absente (relecture P2 : donner une appli, ou « aucune » / null pour « pas
 * encore »), une appli ou une action inconnue (si la liste des applis est donnée). Si le fichier existant ne peut pas
 * être relu (trop gros, illisible), rien n'est écrit : il ne sera pas écrasé.
 */
export function apprendreCorrection(home: string, c: Correction, applis?: Map<string, Set<string>>): { ok: true } | { ok: false; raison: string } {
  if (!c || c.provenance !== PROVENANCE_ACCEPTEE) return { ok: false, raison: `provenance refusée (${String(c?.provenance ?? 'absente')}) : seule une correction validée par le propriétaire est apprise` };
  const demande = typeof c.demande === 'string' ? c.demande.replace(CONTROLE, ' ').replace(/\s+/gu, ' ').trim() : '';
  if (!demande || !cleTexte(demande)) return { ok: false, raison: 'demande vide' };
  if ([...demande].length > DEMANDE_MAX) return { ok: false, raison: `demande trop longue (${DEMANDE_MAX} caractères au plus)` };
  if (c.appli !== null && typeof c.appli !== 'string') return { ok: false, raison: 'appli absente : donner une appli, ou « aucune » pour « pas encore »' };
  const appli = c.appli === 'aucune' ? null : c.appli;
  const action = appli === null ? null : typeof c.action === 'string' ? c.action : null;
  if (applis && appli !== null) {
    const acts = applis.get(appli);
    if (!acts) return { ok: false, raison: `appli inconnue : ${appli}` };
    if (action !== null && !acts.has(action)) return { ok: false, raison: `action inconnue : ${appli}.${action}` };
  }
  const lu = lireCorrectionsBilan(home);
  if (lu.raison) return { ok: false, raison: `${lu.raison} ; rien n'est écrit, pour ne pas l'écraser` };
  const k = cleTexte(demande);
  const garde = lu.corrections.filter((x) => cleTexte(x.demande) !== k);
  garde.push({ demande, appli, action, provenance: PROVENANCE_ACCEPTEE, quand: new Date().toISOString() });
  const f = fichierCorrections(home);
  // Nom provisoire propre à cet appel : deux écritures ne se marchent pas dessus (une écriture concurrente peut encore
  // perdre la correction de l'autre : pas de verrou entre processus).
  const tmp = `${f}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    mkdirSync(join(home, 'cerveau-reseau'), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ version: 1, corrections: garde.slice(-CORRECTIONS_MAX) }), { mode: 0o600 });
    renameSync(tmp, f);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* rien à retirer */ }
    return { ok: false, raison: `écriture impossible : ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
  return { ok: true };
}

/**
 * Retire du fichier une correction que le propriétaire fait oublier (même phrase, à la ponctuation et à la casse près).
 * Rend `retiree: false` si elle n'y était pas. Si le fichier ne peut pas être relu, rien n'est écrit (comme pour
 * apprendre). Ce qui est gardé ailleurs (index en mémoire, préparation sur le disque) est l'affaire de l'appelant
 * (aiguilleur-pret.ts : oublierCorrection).
 */
export function retirerCorrection(home: string, demande: string): { ok: true; retiree: boolean } | { ok: false; raison: string } {
  const k = cleTexte(typeof demande === 'string' ? demande.replace(CONTROLE, ' ') : '');
  if (!k) return { ok: false, raison: 'demande vide' };
  const lu = lireCorrectionsBilan(home);
  if (lu.raison) return { ok: false, raison: `${lu.raison} ; rien n'est écrit, pour ne pas l'écraser` };
  const garde = lu.corrections.filter((x) => cleTexte(x.demande) !== k);
  if (garde.length === lu.corrections.length) return { ok: true, retiree: false };
  const f = fichierCorrections(home), tmp = `${f}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify({ version: 1, corrections: garde }), { mode: 0o600 });
    renameSync(tmp, f);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* rien à retirer */ }
    return { ok: false, raison: `écriture impossible : ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
  return { ok: true, retiree: true };
}

// ------------------------------------------------------------------------------------------------ calibration gardée
export const fichierCalibration = (home: string): string => join(home, 'cerveau-reseau', 'aiguilleur-calibration.json');
const CALIBRATIONS = new Map<string, Calibration>();
/** Oublie les calibrations gardées en mémoire (essais). */
export function oublierCalibrations(): void { CALIBRATIONS.clear(); }

/**
 * Empreinte de ce dont dépend la calibration (relecture M6) : la matière du dépôt (sans les corrections), les réglages,
 * la présence des mots, et le TEXTE du code qui vote, tire les signes et valide (un changement de calcul la refait).
 */
function empreinte(paires: Paire[], R: Reglages, avecMots: boolean, prefs: ReadonlyArray<readonly [string, string]> = PREFERENCES): string {
  const h = createHash('sha256');
  h.update(JSON.stringify({ R, avecMots, prefs }));
  h.update(voter.toString()); h.update(partager.toString()); h.update(explication.toString()); h.update(IndexNgrammes.prototype.expliquer.toString()); h.update(codeDuReclasse()); h.update(apprendreReclasse.toString()); h.update(exempleReclasse.toString()); h.update(candidatesReclasse.toString()); h.update(nbCandidates.toString()); h.update(exemplesReclasse.toString()); h.update(centres.toString()); h.update(kPlusProches.toString()); h.update(signes.toString()); h.update(signesAction.toString()); h.update(codeDeAction()); h.update(validationCroisee.toString()); h.update(hacher.toString()); h.update(calibrer.toString()); h.update(nettoyer.toString()); h.update(String(SIGNES_FACULTATIFS));
  for (const p of paires) h.update(`${JSON.stringify([p.texte, p.appli, p.action, p.poids ?? 1, Boolean(p.demande), p.source, p.groupe ?? null])}\n`);
  return h.digest('hex');
}
/** Une calibration lue d'un fichier n'est crue que si sa forme et ses bornes sont justes. */
function calibrationValide(x: unknown): Calibration | undefined {
  const c = x as Calibration;
  const fini = (v: unknown, a: number, b: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
  // Un poids par signe, ou aucun (matière sans demande du champ : la confiance vaut alors 0,5).
  if (!c || typeof c !== 'object' || !Array.isArray(c.poids) || (c.poids.length !== NB_SIGNES && c.poids.length !== 0) || !c.poids.every((v) => fini(v, -1e3, 1e3))) return undefined;
  if (!fini(c.seuilSeul, 0, 1.01) || !fini(c.seuilTrois, 0, 1.01) || c.seuilTrois > c.seuilSeul) return undefined;
  const ph = c.poidsHorsChamp ?? [];
  if (!Array.isArray(ph) || (ph.length !== NB_SIGNES && ph.length !== 0) || !ph.every((v) => fini(v, -1e3, 1e3)) || !fini(c.seuilHorsChamp ?? 1.01, 0, 1.01)) return undefined;
  const pa = c.poidsAction ?? [];
  if (!Array.isArray(pa) || (pa.length !== NB_SIGNES && pa.length !== 0) || !pa.every((v) => fini(v, -1e3, 1e3)) || !fini(c.seuilAction ?? 1.01, 0, 1.01)) return undefined;
  const n = (v: unknown) => (fini(v, 0, 1e9) ? v : 0);
  // Le second temps : un poids, une moyenne et un écart (non nul) par trait, ou rien.
  const rc = c.reclasse as ModeleReclasse | undefined;
  const liste = (l: unknown, min: number) => Array.isArray(l) && l.length === NB_TRAITS && l.every((v) => fini(v, min, 1e6));
  if (rc !== undefined && (!rc || typeof rc !== 'object' || !liste(rc.w, -1e6) || !liste(rc.moy, -1e6) || !liste(rc.ec, 1e-12))) return undefined;
  return {
    ...(rc ? { reclasse: { w: rc.w.slice(), moy: rc.moy.slice(), ec: rc.ec.slice() }, reclasseCas: n(c.reclasseCas), reclasseAppli1: n(c.reclasseAppli1) } : {}),
    poids: c.poids.slice(), seuilSeul: c.seuilSeul, seuilTrois: c.seuilTrois, poidsAction: pa.slice(), seuilAction: c.seuilAction ?? 1.01, cas: n(c.cas), poidsHorsChamp: ph.slice(), seuilHorsChamp: c.seuilHorsChamp ?? 1.01, champVersHorsChamp: n(c.champVersHorsChamp), horsChampRegle: n(c.horsChampRegle), justesse1: n(c.justesse1), justesse3: n(c.justesse3), appli1: n(c.appli1),
    horsChamp: { n: n(c.horsChamp?.n), justes: n(c.horsChamp?.justes) }, ms: n(c.ms),
  };
}
function lireCalibration(home: string, emp: string): Calibration | undefined {
  try {
    const f = fichierCalibration(home);
    if (statSync(f).size > 64 * 1024) return undefined;
    const j = JSON.parse(readFileSync(f, 'utf8')) as { empreinte?: unknown; calibration?: unknown };
    return j?.empreinte === emp ? calibrationValide(j.calibration) : undefined;
  } catch { return undefined; }
}
function ecrireCalibration(home: string, emp: string, c: Calibration): void {
  const f = fichierCalibration(home), tmp = `${f}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    mkdirSync(join(home, 'cerveau-reseau'), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ version: 1, empreinte: emp, calibration: c }), { mode: 0o600 });
    renameSync(tmp, f);
  } catch { try { rmSync(tmp, { force: true }); } catch { /* rien à retirer */ } }
}

// ------------------------------------------------------------------------------------------------ l'aiguilleur
export interface BilanAiguilleur {
  paires: number; grammes: number;
  /** Corrections du propriétaire en mémoire (une par phrase), écartées à la relecture, et pourquoi le fichier n'a pas été lu. */
  corrections: number; correctionsIgnorees: number; correctionsRaison?: string;
  /** Ajouts parcourus un par un (au plus AJOUTS_AVANT_REPLI : au-delà, l'index est reconstruit). */
  ajoutsEnAttente: number;
  msIndex: number; msCalibration: number; calibration: Calibration;
  /** D'où vient la calibration : calculée, gardée en mémoire, relue du dossier d'Odin, ou fournie. */
  calibrationDe: 'calcul' | 'memoire' | 'fichier' | 'fournie';
  /** Ce que le chargeur de la matière par langue a lu, écarté ou refusé (absent : sans elle). */
  matiere?: BilanMatiere;
  /** D'où vient le cœur de l'index (aiguilleur-pret.ts) : calculé, gardé en mémoire, relu du dossier d'Odin ; absent : calculé ici. */
  preparationDe?: 'calcul' | 'memoire' | 'fichier';
  /** Pourquoi une préparation gardée n'a pas servie (abîmée, périmée…), pour le journal. */
  preparationRaison?: string;
}
export interface Aiguilleur {
  aiguiller(phrase: string, ctx?: ContexteAiguilleur): ReponseAiguilleur;
  /** Garde une correction validée et l'ajoute aussitôt à l'index (une correction refaite remplace l'ancienne). */
  apprendre(c: Correction): { ok: true } | { ok: false; raison: string };
  readonly bilan: BilanAiguilleur;
}

export interface OptionsAiguilleur {
  modules: ModuleMatiere[];
  /** Dossier d'Odin (pour les corrections et la calibration gardée) ; sans lui, rien n'est relu ni gardé sur le disque. */
  home?: string;
  mots?: MotsFn;
  reglages?: Partial<Reglages>;
  usages?: Array<{ need: string; chain: string[] }>;
  survol?: Record<string, { phrase: string; faire: string[] }>;
  /** Calibration déjà faite (sinon : gardée, ou validation croisée sur la matière, quelques secondes). */
  calibration?: Calibration;
  /** Dossier de la matière par langue (défaut : src/brain/nous/matiere du dépôt) ; false : sans elle. */
  matiere?: string | false;
  /** Règles par défaut entre deux applis vraiment possibles, [préférée, autre] (défaut : PREFERENCES). */
  preferences?: ReadonlyArray<readonly [string, string]>;
  /** Fabrique de l'index des paires (aiguilleur-pret.ts : un cœur gardé prêt et vérifié) ; défaut : calculé ici. */
  index?: (paires: Paire[], R: Reglages) => IndexNgrammes;
}

/** Construit l'aiguilleur (index, calibration par validation croisée sur la matière, corrections relues). */
export function creerAiguilleurSync(o: OptionsAiguilleur): Aiguilleur {
  const R: Reglages = { ...REGLAGES, ...(o.reglages ?? {}) };
  const prefs = o.preferences ?? PREFERENCES;
  const lu = o.home ? lireCorrectionsBilan(o.home) : { corrections: [] as Correction[], ignorees: 0, raison: undefined };
  const applis = new Map(o.modules.map((m) => [m.id, new Set(m.actions.map((a) => a.id))]));
  const lecture = new Set(o.modules.flatMap((m) => m.actions.filter((a) => a.read === true).map((a) => `${m.id}.${a.id}`)));
  const valides = lu.corrections.filter((c) => c.appli === null || (applis.has(c.appli) && (c.action === null || applis.get(c.appli)!.has(c.action))));
  const t0 = performance.now();
  const lm = o.matiere === false ? undefined : lireMatiere(applis, o.matiere ?? DOSSIER_MATIERE);
  const paires = matiere(o.modules, { usages: o.usages, survol: o.survol, parLangue: lm?.paires, corrections: valides.map((c) => ({ texte: c.demande, appli: c.appli, action: c.action, source: 'correction', poids: 2, demande: true })) });
  let ix = o.index ? o.index(paires, R) : new IndexNgrammes(paires, R);
  let parAppli = new Map<string, number[]>();
  /** Clé de texte d'une correction → indice de sa paire (dans l'ordre : la plus ancienne d'abord). */
  const cles = new Map<string, number>();
  const ranger = (i: number) => { const p = ix.paire(i); const l = parAppli.get(cle(p)) ?? []; l.push(i); parAppli.set(cle(p), l); };
  const indexer = () => {
    parAppli = new Map(); cles.clear();
    for (let i = 0; i < ix.taille; i++) { if (!ix.vivante(i)) continue; ranger(i); const p = ix.paire(i); if (p.source === 'correction') { const k = cleTexte(p.texte); cles.delete(k); cles.set(k, i); } }
    for (const m of o.modules) if (!parAppli.has(m.id)) parAppli.set(m.id, []);
  };
  const retirer = (i: number) => { const l = parAppli.get(cle(ix.paire(i))); const j = l ? l.indexOf(i) : -1; if (j >= 0) l!.splice(j, 1); ix.retirer(i); };
  indexer();
  const msIndex = performance.now() - t0;
  const t1 = performance.now();
  let calibration: Calibration, calibrationDe: BilanAiguilleur['calibrationDe'];
  if (o.calibration) { calibration = o.calibration; calibrationDe = 'fournie'; }
  else {
    const emp = empreinte(paires.filter((p) => p.source !== 'correction'), R, Boolean(o.mots), prefs);
    const enMemoire = CALIBRATIONS.get(emp), duFichier = enMemoire ? undefined : o.home ? lireCalibration(o.home, emp) : undefined;
    if (enMemoire) { calibration = enMemoire; calibrationDe = 'memoire'; }
    else if (duFichier) { calibration = duFichier; calibrationDe = 'fichier'; }
    else {
      const ignorer = new Uint8Array(ix.paires.length); ix.paires.forEach((p, i) => { if (p.source === 'correction') ignorer[i] = 1; });
      // Le second temps apprend sur les mêmes cas, chacun avec les paires de son pli retirées (tour 6).
      const rc = R.reclasser ? reclasseurDe(ix) : undefined, exemples: Array<{ X: number[][]; y: number }> = [];
      let msR = 0;
      const surPli = rc ? (exclu: Uint8Array, l: Array<{ i: number; cas: CasValidation }>) => {
        const t = performance.now(), tot = rc.totaux(exclu);
        const partage = PARTAGE ? { cle: clePartage(ix, exclu), table: PARTAGE } : undefined;
        for (const e of exemplesReclasse(rc, l.map(({ i, cas }) => ({ p: ix.paires[i], vote: cas.vote })), tot, exclu, partage)) exemples.push(e);
        msR += performance.now() - t;
      } : undefined;
      calibration = calibrer(validationCroisee(ix, parAppli, o.mots, 5, ignorer, prefs, surPli), R); calibrationDe = 'calcul';
      // Le temps du second temps compte dans celui de la calibration.
      if (rc) { const t = performance.now(); Object.assign(calibration, apprendreReclasse(exemples, R)); calibration.ms += Math.round(msR + performance.now() - t); }
      if (o.home) ecrireCalibration(o.home, emp, calibration);
    }
    CALIBRATIONS.set(emp, calibration);
  }
  const msCalibration = performance.now() - t1;
  const vivantes = () => { let n = 0; for (let i = 0; i < ix.taille; i++) if (ix.vivante(i)) n++; return n; };
  const bilan: BilanAiguilleur = {
    paires: vivantes(), grammes: ix.grammes, corrections: cles.size, correctionsIgnorees: lu.ignorees, ...(lu.raison ? { correctionsRaison: lu.raison } : {}),
    ajoutsEnAttente: ix.enAttente, msIndex: Math.round(msIndex), msCalibration: Math.round(msCalibration), calibration, calibrationDe,
    ...(lm ? { matiere: lm.bilan } : {}),
  };
  let couverture: number | undefined;
  const reponse = (choix: ChoixAiguilleur[], decision: DecisionAiguilleur, confiance: number, raison: string, confianceAction?: number): ReponseAiguilleur => {
    const p = choix[0];
    const actionSure = decision === 'seul' && Boolean(p?.action) && confianceAction !== undefined && confianceAction >= (calibration.seuilAction ?? 1.01);
    return {
      choix, decision, confiance, raison, confirmer: !(p?.appli && p.action && lecture.has(`${p.appli}.${p.action}`)), actionSure,
      ...(confianceAction === undefined ? {} : { confianceAction }), ...(couverture === undefined ? {} : { couverture: Number(couverture.toFixed(4)) }),
    };
  };

  /** Paires de base qui ne votent pas dans le second temps (les corrections : il ne dépend que de la matière), par index. */
  let horsReclasse: { ix: IndexNgrammes; exclu: Uint8Array; tot: TotauxReclasse } | undefined;
  /**
   * Le second temps sur les trois choix (modifiés sur place) ; rend vrai si la première appli a changé. Rien pour une
   * relance dans une appli active, quand « pas encore » est en tête, quand une correction du propriétaire a tranché, ou
   * quand une correction voisine de la demande désigne l'appli en tête.
   * Après lui, la règle par défaut du propriétaire entre deux applis presque à égalité est réappliquée.
   */
  const reclasserChoix = (choix: ChoixAiguilleur[], c: Candidat[], v: Vote, propre: string, ctx?: ContexteAiguilleur): boolean => {
    const mr = calibration.reclasse;
    if (!mr || v.correction || v.correctionTete || (typeof ctx?.appli === 'string' && ctx.appli) || !choix.length || choix[0].appli === null) return false;
    // (tour 7) Les premières du vote (voir nbCandidates) sont départagées ; « pas encore » garde sa place ; les trois
    // premières de la liste revue deviennent les trois choix.
    // Limite connue (relecture du tour 7, constat 5) : une candidate de rang 4 ou 5 qui remonte dans les trois garde
    // l'action du tour 6 (le vote ne calcule l'action d'action.ts que pour les trois premières).
    const K = nbCandidates(c, R);
    const liste: ChoixAiguilleur[] = c.slice(0, K).map((x, i) => (i < choix.length ? choix[i] : { appli: x.appli === HORS_CHAMP ? null : x.appli, action: x.appli === HORS_CHAMP ? null : x.action, score: 0 }));
    const places = liste.map((y, i) => (y.appli !== null ? i : -1)).filter((i) => i >= 0);
    if (places.length < 2) return false;
    const rc = reclasseurDe(ix);
    if (horsReclasse?.ix !== ix) {
      const exclu = new Uint8Array(ix.paires.length); ix.paires.forEach((p, i) => { if (p.source === 'correction') exclu[i] = 1; });
      horsReclasse = { ix, exclu, tot: rc.totaux(exclu) };
    }
    const X = rc.traits(propre, places.map((i) => liste[i].appli!), places.map((i) => c[i].part), horsReclasse.tot, horsReclasse.exclu);
    if (!X.length) return false;
    const ordre = ordreReclasse(noterReclasse(mr, X), R.reclasseMarge);
    if (ordre.every((o2, j) => o2 === j)) return false;
    const avant = choix[0].appli, parts = new Map(c.map((y) => [y.appli, y.part]));
    const vieux = places.map((i) => liste[i]);
    places.forEach((pl, j) => { liste[pl] = vieux[ordre[j]]; });
    for (let i = 0; i < choix.length; i++) choix[i] = liste[i];
    if (choix[0].appli !== avant && R.margePreference > 0 && choix[1]?.appli) {
      const x0 = choix[0].appli!, y0 = choix[1].appli, px = parts.get(x0) ?? 0, py = parts.get(y0) ?? 0;
      if (prefs.some(([pref, autre]) => pref === y0 && autre === x0) && py >= (1 - R.margePreference) * px) { const t = choix[0]; choix[0] = choix[1]; choix[1] = t; }
    }
    // Les notes suivent le nouvel ordre (même formule que le vote, jamais plus haute que celle d'avant).
    let prec = Infinity;
    choix.forEach((y, i) => { const part = parts.get(y.appli ?? HORS_CHAMP) ?? 0; const sc = Math.min(prec, Number((1 / (i + 1) * (0.5 + 0.5 * part)).toFixed(6))); choix[i] = { ...y, score: sc }; prec = sc; });
    return choix[0].appli !== avant;
  };

  return {
    bilan,
    aiguiller(phrase: string, ctx?: ContexteAiguilleur): ReponseAiguilleur {
      const propre = nettoyer(phrase);
      couverture = undefined;
      if (!propre.replace(/[^\p{L}\p{N}]/gu, '')) return reponse([], 'main', 0, 'demande vide');
      const v = voter(ix, parAppli, propre, ctx, o.mots, undefined, prefs);
      couverture = v.couverture;
      const c = v.candidats;
      if (!c.length) return reponse([], 'main', 0, 'rien de ressemblant dans la matière');
      // Rien ne ressemble vraiment (une langue ou une écriture que la matière ne connaît pas) : la main, sans liste par défaut.
      if (v.couverture < R.couvertureMin) return reponse([], 'main', 0, `la matière ne connaît presque rien de cette demande (couverture ${v.couverture.toFixed(3)})`);
      const choix: ChoixAiguilleur[] = c.slice(0, 3).map((x, i) => ({ appli: x.appli === HORS_CHAMP ? null : x.appli, action: x.appli === HORS_CHAMP ? null : x.action, score: Number((1 / (i + 1) * (0.5 + 0.5 * x.part)).toFixed(6)) }));
      if (c[0].appli === HORS_CHAMP) return reponse(choix, 'main', Number(Math.min(1, c[0].part).toFixed(4)), 'hors du champ d\'Odin (pas encore)');
      const x = signes(v);
      // La régression « hors du champ » : au-dessus de son seuil, « pas encore » passe devant et l'aiguilleur passe la main.
      const ph = calibration.poidsHorsChamp ?? [];
      if (ph.length) {
        const p = sigmoide(x.reduce((s, val, j) => s + val * (ph[j] ?? 0), 0));
        if (p >= (calibration.seuilHorsChamp ?? 1.01)) {
          const sans = choix.filter((y) => y.appli !== null).slice(0, 2);
          return reponse([{ appli: null, action: null, score: 1 }, ...sans.map((y, i) => ({ ...y, score: Number((y.score / (i + 2)).toFixed(6)) }))], 'main', Number(p.toFixed(4)), 'sans doute hors du champ (pas encore)');
        }
      }
      const conf = sigmoide(x.reduce((s, val, j) => s + val * (calibration.poids[j] ?? 0), 0));
      // Le second temps (tour 6) : les candidates du champ sont départagées ; une autre appli ne passe devant que si sa
      // note dépasse celle de la première d'au moins `reclasseMarge`.
      const change = R.reclasser ? reclasserChoix(choix, c, v, propre, ctx) : false;
      // Une demande que la matière connaît mal (une langue qu'elle n'a pas, souvent) : pas de décision, des pistes.
      const malConnue = v.couverture < (R.couvertureDecider ?? 0);
      let decision: DecisionAiguilleur = malConnue ? 'main' : conf >= calibration.seuilSeul ? 'seul' : conf >= calibration.seuilTrois ? 'trois' : 'main';
      // La confiance a été réglée sur la première du vote : une autre tête n'agit jamais seule.
      if (change && decision === 'seul') decision = 'trois';
      const pa = calibration.poidsAction ?? [];
      const xa = signesAction(v), confA = !change && choix[0]?.action && pa.length ? Number(sigmoide(xa.reduce((s, val, j) => s + val * (pa[j] ?? 0), 0)).toFixed(4)) : undefined;
      const r = reponse(choix, decision, Number(conf.toFixed(4)), malConnue ? `la matière connaît mal cette demande (couverture ${v.couverture.toFixed(3)}) : des pistes, pas de choix` : decision === 'trois' ? (change ? 'trois choix (ordre revu par le second temps)' : 'trois choix') : 'pas sûr', confA);
      if (r.decision === 'seul') r.raison = r.actionSure ? 'sûr de l\'appli et de l\'action' : 'sûr de l\'appli ; l\'action est à demander';
      return r;
    },
    apprendre(cr: Correction) {
      if (!o.home) return { ok: false, raison: 'pas de dossier d\'Odin : rien n\'est gardé' };
      const r = apprendreCorrection(o.home, cr, applis);
      if (!r.ok) return r;
      const appli = cr.appli === 'aucune' ? null : cr.appli, k = cleTexte(cr.demande);
      // Une correction refaite remplace l'ancienne, en mémoire comme dans le fichier (relecture M4).
      const avant = cles.get(k);
      if (avant !== undefined) { retirer(avant); cles.delete(k); }
      ix.ajouter({ texte: cr.demande, appli, action: appli === null ? null : cr.action, source: 'correction', poids: 2, demande: true });
      ranger(ix.taille - 1); cles.set(k, ix.taille - 1);
      while (cles.size > CORRECTIONS_MAX) { const [k0, i0] = cles.entries().next().value!; retirer(i0); cles.delete(k0); }
      // Ajouts bornés (relecture M5) : au-delà de quelques centaines, l'index est reconstruit avec eux.
      if (ix.enAttente > AJOUTS_AVANT_REPLI) { ix = new IndexNgrammes(ix.vivantes(), R); indexer(); bilan.grammes = ix.grammes; }
      bilan.corrections = cles.size; bilan.paires = vivantes(); bilan.ajoutsEnAttente = ix.enAttente;
      return r;
    },
  };
}

/** Même chose, forme asynchrone (attendue par le banc). */
export async function creerAiguilleur(o: OptionsAiguilleur): Promise<Aiguilleur> { return creerAiguilleurSync(o); }

// ------------------------------------------------------------------------------------------------ branchement du banc
/**
 * Pour le banc (test/soul-banc/methodes.ts) : l'aiguilleur sur les applis du produit, dans le dossier jetable du banc.
 * Variante (seulement pour mesurer) par la variable ODIN_AIGUILLEUR_VARIANTE : « ngrammes » (défaut depuis le tour 2 :
 * n-grammes seuls, meilleurs au tour 1), « fusion » (n-grammes + mots), « tour5 » (n-grammes seuls, le calcul du tour
 * 5 : sans part expliquée ni second temps, voir CALCUL_TOUR5) ou « tour6 » (le calcul du tour 6, voir CALCUL_TOUR6).
 */
export async function methodeBanc(o: { home: string }): Promise<{ repondre(phrase: string, ctx?: ContexteAiguilleur): ReponseAiguilleur; bilan: Aiguilleur['bilan'] }> {
  const { allModules } = await import('../../valhalla/odin.ts');
  const { Valhalla } = await import('../../valhalla/service.ts');
  const { appsFor } = await import('../../valhalla/besoin.ts');
  const { USAGES } = await import('../../valhalla/links.ts');
  const { SURVOL } = await import('../../valhalla/survol.ts');
  const mods = allModules({ paths: { home: o.home, workspace: o.home }, cfg: { venus: {}, voice: {} } } as never);
  // La recherche par mots du produit, sans démarrer de Valhalla : `find` ne lit que la liste des modules.
  const parId = new Map(mods.map((m) => [m.id, m]));
  const porteur = { modules: () => mods };
  const finder = { find: (need: string) => Valhalla.prototype.find.call(porteur as never, need), module: (id: string) => parId.get(id) };
  const v = process.env.ODIN_AIGUILLEUR_VARIANTE, variante = v === 'fusion' || v === 'tour5' || v === 'tour6' ? v : 'ngrammes';
  const mots: MotsFn = (p) => appsFor(finder, p, 5).map((x) => ({ appli: x.m.id, action: x.action?.id ?? null, score: x.score }));
  // L'aiguilleur prêt (aiguilleur-pret.ts) : mêmes réponses, l'index gardé en mémoire vive et sur le disque.
  const { creerAiguilleurPret } = await import('./aiguilleur-pret.ts');
  const a = creerAiguilleurPret({ modules: mods, home: o.home, mots: variante === 'fusion' ? mots : undefined, usages: USAGES, survol: SURVOL, reglages: variante === 'fusion' ? {} : { poidsMots: 0, ...(variante === 'tour5' ? CALCUL_TOUR5 : variante === 'tour6' ? CALCUL_TOUR6 : {}) } });
  return { repondre: (p, c) => a.aiguiller(p, c), bilan: a.bilan };
}
