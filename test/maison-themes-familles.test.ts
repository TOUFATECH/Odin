// L'écran de la maison (/maison), page « Thèmes » : les quatre familles de Réglages → Apparence (« Mis en avant », dont
// « Home Assistant » et « Maison claire » ; « Les thèmes d'Odin » ; « Thèmes de Hestia » ; « Événements de l'année »),
// dans le même ordre, sous les mêmes titres, avec les mêmes thèmes et les mêmes noms.
// Les données des thèmes d'Odin et des événements sont dans le catalogue (src/web/pages/themes-catalogue.js), lues par
// themes.js et par l'écran de la maison ; la règle de la maquette (fromOdin) en tire tous les champs d'un thème.
// Deux réglages restent, un par écran : le thème de l'écran de la maison (gardé par Hestia, ou dans le navigateur
// d'une tablette) et celui d'Odin (gardé par Apparence) ne se touchent pas.
// La règle des identifiants (écrite une fois dans maison.js) : sur /maison, un identifiant sans préfixe est d'abord un
// thème de Hestia ; un thème de la liste d'Odin y est rangé avec le préfixe « o- » (« o-ha », « o-clair »).
// - Un vrai Odin d'essai (dossier temporaire) sert /api/maison/etat et /api/maison/theme.
// - Le chargement de la page (maison.js : ses thèmes, load et la section Thèmes) tourne dans un bac à sable.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import * as Hestia from '../src/valhalla/modules/gladsheim.ts';
import { FAMILLES, THEME_NAMES, familleDe } from '../src/valhalla/modules/apparence.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
const CATALOGUE = readFileSync(new URL('../src/web/pages/themes-catalogue.js', import.meta.url), 'utf8');
const THEMES_JS = readFileSync(new URL('../src/web/themes.js', import.meta.url), 'utf8');
type Odin = { name: string; dark: boolean; sky: string[] | null; panel: string | null; ink: string | null; accent: string | null; mascot: string | null; decor: string };
type Cat = { NOMS: Record<string, string>; THEMES: Record<string, Record<string, unknown>>; HESTIA: Record<string, Record<string, unknown>>; ODIN: Record<string, Odin>; EVENEMENTS: Record<string, Odin>; fromOdin: (t: Odin, grp: string) => Record<string, unknown> };
const cat = () => vm.runInNewContext(`${CATALOGUE}; window.OdinCatalogueThemes`, { window: {} }) as Cat;
/** La liste de l'écran de la maison (gladsheim.ts), lue sans casser tout le fichier si elle manque. */
const listeMaison = () => (Hestia as unknown as { THEMES_MAISON?: Record<string, { label: string }> }).THEMES_MAISON ?? {};

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
type Noeud = { nodeType: number; tag: string; attrs: Record<string, string>; kids: Array<Noeud | { nodeType: 3; t: string }>; style: Record<string, string>; textContent: string };
const texte = (n: Noeud | { nodeType: 3; t: string }): string => (n.nodeType === 3 ? (n as { t: string }).t : (n as Noeud).kids.map(texte).join(''));
const tous = (n: Noeud, tag: string): Noeud[] => [...(n.tag === tag ? [n] : []), ...n.kids.filter((k): k is Noeud => k.nodeType === 1).flatMap((k) => tous(k, tag))];

