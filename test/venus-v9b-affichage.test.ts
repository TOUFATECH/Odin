// Vénus, la page Qualité, dans un vrai navigateur et un vrai Odin d'essai : 390 et 1280 px, clair et sombre, français
// et anglais. Les constats sont ceux que cet Odin jetable calcule d'après une bibliothèque d'essai (titres inventés,
// dont un très long et un piégé) : rien n'est simulé côté navigateur, sauf la planète choisie.
// Mesuré à l'écran : aucune page ne défile de côté, rien ne dépasse, chaque cible fait 44 px, le contour du clavier
// se voit, les textes se lisent, la rubrique tient au rechargement, et la page ne se repeint pas toute seule.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { dirVenus, magasinVenus, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier } from '../src/valhalla/venus/bibliotheque.ts';

// Le code passé au navigateur (evaluate) : le projet n'a pas les types du navigateur (pas de « dom » dans tsconfig).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, getComputedStyle: any, innerWidth: number, MutationObserver: any, window: any;
type Page = any;
interface Navigateur { newContext(o: Record<string, unknown>): Promise<any>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.ODIN_CAPTURES;

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let od: VraiOdin, nav: Navigateur, mag: MagasinVenus, media = '';
before(async () => {
  if (!pw) return;
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  od = await vraiOdin(tt, { compte: true });
  nav = await pw.chromium.launch();
  const home = od.o.paths.home; mag = magasinVenus(home, dirVenus(home));
  media = mkdtempSync(join(tmpdir(), 'venus-v9b-affichage-')); const films = join(media, 'films'), series = join(media, 'series'); mkdirSync(films); mkdirSync(series);
  const fich = (chemin: string, taille: number, l: number, h: number, codec: string, duree: number) => { writeFileSync(chemin, 'x'); mag.poser('fichiers', chemin.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(-199), { chemin, taille, mtime: 1, probe: { duree, largeur: l, hauteur: h, codecs: [codec], audio: ['aac'], sousTitres: [] } }); };
  const titres: Array<[string, number, number, string, number]> = [
    ['Le Verger', 1920, 1080, 'hevc', 4e9], ['La Montagne', 3840, 2160, 'hevc', 18e9], ['Vieux Film', 640, 480, 'mpeg4', 7e8], ['Gravier', 1920, 1080, 'h264', 5e8],
    [`<img src=x onerror="alert(1)">${'Un titre vraiment très long '.repeat(8)}`, 1920, 1080, 'msmpeg4v3', 3e9], ['Le Port', 1280, 720, 'h264', 2e9], ['Les Dunes', 720, 576, 'mpeg2video', 4e9],
  ];
  titres.forEach(([titre, l, h, codec, taille], i) => { const f = join(films, `f${i}.mkv`); fich(f, taille, l, h, codec, 6000); mag.poser('oeuvres', `film:f${i}`, { type: 'film', titre, annee: 2000 + i, duree: 6000, fichier: f }); });
  mag.poser('oeuvres', 'serie:s', { type: 'serie', categorie: 'anime', titre: 'Les Îles d’un archipel au nom vraiment très long' });
  for (const ep of [1, 2, 3]) { const e = join(series, `s1e${ep}.mkv`); fich(e, 4e8, 1280, 720, 'h264', 1440); mag.poser('episodes', `serie:s:s1e${ep}`, { oeuvre_id: 'serie:s', saison: 1, episode: ep, titre: 'Les Îles', fichier: e, duree: 1440 }); }
  ajouterDossier(mag, films, 'films'); ajouterDossier(mag, series, 'series');
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); if (media) rmSync(media, { recursive: true, force: true }); });

