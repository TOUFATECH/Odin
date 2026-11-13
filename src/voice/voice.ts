// La voix d'Odin : il comprend ce que tu dis (Whisper) et il te répond à voix haute (ElevenLabs,
// ou un service local et gratuit : Piper, ou tout serveur compatible OpenAI /v1/audio/speech).
//
// - Transcription : API compatible OpenAI /audio/transcriptions (OpenAI Whisper, ou un serveur
//   Whisper local comme faster-whisper-server / speaches : aucune clé, rien ne sort de chez toi).
// - Synthèse : ElevenLabs text-to-speech, avec la voix de ton choix ou une voix copiée à partir
//   d'un enregistrement (clonage instantané), seulement avec l'accord de la personne.
// Aucune dépendance : fetch + FormData de Node.

import { applyMots, mots, prompt } from './mots.ts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OdinConfig } from '../config.ts';
import { convertMedia } from '../files/media.ts';
import { hasCommand } from '../learn/environment.ts';
import { GENDER_VOICES } from '../profiles.ts';
import { ensureLocalVoice, hearLocal, localPiper, localWhisper, speakLocal, type Heard, lastVoiceFailure, voiceBlocked } from './local.ts';

export type VoiceConfig = OdinConfig['voice'];

const key = (env: string, e: NodeJS.ProcessEnv = process.env) => e[env] ?? '';
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u);

/** Un service de transcription en ligne ou local est-il utilisable ? (Une clé OpenAI suffit, sans rien cocher.) */
function remoteStt(v: VoiceConfig, env = process.env): boolean { return !v.localOnly && (Boolean(key(v.stt.apiKeyEnv, env)) || (v.enabled && isLocal(v.stt.baseUrl))); }
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
/**
 * La voix d'un service en ligne : celle qui est réglée, sinon sa voix d'homme ou de femme prête à l'emploi
 * (ElevenLabs : Daniel ou Charlotte ; OpenAI : onyx ou nova). Une clé suffit donc pour qu'il parle.
 */
function serviceVoice(v: VoiceConfig): string {
  const d = GENDER_VOICES[v.tts.provider] ?? { homme: '', femme: '' };
  return v.tts.voiceId || (v.gender === 'femme' ? v.femaleVoiceId || d.femme : d.homme);
}
/** Le fournisseur de synthèse choisi est-il prêt (sans compter Piper installé sur la machine) ? */
function providerReady(v: VoiceConfig, env = process.env): boolean {
  if (v.localOnly) return false; // 100 % local : seul Piper sur la machine parle
  if (v.tts.provider === 'piper') return Boolean(v.tts.baseUrl) && v.tts.baseUrl !== 'local';
  if (v.tts.provider === 'openai') return (Boolean(key(v.tts.apiKeyEnv, env)) || isLocal(v.tts.baseUrl)) && Boolean(serviceVoice(v));
  return Boolean(key(v.tts.apiKeyEnv, env)) && Boolean(serviceVoice(v));
}
/** La synthèse est-elle utilisable ? Le fournisseur choisi (voix activée), ou Piper installé sur la machine (rien à cocher). */
export function ttsReady(v: VoiceConfig, env = process.env): boolean {
  return (v.enabled && providerReady(v, env)) || Boolean(localPiper());
}
/** Est-ce que la voix reste entièrement sur la machine (rien n'est envoyé à un service en ligne) ? */
export function ttsIsLocal(v: VoiceConfig): boolean { return Boolean(v.localOnly) || (v.tts.provider === 'piper' && v.tts.baseUrl === 'local') || (v.tts.provider !== 'elevenlabs' && isLocal(v.tts.baseUrl)); }
/** Adresse par défaut de chaque fournisseur de synthèse. */
export const TTS_DEFAULTS: Record<VoiceConfig['tts']['provider'], { baseUrl: string; model: string; voiceId: string; apiKeyEnv: string }> = {
  elevenlabs: { baseUrl: 'https://api.elevenlabs.io', model: 'eleven_multilingual_v2', voiceId: '', apiKeyEnv: 'ELEVENLABS_API_KEY' },
  // « local » : le Piper qu'Odin installe sur sa machine (une adresse http://… vise un serveur Piper lancé à part).
  piper: { baseUrl: 'local', model: '', voiceId: 'fr_FR-tom-medium', apiKeyEnv: '' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voiceId: 'onyx', apiKeyEnv: 'OPENAI_API_KEY' },
};

