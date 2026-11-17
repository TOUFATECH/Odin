// Médias reçus : le contrat du socle (types publics, bornes de sûreté, erreurs internes, textes « comment l'obtenir »).
// Tout ce qui vient d'un fichier est un CONTENU EXTÉRIEUR : une donnée, jamais une consigne. Rien ici n'appelle le
// réseau ; les données sensibles (position, heure de prise de vue, numéros de série…) restent sur la machine.

export type Fiabilite = 'sure' | 'probable' | 'douteuse';

export type Groupe =
  | 'fichier' | 'œuvre' | 'personnes' | 'droits et diffusion' | 'prise de vue' | 'lieu' | 'appareil'
  | 'réglages' | 'technique' | 'pistes' | 'chapitres' | 'texte inclus' | 'document' | 'logiciel';

/** L'ordre d'affichage des groupes. */
export const ORDRE_GROUPES: Groupe[] = ['fichier', 'œuvre', 'personnes', 'droits et diffusion', 'prise de vue', 'lieu', 'appareil',
  'réglages', 'technique', 'pistes', 'chapitres', 'texte inclus', 'document', 'logiciel'];

export interface Champ {
  /** Clé stable (table des clés connues), en minuscules ASCII ; « x:… » pour une étiquette libre non répertoriée. */
  cle: string;
  /** Nom en clair, en français (« Compositeur »). Pour une étiquette libre : son nom tel qu'écrit, nettoyé. */
  nom: string;
  /** Valeur lisible, nettoyée, au plus 64 Kio stockés. */
  valeur: string;
  /** Valeur machine quand elle existe (nombre, ISO 8601, code de langue…). */
  brut?: string | number;
  /** D'où elle vient dans le fichier (« EXIF:0x9003 », « ID3v2.4:TPE1 », « Vorbis:ARTIST »…). */
  source: string;
  fiabilite: Fiabilite;
  groupe: Groupe;
  sensible?: true;
  /** Encodage non déclaré ou déclaré Latin-1 avec octets ≥ 0x80 : la valeur est gardée telle que décodée. */
  encodageDouteux?: true;
  /** Candidats de décodage quand encodageDouteux (au plus 3, jamais affirmés). */
  candidats?: Array<{ encodage: string; valeur: string }>;
  /** Langue déclarée de la valeur (BCP 47). */
  langue?: string;
  /** Valeurs multiples : `valeur` les joint par « ; », `valeurs` les garde séparées. */
  valeurs?: string[];
}

export type CodeManque =
  | 'absent' | 'retire-probable' | 'format-non-lu' | 'budget' | 'illisible'
  | 'transcription' | 'ocr' | 'vision' | 'ffmpeg' | 'modele-sons' | 'langue' | 'traduction' | 'oreille'
  | 'document' | 'trop-long' | 'arrete' | 'echec' | 'non-demande';

export interface Manque {
  /** Ce qui manque, en clair. */
  quoi: string;
  /** Pourquoi, en clair. */
  raison: string;
  /** Comment l'obtenir, quand c'est possible. */
  commentObtenir?: string;
  code: CodeManque;
}

export type Famille = 'image' | 'son' | 'video' | 'document' | 'texte' | 'sous-titres' | 'archive' | 'inconnu';

export interface Nature {
  famille: Famille;
  /** Code court ('jpeg', 'mp3', 'mkv', 'docx'…). */
  format: string;
  /** Nom en clair : « Photo JPEG », « Musique FLAC »… */
  nom: string;
  /** Type MIME déduit du CONTENU. */
  mime: string;
  /** Extensions attendues pour ce contenu (sans point). */
  extensions: string[];
  /** Extension du nom donné (minuscules, sans point), s'il y a un nom. */
  extensionDonnee?: string;
  /** Faux si l'extension donnée ne fait pas partie des attendues (le contenu fait foi). */
  accordExtension: boolean;
  /** Décalage où commence le vrai format (après une balise ID3 de tête, par exemple). */
  debut: number;
  /** Pour un texte : encodage reconnu. */
  encodage?: { nom: string; bom: boolean; sur: boolean; candidats?: string[] };
  certitude: Fiabilite;
  alertes: string[];
}

