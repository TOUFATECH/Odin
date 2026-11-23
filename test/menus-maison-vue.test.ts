// L'écran de la maison DANS Odin (demande du 23/11 : « ça doit être la même page Odin… une page qui apparaît à côté
// d'Odin ») : l'entrée « Home Assistant » ouvre la vue #maison de la page d'Odin, qui montre /maison dans un cadre de la
// même adresse. Sans navigateur : la source de la page, la logique de src/web/pages/vue-maison.js rejouée sur un faux
// document, et les en-têtes d'un vrai Odin d'essai (le cadre n'est permis qu'à Odin lui-même).
// Le comportement dans un vrai navigateur : test/menus-maison-vue-navigateur.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
const lireVue = () => readFileSync(new URL('../src/web/pages/vue-maison.js', import.meta.url), 'utf8');

test('page : l\'entrée ouvre une vue d\'Odin (#maison), et la vue existe, vide au départ', () => {
  const lien = /<a class="tab" id="navMaison"([^>]*)>/.exec(UI);
  assert.ok(lien, 'l\'entrée du menu');
  assert.match(lien[1], / href="#maison"/, 'l\'adresse change sans recharger (#maison), plus /maison');
  assert.match(lien[1], / data-view="maison"/, 'une vue, comme Accueil ou Réglages');
  assert.match(lien[1], / hidden/, 'cachée au départ');
  const vue = /<section class="view" id="v-maison"([^>]*)>([\s\S]*?)<\/section>/.exec(UI);
  assert.ok(vue, 'la vue #v-maison dans <main>');
  assert.match(vue[1], /aria-label="Home Assistant"/);
  assert.equal(vue[2].trim(), '', 'aucun contenu tant que la vue n\'est pas ouverte');
  assert.ok(UI.indexOf('id="v-maison"') > UI.indexOf('<main>'), 'dans <main>, à côté du menu');
  assert.doesNotMatch(UI, /src="\/maison\.js"/, 'le script de la maison n\'est jamais chargé dans la page d\'Odin');
});

// ---------- Logique pure ----------
interface Vue { logique: { poser(v: string, e: unknown): boolean; apresAncre(a: string, on: boolean, p?: string): string | null; retirerAncre(v: string, a: string): boolean } }
function charger(env: Record<string, unknown> = {}) {
  const ecoutes = new Map<string, Array<(e: unknown) => void>>();
  const on = (t: string, fn: (e: unknown) => void) => { ecoutes.set(t, [...(ecoutes.get(t) ?? []), fn]); };
  const win: Record<string, unknown> = { addEventListener: on };
  vm.runInNewContext(lireVue(), { window: win, document: { addEventListener: on }, ...env });
  assert.ok(win.OdinVueMaison, 'window.OdinVueMaison est posé');
  return { V: win.OdinVueMaison as Vue & { ouverte(): boolean; cadre(): unknown }, ecoutes, win };
}

test('logique : le cadre seulement dans la vue et si l\'entrée est visible (jamais pour un membre)', () => {
  const { poser } = charger().V.logique;
  assert.equal(poser('maison', true), true);
  assert.equal(poser('maison', false), false, 'entrée cachée (membre, Hestia absente) : rien');
  assert.equal(poser('maison', undefined), false);
  assert.equal(poser('home', true), false, 'une autre vue : rien');
});

test('logique : retour et avance du navigateur, l\'adresse en quittant la vue', () => {
  const { apresAncre, retirerAncre } = charger().V.logique;
  assert.equal(apresAncre('', true, 'chat'), 'chat', 'retour depuis #maison : la vue d\'avant');
  assert.equal(apresAncre('', true, undefined), 'home', 'sans vue d\'avant : l\'accueil');
  assert.equal(apresAncre('', true, 'maison'), 'home');
  assert.equal(apresAncre('#maison', true, 'chat'), null, 'toujours sur #maison');
  assert.equal(apresAncre('', false, 'chat'), null, 'la vue n\'est plus affichée : la page a déjà changé de vue');
  assert.equal(retirerAncre('chat', '#maison'), true, 'quitter par le menu : #maison retiré');
  assert.equal(retirerAncre('chat', '#net'), false, 'une autre ancre est gardée');
  assert.equal(retirerAncre('maison', '#maison'), false);
});

