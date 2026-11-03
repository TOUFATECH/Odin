// Choix du juge de Mímir selon la configuration, et journal de chaque jugement.
import { appendFileSync } from 'node:fs';
import type { Redactor } from '../heimdall/redact.ts';
import type { Router } from '../providers/router.ts';
import { type Judge, jevJudge } from './client.ts';
import type { MimirConfig } from './decisions.ts';
import { cascadeJudge, llmJudge } from './llm.ts';
import { localJudge } from './local.ts';

export interface JudgeDeps {
  router?: Router;
  cheapRouter?: Router;
  redactor?: Redactor;
  logFile?: string;
  env?: NodeJS.ProcessEnv;
  onUsage?(tin: number, tout: number, cost: number): void;
}

/** Enregistre l'état, les questions et les réponses de chaque jugement (rejouable, secrets masqués). */
export function withLog(judge: Judge, name: string, file?: string, redactor?: Redactor): Judge {
  if (!file) return judge;
  return async (state, questions, signal) => {
    const t0 = Date.now();
    const answers = await judge(state, questions, signal);
    const line = JSON.stringify({ t: new Date().toISOString(), judge: name, ms: Date.now() - t0, state, questions: Object.keys(questions), answers });
    try { appendFileSync(file, (redactor ? redactor.redact(line) : line) + '\n'); } catch { /* journal facultatif */ }
    return answers;
  };
}

export function buildJudge(cfg: MimirConfig, d: JudgeDeps): { judge: Judge; name: string; warning?: string } {
  const env = d.env ?? process.env;
  const key = env[cfg.apiKeyEnv];
  const jev = () => jevJudge({ apiKey: key!, model: cfg.model, baseUrl: cfg.baseUrl, timeoutMs: cfg.timeoutMs, onUsage: d.onUsage });
  const llm = () => llmJudge((d.cheapRouter ?? d.router)!);
  let judge: Judge, name: string, warning: string | undefined;
  const mode = cfg.judge;
  if ((mode === 'jev' || mode === 'local+jev') && !key) {
    judge = localJudge(); name = 'local';
    warning = `clé ${cfg.apiKeyEnv} absente : juge local utilisé à la place de Jev`;
  } else if ((mode === 'llm' || mode === 'local+llm') && !d.router && !d.cheapRouter) {
    judge = localJudge(); name = 'local';
    warning = 'aucun modèle configuré : juge local utilisé';
  } else if (mode === 'jev' || (mode === 'auto' && key)) { judge = jev(); name = 'jev'; }
  else if (mode === 'local+jev') { judge = cascadeJudge(localJudge(), jev()); name = 'local+jev'; }
  else if (mode === 'llm') { judge = llm(); name = 'llm'; }
  else if (mode === 'local+llm') { judge = cascadeJudge(localJudge(), llm()); name = 'local+llm'; }
  else { judge = localJudge(); name = 'local'; }
  return { judge: withLog(judge, name, d.logFile, d.redactor), name, warning };
}
