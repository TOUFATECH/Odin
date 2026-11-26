// Le widget « Raccourcis d'applis » (maquette validée « Accueil », le widget « launcher ») : la famille « applis »
// (src/valhalla/widgets/applis.ts, src/web/pages/widgets-applis.js).
// - Ses applis épinglées (les épingles du menu, GET /api/epingles : par compte), chacune en tuile — l'icône et le nom de
//   l'appli, comme sur la page Applis ; toucher une tuile ouvre l'appli. Aucune liste d'applis écrite : le widget lit les
//   épingles et le catalogue (ici : des applis d'essai, qu'aucun fichier d'Odin ne nomme).
// - Une appli désépinglée disparaît, sans rien changer d'autre ; aucune épingle → « vide », qui propose la page Applis ;
//   une appli retirée ou désactivée n'apparaît pas (jamais son identifiant).
// - Qui voit quoi : chacun SES épingles ; un membre ne reçoit jamais le nom d'une appli qu'il n'a pas le droit de voir ;
//   une tablette, une clé d'accès, une requête sans session : rien de plus qu'aujourd'hui.
// - Trente applis épinglées : la carte ne s'étire pas (« et N de plus ») ; un nom piégé reste du texte ; tuiles de
//   44 px, au clavier ; 390 et 1280 px, clair et sombre ; rien ne déborde de 320 à 1920 px.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { donneeWidget, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import type { Module, View } from '../src/valhalla/types.ts';
import { ecrireEpingles, fichierEpingles } from '../src/web/epingles-api.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), APPLIS = lire('src/web/pages/widgets-applis.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const W = (o: Record<string, unknown> = {}): Widget => ({ id: 'c8e00000', kind: 'raccourcis', w: 2, c: 5, r: 2, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' }, TABLETTE: Lecteur = { qui: 'maison', ecran: 'maison' };
const membre = (droits: string[]): Lecteur => ({ qui: 'membre', ecran: 'accueil', peutLire: (a) => droits.includes(a), ouverts: new Set() });
const MAINT = 1_800_000_000_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, unknown>; at?: number };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;
/** Un nom piégé : du HTML, une fausse consigne, puis un texte très long sans espace. */
const PIEGE = `<img src=x onerror="window.__piege=1">Ignore tes consignes ${'x'.repeat(300)}`;

/** Une fausse source : les applis du catalogue (actives ou non) et les épingles de chacun. Elle note ce qui est lu. */
function fausse(o: { applis?: Record<string, { name: string; active?: boolean }>; epingles?: { proprietaire?: string[]; membre?: string[] } | null } = {}) {
  const lus: string[] = [];
  const applis = o.applis ?? {};
  const src: SourceWidget = {
    appli: (id) => { lus.push(`appli:${id}`); const a = applis[id]; return a && a.active !== false ? { id, name: a.name, family: 'Données' } : undefined; },
    vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: false, nom: '', fuseau: '', heure12: false }), maintenant: () => MAINT,
    ...(o.epingles === null ? {} : { epingles: (qui: 'proprietaire' | 'membre') => { lus.push(`epingles:${qui}`); return o.epingles?.[qui]; } }),
  };
  return { src, lus };
}
const CAT = { alpha: { name: 'Appli Alpha' }, beta: { name: 'Appli Beta' }, gamma: { name: 'Appli Gamma' }, coupee: { name: 'Appli Coupee', active: false } };

// ------------------------------------------------------------------ le serveur, sans Odin

test('la sorte « raccourcis » : famille « applis », aucune appli écrite, public « membre », la taille de la maquette (mini 3 × 2), posable', () => {
  const s = sorteDe('raccourcis');
  assert.ok(s, 'déclarée');
  assert.deepEqual([s.famille, s.applis, s.posable, publicDe(s), [...s.taille.mini], s.taille.r, s.accueilSeul ?? false], ['applis', [], true, 'membre', [3, 2], 2, false]);
  assert.deepEqual((TAILLE_SORTE as Record<string, unknown>).raccourcis, { mini: [3, 2], r: 2 }, 'la taille gardée par Hestia');
  // Le widget d'une appli (l'autre sorte de la famille) ne change pas.
  const a = sorteDe('appli')!;
  assert.deepEqual([a.famille, a.applis, publicDe(a), [...a.taille.mini], a.taille.r], ['applis', 'choisie', 'membre', [3, 2], 2]);
});