type Etat = Record<string, unknown> & { ok: boolean; rights: string; theme: string; themes: Record<string, string> };
/** La page chargée avec cet état et ce choix gardé sur l'appareil ; `retouche` change le catalogue avant maison.js. */
async function pageChargee(e: Etat, garde: string | null, retouche?: (c: Cat) => void, sansCatalogue = false) {
  const noeud = (tag: string): Noeud => { const n: Noeud = { nodeType: 1, tag, attrs: {}, kids: [], style: {}, textContent: '' }; return Object.assign(n, { setAttribute: (k: string, v: string) => { n.attrs[k] = v; }, append: (...k: Noeud[]) => { n.kids.push(...k); }, addEventListener() {} }); };
  const vars: Record<string, string> = {};
  const document = { head: { append() {} }, body: { style: { setProperty: (k: string, v: string) => { vars[k] = v; } } }, createElement: noeud, createElementNS: (_: string, t: string) => noeud(t), createTextNode: (t: string) => ({ nodeType: 3, t }), querySelector: () => null, querySelectorAll: () => [] };
  const window: Record<string, unknown> = {};
  const gardes: Record<string, string> = {};
  const ctx = vm.createContext({ window, document, localStorage: { getItem: (k: string) => (k === 'odin.maison.theme' ? garde : null), setItem: (k: string, v: string) => { gardes[k] = v; } } });
  if (!sansCatalogue) vm.runInContext(CATALOGUE, ctx);
  if (retouche) retouche(window.OdinCatalogueThemes as Cat);
  const src = [
    'let D = null, glisse = false, first = false; const seen = new Set();',
    'const nuit = { cacher() {}, montrer() {} }, pet = { say() {} }, draw = () => {}, hello = () => \'\';',
    'const api = async () => ETAT, act = async () => ({ ok: true });',
    bloc('const el = ('), themes(), bloc('async function load() {'), bloc('function themesView() {'),
    '({ load, css, themesView });',
  ].join('\n');
  const page = vm.runInContext(`ETAT = ${JSON.stringify(e)};\n${src}`, ctx) as { load: () => Promise<void>; css: { textContent: string }; themesView: () => Noeud[] };
  await page.load();
  const t = page.css.textContent, lire = (k: string) => new RegExp(`--${k}:([^;]+);`).exec(t)?.[1];
  return { bg: lire('bg'), bg2: lire('bg2'), text: lire('text'), accent: lire('accent'), ton: /color-scheme:(light|dark)/.exec(t)?.[1], decor: vars['--decor'], style: t, vue: () => page.themesView(), gardes };
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
const reglageMaison = () => valhallaOf()!.ctx('gladsheim').settings.theme;
const reglageOdin = () => valhallaOf()!.ctx('apparence').settings.theme;
// La seule exception à « la liste de /maison = celle de Réglages » (décision du propriétaire, comme la maquette, qui ne
// transforme que les thèmes qui ont un ciel) : « Valhalla (classique) », le thème d'origine d'Odin, n'a pas de ciel ;
// il reste dans Réglages → Apparence, il n'est pas un thème de l'écran de la maison.
const HORS_MAISON = ['valhalla'];
/** Réglages → Apparence moins l'exception : [famille, [identifiant d'Odin, nom]]. */
const reglagesMaison = () => FAMILLES.map((f) => [f.id, f.ids.filter((id) => !HORS_MAISON.includes(id)).map((id) => [id, THEME_NAMES[id]])]);
const TOTAL_MAISON = () => FAMILLES.reduce((n, f) => n + f.ids.filter((id) => !HORS_MAISON.includes(id)).length, 0);
const EN_AVANT = FAMILLES.find((f) => f.id === 'enavant')!.ids;
const HESTIA_ODIN = FAMILLES.find((f) => f.id === 'hestia')!.ids;

test('mêmes identifiants partout : le catalogue, apparence.ts et la liste de l\'écran de la maison (gladsheim.ts)', () => {
  const l = listeMaison(), c = cat(), ids = Object.keys(l);
  assert.ok(ids.length > 0, 'gladsheim.ts publie la liste de l\'écran de la maison');
  const avecO = ids.filter((k) => k.startsWith('o-')), sans = ids.filter((k) => !k.startsWith('o-'));
  assert.equal(ids.length, avecO.length + sans.length);
  // Les thèmes de Hestia : sans préfixe sur /maison (l'ancien réglage), « h-… » dans Odin, sans préfixe dans le catalogue.
  assert.deepEqual(sans, Object.keys(Hestia.THEMES), 'les 31 de Hestia, sans préfixe, dans le même ordre');
  assert.equal(sans.length, 31);
  assert.deepEqual(sans.map((k) => `h-${k}`), HESTIA_ODIN, 'les mêmes que la famille « Thèmes de Hestia » d\'Odin');
  assert.deepEqual(sans, Object.keys(c.HESTIA), 'les mêmes que dans le catalogue');
  // Les trois autres familles : « o- » + l'identifiant d'Odin, comme dans Réglages et dans le catalogue.
  for (const k of sans) assert.equal(l[k].label, THEME_NAMES[`h-${k}`], `${k} : même nom dans Odin`);
  for (const k of avecO) assert.equal(l[k].label, THEME_NAMES[k.slice(2)], `${k} : même nom dans Odin`);
  assert.equal(l['o-ha']?.label, 'Home Assistant'); assert.equal(l['o-clair']?.label, 'Maison claire');
});

/** Les familles du catalogue, rangées comme themes.js les range pour Réglages : [famille, [identifiant d'Odin, nom]]. */
function famillesCatalogue(c: Cat): Array<[string, Array<[string, string]>]> {
  const enAvant = Object.keys(c.THEMES).filter((k) => !k.startsWith('h-'));
  return [
    ['enavant', enAvant.map((k) => [k, c.NOMS[k]])],
    ['odin', Object.keys(c.ODIN ?? {}).filter((k) => !enAvant.includes(k)).map((k) => [k, c.ODIN[k].name])],
    ['hestia', Object.keys(c.HESTIA).map((k) => [`h-${k}`, c.NOMS[`h-${k}`]])],
    ['evenements', Object.keys(c.EVENEMENTS ?? {}).map((k) => [k, c.EVENEMENTS[k].name])],
  ];
}
/** La liste de /maison (gladsheim.ts) rangée par familles de Réglages : sans préfixe → h-…, « o-x » → x. */
const famillesMaison = (): Array<[string, Array<[string, string]>]> => {
  const l = listeMaison(), odin = (k: string) => (k.startsWith('o-') ? k.slice(2) : `h-${k}`);
  return FAMILLES.map((f) => [f.id, Object.keys(l).filter((k) => familleDe(odin(k)) === f.id).map((k) => [odin(k), l[k].label])]);
};

test('la liste de /maison égale celle de Réglages moins « Valhalla (classique) », famille par famille, thème par thème, nom par nom (catalogue, apparence.ts, gladsheim.ts)', () => {
  const reglages = FAMILLES.map((f) => [f.id, f.ids.map((id) => [id, THEME_NAMES[id]])]);
  assert.deepEqual(famillesMaison(), reglagesMaison(), 'gladsheim.ts = apparence.ts moins l\'exception');
  assert.deepEqual(famillesCatalogue(cat()), reglages, 'le catalogue = apparence.ts, en entier');
  assert.deepEqual(FAMILLES.map((f) => f.id), ['enavant', 'odin', 'hestia', 'evenements'], 'quatre familles, dans l\'ordre de Réglages');
  // Réglages garde « Valhalla (classique) » (famille « Les thèmes d'Odin ») ; /maison ne l'a pas.
  assert.ok(FAMILLES.find((f) => f.id === 'odin')!.ids.includes('valhalla'), 'Réglages garde Valhalla');
  assert.equal(THEME_NAMES.valhalla, 'Valhalla (classique)');
  assert.ok(!Object.hasOwn(listeMaison(), 'o-valhalla'), '/maison ne liste pas Valhalla');
  assert.ok(!Object.values(listeMaison()).some((x) => x.label === 'Valhalla (classique)'), 'ni sous un autre identifiant');
  const total = FAMILLES.reduce((n, f) => n + f.ids.length, 0);
  assert.equal(Object.keys(listeMaison()).length, total - HORS_MAISON.length, `les ${total} thèmes de Réglages moins l'exception, pas un de plus`);
  assert.equal(Object.keys(listeMaison()).length, TOTAL_MAISON());
  // Dans l'ordre de Réglages : les familles se suivent dans la liste envoyée à l'écran.
  assert.deepEqual(Object.keys(listeMaison()).map((k) => (k.startsWith('o-') ? k.slice(2) : `h-${k}`)), FAMILLES.flatMap((f) => f.ids).filter((id) => !HORS_MAISON.includes(id)));
});

test('l\'écran reçoit la liste entière (avec une clé de tablette comme avec la session), et Hestia l\'accepte', async () => {
  for (const h of [{ ...SANS_SESSION, 'x-odin-maison': cle }, {}]) {
    const e = await etat(h);
    assert.deepEqual(Object.keys(e.themes), Object.keys(listeMaison()), `${e.rights} : la liste entière`);
    assert.equal(e.themes['o-ha'], 'Home Assistant'); assert.equal(e.themes['o-clair'], 'Maison claire'); assert.equal(e.themes.nuit, 'Bleu nuit');
    assert.ok(!Object.hasOwn(e.themes, 'o-valhalla'), `${e.rights} : pas de « Valhalla (classique) »`);
  }
  const r = await valhallaOf()!.act('gladsheim', 'theme', { theme: 'o-ha' });
  assert.equal(r.ok, true); assert.match(r.text, /Home Assistant/); assert.equal(reglageMaison(), 'o-ha');
  const view = await valhallaOf()!.module('gladsheim')!.view(valhallaOf()!.ctx('gladsheim'), new URLSearchParams()) as unknown as { subtitle: string; side: Array<{ action: string; params: Array<{ options: string[] }> }> };
  assert.match(view.subtitle, /Thème « Home Assistant »/, 'Odin → Hestia dit le thème choisi');
  const options = view.side.find((x) => x.action === 'theme')!.params[0].options;
  assert.ok(options.includes('o-clair'), 'le choix dans Odin → Hestia propose la liste entière');
  assert.deepEqual(options, Object.keys(listeMaison()), 'la liste de /maison, sans « o-valhalla »');
  // L'ancien réglage reste lisible et accepté ; un identifiant inconnu, un thème de Hestia déguisé, ou « Valhalla
  // (classique) » (pas de ciel : pas un thème de cet écran), ne l'est pas.
  assert.equal((await valhallaOf()!.act('gladsheim', 'theme', { theme: 'nuit' })).ok, true); assert.equal(reglageMaison(), 'nuit');
  for (const x of ['o-inconnu', 'o-h-verre', 'o-', 'o-nuit-claire', 'o-valhalla']) assert.equal((await valhallaOf()!.act('gladsheim', 'theme', { theme: x })).ok, false, `${x} refusé`);
  assert.equal((await v.json('/api/maison/theme', { theme: 'o-valhalla' })).body.ok, false, 'o-valhalla refusé par la route de /maison aussi');
  assert.equal(reglageMaison(), 'nuit');
});

test('deux réglages, un par écran : un thème d\'Odin choisi sur /maison ne change pas le thème d\'Odin, et l\'inverse', async () => {
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: 'glace' })).ok, true); assert.equal(reglageOdin(), 'glace');
  assert.equal((await v.json('/api/maison/theme', { theme: 'o-ha' })).body.ok, true, 'choisi sur /maison avec la session');
  assert.equal(reglageMaison(), 'o-ha'); assert.equal(reglageOdin(), 'glace', 'le thème d\'Odin ne bouge pas');
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: 'clair' })).ok, true, 'Maison claire choisi pour Odin');
  assert.equal(reglageOdin(), 'clair'); assert.equal(reglageMaison(), 'o-ha', 'le thème de l\'écran de la maison ne bouge pas');
  assert.equal((await v.json('/api/maison/theme', { theme: 'clair' })).body.ok, true, 'le « clair » de Hestia sur /maison');
  assert.equal(reglageMaison(), 'clair'); assert.equal(reglageOdin(), 'clair');
  const e = await etat({}); assert.equal(e.theme, 'clair');
  const p = await pageChargee(e, 'o-ha');
  assert.deepEqual([p.text, p.ton], ['#18202a', 'light'], 'avec la session, le « clair » sans préfixe reste celui de Hestia (le choix d\'une tablette ne compte pas)');
});

