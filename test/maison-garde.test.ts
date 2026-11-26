// Filet de l'écran de la maison (/maison) : tout ce qu'il sait faire aujourd'hui, commande par commande, avant qu'il
// soit redessiné. Rien n'est changé dans le produit : ces essais disent ce qui doit rester.
// - Le script de la page (src/web/maison.js) est lu comme du texte ; ses fonctions de dessin (draw, home, devCard)
//   tournent dans un bac à sable avec un faux document : on appuie sur chaque commande et on note l'ordre envoyé.
// - Chaque ordre envoyé par une carte d'appareil est donné au pont (haCommand) : il doit le comprendre.
// - La route /api/maison/* (maisonRoute) est jouée avec une clé de tablette « maison » et avec la session.
// Ne sont figés ni une couleur, ni une taille, ni le texte d'un message, ni les valeurs de départ qui ne sont pas des
// mesures (le curseur d'une lumière, la consigne d'une clim sans nombre).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { recordFix, resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';
import { haCommand, sensitive } from '../src/valhalla/modules/midgard.ts';
import { maisonRoute } from '../src/web/maison-api.ts';
import { FAMILLES } from '../src/valhalla/modules/apparence.ts';

const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');

// ---------- Lire le script : une ligne, ou un bloc qui finit par « } » à deux espaces ----------
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

// ---------- Un faux document : juste ce qu'il faut à el() ----------
type Texte = { nodeType: 3; text: string };
class Noeud {
  nodeType = 1; attrs: Record<string, string> = {}; kids: Array<Noeud | Texte> = []; ls: Record<string, Array<(e: unknown) => unknown>> = {}; style: Record<string, string> = {}; value = ''; textContent = '';
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(t: string, f: (e: unknown) => unknown) { (this.ls[t] ??= []).push(f); }
  append(...c: Array<Noeud | Texte>) { this.kids.push(...c); }
  replaceChildren(...c: Array<Noeud | Texte>) { this.kids = c; }
}
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
const lancer = (n: Noeud, t: string) => { for (const f of n.ls[t] ?? []) f({ target: n }); };
// Les icônes sont remplacées par une marque qui dit leur nom (le dessin n'est pas tenu ici).
const icone = (k: string) => { const n = new Noeud('svg'); n.attrs['data-icone'] = k; return n; };
const aIcone = (b: Noeud, k: string) => b.kids.some((x) => estNoeud(x) && x.attrs['data-icone'] === k);
const boutons = (n: Noeud) => tous(n, (x) => x.tag === 'button');
const curseurs = (n: Noeud) => tous(n, (x) => x.tag === 'input' && x.attrs.type === 'range');

// ---------- La carte d'un appareil (devCard), dans son bac à sable ----------
type Envoi = { chemin: string; corps: Record<string, unknown> };
function carte(d: { id: string; name: string; kind: string; state?: string; unit?: string }) {
  const envois: Envoi[] = [];
  const src = [ligne('const KIND = '), ligne('const FR = '), ligne('const stateFr = '), ligne('const isOn = '), bloc('const el = ('), bloc('function devCard(d) {'), 'devCard;'].join('\n');
  const devCard = vm.runInNewContext(src, {
    document: doc, CSS: { escape: (x: string) => x }, icon: icone, pet: { visit: () => {} },
    act: (chemin: string, corps: Record<string, unknown>) => { envois.push({ chemin, corps }); return Promise.resolve({ ok: true }); },
  }) as (x: typeof d) => Noeud;
  const n = devCard(d);
  // Les ordres envoyés par la carte : toujours vers /api/maison/appareil, toujours pour cet appareil.
  const ordres = () => envois.map((e) => { assert.equal(e.chemin, '/api/maison/appareil'); assert.equal(e.corps.appareil, d.id); return String(e.corps.valeur); });
  return { n, ordres, vider: () => { envois.length = 0; } };
}
const appareil = (kind: string, state: string) => ({ id: `essai-${kind}`, name: 'Appareil 1', kind, state, unit: '' });
// L'interrupteur d'une carte : un bouton qui a le rôle « switch ».
const interrupteur = (n: Noeud) => { const b = tous(n, (x) => x.tag === 'button' && x.attrs.role === 'switch'); assert.equal(b.length, 1, 'un interrupteur'); return b[0]; };
const avecIcone = (n: Noeud, k: string) => { const b = boutons(n).filter((x) => aIcone(x, k)); assert.equal(b.length, 1, `un bouton « ${k} »`); return b[0]; };

