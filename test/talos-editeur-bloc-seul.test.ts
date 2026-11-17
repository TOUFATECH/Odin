// Talos, l'éditeur à nœuds (src/web/flows.js) : « Exécuter ce bloc seul » (étape 5b), dans le menu d'un bloc.
// - Logique (sans document) : l'entrée donnée au bloc est celle vue au dernier passage des blocs d'avant (par la bonne
//   sortie) ; les blocs d'avant ne tournent pas, leurs données se lisent par {{ $node["X"]… }} ; un déclencheur, un bloc
//   désactivé, un bloc à deux entrées, un bloc sans données d'avant : refusés avec la raison ; ce que fait un bloc qui
//   agit (la même liste que l'accord d'Odin, src/tools/draupnir.ts) ; une automatisation changée depuis
//   l'enregistrement (une position ou une note ne comptent pas).
// - Moteur et route (vrai Talos, dossier jetable, rien ne sort) : le bloc tourne seul avec l'entrée fournie, lit les
//   données des blocs d'avant, les blocs suivants ne tournent pas, rien de l'automatisation enregistrée ne change ; un
//   appel web vers Odin lui-même est refusé comme en exécution normale.
// - Page (petit document simulé) : l'entrée en premier dans le menu ; la confirmation d'un bloc qui agit (« non » : rien
//   ne part) ; ce qui part au serveur ; la marque sur le bloc ; ses données dans « Données » du bloc suivant ; l'erreur.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { execute, type Workflow } from '../src/draupnir/engine.ts';
import { CATALOG, REFUS_VERS_ODIN, reseauOdin } from '../src/draupnir/nodes.ts';
import { Talos } from '../src/draupnir/service.ts';
import { arreter, demarrer, reinitialiser, sonderMaintenant } from '../src/net/etat-internet.ts';
import { setDraupnir } from '../src/tools/draupnir.ts';
import { draupnirPost } from '../src/web/draupnir-api.ts';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const OUTIL = readFileSync(new URL('../src/tools/draupnir.ts', import.meta.url), 'utf8');
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

