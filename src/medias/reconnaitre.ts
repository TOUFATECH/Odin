// Médias reçus : reconnaître ce qu'est un fichier d'après son CONTENU (jamais d'après son nom). Signatures dans un
// ordre fixe, balise ID3 de tête sautée, trames MP3 et ADTS vérifiées en chaîne, sous-type des ZIP (Office, ODF,
// EPUB), texte : encodage (BOM, UTF-8 strict, UTF-16 sans BOM, sinon incertain) puis sorte de texte (sous-titres,
// SVG, HTML, XML, JSON, CSV). Données en queue et désaccord d'extension signalés. Aucune expression régulière.

import type { Famille, Nature } from './contrat.ts';
import { decoderLatin1Douteux, enClair, type Source } from './octets.ts';
import { tailleId3 } from './id3.ts';
import { trameAdts, troisTrames, trameMp3 } from './sons.ts';
import { listerZip, sousTypeZip } from './zip.ts';

type Def = [Famille, string, string, string[]];
const FORMATS: Record<string, Def> = {
  jpeg: ['image', 'Photo JPEG', 'image/jpeg', ['jpg', 'jpeg', 'jpe', 'jfif']],
  png: ['image', 'Image PNG', 'image/png', ['png']],
  apng: ['image', 'Image PNG animée', 'image/apng', ['png', 'apng']],
  gif: ['image', 'Image GIF', 'image/gif', ['gif']],
  webp: ['image', 'Image WebP', 'image/webp', ['webp']],
  heic: ['image', 'Photo HEIC', 'image/heic', ['heic', 'heif', 'hif']],
  heif: ['image', 'Image HEIF', 'image/heif', ['heif', 'heic', 'hif']],
  avif: ['image', 'Image AVIF', 'image/avif', ['avif']],
  tiff: ['image', 'Image TIFF', 'image/tiff', ['tif', 'tiff']],
  bigtiff: ['image', 'Image BigTIFF', 'image/tiff', ['tif', 'tiff', 'btf']],
  dng: ['image', 'Photo RAW DNG', 'image/x-adobe-dng', ['dng']],
  cr2: ['image', 'Photo RAW CR2', 'image/x-canon-cr2', ['cr2']],
  cr3: ['image', 'Photo RAW CR3', 'image/x-canon-cr3', ['cr3']],
  nef: ['image', 'Photo RAW NEF', 'image/x-nikon-nef', ['nef']],
  arw: ['image', 'Photo RAW ARW', 'image/x-sony-arw', ['arw']],
  orf: ['image', 'Photo RAW ORF', 'image/x-olympus-orf', ['orf']],
  rw2: ['image', 'Photo RAW RW2', 'image/x-panasonic-rw2', ['rw2']],
  bmp: ['image', 'Image BMP', 'image/bmp', ['bmp', 'dib']],
  ico: ['image', 'Icône', 'image/x-icon', ['ico', 'cur']],
  jxl: ['image', 'Image JPEG XL', 'image/jxl', ['jxl']],
  svg: ['image', 'Image SVG', 'image/svg+xml', ['svg', 'svgz']],
  mp3: ['son', 'Musique MP3', 'audio/mpeg', ['mp3', 'mp2', 'mpga']],
  aac: ['son', 'Son AAC', 'audio/aac', ['aac', 'adts']],
  flac: ['son', 'Musique FLAC', 'audio/flac', ['flac']],
  'ogg-vorbis': ['son', 'Son Ogg Vorbis', 'audio/ogg', ['ogg', 'oga']],
  'ogg-opus': ['son', 'Son Opus', 'audio/ogg', ['opus', 'ogg', 'oga']],
  'ogg-flac': ['son', 'Son Ogg FLAC', 'audio/ogg', ['oga', 'ogg']],
  'ogg-speex': ['son', 'Son Speex', 'audio/ogg', ['spx', 'ogg']],
  'ogg-theora': ['video', 'Vidéo Ogg Theora', 'video/ogg', ['ogv', 'ogg']],
  wav: ['son', 'Son WAV', 'audio/wav', ['wav', 'wave', 'bwf']],
  wav64: ['son', 'Son WAV 64 bits', 'audio/wav', ['wav', 'rf64', 'bw64']],
  aiff: ['son', 'Son AIFF', 'audio/aiff', ['aif', 'aiff', 'aifc']],
  m4a: ['son', 'Musique M4A', 'audio/mp4', ['m4a', 'm4p', 'mp4']],
  m4b: ['son', 'Livre audio M4B', 'audio/mp4', ['m4b']],
  mp4: ['video', 'Vidéo MP4', 'video/mp4', ['mp4', 'm4v']],
  mov: ['video', 'Vidéo QuickTime (MOV)', 'video/quicktime', ['mov', 'qt']],
  '3gp': ['video', 'Vidéo 3GP', 'video/3gpp', ['3gp', '3g2']],
  mkv: ['video', 'Vidéo Matroska (MKV)', 'video/x-matroska', ['mkv', 'mka', 'mks', 'mk3d']],
  webm: ['video', 'Vidéo WebM', 'video/webm', ['webm']],
  avi: ['video', 'Vidéo AVI', 'video/x-msvideo', ['avi']],
  asf: ['video', 'Vidéo ASF / WMV', 'video/x-ms-asf', ['asf', 'wmv', 'wma']],
  flv: ['video', 'Vidéo Flash (FLV)', 'video/x-flv', ['flv']],
  'mpeg-ts': ['video', 'Vidéo MPEG-TS', 'video/mp2t', ['ts', 'mts', 'm2ts']],
  'mpeg-ps': ['video', 'Vidéo MPEG-PS', 'video/mpeg', ['mpg', 'mpeg', 'vob']],
  amr: ['son', 'Son AMR', 'audio/amr', ['amr']],
  midi: ['son', 'Partition MIDI', 'audio/midi', ['mid', 'midi', 'kar']],
  ape: ['son', 'Son Monkey\'s Audio', 'audio/ape', ['ape']],
  wavpack: ['son', 'Son WavPack', 'audio/wavpack', ['wv']],
  pdf: ['document', 'Document PDF', 'application/pdf', ['pdf']],
  docx: ['document', 'Document Word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['docx', 'docm']],
  xlsx: ['document', 'Tableur Excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['xlsx', 'xlsm']],
  pptx: ['document', 'Présentation PowerPoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ['pptx', 'pptm']],
  odt: ['document', 'Document OpenDocument', 'application/vnd.oasis.opendocument.text', ['odt']],
  ods: ['document', 'Tableur OpenDocument', 'application/vnd.oasis.opendocument.spreadsheet', ['ods']],
  odp: ['document', 'Présentation OpenDocument', 'application/vnd.oasis.opendocument.presentation', ['odp']],
  epub: ['document', 'Livre EPUB', 'application/epub+zip', ['epub']],
  ole: ['document', 'Ancien document Office', 'application/x-ole-storage', ['doc', 'xls', 'ppt', 'msg', 'msi']],
  rtf: ['document', 'Document RTF', 'application/rtf', ['rtf']],
  html: ['document', 'Page HTML', 'text/html', ['html', 'htm', 'xhtml']],
  zip: ['archive', 'Archive ZIP', 'application/zip', ['zip']],
  gzip: ['archive', 'Archive gzip', 'application/gzip', ['gz', 'tgz']],
  '7z': ['archive', 'Archive 7z', 'application/x-7z-compressed', ['7z']],
  rar: ['archive', 'Archive RAR', 'application/vnd.rar', ['rar']],
  srt: ['sous-titres', 'Sous-titres SRT', 'application/x-subrip', ['srt']],
  vtt: ['sous-titres', 'Sous-titres WebVTT', 'text/vtt', ['vtt']],
  ass: ['sous-titres', 'Sous-titres ASS', 'text/x-ssa', ['ass', 'ssa']],
  xml: ['texte', 'Fichier XML', 'application/xml', ['xml']],
  json: ['texte', 'Fichier JSON', 'application/json', ['json']],
  csv: ['texte', 'Tableau CSV', 'text/csv', ['csv', 'tsv']],
  texte: ['texte', 'Fichier texte', 'text/plain', ['txt', 'text', 'md', 'log']],
  inconnu: ['inconnu', 'Fichier inconnu', 'application/octet-stream', []],
};
/** Nom en clair d'un format (pour les autres fichiers du socle). */
export const nomFormat = (fmt: string): string => FORMATS[fmt]?.[1] ?? fmt;

const ascii = (b: Uint8Array, p: number, s: string) => { if (p + s.length > b.length) return false; for (let i = 0; i < s.length; i++) if (b[p + i] !== s.charCodeAt(i)) return false; return true; };
const u32be = (b: Uint8Array, p: number) => p + 4 <= b.length ? ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3] : -1;
const u32le = (b: Uint8Array, p: number) => p + 4 <= b.length ? b[p] + (b[p + 1] << 8) + (b[p + 2] << 16) + ((b[p + 3] << 24) >>> 0) : -1;
const lat1 = (b: Uint8Array, p: number, n: number) => { let r = ''; for (let i = p; i < Math.min(b.length, p + n); i++) r += String.fromCharCode(b[i]); return r; };

export function creerNature(format: string, o: { nom?: string; debut?: number; certitude?: Nature['certitude']; alertes?: string[]; encodage?: Nature['encodage'] } = {}): Nature {
  const d = FORMATS[format] ?? FORMATS.inconnu;
  const n: Nature = { famille: d[0], format, nom: d[1], mime: d[2], extensions: [...d[3]], accordExtension: true, debut: o.debut ?? 0, certitude: o.certitude ?? 'sure', alertes: [...(o.alertes ?? [])] };
  if (o.encodage) n.encodage = o.encodage;
  if (o.nom) appliquerNom(n, o.nom);
  return n;
}
function appliquerNom(n: Nature, nom: string): void {
  const base = nom.split('\\').join('/').split('/').pop() ?? '';
  const k = base.lastIndexOf('.');
  if (k <= 0 || k === base.length - 1) return;
  const ext = base.slice(k + 1).toLowerCase().slice(0, 16);
  n.extensionDonnee = ext;
  if (n.format !== 'inconnu' && !n.extensions.includes(ext) && !(n.famille === 'texte' && ['txt', 'md', 'log', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf'].includes(ext))) {
    n.accordExtension = false;
    n.alertes.push(`extension .${ext} mais contenu ${n.nom}`);
  }
}

/** Format d'après les octets de tête (sans balise ID3). */
function signature(t: Uint8Array, taille: number): { format: string; alertes?: string[] } | undefined {
  if (t.length >= 4 && t[0] === 0xff && t[1] === 0xd8 && t[2] === 0xff && t[3] >= 0xc0) return { format: 'jpeg' };
  if (t.length >= 16 && t[0] === 0x89 && ascii(t, 1, 'PNG\r\n\x1a\n')) {
    if (u32be(t, 8) === 13 && ascii(t, 12, 'IHDR')) {
      // APNG : acTL avant IDAT dans la tête.
      const s = lat1(t, 0, t.length);
      const a = s.indexOf('acTL'), d = s.indexOf('IDAT');
      return { format: a >= 0 && (d < 0 || a < d) ? 'apng' : 'png' };
    }
  }
  if (ascii(t, 0, 'GIF87a') || ascii(t, 0, 'GIF89a')) return { format: 'gif' };
  if (ascii(t, 0, 'RIFF') && t.length >= 12) {
    if (ascii(t, 8, 'WEBP')) return { format: 'webp' };
    if (ascii(t, 8, 'WAVE')) return { format: 'wav' };
    if (ascii(t, 8, 'AVI ')) return { format: 'avi' };
  }
  if ((ascii(t, 0, 'RF64') || ascii(t, 0, 'BW64')) && ascii(t, 8, 'WAVE')) return { format: 'wav64' };
  if (ascii(t, 0, 'FORM') && (ascii(t, 8, 'AIFF') || ascii(t, 8, 'AIFC'))) return { format: 'aiff' };
  if (ascii(t, 4, 'ftyp')) return { format: marqueFtyp(t) };
  if (t.length >= 8 && u32be(t, 0) >= 8 && ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].some((x) => ascii(t, 4, x))) return { format: 'mov' };
  if (t[0] === 0x1a && t[1] === 0x45 && t[2] === 0xdf && t[3] === 0xa3) return { format: docTypeEbml(t) };
  if (ascii(t, 0, 'OggS') && t.length >= 28) {
    const p = 27 + t[26];
    if (ascii(t, p + 1, 'vorbis') && t[p] === 1) return { format: 'ogg-vorbis' };
    if (ascii(t, p, 'OpusHead')) return { format: 'ogg-opus' };
    if (t[p] === 0x7f && ascii(t, p + 1, 'FLAC')) return { format: 'ogg-flac' };
    if (ascii(t, p, 'Speex   ')) return { format: 'ogg-speex' };
    if (t[p] === 0x80 && ascii(t, p + 1, 'theora')) return { format: 'ogg-theora' };
    return { format: 'ogg-vorbis', alertes: ['flux Ogg de type inconnu'] };
  }
  if (ascii(t, 0, 'fLaC') && t.length >= 8 && (t[4] & 0x7f) === 0 && t[5] === 0 && t[6] === 0 && t[7] === 34) return { format: 'flac' };
  if ((ascii(t, 0, 'II*\0') || ascii(t, 0, 'MM\0*'))) return { format: ascii(t, 8, 'CR') ? 'cr2' : 'tiff' };
  if (ascii(t, 0, 'II+\0') || ascii(t, 0, 'MM\0+')) return { format: 'bigtiff' };
  if (ascii(t, 0, 'IIRO') || ascii(t, 0, 'IIRS')) return { format: 'orf' };
  if (ascii(t, 0, 'IIU\0')) return { format: 'rw2' };
  if ((t[0] === 0xff && t[1] === 0x0a) || (u32be(t, 0) === 12 && ascii(t, 4, 'JXL '))) return { format: 'jxl' };
  if (t[0] === 0 && t[1] === 0 && t[2] === 1 && t[3] === 0 && t.length >= 6) { const n = t[4] + (t[5] << 8); if (n >= 1 && n <= 256 && (t.length < 10 || t[9] === 0)) return { format: 'ico' }; }
  if (t[0] === 0x42 && t[1] === 0x4d && t.length >= 18) {
    const dib = u32le(t, 14), off = u32le(t, 10);
    if ([12, 40, 52, 56, 108, 124].includes(dib) && t[6] === 0 && t[7] === 0 && t[8] === 0 && t[9] === 0 && off < Math.max(taille, t.length)) return { format: 'bmp' };
  }
  { const s = lat1(t, 0, 1024); if (s.indexOf('%PDF-') >= 0) return { format: 'pdf' }; }
  if (ascii(t, 0, 'PK\x03\x04') || ascii(t, 0, 'PK\x05\x06')) return { format: zipTete(t) };
  if (t[0] === 0xd0 && t[1] === 0xcf && t[2] === 0x11 && t[3] === 0xe0 && t[4] === 0xa1 && t[5] === 0xb1 && t[6] === 0x1a && t[7] === 0xe1) return { format: 'ole' };
  if (ascii(t, 0, '{\\rtf')) return { format: 'rtf' };
  if (t[0] === 0x30 && t[1] === 0x26 && t[2] === 0xb2 && t[3] === 0x75 && t[4] === 0x8e && t[5] === 0x66 && t[6] === 0xcf && t[7] === 0x11) return { format: 'asf' };
  if (ascii(t, 0, 'FLV') && t[3] === 1) return { format: 'flv' };
  if (t.length >= 377 && t[0] === 0x47 && t[188] === 0x47 && t[376] === 0x47) return { format: 'mpeg-ts' };
  if (t.length >= 389 && t[4] === 0x47 && t[196] === 0x47 && t[388] === 0x47) return { format: 'mpeg-ts' };
  if (t[0] === 0 && t[1] === 0 && t[2] === 1 && t[3] === 0xba) return { format: 'mpeg-ps' };
  if (ascii(t, 0, '#!AMR')) return { format: 'amr' };
  if (ascii(t, 0, 'MThd')) return { format: 'midi' };
  if (ascii(t, 0, 'MAC ')) return { format: 'ape' };
  if (ascii(t, 0, 'wvpk')) return { format: 'wavpack' };
  if (t[0] === 0x1f && t[1] === 0x8b && t[2] === 8) return { format: 'gzip' };
  if (t[0] === 0x37 && t[1] === 0x7a && t[2] === 0xbc && t[3] === 0xaf && t[4] === 0x27 && t[5] === 0x1c) return { format: '7z' };
  if (ascii(t, 0, 'Rar!\x1a\x07')) return { format: 'rar' };
  if (t[0] === 0xff && (t[1] & 0xe0) === 0xe0) {
    if (troisTrames(t, 0)) return { format: 'mp3' };
    const a = trameAdts(t, 0);
    if (a && trameAdts(t, a.longueur)) return { format: 'aac' };
  }
  return undefined;
}

function marqueFtyp(t: Uint8Array): string {
  const taille = Math.min(u32be(t, 0), t.length);
  const majeure = lat1(t, 8, 4);
  const compat: string[] = [];
  for (let p = 16; p + 4 <= taille && compat.length < 64; p += 4) compat.push(lat1(t, p, 4));
  const parMarque = (m: string): string | undefined => {
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'].includes(m)) return 'heic';
    if (m === 'avif' || m === 'avis') return 'avif';
    if (m === 'crx ') return 'cr3';
    if (m === 'M4A ' || m === 'M4P ') return 'm4a';
    if (m === 'M4B ') return 'm4b';
    if (m === 'qt  ') return 'mov';
    if (['3gp4', '3gp5', '3gp6', '3g2a', '3gp7', '3ge6', '3gg6'].includes(m)) return '3gp';
    return undefined;
  };
  if (majeure === 'mif1' || majeure === 'msf1') {
    if (compat.includes('avif') || compat.includes('avis')) return 'avif';
    if (compat.some((c) => ['heic', 'heix', 'hevc', 'hevx'].includes(c))) return 'heic';
    return 'heif';
  }
  return parMarque(majeure) ?? 'mp4';
}

function docTypeEbml(t: Uint8Array): string {
  for (let i = 4; i + 3 < Math.min(t.length, 128); i++) {
    if (t[i] === 0x42 && t[i + 1] === 0x82) {
      const l = t[i + 2] & 0x7f;
      if (t[i + 2] & 0x80 && l > 0 && l < 32) { const d = lat1(t, i + 3, l).split('\0')[0]; return d === 'webm' ? 'webm' : 'mkv'; }
    }
  }
  return 'mkv';
}

/** Sous-type d'un ZIP d'après sa tête seule (le répertoire central fait foi quand on a la source). */
function zipTete(t: Uint8Array): string {
  const n = t[26] + (t[27] << 8), x = t[28] + (t[29] << 8);
  const nom = lat1(t, 30, n);
  if (nom === 'mimetype') {
    const m = lat1(t, 30 + n + x, 64);
    if (m.startsWith('application/epub+zip')) return 'epub';
    if (m.startsWith('application/vnd.oasis.opendocument.text')) return 'odt';
    if (m.startsWith('application/vnd.oasis.opendocument.spreadsheet')) return 'ods';
    if (m.startsWith('application/vnd.oasis.opendocument.presentation')) return 'odp';
  }
  const s = lat1(t, 0, t.length);
  if (s.indexOf('[Content_Types].xml') >= 0 || s.indexOf('_rels/') >= 0) {
    if (s.indexOf('word/') >= 0) return 'docx';
    if (s.indexOf('xl/') >= 0) return 'xlsx';
    if (s.indexOf('ppt/') >= 0) return 'pptx';
  }
  return 'zip';
}

// ─────────────────────────────── Texte ───────────────────────────────

function texteOuInconnu(t: Uint8Array): { format: string; encodage?: Nature['encodage']; certitude: Nature['certitude']; texte: string } {
  const b = Buffer.from(t.buffer, t.byteOffset, t.byteLength);
  let enc: Nature['encodage'] | undefined, texte = '';
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) { enc = { nom: 'utf-8', bom: true, sur: true }; texte = new TextDecoder('utf-8').decode(b.subarray(3)); }
  else if (b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0) { enc = { nom: 'utf-32le', bom: true, sur: true }; texte = utf32(b.subarray(4), true); }
  else if (b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff) { enc = { nom: 'utf-32be', bom: true, sur: true }; texte = utf32(b.subarray(4), false); }
  else if (b[0] === 0xff && b[1] === 0xfe) { enc = { nom: 'utf-16le', bom: true, sur: true }; texte = new TextDecoder('utf-16le').decode(b.subarray(2)); }
  else if (b[0] === 0xfe && b[1] === 0xff) { enc = { nom: 'utf-16be', bom: true, sur: true }; texte = new TextDecoder('utf-16be').decode(b.subarray(2)); }
  else {
    let ok = false;
    for (let k = 0; k <= 3 && !ok; k++) {
      try { texte = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, b.length - k)); ok = true; } catch { /* séquence coupée en fin ? */ }
    }
    if (ok) { if (!binaire(b)) enc = { nom: 'utf-8', bom: false, sur: true }; }
    else {
      // Un octet sur deux à 00 → UTF-16 sans BOM.
      const n = Math.min(512, b.length) & ~1;
      let pairs = 0, impairs = 0;
      for (let i = 0; i < n; i += 2) { if (b[i] === 0) pairs++; if (b[i + 1] === 0) impairs++; }
      if (n >= 4 && (impairs > n / 2 * 0.8 || pairs > n / 2 * 0.8)) { const nom = impairs > pairs ? 'utf-16le' : 'utf-16be'; enc = { nom, bom: false, sur: false }; texte = new TextDecoder(nom).decode(b.subarray(0, b.length & ~1)); }
      else if (!binaire(b)) { const d = decoderLatin1Douteux(b); enc = { nom: 'windows-1252', bom: false, sur: false, candidats: d.candidats.map((c) => c.encodage) }; texte = new TextDecoder('windows-1252').decode(b); }
    }
  }
  if (!enc) {
    // UTF-16 sans BOM même si l'UTF-8 strict a réussi (que des caractères ASCII et des 00).
    const n = Math.min(512, b.length) & ~1;
    let impairs = 0, pairs = 0;
    for (let i = 0; i < n; i += 2) { if (b[i] === 0) pairs++; if (b[i + 1] === 0) impairs++; }
    if (n >= 4 && (impairs > n / 2 * 0.8 || pairs > n / 2 * 0.8)) { const nom = impairs > pairs ? 'utf-16le' : 'utf-16be'; enc = { nom, bom: false, sur: false }; texte = new TextDecoder(nom).decode(b.subarray(0, b.length & ~1)); }
    else return { format: 'inconnu', certitude: 'probable', texte: '' };
  }
  return { format: sorteDeTexte(texte.slice(0, 4096), b), encodage: enc, certitude: enc.sur ? 'sure' : 'probable', texte };
}
function utf32(b: Buffer, le: boolean): string {
  let r = '';
  for (let i = 0; i + 4 <= b.length && r.length < 8192; i += 4) { const c = le ? b.readUInt32LE(i) : b.readUInt32BE(i); r += c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : '\uFFFD'; }
  return r;
}
/** Plus de 1 % d'octets de contrôle (00–08, 0E–1A, 1C–1F) → binaire. */
function binaire(b: Uint8Array): boolean {
  let n = 0;
  for (const o of b) if (o <= 8 || (o >= 0x0e && o <= 0x1a) || (o >= 0x1c && o <= 0x1f)) n++;
  return n > b.length / 100;
}