const ONGLETS = ['improve', 'all', '4K', '1080p', '720p', 'SD'];
async function ouvrir(largeur: number, theme: 'dark' | 'light', langue: 'fr-FR' | 'en-US', h = '#/qualite') {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 844 : 900 }, colorScheme: theme, hasTouch: doigt, isMobile: doigt, locale: langue });
  const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  const page: Page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e: Error) => erreurs.push(String(e)));
  // « Selon l'appareil » : clair → le thème Blanc ; sombre → Venus.
  await page.route('**/venus/api/preferences', async (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().method() === 'GET' ? JSON.stringify({ preferences: { planete: 'venus', auto: theme === 'light' ? 'system' : 'off' } }) : '{"ok":true}' }));
  await page.goto(`${od.url}/venus/app/${h}`);
  await page.waitForSelector('.q-summary', { timeout: 30000 });
  await page.waitForTimeout(400);
  return { ctx, page, erreurs };
}
const FINI = () => document.getAnimations().every((a: any) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity);

// Contraste WCAG entre deux couleurs « rgb(a) » ; une couleur translucide est d'abord posée sur `dessous`.
const CONTRASTE = `(() => {
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
  const sur = (c, d) => { const a = c[3] === undefined ? 1 : c[3]; return [0, 1, 2].map((i) => c[i] * a + d[i] * (1 - a)); };
  const lum = (c) => { const f = (u) => { u /= 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const fond = (e) => { const pile = []; for (; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage && s.backgroundImage !== 'none') return null; const c = rgb(s.backgroundColor); if (c.length && (c[3] === undefined || c[3] > 0)) { pile.push(c); if (c[3] === undefined || c[3] >= 1) break; } } let d = [255, 255, 255]; for (const c of pile.reverse()) d = sur(c, d); return d; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  return { rgb, sur, fond, ratio };
})()`;
/** Ce qui dépasse, les cibles trop petites et les textes peu lisibles de la page Qualité. */
const MESURE = `(() => { const C = ${CONTRASTE};
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const page = document.querySelector('main .page');
  const cibles = [...page.querySelectorAll('button, a[href]')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 30), w: r.width, h: r.height }; }).filter((x) => x.w < 44 - 0.5 || x.h < 44 - 0.5);
  // Ce qui défile dans sa propre barre (les rubriques au téléphone) n'est pas « hors de l'écran ».
  const defile = (e) => { for (let p = e.parentElement; p && p !== page; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { const r = p.getBoundingClientRect(); if (r.right <= innerWidth + 0.5 && r.left >= -0.5) return true; } } return false; };
  const hors = [...page.querySelectorAll('*')].filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return (r.right > innerWidth + 0.5 || r.left < -0.5) && !defile(e); }).map((e) => e.className || e.tagName).slice(0, 5);
  // Un titre coupé (points de suspension, comme Quality.js) garde son entier en info-bulle ; le reste ne se coupe pas.
  const coupes = [...page.querySelectorAll('.q-text small, .q-text em, .q-bar span, .q-improve span, .count')].filter(vis).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map((e) => e.textContent.slice(0, 30));
  const titresSansBulle = [...page.querySelectorAll('.q-text b')].filter((b) => b.scrollWidth > b.clientWidth + 1 && b.getAttribute('title') !== b.textContent).length;
  const faibles = [];
  for (const e of page.querySelectorAll('*')) {
    if (!vis(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const f = C.fond(e); if (!f) continue;
    const s = getComputedStyle(e), r = C.ratio(C.sur(C.rgb(s.color), f), f), grand = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
    if (r < (grand ? 3 : 4.5)) faibles.push(e.textContent.trim().slice(0, 24) + ' ' + r.toFixed(2));
  }
  return { scrollW: document.documentElement.scrollWidth, cibles, hors, coupes, titresSansBulle, faibles, html: !!page.querySelector('.q-text img') };
})()`;

