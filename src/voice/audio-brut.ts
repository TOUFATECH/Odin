// L'audio brut de ce que tu dis à Odin : JAMAIS gardé, sauf si tu coches « Garder l'audio brut » (Réglages → Voix).
// Coché : chaque enregistrement compris est rangé dans ~/.odin/memoire/audio/ (dossier 700, fichiers 600), avec à
// côté une petite fiche (date, d'où il vient, ce qui a été compris), puis effacé au bout du nombre de jours réglé.
// Décoché : ce qui avait été gardé est effacé au prochain passage de la surveillance d'Orphée (toutes les heures). En mode privé, rien n'est gardé, réglage ou non.
// Rien ne part ailleurs : c'est un dossier de la machine d'Odin, fermé aux outils de fichiers (Heimdall, SECRET_FILES).

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Confidentialite { privateMode?: boolean; keepAudio?: boolean; keepAudioDays?: number }
export interface AudioGarde { fichier: string; at: string; mime: string; source: string; texte: string; octets: number }

export const dossierAudio = (home = process.env.ODIN_HOME ?? join(homedir(), '.odin')) => join(home, 'memoire', 'audio');
const EXT: Array<[RegExp, string]> = [[/wav/, 'wav'], [/ogg|opus/, 'ogg'], [/webm/, 'webm'], [/mp4|m4a|aac/, 'm4a'], [/mpeg|mp3/, 'mp3'], [/flac/, 'flac']];
const NOM = /^(\d{8}T\d{6})-([a-f0-9]{8})\.(wav|ogg|webm|m4a|mp3|flac|bin)$/;

/** Efface ce qui a dépassé sa durée (ou tout, avec `jours` = 0). Rend le nombre de sons effacés. */
export function purgerAudio(home?: string, jours = 0, now = Date.now()): number {
  const d = dossierAudio(home); if (!existsSync(d)) return 0;
  let n = 0;
  for (const f of readdirSync(d)) {
    const m = NOM.exec(f); if (!m) continue;
    const at = Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[1].slice(9, 11)}:${m[1].slice(11, 13)}:${m[1].slice(13, 15)}Z`);
    if (jours > 0 && now - at < jours * 86_400_000) continue;
    rmSync(join(d, f), { force: true }); rmSync(join(d, `${f}.json`), { force: true }); n++;
  }
  return n;
}

/**
 * Garde un enregistrement SI le réglage le permet (et jamais en mode privé) ; efface au passage ce qui a dépassé sa durée.
 * Rend le chemin du fichier gardé, ou rien.
 */
export function garderAudio(p: Confidentialite | undefined, audio: Uint8Array, mime: string, meta: { texte?: string; source?: string } = {}, home?: string, now = new Date()): string | undefined {
  if (!p?.keepAudio) return undefined; // décoché : rien n'est gardé (ce qui l'avait été est effacé par Orphée, voir purgerAudio)
  if (p.privateMode || !audio.byteLength) return undefined;
  const jours = Math.max(1, Math.min(365, Number(p.keepAudioDays) || 7));
  purgerAudio(home, jours, now.getTime());
  const d = dossierAudio(home); mkdirSync(d, { recursive: true, mode: 0o700 });
  const ext = EXT.find(([re]) => re.test(mime))?.[1] ?? 'bin';
  const f = `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomBytes(4).toString('hex')}.${ext}`;
  writeFileSync(join(d, f), audio, { mode: 0o600 });
  writeFileSync(join(d, `${f}.json`), JSON.stringify({ at: now.toISOString(), mime, source: (meta.source ?? 'voix').slice(0, 60), texte: (meta.texte ?? '').slice(0, 2000) }), { mode: 0o600 });
  return join(d, f);
}

/** Les enregistrements gardés, du plus récent au plus ancien. */
export function audiosGardes(home?: string): AudioGarde[] {
  const d = dossierAudio(home); if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => NOM.test(f)).map((f) => {
    let m: Partial<AudioGarde> = {}; try { m = JSON.parse(readFileSync(join(d, `${f}.json`), 'utf8')) as Partial<AudioGarde>; } catch { /* fiche absente */ }
    return { fichier: f, at: m.at ?? '', mime: m.mime ?? '', source: m.source ?? '', texte: m.texte ?? '', octets: statSync(join(d, f)).size };
  }).sort((a, b) => b.fichier.localeCompare(a.fichier));
}
