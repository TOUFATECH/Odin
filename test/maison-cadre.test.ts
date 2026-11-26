// Le cadre de l'écran de la maison (/maison), première part : la barre de côté avec les mots (maquette validée).
// - La barre porte un titre (le nom de l'entrée du menu d'Odin qui ouvre cet écran), ses entrées avec leur nom écrit,
//   une punaise, le retour vers Odin, et « Odin veille » en pied.
// - La punaise, comme la maquette : NON épinglée au départ. Non épinglée, la barre se cache seule sur le côté ; elle
//   revient quand la souris approche du bord gauche, ou par une poignée posée sur ce bord, et passe alors AU-DESSUS du
//   contenu (une ombre, rien n'est décalé). Épinglée, elle reste ouverte et le contenu se décale. Sur une largeur de
//   tablette, épinglée, c'est une colonne d'icônes seules. Au téléphone : ni barre, ni poignée (la barre du bas).
//   Le choix est gardé sur l'appareil ; les deux messages de la maquette le disent.
// - Cachée, ses entrées ne se prennent ni au clavier ni par un lecteur d'écran ; ouverte par la poignée, le focus va
//   dans la barre ; Échap, le choix d'une entrée ou un appui hors de la barre la referme ; le focus revient à la poignée
//   pour Échap et le choix d'une entrée (un appui dans la page laisse le focus où il l'a mis) ; le focus qui sort de la
//   barre la referme. La poignée ne s'ouvre qu'au clic et au clavier (le bord, à la souris) ; tant que la barre glisse,
//   un clic sur elle ne fait rien. La zone de la poignée ne couvre aucun élément de la page.
// - Les sept sections d'aujourd'hui restent, avec leurs mots ; une tablette « maison » garde ses trois sections.
// - Une entrée n'apparaît que si sa page existe : aucune entrée de la maquette qui ne mène nulle part.
// - Toute cible de la barre fait 44 px au moins (lu dans la feuille de style, puis mesuré dans un vrai navigateur).
// Le script de la page (src/web/maison.js) est lu comme du texte ; sa fonction draw tourne dans un bac à sable avec un
// faux document, comme dans test/maison-garde.test.ts. Les derniers essais ouvrent un vrai Odin d'essai dans un vrai
// navigateur (ignorés, en le disant, sans Playwright sur la machine).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { T } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { valhallaOf } from '../src/valhalla/odin.ts';

const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');

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

// ---------- Un faux document : juste ce qu'il faut à el() et à la barre ----------
type Texte = { nodeType: 3; text: string };
// Un sélecteur simple : sa dernière partie (« .classe », « .classe[attr=valeur] »), plusieurs séparés par des virgules.
const partie = (sel: string) => { const m = /\.([\w-]+)(?:\[([\w-]+)=([\w-]+)\])?$/.exec(sel.trim().split(/\s+/).pop() ?? ''); assert.ok(m, `sélecteur « ${sel} »`); return { c: m[1], k: m[2], v: m[3] }; };
const correspond = (n: Noeud, sel: string) => sel.split(',').some((s) => { const p = partie(s); return classes(n).includes(p.c) && (!p.k || n.attrs[p.k] === p.v); });
class Noeud {
  nodeType = 1; attrs: Record<string, string> = {}; kids: Array<Noeud | Texte> = []; ls: Record<string, Array<(e: unknown) => unknown>> = {}; style: Record<string, string> = {}; value = ''; textContent = '';
  tag: string; parent: Noeud | null = null;
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(t: string, f: (e: unknown) => unknown) { (this.ls[t] ??= []).push(f); }
  append(...c: Array<Noeud | Texte>) { for (const k of c) if (estNoeud(k)) k.parent = this; this.kids.push(...c); }
  replaceChildren(...c: Array<Noeud | Texte>) { this.kids = []; this.append(...c); }
  focus() { actif.n = this; }
  querySelector(sel: string): Noeud | null { return tous(this, (x) => x !== this && correspond(x, sel))[0] ?? null; }
  querySelectorAll(sel: string): Noeud[] { const k = /^\[([\w-]+)\]$/.exec(sel)?.[1]; assert.ok(k, `sélecteur « ${sel} »`); return tous(this, (x) => x !== this && k in x.attrs); }
  contains(n: unknown) { return tous(this, (x) => x === n).length > 0; }
  closest(sel: string): Noeud | null { let n: Noeud | null = this; while (n) { if (correspond(n, sel)) return n; n = n.parent; } return null; }
}
// L'élément qui a le focus clavier dans le faux document (null : la page elle-même).
const actif: { n: Noeud | null } = { n: null };
const doc = {
  createElement: (t: string) => new Noeud(t), createElementNS: (_: string, t: string) => new Noeud(t),
  createTextNode: (t: string): Texte => ({ nodeType: 3, text: String(t) }), querySelector: () => null, querySelectorAll: () => [],
};
const estNoeud = (x: unknown): x is Noeud => x instanceof Noeud;
function tous(n: Noeud | Texte | undefined, ok: (x: Noeud) => boolean): Noeud[] {
  if (!n || !estNoeud(n)) return [];
  return [...(ok(n) ? [n] : []), ...n.kids.flatMap((k) => tous(k, ok))];
}
const texte = (n: Noeud): string => n.kids.map((k) => (estNoeud(k) ? texte(k) : k.text)).join('');
const lancer = (n: Noeud, t: string, e: Record<string, unknown> = {}) => { for (const f of n.ls[t] ?? []) f({ target: n, ...e }); };
const icone = (k: string) => { const n = new Noeud('svg'); n.attrs['data-icone'] = k; return n; };
const classes = (n: Noeud) => (n.attrs.class ?? '').split(/\s+/);

