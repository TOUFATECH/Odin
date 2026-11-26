// Le cadre de l'écran de la maison (/maison), deuxième part : le bandeau et les onglets de pièces (maquette validée).
// - Le bandeau, au dessin de la maquette : le salut à la maison, puis la date (fuseau d'Odin) et la semaine, puis
//   SEULEMENT les vraies valeurs que la page reçoit : la température du lieu, le lieu, les personnes à la maison.
//   Une valeur absente n'a ni case, ni tiret, ni zéro. Le prénom n'est pas retiré (la pastille ronde de la maquette).
// - Les onglets de pièces : « Tout », puis les pièces des appareils ; ils filtrent ; l'onglet choisi est dit aux lecteurs
//   d'écran ; au clavier, une rangée d'onglets ; aucune pièce : pas d'onglets du tout.
// - Aucun nom de pièce, aucune ville, aucun nombre de la maquette n'est écrit dans le code.
// - Un seul retour vers Odin à la fois : la barre épinglée (grand écran) a le sien, celui du bandeau se cache.
// Le script de la page (src/web/maison.js) est lu comme du texte ; ses fonctions tournent dans un bac à sable avec un
// faux document, comme dans test/maison-garde.test.ts. Les derniers essais ouvrent un vrai Odin d'essai dans un vrai
// navigateur (ignorés, en le disant, sans Playwright sur la machine).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
function ligne(debut: string): string {
  const l = MAISON.split('\n').find((x) => x.trimStart().startsWith(debut));
  assert.ok(l, `maison.js : « ${debut} » introuvable`);
  return l;
}
function bloc(debut: string): string {
  const i = MAISON.indexOf(`  ${debut}`); assert.ok(i >= 0, `maison.js : « ${debut} » introuvable`);
  const f = MAISON.indexOf('\n  }', i); assert.ok(f > i, `maison.js : fin de « ${debut} » introuvable`);
  const fin = MAISON.indexOf('\n', f + 1);
  return MAISON.slice(i, fin < 0 ? undefined : fin);
}

// ---------- Un faux document ----------
type Texte = { nodeType: 3; text: string };
const actif: { n: Noeud | null } = { n: null };
class Noeud {
  nodeType = 1; attrs: Record<string, string> = {}; kids: Array<Noeud | Texte> = []; ls: Record<string, Array<(e: unknown) => unknown>> = {}; style: Record<string, string> = {};
  tag: string; parent: Noeud | null = null; scrollLeft = 0;
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(t: string, f: (e: unknown) => unknown) { (this.ls[t] ??= []).push(f); }
  append(...c: Array<Noeud | Texte>) { for (const k of c) if (k instanceof Noeud) k.parent = this; this.kids.push(...c); }
  get children() { return this.kids.filter((k): k is Noeud => k instanceof Noeud); }
  focus() { actif.n = this; }
  scrollIntoView() {}
  closest(c: string): Noeud | null { const k = c.replace(/^\./, ''); let n: Noeud | null = this; while (n) { if ((n.attrs.class ?? '').split(' ').includes(k)) return n; n = n.parent; } return null; }
}
const tous = (n: Noeud | Texte | undefined | null, ok: (x: Noeud) => boolean): Noeud[] => (!n || !(n instanceof Noeud) ? [] : [...(ok(n) ? [n] : []), ...n.kids.flatMap((k) => tous(k, ok))]);
const texte = (n: Noeud): string => n.kids.map((k) => (k instanceof Noeud ? texte(k) : k.text)).join('');
const lancer = (n: Noeud, t: string, e: Record<string, unknown> = {}) => { for (const f of n.ls[t] ?? []) f({ target: n, preventDefault() {}, ...e }); };
const avecClasse = (c: string) => (x: Noeud) => (x.attrs.class ?? '').split(' ').includes(c);
function fauxDocument(page: () => Noeud | null) {
  return {
    createElement: (t: string) => new Noeud(t), createElementNS: (_: string, t: string) => new Noeud(t), createTextNode: (t: string): Texte => ({ nodeType: 3, text: String(t) }),
    get activeElement() { return actif.n; },
    querySelector: (sel: string) => tous(page(), avecClasse(sel.replace(/^\./, '')))[0] ?? null,
  };
}