// ---------- Les sections et le retour vers Odin (draw), dans leur bac à sable ----------
function ecran() {
  const marque = (nom: string) => { const n = new Noeud('vue'); n.attrs['data-vue'] = nom; return n; };
  const fenetre: { top: unknown } = { top: undefined }; fenetre.top = fenetre;
  const racine = new Noeud('div');
  const src = [
    'let D = null, view = \'accueil\', q = \'\', voice = false, key = \'\';',
    // La barre de côté a une punaise (épinglée ou repliée, gardée sur l'appareil) : son état est lu avec draw.
    // Le bandeau (le salut, la date, la pastille) est dessiné par sa propre fonction (test/maison-bandeau.test.ts le tient).
    ligne('const MOTS = '), bloc('const el = ('), ligne('let barre = '), ligne('const retourVisible = '), ligne('function nav('), bloc('function bandeau('),
    // La barre du bas du téléphone (quatre places, Odin au centre, « Plus ») et le plein écran : test/maison-telephone.test.ts les tient.
    ligne('let plusOuvert = '), ligne('const BAS = '), bloc('function placesBas('), ligne('function focusPlace('), ligne('const classeRacine = '), bloc('function barreBas('), bloc('function ouvrirPlus('), bloc('function boutonPlein('), bloc('function basculerPlein('), bloc('function draw() {'),
    '({ draw, regler(d, k) { D = d; key = k; view = \'accueil\'; } });',
  ].join('\n');
  const e = vm.runInNewContext(src, {
    document: doc, window: fenetre, root: racine, icon: icone, hello: () => '', week: () => 1, drawSoon: () => {}, startCams: () => {},
    // La page seule (pas dans Odin) : pas de menu des sections en haut (test/menus-venus-vue*.test.ts le tient dans Odin).
    dansOdin: false, secs: () => null,
    pet: { news: () => {}, say: () => {} }, localStorage: { setItem: () => {}, getItem: () => null },
    home: () => [marque('accueil')], appsView: () => [marque('applis')], peopleGrid: () => marque('famille'), camGrid: (grand: boolean) => marque(grand ? 'cameras' : 'cameras-accueil'),
    netView: () => [marque('reseau')], tilesView: (grand: boolean) => [marque(grand ? 'boutons' : 'boutons-accueil')], themesView: () => [marque('themes')],
  }) as { draw: () => void; regler: (d: unknown, k: string) => void };
  const partie = (ok: (x: Noeud) => boolean) => { const n = racine.kids.filter((x): x is Noeud => estNoeud(x) && ok(x)); assert.equal(n.length, 1, 'une seule'); return n[0]; };
  return {
    // Dessine l'écran avec ces droits ; « cle » : une clé de tablette ; « cadre » : la page est dans un cadre.
    dessiner(rights: string, cle = '', cadre = false) { fenetre.top = cadre ? {} : fenetre; e.regler({ rights, notices: [], name: '' }, cle); e.draw(); },
    // Chaque partie est cherchée par ce qu'elle est, pas par sa place : non épinglée (la maquette, au départ), la barre de
    // côté a devant elle sa poignée et le bord gauche (test/maison-cadre.test.ts les tient).
    cote: () => partie((x) => x.tag === 'nav' && x.attrs.class.split(' ').includes('side')), page: () => partie((x) => x.tag === 'main'), bas: () => partie((x) => x.tag === 'nav' && x.attrs.class === 'bnav'),
    // La feuille « Plus » de la barre du bas (téléphone) : seulement quand des sections n'ont pas de place dans la barre.
    feuille: () => racine.kids.filter((x): x is Noeud => estNoeud(x) && x.attrs.class === 'feuille'),
    vues: () => tous(partie((x) => x.tag === 'main'), (x) => x.tag === 'vue').map((x) => x.attrs['data-vue']),
    retour: () => tous(partie((x) => x.tag === 'main'), (x) => x.tag === 'a' && x.attrs.href === '/'),
  };
}
const SEPT = ['accueil', 'famille', 'cameras', 'reseau', 'applis', 'boutons', 'themes'];
const TROIS = ['accueil', 'boutons', 'themes'];
// Les sections de la barre de côté : ses boutons « nav » (la punaise, à côté du titre, n'est pas une section).
const sectionsCote = (n: Noeud) => boutons(n).filter((x) => x.attrs.class === 'nav');
/** Les sections de la barre du bas et de sa feuille « Plus » (data-place ; ni le rond d'Odin, ni « Plus », ni le retour vers Odin). */
const sectionsBas = (e: ReturnType<typeof ecran>) => [e.bas(), ...e.feuille()].flatMap((n) => boutons(n)).map((x) => x.attrs['data-place']).filter((p) => p && !['odin', 'plus'].includes(p));
/** Appuie sur chaque section du menu de côté, dans l'ordre, et rend la vue que chacune ouvre. */
function sections(e: ReturnType<typeof ecran>): string[] {
  const n = sectionsCote(e.cote()).length, out: string[] = [];
  for (let i = 0; i < n; i++) { lancer(sectionsCote(e.cote())[i], 'click'); out.push(e.vues()[0]); }
  return out;
}

