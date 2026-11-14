// Alchimie · les photos HEIC des téléphones (iPhone et beaucoup d'autres), lues même quand ImageMagick n'a pas de
// décodeur HEVC (paquet libheif-plugin-libde265 absent) : le conteneur HEIF (ISO/IEC 23008-12) est lu ici, les images
// HEVC qu'il contient (une seule, ou une grille de tuiles) sont rendues à ffmpeg, qui les décode et les assemble.
// Écrit d'après la norme HEIF et la norme ISO BMFF (ISO/IEC 14496-12) ; aucun code repris d'ailleurs. Pur, sauf `heicVersPng`.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Boite { type: string; debut: number; corps: number; fin: number }
/** Les boîtes ISO BMFF d'un morceau de fichier. */
function boites(b: Buffer, debut = 0, fin = b.length): Boite[] {
  const l: Boite[] = []; let i = debut;
  while (i + 8 <= fin) {
    let taille = b.readUInt32BE(i), entete = 8; const type = b.toString('latin1', i + 4, i + 8);
    if (taille === 1) { if (i + 16 > fin) break; taille = Number(b.readBigUInt64BE(i + 8)); entete = 16; } else if (taille === 0) taille = fin - i;
    if (taille < entete || i + taille > fin) break;
    l.push({ type, debut: i, corps: i + entete, fin: i + taille }); i += taille;
  }
  return l;
}
const un = (l: Boite[], t: string) => l.find((x) => x.type === t);
const lire = (b: Buffer, at: number, n: number) => (n === 0 ? 0 : n === 1 ? b[at] : n === 2 ? b.readUInt16BE(at) : n === 4 ? b.readUInt32BE(at) : Number(b.readBigUInt64BE(at)));

export interface Heif { annexB: Buffer; colonnes: number; lignes: number; largeur: number; hauteur: number; rotation: number; date?: string }
/**
 * Lit une photo HEIC : rend les images HEVC prêtes pour ffmpeg (flux « Annex B », tuile après tuile), la disposition
 * de la grille, la taille finale, la rotation à appliquer et la date de prise. Erreur claire si ce n'en est pas une. Pur.
 */