// ---------- L'écran (draw) dans son bac à sable ----------
type Stock = { getItem(k: string): string | null; setItem(k: string, v: string): void };
function memoire(): Stock & { m: Map<string, string> } { const m = new Map<string, string>(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)); } }; }
function ecran(stock: Stock = memoire()) {
  const marque = (nom: string) => { const n = new Noeud('vue'); n.attrs['data-vue'] = nom; return n; };
  const fenetre: { top: unknown } = { top: undefined }; fenetre.top = fenetre;
  const racine = new Noeud('div'), corps = new Noeud('body'), messages: string[] = [], ecoutes: Record<string, Array<(e: unknown) => unknown>> = {};
  corps.append(racine); actif.n = null;
  // Le faux document : cherche dans l'écran dessiné ; écoute ses évènements ; dit où est le focus.
  const document = {
    ...doc, body: corps, get activeElement() { return actif.n ?? corps; },
    querySelector: (sel: string) => racine.querySelector(sel),
    addEventListener: (t: string, f: (e: unknown) => unknown) => { (ecoutes[t] ??= []).push(f); },
  };
  const src = [
    'let D = null, view = \'accueil\', q = \'\', voice = false, key = \'\';',
    // Le bandeau (le salut, la date, la pastille) est dessiné par sa propre fonction (test/maison-bandeau.test.ts le tient).
    ligne('const MOTS = '), bloc('const el = ('), ligne('let barre = '), ligne('const retourVisible = '), ligne('function nav('), bloc('function bandeau('), bloc('function ouvrirBarre('), bloc('function ecouterBarre('),
    // La barre du bas du téléphone (quatre places, Odin au centre, « Plus ») et le plein écran : test/maison-telephone.test.ts les tient.
    ligne('let plusOuvert = '), ligne('const BAS = '), bloc('function placesBas('), ligne('function focusPlace('), ligne('const classeRacine = '), bloc('function barreBas('), bloc('function ouvrirPlus('), bloc('function boutonPlein('), bloc('function basculerPlein('), bloc('function draw() {'),
    'ecouterBarre();',
    '({ draw, regler(d, k) { D = d; key = k; view = \'accueil\'; } });',
  ].join('\n');
  const e = vm.runInNewContext(src, {
    document, window: fenetre, root: racine, icon: icone, hello: () => '', week: () => 1, drawSoon: () => {}, startCams: () => {},
    dansOdin: false, secs: () => null, toast: (t: string) => { messages.push(t); }, setTimeout: (f: () => void) => { f(); return 0; }, clearTimeout: () => {},
    pet: { news: () => {}, say: () => {} }, localStorage: stock,
    home: () => [marque('accueil')], appsView: () => [marque('applis')], peopleGrid: () => marque('famille'), camGrid: (grand: boolean) => marque(grand ? 'cameras' : 'cameras-accueil'),
    netView: () => [marque('reseau')], tilesView: (grand: boolean) => [marque(grand ? 'boutons' : 'boutons-accueil')], themesView: () => [marque('themes')],
  }) as { draw: () => void; regler: (d: unknown, k: string) => void };
  const parClasse = (c: string) => racine.kids.find((x): x is Noeud => estNoeud(x) && classes(x).includes(c)) ?? null;
  return {
    dessiner(rights: string, cle = '', cadre = false) { fenetre.top = cadre ? {} : fenetre; e.regler({ rights, notices: [], name: '' }, cle); e.draw(); },
    // La barre de côté, la page, la barre du bas (téléphone) ; la poignée et le bord (seulement non épinglée).
    cote: () => { const n = parClasse('side'); assert.ok(n, 'la barre de côté'); return n; },
    bas: () => { const n = parClasse('bnav'); assert.ok(n, 'la barre du bas'); return n; },
    page: () => { const n = racine.kids.find((x): x is Noeud => estNoeud(x) && x.tag === 'main'); assert.ok(n, 'la page'); return n; },
    poignee: () => parClasse('poignee'), bord: () => parClasse('bord'), racine,
    vues: () => tous(racine.kids.find((x): x is Noeud => estNoeud(x) && x.tag === 'main'), (x) => x.tag === 'vue').map((x) => x.attrs['data-vue']),
    // Un évènement reçu par toute la page (Échap, un appui ailleurs).
    page_: (t: string, ev: Record<string, unknown>) => { for (const f of ecoutes[t] ?? []) f(ev); },
    messages,
  };
}
const entrees = (n: Noeud) => tous(n, (x) => x.tag === 'button' && classes(x).includes('nav'));
const punaise = (n: Noeud) => { const b = tous(n, (x) => x.tag === 'button' && classes(x).includes('pinb')); assert.equal(b.length, 1, 'une punaise'); return b[0]; };
const SEPT = ['Accueil', 'Famille', 'Caméras', 'Réseau', 'Mes applis', 'Boutons', 'Thèmes'];
const TROIS = ['Accueil', 'Boutons', 'Thèmes'];
const CLE = `gk_${'c'.repeat(40)}`;
// Les deux messages de la maquette, mot pour mot.
const EPINGLEE = 'La barre reste ouverte.';
const LIBRE = 'La barre se cache seule ; passe la souris à gauche pour la voir.';
// La barre est-elle cachée (non épinglée, fermée) : sa classe, et « inert » (ni clavier, ni lecteur d'écran).
const cachee = (n: Noeud) => classes(n).includes('libre') && !classes(n).includes('ouverte') && n.attrs.inert === '';
const ouverteDessus = (n: Noeud) => classes(n).includes('libre') && classes(n).includes('ouverte') && n.attrs.inert === undefined;

// Le style commun de la page (la feuille de style écrite dans maison.js).
const BASE = (() => { const b = MAISON.indexOf('const BASE = `'); const f = MAISON.indexOf('`;\n', b + 14); assert.ok(b > 0 && f > b, 'le style commun'); return MAISON.slice(b, f); })();
const regle = (sel: string, ou = BASE) => { const i = ou.indexOf(`${sel}{`); assert.ok(i >= 0, `règle « ${sel} » introuvable`); return ou.slice(i, ou.indexOf('}', i) + 1); };
// Le contenu d'un bloc @media de la feuille de style (le premier qui commence ainsi).
const media = (debut: string) => { const i = BASE.indexOf(`@media ${debut}{`); assert.ok(i >= 0, `@media ${debut} introuvable`); let p = 0, j = BASE.indexOf('{', i); for (; j < BASE.length; j++) { if (BASE[j] === '{') p++; else if (BASE[j] === '}' && --p === 0) break; } return BASE.slice(i, j + 1); };

test('entrées selon les droits : la session a les sept sections, chacune avec son nom écrit ; une tablette « maison » en a trois', () => {
  const e = ecran();
  e.dessiner('complet');
  const b = entrees(e.cote());
  assert.deepEqual(b.map((x) => texte(x)), SEPT, 'le nom de chaque section est écrit dans la barre');
  for (const x of b) { assert.equal(x.attrs['aria-label'], texte(x)); assert.equal(x.attrs.title, texte(x)); }
  e.dessiner('maison', CLE);
  assert.deepEqual(entrees(e.cote()).map((x) => texte(x)), TROIS);
  e.dessiner('autre', CLE);
  assert.deepEqual(entrees(e.cote()).map((x) => texte(x)), TROIS, 'un droit inconnu n\'a pas plus qu\'une tablette « maison »');
});

