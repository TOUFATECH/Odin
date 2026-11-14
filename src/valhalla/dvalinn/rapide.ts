// Alchimie en 4 clics (maquette « Alchimie : convertir en 4 clics sur Odin », validée le 14/11/2026) : ce que le
// panneau près d'Odin montre une fois les fichiers déposés. Tout est pur et testé :
//   - les 4 formats proposés en tuiles (avec une phrase simple et la taille estimée), puis les autres en pastilles ;
//   - la qualité (0 à 100 %) ramenée aux réglages des outils ;
//   - « Garder la date de prise » : la date de la photo réécrite dans le JPEG produit (rien d'autre : ni lieu ni appareil) ;
//   - « Rogner avant » : le cadre gardé au centre (carré, 4:3, 3:2, 16:9) ;
//   - le nom d'une conversion récente (« Photos → JPG ») pour « Refaire ».
// Idées de Filee (KnifeLemon/Filee, MIT) : formats proposés selon le fichier, qualité, rognage, conversions récentes ;
// réécrites pour Odin, aucun code copié.
import { extOf, familyOf, type Family } from './plan.ts';
import { familleMaison } from './maison.ts';

export interface Tuile { format: string; label: string; desc: string; estim: string }
export interface Choix { famille: string; tuiles: Tuile[]; autres: Array<{ format: string; label: string }>; options: { qualite: boolean; date: boolean; rogner: boolean }; defaut?: string }

const NOMS: Record<string, string> = { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', md: 'Markdown', txt: 'Texte', pdfa: 'PDF/A', html: 'Page web', 'tar.gz': 'TAR.GZ', geojson: 'GeoJSON' };
export const labelDe = (f: string) => NOMS[f] ?? f.toUpperCase();

/** Les formats mis en avant pour chaque sorte de fichier, dans l'ordre des tuiles. */
const PREFERES: Record<string, string[]> = {
  image: ['jpg', 'png', 'webp', 'pdf'], document: ['pdf', 'docx', 'odt', 'txt'], pdf: ['docx', 'txt', 'jpg', 'png'],
  video: ['mp4', 'webm', 'mp3', 'gif'], audio: ['mp3', 'm4a', 'flac', 'wav'], tableur: ['xlsx', 'csv', 'pdf', 'ods'],
  presentation: ['pdf', 'pptx', 'odp'], texte: ['pdf', 'docx', 'html', 'txt'], livre: ['epub', 'pdf', 'mobi', 'azw3'],
};
/** Une phrase simple par format (selon ce qu'on convertit). */
function descDe(format: string, famille: string, n: number): string {
  if (format === 'pdf') return famille === 'image' ? (n > 1 ? 'Un seul document' : 'À imprimer, à envoyer') : 'À imprimer, à envoyer';
  if (format === 'mp3') return famille === 'video' ? 'Le son seul' : 'Pour tout le monde';
  if ((format === 'jpg' || format === 'png') && famille === 'pdf') return 'Une image par page';
  return ({ jpg: 'Pour tout le monde', png: 'Sans perte', webp: 'Le plus léger', avif: 'Très léger, récent', gif: famille === 'video' ? 'Petite animation' : 'Image simple',
    tiff: 'Pour l\'impression', bmp: 'Brut, très lourd', ico: 'Icône de site', docx: 'À modifier dans Word', odt: 'À modifier (LibreOffice)', rtf: 'Texte mis en forme', txt: 'Le texte seul',
    html: 'Page web', md: 'Texte simple (Markdown)', pdfa: 'Pour archiver', mp4: 'Pour tout le monde', webm: 'Pour le web', mkv: 'Garde tout', mov: 'Pour Apple',
    m4a: 'Léger', flac: 'Sans perte', wav: 'Brut, très lourd', ogg: 'Libre et léger', opus: 'Le plus léger', aac: 'Léger', xlsx: 'Excel', csv: 'Simple, partout',
    ods: 'LibreOffice', json: 'Pour les programmes', pptx: 'PowerPoint', odp: 'LibreOffice', epub: 'Pour les liseuses', mobi: 'Kindle (ancien)', azw3: 'Kindle',
    srt: 'Sous-titres partout', vtt: 'Sous-titres du web', zip: 'Archive pour tous' } as Record<string, string>)[format] ?? '';
}

/** Taille estimée d'un résultat, en octets (rapport à la taille d'origine, à 85 % de qualité). 0 = on ne sait pas. Pur. */
export function estimer(nom: string, taille: number, vers: string, qualite = 85): number {
  const de = extOf(nom).replace('jpeg', 'jpg'), f = familyOf(nom), q = qualite >= 92 ? 1.6 : qualite >= 80 ? 1 : qualite >= 65 ? 0.65 : 0.45;
  const lossy = ['jpg', 'webp', 'avif'].includes(vers);
  let r = 0;
  if (f === 'image') {
    const photo = ['heic', 'heif', 'avif'].includes(de) ? 'heic' : de === 'jpg' ? 'jpg' : de === 'png' ? 'png' : 'autre';
    const T: Record<string, Record<string, number>> = {
      heic: { jpg: 0.3, png: 1.6, webp: 0.18, avif: 0.12, gif: 0.5, tiff: 3, bmp: 3.5, ico: 0.02, pdf: 0.32 },
      jpg: { jpg: 1, png: 3, webp: 0.6, avif: 0.45, gif: 1, tiff: 6, bmp: 8, ico: 0.02, pdf: 1.02 },
      png: { jpg: 0.25, png: 1, webp: 0.2, avif: 0.15, gif: 0.4, tiff: 1.6, bmp: 2.5, ico: 0.05, pdf: 0.27 },
      autre: { jpg: 0.5, png: 1.5, webp: 0.35, avif: 0.25, gif: 0.6, tiff: 2, bmp: 3, ico: 0.05, pdf: 0.52 },
    };
    r = T[photo][vers] ?? 0;
  } else if (f === 'video') r = ({ mp4: 0.5, webm: 0.45, mkv: 0.5, mov: 0.6, gif: 1.2, mp3: 0.04, m4a: 0.03, ogg: 0.03, opus: 0.02, flac: 0.12, wav: 0.3 } as Record<string, number>)[vers] ?? 0;
  else if (f === 'audio') { const brut = ['wav', 'aiff'].includes(de) ? 1 : de === 'flac' ? 0.55 : 0.1; r = (({ mp3: 0.1, m4a: 0.08, aac: 0.08, ogg: 0.08, opus: 0.05, flac: 0.55, wav: 1 } as Record<string, number>)[vers] ?? 0) / brut; }
  else if (f === 'document' || f === 'texte' || f === 'presentation' || f === 'tableur') r = vers === 'pdf' ? 1.1 : vers === 'txt' || vers === 'csv' ? 0.3 : 1;
  else if (f === 'pdf') r = vers === 'txt' ? 0.05 : vers === 'docx' ? 0.8 : 0;
  if (lossy && (f === 'image' || f === 'video')) r *= q;
  return Math.round(taille * r);
}
/** « 1,1 Mo » (écriture française). Pur. */
export function taillePropre(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} Go`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} Mo`;
  return `${Math.max(1, Math.round(n / 1e3))} ko`;
}

