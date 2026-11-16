// Théia — l'adaptateur « vision locale » : il donne à Odin une fonction Vision (la même signature que celle qu'attend
// l'analyse d'images et de vidéos du cœur, src/video/video.ts), mais câblée sur l'œil LOCAL, sans rien envoyer en ligne.
// Une image privée ne part JAMAIS dehors : tout est décodé et décrit sur la machine.
//
// Il reçoit les images en base64 (comme le cœur les passe), les décode avec le décodeur natif de Théia (PNG/JPEG), et
// pour un format non natif il passe par l'outil de conversion déjà là (convertMedia / FFmpeg). Puis il demande à l'œil
// de décrire, et renvoie le texte suivi de la confiance mesurée et du temps réel. Tant qu'aucun vrai poids ouvert n'a
// tourné, l'œil répond essaye=false : l'adaptateur le DIT (« codé, pas encore essayé sur du vrai modèle »), sans mentir.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertMedia } from '../../files/media.ts';
import type { Vision } from '../../video/video.ts';
import { decoderImage, ErreurFormatNonNatif, type ImageDecodee, type Oeil } from '../../vision/index.ts';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/heic': 'heic' };

/** Décode une image reçue en base64 ; un format non natif passe par FFmpeg (converti en JPEG). */
export async function imageDepuisBase64(mime: string, dataB64: string, signal?: AbortSignal): Promise<ImageDecodee> {
  const buf = Buffer.from(dataB64, 'base64');
  const ext = EXT[mime.split(';')[0].toLowerCase()] ?? 'bin';
  try {
    return decoderImage(buf, ext);
  } catch (e) {
    if (!(e instanceof ErreurFormatNonNatif)) throw e;
    // Format non natif (WebP, GIF, HEIC…) : on convertit en JPEG avec l'outil déjà présent, puis on redécode.
    const dir = mkdtempSync(join(tmpdir(), 'theia-img-'));
    try {
      const src = join(dir, `src.${ext}`), out = join(dir, 'out.jpg');
      writeFileSync(src, buf);
      await convertMedia(src, out, { width: 1600 }, signal, 120_000);
      return decoderImage(readFileSync(out), 'jpg');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}

/** Arrondit une confiance (0..1) en pourcentage, et un temps en secondes à une décimale. */
const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);
const sec = (ms: number) => Math.round(ms / 100) / 10;

/**
 * La fonction Vision locale de Théia : décrit chaque image avec l'œil, en affichant la confiance et le temps mesurés.
 * Signature identique à src/video/video.ts (question + images base64 → texte), pour remplacer la vision en ligne.
 */
export function visionLocale(oeil: Oeil, o: { max?: number; signal?: AbortSignal } = {}): Vision {
  const max = o.max ?? 8;
  return async (question, images) => {
    const parts: string[] = [];
    let essayeTout = true;
    for (const img of images.slice(0, max)) {
      if (o.signal?.aborted) break;
      try {
        const im = await imageDepuisBase64(img.mime, img.data, o.signal);
        // Signal VIVANT (AbortSignal.aborted est un getter) : un instantané figé { aborted: … } ne verrait jamais
        // l'abandon survenu PENDANT la génération (plusieurs secondes), et decrire ne rendrait pas la main.
        const d = await oeil.decrire(im, question, o.signal);
        essayeTout &&= d.essaye;
        const meta = `(confiance ${pct(d.confiance)} %, ${sec(d.tempsMs)} s${d.modele ? `, ${d.modele}` : ''})`;
        parts.push(`${d.texte.trim()} ${meta}`.trim());
      } catch (e) {
        parts.push(`Je n'ai pas pu lire cette image (${(e as Error).message.slice(0, 160)}).`);
      }
    }
    let texte = parts.join('\n\n');
    if (!essayeTout) texte += '\n\n⚠ Théia est codée, mais aucun vrai modèle de vision ouvert n\'a encore tourné ici : description à prendre avec prudence (codé, pas encore essayé sur du vrai modèle).';
    return texte || 'Aucune image à décrire.';
  };
}