test('aucune entrée vide : chaque entrée ouvre sa propre page ; les entrées de la maquette sans page n\'y sont pas', () => {
  const e = ecran(); e.dessiner('complet');
  const vues: string[] = [];
  for (let i = 0; i < entrees(e.cote()).length; i++) { lancer(entrees(e.cote())[i], 'click'); vues.push(e.vues()[0]); }
  assert.deepEqual(vues, ['accueil', 'famille', 'cameras', 'reseau', 'applis', 'boutons', 'themes']);
  assert.equal(new Set(vues).size, vues.length, 'deux entrées n\'ouvrent jamais la même page');
  const mots = entrees(e.cote()).map((x) => texte(x));
  for (const m of ['Énergie', 'Journal', 'Automatisations', 'Médias', 'Maison 3D', 'Humeurs d\'Odin']) assert.ok(!mots.includes(m), `« ${m} » : pas de page sur cet écran, pas d'entrée`);
  for (const x of entrees(e.cote())) assert.ok(texte(x).trim().length > 0, 'aucune entrée sans nom');
});

test('le titre de la barre est le nom de l\'entrée du menu d\'Odin qui ouvre cet écran ; « Odin veille » en pied', () => {
  const nom = /id="navMaison"[^>]*>[\s\S]*?<span class="lbl">([^<]+)<\/span>/.exec(UI)?.[1];
  assert.ok(nom, 'l\'entrée du menu d\'Odin');
  const e = ecran(); e.dessiner('complet');
  const hd = tous(e.cote(), (x) => classes(x).includes('hd'));
  assert.equal(hd.length, 1, 'un en-tête');
  assert.equal(texte(hd[0]).replace('ᛟ', '').trim(), nom);
  const pied = tous(e.cote(), (x) => classes(x).includes('veille'));
  assert.equal(pied.length, 1); assert.equal(texte(pied[0]), 'Odin veille');
});

// La maquette (logique.js : « S.pin ??= false ») : la barre n'est pas épinglée au départ.
test('non épinglée au départ : la barre est cachée (ni clavier, ni lecteur d\'écran), le contenu prend toute la largeur ; une poignée nommée et un bord pour l\'ouvrir', () => {
  const e = ecran(); e.dessiner('complet');
  assert.ok(cachee(e.cote()), `barre cachée : ${JSON.stringify(e.cote().attrs)}`);
  assert.equal(punaise(e.cote()).attrs['aria-pressed'], 'false');
  assert.equal(e.racine.attrs.class, 'app libre', 'le contenu n\'est pas décalé');
  const p = e.poignee(); assert.ok(p, 'la poignée');
  assert.equal(p.tag, 'button', 'un vrai bouton'); assert.equal(p.attrs.type, 'button');
  assert.equal(p.attrs['aria-label'], 'Ouvrir le menu', 'le nom de la poignée de la maquette');
  assert.equal(p.attrs['aria-expanded'], 'false', 'son état');
  assert.equal(p.attrs['aria-controls'], e.cote().attrs.id, 'elle dit quelle barre elle ouvre'); assert.ok(e.cote().attrs.id);
  assert.equal(e.racine.kids.indexOf(p), 0, 'la poignée vient en premier au clavier (avant le contenu)');
  const b = e.bord(); assert.ok(b, 'le bord'); assert.equal(b.attrs['aria-hidden'], 'true', 'le bord ne se lit pas');
  assert.equal(tous(b, (x) => x.tag === 'button' || x.tag === 'a').length, 0, 'le bord n\'est pas une cible du clavier');
});

test('grand écran non épinglé : la poignée ouvre la barre au-dessus du contenu, le focus va dans la barre ; Échap la referme et le focus revient à la poignée', () => {
  const e = ecran(); e.dessiner('complet');
  lancer(e.poignee()!, 'click');
  assert.ok(ouverteDessus(e.cote()), `ouverte : ${JSON.stringify(e.cote().attrs)}`);
  assert.equal(e.racine.attrs.class, 'app libre', 'ouverte, elle ne décale pas le contenu');
  assert.equal(e.poignee()!.attrs['aria-expanded'], 'true');
  assert.ok(e.cote().contains(actif.n), 'le focus est dans la barre');
  assert.equal(actif.n?.attrs['aria-current'], 'page', 'sur l\'entrée de la page ouverte');
  e.page_('keydown', { key: 'Escape' });
  assert.ok(cachee(e.cote()), 'Échap la referme'); assert.equal(e.poignee()!.attrs['aria-expanded'], 'false');
  assert.equal(actif.n, e.poignee(), 'le focus revient à la poignée');
  // Une autre touche ne la referme pas.
  lancer(e.poignee()!, 'click'); e.page_('keydown', { key: 'a' });
  assert.ok(ouverteDessus(e.cote()));
});

test('grand écran non épinglé : le choix d\'une entrée ouvre sa page, referme la barre, et le focus revient à la poignée', () => {
  const e = ecran(); e.dessiner('complet');
  lancer(e.poignee()!, 'click');
  const b = entrees(e.cote()).find((x) => texte(x) === 'Boutons')!;
  lancer(b, 'click');
  assert.deepEqual(e.vues(), ['boutons']);
  assert.ok(cachee(e.cote()), 'refermée');
  assert.equal(actif.n, e.poignee(), 'le focus revient à la poignée');
});

// Suivi (relecture adverse, point 5) : un appui dans la page ne renvoie plus le focus à la poignée (avant : oui, s'il était
// dans la barre) ; il reste où l'appui l'a mis.
test('grand écran non épinglé : un appui hors de la barre la referme ; le focus reste où l\'appui l\'a mis (jamais renvoyé à la poignée)', () => {
  const e = ecran(); e.dessiner('complet');
  lancer(e.poignee()!, 'click');
  // Un appui dans la barre ne la referme pas.
  e.page_('click', { target: entrees(e.cote())[1] });
  assert.ok(ouverteDessus(e.cote()));
  e.page_('click', { target: e.page() });
  assert.ok(cachee(e.cote()), 'un appui ailleurs la referme');
  assert.notEqual(actif.n, e.poignee(), 'le focus n\'est pas renvoyé à la poignée');
  lancer(e.poignee()!, 'click');
  const champ = new Noeud('input'); e.page().append(champ); champ.focus();
  e.page_('click', { target: champ });
  assert.ok(cachee(e.cote())); assert.equal(actif.n, champ, 'le champ touché garde le focus');
});

