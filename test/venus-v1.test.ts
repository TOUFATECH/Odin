// Vénus, lot V1 : l'interface de Venus dans Odin (/venus/app/), sur la VRAIE bibliothèque de Vénus.
//   - la logique de la coque et du menu (rail de 6, « Plus », onglets du téléphone, menu réglable, enfants) ;
//   - les bibliothèques, la fiche, Ctrl+K et « Qui regarde ? » rendus avec des médias fabriqués par ffmpeg (lavfi),
//     déclarés, scannés et lus par les vraies routes d'Odin ;
//   - la planète choisie est gardée (par profil) ; un membre de la famille n'ouvre ni la page ni ses données ;
//   - ce qui marchait avant reste joignable (dossiers, scan, flux, page de gestion).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { nettoyerPreferences } from '../src/valhalla/venus/app/appli.ts';

const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const SRC = { planetes: readFileSync(new URL('planetes.js', APP), 'utf8'), app: readFileSync(new URL('app.js', APP), 'utf8') };
const MDP = 'une-riviere-calme-sous-la-lune-48';

type Fn = (...a: unknown[]) => unknown;
/** Une valeur venue du contexte isolé (vm), ramenée dans celui de l'essai pour la comparer. */
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
interface Appli { L: Record<string, Fn>; NAV_ITEMS: Array<{ id: string; href: string }>; DEFAULT_HIDDEN: string[]; RAIL_MAX: number }

/** Charge planetes.js et app.js sans navigateur : seule la logique pure est posée (VenusApp). */
function logique(): Appli {
  const ctx = vm.createContext({ window: {}, URLSearchParams, Intl });
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  return (ctx.window as { VenusApp: Appli }).VenusApp;
}

test('coque et menu : 6 sections dans le rail puis « Plus », 4 onglets puis « Tout » sur le téléphone, ordre réglable', () => {
  const A = logique(), L = A.L;
  const M = { order: A.NAV_ITEMS.map((i) => i.id), hidden: [...A.DEFAULT_HIDDEN] };
  const pleins = { movie: 3, show: 1, anime: 0, clip: 0, channel: 0, music: 0, photo: 0, book: 0 };
  const adulte = { id: 'moi', name: 'Awa', isAdmin: true };
  const c = L.coque(adulte, M, pleins) as { rail: Array<{ id: string }>; plus: boolean; tabs: Array<{ id: string }> };
  assert.ok(c.rail.length <= A.RAIL_MAX, 'au plus 6 sections dans le rail');
  assert.deepEqual(ici(c.rail.map((x) => x.id).slice(0, 3)), ['home', 'movies', 'shows']);
  assert.ok(!c.rail.some((x) => x.id === 'anime' || x.id === 'clips'), 'une catégorie vide disparaît du menu (comme dans Venus)');
  assert.equal(c.plus, true, '« Plus » range le reste');
  assert.deepEqual(ici(c.tabs.map((x) => x.id)), ['home', 'movies', 'shows', 'search'], 'téléphone : Accueil, deux sections, Recherche (puis « Tout »)');
  // Monter « Séries » au-dessus de « Films » : l'ordre change, le rail suit.
  const o2 = L.deplacer(M.order, 'shows', -1) as string[];
  assert.deepEqual(ici((L.coque(adulte, { ...M, order: o2 }, pleins) as { rail: Array<{ id: string }> }).rail.map((x) => x.id).slice(1, 3)), ['shows', 'movies']);
  assert.deepEqual(ici(L.deplacer(M.order, 'home', -1)), ici(M.order), 'la première ne monte pas plus haut');
  // Un profil enfant ne voit ni « Nouveau » ni le tableau de bord.
  const enfant = L.menuItems({ id: 'p:k', name: 'K', isKids: true }, M, pleins) as { shown: Array<{ id: string }>; more: Array<{ id: string }> };
  assert.ok(![...enfant.shown, ...enfant.more].some((x) => ['request', 'dashboard', 'new'].includes(x.id)));
});