/**
 * Ce que le panneau propose pour ces fichiers : `possibles` = les formats possibles de chacun (conversionsPossibles),
 * on garde ceux qui conviennent à tous. Pur.
 */
export function choixPour(fichiers: Array<{ nom: string; taille: number }>, possibles: string[][], qualite = 85): Choix {
  const n = fichiers.length, fams = [...new Set(fichiers.map((x) => familyOf(x.nom) ?? familleMaison(x.nom) ?? '?'))];
  const famille = fams.length === 1 ? fams[0] : 'mélange';
  const communs = possibles.length ? possibles.reduce((a, b) => a.filter((x) => b.includes(x))) : [];
  const pref = (PREFERES[famille] ?? []).filter((x) => communs.includes(x));
  const tuilesF = [...pref, ...communs.filter((x) => !pref.includes(x))].slice(0, 4);
  const chacun = famille === 'image' ? 'chacune' : 'chacun';
  const tuiles = tuilesF.map((format) => {
    const tailles = fichiers.map((x) => estimer(x.nom, x.taille, format, qualite)), moy = tailles.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const unSeul = format === 'pdf' && famille === 'image' && n > 1;
    const estim = unSeul ? '1 fichier' : moy > 0 ? `≈ ${taillePropre(moy)}${n > 1 ? ` ${chacun}` : ''}` : '';
    return { format, label: labelDe(format), desc: descDe(format, famille, n), estim };
  });
  const comp = famille === 'image' || famille === 'video' || famille === 'audio';
  return { famille, tuiles, autres: communs.filter((x) => !tuilesF.includes(x)).map((format) => ({ format, label: labelDe(format) })),
    options: { qualite: comp, date: famille === 'image', rogner: famille === 'image' }, ...(tuiles[0] ? { defaut: tuiles[0].format } : {}) };
}

/** La qualité en pourcentage (0 à 100) ramenée aux trois réglages des outils (vidéo, son). Pur. */
export const qualiteDe = (pct: number): 'legere' | 'normale' | 'haute' => (pct >= 90 ? 'haute' : pct >= 70 ? 'normale' : 'legere');

