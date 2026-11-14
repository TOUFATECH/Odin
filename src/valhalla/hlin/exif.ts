// Gygès — ce qu'une photo dit sans qu'on le voie : le lieu (GPS), l'appareil, la date. Le lecteur EXIF est celui
// d'Hélios (déjà dans le projet, écrit pour Odin) ; ici, on retrouve seulement le bloc EXIF dans les autres
// formats d'image (PNG, WebP, HEIC / AVIF, TIFF) pour le lui donner. Rien n'est envoyé nulle part.
import { appareil, lireExif, type Exif } from '../modules/sol.ts';

export interface Photo { format: 'JPEG' | 'PNG' | 'WebP' | 'HEIC' | 'TIFF' | 'inconnu'; exif: Exif }
const estTiff = (b: Buffer, at = 0) => b.length >= at + 8 && ((b[at] === 0x49 && b[at + 1] === 0x49 && b[at + 2] === 0x2a && b[at + 3] === 0) || (b[at] === 0x4d && b[at + 1] === 0x4d && b[at + 2] === 0 && b[at + 3] === 0x2a));
/** Un bloc EXIF nu (TIFF) → une image JPEG minimale autour, que le lecteur d'Hélios sait lire. */
function enJpeg(tiff: Buffer): Buffer {
  const t = tiff.subarray(0, 65_500), tete = Buffer.alloc(10);
  tete.writeUInt16BE(0xffd8, 0); tete.writeUInt16BE(0xffe1, 2); tete.writeUInt16BE(2 + 6 + t.length, 4); tete.write('Exif', 6, 'latin1');
  return Buffer.concat([tete, Buffer.from([0, 0]), t, Buffer.from([0xff, 0xd9])]);
}
/** Le bloc EXIF d'un PNG (morceau « eXIf »), s'il y en a un. */
function exifPng(b: Buffer): Buffer | undefined {
  for (let o = 8; o + 12 <= b.length;) { const n = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8); if (type === 'eXIf' && o + 8 + n <= b.length) return b.subarray(o + 8, o + 8 + n); if (type === 'IEND' || n > b.length) break; o += 12 + n; }
  return undefined;
}
/** Le bloc EXIF d'un WebP (morceau « EXIF » du conteneur RIFF). */
function exifWebp(b: Buffer): Buffer | undefined {
  for (let o = 12; o + 8 <= b.length;) { const type = b.toString('latin1', o, o + 4), n = b.readUInt32LE(o + 4); if (type === 'EXIF' && o + 8 + n <= b.length) { const d = b.subarray(o + 8, o + 8 + n); return d.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? d.subarray(6) : d; } if (n > b.length) break; o += 8 + n + (n % 2); }
  return undefined;
}
/** Le bloc EXIF d'un HEIC ou d'un AVIF : il est rangé tel quel dans le fichier, précédé de « Exif » et de deux octets nuls. */
function exifHeif(b: Buffer): Buffer | undefined {
  const fin = Math.min(b.length, 4 * 1024 * 1024);
  for (let o = b.indexOf('Exif\0\0', 0, 'latin1'); o >= 0 && o < fin; o = b.indexOf('Exif\0\0', o + 1, 'latin1')) if (estTiff(b, o + 6)) return b.subarray(o + 6);
  return undefined;
}
/**
 * Lit ce qu'une image cache : format reconnu à ses premiers octets (jamais à son nom), puis lieu, appareil et date.
 * Un fichier abîmé ou piégé ne donne rien, jamais d'erreur. Pur.
 */
export function lirePhoto(b: Buffer): Photo {
  try {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return { format: 'JPEG', exif: lireExif(b) };
    if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { const t = exifPng(b); return { format: 'PNG', exif: t && estTiff(t) ? lireExif(enJpeg(t)) : {} }; }
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') { const t = exifWebp(b); return { format: 'WebP', exif: t && estTiff(t) ? lireExif(enJpeg(t)) : {} }; }
    if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') { const t = exifHeif(b); return { format: 'HEIC', exif: t ? lireExif(enJpeg(t)) : {} }; }
    if (estTiff(b)) return { format: 'TIFF', exif: lireExif(enJpeg(b)) };
  } catch { /* fichier abîmé : rien à dire */ }
  return { format: 'inconnu', exif: {} };
}
/** « 2024:07:14 18:22:05 » → « 14/07/2024 à 18:22 ». Pur. */
export const dateEnClair = (d?: string) => { const m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d)/.exec(d ?? ''); return m && m[1] !== '0000' ? `${m[3]}/${m[2]}/${m[1]} à ${m[4]}:${m[5]}` : undefined; };
/** Ce que la photo révèle, en clair. Le lieu est donné au kilomètre près dans le texte (le point exact reste dans `precis`). Pur. */
export function direPhoto(p: Photo): { lignes: string[]; lieu: boolean; precis?: string } {
  const x = p.exif, lieu = x.lat !== undefined && x.lon !== undefined, app = appareil(x.marque, x.modele), quand = dateEnClair(x.date);
  const lignes = [
    lieu ? `📍 Lieu caché dans la photo : oui (coordonnées GPS, vers ${x.lat!.toFixed(2)}, ${x.lon!.toFixed(2)}). Qui reçoit ce fichier peut retrouver l'endroit exact où elle a été prise.` : '📍 Lieu caché dans la photo : non.',
    app ? `📱 Appareil : ${app.replace(/[^\p{L}\p{N} ._()+-]/gu, ' ').slice(0, 60)}.` : '📱 Appareil : rien d\'écrit.',
    quand ? `🕒 Prise le ${quand}.` : '🕒 Date de prise de vue : rien d\'écrit.',
  ];
  return { lignes, lieu, ...(lieu ? { precis: `${x.lat}, ${x.lon}` } : {}) };
}
export const POUR_RETIRER_LE_LIEU = 'Pour l\'envoyer sans le lieu : sur iPhone, au moment de partager, touche « Options » et décoche « Lieu » ; sur Android, coupe les données de localisation dans les options de partage (ou les balises de lieu de l\'appareil photo) ; sur Windows, clic droit → Propriétés → Détails → « Supprimer les propriétés et les informations personnelles ». Les noms changent un peu d\'un appareil à l\'autre.';
