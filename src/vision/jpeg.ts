// Décodage JPEG BASELINE (SOF0/SOF1), écrit dans Odin (aucune dépendance). Format : norme JPEG publique, octets
// gros-boutiens. Le JPEG progressif, sans perte ou arithmétique → ErreurFormatNonNatif (Lot B le convertit).
//
// FICHIER HOSTILE : dimensions bornées AVANT allocation, chaque segment vérifié dans les bornes du tampon, tables de
// Huffman et de quantification validées. Un flux malformé renvoie une erreur lisible ; il ne plante pas Odin.

import type { ImageDecodee } from './index.ts';
import { ErreurFormatNonNatif } from './index.ts';
import { MAX_PIXELS } from './image.ts';

// Ordre « zigzag » de la norme : position dans le bloc 8×8 pour l'indice de parcours k.
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

interface TableHuff { mincode: Int32Array; maxcode: Int32Array; valptr: Int32Array; valeurs: Uint8Array }
interface Composante { id: number; h: number; v: number; qt: number; dc: number; ac: number; pred: number }

/** Construit une table de Huffman à partir du nombre de codes par longueur (1..16) et des valeurs (Annexe C/F). */
function construireHuff(comptes: number[], valeurs: Uint8Array): TableHuff {
  const tailles: number[] = [];
  for (let l = 1; l <= 16; l++) for (let i = 0; i < comptes[l - 1]; i++) tailles.push(l);
  const codes: number[] = [];
  let code = 0, k = 0;
  let taille = tailles.length ? tailles[0] : 0;
  while (k < tailles.length) {
    while (k < tailles.length && tailles[k] === taille) { codes.push(code); code++; k++; }
    code <<= 1; taille++;
  }
  const mincode = new Int32Array(17).fill(0), maxcode = new Int32Array(17).fill(-1), valptr = new Int32Array(17).fill(0);
  let p = 0;
  for (let l = 1; l <= 16; l++) {
    if (comptes[l - 1] > 0) {
      valptr[l] = p; mincode[l] = codes[p]; p += comptes[l - 1]; maxcode[l] = codes[p - 1];
    }
  }
  return { mincode, maxcode, valptr, valeurs };
}

/** Lecteur de bits du flux comprimé : gère le bourrage d'octets (FF 00) et s'arrête aux marqueurs. */
class LecteurBits {
  private buf: Buffer; private pos: number; private fin: number;
  private reg = 0; private nb = 0; marqueur = 0;
  constructor(buf: Buffer, pos: number, fin: number) { this.buf = buf; this.pos = pos; this.fin = fin; }
  get position(): number { return this.pos; }
  /** Lit un bit ; 0 et marqueur positionné si la fin ou un marqueur est atteint. */
  bit(): number {
    if (this.nb === 0) {
      if (this.pos >= this.fin) { this.marqueur = 0xd9; return 0; }
      let o = this.buf[this.pos++];
      if (o === 0xff) {
        let suivant = this.pos < this.fin ? this.buf[this.pos] : 0xd9;
        while (suivant === 0xff) { this.pos++; suivant = this.pos < this.fin ? this.buf[this.pos] : 0xd9; }
        if (suivant === 0x00) { this.pos++; } // octet bourré : FF réel
        else { this.marqueur = suivant; o = 0; } // marqueur : on ne consomme pas, on signale
      }
      this.reg = o; this.nb = 8;
    }
    this.nb--;
    return (this.reg >> this.nb) & 1;
  }
  recevoir(s: number): number { let v = 0; for (let i = 0; i < s; i++) v = (v << 1) | this.bit(); return v; }
  /** Décode un symbole via une table de Huffman. */
  decoder(t: TableHuff): number {
    let code = 0;
    for (let l = 1; l <= 16; l++) {
      code = (code << 1) | this.bit();
      if (t.maxcode[l] >= 0 && code <= t.maxcode[l]) return t.valeurs[t.valptr[l] + code - t.mincode[l]];
    }
    return 0; // flux corrompu : on renvoie 0 plutôt que de boucler
  }
  /** Réaligne sur l'octet et saute un marqueur de redémarrage (RSTn) attendu. */
  redemarrer(): void { this.nb = 0; this.marqueur = 0; if (this.pos + 1 < this.fin && this.buf[this.pos] === 0xff && this.buf[this.pos + 1] >= 0xd0 && this.buf[this.pos + 1] <= 0xd7) this.pos += 2; }
}

function extension(v: number, s: number): number { return v < (1 << (s - 1)) ? v - (1 << s) + 1 : v; }

/** IDCT 8×8 séparable (flottants). Entrée/sortie dans un tableau de 64. */
function idct8x8(bloc: Float32Array, sortie: Float32Array): void {
  const tmp = new Float32Array(64);
  const C = (u: number) => (u === 0 ? Math.SQRT1_2 : 1);
  // Colonnes.
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) s += C(v) * bloc[v * 8 + x] * Math.cos(((2 * y + 1) * v * Math.PI) / 16);
      tmp[y * 8 + x] = s * 0.5;
    }
  }
  // Lignes.
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) s += C(u) * tmp[y * 8 + u] * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
      sortie[y * 8 + x] = s * 0.5;
    }
  }
}

