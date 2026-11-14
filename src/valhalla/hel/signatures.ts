// Perséphone · retrouver des fichiers par leur signature. Un fichier effacé n'est plus dans aucun dossier, mais ses
// octets sont encore là tant que rien n'a été écrit par-dessus. Chaque format commence par une marque connue ; on
// la cherche au début de chaque secteur, puis on LIT la structure du fichier pour savoir où il finit et s'il est
// entier (taille écrite dans l'en-tête, marque de fin, sommes de contrôle quand le format en a). Un fichier dont la
// structure se casse en route est gardé jusqu'à la cassure et signalé « abîmé ».
// Formats : JPEG, PNG, GIF, WebP, BMP, HEIC/AVIF · MP4/MOV/3GP, AVI, MKV/WebM · PDF, DOCX/XLSX/PPTX/ODT…, anciens
// DOC/XLS/PPT · ZIP, 7z, RAR, gzip · MP3, WAV, FLAC, M4A. Écrit d'après les spécifications publiques de chaque format.
import { createInflateRaw } from 'node:zlib';
import { crc16, crc32, crc8, propre, u64be, u64le } from './octets.ts';
import type { Lecteur } from './support.ts';

export type Famille = 'photos' | 'videos' | 'documents' | 'archives' | 'son';
export const FAMILLES: Famille[] = ['photos', 'videos', 'documents', 'archives', 'son'];
export interface Mesure {
  /** octets à garder depuis le début */
  taille: number;
  /** la structure a été lue jusqu'au bout et vérifiée */
  entier: boolean;
  ext: string; famille: Famille;
  /** ce qui ne va pas (fichier abîmé) */
  note?: string;
  /** nom d'origine, quand le fichier le porte lui-même */
  nom?: string;
  /** plus gros que la taille maximale réglée pour ce type : pas repris */
  tropGros?: boolean;
  /** la fin n'a pas été trouvée : la taille est à borner par le début du fichier suivant */
  ouvert?: boolean;
  /** format sans marque de fin ni somme de contrôle (WAV, BMP, WebP) : la taille vient de l'en-tête, le contenu ne peut pas être vérifié */
  fragile?: boolean;
}
const VIDE = Buffer.alloc(0), FEN = 1 << 20, MO = 1024 * 1024, GO = 1024 * MO;

/** Un fichier possible, vu depuis son premier octet : lectures par fenêtres gardées en mémoire (une à la fois). */
export class Vue {
  private l: Lecteur; private d = -1; private b: Buffer = VIDE;
  readonly base: number;
  /** octets disponibles depuis le début du fichier jusqu'à la fin du support */
  readonly fin: number;
  constructor(l: Lecteur, base: number) { this.l = l; this.base = base; this.fin = Math.max(0, l.taille - base); }
  async lire(off: number, n: number): Promise<Buffer> {
    if (off < 0 || off >= this.fin || n <= 0) return VIDE;
    n = Math.min(n, this.fin - off);
    if (this.d >= 0 && off >= this.d && off + n <= this.d + this.b.length) return this.b.subarray(off - this.d, off - this.d + n);
    this.b = await this.l.lire(this.base + off, Math.min(Math.max(n, 262144), this.fin - off)); this.d = off;
    return this.b.subarray(0, Math.min(n, this.b.length));
  }
}
const txt = (b: Buffer, o: number, n: number) => b.toString('latin1', o, o + n);
const COUPE = 'fichier coupé : la suite n\'a pas été retrouvée';

// ---------------------------------------------------------------- photos
async function jpeg(v: Vue, max: number): Promise<Mesure | undefined> {
  const lim = Math.min(max, v.fin), M = (taille: number, entier: boolean): Mesure => ({ taille, entier, ext: 'jpg', famille: 'photos', ...(entier ? {} : { note: 'image coupée : il manque la fin', ouvert: true }) });
  let off = 2, cadre = false, balayages = 0;
  const casse = (ou: number) => (cadre && balayages ? M(Math.min(ou, lim), false) : undefined);
  for (let tours = 0; tours < 200000; tours++) {
    const h = await v.lire(off, 10); if (h.length < 4 || h[0] !== 0xff) return casse(off);
    const m = h[1];
    if (m === 0xff) { off++; continue; }
    if (m === 0xd9) return cadre && balayages ? M(off + 2, true) : undefined;
    if (m < 0xc0 || (m >= 0xd0 && m <= 0xd8)) return casse(off);
    const len = h.readUInt16BE(2); if (len < 2) return casse(off);
    if (m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { if (h.length < 9 || !h.readUInt16BE(7)) return casse(off); cadre = true; }
    off += 2 + len; if (off >= lim) return casse(lim);
    if (m !== 0xda) continue;
    // Données de l'image : tout octet FF y est suivi de 00 (ou d'un repère de reprise). Autre chose : un marqueur.
    balayages++; let marqueur = false;
    while (off < lim && !marqueur) {
      const w = await v.lire(off, FEN); if (!w.length) break;
      let i = 0;
      for (;;) { i = w.indexOf(0xff, i); if (i < 0 || i === w.length - 1) break; const x = w[i + 1]; if (x === 0 || (x >= 0xd0 && x <= 0xd7)) { i += 2; continue; } if (x === 0xff) { i++; continue; } marqueur = true; break; }
      if (i >= 0 && (marqueur || w.length > 1)) off += i; else { off += w.length; if (i >= 0) break; }
    }
    if (!marqueur) return M(Math.min(off, lim), false);
  }
  return casse(off);
}
async function png(v: Vue, max: number): Promise<Mesure | undefined> {
  const lim = Math.min(max, v.fin), M = (taille: number, entier: boolean, note?: string): Mesure => ({ taille, entier, ext: 'png', famille: 'photos', ...(note ? { note } : {}) });
  let off = 8, image = false;
  for (let tours = 0; tours < 1e6; tours++) {
    const h = await v.lire(off, 8); if (h.length < 8) break;
    const len = h.readUInt32BE(0), type = txt(h, 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type) || len > 0x7fffffff) break;
    if (off === 8 && (type !== 'IHDR' || len !== 13)) return undefined;
    if (off + 12 + len > lim) { if (off + 12 + len > v.fin) break; return { ...M(off + 12 + len, false), tropGros: true }; }
    let c = crc32(h.subarray(4, 8));
    for (let p = 0; p < len; p += FEN) c = crc32(await v.lire(off + 8 + p, Math.min(FEN, len - p)), c);
    const s = await v.lire(off + 8 + len, 4); if (s.length < 4 || s.readUInt32BE(0) !== c) { if (off === 8) return undefined; break; }
    off += 12 + len; if (type === 'IDAT') image = true;
    if (type === 'IEND') return image ? M(off, true) : undefined;
  }
  return image ? M(off, false, 'image coupée : un morceau ne passe pas sa somme de contrôle') : undefined;
}
async function gif(v: Vue, max: number): Promise<Mesure | undefined> {
  const lim = Math.min(max, v.fin), h = await v.lire(0, 13); if (h.length < 13 || !h.readUInt16LE(6) || !h.readUInt16LE(8)) return undefined;
  const palette = (x: number) => (x & 0x80 ? 3 * (1 << ((x & 7) + 1)) : 0);
  let off = 13 + palette(h[10]), images = 0;
  const sousBlocs = async (): Promise<boolean> => { for (;;) { const b = await v.lire(off, 1); if (!b.length || off > lim) return false; off += 1 + b[0]; if (b[0] === 0) return true; } };
  for (let tours = 0; tours < 1e6; tours++) {
    const b = await v.lire(off, 10); if (!b.length) break;
    if (b[0] === 0x3b) return images ? { taille: off + 1, entier: true, ext: 'gif', famille: 'photos' } : undefined;
    if (b[0] === 0x21) { off += 2; if (!await sousBlocs()) break; }
    else if (b[0] === 0x2c) { if (b.length < 10) break; off += 10 + palette(b[9]); const c = await v.lire(off, 1); if (!c.length || c[0] < 1 || c[0] > 11) break; off++; if (!await sousBlocs()) break; images++; }
    else break;
  }
  return images ? { taille: Math.min(off, lim), entier: false, ext: 'gif', famille: 'photos', note: 'image coupée : il manque la fin', ouvert: true } : undefined;
}
async function bmp(v: Vue, max: number): Promise<Mesure | undefined> {
  const h = await v.lire(0, 34); if (h.length < 34) return undefined;
  const total = h.readUInt32LE(2), donnees = h.readUInt32LE(10), entete = h.readUInt32LE(14), largeur = Math.abs(h.readInt32LE(18)), hauteur = Math.abs(h.readInt32LE(22)), bits = h.readUInt16LE(28), compression = h.readUInt32LE(30);
  if (![40, 52, 56, 108, 124].includes(entete) || h.readUInt16LE(26) !== 1 || ![1, 4, 8, 16, 24, 32].includes(bits) || !largeur || !hauteur || donnees < 14 + entete || donnees >= total) return undefined;
  // Image non compressée : la taille annoncée doit être celle que donnent la largeur et la hauteur.
  if (compression === 0 || compression === 3) { const attendu = donnees + Math.floor((bits * largeur + 31) / 32) * 4 * hauteur; if (total < attendu || total > attendu + 4096) return undefined; }
  if (total > max) return { taille: total, entier: false, ext: 'bmp', famille: 'photos', tropGros: true };
  return total > v.fin ? { taille: v.fin, entier: false, ext: 'bmp', famille: 'photos', note: COUPE } : { taille: total, entier: true, ext: 'bmp', famille: 'photos', fragile: true };
}

