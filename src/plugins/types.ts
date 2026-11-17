// Plugins des compétences : les types partagés par le magasin, le calcul du graphe et les routes.
// Un « plugin » ici est un regroupement nommé de compétences et de connecteurs MCP (rien à voir avec les
// extensions Python de src/tools/plugins.ts, qui gardent leurs propres noms et leur dossier).

/** Un regroupement créé par le propriétaire. */
export interface PluginRange {
  id: string;
  nom: string;
  description: string;
  skills: string[];
  mcp: string[];
  cree: string;
  modifie: string;
}

/** Un lien compétence ↔ connecteur déclaré à la main, sans passer par un plugin. */
export interface LienDeclare { skill: string; mcp: string; cree: string }

/** Le contenu de <home>/competences/plugins.json. */
export interface FichierPlugins { version: 1; plugins: PluginRange[]; liens: LienDeclare[] }

/** Le contenu de <home>/competences/constats.json : seulement des noms et des compteurs. */
export interface Constats {
  version: 1;
  /** Les tours déjà récoltés, « <session>|<at> », pour les traces encore gardées par Muninn (une par session). */
  vus: string[];
  /** « <compétence>|<connecteur> » → nombre de tours où les deux ont servi ensemble. */
  skillMcp: Record<string, { n: number; dernier: number }>;
  /** Connecteur → nombre de tours observés qui ont appelé un de ses outils. */
  mcpTours: Record<string, number>;
}

export type SorteNoeud = 'skill' | 'mcp' | 'plugin' | 'brain' | 'memoire' | 'soul';
export type Provenance = 'declare' | 'cite' | 'constate' | 'memoire' | 'brain';
export type EtatConnecteur = 'relie' | 'a-relier' | 'panne';

/**
 * Un outil d'un connecteur. `acces` : « lecture » (le serveur le déclare en lecture seule), « modification » (il le
 * déclare destructif), « non-declare » (rien de déclaré : Odin le traite comme pouvant modifier). Déclarations du
 * serveur, jamais vérifiées. `peutModifier` vaut vrai sauf pour « lecture ».
 */
export interface OutilConnecteur { nom: string; outilOdin: string; description: string; acces: 'lecture' | 'modification' | 'non-declare'; peutModifier: boolean }

export interface Connecteur {
  nom: string;
  sorte: 'http' | 'stdio';
  adresse: string;
  etat: EtatConnecteur;
  detail?: string;
  /** Présence d'un jeton au coffre (connecteur HTTP seulement) ; jamais la valeur. */
  jeton?: boolean;
  outils: OutilConnecteur[];
}

export interface Noeud {
  id: string;
  sorte: SorteNoeud;
  nom: string;
  sous: string;
  seul: boolean;
  etat?: EtatConnecteur;
  plugins?: string[];
}

export interface Lien { a: string; b: string; provenances: Provenance[]; titre: string; n?: number }

export interface Etat {
  resume: { competences: number; brouillons: number; connecteurs: number; plugins: number; seuls: number; mcpDisponible: boolean; abime: boolean; omis?: number };
  noeuds: Noeud[];
  liens: Lien[];
  connecteurs: Connecteur[];
  plugins: Array<{ id: string; nom: string; description: string; skills: Array<{ nom: string; present: boolean }>; mcp: Array<{ nom: string; present: boolean }> }>;
  liensDeclares: Array<{ skill: string; mcp: string }>;
  soul: { etat: 'connu' | 'inconnu'; extraitsCompetences: number };
}

/** Ce qu'on retient d'une note du Cerveau : ses liens [[…]], ses mots, ses noms d'outils MCP (rien d'autre). */
export interface IndexNote { liens: Set<string>; mots: Set<string>; outilsMcp: string[] }

/** Les données déjà lues, passées au calcul pur du graphe (les essais lui donnent de fausses sources). */
export interface SourcesEtat {
  competences: Array<{ nom: string; description: string; body: string }>;
  brouillons: number;
  stats: Array<{ name: string; uses: number }>;
  /** undefined : les applis d'Odin ne sont pas démarrées (connecteurs illisibles). */
  connecteurs: Connecteur[] | undefined;
  fichier: FichierPlugins;
  abime: boolean;
  constats: Constats;
  notes: IndexNote[];
  /** Les titres et noms de fichier des notes (minuscules) : [[x]] vers une note existante n'est pas une compétence. */
  titresNotes?: Set<string>;
  soul: { etat: 'connu' | 'inconnu'; extraitsCompetences: number };
}
