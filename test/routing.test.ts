import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mnemosyne } from '../src/muninn/store.ts';
import { HttpError } from '../src/providers/http.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { prettyModel, providerLabel, routingReport, serviceOf, turnSummary, withRouteContext, type RouteContext, type RouteEntry } from '../src/providers/journal.ts';
import { buildProvider, Router, strengthsOf, visionOf, type Route } from '../src/providers/router.ts';
import { toOpenAIMessages } from '../src/providers/openai.ts';
import { detectPreset, providerFor, PRESETS } from '../src/settings.ts';
import { signalLinkState } from '../src/bifrost/channels/signal.ts';
import type { CompletionRequest, ModelResponse, Provider } from '../src/types.ts';
import { call, makeOdin } from './helpers.ts';

const req = { system: 's', messages: [{ role: 'user' as const, content: 'x' }], tools: [], maxTokens: 10 };
const named = (name: string, fn: (r: CompletionRequest) => Promise<ModelResponse>): Provider => ({ name, complete: fn });
const okResp = (text: string): ModelResponse => ({ text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end' });

test('noms lisibles des IA', () => {
  assert.equal(prettyModel('claude-sonnet-5-5'), 'Claude Sonnet 5.5');
  assert.equal(prettyModel('gpt-6-luna'), 'GPT-6 Luna');
  assert.equal(prettyModel('kimi-k2.6'), 'Kimi K2.6');
  assert.equal(prettyModel('deepseek-v4-pro'), 'DeepSeek V4 Pro');
  assert.equal(providerLabel('anthropic:claude-sonnet-5-5'), 'Claude Sonnet 5.5 (Anthropic)');
  assert.equal(providerLabel('openai-codex:gpt-6-luna'), 'GPT-6 Luna (ChatGPT Codex)');
  assert.equal(providerLabel('openrouter:anthropic/claude-sonnet-5.5'), 'Claude Sonnet 5.5 (OpenRouter)');
  assert.equal(providerLabel('kimi:kimi-k2.6'), 'Kimi K2.6 (Kimi · Moonshot)');
  assert.equal(serviceOf('https://api.deepseek.com/v1'), 'deepseek');
  assert.equal(serviceOf('https://api.moonshot.ai/v1'), 'kimi');
  assert.equal(serviceOf('http://localhost:11434/v1'), 'ollama');
});

test('chaque service a son propre nom : OpenRouter, DeepSeek et Kimi ne se confondent plus', () => {
  const env = { DEEPSEEK_API_KEY: 'k', MOONSHOT_API_KEY: 'k', OPENROUTER_API_KEY: 'k' };
  assert.equal(buildProvider(providerFor({ preset: 'deepseek', model: 'deepseek-flash' }), env)?.name, 'deepseek:deepseek-flash');
  assert.equal(buildProvider(providerFor({ preset: 'kimi', model: 'kimi-k2.6' }), env)?.name, 'kimi:kimi-k2.6');
  assert.equal(buildProvider(providerFor({ preset: 'openrouter', model: 'moonshotai/kimi-k2.6' }), env)?.name, 'openrouter:moonshotai/kimi-k2.6');
});

test('préréglages Kimi et DeepSeek : adresse, clé, prix, détection', () => {
  const d = providerFor({ preset: 'deepseek', model: 'deepseek-flash' });
  assert.equal(d.baseUrl, 'https://api.deepseek.com/v1'); assert.equal(d.apiKeyEnv, 'DEEPSEEK_API_KEY'); assert.equal(d.priceInPerM, 0.15);
  assert.equal(providerFor({ preset: 'deepseek', model: 'deepseek-v4-pro' }).priceOutPerM, 1.98);
  const k = providerFor({ preset: 'kimi', model: 'kimi-k2.6' });
  assert.equal(k.baseUrl, 'https://api.moonshot.ai/v1'); assert.equal(k.apiKeyEnv, 'MOONSHOT_API_KEY');
  assert.equal(detectPreset(d), 'deepseek'); assert.equal(detectPreset(k), 'kimi');
  assert.ok(PRESETS.kimi.note?.includes('Chine'));
  assert.deepEqual(strengthsOf(k).includes('long'), true);
  assert.equal(visionOf({ kind: 'openai', model: 'deepseek-v4-pro' }), false);
  assert.equal(visionOf({ kind: 'openai', model: 'kimi-k2.6' }), true);
});

test('journal : la panne du premier est notée, le secours est nommé avec la raison', async () => {
  const seen: RouteEntry[] = [];
  const a = named('anthropic:claude-sonnet-5-5', async () => { throw new HttpError(402, 'credit balance is too low', null); });
  const b = named('deepseek:deepseek-flash', async () => okResp('salut'));
  const r = new Router([{ provider: a, cfg: { kind: 'anthropic', model: 'claude-sonnet-5-5' } }, { provider: b, cfg: { kind: 'openai', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com/v1', priceInPerM: 1, priceOutPerM: 1 } }], 0, async () => undefined);
  r.onRoute = (e) => seen.push(e);
  const ctx: RouteContext = { turnId: 't1', sessionId: 'web:principal', channel: 'web', request: 'bonjour', need: 'discussion', entries: [] };
  const out = await withRouteContext(ctx, () => r.complete(req));
  assert.equal(out.text, 'salut');
  assert.equal(seen.length, 1);
  const e = seen[0];
  assert.equal(e.provider, 'deepseek:deepseek-flash'); assert.equal(e.label, 'DeepSeek Flash (DeepSeek)'); assert.equal(e.ok, true);
  assert.equal(e.turnId, 't1'); assert.equal(e.request, 'bonjour');
  assert.equal(e.attempts[0].provider, 'anthropic:claude-sonnet-5-5'); assert.match(e.attempts[0].error!, /quota/);
  assert.match(e.reason, /secours n° 1/);
  assert.equal(ctx.entries.length, 1);
  assert.match(turnSummary(ctx.entries).line, /^DeepSeek Flash \(DeepSeek\) a répondu$/);
});

test('journal : tout échoue → entrée « aucune IA », avec chaque essai', async () => {
  const seen: RouteEntry[] = [];
  const a = named('openai:gpt-5', async () => { throw new HttpError(401, 'bad key', null); });
  const r = new Router([{ provider: a, cfg: { kind: 'openai', model: 'gpt-5' } }], 0, async () => undefined);
  r.onRoute = (e) => seen.push(e);
  await assert.rejects(() => r.complete(req));
  assert.equal(seen.length, 1); assert.equal(seen[0].ok, false); assert.match(seen[0].attempts[0].error!, /clé refusée/);
});

test('répartition : spécialité, images, données personnelles', () => {
  const p = (name: string): Provider => named(name, async () => okResp(name));
  const routes: Route[] = [
    { provider: p('anthropic:claude'), cfg: { kind: 'anthropic', model: 'claude-sonnet-5-5', strengths: ['écriture'] } },
    { provider: p('deepseek:deepseek-v4-pro'), cfg: { kind: 'openai', model: 'deepseek-v4-pro', tier: 'standard', personal: false } },
    { provider: p('kimi:kimi-k2.6'), cfg: { kind: 'openai', model: 'kimi-k2.6', personal: false } },
  ];
  const r = new Router(routes);
  // Code : DeepSeek (spécialité code) passe devant Claude (déclaré écriture seulement).
  assert.equal(r.order({ need: 'code' })[0].provider.name, 'deepseek:deepseek-v4-pro');
  // Discussion : Claude (écriture) en premier.
  assert.equal(r.order({ need: 'discussion' })[0].provider.name, 'anthropic:claude');
  // Images : DeepSeek V4 Pro ne voit pas, il est écarté.
  assert.ok(!r.order({ vision: true }).some((x) => x.provider.name === 'deepseek:deepseek-v4-pro'));
  // Maison (vie privée) : les modèles marqués « pas de données personnelles » ne reçoivent rien.
  assert.deepEqual(r.order({ need: 'maison' }).map((x) => x.provider.name), ['anthropic:claude']);
  assert.deepEqual(r.order({ purpose: 'mémoire' }).map((x) => x.provider.name), ['anthropic:claude']);
});

test('Mnémosyne : journal enregistré, relu par tour, bilan, rapport', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-rt-'));
  const m = new Mnemosyne(join(dir, 'm.db'));
  const base: RouteEntry = { at: 1000, turnId: 'a', sessionId: 's', channel: 'web', request: 'quelle heure', purpose: 'agent', provider: 'anthropic:claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (Anthropic)', tier: 'standard', minTier: 'standard', need: 'discussion', reason: 'premier de ta liste', attempts: [{ provider: 'anthropic:claude-sonnet-5-5', ok: true, ms: 5 }], ok: true, ms: 800, tokensIn: 10, tokensOut: 5, costUsd: 0.001 };
  m.recordRoute(base);
  m.recordRoute({ ...base, at: 1100, purpose: 'relecture', provider: 'openai-codex:gpt-6-luna', label: 'GPT-6 Luna (ChatGPT Codex)' });
  m.recordRoute({ ...base, at: 2000, turnId: 'b', request: 'et demain', provider: 'kimi:kimi-k2.6', label: 'Kimi K2.6 (Kimi · Moonshot)', attempts: [{ provider: 'anthropic:claude-sonnet-5-5', ok: false, ms: 3, error: 'quota épuisé (HTTP 429)' }, { provider: 'kimi:kimi-k2.6', ok: true, ms: 4 }] });
  assert.deepEqual(m.recentTurns('s'), ['b', 'a']);
  assert.equal(m.routes({ turnId: 'a' }).length, 2);
  const last = routingReport(m, { scope: 'dernier', sessionId: 's', currentTurnId: 'c', now: 3000 });
  assert.match(last, /Demande « et demain »/); assert.match(last, /Kimi K2\.6 \(Kimi · Moonshot\) a répondu/); assert.match(last, /avant : Claude Sonnet 5\.5 \(Anthropic\) \(quota épuisé/);
  // La demande en cours est exclue de « dernier ».
  assert.match(routingReport(m, { scope: 'dernier', sessionId: 's', currentTurnId: 'b' }), /quelle heure.*Claude Sonnet 5\.5 \(Anthropic\) a répondu · relecture : GPT-6 Luna/s);
  const bilan = routingReport(m, { scope: 'bilan', now: 3000 });
  assert.match(bilan, /Claude Sonnet 5\.5 \(Anthropic\) : 1 appel/);
  assert.equal(m.routeStats(0).length, 3);
  // Ménage du journal : au-delà de 6 mois, l'appel est effacé ; les autres restent.
  const jour = 86_400_000, now = 400 * jour;
  m.recordRoute({ ...base, at: now - 10 * jour, turnId: 'recent' });
  assert.equal(m.pruneRoutes(now), 3, 'les trois appels anciens sont effacés');
  assert.deepEqual(m.routes({}).map((r) => r.turnId), ['recent']);
  assert.equal(m.pruneRoutes(now), 0, 'rien de plus à effacer');
  m.close(); rmSync(dir, { recursive: true, force: true });
});

test('DeepSeek / Kimi : la réflexion est renvoyée avec les appels d\'outils, jamais à OpenAI', () => {
  const msgs = [{ role: 'user' as const, content: 'q' }, { role: 'assistant' as const, content: '', reasoning: 'je pense', toolCalls: [{ id: '1', name: 't', input: {} }] }, { role: 'tool' as const, toolCallId: '1', content: 'r' }];
  assert.equal(toOpenAIMessages('s', msgs, true)[2].reasoning_content, 'je pense');
  assert.equal('reasoning_content' in toOpenAIMessages('s', msgs, false)[2], false);
  // Message d'outil sans réflexion connue (autre modèle) : champ présent mais vide, pour DeepSeek.
  assert.equal(toOpenAIMessages('s', [{ role: 'assistant', content: '', toolCalls: [{ id: '1', name: 't', input: {} }] }], true)[1].reasoning_content, '');
});

test('agent : la réponse dit quelle IA l\'a traitée, le journal garde le tour, ia_historique le relit', async () => {
  const o = makeOdin([{ text: 'Il est midi.' }, call('ia_historique', { portee: 'dernier' }), { text: 'C\'est le modèle mock qui a répondu.' }]);
  const r1 = await o.agent.run('Quelle est la capitale du Japon ?', { sessionId: 'web:principal', channel: 'web' });
  assert.equal(r1.answeredBy, 'Modèle de test a répondu');
  assert.ok(r1.turnId);
  const rows = o.muninn.routes({ turnId: r1.turnId });
  assert.equal(rows.length, 1); assert.equal(rows[0].sessionId, 'web:principal'); assert.equal(rows[0].request, 'Quelle est la capitale du Japon ?');
  const r2 = await o.agent.run('Quelle IA a répondu à ma question ?', { sessionId: 'web:principal', channel: 'web' });
  const toolOut = o.provider.calls[2].messages.find((m) => m.role === 'tool')?.content ?? '';
  assert.match(toolOut, /Demande « Quelle est la capitale du Japon \? »/);
  assert.match(toolOut, /a répondu/);
  assert.notEqual(r2.turnId, r1.turnId);
  // Les coûts sont rattachés à la vraie conversation.
  assert.ok(o.muninn.usageCount('web:principal') >= 3);
  o.cleanup();
});

test('Signal : QR code tant qu\'aucun numéro n\'est relié, puis le numéro', async () => {
  let linked = false;
  const fake = (async (u: string) => {
    if (u.endsWith('/v1/about')) return new Response(JSON.stringify({ mode: 'json-rpc' }), { status: 200 });
    if (u.endsWith('/v1/accounts')) return new Response(JSON.stringify(linked ? ['+262639000000'] : []), { status: 200 });
    if (u.includes('/v1/qrcodelink')) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const a = await signalLinkState('http://localhost:8080', fake);
  assert.equal(a.ok, true); assert.match(a.qr!, /^data:image\/png;base64,/);
  assert.equal((await signalLinkState('http://localhost:8080', fake, false)).qr, undefined);
  linked = true;
  assert.deepEqual((await signalLinkState('http://localhost:8080', fake)).accounts, ['+262639000000']);
  assert.equal((await signalLinkState('file:///etc/passwd', fake)).ok, false);
  const down = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
  assert.match((await signalLinkState('http://localhost:8080', down)).error!, /injoignable/);
});

test('MockProvider a un nom lisible dans le journal', () => {
  assert.equal(providerLabel(new MockProvider([]).name), 'Modèle de test');
});
