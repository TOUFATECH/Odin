// Vénus · Nouveautés, Mes envies, À venir et la fenêtre « Ajouter à mon calendrier », dans un vrai navigateur et un
// vrai Odin d'essai (390 et 1280 px, sombre et clair) : ce qui se voit et se touche, mesuré à l'écran.
//  - le contour du clavier se voit sur le filtre choisi (il était de la couleur du fond du bouton) ;
//  - le titre d'une envie dans sa vignette n'est ni coupé en haut ni cassé au milieu d'un mot ;
//  - le titre posé sur la couleur d'une carte d'« À venir » se lit, comme la « Note » des Nouveautés en clair ;
//  - au téléphone, la pastille « Pas disponible » ne passe pas sous le ♡, même avec des mots plus longs ;
//  - au téléphone, « S'abonner (iPhone, Mac, Outlook) » a de l'air autour de ses deux lignes ; aucune page ne défile de côté.
// Les réponses du catalogue sont simulées dans le navigateur (titres inventés) ; aucune sortie réseau.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

// Le code passé au navigateur (evaluate) : le projet n'a pas les types du navigateur (pas de « dom » dans tsconfig).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, getComputedStyle: any, innerWidth: number;
type Page = any;
interface Navigateur { newContext(o: Record<string, unknown>): Promise<any>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.ODIN_CAPTURES;

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let od: VraiOdin, nav: Navigateur;
before(async () => {
  if (!pw) return;
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  od = await vraiOdin(tt, { compte: true });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); });

const jour = (d: number) => { const x = new Date(Date.now() + d * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const at = (d: number, h: number) => { const x = new Date(Date.now() + d * 864e5); x.setHours(h, 0, 0, 0); return x.getTime(); };
const LONG = 'Le Royaume de Sel avec un titre vraiment très long pour voir la coupe';
const ep = (i: number, titre: string, d: number) => ({ key: `serie:${200 + i}`, kind: 'show', title: titre, date: jour(d), at: at(d, 21), season: 1, episode: i + 1, epTitle: 'Le signal', network: 'Chaîne Une', pop: 80 - i });
const film = (i: number, titre: string, d: number) => ({ key: `film:${100 + i}`, kind: 'movie', title: titre, date: jour(d), year: 2026, release: 'Au cinéma', pop: 90 - i });
const DONNEES: Record<string, Record<string, unknown>> = {
  'a_venir:film': { regle: true, source: true, kind: 'movie', texte: '', entries: [film(0, 'Orbite Douce', 0), film(1, 'Minuit Quantique', 2)], suggestions: [], erreurs: [] },
  'a_venir:série': { regle: true, source: true, kind: 'show', texte: '', entries: [ep(0, 'Minuit Quantique', 0), ep(1, LONG, 0), ep(2, 'Échos d’Argile', 1)], suggestions: [], erreurs: [] },
  sorties_nouveautes: { regle: true, source: true, texte: '', sections: [{ title: 'Au cinéma en ce moment', items: [{ key: 'film:301', kind: 'movie', type: 'movie', title: 'Horizon Cobalt', date: jour(-12), score: 74, overview: 'Un résumé inventé pour l’essai.' }] }] },
  hnoss_envies: { envies: [
    { id: 'h-1', cle: 'film:901', titre: 'Les Voiles de Saturne', genre: 'film', annee: 2026, etat: 'en attente' },
    { id: 'h-2', cle: 'film:904', titre: LONG, genre: 'film', annee: 2027, etat: 'à valider' },
  ] },
};

async function ouvrir(largeur: number, theme: 'dark' | 'light', h: string) {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 844 : 900 }, colorScheme: theme, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  const page: Page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e: Error) => erreurs.push(String(e)));
  // « Selon l'appareil » : clair → le thème Blanc ; sombre → Venus.
  await page.route('**/venus/api/preferences', async (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: r.request().method() === 'GET' ? JSON.stringify({ preferences: { planete: 'venus', auto: theme === 'light' ? 'system' : 'off' } }) : '{"ok":true}' }));
  await page.route('**/api/valhalla/act', async (r: any) => {
    let b: any = {}; try { b = JSON.parse(r.request().postData() || '{}'); } catch { /* rien */ }
    const d = DONNEES[b.action === 'a_venir' ? `a_venir:${b.input?.genre}` : b.action];
    if (d) await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text: '', data: d }) }); else await r.continue();
  });
  await page.goto(`${od.url}/venus/app/${h}`);
  await page.waitForFunction(() => !document.querySelector('#app [aria-busy="true"]') && (document.querySelector('#app')?.innerHTML.length ?? 0) > 200, undefined, { timeout: 30000 });
  await page.waitForTimeout(600);
  if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/${largeur}-${theme}-${h.replace(/\W+/g, '-')}.png` });
  return { ctx, page, erreurs };
}

// Contraste WCAG entre deux couleurs « rgb(a) » ; une couleur translucide est d'abord posée sur `dessous`.
const CONTRASTE = `(() => {
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
  const sur = (c, d) => { const a = c[3] === undefined ? 1 : c[3]; return [0, 1, 2].map((i) => c[i] * a + d[i] * (1 - a)); };
  const lum = (c) => { const f = (u) => { u /= 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const fond = (e) => { const pile = []; for (; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length && (c[3] === undefined || c[3] > 0)) { pile.push(c); if (c[3] === undefined || c[3] >= 1) break; } } let d = [255, 255, 255]; for (const c of pile.reverse()) d = sur(c, d); return d; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  return { rgb, sur, fond, ratio };
})()`;

test('À venir, au clavier : le contour du filtre choisi se voit, en clair comme en sombre', { skip: sans }, async () => {
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page, erreurs } = await ouvrir(1280, theme, '#/films?vue=avenir');
    await page.focus('[data-act="upfilter"].on'); await page.keyboard.press('Shift'); await page.focus('[data-act="upfilter"].on');
    const m = await page.evaluate(`(() => { const C = ${CONTRASTE}; const b = document.activeElement, s = getComputedStyle(b);
      const w = parseFloat(s.outlineWidth), off = parseFloat(s.outlineOffset), dedans = off + w <= 0;
      const derriere = dedans ? C.fond(b) : C.fond(b.parentElement);
      return { visible: b.matches(':focus-visible'), style: s.outlineStyle, w, ratio: C.ratio(C.sur(C.rgb(s.outlineColor), derriere), derriere) }; })()`);
    assert.equal(m.visible, true, 'le filtre a le focus du clavier');
    assert.notEqual(m.style, 'none'); assert.ok(m.w >= 2, `contour de ${m.w} px`);
    assert.ok(m.ratio >= 3, `${theme} : contour du filtre choisi à ${m.ratio.toFixed(2)} contre ce qu'il recouvre (3 attendu)`);
    assert.deepEqual(erreurs, []); await ctx.close();
  }
});