export interface DateLue {
  /** Lisible : « 14/08/2026 à 17:32 », « 2024 », « août 2024 ». */
  texte: string;
  /** ISO 8601 au niveau de précision connu. */
  iso: string;
  /** Instant UTC quand le fuseau est connu ou que la source est en UTC. */
  utc?: string;
  fuseau?: string;
  fuseauSource: 'fichier' | 'déduit du GPS' | 'UTC par définition' | 'inconnu';
  precision: 'année' | 'mois' | 'jour' | 'minute' | 'seconde' | 'milliseconde';
  role: 'prise de vue' | 'numérisation' | 'modification' | 'création du fichier' | 'enregistrement'
    | 'parution' | 'parution originale' | 'encodage' | 'étiquetage' | 'achat' | 'GPS';
}

export interface Position {
  lat: number;
  lon: number;
  altitudeM?: number;
  altitudeRef?: 'mer' | 'ellipsoïde';
  directionDeg?: number;
  directionRef?: 'vrai' | 'magnétique';
  precisionM?: number;
  quandUtc?: string;
  source: string;
  fiabilite: Fiabilite;
  /** URI RFC 5870. */
  geo: string;
  /** Feature GeoJSON (RFC 7946). */
  geojson: { type: 'Feature'; geometry: { type: 'Point'; coordinates: number[] }; properties: { source: string; fiabilite: Fiabilite; quandUtc?: string } };
  enClair: string;
}

export interface Piste {
  index: number;
  genre: 'vidéo' | 'son' | 'sous-titres' | 'données' | 'image' | 'autre';
  codec?: string;
  codecBrut?: string;
  langueDeclaree?: string;
  nom?: string;
  largeur?: number; hauteur?: number;
  largeurAffichee?: number; hauteurAffichee?: number;
  rotationDeg?: 0 | 90 | 180 | 270;
  imagesParSeconde?: number; frequenceVariable?: boolean;
  frequenceHz?: number; canaux?: number; bitsParEchantillon?: number;
  debitKbps?: number;
  dureeSec?: number;
  parDefaut?: boolean; forcee?: boolean;
  texteEnImages?: boolean;
  nonLue?: string;
}

export interface Chapitre { debutSec: number; finSec?: number; titre: string; langue?: string }

export interface ImageJointe {
  role: 'pochette recto' | 'pochette verso' | 'pochette' | 'vignette' | 'artiste' | 'autre';
  /** Format reconnu par les OCTETS (jamais par le MIME déclaré) ; « inconnu » sinon. */
  format: string;
  mimeDeclare?: string;
  largeur?: number; hauteur?: number;
  description?: string;
  /** Où sont les octets dans le fichier (pour extraireImageJointe). */
  decalage: number;
  taille: number;
  codage: 'brut' | 'base64' | 'désynchronisé';
}

export interface TexteInclus {
  genre: 'paroles' | 'paroles synchronisées' | 'commentaire' | 'description' | 'légende';
  texte: string; langue?: string; source: string; lignes?: Array<{ tSec: number; texte: string }>;
}

export interface Fiche {
  nature: Nature;
  nomFichier?: string;
  tailleOctets: number;
  champs: Champ[];
  dates: DateLue[];
  position?: Position;
  autresPositions: Position[];
  pistes: Piste[];
  chapitres: Chapitre[];
  images: ImageJointe[];
  dureeSec?: number;
  dureeEstimee?: boolean;
  largeur?: number; hauteur?: number;
  orientation?: { code: number; texte: string };
  languesDeclarees: Array<{ code: string; source: string }>;
  textesInclus: TexteInclus[];
  remarques: string[];
  manque: Manque[];
  partiel?: string;
  illisible?: string;
  exterieur: true;
  tempsMs: number;
}

