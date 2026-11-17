// Rééchantillonnage vers 16 kHz, écrit dans Odin : filtre passe-bas « sinus cardinal » fenêtré par Kaiser (β 8,6),
// en forme polyphasée (rapport réduit L/M, par exemple 160/441 pour 44,1 kHz), 96 coefficients par sortie.
// Il travaille PAR TRANCHES avec un état : on pousse des morceaux, il rend ce qui est prêt, et `finir` vide la fin.

import { FS } from './contrat.ts';

const COEFS = 96;
const DEMI = COEFS / 2;
const BETA = 8.6;
/** Part de la bande passante gardée (le reste sert de bande de transition sous la moitié de la fréquence de sortie). */
const BANDE = 0.84;

const pgcd = (a: number, b: number): number => { while (b) [a, b] = [b, a % b]; return a; };

/** Fonction de Bessel modifiée d'ordre 0 (série), pour la fenêtre de Kaiser. */
function bessel0(x: number): number {
  let somme = 1, terme = 1;
  const y = (x * x) / 4;
  for (let k = 1; k < 50; k++) { terme *= y / (k * k); somme += terme; if (terme < 1e-12 * somme) break; }
  return somme;
}

/** Table des coefficients : L phases × 96. */
function tableFiltre(fsIn: number, L: number): Float32Array {
  // Fréquence de coupure en cycles par échantillon d'entrée.
  const fc = (Math.min(fsIn, FS) / 2 / fsIn) * BANDE;
  const t = new Float32Array(L * COEFS);
  const i0b = bessel0(BETA);
  for (let p = 0; p < L; p++) {
    let somme = 0;
    for (let k = 0; k < COEFS; k++) {
      const tau = p / L + (DEMI - 1) - k; // distance (en échantillons d'entrée) entre l'instant voulu et l'échantillon
      const x = 2 * fc * tau;
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const r = tau / DEMI;
      const fen = Math.abs(r) >= 1 ? 0 : bessel0(BETA * Math.sqrt(1 - r * r)) / i0b;
      const v = 2 * fc * sinc * fen;
      t[p * COEFS + k] = v;
      somme += v;
    }
    if (somme !== 0) for (let k = 0; k < COEFS; k++) t[p * COEFS + k] /= somme; // gain unité en continu
  }
  return t;
}

/** Rééchantillonneur avec état, d'une fréquence quelconque (8 à 192 kHz) vers 16 kHz. */
export class Reechantillonneur {
  readonly L: number;
  readonly M: number;
  private readonly table: Float32Array | undefined;
  private tampon = new Float32Array(0);
  /** Indice global du premier échantillon du tampon. */
  private base = 0;
  /** Nombre total d'échantillons d'entrée reçus. */
  private recus = 0;
  /** Indice de la prochaine sortie. */
  private n = 0;

  readonly fsIn: number;

  constructor(fsIn: number) {
    this.fsIn = fsIn;
    const g = pgcd(FS, fsIn);
    this.L = FS / g;
    this.M = fsIn / g;
    this.table = fsIn === FS ? undefined : tableFiltre(fsIn, this.L);
  }

  /** Pousse un morceau ; rend les échantillons de sortie prêts. */
  pousser(x: Float32Array): Float32Array {
    if (!this.table) { this.recus += x.length; return x.slice(); }
    const t = new Float32Array(this.tampon.length + x.length);
    t.set(this.tampon, 0); t.set(x, this.tampon.length);
    this.tampon = t;
    this.recus += x.length;
    return this.produire(false);
  }

  /** Vide la fin (bords complétés par des zéros). */
  finir(): Float32Array {
    if (!this.table) return new Float32Array(0);
    return this.produire(true);
  }

  private produire(fin: boolean): Float32Array {
    const table = this.table!;
    const { L, M } = this;
    // Nombre total de sorties pour ce qui a été reçu : ceil(recus × L / M).
    const totalSorties = Math.ceil((this.recus * L) / M);
    const sorties = new Float32Array(Math.max(0, totalSorties - this.n));
    let nb = 0;
    const buf = this.tampon, base = this.base, fini = base + buf.length;
    while (this.n < totalSorties) {
      const pos = this.n * M;
      const i = Math.floor(pos / L);
      const p = pos - i * L;
      const premier = i - (DEMI - 1);
      const dernier = premier + COEFS - 1;
      if (!fin && dernier >= fini) break;
      let s = 0;
      const off = p * COEFS;
      for (let k = 0; k < COEFS; k++) {
        const j = premier + k;
        if (j < base || j >= fini) continue; // hors du tampon : zéro (début du son ou fin complétée)
        s += buf[j - base] * table[off + k];
      }
      sorties[nb++] = s;
      this.n++;
    }
    // On garde seulement ce qui sert encore à la prochaine sortie.
    const prochain = Math.floor((this.n * M) / L) - (DEMI - 1);
    const garder = Math.max(base, Math.min(prochain, fini));
    if (garder > base) { this.tampon = buf.slice(garder - base); this.base = garder; }
    return nb === sorties.length ? sorties : sorties.slice(0, nb);
  }
}

/** Rééchantillonne d'un coup (pratique pour les essais et les petits sons). */
export function reechantillonner(x: Float32Array, fsIn: number): Float32Array {
  if (fsIn === FS) return x.slice();
  const r = new Reechantillonneur(fsIn);
  const a = r.pousser(x), b = r.finir();
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}
