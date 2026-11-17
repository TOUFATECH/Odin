// Fournisseur simulé : rejoue un scénario écrit dans un essai (ce n'est pas un modèle appris). Sert aux essais.
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

