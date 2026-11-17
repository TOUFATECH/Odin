// Talos, l'éditeur à nœuds (src/web/flows.js) : le « + » pour ajouter un bloc.
// - Logique (sans document) : où le bloc est posé, à quoi il est relié, une fonction grave refusée, le premier bloc
//   d'une fenêtre vide est un déclencheur, les flèches dans la grille, le double toucher.
// - Page (petit document simulé, aucun navigateur, aucun paquet) : un « + » sur chaque bloc, la grille des applis
//   s'ouvre (celle de « Faire un lien », pages/talos-lien.js), une fonction grave ne se choisit pas, le bloc choisi est
//   posé et relié, Échap referme, un nom d'appli piégé reste du texte, la fenêtre vide a son grand « + ».
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const LIEN = readFileSync(new URL('../src/web/pages/talos-lien.js', import.meta.url), 'utf8');

type Pos = [number, number];
type Noeud0 = { name: string; type: string; params: Record<string, unknown>; position: Pos };
type Wf = { nodes: Noeud0[]; connections: Record<string, Array<Array<{ node: string }>>> };
type Choix = { ok: boolean; error?: string; bloc?: { name: string; type: string; trigger?: boolean; params: Record<string, unknown> } };
interface Logique {
  NODE_W: number; PAS_X: number; PAS_Y: number;
  nomLibre: (nodes: Noeud0[], base: string) => string;
  placeLibre: (nodes: Noeud0[], x: number, y: number) => Pos;
  sortieDuPlus: (wf: Wf, nom: string, sorties?: number) => number;
  modeChoix: (wf: Wf) => string;
  blocFonction: (appli: unknown, f: unknown) => Choix;
  blocSignal: (appli: unknown, ev?: string) => Choix;
  blocOutil: (c: unknown) => Choix;
  poser: (wf: Wf, c: Choix, ou?: { de?: { node: string; out?: number }; a?: Pos }) => { ok: boolean; name?: string; error?: string; lien?: { de: string; out: number } };
  pasFleche: (i: number, total: number, cols: number, touche: string) => number;
  estDoubleTouche: (a: unknown, b: unknown) => boolean;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

// Hydre telle que la décrirait GET /api/draupnir/applis (forme du contrat, valeurs d'exemple).
const HYDRE = { id: 'ymir', nom: 'Hydre', famille: 'Machines', evenements: ['alerte', 'machine_arretee'], actions: [
  { id: 'verifier_isos', label: 'Vérifier toutes les ISO', what: 'Compare chaque ISO à sa source.', params: [], read: false, grave: false },
  { id: 'demarrer', label: 'Démarrer une machine', what: 'Démarre une machine virtuelle.', params: [{ key: 'nom', label: 'Machine', kind: 'text', required: true, default: '' }, { key: 'attendre', label: 'Attendre', kind: 'boolean', default: true }], read: false, grave: false },
  { id: 'supprimer', label: 'Supprimer une machine', what: '', params: [{ key: 'nom', label: 'Machine', kind: 'text', required: true }], read: false, grave: true, raison: 'Action grave : elle demande ton accord et ne part pas d\'une automatisation.' },
] };
// Un nom d'appli piégé : il doit rester du texte.
const PIEGE = { id: 'piege', nom: '<img src=x onerror="alert(1)">Piège', famille: 'Essai', evenements: [], actions: [{ id: 'rien', label: '<b>gras</b>', what: '', params: [], read: true, grave: false }] };
const CATALOG = [
  { type: 'déclencheur.manuel', label: 'Lancer à la main', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'déclencheur.planning', label: 'Planning', group: 'Déclencheurs', trigger: true, params: [{ key: 'mode', default: 'simple' }] },
  { type: 'déclencheur.module', label: 'Quand une appli signale', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'logique.si', label: 'Si', group: 'Logique', outputs: ['oui', 'non'], params: [{ key: 'condition', default: '' }] },
  { type: 'temps.attendre', label: 'Attendre', group: 'Logique', params: [{ key: 'secondes', default: 5 }] },
  { type: 'module.action', label: 'Action d\'une appli', group: 'Applis', params: [] },
];

// ------------------------------------------------------------------ logique
function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document });
  assert.ok(win.OdinFlows?.logique, 'window.OdinFlows.logique est posé');
  return win.OdinFlows.logique;
}
const flux = (): Wf => ({
  nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] }, { name: 'Si', type: 'logique.si', params: {}, position: [300, 160] }],
  connections: { Lancer: [[{ node: 'Si' }]] },
});

