import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAnthropicMessages } from '../src/providers/anthropic.ts';
import { parseArgs, toOpenAIMessages } from '../src/providers/openai.ts';
import { HttpError } from '../src/providers/http.ts';
import { Router, isQuotaError, tierOf } from '../src/providers/router.ts';
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

test('paliers : local pour le simple, standard par défaut, strong pour le complexe ; repli vers le bas en dernier', () => {
  const r = new Router([
    { provider: fake('strong', async () => {}), cfg: { kind: 'mock', model: 'claude-opus' } },
    { provider: fake('std', async () => {}), cfg: { kind: 'mock', model: 'claude-sonnet' } },
    { provider: fake('local', async () => {}), cfg: { kind: 'mock', model: 'qwen3:14b', baseUrl: 'http://localhost:11434/v1' } },
  ], 0, async () => {});
  assert.deepEqual(r.tiers.sort(), ['local', 'standard', 'strong']);
  const names = (o?: { minTier?: 'local' | 'standard' | 'strong' }) => r.order(o).map((x) => x.provider.name);
  assert.deepEqual(names({ minTier: 'local' }), ['local', 'std', 'strong'], 'simple : le gratuit d\'abord');
  assert.deepEqual(names(), ['std', 'strong', 'local'], 'ordinaire : standard, puis plus fort, le local en dernier recours');
  assert.deepEqual(names({ minTier: 'strong' }), ['strong', 'std', 'local'], 'complexe : le plus capable');
  assert.equal(tierOf({ kind: 'openai', model: 'gpt-5-mini' }), 'standard');
  assert.equal(tierOf({ kind: 'openai', model: 'gpt-5' }), 'strong');
  assert.equal(tierOf({ kind: 'openai', model: 'x', tier: 'local' }), 'local', 'palier déclaré prioritaire');
});

test('quota épuisé : bascule immédiate, fournisseur mis de côté, avis donné, retour quand le quota revient', async () => {
  let now = 1_000_000, aCalls = 0;
  const a = fake('A', async () => { aCalls++; if (now < 1_000_000 + 10 * 60_000) throw new HttpError(429, 'You exceeded your current quota, please check your plan and billing details'); });
  const r = new Router([{ provider: a, cfg: { kind: 'mock', model: 'a' } }, { provider: fake('B', async () => {}), cfg: { kind: 'mock', model: 'b' } }], 2, async () => {}, { pauseMs: 5 * 60_000, now: () => now });
  const paused: string[] = []; r.onPause = (n) => paused.push(n);
  const req = { system: '', messages: [], tools: [], maxTokens: 10 };
  let res = await r.complete(req);
  assert.equal(res.text, 'B');
  assert.equal(aCalls, 1, 'quota : pas de réessai sur A');
  assert.match(res.notice!, /Quota épuisé chez A : mis de côté 5 min/);
  assert.match(res.notice!, /A indisponible, réponse de B/);
  assert.deepEqual(paused, ['A']);
  res = await r.complete(req);
  assert.equal(res.text, 'B');
  assert.equal(aCalls, 1, 'A n\'est même plus essayé pendant la pause');
  assert.equal(res.notice, undefined, 'bascule silencieuse ensuite');
  now += 6 * 60_000; // pause finie, quota pas encore revenu
  res = await r.complete(req);
  assert.equal(aCalls, 2); assert.equal(res.text, 'B');
  now += 10 * 60_000; // quota revenu
  res = await r.complete(req);
  assert.equal(res.text, 'A');
  assert.match(res.notice!, /A est de nouveau disponible/);
  assert.equal(isQuotaError(new HttpError(429, 'Rate limit: too many requests per minute')), false, 'une simple limite de débit se réessaie');
  assert.equal(isQuotaError(new HttpError(402, 'insufficient credits')), true);
  assert.equal(isQuotaError(new HttpError(403, 'billing hard limit reached')), true);
});
