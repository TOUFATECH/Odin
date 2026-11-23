// L'accueil en plein écran (maquette validée « Accueil », lot 22a) : seulement les widgets, pour un écran au mur.
// Ses mots : « réalise le développement de toutes les maquettes validées, les 80 ». La maquette (C615, L1281) : en plein
// écran, les barres, le bandeau et les onglets disparaissent ; on sort par un rond discret en haut à droite.
//  - le bandeau, les onglets des pages, les blocs du jour, le menu et la barre du bas ne se voient plus ; les widgets oui ;
//  - on sort au clavier (Échap) et au doigt (un rond de 44 px, en haut à droite) ; le focus suit ;
//  - ce qui est ouvert par-dessus (la barre de commande, le tiroir « Ajouter un widget ») prend le premier Échap ;
//  - le mode Modifier, le tiroir et le rafraîchissement d'une minute marchent encore en plein écran ;
//  - la mascotte de l'appli n'est pas touchée (son nid et ses réactions viendront au lot 22b).
// Les fichiers sont lus comme du texte ; puis, si Playwright est là, un vrai navigateur et un vrai Odin d'essai (sinon
// cette partie est ignorée, et elle le dit).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const FEN = readFileSync(new URL('../src/web/fenetre.js', import.meta.url), 'utf8');
const PE = readFileSync(new URL('../src/web/pages/plein-ecran.js', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');

// ------------------------------------------------------------------ ce qui est écrit
test('plein écran de l\'accueil : le bouton du bandeau met tout l\'accueil en plein écran', () => {
  assert.match(UI, /window\.OdinPleinEcran\.bouton\(\$\('#v-home'\)\); pe\.id = 'homeFull'/);
});

test('plein écran de l\'accueil : seulement les widgets (bandeau, onglets et blocs du jour cachés), un rond de sortie de 44 px', () => {
  for (const s of ['#v-home.pe-plein>#homeBandeau', '#v-home.pe-plein #todayBox', '#v-home.pe-plein #homeGrid', '#v-home.pe-plein #fenetre>.fe-bar']) assert.ok(FEN.includes(s), `${s} caché`);
  assert.doesNotMatch(FEN, /#v-home\.pe-plein[^{]*\.fe-tools/, 'la barre du mode Modifier reste');
  assert.match(FEN, /#v-home\.pe-plein>\.fe-sortie\{display:grid;[^}]*width:44px;height:44px/);
  assert.match(FEN, /'aria-label': SORTIE/);
  assert.match(FEN, /sortiePlein: 'Quitter le plein écran \(Échap\)'/);
  assert.match(FEN, /const SORTIE = TXT\.sortiePlein;/);
  assert.match(FEN, /prefers-reduced-motion:reduce\)\{\.fe-sortie\{transition:none\}/);
  // Le rafraîchissement d'une minute ne regarde pas le plein écran : il continue.
  assert.match(FEN, /setInterval\(async \(\) => \{ if \(edit \|\| glisse \|\| appuiEnCours \|\| document\.hidden \|\| !\$\('#v-home\.on'\)\) return;/);
  // La mascotte n'est pas touchée ici.
  assert.doesNotMatch(FEN, /buddyRoam|companion/);
});

test('plein écran : Échap va d\'abord à ce qui est ouvert par-dessus, puis fait sortir', () => {
  assert.doesNotMatch(PE, /e\.preventDefault\(\); e\.stopPropagation\(\); sortir\(\);/, 'plus de prise d\'Échap avant tout le monde');
  assert.match(PE, /const DESSUS = 'dialog\[open\],\[aria-modal="true"\],#odinTalk,#odinAdvice'/);
  // On décide une fois l'appui passé par tout le monde : une fenêtre fermée, ou la touche prise, et on reste.
  assert.match(PE, /setTimeout\(\(\) => \{ if \(actuel === c && !e\.defaultPrevented && liste\.every\(ouvert\)\) sortir\(\); \}, 0\);/);
  assert.match(PE, /navigator\.keyboard\?\.lock\?\.\(\['Escape'\]\)/, 'dans le plein écran du navigateur, la touche est gardée pour la page où c\'est permis');
});

test('plein écran : Échap avec la barre de commande ouverte la ferme, sans sortir ; le suivant fait sortir ; une fenêtre qui ne prend pas la touche ne bloque pas (rejoué sans navigateur)', async () => {
  type L = (e: Record<string, unknown>) => void;
  const capture: L[] = [], bulle: L[] = [], tard: L[] = [];
  // Une fenêtre ouverte par-dessus : `ferme` dit si son écouteur la ferme à l'appui d'Échap.
  const fenetre = (ferme: boolean) => { const f = { tagName: 'DIV', hidden: false, isConnected: true, ouverte: true, ferme, checkVisibility: () => f.ouverte }; return f; };
  let ouvertes: ReturnType<typeof fenetre>[] = [];
  const doc: Record<string, unknown> = {
    fullscreenElement: null, documentElement: { setAttribute: () => {}, removeAttribute: () => {} },
    getElementById: () => ({}), createElement: () => ({}), head: { append: () => {} }, querySelector: () => null,
    querySelectorAll: () => ouvertes.filter((f) => f.ouverte),
    addEventListener: (t: string, f: L, c?: boolean) => { if (t === 'keydown') (c ? capture : bulle).push(f); },
    dispatchEvent: () => {},
  };
  class CustomEvent { detail: unknown; constructor(_t: string, o: { detail: unknown }) { this.detail = o.detail; } }
  const win: { OdinPleinEcran?: { entrer: (c: unknown) => void; actif: () => unknown } } = {};
  vm.runInNewContext(PE, { window: win, document: doc, CustomEvent, setTimeout });
  const cible = { classList: { add: () => {}, remove: () => {} } };
  const pause = () => new Promise((r) => setTimeout(r, 5));
  // Un appui : la capture, l'écouteur de la fenêtre (sur son champ), la bulle, puis un écouteur posé plus tard sur le document.
  const echap = async (ici: boolean) => {
    const e = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const f of capture) f(e);
    for (const o of ouvertes) if (o.ouverte && o.ferme && ici) o.ouverte = false;
    for (const f of bulle) f(e);
    for (const o of ouvertes) if (o.ouverte && o.ferme && !ici) o.ouverte = false;
    for (const f of tard) f(e);
    await pause();
  };
  // La barre de commande (elle se ferme sans rien empêcher) : le premier Échap la ferme, sans sortir ; le second fait sortir.
  win.OdinPleinEcran!.entrer(cible); ouvertes = [fenetre(true)];
  await echap(true);
  assert.equal(ouvertes[0].ouverte, false, 'la barre est fermée');
  assert.equal(win.OdinPleinEcran!.actif(), cible, 'toujours en plein écran');
  await echap(true);
  assert.equal(win.OdinPleinEcran!.actif(), null, 'le second Échap fait sortir');
  // Même chose si la fenêtre est fermée par un écouteur posé après celui du plein écran.
  win.OdinPleinEcran!.entrer(cible); ouvertes = [fenetre(true)];
  await echap(false);
  assert.equal(win.OdinPleinEcran!.actif(), cible, 'fermée plus tard dans le même appui : toujours en plein écran');
  // Une fenêtre qui reste ouverte (le focus n'y est plus, personne ne la ferme) : Échap fait quand même sortir.
  ouvertes = [fenetre(false)];
  await echap(true);
  assert.equal(win.OdinPleinEcran!.actif(), null, 'Échap ne reste pas sans effet');
  // Quelqu'un a pris la touche (preventDefault) : on reste.
  win.OdinPleinEcran!.entrer(cible); ouvertes = [];
  tard.push((e) => (e as { preventDefault(): void }).preventDefault());
  await echap(true);
  assert.equal(win.OdinPleinEcran!.actif(), cible, 'la touche prise par un autre : on reste');
});

// ------------------------------------------------------------------ dans un vrai navigateur
// Ces noms ne servent que dans le navigateur (dans page.evaluate).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any, document: any, navigator: any, getComputedStyle: any, innerHeight: number, innerWidth: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
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

async function ouvrir(largeur: number, o: { sombre?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 844 : 860 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', colorScheme: o.sombre ? 'dark' : 'light' });
  const [n, ...v] = od.session.split('=');
  await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('odin.tour', 'done'); } catch { /* rien */ } });
  // Le thème sombre d'Odin lui-même.
  if (o.sombre) await ctx.addInitScript(() => { try { localStorage.setItem('odin.theme', 'sombre'); } catch { /* rien */ } });
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e: unknown) => erreurs.push(String(e)));
  await page.goto(od.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  // La fenêtre est posée dans l'accueil, puis remplie (sous une forte charge, cela peut prendre du temps).
  await page.waitForSelector('#v-home.on #feGrid', { state: 'attached', timeout: 45000 });
  try { await page.waitForFunction(() => document.getElementById('feGrid')?.getBoundingClientRect().height > 0, undefined, { timeout: 45000 }); } catch (e) {
    if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/grille-absente-${largeur}.png` });
    throw e;
  }
  await page.waitForSelector('#homeFull', { timeout: 15000 });
  await page.waitForTimeout(400);
  if (o.sombre) {
    // Le thème sombre d'Odin : le mode « sombre » du thème Valhalla (le thème d'origine d'Odin).
    await page.waitForFunction(() => Boolean(window.OdinThemes?.apply), undefined, { timeout: 15000 });
    await page.waitForTimeout(1100);
    await page.evaluate(() => window.OdinThemes.apply('valhalla'));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'le thème sombre d\'Odin');
  }
  return { ctx, page, erreurs };
}
/** Ce qui se voit : un élément affiché, qui a une taille, et qui n'est pas recouvert en son centre. */
const vu = (page: Page, sel: string) => page.evaluate((s: string) => {
  const n = document.querySelector(s); if (!n) return false;
  const r = n.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(n).visibility === 'hidden') return false;
  const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, 20)));
  const h = document.elementFromPoint(x, y); return Boolean(h && (n === h || n.contains(h)));
}, sel);
const etat = (page: Page) => page.evaluate(() => ({
  plein: document.getElementById('v-home').classList.contains('pe-plein'),
  focus: document.activeElement?.id || document.activeElement?.tagName,
  large: document.documentElement.scrollWidth <= innerWidth,
}));
async function entrer(page: Page, doigt: boolean) {
  if (doigt) await page.tap('#homeFull'); else await page.click('#homeFull');
  await page.waitForFunction(() => document.getElementById('v-home').classList.contains('pe-plein'), undefined, { timeout: 5000 });
  await page.waitForTimeout(350);
}

for (const [largeur, sombre] of [[1280, false], [1280, true], [390, false], [390, true]] as const) {
  const nom = `${largeur}-${sombre ? 'sombre' : 'clair'}`, doigt = largeur < 500;
  test(`plein écran de l'accueil, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : seulement les widgets ; Échap et le rond font sortir`, { skip: sans }, async () => {
    const { ctx, page, erreurs } = await ouvrir(largeur, { sombre });
    try {
      const mascotteAvant = await page.evaluate(() => { const m = document.getElementById('buddyRoam'); return m ? { cache: m.hidden, classe: m.className } : null; });
      await capture(page, `avant-${nom}`);
      await entrer(page, doigt);
      await capture(page, `plein-${nom}`);
      // Seulement les widgets.
      for (const s of ['#homeBandeau', '#homeFull', '#todayBox', '#homeGrid', '#fenetre .fe-bar', '.bnav', 'nav.side', '#menuBtn']) assert.equal(await vu(page, s), false, `${s} ne se voit plus`);
      assert.equal(await vu(page, '#feGrid'), true, 'les widgets se voient');
      assert.equal(await page.evaluate(() => document.getElementById('v-home').classList.contains('on')), true, 'l\'accueil reste la vue ouverte : le rafraîchissement d\'une minute continue');
      // Le rond de sortie : visible, 44 px, dans l'écran, et le focus y est passé (le bouton du bandeau est caché).
      const r = await page.evaluate(() => { const b = document.getElementById('feSortie').getBoundingClientRect(); return { l: Math.round(b.width), h: Math.round(b.height), dedans: b.top >= 0 && b.right <= innerWidth && b.left >= 0 }; });
      assert.deepEqual(r, { l: 44, h: 44, dedans: true });
      assert.equal(await vu(page, '#feSortie'), true, 'le rond de sortie se voit');
      assert.deepEqual(await etat(page), { plein: true, focus: 'feSortie', large: true });
      // Le rond de sortie ne cache pas un widget : la grille commence sous lui.
      assert.ok(await page.evaluate(() => document.getElementById('feGrid').getBoundingClientRect().top >= document.getElementById('feSortie').getBoundingClientRect().bottom), 'la grille commence sous le rond');
      // La barre de commande ouverte : le premier Échap la ferme, sans sortir.
      await page.keyboard.press('Control+k');
      await page.waitForSelector('#palette:not([hidden])', { timeout: 5000 });
      assert.equal(await vu(page, '#palIn'), true, 'la barre de commande passe par-dessus le plein écran');
      await capture(page, `barre-${nom}`);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#palette[hidden]', { state: 'attached', timeout: 5000 });
      assert.equal((await etat(page)).plein, true, 'toujours en plein écran après le premier Échap');
      // Échap : on sort ; le bandeau revient, le focus revient sur son bouton.
      await page.focus('#feSortie');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('v-home').classList.contains('pe-plein'), undefined, { timeout: 5000 });
      assert.equal(await vu(page, '#homeBandeau'), true, 'le bandeau revient');
      assert.equal((await etat(page)).focus, 'homeFull', 'le focus revient sur le bouton du bandeau');
      // Au doigt (ou à la souris) : le rond fait sortir.
      await entrer(page, doigt);
      if (doigt) await page.tap('#feSortie'); else await page.click('#feSortie');
      await page.waitForFunction(() => !document.getElementById('v-home').classList.contains('pe-plein'), undefined, { timeout: 5000 });
      assert.equal(await vu(page, '#feSortie'), false, 'le rond disparaît avec le plein écran');
      const mascotteApres = await page.evaluate(() => { const m = document.getElementById('buddyRoam'); return m ? { cache: m.hidden, classe: m.className } : null; });
      assert.deepEqual(mascotteApres?.cache, mascotteAvant?.cache, 'la mascotte de l\'appli n\'est pas touchée');
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}

for (const largeur of [1280, 390]) {
  test(`plein écran de l'accueil, ${largeur} px : le mode Modifier et le tiroir « Ajouter un widget » marchent encore`, { skip: sans }, async () => {
    const doigt = largeur < 500, { ctx, page, erreurs } = await ouvrir(largeur);
    try {
      await entrer(page, doigt);
      await page.evaluate(() => window.OdinFenetre.edit(true));
      await page.waitForSelector('#fenetre .fe-tools', { timeout: 5000 });
      assert.equal(await vu(page, '#fenetre .fe-tools'), true, 'la barre du mode Modifier se voit en plein écran');
      // Le rond de sortie ne cache pas la barre du mode Modifier (« Terminé » reste à portée).
      assert.ok(await page.evaluate(() => document.querySelector('#fenetre .fe-tools').getBoundingClientRect().top >= document.getElementById('feSortie').getBoundingClientRect().bottom));
      await capture(page, `modifier-${largeur}`);
      // Le tiroir : il s'ouvre par-dessus ; le premier Échap le ferme, sans sortir du plein écran.
      await page.click('#fenetre .fe-ajout');
      await page.waitForSelector('#feTiroir.open', { timeout: 5000 });
      await page.waitForTimeout(500);
      assert.equal(await vu(page, '#feTiroir input[type=search]'), true, 'le tiroir passe par-dessus le plein écran');
      await capture(page, `tiroir-${largeur}`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('feTiroir').classList.contains('open'), undefined, { timeout: 5000 });
      assert.equal((await etat(page)).plein, true, 'toujours en plein écran après avoir fermé le tiroir');
      // « Annuler » ferme le mode Modifier, la page se redessine (avec son animation) : toujours en plein écran.
      await page.click('#fenetre .fe-tools .btn:not(.primary)');
      await page.waitForFunction(() => !window.OdinFenetre.state().edit, undefined, { timeout: 5000 });
      await page.waitForTimeout(300);
      assert.equal((await etat(page)).plein, true);
      assert.equal(await vu(page, '#fenetre .fe-bar'), false, 'les onglets restent cachés');
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}

// ------------------------------------------------------------------ Échap doit toujours finir par marcher (relecture)
// Dans le plein écran du navigateur, la touche Échap est gardée pour la page (navigator.keyboard.lock) : si la page ne
// fait rien de l'appui, le navigateur ne sort plus non plus. D'où ces deux essais.
test('plein écran de l\'accueil : Échap fait sortir même si une fenêtre reste ouverte sans prendre la touche (conseil d\'Odin, tiroir quitté)', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    // Le conseil d'Odin ouvert, puis le focus ailleurs (un clic sur la page) : son Échap ne l'atteint plus.
    await entrer(page, false);
    await page.evaluate(() => window.OdinNotices.open({ id: 'essai', at: new Date().toISOString(), level: 'ok', kind: 'Info', app: 'Odin', title: 'Un conseil d\'essai', steps: [], actions: [] }));
    await page.waitForSelector('#odinAdvice:not([hidden])', { timeout: 5000 });
    if (!(await etat(page)).plein) await entrer(page, false);
    await page.focus('#feSortie');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal((await etat(page)).plein, false, 'Échap fait sortir : personne d\'autre ne l\'a prise');
    await page.evaluate(() => window.OdinNotices.hide?.());
    // Le tiroir ouvert, puis le focus sur la page derrière lui : Échap fait encore sortir.
    await entrer(page, false);
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.click('#fenetre .fe-ajout');
    await page.waitForSelector('#feTiroir.open', { timeout: 5000 });
    await page.focus('#feSortie');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert.equal((await etat(page)).plein, false, 'Échap fait sortir, tiroir ouvert mais pas sous le focus');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('plein écran de l\'accueil : un double appui sur le bouton ne laisse ni le navigateur en plein écran, ni Échap gardé', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await page.evaluate(() => {
      const k = navigator.keyboard; window.__garde = 0; if (!k?.lock) return;
      const l = k.lock.bind(k), u = k.unlock.bind(k);
      k.lock = (t: unknown) => { window.__garde = 1; return l(t); }; k.unlock = () => { window.__garde = 0; return u(); };
    });
    // Deux appuis rapides : le premier fait entrer, le second (sur le rond, à la même place) sort, avant que le navigateur
    // ait fini d'entrer dans son plein écran (sur un vrai écran, son passage en plein écran prend quelques dixièmes de seconde).
    await page.evaluate(() => { document.getElementById('homeFull').click(); document.getElementById('feSortie').click(); });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ plein: document.getElementById('v-home').classList.contains('pe-plein'), navigateur: Boolean(document.fullscreenElement), garde: window.__garde }));
    assert.deepEqual(r, { plein: false, navigateur: false, garde: 0 });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
