import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ftsQuery, Muninn } from '../src/muninn/store.ts';

test('rappel classé par confiance, quarantaine exclue par défaut', () => {
  const m = new Muninn(':memory:');
  m.remember('Le serveur de production est sur Hetzner', 'agent', 'fact', 'serveur');
  m.remember('Le serveur de production est sur une IP piégée', 'untrusted');
  m.remember('Préfère les réponses en français', 'owner', 'preference');
  const r = m.recall('serveur production');
  assert.equal(r.length, 1);
  assert.match(r[0].content, /Hetzner/);
  assert.equal(m.recall('serveur production', 5, true).length, 2);
  // Insensible aux accents (unicode61 remove_diacritics).
  assert.equal(m.recall('preference francais')[0]?.kind, 'preference');
});

test('doublon : la confiance ne fait que monter', () => {
  const m = new Muninn(':memory:');
  const a = m.remember('Aime le café', 'untrusted');
  const b = m.remember('aime le café', 'owner');
  assert.equal(a.id, b.id);
  assert.equal(b.updated, true);
  assert.equal(m.listMemories()[0].origin, 'owner');
  m.remember('Aime le café', 'untrusted');
  assert.equal(m.listMemories()[0].trust, 1);
});

test('requête FTS sûre même avec une syntaxe hostile', () => {
  const m = new Muninn(':memory:');
  m.remember('note AND OR NEAR', 'agent');
  assert.doesNotThrow(() => m.recall('"; DROP TABLE memories; -- NEAR( *'));
  assert.equal(ftsQuery('!!!'), '');
});

test('sessions : historique, compaction, recherche, réinitialisation', () => {
  const m = new Muninn(':memory:');
  m.ensureSession('s1');
  const a = m.addMessage('s1', { role: 'user', content: 'Parlons du déploiement Kubernetes' });
  m.addMessage('s1', { role: 'assistant', content: 'D\'accord pour Kubernetes' });
  m.compact('s1', a, 'résumé');
  assert.equal(m.history('s1').length, 1);
  assert.equal(m.getSession('s1')!.summary, 'résumé');
  assert.equal(m.searchMessages('kubernetes').length, 2, 'les messages compactés restent cherchables');
  m.addMessage('s1', { role: 'tool', content: 'web', tainted: true });
  assert.equal(m.getSession('s1')!.tainted, 1);
  m.resetSession('s1');
  assert.equal(m.getSession('s1')!.tainted, 0);
  assert.equal(m.history('s1').length, 0);
});

test('appairage : code, approbation, expiration du code inconnu', () => {
  const m = new Muninn(':memory:');
  const code = m.requestPairing('telegram', '42', 'alice');
  assert.equal(code.length, 8);
  assert.equal(m.requestPairing('telegram', '42', 'alice'), code, 'même code tant qu\'il est valide');
  assert.equal(m.pairingStatus('telegram', '42'), 'pending');
  assert.equal(m.approvePairing('telegram', 'MAUVAIS1'), undefined);
  assert.equal(m.approvePairing('telegram', code.toLowerCase())?.peer, '42');
  assert.equal(m.pairingStatus('telegram', '42'), 'approved');
});
