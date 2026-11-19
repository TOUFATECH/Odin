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
import { ModelePasEntraine } from '../langue/pas-entraine.ts';
import { OpenAIProvider } from './openai.ts';
import { CodexProvider, loadCodexAuth } from './codex.ts';
import { odinPaths, type OdinPaths } from '../config.ts';
import { providerLabel, routeContext, serviceOf, type RouteAttempt, type RouteEntry } from './journal.ts';
import { SANS_MODELE } from '../brain/porte-modele.ts';

export type { RouteAttempt } from './journal.ts';

// Classement des agents (Réglages, places 1 à 10) : quand il est écrit, il remplace le tri automatique (palier,
// spécialité, prix). L'agent local d'Odin y figure toujours. Le premier agent qui peut faire la tâche la reçoit ;
// s'il se tait (pas de premier mot, pas de réponse complète) ou refuse (quota, erreur, injoignable), le suivant la
// reprend. Un agent qui a déjà émis une action dans le tour n'est jamais remplacé en cours de route : on s'arrête.
// Sans classement écrit, rien ne change : ni l'ordre, ni les délais.
/** L'agent local d'Odin dans le classement (ce qu'Odin fait seul, Soul, puis son propre modèle). Jamais retiré. */
export const AGENT_LOCAL = 'odin-local';
export const CLASSEMENT_MAX = 10;
/** Délais par défaut avant de passer à l'agent suivant (réglables à la construction du routeur). */
export const DELAI_PREMIER_MOT_MS = 30_000;
export const DELAI_REPONSE_MS = 3 * 60_000;

/**
 * Classement propre : identifiants de fournisseurs (« anthropic:claude-… »), sans doublon, 10 places au plus,
 * l'agent local d'Odin toujours présent (ajouté à la dernière place s'il manque). Pas une liste : pas de classement.
 */
export function normaliserClassement(liste: unknown): string[] | undefined {
  if (!Array.isArray(liste)) return undefined;
  const ids: string[] = [];
  for (const x of liste) {
    if (typeof x !== 'string') continue;
    const id = x.trim().slice(0, 200);
    if (id && !ids.includes(id)) ids.push(id);
  }
  const tete = ids.slice(0, CLASSEMENT_MAX);
  if (tete.includes(AGENT_LOCAL)) return tete;
  return [...ids.filter((x) => x !== AGENT_LOCAL).slice(0, CLASSEMENT_MAX - 1), AGENT_LOCAL];
}

/** Identifiant d'une route dans le classement (la place vide du modèle d'Odin compte pour l'agent local). */
export function idClassement(r: Route): string { return r.provider.name === SANS_MODELE ? AGENT_LOCAL : r.provider.name; }

/** Nom d'un agent en clair (la place vide du modèle d'Odin est l'agent local, pas son nom interne). */
function nomAgent(name: string): string { return name === SANS_MODELE ? 'l\'agent local d\'Odin' : providerLabel(name); }

/**
 * Demande à un fournisseur, avec le rappel « activité » : appelé à chaque morceau reçu du flux (texte, début ou morceau
 * d'un appel d'outil, raisonnement). Seul le routeur le pose, et seulement quand un classement est écrit.
 */
export type RequeteSuivie = CompletionRequest & { onActivite?: () => void };
/** Le fournisseur appelle-t-il `onActivite` à chaque morceau de son flux ? (les trois fournisseurs connectés : oui) */
export function signaleActivite(p: Provider): boolean { return (p as { signaleActivite?: unknown }).signaleActivite === true; }

/**
 * L'agent local d'Odin est-il classé avant tous les agents connectés de ce routeur ? Alors c'est lui qui prend le tour
 * (agent.ts) ; s'il ne sait pas répondre, le tour passe aux agents connectés, dans l'ordre. Faux sans classement.
 */
export function localAvantConnectes(r: Router): boolean {
  if (!r.classement) return false;
  const local = r.classement.indexOf(AGENT_LOCAL) + 1;
  const connectes = r.routes.filter((x) => idClassement(x) !== AGENT_LOCAL).map((x) => r.place(x)).filter((p) => p > 0);
  return local > 0 && connectes.length > 0 && connectes.every((p) => local < p);
}

/** Minuteur (injecté par les essais : aucune vraie attente). */
export interface Minuteur { poser(fn: () => void, ms: number): unknown; retirer(id: unknown): void }
const MINUTEUR_REEL: Minuteur = { poser: (fn, ms) => setTimeout(fn, ms), retirer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) };

/** Essai noté au journal, avec la place de l'agent dans le classement. */
export interface EssaiClasse extends RouteAttempt { place?: number }

