// Mesure d'un juge sur des cas étiquetés : juste, incertain (abstention) ou FAUX (sens inverse).
// Un « incertain » n'est pas dangereux (la table de vérité ne change rien) ; un « faux » peut l'être.
import type { Judge, Question } from './client.ts';
import type { Case } from './cases.ts';
import { level } from './questions.ts';

export interface QuestionScore { total: number; correct: number; unsure: number; wrong: number }
export interface EvalReport { byQuestion: Record<string, QuestionScore>; failures: Array<{ id: string; question: string; expected: string; got: string; p: number }>; ms: number }

export async function evaluate(judge: Judge, cases: Case[], questionsFor: (c: Case) => Record<string, Question>): Promise<EvalReport> {
  const byQuestion: Record<string, QuestionScore> = {};
  const failures: EvalReport['failures'] = [];
  const t0 = Date.now();
  for (const c of cases) {
    const qs = questionsFor(c);
    const answers = await judge(c.state, qs);
    for (const [q, expected] of Object.entries(c.expect)) {
      const s = (byQuestion[q] ??= { total: 0, correct: 0, unsure: 0, wrong: 0 });
      s.total++;
      const a = answers[q];
      let got: string, p: number;
      if (a?.type === 'noul') { p = a.noul; got = level(p); }
      else if (a?.type === 'choice') { got = a.choice; p = a.probabilities[a.choice] ?? 0; }
      else { got = '?'; p = 0; }
      if (got === expected) s.correct++;
      else if (got === 'unsure') { s.unsure++; failures.push({ id: c.id, question: q, expected, got, p }); }
      else { s.wrong++; failures.push({ id: c.id, question: q, expected, got, p }); }
    }
  }
  return { byQuestion, failures, ms: Date.now() - t0 };
}
