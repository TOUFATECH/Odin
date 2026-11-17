// Le corpus de Noûs : tout ce qu'Odin lit et vit, découpé en morceaux (sous-mots) et rangé en TRANCHES
// scellées, une par jour et par source. Deux raisons à ce découpage :
//  - pouvoir RETIRER des exemples à l'oubli (effacer un souvenir retire ses exemples de sa tranche) ;
//  - chiffrer au repos : le corpus retient ce qu'Odin a lu, c'est donc une donnée privée (jamais en clair,
//    jamais dans le dépôt). Le scellage (coffre AES-256-GCM, exportMachineKey) est injecté : ce module ne
//    connaît ni le disque ni la clé, ce qui le rend pur et vérifiable.
//
// Contre l'empoisonnement de ce qui vient d'Internet : doublons retirés, part plafonnée par source.

import { deflateRawSync, inflateRawSync } from 'node:zlib';
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
  /** (facultatif) ajoute à la FIN du fichier sans le réécrire : la tranche devient une suite d'enregistrements. */
  ajouterFin?(nom: string, buf: Buffer): void;
}

// ---------------------------------------------------------------------------------------------------
// Tranche « en enregistrements » : MAGIE puis, pour chaque ajout, [u32 longueur][scellé(compressé(tranche))].
// Un ajout n'écrit que ses nouveaux exemples (jamais la tranche entière) ; chaque enregistrement est scellé à part
// et compressé (les morceaux tiennent sur 4 octets mais sont surtout petits : la compression les ramène à peu).
// L'ancien format (un seul bloc scellé) reste lu.
const MAGIE = Buffer.from('ODR1', 'latin1');
/** Un enregistrement scellé, prêt à être ajouté. */
export function enregistrement(ex: ExempleCorpus[], scel: Scellage): Buffer {
  const corps = scel.sceller(deflateRawSync(encoderTranche(ex), { level: 6 }));
  const l = Buffer.alloc(4); l.writeUInt32LE(corps.length, 0);
  return Buffer.concat([l, corps]);
}
/** Lit une tranche, ancien ou nouveau format. Un enregistrement abîmé est sauté (les autres restent lus). */
export function lireTranche(buf: Buffer | undefined, scel: Scellage): ExempleCorpus[] {
  if (!buf || !buf.length) return [];
  if (buf.length < 4 || !buf.subarray(0, 4).equals(MAGIE)) { try { return decoderTranche(scel.ouvrir(buf)); } catch { return []; } }
  const out: ExempleCorpus[] = [];
  let o = 4;
  while (o + 4 <= buf.length) {
    const n = buf.readUInt32LE(o); o += 4;
    if (o + n > buf.length) break; // fin tronquée (arrêt pendant une écriture) : on garde ce qui précède
    try { for (const e of decoderTranche(inflateRawSync(scel.ouvrir(buf.subarray(o, o + n)), { maxOutputLength: 256 * 1024 * 1024 }))) out.push(e); } catch { /* enregistrement abîmé */ }
    o += n;
  }
  return out;
}

/**
 * La fin du dernier enregistrement COMPLET d'une tranche en enregistrements (après la MAGIE), ou `buf.length` si tout est
 * complet. Une fin tronquée (arrêt pendant une écriture) est ainsi repérée : on la coupe AVANT d'ajouter, sinon les
 * ajouts suivants seraient collés derrière elle et ne seraient jamais relus. Pur.
 */