type Run = { count: number; items: Array<Record<string, unknown>>; ms?: number; error?: string; outputs?: number[] };
type Wf = { id?: string; name?: string; nodes: Array<{ name: string; type: string; params: Record<string, unknown>; position?: number[]; note?: string; disabled?: boolean }>; connections: Record<string, Array<Array<{ node: string }>>> };
interface Logique {
  entreeSeul: (wf: Wf, nom: string, last: { nodes: Record<string, Run> } | null, cat: (t: string) => unknown) => { ok: boolean; items?: Array<{ json: Record<string, unknown> }>; pinned?: Record<string, unknown[]>; raison?: string; tester?: string; tronque?: boolean };
  ceQuAgit: (n: { name: string; type: string; params?: Record<string, unknown> }, connu?: boolean) => string | undefined;
  pareilQuEnregistre: (a: Wf | null, b: Wf | null) => boolean;
  dernierPassage: (runs: unknown[], flow: Wf, cat: (t: string) => unknown) => { last: { nodes: Record<string, Run> } | null; seuls: Set<string> };
  AGIT_TYPES: string[];
}
function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document, URL });
  return win.OdinFlows!.logique;
}
const CAT = [
  { type: 'déclencheur.manuel', label: 'Lancer à la main', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'web.requête', label: 'Requête web', group: 'Web', params: [{ key: 'url', label: 'Adresse', kind: 'text', required: true }, { key: 'méthode', label: 'Méthode', kind: 'select', options: ['GET', 'POST'], default: 'GET' }] },
  { type: 'données.définir', label: 'Définir des champs', group: 'Données', params: [{ key: 'champs', label: 'Champs', kind: 'textarea' }] },
  { type: 'odin.prévenir', label: 'Me prévenir', group: 'Odin', params: [{ key: 'texte', label: 'Texte', kind: 'text' }] },
  { type: 'logique.si', label: 'Si', group: 'Logique', outputs: ['oui', 'non'], params: [{ key: 'condition', label: 'Condition', kind: 'text', default: '' }] },
  { type: 'logique.fusionner', label: 'Fusionner', group: 'Logique', inputs: ['A', 'B'], params: [] },
];
const catDe = (t: string) => CAT.find((c) => c.type === t);
const FLOW: Wf = { id: 'f1', name: 'Météo', nodes: [
  { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
  { name: 'Lire', type: 'web.requête', params: { url: 'https://site.exemple/meteo', méthode: 'GET' }, position: [340, 160] },
  { name: 'Calcul', type: 'données.définir', params: { champs: '{"ville":"{{ $node[\'Lire\'].json.ville }}"}' }, position: [620, 160] },
  { name: 'Dire', type: 'odin.prévenir', params: { texte: 'Il fait beau' }, position: [900, 160] },
], connections: { Lancer: [[{ node: 'Lire' }]], Lire: [[{ node: 'Calcul' }]], Calcul: [[{ node: 'Dire' }]] } };
const DERNIER = { status: 'succès', startedAt: '2026-11-18T08:00:00.000Z', nodes: {
  Lancer: { count: 1, items: [{}], ms: 0, outputs: [1] },
  Lire: { count: 2, items: [{ ville: 'Mamoudzou', ciel: 'clair' }, { ville: 'Dzaoudzi' }], ms: 3, outputs: [2] },
} as Record<string, Run> };

// ------------------------------------------------------------------ logique
test('logique : l\'entrée est celle vue au dernier passage du bloc d\'avant ; les blocs d\'avant sont fournis (pour $node), sans tourner', () => {
  const L = logique();
  const r = L.entreeSeul(FLOW, 'Calcul', DERNIER, catDe);
  assert.equal(r.ok, true, r.raison);
  assert.deepEqual(ici(r.items), [{ json: { ville: 'Mamoudzou', ciel: 'clair' } }, { json: { ville: 'Dzaoudzi' } }], 'les éléments du dernier passage de « Lire »');
  assert.deepEqual(ici(r.pinned), { Lancer: [{}], Lire: [{ ville: 'Mamoudzou', ciel: 'clair' }, { ville: 'Dzaoudzi' }] }, 'les blocs d\'avant, avec leurs données');
  assert.equal(r.tronque, false);
  // Le bloc suivant : ce sont les données vues de « Calcul » (absentes ici : rien n'est inventé).
  const d = L.entreeSeul(FLOW, 'Dire', DERNIER, catDe);
  assert.equal(d.ok, false); assert.match(d.raison!, /« Calcul » n'a pas encore de données/); assert.equal(d.tester, 'Calcul', 'il propose « Tester jusqu\'ici » sur le bloc d\'avant');
  // Après « Calcul » exécuté seul, ses données servent au suivant.
  const d2 = L.entreeSeul(FLOW, 'Dire', { nodes: { ...DERNIER.nodes, Calcul: { count: 1, items: [{ ville: 'Mamoudzou' }], outputs: [1] } } }, catDe);
  assert.deepEqual(ici(d2.items), [{ json: { ville: 'Mamoudzou' } }]);
  assert.deepEqual(Object.keys(d2.pinned!), ['Lancer', 'Lire', 'Calcul']);
  // Plus de 20 éléments vus : le moteur n'en garde que 20, c'est dit.
  const beaucoup = L.entreeSeul(FLOW, 'Calcul', { nodes: { ...DERNIER.nodes, Lire: { count: 31, items: Array.from({ length: 20 }, (_x, i) => ({ i })), outputs: [31] } } }, catDe);
  assert.equal(beaucoup.ok, true); assert.equal(beaucoup.items!.length, 20); assert.equal(beaucoup.tronque, true);
});

test('logique : par la bonne sortie d\'un « Si » ; refus quand on ne peut pas le savoir, sans rien inventer', () => {
  const L = logique();
  const wf: Wf = { nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {} }, { name: 'Si', type: 'logique.si', params: {} }, { name: 'Oui', type: 'odin.prévenir', params: {} }, { name: 'Non', type: 'odin.prévenir', params: {} }],
    connections: { Lancer: [[{ node: 'Si' }]], Si: [[{ node: 'Oui' }], [{ node: 'Non' }]] } };
  const last = { nodes: { Lancer: { count: 1, items: [{}], outputs: [1] }, Si: { count: 3, items: [{ a: 1 }, { a: 2 }, { a: 3 }], outputs: [1, 2] } } };
  assert.deepEqual(ici(L.entreeSeul(wf, 'Oui', last, catDe).items), [{ json: { a: 1 } }]);
  assert.deepEqual(ici(L.entreeSeul(wf, 'Non', last, catDe).items), [{ json: { a: 2 } }, { json: { a: 3 } }]);
  // Plusieurs passages (le compte ne correspond plus aux sorties) : on ne sait pas, on le dit.
  const flou = L.entreeSeul(wf, 'Non', { nodes: { ...last.nodes, Si: { count: 5, items: [{ a: 1 }], outputs: [1, 2] } } }, catDe);
  assert.equal(flou.ok, false); assert.match(flou.raison!, /quelles données de « Si »/);
  // Aucun élément arrivé par ce lien : il n'aurait pas tourné.
  const rien = L.entreeSeul(wf, 'Oui', { nodes: { ...last.nodes, Si: { count: 2, items: [{ a: 2 }, { a: 3 }], outputs: [0, 2] } } }, catDe);
  assert.equal(rien.ok, false); assert.match(rien.raison!, /aucun élément/);
  // Le bloc d'avant a échoué.
  const ko = L.entreeSeul(wf, 'Oui', { nodes: { ...last.nodes, Si: { count: 0, items: [], error: 'condition illisible' } } }, catDe);
  assert.equal(ko.ok, false); assert.match(ko.raison!, /« Si » a échoué/);
});