/** Retire une clé d'un texte (un service peut la répéter dans sa réponse) : elle n'apparaît dans aucun message ni journal. */
export function scrub(text: string, ...secrets: string[]): string {
  return secrets.filter((x) => x && x.length >= 6).reduce((t, x) => t.split(x).join('[clé masquée]'), text);
}
/** Ce que le service a répondu, en clair : son message s'il en donne un, sinon le début de sa réponse. */
function serviceSays(body: string): string {
  try {
    const d = (JSON.parse(body) as { detail?: unknown; error?: unknown; message?: unknown; description?: unknown });
    const x = d.detail ?? d.error ?? d.message ?? d.description;
    if (typeof x === 'string') return x;
    if (Array.isArray(x)) return x.map((e) => (e && typeof e === 'object' && 'msg' in e ? String((e as { msg: unknown }).msg) : String(e))).join(' ; ');
    if (x && typeof x === 'object' && 'message' in x) return String((x as { message: unknown }).message);
  } catch { /* pas du JSON */ }
  return /^\s*</.test(body) ? '' : body; // une page HTML d'erreur n'apprend rien : on la tait
}
/** Pourquoi un service a refusé, dit simplement (la clé n'est jamais répétée). */
const WHY: Record<number, string> = {
  401: 'la clé est refusée (vérifie-la dans Réglages → Voix)', 402: 'le crédit du compte est épuisé', 403: 'le compte n\'a pas le droit de faire ça (offre trop petite ?)',
  404: 'la voix ou l\'adresse n\'existe pas', 422: 'la demande n\'a pas été acceptée', 429: 'trop de demandes d\'un coup : réessaie dans un instant',
};
async function failIfBad(res: Response, what: string, ...secrets: string[]): Promise<void> {
  if (res.ok) return;
  const said = scrub(serviceSays((await res.text().catch(() => '')).slice(0, 600)).replace(/\s+/g, ' ').trim().slice(0, 300), ...secrets);
  throw new Error(`${what} : ${WHY[res.status] ?? (res.status >= 500 ? 'le service est en panne' : 'demande refusée')} (HTTP ${res.status})${said ? ` — ${said}` : ''}`);
}

