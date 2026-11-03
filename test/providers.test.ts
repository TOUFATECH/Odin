import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAnthropicMessages } from '../src/providers/anthropic.ts';
import { parseArgs, toOpenAIMessages } from '../src/providers/openai.ts';
import { HttpError } from '../src/providers/http.ts';
import { Router } from '../src/providers/router.ts';
import type { Message, Provider } from '../src/types.ts';

const convo: Message[] = [
  { role: 'user', content: 'liste' },
  { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'fs_list', input: {} }, { id: 't2', name: 'fs_read', input: { path: 'a' } }] },
  { role: 'tool', toolCallId: 't1', toolName: 'fs_list', content: 'a' },
  { role: 'tool', toolCallId: 't2', toolName: 'fs_read', content: 'contenu' },
  { role: 'assistant', content: 'fini' },
];

test('Anthropic : les résultats d\'outils consécutifs sont fusionnés dans un seul message user', () => {
  const m = toAnthropicMessages(convo);
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(m[2].content.length, 2);
  assert.equal(m[2].content[0].type, 'tool_result');
});

test('OpenAI : format tool_calls / role tool', () => {
  const m = toOpenAIMessages('sys', convo);
  assert.equal(m[0].role, 'system');
  assert.equal((m[2].tool_calls as unknown[]).length, 2);
  assert.equal(m[3].role, 'tool');
});

test('réparation des arguments JSON abîmés', () => {
  assert.deepEqual(parseArgs('{"a":1,}'), { a: 1 });
  assert.deepEqual(parseArgs('```json\n{"a":2}\n```'), { a: 2 });
  assert.ok('_raw' in parseArgs('pas du json'));
});

const fake = (name: string, fn: () => Promise<void>): Provider => ({
  name,
  async complete() { await fn(); return { text: name, toolCalls: [], usage: { inputTokens: 1000, outputTokens: 1000 }, stopReason: 'end' }; },
});

test('routeur : réessai puis bascule, erreur définitive sans réessai, coût calculé', async () => {
  let a = 0, b = 0;
  const r = new Router([
    { provider: fake('A', async () => { a++; throw new HttpError(401, 'clé invalide'); }), cfg: { kind: 'mock', model: 'a' } },
    { provider: fake('B', async () => { if (++b < 2) throw new HttpError(503, 'surcharge'); }), cfg: { kind: 'mock', model: 'b', priceInPerM: 3, priceOutPerM: 15 } },
  ], 2, async () => {});
  const res = await r.complete({ system: '', messages: [], tools: [], maxTokens: 10 });
  assert.equal(res.text, 'B');
  assert.equal(a, 1, '401 : pas de réessai');
  assert.equal(b, 2, '503 : réessayé');
  assert.equal(res.costUsd, 0.018);
});
