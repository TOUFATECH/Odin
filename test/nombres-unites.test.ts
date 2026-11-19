// Nombres écrits en chiffres et en lettres, pourcentages, règle de trois, unités et monnaies (seulement avec un taux
// fourni), en fractions exactes, dans six langues. Une ambiguïté (séparateur décimal, gallon, livre, Go) est dite.
import assert from 'node:assert/strict';
import test from 'node:test';
import { convertir, depuisDecimal, ecrire, lireChiffres, lireNombre, regleDeTrois, repondreNombres, versFraction, type TauxChange } from '../src/langue/nombres.ts';

const rep = (phrase: string, langue?: string, taux?: TauxChange[]) => {
  const r = repondreNombres(phrase, { ...(langue ? { langue } : {}), ...(taux ? { taux } : {}) });
  assert.ok(r, `pas de réponse pour « ${phrase} »`);
  return r;
};

test('nombres en lettres, six langues', () => {
  const cas: Array<[string, string, bigint]> = [
    ['quatre-vingt-dix-sept', 'fr', 97n], ['soixante et onze', 'fr', 71n], ['deux mille vingt-six', 'fr', 2026n], ['trois cent mille', 'fr', 300000n],
    ['two hundred and forty-five', 'en', 245n], ['a thousand', 'en', 1000n], ['one million two hundred thousand', 'en', 1200000n],
    ['doscientos cuarenta y cinco', 'es', 245n], ['mil novecientos noventa', 'es', 1990n],
    ['zweihundertfünfundvierzig', 'de', 245n], ['eintausend', 'de', 1000n],
    ['مئتان وخمسة وأربعون', 'ar', 245n], ['ثلاثة آلاف', 'ar', 3000n], ['ثلاثة عشر', 'ar', 13n],
    ['mia mbili arobaini na tano', 'sw', 245n], ['elfu moja mia tisa tisini', 'sw', 1990n], ['kumi na mbili', 'sw', 12n],
  ];
  for (const [t, l, v] of cas) assert.equal(lireNombre(t, l as 'fr'), v, `${t} (${l})`);
  assert.equal(lireNombre('deux trois', 'fr'), undefined);
  assert.equal(lireNombre('quatre', 'xx' as 'fr'), undefined);
});

test('nombres en chiffres : séparateurs selon la langue, ambiguïté dite, bornes', () => {
  const v = (b: string, l: string) => { const r = lireChiffres(b, l as 'fr'); return r && { v: versFraction(r.valeur), a: !!r.ambigu }; };
  assert.deepEqual(v('1 250,50', 'fr'), { v: '2501/2', a: false });
  assert.deepEqual(v('1,250.50', 'en'), { v: '2501/2', a: false });
  assert.deepEqual(v('1.250', 'de'), { v: '1250', a: true }); // en allemand, le point groupe les milliers
  assert.deepEqual(v('1,250', 'en'), { v: '1250', a: true });
  assert.deepEqual(v('1,250', 'fr'), { v: '5/4', a: true });
  assert.deepEqual(v('0,125', 'fr'), { v: '1/8', a: false });
  assert.deepEqual(v('٣٫٥', 'ar'), { v: '7/2', a: false });
  assert.equal(v('1,2,3', 'fr'), undefined);
  assert.equal(v('1'.repeat(45), 'fr'), undefined);
});

test('fractions exactes : 0,1 + 0,2 = 0,3, et un arrondi est annoncé', () => {
  const a = depuisDecimal('0.1'), b = depuisDecimal('0.2');
  assert.equal(ecrire({ n: a.n * b.d + b.n * a.d, d: a.d * b.d }).decimal, '0.3');
  const tiers = ecrire({ n: 1n, d: 3n });
  assert.deepEqual([tiers.decimal, tiers.exact], ['0.333333', false]);
});

test('unités : longueur, masse, volume, température, vitesse, surface, données, en six langues', () => {
  const km = rep('3 km en miles', 'fr');
  assert.equal(km.donnees?.resultat, '1.864114');
  assert.equal(km.donnees?.arrondi, true);
  assert.equal(km.donnees?.exact, '15625/8382');
  assert.ok(km.conseils.some((c) => c.id === 'convertir-unite'));
  assert.equal(rep('5 miles in km').donnees?.resultat, '8.04672');
  assert.equal(rep('10 kilómetros a millas', 'es').donnees?.resultat, '6.213712');
  assert.equal(rep('5 Kilometer in Meilen').donnees?.resultat, '3.106856');
  assert.equal(rep('5 كيلومتر إلى ميل').donnees?.resultat, '3.106856');
  assert.equal(rep('badilisha kilomita 5 kuwa maili').donnees?.resultat, '3.106856');
  const f = rep('100 °F en °C', 'fr');
  assert.deepEqual([f.donnees?.resultat, f.donnees?.exact], ['37.777778', '340/9']);
  assert.equal(rep('-40 °C in °F', 'en').donnees?.resultat, '-40');
  assert.equal(rep('90 km/h en m/s', 'fr').donnees?.resultat, '25');
  assert.equal(rep('2 hectares en m²', 'fr').donnees?.resultat, '20000');
  assert.equal(rep('combien de centimètres dans 3 pouces', 'fr').donnees?.resultat, '7.62');
  const go = rep('1 Go en Mo', 'fr');
  assert.equal(go.donnees?.resultat, '1000');
  assert.ok(go.pasSur.length >= 1, '1 Go = 10^9 ou 2^30 : dit');
  const lb = rep('2 livres en kg', 'fr');
  assert.equal(lb.donnees?.resultat, '0.90718474');
  assert.ok(lb.pasSur.length >= 1);
  const gal = rep('3 gallons in liters', 'en');
  assert.equal(gal.donnees?.resultat, '11.356235352');
  assert.ok(gal.pasSur.length >= 1);
  assert.equal(rep('3 km en kg', 'fr').reconnu, false);
});

