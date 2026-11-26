// La fiche d'une appli (src/web/pages/fiche-appli.js) : « Mettre en widget sur : l'accueil » (maquette validée « Accueil »,
// la fiche ouverte depuis « Toutes les applis »).
// - Le bouton pose le widget « appli » de CETTE appli (le même que sa ligne dans « Ajouter un widget » : fenetre.js) à la
//   fin de la page ouverte de l'accueil, et Odin le garde ; un second appui ne pose pas de doublon, et le dit.
// - « L'écran de la maison » n'est pas proposé : cet écran ne reçoit ni ne dessine aujourd'hui le widget d'une appli
//   (prouvé plus bas par sa route) ; aucun bouton mort, aucun bouton grisé.
// - Les « Actions rapides » de la maquette ne sont pas dans la fiche : le catalogue que la fiche reçoit porte bien les
//   actions de chaque appli, mais le tri de celles qu'on offre (au propriétaire seul, sur l'accueil seul, sans l'action
//   réservée à son écran « Sur quel poste ? », au plus quelques-unes) n'existe que côté serveur, dans le widget d'une
//   appli (src/valhalla/widgets/applis.ts) ; la fiche ne le recopie pas.
// - Qui voit quoi : un membre voit la fiche d'aujourd'hui, rien de plus (ranger l'accueil est au propriétaire seul : le
//   serveur le refuse, requête rejouée à la main) ; une tablette n'a pas la fiche et ne range rien.
// - Chaque ligne de la fiche d'aujourd'hui reste là, dans le même ordre ; le bouton fait 44 px ; tout se fait au clavier
//   (Tab entre dans la fiche quand elle a « Mettre en widget » ; pour un membre, Tab va à l'appli suivante comme avant ;
//   Échap rend le focus à l'appli) ; rien ne déborde à 390 et 1280 px, clair et sombre ; la fiche ne couvre pas l'appli,
//   même quand son message s'écrit.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { admiseALaMaison } from '../src/valhalla/widgets/index.ts';
import type { Module, View } from '../src/valhalla/types.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const FICHE = lire('src/web/pages/fiche-appli.js'), MAISON = lire('src/web/maison.js');
const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, membreCookie = '', cleMaison = '';
const MDP = 'une-boussole-sur-la-colline-verte';
const fait: string[] = [];

function essai(id: string, nom: string): Module {
  return {
    id, name: nom, family: 'Données', what: `${nom} : une appli d'essai pour la fiche.`, does: ['trier des fichiers', 'compter ce qui reste'], from: [], upstream: [], words: [],
    actions: [
      { id: 'etat', label: 'État', what: 'Dit où elle en est.', read: true, run: () => { fait.push(`${id}:etat`); return { text: `${nom} va bien.` }; } },
      { id: 'vider', label: 'Vider', what: 'Vide tout.', grave: () => 'vider l\'appli d\'essai', run: () => { fait.push(`${id}:vider`); return { text: 'Vidé.' }; } },
    ],
    view: () => ({ kpis: [{ label: 'Fichiers', value: '12' }], sections: [] }) as unknown as View,
  } as Module;
}
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b8e00001', SALON = 'b8e00002';
/** La fenêtre de départ : une page sans le widget de l'appli d'essai, et une page montrée sur l'écran de la maison. */
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Mes applis', widgets: [{ id: 'c8e00001', kind: 'appli', module: 'essaip', w: 1, c: 3, r: 2 }] }, { id: SALON, name: 'Salon', maison: true, widgets: [{ id: 'c8e00011', kind: 'appli', module: 'essaip', w: 1, c: 3, r: 2 }] }] });
type Gardee = { pages: Array<{ id: string; name?: string; widgets: Array<Record<string, unknown>> }> };
const gardee = async () => ((await valhallaOf()!.act('gladsheim', 'fenetre')).data as Gardee);
async function remettre() {
  const va = valhallaOf()!; va.ctx('gladsheim').saveSettings({ fenetre: undefined });
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
}
/** Combien de widgets « appli » de cette appli toute la fenêtre gardée porte (toutes ses pages). */
const combienSurLAccueil = async (id: string) => (await gardee()).pages.flatMap((p) => p.widgets).filter((w) => w.kind === 'appli' && w.module === id).length;

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => [...allModules(o).filter((m) => ['gladsheim', 'var', 'apparence'].includes(m.id)), essai('essaiw', 'Appli Essai'), essai('essaip', 'Appli Pas Pour Lui')] });
  const va = valhallaOf()!;
  // Un membre AVEC le droit sur l'appli d'essai, SANS le droit sur l'autre.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-f', nom: 'Membre F', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'essaiw']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-f' })).ok, true);
  lierProprietaire(persona()!);
  membreCookie = await entrer('membre-f', MDP); assert.ok(membreCookie, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  await remettre();
});
after(async () => { await tt.end(); Object.assign(console, orig); });

