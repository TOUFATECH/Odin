// Classement des agents, suite : le « premier mot » compte toute activité du flux (texte, appel d'outil, raisonnement),
// aussi quand des outils sont fournis ; le routeur secondaire (résumés, réflexion, aides) suit le même classement ;
// l'agent local d'Odin classé avant les agents connectés prend le tour, et passe au suivant s'il ne sait pas.
// Faux agents et faux flux seulement : aucun appel à un vrai service, horloge injectée (aucune vraie attente de 30 s).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnthropicProvider, anthropicStream } from '../src/providers/anthropic.ts';
import { OpenAIProvider, openaiStream } from '../src/providers/openai.ts';
import { CodexProvider, saveCodexAuth } from '../src/providers/codex.ts';
import * as R from '../src/providers/router.ts';
import { odinPaths } from '../src/config.ts';
import { createOdin } from '../src/runtime.ts';
import type { Tool } from '../src/tools/registry.ts';
import type { CompletionRequest, ModelResponse, Provider } from '../src/types.ts';
import { makeOdin } from './helpers.ts';

const okResp = (text: string, extra: Partial<ModelResponse> = {}): ModelResponse => ({ text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end', ...extra });
const laisser = () => new Promise((r) => setImmediate(r));
const OUTILS = [{ name: 'fichier_ecrire', description: 'd', inputSchema: { type: 'object' } }];
const req = { system: 's', messages: [{ role: 'user' as const, content: 'x' }], tools: [], maxTokens: 10 };
type Suivie = CompletionRequest & { onActivite?: () => void };

/** Flux SSE d'essai, à partir d'événements (objets JSON ou chaîne brute). */
function flux(evs: unknown[]): ReadableStream<Uint8Array> {
  const t = evs.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
  return new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(t)); c.close(); } });
}

/** Horloge d'essai : le temps n'avance que quand l'essai le dit. */
function horloge() {
  let t = 0, n = 0;
  const minuteurs = new Map<number, { a: number; fn: () => void }>();
  return {
    now: () => t,
    minuteur: { poser: (fn: () => void, ms: number) => { const id = ++n; minuteurs.set(id, { a: t + ms, fn }); return id; }, retirer: (id: unknown) => { minuteurs.delete(id as number); } },
    avancer(ms: number) {
      const fin = t + ms;
      for (;;) {
        const dus = [...minuteurs.entries()].filter(([, m]) => m.a <= fin).sort((x, y) => x[1].a - y[1].a);
        if (!dus.length) break;
        const [id, m] = dus[0]; minuteurs.delete(id); t = m.a; m.fn();
      }
      t = fin;
    },
  };
}

/** Faux agent « qui signale son activité » comme les vrais fournisseurs ; garde les demandes reçues. */
function agent(name: string, fn: (r: Suivie) => Promise<ModelResponse>, signale = true): Provider & { appels: Suivie[]; signaleActivite?: boolean } {
  const appels: Suivie[] = [];
  return { name, appels, ...(signale ? { signaleActivite: true } : {}), complete: (r) => { appels.push(r); return fn(r); } };
}
const route = (p: Provider): R.Route => ({ provider: p, cfg: { kind: 'openai', model: p.name.split(':')[1] ?? p.name } });
function routeur(routes: R.Route[], classement: string[] | undefined, h = horloge()) {
  return { r: new R.Router(routes, 2, async () => undefined, { now: h.now, minuteur: h.minuteur, classement }), h };
}

// ---------------- 1. Fournisseurs : un rappel « activité » pour chaque morceau du flux ----------------

