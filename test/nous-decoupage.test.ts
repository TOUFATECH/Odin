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

// Défauts trouvés en entraînant pour de vrai (17/11) : la même fusion était rechoisie sans fin, et une fusion bâtie
// sur une autre portait un mauvais identifiant. Le réseau travaillait alors presque octet par octet.
function pairesDe(fusions: ArrayLike<number>): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < fusions.length; i += 2) out.push(`${fusions[i]},${fusions[i + 1]}`);
  return out;
}

test('apprentissage : une paire n\'est jamais apprise deux fois', () => {
  // « ab » fusionne d'abord (le plus fréquent) ; dans « abcbc », cette fusion retire UNE des deux paires « bc ».
  // L'autre reste : elle doit être fusionnée à son tour, une seule fois.
  const texte = 'ab '.repeat(100) + 'abcbc '.repeat(10);
  const d = apprendreDecoupage([texte], 300, 5);
  const paires = pairesDe(d.fusions);
  assert.equal(new Set(paires).size, paires.length, `des fusions en double : ${paires.join(' ')}`);
  // le mot est toujours précédé d'un espace dans ce corpus : avec son espace, il tient en UN morceau
  assert.equal(d.encoder(' abcbc').length, 1, `« abcbc » en ${d.encoder(' abcbc').length} morceaux`);
});

test('apprentissage : une fusion bâtie sur une autre vise le bon morceau', () => {
  const d = apprendreDecoupage([CORPUS.join(' ').repeat(20)], 4096, 123);
  const paires = pairesDe(d.fusions), n = paires.length;
  assert.equal(new Set(paires).size, n, 'aucune fusion en double');
  // chaque fusion ne s'appuie que sur des morceaux définis AVANT elle
  for (let i = 0; i < n; i++) for (const x of [d.fusions[2 * i], d.fusions[2 * i + 1]]) {
    assert.ok(x < 264 + i, `la fusion ${i} renvoie au morceau ${x}, pas encore défini`);
  }
  // et un mot répété vingt fois dans le corpus (avec l'espace qui le précède) finit en un seul morceau
  assert.equal(d.encoder(' Mamoudzou').length, 1, `« Mamoudzou » en ${d.encoder(' Mamoudzou').length} morceaux`);
  assert.equal(d.decoder(d.encoder(' Mamoudzou')), ' Mamoudzou');
});

test('pré-découpage : l\'espace reste collé au mot qui le suit', () => {
  const d = apprendreDecoupage([CORPUS.join(' ').repeat(20)], 4096, 123);
  // « la maison de Mamoudzou » au milieu d'une phrase : quatre mots, quatre morceaux (aucun espace à part)
  assert.equal(d.encoder(' la maison de Mamoudzou').length, 4);
  for (const s of ['a  b', '  deux espaces', 'fin   ', 'ligne\n suite', ' ', '\t', 'a b']) assert.equal(d.decoder(d.encoder(s)), s, `aller-retour de ${JSON.stringify(s)}`);
});