const estChiffre = (c: string) => c >= '0' && c <= '9';
/** « 00:00:01,000 --> 00:00:02,500 » (virgule ou point), analysée caractère par caractère. */
export function ligneHorodatage(l: string): boolean {
  const t = l.trim();
  const temps = (p: number): number => {
    // hh:mm:ss[,.]mmm (heures 1 à 3 chiffres)
    let q = p, h = 0;
    while (q < t.length && estChiffre(t[q]) && h < 3) { q++; h++; }
    if (!h || t[q] !== ':' || !estChiffre(t[q + 1]) || !estChiffre(t[q + 2]) || t[q + 3] !== ':' || !estChiffre(t[q + 4]) || !estChiffre(t[q + 5])) return -1;
    q += 6;
    if (t[q] === ',' || t[q] === '.') { q++; let m = 0; while (q < t.length && estChiffre(t[q]) && m < 3) { q++; m++; } if (!m) return -1; }
    return q;
  };
  const a = temps(0);
  if (a < 0) return false;
  let q = a;
  while (t[q] === ' ') q++;
  if (!t.startsWith('-->', q)) return false;
  q += 3;
  while (t[q] === ' ') q++;
  return temps(q) > 0;
}

function sorteDeTexte(s: string, b: Buffer): string {
  const t = s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  const debut = t.trimStart();
  if (debut.startsWith('WEBVTT')) return 'vtt';
  const lignes = t.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  // SRT : un numéro puis une ligne d'horodatage (ou directement l'horodatage).
  let i = 0;
  while (i < lignes.length && !lignes[i].trim()) i++;
  if (i < lignes.length) {
    const l0 = lignes[i].trim();
    let num = l0.length > 0 && l0.length < 10;
    for (const c of l0) if (!estChiffre(c)) num = false;
    if ((num && i + 1 < lignes.length && ligneHorodatage(lignes[i + 1])) || ligneHorodatage(l0)) return 'srt';
  }
  if (debut.startsWith('[Script Info]')) return 'ass';
  const bas = debut.slice(0, 512).toLowerCase();
  if (bas.startsWith('<svg') || (bas.startsWith('<?xml') && bas.includes('<svg'))) return 'svg';
  if (bas.startsWith('<!doctype html') || bas.startsWith('<html')) return 'html';
  if (bas.startsWith('<?xml')) return 'xml';
  if ((debut.startsWith('{') || debut.startsWith('[')) && b.length <= 1024 * 1024) { try { const j = b.toString('utf8'); JSON.parse(j.charCodeAt(0) === 0xfeff ? j.slice(1) : j); return 'json'; } catch { /* pas du JSON complet */ } }
  // CSV : séparateurs réguliers sur les 5 premières lignes.
  const cinq = lignes.filter((l) => l.trim()).slice(0, 5);
  if (cinq.length >= 2) {
    for (const sep of [';', ',', '\t']) {
      const n = cinq.map((l) => l.split(sep).length - 1);
      if (n[0] > 0 && n.every((x) => x === n[0])) return 'csv';
    }
  }
  return 'texte';
}

