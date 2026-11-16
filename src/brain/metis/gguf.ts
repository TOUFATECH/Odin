// Lecture d'un fichier de modèle ouvert au format GGUF — l'en-tête, les métadonnées, les fiches de tenseurs, puis les
// poids lus À LA DEMANDE (par position dans le fichier, par morceaux, mémoire bornée).
//
// LE FICHIER EST TRAITÉ COMME HOSTILE : il peut venir d'Internet. On borne tout AVANT de lire (nombre de tenseurs,
// de métadonnées, longueurs, dimensions), on vérifie que chaque position reste dans le fichier, et on ne construit
// JAMAIS un chemin ni une commande à partir de son contenu. Format : source ggml officielle, tout en petit-boutien.

import { open, stat, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { blocDe, dequantifier, octetsAttendus, nomQuant } from './dequant.ts';
import { construireDecoupage, longueurVocab } from './decoupage.ts';
import type { DecoupageGguf, HyperGguf, InfoTenseur, MetaValeur, ModeleGguf, TenseurF32 } from './types.ts';

const MAGIC = 0x46554747; // « GGUF » en petit-boutien (octets 47 47 55 46)

// Types de valeur des métadonnées (entier u32 dans le fichier).
const MV = { UINT8: 0, INT8: 1, UINT16: 2, INT16: 3, UINT32: 4, INT32: 5, FLOAT32: 6, BOOL: 7, STRING: 8, ARRAY: 9, UINT64: 10, INT64: 11, FLOAT64: 12 } as const;

// Bornes de sûreté (fichier hostile).
const MAX_TENSEURS = 1 << 20; // ~1 million de tenseurs
const MAX_KV = 1 << 20; // ~1 million de métadonnées
const MAX_CLE = 1024; // longueur d'une clé de métadonnée
const MAX_CHAINE = 64 << 20; // longueur d'une chaîne de métadonnée (64 Mio)
const MAX_TABLEAU = 1 << 24; // nombre d'éléments d'un tableau (~16 millions : couvre un gros vocabulaire)
const MAX_DIMS = 4; // nombre de dimensions d'un tenseur
const MAX_DIM = 1 << 30; // valeur maximale d'une dimension
const MAX_ENTETE = 1 << 30; // taille maximale de la zone en-tête+métadonnées+fiches (1 Gio)

/** Un curseur de lecture en avant sur le début du fichier (en-tête, métadonnées, fiches). Lit par morceaux et borne
 *  la mémoire : il ne garde que ce qu'il faut pour analyser, et refuse une zone d'en-tête démesurée. */
class Curseur {
  pos = 0;
  private buf = Buffer.alloc(0);
  private fh: FileHandle;
  private taille: number;
  constructor(fh: FileHandle, taille: number) { this.fh = fh; this.taille = taille; }

  private async charger(jusqu: number): Promise<void> {
    if (this.buf.length >= jusqu) return;
    if (jusqu > MAX_ENTETE) throw new Error('GGUF : en-tête démesuré (fichier refusé)');
    if (jusqu > this.taille) throw new Error('GGUF : fichier tronqué');
    const cible = Math.min(this.taille, Math.max(jusqu, this.buf.length + (1 << 20)));
    const tmp = Buffer.alloc(cible - this.buf.length);
    let lus = 0;
    while (lus < tmp.length) {
      const { bytesRead } = await this.fh.read(tmp, lus, tmp.length - lus, this.buf.length + lus);
      if (bytesRead === 0) break;
      lus += bytesRead;
    }
    this.buf = Buffer.concat([this.buf, tmp.subarray(0, lus)]);
    if (this.buf.length < jusqu) throw new Error('GGUF : fichier tronqué');
  }

  async u32(): Promise<number> { await this.charger(this.pos + 4); const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  async i32(): Promise<number> { await this.charger(this.pos + 4); const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  async u64(): Promise<bigint> { await this.charger(this.pos + 8); const v = this.buf.readBigUInt64LE(this.pos); this.pos += 8; return v; }
  async i64(): Promise<bigint> { await this.charger(this.pos + 8); const v = this.buf.readBigInt64LE(this.pos); this.pos += 8; return v; }
  async u8(): Promise<number> { await this.charger(this.pos + 1); return this.buf[this.pos++]; }
  async i8(): Promise<number> { await this.charger(this.pos + 1); const v = this.buf.readInt8(this.pos); this.pos += 1; return v; }
  async u16(): Promise<number> { await this.charger(this.pos + 2); const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  async i16(): Promise<number> { await this.charger(this.pos + 2); const v = this.buf.readInt16LE(this.pos); this.pos += 2; return v; }
  async f32(): Promise<number> { await this.charger(this.pos + 4); const v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; }
  async f64(): Promise<number> { await this.charger(this.pos + 8); const v = this.buf.readDoubleLE(this.pos); this.pos += 8; return v; }

  async chaine(maxLen: number): Promise<string> {
    const n = borneNombre(await this.u64(), maxLen, 'longueur de chaîne');
    await this.charger(this.pos + n);
    const s = this.buf.toString('utf8', this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
}

/** Convertit un grand entier du fichier en nombre sûr, en refusant au-delà d'une borne. */
function borneNombre(v: bigint, max: number, quoi: string): number {
  if (v < 0n || v > BigInt(max)) throw new Error(`GGUF : ${quoi} hors bornes (${v} > ${max})`);
  return Number(v);
}

/** Lit une valeur de métadonnée du type donné. Les tableaux sont bornés ; les chaînes aussi. */
async function lireValeur(c: Curseur, type: number, profondeur = 0): Promise<MetaValeur> {
  if (profondeur > 1) throw new Error('GGUF : tableau de tableaux non pris en charge');
  switch (type) {
    case MV.UINT8: return c.u8();
    case MV.INT8: return c.i8();
    case MV.UINT16: return c.u16();
    case MV.INT16: return c.i16();
    case MV.UINT32: return c.u32();
    case MV.INT32: return c.i32();
    case MV.FLOAT32: return c.f32();
    case MV.FLOAT64: return c.f64();
    case MV.BOOL: return (await c.u8()) !== 0;
    case MV.UINT64: return c.u64();
    case MV.INT64: return c.i64();
    case MV.STRING: return c.chaine(MAX_CHAINE);
    case MV.ARRAY: {
      const typeElem = await c.u32();
      const n = borneNombre(await c.u64(), MAX_TABLEAU, 'taille de tableau');
      const out: MetaValeur[] = new Array(n);
      for (let i = 0; i < n; i++) out[i] = await lireValeur(c, typeElem, profondeur + 1);
      return out;
    }
    default: throw new Error(`GGUF : type de métadonnée inconnu (${type})`);
  }
}

// Bornes de sûreté des hyper-paramètres SÉMANTIQUES (le fichier est hostile). Sans elles, un block_count ou un
// embedding_length démesuré fait allouer des tableaux géants plus loin (caches clés/valeurs, poids déquantifiés) et
// épuise la mémoire du processus AVANT tout calcul. On refuse le fichier au lieu de le laisser planter Odin.
const MAX_COUCHES = 512; // blocs de décodeur
const MAX_EMBED = 1 << 16; // dimension d'embedding (65536)
const MAX_FF = 1 << 18; // dimension du bloc dense (262144)
const MAX_TETES = 1024; // têtes d'attention

/** Dérive les hyper-paramètres des clés [arch].* (avec les valeurs par défaut publiques), en bornant chaque valeur
 *  sémantique (fichier hostile). `tenseurs` sert au recoupement : le nombre de couches ne peut pas dépasser le nombre
 *  de tenseurs réellement présents (chaque couche en apporte plusieurs). */
function derouerHyper(arch: string, meta: Record<string, MetaValeur>, nbTenseurs: number): HyperGguf {
  const num = (cle: string): number | undefined => {
    const v = meta[`${arch}.${cle}`];
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    return undefined;
  };
  const borne = (cle: string, v: number, max: number): number => {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0 || v > max) throw new Error(`GGUF : ${arch}.${cle} hors bornes (${v} ; attendu 1..${max})`);
    return v;
  };
  // Comme `borne`, mais 0 est permis (valeur « par défaut » : le moteur choisit alors head_dim).
  const borne0 = (cle: string, v: number, max: number): number => {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > max) throw new Error(`GGUF : ${arch}.${cle} hors bornes (${v} ; attendu 0..${max})`);
    return v;
  };
  const exige = (cle: string): number => { const v = num(cle); if (v === undefined) throw new Error(`GGUF : clé obligatoire manquante ${arch}.${cle}`); return v; };
  const embeddingLength = borne('embedding_length', exige('embedding_length'), MAX_EMBED);
  const headCount = borne('attention.head_count', exige('attention.head_count'), MAX_TETES);
  let blockCount = borne('block_count', exige('block_count'), MAX_COUCHES);
  if (blockCount > nbTenseurs) throw new Error(`GGUF : block_count (${blockCount}) dépasse le nombre de tenseurs présents (${nbTenseurs})`);
  const headCountKv = borne('attention.head_count_kv', num('attention.head_count_kv') ?? headCount, MAX_TETES);
  return {
    embeddingLength,
    blockCount,
    feedForwardLength: borne('feed_forward_length', exige('feed_forward_length'), MAX_FF),
    headCount,
    headCountKv,
    ropeDimensionCount: borne0('rope.dimension_count', num('rope.dimension_count') ?? Math.floor(embeddingLength / Math.max(1, headCount)), MAX_EMBED),
    ropeFreqBase: num('rope.freq_base') ?? 10000,
    rmsEps: num('attention.layer_norm_rms_epsilon') ?? 1e-5,
    contextLength: num('context_length') ?? 0,
    vocabLength: longueurVocab(meta, arch),
  };
}

/** SHA-256 du fichier entier, lu par morceaux (node:crypto). */
export async function empreinteFichier(chemin: string): Promise<string> {
  return await new Promise<string>((resolu, rejet) => {
    const h = createHash('sha256');
    const flux = createReadStream(chemin, { highWaterMark: 1 << 20 });
    flux.on('data', (d) => h.update(d));
    flux.on('error', rejet);
    flux.on('end', () => resolu(h.digest('hex')));
  });
}

/**
 * Ouvre un fichier GGUF : lit l'en-tête, les métadonnées et les fiches de tenseurs ; garde le fichier ouvert pour
 * lire les poids à la demande. Le découpage (tokeniseur) est reconstruit depuis les métadonnées.
 */
export async function lireGguf(chemin: string): Promise<ModeleGguf> {
  const info = await stat(chemin);
  const tailleOctets = info.size;
  const fh = await open(chemin, 'r');
  try {
    const c = new Curseur(fh, tailleOctets);
    const magic = await c.u32();
    if (magic !== MAGIC) throw new Error('GGUF : signature absente (ce n\'est pas un fichier GGUF)');
    const version = await c.u32();
    if (version !== 2 && version !== 3) throw new Error(`GGUF : version ${version} non prise en charge (2 ou 3 attendues)`);
    const nbTenseurs = borneNombre(await c.u64(), MAX_TENSEURS, 'nombre de tenseurs');
    const nbKv = borneNombre(await c.u64(), MAX_KV, 'nombre de métadonnées');

    // Métadonnées.
    const meta: Record<string, MetaValeur> = {};
    for (let i = 0; i < nbKv; i++) {
      const cle = await c.chaine(MAX_CLE);
      const type = await c.u32();
      meta[cle] = await lireValeur(c, type);
    }

    const arch = typeof meta['general.architecture'] === 'string' ? (meta['general.architecture'] as string) : '';
    if (!arch) throw new Error('GGUF : general.architecture manquante');

    const alignement = (() => {
      const a = meta['general.alignment'];
      const n = typeof a === 'number' ? a : typeof a === 'bigint' ? Number(a) : 32;
      if (n <= 0 || (n & (n - 1)) !== 0 || n > (1 << 16)) throw new Error(`GGUF : alignement invalide (${n})`);
      return n;
    })();

    // Fiches de tenseurs.
    const tenseurs = new Map<string, InfoTenseur>();
    for (let i = 0; i < nbTenseurs; i++) {
      const nom = await c.chaine(64); // nom ≤ 64 octets
      const nDims = await c.u32();
      if (nDims > MAX_DIMS) throw new Error(`GGUF : tenseur « ${nom} » à ${nDims} dimensions (max ${MAX_DIMS})`);
      const dims: number[] = new Array(nDims);
      let nbElem = 1;
      for (let d = 0; d < nDims; d++) { dims[d] = borneNombre(await c.u64(), MAX_DIM, `dimension de « ${nom} »`); nbElem *= dims[d]; }
      if (!Number.isSafeInteger(nbElem)) throw new Error(`GGUF : tenseur « ${nom} » trop grand`);
      const type = await c.u32();
      const offset = borneNombre(await c.u64(), Number.MAX_SAFE_INTEGER, `position de « ${nom} »`);
      if (offset % alignement !== 0) throw new Error(`GGUF : position de « ${nom} » non alignée`);
      const bloc = blocDe(type); // lève si le type est inconnu
      if (nbElem % bloc !== 0) throw new Error(`GGUF : « ${nom} » (${nbElem} éléments) incompatible avec des blocs de ${bloc}`);
      const octets = octetsAttendus(type, nbElem);
      if (tenseurs.has(nom)) throw new Error(`GGUF : tenseur « ${nom} » en double`);
      tenseurs.set(nom, { nom, dims, type, offset, octets });
    }

    // Début de la zone des données : après les fiches, aligné.
    const debutDonnees = Math.ceil(c.pos / alignement) * alignement;
    // Vérifie que chaque tenseur tient dans le fichier.
    for (const t of tenseurs.values()) {
      const fin = debutDonnees + t.offset + t.octets;
      if (fin > tailleOctets) throw new Error(`GGUF : tenseur « ${t.nom} » déborde du fichier`);
    }

    const decoupage: DecoupageGguf = construireDecoupage(meta, arch);
    const hyper = derouerHyper(arch, meta, tenseurs.size);
    const empreinte = await empreinteFichier(chemin);
    const gabaritDiscussion = typeof meta['tokenizer.chat_template'] === 'string' ? (meta['tokenizer.chat_template'] as string) : undefined;

    let ferme = false;
    const tenseur = async (nom: string): Promise<TenseurF32> => {
      if (ferme) throw new Error('GGUF : modèle déjà fermé');
      const t = tenseurs.get(nom);
      if (!t) throw new Error(`GGUF : tenseur « ${nom} » absent`);
      const buf = Buffer.alloc(t.octets);
      let lus = 0;
      const depart = debutDonnees + t.offset;
      while (lus < t.octets) {
        const { bytesRead } = await fh.read(buf, lus, t.octets - lus, depart + lus);
        if (bytesRead === 0) throw new Error(`GGUF : lecture tronquée de « ${nom} »`);
        lus += bytesRead;
      }
      const nbElem = t.dims.reduce((a, b) => a * b, 1);
      const data = dequantifier(buf, t.type, nbElem);
      return { dims: t.dims, data };
    };
    const fermer = async (): Promise<void> => { if (!ferme) { ferme = true; await fh.close(); } };

    return { arch, meta, hyper, tenseurs, decoupage, tenseur, tailleOctets, empreinte, gabaritDiscussion, fermer };
  } catch (e) {
    await fh.close();
    throw e;
  }
}

/** Nom lisible de la quantification dominante d'un modèle (le type le plus fréquent parmi ses tenseurs de poids). */
export function quantDominante(tenseurs: ReadonlyMap<string, InfoTenseur>): string {
  const compte = new Map<number, number>();
  for (const t of tenseurs.values()) compte.set(t.type, (compte.get(t.type) ?? 0) + 1);
  let meilleur = -1, n = -1;
  for (const [type, k] of compte) if (k > n) { n = k; meilleur = type; }
  return meilleur >= 0 ? nomQuant(meilleur) : '?';
}
