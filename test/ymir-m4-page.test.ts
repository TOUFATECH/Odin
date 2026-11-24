// Hydre, lot M4 (la page) : « Créer une VM » en quatre étapes dans un vrai navigateur, sur un vrai Odin d'essai.
// AUCUNE vraie VM ni vrai disque : les ISO sont les petites ISO d'essai de Genèse, ce PC est simulé (un PC fictif :
// 6 cœurs, 24 Go), et la demande « Créer la machine » est arrêtée dans le navigateur (elle n'atteint jamais Odin :
// la création elle-même est essayée côté Odin, test/ymir-m4-creer.test.ts) ; la page reçoit un compte rendu d'essai.
// - étape 1 : seulement les systèmes prêts se choisissent, les autres disent pourquoi ; « l'installer tout seul » ;
// - étape 2 : le budget de ce PC, avec les chiffres ; au-delà du budget sans accord, le bouton vaut accord ;
// - étape 3 : réseau et options ; étape 4 : vérifier et créer ; puis le compte rendu commun ;
// - au clavier ; sous Windows, la page dit ce qui viendra et ne crée rien ;
// - 390 et 1280 px, thème clair et thème sombre d'Odin : rien ne déborde, les cibles font 44 px.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit). Avec YMIR_M4_CAPTURES=<dossier>, il garde ses captures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';
import { Local, systemeVm } from '../src/valhalla/ymir/local.ts';
import { hoteVm } from '../src/valhalla/ymir/creation.ts';
import { noterFiche, type FicheIso } from '../src/valhalla/ymir/isos.ts';

interface Requete { postData(): string | null }
interface Route { request(): Requete; fulfill(o: Record<string, unknown>): Promise<void>; continue(): Promise<void> }
interface Loc { click(): Promise<void>; focus(): Promise<void>; count(): Promise<number>; textContent(): Promise<string | null>; isDisabled(): Promise<boolean>; first(): Loc; locator(s: string, o?: Record<string, unknown>): Loc; scrollIntoViewIfNeeded(): Promise<void>; getAttribute(n: string): Promise<string | null> }
interface Page { goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; waitForTimeout(n: number): Promise<void>; evaluate<R>(f: string | ((a: never) => R), a?: unknown): Promise<R>; locator(s: string, o?: Record<string, unknown>): Loc; keyboard: { press(k: string): Promise<void>; type(t: string): Promise<void> }; fill(s: string, v: string): Promise<void>; screenshot(o: Record<string, unknown>): Promise<unknown>; on(e: string, f: (x: unknown) => void): void; route(u: string, f: (r: Route) => void): Promise<void> }
interface Contexte { addCookies(c: unknown[]): Promise<void>; addInitScript(s: string): Promise<void>; newPage(): Promise<Page>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.YMIR_M4_CAPTURES;
const GO = 1024 ** 3;

const t = new T();
let od: VraiOdin, nav: Navigateur | undefined;
const origine = { sv: { ...systemeVm }, h: { ...hoteVm }, manque: Local.prototype.manque };
/** Le compte rendu d'essai que la page reçoit après « Créer la machine » (la vraie création est essayée côté Odin). */
const COMPTE_RENDU = { nom: 'vm-debian-1', ou: [['Nom', 'vm-debian-1'], ['Adresse', '10.0.3.60 (réservée ; aucun réseau)'], ['Réseau', 'aucun'], ['Sur', 'ce PC']], entrer: [['Compte', 'odin'], ['Mot de passe', 'au coffre (« Machine vm-debian-1 · compte odin »), jamais montré ici'], ['Par l\'écran', 'Machines → sa carte → son écran et son clavier']],
  fait: [['Système', 'Debian 13.1.0'], ['Image', 'debian-13.1.0-amd64-netinst.iso · empreinte 0123456789abcdef… (celle de l\'éditeur ✓)'], ['Ressources', '2 cœurs · 5 Go de mémoire · disque de 20 Go'], ['Installation', 'toute seule (réponses Debian) · en cours']],
  essaye: [{ quoi: 'Image vérifiée avant l\'emploi', ok: true, preuve: 'empreinte de l\'éditeur, antivirus : sain' }, { quoi: 'Disque créé dans le dossier des VM', ok: true, preuve: 'disque.qcow2, 20 Go au plus' }, { quoi: 'Démarre', ok: true, preuve: 'en marche (processus 4001)' }, { quoi: 'Réseau', ok: null, preuve: 'aucun réseau choisi' }],
  reste: ['Attendre la fin de l\'installation (elle redémarre seule sur son disque ; Odin te prévient).', 'Décider : la garder, la ranger dans une catégorie, ou la supprimer (Machines).'] };

before(async () => {
  if (!pw) return;
  od = await vraiOdin(t, { compte: true });
  const v = valhallaOf()!, ctx = v.ctx('ymir');
  systemeVm.plateforme = () => 'linux'; systemeVm.enVie = () => false; systemeVm.qmp = async () => { throw new Error('essai : pas de QMP'); }; systemeVm.dossiersQmp = () => [join(ctx.dir, 'qmp')];
  hoteVm.coeurs = () => 6; hoteVm.memoire = () => 24 * GO; hoteVm.disque = () => ({ total: 500 * GO, libre: 200 * GO });
  Local.prototype.manque = async () => []; // QEMU « présent » : la page n'est pas bloquée (rien n'est lancé : la création s'arrête dans le navigateur)
  const espace = join(ctx.home, 'iso-essai'); mkdirSync(espace, { recursive: true });
  const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
  for (const f of readdirSync(FIX)) writeFileSync(join(espace, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f))));
  await v.act('ymir', 'espace_iso', { dossier: espace });
  for (const f of ((await v.act('ymir', 'bibliotheque_iso')).data as { isos: FicheIso[] }).isos) {
    const sha = createHash('sha256').update(readFileSync(f.chemin)).digest('hex');
    noterFiche(ctx, { ...f, sha256: sha, editeur: !/memtest/i.test(f.nom), antivirus: { at: 1, verdict: /rocky/i.test(f.nom) ? 'non analysé' : 'sain', texte: '' } });
  }
  await od.json('/api/valhalla/act', { module: 'apparence', action: 'theme', input: { theme: 'valhalla' } });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); Object.assign(systemeVm, origine.sv); Object.assign(hoteVm, origine.h); Local.prototype.manque = origine.manque; await t.end(); });