// ------------------------------------------------------------------ le serveur décide (requêtes rejouées à la main)

test('serveur : ranger l\'accueil (ce que fait « Mettre en widget ») est au propriétaire seul ; un membre et une tablette sont refusés, rien ne change', async () => {
  await remettre();
  const avant = JSON.stringify(await gardee());
  const f = FENETRE(); f.pages[0].widgets.push({ id: 'c8e00009', kind: 'appli', module: 'essaiw', w: 1, c: 3, r: 2 });
  const corps = { module: 'gladsheim', action: 'regler_fenetre', input: { fenetre: JSON.stringify(f) } };
  const m = await v.json('/api/valhalla/act', corps, { cookie: membreCookie });
  assert.notEqual(m.body.ok, true, 'un membre : refusé');
  const t = await v.json('/api/valhalla/act', corps, { cookie: '', 'x-odin-maison': cleMaison });
  assert.notEqual(t.body.ok, true, 'une tablette « maison » : refusée');
  assert.equal(JSON.stringify(await gardee()), avant, 'rien n\'a changé');
});

test('l\'écran de la maison : la règle du serveur admet la sorte « appli », mais cet écran ne la reçoit pas aujourd\'hui (donc la fiche ne le propose pas)', async () => {
  assert.equal(admiseALaMaison('appli'), true, 'la règle (un seul endroit, côté serveur) l\'admet');
  await remettre();
  const r = await v.json('/api/maison/etat', undefined, { cookie: '', 'x-odin-maison': cleMaison });
  assert.equal(r.status, 200);
  const salon = (r.body.fenetre as Array<{ name: string; widgets: Array<{ id: string; kind?: string }> }>).find((p) => p.name === 'Salon');
  assert.deepEqual((salon?.widgets ?? []).filter((w) => w.id === 'c8e00011'), [], 'le widget « appli » posé sur la page de la maison n\'y arrive pas');
  // La page de la maison ne charge pas la fiche d'une appli : rien de plus pour une tablette.
  assert.doesNotMatch(MAISON, /OdinFicheAppli|fiche-appli/);
});

