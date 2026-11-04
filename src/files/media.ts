// Vidéo, audio et images : informations et conversions avec ffmpeg / ffprobe s'ils sont installés.
// Les arguments sont passés en tableau (jamais par un shell) : pas d'injection possible par un nom de fichier.

import { spawn, spawnSync } from 'node:child_process';
import { hasCommand } from '../learn/environment.ts';

export const FFMPEG_HINT = 'ffmpeg est introuvable. Installe-le : macOS « brew install ffmpeg », Windows « winget install Gyan.FFmpeg », Linux « sudo apt install ffmpeg ».';

export interface MediaInfo { format: string; durationSec: number; sizeKo: number; streams: string[] }

export function mediaInfo(path: string): MediaInfo {
  if (!hasCommand('ffprobe')) throw new Error(FFMPEG_HINT);
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffprobe : ${r.stderr.trim().slice(0, 300) || 'fichier illisible'}`);
  const j = JSON.parse(r.stdout) as { format?: { format_long_name?: string; duration?: string; size?: string }; streams?: Array<Record<string, unknown>> };
  const streams = (j.streams ?? []).map((s) => {
    if (s.codec_type === 'video') return `vidéo ${s.codec_name} ${s.width}×${s.height}${s.r_frame_rate ? ` à ${fps(String(s.r_frame_rate))} i/s` : ''}`;
    if (s.codec_type === 'audio') return `audio ${s.codec_name} ${s.sample_rate} Hz, ${s.channels} canal(aux)`;
    return `${s.codec_type} ${s.codec_name}`;
  });
  return { format: j.format?.format_long_name ?? '?', durationSec: Number(j.format?.duration ?? 0), sizeKo: Math.round(Number(j.format?.size ?? 0) / 1024), streams };
}
const fps = (r: string) => { const [a, b] = r.split('/').map(Number); return b ? Math.round((a / b) * 100) / 100 : a; };

export interface ConvertOptions {
  /** Début (secondes ou HH:MM:SS) et durée, pour découper. */
  start?: string;
  duration?: string;
  /** Largeur en pixels (la hauteur suit les proportions). */
  width?: number;
  /** Garder seulement le son (ex. sortie .mp3 depuis une vidéo). */
  audioOnly?: boolean;
  /** Retirer le son. */
  mute?: boolean;
  /** Une seule image à cet instant (miniature : sortie .jpg/.png). */
  frameAt?: string;
  /** Qualité : 'standard' (rapide) ou 'haute'. */
  quality?: 'standard' | 'haute';
  /** Codec et débit audio forcés (ex. libopus 48k pour une note vocale). */
  audioCodec?: string;
  audioBitrate?: string;
}

const TIME = /^\d+(?:\.\d+)?$|^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** Construit les arguments ffmpeg (pur, testable). */
export function ffmpegArgs(input: string, output: string, o: ConvertOptions = {}): string[] {
  for (const [k, v] of [['start', o.start], ['duration', o.duration], ['frameAt', o.frameAt]] as const) if (v !== undefined && !TIME.test(v)) throw new Error(`${k} : un temps en secondes ou HH:MM:SS`);
  if (o.width !== undefined && (!Number.isInteger(o.width) || o.width < 16 || o.width > 8192)) throw new Error('largeur entre 16 et 8192 pixels');
  const a = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (o.frameAt) a.push('-ss', o.frameAt);
  else if (o.start) a.push('-ss', o.start);
  a.push('-i', input);
  if (o.duration && !o.frameAt) a.push('-t', o.duration);
  if (o.frameAt) a.push('-frames:v', '1');
  if (o.width) a.push('-vf', `scale=${o.width}:-2`);
  if (o.audioOnly) a.push('-vn');
  if (o.mute) a.push('-an');
  if (o.audioCodec) { if (!/^[a-z0-9_]+$/i.test(o.audioCodec)) throw new Error('codec audio invalide'); a.push('-c:a', o.audioCodec); }
  if (o.audioBitrate) { if (!/^\d{1,4}k$/.test(o.audioBitrate)) throw new Error('débit audio invalide (ex. 48k)'); a.push('-b:a', o.audioBitrate); }
  if (/\.(mp4|mov|mkv|webm)$/i.test(output) && !o.audioOnly) a.push('-preset', o.quality === 'haute' ? 'slow' : 'veryfast');
  a.push(output);
  return a;
}

/** Lance ffmpeg ; l'abandon (bouton Arrêter) interrompt la conversion. */
export function convertMedia(input: string, output: string, o: ConvertOptions, signal?: AbortSignal, timeoutMs = 30 * 60_000): Promise<void> {
  if (!hasCommand('ffmpeg')) return Promise.reject(new Error(FFMPEG_HINT));
  const args = ffmpegArgs(input, output, o);
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, signal, timeout: timeoutMs });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg : ${err.trim() || `code ${code}`}`))));
  });
}

export const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
