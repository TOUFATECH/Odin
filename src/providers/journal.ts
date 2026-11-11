// Journal des routages : pour chaque appel à une IA, Odin garde qui l'a traité, pour quoi, pourquoi
// ce modèle-là, quels autres ont été essayés avant (et pourquoi ils ont échoué), le temps, les jetons
// et le coût. C'est la seule source de vérité pour répondre à « quelle IA a traité ma demande ? » :
// la configuration dit l'ordre prévu, le journal dit ce qui s'est réellement passé.
//
// Le tour en cours (session, canal, début de la demande) suit chaque appel grâce à
// AsyncLocalStorage : le routeur n'a rien à recevoir en paramètre, et les sous-agents, la relecture
// ou le juge appelés pendant le tour sont rattachés à la même demande.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RouteAttempt {
  provider: string;
  ok: boolean;
  /** Raison de l'échec, courte (jamais de clé : les messages d'erreur sont masqués avant). */
  error?: string;
  ms: number;
}

export interface RouteEntry {
  at: number;
  turnId: string;
  sessionId: string;
  channel: string;
  /** Début de la demande d'origine (masqué), pour la reconnaître dans l'historique. */
  request: string;
  /** Rôle de l'appel : réponse, sous-agent, relecture, résumé, juge, vision… */
  purpose: string;
  /** Fournisseur qui a répondu (vide si tous ont échoué). */
  provider: string;
  /** Nom lisible : « Claude Sonnet 5.5 (Anthropic) ». */
  label: string;
  tier: string;
  minTier: string;
  /** Besoin détecté pour la tâche (code, recherche, maison…). */
  need: string;
  /** Pourquoi ce modèle : palier, spécialité, réussite mesurée, secours… */
  reason: string;
  attempts: RouteAttempt[];
  ok: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface RouteContext {
  turnId: string;
  sessionId: string;
  channel: string;
  request: string;
  need?: string;
  /** « sous-agent » pour les tours délégués. */
  role?: string;
  /** Appels de ce tour (rempli par le routeur), pour dire tout de suite qui a répondu. */
  entries: RouteEntry[];
}

const store = new AsyncLocalStorage<RouteContext>();

export function withRouteContext<T>(ctx: RouteContext, fn: () => T): T { return store.run(ctx, fn); }
export function routeContext(): RouteContext | undefined { return store.getStore(); }

/** Nom du service derrière une adresse compatible OpenAI. Pur. */
export function serviceOf(baseUrl: string | undefined): string {
  const u = (baseUrl ?? '').toLowerCase();
  if (!u || u.includes('api.openai.com')) return 'openai';
  if (u.includes('openrouter.ai')) return 'openrouter';
  if (u.includes('deepseek.com')) return 'deepseek';
  if (u.includes('moonshot.ai') || u.includes('moonshot.cn') || u.includes('kimi.ai')) return 'kimi';
  if (u.includes('nousresearch')) return 'nous';
  if (/localhost:11434|127\.0\.0\.1:11434/.test(u)) return 'ollama';
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(u)) return 'local';
  return 'compatible';
}

const SERVICE: Record<string, string> = {
  anthropic: 'Anthropic', 'openai-codex': 'ChatGPT Codex', openai: 'OpenAI', openrouter: 'OpenRouter', deepseek: 'DeepSeek',
  kimi: 'Kimi · Moonshot', nous: 'Nous', ollama: 'Ollama, local', local: 'local', compatible: 'service compatible', mock: 'Modèle de test', jev: 'Jev',
};

