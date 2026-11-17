// Médias reçus : une copie d'image SANS ses métadonnées (EXIF, XMP, IPTC, commentaires, vignette), à montrer à un
// modèle en ligne quand le propriétaire le demande : la position, l'heure, l'appareil et son numéro de série restent sur
// la machine. L'image elle-même n'est pas touchée (octets de l'image recopiés tels quels) ; l'orientation est gardée en
// la réécrivant dans un EXIF minimal (une seule étiquette 0x0112). JPEG, PNG et WebP ; autre format → undefined
// (l'appelant convertit d'abord en JPEG). Ne lève jamais : un fichier malformé rend undefined.

import { crc32 } from 'node:zlib';
import { lireMetadonnees } from './metadonnees.ts';

const NUL = String.fromCharCode(0);

export function retirerMetadonnees(b: Buffer): Buffer | undefined {
  try {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpeg(b);
    if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return png(b);
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return webp(b);
    return undefined;
  } catch { return undefined; }
}

/** L'orientation lue dans le fichier d'origine (1 = normale). */
function orientation(b: Buffer): number {
  const f = lireMetadonnees({ octets: b });
  const c = f.orientation?.code;
  return c && c >= 2 && c <= 8 ? c : 1;
}
/** TIFF minimal (petit-boutiste) : un seul IFD avec l'orientation. */
function tiffOrientation(o: number): Buffer {
  const t = Buffer.alloc(8 + 2 + 12 + 4);
  t.write('II', 0, 'latin1'); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
  t.writeUInt16LE(1, 8);
  t.writeUInt16LE(0x0112, 10); t.writeUInt16LE(3, 12); t.writeUInt32LE(1, 14); t.writeUInt16LE(o, 18);
  t.writeUInt32LE(0, 22);
  return t;
}

// ─────────────────────────────── JPEG ───────────────────────────────

function jpeg(b: Buffer): Buffer | undefined {
  const o = orientation(b);
  const morceaux: Buffer[] = [b.subarray(0, 2)];
  let p = 2, premier = true;
  const garder = (m: number, d: Buffer): boolean => {
    if (m === 0xe0) return d.toString('latin1', 0, 5) === `JFIF${NUL}`;
    if (m === 0xe2) return d.toString('latin1', 0, 12) === `ICC_PROFILE${NUL}`;
    if (m === 0xee) return d.toString('latin1', 0, 5) === 'Adobe';
    // LISTE BLANCHE : seuls les segments qui font l'image sont gardés. Tout le reste part : EXIF, XMP, MPF, IPTC
    // (APP1–APP15), commentaire (COM), extensions JPGn (0xF0–0xFD), C2PA/JUMBF, marqueurs inconnus.
    return (m >= 0xc0 && m <= 0xcf) || m === 0xdb || m === 0xdd || m === 0xda || m === 0xdc;   // SOFn, DHT, DAC, DQT, DRI, SOS, DNL
  };
  // EXIF minimal (orientation seule), placé juste après SOI ou après l'APP0 JFIF.
  let minimal: Buffer | undefined;
  if (o !== 1) {
    const d = Buffer.concat([Buffer.from(`Exif${NUL}${NUL}`, 'latin1'), tiffOrientation(o)]);
    const h = Buffer.alloc(4); h.writeUInt16BE(0xffe1, 0); h.writeUInt16BE(d.length + 2, 2);
    minimal = Buffer.concat([h, d]);
  }
  for (let n = 0; n < 10_000; n++) {
    if (p + 2 > b.length || b[p] !== 0xff) return undefined;
    while (b[p + 1] === 0xff && p + 2 < b.length) p++;   // octets de remplissage
    const m = b[p + 1];
    if (m === 0xd9) { if (premier && minimal) morceaux.push(minimal); morceaux.push(b.subarray(p, p + 2)); return Buffer.concat(morceaux); }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { morceaux.push(b.subarray(p, p + 2)); p += 2; continue; }
    if (p + 4 > b.length) return undefined;
    const L = b.readUInt16BE(p + 2);
    if (L < 2 || p + 2 + L > b.length) return undefined;
    const d = b.subarray(p + 4, p + 2 + L);
    const jfif = m === 0xe0 && garder(m, d);
    if (premier && !jfif && minimal) morceaux.push(minimal);
    if (garder(m, d)) morceaux.push(b.subarray(p, p + 2 + L));
    if (premier && jfif && minimal) morceaux.push(minimal);
    premier = false;
    p += 2 + L;
    if (m === 0xda) {
      // Données de l'image : recopiées telles quelles jusqu'au prochain vrai marqueur.
      const debut = p;
      while (p + 1 < b.length) {
        if (b[p] === 0xff && b[p + 1] !== 0x00 && !(b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7) && b[p + 1] !== 0xff) break;
        p++;
      }
      if (p + 1 >= b.length) { morceaux.push(b.subarray(debut)); return Buffer.concat(morceaux); }   // pas d'EOI : on rend ce qu'on a
      morceaux.push(b.subarray(debut, p));
    }
  }
  return undefined;
}

