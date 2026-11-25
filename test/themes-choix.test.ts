// Choisir un thème : les deux familles de Réglages → Apparence (« Les thèmes d'Odin », « Événements de l'année »),
// un thème d'événement qui se choisit et se garde, « au hasard » (jamais un événement, ni Valhalla, ni le thème en
// cours), et « remets automatique » qui revient à la règle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apparence } from '../src/valhalla/modules/apparence.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// themes.js chargé tel quel dans un bac à sable (même page factice que test/themes-catalogue.test.ts).
const source = readFileSync(fileURLToPath(new URL('../src/web/themes.js', import.meta.url)), 'utf8');

interface Theme { name: string }
interface Famille { id: string; titre: string; ids: string[] }
interface Catalogue { THEMES: Record<string, Theme>; ORDER: string[]; EVENT_THEMES: Record<string, Theme>; familles?: () => Famille[] }

/** themes.js ; avec `catalogue`, le catalogue des thèmes (où sont les données des thèmes d'Odin) est chargé avant. */
function chargerThemes(catalogue = false): Catalogue {
  const element = () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append() {} }, createElement: () => element(),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null,
  };
  const window: Record<string, unknown> = { OdinThemes: {}, addEventListener() {} };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), console, navigator: {} });
  (window as { window?: unknown }).window = window;
  if (catalogue) vm.runInContext(readFileSync(fileURLToPath(new URL('../src/web/pages/themes-catalogue.js', import.meta.url)), 'utf8'), ctx);
  vm.runInContext(source, ctx);
  return window.OdinThemes as Catalogue;
}

// Les données des thèmes d'Odin et des événements sont dans le catalogue : la page le charge avant themes.js, l'essai aussi.
test('Réglages → Apparence : les familles, dans l\'ordre, avec leur titre et leur nombre', () => {
  const c = chargerThemes(true);
  assert.equal(typeof c.familles, 'function', 'window.OdinThemes.familles existe');
  const f = c.familles!();
  // (les tableaux viennent du bac à sable : on les recopie avant de comparer)
  assert.deepEqual([...f.map((x) => x.id)], ['enavant', 'odin', 'hestia', 'evenements']);
  assert.deepEqual([...f.map((x) => x.ids.length)], [6, 32, 31, 16]);
  assert.deepEqual([...f[1].ids], [...c.ORDER].filter((id) => !f[0].ids.includes(id)));
  assert.deepEqual([...f[3].ids], Object.keys(c.EVENT_THEMES));
  assert.ok(f.every((x) => typeof x.titre === 'string' && x.titre.length > 0), 'chaque famille a un titre');
  assert.equal(new Set(f.map((x) => x.titre)).size, 4);
  f[1].ids.push('x'); assert.equal(c.familles!()[1].ids.length, 32, 'la fonction rend une copie (ORDER ne bouge pas)'); assert.equal(c.ORDER.length, 33);
});

