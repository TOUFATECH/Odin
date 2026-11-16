// Passe avant d'un décodeur Transformer (la famille la plus courante : llama/mistral/qwen2/qwen3/phi3/gemma).
//
// Entrée : un ModeleGguf ouvert (contrat du lot A). Sortie : les logits du prochain morceau. On réutilise les noyaux
// de calcul de Noûs (src/brain/nous/wasm.ts) — produit de matrices écrit à la main en WebAssembly — SANS les refaire.
//
// Nuance de disposition : un noyau mm(c,a,b,M,K,N) calcule C = A·B avec B rangé [K,N]. Un fichier GGUF range un poids
// de projection comme [K(entrée contiguë), N(sortie)] mais utilisé en x·Wᵀ (la ligne « sortie » est contiguë). On
// TRANSPOSE donc la disposition du poids UNE fois à son chargement (on ne recopie jamais le noyau) et on garde la
// version transposée. La mémoire reste bornée : chaque poids n'est gardé qu'en une copie flottante.
//
// Choix figés par TABLE (jamais devinés) :
//   - position tournante (RoPE) : « entrelacée » (paires voisines) pour llama/mistral ; « par moitiés » (NeoX) pour
//     qwen2/qwen3/phi3/gemma. Une famille inconnue est REFUSÉE, pas devinée.
//   - poids liés : si output.weight est absent, la tête réutilise token_embd.weight.
//   - têtes K/V : headCountKv vaut headCount s'il est absent (pas de GQA).

import { freemem } from 'node:os';
import type { ModeleGguf } from './types.ts';
import { noyaux, type Noyaux } from '../nous/wasm.ts';
import { memoireNecessaireOctets } from './mesure.ts';

/** Deux familles de position tournante. */
export type ModeRope = 'entrelacee' | 'moities';

/** Table figée famille → position tournante. Rien n'est deviné. */
const ROPE_PAR_ARCH: Record<string, ModeRope> = {
  llama: 'entrelacee',
  mistral: 'entrelacee',
  qwen2: 'moities',
  qwen3: 'moities',
  phi3: 'moities',
  gemma: 'moities',
  gemma2: 'moities',
};

/** La position tournante de cette famille, ou une erreur claire si elle n'est pas connue. */
export function modeRope(arch: string): ModeRope {
  const m = ROPE_PAR_ARCH[arch];
  if (!m) throw new Error(`Métis : la famille « ${arch} » n'est pas connue, la position tournante ne peut pas être devinée. Ajoute-la à la table d'abord.`);
  return m;
}

/** Un poids de projection, transposé en disposition [K,N] pour le noyau mm, avec ses dimensions. */
interface Poids { readonly t: Float32Array; readonly K: number; readonly N: number }

/** L'état de calcul d'un modèle : config dérivée, noyaux, caches des poids, mémoire des clés/valeurs. */
export interface EtatMetis {
  readonly modele: ModeleGguf;
  readonly C: number; // longueur d'embedding
  readonly L: number; // nombre de couches
  readonly nTete: number; // têtes de requête (Q)
  readonly nTeteKv: number; // têtes de clé/valeur (K/V)
  readonly hd: number; // dimension d'une tête
  readonly nRot: number; // dimensions tournantes (RoPE)
  readonly baseRope: number;
  readonly eps: number;
  readonly V: number; // taille du vocabulaire
  readonly ff: number; // dimension cachée du bloc dense
  readonly rope: ModeRope;
  readonly noy: Noyaux;
  readonly Tmax: number; // positions mémorisables
  readonly kvDim: number; // nTeteKv * hd
  readonly wte: Float32Array; // table d'embedding brute (lecture directe par ligne)
  readonly poidsT: Map<string, Poids>; // poids de projection transposés, en cache
  readonly normes: Map<string, Float32Array>; // poids de normalisation (1D, bruts)
  readonly Kc: Float32Array[]; // mémoire des clés par couche
  readonly Vc: Float32Array[]; // mémoire des valeurs par couche
  readonly qNorm: boolean; // normalisation par tête de Q (qwen3/gemma2)
  readonly kNorm: boolean; // normalisation par tête de K
  pos: number; // prochaine position à écrire
}

