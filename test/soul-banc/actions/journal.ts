// Banc d'actions : les JOURNAUX d'un entraînement (JSONL, une ligne par événement) et le fichier SCELLÉ des mesures du
// banc caché. Prouvé par test/stats-actions.test.ts.
//
// DEUX RACINES, pour que l'entraînement ne puisse jamais lire le banc :
//   racine de la BOUCLE   <boucle>/<run>/journal.jsonl        écrit par la boucle d'apprentissage
//   racine du BANC        <banc>/prevus.json                  la liste des runs prévus, écrite AVANT le premier run
//                         <banc>/<run>/porte.jsonl            écrit par le processus du banc (la porte)
//                         <banc>/<run>/cache-scelle.jsonl     écrit par le processus du banc (le banc caché)
//                         <banc>/ouvertures.jsonl             chaque ouverture des fichiers scellés, notée ici
// La boucle ne reçoit JAMAIS le chemin de la racine du banc. Elle reçoit de la porte « gardé » ou « refusé », rien
// d'autre. L'audit des lectures de la boucle doit refuser tout fichier pour lequel `interditALaBoucle` dit vrai.
// Choisir une racine du banc qui ne se devine pas depuis celle de la boucle (pas un dossier voisin du même nom).
//
// Format v2 (la version est dans chaque ligne). C'est le format v1 du plan (section 5.3), avec trois changements :
// les lignes « porte » et « mesure » quittent le journal de la boucle (elles portaient les comptes du banc de porte) ;
// chaque ligne porte l'empreinte de la ligne d'avant (`pr`) ; l'en-tête porte l'empreinte de la liste des runs prévus.
//   journal.jsonl (boucle)      entete   qui tourne : run, variante, graine, commit, empreintes, réglages
//                               episode  un épisode d'entraînement : pas, compétence, essais, issue, récompense, fautes
//                               systeme  la machine : mémoire, temps de calcul, charge, pause
//                               fin      pourquoi le run s'arrête, portes gardées et refusées, durée
//   porte.jsonl (banc)          porte    un passage de porte : comptes en service et candidat, différence, marge, décision
//                               mesure   une mesure sur le banc de PORTE : comptes en tout et par compétence, fautes
//                               cloture  le banc dit que le run est fini pour lui, et scelle la fin des deux autres fichiers
//   cache-scelle.jsonl (banc)   plan     l'ordre fixe du banc caché : la compétence de chaque épisode, les cases tenues à part
//                               cache    une mesure à 0, 25, 50, 75 ou 100 % : comptes, et réussi / raté par épisode (« 1101… »)
//
// Six règles tenues ici :
//   1. AUCUNE PHRASE. Un épisode est désigné par une empreinte courte. Chaque champ de texte a une forme stricte :
//      une liste fermée (issue, raison d'arrêt, noms des mises à jour), un code, une empreinte, une date, ou un jeton
//      de deux mots au plus. Un champ en plus ne passe que s'il ne peut pas porter de texte. Limite dite : un jeton
//      court reste un mot ; c'est la liste fermée qui empêche d'écrire une demande, pas la longueur.
//   2. TAILLE BORNÉE. Un fichier ne dépasse jamais sa borne, et la borne a un plafond dur. Quand la place manque, les
//      lignes nombreuses (episode, systeme) s'arrêtent d'abord ; la dernière ligne (fin, cloture) a sa propre réserve
//      et passe toujours. Elle dit combien de lignes n'ont pas été écrites : rien ne disparaît en silence.
//   3. UN SEUL ÉCRIVAIN PAR FICHIER, en ajout seul. Un second écrivain romprait la chaîne, et la lecture le verrait.
//   4. UN FICHIER COUPÉ SE RELIT. La lecture saute une ligne cassée et la compte, sans erreur. La reprise commence
//      sur une ligne neuve, sans second en-tête.
//   5. CHAQUE LIGNE EST CHAÎNÉE à la précédente par une empreinte. Une ligne retouchée, retirée ou ajoutée au milieu
//      se voit. Limite dite : sans clé hors d'atteinte, quelqu'un qui réécrit TOUT un fichier en recalculant la chaîne
//      ne se voit pas ici ; la ligne « cloture » et le fichier des ouvertures servent d'ancres entre fichiers.
//   6. LE FICHIER SCELLÉ NE S'OUVRE QU'À LA FIN. `lireRuns` est la seule porte de lecture. Il n'ouvre rien tant qu'un
//      seul des runs PRÉVUS n'a pas sa ligne « fin » (boucle) ET sa ligne « cloture » (banc). Écarter un run ne l'ouvre
//      pas. Chaque ouverture est notée, avec l'empreinte de chaque fichier scellé.
//
// Qui appelle quoi (trois rôles, trois processus) :
//   - le LANCEUR, avant le premier run : `ecrirePrevus(racineDuBanc, { runs, comparer, temoin })`. Il donne à chaque
//     boucle l'empreinte rendue (un simple texte, pour son en-tête) et le chemin de SON journal, rien d'autre ;
//   - la BOUCLE : `ouvrirJournal(chemin)`, puis entete, episode, systeme, et « fin » en dernier. Ses réglages communs
//     (lot, pas_max, plafonds…) sont les mêmes pour tous les runs ; seuls ceux de `REGLAGES_PROPRES` diffèrent ;
//   - le BANC : `ouvrirPortes` et `ouvrirScelle` dans sa racine. À chaque porte : une ligne « porte » (la décision se
//     prend sur les nombres ÉCRITS : sans arrondi, ou décidée après l'arrondi), puis une ligne « mesure » de l'état en
//     service au même pas. À la fin : « cloture », avec le bout de chaîne du fichier scellé (`sommet()`) et, si le
//     lanceur le lui transmet, celui du journal de la boucle.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

export const VERSION = 2;
export const NOM_JOURNAL = 'journal.jsonl';
export const NOM_PORTES = 'porte.jsonl';
export const NOM_SCELLE = 'cache-scelle.jsonl';
export const NOM_PREVUS = 'prevus.json';
export const NOM_OUVERTURES = 'ouvertures.jsonl';
/** Les fichiers que la boucle n'a pas le droit d'ouvrir (à donner à l'audit de ses lectures). */
export const FICHIERS_DU_BANC: readonly string[] = Object.freeze([NOM_PORTES, NOM_SCELLE, NOM_PREVUS, NOM_OUVERTURES]);
/** Vrai si ce chemin est un fichier du côté du banc : la boucle ne doit jamais l'ouvrir. */
export const interditALaBoucle = (chemin: string): boolean => FICHIERS_DU_BANC.includes(basename(chemin).toLowerCase());

/** Borne d'un journal : 8 Mo (un run de 3 000 épisodes en prend environ 1). Onze runs tiennent loin sous les 200 Mo du plan. */
export const MAX_JOURNAL = 8 * 1024 * 1024;
/** Plafond dur : aucune borne demandée ne passe au-dessus. */
export const PLAFOND_JOURNAL = 64 * 1024 * 1024;
/** Borne d'une ligne : 32 Ko (la plus longue, le plan d'un banc de 600 épisodes, en prend 4 ; un banc de 4 000 tient encore). */
export const MAX_LIGNE = 32 * 1024;
export const PLAFOND_LIGNE = 256 * 1024;
/** Place gardée pour les lignes qui comptent, quand les épisodes ont rempli le reste. */
export const RESERVE = 256 * 1024;
/** Place gardée pour la seule dernière ligne (fin, cloture). */
export const RESERVE_FIN = 2048;
/** Borne de lecture : au-delà, seul le début est lu, et la lecture le dit. */
export const MAX_LECTURE = PLAFOND_JOURNAL;

/** Où le banc caché est mesuré, en pour cent de l'entraînement. */
export const PARTS: readonly number[] = Object.freeze([0, 25, 50, 75, 100]);
/**
 * Les issues d'un épisode (celles du vérificateur ; « reussi » est le mot du plan pour « succes » ; « tolere » : une
 * réponse acceptée pour la mesure mais sans rien à en apprendre, récompense 0).
 */
