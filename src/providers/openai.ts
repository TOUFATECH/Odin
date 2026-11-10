// Fournisseur « compatible OpenAI » (chat/completions). Un seul adaptateur couvre
// OpenAI, OpenRouter, DeepSeek, Kimi (Moonshot), Nous Portal, Ollama (http://localhost:11434/v1), LM Studio, vLLM…
// DeepSeek et Kimi « réfléchissent » (reasoning_content) : cette réflexion est gardée pendant le tour
// et renvoyée avec les appels d'outils, comme leurs API le demandent ; elle n'est jamais affichée.
import { readSse } from './sse.ts';
import type { CompletionRequest, Message, ModelResponse, Provider, ToolCall } from '../types.ts';
import { HttpError } from './http.ts';

/** Convertit l'historique Odin vers le format OpenAI (pur, testable). */
export function toOpenAIMessages(system: string, messages: Message[], withReasoning = false): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.images?.length ? [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))] : m.content });
    else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else {
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(withReasoning && (m.reasoning || m.toolCalls?.length) ? { reasoning_content: m.reasoning ?? '' } : {}),
        ...(m.toolCalls?.length ? {
          tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })),
        } : {}),
      });
    }
  }
  return out;
}

/** Certains modèles renvoient des arguments JSON abîmés : on tente une réparation simple. */
export function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { /* on tente de réparer */ }
  try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1').replace(/^```(json)?|```$/g, '').trim()) as Record<string, unknown>; } catch { return { _raw: raw }; }
}

export class OpenAIProvider implements Provider {
  readonly name: string;
  private apiKey: string;
  private baseUrl: string;
  constructor(apiKey: string, baseUrl = 'https://api.openai.com/v1', name = 'openai') {
    this.apiKey = apiKey; this.baseUrl = baseUrl; this.name = name;
  }

  async complete(req: CompletionRequest): Promise<ModelResponse> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        model: req.model,
        ...(/api\.openai\.com/.test(this.baseUrl ?? '') ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
        messages: toOpenAIMessages(req.system, req.messages, /deepseek\.com|moonshot\.(ai|cn)|kimi\.ai/.test(this.baseUrl)),
        ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
        ...(req.onDelta ? { stream: true, stream_options: { include_usage: true } } : {}),
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new HttpError(res.status, await res.text(), res.headers.get('retry-after'));
    if (req.onDelta && res.body && (res.headers.get('content-type') ?? '').includes('event-stream')) return openaiStream(res.body, req.onDelta);
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string | null; reasoning_content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const choice = data.choices?.[0];
    if (!choice) throw new Error('réponse du modèle sans contenu (choices vide)');
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((c, i) => ({
      id: c.id || `call_${i}`, name: c.function.name, input: parseArgs(c.function.arguments),
    }));
    return {
      text: choice.message.content ?? '',
      ...(choice.message.reasoning_content ? { reasoning: choice.message.reasoning_content } : {}),
      toolCalls,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      stopReason: toolCalls.length ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end',
    };
  }
}

/** Réponse compatible OpenAI en flux : texte au fil de l'eau, appels d'outils reconstitués par index. */
export async function openaiStream(body: ReadableStream<Uint8Array>, onDelta: (t: string) => void): Promise<ModelResponse> {
  let text = '', reasoning = '', finish = '', inTok = 0, outTok = 0;
  const calls = new Map<number, { id: string; name: string; args: string }>();
  for await (const ev of readSse(body)) {
    if (ev.data.trim() === '[DONE]') break;
    let d: Record<string, any>;
    try { d = JSON.parse(ev.data); } catch { continue; }
    if (d.usage) { inTok = d.usage.prompt_tokens ?? inTok; outTok = d.usage.completion_tokens ?? outTok; }
    const ch = d.choices?.[0];
    if (!ch) continue;
    if (ch.delta?.content) { text += ch.delta.content; onDelta(ch.delta.content); }
    if (ch.delta?.reasoning_content) reasoning += ch.delta.reasoning_content;
    for (const tc of ch.delta?.tool_calls ?? []) {
      const c = calls.get(tc.index ?? 0) ?? { id: '', name: '', args: '' };
      if (tc.id) c.id = tc.id; if (tc.function?.name) c.name += tc.function.name; if (tc.function?.arguments) c.args += tc.function.arguments;
      calls.set(tc.index ?? 0, c);
    }
    if (ch.finish_reason) finish = ch.finish_reason;
  }
  const toolCalls: ToolCall[] = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, input: parseArgs(c.args) }));
  return { text, ...(reasoning ? { reasoning } : {}), toolCalls, usage: { inputTokens: inTok, outputTokens: outTok }, stopReason: toolCalls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end' };
}
