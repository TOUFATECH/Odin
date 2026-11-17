// Mathésis — le signal « Odin répond » : posé par le cœur d'Odin au début de chaque réponse et levé à la fin. Tant qu'il
// est posé, le travail autonome (recherches, robot de lecture, dossiers ouverts) s'arrête à la demande suivante.
// Sans dépendance : le cœur l'importe sans rien charger d'autre. Un oubli de fin ne bloque pas Mathésis pour toujours :
// une réponse est tenue pour finie au bout de 10 minutes.

const enCours = new Map<number, number>();
let suivant = 0;
const DUREE_MAX = 10 * 60_000;

/** Odin commence à répondre. Rend la fonction à appeler quand il a fini (sans effet si appelée deux fois). */
export function odinCommenceARepondre(maintenant: () => number = Date.now): () => void {
  const id = ++suivant;
  enCours.set(id, maintenant());
  return () => { enCours.delete(id); };
}

/** Odin est-il en train de répondre ? */
export function odinRepond(maintenant: () => number = Date.now): boolean {
  const n = maintenant();
  for (const [id, debut] of enCours) if (n - debut > DUREE_MAX) enCours.delete(id);
  return enCours.size > 0;
}

/** (essais) oublie tout. */
export function oublierReponses(): void { enCours.clear(); }
