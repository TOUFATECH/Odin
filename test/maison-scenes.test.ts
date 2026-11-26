// L'écran de la maison, les scènes (maquette validée « Accueil et Home Assistant », la part « voir et lancer ») : ses
// scènes à lui, celles que Midgard garde (aucune au départ). Toucher une scène ouvre une fenêtre « ce que fait cette
// scène » : ses vraies étapes, dites par l'interface (la phrase n'est jamais rangée dans la donnée), et « Lancer ».
// - Une scène qui ouvre la maison redemande l'accord à chaque fois ; sans accord, rien ne part ; une tablette « maison »
//   ne la lance jamais (requête rejouée). Le résultat est dit dans la fenêtre.
// - Une étape qui pilote une autre appli (« appli.action = valeur ») n'est dite en clair qu'à sa session ; une clé, une
//   tablette « maison » : « une action dans Odin », sans nom ; un membre n'a pas cet écran.
// - Aucune scène : « Aucune scène », et où les créer. Ni créer, ni modifier une scène depuis cet écran.
// - La fenêtre se ferme par Échap, par un appui ailleurs et par son bouton ; le focus revient sur la scène ; elle n'est
//   jamais redessinée ; cibles de 44 px ; rien ne déborde à 320, 390 et 1280 px ; un nom piégé reste du texte.
// Sans Playwright sur la machine, la part « navigateur » est ignorée (elle le dit).

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import * as A from '../src/valhalla/modules/appareils.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

// ------------------------------------------------------------------ un vrai Odin d'essai, de faux appareils sur le relais

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, membre = '', cleMaison = '', cleComplet = '';
const MDP = 'un-boutre-blanc-au-large-du-recif-58';
const PIEGE = '<img src=x onerror="window.__pirate=1">';
/** Les ordres reçus par le relais : [objet, valeur]. */
const recus: Array<[string, string]> = [];
const reglages: Record<string, unknown> = { port: 0 };
const ctxRelais = { home: '', dir: '', settings: reglages, saveSettings: (p: Record<string, unknown>) => Object.assign(reglages, p), alert: () => {}, emit: () => {}, now: () => new Date() } as unknown as ModCtx;
const annonce = (type: string, obj: string, piece: string) => A.brokerOf()!.publish(`decouverte/${type}/essai/${obj}/config`, JSON.stringify({ unique_id: `essai_${obj}`, name: `Appareil ${obj}`, state_topic: `essai/${obj}/etat`, command_topic: `essai/${obj}/cmd`, device: { suggested_area: piece } }));
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const attendre = async (f: () => boolean, ms = 3000) => { for (let i = 0; i < ms / 100 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'midgard', 'var', 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-s', nom: 'Membre S', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-s' })).ok, true);
  lierProprietaire(persona()!);
  membre = await entrer('membre-s', MDP); assert.ok(membre);
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette complète', droits: 'complet' })).data as { key: string }).key;
  process.env.MQTT_PASSWORD = 'relais-de-test';
  await A.appareils.start!(ctxRelais);
  A.brokerOf()!.on('essai/+/cmd', (m: { topic: string; payload: Buffer }) => { recus.push([m.topic.split('/')[1], m.payload.toString()]); });
  annonce('light', 'l1', 'Pièce A'); annonce('lock', 'k1', 'Pièce A');
  A.brokerOf()!.publish('essai/l1/etat', 'OFF'); A.brokerOf()!.publish('essai/k1/etat', 'LOCKED');
  await attendre(() => A.allDevices().length >= 2);
});
after(async () => { A.appareils.stop!(); delete process.env.MQTT_PASSWORD; await tt.end(); Object.assign(console, orig); });

type Rep = { status: number; body: Record<string, any> };
const PUBLICS: Array<[string, () => Record<string, string>]> = [
  ['sa session', () => ({})], ['clé « complet »', () => ({ cookie: '', 'x-odin-maison': cleComplet })], ['tablette « maison »', () => ({ cookie: '', 'x-odin-maison': cleMaison })],
  ['membre', () => ({ cookie: membre })], ['sans session', () => ({ cookie: '' })],
];
const etat = (h: Record<string, string> = {}) => v.json('/api/maison/etat', undefined, h) as Promise<Rep>;
const lancer = (scene: string, h: Record<string, string> = {}, confirm = false) => v.json('/api/maison/scene', { scene, ...(confirm ? { confirm: true } : {}) }, h) as Promise<Rep>;