// Suivi (relecture adverse, points 1 et 4) : la souris sur la poignée ne l'ouvre plus (avant : oui) ; le départ de la
// souris ne referme que la barre que la souris a ouverte.
test('grand écran non épinglé : la souris au bord gauche ouvre la barre sans prendre le focus et la referme en partant ; sur la poignée, la souris n\'ouvre rien (seul le clic) ; au doigt, seul l\'appui sur la poignée compte ; ouverte au clavier, la souris qui passe ne la referme pas', () => {
  const e = ecran(); e.dessiner('complet');
  lancer(e.bord()!, 'pointerenter', { pointerType: 'touch' });
  assert.ok(cachee(e.cote()), 'un doigt qui glisse sur le bord n\'ouvre rien');
  lancer(e.bord()!, 'pointerenter', { pointerType: 'mouse' });
  assert.ok(ouverteDessus(e.cote()), 'la souris au bord l\'ouvre');
  assert.equal(actif.n, null, 'sans prendre le focus');
  lancer(e.cote(), 'pointerleave', { pointerType: 'mouse' });
  assert.ok(cachee(e.cote()), 'la souris la quitte : elle se cache');
  lancer(e.poignee()!, 'pointerenter', { pointerType: 'mouse' });
  assert.ok(cachee(e.cote()), 'la souris sur la poignée n\'ouvre rien');
  lancer(e.poignee()!, 'click');
  assert.ok(ouverteDessus(e.cote()));
  lancer(e.cote(), 'pointerleave', { pointerType: 'mouse' });
  assert.ok(ouverteDessus(e.cote()), 'ouverte au clic ou au clavier : la souris qui part ne la referme pas');
});

test('épinglée : la barre reste ouverte, le contenu se décale, ni poignée ni bord ; le choix est gardé après rechargement (même clé) ; les deux messages de la maquette', () => {
  const s = memoire(), e = ecran(s);
  e.dessiner('complet');
  lancer(e.poignee()!, 'click');
  lancer(punaise(e.cote()), 'click');
  assert.deepEqual(e.messages, [EPINGLEE]);
  assert.equal(s.m.get('odin.maison.barre'), '1', 'gardé sur l\'appareil');
  assert.equal(e.cote().attrs.class, 'side', 'épinglée'); assert.equal(e.cote().attrs.inert, undefined);
  assert.equal(e.racine.attrs.class, 'app', 'le contenu se décale (la barre a sa colonne)');
  assert.equal(e.poignee(), null); assert.equal(e.bord(), null);
  assert.equal(punaise(e.cote()).attrs['aria-pressed'], 'true');
  for (const x of entrees(e.cote())) { assert.ok(SEPT.includes(x.attrs['aria-label'])); assert.equal(x.attrs.title, x.attrs['aria-label']); }
  // Une autre page ouverte sur le même appareil (rechargement) retrouve la barre épinglée.
  const e2 = ecran(s); e2.dessiner('complet');
  assert.equal(e2.cote().attrs.class, 'side'); assert.equal(e2.poignee(), null);
  // Désépinglée : le second message ; elle reste ouverte tant qu'on y est (la souris, le focus sur la punaise).
  lancer(punaise(e2.cote()), 'click');
  assert.deepEqual(e2.messages, [LIBRE]);
  assert.equal(s.m.get('odin.maison.barre'), '0');
  assert.ok(ouverteDessus(e2.cote()), 'encore ouverte, au-dessus du contenu');
  assert.ok(e2.poignee(), 'la poignée revient');
  e2.page_('keydown', { key: 'Escape' });
  assert.ok(cachee(e2.cote()));
  // Rechargée : non épinglée, cachée.
  const e3 = ecran(s); e3.dessiner('complet'); assert.ok(cachee(e3.cote()));
});

test('la punaise sans stockage (navigation privée) : la barre commence non épinglée et s\'épingle quand même', () => {
  const casse: Stock = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } };
  const e = ecran(casse); e.dessiner('complet');
  assert.ok(cachee(e.cote()));
  lancer(e.poignee()!, 'click'); lancer(punaise(e.cote()), 'click');
  assert.equal(e.cote().attrs.class, 'side');
});

test('le retour vers Odin dans la barre : là pour une session, la page seule ; absent avec une clé de tablette et dans un cadre', () => {
  const e = ecran();
  const retour = () => tous(e.cote(), (x) => x.tag === 'a' && x.attrs.href === '/');
  e.dessiner('complet'); assert.equal(retour().length, 1);
  assert.ok(texte(retour()[0]).trim().length > 0 && retour()[0].attrs['aria-label'] && retour()[0].attrs.title, 'nommé, écrit et en info-bulle');
  e.dessiner('complet', CLE); assert.equal(retour().length, 0);
  e.dessiner('maison', CLE); assert.equal(retour().length, 0);
  e.dessiner('complet', '', true); assert.equal(retour().length, 0);
});

// La barre du bas a changé avec le téléphone (sa réponse : quatre places et Odin au centre, dont « Plus » ; tenu par
// test/maison-telephone.test.ts) : chaque place a son nom écrit, comme la maquette ; la barre et la feuille « Plus »
// ensemble ont toujours les sept sections, chacune une fois.
test('la barre du bas (téléphone) : avec sa feuille « Plus », les mêmes sections, chacune avec son nom', () => {
  const e = ecran(); e.dessiner('complet');
  const f = e.racine.kids.find((x): x is Noeud => estNoeud(x) && classes(x).includes('feuille'));
  assert.ok(f, 'la feuille « Plus »');
  const b = [...entrees(e.bas()), ...entrees(f)].filter((x) => !classes(x).includes('plus'));
  assert.equal(b.length, 7);
  for (const x of b) { assert.equal(texte(x), x.attrs['aria-label'], 'le nom écrit'); assert.ok(SEPT.includes(x.attrs['aria-label'])); }
  assert.deepEqual(b.map((x) => x.attrs['aria-label']).sort(), [...SEPT].sort());
});

