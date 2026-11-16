// Décodage PNG natif, écrit dans Odin (aucune dépendance). Format : norme PNG publique, octets gros-boutiens.
//
// LE FICHIER EST TRAITÉ COMME HOSTILE : toutes les bornes (dimensions, taille des morceaux, taille décompressée) sont
// vérifiées AVANT d'allouer. Un IHDR démesuré ne doit JAMAIS faire allouer un tampon géant : on refuse d'abord. Un PNG
// malformé renvoie une erreur lisible, il ne plante pas Odin.

import { inflateSync } from 'node:zlib';
import type { ImageDecodee } from './index.ts';
import { MAX_PIXELS } from './image.ts';

/** Taille maximale d'un morceau (chunk) accepté : 64 Mo. Au-delà, le fichier est refusé. */
const MAX_CHUNK = 64 * 1024 * 1024;
/** Taille maximale de la somme des morceaux IDAT compressés (mémoire bornée). */
const MAX_IDAT = 128 * 1024 * 1024;

/** Lit un entier non signé 32 bits gros-boutien. */
function u32be(b: Buffer, p: number): number {
  return (b[p] * 0x1000000) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
}

/** Prédicteur Paeth (norme PNG). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Décode un PNG non entrelacé en image RGBA 8 bits. */
export function decoderPng(buf: Buffer): ImageDecodee {
  let largeur = 0, hauteur = 0, profondeur = 0, typeCouleur = 0, entrelacement = 0;
  let palette: Uint8Array | undefined;
  let transPalette: Uint8Array | undefined; // tRNS pour palette
  let transCouleur: number[] | undefined;   // tRNS pour gris / couleur vraie
  const morceauxIdat: Buffer[] = [];
  let totalIdat = 0;
  let vuIhdr = false;

  // Parcours des morceaux : longueur(4) + type(4) + données + CRC(4). On ne construit jamais de chemin ni de commande.
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = u32be(buf, p);
    if (len > MAX_CHUNK) throw new Error('PNG : morceau démesuré (fichier refusé)');
    const type = buf.toString('latin1', p + 4, p + 8);
    const debut = p + 8;
    if (debut + len + 4 > buf.length) throw new Error('PNG : morceau tronqué');
    const data = buf.subarray(debut, debut + len);
    if (type === 'IHDR') {
      if (len < 13) throw new Error('PNG : IHDR trop court');
      largeur = u32be(data, 0);
      hauteur = u32be(data, 4);
      profondeur = data[8];
      typeCouleur = data[9];
      entrelacement = data[12];
      // BORNES AVANT TOUTE ALLOCATION : des dimensions démesurées sont refusées ici, rien n'est alloué.
      if (largeur <= 0 || hauteur <= 0) throw new Error('PNG : dimensions nulles');
      if (largeur > 1_000_000 || hauteur > 1_000_000) throw new Error('PNG : dimension démesurée (fichier refusé)');
      if (largeur * hauteur > MAX_PIXELS) throw new Error(`PNG : image trop grande (${largeur}×${hauteur}, max ${MAX_PIXELS} pixels)`);
      if (![1, 2, 4, 8, 16].includes(profondeur)) throw new Error(`PNG : profondeur de bits ${profondeur} non prise en charge`);
      if (![0, 2, 3, 4, 6].includes(typeCouleur)) throw new Error(`PNG : type de couleur ${typeCouleur} inconnu`);
      if (entrelacement === 1) throw new Error('PNG : entrelacement Adam7 non pris en charge (convertir l\'image)');
      if (entrelacement !== 0) throw new Error(`PNG : entrelacement ${entrelacement} inconnu`);
      vuIhdr = true;
    } else if (type === 'PLTE') {
      palette = Uint8Array.from(data);
    } else if (type === 'tRNS') {
      if (typeCouleur === 3) transPalette = Uint8Array.from(data);
      else if (typeCouleur === 0) transCouleur = [u16(data, 0)];
      else if (typeCouleur === 2) transCouleur = [u16(data, 0), u16(data, 2), u16(data, 4)];
    } else if (type === 'IDAT') {
      totalIdat += len;
      if (totalIdat > MAX_IDAT) throw new Error('PNG : données compressées démesurées (fichier refusé)');
      morceauxIdat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    p = debut + len + 4;
  }
  if (!vuIhdr) throw new Error('PNG : en-tête IHDR absent');
  if (morceauxIdat.length === 0) throw new Error('PNG : aucune donnée d\'image');

  const canaux = typeCouleur === 0 ? 1 : typeCouleur === 2 ? 3 : typeCouleur === 3 ? 1 : typeCouleur === 4 ? 2 : 4;
  // Octets par ligne (sans le préfixe de filtre), borné pour éviter un débordement entier.
  const bitsParLigne = largeur * canaux * profondeur;
  const octetsParLigne = Math.ceil(bitsParLigne / 8);
  const attendu = hauteur * (1 + octetsParLigne);
  if (!Number.isSafeInteger(attendu)) throw new Error('PNG : image trop grande');

  // Décompression bornée : inflateSync refuse au-delà de la taille attendue (maxOutputLength).
  let brut: Buffer;
  try {
    brut = inflateSync(Buffer.concat(morceauxIdat), { maxOutputLength: attendu + 1024 });
  } catch {
    throw new Error('PNG : données compressées illisibles');
  }
  if (brut.length < attendu) throw new Error('PNG : données d\'image tronquées');

  // Défiltrage ligne par ligne (None/Sub/Up/Average/Paeth).
  const bpp = Math.max(1, Math.ceil((canaux * profondeur) / 8));
  const lignes = new Uint8Array(hauteur * octetsParLigne);
  let prec = new Uint8Array(octetsParLigne); // ligne précédente (zéros au départ)
  for (let y = 0; y < hauteur; y++) {
    const srcLigne = y * (1 + octetsParLigne);
    const filtre = brut[srcLigne];
    const cur = lignes.subarray(y * octetsParLigne, (y + 1) * octetsParLigne);
    for (let i = 0; i < octetsParLigne; i++) {
      const x = brut[srcLigne + 1 + i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prec[i];
      const c = i >= bpp ? prec[i - bpp] : 0;
      let v: number;
      switch (filtre) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error(`PNG : filtre de ligne ${filtre} inconnu`);
      }
      cur[i] = v & 0xff;
    }
    prec = cur;
  }

  // Conversion vers RGBA 8 bits.
  const rgba = new Uint8Array(largeur * hauteur * 4);
  const lireEch = lecteurEchantillons(lignes, octetsParLigne, profondeur);
  const maxVal = (1 << profondeur) - 1;
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const o = (y * largeur + x) * 4;
      if (typeCouleur === 3) {
        const idx = lireEch(y, x * canaux);
        if (!palette || idx * 3 + 2 >= palette.length) throw new Error('PNG : index de palette hors bornes');
        rgba[o] = palette[idx * 3]; rgba[o + 1] = palette[idx * 3 + 1]; rgba[o + 2] = palette[idx * 3 + 2];
        rgba[o + 3] = transPalette && idx < transPalette.length ? transPalette[idx] : 255;
      } else if (typeCouleur === 0 || typeCouleur === 4) {
        const g = ramener(lireEch(y, x * canaux), maxVal);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        if (typeCouleur === 4) rgba[o + 3] = ramener(lireEch(y, x * canaux + 1), maxVal);
        else if (transCouleur && lireEch(y, x * canaux) === transCouleur[0]) rgba[o + 3] = 0;
        else rgba[o + 3] = 255;
      } else { // 2 ou 6 : couleur vraie
        const r = lireEch(y, x * canaux), vv = lireEch(y, x * canaux + 1), bb = lireEch(y, x * canaux + 2);
        rgba[o] = ramener(r, maxVal); rgba[o + 1] = ramener(vv, maxVal); rgba[o + 2] = ramener(bb, maxVal);
        if (typeCouleur === 6) rgba[o + 3] = ramener(lireEch(y, x * canaux + 3), maxVal);
        else if (transCouleur && r === transCouleur[0] && vv === transCouleur[1] && bb === transCouleur[2]) rgba[o + 3] = 0;
        else rgba[o + 3] = 255;
      }
    }
  }
  return { largeur, hauteur, rgba };
}

