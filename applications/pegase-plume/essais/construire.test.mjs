// Plume dans Pégase : plume-page.js est à jour (fabriqué depuis applications/commun/plume.js et plume.css), et le côté
// processus principal ne laisse passer que ce qui est permis. Repris de l'essai de l'application Odin
// (test/plume-partout.test.ts), parti avec Pégase sur la branche odin-os le 17/11/2026.
//   node --test applications/pegase-plume/essais/construire.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('Pégase : plume-page.js est à jour (fabriqué depuis commun/plume.js et commun/plume.css)', async () => {
  const { codePage } = await import('../construire.mjs');
  assert.equal(readFileSync(new URL('../plume-page.js', import.meta.url), 'utf8'), codePage(), 'lance : node applications/pegase-plume/construire.mjs');
  const { nettoyer } = require('../plume-main.cjs');
  assert.deepEqual(nettoyer('corriger', { texte: 'bonjour', ou: 'odin', champ: 'recherche', jeton: 'x' }), { texte: 'bonjour', ou: 'pegase', champ: 'recherche' }, 'la page ne choisit pas « odin » et rien d\'autre ne passe');
  assert.equal(nettoyer('reglages', { autre: 1 }), null);
  assert.deepEqual(nettoyer('reglages', { actif: false, langue: 'fr', x: 2 }), { actif: false, langue: 'fr' });
});