// ---------- Le bandeau (bandeau), dans son bac à sable ----------
function leBandeau(D: Record<string, unknown>) {
  const src = ['let D = null;', ligne('const MOTS = '), bloc('const el = ('), ligne('const week = '), ligne('const hello = '), bloc('function bandeau('), '({ bandeau, regler(d) { D = d; } });'].join('\n');
  const e = vm.runInNewContext(src, { document: fauxDocument(() => null), Intl, Date }) as { bandeau: () => Array<Noeud | null>; regler: (d: unknown) => void };
  e.regler(D);
  // Le bandeau rend [le salut, la pastille] : on les pose dans un même nœud pour les lire.
  const b = new Noeud('div'); b.append(...e.bandeau().filter((x): x is Noeud => x !== null));
  const h1 = tous(b, (x) => x.tag === 'h1')[0], p = tous(b, (x) => x.tag === 'p')[0];
  assert.ok(h1 && p, 'un titre et une ligne sous le titre');
  return { b, titre: texte(h1), ligne: texte(p), parts: texte(p).split(' · ') };
}
const AUJOURDHUI = (o: Record<string, string> = {}) => new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...o });

test('bandeau sans valeur : la date et la semaine seulement, ni température, ni lieu, ni personnes (ni case, ni tiret, ni zéro)', () => {
  for (const D of [{}, { lieu: {}, people: [] }, { lieu: { nom: '' }, weather: undefined, people: [] }]) {
    const v = leBandeau(D);
    assert.equal(v.parts.length, 2, `seulement la date et la semaine : « ${v.ligne} »`);
    assert.equal(v.parts[0], AUJOURDHUI());
    assert.match(v.parts[1], /^semaine \d+$/);
    assert.ok(!/°|—|–|personne|maison|\bà\b/.test(v.ligne), `aucune valeur inventée : « ${v.ligne} »`);
  }
});

test('bandeau : le salut à la maison (la maquette) ; le prénom n\'est pas retiré, il est sur la pastille ronde', () => {
  const v = leBandeau({ name: 'Ilyes' });
  assert.match(v.titre, /^(Bonne nuit|Bonjour|Bon après-midi|Bonsoir), la maison$/);
  const me = tous(v.b, avecClasse('me'));
  assert.equal(me.length, 1, 'une pastille');
  assert.equal(texte(me[0]), 'I'); assert.equal(me[0].attrs['aria-label'], 'Ilyes'); assert.equal(me[0].attrs.title, 'Ilyes');
  assert.equal(tous(leBandeau({}).b, avecClasse('me')).length, 0, 'sans prénom : pas de pastille');
});

test('bandeau avec ses vraies valeurs : la température du lieu, le lieu, le nombre de personnes à la maison', () => {
  const v = leBandeau({ weather: { temp: 17, place: 'Village-Essai', code: 1 }, lieu: { nom: 'Village-Essai' }, people: [{ name: 'Awa', state: 'home' }, { name: 'Noa', state: 'home' }, { name: 'Sami', state: 'not_home' }] });
  assert.deepEqual(v.parts.slice(2), ['17° à Village-Essai', '2 personnes à la maison']);
  assert.deepEqual(leBandeau({ people: [{ name: 'Awa', state: 'home' }, { name: 'Sami', state: 'not_home' }] }).parts.slice(2), ['1 personne à la maison']);
  assert.deepEqual(leBandeau({ people: [{ name: 'Sami', state: 'not_home' }, { name: 'Noa', state: 'position partagée' }] }).parts.length, 2, 'personne à la maison : rien (pas de zéro)');
  // Le lieu va avec sa température mesurée : seul, la page ne le distingue pas du lieu de départ d'Odin (jamais réglé).
  assert.equal(leBandeau({ lieu: { nom: 'Village-Essai' } }).parts.length, 2, 'sans météo : ni température, ni lieu');
  assert.equal(leBandeau({ weather: { temp: 17, place: 'Village-Essai', ancien: true }, lieu: { nom: 'Village-Essai' } }).parts.length, 2, 'une météo ancienne n\'est pas la température d\'aujourd\'hui');
  assert.equal(leBandeau({ weather: { place: 'Village-Essai' }, lieu: { nom: 'Village-Essai' } }).parts.length, 2, 'sans température mesurée : rien');
  assert.deepEqual(leBandeau({ weather: { temp: -3, place: 'Village-Essai' } }).parts.slice(2), ['-3° à Village-Essai'], 'le lieu de la mesure');
});