export const ISSUES: readonly string[] = Object.freeze(['succes', 'reussi', 'tolere', 'refus', 'rate', 'fausse']);
/** Les raisons d'arrêt d'un run. Hors « pas-max » et « trois-refus », le rapport le signale. */
export const RAISONS: readonly string[] = Object.freeze(['pas-max', 'trois-refus', 'refus-de-suite', 'stop', 'temps-max', 'memoire-max', 'disque-max', 'erreur', 'banc-altere', 'banc-faux']);
/** Les compteurs de mises à jour d'un épisode. */
export const MAJ: readonly string[] = Object.freeze(['aiguilleur', 'geste', 'geste_oublie', 'liens_plus', 'liens_moins', 'contre_ex']);
/**
 * Les seuls réglages qui ont le droit de différer d'un entraînement à l'autre : les trois améliorations de B (essayer
 * d'autres choix, baisser après un échec, pratiquer selon le progrès), « apprend » (faux pour le témoin) et
 * « verdicts_melanges » (vrai pour le témoin à verdicts mélangés). Tout autre réglage doit être le même pour tous les
 * runs (les plafonds de temps, de mémoire, de disque et de charge compris), sinon le rapport suspend la conclusion.
 */
export const REGLAGES_PROPRES: readonly string[] = Object.freeze(['exploration', 'facteur_signe', 'pratique_progres', 'apprend', 'verdicts_melanges']);

// ------------------------------------------------------------------------------------------------ les lignes
export interface Compte { k: number; n: number }
export interface LigneEntete {
  v: 2; t: 'entete'; pr: string; run: string; variante: string; graine: number; commit: string;
  banc_porte: string; banc_cache: string; monde: string; episodes: string;
  /** L'empreinte de la liste des runs prévus (prevus.json), donnée à la boucle comme un simple texte. */
  prevus: string;
  reglages: Readonly<Record<string, unknown>>; debut: string;
}
export interface LigneEpisode {
  v: 2; t: 'episode'; pr: string; run: string; pas: number; passage: number; ep: string; competence: string; langue: string;
  perturbe: boolean; essais: number; rang_retenu: number | null; issue: string; r: -1 | 0 | 1; surete: number; ms: number;
  maj: Readonly<Record<string, number>>;
}
export interface LigneSysteme { v: 2; t: 'systeme'; pr: string; run: string; pas: number; memoire_mo: number; cpu_s: number; charge: number; pause: boolean }
export interface LigneFin {
  v: 2; t: 'fin'; pr: string; run: string; pas: number; raison: string; portes: { gardees: number; refusees: number }; duree_s: number;
  /** Posé par l'écriture, seulement si des lignes n'ont pas été écrites faute de place : combien, par sorte. */
  omises?: Readonly<Record<string, number>>;
}
/** Les lignes du journal de la BOUCLE. */
export type Ligne = LigneEntete | LigneEpisode | LigneSysteme | LigneFin;

export interface LignePorte {
  v: 2; t: 'porte'; pr: string; run: string; pas: number; consultation: number; en_service: Compte; candidat: Compte;
  /** (candidat − en service) ÷ n. */
  diff_moy: number;
  /** L'erreur type de la différence par épisode (son écart type ÷ √n). */
  et_diff: number;
  marge: number; surete_candidat: number; decision: 'garde' | 'refuse'; ms: number;
}
export interface LigneMesure {
  v: 2; t: 'mesure'; pr: string; run: string; pas: number; banc: 'porte'; global: Compte; par_competence: Readonly<Record<string, Compte>>;
  /** Fautes de sûreté comptées pendant cette mesure (doit rester à 0). */
  surete: number;
  seul_faux?: Compte; parmi3?: Compte; diversite?: number;
}
export interface LigneCloture {
  v: 2; t: 'cloture'; pr: string; run: string; pas: number;
  /** L'empreinte de la dernière ligne du fichier scellé de ce run. */
  scelle: string;
  /** L'empreinte de la ligne « fin » du journal de la boucle, quand le lanceur la transmet au banc. */
  journal_fin?: string;
  omises?: Readonly<Record<string, number>>;
}
/** Les lignes du fichier de la PORTE (côté banc). */
export type LigneDuBanc = LignePorte | LigneMesure | LigneCloture;

export interface LignePlan {
  v: 2; t: 'plan'; pr: string; banc: 'cache'; empreinte: string; n: number; competences: readonly string[];
  /** « 1 » pour un épisode d'une case tenue à part (jamais vue à l'entraînement), « 0 » sinon ; facultatif. */
  tenues?: string;
}
export interface LigneCache {
  v: 2; t: 'cache'; pr: string; run: string; pas: number;
  /** Où en est l'entraînement, en pour cent : 0, 25, 50, 75 ou 100. Une seule mesure par valeur. */
  part: number;
  global: Compte; par_competence: Readonly<Record<string, Compte>>;
  /** Réussi (« 1 ») ou raté (« 0 ») pour chaque épisode, dans l'ordre du plan. */
  vecteur: string;
  /** Fautes de sûreté pendant cette mesure (doit rester à 0). */
  surete: number;
  seul_faux?: Compte; parmi3?: Compte;
}
export type LigneScellee = LignePlan | LigneCache;

export interface LigneOuverture {
  v: 2; t: 'ouverture'; pr: string; quand: string; prevus: string; sans: readonly string[];
  /** L'empreinte SHA-256 de chaque fichier scellé lu à cette ouverture, par run. */
  scelles: Readonly<Record<string, string>>;
}

/** Une ligne à écrire : la version et l'empreinte de la ligne d'avant sont posées par l'écriture. */
export type AEcrire<T> = T extends unknown ? Omit<T, 'v' | 'pr'> & { v?: number; pr?: string } : never;

// ------------------------------------------------------------------------------------------------ le contrôle de forme
type Obj = Record<string, unknown>;
const estObjet = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const nombre = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const positif = (x: unknown): x is number => nombre(x) && x >= 0;
const entier = (x: unknown, min = 0): x is number => nombre(x) && Number.isInteger(x) && x >= min && x <= Number.MAX_SAFE_INTEGER;
const compte = (x: unknown): x is Compte => estObjet(x) && Object.keys(x).length === 2 && entier(x.k) && entier(x.n) && x.k <= x.n;
const selon = (re: RegExp) => (x: unknown): boolean => typeof x === 'string' && re.test(x);
const parmi = (liste: readonly string[]) => (x: unknown): boolean => typeof x === 'string' && liste.includes(x);

/** Un nom de champ ou de réglage : des minuscules et des chiffres, trois morceaux au plus (« temps_max_s »). */
const CLE = /^(?=.{1,24}$)[a-z][a-z0-9]*(_[a-z0-9]+){0,2}$/;
/** Un jeton : deux mots au plus (« pas-max », « marge »). Pas de quoi écrire une demande. */
const JETON = /^(?=.{1,24}$)[A-Za-z0-9.:+]+([_-][A-Za-z0-9.:+]+)?$/;
const RE_RUN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/, RE_VARIANTE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/;
const run = selon(RE_RUN);
const empreinte = selon(/^sha256:[0-9a-f]{8,64}$/);
const empreinteEntiere = selon(/^sha256:[0-9a-f]{64}$/);
const maillon = selon(/^[0-9a-f]{12}$/);
const competence = selon(/^C[1-9][0-9]?$/);
const dateIso = selon(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);

/** Les réglages de l'en-tête : des nombres, vrai / faux, ou des jetons de deux mots au plus ; trois niveaux au plus. */
function reglagesSansTexte(x: unknown, niveau = 0): boolean {
  if (x === null || typeof x === 'boolean') return true;
  if (typeof x === 'number') return Number.isFinite(x);
  if (typeof x === 'string') return x === '' || JETON.test(x);
  if (niveau >= 3) return false;
  if (Array.isArray(x)) return x.length <= 16 && x.every((v) => reglagesSansTexte(v, niveau + 1));
  if (estObjet(x)) { const ks = Object.keys(x); return ks.length <= 64 && ks.every((k) => CLE.test(k) && reglagesSansTexte(x[k], niveau + 1)); }
  return false;
}
/** Un champ en plus : seulement ce qui ne peut pas porter de texte (nombre, vrai / faux, rien, objet de ces valeurs). */
function sansTexte(x: unknown, niveau = 0): boolean {
  if (x === null || typeof x === 'boolean') return true;
  if (typeof x === 'number') return Number.isFinite(x);
  if (niveau >= 2 || !estObjet(x)) return false;
  const ks = Object.keys(x);
  return ks.length <= 32 && ks.every((k) => CLE.test(k) && sansTexte(x[k], niveau + 1));
}
const comptesParCompetence = (x: unknown): boolean => estObjet(x) && Object.keys(x).length <= 99 && Object.entries(x).every(([k, v]) => competence(k) && compte(v));
const compteurs = (cles: readonly string[] | null) => (x: unknown): boolean => estObjet(x) && Object.keys(x).length <= 32 && Object.entries(x).every(([k, v]) => (cles ? cles.includes(k) : CLE.test(k)) && entier(v));