test('chargement : rien n\'est touché, aucune requête, aucun minuteur', () => {
  let touche = 0;
  const piege = () => { touche++; return null; };
  const { ecoutes } = charger({ fetch: piege, setInterval: piege, setTimeout: piege, location: { hash: '#maison' } });
  assert.equal(touche, 0);
  assert.deepEqual([...ecoutes.keys()].sort(), ['hashchange', 'load', 'odin:vue']);
});

// ---------- Faux document : la vue, l'entrée du menu ----------
function fauxDocument(entreeCachee: boolean) {
  const cadres: Array<Record<string, unknown>> = [], styles: unknown[] = [];
  const noeud = (tag: string) => {
    const n: Record<string, unknown> & { attrs: Map<string, string>; enfants: unknown[] } = {
      tagName: tag.toUpperCase(), attrs: new Map(), enfants: [],
      setAttribute: (k: string, v: string) => n.attrs.set(k, v),
      remove: () => { const i = section.enfants.indexOf(n); if (i >= 0) section.enfants.splice(i, 1); },
    };
    if (tag === 'iframe') cadres.push(n);
    return n;
  };
  const section = { id: 'v-maison', enfants: [] as unknown[], on: false,
    classList: { contains: (c: string) => c === 'on' && section.on },
    replaceChildren: (...k: unknown[]) => { section.enfants = k; },
    querySelector: (s: string) => (s === '.vm-attente' ? section.enfants.find((e) => (e as { className?: string }).className === 'vm-attente') ?? null : null) };
  const entree = { hidden: entreeCachee };
  const ecoutes = new Map<string, Array<(e: unknown) => void>>();
  const on = (t: string, fn: (e: unknown) => void) => { ecoutes.set(t, [...(ecoutes.get(t) ?? []), fn]); };
  const document = {
    addEventListener: on,
    getElementById: (id: string) => (id === 'v-maison' ? section : id === 'navMaison' ? entree : id === 'vmCss' ? (styles.length ? styles[0] : null) : null),
    createElement: (t: string) => noeud(t),
    head: { append: (s: unknown) => styles.push(s) },
  };
  return { document, section, entree, cadres, styles, ecoutes, on };
}

function brancher(entreeCachee: boolean) {
  const d = fauxDocument(entreeCachee), montrees: string[] = [], historique: string[] = [];
  const location = { hash: '', pathname: '/', search: '' };
  const win: Record<string, unknown> = { addEventListener: d.on, OdinShow: (v: string) => montrees.push(v) };
  const history = { state: null, replaceState: (_s: unknown, _t: string, u: string) => { historique.push(u); location.hash = ''; } };
  vm.runInNewContext(lireVue(), { window: win, document: d.document, location, history });
  const vue = (v: string) => { for (const fn of d.ecoutes.get('odin:vue')!) fn({ detail: { vue: v } }); d.section.on = v === 'maison'; };
  const ancre = (h: string) => { location.hash = h; for (const fn of d.ecoutes.get('hashchange')!) fn({}); };
  return { ...d, vue, ancre, location, montrees, historique };
}

test('vue : un seul cadre sur /maison, même ouverte deux fois (clic puis #maison), retiré en quittant', () => {
  const b = brancher(false);
  b.vue('home');
  assert.equal(b.cadres.length, 0, 'rien tant que la vue n\'est pas ouverte');
  b.vue('maison'); b.location.hash = '#maison'; b.vue('maison');
  assert.equal(b.cadres.length, 1, 'un seul cadre créé : jamais deux chargements');
  const c = b.cadres[0];
  assert.equal(c.src, '/maison'); assert.equal(c.title, 'Home Assistant'); assert.equal(c.className, 'vm-cadre');
  assert.deepEqual(b.section.enfants, [c], 'le cadre est dans la vue');
  assert.equal(b.styles.length, 1, 'un seul style');
  b.vue('chat');
  assert.deepEqual(b.section.enfants, [], 'en quittant, le cadre est retiré (tout ce qu\'il faisait tourner s\'arrête)');
  assert.deepEqual(b.historique, ['/'], 'l\'adresse perd #maison : un rechargement ne rouvre pas la maison');
  b.vue('maison');
  assert.equal(b.cadres.length, 2, 'rouverte : un cadre neuf');
  assert.equal(b.styles.length, 1, 'le style n\'est pas reposé');
});

