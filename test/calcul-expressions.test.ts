// Expressions + − × ÷ ^ et parenthèses, lues par un analyseur écrit à la main (jamais d'évaluation de code), en
// fractions exactes : 0,1 + 0,2 = 0,3. Bornes : longueur, profondeur des parenthèses, taille des nombres.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluer, repondreCalcul } from '../src/langue/calcul.ts';

const ok = (phrase: string, langue?: string) => {
  const r = repondreCalcul(phrase, langue ? { langue } : {});
  assert.ok(r, `pas de réponse pour « ${phrase} »`);
  assert.equal(r.reconnu, true, `${phrase} → ${r.direct}`);
  return r;
};

test('0,1 + 0,2 = 0,3 (pas d\'erreur de virgule flottante visible)', () => {
  assert.notEqual(0.1 + 0.2, 0.3); // ce que donnerait le calcul flottant
  const r = ok('0,1 + 0,2', 'fr');
  assert.equal(r.donnees?.decimal, '0.3');
  assert.equal(r.donnees?.exact, '3/10');
  assert.match(r.direct, /= 0,3$/);
  assert.match(ok('what is 0.1 + 0.2').direct, /= 0\.3$/);
});

test('priorités, parenthèses, puissances, pourcentages', () => {
  const v = (p: string, l = 'fr') => ok(p, l).donnees?.decimal;
  assert.equal(v('combien font 2 + 3 × 4'), '14');
  assert.equal(v('(2 + 3) × 4'), '20');
  assert.equal(v('2^10'), '1024');
  assert.equal(v('2^-2'), '0.25');
  assert.equal(v('2 ^ 3 ^ 2'), '512');
  assert.equal(v('10 / 4', 'en'), '2.5');
  assert.equal(v('12 : 4'), '3');
  assert.equal(v('123456789012345678901234567890 × 2'), '246913578024691357802469135780');
  assert.equal(v('17 % de 240'), '40.8');
  const moins = ok('-2^2', 'fr');
  assert.equal(moins.donnees?.decimal, '-4');
  assert.ok(moins.pasSur.length >= 1, '−2^2 lu −(2^2) : dit');
  const plus = ok('240 + 17 %', 'fr');
  assert.equal(plus.donnees?.decimal, '280.8');
  assert.ok(plus.pasSur.length >= 1, '« + 17 % » lu comme 17 % de 240 : dit');
  const tiers = ok('1 ÷ 3', 'fr');
  assert.equal(tiers.donnees?.exact, '1/3');
  assert.equal(tiers.donnees?.arrondi, true);
  assert.match(tiers.direct, /≈ 0,333333/);
  assert.equal(ok('٣ + ٤', 'ar').donnees?.decimal, '7');
});

test('opérations écrites en mots, six langues', () => {
  assert.equal(ok('combien font trois plus quatre fois deux').donnees?.decimal, '11');
  assert.equal(ok('what is seven times six').donnees?.decimal, '42');
  assert.equal(ok('cuánto es diez menos tres').donnees?.decimal, '7');
  assert.equal(ok('was ist zwölf geteilt durch vier').donnees?.decimal, '3');
  assert.equal(ok('كم يساوي 3 زائد 4').donnees?.decimal, '7');
  assert.equal(ok('5 mara 6 ni ngapi').donnees?.decimal, '30');
});

test('erreurs dites, jamais devinées : division par zéro, puissance non entière, bornes', () => {
  const nr = (p: string) => { const r = repondreCalcul(p, { langue: 'fr' }); assert.equal(r?.reconnu, false, p); return r!; };
  nr('1 / 0');
  nr('2 ^ 0,5');
  nr('10 ^ 5000');
  nr('('.repeat(25) + '1' + ')'.repeat(25));
  nr('1 + '.repeat(150) + '1');
  nr('2 (3 + 4)');
  assert.equal(evaluer('1 / 0', 'fr').erreur, 'division-par-zero');
  assert.equal(evaluer('('.repeat(25) + '1' + ')'.repeat(25), 'fr').erreur, 'trop-profond');
  assert.equal(evaluer('1'.repeat(45) + ' + 1', 'fr').erreur, 'nombre-trop-long');
});

test('pas un calcul ou langue non couverte : rien', () => {
  assert.equal(repondreCalcul('bonjour', { langue: 'fr' }), undefined);
  assert.equal(repondreCalcul('combien font 2 + pommes', { langue: 'fr' }), undefined);
  assert.equal(repondreCalcul('2 + 2', {}), undefined); // sans mot ni langue : la langue de la réponse est inconnue
  assert.equal(repondreCalcul('2 + 2', { langue: 'it' }), undefined);
  assert.equal(repondreCalcul('2027', { langue: 'fr' }), undefined); // un nombre seul n'est pas un calcul
});

test('aucun exécuteur de code dans les trois modules', () => {
  for (const f of ['calcul', 'nombres', 'temps']) {
    const src = readFileSync(new URL(`../src/langue/${f}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(|node:vm|['"]vm['"]|\bimport\s*\(/, f);
  }
});

test('un résultat écrit en notation scientifique est annoncé arrondi (≈), jamais « = »', () => {
  const g = ok('2^200', 'fr');
  assert.match(g.direct, /≈ 1,606938 × 10\^60$/);
  assert.ok(g.points.some((x) => /arrondi/i.test(x)), g.points.join(' | '));
  assert.equal(g.donnees?.exact, (2n ** 200n).toString());
  assert.match(ok('(10^40 - 1)^3', 'fr').direct, /≈ 1 × 10\^120$/); // 9,99…×10^119 ramené à 1 × 10^120
  assert.match(ok('1010101010101010101010101010101010101010 × 10^40 + 1', 'fr').direct, / ≈ 1,010101 × 10\^79$/);
  assert.match(ok('10^50', 'fr').direct, /= 1 × 10\^50$/); // exact : « = » gardé
  assert.match(ok('(1/3)^100', 'fr').direct, /≈ 1,940325 × 10\^-48$/); // jamais « ≈ 0 »
});

test('le vrai signe dans « 100 − 10 % », et pas de nombre géant en lettres', () => {
  const r = ok('100 - 10 %', 'fr');
  assert.equal(r.donnees?.decimal, '90');
  assert.ok(r.pasSur.some((x) => x.includes('100 − 10 %')), r.pasSur.join(' | '));
  assert.ok(!r.pasSur.some((x) => x.includes('+')), r.pasSur.join(' | '));
  assert.equal(repondreCalcul('einhundert'.repeat(40) + ' plus eins', { langue: 'de' }), undefined);
});
