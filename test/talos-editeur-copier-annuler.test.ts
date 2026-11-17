// Talos, l'éditeur à nœuds (src/web/flows.js) : copier / coller un bloc, annuler / refaire, le zoom au clavier (étape 5c).
// - Logique (sans document) : la copie d'un bloc (réglages, note, état désactivé ; ni ses fils ni son identifiant) ; le
//   collage sous un nom libre (« Nom 2 »), un peu décalé, sans fil ; le zoom borné, le même que la molette.
// - Page (petit document simulé, aucun navigateur) : « Copier » dans le menu d'un bloc, Ctrl+C / Ctrl+V ; la copie reste
//   dans la page (rien dans le presse-papiers du système) ; Ctrl+Z / Ctrl+Y (et Ctrl+Maj+Z) pour chaque sorte de geste,
//   l'état exact d'avant puis d'après ; la borne ; rien n'est envoyé au serveur ; ni « Tester » ni « Enregistrer » ne
//   s'annulent ; l'historique vidé à l'ouverture d'une autre automatisation ; les boutons « Annuler » et « Refaire » ;
//   + et − ; aucun raccourci dans un champ de saisie ; rouvrir puis enregistrer sans geste rend la même chose.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const LIEN = readFileSync(new URL('../src/web/pages/talos-lien.js', import.meta.url), 'utf8');

type Noeud0 = { id?: string; name: string; type: string; params: Record<string, unknown>; position: [number, number]; note?: string; disabled?: boolean };
type Wf = { nodes: Noeud0[]; connections: Record<string, Array<Array<{ node: string }>>> };
type Vue = { x: number; y: number; k: number };
interface Logique {
  copieDe: (n: Noeud0) => Noeud0;
  collerBloc: (wf: Wf, c: Noeud0) => { ok: boolean; name?: string; error?: string };
  zoomer: (v: Vue, facteur: number, mx: number, my: number) => Vue;
  MAX_HISTOIRE: number;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

const CATALOG = [
  { type: 'déclencheur.manuel', label: 'Lancer à la main', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'logique.si', label: 'Si', group: 'Logique', outputs: ['oui', 'non'], params: [{ key: 'condition', default: '' }] },
  { type: 'temps.attendre', label: 'Attendre', group: 'Logique', params: [{ key: 'secondes', default: 5 }] },
];

// ------------------------------------------------------------------ logique
function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document });
  return win.OdinFlows!.logique;
}

test('copier : la copie garde le type, les réglages (à part), la note et l\'état désactivé ; ni l\'identifiant, ni les fils', () => {
  const L = logique();
  const n: Noeud0 = { id: 'n-7', name: 'Si', type: 'logique.si', params: { condition: '{{ $node["Lancer"].json.n }} > 3', liste: [1, { a: 2 }] }, position: [340, 160], note: 'Seuil choisi avec Maëlle', disabled: true };
  const avant = JSON.stringify(n), c = L.copieDe(n);
  assert.equal(JSON.stringify(n), avant, 'le bloc copié ne change pas');
  assert.equal(c.type, 'logique.si'); assert.equal(c.name, 'Si'); assert.deepEqual(ici(c.params), ici(n.params));
  assert.equal(c.note, 'Seuil choisi avec Maëlle'); assert.equal(c.disabled, true);
  assert.equal('id' in c, false, 'pas d\'identifiant recopié');
  (c.params.liste as Array<{ a?: number }>)[1].a = 99;
  assert.equal(JSON.stringify(n), avant, 'les réglages sont copiés à part (changer la copie ne touche pas le bloc)');
  const sans = L.copieDe({ name: 'Attendre', type: 'temps.attendre', params: { secondes: 5 }, position: [0, 0] });
  assert.equal('note' in sans, false); assert.equal('disabled' in sans, false, 'un bloc sans note ni désactivation n\'a rien de plus');
});

