// Le nid d'Odin et ses réactions (maquette validée « Accueil », lot 22b).
// Sa réponse du 25/11 : « (a) garder la rune quand Odin se promène ; Odin revient dans son nid avec le lot 22b ».
// La maquette (logique L554-611, L468, L491, L497) :
//  - Odin a un nid : le rond au centre de la barre du bas au téléphone, un rond flottant ailleurs (et en plein écran) ;
//    quand il ne trouve aucune place libre, il rentre dans son nid au lieu de se serrer dans un coin, et il en ressort
//    dès qu'une place se libère ; jamais deux Odin à l'écran : le rond central le montre quand il y est, la rune sinon ;
//  - il réagit quand le propriétaire range ses widgets : enthousiaste quand il en prend un, concentré quand il tire un
//    coin, content quand c'est posé ; l'émotion est demandée au visage (qui seul dessine, ses marques autour des yeux),
//    le reste est du mouvement (un geste, un regard, un petit saut du rond) ; rien qui bouge en « moins d'animations » ;
//  - rien pour un membre de la famille (il ne range pas la fenêtre).
// Les fichiers sont lus comme du texte ; puis, si Playwright est là, un vrai navigateur et un vrai Odin d'essai (sinon
// cette partie est ignorée, et elle le dit).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const COMP = readFileSync(new URL('../src/web/companion.js', import.meta.url), 'utf8');
const FEN = readFileSync(new URL('../src/web/fenetre.js', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');

// ------------------------------------------------------------------ ce qui est écrit
test('fenetre.js prévient quand un module est pris, posé, son coin tiré ou sa taille changée', () => {
  assert.match(FEN, /new CustomEvent\('odin:widget-geste', \{ detail: \{ quoi, x: /);
  assert.match(FEN, /pose\(\); signaler\('prise', box\);/, 'au début du glisser (la copie suit le pointeur)');
  assert.match(FEN, /dire\(TXT\.place\(order\.indexOf\(id\) \+ 1, order\.length\)\); signaler\('pose', box\);/, 'posé à une autre place (pas un retour à sa place, pas un simple clic)');
  assert.match(FEN, /coinEnCours = true; [^\n]*signaler\('coin', box\);/, 'le coin tiré');
  assert.match(FEN, /if \(bouge\) \{ dire\(TXT\.taille\(G\.etiquette\(n\)\)\); signaler\('taille', box\); draw\(\); \}/, 'la taille changée au coin');
  assert.match(FEN, /\.fe-grip`\)\?\.focus\(\); signaler\('pose', document\.activeElement\);/, 'au clavier aussi (flèches sur la poignée), qui garde le focus');
  assert.match(FEN, /dire\(TXT\.taille\(G\.etiquette\(n\)\)\); signaler\('taille', box\);\n/, 'au clavier aussi (Maj + flèches)');
  // Un déplacement annulé (Échap) ne prévient rien : « remettre » sort avant.
  const fin = FEN.slice(FEN.indexOf('const fin = (annule) => {'), FEN.indexOf('function geste(v)'));
  assert.ok(fin.indexOf('if (quoi === \'remettre\')') < fin.indexOf('signaler(\'pose\''), 'rien quand le module revient à sa place');
  assert.doesNotMatch(FEN, /buddyRoam|companion/, 'fenetre.js ne touche pas à la mascotte');
});

test('companion.js : les réactions de la maquette, pour le propriétaire seul, rien qui bouge en « moins d\'animations »', () => {
  assert.match(COMP, /document\.addEventListener\('odin:widget-geste', reagir\);/);
  const R = COMP.slice(COMP.indexOf('const REACTIONS = {'), COMP.indexOf('};', COMP.indexOf('const REACTIONS = {')));
  // Maquette : L468 prise → enthousiaste ; L497 coin → concentré ; L491 posé → content (1,8 s) ; L486 taille → content (1,6 s).
  assert.match(R, /prise: \{ emotion: 'excite', /); assert.match(R, /coin: \{ emotion: 'concentration', /);
  assert.match(R, /pose: \{ emotion: 'joie', ms: 1800, /); assert.match(R, /taille: \{ emotion: 'joie', ms: 1600, /);
  const f = COMP.slice(COMP.indexOf('function reagir(e) {'), COMP.indexOf('document.addEventListener(\'odin:widget-geste\''));
  assert.match(f, /if \(!R \|\| !proprio \|\| !bud \|\| !montre\) return;/, 'le propriétaire seul, et seulement là où Odin est montré');
  assert.match(f, /F\.ressent\(vu, R\.emotion, \{ ms: R\.ms, source: 'widget' \}\)/, 'l\'émotion est demandée au visage');
  const rm = f.indexOf('if (reduce.matches) return;');
  assert.ok(rm > 0 && rm < f.indexOf('act(R.geste') && rm < f.indexOf('lookAt(') && rm < f.indexOf('sautille('), 'ni geste, ni regard, ni saut en « moins d\'animations »');
  assert.match(COMP, /proprio = Boolean\(etat && typeof etat === 'object' && !etat\.membre\)/, 'un membre : pas de réaction');
  // Le visage n'est pas dessiné ici : aucune classe du visage, aucune règle sur ses yeux, rien de face.js recopié.
  assert.doesNotMatch(COMP, /classList\.(add|remove|toggle)\(['`](e|c|g|m|o|sans)-/);
  const css = /const CSS_NID = `([\s\S]*?)`;/.exec(COMP)?.[1] ?? '';
  assert.ok(css.includes('#odinNid{'), 'le rond flottant a son style');
  assert.doesNotMatch(css, /svg|eye|\.odin|buddy/i, 'le style du nid ne touche pas la mascotte');
});

test('companion.js : il rentre dans son nid faute de place, et le rond de la barre le montre (la règle du lot 21, inchangée)', () => {
  assert.match(COMP, /if \(p && p\.corner && !mine\) \{ nicher\(\); retryAt = now \+ 6000; return; \}/, 'plus de coin : son nid');
  assert.match(COMP, /if \(!p \|\| p\.corner\) nicherIci\(\);/, 'une page sans place libre : il y réapparaît');
  assert.match(COMP, /bud\.hidden = !show \|\| nid === 'barre';/, 'rangé dans le rond de la barre : celui en liberté est caché');
  // ui.html (lot 21) : le rond montre sa mascotte quand celle en liberté est cachée, sa rune sinon.
  assert.ok(UI.includes('body:has(#buddyRoam:not([hidden])):not(:has(#v-venus.on)) .bt-odin .nid,'));
  assert.ok(UI.includes('body:has(#buddyRoam:not([hidden])):not(:has(#v-venus.on)) .bt-odin .nid-rune,'));
  assert.match(COMP, /const OWN = '#buddyRoam,#odinNid,/, 'son nid n\'est jamais un obstacle pour lui');
});

// ------------------------------------------------------------------ dans un vrai navigateur
// Ces noms ne servent que dans le navigateur (dans page.evaluate).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: any, document: any, getComputedStyle: any, innerHeight: number, innerWidth: number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: (() => void) | { content: string }): Promise<void>; close(): Promise<void> }
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

async function ouvrir(largeur: number, o: { sombre?: boolean; membre?: boolean; reduit?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 844 : 860 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', colorScheme: o.sombre ? 'dark' : 'light', reducedMotion: o.reduit ? 'reduce' : 'no-preference' });
  const [n, ...v] = od.session.split('=');
  await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(() => { try { localStorage.setItem('odin.tour', 'done'); } catch { /* rien */ } });
  if (o.sombre) await ctx.addInitScript(() => { try { localStorage.setItem('odin.theme', 'sombre'); } catch { /* rien */ } });
  // Chaque émotion demandée au visage est notée (l'appel n'est pas changé).
  await ctx.addInitScript({ content: `window.__ressenti = []; (() => { let F;
    Object.defineProperty(window, 'OdinFace', { configurable: true, get: () => F, set: (v) => {
      F = v; if (!v || typeof v.ressent !== 'function' || v.__note) return;
      const r = v.ressent; v.ressent = (el, id, opts) => { window.__ressenti.push({ el: (el && el.id) || '', id, source: (opts && opts.source) || '' }); return r(el, id, opts); }; v.__note = true;
    } }); })();` });
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e: unknown) => erreurs.push(String(e)));
  if (o.membre) await page.route('**/api/state', async (r: Page) => { const j = await (await r.fetch()).json(); await r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...j, membre: { login: 'camille', name: 'Camille', groups: ['freyja'] } }) }); });
  await page.goto(od.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  if (!o.membre) {
    await page.waitForSelector('#v-home.on #feGrid', { state: 'attached', timeout: 45000 });
    await page.waitForFunction(() => document.getElementById('feGrid')?.getBoundingClientRect().height > 0, undefined, { timeout: 45000 });
  }
  if (o.sombre) {
    await page.waitForFunction(() => Boolean(window.OdinThemes?.apply), undefined, { timeout: 15000 });
    await page.waitForTimeout(1100);
    await page.evaluate(() => window.OdinThemes.apply('valhalla'));
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'le thème sombre d\'Odin');
  }
  // Odin est sorti (une place libre sur l'accueil).
  await page.waitForFunction(() => { const e = window.OdinCompanion?.etat?.(), b = document.getElementById('buddyRoam'); return e && e.visible && !e.nid && !b.classList.contains('slip'); }, undefined, { timeout: 20000 });
  await page.waitForTimeout(500); // la fin de son fondu d'arrivée
  return { ctx, page, erreurs };
}
/** Les mascottes vraiment visibles à l'écran : leur identifiant ou leur classe (comme test/barre-bas.test.ts). */
const mascottesVues = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  for (const o of document.querySelectorAll('.odin, .pet')) {
    const r = o.getBoundingClientRect(); if (r.width < 8 || r.height < 8) continue;
    if (r.top + r.height <= 0 || r.top >= innerHeight || r.left + r.width <= 0 || r.left >= innerWidth) continue;
    if (getComputedStyle(o).visibility === 'hidden') continue;
    let e = o, cache = false; while (e) { const s = getComputedStyle(e); if (s.display === 'none' || Number(s.opacity) === 0) { cache = true; break; } e = e.parentElement; }
    if (!cache) out.push(o.id || String(o.className));
  }
  return out;
});
/** Plus aucune place libre : un grand bouton par-dessus la page (sous les barres et sous Odin). */
const remplir = (page: Page, z = 1) => page.evaluate((zi: number) => {
  const b = document.createElement('button'); b.id = 'essaiPlein'; b.type = 'button'; b.textContent = 'Plein';
  const bas = document.querySelector('.bnav')?.getClientRects().length ? document.querySelector('.bnav').getBoundingClientRect().height : 0;
  b.style.cssText = `position:fixed;left:0;top:0;right:0;bottom:${bas}px;z-index:${zi};opacity:.04;border:0`;
  document.body.append(b);
}, z);
const vider = (page: Page) => page.evaluate(() => document.getElementById('essaiPlein')?.remove());
const nidDe = (page: Page) => page.evaluate(() => window.OdinCompanion.etat().nid);