// ---------------------------------------------------------------- conteneurs RIFF (AVI, WAV, WebP)
async function riff(v: Vue, max: number): Promise<Mesure | undefined> {
  const h = await v.lire(0, 12); if (h.length < 12) return undefined;
  const forme = txt(h, 8, 4), genre = forme === 'AVI ' ? ['avi', 'videos'] as const : forme === 'WAVE' ? ['wav', 'son'] as const : forme === 'WEBP' ? ['webp', 'photos'] as const : undefined;
  if (!genre) return undefined;
  const premier = h.readUInt32LE(4) + 8, M = (taille: number, entier: boolean, note?: string): Mesure => ({ taille, entier, ext: genre[0], famille: genre[1], ...(note ? { note } : {}) });
  if (premier < 20) return undefined;
  let total = premier;
  // Une vidéo AVI de plus de 1 ou 2 Go continue dans d'autres blocs « RIFF … AVIX » rangés à la suite.
  if (forme === 'AVI ') for (let n = 0; n < 4096; n++) { const p = total + (total & 1), s = await v.lire(p, 12); if (s.length < 12 || txt(s, 0, 4) !== 'RIFF' || txt(s, 8, 4) !== 'AVIX') break; total = p + s.readUInt32LE(4) + 8; }
  if (total > max) return { ...M(total, false), tropGros: true };
  // La liste des morceaux du premier bloc doit se suivre sans trou jusqu'à sa fin.
  let off = 12, suite = true, morceaux = 0;
  while (off + 8 <= premier && off + 8 <= v.fin) { const c = await v.lire(off, 8); if (c.length < 8 || !/^[\x20-\x7e]{4}$/.test(txt(c, 0, 4))) { suite = false; break; } const n = c.readUInt32LE(4); off += 8 + n + (n & 1); morceaux++; }
  if (!morceaux || (!suite && morceaux < 2)) return undefined;
  if (total > v.fin) return M(v.fin, false, COUPE);
  return suite && (off === premier || off === premier + 1) ? { ...M(total, true), ...(forme === 'AVI ' ? {} : { fragile: true }) } : M(total, false, 'la suite des morceaux est interrompue : fichier sans doute en plusieurs parties');
}

// ---------------------------------------------------------------- MP4, MOV, 3GP, M4A, HEIC, AVIF (boîtes ISO)
const BOITES = new Set(['ftyp', 'styp', 'moov', 'mdat', 'free', 'skip', 'wide', 'uuid', 'meta', 'moof', 'mfra', 'sidx', 'ssix', 'pdin', 'prft', 'emsg', 'junk', 'pnot', 'PICT', 'pict', 'udta', 'bloc', 'idat', 'meco', 'imda', 'thmb']);
function genreIso(marque: string): [string, Famille] {
  if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(marque)) return ['heic', 'photos'];
  if (/^avi[fs]$/.test(marque)) return ['avif', 'photos'];
  if (marque === 'crx ') return ['cr3', 'photos'];
  if (/^M4[AB] $/.test(marque)) return ['m4a', 'son'];
  if (marque === 'qt  ') return ['mov', 'videos'];
  if (/^3g[p2g]/.test(marque)) return ['3gp', 'videos'];
  return ['mp4', 'videos'];
}
/**
 * La table d'une vidéo MP4 / MOV (boîte « moov ») : ses boîtes doivent s'emboîter exactement, et les positions des
 * morceaux de son et d'image qu'elle annonce doivent tomber dans les données du fichier, sans jamais reculer.
 */
async function tableIso(v: Vue, debut: number, fin: number, donnees: [number, number], niveau = 0): Promise<boolean> {
  let off = debut, n = 0;
  while (off + 8 <= fin) {
    const h = await v.lire(off, 16); if (h.length < 8) return false;
    let t = h.readUInt32BE(0), tete = 8; const type = txt(h, 4, 4);
    if (t === 1) { if (h.length < 16) return false; t = u64be(h, 8); tete = 16; }
    if (t < tete || off + t > fin || !/^[\x20-\x7e\xa9]{4}$/.test(type)) return false;
    if (niveau < 6 && /^(trak|mdia|minf|stbl)$/.test(type)) { if (!await tableIso(v, off + tete, off + t, donnees, niveau + 1)) return false; }
    else if (type === 'stco' || type === 'co64') {
      const e = await v.lire(off + tete, 8), large = type === 'co64' ? 8 : 4; if (e.length < 8) return false;
      const nb = e.readUInt32BE(4); if (tete + 8 + nb * large !== t) return false;
      let avant = -1;
      for (let i = 0; i < nb; ) { const w = await v.lire(off + tete + 8 + i * large, Math.min(nb - i, 32768) * large); if (w.length < large) return false; for (let k = 0; k + large <= w.length; k += large, i++) { const x = large === 4 ? w.readUInt32BE(k) : u64be(w, k); if (x < donnees[0] || x >= donnees[1] || x < avant) return false; avant = x; } }
    }
    off += t; n++;
  }
  return off === fin && n > 0;
}
async function iso(v: Vue, max: number): Promise<Mesure | undefined> {
  let off = 0, n = 0, mdat = false, meta = false, moof = false, genre: [string, Famille] = ['mp4', 'videos'], ouvert = false, moov: [number, number] | undefined; const donnees: [number, number] = [Infinity, 0];
  const M = (taille: number, entier: boolean, note?: string): Mesure => ({ taille, entier, ext: genre[0], famille: genre[1], ...(note ? { note } : {}) });
  for (; n < 200000; n++) {
    const h = await v.lire(off, 16); if (h.length < 8) break;
    let t = h.readUInt32BE(0), tete = 8; const type = txt(h, 4, 4);
    if (n === 0) { if (type !== 'ftyp' || t < 16 || t > 4096 || h.length < 12 || !/^[\x20-\x7e]{4}$/.test(txt(h, 8, 4))) return undefined; genre = genreIso(txt(h, 8, 4)); }
    else if (!BOITES.has(type)) break;
    if (t === 1) { if (h.length < 16) break; t = u64be(h, 8); tete = 16; if (!Number.isFinite(t) || t < 16) break; }
    // Taille 0 : « jusqu'à la fin du fichier ». La fin n'est alors écrite nulle part.
    else if (t === 0) { ouvert = type === 'mdat'; if (ouvert) mdat = true; break; }
    else if (t < 8) break;
    if (off + t > max) return { ...M(off + t, false), tropGros: true };
    if (off + t > v.fin) return n > 0 ? M(v.fin, false, COUPE) : undefined;
    if (type === 'moov') moov = [off + tete, off + t];
    else if (type === 'mdat' || type === 'idat') { mdat = true; donnees[0] = Math.min(donnees[0], off + tete); donnees[1] = Math.max(donnees[1], off + t); }
    else if (type === 'meta') meta = true; else if (type === 'moof') moof = true;
    off += t;
  }
  if (n < 2) return undefined;
  if (ouvert) return { ...M(off, false, 'la fin de la vidéo n\'est pas écrite dans le fichier'), ouvert: true };
  if (moov && mdat && !moof && !await tableIso(v, moov[0], moov[1], donnees)) return M(off, false, 'la table qui décrit la vidéo est abîmée (fichier coupé ou en plusieurs parties)');
  return (moov && mdat) || (meta && (mdat || genre[1] === 'photos')) || (moof && mdat) ? M(off, true) : M(off, false, moov || meta ? 'il manque les données' : 'il manque la table qui décrit la vidéo (fichier coupé ou en plusieurs parties)');
}

