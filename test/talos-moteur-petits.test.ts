// Talos, deux petits défauts du moteur relevés par la relecture de « Exécuter ce bloc seul » :
// - Relance (src/draupnir/engine.ts) : un réglage « retry » absent, vide, négatif, non entier ou qui n'est pas un nombre
//   (texte, objet, NaN, infini) ne relance jamais sans fin : il ne donne aucune relance ; un entier se comporte comme
//   avant (5 relances au plus). La relance sans fin est bornée ici par un compteur, pas par une attente.
// - Historique (src/draupnir/service.ts, src/web/flows.js) : l'exécution d'un bloc seul est rangée avec sa marque
//   (`seul` : le nom du bloc) ; « Dernières exécutions » la lit « bloc seul : <nom> » ; le dernier passage à la
//   réouverture lit la marque ; une ligne d'avant, sans marque, se lit comme avant ; l'automatisation ne change pas.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { execute, type NodeDef, type Workflow } from '../src/draupnir/engine.ts';
import { Talos } from '../src/draupnir/service.ts';
import { setDraupnir } from '../src/tools/draupnir.ts';
import { draupnirPost } from '../src/web/draupnir-api.ts';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

// ------------------------------------------------------------------ relance
/** Un bloc qui échoue toujours ; `appels` compte ses essais ; l'attente entre deux essais ne dort pas et coupe au 30e. */
async function essais(retry: unknown): Promise<{ appels: number; attentes: number[]; erreur?: string }> {
  let appels = 0; const attentes: number[] = [];
  const cat = new Map<string, NodeDef>([
    ['go', { type: 'go', label: 'Go', group: 'Déclencheurs', what: '', trigger: true, params: [], run: (_c, items) => [items] }],
    ['rate', { type: 'rate', label: 'Raté', group: 'Données', what: '', params: [], run: () => { appels++; throw new Error('raté'); } }],
  ]);
  const wf = { id: 'r1', name: 'Relance', active: false, nodes: [{ name: 'Go', type: 'go', params: {} }, { name: 'Raté', type: 'rate', params: {} }], connections: { Go: [[{ node: 'Raté' }]] }, settings: { retry } } as unknown as Workflow;
  const sleep = async (ms: number) => { attentes.push(ms); if (attentes.length >= 30) throw new Error('borne du compteur : relance sans fin'); };
  const ex = await execute(wf, cat, { sleep }, { items: [{ json: {} }] });
  assert.equal(ex.status, 'erreur');
  return { appels, attentes, erreur: ex.error };
}

test('relance : un réglage qui n\'est pas un entier ne relance jamais (avant : sans fin)', async () => {
  for (const v of ['abc', {}, [], NaN, Infinity, -Infinity, '', '3', true, 2.5, -1, -0.5, null, undefined]) {
    const r = await essais(v);
    assert.equal(r.appels, 1, `retry = ${JSON.stringify(v) ?? String(v)} (${String(v)}) : un seul essai, aucune relance (${r.erreur})`);
    assert.equal(r.erreur, 'raté');
  }
});

test('relance : un entier se comporte comme avant (attente qui double, 5 relances au plus)', async () => {
  assert.deepEqual(await essais(0), { appels: 1, attentes: [], erreur: 'raté' });
  assert.deepEqual(await essais(2), { appels: 3, attentes: [1000, 2000], erreur: 'raté' });
  assert.deepEqual(await essais(5), { appels: 6, attentes: [1000, 2000, 4000, 8000, 16000], erreur: 'raté' });
  assert.deepEqual(await essais(99), { appels: 6, attentes: [1000, 2000, 4000, 8000, 16000], erreur: 'raté' }, 'la borne');
});

