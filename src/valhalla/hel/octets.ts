// Perséphone · petits outils sur les octets : sommes de contrôle (CRC-32, CRC-32C, CRC-16 et CRC-8 du FLAC),
// identifiants GUID, grands nombres, tailles lisibles. Écrit d'après les documents publics des formats.
import { crc32 as crcNatif } from 'node:zlib';

/** CRC-32 (celui de ZIP, PNG, GPT, 7z, RAR) ; `suite` : la somme déjà calculée sur ce qui précède. */
export const crc32 = (b: Uint8Array, suite = 0): number => crcNatif(b, suite) >>> 0;

const table = (poly: number) => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? poly ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; };
const T32C = table(0x82F63B78);
/** CRC-32C (Castagnoli) : sommes de contrôle d'ext4 et de Btrfs. `graine` : l'état de départ (0xFFFFFFFF pour ext4). */
export function crc32c(b: Uint8Array, graine = 0xFFFFFFFF): number {
  let c = graine >>> 0; for (let i = 0; i < b.length; i++) c = T32C[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return c >>> 0;
}
const T16 = (() => { const t = new Uint16Array(256); for (let n = 0; n < 256; n++) { let c = n << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xFFFF : (c << 1) & 0xFFFF; t[n] = c; } return t; })();
/** CRC-16 du FLAC (polynôme x^16 + x^15 + x^2 + 1, départ 0, bit de poids fort d'abord). */
export function crc16(b: Uint8Array, debut = 0, fin = b.length, suite = 0): number {
  let c = suite; for (let i = debut; i < fin; i++) c = ((c << 8) & 0xFFFF) ^ T16[(c >> 8) ^ b[i]]; return c;
}
const T8 = (() => { const t = new Uint8Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF; t[n] = c; } return t; })();
/** CRC-8 du FLAC (polynôme x^8 + x^2 + x + 1, départ 0). */
export function crc8(b: Uint8Array, debut = 0, fin = b.length): number { let c = 0; for (let i = debut; i < fin; i++) c = T8[c ^ b[i]]; return c; }

/** Un entier de 64 bits (petit-boutiste) rendu en nombre ; `Infinity` s'il dépasse ce qu'un nombre sait porter. */
export function u64le(b: Buffer, o: number): number { const v = b.readBigUInt64LE(o); return v > 9007199254740991n ? Infinity : Number(v); }
export function u64be(b: Buffer, o: number): number { const v = b.readBigUInt64BE(o); return v > 9007199254740991n ? Infinity : Number(v); }
export function ecrireU64le(b: Buffer, v: number, o: number): void { b.writeBigUInt64LE(BigInt(v), o); }

/** Un GUID tel qu'il est rangé dans une table GPT (les trois premiers champs à l'envers) → « 0FC63DAF-8483-… ». */
export function guidTexte(b: Buffer, o = 0): string {
  const h = (x: Buffer) => x.toString('hex').toUpperCase();
  return `${h(Buffer.from(b.subarray(o, o + 4)).reverse())}-${h(Buffer.from(b.subarray(o + 4, o + 6)).reverse())}-${h(Buffer.from(b.subarray(o + 6, o + 8)).reverse())}-${h(b.subarray(o + 8, o + 10))}-${h(b.subarray(o + 10, o + 16))}`;
}
/** « 0FC63DAF-8483-4772-8E79-3D69D8477DE4 » → les 16 octets rangés comme dans une table GPT. */
export function guidOctets(t: string): Buffer {
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i.exec(t.trim()); if (!m) throw new Error(`identifiant GUID invalide : ${t}`);
  const x = (s: string) => Buffer.from(s, 'hex');
  return Buffer.concat([x(m[1]).reverse(), x(m[2]).reverse(), x(m[3]).reverse(), x(m[4]), x(m[5])]);
}
/** Un identifiant écrit comme une suite d'octets ordinaire (UUID d'ext4, XFS, Btrfs). */
export const uuidTexte = (b: Buffer, o = 0): string => { const h = b.subarray(o, o + 16).toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

/** Une taille en clair : « 512 o », « 1,4 Mo », « 32 Go ». */
export function taille(o: number): string {
  if (!Number.isFinite(o) || o < 0) return '?';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0, v = o; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${u[i]}`;
}
/** Un texte venu du support (étiquette, nom de fichier) : sans caractère de commande, borné. Ce n'est jamais un ordre. */
const COMMANDES = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
export const propre = (t: string, max = 80): string => t.replace(COMMANDES, '').trim().slice(0, max);
/** Texte ASCII rangé dans un champ de taille fixe (complété par des zéros ou des espaces). */
export const champ = (b: Buffer, o: number, n: number): string => { const x = b.subarray(o, o + n); const z = x.indexOf(0); return propre(x.subarray(0, z < 0 ? n : z).toString('latin1')); };
