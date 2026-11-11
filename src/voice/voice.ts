// La voix d'Odin : il comprend ce que tu dis (Whisper) et il te répond à voix haute (ElevenLabs,
// ou un service local et gratuit : Piper, ou tout serveur compatible OpenAI /v1/audio/speech).
//
// - Transcription : API compatible OpenAI /audio/transcriptions (OpenAI Whisper, ou un serveur
//   Whisper local comme faster-whisper-server / speaches : aucune clé, rien ne sort de chez toi).
// - Synthèse : ElevenLabs text-to-speech, avec la voix de ton choix ou une voix copiée à partir
//   d'un enregistrement (clonage instantané), seulement avec l'accord de la personne.
// Aucune dépendance : fetch + FormData de Node.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OdinConfig } from '../config.ts';
import { convertMedia } from '../files/media.ts';
import { hasCommand } from '../learn/environment.ts';
import { ensureLocalVoice, hearLocal, localPiper, localWhisper, speakLocal, type Heard } from './local.ts';

export type VoiceConfig = OdinConfig['voice'];

const key = (env: string, e: NodeJS.ProcessEnv = process.env) => e[env] ?? '';
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u);

/** Un service de transcription en ligne ou local est-il utilisable ? (Une clé OpenAI suffit, sans rien cocher.) */
function remoteStt(v: VoiceConfig, env = process.env): boolean { return Boolean(key(v.stt.apiKeyEnv, env)) || (v.enabled && isLocal(v.stt.baseUrl)); }
/** La transcription est-elle utilisable (clé présente, serveur local, ou Whisper installé sur la machine) ? */
export function sttReady(v: VoiceConfig, env = process.env): boolean { return remoteStt(v, env) || Boolean(localWhisper()); }

/** Qui prévenir quand Odin s'installe tout seul pour comprendre les vocaux (branché par la passerelle). */
let notifyVoice: ((msg: string) => void) | undefined;
export function setVoiceNotifier(fn: (msg: string) => void): void { notifyVoice = fn; }

/** Langue parlée dans les derniers vocaux (texte reconnu → code langue), pour répondre dans la même langue. */
const spoken = new Map<string, string>();
export function spokenLanguage(text: string): string | undefined { return spoken.get(text.trim()); }
const remember = (h: Heard) => { if (h.text) { spoken.set(h.text.trim(), h.language); if (spoken.size > 100) spoken.delete(spoken.keys().next().value!); } return h; };
/** Nom de la langue en français (pour la consigne de réponse). */
export const LANG_NAME: Record<string, string> = { fr: 'français', en: 'anglais', es: 'espagnol', pt: 'portugais', de: 'allemand', it: 'italien', ar: 'arabe', sw: 'swahili', nl: 'néerlandais', ru: 'russe', tr: 'turc', zh: 'chinois', pl: 'polonais', mg: 'malgache', ja: 'japonais', ko: 'coréen', hi: 'hindi' };
const NAME_CODE: Record<string, string> = { french: 'fr', english: 'en', spanish: 'es', portuguese: 'pt', german: 'de', italian: 'it', arabic: 'ar', swahili: 'sw', dutch: 'nl', russian: 'ru', turkish: 'tr', chinese: 'zh', polish: 'pl', malagasy: 'mg', japanese: 'ja', korean: 'ko', hindi: 'hi' };