// ─────────────────────────────── Entrées publiques ───────────────────────────────

/** Pur : reconnaît d'après la tête (et la queue si donnée). */
export function reconnaitreOctets(tete: Uint8Array, o: { taille?: number; nom?: string; queue?: Uint8Array } = {}): Nature {
  const taille = o.taille ?? tete.length;
  const id3 = tailleId3(Buffer.from(tete.buffer, tete.byteOffset, tete.byteLength));
  if (id3 !== undefined && id3 <= taille) return analyser(tete.subarray(Math.min(id3, tete.length)), id3, taille, o.nom, o.queue);
  const abimee = id3AbimeeOuTropLongue(tete, id3, taille);
  if (abimee) return abimee;
  return analyser(tete, 0, taille, o.nom, o.queue);
}

/** `t` : les octets qui suivent une éventuelle balise ID3 (de longueur `debut`). */
function analyser(t: Uint8Array, debut: number, taille: number, nom?: string, q?: Uint8Array): Nature {
  const alertes: string[] = [];
  if (debut > 0 && t.length < 4) return creerNature('mp3', { nom, debut, certitude: 'probable', alertes: ['balise ID3 seule dans les octets lus'] });
  let s = signature(t, taille);
  if (debut > 0) {
    if (s?.format === 'flac' || s?.format === 'aac') alertes.push(`balise ID3 devant un ${s.format.toUpperCase()} (non standard)`);
    else if (!s || s.format !== 'mp3') {
      // Chercher une trame MP3 dans les 64 Kio qui suivent.
      let trouve = false;
      for (let i = 0; i + 4 <= t.length && i < 64 * 1024; i++) if (t[i] === 0xff && trameMp3(t, i)) { trouve = true; break; }
      if (!s || trouve) s = { format: 'mp3' };
      if (!trouve && s.format === 'mp3') alertes.push('aucune trame MP3 trouvée après la balise ID3');
    }
  }
  if (s) {
    const n = creerNature(s.format, { nom, debut, alertes: [...alertes, ...(s.alertes ?? [])] });
    if (q) queue(n, q);
    return n;
  }
  const tx = texteOuInconnu(t);
  const n = creerNature(tx.format, { nom, certitude: tx.certitude, encodage: tx.encodage });
  if (tx.format === 'texte' && tx.encodage && !tx.encodage.sur) n.nom = 'Fichier texte, encodage incertain';
  return n;
}