test('Mes envies : le titre dans la vignette n\'est ni coupé en haut ni cassé au milieu d\'un mot', { skip: sans }, async () => {
  for (const [largeur, theme] of [[1280, 'dark'], [390, 'light']] as const) {
    const { ctx, page, erreurs } = await ouvrir(largeur, theme, '#/liste?vue=envies');
    const m = await page.evaluate(() => [...document.querySelectorAll('.wish-pic')].map((pic: any) => {
      const p = pic.getBoundingClientRect(), txt: any[] = [];
      const w = document.createTreeWalker(pic, 4); for (let n = w.nextNode(); n; n = w.nextNode()) txt.push(n);
      const casses: string[] = [], hors: string[] = [];
      for (const n of txt) {
        for (const mot of n.textContent.matchAll(/\S+/g)) {
          const r = document.createRange(); r.setStart(n, mot.index); r.setEnd(n, mot.index + mot[0].length);
          const rs = [...r.getClientRects()].filter((x: any) => x.width > 0);
          if (rs.length > 1) casses.push(mot[0]);
          // Un mot visible (dans la hauteur de la vignette) ne doit pas déborder par le haut.
          for (const x of rs) if (x.top < p.top - 0.5 && x.bottom > p.top + 0.5) hors.push(mot[0]);
        }
      }
      const premier = txt.length ? (() => { const r = document.createRange(); r.selectNodeContents(txt[0]); return [...r.getClientRects()][0]; })() : null;
      return { titre: pic.textContent.trim().slice(0, 30), casses, hors, premierEnHaut: premier ? premier.top >= p.top - 0.5 : true, visible: txt.length > 0 };
    }));
    assert.equal(m.length, 2);
    for (const x of m) {
      assert.ok(x.visible, 'le titre reste dans la vignette, comme dans l\'appli d\'origine');
      assert.deepEqual(x.casses, [], `${largeur} ${theme} « ${x.titre} » : mot cassé`);
      assert.deepEqual(x.hors, [], `${largeur} ${theme} « ${x.titre} » : mot coupé en haut`);
      assert.ok(x.premierEnHaut, `${largeur} ${theme} « ${x.titre} » : la première ligne est cachée`);
    }
    assert.deepEqual(erreurs, []); await ctx.close();
  }
});

test('À venir et Nouveautés en clair : le titre sur la couleur d\'une carte et la « Note » se lisent', { skip: sans }, async () => {
  let { ctx, page, erreurs } = await ouvrir(1280, 'light', '#/series?vue=avenir');
  const cartes = await page.evaluate(`(() => { const C = ${CONTRASTE}; return [...document.querySelectorAll('.up-card .up-ph span')].map((s) => {
    const fonds = (getComputedStyle(s.parentElement).backgroundImage.match(/rgba?\\([^)]*\\)/g) || []).map(C.rgb);
    const c = C.rgb(getComputedStyle(s).color); return { t: s.textContent.slice(0, 20), min: fonds.length ? Math.min(...fonds.map((f) => C.ratio(c, f))) : 0 }; }); })()`);
  assert.ok(cartes.length >= 3);
  for (const x of cartes) assert.ok(x.min >= 4.5, `« ${x.t} » sur la couleur de la carte : ${x.min.toFixed(2)} (4,5 attendu)`);
  assert.deepEqual(erreurs, []); await ctx.close();
  ({ ctx, page, erreurs } = await ouvrir(1280, 'light', '#/nouveautes'));
  const note = await page.evaluate(`(() => { const C = ${CONTRASTE}; const s = document.querySelector('.spotlight .r-tmdb .r-src'); return s ? C.ratio(C.rgb(getComputedStyle(s).color), C.fond(s)) : 0; })()`);
  assert.ok(note >= 4.5, `« Note » à ${note.toFixed(2)} (4,5 attendu)`);
  assert.deepEqual(erreurs, []); await ctx.close();
});