test('bibliothèques : statut, années, qualité, tris (ajout, titre, durée) — sans donnée inventée', () => {
  const L = logique().L;
  const items = [
    { id: 'a', title: 'Bravo', category: 'movie', year: 2021, res: '1080p', added: 3, runtime: 90, status: 'unseen' },
    { id: 'b', title: 'Alpha', category: 'movie', year: 1999, res: 'SD', added: 1, runtime: 60, status: 'seen' },
    { id: 'c', title: 'Charlie', category: 'movie', res: '4K', added: 2, runtime: 120, status: 'progress' },
  ];
  const f = (x: Record<string, unknown>) => ({ sort: 'added', desc: false, status: 'all', decades: [], quality: [], ...x });
  const ids = (l: unknown) => ici((l as Array<{ id: string }>).map((x) => x.id));
  assert.deepEqual(ids(L.shown(items, f({}))), ['a', 'c', 'b'], 'date d\'ajout, plus récents d\'abord');
  assert.deepEqual(ids(L.shown(items, f({ sort: 'az' }))), ['b', 'a', 'c']);
  assert.deepEqual(ids(L.shown(items, f({ sort: 'runtime', desc: true }))), ['c', 'a', 'b']);
  assert.deepEqual(ids(L.shown(items, f({ status: 'progress' }))), ['c']);
  assert.deepEqual(ids(L.shown(items, f({ decades: [1990] }))), ['b'], 'un titre sans année ne tombe dans aucune décennie');
  assert.deepEqual(ids(L.shown(items, f({ quality: ['4K'] }))), ['c']);
  assert.deepEqual(ids(L.itemsOf([...items, { id: 'd', category: 'anime', inList: true }], 'mylist')), ['d']);
  // Une saison : les numéros qui manquent entre deux épisodes présents sont montrés à leur place.
  const s = L.episodesSaison({ number: 1, manquants: [3], episodes: [{ episode: 4 }, { episode: 1 }, { episode: 2 }] }) as Array<{ episode: number; missing?: boolean }>;
  assert.deepEqual(ici(s.map((e) => `${e.episode}${e.missing ? 'm' : ''}`)), ['1', '2', '3m', '4']);
});

// --------------------------------------------------------------- l'interface rendue sur un vrai Odin
interface Fausse { app: { innerHTML: string }; doc: Record<string, unknown>; win: Record<string, unknown>; ecouteurs: Record<string, Fn[]>; aller(h: string): Promise<void>; cliquer(data: Record<string, string>): Promise<void>; root: { dataset: Record<string, string> } }
const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));
/** Un navigateur réduit au strict nécessaire : la page tourne pour de vrai, ses fetch vont au vrai Odin. */
async function ouvrir(v: VraiOdin, cookie: string): Promise<Fausse> {
  const ecouteurs: Record<string, Fn[]> = {};
  const on = (k: string, f: Fn) => { (ecouteurs[k] ??= []).push(f); };
  const app = { innerHTML: '', removeAttribute() {} };
  const elFaux = (): Record<string, unknown> => ({ className: '', style: {}, dataset: {}, classList: { add() {}, toggle() {}, remove() {} }, setAttribute() {}, addEventListener() {}, remove() {}, append() {}, querySelector: () => null, focus() {} });
  const root = { lang: 'fr', dataset: {} as Record<string, string>, style: { setProperty() {} }, classList: { toggle() {}, add() {} } };
  let temoins = cookie;
  const location = { hash: '#/', href: `${v.url}/venus/app/` };
  const doc: Record<string, unknown> = {
    documentElement: root, body: elFaux(), title: '', styleSheets: [],
    getElementById: (id: string) => (id === 'app' ? app : null),
    querySelector: (s: string) => (s === '#app' ? app : null), querySelectorAll: () => [],
    createElement: elFaux, addEventListener: on, contains: () => false, activeElement: null,
    get cookie() { return temoins; }, set cookie(c: string) { const [kv] = c.split(';'); temoins = `${cookie}; ${kv}`; },
  };
  const win: Record<string, unknown> = {
    navigator: { language: 'fr-FR' }, addEventListener: on, location, scrollY: 0, innerWidth: 1280, innerHeight: 900,
    history: { replaceState: (_a: unknown, _b: unknown, h: string) => { location.hash = h; } },
    scrollTo() {}, requestAnimationFrame: (f: Fn) => setTimeout(f, 0),
    matchMedia: (q: string) => ({ matches: /reduced-motion/.test(q), addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {} },
    fetch: (chemin: string, o: { headers?: Record<string, string>; method?: string; body?: string } = {}) => fetch(v.url + chemin, { ...o, headers: { ...(o.headers ?? {}), cookie: temoins } }),
  };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} } });
  for (const k of Object.keys(win)) (ctx as Record<string, unknown>)[k] = win[k];
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  for (let k = 0; k < 150; k++) { await attendre(30); if (app.innerHTML && !/aria-busy="true"/.test(app.innerHTML)) break; }
  await attendre(150);
  return {
    app, doc, win, ecouteurs, root,
    async aller(h) { location.hash = h; for (const f of ecouteurs.hashchange ?? []) f(); await attendre(250); },
    async cliquer(data) { const el = { dataset: data, closest: () => el, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 }), classList: { toggle() {} }, setAttribute() {}, parentElement: { querySelector: () => null } }; for (const f of ecouteurs.click ?? []) await f({ target: el, preventDefault() {}, stopPropagation() {} }); await attendre(300); },
  };
}