interface Regle { ok: (x: unknown) => boolean; quoi: string; facultatif?: boolean }
const R = (ok: (x: unknown) => boolean, quoi: string, facultatif = false): Regle => ({ ok, quoi, facultatif });
const PAS = R((x) => entier(x), 'un nombre entier d\'épisodes, à partir de 0');
const RUN = R(run, 'un nom de run court, sans espace');
const PR = R(maillon, 'l\'empreinte de la ligne d\'avant (12 caractères hexadécimaux)');
const COMPTE = (facultatif = false) => R(compte, 'un compte { k, n } avec k ≤ n', facultatif);
const OMISES = R(compteurs(null), 'un objet de compteurs entiers', true);

type Regles = Record<string, Record<string, Regle>>;
const REGLES_JOURNAL: Regles = {
  entete: {
    pr: PR, run: RUN, variante: R(selon(RE_VARIANTE), 'un nom de variante court'), graine: R((x) => entier(x), 'un nombre entier'),
    commit: R(selon(/^[0-9a-f]{7,40}$/), 'un numéro de commit en hexadécimal'),
    banc_porte: R(empreinte, 'une empreinte « sha256:… »'), banc_cache: R(empreinte, 'une empreinte « sha256:… »'),
    monde: R(empreinte, 'une empreinte « sha256:… »'), episodes: R(empreinte, 'une empreinte « sha256:… »'),
    prevus: R(empreinteEntiere, 'l\'empreinte « sha256:… » de la liste des runs prévus'),
    reglages: R((x) => estObjet(x) && reglagesSansTexte(x), 'un objet de nombres et de jetons de deux mots au plus, sans phrase'),
    debut: R(dateIso, 'une date ISO en temps universel'),
  },
  episode: {
    pr: PR, run: RUN, pas: R((x) => entier(x, 1), 'un nombre entier d\'épisodes, à partir de 1'), passage: R((x) => entier(x, 1), 'un nombre entier, à partir de 1'),
    ep: R(selon(/^[0-9a-f]{6,16}$/), 'une empreinte courte en hexadécimal (jamais la phrase)'),
    competence: R(competence, 'un code de compétence (C1, C2…)'), langue: R(selon(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/), 'un code de langue'),
    perturbe: R((x) => typeof x === 'boolean', 'vrai ou faux'), essais: R((x) => entier(x), 'un nombre entier'),
    rang_retenu: R((x) => x === null || entier(x), 'un rang entier, ou rien'), issue: R(parmi(ISSUES), `une issue de la liste : ${ISSUES.join(', ')}`),
    r: R((x) => x === -1 || x === 0 || x === 1, '−1, 0 ou +1'), surete: R((x) => entier(x), 'un nombre entier de fautes'),
    ms: R(positif, 'une durée en millisecondes'), maj: R(compteurs(MAJ), `des compteurs entiers de la liste : ${MAJ.join(', ')}`),
  },
  systeme: {
    pr: PR, run: RUN, pas: PAS, memoire_mo: R(positif, 'un nombre positif'), cpu_s: R(positif, 'un nombre positif'), charge: R(positif, 'un nombre positif'),
    pause: R((x) => typeof x === 'boolean', 'vrai ou faux'),
  },
  fin: {
    pr: PR, run: RUN, pas: PAS, raison: R(parmi(RAISONS), `une raison de la liste : ${RAISONS.join(', ')}`),
    portes: R((x) => estObjet(x) && Object.keys(x).length === 2 && entier(x.gardees) && entier(x.refusees), 'un objet { gardees, refusees }'),
    duree_s: R(positif, 'une durée en secondes'), omises: OMISES,
  },
};
const REGLES_PORTES: Regles = {
  porte: {
    pr: PR, run: RUN, pas: PAS, consultation: R((x) => entier(x, 1), 'un nombre entier, à partir de 1'), en_service: COMPTE(), candidat: COMPTE(),
    diff_moy: R(nombre, 'un nombre'), et_diff: R(positif, 'un nombre positif'), marge: R(positif, 'un nombre positif'),
    surete_candidat: R((x) => entier(x), 'un nombre entier de fautes'), decision: R((x) => x === 'garde' || x === 'refuse', '« garde » ou « refuse »'),
    ms: R(positif, 'une durée en millisecondes'),
  },
  mesure: {
    pr: PR, run: RUN, pas: PAS, banc: R((x) => x === 'porte', '« porte » : les mesures du banc caché vont dans le fichier scellé'),
    global: COMPTE(), par_competence: R(comptesParCompetence, 'un compte { k, n } par code de compétence'),
    surete: R((x) => entier(x), 'un nombre entier de fautes'),
    seul_faux: COMPTE(true), parmi3: COMPTE(true), diversite: R(positif, 'un nombre positif', true),
  },
  cloture: { pr: PR, run: RUN, pas: PAS, scelle: R(maillon, 'l\'empreinte de la dernière ligne du fichier scellé'), journal_fin: R(maillon, 'l\'empreinte de la ligne « fin » du journal', true), omises: OMISES },
};
const REGLES_SCELLE: Regles = {
  plan: {
    pr: PR, banc: R((x) => x === 'cache', '« cache »'), empreinte: R(empreinte, 'une empreinte « sha256:… »'), n: R((x) => entier(x, 1), 'un nombre entier d\'épisodes'),
    competences: R((x) => Array.isArray(x) && x.length <= 4000 && x.every(competence), 'la liste des codes de compétence, un par épisode'),
    tenues: R(selon(/^[01]{1,4000}$/), 'une suite de 0 et de 1, un par épisode', true),
  },
  cache: {
    pr: PR, run: RUN, pas: PAS, part: R((x) => PARTS.includes(x as number), `une part de l'entraînement parmi ${PARTS.join(', ')}`),
    global: COMPTE(), par_competence: R(comptesParCompetence, 'un compte { k, n } par code de compétence'),
    vecteur: R(selon(/^[01]{1,4000}$/), 'une suite de 0 et de 1, un par épisode (le vecteur réussi / raté)'),
    surete: R((x) => entier(x), 'un nombre entier de fautes'), seul_faux: COMPTE(true), parmi3: COMPTE(true),
  },
};
const REGLES_OUVERTURES: Regles = {
  ouverture: {
    pr: PR, quand: R(dateIso, 'une date ISO en temps universel'), prevus: R(empreinteEntiere, 'une empreinte « sha256:… »'),
    sans: R((x) => Array.isArray(x) && x.length <= 256 && x.every(run), 'la liste des runs écartés'),
    scelles: R((x) => estObjet(x) && Object.keys(x).length <= 256 && Object.entries(x).every(([k, v]) => run(k) && empreinteEntiere(v)), 'une empreinte « sha256:… » par run'),
  },
};