/** Les bornes de sûreté : un fichier reçu est hostile par défaut. */
export const BORNES = Object.freeze({
  octetsLusMeta: 64 * 1024 ** 2,
  elements: 100_000,
  profondeur: 16,
  profondeurXml: 32,
  dureeMetaMs: 2_000,
  texteChamp: 64 * 1024,
  texteAffiche: 4 * 1024,
  imageJointe: 16 * 1024 ** 2,
  xmp: 4 * 1024 ** 2,
  decompresse: 16 * 1024 ** 2,
  rapportDecompression: 1000,
  base64: 16 * 1024 ** 2,
  zipEntrees: 10_000, zipNom: 1_024, zipEntreeMax: 64 * 1024 ** 2, zipRapport: 100,
  ifd: 16, ifdEntrees: 512, subIfd: 8,
  jpegSegments: 1_000, pngChunks: 10_000, gifImages: 10_000, gifSousBlocs: 1_000_000,
  id3Taille: 32 * 1024 ** 2, id3Trames: 10_000, apeElements: 1_000, syltPaires: 10_000,
  vorbisCommentaires: 10_000, flacBlocs: 1_000, oggPages: 10_000, oggPaquet: 16 * 1024 ** 2,
  mp3Recherche: 64 * 1024, pistes: 64, mp4TableEntrees: 1_000_000, heifElements: 10_000, heifExtents: 64,
  mkvSeekProfondeur: 2, mkvSimpleTag: 4, aviFlux: 64, aviChunksEntete: 10_000, ressources8bim: 1_000,
  sousTitresRepliques: 100_000, sousTitresOctets: 2 * 1024 ** 2,
  // comprendre (passe 2)
  tailleMaxComprendre: 2 * 1024 ** 3,
  dureeMaxMediaSec: 3 * 3600,
  pagesOcr: 20, imagesCles: 16, dureeComprendreMs: 20 * 60_000,
  texteLu: 2 * 1024 ** 2,
});
export type Bornes = { -readonly [K in keyof typeof BORNES]: number };

/** Le budget d'un fichier a été dépassé (octets, éléments, profondeur, durée). */
export class ArretBudget extends Error {
  raison: string;
  constructor(raison: string) { super(`budget atteint : ${raison}`); this.name = 'ArretBudget'; this.raison = raison; }
}
/** La structure lue est invalide. */
export class ErreurFormat extends Error {
  raison: string;
  constructor(raison: string) { super(raison); this.name = 'ErreurFormat'; this.raison = raison; }
}

export interface Budget {
  readonly bornes: Bornes;
  /** Ajoute n octets lus ; lève ArretBudget au-delà. */
  lire(n: number): void;
  /** Compte un élément visité ; regarde l'heure toutes les 256 fois. */
  pas(): void;
  /** Refuse une profondeur au-delà de la borne. */
  profondeur(d: number, max?: number): void;
  restantMs(): number;
}

/** Une fiche en cours de lecture : ses tableaux existent déjà ; un arrêt garde ce qui est lu. */
export type FicheEnCours = Fiche;

/** Candidats retenus pendant la lecture, triés à la fin (règles de priorité). */
export interface Travail {
  /** Rang de priorité de chaque champ (plus petit = plus prioritaire). */
  rangs: Map<Champ, number>;
  positions: Array<{ p: Position; rang: number }>;
  datesPrise: Array<{ d: DateLue; rang: number; source: string; douteuse?: boolean }>;
  /** Date GPS (UTC) d'une photo, pour vérifier la position et déduire le fuseau. */
  gpsUtc?: string;
  /** Mentions de droits brutes (pour la note du distributeur manquant). */
  droitsBruts: string[];
  /** Champs libres déjà ajoutés (bornés). */
  libres: number;
  /** Octets des images jointes (seulement quand `avecImages`), par index dans `images`. */
  captures: Map<number, Buffer>;
}

export interface Contexte {
  budget: Budget;
  /** Instant de la lecture (ms), pour borner les années. */
  maintenant: number;
  avecImages: boolean;
  travail: Travail;
}

// ─────────────────────────────── Passe 2 : les briques ───────────────────────────────
// « Comprendre » ne sait rien faire seul : il reçoit des fonctions (les briques) fabriquées d'après ce qui existe
// réellement sur la machine (fabrique.ts). Une brique absente n'est jamais remplacée par une invention : le résultat
// dit ce qui manque, pourquoi, et comment l'obtenir.

/** Un morceau de parole horodaté (secondes). */
export interface Segment { debut: number; fin: number; texte: string; confiance?: number; voix?: string }
/** Un mot horodaté (secondes). */
export interface Mot { debut: number; fin: number; texte: string; confiance?: number }
export interface ImageAEnvoyer { octets: Buffer; format: string /* 'jpeg' | 'png' | … */ }
export interface OptionsBrique { signal?: AbortSignal; delaiMs?: number }

