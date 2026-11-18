// Le catalogue des thèmes : la page (src/web/themes.js) et l'appli Apparence (src/valhalla/modules/apparence.ts)
// connaissent les mêmes thèmes, sous les mêmes noms : les 33 thèmes d'Odin et les 16 des événements de l'année.
// themes.js est chargé tel quel dans un bac à sable, avec une page factice (comme test/rapidite-theme-fond.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { THEME_NAMES } from '../src/valhalla/modules/apparence.ts';

const source = readFileSync(fileURLToPath(new URL('../src/web/themes.js', import.meta.url)), 'utf8');

interface Theme { name: string }
interface Famille { id: string; titre: string; ids: string[] }
interface Catalogue { THEMES: Record<string, Theme>; ORDER: string[]; EVENT_THEMES: Record<string, Theme>; familles?: () => Famille[] }

function chargerThemes(): Catalogue {
  const element = () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append() {} }, createElement: () => element(),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null,
  };
  const window: Record<string, unknown> = { OdinThemes: {}, addEventListener() {} };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), console, navigator: {} });
  (window as { window?: unknown }).window = window;
  vm.runInContext(source, ctx);
  return window.OdinThemes as Catalogue;
}

test('catalogue : 33 thèmes d\'Odin + 16 d\'événements, aucun doublon, ORDER reste aux 33', () => {
  const c = chargerThemes();
  const ev = Object.keys(c.EVENT_THEMES);
  assert.equal(c.ORDER.length, 33, 'ORDER garde les 33 (la liste déroulante de fenetre.js la lit)');
  assert.equal(ev.length, 16);
  assert.ok(ev.every((id) => id.startsWith('ev-')), 'les événements gardent le préfixe ev-');
  assert.ok(c.ORDER.every((id) => !id.startsWith('ev-')));
  const tous = [...c.ORDER, ...ev];
  assert.equal(new Set(tous).size, 49, 'aucun identifiant en double');
  assert.equal(Object.keys(c.THEMES).length, 49);
  const noms = tous.map((id) => c.THEMES[id].name);
  assert.equal(new Set(noms).size, 49, 'aucun nom en double');
});

test('catalogue : mêmes identifiants, dans le même ordre et sous les mêmes noms, dans themes.js et dans apparence.ts', () => {
  const c = chargerThemes();
  const page = [...c.ORDER, ...Object.keys(c.EVENT_THEMES)];
  assert.deepEqual(Object.keys(THEME_NAMES), page);
  for (const id of Object.keys(c.EVENT_THEMES)) assert.equal(THEME_NAMES[id], c.THEMES[id].name, `nom de ${id}`);
});
