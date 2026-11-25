// Relecture du lot 26 (« Aujourd'hui » en widgets) : ce que la relecture a cherché à casser, et ce qui est tenu.
// - la page « Aujourd'hui » rendue à une fenêtre qui n'a pas « À faire » : rien n'est perdu de ce qu'elle portait, aucun
//   bloc du jour en double, aucun identifiant en double ;
// - une adresse refusée est dite même sur la neuvième page (huit pages, plus la page sous un code) ;
// - un membre, une tablette (« maison » ou « complet »), une clé de tablette sur la route des widgets : ni ces widgets,
//   ni leur page, ni le code de la page, par aucune route ; un membre ne range pas la fenêtre ;
// - « À faire » ne disparaît jamais pour de bon : rangement sans lui, page supprimée, limite des huit pages, champs
//   glissés (appli, action, « Quand je touche » une action), « Ouvrir à… ».
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { avecAujourdhui, cleanLayout, sansAccueilDuProprietaire, type FPage, type Layout } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { PAGE_AUJOURDHUI } from '../src/valhalla/widgets/aujourdhui.ts';
import { adressesRefusees } from '../src/valhalla/widgets/regler.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const TROIS = ['tu_veux', 'a_faire', 'odin_a_fait'] as const;
const IDS = ['gladsheim', 'midgard', 'vordr', 'var'];
const tous = (l: Layout) => l.pages.flatMap((p) => p.widgets);
const sortes = (l: Layout) => l.pages.map((p) => p.widgets.map((w) => w.kind as string));
const compte = (l: Layout, k: string) => tous(l).filter((w) => w.kind === k).length;
/** L'identifiant fixe d'un widget de départ, par sa sorte (l'ordre de la page a changé : les cinq chiffres en tête, lot 27). */
const idDe = (k: string) => PAGE_AUJOURDHUI.widgets.find((x) => x.kind === k)!.id;
/** Chaque bloc du jour une seule fois, et aucun identifiant de widget ou de page en double. */
function saine(l: Layout, quoi: string) {
  for (const k of TROIS) assert.equal(compte(l, k), 1, `${quoi} : « ${k} » une seule fois`);
  const ids = tous(l).map((w) => w.id); assert.equal(new Set(ids).size, ids.length, `${quoi} : aucun identifiant de widget en double (${ids.join(' ')})`);
  const pages = l.pages.map((p) => p.id); assert.equal(new Set(pages).size, pages.length, `${quoi} : aucun identifiant de page en double`);
  assert.equal(l.pages.filter((p) => p.code === 'aujourdhui').length, 1, `${quoi} : une seule page sous le code`);
}

// ------------------------------------------------------------------ la page rendue : rien de perdu, rien en double

test('relecture : une page « Aujourd\'hui » sans « À faire » garde ce qu\'elle portait ; « À faire » y revient', () => {
  // Une page sous le code, avec un widget ordinaire et « Tu veux sans doute », mais sans « À faire » (une donnée abîmée,
  // ou rangée sur un Odin qui n'avait encore rien rangé).
  const l = cleanLayout({ pages: [
    { id: 'b2000001', name: 'Ma journée', code: 'aujourdhui', widgets: [{ id: 'c2000001', kind: 'heure', w: 1 }, { id: 'c2000002', kind: 'tu_veux', label: 'Mes idées' }] },
    { id: 'b2000002', name: 'Réseau', widgets: [{ id: 'c2000003', kind: 'meteo', w: 2 }] },
  ] }, IDS);
  const r = avecAujourdhui(l);
  assert.ok(tous(r).some((w) => w.id === 'c2000001' && w.kind === 'heure'), 'le widget ordinaire de la page est toujours là');
  assert.equal(tous(r).find((w) => w.kind === 'tu_veux')?.label, 'Mes idées', 'son « Tu veux sans doute », avec son titre');
  assert.equal(r.pages.find((p) => p.code === 'aujourdhui')?.name, 'Ma journée', 'le nom qu\'il a donné à la page');
  assert.equal(compte(r, 'a_faire'), 1, '« À faire » est revenu');
  assert.deepEqual(r.pages.find((p) => p.id === 'b2000002'), l.pages[1], 'l\'autre page n\'a pas bougé');
  assert.equal(compte(r, 'tu_veux'), 1); assert.equal(compte(r, 'a_faire'), 1);
  const ids = tous(r).map((w) => w.id); assert.equal(new Set(ids).size, ids.length);
  assert.equal(r.pages.filter((p) => p.code === 'aujourdhui').length, 1);
  assert.equal(avecAujourdhui(r), r, 'déjà reçue : rien de plus');
  assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(r)), IDS), r, 'relue, elle ne change pas');
});

