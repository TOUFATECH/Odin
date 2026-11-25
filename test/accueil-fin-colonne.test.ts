// Aujourd'hui en widgets (maquette validée « Accueil », lot 27, fin) : l'ancienne colonne est retirée chez le
// propriétaire, la visite guidée est remise à l'heure.
// Prouvé ici :
// - chez le propriétaire : plus d'ancienne colonne (la place des blocs du jour est vide et cachée ; « État détaillé »
//   ne garde que ce qui n'a pas de widget, « Ce qu'Odin a fait » avec « Tout voir », et son titre ne dit plus que
//   cela) ; chaque bloc est dans son widget ; le bandeau du coffre verrouillé et celui des mises à jour restent
//   au-dessus de la grille, hors widgets ;
// - un membre, et une fenêtre pas encore lue (ou en panne) : l'accueil d'avant, à l'ancienne place, avec le titre
//   d'avant ; rien ne disparaît pour eux ;
// - la visite guidée ne vise plus un morceau disparu : dans un vrai navigateur (s'il y en a un), à 1280 et 390 px,
//   chacune de ses étapes de l'accueil entoure le widget du bloc chez le propriétaire, et l'ancienne place chez un
//   membre ou quand la fenêtre n'est pas lue ; l'étape des tuiles entoure les quatre (celles qui restent sur la page) ;
//   l'anneau est posé une fois le défilement fini, jamais sur la barre du bas du téléphone ;
// - la fenêtre arrive après le dernier dessin de l'accueil : le titre de « État détaillé » suit quand même ;
// - le bandeau du coffre est juste au-dessus des blocs : de la grille chez le propriétaire, de l'ancienne colonne chez
//   un membre ou quand la fenêtre n'est pas lue (leur affichage d'avant).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const UI = lire('src/web/ui.html'), FE = lire('src/web/fenetre.js'), GUIDE = lire('src/web/guide.js');
const IDS = ['gladsheim', 'midgard', 'vordr', 'var'];
/** Le corps d'une fonction nommée d'un fichier (de sa déclaration à l'accolade qui la ferme). */
function fonction(src: string, nom: string): string {
  const i = src.indexOf(`function ${nom}(`); assert.ok(i >= 0, `la fonction ${nom} existe`);
  let n = 0;
  for (let j = src.indexOf('{', i); j < src.length; j++) { if (src[j] === '{') n++; else if (src[j] === '}' && --n === 0) return src.slice(i, j + 1); }
  throw new Error(`${nom} n'est pas fermée`);
}
/** Les étapes de la visite guidée (le texte du tableau des chapitres). */
const visite = () => { const d = UI.indexOf('const CHAPTERS = ['); assert.ok(d > 0, 'la visite guidée existe'); return UI.slice(d, UI.indexOf('let TOUR = ', d)); };

// ------------------------------------------------------------------ lus dans le code

