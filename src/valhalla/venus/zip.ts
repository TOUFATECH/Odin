// Odyssée · lecture d'une archive ZIP (EPUB, CBZ) en Node pur : le répertoire central d'abord, puis chaque
// fichier à la demande (stocké tel quel, ou « deflate » décompressé par zlib). Rien d'installé.
// Garde-fous : taille maximale décompressée par fichier, nombre de fichiers, noms qui sortent de l'archive refusés.

import { inflateRawSync } from 'node:zlib';

export interface EntreeZip { nom: string; methode: number; taille: number; tailleCompressee: number; decalage: number }
/** Une archive ouverte : la liste de ses fichiers et la lecture de l'un d'eux. */
export interface Zip { entrees: EntreeZip[]; lire(nom: string): Buffer | undefined; a(nom: string): boolean }

const MAX_FICHIER = 64 * 1024 * 1024, MAX_ENTREES = 20_000;

/** Ouvre une archive ZIP en mémoire. Lève une erreur claire si ce n'en est pas une. */
export function ouvrirZip(b: Buffer): Zip {
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin (commentaire de 64 Ko au plus).
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) if (b.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error('ce fichier n\'est pas une archive ZIP (EPUB ou CBZ) lisible');
  const n = b.readUInt16LE(fin + 10), debut = b.readUInt32LE(fin + 16);
  if (n > MAX_ENTREES) throw new Error('archive trop grande (trop de fichiers)');
  const entrees: EntreeZip[] = [];
  let p = debut;
  for (let k = 0; k < n; k++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new Error('répertoire de l\'archive abîmé');
    const methode = b.readUInt16LE(p + 10), tailleCompressee = b.readUInt32LE(p + 20), taille = b.readUInt32LE(p + 24);
    const ln = b.readUInt16LE(p + 28), lx = b.readUInt16LE(p + 30), lc = b.readUInt16LE(p + 32), decalage = b.readUInt32LE(p + 42);
    const nom = b.subarray(p + 46, p + 46 + ln).toString('utf8');
    p += 46 + ln + lx + lc;
    // Un nom qui remonte (« ../ ») ou absolu n'a rien à faire dans un livre : ignoré.
    if (!nom || nom.endsWith('/') || /(^|\/)\.\.(\/|$)/.test(nom) || /^([a-z]:)?[\\/]/i.test(nom)) continue;
    entrees.push({ nom, methode, taille, tailleCompressee, decalage });
  }
  const parNom = new Map(entrees.map((e) => [e.nom, e]));
  return {
    entrees,
    a: (nom) => parNom.has(nom),
    lire(nom) {
      const e = parNom.get(nom); if (!e) return undefined;
      if (e.taille > MAX_FICHIER) throw new Error(`fichier trop gros dans l'archive : ${nom}`);
      const h = e.decalage; if (b.readUInt32LE(h) !== 0x04034b50) throw new Error(`fichier abîmé dans l'archive : ${nom}`);
      const d = h + 30 + b.readUInt16LE(h + 26) + b.readUInt16LE(h + 28), brut = b.subarray(d, d + e.tailleCompressee);
      if (e.methode === 0) return Buffer.from(brut);
      if (e.methode === 8) return inflateRawSync(brut, { maxOutputLength: MAX_FICHIER });
      throw new Error(`compression non prise en charge (${e.methode}) : ${nom}`);
    },
  };
}
