// Talos, l'éditeur à nœuds (src/web/flows.js) : prendre une donnée d'un bloc d'avant dans le réglage d'un bloc.
// - Logique (sans document) : l'expression d'aujourd'hui ↔ la pastille, dans les deux sens et à l'identique ; ce que le
//   moteur relit vraiment (src/draupnir/engine.ts, resolve) ; seulement les blocs d'avant ; les données vues au dernier
//   passage ; un bloc renommé, retiré, ou qui n'est pas avant.
// - Page (petit document simulé, aucun navigateur) : la liste des données s'ouvre, la pastille se pose, l'automatisation
//   rouverte garde sa pastille et ne change pas, une valeur piégée reste du texte, le bloc d'origine s'illumine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { resolve } from '../src/draupnir/engine.ts';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const LIEN = readFileSync(new URL('../src/web/pages/talos-lien.js', import.meta.url), 'utf8');

type Lien = { node: string; input?: number };
type Noeud0 = { name: string; type: string; params: Record<string, unknown>; position: [number, number] };
type Wf = { nodes: Noeud0[]; connections: Record<string, Array<Array<Lien>>> };
type Morceau = { texte?: string; src?: string; bloc?: string; chemin?: Array<string | number> };
interface Logique {
  decouper: (t: unknown) => Morceau[];
  assembler: (m: Morceau[]) => string;
  exprDonnee: (bloc: string, chemin: Array<string | number>, dansJson?: boolean) => string | null;
  blocsAvant: (wf: Wf, nom: string) => string[];
  donneesVues: (items: unknown) => Array<{ chemin: Array<string | number>; exemple: unknown }>;
  etatDonnee: (d: Morceau, wf: Wf, nom: string, renommes?: Map<string, string>, retires?: Set<string>) => { ok: boolean; raison?: string };
  libelleChemin: (c: Array<string | number>) => string;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document });
  return win.OdinFlows!.logique;
}
/** Le moteur, tel quel : ce que donne une valeur de réglage quand « Fiche » a rendu `json`. */
const moteur = (v: unknown, json: unknown) => resolve(v, { $json: {}, $node: { [NOM]: { json, items: [json] } }, $now: '', $today: '', $index: 0, $items: [], $workflow: { id: '', name: '' } } as never);
const NOM = 'Lire la fiche';

// ------------------------------------------------------------------ logique
test('expression → pastille → expression : à l\'identique, quelle que soit l\'écriture', () => {
  const L = logique();
  const textes = [
    '', 'Bonjour', 'Bonjour {{ $node["Fiche"].json.nom }} !',
    '{{$node[\'Lire la fiche\'].json.données.ville}}',
    'a {{   $node [ "X" ] . json . a [0] }} b {{ $node["X"].json["clé avec espace"] }}',
    '{{ $json.nom }} et {{ $now }}', // pas d'un bloc d'avant : du texte
    '{{ $node["X"].json }}', // pas de donnée nommée : du texte
    '{{ $node["X"].items[0].a }}', '{{ $node["X"].json.a + 1 }}', '{{ $node["X"]. }}', '{{ }}', '{{ $Node["X"].json.a }}',
    '{{{ $node["X"].json.a }}}', '{{ $node["X"].json.a', '}} {{', '<img src=x onerror="alert(1)">{{ $node["<b>"].json["<i>"] }}',
    'ligne 1\nligne 2 {{ $node["X"].json.a }}\n',
  ];
  for (const t of textes) assert.equal(L.assembler(L.decouper(t)), t, `aller-retour : ${JSON.stringify(t)}`);
  const m = L.decouper('Bonjour {{ $node["Fiche"].json.nom }} !');
  assert.deepEqual(ici(m), [{ texte: 'Bonjour ' }, { src: '{{ $node["Fiche"].json.nom }}', bloc: 'Fiche', chemin: ['nom'] }, { texte: ' !' }]);
  assert.deepEqual(ici(L.decouper('a {{   $node [ "X" ] . json . a [0] }} b')[1]), { src: '{{   $node [ "X" ] . json . a [0] }}', bloc: 'X', chemin: ['a', 0] });
  for (const t of ['{{ $json.nom }}', '{{ $node["X"].json }}', '{{ $node["X"].items[0].a }}', '{{ $node["X"].json.a + 1 }}', '{{ $Node["X"].json.a }}', '{{ $node[0].json.a }}']) {
    assert.ok(L.decouper(t).every((x) => x.src === undefined), `reste du texte : ${t}`);
  }
  // Les accolades en trop : la même découpe que le moteur (la pastille couvre ce qu'il remplace).
  assert.deepEqual(ici(L.decouper('{{{ $node["X"].json.a }}}').map((x) => x.src ?? x.texte)), ['{', '{{ $node["X"].json.a }}', '}']);
  assert.deepEqual(ici(L.decouper('<img src=x onerror="alert(1)">{{ $node["<b>"].json["<i>"] }}')[1]), { src: '{{ $node["<b>"].json["<i>"] }}', bloc: '<b>', chemin: ['<i>'] });
});