test('sections : sept pour la session (accueil, famille, caméras, réseau, mes applis, boutons, thèmes), chacune ouvre sa vue', () => {
  const e = ecran(); e.dessiner('complet');
  // La barre du bas (téléphone) : quatre places et Odin au centre, dont « Plus » (sa réponse) ; la barre et la feuille « Plus »
  // ensemble ont les mêmes sections que la barre de côté, ni plus ni moins (test/maison-telephone.test.ts tient le reste).
  assert.equal(sectionsCote(e.cote()).length, 7); assert.deepEqual(sectionsBas(e).sort(), [...SEPT].sort(), 'la barre du bas (téléphone) et sa feuille « Plus » ont les mêmes');
  assert.deepEqual(sections(e), SEPT);
});

test('sections : trois pour une tablette « maison » (accueil, boutons, thèmes), chacune ouvre sa vue', () => {
  const e = ecran(); e.dessiner('maison', `gk_${'a'.repeat(40)}`);
  // Une tablette « maison » : ses trois sections dans la barre du bas, autour d'Odin, sans « Plus » ni feuille.
  assert.equal(sectionsCote(e.cote()).length, 3); assert.deepEqual(sectionsBas(e).sort(), [...TROIS].sort()); assert.equal(e.feuille().length, 0);
  assert.deepEqual(sections(e), TROIS);
});

test('« ← Odin » : là pour une session ; absent avec une clé de tablette ; absent dans un cadre', () => {
  const e = ecran();
  e.dessiner('complet'); assert.equal(e.retour().length, 1, 'une session, la page seule');
  e.dessiner('complet', `gk_${'b'.repeat(40)}`); assert.equal(e.retour().length, 0, 'clé de tablette');
  e.dessiner('maison', `gk_${'b'.repeat(40)}`); assert.equal(e.retour().length, 0, 'clé de tablette « maison »');
  e.dessiner('complet', '', true); assert.equal(e.retour().length, 0, 'dans un cadre');
});

