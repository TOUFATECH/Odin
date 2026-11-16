// Menus qui se replient (src/web/pages/menu-replie.js) : état de départ selon le réglage gardé, passages entre
// « replié », « déplié par-dessus » et « épinglé », délai de fermeture, et lecture de la source (libellés, classes
// de la maquette, aucune fenêtre native). Le fichier est lu sans document : il ne doit rien toucher à son chargement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type Etat = 'replie' | 'sideopen' | 'pinned';
interface Logique { depart: (lu: unknown) => Etat; suivant: (e: Etat, evt: string) => Etat; FERMER_MS: number }
const SRC = readFileSync(new URL('../src/web/pages/menu-replie.js', import.meta.url), 'utf8');
function charger(): Logique {
  const win: { OdinMenu?: { logique: Logique; brancher: unknown } } = {};
  vm.runInNewContext(SRC, { window: win });
  assert.ok(win.OdinMenu, 'window.OdinMenu est posé');
  assert.equal(typeof win.OdinMenu.brancher, 'function');
  return win.OdinMenu.logique;
}

test('menu replié : départ selon le réglage gardé', () => {
  const L = charger();
  assert.equal(L.depart('1'), 'pinned');
  for (const lu of ['0', null, undefined, '', 'oui', 1]) assert.equal(L.depart(lu), 'replie', String(lu));
  assert.equal(L.FERMER_MS, 500);
});

test('menu replié : survol, focus, appui, sortie, Échap, punaise', () => {
  const L = charger();
  assert.equal(L.suivant('replie', 'entree'), 'sideopen');
  assert.equal(L.suivant('replie', 'focus'), 'sideopen');
  assert.equal(L.suivant('replie', 'appui'), 'sideopen');
  assert.equal(L.suivant('sideopen', 'sortie'), 'replie');
  assert.equal(L.suivant('sideopen', 'flou'), 'replie');
  assert.equal(L.suivant('sideopen', 'dehors'), 'replie');
  assert.equal(L.suivant('sideopen', 'echap'), 'replie');
  assert.equal(L.suivant('sideopen', 'entree'), 'sideopen');
  // Épinglé : ni le survol ni la sortie ne changent rien.
  for (const evt of ['entree', 'sortie', 'focus', 'flou', 'appui', 'dehors', 'echap']) assert.equal(L.suivant('pinned', evt), 'pinned', evt);
  // La punaise bascule.
  assert.equal(L.suivant('replie', 'epingler'), 'pinned');
  assert.equal(L.suivant('sideopen', 'epingler'), 'pinned');
  assert.equal(L.suivant('pinned', 'epingler'), 'replie');
});

test('menu replié : libellés, classes de la maquette, pas de fenêtre native', () => {
  assert.match(SRC, /Garder le menu ouvert/);
  assert.match(SRC, /\.pinb/);
  assert.match(SRC, /pinned/);
  assert.match(SRC, /sideopen/);
  assert.match(SRC, /odin\.menu\.epingle/);
  assert.match(SRC, /Le menu reste ouvert\.|reste ouvert\./);
  assert.match(SRC, /prefers-reduced-motion/);
  assert.match(SRC, /min-width: ?861px/);
  assert.doesNotMatch(SRC, /(^|[^.\w])(confirm|alert|prompt)\(/m);
  // Le Cerveau branche son panneau avec sa propre clé.
  const brain = readFileSync(new URL('../src/web/brain.js', import.meta.url), 'utf8');
  assert.match(brain, /window\.OdinMenu\?\.brancher\(br, \{ panneau: side, cle: 'odin\.cerveau\.epingle'/);
});