test('bandeau : la date suit le fuseau d\'Odin ; un fuseau inconnu ne casse rien', () => {
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) assert.equal(leBandeau({ lieu: { fuseau: tz } }).parts[0], AUJOURDHUI({ timeZone: tz }));
  const v = leBandeau({ lieu: { fuseau: 'Nulle/Part' } });
  assert.equal(v.parts[0], AUJOURDHUI()); assert.equal(v.parts.length, 2);
});

// ---------- L'accueil (home) et ses onglets de pièces ----------
function accueil(D: Record<string, unknown>) {
  const cartes: string[] = [];
  let page: Noeud | null = null;
  const src = [ligne('let D = null, view'), ligne('const MOTS = '), bloc('const el = ('), ligne('const match = '), ligne('const ongletDe = '), bloc('function onglets('), bloc('function home() {'),
    '({ home, regler(d) { D = d; }, piece: () => room });'].join('\n');
  const marque = () => new Noeud('vue');
  const e = vm.runInNewContext(src, {
    document: fauxDocument(() => page), icon: () => new Noeud('svg'), clock: new Noeud('div'), clockSub: new Noeud('div'),
    draw: () => { cartes.length = 0; page = Object.assign(new Noeud('main'), {}); page.append(...e.home()); },
    weatherCard: marque, fenetrePages: () => [], peopleGrid: marque, camGrid: marque, tilesView: () => [], appsGrid: marque, act: () => Promise.resolve({}),
    devCard: (d: { id: string }) => { cartes.push(d.id); return marque(); }, localStorage: { getItem: () => null, setItem() {} },
  }) as { home: () => Noeud[]; regler: (d: unknown) => void; piece: () => unknown };
  e.regler(D);
  const dessiner = () => { cartes.length = 0; page = new Noeud('main'); page.append(...e.home()); return page; };
  dessiner();
  const rangee = () => tous(page, (x) => x.attrs.role === 'tablist');
  const onglets = () => tous(page, (x) => x.attrs.role === 'tab');
  return { dessiner, rangee, onglets, cartes: () => [...cartes], piece: e.piece, page: () => page, regler: e.regler };
}
const PIECES = { rights: 'complet', notices: [], rooms: [
  { name: 'Pièce A', devices: [{ id: 'a1', name: 'Appareil 1', kind: 'prise', state: 'off' }] },
  { name: 'Pièce B', devices: [{ id: 'b1', name: 'Appareil 2', kind: 'prise', state: 'off' }, { id: 'b2', name: 'Appareil 3', kind: 'lumière', state: 'on' }] },
  { name: 'Tout', devices: [{ id: 't1', name: 'Appareil 4', kind: 'prise', state: 'off' }] }] };

test('onglets : « Tout », puis les pièces qui viennent des appareils, dans leur ordre ; une rangée d\'onglets nommée', () => {
  const a = accueil(PIECES);
  assert.equal(a.rangee().length, 1); assert.equal(a.rangee()[0].attrs['aria-label'], 'Pièces');
  assert.deepEqual(a.onglets().map(texte), ['Tout', 'Pièce A', 'Pièce B', 'Tout']);
  assert.deepEqual(a.onglets().map((x) => x.attrs['aria-selected']), ['true', 'false', 'false', 'false'], 'au départ : tout');
  assert.deepEqual(a.onglets().map((x) => x.attrs.tabindex), ['0', '-1', '-1', '-1'], 'Tab n\'entre que sur l\'onglet choisi');
  for (const x of a.onglets()) { assert.equal(x.tag, 'button'); assert.equal(x.attrs.type, 'button'); }
  const b = accueil({ ...PIECES, rooms: [{ name: 'Atelier-Essai', devices: [{ id: 'x', name: 'X', kind: 'prise', state: 'off' }] }] });
  assert.deepEqual(b.onglets().map(texte), ['Tout', 'Atelier-Essai'], 'les pièces sont celles des appareils, aucune n\'est écrite dans le code');
});

