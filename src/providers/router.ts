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
import { CodexProvider, loadCodexAuth } from './codex.ts';
import { odinPaths, type OdinPaths } from '../config.ts';
import { providerLabel, routeContext, serviceOf, type RouteAttempt, type RouteEntry } from './journal.ts';

export type Tier = 'local' | 'standard' | 'strong';
export const TIER_RANK: Record<Tier, number> = { local: 0, standard: 1, strong: 2 };
/** Palier déclaré, sinon deviné : service local = gratuit, modèle « haut de gamme » = strong. */
export function tierOf(p: ProviderConfig): Tier {
  if (p.tier) return p.tier;
  if (p.baseUrl && /localhost|127\.0\.0\.1|\[::1\]/.test(p.baseUrl)) return 'local';
  if (/opus|o1|o3|gpt-5(?!-mini|-nano)|pro|ultra|405b|large/i.test(p.model) && !/mini|nano|flash|haiku|small/i.test(p.model)) return 'strong';
  return 'standard';
}

/** Spécialités d'un modèle : déclarées, sinon devinées d'après son nom (modifiables dans config.json). */
export function strengthsOf(p: ProviderConfig): string[] {
  if (p.strengths?.length) return p.strengths;
  const m = p.model.toLowerCase();
  if (/claude|opus|sonnet|haiku/.test(m)) return ['code', 'écriture', 'outils', 'raisonnement'];
  if (/kimi|moonshot/.test(m)) return ['code', 'long', 'outils', 'recherche'];
  if (/deepseek/.test(m)) return ['code', 'raisonnement', 'économique'];
  if (/gemini/.test(m)) return ['long', 'recherche', 'vision'];
  if (/gpt|^o\d|codex/.test(m)) return ['code', 'raisonnement', 'outils'];
  if (/qwen|llama|mistral|gemma|phi/.test(m)) return ['rapide', 'écriture'];
  return [];
}
/** Le modèle accepte-t-il des images ? Déclaré (vision), sinon deviné. */
export function visionOf(p: ProviderConfig): boolean {
  if (typeof p.vision === 'boolean') return p.vision;
  return !/deepseek-(v4-pro|chat|reasoner|coder)|qwq|reasoner/i.test(p.model);
}
/** Besoin d'une tâche → spécialité recherchée chez le modèle. */
export const NEED_STRENGTH: Record<string, string> = { code: 'code', web: 'recherche', fichiers: 'long', discussion: 'écriture', organisation: 'écriture', maison: 'outils', reseau: 'outils', long: 'long', vision: 'vision' };
/** Tâches qui touchent à ta vie privée (maison, mails, réseau, fichiers, mémoire) : jamais envoyées à un modèle marqué « pas de données personnelles ». */
export const PRIVATE_NEEDS = new Set(['maison', 'organisation', 'reseau', 'fichiers']);
export const PRIVATE_PURPOSES = new Set(['mémoire', 'observation', 'réflexion', 'fil', 'leçon', 'amélioration', 'aide à l\'écriture', 'juge', 'avis croisé']);

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
  /** Fournisseurs à préférer, à palier égal (ceux qui réussissent le mieux ce type de tâche chez toi). */
  prefer?: string[];
  /** Fournisseurs à éviter (vérification croisée : un autre avis). */
  exclude?: string[];
  /** Besoin de la tâche (code, web, maison…) : à palier égal, le modèle dont c'est la spécialité passe devant. */
  need?: string;
  /** La demande contient des images : seuls les modèles qui voient sont essayés. */
  vision?: boolean;
  /** Fournisseurs qui échouent trop souvent sur ce type de tâche chez toi : ils ne passent pas devant parce qu'ils coûtent moins. */
  avoid?: string[];
  /** À palier et spécialité égaux, le moins cher d'abord. */
  cheapest?: boolean;
}

/**
 * Prix d'un appel type chez ce fournisseur, pour comparer (dollars par million de jetons ; une réponse
 * pèse environ un quart de la demande). Modèle local ou abonnement déjà payé : 0. Prix inconnu : rangé
 * après ceux qu'on connaît (on ne suppose pas qu'il est gratuit).
 */
export function priceOf(p: ProviderConfig): number {
  if (tierOf(p) === 'local' || p.kind === 'openai-codex') return 0;
  if (p.priceInPerM === undefined && p.priceOutPerM === undefined) return Number.POSITIVE_INFINITY;
  return (p.priceInPerM ?? 0) + (p.priceOutPerM ?? 0) / 4;
}