test('feuille de style, comme la maquette : cachée sur le côté, au-dessus du contenu avec une ombre une fois ouverte ; tablette épinglée en icônes seules ; ni barre ni poignée au téléphone ; pas de glissement si l\'appareil demande moins d\'animations', () => {
  assert.match(regle('.side .nav'), /min-height:44px/);
  assert.match(regle('.pinb'), /width:44px;height:44px/);
  assert.match(regle('.side'), /width:232px/);
  // Non épinglée : hors de l'écran, invisible (ni clavier ni lecteur d'écran), au-dessus du contenu, sans le décaler.
  assert.match(regle('.app.libre'), /grid-template-columns:1fr/);
  const libre = regle('.side.libre');
  for (const r of [/position:fixed/, /transform:translateX\(-105%\)/, /visibility:hidden/, /z-index:30/]) assert.match(libre, r);
  const ouverte = regle('.side.libre.ouverte');
  for (const r of [/transform:none/, /visibility:visible/, /box-shadow:20px 0 50px/]) assert.match(ouverte, r);
  // La poignée : dessinée étroite (22 px, comme la maquette), touchable sur 44 px au moins ; cachée une fois la barre ouverte.
  const p = regle('.poignee');
  assert.ok(Number(/width:(\d+)px/.exec(p)?.[1]) >= 44 && Number(/height:(\d+)px/.exec(p)?.[1]) >= 44, `zone de 44 px : ${p}`);
  assert.match(regle('.poignee::before'), /width:22px/);
  assert.match(regle('.poignee[aria-expanded=true]'), /display:none/);
  assert.match(regle('.bord'), /width:14px/);
  // La poignée passe au-dessus du bord (sinon le bord prendrait l'appui sur la moitié de la poignée).
  assert.ok(Number(/z-index:(\d+)/.exec(p)?.[1]) > Number(/z-index:(\d+)/.exec(regle('.bord'))?.[1]));
  // Tablette (de 821 à 1099 px, la coupure de la maquette : « w < 1100 ») épinglée : une colonne d'icônes.
  const tab = media('(min-width:821px) and (max-width:1099px)');
  assert.match(regle('.side:not(.libre)', tab), /width:76px/);
  assert.match(tab, /\.side:not\(\.libre\) \.hd span,\.side:not\(\.libre\) \.nav span,\.side:not\(\.libre\) \.veille\{display:none\}/, 'les mots sont cachés');
  assert.match(regle('.side:not(.libre) .nav', tab), /width:48px;min-height:48px/);
  // Au téléphone : la barre de côté reste cachée (la coupure d'avant), et ni poignée ni bord.
  assert.match(BASE, /@media \(max-width:820px\)\{\.app\{grid-template-columns:1fr\}\.side\{display:none\}/, 'au téléphone : la barre de côté reste cachée');
  assert.match(BASE, /@media \(max-width:820px\)\{\.poignee,\.bord\{display:none\}\}/);
  assert.match(BASE, /@media \(prefers-reduced-motion:reduce\)\{\.side\.libre,\.side\.libre\.ouverte\{transition:none\}\}/);
});

test('les textes de la barre sont à un seul endroit du fichier', () => {
  const MOTS = ligne('const MOTS = ');
  for (const m of [...SEPT, 'Odin veille', 'Garder la barre ouverte', 'Ouvrir le menu', EPINGLEE, LIBRE]) assert.ok(MOTS.includes(`'${m}'`), `« ${m} » dans MOTS`);
  const draw = bloc('function draw() {'), nav = ligne('function nav('), ouvrir = bloc('function ouvrirBarre(');
  for (const m of [...SEPT.filter((x) => !['Famille', 'Caméras'].includes(x)), 'Odin veille', 'Garder la barre ouverte', 'Home Assistant', 'Ouvrir le menu', EPINGLEE, LIBRE]) {
    assert.ok(!draw.includes(`'${m}'`) && !nav.includes(`'${m}'`) && !ouvrir.includes(`'${m}'`), `« ${m} » n'est pas écrit dans draw`);
  }
});

test('aucune icône avec une bouche, aucune mascotte dans la barre', () => {
  const e = ecran(); e.dessiner('complet');
  const ic = tous(e.cote(), (x) => x.tag === 'svg').map((x) => x.attrs['data-icone']);
  assert.ok(!ic.includes('smile'));
  assert.equal(tous(e.cote(), (x) => classes(x).some((c) => /odin|nest|pet/.test(c))).length, 0);
});

test("la punaise au clavier : après l'appui, le focus reste sur la punaise redessinée (il ne retombe pas sur la page)", () => {
  const e = ecran(); e.dessiner('complet');
  lancer(e.poignee()!, 'click');
  const avant = punaise(e.cote()); avant.focus();
  lancer(avant, 'click');
  const apres = punaise(e.cote());
  assert.notEqual(apres, avant, 'la barre est redessinée');
  assert.equal(actif.n, apres, 'le focus est sur la nouvelle punaise');
  lancer(apres, 'click');
  assert.equal(actif.n, punaise(e.cote()), 'et encore au second appui');
  assert.ok(ouverteDessus(e.cote()), 'désépinglée au clavier, la barre reste ouverte : la punaise qui a le focus reste visible');
});

test("contraste : l'entrée choisie et la punaise enfoncée de la barre de côté sont écrites en couleur de texte, jamais en accent (illisible sur un thème clair)", () => {
  assert.match(regle('.side .nav[aria-current=page]'), /color:var\(--text\)/);
  assert.match(regle('.pinb[aria-pressed=true]'), /color:var\(--text\)/);
  assert.doesNotMatch(regle('.pinb[aria-pressed=true]'), /--accent/);
  // L'entrée choisie de la barre de côté ne reprend pas l'accent par une autre règle placée après.
  const i = BASE.indexOf('.side .nav[aria-current=page]{');
  assert.doesNotMatch(BASE.slice(i + 1).split('@media')[0], /\.side[^{}]*\[aria-current=page\][^{}]*\{[^}]*color:var\(--accent\)/);
});

test("les lecteurs d'écran nomment la barre de côté par son titre, et la barre du bas garde son nom", () => {
  const e = ecran(); e.dessiner('complet');
  assert.equal(e.cote().attrs['aria-label'], 'Home Assistant');
  assert.equal(e.bas().attrs['aria-label'], 'Sections');
});

// ---------- Dans un vrai navigateur, avec un vrai Odin d'essai ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const window: any, document: any, getComputedStyle: any, innerWidth: number;
interface Page {
  goto(u: string): Promise<unknown>; reload(): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<R>(f: string | ((a: any) => R), a?: unknown): Promise<R>;
  focus(s: string): Promise<void>; keyboard: { press(k: string): Promise<void> }; mouse: { move(x: number, y: number): Promise<void>; click(x: number, y: number): Promise<void> };
  waitForTimeout(ms: number): Promise<void>; screenshot(o: Record<string, unknown>): Promise<unknown>; on(e: string, f: (x: Error) => void): void;
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: () => void): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
// Captures facultatives (ODIN_CAPTURES=<dossier>) : pour regarder l'écran, jamais exigées par l'essai.
const CAPTURES = process.env.ODIN_CAPTURES;
const capture = async (p: Page, nom: string) => { if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/${nom}.png` }); };

const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
let od: VraiOdin, nav: Navigateur;
before(async () => {
  if (!pw) return;
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  od = await vraiOdin(tt, { compte: true });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); });

async function ouvrir(largeur: number, o: { cle?: string; moins?: boolean; hauteur?: number } = {}) {
  const doigt = largeur < 500;
  const ctx = await nav.newContext({ viewport: { width: largeur, height: o.hauteur ?? (doigt ? 800 : 860) }, hasTouch: doigt, isMobile: doigt, locale: 'fr-FR', ...(o.moins ? { reducedMotion: 'reduce' } : {}) });
  if (!o.cle) { const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]); }
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.goto(`${od.url}/maison${o.cle ? `#cle=${o.cle}` : ''}`);
  await page.waitForSelector('.app main .top', { timeout: 20000 });
  return { ctx, page, erreurs };
}
// Ce que la page montre de la barre : visible, où, sa largeur, le décalage du contenu, le focus, les mots, le débordement.
const etat = (p: Page) => p.evaluate(() => {
  const s = document.querySelector('.side'), r = s.getBoundingClientRect(), cs = getComputedStyle(s), m = document.querySelector('main').getBoundingClientRect();
  const h = document.querySelector('.poignee'), hr = h?.getBoundingClientRect(), a = document.activeElement;
  const mot = s.querySelector('.nav span');
  return {
    vue: cs.display !== 'none' && cs.visibility === 'visible' && r.right > 0, gauche: Math.round(r.left), large: Math.round(r.width), ombre: cs.boxShadow !== 'none',
    contenu: Math.round(m.left), focusBarre: s.contains(a), focusPoignee: Boolean(h) && a === h, courant: a?.getAttribute?.('aria-current') ?? null,
    poignee: h && getComputedStyle(h).display !== 'none' ? { l: Math.round(hr.width), h: Math.round(hr.height), x: Math.round(hr.left), ouverte: h.getAttribute('aria-expanded') } : null,
    mots: Boolean(mot) && getComputedStyle(mot).display !== 'none', epinglee: !s.classList.contains('libre'),
    deborde: document.documentElement.scrollWidth > innerWidth, message: document.querySelector('.toast')?.textContent ?? null,
    entrees: s.querySelectorAll('.nav').length,
  };
});
const fini = (p: Page) => p.waitForTimeout(450); // le glissement de la barre (0,35 s)
// Tab, n fois, depuis le début de la page (vrai clavier) : le premier élément pris, et si la poignée ou une entrée de la
// barre a été prise.
async function tabulations(p: Page, n: number) {
  await p.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  const out = { premier: '', poignee: false, barre: false };
  for (let i = 0; i < n; i++) {
    await p.keyboard.press('Tab');
    const v = await p.evaluate(() => { const a = document.activeElement; return { c: String(a?.className ?? ''), poignee: a?.classList?.contains('poignee') ?? false, barre: Boolean(document.querySelector('.side')?.contains(a)) }; });
    if (i === 0) out.premier = v.c;
    out.poignee ||= v.poignee; out.barre ||= v.barre;
  }
  return out;
}

test('navigateur, 1280 px, avec sa session : non épinglée au départ, cachée et hors du clavier ; la poignée (44 px) l\'ouvre au-dessus du contenu ; Échap, un choix, un appui ailleurs la referment ; la souris au bord', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    let e = await etat(page);
    assert.equal(e.epinglee, false, 'non épinglée au départ');
    assert.equal(e.vue, false, 'cachée'); assert.ok(e.contenu < 40, `le contenu prend toute la largeur : ${e.contenu}`);
    assert.ok(e.poignee && e.poignee.l >= 44 && e.poignee.h >= 44 && e.poignee.x === 0, `poignée touchable sur 44 px au bord gauche : ${JSON.stringify(e.poignee)}`);
    assert.equal(e.deborde, false);
    const t = await tabulations(page, 60);
    assert.equal(t.premier, 'poignee', 'la poignée vient la première au clavier'); assert.equal(t.barre, false, 'aucune entrée de la barre cachée n\'est prise au clavier');
    assert.equal(await page.evaluate(() => document.querySelector('.side').hasAttribute('inert')), true, 'ni clavier ni lecteur d\'écran');
    // Au clavier : la poignée l'ouvre, le focus va dans la barre, sur la page ouverte.
    await page.focus('.poignee'); await page.keyboard.press('Enter'); await fini(page);
    e = await etat(page);
    assert.ok(e.vue && e.gauche === 0 && e.large === 232 && e.ombre, `ouverte au-dessus : ${JSON.stringify(e)}`);
    assert.ok(e.contenu < 40, 'le contenu n\'est pas décalé'); assert.ok(e.mots, 'avec ses mots');
    assert.ok(e.focusBarre && e.courant === 'page', 'le focus est dans la barre, sur l\'entrée de la page ouverte');
    assert.equal(e.poignee, null, 'la poignée se cache sous la barre ouverte (maquette)');
    await capture(page, 'maison-1280-ouverte-poignee');
    await page.keyboard.press('Escape'); await fini(page);
    e = await etat(page);
    assert.ok(!e.vue && e.focusPoignee && e.poignee?.ouverte === 'false', `Échap : refermée, focus sur la poignée : ${JSON.stringify(e)}`);
    // Le choix d'une entrée : sa page s'ouvre, la barre se referme, le focus revient à la poignée.
    await page.keyboard.press('Enter'); await fini(page);
    await page.evaluate(() => [...document.querySelectorAll('.side .nav')].find((x: any) => x.textContent === 'Boutons').focus());
    await page.keyboard.press('Enter'); await fini(page);
    e = await etat(page);
    assert.ok(!e.vue && e.focusPoignee, `un choix : refermée, focus sur la poignée : ${JSON.stringify(e)}`);
    assert.equal(await page.evaluate(() => document.querySelector('.side .nav[aria-current=page]').textContent), 'Boutons');
    // Un appui hors de la barre : refermée ; le focus n'est pas renvoyé à la poignée (suivi : relecture adverse, point 5).
    await page.keyboard.press('Enter'); await fini(page);
    await page.mouse.click(300, 40); await fini(page);
    e = await etat(page); assert.ok(!e.vue && !e.focusPoignee, `un appui ailleurs : refermée : ${JSON.stringify(e)}`);
    // La souris au bord gauche l'ouvre (sans prendre le focus) ; partie de la barre, elle se cache.
    await page.mouse.move(700, 120); await page.mouse.move(4, 120); await fini(page);
    e = await etat(page); assert.ok(e.vue && !e.focusBarre, `la souris au bord : ${JSON.stringify(e)}`);
    await page.mouse.move(100, 300); await page.mouse.move(800, 300); await page.waitForTimeout(1000);
    e = await etat(page); assert.equal(e.vue, false, 'la souris partie : cachée');
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : épinglée, elle reste ouverte et le contenu se décale, après rechargement aussi ; les deux messages ; tablette épinglée en icônes seules, tablette non épinglée cachée', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await page.focus('.poignee'); await page.keyboard.press('Enter'); await fini(page);
    await page.focus('.side .pinb'); await page.keyboard.press('Enter'); await fini(page);
    let e = await etat(page);
    assert.equal(e.message, EPINGLEE);
    assert.ok(e.epinglee && e.vue && e.large === 232 && e.contenu >= 232 && e.poignee === null && !e.deborde, `épinglée : ${JSON.stringify(e)}`);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'pinb', 'le focus reste sur la punaise');
    await page.reload(); await page.waitForSelector('.app main .top', { timeout: 20000 });
    e = await etat(page); assert.ok(e.epinglee && e.vue && e.contenu >= 232, `gardée après rechargement : ${JSON.stringify(e)}`);
    await capture(page, 'maison-1280-epinglee');
  } finally { await ctx.close(); }
  // Un autre appareil, à la largeur d'une tablette (1000 px) : non épinglé au départ, caché ; ouvert, avec ses mots.
  const t = await ouvrir(1000);
  try {
    let e = await etat(t.page);
    assert.ok(!e.epinglee && !e.vue && e.contenu < 40 && e.poignee && e.poignee.l >= 44 && !e.deborde, `tablette non épinglée : cachée : ${JSON.stringify(e)}`);
    await capture(t.page, 'maison-1000-non-epinglee');
    await t.page.focus('.poignee'); await t.page.keyboard.press('Enter'); await fini(t.page);
    e = await etat(t.page); assert.ok(e.vue && e.large === 232 && e.mots && e.contenu < 40, `ouverte : au-dessus, avec ses mots : ${JSON.stringify(e)}`);
    await t.page.focus('.side .pinb'); await t.page.keyboard.press('Enter'); await fini(t.page);
    e = await etat(t.page);
    assert.ok(e.epinglee && e.vue && e.large === 76 && !e.mots && e.contenu >= 76 && e.contenu < 120 && !e.deborde, `tablette épinglée : icônes seules : ${JSON.stringify(e)}`);
    const cibles = await t.page.evaluate(() => [...document.querySelectorAll('.side button,.side a')].filter((x: any) => getComputedStyle(x).display !== 'none').map((x: any) => { const r = x.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    assert.ok(cibles.length > 0 && cibles.every((c: number) => c >= 44), `cibles de 44 px : ${cibles}`);
    // La punaise reste là sur la colonne : on peut la désépingler.
    await t.page.focus('.side .pinb'); await t.page.keyboard.press('Enter'); await fini(t.page);
    e = await etat(t.page); assert.equal(e.message, LIBRE); assert.equal(e.epinglee, false);
    assert.deepEqual(t.erreurs, []); assert.deepEqual(erreurs, []);
  } finally { await t.ctx.close(); }
});

test('navigateur, 390 px : ni barre de côté ni poignée, la barre du bas comme avant ; rien ne déborde', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(390);
  try {
    const e = await page.evaluate(() => ({
      cote: getComputedStyle(document.querySelector('.side')).display, poignee: getComputedStyle(document.querySelector('.poignee')).display,
      bord: getComputedStyle(document.querySelector('.bord')).display, bas: getComputedStyle(document.querySelector('.bnav')).display, deborde: document.documentElement.scrollWidth > innerWidth,
    }));
    assert.deepEqual(e, { cote: 'none', poignee: 'none', bord: 'none', bas: 'flex', deborde: false });
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, 1280 px, avec une clé de tablette « maison » : trois entrées, la même barre cachée qui s\'ouvre et se referme au clavier', { skip: sans }, async () => {
  const k = await valhallaOf()!.act('gladsheim', 'cle_tablette', { nom: `Tablette ${Date.now()}`, droits: 'maison' });
  const cle = (k.data as { key?: string } | undefined)?.key ?? '';
  assert.match(cle, /^gk_/);
  const { ctx, page, erreurs } = await ouvrir(1280, { cle });
  try {
    let e = await etat(page);
    assert.ok(!e.epinglee && !e.vue && e.entrees === 3, `tablette « maison » : ${JSON.stringify(e)}`);
    await page.focus('.poignee'); await page.keyboard.press('Enter'); await fini(page);
    e = await etat(page); assert.ok(e.vue && e.focusBarre, `ouverte : ${JSON.stringify(e)}`);
    await page.keyboard.press('Escape'); await fini(page);
    e = await etat(page); assert.ok(!e.vue && e.focusPoignee);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur : la barre glisse (0,35 s) ; « moins d\'animations » demandé par l\'appareil, elle ne glisse pas', { skip: sans }, async () => {
  const duree = async (moins: boolean) => {
    const { ctx, page } = await ouvrir(1280, { moins });
    try { return await page.evaluate(() => getComputedStyle(document.querySelector('.side')).transitionDuration); } finally { await ctx.close(); }
  };
  assert.match(await duree(false), /0\.35s/, 'sans la demande : le glissement de la maquette');
  assert.match(await duree(true), /^0s(, 0s)*$/);
});

// ---------- Relecture adverse : les pièges de la barre cachée, dans un vrai navigateur ----------
// L'entrée marquée « page » de la barre (la section ouverte).
const section = (p: Page) => p.evaluate(() => document.querySelector('.side .nav[aria-current=page]')?.textContent ?? '');
const centre = (p: Page, sel: string) => p.evaluate((s: string) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }, sel);
const centreEntree = (p: Page, nom: string) => p.evaluate((n: string) => { const r = [...document.querySelectorAll('.side .nav')].find((x: any) => x.textContent === n).getBoundingClientRect(); return Math.round(r.top + r.height / 2); }, nom);

test('navigateur, clic détourné : la souris sur la poignée puis un clic, à 1280 × 600 et 1280 × 700 → la barre s\'ouvre, la section ne change pas ; au bord, un clic pendant le glissement ne fait rien ; barre vue, un clic sur une entrée marche', { skip: sans }, async () => {
  for (const hauteur of [600, 700]) {
    const { ctx, page, erreurs } = await ouvrir(1280, { hauteur });
    try {
      assert.equal(await section(page), 'Accueil');
      const c = await centre(page, '.poignee');
      await page.mouse.move(c.x, c.y); await page.waitForTimeout(120); await page.mouse.click(c.x, c.y); await fini(page);
      let e = await etat(page);
      assert.equal(await section(page), 'Accueil', `${hauteur} px : le clic sur la poignée n'ouvre aucune section`);
      assert.ok(e.vue, `${hauteur} px : la barre est ouverte : ${JSON.stringify(e)}`);
      await page.keyboard.press('Escape'); await page.mouse.move(800, 300); await fini(page);
      // La souris au bord, à la hauteur de « Famille » (loin de la poignée), puis un clic pendant que la barre glisse : rien.
      const y = await centreEntree(page, 'Famille');
      await page.mouse.move(4, y); await page.waitForTimeout(150); await page.mouse.click(60, y); await fini(page);
      assert.equal(await section(page), 'Accueil', `${hauteur} px : un clic pendant le glissement ne choisit rien`);
      e = await etat(page); assert.ok(e.vue, 'la barre est ouverte');
      // Barre ouverte et vue : un clic sur une entrée marche.
      await page.mouse.click(60, y); await fini(page);
      assert.equal(await section(page), 'Famille');
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  }
});