const fabriquer = (f: string, s: number, taille = '640x360') => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=duration=${s}:size=${taille}:rate=10`, '-f', 'lavfi', '-i', `sine=duration=${s}`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f]);
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(v: VraiOdin, ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' });
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' });
  return cookieDe(r, 'odin_session');
}

test('Venus dans Odin : la vraie bibliothèque, la fiche, Ctrl+K, « Qui regarde ? », la planète gardée, les membres tenus dehors', { timeout: 240_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn }, medias = mkdtempSync(join(tmpdir(), 'venus-v1-'));
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const films = join(medias, 'Films'), series = join(medias, 'Series'); mkdirSync(films); mkdirSync(join(series, 'Brume Lente'), { recursive: true });
    fabriquer(join(films, 'Essai Lumiere (2021).mp4'), 3, '1920x1080'); fabriquer(join(films, 'Essai Nuit (2019).mp4'), 4); fabriquer(join(films, 'Essai Aube.mp4'), 2);
    for (const e of ['S01E01', 'S01E02', 'S01E04', 'S02E01']) fabriquer(join(series, 'Brume Lente', `Brume Lente ${e}.mp4`), 2);
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'freyja'].includes(m.id)) }), va = valhallaOf()!;
    // Ce qui marchait avant : déclarer, scanner (vraies routes).
    for (const [c, k] of [[films, 'films'], [series, 'series']]) assert.equal((await v.json('/venus/dossiers', { chemin: c, categorie: k })).status, 200);
    const sc = await v.json('/venus/scan', {}); assert.equal((sc.body.bilan as { oeuvres: number }).oeuvres, 4, JSON.stringify(sc.body));
    await v.json('/venus/reprise', { cible: 'serie:brume-lente:s1e1', position_s: 2, duree_s: 2 });
    await v.json('/venus/reprise', { cible: 'film:essai-nuit-2019', position_s: 2, duree_s: 4 });
    // Une personne de la famille (compte d'Odin) : elle est un profil de « Qui regarde ? », mais n'ouvre pas Venus.
    assert.equal((await va.act('var', 'ajouter', { login: 'membre-v1', nom: 'Lina', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    for (const appli of ['odin', 'freyja']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-v1' })).ok, true);
    lierProprietaire(persona()!);

    // La page et ses fichiers : servis par Odin, rien d'extérieur.
    const page = await fetch(`${v.url}/venus/app/`, { headers: { cookie: v.session } });
    assert.equal(page.status, 200); const csp = page.headers.get('content-security-policy') ?? '', html = await page.text();
    assert.match(csp, /default-src 'none'/); assert.doesNotMatch(csp, /https?:/, 'aucune adresse extérieure permise');
    assert.doesNotMatch(html, /https?:\/\/(?!127)/);
    for (const f of ['app.js', 'planetes.js', 'css/app.css', 'css/odin.css', 'fonts/archivo.woff2', 'fonts/inter.woff2', 'fonts/outfit.woff2', 'fonts/archivo.LICENSE', 'LICENSE']) {
      const r = await fetch(`${v.url}/venus/app/${f}`, { headers: { cookie: v.session } }); assert.equal(r.status, 200, f);
    }
    assert.equal((await fetch(`${v.url}/venus/app/../base.ts`, { headers: { cookie: v.session } })).status !== 200, true, 'rien d\'autre n\'est servi');
    const css = await (await fetch(`${v.url}/venus/app/css/app.css`, { headers: { cookie: v.session } })).text();
    assert.match(css, /Licence MIT/); assert.match(css, /url\(\.\.\/fonts\/archivo\.woff2\)/, 'les polices de Venus, embarquées');

    // Un membre : ni la page, ni le catalogue, ni les profils.
    const m = await entrer(v, 'membre-v1', MDP); assert.ok(m);
    const rm = await fetch(`${v.url}/venus/app/`, { headers: { cookie: m } }); assert.equal(rm.status, 401); assert.match(await rm.text(), /réservé au propriétaire/);
    for (const c of ['/venus/api/catalogue', '/venus/api/profils', '/venus/api/preferences', '/venus/api/titre/film%3Aessai-nuit-2019']) assert.equal((await v.json(c, undefined, { cookie: m })).status, 401, c);

    // L'interface, rendue avec les vraies données.
    const P = await ouvrir(v, v.session);
    // « Qui regarde ? » d'abord : deux comptes d'Odin, aucun choisi sur cet appareil.
    assert.match(P.app.innerHTML, /Qui regarde/); assert.match(P.app.innerHTML, /Awa/); assert.match(P.app.innerHTML, /Lina/);
    await P.cliquer({ act: 'pickprofile', v: 'moi' });
    await P.aller('#/');
    const h = P.app.innerHTML;
    assert.match(h, /^<nav class="rail"[\s\S]*?<button class="rail-item f odin-back" data-act="odin" aria-label="Revenir à Odin"/, '« ‹ Odin » est le premier élément du rail');
    assert.match(h, /class="mobile-top">\s*<button class="odin-back f"/, 'et le premier de la barre du haut sur téléphone');
    assert.match(h, /class="tabbar"[\s\S]*tab-more/, 'onglets du téléphone, puis « Tout »');
    assert.match(h, /Reprendre là où vous en étiez[\s\S]*Essai Nuit/, 'l\'accueil reprend le film commencé');
    assert.doesNotMatch(h, /href="#\/animes"/, 'pas d\'Animés dans le menu : aucun animé dans la bibliothèque');
    // Chaque élément du rail est atteignable au clavier : liens et boutons avec un nom.
    const rail = /<nav class="rail"[\s\S]*?<\/nav>/.exec(h)![0];
    for (const x of rail.match(/<(a|button) [^>]*>/g) ?? []) { assert.match(x, /class="[^"]*\bf\b/, x); assert.match(x, /aria-label="[^"]+"/, x); }

    await P.aller('#/films');
    assert.match(P.app.innerHTML, /3 titres/); for (const t of ['Essai Lumiere', 'Essai Nuit', 'Essai Aube']) assert.match(P.app.innerHTML, new RegExp(t));
    assert.match(P.app.innerHTML, /data-act="random"/, '« Au hasard »'); assert.match(P.app.innerHTML, /data-act="sortmenu"/); assert.match(P.app.innerHTML, /data-act="filtermenu"/);
    await P.cliquer({ act: 'status', kind: 'movie', v: 'progress' });
    assert.match(P.app.innerHTML, /1 sur 3 titres/); assert.match(P.app.innerHTML, /Essai Nuit/); assert.doesNotMatch(P.app.innerHTML, /aria-label="Essai Aube/);
    await P.cliquer({ act: 'view', kind: 'movie', v: 'list' }); assert.match(P.app.innerHTML, /class="lib-row"/, 'vue en liste');
    await P.aller('#/series'); assert.match(P.app.innerHTML, /1 titre/); assert.match(P.app.innerHTML, /Brume Lente/);
    await P.aller('#/animes'); assert.match(P.app.innerHTML, /Aucun titre rangé ici/, 'un état vide propre, pas de titre inventé');
    await P.aller('#/films?vue=avenir'); assert.match(P.app.innerHTML, /data-a-brancher="sorties"/, 'la place des sorties à venir (♡ ⬇) est gardée');

    // La fiche d'une série : saisons, épisodes, l'épisode qui manque, la reprise.
    await P.aller('#/titre/serie%3Abrume-lente'); await attendre(300);
    const f = P.app.innerHTML;
    assert.match(f, /Brume Lente/); assert.match(f, /2 saisons, 4 épisodes/); assert.match(f, /Reprendre S1:É2/);
    assert.match(f, /Saison 1[\s\S]*Saison 2/); assert.match(f, /Manquant/, 'l\'épisode 3 manque entre le 2 et le 4');
    assert.match(f, /Distribution et équipe[\s\S]*Pas encore d’informations/, 'pas de distribution inventée');
    // La fiche d'un film : ajouter à ma liste passe par la vraie route.
    await P.aller('#/titre/film%3Aessai-lumiere-2021'); await attendre(300);
    assert.match(P.app.innerHTML, /Essai Lumiere/); assert.match(P.app.innerHTML, /2021/); assert.match(P.app.innerHTML, /1080p/);
    await P.cliquer({ act: 'mylist', v: 'film:essai-lumiere-2021' });
    assert.deepEqual(((await v.json('/venus/ma-liste')).body.liste as Array<{ id: string }>).map((x) => x.id), ['film:essai-lumiere-2021']);

    // Ctrl+K : les titres de la bibliothèque, les pages, les réglages, « Changer de profil ».
    const A = (P.win.VenusApp as Appli).L, items = ((await v.json('/venus/api/catalogue')).body.titres) as Array<Record<string, unknown>>;
    const M = { order: (P.win.VenusApp as Appli).NAV_ITEMS.map((i) => i.id), hidden: [] as string[] };
    const vide = A.palette('', items, { id: 'moi', isAdmin: true }, M, A.comptes(items)) as Array<{ label: string }>;
    assert.ok(vide.some((x) => x.label === 'Films') && vide.length <= 8);
    const r = A.palette('brume', items, { id: 'moi', isAdmin: true }, M, A.comptes(items)) as Array<{ label: string; to?: string; kind: string }>;
    assert.equal(r[0].label, 'Brume Lente'); assert.equal(r[0].to, '/titre/serie%3Abrume-lente'); assert.equal(r[r.length - 1].kind, 'action');
    assert.ok((A.palette('profil', items, { id: 'moi', isAdmin: true }, M, A.comptes(items)) as Array<{ label: string }>).some((x) => x.label === 'Changer de profil'));

    // La planète choisie est gardée (base de Vénus, par profil) et s'applique tout de suite.
    await P.aller('#/reglages?tab=affichage'); assert.match(P.app.innerHTML, /role="radiogroup" aria-label="Planète"/);
    assert.equal((P.app.innerHTML.match(/data-act="planet"/g) ?? []).length, 17, '17 planètes');
    await P.cliquer({ act: 'planet', v: 'lagon' });
    assert.equal(P.root.dataset.planet, 'lagon'); assert.equal(P.root.dataset.layout, 'lagon');
    assert.equal(((await v.json('/venus/api/preferences')).body.preferences as { planete: string }).planete, 'lagon');
    const P2 = await ouvrir(v, `${v.session}; venus_profil=moi`); await P2.aller('#/');
    assert.equal(P2.root.dataset.planet, 'lagon', 'rouvert : toujours Lagon');
    // Un autre profil (compte d'Odin) a sa propre liste et sa propre planète.
    const lina = { cookie: `${v.session}; venus_profil=p%3Amembre-v1` };
    assert.equal((await v.json('/venus/api/profils', undefined, lina)).body.actuel, 'p:membre-v1', JSON.stringify((await v.json('/venus/api/profils', undefined, lina)).body));
    assert.deepEqual((await v.json('/venus/ma-liste', undefined, lina)).body.liste, []);
    assert.equal(((await v.json('/venus/api/preferences', undefined, lina)).body.preferences as { planete?: string }).planete, undefined);
    assert.equal((await v.json('/venus/api/profils', undefined, { cookie: `${v.session}; venus_profil=p%3Ainconnu` })).body.actuel, 'moi', 'un profil inconnu ne compte pas');

    // Lire un film : le flux de toujours répond (le lecteur complet de Venus vient au lot V2).
    const flux = await fetch(`${v.url}/venus/flux/${encodeURIComponent('film:essai-nuit-2019')}`, { headers: { cookie: v.session, range: 'bytes=0-99' } });
    assert.equal(flux.status, 206); await flux.arrayBuffer();
  } finally {
    await tt.end(); Object.assign(console, orig); rmSync(medias, { recursive: true, force: true });
  }
});

test('préférences : seules des valeurs connues sont gardées', () => {
  assert.deepEqual(nettoyerPreferences({ planete: 'lagon', auto: 'sun', ordre: ['films', 'movies', 'movies'], caches: ['x'], verre: 'jour' }), { planete: 'lagon', auto: 'sun', ordre: ['movies'], caches: [] });
  assert.deepEqual(nettoyerPreferences({ planete: '<script>' }), {});
});

test('la page de gestion reste joignable : Vénus s\'ouvre en plein écran, sauf pour lire un titre ou à la demande de Venus', () => {
  const src = readFileSync(new URL('../src/web/pages/venus.js', import.meta.url), 'utf8');
  const win: { OdinPages: Record<string, unknown>; OdinVenus?: { logique: Record<string, Fn> } } = { OdinPages: {} };
  vm.runInContext(src, vm.createContext({ window: win, URLSearchParams }));
  const L = win.OdinVenus!.logique;
  assert.equal(L.versAppli(null, ''), true, 'ouvrir Vénus = l\'interface de Venus');
  assert.equal(L.versAppli({ lire: 'film:x' }, ''), false, 'lire un titre depuis la discussion : le lecteur part d\'ici');
  assert.equal(L.versAppli(null, '?venus=gestion'), false, 'Venus a demandé la page de gestion');
  assert.equal(L.versAppli(null, '?venus=gestionnaire'), true);
  assert.equal(L.gestionUrl(), '/?venus=gestion#app=freyja');
  assert.doesNotMatch(readFileSync(new URL('app.js', APP), 'utf8'), /localStorage|sessionStorage|indexedDB/, 'rien gardé dans le navigateur');
  assert.equal(L.appliUrl(), '/venus/app/#/');
  for (const lab of ['Odéon', 'YouTube', 'Écrans', 'Acquisition', 'État', 'Ouvrir Venus']) assert.ok(src.includes(`'${lab}'`), lab);
});

// ------------------------------------------------------------------ relecture du lot V1
test('relecture : ouvrir la page de Venus sans session n\'est pas compté comme un essai de jeton raté (pas de blocage de l\'adresse)', async () => {
  const { venusRoute } = await import('../src/valhalla/venus/routes.ts');
  const home = mkdtempSync(join(tmpdir(), 'venus-v1-refus-'));
  try {
    let essais = 0; const ctx = { home, proprietaire: () => false, fail: () => { essais++; }, origin: 'http://127.0.0.1', ip: '192.168.1.20' };
    const appel = async (chemin: string, methode = 'GET') => {
      const r = { code: 0, corps: '', writeHead(c: number) { this.code = c; return this; }, end(x?: string) { this.corps = String(x ?? ''); return this; }, setHeader() {} };
      await venusRoute({ method: methode, headers: {} } as never, r as never, new URL(chemin, 'http://127.0.0.1'), ctx as never); return r;
    };
    for (let k = 0; k < 12; k++) { const r = await appel('/venus/app/'); assert.equal(r.code, 401); assert.match(r.corps, /réservé au propriétaire/); }
    assert.equal(essais, 0, 'une simple ouverture de page (lien, favori, membre redirigé) ne bloque pas l\'adresse pendant 15 minutes');
    assert.equal((await appel('/venus/api/catalogue')).code, 401); assert.equal(essais, 1, 'les données, elles, restent comptées comme avant');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('relecture : les préférences ne s\'écrivent qu\'avec l\'en-tête x-odin (contre les requêtes d\'un autre site)', async () => {
  const { routeAppli } = await import('../src/valhalla/venus/app/appli.ts');
  const { magasinVenus, dirVenus } = await import('../src/valhalla/venus/base.ts');
  const home = mkdtempSync(join(tmpdir(), 'venus-v1-prefs-'));
  try {
    const mag = magasinVenus(home, dirVenus(home));
    const poster = async (entetes: Record<string, string>) => {
      const corps = Buffer.from(JSON.stringify({ planete: 'mars' }));
      const req = Object.assign((async function* () { yield corps; })(), { method: 'POST', headers: entetes });
      const r = { code: 0, corps: '', writeHead(c: number) { this.code = c; return this; }, end(x?: string) { this.corps = String(x ?? ''); return this; } };
      await routeAppli(req as never, r as never, new URL('http://127.0.0.1/venus/api/preferences'), home, mag, 'moi'); return r;
    };
    assert.equal((await poster({ 'content-type': 'application/json' })).code, 403, 'sans x-odin : refusé');
    assert.equal(existsSync(join(mag.dir, 'interface.json')), false, 'et rien n\'est écrit');
    const ok = await poster({ 'content-type': 'application/json', 'x-odin': '1' }); assert.equal(ok.code, 200); assert.match(ok.corps, /"planete":"mars"/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('relecture : Ctrl+K ne propose « Médiathèques » qu\'au propriétaire, et aucun réglage à un profil enfant (comme le rail)', () => {
  const A = logique(), L = A.L, M = { order: A.NAV_ITEMS.map((i) => i.id), hidden: [...A.DEFAULT_HIDDEN] };
  const cats = { movie: 1, show: 0, anime: 0, clip: 0, channel: 0, music: 0, photo: 0, book: 0 };
  const libelles = (p: Record<string, unknown>) => ici((L.palette('glages', [], p, M, cats) as Array<{ label: string }>).map((x) => x.label));
  assert.ok(libelles({ id: 'moi', isAdmin: true }).includes('Réglages : Médiathèques'));
  assert.ok(!libelles({ id: 'p:lina' }).includes('Réglages : Médiathèques'), 'un autre profil n\'a pas Médiathèques dans ses réglages');
  assert.ok(libelles({ id: 'p:lina' }).includes('Réglages : Thème et menu'));
  assert.ok(!libelles({ id: 'p:k', isKids: true }).some((x: string) => x.startsWith('Réglages')), 'un enfant n\'a pas Réglages (le rail ne le montre pas non plus)');
});

test('relecture : ouvrir Vénus depuis Odin remplace l\'entrée de l\'historique (le bouton « retour » ne renvoie pas dans Venus)', () => {
  const src = readFileSync(new URL('../src/web/pages/venus.js', import.meta.url), 'utf8');
  const win: { OdinPages: Record<string, unknown>; OdinVenus?: { logique: Record<string, Fn> } } = { OdinPages: {} };
  vm.runInContext(src, vm.createContext({ window: win, URLSearchParams }));
  const vu: string[] = [];
  win.OdinVenus!.logique.allerAppli({ replace: (u: string) => vu.push(`replace ${u}`), assign: (u: string) => vu.push(`assign ${u}`) });
  assert.deepEqual(vu, ['replace /venus/app/#/']);
  assert.doesNotMatch(src, /location\.assign\(logique\.appliUrl\(\)\)/);
});

test('relecture : un titre très long (un seul mot) ne fait pas déborder la fiche', () => {
  assert.match(readFileSync(new URL('css/odin.css', APP), 'utf8'), /\.hero-title\s*\{[^}]*overflow-wrap:\s*anywhere/);
});