export function buildProvider(p: ProviderConfig, env = process.env, paths: OdinPaths = odinPaths()): Provider | undefined {
  // Abonnement ChatGPT : utilisable dès qu'Odin est connecté (connexion rangée dans ~/.odin).
  if (p.kind === 'openai-codex') return loadCodexAuth(paths) ? new CodexProvider(paths, `openai-codex:${p.model}`, p.baseUrl) : undefined;
  const key = p.apiKeyEnv ? env[p.apiKeyEnv] ?? '' : '';
  if (p.kind === 'anthropic') return key ? new AnthropicProvider(key, p.baseUrl, `anthropic:${p.model}`) : undefined;
  if (p.kind === 'openai') {
    const local = p.baseUrl && /localhost|127\.0\.0\.1|\[::1\]/.test(p.baseUrl);
    // Nom = service + modèle (« deepseek:deepseek-flash », « openrouter:… ») : l'historique dit qui a vraiment répondu.
    return key || local ? new OpenAIProvider(key, p.baseUrl, `${serviceOf(p.baseUrl)}:${p.model}`) : undefined;
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
  /** Services injoignables (plus d'Internet…) : essayés en dernier pendant 1 min, sans attendre leurs réessais. */
  private down = new Map<string, number>();
  /** Vrai si tous les services en ligne viennent d'être injoignables (Odin est probablement sans Internet). */
  offline(): boolean { const n = this.now(); const remote = this.routes.filter((r) => tierOf(r.cfg) !== 'local'); return remote.length > 0 && remote.every((r) => (this.down.get(r.provider.name) ?? 0) > n); }
  readonly pauseMs: number;
  /** Appelé quand un fournisseur est mis de côté ou revient (journal, notification). */
  onPause?: (name: string, reason: string, untilMs: number) => void;
  /** Journal : chaque appel (réussi ou non), avec les essais, la raison du choix et le coût. */
  onRoute?: (e: RouteEntry) => void;
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

  static fromConfig(cfg: OdinConfig, extra: Route[] = [], paths?: OdinPaths): Router {
    const routes: Route[] = [...extra];
    for (const p of cfg.providers) {
      const provider = buildProvider(p, process.env, paths);
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
    const pref = (r: Route) => { const i = o.prefer?.indexOf(r.provider.name) ?? -1; return i < 0 ? 99 : i; };
    const want = o.need ? NEED_STRENGTH[o.need] : undefined;
    const fit = (r: Route) => (want && strengthsOf(r.cfg).includes(want) ? 0 : 1);
    // « Le moins cher qui convient » : à palier égal, d'abord ceux qui réussissent ce type de tâche chez toi
    // (les autres ne passent pas devant parce qu'ils coûtent moins), puis la spécialité, puis le prix.
    const weak = (r: Route) => (o.avoid?.includes(r.provider.name) ? 1 : 0);
    const price = (a: Route, b: Route) => { if (!o.cheapest) return 0; const x = priceOf(a.cfg), y = priceOf(b.cfg); return x === y ? 0 : x < y ? -1 : 1; };
    const isPrivate = (o.need && PRIVATE_NEEDS.has(o.need)) || PRIVATE_PURPOSES.has(o.purpose ?? '');
    return this.routes
      .filter((r) => !o.exclude?.includes(r.provider.name))
      .filter((r) => !o.vision || visionOf(r.cfg))
      .filter((r) => !(isPrivate && r.cfg.personal === false))
      .map((r, i) => ({ r, i }))
      .sort((a, b) => Number(Boolean(a.r.cfg.fallbackOnly)) - Number(Boolean(b.r.cfg.fallbackOnly)) || rank(a.r) - rank(b.r) || weak(a.r) - weak(b.r) || (o.cheapest ? fit(a.r) - fit(b.r) || price(a.r, b.r) || pref(a.r) - pref(b.r) : pref(a.r) - pref(b.r) || fit(a.r) - fit(b.r)) || a.i - b.i)
      .map((x) => x.r);
  }

  /** Pourquoi ce modèle passe en premier pour cette demande (en clair, pour le journal). */
  why(route: Route, o: CompleteOptions, position: number, skipped: string[] = []): string {
    const parts: string[] = [];
    const tier = tierOf(route.cfg), min = o.minTier ?? 'standard';
    const TXT: Record<Tier, string> = { local: 'simple', standard: 'ordinaire', strong: 'complexe' };
    parts.push(tier === min ? `tâche ${TXT[min]} → modèle ${tier === 'local' ? 'local' : tier === 'strong' ? 'le plus capable' : 'standard'}` : `palier ${tier} (demandé : ${min})`);
    if (o.prefer?.[0] === route.provider.name) parts.push('meilleur taux de réussite chez toi pour ce type de tâche');
    const want = o.need ? NEED_STRENGTH[o.need] : undefined;
    if (want && strengthsOf(route.cfg).includes(want)) parts.push(`spécialité ${want}`);
    // Dit quand c'est le prix qui a décidé : un autre modèle du même palier, tout aussi adapté, coûtait plus.
    if (o.cheapest && this.routes.some((r) => r !== route && !r.cfg.fallbackOnly && tierOf(r.cfg) === tier && priceOf(r.cfg) > priceOf(route.cfg) && Number.isFinite(priceOf(r.cfg)) && (!want || strengthsOf(r.cfg).includes(want) === strengthsOf(route.cfg).includes(want)))) parts.push('le moins cher qui convient');
    if (o.vision) parts.push('voit les images');
    if (this.overBudget?.()) parts.push('budget atteint : gratuit seulement');
    const ahead = skipped.filter((x) => !x.startsWith(providerLabel(route.provider.name)));
    if (position > 0) parts.push(`secours n° ${position}`);
    if (ahead.length) parts.push(`à la place de ${ahead.join(', ')}`);
    else if (position === 0 && parts.length === 1) parts.push('premier de ta liste');
    return parts.join(', ');
  }

  async complete(req: Omit<CompletionRequest, 'model'>, o: CompleteOptions = {}): Promise<RoutedResponse> {
    const ctx = routeContext();
    const vision = o.vision ?? req.messages.some((m) => m.images?.length);
    o = { ...o, vision, need: o.need ?? (vision ? 'vision' : ctx?.need) };
    const t0 = this.now(), attempts: RouteAttempt[] = [];
    // Modèles normalement prioritaires mais mis de côté (quota) ou injoignables : dits dans la raison du choix.
    // (lecture seule : ne pas effacer les pauses finies ici, completeInner en a besoin pour dire « de nouveau disponible »)
    const pausedNow = (n: string) => (this.paused.get(n)?.until ?? 0) > this.now();
    const skipped = this.order(o).filter((r) => pausedNow(r.provider.name) || (this.down.get(r.provider.name) ?? 0) > this.now())
      .map((r) => `${providerLabel(r.provider.name)} ${pausedNow(r.provider.name) ? 'en pause (quota épuisé)' : 'injoignable'}`);
    const log = (route: Route | undefined, position: number, r?: ModelResponse, cost = 0) => {
      const purpose = (o.purpose ?? 'agent') === 'agent' && ctx?.role ? ctx.role : (o.purpose ?? 'agent');
      const e: RouteEntry = {
        at: t0, turnId: ctx?.turnId ?? '', sessionId: ctx?.sessionId ?? '', channel: ctx?.channel ?? 'système', request: ctx?.request ?? '',
        purpose, provider: route?.provider.name ?? '', label: route ? providerLabel(route.provider.name) : '', tier: route ? tierOf(route.cfg) : '',
        minTier: o.minTier ?? 'standard', need: o.need ?? '', reason: route ? this.why(route, o, position, skipped) : req.signal?.aborted ? 'interrompu' : attempts.length ? 'tous les fournisseurs ont échoué' : 'aucun modèle autorisé pour cette tâche (vie privée, images…) ou tous hors service',
        attempts, ok: Boolean(r), ms: this.now() - t0, tokensIn: r?.usage.inputTokens ?? 0, tokensOut: r?.usage.outputTokens ?? 0, costUsd: cost,
      };
      ctx?.entries.push(e);
      try { this.onRoute?.(e); } catch { /* journal facultatif */ }
    };
    try {
      return await this.completeInner(req, o, attempts, log);
    } catch (e) {
      if (!attempts.some((a) => a.ok)) log(undefined, -1);
      throw e;
    }
  }

  private async completeInner(req: Omit<CompletionRequest, 'model'>, o: CompleteOptions, attempts: RouteAttempt[], log: (route: Route | undefined, position: number, r?: ModelResponse, cost?: number) => void): Promise<RoutedResponse> {
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
    const isDown = (r: Route) => (this.down.get(r.provider.name) ?? 0) > this.now();
    // Tout est injoignable depuis moins d'une minute : on ne fait pas attendre, le secours répond tout de suite.
    if (candidates.every(isDown)) throw new Error('aucun service d\'IA joignable pour l\'instant (pas d\'Internet ?)');
    const active = candidates.filter((r) => !this.isPaused(r.provider.name) && !isDown(r));
    const ordered = [...active, ...candidates.filter((r) => !this.isPaused(r.provider.name) && isDown(r)), ...candidates.filter((r) => this.isPaused(r.provider.name))];
    const first = ordered[0];
    for (const [position, route] of ordered.entries()) {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        const ta = this.now();
        try {
          const r = await route.provider.complete({ ...req, model: route.cfg.model });
          attempts.push({ provider: route.provider.name, ok: true, ms: this.now() - ta });
          this.down.delete(route.provider.name);
          if (wasPaused.has(route.provider.name)) { this.paused.delete(route.provider.name); notices.push(`${route.provider.name} est de nouveau disponible.`); }
          const cost = (r.usage.inputTokens * (route.cfg.priceInPerM ?? 0) + r.usage.outputTokens * (route.cfg.priceOutPerM ?? 0)) / 1e6;
          this.onUsage?.(route.provider.name, r.usage.inputTokens, r.usage.outputTokens, cost, o.purpose ?? 'agent');
          for (const t of this.trackers) t(cost);
          log(route, position, r, cost);
          if (route !== first && errors.length) notices.unshift(`${first.provider.name} indisponible, réponse de ${route.provider.name}.`);
          return { ...r, providerName: route.provider.name, costUsd: cost, ...(notices.length ? { notice: notices.join(' ') } : {}) };
        } catch (e) {
          if (req.signal?.aborted) throw e;
          attempts.push({ provider: route.provider.name, ok: false, ms: this.now() - ta, error: shortError(e) });
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
          // Injoignable (pas de réseau, DNS, connexion refusée) : marqué « hors service » 1 min, sans réessais
          // qui feraient attendre la réponse de secours.
          if (!(e instanceof HttpError) && /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|network|socket/i.test(`${(e as Error).message} ${String((e as { cause?: { code?: string } }).cause?.code ?? '')}`)) {
            this.down.set(route.provider.name, this.now() + 60_000);
            break;
          }
          if (attempt === 0) this.down.delete(route.provider.name);
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

/** Raison d'échec courte et lisible (quota, clé refusée, délai…). */
export function shortError(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (e instanceof HttpError) {
    if (isQuotaError(e)) return `quota épuisé (HTTP ${e.status})`;
    if (e.status === 401 || e.status === 403) return `clé refusée (HTTP ${e.status})`;
    if (e.status === 404) return 'modèle introuvable (HTTP 404)';
    if (e.status === 429) return 'trop de demandes (HTTP 429)';
    if (e.status >= 500) return `service en panne (HTTP ${e.status})`;
    return `HTTP ${e.status}`;
  }
  if (/abort|timeout/i.test(m)) return 'délai dépassé';
  if (/fetch failed|ECONN|ENOTFOUND|network/i.test(m)) return 'injoignable';
  return m.slice(0, 80);
}

/**
 * Cerveau local trouvé tout seul : si Ollama tourne sur cette machine avec un modèle de discussion
 * et qu'aucun modèle local n'est configuré, il est ajouté en DERNIER RECOURS. Odin continue alors de
 * réfléchir sans Internet (lent sur un petit processeur, mais il répond et agit).
 */
export async function detectLocalBrain(router: Router, base = 'http://127.0.0.1:11434', fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  if (router.routes.some((r) => tierOf(r.cfg) === 'local')) return undefined;
  const r = await fetchFn(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) }).catch(() => undefined);
  if (!r?.ok) return undefined;
  const names = ((await r.json().catch(() => ({}))) as { models?: Array<{ name: string }> }).models?.map((m) => m.name) ?? [];
  const chat = names.filter((n) => !/embed|nomic|bge|minilm|whisper|vision-only/i.test(n));
  const pick = ['qwen3', 'qwen2.5', 'llama3', 'mistral', 'gemma', 'phi'].map((p) => chat.find((n) => n.startsWith(p))).find(Boolean) ?? chat[0];
  if (!pick) return undefined;
  const cfg: ProviderConfig = { kind: 'openai', model: pick, baseUrl: `${base}/v1`, tier: 'local', fallbackOnly: true };
  router.routes.push({ provider: new OpenAIProvider('', cfg.baseUrl, `ollama:${pick}`), cfg });
  return pick;
}
