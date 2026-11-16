// Le corpus de Noûs : tout ce qu'Odin lit et vit, découpé en morceaux (sous-mots) et rangé en TRANCHES
// scellées, une par jour et par source. Deux raisons à ce découpage :
//  - pouvoir RETIRER des exemples à l'oubli (effacer un souvenir retire ses exemples de sa tranche) ;
//  - chiffrer au repos : le corpus retient ce qu'Odin a lu, c'est donc une donnée privée (jamais en clair,
//    jamais dans le dépôt). Le scellage (coffre AES-256-GCM, exportMachineKey) est injecté : ce module ne
//    connaît ni le disque ni la clé, ce qui le rend pur et vérifiable.
//
// Contre l'empoisonnement de ce qui vient d'Internet : doublons retirés, part plafonnée par source.

import type { Sorte } from './deps.ts';

/** Un exemple rangé : ses morceaux (identifiants de sous-mots), sa sorte, sa fiabilité, et le souvenir d'où
 *  il vient (pour l'oubli). */
export interface ExempleCorpus { morceaux: Int32Array; sorte: Sorte; fiable: boolean; idSouvenir?: number }

const SORTES: Sorte[] = ['lecture', 'echange', 'maitre', 'correction', 'note'];
const codeSorte = (s: Sorte): number => Math.max(0, SORTES.indexOf(s));
const sorteDe = (c: number): Sorte => SORTES[c] ?? 'lecture';

/** Nom d'une tranche : tranche-<aaaammjj>-<source>.bin (source nettoyée pour un nom de fichier sûr). */
export function nomTranche(jour: string, source: string): string {
  const s = (source || 'inconnue').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'inconnue';
  return `tranche-${jour}-${s}.bin`;
}

/** Empreinte d'un exemple (pour retirer les doublons), sur ses morceaux. Pur, sans hasard. */
export function empreinte(m: Int32Array): string {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < m.length; i++) { h ^= m[i] & 0xff; h = Math.imul(h, 16777619); h ^= (m[i] >>> 8) & 0xff; h = Math.imul(h, 16777619); h ^= (m[i] >>> 16) & 0xff; h = Math.imul(h, 16777619); }
  return `${m.length}:${(h >>> 0).toString(36)}`;
}

/** Retire les doublons d'une liste (et ceux déjà vus si `vus` est fourni, qui est complété). */
export function dedupe(ex: ExempleCorpus[], vus: Set<string> = new Set()): ExempleCorpus[] {
  const out: ExempleCorpus[] = [];
  for (const e of ex) { const k = empreinte(e.morceaux); if (vus.has(k)) continue; vus.add(k); out.push(e); }
  return out;
}

/** Plafonne le nombre d'exemples gardés pour une source (part plafonnée contre l'empoisonnement). */
export function plafonnerParSource(ex: ExempleCorpus[], max: number, dejaDeLaSource = 0): ExempleCorpus[] {
  if (!(max > 0)) return ex;
  const reste = Math.max(0, max - dejaDeLaSource);
  return ex.slice(0, reste);
}

// ---------------------------------------------------------------------------------------------------
// Sérialisation binaire d'une tranche (avant scellage). Format simple, versionné, little-endian.

const VERSION = 1;

export function encoderTranche(ex: ExempleCorpus[]): Buffer {
  let taille = 6; // version (u16) + count (u32)
  for (const e of ex) taille += 1 + 1 + 4 + 4 + e.morceaux.length * 4;
  const b = Buffer.allocUnsafe(taille);
  let o = 0;
  b.writeUInt16LE(VERSION, o); o += 2;
  b.writeUInt32LE(ex.length, o); o += 4;
  for (const e of ex) {
    b.writeUInt8(codeSorte(e.sorte), o); o += 1;
    b.writeUInt8(e.fiable ? 1 : 0, o); o += 1;
    b.writeInt32LE(e.idSouvenir ?? -1, o); o += 4;
    b.writeUInt32LE(e.morceaux.length, o); o += 4;
    for (let i = 0; i < e.morceaux.length; i++) { b.writeInt32LE(e.morceaux[i], o); o += 4; }
  }
  return b;
}

