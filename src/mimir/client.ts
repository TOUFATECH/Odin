// Mímir — le conseiller d'Odin : les questions TYPÉES qu'il pose à son juge (oui/non, choix, score) et la forme des
// réponses (des probabilités). Odin lui demande des JUGEMENTS ; les DÉCISIONS restent dans le code (voir decisions.ts),
// visibles et testables. Le seul juge est le juge local d'Odin (local.ts), du code sans modèle : décision du propriétaire
// (17/11/2026), aucun modèle qui ne soit pas celui d'Odin. Ce fichier ne garde que les types et la lecture des réponses
// (decisions.ts et questions.ts, du noyau, les importent d'ici).

export type Question =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; legend?: Record<string, string>; confidence?: number };

export type Answers = Record<string, Answer>;

/** Toute source de jugements : le juge local, ou un faux en test. */
export type Judge = (state: Record<string, unknown>, questions: Record<string, Question>, signal?: AbortSignal) => Promise<Answers>;

// ---------- Lecture des réponses ----------

/** Probabilité « oui » d'une question noul. Lève une erreur si la réponse a un autre type. */
export function yes(a: Answers, name: string): number {
  const x = a[name];
  if (!x || x.type !== 'noul' || typeof x.noul !== 'number') throw new Error(`Réponse noul attendue pour « ${name} »`);
  return x.noul;
}

export function choice(a: Answers, name: string): { top: string; p: number; probabilities: Record<string, number> } {
  const x = a[name];
  if (!x || x.type !== 'choice') throw new Error(`Réponse choice attendue pour « ${name} »`);
  return { top: x.choice, p: x.probabilities[x.choice] ?? 0, probabilities: x.probabilities };
}
