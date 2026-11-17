// Entendre SANS modèle : des calculs écrits dans Odin, sur le son et son spectre, tranche par tranche.
//  - volume (efficace et crête, en dBFS) ; zones de son et de silence (plancher −60 dBFS, trous de moins de 300 ms comblés) ;
//  - changements (pics d'un flux spectral lissé : écart entre la seconde d'avant et la seconde d'après) ;
//  - tempo (autocorrélation de la courbe d'attaques, de 50 à 220 BPM, préférence douce autour de 120) ;
//  - tonalité (corrélation de la chroma moyenne avec les profils publics majeurs et mineurs, sur les 24 tons) ;
//  - parties (auto-similarité chroma + MFCC par fenêtres de 1 s, nouveauté par noyau en damier, groupes A/B/C) ;
//  - musique probable (netteté des notes par trame, confiance de la tonalité et du tempo), dite « sans modèle ».
// On ne garde que des traits à 10 par seconde au plus, jamais le son entier.

import type { Partie, Tempo, Tonalite, Volume, Zone } from './contrat.ts';
import { BANDES, NMFCC, type LogMel } from './spectre.ts';

const BLOC = 1600; // 100 ms à 16 kHz
const SEUIL_MUSIQUE = 0.32;
const DB_MIN = -100;

// Profils publics des tonalités (Krumhansl et Kessler), du degré 1 au degré 12.
const PROFIL_MAJEUR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFIL_MINEUR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
export const NOMS_NOTES = ['do', 'do dièse', 'ré', 'mi bémol', 'mi', 'fa', 'fa dièse', 'sol', 'la bémol', 'la', 'si bémol', 'si'];

const LAG_MIN = 25, LAG_MAX = 125; // en trames de 10 ms (240 à 48 BPM), la recherche se fait entre 50 et 220
const BPM_MIN = 50, BPM_MAX = 220;

const dB = (x: number): number => (x > 0 ? Math.max(DB_MIN, 20 * Math.log10(x)) : DB_MIN);

/** Les traits d'une seconde, pour les parties. */
interface Seconde { chroma: Float64Array; mfcc: Float64Array; rms: number; nChroma: number; nMfcc: number; ech: number; somme2: number }

/** Accumulateur des calculs sans modèle, tranche par tranche. */
export class EcouteSansModele {
  private somme2 = 0;
  private n = 0;
  private crete = 0;
  /** Volume efficace par bloc de 100 ms (dBFS). */
  readonly energie: number[] = [];
  /** Crête par bloc de 100 ms ([0, 1]), pour la forme d'onde. */
  readonly cretes: number[] = [];
  /** Nouveauté spectrale par bloc de 100 ms (alignée sur le début du bloc). */
  readonly nouveaute: number[] = [];
  private blocsMel: Float64Array[] = []; // fenêtre glissante de 20 blocs
  private blocsVus = 0;
  /** Autocorrélation cumulée de la courbe d'attaques. */
  readonly autoc = new Float64Array(LAG_MAX + 1);
  private chromaTotale = new Float64Array(12);
  readonly secondes: Seconde[] = [];
  private netteTrames = 0;
  private nTrames = 0;