test('coller : un nom libre (« Si 2 », puis « Si 3 »), un peu décalé, sans fil ; les données prises chez d\'autres blocs restent telles quelles', () => {
  const L = logique();
  const wf: Wf = { nodes: [
    { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
    { name: 'Si', type: 'logique.si', params: { condition: '{{ $node["Lancer"].json.n }} > 3' }, position: [340, 160], note: 'à revoir' },
    { name: 'Si 2', type: 'logique.si', params: {}, position: [900, 600] },
  ], connections: { Lancer: [[{ node: 'Si' }]], Si: [[{ node: 'Si 2' }]] } };
  const liens = JSON.stringify(wf.connections), c = L.copieDe(wf.nodes[1]);
  const r1 = L.collerBloc(wf, c);
  assert.deepEqual(ici(r1), { ok: true, name: 'Si 3' }, '« Si 2 » est pris : « Si 3 »');
  const n1 = wf.nodes[3];
  assert.deepEqual(ici(n1), { name: 'Si 3', type: 'logique.si', params: { condition: '{{ $node["Lancer"].json.n }} > 3' }, position: [380, 200], note: 'à revoir' });
  assert.equal(JSON.stringify(wf.connections), liens, 'aucun fil ajouté');
  const r2 = L.collerBloc(wf, c);
  assert.equal(r2.name, 'Si 4');
  assert.deepEqual(ici(wf.nodes[4].position), [420, 240], 'une deuxième copie ne tombe pas pile sur la première');
  assert.notEqual(wf.nodes[3].params, wf.nodes[4].params, 'chaque copie a ses propres réglages');
  assert.notEqual(wf.nodes[3].params, c.params);
});

test('coller un déclencheur Webhook ou Formulaire : la copie n\'emporte pas le chemin secret (le serveur en tire un neuf), le reste est gardé', () => {
  const L = logique();
  for (const type of ['déclencheur.webhook', 'déclencheur.formulaire']) {
    const wf: Wf = { nodes: [{ name: 'Appel', type, params: { chemin: 'AbCdEfGhIjKlMnOp', titre: 'Inscription' }, position: [60, 160] }], connections: {} };
    const c = L.copieDe(wf.nodes[0]);
    L.collerBloc(wf, c);
    assert.equal(wf.nodes[0].params.chemin, 'AbCdEfGhIjKlMnOp', `${type} : le bloc d'origine garde son chemin`);
    assert.equal(wf.nodes[1].params.chemin, '', `${type} : la copie n'a pas le même chemin secret`);
    assert.equal(wf.nodes[1].params.titre, 'Inscription', `${type} : les autres réglages sont gardés`);
    // Collée dans une autre automatisation : pas de chemin non plus.
    const autre: Wf = { nodes: [], connections: {} };
    L.collerBloc(autre, c);
    assert.equal(autre.nodes[0].params.chemin, '', `${type} : ni dans une autre automatisation`);
  }
  // Un autre bloc qui aurait un réglage « chemin » le garde (seuls ces deux déclencheurs ont un chemin secret).
  const wf: Wf = { nodes: [{ name: 'Lire', type: 'fichier.lire', params: { chemin: 'notes.txt' }, position: [0, 0] }], connections: {} };
  L.collerBloc(wf, L.copieDe(wf.nodes[0]));
  assert.equal(wf.nodes[1].params.chemin, 'notes.txt');
});

test('zoom : borné entre 0,4 et 1,6 ; le point visé reste sous le pointeur', () => {
  const L = logique();
  const v = L.zoomer({ x: 40, y: 40, k: 1 }, 1.1, 100, 50);
  assert.ok(Math.abs(v.k - 1.1) < 1e-9);
  assert.ok(Math.abs((100 - v.x) / v.k - (100 - 40) / 1) < 1e-9, 'le point sous le pointeur ne bouge pas');
  let w = { x: 0, y: 0, k: 1 }; for (let i = 0; i < 30; i++) w = L.zoomer(w, 1.1, 0, 0);
  assert.equal(w.k, 1.6);
  for (let i = 0; i < 40; i++) w = L.zoomer(w, 0.9, 0, 0);
  assert.equal(w.k, 0.4);
  assert.equal(L.MAX_HISTOIRE, 100, 'la borne de l\'historique');
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
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }
  removeAttribute(k: string) { delete this.attrs[k]; }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  removeEventListener(t: string, f: Ecoute) { this.ecoutes[t] = (this.ecoutes[t] ?? []).filter((x) => x !== f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) {
    let empeche = false;
    const e = { type: t, target: this, preventDefault() { empeche = true; }, stopPropagation() {}, timeStamp: Date.now(), ...plus };
    for (const f of [...(docEcoutes[t] ?? [])]) await f(e);
    for (let n: Noeud | null = this; n; n = n.parent) for (const f of [...(n.ecoutes[t] ?? [])]) await f({ ...e, currentTarget: n });
    return empeche;
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
  { name: 'Si', type: 'logique.si', params: { condition: '' }, position: [340, 160], note: 'Seuil choisi avec Maëlle' },
  { name: 'Attendre', type: 'temps.attendre', params: { secondes: '{{ $node["Si"].json.n }}' }, position: [900, 60] },
  { name: 'Fin', type: 'temps.attendre', params: { secondes: 1 }, position: [900, 300] },
], connections: { Lancer: [[{ node: 'Si' }]], Si: [[{ node: 'Attendre' }], [{ node: 'Fin' }]] } };
const AUTRE = { id: 'f2', name: 'Autre', active: false, nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] }], connections: {} };

