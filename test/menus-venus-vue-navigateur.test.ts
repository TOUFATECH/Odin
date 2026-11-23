// Vénus DANS Odin, et l'écran de la maison dans Odin au téléphone, dans un vrai navigateur et un vrai Odin d'essai :
//  - Vénus : ouvrir l'appli pose la vue #venus sans quitter la page d'Odin (même document), le menu d'Odin à côté
//    (ordinateur) ou sa barre du bas (téléphone) ; l'interface de Venus garde son rail et sa barre DANS le cadre, sans
//    « ‹ Odin » ; le plein écran est permis au cadre ; retour du navigateur ; la page de gestion reste joignable ; rien
//    pour un membre ;
//  - la maison au téléphone : la barre du bas de l'écran de la maison se cache dans Odin, ses sections passent dans un
//    menu en haut (44 px, clavier) ; /maison seule (tablette) garde sa barre du bas.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';

// Le code passé au navigateur (evaluate) : le projet n'a pas les types du navigateur (pas de « dom » dans tsconfig).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const window: any, document: any, location: any, innerHeight: number, getComputedStyle: any;
interface Cadre { url(): string; evaluate<R>(f: () => R): Promise<R>; press(s: string, k: string): Promise<void>; focus(s: string): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; click(s: string): Promise<void>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | (() => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<R>(f: string | (() => R)): Promise<R>;
  frames(): Cadre[]; waitForTimeout(ms: number): Promise<void>; goBack(): Promise<unknown>; goForward(): Promise<unknown>;
  keyboard: { press(k: string): Promise<void> }; screenshot(o: Record<string, unknown>): Promise<unknown>;
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

async function ouvrir(largeur: number, o: { session?: boolean; membre?: boolean; adresse?: string } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 844 : 860 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  if (o.session !== false) { const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]); }
  await ctx.addInitScript(() => { try { localStorage.setItem('odin.tour', 'done'); } catch { /* rien */ } });
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  if (o.membre) await page.route('**/api/state', async (r) => { const j = await (await r.fetch()).json(); await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...j, membre: { login: 'camille', name: 'Camille', groups: ['freyja'] } }) }); });
  await page.goto(od.url + (o.adresse ?? '/'));
  return { ctx, page, erreurs };
}
const chemin = (f: Cadre) => new URL(f.url(), 'http://x').pathname;
const cadreVenus = (p: Page) => p.frames().find((f) => chemin(f) === '/venus/app/');
const cadreMaison = (p: Page) => p.frames().find((f) => chemin(f) === '/maison');
/** Ouvre Vénus comme depuis la liste des applis, et attend son interface dans le cadre. */
async function ouvrirVenus(page: Page) {
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await page.evaluate(() => { window.OdinShow('apps'); window.OdinApps.app('freyja'); });
  await page.waitForSelector('#v-venus.on iframe.vv-cadre', { timeout: 20000 });
  await page.waitForFunction(() => Boolean(document.querySelector('#v-venus iframe')?.contentDocument?.querySelector('#app main')), undefined, { timeout: 20000 });
  await page.waitForTimeout(400);
}