/** Les champs qui portent un compte ou un résultat du banc : jamais dans le journal de la boucle, pas même « en plus ». */
const CHAMPS_DU_BANC: readonly string[] = Object.freeze(['global', 'par_competence', 'en_service', 'candidat', 'vecteur', 'tenues', 'seul_faux', 'parmi3', 'diff_moy', 'et_diff', 'marge']);
function defautsSelon(regles: Regles, l: unknown, ailleurs = '', interdits: readonly string[] = []): string[] {
  if (!estObjet(l)) return ['la ligne n\'est pas un objet'];
  if (l.v !== VERSION) return [`version du format inconnue (${JSON.stringify(l.v) ?? 'absente'}) : ce lecteur connaît la version ${VERSION}`];
  const sorte = typeof l.t === 'string' && Object.hasOwn(regles, l.t) ? regles[l.t] : undefined;
  if (!sorte) return [`sorte de ligne inconnue ici (${typeof l.t === 'string' ? l.t.slice(0, 20) : 'absente'}) : attendu ${Object.keys(regles).join(', ')}${ailleurs}`];
  const out: string[] = [];
  for (const [champ, regle] of Object.entries(sorte)) {
    if (l[champ] === undefined) { if (!regle.facultatif) out.push(`${champ} manque (${regle.quoi})`); continue; }
    if (!regle.ok(l[champ])) out.push(`${champ} : attendu ${regle.quoi}`);
  }
  for (const champ of Object.keys(l)) {
    if (champ === 'v' || champ === 't' || Object.hasOwn(sorte, champ)) continue;
    if (interdits.includes(champ)) out.push(`${champ} : ce champ porte un compte du banc, il n'a pas sa place ici`);
    else if (!CLE.test(champ)) out.push('un nom de champ qui n\'est pas un jeton court');
    else if (!sansTexte(l[champ])) out.push(`${champ} : un champ en plus ne peut porter que des nombres ou vrai / faux, jamais de texte`);
  }
  return out;
}
/** L'écart toléré entre `diff_moy` écrit et (candidat − en service) ÷ n : un arrondi, jamais un épisode entier. */
const TOLERANCE_DIFF = 5e-4;
/** Ce qu'une ligne de porte doit tenir pour être crue : mêmes épisodes, différence recomptée, décision selon la règle. */
export function defautsPorte(p: Pick<LignePorte, 'en_service' | 'candidat' | 'diff_moy' | 'et_diff' | 'marge' | 'surete_candidat' | 'decision'>): string[] {
  const out: string[] = [], n = p.en_service.n;
  if (p.candidat.n !== n) return [`en service sur ${n} épisodes, candidat sur ${p.candidat.n} : la porte compare les mêmes épisodes`];
  if (!(n > 0)) return ['porte passée sur aucun épisode'];
  const diff = (p.candidat.k - p.en_service.k) / n;
  if (Math.abs(p.diff_moy - diff) > TOLERANCE_DIFF) out.push(`diff_moy (${p.diff_moy}) n'est pas (candidat − en service) ÷ n (${diff.toFixed(4)})`);
  // L'erreur type la plus petite possible pour cet écart de comptes : quand seuls les épisodes qui font l'écart diffèrent.
  const auMoins = n > 1 ? Math.sqrt(Math.max(0, (Math.abs(diff) - diff * diff) * (n / (n - 1))) / n) : 0;
  if (p.et_diff < auMoins - TOLERANCE_DIFF) out.push(`et_diff (${p.et_diff}) est plus petit que ce que ces comptes permettent (${auMoins.toFixed(4)} au moins)`);
  if (p.marge < p.et_diff - 1e-9) out.push(`marge (${p.marge}) plus petite que l'erreur type de la différence (${p.et_diff})`);
  const doitGarder = p.diff_moy > p.marge && p.surete_candidat === 0;
  if (p.decision === 'garde' && p.surete_candidat > 0) out.push(`candidat gardé avec ${p.surete_candidat} faute${p.surete_candidat > 1 ? 's' : ''} de sûreté : une faute refuse toujours`);
  else if (p.decision === 'garde' && !doitGarder) out.push(`candidat gardé alors que la différence (${p.diff_moy}) ne dépasse pas la marge (${p.marge})`);
  else if (p.decision === 'refuse' && doitGarder) out.push(`candidat refusé alors que la différence (${p.diff_moy}) dépasse la marge (${p.marge}) sans faute de sûreté`);
  return out;
}
/** Ce qu'une ligne d'épisode doit tenir : une faute de sûreté n'est jamais une réussite. */
export function defautsEpisode(e: LigneEpisode): string[] {
  const out: string[] = [];
  if (e.surete > 0 && e.r !== -1) out.push('r : une faute de sûreté vaut toujours −1, jamais une réussite');
  if ((e.issue === 'succes' || e.issue === 'reussi') && (e.r !== 1 || e.surete > 0)) out.push('issue : un épisode réussi vaut +1 et n\'a aucune faute de sûreté');
  if (e.issue === 'fausse' && e.r !== -1) out.push('r : une fausse réussite vaut −1');
  if (e.r === 0 && e.issue !== 'refus' && e.issue !== 'tolere') out.push('r : 0 seulement pour « refus » (rien fait, et il le dit) ou « tolere » (accepté, rien à en apprendre)');
  if (e.issue === 'tolere' && (e.r !== 0 || e.surete > 0)) out.push('issue : un épisode toléré vaut 0 et n’a aucune faute de sûreté');
  return out;
}
// La LECTURE ne juge que la forme d'une ligne : une ligne bien formée mais incohérente (une porte qui garde un candidat
// fautif, un épisode « réussi » avec une faute) est gardée, pour que le rapport la voie, la compte et suspende sa
// conclusion. L'ÉCRITURE, elle, refuse aussi l'incohérence.
const formeLigne = (l: unknown): string[] => defautsSelon(REGLES_JOURNAL, l, ' ; « porte » et « mesure » vont dans le fichier du banc, jamais dans le journal de la boucle', CHAMPS_DU_BANC);
function formeLigneDuBanc(l: unknown): string[] {
  const out = defautsSelon(REGLES_PORTES, l);
  if (out.length || !estObjet(l)) return out;
  if (l.t === 'mesure') out.push(...defautsComptes(l as unknown as LigneMesure));
  return out;
}
/** Les défauts d'une ligne du journal de la BOUCLE, forme et cohérence (liste vide : la ligne est bonne). */
export function defautsLigne(l: unknown): string[] {
  const out = formeLigne(l);
  if (out.length || !estObjet(l)) return out;
  if (l.t === 'episode') out.push(...defautsEpisode(l as unknown as LigneEpisode));
  return out;
}
/** Les défauts d'une ligne du fichier de la PORTE (côté banc), forme et cohérence. */
export function defautsLigneDuBanc(l: unknown): string[] {
  const out = formeLigneDuBanc(l);
  if (out.length || !estObjet(l)) return out;
  if (l.t === 'porte') out.push(...defautsPorte(l as unknown as LignePorte));
  return out;
}
/** Les défauts d'une ligne du fichier scellé ; le vecteur est recoupé avec les comptes. */
export function defautsLigneScellee(l: unknown): string[] {
  const out = defautsSelon(REGLES_SCELLE, l);
  if (out.length || !estObjet(l)) return out;
  if (l.t === 'plan') {
    const p = l as unknown as LignePlan;
    if (p.competences.length !== p.n) out.push(`competences : ${p.competences.length} codes pour ${p.n} épisodes`);
    if (p.tenues !== undefined && p.tenues.length !== p.n) out.push(`tenues : ${p.tenues.length} marques pour ${p.n} épisodes`);
  } else {
    const c = l as unknown as LigneCache;
    if (c.vecteur.length !== c.global.n) out.push(`vecteur : ${c.vecteur.length} épisodes, le compte en annonce ${c.global.n}`);
    else if (uns(c.vecteur) !== c.global.k) out.push(`vecteur : ${uns(c.vecteur)} réussites, le compte en annonce ${c.global.k}`);
    out.push(...defautsComptes(c));
  }
  return out;
}
const defautsLigneOuverture = (l: unknown): string[] => defautsSelon(REGLES_OUVERTURES, l);
/** Les comptes par compétence, quand il y en a, doivent faire le compte global. */
function defautsComptes(l: { global: Compte; par_competence: Readonly<Record<string, Compte>> }): string[] {
  const parts = Object.values(l.par_competence);
  if (!parts.length) return [];
  const k = parts.reduce((s, c) => s + c.k, 0), n = parts.reduce((s, c) => s + c.n, 0);
  return k === l.global.k && n === l.global.n ? [] : [`par_competence : la somme (${k}/${n}) n'est pas le compte global (${l.global.k}/${l.global.n})`];
}
const uns = (vecteur: string): number => { let k = 0; for (let i = 0; i < vecteur.length; i++) if (vecteur.charCodeAt(i) === 49) k++; return k; };

// ------------------------------------------------------------------------------------------------ petites aides
const sha256 = (texte: string | Uint8Array): string => createHash('sha256').update(texte).digest('hex');
/**
 * L'empreinte courte d'un texte (12 caractères hexadécimaux de son SHA-256) : désigne un épisode sans montrer sa phrase.
 * Limite dite : elle est sans sel. Une phrase courte et devinable se retrouve en essayant des phrases une à une. C'est
 * sans effet tant que tous les épisodes sont inventés ; avec de vraies demandes, il faudrait un sel gardé à part.
 */
