// Le calcul de Noûs — un Transformer « décodeur seul » écrit à la main (fonctionnement public : attention causale,
// normalisation de couche, GELU, rétropropagation, AdamW), en Float32. Ce fichier a deux visages :
//   - importé (fil principal ou banc de mesure) : il expose la classe Reseau et la séance d'entraînement, synchrones,
//     reproductibles à la graine. Les essais s'en servent en direct.
//   - lancé comme worker (moteur.ts) : tout en bas, il répond aux messages de la façade (proposer, séance, écrire…),
//     de sorte que le calcul ne tourne JAMAIS sur le fil principal d'Odin.
//
// Tout le hasard passe par src/brain/nous/hasard.ts (aucun Math.random). Les produits de matrices passent par les
// noyaux de src/brain/nous/wasm.ts (WebAssembly SIMD, repli JavaScript). Aucun paquet, aucun serveur.

import { isMainThread, parentPort } from 'node:worker_threads';
import type { Hyper } from './tailles.ts';
import { hasard, graineDe, melange, type Hasard } from './hasard.ts';
import { noyaux, type Noyaux } from './wasm.ts';

// ----------------------------------------------------------------------------------------------------------------
// Disposition des poids dans un seul tableau Float32 (facile à sceller, partager, recharger).
// ----------------------------------------------------------------------------------------------------------------

export interface DispCouche {
  ln1g: number; ln1b: number; wq: number; wk: number; wv: number; wo: number;
  ln2g: number; ln2b: number; w1: number; b1: number; w2: number; b2: number;
}
export interface Disposition {
  total: number; C: number; C4: number; H: number; hd: number; V: number; T: number; L: number;
  wte: number; wpe: number; lnfg: number; lnfb: number; couches: DispCouche[];
}

/** Calcule les décalages de chaque tenseur de poids. */
export function disposition(h: Hyper): Disposition {
  const C = h.C, C4 = 4 * C, H = h.tetes, hd = C / H, V = h.vocab, T = h.contexte, L = h.couches;
  let o = 0; const prendre = (n: number): number => { const d = o; o += n; return d; };
  const wte = prendre(V * C);
  const wpe = prendre(T * C);
  const couches: DispCouche[] = [];
  for (let l = 0; l < L; l++) {
    couches.push({
      ln1g: prendre(C), ln1b: prendre(C),
      wq: prendre(C * C), wk: prendre(C * C), wv: prendre(C * C), wo: prendre(C * C),
      ln2g: prendre(C), ln2b: prendre(C),
      w1: prendre(C * C4), b1: prendre(C4), w2: prendre(C4 * C), b2: prendre(C),
    });
  }
  const lnfg = prendre(C), lnfb = prendre(C);
  return { total: o, C, C4, H, hd, V, T, L, wte, wpe, lnfg, lnfb, couches };
}

// ----------------------------------------------------------------------------------------------------------------
// Petites opérations (sur des vues Float32Array).
// ----------------------------------------------------------------------------------------------------------------

const SQRT_2_PI = Math.sqrt(2 / Math.PI);
function gelu(x: number): number { return 0.5 * x * (1 + Math.tanh(SQRT_2_PI * (x + 0.044715 * x * x * x))); }
/** Dérivée de GELU (approximation tanh), à partir de l'entrée x. */
function dgelu(x: number): number {
  const u = SQRT_2_PI * (x + 0.044715 * x * x * x);
  const th = Math.tanh(u);
  const sech2 = 1 - th * th;
  return 0.5 * (1 + th) + 0.5 * x * sech2 * SQRT_2_PI * (1 + 3 * 0.044715 * x * x);
}

/** Transpose src[rows,cols] -> dst[cols,rows]. */
function transpose(dst: Float32Array, src: Float32Array, rows: number, cols: number): void {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) dst[c * rows + r] = src[r * cols + c];
}

// ----------------------------------------------------------------------------------------------------------------
// L'état d'une passe avant (ce qu'il faut garder pour la rétropropagation).
// ----------------------------------------------------------------------------------------------------------------

interface EtatCouche {
  xEntree: Float32Array; // x avant la couche (= résidu d'entrée)
  a: Float32Array; m1: Float32Array; r1: Float32Array; // ln1 : sortie, moyenne, 1/écart-type
  q: Float32Array; k: Float32Array; v: Float32Array;
  p: Float32Array; // probabilités d'attention [H,T,T]
  ao: Float32Array; // sortie d'attention concaténée (avant Wo)
  xMid: Float32Array; // x après le bloc d'attention (résidu)
  b: Float32Array; m2: Float32Array; r2: Float32Array; // ln2
  h1: Float32Array; g: Float32Array; // pré-GELU et post-GELU
}
interface Etat {
  T: number;
  x0: Float32Array; // plongements d'entrée (jetons + position)
  couches: EtatCouche[];
  xFinal: Float32Array; // x après la dernière couche
  mf: Float32Array; rf: Float32Array; // ln finale
  y: Float32Array; // sortie normalisée finale [T,C]
  logits?: Float32Array; // [T,V] si demandé
}

// ----------------------------------------------------------------------------------------------------------------
// Le réseau.
// ----------------------------------------------------------------------------------------------------------------

/** Un signal d'arrêt minimal : seul `aborted` compte (un vrai AbortSignal convient, un drapeau partagé aussi). */
export interface SignalArret { readonly aborted: boolean }
export interface GenOpts { maxMorceaux?: number; delaiMs?: number; signal?: SignalArret; graine?: number; temperature?: number; arretId?: number }
export interface GenSortie { ids: number[]; logprob: number; confiance: number; morceaux: number; tempsMs: number; pret: boolean }

export class Reseau {
  readonly hyper: Hyper;
  readonly disp: Disposition;
  poids: Float32Array;
  grads: Float32Array;
  private m: Float32Array; // moment 1 (AdamW)
  private vMom: Float32Array; // moment 2
  pas = 0;
  private nAccum = 0; // nombre de séquences accumulées dans grads
  private noy: Noyaux;

  constructor(hyper: Hyper, poids?: Float32Array) {
    this.hyper = hyper;
    this.disp = disposition(hyper);
    this.poids = poids ?? new Float32Array(this.disp.total);
    this.grads = new Float32Array(this.disp.total);
    this.m = new Float32Array(this.disp.total);
    this.vMom = new Float32Array(this.disp.total);
    this.noy = noyaux();
  }

  /** Nombre réel de poids. */
  get nombrePoids(): number { return this.disp.total; }

