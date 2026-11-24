// La page « Aujourd'hui » et l'écran de la maison (décision du propriétaire, 24/11 : « Oui, pour un widget ordinaire »).
// - un widget ordinaire posé sur la page « Aujourd'hui » va sur l'écran de la maison comme sur une autre page : la page
//   se marque « Écran de la maison », ou le widget se copie par « Copier vers l'autre écran » ;
// - « Tu veux sans doute », « À faire » et « Ce qu'Odin a fait » n'y vont jamais : ni à une tablette (« maison » ou
//   « complet »), ni à ta session sur cet écran, ni lancés comme un bouton, même glissés par POST ; jamais à un membre ;
//   la clé d'accès n'ouvre pas l'écran de la maison ;
// - l'écran de la maison ne reçoit ni le code ni le nom de la page « Aujourd'hui » : une page ordinaire (« Page N », ou
//   le nom que le propriétaire lui a donné) ; une tablette « maison » ne reçoit pas non plus son identifiant.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { cleanLayout, sansAccueilDuProprietaire, type FPage, type Layout } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { PAGE_AUJOURDHUI } from '../src/valhalla/widgets/aujourdhui.ts';
import { copiable, servieALaMaison } from '../src/valhalla/widgets/index.ts';
import { boutonMaison, pagesMaisonPermises } from '../src/web/widgets-api.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const TROIS = ['tu_veux', 'a_faire', 'odin_a_fait'] as const;
const IDS = ['gladsheim', 'midgard', 'vordr', 'var'];
/** Rien des widgets du jour (ni de « Comment Odin se comporte », lot 27), ni le code de la page, ni son nom. */
const DU_JOUR = /a_faire|odin_a_fait|tu_veux|comportement|0a0f000[1-4]|aujourdhui|Aujourd'hui/;
const HEURE = 'c4000001', METEO = 'c4000002', COPIE = 'c4000003';
/** La page « Aujourd'hui » : ses widgets de départ (quatre depuis le lot 27), plus une heure et une météo posées par le propriétaire. */
const jour = (o: Record<string, unknown> = {}) => ({ id: PAGE_AUJOURDHUI.id, name: '', code: 'aujourdhui',
  widgets: [...PAGE_AUJOURDHUI.widgets.map((w) => ({ ...w })), { id: HEURE, kind: 'heure', w: 1 }, { id: METEO, kind: 'meteo', w: 2 }], ...o });
const reseau = { id: 'b4000002', name: 'Réseau', widgets: [{ id: 'c4000009', kind: 'heure', w: 1 }] };

// ------------------------------------------------------------------ le modèle (pur)

test('modèle : la page « Aujourd\'hui » garde « Écran de la maison » quand le propriétaire l\'a marquée ; les trois sortes restent réservées', () => {
  const l = cleanLayout({ pages: [jour({ maison: true }), reseau] }, IDS);
  assert.deepEqual(l.pages.map((p) => [p.code, p.maison]), [['aujourdhui', true], [undefined, undefined]]);
  assert.equal(cleanLayout({ pages: [jour(), reseau] }, IDS).pages[0].maison, undefined, 'pas marquée : pas servie');
  assert.equal(cleanLayout({ pages: [jour({ maison: 'oui' })] }, IDS).pages[0].maison, true, 'comme une page ordinaire : toute valeur vraie');
  assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(l)), IDS), l, 'relue, elle ne change pas');
  for (const k of TROIS) { assert.equal(servieALaMaison(k), false, `${k} jamais à /maison`); assert.equal(copiable(k), false, `${k} ne se copie pas`); }
  for (const k of ['heure', 'meteo']) { assert.equal(servieALaMaison(k), true); assert.equal(copiable(k), true); }
  // Un membre : la règle d'avant, inchangée (les trois widgets retirés).
  assert.deepEqual(sansAccueilDuProprietaire(l).pages[0].widgets.map((w) => w.id), [HEURE, METEO]);
});