test('« + » d\'un bloc : le nouveau bloc se pose à sa droite et lui est relié', () => {
  const L = logique(), wf = flux();
  const r = L.poser(wf, L.blocFonction(HYDRE, HYDRE.actions[0]), { de: { node: 'Si', out: 0 } });
  assert.equal(r.ok, true); assert.equal(r.name, 'Hydre · Vérifier toutes les ISO');
  const n = wf.nodes.find((x) => x.name === r.name)!;
  assert.deepEqual(ici(n.position), [300 + L.PAS_X, 160], 'à droite, à la même hauteur');
  assert.deepEqual(ici(n.params), { module: 'ymir', action: 'verifier_isos', entrée: '{}' }, 'le même bloc que « Faire un lien »');
  assert.equal(n.type, 'module.action');
  assert.deepEqual(ici(wf.connections.Si), [[{ node: r.name }]], 'relié depuis la sortie du « + »');
  // Les réglages par défaut d'une fonction partent avec le bloc (la chaîne vide non).
  const r2 = L.poser(wf, L.blocFonction(HYDRE, HYDRE.actions[1]), { de: { node: 'Si', out: 1 } });
  assert.deepEqual(JSON.parse(String(wf.nodes.find((x) => x.name === r2.name)!.params.entrée)), { attendre: true });
  assert.deepEqual(ici(wf.connections.Si[1]), [{ node: r2.name }], 'la sortie « non » du Si');
  assert.deepEqual(ici(wf.nodes.find((x) => x.name === r2.name)!.position), [300 + L.PAS_X, 160 + L.PAS_Y], 'la place à droite est prise : un cran plus bas');
});

test('« + » d\'un bloc déjà suivi : posé plus bas, relié aussi, sans écraser le lien existant ; noms jamais en double', () => {
  const L = logique(), wf = flux();
  const r = L.poser(wf, L.blocOutil(CATALOG[4]), { de: { node: 'Lancer', out: L.sortieDuPlus(wf, 'Lancer', 1) } });
  assert.deepEqual(ici(wf.nodes.at(-1)!.position), [60 + L.PAS_X, 160 + L.PAS_Y], 'le Si occupe la place à droite');
  assert.deepEqual(ici(wf.connections.Lancer[0]), [{ node: 'Si' }, { node: 'Attendre' }]);
  assert.deepEqual(ici(wf.nodes.at(-1)!.params), { secondes: 5 }, 'les réglages par défaut de l\'outil');
  assert.equal(r.lien?.de, 'Lancer');
  const r2 = L.poser(wf, L.blocOutil(CATALOG[4]), { de: { node: 'Lancer' } });
  assert.equal(r2.name, 'Attendre 2');
  assert.equal(L.nomLibre(wf.nodes, 'Attendre'), 'Attendre 3');
});

test('sortie du « + » : la première sans lien, sinon la première', () => {
  const L = logique(), wf = flux();
  assert.equal(L.sortieDuPlus(wf, 'Si', 2), 0);
  wf.connections.Si = [[{ node: 'Lancer' }]];
  assert.equal(L.sortieDuPlus(wf, 'Si', 2), 1, '« oui » est pris : « non »');
  wf.connections.Si.push([{ node: 'Lancer' }]);
  assert.equal(L.sortieDuPlus(wf, 'Si', 2), 0, 'tout est pris : la première');
  assert.equal(L.sortieDuPlus(wf, 'Inconnu', 1), 0);
});

test('« + » central et double-clic : posé à l\'endroit, sans lien', () => {
  const L = logique(), wf = flux();
  const r = L.poser(wf, L.blocOutil(CATALOG[4]), { a: [700, 420] });
  assert.equal(r.ok, true); assert.equal(r.lien, undefined);
  assert.deepEqual(ici(wf.nodes.at(-1)!.position), [700, 420]);
  assert.deepEqual(Object.keys(wf.connections), ['Lancer'], 'aucun lien ajouté');
});

