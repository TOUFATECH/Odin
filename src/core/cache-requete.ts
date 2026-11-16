// Caches de requêtes (lot B « répondre vite »). Deux demandes identiques ou rapprochées ne refont pas le
// même travail : le rappel de la mémoire et la consultation du Cerveau sont gardés un court instant, et le
// plongement (embedding) d'une demande — un aller-retour réseau — est gardé tant que le modèle ne change pas.
//
// Invalidation : dès qu'on ÉCRIT en mémoire (nouveau souvenir, oubli) ou dans le Cerveau, le cache des
// rappels/Cerveau est vidé (le résultat pourrait avoir changé). Le cache des plongements, lui, ne dépend que
// du texte et du modèle : il survit aux écritures (le plongement d'une même phrase ne change pas).
//
// Tout est borné (LRU) : la mémoire vive ne gonfle pas. Aucun effet de bord, aucune I/O.

/** Demande « normalisée » pour la clé de cache : sans accents, sans ponctuation, espaces réduits. Pur. */
export function normaliserRequete(q: string): string {
  return q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Petit cache borné, le moins récemment utilisé part en premier (LRU). */
export class CacheLRU<V> {
  private readonly map = new Map<string, V>();
  private readonly max: number;
  constructor(max = 64) { this.max = max; }

  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); } // remonté en « récemment utilisé »
    return v;
  }
  set(k: string, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) { const first = this.map.keys().next().value; if (first === undefined) break; this.map.delete(first); }
  }
  has(k: string): boolean { return this.map.has(k); }
  delete(k: string): void { this.map.delete(k); }
  vider(): void { this.map.clear(); }
  get taille(): number { return this.map.size; }
}

/**
 * Les caches d'un même Odin : rappels/Cerveau (vidés à l'écriture) et plongements (gardés tant que le modèle
 * ne change pas). Générique : la valeur gardée est au choix de l'appelant (liste de souvenirs, contexte du
 * Cerveau…). La clé est la demande normalisée, éventuellement préfixée par un espace de noms.
 */
export class CacheRequetes {
  private readonly rappels: CacheLRU<unknown>;
  private readonly plongements: CacheLRU<Float32Array>;
  private modele = '';

  constructor(opts: { rappels?: number; plongements?: number } = {}) {
    this.rappels = new CacheLRU<unknown>(opts.rappels ?? 64);
    this.plongements = new CacheLRU<Float32Array>(opts.plongements ?? 128);
  }

  /** Lit ou calcule un rappel (ou une consultation du Cerveau) gardé jusqu'à la prochaine écriture. */
  rappel<T>(espace: string, query: string, calcul: () => T): T {
    const k = `${espace}\u0000${normaliserRequete(query)}`;
    const v = this.rappels.get(k);
    if (v !== undefined) return v as T;
    const r = calcul();
    this.rappels.set(k, r);
    return r;
  }

  /** Le plongement déjà calculé d'une demande (pour ce modèle), s'il est en cache. */
  plongement(modele: string, query: string): Float32Array | undefined {
    if (modele !== this.modele) { this.plongements.vider(); this.modele = modele; return undefined; }
    return this.plongements.get(normaliserRequete(query));
  }
  /** Range le plongement d'une demande. */
  poserPlongement(modele: string, query: string, vec: Float32Array): void {
    if (modele !== this.modele) { this.plongements.vider(); this.modele = modele; }
    this.plongements.set(normaliserRequete(query), vec);
  }

  /** À appeler à chaque écriture en mémoire ou dans le Cerveau : les rappels gardés peuvent être périmés. */
  invaliderMemoire(): void { this.rappels.vider(); }
  /** Vide tout (rechargement complet, changement de modèle). */
  viderTout(): void { this.rappels.vider(); this.plongements.vider(); this.modele = ''; }

  get tailleRappels(): number { return this.rappels.taille; }
  get taillePlongements(): number { return this.plongements.taille; }
}