test('la page : « Écran de la maison » est offert pour la page « Aujourd\'hui », et « Copier » compte ses pages comme avant', () => {
  const FE = readFileSync(new URL('../src/web/fenetre.js', import.meta.url), 'utf8');
  assert.doesNotMatch(FE, /page\(\)\.code \? null/, 'plus de refus du bouton pour la page sous un code');
  assert.match(FE, /maisonJour: '[^\n]*« Tu veux sans doute », « À faire », « Ce qu\\'Odin a fait » et « Comment Odin se comporte » n\\'y vont jamais\.'/, 'le bouton dit ce qui n\'y va jamais');
  assert.match(FE, /const refus = R\.copieRefusee\(\{ kind: w\.kind,/, '« Copier » passe toujours par le refus des sortes réservées');
});

// ------------------------------------------------------------------ le vrai Odin

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
const cles: Record<string, string> = {};
const MDP = 'un-manguier-au-bord-du-chemin-64';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const g = () => valhallaOf()!.ctx('gladsheim');
/** Ranger par la route, avec la session du propriétaire (un POST, comme la page). */
const ranger = (f: unknown) => v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify(f) } });
const oublier = () => g().saveSettings({ fenetre: undefined });
/** Qui regarde l'écran de la maison : la tablette « maison », la tablette « complet », ta session. */
const QUI = ['maison', 'complet', 'session'] as const;
const entetes = (qui: string): Record<string, string> => (qui === 'session' ? {} : { cookie: '', 'x-odin-maison': cles[qui] });
const etat = async (qui: string) => { const e = await v.json('/api/maison/etat', undefined, entetes(qui)); assert.equal(e.status, 200, qui); return e.body; };
const servis = (b: Record<string, unknown>) => ((b.fenetre as Array<{ id: string; name: string; widgets: Array<{ id: string; kind: string }> }>) ?? []);

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-m', nom: 'Membre M', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-m' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-m', MDP); assert.ok(membre, 'le membre a une session');
  for (const droits of ['maison', 'complet']) cles[droits] = ((await va.act('gladsheim', 'cle_tablette', { nom: `Tablette ${droits}`, droits })).data as { key: string }).key;
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('la page « Aujourd\'hui » marquée « Écran de la maison » : son widget ordinaire arrive sur /api/maison/etat d\'une tablette, les trois widgets du jour jamais', async () => {
  oublier();
  const r = await ranger({ pages: [jour({ maison: true }), reseau] }); assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const gardee = (g().settings.fenetre as Layout).pages[0];
  assert.equal(gardee.code, 'aujourdhui'); assert.equal(gardee.maison, true, 'la marque est gardée');
  assert.deepEqual(gardee.widgets.map((w) => w.kind), [...TROIS, 'comportement', 'heure', 'meteo'], 'la fenêtre garde tout, dans l\'ordre');
  for (const qui of QUI) {
    const b = await etat(qui), pages = servis(b);
    assert.equal(pages.length, 1, `${qui} : une seule page (la page « Réseau » n'est pas marquée)`);
    assert.deepEqual(pages[0].widgets.map((w) => [w.id, w.kind]), [[HEURE, 'heure'], [METEO, 'meteo']], `${qui} : l'heure et la météo, rien d'autre`);
    assert.doesNotMatch(JSON.stringify(b), DU_JOUR, `${qui} : rien des trois widgets, ni le code, ni le nom de la page`);
    assert.equal(pages[0].name, 'Page 1', `${qui} : une page ordinaire`);
    assert.deepEqual(Object.keys(pages[0]).sort(), ['id', 'name', 'widgets'], `${qui} : pas de code dans la page`);
    // Aucun des trois ne se lance comme un bouton.
    for (const w of PAGE_AUJOURDHUI.widgets) assert.equal((await v.json('/api/maison/fenetre', { id: w.id }, { ...entetes(qui), 'x-odin': '1' })).status, 404, `${qui} : ${w.kind} n'est pas un bouton`);
  }
  // Une tablette « maison » ne reçoit pas l'identifiant de la page ; ta session le garde (il sert à y déplacer un module).
  assert.doesNotMatch(JSON.stringify(await etat('maison')), /0a0f000/);
  assert.equal(servis(await etat('session'))[0].id, PAGE_AUJOURDHUI.id);
  // La clé d'une tablette n'ouvre toujours ni la route des widgets ni la fenêtre.
  for (const droits of ['maison', 'complet']) {
    assert.equal((await v.json('/api/widgets/donnees', undefined, entetes(droits))).status, 401, droits);
    assert.notEqual((await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre', input: {} }, entetes(droits))).body.ok, true, droits);
  }
});

test('la clé d\'accès n\'ouvre pas l\'écran de la maison ; un membre ne reçoit aucun des trois widgets, par aucune route', async () => {
  oublier();
  assert.equal((await ranger({ pages: [jour({ maison: true }), reseau] })).body.ok, true);
  const cle = { authorization: `Bearer ${v.token}` };
  const e = await v.json('/api/maison/etat', undefined, cle);
  assert.notEqual(e.status, 200, 'la clé d\'accès : refus'); assert.equal(e.body.fenetre, undefined);
  for (const w of PAGE_AUJOURDHUI.widgets) assert.notEqual((await v.json('/api/maison/fenetre', { id: w.id }, { ...cle, 'x-odin': '1' })).status, 200);
  assert.equal((await v.json('/api/widgets/donnees', undefined, cle)).status, 401, 'ni la route des widgets');
  // Un membre : la fenêtre sans les trois, la route des widgets sans les trois, l'écran de la maison fermé à sa session.
  const trois = /a_faire|odin_a_fait|tu_veux|comportement|0a0f000[1-4]/;
  const lui = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre', input: {} }, { cookie: membre });
  assert.equal(lui.body.ok, true); assert.doesNotMatch(JSON.stringify(lui.body), trois);
  const w = await v.json('/api/widgets/donnees', undefined, { cookie: membre });
  assert.equal(w.status, 200); assert.doesNotMatch(JSON.stringify(w.body), trois);
  assert.ok((w.body.widgets as Array<{ id: string }>).some((x) => x.id === HEURE), 'il reçoit bien le widget ordinaire');
  for (const x of PAGE_AUJOURDHUI.widgets) assert.doesNotMatch(JSON.stringify((await v.json(`/api/widgets/donnees?page=${x.id}`, undefined, { cookie: membre })).body), trois);
  const m = await v.json('/api/maison/etat', undefined, { cookie: membre });
  assert.doesNotMatch(JSON.stringify(m.body), trois, 'rien par l\'écran de la maison non plus');
  assert.notEqual((await ranger({ pages: [reseau] })).body.ok, true, '« À faire » ne se retire toujours pas');
});

test('« Copier vers l\'autre écran » : la copie d\'un widget ordinaire de la page « Aujourd\'hui » est servie ; une copie des trois, glissée par POST, jamais', async () => {
  oublier();
  // Ce que la page range après « Copier » : la copie de l'heure sur une page « Écran de la maison » neuve, avec un
  // nouvel identifiant. Et, glissées à la main dans le même POST, des copies des trois widgets du jour.
  const copies = TROIS.map((kind, i) => ({ id: `c400001${i}`, kind, w: 1, module: 'midgard', action: 'scene', input: { scene: 'x' }, section: 'Appareils', toucher: { quoi: 'action', action: 'scene' } }));
  const r = await ranger({ pages: [jour(), { id: 'b4000003', name: 'Maison', maison: true, widgets: [{ id: COPIE, kind: 'heure', w: 1 }, ...copies] }] });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const f = g().settings.fenetre as Layout;
  assert.equal(f.pages[0].maison, undefined, 'la page « Aujourd\'hui » n\'est pas marquée');
  for (const k of TROIS) assert.equal(f.pages.flatMap((p) => p.widgets).filter((w) => w.kind === k).length, 1, `${k} : un seul dans la fenêtre, la copie est jetée`);
  assert.deepEqual(f.pages[1].widgets.map((w) => w.id), [COPIE], 'la page « Maison » ne garde que la copie de l\'heure');
  for (const qui of QUI) {
    const b = await etat(qui), pages = servis(b);
    assert.deepEqual(pages.map((p) => [p.name, p.widgets.map((w) => w.id)]), [['Maison', [COPIE]]], `${qui} : la copie, sur sa page`);
    assert.doesNotMatch(JSON.stringify(b), /a_faire|odin_a_fait|tu_veux|0a0f000|c400001|aujourdhui|Aujourd'hui/, `${qui} : rien du jour`);
    for (const c of copies) assert.equal((await v.json('/api/maison/fenetre', { id: c.id }, { ...entetes(qui), 'x-odin': '1' })).status, 404, qui);
  }
  // Les trois eux-mêmes, déplacés par POST sur la page « Écran de la maison » (avec des champs de bouton) : gardés par
  // la fenêtre (« À faire » ne se retire pas), servis à personne ; l'heure restée sur la page « Aujourd'hui » marquée, oui.
  const deplaces = PAGE_AUJOURDHUI.widgets.map((w) => ({ ...w, module: 'midgard', action: 'scene', input: { scene: 'x' } }));
  assert.equal((await ranger({ pages: [{ id: PAGE_AUJOURDHUI.id, name: 'Ma journée', code: 'aujourdhui', maison: true, widgets: [{ id: HEURE, kind: 'heure', w: 1 }] }, { id: 'b4000003', name: 'Maison', maison: true, widgets: [...deplaces, { id: COPIE, kind: 'heure', w: 1 }] }] })).body.ok, true);
  for (const qui of QUI) {
    const b = await etat(qui), pages = servis(b);
    assert.deepEqual(pages.map((p) => [p.name, p.widgets.map((w) => w.id)]), [['Ma journée', [HEURE]], ['Maison', [COPIE]]], `${qui} : les deux pages, sans les trois ; le nom donné par le propriétaire`);
    assert.doesNotMatch(JSON.stringify(b), DU_JOUR, qui);
    for (const w of deplaces) assert.equal((await v.json('/api/maison/fenetre', { id: w.id }, { ...entetes(qui), 'x-odin': '1' })).status, 404, qui);
  }
});

test('le filet : pagesMaisonPermises rend la page sous un code comme une page ordinaire ; un bouton n\'y est lancé que s\'il est servi', async () => {
  const va = valhallaOf()!;
  const pages = cleanLayout({ pages: [{ id: 'b4000004', name: 'Maison', maison: true, widgets: [{ id: 'c4000020', kind: 'heure' }] }, jour({ maison: true })] }, IDS).pages as FPage[];
  for (const full of [false, true]) {
    const r = await pagesMaisonPermises(va, pages, full);
    assert.deepEqual(r.map((p) => [p.name, p.code, p.maison, p.widgets.map((w) => w.kind)]), [['Maison', undefined, true, ['heure']], ['Page 2', undefined, true, ['heure', 'meteo']]], `complet=${full}`);
    assert.equal('code' in r[1], false); assert.equal(r[1].id === PAGE_AUJOURDHUI.id, full, 'l\'identifiant : seulement avec tous les droits');
    assert.equal(r[0].id, 'b4000004', 'une page ordinaire garde son identifiant');
    for (const w of PAGE_AUJOURDHUI.widgets) assert.equal(await boutonMaison(va, pages, w.id, full), undefined);
  }
  assert.equal(pages[1].code, 'aujourdhui', 'la fenêtre, elle, n\'est pas changée');
});

// ------------------------------------------------------------------ dans un vrai navigateur (si Playwright est là)

declare const document: any, window: any;
interface Page {
  goto(u: string): Promise<unknown>; click(s: string): Promise<void>; tap(s: string): Promise<void>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | (() => X)): Promise<X>;
  waitForTimeout(ms: number): Promise<void>; on(e: string, f: (x: Error) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
// Captures facultatives (ODIN_CAPTURES=<dossier>) : pour regarder l'écran, jamais exigées par l'essai.
const CAPTURES = process.env.ODIN_CAPTURES;
const capture = async (p: Page, nom: string) => { if (!CAPTURES) return; mkdirSync(CAPTURES, { recursive: true }); await p.screenshot({ path: `${CAPTURES}/${nom}.png`, fullPage: true }); };
async function ouvrir(largeur: number, o: { adresse?: string; session?: boolean; sombre?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', colorScheme: o.sombre ? 'dark' : 'light' });
  if (o.session !== false) { const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]); }
  await ctx.addInitScript('try { localStorage.setItem(\'odin.tour\', \'done\'); localStorage.setItem(\'odin.fenetre.page\', \'0\'); } catch { /* rien */ }');
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(v.url + (o.adresse ?? '/'));
  return { ctx, page, erreurs };
}
const deborde = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

for (const largeur of [1280, 390]) {
  test(`navigateur, ${largeur} px : la page « Aujourd'hui » se marque « Écran de la maison » ; « Copier » y marche pour l'heure, pas pour « À faire » ; la tablette ne voit que l'heure`, { skip: sans }, async () => {
    oublier();
    assert.equal((await ranger({ pages: [jour(), reseau] })).body.ok, true);
    const { ctx, page, erreurs } = await ouvrir(largeur, { sombre: largeur === 390 });
    const toucher = (s: string) => (largeur < 500 ? page.tap(s) : page.click(s));
    const bouton = (texte: string) => page.evaluate(`(() => { const b = [...document.querySelectorAll('dialog.wr-regler button')].find((x) => x.textContent.startsWith(${JSON.stringify(texte)})); b.click(); return [...document.querySelectorAll('dialog.wr-regler [role=status]')].map((x) => x.textContent).join(''); })()`) as Promise<string>;
    try {
      await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
      await page.waitForSelector(`#feGrid .fe-w[data-id="${HEURE}"]`, { timeout: 45000 });
      // « ⋯ » de l'heure, sur la page « Aujourd'hui » : « Copier vers l'écran de la maison » fait une copie sur une page neuve.
      await toucher(`#feGrid .fe-w[data-id="${HEURE}"] .wr-plus`); await page.waitForSelector('dialog.wr-regler[open]', { timeout: 15000 });
      assert.match(await bouton('Copier vers l\'écran de la maison'), /^Copié sur la page « /, 'la copie est faite');
      const apres = await page.evaluate(() => window.OdinFenetre.state().L.pages.map((p: any) => [p.code ?? '', Boolean(p.maison), p.widgets.map((w: any) => w.kind)]));
      assert.deepEqual(apres[2], ['', true, ['heure']], `une page « Écran de la maison » neuve, avec la copie : ${JSON.stringify(apres)}`);
      await bouton('Annuler'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
      // « ⋯ » de « À faire » : « Copier » refusé, rien de plus dans la fenêtre.
      await toucher('#feGrid > .fe-w[data-auj="a_faire"] .wr-plus'); await page.waitForSelector('dialog.wr-regler[open]', { timeout: 15000 });
      assert.match(await bouton('Copier'), /reste sur ton accueil : il ne se copie pas/);
      assert.equal(await page.evaluate(() => window.OdinFenetre.state().L.pages.flatMap((p: any) => p.widgets).filter((w: any) => w.kind === 'a_faire').length), 1);
      await bouton('Annuler'); await page.waitForFunction(() => !document.querySelector('dialog.wr-regler'));
      // Mode Modifier : le bouton « Écran de la maison » de la page « Aujourd'hui », puis « Terminé ».
      await page.evaluate(() => window.OdinFenetre.edit(true)); await page.waitForSelector('#fenetre.fe-edit');
      const b = await page.evaluate(() => { const x = [...document.querySelectorAll('#fenetre .fe-tools .fe-tab')].find((n: any) => /^🏠 Écran de la maison/.test(n.textContent ?? '')) as any; const r = x.getBoundingClientRect(); x.click(); return { titre: x.title, h: r.height }; });
      assert.match(b.titre, /n'y vont jamais/);
      await page.waitForFunction(() => [...document.querySelectorAll('#fenetre .fe-tools .fe-tab')].some((n: any) => /^🏠 Écran de la maison/.test(n.textContent ?? '') && n.getAttribute('aria-pressed') === 'true'));
      assert.equal(await deborde(page), false, 'la page ne déborde pas');
      await capture(page, `accueil-${largeur}-modifier`);
      await page.evaluate(() => { ([...document.querySelectorAll('#fenetre .fe-tools .btn')].find((n: any) => n.textContent === 'Terminé') as any).click(); });
      await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'), undefined, { timeout: 15000 });
      await page.waitForTimeout(600);
      const f = g().settings.fenetre as Layout;
      assert.deepEqual(f.pages.map((p) => [p.code ?? '', Boolean(p.maison), p.widgets.map((w) => w.kind)]), [['aujourdhui', true, [...TROIS, 'comportement', 'heure', 'meteo']], ['', false, ['heure']], ['', true, ['heure']]], 'rangée : la page « Aujourd\'hui » marquée, la copie sur sa page');
      await capture(page, `accueil-${largeur}-range`);
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
    // La tablette « maison » : l'heure et la météo de la page « Aujourd'hui », la copie ; rien du jour à l'écran.
    const t = await ouvrir(largeur, { session: false, adresse: `/maison#cle=${cles.maison}`, sombre: largeur === 390 });
    try {
      await t.page.waitForSelector('[data-fw]', { timeout: 45000 });
      const vu = await t.page.evaluate(() => ({ titres: [...document.querySelectorAll('h2.sec')].map((n: any) => n.textContent), cartes: [...document.querySelectorAll('[data-fw]')].map((n: any) => n.dataset.fw), pages: [...new Set([...document.querySelectorAll('[data-fw]')].map((n: any) => n.dataset.fp))], texte: document.body.innerText }));
      assert.deepEqual(vu.cartes.slice(0, 2), [HEURE, METEO], 'l\'heure et la météo de la page « Aujourd\'hui »'); assert.equal(vu.cartes.length, 3, 'et la copie');
      assert.ok(vu.titres.includes('Page 1'), `une page ordinaire : ${JSON.stringify(vu.titres)}`);
      assert.doesNotMatch(vu.texte, /À faire|Ce qu'Odin a fait|Tu veux sans doute|Aujourd'hui/, 'rien du jour à l\'écran');
      assert.ok(!vu.pages.includes(PAGE_AUJOURDHUI.id), 'pas l\'identifiant de la page');
      assert.equal(await deborde(t.page), false, 'l\'écran de la maison ne déborde pas');
      await capture(t.page, `maison-${largeur}-tablette`);
      assert.deepEqual(t.erreurs, [], 'aucune erreur sur l\'écran de la maison');
    } finally { await t.ctx.close(); }
  });
}
