// Médias reçus : lecture bornée des octets. Budget (octets, éléments, profondeur, durée), source positionnelle
// (fichier lu par morceaux ou octets en mémoire), lecture d'entiers jamais hors du tampon, nettoyage du texte,
// décompression et base64 bornés. Rien n'est cru de ce que dit le fichier.

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { ArretBudget, BORNES, ErreurFormat, type Bornes, type Budget } from './contrat.ts';

// ─────────────────────────────── Budget ───────────────────────────────

export function creerBudget(o: { bornes?: Partial<Bornes>; maintenant?: () => number } = {}): Budget {
  const bornes: Bornes = { ...BORNES, ...(o.bornes ?? {}) };
  const horloge = o.maintenant ?? (() => performance.now());
  const debut = horloge();
  let lus = 0, pas = 0;
  const verifierHeure = () => { if (horloge() - debut > bornes.dureeMetaMs) throw new ArretBudget(`durée de lecture dépassée (${bornes.dureeMetaMs} ms)`); };
  return {
    bornes,
    lire(n: number) { lus += Math.max(0, n); if (lus > bornes.octetsLusMeta) throw new ArretBudget(`plus de ${enOctets(bornes.octetsLusMeta)} lus`); },
    pas() { pas++; if (pas > bornes.elements) throw new ArretBudget(`plus de ${bornes.elements} éléments visités`); if (pas === 1 || (pas & 255) === 0) verifierHeure(); },
    profondeur(d: number, max = bornes.profondeur) { if (d > max) throw new ArretBudget(`imbrication plus profonde que ${max}`); },
    restantMs() { return bornes.dureeMetaMs - (horloge() - debut); },
  };
}

// ─────────────────────────────── Sources ───────────────────────────────

export interface Source {
  readonly taille: number;
  readonly nom?: string;
  /** Lit au plus n octets à pos (moins en fin de fichier) ; compte au budget ; jamais hors du fichier. */
  lire(pos: number, n: number): Buffer;
  fermer(): void;
}

/** Un fichier lu par morceaux (jamais en entier). */
export function sourceFichier(chemin: string, budget: Budget): Source {
  const fd = openSync(chemin, 'r');
  let taille = 0;
  try { taille = fstatSync(fd).size; } catch (e) { closeSync(fd); throw e; }
  let ouvert = true;
  return {
    taille,
    nom: chemin,
    lire(pos: number, n: number) {
      if (!ouvert || !Number.isFinite(pos) || !Number.isFinite(n) || pos < 0 || n <= 0 || pos >= taille) return Buffer.alloc(0);
      const m = Math.min(Math.floor(n), taille - Math.floor(pos));
      budget.lire(m);
      const b = Buffer.allocUnsafe(m);
      let lu = 0;
      while (lu < m) { const k = readSync(fd, b, lu, m - lu, Math.floor(pos) + lu); if (k <= 0) break; lu += k; }
      return lu === m ? b : b.subarray(0, lu);
    },
    fermer() { if (ouvert) { ouvert = false; try { closeSync(fd); } catch { /* déjà fermé */ } } },
  };
}

/** Des octets en mémoire. */
export function sourceOctets(b: Uint8Array, budget: Budget, nom?: string): Source {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  return {
    taille: buf.length,
    nom,
    lire(pos: number, n: number) {
      if (!Number.isFinite(pos) || !Number.isFinite(n) || pos < 0 || n <= 0 || pos >= buf.length) return Buffer.alloc(0);
      const p = Math.floor(pos), m = Math.min(Math.floor(n), buf.length - p);
      budget.lire(m);
      return buf.subarray(p, p + m);
    },
    fermer() { /* rien */ },
  };
}

// ─────────────────────────────── Vue bornée ───────────────────────────────

