// La voix d'Odin : il comprend ce que tu dis (Whisper) et il te répond à voix haute (ElevenLabs).
//
// - Transcription : API compatible OpenAI /audio/transcriptions (OpenAI Whisper, ou un serveur
//   Whisper local comme faster-whisper-server / speaches : aucune clé, rien ne sort de chez toi).
// - Synthèse : ElevenLabs text-to-speech, avec la voix de ton choix ou une voix copiée à partir
//   d'un enregistrement (clonage instantané), seulement avec l'accord de la personne.
// Aucune dépendance : fetch + FormData de Node.

import type { OdinConfig } from '../config.ts';

export type VoiceConfig = OdinConfig['voice'];

const key = (env: string, e: NodeJS.ProcessEnv = process.env) => e[env] ?? '';
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u);

/** La transcription est-elle utilisable (clé présente, ou serveur local) ? */
export function sttReady(v: VoiceConfig, env = process.env): boolean {
  return v.enabled && (Boolean(key(v.stt.apiKeyEnv, env)) || isLocal(v.stt.baseUrl));
}
/** La synthèse est-elle utilisable (clé ElevenLabs et voix choisie) ? */
export function ttsReady(v: VoiceConfig, env = process.env): boolean {
  return v.enabled && Boolean(key(v.tts.apiKeyEnv, env)) && Boolean(v.tts.voiceId);
}

async function failIfBad(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = (await res.text().catch(() => '')).slice(0, 300);
  throw new Error(`${what} : HTTP ${res.status}${body ? ` — ${body}` : ''}`);
}

const extFor = (mime: string) => /ogg|opus/.test(mime) ? 'ogg' : /webm/.test(mime) ? 'webm' : /mp4|m4a|aac/.test(mime) ? 'm4a' : /wav/.test(mime) ? 'wav' : /mpeg|mp3/.test(mime) ? 'mp3' : 'webm';

/** Whisper : audio → texte. */
export async function transcribe(audio: Uint8Array, mime: string, v: VoiceConfig, signal?: AbortSignal, env = process.env): Promise<string> {
  if (audio.byteLength === 0) throw new Error('enregistrement vide');
  if (audio.byteLength > 25 * 1024 * 1024) throw new Error('enregistrement trop long (25 Mo au plus)');
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime || 'audio/webm' }), `parole.${extFor(mime)}`);
  form.append('model', v.stt.model);
  if (v.stt.language) form.append('language', v.stt.language);
  form.append('response_format', 'json');
  const k = key(v.stt.apiKeyEnv, env);
  const res = await fetch(`${v.stt.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST', body: form, headers: k ? { authorization: `Bearer ${k}` } : {},
    signal: signal ?? AbortSignal.timeout(120_000),
  });
  await failIfBad(res, 'Transcription impossible');
  const data = await res.json() as { text?: string };
  return (data.text ?? '').trim();
}

export type AudioFormat = 'mp3_44100_128' | 'opus_48000_64';

/** ElevenLabs : texte → audio (mp3 pour le navigateur, opus pour les notes vocales Telegram). */
export async function speak(text: string, v: VoiceConfig, format: AudioFormat = 'mp3_44100_128', signal?: AbortSignal, env = process.env): Promise<Uint8Array> {
  if (!v.tts.voiceId) throw new Error('aucune voix choisie (Réglages → Voix)');
  const clean = forSpeech(text);
  if (!clean) throw new Error('rien à dire');
  const res = await fetch(`${v.tts.baseUrl.replace(/\/$/, '')}/v1/text-to-speech/${encodeURIComponent(v.tts.voiceId)}?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': key(v.tts.apiKeyEnv, env), 'content-type': 'application/json', accept: 'audio/*' },
    body: JSON.stringify({ text: clean, model_id: v.tts.model }),
    signal: signal ?? AbortSignal.timeout(60_000),
  });
  await failIfBad(res, 'Synthèse vocale impossible');
  return new Uint8Array(await res.arrayBuffer());
}

/** Ce qui se lit mal à voix haute (code, liens, émojis de statut) est retiré ; 2 500 caractères au plus. */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' (code affiché à l\'écran) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/g, 'le lien affiché')
    .replace(/[⚡🛡🧭🔔⛔✅⏰💡🛰📌⚠️🛑]/gu, '')
    .replace(/^\s*[•\-*]\s+/gm, '')
    .replace(/[*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2500);
}

export interface VoiceInfo { id: string; name: string; category: string }

/** Voix disponibles sur le compte ElevenLabs (prédéfinies et copiées). */
export async function listVoices(v: VoiceConfig, env = process.env): Promise<VoiceInfo[]> {
  const res = await fetch(`${v.tts.baseUrl.replace(/\/$/, '')}/v1/voices`, { headers: { 'xi-api-key': key(v.tts.apiKeyEnv, env) }, signal: AbortSignal.timeout(20_000) });
  await failIfBad(res, 'Liste des voix indisponible');
  const data = await res.json() as { voices?: Array<{ voice_id: string; name: string; category?: string }> };
  return (data.voices ?? []).map((x) => ({ id: x.voice_id, name: x.name, category: x.category ?? '' }));
}

/**
 * Copie une voix à partir d'enregistrements (clonage instantané ElevenLabs).
 * `consent` doit être vrai : la voix est la tienne, ou la personne a donné son accord.
 */
export async function cloneVoice(name: string, samples: Array<{ data: Uint8Array; mime: string; filename: string }>, consent: boolean, v: VoiceConfig, env = process.env): Promise<string> {
  if (!consent) throw new Error('copie refusée : confirme que c\'est ta voix ou que la personne a donné son accord');
  const n = name.trim().slice(0, 60);
  if (!n) throw new Error('donne un nom à la voix');
  if (!samples.length) throw new Error('ajoute au moins un enregistrement (une minute de parole claire suffit)');
  const form = new FormData();
  form.append('name', n);
  form.append('description', 'Voix copiée pour Odin, avec consentement');
  form.append('remove_background_noise', 'true');
  for (const s of samples) form.append('files', new Blob([s.data], { type: s.mime || 'audio/mpeg' }), s.filename || 'echantillon.mp3');
  const res = await fetch(`${v.tts.baseUrl.replace(/\/$/, '')}/v1/voices/add`, { method: 'POST', headers: { 'xi-api-key': key(v.tts.apiKeyEnv, env) }, body: form, signal: AbortSignal.timeout(120_000) });
  await failIfBad(res, 'Copie de la voix impossible');
  const data = await res.json() as { voice_id?: string };
  if (!data.voice_id) throw new Error('ElevenLabs n\'a pas renvoyé d\'identifiant de voix');
  return data.voice_id;
}