test('une donnée choisie s\'écrit comme une expression que le moteur relit vraiment (champ simple et réglages en JSON)', () => {
  const L = logique();
  const json = { nom: 'Ana', 'données': { ville: 'Lyon', 'code postal': '69001', liste: ['un', 'deux'] }, 'a-b_c$': 'tiret', 'l\'âge': 'apostrophe', '0': 'zéro' };
  const cas: Array<[Array<string | number>, unknown]> = [[['nom'], 'Ana'], [['données', 'ville'], 'Lyon'], [['données', 'code postal'], '69001'], [['données', 'liste', 1], 'deux'], [['a-b_c$'], 'tiret'], [['l\'âge'], 'apostrophe'], [['0'], 'zéro'], [['données'], json['données']]];
  for (const [chemin, attendu] of cas) {
    const e = L.exprDonnee(NOM, chemin)!;
    assert.match(e, /^\{\{ \$node\["Lire la fiche"\]\.json/, 'la forme de l\'aide : {{ $node["Bloc"].json.… }}');
    assert.deepEqual(moteur(e, json), attendu, `le moteur relit ${e}`);
    assert.deepEqual(ici(L.decouper(e)), [{ src: e, bloc: NOM, chemin }], 'et la page la remontre en pastille');
    assert.equal(moteur(`Ville : ${e}.`, json), `Ville : ${typeof attendu === 'object' ? JSON.stringify(attendu) : attendu}.`, 'au milieu d\'un texte');
    // Dans des réglages rangés en texte JSON : des guillemets simples (les doubles y seraient échappés et le moteur lirait vide).
    if (typeof attendu !== 'string') continue;
    const j = L.exprDonnee(NOM, chemin, true);
    if (chemin[0] === 'l\'âge') { assert.equal(j, null, 'une apostrophe ne s\'écrit pas entre guillemets simples dans du JSON'); continue; }
    assert.ok(j && !j.includes('"'), `sans guillemet double : ${j}`);
    assert.deepEqual(JSON.parse(String(moteur(JSON.stringify({ x: `+${j}+` }), json))), { x: `+${attendu}+` }, `le moteur relit ${j} dans du JSON`);
    assert.deepEqual(ici(L.decouper(j!)), [{ src: j, bloc: NOM, chemin }]);
  }
  // Ce qui ne s'écrit pas : la page ne le propose pas (null), plutôt qu'une expression que le moteur lirait de travers.
  assert.equal(L.exprDonnee('a{b', ['x']), null, 'accolade dans le nom');
  assert.equal(L.exprDonnee('x', ['a}b']), null, 'accolade dans la clé');
  assert.equal(L.exprDonnee('a"b\'c', ['x']), null, 'les deux guillemets');
  assert.equal(L.exprDonnee('x', []), null, 'pas de donnée nommée');
  assert.equal(L.exprDonnee('l\'alarme', ['x'], true), null);
  assert.equal(L.exprDonnee('x', ['a\\b'], true), null, 'une barre oblique inverse serait échappée dans du JSON');
  assert.equal(L.exprDonnee('l\'alarme', ['x']), '{{ $node["l\'alarme"].json.x }}');
  assert.equal(L.exprDonnee('dit "oui"', ['x']), '{{ $node[\'dit "oui"\'].json.x }}');
  assert.equal(L.libelleChemin(['données', 'liste', 1]), 'données › liste › [1]');
});

test('les blocs d\'avant : seulement ceux qui mènent à ce bloc, jamais lui-même ni ceux d\'après, le premier en tête', () => {
  const L = logique();
  const wf: Wf = { nodes: ['Lancer', 'A', 'B', 'C', 'Ici', 'Après', 'Seul', 'Boucle'].map((name, i) => ({ name, type: 't', params: {}, position: [i * 10, 0] })), connections: {
    Lancer: [[{ node: 'A' }, { node: 'B' }]], A: [[{ node: 'C' }]], B: [[], [{ node: 'Ici', input: 1 }]], C: [[{ node: 'Ici' }]], Ici: [[{ node: 'Après' }]], Après: [[{ node: 'Boucle' }]], Boucle: [[{ node: 'Après' }]], Disparu: [[{ node: 'Ici' }]],
  } };
  assert.deepEqual(ici(L.blocsAvant(wf, 'Ici')), ['Lancer', 'A', 'B', 'C']);
  assert.deepEqual(ici(L.blocsAvant(wf, 'Lancer')), [], 'un déclencheur : rien avant');
  assert.deepEqual(ici(L.blocsAvant(wf, 'Seul')), [], 'un bloc sans entrée : rien avant');
  // Une boucle : un bloc qui revient vers lui n'est jamais « lui-même avant lui ».
  assert.ok(!L.blocsAvant(wf, 'Après').includes('Après'));
  assert.deepEqual(ici(L.blocsAvant(wf, 'Après').slice(0, 1)), ['Lancer']);
});

test('les données d\'un bloc : celles vues à son dernier passage, rangées par chemin, avec un exemple', () => {
  const L = logique();
  const vues = L.donneesVues([{ texte: 'ok', 'données': { a: 1, b: { c: [1, 2] } } }, { texte: 'deux', autre: null }, 'pas un objet', null]);
  assert.deepEqual(ici(vues.map((v) => v.chemin)), [['texte'], ['données'], ['données', 'a'], ['données', 'b'], ['données', 'b', 'c']],
    'seulement le premier élément : « autre » n\'est que dans le deuxième');
  assert.equal(vues[0].exemple, 'ok', 'l\'exemple du premier élément (celui que lit le moteur)');
  // Le moteur ne donne à $node["X"].json que le premier élément : une clé du deuxième y serait vide.
  const scope = { $json: {}, $node: { X: { json: { texte: 'ok' }, items: [{ texte: 'ok' }, { texte: 'deux', autre: 'là' }] } }, $now: '', $today: '', $index: 0, $items: [], $workflow: { id: '', name: '' } };
  assert.equal(resolve('[{{ $node["X"].json.autre }}]', scope as never), '[]', 'le vrai moteur la lit vide');
  assert.deepEqual(ici(L.donneesVues(undefined)), []);
  assert.deepEqual(ici(L.donneesVues([{}])), []);
  const piege = L.donneesVues([{ '<img src=x onerror="alert(1)">': '<b>x</b>', __proto__x: 1 }]);
  assert.deepEqual(ici(piege.map((v) => v.chemin)), [['<img src=x onerror="alert(1)">'], ['__proto__x']], 'une clé piégée reste une clé');
  const gros = L.donneesVues([Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]))]);
  assert.ok(gros.length <= 100, `borné (${gros.length})`);
});

