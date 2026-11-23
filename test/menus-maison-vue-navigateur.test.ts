// L'écran de la maison DANS Odin, dans un vrai navigateur et un vrai Odin d'essai : l'entrée « Home Assistant » ouvre
// la vue sans quitter la page (même document), le menu reste (ordinateur) comme la barre du bas (téléphone), retour et
// avance du navigateur, rien ne reste en quittant la vue, /maison inchangée pour une tablette, rien pour un membre.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';

// Le code passé au navigateur (evaluate) : le projet n'a pas les types du navigateur (pas de « dom » dans tsconfig).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const window: any, document: any, location: any, innerHeight: number;
type Window = { closed: boolean };
type HTMLIFrameElement = { contentDocument: any; contentWindow: any };
interface Cadre { url(): string; evaluate<R>(f: () => R): Promise<R> }
interface Page {
  goto(u: string): Promise<unknown>; click(s: string): Promise<void>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | (() => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<R>(f: string | (() => R)): Promise<R>;
  mouse: { move(x: number, y: number): Promise<void> }; goBack(): Promise<unknown>; goForward(): Promise<unknown>; frames(): Cadre[]; waitForTimeout(ms: number): Promise<void>;
  route(u: string, f: (r: { fetch(): Promise<{ json(): Promise<Record<string, unknown>> }>; fulfill(o: Record<string, unknown>): Promise<void> }) => Promise<void>): Promise<void>;
  on(e: string, f: (x: { type?: () => string; text?: () => string } & Error) => void): void;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: () => void): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';

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
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 800 : 860 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  if (o.session !== false) { const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]); }
  await ctx.addInitScript(() => { try { localStorage.setItem('odin.tour', 'done'); } catch { /* rien */ } });
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  // Un membre : la page reçoit « membre » dans son état (le serveur, lui, refuse déjà /api/maison/* à un membre : maison-membre).
  if (o.membre) await page.route('**/api/state', async (r) => { const j = await (await r.fetch()).json(); await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...j, membre: { login: 'camille', name: 'Camille', groups: ['gladsheim'] } }) }); });
  await page.goto(od.url + (o.adresse ?? '/'));
  return { ctx, page, erreurs };
}
const cadreMaison = (p: Page) => p.frames().find((f) => new URL(f.url(), 'http://x').pathname === '/maison');