function lireU16(b: Buffer, p: number): number { return (b[p] << 8) | b[p + 1]; }

/** Décode un JPEG baseline en image RGBA. */
export function decoderJpeg(buf: Buffer): ImageDecodee {
  const quant: (Int32Array | undefined)[] = new Array(4);
  const huffDC: (TableHuff | undefined)[] = new Array(4);
  const huffAC: (TableHuff | undefined)[] = new Array(4);
  let largeur = 0, hauteur = 0;
  let composantes: Composante[] = [];
  let intervalleReset = 0;

  let p = 2; // après SOI
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) { p++; continue; }
    const marqueur = buf[p + 1];
    p += 2;
    if (marqueur === 0xd9) break; // EOI
    if (marqueur >= 0xd0 && marqueur <= 0xd7) continue; // RSTn hors scan : ignorés
    if (marqueur === 0x01) continue; // TEM
    const longueur = lireU16(buf, p);
    if (longueur < 2 || p + longueur > buf.length) throw new Error('JPEG : segment tronqué');
    const corps = p + 2, finCorps = p + longueur;

    if (marqueur === 0xc0 || marqueur === 0xc1) { // SOF0/SOF1 : baseline
      hauteur = lireU16(buf, corps + 1);
      largeur = lireU16(buf, corps + 3);
      const nbComp = buf[corps + 5];
      if (largeur <= 0 || hauteur <= 0) throw new Error('JPEG : dimensions nulles');
      if (largeur * hauteur > MAX_PIXELS) throw new Error(`JPEG : image trop grande (${largeur}×${hauteur})`);
      if (nbComp !== 1 && nbComp !== 3) throw new ErreurFormatNonNatif('JPEG à nombre de composantes non pris en charge (conversion requise)');
      composantes = [];
      for (let i = 0; i < nbComp; i++) {
        const o = corps + 6 + i * 3;
        const h = buf[o + 1] >> 4, v = buf[o + 1] & 15;
        // Facteur d'échantillonnage borné 1..4 (norme JPEG) : un 0 rendrait mcuCols/mcuLignes = Infinity (boucle sans fin).
        if (h < 1 || h > 4 || v < 1 || v > 4) throw new Error('JPEG : facteur d\'échantillonnage invalide');
        if (buf[o + 2] > 3) throw new Error('JPEG : table de quantification de composante invalide');
        composantes.push({ id: buf[o], h, v, qt: buf[o + 2], dc: 0, ac: 0, pred: 0 });
      }
    } else if (marqueur === 0xc2 || marqueur === 0xc3 || (marqueur >= 0xc5 && marqueur <= 0xcf && marqueur !== 0xc8)) {
      throw new ErreurFormatNonNatif('JPEG progressif / sans perte / arithmétique non lisible nativement (conversion requise)');
    } else if (marqueur === 0xdb) { // DQT
      let q = corps;
      while (q < finCorps) {
        const pq = buf[q] >> 4, tq = buf[q] & 15; q++;
        if (tq > 3) throw new Error('JPEG : table de quantification invalide');
        const table = new Int32Array(64);
        for (let i = 0; i < 64; i++) { table[ZIGZAG[i]] = pq ? lireU16(buf, q) : buf[q]; q += pq ? 2 : 1; }
        quant[tq] = table;
      }
    } else if (marqueur === 0xc4) { // DHT
      let q = corps;
      while (q < finCorps) {
        const tc = buf[q] >> 4, th = buf[q] & 15; q++;
        if (th > 3) throw new Error('JPEG : table de Huffman invalide');
        const comptes: number[] = [];
        let total = 0;
        for (let i = 0; i < 16; i++) { comptes.push(buf[q + i]); total += buf[q + i]; }
        q += 16;
        if (total > 256 || q + total > finCorps) throw new Error('JPEG : table de Huffman débordante');
        const valeurs = Uint8Array.from(buf.subarray(q, q + total)); q += total;
        const table = construireHuff(comptes, valeurs);
        if (tc === 0) huffDC[th] = table; else huffAC[th] = table;
      }
    } else if (marqueur === 0xdd) { // DRI
      intervalleReset = lireU16(buf, corps);
    } else if (marqueur === 0xda) { // SOS : début du scan
      const nbScan = buf[corps];
      for (let i = 0; i < nbScan; i++) {
        const cid = buf[corps + 1 + i * 2], tables = buf[corps + 2 + i * 2];
        const comp = composantes.find((c) => c.id === cid);
        if (!comp) throw new Error('JPEG : composante de scan inconnue');
        comp.dc = tables >> 4; comp.ac = tables & 15;
      }
      const debutScan = corps + 1 + nbScan * 2 + 3; // saute Ss, Se, Ah/Al
      return decoderScan(buf, debutScan, largeur, hauteur, composantes, quant, huffDC, huffAC, intervalleReset);
    }
    p = finCorps;
  }
  throw new Error('JPEG : aucun scan (fichier incomplet)');
}

