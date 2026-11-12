// Valhalla — les modules d'Odin (réécritures maison des applis du catalogue, sans doublon).
// Chaque module : une page (vue), des actions (aussi utilisables par Odin, Draupnir et le mode sans IA),
// des alertes, des événements, et des mots-clés pour qu'Odin choisisse le bon module tout seul.

export type Level = 'critique' | 'haute' | 'moyenne' | 'info';
export interface AlertIn { level: Level; title: string; detail?: string; key?: string; data?: Record<string, unknown>; /** image jointe au message (chemin d'un fichier JPEG ou PNG) */ photo?: string; /** ce qu'il faut faire, pas à pas (montré dans la bulle de la mascotte) */ steps?: string[]; /** la manip qui règle le problème (bouton de la bulle) */ fix?: { action: string; label: string; input?: Record<string, unknown>; module?: string } }
/** Options d'un message au propriétaire : urgent (passe « Ne pas déranger »), photo jointe. */
export interface NotifyOpts { urgent?: boolean; photo?: string }
export interface Alert extends AlertIn { id: string; at: string; module: string; ack?: boolean; count: number }

/** Qui a lancé une action : toi (clic, demande explicite), Odin de lui-même, un réflexe entre applis, une automatisation Draupnir, un autre assistant (MCP). */
export type By = 'toi' | 'odin' | 'réflexe' | 'automatisation' | 'assistant';
/** Comment défaire une action : l'action inverse (de la même appli, sauf mention). */
export interface Undo { action: string; input: Record<string, unknown>; label: string; module?: string }
/**
 * Une « manip » : une action faite sans que tu l'aies demandée toi-même (Odin seul, réflexe, automatisation).
 * Odin te prévient ; tu réponds « garde » ou « annule ». En mode Odin Breaker, il décide seul de garder.
 */
export interface Manip { id: string; at: string; module: string; action: string; label: string; input: Record<string, unknown>; text: string; by: By; why?: string; undo?: Undo; state: 'à décider' | 'gardée' | 'annulée'; decidedBy?: string; decidedAt?: string }

export interface Param { key: string; label: string; kind: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'password'; options?: string[]; default?: unknown; required?: boolean; help?: string }
export interface ActionResult { text: string; data?: unknown; ok?: boolean }
export interface Action {
  id: string; label: string; what: string;
  params?: Param[];
  /** lecture seule (sûr, disponible sans IA et sans accord) */
  read?: boolean;
  /** action grave → accord du propriétaire (Heimdall) ; renvoie la raison */
  grave?: (input: Record<string, unknown>, ctx?: ModCtx) => string | undefined;
  /** mots qui déclenchent cette action quand Odin n'a pas d'IA */
  words?: string[];
  /** comment défaire cette action si elle a réussi (action inverse) ; absent = pas d'annulation automatique */
  undo?: (input: Record<string, unknown>, result: ActionResult, ctx: ModCtx) => Undo | undefined;
  /** trop banale pour le journal des manips (lecture déguisée, accusé de réception…) */
  quiet?: boolean;
  /** sa réponse peut contenir du texte écrit par d'autres (page web, dépôt de code, serveur distant, attaquant) : l'IA la reçoit comme une donnée non fiable, jamais comme un ordre */
  external?: boolean;
  /** `false` : pas de bouton rapide sur la page (l'action reste dans « Autres actions », avec son formulaire) */
  quick?: boolean;
  run(ctx: ModCtx, input: Record<string, unknown>): Promise<ActionResult> | ActionResult;
}