const duree = (ms: number) => (ms < 120_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`);

/** L'agent s'est tu trop longtemps : on passe au suivant (sa réponse tardive sera ignorée). */
export class DelaiAgent extends Error {
  readonly sorte: 'premier-mot' | 'reponse';
  readonly ms: number;
  constructor(sorte: 'premier-mot' | 'reponse', ms: number) {
    super(sorte === 'premier-mot' ? `pas de premier mot en ${duree(ms)}` : `pas de réponse complète en ${duree(ms)}`);
    this.name = 'DelaiAgent'; this.sorte = sorte; this.ms = ms;
  }
}

/** Un agent a déjà émis une action dans ce tour, puis n'a pas répondu : il n'est pas remplacé (rien n'est rejoué). */
export class AgentDejaEnAction extends Error {
  readonly agent: string;
  constructor(agent: string, cause: string) {
    super(`${providerLabel(agent)} a déjà commencé à agir dans ce tour, puis n'a pas répondu (${cause}) : il n'est pas remplacé en cours de route, aucune action n'est rejouée. Arrêté ici.`);
    this.name = 'AgentDejaEnAction'; this.agent = agent;
  }
}

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

  /** Classement des agents (place 1 d'abord), agent local compris ; absent : tri automatique d'aujourd'hui. */
  readonly classement?: string[];
  /** Délais avant bascule (classement seulement) : premier mot (première activité d'une réponse en direct), réponse complète. */
  readonly delais: { premierMotMs: number; reponseMs: number };
  private minuteur: Minuteur;
  /** Tour (contexte de routage) → agent qui y a déjà émis une action : lui seul continue ce tour. */
  private agentQuiAgit = new WeakMap<object, string>();

  constructor(routes: Route[], maxRetries = 2, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), opts: { pauseMs?: number; now?: () => number; classement?: string[]; delais?: { premierMotMs?: number; reponseMs?: number }; minuteur?: Minuteur } = {}) {
    this.routes = routes; this.maxRetries = maxRetries; this.sleep = sleep;
    this.pauseMs = opts.pauseMs ?? 15 * 60_000; this.now = opts.now ?? (() => Date.now());
    this.classement = normaliserClassement(opts.classement);
    this.delais = { premierMotMs: Math.max(1, opts.delais?.premierMotMs ?? DELAI_PREMIER_MOT_MS), reponseMs: Math.max(1, opts.delais?.reponseMs ?? DELAI_REPONSE_MS) };
    this.minuteur = opts.minuteur ?? MINUTEUR_REEL;
    if (!routes.length) throw new Error('Aucun fournisseur de modèle utilisable : définis une clé (ex. ANTHROPIC_API_KEY) puis lance « odin doctor ».');
  }

  static fromConfig(cfg: OdinConfig, extra: Route[] = [], paths?: OdinPaths): Router {
    const routes: Route[] = [...extra];
    for (const p of cfg.providers) {
      const provider = buildProvider(p, process.env, paths);
      if (provider) routes.push({ provider, cfg: p });
    }
    // Classement écrit : seuls les agents classés sont montés dans ce routeur (le routeur secondaire monté par le
    // démarrage suit le même classement, runtime.ts).
    const classement = normaliserClassement(cfg.routing?.classement);
    const gardees = classement ? routes.filter((r) => classement.includes(idClassement(r))) : routes;
    // Une place qui ne nomme aucun agent utilisable (faute de frappe, clé absente) est dite : sinon une seule faute
    // couperait tous les agents sans un mot. L'agent local n'a pas de route ici : ce n'est pas une faute.
    if (classement) {
      const connus = new Set(routes.map(idClassement));
      classement.forEach((id, i) => { if (id !== AGENT_LOCAL && !connus.has(id)) console.error(`[classement] place ${i + 1} « ${id.slice(0, 80)} » : aucun agent utilisable de ce nom (faute de frappe, ou clé absente) ; place ignorée.`); });
      if (!gardees.length && routes.length) console.error('[classement] aucun agent du classement n\'est utilisable : aucun agent connecté ne reçoit de demande.');
    }
    return new Router(gardees, 2, undefined, { pauseMs: Math.max(1, cfg.routing?.quotaPauseMin ?? 15) * 60_000, classement });
  }

  /** Place d'une route dans le classement (1 à 10), 0 sans classement ou si elle n'y est pas. */
  place(r: Route): number { return this.classement ? this.classement.indexOf(idClassement(r)) + 1 : 0; }

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
    const possibles = this.routes
      .filter((r) => !o.exclude?.includes(r.provider.name))
      .filter((r) => !o.vision || visionOf(r.cfg))
      .filter((r) => !(isPrivate && r.cfg.personal === false));
    // Classement écrit : son ordre, rien d'autre (ni palier, ni prix, ni spécialité) ; un agent non classé est écarté.
    if (this.classement) return possibles.filter((r) => this.place(r) > 0).map((r, i) => ({ r, i })).sort((a, b) => this.place(a.r) - this.place(b.r) || a.i - b.i).map((x) => x.r);
    return possibles
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
    const log = (route: Route | undefined, position: number, r?: ModelResponse, cost = 0, raison?: string) => {
      const purpose = (o.purpose ?? 'agent') === 'agent' && ctx?.role ? ctx.role : (o.purpose ?? 'agent');
      const e: RouteEntry = {
        at: t0, turnId: ctx?.turnId ?? '', sessionId: ctx?.sessionId ?? '', channel: ctx?.channel ?? 'système', request: ctx?.request ?? '',
        purpose, provider: route?.provider.name ?? '', label: route ? providerLabel(route.provider.name) : '', tier: route ? tierOf(route.cfg) : '',
        minTier: o.minTier ?? 'standard', need: o.need ?? '', reason: route ? (this.classement ? this.pourquoiClasse(route, attempts, skipped) : this.why(route, o, position, skipped)) : raison ?? (req.signal?.aborted ? 'interrompu' : attempts.length ? (this.classement ? 'tous les agents du classement ont échoué' : 'tous les fournisseurs ont échoué') : 'aucun modèle autorisé pour cette tâche (vie privée, images…) ou tous hors service'),
        attempts, ok: Boolean(r), ms: this.now() - t0, tokensIn: r?.usage.inputTokens ?? 0, tokensOut: r?.usage.outputTokens ?? 0, costUsd: cost,
      };
      ctx?.entries.push(e);
      try { this.onRoute?.(e); } catch { /* journal facultatif */ }
    };
    try {
      return await this.completeInner(req, o, attempts, log);
    } catch (e) {
      if (!attempts.some((a) => a.ok)) log(undefined, -1, undefined, 0, e instanceof AgentDejaEnAction ? e.message.slice(0, 300) : undefined);
      throw e;
    }
  }

  /** Pourquoi cet agent (classement) : sa place, et ce qui est arrivé aux places d'avant (sans aucun contenu). */
  private pourquoiClasse(route: Route, attempts: RouteAttempt[], skipped: string[]): string {
    const parts = [`place ${this.place(route)} du classement`];
    const avant = new Map<string, EssaiClasse>();
    for (const a of attempts as EssaiClasse[]) if (!a.ok && a.provider !== route.provider.name) avant.set(a.provider, a);
    for (const a of avant.values()) parts.push(`place ${a.place ?? '?'} ${providerLabel(a.provider)} : ${a.error ?? 'échec'}`);
    for (const s of skipped) if (![...avant.keys()].some((n) => s.startsWith(providerLabel(n))) && !s.startsWith(providerLabel(route.provider.name))) parts.push(s);
    return parts.join(' ; ');
  }

  /**
   * Un appel surveillé (classement) : sans premier mot dans le délai ou sans réponse complète dans le délai, l'appel
   * est interrompu et rejeté par `DelaiAgent`. Ce qu'il dirait ou ferait ensuite est ignoré : ni son texte, ni ses
   * actions ne sortent (la bascule ne rejoue rien).
   * Le « premier mot » est la première ACTIVITÉ d'une réponse en direct : un morceau de texte, un appel d'outil en cours
   * d'écriture ou un raisonnement (rappel `onActivite` des fournisseurs). Un agent qui écrit une action sans un mot
   * travaille : il n'est pas coupé (sinon : travail payé deux fois, ou tour arrêté s'il a déjà agi).
   * Avec des outils, le premier mot n'est attendu que d'un fournisseur qui signale son activité ; un autre (qui ne
   * signale que le texte) garde la règle d'avant : seul le délai de réponse complète joue.
   */
  private appelSurveille(route: Route, req: Omit<CompletionRequest, 'model'>): Promise<ModelResponse> {
    const ac = new AbortController();
    const amont = req.signal;
    const suivre = () => ac.abort(amont?.reason);
    if (amont) { if (amont.aborted) ac.abort(amont.reason); else amont.addEventListener('abort', suivre, { once: true }); }
    const { premierMotMs, reponseMs } = this.delais;
    return new Promise<ModelResponse>((resolve, reject) => {
      let fini = false, premierMot = false;
      const minuteurs: unknown[] = [];
      const finir = (err?: unknown, r?: ModelResponse) => {
        if (fini) return;
        fini = true;
        for (const m of minuteurs) this.minuteur.retirer(m);
        amont?.removeEventListener('abort', suivre);
        if (err !== undefined) { if (err instanceof DelaiAgent) ac.abort(err); reject(err); } else resolve(r!);
      };
      const onDelta = req.onDelta ? (t: string) => { if (fini) return; premierMot = true; req.onDelta!(t); } : undefined;
      const onActivite = () => { premierMot = true; };
      if (onDelta && (!req.tools.length || signaleActivite(route.provider))) minuteurs.push(this.minuteur.poser(() => { if (!premierMot) finir(new DelaiAgent('premier-mot', premierMotMs)); }, premierMotMs));
      minuteurs.push(this.minuteur.poser(() => finir(new DelaiAgent('reponse', reponseMs)), reponseMs));
      try {
        const requete: RequeteSuivie = { ...req, model: route.cfg.model, signal: ac.signal, onDelta, onActivite };
        route.provider.complete(requete).then((r) => finir(undefined, r), (e) => finir(e ?? new Error('échec')));
      } catch (e) { finir(e ?? new Error('échec')); }
    });
  }

  private async completeInner(req: Omit<CompletionRequest, 'model'>, o: CompleteOptions, attempts: RouteAttempt[], log: (route: Route | undefined, position: number, r?: ModelResponse, cost?: number) => void): Promise<RoutedResponse> {
    const errors: string[] = [];
    const notices: string[] = [];
    // « Pas encore » (aucun modèle de langue d'Odin) : si c'est la seule réponse, elle repart telle quelle.
    const pasEncore: ModelePasEntraine[] = [];
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
    let ordered = [...active, ...candidates.filter((r) => !this.isPaused(r.provider.name) && isDown(r)), ...candidates.filter((r) => this.isPaused(r.provider.name))];
    // Classement : un agent qui a déjà émis une action dans ce tour le garde jusqu'au bout ; s'il ne répond plus,
    // personne d'autre ne reprend (jamais deux agents qui font la même action).
    const ctx = this.classement ? routeContext() : undefined;
    const enAction = ctx && req.tools.length ? this.agentQuiAgit.get(ctx) : undefined;
    if (enAction) {
      ordered = ordered.filter((r) => r.provider.name === enAction);
      if (!ordered.length) throw new AgentDejaEnAction(enAction, 'il n\'est plus disponible pour cette demande');
    }
    const first = ordered[0];
    for (const [position, route] of ordered.entries()) {
      const place = this.place(route);
      const essai = (a: RouteAttempt) => { const x: EssaiClasse = this.classement ? { ...a, place } : a; attempts.push(x); };
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        const ta = this.now();
        try {
          const r = this.classement ? await this.appelSurveille(route, req) : await route.provider.complete({ ...req, model: route.cfg.model });
          essai({ provider: route.provider.name, ok: true, ms: this.now() - ta });
          this.down.delete(route.provider.name);
          if (ctx && req.tools.length && r.toolCalls.length) this.agentQuiAgit.set(ctx, route.provider.name);
          if (wasPaused.has(route.provider.name)) { this.paused.delete(route.provider.name); notices.push(`${route.provider.name} est de nouveau disponible.`); }
          const cost = (r.usage.inputTokens * (route.cfg.priceInPerM ?? 0) + r.usage.outputTokens * (route.cfg.priceOutPerM ?? 0)) / 1e6;
          this.onUsage?.(route.provider.name, r.usage.inputTokens, r.usage.outputTokens, cost, o.purpose ?? 'agent');
          for (const t of this.trackers) t(cost);
          log(route, position, r, cost);
          if (route !== first && (errors.length || pasEncore.length)) {
            if (this.classement) {
              const avant = (attempts as EssaiClasse[]).find((a) => a.provider === first.provider.name && !a.ok);
              notices.unshift(`Réponse de ${nomAgent(route.provider.name)} (place ${place}) : ${nomAgent(first.provider.name)} (place ${this.place(first)}) ${avant?.error ?? 'indisponible'}.`);
            } else notices.unshift(`${first.provider.name} indisponible, réponse de ${route.provider.name}.`);
          }
          return { ...r, providerName: route.provider.name, costUsd: cost, ...(notices.length ? { notice: notices.join(' ') } : {}) };
        } catch (e) {
          if (req.signal?.aborted) throw e;
          if (e instanceof ModelePasEntraine) { essai({ provider: route.provider.name, ok: false, ms: this.now() - ta, error: 'pas encore entraîné' }); pasEncore.push(e); break; }
          essai({ provider: route.provider.name, ok: false, ms: this.now() - ta, error: e instanceof DelaiAgent ? e.message : shortError(e) });
          errors.push(`${route.provider.name} (essai ${attempt + 1}) : ${(e as Error).message.slice(0, 200)}`);
          // Silence trop long : on n'insiste pas, l'agent suivant prend le tour.
          if (e instanceof DelaiAgent) break;
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
    if (enAction) throw new AgentDejaEnAction(enAction, (attempts.at(-1)?.error ?? 'échec'));
    // Aucun autre échec que « pas encore » : l'erreur garde son type et son message dans la langue de la personne
    // (ni « Tous les fournisseurs », ni le nom interne de la place vide).
    if (pasEncore.length && !errors.length) throw pasEncore[0];
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