test('une appli épinglée apparaît (son nom du catalogue, dans l\'ordre des épingles) ; désépinglée, elle disparaît sans rien changer d\'autre', async () => {
  const avant = await etat(W(), LUI, fausse({ applis: CAT, epingles: { proprietaire: ['beta', 'alpha'] } }).src);
  assert.equal(avant.etat, 'ok');
  assert.deepEqual(avant.donnee, { applis: [{ appli: 'beta', nom: 'Appli Beta' }, { appli: 'alpha', nom: 'Appli Alpha' }] });
  const plus = await etat(W(), LUI, fausse({ applis: CAT, epingles: { proprietaire: ['beta', 'alpha', 'gamma'] } }).src);
  assert.deepEqual((plus.donnee!.applis as unknown[]).at(-1), { appli: 'gamma', nom: 'Appli Gamma' }, 'épinglée : elle arrive');
  const apres = await etat(W(), LUI, fausse({ applis: CAT, epingles: { proprietaire: ['alpha'] } }).src);
  assert.deepEqual(apres.donnee, { applis: [{ appli: 'alpha', nom: 'Appli Alpha' }] }, 'désépinglée : elle part, le reste ne change pas');
});

test('aucune épingle → « vide » (jamais une liste inventée) ; des épingles qu\'on ne sait pas lire → « source_absente »', async () => {
  assert.deepEqual(await etat(W(), LUI, fausse({ applis: CAT, epingles: { proprietaire: [] } }).src), { etat: 'vide', raison: 'aucune_epingle' });
  assert.deepEqual(await etat(W(), LUI, fausse({ applis: CAT, epingles: {} }).src), { etat: 'source_absente', raison: 'epingles_illisibles' }, 'on ne sait pas de qui les lire');
  assert.deepEqual(await etat(W(), LUI, fausse({ applis: CAT, epingles: null }).src), { etat: 'source_absente', raison: 'pas_encore_lu' });
});

test('une appli retirée d\'Odin ou désactivée n\'apparaît pas, ni son identifiant ; seulement elles : « vide »', async () => {
  const r = await etat(W(), LUI, fausse({ applis: CAT, epingles: { proprietaire: ['partie', 'coupee', 'alpha'] } }).src);
  assert.deepEqual(r.donnee, { applis: [{ appli: 'alpha', nom: 'Appli Alpha' }] });
  assert.doesNotMatch(JSON.stringify(r), /partie|coupee|Coupee/);
  assert.deepEqual(await etat(W(), LUI, fausse({ applis: CAT, epingles: { proprietaire: ['partie', 'coupee'] } }).src), { etat: 'vide', raison: 'aucune_epingle' });
});

test('le serveur ne sert que les identifiants que la page sait ouvrir (#app=…) : la même règle des deux côtés, « et N de plus » compte juste', async () => {
  // Des applis présentes au catalogue, mais dont l'adresse ne s'ouvre pas (une lettre seule, des majuscules) : jamais servies.
  const cat = { ...CAT, x: { name: 'Appli X' }, Majuscule: { name: 'Appli Majuscule' } };
  const r = await etat(W(), LUI, fausse({ applis: cat, epingles: { proprietaire: ['x', 'Majuscule', 'alpha'] } }).src);
  assert.deepEqual(r.donnee, { applis: [{ appli: 'alpha', nom: 'Appli Alpha' }] });
  const page = /const ID_OUVRABLE = (\/[^\n]+\/);/.exec(APPLIS)?.[1];
  assert.ok(page && lire('src/valhalla/widgets/applis.ts').includes(`ID_RACCOURCI = ${page}`), 'la même règle écrite des deux côtés');
});

