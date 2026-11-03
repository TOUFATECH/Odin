// Tests « de bout en bout » sur le réseau local : vrais appels HTTP vers de faux serveurs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AnthropicProvider } from '../src/providers/anthropic.ts';
import { OpenAIProvider } from '../src/providers/openai.ts';
import { HttpChannel } from '../src/bifrost/channels/http.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import { makeOdin } from './helpers.ts';

const body = async (req: IncomingMessage) => { let s = ''; for await (const c of req) s += c; return JSON.parse(s); };

async function fakeServer(handler: (path: string, json: Record<string, unknown>, headers: IncomingMessage['headers']) => unknown) {
  const srv = createServer(async (req, res) => {
    const out = handler(req.url!, await body(req), req.headers);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => srv.close() };
}

test('Anthropic : requête et réponse au bon format', async () => {
  let seen: Record<string, unknown> = {};
  const s = await fakeServer((path, json, h) => {
    assert.equal(path, '/v1/messages');
    assert.equal(h['x-api-key'], 'k');
    seen = json;
    return { content: [{ type: 'text', text: 'je lis' }, { type: 'tool_use', id: 'tu1', name: 'fs_read', input: { path: 'a' } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90 } };
  });
  const r = await new AnthropicProvider('k', s.url).complete({ system: 'sys', messages: [{ role: 'user', content: 'go' }], tools: [{ name: 'fs_read', description: 'd', inputSchema: { type: 'object' } }], model: 'm', maxTokens: 50 });
  s.close();
  assert.equal(r.text, 'je lis');
  assert.deepEqual(r.toolCalls[0], { id: 'tu1', name: 'fs_read', input: { path: 'a' } });
  assert.equal(r.usage.inputTokens, 100);
  assert.equal(r.stopReason, 'tool_use');
  assert.ok((seen.system as Array<Record<string, unknown>>)[0].cache_control, 'cache de prompt activé');
});

test('OpenAI-compatible (OpenRouter, Ollama…) : requête et réponse au bon format', async () => {
  const s = await fakeServer((path, json) => {
    assert.equal(path, '/v1/chat/completions');
    assert.equal((json.messages as Array<{ role: string }>)[0].role, 'system');
    return { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'shell', arguments: '{"command":"ls",}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 7, completion_tokens: 3 } };
  });
  const r = await new OpenAIProvider('', `${s.url}/v1`).complete({ system: 'sys', messages: [{ role: 'user', content: 'go' }], tools: [], model: 'llama', maxTokens: 50 });
  s.close();
  assert.deepEqual(r.toolCalls[0].input, { command: 'ls' });
  assert.equal(r.stopReason, 'tool_use');
});

test('API HTTP locale : jeton obligatoire, réponse synchrone', async () => {
  const o = makeOdin([{ text: 'pong' }]);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const gw = new Gateway(o, { owners: { http: ['*'] } }).add(new HttpChannel(port, 'jeton-de-test-assez-long'));
  await gw.start();
  const url = `http://127.0.0.1:${port}/v1/message`;
  const bad = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer faux' }, body: '{"text":"ping"}' });
  assert.equal(bad.status, 401);
  const ok = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer jeton-de-test-assez-long' }, body: '{"text":"ping","peer":"moi"}' });
  assert.deepEqual(await ok.json(), { reply: 'pong' });
  await gw.stop();
  o.cleanup();
});