function odinDEssai() {
  const home = mkdtempSync(join(tmpdir(), 'odin-themes-'));
  const v = new Valhalla(home, [apparence], { notify: async () => {} });
  return { v, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const theme = async (v: Valhalla, t: string) => (await v.act('apparence', 'theme', { theme: t })).data as { mode: string; theme: string };
const etat = async (v: Valhalla) => (await v.act('apparence', 'etat', {})).data as { mode: string; theme: string; name: string };

test('un thème d\'événement se choisit (par identifiant ou par nom) et se garde', async () => {
  const { v, fin } = odinDEssai();
  try {
    assert.deepEqual(await theme(v, 'ev-noel'), { mode: 'fixe', theme: 'ev-noel' });
    const e = await etat(v);
    assert.equal(e.mode, 'fixe'); assert.equal(e.theme, 'ev-noel'); assert.equal(e.name, 'Noël');
    assert.equal((await theme(v, 'Carnaval')).theme, 'ev-carnaval');
    assert.equal((await etat(v)).theme, 'ev-carnaval', 'gardé d\'une lecture à l\'autre');
    assert.equal((await theme(v, 'glace')).theme, 'glace', 'un thème d\'Odin passe toujours avant');
  } finally { fin(); }
});

test('« au hasard » ne rend jamais un événement, ni Valhalla, ni le thème en cours', async () => {
  const { v, fin } = odinDEssai();
  try {
    let avant = (await theme(v, 'ev-halloween')).theme;
    const vus = new Set<string>();
    for (let i = 0; i < 150; i++) {
      const t = (await theme(v, 'au hasard')).theme;
      assert.ok(!t.startsWith('ev-'), `pas d'événement (${t})`);
      assert.notEqual(t, 'valhalla');
      assert.notEqual(t, avant, 'pas le thème en cours');
      vus.add(t); avant = t;
    }
    assert.ok(vus.size > 10, 'le hasard varie');
    for (let i = 0; i < 30; i++) assert.ok(!(await theme(v, '')).theme.startsWith('ev-'), '« change ton thème » non plus');
  } finally { fin(); }
});

test('« remets automatique » quitte le thème d\'événement et revient à la règle', async () => {
  const { v, fin } = odinDEssai();
  try {
    assert.equal((await theme(v, 'ev-ramadan'))?.theme, 'ev-ramadan');
    const r = await theme(v, 'automatique');
    assert.equal(r.mode, 'auto'); assert.ok(!r.theme.startsWith('ev-'));
    const e = await etat(v);
    assert.equal(e.mode, 'auto'); assert.equal(e.theme, r.theme);
  } finally { fin(); }
});

// Réglages → Apparence dessinée dans une page factice qui note les attributs posés. Chaque groupe de cartes porte le
// nom de sa famille (aria-labelledby → son titre) ; aucun groupe ne porte un autre nom qui doublerait ce titre
// (« Thèmes d'Odin » autour de « Les thèmes d'Odin » et des événements).
test('Réglages → Apparence : chaque groupe de cartes est nommé par le titre de sa famille, et seulement par lui', () => {
  interface El { tag: string; attrs: Record<string, string>; enfants: El[]; textContent: string; id: string; [k: string]: unknown }
  const tous: El[] = [];
  const el = (tag: string): El => {
    const e: El = {
      tag, attrs: {}, enfants: [], textContent: '', id: '', className: '', innerHTML: '', style: {}, dataset: {},
      setAttribute(k: string, v: string) { e.attrs[k] = v; },
      append(...xs: unknown[]) { for (const x of xs) if (x && typeof x === 'object') e.enfants.push(x as El); },
      after() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
      querySelector: () => el('span'), querySelectorAll: () => [],
    };
    tous.push(e); return e;
  };
  const grille = el('div');
  let grilleVue = false;
  const carte = el('article');
  carte.querySelector = (sel: string) => {
    if (sel === '#themeGrid') { const r = grilleVue ? grille : null; grilleVue = true; return r; }
    if (sel === 'h2' || sel === '#themeAuto') return el(sel);
    return null;
  };
  carte.querySelectorAll = () => [];
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append() {} }, createElement: (tag: string) => el(tag),
    querySelector: (sel: string) => (sel.startsWith('article.card') ? carte : null), querySelectorAll: () => [], addEventListener() {}, getElementById: () => null,
  };
  const window: Record<string, unknown> = { OdinThemes: {}, addEventListener() {} };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), console, navigator: {} });
  (window as { window?: unknown }).window = window;
  vm.runInContext(source, ctx);
  const groupes = tous.filter((e) => e.attrs.role === 'group');
  assert.equal(groupes.length, 2, 'un groupe par famille');
  const titres = new Map(tous.filter((e) => e.tag === 'h3').map((h) => [h.id, h.textContent]));
  for (const g of groupes) {
    assert.equal(g.attrs['aria-label'], undefined, `aucun nom posé à côté du titre (${g.attrs['aria-label']})`);
    assert.ok(titres.get(g.attrs['aria-labelledby']), 'nommé par le titre de sa famille');
  }
  assert.equal(grille.attrs['aria-label'], undefined, 'la grille entière ne double pas le titre de la première famille');
});