export type AudioKind = 'ogg' | 'mp3' | 'wav' | 'm4a' | 'webm' | '';
/** Le vrai format d'un son, lu dans ses premiers octets (on ne se fie pas à ce qu'annonce le service). Pur. */
export function audioKind(b: Uint8Array): AudioKind {
  const at = (i: number, s: string) => s.split('').every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length < 12) return '';
  if (at(0, 'OggS')) return 'ogg';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'wav';
  if (at(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  if (at(4, 'ftyp')) return 'm4a';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return '';
}
const KIND_MIME: Record<Exclude<AudioKind, ''>, string> = { ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', webm: 'audio/webm' };
/** Un son reçu d'un service : son type vient de ses octets ; ce qui n'est pas du son est refusé avec une phrase claire. */
function audioFrom(data: Uint8Array, who: string, fallback: string): SpeechAudio {
  const k = audioKind(data);
  if (k) return { data, mime: KIND_MIME[k] };
  const text = Buffer.from(data.subarray(0, 200)).toString('utf8');
  if (!data.byteLength || /^\s*(<|\{)/.test(text)) throw new Error(`${who} n'a pas renvoyé de son${/^\s*</.test(text) ? ' (une page web à la place : vérifie l\'adresse dans Réglages → Voix)' : ''}`);
  return { data, mime: fallback };
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
  // Tes mots (Écho) : soufflés à Whisper, puis corrigés après — pour la dictée comme pour tout ce que tu dis à Odin.
  const words = mots(), fix = (h: Heard): Heard => (words.length ? { ...h, text: applyMots(h.text, words), segments: h.segments?.map((x) => ({ ...x, text: applyMots(x.text, words) })) } : h);
  const local = (a: typeof audio) => hearLocal(a, v.stt.language || 'auto', undefined, big ? 3 * 3600_000 : 300_000, prompt(words)).then(fix).then(remember);
  if (remoteStt(v, env) && !big) {
    try { return remember(fix(await hearRemote(bytes!, mime, v, signal, env, prompt(words)))); } catch (e) {
      if (localWhisper()) return local(audio); // service en panne : on se débrouille seul
      throw e;
    }
  }
  if (localWhisper()) return local(audio);
  // Rien de prêt : Odin s'installe lui-même (une fois), puis écoute.
  // L'échec est dit une seule fois, ici (la vraie cause, et quoi faire) : pas un message de l'installation plus un second.
  const ok = await ensureLocalVoice(notifyVoice, undefined, { quiet: true });
  if (ok && localWhisper()) return local(audio);
  throw new Error((voiceBlocked() ?? lastVoiceFailure() ?? 'Je n\'ai pas réussi à installer l\'écoute des vocaux sur ma machine (il faut git, cmake, un compilateur et ffmpeg). Ajoute une clé OpenAI dans Réglages → Voix, ou dis-moi « installe la voix locale » pour voir l\'erreur.').replace(/^⚠\s*/, ''));
}

async function hearRemote(audio: Uint8Array, mime: string, v: VoiceConfig, signal?: AbortSignal, env = process.env, hint = ''): Promise<Heard> {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime || 'audio/webm' }), `parole.${extFor(mime)}`);
  form.append('model', v.stt.model);
  if (hint) form.append('prompt', hint);
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
  const clean = pronounce(forSpeech(text), v.speech?.pronunciations);
  if (!clean) throw new Error('rien à dire');
  // 100 % local : Piper sur la machine, installé au besoin ; jamais de service en ligne.
  if (v.localOnly && !localPiper()) {
    const ok = await ensureLocalVoice(notifyVoice, undefined, { quiet: true });
    if (!ok || !localPiper()) throw new Error(voiceBlocked() ?? lastVoiceFailure() ?? 'la voix locale (Piper) n\'est pas encore installée sur ma machine');
  }
  const language = lang ?? guessLang(clean);
  // Piper sur la machine : on garde le genre choisi (homme « tom », femme « siwis »).
  const onMachine = async (): Promise<SpeechAudio> => {
    const g = v.gender === 'femme' || /siwis/.test(v.tts.voiceId) ? 'femme' : 'homme';
    return { data: await speakLocal(clean, undefined, g, language, v.speech?.rate ?? 1), mime: 'audio/wav' };
  };
  // Il est choisi (« local »), ou il prend la place d'un autre fournisseur qui n'est pas prêt.
  if (localPiper() && ((v.tts.provider === 'piper' && (!v.tts.baseUrl || v.tts.baseUrl === 'local')) || !providerReady(v, env))) return onMachine();
  const base = v.tts.baseUrl.replace(/\/$/, '');
  const sig = signal ?? AbortSignal.timeout(90_000);
  if (v.tts.provider === 'piper') {
    // Serveur HTTP de Piper, lancé à part (python3 -m piper.http_server -m fr_FR-tom-medium) : il renvoie du WAV.
    // Version actuelle (piper-tts 1.3 et suivantes) : POST /synthesize, corps JSON { text, voice, length_scale }.
    // Ancienne version (piper-tts 1.2, 2023) : POST / avec le texte tel quel dans le corps (une seule voix, celle du serveur).
    try {
      const scale = Number(Math.min(1.5, Math.max(0.7, 1 / (v.speech?.rate || 1))).toFixed(2));
      let res = await fetch(`${base}/synthesize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: clean, ...(v.tts.voiceId ? { voice: v.tts.voiceId } : {}), ...(scale !== 1 ? { length_scale: scale } : {}) }), signal: sig });
      if (res.status === 404 || res.status === 405) res = await fetch(`${base}/`, { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: clean, signal: sig });
      await failIfBad(res, 'Piper : synthèse impossible');
      return audioFrom(new Uint8Array(await res.arrayBuffer()), 'Le serveur Piper', 'audio/wav');
    } catch (e) {
      // Le serveur Piper ne répond pas (arrêté, mauvaise adresse) : le Piper installé sur la machine prend le relais.
      if (localPiper()) return onMachine();
      throw /fetch failed|ECONNREFUSED|timeout/i.test((e as Error).message) ? new Error(`le serveur Piper ne répond pas à ${base} : lance-le, ou mets « local » comme adresse dans Réglages → Voix pour le Piper installé par Odin`) : e;
    }
  }
  if (v.tts.provider === 'openai') {
    // OpenAI /v1/audio/speech, ou un serveur local compatible (Kokoro, openedai-speech, speaches…).
    const k = key(v.tts.apiKeyEnv, env);
    const fmt = format === 'opus_48000_64' ? 'opus' : 'mp3';
    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST', headers: { ...(k ? { authorization: `Bearer ${k}` } : {}), 'content-type': 'application/json' },
      body: JSON.stringify({ model: v.tts.model || 'tts-1', input: clean, voice: serviceVoice(v) || 'onyx', response_format: fmt }), signal: sig,
    });
    await failIfBad(res, 'Synthèse vocale impossible', k);
    return audioFrom(new Uint8Array(await res.arrayBuffer()), 'Le service de voix', fmt === 'opus' ? 'audio/ogg' : 'audio/mpeg');
  }
  // ElevenLabs : POST /v1/text-to-speech/{voix}?output_format=…, clé dans l'en-tête xi-api-key, corps { text, model_id }.
  const voice = serviceVoice(v);
  if (!voice) throw new Error('aucune voix choisie (Réglages → Voix)');
  const k = key(v.tts.apiKeyEnv, env);
  const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${format}`, {
    method: 'POST',
    headers: { 'xi-api-key': k, 'content-type': 'application/json', accept: 'audio/*' },
    body: JSON.stringify({ text: clean, model_id: v.tts.model || TTS_DEFAULTS.elevenlabs.model }),
    signal: sig,
  });
  await failIfBad(res, 'Synthèse vocale impossible', k);
  return audioFrom(new Uint8Array(await res.arrayBuffer()), 'ElevenLabs', format === 'opus_48000_64' ? 'audio/ogg' : 'audio/mpeg');
}
/** Comme speakAudio, données seules (compatibilité). */
export async function speak(text: string, v: VoiceConfig, format: AudioFormat = 'mp3_44100_128', signal?: AbortSignal, env = process.env): Promise<Uint8Array> {
  return (await speakAudio(text, v, format, signal, env)).data;
}

/** Ce qui se lit mal à voix haute (code, liens, émojis de statut) est retiré ; 2 500 caractères au plus. */
/** Applique le lexique de prononciation (mot entier, sans tenir compte des majuscules) : « Mnémosyne » → « Mné-mo-zine ». */
export function pronounce(text: string, lexicon: Record<string, string> = {}): string {
  let out = text;
  for (const [word, say] of Object.entries(lexicon)) {
    if (!word.trim() || !say.trim()) continue;
    const esc = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), say.trim());
  }
  return out;
}

