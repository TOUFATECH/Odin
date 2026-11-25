// Vénus, le tableau de bord, dans un vrai navigateur et un vrai Odin d'essai : 390 et 1280 px, clair et sombre,
// français et anglais. Les données sont celles que cet Odin jetable garde (une bibliothèque d'essai, une lecture en
// cours, un téléchargement rangé, des écrans connus) : rien n'est simulé côté navigateur, sauf la planète choisie.
// Mesuré à l'écran : aucune page ne défile de côté, rien ne dépasse, chaque cible fait 44 px, le contour du clavier
// se voit, les textes se lisent, et la relecture toutes les 4 s ne repeint pas la page à chaque seconde ni ne vole
// le focus. Sans Playwright sur la machine, l'essai est ignoré (il le dit).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { dirVenus, magasinVenus, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, ajouterHistorique, noterReprise } from '../src/valhalla/venus/bibliotheque.ts';
import { noter } from '../src/valhalla/venus/comete/index.ts';
import { reglerSourcesSante } from '../src/valhalla/venus/entretien.ts';

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
  // La bibliothèque d'essai de cet Odin (titres, dossiers et écrans inventés).
  const home = od.o.paths.home; mag = magasinVenus(home, dirVenus(home));
  media = mkdtempSync(join(tmpdir(), 'venus-v9a-affichage-')); const films = join(media, 'films'); mkdirSync(films);
  const f = join(films, 'Le Phare (2020).mkv'); writeFileSync(f, 'x');
  mag.poser('fichiers', f.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(-199), { chemin: f, taille: 2_000_000_000, mtime: 1 });
  mag.poser('oeuvres', 'film:a', { type: 'film', titre: 'Le Phare', annee: 2020, duree: 6000, fichier: f });
  mag.poser('oeuvres', 'serie:s', { type: 'serie', categorie: 'anime', titre: 'Les Îles d’un archipel au nom vraiment très long' });
  mag.poser('episodes', 'serie:s:s1e1', { oeuvre_id: 'serie:s', saison: 1, episode: 1, titre: 'Les Îles', fichier: join(media, 'animes', 'x.mkv'), duree: 1440 });
  ajouterDossier(mag, films, 'films'); ajouterDossier(mag, join(media, 'un-dossier-debranche-au-nom-long-pour-voir-la-coupe'), 'series');
  ajouterHistorique(mag, 'moi', 'film:a', 'video', 'Le Phare');
  noter(mag, 'terminé', { id: 't1', titre: 'Les Îles d’un archipel au nom vraiment très long S01E01' }, '1 octets');
  mag.poser('hors_ligne', 'dl-aaaaaaaaaaaa', { profil: 'moi', cible: 'film:a', titre: 'Le Phare', quality: '720p', etat: 'working', progress: 40, cree: Date.now() });
  for (let i = 0; i < 6; i++) mag.poser('ecrans', `media_player.e${i}`, { nom: `Écran ${i + 1} du salon`, type: i % 2 ? 'enceinte' : 'tv', vu: Date.now() - i * 60_000 });
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); if (media) rmSync(media, { recursive: true, force: true }); });

const ONGLETS = ['apercu', 'lectures', 'appareils', 'activite', 'sante', 'taches', 'medias'];
async function ouvrir(largeur: number, theme: 'dark' | 'light', langue: 'fr-FR' | 'en-US', h = '#/dashboard') {
  noterReprise(mag, 'moi', 'film:a', 600, 6000); // « en ce moment » : la reprise vient d'être notée
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 844 : 900 }, colorScheme: theme, hasTouch: doigt, isMobile: doigt, locale: langue });
  const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  const page: Page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e: Error) => erreurs.push(String(e)));
  // « Selon l'appareil » : clair → le thème Blanc ; sombre → Venus.
  await page.route('**/venus/api/preferences', async (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().method() === 'GET' ? JSON.stringify({ preferences: { planete: 'venus', auto: theme === 'light' ? 'system' : 'off' } }) : '{"ok":true}' }));
  await page.goto(`${od.url}/venus/app/${h}`);
  await page.waitForSelector('#tb-zone', { timeout: 30000 });
  await page.waitForTimeout(500);
  return { ctx, page, erreurs };
}

