// Le catalogue des thèmes : la page (src/web/themes.js) et l'appli Apparence (src/valhalla/modules/apparence.ts)
// connaissent les mêmes thèmes, sous les mêmes noms : les 33 thèmes d'Odin, les 16 des événements de l'année, et les
// thèmes « Mis en avant » et « Thèmes de Hestia » de la maquette validée (src/web/pages/themes-catalogue.js, chargé
// juste avant themes.js).
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
import { THEMES as LIBELLES_MAISON } from '../src/valhalla/modules/gladsheim.ts';
import { Valhalla } from '../src/valhalla/service.ts';

const source = readFileSync(fileURLToPath(new URL('../src/web/themes.js', import.meta.url)), 'utf8');
const CATALOGUE = fileURLToPath(new URL('../src/web/pages/themes-catalogue.js', import.meta.url));

interface Theme { name: string; dark?: boolean; sky?: string[]; panel?: string; ink?: string; accent?: string; mascot?: string; decor?: string }
interface Famille { id: string; titre: string; ids: string[] }
interface Catalogue {
  THEMES: Record<string, Theme>; ORDER: string[]; EVENT_THEMES: Record<string, Theme>; familles?: () => Famille[];
  apply(id: string): void; palette(t: Theme): Record<string, string>; contrast(a: string, b: string): number;
}
interface CatalogueMaquette { NOMS: Record<string, string>; THEMES: Record<string, Record<string, unknown>>; HESTIA?: Record<string, Record<string, unknown>>; DECORS?: Record<string, string> }

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

test('Mis en avant : une famille en tête, six thèmes, chacun une seule fois', () => {
  const c = chargerThemes(true);
  const f = c.familles!();
  assert.equal(f[0].id, 'enavant');
  assert.deepEqual(f[0].ids, EN_AVANT, 'Glace, Vitre, Glace nuit, Néon, Home Assistant, Maison claire');
  assert.equal(f[1].id, 'odin'); assert.equal(f[1].ids.length, 32, 'Glace passe dans « Mis en avant » (la maquette l\'écarte des thèmes d\'Odin)');
  assert.ok(f.every((x) => typeof x.titre === 'string' && x.titre.length > 0));
  assert.equal(new Set(f.map((x) => x.titre)).size, f.length, 'des titres différents');
  const tous = f.flatMap((x) => x.ids);
  assert.equal(new Set(tous).size, tous.length, 'aucun thème deux fois');
  assert.ok(f[1].ids.includes('minuit'), '« Minuit » reste dans « Les thèmes d\'Odin »');
  // Hors des thèmes de Hestia (qui gardent les noms de l'écran de la maison), aucun nom n'est pris deux fois.
  const horsHestia = f.filter((x) => x.id !== 'hestia').flatMap((x) => x.ids);
  assert.equal(horsHestia.length, 54);
  assert.equal(new Set(horsHestia.map((id) => c.THEMES[id].name)).size, 54, 'aucun nom en double hors de Hestia');
  assert.equal(c.ORDER.length, 33, 'ORDER ne bouge pas (fenetre.js le lit)');
});

