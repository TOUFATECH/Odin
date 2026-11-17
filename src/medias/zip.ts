// Médias reçus : ZIP et ZIP64, lus par leur répertoire central (cherché à rebours dans les 65 557 derniers octets).
// Au plus 10 000 entrées, noms de 1 024 octets au plus ; une entrée chiffrée n'est jamais lue ; seules les méthodes
// 0 (stockée) et 8 (deflate) sont décompressées, bornées. Aucun chemin n'est jamais écrit sur le disque : un nom
// comme « ../../x » est seulement listé.

import { BORNES, ErreurFormat } from './contrat.ts';
import { gonfler, nettoyerTexte, type Source } from './octets.ts';

export interface EntreeZip { nom: string; tailleCompressee: number; taille: number; methode: number; decalageLocal: number; chiffree: boolean; nomDouteux?: boolean }

export function listerZip(src: Source): { entrees: EntreeZip[]; zip64: boolean; partiel?: string; queue?: number } {
  const q0 = Math.max(0, src.taille - 65_557);
  const q = src.lire(q0, src.taille - q0);
  let e = -1;
  for (let i = q.length - 22; i >= 0; i--) if (q[i] === 0x50 && q[i + 1] === 0x4b && q[i + 2] === 5 && q[i + 3] === 6) { e = i; break; }
  if (e < 0) throw new ErreurFormat('fin de répertoire ZIP introuvable');
  const posFin = q0 + e;
  let total = q.readUInt16LE(e + 10), tailleRep = q.readUInt32LE(e + 12), decalRep = q.readUInt32LE(e + 16);
  const lc = q.readUInt16LE(e + 20);
  const fin = posFin + 22 + lc;
  const queue = fin < src.taille ? src.taille - fin : undefined;
  let zip64 = false, posRef = posFin;
  if (e >= 20 && q.readUInt32LE(e - 20) === 0x07064b50) {
    const off = q.readBigUInt64LE(e - 12);
    if (off < BigInt(src.taille)) {
      const h = src.lire(Number(off), 56);
      if (h.length === 56 && h.readUInt32LE(0) === 0x06064b50) {
        zip64 = true; posRef = Number(off);
        const t = h.readBigUInt64LE(32), ts = h.readBigUInt64LE(40), d = h.readBigUInt64LE(48);
        if (t > 0xffffffffn || ts > BigInt(src.taille) || d > BigInt(src.taille)) throw new ErreurFormat('ZIP64 : valeurs impossibles');
        total = Number(t); tailleRep = Number(ts); decalRep = Number(d);
      }
    }
  }
  // Données collées devant (archive auto-extractible) : décalage du répertoire incohérent.
  let devant = 0;
  if (decalRep + tailleRep !== posRef && decalRep + tailleRep < posRef) devant = posRef - (decalRep + tailleRep);
  if (decalRep + devant + tailleRep > src.taille) throw new ErreurFormat('répertoire ZIP hors du fichier');
  let partiel: string | undefined;
  const n = Math.min(total, BORNES.zipEntrees);
  if (total > BORNES.zipEntrees) partiel = `ZIP : ${total} entrées annoncées, ${BORNES.zipEntrees} lues au plus`;
  const lu = Math.min(tailleRep, 64 * 1024 * 1024);
  const rep = src.lire(decalRep + devant, lu);
  const entrees: EntreeZip[] = [];
  let p = 0;
  for (let i = 0; i < n; i++) {
    if (p + 46 > rep.length) { if (i < total) partiel ??= 'ZIP : répertoire central plus court qu\'annoncé'; break; }
    if (rep.readUInt32LE(p) !== 0x02014b50) { partiel ??= 'ZIP : entrée du répertoire invalide'; break; }
    const drapeaux = rep.readUInt16LE(p + 8), methode = rep.readUInt16LE(p + 10);
    let tc = rep.readUInt32LE(p + 20), t = rep.readUInt32LE(p + 24);
    const ln = rep.readUInt16LE(p + 28), lx = rep.readUInt16LE(p + 30), lk = rep.readUInt16LE(p + 32);
    let local = rep.readUInt32LE(p + 42);
    if (p + 46 + ln + lx + lk > rep.length) { partiel ??= 'ZIP : entrée tronquée'; break; }
    const brut = rep.subarray(p + 46, p + 46 + Math.min(ln, BORNES.zipNom));
    const utf8 = (drapeaux & 0x800) !== 0;
    const nom = nettoyerTexte(brut, utf8 ? 'utf-8' : 'latin1').texte;
    // Champ supplémentaire ZIP64 (0x0001).
    let x = p + 46 + ln;
    const xf = x + lx;
    while (x + 4 <= xf) {
      const id = rep.readUInt16LE(x), l = rep.readUInt16LE(x + 2);
      if (id === 1) {
        let y = x + 4;
        const lire = () => { if (y + 8 > x + 4 + l) return undefined; const v = rep.readBigUInt64LE(y); y += 8; return v > BigInt(Number.MAX_SAFE_INTEGER) ? undefined : Number(v); };
        if (t === 0xffffffff) t = lire() ?? t;
        if (tc === 0xffffffff) tc = lire() ?? tc;
        if (local === 0xffffffff) local = lire() ?? local;
      }
      x += 4 + l;
    }
    const en: EntreeZip = { nom, tailleCompressee: tc, taille: t, methode, decalageLocal: local + devant, chiffree: (drapeaux & 1) !== 0 };
    if (!utf8) { let haut = false; for (const o of brut) if (o >= 0x80) { haut = true; break; } if (haut) en.nomDouteux = true; }
    entrees.push(en);
    p += 46 + ln + lx + lk;
  }
  return { entrees, zip64, partiel, queue };
}