test('onglets : aucune pièce, pas d\'onglets du tout', () => {
  for (const rooms of [[], undefined]) { const a = accueil({ rights: 'complet', notices: [], rooms }); assert.equal(a.rangee().length, 0); assert.equal(a.onglets().length, 0); }
});

test('onglets : ils filtrent (sa réponse) ; l\'onglet choisi est dit ; une pièce qui s\'appelle « Tout » reste une pièce ; une pièce disparue rend tout', () => {
  const a = accueil(PIECES);
  assert.deepEqual(a.cartes(), ['a1', 'b1', 'b2', 't1']);
  lancer(a.onglets()[2], 'click');
  assert.deepEqual(a.cartes(), ['b1', 'b2'], 'seulement la pièce touchée');
  assert.deepEqual(a.onglets().map((x) => x.attrs['aria-selected']), ['false', 'false', 'true', 'false']);
  assert.equal(actif.n, a.onglets()[2], 'le focus reste sur l\'onglet choisi, redessiné');
  lancer(a.onglets()[3], 'click'); assert.deepEqual(a.cartes(), ['t1'], 'la pièce nommée « Tout »');
  lancer(a.onglets()[0], 'click'); assert.deepEqual(a.cartes(), ['a1', 'b1', 'b2', 't1'], '« Tout » : tout');
  lancer(a.onglets()[1], 'click'); assert.deepEqual(a.cartes(), ['a1']);
  // La pièce choisie disparaît (plus d'appareil) au redessin suivant : tout revient, « Tout » est choisi.
  a.regler({ ...PIECES, rooms: PIECES.rooms.filter((r) => r.name !== 'Pièce A') }); a.dessiner();
  assert.deepEqual(a.cartes(), ['b1', 'b2', 't1']);
  assert.equal(a.onglets()[0].attrs['aria-selected'], 'true');
});

test('onglets au clavier : les flèches, Début et Fin passent d\'un onglet à l\'autre sans choisir ; Entrée (un clic) choisit', () => {
  const a = accueil(PIECES), r = a.rangee()[0];
  a.onglets()[0].focus();
  lancer(r, 'keydown', { key: 'ArrowRight' }); assert.equal(actif.n, a.onglets()[1]);
  lancer(r, 'keydown', { key: 'End' }); assert.equal(actif.n, a.onglets()[3]);
  lancer(r, 'keydown', { key: 'ArrowRight' }); assert.equal(actif.n, a.onglets()[3], 'au bout, il reste');
  lancer(r, 'keydown', { key: 'Home' }); assert.equal(actif.n, a.onglets()[0]);
  lancer(r, 'keydown', { key: 'ArrowLeft' }); assert.equal(actif.n, a.onglets()[0]);
  assert.deepEqual(a.cartes(), ['a1', 'b1', 'b2', 't1'], 'bouger le focus ne filtre pas');
  // Écrite de droite à gauche, la rangée commence à droite : la flèche gauche avance, la flèche droite recule.
  const rtl = { matches: (s: string) => s === ':dir(rtl)' };
  lancer(r, 'keydown', { key: 'ArrowLeft', currentTarget: rtl }); assert.equal(actif.n, a.onglets()[1], 'de droite à gauche : la flèche gauche avance');
  lancer(r, 'keydown', { key: 'ArrowRight', currentTarget: rtl }); assert.equal(actif.n, a.onglets()[0], 'de droite à gauche : la flèche droite recule');
});