export function decoderTranche(buf: Buffer): ExempleCorpus[] {
  if (!buf || buf.length < 6) return [];
  let o = 0;
  const version = buf.readUInt16LE(o); o += 2;
  if (version !== VERSION) return [];
  const count = buf.readUInt32LE(o); o += 4;
  const out: ExempleCorpus[] = [];
  for (let k = 0; k < count && o + 10 <= buf.length; k++) {
    const sorte = sorteDe(buf.readUInt8(o)); o += 1;
    const fiable = buf.readUInt8(o) === 1; o += 1;
    const id = buf.readInt32LE(o); o += 4;
    const n = buf.readUInt32LE(o); o += 4;
    if (o + n * 4 > buf.length) break;
    const m = new Int32Array(n);
    for (let i = 0; i < n; i++) { m[i] = buf.readInt32LE(o); o += 4; }
    out.push({ morceaux: m, sorte, fiable, idSouvenir: id < 0 ? undefined : id });
  }
  return out;
}

/** Retire d'une tranche tous les exemples d'un souvenir effacé (oubli). Rend la tranche réduite. */
export function retirerSouvenir(ex: ExempleCorpus[], idSouvenir: number): ExempleCorpus[] {
  return ex.filter((e) => e.idSouvenir !== idSouvenir);
}

// ---------------------------------------------------------------------------------------------------
// Le gestionnaire de corpus, au-dessus d'un magasin de tranches et d'un scellage, tous deux injectés.

/** Le magasin des tranches (le disque en vrai, la mémoire en essai). L'écriture est atomique côté disque. */
export interface MagasinTranches {
  lire(nom: string): Buffer | undefined;
  ecrire(nom: string, buf: Buffer): void;
  lister(): string[];
  effacer(nom: string): void;
}

/** Scellage injecté : coffre AES-256-GCM en vrai, identité en essai. */
export interface Scellage { sceller(clair: Buffer): Buffer; ouvrir(scelle: Buffer): Buffer }
const IDENTITE: Scellage = { sceller: (b) => b, ouvrir: (b) => b };

export class Corpus {
  private magasin: MagasinTranches;
  private scel: Scellage;
  constructor(magasin: MagasinTranches, scel: Scellage = IDENTITE) {
    this.magasin = magasin;
    this.scel = scel;
  }

  private charger(nom: string): ExempleCorpus[] {
    const b = this.magasin.lire(nom);
    if (!b) return [];
    try { return decoderTranche(this.scel.ouvrir(b)); } catch { return []; }
  }

  private enregistrer(nom: string, ex: ExempleCorpus[]): void {
    if (ex.length === 0) { this.magasin.effacer(nom); return; }
    this.magasin.ecrire(nom, this.scel.sceller(encoderTranche(ex)));
  }

  /** Ajoute des exemples à la tranche du jour/source, sans doublons et sous le plafond de la source. */
  ajouter(jour: string, source: string, nouveaux: ExempleCorpus[], plafondSource = 0): number {
    const nom = nomTranche(jour, source);
    const dejaTranche = this.charger(nom);
    const vus = new Set(dejaTranche.map((e) => empreinte(e.morceaux)));
    let frais = dedupe(nouveaux, vus);
    if (plafondSource > 0) frais = plafonnerParSource(frais, plafondSource, this.compterSource(source));
    if (frais.length === 0) return 0;
    this.enregistrer(nom, [...dejaTranche, ...frais]);
    return frais.length;
  }

  /** Oubli : retire d'absolument toutes les tranches les exemples d'un souvenir effacé. Rend le nombre retiré. */
  oublier(idSouvenir: number): number {
    let retires = 0;
    for (const nom of this.magasin.lister()) {
      const ex = this.charger(nom);
      const reduit = retirerSouvenir(ex, idSouvenir);
      if (reduit.length !== ex.length) { retires += ex.length - reduit.length; this.enregistrer(nom, reduit); }
    }
    return retires;
  }

  /** Nombre d'exemples en tout. */
  compter(): number {
    let n = 0;
    for (const nom of this.magasin.lister()) n += this.charger(nom).length;
    return n;
  }

  /** Nombre d'exemples déjà rangés pour une source (toutes tranches confondues). */
  compterSource(source: string): number {
    const suffixe = nomTranche('', source).replace('tranche--', '');
    let n = 0;
    for (const nom of this.magasin.lister()) if (nom.endsWith(suffixe)) n += this.charger(nom).length;
    return n;
  }
}

/** Un magasin en mémoire (pour les essais). */
export function magasinMemoire(): MagasinTranches {
  const m = new Map<string, Buffer>();
  return {
    lire: (nom) => m.get(nom),
    ecrire: (nom, buf) => { m.set(nom, Buffer.from(buf)); },
    lister: () => [...m.keys()].sort(),
    effacer: (nom) => { m.delete(nom); },
  };
}
