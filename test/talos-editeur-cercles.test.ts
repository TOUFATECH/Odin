// Talos, l'éditeur à nœuds (src/web/flows.js) : les blocs en cercles, premières mesures (fonctions pures).
// - Les tailles sont des constantes nommées : une correction du dessin se fait à un seul endroit.
// - Ce qui est enregistré ne change pas : le dessin écarte les blocs en hauteur (y dessiné = y enregistré × ECHELLE_Y),
//   et un aller-retour rend le même nombre entier.
// - Le départ et l'arrivée d'une liaison.
// - Les zones de toucher d'un bloc, aux zooms 0,4 à 1,6 : le « ⋯ » et le « + » ne se recouvrent pas ; une sortie ne passe
//   jamais à gauche du « + » ; deux blocs enregistrés à 110 px l'un sous l'autre : le « ⋯ » du bas ne couvre ni le nom ni
//   la 2e ligne du haut.
// - Page (petit document simulé, aucun navigateur) : le nom lisible d'un bloc ne change pas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const LIEN = readFileSync(new URL('../src/web/pages/talos-lien.js', import.meta.url), 'utf8');

type Pos = [number, number];
type Rect = { g: number; h: number; d: number; b: number };
type Zones = { rond: Rect; nom: Rect; ligne: Rect; resultat: Rect; menu: Rect; plus: Rect; entree: Rect; sorties: Rect[] };
interface Logique {
  NODE_W: number; PAS_X: number; PAS_Y: number;
  ROND: number; ANNEAU: number; ICONE_ROND: number; HAUT_BLOC: number; HAUT_TESTE: number; ECHELLE_Y: number;
  PLUS_D: number; PLUS_X: number; ZONE_PLUS: number; SORTIE_X: number; ENTREE_X: number; PORT_D: number; ECART_SORTIES: number;
  yDessin: (y: number) => number;
  yEnregistre: (yd: number) => number;
  departLien: (pos: Pos, i?: number, m?: number) => Pos;
  arriveeLien: (pos: Pos) => Pos;
  zonesBloc: (k?: number, m?: number) => Zones;
  zoneToucher: (k: number, px?: number) => number;
  placeLibre: (nodes: Array<{ position: Pos }>, x: number, y: number) => Pos;
  collerBloc: (wf: { nodes: Array<{ name: string; type: string; params: Record<string, unknown>; position: Pos }> }, c: unknown, k?: number) => { ok: boolean; name: string };
}

function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document });
  return win.OdinFlows!.logique;
}
/** Deux rectangles se recouvrent (un bord commun n'est pas un recouvrement). */
const recouvre = (a: Rect, b: Rect) => a.g < b.d && b.g < a.d && a.h < b.b && b.h < a.b;
const decale = (r: Rect, dx: number, dy: number): Rect => ({ g: r.g + dx, h: r.h + dy, d: r.d + dx, b: r.b + dy });
/** Une valeur venue du petit monde de flows.js, ramenée ici (nombres arrondis au millionième : 44 ÷ 0,4 n'est pas tout rond). */
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));
const ZOOMS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.4, 1.6];

test('les tailles des cercles sont des constantes nommées ; la case, les écarts enregistrés et le pas ne changent pas', () => {
  const L = logique();
  assert.equal(L.ROND, 96); assert.equal(L.ANNEAU, 6); assert.equal(L.ICONE_ROND, 44);
  assert.equal(L.HAUT_BLOC, 136, 'rond 96, 6, nom 18, 2e ligne 16'); assert.equal(L.HAUT_TESTE, 152, 'plus la ligne de résultat');
  assert.equal(L.ECHELLE_Y, 2.2);
  assert.equal(L.PLUS_D, 28); assert.equal(L.PLUS_X, 151); assert.equal(L.ZONE_PLUS, 44);
  assert.equal(L.SORTIE_X, 195); assert.equal(L.ENTREE_X, 25); assert.equal(L.PORT_D, 12); assert.equal(L.ECART_SORTIES, 22);
  assert.equal(L.NODE_W, 190); assert.equal(L.PAS_X, 280); assert.equal(L.PAS_Y, 110, 'ce qui est enregistré garde ses écarts');
  // Le rond, le « + » et la sortie tiennent dans la case et l'écart entre deux blocs voisins.
  assert.ok(L.NODE_W / 2 + L.ROND / 2 < L.PLUS_X, 'le « + » est à droite du milieu du bord du rond');
  assert.ok(L.PLUS_X - L.PLUS_D / 2 < L.NODE_W / 2 + L.ROND / 2, 'le « + » mord sur le rond (collé à lui)');
  assert.ok(L.SORTIE_X + L.PORT_D / 2 < L.PAS_X + L.ENTREE_X - L.PORT_D / 2, 'la sortie ne touche pas l\'entrée du bloc voisin');
});

