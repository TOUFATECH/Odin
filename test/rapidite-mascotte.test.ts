// La mascotte réagit vite et selon la réponse (src/web/ui.html, là où arrivent les événements du serveur).
// Un vrai Odin (interface web) et un vrai navigateur (Playwright, s'il est installé ; sinon l'essai est ignoré).
// 1. Les événements du tour arrivent à la vie de la mascotte (vie.js écoute « odin:event »).
// 2. Une recherche garde le regard « attentif » tant qu'elle dure (et pas 1,6 s).
// 3. L'humeur écrite en tête de la réponse ([humeur:x]) se voit dès le premier morceau, pas à la fin.
// Rien n'est dessiné en plus : des émotions qui existent déjà, envoyées comme avant au visage.
// RAPIDITE_SRC : dossier d'une autre copie de src (pour rejouer l'essai sur l'ancienne version).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { freePort } from './banc/lib.ts';

process.env.ODIN_ESSAI = '1'; process.env.ODIN_NO_VOICE_INSTALL = '1'; process.env.ODIN_NO_LOCAL_BRAIN = '1';
const src = process.env.RAPIDITE_SRC ? pathToFileURL(join(process.env.RAPIDITE_SRC, 'x')).href.replace(/x$/, '') : new URL('../src/', import.meta.url).href;

type Page = { goto(u: string, o?: object): Promise<unknown>; waitForFunction(js: string, a?: unknown, o?: object): Promise<unknown>; evaluate<R>(js: string): Promise<R>; waitForTimeout(ms: number): Promise<void> };
let pw: { chromium: { launch(): Promise<{ newContext(o?: object): Promise<{ newPage(): Promise<Page>; addCookies(c: object[]): Promise<void> }>; close(): Promise<void> }> } } | undefined;
try { pw = createRequire(import.meta.url)('playwright'); } catch { pw = undefined; }

test('[navigateur : ignoré sans Playwright — la logique est aussi essayée sans navigateur dans rapidite-mascotte-logique] la mascotte suit le tour : événements reçus, recherche tenue, humeur dès le premier mot', { skip: pw ? false : 'Playwright absent (NODE_PATH vers file-attente/outils-affichage/node_modules)' }, async () => {
  const { createOdin } = await import(`${src}runtime.ts`) as typeof import('../src/runtime.ts');
  const { Gateway } = await import(`${src}bifrost/gateway.ts`) as typeof import('../src/bifrost/gateway.ts');
  const { WebChannel, ensureWebToken } = await import(`${src}web/server.ts`) as typeof import('../src/web/server.ts');
  const { MockProvider } = await import(`${src}providers/mock.ts`) as typeof import('../src/providers/mock.ts');
  const home = mkdtempSync(join(tmpdir(), 'odin-rapidite-mascotte-'));
  const o = createOdin({ home, provider: new MockProvider([{ text: 'ok' }]), approver: { approve: async () => false }, configOverride: (c) => ({ ...c, watch: { ...c.watch, enabled: false }, continuous: { ...c.continuous, enabled: false, autoResume: false }, journal: { ...c.journal, enabled: false }, veille: { enabled: false, at: '12:30' }, update: { auto: 'off' as const, everyHours: 6 }, web: { ...c.web, portsParAppli: false } }) });
  const port = await freePort(), token = ensureWebToken(o.paths);
  const web = new WebChannel(o, { scanNetwork: async () => undefined }, { port, host: '127.0.0.1', token, access: 'local', scryptN: 1024 });
  const gw = new Gateway(o, { owners: { web: ['*'] } }); gw.add(web); await gw.start();
  const url = `http://127.0.0.1:${port}`;
  const browser = await pw!.chromium.launch();
  try {
    const r = await fetch(`${url}/api/account/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1', cookie: `odin_token=${token}` }, body: JSON.stringify({ prenom: 'Essai', nom: 'Rapide', email: 'essai@exemple.test', password: 'un-cheval-bleu-traverse-la-riviere' }) });
    const session = r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0].split('=') ?? [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: session[0], value: session[1], url }]);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.OdinFace && window.OdinFace.MOODS && document.querySelector("#buddyTxt")', undefined, { timeout: 20_000 });
    await page.waitForTimeout(1500); // le flux /api/stream est ouvert
    await page.evaluate('window.__evts = 0; addEventListener("odin:event", () => { window.__evts++; }); true');
    const nom = (id: string) => page.evaluate<string>(`window.OdinFace.MOODS[${JSON.stringify(id)}].nom`);
    const etiquette = () => page.evaluate<string>('document.querySelector("#buddyTxt").textContent');
    const attentif = await nom('regarde'), fier = await nom('fierte');

    web.event('principal', { type: 'tool_start', name: 'web_research', input: { question: 'x' } });
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate<number>('window.__evts') >= 1, 'vie.js doit recevoir « odin:event »');
    assert.equal(await etiquette(), attentif, 'pendant la recherche : attentif');
    await page.waitForTimeout(2600);
    assert.equal(await etiquette(), attentif, 'la recherche dure encore : toujours attentif (pas seulement 1,6 s)');
    web.event('principal', { type: 'tool_end', name: 'web_research', ok: true, preview: 'ok' });
    await page.waitForTimeout(300);

    const t0 = Date.now();
    web.event('principal', { type: 'delta', text: '[humeur:fierte] Voilà, ' });
    await page.waitForFunction(`document.querySelector("#buddyTxt").textContent === ${JSON.stringify(fier)}`, undefined, { timeout: 2000 }).catch(() => undefined);
    const delai = Date.now() - t0;
    assert.equal(await etiquette(), fier, 'l\'humeur écrite en tête doit se voir dès le premier morceau');
    console.log(`# délai humeur après le premier morceau : ${delai} ms`);
  } finally {
    await browser.close().catch(() => undefined); await gw.stop().catch(() => undefined); o.close();
    try { rmSync(home, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ }
  }
});
