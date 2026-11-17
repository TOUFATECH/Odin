// Fabricant d'essais pour les médias reçus : des fichiers fabriqués OCTET PAR OCTET, avec des valeurs connues (aucun
// fichier binaire dans le dépôt, aucune vraie photo, voix, adresse ni position : coordonnées d'essai imposées,
// noms fictifs). Ce n'est pas un essai : seulement des fonctions qui rendent des Buffer.

import { crc32, deflateSync } from 'node:zlib';

// ─────────────────────────────── Outils ───────────────────────────────

export const u8 = (n: number) => Buffer.from([n & 255]);
export const u16be = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff); return b; };
export const u16le = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
export const u24be = (n: number) => { const b = Buffer.alloc(3); b.writeUIntBE(n, 0, 3); return b; };
export const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
export const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
export const u64be = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
export const u64le = (n: number | bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
export const lat = (s: string) => Buffer.from(s, 'latin1');
export const utf8 = (s: string) => Buffer.from(s, 'utf8');
const cat = (...b: Buffer[]) => Buffer.concat(b);
const syncsafe = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);

// ─────────────────────────────── TIFF / EXIF ───────────────────────────────

export type E = [tag: number, type: number, count: number, data: Buffer];
export const A = (tag: number, s: string): E => { const d = utf8(`${s}\0`); return [tag, 2, d.length, d]; };
export const S = (tag: number, ...v: number[]): E => [tag, 3, v.length, cat(...v.map(u16le))];
export const L = (tag: number, ...v: number[]): E => [tag, 4, v.length, cat(...v.map(u32le))];
export const R = (tag: number, ...v: Array<[number, number]>): E => [tag, 5, v.length, cat(...v.flatMap(([a, b]) => [u32le(a), u32le(b)]))];
export const SR = (tag: number, ...v: Array<[number, number]>): E => [tag, 10, v.length, cat(...v.flatMap(([a, b]) => { const x = Buffer.alloc(8); x.writeInt32LE(a); x.writeInt32LE(b, 4); return [x]; }))];
export const U = (tag: number, d: Buffer, type = 7): E => [tag, type, d.length, d];

/** TIFF petit-boutiste : IFD0 (+ Exif, GPS, IFD1 et vignette), pointeurs calculés. */
export function construireTiff(o: { ifd0: E[]; exif?: E[]; gps?: E[]; ifd1?: E[]; vignette?: Buffer }): Buffer {
  const taille = (es: E[]) => 2 + es.length * 12 + 4 + es.reduce((s, e) => s + (e[3].length > 4 ? e[3].length + (e[3].length & 1) : 0), 0);
  const ifd0 = [...o.ifd0];
  if (o.exif) ifd0.push(L(0x8769, 0));
  if (o.gps) ifd0.push(L(0x8825, 0));
  const ifd1 = o.ifd1 ? [...o.ifd1] : o.vignette ? [L(0x0201, 0), L(0x0202, o.vignette.length)] : undefined;
  const pos0 = 8, posExif = pos0 + taille(ifd0), posGps = posExif + (o.exif ? taille(o.exif) : 0), pos1 = posGps + (o.gps ? taille(o.gps) : 0);
  const posVig = pos1 + (ifd1 ? taille(ifd1) : 0);
  const fixer = (es: E[], tag: number, v: number) => { const i = es.findIndex((e) => e[0] === tag); if (i >= 0) es[i] = L(tag, v); };
  fixer(ifd0, 0x8769, posExif); fixer(ifd0, 0x8825, posGps);
  if (ifd1 && o.vignette) fixer(ifd1, 0x0201, posVig);
  const ecrire = (es: E[], debut: number, suivant: number) => {
    const tri = [...es].sort((a, b) => a[0] - b[0]);
    const tete = Buffer.alloc(2 + tri.length * 12 + 4);
    tete.writeUInt16LE(tri.length, 0);
    let data = debut + tete.length;
    const blocs: Buffer[] = [];
    tri.forEach(([tag, type, count, d], i) => {
      const p = 2 + i * 12;
      tete.writeUInt16LE(tag, p); tete.writeUInt16LE(type, p + 2); tete.writeUInt32LE(count, p + 4);
      if (d.length <= 4) d.copy(tete, p + 8);
      else { tete.writeUInt32LE(data, p + 8); const pad = d.length & 1 ? cat(d, Buffer.alloc(1)) : d; blocs.push(pad); data += pad.length; }
    });
    tete.writeUInt32LE(suivant, 2 + tri.length * 12);
    return cat(tete, ...blocs);
  };
  return cat(lat('II*\0'), u32le(8), ecrire(ifd0, pos0, ifd1 ? pos1 : 0), o.exif ? ecrire(o.exif, posExif, 0) : Buffer.alloc(0),
    o.gps ? ecrire(o.gps, posGps, 0) : Buffer.alloc(0), ifd1 ? ecrire(ifd1, pos1, 0) : Buffer.alloc(0), o.vignette ?? Buffer.alloc(0));
}

const dms = (x: number): Array<[number, number]> => {
  const a = Math.abs(x), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 10000);
  return [[d, 1], [m, 1], [s, 10000]];
};

export interface OptsPhoto {
  date?: string; offset?: string; marque?: string; modele?: string; lat?: number; lon?: number; alt?: number; gpsDate?: string; gpsHeure?: [number, number, number];
  logiciel?: string; orientation?: number; serie?: string; xmp?: string; iptc?: Array<[number, number, string]>; vignette?: boolean; largeur?: number; hauteur?: number;
  gpsDenNul?: boolean; reglages?: boolean; queue?: number; commentaire?: string;
}