export function forSpeech(text: string): string {
  const t = text
    .replace(/```[\s\S]*?```/g, ' (code affiché à l\'écran) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/g, 'le lien affiché')
    .replace(/[⚡🛡🧭🔔⛔✅⏰💡🛰📌⚠️🛑]/gu, '')
    .replace(/^\s*[•\-*]\s+/gm, '')
    .replace(/[*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= 2500) return t;
  // Trop long : on s'arrête à la fin d'une phrase, jamais au milieu d'un mot (la suite reste à l'écran).
  const cut = t.slice(0, 2500), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('… '));
  return end > 1200 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : 2500);
}

export interface VoiceInfo { id: string; name: string; category: string }

/** Voix disponibles sur le compte ElevenLabs (prédéfinies et copiées). */
export async function listVoices(v: VoiceConfig, env = process.env): Promise<VoiceInfo[]> {
  // Voix locale (Piper) ou OpenAI : pas de liste à demander à un serveur ; on donne la voix réglée (et celles d'OpenAI).
  if (v.tts.provider === 'openai') return ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'].map((id) => ({ id, name: id, category: 'OpenAI' }));
  if (v.tts.provider !== 'elevenlabs' || !/^https?:\/\//.test(v.tts.baseUrl)) return [{ id: v.tts.voiceId || 'fr_FR-tom-medium', name: v.tts.voiceName || v.tts.voiceId || 'voix locale', category: 'locale (Piper), sur la machine d\'Odin' }];
  // ElevenLabs : GET /v2/voices, par pages de 100 (l'ancien /v1/voices est déprécié : il s'arrête au-delà de 500 voix).
  const base = v.tts.baseUrl.replace(/\/$/, ''), k = key(v.tts.apiKeyEnv, env), out: VoiceInfo[] = [];
  type Page = { voices?: Array<{ voice_id: string; name: string; category?: string }>; has_more?: boolean; next_page_token?: string | null };
  let token = '';
  for (let page = 0; page < 20; page++) {
    let res = await fetch(`${base}/v2/voices?page_size=100&include_total_count=false${token ? `&next_page_token=${encodeURIComponent(token)}` : ''}`, { headers: { 'xi-api-key': k }, signal: AbortSignal.timeout(20_000) });
    // Un serveur compatible plus ancien ne connaît que /v1/voices (tout en une fois).
    const old = page === 0 && (res.status === 404 || res.status === 405);
    if (old) res = await fetch(`${base}/v1/voices`, { headers: { 'xi-api-key': k }, signal: AbortSignal.timeout(20_000) });
    await failIfBad(res, 'Liste des voix indisponible', k);
    const data = await res.json() as Page;
    out.push(...(data.voices ?? []).map((x) => ({ id: x.voice_id, name: x.name, category: x.category ?? '' })));
    if (old || !data.has_more || !data.next_page_token) break;
    token = data.next_page_token;
  }
  // Tes voix copiées d'abord, puis les autres, sans doublon.
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).sort((a, b) => Number(b.category === 'cloned') - Number(a.category === 'cloned'));
}