  /** Ajoute une tranche : le son (16 kHz), ses bandes mel, ses MFCC (T × 20) et sa chroma (F × 12). */
  ajouter(x: Float32Array, mel: LogMel, mf: Float32Array, ch: { data: Float32Array; trames: number }, debutS: number): void {
    // Volume, énergie et crête par bloc de 100 ms.
    for (let b = 0; b * BLOC < x.length; b++) {
      let s2 = 0, c = 0;
      const fin = Math.min(x.length, (b + 1) * BLOC);
      for (let i = b * BLOC; i < fin; i++) { const v = x[i]; s2 += v * v; const a = v < 0 ? -v : v; if (a > c) c = a; }
      const nb = fin - b * BLOC;
      this.somme2 += s2; this.n += nb; if (c > this.crete) this.crete = c;
      this.energie.push(dB(Math.sqrt(s2 / Math.max(1, nb))));
      this.cretes.push(Math.min(1, c));
    }
    const T = mel.trames;
    const utiles = Math.min(T, Math.ceil(x.length / 160));
    // Blocs mel de 100 ms (10 trames) → nouveauté (écart entre la seconde d'avant et la seconde d'après).
    for (let b = 0; b * 10 < utiles; b++) {
      const v = new Float64Array(BANDES);
      const fin = Math.min(utiles, (b + 1) * 10);
      for (let m = 0; m < BANDES; m++) { let s = 0; for (let t = b * 10; t < fin; t++) s += mel.data[m * T + t]; v[m] = s / (fin - b * 10); }
      this.pousserBloc(v);
    }
    // Courbe d'attaques (flux spectral positif) puis autocorrélation de la tranche.
    const att = new Float64Array(utiles);
    for (let t = 1; t < utiles; t++) {
      let s = 0;
      for (let m = 0; m < BANDES; m++) { const d = mel.data[m * T + t] - mel.data[m * T + t - 1]; if (d > 0) s += d; }
      att[t] = s;
    }
    // Retire la moyenne locale (0,5 s) et garde la partie positive : les attaques ressortent.
    const lisse = new Float64Array(utiles);
    let acc = 0;
    for (let t = 0; t < utiles; t++) {
      acc += att[t]; if (t >= 50) acc -= att[t - 50];
      lisse[t] = Math.max(0, att[t] - acc / Math.min(t + 1, 50));
    }
    for (let lag = LAG_MIN; lag <= LAG_MAX; lag++) {
      let s = 0;
      for (let t = 0; t + lag < utiles; t++) s += lisse[t] * lisse[t + lag];
      this.autoc[lag] += s;
    }
    // Secondes : chroma moyenne, MFCC moyens, énergie.
    const sec0 = Math.round(debutS);
    const nbSec = Math.ceil(x.length / 16000);
    for (let s = 0; s < nbSec; s++) {
      const idx = sec0 + s;
      while (this.secondes.length <= idx) this.secondes.push({ chroma: new Float64Array(12), mfcc: new Float64Array(NMFCC), rms: 0, nChroma: 0, nMfcc: 0, ech: 0, somme2: 0 });
    }
    const e0 = this.energie.length - Math.ceil(x.length / BLOC);
    for (let f = 0; f < ch.trames && f * 1600 < x.length; f++) {
      const sec = this.secondes[sec0 + Math.floor(f / 10)];
      if (!sec) continue;
      for (let k = 0; k < 12; k++) { sec.chroma[k] += ch.data[f * 12 + k]; this.chromaTotale[k] += ch.data[f * 12 + k]; }
      sec.nChroma++;
      this.trameNotes(ch.data.subarray(f * 12, f * 12 + 12), this.energie[e0 + f] ?? DB_MIN);
    }
    for (let t = 0; t < utiles; t++) {
      const sec = this.secondes[sec0 + Math.floor(t / 100)];
      if (!sec) continue;
      for (let k = 0; k < NMFCC; k++) sec.mfcc[k] += mf[t * NMFCC + k];
      sec.nMfcc++;
    }
    for (let s = 0; s < nbSec; s++) {
      const sec = this.secondes[sec0 + s];
      const fin = Math.min(x.length, (s + 1) * 16000);
      for (let i = s * 16000; i < fin; i++) sec.somme2 += x[i] * x[i];
      sec.ech += fin - s * 16000;
    }
  }

  /** Netteté de la note la plus forte d'une trame de 100 ms (seulement si la trame porte du son). */
  private trameNotes(c: ArrayLike<number>, energieDb: number): void {
    if (energieDb < -50) return;
    let tot = 0, max = 0;
    for (let k = 0; k < 12; k++) { tot += c[k]; if (c[k] > max) max = c[k]; }
    if (!(tot > 1e-9)) return;
    this.netteTrames += (max / tot - 1 / 12) / (11 / 12); this.nTrames++;
  }