async function page(flow: unknown = FLOW) {
  racine = new Noeud('html'); actif = null; docEcoutes = {};
  const vue = new Noeud('section'); vue.setAttribute('id', 'v-flows'); vue.className = 'view on';
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
  const flows: Record<string, unknown> = { f1: flow, f2: AUTRE };
  const reponses: Record<string, (c?: Record<string, unknown>, q?: string) => unknown> = {
    '/api/draupnir/state': () => ({ ok: true, flows: [], templates: [], catalog: CATALOG, dossiers: [] }),
    '/api/draupnir/flow': (_c, q) => ({ ok: true, flow: JSON.parse(JSON.stringify(flows[new URLSearchParams(q).get('id') ?? ''])), outputs: {}, runs: [], versions: [] }),
    '/api/draupnir/save': (c) => ({ ok: true, flow: c?.flow }),
    '/api/draupnir/run': () => ({ ok: true, run: { status: 'succès', ms: 3, nodes: { Lancer: { count: 1, items: [{ n: 4 }], ms: 1 } } } }),
  };
  const fetch = async (chemin: string, o?: { body?: string }) => {
    const corps = o?.body ? JSON.parse(o.body) as Record<string, unknown> : undefined;
    appels.push({ chemin, corps });
    const [c, q] = chemin.split('?'); const f = reponses[c];
    return { status: 200, ok: true, json: async () => (f ? f(corps, q) : { ok: false, error: 'inconnu' }) };
  };
  const pressePapiers: string[] = [];
  const navigator = { clipboard: { writeText: async (t: string) => { pressePapiers.push(t); }, write: async () => { pressePapiers.push('?'); } } };
  const window: Record<string, unknown> = { navigator, OdinAppIcons: { tile: (id: string) => `<svg data-appli="${id}"></svg>` }, OdinDialog: { confirm: async () => true, alert: async () => {}, prompt: async () => null } };
  const ctx = { window, document, navigator, fetch, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, clearTimeout, console };
  vm.runInNewContext(FLOWS, ctx); vm.runInNewContext(LIEN, ctx);
  const F = window.OdinFlows as { edit: (id: string) => Promise<void> };
  await F.edit((flow as { id: string }).id); await attendre();
  const bouton = (texte: string | RegExp, dans: Noeud = racine) => dans.querySelectorAll('button').find((b) => (typeof texte === 'string' ? b.textContent.trim() === texte : texte.test(b.textContent)));
  const bloc = (nom: string) => body.querySelectorAll('.dr-node').find((x) => (x.getAttribute('aria-label') ?? '').startsWith(`${nom} (`))!;
  const fil = (de: string, vers: string) => body.querySelectorAll('.dr-fil').find((x) => x.getAttribute('data-de') === de && x.getAttribute('data-vers') === vers);
  const enregistre = async () => { await bouton('Enregistrer')!.emettre('click'); await attendre(); return ici([...appels].reverse().find((a) => a.chemin === '/api/draupnir/save')!.corps!.flow) as typeof FLOW; };
  /** Une touche avec Ctrl (ou seule) envoyée sur `cible` (le fond du schéma par défaut) : → true si la page l'a prise (preventDefault). */
  const touche = async (key: string, o: { ctrl?: boolean; shift?: boolean; cible?: Noeud } = {}) => { const r = await (o.cible ?? body.querySelector('#drCanvas')!).emettre('keydown', { key, ctrlKey: Boolean(o.ctrl), shiftKey: Boolean(o.shift), metaKey: false, altKey: false }); await attendre(); return r; };
  const css = tete.querySelectorAll('style').map((s) => s.textContent).join('\n');
  return { body, appels, bouton, bloc, fil, enregistre, touche, css, pressePapiers, F };
}
const attendre = () => new Promise((ok) => setTimeout(ok, 20));
const menu = () => racine.querySelector('.dr-fil-menu');
const choixDuMenu = () => menu()?.querySelectorAll('button').map((b) => b.textContent) ?? [];
type P = Awaited<ReturnType<typeof page>>;
const canvasDe = (p: P) => p.body.querySelector('#drCanvas')!;
async function clicDroit(n: Noeud) { await n.emettre('contextmenu', { clientX: 300, clientY: 200, button: 2 }); }
const choisir = async (p: P, nom: string) => { const b = p.bloc(nom); b.focus(); await b.emettre('keydown', { key: 'Enter' }); await attendre(); };
const annulerB = (p: P) => p.body.querySelector('#drUndo')!;
const refaireB = (p: P) => p.body.querySelector('#drRedo')!;