test('une fonction grave est refusée : rien n\'est posé', () => {
  const L = logique(), wf = flux(), avant = JSON.stringify(wf);
  const c = L.blocFonction(HYDRE, HYDRE.actions[2]);
  assert.equal(c.ok, false); assert.match(c.error ?? '', /grave/i);
  const r = L.poser(wf, c, { de: { node: 'Si' } });
  assert.equal(r.ok, false); assert.equal(JSON.stringify(wf), avant, 'l\'automatisation est inchangée');
  // Grave sans raison donnée : la raison d'Odin.
  assert.match(L.blocFonction(HYDRE, { id: 'x', label: 'X', grave: true }).error ?? '', /ne part pas d'une automatisation/);
  // Un « + » d'un bloc qui n'existe plus : refusé.
  assert.equal(L.poser(wf, L.blocOutil(CATALOG[4]), { de: { node: 'Disparu' } }).ok, false);
});

test('fenêtre vide : le premier bloc est un déclencheur (quand) ; un déclencheur n\'est jamais relié par un « + »', () => {
  const L = logique();
  assert.equal(L.modeChoix({ nodes: [], connections: {} }), 'quand');
  assert.equal(L.modeChoix(flux()), 'faire');
  const wf: Wf = { nodes: [], connections: {} };
  const c = L.blocSignal(HYDRE, 'alerte');
  assert.deepEqual(ici(c.bloc), { name: 'Quand Hydre lance une alerte', type: 'déclencheur.module', trigger: true, params: { module: 'ymir', événement: 'alerte', niveau: 'haute' } });
  assert.equal(L.blocSignal(HYDRE).bloc!.name, 'Quand Hydre signale');
  assert.equal(L.blocSignal(HYDRE, 'machine_arretee').bloc!.name, 'Quand Hydre signale « machine_arretee »');
  assert.equal(L.poser(wf, c, { a: [60, 160] }).ok, true);
  const w2 = flux(); L.poser(w2, L.blocOutil(CATALOG[0]), { de: { node: 'Si' } });
  assert.equal(w2.connections.Si, undefined, 'pas de lien vers un déclencheur');
});

test('clavier et doigt : les flèches dans la grille, le double toucher', () => {
  const L = logique();
  assert.equal(L.pasFleche(0, 10, 4, 'ArrowRight'), 1);
  assert.equal(L.pasFleche(1, 10, 4, 'ArrowDown'), 5);
  assert.equal(L.pasFleche(5, 10, 4, 'ArrowUp'), 1);
  assert.equal(L.pasFleche(0, 10, 4, 'ArrowLeft'), 0, 'au bord, on reste');
  assert.equal(L.pasFleche(8, 10, 4, 'ArrowDown'), 8, 'pas de case en dessous');
  assert.equal(L.pasFleche(3, 10, 4, 'End'), 9); assert.equal(L.pasFleche(3, 10, 4, 'Home'), 0);
  assert.equal(L.pasFleche(2, 5, 1, 'ArrowDown'), 3, 'une liste : une colonne');
  assert.equal(L.estDoubleTouche({ t: 1000, x: 10, y: 10 }, { t: 1250, x: 18, y: 14 }), true);
  assert.equal(L.estDoubleTouche({ t: 1000, x: 10, y: 10 }, { t: 1600, x: 10, y: 10 }), false, 'trop lent');
  assert.equal(L.estDoubleTouche({ t: 1000, x: 10, y: 10 }, { t: 1100, x: 80, y: 10 }), false, 'trop loin');
  assert.equal(L.estDoubleTouche(null, { t: 1, x: 0, y: 0 }), false);
});

// ------------------------------------------------------------------ un document minimal
type Ecoute = (e: Record<string, unknown>) => unknown;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Array<Noeud | null> = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; value = ''; hidden = false; checked = false; texte = ''; html = '';
  classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: (c: string) => this.className.split(/\s+/).includes(c) };
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
  remove() { this.parent?.retirer(this); }
  setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) { for (const f of this.ecoutes[t] ?? []) await f({ type: t, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...plus }); }
  focus() { actif = this; } setPointerCapture() {}
  getBoundingClientRect() { return { width: 0, height: 0, left: 0, top: 0 }; }
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
    // Une liste « a, b » rend les nœuds dans l'ordre du document, comme le vrai navigateur.
    const listes = s.split(',').map((x) => x.trim().split(/\s+/));
    const prend = (n: Noeud, parts: string[]) => { if (!n.correspond(parts[parts.length - 1])) return false; let i = parts.length - 2, p = n.parent; while (i >= 0 && p) { if (p.correspond(parts[i])) i--; p = p.parent; } return i < 0; };
    return this.tous().filter((n) => listes.some((parts) => prend(n, parts)));
  }
  querySelector(s: string) { return this.querySelectorAll(s)[0] ?? null; }
}
class Texte extends Noeud { constructor(t: string) { super('#text', 3); this.texte = t; } }
let racine = new Noeud('html');
let actif: Noeud | null = null;

