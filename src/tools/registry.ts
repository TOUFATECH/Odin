// Gungnir — la lance qui ne manque jamais sa cible : le registre des outils.
// Chaque outil déclare son NIVEAU DE RISQUE ; c'est Heimdall (le code), pas le modèle,
// qui décide s'il peut s'exécuter.

import type { Redactor } from '../heimdall/redact.ts';
import type { Muninn } from '../muninn/store.ts';
import type { Yggdrasil } from '../yggdrasil/skills.ts';
import type { Inventory } from '../hlidskjalf/inventory.ts';
import type { OdinConfig } from '../config.ts';
import type { Mimir } from '../mimir/decisions.ts';
import type { JsonSchema, Risk, ToolSpec } from '../types.ts';

export interface ToolResult {
  output: string;
  /** Le résultat contient du contenu non fiable → la session est marquée. */
  tainted?: boolean;
}

export interface ToolContext {
  sessionId: string;
  channel: string;
  peer: string;
  workspace: string;
  muninn: Muninn;
  skills: Yggdrasil;
  redactor: Redactor;
  signal: AbortSignal;
  isTainted(): boolean;
  /** Mímir (Jev) : jugements typés, si activé. */
  mimir?: Mimir;
  /** Inventaire du réseau (Hliðskjálf). */
  inventory?: Inventory;
  netConfig?: OdinConfig['network'];
  /** Mode Odin Breaker actif (réseau local ouvert aux outils web). */
  breaker?: boolean;
  /** Isolation du shell (conteneur Docker) si configurée. */
  sandbox?: { kind: 'none' | 'docker'; image: string; network: boolean };
  /** Fourni par l'agent : lance des sous-agents en parallèle (Sleipnir). */
  delegate?(tasks: Array<{ goal: string; context?: string }>): Promise<ToolResult>;
  /** Fourni par la passerelle : envoie un message sur un canal. */
  send?(channel: string, peer: string, text: string): Promise<void>;
}

export interface Tool {
  name: string;
  description: string;
  risk: Risk;
  schema: JsonSchema;
  /** Toute sortie de cet outil est non fiable (web, fichiers téléchargés…). */
  taints?: boolean;
  /** Résumé lisible pour la demande de validation. */
  summarize?(input: Record<string, unknown>): string;
  /** Pour le shell : la commande à contrôler par les règles dédiées. */
  command?(input: Record<string, unknown>): string;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string | ToolResult>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(...tools: Tool[]): this {
    for (const t of tools) {
      if (this.tools.has(t.name)) throw new Error(`Outil en double : ${t.name}`);
      this.tools.set(t.name, t);
    }
    return this;
  }

  get(name: string): Tool | undefined { return this.tools.get(name); }
  all(): Tool[] { return [...this.tools.values()]; }

  /** Sous-ensemble (pour les sous-agents) : seulement les noms autorisés. */
  subset(names: (n: string) => boolean): ToolRegistry {
    const r = new ToolRegistry();
    for (const t of this.tools.values()) if (names(t.name)) r.register(t);
    return r;
  }

  specs(): ToolSpec[] {
    return this.all().map((t) => ({ name: t.name, description: `${t.description} [risque : ${t.risk}]`, inputSchema: t.schema }));
  }
}

/** Validation minimale d'entrée selon le schéma JSON (types + champs requis). */
export function validateInput(schema: JsonSchema, input: unknown): string[] {
  const errs: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return ['l\'entrée doit être un objet JSON'];
  const obj = input as Record<string, unknown>;
  if ('_raw' in obj) return ['arguments JSON illisibles'];
  for (const k of schema.required ?? []) if (obj[k] === undefined || obj[k] === null) errs.push(`champ requis manquant : ${k}`);
  for (const [k, v] of Object.entries(obj)) {
    const s = schema.properties?.[k];
    if (!s?.type || v === undefined || v === null) continue;
    const actual = Array.isArray(v) ? 'array' : typeof v;
    const ok = s.type === 'integer' ? Number.isInteger(v) : s.type === actual;
    if (!ok) errs.push(`${k} doit être de type ${s.type} (reçu ${actual})`);
    if (s.enum && !s.enum.includes(v)) errs.push(`${k} doit valoir : ${s.enum.join(', ')}`);
  }
  return errs;
}

export const str = (description: string): JsonSchema => ({ type: 'string', description });
export const num = (description: string): JsonSchema => ({ type: 'number', description });
export const bool = (description: string): JsonSchema => ({ type: 'boolean', description });
export const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required });