// ---------- L'accueil de l'écran (home) : les pièces qui filtrent, les scènes d'un appui ----------
function accueil(D: Record<string, unknown>) {
  const cartes: string[] = [], envois: Envoi[] = [];
  // Les onglets de pièces ont leur fonction (onglets) et leurs mots (MOTS) ; « room » vaut null pour « Tout » (une pièce peut
  // s'appeler « Tout »). test/maison-bandeau.test.ts tient le reste (la rangée d'onglets, le clavier, aucune pièce).
  const src = ['let D = null, room = null, q = \'\';', ligne('const MOTS = '), bloc('const el = ('), ligne('const match = '), ligne('const ongletDe = '), bloc('function onglets('), bloc('function home() {'), '({ home, regler(d) { D = d; room = null; }, piece: () => room });'].join('\n');
  const marque = () => new Noeud('vue');
  const e = vm.runInNewContext(src, {
    document: doc, icon: icone, clock: new Noeud('div'), clockSub: new Noeud('div'), draw: () => {},
    weatherCard: marque, fenetrePages: () => [], peopleGrid: marque, camGrid: marque, tilesView: () => [], appsGrid: marque,
    devCard: (d: { id: string }) => { cartes.push(d.id); return marque(); },
    act: (chemin: string, corps: Record<string, unknown>) => { envois.push({ chemin, corps }); return Promise.resolve({ ok: true }); },
  }) as { home: () => Noeud[]; regler: (d: unknown) => void; piece: () => string };
  e.regler(D);
  const dessiner = () => { cartes.length = 0; const r = e.home(); return { racine: Object.assign(new Noeud('main'), { kids: r }), cartes: [...cartes] }; };
  return { dessiner, envois, piece: e.piece };
}
const PIECES = { rights: 'complet', notices: [], scenes: ['Scène 1'], rooms: [{ name: 'Pièce 1', devices: [{ id: 'p1-a', name: 'Appareil 1', kind: 'prise', state: 'off' }] }, { name: 'Pièce 2', devices: [{ id: 'p2-a', name: 'Appareil 2', kind: 'prise', state: 'off' }, { id: 'p2-b', name: 'Appareil 3', kind: 'lumière', state: 'on' }] }] };

test('pièces : un onglet par pièce (plus « tout ») ; toucher une pièce ne montre que ses appareils ; revenir à tout les montre tous', () => {
  const a = accueil(PIECES);
  let v = a.dessiner(); assert.deepEqual(v.cartes, ['p1-a', 'p2-a', 'p2-b']);
  // Les onglets sont une rangée d'onglets (role tab, aria-selected), plus des boutons « chip » (aria-pressed).
  const onglets = () => tous(a.dessiner().racine, (x) => x.tag === 'button' && x.attrs.role === 'tab');
  assert.equal(onglets().length, 3);
  lancer(onglets().find((x) => texte(x) === 'Pièce 2')!, 'click'); assert.equal(a.piece(), 'Pièce 2');
  v = a.dessiner(); assert.deepEqual(v.cartes, ['p2-a', 'p2-b']);
  assert.equal(tous(v.racine, (x) => x.attrs.role === 'tab' && x.attrs['aria-selected'] === 'true').map(texte).join(), 'Pièce 2', 'l\'onglet choisi est marqué');
  lancer(onglets().find((x) => texte(x) === 'Pièce 1')!, 'click'); assert.deepEqual(a.dessiner().cartes, ['p1-a']);
  lancer(onglets()[0], 'click'); assert.deepEqual(a.dessiner().cartes, ['p1-a', 'p2-a', 'p2-b']);
});

test('scènes : une scène se lance d\'un appui (/api/maison/scene avec son nom)', () => {
  const a = accueil(PIECES), b = tous(a.dessiner().racine, (x) => x.tag === 'button' && x.attrs.class === 'scene');
  assert.equal(b.length, 1); lancer(b[0], 'click');
  // (le corps vient du bac à sable : on le recopie pour le comparer)
  assert.deepEqual(JSON.parse(JSON.stringify(a.envois)), [{ chemin: '/api/maison/scene', corps: { scene: 'Scène 1' } }]);
});