/** Lecture bornée dans un tampon : toute lecture hors de [debut, fin) lève ErreurFormat. */
export class Vue {
  readonly b: Buffer;
  readonly debut: number;
  readonly fin: number;
  constructor(b: Buffer, debut = 0, fin = b.length) {
    this.b = b; this.debut = Math.max(0, debut); this.fin = Math.min(b.length, Math.max(this.debut, fin));
  }
  get taille(): number { return this.fin - this.debut; }
  ok(p: number, n: number): boolean { return Number.isInteger(p) && n >= 0 && p >= this.debut && p + n <= this.fin; }
  private v(p: number, n: number): void { if (!this.ok(p, n)) throw new ErreurFormat('lecture hors limite'); }
  u8(p: number) { this.v(p, 1); return this.b[p]; }
  u16be(p: number) { this.v(p, 2); return this.b.readUInt16BE(p); }
  u16le(p: number) { this.v(p, 2); return this.b.readUInt16LE(p); }
  u24be(p: number) { this.v(p, 3); return this.b.readUIntBE(p, 3); }
  u24le(p: number) { this.v(p, 3); return this.b.readUIntLE(p, 3); }
  u32be(p: number) { this.v(p, 4); return this.b.readUInt32BE(p); }
  u32le(p: number) { this.v(p, 4); return this.b.readUInt32LE(p); }
  i16be(p: number) { this.v(p, 2); return this.b.readInt16BE(p); }
  i16le(p: number) { this.v(p, 2); return this.b.readInt16LE(p); }
  i32be(p: number) { this.v(p, 4); return this.b.readInt32BE(p); }
  i32le(p: number) { this.v(p, 4); return this.b.readInt32LE(p); }
  f32be(p: number) { this.v(p, 4); return this.b.readFloatBE(p); }
  f32le(p: number) { this.v(p, 4); return this.b.readFloatLE(p); }
  f64be(p: number) { this.v(p, 8); return this.b.readDoubleBE(p); }
  f64le(p: number) { this.v(p, 8); return this.b.readDoubleLE(p); }
  /** Entier 64 bits : refusé au-delà de Number.MAX_SAFE_INTEGER. */
  u64be(p: number) { this.v(p, 8); return sur64(this.b.readBigUInt64BE(p)); }
  u64le(p: number) { this.v(p, 8); return sur64(this.b.readBigUInt64LE(p)); }
  big64be(p: number) { this.v(p, 8); return this.b.readBigUInt64BE(p); }
  big64le(p: number) { this.v(p, 8); return this.b.readBigUInt64LE(p); }
  fourcc(p: number) { this.v(p, 4); return this.b.toString('latin1', p, p + 4); }
  latin1(p: number, n: number) { this.v(p, n); return this.b.toString('latin1', p, p + n); }
  octets(p: number, n: number) { this.v(p, n); return this.b.subarray(p, p + n); }
  /** Entier « syncsafe » ID3 (7 bits par octet) ; undefined si un octet a son bit haut. */
  syncsafe(p: number): number | undefined {
    this.v(p, 4);
    let r = 0;
    for (let i = 0; i < 4; i++) { const o = this.b[p + i]; if (o & 0x80) return undefined; r = (r << 7) | o; }
    return r;
  }
  /** Entier de taille variable EBML : longueur 1–8 ; `inconnu` si tous les bits de valeur sont à 1. */
  vint(p: number, garderMarque = false): { valeur: number; longueur: number; inconnu: boolean; grand: boolean } {
    const premier = this.u8(p);
    if (premier === 0) throw new ErreurFormat('entier EBML invalide (octet 0x00)');
    let longueur = 1;
    while (longueur <= 8 && !(premier & (0x80 >> (longueur - 1)))) longueur++;
    this.v(p, longueur);
    let v = BigInt(garderMarque ? premier : premier & (0xff >> longueur));
    let tousUns = (premier & (0xff >> longueur)) === (0xff >> longueur);
    for (let i = 1; i < longueur; i++) { const o = this.b[p + i]; v = (v << 8n) | BigInt(o); if (o !== 0xff) tousUns = false; }
    const grand = v > BigInt(Number.MAX_SAFE_INTEGER);
    return { valeur: grand ? Number.MAX_SAFE_INTEGER : Number(v), longueur, inconnu: !garderMarque && tousUns, grand };
  }
}
export function vue(b: Buffer, debut?: number, fin?: number): Vue { return new Vue(b, debut, fin); }

function sur64(x: bigint): number {
  if (x > BigInt(Number.MAX_SAFE_INTEGER)) throw new ErreurFormat('entier 64 bits trop grand');
  return Number(x);
}

// ─────────────────────────────── Texte ───────────────────────────────

