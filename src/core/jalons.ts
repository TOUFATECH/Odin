// Jalons de temps d'un tour (lot B « répondre vite ») : on pose un chrono autour de chaque sous-étape
// (chargement des acquis, rappel par mots, plein texte, plongement, voisins, Cerveau, modèle, relecture)
// pour VOIR où part vraiment le temps, au lieu du seul total du tour. Le découpage est rangé dans le
// journal des routages (recordRoute) et peut être montré dans la réponse (« mémoire X ms · Cerveau Y ms »).
//
// Rien de coûteux : performance.now() et une petite table de cumuls. Aucun effet de bord, aucune I/O.

import { performance } from 'node:perf_hooks';

/** Noms d'étapes communs, pour que l'affichage et le journal parlent le même langage. */
export const ETAPE = {
  chargement: 'chargement', // relecture des acquis / réflexes
  direct: 'direct', // chemin court (réflexe / acquis)
  rappel: 'rappel', // rappel de la mémoire par les mots (BM25)
  fts: 'fts', // recherche plein texte
  embed: 'embed', // plongement de la demande (réseau)
  voisins: 'voisins', // plus proches voisins (cosinus)
  cerveau: 'cerveau', // consultation du Cerveau (notes, liens, applis)
  modele: 'modele', // appel au modèle
  relecture: 'relecture', // relecture par un second modèle
} as const;

export type NomEtape = string;

export class Jalons {
  private readonly cumuls = new Map<NomEtape, number>();
  private readonly depart = performance.now();

  /** Mesure une étape synchrone et rend son résultat. */
  mesure<T>(nom: NomEtape, fn: () => T): T {
    const t = performance.now();
    try { return fn(); } finally { this.ajouter(nom, performance.now() - t); }
  }

  /** Mesure une étape asynchrone et rend son résultat. */
  async mesureAsync<T>(nom: NomEtape, fn: () => Promise<T>): Promise<T> {
    const t = performance.now();
    try { return await fn(); } finally { this.ajouter(nom, performance.now() - t); }
  }

  /** Démarre un chrono manuel ; rend une fonction à appeler à la fin de l'étape. */
  debut(nom: NomEtape): () => void {
    const t = performance.now();
    return () => this.ajouter(nom, performance.now() - t);
  }

  /** Ajoute (cumule) un temps en millisecondes à une étape. Un temps non fini est ignoré. */
  ajouter(nom: NomEtape, ms: number): void {
    if (!nom || !Number.isFinite(ms) || ms < 0) return;
    this.cumuls.set(nom, (this.cumuls.get(nom) ?? 0) + ms);
  }

  /** Le temps d'une étape (0 si jamais mesurée). */
  de(nom: NomEtape): number { return this.cumuls.get(nom) ?? 0; }
  has(nom: NomEtape): boolean { return this.cumuls.has(nom); }

  /** Le découpage par étape, arrondi au centième de milliseconde (lisible, stable). */
  decoupage(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const [k, v] of this.cumuls) o[k] = Math.round(v * 100) / 100;
    return o;
  }

  /** Somme des étapes mesurées (≈ total en série ; plus petit que le total si des bouts ne sont pas mesurés). */
  get somme(): number { let s = 0; for (const v of this.cumuls.values()) s += v; return s; }
  /** Temps total écoulé depuis la création des jalons. */
  get total(): number { return performance.now() - this.depart; }
}
