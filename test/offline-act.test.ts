import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineAct, parseHome, parseStates } from '../src/core/offline-act.ts';
import { detectLocalBrain, Router } from '../src/providers/router.ts';
import type { Tool } from '../src/tools/registry.ts';
import type { ModelResponse, Provider } from '../src/types.ts';
import { makeOdin } from './helpers.ts';

const STATES = 'light.salon_plafond · Plafonnier salon · off\nlight.chambre · Lampe chambre · on\nswitch.salon_prise · Prise salon · on\nclimate.salon · Clim salon · cool\ncover.volet_salon · Volet salon · open';

test('commandes maison comprises sans IA', () => {
  assert.deepEqual(parseHome('Allume la lumière du salon'), { service: 'turn_on', domain: 'light', place: 'salon', all: false });
  assert.equal(parseHome('éteins tout')?.domain, 'light');
  assert.equal(parseHome('éteins tout')?.all, true);
  assert.equal(parseHome('ferme les volets du salon')?.service, 'close_cover');
  assert.deepEqual(parseHome('mets la clim à 24'), { service: 'set_temperature', domain: 'climate', place: '', all: false, temperature: 24 });
  assert.equal(parseHome('raconte-moi une histoire'), undefined);
  assert.equal(parseStates(STATES).length, 5);
});

test('offlineAct : agit avec les outils, ne tente rien d\'incompris', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  // Comme le vrai ha_states : filtre par domaine et par mot.
  const states = (i: Record<string, unknown>) => STATES.split('\n').filter((l) => (!i.domain || l.startsWith(`${i.domain}.`)) && (!i.search || l.toLowerCase().includes(String(i.search)))).join('\n');
  const run = async (name: string, input: Record<string, unknown>) => { calls.push([name, input]); return { ok: true, content: name === 'ha_states' ? states(input) : 'Fait.' }; };
  const has = () => true;
  assert.match((await offlineAct('Allume la lumière du salon', run, has))!, /Plafonnier salon : allumé/);
  assert.deepEqual(calls.at(-1), ['ha_call', { domain: 'light', service: 'turn_on', entity_id: 'light.salon_plafond' }]);
  await offlineAct('éteins tout', run, has);
  assert.deepEqual(calls.at(-1), ['ha_call', { domain: 'light', service: 'turn_off', entity_id: 'all' }]);
  assert.match((await offlineAct('mets la clim à 22', run, has))!, /Clim salon : 22 °C/);
  assert.deepEqual(calls.at(-1)![1], { domain: 'climate', service: 'set_temperature', entity_id: 'climate.salon', data: '{"temperature":22}' });
  assert.match((await offlineAct('ferme le volet du salon', run, has))!, /Volet salon : fermé/);
  assert.match((await offlineAct('bonne nuit', run, has))!, /Bonne nuit/);
  assert.deepEqual(calls.at(-1), ['mode_set', { mode: 'sommeil' }]);
  assert.match((await offlineAct('note que le code du portail est dans le carnet', run, has))!, /Noté/);
  assert.equal(calls.at(-1)![0], 'note_save');
  await offlineAct('mets TF1 sur la télé', run, has);
  assert.deepEqual(calls.at(-1), ['venus', { action: 'regarder', quoi: 'tf1', ou: '' }]);
  assert.match((await offlineAct('allume la lumière du grenier', run, has))!, /Je ne trouve pas « grenier »/);
  const n = calls.length;
  assert.equal(await offlineAct('écris-moi un poème sur la mer', run, has), undefined);
  assert.equal(calls.length, n, 'rien de tenté');
  assert.match((await offlineAct('que sais-tu faire', run, has))!, /Sans IA/);
});

test('agent sans Internet : il allume quand même, via Heimdall, et répond tout de suite', async () => {
  let haCalls = 0;
  const haStates: Tool = { name: 'ha_states', description: 'x', risk: 'read', schema: { type: 'object', properties: {} }, run: async () => STATES };
  const haCall: Tool = { name: 'ha_call', description: 'x', risk: 'external', schema: { type: 'object', properties: {} }, summarize: () => 'Maison', run: async () => { haCalls++; return 'Fait : light.turn_on'; } };
  const o = makeOdin(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }, { approve: true });
  o.tools.upsert(haStates); o.tools.upsert(haCall);
  try {
    // Une action nette se fait sans IA, qu'un modèle soit joignable ou non : il n'est même pas essayé.
    const r = await o.agent.run('Allume la lumière du salon', { sessionId: 'web:principal', channel: 'web' });
    assert.deepEqual(r.ai?.needed, false);
    assert.match(r.ai?.why ?? '', /action reconnue : Maison/);
    assert.match(r.text, /Plafonnier salon : allumé/);
    assert.equal(haCalls, 1);
    assert.equal(o.approvals.length, 1, 'action « external » : Heimdall a demandé, comme avec un modèle');
    // Un appareil qu'Odin ne retrouve pas tel quel : c'est pour l'IA. Elle est injoignable → le cerveau de secours répond.
    const r2 = await o.agent.run('Allume la lumière du grenier', { sessionId: 'web:principal', channel: 'web' });
    assert.equal(r2.offline, true);
    assert.match(r2.text, /Je ne trouve pas « grenier »[\s\S]*sans IA/);
    assert.equal(haCalls, 1, 'rien d\'autre n\'a été allumé');
  } finally { o.cleanup(); }
});

test('sans Internet : le service injoignable est mis de côté, la réponse de secours arrive sans attendre', async () => {
  let n = 0;
  const p: Provider = { name: 'anthropic:x', complete: async () => { n++; throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } };
  const r = new Router([{ provider: p, cfg: { kind: 'anthropic', model: 'x' } }], 2, async () => undefined);
  await assert.rejects(() => r.complete({ system: '', messages: [], tools: [], maxTokens: 5 }));
  assert.equal(n, 1, 'pas de réessais sur une coupure réseau');
  assert.equal(r.offline(), true);
  await assert.rejects(() => r.complete({ system: '', messages: [], tools: [], maxTokens: 5 }), /pas d'Internet/);
  assert.equal(n, 1, 'pendant 1 min, on ne refrappe pas à la porte');
});

test('cerveau local trouvé tout seul (Ollama), utilisé en dernier recours', async () => {
  const ok: ModelResponse = { text: 'ok', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' };
  const r = new Router([{ provider: { name: 'anthropic:x', complete: async () => ok }, cfg: { kind: 'anthropic', model: 'x' } }]);
  const fake = (async () => new Response(JSON.stringify({ models: [{ name: 'nomic-embed-text' }, { name: 'qwen3:4b' }] }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await detectLocalBrain(r, 'http://127.0.0.1:11434', fake), 'qwen3:4b');
  assert.equal(r.routes.at(-1)!.provider.name, 'ollama:qwen3:4b');
  // Même pour une tâche « simple », le modèle trouvé tout seul passe après tes modèles configurés.
  assert.equal(r.order({ minTier: 'local' })[0].provider.name, 'anthropic:x');
  // Déjà un modèle local configuré : rien n'est ajouté.
  assert.equal(await detectLocalBrain(r, 'http://127.0.0.1:11434', fake), undefined);
});
