import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anthropicStream } from '../src/providers/anthropic.ts';
import { openaiStream } from '../src/providers/openai.ts';
import { withSources } from '../src/core/agent.ts';
import { call, makeOdin } from './helpers.ts';

const sse = (events: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const e of events) c.enqueue(new TextEncoder().encode(e)); c.close(); } });

test('réponses en direct : flux Anthropic et OpenAI (texte au fil de l\'eau, appels d\'outils reconstitués)', async () => {
  const got: string[] = [];
  const a = await anthropicStream(sse([
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Bon"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"jour"}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"shell"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"command\\":"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"ls\\"}"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}\n\n',
  ]), (t) => got.push(t));
  assert.deepEqual(got, ['Bon', 'jour']);
  assert.equal(a.text, 'Bonjour');
  assert.deepEqual(a.toolCalls, [{ id: 't1', name: 'shell', input: { command: 'ls' } }]);
  assert.equal(a.stopReason, 'tool_use');
  assert.deepEqual(a.usage, { inputTokens: 12, outputTokens: 7 });

  const o = await openaiStream(sse([
    'data: {"choices":[{"delta":{"content":"Sa"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"lut"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"web_search","arguments":"{\\"query\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"odin\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
  ]), () => undefined);
  assert.equal(o.text, 'Salut');
  assert.deepEqual(o.toolCalls, [{ id: 'c1', name: 'web_search', input: { query: 'odin' } }]);
  assert.deepEqual(o.usage, { inputTokens: 5, outputTokens: 3 });
});

test('vérification imposée : après une modification sans relecture, Odin doit vérifier avant de conclure', async () => {
  const o = makeOdin([call('fs_write', { path: 'note.txt', content: 'bonjour' }), { text: 'C\'est fait.' }, call('fs_read', { path: 'note.txt' }), { text: 'C\'est fait : j\'ai relu note.txt, il contient « bonjour ».' }],
    { approve: true, config: (c) => ({ ...c, agent: { ...c.agent, verify: true } }) });
  try {
    const r = await o.agent.run('écris bonjour dans note.txt', { sessionId: 's' });
    assert.match(r.text, /relu note\.txt/);
    assert.match(o.provider.calls[2].messages.at(-1)!.content, /Contrôle automatique/);
    assert.equal(o.provider.calls.length, 4);
  } finally { o.cleanup(); }
});

test('relecture par un second modèle : un « c\'est fait » contredit par l\'outil est signalé ; sources ajoutées', async () => {
  assert.equal(withSources('Il fait 28 °C.', [{ role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'web_fetch', input: { url: 'https://meteo.fr/mamoudzou' } }] }]), 'Il fait 28 °C.\n\nSources : https://meteo.fr/mamoudzou');
  assert.equal(withSources('Voir https://x.fr', []), 'Voir https://x.fr');
  const o = makeOdin([call('shell', { command: 'exit 1' }), { text: 'Nginx est redémarré.' }, { text: '{"ok": false, "problemes": ["la commande a échoué (code 1)"]}' }],
    { approve: true, config: (c) => ({ ...c, agent: { ...c.agent, review: true } }) });
  try {
    const r = await o.agent.run('redémarre nginx', { sessionId: 's' });
    assert.match(r.text, /⚠ À vérifier \(relecture\) : la commande a échoué/);
    assert.match(o.provider.calls[2].system, /RÉSULTATS RÉELS des outils/);
  } finally { o.cleanup(); }
});

