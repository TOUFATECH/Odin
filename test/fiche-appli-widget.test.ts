// La fiche d'une appli (src/web/pages/fiche-appli.js) : « Mettre en widget sur : l'accueil » (maquette validée « Accueil »,
// la fiche ouverte depuis « Toutes les applis »).
// - Le bouton pose le widget « appli » de CETTE appli (le même que sa ligne dans « Ajouter un widget » : fenetre.js) à la
//   fin de la page ouverte de l'accueil, et Odin le garde ; un second appui ne pose pas de doublon, et le dit.
// - « L'écran de la maison » n'est pas proposé : cet écran ne reçoit ni ne dessine aujourd'hui le widget d'une appli
//   (prouvé plus bas par sa route) ; aucun bouton mort, aucun bouton grisé.
// - Les « Actions rapides » (maquette : la fiche d'une appli) : au propriétaire seul, les actions rapides de CETTE appli,
//   choisies par la règle de sa page (valhalla.js, actionsRapides : celle de sa barre de boutons ; la fiche ne la recopie
//   pas), trois au plus comme son widget ; un appui la lance par l'action de l'appli (POST /api/valhalla/act) ; une
//   action grave redemande l'accord À CHAQUE FOIS (sans accord, rien ne part) ; le résultat est dit dans la fiche.
//   Appli désactivée ou sans action rapide : pas de bloc. Un membre et une tablette : pas de bloc ; requêtes rejouées.
// - Qui voit quoi : un membre voit la fiche d'aujourd'hui, rien de plus (ranger l'accueil est au propriétaire seul : le
//   serveur le refuse, requête rejouée à la main) ; une tablette n'a pas la fiche et ne range rien.
// - Chaque ligne de la fiche d'aujourd'hui reste là, dans le même ordre ; le bouton fait 44 px ; tout se fait au clavier
//   (Tab entre dans la fiche quand elle a « Mettre en widget » ; pour un membre, Tab va à l'appli suivante comme avant ;
//   Échap rend le focus à l'appli) ; rien ne déborde à 390 et 1280 px, clair et sombre ; la fiche ne couvre pas l'appli,
//   même quand son message s'écrit.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
/** Un libellé d'action piégé : il doit rester du texte (jamais une balise). */
const PIEGE = '<img src=x onerror="window.__piege=1">Piège';

