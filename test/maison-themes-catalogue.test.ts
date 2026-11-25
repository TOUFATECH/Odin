// L'écran de la maison (/maison) lit ses 31 thèmes dans le catalogue (src/web/pages/themes-catalogue.js) : une seule
// source, plus de copie dans src/web/maison.js. Rien ne change à l'écran.
// La règle des identifiants : sur /maison, un identifiant sans préfixe est d'abord un thème de Hestia. Quatorze
// identifiants sont aussi ceux d'un thème d'Odin ou d'un thème fait main du catalogue ; l'ancien réglage (gardé par
// Hestia) et l'ancien choix d'une tablette (gardé dans son navigateur) rendent le même thème de Hestia qu'hier.
// - Un vrai Odin d'essai (dossier temporaire) sert /maison, le catalogue et /api/maison/etat.
// - Le chargement de la page (maison.js : ses thèmes et load) tourne dans un bac à sable avec un faux document.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
const CATALOGUE = readFileSync(new URL('../src/web/pages/themes-catalogue.js', import.meta.url), 'utf8');

// Un de ces quatorze identifiants est aussi un nom de lieu des données d'exemple de la maquette de l'accueil : le
// garde-fou (donnees-exemple.test.ts) ne le laisse pas écrit en clair dans les fichiers de ce chantier. Il est donc noté
// ici par son empreinte SHA-256 et retrouvé parmi les thèmes de Hestia du catalogue : exactement un identifiant doit
// avoir cette empreinte, sinon l'essai échoue. Ses valeurs d'hier restent écrites en clair, comme les treize autres.
function idParEmpreinte(e: string): string {
  const hestia = vm.runInNewContext(`${CATALOGUE}; window.OdinCatalogueThemes.HESTIA`, { window: {} }) as Record<string, unknown>;
  const ids = Object.keys(hestia).filter((id) => createHash('sha256').update(id, 'utf8').digest('hex') === e);
  assert.equal(ids.length, 1, `le thème de Hestia d'empreinte ${e.slice(0, 12)}… est dans le catalogue, une seule fois`);
  return ids[0];
}
const ID_LAGON = idParEmpreinte('6f7079e2578772196e68c87779b2c70de25f64fdfbd423f8882fc0f39b2aa297');

// Les quatorze identifiants qui portent deux thèmes, et ce que l'écran de la maison en montrait hier (relevé dans
// maison.js avant ce changement) : fond, texte, accent, clair ou sombre, décor dessiné.
const HIER: Record<string, [string, string, string, 'light' | 'dark', string | undefined]> = {
  nuit: ['#070d1a', '#e8eefc', '#4c8dff', 'dark', undefined],
  aurore: ['#0f0d1a', '#f3f0ff', '#f59e0b', 'dark', undefined],
  lagon: ['#0b4f5c', '#f2fbfc', '#ffd23f', 'dark', undefined],
  clair: ['#eef1f5', '#18202a', '#e8590c', 'light', undefined],
  ocean: ['#0a1f3d', '#eaf3ff', '#5ab0ff', 'dark', 'vagues'],
  foret: ['#0a1d13', '#eafaf0', '#5fd38d', 'dark', undefined],
  plage: ['#bfe9ff', '#0d3a4a', '#087f8f', 'light', 'palmiers'],
  [ID_LAGON]: ['#bff3f0', '#063b44', '#0b7d8f', 'light', 'lagon'],
  coucher: ['#2b1747', '#fff1e8', '#ffb380', 'dark', 'soleil'],
  montagne: ['#d9e2ec', '#1d2a38', '#2f5f91', 'light', 'montagnes'],
  desert: ['#f9e6c4', '#4a2a10', '#a5550f', 'light', 'dunes'],
  neige: ['#eef5fc', '#13304d', '#1f6ab0', 'light', 'neige'],
  neon: ['#0b0418', '#fbe9ff', '#2de2e6', 'dark', 'neon'],
  espace: ['#05030f', '#efeaff', '#b39dff', 'dark', 'planetes'],
};

// ---------- Lire maison.js : un bloc qui finit par « } » à deux espaces ----------
function bloc(debut: string): string {
  const i = MAISON.indexOf(`  ${debut}`); assert.ok(i >= 0, `maison.js : « ${debut} » introuvable`);
  const f = MAISON.indexOf('\n  }', i); assert.ok(f > i, `maison.js : fin de « ${debut} » introuvable`);
  const fin = MAISON.indexOf('\n', f + 1);
  return MAISON.slice(i, fin < 0 ? undefined : fin);
}
/** Les thèmes de la page : du titre « Thèmes » jusqu'à la fin du style commun (BASE). */
function themes(): string {
  const i = MAISON.indexOf('  // ---------- Thèmes'); assert.ok(i >= 0, 'maison.js : la partie des thèmes');
  const b = MAISON.indexOf('const BASE = `', i); assert.ok(b > i, 'maison.js : le style commun');
  const f = MAISON.indexOf('`;\n', b + 14); assert.ok(f > b, 'maison.js : fin du style commun');
  return MAISON.slice(i, f + 2);
}

