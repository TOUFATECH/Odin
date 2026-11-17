// Talos : la page des automatisations (src/web/flows.js) utilise bien les dossiers (src/web/pages/talos-dossiers.js).
// - La liste est dessinée par OdinTalosDossiers.monter (sinon, et seulement sinon, l'ancienne grille).
// - Le premier enregistrement demande le dossier (OdinTalosDossiers.choisir) ; « Annuler » n'enregistre rien.
// - La barre de l'éditeur montre le choix « Dossier » (OdinTalosDossiers.barre), aussi juste après le premier enregistrement.
// - « Partir de zéro » n'écrit jamais « null » sous le schéma.
// - « Créer avec Odin », un modèle et un import proposent aussi le dossier.
// flows.js est joué dans un petit document simulé (aucun navigateur, aucun paquet).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');

// ------------------------------------------------------------------ un document minimal
type Ecoute = (e: Record<string, unknown>) => unknown;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Array<Noeud | null> = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> = {};
  className = ''; value = ''; hidden = false; disabled = false; checked = false; texte = '';
  classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: (c: string) => this.className.split(/\s+/).includes(c) };
  dataset: Record<string, string> = {};
  constructor(tag: string, type = 1) { this.tagName = tag.toUpperCase(); this.nodeType = type; }
  get id() { return this.attrs.id ?? ''; }
  get children() { return this.enfants.filter((x): x is Noeud => x !== null && x.nodeType === 1); }
  get textContent(): string { return this.nodeType === 3 ? this.texte : this.enfants.map((x) => (x === null ? 'null' : x.textContent)).join(''); }
  set textContent(t: string) { this.enfants = []; if (t) this.ajouter(new Texte(String(t))); }
  get isConnected() { let n: Noeud | null = this; while (n.parent) n = n.parent; return n === racine; }
  private ajouter(k: Noeud | null, debut = false) {
    // Le vrai DOM écrit « null » en clair : on le garde tel quel pour pouvoir le voir.
    const n = k === null ? null : typeof k === 'object' ? k : new Texte(String(k));
    if (n) { n.parent?.retirer(n); n.parent = this; }
    if (debut) this.enfants.unshift(n); else this.enfants.push(n);
  }
  retirer(n: Noeud) { this.enfants = this.enfants.filter((x) => x !== n); n.parent = null; }
  append(...ks: Array<Noeud | null>) { for (const k of ks) this.ajouter(k); }
  appendChild(k: Noeud) { this.ajouter(k); return k; }
  prepend(...ks: Array<Noeud | null>) { for (const k of ks.reverse()) this.ajouter(k, true); }
  replaceChildren(...ks: Array<Noeud | null>) { for (const e of this.enfants) if (e) e.parent = null; this.enfants = []; this.append(...ks); }
  remove() { this.parent?.retirer(this); }
  replaceWith(n: Noeud) { const p = this.parent; if (!p) return; const i = p.enfants.indexOf(this); n.parent?.retirer(n); p.enfants[i] = n; n.parent = p; this.parent = null; }
  insertAdjacentElement(ou: string, n: Noeud) {
    const p = this.parent; if (!p || ou !== 'afterend') { this.append(n); return n; }
    n.parent?.retirer(n); p.enfants.splice(p.enfants.indexOf(this) + 1, 0, n); n.parent = p; return n;
  }
  setAttribute(k: string, v: unknown) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  removeEventListener() {}
  async emettre(t: string) { for (const f of this.ecoutes[t] ?? []) await f({ type: t, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }); }
  focus() {} setPointerCapture() {}
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
    const parts = s.trim().split(/\s+/);
    return this.tous().filter((n) => { if (!n.correspond(parts[parts.length - 1])) return false; let i = parts.length - 2, p = n.parent; while (i >= 0 && p) { if (p.correspond(parts[i])) i--; p = p.parent; } return i < 0; });
  }
  querySelector(s: string) { return this.querySelectorAll(s)[0] ?? null; }
}
class Texte extends Noeud { constructor(t: string) { super('#text', 3); this.texte = t; } }
let racine = new Noeud('html');