// ---------------------------------------------------------------- MKV, WebM (EBML)
function tailleEbml(b: Buffer, o: number): { v: number; n: number; inconnu: boolean } | undefined {
  if (o >= b.length || b[o] === 0) return undefined;
  const n = Math.clz32(b[o]) - 23; if (o + n > b.length) return undefined;
  let v = b[o] & (0xff >> n), tout = v === (0xff >> n);
  for (let i = 1; i < n; i++) { v = v * 256 + b[o + i]; if (b[o + i] !== 0xff) tout = false; }
  return { v, n, inconnu: tout };
}
const NIVEAU1 = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367, 0xec, 0xbf]);
const DANS_GRAPPE = new Set([0xe7, 0xa3, 0xa0, 0xab, 0xa7, 0x5854, 0xec, 0xbf]);
function idEbml(b: Buffer, o: number): { id: number; n: number } | undefined {
  if (o >= b.length || b[o] === 0) return undefined;
  const n = Math.clz32(b[o]) - 23; if (n > 4 || o + n > b.length) return undefined;
  let id = 0; for (let i = 0; i < n; i++) id = id * 256 + b[o + i]; return { id, n };
}
async function mkv(v: Vue, max: number): Promise<Mesure | undefined> {
  const h = await v.lire(0, 4096), s = tailleEbml(h, 4); if (!s || s.inconnu || s.v > 4000 || 4 + s.n + s.v + 12 > h.length) return undefined;
  const fin = 4 + s.n + s.v, d = h.subarray(4 + s.n, fin), k = d.indexOf(Buffer.from([0x42, 0x82])), nom = k >= 0 ? tailleEbml(d, k + 2) : undefined;
  const type = nom ? txt(d, k + 2 + nom.n, nom.v) : ''; if (type !== 'matroska' && type !== 'webm') return undefined;
  const ext = type === 'webm' ? 'webm' : 'mkv', M = (taille: number, entier: boolean, note?: string): Mesure => ({ taille, entier, ext, famille: 'videos', ...(note ? { note } : {}) });
  if (h.readUInt32BE(fin) !== 0x18538067) return undefined;
  const seg = tailleEbml(h, fin + 4); if (!seg) return undefined;
  const debut = fin + 4 + seg.n, total = seg.inconnu ? Infinity : debut + seg.v;
  if (Number.isFinite(total) && total > max) return { ...M(total, false), tropGros: true };
  // On suit les éléments du premier niveau (pistes, grappes d'images, index…) : ils doivent s'enchaîner sans trou.
  let off = debut, grappes = 0;
  for (let n = 0; n < 5e6 && off < total && off < v.fin; n++) {
    const e = await v.lire(off, 12), id = idEbml(e, 0), t = id ? tailleEbml(e, id.n) : undefined;
    if (!id || !t || !NIVEAU1.has(id.id)) break;
    if (t.inconnu) {
      // Une grappe d'images dont la taille n'est pas écrite (vidéo enregistrée en direct) : on suit ses blocs un à un.
      if (id.id !== 0x1f43b675) break;
      let q = off + id.n + t.n;
      for (let k = 0; k < 1e6; k++) { const c = await v.lire(q, 12), ci = idEbml(c, 0), ct = ci ? tailleEbml(c, ci.n) : undefined; if (!ci || !ct || ct.inconnu || !DANS_GRAPPE.has(ci.id)) break; q += ci.n + ct.n + ct.v; }
      if (q > max) return { ...M(q, false), tropGros: true };
      off = q; grappes++; continue;
    }
    if (id.id === 0x1f43b675) grappes++;
    off += id.n + t.n + t.v; if (off > max) return { ...M(off, false), tropGros: true };
  }
  if (!grappes) return undefined;
  if (off > v.fin) return M(v.fin, false, COUPE);
  if (seg.inconnu) return M(off, true);
  return off === total ? M(total, true) : M(off, false, 'la suite des éléments est interrompue : vidéo coupée ou en plusieurs parties');
}

// ---------------------------------------------------------------- PDF
async function pdf(v: Vue, max: number): Promise<Mesure | undefined> {
  const lim = Math.min(max, v.fin), tete = await v.lire(0, 16); if (!/^%PDF-\d\.\d/.test(txt(tete, 0, 8))) return undefined;
  const M = (taille: number, entier: boolean, note?: string): Mesure => ({ taille, entier, ext: 'pdf', famille: 'documents', ...(note ? { note } : {}) });
  const FIN = Buffer.from('%%EOF'); let secours = -1;
  /** Le fichier qui s'arrête à `fin` est-il bien fermé : son dernier « startxref » désigne-t-il une table ? */
  const ferme = async (fin: number): Promise<boolean> => {
    const q = await v.lire(Math.max(0, fin - 1024), Math.min(1024, fin)), m = /startxref\s+(\d{1,15})\s+%%EOF\s*$/.exec(q.toString('latin1')); if (!m) return false;
    const ou = Number(m[1]); if (ou <= 0 || ou >= fin) return false;
    const t = (await v.lire(ou, 24)).toString('latin1'); return /^\s{0,2}xref|^\s{0,2}\d+ \d+ obj/.test(t);
  };
  for (let off = 0; off < lim; ) {
    const w = await v.lire(off, FEN + 8); if (w.length < 5) break;
    let i = 0;
    for (;;) {
      i = w.indexOf(FIN, i); if (i < 0 || i > FEN) break;
      let fin = off + i + 5; const ap = await v.lire(fin, 64);
      let k = 0; if (ap[0] === 0x0d && ap[1] === 0x0a) k = 2; else if (ap[0] === 0x0a || ap[0] === 0x0d) k = 1;
      fin += k;
      // Ce qui suit dit si le document continue (mise à jour ajoutée à la fin, PDF « linéarisé ») ou s'il est fini.
      let j = k; while (j < ap.length && (ap[j] === 0x20 || ap[j] === 0x0a || ap[j] === 0x0d || ap[j] === 0x09)) j++;
      const suite = ap.toString('latin1', j, j + 24);
      if (!/^(\d{1,10} \d{1,5} obj|xref|startxref|trailer)/.test(suite)) { if (await ferme(fin)) return M(fin, true); if (secours < 0) secours = fin; }
      i += 5;
    }
    off += FEN;
  }
  if (secours > 0) return M(secours, false, 'le document se termine, mais sa table des objets ne se retrouve pas : sans doute en plusieurs parties');
  return { ...M(Math.min(lim, FEN), false, 'la fin du document n\'a pas été retrouvée'), ouvert: true };
}