/** Une appli d'essai ; `actions` : ses actions, ou une fonction qui reçoit les deux d'origine (État, Vider ⚠). */
function essai(id: string, nom: string, actions?: Module['actions'] | ((base: Module['actions']) => Module['actions']), view?: Module['view']): Module {
  const base = [
    { id: 'etat', label: 'État', what: 'Dit où elle en est.', read: true, run: () => { fait.push(`${id}:etat`); return { text: `${nom} va bien.` }; } },
    { id: 'vider', label: 'Vider', what: 'Vide tout.', grave: () => 'vider l\'appli d\'essai', run: () => { fait.push(`${id}:vider`); return { text: 'Vidé.' }; } },
  ] as Module['actions'];
  return {
    id, name: nom, family: 'Données', what: `${nom} : une appli d'essai pour la fiche.`, does: ['trier des fichiers', 'compter ce qui reste'], from: [], upstream: [], words: [],
    actions: typeof actions === 'function' ? actions(base) : actions ?? base,
    view: view ?? (() => ({ kpis: [{ label: 'Fichiers', value: '12' }], sections: [] }) as unknown as View),
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
  v = await vraiOdin(tt, { compte: true, modules: (o) => [...allModules(o).filter((m) => ['gladsheim', 'var', 'apparence'].includes(m.id)), essai('essaiw', 'Appli Essai'),
    // L'appli comparée à la règle de sa page : en tête, une action « pas rapide » et une action à réglage obligatoire,
    // que la barre de sa page n'offre pas (relecture : sans elles, l'essai ne voyait pas un tri différent).
    essai('essaip', 'Appli Pas Pour Lui', (base) => [
      { id: 'regler', label: 'Régler', what: 'Règle.', quick: false, run: () => { fait.push('essaip:regler'); return { text: 'Réglé.' }; } },
      { id: 'chercher', label: 'Chercher', what: 'Cherche.', params: [{ key: 'q', label: 'Quoi', kind: 'text', required: true }], run: () => { fait.push('essaip:chercher'); return { text: 'Trouvé.' }; } },
      ...base] as Module['actions']),
    // Une appli dont la page a « Sur quel poste ? », et une action rapide au poste facultatif (comme l'analyse d'un
    // antivirus) : son run dit sur quel poste elle est partie.
    essai('essaiq', 'Appli Postes', [
      { id: 'compter', label: 'Compter', what: 'Compte.', params: [{ key: 'poste', label: 'Poste', kind: 'text' }], run: (_c: unknown, i: Record<string, unknown>) => { fait.push(`essaiq:compter:${typeof i?.poste === 'string' && i.poste ? i.poste : 'ici'}`); return { text: 'Compté.' }; } },
    ] as Module['actions'], (_c, q) => ({ postes: { actuel: q.get('poste') ?? '', choix: [{ id: '', nom: 'Cette machine' }, { id: 'pc-b', nom: 'Poste B' }] }, sections: [] }) as unknown as View),
    // Sans action rapide : une action marquée « pas rapide », une autre qui demande un réglage obligatoire.
    essai('essair', 'Appli Sans Rapide', [
      { id: 'regler', label: 'Régler', what: 'Règle.', quick: false, run: () => { fait.push('essair:regler'); return { text: 'Réglé.' }; } },
      { id: 'chercher', label: 'Chercher', what: 'Cherche.', params: [{ key: 'q', label: 'Quoi', kind: 'text', required: true }], run: () => { fait.push('essair:chercher'); return { text: 'Trouvé.' }; } },
    ] as Module['actions']),
    essai('essaid', 'Appli Endormie'),
    essai('essaix', 'Appli Piege', [{ id: 'piege', label: PIEGE, what: 'Piège.', run: () => { fait.push('essaix:piege'); return { text: '<b>gras</b> reste du texte' }; } }] as Module['actions'])] });
  const va = valhallaOf()!;
  assert.equal((await va.activer('essaid', false)).ok, true, 'une appli désactivée');
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

test('serveur, actions rapides (requêtes rejouées à la main) : une action grave sans accord ne part jamais ; un membre est refusé hors de ses applis et pour une action grave ; une tablette est refusée', async () => {
  fait.length = 0;
  // Le propriétaire lui-même : sans « confirm », l'action grave n'est pas lancée, le serveur demande l'accord.
  const p = await v.json('/api/valhalla/act', { module: 'essaiw', action: 'vider', input: {} });
  assert.equal(typeof p.body.confirm, 'string', 'l\'accord est demandé'); assert.notEqual(p.body.ok, true);
  // Un membre : sur une appli où il n'a pas le droit, refusé ; une action grave, même avec « confirm », refusée.
  const m1 = await v.json('/api/valhalla/act', { module: 'essaip', action: 'etat', input: {} }, { cookie: membreCookie });
  assert.equal(m1.status, 403); assert.notEqual(m1.body.ok, true);
  const m2 = await v.json('/api/valhalla/act', { module: 'essaiw', action: 'vider', input: {}, confirm: true }, { cookie: membreCookie });
  assert.equal(m2.status, 403); assert.notEqual(m2.body.ok, true);
  // Une tablette « maison » : refusée, grave ou non.
  for (const action of ['etat', 'vider']) {
    const t = await v.json('/api/valhalla/act', { module: 'essaiw', action, input: {}, confirm: true }, { cookie: '', 'x-odin-maison': cleMaison });
    assert.notEqual(t.body.ok, true, `une tablette : ${action} refusé`);
  }
  assert.deepEqual(fait, [], 'rien n\'est parti');
});

test('la fiche : la règle des actions rapides n\'y est pas recopiée (celle de la page, valhalla.js) ; le libellé d\'une action est posé en texte', () => {
  assert.doesNotMatch(FICHE, /\.quick\b|required/, 'aucun tri d\'actions écrit dans la fiche');
  assert.match(FICHE, /OdinApps/, 'la fiche reprend la règle et le lancement de la page');
  const VA = lire('src/web/valhalla.js');
  // Une seule règle : la barre de la page s'en sert, et la page la rend à la fiche.
  assert.equal((VA.match(/a\.quick !== false/g) ?? []).length, 1, 'la règle est écrite une fois');
  assert.match(VA, /const quick = actionsRapides\(/);
  assert.doesNotMatch(FICHE, /innerHTML\s*=\s*[^;]*label/, 'aucun libellé posé en HTML');
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
async function applis(largeur: number, sombre: boolean, cookie = v.session, hauteur?: number) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: hauteur ?? (doigt ? 800 : 900) }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
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
  await p.evaluate((n: string) => ([...document.querySelectorAll('#v-apps .va-appbtn')].find((b: any) => [...b.querySelectorAll(':scope > span')].some((s: any) => s.textContent === n)) as any).focus(), nom); // une tuile désactivée porte un mot de plus après le nom
  await p.waitForSelector('#odinFiche:not([hidden]) .fa', { timeout: 10000 });
}
/** Ce que la fiche montre, dans l'ordre. */
const fiche = (p: Page) => p.evaluate(() => {
  const f = document.querySelector('#odinFiche:not([hidden]) .fa'); if (!f) return null;
  const r = f.getBoundingClientRect(), txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const poser = f.querySelector('.fa-poser'), pr = poser?.getBoundingClientRect();
  return {
    lignes: [...f.querySelectorAll('h3, .fa-fam, .fa-etat, .fa-phrase, .fa-faire h4, .fa-orig h4, .fa-alt > b, .fa-ouvrir, .fa-mettre h4, .fa-poser, .fa-rapides-t')].map((n: any) => { const c = String(n.className || '').split(' ').find((x) => x.startsWith('fa-')); return c ? `${n.tagName.toLowerCase()}.${c}` : n.tagName.toLowerCase(); }),
    texte: txt(f), boutons: [...f.querySelectorAll('button')].map(txt),
    poser: poser ? { texte: txt(poser), nom: poser.getAttribute('aria-label'), haut: Math.round(pr.height), large: Math.round(pr.width) } : null,
    dit: txt(f.querySelector('.fa-dit')),
    // Les actions rapides : le texte de chaque bouton, son action, sa taille, et ce que la fiche dit après un appui.
    rapides: [...f.querySelectorAll('.fa-rapide')].map((b: any) => { const x = b.getBoundingClientRect(); const st = getComputedStyle(b); return { texte: txt(b), action: b.dataset.action, haut: Math.round(x.height), large: Math.round(x.width), marge: Math.min(parseFloat(st.paddingTop), parseFloat(st.paddingBottom)) }; }),
    ditRapide: txt(f.querySelector('.fa-rapides .fa-dit')),
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
      // Suit le code : la fiche du propriétaire porte maintenant ses « Actions rapides », APRÈS « Mettre en widget »
      // (avant : « aucune action rapide », et seulement « Ouvrir » et « L'accueil »). Les boutons d'avant restent les deux
      // premiers, dans le même ordre ; les actions viennent ensuite, et rien d'autre (aucun bouton mort).
      assert.match(f.texte, /Actions rapides/);
      assert.deepEqual(f.boutons.slice(0, 2), ['Ouvrir Appli Essai', 'L\'accueil'], 'les boutons d\'avant en tête, dans le même ordre');
      assert.deepEqual(f.boutons.slice(2), f.rapides.map((x) => x.texte), 'après eux, seulement les actions rapides (vérifiées une à une plus bas)');
      assert.ok(f.lignes.indexOf('button.fa-poser') < f.lignes.indexOf('h4.fa-rapides-t'), 'les actions viennent après « Mettre en widget »');
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

// ------------------------------------------------------------------ les actions rapides, dans le navigateur

/** Ce que dit le bloc des actions une fois l'action finie (ni vide, ni « Un instant… »), puis remis à vide. */
async function ditRapideApres(p: Page): Promise<string> {
  await p.waitForFunction(() => { const t = document.querySelector('#odinFiche .fa-rapides .fa-dit')?.textContent ?? ''; return t !== '' && !/…$/.test(t); }, undefined, { timeout: 20000 });
  return p.evaluate(() => { const n = document.querySelector('#odinFiche .fa-rapides .fa-dit'); const t = n.textContent; n.textContent = ''; return t; });
}
const dialogue = (p: Page) => p.evaluate(() => Boolean(document.querySelector('.odlg-bg .odlg[role=alertdialog]')));

test('navigateur : les actions rapides de la fiche sont celles que la règle existante donne — la barre de la page de l\'appli et son widget', { skip: sansNav }, async () => {
  await remettre();
  const { ctx, page: p, erreurs } = await applis(1280, false);
  try {
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaip') === true, undefined, { timeout: 30000 });
    await ficheAuClavier(p, 'Appli Pas Pour Lui');
    const f = (await fiche(p))!;
    assert.ok(f.rapides.length > 0, 'des actions rapides');
    // Suit la relecture : l'appli comparée a en tête une action « pas rapide » et une action à réglage obligatoire ; la
    // fiche ne les offre pas, comme la barre de sa page (comparée juste après). La comparaison avec le widget de la même
    // appli est l'essai « à faire » qui suit : le tri du widget, côté serveur, s'écarte de celui de la page.
    // La barre de boutons de la page de l'appli.
    await p.evaluate(() => { window.location.hash = '#app=essaip'; });
    await p.waitForSelector('#v-app .va-acts-bar button', { timeout: 30000 });
    const barre = await p.evaluate(() => [...document.querySelectorAll('#v-app .va-acts-bar button')].map((b: any) => b.textContent.replace(/\s+/g, ' ').trim())) as string[];
    assert.deepEqual(f.rapides.map((x) => x.texte), barre.slice(0, 3), 'les mêmes que la barre de sa page (trois au plus)');
    assert.ok(barre.length > 0 && !barre.some((t) => /^(Régler|Chercher)/.test(t)), 'la barre n\'a ni l\'action « pas rapide » ni celle à réglage obligatoire');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// À faire (hors de ce lot) : le widget d'une appli trie ses actions côté serveur sans écarter une action « pas rapide »
// ni une action à réglage obligatoire (src/valhalla/widgets/applis.ts) ; la fiche suit la règle de la page. Cet essai
// reste « à faire » tant que les deux ne donnent pas les mêmes actions pour la même appli.
test('navigateur : les actions rapides de la fiche sont celles du widget de la même appli', { skip: sansNav, todo: 'le tri du widget (côté serveur) s\'écarte de la règle de la page' }, async () => {
  await remettre();
  const { ctx, page: p } = await applis(1280, false);
  try {
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaip') === true, undefined, { timeout: 30000 });
    await ficheAuClavier(p, 'Appli Pas Pour Lui');
    const f = (await fiche(p))!;
    const w = await v.json(`/api/widgets/donnees?page=${PAGE}`);
    const wa = ((w.body.widgets as Array<{ id: string; donnee?: { actions?: Array<{ label: string; grave: boolean }> } }>).find((x) => x.id === 'c8e00001')?.donnee?.actions ?? []);
    assert.ok(wa.length > 0, 'le widget a ses actions');
    assert.deepEqual(f.rapides.map((x) => x.texte), wa.map((a) => `${a.label}${a.grave ? ' ⚠' : ''}`), 'les mêmes que le widget');
  } finally { await ctx.close(); }
});

test('navigateur, 320 × 568 et 390 × 640, sombre : la fiche aux actions rapides tient dans l\'écran ; elle défile en elle-même, son résultat écrit s\'atteint', { skip: sansNav }, async () => {
  for (const [largeur, hauteur] of [[320, 568], [390, 640]] as const) {
    await remettre(); fait.length = 0;
    const { ctx, page: p, erreurs } = await applis(largeur, true, v.session, hauteur);
    try {
      await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaiw') === true, undefined, { timeout: 30000 });
      // Une fiche aussi remplie que celle d'une vraie appli (quatre choses à faire, cinq alternatives et le reste, trois
      // actions), sous une tuile en haut de l'écran (troisième regard : 619 px à 320 × 568).
      await p.evaluate(() => {
        const b = document.createElement('button'); b.id = 'ancreHaut'; b.type = 'button'; b.textContent = 'Appli Essai';
        b.style.cssText = 'position:fixed;left:8px;top:8px;width:92px;height:92px;z-index:1';
        document.body.append(b);
        window.OdinFicheAppli.montrer({ id: 'essaiw', name: 'Appli Essai', family: 'Données', what: 'Appli Essai : une appli d\'essai pour la fiche.',
          survol: { phrase: 'Une appli d\'essai qui range, trie et compte tes fichiers, et te dit ce qui reste à faire chaque jour.', faire: ['Trier des fichiers par dossier et par date', 'Compter ce qui reste dans chaque dossier', 'Retrouver un fichier par son nom', 'Vider ce qui ne sert plus, avec ton accord'] },
          similaires: ['Logiciel Un', 'Logiciel Deux', 'Logiciel Trois', 'Logiciel Quatre', 'Logiciel Cinq', 'Logiciel Six', 'Logiciel Sept'],
          actions: [{ id: 'etat', label: 'État' }, { id: 'vider', label: 'Vider', grave: true }, { id: 'etat', label: 'Où elle en est, en détail, dossier par dossier' }] }, b, {});
      });
      await p.waitForSelector('#odinFiche:not([hidden]) .fa-rapide', { timeout: 10000 });
      await p.evaluate(() => (document.querySelector('#odinFiche .fa-rapide[data-action="etat"]') as any).click());
      await p.waitForFunction(() => /va bien/.test(document.querySelector('#odinFiche .fa-rapides .fa-dit')?.textContent ?? ''), undefined, { timeout: 20000 });
      const m = await p.evaluate(() => {
        const f = document.querySelector('#odinFiche:not([hidden]) .fa'), d = f.querySelector('.fa-rapides .fa-dit');
        const entiere = f.scrollHeight;
        d.scrollIntoView({ block: 'nearest' });
        const r = f.getBoundingClientRect(), x = d.getBoundingClientRect();
        return { entiere, dedans: r.top >= -1 && r.bottom <= innerHeight + 1, ditVu: x.top >= r.top - 1 && x.bottom <= r.bottom + 1 && x.bottom <= innerHeight + 1, f: [Math.round(r.top), Math.round(r.bottom)], h: innerHeight };
      });
      assert.ok(m.entiere > m.h - 16, `${largeur} × ${hauteur} : la fiche entière ne tient pas dans l'écran (le cas à voir) ${JSON.stringify(m)}`);
      assert.equal(m.dedans, true, `${largeur} × ${hauteur} : la fiche reste dans l'écran ${JSON.stringify(m)}`);
      assert.equal(m.ditVu, true, `${largeur} × ${hauteur} : le résultat écrit s'atteint ${JSON.stringify(m)}`);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/fiche-actions-petit-${largeur}x${hauteur}.png` });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); await remettre(); }
  }
});

test('navigateur, 390 px : l\'appli au milieu de l\'écran, la fiche aux actions rapides ne la couvre pas (elle défile en elle-même) et ses boutons s\'atteignent', { skip: sansNav }, async () => {
  await remettre();
  const { ctx, page: p, erreurs } = await applis(390, false);
  try {
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaiw') === true, undefined, { timeout: 30000 });
    // Une tuile de 92 px au milieu de l'écran (800 px de haut) : la fiche entière ne tient ni au-dessus ni au-dessous.
    await p.evaluate(() => {
      const b = document.createElement('button'); b.id = 'ancreMilieu'; b.type = 'button'; b.textContent = 'Appli Essai';
      b.style.cssText = 'position:fixed;left:16px;top:354px;width:92px;height:92px;z-index:1';
      document.body.append(b);
      window.OdinFicheAppli.montrer({ id: 'essaiw', name: 'Appli Essai', family: 'Données', what: 'Appli Essai : une appli d\'essai pour la fiche.', does: ['trier des fichiers', 'compter ce qui reste'], actions: [{ id: 'etat', label: 'État' }, { id: 'vider', label: 'Vider', grave: true }] }, b, {});
    });
    await p.waitForSelector('#odinFiche:not([hidden]) .fa-rapide', { timeout: 10000 });
    const m = await p.evaluate(() => {
      const f = document.querySelector('#odinFiche:not([hidden]) .fa'), a = document.querySelector('#ancreMilieu').getBoundingClientRect(), r = f.getBoundingClientRect();
      const l = [...f.querySelectorAll('.fa-rapide')].pop() as any; l.focus();
      const x = l.getBoundingClientRect();
      return { couvre: r.left < a.right && a.left < r.right && r.top < a.bottom && a.top < r.bottom, dedans: r.top >= -1 && r.bottom <= innerHeight + 1, defile: f.scrollHeight > f.clientHeight, dernierVu: x.top >= r.top - 1 && x.bottom <= r.bottom + 1, f: [Math.round(r.top), Math.round(r.bottom)], a: [Math.round(a.top), Math.round(a.bottom)] };
    });
    assert.equal(m.defile, true, `la fiche entière ne tient pas : elle défile ${JSON.stringify(m)}`);
    assert.equal(m.couvre, false, `la fiche ne couvre pas l'appli ${JSON.stringify(m)}`);
    assert.equal(m.dedans, true, 'elle reste dans l\'écran');
    assert.equal(m.dernierVu, true, 'le dernier bouton, atteint au clavier, se voit dans la fiche');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); await remettre(); }
});

test('navigateur : une action rapide qui ne répond jamais ne garde pas ouverte la fiche d\'une autre appli', { skip: sansNav }, async () => {
  await remettre();
  const { ctx, page: p, erreurs } = await applis(1280, false);
  try {
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaiw') === true, undefined, { timeout: 30000 });
    // Le lancement reste en attente pour toujours (un réseau qui ne répond plus).
    await p.evaluate(() => { window.OdinApps.lancer = () => new Promise(() => {}); });
    await ficheAuClavier(p, 'Appli Essai');
    await p.evaluate(() => (document.querySelector('#odinFiche .fa-rapide[data-action="etat"]') as any).click());
    // La fiche reste ouverte pendant que l'action attend : son résultat n'est pas perdu.
    await p.evaluate(() => window.OdinFicheAppli.cacher());
    await p.waitForTimeout(500);
    assert.equal(await p.evaluate(() => document.querySelector('#odinFiche')?.hidden), false, 'la fiche de l\'action en cours reste ouverte');
    // Une autre appli : sa fiche se ferme comme d'habitude.
    await ficheAuClavier(p, 'Appli Sans Rapide');
    await p.evaluate(() => window.OdinFicheAppli.cacher());
    await p.waitForFunction(() => document.querySelector('#odinFiche')?.hidden === true, undefined, { timeout: 5000 }).catch(() => undefined);
    assert.equal(await p.evaluate(() => document.querySelector('#odinFiche')?.hidden), true, 'la fiche de l\'autre appli se ferme');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : une action rapide de la fiche part sur la machine d\'Odin, même si sa page avait choisi un autre poste plus tôt', { skip: sansNav }, async () => {
  await remettre(); fait.length = 0;
  const { ctx, page: p, erreurs } = await applis(1280, false);
  try {
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaiq') === true, undefined, { timeout: 30000 });
    // Sa page : « Sur quel poste ? » → « Poste B ».
    await p.evaluate(() => { window.location.hash = '#app=essaiq'; });
    await p.waitForSelector('#v-app .va-postes .va-poste', { timeout: 30000 });
    await p.evaluate(() => ([...document.querySelectorAll('#v-app .va-postes .va-poste')].find((b: any) => /Poste B/.test(b.textContent)) as any).click());
    await p.waitForFunction(() => /true/.test(([...document.querySelectorAll('#v-app .va-postes .va-poste')].find((b: any) => /Poste B/.test(b.textContent)) as any)?.getAttribute('aria-pressed') ?? ''), undefined, { timeout: 20000 });
    // Retour à la page Applis : la fiche de la même appli, son action rapide.
    await p.evaluate(() => window.OdinShow('apps'));
    await p.waitForFunction(() => [...document.querySelectorAll('#v-apps .va-appbtn')].some((b: any) => b.getClientRects().length > 0), undefined, { timeout: 30000 });
    await ficheAuClavier(p, 'Appli Postes');
    await p.evaluate(() => (document.querySelector('#odinFiche .fa-rapide[data-action="compter"]') as any).click());
    await p.waitForFunction(() => /Compté/.test(document.querySelector('#odinFiche .fa-rapides .fa-dit')?.textContent ?? ''), undefined, { timeout: 20000 });
    assert.deepEqual(fait, ['essaiq:compter:ici'], 'l\'action est partie sur la machine d\'Odin, pas sur le poste choisi plus tôt dans sa page');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('les actions réservées à l\'écran « Sur quel poste ? » d\'une page ont un réglage obligatoire : la fiche, qui ne connaît pas cette réserve, ne les offre pas', () => {
  // La fiche passe à la règle de la page les actions de l'appli sans sa vue : l'action que la page réserve à son écran
  // « Sur quel poste ? » (view.postes.ensuite.action) n'en est écartée que parce qu'elle a un réglage obligatoire. Cet
  // essai fige ce fait pour chaque vraie appli qui a une telle réserve.
  const dossier = new URL('../src/valhalla/modules/', import.meta.url);
  const reserves: Array<[string, string]> = [];
  for (const f of readdirSync(dossier)) if (f.endsWith('.ts')) for (const x of readFileSync(new URL(f, dossier), 'utf8').matchAll(/ensuite:\s*\{[^}]*?\baction:\s*'([\w-]+)'/g)) reserves.push([f, x[1]]);
  assert.ok(reserves.length > 0, 'au moins une réserve trouvée');
  const tous = allModules(v.o);
  for (const [f, action] of reserves) {
    const a = tous.flatMap((m) => m.actions).find((x) => x.id === action);
    assert.ok(a, `${f} : l'action ${action} existe`);
    assert.ok((a!.params ?? []).some((q) => q.required), `${f} : l'action réservée ${action} a un réglage obligatoire`);
  }
});

for (const [largeur, sombre] of [[1280, false], [1280, true], [390, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : une action rapide part par l'action de l'appli et le résultat est dit ; une action grave redemande l'accord à chaque fois ; au clavier ; rien ne déborde`, { skip: sansNav }, async () => {
    await remettre(); fait.length = 0;
    const { ctx, page: p, erreurs } = await applis(largeur, sombre);
    try {
      await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essaiw') === true, undefined, { timeout: 30000 });
      await ficheAuClavier(p, 'Appli Essai');
      const f = (await fiche(p))!;
      assert.match(f.texte, /Actions rapides/);
      for (const b of f.rapides) assert.ok(b.haut >= 44 && b.large >= 44, `${b.texte} : 44 px au moins (${b.large} × ${b.haut})`);
      // Un libellé sur deux lignes ne colle pas aux bords haut et bas de son bouton (troisième regard).
      for (const b of f.rapides) assert.ok(b.marge >= 6, `${b.texte} : 6 px au moins en haut et en bas (${b.marge})`);
      assert.equal(f.dedans, true, 'la fiche reste dans l\'écran'); assert.equal(f.enfants, true); assert.equal(f.deborde, false);
      const sur = f.rapides.find((x) => !/⚠/.test(x.texte))!, grave = f.rapides.find((x) => /⚠/.test(x.texte))!;
      assert.ok(sur && grave, 'une action simple et une action grave');
      // Au clavier : Tab entre dans la fiche, puis « Ouvrir », « L'accueil », et les actions.
      for (let i = 0; i < 2 + f.rapides.indexOf(sur) + 1; i++) await p.keyboard.press('Tab');
      assert.deepEqual(await actif(p), { classe: 'btn fa-rapide', texte: sur.texte, dansFiche: true });
      await p.keyboard.press('Enter');
      assert.match(await ditRapideApres(p), /va bien/, 'le résultat de l\'action est dit dans la fiche');
      assert.deepEqual(fait, [`essaiw:${sur.action}`], 'l\'action de l\'appli est partie, une fois');
      assert.deepEqual(await actif(p), { classe: 'btn fa-rapide', texte: sur.texte, dansFiche: true }, 'le focus reste sur le bouton');
      // L'action grave : l'accord est demandé ; Échap annule, rien ne part, la fiche reste ouverte.
      await p.evaluate((t: string) => ([...document.querySelectorAll('#odinFiche .fa-rapide')].find((b: any) => b.textContent.replace(/\s+/g, ' ').trim() === t) as any).focus(), grave.texte);
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => Boolean(document.querySelector('.odlg-bg .odlg[role=alertdialog]')), undefined, { timeout: 10000 });
      await p.keyboard.press('Escape');
      assert.match(await ditRapideApres(p), /Annul/);
      assert.deepEqual(fait, [`essaiw:${sur.action}`], 'sans accord, rien n\'est parti');
      assert.equal(await p.evaluate(() => document.querySelector('#odinFiche')?.hidden), false, 'la fiche est restée ouverte');
      assert.deepEqual(await actif(p), { classe: 'btn fa-rapide', texte: grave.texte, dansFiche: true }, 'le focus revient au bouton');
      // Un second appui : l'accord est redemandé (il n'est pas gardé) ; cette fois accordé.
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => Boolean(document.querySelector('.odlg-bg .odlg[role=alertdialog]')), undefined, { timeout: 10000 });
      await p.click('.odlg-bg .odlg-btn.ok');
      await p.waitForFunction(() => /Vidé/.test(document.querySelector('#odinFiche .fa-rapides .fa-dit')?.textContent ?? ''), undefined, { timeout: 20000 });
      const h = (await fiche(p))!;
      assert.equal(h.dedans, true, 'le résultat écrit, la fiche reste dans l\'écran'); assert.equal(h.deborde, false);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/fiche-actions-dit-${largeur}${sombre ? '-sombre' : ''}.png` });
      assert.match(await ditRapideApres(p), /Vidé/);
      assert.deepEqual(fait, [`essaiw:${sur.action}`, `essaiw:${grave.action}`], 'l\'action grave est partie une fois, avec l\'accord');
      assert.equal(await dialogue(p), false);
      // Un troisième appui : l'accord est encore demandé.
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => Boolean(document.querySelector('.odlg-bg .odlg[role=alertdialog]')), undefined, { timeout: 10000 });
      await p.click('.odlg-bg .odlg-btn.non');
      assert.match(await ditRapideApres(p), /Annul/);
      assert.equal(fait.length, 2, 'rien de plus');
      // Un message écrit : la fiche est toujours dans l'écran, rien ne déborde.
      await p.evaluate(() => { document.querySelector('#odinFiche .fa-rapides .fa-dit').textContent = 'Un message assez long pour tenir sur plusieurs lignes dans la fiche, sans jamais la faire sortir de l\'écran ni déborder sur le côté.'; });
      await p.waitForTimeout(50);
      const g = (await fiche(p))!;
      assert.equal(g.enfants, true); assert.equal(g.deborde, false);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/fiche-actions-${largeur}${sombre ? '-sombre' : ''}.png` });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); await remettre(); }
  });
}

test('navigateur : une appli sans action rapide, une appli désactivée : pas de bloc (ni titre seul, ni bouton mort) ; un libellé piégé reste du texte', { skip: sansNav }, async () => {
  await remettre(); fait.length = 0;
  const { ctx, page: p, erreurs } = await applis(1280, true);
  try {
    await p.waitForFunction(() => window.OdinFenetre?.peutPoser?.('essair') === true, undefined, { timeout: 30000 });
    for (const nom of ['Appli Sans Rapide', 'Appli Endormie']) {
      await ficheAuClavier(p, nom);
      const f = (await fiche(p))!;
      assert.doesNotMatch(f.texte, /Actions rapides/, `${nom} : pas de titre`);
      assert.deepEqual(f.rapides, [], `${nom} : aucun bouton d'action`);
      assert.equal(await p.evaluate(() => document.querySelector('#odinFiche .fa-rapides')), null);
      await p.keyboard.press('Escape');
    }
    await ficheAuClavier(p, 'Appli Piege');
    const f = (await fiche(p))!;
    assert.deepEqual(f.rapides.map((x) => x.texte), [PIEGE], 'le libellé, tel quel, en texte');
    assert.equal(await p.evaluate(() => document.querySelectorAll('#odinFiche img').length), 0, 'aucune balise posée');
    await p.click('#odinFiche .fa-rapide');
    assert.equal(await ditRapideApres(p), '<b>gras</b> reste du texte', 'la réponse aussi reste du texte');
    assert.equal(await p.evaluate(() => (window as any).__piege), undefined);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
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
