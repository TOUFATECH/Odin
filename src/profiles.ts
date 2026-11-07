// Personnalités d'Odin : un ton (et une voix) par contexte — maison, travail… Le mode « auto » choisit
// « travail » en semaine de 8 h à 18 h, sinon « maison » (si ces profils existent).

import type { OdinConfig } from './config.ts';

export type Profile = OdinConfig['profiles']['list'][number];

export function activeProfile(cfg: Pick<OdinConfig, 'profiles'>, now = new Date()): Profile | undefined {
  const p = cfg.profiles ?? { active: '', auto: false, list: [] };
  let id = p.active;
  if (p.auto) {
    const day = now.getDay(), h = now.getHours();
    const work = day >= 1 && day <= 5 && h >= 8 && h < 18;
    id = work && p.list.some((x) => x.id === 'travail') ? 'travail' : p.list.some((x) => x.id === 'maison') ? 'maison' : p.active;
  }
  return p.list.find((x) => x.id === id);
}

/** Voix d'homme et de femme par défaut de chaque fournisseur (françaises ou multilingues). */
export const GENDER_VOICES: Record<string, { homme: string; femme: string }> = {
  openai: { homme: 'onyx', femme: 'nova' },
  elevenlabs: { homme: 'onwK4e9ZLuTAKqWW03F9', femme: 'XB0fDUnXU5powFXDhCwa' }, // Daniel, Charlotte (voix prêtes à l'emploi)
  piper: { homme: '', femme: 'fr_FR-siwis-medium' }, // homme : la voix du serveur Piper (ou « tom » en local)
};

/** La voix à utiliser : celle du profil actif s'il en a une, sinon homme ou femme selon le réglage. */
export function voiceFor<V extends { tts: { voiceId: string; provider?: string }; gender?: 'homme' | 'femme'; femaleVoiceId?: string }>(voice: V, cfg: Pick<OdinConfig, 'profiles'>, now = new Date()): V {
  const p = activeProfile(cfg, now);
  if (p?.voiceId) return { ...voice, tts: { ...voice.tts, voiceId: p.voiceId } };
  const d = GENDER_VOICES[voice.tts.provider ?? ''] ?? { homme: '', femme: '' };
  const id = voice.gender === 'femme' ? (voice.femaleVoiceId || d.femme) : (voice.tts.voiceId || d.homme);
  return { ...voice, tts: { ...voice.tts, voiceId: id } };
}