const FLOW = { id: 'f1', name: 'Bonjour', active: false, nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] }, { name: 'Attendre', type: 'temps.attendre', params: { secondes: 5 }, position: [300, 160] }], connections: { Lancer: [[{ node: 'Attendre' }]] } };
const VIDE = { id: 'f2', name: 'Vide', active: false, nodes: [], connections: {} };
async function page(flow: unknown) {
  racine = new Noeud('html'); actif = null;
  const vue = new Noeud('section'); vue.setAttribute('id', 'v-flows');
  const head = new Noeud('div'); head.className = 'head'; const h1 = new Noeud('h1'); const sub = new Noeud('p'); sub.className = 'sub'; head.append(h1, sub);
  const body = new Noeud('div'); body.className = 'body'; vue.append(head, body); racine.append(vue);
  const document = {
    readyState: 'complete', head: new Noeud('head'), body: racine, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), querySelectorAll: (s: string) => racine.querySelectorAll(s), getElementById: (i: string) => racine.querySelector(`#${i}`), addEventListener: () => {},
  };
  const appels: Array<{ chemin: string; corps?: Record<string, unknown> }> = [];
  const reponses: Record<string, (c?: Record<string, unknown>) => unknown> = {
    '/api/draupnir/state': () => ({ ok: true, flows: [], templates: [], catalog: CATALOG, dossiers: [] }),
    '/api/draupnir/flow': () => ({ ok: true, flow: JSON.parse(JSON.stringify(flow)), outputs: {}, runs: [], versions: [] }),
    '/api/draupnir/applis': () => ({ ok: true, applis: [HYDRE, PIEGE] }),
    '/api/draupnir/save': (c) => ({ ok: true, flow: c?.flow }),
  };
  const fetch = async (chemin: string, o?: { body?: string }) => {
    const corps = o?.body ? JSON.parse(o.body) as Record<string, unknown> : undefined;
    appels.push({ chemin, corps });
    const f = reponses[chemin.split('?')[0]];
    return { status: 200, ok: true, json: async () => (f ? f(corps) : { ok: false, error: 'inconnu' }) };
  };
  const alertes: string[] = [];
  const window: Record<string, unknown> = { OdinDialog: { confirm: async () => true, alert: async (t: string) => { alertes.push(t); }, prompt: async () => null } };
  const ctx = { window, document, fetch, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, console };
  vm.runInNewContext(FLOWS, ctx); vm.runInNewContext(LIEN, ctx);
  const flows = window.OdinFlows as { edit: (id: string) => Promise<void> };
  await flows.edit((flow as { id: string }).id);
  const bouton = (texte: string | RegExp, dans: Noeud = racine) => dans.querySelectorAll('button').find((b) => (typeof texte === 'string' ? b.textContent.trim() === texte : texte.test(b.textContent)));
  return { body, appels, alertes, bouton };
}
const attendre = () => new Promise((ok) => setTimeout(ok, 20));

test('page : un « + » sur chaque bloc, un vrai bouton nommé ; la colonne d\'ajout reste', async () => {
  const p = await page(FLOW);
  const blocs = p.body.querySelectorAll('.dr-node');
  assert.equal(blocs.length, 2);
  for (const b of blocs) {
    const plus = b.querySelector('.dr-plus');
    assert.ok(plus, 'un « + » sur le bloc'); assert.equal(plus!.tagName, 'BUTTON', 'atteignable au clavier');
    assert.match(plus!.getAttribute('aria-label') ?? '', /^Ajouter un bloc après /);
  }
  assert.equal(p.body.querySelector('.dr-vide'), null, 'pas de grand « + » : la fenêtre n\'est pas vide');
  assert.ok(p.bouton('+ Étape'), 'l\'ancien bouton « + Étape »'); assert.ok(p.body.querySelector('.dr-cat'), 'l\'ancienne colonne d\'ajout');
});