test('navigateur, le focus ne passe pas sous la barre : ouverte au clavier, Tab au-delà de ses entrées la referme, sans voler le focus', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await page.focus('.poignee'); await page.keyboard.press('Enter'); await fini(page);
    let sorti = false;
    for (let i = 0; i < 16 && !sorti; i++) { await page.keyboard.press('Tab'); sorti = await page.evaluate(() => !document.querySelector('.side').contains(document.activeElement)); }
    assert.ok(sorti, 'le focus sort de la barre');
    await fini(page);
    const e = await etat(page), ou = await page.evaluate(() => { const a = document.activeElement; return { body: a === document.body, page: Boolean(document.querySelector('main').contains(a)) }; });
    assert.equal(e.vue, false, `la barre s'est refermée : ${JSON.stringify(e)}`);
    assert.ok(!e.focusPoignee && !ou.body && ou.page, `le focus reste sur l'élément de la page : ${JSON.stringify(ou)}`);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('navigateur, la zone de la poignée (44 × 64 px) ne couvre aucun élément de la page ; rien ne déborde de 821 à 1920 px', { skip: sans }, async () => {
  for (const largeur of [821, 1000, 1280, 1920]) {
    const { ctx, page } = await ouvrir(largeur);
    try {
      const r = await page.evaluate(() => {
        const h = document.querySelector('.poignee').getBoundingClientRect(), m = document.querySelector('main'), sous: string[] = [];
        for (let x = 1; x < h.right; x += 3) for (let y = Math.ceil(h.top) + 1; y < h.bottom; y += 4) for (const el of document.elementsFromPoint(x, y)) if (el !== m && m.contains(el)) sous.push(`${x},${y} ${el.className}`);
        return { sous: sous.slice(0, 5), marge: parseFloat(getComputedStyle(m).paddingLeft), poignee: h.right, deborde: document.documentElement.scrollWidth > innerWidth };
      });
      assert.deepEqual(r.sous, [], `${largeur} px : rien de la page sous la poignée`);
      assert.ok(r.marge >= r.poignee, `${largeur} px : le contenu commence après la poignée : ${JSON.stringify(r)}`);
      assert.equal(r.deborde, false, `${largeur} px : rien ne déborde`);
    } finally { await ctx.close(); }
  }
});

test('navigateur, la souris n\'interrompt pas le clavier : ouverte au clavier, une souris qui traverse la barre ne la referme pas', { skip: sans }, async () => {
  const { ctx, page } = await ouvrir(1280);
  try {
    await page.focus('.poignee'); await page.keyboard.press('Enter'); await fini(page);
    await page.mouse.move(100, 300); await page.mouse.move(800, 300); await page.waitForTimeout(900);
    const e = await etat(page);
    assert.ok(e.vue && e.focusBarre, `toujours ouverte, le focus dans la barre : ${JSON.stringify(e)}`);
  } finally { await ctx.close(); }
});

test('navigateur, un clic sur un bouton de la page, barre ouverte : l\'action a lieu, la barre se referme, le focus n\'est pas envoyé à la poignée', { skip: sans }, async () => {
  const { ctx, page } = await ouvrir(1280);
  try {
    await page.mouse.move(4, 120); await fini(page);
    assert.ok((await etat(page)).vue, 'ouverte à la souris');
    const avant = await page.evaluate(() => document.querySelector('.round[aria-pressed]').getAttribute('aria-pressed'));
    const c = await centre(page, '.round[aria-pressed]');
    await page.mouse.click(c.x, c.y); await fini(page);
    const e = await etat(page), apres = await page.evaluate(() => document.querySelector('.round[aria-pressed]').getAttribute('aria-pressed'));
    assert.notEqual(apres, avant, 'l\'action a eu lieu');
    assert.ok(!e.vue && !e.focusPoignee, `refermée, focus pas sur la poignée : ${JSON.stringify(e)}`);
  } finally { await ctx.close(); }
});

test('navigateur, le redessin automatique, barre ouverte au clavier : elle reste ouverte, non « inert », la poignée dit « ouverte », le focus reste sur la même entrée ; Échap la referme', { skip: sans }, async () => {
  const { ctx, page, erreurs } = await ouvrir(1280);
  try {
    await page.focus('.poignee'); await page.keyboard.press('Enter'); await fini(page);
    await page.evaluate(() => { [...document.querySelectorAll('.side .nav')].find((x: any) => x.textContent === 'Famille').focus(); document.querySelector('.side').dataset.avant = '1'; });
    // Le redessin de la page (le même que toutes les 15 s : l'état d'Odin relu), demandé tout de suite.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => !document.querySelector('.side').dataset.avant, undefined, { timeout: 15000 });
    const r = await page.evaluate(() => { const s = document.querySelector('.side'); return { inert: s.hasAttribute('inert'), etat: document.querySelector('.poignee').getAttribute('aria-expanded'), focus: document.activeElement?.getAttribute?.('aria-label') ?? null }; });
    const e = await etat(page);
    assert.ok(e.vue, 'toujours ouverte');
    assert.deepEqual(r, { inert: false, etat: 'true', focus: 'Famille' });
    await page.keyboard.press('Escape'); await fini(page);
    const f = await etat(page); assert.ok(!f.vue && f.focusPoignee, `Échap : refermée, focus sur la poignée : ${JSON.stringify(f)}`);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