test('le y dessiné : enregistré × 2,2 ; l\'aller-retour rend le même nombre entier (rien d\'enregistré ne bouge)', () => {
  const L = logique();
  assert.equal(L.yDessin(0), 0); assert.equal(L.yDessin(110), 242); assert.equal(L.yDessin(-50), -110);
  for (let y = -500; y <= 2000; y++) assert.equal(L.yEnregistre(L.yDessin(y)), y, `aller-retour de ${y}`);
  assert.equal(L.yEnregistre(L.yDessin(300) + 30), 314, 'glisser de 30 px à l\'écran : 30 ÷ 2,2, arrondi');
  assert.ok(Number.isInteger(L.yEnregistre(123.456)));
  assert.equal(L.yDessin(Number.NaN), 0, 'une place absente se dessine en haut');
});

test('une liaison part du rond de sortie (x + 200, milieu du rond, décalé selon la sortie) et arrive au bord gauche du rond d\'entrée', () => {
  const L = logique();
  assert.deepEqual(ici(L.departLien([60, 100])), [260, 268], 'une sortie : au milieu du rond (220 + 48)');
  assert.deepEqual(ici(L.departLien([60, 100], 0, 1)), ici(L.departLien([60, 100])));
  assert.deepEqual(ici(L.departLien([340, 160], 0, 2)), [540, 352 + 48 - 11], '« oui » : 11 px au-dessus du milieu');
  assert.deepEqual(ici(L.departLien([340, 160], 1, 2)), [540, 352 + 48 + 11], '« non » : 11 px au-dessous');
  assert.deepEqual(ici(L.departLien([0, 0], 1, 3)), [200, 48], 'trois sorties : celle du milieu au milieu du rond');
  assert.deepEqual(ici(L.departLien([0, 0], 0, 3)), [200, 26]); assert.deepEqual(ici(L.departLien([0, 0], 2, 3)), [200, 70]);
  assert.equal(L.departLien([0, 0])[0], L.NODE_W + 10, 'le x de départ d\'aujourd\'hui');
  assert.deepEqual(ici(L.arriveeLien([900, 300])), [919, 708], 'bord gauche du rond d\'entrée (centre x + 25, rayon 6)');
  assert.deepEqual(ici(L.arriveeLien([0, 0])), [L.ENTREE_X - L.PORT_D / 2, L.ROND / 2]);
  // Deux blocs voisins à la même hauteur : la liaison est horizontale, de gauche à droite.
  const a = L.departLien([60, 160]), b = L.arriveeLien([60 + L.PAS_X, 160]);
  assert.equal(a[1], b[1]); assert.ok(a[0] < b[0]);
});

test('les zones d\'un bloc, du zoom 0,4 au zoom 1,6 : le « ⋯ » et le « + » ne se recouvrent pas ; la sortie reste à droite du « + »', () => {
  const L = logique();
  for (const k of ZOOMS) {
    for (const m of [1, 2, 3]) {
      const z = L.zonesBloc(k, m);
      assert.equal(recouvre(z.menu, z.plus), false, `« ⋯ » / « + » au zoom ${k}`);
      assert.ok(z.menu.b <= 10 && z.menu.b - z.menu.h >= 44, `« ⋯ » au-dessus du bloc, assez haut (zoom ${k})`);
      assert.ok((z.menu.d - z.menu.g) * k >= 44 - 1e-9 && (z.menu.b - z.menu.h) * k >= 44 - 1e-9, `« ⋯ » : 44 px à l'écran (zoom ${k})`);
      assert.equal(z.plus.d - z.plus.g, 44, 'le « + » garde 44 px du schéma, comme aujourd\'hui');
      assert.equal(z.sorties.length, m);
      for (const [i, s] of z.sorties.entries()) {
        assert.ok(s.g >= z.plus.d, `la sortie ${i} ne passe pas à gauche du « + » (zoom ${k})`);
        assert.equal(recouvre(s, z.plus), false); assert.equal(recouvre(s, z.menu), false, `sortie ${i} / « ⋯ » (zoom ${k})`);
        if (i > 0) assert.equal(recouvre(s, z.sorties[i - 1]), false, `deux sorties voisines (zoom ${k})`);
        assert.ok(s.g < L.SORTIE_X && L.SORTIE_X < s.d, 'la zone contient le rond de sortie');
        // Arrêtée à gauche par le « + », la zone d'une sortie s'allonge vers la droite : 44 px de large à l'écran, à tout zoom.
        assert.ok((s.d - s.g) * k >= 44 - 1e-9, `sortie ${i} : 44 px de large à l'écran (zoom ${k} : ${((s.d - s.g) * k).toFixed(1)})`);
      }
      assert.ok(z.entree.d <= z.plus.g, 'l\'entrée est loin du « + »');
      // Le « + » mord sur le bord droit du rond (il passe devant) : de 14 px, pas plus.
      assert.equal(z.rond.d - z.plus.g, 14);
      if (k >= 1) for (const r of [z.menu, z.plus, z.entree, z.sorties[m - 1]]) assert.ok((r.d - r.g) * k >= 44 - 1e-9, `44 px à l'écran (zoom ${k})`);
    }
  }
  // Les mesures du croquis, lues telles quelles.
  const z1 = L.zonesBloc(1), z4 = L.zonesBloc(0.4);
  assert.deepEqual(ici(z1.plus), { g: 129, h: 26, d: 173, b: 70 });
  assert.deepEqual(ici(z1.sorties[0]), { g: 173, h: 26, d: 217, b: 70 }); assert.deepEqual(ici(z4.sorties[0]), { g: 173, h: -7, d: 283, b: 103 }, 'zoom 0,4 : 110 px du schéma vers la droite, 44 px à l\'écran');
  assert.deepEqual(ici(z1.menu), { g: 73, h: -34, d: 117, b: 10 }); assert.deepEqual(ici(z4.menu), { g: 40, h: -100, d: 150, b: 10 });
  assert.deepEqual(ici(z1.entree), { g: 3, h: 26, d: 47, b: 70 });
  assert.deepEqual(ici(z1.rond), { g: 47, h: 0, d: 143, b: 96 });
  assert.deepEqual([z1.nom.h, z1.nom.b, z1.ligne.b, z1.resultat.b], [102, 120, 136, 152]);
});