export type Tone = 'bon' | 'attention' | 'mauvais' | 'neutre';
export interface Kpi { label: string; value: string; pct?: number; tone?: Tone; hint?: string }
export type Section =
  | { kind: 'table'; title: string; columns: string[]; rows: Array<{ cells: string[]; tone?: Tone; actions?: Array<{ action: string; label: string; input: Record<string, unknown>; /** une autre appli (ex. « ran ») */ module?: string }> }>; empty?: string }
  | { kind: 'list'; title: string; items: Array<{ title: string; detail?: string; tone?: Tone; meta?: string }>; empty?: string }
  /** Des cartes avec une icône (data: ou /…), un état, une barre de progression et des boutons. */
  | { kind: 'cards'; title: string; items: Array<{ icon?: string; title: string; sub?: string; badge?: string; tone?: Tone; progress?: number; meta?: string; actions?: Array<{ action: string; label: string; input: Record<string, unknown>; module?: string }> }>; empty?: string }
  | { kind: 'log'; title: string; lines: string[] }
  | { kind: 'text'; title: string; text: string; tone?: Tone }
  | { kind: 'bars'; title: string; items: Array<{ label: string; value: number; display?: string }> }
  | { kind: 'form'; title: string; action: string; params: Param[]; submit: string }
  /** assistant de configuration : étapes dans l'ordre, faites ou non, chacune avec l'action qui la fait */
  | { kind: 'steps'; title: string; items: Array<{ title: string; detail?: string; done: boolean; action?: string; input?: Record<string, unknown>; button?: string }> }
  /** graphe (même dessin que le Cerveau) : un clic sur un point ouvre sa fiche ; périodes pour revoir le passé */
  | { kind: 'graph'; title: string; nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail>; legend?: Array<[string, string]>; periods?: { current: string; options: Array<{ id: string; label: string }>; when?: string }; empty?: string };
/** Un point du graphe : couleur, taille, anneau (nouveau, dangereux), carré (Odin, box, Internet), éteint. */
export interface GraphNode { id: string; label: string; sub?: string; color?: string; size?: number; ring?: string; square?: boolean; off?: boolean; hub?: boolean; alert?: { n: number; level: 'grave' | 'attention' }; search?: string }
export interface GraphEdge { a: string; b: string; color?: string; dash?: boolean; w?: number; title?: string; arrow?: 'to' | 'both' }
/** La fiche d'un point : titres, pastilles, lignes « clé · valeur · d'où vient l'info », liste, boutons. */
export interface GraphDetail { kind: string; title: string; subtitle?: string; chips?: Array<{ label: string; tone?: Tone }>; rows?: Array<{ k: string; v: string; src?: string }>; list?: { title: string; items: Array<{ text: string; meta?: string; tone?: Tone }> }; actions?: Array<{ action: string; label: string; input: Record<string, unknown>; module?: string; primary?: boolean }> }
export interface View { subtitle?: string; kpis?: Kpi[]; sections: Section[]; side?: Section[]; tabs?: string[] }

export interface ModCtx {
  home: string;
  /** dossier de données du module */
  dir: string;
  settings: Record<string, unknown>;
  saveSettings(patch: Record<string, unknown>): void;
  alert(a: AlertIn): void;
  emit(type: string, data?: Record<string, unknown>): void;
  run(cmd: string, args: string[], o?: { timeoutMs?: number; input?: string; sudo?: boolean }): Promise<{ code: number; out: string; err: string }>;
  has(cmd: string): Promise<boolean>;
  fetch: typeof fetch;
  notify(text: string, o?: NotifyOpts): Promise<void>;
  /** IA d'Odin si disponible (sinon undefined) */
  ask?: (text: string) => Promise<string>;
  /** action d'un autre module (liens entre modules) ; `why` explique le réflexe dans le journal des manips */
  call(module: string, action: string, input?: Record<string, unknown>, why?: string): Promise<ActionResult>;
  now(): Date;
  /** fil d'alertes commun (Forseti) */
  alerts(o?: { module?: string; level?: Level; q?: string; limit?: number }): Alert[];
  ack(ids: string[]): void;
  /** liste des modules (pour Valhalla et les explications) */
  modules(): Module[];
  /** comprend une demande en français SANS IA (Huginn) et l'exécute ; une action grave n'est jamais lancée ainsi */
  order(text: string): Promise<ActionResult>;
}

export interface Module {
  id: string; name: string; family: 'Données' | 'Machines' | 'Accès' | 'Sécurité' | 'Maison';
  what: string;
  /** fonctions détaillées (pour l'explication « qui fait quoi ») */
  does: string[];
  /** applis d'origine dont il reprend les fonctions (affiché seulement dans « d'où ça vient ») */
  from: string[];
  /** dépôts GitHub suivis pour la veille des nouveautés */
  upstream: string[];
  /** mots-clés (français) pour choisir le module sans IA */
  words: string[];
  /** onglets/modes internes (anciens noms fusionnés) */
  modes?: string[];
  actions: Action[];
  view(ctx: ModCtx, q: URLSearchParams): Promise<View> | View;
  start?(ctx: ModCtx): void | Promise<void>;
  stop?(): void;
  /** surveillance périodique (alertes) ; appelée toutes les `every` secondes */
  watch?: { every: number; run(ctx: ModCtx): Promise<void> | void };
}
