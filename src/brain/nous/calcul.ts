// Le calcul de Noûs — un Transformer « décodeur seul » écrit à la main (fonctionnement public : attention causale,
// normalisation de couche, GELU, rétropropagation, AdamW), en Float32. Ce fichier a deux visages :
//   - importé (fil principal ou banc de mesure) : il expose la classe Reseau et la séance d'entraînement, synchrones,
//     reproductibles à la graine. Les essais s'en servent en direct.
//   - lancé comme worker (moteur.ts) : tout en bas, il répond aux messages de la façade (proposer, séance, écrire…),
//     de sorte que le calcul ne tourne JAMAIS sur le fil principal d'Odin.
//
// Tout le hasard passe par src/brain/nous/hasard.ts (aucun Math.random). Les produits de matrices passent par les
// noyaux de src/brain/nous/wasm.ts (WebAssembly SIMD, repli JavaScript). Aucun paquet, aucun serveur.

import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { formeDemande, formeReponse } from './etapes.ts';
import type { Hyper } from './tailles.ts';
import { hasard, graineDe, melange, type Hasard } from './hasard.ts';
import { noyaux, type Noyaux } from './wasm.ts';
import { attendreRegistre, gelActif, nouvellePart, registreTampons, rendrePart, rendreTout, Tampons } from './noyau-tampons.ts';

// ----------------------------------------------------------------------------------------------------------------
// Où tourne le calcul : LE point unique où se lit le choix « processeur » ou « carte graphique ».
// Aujourd'hui, seule la voie processeur existe : Node n'expose aucun accès au calcul sur carte graphique (pas de
// navigator.gpu, vérifié), et le propriétaire refuse toute dépendance. Demander la carte graphique ne casse rien : le
// calcul reste sur le processeur et le message le dit franchement.
// ----------------------------------------------------------------------------------------------------------------

export type VoieCalcul = 'processeur' | 'carte-graphique';
export interface ChoixCalcul { voie: 'processeur'; noyaux: Noyaux; /** Présent quand la voie demandée n'est pas celle qui tourne. */ message?: string }
export const MESSAGE_CARTE_GRAPHIQUE = 'Calcul sur la carte graphique non disponible : Odin tourne dans Node, qui ne donne aucun accès à la carte graphique pour le calcul. Soul calcule sur le processeur.';
/** Les noyaux de calcul selon la voie voulue (défaut : processeur). */
export function choisirCalcul(voulue: VoieCalcul = 'processeur'): ChoixCalcul {
  const k = noyaux();
  return voulue === 'carte-graphique' ? { voie: 'processeur', noyaux: k, message: MESSAGE_CARTE_GRAPHIQUE } : { voie: 'processeur', noyaux: k };
}

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

/** Les paramètres d'un pas AdamW (n : séquences accumulées ; c1, c2 : corrections de biais du pas). */
export interface ParamAdam { n: number; lr: number; b1: number; b2: number; eps: number; decay: number; c1: number; c2: number }
/** Les mémoires partagées des gradients et moments du fil de Noûs (séance sur plusieurs fils). */
export interface PartageAdam { g: SharedArrayBuffer; m: SharedArrayBuffer; v: SharedArrayBuffer }

/**
 * Un pas AdamW sur la tranche [a,b[ des poids, en ajoutant d'abord à G les gradients des aides `gs`, dans leur ordre
 * (mêmes arrondis Float32 que des ajouterGrad successifs). G est remis à zéro sur la tranche. Le résultat d'un élément ne
 * dépend que de cet élément : découper le travail en tranches (entre plusieurs fils) donne exactement le même calcul.
 */
export function adamTranche(P: Float32Array, G: Float32Array, M: Float32Array, Vm: Float32Array, gs: Float32Array[], a: number, b: number, p: ParamAdam): void {
  const { n, lr, b1, b2, eps, decay, c1, c2 } = p, fr = Math.fround;
  for (let i = a; i < b; i++) {
    let s = G[i];
    for (let k = 0; k < gs.length; k++) s = fr(s + gs[k][i]);
    const gi = s / n;
    const mi = M[i] = b1 * M[i] + (1 - b1) * gi;
    const vi = Vm[i] = b2 * Vm[i] + (1 - b2) * gi * gi;
    const mh = mi * c1, vh = vi * c2;
    P[i] -= lr * (mh / (Math.sqrt(vh) + eps) + decay * P[i]);
    G[i] = 0;
  }
}
/** Les bornes de la tranche j sur nf (alignées sur 16 flottants). */
function tranche(total: number, j: number, nf: number): [number, number] {
  const borne = (x: number): number => (x >= nf ? total : Math.floor((total * x) / nf) & ~15);
  return [borne(j), borne(j + 1)];
}

/** Un signal d'arrêt minimal : seul `aborted` compte (un vrai AbortSignal convient, un drapeau partagé aussi). */
export interface SignalArret { readonly aborted: boolean }
export interface GenOpts { maxMorceaux?: number; delaiMs?: number; signal?: SignalArret; graine?: number; temperature?: number; arretId?: number }
export interface GenSortie { ids: number[]; logprob: number; confiance: number; morceaux: number; tempsMs: number; pret: boolean }

/** Nombre de fenêtres de contexte lues au plus pour le plongement d'un long texte. */
const FENETRES_PLONGEMENT = 8;

/** Les `n` premiers morceaux d'une suite (la suite elle-même si elle tient déjà). */
function tete(ids: ArrayLike<number>, n: number): ArrayLike<number> {
  if (ids.length <= n) return ids;
  const out = new Int32Array(n); for (let i = 0; i < n; i++) out[i] = ids[i] | 0;
  return out;
}

/** `n` morceaux d'une suite à partir de `saut` (ce qui manque vaut 0). */
function queue(ids: ArrayLike<number>, saut: number, n: number): Int32Array {
  const out = new Int32Array(n); for (let i = 0; i < n; i++) out[i] = (ids[saut + i] ?? 0) | 0;
  return out;
}

/** L'arrêt demandé PENDANT le calcul d'une séquence (lu entre deux couches, à l'aller et au retour). */
export class ArretCalcul extends Error { constructor() { super('arrêt demandé pendant le calcul'); } }
const ARRET = new ArretCalcul();

export class Reseau {
  /** Le drapeau d'arrêt de la séance en cours (posé par la séance, retiré après) : lu entre deux couches. */
  arret?: { readonly aborted: boolean };
  private verifierArret(): void { if (this.arret?.aborted) throw ARRET; }
  readonly hyper: Hyper;
  readonly disp: Disposition;
  poids: Float32Array;
  grads: Float32Array;
  private m: Float32Array; // moment 1 (AdamW)
  private vMom: Float32Array; // moment 2
  pas = 0;
  private nAccum = 0; // nombre de séquences accumulées dans grads
  private noy: Noyaux;
  // Copies de travail des poids (dans la mémoire du noyau, ou transposées) : valables tant que `versionPoids` ne bouge
  // pas. Hors séance, chaque calcul public commence par un nouveau numéro (on ne sait pas qui a pu écrire dans
  // `poids`) ; pendant une séance (`gel` > 0), seuls pasAdamW, importerPoids, initialiser et poidsModifies le changent.
  private versionPoids = 0;
  private gel = 0;
  private transposees = new Map<string, { v: number; t: Float32Array }>();
  // Les tableaux intérieurs d'un calcul (états de la passe avant, gradients intermédiaires) : gardés en mémoire vive
  // d'une suite à l'autre DANS une portée (avecTampons), neufs hors portée. Voir noyau-tampons.ts.
  private tampons: Tampons;

  constructor(hyper: Hyper, poids?: Float32Array, noy?: Noyaux, o: { tampons?: boolean } = {}) {
    this.hyper = hyper;
    this.disp = disposition(hyper);
    this.poids = poids ?? new Float32Array(this.disp.total);
    this.grads = new Float32Array(this.disp.total);
    this.m = new Float32Array(this.disp.total);
    this.vMom = new Float32Array(this.disp.total);
    this.noy = noy ?? choisirCalcul().noyaux;
    this.tampons = new Tampons({ actif: o.tampons });
  }

  /** Un tableau intérieur de `n` zéros (tampon gardé dans une portée, neuf sinon). */
  private f32(n: number): Float32Array { return this.tampons.prendre(n); }
  /**
   * f() dans une portée de tampons : les tableaux intérieurs y resservent d'un appel à l'autre. Rien de ce que f rend
   * ne doit être un tableau intérieur du réseau (les calculs publics qui rendent des tableaux en allouent des neufs).
   */
  avecTampons<T>(f: () => T): T { return this.tampons.dans(f); }
  /** Rend la mémoire des tampons (elle se refera au besoin). */
  rendreTampons(): void { this.tampons.vider(); }
  /** Octets gardés par les tampons (essais, banc). */
  get etatTampons(): { tenus: number; reserves: number; tampons: number } { return this.tampons.etat; }