/** Langue probable d'un texte écrit (mots courants), pour choisir la voix. Pur. */
export function guessLang(text: string): string {
  if (/[\u0600-\u06ff]/.test(text)) return 'ar';
  if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';
  const w = ` ${text.toLowerCase().replace(/[^\p{L}' ]+/gu, ' ')} `;
  const score = (words: string[]) => words.reduce((n, x) => n + (w.split(` ${x} `).length - 1), 0);
  const c: Record<string, number> = {
    fr: score(['le', 'la', 'les', 'est', 'et', 'je', 'tu', 'pas', 'que', 'pour', 'une', 'des', 'du', 'avec', 'sur', 'c\'est', 'il', 'vous']),
    en: score(['the', 'is', 'and', 'you', 'to', 'of', 'it', 'that', 'for', 'with', 'are', 'this', 'i', 'have', 'what', 'can']),
    es: score(['el', 'los', 'es', 'y', 'que', 'para', 'con', 'por', 'una', 'del', 'está', 'como', 'pero', 'yo', 'tú']),
    pt: score(['o', 'os', 'é', 'e', 'que', 'para', 'com', 'não', 'uma', 'do', 'da', 'você', 'está', 'eu']),
    de: score(['der', 'die', 'das', 'ist', 'und', 'ich', 'nicht', 'mit', 'für', 'ein', 'eine', 'du', 'sie']),
    it: score(['il', 'lo', 'è', 'e', 'che', 'per', 'con', 'non', 'una', 'sono', 'della', 'io', 'tu']),
    sw: score(['na', 'ya', 'wa', 'ni', 'kwa', 'za', 'la', 'hii', 'sana', 'nini', 'mimi', 'wewe', 'habari']),
  };
  const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= 2 ? best[0] : 'fr';
}
/** Le fournisseur de synthèse choisi est-il prêt (sans compter Piper installé sur la machine) ? */
function providerReady(v: VoiceConfig, env = process.env): boolean {
  if (v.tts.provider === 'piper') return Boolean(v.tts.baseUrl) && v.tts.baseUrl !== 'local';
  if (v.tts.provider === 'openai') return (Boolean(key(v.tts.apiKeyEnv, env)) || isLocal(v.tts.baseUrl)) && Boolean(v.tts.voiceId);
  return Boolean(key(v.tts.apiKeyEnv, env)) && Boolean(v.tts.voiceId);
}
/** La synthèse est-elle utilisable ? Le fournisseur choisi (voix activée), ou Piper installé sur la machine (rien à cocher). */
export function ttsReady(v: VoiceConfig, env = process.env): boolean {
  return (v.enabled && providerReady(v, env)) || Boolean(localPiper());
}
/** Est-ce que la voix reste entièrement sur la machine (rien n'est envoyé à un service en ligne) ? */
export function ttsIsLocal(v: VoiceConfig): boolean { return (v.tts.provider === 'piper' && v.tts.baseUrl === 'local') || (v.tts.provider !== 'elevenlabs' && isLocal(v.tts.baseUrl)); }
/** Adresse par défaut de chaque fournisseur de synthèse. */
export const TTS_DEFAULTS: Record<VoiceConfig['tts']['provider'], { baseUrl: string; model: string; voiceId: string; apiKeyEnv: string }> = {
  elevenlabs: { baseUrl: 'https://api.elevenlabs.io', model: 'eleven_multilingual_v2', voiceId: '', apiKeyEnv: 'ELEVENLABS_API_KEY' },
  piper: { baseUrl: 'http://localhost:5000', model: '', voiceId: '', apiKeyEnv: '' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voiceId: 'onyx', apiKeyEnv: 'OPENAI_API_KEY' },
};

async function failIfBad(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = (await res.text().catch(() => '')).slice(0, 300);
  throw new Error(`${what} : HTTP ${res.status}${body ? ` — ${body}` : ''}`);
}

const extFor = (mime: string) => /ogg|opus/.test(mime) ? 'ogg' : /webm/.test(mime) ? 'webm' : /mp4|m4a|aac/.test(mime) ? 'm4a' : /wav/.test(mime) ? 'wav' : /mpeg|mp3/.test(mime) ? 'mp3' : 'webm';

/** Whisper : audio → texte. */
export async function transcribe(audio: Uint8Array, mime: string, v: VoiceConfig, signal?: AbortSignal, env = process.env): Promise<string> {
  return (await hear(audio, mime, v, signal, env)).text;
}

