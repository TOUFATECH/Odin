// Le catalogue des thèmes : la page (src/web/themes.js) et l'appli Apparence (src/valhalla/modules/apparence.ts)
// connaissent les mêmes thèmes, sous les mêmes noms : les 33 thèmes d'Odin, les 16 des événements de l'année, et les
// thèmes « Mis en avant » de la maquette validée (src/web/pages/themes-catalogue.js, chargé juste avant themes.js).
// themes.js est chargé tel quel dans un bac à sable, avec une page factice (comme test/rapidite-theme-fond.test.ts),
// avec ou sans le catalogue : sans lui, rien ne change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { THEME_NAMES, apparence } from '../src/valhalla/modules/apparence.ts';
import { Valhalla } from '../src/valhalla/service.ts';

const source = readFileSync(fileURLToPath(new URL('../src/web/themes.js', import.meta.url)), 'utf8');
const CATALOGUE = fileURLToPath(new URL('../src/web/pages/themes-catalogue.js', import.meta.url));

interface Theme { name: string; dark?: boolean; sky?: string[]; panel?: string; ink?: string; accent?: string; mascot?: string; decor?: string }
interface Famille { id: string; titre: string; ids: string[] }
interface Catalogue {
  THEMES: Record<string, Theme>; ORDER: string[]; EVENT_THEMES: Record<string, Theme>; familles?: () => Famille[];
  apply(id: string): void; palette(t: Theme): Record<string, string>; contrast(a: string, b: string): number;
}
interface CatalogueMaquette { NOMS: Record<string, string>; THEMES: Record<string, Record<string, unknown>> }

/** themes.js dans une page factice ; avec `catalogue`, le fichier des thèmes « Mis en avant » est chargé avant. */
function chargerThemes(catalogue = false): Catalogue & { styles: Array<{ id?: string; textContent: string }>; maquette?: CatalogueMaquette } {
  const styles: Array<{ id?: string; textContent: string }> = [];
  const element = () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append: (s: { id?: string; textContent: string }) => styles.push(s) }, createElement: () => element(),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null,
  };
  const window: Record<string, unknown> = { OdinThemes: {}, addEventListener() {} };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), console, navigator: {} });
  (window as { window?: unknown }).window = window;
  if (catalogue) vm.runInContext(readFileSync(CATALOGUE, 'utf8'), ctx);
  vm.runInContext(source, ctx);
  // (les objets viennent du bac à sable : on les recopie avant de comparer)
  const copie = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
  const o = window.OdinThemes as Catalogue;
  return { ...o, THEMES: copie(o.THEMES), ORDER: copie(o.ORDER), EVENT_THEMES: copie(o.EVENT_THEMES), familles: o.familles && (() => copie(o.familles!())), styles, maquette: window.OdinCatalogueThemes ? copie(window.OdinCatalogueThemes as CatalogueMaquette) : undefined };
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

// ---------------------------------------------------------------- les thèmes « Mis en avant » (lot 2 du plan de la maquette)
const EN_AVANT = ['glace', 'vitre', 'glacenuit', 'neon', 'ha', 'clair'];
const NOUVEAUX = EN_AVANT.filter((id) => id !== 'glace');
// Le fond à plat : la première et la dernière couleur de la dernière couche du fond de la maquette (deux fois la même
// pour une couleur unie). Lu dans la maquette, thème par thème.
const FONDS: Record<string, [string, string]> = {
  glace: ['#d6edff', '#cde5fb'], vitre: ['#0a2584', '#0e36a3'], glacenuit: ['#071427', '#06101f'], neon: ['#17191f', '#0e1015'],
  ha: ['#111111', '#111111'], clair: ['#f7f7f7', '#efefef'],
};