/** Prépare l'état de calcul : lit la config, alloue la mémoire des clés/valeurs, charge la table d'embedding. */
export async function creerEtat(modele: ModeleGguf, tmaxVoulu?: number): Promise<EtatMetis> {
  const hy = modele.hyper;
  const rope = modeRope(modele.arch);
  const C = hy.embeddingLength;
  const L = hy.blockCount;
  const nTete = hy.headCount;
  const nTeteKv = hy.headCountKv > 0 ? hy.headCountKv : nTete;
  if (nTete <= 0 || C <= 0 || L <= 0) throw new Error('Métis : hyper-paramètres du modèle invalides.');
  if (nTete % nTeteKv !== 0) throw new Error(`Métis : headCount (${nTete}) doit être un multiple de headCountKv (${nTeteKv}).`);
  const hd = Math.floor(C / nTete);
  let nRot = hy.ropeDimensionCount > 0 ? hy.ropeDimensionCount : hd;
  if (nRot > hd) nRot = hd;
  const V = hy.vocabLength > 0 ? hy.vocabLength : modele.decoupage.vocab;
  const ff = hy.feedForwardLength;
  const kvDim = nTeteKv * hd;
  const Tmax = Math.max(1, Math.min(hy.contextLength > 0 ? hy.contextLength : 2048, tmaxVoulu ?? 4096));
  // Refus poli AVANT toute allocation : on estime la mémoire d'après la GÉOMÉTRIE (tous les poids matérialisés en
  // flottants + les mémoires clés/valeurs), pas d'après la taille du fichier. Un fichier hostile ou simplement trop
  // gros pour la machine est refusé ici, sans allouer un seul tableau géant (sinon le processus s'épuise en mémoire).
  let params = 0;
  for (const t of modele.tenseurs.values()) { let n = 1; for (const d of t.dims) n *= d; params += n; }
  const besoinOctets = memoireNecessaireOctets(params, L, Tmax, kvDim);
  const libreOctets = freemem();
  if (besoinOctets > libreOctets * 0.9) {
    const mo = (o: number): number => Math.round(o / (1024 * 1024));
    throw new Error(`Métis : ce modèle demande environ ${mo(besoinOctets)} Mo en mémoire (poids en flottants + mémoire d'attention), au-delà des ${mo(libreOctets)} Mo libres sur cette machine. Choisis un modèle plus petit — Métis affiche la bonne taille d'après la mesure.`);
  }
  const wteInfo = modele.tenseurs.get('token_embd.weight');
  if (!wteInfo) throw new Error('Métis : token_embd.weight est absent du modèle.');
  const wte = (await modele.tenseur('token_embd.weight')).data;
  const Kc: Float32Array[] = [];
  const Vc: Float32Array[] = [];
  for (let l = 0; l < L; l++) { Kc.push(new Float32Array(Tmax * kvDim)); Vc.push(new Float32Array(Tmax * kvDim)); }
  const qNorm = modele.tenseurs.has('blk.0.attn_q_norm.weight');
  const kNorm = modele.tenseurs.has('blk.0.attn_k_norm.weight');
  return {
    modele, C, L, nTete, nTeteKv, hd, nRot, baseRope: hy.ropeFreqBase > 0 ? hy.ropeFreqBase : 10000,
    eps: hy.rmsEps > 0 ? hy.rmsEps : 1e-5, V, ff, rope, noy: noyaux(), Tmax, kvDim, wte,
    poidsT: new Map(), normes: new Map(), Kc, Vc, qNorm, kNorm, pos: 0,
  };
}

/** Remet l'état au début (vide la mémoire des clés/valeurs sans relire les poids). */
export function reinitialiser(e: EtatMetis): void { e.pos = 0; }