export function finComplete(buf: Buffer): number {
  if (buf.length < 4 || !buf.subarray(0, 4).equals(MAGIE)) return buf.length;
  let o = 4;
  while (o + 4 <= buf.length) {
    const n = buf.readUInt32LE(o);
    if (o + 4 + n > buf.length) return o;
    o += 4 + n;
  }
  return o;
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

  // Ce qu'on sait déjà sans relire le disque : les empreintes de chaque tranche et le compte de chaque source.
  // (Valable tant que ce Corpus est le seul à écrire dans son magasin : c'est le cas du lecteur de la file.)
  private empreintes = new Map<string, Set<string>>();
  private comptes = new Map<string, number>();

  private charger(nom: string): ExempleCorpus[] {
    return lireTranche(this.magasin.lire(nom), this.scel);
  }

  private enregistrer(nom: string, ex: ExempleCorpus[]): void {
    this.empreintes.delete(nom); this.comptes.clear();
    if (ex.length === 0) { this.magasin.effacer(nom); return; }
    if (this.magasin.ajouterFin) { this.magasin.ecrire(nom, Buffer.concat([MAGIE, enregistrement(ex, this.scel)])); return; }
    this.magasin.ecrire(nom, this.scel.sceller(encoderTranche(ex)));
  }

  /** Ajoute des exemples à la tranche du jour/source, sans doublons et sous le plafond de la source.
   *  Avec un magasin qui sait ajouter à la fin, seuls les nouveaux exemples sont écrits. */
  ajouter(jour: string, source: string, nouveaux: ExempleCorpus[], plafondSource = 0): number {
    const nom = nomTranche(jour, source);
    if (!this.magasin.ajouterFin) {
      const dejaTranche = this.charger(nom);
      const vus = new Set(dejaTranche.map((e) => empreinte(e.morceaux)));
      let frais = dedupe(nouveaux, vus);
      if (plafondSource > 0) frais = plafonnerParSource(frais, plafondSource, this.compterSource(source));
      if (frais.length === 0) return 0;
      this.enregistrer(nom, [...dejaTranche, ...frais]);
      return frais.length;
    }
    let vus = this.empreintes.get(nom);
    if (!vus) { vus = new Set(this.charger(nom).map((e) => empreinte(e.morceaux))); this.empreintes.set(nom, vus); }
    let frais = dedupe(nouveaux, new Set(vus));
    if (plafondSource > 0) frais = plafonnerParSource(frais, plafondSource, this.compterSource(source));
    if (frais.length === 0) return 0;
    let existe = this.magasin.lire(nom);
    // Une fin tronquée (arrêt pendant un ajout) est coupée d'abord : les ajouts suivants restent lisibles.
    if (existe && existe.length >= 4 && existe.subarray(0, 4).equals(MAGIE)) {
      const fin = finComplete(existe);
      if (fin < existe.length) { existe = existe.subarray(0, fin); this.magasin.ecrire(nom, existe); }
    }
    if (existe && existe.length && !existe.subarray(0, 4).equals(MAGIE)) {
      // ancienne tranche d'un seul bloc : convertie une fois en enregistrements
      this.enregistrer(nom, [...this.charger(nom), ...frais]);
    } else {
      this.magasin.ajouterFin(nom, existe && existe.length ? enregistrement(frais, this.scel) : Buffer.concat([MAGIE, enregistrement(frais, this.scel)]));
    }
    const s2 = this.empreintes.get(nom) ?? vus; for (const e of frais) s2.add(empreinte(e.morceaux)); this.empreintes.set(nom, s2);
    const suffixe = nomTranche('', source).replace('tranche--', '');
    if (this.comptes.has(suffixe)) this.comptes.set(suffixe, (this.comptes.get(suffixe) ?? 0) + frais.length);
    return frais.length;
  }

  /** Tous les exemples d'une tranche (lecture seule). */
  lireTranche(nom: string): ExempleCorpus[] { return this.charger(nom); }

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

  /**
   * Oubli général : chaque tranche est relue UNE fois ; un exemple pour lequel `transformer` rend `undefined` est retiré,
   * un exemple qu'il rend changé est remplacé (une ligne oubliée retirée d'un texte qui en avait plusieurs). Rend le
   * nombre d'exemples retirés ou changés.
   */
  oublierSi(transformer: (e: ExempleCorpus) => ExempleCorpus | undefined): number {
    let touches = 0;
    for (const nom of this.magasin.lister()) {
      const ex = this.charger(nom);
      const apres: ExempleCorpus[] = [];
      let ici = 0;
      for (const e of ex) { const t = transformer(e); if (t !== e) ici++; if (t) apres.push(t); }
      if (ici) { touches += ici; this.enregistrer(nom, apres); }
    }
    return touches;
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
    const c = this.comptes.get(suffixe);
    if (c !== undefined) return c;
    let n = 0;
    for (const nom of this.magasin.lister()) if (nom.endsWith(suffixe)) n += this.charger(nom).length;
    this.comptes.set(suffixe, n);
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