/** Le bloc TIFF d'une photo (EXIF). */
export function tiffPhoto(o: OptsPhoto): Buffer {
  const ifd0: E[] = [];
  if (o.marque) ifd0.push(A(0x010f, o.marque));
  if (o.modele) ifd0.push(A(0x0110, o.modele));
  if (o.orientation) ifd0.push(S(0x0112, o.orientation));
  if (o.logiciel) ifd0.push(A(0x0131, o.logiciel));
  if (o.date) ifd0.push(A(0x0132, o.date));
  const exif: E[] = [];
  if (o.date) exif.push(A(0x9003, o.date));
  if (o.offset) exif.push(A(0x9011, o.offset));
  if (o.serie) exif.push(A(0xa431, o.serie));
  if (o.reglages) exif.push(R(0x829a, [1, 250]), R(0x829d, [28, 10]), S(0x8827, 100), R(0x920a, [42, 10]), S(0x9209, 16), SR(0x9204, [1, 3]));
  let gps: E[] | undefined;
  if (o.lat !== undefined && o.lon !== undefined) {
    gps = [A(1, o.lat < 0 ? 'S' : 'N'), R(2, ...(o.gpsDenNul ? [[12, 0], [46, 1], [50, 1]] as Array<[number, number]> : dms(o.lat))), A(3, o.lon < 0 ? 'W' : 'E'), R(4, ...dms(o.lon))];
    if (o.alt !== undefined) gps.push(U(5, Buffer.from([o.alt < 0 ? 1 : 0]), 1), R(6, [Math.round(Math.abs(o.alt) * 10), 10]));
    if (o.gpsHeure) gps.push(R(7, [o.gpsHeure[0], 1], [o.gpsHeure[1], 1], [o.gpsHeure[2], 1]));
    if (o.gpsDate) gps.push(A(0x1d, o.gpsDate));
  }
  return construireTiff({ ifd0, exif: exif.length ? exif : undefined, gps, vignette: o.vignette ? jpegNu(16, 8) : undefined });
}

/** JPEG minimal (sans métadonnées) : SOI, DQT, SOF0, DHT, SOS, quelques octets, EOI. */
export function jpegNu(largeur = 640, hauteur = 480, segments: Buffer[] = []): Buffer {
  const seg = (m: number, d: Buffer) => cat(Buffer.from([0xff, m]), u16be(d.length + 2), d);
  const sof = seg(0xc0, cat(u8(8), u16be(hauteur), u16be(largeur), u8(3), Buffer.from([1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])));
  const dqt = seg(0xdb, cat(u8(0), Buffer.alloc(64, 1)));
  const sos = seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]));
  return cat(Buffer.from([0xff, 0xd8]), ...segments, dqt, sof, sos, Buffer.from([0x12, 0x34, 0x56, 0x78]), Buffer.from([0xff, 0xd9]));
}

/** Photo JPEG avec EXIF (et XMP, IPTC, vignette au choix). */
export function jpegExif(o: OptsPhoto): Buffer {
  const seg = (m: number, d: Buffer) => cat(Buffer.from([0xff, m]), u16be(d.length + 2), d);
  const segments = [seg(0xe1, cat(lat('Exif\0\0'), tiffPhoto(o)))];
  if (o.xmp) segments.push(seg(0xe1, cat(lat('http://ns.adobe.com/xap/1.0/\0'), utf8(o.xmp))));
  if (o.iptc) segments.push(seg(0xed, cat(lat('Photoshop 3.0\0'), bloc8bim(0x0404, iptc(o.iptc)))));
  if (o.commentaire) segments.push(seg(0xfe, utf8(o.commentaire)));
  const j = jpegNu(o.largeur ?? 640, o.hauteur ?? 480, segments);
  return o.queue ? cat(j, Buffer.alloc(o.queue, 0x41)) : j;
}

export function iptc(v: Array<[number, number, string]>): Buffer {
  return cat(Buffer.from([0x1c, 1, 90]), u16be(3), Buffer.from([0x1b, 0x25, 0x47]), ...v.map(([r, d, s]) => { const t = utf8(s); return cat(Buffer.from([0x1c, r, d]), u16be(t.length), t); }));
}
export function bloc8bim(id: number, d: Buffer): Buffer {
  return cat(lat('8BIM'), u16be(id), Buffer.from([0, 0]), u32be(d.length), d, d.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0));
}