function u16(b: Uint8Array, p: number): number { return (b[p] << 8) | b[p + 1]; }

/** Ramène un échantillon de la profondeur de bits vers 0..255. */
function ramener(v: number, maxVal: number): number {
  if (maxVal === 255) return v;
  return Math.round((v / maxVal) * 255);
}

/** Construit un lecteur d'échantillons à l'indice (ligne, numéro d'échantillon) selon la profondeur de bits.
 *  Pour 16 bits, on prend l'octet de poids fort (suffisant pour la vision) ; pour <8 bits, on dépaquette les bits. */
function lecteurEchantillons(lignes: Uint8Array, octetsParLigne: number, profondeur: number): (y: number, i: number) => number {
  if (profondeur === 8) {
    return (y, i) => lignes[y * octetsParLigne + i];
  }
  if (profondeur === 16) {
    return (y, i) => lignes[y * octetsParLigne + i * 2]; // octet de poids fort
  }
  // 1, 2 ou 4 bits : échantillons empaquetés du bit de poids fort vers le faible.
  const parOctet = 8 / profondeur, masque = (1 << profondeur) - 1;
  return (y, i) => {
    const octet = lignes[y * octetsParLigne + Math.floor(i / parOctet)];
    const decalage = (parOctet - 1 - (i % parOctet)) * profondeur;
    return (octet >> decalage) & masque;
  };
}