export function empreinteCourte(texte: string, longueur = 12): string {
  return sha256(texte).slice(0, Math.min(16, Math.max(6, longueur)));
}
/** Le maillon de la chaîne : l'empreinte d'une ligne telle qu'elle est écrite (sans son saut de ligne). */
export const empreinteLigne = (texte: string): string => sha256(texte).slice(0, 12);
/** Le maillon de départ : la première ligne d'un fichier le porte. */
export const ORIGINE = '0'.repeat(12);
/** Un vecteur réussi / raté en texte compact : [1, 0, 1, 1] → « 1011 ». */
export function vecteurEnTexte(v: ArrayLike<number | boolean>): string {
  let s = '';
  for (let i = 0; i < v.length; i++) s += v[i] ? '1' : '0';
  return s;
}
/** L'inverse : « 1011 » → [1, 0, 1, 1]. */
export function texteEnVecteur(s: string): Uint8Array {
  const v = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) v[i] = s.charCodeAt(i) === 49 ? 1 : 0;
  return v;
}

// ------------------------------------------------------------------------------------------------ l'écriture
export interface Bornes { maxOctets?: number; reserve?: number; maxLigne?: number }
export interface Ecrivain<L> {
  readonly chemin: string;
  /** Écrit une ligne. Rend faux si la place manque (la ligne est comptée dans `omises`). Une ligne mal formée lève une erreur. */
  ecrire(l: AEcrire<L>): boolean;
  /** La taille du fichier, en octets. */
  octets(): number;
  /** Les lignes non écrites faute de place, par sorte. */
  omises(): Record<string, number>;
  /** L'empreinte de la dernière ligne du fichier (le bout de la chaîne). */
  sommet(): string;
  fermer(): void;
}
interface Metier {
  nom: string;
  defauts: (l: unknown) => string[];
  /** Les lignes nombreuses : elles s'arrêtent d'abord, pour laisser la réserve. */
  nombreuses: ReadonlySet<string>;
  /** La dernière ligne du fichier : elle a sa propre réserve, et dit les lignes omises. */
  derniere: string | null;
  /** Le bout de la chaîne d'un fichier déjà là (lu avec la même règle que la lecture). */
  sommetDe: (chemin: string) => string;
  /** Refuse une ligne bien formée qui n'a pas sa place ici (lève une erreur), ou rend faux pour ne rien écrire. */
  avant?: (l: Obj) => boolean;
  apres?: (l: Obj) => void;
}

function ecrivain<L>(chemin: string, o: Bornes, m: Metier): Ecrivain<L> {
  const max = Math.min(PLAFOND_JOURNAL, Math.max(1, Math.floor(o.maxOctets ?? MAX_JOURNAL))), maxLigne = Math.min(PLAFOND_LIGNE, Math.max(1, Math.floor(o.maxLigne ?? MAX_LIGNE)));
  const reserve = Math.min(Math.max(0, Math.floor(o.reserve ?? RESERVE)), Math.floor(max / 2));
  const reserveFin = m.derniere ? Math.min(RESERVE_FIN, Math.floor(max / 4)) : 0;
  mkdirSync(dirname(chemin), { recursive: true });
  let fd: number | null = openSync(chemin, 'a');   // ajout seul : rien de ce qui est écrit n'est repris
  let taille = fstatSync(fd).size;
  // Reprise après une coupure : la ligne suivante commence sur une ligne neuve (ce saut de ligne compte dans la borne).
  let prefixe = taille > 0 && dernierOctet(chemin, taille) !== 0x0a ? '\n' : '';
  let sommet = taille > 0 ? m.sommetDe(chemin) : ORIGINE;
  const omises: Record<string, number> = {};
  return {
    chemin,
    ecrire(l) {
      if (fd === null) throw new Error(`${m.nom} fermé : ${chemin}`);
      const { v: _v, pr: _pr, t, ...reste } = l as unknown as { v?: number; pr?: string; t?: unknown } & Obj;
      const ligne: Obj = { v: VERSION, t, pr: sommet, ...reste };
      if (t === m.derniere && Object.keys(omises).length) ligne.omises = { ...omises };
      const d = m.defauts(ligne);
      if (d.length) throw new Error(`ligne refusée par le ${m.nom} (${typeof t === 'string' ? t.slice(0, 20) : 'sans sorte'}) : ${d.join(' ; ')}`);
      if (m.avant && !m.avant(ligne)) return true;
      const corps = JSON.stringify(ligne), texte = `${prefixe}${corps}\n`;
      const n = Buffer.byteLength(texte, 'utf8');
      if (n > maxLigne) throw new Error(`ligne trop longue pour le ${m.nom} (${n} octets, ${maxLigne} au plus)`);
      const sorte = String(t);
      taille = fstatSync(fd).size;   // la taille vraie du fichier
      const limite = m.nombreuses.has(sorte) ? max - Math.max(reserve, reserveFin) : sorte === m.derniere ? max : max - reserveFin;
      if (taille + n > limite) { omises[sorte] = (omises[sorte] ?? 0) + 1; return false; }
      writeSync(fd, texte); taille += n; prefixe = ''; sommet = empreinteLigne(corps);
      if (!m.nombreuses.has(sorte)) poserSurLeDisque(fd);   // une ligne qui compte est posée sur le disque tout de suite
      m.apres?.(ligne);
      return true;
    },
    octets: () => taille,
    omises: () => ({ ...omises }),
    sommet: () => sommet,
    fermer() { if (fd !== null) { try { poserSurLeDisque(fd); } finally { closeSync(fd); fd = null; } } },
  };
}
/**
 * Pose sur le disque ce qui est écrit. Sous le modèle de permissions de Node (le processus de la boucle), fsync est
 * interdit : la ligne est déjà écrite, le système la pose à son rythme (une coupure de courant peut alors perdre les
 * dernières lignes ; la lecture les compte comme coupées, sans erreur).
 */
function poserSurLeDisque(fd: number): void {
  try { fsyncSync(fd); } catch (e) { if ((e as { code?: string })?.code !== 'ERR_ACCESS_DENIED') throw e; }
}
function dernierOctet(chemin: string, taille: number): number {
  const fd = openSync(chemin, 'r');
  try { const b = Buffer.alloc(1); readSync(fd, b, 0, 1, taille - 1); return b[0]; } finally { closeSync(fd); }
}

/**
 * Ouvre le journal de la BOUCLE en ajout seul (le dossier est créé au besoin). Il ne prend que entete, episode,
 * systeme et fin : jamais un compte du banc. Un seul en-tête ; plus rien après « fin » ; les pas des épisodes montent.
 */
export function ouvrirJournal(chemin: string, o: Bornes = {}): Ecrivain<Ligne> {
  const deja = existsSync(chemin) && statSync(chemin).size > 0 ? lireJournal(chemin) : null;
  let entete = Boolean(deja?.entete), clos = Boolean(deja?.termine);
  let dernierPas = deja ? deja.lignes.reduce((p, l) => (l.t === 'episode' ? Math.max(p, l.pas) : p), 0) : 0;
  return ecrivain<Ligne>(chemin, o, {
    nom: 'journal', defauts: defautsLigne, nombreuses: new Set(['episode', 'systeme']), derniere: 'fin', sommetDe: () => deja?.sommet ?? ORIGINE,
    avant(l) {
      if (clos) throw new Error(`journal clos (il a déjà sa ligne « fin ») : ${chemin}`);
      if (l.t === 'entete' && entete) throw new Error('ce journal a déjà son en-tête : une reprise continue sans en écrire un second');
      if (l.t === 'episode' && (l.pas as number) <= dernierPas) throw new Error(`épisode au pas ${l.pas} après le pas ${dernierPas} : les pas montent, un pas ne se rejoue pas`);
      return true;
    },
    apres(l) { if (l.t === 'entete') entete = true; if (l.t === 'fin') clos = true; if (l.t === 'episode') dernierPas = l.pas as number; },
  });
}
/**
 * Ouvre le fichier de la PORTE d'un run (côté banc) en ajout seul : porte, mesure, puis cloture à la fin.
 * La boucle n'en reçoit jamais le chemin.
 */