// ------------------------------------------------------------------ historique (vrai Talos, dossier jetable, rien ne sort)
test('historique : l\'exécution d\'un bloc seul est rangée avec sa marque ; les autres exécutions n\'en ont pas ; l\'automatisation ne change pas', async () => {
  const home = mkdtempSync(join(tmpdir(), 'moteur-petits-'));
  const f = (async () => { throw new Error('aucune sortie réseau dans cet essai'); }) as unknown as typeof fetch;
  const d = new Talos(home, { fetch: f }); setDraupnir(d);
  try {
    const w = d.save({ name: 'Relevé', active: false, nodes: [
      { name: 'Go', type: 'déclencheur.manuel', params: {} },
      { name: 'Fiche', type: 'données.définir', params: { champs: '{"ville":"Kani"}' } },
      { name: 'Suite', type: 'données.définir', params: { champs: '{"fin":"oui"}' } },
    ], connections: { Go: [[{ node: 'Fiche' }]], Fiche: [[{ node: 'Suite' }]] } } as never);
    const avant = JSON.stringify(d.get(w.id));
    type R = { ok: boolean; run: { status: string; nodes: Record<string, unknown>; error?: string } };
    // Comme la page : « Exécuter ce bloc seul ».
    const r = await draupnirPost({} as never, '/api/draupnir/run', { id: w.id, start: 'Fiche', stopAfter: 'Fiche', items: [{ json: {} }], pinned: { Go: [{}] } }) as R;
    assert.equal(r.run.status, 'succès', r.run.error); assert.deepEqual(Object.keys(r.run.nodes), ['Fiche']);
    const l1 = d.runs(w.id, 1)[0] as unknown as Record<string, unknown>;
    assert.equal(l1.seul, 'Fiche', 'la ligne d\'historique dit qu\'un seul bloc a tourné, et lequel');
    // « Tester » (tout), « Tester jusqu'ici », et un départ du déclencheur arrêté sur lui : pas de marque.
    await draupnirPost({} as never, '/api/draupnir/run', { id: w.id });
    assert.equal('seul' in (d.runs(w.id, 1)[0] as object), false, '« Tester »');
    await draupnirPost({} as never, '/api/draupnir/run', { id: w.id, stopAfter: 'Fiche' });
    assert.equal('seul' in (d.runs(w.id, 1)[0] as object), false, '« Tester jusqu\'ici »');
    await draupnirPost({} as never, '/api/draupnir/run', { id: w.id, start: 'Go', stopAfter: 'Go' });
    assert.equal('seul' in (d.runs(w.id, 1)[0] as object), false, 'parti du déclencheur');
    await d.run(w.id, [], 'manuel');
    assert.equal('seul' in (d.runs(w.id, 1)[0] as object), false, 'exécution normale');
    assert.equal(d.runs(w.id, 20).length, 5);
    assert.equal(JSON.stringify(d.get(w.id)), avant, 'l\'automatisation enregistrée ne change pas');
  } finally { d.stop(); setDraupnir(undefined); rmSync(home, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ dernier passage (logique de la page)
type Run = { count: number; items: Array<Record<string, unknown>>; ms?: number; error?: string; outputs?: number[] };
type Wf = { id?: string; name?: string; nodes: Array<{ name: string; type: string; params: Record<string, unknown>; position?: number[] }>; connections: Record<string, Array<Array<{ node: string }>>> };
interface Logique { dernierPassage: (runs: unknown[], flow: Wf, cat: (t: string) => unknown) => { last: { nodes: Record<string, Run> } | null; seuls: Set<string> } }
function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document, URL });
  return win.OdinFlows!.logique;
}
const CAT = [
  { type: 'déclencheur.manuel', label: 'Lancer à la main', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'données.définir', label: 'Définir des champs', group: 'Données', params: [{ key: 'champs', label: 'Champs', kind: 'textarea' }] },
];
const catDe = (t: string) => CAT.find((c) => c.type === t);
const FLOW: Wf = { id: 'f1', name: 'Météo', nodes: [
  { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
  { name: 'Lire', type: 'données.définir', params: { champs: '{"ville":"Kani"}' }, position: [340, 160] },
  { name: 'Calcul', type: 'données.définir', params: { champs: '{"a":"1"}' }, position: [620, 160] },
], connections: { Lancer: [[{ node: 'Lire' }]], Lire: [[{ node: 'Calcul' }]] } };
const ENTIER = { trigger: 'Lancer', mode: 'test', status: 'succès', startedAt: '2026-11-18T08:00:00.000Z', ms: 3, nodes: {
  Lancer: { count: 1, items: [{}], ms: 0, outputs: [1] },
  Lire: { count: 1, items: [{ ville: 'Kani' }], ms: 1, outputs: [1] },
} as Record<string, Run> };
const SEUL = { trigger: 'Calcul', seul: 'Calcul', mode: 'test', status: 'succès', startedAt: '2026-11-18T09:00:00.000Z', ms: 2, nodes: { Calcul: { count: 1, items: [{ a: '1' }], outputs: [1] } } };

test('dernier passage : il lit la marque ; une ligne d\'avant, sans marque, se lit comme avant', () => {
  const L = logique();
  const r = L.dernierPassage([SEUL, ENTIER], FLOW, catDe);
  assert.deepEqual(Object.keys(r.last!.nodes).sort(), ['Calcul', 'Lancer', 'Lire']); assert.deepEqual([...r.seuls], ['Calcul']);
  // Sans marque (ligne d'avant ce lot) : même résultat qu'avant.
  const { seul: _s, ...ancien } = SEUL;
  const a = L.dernierPassage([ancien, ENTIER], FLOW, catDe);
  assert.deepEqual(ici(a.last), ici(r.last)); assert.deepEqual([...a.seuls], ['Calcul']);
  // Marqué mais parti d'un nom qui n'est plus un bloc (renommé depuis) : il ne devient pas le dernier passage entier.
  const renomme = L.dernierPassage([{ ...SEUL, trigger: 'Ancien', seul: 'Ancien', nodes: { Ancien: { count: 1, items: [{}] } } }, ENTIER], FLOW, catDe);
  assert.deepEqual(ici(renomme.last!.nodes), ici(ENTIER.nodes)); assert.equal(renomme.seuls.size, 0);
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

/** La page « Talos » ouverte sur FLOW, avec cet historique ; → les lignes de « Dernières exécutions ». */
async function lignes(runs: unknown[]): Promise<Array<{ pastille: string; classe: string; texte: string }>> {
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
  const reponses: Record<string, () => unknown> = {
    '/api/draupnir/state': () => ({ ok: true, flows: [], templates: [], catalog: CAT, dossiers: [] }),
    '/api/draupnir/flow': () => ({ ok: true, flow: ici(FLOW), outputs: {}, runs: ici(runs), versions: [] }),
  };
  const fetch = async (chemin: string) => { const f = reponses[chemin.split('?')[0]]; return { status: 200, ok: true, json: async () => (f ? f() : { ok: false, error: 'inconnu' }) }; };
  const window: Record<string, unknown> = { OdinDialog: { confirm: async () => false, alert: async () => {}, prompt: async () => null }, getSelection: () => null };
  vm.runInNewContext(FLOWS, { window, document, fetch, URL, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, clearTimeout, console });
  await (window.OdinFlows as { edit: (id: string) => Promise<void> }).edit(FLOW.id!); await attendre();
  return body.querySelectorAll('.dr-runs li').map((li) => { const p = li.querySelector('.pill')!; return { pastille: p.textContent, classe: p.className, texte: li.textContent }; });
}

test('page : « Dernières exécutions » lit « bloc seul : <nom> » ; une ligne sans marque s\'affiche comme avant', async () => {
  const rate = { ...SEUL, startedAt: '2026-11-18T10:00:00.000Z', status: 'erreur', error: 'champ manquant', nodes: { Calcul: { count: 0, items: [], error: 'champ manquant' } } };
  const { seul: _s, ...ancien } = SEUL;
  const l = await lignes([rate, SEUL, ancien, ENTIER]);
  assert.equal(l.length, 4);
  assert.equal(l[0].pastille, 'bloc seul : Calcul'); assert.match(l[0].classe, /\bbad\b/); assert.match(l[0].texte, / · test · 2 ms · erreur · champ manquant$/);
  assert.equal(l[1].pastille, 'bloc seul : Calcul'); assert.match(l[1].classe, /\bgood\b/); assert.doesNotMatch(l[1].texte, /succès/, 'pas de « succès » qui laisse croire que tout a tourné');
  assert.equal(l[2].pastille, 'succès', 'ligne d\'avant ce lot : comme avant'); assert.match(l[2].texte, /^succès .* · test · 2 ms$/);
  assert.equal(l[3].pastille, 'succès'); assert.match(l[3].texte, / · test · 3 ms$/);
  // Un nom de bloc est du texte, jamais du balisage.
  const x = await lignes([{ ...SEUL, seul: '<b>Calcul</b>' }]);
  assert.equal(x[0].pastille, 'bloc seul : <b>Calcul</b>');
});