// ---------- Les cartes d'appareils : chaque commande, et l'ordre qu'elle envoie ----------
// Le genre côté pont (le domaine de la box reliée), pour donner chaque ordre à haCommand comme le fait Midgard.
const DOMAINE: Record<string, string> = { 'lumière': 'light', prise: 'switch', ventilateur: 'fan', volet: 'cover', clim: 'climate', lecteur: 'media_player', aspirateur: 'vacuum', serrure: 'lock' };
// Le bouton marche/arrêt de la clim est celui qui n'a pas d'icône (les deux autres : moins, plus).
const sansIcone = (n: Noeud) => { const b = boutons(n).filter((x) => !x.kids.some((k) => estNoeud(k) && k.attrs['data-icone'])); assert.equal(b.length, 1); return b[0]; };
// Chaque geste : le nom de l'essai, et ce qu'il fait ; il rend les ordres envoyés (déjà vérifiés), pour le pont.
type Geste = [string, () => Array<{ kind: string; valeur: string }>];
const envoyes = (kind: string, valeurs: string[]) => valeurs.map((valeur) => ({ kind, valeur }));
const GESTES: Geste[] = [
  ...['lumière', 'prise', 'ventilateur'].map((kind): Geste => [`carte « ${kind} » : l'interrupteur envoie on quand l'appareil est éteint, off quand il est allumé`, () => {
    const a = carte(appareil(kind, 'off')); lancer(interrupteur(a.n), 'click'); assert.deepEqual(a.ordres(), ['on']);
    const b = carte(appareil(kind, 'on')); lancer(interrupteur(b.n), 'click'); assert.deepEqual(b.ordres(), ['off']);
    if (kind !== 'lumière') assert.equal(curseurs(b.n).length, 0, 'pas de curseur d\'intensité');
    return envoyes(kind, [...a.ordres(), ...b.ordres()]);
  }]),
  ['carte « lumière » : le curseur d\'intensité envoie « n % » (la valeur choisie, pas celle de départ)', () => {
    const c = carte(appareil('lumière', 'on')), r = curseurs(c.n); assert.equal(r.length, 1);
    for (const n of ['1', '55', '100']) { r[0].value = n; lancer(r[0], 'change'); }
    assert.deepEqual(c.ordres(), ['1 %', '55 %', '100 %']);
    return envoyes('lumière', c.ordres());
  }],
  ['carte « volet » : monter envoie ouvre, arrêter envoie stop, descendre envoie ferme', () => {
    const c = carte(appareil('volet', 'open'));
    for (const k of ['up', 'stop', 'down']) lancer(avecIcone(c.n, k), 'click');
    assert.deepEqual(c.ordres(), ['ouvre', 'stop', 'ferme']);
    return envoyes('volet', c.ordres());
  }],
  ['carte « clim » : moins envoie la consigne moins un, plus la consigne plus un', () => {
    const a = carte(appareil('clim', '19'));
    lancer(avecIcone(a.n, 'minus'), 'click'); lancer(avecIcone(a.n, 'plus'), 'click');
    assert.deepEqual(a.ordres(), ['18', '20']);
    const b = carte(appareil('clim', '20.5')); lancer(avecIcone(b.n, 'minus'), 'click'); lancer(avecIcone(b.n, 'plus'), 'click');
    assert.deepEqual(b.ordres(), ['19.5', '21.5'], 'une consigne à demi-degré');
    return envoyes('clim', [...a.ordres(), ...b.ordres()]);
  }],
  ['carte « clim » : marche envoie on quand elle est arrêtée, arrêt envoie off quand elle tourne', () => {
    const a = carte(appareil('clim', 'off')); lancer(sansIcone(a.n), 'click'); assert.deepEqual(a.ordres(), ['on']);
    const b = carte(appareil('clim', 'cool')); lancer(sansIcone(b.n), 'click'); assert.deepEqual(b.ordres(), ['off']);
    return envoyes('clim', [...a.ordres(), ...b.ordres()]);
  }],
  ['carte « lecteur » : précédent, lecture (en pause), pause (en lecture), suivant', () => {
    const a = carte(appareil('lecteur', 'paused'));
    for (const k of ['prev', 'play', 'next']) lancer(avecIcone(a.n, k), 'click');
    assert.deepEqual(a.ordres(), ['precedent', 'lecture', 'suivant']);
    const b = carte(appareil('lecteur', 'playing')); lancer(avecIcone(b.n, 'pause'), 'click');
    assert.deepEqual(b.ordres(), ['pause']);
    return envoyes('lecteur', [...a.ordres(), ...b.ordres()]);
  }],
  ['carte « aspirateur » : deux commandes, l\'une envoie on (nettoyer), l\'autre off (retour à la base)', () => {
    const c = carte(appareil('aspirateur', 'docked')), b = boutons(c.n); assert.equal(b.length, 2);
    for (const x of b) lancer(x, 'click');
    assert.deepEqual(c.ordres(), ['on', 'off']);
    return envoyes('aspirateur', c.ordres());
  }],
  ['carte « serrure » verrouillée : glisser à plus de 90 % envoie deverrouille ; moins loin, rien ; le curseur revient au départ', () => {
    const c = carte(appareil('serrure', 'locked')), r = curseurs(c.n);
    assert.equal(r.length, 1); assert.equal(boutons(c.n).length, 0, 'pas de bouton qui ouvre d\'un appui');
    for (const n of ['50', '90']) { r[0].value = n; lancer(r[0], 'input'); lancer(r[0], 'change'); assert.equal(r[0].value, '0'); }
    assert.deepEqual(c.ordres(), [], 'pas assez loin : rien n\'est envoyé');
    r[0].value = '95'; lancer(r[0], 'input'); lancer(r[0], 'change');
    assert.deepEqual(c.ordres(), ['deverrouille']); assert.equal(r[0].value, '0');
    return envoyes('serrure', c.ordres());
  }],
  ['carte « serrure » ouverte : verrouiller d\'un appui envoie verrouille', () => {
    const c = carte(appareil('serrure', 'unlocked'));
    assert.equal(curseurs(c.n).length, 0); lancer(avecIcone(c.n, 'lock'), 'click');
    assert.deepEqual(c.ordres(), ['verrouille']);
    return envoyes('serrure', c.ordres());
  }],
];
for (const [nom, geste] of GESTES) test(nom, () => { geste(); });

