// Vénus DANS Odin (réponse du propriétaire du 23/11 : « Vénus doit aussi s'ouvrir dans Odin, menu à côté, comme Home
// Assistant ») : ouvrir l'appli Vénus pose la vue #venus de la page d'Odin, un cadre de la même adresse sur /venus/app/.
// Sans navigateur : la source de la page, la logique de src/web/pages/venus.js rejouée sur un faux document, la règle
// « dans Odin » de l'interface de Venus, et les en-têtes d'un vrai Odin d'essai (le cadre n'est permis qu'à Odin).
// Dans un vrai navigateur : test/menus-venus-vue-navigateur.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../src/valhalla/venus/app/app.js', import.meta.url), 'utf8');
const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
const lire = () => readFileSync(new URL('../src/web/pages/venus.js', import.meta.url), 'utf8');

test('page : la vue #v-venus existe, vide au départ ; « Applis » reste l\'entrée marquée', () => {
  const vue = /<section class="view" id="v-venus"([^>]*)>([\s\S]*?)<\/section>/.exec(UI);
  assert.ok(vue, 'la vue #v-venus dans <main>');
  assert.match(vue[1], /aria-label="Vénus"/);
  assert.equal(vue[2].trim(), '', 'aucun contenu tant que la vue n\'est pas ouverte');
  assert.ok(UI.indexOf('id="v-venus"') > UI.indexOf('<main>'));
  assert.match(UI, /const nv = v === 'device' \? 'net' : v === 'app' \|\| v === 'venus' \? 'apps' : v;/);
});

// ---------- Logique pure ----------
type Fn = (...a: unknown[]) => unknown;
interface Vue { poser: Fn; remplacer: Fn; apresAncre: Fn; retirerAncre: Fn }
test('logique : cadre pour le propriétaire seul ; adresse /#venus ; retour et avance', () => {
  const win: { OdinPages: Record<string, unknown>; OdinVenus?: { logique: { vue: Vue } } } = { OdinPages: {} };
  vm.runInNewContext(lire(), { window: win, URLSearchParams });
  const L = win.OdinVenus!.logique.vue;
  assert.equal(L.poser('venus', true), true);
  assert.equal(L.poser('venus', false), false, 'un membre (ou pas encore d\'état) : rien');
  assert.equal(L.poser('venus', undefined), false);
  assert.equal(L.poser('home', true), false);
  assert.equal(L.remplacer('#app=freyja'), true, 'venu par un lien #app=freyja : remplacé (retour ne renvoie pas dans Vénus)');
  assert.equal(L.remplacer('#venus'), true);
  assert.equal(L.remplacer(''), false, 'depuis la liste des applis : une entrée de plus');
  assert.equal(L.remplacer('#app=freyjax'), false);
  assert.equal(L.apresAncre('', true, 'app'), 'apps', 'retour : la liste des applis, pas la page vide de l\'appli');
  assert.equal(L.apresAncre('', true, 'chat'), 'chat');
  assert.equal(L.apresAncre('', true, undefined), 'home');
  assert.equal(L.apresAncre('#venus', true, 'chat'), null);
  assert.equal(L.apresAncre('', false, 'chat'), null);
  assert.equal(L.retirerAncre('chat', '#venus'), true);
  assert.equal(L.retirerAncre('venus', '#venus'), false);
});