export interface Briques {
  reconnaitreLangue?: (texte: string) => { langue?: string; confiance: number; ecriture: string; hypothese?: string };
  transcrire?: (fichierAudio: string, o: OptionsBrique & { dureeSec?: number }) =>
    Promise<{ texte: string; langue?: string; langueSure: boolean; segments: Segment[]; mots?: Mot[]; via: string }>;
  analyserSon?: (fichier: string, o: OptionsBrique & { avecParole: boolean }) => Promise<import('../audio/contrat.ts').AnalyseSon>;
  lireTexteImage?: (img: ImageAEnvoyer, o: OptionsBrique & { languesIndice?: string[] }) =>
    Promise<{ texte: string; confiance?: number; via: string; lignes?: Array<{ texte: string; boite?: number[] }> }>;
  decrireImage?: (img: ImageAEnvoyer, o: OptionsBrique & { question?: string }) => Promise<{ texte: string; confiance?: number; via: string }>;
  lireDocument?: (octets: Buffer, nature: Nature, o: OptionsBrique) =>
    Promise<{ texte: string; via: string; pages?: number; partiel?: boolean; scanne?: boolean }>;
  pagesEnImages?: (octetsPdf: Buffer, max: number, o: OptionsBrique) => Promise<ImageAEnvoyer[]>;
  /** Vers JPEG (formats que les briques ne lisent pas nativement). */
  convertirImage?: (img: ImageAEnvoyer, o: OptionsBrique) => Promise<ImageAEnvoyer>;
  extraireSon?: (video: string, dossier: string, o: OptionsBrique) => Promise<string | undefined>;
  imagesCles?: (video: string, dossier: string, dureeSec: number, max: number, o: OptionsBrique) => Promise<Array<{ t: number; fichier: string }>>;
  /** Le texte SRT d'une piste de sous-titres incluse. */
  /** `rangSousTitres` : rang de la piste parmi les pistes de sous-titres (0 = la première), plus sûr que l'index. */
  extraireSousTitresInclus?: (video: string, indexPiste: number, o: OptionsBrique & { rangSousTitres?: number }) => Promise<string | undefined>;
  traduire?: (texte: string, versLangue: string, o: OptionsBrique & { deLangue?: string; contexte?: string[] }) => Promise<string>;
  detecterConsignes?: (texte: string) => { suspect: boolean; motifs: string[] };
  /** Rempli par la fabrique : pourquoi chaque brique absente l'est (repris tel quel dans « ce qui manque »). */
  absentes: Manque[];
}

/** Levée par une brique qui découvre au moment de servir qu'elle ne peut pas (ex. aucun modèle n'a répondu) :
 *  « comprendre » la range comme un manque de ce code, pas comme un échec. */
export class BriqueIndisponible extends Error {
  manque: Manque;
  constructor(manque: Manque) { super(manque.raison); this.name = 'BriqueIndisponible'; this.manque = manque; }
}

/** Textes « comment l'obtenir ». */
export const COMMENT = {
  transcription: 'Installer la transcription locale d\'Odin (Whisper sur la machine) : Réglages → Voix → transcription locale. Rien n\'est envoyé dehors.',
  ocr: 'Le poids de lecture de texte de Théia (ocr.safetensors) n\'est pas sur la machine, et Tesseract n\'est pas installé. Installer Tesseract avec les langues voulues : Windows « winget install UB-Mannheim.TesseractOCR » (cocher les langues à l\'installation), macOS « brew install tesseract tesseract-lang », Linux « sudo apt install tesseract-ocr tesseract-ocr-<langue> ».',
  vision: 'Aucun modèle de vision local (Théia). Un modèle en ligne pourrait décrire l\'image, mais elle quitterait la machine : seulement si tu le demandes.',
  ffmpeg: 'FFmpeg n\'est pas installé : macOS « brew install ffmpeg », Windows « winget install Gyan.FFmpeg », Linux « sudo apt install ffmpeg ».',
  modeleSons: 'Le modèle de sons de Syrinx n\'est pas téléchargé (Syrinx → télécharger le modèle de sons).',
  langue: 'Le reconnaisseur de langue d\'Odin (src/langue) n\'a pas pu être chargé.',
  traduction: 'Aucune fonction de traduction n\'a été donnée : demande « traduis en … » dans la discussion.',
  oreille: 'L\'oreille d\'Odin (src/audio) n\'a pas pu être chargée.',
} as const;