test('la fiche : aucune liste d\'applis ni d\'actions écrite dedans ; pas de fenêtre du navigateur', () => {
  assert.doesNotMatch(FICHE, /window\.(confirm|alert|prompt)\(/);
  assert.doesNotMatch(FICHE, /\b(essaiw|frigg|forseti|vidarr|sindri)\b/i, 'aucune appli nommée');
  assert.doesNotMatch(FICHE, /Home Assistant/, 'pas de choix « Home Assistant »');
});

test('la fiche : ses messages ne se coupent pas entre un guillemet et le nom de la page (espaces insécables)', () => {
  const window: Record<string, any> = {};
  runInNewContext(FICHE, { window });
  const { ditDe } = window.OdinFicheAppli.logique as { ditDe(r: unknown): string };
  for (const etat of ['pose', 'deja']) {
    const t = ditDe({ etat, page: 'Aujourd\'hui' });
    assert.match(t, /«\u00a0Aujourd'hui\u00a0»/, `${etat} : « et » tiennent au nom de la page`);
    // Une espace ordinaire (U+0020) à côté d'un guillemet ou devant un deux-points laisserait la ligne se couper là.
    assert.doesNotMatch(t, /« | »| :/, `${etat} : aucune espace sécable à côté d'un guillemet ou devant un deux-points`);
  }
});

// ------------------------------------------------------------------ le navigateur

declare const document: any, window: any, getComputedStyle: any, innerWidth: number, innerHeight: number;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>; hover(s: string): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>; keyboard: { press(k: string): Promise<void> }; waitForTimeout(ms: number): Promise<void>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;

/** La page « Applis » d'Odin, au nom de `cookie` ; prête quand la fenêtre de l'accueil est chargée. */
async function applis(largeur: number, sombre: boolean, cookie = v.session) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = cookie.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); localStorage.setItem('odin.applis.vue', 'applis'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.goto(`${v.url}/#apps`);
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await p.waitForFunction(() => Boolean(window.OdinFenetre?.state?.().L), undefined, { timeout: 30000 });
  await p.waitForSelector('#v-apps .va-appbtn', { timeout: 30000 });
  return { ctx, page: p, erreurs };
}
const tuile = (nom: string) => `#v-apps .va-appbtn:has(> span:text-is("${nom}"))`;
/** Ouvre la fiche de l'appli au clavier : le focus sur sa tuile (après une touche : le focus se voit). */
async function ficheAuClavier(p: Page, nom: string) {
  await p.keyboard.press('Shift');
  await p.evaluate((n: string) => ([...document.querySelectorAll('#v-apps .va-appbtn')].find((b: any) => b.querySelector(':scope > span:last-child')?.textContent === n) as any).focus(), nom);
  await p.waitForSelector('#odinFiche:not([hidden]) .fa', { timeout: 10000 });
}
/** Ce que la fiche montre, dans l'ordre. */
const fiche = (p: Page) => p.evaluate(() => {
  const f = document.querySelector('#odinFiche:not([hidden]) .fa'); if (!f) return null;
  const r = f.getBoundingClientRect(), txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const poser = f.querySelector('.fa-poser'), pr = poser?.getBoundingClientRect();
  return {
    lignes: [...f.querySelectorAll('h3, .fa-fam, .fa-etat, .fa-phrase, .fa-faire h4, .fa-orig h4, .fa-alt > b, .fa-ouvrir, .fa-mettre h4, .fa-poser')].map((n: any) => { const c = String(n.className || '').split(' ').find((x) => x.startsWith('fa-')); return c ? `${n.tagName.toLowerCase()}.${c}` : n.tagName.toLowerCase(); }),
    texte: txt(f), boutons: [...f.querySelectorAll('button')].map(txt),
    poser: poser ? { texte: txt(poser), nom: poser.getAttribute('aria-label'), haut: Math.round(pr.height), large: Math.round(pr.width) } : null,
    dit: txt(f.querySelector('.fa-dit')),
    dedans: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
    deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    enfants: [...f.querySelectorAll('*')].every((n: any) => { const b = n.getBoundingClientRect(); return b.width === 0 || (b.left >= r.left - 1 && b.right <= r.right + 1); }),
  };
});
/** Ce que la fiche dit une fois la pose finie (ni vide, ni « Un instant… »), puis remis à vide pour l'appui suivant. */
async function ditApres(p: Page): Promise<string> {
  await p.waitForFunction(() => { const t = document.querySelector('#odinFiche .fa-dit')?.textContent ?? ''; return t !== '' && !/…$/.test(t); }, undefined, { timeout: 20000 });
  return p.evaluate(() => { const n = document.querySelector('#odinFiche .fa-dit'); const t = n.textContent; n.textContent = ''; return t; });
}
const actif = (p: Page) => p.evaluate(() => { const a = document.activeElement; return { classe: String(a?.className ?? ''), texte: (a?.textContent ?? '').replace(/\s+/g, ' ').trim(), dansFiche: Boolean(a?.closest?.('#odinFiche')) }; });

for (const [largeur, sombre] of [[1280, false], [1280, true], [390, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : « Mettre en widget sur l'accueil » pose le widget de l'appli à la fin de la page, Odin le garde ; un second appui ne pose pas de doublon ; au clavier ; rien ne déborde`, { skip: sansNav }, async () => {
    await remettre();
    const { ctx, page: p, erreurs } = await applis(largeur, sombre);
    try {
      await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaiw') === true, undefined, { timeout: 30000 });
      const ouverte = await p.evaluate(() => { const s = window.OdinFenetre.state(); return s.L.pages[Math.min(s.cur, s.L.pages.length - 1)].id; }) as string;
      await ficheAuClavier(p, 'Appli Essai');
      const f = (await fiche(p))!;
      // Chaque ligne de la fiche d'aujourd'hui, dans le même ordre, puis « Mettre en widget sur ».
      assert.ok(f.lignes.indexOf('button.fa-ouvrir') >= 0 && f.lignes.indexOf('button.fa-ouvrir') < f.lignes.indexOf('button.fa-poser'), 'après « Ouvrir », jamais avant');
      for (const s of ['h3', 'span.fa-etat', 'p.fa-phrase', 'button.fa-ouvrir']) assert.ok(f.lignes.includes(s) || f.lignes.some((l) => l.startsWith(s)), `${s} est encore là`);
      assert.match(f.texte, /Ce que tu peux y faire/); assert.match(f.texte, /Ouvrir Appli Essai/);
      assert.deepEqual(f.poser, { texte: 'L\'accueil', nom: 'Mettre Appli Essai en widget sur l\'accueil', haut: f.poser!.haut, large: f.poser!.large });
      assert.ok(f.poser!.haut >= 44 && f.poser!.large >= 44, `bouton de 44 px au moins (${f.poser!.large} × ${f.poser!.haut})`);
      assert.match(f.texte, /Mettre en widget sur/);
      assert.doesNotMatch(f.texte, /maison|Home Assistant/i, 'l\'écran de la maison n\'est pas proposé');
      assert.doesNotMatch(f.texte, /Actions rapides/, 'aucune action rapide');
      assert.deepEqual(f.boutons, ['Ouvrir Appli Essai', 'L\'accueil'], 'aucun autre bouton (ni action, ni bouton mort)');
      assert.equal(f.dedans, true, 'la fiche reste dans l\'écran'); assert.equal(f.enfants, true, 'tout reste dans la fiche'); assert.equal(f.deborde, false, 'aucun défilement de côté');
      // Au clavier : Tab entre dans la fiche (« Ouvrir », puis « L'accueil »), Entrée pose.
      await p.keyboard.press('Tab'); assert.equal((await actif(p)).texte, 'Ouvrir Appli Essai', 'Tab : dans la fiche');
      await p.keyboard.press('Tab'); assert.equal((await actif(p)).texte, 'L\'accueil');
      assert.equal(await combienSurLAccueil('essaiw'), 0);
      await p.keyboard.press('Enter');
      assert.match(await ditApres(p), /Posé/);
      const garde = (await gardee()).pages.find((x) => x.id === ouverte)!;
      const dernier = garde.widgets[garde.widgets.length - 1];
      assert.deepEqual([dernier.kind, dernier.module, dernier.c, dernier.r], ['appli', 'essaiw', 3, 2], 'le widget « appli » de cette appli, à la fin de la page ouverte, gardé par Odin');
      assert.equal(await combienSurLAccueil('essaiw'), 1);
      assert.deepEqual(await actif(p), { classe: 'btn fa-poser', texte: 'L\'accueil', dansFiche: true }, 'le focus reste sur le bouton');
      // Un second appui : rien de plus, et c'est dit.
      await p.keyboard.press('Enter');
      assert.match(await ditApres(p), /déjà/);
      assert.equal(await combienSurLAccueil('essaiw'), 1, 'pas de doublon');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/fiche-widget-${largeur}${sombre ? '-sombre' : ''}.png` });
      // Échap ferme la fiche ; le focus revient à la tuile de l'appli.
      await p.keyboard.press('Escape');
      await p.waitForFunction(() => document.querySelector('#odinFiche')?.hidden === true, undefined, { timeout: 5000 });
      // Et elle reste fermée (le focus rendu ne la rouvre pas).
      await p.waitForTimeout(400); assert.equal(await p.evaluate(() => document.querySelector('#odinFiche')?.hidden), true, 'Échap : la fiche reste fermée');
      const a = await actif(p); assert.equal(a.classe, 'va-appbtn'); assert.match(a.texte, /Appli Essai$/, 'le focus revient à la tuile de l\'appli');
      // À la souris (ordinateur) : survol, puis le bouton.
      if (largeur > 500) {
        await p.hover(tuile('Appli Essai'));
        await p.waitForSelector('#odinFiche:not([hidden]) .fa-poser', { timeout: 10000 });
        await p.click('#odinFiche .fa-poser');
        assert.match(await ditApres(p), /déjà/);
        assert.equal(await combienSurLAccueil('essaiw'), 1, 'toujours pas de doublon');
      }
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await remettre(); }
  });
}