for (const [largeur, theme, langue] of [[390, 'dark', 'fr-FR'], [390, 'light', 'en-US'], [1280, 'light', 'fr-FR'], [1280, 'dark', 'en-US']] as const) {
  test(`chaque rubrique à ${largeur} px, ${theme === 'dark' ? 'sombre' : 'clair'}, ${langue} : rien ne déborde, cibles de 44 px, textes lisibles`, { skip: sans }, async () => {
    const { ctx, page, erreurs } = await ouvrir(largeur, theme, langue);
    const pb: string[] = [];
    assert.equal(await page.evaluate(() => document.querySelector('h1').textContent), langue === 'fr-FR' ? 'Qualité' : 'Quality');
    for (const o of ONGLETS) {
      await page.click(`[data-act="qtab"][data-v="${o}"]`); await page.waitForFunction(FINI, undefined, { timeout: 15000 });
      assert.equal(await page.evaluate(() => document.location.hash), `#/qualite?tab=${o}`);
      if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/qualite-${largeur}-${theme}-${langue}-${o}.png`, fullPage: true });
      const m = await page.evaluate(MESURE);
      // Au téléphone, la barre des rubriques défile de côté : la rubrique choisie y est entière.
      const vue = await page.evaluate(() => { const nv = document.querySelector('.toolbar .seg').getBoundingClientRect(), on = document.querySelector('.toolbar .seg-b.on').getBoundingClientRect(); return on.left >= nv.left - 0.5 && on.right <= nv.right + 0.5; });
      if (!vue) pb.push(`${o} : la rubrique choisie est cachée dans la barre`);
      if (m.scrollW !== largeur) pb.push(`${o} : la page défile de côté (${m.scrollW})`);
      for (const x of m.hors) pb.push(`${o} : dépasse de l'écran : ${x}`);
      for (const x of m.cibles) pb.push(`${o} : cible de moins de 44 px : ${x.t} ${Math.round(x.w)}×${Math.round(x.h)}`);
      for (const x of m.coupes) pb.push(`${o} : texte coupé : ${x}`);
      for (const x of m.faibles) pb.push(`${o} : contraste trop faible : ${x}`);
      if (m.titresSansBulle) pb.push(`${o} : ${m.titresSansBulle} titre(s) coupé(s) sans info-bulle`);
      if (m.html) pb.push(`${o} : du HTML d'un titre a été interprété`);
      const txt = await page.evaluate(() => document.querySelector('main .page').textContent);
      if (/HDR|5\.1|\.mkv/.test(txt)) pb.push(`${o} : une mesure qu'Odin n'a pas, ou un nom de fichier`);
    }
    assert.deepEqual([...new Set(pb)], []);
    // Rechargement sur une rubrique : elle reste choisie.
    await page.reload(); await page.waitForSelector('.q-summary');
    assert.equal(await page.evaluate(() => document.querySelector('[data-act="qtab"][aria-pressed="true"]').dataset.v), 'SD');
    assert.deepEqual(erreurs, []); await ctx.close();
  });
}

test('au clavier : le contour se voit ; la page ne se repeint pas toute seule et garde le focus', { skip: sans }, async () => {
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page, erreurs } = await ouvrir(1280, theme, 'fr-FR', '#/qualite?tab=all');
    await page.focus('[data-act="qtab"][data-v="720p"]'); await page.keyboard.press('Shift'); await page.focus('[data-act="qtab"][data-v="720p"]');
    const c = await page.evaluate(() => { const b = document.activeElement, s = getComputedStyle(b); return { visible: b.matches(':focus-visible'), style: s.outlineStyle, w: parseFloat(s.outlineWidth) }; });
    assert.equal(c.visible, true); assert.notEqual(c.style, 'none'); assert.ok(c.w >= 2, `${theme} : contour de ${c.w} px`);
    // Entrée sur une rubrique : elle est choisie, et le focus reste sur elle.
    await page.keyboard.press('Enter'); await page.waitForFunction(FINI, undefined, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.dataset.v), '720p');
    await page.evaluate(() => { window.__repeint = 0; new MutationObserver(() => { window.__repeint++; }).observe(document.querySelector('#app'), { childList: true, subtree: true }); });
    await page.waitForTimeout(6000);
    const apres = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.dataset.v, repeint: window.__repeint }));
    assert.equal(apres.focus, '720p', `${theme} : le focus est resté`);
    assert.equal(apres.repeint, 0, `${theme} : ${apres.repeint} repeints en 6 s`);
    // Le lien d'un titre se suit au clavier (contour visible).
    await page.focus('.q-main'); const l = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.notEqual(l, 'none');
    assert.deepEqual(erreurs, []); await ctx.close();
  }
});
