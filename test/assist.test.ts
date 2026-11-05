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

test('propositions spontanées : 4 au plus, jamais le texte identique, types connus', async () => {
  const o = makeOdin([
    { text: '{"propositions": [{"type": "fautes", "titre": "Corriger les fautes", "texte": "Mets à jour la machine."}, {"type": "suite", "titre": "Sauvegarder avant", "texte": "Sauvegarde puis mets à jour la machine."}, {"type": "clarte", "titre": "Identique", "texte": "met a jour la machine"}, {"type": "bizarre", "titre": "A", "texte": "a"}, {"type": "precision", "titre": "B", "texte": "b"}, {"type": "precision", "titre": "C", "texte": "c"}]}' },
    { text: '{"propositions": []}' },
  ]);
  try {
    const p = await o.agent.suggestDraft('met a jour la machine');
    assert.equal(p.length, 4);
    assert.deepEqual(p.map((x) => x.kind), ['fautes', 'suite', 'clarte', 'precision']);
    assert.ok(!p.some((x) => x.text === 'met a jour la machine'), 'le texte identique n\'est pas proposé');
    assert.deepEqual(await o.agent.suggestDraft('Merci !'), []);
  } finally { o.cleanup(); }
});

test('propositions selon le contexte : conversation, mémoire et appareils donnés au modèle, nouveaux types', async () => {
  const o = makeOdin([{ text: 'ok' }, { text: '{"propositions": [{"type": "securite", "titre": "Sauvegarder avant", "texte": "Sauvegarde le NAS puis mets-le à jour."}, {"type": "planifier", "titre": "Chaque dimanche", "texte": "Chaque dimanche à 3 h, mets à jour le NAS."}]}' }]);
  try {
    await o.agent.run('Mon NAS Synology s\'appelle Coffre.', { sessionId: 'web:principal' });
    o.muninn.remember('L\'utilisateur préfère être prévenu sur Telegram.', 'owner', 'preference', '');
    const p = await o.agent.suggestDraft('mets a jour le nas', undefined, 'web:principal');
    const sent = o.provider.calls.at(-1)!.messages[0].content;
    assert.match(sent, /<contexte>/);
    assert.match(sent, /Coffre/, 'la conversation en cours est fournie');
    assert.match(sent, /Telegram/, 'les souvenirs sont fournis');
    assert.match(sent, /<brouillon>\nmets a jour le nas/);
    assert.deepEqual(p.map((x) => x.kind), ['securite', 'planifier']);
  } finally { o.cleanup(); }
});