test('vue : retour du navigateur depuis #maison rouvre la vue d\'avant ; une autre ancre est laissée à la page', () => {
  const b = brancher(false);
  b.vue('chat'); b.vue('maison'); b.location.hash = '#maison';
  b.ancre('');
  assert.deepEqual(b.montrees, ['chat'], 'la Discussion revient');
  b.montrees.length = 0;
  b.vue('maison'); b.location.hash = '#maison'; b.vue('net'); b.ancre('#net');
  assert.deepEqual(b.montrees, [], 'la page a déjà ouvert #net');
});

test('vue : un membre (entrée cachée) n\'obtient aucun cadre, même par l\'adresse #maison', () => {
  const b = brancher(true);
  b.vue('maison');
  assert.equal(b.cadres.length, 0, 'aucun cadre');
  assert.match(String((b.section.enfants[0] as { textContent?: string })?.textContent), /propriétaire/, 'une phrase, rien de la maison');
});

// ---------- L'écran de la maison dans Odin : liens et retour ----------
test('écran de la maison : dans Odin, les liens vers Odin restent dans Odin ; « ← Odin » n\'y est pas', () => {
  const def = /const cibleOdin = \(dedans, encadre\) => [^;\n]+;/.exec(MAISON);
  assert.ok(def, 'la règle des liens');
  const cibleOdin = vm.runInNewContext(`${def[0]}; cibleOdin`) as (d: boolean, e: boolean) => string | null;
  assert.equal(cibleOdin(true, true), '_top', 'dans Odin : la page d\'Odin elle-même');
  assert.equal(cibleOdin(false, true), '_blank', 'dans Home Assistant : un nouvel onglet');
  assert.equal(cibleOdin(false, false), null, 'la page seule');
  assert.match(MAISON, /const dansOdin = \(\(\) => \{ try \{ return window\.top !== window && window\.top\.location\.origin === location\.origin; \} catch \{ return false; \} \}\)\(\);/, 'dans Odin = un cadre de la même adresse');
  assert.match(MAISON, /href: dansOdin \? '\/#home' : '\/'/, '« Tous les modules… » ouvre l\'accueil d\'Odin sans recharger');
  assert.doesNotMatch(MAISON, /target: window\.top !== window \? '_blank'/, 'plus de nouvel onglet forcé dans un cadre');
  assert.match(MAISON, /retourVisible\(key, window\.top !== window\)/, '« ← Odin » caché dans un cadre (donc dans la vue), gardé sur /maison');
});

// ---------- En-têtes : le cadre permis à Odin seul ----------
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
after(async () => { await tt.end(); Object.assign(console, orig); });

test('en-têtes : Odin peut poser /maison dans sa page ; aucun autre site ne peut poser ni Odin ni /maison', async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  const v = await vraiOdin(tt, { compte: true });
  const page = await fetch(`${v.url}/`, { headers: { cookie: v.session } });
  const csp = page.headers.get('content-security-policy') ?? '';
  assert.match(csp, /frame-src 'self' https:\/\/www\.youtube-nocookie\.com https:\/\/player\.vimeo\.com https:\/\/www\.dailymotion\.com;/, 'la page d\'Odin peut poser ses propres pages');
  assert.match(csp, /frame-ancestors 'none'/, 'la page d\'Odin, elle, ne se pose nulle part');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(await page.text(), /src="\/pages\/vue-maison\.js"/, 'le script de la vue est servi avec les pages');
  const m = await fetch(`${v.url}/maison`, { headers: { cookie: v.session } });
  assert.equal(m.status, 200);
  const cm = m.headers.get('content-security-policy') ?? '';
  assert.match(cm, /frame-ancestors 'self';/, '/maison : Odin seul (Home Assistant seulement si son adresse est réglée)');
  assert.doesNotMatch(cm, /frame-ancestors[^;]*(\*|https?:)/, 'aucun autre site');
  for (const p of ['/recherche', '/activer']) {
    const r = await fetch(v.url + p, { headers: { cookie: v.session } });
    const c = r.headers.get('content-security-policy');
    if (c) assert.doesNotMatch(c, /frame-ancestors 'self'/, `${p} ne se laisse pas poser`);
  }
});