test('logique : déclencheur, bloc désactivé, bloc à deux entrées, bloc sans rien avant, bloc introuvable : refusés avec la raison', () => {
  const L = logique();
  const t = L.entreeSeul(FLOW, 'Lancer', DERNIER, catDe);
  assert.equal(t.ok, false); assert.match(t.raison!, /déclencheur/); assert.match(t.raison!, /Tester/);
  const off = { ...FLOW, nodes: FLOW.nodes.map((n) => (n.name === 'Calcul' ? { ...n, disabled: true } : n)) };
  const d = L.entreeSeul(off, 'Calcul', DERNIER, catDe);
  assert.equal(d.ok, false); assert.match(d.raison!, /désactivé/);
  const fus: Wf = { nodes: [...FLOW.nodes, { name: 'Réunir', type: 'logique.fusionner', params: {} }], connections: { ...FLOW.connections, Lire: [[{ node: 'Calcul' }, { node: 'Réunir' }]] } };
  const f = L.entreeSeul(fus, 'Réunir', DERNIER, catDe);
  assert.equal(f.ok, false); assert.match(f.raison!, /plusieurs branches/);
  const seul: Wf = { nodes: [...FLOW.nodes, { name: 'Isolé', type: 'odin.prévenir', params: {} }], connections: FLOW.connections };
  const i = L.entreeSeul(seul, 'Isolé', DERNIER, catDe);
  assert.equal(i.ok, false); assert.match(i.raison!, /Aucun bloc n'est relié avant/);
  assert.equal(L.entreeSeul(FLOW, 'Absent', DERNIER, catDe).ok, false);
  // Jamais lancée : rien à donner, il propose de tester d'abord.
  const jamais = L.entreeSeul(FLOW, 'Calcul', null, catDe);
  assert.equal(jamais.ok, false); assert.equal(jamais.tester, 'Lire');
});

test('logique : ce que fait un bloc qui agit, en clair ; un bloc qui lit ou calcule n\'agit pas ; la liste est celle de l\'accord d\'Odin', () => {
  const L = logique();
  assert.equal(L.ceQuAgit({ name: 'Lire', type: 'web.requête', params: { url: 'https://site.exemple/a', méthode: 'POST' } }), 'appelle site.exemple (POST)');
  assert.equal(L.ceQuAgit({ name: 'Lire', type: 'web.requête', params: { url: '{{ $json.lien }}' } }), 'appelle une adresse à calculer (GET)');
  assert.match(L.ceQuAgit({ name: 'App', type: 'module.action', params: { module: 'ymir', action: 'demarrer' } })!, /lance l'action « demarrer » de l'appli ymir/);
  assert.equal(L.ceQuAgit({ name: 'Q', type: 'odin.demander', params: { envoyer: 'non' } }), undefined);
  for (const t of ['données.définir', 'logique.si', 'saga.chercher', 'runes.lister', 'odin.classer', 'données.trier']) assert.equal(L.ceQuAgit({ name: 'x', type: t, params: {} }, true), undefined, t);
  assert.match(L.ceQuAgit({ name: 'x', type: 'type.inconnu', params: {} }, false)!, /bloc inconnu/, 'un type inconnu compte comme agissant');
  // Les mêmes types que la liste écrite pour l'accord (src/tools/draupnir.ts, AGIT), ni plus ni moins.
  const bloc = /const AGIT[^{]*\{([\s\S]*?)\n\};/.exec(OUTIL)![1];
  const types = [...bloc.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]).sort();
  assert.ok(types.length >= 10, 'la liste de l\'accord est lue');
  assert.deepEqual([...L.AGIT_TYPES].sort(), types);
});

test('logique : une automatisation changée depuis l\'enregistrement n\'est plus « la même » ; une position ou une note ne comptent pas', () => {
  const L = logique(), a = ici(FLOW);
  assert.equal(L.pareilQuEnregistre(a, ici(FLOW)), true);
  const b = ici(FLOW); b.nodes[1].position = [10, 10]; b.nodes[2].note = 'à revoir'; b.name = 'Autre nom';
  assert.equal(L.pareilQuEnregistre(b, a), true, 'déplacer un bloc, une note, le nom : ce qui tourne est le même');
  const c = ici(FLOW); c.nodes[2].params.champs = '{}';
  assert.equal(L.pareilQuEnregistre(c, a), false, 'un réglage');
  const d = ici(FLOW); d.nodes[2].name = 'Calcul 2';
  assert.equal(L.pareilQuEnregistre(d, a), false, 'un nom de bloc');
  const e = ici(FLOW); e.connections.Calcul = [[]];
  assert.equal(L.pareilQuEnregistre(e, a), false, 'un fil');
  const f = ici(FLOW); f.nodes[2].disabled = true;
  assert.equal(L.pareilQuEnregistre(f, a), false, 'désactivé');
  assert.equal(L.pareilQuEnregistre(a, null), false, 'jamais enregistrée');
});

// ------------------------------------------------------------------ moteur et route
async function enLigne(): Promise<() => void> {
  const sauve = { ...reseauOdin };
  reseauOdin.resoudre = async (n) => { if (n === 'site.exemple') return ['203.0.113.5']; throw Object.assign(new Error('nom inconnu'), { code: 'ENOTFOUND' }); };
  reseauOdin.adressesMachine = () => ['127.0.0.1', '::1'];
  reseauOdin.nomMachine = () => 'poste-odin';
  reseauOdin.nomsPublics = () => [];
  reinitialiser();
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => true, parIp: async () => true }, intervalleMs: 1e9 });
  await sonderMaintenant();
  return () => { Object.assign(reseauOdin, sauve); arreter(); reinitialiser(); };
}