test('page : « Copier » est dans le menu d\'un bloc (après « Renommer ») ; Ctrl+V colle « Si 2 » avec ses réglages et sa note, sans fil ; rien dans le presse-papiers du système', async () => {
  const p = await page();
  await clicDroit(p.bloc('Si'));
  assert.deepEqual(choixDuMenu(), ['Exécuter ce bloc seul', 'Renommer', 'Copier', 'Modifier la note', 'Retirer']);
  await p.bouton('Copier', menu()!)!.emettre('click'); await attendre();
  assert.equal(menu(), null, 'le menu se referme');
  assert.match(p.body.querySelector('#drSt')!.textContent, /« Si » copié/);
  assert.equal(await p.touche('v', { ctrl: true }), true, 'Ctrl+V est pris par la page');
  assert.ok(p.bloc('Si 2'), 'la copie est sur le schéma');
  assert.equal(p.fil('Lancer', 'Si 2') ?? p.fil('Si 2', 'Fin') ?? null, null, 'sans fil');
  const f = await p.enregistre();
  assert.deepEqual(f.nodes.map((n) => n.name), ['Lancer', 'Si', 'Attendre', 'Fin', 'Si 2']);
  assert.deepEqual(f.nodes[4], { name: 'Si 2', type: 'logique.si', params: { condition: '' }, position: [380, 200], note: 'Seuil choisi avec Maëlle' });
  assert.deepEqual(f.connections, ici(FLOW.connections), 'aucun fil ajouté ni changé');
  await p.touche('v', { ctrl: true });
  assert.ok(p.bloc('Si 3'), 'une deuxième fois : « Si 3 »');
  assert.deepEqual(p.pressePapiers, [], 'le presse-papiers du système n\'est pas touché');
});