test('ordinateur : l\'entrée ouvre la vue dans la page, menu à côté ; retour, avance ; rien ne reste en quittant', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    await page.waitForSelector('#navMaison:not([hidden])', { timeout: 15000 });
    await page.evaluate(() => { (window as unknown as { __meme: number }).__meme = 42; });
    const cadresAvant = page.frames().length;
    await page.click('#navMaison');
    await page.waitForSelector('#v-maison.on iframe.vm-cadre', { timeout: 10000 });
    await page.waitForFunction(() => { const f = (document.querySelector('#v-maison iframe') as HTMLIFrameElement | null); return Boolean(f?.contentDocument?.querySelector('.app main')); }, undefined, { timeout: 20000 });
    // La souris quitte le menu : il se replie en colonne d'icônes (pages/menu-replie.js), l'écran de la maison à côté.
    await page.mouse.move(900, 500); await page.waitForTimeout(900);
    const e = await page.evaluate(() => ({
      meme: (window as unknown as { __meme?: number }).__meme, hash: location.hash, chemin: location.pathname,
      cadres: document.querySelectorAll('iframe').length, scriptMaison: document.querySelectorAll('script[src="/maison.js"]').length,
      menu: (() => { const r = document.getElementById('sideNav')!.getBoundingClientRect(); return r.width >= 48 && r.height > 300 && document.getElementById('navMaison')!.getBoundingClientRect().width > 0; })(),
      courant: document.getElementById('navMaison')!.getAttribute('aria-current'),
      cadre: (() => { const r = document.querySelector('#v-maison iframe')!.getBoundingClientRect(), m = document.getElementById('sideNav')!.getBoundingClientRect(); return { x: Math.round(r.left), l: Math.round(r.width), h: Math.round(r.height), menuDroite: Math.round(m.right) }; })(),
    }));
    assert.equal(e.meme, 42, 'même document : la page d\'Odin n\'a pas été remplacée');
    assert.equal(e.hash, '#maison'); assert.equal(e.chemin, '/', 'l\'adresse change sans quitter Odin');
    assert.equal(e.cadres, 1); assert.equal(e.scriptMaison, 0, 'le script de la maison n\'est pas chargé dans Odin');
    assert.ok(e.menu, 'le menu d\'Odin reste visible'); assert.equal(e.courant, 'page', 'l\'entrée est marquée');
    assert.ok(e.cadre.x >= e.cadre.menuDroite - 1 && e.cadre.x >= 48 && e.cadre.l > 700 && e.cadre.h > 600, `l'écran de la maison à côté du menu : ${JSON.stringify(e.cadre)}`);
    const f = cadreMaison(page)!;
    const dedans = await f.evaluate(() => ({ retour: document.querySelectorAll('.retour').length, nav: document.querySelectorAll('.side .nav').length, top: window.top !== window }));
    assert.equal(dedans.retour, 0, '« ← Odin » n\'est pas dans la vue'); assert.ok(dedans.nav >= 2, 'les sections de l\'écran de la maison'); assert.ok(dedans.top);
    // Retour du navigateur : l'accueil revient, le cadre est retiré ; avance : la maison revient.
    await page.evaluate(() => { (window as unknown as { __w: Window | null }).__w = (document.querySelector('#v-maison iframe') as HTMLIFrameElement | null)!.contentWindow; });
    await page.goBack();
    await page.waitForSelector('#v-home.on', { timeout: 5000 });
    const r = await page.evaluate(() => ({ meme: (window as unknown as { __meme?: number }).__meme, cadres: document.querySelectorAll('iframe').length, ferme: (window as unknown as { __w: Window }).__w.closed }));
    assert.deepEqual(r, { meme: 42, cadres: 0, ferme: true }, 'retour : même page, cadre retiré et sa fenêtre fermée (minuteurs et écouteurs partis avec elle)');
    assert.equal(page.frames().length, cadresAvant, 'aucun cadre ne reste');
    await page.goForward();
    await page.waitForSelector('#v-maison.on iframe.vm-cadre', { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('iframe').length), 1);
    // Quitter par le menu : cadre retiré, #maison retiré de l'adresse.
    await page.click('#sideNav .tab[data-view="chat"]');
    await page.waitForSelector('#v-chat.on', { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => ({ h: location.hash, n: document.querySelectorAll('iframe').length })), { h: '', n: 0 });
    // Rouvrir deux fois de suite : toujours un seul cadre.
    await page.click('#navMaison'); await page.click('#navMaison');
    await page.waitForSelector('#v-maison.on iframe.vm-cadre', { timeout: 5000 }); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelectorAll('iframe').length), 1, 'un seul cadre');
    // Page rechargée sur /#maison : la vue revient, un seul cadre.
    await page.evaluate(() => location.reload());
    await page.waitForSelector('#v-maison.on iframe.vm-cadre', { timeout: 30000 });
    await page.waitForFunction(() => { const f = (document.querySelector('#v-maison iframe') as HTMLIFrameElement | null); return Boolean(f?.contentDocument?.querySelector('.app main')); }, undefined, { timeout: 20000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('iframe').length), 1, 'rechargée : un seul cadre');
    await page.evaluate(() => { window.__meme = 7; });
    // « Mes applis » de l'écran de la maison : un lien vers une appli s'ouvre dans Odin (même page), pas dans un nouvel onglet.
    await cadreMaison(page)!.evaluate(() => { document.querySelector('.side .nav[aria-label="Mes applis"]').click(); });
    await page.waitForFunction(() => Boolean((document.querySelector('#v-maison iframe') as HTMLIFrameElement | null)?.contentDocument?.querySelector('a.appc')), undefined, { timeout: 10000 });
    const cible = await cadreMaison(page)!.evaluate(() => [...document.querySelectorAll('a.appc')].map((a: { getAttribute(n: string): string }) => a.getAttribute('target')));
    assert.ok(cible.length > 0 && cible.every((t) => t === '_top'), `liens vers Odin : ${cible.join(',')}`);
    await cadreMaison(page)!.evaluate(() => { document.querySelector('a.appc').click(); });
    await page.waitForSelector('#v-apps.on', { timeout: 10000 });
    assert.deepEqual(await page.evaluate(() => ({ meme: window.__meme, app: /^#app=/.test(location.hash), n: document.querySelectorAll('#v-maison iframe').length })), { meme: 7, app: true, n: 0 }, 'l\'appli s\'ouvre dans la même page d\'Odin, la vue de la maison est quittée');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('téléphone : la vue s\'ouvre dans Odin, la barre du bas reste', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('navMaison')!.hidden, undefined, { timeout: 15000 });
    await page.click('#moreBtn'); await page.click('#navMaison');
    await page.waitForSelector('#v-maison.on iframe.vm-cadre', { timeout: 10000 });
    const e = await page.evaluate(() => {
      const b = document.querySelector('.bnav')!.getBoundingClientRect(), f = document.querySelector('#v-maison iframe')!.getBoundingClientRect();
      return { barre: b.height > 30 && b.bottom <= innerHeight + 1, sousCadre: f.bottom <= b.top + 1, largeur: Math.round(f.width), menuFerme: !document.getElementById('sideNav')!.classList.contains('open'), titre: document.getElementById('mcur')!.textContent };
    });
    assert.deepEqual(e, { barre: true, sousCadre: true, largeur: 390, menuFerme: true, titre: 'Home Assistant' });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('membre : pas d\'entrée, et même par l\'adresse #maison, aucun écran de la maison', { skip: sans }, async () => {
  const { ctx, page } = await ouvrir(1280, { membre: true, adresse: '/#maison' });
  try {
    await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const e = await page.evaluate(() => ({ entree: document.getElementById('navMaison')!.hidden, cadres: document.querySelectorAll('iframe').length, texte: document.getElementById('v-maison')!.textContent }));
    assert.equal(e.entree, true, 'entrée cachée'); assert.equal(e.cadres, 0, 'aucun cadre');
    assert.doesNotMatch(e.texte ?? '', /Bonjour|Bonsoir|Thèmes/, 'rien de l\'écran de la maison');
  } finally { await ctx.close(); }
});

test('/maison : inchangée pour une tablette murale (clé « maison », page seule, sans « ← Odin »)', { skip: sans }, async () => {
  const k = await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: `Tablette ${Date.now()}`, droits: 'maison' });
  const cle = (k.data as { key?: string } | undefined)?.key ?? '';
  assert.match(cle, /^gk_/);
  const { ctx, page, erreurs } = await ouvrir(1280, { session: false, adresse: `/maison#cle=${cle}` });
  try {
    await page.waitForSelector('.app main .top', { timeout: 20000 });
    const e = await page.evaluate(() => ({ seule: window.top === window, chemin: location.pathname, hash: location.hash, retour: document.querySelectorAll('.retour').length, odin: Boolean(document.getElementById('sideNav')) }));
    assert.deepEqual(e, { seule: true, chemin: '/maison', hash: '', retour: 0, odin: false });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
  // Le propriétaire qui ouvre /maison seule garde son « ← Odin ».
  const p = await ouvrir(1280, { adresse: '/maison' });
  try {
    await p.page.waitForSelector('.app main .top .retour', { timeout: 20000 });
  } finally { await p.ctx.close(); }
});
