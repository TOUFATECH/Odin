// Routeur de modèles.
//
// Chaque fournisseur a un palier (tier) :
//   local    : installé sur la machine (Ollama, LM Studio…), gratuit, privé ;
//   standard : modèle payant courant ;
//   strong   : le plus capable, pour les tâches complexes.
// Odin privilégie le moins cher qui suffit : une demande simple part vers un modèle local ou
// économique, une tâche complexe vers le plus adapté. Quand un fournisseur est à bout de quota
// (429, 402, 403 de facturation), il est mis de côté quelques minutes et le suivant prend le
// relais automatiquement, avec un avis dans la réponse. Réessais avec attente exponentielle.

import type { OdinConfig, ProviderConfig } from '../config.ts';
import type { CompletionRequest, ModelResponse, Provider } from '../types.ts';
import { AnthropicProvider } from './anthropic.ts';
import { HttpError } from './http.ts';
import { OpenAIProvider } from './openai.ts';

export type Tier = 'local' | 'standard' | 'strong';
export const TIER_RANK: Record<Tier, number> = { local: 0, standard: 1, strong: 2 };
/** Palier déclaré, sinon deviné : service local = gratuit, modèle « haut de gamme » = strong. */
export function tierOf(p: ProviderConfig): Tier {
  if (p.tier) return p.tier;
  if (p.baseUrl && /localhost|127\.0\.0\.1|\[::1\]/.test(p.baseUrl)) return 'local';
  if (/opus|o1|o3|gpt-5(?!-mini|-nano)|pro|ultra|405b|large/i.test(p.model) && !/mini|nano|flash|haiku|small/i.test(p.model)) return 'strong';
  return 'standard';
}

export interface Route {
  provider: Provider;
  cfg: ProviderConfig;
}

export interface RoutedResponse extends ModelResponse {
  providerName: string;
  costUsd: number;
  /** Avis à montrer à l'utilisateur (ex. bascule après quota épuisé). */
  notice?: string;
}

export interface CompleteOptions {
  /** Palier minimal souhaité (défaut : standard). */
  minTier?: Tier;
  /** À quoi sert l'appel (agent, juge, résumé, réflexion, observation, vision…), pour la comptabilité. */
  purpose?: string;
  /** Fournisseurs à éviter (vérification croisée : un autre avis). */
  exclude?: string[];
}

export function buildProvider(p: ProviderConfig, env = process.env): Provider | undefined {
  const key = p.apiKeyEnv ? env[p.apiKeyEnv] ?? '' : '';
  if (p.kind === 'anthropic') return key ? new AnthropicProvider(key, p.baseUrl, `anthropic:${p.model}`) : undefined;
  if (p.kind === 'openai') {
    const local = p.baseUrl && /localhost|127\.0\.0\.1|\[::1\]/.test(p.baseUrl);
    return key || local ? new OpenAIProvider(key, p.baseUrl, `openai:${p.model}`) : undefined;
  }
  return undefined;
}

/** Erreur de quota ou de crédit épuisé : le fournisseur ne sert à rien pendant un moment. */
export function isQuotaError(e: unknown): boolean {
  if (!(e instanceof HttpError)) return false;
  if (e.status === 402) return true;
  if (e.status === 429) return !/rate.?limit|too many requests per (second|minute)|tokens per minute/i.test(e.message) || /quota|billing|credit|insufficient|exceeded your current/i.test(e.message);
  if (e.status === 403 || e.status === 400) return /quota|billing|credit|insufficient_quota|payment|balance|plan/i.test(e.message);
  return false;
}

export class Router {
  readonly routes: Route[];
  private maxRetries: number;
  private sleep: (ms: number) => Promise<unknown>;
  private now: () => number;
  /** Fournisseurs mis de côté (quota épuisé) : nom → fin de la pause. */
  private paused = new Map<string, { until: number; reason: string }>();
  readonly pauseMs: number;
  /** Appelé quand un fournisseur est mis de côté ou revient (journal, notification). */
  onPause?: (name: string, reason: string, untilMs: number) => void;
  /** Comptabilité : chaque appel réussi (quel que soit l'appelant : agent, juges, résumé…). */
  onUsage?: (provider: string, tokensIn: number, tokensOut: number, costUsd: number, purpose: string) => void;
  /** Budget : renvoie vrai quand les modèles payants doivent être évités (plafond mensuel atteint). */
  overBudget?: () => boolean;
  private trackers = new Set<(costUsd: number) => void>();
  /** Suit la dépense pendant une période (un tour) ; renvoie la fonction qui arrête le suivi. */
  track(fn: (costUsd: number) => void): () => void { this.trackers.add(fn); return () => this.trackers.delete(fn); }