/** « ID3 » en tête mais taille non syncsafe ou plus longue que le fichier : un son abîmé, dit tel quel. */
function id3AbimeeOuTropLongue(t: Uint8Array, id3: number | undefined, taille: number, nom?: string): Nature | undefined {
  if (!(t.length >= 10 && t[0] === 0x49 && t[1] === 0x44 && t[2] === 0x33 && t[3] >= 2 && t[3] <= 4)) return undefined;
  if (id3 !== undefined && id3 <= taille) return undefined;
  return creerNature('mp3', { nom, certitude: 'douteuse', alertes: [id3 === undefined ? 'balise ID3 abîmée (taille illisible)' : 'balise ID3 plus longue que le fichier'] });
}

/** Données en queue (JPEG après le dernier FF D9, PDF après le dernier %%EOF). */
function queue(n: Nature, q: Uint8Array): void {
  let fin = -1;
  if (n.format === 'jpeg') {
    for (let i = q.length - 2; i >= 0; i--) if (q[i] === 0xff && q[i + 1] === 0xd9) { fin = i + 2; break; }
  } else if (n.format === 'pdf') {
    const s = lat1(q, 0, q.length);
    const k = s.lastIndexOf('%%EOF');
    if (k >= 0) { fin = k + 5; while (fin < q.length && (q[fin] === 0x0d || q[fin] === 0x0a || q[fin] === 0x20)) fin++; }
  }
  if (fin >= 0 && fin < q.length) n.alertes.push(`données en queue : ${enClair(q.length - fin)} octets`);
}

