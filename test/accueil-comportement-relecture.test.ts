// Relecture adverse du lot 27 (première part) : « Comment Odin se comporte » en widget de la page « Aujourd'hui ».
// Ce widget change la conduite d'Odin (autonomie, disponibilité, discrétion). Tenu ici :
// - il n'arrive qu'une fois, et seulement s'il a une place : une fenêtre dont toutes les pages sont pleines ne porte pas
//   la marque « déjà reçu » (sinon il ne serait jamais arrivé) ; il ne va sur une page « Écran de la maison » que s'il
//   n'y a pas d'autre place ;
// - la marque envoyée par la page ne se laisse pas tromper (trop grande, pas un entier, pas un nombre) ;
// - un membre, la clé d'accès, une tablette, personne : ni ranger la fenêtre avec la marque, ni ouvrir le widget à
//   quelqu'un ; un membre ne lit pas le niveau d'autonomie dans son état ;
// - en mode Modifier, ses boutons ne répondent plus : attraper la carte par un bouton ne change pas l'autonomie ; hors
//   du mode Modifier ils répondent de nouveau ; en plein écran il reste caché, et aucun de ses boutons ne reçoit le focus.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { MODULES_PAR_PAGE, avecAujourdhui, cleanLayout, type Layout } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { ACCUEIL_RECU, PAGE_AUJOURDHUI } from '../src/valhalla/widgets/aujourdhui.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const K = 'comportement';
const IDS = ['gladsheim', 'midgard', 'vordr', 'var'];
const sortes = (l: Layout) => l.pages.map((p) => p.widgets.map((w: any) => w.kind as string));
const copie = <X>(x: X): X => JSON.parse(JSON.stringify(x));
const plein = (n: number, id: string) => Array.from({ length: n }, (_, i) => ({ id: `${id}${i.toString(16).padStart(4, '0')}`, kind: 'heure', w: 1 }));
/** La page « Aujourd'hui » pleine (« À faire » + 47 heures), rangée au lot 26 : aucune marque. */
const jourPlein = () => ({ id: '0a0f0000', code: 'aujourdhui', widgets: [{ id: '0a0f0002', kind: 'a_faire' }, ...plein(MODULES_PAR_PAGE - 1, 'd100')] });

// ------------------------------------------------------------------ le modèle

test('relecture : toutes les pages pleines, il n\'arrive pas et la fenêtre ne porte pas la marque ; une place se libère, il arrive', () => {
  const toutes = cleanLayout({ pages: [jourPlein(), { id: 'b2000001', name: 'Maison', widgets: plein(MODULES_PAR_PAGE, 'd200') }] }, IDS);
  const lue = avecAujourdhui(toutes);
  assert.deepEqual(lue.pages, toutes.pages, 'rien ne bouge');
  assert.equal(lue.accueil, undefined, 'pas arrivé : pas de marque « déjà reçu »');
  // La page d'aujourd'hui range ce qu'elle a lu : toujours sans marque. Le propriétaire retire un widget : il arrive.
  const rangee = cleanLayout(copie(lue), IDS); assert.equal('accueil' in rangee, false);
  rangee.pages[1].widgets.pop();
  const apres = avecAujourdhui(cleanLayout(copie(rangee), IDS));
  assert.equal(apres.accueil, ACCUEIL_RECU); assert.equal(sortes(apres).flat().filter((k) => k === K).length, 1, 'il arrive, une seule fois');
  assert.equal(apres.pages[1].widgets.at(-1)!.kind, K);
  assert.equal(avecAujourdhui(cleanLayout(copie(apres), IDS)).pages.flatMap((p) => p.widgets).filter((w) => w.kind === K).length, 1, 'relu après rangement : pas de double');
});

