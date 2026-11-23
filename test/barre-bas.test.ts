// La barre du bas du téléphone (maquette validée « Accueil », lot 21) : cinq places, Odin au centre.
// Sa réponse du 23/11 : « celle de la maquette : Accueil, Home Assistant, Odin au centre, Discussion, Plus ».
//  - « Plus » ouvre tout le reste (le menu entier en feuille : Cerveau, le réseau, Applis, Thèmes, Réglages, les autres
//    pages et les épingles) : rien ne devient introuvable ;
//  - au centre, la mascotte de l'appli (une copie de celle de la Discussion, son dessin ne change pas) dans un rond de
//    52 px ; un appui ouvre la petite fenêtre pour lui parler, comme un toucher sur la mascotte ailleurs ;
//  - Home Assistant n'y est que pour le propriétaire (comme au menu) : pour un membre, ou sans Hestia, « Applis » (l'entrée
//    suivante du menu) prend sa place ;
//  - la page ouverte est marquée (aria-current) ; « Plus » est marqué quand elle n'a pas sa place dans la barre.
// ui.html est lu comme du texte et ses lignes sont rejouées avec de faux éléments ; puis, si Playwright est là, un vrai
// navigateur et un vrai Odin d'essai (sinon cette partie est ignorée, et elle le dit).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');

/** La barre du bas, telle qu'écrite. */
function barre(): string {
  const d = UI.indexOf('<nav class="bnav"');
  assert.ok(d > 0, 'la barre du bas garde sa classe .bnav');
  return UI.slice(d, UI.indexOf('</nav>', d) + 6);
}
/** Les places de la barre, dans l'ordre : chaque élément de premier niveau (bouton ou lien). */
function places(): { balise: string; id?: string; vue?: string; libelle?: string; cache: boolean; classe: string }[] {
  const b = barre(), out = [];
  for (const m of b.matchAll(/<(button|a) class="([^"]*)"([^>]*)>([\s\S]*?)<\/\1>/g)) {
    out.push({ balise: m[0], classe: m[2], id: /\bid="([^"]+)"/.exec(m[3])?.[1], vue: /data-view="([^"]+)"/.exec(m[3])?.[1], libelle: /<span class="lbl">([^<]*)<\/span>/.exec(m[4])?.[1], cache: /\shidden(\s|$|>)/.test(m[3] + '>') });
  }
  return out;
}
/** Le menu de gauche (la feuille que « Plus » ouvre au téléphone). */
function menu(): string {
  const i = UI.indexOf('id="sideNav"');
  return UI.slice(UI.lastIndexOf('<nav', i), UI.indexOf('</nav>', i));
}

// ------------------------------------------------------------------ ce qui est écrit
test('barre du bas : cinq places, dans l\'ordre de sa réponse (Accueil, Home Assistant, Odin, Discussion, Plus)', () => {
  const P = places();
  // La 2e place a deux occupants dont un seul se montre à la fois : Home Assistant, ou Applis.
  assert.deepEqual(P.map((p) => p.vue ?? p.id), ['home', 'maison', 'apps', 'bnavOdin', 'chat', 'moreBtn']);
  assert.deepEqual(P.map((p) => p.libelle), ['Accueil', 'Home Assistant', 'Applis', undefined, 'Discussion', 'Plus']);
  // Au départ (avant l'état), comme au menu : Home Assistant caché, Applis à sa place ; cinq places visibles.
  assert.deepEqual(P.filter((p) => !p.cache).map((p) => p.vue ?? p.id), ['home', 'apps', 'bnavOdin', 'chat', 'moreBtn']);
  assert.equal(P.find((p) => p.vue === 'maison')!.balise.includes('href="#maison"'), true, 'Home Assistant ouvre la vue #maison d\'Odin, comme au menu');
  // Cerveau et le réseau ne sont plus dans la barre : ils sont dans « Plus ».
  for (const v of ['brain', 'net']) assert.ok(!P.some((p) => p.vue === v), `${v} n'est plus dans la barre`);
});

