// Le contrat de l'oreille d'Odin : des types et des constantes, aucun calcul. Ne lève jamais au chargement.
export const FS = 16_000;                 // tout son est ramené en mono 16 kHz
export const PAS_SONS_S = 0.16;           // pas de la ligne de temps du modèle de sons
export const TRANCHE_S = 10;              // traitement en flux par tranches de 10 s
export const MAX_SEC = 3 * 3600;          // durée décodée au plus
export const MAX_OCTETS = 2 * 1024 ** 3;  // taille de fichier au plus
export type Famille = 'maison' | 'alerte' | 'parole' | 'musique' | 'instrument' | 'genre' | 'ambiance' | 'autre';
export interface Etiquette { indice: number; cle: string; libelle: string; famille: Famille; p: number; seuil: number }
export interface MomentSon { debut: number; fin: number; indice: number; cle: string; libelle: string; famille: Famille; pMax: number; pas: number }
export type Etape = 'decodage' | 'spectre' | 'sans_modele' | 'empreinte' | 'modele_sons' | 'parole' | 'total';
export interface Mesure { etape: Etape; ms: number; xTempsReel: number }
export interface Volume { rmsDb: number; creteDb: number }
export interface Zone { debut: number; fin: number; son: boolean }
export interface Tempo { bpm: number; second: number; confiance: number }
export interface Tonalite { nom: string; tonique: number; mode: 'majeur' | 'mineur'; confiance: number; second: string }
export interface Partie { debut: number; fin: number; groupe: string; refrainProbable: boolean }
export interface Ecoute { text: string; language: string; segments: Array<{ start: number; end: number; text: string }>; confiance?: number }
export type Ecouter = (audio: Uint8Array | { file: string }, mime: 'audio/wav', signal?: AbortSignal) => Promise<Ecoute>;
export type Demander = (system: string, user: string) => Promise<string>;
export interface Tour { debut: number; fin: number; voix: string }
export interface Parole {
  etat: 'faite' | 'pas_prete' | 'non_demandee' | 'echec'; raison?: string;
  texte?: string; langue?: string; confianceLangue?: number;
  segments: Array<{ debut: number; fin: number; texte?: string }>;
  tours: Tour[]; sujet?: string; texteRetire: boolean;
}
export interface SortieModele { probas: Float32Array; parPas: Float32Array; pas: number; plongement: Float32Array }
export interface ModeleSons {
  readonly pret: boolean; readonly raison?: string; readonly classes: number;
  readonly empreinte?: string; readonly licence?: string; readonly libelles: string[];
  classer(logmel: Float32Array, trames: number, signal?: AbortSignal): Promise<SortieModele>;
}
export interface EmpreinteSon { sha: string; codes: Uint32Array; instants: Uint32Array }
export interface AnalyseSon {
  version: 1; duree: number;
  source: { format: string; fs: number; canaux: number; via: 'natif' | 'outil-media' };
  sha: string; onde: number[];
  volume: Volume; zones: Zone[]; changements: number[];
  musique: { probable: boolean; par: 'modele' | 'sans-modele'; confiance: number; tempo?: Tempo; tonalite?: Tonalite; parties: Partie[] };
  sons: { etat: 'fait' | 'pas_pret' | 'non_demande'; raison?: string; etiquettes: Etiquette[]; moments: MomentSon[]; plongement?: number[] };
  parole: Parole;
  mesures: Mesure[]; manque: string[];
}
export interface ResultatEcoute { analyse: AnalyseSon; empreinte: EmpreinteSon }
export type SourceSon = { fichier: string } | { octets: Uint8Array; nom?: string };
export type Lanceur = (cmd: string, args: string[], o: { signal?: AbortSignal; timeoutMs: number }) =>
  { stdout: AsyncIterable<Uint8Array>; fin: Promise<{ code: number; err: string }> } | undefined;
export interface OptionsAnalyse {
  signal?: AbortSignal; maxSec?: number; delaiMs?: number;
  modele?: ModeleSons | null; ecouter?: Ecouter | null; demander?: Demander | null;
  sonsSeuls?: boolean; avecEmpreinte?: boolean; dossierTemp?: string; lancer?: Lanceur;
}
export type CodeErreurSon = 'introuvable' | 'refuse' | 'format' | 'outil_absent' | 'trop_long' | 'arrete' | 'occupe';