function decoderScan(
  buf: Buffer, debut: number, largeur: number, hauteur: number, comps: Composante[],
  quant: (Int32Array | undefined)[], huffDC: (TableHuff | undefined)[], huffAC: (TableHuff | undefined)[], intervalleReset: number,
): ImageDecodee {
  const hmax = Math.max(...comps.map((c) => c.h)), vmax = Math.max(...comps.map((c) => c.v));
  const mcuCols = Math.ceil(largeur / (8 * hmax)), mcuLignes = Math.ceil(hauteur / (8 * vmax));
  // Plan pleine résolution de composante : (mcuCols*h*8) × (mcuLignes*v*8).
  const plans = comps.map((c) => ({ comp: c, w: mcuCols * c.h * 8, h: mcuLignes * c.v * 8, data: new Uint8ClampedArray(mcuCols * c.h * 8 * mcuLignes * c.v * 8) }));
  const lecteur = new LecteurBits(buf, debut, buf.length);
  const bloc = new Float32Array(64), spatial = new Float32Array(64);
  let compteMcu = 0;

  for (let my = 0; my < mcuLignes; my++) {
    for (let mx = 0; mx < mcuCols; mx++) {
      if (intervalleReset > 0 && compteMcu > 0 && compteMcu % intervalleReset === 0) {
        lecteur.redemarrer();
        for (const c of comps) c.pred = 0;
      }
      for (let ci = 0; ci < comps.length; ci++) {
        const c = comps[ci], plan = plans[ci];
        const qt = quant[c.qt]; const dcT = huffDC[c.dc]; const acT = huffAC[c.ac];
        if (!qt || !dcT || !acT) throw new Error('JPEG : table manquante pour une composante');
        for (let by = 0; by < c.v; by++) {
          for (let bx = 0; bx < c.h; bx++) {
            bloc.fill(0);
            // DC
            const s = lecteur.decoder(dcT);
            const diff = s === 0 ? 0 : extension(lecteur.recevoir(s), s);
            c.pred += diff;
            bloc[0] = c.pred * qt[0];
            // AC
            let k = 1;
            while (k < 64) {
              const rs = lecteur.decoder(acT);
              const r = rs >> 4, taille = rs & 15;
              if (taille === 0) { if (r === 15) { k += 16; continue; } break; }
              k += r; if (k > 63) break;
              const pos = ZIGZAG[k];
              bloc[pos] = extension(lecteur.recevoir(taille), taille) * qt[pos];
              k++;
            }
            idct8x8(bloc, spatial);
            // Écriture du bloc dans le plan de composante (décalage de niveau +128).
            const px0 = (mx * c.h + bx) * 8, py0 = (my * c.v + by) * 8;
            for (let yy = 0; yy < 8; yy++) {
              const ligne = (py0 + yy) * plan.w + px0;
              for (let xx = 0; xx < 8; xx++) plan.data[ligne + xx] = spatial[yy * 8 + xx] + 128;
            }
          }
        }
      }
      compteMcu++;
    }
  }

  // Composition finale : suréchantillonnage chroma par recopie, YCbCr → RVB.
  const rgba = new Uint8Array(largeur * hauteur * 4);
  if (comps.length === 1) {
    const plan = plans[0];
    for (let y = 0; y < hauteur; y++) for (let x = 0; x < largeur; x++) {
      const g = plan.data[y * plan.w + x], o = (y * largeur + x) * 4;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = 255;
    }
  } else {
    const [pY, pCb, pCr] = plans;
    for (let y = 0; y < hauteur; y++) {
      for (let x = 0; x < largeur; x++) {
        const yy = pY.data[Math.min(pY.h - 1, (y * pY.comp.v / vmax) | 0) * pY.w + Math.min(pY.w - 1, (x * pY.comp.h / hmax) | 0)];
        const cb = pCb.data[Math.min(pCb.h - 1, (y * pCb.comp.v / vmax) | 0) * pCb.w + Math.min(pCb.w - 1, (x * pCb.comp.h / hmax) | 0)] - 128;
        const cr = pCr.data[Math.min(pCr.h - 1, (y * pCr.comp.v / vmax) | 0) * pCr.w + Math.min(pCr.w - 1, (x * pCr.comp.h / hmax) | 0)] - 128;
        const o = (y * largeur + x) * 4;
        rgba[o] = borne(yy + 1.402 * cr);
        rgba[o + 1] = borne(yy - 0.344136 * cb - 0.714136 * cr);
        rgba[o + 2] = borne(yy + 1.772 * cb);
        rgba[o + 3] = 255;
      }
    }
  }
  return { largeur, hauteur, rgba };
}

function borne(v: number): number { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }
