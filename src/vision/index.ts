// Théia — la barrière du cœur de vision (Lot A). CE FICHIER NE CONTIENT QUE le contrat : les types et les signatures
// que les deux lots partagent. Lot A l'écrit, Lot B l'importe ; aucun autre fichier de src/vision/ n'est partagé.
//
// Tout le reste de src/vision/ est du CALCUL PUR, écrit dans Odin, sans aucune dépendance externe : décodage d'images
// (PNG, JPEG baseline), mesures « sans modèle », lecteur de poids ouverts (safetensors maison), encodeur d'images de la
// famille des transformeurs de vision, reconnaissance de texte (OCR), petit modèle image→texte.
//
// HONNÊTE : tant qu'un vrai poids ouvert n'a pas été calculé par Odin et mesuré, `essaye=false` / `lue=false` et rien
// n'affirme « comprend ». ouvrirOeil() ne lève JAMAIS : si un poids manque ou ne tient pas en mémoire, l'œil dégrade.

// ----------------------------------------------------------------------------------------------------------------
// Image décodée et préparation (image.ts).
// ----------------------------------------------------------------------------------------------------------------

/** Une image décodée en mémoire : pixels RGBA 8 bits, rangés ligne par ligne. longueur de `rgba` = largeur*hauteur*4. */
export interface ImageDecodee {
  largeur: number;
  hauteur: number;
  rgba: Uint8Array;
}

/** Levée quand un format d'image n'est pas lisible nativement (ni PNG, ni JPEG baseline). Lot B passe alors par
 *  l'outil de conversion déjà présent (FFmpeg) pour en tirer un PNG/JPEG, puis rappelle decoderImage. */
export class ErreurFormatNonNatif extends Error {
  constructor(message = 'format d\'image non lisible nativement (conversion requise)') {
    super(message);
    this.name = 'ErreurFormatNonNatif';
  }
}

/** Décode un tampon d'octets en image RGBA. PNG et JPEG baseline sont lus nativement ; tout autre format (JPEG
 *  progressif, HEIC, AVIF, WebP…) lève ErreurFormatNonNatif. Les bornes « fichier hostile » sont vérifiées AVANT
 *  toute allocation (plafond du tampon, nombre maximal de pixels). `nomOuExt` aide seulement au message d'erreur. */
export { decoderImage } from './image.ts';

/** Redimensionne une image à un carré de `cote`×`cote` pixels (interpolation bilinéaire). */
export { redimensionner } from './image.ts';

/** Normalise une image en flottants au format CHW (canal, hauteur, largeur) : pour chaque canal c et chaque pixel,
 *  (valeur/255 − moy[c]) / ec[c]. moy et ec sont LUS avec les poids du modèle, jamais devinés. */
export { normaliser } from './image.ts';

// ----------------------------------------------------------------------------------------------------------------
// Voir sans modèle (sansmodele.ts) : calculs purs, rapides, sans aucun poids.
// ----------------------------------------------------------------------------------------------------------------

/** Ce qu'Odin voit d'une image sans aucun modèle : une empreinte perceptuelle (64 bits), la luminosité moyenne (0..1),
 *  les couleurs dominantes (avec leur part), la quantité de mouvement par rapport à l'image précédente (si fournie), et
 *  une estimation du nombre de zones de texte. */
export interface StatsPlan {
  empreinte: bigint;
  luminosite: number;
  couleurs: Array<{ r: number; g: number; b: number; part: number }>;
  mouvement?: number;
  zonesTexte: number;
}

/** Calcule les StatsPlan d'une image. Si `precedente` est fournie, estime aussi le mouvement entre les deux. */
export { voirSansModele } from './sansmodele.ts';

/** Distance de Hamming entre deux empreintes perceptuelles (0..64). ≤ 6 : images quasi identiques. */
export { distanceEmpreinte } from './sansmodele.ts';

// ----------------------------------------------------------------------------------------------------------------
// L'œil : encodeur d'images + texte, OCR, description (oeil.ts, ocr.ts, vlm.ts).
// ----------------------------------------------------------------------------------------------------------------

/** Une étiquette proposée pour une image, avec son score (plus grand = plus probable). */
export interface Etiquette {
  mot: string;
  score: number;
}

/** Une description d'image produite par l'œil. `essaye=false` ⇒ aucun vrai modèle image→texte n'a tourné : le texte
 *  est un repli (étiquettes + texte lu), et l'interface doit dire « codé, pas encore essayé sur du vrai modèle ». */
export interface Description {
  texte: string;
  confiance: number;
  tempsMs: number;
  modele: string;
  essaye: boolean;
}

/** Le texte lu dans une image (OCR). `lue=false` ⇒ la page n'a pas pu être lue : rien n'est inventé, le texte est
 *  vide et l'interface doit dire « page non lue ». Chaque ligne porte sa boîte englobante [x, y, largeur, hauteur]. */
export interface LectureImage {
  texte: string;
  confiance: number;
  tempsMs: number;
  lignes: Array<{ texte: string; boite: [number, number, number, number] }>;
  lue: boolean;
}

/** Signal d'arrêt coopératif (compatible AbortSignal) : l'œil l'interroge pour s'arrêter proprement. */
export interface SignalArret {
  readonly aborted: boolean;
}

/** L'œil d'Odin : voit une image, la compare à des mots, en fournit un plongement, la décrit, en lit le texte. Toutes
 *  les méthodes dégradent honnêtement quand le poids nécessaire manque (listes vides, essaye=false, lue=false). */
export interface Oeil {
  /** Vrai si au moins l'encodeur d'images est chargé et mesuré. */
  readonly pret: boolean;
  /** Nom du poids chargé, '' si aucun. */
  readonly modele: string;
  /** Vrai seulement si un modèle image→texte tient dans la machine, mesuré. */
  readonly aVLM: boolean;
  /** Dimension des plongements (0 si aucun encodeur chargé). */
  readonly dim: number;
  /** Compare l'image à chaque mot et renvoie les étiquettes triées. Vide si l'encodeur de texte manque. */
  etiquettes(img: ImageDecodee, mots: string[], signal?: SignalArret): Promise<Etiquette[]>;
  /** Plongement de l'image, normalisé L2, de dimension `this.dim`. Vecteur vide si l'encodeur manque. */
  plongementImage(img: ImageDecodee, signal?: SignalArret): Promise<Float32Array>;
  /** Plongement d'une phrase, même dimension et même espace que les images. Vide si l'encodeur de texte manque. */
  plongementTexte(phrase: string, signal?: SignalArret): Promise<Float32Array>;
  /** Décrit l'image (et répond à une question). Si !aVLM, renvoie étiquettes + texte lu et essaye=false. */
  decrire(img: ImageDecodee, question: string, signal?: SignalArret): Promise<Description>;
  /** Lit le texte de l'image (OCR). `langues` = 'fra+eng' par défaut, le français d'abord. lue=false si illisible. */
  lireTexte(img: ImageDecodee, langues?: string, signal?: SignalArret): Promise<LectureImage>;
}

/** Ouvre l'œil : charge les poids présents dans le dossier `cache`, mesure ce qui tient, et renvoie un Oeil. Ne lève
 *  JAMAIS : si un poids manque, l'œil renvoyé a pret=false, modele='', dim=0 et dégrade proprement. */
export { ouvrirOeil } from './oeil.ts';
