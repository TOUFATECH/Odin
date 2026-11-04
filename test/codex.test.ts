import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { CODEX, CodexProvider, codexAuthFile, codexToken, finishCodexLogin, loadCodexAuth, parseCallback, parseResponsesStream, saveCodexAuth, startCodexLogin, toResponsesInput } from '../src/providers/codex.ts';
import { buildProvider } from '../src/providers/router.ts';
import { applySettings, providerFor } from '../src/settings.ts';
import { loadConfig } from '../src/config.ts';
import { makeOdin } from './helpers.ts';

const jwt = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const idToken = jwt({ email: 'moi@exemple.fr', 'https://api.openai.com/auth': { chatgpt_account_id: 'acc_123', chatgpt_plan_type: 'pro' } });
const access = (expSec: number) => jwt({ exp: Math.floor(Date.now() / 1000) + expSec });
type Call = { url: string; init: RequestInit };
const fakeFetch = (handler: (c: Call) => Response) => { const calls: Call[] = []; const f = (async (url: string, init: RequestInit) => { const c = { url: String(url), init }; calls.push(c); return handler(c); }) as unknown as typeof fetch; return { f, calls }; };

test('connexion ChatGPT (PKCE) : lien, retour collé, jetons rangés à part en 600', async () => {
  const o = makeOdin([]);
  try {
    const login = startCodexLogin();
    const u = new URL(login.url);
    assert.equal(u.origin + u.pathname, CODEX.authorizeUrl);
    assert.equal(u.searchParams.get('client_id'), CODEX.clientId);
    assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.ok((u.searchParams.get('code_challenge') ?? '').length >= 43);
    assert.match(u.searchParams.get('scope') ?? '', /offline_access/);

    assert.deepEqual(parseCallback(`http://localhost:1455/auth/callback?code=abc123xyz&state=${login.state}`), { code: 'abc123xyz', state: login.state });
    assert.throws(() => parseCallback('http://localhost:1455/auth/callback?error=access_denied'), /refusée/);
    await assert.rejects(finishCodexLogin(o.paths, login, 'http://localhost:1455/auth/callback?code=abc123xyz&state=autre'), /ne correspond pas/);

    const { f, calls } = fakeFetch(() => Response.json({ access_token: access(3600), refresh_token: 'rt_1', id_token: idToken, expires_in: 3600 }));
    const a = await finishCodexLogin(o.paths, login, `http://localhost:1455/auth/callback?code=abc123xyz&state=${login.state}`, f);
    assert.equal(a.account_id, 'acc_123'); assert.equal(a.email, 'moi@exemple.fr'); assert.equal(a.plan, 'pro');
    const body = new URLSearchParams(String(calls[0].init.body));
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code_verifier'), login.verifier, 'le secret PKCE accompagne le code');
    if (process.platform !== 'win32') assert.equal(statSync(codexAuthFile(o.paths)).mode & 0o777, 0o600);
    assert.ok(buildProvider({ kind: 'openai-codex', model: 'gpt-6-luna' }, {}, o.paths) instanceof CodexProvider, 'connecté : fournisseur prêt');
  } finally { o.cleanup(); }
});

test('jetons : renouvelés avant expiration, nouveau jeton de rafraîchissement enregistré', async () => {
  const o = makeOdin([]);
  try {
    assert.equal(buildProvider({ kind: 'openai-codex', model: 'x' }, {}, o.paths), undefined, 'pas connecté : pas de fournisseur');
    saveCodexAuth(o.paths, { access_token: access(60), refresh_token: 'rt_old', id_token: idToken, account_id: 'acc_123', expires_at: Date.now() + 60_000, last_refresh: 0 });
    const { f, calls } = fakeFetch(() => Response.json({ access_token: access(3600), refresh_token: 'rt_new', expires_in: 3600 }));
    const t = await codexToken(o.paths, false, f);
    assert.equal(calls.length, 1, 'expire dans moins de 5 min : renouvelé');
    assert.equal(JSON.parse(String(calls[0].init.body)).refresh_token, 'rt_old');
    assert.equal(t.refresh_token, 'rt_new');
    assert.equal(loadCodexAuth(o.paths)?.refresh_token, 'rt_new', 'le jeton qui a tourné est gardé');
    assert.equal(t.account_id, 'acc_123');
    await codexToken(o.paths, false, f);
    assert.equal(calls.length, 1, 'encore valide : pas d\'appel');
    const bad = fakeFetch(() => new Response('invalid_grant', { status: 401 }));
    await assert.rejects(codexToken(o.paths, true, bad.f), /expirée ou révoquée/);
  } finally { o.cleanup(); }
});