test('la visite guidée : aucune étape ne vise un morceau disparu ; chaque bloc du jour est visé dans son widget, puis à son ancienne place', () => {
  const c = visite();
  // Les morceaux qui ne sont plus là : « À faire maintenant » n'est plus posé nulle part, et chez le propriétaire les
  // chiffres et les tuiles ne sont plus dans « État détaillé ».
  assert.doesNotMatch(c, /'#homeGrid \.hcols/, 'plus de cible dans les colonnes d\'« État détaillé »');
  assert.doesNotMatch(c, /q: '#homeGrid \.(kpis|hgrid2)'/, 'jamais l\'ancienne place seule');
  assert.doesNotMatch(c, /À faire maintenant/, 'le bloc s\'appelle « À faire »');
  for (const k of ['chiffres_cles', 'a_faire', 'odin_a_fait', 'application']) {
    const pas = new RegExp(`\\{ v: 'home', pre: ouvrirDuJour\\('${k}'\\), q: \\[carteDuJour\\('${k}'\\), '[^\\]]+\\]`).exec(c);
    assert.ok(pas, `${k} : la page qui porte le widget s'ouvre, le widget est visé d'abord, puis l'ancienne place`);
  }
  // Les quatre tuiles : la page de la première qui reste s'ouvre, et l'anneau entoure toutes celles de cette page.
  assert.match(c, /\{ v: 'home', pre: ouvrirDuJour\('surveillance', 'sauvegarde', 'resume_matin', 'application'\), tous: true, q: \[carteDuJour\('surveillance'\), carteDuJour\('sauvegarde'\), carteDuJour\('resume_matin'\), carteDuJour\('application'\), '#homeGrid \.hgrid2', /);
  // « Ce qu'Odin a fait » retiré de la fenêtre : « État détaillé », qui garde le panneau du même nom.
  assert.match(c, /q: \[carteDuJour\('odin_a_fait'\), '#todayBox \.today-cols > \.hpanel:last-child', '#homeGrid \.hmore:has\(\.hcols\)'\]/);
  assert.match(UI, /const carteDuJour = \(k\) => `#feGrid > \.fe-w\[data-auj="\$\{k\}"\]`;/, 'la carte du widget, comme fenetre.js la nomme');
  assert.match(UI, /const ouvrirDuJour = \(\.\.\.ks\) => async \(\) => \{ const f = window\.OdinFenetre\?\.aujourdhui\?\.\(\); for \(const k of ks\) if \(await f\?\.montrer\(k\)\) return; \};/, 'et la page qui la porte s\'ouvre (rien chez un membre)');
  // Une cible que le navigateur ne sait pas lire ne fait pas tomber la visite : l'étape se montre sans anneau.
  assert.match(fonction(UI, 'tourGo'), /map\(\(q\) => \{ try \{ return document\.querySelector\(q\); \} catch \{ return null; \} \}\)/);
});

test('chez le propriétaire : la place des blocs du jour est cachée, et le titre de « État détaillé » ne dit que ce qui y reste', () => {
  const t = fonction(UI, 'renderToday');
  assert.match(t, /box\.hidden = Boolean\(fen\);/, 'quand la fenêtre tient les blocs, leur ancienne place est cachée ; sinon elle se voit');
  const h = fonction(UI, 'renderHome');
  assert.match(h, /el\('summary', \{\}, tenus \? 'État détaillé : missions' : 'État détaillé : missions, surveillance, sauvegarde, coûts'\)/, 'le titre suit ce qu\'il contient');
  assert.doesNotMatch(h, /const todoBox = /, '« À faire maintenant », jamais posé, n\'est plus dessiné');
  // La fenêtre arrive après le dernier dessin de l'accueil : le titre suit, sans attendre un nouvel état d'Odin.
  assert.match(UI, /document\.addEventListener\('odin:fenetre', \(\) => \{ const s = \$\('#homeGrid \.hmore > summary'\); if \(s && window\.OdinFenetre\?\.aujourdhui\?\.\(\)\) s\.textContent = 'État détaillé : missions'; \}\);/);
});

test('le bandeau du coffre verrouillé reste au-dessus de la grille (de l\'ancienne colonne pour un membre) ; celui des mises à jour au-dessus de l\'accueil', () => {
  assert.doesNotMatch(fonction(FE, 'mount'), /vaultBanner/, 'la fenêtre ne le déplace pas pour tout le monde');
  assert.match(fonction(UI, 'renderToday'), /const coffre = \$\('#vaultBanner'\), dessous = fen \? \$\('#fenetre'\) : box; if \(coffre && dessous && coffre\.nextElementSibling !== dessous\) dessous\.before\(coffre\);/, 'juste au-dessus des blocs, et seulement s\'il n\'y est pas déjà (un mot de passe en cours de frappe garde le focus)');
  assert.ok(UI.indexOf('id="updBanner"') < UI.indexOf('id="v-home"'), 'les mises à jour : au-dessus de la vue');
});

test('le guide de la page d\'accueil nomme les blocs comme l\'écran : « À faire », « Ce qu\'Odin a fait »', () => {
  const home = GUIDE.slice(GUIDE.indexOf('home: ['), GUIDE.indexOf('chat: ['));
  assert.doesNotMatch(home, /À faire maintenant|Ce que j\\'ai fait/);
  assert.match(home, /« À faire »/); assert.match(home, /« Ce qu\\'Odin a fait »/);
  assert.doesNotMatch(home, /réseau, machines, tâches/, 'ce ne sont pas les tuiles de l\'accueil');
  assert.match(home, /la surveillance[^']*la sauvegarde[^']*le résumé du matin[^']*l\\'application/, 'les quatre tuiles, nommées comme à l\'écran');
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
const MDP = 'un-baobab-sur-la-colline-27';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const oublier = () => valhallaOf()!.ctx('gladsheim').saveSettings({ fenetre: undefined });

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-f', nom: 'Membre F', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-f' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-f', MDP); assert.ok(membre, 'le membre a une session');
});
after(async () => { await tt.end(); Object.assign(console, orig); });

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any;
interface Route { request(): { postData(): string | null }; abort(): Promise<void>; continue(): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  keyboard: { press(k: string): Promise<void> }; on(e: string, f: (x: any) => void): void;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; route(u: string, f: (r: Route) => unknown): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });

/**
 * Ouvre l'accueil. `nonLue` : la lecture de la fenêtre échoue (comme une fenêtre en panne, ou pas encore lue). Pour
 * que l'anneau de la visite se mesure là où il est posé, le défilement est immédiat (essai seulement) et les
 * mouvements réduits.
 */
async function ouvrir(largeur: number, o: { cookie?: string; nonLue?: boolean; doux?: boolean; lente?: number } = {}) {
  const doigt = largeur < 500;
  // `doux` : le défilement doux de la visite, tel quel (comme chez lui) ; l'anneau doit attendre qu'il soit fini.
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', reducedMotion: o.doux ? 'no-preference' : 'reduce' });
  const [n, ...x] = (o.cookie ?? v.session).split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.removeItem('odin.fenetre.page'); } catch { /* rien */ }
    ${o.doux ? '' : 'const siv = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (a) { return siv.call(this, a && typeof a === \'object\' ? { ...a, behavior: \'auto\' } : a); };'}`);
  const estLecture = (r: Route) => { const b = r.request().postData() ?? ''; return /"module":"gladsheim"/.test(b) && /"action":"fenetre"/.test(b); };
  if (o.nonLue) await ctx.route('**/api/valhalla/act', (r) => (estLecture(r) ? r.abort() : r.continue()));
  // `lente` : la lecture de la fenêtre arrive après le premier dessin de l'accueil.
  if (o.lente) await ctx.route('**/api/valhalla/act', async (r) => { if (estLecture(r)) await new Promise((z) => setTimeout(z, o.lente)); return r.continue(); });
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(v.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  if (o.nonLue) await page.waitForFunction(() => /Fenêtre indisponible/.test(document.querySelector('#fenetre')?.textContent ?? ''), undefined, { timeout: 45000 });
  else await page.waitForSelector('#feGrid .fe-w', { timeout: 45000 });
  await page.waitForSelector('#homeGrid .hmore', { state: 'attached', timeout: 30000 });
  return { ctx, page, erreurs };
}
const CARTE = (k: string) => `#feGrid > .fe-w[data-auj="${k}"]`;
const KS = ['chiffres_cles', 'tu_veux', 'a_faire', 'odin_a_fait', 'comportement', 'surveillance', 'sauvegarde', 'resume_matin', 'application'];
const TUILES = ['surveillance', 'sauvegarde', 'resume_matin', 'application'];
/** Ce que la page montre : l'ancienne colonne, les widgets, l'ordre du haut de l'accueil. */
const vu = (p: Page): Promise<any> => p.evaluate((ks: string[]) => {
  const q = (s: string) => document.querySelector(s), txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const avant = (a: string, b: string) => Boolean(q(a) && q(b) && (q(a).compareDocumentPosition(q(b)) & 4));
  const box = q('#todayBox'), grille = q('#homeGrid');
  return {
    box: { cache: box.hidden || getComputedStyle(box).display === 'none', vide: box.childElementCount === 0, aFaire: Boolean(box.querySelector('#homeAFaire')), reglages: Boolean(box.querySelector('.ctrls')), fil: Boolean(box.querySelector('.ffilter')) },
    titre: txt(grille.querySelector('.hmore > summary')), replie: !grille.querySelector('.hmore').open,
    dessous: { chiffres: grille.querySelectorAll('.kpis').length, tuiles: grille.querySelectorAll('.hgrid2 .hcard').length, toutVoir: [...grille.querySelectorAll('.hcols .hpanel button')].some((b: any) => txt(b) === 'Tout voir') },
    // Ce qui prouve que le bloc est dans son widget (chacun son morceau, posé par la page d'accueil).
    widgets: Object.fromEntries(ks.map((k) => { const h = q(`#feGrid .fe-auj[data-auj="${k}"]`); return [k, h ? Boolean(h.querySelector({ chiffres_cles: '.kpis .kpi', tu_veux: '*',a_faire: '.tlist, .hok', odin_a_fait: '.ffilter', comportement: '.ctrls', surveillance: '.hcard', sauvegarde: '.hcard', resume_matin: '.hcard', application: '#appCard' }[k])) : null]; })),
    coffreAvantGrille: avant('#vaultBanner', '#fenetre'), coffreAvantColonne: avant('#vaultBanner', '#todayBox'), majAvantAccueil: avant('#updBanner', '#v-home'),
  };
}, KS);

/** Les étapes de la visite qui montrent l'accueil : le début de leur texte, et ce qu'elles doivent entourer. */
const ETAPES = [
  { quoi: 'les cinq chiffres', texte: /^L'Accueil en un coup d'œil/, proprio: [CARTE('chiffres_cles')], ancien: ['#homeGrid .kpis', '#homeGrid .hmore'] },
  { quoi: '« À faire »', texte: /^« À faire/, proprio: [CARTE('a_faire')], ancien: ['#homeAFaire'] },
  { quoi: '« Ce qu\'Odin a fait »', texte: /^« Ce (que j'ai|qu'Odin a) fait »/, proprio: [CARTE('odin_a_fait')], ancien: ['#todayBox .today-cols > .hpanel:last-child'] },
  { quoi: 'les quatre tuiles', texte: /^En bas :/, proprio: [TUILES.map(CARTE).join('|')], ancien: ['#homeGrid .hgrid2', '#homeGrid .hmore'] },
];
const ETAPES_FIN = [
  { quoi: 'l\'application', texte: /^Installe-moi/, proprio: [CARTE('application'), '#appCard'], ancien: ['#appCard', '#homeGrid .hmore'] },
  { quoi: 'les mises à jour', texte: /^Je me mets à jour/, proprio: ['#appVer', CARTE('chiffres_cles')], ancien: ['#appVer', '#homeGrid .kpis', '#homeGrid .hmore'] },
];
/**
 * L'anneau de la visite entoure-t-il l'un de ces morceaux (à 6 px près, coupé par l'écran comme la visite le coupe) ?
 * « a|b|c » : l'ensemble de ceux qui sont là. Au téléphone, l'anneau ne descend jamais sur la barre du bas : ce qui est
 * dessous ne se voit pas.
 */
const anneau = (p: Page, cibles: string[]): Promise<any> => p.evaluate((sels: string[]) => {
  const r = document.querySelector('.tour-ring'); if (!r) return { rien: 'pas de visite' };
  if (r.classList.contains('none')) return { rien: 'aucun anneau : la cible ne se voit pas' };
  const a = { l: parseFloat(r.style.left), t: parseFloat(r.style.top), w: parseFloat(r.style.width), h: parseFloat(r.style.height) };
  const barre = document.querySelector('.bnav'), bb = barre && barre.getClientRects().length ? barre.getBoundingClientRect() : null;
  if (bb && a.t + a.h - 6 > bb.top + 2) return { rien: `l'anneau descend sur la barre du bas (${JSON.stringify(a)}, barre à ${bb.top})` };
  const bas = bb ? Math.min(bb.top, window.innerHeight) : window.innerHeight;
  for (const s of sels) {
    const ns = s.split('|').map((x) => document.querySelector(x)).filter((n) => n && n.getClientRects().length); if (!ns.length) continue;
    const bs = ns.map((n) => n.getBoundingClientRect());
    const L = Math.max(Math.min(...bs.map((b) => b.left)), 0), T = Math.max(Math.min(...bs.map((b) => b.top)), 0), R = Math.min(Math.max(...bs.map((b) => b.right)), window.innerWidth), B = Math.min(Math.max(...bs.map((b) => b.bottom)), bas);
    if (Math.abs(a.l - (L - 6)) <= 3 && Math.abs(a.t - (T - 6)) <= 3 && Math.abs(a.w - (R - L + 12)) <= 4 && Math.abs(a.h - (B - T + 12)) <= 4) return { ok: s };
  }
  return { rien: `l'anneau entoure autre chose (${JSON.stringify(a)})` };
}, cibles);
/** Lance la visite sans la voix, va au chapitre demandé, et rend ce que chaque étape entoure. */
async function suivreVisite(p: Page, chapitre: string, etapes: typeof ETAPES, quiVoit: 'proprio' | 'ancien') {
  await p.evaluate(async (ch: string) => { await window.OdinTour.start(false, false); await window.OdinTour.resume(ch); }, chapitre);
  // La première étape du chapitre est posée (sinon une flèche trop tôt sauterait une étape).
  await p.waitForFunction((ch: string) => (document.querySelector('.tour-box .tourh b')?.textContent ?? '').toLowerCase().includes(ch) && (document.querySelector('.tour-box .tourt')?.textContent ?? '') !== '', chapitre, { timeout: 15000 });
  const dits: string[] = [];
  for (const e of etapes) {
    // Avance jusqu'à l'étape (une étape à la fois, comme la flèche du clavier).
    for (let i = 0; i < 4; i++) {
      const t = await p.evaluate(() => (document.querySelector('.tour-box .tourt')?.textContent ?? ''));
      if (e.texte.test(t)) break;
      await p.keyboard.press('ArrowRight');
      await p.waitForFunction((avant: string) => { const x = document.querySelector('.tour-box .tourt')?.textContent ?? ''; return x && x !== avant; }, t, { timeout: 15000 });
    }
    await p.waitForFunction((src: string) => new RegExp(src).test(document.querySelector('.tour-box .tourt')?.textContent ?? ''), e.texte.source, { timeout: 15000 });
    const a = await anneau(p, e[quiVoit]);
    dits.push(`${e.quoi} : ${a.ok ? 'entouré' : a.rien}`);
  }
  await p.evaluate(() => window.OdinTour.end(false));
  return dits;
}
const entoures = (etapes: typeof ETAPES) => etapes.map((e) => `${e.quoi} : entouré`);

for (const largeur of [1280, 390]) {
  test(`navigateur, ${largeur} px, le propriétaire : plus d'ancienne colonne, chaque bloc dans son widget, les bandeaux au-dessus`, { skip: sansNav }, async () => {
    oublier();
    const { ctx, page, erreurs } = await ouvrir(largeur);
    try {
      await page.waitForFunction(() => document.querySelector('#feGrid .fe-auj[data-auj="surveillance"] > .hcard') && document.querySelector('#feGrid .fe-auj[data-auj="chiffres_cles"] .kpi'), undefined, { timeout: 30000 });
      const a = await vu(page);
      assert.deepEqual([a.box.cache, a.box.vide], [true, true], 'la place des blocs du jour : vide et cachée');
      assert.deepEqual(a.widgets, Object.fromEntries(KS.map((k) => [k, true])), 'chaque bloc dans son widget');
      assert.equal(a.titre, 'État détaillé : missions', 'le titre ne dit que ce qui reste dessous');
      assert.deepEqual(a.dessous, { chiffres: 0, tuiles: 0, toutVoir: true }, 'dessous : ni chiffres ni tuiles, mais « Ce qu\'Odin a fait » et « Tout voir » (sans widget), rien n\'a disparu');
      assert.equal(a.replie, true, 'replié, comme avant');
      assert.deepEqual([a.coffreAvantGrille, a.coffreAvantColonne, a.majAvantAccueil], [true, true, true], 'le coffre verrouillé au-dessus de la grille, les mises à jour au-dessus de l\'accueil');
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });

  test(`navigateur, ${largeur} px, le propriétaire : la visite guidée entoure chaque bloc dans son widget`, { skip: sansNav }, async () => {
    oublier();
    const { ctx, page, erreurs } = await ouvrir(largeur);
    try {
      await page.waitForFunction(() => document.querySelector('#feGrid .fe-auj[data-auj="application"] #appCard')?.childElementCount > 0, undefined, { timeout: 30000 });
      assert.deepEqual(await suivreVisite(page, 'accueil', ETAPES, 'proprio'), entoures(ETAPES), 'le chapitre « L\'accueil »');
      assert.deepEqual(await suivreVisite(page, 'quotidien', ETAPES_FIN, 'proprio'), entoures(ETAPES_FIN), 'le chapitre « Au quotidien »');
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur, 1280 px, un membre : l\'accueil d\'avant à l\'ancienne place, et la visite guidée le lui montre', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrir(1280, { cookie: membre });
  try {
    await page.waitForSelector('#homeGrid .hgrid2 #appCard', { state: 'attached', timeout: 30000 });
    const a = await vu(page);
    assert.deepEqual(a.box, { cache: false, vide: false, aFaire: true, reglages: true, fil: true }, 'les blocs du jour à l\'ancienne place, visibles');
    assert.deepEqual(a.widgets, Object.fromEntries(KS.map((k) => [k, null])), 'aucun widget du jour pour lui');
    assert.equal(a.titre, 'État détaillé : missions, surveillance, sauvegarde, coûts', 'le titre d\'avant');
    assert.deepEqual(a.dessous, { chiffres: 1, tuiles: 4, toutVoir: true }, 'les chiffres, les quatre tuiles et « Tout voir » dessous');
    assert.deepEqual([a.coffreAvantGrille, a.coffreAvantColonne], [false, true], 'le coffre à sa place d\'avant : sous sa fenêtre, au-dessus de l\'ancienne colonne');
    assert.deepEqual(await suivreVisite(page, 'accueil', ETAPES, 'ancien'), entoures(ETAPES), 'le chapitre « L\'accueil »');
    assert.deepEqual(await suivreVisite(page, 'quotidien', ETAPES_FIN, 'ancien'), entoures(ETAPES_FIN), 'le chapitre « Au quotidien »');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 390 px, la fenêtre pas lue (en panne) : le propriétaire garde l\'accueil d\'avant, et la visite le lui montre', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrir(390, { nonLue: true });
  try {
    await page.waitForSelector('#todayBox #homeAFaire', { timeout: 30000 });
    const a = await vu(page);
    assert.deepEqual(a.box, { cache: false, vide: false, aFaire: true, reglages: true, fil: true }, 'les blocs du jour à l\'ancienne place, visibles');
    assert.equal(a.titre, 'État détaillé : missions, surveillance, sauvegarde, coûts', 'le titre d\'avant');
    assert.deepEqual(a.dessous, { chiffres: 1, tuiles: 4, toutVoir: true }, 'rien ne disparaît');
    assert.deepEqual([a.coffreAvantGrille, a.coffreAvantColonne], [false, true], 'le coffre à sa place d\'avant : au-dessus de l\'ancienne colonne');
    assert.deepEqual(await suivreVisite(page, 'accueil', ETAPES, 'ancien'), entoures(ETAPES), 'le chapitre « L\'accueil »');
    assert.deepEqual(await suivreVisite(page, 'quotidien', ETAPES_FIN, 'ancien'), entoures(ETAPES_FIN), 'le chapitre « Au quotidien »');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 390 px, un membre, défilement doux : la visite entoure l\'ancienne place une fois le défilement fini, jamais la barre du bas', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrir(390, { cookie: membre, doux: true });
  try {
    await page.waitForSelector('#homeGrid .hgrid2 #appCard', { state: 'attached', timeout: 30000 });
    const a = await vu(page);
    assert.deepEqual([a.coffreAvantGrille, a.coffreAvantColonne], [false, true], 'le coffre à sa place d\'avant : sous sa fenêtre, au-dessus de l\'ancienne colonne');
    assert.deepEqual(await suivreVisite(page, 'accueil', ETAPES, 'ancien'), entoures(ETAPES), 'le chapitre « L\'accueil »');
    assert.deepEqual(await suivreVisite(page, 'quotidien', ETAPES_FIN, 'ancien'), entoures(ETAPES_FIN), 'le chapitre « Au quotidien »');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 1280 px, la fenêtre arrive après le premier dessin de l\'accueil : le titre de « État détaillé » suit', { skip: sansNav }, async () => {
  oublier();
  const { ctx, page, erreurs } = await ouvrir(1280, { lente: 4000 });
  try {
    await page.waitForFunction(() => document.querySelector('#feGrid .fe-auj[data-auj="surveillance"] > .hcard') && document.querySelector('#feGrid .fe-auj[data-auj="chiffres_cles"] .kpi'), undefined, { timeout: 30000 });
    // Rien d'autre ne redessine l'accueil (aucun nouvel état d'Odin) : ce qui est là après une seconde y reste.
    await new Promise((z) => setTimeout(z, 1000));
    const a = await vu(page);
    assert.deepEqual(a.dessous, { chiffres: 0, tuiles: 0, toutVoir: true }, 'ni chiffres ni tuiles dessous');
    assert.equal(a.titre, 'État détaillé : missions', 'le titre ne les annonce plus');
    assert.deepEqual([a.box.cache, a.coffreAvantGrille], [true, true], 'l\'ancienne colonne cachée, le coffre au-dessus de la grille');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); }
});

test('navigateur, 1280 px, le propriétaire a retiré Surveillance et « Ce qu\'Odin a fait » : la visite entoure les trois autres tuiles, puis « État détaillé »', { skip: sansNav }, async () => {
  oublier();
  const lu = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre', input: {} });
  assert.equal(lu.body.ok, true, JSON.stringify(lu.body));
  const f = JSON.parse(JSON.stringify(lu.body.data)) as { pages: Array<{ widgets: Array<{ kind: string }> }> };
  f.pages = f.pages.map((p) => ({ ...p, widgets: p.widgets.filter((w) => w.kind !== 'surveillance' && w.kind !== 'odin_a_fait') }));
  const r = await valhallaOf()!.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) }); assert.equal(r.ok, true, r.text);
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await page.waitForFunction(() => document.querySelector('#feGrid .fe-auj[data-auj="application"] #appCard')?.childElementCount > 0, undefined, { timeout: 30000 });
    const sans = [
      { ...ETAPES[2], proprio: ['#homeGrid .hmore'] },
      { ...ETAPES[3], proprio: [TUILES.filter((k) => k !== 'surveillance').map(CARTE).join('|')] },
    ];
    assert.deepEqual(await suivreVisite(page, 'accueil', sans, 'proprio'), entoures(sans), 'le chapitre « L\'accueil »');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); oublier(); }
});
