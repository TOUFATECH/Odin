// Mímir — le conseiller d'Odin. Client du modèle « System One » Jev de TypeSafe :
// il répond à des questions TYPÉES (oui/non, choix, score) avec des probabilités
// calibrées. Odin lui demande des JUGEMENTS ; les DÉCISIONS restent dans le code
// (voir decisions.ts), visibles et testables.
//
// API : POST https://api.typesafe.ai/v1/systemone (jeton JEV_API_KEY)
// Corps : { model, state, questions: { <nom>: { type, instructions, criteria? } } }
// Réponse : { model, answers: { <nom>: { type, noul | choice+probabilities | score+probabilities } }, usage }
// Référence à jour : https://docs.typesafe.ai/llms.txt et https://api.typesafe.ai/openapi.json

import { appendFileSync } from 'node:fs';
import type { Redactor } from '../heimdall/redact.ts';
import { HttpError } from '../providers/http.ts';

export type Question =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] };

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; legend?: Record<string, string>; confidence?: number };

export type Answers = Record<string, Answer>;

/** Toute source de jugements : le vrai Jev, ou un faux en test. */
export type Judge = (state: Record<string, unknown>, questions: Record<string, Question>, signal?: AbortSignal) => Promise<Answers>;

export interface JevOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  /** Journal de chaque requête (charge utile exacte, masquée) pour pouvoir la rejouer. */
  logFile?: string;
  redactor?: Redactor;
  onUsage?(tokensIn: number, tokensOut: number, costUsd: number): void;
}

export function jevJudge(o: JevOptions): Judge {
  return async (state, questions, signal) => {
    const body = { model: o.model, state, questions };
    const started = Date.now();
    const res = await fetch(`${o.baseUrl.replace(/\/$/, '')}/v1/systemone`, {
      method: 'POST',
      headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(o.timeoutMs)]) : AbortSignal.timeout(o.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text, res.headers.get('retry-after'));
    const data = JSON.parse(text) as { model?: string; answers?: Answers; usage?: { input_tokens?: number; output_tokens?: number } };
    if (!data.answers) throw new Error('Réponse Jev sans « answers »');
    for (const name of Object.keys(questions)) if (!data.answers[name]) throw new Error(`Réponse Jev incomplète : « ${name} » manquant`);
    const cost = Number(res.headers.get('x-cost-usd') ?? 0) || 0;
    o.onUsage?.(data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0, cost);
    if (o.logFile) {
      const line = { t: new Date().toISOString(), ms: Date.now() - started, model: data.model, request: body, answers: data.answers, requestId: res.headers.get('x-typesafe-request-id') };
      try { appendFileSync(o.logFile, (o.redactor ? o.redactor.redact(JSON.stringify(line)) : JSON.stringify(line)) + '\n'); } catch { /* journal facultatif */ }
    }
    return data.answers;
  };
}

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