  /** Initialise les poids au hasard (reproductible). Normalisations à 1/0, biais à 0, reste en gaussienne 0,02. */
  initialiser(graine: number): void {
    const h = hasard(graine), d = this.disp, P = this.poids;
    P.fill(0);
    const gauss = (n: number, off: number, ec: number): void => { for (let i = 0; i < n; i++) P[off + i] = h.gauss() * ec; };
    gauss(d.V * d.C, d.wte, 0.02);
    gauss(d.T * d.C, d.wpe, 0.02);
    for (const c of d.couches) {
      for (let i = 0; i < d.C; i++) { P[c.ln1g + i] = 1; P[c.ln2g + i] = 1; }
      gauss(d.C * d.C, c.wq, 0.02); gauss(d.C * d.C, c.wk, 0.02); gauss(d.C * d.C, c.wv, 0.02); gauss(d.C * d.C, c.wo, 0.02);
      gauss(d.C * d.C4, c.w1, 0.02); gauss(d.C4 * d.C, c.w2, 0.02);
    }
    for (let i = 0; i < d.C; i++) this.poids[d.lnfg + i] = 1;
    this.m.fill(0); this.vMom.fill(0); this.pas = 0; this.nAccum = 0; this.grads.fill(0);
  }

  // --- vues sur un tenseur de poids ---
  private t(off: number, len: number): Float32Array { return this.poids.subarray(off, off + len); }
  private g(off: number, len: number): Float32Array { return this.grads.subarray(off, off + len); }