test('navigateur, 390 px : l\'appli en bas de l\'écran, la fiche au-dessus ; quand son message s\'écrit, elle ne couvre pas l\'appli et reste dans l\'écran', { skip: sansNav }, async () => {
  await remettre();
  const { ctx, page: p, erreurs } = await applis(390, true);
  try {
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaiw') === true, undefined, { timeout: 30000 });
    // Une appli tout en bas de l'écran (une tuile de 92 px, posée à 680 px du haut, comme au troisième regard) : la fiche
    // n'a de place nette qu'au-dessus. La position de la vraie tuile dépend de la liste ; cette ancre fixe ne dépend de rien.
    await p.evaluate(() => {
      const b = document.createElement('button'); b.id = 'ancreEssai'; b.type = 'button'; b.textContent = 'Appli Essai';
      b.style.cssText = 'position:fixed;left:16px;top:680px;width:92px;height:92px;z-index:1';
      document.body.append(b);
      window.OdinFicheAppli.montrer({ id: 'essaiw', name: 'Appli Essai', family: 'Données', what: 'Appli Essai : une appli d\'essai pour la fiche.', does: ['trier des fichiers', 'compter ce qui reste'] }, b, {});
    });
    await p.waitForSelector('#odinFiche:not([hidden]) .fa-poser', { timeout: 10000 });
    const mesure = () => p.evaluate(() => {
      const f = document.querySelector('#odinFiche:not([hidden]) .fa').getBoundingClientRect(), a = document.querySelector('#ancreEssai').getBoundingClientRect();
      return { couvre: f.left < a.right && a.left < f.right && f.top < a.bottom && a.top < f.bottom, dedans: f.top >= -1 && f.bottom <= innerHeight + 1, cote: document.querySelector('#odinFiche').dataset.cote, f: [Math.round(f.top), Math.round(f.bottom)], a: [Math.round(a.top), Math.round(a.bottom)] };
    });
    const m0 = await mesure();
    assert.equal(m0.couvre, false, `à l'ouverture, la fiche ne couvre pas l'appli ${JSON.stringify(m0)}`);
    assert.equal(m0.cote, 'dessus', 'la fiche est au-dessus de l\'appli');
    await p.click('#odinFiche .fa-poser');
    await p.waitForFunction(() => /Posé/.test(document.querySelector('#odinFiche .fa-dit')?.textContent ?? ''), undefined, { timeout: 20000 });
    const m = await mesure();
    assert.equal(m.couvre, false, `le message écrit, la fiche ne couvre toujours pas l'appli ${JSON.stringify(m)}`);
    assert.equal(m.dedans, true, 'elle reste dans l\'écran');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await remettre(); }
});