test('page : Ctrl+C sur le bloc choisi, Ctrl+V : la copie garde ses données prises chez « Si » telles quelles ; sans bloc choisi ni copie, Ctrl+C et Ctrl+V restent au navigateur', async () => {
  const p = await page();
  assert.equal(await p.touche('c', { ctrl: true }), false, 'aucun bloc choisi : Ctrl+C reste au navigateur');
  assert.equal(await p.touche('v', { ctrl: true }), false, 'rien de copié : Ctrl+V reste au navigateur');
  await choisir(p, 'Attendre');
  assert.equal(await p.touche('c', { ctrl: true, cible: p.bloc('Attendre') }), true);
  await p.touche('v', { ctrl: true });
  const f = await p.enregistre();
  assert.deepEqual(f.nodes[4], { name: 'Attendre 2', type: 'temps.attendre', params: { secondes: '{{ $node["Si"].json.n }}' }, position: [940, 100] });
  assert.match(p.body.querySelector('#drNn')?.getAttribute('value') ?? '', /^Attendre 2$/, 'la copie est choisie');
  assert.deepEqual(p.pressePapiers, []);
});

test('page : un déclencheur se copie comme un autre bloc (deux déclencheurs sont déjà permis par l\'éditeur et le moteur)', async () => {
  const p = await page();
  await choisir(p, 'Lancer');
  await p.touche('c', { ctrl: true }); await p.touche('v', { ctrl: true });
  const f = await p.enregistre();
  assert.deepEqual(f.nodes[4], { name: 'Lancer 2', type: 'déclencheur.manuel', params: {}, position: [100, 200] });
});

test('page : coller dans une autre automatisation ouverte ensuite dans la même page', async () => {
  const p = await page();
  await clicDroit(p.bloc('Fin')); await p.bouton('Copier', menu()!)!.emettre('click'); await attendre();
  await p.F.edit('f2'); await attendre();
  await p.touche('v', { ctrl: true });
  const f = await p.enregistre();
  assert.equal(f.id, 'f2');
  assert.deepEqual(f.nodes.map((n) => n.name), ['Lancer', 'Fin']);
  assert.deepEqual(f.connections, {});
});

test('page : aucun raccourci dans un champ de saisie (nom de l\'automatisation, réglage, renommage) ; Suppr garde son rôle', async () => {
  const p = await page();
  await choisir(p, 'Fin'); await p.touche('c', { ctrl: true });
  const avant = await p.enregistre();
  const champs = [p.body.querySelector('#drName')!, p.body.querySelector('#drNn')!, p.body.querySelector('#drp-secondes')!];
  await clicDroit(p.bloc('Si')); await p.bouton('Renommer', menu()!)!.emettre('click'); await attendre();
  champs.push(p.body.querySelector('.dr-renom')!);
  for (const c of champs) {
    assert.ok(c, 'le champ existe');
    for (const [k, shift] of [['z', false], ['y', false], ['z', true], ['c', false], ['v', false]] as const) assert.equal(await p.touche(k, { ctrl: true, shift, cible: c }), false, `Ctrl+${k} dans ${c.tagName}#${c.id}`);
    for (const k of ['+', '-']) assert.equal(await p.touche(k, { cible: c }), false, `${k} dans un champ`);
  }
  await p.body.querySelector('.dr-renom')!.emettre('keydown', { key: 'Escape' }); await attendre();
  // Un champ à pastilles (contenteditable) : choisir « Attendre ».
  await choisir(p, 'Attendre');
  const s = p.body.querySelector('#drp-secondes')!;
  assert.equal(s.getAttribute('contenteditable'), 'plaintext-only');
  assert.equal(await p.touche('z', { ctrl: true, cible: s }), false); assert.equal(await p.touche('v', { ctrl: true, cible: s }), false);
  assert.deepEqual(await p.enregistre(), avant, 'rien n\'a changé');
  // Suppr sur un bloc : la même confirmation qu'avant, le bloc part ; Ctrl+Z le remet.
  await p.bloc('Fin').emettre('keydown', { key: 'Delete' }); await attendre();
  assert.equal(p.bloc('Fin'), undefined);
  await p.touche('z', { ctrl: true });
  assert.deepEqual(await p.enregistre(), avant, 'retiré puis annulé : comme avant, fils compris');
});

