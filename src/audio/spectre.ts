// Le spectre du son, écrit dans Odin : transformée de Fourier rapide (base 2), spectrogramme à court terme, bandes
// mel en décibels (l'entrée exacte du modèle de sons), coefficients cepstraux (MFCC) et chroma (les 12 notes).
//
// Réglage de l'entrée du modèle de sons, à respecter exactement :
//  - 512 points, fenêtre de Hann PÉRIODIQUE, pas de 160 échantillons (10 ms), son centré par RÉFLEXION (256 de chaque côté) ;
//  - spectre de PUISSANCE ; 64 filtres mel (échelle 2595·log10(1 + f/700)) de 0 à 8000 Hz, triangles non normalisés posés sur les cases
//    k·16000/512 ; banc creux ;
//  - dB = 10·log10(max(p, 1e-10)), écrêté à (max − 120 dB), le max étant pris sur la TRANCHE.

import { FS } from './contrat.ts';

export const NFFT = 512;
export const PAS = 160;
export const BANDES = 64;
export const NMFCC = 20;
const CASES = NFFT / 2 + 1;

// ---------------------------------------------------------------------------------------------------------------
// Transformée de Fourier rapide (complexe, en place, base 2).
// ---------------------------------------------------------------------------------------------------------------

interface PlanFft { n: number; cos: Float64Array; sin: Float64Array; inv: Uint32Array }
const plans = new Map<number, PlanFft>();

function plan(n: number): PlanFft {
  const p = plans.get(n);
  if (p) return p;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('taille de transformée : une puissance de 2');
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  const bits = Math.log2(n);
  const inv = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); inv[i] = r; }
  const nouveau = { n, cos, sin, inv };
  plans.set(n, nouveau);
  return nouveau;
}

/** Transformée en place : re/im de longueur n (puissance de 2). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { cos, sin, inv } = plan(n);
  for (let i = 0; i < n; i++) {
    const j = inv[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let taille = 2; taille <= n; taille <<= 1) {
    const demi = taille >> 1, pasT = n / taille;
    for (let debut = 0; debut < n; debut += taille) {
      for (let k = 0; k < demi; k++) {
        const wr = cos[k * pasT], wi = sin[k * pasT];
        const a = debut + k, b = a + demi;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

/** Spectre de puissance unilatéral (n/2 + 1 cases) d'une trame réelle de longueur n, sans fenêtre. */
export function spectrePuissance(trame: ArrayLike<number>): Float64Array {
  const n = trame.length;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = trame[i];
  fft(re, im);
  const out = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}

/** Fenêtre de Hann périodique. */
export function hannPeriodique(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Indice réfléchi (le son est prolongé en miroir de chaque côté, sans répéter le bord). */
function reflet(i: number, n: number): number {
  if (n <= 1) return 0;
  const p = 2 * (n - 1);
  let j = ((i % p) + p) % p;
  if (j >= n) j = p - j;
  return j;
}

// ---------------------------------------------------------------------------------------------------------------
// Banc de filtres mel (échelle 2595·log10(1 + f/700)), creux.
// ---------------------------------------------------------------------------------------------------------------

const hzVersMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melVersHz = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);

export interface Filtre { debut: number; poids: Float64Array }

function construireBanc(): Filtre[] {
  const mMin = hzVersMel(0), mMax = hzVersMel(FS / 2);
  const f = new Float64Array(BANDES + 2);
  for (let i = 0; i < BANDES + 2; i++) f[i] = melVersHz(mMin + ((mMax - mMin) * i) / (BANDES + 1));
  const banc: Filtre[] = [];
  for (let m = 0; m < BANDES; m++) {
    const bas = f[m], centre = f[m + 1], haut = f[m + 2];
    const w: number[] = [];
    let debut = -1;
    for (let k = 0; k < CASES; k++) {
      const fk = (k * FS) / NFFT;
      const montee = (fk - bas) / (centre - bas), descente = (haut - fk) / (haut - centre);
      const v = Math.max(0, Math.min(montee, descente));
      if (v > 0) { if (debut < 0) debut = k; w.length = k - debut; w.push(v); }
    }
    // Remplit les trous éventuels (aucun en pratique : les triangles sont convexes).
    const poids = new Float64Array(w.length);
    for (let i = 0; i < w.length; i++) poids[i] = w[i] ?? 0;
    banc.push({ debut: Math.max(0, debut), poids });
  }
  return banc;
}

let bancCache: Filtre[] | undefined;
export function bancMel(): Filtre[] { return (bancCache ??= construireBanc()); }

/** Fréquence centrale (Hz) de chaque bande mel. */
export function centresMel(): number[] {
  const mMax = hzVersMel(FS / 2);
  return Array.from({ length: BANDES }, (_, m) => melVersHz((mMax * (m + 1)) / (BANDES + 1)));
}

// ---------------------------------------------------------------------------------------------------------------
// Bandes mel en dB, MFCC.
// ---------------------------------------------------------------------------------------------------------------

export interface LogMel {
  /** 64 × T, rangé par bande (la bande m occupe [m·T, (m+1)·T[). */
  data: Float32Array;
  trames: number;
  /** Le max (dB) de la tranche, avant écrêtage. */
  max: number;
}