test('pourcentages : hausse, remise, part d\'un tout, évolution', () => {
  assert.equal(rep('augmenter 240 de 17 %', 'fr').donnees?.resultat, '280.8');
  assert.equal(rep('240 with a 20% discount').donnees?.resultat, '192');
  assert.equal(rep('خصم 20% من 240').donnees?.resultat, '192');
  assert.equal(rep('ongeza 240 kwa asilimia 17').donnees?.resultat, '280.8');
  const part = rep('40 sur 240 en pourcentage', 'fr');
  assert.equal(part.donnees?.resultat, '16.666667');
  assert.equal(part.donnees?.arrondi, true);
  assert.equal(rep('what percentage of 240 is 60').donnees?.resultat, '25');
  assert.equal(rep('Veränderung in Prozent von 80 auf 100').donnees?.resultat, '25');
});

test('règle de trois', () => {
  assert.equal(versFraction(regleDeTrois({ n: 3n, d: 1n }, { n: 12n, d: 1n }, { n: 5n, d: 1n })!), '20');
  assert.equal(regleDeTrois({ n: 0n, d: 1n }, { n: 12n, d: 1n }, { n: 5n, d: 1n }), undefined);
  assert.equal(rep('3 → 12, 5 → ?', 'fr').donnees?.resultat, '20');
  assert.equal(rep('regla de tres 3 12 5').donnees?.resultat, '20');
  assert.equal(rep('Dreisatz 4 10 6').donnees?.resultat, '15');
});

test('monnaies : jamais sans taux fourni ; avec un taux daté, exact et arrondi à l\'unité de la monnaie', () => {
  const sans = rep('100 € en dollars', 'fr');
  assert.equal(sans.reconnu, false);
  assert.equal(sans.donnees, undefined);
  const taux = [{ de: 'EUR', vers: 'USD', valeur: '1.08', date: '2026-11-18', source: 'source d’exemple' }];
  const avec = rep('100 € en dollars', 'fr', taux);
  assert.equal(avec.reconnu, true);
  assert.equal(avec.donnees?.resultat, '108');
  assert.ok(avec.pasSur.some((x) => x.includes('2026-11-18')));
  assert.equal(rep('108 USD in EUR', 'en', taux).donnees?.resultat, '100');
});

test('langues : non couverte → rien ; sans langue et sans mot qui tranche → rien', () => {
  assert.equal(repondreNombres('3 km en miles', { langue: 'it' }), undefined);
  assert.equal(repondreNombres('3 km en m', {}), undefined); // « en » : français ou espagnol
  assert.equal(repondreNombres('bonjour', { langue: 'fr' }), undefined);
  assert.equal(repondreNombres('x'.repeat(2000), { langue: 'fr' }), undefined);
  assert.equal(convertir({ n: 1n, d: 1n }, 'km', 'kg'), undefined);
});

test('nombres en lettres mal formés refusés, les formes justes gardées', () => {
  const faux: Array<[string, string]> = [
    ['cent cent', 'fr'], ['hundred hundred', 'en'], ['mille mille', 'fr'], ['trois cent cent', 'fr'], ['mia mia', 'sw'], ['elfu elfu', 'sw'],
    ['einhunderteinhundert', 'de'], ['tausendtausend', 'de'], ['ألفان ألفان', 'ar'], ['mil mil', 'es'], ['mia mbili mia', 'sw'],
  ];
  for (const [t, l] of faux) assert.equal(lireNombre(t, l as 'fr'), undefined, `${t} (${l})`);
  const justes: Array<[string, string, bigint]> = [
    ['mille millions', 'fr', 1000000000n], ['cent mille', 'fr', 100000n], ['un million mille', 'fr', 1001000n], ['nineteen hundred', 'en', 1900n],
    ['mil millones', 'es', 1000000000n], ['elfu mia tatu', 'sw', 300000n], ['milioni mbili laki tatu', 'sw', 2300000n], ['zweihunderttausend', 'de', 200000n],
  ];
  for (const [t, l, v] of justes) assert.equal(lireNombre(t, l as 'fr'), v, `${t} (${l})`);
});

test("l'article « un », « une », « un » espagnol n'est pas compté comme un nombre", () => {
  assert.equal(rep('200 avec une remise de 15 %', 'fr').donnees?.resultat, '170');
  assert.equal(rep('200 avec un rabais de 15 %', 'fr').donnees?.resultat, '170');
  assert.equal(rep('200 con un descuento del 15 %', 'es').donnees?.resultat, '170');
  assert.equal(rep('un kilomètre en mètres', 'fr').donnees?.resultat, '1000'); // devant une unité, il vaut 1
});

test('division par zéro dite en clair, jamais « 0 = 0 »', () => {
  for (const [p, l, mot] of [['de 0 à 100 en pourcentage', 'fr', /zéro/], ['0 → 5, 6 → ?', 'fr', /zéro/], ['from 0 to 100 percentage change', 'en', /zero/]] as const) {
    const r = rep(p, l);
    assert.equal(r.reconnu, false, p);
    assert.doesNotMatch(r.direct, /= 0$/, p);
    assert.match(r.direct, mot, p);
  }
});
