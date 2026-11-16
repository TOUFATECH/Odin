// Vecteurs des souvenirs gardés DÉCODÉS en mémoire vive (lot B « répondre vite »).
//
// Avant : nearest() décodait le base64 et réallouait un Float32Array à CHAQUE appel, puis recalculait
// la norme de chaque vecteur à chaque appel (10-12 ms pour quelques milliers de souvenirs). Ici, chaque
// vecteur est décodé UNE fois, gardé avec sa norme pré-calculée, et re-décodé seulement si son base64 a
// changé (nouveau plongement). Le cosinus ne fait plus qu'un produit scalaire et une division.
//
// Le pré-filtre BM25 (optionnel) restreint le calcul aux souvenirs déjà retrouvés par les mots : on ne
// calcule le cosinus que sur des candidats, pas sur toute la mémoire. Il reste cohérent : si aucun
// candidat n'est donné, le balayage complet est fait (mêmes voisins qu'avant).

export interface Vecteur { f: Float32Array; norm: number }

/** Décode un vecteur base64 en Float32Array, exactement comme le faisait nearest(). Pur. */
export function decoder(src: string): Float32Array {
  const b = Buffer.from(src, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** Norme euclidienne (jamais zéro : un vecteur nul rend 1, pour ne pas diviser par zéro). Pur. */
export function norme(f: Float32Array): number {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return Math.sqrt(s) || 1;
}

/** Cosinus de deux vecteurs dont on connaît déjà les normes. Pur. */
export function cosinus(a: Float32Array, na: number, b: Float32Array, nb: number): number {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += a[i] * b[i];
  return d / (na * nb);
}

/**
 * Garde les vecteurs décodés en RAM. La clé est l'identifiant du souvenir ; on garde le base64 d'origine
 * pour re-décoder uniquement quand il a changé. Aucune lecture disque : on reçoit le base64 déjà en mémoire.
 */
export class CacheVecteurs {
  private readonly cache = new Map<number, { src: string; v: Vecteur }>();

  /** Le vecteur décodé (depuis la RAM si le base64 n'a pas changé, sinon décodé puis gardé). */
  obtenir(id: number, src: string): Vecteur {
    const hit = this.cache.get(id);
    if (hit && hit.src === src) return hit.v;
    const f = decoder(src);
    const v: Vecteur = { f, norm: norme(f) };
    this.cache.set(id, { src, v });
    return v;
  }

  /** Oublie un souvenir effacé (libère sa place en RAM). */
  oublier(id: number): void { this.cache.delete(id); }
  /** Vide tout (changement de modèle, mémoire rechargée). */
  vider(): void { this.cache.clear(); }
  get taille(): number { return this.cache.size; }
}