test('une tablette « maison » ne peut toujours pas changer le thème gardé par Hestia, même vers un thème de la liste d\'Odin', async () => {
  assert.equal((await v.json('/api/maison/theme', { theme: 'verre' })).body.ok, true); assert.equal(reglageMaison(), 'verre');
  for (const x of ['o-ha', 'o-clair', 'nuit']) {
    const r = await v.json('/api/maison/theme', { theme: x }, { ...SANS_SESSION, 'x-odin-maison': cle });
    assert.match(String(r.body.text), /depuis Odin/, `${x} : refusé à la tablette`);
  }
  assert.equal(reglageMaison(), 'verre');
});

test('une tablette garde son choix : « Home Assistant » et « Maison claire » s\'appliquent depuis le catalogue', async () => {
  const e = await etat({ ...SANS_SESSION, 'x-odin-maison': cle });
  assert.equal(e.rights, 'maison'); assert.equal(e.theme, 'verre');
  const c = cat();
  for (const [id, ton] of [['o-ha', 'dark'], ['o-clair', 'light'], ['o-glace', 'light'], ['o-vitre', 'dark']] as const) {
    const p = await pageChargee(e, id), t = c.THEMES[id.slice(2)];
    assert.deepEqual([p.text, p.accent, p.ton, p.bg2], [t.ink, t.accent, ton, t.bg], `${id} : le thème du catalogue, gardé par la tablette`);
    assert.match(String(p.bg), /^#[0-9a-f]{6}$/i, `${id} : --bg est une couleur (la barre du navigateur la prend)`);
    assert.doesNotMatch(p.style, /undefined/, `${id} : aucune variable vide`);
    assert.equal(p.decor, 'none', `${id} : pas de décor dessiné de Hestia`);
    const r = await pageChargee(e, id, (x) => { x.THEMES[id.slice(2)] = { ...x.THEMES[id.slice(2)], ink: '#654321' }; });
    assert.equal(r.text, '#654321', `${id} : lu dans le catalogue, pas dans une copie`);
  }
  // Sans préfixe, c'est toujours le thème de Hestia (règle des identifiants) ; un « o- » inconnu donne le thème de départ.
  assert.equal((await pageChargee(e, 'clair')).text, '#18202a');
  const inconnu = await pageChargee(e, 'o-inconnu'), verre = await pageChargee(e, 'verre');
  assert.deepEqual([inconnu.bg, inconnu.text], [verre.bg, verre.text]);
});

test('la page « Thèmes » de l\'écran de la maison : les quatre familles de Réglages, dont « Home Assistant » et « Maison claire »', async () => {
  const e = await etat({ ...SANS_SESSION, 'x-odin-maison': cle });
  const p = await pageChargee(e, 'o-ha'), racine = { nodeType: 1, tag: 'racine', attrs: {}, kids: p.vue(), style: {}, textContent: '' } as Noeud;
  // Les quatre familles de Réglages → Apparence, dans son ordre et sous ses titres, chacune avec ses thèmes et leurs noms.
  assert.deepEqual(tous(racine, 'h3').map(texte), FAMILLES.map((f) => f.titre), 'les quatre familles, titres et ordre de Réglages');
  const blocs = (racine.kids as Noeud[]).filter((k) => k.attrs.class === 'themes');
  assert.equal(blocs.length, 4);
  reglagesMaison().forEach(([, ts], n) => assert.deepEqual(tous(blocs[n], 'button').map(texte), (ts as Array<[string, string]>).map(([, nom]) => nom), `« ${FAMILLES[n].titre} » : mêmes thèmes, mêmes noms, même ordre (moins Valhalla)`));
  const boutons = tous(racine, 'button'), noms = boutons.map(texte);
  assert.equal(boutons.length, Object.keys(e.themes).length, 'chaque thème de la liste a sa carte');
  assert.equal(boutons.length, TOTAL_MAISON());
  assert.ok(!noms.includes('Valhalla (classique)'), '« Valhalla (classique) » n\'est pas proposé sur cet écran');
  assert.ok(noms.includes('Home Assistant') && noms.includes('Maison claire'));
  const choisis = boutons.filter((b) => b.attrs['aria-pressed'] === 'true');
  assert.deepEqual(choisis.map(texte), ['Home Assistant'], 'un seul thème marqué choisi : celui de la tablette');
  // L'aperçu de « Home Assistant » est peint avec ses couleurs à lui, pas avec celles du thème de départ.
  const ha = boutons[noms.indexOf('Home Assistant')], apercu = (ha.kids[0] as Noeud);
  assert.equal(apercu.style.background, cat().THEMES.ha.bg);
});

// Le texte posé sur « allumé » (tuile allumée, logo), règle de la maquette : sa couleur est calculée sur la moyenne
// des couleurs du dégradé (sombre quand le blanc s'y lit à moins de 2,9 pour 1). Sur « Maison claire » et « Home
// Assistant », un texte blanc sur jaune ou orange ne se lisait pas. Les thèmes de Hestia gardent leur texte blanc.
const lumi = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)).reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
const contraste = (a: string, b: string) => { const x = lumi(a), y = lumi(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const moyenne = (g: string) => { const cs = g.match(/#[0-9a-f]{6}\b/gi)!; return `#${[1, 3, 5].map((i) => Math.round(cs.reduce((s, c) => s + parseInt(c.slice(i, i + 2), 16), 0) / cs.length).toString(16).padStart(2, '0')).join('')}`; };
test('sur « allumé », le texte se lit : sombre sur « Maison claire » et « Home Assistant », blanc gardé pour les thèmes de Hestia', async () => {
  const e = await etat({ ...SANS_SESSION, 'x-odin-maison': cle }), c = cat();
  const encre = (p: { style: string }) => /--on-ink:([^;]+);/.exec(p.style)?.[1];
  for (const id of EN_AVANT) {
    const p = await pageChargee(e, `o-${id}`), on = String(c.THEMES[id].onA), m = moyenne(on);
    const attendu = contraste('#ffffff', m) < 2.9 ? '#2a1a00' : '#ffffff';
    assert.equal(encre(p), attendu, `o-${id} : la couleur du texte sur « allumé » suit la règle de la maquette`);
  }
  for (const id of ['clair', 'ha']) {
    const p = await pageChargee(e, `o-${id}`);
    assert.ok(contraste(encre(p)!, moyenne(String(c.THEMES[id].onA))) >= 4.5, `o-${id} : le texte se lit (4,5 pour 1 au moins)`);
  }
  for (const id of ['verre', 'clair', 'plage', 'neon']) assert.equal(encre(await pageChargee(e, id)), '#ffffff', `${id} (Hestia) : texte blanc, comme avant`);
  // Le style de la tuile allumée et du logo prend cette couleur (plus de blanc écrit en dur).
  const p = await pageChargee(e, 'o-clair');
  assert.match(p.style, /\.dev\.on\{[^}]*color:var\(--on-ink\)/);
  assert.match(p.style, /\.dev\.on \.muted\{color:color-mix\(in srgb,var\(--on-ink\) 82%,transparent\)\}/);
  assert.match(p.style, /\.logo\{[^}]*color:var\(--on-ink\)/);
});

test('page « Thèmes » : le titre d\'une famille se distingue du titre de la page', async () => {
  const e = await etat({ ...SANS_SESSION, 'x-odin-maison': cle });
  const p = await pageChargee(e, 'o-ha'), racine = { nodeType: 1, tag: 'racine', attrs: {}, kids: p.vue(), style: {}, textContent: '' } as Noeud;
  const h2 = tous(racine, 'h2'), h3 = tous(racine, 'h3');
  assert.equal(h2.length, 1); assert.ok(h3.length >= 2);
  for (const h of h3) assert.notEqual(h.attrs.class, h2[0].attrs.class, `« ${texte(h)} » : un autre style que « Thèmes »`);
  const cls = h3[0].attrs.class;
  assert.match(p.style, new RegExp(`\.${cls}\{[^}]*font-size:12\.5px`), 'un titre de famille plus petit que le titre de la page');
});

// ---------- Les thèmes d'Odin et des événements sur l'écran de la maison ----------
/** --bg2 en entier (un thème d'Odin y met son décor : une adresse « data: » qui contient « ; »). */
const fondEntier = (style: string) => /--bg2:(.*?);--card:/.exec(style)?.[1];
test('un thème d\'Odin (clair, sombre) et un thème d\'événement choisis sur /maison : appliqués par la règle de la maquette, gardés au rechargement, sans toucher au thème d\'Odin', async () => {
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: 'glace' })).ok, true);
  const c = cat();
  for (const [id, t, ton] of [['o-ciel', c.ODIN?.ciel, 'light'], ['o-nuit', c.ODIN?.nuit, 'dark'], ['o-ev-noel', c.EVENEMENTS?.['ev-noel'], 'dark'], ['o-ev-paques', c.EVENEMENTS?.['ev-paques'], 'light']] as const) {
    assert.ok(t, `${id} : ses données sont dans le catalogue`);
    const r = await v.json('/api/maison/theme', { theme: id });
    assert.equal(r.body.ok, true, `${id} : accepté par Hestia`); assert.equal(reglageMaison(), id); assert.equal(reglageOdin(), 'glace', `${id} : le thème d'Odin ne bouge pas`);
    const e = await etat({}); assert.equal(e.theme, id, `${id} : gardé au rechargement`);
    const p = await pageChargee(e, null), m = c.fromOdin(t!, 'x');
    assert.deepEqual([p.text, p.accent, p.ton, fondEntier(p.style), p.bg], [m.ink, m.accent, ton, m.bg, t!.sky![0]], `${id} : les couleurs de la règle de la maquette`);
    assert.match(String(m.bg), /^url\("data:image\/svg\+xml;utf8,/, `${id} : son décor dessiné, dans le fond`);
    assert.doesNotMatch(p.style, /undefined|NaN/, `${id} : aucune variable vide`);
    const r2 = await pageChargee(e, null, (x) => { (id.startsWith('o-ev-') ? x.EVENEMENTS : x.ODIN)[id.slice(2)] = { ...t!, ink: '#654321' }; });
    assert.equal(r2.text, '#654321', `${id} : lu dans le catalogue, pas dans une copie`);
  }
  // Une tablette garde son choix (un thème d'événement), sans rien changer au réglage de Hestia.
  const e = await etat({ ...SANS_SESSION, 'x-odin-maison': cle });
  const p = await pageChargee(e, 'o-ev-halloween');
  assert.equal(p.text, c.EVENEMENTS['ev-halloween'].ink); assert.equal(reglageMaison(), 'o-ev-paques');
  // Un ancien « o-valhalla » gardé par une tablette (Valhalla n'est plus un thème de cet écran) et un « o-… » inconnu :
  // le thème de départ de l'écran.
  const verre = await pageChargee(e, 'verre');
  for (const x of ['o-valhalla', 'o-ev-inconnu', 'o-h-verre']) { const q = await pageChargee(e, x); assert.deepEqual([q.text, q.bg], [verre.text, verre.bg], x); }
  // Remis comme avant pour les essais suivants.
  assert.equal((await v.json('/api/maison/theme', { theme: 'verre' })).body.ok, true);
});

test('un ancien réglage « o-valhalla » (gardé par Hestia ou par une tablette) : l\'écran retombe sur le thème de départ, sans erreur ; Réglages garde Valhalla', async () => {
  // Gardé par Hestia (posé directement : l'action le refuse désormais).
  valhallaOf()!.ctx('gladsheim').saveSettings({ theme: 'o-valhalla' });
  const e = await etat({}); assert.equal(e.theme, 'o-valhalla', 'le réglage est rendu tel quel');
  const p = await pageChargee(e, null), verre = await pageChargee({ ...e, theme: 'verre' }, null);
  assert.deepEqual([p.bg, p.text, p.accent, p.ton], [verre.bg, verre.text, verre.accent, verre.ton], 'le thème de départ');
  assert.doesNotMatch(p.style, /undefined|NaN/);
  const racine = { nodeType: 1, tag: 'racine', attrs: {}, kids: p.vue(), style: {}, textContent: '' } as Noeud;
  assert.deepEqual(tous(racine, 'button').filter((b) => b.attrs['aria-pressed'] === 'true'), [], 'aucun thème marqué choisi');
  const view = await valhallaOf()!.module('gladsheim')!.view(valhallaOf()!.ctx('gladsheim'), new URLSearchParams()) as unknown as { subtitle: string };
  assert.match(view.subtitle, /Thème « Verre sombre »/, 'Odin → Hestia ne dit plus « Valhalla (classique) »');
  // Gardé par une tablette.
  const t = await etat({ ...SANS_SESSION, 'x-odin-maison': cle }), q = await pageChargee(t, 'o-valhalla');
  assert.deepEqual([q.bg, q.text], [verre.bg, verre.text]);
  // Réglages → Apparence : Valhalla reste un thème d'Odin.
  const avant = reglageOdin();
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: 'valhalla' })).ok, true); assert.equal(reglageOdin(), 'valhalla');
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: String(avant || 'glace') })).ok, true);
  // Remis comme avant pour les essais suivants.
  assert.equal((await v.json('/api/maison/theme', { theme: 'verre' })).body.ok, true); assert.equal(reglageMaison(), 'verre');
});

