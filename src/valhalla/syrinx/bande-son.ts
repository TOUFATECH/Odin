// Syrinx — la porte vers le calcul de l'oreille (src/audio, chargé par import tardif) et la bande son d'une vidéo.
//
// Le calcul pur (lire le son, entendre sans modèle, le modèle de sons ouvert) vit dans src/audio. Syrinx ne connaît que
// son contrat (src/audio/contrat.ts) ; la barrière src/audio/index.ts est chargée au moment voulu, dans un try : si elle
// manque, l'oreille « n'est pas encore prête » et rien ne casse. Les essais peuvent lui substituer une fausse oreille.
//
// bandeSon : pour une vidéo, la musique 🎵 et les sons reconnus 🔊 rejoignent la ligne de temps de Théia. La parole est
// déjà faite par la vidéo : elle n'est pas refaite ici. Rien n'est rangé, rien ne part en ligne. Ne lève jamais.
import type { AnalyseSon, CodeErreurSon, EmpreinteSon, Ecouter, Mesure, ModeleSons, OptionsAnalyse, ResultatEcoute, SourceSon } from '../../audio/contrat.ts';
import type { OdinConfig } from '../../config.ts';
import { dirPoidsSons } from './base.ts';
import { lignesBandeSon } from './ligne-de-temps.ts';

/** Ce que Syrinx attend de la barrière src/audio/index.ts (les exports du contrat, section 2). */
export interface Oreille {
  analyserSon(source: SourceSon, o?: OptionsAnalyse): Promise<ResultatEcoute>;
  ouvrirModeleSons(o: { dossier: string; attendu?: { sha256?: string } }): Promise<ModeleSons>;
  etatModeleSons(dossier: string): { present: boolean; verifie: boolean; aTourne: boolean; quand?: string; mesure?: Mesure };
  voterEmpreinte(q: EmpreinteSon, trouves: Array<{ id: string; code: number; t: number }>): Array<{ id: string; score: number; decalageS: number; meme: boolean }>;
  sonFabrique(genre: 'clics120' | 'accordDo' | 'silencePuisBruit', sec: number): Uint8Array;
  readonly CATALOGUE_SONS: { readonly taille: number; readonly licence: string };
}

let substitut: Oreille | undefined;
/** (essais) remplace la barrière par une fausse oreille ; sans argument, revient à la vraie. */
export function oreilleEssai(o?: Oreille): void { substitut = o; cacheModele.clear(); }

/** La barrière de l'oreille, ou undefined si elle n'est pas encore là (« l'oreille n'est pas encore prête »). */
export async function oreille(): Promise<Oreille | undefined> {
  if (substitut) return substitut;
  try {
    const m: Oreille = await import('../../audio/index.ts');
    return m;
  } catch { return undefined; }
}

/** La transcription LOCALE de la voix d'Odin est-elle déjà installée sur ce poste ? (rien n'est installé ici) */
export async function transcriptionLocalePrete(): Promise<boolean> {
  try { const l = await import('../../voice/local.ts'); return Boolean(l.localWhisper()); } catch { return false; }
}

/**
 * Un écouteur par la transcription LOCALE seule, si elle est déjà installée ; sinon null. Jamais le service de
 * transcription en ligne (localOnly forcé), jamais l'audio brut gardé (keepAudio forcé à faux), jamais d'installation :
 * si la transcription locale disparaît entre-temps, l'écoute échoue au lieu de se rabattre ailleurs.
 */
export async function ecouteurLocal(voice: OdinConfig['voice'] | undefined): Promise<Ecouter | null> {
  if (!voice || !(await transcriptionLocalePrete())) return null;
  try {
    const v = await import('../../voice/voice.ts');
    const seule = { ...voice, localOnly: true, privacy: { ...voice.privacy, keepAudio: false } };
    return async (a, m, sig) => {
      if (!(await transcriptionLocalePrete())) throw new Error('la transcription locale n\'est plus sur ce poste');
      const h = await v.hear(a, m, seule, sig);
      return { text: h.text, language: h.language, segments: h.segments ?? [] };
    };
  } catch { return null; }
}

/** Le code d'une erreur de l'oreille (ErreurSon), sinon undefined. */
export function codeErreur(e: unknown): CodeErreurSon | undefined {
  const c = (e as { code?: unknown } | undefined)?.code;
  return typeof c === 'string' && ['introuvable', 'refuse', 'format', 'outil_absent', 'trop_long', 'arrete', 'occupe'].includes(c) ? c as CodeErreurSon : undefined;
}

/** Ce qu'on dit au propriétaire pour chaque erreur de l'oreille (textes honnêtes du contrat). */
export function texteErreur(e: unknown): string {
  const code = codeErreur(e), m = String((e as Error)?.message ?? e ?? '').slice(0, 300);
  switch (code) {
    case 'format': case 'outil_absent': return 'format pas encore lu par Odin seul : installe l\'outil média local (voir Alchimie)';
    case 'occupe': return 'Odin écoute déjà d\'autres sons : réessaie dans un instant';
    case 'trop_long': return `son trop long ou trop gros pour être écouté en entier (${m})`;
    case 'arrete': return 'écoute arrêtée';
    case 'introuvable': return 'son introuvable';
    case 'refuse': return `son refusé (${m})`;
    default: return `l'écoute a échoué : ${m}`;
  }
}

/**
 * Le modèle de sons de cette machine, seulement s'il est PRÊT (sinon undefined). Ouvert une fois et gardé ; un modèle
 * pas prêt est réessayé à l'appel suivant (le fichier a pu arriver entre-temps).
 */
const cacheModele = new Map<string, ModeleSons>();
export async function modeleSonsLocal(dossier: string): Promise<ModeleSons | undefined> {
  const deja = cacheModele.get(dossier); if (deja?.pret) return deja;
  const o = await oreille(); if (!o) return undefined;
  try {
    const m = await o.ouvrirModeleSons({ dossier });
    cacheModele.set(dossier, m);
    return m.pret ? m : undefined;
  } catch { return undefined; }
}

/** La bande son d'une vidéo : lignes 🎵 (musique) et 🔊 (sons reconnus) pour la ligne de temps. Ne lève jamais. */
export async function bandeSon(fichierAudio: string, o: { home: string; signal?: AbortSignal }): Promise<Array<{ t: number; end?: number; text: string; src: 'musique' | 'sons' }>> {
  try {
    const or = await oreille(); if (!or) return [];
    const modele = (await modeleSonsLocal(dirPoidsSons(o.home))) ?? null;
    const r = await or.analyserSon({ fichier: fichierAudio }, { signal: o.signal, modele, ecouter: null, demander: null, avecEmpreinte: false });
    return lignesBandeSon(r.analyse as AnalyseSon);
  } catch { return []; }
}