// ---------- Côté serveur : le pont comprend chaque ordre ; l'accord pour ouvrir une serrure ----------
const SERVICE: Record<string, Record<string, string>> = {
  light: { on: 'turn_on', off: 'turn_off', '1 %': 'turn_on', '55 %': 'turn_on', '100 %': 'turn_on' },
  switch: { on: 'turn_on', off: 'turn_off' }, fan: { on: 'turn_on', off: 'turn_off' },
  cover: { ouvre: 'open_cover', stop: 'stop_cover', ferme: 'close_cover' },
  climate: { 18: 'set_temperature', 20: 'set_temperature', 19.5: 'set_temperature', 21.5: 'set_temperature', on: 'turn_on', off: 'turn_off' },
  media_player: { precedent: 'media_previous_track', lecture: 'media_play', pause: 'media_pause', suivant: 'media_next_track' },
  vacuum: { on: 'start', off: 'return_to_base' }, lock: { deverrouille: 'unlock', verrouille: 'lock' },
};

test('pont : chaque ordre envoyé par une carte est compris par haCommand, et donne le bon service', () => {
  // Les ordres viennent des cartes elles-mêmes : on rejoue chaque geste. Chaque ordre attendu doit avoir été envoyé.
  const vus = GESTES.flatMap(([, geste]) => geste());
  const cle = (domaine: string, valeur: string) => `${domaine} ${valeur}`;
  assert.deepEqual([...new Set(vus.map((x) => cle(DOMAINE[x.kind], x.valeur)))].sort(), Object.entries(SERVICE).flatMap(([d, o]) => Object.keys(o).map((v) => cle(d, v))).sort());
  for (const { kind, valeur } of vus) {
    const domaine = DOMAINE[kind], entite = `${domaine}.appareil_1`;
    let c: ReturnType<typeof haCommand> | undefined;
    assert.doesNotThrow(() => { c = haCommand(entite, valeur); }, `${kind} « ${valeur} »`);
    assert.equal(c!.domain, domaine); assert.equal(c!.data.entity_id, entite);
    assert.equal(c!.service, SERVICE[domaine][valeur], `${kind} « ${valeur} »`);
  }
  // Les nombres arrivent aussi, pas seulement le service.
  assert.equal(haCommand('light.appareil_1', '55 %').data.brightness_pct, 55);
  assert.equal(haCommand('climate.appareil_1', '19.5').data.temperature, 19.5);
});