// ------------------------------------------------------------------ ce que l'écran reçoit

test('zéro scène : l\'écran reçoit une liste vide, rien d\'inventé (ni les scènes de la maquette)', async () => {
  const r = await etat();
  assert.equal(r.status, 200); assert.deepEqual(r.body.scenes, []);
  assert.deepEqual(r.body.scenesEtapes, [], 'les étapes des scènes : une liste vide');
});

test('ses scènes : créées dans Odin (Midgard), la donnée rangée n\'a que le nom et les étapes, aucune phrase', async () => {
  const va = valhallaOf()!;
  for (const [nom, etapes] of [['Scène lumière', 'essai_l1 = on\ngladsheim.theme = verre'], ['Scène porte', 'essai_k1 = deverrouille'], [PIEGE, 'essai_l1 = off']]) assert.equal((await va.act('midgard', 'creer_scene', { nom, etapes })).ok, true, nom);
  const rangees = va.ctx('midgard').settings.scenes as Array<Record<string, unknown>>;
  assert.equal(rangees.length, 3);
  for (const s of rangees) {
    assert.deepEqual(Object.keys(s), ['name', 'steps'], 'la donnée : un nom, des étapes');
    for (const st of s.steps as Array<Record<string, unknown>>) assert.deepEqual(Object.keys(st), ['appareil', 'valeur']);
  }
  // Ce que l'écran reçoit : les étapes lues, jamais une phrase (seulement des noms, des valeurs, des marques).
  const r = await etat();
  for (const s of r.body.scenesEtapes) {
    assert.deepEqual(Object.keys(s), ['nom', 'ouvre', 'etapes'], s.nom);
    for (const e of s.etapes) for (const [k, x] of Object.entries(e)) assert.ok(['appareil', 'valeur', 'ouvre', 'appli', 'action'].includes(k) && (typeof x === 'string' || typeof x === 'boolean'), `${s.nom} : ${k}`);
  }
  assert.doesNotMatch(JSON.stringify(r.body.scenesEtapes), /étape|accord|Ouvre la maison|lancée/, 'aucune phrase de l\'interface dans la donnée');
});

test('qui voit quoi : une étape qui pilote une autre appli n\'est dite en clair qu\'à sa session ; une clé, une tablette : sans nom ; un membre : refusé', async () => {
  const lu: Record<string, Rep> = {};
  for (const [qui, h] of PUBLICS) lu[qui] = await etat(h());
  const soiree = (qui: string) => (lu[qui].body.scenesEtapes as any[]).find((x) => x.nom === 'Scène lumière');
  assert.deepEqual(soiree('sa session'), { nom: 'Scène lumière', ouvre: false, etapes: [{ appareil: 'essai_l1', valeur: 'on' }, { appli: 'Hestia', action: 'Thème', valeur: 'verre' }] });
  for (const qui of ['clé « complet »', 'tablette « maison »']) {
    assert.equal(lu[qui].status, 200, qui);
    assert.deepEqual(soiree(qui), { nom: 'Scène lumière', ouvre: false, etapes: [{ appareil: 'essai_l1', valeur: 'on' }, { appli: true }] }, `${qui} : « une action dans Odin », sans nom`);
    assert.doesNotMatch(JSON.stringify(lu[qui].body.scenesEtapes), /Hestia|gladsheim|Thème|theme|verre/, qui);
    // Rien de plus qu'avant sur les scènes : les mêmes noms.
    assert.deepEqual(lu[qui].body.scenes, lu['sa session'].body.scenes, qui);
  }
  assert.deepEqual((lu['tablette « maison »'].body.scenesEtapes as any[]).find((x) => x.nom === 'Scène porte'), { nom: 'Scène porte', ouvre: true, etapes: [{ appareil: 'essai_k1', valeur: 'deverrouille', ouvre: true }] });
  for (const qui of ['membre', 'sans session']) { assert.equal(lu[qui].status, 401, qui); assert.doesNotMatch(JSON.stringify(lu[qui].body), /Scène lumière|Scène porte|essai_/, qui); }
});