/** Reconnaît un fichier (tête, ID3, queue, sous-type ZIP par le répertoire central). */
export function reconnaitreNature(src: Source, nomFichier?: string): Nature {
  const tete = src.lire(0, 4096);
  const id3 = tailleId3(tete);
  const n = id3 !== undefined && id3 > 0 && id3 <= src.taille
    ? analyser(src.lire(id3, 64 * 1024 + 4), id3, src.taille, nomFichier)
    : id3AbimeeOuTropLongue(tete, id3, src.taille, nomFichier) ?? analyser(tete, 0, src.taille, nomFichier);
  return completer(n, src, nomFichier);
}

function completer(n0: Nature, src: Source, nomFichier: string | undefined): Nature {
  let n = n0;
  // Un JSON plus long que la tête : relu en entier (1 Mio au plus).
  if (n.format === 'texte' && src.taille <= 1024 * 1024 && n.encodage?.nom === 'utf-8') {
    const tout = src.lire(0, src.taille).toString('utf8');
    const t = (tout.charCodeAt(0) === 0xfeff ? tout.slice(1) : tout).trimStart();
    if (t.startsWith('{') || t.startsWith('[')) { try { JSON.parse(t); const a = n.alertes; n = creerNature('json', { nom: nomFichier, encodage: n.encodage }); n.alertes.push(...a.filter((x) => !x.startsWith('extension'))); } catch { /* pas du JSON */ } }
  }
  if (n.format === 'jpeg' || n.format === 'pdf') {
    const q0 = Math.max(0, src.taille - 65_557);
    queue(n, src.lire(q0, src.taille - q0));
  }
  if (['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub'].includes(n.format)) {
    try {
      const z = listerZip(src);
      const st = sousTypeZip(src, z.entrees);
      if (st !== n.format) { const a = n.alertes; n = creerNature(st, { nom: nomFichier, debut: n.debut }); n.alertes.push(...a.filter((x) => !x.startsWith('extension'))); }
      if (z.queue) n.alertes.push(`données en queue : ${enClair(z.queue)} octets`);
      if (z.partiel) n.alertes.push(z.partiel);
    } catch (e) { n.alertes.push(`ZIP : ${(e as Error).message}`); n.certitude = 'probable'; }
  }
  return n;
}