// ---------------------------------------------------------------- ZIP et documents de bureau (DOCX, XLSX, PPTX, ODT, EPUB…)
function genreZip(noms: string[], mime: string): [string, Famille] {
  const a = (re: RegExp) => noms.some((n) => re.test(n));
  if (/opendocument\.text/.test(mime)) return ['odt', 'documents']; if (/opendocument\.spreadsheet/.test(mime)) return ['ods', 'documents']; if (/opendocument\.presentation/.test(mime)) return ['odp', 'documents'];
  if (/epub\+zip/.test(mime)) return ['epub', 'documents'];
  if (a(/^\[Content_Types\]\.xml$/)) { if (a(/^word\//)) return ['docx', 'documents']; if (a(/^xl\//)) return ['xlsx', 'documents']; if (a(/^ppt\//)) return ['pptx', 'documents']; }
  if (a(/^AndroidManifest\.xml$/)) return ['apk', 'archives']; if (a(/^META-INF\/MANIFEST\.MF$/)) return ['jar', 'archives'];
  return ['zip', 'archives'];
}
async function zip(v: Vue, max: number): Promise<Mesure | undefined> {
  const lim = Math.min(max, v.fin), u32 = async (ou: number) => { const x = await v.lire(ou, 4); return x.length < 4 ? -1 : x.readUInt32LE(0); }; let off = 0, entrees = 0, mime = '', repertoire = -1, valide = false, confirme = 0;
  // 1. Les fichiers rangés au début, l'un après l'autre, tant que leur taille est écrite dans leur en-tête.
  for (; entrees < 1e6; entrees++) {
    const h = await v.lire(off, 30); if (h.length < 30) break;
    const sig = h.readUInt32LE(0);
    if (sig === 0x02014b50) { repertoire = off; confirme = off; break; }
    if (sig !== 0x04034b50) break;
    confirme = off;
    const drapeaux = h.readUInt16LE(6), methode = h.readUInt16LE(8), comprime = h.readUInt32LE(18), nNom = h.readUInt16LE(26), nPlus = h.readUInt16LE(28);
    if (!valide) {
      if ((h.readUInt16LE(4) & 0xff) > 63 || ![0, 8, 9, 12, 14, 93, 95, 98, 99].includes(methode) || nNom === 0 || nNom > 1024) return undefined;
      const nom = (await v.lire(30, nNom)).toString('latin1'); if (/[\x00-\x1f]/.test(nom)) return undefined;
      if (nom === 'mimetype' && methode === 0 && comprime > 0 && comprime < 100) mime = propre((await v.lire(30 + nNom + nPlus, comprime)).toString('latin1'), 100);
      valide = true;
    }
    if ((drapeaux & 8 && comprime === 0) || comprime === 0xffffffff) break;
    off += 30 + nNom + nPlus + comprime; if (off > lim) break;
  }
  if (!valide) return undefined;
  // 2. La fin de l'archive : « PK 05 06 », dont la table (le répertoire) doit se trouver exactement à l'endroit qu'elle annonce.
  const FIN = Buffer.from([0x50, 0x4b, 0x05, 0x06]); let cherche = repertoire >= 0 ? repertoire : Math.min(off, lim), fin = -1, debutRep = 0, tailleRep = 0;
  while (cherche < lim && fin < 0) {
    const w = await v.lire(cherche, FEN + 32); if (w.length < 22) break;
    for (let i = 0; ;) {
      i = w.indexOf(FIN, i); if (i < 0 || i > FEN || i + 22 > w.length) break;
      const e = cherche + i; let t = w.readUInt32LE(i + 12), d = w.readUInt32LE(i + 16), avant = e;
      if (d === 0xffffffff || t === 0xffffffff || w.readUInt16LE(i + 10) === 0xffff) {
        // Très grosse archive (ZIP64) : les vraies tailles sont dans un bloc rangé juste avant.
        const loc = await v.lire(e - 20, 20); if (loc.length === 20 && loc.readUInt32LE(0) === 0x07064b50) { const z = u64le(loc, 8), r = await v.lire(z, 56); if (r.length === 56 && r.readUInt32LE(0) === 0x06064b50) { t = u64le(r, 40); d = u64le(r, 48); avant = z; } }
      }
      if (d + t === avant && (t === 0 || await u32(d) === 0x02014b50)) { fin = e + 22 + w.readUInt16LE(i + 20); debutRep = d; tailleRep = t; break; }
      i += 4;
    }
    cherche += FEN;
  }
  if (fin < 0) {
    // Pas de fin : on garde les fichiers entiers rangés au début (un outil de réparation ZIP saura les relire).
    const m: Mesure = { taille: confirme, entier: false, ext: 'zip', famille: mime ? 'documents' : 'archives', note: 'archive coupée : sa table des fichiers n\'a pas été retrouvée' };
    return confirme > 0 ? m : { ...m, taille: Math.min(lim, FEN), ouvert: true };
  }
  if (fin > max) return { taille: fin, entier: false, ext: 'zip', famille: 'archives', tropGros: true };
  // 3. Le répertoire : chaque fichier annoncé doit bien commencer là où il est dit. Les noms disent le genre de document.
  const noms: string[] = []; let juste = true, p = debutRep;
  for (let n = 0; p + 46 <= debutRep + tailleRep && n < 100000; n++) {
    const c = await v.lire(p, 46); if (c.length < 46 || c.readUInt32LE(0) !== 0x02014b50) { juste = false; break; }
    const nNom = c.readUInt16LE(28), local = c.readUInt32LE(42);
    if (noms.length < 400) noms.push((await v.lire(p + 46, Math.min(nNom, 200))).toString('latin1'));
    if (n < 200 && local !== 0xffffffff && await u32(local) !== 0x04034b50) juste = false;
    p += 46 + nNom + c.readUInt16LE(30) + c.readUInt16LE(32);
  }
  const [ext, famille] = genreZip(noms, mime);
  return { taille: fin, entier: juste, ext, famille, ...(juste ? {} : { note: 'la table des fichiers ne correspond pas au contenu : archive sans doute en plusieurs parties' }) };
}

// ---------------------------------------------------------------- anciens documents de bureau (DOC, XLS, PPT : « fichier composé »)
async function ole(v: Vue, max: number): Promise<Mesure | undefined> {
  const h = await v.lire(0, 512); if (h.length < 512 || h.readUInt16LE(28) !== 0xfffe || h.readUInt16LE(32) !== 6) return undefined;
  const decalage = h.readUInt16LE(30), version = h.readUInt16LE(26); if (!((version === 3 && decalage === 9) || (version === 4 && decalage === 12))) return undefined;
  const sect = 1 << decalage, parSect = sect / 4, nFat = h.readUInt32LE(44), dossier = h.readUInt32LE(48), nDifat = h.readUInt32LE(72);
  if (!nFat || nFat > Math.ceil(max / sect / parSect) + 2 || nDifat > 65536) return undefined;
  const pos = (s: number) => (s + 1) * sect;
  // Où sont les secteurs de la table d'allocation : 109 dans l'en-tête, la suite dans des secteurs chaînés.
  const lieux: number[] = []; for (let i = 0; i < 109 && lieux.length < nFat; i++) lieux.push(h.readUInt32LE(76 + i * 4));
  for (let s = h.readUInt32LE(68), n = 0; lieux.length < nFat && s < 0xfffffffa && n < nDifat; n++) { const d = await v.lire(pos(s), sect); if (d.length < sect) break; for (let i = 0; i < parSect - 1 && lieux.length < nFat; i++) lieux.push(d.readUInt32LE(i * 4)); s = d.readUInt32LE(sect - 4); }
  if (lieux.length < nFat) return undefined;
  // Le dernier secteur occupé donne la taille du fichier.
  let dernier = -1, lisible = true; const table: Buffer[] = [];
  for (let i = 0; i < nFat; i++) {
    if (lieux[i] >= 0xfffffffa) return undefined;
    const f = await v.lire(pos(lieux[i]), sect); if (f.length < sect) { lisible = false; break; }
    if (table.length < 256) table.push(f);
    for (let k = parSect - 1; k >= 0; k--) if (f.readUInt32LE(k * 4) !== 0xffffffff) { dernier = Math.max(dernier, i * parSect + k); break; }
  }
  const M = (taille: number, entier: boolean, ext: string, note?: string): Mesure => ({ taille, entier, ext, famille: 'documents', ...(note ? { note } : {}) });
  if (!lisible) return M(v.fin, false, 'doc', COUPE);
  if (dernier < 0) return undefined;
  const total = pos(dernier) + sect; if (total > max) return { ...M(total, false, 'doc'), tropGros: true };
  // Le dossier interne : sa première entrée s'appelle « Root Entry » ; les autres disent le genre de document.
  const suivant = (s: number) => { const t = table[Math.floor(s / parSect)]; return t ? t.readUInt32LE((s % parSect) * 4) : 0xfffffffe; };
  const noms: string[] = []; let racine = false;
  for (let s = dossier, n = 0; s < 0xfffffffa && n < 64; n++, s = suivant(s)) {
    const d = await v.lire(pos(s), sect); if (d.length < sect) break;
    for (let o = 0; o + 128 <= sect; o += 128) { const len = d.readUInt16LE(o + 64); if (len < 2 || len > 64) continue; const nom = d.subarray(o, o + len - 2).toString('utf16le'); if (n === 0 && o === 0) racine = nom === 'Root Entry' && d[o + 66] === 5; noms.push(nom); }
  }
  if (!racine) return undefined;
  const a = (re: RegExp) => noms.some((x) => re.test(x));
  const ext = a(/^WordDocument$/) ? 'doc' : a(/^(Workbook|Book)$/) ? 'xls' : a(/^PowerPoint Document$/) ? 'ppt' : a(/^__(substg1\.0_|properties_version1\.0)/) ? 'msg' : a(/^VisioDocument$/) ? 'vsd' : 'ole';
  return total > v.fin ? M(v.fin, false, ext, COUPE) : M(total, true, ext);
}

// ---------------------------------------------------------------- archives 7z, RAR, gzip
async function septz(v: Vue, max: number): Promise<Mesure | undefined> {
  const h = await v.lire(0, 32); if (h.length < 32 || crc32(h.subarray(12, 32)) !== h.readUInt32LE(8)) return undefined;
  const ou = u64le(h, 12), n = u64le(h, 20); if (!Number.isFinite(ou) || !Number.isFinite(n) || (ou === 0 && n === 0)) return undefined;
  const total = 32 + ou + n, M = (taille: number, entier: boolean, note?: string): Mesure => ({ taille, entier, ext: '7z', famille: 'archives', ...(note ? { note } : {}) });
  if (total > max) return { ...M(total, false), tropGros: true };
  if (total > v.fin) return M(v.fin, false, COUPE);
  let c = 0; for (let p = 0; p < n; p += FEN) c = crc32(await v.lire(32 + ou + p, Math.min(FEN, n - p)), c);
  return c === h.readUInt32LE(28) ? M(total, true) : M(total, false, 'la table de l\'archive ne passe pas sa somme de contrôle : archive sans doute en plusieurs parties');
}
const CHIFFREE = 'archive protégée par mot de passe (noms cachés) : sa fin ne peut pas être vérifiée';
function vint(b: Buffer, o: number): { v: number; n: number } | undefined { let v = 0; for (let i = 0; i < 10 && o + i < b.length; i++) { v += (b[o + i] & 0x7f) * 2 ** (7 * i); if (!(b[o + i] & 0x80)) return { v, n: i + 1 }; } return undefined; }
async function rar(v: Vue, max: number): Promise<Mesure | undefined> {
  const s = await v.lire(0, 8), cinq = s.length >= 8 && s[6] === 1 && s[7] === 0, M = (taille: number, entier: boolean, note?: string): Mesure => ({ taille, entier, ext: 'rar', famille: 'archives', ...(note ? { note } : {}) });
  const lim = Math.min(max, v.fin); let off = cinq ? 8 : 7, fichiers = 0, fin = false, blocs = 0;
  if (!cinq && s[6] !== 0) return undefined;
  for (; blocs < 1e6 && off < lim; blocs++) {
    if (cinq) {
      // RAR 5 : somme de contrôle, taille de l'en-tête, type, drapeaux, puis tailles facultatives des zones en plus.
      const h = await v.lire(off, 16), t = h.length >= 7 ? vint(h, 4) : undefined; if (!t || t.v < 2 || t.v > 2 * MO) break;
      const e = await v.lire(off + 4, t.n + t.v); if (e.length < t.n + t.v || crc32(e) !== h.readUInt32LE(0)) break;
      const type = vint(e, t.n); if (!type || type.v < 1 || type.v > 5) break;
      const dr = vint(e, t.n + type.n); if (!dr) break;
      let p = t.n + type.n + dr.n, donnees = 0;
      if (dr.v & 1) { const x = vint(e, p); if (!x) break; p += x.n; }
      if (dr.v & 2) { const x = vint(e, p); if (!x) break; donnees = x.v; }
      if (type.v === 4) return { ...M(off, false, CHIFFREE), ouvert: true };
      if (type.v === 2) fichiers++;
      off += 4 + t.n + t.v + donnees; if (type.v === 5) { fin = true; break; }
    } else {
      // RAR 1.5 à 4 : somme (2 octets), type, drapeaux, taille de l'en-tête, et une taille en plus si le drapeau 0x8000 est mis.
      const h = await v.lire(off, 36); if (h.length < 7) break;
      const type = h[2], dr = h.readUInt16LE(3), t = h.readUInt16LE(5); if (type < 0x72 || type > 0x7b || t < 7) break;
      const e = await v.lire(off, t); if (e.length < t) break;
      if (type === 0x73 && (crc32(e.subarray(2, Math.min(t, 13))) & 0xffff) !== e.readUInt16LE(0)) break;
      // En-têtes chiffrés (archive protégée par mot de passe, noms cachés) : on ne peut pas suivre les blocs.
      if (type === 0x73 && dr & 0x80) return { ...M(off + t, false, CHIFFREE), ouvert: true };
      let plus = dr & 0x8000 && t >= 11 ? e.readUInt32LE(7) : 0;
      if (type === 0x74) { if (t < 32) break; plus = e.readUInt32LE(7) + (dr & 0x100 && t >= 40 ? e.readUInt32LE(32) * 2 ** 32 : 0); fichiers++; }
      off += t + plus; if (type === 0x7b) { fin = true; break; }
    }
  }
  if (!fichiers && !fin) return undefined;
  if (off > max) return { ...M(off, false), tropGros: true };
  if (off > v.fin) return M(v.fin, false, COUPE);
  return fin ? M(off, true) : M(off, false, 'la marque de fin de l\'archive n\'est pas là (très vieux format RAR, ou archive coupée)');
}
/** Décompresse un flux « deflate » sans rien garder : rend le nombre d'octets lus, la somme de contrôle et la taille de ce qui en sort. */
async function degonfler(v: Vue, off: number, lim: number): Promise<{ lus: number; crc: number; sortis: number; tete: Buffer; ok: boolean }> {
  const z = createInflateRaw(); let crc = 0, sortis = 0, fini = false, erreur = false, nTete = 0; const tete: Buffer[] = [];
  z.on('data', (d: Buffer) => { crc = crc32(d, crc); sortis += d.length; if (nTete < 512) { tete.push(Buffer.from(d.subarray(0, 512 - nTete))); nTete += d.length; } });
  const fin = new Promise<void>((r) => { z.on('end', () => { fini = true; r(); }); z.on('error', () => { erreur = true; r(); }); });
  for (let p = off; p < lim && !fini && !erreur && sortis <= 64 * GO; ) {
    const b = await v.lire(p, 65536); if (!b.length) break;
    // Une copie : la fenêtre de lecture est réutilisée pendant que la décompression travaille encore. Quand le flux
    // se termine au milieu du morceau, le rappel d'écriture ne vient jamais : c'est l'événement de fin qui libère.
    await Promise.race([new Promise<void>((r) => { z.write(Buffer.from(b), () => r()); }), fin]);
    p += b.length;
  }
  // Tout a été donné sans que le flux dise « fini » : on le ferme, il dira s'il était complet.
  if (!fini && !erreur) { z.end(); await fin; }
  const lus = z.bytesWritten; z.destroy();
  return { lus, crc: crc >>> 0, sortis, tete: Buffer.concat(tete), ok: fini && !erreur };
}
async function gz(v: Vue, max: number): Promise<Mesure | undefined> {
  const lim = Math.min(max, v.fin); let off = 0, membres = 0, nom = '', tar = false;
  const M = (taille: number, entier: boolean, note?: string): Mesure => ({ taille, entier, ext: tar ? 'tar.gz' : 'gz', famille: 'archives', ...(nom ? { nom } : {}), ...(note ? { note } : {}) });
  for (; membres < 100000; membres++) {
    const h = await v.lire(off, 10); if (h.length < 10 || h[0] !== 0x1f || h[1] !== 0x8b || h[2] !== 8 || h[3] & 0xe0) break;
    let p = off + 10; const dr = h[3];
    if (dr & 4) { const x = await v.lire(p, 2); if (x.length < 2) break; p += 2 + x.readUInt16LE(0); }
    for (const bit of [8, 16]) if (dr & bit) { const x = await v.lire(p, 1024), z = x.indexOf(0); if (z < 0) return membres ? M(off, true) : undefined; if (bit === 8 && !membres) nom = propre(x.toString('latin1', 0, z), 80).replace(/[/\\:*?"<>|]/g, '_'); p += z + 1; }
    if (dr & 2) p += 2;
    const r = await degonfler(v, p, lim);
    if (!r.ok) { if (membres) break; return r.sortis >= 8192 ? M(Math.min(p + r.lus, lim), false, 'archive coupée : la décompression s\'arrête en route') : undefined; }
    const q = await v.lire(p + r.lus, 8); if (q.length < 8 || q.readUInt32LE(0) !== r.crc || q.readUInt32LE(4) !== r.sortis % 2 ** 32) { if (membres) break; return r.sortis >= 4096 ? M(p + r.lus, false, 'le contenu ne passe pas sa somme de contrôle') : undefined; }
    if (!membres) tar = r.tete.length >= 263 && txt(r.tete, 257, 5) === 'ustar';
    off = p + r.lus + 8;
  }
  return membres ? M(off, true) : undefined;
}

// ---------------------------------------------------------------- son : MP3, FLAC (WAV et M4A sont plus haut)
const DEBITS1 = [[0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]];
const DEBITS2 = [[0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]];
interface Trame { len: number; ver: number; couche: number; freq: number; mono: boolean }
/** L'en-tête d'une trame MPEG audio (4 octets) : sa longueur, ou rien s'il n'est pas valable. Pur. */
export function trameMp3(b: Buffer, o: number): Trame | undefined {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return undefined;
  const ver = (b[o + 1] >> 3) & 3, bitsCouche = (b[o + 1] >> 1) & 3, d = b[o + 2] >> 4, f = (b[o + 2] >> 2) & 3, bourrage = (b[o + 2] >> 1) & 1;
  if (ver === 1 || bitsCouche === 0 || d === 0 || d === 15 || f === 3 || (b[o + 3] & 3) === 2) return undefined;
  const couche = 4 - bitsCouche, freq = [44100, 48000, 32000][f] >> (ver === 3 ? 0 : ver === 2 ? 1 : 2), debit = (ver === 3 ? DEBITS1[couche - 1][d] : DEBITS2[couche === 1 ? 0 : 1][d]) * 1000;
  const len = couche === 1 ? (Math.floor((12 * debit) / freq) + bourrage) * 4 : Math.floor(((couche === 3 && ver !== 3 ? 72 : 144) * debit) / freq) + bourrage;
  return len >= 24 ? { len, ver, couche, freq, mono: b[o + 3] >> 6 === 3 } : undefined;
}
async function mp3(v: Vue, max: number): Promise<Mesure | undefined> {
  const lim = Math.min(max, v.fin), h = await v.lire(0, 10); let off = 0, etiquette = false;
  if (txt(h, 0, 3) === 'ID3') {
    if (h.length < 10 || h[3] < 2 || h[3] > 4 || h[4] === 0xff || h[6] & 0x80 || h[7] & 0x80 || h[8] & 0x80 || h[9] & 0x80) return undefined;
    off = 10 + ((h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9]) + (h[5] & 0x10 ? 10 : 0); etiquette = true;
  }
  const debut = off; let trames = 0, ref: Trame | undefined, annonce = 0, coupe = false;
  boucle: while (off < lim) {
    const w = await v.lire(off, 65536); let i = 0;
    while (i + 4 <= w.length) {
      const t = trameMp3(w, i); if (!t || (ref && (t.ver !== ref.ver || t.couche !== ref.couche || t.freq !== ref.freq))) { off += i; break boucle; }
      if (!ref) {
        ref = t;
        // La première trame porte souvent la taille totale du son (bloc « Xing » ou « Info ») : on s'en sert pour vérifier.
        const x = i + 4 + (t.ver === 3 ? (t.mono ? 17 : 32) : (t.mono ? 9 : 17));
        if (t.couche === 3 && x + 16 <= w.length && /^(Xing|Info)$/.test(txt(w, x, 4)) && w.readUInt32BE(x + 4) & 2) annonce = w.readUInt32BE(x + 8 + (w.readUInt32BE(x + 4) & 1 ? 4 : 0));
      }
      if (off + i + t.len > v.fin) { coupe = true; off += i; break boucle; }
      if (i + t.len > w.length) break;
      i += t.len; trames++;
    }
    if (i === 0) break; off += i;
  }
  if (trames < (etiquette ? 3 : 12)) return undefined;
  const son = off - debut;
  if ((await v.lire(off, 3)).toString('latin1') === 'TAG') off += 128;
  const M = (entier: boolean, note?: string): Mesure => ({ taille: Math.min(off, lim), entier, ext: 'mp3', famille: 'son', ...(note ? { note } : {}) });
  if (coupe || (annonce && ref && son < annonce - ref.len - 1)) return M(false, 'son coupé : il manque la fin');
  return M(true);
}
interface TrameFlac { fin: number; bloc: number; canaux: number; cote: number; bits: number }
/** L'en-tête d'une trame FLAC, vérifié par sa somme de contrôle (CRC-8). Pur. */
function enteteFlac(b: Buffer, o: number): TrameFlac | undefined {
  if (o + 6 > b.length || b[o] !== 0xff || (b[o + 1] & 0xfe) !== 0xf8) return undefined;
  const cb = b[o + 2] >> 4, cf = b[o + 2] & 15, cc = b[o + 3] >> 4, cp = (b[o + 3] >> 1) & 7;
  if (cb === 0 || cf === 15 || cc > 10 || cp === 3 || b[o + 3] & 1) return undefined;
  let p = o + 4; const x = b[p], n = x < 0x80 ? 0 : x >= 0xfe ? 6 : x >= 0xfc ? 5 : x >= 0xf8 ? 4 : x >= 0xf0 ? 3 : x >= 0xe0 ? 2 : x >= 0xc0 ? 1 : -1; if (n < 0) return undefined;
  p++; for (let k = 0; k < n; k++, p++) if (p >= b.length || (b[p] & 0xc0) !== 0x80) return undefined;
  if (p + 5 > b.length) return undefined;
  let bloc: number; if (cb === 6) { bloc = b[p] + 1; p++; } else if (cb === 7) { bloc = b.readUInt16BE(p) + 1; p += 2; } else bloc = cb === 1 ? 192 : cb <= 5 ? 576 << (cb - 2) : 256 << (cb - 8);
  p += cf === 12 ? 1 : cf === 13 || cf === 14 ? 2 : 0;
  if (p >= b.length || crc8(b, o, p) !== b[p]) return undefined;
  return { fin: p + 1, bloc, canaux: cc < 8 ? cc + 1 : 2, cote: cc === 8 || cc === 10 ? 1 : cc === 9 ? 0 : -1, bits: [0, 8, 12, 0, 16, 20, 24, 32][cp] };
}
/** Où finit exactement cette trame FLAC : on suit ses bits (sans décoder le son), puis on vérifie son CRC-16. Pur. */
function finTrameFlac(b: Buffer, o: number, e: TrameFlac, bitsInfo: number): number | undefined {
  let p = e.fin * 8; const lim = b.length * 8;
  const lire = (n: number): number => { let v = 0; for (; n > 0; ) { if (p >= lim) throw new Error('fin'); const dispo = 8 - (p & 7), k = Math.min(n, dispo); v = v * 2 ** k + ((b[p >> 3] >> (dispo - k)) & ((1 << k) - 1)); p += k; n -= k; } return v; };
  const sauter = (n: number) => { p += n; if (p > lim) throw new Error('fin'); };
  const unaire = (): number => { let n = 0; for (;;) { if (p >= lim) throw new Error('fin'); const dispo = 8 - (p & 7), x = b[p >> 3] & ((1 << dispo) - 1); if (x === 0) { n += dispo; p += dispo; continue; } const z = Math.clz32(x) - (32 - dispo); p += z + 1; return n + z; } };
  const residu = (ordre: number) => {
    const methode = lire(2); if (methode > 1) throw new Error('invalide');
    const po = lire(4), parts = 1 << po, np = methode ? 5 : 4;
    for (let i = 0; i < parts; i++) {
      const n = po === 0 ? e.bloc - ordre : i === 0 ? (e.bloc >> po) - ordre : e.bloc >> po; if (n < 0) throw new Error('invalide');
      const k = lire(np);
      if (k === (methode ? 31 : 15)) sauter(n * lire(5)); else for (let s = 0; s < n; s++) { unaire(); if (k) sauter(k); }
    }
  };
  try {
    for (let c = 0; c < e.canaux; c++) {
      let bits = (e.bits || bitsInfo) + (c === e.cote ? 1 : 0);
      if (lire(1)) return undefined;
      const type = lire(6); if (lire(1)) bits -= unaire() + 1;
      if (bits <= 0) return undefined;
      if (type === 0) sauter(bits);
      else if (type === 1) sauter(bits * e.bloc);
      else if (type >= 8 && type <= 12) { sauter((type & 7) * bits); residu(type & 7); }
      else if (type >= 32) { const ordre = (type & 31) + 1; sauter(ordre * bits); const prec = lire(4) + 1; if (prec === 16) return undefined; sauter(5 + ordre * prec); residu(ordre); }
      else return undefined;
    }
  } catch { return undefined; }
  const fin = Math.ceil(p / 8); if (fin + 2 > b.length || crc16(b, o, fin) !== b.readUInt16BE(fin)) return undefined;
  return fin + 2;
}
async function flac(v: Vue, max: number): Promise<Mesure | undefined> {
  const lim = Math.min(max, v.fin); let off = 4, info: { minTrame: number; maxTrame: number; bits: number; total: number } | undefined;
  for (let n = 0; n < 1000; n++) {
    const h = await v.lire(off, 4); if (h.length < 4) return undefined;
    const type = h[0] & 0x7f, len = h.readUIntBE(1, 3); if (type === 127 || (n === 0 && (type !== 0 || len !== 34))) return undefined;
    if (n === 0) { const s = await v.lire(off + 4, 34); if (s.length < 34) return undefined; info = { minTrame: s.readUIntBE(4, 3), maxTrame: s.readUIntBE(7, 3), bits: ((s.readUInt16BE(12) >> 4) & 31) + 1, total: (s[13] & 15) * 2 ** 32 + s.readUInt32BE(14) }; if (!(s.readUIntBE(10, 3) >> 4)) return undefined; }
    off += 4 + len; if (off > lim) return undefined; if (h[0] & 0x80) break;
  }
  if (!info) return undefined;
  const M = (taille: number, entier: boolean, note?: string): Mesure => ({ taille, entier, ext: 'flac', famille: 'son', ...(note ? { note } : {}) });
  let trames = 0, sons = 0; const petite = Math.min(4 * MO, (info.maxTrame || 49152) + 16384);
  while (off < lim) {
    let w = await v.lire(off, petite); const e = enteteFlac(w, 0); if (!e) break;
    const derniere = info.total > 0 && sons + e.bloc >= info.total;
    // La trame suivante : là où une nouvelle trame commence ET où la somme de contrôle de celle-ci tombe juste.
    let suiv = -1;
    if (!derniere) {
      const depuis = Math.max(info.minTrame, e.fin + 2); let c = crc16(w, 0, depuis - 2);
      for (let i = depuis; i + 6 <= w.length; i++) { if (w[i] === 0xff && (w[i + 1] & 0xfe) === 0xf8 && ((w[i - 2] << 8) | w[i - 1]) === c && enteteFlac(w, i)) { suiv = i; break; } c = crc16(w, i - 2, i - 1, c); }
    }
    if (suiv < 0) {
      // Dernière trame (ou trame suivie de rien) : on lit ses bits pour savoir où elle finit.
      if (w.length < 4 * MO) w = await v.lire(off, 4 * MO);
      const f = finTrameFlac(w, 0, e, info.bits); if (f === undefined) break;
      off += f; trames++; sons += e.bloc; break;
    }
    off += suiv; trames++; sons += e.bloc;
  }
  if (!trames) return undefined;
  if (off > max) return { ...M(off, false), tropGros: true };
  return info.total > 0 && sons < info.total ? M(off, false, 'son coupé : il manque la fin') : M(off, true);
}

// ---------------------------------------------------------------- la liste des formats
export interface Format { id: string; famille: Famille; /** taille maximale par défaut */ max: number; mesurer(v: Vue, max: number): Promise<Mesure | undefined> }
const F = (id: string, famille: Famille, max: number, mesurer: Format['mesurer']): Format => ({ id, famille, max, mesurer });
export const FORMATS: Record<string, Format> = {
  jpeg: F('jpeg', 'photos', 128 * MO, jpeg), png: F('png', 'photos', 256 * MO, png), gif: F('gif', 'photos', 128 * MO, gif), bmp: F('bmp', 'photos', 256 * MO, bmp),
  riff: F('riff', 'videos', 64 * GO, riff), iso: F('iso', 'videos', 64 * GO, iso), mkv: F('mkv', 'videos', 64 * GO, mkv),
  pdf: F('pdf', 'documents', GO, pdf), zip: F('zip', 'archives', 8 * GO, zip), ole: F('ole', 'documents', 512 * MO, ole),
  '7z': F('7z', 'archives', 16 * GO, septz), rar: F('rar', 'archives', 16 * GO, rar), gz: F('gz', 'archives', 8 * GO, gz),
  mp3: F('mp3', 'son', 512 * MO, mp3), flac: F('flac', 'son', 2 * GO, flac),
};
/** Ce que chaque format peut rendre comme familles (un conteneur RIFF peut être une vidéo, un son ou une photo). */
const FAMILLES_DE: Record<string, Famille[]> = { riff: ['videos', 'son', 'photos'], iso: ['videos', 'son', 'photos'], zip: ['archives', 'documents'], ole: ['documents'] };
/** Le format dont la marque est au début de ce secteur, s'il y en a un. Test très rapide, sans lecture. Pur. */
export function marque(b: Buffer, o: number): Format | undefined {
  if (o + 16 > b.length) return undefined;
  if (b[o + 4] === 0x66 && b[o + 5] === 0x74 && b[o + 6] === 0x79 && b[o + 7] === 0x70 && b[o] === 0 && b[o + 1] === 0) return FORMATS.iso;
  switch (b[o]) {
    case 0xff: if (b[o + 1] === 0xd8 && b[o + 2] === 0xff) return b[o + 3] >= 0xc0 && b[o + 3] !== 0xd8 && b[o + 3] !== 0xd9 ? FORMATS.jpeg : undefined;
      { const t = trameMp3(b, o); if (!t) return undefined; const s = o + t.len; if (s + 4 <= b.length) { const u = trameMp3(b, s); return u && u.ver === t.ver && u.couche === t.couche && u.freq === t.freq ? FORMATS.mp3 : undefined; } return FORMATS.mp3; }
    case 0x89: return b.readUInt32BE(o) === 0x89504e47 && b.readUInt32BE(o + 4) === 0x0d0a1a0a ? FORMATS.png : undefined;
    case 0x47: return b[o + 1] === 0x49 && b[o + 2] === 0x46 && b[o + 3] === 0x38 && (b[o + 4] === 0x37 || b[o + 4] === 0x39) && b[o + 5] === 0x61 ? FORMATS.gif : undefined;
    case 0x52: if (b[o + 1] === 0x49 && b[o + 2] === 0x46 && b[o + 3] === 0x46) return /^(AVI |WAVE|WEBP)$/.test(txt(b, o + 8, 4)) ? FORMATS.riff : undefined;
      return b[o + 1] === 0x61 && b[o + 2] === 0x72 && b[o + 3] === 0x21 && b[o + 4] === 0x1a && b[o + 5] === 0x07 ? FORMATS.rar : undefined;
    case 0x1a: return b[o + 1] === 0x45 && b[o + 2] === 0xdf && b[o + 3] === 0xa3 ? FORMATS.mkv : undefined;
    case 0x25: return b[o + 1] === 0x50 && b[o + 2] === 0x44 && b[o + 3] === 0x46 && b[o + 4] === 0x2d ? FORMATS.pdf : undefined;
    case 0x50: return b[o + 1] === 0x4b && b[o + 2] === 0x03 && b[o + 3] === 0x04 ? FORMATS.zip : undefined;
    case 0xd0: return b.readUInt32BE(o) === 0xd0cf11e0 && b.readUInt32BE(o + 4) === 0xa1b11ae1 ? FORMATS.ole : undefined;
    case 0x37: return b[o + 1] === 0x7a && b[o + 2] === 0xbc && b[o + 3] === 0xaf && b[o + 4] === 0x27 && b[o + 5] === 0x1c ? FORMATS['7z'] : undefined;
    case 0x1f: return b[o + 1] === 0x8b && b[o + 2] === 8 && !(b[o + 3] & 0xe0) && (b[o + 8] === 0 || b[o + 8] === 2 || b[o + 8] === 4) && (b[o + 9] <= 13 || b[o + 9] === 255) ? FORMATS.gz : undefined;
    case 0x49: return b[o + 1] === 0x44 && b[o + 2] === 0x33 && b[o + 3] >= 2 && b[o + 3] <= 4 ? FORMATS.mp3 : undefined;
    case 0x66: return b[o + 1] === 0x4c && b[o + 2] === 0x61 && b[o + 3] === 0x43 ? FORMATS.flac : undefined;
    case 0x42: return b[o + 1] === 0x4d && b.readUInt32LE(o + 6) === 0 ? FORMATS.bmp : undefined;
    default: return undefined;
  }
}
const EXT: Record<string, string> = {
  jpg: 'jpeg', jpeg: 'jpeg', jpe: 'jpeg', png: 'png', gif: 'gif', bmp: 'bmp', webp: 'riff', avi: 'riff', wav: 'riff', mp4: 'iso', m4v: 'iso', mov: 'iso', '3gp': 'iso', m4a: 'iso', heic: 'iso', heif: 'iso', avif: 'iso', cr3: 'iso',
  mkv: 'mkv', webm: 'mkv', pdf: 'pdf', zip: 'zip', docx: 'zip', xlsx: 'zip', pptx: 'zip', odt: 'zip', ods: 'zip', odp: 'zip', epub: 'zip', jar: 'zip', apk: 'zip', doc: 'ole', xls: 'ole', ppt: 'ole', msg: 'ole',
  '7z': '7z', rar: 'rar', gz: 'gz', tgz: 'gz', mp3: 'mp3', flac: 'flac',
};
/** Le format qu'annonce un nom de fichier (par son extension), si on sait le vérifier. Pur. */
export const formatDuNom = (nom: string): Format | undefined => FORMATS[EXT[(/\.([A-Za-z0-9]{1,5})$/.exec(nom)?.[1] ?? '').toLowerCase()] ?? ''];
/** Le début d'un fichier ressemble-t-il à ce que son nom annonce ? (rien : on ne sait pas vérifier ce genre de fichier). Pur. */
export function debutConforme(nom: string, tete: Buffer): boolean | undefined {
  const f = formatDuNom(nom); if (!f) return undefined;
  const t = tete.length >= 16 ? tete : Buffer.concat([tete, Buffer.alloc(16)]);
  return marque(t, 0)?.id === f.id;
}
/** La famille que les fichiers d'un nom donné rejoignent (pour les ranger), d'après leur extension. Pur. */
export function familleDuNom(nom: string): Famille | undefined {
  const e = (/\.([A-Za-z0-9]{1,5})$/.exec(nom)?.[1] ?? '').toLowerCase();
  if (/^(jpe?g|jpe|png|gif|bmp|webp|heic|heif|avif|cr[23]|nef|arw|dng|tiff?|raw|orf|rw2)$/.test(e)) return 'photos';
  if (/^(mp4|m4v|mov|avi|mkv|webm|3gp|mts|mpg|mpeg|wmv|flv)$/.test(e)) return 'videos';
  if (/^(pdf|docx?|xlsx?|pptx?|od[tsp]|rtf|txt|csv|epub|msg)$/.test(e)) return 'documents';
  if (/^(zip|7z|rar|gz|tgz|tar|bz2|xz|iso)$/.test(e)) return 'archives';
  if (/^(mp3|wav|flac|m4a|ogg|opus|aac|wma)$/.test(e)) return 'son';
  return undefined;
}

/**
 * Un fichier retrouvé par son nom (FAT, exFAT) est-il lisible ? On relit sa structure avec le format que son nom
 * annonce. « inconnu » : un genre de fichier qu'on ne sait pas vérifier (texte, tableur ancien…).
 */
export async function verifier(nom: string, l: Lecteur): Promise<{ etat: 'entier' | 'abîmé' | 'inconnu'; note?: string }> {
  const f = formatDuNom(nom); if (!f) return { etat: 'inconnu' };
  if (debutConforme(nom, await l.lire(0, 4096)) !== true) return { etat: 'abîmé', note: 'son début ne ressemble pas à ce que son nom annonce (sa place a sans doute été reprise)' };
  let m: Mesure | undefined; try { m = await f.mesurer(new Vue(l, 0), Math.max(l.taille, 1)); } catch { m = undefined; }
  if (!m) return { etat: 'abîmé', note: 'sa structure ne se lit pas' };
  return m.entier && m.taille <= l.taille ? { etat: 'entier' } : { etat: 'abîmé', note: m.note ?? 'sa structure s\'arrête en route' };
}

// ---------------------------------------------------------------- le parcours du support
export interface Trouvaille extends Mesure { /** octet où commence le fichier sur le support */ pos: number; format: string }
export interface OptionsFouille {
  /** seulement ces familles (vide : toutes) */
  familles?: Famille[];
  /** plafond pour tous les types, en octets (0 : celui de chaque type) */
  plafond?: number;
  debut?: number; fin?: number;
  /** zones déjà récupérées autrement (avec leur nom) : [début, fin), triées. On ne les reprend pas. */
  sauter?: Array<[number, number]>;
  surAvance?(pos: number): void;
  arret?: { stop: boolean };
}
/** Au plus tant d'octets pour un fichier dont la fin n'a pas été trouvée. */
const OUVERT_MAX = 64 * MO, ZEROS = Buffer.alloc(4096);
/**
 * Où s'arrête au plus tard un fichier dont la fin est incertaine : au premier secteur où commence un autre fichier
 * connu, ou au début d'une zone vide (4096 octets à zéro), ou à `jusqua`.
 */
async function borne(l: Lecteur, depuis: number, jusqua: number): Promise<number> {
  for (let p = Math.ceil(depuis / 512) * 512; p < jusqua; p += FEN) {
    const b = await l.lire(p, Math.min(FEN + 4096, jusqua - p));
    for (let o = 0; o + 16 <= b.length && o < FEN; o += 512) {
      if (marque(b, o)) return p + o;
      if (b[o] === 0 && o + 4096 <= b.length && b.compare(ZEROS, 0, 4096, o, o + 4096) === 0) return p + o;
    }
  }
  return jusqua;
}
/**
 * Parcourt le support secteur par secteur et rend chaque fichier reconnu (où il commence, sa taille, s'il est entier).
 * Rien n'est écrit : c'est à l'appelant de recopier les octets. Mémoire bornée : un bloc de 1 Mo et la fenêtre du
 * fichier en cours. La main est rendue à chaque bloc.
 */
export async function* fouiller(l: Lecteur, o: OptionsFouille = {}): AsyncGenerator<Trouvaille> {
  const veut = o.familles?.length ? new Set(o.familles) : undefined, fin = Math.min(o.fin ?? l.taille, l.taille), sauter = o.sauter ?? [];
  let pos = Math.ceil((o.debut ?? 0) / 512) * 512, zone = 0;
  while (pos < fin) {
    if (o.arret?.stop) return;
    const b = await l.lire(pos, Math.min(FEN + 16, fin - pos)); let suite = pos + Math.min(FEN, b.length);
    for (let i = 0; i + 16 <= b.length && i < FEN; i += 512) {
      const a = pos + i;
      while (zone < sauter.length && sauter[zone][1] <= a) zone++;
      if (zone < sauter.length && sauter[zone][0] <= a) { const apres = Math.ceil(sauter[zone][1] / 512) * 512; if (apres >= pos + FEN) { suite = apres; break; } i = apres - pos - 512; continue; }
      const f = marque(b, i); if (!f) continue;
      if (veut && !(FAMILLES_DE[f.id] ?? [f.famille]).some((x) => veut.has(x))) continue;
      const max = o.plafond ? Math.min(o.plafond, f.max) : f.max;
      let m: Mesure | undefined; try { m = await f.mesurer(new Vue(l, a), max); } catch { m = undefined; }
      if (!m || m.taille <= 0) continue;
      if (veut && !veut.has(m.famille)) continue;
      // Fin incertaine : le fichier s'arrête au plus tard là où commence le suivant, ou une zone vide.
      if (m.ouvert) m = { ...m, taille: Math.max(512, await borne(l, a + 512, Math.min(l.taille, a + Math.min(m.taille > FEN ? m.taille : max, OUVERT_MAX))) - a) };
      if (m.taille > fin - a) m = { ...m, taille: fin - a, entier: false, note: m.note ?? COUPE };
      yield { ...m, pos: a, format: f.id };
      if (o.arret?.stop) return;
      if (m.tropGros) continue;
      // Un fichier entier et vérifié : on reprend après lui. Abîmé, ou d'un format qu'on ne peut pas vérifier : on
      // reprend au secteur suivant, pour ne pas sauter un autre fichier qui commencerait dans la zone.
      const apres = m.entier && !m.fragile ? Math.ceil((a + m.taille) / 512) * 512 : a + 512;
      if (apres >= pos + FEN || apres >= pos + b.length) { suite = apres; break; }
      i = apres - pos - 512;
    }
    pos = suite; o.surAvance?.(Math.min(pos, fin)); await new Promise<void>((r) => setImmediate(r));
  }
}
