// Échantillonnage du prochain morceau à partir des logits : température, noyau (top-p), pénalité de répétition.
//
// Tout passe par le hasard à graine de Noûs (src/brain/nous/hasard.ts) : à graine fixée, la suite est reproductible
// à l'identique. On ne touche jamais aux logits reçus (on travaille sur une copie).

import type { Hasard } from '../nous/hasard.ts';

export interface OptionsEchantillon {
  /** 0 ou moins : le plus probable (déterministe). Sinon aplatit ou durcit la distribution. */
  temperature?: number;
  /** Noyau : on ne garde que les morceaux les plus probables jusqu'à cette masse (1 = désactivé). */
  topP?: number;
  /** Pénalité de répétition sur les morceaux déjà vus (1 = désactivée). */
  penaliteRepetition?: number;
}

/** Applique la pénalité de répétition, en place, sur un tableau de logits : vus → rapprochés de zéro. */
export function appliquerPenalite(logits: Float32Array, recents: ArrayLike<number>, pen: number): void {
  if (!pen || pen === 1) return;
  for (let i = 0; i < recents.length; i++) {
    const id = recents[i];
    if (id < 0 || id >= logits.length) continue;
    const v = logits[id];
    logits[id] = v > 0 ? v / pen : v * pen;
  }
}

/**
 * Choisit le prochain morceau. `recents` : les morceaux déjà émis (pour la pénalité). `h` : hasard à graine.
 * Renvoie l'identifiant du morceau choisi.
 */
export function echantillonner(logits: Float32Array, recents: ArrayLike<number>, h: Hasard, o: OptionsEchantillon): number {
  const V = logits.length;
  if (V === 0) throw new Error('Métis : aucun logit à échantillonner.');
  const temp = o.temperature ?? 0;
  const pen = o.penaliteRepetition ?? 1;

  // Copie de travail (on ne modifie pas les logits reçus).
  const z = Float32Array.from(logits);
  appliquerPenalite(z, recents, pen);

  // Température nulle : on prend le plus probable (déterministe), pénalité comprise.
  if (temp <= 0) {
    let bi = 0, bv = -Infinity;
    for (let v = 0; v < V; v++) if (z[v] > bv) { bv = z[v]; bi = v; }
    return bi;
  }

  // Probabilités adoucies par la température.
  let mx = -Infinity;
  for (let v = 0; v < V; v++) if (z[v] > mx) mx = z[v];
  const p = new Float64Array(V);
  let som = 0;
  for (let v = 0; v < V; v++) { const e = Math.exp((z[v] - mx) / temp); p[v] = e; som += e; }
  const r = 1 / som;
  for (let v = 0; v < V; v++) p[v] *= r;

  // Noyau top-p : trie par probabilité décroissante, garde la plus petite tête de masse ≥ topP.
  const topP = o.topP ?? 1;
  let ordre: Int32Array;
  if (topP < 1) {
    const idx = Array.from({ length: V }, (_, i) => i);
    // Tri stable (par probabilité, puis par identifiant) pour rester reproductible.
    idx.sort((a, b) => (p[b] - p[a]) || (a - b));
    let acc = 0, garde = V;
    for (let i = 0; i < V; i++) { acc += p[idx[i]]; if (acc >= topP) { garde = i + 1; break; } }
    ordre = Int32Array.from(idx.slice(0, garde));
    // Renormalise sur la tête gardée.
    let s2 = 0;
    for (let i = 0; i < ordre.length; i++) s2 += p[ordre[i]];
    const r2 = s2 > 0 ? 1 / s2 : 0;
    for (let i = 0; i < ordre.length; i++) p[ordre[i]] *= r2;
  } else {
    ordre = new Int32Array(V);
    for (let v = 0; v < V; v++) ordre[v] = v;
  }

  // Tirage dans la distribution gardée.
  const u = h.reel();
  let acc = 0;
  for (let i = 0; i < ordre.length; i++) {
    acc += p[ordre[i]];
    if (u < acc) return ordre[i];
  }
  return ordre[ordre.length - 1];
}