test('onglets à la souris : la molette fait défiler la rangée de côté quand elle déborde, sinon la page défile comme avant', () => {
  const a = accueil(PIECES), r = a.rangee()[0] as Noeud & Record<string, number>;
  let empeche = 0;
  const roue = (dy: number, o: Record<string, number>) => { Object.assign(r, o); lancer(r, 'wheel', { deltaY: dy, deltaX: 0, currentTarget: r, preventDefault() { empeche++; } }); };
  roue(120, { scrollWidth: 900, clientWidth: 300, scrollLeft: 0 });
  assert.equal(r.scrollLeft, 120, 'la molette avance dans la rangée'); assert.equal(empeche, 1, 'la page ne défile pas en même temps');
  roue(120, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
  assert.equal(r.scrollLeft, 0); assert.equal(empeche, 1, 'une rangée qui tient : la molette fait défiler la page');
  roue(120, { scrollWidth: 900, clientWidth: 300, scrollLeft: 600 });
  assert.equal(empeche, 1, 'au bout de la rangée : la molette rend la main à la page');
});

test('onglets : un nom de pièce très long garde son nom entier dans une bulle (l\'onglet le coupe à l\'écran)', () => {
  const a = accueil(PIECES);
  assert.deepEqual(a.onglets().map((x) => x.attrs.title ?? null), [null, 'Pièce A', 'Pièce B', 'Tout']);
  assert.match(BASE, /\.tabs button\{[^}]*max-width:[^;}]+;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis/);
});

// Les données d'exemple de la maquette elles-mêmes sont gardées par test/donnees-exemple.test.ts (empreintes, sans les
// écrire ici). Ici : le bandeau et les onglets n'écrivent aucun mot ni aucun nombre en dur ; leurs mots sont dans MOTS.
test('interdit : le bandeau et les onglets n\'écrivent ni nom de pièce, ni ville, ni nombre ; leurs mots sont dans MOTS', () => {
  const src = [bloc('function bandeau('), bloc('function onglets(')].join('\n');
  // Tous les textes écrits (entre apostrophes, entre guillemets, et les morceaux fixes des gabarits) : seulement des
  // signes sans lettre, ou des mots techniques connus (balises, attributs, rôles, touches, options de date). Un mot
  // affiché (dans n'importe quelle langue), un nom de pièce ou une ville fait échouer l'essai.
  const TECHNIQUES = new Set(['div', 'h1', 'p', 'span', 'button', 'hello', 'jour', 'me', 'img', 'tab', 'tabs', 'tablist', 'maison-grille', 'p:', 'home', 'aria-label', 'aria-selected', 'aria-controls', 'data-piece',
    'en-US', 'fr-FR', 'numeric', 'long', 'h23', 'ArrowRight', 'ArrowLeft', 'Home', 'End', ':dir(rtl)', 'nearest',
    // (suivi : la pièce choisie a son bouton « Régler » à côté de la rangée, qui ouvre la fenêtre de la pièce ; ses mots
    //  sont dans MOTS, ceux-ci sont sa classe, son attribut, la sorte de ce qu'il ouvre et son icône ; son mot écrit en
    //  clair, MOTS.regler, est caché au lecteur d'écran qui a déjà le nom entier : 'aria-hidden', 'true')
    'tabs-l', 'round piece-ouvrir', 'aria-haspopup', 'dialog', 'chev', 'aria-hidden', 'true']);
  const gabarits = [...src.matchAll(/`([^`]*)`/g)].flatMap((m) => m[1].split(/\$\{[^}]*\}/));
  const horsGabarits = src.replace(/`[^`]*`/g, '``');
  const textes = [...[...horsGabarits.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)].map((m) => m[1] ?? m[2]), ...gabarits];
  assert.ok(textes.length > 10, 'les textes du bandeau et des onglets sont bien lus');
  assert.deepEqual(textes.filter((t) => /\p{L}/u.test(t) && !TECHNIQUES.has(t)), [], 'aucun mot affiché écrit hors de MOTS');
  assert.ok(!/\d+\s*°|\d+ personnes?/.test(src), 'aucune température ni aucun nombre de personnes écrit');
});