/** « claude-sonnet-5-5 » → « Claude Sonnet 5.5 », « gpt-6-luna » → « GPT-6 Luna ». Pur. */
export function prettyModel(model: string): string {
  const m = model.split('/').pop() ?? model;
  return m
    .replace(/(\d)-(\d)(?!\d*b\b)/g, '$1.$2')
    .split(/[-_:]/)
    .filter(Boolean)
    .map((w) => (/^(gpt|glm|qwq)$/i.test(w) ? w.toUpperCase() : /^(gpt)(\d.*)$/i.test(w) ? w.toUpperCase() : /^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/^GPT (\d)/, 'GPT-$1')
    .replace(/^Deepseek/, 'DeepSeek');
}

/** Nom lisible d'un fournisseur à partir de son nom interne « service:modèle ». Pur. */
export function providerLabel(name: string): string {
  if (!name) return 'aucune IA';
  const i = name.indexOf(':');
  if (i < 0) return SERVICE[name] ?? name;
  const svc = name.slice(0, i), model = name.slice(i + 1);
  return `${prettyModel(model)} (${SERVICE[svc] ?? svc})`;
}

const PURPOSE_TXT: Record<string, string> = { agent: 'réponse', 'sous-agent': 'sous-agent', relecture: 'relecture', juge: 'jugement', 'avis croisé': 'avis croisé' };

/** Résumé d'un tour : « Claude Sonnet 5.5 (Anthropic) a répondu · relu par GPT-6 Luna (ChatGPT Codex) ». Pur. */
export function turnSummary(entries: RouteEntry[]): { line: string; models: Array<{ label: string; purpose: string; calls: number; costUsd: number }> } {
  const by = new Map<string, { label: string; purpose: string; calls: number; costUsd: number }>();
  for (const e of entries) {
    if (!e.ok) continue;
    const k = `${e.provider}|${e.purpose}`;
    const v = by.get(k) ?? { label: e.label, purpose: e.purpose, calls: 0, costUsd: 0 };
    v.calls++; v.costUsd += e.costUsd; by.set(k, v);
  }
  const direct = entries.find((e) => e.ok && e.purpose === 'sans-ia');
  if (direct) return { line: `fait sans IA (${direct.reason})`, models: [] };
  const models = [...by.values()];
  const main = models.filter((m) => m.purpose === 'agent');
  const others = models.filter((m) => m.purpose !== 'agent');
  const parts: string[] = [];
  if (main.length) parts.push(`${main.map((m) => m.label).join(' puis ')} a répondu`);
  for (const o of others) parts.push(`${PURPOSE_TXT[o.purpose] ?? o.purpose} : ${o.label}`);
  // Les tâches de fond (fil, apprentissage…) qui n'ont pas trouvé de modèle ne gênent pas la réponse : non comptées.
  const failed = entries.filter((e) => !e.ok && ['agent', 'sous-agent', 'relecture', 'vision', 'recherche'].includes(e.purpose)).length;
  if (!models.length && failed) parts.push('aucune IA joignable : réponse sans IA');
  else if (failed) parts.push(`${failed} appel${failed > 1 ? 's' : ''} sans réponse`);
  return { line: parts.join(' · '), models };
}

/** Texte lisible d'une entrée, pour l'agent, la commande /ia et le terminal. Pur. */
export function describeEntry(e: RouteEntry): string {
  const when = new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const tried = e.attempts.filter((a) => !a.ok);
  const fall = tried.length ? ` ; avant : ${[...new Set(tried.map((a) => `${providerLabel(a.provider)} (${a.error ?? 'échec'})`))].join(', ')}` : '';
  const cost = e.costUsd > 0 ? `, ${e.costUsd.toFixed(4)} $` : '';
  if (e.purpose === 'sans-ia') return `${when} · fait sans IA · ${e.reason}${e.request ? ` · demande « ${e.request} »` : ''} [${e.channel}, tour ${e.turnId}]`;
  const who = e.ok ? providerLabel(e.provider) : 'aucune IA (toutes ont échoué)';
  return `${when} · ${PURPOSE_TXT[e.purpose] ?? e.purpose} · ${who} · ${(e.ms / 1000).toFixed(1)} s, ${e.tokensIn + e.tokensOut} jetons${cost} · ${e.reason}${fall}${e.request ? ` · demande « ${e.request} »` : ''} [${e.channel}, tour ${e.turnId}]`;
}

/** Ce qu'il faut du journal (Muninn le fournit) : gardé abstrait pour les tests. */
export interface RouteSource {
  routes(q: { limit?: number; sessionId?: string; turnId?: string; since?: number }): RouteEntry[];
  recentTurns(sessionId: string, limit?: number): string[];
  routeStats(since: number): Array<{ provider: string; label: string; calls: number; ok: number; failed: number; avg_ms: number; tokens: number; cost_usd: number }>;
}

export type ReportScope = 'dernier' | 'conversation' | 'tout' | 'bilan';

/**
 * Rapport lisible tiré du journal (jamais de la configuration) :
 *   dernier      : la demande précédente de cette conversation, appel par appel ;
 *   conversation : les dernières demandes de cette conversation ;
 *   tout         : les derniers appels, toutes conversations confondues ;
 *   bilan        : qui a travaillé combien sur 30 jours.
 */
export function routingReport(src: RouteSource, q: { scope: ReportScope; sessionId?: string; currentTurnId?: string; limit?: number; now?: number }): string {
  const limit = Math.max(1, Math.min(50, q.limit ?? 10));
  if (q.scope === 'bilan') {
    const since = (q.now ?? Date.now()) - 30 * 86_400_000;
    const rows = src.routeStats(since);
    if (!rows.length) return 'Aucun appel à une IA enregistré sur les 30 derniers jours.';
    return `IA utilisées sur 30 jours (journal des routages) :\n${rows.map((r) => `- ${r.label || providerLabel(r.provider)} : ${r.calls} appel${r.calls > 1 ? 's' : ''}, ${r.ok} réussi${r.ok > 1 ? 's' : ''}${r.failed ? `, ${r.failed} échec${r.failed > 1 ? 's' : ''}` : ''}, ${(r.avg_ms / 1000).toFixed(1)} s en moyenne, ${r.tokens} jetons, ${r.cost_usd.toFixed(3)} $`).join('\n')}`;
  }
  if (q.scope === 'tout') {
    const rows = src.routes({ limit });
    return rows.length ? `Derniers appels aux IA (du plus récent au plus ancien) :\n${rows.map((e) => `- ${describeEntry(e)}`).join('\n')}` : 'Le journal des routages est vide pour l\'instant.';
  }
  if (!q.sessionId) return 'Conversation inconnue : précise « tout » ou « bilan ».';
  const turns = src.recentTurns(q.sessionId, limit + 1).filter((t) => t !== q.currentTurnId).slice(0, q.scope === 'dernier' ? 1 : limit);
  if (!turns.length) return 'Aucune demande précédente enregistrée dans cette conversation (le journal existe depuis Odin 1.2).';
  return turns.map((t) => {
    const rows = src.routes({ turnId: t, limit: 100 }).reverse();
    const sum = turnSummary(rows);
    return `Demande « ${rows[0]?.request ?? '?'} » (tour ${t}) : ${sum.line || 'aucune IA n\'a répondu'}\n${rows.map((e) => `  - ${describeEntry(e)}`).join('\n')}`;
  }).join('\n\n');
}