test('une pastille dont le bloc d\'origine est renommé, retiré, ou n\'est pas avant : elle le dit', () => {
  const L = logique();
  const wf: Wf = { nodes: [{ name: 'Lancer', type: 't', params: {}, position: [0, 0] }, { name: 'Fiche 2', type: 't', params: {}, position: [0, 0] }, { name: 'Ici', type: 't', params: {}, position: [0, 0] }, { name: 'Après', type: 't', params: {}, position: [0, 0] }],
    connections: { Lancer: [[{ node: 'Fiche 2' }]], 'Fiche 2': [[{ node: 'Ici' }]], Ici: [[{ node: 'Après' }]] } };
  const d = (bloc: string) => L.decouper(`{{ $node["${bloc}"].json.a }}`)[0];
  assert.deepEqual(ici(L.etatDonnee(d('Lancer'), wf, 'Ici')), { ok: true });
  const r = L.etatDonnee(d('Fiche'), wf, 'Ici', new Map([['Fiche', 'Fiche 2']]));
  assert.equal(r.ok, false); assert.match(r.raison!, /« Fiche » a été renommé « Fiche 2 »/);
  assert.match(L.etatDonnee(d('Vieux'), wf, 'Ici', new Map(), new Set(['Vieux'])).raison!, /« Vieux » a été retiré/);
  assert.match(L.etatDonnee(d('Inconnu'), wf, 'Ici').raison!, /« Inconnu » n'existe pas/);
  assert.match(L.etatDonnee(d('Après'), wf, 'Ici').raison!, /n'est pas avant ce bloc/);
  assert.match(L.etatDonnee(d('Ici'), wf, 'Ici').raison!, /ce bloc lui-même/);
});

// ------------------------------------------------------------------ un document minimal
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud; let actif: Noeud | null = null;
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
  get childNodes() { return this.enfants.filter((x): x is Noeud => x !== null); }
  get nodeValue() { return this.nodeType === 3 ? this.texte : null; }
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
  contains(n: Noeud | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  removeEventListener(t: string, f: Ecoute) { this.ecoutes[t] = (this.ecoutes[t] ?? []).filter((x) => x !== f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) {
    let arret = false;
    const e = { type: t, target: this, preventDefault() {}, stopPropagation() { arret = true; }, timeStamp: Date.now(), ...plus };
    for (let n: Noeud | null = this; n && !arret; n = n.parent) for (const f of [...(n.ecoutes[t] ?? [])]) await f({ ...e, currentTarget: n });
  }
  focus() { actif = this; } setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
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

const PIEGE = '<img src=x onerror="alert(1)">';
const HYDRE = { id: 'ymir', nom: 'Hydre', famille: 'Machines', evenements: ['alerte'], actions: [
  { id: 'demarrer', label: 'Démarrer une machine', what: '', params: [{ key: 'nom', label: 'Machine', kind: 'text', required: true }, { key: 'note', label: 'Note', kind: 'textarea', default: 'rien' }, { key: 'attendre', label: 'Attendre', kind: 'boolean' }], read: false, grave: false },
] };
const CATALOG = [
  { type: 'déclencheur.manuel', label: 'Lancer à la main', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'outil.ecrire', label: 'Écrire', group: 'Outils', params: [{ key: 'message', label: 'Message', kind: 'text' }, { key: 'combien', label: 'Combien', kind: 'number' }] },
  { type: 'module.action', label: 'Action d\'une appli', group: 'Applis', params: [{ key: 'module', label: 'Appli', kind: 'text', required: true }, { key: 'action', label: 'Action', kind: 'text', required: true }, { key: 'entrée', label: 'Réglages', kind: 'json', default: '{}' }] },
];
const DEM = 'Hydre · Démarrer une machine';
/** Lancer → Fiche → Démarrer → Après ; « Seul » n'est relié à rien. La machine prend déjà le nom lu dans la fiche. */
const FLOW = { id: 'f1', name: 'Données', active: false, nodes: [
  { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
  { name: 'Fiche', type: 'outil.ecrire', params: { message: 'lire' }, position: [340, 160] },
  { name: DEM, type: 'module.action', params: { module: 'ymir', action: 'demarrer', entrée: '{"nom":"vm-{{ $node[\'Fiche\'].json.nom }}","attendre":true}' }, position: [620, 160] },
  { name: 'Après', type: 'outil.ecrire', params: { message: `Fait pour {{ $node["Fiche"].json.nom }} ${PIEGE} {{ $json.x }} {{ $node["${PIEGE}"].json.a }}`, combien: 2 }, position: [900, 160] },
  { name: 'Seul', type: 'outil.ecrire', params: {}, position: [900, 400] },
], connections: { Lancer: [[{ node: 'Fiche' }]], Fiche: [[{ node: DEM }]], [DEM]: [[{ node: 'Après' }]] } };
/** Le dernier passage : ce que chaque bloc a rendu (comme le garde le moteur, 20 éléments au plus). */
const RUN = { status: 'succès', nodes: {
  Lancer: { count: 1, items: [{}], ms: 1 },
  Fiche: { count: 1, items: [{ nom: 'Ana', 'données': { ville: 'Lyon' }, [PIEGE]: '<b>gras</b>' }], ms: 1 },
  [DEM]: { count: 1, items: [{ texte: 'démarrée' }], ms: 1 },
} };

async function page(flow: unknown = FLOW, runs: unknown[] = [RUN]) {
  racine = new Noeud('html'); actif = null;
  const vue = new Noeud('section'); vue.setAttribute('id', 'v-flows');
  const head = new Noeud('div'); head.className = 'head'; const h1 = new Noeud('h1'); const sub = new Noeud('p'); sub.className = 'sub'; head.append(h1, sub);
  const body = new Noeud('div'); body.className = 'body'; vue.append(head, body); racine.append(vue);
  const tete = new Noeud('head');
  const document = {
    readyState: 'complete', head: tete, body: racine, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), querySelectorAll: (s: string) => racine.querySelectorAll(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
    addEventListener: () => {}, removeEventListener: () => {},
  };
  const appels: Array<{ chemin: string; corps?: Record<string, unknown> }> = [];
  const reponses: Record<string, (c?: Record<string, unknown>) => unknown> = {
    '/api/draupnir/state': () => ({ ok: true, flows: [], templates: [], catalog: CATALOG, dossiers: [] }),
    '/api/draupnir/flow': () => ({ ok: true, flow: JSON.parse(JSON.stringify(flow)), outputs: {}, runs: JSON.parse(JSON.stringify(runs)), versions: [] }),
    '/api/draupnir/applis': () => ({ ok: true, applis: [HYDRE] }),
    '/api/draupnir/save': (c) => ({ ok: true, flow: c?.flow }),
  };
  const fetch = async (chemin: string, o?: { body?: string }) => {
    const corps = o?.body ? JSON.parse(o.body) as Record<string, unknown> : undefined;
    appels.push({ chemin, corps });
    const f = reponses[chemin.split('?')[0]];
    return { status: 200, ok: true, json: async () => (f ? f(corps) : { ok: false, error: 'inconnu' }) };
  };
  const window: Record<string, unknown> = { OdinAppIcons: { tile: (id: string) => `<svg data-appli="${id}"></svg>` }, OdinDialog: { confirm: async () => true, alert: async () => {}, prompt: async () => null } };
  const ctx = { window, document, fetch, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, console };
  vm.runInNewContext(FLOWS, ctx); vm.runInNewContext(LIEN, ctx);
  await (window.OdinFlows as { edit: (id: string) => Promise<void> }).edit((flow as { id: string }).id); await attendre();
  const bouton = (texte: string | RegExp, dans: Noeud = racine) => dans.querySelectorAll('button').find((b) => (typeof texte === 'string' ? b.textContent.trim() === texte : texte.test(b.textContent)));
  const bloc = (debut: string) => body.querySelectorAll('.dr-node').find((x) => (x.getAttribute('aria-label') ?? '').startsWith(debut))!;
  const choisir = async (debut: string) => { await bloc(debut).emettre('keydown', { key: 'Enter' }); await attendre(); return body.querySelector('#drSide')!; };
  /** Le champ de réglage dont le libellé commence par `lib`. */
  const champ = (side: Noeud, lib: string) => { const l = side.querySelectorAll('label').find((x) => x.textContent.startsWith(lib))!; return side.querySelector(`#${l.getAttribute('for')}`)!; };
  const enregistre = async () => { await bouton('Enregistrer')!.emettre('click'); await attendre(); return [...appels].reverse().find((a) => a.chemin === '/api/draupnir/save')!.corps!.flow as typeof FLOW; };
  const css = tete.querySelectorAll('style').map((s) => s.textContent).join('\n');
  return { body, bouton, bloc, choisir, champ, enregistre, css };
}
const attendre = () => new Promise((ok) => setTimeout(ok, 20));
/** Ouvre la liste des données d'un champ par son bouton. */
async function liste(f: Noeud) {
  const b = f.closest('.dr-df')!.querySelector('.dr-df-b')!;
  await b.emettre('click'); await attendre();
  return f.closest('.dr-df')!.querySelector('.dr-donnees')!;
}

test('page : l\'automatisation écrite à la main s\'ouvre avec ses pastilles ; rouverte sans rien toucher, elle ne change pas', async () => {
  const p = await page();
  for (const d of ['Lancer', 'Fiche', 'Hydre : Démarrer', 'Après', 'Seul']) await p.choisir(d);
  const side = await p.choisir('Hydre : Démarrer');
  const f = p.champ(side, 'Machine');
  assert.ok(f.classList.contains('dr-saisie'), 'le champ « Machine » accepte des pastilles');
  assert.equal(f.getAttribute('role'), 'textbox'); assert.equal(f.getAttribute('aria-required'), 'true');
  // Un <label for> ne nomme pas un div : le champ porte le nom de son libellé (aria-labelledby).
  const nomme = side.querySelector(`#${f.getAttribute('aria-labelledby') ?? 'aucun'}`);
  assert.ok(nomme && nomme.tagName === 'LABEL' && nomme.textContent.startsWith('Machine'), 'le champ a un nom accessible : son libellé');
  const pa = f.querySelectorAll('.dr-pastille');
  assert.equal(pa.length, 1, 'l\'expression est montrée en pastille');
  assert.equal(pa[0].getAttribute('contenteditable'), 'false');
  assert.match(pa[0].textContent, /Fiche · nom/, 'le nom du bloc et de la donnée');
  assert.equal(f.textContent.startsWith('vm-'), true, 'le texte autour reste');
  const s2 = await p.choisir('Après');
  assert.equal(p.champ(s2, 'Message').querySelectorAll('.dr-pastille').length, 2, 'les deux expressions $node, pas $json');
  const msg = p.champ(s2, 'Message'), ml = s2.querySelector(`#${msg.getAttribute('aria-labelledby') ?? 'aucun'}`);
  assert.ok(ml && ml.tagName === 'LABEL' && ml.textContent.startsWith('Message'), 'aussi pour un réglage d\'outil');
  assert.ok(p.champ(s2, 'Message').textContent.includes('{{ $json.x }}'), 'une expression que la page ne sait pas montrer reste du texte');
  assert.deepEqual(ici(await p.enregistre()), ici(FLOW));
});

test('page : le bouton « Données » ouvre la liste des blocs d\'avant seulement, rangée par bloc, avec ce que la page sait', async () => {
  const p = await page();
  const side = await p.choisir('Hydre : Démarrer');
  const f = p.champ(side, 'Machine');
  const b = f.closest('.dr-df')!.querySelector('.dr-df-b')!;
  assert.equal(b.tagName, 'BUTTON'); assert.equal(b.getAttribute('aria-expanded'), 'false');
  const l = await liste(f);
  assert.ok(l, 'la liste s\'ouvre sous le champ'); assert.equal(b.getAttribute('aria-expanded'), 'true');
  const blocs = l.querySelectorAll('h4').map((h) => h.textContent);
  assert.deepEqual(blocs.map((t) => t.replace(/ ·.*$/, '')), ['Lancer', 'Fiche'], 'les blocs d\'avant, le premier en tête ; ni lui-même, ni « Après », ni « Seul »');
  assert.match(l.textContent, /dernier passage/, 'elle dit d\'où viennent les données');
  const items = l.querySelectorAll('button').filter((x) => x.classList.contains('dr-dn-i')).map((x) => x.textContent);
  assert.ok(items.some((t) => t.startsWith('nom') && t.includes('Ana')), 'la donnée et un exemple vu au dernier passage');
  assert.ok(items.some((t) => t.startsWith('données › ville')), 'une donnée rangée plus loin');
  assert.equal(l.querySelectorAll('img').length + l.querySelectorAll('b').filter((x) => x.textContent === 'gras').length, 0, 'une clé ou une valeur piégée reste du texte');
  assert.ok(items.some((t) => t.includes(PIEGE)), 'écrite telle quelle');
  // Un bloc du dernier passage sans donnée nommée : il le dit.
  assert.match(l.textContent, /aucune donnée nommée/);
  // Échap referme et rend le focus au champ.
  await l.emettre('keydown', { key: 'Escape' });
  assert.equal(f.closest('.dr-df')!.querySelector('.dr-donnees'), null); assert.equal(actif, f); assert.equal(b.getAttribute('aria-expanded'), 'false');
});

test('page : choisir une donnée la pose dans le champ comme une pastille ; ce qui est enregistré est l\'expression', async () => {
  const p = await page();
  let side = await p.choisir('Hydre : Démarrer');
  const f = p.champ(side, 'Machine');
  const l = await liste(f);
  await l.querySelectorAll('.dr-dn-i').find((x) => x.textContent.startsWith('données › ville'))!.emettre('click');
  const pa = f.querySelectorAll('.dr-pastille');
  assert.equal(pa.length, 2, 'une pastille de plus dans le champ'); assert.match(pa[1].textContent, /Fiche · données › ville/);
  assert.match(side.querySelector('details textarea')!.value, /données\.ville/, 'le JSON avancé suit');
  // Un réglage d'un outil (pas rangé en JSON) : l'expression de l'aide, avec des guillemets doubles.
  side = await p.choisir('Après');
  const m = p.champ(side, 'Message');
  await (await liste(m)).querySelectorAll('.dr-dn-i').find((x) => x.textContent.startsWith('texte'))!.emettre('click');
  const w = await p.enregistre();
  assert.equal((w.nodes[2].params as { entrée: string }).entrée, '{"nom":"vm-{{ $node[\'Fiche\'].json.nom }}{{ $node[\'Fiche\'].json.données.ville }}","attendre":true}');
  assert.equal(w.nodes[3].params.message, `${FLOW.nodes[3].params.message}{{ $node["${DEM}"].json.texte }}`);
  assert.deepEqual(ici(w.connections), ici(FLOW.connections), 'rien d\'autre ne change');
});

test('page : survol ou focus d\'une pastille → le bloc d\'origine s\'illumine ; le bouton × la retire', async () => {
  const p = await page();
  const side = await p.choisir('Hydre : Démarrer');
  const f = p.champ(side, 'Machine'), pa = f.querySelector('.dr-pastille')!;
  await pa.emettre('pointerenter');
  assert.ok(p.bloc('Fiche').classList.contains('dr-source'), 'le bloc d\'origine s\'illumine');
  await pa.emettre('pointerleave');
  assert.ok(!p.bloc('Fiche').classList.contains('dr-source'));
  const x = pa.querySelector('.dr-p-x')!;
  assert.equal(x.tagName, 'BUTTON'); assert.match(x.getAttribute('aria-label') ?? '', /Retirer la donnée Fiche · nom/);
  await x.emettre('focusin');
  assert.ok(p.bloc('Fiche').classList.contains('dr-source'), 'au focus aussi');
  await x.emettre('click');
  assert.equal(f.querySelectorAll('.dr-pastille').length, 0);
  assert.ok(!p.bloc('Fiche').classList.contains('dr-source'), 'éteint quand la pastille part');
  const w = await p.enregistre();
  assert.equal((w.nodes[2].params as { entrée: string }).entrée, '{"nom":"vm-","attendre":true}');
  assert.match(p.css, /\.dr-p-x::after\{[^}]*inset:-12px/, 'le × se touche sur 44 px');
  assert.match(p.css, /prefers-reduced-motion[^}]*\.dr-node\.dr-source/, 'l\'illumination ne bouge pas si l\'appareil demande moins de mouvement');
});

test('page : bloc d\'origine renommé : la pastille suit son nouveau nom ; retiré : la pastille le dit au lieu de pointer dans le vide', async () => {
  const p = await page();
  let side = await p.choisir('Fiche');
  const nn = side.querySelector('#drNn')!; nn.value = 'Fiche lue'; await nn.emettre('change', { target: { value: 'Fiche lue' } });
  side = await p.choisir('Hydre : Démarrer');
  const pa = p.champ(side, 'Machine').querySelector('.dr-pastille')!;
  assert.equal(pa.classList.contains('bad'), false, 'pas marquée : elle suit le bloc');
  assert.match(pa.textContent, /Fiche lue · nom/, 'elle montre le nouveau nom');
  assert.equal(pa.getAttribute('data-src'), '{{ $node[\'Fiche lue\'].json.nom }}');
  assert.doesNotMatch(side.textContent, /a été renommé/);
  // La liste propose le nouveau nom.
  const l = await liste(p.champ(side, 'Machine'));
  assert.ok(l.querySelectorAll('h4').some((h) => h.textContent.startsWith('Fiche lue')));
  // L'expression enregistrée suit, dans les deux blocs qui prennent une donnée chez lui ; le reste du texte ne bouge pas.
  let w = await p.enregistre();
  assert.equal((w.nodes.find((n) => n.name === DEM)!.params as { entrée: string }).entrée, '{"nom":"vm-{{ $node[\'Fiche lue\'].json.nom }}","attendre":true}');
  assert.equal(w.nodes.find((n) => n.name === 'Après')!.params.message, `Fait pour {{ $node["Fiche lue"].json.nom }} ${PIEGE} {{ $json.x }} {{ $node["${PIEGE}"].json.a }}`);
  // Retiré : la pastille le dit (comme avant).
  side = await p.choisir('Fiche lue');
  await p.bouton('Retirer', side)!.emettre('click'); await attendre();
  side = await p.choisir('Hydre : Démarrer');
  assert.ok(p.champ(side, 'Machine').querySelector('.dr-pastille')!.classList.contains('bad'), 'marquée');
  assert.match(side.textContent, /« Fiche lue » a été retiré/);
  // Retirer un bloc ne réécrit rien : l'expression reste celle d'avant le retrait.
  w = await p.enregistre();
  assert.match((w.nodes.find((n) => n.name === DEM)!.params as { entrée: string }).entrée, /\$node\['Fiche lue'\]/);
});

test('page : sans dernier passage, la liste dit qu\'il faut d\'abord tester ; un bloc sans rien avant le dit aussi', async () => {
  const p = await page(FLOW, []);
  let side = await p.choisir('Hydre : Démarrer');
  const l = await liste(p.champ(side, 'Machine'));
  assert.match(l.textContent, /Pas encore de données/); assert.match(l.textContent, /Tester/);
  assert.equal(l.querySelectorAll('.dr-dn-i').length, 0);
  side = await p.choisir('Seul');
  const l2 = await liste(p.champ(side, 'Message'));
  assert.match(l2.textContent, /Aucun bloc n'est relié avant/);
});

test('page : une expression à guillemets doubles dans des réglages rangés en texte JSON est marquée (le moteur la lirait vide) ; le texte d\'exemple est dit', async () => {
  const brut = JSON.stringify({ nom: '{{ $node["Fiche"].json.nom }}' });
  const flow = JSON.parse(JSON.stringify(FLOW)) as typeof FLOW;
  (flow.nodes[2].params as { entrée: string }).entrée = brut;
  const scope = { $json: {}, $node: { Fiche: { json: { nom: 'Ana' }, items: [] } }, $now: '', $today: '', $index: 0, $items: [], $workflow: { id: '', name: '' } };
  assert.equal(resolve(brut, scope as never), '{"nom":""}', 'le vrai moteur la lit vide');
  const p = await page(flow);
  const side = await p.choisir('Hydre : Démarrer');
  const pa = p.champ(side, 'Machine').querySelector('.dr-pastille')!;
  assert.ok(pa.classList.contains('bad'), 'marquée'); assert.match(pa.getAttribute('data-raison') ?? '', /guillemets doubles/);
  assert.match(side.textContent, /guillemets doubles/, 'écrit sous le champ');
  // Celle que pose la page (guillemets simples) reste bonne.
  const note = p.champ(side, 'Note');
  assert.equal(note.getAttribute('aria-placeholder'), 'par défaut : rien', 'le texte d\'exemple n\'est pas seulement dans le CSS');
  assert.equal((await p.enregistre()).nodes[2].params.entrée, brut, 'rien n\'est réécrit');
  // Celle que pose la page (guillemets simples) est bonne.
  await (await liste(note)).querySelectorAll('.dr-dn-i').find((x) => x.textContent.startsWith('nom'))!.emettre('click');
  const posee = note.querySelector('.dr-pastille')!;
  assert.ok(!posee.classList.contains('bad')); assert.ok(!(posee.getAttribute('data-src') ?? '').includes('"'));
});