test('API Responses de Codex : historique converti, flux lu, outils, 401 → renouvellement puis réessai', async () => {
  const input = toResponsesInput([
    { role: 'user', content: 'Range mes factures', images: [{ mime: 'image/png', data: 'AAA' }] },
    { role: 'assistant', content: 'Je regarde.', toolCalls: [{ id: 'c1', name: 'fs_list', input: { path: '.' } }] },
    { role: 'tool', content: 'factures/', toolCallId: 'c1', toolName: 'fs_list' },
  ]);
  assert.equal((input[0].content as Array<{ type: string }>)[1].type, 'input_image');
  assert.deepEqual(input[2], { type: 'function_call', call_id: 'c1', name: 'fs_list', arguments: '{"path":"."}' });
  assert.deepEqual(input[3], { type: 'function_call_output', call_id: 'c1', output: 'factures/' });

  const sse = (evs: unknown[]) => evs.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const stream = sse([
    { type: 'response.output_text.delta', delta: 'Bon' }, { type: 'response.output_text.delta', delta: 'jour' },
    { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call_9', name: 'fs_write', arguments: '{"path":"a.txt","content":"x"}' } },
    { type: 'response.completed', response: { usage: { input_tokens: 12, output_tokens: 5 } } },
  ]);
  const r = parseResponsesStream(stream);
  assert.equal(r.text, 'Bonjour');
  assert.deepEqual(r.toolCalls, [{ id: 'call_9', name: 'fs_write', input: { path: 'a.txt', content: 'x' } }]);
  assert.deepEqual(r.usage, { inputTokens: 12, outputTokens: 5 });
  assert.throws(() => parseResponsesStream(sse([{ type: 'response.failed', response: { error: { message: 'modèle inconnu' } } }])), /modèle inconnu/);

  const o = makeOdin([]);
  try {
    saveCodexAuth(o.paths, { access_token: 'tok_old', refresh_token: 'rt', account_id: 'acc_123', expires_at: Date.now() + 3600_000, last_refresh: Date.now() });
    let first = true;
    const { f, calls } = fakeFetch((c) => {
      if (c.url === CODEX.tokenUrl) return Response.json({ access_token: access(3600), refresh_token: 'rt2', id_token: idToken });
      if (first) { first = false; return new Response('expired', { status: 401 }); }
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    });
    const p = new CodexProvider(o.paths, 'openai-codex:gpt-6-luna', 'https://exemple.test/codex', f);
    const out = await p.complete({ system: 'Tu es Odin.', messages: [{ role: 'user', content: 'salut' }], tools: [{ name: 'fs_write', description: 'écrit', inputSchema: { type: 'object', properties: {} } }], model: 'gpt-6-luna', maxTokens: 100 });
    assert.equal(out.text, 'Bonjour');
    const api = calls.filter((c) => c.url.endsWith('/responses'));
    assert.equal(api.length, 2, '401 : renouvellement puis réessai');
    assert.equal(calls[1].url, CODEX.tokenUrl);
    const h = api[1].init.headers as Record<string, string>;
    assert.equal(h['chatgpt-account-id'], 'acc_123');
    assert.match(h.authorization, /^Bearer x\./, 'nouveau jeton après renouvellement');
    const body = JSON.parse(String(api[1].init.body));
    assert.equal(body.instructions, 'Tu es Odin.'); assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.tools[0].name, 'fs_write');
  } finally { o.cleanup(); }
});

test('réglages : préréglage « OpenAI Codex (abonnement ChatGPT) », sans clé', () => {
  const o = makeOdin([]);
  try {
    assert.deepEqual(providerFor({ preset: 'openai-codex', model: 'gpt-6-luna' }), { kind: 'openai-codex', model: 'gpt-6-luna' });
    applySettings(o.paths, o.cfg, 'model', { preset: 'openai-codex', model: 'gpt-6-luna', tier: 'strong' });
    const cfg = loadConfig(o.paths);
    assert.equal(cfg.providers[0].kind, 'openai-codex'); assert.equal(cfg.providers[0].tier, 'strong');
    assert.equal(cfg.providers[0].apiKeyEnv, undefined, 'aucune clé : la connexion ChatGPT suffit');
  } finally { o.cleanup(); }
});
