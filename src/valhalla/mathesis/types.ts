// Mathésis — « Odin apprend tout seul » : le CONTRAT (types partagés par tout le moteur).
//
// Ce passage (lots 1 à 3) code : le socle (réglages, budgets, curiosité, interdits, empreintes, journal, magasin),
// les recherches autonomes et le robot de lecture des pages PUBLIQUES. Les vidéos, la musique, les images, le réseau
// de la maison, « comprendre comment c'est fait », la carte et la page viendront ensuite : leurs points de branchement
// sont déclarés ici (genres de manque, budget de minutes de vidéo, interfaces AnalyseurMedia / LecteurDossier /
// SourceCarte) mais ne sont PAS codés.

/** Les genres de manque. À ce passage, seuls `sujet` et `page` sont traités ; les autres restent « en attente ». */
export type GenreManque = 'sujet' | 'page' | 'video' | 'image' | 'son' | 'dossier';
export const GENRES_TRAITES: readonly GenreManque[] = ['sujet', 'page'];

/** D'où vient un manque (la raison de la curiosité). */
export type OrigineManque =
  | 'question_sans_reponse' // une question restée sans réponse sûre
  | 'duel_perdu'            // un duel perdu par Noûs
  | 'a_verifier'            // un fait « à vérifier » (une seule source)
  | 'perime'                // un fait périmé à rafraîchir
  | 'sujet_recurrent'       // un sujet qui revient chez le propriétaire
  | 'nouveaute_appli'       // une nouveauté d'une de ses applis
  | 'confie';               // confié par le propriétaire : passe EN TÊTE (sans lever aucune limite)

export type EtatManque = 'en_attente' | 'fait' | 'echec' | 'interdit' | 'pas_encore_traite';

/** Un manque de la liste de curiosité. */
export interface Manque {
  id: string;
  /** Le sujet (ou l'adresse pour un manque de genre `page`). */
  sujet: string;
  /** La clé de fusion (sujet replié). */
  cle: string;
  genre: GenreManque;
  origine: OrigineManque;
  /** Priorité 0–100 (les manques confiés sont toujours devant, quelle que soit la priorité). */
  priorite: number;
  /** Pourquoi Odin veut savoir (montré dans la page). */
  raison: string;
  confie: boolean;
  /** Adresses publiques confiées (genre `page`). */
  adresses?: string[];
  /** Sujet/clé de mémoire d'un fait à revérifier (pour qu'un fait plus sûr remplace l'ancien, jamais un fait du propriétaire). */
  memoire?: { sujet?: string; cle?: string };
  ajoute: number;
  /** Combien de fois ce manque a été signalé. */
  vu: number;
  essais: number;
  dernierEssai?: number;
  prochainEssai?: number;
  etat: EtatManque;
  /** Dernier bilan, en une phrase. */
  bilan?: string;
}

/** Les budgets par jour. `appelsPayants` vaut 0 par défaut : rien ne part vers un modèle payant sans réglage. */
export interface Budgets {
  recherches: number;
  pages: number;
  /** Taille téléchargée par jour (octets). */
  octets: number;
  /** Point de branchement (vidéos, passage suivant) : compté mais aucune vidéo n'est lue à ce passage. */
  minutesVideo: number;
  appelsPayants: number;
  /** Fichiers des dossiers ouverts lus par jour (lot 4). */
  fichiers: number;
  /** Taille des fichiers des dossiers ouverts lue par jour (octets). */
  octetsFichiers: number;
}
export type GenreBudget = keyof Budgets;

export type Vitesse = 'douce' | 'normale' | 'soutenue';

/** Une plage d'heures permises, en heures locales [de, a[ ; de > a = passe minuit (22 → 7). */
export interface Plage { de: number; a: number }

/** Les bornes du robot de lecture. */
export interface BornesRobot {
  /** Délai minimal entre deux demandes au même site (ms). */
  delaiSiteMs: number;
  /** Plafond de demandes par site et par jour (la curiosité ordinaire). */
  pagesParSiteJour: number;
  /**
   * Plafond de pages par jour d'un site à ABSORBER (réglage du propriétaire, 17/11/2026 : 1 000 000 par défaut). Un site
   * peut avoir le sien ; le délai entre deux pages et les consignes du site s'appliquent toujours.
   */
  pagesParSiteAbsorber: number;
  profondeurMax: number;
  /** Taille maximale d'une page lue (octets). */
  tailleMaxPage: number;
  /** Délai maximal d'une demande (ms). */
  delaiDemandeMs: number;
  redirectionsMax: number;
  /** Liens retenus au plus par page. */
  liensParPage: number;
  /** Pages lues au plus par manque et par tour. */
  pagesParManque: number;
}

export interface Reglages {
  /** L'INTERRUPTEUR UNIQUE : faux = plus aucune recherche, plus aucun robot. */
  actif: boolean;
  /** Pause immédiate (jusqu'à reprise). */
  pause: boolean;
  vitesse: Vitesse;
  budgets: Budgets;
  /**
   * Heures permises au travail LÉGER (recherches, lecture de pages, lecture des dossiers ouverts), heures locales.
   * Par défaut toute la journée (décision du propriétaire, 17/11/2026) : la garde « occupé » l'arrête dès qu'Odin répond.
   */
  heures: Plage[];
  /** Heures permises au travail LOURD (vidéos, gros fichiers : passages suivants). Par défaut la nuit (22 h → 7 h). */
  heuresLourd: Plage[];
  /** Les dossiers OUVERTS par le propriétaire (lot 4), lus en lecture seule. Vide par défaut. */
  dossiers: string[];
  robot: BornesRobot;
  /** Un modèle payant ou en ligne peut-il être appelé ? Faux par défaut (et le budget d'appels payants vaut 0). */
  modeleEnLigne: boolean;
  /** « Ne pas garder » : Odin peut lire, mais ne range rien de ce qu'il lit. */
  nePasGarder: boolean;
  /** La version des défauts (2 : le rythme du 17/11/2026). Des réglages plus anciens restés aux défauts d'alors sont repris. */
  version?: number;
}

