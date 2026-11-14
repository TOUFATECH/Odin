// Voix copiées (Réglages → Voix) : copier une voix avec l'accord noté, voir les accords, en retirer un.
// - L'accord est vérifié et noté AVANT que l'enregistrement parte chez ElevenLabs ; sans accord, rien ne part.
// - L'enregistrement n'est jamais écrit sur le disque d'Odin : il traverse la mémoire, puis il est oublié.
// - Retirer un accord : Odin arrête tout de suite de parler avec cette voix, puis elle est effacée chez ElevenLabs.

import type { OdinConfig, OdinPaths } from '../config.ts';
import { setConfigValue } from '../config.ts';
import { voiceFor } from '../profiles.ts';
import { accords, majAccord, noteAccord, oublieAccord, phraseAccord } from '../voice/accords.ts';
import { cloneBlocked, cloneVoice, removeVoice } from '../voice/voice.ts';

type Deps = { paths: OdinPaths; cfg: OdinConfig };

/** Les accords notés, pour la page (ni l'empreinte de l'enregistrement ni l'identifiant de la voix n'y vont). */
export function voixCopies(o: Deps): { ok: true; copies: Array<{ id: string; at: string; nom: string; de: 'moi' | 'autre'; personne: string; phrase: string; aVerifier: boolean; retire: string; effacee: boolean; actuelle: boolean }> } {
  const cur = voiceFor(o.cfg.voice, o.cfg).tts.voiceId;
  return { ok: true, copies: accords(o.paths.home).filter((a) => a.voiceId).map((a) => ({ id: a.id, at: a.at, nom: a.voiceName, de: a.de, personne: a.personne, phrase: a.phrase, aVerifier: Boolean(a.aVerifier), retire: a.retire ?? '', effacee: Boolean(a.effacee), actuelle: !a.retire && a.voiceId === cur })) };
}

/** Copie une voix : accord vérifié et noté, enregistrement envoyé, voix choisie pour Odin. */
export async function voixCloner(o: Deps, q: URLSearchParams, audio: Uint8Array, type: string, par: string): Promise<{ ok: boolean; error?: string; voiceId?: string; verify?: boolean; text?: string }> {
  const home = o.paths.home, v = o.cfg.voice;
  let noted = '';
  try {
    const who = phraseAccord({ consent: q.get('consent') === '1', de: q.get('de') ?? 'moi', personne: q.get('personne') ?? '' });
    const name = (q.get('name') ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 60);
    if (!name) throw new Error('donne un nom à la voix');
    if (!audio.byteLength) throw new Error('ajoute un enregistrement (une minute de parole claire suffit)');
    const blocked = cloneBlocked(v); if (blocked) throw new Error(blocked);
    noted = noteAccord(home, { ...who, par, voiceName: name, service: 'elevenlabs', sample: audio, type }).id;
    const c = await cloneVoice(name, [{ data: audio, mime: type || 'audio/mpeg', filename: (q.get('file') ?? 'echantillon.mp3').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'echantillon.mp3' }], true, v);
    majAccord(home, noted, { voiceId: c.voiceId, aVerifier: c.needsCheck });
    noted = '';
    if (c.needsCheck) return { ok: true, voiceId: c.voiceId, verify: true, text: 'Voix copiée et accord noté. ElevenLabs demande encore de vérifier que c\'est bien ta voix : ouvre elevenlabs.io → Voices, fais la vérification, puis reviens ici, touche « Charger mes voix » et choisis-la.' };
    // La voix copiée devient celle d'Odin, pour le genre choisi (homme ou femme).
    if (v.gender === 'femme') { setConfigValue(o.paths, ['voice', 'femaleVoiceId'], c.voiceId); v.femaleVoiceId = c.voiceId; }
    else { setConfigValue(o.paths, ['voice', 'tts'], { ...v.tts, voiceId: c.voiceId, voiceName: name }); v.tts.voiceId = c.voiceId; v.tts.voiceName = name; }
    return { ok: true, voiceId: c.voiceId, verify: false, text: 'Voix copiée, accord noté : Odin parle maintenant avec elle.' };
  } catch (e) {
    if (noted) oublieAccord(home, noted); // la copie n'a pas eu lieu : aucun accord à garder
    return { ok: false, error: (e as Error).message };
  }
}

/** Retire un accord : Odin ne parle plus avec cette voix, et elle est effacée chez ElevenLabs. */
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
  // 2. Elle est effacée chez ElevenLabs (ses enregistrements partent avec elle).
  let why = '';
  try { await removeVoice(a.voiceId, v); } catch (e) { why = (e as Error).message; }
  majAccord(home, a.id, { retire: a.retire ?? new Date().toISOString(), effacee: !why });
  return why
    ? { ok: false, error: `Odin ne parle plus avec « ${a.voiceName} », mais je n'ai pas pu l'effacer chez ElevenLabs : ${why}. Réessaie ici, ou efface-la sur elevenlabs.io (Voices).` }
    : { ok: true, text: `Accord retiré : Odin ne parle plus avec « ${a.voiceName} », et elle est effacée chez ElevenLabs.` };
}