type Etat = Record<string, unknown> & { ok: boolean; rights: string; theme: string };
/**
 * La page qui se charge avec cet état (load de maison.js), dans un bac à sable : le catalogue d'abord (comme la page le
 * charge), puis maison.js. `retouche` change le catalogue avant maison.js (pour voir d'où viennent les couleurs).
 * Rend les variables posées (--bg, --text…), le ton (color-scheme) et le décor du fond.
 */
async function pageChargee(e: Etat, garde: string | null, retouche?: (c: { HESTIA: Record<string, Record<string, unknown>> }) => void, sansCatalogue = false) {
  const vars: Record<string, string> = {};
  const noeud = () => ({ textContent: '', style: {} as Record<string, string>, setAttribute() {}, append() {}, addEventListener() {} });
  const corps = { style: { setProperty: (k: string, v: string) => { vars[k] = v; } } };
  const document = { head: { append() {} }, body: corps, createElement: noeud, createElementNS: (_: string, t: string) => noeud(), createTextNode: (t: string) => ({ nodeType: 3, t }), querySelector: () => null, querySelectorAll: () => [] };
  const window: Record<string, unknown> = {};
  const ctx = vm.createContext({ window, document, localStorage: { getItem: (k: string) => (k === 'odin.maison.theme' ? garde : null), setItem() {} } });
  if (!sansCatalogue) vm.runInContext(CATALOGUE, ctx);
  if (retouche) retouche(window.OdinCatalogueThemes as { HESTIA: Record<string, Record<string, unknown>> });
  const src = [
    'let D = null, glisse = false, first = false; const seen = new Set();',
    'const nuit = { cacher() {}, montrer() {} }, pet = { say() {} }, draw = () => {}, hello = () => \'\';',
    'const api = async () => ETAT, act = async () => ({ ok: true });',
    bloc('const el = ('), themes(), bloc('async function load() {'), bloc('function themesView() {'),
    '({ load, css, themesView });',
  ].join('\n');
  const page = vm.runInContext(`ETAT = ${JSON.stringify(e)};\n${src}`, ctx) as { load: () => Promise<void>; css: { textContent: string }; themesView: () => unknown[] };
  await page.load();
  const t = page.css.textContent;
  const lire = (k: string) => new RegExp(`--${k}:([^;]+);`).exec(t)?.[1];
  return { bg: lire('bg'), text: lire('text'), accent: lire('accent'), ton: /color-scheme:(light|dark)/.exec(t)?.[1], decor: vars['--decor'], style: t, themesView: page.themesView };
}
/** Le décor tel que maison.js le pose : « none », ou le dessin du catalogue dans son cadre. */
function verifierDecor(id: string, decor: string | undefined, cle: string | undefined) {
  const DECORS = (vm.runInNewContext(`${CATALOGUE}; window.OdinCatalogueThemes.DECORS`, { window: {} }) as Record<string, string>);
  if (!cle) { assert.equal(decor, 'none', `${id} : sans décor, comme hier`); return; }
  assert.ok(decor?.includes(encodeURIComponent('viewBox=\'0 -30 960 150\'')), `${id} : dessiné dans son cadre`);
  assert.ok(decor?.includes(encodeURIComponent(DECORS[cle].replace(/"/g, '\''))), `${id} : le décor « ${cle} », comme hier`);
}
/** Le même thème de Hestia qu'hier, lu dans le catalogue (un catalogue retouché change l'écran : plus de copie). */
async function memeQuHier(id: string, e: Etat, garde: string | null) {
  const [bg, text, accent, ton, decor] = HIER[id];
  const p = await pageChargee(e, garde);
  assert.deepEqual([p.bg, p.text, p.accent, p.ton], [bg, text, accent, ton], `${id} : le thème de Hestia d'hier`);
  verifierDecor(id, p.decor, decor);
  // Le thème fait main ou d'Odin du même identifiant n'est pas pris (Néon et Maison claire sont dans le catalogue).
  const autre = (vm.runInNewContext(`${CATALOGUE}; window.OdinCatalogueThemes.THEMES`, { window: {} }) as Record<string, { bg?: string; ink?: string }>)[id];
  if (autre) assert.notEqual(p.text === autre.ink && p.bg === autre.bg, true, `${id} : pas le thème du catalogue du même nom`);
  const r = await pageChargee(e, garde, (c) => { c.HESTIA[id] = { ...c.HESTIA[id], bg: '#123456', text: '#654321' }; });
  assert.deepEqual([r.bg, r.text], ['#123456', '#654321'], `${id} : lu dans le catalogue, pas dans une copie`);
}

// ---------- Un vrai Odin d'essai ----------
const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, cle = '';
const SANS_SESSION = { cookie: '' };
before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'midgard', 'apparence'].includes(m.id)) });
  cle = ((await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: 'Tablette 1', droits: 'maison' })).data as { key: string }).key;
});
after(async () => { await tt.end(); Object.assign(console, orig); });
const etat = async (h: Record<string, string>) => { const r = await v.json('/api/maison/etat', undefined, h); assert.equal(r.status, 200); return r.body as Etat; };

