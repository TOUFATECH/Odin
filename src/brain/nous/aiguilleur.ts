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
//   5. les relances : le tour précédent et l'appli active comptent dans le choix.
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
}
/**
 * Réglages par défaut : choisis par validation croisée sur la matière (carnet soul-v3, sections de l'aiguilleur). Tour 2
 * (17/11, matière fr + en) : centres d'applis ×4, IDF par appli ^0,5, « pas encore » devant dès la moitié de la part de
 * la première appli, préférence du propriétaire à 10 % près, « seul » visé à 95 %. `couvertureMin` (0,02) est posé à la
 * main : la matière ne couvre pas encore les écritures qu'il protège, la validation croisée ne peut pas le régler.
 * Après la relecture du tour 2 (matière des 15 langues) : « seul » visé sur l'appli (l'action a sa propre confiance),
 * `couvertureDecider` 0,6 réglé en retirant une langue entière par pli.
 */
export const REGLAGES: Reglages = {
  nMin: 1, nMax: 4, k: 25, puissance: 2, poidsMots: 0.3, rangR: 3, bonusContexte: 0.35, poidsPrecedent: 0.3, contexte: 'proche', viseSeul: 0.95, viseTrois: 0.85, poidsDemande: 2, prior: 0, poidsHorsChamp: 1,
  vote: 'voisins', parAppli: 3, couvertureMin: 0.02, couvertureNMin: 1, couvertureDecider: 0.6, margePreference: 0.1, casMax: 1500, idfAppli: 0.5, poidsCentre: 4, rapportHorsChamp: 0.5, perteHorsChamp: 0, plisGroupes: false,
};

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
/**
 * Index inversé des paires (n-grammes TF-IDF, vecteurs normés), avec des ajouts tardifs (corrections) parcourus à part.
 * Une paire peut être retirée (correction refaite) : elle ne vote plus. Les ajouts sont peu nombreux : au-delà de
 * AJOUTS_AVANT_REPLI, l'aiguilleur reconstruit l'index avec eux (voir `apprendre` dans creerAiguilleurSync).
 */
export class IndexNgrammes {
  readonly paires: Paire[];
  readonly reglages: Reglages;
  private vocab = new Map<string, number>();
  private idf: Float64Array;
  private debut: Int32Array; private postDoc: Int32Array; private postPoids: Float32Array;
  private scores: Float32Array;
  private ajouts: Array<{ paire: Paire; vec: Map<string, number>; retire: boolean }> = [];
  private nBase: number;
  private masque: Uint8Array;
  /** Les n-grammes des ajouts (corrections) : ils comptent dans la couverture (ceux d'un ajout retiré aussi). */
  private grammesAjoutes = new Set<string>();
  /** Facteur de l'IDF par appli d'un n-gramme jamais vu (1 sans IDF par appli). */
  private facteurInconnu = 1;

  constructor(paires: Paire[], reglages: Reglages) {
    this.paires = paires.slice(); this.reglages = reglages;
    const N = this.paires.length; this.nBase = N;
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
    this.postDoc = new Int32Array(total); this.postPoids = new Float32Array(total);
    const pos = Int32Array.from(compte.subarray(0, df.length));
    vecs.forEach((v, d) => { for (let i = 0; i < v.ids.length; i++) { const p = pos[v.ids[i]]++; this.postDoc[p] = d; this.postPoids[p] = v.ws[i]; } });
    this.scores = new Float32Array(N);
    this.masque = new Uint8Array(N);
  }

