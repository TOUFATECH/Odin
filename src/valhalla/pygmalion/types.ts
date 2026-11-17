// Pygmalion — le contrat. Une CRÉATION d'Odin : ce qu'il a produit, à partir de quoi, par quel moyen, quand, et où elle
// est rangée. Elle est TOUJOURS marquée « création d'Odin » (dans le fichier quand le format le permet, et dans le
// registre) : jamais présentée comme une vraie photo, un vrai enregistrement ou un document d'une autre origine.

/** Les formats que Pygmalion sait fabriquer à ce passage (lot 2). */
export type Format = 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'pdf' | 'html' | 'xml' | 'rtf' | 'md' | 'csv' | 'json' | 'txt' | 'zip' | 'tar.gz';

/** D'où vient la matière d'une création (dit dans le registre, et dans le document quand c'est utile). */
export interface Source {
  genre: 'demande' | 'memoire' | 'fichier' | 'modele' | 'creation';
  /** court, lisible : « ta demande du 17/11 », « mémoire : prix du gazole (confirmé) » */
  detail: string;
}

/** Une création rangée. */
export interface Creation {
  id: string;
  format: Format;
  titre: string;
  /** à partir de quoi */
  sources: Source[];
  /** par quel moyen : le générateur écrit dans Odin (« écrivain Word d'Odin ») */
  moyen: string;
  /** quand (ISO) */
  quand: string;
  /** où elle est rangée : chemin RELATIF au dossier de sortie */
  chemin: string;
  octets: number;
  /** sha256 du fichier produit */
  empreinte: string;
  /** toujours vrai : la marque « création d'Odin » */
  marquee: true;
  /** comment la marque est portée : dans le fichier, ou seulement au registre (format sans place pour elle) */
  marque: 'dans le fichier' | 'au registre';
  /** temps mesuré pour fabriquer le fichier (ms) */
  dureeMs: number;
}

/** Un palier de production, avec ce que cette machine sait vraiment faire. */
export interface Palier {
  id: string;
  nom: string;
  /** fait (codé et essayé) · prevu (passage suivant) · lent (possible mais très lent ici) · hors_de_portee (pas réaliste ici) */
  etat: 'fait' | 'prevu' | 'lent' | 'hors_de_portee';
  /** ce qui est dit honnêtement à l'écran */
  texte: string;
  /** vitesse MESURÉE ici, quand elle l'a été */
  mesure?: string;
}

/** Une cellule de tableur TYPÉE : un texte reste un texte (jamais une formule), une formule est voulue et vérifiée. */
export type Cellule = string | number | boolean | null | { formule: string } | { texte: string };

/** Une demande de document. Le contenu dépend du format (voir documents.ts). */
export interface DemandeDocument {
  format: Exclude<Format, 'zip' | 'tar.gz'>;
  titre: string;
  /** texte en Markdown simple (# titres, - listes, **gras**, *italique*) pour les documents de texte */
  texte?: string;
  /** feuilles d'un tableur */
  feuilles?: Array<{ nom: string; lignes: Cellule[][] }>;
  /** diapositives d'une présentation */
  diapositives?: Array<{ titre: string; puces?: string[] }>;
  /** données d'un JSON ou d'un XML */
  donnees?: unknown;
  sources?: Source[];
}

/** Un fichier à mettre dans une archive. */
export interface FichierArchive { nom: string; octets: Buffer }

/** Les bornes, posées dans le code (et prouvées par les essais). */
export const BORNES = {
  /** taille maximale d'un fichier produit */
  fichier: 50 * 1024 * 1024,
  /** taille maximale décompressée à l'ouverture d'une archive */
  archiveDecompressee: 200 * 1024 * 1024,
  /** nombre maximal d'entrées d'une archive */
  entrees: 10_000,
  /** rapport maximal décompressé / compressé (au-delà : « bombe ») */
  ratio: 200,
  /** temps maximal pour fabriquer un fichier (ms) */
  dureeMs: 30_000,
  /** longueur maximale d'un texte d'entrée */
  texte: 5 * 1024 * 1024,
  /** cellules au plus dans un tableur */
  cellules: 1_000_000,
  /** créations gardées au registre */
  registre: 5000,
} as const;