/** XMP minimal (rdf:Description avec éléments et attributs). */
export function xmpPaquet(corps: string, attrs = ''): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">`
    + `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/" ${attrs}>${corps}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

// ─────────────────────────────── PNG, GIF, WebP, HEIC, TIFF ───────────────────────────────

export function chunkPng(type: string, d: Buffer, crcFaux = false): Buffer {
  const t = lat(type);
  return cat(u32be(d.length), t, d, u32be(crcFaux ? 0 : crc32(d, crc32(t))));
}
export function pngTextes(o: { largeur?: number; hauteur?: number; textes?: Array<[string, string, string]>; exif?: Buffer; exifPrefixe?: boolean; temps?: [number, number, number, number, number, number]; xmp?: string; morceaux?: Buffer[] }): Buffer {
  const ihdr = cat(u32be(o.largeur ?? 64), u32be(o.hauteur ?? 48), Buffer.from([8, 2, 0, 0, 0]));
  const ch: Buffer[] = [chunkPng('IHDR', ihdr)];
  for (const [type, cle, v] of o.textes ?? []) {
    if (type === 'tEXt') ch.push(chunkPng('tEXt', cat(lat(cle), u8(0), lat(v))));
    else if (type === 'zTXt') ch.push(chunkPng('zTXt', cat(lat(cle), Buffer.from([0, 0]), deflateSync(lat(v)))));
    else ch.push(chunkPng('iTXt', cat(lat(cle), Buffer.from([0, 0, 0]), lat('fr'), u8(0), u8(0), utf8(v))));
  }
  if (o.xmp) ch.push(chunkPng('iTXt', cat(lat('XML:com.adobe.xmp'), Buffer.from([0, 0, 0, 0, 0]), utf8(o.xmp))));
  if (o.exif) ch.push(chunkPng('eXIf', o.exifPrefixe ? cat(lat('Exif\0\0'), o.exif) : o.exif));
  if (o.temps) { const [a, mo, j, h, mi, s] = o.temps; ch.push(chunkPng('tIME', cat(u16be(a), Buffer.from([mo, j, h, mi, s])))); }
  ch.push(...(o.morceaux ?? []));
  ch.push(chunkPng('IDAT', deflateSync(Buffer.alloc(16))));
  ch.push(chunkPng('IEND', Buffer.alloc(0)));
  return cat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...ch);
}

export function gif(o: { images?: number; delai?: number; boucle?: boolean; commentaire?: string } = {}): Buffer {
  const parts: Buffer[] = [lat('GIF89a'), u16le(16), u16le(16), Buffer.from([0x80, 0, 0]), Buffer.alloc(6)];
  if (o.boucle) parts.push(Buffer.from([0x21, 0xff, 11]), lat('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0]));
  if (o.commentaire) { const c = lat(o.commentaire); parts.push(Buffer.from([0x21, 0xfe, c.length]), c, u8(0)); }
  for (let i = 0; i < (o.images ?? 1); i++) {
    parts.push(Buffer.from([0x21, 0xf9, 4, 0]), u16le(o.delai ?? 10), Buffer.from([0, 0]));
    parts.push(u8(0x2c), u16le(0), u16le(0), u16le(16), u16le(16), u8(0), u8(2), Buffer.from([2, 0x4c, 0x01]), u8(0));
  }
  parts.push(u8(0x3b));
  return cat(...parts);
}

export function riff(forme: string, morceaux: Buffer[], tailleForcee?: number): Buffer {
  const corps = cat(lat(forme), ...morceaux);
  return cat(lat('RIFF'), u32le(tailleForcee ?? corps.length), corps);
}
export function morceau(id: string, d: Buffer): Buffer { return cat(lat(id), u32le(d.length), d, d.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)); }

export function webp(o: { largeur?: number; hauteur?: number; exif?: Buffer; xmp?: string } = {}): Buffer {
  const L = (o.largeur ?? 64) - 1, H = (o.hauteur ?? 48) - 1;
  const drapeaux = (o.exif ? 0x08 : 0) | (o.xmp ? 0x04 : 0);
  const m = [morceau('VP8X', cat(u8(drapeaux), Buffer.alloc(3), Buffer.from([L & 255, (L >> 8) & 255, L >> 16, H & 255, (H >> 8) & 255, H >> 16])))];
  m.push(morceau('VP8 ', cat(Buffer.from([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a]), u16le(L + 1), u16le(H + 1), Buffer.alloc(8))));
  if (o.exif) m.push(morceau('EXIF', o.exif));
  if (o.xmp) m.push(morceau('XMP ', utf8(o.xmp)));
  return riff('WEBP', m);
}

export function boite(type: string, ...d: Buffer[]): Buffer { const c = cat(...d); return cat(u32be(c.length + 8), lat(type), c); }
export function pleine(type: string, v: number, fl: number, ...d: Buffer[]): Buffer { return boite(type, u8(v), u24be(fl), ...d); }

/** HEIC : ftyp heic, meta (hdlr pict, pitm, iinf, iloc, iprp/ipco/ipma, iref cdsc), mdat avec l'EXIF. */
export function heic(o: { largeur: number; hauteur: number; irot?: number; exif?: Buffer }): Buffer {
  const ftyp = boite('ftyp', lat('heic'), u32be(0), lat('mif1heic'));
  const exifData = o.exif ? cat(u32be(0), o.exif) : Buffer.alloc(0);
  const fabriquerMeta = (offExif: number) => {
    const infe = (id: number, type: string) => pleine('infe', 2, 0, u16be(id), u16be(0), lat(type), u8(0));
    const iinf = pleine('iinf', 0, 0, u16be(o.exif ? 2 : 1), infe(1, 'hvc1'), ...(o.exif ? [infe(2, 'Exif')] : []));
    const iloc = pleine('iloc', 1, 0, Buffer.from([0x44, 0x00]), u16be(o.exif ? 1 : 0), ...(o.exif ? [cat(u16be(2), u16be(0), u16be(0), u16be(1), u32be(offExif), u32be(exifData.length))] : []));
    const ispe = pleine('ispe', 0, 0, u32be(o.largeur), u32be(o.hauteur));
    const props = [ispe, ...(o.irot !== undefined ? [boite('irot', u8(o.irot))] : [])];
    const ipco = boite('ipco', ...props);
    const ipma = pleine('ipma', 0, 0, u32be(1), u16be(1), u8(props.length), ...props.map((_, i) => u8(i + 1)));
    const iref = o.exif ? pleine('iref', 0, 0, boite('cdsc', u16be(2), u16be(1), u16be(1))) : Buffer.alloc(0);
    return pleine('meta', 0, 0, pleine('hdlr', 0, 0, u32be(0), lat('pict'), Buffer.alloc(12), u8(0)), pleine('pitm', 0, 0, u16be(1)), iinf, iloc, boite('iprp', ipco, ipma), iref);
  };
  const m0 = fabriquerMeta(0);
  const off = ftyp.length + m0.length + 8;
  return cat(ftyp, fabriquerMeta(off), boite('mdat', exifData));
}

// ─────────────────────────────── ID3, MP3, APE ───────────────────────────────

/** Trame ID3 de texte : encodage 3 (UTF-8) par défaut ; valeurs séparées par NUL. */
export function texteId3(valeurs: string | string[], enc = 3): Buffer {
  const v = Array.isArray(valeurs) ? valeurs : [valeurs];
  if (enc === 0) return cat(u8(0), lat(v.join('\0')));
  if (enc === 1) return cat(u8(1), Buffer.from([0xff, 0xfe]), Buffer.from(v.join('\0'), 'utf16le'));
  return cat(u8(3), utf8(v.join('\0')));
}
export const txxx = (desc: string, v: string) => cat(u8(3), utf8(desc), u8(0), utf8(v));
export const comm = (langue: string, desc: string, v: string) => cat(u8(3), lat(langue), utf8(desc), u8(0), utf8(v));
export const apic = (mime: string, type: number, desc: string, img: Buffer) => cat(u8(0), lat(mime), u8(0), u8(type), lat(desc), u8(0), img);

/** Désynchronisation ID3 : un 00 après chaque FF suivi d'un octet ≥ E0 ou de 00 (et en fin). */
export function synchroniser(b: Buffer): Buffer {
  const r: number[] = [];
  for (let i = 0; i < b.length; i++) { r.push(b[i]); if (b[i] === 0xff && (i + 1 === b.length || b[i + 1] >= 0xe0 || b[i + 1] === 0)) r.push(0); }
  return Buffer.from(r);
}

export function balisId3(o: { version: 3 | 4; trames: Array<[string, Buffer]>; tailleU32?: boolean; desynchronise?: boolean }): Buffer {
  const corps = cat(...o.trames.map(([id, d]) => cat(lat(id), o.version === 4 && !o.tailleU32 ? syncsafe(d.length) : u32be(d.length), Buffer.from([0, 0]), d)));
  const c = o.desynchronise ? synchroniser(corps) : corps;
  return cat(lat('ID3'), Buffer.from([o.version, 0, o.desynchronise ? 0x80 : 0]), syncsafe(c.length), c);
}

/** Trames MPEG-1 couche III 128 kb/s 44,1 kHz (FF FB 90 64), 417 octets chacune ; la 1re porte Xing si demandé. */
export function tramesMp3(n: number, xing?: number): Buffer {
  const t: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const b = Buffer.alloc(417);
    b.set([0xff, 0xfb, 0x90, 0x64]);
    if (i === 0 && xing !== undefined) { b.write('Xing', 36, 'latin1'); b.writeUInt32BE(1, 40); b.writeUInt32BE(xing, 44); }
    t.push(b);
  }
  return cat(...t);
}
export function mp3Id3(o: { version: 3 | 4; trames: Array<[string, Buffer]>; xing?: number; tailleU32?: boolean; desynchronise?: boolean; nbTrames?: number; queue?: Buffer }): Buffer {
  return cat(balisId3(o), tramesMp3(o.nbTrames ?? 10, o.xing), o.queue ?? Buffer.alloc(0));
}
export function id3v1(o: { titre?: Buffer | string; artiste?: string; album?: string; annee?: string; commentaire?: string; piste?: number; genre?: number }): Buffer {
  const b = Buffer.alloc(128);
  b.write('TAG', 0, 'latin1');
  const champ = (v: Buffer | string | undefined, p: number, n: number) => { if (v === undefined) return; (typeof v === 'string' ? lat(v) : v).copy(b, p, 0, n); };
  champ(o.titre, 3, 30); champ(o.artiste, 33, 30); champ(o.album, 63, 30); champ(o.annee, 93, 4); champ(o.commentaire, 97, o.piste ? 28 : 30);
  if (o.piste) { b[125] = 0; b[126] = o.piste; }
  b[127] = o.genre ?? 255;
  return b;
}
export function ape(items: Array<[string, string]>): Buffer {
  const corps = cat(...items.map(([k, v]) => { const d = utf8(v); return cat(u32le(d.length), u32le(0), lat(k), u8(0), d); }));
  const pied = cat(lat('APETAGEX'), u32le(2000), u32le(corps.length + 32), u32le(items.length), u32le(0), Buffer.alloc(8));
  return cat(corps, pied);
}

// ─────────────────────────────── Vorbis, FLAC, Ogg ───────────────────────────────

export function commentairesVorbis(vendeur: string, c: string[]): Buffer {
  return cat(u32le(utf8(vendeur).length), utf8(vendeur), u32le(c.length), ...c.map((x) => cat(u32le(utf8(x).length), utf8(x))));
}
export function blocPicture(type: number, mime: string, img: Buffer, L = 1, H = 1): Buffer {
  return cat(u32be(type), u32be(mime.length), lat(mime), u32be(0), u32be(L), u32be(H), u32be(24), u32be(0), u32be(img.length), img);
}
export function streaminfo(fs: number, canaux: number, bits: number, total: number): Buffer {
  const b = Buffer.alloc(34);
  b.writeUInt16BE(4096, 0); b.writeUInt16BE(4096, 2);
  b[10] = (fs >> 12) & 255; b[11] = (fs >> 4) & 255; b[12] = ((fs & 15) << 4) | ((canaux - 1) << 1) | ((bits - 1) >> 4);
  b[13] = (((bits - 1) & 15) << 4) | Math.floor(total / 2 ** 32);
  b.writeUInt32BE(total >>> 0, 14);
  return b;
}
export function flacVorbis(o: { commentaires: string[]; image?: Buffer; total?: number; blocs?: Buffer[] }): Buffer {
  const bloc = (type: number, d: Buffer, dernier = false) => cat(u8(type | (dernier ? 0x80 : 0)), u24be(d.length), d);
  const blocs = [bloc(0, streaminfo(44100, 2, 16, o.total ?? 441000)), bloc(4, commentairesVorbis('reference libFLAC 1.4.3', o.commentaires)), ...(o.blocs ?? [])];
  if (o.image) blocs.push(bloc(6, blocPicture(3, 'image/png', o.image, 1, 1)));
  blocs.push(bloc(1, Buffer.alloc(8), true));
  return cat(lat('fLaC'), ...blocs, Buffer.from([0xff, 0xf8, 0x69, 0x08]), Buffer.alloc(64));
}
export function pageOgg(serie: number, seq: number, type: number, granule: bigint, paquet: Buffer): Buffer {
  const segs: number[] = [];
  let n = paquet.length;
  while (n >= 255) { segs.push(255); n -= 255; }
  segs.push(n);
  const h = Buffer.alloc(27);
  h.write('OggS', 0, 'latin1'); h[4] = 0; h[5] = type; h.writeBigInt64LE(granule, 6); h.writeUInt32LE(serie, 14); h.writeUInt32LE(seq, 18); h.writeUInt32LE(0, 22); h[26] = segs.length;
  return cat(h, Buffer.from(segs), paquet);
}
export function oggOpus(o: { commentaires: string[]; granule: number; preskip?: number }): Buffer {
  const head = cat(lat('OpusHead'), Buffer.from([1, 2]), u16le(o.preskip ?? 312), u32le(44100), u16le(0), u8(0));
  const tags = cat(lat('OpusTags'), commentairesVorbis('libopus 1.5', o.commentaires));
  return cat(pageOgg(7, 0, 2, 0n, head), pageOgg(7, 1, 0, 0n, tags), pageOgg(7, 2, 0, 1000n, Buffer.alloc(100)), pageOgg(7, 3, 4, BigInt(o.granule), Buffer.alloc(100)));
}
export function oggVorbis(o: { commentaires: string[]; granule: number }): Buffer {
  const id = cat(u8(1), lat('vorbis'), u32le(0), u8(2), u32le(44100), u32le(0), u32le(128000), u32le(0), u8(0xb8), u8(1));
  const com = cat(u8(3), lat('vorbis'), commentairesVorbis('Xiph.Org libVorbis I 20200704', o.commentaires), u8(1));
  return cat(pageOgg(9, 0, 2, 0n, id), pageOgg(9, 1, 0, 0n, cat(com, cat(u8(5), lat('vorbis'), Buffer.alloc(20)))), pageOgg(9, 2, 4, BigInt(o.granule), Buffer.alloc(50)));
}

// ─────────────────────────────── MP4 / M4A ───────────────────────────────

const data = (type: number, d: Buffer) => boite('data', u32be(type), u32be(0), d);
export const atome = (nom: string, v: string) => boite(nom, data(1, utf8(v)));
export const libre = (nom: string, v: string) => boite('----', pleine('mean', 0, 0, lat('com.apple.iTunes')), pleine('name', 0, 0, lat(nom)), data(1, utf8(v)));
const mvhd = (creation: number, echelle: number, duree: number) => pleine('mvhd', 0, 0, u32be(creation), u32be(creation), u32be(echelle), u32be(duree), u32be(0x10000), u16be(0x100), Buffer.alloc(10), matrice(0), Buffer.alloc(24), u32be(3));
function matrice(rotation: number): Buffer {
  const [a, b] = rotation === 90 ? [0, 1] : rotation === 180 ? [-1, 0] : rotation === 270 ? [0, -1] : [1, 0];
  const m = Buffer.alloc(36);
  m.writeInt32BE(a * 0x10000, 0); m.writeInt32BE(b * 0x10000, 4); m.writeInt32BE(-b * 0x10000, 12); m.writeInt32BE(a * 0x10000, 16); m.writeInt32BE(0x40000000, 32);
  return m;
}
const tkhd = (id: number, duree: number, L: number, H: number, rotation = 0) => pleine('tkhd', 0, 3, u32be(0), u32be(0), u32be(id), u32be(0), u32be(duree), Buffer.alloc(8), u16be(0), u16be(0), u16be(L ? 0 : 0x100), u16be(0), matrice(rotation), u32be(L * 0x10000), u32be(H * 0x10000));
const langue3 = (s: string) => ((s.charCodeAt(0) - 0x60) << 10) | ((s.charCodeAt(1) - 0x60) << 5) | (s.charCodeAt(2) - 0x60);
const mdhd = (echelle: number, duree: number, langue = 'und') => pleine('mdhd', 0, 0, u32be(0), u32be(0), u32be(echelle), u32be(duree), u16be(langue === 'und' ? 0x55c4 : langue3(langue)), u16be(0));
const hdlr = (type: string, nom: string) => pleine('hdlr', 0, 0, u32be(0), lat(type), Buffer.alloc(12), utf8(nom), u8(0));
function esds(): Buffer {
  const asc = Buffer.from([0x12, 0x10]);        // AAC-LC, 44 100 Hz, 2 canaux
  const dsi = cat(Buffer.from([5, asc.length]), asc);
  const dcd = cat(Buffer.from([4, 13 + dsi.length, 0x40, 0x15]), u24be(0), u32be(128000), u32be(128000), dsi);
  const es = cat(Buffer.from([3, 3 + dcd.length + 3]), u16be(1), u8(0), dcd, Buffer.from([6, 1, 2]));
  return pleine('esds', 0, 0, es);
}
const mp4a = () => boite('mp4a', Buffer.alloc(6), u16be(1), Buffer.alloc(8), u16be(2), u16be(16), u16be(0), u16be(0), u32be(44100 * 0x10000), esds());
const avc1 = (L: number, H: number) => boite('avc1', Buffer.alloc(6), u16be(1), Buffer.alloc(16), u16be(L), u16be(H), u32be(0x480000), u32be(0x480000), u32be(0), u16be(1), Buffer.alloc(32), u16be(24), u16be(0xffff), boite('avcC', Buffer.from([1, 100, 0, 41, 0xff, 0xe0, 0x00])));
const stbl = (entree: Buffer, stts?: Buffer) => boite('stbl', pleine('stsd', 0, 0, u32be(1), entree), stts ?? pleine('stts', 0, 0, u32be(0)));
const piste = (o: { id: number; type: 'vide' | 'soun'; L?: number; H?: number; rotation?: number; langue?: string; nomHdlr?: string; echelle: number; duree: number; stts?: Buffer }) =>
  boite('trak', tkhd(o.id, o.duree, o.L ?? 0, o.H ?? 0, o.rotation), boite('mdia', mdhd(o.echelle, o.duree, o.langue), hdlr(o.type, o.nomHdlr ?? ''), boite('minf', stbl(o.type === 'vide' ? avc1(o.L!, o.H!) : mp4a(), o.stts))));

/** M4A : piste son + udta/meta/ilst. `atomes` : boîtes déjà faites (atome(), libre(), covr…). */
export function m4aIlst(o: { atomes: Buffer[]; dureeSec?: number }): Buffer {
  const ftyp = boite('ftyp', lat('M4A '), u32be(0), lat('M4A mp42isom'));
  const d = Math.round((o.dureeSec ?? 20) * 44100);
  const meta = pleine('meta', 0, 0, hdlr('mdir', ''), boite('ilst', ...o.atomes));
  const moov = boite('moov', mvhd(0, 44100, d), piste({ id: 1, type: 'soun', echelle: 44100, duree: d }), boite('udta', meta));
  return cat(ftyp, moov, boite('mdat', Buffer.alloc(32)));
}
export const covr = (img: Buffer, type = 14) => boite('covr', data(type, img));
export const trkn = (n: number, t: number) => boite('trkn', data(0, cat(u16be(0), u16be(n), u16be(t), u16be(0))));

/** Vidéo MP4 : piste vidéo (rotation, 25 i/s) et son (langue), mdta (keys + ilst indexé), udta ©xyz, moov au début ou en fin. */
export function mp4Video(o: { mdta?: Record<string, string>; xyz?: string; ilst?: Buffer[]; rotation?: number; langue?: string; moovEnFin?: boolean; marque?: string; creation1904?: number; sansVideo?: boolean }): Buffer {
  const ftyp = boite('ftyp', lat(o.marque ?? 'isom'), u32be(512), lat('isomiso2avc1mp41'));
  const echelle = 12800, duree = 5 * echelle;
  const stts = pleine('stts', 0, 0, u32be(1), u32be(125), u32be(512));
  const pistes = [
    ...(o.sansVideo ? [] : [piste({ id: 1, type: 'vide', L: 854, H: 480, rotation: o.rotation, echelle, duree, stts })]),
    piste({ id: 2, type: 'soun', echelle: 44100, duree: 5 * 44100, langue: o.langue ?? 'und', nomHdlr: 'SoundHandler' }),
  ];
  const enfants: Buffer[] = [mvhd(o.creation1904 ?? 0, 1000, 5000), ...pistes];
  if (o.mdta) {
    const cles = Object.keys(o.mdta);
    const keys = pleine('keys', 0, 0, u32be(cles.length), ...cles.map((k) => cat(u32be(utf8(k).length + 8), lat('mdta'), utf8(k))));
    const ilst = boite('ilst', ...cles.map((k, i) => cat(u32be(8 + 16 + utf8(o.mdta![k]).length), u32be(i + 1), data(1, utf8(o.mdta![k])))));
    enfants.push(boite('meta', hdlr('mdta', ''), keys, ilst));
  }
  const udta: Buffer[] = [];
  if (o.xyz) udta.push(boite('©xyz'.replace('©', '\xa9'), u16be(utf8(o.xyz).length), u16be(0x15c7), utf8(o.xyz)));
  if (o.ilst) udta.push(pleine('meta', 0, 0, hdlr('mdir', ''), boite('ilst', ...o.ilst)));
  if (udta.length) enfants.push(boite('udta', ...udta));
  const moov = boite('moov', ...enfants);
  const mdat = boite('mdat', Buffer.alloc(64));
  return o.moovEnFin ? cat(ftyp, mdat, moov) : cat(ftyp, moov, mdat);
}

// ─────────────────────────────── EBML (Matroska / WebM) ───────────────────────────────

function idEbml(id: number): Buffer { const o: number[] = []; let x = id; while (x > 0) { o.unshift(x & 255); x = Math.floor(x / 256); } return Buffer.from(o); }
export function tailleEbml(n: number): Buffer {
  if (n < 127) return Buffer.from([0x80 | n]);
  if (n < 16383) return Buffer.from([0x40 | (n >> 8), n & 255]);
  return cat(Buffer.from([0x01, 0, 0, 0]), u32be(n));
}
export const el = (id: number, ...d: Buffer[]) => { const c = cat(...d); return cat(idEbml(id), tailleEbml(c.length), c); };
export const elU = (id: number, v: number, n = 0) => { let b: Buffer; if (n === 8) b = u64be(v); else { const o: number[] = []; let x = v; do { o.unshift(x & 255); x = Math.floor(x / 256); } while (x > 0); b = Buffer.from(o); } return el(id, b); };
export const elS = (id: number, s: string) => el(id, utf8(s));
export const elF = (id: number, f: number) => { const b = Buffer.alloc(8); b.writeDoubleBE(f); return el(id, b); };

export function mkv(o: { docType?: string; tags?: Array<[number, string, string]>; pistes?: Buffer[]; seekHead?: boolean; clusterInconnu?: boolean; chapitres?: Array<[number, string]>; titre?: string }): Buffer {
  const entete = el(0x1a45dfa3, elU(0x4286, 1), elU(0x42f7, 1), elU(0x42f2, 4), elU(0x42f3, 8), elS(0x4282, o.docType ?? 'matroska'), elU(0x4287, 4), elU(0x4285, 2));
  const info = el(0x1549a966, elU(0x2ad7b1, 1_000_000), elF(0x4489, 5000), ...(o.titre ? [elS(0x7ba9, o.titre)] : []), elS(0x4d80, 'libebml v1.4 + libmatroska v1.7'), elS(0x5741, 'mkvmerge v80'));
  const pistes = o.pistes ?? [
    el(0xae, elU(0xd7, 1), elU(0x73c5, 1001), elU(0x83, 1), elS(0x86, 'V_MPEG4/ISO/AVC'), elU(0x23e383, 40_000_000), el(0xe0, elU(0xb0, 1920), elU(0xba, 1080))),
    el(0xae, elU(0xd7, 2), elU(0x73c5, 1002), elU(0x83, 2), elS(0x86, 'A_OPUS'), elS(0x22b59c, 'fre'), el(0xe1, elF(0xb5, 48000), elU(0x9f, 2))),
    el(0xae, elU(0xd7, 3), elU(0x73c5, 1003), elU(0x83, 0x11), elS(0x86, 'S_TEXT/UTF8')),
  ];
  const tracks = el(0x1654ae6b, ...pistes);
  const tags = el(0x1254c367, el(0x7373, el(0x63c0, elU(0x68ca, 50)), ...(o.tags ?? []).filter((t) => t[0] === 50).map(([, n, v]) => el(0x67c8, elS(0x45a3, n), elS(0x4487, v)))),
    ...((o.tags ?? []).some((t) => t[0] === 30) ? [el(0x7373, el(0x63c0, elU(0x68ca, 30)), ...(o.tags ?? []).filter((t) => t[0] === 30).map(([, n, v]) => el(0x67c8, elS(0x45a3, n), elS(0x4487, v))))] : []));
  const chap = el(0x1043a770, el(0x45b9, ...(o.chapitres ?? [[0, 'Arrivée'], [2.5, 'Le port']]).map(([t, s]) => el(0xb6, elU(0x73c4, Math.round(t * 1000) + 1), elU(0x91, Math.round(t * 1e9)), el(0x80, elS(0x85, s), elS(0x437c, 'fre'))))));
  const cluster = o.clusterInconnu ? cat(idEbml(0x1f43b675), Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), elU(0xe7, 0), el(0xa3, Buffer.alloc(16))) : el(0x1f43b675, elU(0xe7, 0), el(0xa3, Buffer.alloc(16)));
  let corps: Buffer;
  if (o.seekHead !== false && !o.clusterInconnu) {
    const seek = (id: number, pos: number) => el(0x4dbb, el(0x53ab, idEbml(id)), elU(0x53ac, pos, 8));
    const sh0 = el(0x114d9b74, seek(0x1549a966, 0), seek(0x1654ae6b, 0), seek(0x1254c367, 0), seek(0x1043a770, 0));
    const pInfo = sh0.length, pTracks = pInfo + info.length, pCluster = pTracks + tracks.length, pTags = pCluster + cluster.length, pChap = pTags + tags.length;
    const sh = el(0x114d9b74, seek(0x1549a966, pInfo), seek(0x1654ae6b, pTracks), seek(0x1254c367, pTags), seek(0x1043a770, pChap));
    corps = cat(sh, info, tracks, cluster, tags, chap);
  } else corps = cat(info, tracks, cluster, tags, chap);
  const segment = o.clusterInconnu ? cat(idEbml(0x18538067), Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), corps) : el(0x18538067, corps);
  return cat(entete, segment);
}
export function webm(): Buffer {
  return mkv({ docType: 'webm', pistes: [el(0xae, elU(0xd7, 1), elU(0x73c5, 5), elU(0x83, 1), elS(0x86, 'V_VP9'), el(0xe0, elU(0xb0, 640), elU(0xba, 360)))], tags: [[50, 'TITLE', 'Essai WebM']] });
}

// ─────────────────────────────── WAV, AIFF, AVI ───────────────────────────────

export function wav(o: { info?: Array<[string, string]>; bext?: { description: string; originator: string; date: string; heure: string }; ixml?: string; id3?: Buffer; dataTaille?: number; sansFmt?: boolean; riffTaille?: number } = {}): Buffer {
  const m: Buffer[] = [];
  if (!o.sansFmt) m.push(morceau('fmt ', cat(u16le(1), u16le(1), u32le(44100), u32le(88200), u16le(2), u16le(16))));
  if (o.bext) {
    const b = Buffer.alloc(602);
    b.write(o.bext.description, 0, 'latin1'); b.write(o.bext.originator, 256, 'latin1'); b.write(o.bext.date, 320, 'latin1'); b.write(o.bext.heure, 330, 'latin1');
    m.push(morceau('bext', b));
  }
  if (o.info) m.push(morceau('LIST', cat(lat('INFO'), ...o.info.map(([k, v]) => morceau(k, cat(utf8(v), u8(0)))))));
  if (o.ixml) m.push(morceau('iXML', utf8(o.ixml)));
  if (o.id3) m.push(morceau('id3 ', o.id3));
  const donnees = Buffer.alloc(88200);
  if (o.dataTaille !== undefined) m.push(cat(lat('data'), u32le(o.dataTaille), donnees.subarray(0, 64)));
  else m.push(morceau('data', donnees));
  return riff('WAVE', m, o.riffTaille);
}

/** AIFF : COMM (fréquence en flottant 80 bits) et SSND. */
export function aiff(o: { fs80?: Buffer; nom?: string } = {}): Buffer {
  const fs = o.fs80 ?? Buffer.from([0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
  const comm = cat(u16be(2), u32be(44100), u16be(16), fs);
  const ch = (id: string, d: Buffer) => cat(lat(id), u32be(d.length), d, d.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0));
  const corps = cat(lat('AIFF'), ch('COMM', comm), ...(o.nom ? [ch('NAME', lat(o.nom))] : []), ch('SSND', cat(u32be(0), u32be(0), Buffer.alloc(64))));
  return cat(lat('FORM'), u32be(corps.length), corps);
}

export function avi(o: { idit?: string; logiciel?: string } = {}): Buffer {
  const avih = cat(u32le(40000), u32le(0), u32le(0), u32le(0x10), u32le(125), u32le(0), u32le(1), u32le(0), u32le(320), u32le(240), Buffer.alloc(16));
  const strh = cat(lat('vids'), lat('MJPG'), u32le(0), u32le(0), u32le(0), u32le(1), u32le(25), u32le(0), u32le(125), Buffer.alloc(20));
  const strf = cat(u32le(40), u32le(320), u32le(240), u16le(1), u16le(24), lat('MJPG'), Buffer.alloc(20));
  const hdrl = morceau('LIST', cat(lat('hdrl'), morceau('avih', avih), morceau('LIST', cat(lat('strl'), morceau('strh', strh), morceau('strf', strf)))));
  const m = [hdrl];
  if (o.idit) m.push(morceau('IDIT', cat(lat(o.idit), u8(0))));
  if (o.logiciel) m.push(morceau('LIST', cat(lat('INFO'), morceau('ISFT', cat(lat(o.logiciel), u8(0))))));
  m.push(morceau('LIST', cat(lat('movi'), morceau('00dc', Buffer.alloc(32)))));
  return riff('AVI ', m);
}

// ─────────────────────────────── ZIP, documents, textes ───────────────────────────────

export function zipAvec(entrees: Array<[string, Buffer]>, o: { totalAnnonce?: number } = {}): Buffer {
  const locaux: Buffer[] = [], centraux: Buffer[] = [];
  let off = 0;
  for (const [nom, d] of entrees) {
    const n = utf8(nom), c = crc32(d);
    const local = cat(u32le(0x04034b50), u16le(20), u16le(0x800), u16le(0), u16le(0), u16le(0), u32le(c), u32le(d.length), u32le(d.length), u16le(n.length), u16le(0), n, d);
    centraux.push(cat(u32le(0x02014b50), u16le(20), u16le(20), u16le(0x800), u16le(0), u16le(0), u16le(0), u32le(c), u32le(d.length), u32le(d.length), u16le(n.length), u16le(0), u16le(0), u16le(0), u16le(0), u32le(0), u32le(off), n));
    locaux.push(local); off += local.length;
  }
  const rep = cat(...centraux);
  const total = o.totalAnnonce ?? entrees.length;
  const fin = cat(u32le(0x06054b50), u16le(0), u16le(0), u16le(Math.min(total, 0xffff)), u16le(Math.min(total, 0xffff)), u32le(rep.length), u32le(off), u16le(0));
  return cat(...locaux, rep, fin);
}
export function docxMinimal(o: { titre?: string; auteur?: string } = {}): Buffer {
  return zipAvec([
    ['[Content_Types].xml', utf8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')],
    ['docProps/core.xml', utf8(`<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${o.titre ?? 'Contrat'}</dc:title><dc:creator>${o.auteur ?? 'Awa Saïd'}</dc:creator></cp:coreProperties>`)],
    ['word/document.xml', utf8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Bonjour</w:t></w:r></w:p></w:body></w:document>')],
  ]);
}
export function odfMinimal(mime: string): Buffer { return zipAvec([['mimetype', lat(mime)], ['content.xml', utf8('<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"/>')]]); }
export function epubMinimal(): Buffer { return zipAvec([['mimetype', lat('application/epub+zip')], ['META-INF/container.xml', utf8('<container/>')], ['OEBPS/livre.opf', utf8('<package/>')]]); }
export function pdfMinimal(o: { info: Record<string, string>; lang?: string }): Buffer {
  const info = Object.entries(o.info).map(([k, v]) => `/${k} (${v})`).join(' ');
  return lat(`%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R${o.lang ? ` /Lang (${o.lang})` : ''} >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n3 0 obj << ${info} >> endobj\ntrailer << /Root 1 0 R /Info 3 0 R >>\n%%EOF\n`);
}
export function srt(repliques: Array<[string, string, string]>): string {
  return repliques.map(([a, b, t], i) => `${i + 1}\r\n${a} --> ${b}\r\n${t}\r\n`).join('\r\n');
}
/** Un texte dans l'encodage voulu (BOM compris pour « utf-8-bom », « utf-16le-bom », « utf-16be-bom », « utf-32le-bom »). */
export function texte(enc: string, contenu: string): Buffer {
  switch (enc) {
    case 'utf-8': return utf8(contenu);
    case 'utf-8-bom': return cat(Buffer.from([0xef, 0xbb, 0xbf]), utf8(contenu));
    case 'utf-16le': return Buffer.from(contenu, 'utf16le');
    case 'utf-16le-bom': return cat(Buffer.from([0xff, 0xfe]), Buffer.from(contenu, 'utf16le'));
    case 'utf-16be': return Buffer.from(contenu, 'utf16le').swap16();
    case 'utf-16be-bom': return cat(Buffer.from([0xfe, 0xff]), Buffer.from(contenu, 'utf16le').swap16());
    case 'utf-32le-bom': { const r = [Buffer.from([0xff, 0xfe, 0, 0])]; for (const c of contenu) r.push(u32le(c.codePointAt(0)!)); return cat(...r); }
    case 'windows-1252': return lat(contenu);
    default: throw new Error(`encodage d'essai inconnu : ${enc}`);
  }
}
