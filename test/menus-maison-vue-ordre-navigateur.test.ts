// Page rechargée sur /#maison (ou /#venus) : Odin ouvre la vue dès que son état arrive. Si le fichier de la vue
// (pages/vue-maison.js, pages/venus.js) n'est pas encore chargé à ce moment-là, il rate l'évènement « odin:vue » : il doit
// quand même poser le cadre, en lisant sur la page que la vue est déjà ouverte.
// Ici l'ordre est FORCÉ dans un vrai navigateur : le fichier de la vue n'est remis au navigateur qu'une fois la vue
// ouverte par Odin. Sans Playwright sur la machine, l'essai est ignoré (il le dit).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

// Le code passé au navigateur (evaluate) : le projet n'a pas les types du navigateur (pas de « dom » dans tsconfig).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const window: any, document: any;
interface Route { fetch(): Promise<unknown>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string, o?: Record<string, unknown>): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: () => unknown, a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<R>(f: () => R): Promise<R>;
  route(u: string, f: (r: Route) => Promise<void>): Promise<void>; on(e: string, f: (x: Error) => void): void;
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

/**
 * Ouvre Odin sur `adresse` ; le fichier `script` n'est remis au navigateur qu'une fois la vue `vue` ouverte par Odin.
 * Rend l'ordre constaté : la vue était ouverte, et le fichier pas encore chargé (`global` absent de la page).
 */
async function ouvrirEnRetard(adresse: string, script: string, vue: string, global: string) {
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fr-FR' });
  const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('odin.tour', 'done'); } catch { /* rien */ } });
  const page = await ctx.newPage(), erreurs: string[] = [], ordre = { vueOuverte: false, fichierAbsent: false, retenu: 0 };
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.route(`**/pages/${script}`, async (r) => {
    const reponse = await r.fetch(); ordre.retenu++;
    await page.waitForSelector(`#v-${vue}.on`, { state: 'attached', timeout: 30000 });
    ordre.vueOuverte = true;
    ordre.fichierAbsent = await page.evaluate(new Function(`return window[${JSON.stringify(global)}] === undefined`) as () => boolean);
    await r.fulfill({ response: reponse });
  });
  await page.goto(od.url + adresse, { waitUntil: 'commit' });
  return { ctx, page, erreurs, ordre };
}

test('rechargée sur /#maison, le fichier de la vue chargé APRÈS l\'ouverture : le cadre est quand même posé, une seule fois', { skip: sans }, async () => {
  const { ctx, page, erreurs, ordre } = await ouvrirEnRetard('/#maison', 'vue-maison.js', 'maison', 'OdinVueMaison');
  try {
    await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.OdinVueMaison), undefined, { timeout: 30000 });
    assert.deepEqual(ordre, { vueOuverte: true, fichierAbsent: true, retenu: 1 }, 'l\'ordre forcé : la vue ouverte d\'abord, le fichier ensuite');
    await page.waitForSelector('#v-maison.on iframe.vm-cadre', { timeout: 15000 });
    await page.waitForFunction(() => Boolean(document.querySelector('#v-maison iframe')?.contentDocument?.querySelector('.app main')), undefined, { timeout: 20000 });
    assert.deepEqual(await page.evaluate(() => ({ n: document.querySelectorAll('iframe').length, ouverte: window.OdinVueMaison.ouverte() })), { n: 1, ouverte: true });
    // Quitter puis revenir : la vue se comporte comme d'habitude (cadre retiré, puis un seul cadre).
    await page.evaluate(() => { window.OdinShow('chat'); });
    assert.deepEqual(await page.evaluate(() => ({ n: document.querySelectorAll('iframe').length, ouverte: window.OdinVueMaison.ouverte() })), { n: 0, ouverte: false });
    await page.evaluate(() => { window.OdinShow('maison'); });
    await page.waitForSelector('#v-maison.on iframe.vm-cadre', { timeout: 5000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('iframe').length), 1, 'un seul cadre');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('rechargée sur /#venus, le fichier de Vénus chargé APRÈS l\'ouverture : le cadre est quand même posé', { skip: sans }, async () => {
  const { ctx, page, erreurs, ordre } = await ouvrirEnRetard('/#venus', 'venus.js', 'venus', 'OdinVenus');
  try {
    await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.OdinVenus), undefined, { timeout: 30000 });
    assert.deepEqual(ordre, { vueOuverte: true, fichierAbsent: true, retenu: 1 }, 'l\'ordre forcé : la vue ouverte d\'abord, le fichier ensuite');
    await page.waitForSelector('#v-venus.on iframe.vv-cadre', { timeout: 15000 });
    assert.deepEqual(await page.evaluate(() => ({ n: document.querySelectorAll('#v-venus iframe').length, ouverte: window.OdinVenus.vue.ouverte(), titre: document.getElementById('mcur').textContent })), { n: 1, ouverte: true, titre: 'Vénus' });
    await page.evaluate(() => { window.OdinShow('chat'); });
    assert.deepEqual(await page.evaluate(() => ({ n: document.querySelectorAll('#v-venus iframe').length, ouverte: window.OdinVenus.vue.ouverte() })), { n: 0, ouverte: false });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