async function ouvrir(largeur: number, theme: 'clair' | 'sombre'): Promise<{ page: Page; ctxN: Contexte; erreurs: string[]; demandes: Array<Record<string, unknown>> }> {
  const doigt = largeur < 500;
  const ctxN = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 844 : 900 }, colorScheme: theme === 'sombre' ? 'dark' : 'light', hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  const [name, ...v] = od.session.split('=');
  await ctxN.addCookies([{ name, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctxN.addInitScript(`try { localStorage.setItem('odin.theme', ${JSON.stringify(theme)}); localStorage.setItem('odin.tour', 'done'); } catch {}`);
  const page = await ctxN.newPage(), erreurs: string[] = [], demandes: Array<Record<string, unknown>> = [];
  page.on('pageerror', (x) => erreurs.push(String(x))); page.on('console', (x) => { const m = x as { type(): string; text(): string }; if (m.type() === 'error' && !/ERR_NETWORK_CHANGED/.test(m.text())) erreurs.push(m.text()); });
  // « Créer la machine » s'arrête ici : jamais envoyé à Odin (aucune vraie VM), la page reçoit un compte rendu d'essai.
  await page.route('**/api/valhalla/act', async (r) => {
    let b: Record<string, unknown> = {}; try { b = JSON.parse(r.request().postData() ?? '{}'); } catch { /* autre */ }
    if (b.module === 'ymir' && b.action === 'creer_vm') { demandes.push(b); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: '✅ vm-debian-1 créée (essai)', data: { machine: { id: 'abc', nom: 'vm-debian-1', ip: '10.0.3.60' }, compteRendu: COMPTE_RENDU } }) }); return; }
    await r.continue();
  });
  await page.goto(`${od.url}/`); await page.waitForSelector('#app:not([hidden])', { timeout: 30000 }); await page.waitForTimeout(600);
  await page.evaluate('window.OdinApps.app("ymir")');
  await page.waitForSelector('.ym-tabs', { timeout: 30000 });
  await page.locator('.ym-tabs button', { hasText: 'Créer' }).click();
  await page.waitForSelector('.ym-sys', { timeout: 30000 }); await page.waitForTimeout(300);
  return { page, ctxN, erreurs, demandes };
}
async function attendre(page: Page, expr: string, ms = 15000): Promise<void> { const fin = Date.now() + ms; while (Date.now() < fin) { if (await page.evaluate(expr)) return; await page.waitForTimeout(150); } throw new Error(`toujours faux après ${ms} ms : ${expr}`); }
const capture = async (page: Page, nom: string, plein = false) => { if (CAPTURES) { mkdirSync(CAPTURES, { recursive: true }); await page.screenshot({ path: join(CAPTURES, `${nom}.png`), fullPage: plein }); } };
/** Rien ne déborde de l'écran ; les commandes de l'assistant font au moins 44 px. */
const mesure = (page: Page) => page.evaluate(`(() => {
  const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const petites = [...document.querySelectorAll('.ym-cseg button, .ym-steps button, .ym-sys, .ym-sw, .ym-cv input:not([type=checkbox]), .ym-cv select, .ym-segc button, .ym-choice, .ym-cv .ym-btn, .ym-cv .ym-apps label, .ym-foot button')].filter(vis).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((b) => (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().slice(0, 30) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
  const deborde = [...document.querySelectorAll('.ym *')].filter(vis).filter((x) => x.getBoundingClientRect().right > innerWidth + 1 && !x.closest('.ym-tabs')).map((x) => x.tagName + '.' + x.className).slice(0, 8);
  return { page: document.documentElement.scrollWidth > innerWidth + 1, deborde, petites };
})()`) as Promise<{ page: boolean; deborde: string[]; petites: string[] }>;
const verifier = async (page: Page) => { const m = await mesure(page); assert.equal(m.page, false, 'la page défile en largeur'); assert.deepEqual(m.deborde, []); assert.deepEqual(m.petites, []); };