test('deux blocs enregistrés à 110 px l\'un sous l\'autre : le « ⋯ » du bas ne couvre ni le nom ni la 2e ligne du haut, au zoom 1 et au zoom 0,4', () => {
  const L = logique();
  const haut: Pos = [400, 160], bas: Pos = [400, 160 + L.PAS_Y];
  const dyHaut = L.yDessin(haut[1]), dyBas = L.yDessin(bas[1]);
  for (const k of ZOOMS) {
    const zh = L.zonesBloc(k), zb = L.zonesBloc(k);
    const menuBas = decale(zb.menu, bas[0], dyBas);
    for (const [quoi, r] of [['le nom', zh.nom], ['la 2e ligne', zh.ligne], ['le rond', zh.rond]] as const) {
      assert.equal(recouvre(menuBas, decale(r, haut[0], dyHaut)), false, `le « ⋯ » du bas et ${quoi} du haut, zoom ${k}`);
    }
    assert.ok(dyBas - dyHaut >= L.HAUT_TESTE, 'les deux blocs dessinés ne se chevauchent pas, même après un test');
  }
  // Les marges, au zoom 1 et au zoom 0,4 (mesures du croquis : 72 px et 6 px d'air sous la 2e ligne).
  const air = (k: number) => (dyBas + L.zonesBloc(k).menu.h) - (dyHaut + L.zonesBloc(k).ligne.b);
  assert.equal(Math.round(air(1)), 72); assert.equal(Math.round(air(0.4)), 6);
  // La ligne de résultat d'un bloc testé (lot 5b) : libre au zoom 1 ; au zoom 0,4, ses 10 derniers pixels sont sous le
  // « ⋯ » du bas, comme le dit le croquis validé (cercles-comparaison.md § 4) — pas un pixel de plus.
  const resultatCouvert = (k: number) => Math.max(0, (dyHaut + L.zonesBloc(k).resultat.b) - (dyBas + L.zonesBloc(k).menu.h));
  assert.equal(Math.round(resultatCouvert(1)), 0); assert.equal(Math.round(resultatCouvert(0.4)), 10);
});

test('placeLibre et collerBloc gardent leurs écarts enregistrés : une fois dessinés, deux blocs ne se chevauchent pas, même après un test ; le « ⋯ » d\'une copie ne couvre pas le bloc copié ; au plus petit écart de placeLibre, le « ⋯ » ne couvre pas le nom du dessus au zoom 1', () => {
  const L = logique();
  // placeLibre : moins de 90 px enregistrés = place prise ; 90 enregistrés = 198 dessinés, sous un bloc testé (152).
  assert.ok(L.yDessin(90) >= L.HAUT_TESTE);
  const nodes = [{ position: [100, 100] as Pos }];
  const p = L.placeLibre(nodes, 100, 100);
  assert.ok(L.yDessin(p[1]) - L.yDessin(100) >= L.HAUT_TESTE);
  // Au plus petit écart que placeLibre laisse (90 enregistrés, ici en posant au-dessus) : au zoom 1, le « ⋯ » du bas
  // reste sous le bloc du haut, même testé. Limite connue, gardée telle quelle (placeLibre ne change pas) : au zoom 0,4,
  // ce « ⋯ » couvre le nom du haut — c'est déjà le cas aujourd'hui avec les blocs rectangulaires.
  const q = L.placeLibre(nodes, 100, 10);
  assert.deepEqual(ici(q), [100, 10],'90 enregistrés au-dessus : la place est libre');
  const z1 = L.zonesBloc(1);
  assert.ok(L.yDessin(100) + z1.menu.h >= L.yDessin(q[1]) + L.HAUT_TESTE, 'zoom 1 : le « ⋯ » du bas sous le bloc du haut testé');
  // collerBloc : la copie va sous le bloc copié ; son « ⋯ » ne touche pas le bas du bloc du dessus (après un test).
  for (const k of [1, 0.4]) {
    const wf = { nodes: [{ name: 'Bloc', type: 'temps.attendre', params: { secondes: 1 }, position: [200, 40] as Pos }] };
    const r = L.collerBloc(wf, wf.nodes[0], k);
    const c = wf.nodes.find((n) => n.name === r.name)!;
    const haut = L.yDessin(c.position[1]) + L.zonesBloc(k).menu.h, basDessus = L.yDessin(40) + L.HAUT_TESTE;
    assert.ok(haut >= basDessus, `zoom ${k} : ${haut} ≥ ${basDessus}`);
  }
});

