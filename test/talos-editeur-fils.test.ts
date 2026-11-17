// Talos, l'éditeur à nœuds (src/web/flows.js) : les fils entre les blocs.
// - Logique (sans document) : insérer un bloc au milieu d'un fil (deux liens, la sortie d'origine gardée), retirer un
//   fil, les refus d'un lien (vers un déclencheur, deux fois le même, un bloc vers lui-même), le bloc sous le pointeur.
// - Page (petit document simulé, aucun navigateur) : toucher un fil ouvre un petit menu au lieu de le retirer ;
//   « Retirer ce lien », « Ajouter un bloc ici », Échap et un toucher ailleurs ; le fil au clavier ; les ronds avec
//   une zone de 44 px ; relier en tirant un fil ; les deux touchers comme avant ; ouvrir puis enregistrer à l'identique.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const LIEN = readFileSync(new URL('../src/web/pages/talos-lien.js', import.meta.url), 'utf8');

type Pos = [number, number];
type Lien = { node: string; input?: number };
type Noeud0 = { name: string; type: string; params: Record<string, unknown>; position: Pos };
type Wf = { nodes: Noeud0[]; connections: Record<string, Array<Array<Lien>>> };
type Choix = { ok: boolean; error?: string; bloc?: { name: string; type: string; trigger?: boolean; params: Record<string, unknown> } };
type Boite = { name: string; left: number; top: number; width: number; height: number };
interface Logique {
  NODE_W: number;
  blocOutil: (c: unknown) => Choix;
  blocFonction: (appli: unknown, f: unknown) => Choix;
  inserer: (wf: Wf, c: Choix, fil: { de: string; out: number; vers: string }) => { ok: boolean; name?: string; error?: string };
  retirerLien: (wf: Wf, de: string, out: number, vers: string) => boolean;
  refusLien: (wf: Wf, de: string, out: number, vers: string, declencheur: boolean) => string;
  blocSous: (boites: Boite[], x: number, y: number) => string | null;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

const HYDRE = { id: 'ymir', nom: 'Hydre', famille: 'Machines', evenements: ['alerte'], actions: [
  { id: 'verifier_isos', label: 'Vérifier toutes les ISO', what: '', params: [], read: false, grave: false },
  { id: 'supprimer', label: 'Supprimer une machine', what: '', params: [], read: false, grave: true },
] };
const CATALOG = [
  { type: 'déclencheur.manuel', label: 'Lancer à la main', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'logique.si', label: 'Si', group: 'Logique', outputs: ['oui', 'non'], params: [{ key: 'condition', default: '' }] },
  { type: 'temps.attendre', label: 'Attendre', group: 'Logique', params: [{ key: 'secondes', default: 5 }] },
  { type: 'module.action', label: 'Action d\'une appli', group: 'Applis', params: [{ key: 'module', label: 'Appli', kind: 'text', required: true }, { key: 'action', label: 'Action', kind: 'text', required: true }, { key: 'entrée', label: 'Réglages', kind: 'json', default: '{}' }] },
];

// ------------------------------------------------------------------ logique
function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document });
  return win.OdinFlows!.logique;
}
/** Lancer → Si ; le « non » du Si → Fin (avec une entrée numérotée, comme en garde un import) ; le « oui » → Attendre. */
const fourche = (): Wf => ({
  nodes: [
    { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
    { name: 'Si', type: 'logique.si', params: {}, position: [340, 160] },
    { name: 'Attendre', type: 'temps.attendre', params: {}, position: [900, 60] },
    { name: 'Fin', type: 'temps.attendre', params: {}, position: [900, 300] },
  ],
  connections: { Lancer: [[{ node: 'Si' }]], Si: [[{ node: 'Attendre' }], [{ node: 'Fin', input: 0 }]] },
});

test('insérer au milieu d\'un fil : l\'ancien lien devient deux liens, la sortie d\'origine (« non ») est gardée', () => {
  const L = logique(), wf = fourche();
  const r = L.inserer(wf, L.blocOutil(CATALOG[2]), { de: 'Si', out: 1, vers: 'Fin' });
  assert.equal(r.ok, true); assert.equal(r.name, 'Attendre 2', 'un nom libre');
  assert.deepEqual(ici(wf.connections.Si), [[{ node: 'Attendre' }], [{ node: 'Attendre 2' }]], 'le « non » du Si mène au nouveau bloc ; le « oui » ne bouge pas');
  assert.deepEqual(ici(wf.connections['Attendre 2']), [[{ node: 'Fin', input: 0 }]], 'le nouveau bloc mène où menait le fil, avec la même entrée');
  assert.deepEqual(ici(wf.connections.Lancer), [[{ node: 'Si' }]], 'les autres fils sont intacts');
  const n = wf.nodes.find((x) => x.name === 'Attendre 2')!;
  assert.deepEqual(ici(n.params), { secondes: 5 });
  // Entre les deux : à mi-chemin en largeur, sans recouvrir un bloc.
  const [x, y] = n.position;
  assert.ok(x > 340 && x < 900, `entre les deux en largeur (${x})`);
  for (const m of wf.nodes.filter((b) => b !== n)) assert.ok(Math.abs(m.position[0] - x) >= L.NODE_W + 20 || Math.abs(m.position[1] - y) >= 90, `ne recouvre pas ${m.name}`);
});

test('insérer : un bloc à deux sorties posé au milieu continue par sa première sortie', () => {
  const L = logique(), wf = fourche();
  const r = L.inserer(wf, L.blocOutil(CATALOG[1]), { de: 'Lancer', out: 0, vers: 'Si' });
  assert.equal(r.ok, true);
  assert.deepEqual(ici(wf.connections.Lancer), [[{ node: r.name }]]);
  assert.deepEqual(ici(wf.connections[r.name!]), [[{ node: 'Si' }]]);
});

test('insérer : refusé (rien ne change) pour un déclencheur, une fonction grave, un fil qui n\'existe plus', () => {
  const L = logique(), wf = fourche(), avant = JSON.stringify(wf);
  const d = L.inserer(wf, L.blocOutil(CATALOG[0]), { de: 'Si', out: 0, vers: 'Attendre' });
  assert.equal(d.ok, false); assert.match(d.error ?? '', /déclencheur/i);
  assert.equal(L.inserer(wf, L.blocFonction(HYDRE, HYDRE.actions[1]), { de: 'Si', out: 0, vers: 'Attendre' }).ok, false, 'grave');
  assert.equal(L.inserer(wf, L.blocOutil(CATALOG[2]), { de: 'Si', out: 1, vers: 'Attendre' }).ok, false, 'pas ce fil');
  assert.equal(L.inserer(wf, L.blocOutil(CATALOG[2]), { de: 'Disparu', out: 0, vers: 'Si' }).ok, false);
  assert.equal(JSON.stringify(wf), avant);
});

test('retirer un fil : seulement celui-là', () => {
  const L = logique(), wf = fourche();
  assert.equal(L.retirerLien(wf, 'Si', 1, 'Fin'), true);
  assert.deepEqual(ici(wf.connections.Si), [[{ node: 'Attendre' }], []]);
  assert.equal(L.retirerLien(wf, 'Si', 1, 'Fin'), false, 'déjà retiré');
});

test('les refus d\'un lien : vers un déclencheur, deux fois le même, un bloc vers lui-même', () => {
  const L = logique(), wf = fourche();
  assert.match(L.refusLien(wf, 'Si', 0, 'Lancer', true), /déclencheur/i);
  assert.match(L.refusLien(wf, 'Si', 0, 'Si', false), /lui-même/i);
  assert.match(L.refusLien(wf, 'Si', 0, 'Attendre', false), /déjà/i);
  assert.equal(L.refusLien(wf, 'Si', 1, 'Attendre', false), '', 'une autre sortie : permis');
  assert.equal(L.refusLien(wf, 'Attendre', 0, 'Fin', false), '');
});

test('le bloc sous le pointeur : celui du dessus, rien hors des blocs', () => {
  const L = logique();
  const b = [{ name: 'A', left: 0, top: 0, width: 190, height: 70 }, { name: 'B', left: 100, top: 20, width: 190, height: 70 }];
  assert.equal(L.blocSous(b, 10, 10), 'A');
  assert.equal(L.blocSous(b, 150, 40), 'B', 'le dernier dessiné est au-dessus');
  assert.equal(L.blocSous(b, 500, 500), null);
  assert.equal(L.blocSous([], 0, 0), null);
});

// ------------------------------------------------------------------ un document minimal
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud; let actif: Noeud | null = null;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Array<Noeud | null> = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; value = ''; hidden = false; checked = false; texte = ''; html = '';
  boite = { left: 0, top: 0, width: 0, height: 0 };
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
  remove() { this.parent?.retirer(this); }
  // (un élément SVG reçoit sa classe par setAttribute : comme le navigateur, elle compte pour les sélecteurs)
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  removeEventListener(t: string, f: Ecoute) { this.ecoutes[t] = (this.ecoutes[t] ?? []).filter((x) => x !== f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) {
    const e = { type: t, target: this, preventDefault() {}, stopPropagation() {}, timeStamp: Date.now(), ...plus };
    // Le document entend d'abord (comme une écoute « capture »), puis l'élément et ses parents.
    for (const f of [...(docEcoutes[t] ?? [])]) await f(e);
    for (let n: Noeud | null = this; n; n = n.parent) for (const f of [...(n.ecoutes[t] ?? [])]) await f({ ...e, currentTarget: n });
  }
  focus() { actif = this; } setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { ...this.boite, right: this.boite.left + this.boite.width, bottom: this.boite.top + this.boite.height, x: this.boite.left, y: this.boite.top }; }
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
let docEcoutes: Record<string, Ecoute[]> = {};
racine = new Noeud('html');

const FLOW = { id: 'f1', name: 'Fils', active: false, nodes: [
  { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
  { name: 'Si', type: 'logique.si', params: { condition: '' }, position: [340, 160] },
  { name: 'Attendre', type: 'temps.attendre', params: { secondes: 5 }, position: [900, 60] },
  { name: 'Fin', type: 'temps.attendre', params: { secondes: 1 }, position: [900, 300] },
], connections: { Lancer: [[{ node: 'Si' }]], Si: [[{ node: 'Attendre' }], [{ node: 'Fin' }]] } };

async function page(flow: unknown = FLOW, confirme = true) {
  racine = new Noeud('html'); actif = null; docEcoutes = {};
  const vue = new Noeud('section'); vue.setAttribute('id', 'v-flows');
  const head = new Noeud('div'); head.className = 'head'; const h1 = new Noeud('h1'); const sub = new Noeud('p'); sub.className = 'sub'; head.append(h1, sub);
  const body = new Noeud('div'); body.className = 'body'; vue.append(head, body); racine.append(vue);
  const tete = new Noeud('head');
  const document = {
    readyState: 'complete', head: tete, body: racine, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), querySelectorAll: (s: string) => racine.querySelectorAll(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
    addEventListener: (t: string, f: Ecoute) => { (docEcoutes[t] ??= []).push(f); },
    removeEventListener: (t: string, f: Ecoute) => { docEcoutes[t] = (docEcoutes[t] ?? []).filter((x) => x !== f); },
  };
  const appels: Array<{ chemin: string; corps?: Record<string, unknown> }> = [];
  const reponses: Record<string, (c?: Record<string, unknown>) => unknown> = {
    '/api/draupnir/state': () => ({ ok: true, flows: [], templates: [], catalog: CATALOG, dossiers: [] }),
    '/api/draupnir/flow': () => ({ ok: true, flow: JSON.parse(JSON.stringify(flow)), outputs: {}, runs: [], versions: [] }),
    '/api/draupnir/applis': () => ({ ok: true, applis: [HYDRE] }),
    '/api/draupnir/save': (c) => ({ ok: true, flow: c?.flow }),
  };
  const fetch = async (chemin: string, o?: { body?: string }) => {
    const corps = o?.body ? JSON.parse(o.body) as Record<string, unknown> : undefined;
    appels.push({ chemin, corps });
    const f = reponses[chemin.split('?')[0]];
    return { status: 200, ok: true, json: async () => (f ? f(corps) : { ok: false, error: 'inconnu' }) };
  };
  const questions: string[] = [];
  const window: Record<string, unknown> = { OdinAppIcons: { tile: (id: string) => `<svg data-appli="${id}"></svg>` }, OdinDialog: { confirm: async (t: string) => { questions.push(t); return confirme; }, alert: async () => {}, prompt: async () => null } };
  const ctx = { window, document, fetch, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, console };
  vm.runInNewContext(FLOWS, ctx); vm.runInNewContext(LIEN, ctx);
  await (window.OdinFlows as { edit: (id: string) => Promise<void> }).edit((flow as { id: string }).id); await attendre();
  const bouton = (texte: string | RegExp, dans: Noeud = racine) => dans.querySelectorAll('button').find((b) => (typeof texte === 'string' ? b.textContent.trim() === texte : texte.test(b.textContent)));
  const bloc = (nom: string) => body.querySelectorAll('.dr-node').find((x) => (x.getAttribute('aria-label') ?? '').startsWith(`${nom} (`))!;
  /** La zone de toucher d'un fil (de → vers). */
  const fil = (de: string, vers: string) => body.querySelectorAll('.dr-fil').find((x) => x.getAttribute('data-de') === de && x.getAttribute('data-vers') === vers);
  const enregistre = async () => { await bouton('Enregistrer')!.emettre('click'); await attendre(); return [...appels].reverse().find((a) => a.chemin === '/api/draupnir/save')!.corps!.flow as typeof FLOW; };
  const css = tete.querySelectorAll('style').map((s) => s.textContent).join('\n');
  return { body, appels, questions, bouton, bloc, fil, enregistre, css };
}
const attendre = () => new Promise((ok) => setTimeout(ok, 20));
const menu = () => racine.querySelector('.dr-fil-menu');

test('page : toucher un fil ouvre un petit menu (Retirer ce lien, Ajouter un bloc ici) et ne retire rien ; Échap le referme', async () => {
  const p = await page();
  const f = p.fil('Si', 'Fin');
  assert.ok(f, 'chaque fil a sa zone de toucher');
  await f!.emettre('click', { clientX: 600, clientY: 250 }); await attendre();
  const m = menu();
  assert.ok(m, 'un menu s\'ouvre');
  assert.equal(m!.getAttribute('role'), 'menu');
  assert.deepEqual(m!.querySelectorAll('button').map((b) => b.textContent), ['Retirer ce lien', 'Ajouter un bloc ici']);
  assert.ok(m!.querySelectorAll('button').every((b) => b.getAttribute('role') === 'menuitem'));
  assert.equal(p.questions.length, 0, 'aucune question : le fil n\'est pas retiré d\'emblée');
  assert.ok(p.fil('Si', 'Fin'), 'le fil est toujours là');
  assert.equal(actif, m!.querySelector('button'), 'le focus va au menu');
  await m!.emettre('keydown', { key: 'Escape' });
  assert.equal(menu(), null, 'Échap referme');
  assert.deepEqual(ici((await p.enregistre()).connections), ici(FLOW.connections), 'rien n\'a changé');
});

test('page : un toucher ailleurs referme le menu, sans rien changer', async () => {
  const p = await page();
  await p.fil('Lancer', 'Si')!.emettre('click', { clientX: 200, clientY: 200 });
  assert.ok(menu());
  await p.body.querySelector('#drCanvas')!.emettre('pointerdown', { clientX: 5, clientY: 5 });
  assert.equal(menu(), null);
  // Un toucher DANS le menu ne le referme pas.
  await p.fil('Lancer', 'Si')!.emettre('click', { clientX: 200, clientY: 200 });
  await menu()!.querySelector('button')!.emettre('pointerdown');
  assert.ok(menu(), 'toucher un choix du menu ne le referme pas avant le choix');
});

test('page : « Retirer ce lien » retire ce fil (après la question d\'avant) et seulement lui', async () => {
  const p = await page();
  await p.fil('Si', 'Fin')!.emettre('click', { clientX: 600, clientY: 250 });
  await p.bouton('Retirer ce lien', menu()!)!.emettre('click'); await attendre();
  assert.equal(menu(), null);
  assert.match(p.questions[0] ?? '', /Si → Fin/, 'la confirmation d\'avant est gardée');
  assert.equal(p.fil('Si', 'Fin'), undefined);
  const f = await p.enregistre();
  assert.deepEqual(ici(f.connections), { Lancer: [[{ node: 'Si' }]], Si: [[{ node: 'Attendre' }], []] });
  // Réponse « non » à la question : le fil reste.
  const q = await page(FLOW, false);
  await q.fil('Si', 'Fin')!.emettre('click', { clientX: 600, clientY: 250 });
  await q.bouton('Retirer ce lien', menu()!)!.emettre('click'); await attendre();
  assert.ok(q.fil('Si', 'Fin'));
});

test('page : « Ajouter un bloc ici » ouvre le choix de l\'étape 1 et pose le bloc ENTRE les deux, sur la même sortie', async () => {
  const p = await page();
  await p.fil('Si', 'Fin')!.emettre('click', { clientX: 600, clientY: 250 });
  await p.bouton('Ajouter un bloc ici', menu()!)!.emettre('click'); await attendre();
  assert.equal(menu(), null, 'le petit menu se ferme');
  const fen = racine.querySelector('.dr-choix')!;
  assert.ok(fen, 'la fenêtre de choix des blocs');
  assert.ok(fen.querySelector('.li-g'), 'la grille des applis');
  assert.doesNotMatch(fen.querySelector('.dr-ch-o')!.textContent, /Lancer à la main/, 'pas de déclencheur au milieu d\'un fil');
  await p.bouton('Hydre', fen)!.emettre('click');
  await p.bouton(/Vérifier toutes les ISO/, fen)!.emettre('click'); await attendre();
  assert.equal(racine.querySelector('.dr-choix'), null);
  assert.match(p.body.querySelector('#drSt')!.textContent, /entre « Si » et « Fin »/);
  const f = await p.enregistre();
  const nom = 'Hydre · Vérifier toutes les ISO';
  assert.deepEqual(ici(f.connections), { Lancer: [[{ node: 'Si' }]], Si: [[{ node: 'Attendre' }], [{ node: nom }]], [nom]: [[{ node: 'Fin' }]] }, 'le « non » du Si → le nouveau bloc → Fin');
  assert.equal(f.nodes.length, 5);
});

test('page : au clavier, un fil se choisit (Tab) et son menu s\'ouvre (Entrée), puis les flèches et Échap', async () => {
  const p = await page();
  const f = p.fil('Lancer', 'Si')!;
  assert.equal(f.getAttribute('tabindex'), '0', 'atteignable par Tab');
  assert.equal(f.getAttribute('role'), 'button');
  assert.match(f.getAttribute('aria-label') ?? '', /Lancer → Si/);
  assert.match(p.fil('Si', 'Fin')!.getAttribute('aria-label') ?? '', /non/, 'la sortie est dite quand le bloc en a plusieurs');
  f.focus(); await f.emettre('keydown', { key: 'Enter' });
  const m = menu()!;
  assert.ok(m, 'Entrée ouvre le menu');
  const [b1, b2] = m.querySelectorAll('button');
  assert.equal(actif, b1);
  await m.emettre('keydown', { key: 'ArrowDown', target: b1 });
  assert.equal(actif, b2, 'flèche bas : le choix suivant');
  await m.emettre('keydown', { key: 'Escape' });
  assert.equal(menu(), null);
  assert.equal(actif?.getAttribute('data-de'), 'Lancer', 'Échap rend le focus au fil');
});

test('la zone de toucher garde 44 px à l\'écran quel que soit le zoom ; deux sorties voisines se partagent l\'écart', () => {
  const L = logique() as Logique & { zoneToucher: (k: number, px?: number) => number; styleSortie: (i: number, m: number) => string };
  assert.equal(L.zoneToucher(1), 44); assert.equal(L.zoneToucher(0.5), 88, 'dézoomé de moitié : 88 px du schéma = 44 px à l\'écran');
  assert.equal(L.zoneToucher(1.6), 44, 'zoomé : jamais moins de 44 px'); assert.equal(L.zoneToucher(0.5, 22), 44);
  assert.equal(L.styleSortie(0, 1), 'top:calc(27px - var(--dh))', 'une seule sortie : la zone entière');
  assert.equal(L.styleSortie(0, 2), 'top:calc(27px - var(--dh));--db:11px', '« oui » s\'arrête à mi-chemin vers « non »');
  assert.equal(L.styleSortie(1, 2), 'top:calc(49px - var(--dh));--dh:11px');
  assert.equal(L.styleSortie(1, 3), 'top:calc(49px - var(--dh));--dh:11px;--db:11px');
});

test('page : les ronds à relier ont une zone de toucher de 44 px ; leur dessin reste un rond de 18 px, à la même place', async () => {
  const p = await page();
  const regle = (sel: string) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(p.css)?.[1] ?? '';
  assert.match(regle('.dr-port'), /--z:var\(--dr-z,44px\)/); assert.match(regle('.dr-port'), /width:var\(--z\)/);
  assert.match(regle('.dr-port::before'), /width:18px;height:18px/);
  assert.match(regle('.dr-port::before'), /border-radius:50%/);
  // Le centre du rond reste où il était (entrée : 1 px avant le bord gauche, à 33 px du haut ; sortie : 1 px après le bord droit).
  assert.match(regle('.dr-port.in'), /left:calc\(-1px - var\(--z\) \/ 2\);top:calc\(33px - var\(--z\) \/ 2\)/);
  assert.match(regle('.dr-port.out'), /right:calc\(-1px - var\(--z\) \/ 2\)/);
  const out = p.bloc('Si').querySelectorAll('.dr-port').filter((x) => x.classList.contains('out'));
  assert.deepEqual(out.map((x) => x.getAttribute('style')), ['top:calc(27px - var(--dh));--db:11px', 'top:calc(49px - var(--dh));--dh:11px'], '« oui » et « non » aux mêmes hauteurs qu\'avant');
  assert.equal(p.bloc('Si').style.minHeight, '80px', 'le « non » ne passe plus sous le « + »');
  assert.equal(p.bloc('Fin').style.minHeight, undefined, 'un bloc à une sortie garde sa hauteur');
});

test('page : toucher l\'entrée d\'un bloc sans sortie armée le choisit, comme toucher le bloc', async () => {
  const p = await page();
  await p.bloc('Fin').querySelector('.dr-port')!.emettre('click');
  assert.equal(p.body.querySelector('#drNn')?.getAttribute('value'), 'Fin', 'le panneau du bloc Fin s\'ouvre');
  assert.deepEqual(ici((await p.enregistre()).connections), ici(FLOW.connections), 'aucun lien');
});

test('page : relier en deux touchers marche comme avant', async () => {
  const p = await page({ ...FLOW, connections: { Lancer: [[{ node: 'Si' }]] } });
  const sortie = p.bloc('Si').querySelectorAll('.dr-port').filter((x) => x.classList.contains('out'))[1];
  await sortie.emettre('click');
  await p.bloc('Fin').querySelector('.dr-port')!.emettre('click');
  const f = await p.enregistre();
  assert.deepEqual(ici(f.connections.Si), [[], [{ node: 'Fin' }]]);
});

/** Tirer un fil depuis la sortie `out` de `de` jusqu'au point (x, y) de l'écran. */
async function tirer(p: Awaited<ReturnType<typeof page>>, de: string, out: number, x: number, y: number) {
  const port = p.bloc(de).querySelectorAll('.dr-port').filter((b) => b.classList.contains('out'))[out];
  await port.emettre('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 });
  await port.emettre('pointermove', { clientX: (10 + x) / 2, clientY: (10 + y) / 2, pointerId: 1 });
  await port.emettre('pointermove', { clientX: x, clientY: y, pointerId: 1 });
  const pendant = Boolean(p.body.querySelector('.dr-tire'));
  await port.emettre('pointerup', { clientX: x, clientY: y, pointerId: 1 });
  await port.emettre('click', { clientX: x, clientY: y }); // le navigateur envoie un clic après le geste
  return { pendant, port };
}
/** Les blocs ont une place à l'écran (le document simulé ne calcule rien). */
function placer(p: Awaited<ReturnType<typeof page>>) {
  const pl: Record<string, [number, number]> = { Lancer: [0, 100], Si: [300, 100], Attendre: [700, 0], Fin: [700, 300] };
  for (const [n, [l, t]] of Object.entries(pl)) p.bloc(n).boite = { left: l, top: t, width: 190, height: 70 };
}

test('page : relier en TIRANT un fil d\'une sortie jusqu\'à un bloc ; le fil suit le pointeur', async () => {
  const p = await page({ ...FLOW, connections: { Lancer: [[{ node: 'Si' }]] } });
  placer(p);
  const r = await tirer(p, 'Si', 1, 750, 330);
  assert.ok(r.pendant, 'un fil suit le pointeur pendant le geste');
  assert.equal(p.body.querySelector('.dr-tire'), null, 'il s\'efface au lâcher');
  assert.ok(!r.port.classList.contains('armed') && !p.body.querySelector('.dr-port.armed'), 'le clic qui suit le geste n\'arme pas le rond');
  const f = await p.enregistre();
  assert.deepEqual(ici(f.connections.Si), [[], [{ node: 'Fin' }]], 'lâché sur Fin : relié depuis le « non »');
});

test('page : fil tiré lâché ailleurs, sur un déclencheur, sur le même bloc ou en double : rien ne change', async () => {
  const p = await page();
  placer(p);
  await tirer(p, 'Si', 0, 600, 600); // dans le vide
  await tirer(p, 'Si', 0, 50, 120); // sur le déclencheur
  await tirer(p, 'Si', 0, 320, 120); // sur lui-même
  await tirer(p, 'Si', 0, 750, 30); // Attendre : déjà relié par cette sortie
  assert.match(p.body.querySelector('#drSt')!.textContent, /déjà/, 'le refus est dit');
  const f = await p.enregistre();
  assert.deepEqual(ici(f.connections), ici(FLOW.connections));
  assert.equal(p.body.querySelector('.dr-tire'), null);
});

test('page : au doigt, un geste parti d\'un fil fait glisser le schéma (sans ouvrir le menu) ; un toucher sans bouger ouvre toujours le menu', async () => {
  const p = await page();
  const canvas = p.body.querySelector('#drCanvas')!, monde = p.body.querySelector('.dr-world')!;
  const avant = monde.style.transform;
  const f = p.fil('Lancer', 'Si')!;
  await f.emettre('pointerdown', { clientX: 100, clientY: 100, pointerId: 3, pointerType: 'touch' });
  await canvas.emettre('pointermove', { clientX: 102, clientY: 101, pointerId: 3 });
  assert.equal(monde.style.transform, avant, 'un tremblement de moins de 6 px ne bouge rien');
  await canvas.emettre('pointermove', { clientX: 180, clientY: 140, pointerId: 3 });
  await canvas.emettre('pointerup', { clientX: 180, clientY: 140, pointerId: 3 });
  await f.emettre('click', { clientX: 180, clientY: 140 });
  assert.notEqual(monde.style.transform, avant, 'le schéma a glissé');
  assert.equal(menu(), null, 'pas de menu après un glissement');
  // Un toucher sans bouger, sur un fil : le menu s'ouvre, comme avant.
  const g = p.fil('Lancer', 'Si')!;
  await g.emettre('pointerdown', { clientX: 200, clientY: 200, pointerId: 4, pointerType: 'touch' });
  await canvas.emettre('pointerup', { clientX: 200, clientY: 200, pointerId: 4 });
  await g.emettre('click', { clientX: 200, clientY: 200 });
  assert.ok(menu(), 'le menu du fil s\'ouvre');
  assert.deepEqual(ici((await p.enregistre()).connections), ici(FLOW.connections), 'rien n\'a changé');
});

test('page : un fil tiré lâché sur le rond d\'entrée d\'un bloc (la moitié qui dépasse) relie ce bloc', async () => {
  const p = await page({ ...FLOW, connections: { Lancer: [[{ node: 'Si' }]] } });
  placer(p);
  p.bloc('Fin').querySelector('.dr-port')!.boite = { left: 677, top: 311, width: 44, height: 44 };
  await tirer(p, 'Si', 1, 685, 333);
  assert.deepEqual(ici((await p.enregistre()).connections.Si ?? null), [[], [{ node: 'Fin' }]], 'lâché sur le rond d\'entrée de Fin : relié');
});

test('page : quitter le menu d\'un fil par Tab le referme', async () => {
  const p = await page();
  const f = p.fil('Lancer', 'Si')!;
  f.focus(); await f.emettre('keydown', { key: 'Enter' });
  const m = menu()!;
  const [b1, b2] = m.querySelectorAll('button');
  await b1.emettre('focusout', { relatedTarget: b2 });
  assert.ok(menu(), 'passer d\'un choix à l\'autre garde le menu');
  await b2.emettre('focusout', { relatedTarget: null });
  assert.ok(menu(), 'un focus perdu sans destination (clic sur un choix, selon le navigateur) garde le menu');
  await b2.emettre('focusout', { relatedTarget: p.bouton('Enregistrer') });
  assert.equal(menu(), null, 'Tab vers un autre élément referme le menu');
});

test('page : une automatisation existante s\'ouvre et s\'enregistre à l\'identique (avec une entrée numérotée)', async () => {
  const flow = { ...FLOW, connections: { ...FLOW.connections, Lancer: [[{ node: 'Si', input: 0 }]] } };
  const p = await page(flow);
  assert.equal(p.body.querySelectorAll('.dr-fil').length, 3, 'un fil touchable par lien');
  assert.deepEqual(ici(await p.enregistre()), ici(flow));
});