test('accord : ouvrir une serrure (deverrouille) le demande ; la verrouiller (verrouille) non', () => {
  assert.ok(sensitive('ha:lock.appareil_1', 'deverrouille'));
  assert.equal(sensitive('ha:lock.appareil_1', 'verrouille'), undefined);
});

// ---------- La route /api/maison/* : clé de tablette « maison » et session ----------
// Un seul monde pour tous les essais de la route : un appareil du réseau, une caméra, un membre qui partage sa position,
// une clé de tablette « maison ». L'en-tête x-essai-session (lu par le serveur de l'essai, pas par Odin) joue la session.
type Etat = { rights: string; apps: unknown[]; people: unknown[]; network: unknown[]; cameras: unknown[]; themes: Record<string, string> };
type Rep = { status: number; [k: string]: unknown };
const SESSION = { 'x-essai-session': '1' };
const GRAVE = { appareil: 'ha:lock.appareil_1', valeur: 'deverrouille' };
const R = {} as { v: Valhalla; home: string; srv: ReturnType<typeof createServer>; base: string; K: Record<string, string> };
const get = (p: string, h: Record<string, string> = {}) => fetch(R.base + p, { headers: h });
const etat = async (h: Record<string, string>) => await (await get('/api/maison/etat', h)).json() as Etat;
const post = (p: string, b: unknown, h: Record<string, string> = {}) => fetch(R.base + p, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json()) as Record<string, unknown> }) as Rep);

