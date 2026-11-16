// Lot B « répondre vite » : une 2e demande identique ou rapprochée ne refait pas le rappel ni le plongement ;
// le cache des rappels est vidé à l'écriture en mémoire, celui des plongements survit (il ne dépend que du texte).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CacheLRU, CacheRequetes, normaliserRequete } from '../src/core/cache-requete.ts';

test('normaliserRequete : sans accents, sans ponctuation, espaces réduits', () => {
  assert.equal(normaliserRequete('  Quel est l\'État ?? '), 'quel est l etat');
  assert.equal(normaliserRequete('Météo, à Paris !'), 'meteo a paris');
  assert.equal(normaliserRequete('MÊME chose'), normaliserRequete('meme chose'));
});

test('CacheLRU : garde, remonte l\'utilisé, évince le plus ancien', () => {
  const c = new CacheLRU<number>(2);
  c.set('a', 1); c.set('b', 2);
  assert.equal(c.get('a'), 1); // a redevient le plus récent
  c.set('c', 3); // évince b (le plus ancien non utilisé)
  assert.equal(c.has('b'), false);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('c'), 3);
  assert.equal(c.taille, 2);
});

test('rappel() mémorise ; invaliderMemoire le vide (écriture en mémoire)', () => {
  const cache = new CacheRequetes();
  let calculs = 0;
  const demander = (q: string) => cache.rappel('recall', q, () => { calculs++; return `réponse à ${q}`; });
  assert.equal(demander('quels films me manquent'), 'réponse à quels films me manquent');
  demander('Quels films me manquent ?'); // même demande normalisée
  assert.equal(calculs, 1, 'une 2e demande identique ne refait pas le calcul');
  cache.invaliderMemoire();
  demander('quels films me manquent');
  assert.equal(calculs, 2, 'après une écriture en mémoire, le rappel est recalculé');
});

test('plongement : gardé par modèle, survit à une écriture, vidé au changement de modèle', () => {
  const cache = new CacheRequetes();
  const v = Float32Array.from([0.1, 0.2]);
  assert.equal(cache.plongement('m1', 'meteo'), undefined);
  cache.poserPlongement('m1', 'Météo', v);
  assert.equal(cache.plongement('m1', 'meteo'), v, 'même texte normalisé : plongement retrouvé');
  cache.invaliderMemoire();
  assert.equal(cache.plongement('m1', 'meteo'), v, 'une écriture en mémoire ne touche pas les plongements');
  assert.equal(cache.plongement('m2', 'meteo'), undefined, 'changement de modèle : plongement oublié');
  assert.equal(cache.plongement('m1', 'meteo'), undefined, 'et l\'ancien modèle est vidé');
});
