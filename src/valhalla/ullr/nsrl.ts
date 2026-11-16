// Asclépios — la liste blanche LOCALE des fichiers connus-sains (NSRL du NIST, export en masse de CIRCL
// hashlookup). Elle est consultée AVANT toute analyse en ligne : si l'empreinte d'un fichier est connue
// comme celle d'un logiciel légitime, on court-circuite MalwareBazaar et VirusTotal (on ne demande rien
// dehors) et on gagne du temps. Rien ne sort jamais : la liste est un fichier local.
//
// Pour tenir des millions d'empreintes sans un gros fichier ni une recherche lente, on range les empreintes
// dans un FILTRE DE BLOOM : un tableau de bits compact. Il répond « peut-être présent » ou « sûrement
// absent ». Le « peut-être » a un petit taux de fausse présence (réglable) : un fichier vraiment malveillant
// qui tomberait dans ce « peut-être » serait quand même analysé ensuite (la liste blanche ne fait que
// COURT-CIRCUITER un fichier sain, elle ne déclare jamais un fichier dangereux). C'est donc le bon compromis.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAGIC = 0x4e53524c;              // « NSRL » en tête du fichier de bloom
const ENTETE = 24;                     // octets d'en-tête : magie(4) m(4) k(1) n(4) construitLe(8) reserve(3)
const estSha = (h: string) => /^[a-f0-9]{64}$/i.test(h);

/** Taille conseillée (en bits) d'un filtre de Bloom pour `n` empreintes et un taux de fausse présence `p`. Pur. */
export function tailleBloom(n: number, p = 0.001): { bits: number; octets: number; k: number } {
  const nn = Math.max(1, Math.floor(n));
  const bits = Math.max(8, Math.ceil((-nn * Math.log(p)) / (Math.LN2 * Math.LN2)));
  const m = (bits + 7) & ~7;           // arrondi à l'octet
  const k = Math.max(1, Math.min(16, Math.round((m / nn) * Math.LN2)));
  return { bits: m, octets: m / 8, k };
}
/** Les `k` positions d'une empreinte dans un filtre de `m` bits (double hachage de Kirsch-Mitzenmacher). Pur. */
export function positions(sha256: string, m: number, k: number): number[] {
  const b = Buffer.from(sha256.toLowerCase(), 'hex');
  const a = b.readUInt32LE(0) >>> 0, c = (b.readUInt32LE(4) | 1) >>> 0;   // deux mots de 32 bits ; le second impair
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push((((a + Math.imul(i, c)) >>> 0) % m));
  return out;
}

/** En-tête d'un fichier de bloom : nombre de bits, de fonctions de hachage, d'empreintes, date de construction. */
export interface EnteteBloom { bits: number; k: number; n: number; construitLe: string }

/** Construit un filtre de Bloom (en-tête + bits) à partir d'empreintes SHA-256. Pur. */
export function construireBloom(hashes: Iterable<string>, now = new Date(), p = 0.001): Buffer {
  const propres = [...new Set([...hashes].map((h) => h.trim().toLowerCase()).filter(estSha))];
  const { bits: m, octets, k } = tailleBloom(propres.length, p);
  const buf = Buffer.alloc(ENTETE + octets);
  buf.writeUInt32LE(MAGIC, 0); buf.writeUInt32LE(m, 4); buf.writeUInt8(k, 8); buf.writeUInt32LE(propres.length, 9);
  buf.writeBigUInt64LE(BigInt(now.getTime()), 13);
  const corps = buf.subarray(ENTETE);
  for (const h of propres) for (const pos of positions(h, m, k)) corps[pos >> 3] |= 1 << (pos & 7);
  return buf;
}
/** Lit l'en-tête d'un fichier de bloom (sans charger les bits). Pur. Renvoie undefined si le fichier n'est pas un bloom. */
export function lireEntete(buf: Buffer): EnteteBloom | undefined {
  if (buf.length < ENTETE || buf.readUInt32LE(0) !== MAGIC) return undefined;
  return { bits: buf.readUInt32LE(4), k: buf.readUInt8(8), n: buf.readUInt32LE(9), construitLe: new Date(Number(buf.readBigUInt64LE(13))).toISOString() };
}
/** L'empreinte est-elle (peut-être) dans ce filtre de Bloom ? « false » veut dire « sûrement absente ». Pur. */
export function bloomContient(buf: Buffer, sha256: string): boolean {
  const e = lireEntete(buf); if (!e || !estSha(sha256)) return false;
  const corps = buf.subarray(ENTETE);
  for (const pos of positions(sha256, e.bits, e.k)) if (!(corps[pos >> 3] & (1 << (pos & 7)))) return false;
  return true;
}

