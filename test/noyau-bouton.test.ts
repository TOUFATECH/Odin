// Le bouton des garde-fous dans les Réglages : quand le noyau a changé, le propriétaire voit QUELS fichiers et QUEL
// changement, et choisit « restaurer » ou « accepter cette version » (routes noyau_restaurer / noyau_accepter).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changementNoyau } from '../src/tools/self.ts';
import { ecrireReference, RACINE_APPLI } from '../src/heimdall/noyau.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

test('le changement du noyau est fourni à la page (fichiers en écart ; sans git, dit pourquoi les lignes manquent)', () => {
  const racine = mkdtempSync(join(tmpdir(), 'bouton-')); dossiers.push(racine);
  mkdirSync(join(racine, 'src', 'heimdall'), { recursive: true });
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffre\n'); writeFileSync(join(racine, 'src', 'heimdall', 'policy.ts'), 'règles\n');
  ecrireReference(racine);
  assert.equal(changementNoyau(racine), '', 'aucun écart : rien à montrer');
  writeFileSync(join(racine, 'src', 'vault.ts'), 'coffre modifié\n');
  assert.match(changementNoyau(racine), /src\/vault\.ts/);
});

test('les Réglages montrent les fichiers, le changement et les deux boutons ; l\'état envoyé à la page porte le changement', () => {
  const ui = readFileSync(join(RACINE_APPLI, 'src', 'web', 'ui.html'), 'utf8');
  assert.match(ui, /'data-noyau': 'restaurer', onclick: \(\) => decider\('noyau_restaurer'/);
  assert.match(ui, /'data-noyau': 'accepter', onclick: \(\) => decider\('noyau_accepter'/);
  assert.match(ui, /N\.changement \? el\('pre', \{ 'data-noyau': 'changement'/);
  const srv = readFileSync(join(RACINE_APPLI, 'src', 'web', 'server.ts'), 'utf8');
  assert.match(srv, /changement: changementNoyau\(\)/);
  assert.match(srv, /case 'noyau_accepter': case 'noyau_restaurer':/);
});
