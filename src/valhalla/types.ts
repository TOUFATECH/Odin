// Valhalla — les modules d'Odin (réécritures maison des applis du catalogue, sans doublon).
// Chaque module : une page (vue), des actions (aussi utilisables par Odin, Draupnir et le mode sans IA),
// des alertes, des événements, et des mots-clés pour qu'Odin choisisse le bon module tout seul.

export type Level = 'critique' | 'haute' | 'moyenne' | 'info';
export interface AlertIn { level: Level; title: string; detail?: string; key?: string; data?: Record<string, unknown> }
export interface Alert extends AlertIn { id: string; at: string; module: string; ack?: boolean; count: number }

export interface Param { key: string; label: string; kind: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'password'; options?: string[]; default?: unknown; required?: boolean; help?: string }
export interface ActionResult { text: string; data?: unknown; ok?: boolean }
export interface Action {
  id: string; label: string; what: string;
  params?: Param[];
  /** lecture seule (sûr, disponible sans IA et sans accord) */
  read?: boolean;
  /** action grave → accord du propriétaire (Heimdall) ; renvoie la raison */
  grave?: (input: Record<string, unknown>) => string | undefined;
  /** mots qui déclenchent cette action quand Odin n'a pas d'IA */
  words?: string[];
  run(ctx: ModCtx, input: Record<string, unknown>): Promise<ActionResult> | ActionResult;
}

export type Tone = 'bon' | 'attention' | 'mauvais' | 'neutre';
export interface Kpi { label: string; value: string; pct?: number; tone?: Tone; hint?: string }
export type Section =
  | { kind: 'table'; title: string; columns: string[]; rows: Array<{ cells: string[]; tone?: Tone; actions?: Array<{ action: string; label: string; input: Record<string, unknown> }> }>; empty?: string }
  | { kind: 'list'; title: string; items: Array<{ title: string; detail?: string; tone?: Tone; meta?: string }>; empty?: string }
  | { kind: 'log'; title: string; lines: string[] }
  | { kind: 'text'; title: string; text: string; tone?: Tone }
  | { kind: 'bars'; title: string; items: Array<{ label: string; value: number; display?: string }> }
  | { kind: 'form'; title: string; action: string; params: Param[]; submit: string };
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
  notify(text: string): Promise<void>;
  /** IA d'Odin si disponible (sinon undefined) */
  ask?: (text: string) => Promise<string>;
  /** action d'un autre module (liens entre modules) */
  call(module: string, action: string, input?: Record<string, unknown>): Promise<ActionResult>;
  now(): Date;
  /** fil d'alertes commun (Forseti) */
  alerts(o?: { module?: string; level?: Level; q?: string; limit?: number }): Alert[];
  ack(ids: string[]): void;
  /** liste des modules (pour Valhalla et les explications) */
  modules(): Module[];
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