// Le style : les onglets défilent de côté ; un seul retour vers Odin sur grand écran quand la barre est épinglée.
const BASE = (() => { const b = MAISON.indexOf('const BASE = `'); const f = MAISON.indexOf('`;\n', b + 14); return MAISON.slice(b, f); })();
test('style : la rangée d\'onglets défile de côté ; épinglée sur grand écran, le retour du bandeau se cache (celui de la barre suffit)', () => {
  assert.match(BASE, /\.tabs\{[^}]*overflow-x:auto/);
  assert.match(BASE, /\.tabs button\{[^}]*min-height:44px/);
  assert.match(BASE, /@media \(min-width:821px\)\{[^{}]*\.app:not\(\.libre\) \.top \.retour\{display:none\}/);
  // La barre détachée qu'on fait sortir (poignée, bord) a son retour : celui du bandeau s'efface sans déplacer les autres boutons.
  assert.match(BASE, /\.app\.libre:has\(\.side\.ouverte\) \.top \.retour\{visibility:hidden\}/);
});

test('style : le contour du focus d\'un onglet n\'est pas rogné ; l\'onglet choisi se voit aussi sans la couleur ; la date n\'a de majuscule qu\'au premier mot', () => {
  assert.match(BASE, /\.tabs button:focus-visible\{[^}]*outline-offset:-2px/);
  assert.match(BASE, /\.tabs button\[aria-selected=true\]\{[^}]*font-weight:600/);
  assert.doesNotMatch(BASE, /\.jour\{[^}]*capitalize/, 'pas une majuscule à chaque mot : le mois reste en minuscule');
  assert.match(BASE, /\.hello \.jour\{[^}]*display:inline-block/);
  assert.match(BASE, /\.hello \.jour::first-letter\{text-transform:uppercase\}/);
});

// ---------- Dans un vrai navigateur (un vrai Odin d'essai), à 1280 et 390 px ----------
// Ce qui tourne dans la page (page.evaluate) lit le document du navigateur.
declare const document: any, getComputedStyle: any, innerWidth: number;
type Page = any;
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<any> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const CAPTURES = process.env.ODIN_CAPTURES;
const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let od: VraiOdin, nav: any;
before(async () => {
  if (!pw) return;
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  od = await vraiOdin(tt, { compte: true });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); });
// Les pièces d'essai : ajoutées à la réponse de /api/maison/etat (un Odin d'essai n'a pas de box).
const NOMS = Array.from({ length: 9 }, (_, i) => `Pièce d'essai ${i + 1}`);
async function ouvrir(largeur: number, o: { epinglee?: boolean; pieces?: boolean } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 800 : 860 }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR' });
  const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
  if (o.epinglee) await ctx.addInitScript(() => { try { localStorage.setItem('odin.maison.barre', '1'); } catch { /* */ } });
  const page: Page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e: Error) => erreurs.push(String(e)));
  if (o.pieces) await page.route('**/api/maison/etat', async (r: any) => { const rep = await r.fetch(); const j = await rep.json(); j.rooms = NOMS.map((nom, i) => ({ name: nom, devices: [{ id: `e${i}`, name: `Appareil ${i + 1}`, kind: 'prise', state: 'off' }] })); await r.fulfill({ response: rep, json: j }); });
  await page.goto(`${od.url}/maison`);
  await page.waitForSelector('.app main .top', { timeout: 20000 });
  return { ctx, page, erreurs };
}
const visible = (p: Page, sel: string) => p.evaluate((s: string) => { const x = document.querySelector(s); if (!x) return false; const c = getComputedStyle(x), r = x.getBoundingClientRect(); return c.display !== 'none' && c.visibility === 'visible' && r.width > 0 && r.height > 0; }, sel);

test('navigateur : un Odin sans météo ni personne, le bandeau ne montre que la date et la semaine (1280 et 390)', { skip: sans }, async () => {
  for (const l of [1280, 390]) {
    const { ctx, page, erreurs } = await ouvrir(l);
    const p: string = await page.evaluate(() => document.querySelector('.top .hello p')?.textContent ?? '');
    assert.equal(p.split(' · ').length, 2, `« ${p} »`);
    assert.ok(!/°|personne/.test(p));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'rien ne déborde');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[role=tablist]').length), 0, 'aucune pièce : pas d\'onglets');
    assert.deepEqual(erreurs, []);
    await ctx.close();
  }
});