// Contraste WCAG entre deux couleurs « rgb(a) » ; une couleur translucide est d'abord posée sur `dessous`.
const CONTRASTE = `(() => {
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
  const sur = (c, d) => { const a = c[3] === undefined ? 1 : c[3]; return [0, 1, 2].map((i) => c[i] * a + d[i] * (1 - a)); };
  const lum = (c) => { const f = (u) => { u /= 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const fond = (e) => { const pile = []; for (; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage && s.backgroundImage !== 'none') return null; const c = rgb(s.backgroundColor); if (c.length && (c[3] === undefined || c[3] > 0)) { pile.push(c); if (c[3] === undefined || c[3] >= 1) break; } } let d = [255, 255, 255]; for (const c of pile.reverse()) d = sur(c, d); return d; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  return { rgb, sur, fond, ratio };
})()`;
/** Ce qui dépasse, les cibles trop petites et les textes peu lisibles de la page du tableau de bord. */
const MESURE = `(() => { const C = ${CONTRASTE};
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const page = document.querySelector('.page.dash');
  const cibles = [...page.querySelectorAll('button, a[href], summary')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30), w: r.width, h: r.height }; }).filter((x) => x.w < 44 - 0.5 || x.h < 44 - 0.5);
  // Ce qui défile dans sa propre barre (les rubriques au téléphone, comme les Réglages) n'est pas « hors de l'écran ».
  const defile = (e) => { for (let p = e.parentElement; p && p !== page; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { const r = p.getBoundingClientRect(); if (r.right <= innerWidth + 0.5 && r.left >= -0.5) return true; } } return false; };
  const hors = [...page.querySelectorAll('*')].filter(vis).filter((e) => { const r = e.getBoundingClientRect(); return (r.right > innerWidth + 0.5 || r.left < -0.5) && !defile(e); }).map((e) => e.className || e.tagName).slice(0, 5);
  const coupes = [...page.querySelectorAll('.dev .grow span, .dev .grow b, .task span, .timeline p, .np-title, .kpi-more, .dash-sub, .status-chip, .gauge .g-txt small')].filter(vis).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map((e) => e.textContent.slice(0, 30));
  const faibles = [];
  for (const e of page.querySelectorAll('*')) {
    if (!vis(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const f = C.fond(e); if (!f) continue;
    const s = getComputedStyle(e), r = C.ratio(C.sur(C.rgb(s.color), f), f), grand = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
    if (r < (grand ? 3 : 4.5)) faibles.push(e.textContent.trim().slice(0, 24) + ' ' + r.toFixed(2));
  }
  // L'icône de la rubrique choisie se voit sur son fond (3 pour 1 au moins, comme tout dessin utile).
  for (const e of page.querySelectorAll('.set-tab.on svg')) {
    const f = C.fond(e); if (!f || !vis(e)) continue;
    const r = C.ratio(C.sur(C.rgb(getComputedStyle(e).color), f), f);
    if (r < 3) faibles.push('icône de la rubrique choisie ' + r.toFixed(2));
  }
  return { scrollW: document.documentElement.scrollWidth, cibles, hors, coupes, faibles };
})()`;

for (const [largeur, theme, langue] of [[390, 'dark', 'fr-FR'], [390, 'light', 'en-US'], [1280, 'light', 'fr-FR'], [1280, 'dark', 'en-US']] as const) {
  test(`chaque rubrique à ${largeur} px, ${theme === 'dark' ? 'sombre' : 'clair'}, ${langue} : rien ne déborde, cibles de 44 px, textes lisibles`, { skip: sans }, async () => {
    const { ctx, page, erreurs } = await ouvrir(largeur, theme, langue);
    const pb: string[] = [];
    for (const o of ONGLETS) {
      await page.click(`[data-act="dashtab"][data-v="${o}"]`); await page.waitForFunction(() => document.getAnimations().every((a: any) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 15000 }); // l'entrée de la page (animation) est finie
      assert.equal(await page.evaluate(() => document.location.hash), o === 'apercu' ? '#/dashboard' : `#/dashboard?tab=${o}`);
      if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/${largeur}-${theme}-${langue}-${o}.png`, fullPage: true });
      const m = await page.evaluate(MESURE);
      // Au téléphone, la barre des rubriques défile de côté : la rubrique choisie y est entière.
      const vue = await page.evaluate(() => { const nv = document.querySelector('.dash .set-nav').getBoundingClientRect(), on = document.querySelector('.dash .set-tab.on').getBoundingClientRect(); return on.left >= nv.left - 0.5 && on.right <= nv.right + 0.5; });
      if (!vue) pb.push(`${o} : la rubrique choisie est cachée dans la barre`);
      if (m.scrollW !== largeur) pb.push(`${o} : la page défile de côté (${m.scrollW})`);
      for (const x of m.hors) pb.push(`${o} : dépasse de l'écran : ${x}`);
      for (const x of m.cibles) pb.push(`${o} : cible de moins de 44 px : ${x.t} ${Math.round(x.w)}×${Math.round(x.h)}`);
      for (const x of m.coupes) pb.push(`${o} : texte coupé : ${x}`);
      for (const x of m.faibles) pb.push(`${o} : contraste trop faible : ${x}`);
      assert.ok(!/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(await page.evaluate(() => document.querySelector('.page.dash').textContent)), `${o} : une adresse IP`);
    }
    assert.deepEqual([...new Set(pb)], []);
    // Rechargement sur une rubrique : elle reste choisie.
    await page.reload(); await page.waitForSelector('#tb-zone');
    assert.equal(await page.evaluate(() => document.querySelector('[data-act="dashtab"][aria-current="page"]').dataset.v), 'medias');
    assert.deepEqual(erreurs, []); await ctx.close();
  });
}