test('navigateur : « Modifier » ouvert sur l\'accueil : rien n\'est posé (ce qu\'il range n\'est pas encore gardé), et c\'est dit', { skip: sansNav }, async () => {
  await remettre();
  const { ctx, page: p, erreurs } = await applis(1280, false);
  try {
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaiw') === true, undefined, { timeout: 30000 });
    await p.evaluate(() => window.OdinFenetre.edit(true));
    await ficheAuClavier(p, 'Appli Essai');
    await p.click('#odinFiche .fa-poser');
    assert.match(await ditApres(p), /Modifier/);
    assert.equal(await combienSurLAccueil('essaiw'), 0, 'rien n\'est posé');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await remettre(); }
});

test('navigateur : le widget de l\'appli déjà sur une autre page de l\'accueil : rien n\'est posé, la fiche dit sur quelle page', { skip: sansNav }, async () => {
  const va = valhallaOf()!, f = FENETRE(); f.pages[1].widgets.push({ id: 'c8e00012', kind: 'appli', module: 'essaiw', w: 1, c: 3, r: 2 });
  va.ctx('gladsheim').saveSettings({ fenetre: undefined }); assert.equal((await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(f) })).ok, true);
  const { ctx, page: p, erreurs } = await applis(1280, false);
  try {
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaiw') === true, undefined, { timeout: 30000 });
    await ficheAuClavier(p, 'Appli Essai');
    await p.click('#odinFiche .fa-poser');
    // Les guillemets tiennent au nom par des espaces insécables (la ligne ne se coupe plus là) : même vérification.
    assert.match(await ditApres(p), /déjà.*«\u00a0Salon\u00a0»/);
    assert.equal(await combienSurLAccueil('essaiw'), 1, 'pas de doublon');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await remettre(); }
});

