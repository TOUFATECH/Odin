// Vénus · les vignettes locales (lot V3) : une image tirée de la vidéo elle-même, sans aucun service. FFmpeg (déjà là
// pour la lecture) extrait UNE image du film ou de l'épisode, réduite à 480 px de large, gardée dans le dossier de Vénus
// (images/, registre `images` de VENUS_ODIN) et servie par Odin. Sans réglage du catalogue, c'est l'affiche et le fond
// des titres ; avec, elle reste la vignette des épisodes.
//
// Sûreté : FFmpeg est lancé avec des arguments FIXES (aucun passage par un interprète de commandes), seulement sur un
// fichier que la bibliothèque connaît déjà, au chemin complet, qui existe et qui est une vidéo ; l'entrée n'accepte que
// le protocole « file » et des lecteurs vidéo (pas de liste ni de « concat » qui ferait lire un autre fichier). UNE
// extraction à la fois (la machine a peu de cœurs), coupée au bout de 30 s. L'image produite est revérifiée (vraie
// image, taille bornée) avant d'être gardée. Aucun chemin de la machine n'est envoyé à la page.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import type { MagasinVenus } from './base.ts';
import { EXT_VIDEO, fichierDeCible } from './bibliotheque.ts';
import { entreeFfmpeg } from '../../files/ffmpeg-entree.ts';
import { dossierImages, fichierImage, garderImage, urlImage } from './metadonnees.ts';

/** Largeur des vignettes (px) et poids maximal accepté (octets). */
export const LARGEUR_VIGNETTE = 480, VIGNETTE_MAX = 512 * 1024;
/** Le moment choisi dans la vidéo : 10 % de sa durée, entre 1 s et 10 min (5 s si la durée est inconnue). Pur. */
export const instantVignette = (duree?: number): number => (duree && duree > 0 ? Math.min(600, Math.max(1, Math.round(duree * 0.1))) : 5);
/**
 * Les arguments de FFmpeg, toujours les mêmes : seuls l'instant (un nombre), le fichier vérifié et la sortie (dans le
 * dossier de Vénus) changent. Le fichier est placé après « -i » : un nom qui commence par « - » ne devient pas une
 * option (il est de toute façon refusé, le chemin doit être complet). Pur.
 */
export function argsVignette(chemin: string, sortie: string, instant: number): string[] {
  const t = Number.isFinite(instant) && instant >= 0 ? String(Math.floor(instant)) : '0';
  // « -update 1 » : la sortie est UN fichier, jamais un motif (un « % » dans le chemin du dossier d'Odin reste tel quel).
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', t, ...entreeFfmpeg('video'), '-i', chemin,
    '-map', '0:v:0', '-frames:v', '1', '-an', '-sn', '-dn', '-vf', `scale=${LARGEUR_VIGNETTE}:-2`, '-c:v', 'mjpeg', '-q:v', '5', '-f', 'image2', '-update', '1', sortie];
}

/**
 * Lance FFmpeg (injectable pour les essais) : vrai si la commande s'est bien terminée, faux si elle a échoué,
 * « coupe » si elle a été arrêtée au bout du délai.
 */
export type LancerFfmpeg = (args: string[], delaiMs: number) => Promise<boolean | 'coupe'>;
export const ffmpegReel: LancerFfmpeg = (args, delaiMs) => new Promise((ok) => {
  let fini = false, coupe = false; const fin = (v: boolean | 'coupe') => { if (!fini) { fini = true; ok(v); } };
  try {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, shell: false });
    // Au bout du délai : arrêté, et la main n'est rendue qu'à la VRAIE fin du processus (10 s au plus) — sinon la suite
    // démarrerait un second FFmpeg pendant que le premier meurt, et sa sortie serait encore tenue (Windows).
    const t = setTimeout(() => {
      coupe = true; try { p.kill('SIGKILL'); } catch { /* déjà fini */ }
      const t2 = setTimeout(() => fin('coupe'), 10_000); t2.unref?.();
    }, delaiMs); t.unref?.();
    p.on('error', () => { clearTimeout(t); fin(coupe ? 'coupe' : false); });
    p.on('close', (code) => { clearTimeout(t); fin(coupe ? 'coupe' : code === 0); });
  } catch { fin(false); }
});
let lancer: LancerFfmpeg = ffmpegReel;
/** (essais) remplacer FFmpeg ; sans argument, revenir au vrai. */
export function reglerFfmpegVignettes(l?: LancerFfmpeg): void { lancer = l ?? ffmpegReel; }