/**
 * Audio → texte horodaté + langue parlée. Ordre : service configuré (une clé OpenAI suffit), sinon
 * Whisper sur la machine, sinon Odin l'installe lui-même (prévient, puis répond au vocal une fois prêt).
 * La langue est détectée toute seule : Odin répond dans la langue que tu parles.
 */
export async function hear(audio: Uint8Array | { file: string }, mime: string, v: VoiceConfig, signal?: AbortSignal, env = process.env): Promise<Heard> {
  const bytes = 'file' in audio ? undefined : audio;
  if (bytes && bytes.byteLength === 0) throw new Error('enregistrement vide');
  const big = 'file' in audio || (bytes?.byteLength ?? 0) > 24 * 1024 * 1024;
  const local = (a: typeof audio) => hearLocal(a, v.stt.language || 'auto', undefined, big ? 3 * 3600_000 : 300_000).then(remember);
  if (remoteStt(v, env) && !big) {
    try { return remember(await hearRemote(bytes!, mime, v, signal, env)); } catch (e) {
      if (localWhisper()) return local(audio); // service en panne : on se débrouille seul
      throw e;
    }
  }
  if (localWhisper()) return local(audio);
  // Rien de prêt : Odin s'installe lui-même (une fois), puis écoute.
  const ok = await ensureLocalVoice(notifyVoice);
  if (ok && localWhisper()) return local(audio);
  throw new Error('Je n\'ai pas réussi à installer l\'écoute des vocaux sur ma machine (il faut git, cmake, un compilateur et ffmpeg). Ajoute une clé OpenAI dans Réglages → Voix, ou dis-moi « installe la voix locale » pour voir l\'erreur.');
}