test('la règle de la maquette (fromOdin) est dans le catalogue : tout thème d\'Odin et d\'événement y a ses champs', () => {
  const c = cat();
  assert.equal(typeof c.fromOdin, 'function');
  const champs = ['name', 'grp', 'dark', 'sc', 'gt', 'blur0', 'sheen', 'mascot', 'bg', 'blob1', 'blob2', 'blobO', 'surface', 'solid', 'border', 'blur', 'sat', 'shadow', 'ink', 'muted', 'accent', 'onA', 'onB', 'pal', 'side', 'chip', 'sel', 'track', 'line', 'radius', 'good', 'warn', 'bad'];
  for (const t of [...Object.values(c.ODIN), ...Object.values(c.EVENEMENTS)].filter((x) => x.sky)) {
    const m = c.fromOdin(t, 'g');
    assert.deepEqual(Object.keys(m), champs, `${t.name} : les champs de la maquette`);
    for (const k of champs) assert.doesNotMatch(String(m[k]), /undefined|NaN/, `${t.name}.${k}`);
  }
  // Une valeur de la maquette, recalculée à la main : un accent trop clair pour du blanc est foncé de 30 %.
  const m = c.fromOdin(c.EVENEMENTS['ev-nouvelan'], 'g');
  assert.equal(m.accent, '#b3944a'); assert.equal(m.solid, c.EVENEMENTS['ev-nouvelan'].panel); assert.equal(m.radius, 22);
});