test('page : annuler puis refaire chaque sorte de geste rend exactement l\'état d\'avant, puis celui d\'après ; rien n\'est envoyé au serveur', async () => {
  const p = await page();
  const gestes: Array<[string, () => Promise<void>]> = [
    ['ajouter', async () => { await canvasDe(p).emettre('pointerdown', { clientX: 1, clientY: 1 }); await p.bouton('+ Étape')!.emettre('click'); await attendre(); await p.bouton('Attendre', p.body.querySelector('.dr-cat')!)!.emettre('click'); await attendre(); }],
    ['retirer', async () => { await clicDroit(p.bloc('Fin')); await p.bouton('Retirer', menu()!)!.emettre('click'); await attendre(); }],
    ['déplacer', async () => { const b = p.bloc('Si'); await b.emettre('pointerdown', { clientX: 400, clientY: 200, pointerId: 3, button: 0, pointerType: 'mouse' }); await b.emettre('pointermove', { clientX: 470, clientY: 260, pointerId: 3 }); await b.emettre('pointerup', { clientX: 470, clientY: 260, pointerId: 3 }); await attendre(); }],
    ['relier', async () => { await p.bloc('Fin').querySelector('.dr-port.out')!.emettre('click', { timeStamp: 1e12 }); await p.bloc('Attendre').querySelector('.dr-port.in')!.emettre('click'); await attendre(); }],
    ['détacher', async () => { await p.fil('Si', 'Fin')!.emettre('click', { clientX: 10, clientY: 10 }); await p.bouton('Retirer ce lien', menu()!)!.emettre('click'); await attendre(); }],
    ['renommer', async () => { await clicDroit(p.bloc('Si')); await p.bouton('Renommer', menu()!)!.emettre('click'); await attendre(); const i = p.body.querySelector('.dr-renom')!; i.value = 'Contrôle'; await i.emettre('keydown', { key: 'Enter' }); await attendre(); }],
    ['régler', async () => { await choisir(p, 'Fin'); const i = p.body.querySelector('#drp-secondes')!; for (const v of ['3', '30', '300']) { i.value = v; await i.emettre('input', { target: i }); } await attendre(); }],
    ['coller', async () => { await clicDroit(p.bloc('Fin')); await p.bouton('Copier', menu()!)!.emettre('click'); await attendre(); await p.touche('v', { ctrl: true }); }],
    ['note', async () => { await clicDroit(p.bloc('Fin')); await p.bouton('Ajouter une note', menu()!)!.emettre('click'); await attendre(); const fen = racine.querySelector('.dr-note-ed')!; fen.querySelector('textarea')!.value = 'Délai à confirmer'; await p.bouton('Enregistrer la note', fen)!.emettre('click'); await attendre(); }],
    ['désactiver', async () => { await choisir(p, 'Fin'); const c = p.body.querySelectorAll('#drSide input').find((x) => x.getAttribute('type') === 'checkbox')!; c.checked = true; await c.emettre('change', { target: c }); await attendre(); }],
  ];
  for (const [quoi, faire] of gestes) {
    const avant = await p.enregistre();
    await faire();
    const apres = await p.enregistre();
    assert.notDeepEqual(apres, avant, `${quoi} : le geste a changé quelque chose`);
    const envois = p.appels.length;
    assert.equal(await p.touche('z', { ctrl: true }), true, `${quoi} : Ctrl+Z est pris`);
    assert.equal(p.appels.length, envois, `${quoi} : annuler n'envoie rien au serveur`);
    assert.deepEqual(await p.enregistre(), avant, `${quoi} : annulé, l'état d'avant`);
    await p.touche('y', { ctrl: true });
    assert.deepEqual(await p.enregistre(), apres, `${quoi} : refait (Ctrl+Y), l'état d'après`);
    await p.touche('z', { ctrl: true }); await p.touche('z', { ctrl: true, shift: true });
    assert.deepEqual(await p.enregistre(), apres, `${quoi} : refait (Ctrl+Maj+Z)`);
    await p.touche('z', { ctrl: true }); // (le geste suivant part de l'automatisation de départ)
  }
});