test('barre du bas : Odin au centre, la mascotte de l\'appli dans un rond de 52 px, un vrai bouton au clavier', () => {
  const P = places(), o = P.find((p) => p.id === 'bnavOdin')!;
  assert.match(o.balise, /^<button class="bt-odin" id="bnavOdin" type="button" aria-label="Parler à Odin" aria-haspopup="dialog" aria-expanded="false">/);
  assert.ok(!o.vue, 'pas une page : le rond n\'a pas de data-view (la connaissance de soi d\'Odin lit les data-view)');
  assert.doesNotMatch(o.balise, /<svg/, 'aucun dessin écrit à la main : la mascotte est une copie de celle de l\'appli');
  assert.match(UI, /nid\.append\(buddyClone\('buddyBas'\)\)/, 'la copie de la mascotte de la Discussion (buddyClone)');
  assert.match(UI, /const buddies = \(\) => \[[^\]]*'#buddyBas'/, 'elle prend les humeurs d\'Odin comme les autres');
  assert.match(UI, /\.bt-odin\{flex:none;width:52px;height:52px;[^}]*border-radius:50%/, 'un rond de 52 px');
  assert.match(UI, /\.bt-odin:focus-visible\{outline:2px solid/, 'le focus se voit');
  // Le rond reste dans la barre : la Discussion garde sa barre de saisie entière au-dessus.
  assert.doesNotMatch(UI, /\.bt-odin\{[^}]*margin-top:-/);
});

test('barre du bas : « Plus » ouvre le menu entier, où se trouve tout le reste', () => {
  const P = places(), plus = P.find((p) => p.id === 'moreBtn')!;
  assert.match(plus.balise, /aria-controls="sideNav"/, '« Plus » ouvre la feuille du menu');
  assert.match(UI, /\$\('#moreBtn'\)\.addEventListener\('click', \(\) => toggleNav\(!sideNav\.classList\.contains\('open'\)\)\);/);
  const m = menu(), dansBarre = new Set(P.filter((p) => p.vue).map((p) => p.vue));
  const vuesMenu = [...m.matchAll(/class="tab[^"]*" (?:id="[^"]*" )?(?:href="[^"]*" )?data-view="([^"]+)"/g)].map((x) => x[1]);
  // Chaque page du menu qui n'a pas sa place dans la barre est dans la feuille : Cerveau, le réseau, Réglages, les autres pages.
  for (const v of ['brain', 'net', 'settings', 'flows', 'runes', 'missions', 'skills', 'jobs', 'audit', 'profil', 'apps', 'maison']) assert.ok(vuesMenu.includes(v), `${v} dans la feuille « Plus »`);
  assert.ok(vuesMenu.filter((v) => !dansBarre.has(v)).length >= 9, 'le reste est dans la feuille');
  for (const id of ['navThemes', 'navEpingles', 'navMoreBtn']) assert.ok(m.includes(`id="${id}"`), `${id} dans la feuille (Thèmes, épingles, « Plus » du menu)`);
});

// ------------------------------------------------------------------ show() et la 2e place, rejoués
interface Faux { id: string; vue?: string; classes: Set<string>; attrs: Map<string, string>; hidden: boolean; lbl: string }
const faux = (id: string, vue: string | undefined, classes: string[], hidden = false, lbl = ''): Faux => ({ id, vue, classes: new Set(classes), attrs: new Map(), hidden, lbl });
function elementDe(f: Faux) {
  return {
    id: f.id, dataset: f.vue ? { view: f.vue } : {}, get hidden() { return f.hidden; }, set hidden(v: boolean) { f.hidden = v; },
    textContent: f.lbl,
    classList: { toggle: (c: string, on?: boolean) => { const v = on ?? !f.classes.has(c); if (v) f.classes.add(c); else f.classes.delete(c); return v; }, contains: (c: string) => f.classes.has(c) },
    setAttribute: (k: string, v: string) => f.attrs.set(k, v), removeAttribute: (k: string) => f.attrs.delete(k), getAttribute: (k: string) => f.attrs.get(k) ?? null,
    querySelector: () => ({ textContent: f.lbl }),
  };
}
/** Le menu et la barre du bas, comme la page les pose (membre : Home Assistant caché au menu). */
function monde(membre: boolean) {
  const menuTabs = ['home', 'maison', 'apps', 'chat', 'brain', 'net', 'flows', 'settings'].map((v) => faux(v === 'maison' ? 'navMaison' : '', v, ['tab'], v === 'maison' && membre));
  const bas = [faux('', 'home', ['tab', 'bt']), faux('bnavMaison', 'maison', ['tab', 'bt'], true), faux('bnavApps', 'apps', ['tab', 'bt']), faux('', 'chat', ['tab', 'bt'])];
  const plus = faux('moreBtn', undefined, ['tab', 'bt', 'more']), mcur = faux('mcur', undefined, []);
  const vues = ['home', 'maison', 'apps', 'chat', 'brain', 'net', 'settings'].map((v) => faux('v-' + v, undefined, ['view']));
  const els = new Map<Faux, ReturnType<typeof elementDe>>(), E = (f: Faux) => { if (!els.has(f)) els.set(f, elementDe(f)); return els.get(f)!; };
  const tous = [...menuTabs, ...bas];
  const parId = new Map([...tous, plus, mcur].filter((f) => f.id).map((f) => [f.id, f]));
  const document = {
    querySelectorAll: (sel: string) => {
      if (sel === '.tab[data-view]') return tous.map(E);
      if (sel === '.view') return vues.map(E);
      if (sel === '[data-mirror]') return [];
      throw new Error(`sélecteur inattendu : ${sel}`);
    },
    querySelector: (sel: string) => {
      if (sel === '.bnav .tab[data-view][aria-current="page"]:not([hidden])') { const f = bas.find((x) => x.attrs.get('aria-current') === 'page' && !x.hidden); return f ? E(f) : null; }
      if (sel.startsWith('#v-')) return null;
      throw new Error(`sélecteur inattendu : ${sel}`);
    },
    getElementById: (id: string) => (parId.has(id) ? E(parId.get(id)!) : null),
    dispatchEvent: () => true,
  };
  const $ = (s: string) => { const f = parId.get(s.replace(/^#/, '')); if (!f) throw new Error(`élément inattendu : ${s}`); return E(f); };
  const d = UI.indexOf('  function show(v) {'), f = UI.indexOf('\n  }\n', d);
  const dm = UI.indexOf('  const mirror = () => {'), fm = UI.indexOf('\n  };\n', dm);
  assert.ok(d > 0 && f > d && dm > 0 && fm > dm, 'show() et mirror() trouvés');
  const ctx = { document, $, window: {}, localStorage: { setItem() {} }, CustomEvent: function CustomEvent() {}, toggleNav() {}, navMore() {}, SECONDARY: ['flows'], grow() {}, placeTip() {}, setTimeout() {} };
  vm.runInNewContext(`${UI.slice(d, f + 4)}\n${UI.slice(dm, fm + 5)}\nthis.show = show; this.mirror = mirror;`, ctx);
  const c = ctx as unknown as { show: (v: string) => void; mirror: () => void };
  return { show: c.show, mirror: c.mirror, bas, plus, menuTabs };
}
const courant = (fs: Faux[]) => fs.filter((f) => f.attrs.get('aria-current') === 'page').map((f) => f.vue);

test('la 2e place : Home Assistant pour le propriétaire, Applis pour un membre (comme au menu)', () => {
  const p = monde(false); p.mirror();
  assert.deepEqual(p.bas.filter((f) => !f.hidden).map((f) => f.vue), ['home', 'maison', 'chat'], 'propriétaire : Home Assistant');
  const m = monde(true); m.mirror();
  assert.deepEqual(m.bas.filter((f) => !f.hidden).map((f) => f.vue), ['home', 'apps', 'chat'], 'membre : Applis à la place');
  // L'entrée du menu se cache plus tard (état reçu) : la barre suit.
  p.menuTabs[1].hidden = true; p.mirror();
  assert.deepEqual(p.bas.filter((f) => !f.hidden).map((f) => f.vue), ['home', 'apps', 'chat']);
});

test('la page ouverte est marquée (aria-current) ; « Plus » est marqué quand elle n\'est pas dans la barre', () => {
  const p = monde(false); p.mirror();
  p.show('home');
  assert.deepEqual(courant(p.bas), ['home']); assert.equal(p.plus.classes.has('cur'), false);
  p.show('maison');
  assert.deepEqual(courant(p.bas), ['maison'], 'Home Assistant marqué (l\'écran de la maison dans Odin)');
  assert.equal(p.plus.classes.has('cur'), false);
  p.show('chat');
  assert.deepEqual(courant(p.bas), ['chat']); assert.equal(p.plus.classes.has('cur'), false);
  for (const v of ['brain', 'net', 'settings', 'apps', 'venus', 'device']) {
    p.show(v);
    assert.equal(p.plus.classes.has('cur'), true, `${v} : dans « Plus », qui est marqué`);
  }
  // Un membre : Applis est dans la barre ; Vénus (une appli) y marque Applis.
  const m = monde(true); m.mirror();
  m.show('venus');
  assert.deepEqual(courant(m.bas.filter((f) => !f.hidden)), ['apps']); assert.equal(m.plus.classes.has('cur'), false);
  m.show('maison');
  assert.equal(m.plus.classes.has('cur'), true, 'un membre n\'a pas Home Assistant dans la barre');
  // La place change pendant qu'une page est ouverte : « Plus » suit.
  const q = monde(false); q.show('apps'); assert.equal(q.plus.classes.has('cur'), false, 'Applis encore là avant l\'état');
  q.mirror(); assert.equal(q.plus.classes.has('cur'), true, 'Home Assistant arrive, Applis passe dans « Plus »');
});

test('la visite guidée dit la barre du bas', () => {
  assert.match(UI, /Sur téléphone, la barre du bas garde Accueil, Home Assistant \(sinon Applis\), mon rond au centre \(touche-le pour me parler ; je m\\'y pose quand je ne suis pas déjà ailleurs sur l\\'écran\), Discussion, et « Plus », qui ouvre tout le reste\./);
});

// ------------------------------------------------------------------ dans un vrai navigateur
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const window: any, document: any, getComputedStyle: any, innerHeight: number, innerWidth: number;
interface Page {
  goto(u: string): Promise<unknown>; click(s: string): Promise<void>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | (() => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<R>(f: string | (() => R)): Promise<R>;
  waitForTimeout(ms: number): Promise<void>; keyboard: { press(k: string): Promise<void> }; screenshot(o: Record<string, unknown>): Promise<unknown>; focus(s: string): Promise<void>;
  tap(s: string): Promise<void>; emulateMedia(o: Record<string, unknown>): Promise<void>;
  route(u: string, f: (r: { fetch(): Promise<{ json(): Promise<Record<string, unknown>> }>; fulfill(o: Record<string, unknown>): Promise<void> }) => Promise<void>): Promise<void>;
  on(e: string, f: (x: Error) => void): void;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: () => void): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
// Captures facultatives (ODIN_CAPTURES=<dossier>) : pour regarder l'écran, jamais exigées par l'essai.
const CAPTURES = process.env.ODIN_CAPTURES;
const capture = async (p: Page, nom: string) => { if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/${nom}.png` }); };

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let od: VraiOdin, nav: Navigateur;
before(async () => {
  if (!pw) return;
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  od = await vraiOdin(tt, { compte: true });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); });

async function ouvrir(largeur: number, o: { membre?: boolean; sombre?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 844 : 860 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', colorScheme: o.sombre ? 'dark' : 'light' });
  const [n, ...v] = od.session.split('=');
  await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('odin.tour', 'done'); } catch { /* rien */ } });
  // Le thème sombre d'Odin lui-même (le mode « sombre » du thème Valhalla, posé plus bas).
  if (o.sombre) await ctx.addInitScript(() => { try { localStorage.setItem('odin.theme', 'sombre'); } catch { /* rien */ } });
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  if (o.membre) await page.route('**/api/state', async (r) => { const j = await (await r.fetch()).json(); await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...j, membre: { login: 'camille', name: 'Camille', groups: ['freyja'] } }) }); });
  await page.goto(od.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  return { ctx, page, erreurs };
}
/** Les places visibles de la barre : libellé (ou nom pour le rond), hauteur, largeur, marquée. */
const lirePlaces = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.bnav > *')].filter((x: any) => getComputedStyle(x).display !== 'none').map((x: any) => {
  const r = x.getBoundingClientRect();
  return { nom: (x.querySelector('.lbl')?.textContent ?? x.getAttribute('aria-label') ?? '').trim(), h: Math.round(r.height), l: Math.round(r.width), courant: x.getAttribute('aria-current') === 'page' || x.classList.contains('cur') };
}));

test('téléphone, propriétaire : cinq places, Odin au centre ; « Plus » ouvre tout le reste ; la maison et Vénus dans Odin', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    await page.waitForFunction(() => !document.getElementById('bnavMaison').hidden, undefined, { timeout: 15000 });
    await page.waitForTimeout(400);
    await capture(page, 'accueil-390-clair');
    const P = await lirePlaces(page);
    assert.deepEqual(P.map((p) => p.nom), ['Accueil', 'Home Assistant', 'Parler à Odin', 'Discussion', 'Plus']);
    assert.deepEqual(P.map((p) => p.courant), [true, false, false, false, false], 'l\'accueil est marqué');
    for (const p of P) assert.ok(p.h >= 44 && p.l >= 44, `${p.nom} : 44 px au doigt (${p.l}×${p.h})`);
    const o = await page.evaluate(() => { const b = document.getElementById('bnavOdin').getBoundingClientRect(), n = document.querySelector('.bnav').getBoundingClientRect(), m = document.querySelector('#bnavOdin .odin');
      return { l: Math.round(b.width), h: Math.round(b.height), dedans: b.top >= n.top - 0.5 && b.bottom <= n.bottom + 0.5, mascotte: Boolean(m && m.querySelector('svg .eyes')), large: document.documentElement.scrollWidth <= 390 }; });
    assert.deepEqual(o, { l: 52, h: 52, dedans: true, mascotte: true, large: true });
    // Odin au centre : un appui ouvre la petite fenêtre pour lui parler ; un second la ferme.
    await page.tap('#bnavOdin');
    await page.waitForFunction(() => document.getElementById('odinTalk') && !document.getElementById('odinTalk').hidden, undefined, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.getElementById('bnavOdin').getAttribute('aria-expanded')), 'true');
    await capture(page, 'odin-centre-390');
    await page.tap('#bnavOdin');
    await page.waitForFunction(() => document.getElementById('odinTalk').hidden, undefined, { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.getElementById('bnavOdin').getAttribute('aria-expanded')), 'false');
    // « Plus » : la feuille du menu, avec tout le reste.
    await page.tap('#moreBtn');
    await page.waitForSelector('#sideNav.open', { timeout: 5000 });
    await page.waitForTimeout(350);
    await capture(page, 'plus-390');
    const feuille = await page.evaluate(() => [...document.querySelectorAll('#sideNav .tab')].filter((x: any) => !x.hidden && x.getBoundingClientRect().height > 0).map((x: any) => x.querySelector('.lbl')?.textContent.trim()));
    for (const l of ['Applis', 'Cerveau', 'Thèmes', 'Maison', 'Réglages']) assert.ok(feuille.includes(l), `« ${l} » dans « Plus » : ${feuille.join(', ')}`);
    await page.tap('#sideNav .tab[data-view="brain"]');
    await page.waitForSelector('#v-brain.on', { timeout: 5000 });
    assert.equal((await lirePlaces(page)).find((p) => p.nom === 'Plus')!.courant, true, 'le Cerveau ouvert : « Plus » marqué');
    // Home Assistant : l'écran de la maison dans Odin, seulement la barre du bas d'Odin.
    await page.tap('#bnavMaison');
    await page.waitForFunction(() => Boolean(document.querySelector('#v-maison iframe')?.contentDocument?.querySelector('.app main')), undefined, { timeout: 20000 });
    await page.waitForTimeout(600);
    await capture(page, 'maison-dans-odin-390');
    const m = await page.evaluate(() => { const b = document.querySelector('.bnav').getBoundingClientRect(), f = document.querySelector('#v-maison iframe').getBoundingClientRect();
      return { courant: document.getElementById('bnavMaison').getAttribute('aria-current'), sous: f.bottom <= b.top + 1, enBas: b.bottom <= innerHeight + 1, barreMaison: getComputedStyle(document.querySelector('#v-maison iframe').contentDocument.querySelector('.bnav')).display }; });
    assert.deepEqual(m, { courant: 'page', sous: true, enBas: true, barreMaison: 'none' });
    // Vénus dans Odin : la barre d'Odin reste, « Plus » marqué (Applis est dans « Plus » pour le propriétaire).
    await page.evaluate(() => { window.OdinShow('apps'); window.OdinApps.app('freyja'); });
    await page.waitForSelector('#v-venus.on iframe.vv-cadre', { timeout: 20000 });
    await page.waitForTimeout(800);
    await capture(page, 'venus-dans-odin-390');
    const vn = await page.evaluate(() => { const b = document.querySelector('.bnav').getBoundingClientRect(), f = document.querySelector('#v-venus iframe').getBoundingClientRect(); return { sous: f.bottom <= b.top + 1, plus: document.getElementById('moreBtn').classList.contains('cur') }; });
    assert.deepEqual(vn, { sous: true, plus: true });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('téléphone, thème sombre d\'Odin, au clavier : le rond est dans l\'ordre des Tab, Entrée ouvre la fenêtre, Échap la ferme et rend le focus', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390, { sombre: true });
  try {
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.OdinThemes.apply('valhalla'));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'le thème sombre d\'Odin');
    await capture(page, 'accueil-390-sombre');
    // Depuis « Discussion », Maj + Tab revient sur le rond : il est dans l'ordre du clavier, entre la 2e place et Discussion.
    await page.focus('.bnav .tab[data-view="chat"]');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'bnavOdin');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('odinTalk') && !document.getElementById('odinTalk').hidden, undefined, { timeout: 5000 });
    await capture(page, 'odin-centre-390-sombre');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('odinTalk').hidden, undefined, { timeout: 5000 });
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => ({ focus: document.activeElement?.id, ouvert: document.getElementById('bnavOdin').getAttribute('aria-expanded') })), { focus: 'bnavOdin', ouvert: 'false' });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('téléphone, membre : Applis à la place de Home Assistant ; toujours cinq places', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390, { membre: true });
  try {
    await page.waitForTimeout(1500);
    await capture(page, 'membre-390');
    const P = await lirePlaces(page);
    assert.deepEqual(P.map((p) => p.nom), ['Accueil', 'Applis', 'Parler à Odin', 'Discussion', 'Plus']);
    await page.tap('#bnavApps');
    await page.waitForSelector('#v-apps.on', { timeout: 5000 });
    assert.deepEqual((await lirePlaces(page)).map((p) => p.courant), [false, true, false, false, false], 'Applis marquée');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('ordinateur (1280 px) : pas de barre du bas', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.bnav')).display), 'none');
    await capture(page, 'accueil-1280');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

/** Les mascottes vraiment visibles à l'écran (la page et les cadres de la même origine) : leur identifiant ou leur classe. */
const mascottesVues = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  const voir = (doc: any, win: any, dx = 0, dy = 0) => {
    for (const o of doc.querySelectorAll('.odin, .pet')) {
      const r = o.getBoundingClientRect(); if (r.width < 8 || r.height < 8) continue;
      const x = r.left + dx, y = r.top + dy; if (y + r.height <= 0 || y >= innerHeight || x + r.width <= 0 || x >= innerWidth) continue;
      if (win.getComputedStyle(o).visibility === 'hidden') continue;
      let e = o, cache = false; while (e) { const s = win.getComputedStyle(e); if (s.display === 'none' || Number(s.opacity) === 0) { cache = true; break; } e = e.parentElement; }
      if (!cache) out.push(o.id || String(o.className));
    }
    for (const f of doc.querySelectorAll('iframe')) { const fr = f.getBoundingClientRect(); try { if (fr.width && f.contentDocument) voir(f.contentDocument, f.contentWindow, dx + fr.left, dy + fr.top); } catch { /* autre origine */ } }
  };
  voir(document, window);
  return out;
});

test('téléphone : une seule mascotte à l\'écran — le rond garde son nid (la rune d\'Odin) quand Odin est déjà ailleurs', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    await page.waitForFunction(() => !document.getElementById('bnavMaison').hidden, undefined, { timeout: 15000 });
    // L'accueil : Odin se promène ; le rond ne montre pas une deuxième mascotte, mais la rune.
    await page.waitForFunction(() => { const b = document.getElementById('buddyRoam'); return b && !b.hidden && b.getBoundingClientRect().width > 8; }, undefined, { timeout: 15000 });
    await page.waitForTimeout(2500);
    await capture(page, 'une-mascotte-accueil-390');
    assert.deepEqual(await mascottesVues(page), ['buddyRoam'], 'à l\'accueil : Odin en liberté, seul');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#bnavOdin .nid-rune')).display !== 'none'), true, 'le rond montre la rune d\'Odin');
    // La Discussion : sa mascotte à elle, seule.
    await page.tap('.bnav .tab[data-view="chat"]');
    await page.waitForSelector('#v-chat.on', { timeout: 5000 });
    await page.waitForTimeout(800);
    assert.deepEqual(await mascottesVues(page), ['buddyChat'], 'dans la Discussion : sa mascotte, seule');
    // La maison dans Odin : la mascotte en liberté est cachée là ; Odin est au centre de la barre, seul.
    await page.tap('#bnavMaison');
    await page.waitForFunction(() => Boolean(document.querySelector('#v-maison iframe')?.contentDocument?.querySelector('.app main')), undefined, { timeout: 20000 });
    await page.waitForTimeout(1200);
    await capture(page, 'une-mascotte-maison-390');
    // (la mascotte de l'écran de la maison est un .pet qui contient un .odin : un seul Odin, deux éléments)
    const m = await mascottesVues(page);
    assert.ok(!m.includes('buddyBas') && !m.includes('buddyRoam') && m.some((x) => x.split(' ').includes('pet')), `dans la maison : sa mascotte à elle, seule (${m.join(', ')})`);
    // Vénus n'a pas de mascotte, et celle en liberté y est cachée : Odin est dans le rond, seul.
    await page.evaluate(() => { window.OdinShow('apps'); window.OdinApps.app('freyja'); });
    await page.waitForSelector('#v-venus.on iframe.vv-cadre', { timeout: 20000 });
    await page.waitForTimeout(1200);
    await capture(page, 'une-mascotte-venus-390');
    assert.deepEqual(await mascottesVues(page), ['buddyBas'], 'dans Vénus : Odin au centre de la barre, seul');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('téléphone : la fenêtre « Parler à Odin » ouverte par le rond se pose au-dessus du rond, dans l\'écran', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    await page.waitForFunction(() => !document.getElementById('bnavMaison').hidden, undefined, { timeout: 15000 });
    await page.waitForTimeout(2500);
    // Beaucoup de notifications : la fenêtre serait plus haute que la place au-dessus du rond (elle défile alors à l'intérieur).
    await page.evaluate(() => { for (let i = 0; i < 14; i++) window.OdinNotices.local({ title: `Essai ${i}`, level: 'ok', kind: 'Info' }); });
    await page.tap('#bnavOdin');
    await page.waitForFunction(() => document.getElementById('odinTalk') && !document.getElementById('odinTalk').hidden, undefined, { timeout: 5000 });
    await page.waitForTimeout(700);
    await capture(page, 'fenetre-au-dessus-du-rond-390');
    // Sa pointe montre le rond (et pas la mascotte en liberté) ; la fenêtre est juste au-dessus, dans l'écran.
    const p = await page.evaluate(() => { const t = document.getElementById('odinTalk').getBoundingClientRect(), o = document.getElementById('bnavOdin').getBoundingClientRect(), q = document.querySelector('#odinTalk .ot-tail').getBoundingClientRect(), c = q.left + q.width / 2;
      return { dessus: t.bottom <= o.top + 1 && o.top - t.bottom < 40, pointe: q.width > 0 && o.left <= c && c <= o.right, dansEcran: t.left >= 0 && t.right <= innerWidth && t.top >= 0 }; });
    assert.deepEqual(p, { dessus: true, pointe: true, dansEcran: true });
    // Fermée, puis rouverte autrement (comme un toucher sur la mascotte en liberté) : elle retourne près d'elle.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('odinTalk').hidden, undefined, { timeout: 5000 });
    await page.evaluate(() => window.OdinNotices.talk());
    await page.waitForTimeout(700);
    const q = await page.evaluate(() => { const o = document.getElementById('bnavOdin').getBoundingClientRect(), q = document.querySelector('#odinTalk .ot-tail').getBoundingClientRect(), b = document.getElementById('buddyRoam').getBoundingClientRect(), c = q.left + q.width / 2;
      return q.width === 0 || (b.left - 12 <= c && c <= b.right + 12) || !(o.left <= c && c <= o.right); });
    assert.equal(q, true, 'ouverte par la mascotte en liberté : posée près d\'elle');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
