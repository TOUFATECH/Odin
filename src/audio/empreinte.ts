// Empreinte sonore, écrite dans Odin : reconnaître un son déjà entendu, pour ne pas le réanalyser deux fois.
// Deux temps :
//  1. le SHA-256 du son ramené en entiers 16 bits à 16 kHz, calculé en flux (doublon exact) ;
//  2. une « constellation » perceptive : les pics locaux des bandes mel, éclaircis à environ 30 par seconde, reliés par
//     paires (bande 1, bande 2, écart ≤ 63 trames de 10 ms) en un code de 32 bits ; 10 minutes indexées au plus.
// La recherche vote : pour chaque code commun, l'écart d'instant entre la requête et le son rangé ; un vrai même son
// donne beaucoup de votes au MÊME écart.

import { createHash, type Hash } from 'node:crypto';
import type { EmpreinteSon } from './contrat.ts';
import { BANDES, type LogMel } from './spectre.ts';
import { versS16 } from './wav.ts';

const PICS_PAR_SECONDE = 30;
const DT_MAX = 63;
const EVENTAIL = 5;
const MAX_TRAMES = 10 * 60 * 100; // 10 minutes de trames de 10 ms
const MAX_CODES = 200_000;

interface Pic { t: number; f: number; v: number }

/** Accumulateur d'empreinte, tranche par tranche. */
export class Empreinteur {
  private readonly hash: Hash = createHash('sha256');
  private pics: Pic[] = [];
  private codes: number[] = [];
  private instants: number[] = [];
  private derniereTrame = 0;
  readonly avecConstellation: boolean;

  constructor(avecConstellation = true) { this.avecConstellation = avecConstellation; }

  /** Le son de la tranche (16 kHz), pour le SHA-256. */
  ajouterPcm(x: Float32Array): void { this.hash.update(versS16(x)); }

  /** Les bandes mel de la tranche ; `trame0` = indice global de sa première trame ; `utiles` = trames à prendre. */
  ajouterMel(mel: LogMel, trame0: number, utiles: number): void {
    if (!this.avecConstellation || trame0 >= MAX_TRAMES) return;
    const T = mel.trames, d = mel.data;
    const n = Math.min(utiles, T, MAX_TRAMES - trame0);
    const plancher = mel.max - 60;
    const parBloc = new Map<number, Pic[]>();
    for (let t = 0; t < n; t++) {
      for (let f = 0; f < BANDES; f++) {
        const v = d[f * T + t];
        if (v <= plancher) continue;
        let pic = true;
        for (let df = -2; df <= 2 && pic; df++) {
          const g = f + df; if (g < 0 || g >= BANDES) continue;
          for (let dt = -2; dt <= 2; dt++) {
            const u = t + dt; if (u < 0 || u >= T || (df === 0 && dt === 0)) continue;
            const w = d[g * T + u];
            if (w > v || (w === v && (dt < 0 || (dt === 0 && df < 0)))) { pic = false; break; }
          }
        }
        if (!pic) continue;
        const tg = trame0 + t, bloc = Math.floor(tg / 100);
        let l = parBloc.get(bloc); if (!l) parBloc.set(bloc, (l = []));
        l.push({ t: tg, f, v });
      }
    }
    for (const l of parBloc.values()) {
      l.sort((a, b) => b.v - a.v);
      for (const p of l.slice(0, PICS_PAR_SECONDE)) this.pics.push(p);
    }
    this.pics.sort((a, b) => a.t - b.t || a.f - b.f);
    this.derniereTrame = trame0 + n;
    this.apparier(false);
  }

  /** Relie chaque pic « ancre » aux suivants (5 au plus, écart 1 à 63 trames). */
  private apparier(fin: boolean): void {
    const p = this.pics;
    let k = 0;
    for (; k < p.length; k++) {
      const a = p[k];
      if (!fin && a.t + DT_MAX >= this.derniereTrame) break;
      let pris = 0;
      for (let j = k + 1; j < p.length && pris < EVENTAIL; j++) {
        const dt = p[j].t - a.t;
        if (dt < 1) continue;
        if (dt > DT_MAX) break;
        if (this.codes.length >= MAX_CODES) break;
        this.codes.push(codePaire(a.f, p[j].f, dt));
        this.instants.push(a.t);
        pris++;
      }
    }
    this.pics = p.slice(k);
  }

  /** Termine : le SHA-256 et la constellation. */
  finir(): EmpreinteSon {
    this.apparier(true);
    this.pics = [];
    return { sha: this.hash.digest('hex'), codes: Uint32Array.from(this.codes), instants: Uint32Array.from(this.instants) };
  }
}

/** Code d'une paire : bande 1 (6 bits), bande 2 (6 bits), écart (6 bits), et un repère de version (bits hauts). */
export function codePaire(f1: number, f2: number, dt: number): number {
  return ((1 << 24) | ((f1 & 63) << 12) | ((f2 & 63) << 6) | (dt & 63)) >>> 0;
}

/** Vote : pour chaque son rangé, l'écart d'instant le plus fréquent. `meme` = au moins 20 votes et 5 % des codes. */
export function voterEmpreinte(
  q: EmpreinteSon,
  trouves: Array<{ id: string; code: number; t: number }>,
): Array<{ id: string; score: number; decalageS: number; meme: boolean }> {
  const index = new Map<number, number[]>();
  for (let i = 0; i < q.codes.length; i++) {
    const c = q.codes[i];
    let l = index.get(c); if (!l) index.set(c, (l = []));
    if (l.length < 64) l.push(q.instants[i]);
  }
  const histo = new Map<string, Map<number, number>>();
  for (const r of trouves) {
    const l = index.get(r.code >>> 0);
    if (!l || typeof r.id !== 'string' || !Number.isFinite(r.t)) continue;
    let h = histo.get(r.id); if (!h) histo.set(r.id, (h = new Map()));
    for (const tq of l) { const d = Math.round(r.t) - tq; h.set(d, (h.get(d) ?? 0) + 1); }
  }
  const out: Array<{ id: string; score: number; decalageS: number; meme: boolean }> = [];
  for (const [id, h] of histo) {
    let meilleur = 0, dec = 0;
    for (const [d, n] of h) {
      // Un écart d'une trame de part et d'autre compte aussi (bords des trames).
      const s = n + (h.get(d - 1) ?? 0) + (h.get(d + 1) ?? 0);
      if (s > meilleur) { meilleur = s; dec = d; }
    }
    out.push({ id, score: meilleur, decalageS: Math.round(dec) / 100, meme: meilleur >= 20 && meilleur >= 0.05 * q.codes.length });
  }
  return out.sort((a, b) => b.score - a.score);
}
