// Hasard à graine pour Noûs — le cerveau profond d'Odin.
//
// Aucun Math.random() ne doit entrer dans le moteur : un entraînement et une génération doivent se rejouer à
// l'identique à partir de la même graine (la graine est rangée dans le point de reprise). On se sert d'un petit
// générateur rapide et déterministe (« mulberry32 », fonctionnement public, aucun code recopié) : 32 bits d'état,
// une multiplication et quelques décalages par tirage.

/** Un tirage dans [0, 1[ à partir d'un état interne de 32 bits. */
export interface Hasard {
  /** Prochain réel dans [0, 1[. */
  reel(): number;
  /** Prochain entier dans [0, n[ (n ≥ 1). */
  entier(n: number): number;
  /** Prochain tirage gaussien (moyenne 0, écart-type 1). */
  gauss(): number;
  /** La graine de départ (pour la ranger dans un point de reprise). */
  readonly graine: number;
}

/** Générateur mulberry32 : déterministe, rapide, 32 bits d'état. */
export function hasard(graine: number): Hasard {
  let a = graine >>> 0;
  let reserve = Number.NaN; // deuxième valeur gaussienne (Box-Muller en donne deux à la fois)
  const reel = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entier = (n: number): number => Math.floor(reel() * n);
  const gauss = (): number => {
    if (!Number.isNaN(reserve)) { const v = reserve; reserve = Number.NaN; return v; }
    // Box-Muller : deux uniformes → deux normales. u1 serré loin de 0 pour éviter log(0).
    let u1 = reel(); const u2 = reel();
    if (u1 < 1e-12) u1 = 1e-12;
    const r = Math.sqrt(-2 * Math.log(u1)); const th = 2 * Math.PI * u2;
    reserve = r * Math.sin(th);
    return r * Math.cos(th);
  };
  return { reel, entier, gauss, graine: graine >>> 0 };
}

/** Mélange une graine avec un numéro de branche (fil, couche…) : des flux indépendants mais reproductibles. */
export function graineDe(base: number, branche: number): number {
  let x = (base ^ Math.imul(branche + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** Mélange de Fisher-Yates à graine : réordonne un tableau d'indices [0, n[ sans Math.random. */
export function melange(n: number, h: Hasard): Int32Array {
  const ordre = new Int32Array(n);
  for (let i = 0; i < n; i++) ordre[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = h.entier(i + 1);
    const tmp = ordre[i]; ordre[i] = ordre[j]; ordre[j] = tmp;
  }
  return ordre;
}