// ---------- Faux document ----------
function brancher(o: { hash?: string; vueApp?: boolean } = {}) {
  const cadres: Array<Record<string, unknown> & { attrs: Map<string, string> }> = [], styles: unknown[] = [], montrees: string[] = [], historique: string[] = [];
  const ecoutesDoc = new Map<string, Array<(e: unknown) => void>>(), ecoutesWin = new Map<string, Array<(e: unknown) => void>>();
  const on = (m: typeof ecoutesDoc) => (t: string, fn: (e: unknown) => void) => { m.set(t, [...(m.get(t) ?? []), fn]); };
  const section = { enfants: [] as unknown[], on: false, classList: { contains: (c: string) => c === 'on' && section.on },
    replaceChildren: (...k: unknown[]) => { section.enfants = k; },
    querySelector: (s: string) => (s === '.vv-attente' ? section.enfants.find((e) => (e as { className?: string }).className === 'vv-attente') ?? null : null) };
  const mcur = { textContent: 'Applis' };
  const noeud = (tag: string) => {
    const n: Record<string, unknown> & { attrs: Map<string, string> } = { tagName: tag.toUpperCase(), attrs: new Map(), className: '',
      setAttribute: (k: string, v: string) => { n.attrs.set(k, v); if (k === 'src') n.src = v; if (k === 'title') n.title = v; },
      addEventListener: () => {}, append: (...k: unknown[]) => { n.enfants = k; }, style: {},
      remove: () => { const i = section.enfants.indexOf(n); if (i >= 0) section.enfants.splice(i, 1); } };
    if (tag === 'iframe') cadres.push(n);
    return n;
  };
  const document = {
    addEventListener: on(ecoutesDoc), createElement: noeud, createTextNode: (t: string) => ({ texte: t }),
    getElementById: (id: string) => (id === 'v-venus' ? section : id === 'mcur' ? mcur : (styles as Array<{ attrs: Map<string, string> }>).find((x) => x.attrs.get('id') === id) ?? null),
    querySelector: (s: string) => (s === '#v-app.on' ? (o.vueApp ? {} : null) : null),
    head: { append: (s: unknown) => styles.push(s) },
  };
  const location = { hash: o.hash ?? '', pathname: '/', search: '', replace: (u: string) => historique.push(`remplace la page ${u}`) };
  const history = { state: null, replaceState: (_s: unknown, _t: string, u: string) => { historique.push(`remplace ${u}`); location.hash = /#.*/.exec(u)?.[0] ?? ''; }, pushState: (_s: unknown, _t: string, u: string) => { historique.push(`ajoute ${u}`); location.hash = /#.*/.exec(u)?.[0] ?? ''; } };
  const win: Record<string, unknown> & { OdinPages: Record<string, Fn> } = { OdinPages: {}, addEventListener: on(ecoutesWin), location, history, OdinShow: (v: string) => montrees.push(v) };
  class Node {}
  vm.runInNewContext(lire(), { window: win, document, URLSearchParams, Node, fetch: () => Promise.reject(new Error('hors ligne')) });
  const vue = (v: string) => { for (const fn of ecoutesDoc.get('odin:vue') ?? []) fn({ detail: { vue: v } }); section.on = v === 'venus'; };
  const etat = (e: unknown) => { for (const fn of ecoutesWin.get('odin:etat') ?? []) fn({ detail: e }); };
  const ancre = (h: string) => { location.hash = h; for (const fn of ecoutesWin.get('hashchange') ?? []) fn({}); };
  return { win, section, cadres, styles, montrees, historique, mcur, vue, etat, ancre, location, ecoutesDoc, ecoutesWin };
}

test('chargement : rien n\'est touché, aucune requête, aucun minuteur', () => {
  let touche = 0;
  const piege = () => { touche++; return null; };
  const ecoutes: string[] = [];
  const win = { OdinPages: {}, addEventListener: (t: string) => ecoutes.push(`w:${t}`) };
  vm.runInNewContext(lire(), { window: win, document: { addEventListener: (t: string) => ecoutes.push(`d:${t}`) }, URLSearchParams, fetch: piege, setTimeout: piege, setInterval: piege });
  assert.equal(touche, 0);
  assert.deepEqual(ecoutes.sort(), ['d:odin:vue', 'w:hashchange', 'w:load', 'w:odin:etat']);
});

test('ouvrir Vénus : la page d\'Odin reste (vue #venus, adresse /#venus), un seul cadre de la même adresse, plein écran permis', async () => {
  const b = brancher({ vueApp: true });
  b.etat({ ok: true });
  const fait = await b.win.OdinPages.freyja({ host: {}, quiet: false });
  assert.equal(fait, true);
  assert.deepEqual(b.historique, ['ajoute /#venus'], 'la page n\'est plus remplacée par /venus/app/');
  assert.deepEqual(b.montrees, ['venus']);
  b.vue('venus'); b.vue('venus');
  assert.equal(b.cadres.length, 1, 'jamais deux chargements');
  const c = b.cadres[0];
  assert.equal(c.attrs.get('src'), '/venus/app/#/'); assert.equal(c.attrs.get('title'), 'Vénus'); assert.equal(c.className, 'vv-cadre');
  assert.match(c.attrs.get('allow') ?? '', /\bfullscreen\b/, 'le lecteur de Venus peut passer en plein écran');
  assert.equal(c.attrs.get('allowfullscreen'), '');
  assert.equal(c.attrs.has('sandbox'), false);
  assert.equal(b.mcur.textContent, 'Vénus', 'le titre du haut (téléphone)');
  assert.deepEqual(b.section.enfants, [c]);
  // Quitter par le menu : cadre retiré, #venus retiré.
  b.vue('chat');
  assert.deepEqual(b.section.enfants, []);
  assert.equal(b.location.hash, '');
  b.vue('venus');
  assert.equal(b.cadres.length, 2, 'rouverte : un cadre neuf');
  assert.equal((b.styles as Array<{ attrs: Map<string, string> }>).filter((x) => x.attrs.get('id') === 'vvCss').length, 1, 'un seul style');
});

test('ouvrir Vénus par un lien #app=freyja : l\'adresse est remplacée ; retour vers les applis', async () => {
  const b = brancher({ hash: '#app=freyja', vueApp: true });
  b.etat({ ok: true });
  await b.win.OdinPages.freyja({ host: {}, quiet: false });
  assert.deepEqual(b.historique, ['remplace /#venus']);
  b.vue('app'); b.vue('venus');
  b.ancre('');
  assert.deepEqual(b.montrees, ['venus', 'apps'], 'retour : la liste des applis');
});

test('un rafraîchissement discret de l\'appli ne ramène pas dans Vénus ; la gestion et la lecture restent dans Odin', async () => {
  const b = brancher({ vueApp: false });
  b.etat({ ok: true });
  assert.equal(await b.win.OdinPages.freyja({ host: {}, quiet: true }), true);
  assert.deepEqual(b.montrees, [], 'rien ne bouge');
  assert.deepEqual(b.historique, []);
  assert.equal(b.cadres.length, 0);
});

test('un membre (état « membre ») : aucun cadre, même par l\'adresse #venus', () => {
  const b = brancher();
  b.etat({ membre: { login: 'camille' } });
  b.vue('venus');
  assert.equal(b.cadres.length, 0);
  assert.match(String((b.section.enfants[0] as { enfants?: Array<{ texte?: string }> })?.enfants?.[0]?.texte), /propriétaire/);
  b.etat({ ok: true }); // l'état change (le propriétaire) : le cadre est posé
  assert.equal(b.cadres.length, 1);
  b.etat({ membre: { login: 'camille' } });
  assert.equal(b.section.enfants.includes(b.cadres[0]), false, 'retiré dès que l\'état dit « membre »');
});

// ---------- L'interface de Venus dans Odin ----------
test('interface de Venus : « ‹ Odin » absent dans Odin, liens vers Odin dans la page d\'Odin (jamais dans le cadre)', () => {
  assert.match(APP, /const DANS_ODIN = \(\(\) => \{ try \{ return Boolean\(D\) && Boolean\(W\.top\) && W\.top !== W && W\.top\.location\.origin === W\.location\.origin; \} catch \{ return false; \} \}\)\(\);/);
  assert.match(APP, /const versOdin = \(u\) => \{ \(DANS_ODIN \? W\.top : W\)\.location\.href = u; \};/);
  assert.match(APP, /\$\{DANS_ODIN \? '' : `<button class="rail-item f odin-back"/);
  assert.match(APP, /\$\{DANS_ODIN \? '' : `<button class="odin-back f"/);
  assert.match(APP, /case 'odin': e\.preventDefault\(\); versOdin\('\/'\); break;/);
  assert.match(APP, /case 'classique': e\.preventDefault\(\); versOdin\('\/\?venus=gestion#app=freyja'\); break;/);
  assert.match(APP, /if \(r\.status === 401\) \{ versOdin\('\/'\);/);
  assert.doesNotMatch(APP, /(^|[^.\w])location\.href = /m, 'aucun saut dans le cadre lui-même');
});

test('écran de la maison dans Odin, au téléphone : sa barre du bas cachée, ses sections dans un menu en haut ; la page seule inchangée', () => {
  assert.match(MAISON, /if \(dansOdin\) document\.documentElement\.classList\.add\('dans-odin'\);/);
  assert.match(MAISON, /dansOdin \? secs\(navs\) : null,/, 'le menu n\'existe que dans Odin');
  assert.match(MAISON, /\.secs\{display:none\}/, 'caché partout par défaut');
  const tel = /@media \(max-width:820px\)\{[\s\S]*?\n(html\.dans-odin[^\n]*)/.exec(MAISON)?.[1] ?? '';
  assert.match(tel, /html\.dans-odin \.bnav\{display:none\}/);
  assert.match(tel, /html\.dans-odin \.secs\{display:flex/);
  assert.match(tel, /\.secs button\{[^}]*min-height:44px/);
});

// ---------- En-têtes ----------
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
after(async () => { await tt.end(); Object.assign(console, orig); });

test('en-têtes : /venus/app/ ne se laisse poser que par Odin ; la page d\'Odin, nulle part', async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  const v = await vraiOdin(tt, { compte: true });
  const a = await fetch(`${v.url}/venus/app/`, { headers: { cookie: v.session } });
  assert.equal(a.status, 200);
  const csp = a.headers.get('content-security-policy') ?? '';
  assert.match(csp, /frame-ancestors 'self';/);
  assert.doesNotMatch(csp, /frame-ancestors[^;]*(\*|https?:|'none')/);
  assert.equal(a.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.doesNotMatch(csp, /frame-src|child-src/, 'Venus ne pose aucun cadre à son tour');
  const p = await fetch(`${v.url}/`, { headers: { cookie: v.session } });
  assert.match(p.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(p.headers.get('x-frame-options'), 'DENY');
  assert.match(p.headers.get('content-security-policy') ?? '', /frame-src 'self' https:\/\/www\.youtube-nocookie\.com https:\/\/player\.vimeo\.com https:\/\/www\.dailymotion\.com;/, 'pas d\'autre origine');
  // Sans session : rien (le membre reçoit 401 : test/venus-v1.test.ts).
  assert.notEqual((await fetch(`${v.url}/venus/app/`)).status, 200);
});
