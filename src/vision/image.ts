// Préparation des images : choix du décodeur selon les octets, redimensionnement, normalisation CHW.
// Calcul pur, aucune dépendance externe. Les bornes « fichier hostile » sont dans png.ts / jpeg.ts, AVANT allocation.

import type { ImageDecodee } from './index.ts';
import { ErreurFormatNonNatif } from './index.ts';
import { decoderPng } from './png.ts';
import { decoderJpeg } from './jpeg.ts';

/** Plafond du tampon accepté (comme le lecteur PDF intégré : 20 Mo). Au-delà, on refuse AVANT toute analyse. */
const MAX_OCTETS = 20 * 1024 * 1024;
/** Nombre maximal de pixels d'une image (64 mégapixels) : une dimension démesurée ne doit jamais allouer. */
export const MAX_PIXELS = 64 * 1024 * 1024;

const SIG_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Décode un tampon en image RGBA. PNG et JPEG baseline nativement ; tout autre format lève ErreurFormatNonNatif. */
export function decoderImage(buf: Buffer, nomOuExt: string): ImageDecodee {
  if (!buf || buf.length === 0) throw new Error('image vide');
  if (buf.length > MAX_OCTETS) throw new Error(`image trop volumineuse pour le lecteur intégré (${MAX_OCTETS / (1024 * 1024)} Mo)`);
  // La décision se prend sur les octets de tête, pas sur le nom (un nom peut mentir) ; le nom sert au message.
  if (buf.length >= 8 && SIG_PNG.every((o, i) => buf[i] === o)) return decoderPng(buf);
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return decoderJpeg(buf);
  const ext = (nomOuExt.split('.').pop() ?? nomOuExt).toLowerCase();
  throw new ErreurFormatNonNatif(`format d'image « ${ext} » non lisible nativement (conversion requise)`);
}

/** Redimensionne une image à un carré `cote`×`cote` par interpolation bilinéaire. */
export function redimensionner(img: ImageDecodee, cote: number): ImageDecodee {
  if (!Number.isInteger(cote) || cote <= 0 || cote > 8192) throw new Error(`côté de redimensionnement invalide (${cote})`);
  const { largeur: lw, hauteur: lh, rgba } = img;
  if (lw <= 0 || lh <= 0 || rgba.length < lw * lh * 4) throw new Error('image source invalide');
  const sortie = new Uint8Array(cote * cote * 4);
  // Échelle : on vise le centre des pixels pour éviter le décalage d'un demi-pixel.
  const ex = lw / cote, ey = lh / cote;
  for (let y = 0; y < cote; y++) {
    const sy = Math.min(lh - 1, Math.max(0, (y + 0.5) * ey - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(lh - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < cote; x++) {
      const sx = Math.min(lw - 1, Math.max(0, (x + 0.5) * ex - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(lw - 1, x0 + 1), fx = sx - x0;
      const i00 = (y0 * lw + x0) * 4, i01 = (y0 * lw + x1) * 4, i10 = (y1 * lw + x0) * 4, i11 = (y1 * lw + x1) * 4;
      const o = (y * cote + x) * 4;
      for (let c = 0; c < 4; c++) {
        const haut = rgba[i00 + c] * (1 - fx) + rgba[i01 + c] * fx;
        const bas = rgba[i10 + c] * (1 - fx) + rgba[i11 + c] * fx;
        sortie[o + c] = Math.round(haut * (1 - fy) + bas * fy);
      }
    }
  }
  return { largeur: cote, hauteur: cote, rgba: sortie };
}

/** Normalise une image au format CHW (3 canaux R, G, V, puis B), flottants : (v/255 − moy[c]) / ec[c]. */
export function normaliser(img: ImageDecodee, moy: [number, number, number], ec: [number, number, number]): Float32Array {
  const { largeur: lw, hauteur: lh, rgba } = img;
  if (lw <= 0 || lh <= 0 || rgba.length < lw * lh * 4) throw new Error('image source invalide');
  for (let c = 0; c < 3; c++) if (!(ec[c] > 0) && !(ec[c] < 0)) throw new Error('écart-type nul ou invalide');
  const hw = lh * lw;
  const out = new Float32Array(3 * hw);
  for (let c = 0; c < 3; c++) {
    const base = c * hw, m = moy[c], e = ec[c];
    for (let p = 0; p < hw; p++) out[base + p] = ((rgba[p * 4 + c] / 255) - m) / e;
  }
  return out;
}
