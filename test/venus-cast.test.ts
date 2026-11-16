// Vénus · Odéon — le jeton de diffusion vers un écran : bon pour UNE cible, limité dans le temps, révélant rien en
// clair. (La clé de la machine est créée à la volée sous le dossier temporaire ; aucun service réel.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fluxAutorise, jetonFlux } from '../src/valhalla/venus/cast.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-cast-'));

test('jeton de diffusion : bon pour cette cible, refusé pour une autre, expiré, ou falsifié', () => {
  const home = tmp();
  try {
    const t0 = 1_000_000;
    const j = jetonFlux(home, 'film:inception-2010', { dureeMs: 60_000, maintenant: t0 });
    assert.ok(j && j.length > 0, 'un jeton est produit');
    assert.equal(fluxAutorise(home, 'film:inception-2010', j, t0 + 1000), true, 'bon pour la cible, dans le temps');
    assert.equal(fluxAutorise(home, 'film:autre', j, t0 + 1000), false, 'refusé pour une autre cible');
    assert.equal(fluxAutorise(home, 'film:inception-2010', j, t0 + 61_000), false, 'refusé une fois expiré');
    assert.equal(fluxAutorise(home, 'film:inception-2010', '', t0), false, 'jeton vide refusé');
    assert.equal(fluxAutorise(home, 'film:inception-2010', 'pas-un-jeton', t0), false, 'jeton falsifié refusé');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('le jeton ne porte pas la cible en clair (chiffré par la clé de la machine)', () => {
  const home = tmp();
  try {
    const j = jetonFlux(home, 'film:un-titre-secret');
    assert.doesNotMatch(j, /un-titre-secret/, 'la cible est chiffrée dans le jeton');
    assert.match(j, /^odc1:/, 'chiffré (clé de la machine)');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