// ---------------------------------------------------------------- Lecture des exports des sources
/** Export de CIRCL hashlookup / une liste d'empreintes : une SHA-256 par ligne (le reste de la ligne est ignoré). Pur. */
export function parseHashlookup(text: string): string[] {
  const out: string[] = [];
  for (const l of text.split('\n')) { const m = /[a-f0-9]{64}/i.exec(l); if (m && !l.trim().startsWith('#')) out.push(m[0].toLowerCase()); }
  return out;
}
/**
 * Fichier RDS du NSRL (NIST), format texte « NSRLFile.txt » : lignes CSV dont une colonne est l'empreinte.
 * On repère la colonne SHA-256 par l'en-tête ("SHA-256" ou "SHA256") ; à défaut, la première colonne qui en a
 * l'allure. Chaque empreinte trouvée est reprise (les fichiers du RDS sont tous des logiciels connus). Pur.
 */
export function parseNsrl(text: string): string[] {
  const lignes = text.split('\n'); if (!lignes.length) return [];
  const champs = (l: string) => l.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
  const tete = champs(lignes[0]); let col = tete.findIndex((c) => /^sha-?256$/i.test(c));
  const out: string[] = [], debut = col >= 0 ? 1 : 0;
  for (let i = debut; i < lignes.length; i++) {
    const l = lignes[i]; if (!l.trim()) continue;
    const c = champs(l);
    const v = col >= 0 ? c[col] : c.find((x) => estSha(x));
    if (v && estSha(v)) out.push(v.toLowerCase());
  }
  return out;
}

// ---------------------------------------------------------------- La liste blanche locale, sur le disque
/** État de la liste blanche : combien d'empreintes, quand construite, les sources chargées. */
export interface EtatBlanche { entrees: number; construitLe?: string; sources: string[]; present: boolean }

/**
 * La liste blanche locale d'une installation : un fichier de bloom dans le dossier des signatures, plus un
 * petit journal des sources chargées. `contient(sha)` est le test rapide consulté avant toute analyse.
 */
export class Blanche {
  readonly dir: string;
  private buf?: Buffer;
  private meta: { sources: string[] } = { sources: [] };
  constructor(dir: string) { this.dir = join(dir, 'liste-blanche'); mkdirSync(this.dir, { recursive: true, mode: 0o700 }); this.charger(); }

  private get fichier(): string { return join(this.dir, 'bloom.bin'); }
  private get metaFichier(): string { return join(this.dir, 'sources.json'); }

  /** (Re)charge le bloom depuis le disque. Sans fichier, la liste est simplement vide (aucune empreinte connue-saine). */
  charger(): void {
    try { this.buf = existsSync(this.fichier) ? readFileSync(this.fichier) : undefined; if (this.buf && !lireEntete(this.buf)) this.buf = undefined; } catch { this.buf = undefined; }
    try { this.meta = existsSync(this.metaFichier) ? JSON.parse(readFileSync(this.metaFichier, 'utf8')) : { sources: [] }; } catch { this.meta = { sources: [] }; }
  }
  /** L'empreinte est-elle connue comme saine ? « true » = on court-circuite l'analyse en ligne. */
  contient(sha256: string): boolean { return Boolean(this.buf) && bloomContient(this.buf!, sha256); }
  /** En-tête de la liste chargée (bits, empreintes, date), ou undefined si vide. */
  entete(): EnteteBloom | undefined { return this.buf ? lireEntete(this.buf) : undefined; }
  /** Ce que la page « Sources » affiche : nombre d'entrées, date, sources, présence. */
  etat(): EtatBlanche { const e = this.entete(); return { entrees: e?.n ?? 0, construitLe: e?.construitLe, sources: [...this.meta.sources], present: Boolean(this.buf) }; }

  /**
   * Remplace la liste par un nouveau bloom construit à partir de ces empreintes (écriture atomique : fichier
   * temporaire puis renommage, pour ne jamais laisser une liste à moitié écrite). `source` est noté pour l'état.
   */
  remplacer(hashes: Iterable<string>, source: string, now = new Date(), p = 0.001): EtatBlanche {
    const buf = construireBloom(hashes, now, p), tmp = `${this.fichier}.tmp`;
    writeFileSync(tmp, buf, { mode: 0o600 }); renameSync(tmp, this.fichier);
    this.meta = { sources: [...new Set([source, ...this.meta.sources])].slice(0, 20) };
    writeFileSync(this.metaFichier, JSON.stringify(this.meta), { mode: 0o600 });
    this.buf = buf;
    return this.etat();
  }
}