test('relecture : sans « À faire » mais avec un autre bloc du jour ailleurs : pas de bloc en double, pas d\'identifiant en double', () => {
  // « Ce qu'Odin a fait » sur une page ordinaire, avec l'identifiant fixe de « À faire ».
  const l = cleanLayout({ pages: [{ id: 'b2000003', name: 'Réseau', widgets: [{ id: idDe('a_faire'), kind: 'odin_a_fait' }, { id: idDe('tu_veux'), kind: 'heure' }] }, { id: PAGE_AUJOURDHUI.id, name: 'Autre', widgets: [{ id: 'c2000004', kind: 'meteo' }] }] }, IDS);
  const r = avecAujourdhui(l);
  saine(r, 'fenêtre rendue');
  assert.deepEqual(r.pages.slice(1), l.pages, 'ses pages n\'ont pas bougé');
  assert.equal(r.pages[0].code, 'aujourdhui'); assert.deepEqual(sortes(r)[0], ['chiffres_cles', 'tu_veux', 'a_faire', 'comportement'], 'seulement ce qui manquait (depuis le lot 27, le widget des cinq chiffres en tête et « Comment Odin se comporte » en dernier)');
  assert.deepEqual(cleanLayout(JSON.parse(JSON.stringify(r)), IDS), r, 'relue, elle ne change pas');
});

test('relecture : une adresse refusée est dite même sur la neuvième page (huit pages, plus la page sous un code)', () => {
  const page = (i: number, o: Record<string, unknown> = {}) => ({ name: `P${i}`, widgets: [{ kind: 'heure', ...o }] });
  const f = { pages: [{ code: 'aujourdhui', name: '', widgets: [{ kind: 'a_faire' }] }, ...Array.from({ length: 7 }, (_, i) => page(i)), page(7, { toucher: { quoi: 'adresse', adresse: 'javascript:alert(1)' } })] };
  assert.equal(cleanLayout(f, IDS).pages.length, 9, 'les neuf pages sont gardées');
  assert.deepEqual(adressesRefusees(f), ['javascript:alert(1)'], 'l\'adresse refusée de la neuvième page est dite, pas jetée sans bruit');
});

