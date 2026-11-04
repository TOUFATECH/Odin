// Fournisseur « compatible OpenAI » (chat/completions). Un seul adaptateur couvre
// OpenAI, OpenRouter, Nous Portal, Ollama (http://localhost:11434/v1), LM Studio, vLLM…
import type { CompletionRequest, Message, ModelResponse, Provider, ToolCall } from '../types.ts';
import { HttpError } from './http.ts';

/** Convertit l'historique Odin vers le format OpenAI (pur, testable). */
export function toOpenAIMessages(system: string, messages: Message[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.images?.length ? [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))] : m.content });
    else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else {
      out.push({
        role: 'assistant',
        content: m.content || null,
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
        max_tokens: req.maxTokens,
        messages: toOpenAIMessages(req.system, req.messages),
        ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
      }),
      signal: req.signal,
    });
    if (!res.ok) throw new HttpError(res.status, await res.text(), res.headers.get('retry-after'));
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason: string }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const choice = data.choices[0];
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((c, i) => ({
      id: c.id || `call_${i}`, name: c.function.name, input: parseArgs(c.function.arguments),
    }));
    return {
      text: choice.message.content ?? '',
      toolCalls,
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      stopReason: toolCalls.length ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end',
    };
  }
}
