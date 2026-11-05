// Fournisseur Anthropic (API Messages), en fetch natif : aucune dépendance.
import { readSse } from './sse.ts';
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
    if (m.role === 'user') {
      for (const img of m.images ?? []) push('user', { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.data } });
      push('user', { type: 'text', text: m.content || '(vide)' });
    }
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
      body: JSON.stringify(req.onDelta ? { ...body, stream: true } : body),
      signal: req.signal,
    });
    if (!res.ok) throw new HttpError(res.status, await res.text(), res.headers.get('retry-after'));
    if (req.onDelta && res.body && (res.headers.get('content-type') ?? '').includes('event-stream')) return anthropicStream(res.body, req.onDelta);
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

/** Réponse Anthropic en flux : texte transmis au fil de l'eau, appels d'outils reconstitués. */
export async function anthropicStream(body: ReadableStream<Uint8Array>, onDelta: (t: string) => void): Promise<ModelResponse> {
  let text = '', stop = 'other', inTok = 0, outTok = 0;
  const blocks = new Map<number, { id: string; name: string; json: string }>();
  for await (const ev of readSse(body)) {
    let d: Record<string, any>;
    try { d = JSON.parse(ev.data); } catch { continue; }
    if (d.type === 'message_start') { const u = d.message?.usage ?? {}; inTok = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0); }
    else if (d.type === 'content_block_start' && d.content_block?.type === 'tool_use') blocks.set(d.index, { id: d.content_block.id, name: d.content_block.name, json: '' });
    else if (d.type === 'content_block_delta' && d.delta?.type === 'text_delta') { text += d.delta.text; onDelta(d.delta.text); }
    else if (d.type === 'content_block_delta' && d.delta?.type === 'input_json_delta') { const b = blocks.get(d.index); if (b) b.json += d.delta.partial_json; }
    else if (d.type === 'message_delta') { stop = d.delta?.stop_reason ?? stop; outTok = d.usage?.output_tokens ?? outTok; }
    else if (d.type === 'error') throw new Error(`Anthropic : ${d.error?.message ?? 'erreur du flux'}`);
  }
  const toolCalls: ToolCall[] = [...blocks.values()].map((b) => { let input: Record<string, unknown> = {}; try { input = b.json ? JSON.parse(b.json) : {}; } catch { /* arguments tronqués */ } return { id: b.id, name: b.name, input }; });
  return { text, toolCalls, usage: { inputTokens: inTok, outputTokens: outTok }, stopReason: stop === 'tool_use' ? 'tool_use' : stop === 'max_tokens' ? 'max_tokens' : stop === 'end_turn' ? 'end' : toolCalls.length ? 'tool_use' : 'end' };
}