test('page : un bloc ajouté par le panneau (et relié au dernier) est un seul geste, nommé « ajouter » ; Ctrl+Z retire le bloc et son fil', async () => {
  const p = await page();
  await canvasDe(p).emettre('pointerdown', { clientX: 1, clientY: 1 }); await p.bouton('+ Étape')!.emettre('click'); await attendre();
  await p.bouton('Attendre', p.body.querySelector('.dr-cat')!)!.emettre('click'); await attendre();
  assert.ok(p.fil('Fin', 'Attendre 2'), 'le bloc ajouté est relié au dernier');
  assert.match(annulerB(p).getAttribute('title') ?? '', /ajouter « Attendre 2 »/);
  await p.touche('z', { ctrl: true });
  assert.match(p.body.querySelector('#drSt')!.textContent, /Annulé : ajouter « Attendre 2 »/);
  assert.equal(p.bloc('Attendre 2'), undefined);
  assert.deepEqual(await p.enregistre(), ici(FLOW), 'un seul Ctrl+Z : le bloc et son fil partent');
});

test('page : annuler un renommage défait aussi la réécriture des données qui le citaient', async () => {
  const p = await page();
  await clicDroit(p.bloc('Si')); await p.bouton('Renommer', menu()!)!.emettre('click'); await attendre();
  const i = p.body.querySelector('.dr-renom')!; i.value = 'Contrôle'; await i.emettre('keydown', { key: 'Enter' }); await attendre();
  let f = await p.enregistre();
  assert.equal(f.nodes[2].params.secondes, '{{ $node["Contrôle"].json.n }}', 'la donnée a suivi le nouveau nom');
  await p.bouton('Annuler')!.emettre('click'); await attendre();
  f = await p.enregistre();
  assert.equal(f.nodes[1].name, 'Si'); assert.equal(f.nodes[2].params.secondes, '{{ $node["Si"].json.n }}', 'annulé : la donnée revient aussi');
  assert.deepEqual(f, ici(FLOW));
});

test('page : les boutons « Annuler » et « Refaire » (44 px, grisés quand il n\'y a rien) ; Tester et Enregistrer ne s\'annulent pas ; après Enregistrer, annuler redevient « à enregistrer »', async () => {
  const p = await page();
  const a = annulerB(p), r = refaireB(p);
  assert.equal(a.textContent, 'Annuler'); assert.equal(r.textContent, 'Refaire');
  assert.equal(a.disabled, true, 'rien à annuler : grisé'); assert.equal(r.disabled, true);
  assert.match(p.css, /\.dr-hist\{[^}]*min-height:44px/); assert.match(p.css, /\.dr-hist\{[^}]*min-width:44px/);
  await clicDroit(p.bloc('Fin')); await p.bouton('Copier', menu()!)!.emettre('click'); await attendre(); await p.touche('v', { ctrl: true });
  assert.equal(annulerB(p).disabled, false, 'un geste : « Annuler » actif'); assert.equal(refaireB(p).disabled, true);
  // Tester : il enregistre et lance ; ni l'un ni l'autre ne s'annule.
  await p.bouton('Tester')!.emettre('click'); await attendre();
  const avant = p.appels.length;
  await annulerB(p).emettre('click'); await attendre();
  assert.equal(p.appels.length, avant, 'annuler n\'envoie rien (ni enregistrement, ni exécution)');
  assert.ok(p.bloc('Fin 2') === undefined && p.bloc('Fin'), 'l\'écran revient avant le collage');
  assert.match(p.bloc('Lancer').className, /\bok\b/, 'le résultat du test reste affiché : une exécution ne s\'annule pas');
  assert.match(p.body.querySelector('#drSt')!.textContent, /enregistrer/i, 'l\'écran est à enregistrer de nouveau');
  assert.equal(annulerB(p).disabled, true); assert.equal(refaireB(p).disabled, false, '« Refaire » actif');
  await refaireB(p).emettre('click'); await attendre();
  assert.ok(p.bloc('Fin 2'), 'refait');
  assert.equal(refaireB(p).disabled, true);
});