test('Vénus, ordinateur : dans la page d\'Odin, menu à côté, sans « ‹ Odin », plein écran permis ; retour ; gestion joignable', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    await page.evaluate(() => { window.__meme = 42; });
    await ouvrirVenus(page);
    await capture(page, 'venus-1280');
    const e = await page.evaluate(() => ({
      meme: window.__meme, hash: location.hash, chemin: location.pathname, cadres: document.querySelectorAll('iframe').length,
      titre: document.getElementById('mcur').textContent, applis: document.querySelector('#sideNav .tab[data-view="apps"]').getAttribute('aria-current'),
      cadre: (() => { const r = document.querySelector('#v-venus iframe').getBoundingClientRect(), m = document.getElementById('sideNav').getBoundingClientRect(); return { x: Math.round(r.left), l: Math.round(r.width), h: Math.round(r.height), menuDroite: Math.round(m.right), menuL: Math.round(m.width) }; })(),
      roam: (() => { const b = document.getElementById('buddyRoam'); return !b || getComputedStyle(b).visibility === 'hidden'; })(),
    }));
    assert.equal(e.meme, 42, 'même document : la page d\'Odin n\'a pas été remplacée');
    assert.equal(e.hash, '#venus'); assert.equal(e.chemin, '/');
    assert.equal(e.cadres, 1); assert.equal(e.titre, 'Vénus'); assert.equal(e.applis, 'page', '« Applis » marquée dans le menu');
    assert.ok(e.cadre.menuL >= 48 && e.cadre.x >= e.cadre.menuDroite - 1 && e.cadre.l > 700 && e.cadre.h > 600, `Vénus à côté du menu : ${JSON.stringify(e.cadre)}`);
    assert.ok(e.roam, 'la mascotte d\'Odin ne se promène pas sur Vénus');
    const f = cadreVenus(page)!;
    const dedans = await f.evaluate(() => ({ odin: document.querySelectorAll('.odin-back,[data-act="odin"]').length, rail: Boolean(document.querySelector('nav.rail')), plein: document.fullscreenEnabled, top: window.top !== window }));
    assert.deepEqual(dedans, { odin: 0, rail: true, plein: true, top: true }, 'son rail reste, sans « ‹ Odin » ; le lecteur peut passer en plein écran');
    // Échap dans le cadre reste dans le cadre : le menu d'Odin ne bouge pas, la vue reste.
    await f.focus('nav.rail a'); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('#v-venus.on') !== null && location.hash === '#venus'), true);
    // Retour du navigateur (autant de fois que Venus a ajouté de pages dans son cadre) : la liste des applis revient, le cadre est retiré.
    for (let i = 0; i < 6 && await page.evaluate(() => location.hash === '#venus'); i++) { await page.goBack(); await page.waitForTimeout(250); }
    await page.waitForSelector('#v-apps.on', { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => ({ meme: window.__meme, n: document.querySelectorAll('iframe').length })), { meme: 42, n: 0 });
    await page.goForward();
    await page.waitForSelector('#v-venus.on iframe.vv-cadre', { timeout: 5000 });
    // Quitter par le menu : cadre retiré, #venus retiré.
    await page.click('#sideNav .tab[data-view="chat"]');
    await page.waitForSelector('#v-chat.on', { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => ({ h: location.hash, n: document.querySelectorAll('iframe').length })), { h: '', n: 0 });
    // « Médiathèques et écrans » depuis Venus : la page de gestion d'avant, dans la page d'Odin (pas dans le cadre).
    await ouvrirVenus(page);
    await cadreVenus(page)!.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'classique'; document.body.append(b); b.click(); });
    await page.waitForSelector('#v-app.on .vn-tete', { timeout: 30000 });
    assert.deepEqual(await page.evaluate(() => ({ n: document.querySelectorAll('iframe.vv-cadre').length, cherche: location.search, top: window.top === window })), { n: 0, cherche: '', top: true });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('Vénus, téléphone : la barre du bas d\'Odin reste ; la barre de Venus est dans le cadre, sans « Odin »', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    await ouvrirVenus(page);
    await capture(page, 'venus-390');
    const e = await page.evaluate(() => {
      const b = document.querySelector('.bnav').getBoundingClientRect(), f = document.querySelector('#v-venus iframe').getBoundingClientRect();
      return { barre: b.height > 30 && b.bottom <= innerHeight + 1, sousCadre: f.bottom <= b.top + 1, largeur: Math.round(f.width), large: document.documentElement.scrollWidth <= 390 };
    });
    assert.deepEqual(e, { barre: true, sousCadre: true, largeur: 390, large: true });
    const dedans = await cadreVenus(page)!.evaluate(() => ({ odin: document.querySelectorAll('.odin-back').length, onglets: Boolean(document.querySelector('nav.tabbar')), deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 }));
    assert.deepEqual(dedans, { odin: 0, onglets: true, deborde: false });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('Vénus, membre : même par l\'adresse #venus, aucun cadre', { skip: sans }, async () => {
  const { ctx, page } = await ouvrir(1280, { membre: true, adresse: '/#venus' });
  try {
    await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const e = await page.evaluate(() => ({ cadres: document.querySelectorAll('iframe').length, texte: document.getElementById('v-venus').textContent }));
    assert.equal(e.cadres, 0);
    assert.match(e.texte, /propriétaire/);
  } finally { await ctx.close(); }
});

test('maison dans Odin, téléphone : seule la barre du bas d\'Odin ; les sections en haut (44 px, clavier)', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('navMaison').hidden, undefined, { timeout: 15000 });
    await page.click('#moreBtn'); await page.click('#navMaison');
    await page.waitForFunction(() => Boolean(document.querySelector('#v-maison iframe')?.contentDocument?.querySelector('.app main .secs')), undefined, { timeout: 20000 });
    await page.waitForTimeout(600);
    await capture(page, 'maison-dans-odin-390');
    const f = cadreMaison(page)!;
    const e = await f.evaluate(() => {
      const secs = document.querySelector('.secs'), b = [...secs.querySelectorAll('button')];
      return { barre: getComputedStyle(document.querySelector('.bnav')).display, secs: getComputedStyle(secs).display, n: b.length, hauteur: Math.min(...b.map((x: any) => x.getBoundingClientRect().height)),
        courant: b.filter((x: any) => x.getAttribute('aria-current') === 'page').map((x: any) => x.textContent), deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
    assert.equal(e.barre, 'none', 'la barre du bas de la maison est cachée');
    assert.equal(e.secs, 'flex'); assert.ok(e.n >= 3); assert.ok(e.hauteur >= 44, `44 px au doigt : ${e.hauteur}`);
    assert.deepEqual(e.courant, ['Accueil']); assert.equal(e.deborde, false);
    // Clavier : flèche droite puis Entrée ouvre la section suivante, le focus reste sur le menu.
    await f.focus('.secs button[aria-current="page"]');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const apres = await f.evaluate(() => ({ courant: document.querySelector('.secs button[aria-current="page"]')?.textContent, focus: document.activeElement?.closest?.('.secs') !== null && document.activeElement?.closest?.('.secs') !== undefined }));
    assert.notEqual(apres.courant, 'Accueil'); assert.equal(apres.focus, true);
    // Une seule barre en bas de l'écran : celle d'Odin.
    const o = await page.evaluate(() => { const b = document.querySelector('.bnav').getBoundingClientRect(), fr = document.querySelector('#v-maison iframe').getBoundingClientRect(); return b.height > 30 && fr.bottom <= b.top + 1; });
    assert.equal(o, true);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('/maison seule (tablette, téléphone) : sa barre du bas reste, pas de menu en haut', { skip: sans }, async () => {
  const k = await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: `Tablette ${Date.now()}`, droits: 'maison' });
  const cle = (k.data as { key?: string } | undefined)?.key ?? '';
  const { ctx, page, erreurs } = await ouvrir(390, { session: false, adresse: `/maison#cle=${cle}` });
  try {
    await page.waitForSelector('.app main .top', { timeout: 20000 });
    await page.waitForTimeout(400);
    await capture(page, 'maison-tablette-390');
    const e = await page.evaluate(() => ({ barre: getComputedStyle(document.querySelector('.bnav')).display, secs: document.querySelectorAll('.secs').length, classe: document.documentElement.classList.contains('dans-odin') }));
    assert.deepEqual(e, { barre: 'flex', secs: 0, classe: false });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