test('relecture : la page compte ses huit pages comme Hestia, sans la page sous un code', () => {
  const fe = readFileSync(new URL('../src/web/fenetre.js', import.meta.url), 'utf8');
  assert.match(fe, /if \(\(!cible && L\.pages\.filter\(\(p\) => !p\.code\)\.length >= 8\)/, '« Copier » ne compte pas la page sous un code');
  assert.doesNotMatch(fe, /L\.pages\.length >= 8/);
});

test('relecture : la fenêtre servie à un autre ne dit jamais le code de la page, même quand il ne reste qu\'elle', () => {
  const seule = sansAccueilDuProprietaire({ pages: [avecAujourdhui({ pages: [] }).pages[0]] });
  assert.equal(seule.pages.length, 1, 'il reste toujours une page');
  assert.doesNotMatch(JSON.stringify(seule), /aujourdhui|a_faire|tu_veux|odin_a_fait|0a0f000/, 'ni le code, ni les sortes, ni leurs identifiants');
  assert.ok(seule.pages[0].name, 'une page ordinaire a un nom');
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
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
const ranger = (f: unknown) => valhallaOf()!.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) });
const lue = async (h: Record<string, string> = {}) => (await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre', input: {} }, h));
const oublier = () => g().saveSettings({ fenetre: undefined });
const DU_JOUR = /a_faire|odin_a_fait|tu_veux|0a0f000|aujourdhui|Aujourd'hui/;

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-r', nom: 'Membre R', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-r' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-r', MDP); assert.ok(membre, 'le membre a une session');
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('relecture : un membre ne range pas la fenêtre, et ne reçoit rien du jour même quand la fenêtre n\'a que la page « Aujourd\'hui »', async () => {
  oublier();
  const f = (await lue()).body.data as Layout;
  // Il ne peut ni ranger, ni glisser ces widgets dans la fenêtre.
  const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify({ pages: [{ name: 'À moi', widgets: [{ kind: 'a_faire' }, { kind: 'heure' }] }] }) } }, { cookie: membre });
  assert.equal(r.body.ok, false, JSON.stringify(r.body)); assert.equal(g().settings.fenetre, undefined, 'rien n\'est rangé');
  // Le propriétaire ne garde que la page « Aujourd'hui ».
  assert.equal((await ranger({ pages: [f.pages[0]] })).ok, true);
  const lui = await lue({ cookie: membre });
  assert.equal(lui.body.ok, true, JSON.stringify(lui.body)); assert.doesNotMatch(JSON.stringify(lui.body), DU_JOUR, 'ni les sortes, ni la page, ni son code');
  const w = await v.json('/api/widgets/donnees', undefined, { cookie: membre });
  assert.equal(w.status, 200); assert.doesNotMatch(JSON.stringify(w.body), DU_JOUR);
  for (const id of [PAGE_AUJOURDHUI.id, ...PAGE_AUJOURDHUI.widgets.map((x) => x.id)]) assert.doesNotMatch(JSON.stringify((await v.json(`/api/widgets/donnees?page=${id}`, undefined, { cookie: membre })).body), DU_JOUR);
  // « Ouvrir à… » : rien à ouvrir sur un bloc du jour (aucune appli de la vie privée derrière).
  const o = await valhallaOf()!.act('gladsheim', 'ouvrir_widget', { widget: idDe('a_faire'), personne: 'membre-r', ouvert: 'oui' });
  assert.equal(o.ok, false); assert.equal(g().settings.ouvertures, undefined, 'rien n\'est ouvert');
  assert.doesNotMatch(JSON.stringify((await v.json('/api/widgets/donnees', undefined, { cookie: membre })).body), DU_JOUR);
  oublier();
});

test('relecture : une tablette (« maison » ou « complet ») ne reçoit ni ces widgets ni leur page, et ne lance rien par eux', async () => {
  oublier();
  const f = (await lue()).body.data as Layout, maison = f.pages.find((p) => p.maison)!;
  // Tout glissé sur la page « Écran de la maison », avec des champs de bouton et un « Quand je touche » d'action.
  (maison.widgets as unknown[]).push(...f.pages[0].widgets.splice(0).map((w) => ({ ...w, module: 'midgard', action: 'scene', input: { scene: 'x' }, section: 'Appareils', toucher: { quoi: 'action', action: 'scene', input: { scene: 'x' } } })));
  f.pages.shift();
  assert.equal((await ranger(f)).ok, true);
  const gardes = tous(g().settings.fenetre as Layout).filter((w) => (TROIS as readonly string[]).includes(w.kind));
  assert.equal(gardes.length, 3);
  for (const w of gardes) for (const champ of ['module', 'action', 'input', 'section', 'toucher'] as const) assert.equal(w[champ], undefined, `${w.kind} : pas de « ${champ} » glissé`);
  for (const droits of ['maison', 'complet']) {
    const cle = ((await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: `Tablette ${droits}`, droits })).data as { key: string }).key;
    const h = { cookie: '', 'x-odin-maison': cle };
    const e = await v.json('/api/maison/etat', undefined, h); assert.equal(e.status, 200, droits);
    assert.ok(((e.body.fenetre as FPage[]) ?? []).some((p) => p.widgets.length), `${droits} : la page est bien servie`);
    assert.doesNotMatch(JSON.stringify(e.body), /a_faire|odin_a_fait|tu_veux|0a0f000/, `${droits} : rien du jour dans l'état de l'écran de la maison`);
    for (const w of gardes) { const b = await v.json('/api/maison/fenetre', { id: w.id }, { ...h, 'x-odin': '1' }); assert.equal(b.status, 404, `${droits} : ${w.kind} n'est pas un bouton`); }
    // La clé d'une tablette n'ouvre ni la route des widgets ni la fenêtre.
    assert.equal((await v.json('/api/widgets/donnees', undefined, h)).status, 401, droits);
    assert.notEqual((await lue(h)).body.ok, true, `${droits} : pas la fenêtre par les actions`);
  }
  oublier();
});