export function lireHeif(b: Buffer): Heif {
  const haut = boites(b), ftyp = un(haut, 'ftyp'), meta = un(haut, 'meta');
  if (!ftyp || !meta) throw new Error('ce fichier n\'est pas une photo HEIC lisible');
  const m = boites(b, meta.corps + 4, meta.fin);
  const pitm = un(m, 'pitm'), iinf = un(m, 'iinf'), iloc = un(m, 'iloc'), iprp = un(m, 'iprp'), iref = un(m, 'iref'), idat = un(m, 'idat');
  if (!pitm || !iinf || !iloc || !iprp) throw new Error('photo HEIC incomplète');
  const primaire = b[pitm.corps] === 0 ? b.readUInt16BE(pitm.corps + 4) : b.readUInt32BE(pitm.corps + 4);
  // Les éléments (images, Exif…) et leur type
  const types = new Map<number, string>();
  const vi = b[iinf.corps];
  for (const e of boites(b, iinf.corps + 4 + (vi === 0 ? 2 : 4), iinf.fin)) {
    if (e.type !== 'infe') continue; const v = b[e.corps];
    if (v === 2) types.set(b.readUInt16BE(e.corps + 4), b.toString('latin1', e.corps + 8, e.corps + 12));
    else if (v === 3) types.set(b.readUInt32BE(e.corps + 4), b.toString('latin1', e.corps + 10, e.corps + 14));
  }
  // Où sont les données de chaque élément
  const v = b[iloc.corps]; let p = iloc.corps + 4;
  const tOff = b[p] >> 4, tLen = b[p] & 15, tBase = b[p + 1] >> 4, tIdx = v >= 1 ? b[p + 1] & 15 : 0; p += 2;
  const n = v < 2 ? b.readUInt16BE(p) : b.readUInt32BE(p); p += v < 2 ? 2 : 4;
  const donnees = new Map<number, Buffer>();
  for (let k = 0; k < n; k++) {
    const id = v < 2 ? b.readUInt16BE(p) : b.readUInt32BE(p); p += v < 2 ? 2 : 4;
    let methode = 0; if (v >= 1) { methode = b.readUInt16BE(p) & 15; p += 2; }
    p += 2; const base = lire(b, p, tBase); p += tBase;
    const ne = b.readUInt16BE(p); p += 2; const morceaux: Buffer[] = [];
    for (let j = 0; j < ne; j++) {
      p += tIdx; const off = lire(b, p, tOff); p += tOff; const len = lire(b, p, tLen); p += tLen;
      const source = methode === 1 && idat ? b.subarray(idat.corps, idat.fin) : b, de = base + off;
      morceaux.push(source.subarray(de, len ? de + len : source.length));
    }
    donnees.set(id, Buffer.concat(morceaux));
  }
  // Les propriétés (paramètres HEVC, taille, rotation) de chaque élément
  const ipcoB = un(boites(b, iprp.corps, iprp.fin), 'ipco'), ipma = un(boites(b, iprp.corps, iprp.fin), 'ipma');
  const props = ipcoB ? boites(b, ipcoB.corps, ipcoB.fin) : [], liens = new Map<number, number[]>();
  if (ipma) {
    const vm = b[ipma.corps], large = (b.readUInt32BE(ipma.corps) & 1) === 1; let q = ipma.corps + 4; const ne = b.readUInt32BE(q); q += 4;
    for (let k = 0; k < ne; k++) {
      const id = vm < 1 ? b.readUInt16BE(q) : b.readUInt32BE(q); q += vm < 1 ? 2 : 4; const na = b[q]; q += 1; const l: number[] = [];
      for (let j = 0; j < na; j++) { l.push(large ? b.readUInt16BE(q) & 0x7fff : b[q] & 0x7f); q += large ? 2 : 1; }
      liens.set(id, l);
    }
  }
  const prop = (id: number, t: string) => (liens.get(id) ?? []).map((i) => props[i - 1]).find((x) => x?.type === t);
  // L'image principale : une seule image HEVC, ou une grille de tuiles (le plus courant sur iPhone)
  let tuiles = [primaire], colonnes = 1, lignes = 1, largeur = 0, hauteur = 0;
  if (types.get(primaire) === 'grid') {
    const g = donnees.get(primaire); if (!g || g.length < 8) throw new Error('grille HEIC illisible');
    lignes = g[2] + 1; colonnes = g[3] + 1; const grand = (g[1] & 1) === 1;
    largeur = grand ? g.readUInt32BE(4) : g.readUInt16BE(4); hauteur = grand ? g.readUInt32BE(8) : g.readUInt16BE(6);
    tuiles = [];
    if (iref) {
      const vr = b[iref.corps];
      for (const r of boites(b, iref.corps + 4, iref.fin)) {
        if (r.type !== 'dimg') continue; let q = r.corps; const de = vr === 0 ? b.readUInt16BE(q) : b.readUInt32BE(q); q += vr === 0 ? 2 : 4;
        if (de !== primaire) continue; const nb = b.readUInt16BE(q); q += 2;
        for (let j = 0; j < nb; j++) { tuiles.push(vr === 0 ? b.readUInt16BE(q) : b.readUInt32BE(q)); q += vr === 0 ? 2 : 4; }
      }
    }
    if (tuiles.length !== lignes * colonnes) throw new Error('grille HEIC incomplète');
  } else if (types.get(primaire) !== 'hvc1') throw new Error(`image ${types.get(primaire) ?? 'inconnue'} dans ce HEIC : je ne sais pas la lire`);
  const morceaux: Buffer[] = [], DEBUT = Buffer.from([0, 0, 0, 1]);
  for (const t of tuiles) {
    const c = prop(t, 'hvcC'), d = donnees.get(t); if (!c || !d) throw new Error('tuile HEIC sans ses paramètres');
    if (!largeur) { const s = prop(t, 'ispe'); if (s) { largeur = b.readUInt32BE(s.corps + 4); hauteur = b.readUInt32BE(s.corps + 8); } }
    const lg = (b[c.corps + 21] & 3) + 1; let q = c.corps + 23; const na = b[c.corps + 22];
    for (let a = 0; a < na; a++) { q += 1; const nn = b.readUInt16BE(q); q += 2; for (let j = 0; j < nn; j++) { const l = b.readUInt16BE(q); q += 2; morceaux.push(DEBUT, b.subarray(q, q + l)); q += l; } }
    for (let r = 0; r + lg <= d.length;) { const l = lire(d, r, lg); r += lg; morceaux.push(DEBUT, d.subarray(r, r + l)); r += l; }
  }
  const irot = prop(primaire, 'irot');
  // La date de prise (élément Exif) : la plus ancienne date écrite dans ses étiquettes.
  const exif = [...types].find(([, t]) => t === 'Exif')?.[0], dates = exif !== undefined ? (donnees.get(exif)?.toString('latin1').match(/\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/g) ?? []) : [];
  return { annexB: Buffer.concat(morceaux), colonnes, lignes, largeur, hauteur, rotation: irot ? (b[irot.corps] & 3) * 90 : 0, ...(dates.length ? { date: dates.sort()[0] } : {}) };
}
/** Le filtre ffmpeg qui assemble les tuiles, coupe à la taille finale et tourne l'image. Pur. */
export function filtreHeif(h: Pick<Heif, 'colonnes' | 'lignes' | 'largeur' | 'hauteur' | 'rotation'>): string {
  const f = [`tile=${h.colonnes}x${h.lignes}`, `crop=${h.largeur}:${h.hauteur}:0:0`];
  // irot : sens inverse des aiguilles d'une montre
  if (h.rotation === 90) f.push('transpose=2'); else if (h.rotation === 180) f.push('hflip,vflip'); else if (h.rotation === 270) f.push('transpose=1');
  return f.join(',');
}
type Run = (cmd: string, args: string[], o?: { timeoutMs?: number }) => Promise<{ code: number; out: string; err: string }>;
/** Décode une photo HEIC en PNG (sans perte) avec ffmpeg ; rend aussi sa date de prise. */
export async function heicVersPng(run: Run, src: string, png: string): Promise<{ date?: string }> {
  const h = lireHeif(readFileSync(src)), d = mkdtempSync(join(png, '..', '.heic-'));
  try {
    const flux = join(d, 'tuiles.hevc'); writeFileSync(flux, h.annexB);
    const r = await run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'hevc', '-i', flux, '-vf', filtreHeif(h), '-frames:v', '1', png], { timeoutMs: 120e3 });
    if (r.code !== 0) throw new Error(`photo HEIC non décodée : ${(r.err || r.out).trim().split('\n').slice(-1)[0] || `ffmpeg code ${r.code}`}`);
    return h.date ? { date: h.date } : {};
  } finally { rmSync(d, { recursive: true, force: true }); }
}
