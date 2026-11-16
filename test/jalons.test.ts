// Lot B « répondre vite » : chaque sous-étape d'un tour est mesurée et le découpage est rangé dans le journal
// des routages (recordRoute). Le total reste cohérent avec la somme des étapes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ETAPE, Jalons } from '../src/core/jalons.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import type { RouteEntry } from '../src/providers/journal.ts';

const dors = (ms: number) => { const t = Date.now(); while (Date.now() - t < ms) { /* occupe le temps */ } };

test('Jalons : mesure, cumule et rend un découpage cohérent', () => {
  const j = new Jalons();
  j.mesure(ETAPE.rappel, () => dors(5));
  const fin = j.debut(ETAPE.cerveau); dors(5); fin();
  j.ajouter(ETAPE.modele, 20);
  j.ajouter(ETAPE.modele, 10); // cumul sur la même étape
  const d = j.decoupage();
  assert.ok(d[ETAPE.rappel] >= 4, 'le rappel est mesuré');
  assert.ok(d[ETAPE.cerveau] >= 4, 'le Cerveau est mesuré');
  assert.equal(d[ETAPE.modele], 30, 'les temps d\'une même étape se cumulent');
  // Le total (temps réel écoulé) couvre au moins les étapes réellement chronométrées (rappel + Cerveau).
  assert.ok(Number.isFinite(j.total) && j.total >= j.de(ETAPE.rappel) + j.de(ETAPE.cerveau) - 1, 'le total couvre les étapes chronométrées');
  j.ajouter('bidon', -5); // ignoré
  j.ajouter('', 10); // ignoré
  assert.equal(j.has('bidon'), false);
});

test('mesureAsync mesure une étape asynchrone', async () => {
  const j = new Jalons();
  const r = await j.mesureAsync(ETAPE.embed, async () => { await new Promise((res) => setTimeout(res, 10)); return 42; });
  assert.equal(r, 42);
  assert.ok(j.de(ETAPE.embed) >= 8, 'l\'étape asynchrone est mesurée');
});

test('recordRoute range le découpage, routeJalons le relit', () => {
  const m = new Mnemosyne(':memory:');
  const e: RouteEntry = { at: Date.now(), turnId: 't-1', sessionId: 'web:1', channel: 'web', request: 'bonjour', purpose: 'reponse', provider: 'mock', label: 'Mock', tier: '', minTier: '', need: 'conversation', reason: 'test', attempts: [], ok: true, ms: 123, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const decoupage = { [ETAPE.rappel]: 5, [ETAPE.cerveau]: 12, [ETAPE.modele]: 90 };
  m.recordRoute(e, decoupage);
  const lu = m.routeJalons('t-1');
  assert.deepEqual(lu, decoupage, 'le découpage est rangé et relu tel quel');
  // Sans jalons : routeJalons rend undefined.
  m.recordRoute({ ...e, turnId: 't-2' });
  assert.equal(m.routeJalons('t-2'), undefined);
});
