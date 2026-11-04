// Choix du juge de Mímir selon la configuration, et journal de chaque jugement.
import { appendFileSync } from 'node:fs';
import type { Redactor } from '../heimdall/redact.ts';
import type { Router } from '../providers/router.ts';
import { type Judge, jevJudge } from './client.ts';
import type { MimirConfig } from './decisions.ts';
import { cascadeJudge, crossCheckJudge, llmJudge } from './llm.ts';
import { localJudge } from './local.ts';

export interface JudgeDeps {
  router?: Router;
  cheapRouter?: Router;
  redactor?: Redactor;
  logFile?: string;
  env?: NodeJS.ProcessEnv;
  onUsage?(tin: number, tout: number, cost: number): void;
  /** Décision risquée : demander l'avis de plusieurs modèles (si au moins deux sont configurés). */
  crossCheck?: boolean;
}

const RISK_KEYS = ['deletes', 'sends_out', 'system_change', 'money', 'private_data', 'irreversible'];
/** Après le premier juge : si une question de risque penche vers oui ou reste incertaine, second avis multi-modèles. */
export function riskyCrossCheck(first: Judge, cross: Judge): Judge {
  return async (state, questions, signal) => {
    const a = await first(state, questions, signal);
    const riskQs = Object.keys(questions).filter((n) => RISK_KEYS.includes(n));
    if (!riskQs.length) return a;
    const worrying = riskQs.some((n) => { const x = a[n]; return x?.type === 'noul' && x.noul > 0.3; });
    if (!worrying) return a;
    try {
      const b = await cross(state, questions, signal);
      // On garde, question par question, l'avis le plus prudent.
      const out: typeof a = { ...a };
      for (const n of Object.keys(questions)) {
        const x = a[n], y = b[n];
        if (x?.type === 'noul' && y?.type === 'noul') out[n] = { type: 'noul', noul: n === 'requested' ? Math.min(x.noul, y.noul) : Math.max(x.noul, y.noul) };
        else if (y && !x) out[n] = y;
      }
      return out;
    } catch { return a; }
  };
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
  // Vérification croisée : si le juge principal voit un danger ou hésite sur une ACTION, on demande
  // l'avis de plusieurs modèles différents avant de trancher.
  if (d.crossCheck && d.router && d.router.routes.length >= 2) {
    judge = riskyCrossCheck(judge, crossCheckJudge(d.router));
    name = `${name}+croisé`;
  }
  return { judge: withLog(judge, name, d.logFile, d.redactor), name, warning };
}
