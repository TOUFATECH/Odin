// Contrat partagé de Métis (le « seam » A↔B).
//
// Métis est le moteur d'inférence écrit ENTIÈREMENT dans Odin : il lit un modèle ouvert au format GGUF et calcule
// un Transformer décodeur (familles llama/qwen2/qwen3/phi3/gemma), sans serveur réglé par adresse. Ce fichier ne
// contient que des types et des signatures : le lot « Lecteur et poids » (A) l'écrit et le remplit ; le lot « Moteur
// et branchement » (B) l'importe en LECTURE SEULE et ne le réécrit jamais.
//
// Note du lot B : A et B sont codés en parallèle. Au moment où B a été écrit, A n'avait pas encore déposé ce fichier.
// B l'a donc créé à l'identique du contrat, pour pouvoir compiler et faire tourner ses essais. Quand A livre sa
// version, elle doit être rigoureusement la même (ces interfaces sont le contrat) ; sinon, c'est la version de A qui
// fait foi.

/** Un tenseur déquantifié en flottants 32 bits, prêt pour le calcul. */
export interface TenseurF32 { readonly dims: number[]; readonly data: Float32Array }

/** La fiche d'un tenseur dans le fichier (position et taille), sans l'avoir encore lu. */
export interface InfoTenseur { readonly nom: string; readonly dims: number[]; readonly type: number; readonly offset: number; readonly octets: number }

/** Une valeur de métadonnée GGUF (nombre, grand entier, booléen, chaîne, ou tableau de valeurs). */
export type MetaValeur = number | bigint | boolean | string | MetaValeur[];

/** Les hyper-paramètres du modèle, lus dans les métadonnées. */
export interface HyperGguf {
  readonly embeddingLength: number;
  readonly blockCount: number;
  readonly feedForwardLength: number;
  readonly headCount: number;
  readonly headCountKv: number;
  readonly ropeDimensionCount: number;
  readonly ropeFreqBase: number;
  readonly rmsEps: number;
  readonly contextLength: number;
  readonly vocabLength: number;
}

/** Le découpage en morceaux (tokeniseur) rangé dans le fichier. */
export interface DecoupageGguf {
  readonly vocab: number;
  readonly version: number;
  readonly bos: number;
  readonly eos: number;
  encoder(texte: string): Int32Array;
  decoder(ids: ArrayLike<number>): string;
  morceau(id: number): string;
}

/** Un modèle GGUF ouvert : métadonnées lues, tenseurs lus à la demande (par position dans le fichier). */
export interface ModeleGguf {
  readonly arch: string;
  readonly meta: Record<string, MetaValeur>;
  readonly hyper: HyperGguf;
  readonly tenseurs: ReadonlyMap<string, InfoTenseur>;
  readonly decoupage: DecoupageGguf;
  tenseur(nom: string): Promise<TenseurF32>;
  readonly tailleOctets: number;
  readonly empreinte: string;
  readonly gabaritDiscussion?: string;
  fermer(): Promise<void>;
}

/** La vitesse mesurée d'un modèle sur cette machine (jamais promise : mesurée). */
export interface MesureModele {
  readonly morceauxParSeconde: number;
  readonly msParMorceau: number;
  readonly memoireMo: number;
  readonly date: string;
  readonly essayeSurVrai: boolean;
}

/** Une fiche du catalogue des modèles téléchargés (base METIS_ODIN ; le fichier GGUF reste hors base). */
export interface ModeleCatalogue {
  readonly id: string;
  readonly nom: string;
  readonly chemin: string;
  readonly arch: string;
  readonly tailleOctets: number;
  readonly empreinte: string;
  readonly quant: string;
  readonly parametres?: number;
  readonly type: 'chat' | 'embeddings';
  readonly mesure?: MesureModele;
}

/** Ce que la machine peut faire tourner (vitesse brute, mémoire libre, taille de modèle acceptable). */
export interface CapaciteMachine {
  readonly gflops: number;
  readonly ramLibreMo: number;
  readonly octetsMax: number;
}