test('page : le « + » ouvre la grille des applis, puis leurs fonctions ; la grave est grisée ; le bloc choisi est relié', async () => {
  const p = await page(FLOW);
  const plus = p.body.querySelectorAll('.dr-node')[1].querySelector('.dr-plus')!;
  await plus.emettre('click'); await attendre();
  const fen = racine.querySelector('.dr-choix')!;
  assert.ok(fen, 'la fenêtre de choix est ouverte'); assert.equal(fen.getAttribute('role'), 'dialog');
  assert.equal(fen.querySelector('h2')!.textContent, 'Ajouter un bloc');
  assert.ok(fen.querySelector('.li-g'), 'la grille des applis de « Faire un lien »');
  assert.ok(fen.querySelector('input'), 'une recherche');
  const outils = fen.querySelector('.dr-ch-o')!.textContent;
  assert.match(outils, /Si/); assert.match(outils, /Attendre/);
  assert.doesNotMatch(outils, /Lancer à la main|Action d'une appli/, 'ni déclencheur ni le bloc d\'appli en texte : on passe par la grille');
  // Une appli, puis ses fonctions.
  await p.bouton('Hydre', fen)!.emettre('click');
  const grave = p.bouton(/Supprimer une machine/, fen)!;
  assert.notEqual(grave.getAttribute('disabled'), null, 'la fonction grave est grisée');
  assert.match(grave.textContent, /ne part pas d'une automatisation/, 'avec sa raison');
  await grave.emettre('click');
  assert.equal(p.body.querySelectorAll('.dr-node').length, 2, 'rien n\'est posé');
  await p.bouton(/Vérifier toutes les ISO/, fen)!.emettre('click');
  assert.equal(racine.querySelector('.dr-choix'), null, 'la fenêtre se referme');
  assert.equal(p.body.querySelectorAll('.dr-node').length, 3, 'le bloc est posé');
  assert.match(p.body.querySelector('#drSt')!.textContent, /ajouté après « Attendre »/);
  const side = p.body.querySelector('#drSide')!;
  assert.ok(!side.enfants.includes(null), 'le panneau du bloc ajouté ne reçoit aucun null'); assert.doesNotMatch(side.textContent, /\bnull\b/);
  await p.bouton('Enregistrer')!.emettre('click'); await attendre();
  const f = p.appels.find((a) => a.chemin === '/api/draupnir/save')!.corps!.flow as typeof FLOW & { nodes: Noeud0[] };
  const neuf = f.nodes.at(-1)!;
  assert.deepEqual(ici(neuf), { name: 'Hydre · Vérifier toutes les ISO', type: 'module.action', params: { module: 'ymir', action: 'verifier_isos', entrée: '{}' }, position: [580, 160] });
  assert.deepEqual(ici((f.connections as Record<string, unknown>).Attendre), [[{ node: 'Hydre · Vérifier toutes les ISO' }]], 'relié au bloc du « + »');
});

test('page : Échap referme ; « ← Applis » revient à la grille', async () => {
  const p = await page(FLOW);
  await p.body.querySelector('.dr-plus')!.emettre('click'); await attendre();
  const fen = racine.querySelector('.dr-choix')!;
  await p.bouton('Hydre', fen)!.emettre('click');
  await p.bouton('← Applis', fen)!.emettre('click');
  assert.ok(fen.querySelector('.li-g'), 'de retour à la grille');
  await fen.emettre('keydown', { key: 'Escape' });
  assert.equal(racine.querySelector('.dr-choix-fond'), null, 'refermée');
  assert.equal(p.body.querySelectorAll('.dr-node').length, 2, 'rien n\'est ajouté');
});

test('page : Tab et Maj+Tab tournent dans la fenêtre, dans l\'ordre de l\'écran, aux deux étapes', async () => {
  const p = await page(FLOW);
  await p.body.querySelector('.dr-plus')!.emettre('click'); await attendre();
  const fen = racine.querySelector('.dr-choix')!;
  const tab = async (maj = false) => fen.emettre('keydown', { key: 'Tab', shiftKey: maj });
  const ferme = fen.querySelector('.dr-ch-x')!;
  // Étape 1 : le dernier élément est le dernier outil, en bas ; la recherche est en haut.
  const derOutil = fen.querySelector('.dr-ch-o')!.querySelectorAll('button').at(-1)!;
  assert.equal(actif, fen.querySelector('input'), 'le focus part sur la recherche');
  derOutil.focus(); await tab();
  assert.equal(actif, ferme, 'Tab depuis le dernier outil revient sur « × » au lieu de sortir');
  await tab(true);
  assert.equal(actif, derOutil, 'Maj+Tab depuis « × » va au dernier outil, pas à la recherche');
  fen.querySelector('input')!.focus(); await tab();
  assert.equal(actif, fen.querySelector('input'), 'Tab depuis la recherche laisse le navigateur avancer vers la grille');
  // Étape 2 : le dernier élément est la dernière fonction permise.
  await p.bouton('Hydre', fen)!.emettre('click');
  const derFn = fen.querySelectorAll('button').filter((b) => !b.disabled).at(-1)!;
  derFn.focus(); await tab();
  assert.equal(actif, ferme);
  await tab(true);
  assert.equal(actif, derFn);
});

test('page : un nom d\'appli piégé reste du texte', async () => {
  const p = await page(FLOW);
  await p.body.querySelector('.dr-plus')!.emettre('click'); await attendre();
  const fen = racine.querySelector('.dr-choix')!;
  assert.equal(fen.querySelectorAll('img').length, 0, 'aucune image créée');
  const b = p.bouton(/Piège/, fen)!;
  assert.ok(b.textContent.includes('<img src=x onerror="alert(1)">Piège'), 'le nom s\'écrit tel quel');
  await b.emettre('click');
  assert.ok(fen.querySelector('h2')!.textContent.includes('<img'), 'le titre aussi');
  assert.ok(p.bouton(/<b>gras<\/b>/, fen), 'le nom de la fonction aussi');
  assert.equal(fen.querySelectorAll('b').filter((x) => x.textContent === 'gras').length, 0, 'aucune balise venue du nom');
});

test('page : fenêtre vide → grand « + » au centre, le premier bloc est un déclencheur, posé sans lien', async () => {
  const p = await page(VIDE);
  const vide = p.body.querySelector('.dr-vide')!;
  assert.ok(vide, 'le grand « + »');
  const b = vide.querySelector('button')!; assert.equal(b.getAttribute('aria-label'), 'Ajouter le premier bloc');
  await b.emettre('click'); await attendre();
  const fen = racine.querySelector('.dr-choix')!;
  assert.match(fen.querySelector('h2')!.textContent, /Quand/);
  const outils = fen.querySelector('.dr-ch-o')!.textContent;
  assert.match(outils, /Lancer à la main/); assert.match(outils, /Planning/);
  assert.doesNotMatch(outils, /Attendre|Si/, 'seulement des déclencheurs');
  // Une appli : ce qu'elle signale, pas ses fonctions.
  await p.bouton('Hydre', fen)!.emettre('click');
  assert.equal(p.bouton(/Vérifier toutes les ISO/, fen), undefined);
  await p.bouton(/lance une alerte/, fen)!.emettre('click');
  assert.equal(p.body.querySelectorAll('.dr-node').length, 1);
  assert.equal(p.body.querySelector('.dr-vide'), null, 'le grand « + » s\'efface');
  await p.bouton('Enregistrer')!.emettre('click'); await attendre();
  const f = p.appels.find((a) => a.chemin === '/api/draupnir/save')!.corps!.flow as { nodes: Noeud0[]; connections: Record<string, unknown> };
  assert.equal(f.nodes[0].type, 'déclencheur.module'); assert.deepEqual(ici(f.nodes[0].params), { module: 'ymir', événement: 'alerte', niveau: 'haute' });
  assert.deepEqual(ici(f.connections), {}, 'sans lien');
});