const LATIN1 = new Set(['latin1', 'iso-8859-1', 'windows-1252', 'ascii', 'us-ascii']);
let segGraphemes: Intl.Segmenter | undefined;
const graphemes = () => (segGraphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' }));

/** Coupe un texte à `max` unités (à une frontière de graphème), avec « … ». */
export function bornerGraphemes(t: string, max: number, enGraphemes = false): string {
  if (!enGraphemes && t.length <= max) return t;
  let n = 0, fin = 0, coupe = false;
  for (const g of graphemes().segment(enGraphemes ? t : t.slice(0, max + 32))) {
    const ajout = enGraphemes ? 1 : g.segment.length;
    if (n + ajout > max) { coupe = true; break; }
    n += ajout; fin = g.index + g.segment.length;
  }
  return coupe ? `${t.slice(0, fin)}…` : t;
}

/**
 * Nettoie une valeur venue d'un fichier : décodage non strict, coupure au premier NUL (si demandé), contrôles retirés
 * (sauf tabulation et saut de ligne), NFC, blancs de bord retirés, au plus 64 Kio.
 */
export function nettoyerTexte(b: Buffer | string, enc = 'utf-8', o: { nul?: boolean; max?: number } = {}): { texte: string; encodageDouteux: boolean } {
  let t: string, douteux = false;
  if (typeof b === 'string') t = b;
  else {
    const borne = b.length > 4 * (o.max ?? BORNES.texteChamp) + 16 ? b.subarray(0, 4 * (o.max ?? BORNES.texteChamp) + 16) : b;
    try { t = new TextDecoder(enc, { fatal: false }).decode(borne); } catch { t = borne.toString('latin1'); douteux = true; }
    if (LATIN1.has(enc.toLowerCase())) { for (const x of borne) if (x >= 0x80) { douteux = true; break; } }
    else if (t.includes('�')) douteux = true;
  }
  if (o.nul) { const i = t.indexOf('\0'); if (i >= 0) t = t.slice(0, i); }
  let r = '';
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 0x0d) { r += '\n'; if (t.charCodeAt(i + 1) === 0x0a) i++; continue; }
    if (c === 0x09 || c === 0x0a) { r += t[i]; continue; }
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) continue;
    r += t[i];
  }
  r = r.normalize('NFC').trim();
  return { texte: bornerGraphemes(r, o.max ?? BORNES.texteChamp), encodageDouteux: douteux };
}

/** Pour l'affichage : contrôles bidi d'enchâssement retirés (U+200E/U+200F gardés), borné, sauts de ligne en « ⏎ ». */
export function pourAffichage(t: string, max: number = BORNES.texteAffiche): string {
  let r = '';
  for (const ch of t) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) continue;
    r += ch === '\n' ? ' ⏎ ' : ch === '\t' ? ' ' : ch;
  }
  return bornerGraphemes(r, max, true);
}

/** Décodage d'un texte d'encodage inconnu : Latin-1 gardé, et jusqu'à 3 candidats qui ne produisent pas de U+FFFD. */
export function decoderLatin1Douteux(b: Buffer): { texte: string; candidats: Array<{ encodage: string; valeur: string }> } {
  const texte = nettoyerTexte(b, 'latin1').texte;
  const candidats: Array<{ encodage: string; valeur: string }> = [];
  for (const enc of ['windows-1252', 'windows-1251', 'shift_jis', 'gb18030']) {
    try {
      const v = new TextDecoder(enc, { fatal: false }).decode(b.subarray(0, 4096));
      if (!v.includes('�')) candidats.push({ encodage: enc, valeur: nettoyerTexte(v).texte });
    } catch { /* encodage inconnu de ce Node */ }
    if (candidats.length >= 3) break;
  }
  return { texte, candidats };
}

// ─────────────────────────────── Décompression, base64 ───────────────────────────────

/** zlib borné : refuse une sortie au-delà de `max` ou de 1 000 fois l'entrée (« décompression suspecte »). */
export function gonfler(b: Buffer, max: number, brut = false, rapport: number = BORNES.rapportDecompression): Buffer {
  const limite = Math.max(1, Math.min(max, b.length * rapport));
  let out: Buffer;
  try { out = brut ? inflateRawSync(b, { maxOutputLength: limite }) : inflateSync(b, { maxOutputLength: limite }); }
  catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'ERR_BUFFER_TOO_LARGE' || /too large|maxOutputLength|larger than/i.test(String((e as Error).message ?? '').slice(0, 200))) throw new ErreurFormat('décompression suspecte');
    throw new ErreurFormat('données compressées invalides');
  }
  if (out.length > b.length * rapport) throw new ErreurFormat('décompression suspecte');
  return out;
}

/** base64 borné : blancs ignorés ; refusé au-delà de max octets décodés. */
export function base64Borne(t: string, max: number): Buffer {
  let s = '';
  const borneEntree = Math.ceil((max * 4) / 3) + 8;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) continue;
    s += t[i];
    if (s.length > borneEntree) throw new ErreurFormat('base64 trop long');
  }
  return Buffer.from(s, 'base64');
}

// ─────────────────────────────── Divers ───────────────────────────────

/** « 24 Ko », « 3,1 Mo ». */
export function enOctets(n: number): string {
  if (n < 1024) return `${n} octets`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} Mo`;
  return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} Go`;
}
/** Nombre en clair avec espaces fines (« 1 204 »). */
export const enClair = (n: number): string => Math.round(n).toLocaleString('fr-FR').replace(/ | /g, ' ');
/** Nombre décimal à la française (« 2,8 »). */
export const decimal = (n: number, chiffres = 1): string => {
  const r = Math.round(n * 10 ** chiffres) / 10 ** chiffres;
  return String(r).replace('.', ',');
};