  private pousserBloc(v: Float64Array): void {
    this.blocsMel.push(v);
    this.blocsVus++;
    if (this.blocsMel.length > 20) this.blocsMel.shift();
    // Quand on a 20 blocs, on note la nouveauté au bloc du milieu (index global blocsVus - 10).
    if (this.blocsMel.length === 20) {
      const avant = moyenne(this.blocsMel.slice(0, 10)), apres = moyenne(this.blocsMel.slice(10));
      let s = 0;
      for (let m = 0; m < BANDES; m++) { const d = apres[m] - avant[m]; s += d * d; }
      const i = this.blocsVus - 10;
      while (this.nouveaute.length < i) this.nouveaute.push(0);
      this.nouveaute[i] = Math.sqrt(s / BANDES);
    }
  }

  volume(): Volume {
    return { rmsDb: arrondi(dB(Math.sqrt(this.somme2 / Math.max(1, this.n))), 2), creteDb: arrondi(dB(this.crete), 2) };
  }

  zones(): Zone[] { return zonesDe(this.energie); }

  changements(): number[] { return changementsDe(this.nouveaute); }

  tempo(): Tempo | undefined { return tempoDe(this.autoc); }

  tonalite(): Tonalite | undefined { return tonaliteDe(this.chromaTotale); }

  parties(): Partie[] { return partiesDe(this.secondes.map(finirSeconde)); }

  /** Netteté des notes : part de la note la plus forte par trame de 100 ms qui porte du son, de 0 (bruit) à 1 (note pure). */
  nettete(): number { return this.nTrames ? this.netteTrames / this.nTrames : 0; }

  /**
   * Musique probable sans modèle (estimation). Score = netteté des notes + confiance de la tonalité + 0,1 × confiance du
   * tempo, seuil 0,32 (confiance 50 %). Calé le 17/11 sur des sons connus : 20 sonneries et alarmes musicales du système,
   * des chansons, une mélodie et un accord fabriqués passent (score 0,36 à 0,73) ; une parole fabriquée, deux voix, des
   * clics et du bruit non (0,12 à 0,27). Une estimation : le modèle de sons, quand il a tourné, passe devant.
   */
  musique(): { probable: boolean; confiance: number } {
    const score = this.nettete() + (this.tonalite()?.confiance ?? 0) + 0.1 * (this.tempo()?.confiance ?? 0);
    return { probable: score >= SEUIL_MUSIQUE, confiance: arrondi(Math.max(0, Math.min(1, score / (2 * SEUIL_MUSIQUE))), 2) };
  }

  /** Forme d'onde : au plus `points` crêtes dans [0, 1]. */
  onde(points = 200): number[] {
    const c = this.cretes;
    if (c.length <= points) return c.map((v) => arrondi(v, 3));
    const out: number[] = [];
    for (let p = 0; p < points; p++) {
      const a = Math.floor((p * c.length) / points), b = Math.floor(((p + 1) * c.length) / points);
      let m = 0; for (let i = a; i < b; i++) if (c[i] > m) m = c[i];
      out.push(arrondi(m, 3));
    }
    return out;
  }
}

function moyenne(v: Float64Array[]): Float64Array {
  const out = new Float64Array(v[0].length);
  for (const x of v) for (let i = 0; i < x.length; i++) out[i] += x[i] / v.length;
  return out;
}

const arrondi = (x: number, d: number): number => { const p = 10 ** d; return Math.round(x * p) / p; };