/** Le fichier vidéo d'une cible, s'il est sûr de le donner à FFmpeg : connu de la bibliothèque, complet, présent. */
export function videoVerifiee(mag: MagasinVenus, cibleId: string): { chemin: string; duree?: number; taille: number; mtime: number } | undefined {
  const c = fichierDeCible(mag, cibleId); if (!c || c.type !== 'video') return undefined;
  const chemin = c.fichier;
  if (!chemin || !isAbsolute(chemin) || chemin.startsWith('-') || /[\0\r\n]/.test(chemin) || !EXT_VIDEO.has(extname(chemin).toLowerCase())) return undefined;
  try { const st = statSync(chemin); if (!st.isFile()) return undefined; return { chemin, duree: c.duree, taille: st.size, mtime: Math.trunc(st.mtimeMs) }; } catch { return undefined; }
}
/** L'identifiant de la vignette d'une cible (change si le fichier change). */
const cleVignette = (cibleId: string, v: { chemin: string; taille: number; mtime: number }) => `vignette|${cibleId}|${v.chemin}|${v.taille}|${v.mtime}`;
const idDe = (cle: string) => createHash('sha256').update(cle, 'utf8').digest('hex').slice(0, 32);
/** L'adresse d'Odin de la vignette d'une cible, si elle est déjà faite (sinon rien : elle viendra). */
export function vignetteFaite(mag: MagasinVenus, cibleId: string): string | undefined {
  const v = videoVerifiee(mag, cibleId); if (!v) return undefined;
  const id = idDe(cleVignette(cibleId, v));
  return fichierImage(mag, id) ? urlImage(id) : undefined;
}

// ---------------------------------------------------------------- UNE extraction à la fois
let file: Promise<unknown> = Promise.resolve();
const attente = new Set<string>(), ratees = new Map<string, number>();
const MAX_ATTENTE = 200;
/** Fabrique la vignette d'une cible (ou la rend si elle est déjà faite). Passe par la file : une à la fois. */
export function fabriquerVignette(mag: MagasinVenus, cibleId: string): Promise<string | undefined> {
  const p = file.then(() => extraire(mag, cibleId)).catch(() => undefined);
  file = p; return p;
}
async function extraire(mag: MagasinVenus, cibleId: string): Promise<string | undefined> {
  const v = videoVerifiee(mag, cibleId); if (!v) return undefined;
  const cle = cleVignette(cibleId, v), id = idDe(cle);
  if (fichierImage(mag, id)) return urlImage(id);
  const dir = dossierImages(mag), sortie = join(dir, `${id}.tmp.jpg`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    // L'instant choisi, puis le début si la vidéo est plus courte. Une vidéo qui a fait tourner FFmpeg jusqu'à la
    // coupure n'a pas de second essai.
    for (const t of [instantVignette(v.duree), 0]) {
      rmSync(sortie, { force: true });
      const r = await lancer(argsVignette(v.chemin, sortie, t), 30_000);
      if (r === 'coupe') break;
      if (r !== true || !existsSync(sortie) || statSync(sortie).size > VIGNETTE_MAX) continue;
      const gardee = garderImage(mag, cle, readFileSync(sortie), 'vignette');
      if (gardee) return urlImage(gardee);
    }
  } catch { /* fichier tenu, disque plein… : la cible est notée ratée, comme un échec */ }
  finally { try { rmSync(sortie, { force: true }); } catch { /* retiré plus tard */ } }
  // Ratée (échec, coupure ou erreur) : pas relancée avant une heure, même si la page relit le catalogue.
  ratees.set(cibleId, Date.now());
  return undefined;
}
/**
 * Demande (en fond) les vignettes qui manquent pour ces cibles. Une cible déjà ratée n'est retentée qu'une heure après.
 * Rend le nombre de vignettes qui attendent.
 */
export function demanderVignettes(mag: MagasinVenus, cibles: string[]): number {
  for (const c of cibles) {
    if (attente.size >= MAX_ATTENTE) break;
    if (attente.has(c) || Date.now() - (ratees.get(c) ?? 0) < 3600e3 || vignetteFaite(mag, c) || !videoVerifiee(mag, c)) continue;
    attente.add(c);
    void fabriquerVignette(mag, c).finally(() => attente.delete(c));
  }
  return attente.size;
}
/** (essais) attendre que la file soit vide. */
export async function attendreVignettes(): Promise<void> { for (let i = 0; i < 1000 && attente.size; i++) await file; await file; }
/** (essais) oublier les échecs. */
export function oublierVignettesRatees(): void { ratees.clear(); }