// Empreinte des données des 33 thèmes d'Odin et des 16 des événements, telles qu'elles étaient dans themes.js avant
// leur déplacement dans le catalogue : JSON.stringify({ THEMES, EVENT_THEMES }), SHA-256. Pas une valeur ne change.
const EMPREINTE_AVANT = '6872fda96fb6361942b7fc20e961cf812cf6575103fe239d4bbd6445a7df5d51';
type OdinThemes = { THEMES: Record<string, Odin>; ORDER: string[]; EVENT_THEMES: Record<string, Odin>; familles: () => Array<{ id: string; titre: string; ids: string[] }>; apply(id: string): void; current(): string };
/** themes.js dans une page factice, avec ou sans le catalogue chargé avant lui. */
function chargerOdin(avecCatalogue: boolean) {
  const element = () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
  const page = { readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} }, head: { append() {} }, createElement: () => element(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null };
  const fenetre: Record<string, unknown> = { OdinThemes: {}, addEventListener() {} };
  const ctx = vm.createContext({ window: fenetre, document: page, localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), console, navigator: {} });
  (fenetre as { window?: unknown }).window = fenetre;
  if (avecCatalogue) vm.runInContext(CATALOGUE, ctx);
  vm.runInContext(THEMES_JS, ctx);
  return { o: fenetre.OdinThemes as OdinThemes, page, catalogue: fenetre.OdinCatalogueThemes as Cat | undefined };
}
test('les données des thèmes d\'Odin et des événements : passées dans le catalogue sans changer un octet, et lues par themes.js', () => {
  const c = cat();
  assert.equal(createHash('sha256').update(JSON.stringify({ THEMES: c.ODIN, EVENT_THEMES: c.EVENEMENTS })).digest('hex'), EMPREINTE_AVANT, 'chaque thème, chaque champ, à l\'octet');
  // Plus de copie dans themes.js.
  for (const x of ['"vacances": {', '"canicule": {', '\'ev-noel\': {', '\'ev-anniversaire\': {', 'M0 120 L40 92 L70 110']) assert.ok(!THEMES_JS.includes(x), `themes.js ne garde pas « ${x} »`);
  // themes.js expose ce qu'il exposait : mêmes thèmes, même ordre, mêmes familles.
  const { o } = chargerOdin(true), json = (x: unknown) => JSON.parse(JSON.stringify(x));
  assert.deepEqual([...o.ORDER], Object.keys(c.ODIN));
  assert.deepEqual(json(o.EVENT_THEMES), json(c.EVENEMENTS));
  for (const id of Object.keys(c.ODIN)) if (id !== 'glace') assert.deepEqual(json(o.THEMES[id]), json(c.ODIN[id]), id);
  assert.deepEqual(JSON.parse(JSON.stringify(o.familles().map((f) => [f.id, f.titre, f.ids]))), FAMILLES.map((f) => [f.id, f.titre, f.ids]), 'les familles de Réglages, inchangées');
  for (const k of ['THEMES', 'ORDER', 'EVENT_THEMES', 'familles', 'palette', 'contrast', 'apply', 'current', 'sync', 'choose', 'humeur']) assert.ok(k in o, `window.OdinThemes.${k}`);
  // themes.js ne touche pas au catalogue (il range ses thèmes dans sa propre liste).
  const charge = chargerOdin(true).catalogue!;
  assert.deepEqual(Object.keys(charge.ODIN), Object.keys(c.ODIN)); assert.deepEqual(Object.keys(charge.EVENEMENTS), Object.keys(c.EVENEMENTS));
  assert.deepEqual(json(charge.ODIN.glace), json(c.ODIN.glace), 'glace reste celui d\'Odin dans le catalogue (themes.js range le sien à part)');
});