test('au téléphone : la pastille d\'une carte ne passe pas sous ♡ ⬇, même avec des mots plus longs ; aucune page ne défile de côté', { skip: sans }, async () => {
  for (const theme of ['dark', 'light'] as const) {
    for (const h of ['#/nouveautes', '#/films?vue=avenir', '#/series?vue=avenir', '#/liste?vue=envies']) {
      const { ctx, page, erreurs } = await ouvrir(390, theme, h);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, `${theme} ${h} : défilement de côté`);
      if (h === '#/series?vue=avenir') {
        const chevauche = () => page.evaluate(() => [...document.querySelectorAll('.up-card')].map((c: any) => {
          const b = c.querySelector('.up-badge'), a = c.querySelector('.up-acts'); if (!b || !a) return null;
          const x = b.getBoundingClientRect(), y = [...a.querySelectorAll('.up-act')].map((e: any) => e.getBoundingClientRect());
          const gauche = Math.min(...y.map((r: any) => r.left));
          const ti = c.querySelector('.up-ph span'), tr = ti ? (() => { const r = document.createRange(); r.selectNodeContents(ti); return r.getBoundingClientRect(); })() : null;
          return { t: b.textContent, ecart: gauche - x.right, dedans: x.right <= c.getBoundingClientRect().right, entier: b.scrollWidth <= b.clientWidth + 1, surTitre: tr ? x.bottom > tr.top && x.right > tr.left && x.left < tr.right : false };
        }).filter(Boolean));
        for (const x of await chevauche()) { assert.ok(x.ecart >= 4 && x.dedans, `${theme} « ${x.t} » à ${x.ecart.toFixed(1)} px du ♡`); assert.ok(x.entier, `${theme} « ${x.t} » : coupé par « … »`); assert.ok(!x.surTitre, `${theme} « ${x.t} » : sur le titre de la carte`); }
        // Une langue aux mots plus longs : la pastille passe à la ligne, jamais sous les boutons.
        await page.evaluate(() => { for (const b of document.querySelectorAll('.up-card .up-badge')) b.textContent = 'Nicht verfügbar im Moment'; });
        for (const x of await chevauche()) { assert.ok(x.ecart >= 4 && x.dedans, `${theme} mots longs : à ${x.ecart.toFixed(1)} px du ♡`); assert.ok(x.entier, `${theme} mots longs : coupés par « … »`); }
        assert.ok(await page.evaluate(() => innerWidth) === 390);
      }
      assert.deepEqual(erreurs, []); await ctx.close();
    }
  }
});

test('au téléphone, la fenêtre du calendrier : « S’abonner (iPhone, Mac, Outlook) » n’est pas à l’étroit dans son bouton, rien ne déborde', { skip: sans }, async () => {
  for (const theme of ['light', 'dark'] as const) {
    const { ctx, page, erreurs } = await ouvrir(390, theme, '#/films?vue=avenir');
    await page.click('[data-act="ical"]');
    await page.waitForSelector('.cal-sheet .btn-play', { timeout: 15000 }); await page.waitForTimeout(400);
    if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/390-${theme}-fenetre.png` });
    const m = await page.evaluate(() => {
      const b = document.querySelector('.cal-sheet .btn-play'), r = b.getBoundingClientRect(), s = getComputedStyle(b);
      const lignes = new Set<number>(), w = document.createTreeWalker(b, 4); let haut = Infinity, bas = -Infinity;
      for (let n = w.nextNode(); n; n = w.nextNode()) { const t = document.createRange(); t.selectNodeContents(n); for (const x of t.getClientRects()) if (x.width > 2) { lignes.add(Math.round(x.top)); haut = Math.min(haut, x.top); bas = Math.max(bas, x.bottom); } }
      return { lignes: lignes.size, air: Math.min(haut - r.top, r.bottom - bas), h: r.height, w: r.width, dedans: r.right <= innerWidth && r.left >= 0, scrollW: document.documentElement.scrollWidth };
    });
    // Une ligne ou deux selon la langue : jamais collées au bord du bouton (au moins 8 px au-dessus et au-dessous).
    assert.ok(m.lignes >= 1 && m.air >= 8, `${theme} : « S’abonner » sur ${m.lignes} ligne(s), ${m.air.toFixed(1)} px du bord (8 attendus)`);
    assert.ok(m.h >= 44 && m.dedans, JSON.stringify(m)); assert.equal(m.scrollW, 390);
    assert.deepEqual(erreurs, []); await ctx.close();
  }
});
