// Routeur de modèles : réessais avec attente exponentielle + bascule automatique vers le
// fournisseur suivant en cas de panne. Calcule aussi le coût de chaque appel.
import type { OdinConfig, ProviderConfig } from '../config.ts';
import type { CompletionRequest, ModelResponse, Provider } from '../types.ts';
import { AnthropicProvider } from './anthropic.ts';
import { HttpError } from './http.ts';
import { OpenAIProvider } from './openai.ts';

export interface Route {
  provider: Provider;
  cfg: ProviderConfig;
}

export interface RoutedResponse extends ModelResponse {
  providerName: string;
  costUsd: number;
}

export function buildProvider(p: ProviderConfig, env = process.env): Provider | undefined {
  const key = p.apiKeyEnv ? env[p.apiKeyEnv] ?? '' : '';
  if (p.kind === 'anthropic') return key ? new AnthropicProvider(key, p.baseUrl, `anthropic:${p.model}`) : undefined;
  if (p.kind === 'openai') {
    const local = p.baseUrl && /localhost|127\.0\.0\.1/.test(p.baseUrl);
    return key || local ? new OpenAIProvider(key, p.baseUrl, `openai:${p.model}`) : undefined;
  }
  return undefined;
}

export class Router {
  readonly routes: Route[];
  private maxRetries: number;
  private sleep: (ms: number) => Promise<unknown>;
  constructor(routes: Route[], maxRetries = 2, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
    this.routes = routes; this.maxRetries = maxRetries; this.sleep = sleep;
    if (!routes.length) throw new Error('Aucun fournisseur de modèle utilisable : définis une clé (ex. ANTHROPIC_API_KEY) puis lance « odin doctor ».');
  }

  static fromConfig(cfg: OdinConfig, extra: Route[] = []): Router {
    const routes: Route[] = [...extra];
    for (const p of cfg.providers) {
      const provider = buildProvider(p);
      if (provider) routes.push({ provider, cfg: p });
    }
    return new Router(routes);
  }

  async complete(req: Omit<CompletionRequest, 'model'>): Promise<RoutedResponse> {
    const errors: string[] = [];
    for (const route of this.routes) {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const r = await route.provider.complete({ ...req, model: route.cfg.model });
          const cost = (r.usage.inputTokens * (route.cfg.priceInPerM ?? 0) + r.usage.outputTokens * (route.cfg.priceOutPerM ?? 0)) / 1e6;
          return { ...r, providerName: route.provider.name, costUsd: cost };
        } catch (e) {
          if (req.signal?.aborted) throw e;
          const retryable = e instanceof HttpError ? e.retryable : true; // erreurs réseau : on réessaie
          errors.push(`${route.provider.name} (essai ${attempt + 1}) : ${(e as Error).message.slice(0, 200)}`);
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
}
