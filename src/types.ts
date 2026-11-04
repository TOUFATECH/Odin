// Types partagés par tous les modules d'Odin.

/** Appel d'outil demandé par le modèle. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Message de conversation, indépendant du fournisseur de modèle. */
export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  /** Vrai si le contenu vient d'une source non fiable (web, inconnu…). */
  tainted?: boolean;
  /** Images jointes à un message utilisateur (vision du modèle), en base64. */
  images?: Array<{ mime: string; data: string }>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'other';
}

/** Description d'un outil envoyée au modèle (schéma JSON). */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  [k: string]: unknown;
}

export interface CompletionRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  model: string;
  maxTokens: number;
  signal?: AbortSignal;
}

/** Un fournisseur de modèle (Anthropic, compatible OpenAI, local, simulé…). */
export interface Provider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<ModelResponse>;
}

/** Niveaux de risque d'un outil, du plus sûr au plus sensible. */
export type Risk = 'read' | 'write' | 'network' | 'exec' | 'external';

/** Événements émis pendant un tour, pour l'affichage CLI ou les canaux. */
export type AgentEvent =
  | { type: 'thinking'; step: number }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; name: string; ok: boolean; preview: string }
  | { type: 'blocked'; name: string; reason: string }
  | { type: 'compacted'; removed: number }
  | { type: 'skill_proposed'; name: string; active?: boolean }
  | { type: 'learned'; facts: string[] }
  | { type: 'budget'; tokens: number; costUsd: number }
  /** Décision de Heimdall/Mímir sur une action, pour la transparence. */
  | { type: 'decision'; tool: string; summary: string; allowed: boolean; via?: 'policy' | 'human' | 'mimir' | 'grant' | 'breaker'; severity?: 'routine' | 'important' | 'grave' | 'blocked'; why: string };