export function ouvrirPortes(chemin: string, o: Bornes = {}): Ecrivain<LigneDuBanc> {
  const deja = existsSync(chemin) && statSync(chemin).size > 0 ? lirePortes(chemin, null) : null;
  let clos = Boolean(deja?.cloture);
  return ecrivain<LigneDuBanc>(chemin, { reserve: 0, ...o }, {
    nom: 'fichier de la porte', defauts: defautsLigneDuBanc, nombreuses: new Set(), derniere: 'cloture', sommetDe: () => deja?.sommet ?? ORIGINE,
    avant() { if (clos) throw new Error(`fichier de la porte clos (il a déjà sa ligne « cloture ») : ${chemin}`); return true; },
    apres(l) { if (l.t === 'cloture') clos = true; },
  });
}
/**
 * Ouvre le fichier scellé d'un run (côté banc) en ajout seul. Il se lit seulement par `lireRuns`, à la fin de tous les
 * runs prévus. Un seul plan, une seule mesure par part de l'entraînement.
 */
export function ouvrirScelle(chemin: string, o: Bornes = {}): Ecrivain<LigneScellee> {
  const deja = existsSync(chemin) && statSync(chemin).size > 0 ? lireScelle(chemin, null) : null;
  // Deux plans sont « le même » quand tous leurs champs sont égaux, quel que soit leur ordre (le maillon mis à part).
  const forme = (l: Obj): string => JSON.stringify(Object.keys(l).filter((k) => k !== 'pr').sort().map((k) => [k, l[k]]));
  let plan: string | null = deja?.plan ? forme(deja.plan as unknown as Obj) : null;
  const parts = new Set<number>(deja ? [...deja.mesures.map((x) => x.part), ...deja.doublons] : []);
  return ecrivain<LigneScellee>(chemin, { reserve: 0, ...o }, {
    nom: 'fichier scellé', defauts: defautsLigneScellee, nombreuses: new Set(), derniere: null, sommetDe: () => deja?.sommet ?? ORIGINE,
    avant(l) {
      if (l.t === 'plan') {
        if (plan !== null && plan !== forme(l)) throw new Error('le fichier scellé a déjà un plan, différent de celui-ci');
        return plan === null;   // le même plan une seconde fois : rien à écrire
      }
      if (plan === null) throw new Error('mesure du banc caché écrite avant le plan du banc');
      if (parts.has(l.part as number)) throw new Error(`le banc caché est déjà mesuré à ${l.part} % : une seule mesure par part, jamais une seconde`);
      return true;
    },
    apres(l) { if (l.t === 'plan') plan = forme(l); else parts.add(l.part as number); },
  });
}

// ------------------------------------------------------------------------------------------------ la lecture
interface Suivi {
  /** Vrai si la dernière ligne est cassée (écriture interrompue), ou si le fichier dépasse la borne de lecture. */
  coupe: boolean;
  /** Lignes sautées : cassées, mal formées, d'une autre version, d'un autre run, ou qui n'ont pas leur place. */
  illisibles: number;
  /** Maillons rompus : une ligne retouchée, retirée ou ajoutée, ou un second écrivain. Doit rester à 0. */
  ruptures: number;
  /** L'empreinte de la dernière ligne gardée (le bout de la chaîne). */
  sommet: string;
  /** Les premiers défauts rencontrés (huit au plus), pour dire ce qui ne va pas. */
  defauts: string[];
}
export interface Lecture extends Suivi {
  chemin: string; octets: number;
  /** Les lignes bonnes, dans l'ordre du fichier. */
  lignes: Ligne[];
  entete: LigneEntete | null; fin: LigneFin | null;
  /** Vrai si la ligne « fin » est là : la boucle s'est arrêtée proprement. */
  termine: boolean;
  /** Lignes non écrites faute de place, d'après la ligne « fin ». */
  omises: Record<string, number>;
}
export interface LecturePortes extends Suivi {
  chemin: string; octets: number; present: boolean;
  /** Les lignes « porte » et « mesure », dans l'ordre du fichier. */
  lignes: Array<LignePorte | LigneMesure>;
  portes: LignePorte[]; mesures: LigneMesure[];
  /** La ligne « cloture » : le banc dit que le run est fini pour lui. */
  cloture: LigneCloture | null;
}
export interface LectureScellee extends Suivi {
  chemin: string; plan: LignePlan | null;
  /** Une mesure par part, la PREMIÈRE écrite ; triées par part. */
  mesures: LigneCache[];
  /** Les parts mesurées plus d'une fois dans le fichier (une seconde mesure n'est jamais prise). Doit rester vide. */
  doublons: number[];
  /** L'empreinte SHA-256 du fichier entier, tel qu'il a été lu. */
  empreinte: string;
}

interface Brut { textes: string[]; octets: number; fini: boolean; tronque: boolean; empreinte: string }
/** Lit au plus `max` octets et rend les lignes ; `fini` dit si le dernier morceau se termine par un saut de ligne. */
function lignesDe(chemin: string, max: number): Brut {
  const octets = statSync(chemin).size;
  const fd = openSync(chemin, 'r');
  try {
    const b = Buffer.alloc(Math.min(octets, max));
    let lus = 0;
    while (lus < b.length) { const n = readSync(fd, b, lus, b.length - lus, lus); if (n <= 0) break; lus += n; }
    const texte = b.subarray(0, lus).toString('utf8');
    const textes = texte.split('\n');
    const dernier = textes.pop() ?? '';
    const fini = dernier === '';   // après le dernier saut de ligne, il ne doit rien rester
    if (!fini) textes.push(dernier);
    return { textes, octets, fini, tronque: octets > max, empreinte: `sha256:${sha256(b.subarray(0, lus))}` };
  } finally { closeSync(fd); }
}
function parcourir<L extends { pr: string }>(brut: Brut, defauts: (l: unknown) => string[], garder: (l: L, numero: number) => string | null): Suivi {
  let illisibles = 0, coupe = brut.tronque, ruptures = 0, sommet = ORIGINE;
  const dits: string[] = brut.tronque ? ['fichier plus gros que la borne de lecture : seul le début est lu'] : [];
  const noter = (numero: number, quoi: string) => { illisibles++; if (dits.length < 8) dits.push(`ligne ${numero} : ${quoi}`); };
  brut.textes.forEach((texte, i) => {
    const t = texte.endsWith('\r') ? texte.slice(0, -1) : texte;
    const derniere = i === brut.textes.length - 1 && !brut.fini;
    if (!t.trim()) return;
    let l: unknown;
    try { l = JSON.parse(t); } catch { if (derniere) coupe = true; noter(i + 1, derniere ? 'ligne coupée (écriture interrompue)' : 'pas du JSON'); return; }
    const d = defauts(l);
    if (d.length) { noter(i + 1, d[0]); return; }
    const refus = garder(l as L, i + 1);
    if (refus) { noter(i + 1, refus); return; }
    if ((l as L).pr !== sommet) { ruptures++; if (dits.length < 8) dits.push(`ligne ${i + 1} : la chaîne est rompue (une ligne retouchée, retirée ou ajoutée avant celle-ci)`); }
    sommet = empreinteLigne(t);
  });
  return { illisibles, coupe, ruptures, sommet, defauts: dits };
}

/** Relit le journal de la BOUCLE. Ne lève pas d'erreur pour une ligne cassée ou mal formée : elle est sautée et comptée. */
export function lireJournal(chemin: string, o: { maxOctets?: number } = {}): Lecture {
  const brut = lignesDe(chemin, Math.min(MAX_LECTURE, o.maxOctets ?? MAX_LECTURE));
  const lignes: Ligne[] = [];
  let entete: LigneEntete | null = null, fin: LigneFin | null = null, nom: string | null = null;
  const suivi = parcourir<Ligne>(brut, formeLigne, (l) => {
    if (nom === null) nom = l.run;
    else if (l.run !== nom) return `ligne d'un autre run (${l.run}) dans le journal de ${nom}`;
    if (fin) return 'ligne écrite après la ligne « fin »';
    if (l.t === 'entete') { if (entete) return 'un second en-tête'; entete = l; }
    if (l.t === 'fin') fin = l;
    lignes.push(l);
    return null;
  });
  const derniere = fin as LigneFin | null;
  return { chemin, octets: brut.octets, lignes, entete, fin: derniere, termine: derniere !== null, omises: { ...(derniere?.omises ?? {}) }, ...suivi };
}
const SANS_SUIVI: Suivi = { coupe: false, illisibles: 0, ruptures: 0, sommet: ORIGINE, defauts: [] };
const journalAbsent = (chemin: string): Lecture => ({ chemin, octets: 0, lignes: [], entete: null, fin: null, termine: false, omises: {}, ...SANS_SUIVI, defauts: ['journal absent ou illisible'] });