test('relecture : il ne va pas sur une page « Écran de la maison » quand une autre page a de la place', () => {
  const l = cleanLayout({ pages: [jourPlein(), { id: 'b2000001', name: 'Salon', maison: true, widgets: plein(2, 'd200') }, { id: 'b2000002', name: 'Réseau', widgets: plein(1, 'd300') }] }, IDS);
  const r = avecAujourdhui(l);
  assert.deepEqual(sortes(r).map((ks) => ks.includes(K)), [false, false, true], 'sur la page ordinaire');
  assert.deepEqual(r.pages[1], l.pages[1], 'la page de l\'écran de la maison n\'a pas bougé');
  // Il ne reste que des pages « Écran de la maison » : il y est posé (le propriétaire le voit sur son accueil ; l'écran de la maison ne le sert pas).
  const seules = cleanLayout({ pages: [jourPlein(), { id: 'b2000001', name: 'Salon', maison: true, widgets: plein(2, 'd200') }] }, IDS);
  assert.deepEqual(sortes(avecAujourdhui(seules))[1], ['heure', 'heure', K]);
});

test('relecture : la marque envoyée par la page ne se laisse pas tromper', () => {
  const page = { pages: [{ name: 'P', widgets: [{ kind: 'a_faire' }] }] };
  const marque = (v: unknown) => cleanLayout(JSON.parse(JSON.stringify({ ...page, accueil: v })), IDS).accueil;
  for (const v of [1e308, 9007199254740993, 2.0, 3, 1e3]) assert.equal(marque(v), ACCUEIL_RECU, `${v} : jamais plus que la dernière livraison connue`);
  for (const v of [-1e308, -2, -0, 0, 1, 1.9999, 2.0001, '2', '99', [2], { valueOf: 2 }, true, null, 'NaN', 'Infinity']) assert.equal(marque(v), undefined, `${JSON.stringify(v)} : pas de marque`);
  // Une marque posée d'avance ne fait rien perdre : sans « À faire », les blocs du lot 26 reviennent quand même.
  const menteuse = avecAujourdhui(cleanLayout({ accueil: 99, pages: [{ name: 'P', widgets: [{ kind: 'heure' }] }] }, IDS));
  assert.ok(sortes(menteuse).flat().includes('a_faire'), '« À faire » ne disparaît pas');
  // Pas de marque (0, absente) : il revient, une seule fois, jamais deux.
  const revenu = avecAujourdhui(cleanLayout({ accueil: 0, pages: [{ name: 'P', widgets: [{ kind: 'a_faire' }, { kind: K }, { kind: K }] }] }, IDS));
  assert.equal(sortes(revenu).flat().filter((k) => k === K).length, 1);
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, membre = '';
const MDP = 'un-flamboyant-au-bord-du-lagon-27';
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const g = () => valhallaOf()!.ctx('gladsheim');
const oublier = () => g().saveSettings({ fenetre: undefined });
const autonomie = async () => ((await v.json('/api/state')).body as { autonomy?: string }).autonomy;
const geste = (corps: Record<string, unknown>, h: Record<string, string> = {}) => v.json('/api/action', corps, h);
const remettre = async () => { await geste({ kind: 'set_autonomy', autonomy: 'equilibre' }); await geste({ kind: 'set_control', control: 'mode', value: 'disponible' }); await geste({ kind: 'set_control', control: 'discretion', value: 'essentiel' }); };

before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-q', nom: 'Membre Q', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-q' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-q', MDP); assert.ok(membre, 'le membre a une session');
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  await remettre();
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('relecture : un membre, la clé d\'accès, une tablette, personne ne range la fenêtre (avec ou sans la marque) ni n\'ouvre le widget à quelqu\'un', async () => {
  oublier(); await remettre();
  const va = valhallaOf()!;
  const cles = await Promise.all((['complet', 'maison'] as const).map(async (droits) => ((await va.act('gladsheim', 'cle_tablette', { nom: `Tablette ${droits}`, droits })).data as { key: string }).key));
  const autres: Array<[string, Record<string, string>]> = [['un membre', { cookie: membre }], ['la clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['une tablette « complet »', { cookie: '', 'x-odin-maison': cles[0] }], ['une tablette « maison »', { cookie: '', 'x-odin-maison': cles[1] }], ['personne', { cookie: '' }]];
  for (const [qui, h] of autres) {
    for (const marque of [undefined, 0, 2, 99]) {
      const f = { ...(marque === undefined ? {} : { accueil: marque }), pages: [{ name: 'À moi', maison: true, widgets: [{ kind: K, toucher: { quoi: 'action', action: 'theme' } }, { kind: 'a_faire' }] }] };
      const r = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify(f) } }, h);
      assert.notEqual(r.body.ok, true, `${qui}, marque ${marque} : refusé (${r.status})`);
    }
    assert.equal(g().settings.fenetre, undefined, `${qui} : rien n'est rangé`);
    // La fenêtre lue : rien du widget, rien de la marque (ou pas de fenêtre du tout).
    const lu = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'fenetre', input: {} }, h);
    assert.doesNotMatch(JSON.stringify(lu.body), /comportement|0a0f0004|"accueil"/, `${qui} : la fenêtre ne dit rien de lui`);
    // « Ouvrir à… » : seul le propriétaire, et jamais ce widget.
    const o = await v.json('/api/valhalla/act', { module: 'gladsheim', action: 'ouvrir_widget', input: { widget: '0a0f0004', personne: 'membre-q', ouvert: 'oui' } }, h);
    assert.notEqual(o.body.ok, true, `${qui} : « Ouvrir à » refusé`);
  }
  // Le propriétaire lui-même ne l'ouvre à personne (aucune appli de la vie privée derrière).
  const o = await va.act('gladsheim', 'ouvrir_widget', { widget: PAGE_AUJOURDHUI.widgets[3].id, personne: 'membre-q', ouvert: 'oui' });
  assert.equal(o.ok, false); assert.equal(g().settings.ouvertures, undefined, 'rien n\'est ouvert');
  // Un membre ne lit pas le niveau d'autonomie ni les deux autres réglages dans son état.
  assert.equal((await geste({ kind: 'set_autonomy', autonomy: 'prudent' })).body.ok, true);
  assert.equal((await geste({ kind: 'set_control', control: 'discretion', value: 'urgent' })).body.ok, true);
  const sien = JSON.stringify((await v.json('/api/state', undefined, { cookie: membre })).body);
  assert.doesNotMatch(sien, /prudent|"urgent"/, 'l\'état servi au membre ne dit pas les réglages');
  assert.doesNotMatch(JSON.stringify((await v.json('/api/widgets/donnees', undefined, { cookie: membre })).body), /prudent|comportement|0a0f0004/);
  await remettre(); oublier();
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  keyboard: { press(k: string): Promise<void> }; mouse: { click(x: number, y: number): Promise<void>; move(x: number, y: number, o?: Record<string, unknown>): Promise<void>; down(): Promise<void>; up(): Promise<void> };
  waitForTimeout(ms: number): Promise<void>; on(e: string, f: (x: Error) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;
const capture = async (p: Page, nom: string) => { if (!CAPTURES) return; await p.screenshot({ path: `${CAPTURES}/${nom}.png`, fullPage: true }); };

async function ouvrirPage(largeur: number) {
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: 900 }, locale: 'fr-FR', colorScheme: 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript('try { localStorage.setItem(\'odin.tour\', \'done\'); } catch { /* rien */ }');
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(v.url + '/');
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await page.waitForSelector(`#feGrid .fe-auj[data-auj="${K}"] .ctrls .seg button`, { timeout: 45000 });
  return { ctx, page, erreurs };
}
const BOUTON = `#feGrid .fe-auj[data-auj="${K}"] [role=group][aria-label="Autonomie"] button[title="Autonome"]`;
/** Le milieu du bouton « Autonome », amené dans l'écran. */
const milieu = (p: Page) => p.evaluate((s: string) => { const b = document.querySelector(s); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, BOUTON);

test('relecture, navigateur : en mode Modifier les boutons du widget ne répondent pas (attraper la carte ne change pas l\'autonomie) ; hors du mode, ils répondent', { skip: sansNav }, async () => {
  oublier(); await remettre();
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    await page.evaluate(() => window.OdinFenetre.edit(true));
    await page.waitForSelector('#fenetre.fe-edit'); await page.waitForSelector(BOUTON, { timeout: 30000 });
    // Un clic sur « Autonome » en mode Modifier (en voulant prendre la carte) : rien ne change chez Odin.
    let m = await milieu(page);
    await page.mouse.click(m.x, m.y); await page.waitForTimeout(900);
    assert.equal(await autonomie(), 'equilibre', 'un clic en mode Modifier ne change pas l\'autonomie');
    // Un appui qui bouge à peine, relâché sur le même bouton : rien non plus.
    m = await milieu(page);
    await page.mouse.move(m.x, m.y); await page.mouse.down(); await page.mouse.move(m.x + 3, m.y + 2); await page.mouse.up(); await page.waitForTimeout(900);
    assert.equal(await autonomie(), 'equilibre', 'un appui qui tremble non plus');
    // Au clavier : aucun de ses boutons ne reçoit le focus en mode Modifier.
    const inerte = await page.evaluate((k: string) => { const h = document.querySelector(`#feGrid .fe-auj[data-auj="${k}"]`); const b = h.querySelector('button'); b.focus(); return { inert: h.inert === true, focus: document.activeElement === b }; }, K);
    assert.deepEqual(inerte, { inert: true, focus: false });
    // Et la carte se prend par là : le glisser commence.
    m = await milieu(page);
    await page.mouse.move(m.x, m.y); await page.mouse.down(); await page.mouse.move(m.x + 20, m.y - 30, { steps: 6 });
    assert.equal(await page.evaluate(() => document.body.classList.contains('fe-glisse')), true, 'la carte est en main');
    await capture(page, 'relecture-modifier-en-main');
    await page.mouse.move(m.x, m.y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(400);
    assert.equal(await autonomie(), 'equilibre');
    await capture(page, 'relecture-modifier-1280');
    // Les autres blocs du jour ne sont pas touchés par cette règle.
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#feGrid .fe-auj')].filter((n: any) => n.inert).length), 1);
    // Sorti du mode Modifier : le bouton répond de nouveau.
    await page.evaluate(() => window.OdinFenetre.edit(false));
    await page.waitForFunction(() => !document.querySelector('#fenetre.fe-edit'));
    await page.waitForSelector(BOUTON, { timeout: 30000 });
    assert.equal(await page.evaluate((k: string) => document.querySelector(`#feGrid .fe-auj[data-auj="${k}"]`).inert, K), false);
    m = await milieu(page); await page.mouse.click(m.x, m.y);
    await page.waitForFunction((s: string) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', BOUTON, { timeout: 20000 });
    assert.equal(await autonomie(), 'autonome');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); await remettre(); }
});

test('relecture, navigateur : en plein écran le widget est caché, ses boutons hors du clavier ; les autres widgets gardent leur place', { skip: sansNav }, async () => {
  oublier(); await remettre();
  const { ctx, page, erreurs } = await ouvrirPage(1280);
  try {
    await page.evaluate(() => document.getElementById('homeFull').click());
    await page.waitForSelector('#v-home.pe-plein');
    const a = await page.evaluate((k: string) => {
      const c = document.querySelector(`#feGrid > .fe-w[data-auj="${k}"]`), r = c.getBoundingClientRect();
      const b = c.querySelector('.fe-auj button'); b?.focus();
      const autres = [...document.querySelectorAll('#feGrid > .fe-w')].filter((n: any) => n !== c).map((n: any) => n.getBoundingClientRect().height > 40);
      return { cache: r.width === 0 && r.height === 0, focus: document.activeElement === b, autres };
    }, K);
    assert.deepEqual(a, { cache: true, focus: false, autres: [true, true, true] });
    await capture(page, 'relecture-plein-1280');
    // Tab, vingt fois : le focus n'entre jamais dans le widget caché.
    for (let i = 0; i < 20; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate((k: string) => Boolean(document.activeElement?.closest?.(`.fe-w[data-auj="${k}"]`)), K), false, `Tab ${i + 1}`); }
    assert.equal(await autonomie(), 'equilibre');
    assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
  } finally { await ctx.close(); await remettre(); }
});
