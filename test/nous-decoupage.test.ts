// Le découpage en sous-mots de Noûs (src/brain/nous/decoupage.ts) : aller-retour sans perte sur FR/anglais/code/
// émojis, apprentissage de fusions, sérialisation stable.
import assert from 'node:assert/strict';
import test from 'node:test';
import { apprendreDecoupage, lireDecoupageSerialise, serialiserDecoupage, SPECIAUX } from '../src/brain/nous/decoupage.ts';

const CORPUS = [
  "Bonjour Odin, comment vas-tu aujourd'hui ?",
  "Les élèves français écrivent des accents : é è ê à ç ù ï.",
  'function somme(a, b) { return a + b; } // un commentaire',
  "J'adore les émojis 😀🚀🔥 et les symboles €$£.",
  'répète répète répète la maison de Mamoudzou',
];

test('aller-retour : decoder(encoder(x)) rend exactement x', () => {
  const d = apprendreDecoupage([CORPUS.join(' ').repeat(20)], 4096, 123);
  const essais = [...CORPUS, 'mélange FR/EN: hello world 123 !!! 日本語 😀', '', 'a', '   espaces   ', '\n\ttabulations', 'ÀÉÎÕÜ Ñ ß'];
  for (const s of essais) assert.equal(d.decoder(d.encoder(s)), s, `aller-retour de ${JSON.stringify(s)}`);
});

test('apprentissage : le vocabulaire est respecté, des fusions raccourcissent le texte', () => {
  const texte = 'les les les maisons maisons de Mamoudzou à Mayotte '.repeat(40);
  const d = apprendreDecoupage([texte], 4096, 7);
  assert.equal(d.vocab, 4096);
  assert.ok(d.fusions.length / 2 > 0, 'au moins une fusion apprise');
  const brut = new TextEncoder().encode('les maisons').length;
  assert.ok(d.encoder('les maisons').length < brut, 'les fusions raccourcissent');
});

test('jeton d\'arrêt réservé et sérialisation identique', () => {
  const d = apprendreDecoupage([CORPUS.join(' ')], 4096, 1);
  assert.equal(d.arretId, SPECIAUX.EOS);
  const d2 = lireDecoupageSerialise(serialiserDecoupage(d));
  assert.equal(d2.version, d.version);
  assert.deepEqual(Array.from(d2.encoder('test é 😀 code()')), Array.from(d.encoder('test é 😀 code()')));
});

test('reproductible : même corpus + même graine => mêmes fusions', () => {
  const t = 'abracadabra '.repeat(30);
  const a = apprendreDecoupage([t], 300, 5), b = apprendreDecoupage([t], 300, 5);
  assert.equal(a.version, b.version);
  assert.deepEqual(Array.from(a.fusions), Array.from(b.fusions));
});