test('qui voit quoi : une étape « appli.action » dont l\'appli n\'est pas trouvée (mal écrite, absente) n\'est pas dite à une clé ni à une tablette', async () => {
  const va = valhallaOf()!, ctx = va.ctx('midgard'), avant = ctx.settings.scenes as unknown[];
  assert.equal((await va.act('midgard', 'creer_scene', { nom: 'Scène perdue', etapes: 'essai_l1 = on\nnullepart.allumer = mot-cache' })).ok, true);
  try {
    const perdue = async (h: Record<string, string>) => ((await etat(h)).body.scenesEtapes as any[]).find((x) => x.nom === 'Scène perdue');
    // Pour lui, l'étape reste telle qu'il l'a écrite (c'est la sienne).
    assert.deepEqual(await perdue({}), { nom: 'Scène perdue', ouvre: false, etapes: [{ appareil: 'essai_l1', valeur: 'on' }, { appareil: 'nullepart.allumer', valeur: 'mot-cache' }] });
    for (const [qui, h] of PUBLICS.slice(1, 3)) {
      const vu = await perdue(h());
      assert.deepEqual(vu, { nom: 'Scène perdue', ouvre: false, etapes: [{ appareil: 'essai_l1', valeur: 'on' }, { appli: true }] }, `${qui} : « une action dans Odin », sans nom`);
      assert.doesNotMatch(JSON.stringify(vu), /nullepart|mot-cache/, qui);
    }
  } finally { ctx.saveSettings({ scenes: avant }); }
  assert.equal((ctx.settings.scenes as unknown[]).length, 3, 'les trois scènes d\'avant, rien de plus');
});

test('lancer : une scène qui ouvre la maison demande l\'accord à chaque fois, sans accord rien ne part ; une tablette « maison » ne la lance pas (requête rejouée)', async () => {
  for (let i = 0; i < 2; i++) {
    recus.length = 0; const r = await lancer('Scène porte');
    assert.equal(r.body.ok, false); assert.match(String(r.body.confirm), /déverrouiller/);
    await new Promise((x) => setTimeout(x, 300)); assert.deepEqual(recus, [], 'sans accord, rien ne part');
  }
  recus.length = 0;
  const tab = await lancer('Scène porte', { cookie: '', 'x-odin-maison': cleMaison }, true);
  assert.equal(tab.body.ok, false); assert.match(String(tab.body.text), /grave/);
  await new Promise((x) => setTimeout(x, 300)); assert.deepEqual(recus, [], 'la tablette n\'ouvre pas');
  const oui = await lancer('Scène porte', {}, true);
  assert.equal(oui.body.ok, true); await attendre(() => recus.length > 0);
  assert.equal(recus[0]?.[0], 'k1', 'avec son accord, la scène part');
});

// ------------------------------------------------------------------ le script de l'écran, lu tel quel

test('le script de l\'écran : les mots de la carte des scènes viennent du widget « Scènes » (pas recopiés) ; la règle 44 px ne touche que la carte des scènes', async () => {
  const { readFileSync } = await import('node:fs');
  const js = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /'Aucune scène\.'|'Crée-les dans Odin\.'/, 'les mots du widget ne sont pas recopiés dans l\'écran');
  // La classe « scene » sert aussi aux boutons des widgets « bouton » de cet écran : leur règle reste celle d'avant ce lot.
  assert.match(js, /\n\.scene\{border:0;background:var\(--card2\);border-radius:14px;padding:10px 14px;margin:6px 6px 0 0;color:var\(--text\)\}/);
  assert.match(js, /\.scenes-carte \.scene\{[^}]*min-height:44px/);
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

declare const document: any, window: any, getComputedStyle: any, innerWidth: number;
interface Requete { postDataJSON(): any }
interface Route { continue(): Promise<void>; request(): Requete; fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
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

async function ouvrir(largeur: number, o: { fond?: boolean; cle?: string; etat?: (e: any) => any } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt });
  if (!o.cle) { const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]); }
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); ${o.fond ? 'localStorage.setItem(\'odin.maison.verre\', JSON.stringify({ fond: true, verres: {} }));' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [], envois: any[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/maison\/scene/, async (r) => { envois.push(r.request().postDataJSON()); await r.continue(); });
  if (o.etat) await p.route(/\/api\/maison\/etat/, async (r) => { const rep = await r.fetch(); await r.fulfill({ response: rep, json: o.etat!(await rep.json()) }); });
  await p.goto(v.url + '/maison' + (o.cle ? `#cle=${o.cle}` : ''));
  await p.waitForSelector('#maison-grille .scenes-carte', { timeout: 30000 });
  return { ctx, page: p, erreurs, envois };
}
const toucher = async (p: Page, nom: string) => {
  await p.evaluate((x: string) => [...document.querySelectorAll('#maison-grille .scenes-carte button.scene')].find((b: any) => b.getAttribute('data-scene') === x).click(), nom);
  await p.waitForSelector('dialog.sf[open]');
};
const vuFenetre = (p: Page) => p.evaluate(`(() => {
  const d = document.querySelector('dialog.sf[open]'), txt = (n) => (n?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  const vis = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  const b = d.getBoundingClientRect(), lancer = d.querySelector('.sf-lancer');
  return {
    titre: d.querySelector('#sf-titre').textContent, etapes: [...d.querySelectorAll('.sf-etapes li')].map(txt), texte: txt(d.querySelector('.sf-corps')),
    lancer: lancer ? (lancer.disabled ? 'éteint' : 'allumé') : 'absent', boutons: [...d.querySelectorAll('button')].map((x) => x.getAttribute('aria-label') || txt(x)),
    petits: [...d.querySelectorAll('button')].filter(vis).filter((n) => { const r = n.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((n) => txt(n) + ' ' + Math.round(n.getBoundingClientRect().width) + '×' + Math.round(n.getBoundingClientRect().height)),
    dehors: b.left < -0.5 || b.right > innerWidth + 0.5, deborde: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 || d.scrollWidth > d.clientWidth + 1,
    pirate: Boolean(window.__pirate),
  };
})()`);