describe('route /api/maison/*', () => {
  before(async () => {
    R.home = mkdtempSync(join(tmpdir(), 'maison-garde-'));
    const fetchCoupe = (async () => { throw new Error('réseau coupé par l\'essai'); }) as typeof fetch;
    R.v = new Valhalla(R.home, allModules({ paths: { home: R.home, workspace: R.home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fetchCoupe, notify: async () => {}, autonomy: () => 'equilibre' });
    setValhalla(R.v); resetGladsheim();
    R.v.ctx('askr').saveSettings({ assets: [{ ip: '198.51.100.7', name: 'Appareil 1', kind: 'ordinateur' }] });
    R.v.ctx('himinbjorg').saveSettings({ cams: [{ name: 'Caméra 1', url: 'rtsp://198.51.100.8/flux', motion: false, record: false, sensitivity: 5 }] });
    assert.notEqual((await R.v.act('gladsheim', 'membre', { nom: 'Alex', adresse: 'https://example.org' })).ok, false);
    const g = R.v.ctx('gladsheim');
    recordFix(g, (g.settings.members as Array<Parameters<typeof recordFix>[1]>)[0], { _type: 'location', lat: 1.5, lon: 2.5 });
    R.K = { 'x-odin-maison': ((await R.v.act('gladsheim', 'cle_tablette', { nom: 'Tablette 1', droits: 'maison' })).data as { key: string }).key };
    R.srv = createServer((req, res) => { void maisonRoute(req, res, new URL(req.url!, 'http://x'), { authed: req.headers['x-essai-session'] === '1', name: '', mascot: '<svg></svg>', fail: () => {}, ask: async () => '' }).then((fait) => { if (!fait) { res.writeHead(404); res.end(); } }); });
    // Le serveur de l'essai n'écoute que sur la machine (« localhost ») ; son adresse est lue, jamais écrite en dur.
    await new Promise<void>((ok) => R.srv.listen(0, 'localhost', () => ok()));
    const ici = R.srv.address() as { address: string; port: number };
    R.base = `http://${ici.address.includes(':') ? `[${ici.address}]` : ici.address}:${ici.port}`;
  });
  after(() => { R.srv?.close(); setValhalla(undefined); R.v?.stop(); if (R.home) rmSync(R.home, { recursive: true, force: true }); });

  test('route : la clé « maison » a les droits « maison », la session les droits complets', async () => {
    assert.equal((await etat(R.K)).rights, 'maison');
    assert.equal((await etat(SESSION)).rights, 'complet');
  });
  test('route : une clé « maison » ne reçoit pas l\'état des applis (la session, si)', async () => {
    assert.deepEqual((await etat(R.K)).apps, []);
    assert.ok((await etat(SESSION)).apps.length > 0);
  });
  test('route : une clé « maison » ne reçoit pas la famille (la session, si)', async () => {
    assert.deepEqual((await etat(R.K)).people, []);
    assert.ok((await etat(SESSION)).people.length > 0);
  });
  test('route : une clé « maison » ne reçoit pas le réseau (la session, si)', async () => {
    assert.deepEqual((await etat(R.K)).network, []);
    assert.ok((await etat(SESSION)).network.length > 0);
  });
  test('route : une clé « maison » ne reçoit pas la liste des caméras (la session, si)', async () => {
    assert.deepEqual((await etat(R.K)).cameras, []);
    assert.deepEqual((await etat(SESSION)).cameras, ['Caméra 1']);
  });
  test('route : l\'aperçu d\'une caméra est refusé à une clé « maison » (403)', async () => {
    assert.equal((await get('/api/maison/camera?nom=' + encodeURIComponent('Caméra 1'), R.K)).status, 403);
  });
  test('route : une clé « maison » ne change pas le thème (403, thème inchangé)', async () => {
    const avant = String(R.v.ctx('gladsheim').settings.theme ?? '');
    const autre = Object.keys((await etat(R.K)).themes).find((t) => t !== avant)!;
    assert.equal((await post('/api/maison/theme', { theme: autre }, R.K)).status, 403);
    assert.equal(String(R.v.ctx('gladsheim').settings.theme ?? ''), avant);
  });
  test('route : une action grave est refusée à une clé « maison », sans lui proposer de confirmer', async () => {
    const refus = await post('/api/maison/appareil', GRAVE, R.K);
    assert.equal(refus.ok, false); assert.equal(refus.confirm, undefined);
  });
  test('route : une clé « maison » qui envoie « confirm » reçoit le même refus (elle ne confirme pas elle-même)', async () => {
    const refus = await post('/api/maison/appareil', GRAVE, R.K);
    assert.deepEqual(await post('/api/maison/appareil', { ...GRAVE, confirm: true }, R.K), refus);
  });
  test('route : la session reçoit une demande de confirmation pour la même action grave', async () => {
    const demande = await post('/api/maison/appareil', GRAVE, SESSION);
    assert.equal(demande.ok, false); assert.equal(typeof demande.confirm, 'string'); assert.ok(String(demande.confirm).length > 0);
  });
  // La liste a grandi : les 31 de Hestia (sans préfixe) et les trois autres familles de Réglages (« o-… ») : toute la
  // liste de Réglages → Apparence (6 + 32 + 31 + 16 = 85) moins « Valhalla (classique) » (le thème classique d'Odin n'a
  // pas de ciel : il reste dans Réglages, pas sur cet écran, comme la maquette) ; la même pour une clé « maison » et pour la session.
  test('route : la liste des thèmes a 31 thèmes de Hestia et toute la liste de Réglages moins Valhalla (clé « maison » et session)', async () => {
    const reglages = FAMILLES.reduce((n, f) => n + f.ids.length, 0); assert.equal(reglages, 85, 'Réglages garde ses 85 thèmes');
    for (const h of [R.K, SESSION]) {
      const ids = Object.keys((await etat(h)).themes);
      assert.equal(ids.filter((k) => !k.startsWith('o-')).length, 31);
      assert.equal(ids.length, reglages - 1); assert.ok(!ids.includes('o-valhalla'));
    }
  });
});