test('qui voit quoi : un membre a SES épingles, sans le nom d\'une appli qu\'il n\'a pas le droit de voir ; une tablette : refusée sans rien lire', async () => {
  const ep = { proprietaire: ['gamma'], membre: ['alpha', 'beta'] };
  const { src, lus } = fausse({ applis: CAT, epingles: ep });
  const m = await etat(W(), membre(['alpha']), src);
  assert.deepEqual(m.donnee, { applis: [{ appli: 'alpha', nom: 'Appli Alpha' }] }, 'ses épingles à lui, et seulement les applis où il a le droit');
  assert.doesNotMatch(JSON.stringify(m), /Beta|Gamma|beta|gamma/);
  assert.ok(lus.includes('epingles:membre') && !lus.includes('epingles:proprietaire'), 'jamais les épingles du propriétaire pour un membre');
  assert.ok(!lus.includes('appli:beta'), 'le nom d\'une appli fermée n\'est même pas lu');
  // Ses épingles ne se lisent pas (sans identité) : rien n'est montré.
  assert.equal((await etat(W(), membre(['alpha']), fausse({ applis: CAT, epingles: { proprietaire: ['alpha'] } }).src)).etat, 'source_absente');
  for (const [qui, l] of [['tablette', TABLETTE], ['tablette sur l\'accueil', { qui: 'maison', ecran: 'accueil' } as Lecteur]] as const) {
    const t = fausse({ applis: CAT, epingles: ep }), r = await etat(W(), l, t.src);
    assert.equal(r.etat, 'refuse', qui); assert.doesNotMatch(JSON.stringify(r), /Appli|alpha|gamma/, qui); assert.deepEqual(t.lus.filter((x) => x.startsWith('epingles')), [], `${qui} : aucune épingle lue`);
  }
  // L'écran de la maison (au mur, lu par toute la maison) : les épingles de personne.
  const maison = fausse({ applis: CAT, epingles: ep }), rm = await etat(W(), { qui: 'proprietaire', ecran: 'maison' }, maison.src);
  assert.equal(rm.etat, 'refuse'); assert.doesNotMatch(JSON.stringify(rm), /Appli/);
});

test('un nom piégé reste une donnée bornée ; trente applis épinglées : toutes servies (la page montre ce qui tient)', async () => {
  const applis: Record<string, { name: string }> = { piege: { name: PIEGE } };
  for (let i = 0; i < 30; i++) applis[`a${i}`] = { name: `Appli ${i}` };
  const r = await etat(W(), LUI, fausse({ applis, epingles: { proprietaire: ['piege', ...Array.from({ length: 30 }, (_, i) => `a${i}`)] } }).src);
  const l = r.donnee!.applis as Array<{ appli: string; nom: string }>;
  assert.equal(l.length, 31); assert.equal(l[0].nom.length, 40, 'nom borné à 40 signes'); assert.ok(l[0].nom.startsWith('<img src=x'), 'tel quel : c\'est la page qui le pose en texte');
});

test('la page : la famille déclare « raccourcis » au registre (taille de la maquette 5 × 2, au tiroir), la grille connaît sa taille ; aucune liste d\'applis écrite', () => {
  const win: Record<string, any> = {};
  for (const s of [APPLIS, RENDU, GRILLE]) vm.runInNewContext(s, { window: win });
  const R = win.OdinWidgetsRendu, G = win.OdinGrille, ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));
  const d = R.rendu('raccourcis');
  assert.ok(d, 'déclarée');
  assert.deepEqual(ici([d.famille, d.appli, d.petit, d.tiroir, d.vides, d.w]), ['applis', '', false, true, ['aucune_epingle'], { kind: 'raccourcis', w: 2, c: 5, r: 2, pc: 4 }]);
  assert.ok(R.posables({ proprio: false, aDroit: () => false }).some((x: any) => x.sorte === 'raccourcis'), 'au tiroir, aussi pour un membre (chacun ses épingles)');
  assert.deepEqual(ici([G.MINI.raccourcis, G.HAUTEUR.raccourcis]), [[3, 2], 2]);
  // L'appli d'une carte : seulement sa sorte « appli » ne change pas.
  assert.ok(R.rendu('appli'), 'le widget d\'une appli est toujours là');
  // Aucune liste d'applis : ni identifiant d'appli d'Odin écrit, ni la liste de la maquette.
  assert.doesNotMatch(APPLIS, /#app=(?!\$)|'(midgard|vordr|idunn|freyja|himinbjorg|brisingamen|volva|sol|skidbladnir|snotra|aegir|frigg|sindri|vidarr|gladsheim)'/);
});