test('Mis en avant : une famille en tête, six thèmes, 54 en tout, chacun une seule fois', () => {
  const c = chargerThemes(true);
  const f = c.familles!();
  assert.deepEqual(f.map((x) => x.id), ['enavant', 'odin', 'evenements']);
  assert.deepEqual(f[0].ids, EN_AVANT, 'Glace, Vitre, Glace nuit, Néon, Home Assistant, Maison claire');
  assert.deepEqual(f.map((x) => x.ids.length), [6, 32, 16], 'Glace passe dans « Mis en avant » (la maquette l\'écarte des thèmes d\'Odin)');
  assert.ok(f.every((x) => typeof x.titre === 'string' && x.titre.length > 0));
  assert.equal(new Set(f.map((x) => x.titre)).size, 3, 'trois titres différents');
  const tous = f.flatMap((x) => x.ids);
  assert.equal(tous.length, 54); assert.equal(new Set(tous).size, 54, 'aucun thème deux fois');
  assert.equal(Object.keys(c.THEMES).length, 54);
  assert.ok(f[1].ids.includes('minuit'), '« Minuit » reste dans « Les thèmes d\'Odin »');
  assert.equal(new Set(tous.map((id) => c.THEMES[id].name)).size, 54, 'aucun nom en double');
  assert.equal(c.ORDER.length, 33, 'ORDER ne bouge pas (fenetre.js le lit)');
});

test('Mis en avant : à plat, la règle de couleurs d\'Odin nourrie par le fond, le panneau plein, le texte, l\'accent et Odin de la maquette', () => {
  const c = chargerThemes(true), m = c.maquette!;
  assert.ok(m, 'le catalogue se publie sur la page');
  assert.deepEqual(Object.keys(m.THEMES), EN_AVANT);
  for (const id of EN_AVANT) {
    const t = c.THEMES[id], v = m.THEMES[id];
    assert.deepEqual(t.sky, FONDS[id], `${id} : fond`);
    assert.equal(t.panel, v.solid, `${id} : panneau = carte pleine`);
    assert.equal(t.ink, v.ink); assert.equal(t.accent, v.accent); assert.equal(t.mascot, v.mascot); assert.equal(t.dark, v.dark);
    assert.equal(t.name, m.NOMS[id], `${id} : le nom vient du dictionnaire du catalogue`);
    // Le texte se lit sur le panneau et sur le fond (4,5:1 au moins).
    const p = c.palette(t);
    assert.ok(c.contrast(p['--ink'], p['--panel']) >= 4.5, `${id} : texte sur panneau ${c.contrast(p['--ink'], p['--panel']).toFixed(2)}`);
    assert.ok(c.contrast(p['--ink'], p['--bg']) >= 4.5, `${id} : texte sur fond ${c.contrast(p['--ink'], p['--bg']).toFixed(2)}`);
    // Toujours le fond uni dans la zone de travail (choix du propriétaire du 17/11).
    c.apply(id);
    const css = c.styles.find((s) => s.id === 'odinThemeStyle')?.textContent ?? c.styles.at(-1)?.textContent ?? '';
    assert.match(css, /:root\[data-odin-theme\] main\{[^}]*background:var\(--bg\)/, `${id} : fond uni`);
    assert.match(css, new RegExp(`--panel:${v.solid as string}`), `${id} : panneau posé`);
  }
  const noms = EN_AVANT.map((id) => c.THEMES[id].name);
  assert.deepEqual(noms, ['Glace', 'Vitre', 'Glace nuit', 'Néon', 'Home Assistant', 'Maison claire']);
});

test('Mis en avant : « glace » garde son identifiant et son décor, et prend les couleurs de la maquette', () => {
  const avant = chargerThemes().THEMES.glace, apres = chargerThemes(true).THEMES.glace;
  assert.equal(avant.accent, '#1a6fae'); assert.equal(apres.accent, '#1f8fff');
  assert.equal(apres.ink, '#0d2a42'); assert.equal(apres.panel, '#f3f9ff'); assert.equal(apres.mascot, '#2b8fd6');
  assert.equal(apres.decor, avant.decor, 'le décor de Glace est celui que la maquette dessine aussi');
  assert.ok(apres.decor && apres.decor.length > 0);
});

test('« minuit » ne change pas (couleurs comprises) : il attend la réponse du propriétaire', () => {
  const sans = chargerThemes(), avec = chargerThemes(true);
  // Valeurs figées : celles de son Odin avant ce lot (themes.js du 18/11), pour qu'un changement fait dans themes.js
  // même se voie, pas seulement un changement venu du catalogue.
  const MINUIT = {
    name: 'Minuit', dark: true, sky: ['#05060f', '#10142a'], panel: '#11152b', ink: '#e6eaff', accent: '#7aa2ff', mascot: '#5b7bff',
    decor: '<circle cx="206" cy="34" r="14" fill="#e6eaff" opacity=".9"/><circle cx="212" cy="30" r="12" fill="#05060f"/><path d="M0 148 L60 136 L120 146 L180 132 L256 144 V170 H0Z" fill="#0b0e20"/>',
  };
  assert.deepEqual(sans.THEMES.minuit, MINUIT, 'minuit, sans le catalogue');
  assert.deepEqual(avec.THEMES.minuit, MINUIT, 'minuit, avec le catalogue');
  assert.ok(!Object.keys(avec.maquette!.THEMES).includes('minuit'), 'le « Minuit » de la maquette n\'est pas dans le catalogue');
  // Les 32 autres thèmes d'Odin et les 16 événements ne bougent pas non plus.
  for (const id of [...sans.ORDER, ...Object.keys(sans.EVENT_THEMES)]) if (id !== 'glace') assert.deepEqual(avec.THEMES[id], sans.THEMES[id], id);
});