/** Charge un poids de projection, transposé [K,N] pour le noyau mm, et le garde en cache. */
async function charger(e: EtatMetis, nom: string): Promise<Poids> {
  const c = e.poidsT.get(nom);
  if (c) return c;
  const ten = await e.modele.tenseur(nom);
  const dims = ten.dims;
  const K = dims[0] ?? ten.data.length; // dimension d'entrée (contiguë dans le fichier)
  const N = dims.length > 1 ? dims[1] : 1; // dimension de sortie
  if (K * N !== ten.data.length) throw new Error(`Métis : taille inattendue pour ${nom} (${ten.data.length} ≠ ${K}×${N}).`);
  const src = ten.data;
  const t = new Float32Array(K * N);
  // t[in*N + out] = src[in + out*K] : on passe de [sortie, entrée] à [entrée, sortie].
  for (let out = 0; out < N; out++) {
    const base = out * K;
    for (let inp = 0; inp < K; inp++) t[inp * N + out] = src[base + inp];
  }
  const p: Poids = { t, K, N };
  e.poidsT.set(nom, p);
  return p;
}

/** Charge un poids de normalisation (vecteur 1D, lu tel quel) et le garde en cache. */
async function norme(e: EtatMetis, nom: string): Promise<Float32Array> {
  const c = e.normes.get(nom);
  if (c) return c;
  const d = (await e.modele.tenseur(nom)).data;
  e.normes.set(nom, d);
  return d;
}

/** RMSNorm : x / sqrt(moy(x²) + eps) · poids. */
function rmsnorm(x: Float32Array, w: Float32Array, eps: number): Float32Array {
  const n = x.length;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += x[i] * x[i];
  const r = 1 / Math.sqrt(ss / n + eps);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) o[i] = x[i] * r * w[i];
  return o;
}

/** RMSNorm appliquée sur une tranche [off, off+len[ d'un tableau, en place (normalisation par tête). */
function rmsnormTranche(arr: Float32Array, off: number, len: number, w: Float32Array, eps: number): void {
  let ss = 0;
  for (let i = 0; i < len; i++) ss += arr[off + i] * arr[off + i];
  const r = 1 / Math.sqrt(ss / len + eps);
  for (let i = 0; i < len; i++) arr[off + i] = arr[off + i] * r * w[i];
}

/** Position tournante sur une tête (tranche [off, off+hd[), à la position pos. */
function appliquerRope(e: EtatMetis, arr: Float32Array, off: number, pos: number): void {
  const nRot = e.nRot, base = e.baseRope, half = nRot >> 1;
  if (e.rope === 'entrelacee') {
    for (let i = 0; i < half; i++) {
      const th = pos * Math.pow(base, (-2 * i) / nRot);
      const c = Math.cos(th), s = Math.sin(th);
      const a = arr[off + 2 * i], b = arr[off + 2 * i + 1];
      arr[off + 2 * i] = a * c - b * s;
      arr[off + 2 * i + 1] = a * s + b * c;
    }
  } else {
    for (let i = 0; i < half; i++) {
      const th = pos * Math.pow(base, (-2 * i) / nRot);
      const c = Math.cos(th), s = Math.sin(th);
      const a = arr[off + i], b = arr[off + i + half];
      arr[off + i] = a * c - b * s;
      arr[off + i + half] = a * s + b * c;
    }
  }
}

const silu = (x: number): number => x / (1 + Math.exp(-x));

/** Produit matrice-vecteur par le noyau : y[N] = x[K] · W(transposé [K,N]). */
function proj(e: EtatMetis, x: Float32Array, p: Poids): Float32Array {
  const y = new Float32Array(p.N);
  e.noy.mm(y, x, p.t, 1, p.K, p.N);
  return y;
}

/**
 * Le dernier vecteur caché (après la normalisation finale) pour le morceau `id` à la position courante.
 * Met à jour la mémoire des clés/valeurs et avance la position. Sert à la tête (logits) et aux plongements.
 */
