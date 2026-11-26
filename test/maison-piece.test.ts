// L'écran de la maison, la fenêtre d'une pièce (maquette validée « Accueil et Home Assistant ») : on choisit une pièce dans
// les onglets (ils restent un filtre), puis son bouton « Régler » ouvre une fenêtre avec la VRAIE liste de ses appareils.
// - Chaque appareil y garde toutes les commandes de sa carte d'aujourd'hui (la même carte, dessinée par la même fonction),
//   par la route qui existe (POST /api/maison/appareil) ; une pièce sans appareil commandable n'a pas d'interrupteur.
// - Une serrure demande l'accord à chaque fois ; une tablette « maison » ne l'ouvre jamais (requête rejouée).
// - Aucune valeur inventée, dans la fenêtre comme dans les cartes : le curseur d'une lumière n'a ni pouce ni nombre de
//   départ et une flèche n'envoie rien tant que rien n'est choisi ; une clim sans consigne lue n'affiche aucun degré.
// - Le genre d'un appareil gagne un code neutre (`genre`) à côté du mot français (`kind`) ; /api/maison/etat ne change
//   en rien d'autre, pour aucun public.
// - La fenêtre se ferme par Échap, par un appui ailleurs et par son bouton ; le focus revient sur la pièce ; elle n'est
//   jamais redessinée sous le doigt ; cibles de 44 px ; rien ne déborde à 320, 390 et 1280 px.
// Sans Playwright sur la machine, la part « navigateur » est ignorée (elle le dit).

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import * as A from '../src/valhalla/modules/appareils.ts';
import * as Midgard from '../src/valhalla/modules/midgard.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

/** Le code neutre du genre (midgard.ts) ; lu sans planter si le module ne l'a pas (l'essai le dit alors). */
const genreDe = (k: string): string | undefined => { const f = (Midgard as { genreDe?: (k: string) => string | undefined }).genreDe; assert.equal(typeof f, 'function', 'midgard.ts : genreDe'); return f!(k); };
const MAISON_JS = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
const MIDGARD_TS = readFileSync(new URL('../src/valhalla/modules/midgard.ts', import.meta.url), 'utf8');
const APPAREILS_TS = readFileSync(new URL('../src/valhalla/modules/appareils.ts', import.meta.url), 'utf8');

// ------------------------------------------------------------------ le code neutre du genre