test('themes.js marche encore sans le catalogue : deux familles (33 et 16), aucun thème neuf, et il s\'applique', () => {
  const c = chargerThemes();
  assert.deepEqual(c.familles!().map((x) => [x.id, x.ids.length]), [['odin', 33], ['evenements', 16]]);
  for (const id of NOUVEAUX) assert.equal(c.THEMES[id], undefined, id);
  c.apply('glace');
  assert.match(c.styles.at(-1)?.textContent ?? '', /--accent:#1a6fae/);
});

test('le catalogue : seulement des couleurs, des nombres et des codes ; les noms dans un dictionnaire en tête', () => {
  const m = chargerThemes(true).maquette!;
  assert.deepEqual(Object.keys(m.NOMS), EN_AVANT);
  const champs = ['dark', 'sc', 'gt', 'blur0', 'sheen', 'scene', 'mascot', 'bg', 'blob1', 'blob2', 'blobO', 'surface', 'solid', 'border', 'blur', 'sat', 'shadow', 'radius', 'ink', 'muted', 'accent', 'onA', 'onB', 'pal', 'side', 'chip', 'sel', 'track', 'line', 'good', 'warn', 'bad'];
  for (const id of EN_AVANT) {
    const v = m.THEMES[id];
    // Vitre, Home Assistant et Maison claire n'ont pas les deux taches floues (comme dans la maquette).
    const attendus = ['vitre', 'ha', 'clair'].includes(id) ? champs.filter((k) => k !== 'blob1' && k !== 'blob2') : champs;
    assert.deepEqual(Object.keys(v).sort(), [...attendus].sort(), `${id} : champs`);
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string') assert.doesNotMatch(x, /url\(|<|"|\p{Lu}/u, `${id}.${k} : ni image, ni texte`);
    }
  }
  const src = readFileSync(CATALOGUE, 'utf8');
  assert.ok(src.indexOf('const NOMS') >= 0 && src.indexOf('const NOMS') < src.indexOf('const THEMES'), 'le dictionnaire des noms est en tête');
});

test('catalogue : mêmes identifiants, dans le même ordre et sous les mêmes noms, dans themes.js et dans apparence.ts', () => {
  const c = chargerThemes(true);
  const enAvant = c.familles!()[0].ids;
  const page = [...c.ORDER, ...enAvant.filter((id) => !c.ORDER.includes(id)), ...Object.keys(c.EVENT_THEMES)];
  assert.equal(page.length, 54);
  assert.deepEqual(Object.keys(THEME_NAMES), page);
  for (const id of [...Object.keys(c.EVENT_THEMES), ...NOUVEAUX]) assert.equal(THEME_NAMES[id], c.THEMES[id].name, `nom de ${id}`);
});

test('Apparence : « Vitre », « Home Assistant » et les autres se choisissent par identifiant ou par nom, et se gardent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-themes-'));
  const v = new Valhalla(home, [apparence], { notify: async () => {} });
  try {
    const choisir = async (t: string) => ((await v.act('apparence', 'theme', { theme: t })).data as { theme: string }).theme;
    assert.equal(await choisir('vitre'), 'vitre');
    assert.equal(await choisir('Home Assistant'), 'ha');
    assert.equal(((await v.act('apparence', 'etat', {})).data as { theme: string; name: string }).name, 'Home Assistant', 'gardé');
    assert.equal(await choisir('Glace nuit'), 'glacenuit');
    assert.equal(await choisir('neon'), 'neon');
    assert.equal(await choisir('Maison claire'), 'clair');
    assert.equal(await choisir('glace'), 'glace');
    assert.equal(await choisir('minuit'), 'minuit');
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