export async function avantCache(e: EtatMetis, id: number): Promise<Float32Array> {
  const { C, L, nTete, nTeteKv, hd, eps, noy, kvDim } = e;
  const pos = e.pos;
  if (pos >= e.Tmax) throw new Error(`Métis : contexte plein (${e.Tmax} morceaux).`);
  if (id < 0 || id * C + C > e.wte.length) throw new Error(`Métis : morceau ${id} hors du vocabulaire.`);
  const grp = nTete / nTeteKv;
  const inv = 1 / Math.sqrt(hd);

  const x = new Float32Array(C);
  for (let c = 0; c < C; c++) x[c] = e.wte[id * C + c];

  for (let l = 0; l < L; l++) {
    const a = rmsnorm(x, await norme(e, `blk.${l}.attn_norm.weight`), eps);
    const q = proj(e, a, await charger(e, `blk.${l}.attn_q.weight`));
    const k = proj(e, a, await charger(e, `blk.${l}.attn_k.weight`));
    const v = proj(e, a, await charger(e, `blk.${l}.attn_v.weight`));

    if (e.qNorm) { const qn = await norme(e, `blk.${l}.attn_q_norm.weight`); for (let h = 0; h < nTete; h++) rmsnormTranche(q, h * hd, hd, qn, eps); }
    if (e.kNorm) { const kn = await norme(e, `blk.${l}.attn_k_norm.weight`); for (let h = 0; h < nTeteKv; h++) rmsnormTranche(k, h * hd, hd, kn, eps); }

    for (let h = 0; h < nTete; h++) appliquerRope(e, q, h * hd, pos);
    for (let h = 0; h < nTeteKv; h++) appliquerRope(e, k, h * hd, pos);

    e.Kc[l].set(k, pos * kvDim);
    e.Vc[l].set(v, pos * kvDim);

    const ao = new Float32Array(nTete * hd);
    const Kl = e.Kc[l], Vl = e.Vc[l];
    for (let h = 0; h < nTete; h++) {
      const kvh = Math.floor(h / grp);
      const qoff = h * hd, koff = kvh * hd;
      const sc = new Float32Array(pos + 1);
      let mx = -Infinity;
      for (let j = 0; j <= pos; j++) {
        let s = 0;
        const base = j * kvDim + koff;
        for (let c = 0; c < hd; c++) s += q[qoff + c] * Kl[base + c];
        s *= inv; sc[j] = s; if (s > mx) mx = s;
      }
      let som = 0;
      for (let j = 0; j <= pos; j++) { sc[j] = Math.exp(sc[j] - mx); som += sc[j]; }
      const r = 1 / som;
      for (let c = 0; c < hd; c++) {
        let s = 0;
        for (let j = 0; j <= pos; j++) s += sc[j] * r * Vl[j * kvDim + koff + c];
        ao[qoff + c] = s;
      }
    }
    const oo = proj(e, ao, await charger(e, `blk.${l}.attn_output.weight`));
    for (let c = 0; c < C; c++) x[c] += oo[c];

    const b = rmsnorm(x, await norme(e, `blk.${l}.ffn_norm.weight`), eps);
    const g = proj(e, b, await charger(e, `blk.${l}.ffn_gate.weight`));
    const u = proj(e, b, await charger(e, `blk.${l}.ffn_up.weight`));
    for (let i = 0; i < g.length; i++) g[i] = silu(g[i]) * u[i];
    const f = proj(e, g, await charger(e, `blk.${l}.ffn_down.weight`));
    for (let c = 0; c < C; c++) x[c] += f[c];
  }

  const y = rmsnorm(x, await norme(e, 'output_norm.weight'), eps);
  e.pos = pos + 1;
  return y;
}

/** Les logits du prochain morceau après avoir consommé `id` à la position courante. */
export async function passeAvant(e: EtatMetis, id: number): Promise<Float32Array> {
  const y = await avantCache(e, id);
  // Tête : output.weight si présente, sinon poids liés (token_embd.weight).
  const nomTete = e.modele.tenseurs.has('output.weight') ? 'output.weight' : 'token_embd.weight';
  const tete = await charger(e, nomTete);
  const logits = new Float32Array(tete.N);
  e.noy.mm(logits, y, tete.t, 1, tete.K, tete.N);
  return logits;
}