/** Les tables « domaine → mot » lues dans le code (appareils.ts et midgard.ts), sans les recopier. */
const table = (src: string, debut: string): Record<string, string> => {
  const l = src.split('\n').find((x) => x.includes(debut)); assert.ok(l, debut);
  return Object.fromEntries([...l.slice(l.indexOf('{')).matchAll(/'?([a-z_]+)'?:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
};

test('genre : chaque mot français a son code neutre (le domaine standard) ; un mot inconnu n\'en a pas', () => {
  const tables = [table(APPAREILS_TS, 'KIND: Record<string, string> = {'), table(MIDGARD_TS, 'const K: Record<string, string> = {')];
  assert.ok(Object.keys(tables[0]).length >= 15 && Object.keys(tables[1]).length >= 10, 'les deux tables ont été lues');
  for (const t of tables) for (const [code, mot] of Object.entries(t)) assert.equal(genreDe(mot), code, `« ${mot} » → ${code}`);
  for (const x of ['', 'inconnu', 'light', 'Lumière', '__proto__', 'constructor', 'toString']) assert.equal(genreDe(x), undefined, `« ${x} » : rien`);
});

test('cartes d\'aujourd\'hui : plus de « 70 » ni de « 22 » inventés dans le dessin d\'un appareil', () => {
  const dessin = MAISON_JS.slice(MAISON_JS.indexOf('function devCard'), MAISON_JS.indexOf('function lieuBar'));
  assert.ok(dessin.length > 500, 'le dessin des cartes a été lu');
  assert.doesNotMatch(dessin, /value:\s*'70'/, 'le curseur de lumière ne part pas de 70');
  assert.doesNotMatch(dessin, /\|\|\s*22\b/, 'la clim n\'affiche pas 22 faute de consigne');
});

// ------------------------------------------------------------------ un vrai Odin d'essai, de faux appareils sur le relais

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, membre = '', cleMaison = '', cleComplet = '';
const MDP = 'une-pirogue-sur-le-lagon-calme-46';
const PIEGE = '<img src=x onerror="window.__pirate=1">';
/** Les ordres reçus par le relais : [objet, valeur]. */
const recus: Array<[string, string]> = [];
const horloge = { t: Date.now() }, reglages: Record<string, unknown> = { port: 0 };
const ctxRelais = { home: '', dir: '', settings: reglages, saveSettings: (p: Record<string, unknown>) => Object.assign(reglages, p), alert: () => {}, emit: () => {}, now: () => new Date(horloge.t) } as unknown as ModCtx;
const annonce = (type: string, obj: string, piece: string, c: Record<string, unknown> = {}) => A.brokerOf()!.publish(`decouverte/${type}/essai/${obj}/config`, JSON.stringify({ unique_id: `essai_${obj}`, name: `Appareil ${obj}`, state_topic: `essai/${obj}/etat`, command_topic: `essai/${obj}/cmd`, device: { suggested_area: piece }, ...c }));
const etatDe = (obj: string, x: string) => A.brokerOf()!.publish(`essai/${obj}/etat`, x);
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const commander = (appareil: string, valeur: string, h: Record<string, string> = {}, confirm = false) => v.json('/api/maison/appareil', { appareil, valeur, ...(confirm ? { confirm: true } : {}) }, h);

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'midgard', 'var', 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-p', nom: 'Membre P', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-p' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-p', MDP); assert.ok(membre);
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complète', droits: 'complet' })).data as { key: string }).key;
  process.env.MQTT_PASSWORD = 'relais-de-test';
  await A.appareils.start!(ctxRelais);
  A.brokerOf()!.on('essai/+/cmd', (m: { topic: string; payload: Buffer }) => { recus.push([m.topic.split('/')[1], m.payload.toString()]); });
  // « Pièce A » : un appareil de chaque genre commandable. « Pièce B » : des capteurs seulement. Une pièce piégée.
  annonce('light', 'l1', 'Pièce A'); annonce('switch', 'p1', 'Pièce A'); annonce('fan', 'f1', 'Pièce A'); annonce('cover', 'v1', 'Pièce A');
  annonce('climate', 'c1', 'Pièce A'); annonce('vacuum', 'a1', 'Pièce A'); annonce('lock', 'k1', 'Pièce A');
  annonce('sensor', 't1', 'Pièce B', { unit_of_measurement: '°C', command_topic: undefined }); annonce('binary_sensor', 'd1', 'Pièce B', { command_topic: undefined });
  annonce('switch', 'p2', PIEGE);
  etatDe('l1', 'ON'); etatDe('p1', 'OFF'); etatDe('f1', 'ON'); etatDe('v1', 'open'); etatDe('c1', 'cool'); etatDe('a1', 'docked'); etatDe('k1', 'LOCKED');
  etatDe('t1', '21.5'); etatDe('d1', 'OFF'); etatDe('p2', 'OFF');
});
after(async () => { A.appareils.stop!(); delete process.env.MQTT_PASSWORD; await tt.end(); Object.assign(console, orig); });

type Rep = { status: number; body: Record<string, any> };
const PUBLICS: Array<[string, () => Record<string, string>]> = [
  ['sa session', () => ({})], ['clé « complet »', () => ({ cookie: '', 'x-odin-maison': cleComplet })], ['tablette « maison »', () => ({ cookie: '', 'x-odin-maison': cleMaison })],
  ['membre', () => ({ cookie: membre })], ['sans session', () => ({ cookie: '' })],
];
/** L'état sans ce qui bouge d'une lecture à l'autre (l'heure, la mascotte, les nouvelles) : ce qui reste doit être identique. */
const fige = (r: Rep) => JSON.parse(JSON.stringify({ status: r.status, body: { ...r.body, at: undefined, mascotte: undefined, weather: undefined } }));
const sansGenre = (r: Rep) => { const x = fige(r); for (const p of x.body.rooms ?? []) for (const d of p.devices ?? []) delete d.genre; return x; };

test('vrai Odin : /api/maison/etat rend le code neutre à côté du mot, pour chaque appareil ; rien d\'autre ne change, pour aucun public', async () => {
  const lu: Record<string, Rep> = {};
  for (const [qui, h] of PUBLICS) lu[qui] = await v.json('/api/maison/etat', undefined, h()) as Rep;
  // Instantané pour comparer avant et après (hors dépôt, seulement si on le demande).
  if (process.env.ODIN_ETAT_INSTANTANE) writeFileSync(process.env.ODIN_ETAT_INSTANTANE, JSON.stringify(Object.fromEntries(Object.entries(lu).map(([k, r]) => [k, sansGenre(r)])), null, 1));
  for (const qui of ['sa session', 'clé « complet »', 'tablette « maison »']) {
    const r = lu[qui]; assert.equal(r.status, 200, qui);
    const devs = (r.body.rooms as any[]).flatMap((p) => p.devices);
    assert.equal(devs.length, 10, `${qui} : les dix appareils`);
    for (const d of devs) {
      assert.deepEqual(Object.keys(d), ['id', 'name', 'kind', 'genre', 'state', 'unit'], `${qui} : ${d.id}, le code juste après le mot`);
      assert.equal(d.genre, genreDe(d.kind), `${qui} : ${d.kind}`);
    }
    assert.deepEqual(Object.fromEntries(devs.map((d) => [d.kind, d.genre])), { 'lumière': 'light', prise: 'switch', ventilateur: 'fan', volet: 'cover', clim: 'climate', aspirateur: 'vacuum', serrure: 'lock', capteur: 'sensor', 'détecteur': 'binary_sensor' });
  }
  // Rien de plus pour une tablette « maison » que le mot déjà rendu ; le membre et sans session : refusés, sans un appareil.
  assert.deepEqual(sansGenre(lu['tablette « maison »']).body.rooms, sansGenre(lu['sa session']).body.rooms, 'la tablette reçoit les mêmes appareils qu\'avant');
  for (const qui of ['membre', 'sans session']) { assert.equal(lu[qui].status, 401, qui); assert.doesNotMatch(JSON.stringify(lu[qui].body), /essai_|genre|Pièce/, qui); }
  // L'ordre des clés de l'état ne change pas (le code s'ajoute seulement dans chaque appareil).
  assert.deepEqual(Object.keys(lu['sa session'].body), ['ok', 'fenetre', 'rights', 'name', 'theme', 'themes', 'weather', 'lieu', 'rooms', 'scenes', 'tiles', 'apps', 'network', 'cameras', 'people', 'mascotte', 'notices', 'at'].filter((k) => k in lu['sa session'].body));
});

test('vrai Odin : la serrure demande l\'accord à chaque fois ; une tablette « maison » ne l\'ouvre jamais (requête rejouée)', async () => {
  for (let i = 0; i < 2; i++) {
    recus.length = 0; const r = await commander('essai_k1', 'deverrouille');
    assert.equal(r.body.ok, false); assert.match(String(r.body.confirm), /déverrouiller/); assert.deepEqual(recus, [], 'sans accord, rien ne part');
  }
  recus.length = 0;
  const tab = await commander('essai_k1', 'deverrouille', { cookie: '', 'x-odin-maison': cleMaison }, true);
  assert.equal(tab.status, 200); assert.equal(tab.body.ok, false); assert.match(String(tab.body.text), /grave/); assert.deepEqual(recus, [], 'la tablette n\'ouvre pas');
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, Event: any, KeyboardEvent: any, PointerEvent: any, innerHeight: number;
interface Requete { postDataJSON(): any }
interface Route { continue(): Promise<void>; request(): Requete }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>; route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>;
  on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>; click(s: string): Promise<void>; focus(s: string): Promise<void>;
  keyboard: { press(k: string): Promise<void> }; mouse: { click(x: number, y: number): Promise<void> }; waitForTimeout(ms: number): Promise<void>;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;

async function ouvrir(largeur: number, o: { fond?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); ${o.fond ? 'localStorage.setItem(\'odin.maison.verre\', JSON.stringify({ fond: true, verres: {} }));' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [], envois: any[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/maison\/appareil/, async (r) => { envois.push(r.request().postDataJSON()); await r.continue(); });
  await p.goto(v.url + '/maison');
  await p.waitForSelector('.tabs [role=tab]', { timeout: 30000 });
  return { ctx, page: p, erreurs, envois };
}
// Le pouce caché : le navigateur ne rend pas le style calculé du pouce d'un curseur ; on vérifie que la règle de la page
// qui le cache (pages/widgets-maison-appareils.js) est posée et qu'elle s'applique à ce curseur.
const POUCE_CACHE = `((r) => r.matches('.wma-r:not([data-pose])') && [...document.styleSheets].some((f) => { try { return [...f.cssRules].some((x) => (x.selectorText || '').includes('.wma-r:not([data-pose])::-webkit-slider-thumb') && x.style.opacity === '0'); } catch { return false; } }))`;
const choisir = async (p: Page, piece: string) => {
  await p.evaluate((x: string) => [...document.querySelectorAll('.tabs [role=tab]')].find((b: any) => b.getAttribute('data-piece') === `p:${x}`).click(), piece);
  await p.waitForSelector('.piece-ouvrir'); await p.click('.piece-ouvrir'); await p.waitForSelector('dialog.pf[open] .pf-corps');
};
/** Les commandes d'une carte d'appareil (dans la grille ou dans la fenêtre) : leur genre, leur nom, si elles sont éteintes. */
const COMMANDES = `(c) => [...c.querySelectorAll('button, input')].map((n) => [n.tagName, n.getAttribute('role') || n.type || '', n.getAttribute('aria-label') || n.textContent.trim(), n.disabled ? 'off' : 'on'].join(' '))`;
const vuFenetre = (p: Page) => p.evaluate(`(() => {
  const d = document.querySelector('dialog.pf[open]'), cmd = ${COMMANDES}, txt = (n) => (n?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  const vis = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  const b = d.getBoundingClientRect();
  return {
    titre: txt(d.querySelector('#pf-titre')), noms: [...d.querySelectorAll('.dev b')].map(txt),
    cartes: Object.fromEntries([...d.querySelectorAll('[data-dev]')].map((c) => [c.getAttribute('data-dev'), cmd(c)])),
    grille: Object.fromEntries([...document.querySelectorAll('#maison-grille [data-dev]')].map((c) => [c.getAttribute('data-dev'), cmd(c)])),
    interrupteurs: d.querySelectorAll('[role=switch]').length, boutons: d.querySelectorAll('button').length, texte: txt(d.querySelector('.pf-corps')),
    petits: [...d.querySelectorAll('button, input')].filter(vis).filter((n) => { const r = n.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((n) => (n.getAttribute('aria-label') || n.textContent.trim() || n.className) + ' ' + Math.round(n.getBoundingClientRect().width) + '×' + Math.round(n.getBoundingClientRect().height)),
    dehors: b.left < -0.5 || b.right > innerWidth + 0.5, deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || d.scrollWidth > d.clientWidth + 1,
    pirate: Boolean(window.__pirate), focus: document.activeElement?.closest?.('dialog.pf') ? 'dedans' : document.activeElement?.className ?? '',
  };
})()`);

for (const largeur of [1280, 390, 320] as const) {
  test(`navigateur, ${largeur} px : la fenêtre d'une pièce montre ses vrais appareils, chacun avec toutes les commandes de sa carte ; rien d'inventé ; 44 px ; rien ne déborde`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur);
    try {
      // L'onglet reste un filtre : le choisir n'ouvre rien ; le bouton « Régler » n'apparaît qu'une pièce choisie.
      assert.equal(await p.evaluate(() => document.querySelectorAll('.piece-ouvrir').length), 0, '« Tout » : pas de bouton « Régler »');
      await p.evaluate(() => [...document.querySelectorAll('.tabs [role=tab]')].find((b: any) => b.getAttribute('data-piece') === 'p:Pièce A').click());
      assert.equal(await p.evaluate(() => document.querySelectorAll('dialog.pf[open]').length), 0, 'l\'onglet filtre, il n\'ouvre pas la fenêtre');
      assert.equal(await p.evaluate(() => document.querySelector('.piece-ouvrir').getAttribute('aria-label')), 'Régler Pièce A');
      await p.click('.piece-ouvrir'); await p.waitForSelector('dialog.pf[open] .pf-corps');
      const a = await vuFenetre(p) as any;
      assert.equal(a.titre, 'Pièce A');
      assert.deepEqual([...a.noms].sort(), ['l1', 'p1', 'f1', 'v1', 'c1', 'a1', 'k1'].map((x) => `Appareil ${x}`).sort(), 'les vrais appareils de la pièce, et eux seuls');
      // Chaque carte de la fenêtre a exactement les commandes de sa carte dans la grille (filtrée sur la même pièce).
      assert.equal(Object.keys(a.cartes).length, 7);
      for (const [id, c] of Object.entries(a.cartes)) assert.deepEqual(c, a.grille[id], `${id} : les commandes de sa carte d'aujourd'hui`);
      const de = (obj: string) => (a.cartes[`essai_${obj}`] as string[]).join(' | ');
      assert.match(de('l1'), /BUTTON switch/); assert.match(de('l1'), /INPUT range Intensité de Appareil l1 on/);
      assert.match(de('p1'), /BUTTON switch/); assert.match(de('f1'), /BUTTON switch/);
      for (const m of ['Monter', 'Arrêter', 'Descendre']) assert.match(de('v1'), new RegExp(`BUTTON submit ${m} on`));
      assert.match(de('c1'), /Moins chaud[^|]*off/); assert.match(de('c1'), /Plus chaud[^|]*off/); assert.match(de('c1'), /Arrêt on|Marche on/);
      assert.match(de('a1'), /Nettoyer on/); assert.match(de('a1'), /Base on/);
      assert.match(de('k1'), /INPUT range Glisser pour ouvrir Appareil k1 on/);
      // Aucune valeur inventée : la clim n'a pas de degré ; le curseur n'a ni pouce, ni nombre, ni « 70 ».
      assert.doesNotMatch(a.texte, /°|\b22\b|\b70\b|null|undefined|NaN/);
      const curseur = await p.evaluate(`(() => { const r = document.querySelector('dialog.pf [data-dev="essai_l1"] input[data-code=intensite]'); return { pose: r.hasAttribute('data-pose'), dit: r.getAttribute('aria-valuetext'), pouce: ${POUCE_CACHE}(r), sortie: r.parentElement.querySelector('.wma-n')?.textContent ?? '' }; })()`) as Record<string, unknown>;
      assert.deepEqual(curseur, { pose: false, dit: 'Intensité non mesurée', pouce: true, sortie: '' });
      // 44 px, rien ne sort de l'écran, une pièce piégée n'est que du texte.
      assert.deepEqual(a.petits, [], 'cibles de 44 px'); assert.equal(a.dehors, false); assert.equal(a.deborde, false, 'rien ne déborde');
      assert.equal(a.pirate, false);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-piece-${largeur}.png` });
      // Une pièce sans appareil commandable : aucun interrupteur, aucune commande (seulement « Fermer »).
      await p.keyboard.press('Escape'); await choisir(p, 'Pièce B');
      const b = await vuFenetre(p) as any;
      assert.deepEqual([...b.noms].sort(), ['Appareil d1', 'Appareil t1']); assert.equal(b.interrupteurs, 0); assert.equal(b.boutons, 1, 'seulement « Fermer »');
      await p.keyboard.press('Escape'); await choisir(p, PIEGE);
      assert.equal((await vuFenetre(p) as any).titre, PIEGE, 'le nom de la pièce est du texte'); assert.equal(await p.evaluate(() => Boolean(window.__pirate)), false);
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur : les cartes de la grille non plus n\'inventent rien (ni pouce au milieu, ni degré)', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs, envois } = await ouvrir(1280);
  try {
    const c = await p.evaluate(`(() => { const r = document.querySelector('#maison-grille [data-dev="essai_l1"] input[type=range]'); return { pose: r.hasAttribute('data-pose'), pouce: ${POUCE_CACHE}(r), clim: document.querySelector('#maison-grille [data-dev="essai_c1"]').textContent }; })()`) as { pose: boolean; pouce: boolean; clim: string };
    assert.deepEqual([c.pose, c.pouce], [false, true]); assert.doesNotMatch(c.clim, /°|null|undefined|NaN/);
    // Une flèche sur le curseur sans mesure n'envoie rien.
    await p.focus('#maison-grille [data-dev="essai_l1"] input[type=range]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500);
    assert.deepEqual(envois, [], 'sans mesure, une flèche n\'envoie rien');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : commander depuis la fenêtre ; la serrure demande l\'accord à chaque fois ; une flèche sans mesure n\'envoie rien', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs, envois } = await ouvrir(1280);
  const attendre = async (n: number) => { for (let i = 0; i < 50 && envois.length < n; i++) await p.waitForTimeout(100); };
  try {
    await choisir(p, 'Pièce A');
    envois.length = 0; recus.length = 0;
    await p.click('dialog.pf [data-dev="essai_v1"] button[aria-label="Descendre"]'); await attendre(1);
    assert.deepEqual(envois, [{ appareil: 'essai_v1', valeur: 'ferme' }]);
    for (let i = 0; i < 30 && !recus.length; i++) await p.waitForTimeout(100);
    assert.deepEqual(recus, [['v1', 'OFF']], 'l\'ordre arrive au bon appareil');
    // Le curseur : une flèche n'envoie rien tant que rien n'est choisi ; « Fin » choisit le maximum, et il part.
    envois.length = 0; await p.focus('dialog.pf [data-dev="essai_l1"] input[data-code=intensite]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(400);
    assert.deepEqual(envois, [], 'une flèche sans mesure n\'envoie rien');
    await p.keyboard.press('End'); await attendre(1); assert.deepEqual(envois, [{ appareil: 'essai_l1', valeur: '100 %' }]);
    // La serrure : glisser demande l'accord, à chaque fois ; « Annuler » : rien ne part au relais.
    const glisser = () => p.evaluate(() => { const r = document.querySelector('dialog.pf [data-dev="essai_k1"] input[type=range]'); r.value = '100'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    for (let i = 0; i < 2; i++) {
      await p.waitForTimeout(800); envois.length = 0; recus.length = 0; await glisser();
      await p.waitForSelector('dialog[aria-label="Confirmation"][open]');
      await p.evaluate(() => [...document.querySelectorAll('dialog[aria-label="Confirmation"] button')].find((b: any) => b.textContent === 'Annuler').click());
      await p.waitForTimeout(500);
      assert.deepEqual(envois, [{ appareil: 'essai_k1', valeur: 'deverrouille' }], 'une demande, sans « confirm »'); assert.deepEqual(recus, [], 'sans accord, rien ne part');
      assert.equal(await p.evaluate(() => document.querySelectorAll('dialog.pf[open]').length), 1, 'la fenêtre reste ouverte');
    }
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : Échap, un appui ailleurs, le bouton « Fermer » ; le focus revient sur la pièce ; jamais redessinée sous le doigt ; le focus tient au redessin', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280);
  const ouverte = () => p.evaluate(() => document.querySelectorAll('dialog.pf[open]').length);
  const focusSurPiece = () => p.evaluate(() => document.activeElement?.classList.contains('piece-ouvrir'));
  try {
    await choisir(p, 'Pièce A');
    await p.keyboard.press('Escape'); assert.equal(await ouverte(), 0, 'Échap'); assert.equal(await focusSurPiece(), true, 'le focus revient sur la pièce');
    await p.click('.piece-ouvrir'); await p.waitForSelector('dialog.pf[open]');
    await p.mouse.click(3, 3); await p.waitForTimeout(200); assert.equal(await ouverte(), 0, 'un appui ailleurs'); assert.equal(await focusSurPiece(), true);
    await p.click('.piece-ouvrir'); await p.waitForSelector('dialog.pf[open]');
    await p.click('dialog.pf .pf-fermer'); assert.equal(await ouverte(), 0, 'le bouton'); assert.equal(await focusSurPiece(), true);
    // Un doigt posé : l'état change (une prise s'allume), la fenêtre n'est pas redessinée tant qu'il reste posé.
    await p.click('.piece-ouvrir'); await p.waitForSelector('dialog.pf[open]');
    await p.evaluate(() => { window.__corps = document.querySelector('dialog.pf .pf-corps').firstElementChild; document.querySelector('dialog.pf [data-dev="essai_v1"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    etatDe('p1', 'ON');
    await p.focus('dialog.pf [data-dev="essai_v1"] button[aria-label="Monter"]'); await p.keyboard.press('Enter'); // un ordre : la page relit l'état
    for (let i = 0; i < 40 && !(await p.evaluate(() => document.querySelector('#maison-grille [data-dev="essai_p1"] [role=switch]')?.getAttribute('aria-checked') === 'true')); i++) await p.waitForTimeout(150);
    await p.waitForTimeout(1500);
    assert.equal(await p.evaluate(() => document.querySelector('dialog.pf .pf-corps').firstElementChild === window.__corps), true, 'pas de redessin sous le doigt');
    // Le doigt levé : la fenêtre suit l'état vrai, et le focus reste sur la même commande.
    await p.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
    for (let i = 0; i < 30 && (await p.evaluate(() => document.querySelector('dialog.pf .pf-corps').firstElementChild === window.__corps)); i++) await p.waitForTimeout(150);
    const apres = await p.evaluate(() => ({ neuf: document.querySelector('dialog.pf .pf-corps').firstElementChild !== window.__corps, prise: document.querySelector('dialog.pf [data-dev="essai_p1"] [role=switch]').getAttribute('aria-checked'), focus: document.activeElement?.getAttribute('aria-label'), dans: Boolean(document.activeElement?.closest('dialog.pf [data-dev="essai_v1"]')) }));
    assert.deepEqual(apres, { neuf: true, prise: 'true', focus: 'Monter', dans: true });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : fond animé allumé, la fenêtre reste lisible (fond plein derrière ses cartes)', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(390, { fond: true });
  try {
    await choisir(p, 'Pièce A');
    const fond = await p.evaluate(() => getComputedStyle(document.querySelector('dialog.pf')).backgroundColor);
    assert.match(fond, /^rgb\(/, `un fond plein, sans transparence : ${fond}`);
    if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-piece-fond-390.png` });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// ------------------------------------------------------------------ ce que le regard sur l'affichage a relevé
// Le retour d'une commande se voit dans la fenêtre (le message n'est plus posé sous elle) ; un nom n'est jamais coupé au
// milieu d'un mot ; « moins » et « plus » éteints se voient éteints et la raison est écrite ; le bouton qui ouvre la
// fenêtre dit « Régler » en clair ; « Fermer » reste à l'écran quand la fenêtre défile.

for (const largeur of [1280, 768, 390] as const) {
  test(`navigateur, ${largeur} px : le retour d'une commande se voit ; aucun nom coupé ; « moins » et « plus » éteints se voient ; « Régler » écrit ; « Fermer » reste à l'écran`, { skip: sansNav }, async () => {
    // Des noms d'un seul mot long, dans une pièce à part (ajoutés ici, pour ne rien changer aux essais plus haut).
    annonce('light', 'l9', 'Pièce C', { name: 'Plafonnier' }); annonce('fan', 'f9', 'Pièce C', { name: 'Ventilateur' }); annonce('switch', 'p9', 'Pièce C', { name: 'Prise principale' });
    etatDe('l9', 'OFF'); etatDe('f9', 'OFF'); etatDe('p9', 'OFF');
    for (let i = 0; i < 50; i++) { const r = await v.json('/api/maison/etat') as Rep; if ((r.body.rooms as any[]).some((x) => x.name === 'Pièce C' && x.devices.length === 3)) break; await new Promise((ok) => setTimeout(ok, 100)); }
    const { ctx, page: p, erreurs } = await ouvrir(largeur);
    try {
      await p.evaluate(() => [...document.querySelectorAll('.tabs [role=tab]')].find((b: any) => b.getAttribute('data-piece') === 'p:Pièce A').click());
      await p.waitForSelector('.piece-ouvrir');
      // Chaque point relevé est noté, puis tous sont vérifiés ensemble à la fin (un rouge les montre tous).
      const soucis: string[] = [], si = (ok: boolean, quoi: string) => { if (!ok) soucis.push(quoi); };
      si(/Régler/.test(await p.evaluate(() => document.querySelector('.piece-ouvrir').innerText)), '« Régler » écrit en clair sur le bouton');
      await p.click('.piece-ouvrir'); await p.waitForSelector('dialog.pf[open] .pf-corps');
      // La clim sans consigne lue : ses deux boutons se voient éteints, et la raison est écrite.
      const clim = await p.evaluate(() => { const c = document.querySelector('dialog.pf [data-dev="essai_c1"]'), b = [...c.querySelectorAll('button')].filter((x: any) => x.disabled), on = [...c.querySelectorAll('button')].find((x: any) => !x.disabled); return { eteints: b.length, opacite: b.map((x: any) => Number(getComputedStyle(x).opacity)), active: Number(getComputedStyle(on).opacity), texte: c.innerText }; }) as any;
      assert.equal(clim.eteints, 2); for (const o of clim.opacite) si(o < clim.active * 0.7, `un bouton éteint se voit éteint (${o} contre ${clim.active})`);
      si(/Consigne non lue/.test(clim.texte), 'la raison est écrite, pas seulement lue par le lecteur d\'écran');
      // « Fermer » reste à l'écran quand la fenêtre défile jusqu'en bas.
      await p.evaluate(() => { const d = document.querySelector('dialog.pf'); d.scrollTop = d.scrollHeight; });
      await p.waitForTimeout(100);
      const f = await p.evaluate<{ dedans: boolean; touche: boolean }>(() => { const r = document.querySelector('dialog.pf .pf-fermer').getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { dedans: r.top >= 0 && r.bottom <= innerHeight, touche: Boolean(document.elementFromPoint(x, y)?.closest('.pf-fermer')) }; });
      si(f.dedans && f.touche, '« Fermer » reste visible et touchable');
      // Le retour d'une commande se voit par-dessus la fenêtre.
      await p.click('dialog.pf [data-dev="essai_v1"] button[aria-label="Descendre"]');
      await p.waitForSelector('.toast', { timeout: 10000 });
      const t = await p.evaluate(() => { const n = document.querySelector('.toast'), r = n.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { texte: n.textContent, vu: Boolean(document.elementFromPoint(x, y)?.closest('.toast')) }; }) as any;
      assert.ok(t.texte.length > 0); si(t.vu, `le retour « ${t.texte} » se voit, rien ne le couvre`);
      // Aucun nom coupé au milieu d'un mot.
      await p.keyboard.press('Escape'); await choisir(p, 'Pièce C');
      const coupes = await p.evaluate(() => {
        const out: string[] = [];
        for (const b of document.querySelectorAll('dialog.pf .dev b') as any) {
          const n = b.firstChild; if (!n) continue;
          for (const m of n.textContent.matchAll(/\S+/g)) { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); if (r.getClientRects().length > 1) out.push(m[0]); }
        }
        return out;
      });
      si(coupes.length === 0, `aucun mot coupé (${coupes.join(', ')})`);
      assert.deepEqual(soucis, [], 'ce que le regard sur l\'affichage a relevé');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-piece-c-${largeur}.png` });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}