// ------------------------------------------------------------------ un vrai Odin d'essai

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
let v: VraiOdin, avecDroit = '', cleMaison = '';
const MDP = 'une-pirogue-sur-le-lagon-calme';
/** Une appli d'essai : aucun fichier d'Odin ne la nomme. */
const essai = (id: string, nom: string): Module => ({ id, name: nom, family: 'Données', what: `${nom} : une appli d'essai.`, does: [], from: [], upstream: [], words: [], actions: [], view: () => ({ kpis: [], sections: [] }) as unknown as View }) as Module;
const N = 30, ESSAIS = Array.from({ length: N }, (_, i) => `essai${String(i).padStart(2, '0')}`);
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b8e00001', ID = { grand: 'c8e00001', petit: 'c8e00002', haut: 'c8e00003', vide: 'c8e00004' };
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Raccourcis', widgets: [
  { id: ID.grand, kind: 'raccourcis', w: 2, c: 5, r: 2 }, { id: ID.petit, kind: 'raccourcis', w: 1, c: 3, r: 2 },
  { id: ID.haut, kind: 'raccourcis', w: 2, c: 6, r: 3 }, { id: ID.vide, kind: 'raccourcis', w: 1, c: 3, r: 2 },
] }] });
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: { applis?: Array<{ appli: string; nom: string }> } };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };
const noms = (x?: Rendue) => (x?.donnee?.applis ?? []).map((a) => a.nom);
const epingler = async (faire: string, id: string, h: Record<string, string> = {}) => { const r = await v.json('/api/epingles', { faire, id }, h); assert.equal(r.body.ok, true, JSON.stringify(r.body)); };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => [...allModules(o).filter((m) => ['gladsheim', 'var', 'apparence'].includes(m.id)),
    essai('essaia', 'Appli Alpha'), essai('essaib', 'Appli Beta'), essai('essaic', 'Appli Fermee'), essai('essaix', 'Appli Coupee'), essai('essaip', PIEGE),
    ...ESSAIS.map((id, i) => essai(id, `Appli numéro ${i + 1}`))] });
  const va = valhallaOf()!;
  // Un membre AVEC le droit sur Alpha et Beta, SANS le droit sur « Fermee ».
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-r', nom: 'Membre R', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'essaia', 'essaib']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-r' })).ok, true);
  lierProprietaire(persona()!);
  avecDroit = await entrer('membre-r', MDP); assert.ok(avecDroit, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  assert.equal((await va.act('apparence', 'theme', { theme: 'valhalla' })).ok, true);
  va.ctx('gladsheim').saveSettings({ fenetre: undefined });
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => { await tt.end(); Object.assign(console, orig); });

test('vrai Odin : aucune appli épinglée → « vide » ; épinglée par GET/POST /api/epingles → elle apparaît ; retirée des épingles → elle part, le reste ne change pas', async () => {
  const neuf = await donnees();
  assert.deepEqual([neuf.de(ID.grand)!.etat, neuf.de(ID.grand)!.raison], ['vide', 'aucune_epingle'], 'les vues épinglées par défaut ne sont pas des applis');
  await epingler('epingler', 'appli:essaia'); await epingler('epingler', 'appli:essaib');
  assert.deepEqual(noms((await donnees()).de(ID.grand)), ['Appli Alpha', 'Appli Beta']);
  await epingler('retirer', 'appli:essaia');
  const apres = await donnees();
  assert.deepEqual(noms(apres.de(ID.grand)), ['Appli Beta'], 'désépinglée : partie, le reste tel quel');
  assert.deepEqual(apres.de(ID.grand)!.donnee, { applis: [{ appli: 'essaib', nom: 'Appli Beta' }] });
});