export interface ClonedVoice { voiceId: string; /** ElevenLabs demande une vérification avant de laisser parler cette voix. */ needsCheck: boolean }
/** Ce qui manque pour copier une voix avec ElevenLabs (rien : c'est possible). La voix ne part jamais en ligne en mode 100 % local. */
export function cloneBlocked(v: VoiceConfig, env = process.env): string | undefined {
  if (v.localOnly) return '« 100 % local » est coché : ta voix ne part pas chez ElevenLabs. Décoche cette case (Réglages → Voix), enregistre, puis recommence.';
  if (v.tts.provider !== 'elevenlabs' || !/^https?:\/\//.test(v.tts.baseUrl)) return 'La copie de voix passe par ElevenLabs : choisis « ElevenLabs » dans « Qui parle », enregistre, puis recommence.';
  if (!key(v.tts.apiKeyEnv, env)) return 'Il manque ta clé ElevenLabs : enregistre-la dans Réglages → Voix, puis recommence.';
  return undefined;
}
/**
 * Copie une voix à partir d'enregistrements (clonage instantané ElevenLabs : POST /v1/voices/add).
 * `consent` doit être vrai : la voix est la tienne, ou la personne a donné son accord (noté avant l'envoi, voir accords.ts).
 */
export async function cloneVoice(name: string, samples: Array<{ data: Uint8Array; mime: string; filename: string }>, consent: boolean, v: VoiceConfig, env = process.env): Promise<ClonedVoice> {
  if (!consent) throw new Error('copie refusée : confirme que c\'est ta voix ou que la personne a donné son accord');
  const n = name.trim().slice(0, 60);
  if (!n) throw new Error('donne un nom à la voix');
  if (!samples.length || samples.some((s) => !s.data.byteLength)) throw new Error('ajoute au moins un enregistrement (une minute de parole claire suffit)');
  const blocked = cloneBlocked(v, env); if (blocked) throw new Error(blocked);
  const k = key(v.tts.apiKeyEnv, env);
  const form = new FormData();
  form.append('name', n);
  form.append('description', 'Voix copiée pour Odin, avec consentement');
  form.append('remove_background_noise', 'true');
  for (const s of samples) form.append('files', new Blob([s.data], { type: s.mime || 'audio/mpeg' }), s.filename || 'echantillon.mp3');
  const res = await fetch(`${v.tts.baseUrl.replace(/\/$/, '')}/v1/voices/add`, { method: 'POST', headers: { 'xi-api-key': k }, body: form, signal: AbortSignal.timeout(120_000) });
  await failIfBad(res, 'Copie de la voix impossible', k);
  const data = await res.json() as { voice_id?: string; requires_verification?: boolean };
  if (!data.voice_id || !/^[A-Za-z0-9_.-]{1,80}$/.test(data.voice_id)) throw new Error('ElevenLabs n\'a pas renvoyé d\'identifiant de voix');
  return { voiceId: data.voice_id, needsCheck: data.requires_verification === true };
}

/** Efface une voix copiée chez ElevenLabs (DELETE /v1/voices/{voix}) : ses enregistrements partent avec elle. Déjà effacée = réussi. */
export async function removeVoice(voiceId: string, v: VoiceConfig, env = process.env): Promise<void> {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(voiceId)) throw new Error('identifiant de voix invalide');
  // Même si un autre service parle aujourd'hui (Piper…), la voix copiée est chez ElevenLabs : on l'efface là-bas.
  const el = v.tts.provider === 'elevenlabs' && /^https?:\/\//.test(v.tts.baseUrl) ? { base: v.tts.baseUrl, keyEnv: v.tts.apiKeyEnv } : { base: TTS_DEFAULTS.elevenlabs.baseUrl, keyEnv: TTS_DEFAULTS.elevenlabs.apiKeyEnv };
  const k = key(el.keyEnv, env); if (!k) throw new Error('il manque ta clé ElevenLabs (Réglages → Voix)');
  const res = await fetch(`${el.base.replace(/\/$/, '')}/v1/voices/${encodeURIComponent(voiceId)}`, { method: 'DELETE', headers: { 'xi-api-key': k }, signal: AbortSignal.timeout(30_000) });
  // Elle n'y est déjà plus (effacée depuis elevenlabs.io) : c'est ce qu'on voulait.
  if (res.status === 404 || (res.status === 400 && /does[_ ]not[_ ]exist|not[_ ]found/i.test(await res.clone().text().catch(() => '')))) return;
  await failIfBad(res, 'Effacement de la voix impossible', k);
}