async function hearRemote(audio: Uint8Array, mime: string, v: VoiceConfig, signal?: AbortSignal, env = process.env): Promise<Heard> {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime || 'audio/webm' }), `parole.${extFor(mime)}`);
  form.append('model', v.stt.model);
  // Pas de langue imposée (sauf réglage autre que le français par défaut) : elle est détectée.
  if (v.stt.language && v.stt.language !== 'fr' && v.stt.language !== 'auto') form.append('language', v.stt.language);
  const verbose = v.stt.model === 'whisper-1' || !/gpt-4o/.test(v.stt.model);
  form.append('response_format', verbose ? 'verbose_json' : 'json');
  if (verbose) form.append('timestamp_granularities[]', 'segment');
  const k = key(v.stt.apiKeyEnv, env);
  const res = await fetch(`${v.stt.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST', body: form, headers: k ? { authorization: `Bearer ${k}` } : {},
    signal: signal ?? AbortSignal.timeout(300_000),
  });
  await failIfBad(res, 'Transcription impossible');
  const data = await res.json() as { text?: string; language?: string; segments?: Array<{ start: number; end: number; text: string }> };
  const text = (data.text ?? '').trim();
  const l = (data.language ?? '').toLowerCase();
  return { text, language: NAME_CODE[l] ?? (l.length === 2 ? l : guessLang(text)), segments: (data.segments ?? []).map((x) => ({ start: x.start, end: x.end, text: x.text.trim() })).filter((x) => x.text) };
}

export type AudioFormat = 'mp3_44100_128' | 'opus_48000_64';
export interface SpeechAudio { data: Uint8Array; mime: string }

/** Texte → audio (mp3 pour le navigateur, opus pour les notes vocales Telegram), selon le fournisseur choisi. */
export async function speakAudio(text: string, v: VoiceConfig, format: AudioFormat = 'mp3_44100_128', signal?: AbortSignal, env = process.env, lang?: string): Promise<SpeechAudio> {
  const clean = forSpeech(text);
  if (!clean) throw new Error('rien à dire');
  const language = lang ?? guessLang(clean);
  // Piper sur la machine : choisi (« local »), ou à défaut d'un autre fournisseur prêt.
  if (localPiper() && ((v.tts.provider === 'piper' && (!v.tts.baseUrl || v.tts.baseUrl === 'local')) || !providerReady(v, env))) {
    // Voix de secours locale : on garde le genre choisi (homme « tom », femme « siwis »).
    const g = (v as VoiceConfig & { gender?: string }).gender === 'femme' || /siwis/.test(v.tts.voiceId) ? 'femme' : 'homme';
    return { data: await speakLocal(clean, undefined, g, language), mime: 'audio/wav' };
  }
  const base = v.tts.baseUrl.replace(/\/$/, '');
  const sig = signal ?? AbortSignal.timeout(90_000);
  if (v.tts.provider === 'piper') {
    // Serveur HTTP de Piper (python3 -m piper.http_server --model fr_FR-tom-medium) : renvoie du WAV.
    const body: Record<string, unknown> = { text: clean };
    if (v.tts.voiceId) body.voice = v.tts.voiceId;
    let res = await fetch(`${base}/`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'audio/wav' }, body: JSON.stringify(body), signal: sig });
    if (!res.ok && res.status < 500) res = await fetch(`${base}/?text=${encodeURIComponent(clean.slice(0, 1500))}`, { signal: sig }); // anciennes versions
    await failIfBad(res, 'Piper : synthèse impossible');
    return { data: new Uint8Array(await res.arrayBuffer()), mime: 'audio/wav' };
  }
  if (v.tts.provider === 'openai') {
    // OpenAI /v1/audio/speech, ou un serveur local compatible (Kokoro, openedai-speech, speaches…).
    const k = key(v.tts.apiKeyEnv, env);
    const fmt = format === 'opus_48000_64' ? 'opus' : 'mp3';
    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST', headers: { ...(k ? { authorization: `Bearer ${k}` } : {}), 'content-type': 'application/json' },
      body: JSON.stringify({ model: v.tts.model || 'tts-1', input: clean, voice: v.tts.voiceId || 'onyx', response_format: fmt }), signal: sig,
    });
    await failIfBad(res, 'Synthèse vocale impossible');
    return { data: new Uint8Array(await res.arrayBuffer()), mime: fmt === 'opus' ? 'audio/ogg' : 'audio/mpeg' };
  }
  if (!v.tts.voiceId) throw new Error('aucune voix choisie (Réglages → Voix)');
  const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(v.tts.voiceId)}?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': key(v.tts.apiKeyEnv, env), 'content-type': 'application/json', accept: 'audio/*' },
    body: JSON.stringify({ text: clean, model_id: v.tts.model }),
    signal: sig,
  });
  await failIfBad(res, 'Synthèse vocale impossible');
  return { data: new Uint8Array(await res.arrayBuffer()), mime: format === 'opus_48000_64' ? 'audio/ogg' : 'audio/mpeg' };
}
/** Comme speakAudio, données seules (compatibilité). */
export async function speak(text: string, v: VoiceConfig, format: AudioFormat = 'mp3_44100_128', signal?: AbortSignal, env = process.env): Promise<Uint8Array> {
  return (await speakAudio(text, v, format, signal, env)).data;
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

/** Note vocale Telegram : il faut de l'Ogg/Opus. Le WAV de Piper est converti avec ffmpeg s'il est là ; sinon on envoie tel quel. */
export async function toVoiceNote(a: SpeechAudio): Promise<Uint8Array> {
  if (a.mime === 'audio/ogg' || !hasCommand('ffmpeg')) return a.data;
  const dir = mkdtempSync(join(tmpdir(), 'odin-voix-'));
  try {
    const src = join(dir, a.mime === 'audio/wav' ? 'in.wav' : 'in.mp3'), out = join(dir, 'out.ogg');
    writeFileSync(src, a.data);
    await convertMedia(src, out, { audioCodec: 'libopus', audioBitrate: '48k' }, undefined, 120_000);
    return new Uint8Array(readFileSync(out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