  /** Le noyau de calcul utilisé (« fma », « bloc », « ancien » ou « js »). */
  get modeNoyau(): string { return this.noy.mode; }
  /** À appeler après avoir écrit dans `poids` par un autre chemin que les méthodes du réseau (copies refaites). */
  poidsModifies(): void { this.versionPoids++; }
  /** Pendant une séance, les poids ne changent que par le réseau lui-même : les copies de travail restent valables. */
  figerPoids(): void { if (this.gel++ === 0) this.versionPoids++; }
  libererPoids(): void { if (this.gel > 0) this.gel--; }
  /** Début d'un calcul public : hors séance, les copies de travail sont refaites (les poids ont pu changer). */
  private entree(): void { if (this.gel === 0) this.versionPoids++; }

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
    this.versionPoids++;
  }

  // --- vues sur un tenseur de poids ---
  private t(off: number, len: number): Float32Array { return this.poids.subarray(off, off + len); }
  private g(off: number, len: number): Float32Array { return this.grads.subarray(off, off + len); }

  // --- produits de matrices via les noyaux ---
  private mm(c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void { this.noy.mm(c, a, b, M, K, N); }
  /**
   * C[M,N] = A[M,K]·W, où W est un tenseur de poids rangé [K,N] à `off` — ou, si `transp`, la transposée d'un tenseur
   * rangé [N,K]. La copie de W (dans la mémoire du noyau, ou transposée en JavaScript) est gardée sous le nom `nom` et
   * refaite seulement quand les poids changent (versionPoids).
   */
  private mmW(c: Float32Array, a: Float32Array, nom: string, off: number, M: number, K: number, N: number, transp = false): void {
    const len = K * N, noy = this.noy;
    const remplir = (dst: Float32Array): void => {
      if (transp) transpose(dst, this.poids.subarray(off, off + len), N, K); else dst.set(this.poids.subarray(off, off + len));
    };
    if (noy.resident && noy.mmResident) {
      const adr = noy.resident(this, nom, this.versionPoids, len, remplir);
      if (adr >= 0) { noy.mmResident(c, a, adr, M, K, N); return; }
    }
    if (!transp) { noy.mm(c, a, this.poids.subarray(off, off + len), M, K, N); return; }
    let e = this.transposees.get(nom);
    if (!e || e.t.length !== len) { e = { v: -1, t: new Float32Array(len) }; this.transposees.set(nom, e); }
    if (e.v !== this.versionPoids) { remplir(e.t); e.v = this.versionPoids; }
    noy.mm(c, a, e.t, M, K, N);
  }

  /**
   * Attention causale d'une couche, tête par tête, par deux produits de matrices : scores = Q·Kᵀ (mis à l'échelle,
   * softmax sur j ≤ i, zéro au-delà), puis sortie = P·V. Remplit p [H,T,T] (gardé pour la rétropropagation) et ao [T,C].
   */
  private attentionAvant(p: Float32Array, ao: Float32Array, q: Float32Array, k: Float32Array, v: Float32Array, T: number): void {
    const d = this.disp, C = d.C, H = d.H, hd = d.hd, inv = 1 / Math.sqrt(hd);
    const qh = this.f32(T * hd), khT = this.f32(hd * T), vh = this.f32(T * hd), oh = this.f32(T * hd);
    for (let hh = 0; hh < H; hh++) {
      const hoff = hh * hd, poff = hh * T * T;
      for (let i = 0; i < T; i++) {
        const src = i * C + hoff, dst = i * hd;
        for (let c = 0; c < hd; c++) { qh[dst + c] = q[src + c]; khT[c * T + i] = k[src + c]; vh[dst + c] = v[src + c]; }
      }
      const sc = p.subarray(poff, poff + T * T);
      this.mm(sc, qh, khT, T, hd, T);
      for (let i = 0; i < T; i++) {
        const o = i * T; let mx = -Infinity;
        for (let j = 0; j <= i; j++) { const s = sc[o + j] * inv; sc[o + j] = s; if (s > mx) mx = s; }
        let som = 0;
        for (let j = 0; j <= i; j++) { const e = Math.exp(sc[o + j] - mx); sc[o + j] = e; som += e; }
        const r = 1 / som;
        for (let j = 0; j <= i; j++) sc[o + j] *= r;
        for (let j = i + 1; j < T; j++) sc[o + j] = 0; // causal : rien du futur
      }
      this.mm(oh, sc, vh, T, T, hd);
      for (let i = 0; i < T; i++) { const src = i * hd, dst = i * C + hoff; for (let c = 0; c < hd; c++) ao[dst + c] = oh[src + c]; }
    }
  }

  /**
   * Rétropropagation de l'attention, tête par tête, par produits de matrices :
   *   dV = Pᵀ·dO ; dP = dO·Vᵀ ; dS = P ⊙ (dP − Σⱼ P·dP) / √hd (j ≤ i) ; dQ = dS·K ; dK = dSᵀ·Q.
   * dq, dk, dv sont neufs (à zéro) : chaque tête écrit ses propres colonnes.
   */
  private attentionArriere(dq: Float32Array, dk: Float32Array, dv: Float32Array, dAo: Float32Array, ec: EtatCouche, T: number): void {
    const d = this.disp, C = d.C, H = d.H, hd = d.hd, inv = 1 / Math.sqrt(hd);
    const dOh = this.f32(T * hd), vhT = this.f32(hd * T), qh = this.f32(T * hd), kh = this.f32(T * hd);
    const dp = this.f32(T * T), tT = this.f32(T * T), r = this.f32(T * hd);
    for (let hh = 0; hh < H; hh++) {
      const hoff = hh * hd, poff = hh * T * T;
      for (let i = 0; i < T; i++) {
        const src = i * C + hoff, dst = i * hd;
        for (let c = 0; c < hd; c++) { dOh[dst + c] = dAo[src + c]; vhT[c * T + i] = ec.v[src + c]; qh[dst + c] = ec.q[src + c]; kh[dst + c] = ec.k[src + c]; }
      }
      const P = ec.p.subarray(poff, poff + T * T);
      // dV = Pᵀ·dO
      transpose(tT, P, T, T);
      this.mm(r, tT, dOh, T, T, hd);
      for (let i = 0; i < T; i++) { const src = i * hd, dst = i * C + hoff; for (let c = 0; c < hd; c++) dv[dst + c] = r[src + c]; }
      // dP = dO·Vᵀ, puis dS (rangé dans dp)
      this.mm(dp, dOh, vhT, T, hd, T);
      for (let i = 0; i < T; i++) {
        const o = i * T; let dot = 0;
        for (let j = 0; j <= i; j++) dot += P[o + j] * dp[o + j];
        for (let j = 0; j <= i; j++) dp[o + j] = P[o + j] * (dp[o + j] - dot) * inv;
        for (let j = i + 1; j < T; j++) dp[o + j] = 0;
      }
      // dQ = dS·K
      this.mm(r, dp, kh, T, T, hd);
      for (let i = 0; i < T; i++) { const src = i * hd, dst = i * C + hoff; for (let c = 0; c < hd; c++) dq[dst + c] = r[src + c]; }
      // dK = dSᵀ·Q
      transpose(tT, dp, T, T);
      this.mm(r, tT, qh, T, T, hd);
      for (let i = 0; i < T; i++) { const src = i * hd, dst = i * C + hoff; for (let c = 0; c < hd; c++) dk[dst + c] = r[src + c]; }
    }
  }

  // ------------------------------------------------------------------------------------------------------------
  // Passe avant. avecLogits => calcule aussi les logits [T,V]. Renvoie l'état (gardé pour la rétropropagation).
  // ------------------------------------------------------------------------------------------------------------
  avant(ids: ArrayLike<number>, avecLogits: boolean): Etat {
    const d = this.disp, C = d.C, C4 = d.C4, H = d.H, hd = d.hd, V = d.V, T = ids.length;
    // Jamais plus de positions que le contexte : au-delà, la « position » se lirait — et, à l'entraînement,
    // s'écrirait — dans les poids de la première couche, rangés juste après la table des positions.
    if (T > d.T) throw new RangeError(`Noûs : suite de ${T} morceaux, le contexte en porte ${d.T}`);
    this.entree();
    const x0 = this.f32(T * C);
    for (let t = 0; t < T; t++) {
      const id = ids[t] | 0, we = d.wte + id * C, pe = d.wpe + t * C, xo = t * C;
      for (let c = 0; c < C; c++) x0[xo + c] = this.poids[we + c] + this.poids[pe + c];
    }
    let x = x0;
    const couches: EtatCouche[] = [];
    for (let l = 0; l < d.L; l++) {
      this.verifierArret();
      const cp = d.couches[l];
      const xEntree = x;
      // ln1
      const a = this.f32(T * C), m1 = this.f32(T), r1 = this.f32(T);
      this.layernorm(a, m1, r1, x, this.t(cp.ln1g, C), this.t(cp.ln1b, C), T, C);
      // q,k,v = a·W
      const q = this.f32(T * C), k = this.f32(T * C), v = this.f32(T * C);
      this.mmW(q, a, `wq${l}`, cp.wq, T, C, C);
      this.mmW(k, a, `wk${l}`, cp.wk, T, C, C);
      this.mmW(v, a, `wv${l}`, cp.wv, T, C, C);
      // attention causale par tête (produits de matrices)
      const p = this.f32(H * T * T), ao = this.f32(T * C);
      this.attentionAvant(p, ao, q, k, v, T);
      // o = ao·Wo ; x = x + o
      const o = this.f32(T * C);
      this.mmW(o, ao, `wo${l}`, cp.wo, T, C, C);
      const xMid = this.f32(T * C);
      for (let i = 0; i < T * C; i++) xMid[i] = xEntree[i] + o[i];
      // ln2
      const b = this.f32(T * C), m2 = this.f32(T), r2 = this.f32(T);
      this.layernorm(b, m2, r2, xMid, this.t(cp.ln2g, C), this.t(cp.ln2b, C), T, C);
      // ffn : h1 = b·W1 + b1 ; g = gelu(h1) ; f = g·W2 + b2 ; x = xMid + f
      const h1 = this.f32(T * C4);
      this.mmW(h1, b, `w1${l}`, cp.w1, T, C, C4);
      const b1 = this.t(cp.b1, C4);
      for (let i = 0; i < T; i++) for (let c = 0; c < C4; c++) h1[i * C4 + c] += b1[c];
      const gact = this.f32(T * C4);
      for (let i = 0; i < T * C4; i++) gact[i] = gelu(h1[i]);
      const f = this.f32(T * C);
      this.mmW(f, gact, `w2${l}`, cp.w2, T, C4, C);
      const b2 = this.t(cp.b2, C);
      const xNext = this.f32(T * C);
      for (let i = 0; i < T; i++) for (let c = 0; c < C; c++) xNext[i * C + c] = xMid[i * C + c] + f[i * C + c] + b2[c];
      couches.push({ xEntree, a, m1, r1, q, k, v, p, ao, xMid, b, m2, r2, h1, g: gact });
      x = xNext;
    }
    // ln finale
    const y = this.f32(T * C), mf = this.f32(T), rf = this.f32(T);
    this.layernorm(y, mf, rf, x, this.t(d.lnfg, C), this.t(d.lnfb, C), T, C);
    const et: Etat = { T, x0, couches, xFinal: x, mf, rf, y };
    if (avecLogits) {
      const logits = this.f32(T * V);
      this.mmW(logits, y, 'wteT', d.wte, T, C, V, true);
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
    const d = this.disp;
    // Plus long que le contexte : un texte courant garde son DÉBUT ; une paire « demande → réponse » (masque de rôles)
    // garde sa FIN — la réponse, la seule partie apprise — et perd le début de la demande. Couper le début d'une paire
    // ne laisserait rien à apprendre, sans le dire. (À l'appelant de découper mieux quand il le peut.)
    if (ids.length > d.T) {
      if (rolesMasque) { const saut = ids.length - d.T; rolesMasque = queue(rolesMasque, saut, d.T); ids = queue(ids, saut, d.T); }
      else ids = tete(ids, d.T);
    }
    const V = d.V, T = ids.length;
    // Rien à prédire (masque de rôles vide sur ce qui reste) : dit à part, jamais compté comme une perte nulle.
    if (rolesMasque) { let k = 0; for (let t = 0; t < T - 1 && !k; t++) if (rolesMasque[t]) k = 1; if (!k) return RIEN_A_APPRENDRE; }
    // Tout ce qui suit n'alloue que des tableaux intérieurs (rien n'en sort que la perte, et les gradients accumulés
    // dans this.grads) : ils resservent d'une suite à l'autre.
    const idsT = ids, masque = rolesMasque;
    return this.tampons.dans(() => this.perteEtGradCalcul(idsT, poidsExemple, masque, V, T));
  }

  private perteEtGradCalcul(ids: ArrayLike<number>, poidsExemple: number, rolesMasque: ArrayLike<number> | undefined, V: number, T: number): number {
    const et = this.avant(ids, true);
    this.verifierArret();
    const logits = et.logits!;
    const dLogits = this.f32(T * V);
    // Combien de positions à prédire : l'échelle (poids de l'exemple / nombre de prédictions) est connue d'avance, et
    // le gradient de chaque ligne s'écrit en UNE passe d'exponentielles : e = exp(x − max) gardé, puis e·(échelle/somme).
    let nPred = 0;
    for (let t = 0; t < T - 1; t++) if (!rolesMasque || rolesMasque[t]) nPred++;
    if (nPred === 0) return RIEN_A_APPRENDRE;
    const ech = (poidsExemple / nPred);
    let perte = 0;
    for (let t = 0; t < T - 1; t++) {
      if (rolesMasque && !rolesMasque[t]) continue;
      const cible = ids[t + 1] | 0, o = t * V;
      let mx = -Infinity; for (let vv = 0; vv < V; vv++) if (logits[o + vv] > mx) mx = logits[o + vv];
      let som = 0;
      for (let vv = 0; vv < V; vv++) { const e = Math.exp(logits[o + vv] - mx); dLogits[o + vv] = e; som += e; }
      perte += mx + Math.log(som) - logits[o + cible];
      const f = ech / som;
      for (let vv = 0; vv < V; vv++) dLogits[o + vv] *= f;
      dLogits[o + cible] -= ech;
    }
    this.retropropagation(ids, et, dLogits);
    this.nAccum += 1;
    return perte / nPred;
  }

  /** Rétropropagation complète : remplit this.grads (accumulation). dLogits déjà mis à l'échelle. */
  private retropropagation(ids: ArrayLike<number>, et: Etat, dLogits: Float32Array): void {
    const d = this.disp, C = d.C, C4 = d.C4, V = d.V, T = et.T;
    // tête de sortie : logits = y·wteᵀ
    const dY = this.f32(T * C);
    this.mmW(dY, dLogits, 'wte', d.wte, T, V, C); // dY = dLogits·wte
    // dWte (part « tête ») = dLogitsᵀ·y
    const dLogitsT = this.f32(V * T); transpose(dLogitsT, dLogits, T, V);
    const tmpVC = this.f32(V * C);
    this.mm(tmpVC, dLogitsT, et.y, V, T, C);
    this.ajoute(this.g(d.wte, V * C), tmpVC, V * C);
    // ln finale
    const dxF = this.f32(T * C);
    this.dLayernorm(dxF, this.g(d.lnfg, C), this.g(d.lnfb, C), dY, et.xFinal, et.mf, et.rf, this.t(d.lnfg, C), T, C);
    let dx = dxF;
    for (let l = d.L - 1; l >= 0; l--) {
      this.verifierArret();
      const cp = d.couches[l], ec = et.couches[l];
      // --- FFN ---
      // x = xMid + f + b2 ; dxMid += dx ; df = dx ; db2 = somme dx
      const df = dx; // [T,C]
      const db2 = this.g(cp.b2, C); for (let i = 0; i < T; i++) for (let c = 0; c < C; c++) db2[c] += df[i * C + c];
      // f = g·W2 ; dG = df·W2ᵀ ; dW2 = gᵀ·df
      const dG = this.f32(T * C4); this.mmW(dG, df, `w2T${l}`, cp.w2, T, C, C4, true);
      const gT = this.f32(C4 * T); transpose(gT, ec.g, T, C4);
      const dW2 = this.f32(C4 * C); this.mm(dW2, gT, df, C4, T, C); this.ajoute(this.g(cp.w2, C4 * C), dW2, C4 * C);
      // g = gelu(h1) ; dH1 = dG * gelu'(h1)
      const dH1 = this.f32(T * C4); for (let i = 0; i < T * C4; i++) dH1[i] = dG[i] * dgelu(ec.h1[i]);
      // h1 = b·W1 + b1 ; db1 = somme dH1 ; dB = dH1·W1ᵀ ; dW1 = bᵀ·dH1
      const db1 = this.g(cp.b1, C4); for (let i = 0; i < T; i++) for (let c = 0; c < C4; c++) db1[c] += dH1[i * C4 + c];
      const dB = this.f32(T * C); this.mmW(dB, dH1, `w1T${l}`, cp.w1, T, C4, C, true);
      const bT = this.f32(C * T); transpose(bT, ec.b, T, C);
      const dW1 = this.f32(C * C4); this.mm(dW1, bT, dH1, C, T, C4); this.ajoute(this.g(cp.w1, C * C4), dW1, C * C4);
      // ln2 : dB -> dxMid (plus le résidu df qui va aussi vers xMid)
      const dxMid = this.f32(T * C);
      this.dLayernorm(dxMid, this.g(cp.ln2g, C), this.g(cp.ln2b, C), dB, ec.xMid, ec.m2, ec.r2, this.t(cp.ln2g, C), T, C);
      for (let i = 0; i < T * C; i++) dxMid[i] += df[i]; // résidu du bloc FFN
      // --- Attention ---
      // xMid = xEntree + o ; dxEntree += dxMid ; do = dxMid
      const doo = dxMid; // [T,C]
      // o = ao·Wo ; dAo = do·Woᵀ ; dWo = aoᵀ·do
      const dAo = this.f32(T * C); this.mmW(dAo, doo, `woT${l}`, cp.wo, T, C, C, true);
      const aoT = this.f32(C * T); transpose(aoT, ec.ao, T, C);
      const dWo = this.f32(C * C); this.mm(dWo, aoT, doo, C, T, C); this.ajoute(this.g(cp.wo, C * C), dWo, C * C);
      // attention : remonter dAo vers dq, dk, dv (produits de matrices, tête par tête)
      const dq = this.f32(T * C), dk = this.f32(T * C), dv = this.f32(T * C);
      this.attentionArriere(dq, dk, dv, dAo, ec, T);
      // q = a·Wq (idem k, v) : dA += dq·Wqᵀ + dk·Wkᵀ + dv·Wvᵀ ; dWq = aᵀ·dq …
      const aT = this.f32(C * T); transpose(aT, ec.a, T, C);
      const dA = this.f32(T * C);
      const tmp = this.f32(T * C), dW = this.f32(C * C);
      const ajouteProjArriere = (nom: string, W: number, dOut: Float32Array): void => {
        this.mmW(tmp, dOut, nom, W, T, C, C, true); for (let i = 0; i < T * C; i++) dA[i] += tmp[i];
        this.mm(dW, aT, dOut, C, T, C); this.ajoute(this.g(W, C * C), dW, C * C);
      };
      ajouteProjArriere(`wqT${l}`, cp.wq, dq); ajouteProjArriere(`wkT${l}`, cp.wk, dk); ajouteProjArriere(`wvT${l}`, cp.wv, dv);
      // ln1 : dA -> dxEntree (plus le résidu doo)
      const dxEntree = this.f32(T * C);
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
    const p = this.ouvrirPas(this.nAccum, lr, b1, b2, eps, decay);
    adamTranche(this.poids, this.grads, this.m, this.vMom, [], 0, this.grads.length, p);
    this.fermerPas();
  }
  /** Début d'un pas AdamW (compteur de pas, corrections de biais) pour `n` séquences accumulées en tout. */
  ouvrirPas(n: number, lr: number, b1 = 0.9, b2 = 0.999, eps = 1e-8, decay = 0.01): ParamAdam {
    this.pas += 1; const t = this.pas;
    return { n, lr, b1, b2, eps, decay, c1: 1 / (1 - Math.pow(b1, t)), c2: 1 / (1 - Math.pow(b2, t)) };
  }
  /** Fin d'un pas AdamW : gradients oubliés (adamTranche les a remis à zéro), copies de travail des poids à refaire. */
  fermerPas(): void { this.nAccum = 0; this.versionPoids++; }
  /** Nombre de séquences accumulées dans les gradients. */
  get accumulees(): number { return this.nAccum; }
  /** Oublie les gradients accumulés sans toucher aux poids (ex. après une interruption). */
  jeterGrad(): void { this.grads.fill(0); this.nAccum = 0; }
  /** Ajoute des gradients calculés ailleurs (un fil d'aide) pour `n` séquences. */
  ajouterGrad(g: Float32Array, n: number): void { const G = this.grads; for (let i = 0; i < G.length; i++) G[i] += g[i]; this.nAccum += n; }
  /** Gradients rangés dans une mémoire partagée (fil d'aide : le fil principal de Noûs les lit sans copie). */
  partagerGrad(sab: SharedArrayBuffer): void { this.grads = new Float32Array(sab); }
  /**
   * Gradients et moments AdamW rangés dans des mémoires partagées (valeurs actuelles recopiées) : les fils d'aide
   * peuvent alors faire leur tranche de l'addition des gradients et du pas AdamW.
   */
  partagerEtat(p: PartageAdam): void {
    if (this.grads.buffer === p.g) return;
    const g = new Float32Array(p.g), m = new Float32Array(p.m), v = new Float32Array(p.v);
    g.set(this.grads); m.set(this.m); v.set(this.vMom);
    this.grads = g; this.m = m; this.vMom = v;
  }
  /** Les tableaux d'AdamW (usage interne : la séance sur plusieurs fils). */
  etatAdam(): { P: Float32Array; G: Float32Array; M: Float32Array; V: Float32Array } { return { P: this.poids, G: this.grads, M: this.m, V: this.vMom }; }

  // ------------------------------------------------------------------------------------------------------------
  // Plongement : moyenne de la sortie normalisée finale. [C]
  // ------------------------------------------------------------------------------------------------------------
  plonger(ids: ArrayLike<number>): Float32Array {
    // Un texte plus long que le contexte est lu par fenêtres ; le vecteur est la moyenne de toutes les positions lues.
    // Au-delà de FENETRES_PLONGEMENT fenêtres, la fin n'est pas lue (coût borné).
    const d = this.disp, C = d.C, T = Math.min(ids.length, d.T * FENETRES_PLONGEMENT);
    const out = new Float32Array(C);
    if (T === 0) return out;
    // Les poids ne changent pas d'une fenêtre à l'autre : leurs copies de travail sont faites une fois pour l'appel.
    this.figerPoids();
    try {
      for (let debut = 0; debut < T; debut += d.T) {
        const n = Math.min(d.T, T - debut);
        const fen = new Int32Array(n); for (let i = 0; i < n; i++) fen[i] = ids[debut + i] | 0;
        // Une portée par fenêtre : l'état de la passe avant est lu ici, puis ses tampons resservent.
        this.tampons.dans(() => {
          const et = this.avant(fen, false);
          for (let t = 0; t < n; t++) for (let c = 0; c < C; c++) out[c] += et.y[t * C + c];
        });
      }
    } finally { this.libererPoids(); }
    for (let c = 0; c < C; c++) out[c] /= T;
    return out;
  }

  /** Log-probabilité moyenne par morceau de `reponse` sachant `demande` (préférence du duel). */
  score(demande: ArrayLike<number>, reponse: ArrayLike<number>): number {
    const d = this.disp, V = d.V;
    const dem = Array.from(demande, (x) => x | 0), rep = Array.from(reponse, (x) => x | 0);
    if (rep.length === 0) return 0;
    // La réponse est gardée ; c'est la demande qu'on coupe, par la gauche, quand l'ensemble dépasse le contexte. Sinon
    // une longue demande chassait la réponse, et le score valait 0 — la meilleure note — quelle que soit la réponse.
    const repU = rep.slice(0, d.T - 1), demU = dem.slice(-Math.max(1, d.T - repU.length));
    const ids = [...demU, ...repU];
    const et = this.avant(ids, true);
    const logits = et.logits!;
    let somme = 0, n = 0;
    const debut = Math.min(demU.length, ids.length) - 1; // la 1re cible de réponse est prédite depuis la dernière position de la demande
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
    const d = this.disp, C = d.C, V = d.V;
    if (ids.length > d.T) ids = Array.prototype.slice.call(ids, -d.T) as number[]; // les derniers morceaux, comme generer()
    const T = ids.length;
    const et = this.avant(ids, false);
    const out = new Float32Array(V);
    const yLast = et.y.subarray((T - 1) * C, T * C);
    this.mmW(out, yLast, 'wteT', d.wte, 1, C, V, true);
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
    this.entree(); // la tête et les poids sont recopiés une fois pour toute la réponse
    // traite la position `pos` avec le jeton `id` ; renvoie les logits de cette position.
    const etape = (id: number): Float32Array => {
      const x = new Float32Array(C);
      for (let c = 0; c < C; c++) x[c] = this.poids[d.wte + id * C + c] + this.poids[d.wpe + pos * C + c];
      for (let l = 0; l < L; l++) {
        const cp = d.couches[l];
        const a = new Float32Array(C); this.lnVec(a, x, this.t(cp.ln1g, C), this.t(cp.ln1b, C), C);
        const q = new Float32Array(C), k = new Float32Array(C), v = new Float32Array(C);
        this.mmW(q, a, `wq${l}`, cp.wq, 1, C, C);
        this.mmW(k, a, `wk${l}`, cp.wk, 1, C, C);
        this.mmW(v, a, `wv${l}`, cp.wv, 1, C, C);
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
        const oo = new Float32Array(C); this.mmW(oo, ao, `wo${l}`, cp.wo, 1, C, C);
        for (let c = 0; c < C; c++) x[c] += oo[c];
        const b = new Float32Array(C); this.lnVec(b, x, this.t(cp.ln2g, C), this.t(cp.ln2b, C), C);
        const h1 = new Float32Array(d.C4); this.mmW(h1, b, `w1${l}`, cp.w1, 1, C, d.C4);
        const b1 = this.t(cp.b1, d.C4); for (let c = 0; c < d.C4; c++) h1[c] = gelu(h1[c] + b1[c]);
        const f = new Float32Array(C); this.mmW(f, h1, `w2${l}`, cp.w2, 1, d.C4, C);
        const b2 = this.t(cp.b2, C); for (let c = 0; c < C; c++) x[c] += f[c] + b2[c];
      }
      const y = new Float32Array(C); this.lnVec(y, x, this.t(d.lnfg, C), this.t(d.lnfb, C), C);
      const logits = new Float32Array(V); this.mmW(logits, y, 'wteT', d.wte, 1, C, V, true);
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
    this.entree();
    let logits = new Float32Array(V);
    for (let pos = 0; pos < T; pos++) {
      const id = ids[pos] | 0;
      const x = new Float32Array(C);
      for (let c = 0; c < C; c++) x[c] = this.poids[d.wte + id * C + c] + this.poids[d.wpe + pos * C + c];
      for (let l = 0; l < L; l++) {
        const cp = d.couches[l];
        const a = new Float32Array(C); this.lnVec(a, x, this.t(cp.ln1g, C), this.t(cp.ln1b, C), C);
        const q = new Float32Array(C), k = new Float32Array(C), v = new Float32Array(C);
        this.mmW(q, a, `wq${l}`, cp.wq, 1, C, C); this.mmW(k, a, `wk${l}`, cp.wk, 1, C, C); this.mmW(v, a, `wv${l}`, cp.wv, 1, C, C);
        for (let c = 0; c < C; c++) { Kc[l][pos * C + c] = k[c]; Vc[l][pos * C + c] = v[c]; }
        const ao = new Float32Array(C);
        for (let hh = 0; hh < H; hh++) {
          const hoff = hh * hd; let mx = -Infinity; const sc = new Float32Array(pos + 1);
          for (let j = 0; j <= pos; j++) { let s = 0; for (let c = 0; c < hd; c++) s += q[hoff + c] * Kc[l][j * C + hoff + c]; s *= inv; sc[j] = s; if (s > mx) mx = s; }
          let som = 0; for (let j = 0; j <= pos; j++) { sc[j] = Math.exp(sc[j] - mx); som += sc[j]; }
          const r = 1 / som; for (let j = 0; j <= pos; j++) sc[j] *= r; // normalise, puis somme pondérée (même ordre que la passe complète)
          for (let c = 0; c < hd; c++) { let s = 0; for (let j = 0; j <= pos; j++) s += sc[j] * Vc[l][j * C + hoff + c]; ao[hoff + c] = s; }
        }
        const oo = new Float32Array(C); this.mmW(oo, ao, `wo${l}`, cp.wo, 1, C, C);
        for (let c = 0; c < C; c++) x[c] += oo[c];
        const b = new Float32Array(C); this.lnVec(b, x, this.t(cp.ln2g, C), this.t(cp.ln2b, C), C);
        const h1 = new Float32Array(d.C4); this.mmW(h1, b, `w1${l}`, cp.w1, 1, C, d.C4);
        const b1 = this.t(cp.b1, d.C4); for (let c = 0; c < d.C4; c++) h1[c] = gelu(h1[c] + b1[c]);
        const f = new Float32Array(C); this.mmW(f, h1, `w2${l}`, cp.w2, 1, d.C4, C);
        const b2 = this.t(cp.b2, C); for (let c = 0; c < C; c++) x[c] += f[c] + b2[c];
      }
      const y = new Float32Array(C); this.lnVec(y, x, this.t(d.lnfg, C), this.t(d.lnfb, C), C);
      logits = new Float32Array(V); this.mmW(logits, y, 'wteT', d.wte, 1, C, V, true);
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
  importerPoids(p: Float32Array): void { if (p.length !== this.disp.total) throw new Error('taille de poids incompatible'); this.poids.set(p); this.versionPoids++; }
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
export interface SeanceReglages { dureeMs: number; signal?: SignalArret; graine: number; lr?: number; tailleLot?: number; maxPas?: number; fils?: number }
export interface AvanceeBrute { pas: number; morceauxVus: number; perte: number; tempsMs: number; interrompue: boolean; /** Exemples qui n'avaient rien à apprendre (comptés à part : ni dans la perte, ni dans le pas). */ sansCible?: number }

/** Déroule une séance : accumule `tailleLot` séquences, fait un pas AdamW, recommence jusqu'à épuisement/temps/signal. */
export function seance(r: Reseau, lots: Iterable<LotBrut>, o: SeanceReglages): AvanceeBrute {
  const t0 = performance.now();
  const lr = o.lr ?? 3e-4, tailleLot = o.tailleLot ?? 8;
  const h = hasard(o.graine);
  let pas = 0, morceaux = 0, perteTot = 0, perteN = 0, interrompue = false, sansCible = 0;
  // rassemble toutes les séquences (avec leur rôle/poids) en une liste, puis mélange à la graine.
  const items: Array<{ ids: Int32Array; role?: Int32Array; poids: number }> = [];
  for (const lot of lots) {
    for (let i = 0; i < lot.entrees.length; i++) items.push({ ids: lot.entrees[i], role: lot.roles?.[i], poids: lot.poidsExemple?.[i] ?? 1 });
  }
  if (items.length === 0) return { pas: 0, morceauxVus: 0, perte: 0, tempsMs: performance.now() - t0, interrompue: false };
  const ordre = melange(items.length, h);
  let idx = 0;
  // L'arrêt est lu aussi PENDANT le calcul d'une séquence (entre deux couches) : Odin reprend la main plus vite.
  // Pendant la séance, seul le réseau touche à ses poids : leurs copies de travail servent d'un pas à l'autre.
  r.arret = o.signal;
  r.figerPoids();
  try {
  while (true) {
    if (o.signal?.aborted) { interrompue = true; r.jeterGrad(); break; }
    if (performance.now() - t0 > o.dureeMs) break;
    if (o.maxPas && pas >= o.maxPas) break;
    let dansLot = 0, lotSain = true;
    const perteAvantLot = perteN;
    for (; dansLot < tailleLot && idx < ordre.length; idx++, dansLot++) {
      const it = items[ordre[idx]];
      if (it.ids.length < 2) continue;
      let p: number;
      try { p = r.perteEtGrad(it.ids, it.poids, it.role); } catch (e) { if (e instanceof ArretCalcul) { interrompue = true; break; } throw e; }
      if (p === RIEN_A_APPRENDRE) { sansCible++; continue; }
      if (Number.isFinite(p)) { perteTot += p; perteN++; } else lotSain = false; // divergence : lot écarté
      morceaux += it.ids.length;
      if (o.signal?.aborted) { interrompue = true; break; }
    }
    if (interrompue) { r.jeterGrad(); break; }
    // NE JAMAIS EMPIRER : un lot à la perte infinie/non numérique n'est pas appliqué (les poids restent intacts).
    if (!lotSain) { r.jeterGrad(); }
    else if (perteN > perteAvantLot) { r.pasAdamW(lr); pas++; }
    else r.jeterGrad();
    if (idx >= ordre.length) break; // un seul passage sur les données par séance
  }
  } finally { r.arret = undefined; r.libererPoids(); }
  return { pas, morceauxVus: morceaux, perte: perteN ? perteTot / perteN : 0, tempsMs: performance.now() - t0, interrompue, sansCible };
}

// ----------------------------------------------------------------------------------------------------------------
// Séance sur PLUSIEURS FILS (réglage de puissance) : parallélisme de données SYNCHRONE. À chaque pas, le lot est
// partagé entre le fil de Noûs et ses fils d'aide ; chacun calcule les gradients de sa part sur les MÊMES poids (lus
// en mémoire partagée, personne ne les modifie pendant ce temps) ; le fil de Noûs additionne, dans un ordre fixe, puis
// fait UN pas AdamW. Le résultat est celui d'un seul fil sur le même lot (à l'ordre des additions près). Le lot vaut
// le multiple du nombre de fils le plus proche de 8 séquences (chaque fil a la même part). L'arrêt (drapeau
// partagé) est lu entre deux séquences, par chaque fil.
// Le pas lui-même (addition des gradients des aides + AdamW) est aussi RÉPARTI : chaque fil fait sa tranche des poids,
// avec les mêmes paramètres ; un élément ne dépend que de lui-même, le résultat est donc identique à un seul fil.
// ----------------------------------------------------------------------------------------------------------------

/** Les fils d'aide d'un réseau, et leur mémoire de synchronisation. */
export interface Aides {
  n: number;
  workers: Worker[];
  sync: Int32Array;      // [0] génération ; [1] fin de séance ; puis par aide k : [2+4k] début, [3+4k] nombre, [4+4k] fait, [5+4k] dans la séance
  res: Float64Array;     // par aide k : [4k] somme des pertes, [4k+1] séquences finies, [4k+2] séquences en tout, [4k+3] sans cible
  grads: Float32Array[]; // les gradients de chaque aide (mémoire partagée)
  /** Pas réparti (absent : le fil de Noûs fait tout le pas, comme avant) : gradients et moments du fil de Noûs en mémoire
   *  partagée ; ordre[0] = numéro de génération du pas en cours (0 : aucun pas), ordre[1+k] = pas fait par l'aide k ;
   *  parametres : n, lr, b1, b2, eps, decay, c1, c2. */
  reparti?: { partage: PartageAdam; ordre: Int32Array; parametres: Float64Array };
  /** Une aide n'a pas répondu (morte, mémoire épuisée) : ces aides ne servent plus, elles sont relancées. */
  cassees?: boolean;
  /** La mémoire des poids que lisent (et, pour le pas réparti, écrivent) les aides. */
  poids?: SharedArrayBuffer;
  /** Par aide : la case où elle tient sa part des tampons (rendue par arreterAides). */
  parts?: SharedArrayBuffer[];
}
/** Le rôle donné au worker du moteur (moteur.ts) : seul un fil de ce rôle écoute les ordres du moteur. */
export const ROLE_MOTEUR = 'noos-moteur';
/** Ce que rend perteEtGrad quand un exemple n'a rien à apprendre (une perte est toujours ≥ 0) : compté à part. */
export const RIEN_A_APPRENDRE = -1;
/**
 * La version du CALCUL des plongements, mêlée à l'étiquette des vecteurs (« noos-v<n>-p<k> ») : quand elle change, la
 * mémoire refait ses vecteurs même si le point de reprise est le même. 1 : sans borne au contexte ; 2 : moyenne par
 * fenêtres (défaut 1 corrigé).
 */
export const VERSION_PLONGEMENT = 2;
/** Le temps maximal d'attente d'une aide pour sa part d'un pas (une part prend quelques secondes au plus). */
export let DELAI_AIDE_MS = 30_000;
/** (essais) raccourcit l'attente d'une aide. */
export function reglerDelaiAide(ms: number): void { DELAI_AIDE_MS = Math.max(50, ms); }
const SYNC = (k: number): number => 2 + 4 * k;

/** Lance `n` fils d'aide sur les poids partagés `sab` (et le drapeau d'arrêt `ctrl`). */
export function lancerAides(hyper: Hyper, sab: SharedArrayBuffer, ctrl: SharedArrayBuffer | undefined, n: number): Aides {
  const total = disposition(hyper).total;
  const sync = new Int32Array(new SharedArrayBuffer(4 * (2 + 4 * n)));
  const res = new Float64Array(new SharedArrayBuffer(8 * 4 * n));
  const grads: Float32Array[] = [], workers: Worker[] = [];
  const partage: PartageAdam = { g: new SharedArrayBuffer(total * 4), m: new SharedArrayBuffer(total * 4), v: new SharedArrayBuffer(total * 4) };
  const ordre = new Int32Array(new SharedArrayBuffer(4 * (1 + n))), parametres = new Float64Array(new SharedArrayBuffer(8 * 8));
  for (let k = 0; k < n; k++) grads.push(new Float32Array(new SharedArrayBuffer(total * 4)));
  const tousG = grads.map((g) => g.buffer as SharedArrayBuffer);
  // Les tampons de chaque aide sont comptés dans le registre partagé de ce fil (noyau-tampons.ts), case par case.
  const registre = registreTampons(), parts = Array.from({ length: n }, () => nouvellePart());
  for (let k = 0; k < n; k++) {
    const g = tousG[k];
    const w = new Worker(new URL(import.meta.url), { name: `noos-aide-${k}`, workerData: { role: 'aide', k, hyper, sab, g, sync: sync.buffer, res: res.buffer, ctrl, reparti: { partage, ordre: ordre.buffer, parametres: parametres.buffer, tousG }, registreTampons: registre, partTampons: parts[k] }, resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 } });
    w.unref(); w.on('error', (e) => { console.error(`[noos] un fil d'aide s'est arrêté : ${String((e as Error)?.message ?? e)}`); });
    workers.push(w);
  }
  return { n, workers, sync, res, grads, reparti: { partage, ordre, parametres }, poids: sab, parts };
}
/** Arrête les fils d'aide ; ce qu'ils tenaient encore en tampons est rendu au compte. */
export async function arreterAides(a: Aides | undefined): Promise<void> {
  if (!a) return;
  Atomics.store(a.sync, 1, 1); Atomics.add(a.sync, 0, 1); Atomics.notify(a.sync, 0);
  await Promise.all(a.workers.map((w) => w.terminate().catch(() => 0)));
  for (const p of a.parts ?? []) rendrePart(p);
}

/** Une séance sur 1 + aides.n fils. Mêmes règles que seance() : interruptible, un lot malsain n'est pas appliqué. */
export async function seanceParallele(r: Reseau, lots: Iterable<LotBrut>, o: SeanceReglages, aides: Aides): Promise<AvanceeBrute> {
  const t0 = performance.now();
  const lr = o.lr ?? 3e-4, nf = aides.n + 1;
  const parFil = Math.max(1, Math.round((o.tailleLot ?? 8) / nf)), tailleLot = parFil * nf;
  const h = hasard(o.graine);
  const items: Array<{ ids: Int32Array; role?: Int32Array; poids: number }> = [];
  for (const lot of lots) for (let i = 0; i < lot.entrees.length; i++) items.push({ ids: lot.entrees[i], role: lot.roles?.[i], poids: lot.poidsExemple?.[i] ?? 1 });
  if (items.length === 0) return { pas: 0, morceauxVus: 0, perte: 0, tempsMs: performance.now() - t0, interrompue: false };
  const ordre = melange(items.length, h);
  const enOrdre = Array.from(ordre, (i) => items[i]);
  const { sync, res } = aides;
  // Le pas réparti suppose que les aides écrivent dans les poids mêmes du réseau ; sinon le fil de Noûs fait tout le
  // pas (comme avant), et rien n'est perdu.
  const reparti = aides.reparti && aides.poids && r.poids.buffer === aides.poids ? aides.reparti : undefined;
  // Une aide encore dans la séance précédente (réveillée en retard) ne doit jamais voir la fin de séance effacée : on
  // attend que chacune l'ait quittée avant de rouvrir. Une aide qui ne la quitte pas : les aides sont à relancer.
  const enSeance = (k: number): boolean => Atomics.load(sync, SYNC(k) + 3) !== 0;
  // L'arrêt demandé pendant ces attentes rend la main tout de suite (séance vide, interrompue).
  const vide = (): AvanceeBrute => ({ pas: 0, morceauxVus: 0, perte: 0, tempsMs: performance.now() - t0, interrompue: true });
  if (!await attendreAides(aides, (k) => !enSeance(k), 'un fil d\'aide ne répond plus (il n\'a pas quitté la séance précédente)', o.signal)) return vide();
  Atomics.store(sync, 1, 0);
  // Chaque aide reçoit les séquences (dans l'ordre de passage) et répond « dans la séance ».
  const gen0 = Atomics.load(sync, 0);
  for (let k = 0; k < aides.n; k++) aides.workers[k].postMessage({ type: 'seance', items: enOrdre, gen: gen0 });
  let pretes: boolean;
  try { pretes = await attendreAides(aides, enSeance, 'un fil d\'aide ne répond pas', o.signal); }
  catch (e) { finSeance(aides); throw e; }
  if (!pretes) { finSeance(aides); return vide(); }
  let pas = 0, morceaux = 0, perteTot = 0, perteN = 0, interrompue = false, idx = 0, sansCible = 0;
  if (reparti) r.partagerEtat(reparti.partage);
  r.arret = o.signal;
  r.figerPoids();
  try {
    while (idx < enOrdre.length) {
      if (o.signal?.aborted) { interrompue = true; break; }
      if (performance.now() - t0 > o.dureeMs) break;
      if (o.maxPas && pas >= o.maxPas) break;
      const debut = idx, fin = Math.min(enOrdre.length, idx + tailleLot); idx = fin;
      const perteAvantPas = perteN;
      // Les parts : le fil de Noûs prend la première, l'aide k la (k+2)-ième.
      const gen = Atomics.load(sync, 0) + 1;
      if (reparti) Atomics.store(reparti.ordre, 0, 0); // ordre de calcul (aucun pas en cours)
      for (let k = 0; k < aides.n; k++) {
        const a = Math.min(fin, debut + parFil * (k + 1)), b = Math.min(fin, a + parFil);
        Atomics.store(sync, SYNC(k), a); Atomics.store(sync, SYNC(k) + 1, b - a);
      }
      Atomics.store(sync, 0, gen); Atomics.notify(sync, 0);
      let sain = true;
      for (let i = debut; i < Math.min(fin, debut + parFil); i++) {
        if (o.signal?.aborted) { interrompue = true; break; }
        const it = enOrdre[i]; if (it.ids.length < 2) continue;
        let p: number;
        try { p = r.perteEtGrad(it.ids, it.poids, it.role); } catch (e) { if (e instanceof ArretCalcul) { interrompue = true; break; } throw e; }
        if (p === RIEN_A_APPRENDRE) { sansCible++; continue; }
        if (Number.isFinite(p)) { perteTot += p; perteN++; } else sain = false;
        morceaux += it.ids.length;
      }
      // Attendre chaque aide (ils lisent le même drapeau d'arrêt : au pire une séquence de retard). Jamais sans fin : une
      // aide qui ne rend pas sa part en DELAI_AIDE_MS (morte, mémoire épuisée) fait abandonner la séance avec une erreur ;
      // le drapeau d'arrêt est lu aussi (Odin doit pouvoir s'arrêter, même si une aide est morte).
      const attente0 = performance.now();
      for (let k = 0; k < aides.n; k++) {
        let fait = Atomics.load(sync, SYNC(k) + 2);
        while (fait !== gen) {
          Atomics.wait(sync, SYNC(k) + 2, fait, 50); fait = Atomics.load(sync, SYNC(k) + 2);
          if (fait === gen) break;
          if (o.signal?.aborted) { interrompue = true; break; }
          if (performance.now() - attente0 > DELAI_AIDE_MS) { aides.cassees = true; r.jeterGrad(); throw new Error('un fil d\'aide ne répond plus (arrêté ou à court de mémoire) : la séance est abandonnée, les aides seront relancées'); }
        }
        if (interrompue) break;
      }
      if (o.signal?.aborted) interrompue = true;
      if (interrompue) { r.jeterGrad(); break; }
      let nTotal = r.accumulees;
      for (let k = 0; k < aides.n; k++) {
        const somme = res[4 * k], finies = res[4 * k + 1], tout = res[4 * k + 2];
        sansCible += res[4 * k + 3];
        if (finies < tout) sain = false;
        perteTot += somme; perteN += finies;
        const a = Atomics.load(sync, SYNC(k)), nseq = Atomics.load(sync, SYNC(k) + 1);
        for (let i = a; i < a + nseq; i++) morceaux += enOrdre[i]?.ids.length ?? 0;
        if (!reparti && tout > 0) r.ajouterGrad(aides.grads[k], tout);
        nTotal += tout;
      }
      if (!sain || perteN === perteAvantPas) r.jeterGrad();
      else if (!reparti) { r.pasAdamW(lr); pas++; }
      else if (nTotal > 0) { pasReparti(r, aides, reparti, nTotal, lr); pas++; }
      else r.jeterGrad();
    }
  } finally {
    // Fin de séance : les aides retournent attendre la suivante.
    r.arret = undefined; r.libererPoids();
    finSeance(aides);
  }
  return { pas, morceauxVus: morceaux, perte: perteN ? perteTot / perteN : 0, tempsMs: performance.now() - t0, interrompue, sansCible };
}

/** Fin de séance : plus aucun ordre « pas » en place, PUIS la fin est posée et les aides réveillées. */
function finSeance(aides: Aides): void {
  if (aides.reparti) Atomics.store(aides.reparti.ordre, 0, 0);
  Atomics.store(aides.sync, 1, 1); Atomics.add(aides.sync, 0, 1); Atomics.notify(aides.sync, 0);
}
/**
 * Attend que `pret(k)` soit vrai pour chaque aide, au plus DELAI_AIDE_MS ; sinon les aides sont à relancer (erreur).
 * Rend faux si l'arrêt est demandé pendant l'attente (Odin doit toujours pouvoir s'arrêter).
 */
async function attendreAides(aides: Aides, pret: (k: number) => boolean, message: string, signal?: SignalArret): Promise<boolean> {
  const depuis = performance.now();
  for (let k = 0; k < aides.n; k++) {
    while (!pret(k)) {
      if (signal?.aborted) return false;
      if (performance.now() - depuis > DELAI_AIDE_MS) { aides.cassees = true; throw new Error(`${message} : la séance est abandonnée, les aides seront relancées`); }
      await new Promise((ok) => setTimeout(ok, 1));
    }
  }
  return true;
}

/**
 * Le pas réparti : le fil de Noûs ouvre le pas (compteur, corrections de biais), donne l'ordre « pas » aux aides, fait
 * sa tranche (la première), puis attend la leur. Chaque tranche ajoute les gradients des aides dans le même ordre et
 * applique AdamW : le résultat est celui de ajouterGrad × n puis pasAdamW, à l'identique.
 */
function pasReparti(r: Reseau, aides: Aides, rep: NonNullable<Aides['reparti']>, n: number, lr: number): void {
  const p = r.ouvrirPas(n, lr), { P, G, M, V } = r.etatAdam();
  const par = rep.parametres;
  par[0] = p.n; par[1] = p.lr; par[2] = p.b1; par[3] = p.b2; par[4] = p.eps; par[5] = p.decay; par[6] = p.c1; par[7] = p.c2;
  const sync = aides.sync, gen = Atomics.load(sync, 0) + 1;
  // L'ordre « pas » porte le numéro de génération : une aide ne fait sa tranche que pour CE pas-là.
  Atomics.store(rep.ordre, 0, gen);
  Atomics.store(sync, 0, gen); Atomics.notify(sync, 0);
  const [a, b] = tranche(G.length, 0, aides.n + 1);
  adamTranche(P, G, M, V, aides.grads, a, b, p);
  const t0 = performance.now();
  for (let k = 0; k < aides.n; k++) {
    let fait = Atomics.load(rep.ordre, 1 + k);
    while (fait !== gen) {
      Atomics.wait(rep.ordre, 1 + k, fait, 50); fait = Atomics.load(rep.ordre, 1 + k);
      if (fait !== gen && performance.now() - t0 > DELAI_AIDE_MS) {
        // Pas abandonné : une partie des tranches est faite, pas l'autre. Rien n'est laissé à moitié dans le réseau
        // (plus de séquences comptées, gradients à zéro, copies de travail à refaire sur les poids tels qu'ils sont).
        aides.cassees = true;
        r.jeterGrad(); r.fermerPas();
        throw new Error('un fil d\x27aide ne répond plus pendant le pas (arrêté ou à court de mémoire) : la séance est abandonnée, les aides seront relancées');
      }
    }
  }
  r.fermerPas();
}

/** Le corps d'un fil d'aide : attend sa part à chaque pas, calcule ses gradients, le signale. */
interface RepartiAide { partage: PartageAdam; ordre: SharedArrayBuffer; parametres: SharedArrayBuffer; tousG: SharedArrayBuffer[] }
function demarrerAide(port: NonNullable<typeof parentPort>, w: { k: number; hyper: Hyper; sab: SharedArrayBuffer; g: SharedArrayBuffer; sync: SharedArrayBuffer; res: SharedArrayBuffer; ctrl?: SharedArrayBuffer; reparti?: RepartiAide }): void {
  const r = new Reseau(w.hyper, new Float32Array(w.sab));
  r.partagerGrad(w.g);
  const sync = new Int32Array(w.sync), res = new Float64Array(w.res), ctrl = w.ctrl ? new Int32Array(w.ctrl) : undefined;
  const k = w.k, base = SYNC(k);
  let ctrlSeance = 0;
  // Le pas réparti : la tranche k+1 des poids, avec les gradients et moments du fil de Noûs (mémoire partagée).
  const rep = w.reparti && {
    ordre: new Int32Array(w.reparti.ordre), par: new Float64Array(w.reparti.parametres),
    G: new Float32Array(w.reparti.partage.g), M: new Float32Array(w.reparti.partage.m), V: new Float32Array(w.reparti.partage.v),
    gs: w.reparti.tousG.map((b) => new Float32Array(b)), nf: w.reparti.tousG.length + 1,
  };
  // L'aide lit l'arrêt aussi entre deux couches (même drapeau que le fil de Noûs).
  if (ctrl) r.arret = { get aborted(): boolean { return Atomics.load(ctrl, 0) !== ctrlSeance; } };
  // Les poids partagés ne changent qu'entre deux pas (AdamW sur le fil de Noûs) : l'aide refait ses copies de travail au
  // début de chaque part, et les garde pendant la part.
  r.figerPoids();
  port.on('message', (m: { type: string; items?: Array<{ ids: Int32Array; role?: Int32Array; poids: number }>; gen?: number }) => {
    if (m.type !== 'seance' || !m.items) return;
    const items = m.items;
    let vu = m.gen ?? Atomics.load(sync, 0);
    const ctrl0 = ctrl ? Atomics.load(ctrl, 0) : 0; // l'arrêt = ctrl[0] qui change pendant la séance
    ctrlSeance = ctrl0;
    Atomics.store(sync, base + 3, 1);
    for (;;) {
      Atomics.wait(sync, 0, vu);
      const gen = Atomics.load(sync, 0); vu = gen;
      if (Atomics.load(sync, 1) === 1) { Atomics.store(sync, base + 3, 0); return; }
      if (rep && Atomics.load(rep.ordre, 0) === gen) {
        const q = rep.par, [a, b] = tranche(rep.G.length, k + 1, rep.nf);
        adamTranche(r.poids, rep.G, rep.M, rep.V, rep.gs, a, b, { n: q[0], lr: q[1], b1: q[2], b2: q[3], eps: q[4], decay: q[5], c1: q[6], c2: q[7] });
        Atomics.store(rep.ordre, 1 + k, gen); Atomics.notify(rep.ordre, 1 + k);
        continue;
      }
      r.jeterGrad(); r.poidsModifies();
      const a = Atomics.load(sync, base), n = Atomics.load(sync, base + 1);
      let somme = 0, finies = 0, tout = 0, sans = 0;
      for (let i = a; i < a + n; i++) {
        if (ctrl && Atomics.load(ctrl, 0) !== ctrl0) break;
        const it = items[i]; if (!it || it.ids.length < 2) continue;
        let p: number;
        try { p = r.perteEtGrad(it.ids, it.poids, it.role); } catch (e) { if (e instanceof ArretCalcul) break; throw e; }
        if (p === RIEN_A_APPRENDRE) { sans++; continue; }
        tout++;
        if (Number.isFinite(p)) { somme += p; finies++; }
      }
      res[4 * k] = somme; res[4 * k + 1] = finies; res[4 * k + 2] = tout; res[4 * k + 3] = sans;
      Atomics.store(sync, base + 2, gen); Atomics.notify(sync, base + 2);
    }
  });
}

// ----------------------------------------------------------------------------------------------------------------
// Le worker. Actif UNIQUEMENT quand ce fichier est lancé comme worker_thread (moteur.ts le fait). Importé (essais,
// banc), ce bloc dort. Il tient un réseau et un découpage, et répond aux ordres de la façade. L'arrêt passe par un
// drapeau en mémoire partagée (ctrl[0]) lu directement dans les boucles synchrones : il interrompt même un calcul en
// cours, sans attendre la boucle d'événements. Une erreur ici = journal + arrêt de Noûs, jamais d'Odin.
// ----------------------------------------------------------------------------------------------------------------

interface OrdreW { type: string; id?: number; [k: string]: unknown }

// Seulement dans les fils lancés POUR cela (rôle « moteur » ou « aide ») : un autre fil qui importe ce fichier (le
// worker de préparation, un banc d'essai) garde son canal de messages pour lui (défaut 4 de l'entraînement).
if (!isMainThread && parentPort) {
  const wd = workerData as { role?: string } | undefined;
  if (wd?.role === 'aide') demarrerAide(parentPort, workerData as Parameters<typeof demarrerAide>[1]);
  else if (wd?.role === ROLE_MOTEUR) demarrerWorker(parentPort);
}

function demarrerWorker(port: NonNullable<typeof parentPort>): void {
  let reseau: Reseau | undefined;
  let decoupage: { encoder(t: string): Int32Array; decoder(ids: ArrayLike<number>): string; vocab: number; version: number; arretId?: number } | undefined;
  let ctrl: Int32Array | undefined;
  let sabPoids: SharedArrayBuffer | undefined, sabCtrl: SharedArrayBuffer | undefined, aides: Aides | undefined;
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
        sabPoids = o.sab as SharedArrayBuffer; sabCtrl = o.ctrl as SharedArrayBuffer;
        const poids = new Float32Array(o.sab as SharedArrayBuffer);
        reseau = new Reseau(hyper, poids);
        ctrl = new Int32Array(o.ctrl as SharedArrayBuffer);
        if (typeof o.fresh === 'number') reseau.initialiser(o.fresh);
        const mo = o.moments as { m: Float32Array; v: Float32Array; pas: number } | undefined;
        if (mo) reseau.importerMoments(mo.m, mo.v, mo.pas);
        // Dans ce fil, les poids ne changent QUE par le réseau lui-même (séance : pas AdamW, pas réparti des aides
        // refermé par le réseau ; retour à un point : importerPoids) — la façade ne les écrit qu'avant de lancer le
        // fil. Les copies de travail des poids (mémoire du noyau, transposées) restent donc valables d'une réponse,
        // d'un plongement ou d'une mesure à l'autre, au lieu d'être refaites à chaque appel. Qui écrirait un jour dans
        // ces poids par un autre chemin envoie l'ordre 'poidsModifies'. ODIN_SOUL_GEL=non : comme avant (copies refaites à
        // chaque appel) ; ce réglage est à part de ODIN_SOUL_TAMPONS, pour mesurer chaque gain seul.
        if (gelActif()) reseau.figerPoids();
        // Les tampons de ce fil sont comptés par le comptable du fil principal, via le registre partagé : on l'attend un
        // court instant (sans lui, le repli local compte, au plus 256 Mo pour ce fil).
        await attendreRegistre(1000);
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
        // La même forme qu'à l'entraînement des paires : [USER] demande [ASSISTANT], puis la réponse jusqu'à [EOS].
        const ids = formeDemande(decoupage.encoder(dmd.texte));
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
        repondre(o.id, reseau.score(formeDemande(decoupage.encoder(o.demande as string)), formeReponse(decoupage.encoder(o.reponse as string))));
        return;
      }
      case 'seance': {
        if (!reseau) throw new Error('Noûs pas initialisé');
        // L'arrêt : la façade pose ctrl[0] = identifiant de CETTE séance ; la boucle de seance() le lit via sig.
        const reglages = o.reglages as SeanceReglages;
        // Plusieurs fils : les aides sont lancés une fois (et relancés si le nombre change).
        const nAides = Math.max(0, Math.min(31, (reglages.fils ?? 1) - 1));
        if (aides?.cassees) { await arreterAides(aides); aides = undefined; } // une aide morte : on les relance toutes
        if (nAides && (!aides || aides.n !== nAides) && sabPoids) { await arreterAides(aides); aides = lancerAides(reseau.hyper, sabPoids, sabCtrl, nAides); }
        if (!nAides && aides) { await arreterAides(aides); aides = undefined; }
        let av: AvanceeBrute;
        try { av = nAides && aides ? await seanceParallele(reseau, o.lots as LotBrut[], { ...reglages, signal: sig }, aides) : seance(reseau, o.lots as LotBrut[], { ...reglages, signal: sig }); }
        catch (e) { if (aides?.cassees) { await arreterAides(aides); aides = undefined; } throw e; }
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
          poids: reseau.poids, m: mm.m, v: mm.v, pas: mm.pas, graine: grainesCourbe, courbe, modeleVersion: typeof o.modeleVersion === 'number' ? o.modeleVersion : undefined,
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
      case 'poidsModifies': {
        if (!reseau) throw new Error('Noûs pas initialisé');
        reseau.poidsModifies();
        repondre(o.id, true);
        return;
      }
      case 'arreter': {
        await arreterAides(aides); aides = undefined;
        rendreTout(); // le fil va être arrêté de force : ses tampons sont rendus au compte avant
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
  // Les poids ne changent pas pendant la mesure : leurs copies de travail sont faites une fois pour tout le jeu.
  r.figerPoids();
  try {
    for (const brut of jeu) {
      if (brut.length < 2) continue;
      const ids = tete(brut, r.disp.T); // comme à l'entraînement : ce qui dépasse le contexte n'est pas mesuré
      // Une portée par suite : les logits sont lus ici, puis leurs tampons resservent à la suite suivante.
      r.avecTampons(() => {
        const et = r.avant(ids, true); const logits = et.logits!; const V = r.disp.V;
        for (let t = 0; t < ids.length - 1; t++) {
          const cible = ids[t + 1] | 0, o = t * V;
          let mx = -Infinity; for (let vv = 0; vv < V; vv++) if (logits[o + vv] > mx) mx = logits[o + vv];
          let som = 0; for (let vv = 0; vv < V; vv++) som += Math.exp(logits[o + vv] - mx);
          s += (mx + Math.log(som)) - logits[o + cible]; n++;
        }
      });
    }
  } finally { r.libererPoids(); }
  return n ? s / n : 0;
}