test('relecture : « À faire » ne disparaît jamais pour de bon', async () => {
  oublier();
  const depart = (await lue()).body.data as Layout;
  // Jamais rangée, puis rangée sans lui (une page ouverte avant la mise à jour) : il est toujours lu, une seule fois.
  assert.equal((await ranger({ pages: [{ id: 'b3000001', name: 'Seule', widgets: [{ id: 'c3000001', kind: 'heure' }] }] })).ok, true);
  saine((await lue()).body.data as Layout, 'rangée sans lui');
  // Rangée sans lui, mais avec une page sous le code qui porte autre chose : rien n'est perdu, il revient.
  oublier();
  assert.equal((await ranger({ pages: [{ id: 'b3000002', name: '', code: 'aujourdhui', widgets: [{ id: 'c3000002', kind: 'meteo' }, { id: 'c3000003', kind: 'odin_a_fait' }] }] })).ok, true);
  const l2 = (await lue()).body.data as Layout; saine(l2, 'page sous le code sans lui');
  assert.ok(tous(l2).some((w) => w.id === 'c3000002'), 'la météo posée sur la page est toujours là');
  // Le premier « Terminé » le garde ; ensuite, aucun rangement ne le retire.
  assert.equal((await ranger(l2)).ok, true);
  assert.equal(compte(g().settings.fenetre as Layout, 'a_faire'), 1, 'gardé chez Hestia');
  const gardee = JSON.stringify(g().settings.fenetre);
  const essais: Array<[string, unknown]> = [
    ['sans lui', { pages: [{ name: 'P', widgets: [{ kind: 'heure' }] }] }],
    ['sa page supprimée', { pages: l2.pages.filter((p) => !p.widgets.some((w) => w.kind === 'a_faire')).concat([{ id: 'b3000009', name: 'P', widgets: [] } as FPage]) }],
    ['au-delà des huit pages', { pages: [...Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, widgets: [{ kind: 'heure' }] })), { name: 'Neuvième', widgets: [{ kind: 'a_faire' }] }] }],
    ['au-delà des widgets d\'une page', { pages: [{ name: 'P', widgets: [...Array.from({ length: 48 }, () => ({ kind: 'heure' })), { kind: 'a_faire' }] }] }],
    ['sous une autre sorte', { pages: [{ name: 'P', widgets: [{ kind: 'A_FAIRE' }, { kind: 'comportement' }] }] }],
    ['sur une page d\'un code inconnu, en trop', { pages: [...Array.from({ length: 40 }, (_, i) => ({ name: `P${i}`, widgets: [] })), { code: 'aujourdhui', widgets: [{ kind: 'a_faire' }] }] }],
  ];
  for (const [quoi, f] of essais) {
    const r = await ranger(f); assert.equal(r.ok, false, `${quoi} : refusé`); assert.match(String(r.text ?? (r as { error?: string }).error), /« À faire » se déplace mais ne se retire pas/, quoi);
    assert.equal(JSON.stringify(g().settings.fenetre), gardee, `${quoi} : rien n'a changé`);
  }
  // Déplacé sur une page ordinaire, la page sous le code supprimée : permis, et il reste lu.
  // (La page d'aujourd'hui renvoie la marque de ce que la fenêtre a reçu, lot 27 : rien d'autre n'arrive à la lecture.)
  // (Marque 3 depuis le widget des cinq chiffres, lot 27, deuxième part.)
  const deplace = { accueil: 3, pages: [{ id: 'b3000004', name: 'Tout', maison: true, widgets: [{ id: 'c3000004', kind: 'a_faire', toucher: { quoi: 'action', action: 'theme' } }] }] };
  assert.equal((await ranger(deplace)).ok, true);
  const l3 = (await lue()).body.data as Layout;
  assert.deepEqual(sortes(l3), [['a_faire']]); assert.equal(l3.pages[0].code, undefined, 'la page « Aujourd\'hui » ne revient pas');
  assert.equal(tous(l3)[0].toucher, undefined, 'pas d\'action au toucher sur « À faire »');
  // Huit pages à lui, plus la page sous le code : tout est gardé, dans l'ordre.
  const neuf = { pages: [...Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, widgets: [{ kind: 'heure' }] })), depart.pages[0]] };
  assert.equal((await ranger(neuf)).ok, true);
  assert.deepEqual(((await lue()).body.data as Layout).pages.map((p) => p.code ?? p.name), ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'aujourdhui']);
  oublier();
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; focus(s: string): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | (() => X)): Promise<X>;
  keyboard: { press(k: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>; on(e: string, f: (x: Error) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
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
async function ouvrirPage(largeur: number, o: { onglet?: number; sombre?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', colorScheme: o.sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); ${o.onglet === undefined ? '' : `localStorage.setItem('odin.fenetre.page', '${o.onglet}');`} } catch { /* rien */ }`);
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(v.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await page.waitForSelector('#feGrid .fe-w', { timeout: 45000 });
  return { ctx, page, erreurs };
}
type Web = { pairing: { request(ua: string, ip: string): { id: string } | undefined; pending(): Array<{ id: string }>; decide(id: string, ok: boolean): unknown }; notify(t: string): void };
const demandeVue = (p: Page) => p.waitForFunction(() => /demande l'accès/.test(document.querySelector('#feGrid .fe-auj[data-auj="a_faire"]')?.textContent ?? ''), undefined, { timeout: 30000 });

test('relecture, navigateur : un titre, un nom de page et un nom d\'appareil piégés restent du texte ; après la cloche, Tab entre dans « À faire » ; cibles de 44 px', { skip: sans }, async () => {
  oublier();
  const web = v.web as unknown as Web;
  const PIEGE = '<img src=x onerror="window.__pris=1">';
  const f = (await lue()).body.data as Layout;
  f.pages[0].name = '<b id=pris2>x</b>'; for (const w of f.pages[0].widgets) w.label = PIEGE;
  assert.equal((await ranger(f)).ok, true);
  assert.ok(web.pairing.request(`Mozilla/5.0 (Linux; Android 14; ${PIEGE}) Chrome/120`, '192.0.2.46')); web.notify('state');
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    await demandeVue(page);
    const a = await page.evaluate(() => ({
      pris: (window as any).__pris ?? null, poses: document.querySelectorAll('#fenetre img[onerror], #fenetre #pris2, #fenetre [onerror]').length,
      onglet: document.querySelector('#fenetre .fe-tab')?.textContent ?? '',
      titres: [...document.querySelectorAll('#feGrid > .fe-w[data-auj] .wr-n')].map((n: any) => n.textContent),
      noms: [...document.querySelectorAll('#feGrid > .fe-w[data-auj]')].map((n: any) => n.getAttribute('aria-label')),
    }));
    assert.equal(a.pris, null, 'rien ne s\'est lancé'); assert.equal(a.poses, 0, 'aucune balise posée');
    assert.equal(a.onglet, '<b id=pris2>x</b>', 'le nom de la page est du texte');
    assert.deepEqual(a.titres, [PIEGE, PIEGE, PIEGE, PIEGE, PIEGE], 'les titres sont du texte (cinq widgets depuis le widget des cinq chiffres, lot 27)'); assert.deepEqual(a.noms, a.titres);
    // Cibles de 44 px à l'ordinateur aussi, dans les widgets du jour.
    const petites = await page.evaluate(() => [...document.querySelectorAll('#feGrid .fe-w[data-auj] .fe-auj button, #feGrid .fe-w[data-auj] .fe-auj a, #feGrid .fe-w[data-auj] .wr-plus')].map((n: any) => ({ t: (n.textContent ?? '').trim().slice(0, 24) || n.getAttribute('aria-label'), r: n.getBoundingClientRect() })).filter((x: any) => x.r.width > 0 && (x.r.height < 44 || x.r.width < 44)).map((x: any) => `${x.t} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`));
    assert.deepEqual(petites, [], 'chaque commande fait au moins 44 px');
    // Depuis une autre page, la cloche au clavier ; puis Tab : le focus entre dans « À faire » (il ne repart pas en haut de page).
    await page.evaluate(() => { (document.querySelectorAll('#fenetre .fe-tab')[1]).click(); });
    await page.waitForFunction(() => !document.querySelector('#feGrid .fe-w[data-auj]'));
    await page.focus('#homeBell'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-auj') === 'a_faire', undefined, { timeout: 15000 });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#feGrid > .fe-w[data-auj="a_faire"]')) && !document.activeElement?.classList.contains('fe-w')), true, 'Tab : une commande de « À faire »');
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => (window as any).__pris ?? null), null); assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); for (const x of web.pairing.pending()) web.pairing.decide(x.id, false); oublier(); }
});