const FENETRE = hannPeriodique(NFFT);

/** Nombre de trames pour n échantillons : 1 + floor(n / 160). */
export const nbTrames = (n: number): number => 1 + Math.floor(n / PAS);

/** Bandes mel en dB d'une tranche (forme 64 × (1 + floor(n/160))). */
export function logMel(x: Float32Array): LogMel {
  const n = x.length;
  const T = nbTrames(n);
  const data = new Float32Array(BANDES * T);
  const banc = bancMel();
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT), p = new Float64Array(CASES);
  let max = -Infinity;
  for (let t = 0; t < T; t++) {
    const debut = t * PAS - NFFT / 2;
    if (debut >= 0 && debut + NFFT <= n) for (let i = 0; i < NFFT; i++) re[i] = x[debut + i] * FENETRE[i];
    else for (let i = 0; i < NFFT; i++) re[i] = (n ? x[reflet(debut + i, n)] : 0) * FENETRE[i];
    im.fill(0);
    fft(re, im);
    for (let k = 0; k < CASES; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    for (let m = 0; m < BANDES; m++) {
      const f = banc[m];
      let s = 0;
      for (let i = 0; i < f.poids.length; i++) s += f.poids[i] * p[f.debut + i];
      const db = 10 * Math.log10(Math.max(s, 1e-10));
      data[m * T + t] = db;
      if (db > max) max = db;
    }
  }
  const plancher = max - 120;
  for (let i = 0; i < data.length; i++) if (data[i] < plancher) data[i] = plancher;
  return { data, trames: T, max };
}

let dctCache: Float64Array | undefined;
/** Matrice de la DCT-II orthonormée (20 × 64). */
function dct(): Float64Array {
  if (dctCache) return dctCache;
  const d = new Float64Array(NMFCC * BANDES);
  for (let k = 0; k < NMFCC; k++) {
    const s = k === 0 ? Math.sqrt(1 / BANDES) : Math.sqrt(2 / BANDES);
    for (let m = 0; m < BANDES; m++) d[k * BANDES + m] = s * Math.cos((Math.PI * k * (2 * m + 1)) / (2 * BANDES));
  }
  return (dctCache = d);
}

/** MFCC (20) d'une trame : colonne t des bandes mel. */
export function mfccTrame(mel: LogMel, t: number, out = new Float64Array(NMFCC)): Float64Array {
  const d = dct(), T = mel.trames;
  for (let k = 0; k < NMFCC; k++) {
    let s = 0;
    for (let m = 0; m < BANDES; m++) s += d[k * BANDES + m] * mel.data[m * T + t];
    out[k] = s;
  }
  return out;
}

/** MFCC de toutes les trames : T × 20, rangé par trame. */
export function mfcc(mel: LogMel): Float32Array {
  const T = mel.trames, out = new Float32Array(T * NMFCC), tmp = new Float64Array(NMFCC);
  for (let t = 0; t < T; t++) { mfccTrame(mel, t, tmp); for (let k = 0; k < NMFCC; k++) out[t * NMFCC + k] = tmp[k]; }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Chroma : les 12 notes, par repliement des cases d'une transformée longue (4096 points, cases de 3,9 Hz), entre 55
// et 2000 Hz, 10 trames par seconde. (La transformée de 512 points, cases de 31 Hz, ne sépare pas les notes graves.)
// ---------------------------------------------------------------------------------------------------------------

export const NFFT_CHROMA = 4096;
export const PAS_CHROMA = 1600;
const FENETRE_CHROMA = hannPeriodique(NFFT_CHROMA);
let noteDeCase: Int8Array | undefined;

function notesDesCases(): Int8Array {
  if (noteDeCase) return noteDeCase;
  const t = new Int8Array(NFFT_CHROMA / 2 + 1).fill(-1);
  for (let k = 1; k <= NFFT_CHROMA / 2; k++) {
    const f = (k * FS) / NFFT_CHROMA;
    if (f < 55 || f > 2000) continue;
    const midi = Math.round(12 * Math.log2(f / 440) + 69);
    t[k] = ((midi % 12) + 12) % 12;
  }
  return (noteDeCase = t);
}

/** Chroma d'une tranche : F × 12 (F = 1 + floor(n/1600)), 0 = do … 11 = si. */
export function chroma(x: Float32Array): { data: Float32Array; trames: number } {
  const n = x.length;
  const F = 1 + Math.floor(n / PAS_CHROMA);
  const data = new Float32Array(F * 12);
  const notes = notesDesCases();
  const re = new Float64Array(NFFT_CHROMA), im = new Float64Array(NFFT_CHROMA);
  for (let t = 0; t < F; t++) {
    const debut = t * PAS_CHROMA - NFFT_CHROMA / 2;
    for (let i = 0; i < NFFT_CHROMA; i++) re[i] = (n ? x[reflet(debut + i, n)] : 0) * FENETRE_CHROMA[i];
    im.fill(0);
    fft(re, im);
    for (let k = 1; k <= NFFT_CHROMA / 2; k++) {
      const c = notes[k];
      if (c < 0) continue;
      data[t * 12 + c] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    }
  }
  return { data, trames: F };
}