for (const [largeur, sombre] of [[1280, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : un membre voit la fiche d'aujourd'hui, rien de plus (ni « Mettre en widget », ni action)`, { skip: sansNav }, async () => {
    await remettre();
    const { ctx, page: p, erreurs } = await applis(largeur, sombre, membreCookie);
    try {
      // Sa page Applis ne montre que ses applis ; la fenêtre a fini de demander au serveur qui regarde.
      await p.waitForFunction(() => [...document.querySelectorAll('#v-apps .va-appbtn > span')].some((s: any) => s.textContent === 'Appli Essai'), undefined, { timeout: 30000 });
      assert.equal(await p.evaluate(() => [...document.querySelectorAll('#v-apps .va-appbtn > span')].some((s: any) => s.textContent === 'Appli Pas Pour Lui')), false);
      await p.waitForFunction(() => typeof window.OdinFenetre?.peutPoser === 'function', undefined, { timeout: 30000 });
      assert.equal(await p.evaluate(() => window.OdinFenetre.peutPoser('essaiw')), false, 'pas pour un membre');
      await ficheAuClavier(p, 'Appli Essai');
      const f = (await fiche(p))!;
      assert.equal(f.poser, null, 'pas de « Mettre en widget »');
      assert.doesNotMatch(f.texte, /Mettre en widget|Actions rapides|maison/i);
      assert.deepEqual(f.boutons, ['Ouvrir Appli Essai'], 'le seul bouton d\'aujourd\'hui');
      // Au clavier, comme avant ce lot : sa fiche n'a que « Ouvrir » (ce que fait déjà la tuile), Tab va donc tout droit
      // à ce qui suit la tuile (la fiche se ferme) — un arrêt par appli, pas deux. (Avant la relecture, cet essai
      // demandait que Tab entre dans la fiche ; la relecture a noté que cela changeait le clavier d'un membre.)
      const apres = await p.evaluate(() => { const t = document.activeElement, l = [...document.querySelectorAll('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter((n: any) => !n.closest('#odinFiche') && n.getClientRects().length); return l[l.indexOf(t) + 1]?.outerHTML.slice(0, 80) ?? ''; }) as string;
      assert.notEqual(apres, '', 'une suite existe après la tuile');
      await p.keyboard.press('Tab');
      assert.equal((await actif(p)).dansFiche, false, 'Tab n\'entre pas dans la fiche d\'un membre');
      assert.equal(await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 80) ?? ''), apres, 'le focus suit la tuile');
      await p.waitForFunction(() => document.querySelector('#odinFiche')?.hidden === true, undefined, { timeout: 5000 });
      assert.equal(f.dedans, true); assert.equal(f.deborde, false);
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}