// ------------------------------------------------------------------ Odin simulé (serveur et dossiers)
interface Monde { appels: Array<{ chemin: string; corps?: Record<string, unknown> }>; dossiers: Array<{ quoi: string; args: unknown[] }>; choix: unknown; monter: boolean; avecDossiers: boolean }
const FLOW = { id: 'f1', name: 'Bonjour', active: false, nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] }], connections: {} };
async function page(m: Monde) {
  racine = new Noeud('html');
  const doc = new Noeud('#document', 9);
  const vue = new Noeud('section'); vue.setAttribute('id', 'v-flows');
  const head = new Noeud('div'); head.className = 'head'; const h1 = new Noeud('h1'); const sub = new Noeud('p'); sub.className = 'sub'; head.append(h1, sub);
  const body = new Noeud('div'); body.className = 'body'; vue.append(head, body); racine.append(vue);
  const document = {
    readyState: 'complete', head: new Noeud('head'), body: racine,
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), querySelectorAll: (s: string) => racine.querySelectorAll(s), addEventListener: () => {},
  };
  void doc;
  const reponses: Record<string, (c?: Record<string, unknown>) => unknown> = {
    '/api/draupnir/state': () => ({ ok: true, flows: [FLOW], templates: [{ id: 't1', name: 'Modèle', what: '…' }], catalog: [{ type: 'déclencheur.manuel', label: 'Manuel', group: 'Déclencheurs', trigger: true, params: [] }], dossiers: [] }),
    '/api/draupnir/flow': () => ({ ok: true, flow: { ...FLOW }, outputs: {}, runs: [], versions: [] }),
    '/api/draupnir/save': (c) => ({ ok: true, flow: { ...(c?.flow as object), id: 'f2' } }),
    '/api/draupnir/template': () => ({ ok: true, flow: { ...FLOW } }),
    '/api/draupnir/create': () => ({ ok: true, flow: { ...FLOW } }),
    '/api/draupnir/import': () => ({ ok: true, flow: { ...FLOW }, todo: [] }),
    '/api/draupnir/ranger': () => ({ ok: true }), '/api/draupnir/toggle': () => ({ ok: true }),
  };
  const fetch = async (chemin: string, o?: { body?: string }) => {
    const corps = o?.body ? JSON.parse(o.body) as Record<string, unknown> : undefined;
    m.appels.push({ chemin, corps });
    const f = reponses[chemin.split('?')[0]];
    return { status: 200, json: async () => (f ? f(corps) : { ok: false, error: 'inconnu' }) };
  };
  const window: Record<string, unknown> = {
    OdinDialog: { confirm: async () => true, alert: async () => {}, prompt: async () => null },
  };
  if (m.avecDossiers) window.OdinTalosDossiers = {
    monter: (...a: unknown[]) => { m.dossiers.push({ quoi: 'monter', args: a }); return m.monter; },
    choisir: async (...a: unknown[]) => { m.dossiers.push({ quoi: 'choisir', args: a }); return m.choix; },
    barre: (...a: unknown[]) => { m.dossiers.push({ quoi: 'barre', args: a }); const s = new Noeud('span'); s.className = 'td-barre'; return s; },
  };
  vm.runInNewContext(SOURCE, { window, document, fetch, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, console });
  const flows = window.OdinFlows as { liste: () => Promise<void>; edit: (id: string) => Promise<void> };
  return { flows, body, bouton: (texte: string) => body.querySelectorAll('button').find((b) => b.textContent.trim() === texte) };
}
const monde = (o: Partial<Monde> = {}): Monde => ({ appels: [], dossiers: [], choix: null, monter: true, avecDossiers: true, ...o });
const attendre = () => new Promise((ok) => setTimeout(ok, 20));
const quoi = (m: Monde) => m.dossiers.map((d) => d.quoi);

test('liste : les dossiers dessinent la liste, avec ouvrir, lancer et recharger', async () => {
  const m = monde(); const p = await page(m);
  await p.flows.liste();
  assert.deepEqual(quoi(m), ['monter']);
  const [box, st, crochets] = m.dossiers[0].args as [Noeud, { flows: unknown[] }, Record<string, unknown>];
  assert.equal(box, p.body); assert.equal(st.flows.length, 1);
  for (const k of ['ouvrir', 'lancer', 'recharger']) assert.equal(typeof crochets[k], 'function', k);
  assert.equal(p.body.querySelector('.dr-list'), null, 'l\'ancienne grille n\'est pas dessinée en plus');
});