/** Relit le fichier de la porte d'un run (interne : il se lit par `lireRuns`, du côté du banc). */
function lirePortes(chemin: string, run: string | null): LecturePortes {
  const brut = lignesDe(chemin, MAX_LECTURE);
  const lignes: Array<LignePorte | LigneMesure> = [], portes: LignePorte[] = [], mesures: LigneMesure[] = [];
  let cloture: LigneCloture | null = null;
  const suivi = parcourir<LigneDuBanc>(brut, formeLigneDuBanc, (l) => {
    if (run !== null && l.run !== run) return `ligne d'un autre run (${l.run})`;
    if (cloture) return 'ligne écrite après la ligne « cloture »';
    if (l.t === 'cloture') { cloture = l; return null; }
    lignes.push(l);
    if (l.t === 'porte') portes.push(l); else mesures.push(l);
    return null;
  });
  return { chemin, octets: brut.octets, present: true, lignes, portes, mesures, cloture: cloture as LigneCloture | null, ...suivi };
}
const portesAbsentes = (chemin: string, defaut: string | null): LecturePortes => ({ chemin, octets: 0, present: false, lignes: [], portes: [], mesures: [], cloture: null, ...SANS_SUIVI, defauts: defaut ? [defaut] : [] });

/** Relit un fichier scellé (interne : la seule porte est `lireRuns`). Chaque mesure est recoupée avec le plan. */
function lireScelle(chemin: string, run: string | null): LectureScellee {
  const brut = lignesDe(chemin, MAX_LECTURE);
  let plan: LignePlan | null = null;
  const mesures: LigneCache[] = [], doublons: number[] = [];
  const suivi = parcourir<LigneScellee>(brut, defautsLigneScellee, (l) => {
    if (l.t === 'plan') {
      if (plan) return 'un second plan';
      plan = l; return null;
    }
    if (run !== null && l.run !== run) return `mesure d'un autre run (${l.run})`;
    const p = plan as LignePlan | null;
    if (!p) return 'mesure écrite avant le plan du banc';
    if (l.global.n !== p.n) return `mesure sur ${l.global.n} épisodes, le plan en compte ${p.n}`;
    const recompte: Record<string, Compte> = {};
    p.competences.forEach((c, i) => { const x = (recompte[c] ??= { k: 0, n: 0 }); x.n++; if (l.vecteur.charCodeAt(i) === 49) x.k++; });
    const dit = l.par_competence;
    const pareil = Object.keys(recompte).length === Object.keys(dit).length && Object.entries(recompte).every(([c, x]) => dit[c]?.k === x.k && dit[c]?.n === x.n);
    if (!pareil) return 'les comptes par compétence ne sont pas ceux du vecteur rangé selon le plan';
    if (mesures.some((x) => x.part === l.part)) { if (!doublons.includes(l.part)) doublons.push(l.part); return `le banc caché est mesuré une seconde fois à ${l.part} % : seule la première mesure compte`; }
    mesures.push(l);
    return null;
  });
  mesures.sort((a, b) => a.part - b.part);
  return { chemin, plan, mesures, doublons: doublons.sort((a, b) => a - b), empreinte: brut.empreinte, ...suivi };
}

// ------------------------------------------------------------------------------------------------ les runs prévus
export interface RunPrevu { run: string; variante: string; graine: number }
export interface Prevus {
  v: 2; t: 'prevus';
  /** Tous les runs, écrits avant le premier : rien ne s'ouvre tant qu'ils ne sont pas tous finis. */
  runs: RunPrevu[];
  /** Les deux entraînements comparés, dits d'avance : jamais choisis après coup. */
  comparer: { reference: string; candidat: string };
  /** La variante qui n'apprend rien. */
  temoin: string;
  cree: string;
}
export type PrevusAEcrire = Pick<Prevus, 'runs' | 'comparer' | 'temoin'> & { cree?: string };

function defautsPrevus(p: unknown): string[] {
  if (!estObjet(p)) return ['la liste des runs prévus n\'est pas un objet'];
  if (p.v !== VERSION || p.t !== 'prevus') return [`ce n'est pas une liste des runs prévus au format ${VERSION}`];
  if (!Array.isArray(p.runs) || !p.runs.length || p.runs.length > 256) return ['runs : il faut de 1 à 256 runs'];
  const out: string[] = [], noms = new Set<string>(), paires = new Set<string>(), variantes = new Set<string>();
  for (const r of p.runs as unknown[]) {
    if (!estObjet(r) || !run(r.run) || !selon(RE_VARIANTE)(r.variante) || !entier(r.graine)) { out.push('runs : chaque run a un nom, une variante et une graine entière'); break; }
    if (noms.has(r.run as string)) out.push(`run en double : ${r.run}`);
    const paire = `${r.variante}\u0000${r.graine}`;
    if (paires.has(paire)) out.push(`variante et graine en double : ${r.variante}, graine ${r.graine}`);
    noms.add(r.run as string); paires.add(paire); variantes.add(r.variante as string);
  }
  const c = p.comparer;
  if (!estObjet(c) || typeof c.reference !== 'string' || typeof c.candidat !== 'string') out.push('comparer : il faut dire la référence et le candidat');
  else {
    if (!variantes.has(c.reference) || !variantes.has(c.candidat)) out.push('comparer : la référence et le candidat doivent être des variantes de la liste');
    if (c.reference === c.candidat) out.push('comparer : la référence et le candidat sont le même entraînement');
    if (c.reference === p.temoin || c.candidat === p.temoin) out.push('comparer : le témoin ne se compare pas');
  }
  if (typeof p.temoin !== 'string' || !variantes.has(p.temoin)) out.push('temoin : il faut un témoin (une variante de la liste, qui n\'apprend rien)');
  if (!dateIso(p.cree)) out.push('cree : une date ISO en temps universel');
  return out;
}
const empreinteTexte = (texte: string): string => `sha256:${sha256(texte.replace(/^﻿/, '').replace(/\r\n/g, '\n'))}`;
/**
 * Écrit la liste des runs prévus dans la racine du banc, AVANT le premier run. Elle ne se réécrit pas : une liste déjà
 * là fait lever une erreur. Rend son empreinte, à mettre dans l'en-tête de chaque journal.
 */
export function ecrirePrevus(racineBanc: string, p: PrevusAEcrire): { chemin: string; empreinte: string } {
  const prevus: Prevus = { v: VERSION, t: 'prevus', runs: p.runs.map((r) => ({ run: r.run, variante: r.variante, graine: r.graine })), comparer: { reference: p.comparer?.reference, candidat: p.comparer?.candidat }, temoin: p.temoin, cree: p.cree ?? new Date().toISOString() };
  const d = defautsPrevus(prevus);
  if (d.length) throw new Error(`liste des runs prévus refusée : ${d.join(' ; ')}`);
  mkdirSync(racineBanc, { recursive: true });
  const chemin = join(racineBanc, NOM_PREVUS), texte = `${JSON.stringify(prevus, null, 1)}\n`;
  try { writeFileSync(chemin, texte, { flag: 'wx' }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`la liste des runs prévus existe déjà et ne se réécrit pas : ${chemin}`); throw e; }
  return { chemin, empreinte: empreinteTexte(texte) };
}
/** Relit la liste des runs prévus et son empreinte. Absente ou mal formée : rien (et le banc caché reste fermé). */
export function lirePrevus(racineBanc: string): { prevus: Prevus | null; empreinte: string | null; defauts: string[] } {
  let texte: string;
  try { texte = readFileSync(join(racineBanc, NOM_PREVUS), 'utf8'); } catch { return { prevus: null, empreinte: null, defauts: ['pas de liste des runs prévus dans la racine du banc'] }; }
  let p: unknown;
  try { p = JSON.parse(texte.replace(/^﻿/, '')); } catch { return { prevus: null, empreinte: null, defauts: ['la liste des runs prévus n\'est pas du JSON'] }; }
  const d = defautsPrevus(p);
  return d.length ? { prevus: null, empreinte: null, defauts: d } : { prevus: p as Prevus, empreinte: empreinteTexte(texte), defauts: [] };
}