test('sans le catalogue : Odin garde un thème lisible (Valhalla) sans erreur ; l\'écran de la maison garde son style de secours', async () => {
  const { o, page } = chargerOdin(false);
  assert.deepEqual(JSON.parse(JSON.stringify(o.familles().map((f) => [f.id, f.ids]))), [['odin', ['valhalla']], ['evenements', []]]);
  for (const id of ['glace', 'nuit', 'ev-noel', 'valhalla']) { o.apply(id); assert.equal(o.current(), 'valhalla', id); }
  assert.equal(page.documentElement.dataset.odinTheme, undefined, 'les couleurs d\'origine de la page');
  // /maison sans catalogue : un thème d'Odin ou d'événement gardé prend le style de secours, la page Thèmes se dessine.
  const e = await etat({ ...SANS_SESSION, 'x-odin-maison': cle });
  for (const x of ['o-nuit', 'o-ev-noel', 'o-ha', 'verre']) {
    const p = await pageChargee(e, x, undefined, true);
    assert.deepEqual([p.bg, p.text], ['#16181d', '#eef0f6'], `${x} : le style de secours`);
    const racine = { nodeType: 1, tag: 'racine', attrs: {}, kids: p.vue(), style: {}, textContent: '' } as Noeud;
    assert.equal(tous(racine, 'button').length, Object.keys(e.themes).length);
  }
});