test('les quatre étapes au clavier, le budget, l\'accord, le compte rendu ; 1280 sombre', { skip: sans }, async () => {
  const { page, ctxN, erreurs, demandes } = await ouvrir(1280, 'sombre');
  try {
    // Étape 1 : prêts (Ubuntu, Debian, Windows) ; pas prêts, avec leur raison (Rocky : antivirus ; memtest : empreinte).
    const sys = await page.evaluate(`[...document.querySelectorAll('.ym-sys')].map((b) => b.querySelector('b').textContent + (b.disabled ? ' (pas prêt) ' + b.querySelector('small').textContent : ''))`) as string[];
    assert.ok(sys.some((x) => /^Ubuntu/.test(x) && !/pas prêt/.test(x)), sys.join(' | '));
    assert.ok(sys.some((x) => /Rocky|Red Hat/.test(x) && /pas prêt.*antivirus/.test(x)), sys.join(' | '));
    assert.ok(sys.some((x) => /pas prêt.*empreinte n'est pas encore vérifiée/.test(x)), sys.join(' | '));
    await capture(page, '1280-sombre-01-systeme');
    const debian = page.locator('.ym-sys', { hasText: 'Debian' }).first();
    await debian.focus(); await page.keyboard.press('Enter');
    await attendre(page, `document.querySelector('.ym-sys[aria-checked="true"]').textContent.includes('Debian')`);
    assert.equal(await page.locator('[data-f="auto"]').isDisabled(), false, 'Debian s\'installe tout seul');
    await page.locator('[data-f="auto"]').focus(); await page.keyboard.press('Space');
    await page.waitForSelector('.ym-auto input[data-f="compte"]');
    assert.match(String(await page.locator('.ym-auto').textContent()), /jamais montré ici/);
    await capture(page, '1280-sombre-02-tout-seul');
    await page.locator('[data-f="suivant"]').focus(); await page.keyboard.press('Enter');
    await attendre(page, `document.activeElement && document.activeElement.id === 'ymCvT2'`);
    // Étape 2 : le budget de ce PC fictif (6 cœurs, 24 Go) : 5 cœurs au plus (un reste à Odin), 15 Go de mémoire au plus.
    assert.match(String(await page.locator('.ym-budget').textContent()), /Ce PC : 6 cœurs, 24 Go de mémoire, 200 Go de disque libres.*Au plus pour une nouvelle VM : 5 cœurs, 15 Go de mémoire, 150 Go de disque/);
    assert.equal(await page.locator('[data-cpu="6"]').isDisabled(), true, 'un cœur reste à Odin');
    assert.equal(await page.locator('[data-f="nom"]').getAttribute('value'), 'vm-debian-1', 'nom proposé');
    // La mémoire au clavier : de 2 à 5 Go → au-delà du budget sans accord (4 Go).
    await page.locator('input[data-f="mem"]').focus(); for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowRight');
    await attendre(page, `document.querySelector('.ym-budget').textContent.includes('Le bouton « Créer la machine » vaut accord')`);
    await capture(page, '1280-sombre-03-budget');
    await page.locator('[data-f="suivant"]').focus(); await page.keyboard.press('Enter');
    await attendre(page, `document.activeElement && document.activeElement.id === 'ymCvT3'`);
    // Étape 3 : aucun réseau ; la cage est à venir.
    assert.equal(await page.locator('[data-net="cage"]').isDisabled(), true);
    await page.locator('[data-net="aucun"]').focus(); await page.keyboard.press('Enter');
    await attendre(page, `document.querySelector('[data-net="aucun"]').getAttribute('aria-checked') === 'true'`);
    await capture(page, '1280-sombre-04-reseau');
    await page.locator('[data-f="suivant"]').focus(); await page.keyboard.press('Enter');
    await attendre(page, `document.activeElement && document.activeElement.id === 'ymCvT4'`);
    const recap = String(await page.locator('.ym-et').textContent());
    assert.match(recap, /Debian/); assert.match(recap, /toute seule · compte odin/); assert.match(recap, /aucun réseau/); assert.match(recap, /Rien n'est effacé/); assert.match(recap, /vaut accord/);
    await capture(page, '1280-sombre-05-verifier');
    await page.locator('[data-f="creer"]').focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('#ymCvFin', { timeout: 15000 });
    assert.equal(demandes.length, 1);
    const inp = demandes[0].input as Record<string, unknown>;
    assert.deepEqual([inp.nom, inp.coeurs, inp.memoire, inp.reseau, inp.auto, inp.compte, inp.apps], ['vm-debian-1', 2, 5, 'aucun', true, 'odin', '']);
    assert.equal(demandes[0].confirm, true, 'le bouton valait accord (la page l\'a dit)');
    assert.ok(!('mot_de_passe' in inp) && !JSON.stringify(inp).includes('passe'), 'aucun mot de passe ne part de la page');
    const fin = String(await page.locator('.ym-cv').textContent());
    for (const x of ['Où', 'Comment entrer', 'Ce qui a été fait', 'Ce qui a été essayé', 'Ce qui reste', 'jamais montré ici', 'Disque créé dans le dossier des VM']) assert.ok(fin.includes(x), x);
    await capture(page, '1280-sombre-06-compte-rendu', true);
    await verifier(page);
    assert.deepEqual(erreurs, []);
  } finally { await ctxN.close(); }
});

for (const [largeur, theme] of [[390, 'clair'], [390, 'sombre'], [1280, 'clair']] as const) {
  test(`affichage ${largeur} px, thème ${theme} : les quatre étapes et le compte rendu, rien ne déborde, cibles de 44 px`, { skip: sans }, async () => {
    const { page, ctxN, erreurs } = await ouvrir(largeur, theme);
    try {
      await capture(page, `${largeur}-${theme}-01-systeme`); await verifier(page);
      await page.locator('.ym-sys', { hasText: 'Ubuntu' }).first().click(); await page.locator('[data-f="auto"]').click(); await page.waitForSelector('.ym-auto');
      await verifier(page);
      for (let k = 2; k <= 4; k++) { await page.locator('[data-f="suivant"]').click(); await page.waitForSelector(`#ymCvT${k}`); await page.waitForTimeout(150); await capture(page, `${largeur}-${theme}-0${k}-etape`, true); await verifier(page); }
      await page.locator('[data-f="creer"]').click(); await page.waitForSelector('#ymCvFin', { timeout: 15000 });
      await capture(page, `${largeur}-${theme}-05-compte-rendu`, true); await verifier(page);
      assert.deepEqual(erreurs, []);
    } finally { await ctxN.close(); }
  });
}

test('sous Windows : la page dit ce qui viendra, et « Créer la machine » reste éteint', { skip: sans }, async () => {
  systemeVm.plateforme = () => 'win32';
  const { page, ctxN, erreurs, demandes } = await ouvrir(390, 'sombre');
  try {
    const txt = String(await page.locator('.ym-win').textContent());
    assert.match(txt, /Ce PC : Windows/); assert.match(txt, /hyperviseur livré avec Windows/); assert.match(txt, /Windows Famille/);
    for (let k = 2; k <= 4; k++) { await page.locator('[data-f="suivant"]').click(); await page.waitForSelector(`#ymCvT${k}`); }
    assert.equal(await page.locator('[data-f="creer"]').isDisabled(), true);
    assert.match(String(await page.locator('.ym-et').textContent()), /Refusé, rien n'est créé\. Sous Windows/);
    await capture(page, '390-sombre-06-windows', true); await verifier(page);
    assert.equal(demandes.length, 0); assert.deepEqual(erreurs, []);
  } finally { systemeVm.plateforme = () => 'linux'; await ctxN.close(); }
});