test('Anthropic en flux : un appel d\'outil sans texte signale son activité ; la réponse rendue ne change pas', async () => {
  const evs = [
    { type: 'message_start', message: { usage: { input_tokens: 7 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'fichier_ecrire' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '1}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } },
  ];
  let n = 0;
  const sans = await anthropicStream(flux(evs), () => undefined);
  const avec = await (anthropicStream as (b: ReadableStream<Uint8Array>, d: (t: string) => void, a?: () => void) => Promise<ModelResponse>)(flux(evs), () => undefined, () => { n++; });
  assert.ok(n >= 3, `activité signalée (${n})`);
  assert.deepEqual(avec, sans);
  // Par le fournisseur lui-même (fetch remplacé : rien ne sort).
  const vrai = globalThis.fetch;
  globalThis.fetch = (async () => new Response(flux(evs), { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
  try {
    let m = 0;
    const p = new AnthropicProvider('cle-essai', 'https://exemple.test');
    assert.equal((p as unknown as { signaleActivite?: boolean }).signaleActivite, true);
    const out = await p.complete({ ...req, tools: OUTILS, model: 'm', onDelta: () => undefined, onActivite: () => { m++; } } as Suivie);
    assert.ok(m >= 3); assert.deepEqual(out.toolCalls, [{ id: 't1', name: 'fichier_ecrire', input: { a: 1 } }]);
  } finally { globalThis.fetch = vrai; }
});

test('compatible OpenAI en flux : raisonnement puis appel d\'outil, sans texte, signalent leur activité ; la réponse ne change pas', async () => {
  const evs = [
    { choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { reasoning_content: 'je réfléchis' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'fichier_ecrire', arguments: '{"a"' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] }, finish_reason: 'tool_calls' }] },
    '[DONE]',
  ];
  let n = 0;
  const sans = await openaiStream(flux(evs), () => undefined);
  const avec = await (openaiStream as (b: ReadableStream<Uint8Array>, d: (t: string) => void, a?: () => void) => Promise<ModelResponse>)(flux(evs), () => undefined, () => { n++; });
  // Décision de la session (19/11) : tout morceau compte, même celui qui ne porte que le rôle (un modèle qui raisonne
  // n'envoie parfois rien d'autre avant sa réponse).
  assert.equal(n, 4, 'le rôle, le raisonnement et les deux morceaux d\'outil');
  assert.deepEqual(avec, sans);
  const vrai = globalThis.fetch;
  globalThis.fetch = (async () => new Response(flux(evs), { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
  try {
    let m = 0;
    const p = new OpenAIProvider('cle-essai', 'https://exemple.test/v1');
    assert.equal((p as unknown as { signaleActivite?: boolean }).signaleActivite, true);
    const out = await p.complete({ ...req, tools: OUTILS, model: 'm', onDelta: () => undefined, onActivite: () => { m++; } } as Suivie);
    assert.equal(m, 4); assert.equal(out.reasoning, 'je réfléchis'); assert.equal(out.toolCalls[0].name, 'fichier_ecrire');
  } finally { globalThis.fetch = vrai; }
});

test('Codex en flux : un appel d\'outil sans texte signale son activité ; la réponse ne change pas', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'odin-suite-codex-'));
  try {
    const paths = odinPaths(tmp);
    saveCodexAuth(paths, { access_token: 'jeton', refresh_token: 'rt', account_id: 'acc', expires_at: Date.now() + 3600_000, last_refresh: Date.now() });
    const evs = [
      { type: 'response.created' },
      { type: 'response.output_item.added', item: { type: 'function_call', name: 'fichier_ecrire' } },
      { type: 'response.function_call_arguments.delta', delta: '{"a":1}' },
      { type: 'response.output_item.done', item: { type: 'function_call', call_id: 'c1', name: 'fichier_ecrire', arguments: '{"a":1}' } },
      { type: 'response.completed', response: { usage: { input_tokens: 4, output_tokens: 2 } } },
    ];
    const f = (async () => new Response(flux(evs), { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch;
    const p = new CodexProvider(paths, 'openai-codex:m', 'https://exemple.test/codex', f);
    assert.equal((p as unknown as { signaleActivite?: boolean }).signaleActivite, true);
    const sans = await p.complete({ ...req, tools: OUTILS, model: 'm', onDelta: () => undefined });
    let m = 0;
    const avec = await p.complete({ ...req, tools: OUTILS, model: 'm', onDelta: () => undefined, onActivite: () => { m++; } } as Suivie);
    assert.equal(m, 3, 'début, morceau et fin de l\'appel d\'outil (pas « response.created »)');
    assert.deepEqual(avec, sans);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ---------------- 2. Routeur : le premier mot s'arrête à la première activité, aussi avec des outils ----------------

test('classement, avec outils : 40 s d\'activité d\'outil sans texte → pas coupé', async () => {
  let finir!: (r: ModelResponse) => void;
  const a = agent('anthropic:a', (r) => new Promise((res, rej) => {
    finir = res; r.signal?.addEventListener('abort', () => rej(new Error('aborted')));
  }));
  const b = agent('deepseek:b', async () => okResp('par b'));
  const { r, h } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const p = r.complete({ ...req, tools: OUTILS, onDelta: () => undefined });
  await laisser();
  assert.equal(typeof a.appels[0].onActivite, 'function', 'le routeur donne le rappel « activité » au fournisseur');
  for (let s = 0; s < 4; s++) { h.avancer(10_000); a.appels[0].onActivite?.(); await laisser(); }
  assert.equal(b.appels.length, 0, 'l\'agent écrit son action : pas de bascule');
  finir(okResp('', { toolCalls: [{ id: '1', name: 'fichier_ecrire', input: {} }], stopReason: 'tool_use' }));
  assert.equal((await p).providerName, 'anthropic:a');
});

test('classement, avec outils : 30 s de silence total → l\'agent suivant prend le tour', async () => {
  const a = agent('anthropic:a', (r) => new Promise((_, rej) => { r.signal?.addEventListener('abort', () => rej(new Error('aborted'))); }));
  const b = agent('deepseek:b', async () => okResp('par b'));
  const { r, h } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const p = r.complete({ ...req, tools: OUTILS, onDelta: () => undefined });
  await laisser();
  h.avancer(29_999); await laisser();
  assert.equal(b.appels.length, 0, 'avant 30 s, on attend encore');
  h.avancer(1); await laisser();
  const out = await p;
  assert.equal(out.providerName, 'deepseek:b');
  assert.equal(a.appels[0].signal?.aborted, true);
  assert.match(out.notice ?? '', /pas de premier mot en 30 s/);
});

test('classement, sans outils : un raisonnement compte comme premier mot (pas coupé avant le texte)', async () => {
  let finir!: (r: ModelResponse) => void;
  const a = agent('anthropic:a', (r) => new Promise((res) => { finir = res; }));
  const b = agent('deepseek:b', async () => okResp('par b'));
  const { r, h } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const vus: string[] = [];
  const p = r.complete({ ...req, onDelta: (t) => vus.push(t) });
  await laisser();
  h.avancer(5_000); a.appels[0].onActivite?.(); await laisser();
  h.avancer(35_000); await laisser();
  assert.equal(b.appels.length, 0);
  a.appels[0].onDelta?.('Bonjour'); finir(okResp('Bonjour'));
  assert.equal((await p).providerName, 'anthropic:a');
  assert.deepEqual(vus, ['Bonjour']);
});

test('un fournisseur qui ne signale pas son activité garde la règle d\'avant (avec outils : pas de premier mot attendu)', async () => {
  let finir!: (r: ModelResponse) => void;
  const a = agent('anthropic:a', () => new Promise((res) => { finir = res; }), false);
  const b = agent('deepseek:b', async () => okResp('par b'));
  const { r, h } = routeur([route(a), route(b)], ['anthropic:a', 'deepseek:b']);
  const p = r.complete({ ...req, tools: OUTILS, onDelta: () => undefined });
  await laisser(); h.avancer(40_000); await laisser();
  assert.equal(b.appels.length, 0);
  finir(okResp('fini'));
  assert.equal((await p).providerName, 'anthropic:a');
});

test('sans classement : la demande au fournisseur est la même qu\'avant (aucun rappel d\'activité, aucun délai)', async () => {
  const a = agent('anthropic:a', async () => okResp('a'));
  const { r } = routeur([route(a)], undefined);
  await r.complete({ ...req, tools: OUTILS, onDelta: () => undefined });
  assert.equal(a.appels[0].onActivite, undefined);
  assert.deepEqual(Object.keys(a.appels[0]).sort(), ['maxTokens', 'messages', 'model', 'onDelta', 'system', 'tools']);
});

// ---------------- 3. Le routeur secondaire (résumés, réflexion, aides) suit le classement ----------------

const CLES = { ESSAI_SUITE_A: 'k', ESSAI_SUITE_K: 'k', ESSAI_SUITE_D: 'k' };
function odinAvec(routing: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), 'odin-suite-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    providers: [
      { kind: 'anthropic', model: 'modele-a', apiKeyEnv: 'ESSAI_SUITE_A', baseUrl: 'https://exemple.test' },
      { kind: 'openai', model: 'modele-k', baseUrl: 'https://exemple.test/k/v1', apiKeyEnv: 'ESSAI_SUITE_K' },
    ],
    cheapProvider: { kind: 'openai', model: 'modele-eco', baseUrl: 'https://exemple.test/d/v1', apiKeyEnv: 'ESSAI_SUITE_D' },
    routing: { crossCheckRisky: false, ...routing },
  }, null, 2));
  const o = createOdin({ home });
  return { o, fin: () => { o.close(); rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } };
}

test('routeur secondaire : avec un classement, il suit son ordre et l\'agent « économique » non classé n\'y reçoit rien ; sans classement, rien ne change', () => {
  Object.assign(process.env, CLES);
  try {
    const avec = odinAvec({ classement: ['compatible:modele-k', 'anthropic:modele-a'] });
    try {
      const cheap = avec.o.agent.deps.cheapRouter;
      assert.ok(cheap);
      assert.deepEqual(cheap.classement, avec.o.agent.deps.router.classement);
      assert.deepEqual(cheap.order({ minTier: 'local' }).map((x) => x.provider.name), ['compatible:modele-k', 'anthropic:modele-a']);
      assert.ok(!cheap.routes.some((x) => x.provider.name === 'compatible:modele-eco'), 'non classé : pas monté');
    } finally { avec.fin(); }
    const sans = odinAvec({});
    try {
      const cheap = sans.o.agent.deps.cheapRouter!;
      assert.equal(cheap.classement, undefined);
      assert.deepEqual(cheap.routes.map((x) => x.provider.name), ['compatible:modele-eco', 'anthropic:modele-a', 'compatible:modele-k']);
      assert.equal(cheap.order({ minTier: 'local' })[0].provider.name, 'compatible:modele-eco');
    } finally { sans.fin(); }
  } finally { for (const k of Object.keys(CLES)) delete process.env[k]; }
});

// ---------------- 4. L'agent local d'Odin prend le tour à sa place dans le classement ----------------

const STATES = 'light.salon_plafond · Plafonnier salon · off';
function maison(o: ReturnType<typeof makeOdin>) {
  const haStates: Tool = { name: 'ha_states', description: 'x', risk: 'read', schema: { type: 'object', properties: {} }, run: async () => STATES };
  const haCall: Tool = { name: 'ha_call', description: 'x', risk: 'external', schema: { type: 'object', properties: {} }, summarize: () => 'Maison', run: async () => 'Fait' };
  o.tools.upsert(haStates); o.tools.upsert(haCall);
}
const classer = (o: ReturnType<typeof makeOdin>, classement: string[]) => {
  (o.agent.deps as { router: R.Router }).router = new R.Router([{ provider: o.provider, cfg: { kind: 'mock', model: 'mock' } }], 2, async () => undefined, { classement });
};

test('agent local classé avant les agents connectés : il prend le tour (l\'agent connecté n\'est pas appelé)', async () => {
  const o = makeOdin(() => ({ text: 'réponse de l\'agent connecté' }), { approve: true });
  maison(o);
  try {
    classer(o, [R.AGENT_LOCAL, 'mock']);
    const r = await o.agent.run('Allume la lumière du grenier', { sessionId: 'web:principal', channel: 'web' });
    assert.equal(o.provider.calls.length, 0, 'l\'agent connecté n\'a rien reçu');
    assert.match(r.text, /Je ne trouve pas « grenier »/);
    assert.equal(r.stopReason, 'done');
    assert.notEqual(r.offline, true, 'ce n\'est pas une panne : c\'est sa place');
  } finally { o.cleanup(); }
});

test('agent local classé en premier mais qui ne sait pas répondre : le tour passe à l\'agent connecté suivant', async () => {
  const o = makeOdin(() => ({ text: 'un poème, par l\'agent connecté' }), { approve: true });
  try {
    classer(o, [R.AGENT_LOCAL, 'mock']);
    const r = await o.agent.run('écris-moi un poème sur la mer', { sessionId: 'web:principal', channel: 'web' });
    assert.equal(o.provider.calls.length, 1);
    assert.match(r.text, /un poème, par l'agent connecté/);
  } finally { o.cleanup(); }
});

test('agent local classé après les agents connectés, ou sans classement : rien ne change (l\'agent connecté répond)', async () => {
  for (const classement of [['mock', R.AGENT_LOCAL], undefined]) {
    const o = makeOdin(() => ({ text: 'réponse de l\'agent connecté' }), { approve: true });
    maison(o);
    try {
      if (classement) classer(o, classement);
      const r = await o.agent.run('Allume la lumière du grenier', { sessionId: 'web:principal', channel: 'web' });
      assert.equal(o.provider.calls.length, 1, `classement ${JSON.stringify(classement)}`);
      assert.match(r.text, /réponse de l'agent connecté/);
    } finally { o.cleanup(); }
  }
});

// ---------------- 5. Relecture : l'agent local ne répond qu'à ce qu'il sait faire, et chaque tour est noté ----------------

// Des demandes qui ressemblent à ce que la mémoire de secours reconnaît (« quel jour », « rappels », l'heure) mais qu'elle
// ne sait pas traiter : l'agent local ne doit pas y répondre à côté ; le tour passe à l'agent connecté suivant.
for (const q of ['Quel jour tombe Pâques en 2027 ?', 'Supprime tous mes rappels', 'Combien de rappels faut-il pour le vaccin du tétanos ?', 'What time is it in Tokyo right now?']) {
  test(`agent local en tête, demande qu'il ne sait pas traiter : « ${q} » → l'agent connecté suivant`, async () => {
    const o = makeOdin(() => ({ text: 'REPONSE CONNECTEE' }), { approve: true });
    try {
      classer(o, [R.AGENT_LOCAL, 'mock']);
      const r = await o.agent.run(q, { sessionId: 'web:principal', channel: 'web' });
      assert.equal(o.provider.calls.length, 1, `l'agent connecté a reçu la demande (${JSON.stringify(r.text.slice(0, 160))})`);
      assert.match(r.text, /REPONSE CONNECTEE/);
      assert.doesNotMatch(r.text, /🔌/, 'jamais « aucune IA ne me répond » quand aucun agent connecté n\'a été appelé');
    } finally { o.cleanup(); }
  });
}

test('agent local qui prend le tour : le tour est noté au journal des routages, avec sa place', async () => {
  const o = makeOdin(() => ({ text: 'réponse de l\'agent connecté' }), { approve: true });
  maison(o);
  try {
    classer(o, [R.AGENT_LOCAL, 'mock']);
    await o.agent.run('Allume la lumière du grenier', { sessionId: 'web:principal', channel: 'web' });
    assert.equal(o.provider.calls.length, 0);
    const l = o.muninn.routes({ sessionId: 'web:principal' }).filter((e) => e.purpose === 'agent-local');
    assert.equal(l.length, 1, 'un tour de l\'agent local = une ligne au journal');
    assert.equal(l[0].ok, true);
    assert.match(l[0].reason, /place 1/);
    assert.equal(l[0].provider, '', 'aucun agent connecté ni coût compté');
  } finally { o.cleanup(); }
});

test('agent local qui prend le tour, apprentissage en arrière-plan actif : l\'agent connecté ne reçoit toujours rien', async () => {
  const o = makeOdin(() => ({ text: '{}' }), { approve: true, config: (c) => ({ ...c, learning: { ...c.learning, observe: true } }) });
  maison(o);
  try {
    classer(o, [R.AGENT_LOCAL, 'mock']);
    const r = await o.agent.run('Allume la lumière du grenier', { sessionId: 'web:principal', channel: 'web' });
    await r.reflection;
    assert.equal(o.provider.calls.length, 0, 'ni l\'observation ni le fil de la conversation ne partent chez un agent connecté');
  } finally { o.cleanup(); }
});

test('conversation marquée (contenu extérieur lu) : l\'agent local ne passe pas devant, comme les actions directes', async () => {
  const o = makeOdin(() => ({ text: 'réponse de l\'agent connecté' }), { approve: true });
  maison(o);
  try {
    classer(o, [R.AGENT_LOCAL, 'mock']);
    o.muninn.ensureSession('web:principal', 'web');
    o.muninn.markTainted('web:principal');
    const r = await o.agent.run('Allume la lumière du grenier', { sessionId: 'web:principal', channel: 'web' });
    assert.equal(o.provider.calls.length, 1);
    assert.match(r.text, /réponse de l'agent connecté/);
  } finally { o.cleanup(); }
});
