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

/** Voix de synthèse : celle du profil actif si elle est choisie, sinon celle des réglages. */
export function voiceFor<V extends { tts: { voiceId: string } }>(voice: V, cfg: Pick<OdinConfig, 'profiles'>, now = new Date()): V {
  const p = activeProfile(cfg, now);
  return p?.voiceId ? { ...voice, tts: { ...voice.tts, voiceId: p.voiceId } } : voice;
}