test('Mis en avant : à plat, la règle de couleurs d\'Odin nourrie par le fond, le panneau plein, le texte, l\'accent et Odin de la maquette', () => {
  const c = chargerThemes(true), m = c.maquette!;
  assert.ok(m, 'le catalogue se publie sur la page');
  assert.deepEqual(Object.keys(m.THEMES).filter((id) => !id.startsWith('h-')), EN_AVANT);
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
  assert.ok(!Object.keys(c.THEMES).some((id) => id.startsWith('h-')), 'aucun thème de Hestia sans le catalogue');
  c.apply('glace');
  assert.match(c.styles.at(-1)?.textContent ?? '', /--accent:#1a6fae/);
});

test('le catalogue : seulement des couleurs, des nombres et des codes ; les noms dans un dictionnaire en tête', () => {
  const m = chargerThemes(true).maquette!;
  assert.deepEqual(Object.keys(m.NOMS).filter((id) => !id.startsWith('h-')), EN_AVANT);
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
  assert.ok(src.indexOf('const NOMS') < src.indexOf('const HESTIA'), 'avant les thèmes de Hestia aussi');
});

test('catalogue : mêmes identifiants, dans le même ordre et sous les mêmes noms, dans themes.js et dans apparence.ts', () => {
  const c = chargerThemes(true);
  const enAvant = c.familles!()[0].ids, hestia = c.familles!().find((f) => f.id === 'hestia')?.ids ?? [];
  const page = [...c.ORDER, ...enAvant.filter((id) => !c.ORDER.includes(id)), ...hestia, ...Object.keys(c.EVENT_THEMES)];
  assert.equal(page.length, 85);
  assert.deepEqual(Object.keys(THEME_NAMES), page);
  for (const id of [...Object.keys(c.EVENT_THEMES), ...NOUVEAUX, ...hestia]) assert.equal(THEME_NAMES[id], c.THEMES[id].name, `nom de ${id}`);
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

// ---------------------------------------------------------------- les thèmes de Hestia (lot 3 du plan de la maquette)
// Les 31 thèmes de l'écran de la maison (src/web/maison.js, table T) sont recopiés dans le catalogue sous l'identifiant
// h-…, avec leurs 13 décors (table DECOR) : l'écran de la maison n'est pas touché. Ces essais lisent maison.js tel quel
// (chaque table est évaluée seule, dans un bac à sable) et comparent la copie champ par champ.
const MAISON = readFileSync(fileURLToPath(new URL('../src/web/maison.js', import.meta.url)), 'utf8');
/** Une table de maison.js (`const NOM = { … };`), évaluée seule dans un bac à sable. */
function tableMaison<T>(nom: string): Record<string, T> {
  const debut = MAISON.indexOf(`const ${nom} = {`);
  assert.ok(debut >= 0, `${nom} dans maison.js`);
  const ouvre = MAISON.indexOf('{', debut);
  let i = ouvre, prof = 0, guillemet = '';
  for (; i < MAISON.length; i++) {
    const ch = MAISON[i];
    if (guillemet) { if (ch === '\\') i++; else if (ch === guillemet) guillemet = ''; continue; }
    if (ch === '/' && MAISON[i + 1] === '/') { i = MAISON.indexOf('\n', i); continue; }
    if (ch === '\'' || ch === '"' || ch === '`') guillemet = ch;
    else if (ch === '{') prof++;
    else if (ch === '}' && --prof === 0) break;
  }
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${MAISON.slice(ouvre, i + 1)})`, {}))) as Record<string, T>;
}
type Hestia = { bg: string; bg2: string; card: string; card2: string; line: string; text: string; muted: string; accent: string; accent2?: string; on: string; decor?: string; light?: boolean };
const CHAMPS_MAQUETTE = ['dark', 'sc', 'gt', 'blur0', 'sheen', 'scene', 'mascot', 'bg', 'blob1', 'blob2', 'blobO', 'surface', 'solid', 'border', 'blur', 'sat', 'shadow', 'radius', 'ink', 'muted', 'accent', 'onA', 'onB', 'pal', 'side', 'chip', 'sel', 'track', 'line', 'good', 'warn', 'bad'];
/** Clair ou sombre, comme l'écran de la maison le décide (maison.js, applyTheme) : « clair » par son nom, les autres par `light`. */
const estClair = (id: string, h: Hestia) => id === 'clair' || h.light === true;
const styleDuTheme = (c: { styles: Array<{ id?: string; textContent: string }> }) => c.styles.find((s) => s.id === 'odinThemeStyle')?.textContent ?? c.styles.at(-1)?.textContent ?? '';

test('Hestia : les 31 thèmes, leurs 12 valeurs et les 13 décors sont ceux de maison.js, champ par champ', () => {
  const T = tableMaison<Hestia>('T'), DECOR = tableMaison<string>('DECOR'), m = chargerThemes(true).maquette!;
  assert.equal(Object.keys(T).length, 31, '31 thèmes sur l\'écran de la maison');
  assert.equal(Object.keys(DECOR).length, 13, '13 décors dessinés');
  assert.deepEqual(Object.keys(m.HESTIA ?? {}), Object.keys(T), 'les mêmes 31, dans le même ordre');
  for (const [id, h] of Object.entries(T)) {
    const copie = m.HESTIA![id];
    assert.deepEqual(Object.keys(copie).sort(), Object.keys(h).sort(), `${id} : mêmes champs`);
    for (const [k, x] of Object.entries(h)) assert.deepEqual(copie[k], x, `${id}.${k}`);
  }
  assert.deepEqual(Object.keys(m.DECORS ?? {}), Object.keys(DECOR), 'les mêmes 13 décors');
  for (const [k, x] of Object.entries(DECOR)) assert.equal(m.DECORS![k], x, `décor ${k}`);
  assert.deepEqual(Object.keys(m.THEMES).filter((id) => id.startsWith('h-')), Object.keys(T).map((id) => `h-${id}`));
  assert.deepEqual(Object.keys(m.NOMS).filter((id) => id.startsWith('h-')), Object.keys(T).map((id) => `h-${id}`), 'un nom pour chacun, dans le dictionnaire');
});

test('Hestia : la règle de la maquette en tire les 32 valeurs, et « Clair » reste un thème clair', () => {
  const T = tableMaison<Hestia>('T'), m = chargerThemes(true).maquette!;
  for (const [id, h] of Object.entries(T)) {
    const v = m.THEMES[`h-${id}`], clair = estClair(id, h);
    assert.deepEqual(Object.keys(v).sort(), [...CHAMPS_MAQUETTE].sort(), `h-${id} : champs`);
    assert.equal(v.dark, !clair, `h-${id} : clair ou sombre comme sur l'écran de la maison`);
    assert.equal(v.bg, h.bg2); assert.equal(v.surface, h.card); assert.equal(v.border, h.line);
    assert.equal(v.ink, h.text); assert.equal(v.muted, h.muted); assert.equal(v.accent, h.accent); assert.equal(v.onA, h.on);
    assert.equal(v.mascot, h.accent2 ?? h.accent); assert.equal(v.blob1, h.accent); assert.equal(v.blob2, h.accent2);
    assert.deepEqual(v.pal, [h.accent, h.accent2, '#a35bff', '#16c1e6', '#2fcf92']);
    if (/^#/.test(h.card2)) assert.equal(v.solid, h.card2); else assert.match(String(v.solid), /^#[0-9a-f]{6}$/);
    assert.equal(v.sheen, clair ? 0.4 : 0.08); assert.equal(v.blobO, clair ? 0.2 : 0.14);
    assert.deepEqual([v.blur0, v.blur, v.sat, v.radius], [18, 18, 1.3, 20]);
    assert.deepEqual([v.good, v.warn, v.bad], clair ? ['#1D7F68', '#8F6200', '#B23F2A'] : ['#6CCFB8', '#F0B860', '#EE8A70']);
    assert.ok(Number.isInteger(v.gt) && (v.gt as number) >= 0 && (v.gt as number) <= 100, `h-${id} : verre de 0 à 100`);
    for (const [k, x] of Object.entries(v)) if (typeof x === 'string') assert.doesNotMatch(x, /url\(|<|"/, `h-${id}.${k} : ni image, ni texte`);
  }
  // Trois thèmes relevés dans la maquette elle-même (rejouée hors du dépôt), toutes valeurs comprises.
  const RELEVES: Record<string, Record<string, unknown>> = {
    'h-verre': { dark: true, sc: '#1f222b', gt: 0, blur0: 18, sheen: 0.08, scene: 'orbs', mascot: '#3fa9ff', bg: 'radial-gradient(1200px 600px at 0% 0%,#232634,transparent),#15171d', blob1: '#ff8a3d', blob2: '#3fa9ff', blobO: 0.14, surface: '#1f222b', solid: '#272b36', border: '#2f3340', blur: 18, sat: 1.3, shadow: '0 14px 34px rgba(0,0,0,.35)', ink: '#eef0f6', muted: '#9aa1b2', accent: '#ff8a3d', onA: 'linear-gradient(135deg,#ff9a3d,#ff6a3d)', onB: 'linear-gradient(135deg,#3fa9ff,#2f7fbf)', pal: ['#ff8a3d', '#3fa9ff', '#a35bff', '#16c1e6', '#2fcf92'], side: 'rgba(28,30,36,0.8)', chip: 'rgba(255,255,255,.07)', sel: 'rgba(255,255,255,.12)', track: 'rgba(255,255,255,.12)', line: 'rgba(255,255,255,.07)', radius: 20, good: '#6CCFB8', warn: '#F0B860', bad: '#EE8A70' },
    'h-acier': { dark: true, sc: '#ffffff', gt: 100, blur0: 18, sheen: 0.08, scene: 'orbs', mascot: '#ffd36b', bg: 'linear-gradient(180deg,#3a4652 0%,#1b222b 60%)', blob1: '#9fd3ff', blob2: '#ffd36b', blobO: 0.14, surface: 'rgba(255,255,255,.07)', solid: '#2d343c', border: 'rgba(255,255,255,.12)', blur: 18, sat: 1.3, shadow: '0 14px 34px rgba(0,0,0,.35)', ink: '#eef3f8', muted: '#a9b6c4', accent: '#9fd3ff', onA: 'linear-gradient(135deg,#7fb8e6,#4f86b8)', onB: 'linear-gradient(135deg,#ffd36b,#bf9e50)', pal: ['#9fd3ff', '#ffd36b', '#a35bff', '#16c1e6', '#2fcf92'], side: 'rgba(34,41,49,0.8)', chip: 'rgba(255,255,255,.07)', sel: 'rgba(255,255,255,.12)', track: 'rgba(255,255,255,.12)', line: 'rgba(255,255,255,.07)', radius: 20, good: '#6CCFB8', warn: '#F0B860', bad: '#EE8A70' },
    'h-plage': { dark: false, sc: '#ffffff', gt: 33, blur0: 18, sheen: 0.4, scene: 'none', mascot: '#e8590c', bg: 'linear-gradient(180deg,#8fd8ff 0%,#c9f0ff 55%,#f2d49b 100%)', blob1: '#087f8f', blob2: '#e8590c', blobO: 0.2, surface: 'rgba(255,255,255,.66)', solid: '#ffffff', border: 'rgba(255,255,255,.85)', blur: 18, sat: 1.3, shadow: '0 8px 24px rgba(0,0,0,.07)', ink: '#0d3a4a', muted: '#2f6170', accent: '#087f8f', onA: 'linear-gradient(135deg,#ff9f43,#ff7a1a)', onB: 'linear-gradient(135deg,#e8590c,#ae4309)', pal: ['#087f8f', '#e8590c', '#a35bff', '#16c1e6', '#2fcf92'], side: 'rgba(255,255,255,.7)', chip: 'rgba(0,0,0,.045)', sel: 'rgba(8,127,143,0.12)', track: 'rgba(0,0,0,.08)', line: 'rgba(0,0,0,.06)', radius: 20, good: '#1D7F68', warn: '#8F6200', bad: '#B23F2A' },
  };
  for (const [id, attendu] of Object.entries(RELEVES)) assert.deepEqual(m.THEMES[id], attendu, id);
  // « Clair » : la maquette le traite en sombre ; ici il est clair, comme sur l'écran de la maison.
  const clair = m.THEMES['h-clair'];
  assert.equal(clair.dark, false);
  assert.deepEqual([clair.sheen, clair.scene, clair.side, clair.chip, clair.good], [0.4, 'none', 'rgba(255,255,255,.7)', 'rgba(0,0,0,.045)', '#1D7F68']);
  const c = chargerThemes(true);
  assert.equal(c.THEMES['h-clair'].dark, false);
  c.apply('h-clair');
  assert.match(styleDuTheme(c), /color-scheme:light/, 'posé en clair');
});

test('Hestia : une famille de 31 sous les noms de l\'écran de la maison ; 85 en tout, aucun identifiant ni couple (famille, nom) en double', () => {
  const c = chargerThemes(true), f = c.familles!();
  assert.deepEqual(f.map((x) => x.id), ['enavant', 'odin', 'hestia', 'evenements']);
  assert.deepEqual(f.map((x) => x.ids.length), [6, 32, 31, 16]);
  const tous = f.flatMap((x) => x.ids);
  assert.equal(tous.length, 85); assert.equal(new Set(tous).size, 85, 'aucun identifiant en double');
  assert.equal(Object.keys(c.THEMES).length, 85);
  const couples = f.flatMap((x) => x.ids.map((id) => `${x.id}|${c.THEMES[id].name}`));
  assert.equal(new Set(couples).size, 85, 'aucun couple (famille, nom) en double');
  const hestia = f[2].ids;
  assert.deepEqual(hestia, Object.keys(LIBELLES_MAISON).map((id) => `h-${id}`));
  // Les noms : ceux de son Odin aujourd'hui (l'appli de l'écran de la maison), rien n'est renommé ; clair ou sombre pareil.
  for (const id of hestia) {
    assert.equal(c.THEMES[id].name, LIBELLES_MAISON[id.slice(2)].label, `${id} : nom`);
    assert.equal(c.THEMES[id].dark, LIBELLES_MAISON[id.slice(2)].dark, `${id} : clair ou sombre`);
  }
  // Six noms existent dans deux familles (la famille est toujours affichée à côté).
  const ailleurs = new Set(f.filter((x) => x.id !== 'hestia').flatMap((x) => x.ids.map((id) => c.THEMES[id].name)));
  assert.deepEqual(hestia.map((id) => c.THEMES[id].name).filter((n) => ailleurs.has(n)).sort(), ['Aurore boréale', 'Coucher de soleil', 'Désert', 'Espace', 'Neige', 'Néon'].sort());
  assert.equal(c.ORDER.length, 33, 'ORDER ne bouge pas (fenetre.js le lit)');
});

test('Hestia : à plat, fond uni dans la zone de travail, et les décors dessinés de l\'écran de la maison sont gardés', () => {
  const T = tableMaison<Hestia>('T'), DECOR = tableMaison<string>('DECOR'), c = chargerThemes(true), m = c.maquette!;
  let avecDecor = 0;
  for (const [id, h] of Object.entries(T)) {
    const t = c.THEMES[`h-${id}`], v = m.THEMES[`h-${id}`];
    assert.equal(t.panel, v.solid, `h-${id} : panneau = carte pleine`);
    assert.equal(t.ink, v.ink); assert.equal(t.accent, v.accent); assert.equal(t.mascot, v.mascot); assert.equal(t.dark, v.dark);
    assert.ok(t.sky?.length === 2 && t.sky.every((x) => /^#[0-9a-fA-F]{6}$/.test(x)), `h-${id} : fond`);
    c.apply(`h-${id}`);
    const css = styleDuTheme(c);
    assert.match(css, /:root\[data-odin-theme\] main\{[^}]*background:var\(--bg\)/, `h-${id} : fond uni`);
    if (h.decor) {
      avecDecor++;
      assert.equal(t.decor, DECOR[h.decor], `h-${id} : le décor ${h.decor} de l'écran de la maison`);
      assert.ok(css.includes(encodeURIComponent('viewBox=\'0 -30 960 150\'')), `h-${id} : dessiné dans son cadre`);
    } else assert.equal(t.decor, undefined, `h-${id} : sans décor`);
  }
  assert.equal(avecDecor, 13);
  // Le fond à plat : la première et la dernière couleur de la dernière couche (deux fois la même pour une couleur unie).
  assert.deepEqual(c.THEMES['h-verre'].sky, ['#15171d', '#15171d']);
  assert.deepEqual(c.THEMES['h-crepuscule'].sky, ['#26324a', '#0f131a']);
  assert.deepEqual(c.THEMES['h-espace'].sky, ['#2b1b5e', '#05030f']);
  assert.deepEqual(c.THEMES['h-clair'].sky, ['#eef1f5', '#eef1f5']);
  // Les thèmes d'Odin gardent leur cadre de dessin.
  c.apply('neige');
  assert.ok(styleDuTheme(c).includes(encodeURIComponent('viewBox=\'0 0 256 170\'')));
});

test('Apparence : les thèmes de Hestia se choisissent par identifiant ; un nom pris deux fois ne choisit rien (Odin demande)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-themes-'));
  const v = new Valhalla(home, [apparence], { notify: async () => {} });
  try {
    const choisir = async (t: string) => ((await v.act('apparence', 'theme', { theme: t })).data as { theme: string }).theme;
    assert.equal(await choisir('h-clair'), 'h-clair');
    assert.equal(((await v.act('apparence', 'etat', {})).data as { name: string }).name, 'Clair', 'gardé');
    assert.equal(await choisir('h-neige'), 'h-neige');
    assert.equal(await choisir('h-espace'), 'h-espace');
    // En parlant, un nom pris deux fois ne choisit plus le premier : Odin demande lequel (lot 11, test/themes-parole.test.ts).
    for (const nom of ['Neige', 'Néon', 'Coucher de soleil', 'Espace', 'Désert', 'Aurore boréale']) assert.equal(await choisir(nom), undefined, nom);
    assert.equal(((await v.act('apparence', 'etat', {})).data as { theme: string }).theme, 'h-espace', 'rien n\'a changé');
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('Réglages → Apparence : la ligne d\'état d\'un thème de Hestia dit aussi sa famille (un nom pris deux fois se distingue)', () => {
  // Une page factice où la carte Apparence existe déjà (grille faite) ; le thème gardé vient du navigateur.
  const ligne = (theme: string) => {
    const why = { textContent: '' };
    const card = { querySelector: (q: string) => (q === '#themeGrid' ? { querySelectorAll: () => [] } : q === '#themeWhy' ? why : null), querySelectorAll: () => [] };
    const element = () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
    const document = {
      readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
      head: { append() {} }, createElement: () => element(),
      querySelector: (q: string) => (q === 'article.card[data-sec="apparence"]' ? card : null), querySelectorAll: () => [], addEventListener() {}, getElementById: () => null,
    };
    const window: Record<string, unknown> = { OdinThemes: {}, addEventListener() {} };
    const garde = JSON.stringify({ mode: 'fixe', theme });
    const ctx = vm.createContext({ window, document, localStorage: { getItem: () => garde, setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), console, navigator: {} });
    (window as { window?: unknown }).window = window;
    vm.runInContext(readFileSync(CATALOGUE, 'utf8'), ctx);
    vm.runInContext(source, ctx);
    return why.textContent;
  };
  assert.equal(ligne('h-desert'), 'Choisi : Désert · Thèmes de Hestia.');
  assert.equal(ligne('h-verre'), 'Choisi : Verre sombre (tuiles colorées) · Thèmes de Hestia.');
  // Les thèmes d'avant gardent leur ligne d'aujourd'hui.
  assert.equal(ligne('desert'), 'Choisi : Désert.');
  assert.equal(ligne('vitre'), 'Choisi : Vitre.');
});