function centile(v: number[], q: number): number {
  if (!v.length) return DB_MIN;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/** Plancher du silence : sous −60 dBFS efficace, un bloc est du silence. */
const SEUIL_SILENCE = -60;
/** Un trou de silence plus court que 300 ms entre deux sons est comblé (respiration, entre deux syllabes ou deux notes). */
const TROU_MAX = 3;

/**
 * Zones de son et de silence, sur l'énergie par bloc de 100 ms. Seuil absolu −60 dBFS ; relevé à « 10e centile + 10 dB »
 * seulement s'il existe de vrais silences (10e centile sous −50 dBFS et grand écart avec le 90e). Les trous de silence de
 * moins de 300 ms entre deux sons sont comblés, en une seule passe (aucun retournement en chaîne) ; un son bref reste un son.
 */
export function zonesDe(energie: number[]): Zone[] {
  if (!energie.length) return [];
  const p10 = centile(energie, 0.1), p90 = centile(energie, 0.9);
  const seuil = p10 < -50 && p90 - p10 >= 15 ? Math.max(SEUIL_SILENCE, p10 + 10) : SEUIL_SILENCE;
  const etat = energie.map((e) => e > seuil);
  const courses = (): Array<{ a: number; b: number; v: boolean }> => {
    const c: Array<{ a: number; b: number; v: boolean }> = [];
    for (let i = 0; i < etat.length; i++) {
      if (c.length && c[c.length - 1].v === etat[i]) c[c.length - 1].b = i + 1;
      else c.push({ a: i, b: i + 1, v: etat[i] });
    }
    return c;
  };
  const c = courses();
  for (let k = 1; k + 1 < c.length; k++) {
    if (!c[k].v && c[k].b - c[k].a < TROU_MAX) for (let i = c[k].a; i < c[k].b; i++) etat[i] = true;
  }
  return courses().map((x) => ({ debut: arrondi(x.a * 0.1, 2), fin: arrondi(x.b * 0.1, 2), son: x.v }));
}

/** Changements : pics de la nouveauté (au moins 3 dB d'écart, au-dessus de la médiane + 3 écarts absolus), 2 s d'écart. */
export function changementsDe(nov: number[]): number[] {
  if (nov.length < 3) return [];
  const med = centile(nov, 0.5);
  const mad = centile(nov.map((v) => Math.abs(v - med)), 0.5);
  const seuil = Math.max(3, med + 3 * mad);
  const pics: Array<{ i: number; v: number }> = [];
  for (let i = 0; i < nov.length; i++) {
    const v = nov[i];
    if (v < seuil) continue;
    let max = true;
    for (let j = Math.max(0, i - 10); j <= Math.min(nov.length - 1, i + 10); j++) if (nov[j] > v || (nov[j] === v && j < i)) { max = false; break; }
    if (max) pics.push({ i, v });
  }
  pics.sort((a, b) => b.v - a.v);
  const gardes: number[] = [];
  for (const p of pics) {
    if (gardes.length >= 100) break;
    if (gardes.every((g) => Math.abs(g - p.i) >= 20)) gardes.push(p.i);
  }
  return gardes.sort((a, b) => a - b).map((i) => arrondi(i * 0.1, 2));
}

/** Tempo par l'autocorrélation cumulée (trames de 10 ms). */
export function tempoDe(autoc: Float64Array): Tempo | undefined {
  const poids = (lag: number): number => { const bpm = 6000 / lag; const o = Math.log2(bpm / 120); return Math.exp(-0.5 * o * o); };
  const s = new Float64Array(autoc.length);
  let max = 0;
  for (let lag = LAG_MIN; lag <= LAG_MAX; lag++) { s[lag] = Math.max(0, autoc[lag]) * poids(lag); if (s[lag] > max) max = s[lag]; }
  if (max <= 0) return undefined;
  const pics: Array<{ bpm: number; v: number }> = [];
  for (let lag = LAG_MIN + 1; lag < LAG_MAX; lag++) {
    if (!(s[lag] > 0 && s[lag] >= s[lag - 1] && s[lag] > s[lag + 1])) continue;
    const a = s[lag - 1], b = s[lag], c = s[lag + 1];
    const den = a - 2 * b + c;
    const d = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    const bpm = 6000 / (lag + d);
    if (bpm < BPM_MIN || bpm > BPM_MAX) continue;
    pics.push({ bpm, v: b - 0.25 * (a - c) * d });
  }
  if (!pics.length) return undefined;
  pics.sort((x, y) => y.v - x.v);
  const p1 = pics[0];
  const p2 = pics.find((p) => Math.abs(p.bpm - p1.bpm) / p1.bpm > 0.05);
  return {
    bpm: arrondi(p1.bpm, 1),
    second: p2 ? arrondi(p2.bpm, 1) : arrondi(p1.bpm >= 110 ? p1.bpm / 2 : p1.bpm * 2, 1),
    confiance: arrondi(p2 ? Math.max(0, Math.min(1, 1 - p2.v / p1.v)) : 1, 2),
  };
}

function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i] / 12; mb += b[i] / 12; }
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** Tonalité : corrélation de la chroma avec les 24 profils (12 toniques × majeur/mineur). */
export function tonaliteDe(chroma: ArrayLike<number>): Tonalite | undefined {
  let tot = 0;
  for (let i = 0; i < 12; i++) tot += chroma[i];
  if (!(tot > 1e-9)) return undefined;
  const essais: Array<{ tonique: number; mode: 'majeur' | 'mineur'; r: number }> = [];
  for (const mode of ['majeur', 'mineur'] as const) {
    const prof = mode === 'majeur' ? PROFIL_MAJEUR : PROFIL_MINEUR;
    for (let t = 0; t < 12; t++) {
      const tourne = Array.from({ length: 12 }, (_, k) => prof[(k - t + 12) % 12]);
      essais.push({ tonique: t, mode, r: pearson(chroma, tourne) });
    }
  }
  essais.sort((a, b) => b.r - a.r);
  const [p, s] = essais;
  return {
    nom: `${NOMS_NOTES[p.tonique]} ${p.mode}`,
    tonique: p.tonique,
    mode: p.mode,
    confiance: arrondi(Math.max(0, Math.min(1, p.r - s.r)), 3),
    second: `${NOMS_NOTES[s.tonique]} ${s.mode}`,
  };
}

