// Lecteur de poids ouverts au format « safetensors » — maison, aucune dépendance. Format public : 8 octets de longueur
// d'en-tête (entier 64 bits PETIT-BOUTIEN), puis un en-tête JSON décrivant chaque tenseur (type, forme, intervalle
// d'octets), puis les octets bruts des tenseurs, bout à bout.
//
// LE FICHIER PEUT VENIR D'INTERNET : on borne la longueur d'en-tête et chaque intervalle AVANT de lire, on vérifie que
// tout reste dans le fichier, on refuse un fichier dont l'empreinte SHA-256 ne correspond pas à celle attendue. À côté
// du poids, on écrit <nom>.licence.txt (empreinte, licence SPDX, source) : la provenance reste notée.
//
// Attention aux boutiens : les octets PNG/JPEG sont GROS-boutiens, mais safetensors est PETIT-boutien. On lit donc les
// flottants en petit-boutien, et on convertit F16/BF16 → F32 à la main.

import { readFile, writeFile, stat } from 'node:fs/promises';
import { empreinteFichier } from '../brain/metis/gguf.ts';

/** Longueur maximale de l'en-tête JSON acceptée (64 Mo) : au-delà, le fichier est refusé avant toute lecture. */
const MAX_ENTETE = 64 * 1024 * 1024;
/** Taille maximale du fichier de poids accepté par ce lecteur (3 Go). La décision fine « tient en mémoire » revient à
 *  l'appelant (peutCharger de mesure.ts) ; ici on borne seulement pour ne jamais allouer l'inimaginable. */
const MAX_FICHIER = 3 * 1024 * 1024 * 1024;

/** Un tenseur lu : ses dimensions et ses valeurs en flottants 32 bits. */
export interface TenseurVision {
  dims: number[];
  data: Float32Array;
}

/** Un jeu de poids ouvert, chargé. */
export interface Poids {
  /** Métadonnées libres (__metadata__ de l'en-tête) : y vivent la configuration du modèle, moy/ec, etc. */
  readonly meta: Record<string, string>;
  /** Empreinte SHA-256 du fichier. */
  readonly empreinte: string;
  /** Vrai si le tenseur existe. */
  a(nom: string): boolean;
  /** Noms des tenseurs présents. */
  noms(): string[];
  /** Le tenseur demandé, en flottants 32 bits (lève si absent). */
  tenseur(nom: string): TenseurVision;
  /** Lecture d'une métadonnée nombre (ou défaut). */
  nombre(cle: string, defaut: number): number;
}

interface FicheTenseur { dtype: string; shape: number[]; debut: number; fin: number }

/** F16 (demi-précision) → F32, à la main (biais d'exposant 15). */
function f16ToF32(h: number): number {
  const signe = (h & 0x8000) ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return signe * frac * Math.pow(2, -24); // dénormalisé
  if (exp === 0x1f) return frac ? NaN : signe * Infinity;
  return signe * (1 + frac / 1024) * Math.pow(2, exp - 15);
}

/** BF16 → F32 : les 16 bits de BF16 sont les 16 bits de poids fort d'un F32. */
function bf16ToF32(h: number): number {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, h << 16, true);
  return new DataView(buf).getFloat32(0, true);
}

/** Convertit les octets bruts d'un tenseur en Float32Array selon son type. Octets PETIT-boutiens. */
function versF32(dtype: string, octets: Buffer, nbElem: number): Float32Array {
  const out = new Float32Array(nbElem);
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  switch (dtype) {
    case 'F32':
      if (octets.length < nbElem * 4) throw new Error('safetensors : tenseur F32 tronqué');
      for (let i = 0; i < nbElem; i++) out[i] = dv.getFloat32(i * 4, true);
      return out;
    case 'F16':
      if (octets.length < nbElem * 2) throw new Error('safetensors : tenseur F16 tronqué');
      for (let i = 0; i < nbElem; i++) out[i] = f16ToF32(dv.getUint16(i * 2, true));
      return out;
    case 'BF16':
      if (octets.length < nbElem * 2) throw new Error('safetensors : tenseur BF16 tronqué');
      for (let i = 0; i < nbElem; i++) out[i] = bf16ToF32(dv.getUint16(i * 2, true));
      return out;
    case 'F64':
      if (octets.length < nbElem * 8) throw new Error('safetensors : tenseur F64 tronqué');
      for (let i = 0; i < nbElem; i++) out[i] = dv.getFloat64(i * 8, true);
      return out;
    case 'I8': case 'U8':
      if (octets.length < nbElem) throw new Error('safetensors : tenseur 8 bits tronqué');
      for (let i = 0; i < nbElem; i++) out[i] = dtype === 'I8' ? (octets[i] << 24 >> 24) : octets[i];
      return out;
    default:
      throw new Error(`safetensors : type « ${dtype} » non pris en charge`);
  }
}

/** Nombre d'octets d'un élément selon le type. */
function tailleType(dtype: string): number {
  switch (dtype) {
    case 'F64': return 8;
    case 'F32': case 'I32': case 'U32': return 4;
    case 'F16': case 'BF16': case 'I16': case 'U16': return 2;
    case 'I8': case 'U8': case 'BOOL': return 1;
    default: throw new Error(`safetensors : type « ${dtype} » inconnu`);
  }
}