// ─────────────────────────────── PNG ───────────────────────────────

/**
 * LISTE BLANCHE des morceaux PNG gardés : ceux qui font l'image (et l'animation APNG), les couleurs. Tout le reste
 * part : tEXt, zTXt, iTXt, eXIf, tIME, caBX (C2PA), prVW, morceaux privés ou inconnus. iCCP est gardé mais son NOM
 * (texte libre) est remplacé par « ICC ».
 */
const GARDES_PNG = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs', 'hIST', 'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCv', 'cLLi', 'iCCP']);
function chunk(type: string, d: Buffer): Buffer {
  const t = Buffer.from(type, 'latin1');
  const h = Buffer.alloc(4); h.writeUInt32BE(d.length);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, d])) >>> 0);
  return Buffer.concat([h, t, d, c]);
}
function png(b: Buffer): Buffer | undefined {
  const o = orientation(b);
  const out: Buffer[] = [b.subarray(0, 8)];
  let p = 8;
  for (let n = 0; n < 100_000; n++) {
    if (p + 12 > b.length) return undefined;
    const L = b.readUInt32BE(p);
    const type = b.toString('latin1', p + 4, p + 8);
    if (L > b.length - p - 12) return undefined;
    if (type === 'iCCP') {
      // Nom du profil (1 à 79 octets, puis NUL) remplacé ; profil compressé recopié tel quel.
      const d = b.subarray(p + 8, p + 8 + L);
      const nul = d.indexOf(0);
      if (nul > 0 && nul < 80) out.push(chunk('iCCP', Buffer.concat([Buffer.from(`ICC${NUL}`, 'latin1'), d.subarray(nul + 1)])));
    } else if (GARDES_PNG.has(type)) out.push(b.subarray(p, p + 12 + L));
    if (type === 'IHDR' && o !== 1) out.push(chunk('eXIf', tiffOrientation(o)));
    p += 12 + L;
    if (type === 'IEND') return Buffer.concat(out);
  }
  return undefined;
}

// ─────────────────────────────── WebP ───────────────────────────────

/** Morceaux WebP gardés : l'image (avec perte, sans perte), la transparence, l'animation, le profil de couleurs. */
const GARDES_WEBP = new Set(['VP8 ', 'VP8L', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

function webp(b: Buffer): Buffer | undefined {
  const o = orientation(b);
  const fin = Math.min(b.length, 8 + b.readUInt32LE(4));
  const morceaux: Buffer[] = [];
  let p = 12, vp8x: Buffer | undefined;
  for (let n = 0; n < 10_000 && p + 8 <= fin; n++) {
    const id = b.toString('latin1', p, p + 4);
    const L = b.readUInt32LE(p + 4);
    if (L > fin - p - 8) return undefined;
    const tout = b.subarray(p, Math.min(fin, p + 8 + L + (L & 1)));
    if (id === 'VP8X') { vp8x = Buffer.from(tout); morceaux.push(vp8x); }
    else if (GARDES_WEBP.has(id)) morceaux.push(tout);   // liste blanche : EXIF, XMP, C2PA et inconnus partent
    p += 8 + L + (L & 1);
  }
  if (vp8x && vp8x.length >= 9) {
    vp8x[8] &= ~(0x08 | 0x04);                        // drapeaux EXIF et XMP retirés
    if (o !== 1) {
      vp8x[8] |= 0x08;
      const t = tiffOrientation(o);
      const h = Buffer.alloc(8); h.write('EXIF', 0, 'latin1'); h.writeUInt32LE(t.length, 4);
      morceaux.push(Buffer.concat([h, t, t.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]));
    }
  }
  const corps = Buffer.concat(morceaux);
  const tete = Buffer.alloc(12); tete.write('RIFF', 0, 'latin1'); tete.writeUInt32LE(corps.length + 4, 4); tete.write('WEBP', 8, 'latin1');
  return Buffer.concat([tete, corps]);
}