/** Traits finis d'une seconde (moyennes). */
export interface TraitSeconde { chroma: number[]; mfcc: number[]; rms: number }

function finirSeconde(s: Seconde): TraitSeconde {
  return {
    chroma: Array.from(s.chroma, (v) => v / Math.max(1, s.nChroma)),
    mfcc: Array.from(s.mfcc, (v) => v / Math.max(1, s.nMfcc)),
    rms: Math.sqrt(s.somme2 / Math.max(1, s.ech)),
  };
}

const norme = (v: number[]): number[] => { const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)); return n > 0 ? v.map((x) => x / n) : v.map(() => 0); };
const cos = (a: number[], b: number[]): number => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** Parties (couplet, refrain…) sur des fenêtres de 1 s : auto-similarité, nouveauté en damier, groupes A/B/C. */
export function partiesDe(secondesBrutes: TraitSeconde[]): Partie[] {
  let sec = secondesBrutes;
  if (sec.length < 2) return sec.length ? [{ debut: 0, fin: sec.length, groupe: 'A', refrainProbable: false }] : [];
  // Au plus 600 fenêtres : au-delà, on regroupe des secondes voisines.
  let largeur = 1;
  if (sec.length > 600) {
    largeur = Math.ceil(sec.length / 600);
    const g: TraitSeconde[] = [];
    for (let i = 0; i < sec.length; i += largeur) {
      const p = sec.slice(i, i + largeur);
      g.push({
        chroma: p[0].chroma.map((_, k) => p.reduce((a, x) => a + x.chroma[k], 0) / p.length),
        mfcc: p[0].mfcc.map((_, k) => p.reduce((a, x) => a + x.mfcc[k], 0) / p.length),
        rms: Math.sqrt(p.reduce((a, x) => a + x.rms * x.rms, 0) / p.length),
      });
    }
    sec = g;
  }
  const N = sec.length;
  const moy = new Array(NMFCC).fill(0);
  for (const s of sec) for (let k = 0; k < NMFCC; k++) moy[k] += s.mfcc[k] / N;
  const traits = sec.map((s) => {
    const c = norme(s.chroma);
    const m = norme(s.mfcc.slice(1).map((v, k) => v - moy[k + 1]));
    return [...c, ...m].map((v) => v / Math.SQRT2);
  });
  const S = (i: number, j: number) => cos(traits[i], traits[j]);
  // Nouveauté par noyau en damier (demi-largeur 4 fenêtres, pondéré par une gaussienne).
  const L = Math.min(4, Math.floor(N / 2));
  const nov = new Array(N).fill(0);
  for (let i = L; i <= N - L; i++) {
    let s = 0;
    for (let a = -L; a < L; a++) for (let b = -L; b < L; b++) {
      const signe = (a < 0) === (b < 0) ? 1 : -1;
      const g = Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (L / 2) ** 2));
      s += signe * g * S(i + a, i + b);
    }
    nov[i] = s;
  }
  const mn = nov.reduce((a, v) => a + v, 0) / N;
  const ec = Math.sqrt(nov.reduce((a, v) => a + (v - mn) ** 2, 0) / N);
  const bornes = [0];
  for (let i = 1; i < N; i++) {
    if (nov[i] <= mn + 0.5 * ec || nov[i] <= 0) continue;
    let max = true;
    for (let j = Math.max(0, i - L); j <= Math.min(N - 1, i + L); j++) if (nov[j] > nov[i]) { max = false; break; }
    if (max && i - bornes[bornes.length - 1] >= Math.max(2, L)) bornes.push(i);
  }
  if (N - bornes[bornes.length - 1] < Math.max(2, L) && bornes.length > 1) bornes.pop();
  bornes.push(N);
  // Groupes : chaque partie rejoint le premier groupe qui lui ressemble (cosinus ≥ 0,85).
  const parts: Array<{ a: number; b: number; trait: number[]; energie: number; groupe: number }> = [];
  const reps: number[][] = [];
  for (let k = 0; k + 1 < bornes.length; k++) {
    const a = bornes[k], b = bornes[k + 1];
    const t = norme(traits[0].map((_, d) => traits.slice(a, b).reduce((s, v) => s + v[d], 0)));
    const energie = sec.slice(a, b).reduce((s, v) => s + v.rms, 0) / (b - a);
    let g = reps.findIndex((r) => cos(r, t) >= 0.85);
    if (g < 0) { reps.push(t); g = reps.length - 1; }
    parts.push({ a, b, trait: t, energie, groupe: g });
  }
  // Le groupe le plus répété (au moins deux fois), puis le plus fort, est le refrain probable (estimation).
  const compte = new Map<number, { n: number; e: number }>();
  for (const p of parts) { const c = compte.get(p.groupe) ?? { n: 0, e: 0 }; c.n++; c.e += p.energie; compte.set(p.groupe, c); }
  let refrain = -1, meilleur = { n: 1, e: -1 };
  for (const [g, c] of compte) if (c.n >= 2 && (c.n > meilleur.n || (c.n === meilleur.n && c.e / c.n > meilleur.e))) { refrain = g; meilleur = { n: c.n, e: c.e / c.n }; }
  const lettre = (g: number) => String.fromCharCode(65 + Math.min(25, g));
  return parts.map((p) => ({ debut: p.a * largeur, fin: Math.min(secondesBrutes.length, p.b * largeur), groupe: lettre(p.groupe), refrainProbable: p.groupe === refrain }));
}