// ------------------------------------------------------------------ un document minimal (pour le nom lisible)
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Array<Noeud | null> = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; value = ''; hidden = false; checked = false; texte = ''; html = '';
  classList = {
    add: (c: string) => { if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim(); },
    remove: (c: string) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    toggle: (c: string, on?: boolean) => { if (on ?? !this.classList.contains(c)) this.classList.add(c); else this.classList.remove(c); },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
  };
  constructor(tag: string, type = 1) { this.tagName = tag.toUpperCase(); this.nodeType = type; }
  get id() { return this.attrs.id ?? ''; }
  get disabled() { return 'disabled' in this.attrs; }
  set innerHTML(h: string) { this.html = h; }
  get children() { return this.enfants.filter((x): x is Noeud => x !== null && x.nodeType === 1); }
  get textContent(): string { return this.nodeType === 3 ? this.texte : this.enfants.map((x) => (x === null ? 'null' : x.textContent)).join(''); }
  set textContent(t: string) { this.enfants = []; if (t) this.ajouter(new Texte(String(t))); }
  get isConnected() { let n: Noeud | null = this; while (n.parent) n = n.parent; return n === racine; }
  private ajouter(k: Noeud | string | null) {
    const n = k === null ? null : typeof k === 'object' ? k : new Texte(String(k));
    if (n) { n.parent?.retirer(n); n.parent = this; }
    this.enfants.push(n);
  }
  retirer(n: Noeud) { this.enfants = this.enfants.filter((x) => x !== n); n.parent = null; }
  append(...ks: Array<Noeud | string | null>) { for (const k of ks) this.ajouter(k); }
  replaceChildren(...ks: Array<Noeud | string | null>) { for (const e of this.enfants) if (e) e.parent = null; this.enfants = []; this.append(...ks); }
  replaceWith(n: Noeud) { const p = this.parent; if (!p) return; const i = p.enfants.indexOf(this); p.enfants[i] = n; n.parent = p; this.parent = null; }
  remove() { this.parent?.retirer(this); }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  removeEventListener(t: string, f: Ecoute) { this.ecoutes[t] = (this.ecoutes[t] ?? []).filter((x) => x !== f); }
  focus() {} setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }; }
  closest(s: string): Noeud | null { let n: Noeud | null = this; while (n) { if (n.correspond(s)) return n; n = n.parent; } return null; }
  correspond(s: string): boolean {
    if (this.nodeType !== 1) return false;
    const m = /^([a-z0-9]*)((?:[#.][\w-]+)*)$/i.exec(s.trim()); if (!m) return false;
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const p of m[2].match(/[#.][\w-]+/g) ?? []) { if (p[0] === '#' ? this.id !== p.slice(1) : !this.classList.contains(p.slice(1))) return false; }
    return true;
  }
  tous(): Noeud[] { return this.children.flatMap((c) => [c, ...c.tous()]); }
  querySelectorAll(s: string): Noeud[] {
    const listes = s.split(',').map((x) => x.trim().split(/\s+/));
    const prend = (n: Noeud, parts: string[]) => { if (!n.correspond(parts[parts.length - 1])) return false; let i = parts.length - 2, p = n.parent; while (i >= 0 && p) { if (p.correspond(parts[i])) i--; p = p.parent; } return i < 0; };
    return this.tous().filter((n) => listes.some((parts) => prend(n, parts)));
  }
  querySelector(s: string) { return this.querySelectorAll(s)[0] ?? null; }
}
class Texte extends Noeud { constructor(t: string) { super('#text', 3); this.texte = t; } }
racine = new Noeud('html');

// Des valeurs neutres : une appli d'essai, des blocs du catalogue.
const ESSAI = { id: 'essai', nom: 'Appli essai', famille: 'Essais', evenements: [], actions: [
  { id: 'lire', label: 'Lire une valeur', what: '', params: [{ key: 'adresse', label: 'Adresse', kind: 'text', required: true }], read: true, grave: false },
] };
const CATALOG = [
  { type: 'déclencheur.manuel', label: 'Lancer à la main', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'déclencheur.planning', label: 'Planning', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'logique.si', label: 'Si', group: 'Logique', outputs: ['oui', 'non'], params: [{ key: 'condition', default: '' }] },
  { type: 'temps.attendre', label: 'Attendre', group: 'Logique', params: [{ key: 'secondes', default: 5 }] },
  { type: 'module.action', label: 'Action d\'une appli', group: 'Applis', params: [{ key: 'module', label: 'Appli', kind: 'text', required: true }, { key: 'action', label: 'Action', kind: 'text', required: true }, { key: 'entrée', label: 'Réglages', kind: 'json', default: '{}' }] },
];
const FLOW = { id: 'c1', name: 'Cercles', active: false, nodes: [
  { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
  { name: 'Si', type: 'logique.si', params: { condition: '' }, position: [340, 160] },
  { name: 'Attendre', type: 'temps.attendre', params: { secondes: 5 }, position: [620, 60] },
  { name: 'Lire', type: 'module.action', params: { module: 'essai', action: 'lire', entrée: '{"adresse":""}' }, position: [620, 270] },
  { name: 'Mon relevé', type: 'module.action', params: { module: 'essai', action: 'lire', entrée: '{"adresse":"https://example.org/"}' }, position: [900, 270] },
], connections: { Lancer: [[{ node: 'Si' }]], Si: [[{ node: 'Attendre' }], [{ node: 'Lire' }]], Lire: [[{ node: 'Mon relevé' }]] } };

// Deux blocs enregistrés à 110 px l'un sous l'autre (PAS_Y), après un déclencheur Planning.
const PILE = { id: 'c2', name: 'Pile', active: false, nodes: [
  { name: 'Planning', type: 'déclencheur.planning', params: {}, position: [100, 50] },
  { name: 'Haut', type: 'temps.attendre', params: { secondes: 1 }, position: [400, 160] },
  { name: 'Bas', type: 'temps.attendre', params: { secondes: 2 }, position: [400, 270] },
], connections: { Planning: [[{ node: 'Haut' }]] } } as unknown as typeof FLOW;

async function page(flow: typeof FLOW = FLOW) {
  racine = new Noeud('html');
  const vue = new Noeud('section'); vue.setAttribute('id', 'v-flows');
  const head = new Noeud('div'); head.className = 'head'; const h1 = new Noeud('h1'); const sub = new Noeud('p'); sub.className = 'sub'; head.append(h1, sub);
  const body = new Noeud('div'); body.className = 'body'; vue.append(head, body); racine.append(vue);
  const document = {
    readyState: 'complete', head: new Noeud('head'), body: racine, activeElement: null,
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), querySelectorAll: (s: string) => racine.querySelectorAll(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
    addEventListener() {}, removeEventListener() {},
  };
  const reponses: Record<string, () => unknown> = {
    '/api/draupnir/state': () => ({ ok: true, flows: [], templates: [], catalog: CATALOG, dossiers: [] }),
    '/api/draupnir/flow': () => ({ ok: true, flow: JSON.parse(JSON.stringify(flow)), outputs: {}, runs: [], versions: [] }),
    '/api/draupnir/applis': () => ({ ok: true, applis: [ESSAI] }),
  };
  const fetch = async (chemin: string) => { const f = reponses[chemin.split('?')[0]]; return { status: 200, ok: true, json: async () => (f ? f() : { ok: false, error: 'inconnu' }) }; };
  const window: Record<string, unknown> = { OdinAppIcons: { tile: (id: string, _n = '', taille = 40) => `<svg data-appli="${id}" width="${taille}"></svg>`, couleurs: (id: string) => (id === 'draupnir' ? ['#ff8f33', '#efa506'] : null) }, OdinDialog: { confirm: async () => true, alert: async () => {}, prompt: async () => null } };
  const ctx = { window, document, fetch, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, console };
  vm.runInNewContext(FLOWS, ctx); vm.runInNewContext(LIEN, ctx);
  await (window.OdinFlows as { edit: (id: string) => Promise<void> }).edit(flow.id); await attendre();
  const css = document.head.querySelectorAll('style').map((s) => s.textContent).join('\n');
  /** Le corps d'une règle de style (la première dont le sélecteur est exactement `sel`). */
  const regle = (sel: string) => new RegExp(`(?:^|[}\\n])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const bloc = (nom: string) => body.querySelectorAll('.dr-node').find((d) => (d.getAttribute('aria-label') ?? '').includes(`(${nom})`) || (d.getAttribute('aria-label') ?? '').startsWith(`${nom} (`))!;
  return { body, css, regle, bloc, svg: racine.querySelector('#drCanvas')!.children.find((c) => c.tagName === 'SVG')! };
}
const attendre = () => new Promise((ok) => setTimeout(ok, 20));

test('page : le nom lisible de chaque bloc ne change pas (outil, appli, appli renommée)', async () => {
  const p = await page();
  const noms = p.body.querySelectorAll('.dr-node').map((d) => d.getAttribute('aria-label'));
  assert.deepEqual(noms, [
    'Lancer (Lancer à la main)',
    'Si (Si)',
    'Attendre (Attendre)',
    'Appli essai : Lire une valeur (Lire)',
    'Appli essai : Lire une valeur (Mon relevé)',
  ]);
  // Les classes que les essais retrouvent sont toujours là, une fois par bloc.
  for (const d of p.body.querySelectorAll('.dr-node')) {
    assert.equal(d.querySelectorAll('.dr-nom').length, 1, `.dr-nom sur ${d.getAttribute('aria-label')}`);
    assert.equal(d.querySelectorAll('.dr-mb').length, 1); assert.equal(d.querySelectorAll('.dr-plus').length, 1);
  }
});

// ------------------------------------------------------------------ la page dessinée (étapes 5-2 à 5-6)
/** Un nombre de pixels lu dans un texte de style (`top:352px`) ; NaN s'il manque. */
const px = (texte: string, prop: string) => Number(new RegExp(`(?:^|[;{])${prop}:(-?[\\d.]+)px`).exec(texte)?.[1]);

test('page : deux blocs enregistrés à 110 px l\'un sous l\'autre, mesurés sur la page (places des blocs, règles de style) : dessinés à 242 px, le « ⋯ » du bas ne couvre pas le nom du haut, au zoom 1 et au zoom 0,4', async () => {
  const L = logique(), p = await page(PILE);
  const haut = p.bloc('Haut'), bas = p.bloc('Bas');
  const top = (d: Noeud) => px(d.getAttribute('style') ?? '', 'top'), left = (d: Noeud) => px(d.getAttribute('style') ?? '', 'left');
  assert.deepEqual([left(haut), top(haut), left(bas), top(bas)], [400, 352, 400, 594], 'y dessiné = y enregistré × 2,2 ; les x ne changent pas');
  assert.ok(top(bas) - top(haut) >= L.HAUT_TESTE, 'les deux blocs dessinés ne se chevauchent pas, même après un test');
  // Le nom : la première ligne du bloc qui n'est pas posée à part (le rond, les ronds à relier, le « + », le « ⋯ »… le sont).
  const absolu = (n: Noeud) => n.className.split(/\s+/).filter(Boolean).some((c) => new RegExp(`\\.${c}\\{[^}]*position:absolute`).test(p.css));
  const flux = haut.children.filter((c) => !absolu(c));
  assert.ok(flux[0]?.classList.contains('dr-nom'), `le nom est la première ligne sous le rond (${flux.map((c) => c.className).join(' | ')})`);
  const caseBloc = p.regle('.dr-node'), largeur = px(caseBloc, 'width'), sous = px(caseBloc, 'padding-top'), ligne = px(p.regle('.dr-node b'), 'line-height');
  assert.ok(Number.isFinite(sous) && Number.isFinite(ligne), `la place du nom se lit dans le style (padding-top ${sous}, line-height ${ligne})`);
  assert.equal(largeur, L.NODE_W);
  assert.deepEqual([sous, sous + ligne], [L.zonesBloc(1).nom.h, L.zonesBloc(1).nom.b], 'la page et zonesBloc disent la même place du nom');
  const nom = { g: left(haut), d: left(haut) + largeur, h: top(haut) + sous, b: top(haut) + sous + ligne };
  // Le « ⋯ » : sa règle de style, la zone qui suit le zoom (--dr-z = zoneToucher(k)).
  const mb = p.regle('.dr-mb');
  const m = /left:calc\((\d+)px - var\(--dr-z,44px\) \/ 2\)/.exec(mb), t = /top:calc\((\d+)px - var\(--dr-z,44px\)\)/.exec(mb);
  assert.ok(m && t && /width:var\(--dr-z,44px\)/.test(mb) && /height:var\(--dr-z,44px\)/.test(mb), 'le « ⋯ » est placé par sa règle de style');
  for (const k of [1, 0.4]) {
    const z: number = L.zoneToucher(k), cx: number = Number(m![1]), bord: number = Number(t![1]);
    const menuBas: Rect = { g: left(bas) + cx - z / 2, d: left(bas) + cx + z / 2, h: top(bas) + bord - z, b: top(bas) + bord };
    assert.equal(recouvre(menuBas, nom), false, `zoom ${k} : « ⋯ » du bas ${JSON.stringify(menuBas)} / nom du haut ${JSON.stringify(nom)}`);
  }
});

test('page : chaque bloc est un rond de 96 px (anneau clair ; l\'icône de son appli, 44 px, au centre ; un bloc de Talos aux couleurs de Talos, sans icône), le nom dessous ; le « + » à droite, à mi-hauteur ; la pastille chiffrée des réglages qui manquent ; l\'horloge du seul déclencheur Planning', async () => {
  const p = await page();
  const rond = p.regle('.dr-rond');
  assert.match(rond, /position:absolute/); assert.equal(px(rond, 'left'), 47); assert.match(rond, /(?:^|;)top:0(?:px)?(?:;|$)/);
  assert.equal(px(rond, 'width'), 96); assert.equal(px(rond, 'height'), 96); assert.match(rond, /border-radius:50%/);
  assert.match(rond, /box-shadow:0 0 0 6px /, 'un anneau clair de 6 px autour');
  for (const [nom, appli] of [['Lancer', ''], ['Si', ''], ['Attendre', ''], ['Lire', 'essai'], ['Mon relevé', 'essai']]) {
    const d = p.bloc(nom), r = d.children.filter((c) => c.classList.contains('dr-rond'));
    assert.equal(r.length, 1, `un rond sur ${nom}`);
    const icone = r[0].tous().map((x) => x.html).join('');
    if (appli) assert.match(icone, new RegExp(`data-appli="${appli}" width="44"`), `${nom} : l'icône de ${appli}, 44 px, telle quelle`);
    else assert.equal(icone, '', `${nom} : un bloc de Talos n'a pas d'icône (comme aujourd'hui ; aucun innerHTML)`);
  }
  assert.match(p.bloc('Lancer').children.find((c) => c.classList.contains('dr-rond'))!.getAttribute('style') ?? '', /--dr-c0:#ff8f33;--dr-c1:#efa506/, 'un bloc de Talos : ses couleurs dans Odin');
  // Le « + » : à droite du rond, à mi-hauteur ; zone de 44 px, rond de 28 px.
  const plus = p.regle('.dr-plus');
  assert.deepEqual([px(plus, 'left'), px(plus, 'top'), px(plus, 'width'), px(plus, 'height')], [129, 26, 44, 44]);
  assert.equal(px(p.regle('.dr-plus span'), 'width'), 28);
  // Les réglages qui manquent : un disque chiffré (pas de liste sous le nom), qui ne se touche pas.
  const lire = p.bloc('Lire').querySelectorAll('.dr-manque');
  assert.equal(lire.length, 1); assert.ok(lire[0].classList.contains('dr-rond-manque')); assert.equal(lire[0].textContent, '1');
  assert.equal(lire[0].getAttribute('title'), null, 'pas de bulle de survol (le disque ne se touche pas)');
  assert.equal(p.bloc('Mon relevé').querySelector('.dr-manque'), null, 'rien ne manque : pas de pastille');
  assert.ok(p.body.querySelectorAll('.dr-node').every((d) => !d.textContent.includes('À remplir')), 'la ligne rouge sous le nom disparaît');
  const manque = p.regle('.dr-node .dr-manque');
  assert.match(manque, /pointer-events:none/); assert.equal(px(manque, 'width'), 22); assert.equal(px(manque, 'height'), 22);
  assert.doesNotMatch(p.css, /\.dr-node\.trig\{[^}]*border-left/, 'plus de bord gauche de rectangle');
  // L'horloge : sur le déclencheur Planning seulement.
  assert.equal(p.bloc('Lancer').querySelector('.dr-horloge'), null, 'Lancer à la main : pas d\'horloge');
  const q = await page(PILE);
  assert.ok(q.bloc('Planning').querySelector('.dr-horloge'), 'Planning : une horloge');
  assert.equal(q.bloc('Haut').querySelector('.dr-horloge'), null);
  assert.equal(px(q.regle('.dr-horloge'), 'width'), 40);
});

test('page : les liaisons partent de departLien et arrivent à arriveeLien, en petits ronds de 10 px tous les 15 px, de la couleur du bloc de départ à celle du bloc d\'arrivée', async () => {
  const L = logique(), p = await page();
  const liens = p.svg.tous().filter((x) => x.classList.contains('dr-link')), fils = p.svg.tous().filter((x) => x.classList.contains('dr-fil'));
  assert.equal(liens.length, 4); assert.equal(fils.length, 4, 'un fil touchable par liaison, comme avant');
  const d = (de: string, vers: string) => fils.find((f) => f.getAttribute('data-de') === de && f.getAttribute('data-vers') === vers)!.getAttribute('d') ?? '';
  const bouts = (t: string) => { const n = t.match(/-?[\d.]+/g)!.map(Number); return [n.slice(0, 2), n.slice(-2)]; };
  const pos = (nom: string) => FLOW.nodes.find((n) => n.name === nom)!.position as Pos;
  assert.deepEqual(bouts(d('Lancer', 'Si')), [ici(L.departLien(pos('Lancer'))), ici(L.arriveeLien(pos('Si')))]);
  assert.deepEqual(bouts(d('Si', 'Attendre')), [ici(L.departLien(pos('Si'), 0, 2)), ici(L.arriveeLien(pos('Attendre')))], '« oui »');
  assert.deepEqual(bouts(d('Si', 'Lire')), [ici(L.departLien(pos('Si'), 1, 2)), ici(L.arriveeLien(pos('Lire')))], '« non »');
  for (const [i, l] of liens.entries()) assert.equal(l.getAttribute('d'), fils[i].getAttribute('d'), 'le dessin et le fil touchable suivent le même chemin');
  const r = p.regle('.dr-link');
  assert.match(r, /stroke-width:10/); assert.match(r, /stroke-dasharray:0 15/); assert.match(r, /stroke-linecap:round/);
  // La couleur : un dégradé du bloc de départ (Talos) vers l'arrivée ; une appli sans couleur connue : l'accent.
  const degrade = (l: Noeud) => { const id = /url\(#([\w-]+)\)/.exec(l.getAttribute('stroke') ?? '')?.[1]; return p.svg.tous().find((x) => id && x.getAttribute('id') === id); };
  const arret = (s: Noeud) => /stop-color:([^;]+)/.exec(s.getAttribute('style') ?? '')?.[1];
  const lancerSi = liens[fils.findIndex((f) => f.getAttribute('data-de') === 'Lancer')];
  assert.ok(degrade(lancerSi), 'un dégradé par liaison');
  assert.deepEqual(degrade(lancerSi)!.children.map(arret), ['#efa506', '#efa506']);
  const lireReleve = liens[fils.findIndex((f) => f.getAttribute('data-de') === 'Lire')];
  assert.deepEqual(degrade(lireReleve)!.children.map(arret), ['var(--accent)', 'var(--accent)']);
});

// ------------------------------------------------------------------ corrections après relecture
test('page : la zone d\'une sortie fait au moins 44 px de large à l\'écran (elle part de la butée du « + » vers la droite), comme zonesBloc', async () => {
  const L = logique(), p = await page();
  const out = p.regle('.dr-port.out');
  assert.match(out, /--g:max\(173px,calc\(195px - var\(--z\) \/ 2\)\)/, 'la butée à gauche : le bord droit du « + »');
  assert.match(out, /width:max\(var\(--z\),calc\(195px \+ var\(--z\) \/ 2 - var\(--g\)\)\)/, 'au moins --z (44 px à l\'écran) de large');
  assert.equal(L.PLUS_X + L.ZONE_PLUS / 2, 173); assert.equal(L.SORTIE_X, 195);
  for (const k of [1, 0.74, 0.4]) {
    const z = L.zoneToucher(k), g = Math.max(173, 195 - z / 2), large = Math.max(z, 195 + z / 2 - g), s = L.zonesBloc(k).sorties[0];
    assert.deepEqual(ici([g, g + large]), ici([s.g, s.d]), `la page et zonesBloc disent la même zone (zoom ${k})`);
    assert.ok(large * k >= 44 - 1e-9, `zoom ${k} : ${(large * k).toFixed(1)} px à l'écran`);
  }
});

test('page : les mots « oui » / « non » d\'une sortie se lisent devant les points de la liaison (fond du schéma derrière eux)', async () => {
  const L = logique(), p = await page();
  const si = p.bloc('Si'), mots = si.querySelectorAll('.dr-pl').map((x) => x.textContent);
  assert.deepEqual(mots, ['oui', 'non']);
  // Le mot est posé à droite du rond de sortie, là où la liaison part (x + 200, points de 10 px tous les 15 px) : il passe dessus.
  const pl = p.regle('.dr-port .dr-pl');
  assert.match(pl, /left:calc\(var\(--cx\) \+ 11px\)/); assert.ok(L.SORTIE_X + 11 < L.departLien([0, 0])[0] + 15, 'le mot est sur les premiers points');
  assert.match(pl, /background:var\(--panel2\)/, 'un fond de la couleur du schéma derrière le mot');
  // Les blocs (et donc le mot) sont dessinés après le dessin des liaisons : ils passent devant.
  const canvas = racine.querySelector('#drCanvas')!, enfants = canvas.children.map((c) => (c.tagName === 'SVG' ? 'svg' : c.className));
  assert.ok(enfants.indexOf('svg') >= 0 && enfants.indexOf('svg') < enfants.indexOf('dr-world'), `ordre : ${enfants.join(', ')}`);
});

test('page : la 2e ligne sous le nom, posée sur le fond du schéma, prend la couleur de texte atténué la plus lisible (--muted)', async () => {
  const p = await page();
  assert.match(p.regle('.dr-node small'), /color:var\(--muted\)/);
});

test('page : le rond « exécuté seul » tient au rond du bloc, en haut à gauche, sans couvrir la marque de note, la pastille, le rond d\'entrée, le « + » ni le « ⋯ »', async () => {
  const L = logique(), p = await page();
  const lire = (sel: string): Rect => { const r = p.regle(sel); return { g: px(r, 'left'), h: px(r, 'top'), d: px(r, 'left') + (px(r, 'width') || px(r, 'min-width')), b: px(r, 'top') + px(r, 'height') }; };
  const seul = lire('.dr-seul'), note = lire('.dr-note-m'), pastille = lire('.dr-node .dr-manque'), z = L.zonesBloc(1);
  assert.ok(Object.values(seul).every(Number.isFinite), JSON.stringify(seul));
  const cx = L.NODE_W / 2, cy = L.ROND / 2;
  const pres = (r: Rect) => Math.hypot(Math.max(r.g - cx, 0, cx - r.d), Math.max(r.h - cy, 0, cy - r.b));
  assert.ok(pres(seul) < L.ROND / 2, `il touche le rond (${pres(seul).toFixed(1)} px du centre)`);
  assert.ok(seul.d <= cx && seul.b <= cy, 'en haut à gauche du rond');
  const entree: Rect = { g: L.ENTREE_X - L.PORT_D / 2, h: cy - L.PORT_D / 2, d: L.ENTREE_X + L.PORT_D / 2, b: cy + L.PORT_D / 2 };
  for (const [quoi, r] of [['la marque de note', note], ['la pastille', pastille], ['le rond d\'entrée', entree], ['le « + »', z.plus], ['le « ⋯ »', z.menu]] as const) {
    assert.equal(recouvre(seul, r), false, `${quoi} : ${JSON.stringify(seul)} / ${JSON.stringify(r)}`);
  }
  // Il garde 22 px à l'écran quand on dézoome, en grandissant depuis son coin bas-droit, qui est dans le rond.
  assert.match(p.regle('.dr-seul'), /transform-origin:100% 100%/);
  assert.ok(Math.hypot(seul.d - cx, seul.b - cy) < L.ROND / 2);
});