  // --- produits de matrices via les noyaux ---
  private mm(c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void { this.noy.mm(c, a, b, M, K, N); }

  // ------------------------------------------------------------------------------------------------------------
  // Passe avant. avecLogits => calcule aussi les logits [T,V]. Renvoie l'état (gardé pour la rétropropagation).
  // ------------------------------------------------------------------------------------------------------------
  avant(ids: ArrayLike<number>, avecLogits: boolean): Etat {
    const d = this.disp, C = d.C, C4 = d.C4, H = d.H, hd = d.hd, V = d.V, T = ids.length;
    const x0 = new Float32Array(T * C);
    for (let t = 0; t < T; t++) {
      const id = ids[t] | 0, we = d.wte + id * C, pe = d.wpe + t * C, xo = t * C;
      for (let c = 0; c < C; c++) x0[xo + c] = this.poids[we + c] + this.poids[pe + c];
    }
    let x = x0;
    const couches: EtatCouche[] = [];
    const inv = 1 / Math.sqrt(hd);
    for (let l = 0; l < d.L; l++) {
      const cp = d.couches[l];
      const xEntree = x;
      // ln1
      const a = new Float32Array(T * C), m1 = new Float32Array(T), r1 = new Float32Array(T);
      this.layernorm(a, m1, r1, x, this.t(cp.ln1g, C), this.t(cp.ln1b, C), T, C);
      // q,k,v = a·W
      const q = new Float32Array(T * C), k = new Float32Array(T * C), v = new Float32Array(T * C);
      this.mm(q, a, this.t(cp.wq, C * C), T, C, C);
      this.mm(k, a, this.t(cp.wk, C * C), T, C, C);
      this.mm(v, a, this.t(cp.wv, C * C), T, C, C);
      // attention causale par tête
      const p = new Float32Array(H * T * T), ao = new Float32Array(T * C);
      for (let hh = 0; hh < H; hh++) {
        const hoff = hh * hd, poff = hh * T * T;
        for (let i = 0; i < T; i++) {
          // scores
          let mx = -Infinity;
          for (let j = 0; j <= i; j++) {
            let s = 0; const qi = i * C + hoff, kj = j * C + hoff;
            for (let c = 0; c < hd; c++) s += q[qi + c] * k[kj + c];
            s *= inv; p[poff + i * T + j] = s; if (s > mx) mx = s;
          }
          // softmax (0..i)
          let som = 0;
          for (let j = 0; j <= i; j++) { const e = Math.exp(p[poff + i * T + j] - mx); p[poff + i * T + j] = e; som += e; }
          const r = 1 / som;
          for (let j = 0; j <= i; j++) p[poff + i * T + j] *= r;
          // sortie = somme p*v
          const ai = i * C + hoff;
          for (let c = 0; c < hd; c++) { let s = 0; for (let j = 0; j <= i; j++) s += p[poff + i * T + j] * v[j * C + hoff + c]; ao[ai + c] = s; }
        }
      }
      // o = ao·Wo ; x = x + o
      const o = new Float32Array(T * C);
      this.mm(o, ao, this.t(cp.wo, C * C), T, C, C);
      const xMid = new Float32Array(T * C);
      for (let i = 0; i < T * C; i++) xMid[i] = xEntree[i] + o[i];
      // ln2
      const b = new Float32Array(T * C), m2 = new Float32Array(T), r2 = new Float32Array(T);
      this.layernorm(b, m2, r2, xMid, this.t(cp.ln2g, C), this.t(cp.ln2b, C), T, C);
      // ffn : h1 = b·W1 + b1 ; g = gelu(h1) ; f = g·W2 + b2 ; x = xMid + f
      const h1 = new Float32Array(T * C4);
      this.mm(h1, b, this.t(cp.w1, C * C4), T, C, C4);
      const b1 = this.t(cp.b1, C4);
      for (let i = 0; i < T; i++) for (let c = 0; c < C4; c++) h1[i * C4 + c] += b1[c];
      const gact = new Float32Array(T * C4);
      for (let i = 0; i < T * C4; i++) gact[i] = gelu(h1[i]);
      const f = new Float32Array(T * C);
      this.mm(f, gact, this.t(cp.w2, C4 * C), T, C4, C);
      const b2 = this.t(cp.b2, C);
      const xNext = new Float32Array(T * C);
      for (let i = 0; i < T; i++) for (let c = 0; c < C; c++) xNext[i * C + c] = xMid[i * C + c] + f[i * C + c] + b2[c];
      couches.push({ xEntree, a, m1, r1, q, k, v, p, ao, xMid, b, m2, r2, h1, g: gact });
      x = xNext;
    }
    // ln finale
    const y = new Float32Array(T * C), mf = new Float32Array(T), rf = new Float32Array(T);
    this.layernorm(y, mf, rf, x, this.t(d.lnfg, C), this.t(d.lnfb, C), T, C);
    const et: Etat = { T, x0, couches, xFinal: x, mf, rf, y };
    if (avecLogits) {
      const wteT = new Float32Array(C * V);
      transpose(wteT, this.t(d.wte, V * C), V, C);
      const logits = new Float32Array(T * V);
      this.mm(logits, y, wteT, T, C, V);
      et.logits = logits;
    }
    return et;
  }

  private layernorm(out: Float32Array, moy: Float32Array, rstd: Float32Array, x: Float32Array, gamma: Float32Array, beta: Float32Array, T: number, C: number): void {
    const eps = 1e-5;
    for (let t = 0; t < T; t++) {
      const o = t * C; let mu = 0; for (let c = 0; c < C; c++) mu += x[o + c]; mu /= C;
      let va = 0; for (let c = 0; c < C; c++) { const dd = x[o + c] - mu; va += dd * dd; } va /= C;
      const rs = 1 / Math.sqrt(va + eps); moy[t] = mu; rstd[t] = rs;
      for (let c = 0; c < C; c++) out[o + c] = (x[o + c] - mu) * rs * gamma[c] + beta[c];
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Perte (entropie croisée) sur une séquence : prédire ids[t+1] depuis la position t. Renvoie la perte moyenne.
  // rôlesMasque[t] = 0 => on n'apprend pas à prédire ids[t+1] (ex. partie « demande » en ajustement).
  // ------------------------------------------------------------------------------------------------------------
  perteEtGrad(ids: ArrayLike<number>, poidsExemple = 1, rolesMasque?: ArrayLike<number>): number {
    const d = this.disp, C = d.C, V = d.V, T = ids.length;
    const et = this.avant(ids, true);
    const logits = et.logits!;
    const dLogits = new Float32Array(T * V);
    let perte = 0, nPred = 0;
    for (let t = 0; t < T - 1; t++) {
      if (rolesMasque && !rolesMasque[t]) continue;
      const cible = ids[t + 1] | 0, o = t * V;
      let mx = -Infinity; for (let vv = 0; vv < V; vv++) if (logits[o + vv] > mx) mx = logits[o + vv];
      let som = 0; for (let vv = 0; vv < V; vv++) som += Math.exp(logits[o + vv] - mx);
      const lse = mx + Math.log(som);
      perte += lse - logits[o + cible];
      nPred++;
      for (let vv = 0; vv < V; vv++) dLogits[o + vv] = Math.exp(logits[o + vv] - lse);
      dLogits[o + cible] -= 1;
    }
    if (nPred === 0) return 0;
    const ech = (poidsExemple / nPred);
    for (let i = 0; i < T * V; i++) dLogits[i] *= ech;
    this.retropropagation(ids, et, dLogits);
    this.nAccum += 1;
    return perte / nPred;
  }

  /** Rétropropagation complète : remplit this.grads (accumulation). dLogits déjà mis à l'échelle. */
  private retropropagation(ids: ArrayLike<number>, et: Etat, dLogits: Float32Array): void {
    const d = this.disp, C = d.C, C4 = d.C4, H = d.H, hd = d.hd, V = d.V, T = et.T;
    const inv = 1 / Math.sqrt(hd);
    // tête de sortie : logits = y·wteᵀ
    const dY = new Float32Array(T * C);
    this.mm(dY, dLogits, this.t(d.wte, V * C), T, V, C); // dY = dLogits·wte
    // dWte (part « tête ») = dLogitsᵀ·y
    const dLogitsT = new Float32Array(V * T); transpose(dLogitsT, dLogits, T, V);
    const tmpVC = new Float32Array(V * C);
    this.mm(tmpVC, dLogitsT, et.y, V, T, C);
    this.ajoute(this.g(d.wte, V * C), tmpVC, V * C);
    // ln finale
    const dxF = new Float32Array(T * C);
    this.dLayernorm(dxF, this.g(d.lnfg, C), this.g(d.lnfb, C), dY, et.xFinal, et.mf, et.rf, this.t(d.lnfg, C), T, C);
    let dx = dxF;
    for (let l = d.L - 1; l >= 0; l--) {
      const cp = d.couches[l], ec = et.couches[l];
      // --- FFN ---
      // x = xMid + f + b2 ; dxMid += dx ; df = dx ; db2 = somme dx
      const df = dx; // [T,C]
      const db2 = this.g(cp.b2, C); for (let i = 0; i < T; i++) for (let c = 0; c < C; c++) db2[c] += df[i * C + c];
      // f = g·W2 ; dG = df·W2ᵀ ; dW2 = gᵀ·df
      const W2 = this.t(cp.w2, C4 * C), W2T = new Float32Array(C * C4); transpose(W2T, W2, C4, C);
      const dG = new Float32Array(T * C4); this.mm(dG, df, W2T, T, C, C4);
      const gT = new Float32Array(C4 * T); transpose(gT, ec.g, T, C4);
      const dW2 = new Float32Array(C4 * C); this.mm(dW2, gT, df, C4, T, C); this.ajoute(this.g(cp.w2, C4 * C), dW2, C4 * C);
      // g = gelu(h1) ; dH1 = dG * gelu'(h1)
      const dH1 = new Float32Array(T * C4); for (let i = 0; i < T * C4; i++) dH1[i] = dG[i] * dgelu(ec.h1[i]);
      // h1 = b·W1 + b1 ; db1 = somme dH1 ; dB = dH1·W1ᵀ ; dW1 = bᵀ·dH1
      const db1 = this.g(cp.b1, C4); for (let i = 0; i < T; i++) for (let c = 0; c < C4; c++) db1[c] += dH1[i * C4 + c];
      const W1 = this.t(cp.w1, C * C4), W1T = new Float32Array(C4 * C); transpose(W1T, W1, C, C4);
      const dB = new Float32Array(T * C); this.mm(dB, dH1, W1T, T, C4, C);
      const bT = new Float32Array(C * T); transpose(bT, ec.b, T, C);
      const dW1 = new Float32Array(C * C4); this.mm(dW1, bT, dH1, C, T, C4); this.ajoute(this.g(cp.w1, C * C4), dW1, C * C4);
      // ln2 : dB -> dxMid (plus le résidu df qui va aussi vers xMid)
      const dxMid = new Float32Array(T * C);
      this.dLayernorm(dxMid, this.g(cp.ln2g, C), this.g(cp.ln2b, C), dB, ec.xMid, ec.m2, ec.r2, this.t(cp.ln2g, C), T, C);
      for (let i = 0; i < T * C; i++) dxMid[i] += df[i]; // résidu du bloc FFN
      // --- Attention ---
      // xMid = xEntree + o ; dxEntree += dxMid ; do = dxMid
      const doo = dxMid; // [T,C]
      // o = ao·Wo ; dAo = do·Woᵀ ; dWo = aoᵀ·do
      const Wo = this.t(cp.wo, C * C), WoT = new Float32Array(C * C); transpose(WoT, Wo, C, C);
      const dAo = new Float32Array(T * C); this.mm(dAo, doo, WoT, T, C, C);
      const aoT = new Float32Array(C * T); transpose(aoT, ec.ao, T, C);
      const dWo = new Float32Array(C * C); this.mm(dWo, aoT, doo, C, T, C); this.ajoute(this.g(cp.wo, C * C), dWo, C * C);
      // attention : remonter dAo vers dq, dk, dv
      const dq = new Float32Array(T * C), dk = new Float32Array(T * C), dv = new Float32Array(T * C);
      for (let hh = 0; hh < H; hh++) {
        const hoff = hh * hd, poff = hh * T * T;
        // dv[j] += sum_i p[i,j]*dAo[i] ; dp[i,j] = dAo[i]·v[j]
        const dp = new Float32Array(T * T);
        for (let i = 0; i < T; i++) {
          const ai = i * C + hoff;
          for (let j = 0; j <= i; j++) {
            const pij = ec.p[poff + i * T + j]; const vj = j * C + hoff;
            let dpij = 0;
            for (let c = 0; c < hd; c++) { dv[vj + c] += pij * dAo[ai + c]; dpij += dAo[ai + c] * ec.v[vj + c]; }
            dp[i * T + j] = dpij;
          }
        }
        // softmax arrière : ds[i,j] = p[i,j]*(dp[i,j] - sum_j' p[i,j']*dp[i,j'])
        for (let i = 0; i < T; i++) {
          let dot = 0; for (let j = 0; j <= i; j++) dot += ec.p[poff + i * T + j] * dp[i * T + j];
          const qi = i * C + hoff;
          for (let j = 0; j <= i; j++) {
            const ds = ec.p[poff + i * T + j] * (dp[i * T + j] - dot) * inv;
            const kj = j * C + hoff;
            for (let c = 0; c < hd; c++) { dq[qi + c] += ds * ec.k[kj + c]; dk[kj + c] += ds * ec.q[qi + c]; }
          }
        }
      }
      // q = a·Wq (idem k, v) : dA += dq·Wqᵀ + dk·Wkᵀ + dv·Wvᵀ ; dWq = aᵀ·dq …
      const aT = new Float32Array(C * T); transpose(aT, ec.a, T, C);
      const dA = new Float32Array(T * C);
      const ajouteProjArriere = (W: number, dOut: Float32Array): void => {
        const Wm = this.t(W, C * C), WmT = new Float32Array(C * C); transpose(WmT, Wm, C, C);
        const tmp = new Float32Array(T * C); this.mm(tmp, dOut, WmT, T, C, C); for (let i = 0; i < T * C; i++) dA[i] += tmp[i];
        const dW = new Float32Array(C * C); this.mm(dW, aT, dOut, C, T, C); this.ajoute(this.g(W, C * C), dW, C * C);
      };
      ajouteProjArriere(cp.wq, dq); ajouteProjArriere(cp.wk, dk); ajouteProjArriere(cp.wv, dv);
      // ln1 : dA -> dxEntree (plus le résidu doo)
      const dxEntree = new Float32Array(T * C);
      this.dLayernorm(dxEntree, this.g(cp.ln1g, C), this.g(cp.ln1b, C), dA, ec.xEntree, ec.m1, ec.r1, this.t(cp.ln1g, C), T, C);
      for (let i = 0; i < T * C; i++) dxEntree[i] += doo[i]; // résidu du bloc attention
      dx = dxEntree;
    }
    // plongements d'entrée : x0[t] = wte[ids[t]] + wpe[t]
    const dWte = this.g(d.wte, V * C), dWpe = this.g(d.wpe, T * C);
    for (let t = 0; t < T; t++) {
      const id = ids[t] | 0, we = id * C, pe = t * C, xo = t * C;
      for (let c = 0; c < C; c++) { dWte[we + c] += dx[xo + c]; dWpe[pe + c] += dx[xo + c]; }
    }
  }

  /** Rétropropagation d'une normalisation de couche. Accumule dgamma, dbeta ; écrit dx. */
  private dLayernorm(dx: Float32Array, dgamma: Float32Array, dbeta: Float32Array, dout: Float32Array, x: Float32Array, moy: Float32Array, rstd: Float32Array, gamma: Float32Array, T: number, C: number): void {
    for (let t = 0; t < T; t++) {
      const o = t * C, mu = moy[t], rs = rstd[t];
      let dnormMean = 0, dnormXhat = 0;
      // xhat = (x-mu)*rs ; dout = dgamma_contrib... on calcule d'abord dnorm = dout*gamma
      // sommes nécessaires
      for (let c = 0; c < C; c++) {
        const xhat = (x[o + c] - mu) * rs;
        const dnorm = dout[o + c] * gamma[c];
        dgamma[c] += dout[o + c] * xhat; dbeta[c] += dout[o + c];
        dnormMean += dnorm; dnormXhat += dnorm * xhat;
      }
      dnormMean /= C; dnormXhat /= C;
      for (let c = 0; c < C; c++) {
        const xhat = (x[o + c] - mu) * rs;
        const dnorm = dout[o + c] * gamma[c];
        dx[o + c] = (dnorm - dnormMean - xhat * dnormXhat) * rs;
      }
    }
  }

  private ajoute(dst: Float32Array, src: Float32Array, n: number): void { for (let i = 0; i < n; i++) dst[i] += src[i]; }

  // ------------------------------------------------------------------------------------------------------------
  // Pas d'optimisation AdamW sur les gradients accumulés (moyennés par le nombre de séquences).
  // ------------------------------------------------------------------------------------------------------------
  pasAdamW(lr: number, b1 = 0.9, b2 = 0.999, eps = 1e-8, decay = 0.01): void {
    if (this.nAccum === 0) return;
    const n = this.nAccum, G = this.grads, M = this.m, Vm = this.vMom, P = this.poids;
    this.pas += 1; const t = this.pas;
    const c1 = 1 / (1 - Math.pow(b1, t)), c2 = 1 / (1 - Math.pow(b2, t));
    for (let i = 0; i < G.length; i++) {
      const gi = G[i] / n;
      const mi = M[i] = b1 * M[i] + (1 - b1) * gi;
      const vi = Vm[i] = b2 * Vm[i] + (1 - b2) * gi * gi;
      const mh = mi * c1, vh = vi * c2;
      P[i] -= lr * (mh / (Math.sqrt(vh) + eps) + decay * P[i]);
    }
    G.fill(0); this.nAccum = 0;
  }
  /** Oublie les gradients accumulés sans toucher aux poids (ex. après une interruption). */
  jeterGrad(): void { this.grads.fill(0); this.nAccum = 0; }

  // ------------------------------------------------------------------------------------------------------------
  // Plongement : moyenne de la sortie normalisée finale. [C]
  // ------------------------------------------------------------------------------------------------------------
  plonger(ids: ArrayLike<number>): Float32Array {
    const d = this.disp, C = d.C, T = ids.length;
    if (T === 0) return new Float32Array(C);
    const et = this.avant(ids, false);
    const out = new Float32Array(C);
    for (let t = 0; t < T; t++) for (let c = 0; c < C; c++) out[c] += et.y[t * C + c];
    for (let c = 0; c < C; c++) out[c] /= T;
    return out;
  }

  /** Log-probabilité moyenne par morceau de `reponse` sachant `demande` (préférence du duel). */
  score(demande: ArrayLike<number>, reponse: ArrayLike<number>): number {
    const d = this.disp, V = d.V;
    const dem = Array.from(demande, (x) => x | 0), rep = Array.from(reponse, (x) => x | 0);
    if (rep.length === 0) return 0;
    const ids = [...dem, ...rep].slice(0, d.T);
    const et = this.avant(ids, true);
    const logits = et.logits!;
    let somme = 0, n = 0;
    const debut = Math.min(dem.length, ids.length) - 1; // la 1re cible de réponse est prédite depuis la dernière position de la demande
    for (let t = Math.max(0, debut); t < ids.length - 1; t++) {
      const cible = ids[t + 1], o = t * V;
      let mx = -Infinity; for (let vv = 0; vv < V; vv++) if (logits[o + vv] > mx) mx = logits[o + vv];
      let s = 0; for (let vv = 0; vv < V; vv++) s += Math.exp(logits[o + vv] - mx);
      somme += (logits[o + cible] - (mx + Math.log(s))); n++;
    }
    return n ? somme / n : 0;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Logits de la dernière position par une passe avant complète (sans cache) — sert à vérifier le cache.
  // ------------------------------------------------------------------------------------------------------------
  logitsDerniere(ids: ArrayLike<number>): Float32Array {
    const d = this.disp, C = d.C, V = d.V, T = ids.length;
    const et = this.avant(ids, false);
    const wteT = new Float32Array(C * V); transpose(wteT, this.t(d.wte, V * C), V, C);
    const out = new Float32Array(V);
    const yLast = et.y.subarray((T - 1) * C, T * C);
    this.mm(out, yLast, wteT, 1, C, V);
    return out;
  }

  // ------------------------------------------------------------------------------------------------------------
  // Génération avec mémoire des clés/valeurs (obligatoire : sans elle ~45× plus lent).
  // ------------------------------------------------------------------------------------------------------------
  generer(amorce: ArrayLike<number>, n: number, o: GenOpts = {}): GenSortie {
    const d = this.disp, C = d.C, H = d.H, hd = d.hd, V = d.V, L = d.L, T = d.T;
    const t0 = performance.now();
    const h = hasard(o.graine ?? 0x51a7);
    const temp = o.temperature ?? 0;
    const amo = Array.from(amorce, (x) => x | 0).slice(-T);
    // cache des clés et valeurs par couche : Float32Array [T,C] remplis au fur et à mesure (jusqu'à T positions).
    const Kc: Float32Array[] = [], Vc: Float32Array[] = [];
    for (let l = 0; l < L; l++) { Kc.push(new Float32Array(T * C)); Vc.push(new Float32Array(T * C)); }
    let pos = 0; const sortie: number[] = []; let logprob = 0; let pret = true;
    const inv = 1 / Math.sqrt(hd);
    const wteT = new Float32Array(C * V); transpose(wteT, this.t(d.wte, V * C), V, C); // transposée de la tête, une seule fois
    // traite la position `pos` avec le jeton `id` ; renvoie les logits de cette position.
    const etape = (id: number): Float32Array => {
      const x = new Float32Array(C);
      for (let c = 0; c < C; c++) x[c] = this.poids[d.wte + id * C + c] + this.poids[d.wpe + pos * C + c];
      for (let l = 0; l < L; l++) {
        const cp = d.couches[l];
        const a = new Float32Array(C); this.lnVec(a, x, this.t(cp.ln1g, C), this.t(cp.ln1b, C), C);
        const q = new Float32Array(C), k = new Float32Array(C), v = new Float32Array(C);
        this.mm(q, a, this.t(cp.wq, C * C), 1, C, C);
        this.mm(k, a, this.t(cp.wk, C * C), 1, C, C);
        this.mm(v, a, this.t(cp.wv, C * C), 1, C, C);
        for (let c = 0; c < C; c++) { Kc[l][pos * C + c] = k[c]; Vc[l][pos * C + c] = v[c]; }
        const ao = new Float32Array(C);
        for (let hh = 0; hh < H; hh++) {
          const hoff = hh * hd; let mx = -Infinity;
          const sc = new Float32Array(pos + 1);
          for (let j = 0; j <= pos; j++) { let s = 0; for (let c = 0; c < hd; c++) s += q[hoff + c] * Kc[l][j * C + hoff + c]; s *= inv; sc[j] = s; if (s > mx) mx = s; }
          let som = 0; for (let j = 0; j <= pos; j++) { sc[j] = Math.exp(sc[j] - mx); som += sc[j]; }
          const r = 1 / som; for (let j = 0; j <= pos; j++) sc[j] *= r;
          for (let c = 0; c < hd; c++) { let s = 0; for (let j = 0; j <= pos; j++) s += sc[j] * Vc[l][j * C + hoff + c]; ao[hoff + c] = s; }
        }
        const oo = new Float32Array(C); this.mm(oo, ao, this.t(cp.wo, C * C), 1, C, C);
        for (let c = 0; c < C; c++) x[c] += oo[c];
        const b = new Float32Array(C); this.lnVec(b, x, this.t(cp.ln2g, C), this.t(cp.ln2b, C), C);
        const h1 = new Float32Array(d.C4); this.mm(h1, b, this.t(cp.w1, C * d.C4), 1, C, d.C4);
        const b1 = this.t(cp.b1, d.C4); for (let c = 0; c < d.C4; c++) h1[c] = gelu(h1[c] + b1[c]);
        const f = new Float32Array(C); this.mm(f, h1, this.t(cp.w2, d.C4 * C), 1, d.C4, C);
        const b2 = this.t(cp.b2, C); for (let c = 0; c < C; c++) x[c] += f[c] + b2[c];
      }
      const y = new Float32Array(C); this.lnVec(y, x, this.t(d.lnfg, C), this.t(d.lnfb, C), C);
      const logits = new Float32Array(V); this.mm(logits, y, wteT, 1, C, V);
      return logits;
    };
    // consomme l'amorce (sauf le dernier jeton, qui lance la génération)
    for (let i = 0; i < amo.length - 1 && pos < T - 1; i++) { etape(amo[i]); pos++; }
    let courant = amo.length ? amo[amo.length - 1] : 0;
    const maxN = Math.max(0, Math.min(n, T - pos - 1 + 1));
    for (let step = 0; step < maxN; step++) {
      if (o.signal?.aborted) { pret = false; break; }
      if (o.delaiMs && performance.now() - t0 > o.delaiMs) { pret = false; break; }
      if (pos >= T) { break; }
      const logits = etape(courant);
      // log-softmax du jeton choisi pour la confiance
      let mx = -Infinity; for (let vv = 0; vv < V; vv++) if (logits[vv] > mx) mx = logits[vv];
      let som = 0; for (let vv = 0; vv < V; vv++) som += Math.exp(logits[vv] - mx);
      const lse = mx + Math.log(som);
      let choisi: number;
      if (temp <= 0) { let bi = 0, bv = -Infinity; for (let vv = 0; vv < V; vv++) if (logits[vv] > bv) { bv = logits[vv]; bi = vv; } choisi = bi; }
      else { const u = h.reel(); let somT = 0; for (let vv = 0; vv < V; vv++) somT += Math.exp((logits[vv] - mx) / temp); const rT = 1 / somT; let acc = 0, pick = V - 1; for (let vv = 0; vv < V; vv++) { acc += Math.exp((logits[vv] - mx) / temp) * rT; if (acc >= u) { pick = vv; break; } } choisi = pick; }
      logprob += logits[choisi] - lse;
      pos++;
      sortie.push(choisi);
      courant = choisi;
      if (o.arretId !== undefined && choisi === o.arretId) break;
    }
    const morceaux = sortie.length;
    const moyLP = morceaux ? logprob / morceaux : 0;
    return { ids: sortie, logprob, confiance: Math.exp(moyLP), morceaux, tempsMs: performance.now() - t0, pret };
  }

  /** Logits de la dernière position par la voie INCRÉMENTALE (mémoire clés/valeurs), pour vérifier le cache. */
  logitsCache(ids: ArrayLike<number>): Float32Array {
    const d = this.disp, C = d.C, H = d.H, hd = d.hd, V = d.V, L = d.L;
    const T = Math.min(ids.length, d.T);
    const inv = 1 / Math.sqrt(hd);
    const Kc: Float32Array[] = [], Vc: Float32Array[] = [];
    for (let l = 0; l < L; l++) { Kc.push(new Float32Array(T * C)); Vc.push(new Float32Array(T * C)); }
    const wteT = new Float32Array(C * V); transpose(wteT, this.t(d.wte, V * C), V, C);
    let logits = new Float32Array(V);
    for (let pos = 0; pos < T; pos++) {
      const id = ids[pos] | 0;
      const x = new Float32Array(C);
      for (let c = 0; c < C; c++) x[c] = this.poids[d.wte + id * C + c] + this.poids[d.wpe + pos * C + c];
      for (let l = 0; l < L; l++) {
        const cp = d.couches[l];
        const a = new Float32Array(C); this.lnVec(a, x, this.t(cp.ln1g, C), this.t(cp.ln1b, C), C);
        const q = new Float32Array(C), k = new Float32Array(C), v = new Float32Array(C);
        this.mm(q, a, this.t(cp.wq, C * C), 1, C, C); this.mm(k, a, this.t(cp.wk, C * C), 1, C, C); this.mm(v, a, this.t(cp.wv, C * C), 1, C, C);
        for (let c = 0; c < C; c++) { Kc[l][pos * C + c] = k[c]; Vc[l][pos * C + c] = v[c]; }
        const ao = new Float32Array(C);
        for (let hh = 0; hh < H; hh++) {
          const hoff = hh * hd; let mx = -Infinity; const sc = new Float32Array(pos + 1);
          for (let j = 0; j <= pos; j++) { let s = 0; for (let c = 0; c < hd; c++) s += q[hoff + c] * Kc[l][j * C + hoff + c]; s *= inv; sc[j] = s; if (s > mx) mx = s; }
          let som = 0; for (let j = 0; j <= pos; j++) { sc[j] = Math.exp(sc[j] - mx); som += sc[j]; }
          const r = 1 / som; for (let j = 0; j <= pos; j++) sc[j] *= r; // normalise, puis somme pondérée (même ordre que la passe complète)
          for (let c = 0; c < hd; c++) { let s = 0; for (let j = 0; j <= pos; j++) s += sc[j] * Vc[l][j * C + hoff + c]; ao[hoff + c] = s; }
        }
        const oo = new Float32Array(C); this.mm(oo, ao, this.t(cp.wo, C * C), 1, C, C);
        for (let c = 0; c < C; c++) x[c] += oo[c];
        const b = new Float32Array(C); this.lnVec(b, x, this.t(cp.ln2g, C), this.t(cp.ln2b, C), C);
        const h1 = new Float32Array(d.C4); this.mm(h1, b, this.t(cp.w1, C * d.C4), 1, C, d.C4);
        const b1 = this.t(cp.b1, d.C4); for (let c = 0; c < d.C4; c++) h1[c] = gelu(h1[c] + b1[c]);
        const f = new Float32Array(C); this.mm(f, h1, this.t(cp.w2, d.C4 * C), 1, d.C4, C);
        const b2 = this.t(cp.b2, C); for (let c = 0; c < C; c++) x[c] += f[c] + b2[c];
      }
      const y = new Float32Array(C); this.lnVec(y, x, this.t(d.lnfg, C), this.t(d.lnfb, C), C);
      logits = new Float32Array(V); this.mm(logits, y, wteT, 1, C, V);
    }
    return logits;
  }

  /** Génération SANS cache (recalcul complet à chaque pas) : sert uniquement à vérifier le cache. Greedy. */
  genererSansCache(amorce: ArrayLike<number>, n: number): number[] {
    const d = this.disp, V = d.V, T = d.T;
    let ids = Array.from(amorce, (x) => x | 0).slice(-T);
    const out: number[] = [];
    // on prédit depuis les positions jusqu'à T-1 incluse (comme la génération avec cache) : prefixe de longueur ≤ T.
    for (let step = 0; step < n && ids.length <= T; step++) {
      const logits = this.logitsDerniere(ids);
      let bi = 0, bv = -Infinity; for (let vv = 0; vv < V; vv++) if (logits[vv] > bv) { bv = logits[vv]; bi = vv; }
      out.push(bi); ids = [...ids, bi];
    }
    return out;
  }

  private lnVec(out: Float32Array, x: Float32Array, gamma: Float32Array, beta: Float32Array, C: number): void {
    let mu = 0; for (let c = 0; c < C; c++) mu += x[c]; mu /= C;
    let va = 0; for (let c = 0; c < C; c++) { const dd = x[c] - mu; va += dd * dd; } va /= C;
    const rs = 1 / Math.sqrt(va + 1e-5);
    for (let c = 0; c < C; c++) out[c] = (x[c] - mu) * rs * gamma[c] + beta[c];
  }

  /** Copie des poids (pour un point de reprise). */
  exporterPoids(): Float32Array { return Float32Array.from(this.poids); }
  /** Remplace les poids (chargement d'un point de reprise). */
  importerPoids(p: Float32Array): void { if (p.length !== this.disp.total) throw new Error('taille de poids incompatible'); this.poids.set(p); }
  /** Copie des moments AdamW (pour un point de reprise). */
  exporterMoments(): { m: Float32Array; v: Float32Array; pas: number } { return { m: Float32Array.from(this.m), v: Float32Array.from(this.vMom), pas: this.pas }; }
  importerMoments(m: Float32Array, v: Float32Array, pas: number): void { this.m.set(m); this.vMom.set(v); this.pas = pas; }
}

// ----------------------------------------------------------------------------------------------------------------
// Une séance d'entraînement synchrone, reproductible, interruptible. Utilisée en direct par les essais et par le
// worker. Elle ne bloque jamais le fil principal d'Odin : dans le worker, elle tourne sur un autre fil ; appelée en
// direct (essais, banc), c'est volontaire.
// ----------------------------------------------------------------------------------------------------------------

export interface LotBrut { entrees: Int32Array[]; roles?: Int32Array[]; poidsExemple?: Float32Array }
export interface SeanceReglages { dureeMs: number; signal?: SignalArret; graine: number; lr?: number; tailleLot?: number; maxPas?: number }
export interface AvanceeBrute { pas: number; morceauxVus: number; perte: number; tempsMs: number; interrompue: boolean }

/** Déroule une séance : accumule `tailleLot` séquences, fait un pas AdamW, recommence jusqu'à épuisement/temps/signal. */
export function seance(r: Reseau, lots: Iterable<LotBrut>, o: SeanceReglages): AvanceeBrute {
  const t0 = performance.now();
  const lr = o.lr ?? 3e-4, tailleLot = o.tailleLot ?? 8;
  const h = hasard(o.graine);
  let pas = 0, morceaux = 0, perteTot = 0, perteN = 0, interrompue = false;
  // rassemble toutes les séquences (avec leur rôle/poids) en une liste, puis mélange à la graine.
  const items: Array<{ ids: Int32Array; role?: Int32Array; poids: number }> = [];
  for (const lot of lots) {
    for (let i = 0; i < lot.entrees.length; i++) items.push({ ids: lot.entrees[i], role: lot.roles?.[i], poids: lot.poidsExemple?.[i] ?? 1 });
  }
  if (items.length === 0) return { pas: 0, morceauxVus: 0, perte: 0, tempsMs: performance.now() - t0, interrompue: false };
  const ordre = melange(items.length, h);
  let idx = 0;
  while (true) {
    if (o.signal?.aborted) { interrompue = true; r.jeterGrad(); break; }
    if (performance.now() - t0 > o.dureeMs) break;
    if (o.maxPas && pas >= o.maxPas) break;
    let dansLot = 0, lotSain = true;
    for (; dansLot < tailleLot && idx < ordre.length; idx++, dansLot++) {
      const it = items[ordre[idx]];
      if (it.ids.length < 2) continue;
      const p = r.perteEtGrad(it.ids, it.poids, it.role);
      if (Number.isFinite(p)) { perteTot += p; perteN++; } else lotSain = false; // divergence : lot écarté
      morceaux += it.ids.length;
      if (o.signal?.aborted) { interrompue = true; break; }
    }
    if (interrompue) { r.jeterGrad(); break; }
    // NE JAMAIS EMPIRER : un lot à la perte infinie/non numérique n'est pas appliqué (les poids restent intacts).
    if (!lotSain) { r.jeterGrad(); }
    else if (dansLot > 0) { r.pasAdamW(lr); pas++; }
    if (idx >= ordre.length) break; // un seul passage sur les données par séance
  }
  return { pas, morceauxVus: morceaux, perte: perteN ? perteTot / perteN : 0, tempsMs: performance.now() - t0, interrompue };
}

// ----------------------------------------------------------------------------------------------------------------
// Le worker. Actif UNIQUEMENT quand ce fichier est lancé comme worker_thread (moteur.ts le fait). Importé (essais,
// banc), ce bloc dort. Il tient un réseau et un découpage, et répond aux ordres de la façade. L'arrêt passe par un
// drapeau en mémoire partagée (ctrl[0]) lu directement dans les boucles synchrones : il interrompt même un calcul en
// cours, sans attendre la boucle d'événements. Une erreur ici = journal + arrêt de Noûs, jamais d'Odin.
// ----------------------------------------------------------------------------------------------------------------

interface OrdreW { type: string; id?: number; [k: string]: unknown }

if (!isMainThread && parentPort) {
  demarrerWorker(parentPort);
}

function demarrerWorker(port: NonNullable<typeof parentPort>): void {
  let reseau: Reseau | undefined;
  let decoupage: { encoder(t: string): Int32Array; decoder(ids: ArrayLike<number>): string; vocab: number; version: number; arretId?: number } | undefined;
  let ctrl: Int32Array | undefined;
  const courbe: Array<{ pas: number; perte: number }> = [];
  let grainesCourbe = 0;
  // L'opération en cours d'exécution dans le worker. L'arrêt est demandé en posant ctrl[0] = identifiant de
  // l'opération (fait par la façade). Le worker ne s'arrête que si ctrl[0] vaut l'identifiant qu'il exécute :
  // une opération mise en file (identifiant différent) n'abandonne donc pas celle qui tourne.
  let genCourante = 0;
  const sig = { get aborted(): boolean { return ctrl ? Atomics.load(ctrl, 0) === genCourante : false; } };

  const repondre = (id: number | undefined, valeur: unknown, transfert?: ArrayBuffer[]): void => {
    port.postMessage({ type: 'reponse', id, valeur }, transfert ?? []);
  };
  const echouer = (id: number | undefined, e: unknown): void => {
    port.postMessage({ type: 'erreur', id, message: String((e as Error)?.message ?? e) });
  };

  port.on('message', (o: OrdreW) => {
    void traiter(o).catch((e) => echouer(o.id, e));
  });

  async function traiter(o: OrdreW): Promise<void> {
    // Le worker traite les ordres EN SÉRIE (seance() est synchrone et bloque le fil). On note l'identifiant de
    // l'opération qui commence : l'arrêt ne vaut que pour CET identifiant (défaut de course corrigé : la mise en
    // file d'une autre opération n'efface pas l'abandon de celle qui tourne). 'init' n'a pas de boucle interruptible.
    if (o.type !== 'init' && typeof o.id === 'number') genCourante = o.id;
    switch (o.type) {
      case 'init': {
        const hyper = o.hyper as Hyper;
        const poids = new Float32Array(o.sab as SharedArrayBuffer);
        reseau = new Reseau(hyper, poids);
        ctrl = new Int32Array(o.ctrl as SharedArrayBuffer);
        if (typeof o.fresh === 'number') reseau.initialiser(o.fresh);
        const mo = o.moments as { m: Float32Array; v: Float32Array; pas: number } | undefined;
        if (mo) reseau.importerMoments(mo.m, mo.v, mo.pas);
        grainesCourbe = (o.graine as number) ?? 0;
        const dec = await import('./decoupage.ts');
        decoupage = dec.lireDecoupageSerialise(o.decoupage as unknown as Parameters<typeof dec.lireDecoupageSerialise>[0]);
        if (Array.isArray(o.courbe)) courbe.push(...(o.courbe as Array<{ pas: number; perte: number }>));
        repondre(o.id, { pret: true });
        return;
      }
      case 'proposer': {
        if (!reseau || !decoupage) throw new Error('Noûs pas initialisé');
        const dmd = o.demande as { texte: string; maxMorceaux?: number; delaiMs?: number; graine?: number };
        const ids = decoupage.encoder(dmd.texte);
        const g = reseau.generer(ids, dmd.maxMorceaux ?? 64, { delaiMs: dmd.delaiMs, signal: sig, graine: dmd.graine, arretId: decoupage.arretId });
        repondre(o.id, { texte: decoupage.decoder(g.ids), confiance: g.confiance, logprob: g.logprob, morceaux: g.morceaux, tempsMs: g.tempsMs, pret: g.pret });
        return;
      }
      case 'completer': {
        if (!reseau || !decoupage) throw new Error('Noûs pas initialisé');
        const ids = decoupage.encoder(o.amorce as string);
        const g = reseau.generer(ids, (o.n as number) ?? 32, { delaiMs: o.delaiMs as number | undefined, signal: sig, graine: o.graine as number | undefined, arretId: decoupage.arretId });
        repondre(o.id, decoupage.decoder(g.ids));
        return;
      }
      case 'plonger': {
        if (!reseau || !decoupage) throw new Error('Noûs pas initialisé');
        const v = reseau.plonger(decoupage.encoder(o.texte as string));
        repondre(o.id, v, [v.buffer as ArrayBuffer]);
        return;
      }
      case 'score': {
        if (!reseau || !decoupage) throw new Error('Noûs pas initialisé');
        repondre(o.id, reseau.score(decoupage.encoder(o.demande as string), decoupage.encoder(o.reponse as string)));
        return;
      }
      case 'seance': {
        if (!reseau) throw new Error('Noûs pas initialisé');
        // L'arrêt : la façade pose ctrl[0] = identifiant de CETTE séance ; la boucle de seance() le lit via sig.
        const reglages = o.reglages as SeanceReglages;
        const av = seance(reseau, o.lots as LotBrut[], { ...reglages, signal: sig });
        if (av.pas > 0) courbe.push({ pas: reseau.pas, perte: av.perte });
        repondre(o.id, av);
        return;
      }
      case 'perteSur': {
        if (!reseau) throw new Error('Noûs pas initialisé');
        repondre(o.id, perteSur(reseau, o.jeu as Int32Array[]));
        return;
      }
      case 'ecrire': {
        if (!reseau || !decoupage) throw new Error('Noûs pas initialisé');
        const rep = await import('./reprise.ts');
        const mm = reseau.exporterMoments();
        const chemin = await rep.ecrireReprise(o.home as string, o.n as number, {
          hyper: reseau.hyper, decoupage: (await import('./decoupage.ts')).serialiserDecoupage(decoupage as unknown as Parameters<typeof import('./decoupage.ts').serialiserDecoupage>[0]),
          poids: reseau.poids, m: mm.m, v: mm.v, pas: mm.pas, graine: grainesCourbe, courbe,
        });
        repondre(o.id, chemin);
        return;
      }
      case 'revenirA': {
        if (!reseau) throw new Error('Noûs pas initialisé');
        const rep = await import('./reprise.ts');
        const ck = await rep.lireReprise(o.home as string, o.n as number | undefined);
        if (!ck) throw new Error('point de reprise introuvable');
        reseau.importerPoids(ck.poids); reseau.importerMoments(ck.m, ck.v, ck.pas);
        repondre(o.id, { pas: ck.pas });
        return;
      }
      case 'arreter': {
        repondre(o.id, { arrete: true });
        return;
      }
      default: throw new Error(`ordre inconnu : ${o.type}`);
    }
  }
}

/** Perte moyenne sur un jeu tenu à part (porte de qualité) — ne touche pas aux gradients. */
export function perteSur(r: Reseau, jeu: Int32Array[]): number {
  let s = 0, n = 0;
  for (const ids of jeu) {
    if (ids.length < 2) continue;
    const et = r.avant(ids, true); const logits = et.logits!; const V = r.disp.V;
    for (let t = 0; t < ids.length - 1; t++) {
      const cible = ids[t + 1] | 0, o = t * V;
      let mx = -Infinity; for (let vv = 0; vv < V; vv++) if (logits[o + vv] > mx) mx = logits[o + vv];
      let som = 0; for (let vv = 0; vv < V; vv++) som += Math.exp(logits[o + vv] - mx);
      s += (mx + Math.log(som)) - logits[o + cible]; n++;
    }
  }
  return n ? s / n : 0;
}