test('la page se charge avec une clé de tablette, sans session : le catalogue arrive avant maison.js, servi sans session', async () => {
  const r = await fetch(`${v.url}/maison`, { headers: SANS_SESSION });
  assert.equal(r.status, 200);
  const html = await r.text(), nonce = /<script nonce="([^"]+)" src="\/maison\.js">/.exec(html)?.[1];
  assert.ok(nonce, 'maison.js est chargé');
  const i = html.indexOf(`<script nonce="${nonce}" src="/pages/themes-catalogue.js"></script>`);
  assert.ok(i >= 0, 'le catalogue des thèmes est chargé, avec le nonce de la page');
  assert.ok(i < html.indexOf('src="/maison.js"'), 'avant maison.js');
  const c = await fetch(`${v.url}/pages/themes-catalogue.js`, { headers: SANS_SESSION });
  assert.equal(c.status, 200, 'servi sans session');
  assert.match(String(c.headers.get('content-type')), /javascript/);
  assert.match(await c.text(), /window\.OdinCatalogueThemes/);
  const e = await etat({ ...SANS_SESSION, 'x-odin-maison': cle });
  assert.equal(e.rights, 'maison', 'la tablette entre avec sa clé, sans session');
});

test('maison.js n\'a plus de copie : ni table de thèmes, ni table de décors ; il les lit dans le catalogue', () => {
  assert.doesNotMatch(MAISON, /const T = \{/, 'plus de table de thèmes');
  assert.doesNotMatch(MAISON, /const DECOR = \{/, 'plus de table de décors');
  assert.match(themes(), /OdinCatalogueThemes/);
});

// Côté Hestia : le réglage gardé par Hestia (rangé par l'écran avec la session) ; la page le lit tel quel.
for (const id of Object.keys(HIER)) {
  test(`côté Hestia : le réglage « ${id} » rend le même thème de Hestia qu'hier`, async () => {
    assert.equal((await v.json('/api/maison/theme', { theme: id })).body.ok, true, 'rangé par l\'écran (session)');
    assert.equal(valhallaOf()!.ctx('gladsheim').settings.theme, id, 'rangé tel quel, sans préfixe');
    const e = await etat({});
    assert.equal(e.rights, 'complet'); assert.equal(e.theme, id);
    await memeQuHier(id, e, 'verre'); // le choix d'une tablette ne compte pas pour la session
  });
}

// Côté tablette : le choix gardé dans le navigateur (localStorage « odin.maison.theme ») passe avant le réglage.
for (const id of Object.keys(HIER)) {
  test(`côté tablette : le choix gardé « ${id} » rend le même thème de Hestia qu'hier`, async () => {
    const e = await etat({ ...SANS_SESSION, 'x-odin-maison': cle });
    assert.equal(e.rights, 'maison');
    await memeQuHier(id, e, id);
  });
}

// Si le catalogue ne se charge pas (réseau coupé, vieux cache d'une tablette), l'écran garde un style lisible au lieu de
// variables « undefined », et la section Thèmes s'ouvre sans erreur. Avant, maison.js ne dépendait d'aucun autre script.
test('sans le catalogue, la page garde un style de secours lisible et la section Thèmes s\'ouvre', async () => {
  const e = await etat({ ...SANS_SESSION, 'x-odin-maison': cle });
  for (const garde of ['ocean', 'verre', null]) {
    const p = await pageChargee(e, garde, undefined, true);
    assert.doesNotMatch(p.style, /undefined/, `${garde} : aucune variable « undefined »`);
    for (const k of ['bg', 'text', 'accent']) assert.match(String(p[k as 'bg']), /^#[0-9a-f]{6}$/, `${garde} : --${k} est une couleur`);
    assert.equal(p.ton, 'dark');
    assert.equal(p.decor, 'none', 'sans décor');
    assert.ok(Object.keys(e.themes as object).length > 0, 'la liste des thèmes vient du serveur');
    assert.doesNotThrow(() => p.themesView(), 'la section Thèmes s\'ouvre');
  }
});
