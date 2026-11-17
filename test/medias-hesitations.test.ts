// Médias reçus : les hésitations sont repérées, jamais réécrites ; seules les sûres sont retirées du texte nettoyé.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reperer } from '../src/medias/hesitations.ts';

const sures = (h: ReturnType<typeof reperer>) => h.retraits.filter((r) => r.certitude === 'sure');

test('bégaiement triple : deux retraits sûrs, phrase nettoyée, original intact', () => {
  const h = reperer('je je je veux partir');
  assert.equal(sures(h).length, 2);
  assert.equal(h.nettoye, 'je veux partir');
  assert.equal(h.original, 'je je je veux partir');
  assert.deepEqual(h.retraits.map((r) => [r.debut, r.fin, r.type]), [[0, 3, 'repetition'], [3, 6, 'repetition']]);
});

test('répétition double : possible, non retirée (« nous nous » peut être voulu)', () => {
  const h = reperer('nous nous sommes vus');
  assert.equal(h.retraits.length, 1);
  assert.equal(h.retraits[0].certitude, 'possible');
  assert.equal(h.nettoye, 'nous nous sommes vus');
});

test('mot coupé « b-b-bonjour » : fragments sûrs', () => {
  const h = reperer('b-b-bonjour à tous');
  assert.ok(h.retraits.every((r) => r.type === 'fragment' && r.certitude === 'sure'));
  assert.equal(h.nettoye, 'bonjour à tous');
  assert.deepEqual(h.retraits.map((r) => [r.debut, r.fin]), [[0, 2], [2, 4]]);
});

test('mots légitimes intacts : Schifffahrt, orang-orang, 谢谢', () => {
  for (const t of ['Die Schifffahrt ist alt', 'orang-orang itu datang', '谢谢你的帮助']) {
    const h = reperer(t);
    assert.equal(sures(h).length, 0, t);
    assert.equal(h.nettoye, t);
  }
});

test('syllabe allongée « nooooon » → « non »', () => {
  const h = reperer('nooooon merci');
  assert.equal(h.nettoye, 'non merci');
  assert.equal(h.retraits[0].type, 'allongement');
  assert.equal(h.original.slice(h.retraits[0].debut, h.retraits[0].fin), 'oooo');
});

test('« euh » repéré SEULEMENT avec la langue donnée, et seulement possible sans pauses', () => {
  assert.equal(reperer('je pense euh que oui').retraits.length, 0);
  const h = reperer('je pense euh que oui', { langue: 'fr' });
  assert.equal(h.retraits.length, 1);
  assert.equal(h.retraits[0].type, 'remplissage');
  assert.equal(h.retraits[0].certitude, 'possible');
  assert.equal(h.nettoye, 'je pense euh que oui');
  // Avec des temps par mot et des pauses autour : sûr.
  const mots = [['je', 0, 0.2], ['pense', 0.25, 0.6], ['euh', 1.0, 1.3], ['que', 1.8, 1.9], ['oui', 1.95, 2.2]].map(([texte, debut, fin]) => ({ texte: texte as string, debut: debut as number, fin: fin as number }));
  const h2 = reperer('je pense euh que oui', { langue: 'fr', mots });
  assert.equal(h2.retraits[0].certitude, 'sure');
  assert.equal(h2.nettoye, 'je pense que oui');
});

test('mot plein de la table (« ну », « ben ») : jamais sûr comme remplissage', () => {
  const mots = [{ texte: 'ben', debut: 0, fin: 0.3 }, { texte: 'oui', debut: 1, fin: 1.2 }];
  const h = reperer('ben oui', { langue: 'fr', mots });
  assert.equal(h.retraits[0].certitude, 'possible');
});

test('reprise « je vais je veux » : possible', () => {
  const h = reperer('je vais je veux partir');
  const r = h.retraits.find((x) => x.type === 'reprise');
  assert.ok(r);
  assert.equal(r.certitude, 'possible');
  assert.equal(h.original.slice(r.debut, r.fin), 'je vais ');
});

test('mêmes règles en russe et en arabe, positions exactes', () => {
  const ru = reperer('ну ну ну давай');
  assert.equal(sures(ru).length, 2);
  assert.equal(ru.nettoye, 'ну давай');
  const ar = reperer('أنا أنا أنا أريد الذهاب');
  assert.equal(sures(ar).length, 2);
  assert.equal(ar.nettoye, 'أنا أريد الذهاب');
  assert.equal(ar.original.slice(ar.retraits[0].debut, ar.retraits[0].fin), 'أنا ');
});

test('virgules : « je, je, je veux » → « je veux », pas de « , , »', () => {
  const h = reperer('Alors je, je, je veux');
  assert.equal(h.nettoye, 'Alors je veux');
});