test('vrai Odin : une appli désactivée n\'apparaît pas, ni son identifiant ; réactivée, elle revient', async () => {
  await epingler('epingler', 'appli:essaix');
  assert.deepEqual(noms((await donnees()).de(ID.grand)), ['Appli Beta', 'Appli Coupee']);
  assert.equal((await valhallaOf()!.activer('essaix', false)).ok, true);
  try {
    const d = await donnees();
    assert.deepEqual(noms(d.de(ID.grand)), ['Appli Beta']); assert.doesNotMatch(d.corps, /essaix|Appli Coupee/);
  } finally { assert.equal((await valhallaOf()!.activer('essaix', true)).ok, true); }
  await epingler('retirer', 'appli:essaix');
});

test('vrai Odin : un membre a SES épingles, jamais celles du propriétaire ni le nom d\'une appli fermée ; une tablette, une clé d\'accès, sans session : rien', async () => {
  await epingler('epingler', 'appli:essaic'); // le propriétaire épingle une appli que le membre n'a pas le droit de voir
  const vide = await donnees({ cookie: avecDroit });
  assert.equal(vide.status, 200); assert.deepEqual([vide.de(ID.grand)!.etat, vide.de(ID.grand)!.raison], ['vide', 'aucune_epingle'], 'ses épingles à lui : aucune');
  assert.doesNotMatch(vide.corps, /Appli Fermee|Appli Beta|essaic/);
  await epingler('epingler', 'appli:essaia', { cookie: avecDroit });
  // Une appli sans le droit : la route des épingles la refuse déjà au membre.
  assert.equal((await v.json('/api/epingles', { faire: 'epingler', id: 'appli:essaic' }, { cookie: avecDroit })).body.ok, false);
  await epingler('epingler', 'appli:essaib', { cookie: avecDroit });
  const m = await donnees({ cookie: avecDroit });
  assert.deepEqual(noms(m.de(ID.grand)), ['Appli Alpha', 'Appli Beta']); assert.doesNotMatch(m.corps, /Appli Fermee|essaic/);
  // Son droit sur Beta est retiré : Beta n'apparaît plus (même épinglée).
  const va = valhallaOf()!;
  assert.equal((await va.act('var', 'retirer_acces', { appli: 'essaib', qui: '@membre-r' })).ok, true);
  try {
    const m2 = await donnees({ cookie: avecDroit });
    assert.deepEqual(noms(m2.de(ID.grand)), ['Appli Alpha']); assert.doesNotMatch(m2.corps, /Appli Beta|Appli Fermee/);
  } finally { assert.equal((await va.act('var', 'donner_acces', { appli: 'essaib', qui: '@membre-r' })).ok, true); }
  // Le propriétaire, lui, garde les siennes.
  assert.deepEqual(noms((await donnees()).de(ID.grand)), ['Appli Beta', 'Appli Fermee']);
  for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
    const r = await donnees(h);
    assert.equal(r.status, 401, qui); assert.doesNotMatch(r.corps, /Appli Alpha|Appli Beta|Appli Fermee|essaia/, `${qui} : aucune donnée`);
  }
  await epingler('retirer', 'appli:essaic');
});

// ------------------------------------------------------------------ le navigateur

declare const document: any, window: any, getComputedStyle: any, location: any, requestAnimationFrame: any;
interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; click(s: string, o?: Record<string, unknown>): Promise<void>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>; on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
  focus(s: string): Promise<void>; keyboard: { press(k: string): Promise<void> };
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;

/** Les épingles du propriétaire : le nom piégé, puis les trente applis d'essai (écrites comme Odin les garde). */
function trenteEpinglees() {
  ecrireEpingles(fichierEpingles(join(valhallaOf()!.dir, '..')), { '@proprietaire': ['appli:essaip', ...ESSAIS.map((id) => `appli:${id}`)] });
}

