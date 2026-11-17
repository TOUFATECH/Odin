// Voix copiées (Réglages → Voix) : voir les accords, en retirer un. La copie elle-même passait par ElevenLabs (un modèle
// qui n'est pas celui d'Odin) : depuis le 17/11/2026 elle répond « pas encore », sans rien noter ni envoyer.
// - Une copie autrefois faite chez ElevenLabs : l'accord noté reste dans le registre, jusqu'à ce qu'il soit retiré.
// - L'enregistrement n'est jamais écrit sur le disque d'Odin : il traverse la mémoire, puis il est oublié.
// - Retirer un accord : Odin arrête tout de suite de parler avec cette voix ; Odin n'appelle plus ElevenLabs, c'est au
//   propriétaire d'y effacer la voix (elevenlabs.io, Voices).

import type { OdinConfig, OdinPaths } from '../config.ts';
import { setConfigValue } from '../config.ts';
import { voiceFor } from '../profiles.ts';
import { accords, majAccord } from '../voice/accords.ts';
import { cloneBlocked } from '../voice/voice.ts';

type Deps = { paths: OdinPaths; cfg: OdinConfig };

/** Les accords notés, pour la page (ni l'empreinte de l'enregistrement ni l'identifiant de la voix n'y vont). */
export function voixCopies(o: Deps): { ok: true; copies: Array<{ id: string; at: string; nom: string; de: 'moi' | 'autre'; personne: string; phrase: string; aVerifier: boolean; retire: string; effacee: boolean; actuelle: boolean }> } {
  const cur = voiceFor(o.cfg.voice, o.cfg).tts.voiceId;
  return { ok: true, copies: accords(o.paths.home).filter((a) => a.voiceId).map((a) => ({ id: a.id, at: a.at, nom: a.voiceName, de: a.de, personne: a.personne, phrase: a.phrase, aVerifier: Boolean(a.aVerifier), retire: a.retire ?? '', effacee: Boolean(a.effacee), actuelle: !a.retire && a.voiceId === cur })) };
}

/** Copier une voix : pas encore. Rien n'est noté ni envoyé ; l'enregistrement reçu est oublié aussitôt. */
export async function voixCloner(o: Deps, _q: URLSearchParams, _audio: Uint8Array, _type: string, _par: string): Promise<{ ok: boolean; error?: string; voiceId?: string; verify?: boolean; text?: string }> {
  return { ok: false, error: cloneBlocked(o.cfg.voice) };
}

/** Retire un accord : Odin ne parle plus avec cette voix (son effacement chez ElevenLabs revient au propriétaire). */
export async function voixRetirer(o: Deps, id: string): Promise<{ ok: boolean; error?: string; text?: string }> {
  const home = o.paths.home, v = o.cfg.voice;
  const a = accords(home).find((x) => x.id === id && x.voiceId);
  if (!a) return { ok: false, error: 'accord introuvable' };
  try {
    // 1. Odin arrête de s'en servir, tout de suite (réglage de la voix, voix de femme, personnalités).
    if (v.tts.voiceId === a.voiceId) { setConfigValue(o.paths, ['voice', 'tts'], { ...v.tts, voiceId: '', voiceName: '' }); v.tts.voiceId = ''; v.tts.voiceName = ''; }
    if (v.femaleVoiceId === a.voiceId) { setConfigValue(o.paths, ['voice', 'femaleVoiceId'], ''); v.femaleVoiceId = ''; }
    if (o.cfg.profiles?.list?.some((p) => p.voiceId === a.voiceId)) { for (const p of o.cfg.profiles.list) if (p.voiceId === a.voiceId) p.voiceId = ''; setConfigValue(o.paths, ['profiles'], o.cfg.profiles); }
  } catch (e) { return { ok: false, error: `réglage de la voix impossible à changer : ${(e as Error).message}` }; }
  // 2. Odin n'appelle plus ElevenLabs (17/11/2026) : la voix copiée là-bas, c'est au propriétaire de l'y effacer.
  majAccord(home, a.id, { retire: a.retire ?? new Date().toISOString(), effacee: Boolean(a.effacee) });
  return { ok: true, text: `Accord retiré : Odin ne parle plus avec « ${a.voiceName} ».${a.effacee ? '' : ' Odin n\'appelle plus ElevenLabs : si cette voix y est encore, efface-la toi-même sur elevenlabs.io (Voices).'}` };
}