test('liste : sans les dossiers (ou s\'ils renoncent), l\'ancienne grille reste', async () => {
  for (const m of [monde({ avecDossiers: false }), monde({ monter: false })]) {
    const p = await page(m); await p.flows.liste();
    assert.ok(p.body.querySelector('.dr-list'), 'la grille d\'avant');
  }
});

test('« Partir de zéro » : pas de « null » sous le schéma ; le premier enregistrement demande le dossier', async () => {
  const m = monde(); const p = await page(m);
  await p.flows.liste(); await p.bouton('Partir de zéro')!.emettre('click');
  assert.ok(!p.body.enfants.includes(null), 'aucun null passé à replaceChildren');
  assert.doesNotMatch(p.body.textContent, /\bnull\b/);
  assert.equal(p.body.querySelector('.td-barre'), null, 'pas encore enregistrée : pas de choix « Dossier » dans la barre');
  // Annuler : rien n'est enregistré.
  await p.bouton('Enregistrer')!.emettre('click'); await attendre();
  assert.ok(quoi(m).includes('choisir'));
  assert.equal(m.appels.filter((a) => a.chemin === '/api/draupnir/save').length, 0, 'annulé : aucun enregistrement');
  // Un dossier choisi : il part avec l'automatisation, et la barre montre aussitôt le choix « Dossier », juste après le nom.
  m.choix = { dossier: 'd-maison01', active: false };
  await p.bouton('Enregistrer')!.emettre('click'); await attendre();
  const save = m.appels.find((a) => a.chemin === '/api/draupnir/save')!;
  assert.equal((save.corps!.flow as { dossier?: string }).dossier, 'd-maison01');
  assert.equal((save.corps!.flow as { active?: boolean }).active, false);
  const bar = p.body.querySelector('.dr-bar')!, nom = bar.children.findIndex((n) => n.id === 'drName');
  assert.ok(bar.children[nom + 1]?.classList.contains('td-barre'), 'le choix « Dossier » suit le nom');
});

test('éditeur d\'une automatisation enregistrée : le choix « Dossier » est dans la barre', async () => {
  const m = monde(); const p = await page(m);
  await p.flows.edit('f1');
  const b = m.dossiers.find((d) => d.quoi === 'barre');
  assert.ok(b, 'barre() appelée');
  assert.equal((b!.args[0] as { id: string }).id, 'f1');
  assert.equal(typeof b!.args[1], 'function', 'barre reçoit l\'automatisation ouverte');
});

test('un modèle, « Créer avec Odin » et un import proposent aussi le dossier', async () => {
  // Modèle : choisi « Maison », active.
  let m = monde({ choix: { dossier: 'd-maison01', active: true } }); let p = await page(m);
  await p.flows.liste(); await p.bouton('Utiliser')!.emettre('click'); await attendre();
  assert.ok(quoi(m).includes('choisir'), 'modèle');
  assert.deepEqual(m.appels.find((a) => a.chemin === '/api/draupnir/ranger')?.corps, { id: 'f1', dossier: 'd-maison01' });
  assert.deepEqual(m.appels.find((a) => a.chemin === '/api/draupnir/toggle')?.corps, { id: 'f1', on: true });
  // Créer avec Odin : annulé → rien d'autre n'est touché.
  m = monde(); p = await page(m);
  await p.flows.liste(); (p.body.querySelector('#drAsk')!).value = 'chaque matin, la météo';
  await p.body.querySelector('form')!.emettre('submit'); await attendre();
  assert.ok(quoi(m).includes('choisir'), 'Créer avec Odin');
  assert.equal(m.appels.filter((a) => /ranger|toggle/.test(a.chemin)).length, 0, 'annulé : laissée en brouillon, sans dossier');
  // Import.
  m = monde({ choix: { dossier: '', active: false } }); p = await page(m);
  await p.flows.liste(); p.body.querySelector('#drImp')!.value = '{}';
  await p.body.querySelectorAll('form')[1].emettre('submit'); await attendre();
  assert.ok(quoi(m).includes('choisir'), 'import');
  assert.equal(m.appels.filter((a) => /ranger|toggle/.test(a.chemin)).length, 0, 'aucun dossier, brouillon : rien à changer');
});
