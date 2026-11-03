// Fournisseur simulé : rejoue un scénario. Sert aux tests et au mode démo (`odin chat --demo`).
import type { CompletionRequest, ModelResponse, Provider, ToolCall } from '../types.ts';

type Step = Partial<ModelResponse> | ((req: CompletionRequest) => Partial<ModelResponse>);
export type Script = Step[] | ((req: CompletionRequest) => Partial<ModelResponse>);

export class MockProvider implements Provider {
  readonly name = 'mock';
  readonly calls: CompletionRequest[] = [];
  private i = 0;
  private script: Script;
  private fallback: Partial<ModelResponse>;
  constructor(script: Script, fallback: Partial<ModelResponse> = { text: 'ok' }) {
    this.script = script; this.fallback = fallback;
  }

  async complete(req: CompletionRequest): Promise<ModelResponse> {
    this.calls.push({ ...req, messages: req.messages.map((m) => ({ ...m })), signal: undefined });
    const step: Step = typeof this.script === 'function' ? this.script : this.script[this.i++] ?? this.fallback;
    const r = typeof step === 'function' ? step(req) : step;
    const toolCalls: ToolCall[] = r.toolCalls ?? [];
    return {
      text: r.text ?? '',
      toolCalls,
      usage: r.usage ?? { inputTokens: 100, outputTokens: 20 },
      stopReason: r.stopReason ?? (toolCalls.length ? 'tool_use' : 'end'),
    };
  }
}

/** Démo hors ligne : Odin répond en écho et sait chercher dans sa mémoire. */
export function demoProvider(): MockProvider {
  return new MockProvider((req) => {
    if (req.system.startsWith('Résume')) return { text: 'Résumé de démonstration.' };
    const last = req.messages[req.messages.length - 1];
    if (last?.role === 'tool') return { text: `Voici ce que j'ai trouvé :\n${last.content.slice(0, 500)}` };
    const text = last?.content ?? '';
    if (/souviens|mémoire|remember/i.test(text)) {
      return { toolCalls: [{ id: `demo_${Date.now()}`, name: 'memory_search', input: { query: text } }] };
    }
    return { text: `(mode démo, sans modèle) Tu as dit : « ${text.slice(0, 200)} ». Définis ANTHROPIC_API_KEY (ou un autre fournisseur) pour un vrai cerveau.` };
  });
}
