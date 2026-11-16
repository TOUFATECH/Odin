// Vénus · Odéon — la lecture dans le navigateur, servie par Odin (sans serveur extérieur). Un fichier lisible tel quel
// part en flux direct (avec l'en-tête Range pour avancer/reculer) ; sinon il est transcodé à la volée par FFmpeg
// (MP4 progressif, ou HLS pour les longs). Sous-titres servis en WebVTT (fichier à côté converti, ou piste extraite).
// La reprise est gardée dans VENUS_ODIN (table reprise).
//
// FFmpeg est injecté (lancer un transcodage = une fonction) : les essais passent un faux, aucun flux réel.
import { extname } from 'node:path';
import type { Probe } from './bibliotheque.ts';

// Ce qu'un navigateur lit sans transcodage : conteneur MP4/WebM et codecs répandus.
const CONTENEURS_OK = new Set(['.mp4', '.m4v', '.webm', '.mov']);
const VIDEO_OK = /^(h264|avc|avc1|vp8|vp9|av1|av01)/i;
const AUDIO_OK = /^(aac|mp3|mp4a|opus|vorbis)/i;

/** Un fichier est-il lisible tel quel dans un navigateur ? Pur, testable. */
export function lisible(probe: Probe | undefined, chemin: string): boolean {
  const ext = extname(chemin).toLowerCase();
  if (!CONTENEURS_OK.has(ext)) return false;
  if (!probe) return true; // conteneur sûr, codecs inconnus : on tente le direct
  const v = probe.codecs.find((c) => /^(h264|avc|hevc|h265|vp8|vp9|av1|mpeg|xvid|divx|vc1|wmv)/i.test(c));
  const a = probe.audio[0];
  if (v && !VIDEO_OK.test(v)) return false;
  if (a && !AUDIO_OK.test(a)) return false;
  return true;
}

export type ModeLecture = 'direct' | 'mp4' | 'hls';
export interface PlanLecture { mode: ModeLecture; mime: string; raison: string }
/** Comment lire une cible : direct, transcodage MP4 (court) ou HLS (long). Pur. */
export function planLecture(o: { chemin: string; probe?: Probe; type: 'video' | 'audio'; duree?: number }): PlanLecture {
  if (o.type === 'audio') {
    const ext = extname(o.chemin).toLowerCase();
    if (['.mp3', '.m4a', '.aac', '.opus', '.ogg', '.wav', '.flac'].includes(ext)) return { mode: 'direct', mime: mimeAudio(ext), raison: 'audio lisible tel quel' };
    return { mode: 'mp4', mime: 'audio/mp4', raison: 'audio transcodé en AAC' };
  }
  if (lisible(o.probe, o.chemin)) return { mode: 'direct', mime: mimeVideo(extname(o.chemin).toLowerCase()), raison: 'format lisible par le navigateur' };
  if ((o.duree ?? 0) > 20 * 60) return { mode: 'hls', mime: 'application/vnd.apple.mpegurl', raison: 'long et non lisible : transcodé en HLS à la volée' };
  return { mode: 'mp4', mime: 'video/mp4', raison: 'format non lisible : transcodé en MP4 à la volée' };
}
const mimeVideo = (ext: string) => (ext === '.webm' ? 'video/webm' : 'video/mp4');
const mimeAudio = (ext: string) => ({ '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac' } as Record<string, string>)[ext] ?? 'audio/mpeg';

/** L'en-tête Range « bytes=start-end » → bornes dans un fichier de `taille` octets. Pur, testable. */
export function lireRange(entete: string | undefined, taille: number): { debut: number; fin: number; partiel: boolean } {
  if (!entete) return { debut: 0, fin: taille - 1, partiel: false };
  const m = /bytes=(\d*)-(\d*)/.exec(entete); if (!m) return { debut: 0, fin: taille - 1, partiel: false };
  let debut = m[1] ? Number(m[1]) : 0, fin = m[2] ? Number(m[2]) : taille - 1;
  if (m[1] === '' && m[2]) { debut = Math.max(0, taille - Number(m[2])); fin = taille - 1; } // bytes=-500 (derniers octets)
  debut = Math.min(Math.max(0, debut), Math.max(0, taille - 1));
  fin = Math.min(Math.max(debut, fin), taille - 1);
  return { debut, fin, partiel: true };
}

/** Les arguments FFmpeg d'un transcodage à la volée (pur, testable). `depuis` = secondes de départ (reprise/seek). */
export function argsTranscodage(fichier: string, mode: 'mp4' | 'hls', depuis = 0): string[] {
  const base = ['-v', 'error', ...(depuis > 0 ? ['-ss', String(Math.max(0, Math.round(depuis)))] : []), '-i', fichier];
  if (mode === 'hls') {
    return [...base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments', 'pipe:1'];
  }
  // MP4 progressif « fragmenté » pour pouvoir le diffuser sans fichier temporaire.
  return [...base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-movflags', 'frag_keyframe+empty_moov+faststart', '-f', 'mp4', 'pipe:1'];
}

/** Les arguments FFmpeg pour extraire/convertir une piste de sous-titres en WebVTT (pur). */
export function argsSousTitres(fichier: string, o: { index?: number } = {}): string[] {
  return ['-v', 'error', '-i', fichier, ...(o.index !== undefined ? ['-map', `0:${o.index}`] : []), '-f', 'webvtt', 'pipe:1'];
}

/** Choisit la piste de sous-titres à servir pour une langue voulue. Pur. */
export interface SousTitre { langue?: string; fichier?: string; index?: number; titre?: string }
export function choisirSousTitres(sous: SousTitre[] | undefined, langue?: string): SousTitre | undefined {
  if (!sous?.length) return undefined;
  const l = (langue ?? '').toLowerCase();
  if (l) { const exact = sous.find((s) => (s.langue ?? '').toLowerCase().startsWith(l)); if (exact) return exact; }
  return sous.find((s) => /^fr/i.test(s.langue ?? '')) ?? sous[0];
}

/** Convertit un fichier SRT en WebVTT (pur, testable) : en-tête WEBVTT et virgules → points dans les temps. */
export function srtVersVtt(srt: string): string {
  const corps = srt.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${corps.trim()}\n`;
}
/** Vrai si le contenu est déjà du WebVTT. */
export const estVtt = (texte: string) => /^﻿?WEBVTT/.test(texte);