/** Charge un fichier de poids safetensors. Vérifie l'empreinte si `attendu.sha256` est donné ; écrit la fiche de
 *  licence à côté si `attendu.licence` est donné. Lève sur fichier malformé ou empreinte non conforme. */
export async function lirePoids(
  chemin: string,
  attendu?: { sha256?: string; licence?: string; source?: string },
): Promise<Poids> {
  const info = await stat(chemin);
  if (info.size < 8) throw new Error('safetensors : fichier trop court');
  if (info.size > MAX_FICHIER) throw new Error('safetensors : fichier démesuré (refusé)');
  const buf = await readFile(chemin);

  const lenEntete = Number(buf.readBigUInt64LE(0));
  if (!Number.isSafeInteger(lenEntete) || lenEntete <= 0) throw new Error('safetensors : longueur d\'en-tête invalide');
  if (lenEntete > MAX_ENTETE) throw new Error('safetensors : en-tête démesuré (refusé)');
  if (8 + lenEntete > buf.length) throw new Error('safetensors : en-tête tronqué');

  let entete: Record<string, unknown>;
  try {
    entete = JSON.parse(buf.toString('utf8', 8, 8 + lenEntete)) as Record<string, unknown>;
  } catch {
    throw new Error('safetensors : en-tête JSON illisible');
  }
  const debutDonnees = 8 + lenEntete;

  const meta: Record<string, string> = {};
  const brutMeta = entete['__metadata__'];
  if (brutMeta && typeof brutMeta === 'object') {
    for (const [k, v] of Object.entries(brutMeta as Record<string, unknown>)) if (typeof v === 'string') meta[k] = v;
  }

  const fiches = new Map<string, FicheTenseur>();
  for (const [nom, val] of Object.entries(entete)) {
    if (nom === '__metadata__') continue;
    if (!val || typeof val !== 'object') throw new Error(`safetensors : fiche de « ${nom} » invalide`);
    const f = val as Record<string, unknown>;
    const dtype = String(f['dtype'] ?? '');
    const shape = Array.isArray(f['shape']) ? (f['shape'] as unknown[]).map((d) => Number(d)) : [];
    const inter = f['data_offsets'];
    if (!Array.isArray(inter) || inter.length !== 2) throw new Error(`safetensors : « ${nom} » sans intervalle d'octets`);
    const debut = Number(inter[0]), fin = Number(inter[1]);
    if (!Number.isSafeInteger(debut) || !Number.isSafeInteger(fin) || debut < 0 || fin < debut) throw new Error(`safetensors : intervalle de « ${nom} » invalide`);
    if (debutDonnees + fin > buf.length) throw new Error(`safetensors : « ${nom} » déborde du fichier`);
    for (const d of shape) if (!Number.isInteger(d) || d < 0 || d > (1 << 30)) throw new Error(`safetensors : forme de « ${nom} » hors bornes`);
    fiches.set(nom, { dtype, shape, debut, fin });
  }

  const empreinte = await empreinteFichier(chemin);
  if (attendu?.sha256 && attendu.sha256.toLowerCase() !== empreinte.toLowerCase()) {
    throw new Error('safetensors : empreinte non conforme (fichier refusé)');
  }
  if (attendu?.licence) {
    const base = chemin.endsWith('.safetensors') ? chemin.slice(0, -'.safetensors'.length) : chemin;
    const texte = `sha256=${empreinte} ; licence=${attendu.licence} ; source=${attendu.source ?? '?'}\n`;
    try { await writeFile(`${base}.licence.txt`, texte, { encoding: 'utf8', mode: 0o600 }); } catch { /* note de provenance non bloquante */ }
  }

  const cache = new Map<string, TenseurVision>();
  const tenseur = (nom: string): TenseurVision => {
    const dejaLa = cache.get(nom);
    if (dejaLa) return dejaLa;
    const f = fiches.get(nom);
    if (!f) throw new Error(`safetensors : tenseur « ${nom} » absent`);
    let nbElem = 1;
    for (const d of f.shape) nbElem *= d;
    if (!Number.isSafeInteger(nbElem)) throw new Error(`safetensors : « ${nom} » trop grand`);
    const octetsVoulus = nbElem * tailleType(f.dtype);
    if (f.fin - f.debut < octetsVoulus) throw new Error(`safetensors : « ${nom} » : octets insuffisants`);
    const octets = buf.subarray(debutDonnees + f.debut, debutDonnees + f.debut + octetsVoulus);
    const t: TenseurVision = { dims: f.shape.slice(), data: versF32(f.dtype, Buffer.from(octets), nbElem) };
    cache.set(nom, t);
    return t;
  };

  return {
    meta,
    empreinte,
    a: (nom) => fiches.has(nom),
    noms: () => [...fiches.keys()],
    tenseur,
    nombre: (cle, defaut) => { const v = Number(meta[cle]); return Number.isFinite(v) ? v : defaut; },
  };
}