test('moteur : partir d\'un bloc avec des données fournies — celles des blocs d\'avant se lisent par $node, sans qu\'ils tournent', async () => {
  const wf: Workflow = { id: 'w', name: 'Essai', active: false, nodes: [
    { name: 'Go', type: 'déclencheur.manuel', params: {} },
    { name: 'Fiche', type: 'données.définir', params: { champs: '{"nom":"recalculé"}' } },
    { name: 'Calcul', type: 'données.définir', params: { champs: '{"qui":"{{ $node[\'Fiche\'].json.nom }}","ici":"{{ $json.n }}"}' } },
    { name: 'Après', type: 'données.définir', params: { champs: '{"x":1}' } },
  ], connections: { Go: [[{ node: 'Fiche' }]], Fiche: [[{ node: 'Calcul' }]], Calcul: [[{ node: 'Après' }]] } };
  const ex = await execute(wf, CATALOG, {}, { node: 'Calcul', stopAfter: 'Calcul', items: [{ json: { n: 7 } }], pinned: { Go: [{}], Fiche: [{ nom: 'Inès' }] } });
  assert.equal(ex.status, 'succès', ex.error);
  assert.deepEqual(ex.nodes.Calcul.items, [{ n: 7, qui: 'Inès', ici: '7' }], 'la donnée de « Fiche » vue au dernier passage');
  assert.deepEqual(Object.keys(ex.nodes), ['Calcul'], 'ni les blocs d\'avant ni les suivants ne tournent');
});

