// Vidéo, audio et images : informations et conversions.
// Les informations d'un média se lisent sur la machine, sans programme (src/medias) ; ffprobe complète seulement les
// formats que le socle ne lit pas. Les conversions passent par ffmpeg s'il est installé.
// Les arguments sont passés en tableau (jamais par un shell) : pas d'injection possible par un nom de fichier.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { hasCommand } from '../learn/environment.ts';
import { wrapUntrusted } from '../heimdall/injection.ts';
import { cleSensible, ressembleACoordonnees } from '../medias/champs.ts';
import type { Fiche } from '../medias/contrat.ts';
import { ficheEnLignes, ligneDePiste, lireMetadonnees } from '../medias/metadonnees.ts';
import { bornerGraphemes, pourAffichage } from '../medias/octets.ts';
import { entreeFfmpeg } from './ffmpeg-entree.ts';

export const FFMPEG_HINT = 'ffmpeg est introuvable. Installe-le : macOS « brew install ffmpeg », Windows « winget install Gyan.FFmpeg », Linux « sudo apt install ffmpeg ».';

export interface MediaInfo { format: string; durationSec: number; sizeKo: number; streams: string[]; fiche?: Fiche }

/** La fiche complète d'un média (pour l'affichage local, sur la machine). */
export function ficheMedia(path: string): Fiche {
  return lireMetadonnees({ chemin: path });
}

/** Bornes de ce que media_info rend au modèle : un fichier peut porter des mégaoctets de texte (paroles, commentaires). */
export const MEDIA_INFO_LIGNES = 200, MEDIA_INFO_CARACTERES = 40_000;

/**
 * Tout ce qu'on sait d'un média : format, durée, taille, une ligne par piste, puis toutes les métadonnées (sensibles
 * masquées par défaut). Ne lève que si le fichier n'existe pas.
 * Les métadonnées sont un CONTENU EXTÉRIEUR (écrites par n'importe qui) : bornées (200 lignes, 40 000 caractères) et
 * entourées d'une enveloppe « untrusted » (wrapUntrusted), une ligne par élément de `streams`, pour que l'outil qui les
 * écrit telles quelles les présente au modèle comme des données, jamais comme des consignes.
 */
export function mediaInfo(path: string, o: { sensibles?: 'masquer' | 'montrer' } = {}): MediaInfo {
  if (!existsSync(path)) throw new Error(`Fichier introuvable : ${basename(path)}`);
  const fiche = lireMetadonnees({ chemin: path });
  const sensibles = o.sensibles ?? 'masquer';
  const lignes = ficheEnLignes(fiche, { sensibles, detail: 'complet' });
  const famille = fiche.nature.famille;
  const aCompleter = !!fiche.illisible || fiche.manque.some((m) => m.code === 'format-non-lu') || ((famille === 'video' || famille === 'son') && !fiche.pistes.length);
  if (aCompleter && hasCommand('ffprobe')) lignes.push(...completerParFfprobe(path, sensibles === 'masquer'));
  const streams = [...fiche.pistes.slice(0, 64).map(ligneDePiste), ...envelopper(basename(path), lignes)];
  return {
    format: `${fiche.nature.nom}${fiche.illisible ? ` (illisible : ${fiche.illisible})` : ''}`,
    durationSec: fiche.dureeSec ?? 0, sizeKo: Math.round(fiche.tailleOctets / 1024), streams, fiche,
  };
}

/** Les lignes de métadonnées bornées puis entourées comme contenu extérieur (une ligne par élément). */
function envelopper(nom: string, lignes: string[]): string[] {
  const gardees: string[] = [];
  let total = 0;
  for (const [i, l] of lignes.entries()) {
    if (gardees.length >= MEDIA_INFO_LIGNES - 1 || total >= MEDIA_INFO_CARACTERES) { gardees.push(`… ${lignes.length - i} autre(s) ligne(s) non montrée(s) (métadonnées trop longues)`); break; }
    const x = bornerGraphemes(l.split('\n').join(' '), Math.max(1, Math.min(2000, MEDIA_INFO_CARACTERES - total)));
    gardees.push(x);
    total += x.length;
  }
  if (!gardees.length) return [];
  return wrapUntrusted(`métadonnées du fichier ${pourAffichage(basename(nom), 120)}`, gardees.join('\n')).split('\n');
}

/** ffprobe en complément : ses pistes et ses étiquettes (autrefois jetées), 200 lignes au plus. */
function completerParFfprobe(path: string, masquer: boolean): string[] {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', ...entreeFfmpeg('media'), path], { encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0 || !r.stdout) return [];
  let j: { format?: { format_long_name?: string; tags?: Record<string, unknown> }; streams?: Array<Record<string, unknown>> };
  try { j = JSON.parse(r.stdout); } catch { return []; }
  const lignes: string[] = [];
  for (const s of j.streams ?? []) {
    if (s.codec_type === 'video') lignes.push(`vidéo ${s.codec_name} ${s.width}×${s.height}${s.r_frame_rate ? ` à ${fps(String(s.r_frame_rate))} i/s` : ''} [ffprobe]`);
    else if (s.codec_type === 'audio') lignes.push(`audio ${s.codec_name} ${s.sample_rate} Hz, ${s.channels} canal(aux) [ffprobe]`);
    else lignes.push(`${s.codec_type} ${s.codec_name} [ffprobe]`);
  }
  const etiquettes = (t: unknown, prefixe: string) => {
    if (!t || typeof t !== 'object') return;
    for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
      if (lignes.length >= 200) return;
      const bas = k.toLowerCase();
      // Mêmes règles que les étiquettes libres du socle : nom qui dit un lieu ou un identifiant, valeur en coordonnées.
      const sensible = bas.includes('creation_time') || cleSensible(k) || ressembleACoordonnees(String(v).slice(0, 120));
      const valeur = masquer && sensible ? 'présent (masqué)' : pourAffichage(String(v), 400);
      lignes.push(`${prefixe}${pourAffichage(k, 80)} : ${valeur} [ffprobe]`);
    }
  };
  etiquettes(j.format?.tags, '');
  for (const [i, s] of (j.streams ?? []).entries()) etiquettes(s.tags, `piste ${i + 1} · `);
  return lignes.slice(0, 200);
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
    const p = spawn('ffmpeg', [...entreeFfmpeg('media'), ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, signal, timeout: timeoutMs });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg : ${err.trim() || `code ${code}`}`))));
  });
}

export const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