for (const largeur of [1280, 390, 320] as const) {
  test(`navigateur, ${largeur} px : ses scènes ; toucher une scène montre ce qu'elle fait, ses vraies étapes, et « Lancer » ; 44 px ; rien ne déborde ; un nom piégé est du texte`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur);
    try {
      const noms = await p.evaluate(() => [...document.querySelectorAll('#maison-grille .scenes-carte button.scene')].map((b: any) => b.getAttribute('data-scene')));
      assert.deepEqual(noms, ['Scène lumière', 'Scène porte', PIEGE], 'ses scènes, et elles seules');
      const petitesScenes = await p.evaluate(() => [...document.querySelectorAll('#maison-grille .scenes-carte button.scene')].filter((n: any) => n.getBoundingClientRect().height < 43.5).length);
      assert.equal(petitesScenes, 0, 'les boutons de scène font 44 px');
      // Sur un écran étroit (une colonne de cartes ou deux), la carte des scènes prend toute la largeur de la grille.
      if (largeur <= 820) {
        const l = await p.evaluate(() => ({ carte: document.querySelector('#maison-grille .scenes-carte').getBoundingClientRect().width, grille: document.querySelector('#maison-grille .scenes-carte').parentElement.getBoundingClientRect().width }));
        assert.ok(l.carte >= l.grille - 1, `la carte des scènes prend toute la largeur : ${Math.round(l.carte)} sur ${Math.round(l.grille)} px`);
      }
      await toucher(p, 'Scène lumière');
      const a = await vuFenetre(p) as any;
      assert.equal(a.titre, 'Scène lumière');
      assert.deepEqual(a.etapes, ['Appareil l1 → allumé', 'Hestia · Thème : verre'], 'ses vraies étapes, l\'appli nommée pour lui');
      assert.match(a.texte, /2 étapes/); assert.equal(a.lancer, 'allumé');
      assert.deepEqual(a.petits, [], 'cibles de 44 px'); assert.equal(a.dehors, false); assert.equal(a.deborde, false, 'rien ne déborde');
      assert.ok(!a.boutons.some((x: string) => /Créer|Modifier|Supprimer/.test(x)), 'ni créer, ni modifier, ni supprimer');
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-scene-${largeur}.png` });
      await p.keyboard.press('Escape'); await toucher(p, 'Scène porte');
      const b = await vuFenetre(p) as any;
      // La valeur de l'étape est dite par l'interface (« deverrouille », écrit dans la scène, devient « déverrouillé »).
      assert.deepEqual(b.etapes, ['⚠ Appareil k1 → déverrouillé']); assert.match(b.texte, /accord/); assert.equal(b.lancer, 'allumé');
      await p.keyboard.press('Escape'); await toucher(p, PIEGE);
      const c = await vuFenetre(p) as any;
      assert.equal(c.titre, PIEGE, 'le nom est du texte'); assert.equal(c.pirate, false);
      assert.equal(await p.evaluate(() => Boolean(window.__pirate)), false);
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur : « Lancer » une scène qui ouvre la maison demande l\'accord à chaque fois ; « Annuler » : rien ne part ; le résultat est dit dans la fenêtre', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs, envois } = await ouvrir(1280);
  try {
    await toucher(p, 'Scène porte');
    for (let i = 0; i < 2; i++) {
      envois.length = 0; recus.length = 0;
      await p.click('dialog.sf .sf-lancer');
      await p.waitForSelector('dialog[aria-label="Confirmation"][open]');
      await p.evaluate(() => [...document.querySelectorAll('dialog[aria-label="Confirmation"] button')].find((b: any) => b.textContent === 'Annuler').click());
      await p.waitForTimeout(500);
      assert.deepEqual(envois, [{ scene: 'Scène porte' }], 'une demande, sans « confirm »'); assert.deepEqual(recus, [], 'sans accord, rien ne part');
      assert.equal(await p.evaluate(() => document.querySelector('dialog.sf[open] .sf-dit')?.textContent), 'Annulé : rien n\'est parti.', 'dit dans la fenêtre');
    }
    // Avec l'accord : elle part, et le résultat est dit dans la fenêtre.
    envois.length = 0; recus.length = 0;
    await p.click('dialog.sf .sf-lancer'); await p.waitForSelector('dialog[aria-label="Confirmation"][open]');
    await p.evaluate(() => [...document.querySelectorAll('dialog[aria-label="Confirmation"] button')].find((b: any) => b.textContent === 'Confirmer').click());
    for (let i = 0; i < 40 && !recus.length; i++) await p.waitForTimeout(100);
    assert.deepEqual(envois, [{ scene: 'Scène porte' }, { scene: 'Scène porte', confirm: true }]); assert.equal(recus[0]?.[0], 'k1');
    for (let i = 0; i < 30 && !/lancée/.test(await p.evaluate(() => document.querySelector('dialog.sf[open] .sf-dit')?.textContent ?? '')); i++) await p.waitForTimeout(100);
    assert.equal(await p.evaluate(() => document.querySelector('dialog.sf[open] .sf-dit')?.textContent), '« Scène porte » lancée.');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : Échap, un appui ailleurs, le bouton « Fermer » ; le focus revient sur la scène ; jamais redessinée, le focus tient au redessin', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280);
  const ouverte = () => p.evaluate(() => document.querySelectorAll('dialog.sf[open]').length);
  const focusSur = () => p.evaluate(() => document.activeElement?.getAttribute('data-scene'));
  try {
    await toucher(p, 'Scène lumière');
    await p.keyboard.press('Escape'); assert.equal(await ouverte(), 0, 'Échap'); assert.equal(await focusSur(), 'Scène lumière', 'le focus revient sur la scène');
    await toucher(p, 'Scène lumière'); await p.mouse.click(3, 3); await p.waitForTimeout(200);
    assert.equal(await ouverte(), 0, 'un appui ailleurs'); assert.equal(await focusSur(), 'Scène lumière');
    await toucher(p, 'Scène lumière'); await p.click('dialog.sf .sf-fermer'); assert.equal(await ouverte(), 0, 'le bouton'); assert.equal(await focusSur(), 'Scène lumière');
    // Lancer : la page relit l'état et redessine la grille ; la fenêtre, elle, reste la même, le focus dedans.
    await toucher(p, 'Scène lumière');
    await p.evaluate(() => { window.__corps = document.querySelector('dialog.sf .sf-corps').firstElementChild; window.__grille = document.querySelector('#maison-grille'); });
    await p.focus('dialog.sf .sf-lancer'); await p.keyboard.press('Enter');
    for (let i = 0; i < 40 && (await p.evaluate(() => document.querySelector('#maison-grille') === window.__grille)); i++) await p.waitForTimeout(150);
    const apres = await p.evaluate(() => ({ redessin: document.querySelector('#maison-grille') !== window.__grille, meme: document.querySelector('dialog.sf[open] .sf-corps')?.firstElementChild === window.__corps, focus: Boolean(document.activeElement?.closest('dialog.sf')), dit: document.querySelector('dialog.sf .sf-dit')?.textContent }));
    assert.deepEqual(apres, { redessin: true, meme: true, focus: true, dit: '« Scène lumière » lancée.' });
    // Fermée après le redessin : le focus revient sur la scène de même nom (le bouton a été refait).
    await p.keyboard.press('Escape'); assert.equal(await focusSur(), 'Scène lumière');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : le focus posé sur une scène de la carte tient au redessin automatique (le bouton refait, de même nom)', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(1280);
  try {
    await p.focus('#maison-grille .scenes-carte button.scene[data-scene="Scène porte"]');
    await p.evaluate(() => { window.__bouton = document.activeElement; window.__grille = document.querySelector('#maison-grille'); document.dispatchEvent(new Event('visibilitychange')); });
    for (let i = 0; i < 40 && (await p.evaluate(() => document.querySelector('#maison-grille') === window.__grille)); i++) await p.waitForTimeout(150);
    const apres = await p.evaluate(() => ({ redessin: document.querySelector('#maison-grille') !== window.__grille, refait: document.activeElement !== window.__bouton, focus: document.activeElement?.getAttribute('data-scene') }));
    assert.deepEqual(apres, { redessin: true, refait: true, focus: 'Scène porte' });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, tablette « maison » à 390 px : l\'étape d\'une autre appli est « une action dans Odin » ; une scène qui ouvre la maison ne se lance pas d\'ici', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs, envois } = await ouvrir(390, { cle: cleMaison });
  try {
    await toucher(p, 'Scène lumière');
    const a = await vuFenetre(p) as any;
    assert.deepEqual(a.etapes, ['Appareil l1 → allumé', 'une action dans Odin']); assert.doesNotMatch(a.texte, /Hestia|Thème|verre/);
    await p.keyboard.press('Escape'); await toucher(p, 'Scène porte');
    const b = await vuFenetre(p) as any;
    assert.equal(b.lancer, 'éteint'); assert.match(b.texte, /depuis Odin/); assert.deepEqual(b.petits, []); assert.equal(b.deborde, false);
    // Éteint, « Lancer » ne se lit plus comme le bouton principal : pas le fond de l'accent.
    const fonds = await p.evaluate(() => { const t = document.createElement('button'); t.className = 'btn primary'; document.querySelector('dialog.sf .acts').append(t); const r = { eteint: getComputedStyle(document.querySelector('dialog.sf .sf-lancer')).backgroundColor, accent: getComputedStyle(t).backgroundColor }; t.remove(); return r; });
    assert.notEqual(fonds.eteint, fonds.accent, `« Lancer » éteint n'a pas le fond de l'accent (${fonds.eteint})`);
    await p.evaluate(() => document.querySelector('dialog.sf .sf-lancer').click()); await p.waitForTimeout(300);
    assert.deepEqual(envois, [], 'rien ne part');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : aucune scène, la carte dit « Aucune scène » et où les créer, sans bouton', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(390, { etat: (e) => ({ ...e, scenes: [], scenesEtapes: [] }) });
  try {
    const c = await p.evaluate(() => ({ texte: document.querySelector('#maison-grille .scenes-carte').textContent, boutons: document.querySelectorAll('#maison-grille .scenes-carte button').length }));
    assert.match(c.texte, /Aucune scène\./); assert.match(c.texte, /Crée-les dans Odin\./); assert.equal(c.boutons, 0);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : fond animé allumé, la fenêtre reste lisible (fond plein)', { skip: sansNav }, async () => {
  const { ctx, page: p, erreurs } = await ouvrir(390, { fond: true });
  try {
    await toucher(p, 'Scène lumière');
    const fond = await p.evaluate(() => getComputedStyle(document.querySelector('dialog.sf')).backgroundColor);
    assert.match(fond, /^rgb\(/, `un fond plein, sans transparence : ${fond}`);
    // Et le texte se lit sur ce fond : contraste d'au moins 4,5 pour 1 (titre, étapes, phrase).
    const rapports = await p.evaluate(`(() => {
      const lum = (c) => { const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map((x) => { const v = Number(x) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const d = document.querySelector('dialog.sf'), f = lum(getComputedStyle(d).backgroundColor);
      return [...d.querySelectorAll('#sf-titre, .sf-etapes li, .sf-corps p')].filter((n) => n.textContent.trim()).map((n) => { const t = lum(getComputedStyle(n).color); return (Math.max(t, f) + 0.05) / (Math.min(t, f) + 0.05); });
    })()`) as number[];
    assert.ok(rapports.length >= 3, 'des textes mesurés');
    for (const r of rapports) assert.ok(r >= 4.5, `contraste ${r.toFixed(2)} pour 1`);
    if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/maison-scene-fond-390.png` });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
