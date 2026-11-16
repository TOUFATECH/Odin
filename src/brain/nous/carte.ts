// Les liens du Cerveau entre Noûs et le reste, et à l'intérieur de Noûs (la dictée du propriétaire).
//  - Noûs a sa place sur la carte : le nœud 'noos'. Un lien entre Noûs et un sujet MONTE quand Noûs gagne
//    sur ce sujet, et BAISSE (par l'oubli) quand il perd — Odin sait ainsi sur quoi Noûs est bon.
//  - Noûs NOURRIT le Cerveau : ses plongements proposent des liens « appris » entre notes qui se ressemblent,
//    soumis aux mêmes plafonds d'oubli que les autres liens appris (APPRIS_PAR_POINT, TOTAL_APPRIS).
//
// On NE CHANGE PAS le modèle des liens (src/brain/neurones.ts) : on se sert de renforcer() et des réglages R.
// Module pur : il calcule des mises à jour et des propositions, l'écriture reste au Cerveau.

import { forceDe, nouvelle, R, renforcer, type Origine, type Synapse } from '../neurones.ts';

/** L'identifiant du nœud de Noûs sur la carte du Cerveau. */
export const NOEUD_NOOS = 'noos';

/** Clé triée d'un lien entre Noûs et un sujet (note « n:… » ou appli « a:… »). */
export function paireNoos(sujet: string): [string, string] {
  return NOEUD_NOOS < sujet ? [NOEUD_NOOS, sujet] : [sujet, NOEUD_NOOS];
}

/**
 * Apprend d'un duel sur un sujet. Si Noûs a gagné, le lien noos↔sujet se renforce (origine 'appris') ;
 * s'il a perdu, on ne le renforce pas (il baissera tout seul par l'oubli). Crée le lien au besoin.
 * Rend le lien (mis à jour) et la part retenue.
 */
export function apprendreDuel(lien: Synapse | undefined, sujet: string, gagne: boolean, now: number): { lien: Synapse; retenu: number } {
  const [a, b] = paireNoos(sujet);
  const l = lien ?? nouvelle(a, b, 'appris', now);
  if (gagne) {
    const retenu = renforcer(l, 1, now, 'appris');
    return { lien: l, retenu };
  }
  // Perte : pas de renforcement. On rafraîchit juste la force (décroissance) sans rien ajouter.
  l.w = forceDe(l, 'appris', now);
  l.t = now;
  return { lien: l, retenu: 0 };
}

/** Une proposition de lien « appris » entre deux notes proches dans l'espace de plongements de Noûs. */
export interface LienPropose { a: string; b: string; similarite: number }

/**
 * Propose des liens appris entre notes qui se ressemblent (similarité ≥ seuil), sous les plafonds existants :
 * au plus APPRIS_PAR_POINT liens appris par point, et TOTAL_APPRIS au total. On garde les plus proches d'abord.
 */
export function proposerLiensAppris(
  candidats: readonly LienPropose[],
  seuil: number,
  dejaParPoint: (id: string) => number,
  totalActuel: number,
): LienPropose[] {
  const retenus: LienPropose[] = [];
  const ajoutParPoint = new Map<string, number>();
  let total = totalActuel;
  const tries = candidats
    .filter((c) => c.a !== c.b && Number.isFinite(c.similarite) && c.similarite >= seuil)
    .sort((x, y) => y.similarite - x.similarite || (clef(x) < clef(y) ? -1 : 1));
  for (const c of tries) {
    if (total >= R.TOTAL_APPRIS) break;
    const na = (dejaParPoint(c.a) ?? 0) + (ajoutParPoint.get(c.a) ?? 0);
    const nb = (dejaParPoint(c.b) ?? 0) + (ajoutParPoint.get(c.b) ?? 0);
    if (na >= R.APPRIS_PAR_POINT || nb >= R.APPRIS_PAR_POINT) continue;
    retenus.push(c);
    ajoutParPoint.set(c.a, (ajoutParPoint.get(c.a) ?? 0) + 1);
    ajoutParPoint.set(c.b, (ajoutParPoint.get(c.b) ?? 0) + 1);
    total += 1;
  }
  return retenus;
}

function clef(c: LienPropose): string { return c.a < c.b ? `${c.a}\u0001${c.b}` : `${c.b}\u0001${c.a}`; }

/** Similarité cosinus de deux plongements (vecteurs normalisés ou non). Pur, sans hasard. */
export function cosinus(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let p = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { p += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? p / d : 0;
}

/** Force affichable d'un lien noos↔sujet (ce que la carte montre). */
export function forceNoos(lien: Synapse | undefined, now: number): number {
  return forceDe(lien, 'appris' as Origine, now);
}
