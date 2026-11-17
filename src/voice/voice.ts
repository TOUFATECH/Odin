// La voix d'Odin, après le retrait des modèles d'autrui (décision du propriétaire, 17/11/2026).
//
// Odin n'écoute plus et ne parle plus par des modèles qui ne sont pas les siens : ni service en ligne (ElevenLabs,
// OpenAI), ni Whisper ou Piper sur la machine, ni copie de voix. Aucun appel ne part d'ici. Écouter, parler et copier
// une voix répondent « pas encore », dans la langue de la personne, tant que les modèles d'écoute et de voix d'Odin ne
// sont pas entraînés. Restent les outils sans modèle : la préparation d'un texte à dire (dire.ts), la prononciation,
// la reconnaissance du format d'un son, la conversion d'un son en note vocale (ffmpeg), la langue probable d'un texte.

import { pourLaVoix } from './dire.ts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OdinConfig } from '../config.ts';
import { convertMedia } from '../files/media.ts';
import { hasCommand } from '../learn/environment.ts';
import { ModelePasEntraine, pasEntraine } from '../langue/pas-entraine.ts';
import type { Heard } from './local.ts';

export type VoiceConfig = OdinConfig['voice'];

const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u);

/** L'écoute n'est jamais prête : le modèle d'écoute d'Odin n'est pas encore entraîné (aucune clé ni programme n'y change rien). */
export function sttReady(_v: VoiceConfig, _env = process.env): boolean { return false; }

/** Langue parlée dans les derniers vocaux : aucune, tant qu'Odin n'écoute pas (gardé pour la passerelle). */
export function spokenLanguage(_text: string): string | undefined { return undefined; }
/** Nom de la langue en français (pour la consigne de réponse). */
export const LANG_NAME: Record<string, string> = { fr: 'français', en: 'anglais', es: 'espagnol', pt: 'portugais', de: 'allemand', it: 'italien', ar: 'arabe', sw: 'swahili', nl: 'néerlandais', ru: 'russe', tr: 'turc', zh: 'chinois', pl: 'polonais', mg: 'malgache', ja: 'japonais', ko: 'coréen', hi: 'hindi' };

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
/** Aucun fournisseur de voix n'est prêt : Odin ne parle plus par un modèle d'autrui. */
export function providerReady(_v: VoiceConfig, _env = process.env): boolean { return false; }
/** La voix n'est jamais prête : le modèle de voix d'Odin n'est pas encore entraîné. */
export function ttsReady(_v: VoiceConfig, _env = process.env): boolean { return false; }
/** Est-ce que la voix reste entièrement sur la machine (rien n'est envoyé à un service en ligne) ? */
export function ttsIsLocal(v: VoiceConfig): boolean { return Boolean(v.localOnly) || (v.tts.provider === 'piper' && v.tts.baseUrl === 'local') || (v.tts.provider !== 'elevenlabs' && isLocal(v.tts.baseUrl)); }
/** Adresse par défaut de chaque fournisseur de synthèse. */
export const TTS_DEFAULTS: Record<VoiceConfig['tts']['provider'], { baseUrl: string; model: string; voiceId: string; apiKeyEnv: string }> = {
  elevenlabs: { baseUrl: 'https://api.elevenlabs.io', model: 'eleven_multilingual_v2', voiceId: '', apiKeyEnv: 'ELEVENLABS_API_KEY' },
  // « local » : le Piper qu'Odin installe sur sa machine (une adresse http://… vise un serveur Piper lancé à part).
  piper: { baseUrl: 'local', model: '', voiceId: 'fr_FR-tom-medium', apiKeyEnv: '' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voiceId: 'onyx', apiKeyEnv: 'OPENAI_API_KEY' },
};

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
export type AudioFormat = 'mp3_44100_128' | 'opus_48000_64';
export interface SpeechAudio { data: Uint8Array; mime: string }

/** Audio → texte : pas encore (le modèle d'écoute d'Odin n'est pas entraîné). */
export async function transcribe(audio: Uint8Array, mime: string, v: VoiceConfig, signal?: AbortSignal, env = process.env): Promise<string> {
  return (await hear(audio, mime, v, signal, env)).text;
}

/** Audio → texte horodaté et langue parlée : pas encore. Rien n'est envoyé ni lancé, l'audio n'est pas gardé. */
export async function hear(audio: Uint8Array | { file: string }, _mime: string, v: VoiceConfig, _signal?: AbortSignal, _env = process.env): Promise<Heard> {
  if (!('file' in audio) && audio.byteLength === 0) throw new Error('enregistrement vide');
  throw new ModelePasEntraine('ecouter', v.stt?.language);
}

/** Texte → son : pas encore. Rien n'est envoyé ni lancé. */
export async function speakAudio(text: string, v: VoiceConfig, _format: AudioFormat = 'mp3_44100_128', _signal?: AbortSignal, _env = process.env, lang?: string): Promise<SpeechAudio> {
  if (!text.trim()) throw new Error('rien à dire');
  throw new ModelePasEntraine('parler', lang ?? v.stt?.language);
}
/** Comme speakAudio, données seules (compatibilité). */
export async function speak(text: string, v: VoiceConfig, format: AudioFormat = 'mp3_44100_128', signal?: AbortSignal, env = process.env): Promise<Uint8Array> {
  return (await speakAudio(text, v, format, signal, env)).data;
}

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

/**
 * Le texte écrit pour l'écran, préparé pour être DIT : aucun symbole lu, nombres, heures, unités et sigles dits comme
 * on les dit, petites pauses, listes « d'abord…, ensuite…, enfin… » (tout le détail : dire.ts). `lang` : la langue du
 * texte si elle est connue (sinon devinée) ; `lexicon` : tes prononciations, appliquées avant d'épeler les sigles.
 */
export function forSpeech(text: string, lang?: string, lexicon?: Record<string, string>): string {
  const t = pourLaVoix(lexicon && Object.keys(lexicon).length ? pronounce(text, lexicon) : text, lang ?? guessLang(text.replace(/```[\s\S]*?```|https?:\/\/\S+/g, ' ')));
  if (t.length <= 2500) return t;
  // Trop long : on s'arrête à la fin d'une phrase, jamais au milieu d'un mot (la suite reste à l'écran).
  const cut = t.slice(0, 2500), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('… '));
  return end > 1200 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : 2500);
}

export interface VoiceInfo {
  id: string; name: string; category: string;
  /** Voix d'homme ou de femme, quand le service le dit (étiquette « gender » d'ElevenLabs). */
  genre?: 'homme' | 'femme';
  /** Voix dont la langue d'origine est le français (étiquette « language » ou accent français), quand le service le dit. */
  francaise?: boolean;
}

/** Une voix française du bon genre parmi celles données (il n'y en a plus aucune à demander à un service). Pur. */
export function voixFrancaise(voices: VoiceInfo[], genre: 'homme' | 'femme'): VoiceInfo | undefined {
  return voices.find((v) => v.francaise && v.genre === genre);
}

/** Plus aucune liste de voix à demander : aucun service de voix n'est appelé. */
export async function listVoices(_v: VoiceConfig, _env = process.env): Promise<VoiceInfo[]> { return []; }

/** La copie de voix n'est plus possible : « pas encore » (elle reviendra avec le modèle de voix d'Odin). */
export function cloneBlocked(v: VoiceConfig, _env = process.env): string { return pasEntraine('copierVoix', v.stt?.language); }

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