test('relecture, navigateur : le thème en verre, à 1280 et 390 px : les trois widgets se lisent et tiennent dans l\'écran', { skip: sans }, async () => {
  oublier();
  const web = v.web as unknown as Web;
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: 'h-verre' })).ok, true);
  assert.ok(web.pairing.request('Mozilla/5.0 (Linux; Android 14) Chrome/120', '192.0.2.47')); web.notify('state');
  try {
    for (const largeur of [1280, 390]) {
      const { ctx, page, erreurs } = await ouvrirPage(largeur, { sombre: true });
      try {
        await demandeVue(page);
        await page.waitForFunction(() => (document.documentElement.dataset.odinTheme || '') === 'h-verre', undefined, { timeout: 15000 });
        const m = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth, r = (n: any) => n.getBoundingClientRect();
          const lum = (c: string) => { const x = (c.match(/[\d.]+/g) ?? []).map(Number); const f = (u: number) => { u /= 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; }; return { l: 0.2126 * f(x[0]) + 0.7152 * f(x[1]) + 0.0722 * f(x[2]), a: x.length > 3 ? x[3] : 1 }; };
          const fondDe = (n: any) => { for (let e = n; e; e = e.parentElement) { const b = lum(getComputedStyle(e).backgroundColor); if (b.a > 0.5) return b.l; } return lum(getComputedStyle(document.body).backgroundColor).l; };
          const cartes = ['tu_veux', 'a_faire', 'odin_a_fait'].map((k) => document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`)!);
          const textes = cartes.flatMap((c: any) => [...c.querySelectorAll('.wr-n, .fe-auj b, .fe-auj .sub, .fe-auj button, .fe-auj .hok, .fe-auj .ft')]).filter((n: any) => r(n).width > 0 && (n.textContent ?? '').trim());
          const faibles = textes.map((n: any) => { const t = lum(getComputedStyle(n).color).l, f = fondDe(n), c = (Math.max(t, f) + 0.05) / (Math.min(t, f) + 0.05); return { t: (n.textContent ?? '').trim().slice(0, 30), c: Math.round(c * 10) / 10 }; }).filter((x: any) => x.c < 3);
          return { vw, deborde: document.documentElement.scrollWidth > vw + 1, dedans: cartes.every((c: any) => r(c).left >= 0 && r(c).right <= vw + 1), lus: textes.length, faibles };
        });
        assert.equal(m.deborde, false, `${largeur} : la page ne déborde pas`); assert.equal(m.dedans, true, `${largeur} : les cartes tiennent`);
        assert.ok(m.lus >= 5, `${largeur} : du texte dans les widgets`); assert.deepEqual(m.faibles, [], `${largeur} : chaque texte se détache de son fond`);
        await capture(page, `relecture-verre-${largeur}`);
        assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
      } finally { await ctx.close(); }
    }
  } finally { for (const x of web.pairing.pending()) web.pairing.decide(x.id, false); await valhallaOf()!.act('apparence', 'theme', { theme: 'valhalla' }); oublier(); }
});