/** Les rapports de rognage proposés, et le cadre gardé au centre pour une image de w × h. Pur. */
export const RAPPORTS: Record<string, [number, number]> = { carre: [1, 1], '4:3': [4, 3], '3:2': [3, 2], '16:9': [16, 9] };
export function cadre(w: number, h: number, rapport: string): { w: number; h: number } | undefined {
  const r = RAPPORTS[rapport]; if (!r || !(w > 0) || !(h > 0)) return undefined;
  // Le rapport suit le sens de la photo (une photo en hauteur garde un cadre en hauteur).
  const [a, b] = h > w ? [r[1], r[0]] : r;
  const cw = Math.min(w, Math.floor((h * a) / b)), ch = Math.min(h, Math.floor((w * b) / a));
  return cw / ch > a / b ? { w: Math.floor((ch * a) / b), h: ch } : { w: cw, h: Math.floor((cw * b) / a) };
}

/**
 * Le nom d'une conversion pour « Tes conversions récentes » : « Photos → JPG », « Word → PDF », « Vidéo → MP4 léger ». Pur.
 */
export function nomRecette(nom: string, vers: string, qualite?: string): string {
  const de = extOf(nom), f: Family | string | undefined = familyOf(nom) ?? familleMaison(nom);
  const quoi = ['heic', 'heif', 'jpg', 'jpeg'].includes(de) ? 'Photos' : f === 'image' ? 'Images' : ['docx', 'doc'].includes(de) ? 'Word' : f === 'document' ? 'Documents'
    : f === 'tableur' ? 'Tableaux' : f === 'presentation' ? 'Présentations' : f === 'pdf' ? 'PDF' : f === 'video' ? 'Vidéo' : f === 'audio' ? 'Son' : f === 'livre' ? 'Livres'
    : f === 'texte' ? 'Textes' : typeof f === 'string' ? f.charAt(0).toUpperCase() + f.slice(1) : de.toUpperCase();
  const leger = qualite === 'legere' && ['video', 'audio', 'image'].includes(String(familyOf(nom))) ? ' léger' : '';
  return `${quoi} → ${labelDe(vers)}${leger}`;
}

// ------------------------------------------------------------------ « Garder la date de prise » (JPEG)
/** « 2026:11:14 09:30:00 » depuis une date. */
const exifTexte = (d: Date) => `${d.getFullYear()}:${String(d.getMonth() + 1).padStart(2, '0')}:${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
/** « 2026:11:14 09:30:00 » (la date des photos) → Date (heure locale), ou undefined. Pur. */
export function dateExif(t: string): Date | undefined {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(t ?? '').trim()); if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(d.getTime()) || Number(m[1]) < 1900 ? undefined : d;
}
/**
 * Ajoute à un JPEG un petit bloc EXIF qui ne contient que la date de prise (DateTimeOriginal, DateTimeDigitized et
 * DateTime) : ni lieu, ni appareil, ni rien d'autre. Écrit d'après la norme EXIF 2.3 (TIFF, petit-boutiste). Pur.
 */
export function jpegAvecDate(jpeg: Buffer, date: Date): Buffer {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('ce n\'est pas un JPEG');
  const txt = Buffer.from(`${exifTexte(date)}\0`, 'ascii'); // 20 octets
  // TIFF : en-tête (8) + IFD0 (2 + 2 × 12 + 4) + IFD Exif (2 + 2 × 12 + 4) + 3 dates (3 × 20)
  const ifd0 = 8, ifdExif = ifd0 + 2 + 2 * 12 + 4, data = ifdExif + 2 + 2 * 12 + 4, t = Buffer.alloc(data + 3 * 20);
  t.write('II', 0, 'ascii'); t.writeUInt16LE(42, 2); t.writeUInt32LE(ifd0, 4);
  const entree = (at: number, tag: number, type: number, n: number, val: number) => { t.writeUInt16LE(tag, at); t.writeUInt16LE(type, at + 2); t.writeUInt32LE(n, at + 4); t.writeUInt32LE(val, at + 8); };
  t.writeUInt16LE(2, ifd0); entree(ifd0 + 2, 0x0132, 2, 20, data); entree(ifd0 + 14, 0x8769, 4, 1, ifdExif); t.writeUInt32LE(0, ifd0 + 26);
  t.writeUInt16LE(2, ifdExif); entree(ifdExif + 2, 0x9003, 2, 20, data + 20); entree(ifdExif + 14, 0x9004, 2, 20, data + 40); t.writeUInt32LE(0, ifdExif + 26);
  for (let i = 0; i < 3; i++) txt.copy(t, data + i * 20);
  const corps = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), t]), seg = Buffer.alloc(4); seg[0] = 0xff; seg[1] = 0xe1; seg.writeUInt16BE(corps.length + 2, 2);
  // Le bloc va juste après SOI (et après l'en-tête JFIF s'il y en a un, pour rester lisible partout).
  let at = 2; if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.subarray(0, at), seg, corps, jpeg.subarray(at)]);
}
