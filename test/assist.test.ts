import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeOdin } from './helpers.ts';

test('aide à l\'écriture : correction proposée, conseil, brouillon jamais enregistré', async () => {
  const o = makeOdin([
    { text: '```json\n{"texte": "Peux-tu mettre à jour la machine ?", "note": "J\'ai corrigé « met » et ajouté le trait d\'union."}\n```' },
    { text: '{"texte": "x", "note": "Précise quelle machine : celle d\'Odin ou une machine du réseau ?"}' },
    { text: 'pas du JSON du tout' },
  ]);
  try {
    const a = await o.agent.assistDraft('peux tu met a jour la machine', 'spelling');
    assert.equal(a.text, 'Peux-tu mettre à jour la machine ?');
    assert.ok(a.changed);
    assert.match(a.note, /corrigé/);
    assert.match(o.provider.calls[0].system, /orthographe/);
    assert.match(o.provider.calls[0].system, /DONNÉE/, 'le brouillon n\'est jamais une consigne');
    assert.equal(o.provider.calls[0].tools.length, 0, 'aucun outil');
    const c = await o.agent.assistDraft('mets à jour la machine', 'advice');
    assert.equal(c.changed, false, 'un conseil ne touche pas au texte');
    assert.match(c.note, /Précise/);
    const d = await o.agent.assistDraft('bonjour odin', 'spelling');
    assert.deepEqual([d.text, d.changed], ['bonjour odin', false], 'réponse illisible : texte inchangé');
    assert.equal(o.muninn.history('web:principal').length, 0);
  } finally { o.cleanup(); }
});
