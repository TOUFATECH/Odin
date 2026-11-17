// Odin est-il en train de répondre ? Un simple compteur, tenu par Agent.run (début et fin de CHAQUE réponse, de
// n'importe quel canal), et des abonnés prévenus dès le DÉBUT d'une réponse : l'entraînement de Noûs s'arrête alors
// tout de suite, sans attendre la tâche périodique. Rien d'autre ici : aucun calcul, aucune attente.

let enCours = 0;
const abonnes = new Set<() => void>();

/** Une réponse commence. Rend la fonction à appeler quand elle finit (une seule fois). */
export function debutReponse(): () => void {
  enCours++;
  for (const f of abonnes) { try { f(); } catch { /* un abonné ne gêne jamais la réponse */ } }
  let fini = false;
  return () => { if (!fini) { fini = true; enCours = Math.max(0, enCours - 1); } };
}
/** Nombre de réponses en cours. */
export function reponsesEnCours(): number { return enCours; }
/** Être prévenu au début de chaque réponse. Rend de quoi se désabonner. */
export function quandOdinRepond(f: () => void): () => void { abonnes.add(f); return () => { abonnes.delete(f); }; }