test('page : l\'historique est borné à 100 gestes et vidé à l\'ouverture d\'une autre automatisation', async () => {
  const p = await page();
  const b0 = ici(FLOW.nodes[3].position);
  for (let i = 1; i <= 105; i++) {
    const b = p.bloc('Fin');
    await b.emettre('pointerdown', { clientX: 0, clientY: 0, pointerId: i, button: 0, pointerType: 'mouse' });
    await b.emettre('pointermove', { clientX: 10, clientY: 0, pointerId: i });
    await b.emettre('pointerup', { clientX: 10, clientY: 0, pointerId: i });
  }
  let n = 0; while (!annulerB(p).disabled && n < 200) { await annulerB(p).emettre('click'); n++; }
  assert.equal(n, 100, 'cent gestes au plus');
  const f = await p.enregistre();
  assert.deepEqual(f.nodes[3].position, [b0[0] + 50, b0[1]], 'les cinq plus anciens ne s\'annulent plus');
  await refaireB(p).emettre('click'); await attendre();
  await p.F.edit('f1'); await attendre();
  assert.equal(annulerB(p).disabled, true, 'rouverte : rien à annuler'); assert.equal(refaireB(p).disabled, true, 'ni à refaire');
  assert.equal(await p.touche('z', { ctrl: true }), false);
});

test('page : + et − zooment comme la molette (au centre du schéma), bornés', async () => {
  const q = await page();
  await canvasDe(q).emettre('wheel', { deltaY: -1, clientX: 0, clientY: 0 });
  const molette = q.body.querySelector('.dr-world')!.style.transform;
  const p = await page();
  const monde = () => p.body.querySelector('.dr-world')!.style.transform;
  const k0 = monde();
  assert.equal(await p.touche('+'), true);
  const k1 = monde(); assert.notEqual(k1, k0); assert.match(k1, /scale\(1\.1\)/);
  assert.equal(k1, molette, 'le même pas que la molette');
  assert.equal(await p.touche('-'), true);
  for (let i = 0; i < 20; i++) await p.touche('+');
  assert.match(monde(), /scale\(1\.6\)/, 'borné');
  assert.deepEqual(await p.enregistre(), ici(FLOW), 'le zoom ne change pas l\'automatisation');
});

test('page : rouverte puis enregistrée sans geste, l\'automatisation reste identique à l\'octet près', async () => {
  const p = await page();
  const corps = () => [...p.appels].reverse().find((a) => a.chemin === '/api/draupnir/save')!.corps!.flow;
  await p.bouton('Enregistrer')!.emettre('click'); await attendre();
  assert.equal(JSON.stringify(corps()), JSON.stringify(FLOW));
  // Un geste puis son annulation : identique aussi.
  await clicDroit(p.bloc('Fin')); await p.bouton('Copier', menu()!)!.emettre('click'); await attendre(); await p.touche('v', { ctrl: true }); await p.touche('z', { ctrl: true });
  await p.bouton('Enregistrer')!.emettre('click'); await attendre();
  assert.equal(JSON.stringify(corps()), JSON.stringify(FLOW));
});

test('page : un geste fait après « Enregistrer » est bien gardé (et s\'annule)', async () => {
  const p = await page();
  await p.enregistre();
  const b = p.bloc('Fin');
  await b.emettre('pointerdown', { clientX: 0, clientY: 0, pointerId: 1, button: 0, pointerType: 'mouse' });
  await b.emettre('pointermove', { clientX: 30, clientY: 20, pointerId: 1 });
  await b.emettre('pointerup', { clientX: 30, clientY: 20, pointerId: 1 });
  assert.deepEqual((await p.enregistre()).nodes[3].position, [930, 320], 'le déplacement est enregistré');
  await p.touche('z', { ctrl: true });
  assert.deepEqual(await p.enregistre(), ici(FLOW), 'et il s\'annule');
});