  private normesC?: Map<string, number>;
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
  ressemblances(texte: string, exclu?: Uint8Array): { idx: number[]; sim: number[]; couverture: number } {
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
    return { idx, sim, couverture: this.couverture(q) };
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
interface Candidat { appli: string; part: number; action: string | null; partAction: number }
interface Vote {
  candidats: Candidat[]; sim1: number; motsTete: string | null; motsVide: boolean;
  /** Part de la demande que la matière connaît (voir IndexNgrammes.couverture). */
  couverture: number;
  /** Part du vote « pas encore », même quand il n'est pas premier. */
  partHorsChamp: number;
}

const cle = (p: Paire) => p.appli ?? HORS_CHAMP;
const poidsDe = (p: Paire, R: Reglages) => (p.poids ?? 1) * (p.demande ? R.poidsDemande : 1) * (p.appli === null ? R.poidsHorsChamp : 1);

/** Les parts de chaque appli (et de « pas encore ») d'après des ressemblances, selon la règle de vote (normées à 1). */
function partager(ix: IndexNgrammes, parAppli: Map<string, number[]>, idx: number[], sim: number[]): { parts: Map<string, number>; sim1: number } {
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
    // Les K plus proches.
    const ordre = idx.map((_, i) => i).sort((a, b) => sim[b] - sim[a] || idx[a] - idx[b]).slice(0, R.k);
    for (const i of ordre) { const p = ix.paire(idx[i]); const w = Math.pow(sim[i], R.puissance) * poidsDe(p, R); out.set(cle(p), (out.get(cle(p)) ?? 0) + w); tot += w; }
    if (R.prior > 0) { tot = 0; for (const [a, w] of out) { const x = w / Math.pow(Math.max(1, parAppli.get(a)?.length ?? 1), R.prior); out.set(a, x); tot += x; } }
  }
  if (tot > 0) for (const [a, w] of out) out.set(a, w / tot);
  if (R.poidsCentre > 0 && R.vote !== 'centre') {
    // Mélange : les voisins, plus (poidsCentre ×) les centres des applis ; renormé.
    const c = centres(ix, idx, sim); let tc = 0; for (const x of c.values()) tc += x;
    if (tc > 0) { let t = 0; for (const [k, x] of c) out.set(k, (out.get(k) ?? 0) + R.poidsCentre * x / tc); for (const x of out.values()) t += x; for (const [k, x] of out) out.set(k, x / t); }
  }
  return { parts: out, sim1 };
}

/** Le cosinus de la requête avec le centre de chaque appli (paires de base seulement), à la puissance `puissance`. */
function centres(ix: IndexNgrammes, idx: number[], sim: number[]): Map<string, number> {
  const R = ix.reglages, normes = ix.normesCentres((p) => poidsDe(p, R)), somme = new Map<string, number>(), out = new Map<string, number>();
  for (let i = 0; i < idx.length; i++) { if (idx[i] >= ix.paires.length) continue; const p = ix.paire(idx[i]); somme.set(cle(p), (somme.get(cle(p)) ?? 0) + poidsDe(p, R) * sim[i]); }
  for (const [k, x] of somme) { const nn = normes.get(k) ?? 0; if (nn > 0) out.set(k, Math.pow(x / nn, R.puissance)); }
  return out;
}

/** Le vote des voisins (et des mots), sans décision. */
function voter(ix: IndexNgrammes, parAppli: Map<string, number[]>, phrase: string, ctx: ContexteAiguilleur | undefined, mots: MotsFn | undefined, exclu?: Uint8Array, preferences: ReadonlyArray<readonly [string, string]> = PREFERENCES): Vote {
  const R = ix.reglages;
  const { idx, sim, couverture } = ix.ressemblances(phrase, exclu);
  const { parts, sim1 } = partager(ix, parAppli, idx, sim);
  // Relance : le tour précédent vote un peu, l'appli active reçoit une part.
  if (ctx && (ctx.precedent || ctx.appli)) {
    if (typeof ctx.precedent === 'string' && ctx.precedent.trim()) {
      const pr = ix.ressemblances(ctx.precedent, exclu);
      const p2 = partager(ix, parAppli, pr.idx, pr.sim).parts;
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
  if (corr >= 0 && simCorr >= CORRECTION_IDENTIQUE) {
    const k = cle(ix.paire(corr)), j = classement.indexOf(k);
    if (j !== 0) { if (j > 0) classement.splice(j, 1); classement.unshift(k); }
  }
  // Pour chaque appli candidate : l'action, par les ressemblances de ses propres paires.
  const simDe = new Map<number, number>(); idx.forEach((d, i) => simDe.set(d, sim[i]));
  const candidats: Candidat[] = classement.slice(0, 5).map((a) => {
    if (a === HORS_CHAMP) return { appli: a, part: parts.get(a) ?? 0, action: null, partAction: 0 };
    const parAction = new Map<string, number[]>();
    for (const d of parAppli.get(a) ?? []) { const s = simDe.get(d); if (!s) continue; const p = ix.paire(d); if (!p.action) continue; const l = parAction.get(p.action) ?? []; l.push(s * (p.poids ?? 1)); parAction.set(p.action, l); }
    let best: string | null = null, bs = 0, tot2 = 0;
    for (const [act, l] of [...parAction.entries()].sort((x, y) => cmp(x[0], y[0]))) {
      const s = l.sort((x, y) => y - x).slice(0, 3).reduce((u, v) => u + v * v, 0);
      tot2 += s; if (s > bs) { bs = s; best = act; }
    }
    // Relance sans indice d'action dans la phrase : l'action précédente si on reste dans la même appli.
    if (ctx?.appli === a && typeof ctx.actionPrecedente === 'string' && (!best || bs < 0.04)) { best = ctx.actionPrecedente; bs = Math.max(bs, 0.04); tot2 = Math.max(tot2, bs); }
    const mx = m.find((x) => x.appli === a);
    if (!best && mx?.action) { best = mx.action; bs = 1; tot2 = 1; }
    return { appli: a, part: parts.get(a) ?? 0, action: best, partAction: tot2 > 0 ? bs / tot2 : 0 };
  });
  return { candidats, sim1, motsTete, motsVide: m.length === 0, couverture, partHorsChamp: parts.get(HORS_CHAMP) ?? 0 };
}

function safeMots(mots: MotsFn, phrase: string): Array<{ appli: string; action: string | null; score: number }> {
  try { return (mots(phrase) ?? []).filter((x) => x && typeof x.appli === 'string'); } catch { return []; }
}

/** Les signes dont on tire la confiance. */
function signes(v: Vote): number[] {
  const c = v.candidats, p1 = c[0]?.part ?? 0, p2 = c[1]?.part ?? 0;
  const marge = p1 > 0 ? Math.max(0, (p1 - p2) / p1) : 0;
  const accord = v.motsVide ? 0.5 : v.motsTete === c[0]?.appli ? 1 : 0;
  return [1, marge, p1, Math.min(1, v.sim1), accord, c[0]?.partAction ?? 0, v.couverture, v.partHorsChamp];
}
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
  poidsHorsChamp?: number[]; seuilHorsChamp?: number; champVersHorsChamp?: number; horsChampRegle?: number; justesse1: number; justesse3: number; /** Cas du champ dont l'appli est juste au 1er rang (part). */ appli1?: number; horsChamp: { n: number; justes: number }; ms: number }
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
export function validationCroisee(ix: IndexNgrammes, parAppli: Map<string, number[]>, mots: MotsFn | undefined, plis = 5, ignorer?: Uint8Array, preferences: ReadonlyArray<readonly [string, string]> = PREFERENCES): CasValidation[] {
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
    for (let i = 0; i < N; i++) {
      if (pliDe[i] !== f || !teste(i)) continue;
      const p = ix.paires[i], v = voter(ix, parAppli, p.texte, undefined, mots, exclu, preferences);
      const attendu = cle(p), c = v.candidats;
      const ok = (x: Candidat | undefined) => Boolean(x && x.appli === attendu && (attendu === HORS_CHAMP || p.action === null || x.action === p.action));
      out.push({ appli: p.appli, action: p.action, vote: v, appliJuste: c[0]?.appli === attendu, appliJuste3: c.slice(0, 3).some((x) => x.appli === attendu), juste1: ok(c[0]), juste3: c.slice(0, 3).some(ok) });
    }
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
  const poidsAction = avecAction.length ? ajusterLogistique(avecAction.map((c) => signes(c.vote)), avecAction.map((c) => (c.juste1 ? 1 : 0))) : [];
  const confA = avecAction.map((c) => sigmoide(signes(c.vote).reduce((s, v, j) => s + v * poidsAction[j], 0)));
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
  h.update(voter.toString()); h.update(partager.toString()); h.update(centres.toString()); h.update(signes.toString()); h.update(validationCroisee.toString()); h.update(hacher.toString()); h.update(calibrer.toString()); h.update(nettoyer.toString()); h.update(String(SIGNES_FACULTATIFS));
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
  return {
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
  let ix = new IndexNgrammes(paires, R);
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
      calibration = calibrer(validationCroisee(ix, parAppli, o.mots, 5, ignorer, prefs), R); calibrationDe = 'calcul';
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
      // Une demande que la matière connaît mal (une langue qu'elle n'a pas, souvent) : pas de décision, des pistes.
      const malConnue = v.couverture < (R.couvertureDecider ?? 0);
      const decision: DecisionAiguilleur = malConnue ? 'main' : conf >= calibration.seuilSeul ? 'seul' : conf >= calibration.seuilTrois ? 'trois' : 'main';
      const pa = calibration.poidsAction ?? [];
      const confA = choix[0]?.action && pa.length ? Number(sigmoide(x.reduce((s, val, j) => s + val * (pa[j] ?? 0), 0)).toFixed(4)) : undefined;
      const r = reponse(choix, decision, Number(conf.toFixed(4)), malConnue ? `la matière connaît mal cette demande (couverture ${v.couverture.toFixed(3)}) : des pistes, pas de choix` : decision === 'trois' ? 'trois choix' : 'pas sûr', confA);
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
 * n-grammes seuls, meilleurs au tour 1) ou « fusion » (n-grammes + mots).
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
  const variante = process.env.ODIN_AIGUILLEUR_VARIANTE === 'fusion' ? 'fusion' : 'ngrammes';
  const mots: MotsFn = (p) => appsFor(finder, p, 5).map((x) => ({ appli: x.m.id, action: x.action?.id ?? null, score: x.score }));
  const a = creerAiguilleurSync({ modules: mods, home: o.home, mots: variante === 'ngrammes' ? undefined : mots, usages: USAGES, survol: SURVOL, reglages: variante === 'ngrammes' ? { poidsMots: 0 } : {} });
  return { repondre: (p, c) => a.aiguiller(p, c), bilan: a.bilan };
}