// ---------- Dans un vrai navigateur (390 et 1280 px) ----------
declare const document: any, window: any;
interface Page { goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | (() => X)): Promise<X>; reload(): Promise<unknown>; on(e: string, f: (x: Error) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown> }
interface Contexte { newPage(): Promise<Page>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.ODIN_CAPTURES;
const SEL_THEMES = 'button.nav[aria-label="Thèmes"]';
/** L'adresse que donne une clé de tablette (« #cle=… »). */
const ADRESSE_TABLETTE = () => `/maison#cle=${cle}`;
for (const largeur of [390, 1280]) {
  test(`navigateur, ${largeur} px : la page « Thèmes » de /maison montre les quatre familles ; un thème d'Odin clair, un sombre et un d'événement s'appliquent et tiennent au rechargement`, { skip: sansNav }, async () => {
    const nav = await pw!.chromium.launch();
    try {
      const ctx = await nav.newContext({ viewport: { width: largeur, height: 860 }, locale: 'fr-FR' });
      const page = await ctx.newPage(), erreurs: string[] = [];
      page.on('pageerror', (x) => erreurs.push(String(x)));
      await page.goto(`${v.url}${ADRESSE_TABLETTE()}`);
      const ouvrirThemes = async () => {
        await page.waitForSelector(SEL_THEMES, { state: 'attached', timeout: 30000 });
        const ms = await page.evaluate(`(() => { const t0 = performance.now(); document.querySelector(${JSON.stringify(SEL_THEMES)}).click(); document.body.offsetHeight; return performance.now() - t0; })()`) as number;
        await page.waitForSelector('.themes .th', { timeout: 15000 });
        return ms;
      };
      const ms = await ouvrirThemes();
      const vue = await page.evaluate(() => ({ titres: [...document.querySelectorAll('h3.fam')].map((x: any) => x.textContent), n: document.querySelectorAll('.themes .th').length, deborde: document.documentElement.scrollWidth > window.innerWidth + 1 }));
      assert.deepEqual(vue.titres, FAMILLES.map((f) => f.titre)); assert.equal(vue.n, TOTAL_MAISON()); assert.equal(vue.deborde, false);
      process.stdout.write(`# ${largeur} px : ${vue.n} aperçus, page « Thèmes » ouverte et mise en page en ${ms.toFixed(1)} ms\n`);
      for (const [nom, ton] of [['Ciel', 'light'], ['Nuit étoilée', 'dark'], ['Noël', 'dark']] as const) {
        await page.evaluate(`[...document.querySelectorAll('.themes .th')].find((x) => x.textContent === ${JSON.stringify(nom)}).click()`);
        await page.waitForFunction((n: string) => [...document.querySelectorAll('.themes .th')].some((x: any) => x.textContent === n && x.getAttribute('aria-pressed') === 'true'), nom);
        const lu = () => page.evaluate('({ cs: getComputedStyle(document.documentElement).colorScheme, fond: getComputedStyle(document.body).backgroundImage, texte: getComputedStyle(document.body).color })') as Promise<{ cs: string; fond: string; texte: string }>;
        const a = await lu();
        assert.equal(a.cs, ton, nom); assert.match(a.fond, /url\("data:image\/svg\+xml/, `${nom} : le décor`);
        if (CAPTURES) { mkdirSync(CAPTURES, { recursive: true }); await page.screenshot({ path: `${CAPTURES}/${largeur}-${nom.replace(/\W+/g, '-')}.png`, fullPage: false }); }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `${nom} : pas de débordement`);
        await page.reload();
        await page.waitForSelector(SEL_THEMES, { state: 'attached', timeout: 30000 });
        assert.deepEqual(await lu(), a, `${nom} : gardé au rechargement (sur la tablette)`);
        await ouvrirThemes();
      }
      assert.deepEqual(erreurs, []); assert.equal(reglageMaison(), 'verre', 'la tablette ne change pas le thème gardé par Hestia');
      await ctx.close();
    } finally { await nav.close(); }
  });
}