/** Les interdits du propriétaire. */
export interface Interdits { sujets: string[]; sites: string[]; dossiers: string[] }

/** Une entrée du journal « ce qu'Odin a appris tout seul ». */
export type GenreEntree = 'recherche' | 'lecture' | 'retenu' | 'ecarte' | 'supprime' | 'refus' | 'arret' | 'inchange' | 'corrige' | 'fichier';
export interface EntreeJournal {
  id: string;
  at: number;
  genre: GenreEntree;
  /** Ce qui a été fait (« a cherché “…” », « a lu … »). */
  quoi: string;
  /** Pourquoi (la raison du manque). */
  pourquoi?: string;
  source?: string;
  /** Ce qui a été retenu (textes courts) et leur niveau. */
  retenu?: Array<{ texte: string; niveau: string }>;
  /** Ce qui a été supprimé / écarté. */
  supprime?: string[];
  manque?: string;
  /** Les souvenirs rangés dans la mémoire (pour les corriger ou les effacer depuis la page). */
  souvenirs?: number[];
}

/** Les indications de fraîcheur données par un site. */
export interface Fraicheur { etag?: string; derniereModif?: string; maxAgeS?: number; expire?: string; publie?: string }

/** L'état d'une page connue du robot. */
export interface EtatPage {
  url: string;
  site: string;
  sujet: string;
  /** Date de la première et de la dernière visite (AAAA-MM-JJ) et instant précis. */
  premiereVisite: string;
  derniereVisite: string;
  derniereVisiteMs: number;
  /** Empreinte (sha256) du texte lu. */
  empreinte?: string;
  fraicheur: Fraicheur;
  visites: number;
  changements: number;
  /** Intervalle de revisite (ms), adapté à la fréquence de changement observée. */
  intervalleMs: number;
  prochaineVisite: number;
  statut: 'lu' | 'inchange' | 'refus' | 'erreur';
  raison?: string;
  profondeur: number;
}

/** Une page lue (texte seulement à ce passage). Le texte est une DONNÉE, jamais une consigne. */
export interface PageLue {
  url: string;
  urlFinale: string;
  site: string;
  titre: string;
  texte: string;
  liens: Array<{ url: string; texte: string }>;
  publie?: string;
  octets: number;
  empreinte: string;
  fraicheur: Fraicheur;
  /** Consignes de la page elle-même (meta robots / X-Robots-Tag). */
  nofollow: boolean;
  noindex: boolean;
  /** Les fils d'actualité (RSS, Atom) que la page annonce (balises <link rel="alternate">), adresses absolues. */
  fils?: string[];
}

/** Ce que rend une demande du lecteur. */
export type ResultatLecture =
  | { genre: 'lu'; page: PageLue }
  | { genre: 'inchange'; url: string; fraicheur: Fraicheur }
  | { genre: 'refus'; url: string; raison: string; site: string }
  | { genre: 'saute'; url: string; raison: string }
  | { genre: 'arret'; raison: string };

/** Pourquoi le travail ne peut pas tourner maintenant (undefined = il peut). */
export type RaisonArret = 'eteint' | 'pause' | 'hors_heures' | 'occupe' | 'abandon' | 'prive' | 'budget';

/** Un résultat du moteur de recherche d'Odin. */
export interface ResultatRecherche { url: string; titre: string; extrait: string }
/** LE moteur de recherche d'Odin, vu par Mathésis. */
export type Chercheur = (q: string, signal?: AbortSignal) => Promise<ResultatRecherche[]>;

/** Le transport : une fonction de la forme de fetch (les essais passent un faux). Seuls GET et HEAD y passent. */
export type Transport = (url: string, init: { method: 'GET' | 'HEAD'; headers: Record<string, string>; redirect: 'manual'; signal?: AbortSignal }) => Promise<Response>;
/** Résolution d'un nom en adresses (les essais passent une fausse). */
export type Resolveur = (hote: string) => Promise<string[]>;

/** L'horloge et l'attente (injectées : les essais passent une fausse horloge). */
export interface Temps { maintenant: () => number; attendre: (ms: number, signal?: AbortSignal) => Promise<void> }

// ------------------------------------------------------------------ Points de branchement (passages suivants)
/** (passage suivant) Analyse d'un média : vidéo, image, son. Rend ce qui a été COMPRIS ; la copie de travail est supprimée. */
export interface AnalyseurMedia {
  genre: 'video' | 'image' | 'son';
  analyser(source: string, o: { signal?: AbortSignal; dossierTemporaire: string }): Promise<{ compris: string; empreinte: string; minutes?: number }>;
}
/** (passage suivant) Lecture d'un dossier OUVERT par le propriétaire, en lecture seule. */
export interface LecteurDossier { ouverts(): string[]; lire(chemin: string, signal?: AbortSignal): AsyncIterable<{ chemin: string; texte: string }> }
/** (passage suivant) Ce que la carte 2D/3D lira : un point par site, les liens, la date de dernière lecture. */
export interface SourceCarte { sites(): Array<{ site: string; pages: number; derniereLecture: string; liensVers: string[] }> }