// Une machine où Odin ne lit ni le processeur, ni la mémoire, ni les disques : chaque jauge dit « source absente »
// avec sa raison, en entier, et la pastille de l'en-tête n'affirme pas « Tout va bien ».
test('santé sans source, à 390 et 1280 px, clair et sombre, en français et en anglais : la raison se lit en entier, rien d’affirmé', { skip: sans }, async () => {
  reglerSourcesSante({ cpus: () => [], memTotale: () => 0, memLibre: () => 0, place: () => undefined });
  try {
    for (const [largeur, theme, langue] of [[390, 'light', 'fr-FR'], [390, 'dark', 'en-US'], [1280, 'light', 'en-US'], [1280, 'dark', 'fr-FR']] as const) {
      const { ctx, page, erreurs } = await ouvrir(largeur, theme, langue, '#/dashboard?tab=sante');
      await page.waitForFunction(() => document.getAnimations().every((a: any) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 15000 }); // l'entrée de la page (animation) est finie
      const m = await page.evaluate(MESURE), ici = `${largeur} ${theme} ${langue}`;
      const x = await page.evaluate(() => ({ absentes: document.querySelectorAll('.gauge.absente').length, chip: document.querySelector('.status-chip.good'), txt: document.querySelector('.page.dash').textContent }));
      assert.equal(x.absentes, 3, `${ici} : trois jauges « source absente »`);
      assert.ok(!/\b0 %/.test(x.txt), `${ici} : jamais 0 %`);
      assert.equal(x.chip, null, `${ici} : pas de « Tout va bien » sans mesure`);
      assert.deepEqual([...m.coupes, ...m.faibles, ...m.hors], [], ici);
      assert.equal(m.scrollW, largeur);
      if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/sans-source-${largeur}-${theme}-${langue}.png`, fullPage: true });
      assert.deepEqual(erreurs, []); await ctx.close();
    }
  } finally { reglerSourcesSante(); }
});

test('au clavier : le contour se voit ; la relecture toutes les 4 s garde le focus et ne repeint pas à chaque seconde', { skip: sans }, async () => {
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page, erreurs } = await ouvrir(1280, theme, 'fr-FR', '#/dashboard?tab=sante');
    await page.focus('[data-act="dashtab"][data-v="sante"]'); await page.keyboard.press('Shift'); await page.focus('[data-act="dashtab"][data-v="sante"]');
    const c = await page.evaluate(() => { const b = document.activeElement, s = getComputedStyle(b); return { visible: b.matches(':focus-visible'), style: s.outlineStyle, w: parseFloat(s.outlineWidth) }; });
    assert.equal(c.visible, true); assert.notEqual(c.style, 'none'); assert.ok(c.w >= 2, `${theme} : contour de ${c.w} px`);
    // Le détail de la santé (dans la rubrique, repeinte quand une mesure change) garde le focus et reste ouvert.
    await page.click('#tb-zone summary'); await page.focus('#tb-zone summary');
    await page.evaluate(() => { window.__repeint = 0; new MutationObserver(() => { window.__repeint++; }).observe(document.querySelector('#tb-zone'), { childList: true }); });
    await page.waitForTimeout(9000);
    const apres = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.matches('#tb-zone summary'), ouvert: !!document.querySelector('#tb-zone details[open]'), repeint: window.__repeint }));
    assert.ok(apres.focus, `${theme} : le focus est resté sur « Détails »`);
    assert.ok(apres.ouvert, `${theme} : « Détails » reste ouvert`);
    assert.ok(apres.repeint <= 3, `${theme} : ${apres.repeint} repeints en 9 s`);
    assert.deepEqual(erreurs, []); await ctx.close();
  }
});
