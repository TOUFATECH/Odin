// Fournisseur Anthropic (API Messages), en fetch natif : aucune dépendance.
import type { CompletionRequest, Message, ModelResponse, Provider, ToolCall } from '../types.ts';
import { HttpError } from './http.ts';

type Block = Record<string, unknown>;

/** Convertit l'historique Odin vers le format Anthropic (pur, testable). */
export function toAnthropicMessages(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: Block[] }> {
  const out: Array<{ role: 'user' | 'assistant'; content: Block[] }> = [];
  const push = (role: 'user' | 'assistant', block: Block) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === 'user') push('user', { type: 'text', text: m.content || '(vide)' });
    else if (m.role === 'tool') push('user', { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content });
    else {
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.input });
      if (!m.content && !m.toolCalls?.length) push('assistant', { type: 'text', text: '(vide)' });
    }
  }
  return out;
}

export class AnthropicProvider implements Provider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com', name = 'anthropic') {
    this.apiKey = apiKey; this.baseUrl = baseUrl; this.name = name;
  }

  async complete(req: CompletionRequest): Promise<ModelResponse> {
    const body = {
      model: req.model,
      max_tokens: req.maxTokens,
      // Mise en cache du prompt système et des outils : ils changent rarement d'un tour à l'autre.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: toAnthropicMessages(req.messages),
      tools: req.tools.map((t, i) => ({
        name: t.name, description: t.description, input_schema: t.inputSchema,
        ...(i === req.tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
      })),
    };
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throw new HttpError(res.status, await res.text(), res.headers.get('retry-after'));
    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    const toolCalls: ToolCall[] = data.content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id!, name: b.name!, input: b.input ?? {} }));
    return {
      text: data.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      toolCalls,
      usage: {
        inputTokens: data.usage.input_tokens + (data.usage.cache_read_input_tokens ?? 0) + (data.usage.cache_creation_input_tokens ?? 0),
        outputTokens: data.usage.output_tokens,
      },
      stopReason: data.stop_reason === 'tool_use' ? 'tool_use' : data.stop_reason === 'max_tokens' ? 'max_tokens' : data.stop_reason === 'end_turn' ? 'end' : 'other',
    };
  }
}