test('navigateur : un seul retour vers Odin à la fois ; le titre de la barre tient sur une ligne', { skip: sans }, async () => {
  let { ctx, page } = await ouvrir(1280, { epinglee: true });
  assert.equal(await visible(page, '.top .retour'), false, 'épinglée : le retour du bandeau se cache');
  assert.equal(await visible(page, '.side a.nav'), true, 'celui de la barre est là');
  const t = await page.evaluate(() => { const s = document.querySelector('.side .hd span'); const r = s.getBoundingClientRect(); const c = document.createElement('span'); c.textContent = s.textContent; c.style.cssText = 'position:absolute;white-space:nowrap;font:inherit'; s.append(c); const besoin = c.getBoundingClientRect().width; c.remove(); return { h: r.height, lh: parseFloat(getComputedStyle(s).lineHeight) || parseFloat(getComputedStyle(s).fontSize) * 1.4, place: r.width, besoin }; });
  assert.ok(t.h < t.lh * 1.5, `le titre sur une ligne (${t.h} px pour une ligne de ${t.lh} px ; place ${t.place} px, il en faut ${t.besoin})`);
  if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/bandeau-1280-epinglee.png` });
  await ctx.close();
  ({ ctx, page } = await ouvrir(1280));
  assert.equal(await visible(page, '.top .retour'), true, 'détachée : le retour du bandeau reste');
  await page.click('.poignee');
  await page.waitForFunction(() => document.querySelector('.side.ouverte'), undefined, { timeout: 10000 });
  assert.equal(await visible(page, '.top .retour'), false, 'détachée mais sortie : un seul retour, celui de la barre');
  assert.equal(await visible(page, '.side a.nav'), true);
  await ctx.close();
  ({ ctx, page } = await ouvrir(390, { epinglee: true }));
  assert.equal(await visible(page, '.top .retour'), true, 'au téléphone : le retour du bandeau reste');
  await ctx.close();
});

test('navigateur : les onglets filtrent, défilent de côté sans faire déborder la page, et gardent le choix et le focus au redessin', { skip: sans }, async () => {
  for (const l of [1280, 390]) {
    const { ctx, page, erreurs } = await ouvrir(l, { pieces: true });
    await page.waitForSelector('[role=tab]');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].map((x) => x.textContent)), ['Tout', ...NOMS]);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.dev').length), NOMS.length);
    const r = await page.evaluate(() => { const t = document.querySelector('.tabs'); return { deborde: t.scrollWidth > t.clientWidth, page: document.documentElement.scrollWidth > innerWidth, haut: Math.min(...[...t.querySelectorAll('[role=tab]')].map((b) => b.getBoundingClientRect().height)) }; });
    assert.equal(r.page, false, 'la page ne déborde pas');
    assert.ok(r.haut >= 44, `onglets de 44 px au moins (${r.haut})`);
    if (l === 390) assert.equal(r.deborde, true, 'au téléphone, la rangée défile de côté');
    // Au clavier : focus sur le choisi, flèche, Entrée.
    await page.focus('[role=tab][aria-selected=true]');
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent), NOMS[6]);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.dev').length), 1, 'seulement la pièce choisie');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), NOMS[6], 'le focus est sur l\'onglet choisi');
    const x0 = await page.evaluate(() => document.querySelector('.tabs').scrollLeft);
    // Le redessin automatique (le même que toutes les 15 secondes) : le choix, le focus et le défilement restent.
    await page.evaluate(() => { document.querySelector('.tabs').setAttribute('data-avant', '1'); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => !document.querySelector('.tabs')?.hasAttribute('data-avant'), undefined, { timeout: 10000 });
    assert.equal(await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent), NOMS[6]);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), NOMS[6], 'le focus n\'est pas perdu');
    assert.equal(await page.evaluate(() => document.querySelector('.tabs').scrollLeft), x0, 'la rangée garde sa place');
    if (CAPTURES) await page.screenshot({ path: `${CAPTURES}/bandeau-onglets-${l}.png` });
    assert.deepEqual(erreurs, []);
    await ctx.close();
  }
});