/**
 * Note vocale Telegram : il faut de l'Ogg/Opus (Telegram accepte aussi le MP3 et le M4A). Le WAV de Piper est
 * converti avec ffmpeg ; sans ffmpeg, le son part tel quel et le canal l'envoie comme un fichier son.
 */
export async function toVoiceNote(a: SpeechAudio): Promise<Uint8Array> {
  const kind = audioKind(a.data) || (/ogg/.test(a.mime) ? 'ogg' : /wav/.test(a.mime) ? 'wav' : 'mp3');
  if (kind === 'ogg' || !hasCommand('ffmpeg')) return a.data;
  const dir = mkdtempSync(join(tmpdir(), 'odin-voix-'));
  try {
    const src = join(dir, `in.${kind}`), out = join(dir, 'out.ogg');
    writeFileSync(src, a.data);
    // Une voix : un seul canal, 48 kHz (ce que Telegram attend pour afficher une note vocale).
    await convertMedia(src, out, { audioOnly: true, audioCodec: 'libopus', audioBitrate: '48k' }, undefined, 120_000);
    return new Uint8Array(readFileSync(out));
  } catch (e) {
    // Conversion impossible (son abîmé) : MP3 et M4A passent quand même en note vocale ; pour le reste, on le dit.
    if (kind === 'mp3' || kind === 'm4a') return a.data;
    throw new Error(`je n'ai pas pu préparer la note vocale (${(e as Error).message.slice(0, 160)})`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