/** Lit une entrée (méthodes 0 et 8 seulement), bornée à `max` octets décompressés. */
export function lireEntreeZip(src: Source, e: EntreeZip, max: number): Buffer {
  if (e.chiffree) throw new ErreurFormat('entrée ZIP chiffrée : non lue');
  if (e.methode !== 0 && e.methode !== 8) throw new ErreurFormat(`méthode de compression ZIP ${e.methode} non lue`);
  const h = src.lire(e.decalageLocal, 30);
  if (h.length < 30 || h.readUInt32LE(0) !== 0x04034b50) throw new ErreurFormat('en-tête local ZIP invalide');
  const debut = e.decalageLocal + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
  const n = Math.min(e.tailleCompressee, BORNES.zipEntreeMax);
  if (debut + n > src.taille) throw new ErreurFormat('entrée ZIP hors du fichier');
  if (e.methode === 0) return src.lire(debut, Math.min(n, max));
  return gonfler(src.lire(debut, n), Math.min(max, BORNES.zipEntreeMax), true, BORNES.zipRapport);
}

export function sousTypeZip(src: Source, entrees: EntreeZip[]): 'docx' | 'xlsx' | 'pptx' | 'odt' | 'ods' | 'odp' | 'epub' | 'zip' {
  const premiere = entrees[0];
  if (premiere && premiere.nom === 'mimetype' && premiere.methode === 0 && !premiere.chiffree) {
    try {
      const m = lireEntreeZip(src, premiere, 128).toString('latin1').trim();
      if (m === 'application/epub+zip') return 'epub';
      if (m === 'application/vnd.oasis.opendocument.text') return 'odt';
      if (m === 'application/vnd.oasis.opendocument.spreadsheet') return 'ods';
      if (m === 'application/vnd.oasis.opendocument.presentation') return 'odp';
    } catch { /* mimetype illisible */ }
  }
  const noms = entrees.map((e) => e.nom);
  if (noms.includes('[Content_Types].xml')) {
    if (noms.some((n) => n.startsWith('word/'))) return 'docx';
    if (noms.some((n) => n.startsWith('xl/'))) return 'xlsx';
    if (noms.some((n) => n.startsWith('ppt/'))) return 'pptx';
  }
  if (noms.includes('META-INF/container.xml') && noms.some((n) => n.toLowerCase().endsWith('.opf'))) return 'epub';
  return 'zip';
}