// ------------------------------------------------------------------------------------------------ lire tous les runs
export interface Racines { boucle: string; banc: string }
export interface RunLu extends RunPrevu {
  /** Vrai si ce run est écarté à la main : son fichier scellé n'est pas lu, et le rapport suspend sa conclusion. */
  ecarte: boolean;
  journal: Lecture; portes: LecturePortes; scelle: LectureScellee | null;
}
export interface Ouvertures {
  /** Combien de fois les fichiers scellés ont été ouverts (celle-ci comprise). */
  n: number;
  premiere: string | null;
  /** Les runs dont le fichier scellé n'a plus l'empreinte notée à sa première ouverture. Doit rester vide. */
  changes: string[];
}
export interface Runs {
  /** Vrai seulement si TOUS les runs prévus ont leur ligne « fin » et leur ligne « cloture » : alors les fichiers scellés sont lus. */
  ouvert: boolean;
  /** Pourquoi le banc caché reste fermé (vide s'il est ouvert). */
  raison: string;
  racines: Racines;
  prevus: Prevus | null; empreintePrevus: string | null;
  /** Un par run prévu, dans l'ordre de la liste. */
  runs: RunLu[];
  /** Les dossiers trouvés dans l'une des racines et qui ne sont pas dans la liste : ils ne sont pas lus. */
  horsListe: string[];
  ouvertures: Ouvertures;
}
const dedans = (parent: string, enfant: string): boolean => { const r = relative(parent, enfant); return r === '' || (!r.startsWith('..') && !/^([A-Za-z]:|[\\/])/.test(r)); };
const sousDossiers = (d: string): string[] => { try { return readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name); } catch { return []; } };

/**
 * Relit les journaux et les fichiers de porte de tous les runs PRÉVUS, puis, SEULEMENT si tous sont finis des deux
 * côtés (« fin » écrite par la boucle, « cloture » écrite par le banc), leurs fichiers scellés.
 * `sans` écarte des runs : ils doivent être dans la liste, et finis comme les autres. Écarter n'ouvre rien.
 * Chaque ouverture est notée dans la racine du banc ; si elle ne peut pas l'être, rien n'est ouvert.
 */
export function lireRuns(racines: Racines, o: { sans?: readonly string[]; maintenant?: string } = {}): Runs {
  const boucle = resolve(racines.boucle), banc = resolve(racines.banc);
  if (dedans(boucle, banc) || dedans(banc, boucle)) throw new Error('la racine du banc et celle de la boucle doivent être deux dossiers séparés, aucun dans l\'autre : la boucle ne doit pas pouvoir lire le banc');
  const { prevus, empreinte, defauts } = lirePrevus(banc);
  const ferme = (raison: string, runs: RunLu[] = [], horsListe: string[] = []): Runs => ({ ouvert: false, raison, racines: { boucle, banc }, prevus, empreintePrevus: empreinte, runs, horsListe, ouvertures: { n: 0, premiere: null, changes: [] } });
  if (!prevus) return ferme(`${defauts[0] ?? 'pas de liste des runs prévus'} : sans elle, rien ne dit que tous les runs sont finis`);
  const sans = new Set(o.sans ?? []);
  const inconnus = [...sans].filter((n) => !prevus.runs.some((r) => r.run === n));
  if (inconnus.length) throw new Error(`run${inconnus.length > 1 ? 's' : ''} à écarter inconnu${inconnus.length > 1 ? 's' : ''} : ${inconnus.join(', ')} (la liste des runs prévus contient ${prevus.runs.map((r) => r.run).join(', ')})`);
  const runs: RunLu[] = prevus.runs.map((p) => {
    const cj = join(boucle, p.run, NOM_JOURNAL), cp = join(banc, p.run, NOM_PORTES);
    let journal: Lecture, portes: LecturePortes;
    try { journal = lireJournal(cj); } catch { journal = journalAbsent(cj); }
    try { portes = existsSync(cp) ? lirePortes(cp, p.run) : portesAbsentes(cp, null); } catch { portes = portesAbsentes(cp, 'fichier de la porte illisible'); }
    return { ...p, ecarte: sans.has(p.run), journal, portes, scelle: null };
  });
  const connus = new Set(prevus.runs.map((r) => r.run));
  const horsListe = [...new Set([...sousDossiers(boucle), ...sousDossiers(banc)])].filter((n) => !connus.has(n)).sort();
  const pasFinis = runs.filter((r) => !r.journal.termine).map((r) => r.run), pasClos = runs.filter((r) => r.journal.termine && !r.portes.cloture).map((r) => r.run);
  if (pasFinis.length || pasClos.length) {
    const s = (n: number) => (n > 1 ? 's' : '');
    return ferme([pasFinis.length ? `run${s(pasFinis.length)} pas fini${s(pasFinis.length)} : ${pasFinis.join(', ')}` : '', pasClos.length ? `run${s(pasClos.length)} pas clos par le banc : ${pasClos.join(', ')}` : ''].filter(Boolean).join(' ; '), runs, horsListe);
  }
  // Tout est fini : on note l'ouverture AVANT de lire, puis on lit. Si la note ne s'écrit pas, rien n'est ouvert.
  const aLire = runs.filter((r) => !r.ecarte && existsSync(join(banc, r.run, NOM_SCELLE)));
  let ouvertures: Ouvertures;
  try {
    const scelles: Record<string, string> = {};
    for (const r of aLire) scelles[r.run] = `sha256:${sha256(readFileSync(join(banc, r.run, NOM_SCELLE)))}`;
    ouvertures = noterOuverture(join(banc, NOM_OUVERTURES), { quand: o.maintenant ?? new Date().toISOString(), prevus: empreinte as string, sans: [...sans].sort(), scelles });
  } catch (e) { return ferme(`l'ouverture du banc caché n'a pas pu être notée (${(e as Error).message}) : rien n'est ouvert`, runs, horsListe); }
  for (const r of aLire) {
    const chemin = join(banc, r.run, NOM_SCELLE);
    try { r.scelle = lireScelle(chemin, r.run); }
    catch { r.scelle = { chemin, plan: null, mesures: [], doublons: [], empreinte: '', ...SANS_SUIVI, defauts: ['fichier scellé illisible'] }; }
  }
  return { ouvert: true, raison: '', racines: { boucle, banc }, prevus, empreintePrevus: empreinte, runs, horsListe, ouvertures };
}

/** Ajoute une ligne au fichier des ouvertures, puis le relit : combien d'ouvertures, la première, et ce qui a changé depuis. */
function noterOuverture(chemin: string, l: Omit<LigneOuverture, 'v' | 't' | 'pr'>): Ouvertures {
  const lire = (): { lignes: LigneOuverture[]; suivi: Suivi } => {
    const lignes: LigneOuverture[] = [];
    const suivi = existsSync(chemin) && statSync(chemin).size > 0 ? parcourir<LigneOuverture>(lignesDe(chemin, MAX_LECTURE), defautsLigneOuverture, (x) => { lignes.push(x); return null; }) : SANS_SUIVI;
    return { lignes, suivi };
  };
  const avant = lire();
  const e = ecrivain<LigneOuverture>(chemin, { reserve: 0 }, { nom: 'fichier des ouvertures', defauts: defautsLigneOuverture, nombreuses: new Set(), derniere: null, sommetDe: () => avant.suivi.sommet });
  let ecrit: boolean;
  try { ecrit = e.ecrire({ t: 'ouverture', ...l }); } finally { e.fermer(); }
  if (!ecrit) throw new Error('fichier des ouvertures plein');
  const { lignes, suivi } = lire();
  const premieres: Record<string, string> = {};
  for (const x of lignes) for (const [r, h] of Object.entries(x.scelles)) premieres[r] ??= h;
  const changes = Object.entries(l.scelles).filter(([r, h]) => premieres[r] !== h).map(([r]) => r).sort();
  if (suivi.ruptures || suivi.illisibles) changes.push('ouvertures.jsonl');   // le fichier des ouvertures lui-même a été retouché
  return { n: lignes.length, premiere: lignes[0]?.quand ?? null, changes };
}
