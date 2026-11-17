// La corbeille d'une note par la page web prévient Soul (comme l'outil cerveau_ecrire) : ses lignes entrent au registre
// des oublis, et ne reviennent plus dans le corpus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeOdin } from './helpers.ts';
import { brainPost } from '../src/web/brain-api.ts';
import { brainOf } from '../src/tools/brain.ts';
import { lireOublis, cleLigne } from '../src/brain/nous/oubli.ts';

test('mettre une note à la corbeille depuis la page : Soul l\'oublie', async () => {
  const o = makeOdin([]);
  const v = brainOf({ home: o.paths.home, careCfg: o.cfg, workspace: o.paths.workspace });
  const ligne = 'Le code du garage est rangé dans le tiroir de gauche.';
  const chemin = v.create('Garage', 'note', ligne);
  await brainPost(o, '/api/brain/trash', { path: chemin }, async () => ({ text: '' }));
  assert.ok(lireOublis(o.paths.home).cles.includes(cleLigne(ligne)), 'la ligne de la note est au registre des oublis');
  o.cleanup();
});