test('route : un bloc exécuté seul (comme le fait la page) — l\'automatisation enregistrée ne change pas, les suivants ne tournent pas, l\'appel vers Odin lui-même est refusé', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bloc-seul-'));
  const fin = await enLigne();
  const appels: string[] = [];
  const f = (async (u: string) => { appels.push(String(u)); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  const d = new Talos(home, { fetch: f }); setDraupnir(d);
  try {
    const w = d.save({ name: 'Relevé', active: false, nodes: [
      { name: 'Go', type: 'déclencheur.manuel', params: {} },
      { name: 'Fiche', type: 'données.définir', params: { champs: '{"lien":"https://site.exemple/r"}' } },
      { name: 'Appel', type: 'web.requête', params: { url: '{{ $node[\'Fiche\'].json.lien }}', méthode: 'POST', corps: '{"a":1}' } },
      { name: 'Suite', type: 'web.requête', params: { url: 'https://site.exemple/suite' } },
    ], connections: { Go: [[{ node: 'Fiche' }]], Fiche: [[{ node: 'Appel' }]], Appel: [[{ node: 'Suite' }]] } } as never);
    const avant = JSON.stringify(d.get(w.id));
    const r = await draupnirPost({} as never, '/api/draupnir/run', { id: w.id, start: 'Appel', stopAfter: 'Appel', items: [{ json: { lien: 'https://site.exemple/r' } }], pinned: { Go: [{}], Fiche: [{ lien: 'https://site.exemple/r' }] } }) as { ok: boolean; run: { status: string; nodes: Record<string, Run>; error?: string } };
    assert.equal(r.ok, true); assert.equal(r.run.status, 'succès', r.run.error);
    assert.deepEqual(appels, ['https://site.exemple/r'], 'le bloc a lu l\'adresse chez « Fiche » ; « Suite » n\'a pas tourné');
    assert.deepEqual(Object.keys(r.run.nodes), ['Appel']);
    assert.equal(JSON.stringify(d.get(w.id)), avant, 'l\'automatisation enregistrée ne change pas (ni activée, ni réécrite)');
    assert.equal(d.get(w.id)!.active, false);
    // Vers Odin lui-même : le même refus qu'en exécution normale, rien ne part.
    const r2 = await draupnirPost({} as never, '/api/draupnir/run', { id: w.id, start: 'Appel', stopAfter: 'Appel', items: [{ json: {} }], pinned: { Go: [{}], Fiche: [{ lien: 'http://localhost:8888/api/x' }] } }) as { ok: boolean; run: { status: string; nodes: Record<string, Run>; error?: string } };
    assert.equal(r2.run.status, 'erreur'); assert.equal(r2.run.error, REFUS_VERS_ODIN); assert.equal(r2.run.nodes.Appel.error, REFUS_VERS_ODIN);
    assert.deepEqual(appels, ['https://site.exemple/r'], 'aucun appel de plus');
    const normal = await d.run(w.id, [], 'test', undefined, { pinned: { Fiche: [{ lien: 'http://localhost:8888/api/x' }] } });
    assert.equal(normal.error, REFUS_VERS_ODIN, 'le même refus en exécution normale');
    assert.equal(JSON.stringify(d.get(w.id)), avant);
  } finally { d.stop(); setDraupnir(undefined); fin(); rmSync(home, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ un document minimal (comme talos-editeur-menu)
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud; let actif: Noeud | null = null;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Array<Noeud | null> = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> & { setProperty?: () => void } = {};
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
  get childNodes() { return this.enfants.filter((x): x is Noeud => x !== null); }
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
  contains(n: Noeud | null) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  removeEventListener(t: string, f: Ecoute) { this.ecoutes[t] = (this.ecoutes[t] ?? []).filter((x) => x !== f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) {
    const e = { type: t, target: this, preventDefault() {}, stopPropagation() {}, timeStamp: Date.now(), ...plus };
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
const attendre = () => new Promise((ok) => setTimeout(ok, 20));

async function page(o: { flow?: Wf; runs?: unknown[]; reponseRun?: unknown; oui?: boolean } = {}) {
  const flow = o.flow ?? FLOW;
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
    '/api/draupnir/state': () => ({ ok: true, flows: [], templates: [], catalog: CAT, dossiers: [] }),
    '/api/draupnir/flow': () => ({ ok: true, flow: ici(flow), outputs: {}, runs: ici(o.runs ?? [DERNIER]), versions: [] }),
    '/api/draupnir/save': (c) => ({ ok: true, flow: c?.flow }),
    '/api/draupnir/run': () => o.reponseRun ?? { ok: true, run: { status: 'succès', ms: 4, nodes: { Calcul: { count: 2, items: [{ ville: 'Mamoudzou', degres: 29 }, { ville: 'Dzaoudzi' }], ms: 4, outputs: [2] } } } },
  };
  const fetch = async (chemin: string, x?: { body?: string }) => {
    const corps = x?.body ? JSON.parse(x.body) as Record<string, unknown> : undefined;
    appels.push({ chemin, corps });
    const f = reponses[chemin.split('?')[0]];
    return { status: 200, ok: true, json: async () => (f ? f(corps) : { ok: false, error: 'inconnu' }) };
  };
  const questions: Array<{ texte: string; opts?: Record<string, unknown> }> = [], alertes: string[] = [];
  const window: Record<string, unknown> = { OdinDialog: { confirm: async (t: string, opts?: Record<string, unknown>) => { questions.push({ texte: t, opts }); return o.oui ?? true; }, alert: async (t: string) => { alertes.push(t); }, prompt: async () => null }, getSelection: () => null };
  const ctx = { window, document, fetch, URL, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, clearTimeout, console };
  vm.runInNewContext(FLOWS, ctx);
  await (window.OdinFlows as { edit: (id: string) => Promise<void> }).edit(flow.id!); await attendre();
  const bouton = (texte: string | RegExp, dans: Noeud = racine) => dans.querySelectorAll('button').find((b) => (typeof texte === 'string' ? b.textContent.trim() === texte : texte.test(b.textContent)));
  const bloc = (nom: string) => body.querySelectorAll('.dr-node').find((x) => (x.getAttribute('aria-label') ?? '').startsWith(`${nom} (`))!;
  const menu = () => racine.querySelector('.dr-fil-menu');
  const executer = async (nom: string) => {
    await bloc(nom).emettre('contextmenu', { clientX: 300, clientY: 200, button: 2 });
    await bouton('Exécuter ce bloc seul', menu()!)!.emettre('click'); await attendre();
  };
  const runs = () => appels.filter((a) => a.chemin === '/api/draupnir/run');
  const statut = () => body.querySelector('#drSt')!.textContent;
  const css = tete.querySelectorAll('style').map((s) => s.textContent).join('\n');
  return { body, appels, questions, alertes, bouton, bloc, menu, executer, runs, statut, css };
}

test('page : « Exécuter ce bloc seul » est le premier choix du menu d\'un bloc ; un bloc qui calcule part sans confirmation, avec l\'entrée du dernier passage', async () => {
  const p = await page();
  await p.bloc('Calcul').emettre('contextmenu', { clientX: 300, clientY: 200, button: 2 });
  assert.deepEqual(p.menu()!.querySelectorAll('button').map((b) => b.textContent), ['Exécuter ce bloc seul', 'Renommer', 'Ajouter une note', 'Retirer']);
  await p.bouton('Exécuter ce bloc seul', p.menu()!)!.emettre('click'); await attendre();
  assert.deepEqual(p.questions, [], 'un bloc qui ne fait que calculer : pas de confirmation');
  assert.equal(p.runs().length, 1);
  assert.deepEqual(ici(p.runs()[0].corps), { id: 'f1', start: 'Calcul', stopAfter: 'Calcul', items: [{ json: { ville: 'Mamoudzou', ciel: 'clair' } }, { json: { ville: 'Dzaoudzi' } }], pinned: { Lancer: [{}], Lire: [{ ville: 'Mamoudzou', ciel: 'clair' }, { ville: 'Dzaoudzi' }] } });
  assert.deepEqual(p.appels.filter((a) => /save|toggle|activer/.test(a.chemin)), [], 'rien n\'est enregistré ni activé');
  // La marque sur le bloc : le nombre d'éléments rendus.
  const b = p.bloc('Calcul');
  assert.equal(b.querySelector('.dr-seul')?.textContent, '2', 'le rond avec le nombre de résultats');
  assert.match(b.getAttribute('aria-label') ?? '', /exécuté seul : 2 élément/);
  assert.match(b.className, /\bok\b/);
  assert.match(p.statut(), /« Calcul » exécuté seul : 2 élément/); assert.match(p.statut(), /suivants n'ont pas tourné/);
  assert.equal(p.bloc('Dire').querySelector('.dr-seul'), null, 'rien sur le bloc suivant');
  assert.equal(p.bloc('Lire').querySelector('.dr-seul'), null, 'ni sur ceux d\'avant');
  // Ses données sont disponibles dans « Données » du bloc suivant.
  const dire = p.bloc('Dire');
  await dire.emettre('pointerdown', { clientX: 5, clientY: 5, pointerId: 1, button: 0, pointerType: 'mouse' });
  await dire.emettre('pointerup', { clientX: 5, clientY: 5, pointerId: 1, pointerType: 'mouse' });
  await p.bouton('Données', p.body.querySelector('#drSide')!)!.emettre('click'); await attendre();
  const liste = p.body.querySelector('.dr-donnees')!;
  assert.ok(liste, 'la liste des données');
  const groupe = liste.querySelectorAll('.dr-dn-l').find((g) => g.getAttribute('aria-label') === 'Données de Calcul');
  assert.ok(groupe, 'les données de « Calcul » sont proposées');
  assert.deepEqual(groupe!.querySelectorAll('b').map((x) => x.textContent), ['ville', 'degres']);
  // Une marque, et l'élément 2 du rond se voit : règle de style présente.
  assert.match(p.css, /\.dr-seul\{[^}]*position:absolute/);
});

test('page : un bloc qui agit demande une confirmation qui dit ce qu\'il va faire ; « non » : rien ne part', async () => {
  const flow = ici(FLOW); flow.nodes[1].params.méthode = 'POST';
  const runs = [{ ...DERNIER, nodes: { ...DERNIER.nodes, Calcul: { count: 1, items: [{ ville: 'Mamoudzou' }], outputs: [1] } } }];
  const non = await page({ flow, oui: false, runs });
  await non.executer('Dire');
  assert.equal(non.questions.length, 1);
  assert.match(non.questions[0].texte, /« Dire »/); assert.match(non.questions[0].texte, /te prévient sur ta messagerie/);
  assert.match(non.questions[0].texte, /suivants ne tourneront pas/);
  assert.equal(non.questions[0].opts?.ok, 'Exécuter');
  assert.equal(non.runs().length, 0, '« non » : rien ne part');
  assert.match(non.statut(), /Rien n'a été exécuté/);
  // À chaque fois : une deuxième demande, une deuxième question.
  await non.executer('Dire'); assert.equal(non.questions.length, 2); assert.equal(non.runs().length, 0);
  const oui = await page({ flow, oui: true, runs, reponseRun: { ok: true, run: { status: 'succès', ms: 1, nodes: { Dire: { count: 1, items: [{ envoyé: true }], outputs: [1] } } } } });
  await oui.executer('Lire');
  assert.match(oui.questions[0].texte, /appelle site\.exemple \(POST\)/);
  assert.equal(oui.runs().length, 1);
  assert.deepEqual(ici(oui.runs()[0].corps!.items), [{ json: {} }], 'l\'élément vu au dernier passage du déclencheur');
});

test('page : un déclencheur, une automatisation changée ou jamais lancée : rien ne part, la raison est dite ; une erreur se montre sur le bloc', async () => {
  let p = await page();
  await p.executer('Lancer');
  assert.equal(p.runs().length, 0); assert.match(p.alertes[0] ?? '', /déclencheur/);
  // Changée depuis l'enregistrement : ce qui tournerait n'est pas ce qui est à l'écran.
  p = await page();
  const calcul = p.bloc('Calcul');
  await calcul.emettre('pointerdown', { clientX: 5, clientY: 5, pointerId: 1, button: 0, pointerType: 'mouse' });
  await calcul.emettre('pointerup', { clientX: 5, clientY: 5, pointerId: 1, pointerType: 'mouse' });
  const off = p.body.querySelector('#drSide')!.querySelectorAll('input').find((x) => x.getAttribute('type') === 'checkbox')!;
  off.checked = true; await off.emettre('change'); await attendre();
  await p.executer('Dire');
  assert.equal(p.runs().length, 0); assert.match(p.alertes.at(-1) ?? '', /enregistr/);
  assert.deepEqual(p.appels.filter((a) => a.chemin === '/api/draupnir/save'), [], 'il n\'enregistre rien à ta place');
  // Un bloc qu'on a seulement déplacé : il part.
  p = await page();
  const lire = p.bloc('Lire');
  await lire.emettre('pointerdown', { clientX: 5, clientY: 5, pointerId: 2, button: 0, pointerType: 'mouse' });
  await lire.emettre('pointermove', { clientX: 60, clientY: 40, pointerId: 2 });
  await lire.emettre('pointerup', { clientX: 60, clientY: 40, pointerId: 2 });
  await p.executer('Calcul'); assert.equal(p.runs().length, 1, 'déplacer un bloc ne change pas ce qui tourne');
  // Jamais lancée : il propose « Tester jusqu'ici » sur le bloc d'avant ; « non » : rien ne part.
  p = await page({ runs: [], oui: false });
  await p.executer('Calcul');
  assert.match(p.questions[0]?.texte ?? '', /« Lire » n'a pas encore de données/);
  assert.equal(p.questions[0]?.opts?.ok, 'Tester jusqu\'ici');
  assert.equal(p.runs().length, 0);
  // « oui » : c'est « Tester jusqu'ici » sur « Lire » (le bloc choisi ne tourne pas).
  p = await page({ runs: [], oui: true });
  await p.executer('Calcul');
  assert.deepEqual(ici(p.runs()[0]?.corps), { id: 'f1', stopAfter: 'Lire' });
  // Une erreur : sur le bloc, avec son texte ; rien ne casse.
  p = await page({ reponseRun: { ok: true, run: { status: 'erreur', ms: 1, error: 'champs : JSON invalide', failedNode: 'Calcul', nodes: { Calcul: { count: 0, items: [], ms: 1, error: 'champs : JSON invalide' } } } } });
  await p.executer('Calcul');
  const b = p.bloc('Calcul');
  assert.match(b.className, /\berr\b/);
  assert.match(b.querySelector('.dr-cnt')!.textContent, /JSON invalide/);
  assert.equal(b.querySelector('.dr-seul')?.textContent, '!');
  assert.match(p.statut(), /erreur : champs : JSON invalide/);
  assert.ok(p.bloc('Lire').className.includes('ok'), 'les données d\'avant restent');
});

test('page : au doigt, le doigt levé après l\'appui long ne choisit rien dans le menu (même tombé sur « Exécuter ce bloc seul ») ; un vrai toucher sur le choix, oui', async () => {
  const p = await page();
  const b = p.bloc('Calcul');
  await b.emettre('pointerdown', { clientX: 400, clientY: 200, pointerId: 3, pointerType: 'touch', button: 0 });
  await new Promise((ok) => setTimeout(ok, 700));
  assert.ok(p.menu(), 'appui long : le menu');
  await b.emettre('pointerup', { clientX: 400, clientY: 200, pointerId: 3, pointerType: 'touch' });
  const premier = p.menu()!.querySelector('button')!;
  assert.equal(premier.textContent, 'Exécuter ce bloc seul');
  await premier.emettre('click', { detail: 1, clientX: 400, clientY: 200 }); await attendre();
  assert.equal(p.runs().length, 0, 'le clic du doigt levé (sans appui sur le menu) ne lance rien');
  assert.ok(p.menu(), 'le menu reste ouvert');
  await premier.emettre('pointerdown', { pointerType: 'touch', button: 0 });
  await premier.emettre('click', { detail: 1 }); await attendre();
  assert.equal(p.runs().length, 1, 'un toucher sur le choix le lance');
  // Au clavier (Entrée : un clic sans pointeur), le choix compte aussi.
  await p.bloc('Calcul').emettre('keydown', { key: 'ContextMenu', target: p.bloc('Calcul') });
  await p.menu()!.querySelector('button')!.emettre('click', { detail: 0 }); await attendre();
  assert.equal(p.runs().length, 2);
});

// ------------------------------------------------------------------ après relecture
test('moteur : partir d\'un bloc sans s\'y arrêter — un bloc fourni qui tourne ensuite ne compte qu\'une fois', async () => {
  const wf: Workflow = { id: 'w', name: 'Essai', active: false, nodes: [
    { name: 'Go', type: 'déclencheur.manuel', params: {} },
    { name: 'A', type: 'données.définir', params: { champs: '{"a":1}' } },
    { name: 'B', type: 'données.définir', params: { champs: '{"b":1}' } },
    { name: 'C', type: 'données.définir', params: { champs: '{"n":"{{ $node[\'B\'].items.length }}"}' } },
  ], connections: { Go: [[{ node: 'A' }]], A: [[{ node: 'B' }]], B: [[{ node: 'C' }]] } };
  const ex = await execute(wf, CATALOG, {}, { node: 'A', items: [{ json: {} }], pinned: { B: [{ b: 2 }] } });
  assert.equal(ex.status, 'succès', ex.error);
  assert.equal(ex.nodes.C.items[0].n, '1', 'les données fournies de « B » une seule fois');
});

test('logique : à la réouverture, un bloc exécuté seul (gardé dans l\'historique) ne remplace pas le dernier passage, il s\'y ajoute', () => {
  const L = logique();
  const seul = { trigger: 'Calcul', status: 'succès', nodes: { Calcul: { count: 1, items: [{ ville: 'Mamoudzou' }], outputs: [1] } } };
  const r = L.dernierPassage([seul, { ...DERNIER, trigger: 'Lancer' }], FLOW, catDe);
  assert.deepEqual(Object.keys(r.last!.nodes).sort(), ['Calcul', 'Lancer', 'Lire']);
  assert.deepEqual([...r.seuls], ['Calcul']);
  assert.deepEqual(ici(L.dernierPassage([{ ...DERNIER, trigger: 'Lancer' }], FLOW, catDe).last!.nodes), ici(DERNIER.nodes));
  assert.equal(L.dernierPassage([], FLOW, catDe).last, null);
  // Un passage complet plus récent que le bloc seul l'emporte (plus de rond).
  const r2 = L.dernierPassage([{ ...DERNIER, trigger: 'Lancer' }, seul], FLOW, catDe);
  assert.equal(r2.seuls.size, 0); assert.equal(r2.last!.nodes.Calcul, undefined);
});

test('page : à la réouverture après un bloc exécuté seul, les blocs d\'avant gardent leurs données et le bloc garde son rond', async () => {
  const p = await page({ runs: [{ trigger: 'Calcul', status: 'succès', nodes: { Calcul: { count: 1, items: [{ ville: 'Mamoudzou' }], outputs: [1] } } }, { ...DERNIER, trigger: 'Lancer' }] });
  assert.ok(p.bloc('Lire').className.includes('ok'), 'les données de « Lire » restent');
  assert.equal(p.bloc('Calcul').querySelector('.dr-seul')?.textContent, '1');
  await p.executer('Dire'); assert.equal(p.runs().length, 1, '« Dire » trouve encore son entrée');
});

test('page : la confirmation d\'un bloc qui agit dit qu\'il peut être relancé quand l\'automatisation relance en cas d\'échec', async () => {
  const flow = { ...ici(FLOW), settings: { retry: 2 } } as Wf;
  const runs = [{ ...DERNIER, nodes: { ...DERNIER.nodes, Calcul: { count: 1, items: [{ ville: 'Mamoudzou' }], outputs: [1] } } }];
  const p = await page({ flow, runs, oui: false });
  await p.executer('Dire');
  assert.match(p.questions[0].texte, /relancé jusqu'à 2 fois de plus/);
  const q = await page({ runs, oui: false });
  await q.executer('Dire');
  assert.doesNotMatch(q.questions[0].texte, /relancé/, 'sans relance : rien à dire');
});

test('page : menu ouvert à la souris ou au clavier, un clic sans appui préalable (aide technique) choisit', async () => {
  const p = await page();
  await p.bloc('Calcul').emettre('contextmenu', { clientX: 300, clientY: 200, button: 2 });
  await p.menu()!.querySelector('button')!.emettre('click', { detail: 1 }); await attendre();
  assert.equal(p.runs().length, 1);
});