for (const [largeur, sombre] of [[1280, false], [1280, true], [390, false], [390, true]] as const) {
  const nom = `${largeur}-${sombre ? 'sombre' : 'clair'}`, doigt = largeur < 500;
  test(`nid, ${nom} : sans place libre il rentre dans son nid, en ressort quand une place se libère ; un seul Odin à l'écran`, { skip: sans, timeout: 120000 }, async () => {
    const { ctx, page, erreurs } = await ouvrir(largeur, { sombre });
    try {
      assert.deepEqual(await mascottesVues(page), ['buddyRoam'], 'dehors : Odin en liberté, seul');
      if (doigt) assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#bnavOdin .nid-rune')).display !== 'none'), true, 'il se promène : le rond montre la rune');
      await capture(page, `dehors-${nom}`);
      await remplir(page);
      await page.waitForFunction(() => Boolean(window.OdinCompanion.etat().nid), undefined, { timeout: 15000 });
      await page.waitForTimeout(700);
      await capture(page, `au-nid-${nom}`);
      if (doigt) {
        // Téléphone : son nid est le rond de la barre du bas ; c'est lui qui le montre.
        assert.equal(await nidDe(page), 'barre');
        assert.deepEqual(await mascottesVues(page), ['buddyBas'], 'au nid : Odin dans le rond, seul');
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#bnavOdin .nid-rune')).display), 'none', 'pas de rune quand il est dans son nid');
        assert.equal(await page.evaluate(() => document.getElementById('odinNid')?.hidden ?? true), true, 'pas de rond flottant au téléphone');
      } else {
        // Ordinateur : un rond flottant en bas à droite, avec Odin posé dessus (un seul Odin).
        assert.equal(await nidDe(page), 'rond');
        assert.deepEqual(await mascottesVues(page), ['buddyRoam'], 'au nid : Odin seul');
        const g = await page.evaluate(() => { const d = document.getElementById('odinNid').getBoundingClientRect(), b = document.getElementById('buddyRoam').getBoundingClientRect();
          return { l: Math.round(d.width), dedans: b.left >= d.left - 1 && b.right <= d.right + 1 && b.top >= d.top - 1 && b.bottom <= d.bottom + 1, coin: d.right <= innerWidth && d.right > innerWidth - 40 && d.bottom > innerHeight - 40, souris: getComputedStyle(document.getElementById('odinNid')).pointerEvents }; });
        assert.deepEqual(g, { l: 54, dedans: true, coin: true, souris: 'none' });
      }
      // Une place se libère : il ressort (en 6 s au plus, plus un battement), et le rond reprend la rune.
      await vider(page);
      await page.waitForFunction(() => { const e = window.OdinCompanion.etat(); return !e.nid && e.visible; }, undefined, { timeout: 15000 });
      await page.waitForTimeout(600);
      assert.deepEqual(await mascottesVues(page), ['buddyRoam'], 'ressorti : Odin en liberté, seul');
      assert.equal(await page.evaluate(() => document.getElementById('odinNid').hidden), true, 'le rond flottant disparaît avec lui');
      if (doigt) assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#bnavOdin .nid-rune')).display !== 'none'), true, 'le rond montre de nouveau la rune');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'rien ne déborde');
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}

test('nid, 390 px en plein écran : la barre est recouverte, son nid est le rond flottant ; toujours un seul Odin', { skip: sans, timeout: 120000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    await page.tap('#homeFull');
    await page.waitForFunction(() => document.getElementById('v-home').classList.contains('pe-plein'), undefined, { timeout: 5000 });
    await page.waitForTimeout(500);
    await remplir(page, 45);
    await page.waitForFunction(() => window.OdinCompanion.etat().nid === 'rond', undefined, { timeout: 15000 });
    await page.waitForTimeout(600);
    await capture(page, 'au-nid-plein-ecran-390');
    assert.deepEqual(await mascottesVues(page), ['buddyRoam'], 'en plein écran, au nid : Odin seul');
    assert.equal(await page.evaluate(() => document.getElementById('odinNid').hidden), false, 'le rond flottant se voit');
    await vider(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('v-home').classList.contains('pe-plein'), undefined, { timeout: 5000 });
    await page.waitForFunction(() => window.OdinCompanion.etat().nid !== 'rond', undefined, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.getElementById('odinNid').hidden), true, 'hors du plein écran : plus de rond flottant');
    assert.equal((await mascottesVues(page)).length, 1, 'un seul Odin');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// Relecture : le rond flottant restait toujours en bas à droite ; sur une page sans place libre avec un bouton dans ce
// coin, Odin posé dessus prenait le clic (il ouvrait sa petite fenêtre au lieu du bouton).
for (const largeur of [1280, 390] as const) {
  test(`nid, ${largeur} px : le rond flottant ne se pose pas sur un bouton du coin, il prend un autre coin`, { skip: sans, timeout: 120000 }, async () => {
    const { ctx, page, erreurs } = await ouvrir(largeur);
    try {
      if (largeur < 500) { await page.tap('#homeFull'); await page.waitForFunction(() => document.getElementById('v-home').classList.contains('pe-plein'), undefined, { timeout: 5000 }); }
      await page.evaluate(() => {
        const t = document.createElement('div'); t.id = 'essaiTexte';
        t.style.cssText = 'position:fixed;inset:0;z-index:45;background:var(--bg);font:16px/18px sans-serif;overflow:hidden;color:var(--ink)';
        t.textContent = 'texte '.repeat(4000);
        const b = document.createElement('button'); b.id = 'essaiBouton'; b.type = 'button'; b.textContent = 'Enregistrer';
        b.style.cssText = 'position:fixed;right:12px;bottom:14px;z-index:46;width:110px;height:56px';
        b.onclick = () => { window.__clic = (window.__clic || 0) + 1; };
        document.body.append(t, b);
      });
      await page.waitForFunction(() => window.OdinCompanion.etat().nid === 'rond', undefined, { timeout: 15000 });
      await page.waitForTimeout(900);
      const p = await page.evaluate(() => { const b = document.getElementById('essaiBouton').getBoundingClientRect(); return { x: b.right - 30, y: b.top + b.height / 2 }; });
      assert.equal(await page.evaluate((q: { x: number; y: number }) => document.elementFromPoint(q.x, q.y)?.id, p), 'essaiBouton', 'rien d\'Odin sur le bouton');
      await page.mouse.click(p.x, p.y);
      assert.equal(await page.evaluate(() => window.__clic || 0), 1, 'le clic va au bouton');
      const g = await page.evaluate(() => { const d = document.getElementById('odinNid').getBoundingClientRect(), b = document.getElementById('buddyRoam').getBoundingClientRect(); return { vu: !document.getElementById('odinNid').hidden, dedans: b.left >= d.left - 1 && b.right <= d.right + 1 && b.top >= d.top - 1 && b.bottom <= d.bottom + 1, gauche: d.left < innerWidth / 2 }; });
      assert.deepEqual(g, { vu: true, dedans: true, gauche: true }, 'le rond en bas à gauche, Odin dessus');
      assert.deepEqual(await mascottesVues(page), ['buddyRoam'], 'un seul Odin');
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}

// Relecture : en plein écran, les coins du bas et de gauche occupés, le rond flottant montait en haut à droite, sur le
// rond ✕ de sortie (lot 22a) ; Odin posé dessus prenait le clic. Le ✕ n'est jamais couvert, et s'il n'y a nulle part
// sans commande, Odin posé sur son rond laisse passer le clic.
for (const largeur of [1280, 390] as const) {
  test(`nid, ${largeur} px en plein écran, coins occupés : jamais sur le ✕ de sortie, et le clic passe`, { skip: sans, timeout: 120000 }, async () => {
    const { ctx, page, erreurs } = await ouvrir(largeur);
    try {
      if (largeur < 500) await page.tap('#homeFull'); else await page.click('#homeFull');
      await page.waitForFunction(() => document.getElementById('v-home').classList.contains('pe-plein'), undefined, { timeout: 5000 });
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const v = document.getElementById('v-home'), t = document.createElement('div'); t.id = 'essaiTexte';
        t.style.cssText = 'position:fixed;inset:0;z-index:1;background:var(--bg);font:16px/18px sans-serif;overflow:hidden;color:var(--ink)';
        t.textContent = 'texte '.repeat(4000); v.append(t);
        window.__clics = [];
        for (const [k, css] of [['bd', 'right:0;bottom:0'], ['bg', 'left:0;bottom:0'], ['hg', 'left:0;top:0'], ['hd', 'right:0;top:64px'], ['md', 'right:0;top:40%'], ['mg', 'left:0;top:40%'], ['bm', 'left:35%;bottom:0'], ['hm', 'left:35%;top:0']]) {
          const b = document.createElement('button'); b.type = 'button'; b.textContent = k; b.className = 'essaiCoin';
          b.style.cssText = `position:fixed;${css};z-index:2;width:35%;height:30%`; b.onclick = () => window.__clics.push(k); v.append(b);
        }
      });
      await page.waitForFunction(() => window.OdinCompanion.etat().nid === 'rond', undefined, { timeout: 15000 });
      await page.waitForTimeout(900);
      const g = await page.evaluate(() => {
        const s = document.getElementById('feSortie').getBoundingClientRect(), d = document.getElementById('odinNid').getBoundingClientRect(), b = document.getElementById('buddyRoam').getBoundingClientRect();
        const loin = (r: { left: number; right: number; top: number; bottom: number }) => r.right <= s.left - 1 || r.left >= s.right + 1 || r.bottom <= s.top - 1 || r.top >= s.bottom + 1;
        const h = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
        return { rondLoin: loin(d), odinLoin: loin(b), sortie: Boolean(h && h.closest('#feSortie')) };
      });
      assert.deepEqual(g, { rondLoin: true, odinLoin: true, sortie: true }, 'ni le rond ni Odin sur le ✕');
      // Sous Odin, une commande : le clic lui arrive.
      const c = await page.evaluate(() => { const b = document.getElementById('buddyRoam').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      const sous = await page.evaluate((q: { x: number; y: number }) => { const h = document.elementFromPoint(q.x, q.y); return `${h?.id || h?.className} ${JSON.stringify(window.OdinCompanion.etat())}`; }, c);
      await page.mouse.click(c.x, c.y);
      assert.equal((await page.evaluate(() => window.__clics)).length, 1, `la commande sous Odin reçoit le clic (${sous} ${JSON.stringify(c)})`);
      await capture(page, `nid-plein-ecran-coins-${largeur}`);
      // Le ✕ fait sortir.
      if (largeur < 500) await page.tap('#feSortie'); else await page.click('#feSortie', { timeout: 5000 });
      await page.waitForFunction(() => !document.getElementById('v-home').classList.contains('pe-plein'), undefined, { timeout: 5000 });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}

/** Les émotions demandées par la fenêtre (source « widget ») depuis `depuis`. */
const ressentis = (page: Page, depuis = 0) => page.evaluate((d: number) => window.__ressenti.slice(d).filter((x: { source: string }) => x.source === 'widget').map((x: { el: string; id: string }) => `${x.el}:${x.id}`), depuis);

test('réactions, 1280 px, à la souris : il s\'enthousiasme quand tu prends un widget, est content quand tu le poses, et le regarde', { skip: sans, timeout: 120000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#fenetre .fe-tools', { timeout: 5000 });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].slice(0, 2).map((n: any) => { const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + Math.min(30, b.height / 2), id: n.dataset.id }; }));
    assert.ok(r.length === 2, 'deux widgets sur la page');
    const avant = await page.evaluate(() => window.__ressenti.length);
    await page.mouse.move(r[0].x, r[0].y); await page.mouse.down();
    for (let k = 1; k <= 12; k++) await page.mouse.move(r[0].x + ((r[1].x + 40 - r[0].x) * k) / 12, r[0].y + ((r[1].y - r[0].y) * k) / 12);
    await page.waitForTimeout(250);
    await capture(page, 'reaction-prise-1280');
    assert.deepEqual(await ressentis(page, avant), ['buddyRoam:excite'], 'pris : enthousiaste');
    await page.mouse.up();
    await page.waitForTimeout(60);
    const g = await page.evaluate(() => ({ joie: document.getElementById('buddyRoam').classList.contains('act-joy'), regard: document.getElementById('buddyRoam').classList.contains('follow') }));
    await capture(page, 'reaction-pose-1280');
    assert.deepEqual(await ressentis(page, avant), ['buddyRoam:excite', 'buddyRoam:joie'], 'posé : content');
    assert.deepEqual(g, { joie: true, regard: true }, 'un geste de joie, et il regarde le widget');
    // Le coin tiré : concentré, puis content quand la taille change.
    const avant2 = await page.evaluate(() => window.__ressenti.length);
    const c = await page.evaluate(() => { const b = document.querySelector('#feGrid > .fe-w .fe-rz').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await page.mouse.move(c.x, c.y); await page.mouse.down();
    await page.mouse.move(c.x + 160, c.y + 120, { steps: 8 });
    await page.waitForTimeout(150);
    assert.deepEqual(await ressentis(page, avant2), ['buddyRoam:concentration'], 'le coin tiré : concentré');
    await page.mouse.up();
    await page.waitForTimeout(150);
    const fin = await ressentis(page, avant2);
    assert.ok(fin.length === 1 || (fin.length === 2 && fin[1] === 'buddyRoam:joie'), `taille changée : content (${fin.join(', ')})`);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('réactions, 390 px, au clavier, thème sombre : Odin rangé dans le rond réagit dans le rond ; un petit saut', { skip: sans, timeout: 120000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390, { sombre: true });
  try {
    await remplir(page);
    await page.waitForFunction(() => window.OdinCompanion.etat().nid === 'barre', undefined, { timeout: 15000 });
    await vider(page); // la grille doit rester touchable ; il ressortira au plus tôt dans 6 s
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#fenetre .fe-tools', { timeout: 5000 });
    await page.waitForTimeout(300);
    if ((await nidDe(page)) !== 'barre') { await remplir(page); await page.waitForFunction(() => window.OdinCompanion.etat().nid === 'barre', undefined, { timeout: 15000 }); await vider(page); }
    const avant = await page.evaluate(() => window.__ressenti.length);
    await page.focus('#feGrid > .fe-w .fe-grip');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const saut = await page.evaluate(() => document.getAnimations().some((a: any) => a.effect?.target?.id === 'bnavNid'));
    await capture(page, 'reaction-clavier-rond-390-sombre');
    assert.deepEqual(await ressentis(page, avant), ['buddyBas:joie'], 'posé au clavier : content, dans le rond');
    assert.equal(saut, true, 'le rond fait un petit saut');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('réactions, « moins d\'animations » : l\'émotion seulement, ni geste, ni regard, ni saut', { skip: sans, timeout: 120000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280, { reduit: true });
  try {
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#fenetre .fe-tools', { timeout: 5000 });
    await page.waitForTimeout(300);
    const avant = await page.evaluate(() => window.__ressenti.length);
    await page.focus('#feGrid > .fe-w .fe-grip');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(80);
    const b = await page.evaluate(() => { const e = document.getElementById('buddyRoam'); return { geste: [...e.classList].some((c: string) => c.startsWith('act-')), regard: e.classList.contains('follow') }; });
    assert.deepEqual(await ressentis(page, avant), ['buddyRoam:joie']);
    assert.deepEqual(b, { geste: false, regard: false });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('réactions : rien pour un membre de la famille (il ne range pas la fenêtre)', { skip: sans, timeout: 120000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280, { membre: true });
  try {
    const avant = await page.evaluate(() => window.__ressenti.length);
    await page.evaluate(() => { for (const quoi of ['prise', 'coin', 'pose', 'taille']) document.dispatchEvent(new window.CustomEvent('odin:widget-geste', { detail: { quoi } })); });
    await page.waitForTimeout(100);
    assert.deepEqual(await ressentis(page, avant), [], 'aucune réaction');
    assert.equal(await page.evaluate(() => [...document.getElementById('buddyRoam').classList].some((c: string) => c.startsWith('act-'))), false, 'aucun geste');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
