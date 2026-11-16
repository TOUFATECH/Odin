import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineAct, parseHome, parseStates } from '../src/core/offline-act.ts';
import { detecterMetis, Router } from '../src/providers/router.ts';
import type { ModeleCatalogue } from '../src/brain/metis/types.ts';
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
  assert.match((await offlineAct('Allume la lumière du salon', run, has))!, /j'ai allumé Plafonnier salon/);
  assert.deepEqual(calls.at(-1), ['ha_call', { domain: 'light', service: 'turn_on', entity_id: 'light.salon_plafond' }]);
  await offlineAct('éteins tout', run, has);
  assert.deepEqual(calls.at(-1), ['ha_call', { domain: 'light', service: 'turn_off', entity_id: 'all' }]);
  assert.match((await offlineAct('mets la clim à 22', run, has))!, /j'ai mis Clim salon à 22 °C/);
  assert.deepEqual(calls.at(-1)![1], { domain: 'climate', service: 'set_temperature', entity_id: 'climate.salon', data: '{"temperature":22}' });
  assert.match((await offlineAct('ferme le volet du salon', run, has))!, /j'ai fermé Volet salon/);
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
    assert.match(r.text, /j'ai allumé Plafonnier salon/);
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

test('modèle local ouvert trouvé par Métis, utilisé en dernier recours', async () => {
  const ok: ModelResponse = { text: 'ok', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' };
  const r = new Router([{ provider: { name: 'anthropic:x', complete: async () => ok }, cfg: { kind: 'anthropic', model: 'x' } }]);
  // Faux catalogue GGUF (aucun vrai modèle, aucune ouverture de fichier) : un modèle de discussion et un d'embeddings.
  const catalogue: ModeleCatalogue[] = [
    { id: 'q1', nom: 'qwen3-4b', chemin: '/x/qwen3-4b.gguf', arch: 'qwen3', tailleOctets: 2_500_000, empreinte: 'aa', quant: 'Q4_0', type: 'chat' },
    { id: 'q2', nom: 'qwen3-1_7b', chemin: '/x/qwen3-1_7b.gguf', arch: 'qwen3', tailleOctets: 1_200_000, empreinte: 'bb', quant: 'Q4_0', type: 'chat' },
    { id: 'e1', nom: 'nomic-embed', chemin: '/x/embed.gguf', arch: 'bert', tailleOctets: 500_000, empreinte: 'cc', quant: 'Q8_0', type: 'embeddings' },
  ];
  const deps = { lister: async (_home: string) => catalogue, ouvrir: async () => { throw new Error('ne doit pas ouvrir dans ce test'); } };
  // On prend le plus petit modèle de DISCUSSION (le plus utilisable), jamais celui d'embeddings.
  assert.equal(await detecterMetis(r, '/home', deps as never), 'qwen3-1_7b');
  assert.equal(r.routes.at(-1)!.provider.name, 'metis:qwen3-1_7b');
  // Même pour une tâche « simple », le modèle local passe après tes modèles configurés.
  assert.equal(r.order({ minTier: 'local' })[0].provider.name, 'anthropic:x');
  // Déjà un modèle local présent : rien n'est ajouté.
  assert.equal(await detecterMetis(r, '/home', deps as never), undefined);
});