  constructor(routes: Route[], maxRetries = 2, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), opts: { pauseMs?: number; now?: () => number } = {}) {
    this.routes = routes; this.maxRetries = maxRetries; this.sleep = sleep;
    this.pauseMs = opts.pauseMs ?? 15 * 60_000; this.now = opts.now ?? (() => Date.now());
    if (!routes.length) throw new Error('Aucun fournisseur de modèle utilisable : définis une clé (ex. ANTHROPIC_API_KEY) puis lance « odin doctor ».');
  }

  static fromConfig(cfg: OdinConfig, extra: Route[] = []): Router {
    const routes: Route[] = [...extra];
    for (const p of cfg.providers) {
      const provider = buildProvider(p);
      if (provider) routes.push({ provider, cfg: p });
    }
    return new Router(routes, 2, undefined, { pauseMs: Math.max(1, cfg.routing?.quotaPauseMin ?? 15) * 60_000 });
  }

  /** Le plus haut palier disponible (pour savoir si une tâche complexe peut être servie). */
  get tiers(): Tier[] { return [...new Set(this.routes.map((r) => tierOf(r.cfg)))]; }
  /** Fournisseurs actuellement mis de côté. */
  pausedNow(): Array<{ name: string; reason: string; until: number }> {
    return [...this.paused.entries()].filter(([, v]) => v.until > this.now()).map(([name, v]) => ({ name, ...v }));
  }
  /** Remet un fournisseur en service (ex. après avoir rechargé le compte). */
  resume(name?: string): void { if (name) this.paused.delete(name); else this.paused.clear(); }

  /**
   * Ordre d'essai pour une demande : d'abord les fournisseurs du palier minimal demandé (dans
   * l'ordre configuré), puis les paliers supérieurs, puis, en dernier recours, les inférieurs.
   */
  order(o: CompleteOptions = {}): Route[] {
    const min = TIER_RANK[o.minTier ?? 'standard'];
    const rank = (r: Route) => { const t = TIER_RANK[tierOf(r.cfg)]; return t >= min ? t - min : 10 + (min - t); };
    return this.routes
      .filter((r) => !o.exclude?.includes(r.provider.name))
      .map((r, i) => ({ r, i }))
      .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
      .map((x) => x.r);
  }

  async complete(req: Omit<CompletionRequest, 'model'>, o: CompleteOptions = {}): Promise<RoutedResponse> {
    const errors: string[] = [];
    const notices: string[] = [];
    let candidates = this.order(o);
    if (!candidates.length) throw new Error('Aucun fournisseur disponible pour cette demande.');
    // Budget mensuel atteint : seuls les modèles gratuits (locaux) servent, s'il y en a.
    if (this.overBudget?.()) {
      const free = candidates.filter((r) => tierOf(r.cfg) === 'local');
      if (free.length) { notices.push('Budget mensuel atteint : modèle gratuit utilisé.'); candidates = free; }
      else throw new Error('Budget mensuel atteint et aucun modèle gratuit configuré (Réglages → Modèle).');
    }
    const wasPaused = new Set(candidates.filter((r) => this.paused.has(r.provider.name)).map((r) => r.provider.name));
    // Fournisseurs en pause : essayés en dernier, au cas où le quota serait revenu.
    const active = candidates.filter((r) => !this.isPaused(r.provider.name));
    const ordered = [...active, ...candidates.filter((r) => this.isPaused(r.provider.name))];
    const first = ordered[0];
    for (const route of ordered) {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const r = await route.provider.complete({ ...req, model: route.cfg.model });
          if (wasPaused.has(route.provider.name)) { this.paused.delete(route.provider.name); notices.push(`${route.provider.name} est de nouveau disponible.`); }
          const cost = (r.usage.inputTokens * (route.cfg.priceInPerM ?? 0) + r.usage.outputTokens * (route.cfg.priceOutPerM ?? 0)) / 1e6;
          this.onUsage?.(route.provider.name, r.usage.inputTokens, r.usage.outputTokens, cost, o.purpose ?? 'agent');
          for (const t of this.trackers) t(cost);
          if (route !== first && errors.length) notices.unshift(`${first.provider.name} indisponible, réponse de ${route.provider.name}.`);
          return { ...r, providerName: route.provider.name, costUsd: cost, ...(notices.length ? { notice: notices.join(' ') } : {}) };
        } catch (e) {
          if (req.signal?.aborted) throw e;
          errors.push(`${route.provider.name} (essai ${attempt + 1}) : ${(e as Error).message.slice(0, 200)}`);
          if (isQuotaError(e)) {
            // Quota ou crédit épuisé : inutile d'insister, on passe au suivant pour un moment.
            const until = this.now() + this.pauseMs;
            const reason = (e as Error).message.slice(0, 160);
            this.paused.set(route.provider.name, { until, reason });
            this.onPause?.(route.provider.name, reason, until);
            notices.push(`Quota épuisé chez ${route.provider.name} : mis de côté ${Math.round(this.pauseMs / 60_000)} min.`);
            break;
          }
          const retryable = e instanceof HttpError ? e.retryable : true; // erreurs réseau : on réessaie
          if (!retryable) break; // erreur définitive (clé invalide…) → fournisseur suivant
          if (attempt < this.maxRetries) {
            const wait = e instanceof HttpError && e.retryAfterSec ? e.retryAfterSec * 1000 : 500 * 2 ** attempt + Math.random() * 250;
            await this.sleep(Math.min(wait, 20_000));
          }
        }
      }
    }
    throw new Error(`Tous les fournisseurs ont échoué :\n- ${errors.join('\n- ')}`);
  }

  private isPaused(name: string): boolean {
    const p = this.paused.get(name);
    if (!p) return false;
    if (p.until <= this.now()) { this.paused.delete(name); return false; }
    return true;
  }
}