test('mémoire : un fait plus récent remplace l\'ancien (historique gardé), fiche, oubli des périmés', () => {
  const o = makeOdin([]);
  try {
    const m = o.muninn;
    m.remember('Le NAS est à l\'adresse 192.168.1.30', 'agent', 'environment', '', { subject: 'nas', topic: 'adresse_ip' });
    const r = m.remember('Le NAS est à l\'adresse 192.168.1.35', 'agent', 'environment', '', { subject: 'nas', topic: 'adresse_ip' });
    assert.match(r.replaced!, /192\.168\.1\.30/);
    assert.deepEqual(m.recall('NAS adresse').map((x) => x.content), ['Le NAS est à l\'adresse 192.168.1.35'], 'l\'ancien n\'est plus rappelé');
    const p = m.profile('nas');
    assert.equal(p.current.length, 1); assert.equal(p.history.length, 1);
    // ce que TU as dit ne se fait pas écraser par une source moins fiable
    m.remember('Je me lève à 6 h', 'owner', 'preference', '', { subject: 'proprietaire', topic: 'heure_reveil' });
    m.remember('Le propriétaire se lève à 9 h', 'untrusted', 'preference', '', { subject: 'proprietaire', topic: 'heure_reveil' });
    assert.equal(m.profile('proprietaire').current[0].content, 'Je me lève à 6 h');
    const mem = m.table<{ id: number; created_at: number; superseded_by?: number | null }>('memories', (r) => r.id);
    for (const r of mem.filter((x) => x.superseded_by != null)) mem.patch(r.id, { created_at: 0 });
    assert.equal(m.decay(), 1, 'ancienne valeur oubliée après 6 mois');
    m.setVector(m.profile('nas').current[0].id, 'test', Float32Array.from([1, 0, 0]));
    assert.equal(m.nearest('test', Float32Array.from([0.9, 0.1, 0]))[0].content, 'Le NAS est à l\'adresse 192.168.1.35');
  } finally { o.cleanup(); }
});

test('travail continu : Odin dit EXACTEMENT ce qu\'il a fait, ni humeur ni « RIEN », jamais deux fois la même chose ; budget du jour respecté', async () => {
  const { Gateway } = await import('../src/bifrost/gateway.ts');
  const sent: string[] = [];
  const ch = { name: 'fake', interactive: true, start: async () => {}, send: async (_p: string, t: string) => { sent.push(t); }, stop: async () => {} };
  const save = call('note_save', { title: 'NAS', content: 'Le NAS redémarre seul le dimanche.' });
  const o = makeOdin([
    { text: '[humeur=neutre]RIEN' },
    call('memory_search', { query: 'nas' }), { text: '[humeur:joie] J\'ai seulement regardé.' },
    save, { text: '[humeur=fierte] J\'ai gardé une fiche sur le NAS.' },
    { ...save, toolCalls: save.toolCalls.map((c) => ({ ...c, id: 'again' })) }, { text: 'Fiche refaite.' },
  ], { config: (c) => ({ ...c, continuous: { enabled: true, intervalMin: 30, dailyBudgetUsd: 0.5, autoResume: false, maxRetries: 3 } }) });
  try {
    const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch as never);
    const t0 = Date.now();
    await gw.continuous(t0);
    assert.equal(sent.length, 0, '« [humeur=neutre]RIEN » : pas de message');
    assert.equal(await gw.continuous(t0 + 60_000), undefined, 'pas avant l\'intervalle');
    await gw.continuous(t0 + 31 * 60_000);
    assert.equal(sent.length, 0, 'seulement regardé : rien à dire');
    await gw.continuous(t0 + 62 * 60_000);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Odin a travaillé de lui-même :\n• Fiche « NAS » ✓/);
    assert.doesNotMatch(sent[0], /humeur/);
    assert.match(o.provider.calls[0].messages[0].content, /Travail continu/);
    // La même action une deuxième fois : déjà faite, pas de message ; et elle est listée « déjà fait » au modèle.
    await gw.continuous(t0 + 93 * 60_000);
    assert.equal(sent.length, 1, 'déjà fait : pas de nouveau message');
    assert.ok(o.provider.calls.some((c) => c.messages.some((m) => m.role === 'user' && /DÉJÀ FAIT[\s\S]*Fiche « NAS »/.test(m.content))), 'déjà fait transmis au modèle');
    o.muninn.setKv(`continuous-spent:${new Date(t0 + 124 * 60_000).toDateString()}`, '9');
    assert.equal(await gw.continuous(t0 + 124 * 60_000), undefined, 'budget du jour atteint');
  } finally { o.cleanup(); }
});

test('Telegram & co : jamais de marqueur d\'humeur dans les messages', async () => {
  const { Gateway } = await import('../src/bifrost/gateway.ts');
  const sent: string[] = [];
  const ch = { name: 'telegram', interactive: true, start: async () => {}, send: async (_p: string, t: string) => { sent.push(t); }, stop: async () => {} };
  const o = makeOdin([]);
  try {
    new Gateway(o, { owners: { telegram: ['1'] } }).add(ch as never);
    await ch.send('1', '[humeur=neutre] Salut [humeur:joie]');
    assert.equal(sent[0], 'Salut ');
  } finally { o.cleanup(); }
});