/** L'accueil sur la page d'essai ; le widget « vide » forcé à « aucune épingle ». */
async function ouvrir(largeur: number, sombre: boolean) {
  const doigt = largeur < 500;
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '0'); ${sombre ? 'localStorage.setItem(\'odin.theme\', \'sombre\');' : ''} } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (w.id === ID.vide ? { id: w.id, kind: w.kind, page: w.page, etat: 'vide', raison: 'aucune_epingle' } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  await p.waitForFunction(() => [...document.querySelectorAll('.fe-tab')].some((t) => t.textContent === 'Raccourcis'), undefined, { timeout: 30000 });
  await p.evaluate(() => ([...document.querySelectorAll('.fe-tab')].find((t) => t.textContent === 'Raccourcis') as any).click());
  try { await p.waitForSelector(`#feGrid .fe-w[data-id="${ID.grand}"] .wk-tuile`, { state: 'attached', timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { ctx, page: p, erreurs };
}
/** Ce que la page montre de chaque carte. */
const vu = (p: Page) => p.evaluate((ids: Record<string, string>) => {
  const vw = document.documentElement.clientWidth, txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const cartes = [...document.querySelectorAll('#feGrid > .fe-w')] as any[], hauteurs = () => cartes.map((c) => Math.round(c.getBoundingClientRect().height));
  const avec = hauteurs(); for (const n of document.querySelectorAll('#feGrid .wk-corps')) (n as any).style.display = 'none';
  const sans = hauteurs(); for (const n of document.querySelectorAll('#feGrid .wk-corps')) (n as any).style.display = '';
  const out: Record<string, any> = { etire: avec.some((h, i) => Math.abs(h - sans[i]) > 1), deborde: document.documentElement.scrollWidth > vw + 1, code: Boolean((window as any).__piege) || Boolean(document.querySelector('#feGrid img[src="x"]')) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1); };
    const k = c.querySelector('.wk-corps'), kb = k?.getBoundingClientRect();
    const tuiles = [...c.querySelectorAll('.wk-tuile')].filter((n: any) => n.getClientRects().length);
    out[nom] = {
      texte: txt(c), dedans: [...c.querySelectorAll('*')].every(dans), haut: Math.round(b.height),
      tuiles: tuiles.map((n: any) => txt(n.querySelector('.wk-n'))), icones: tuiles.filter((n: any) => n.querySelector('.odin-app-ic')).length,
      plus: txt([...c.querySelectorAll('.wk-plus')].find((n: any) => n.getClientRects().length)),
      coupe: k ? [...k.querySelectorAll('.wk-tuile, .wk-plus, :scope > *')].filter((n: any) => n.getClientRects().length && getComputedStyle(n).display !== 'none')
        .filter((n: any) => { const r = n.getBoundingClientRect(); return r.height > 0 && (r.top < kb.top - 1 || r.bottom > kb.bottom + 1); }).map((n: any) => `${n.className} ${txt(n).slice(0, 30)}`) : [],
      petits: [...c.querySelectorAll('.wk-corps button, .wk-corps a')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).map(txt),
      bouton: txt(c.querySelector('.wk-corps .wk-aller')),
    };
  }
  return out;
}, ID);

for (const [largeur, sombre] of [[1280, false], [390, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : les tuiles des applis épinglées (icône et nom), « et N de plus », la carte ne s'étire pas ; toucher ou Entrée ouvre l'appli ; vide → la page Applis`, { skip: sansNav }, async () => {
    trenteEpinglees();
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, 'rien ne déborde de la page'); assert.equal(a.code, false, 'le nom piégé n\'est jamais du code');
      for (const k of ['grand', 'petit', 'haut']) {
        assert.ok(a[k].tuiles.length >= 1, `${k} : au moins une tuile`); assert.equal(a[k].icones, a[k].tuiles.length, `${k} : chaque tuile a son icône`);
        assert.ok(a[k].tuiles[0].startsWith('<img src=x'), `${k} : le nom piégé, tel quel, en texte`);
        assert.equal(a[k].plus, `et ${N + 1 - a[k].tuiles.length} de plus`, `${k} : ce qui ne tient pas est compté`);
        assert.equal(a[k].dedans, true, `${k} : tout reste dans la carte`); assert.deepEqual(a[k].coupe, [], `${k} : rien de coupé`); assert.deepEqual(a[k].petits, [], `${k} : des cibles de 44 px`);
      }
      assert.ok(a.haut.tuiles.length > a.petit.tuiles.length, 'plus grande, la carte montre plus de tuiles');
      assert.match(a.vide.texte, /Aucune appli épinglée/); assert.equal(a.vide.bouton, 'Épingler des applis'); assert.deepEqual(a.vide.petits, []);
      if (largeur > 700) {
        assert.equal(a.etire, false, 'les tuiles ne comptent pas dans la hauteur des cartes');
        assert.ok(Math.abs(a.grand.haut - 162) <= 2, `deux lignes : ${a.grand.haut} px (la carte ne s'étire pas)`); assert.ok(Math.abs(a.haut.haut - 250) <= 2, `trois lignes : ${a.haut.haut} px`);
      } else assert.ok(a.grand.haut < 400, `au téléphone non plus, trente applis n'allongent pas la carte : ${a.grand.haut} px`);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/raccourcis-${largeur}${sombre ? '-sombre' : ''}.png`, fullPage: true });
      // Au clavier : la tuile s'atteint (focus visible) et Entrée l'ouvre.
      const deuxieme = `#feGrid .fe-w[data-id="${ID.grand}"] .wk-tuile:nth-child(2)`;
      await p.focus(deuxieme);
      assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle), 'none', 'le focus est visible');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => location.hash === '#app=essai00');
      // L'appli s'ouvre (un instant après le changement d'adresse) : attendre qu'elle soit là avant de revenir à l'accueil.
      await p.waitForFunction(() => Boolean(document.getElementById('v-app')?.getClientRects().length), undefined, { timeout: 10000 });
      // Toucher : la première (le nom piégé) ouvre la sienne.
      const revenir = async (s: string) => { await p.evaluate(() => { location.hash = '#home'; }); await p.waitForSelector(s, { state: 'visible', timeout: 15000 }); };
      await revenir(`#feGrid .fe-w[data-id="${ID.grand}"] .wk-tuile`);
      await p.click(`#feGrid .fe-w[data-id="${ID.grand}"] .wk-tuile:nth-child(1)`);
      await p.waitForFunction(() => location.hash === '#app=essaip');
      await p.waitForFunction(() => Boolean(document.getElementById('v-app')?.getClientRects().length), undefined, { timeout: 10000 });
      // L'état vide : « Épingler des applis » ouvre la page Applis.
      await revenir(`#feGrid .fe-w[data-id="${ID.vide}"] .wk-aller`);
      await p.click(`#feGrid .fe-w[data-id="${ID.vide}"] .wk-aller`);
      await p.waitForFunction(() => location.hash === '#apps');
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur, 320, 768 et 1920 px : rien ne déborde, chaque tuile reste dans sa carte', { skip: sansNav }, async () => {
  trenteEpinglees();
  for (const largeur of [320, 768, 1920]) {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const a = await vu(p);
      assert.equal(a.deborde, false, `${largeur} : la page ne déborde pas`);
      for (const k of ['grand', 'petit', 'haut', 'vide']) { assert.equal(a[k].dedans, true, `${largeur} · ${k} : dans la carte`); assert.deepEqual(a[k].coupe, [], `${largeur} · ${k} : rien de coupé`); }
      for (const k of ['grand', 'petit', 'haut']) assert.ok(a[k].tuiles.length >= 1 && a[k].plus, `${largeur} · ${k} : des tuiles et « et N de plus »`);
      if (largeur > 700) assert.equal(a.etire, false, `${largeur} : aucune carte étirée`);
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  }
});
