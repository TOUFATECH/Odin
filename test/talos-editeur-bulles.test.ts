// Talos, l'éditeur à nœuds (src/web/flows.js) : les bulles chiffrées après un test (lot 5b du plan des maquettes).
// - Logique (sans document) : la bulle d'un bloc d'après ce que le moteur rend déjà (count, error, outputs) : aucune
//   sans passage, le nombre d'éléments, « ! » en cas d'erreur, le nombre par sortie quand il se sait ; le nom lisible
//   vient du dictionnaire en tête de fichier.
// - Zones (fonctions pures) : la bulle fait 44 px à l'écran à tous les zooms et ne recouvre ni le « ⋯ », ni la marque
//   de note, ni la pastille des réglages manquants, ni le « + », ni les ronds à relier.
// - Page (petit document simulé, aucun navigateur) : après « Tester », une bulle sur chaque bloc qui a tourné, aucune
//   sur les autres ; une bulle rouge « ! » sur le bloc en erreur ; un vrai bouton nommé ; au clavier, elle choisit le bloc
//   et montre « Dernier passage » ; un bloc exécuté seul garde son rond (pas de deuxième nombre).
// Valeurs neutres seulement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

type Rect = { g: number; h: number; d: number; b: number };
type Run = { count: number; items: Array<Record<string, unknown>>; ms?: number; error?: string; outputs?: number[] };
type Bulle = { texte: string; erreur: boolean; nom: string; sorties: Array<{ sortie: string; n: number }> } | null;
interface Logique {
  MOTS: Record<string, string>;
  bulleDe: (nom: string, run: Run | undefined, sorties?: string[]) => Bulle;
  zoneBulle: (k?: number, m?: number) => Rect;
  zonesBloc: (k?: number, m?: number) => { menu: Rect; plus: Rect; entree: Rect; sorties: Rect[]; nom: Rect };
  zoneToucher: (k: number, px?: number) => number;
}
function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document, URL });
  return win.OdinFlows!.logique;
}
const recouvre = (a: Rect, b: Rect) => a.g < b.d && b.g < a.d && a.h < b.b && b.h < a.b;
const ZOOMS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.4, 1.6];

// ------------------------------------------------------------------ logique
test('logique : la bulle d\'un bloc vient de ce que le moteur rend (aucune sans passage, le nombre, « ! », le nombre par sortie)', () => {
  const L = logique();
  assert.equal(L.bulleDe('A', undefined), null, 'un bloc qui n\'a pas tourné : pas de bulle');
  const un = L.bulleDe('A', { count: 3, items: [], outputs: [3] }, ['sortie'])!;
  assert.equal(un.texte, '3'); assert.equal(un.erreur, false); assert.deepEqual(ici(un.sorties), [], 'une seule sortie : pas de détail');
  const zero = L.bulleDe('A', { count: 0, items: [], outputs: [0] }, ['sortie'])!;
  assert.equal(zero.texte, '0', 'un bloc qui a tourné sans rien rendre a quand même sa bulle');
  const ko = L.bulleDe('A', { count: 0, items: [], error: 'réglage illisible' }, ['sortie'])!;
  assert.equal(ko.texte, '!'); assert.equal(ko.erreur, true); assert.match(ko.nom, /réglage illisible/);
  const si = L.bulleDe('Test', { count: 3, items: [], outputs: [1, 2] }, ['oui', 'non'])!;
  assert.equal(si.texte, '3'); assert.deepEqual(ici(si.sorties), [{ sortie: 'oui', n: 1 }, { sortie: 'non', n: 2 }]);
  assert.match(si.nom, /oui/); assert.match(si.nom, /non/);
  // Plusieurs passages (le total ne correspond plus aux sorties) : on ne sait pas, pas de détail inventé.
  assert.deepEqual(ici(L.bulleDe('Test', { count: 5, items: [], outputs: [1, 2] }, ['oui', 'non'])!.sorties), []);
});

test('logique : le nom lisible de la bulle vient du dictionnaire en tête de fichier (aucune phrase en dur à côté)', () => {
  const L = logique();
  for (const k of ['bulle.elements', 'bulle.erreur', 'bulle.sortie', 'bulle.detail']) assert.equal(typeof L.MOTS[k], 'string', k);
  const remplir = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_m, x: string) => String(v[x] ?? ''));
  assert.equal(L.bulleDe('Bloc', { count: 2, items: [] })!.nom, remplir(L.MOTS['bulle.elements'], { b: 'Bloc', n: 2, s: 's' }));
  assert.equal(L.bulleDe('Bloc', { count: 1, items: [] })!.nom, remplir(L.MOTS['bulle.elements'], { b: 'Bloc', n: 1, s: '' }));
  assert.equal(L.bulleDe('Bloc', { count: 0, items: [], error: 'x' })!.nom, remplir(L.MOTS['bulle.erreur'], { b: 'Bloc', e: 'x' }));
  // Le dictionnaire est en tête : avant le premier dessin de bloc.
  assert.ok(FLOWS.indexOf('const MOTS') > 0 && FLOWS.indexOf('const MOTS') < FLOWS.indexOf('function nodeEl'));
});

test('zones : la bulle fait 44 px à l\'écran et ne recouvre ni le « ⋯ », ni le « + », ni les ronds à relier, à tous les zooms et pour 1 à 4 sorties', () => {
  const L = logique();
  for (const k of ZOOMS) for (const m of [1, 2, 3, 4]) {
    const b = L.zoneBulle(k, m), z = L.zonesBloc(k, m), dit = `zoom ${k}, ${m} sortie(s)`;
    assert.ok((b.d - b.g) * k >= 44 - 1e-9 && (b.b - b.h) * k >= 44 - 1e-9, `${dit} : 44 px à l'écran`);
    assert.equal(recouvre(b, z.menu), false, `${dit} : « ⋯ » ${JSON.stringify(z.menu)} / bulle ${JSON.stringify(b)}`);
    assert.equal(recouvre(b, z.plus), false, `${dit} : « + »`);
    assert.equal(recouvre(b, z.entree), false, `${dit} : rond d'entrée`);
    for (const s of z.sorties) assert.equal(recouvre(b, s), false, `${dit} : sortie ${JSON.stringify(s)}`);
    assert.equal(recouvre(b, z.nom), false, `${dit} : le nom du bloc`);
  }
});

// ------------------------------------------------------------------ un document minimal (comme talos-editeur-bloc-seul)
type Ecoute = (e: Record<string, unknown>) => unknown;
let racine: Noeud; let actif: Noeud | null = null;
class Noeud {
  nodeType: number; tagName: string; parent: Noeud | null = null; enfants: Array<Noeud | null> = [];
  attrs: Record<string, string> = {}; ecoutes: Record<string, Ecoute[]> = {}; style: Record<string, string> & { setProperty?: () => void } = {};
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
  insertAdjacentElement() { return null; }
  remove() { this.parent?.retirer(this); }
  setAttribute(k: string, v: unknown) { if (k === 'class') this.className = String(v); else this.attrs[k] = String(v); }
  getAttribute(k: string) { return k === 'class' ? this.className : this.attrs[k] ?? null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  addEventListener(t: string, f: Ecoute) { (this.ecoutes[t] ??= []).push(f); }
  removeEventListener(t: string, f: Ecoute) { this.ecoutes[t] = (this.ecoutes[t] ?? []).filter((x) => x !== f); }
  async emettre(t: string, plus: Record<string, unknown> = {}) {
    const e = { type: t, target: this, preventDefault() {}, stopPropagation() {}, timeStamp: Date.now(), ...plus };
    for (let n: Noeud | null = this; n; n = n.parent) for (const f of [...(n.ecoutes[t] ?? [])]) await f({ ...e, currentTarget: n });
  }
  focus() { actif = this; } setPointerCapture() {} releasePointerCapture() {}
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
const attendre = () => new Promise((ok) => setTimeout(ok, 20));

const CAT = [
  { type: 'déclencheur.manuel', label: 'Lancer à la main', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'données.définir', label: 'Définir des champs', group: 'Données', params: [{ key: 'champs', label: 'Champs', kind: 'textarea' }] },
  { type: 'logique.si', label: 'Si', group: 'Logique', outputs: ['oui', 'non'], params: [{ key: 'condition', label: 'Condition', kind: 'text', default: '' }] },
  { type: 'temps.attendre', label: 'Attendre', group: 'Logique', params: [{ key: 'secondes', label: 'Secondes', kind: 'number', default: 1 }] },
];
// Un déclencheur, un bloc, un « Si » à deux sorties, deux blocs après (un par sortie), un bloc jamais relié, un bloc avec une note.
const FLOW = { id: 'b1', name: 'Bulles', active: false, nodes: [
  { name: 'Départ', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
  { name: 'Champs', type: 'données.définir', params: { champs: '{"a":1}' }, position: [340, 160], note: 'une note' },
  { name: 'Test', type: 'logique.si', params: { condition: '' }, position: [620, 160] },
  { name: 'Branche A', type: 'temps.attendre', params: { secondes: 1 }, position: [900, 60] },
  { name: 'Branche B', type: 'temps.attendre', params: { secondes: 1 }, position: [900, 270] },
  { name: 'Seul', type: 'temps.attendre', params: { secondes: 1 }, position: [340, 400] },
], connections: { Départ: [[{ node: 'Champs' }]], Champs: [[{ node: 'Test' }]], Test: [[{ node: 'Branche A' }], [{ node: 'Branche B' }]] } };
const PASSAGE = { status: 'succès', ms: 3, nodes: {
  Départ: { count: 1, items: [{}], ms: 0, outputs: [1] },
  Champs: { count: 3, items: [{ a: 1 }, { a: 2 }, { a: 3 }], ms: 1, outputs: [3] },
  Test: { count: 3, items: [{ a: 1 }, { a: 2 }, { a: 3 }], ms: 1, outputs: [1, 2] },
  'Branche A': { count: 1, items: [{ a: 1 }], ms: 1, outputs: [1] },
  'Branche B': { count: 2, items: [{ a: 2 }, { a: 3 }], ms: 1, outputs: [2] },
} as Record<string, Run> };
const ERREUR = { status: 'erreur', ms: 2, error: 'réglage illisible', failedNode: 'Champs', nodes: {
  Départ: { count: 1, items: [{}], ms: 0, outputs: [1] },
  Champs: { count: 0, items: [], ms: 1, error: 'réglage illisible' },
} as Record<string, Run> };

async function page(o: { runs?: unknown[]; run?: unknown; flow?: unknown; outputs?: Record<string, string[]>; outputsApres?: Record<string, string[]> } = {}) {
  racine = new Noeud('html'); actif = null;
  const vue = new Noeud('section'); vue.setAttribute('id', 'v-flows');
  const head = new Noeud('div'); head.className = 'head'; const h1 = new Noeud('h1'); const sub = new Noeud('p'); sub.className = 'sub'; head.append(h1, sub);
  const body = new Noeud('div'); body.className = 'body'; vue.append(head, body); racine.append(vue);
  const tete = new Noeud('head');
  const document = {
    readyState: 'complete', head: tete, body: racine, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), querySelectorAll: (s: string) => racine.querySelectorAll(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
    addEventListener() {}, removeEventListener() {},
  };
  let lancee = false; // (après « Tester » : les sorties que le serveur dit pour l'automatisation enregistrée)
  const reponses: Record<string, (c?: Record<string, unknown>) => unknown> = {
    '/api/draupnir/state': () => ({ ok: true, flows: [], templates: [], catalog: CAT, dossiers: [] }),
    '/api/draupnir/flow': () => ({ ok: true, flow: ici(o.flow ?? FLOW), outputs: ici((lancee ? o.outputsApres : undefined) ?? o.outputs ?? {}), runs: ici(o.runs ?? []), versions: [] }),
    '/api/draupnir/save': (c) => ({ ok: true, flow: c?.flow }),
    '/api/draupnir/run': () => { lancee = true; return { ok: true, run: ici(o.run ?? PASSAGE) }; },
  };
  const fetch = async (chemin: string, x?: { body?: string }) => {
    const corps = x?.body ? JSON.parse(x.body) as Record<string, unknown> : undefined;
    const f = reponses[chemin.split('?')[0]];
    return { status: 200, ok: true, json: async () => (f ? f(corps) : { ok: false, error: 'inconnu' }) };
  };
  const window: Record<string, unknown> = { OdinDialog: { confirm: async () => true, alert: async () => {}, prompt: async () => null }, getSelection: () => null };
  const ctx = { window, document, fetch, URL, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, clearTimeout, console };
  vm.runInNewContext(FLOWS, ctx);
  await (window.OdinFlows as { edit: (id: string) => Promise<void> }).edit((o.flow as { id?: string } | undefined)?.id ?? FLOW.id); await attendre();
  const css = tete.querySelectorAll('style').map((s) => s.textContent).join('\n');
  const regle = (sel: string) => new RegExp(`(?:^|[}\\n])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const bloc = (nom: string) => body.querySelectorAll('.dr-node').find((x) => (x.getAttribute('aria-label') ?? '').startsWith(`${nom} (`))!;
  const bouton = (texte: string) => body.querySelectorAll('button').find((b) => b.textContent.trim() === texte)!;
  const tester = async () => { await bouton('Tester').emettre('click'); await attendre(); };
  return { body, css, regle, bloc, bouton, tester };
}
const bulles = (d: Noeud) => d.querySelectorAll('.dr-bulle');

test('page : avant tout test, aucune bulle ; après « Tester », une bulle sur chaque bloc qui a tourné, aucune sur les autres', async () => {
  const p = await page();
  assert.equal(p.body.querySelectorAll('.dr-bulle').length, 0, 'jamais lancée : aucune bulle');
  await p.tester();
  for (const [nom, n] of [['Départ', '1'], ['Champs', '3'], ['Test', '3'], ['Branche A', '1'], ['Branche B', '2']]) {
    const b = bulles(p.bloc(nom));
    assert.equal(b.length, 1, `une bulle sur ${nom}`);
    assert.equal(b[0].textContent, n, `${nom} : le nombre d'éléments`);
    assert.equal(b[0].classList.contains('bad'), false);
  }
  assert.equal(bulles(p.bloc('Seul')).length, 0, 'un bloc qui n\'a pas tourné n\'a pas de bulle');
});

test('page : un bloc à plusieurs sorties montre le nombre passé par chaque sortie, près de son nom', async () => {
  const p = await page();
  await p.tester();
  const test = p.bloc('Test');
  const parSortie = test.querySelectorAll('.dr-port').filter((x) => x.classList.contains('out')).map((x) => x.querySelector('.dr-pn')?.textContent ?? null);
  assert.deepEqual(parSortie, ['1', '2'], '« oui » : 1, « non » : 2');
  assert.match(bulles(test)[0].getAttribute('aria-label') ?? '', /oui[^,]*1/);
  assert.equal(p.bloc('Champs').querySelector('.dr-pn'), null, 'une seule sortie : pas de nombre à côté');
});

test('page : en cas d\'erreur, une bulle rouge « ! » sur le bloc en erreur ; le début du message reste sous le nom ; rien sur les blocs d\'après', async () => {
  const p = await page({ run: ERREUR });
  await p.tester();
  const b = bulles(p.bloc('Champs'));
  assert.equal(b.length, 1); assert.equal(b[0].textContent, '!'); assert.ok(b[0].classList.contains('bad'));
  assert.match(b[0].getAttribute('aria-label') ?? '', /réglage illisible/);
  assert.match(p.bloc('Champs').querySelector('.dr-cnt')!.textContent, /réglage illisible/);
  assert.equal(bulles(p.bloc('Départ'))[0].textContent, '1');
  for (const nom of ['Test', 'Branche A', 'Branche B', 'Seul']) assert.equal(bulles(p.bloc(nom)).length, 0, nom);
  assert.match(p.regle('.dr-bulle.bad span'), /background:var\(--bad\)/, 'rouge');
});

test('page : la bulle est un vrai bouton de 44 px, nommé, placé à droite de la pastille, hors du « ⋯ » et de la marque de note', async () => {
  const L = logique(), p = await page();
  await p.tester();
  const b = bulles(p.bloc('Champs'))[0];
  assert.equal(b.tagName, 'BUTTON'); assert.equal(b.getAttribute('type'), 'button');
  assert.match(b.getAttribute('aria-label') ?? '', /Champs/); assert.match(b.getAttribute('aria-label') ?? '', /3/);
  assert.equal(b.getAttribute('aria-hidden'), null, 'lue par le lecteur d\'écran');
  const r = p.regle('.dr-bulle');
  assert.match(r, /position:absolute/);
  assert.match(r, /width:var\(--dr-z,44px\)/); assert.match(r, /height:var\(--dr-z,44px\)/, 'une zone de 44 px à l\'écran, quel que soit le zoom');
  assert.doesNotMatch(r, /pointer-events:none/);
  // La règle de style dit la même place que zoneBulle : à gauche, le plus grand de 142 px et du bord droit du « ⋯ ».
  const g = /left:max\((\d+)px,calc\(95px \+ var\(--dr-z,44px\) \/ 2\)\)/.exec(r);
  assert.ok(g, `left de la bulle : ${r}`); assert.equal(Number(g![1]), L.zoneBulle(1).g);
  // La marque de note et la pastille des réglages manquants, lues dans leurs règles : jamais sous la bulle.
  const px = (t: string, k: string) => Number(new RegExp(`(?:^|[;{])${k}:(-?[\\d.]+)px`).exec(t)?.[1]);
  const rect = (t: string): Rect => ({ g: px(t, 'left'), h: px(t, 'top'), d: px(t, 'left') + px(t, 'width'), b: px(t, 'top') + px(t, 'height') });
  const note = rect(p.regle('.dr-note-m')), manque = rect(p.regle('.dr-node .dr-manque'));
  assert.ok(Object.values(note).every(Number.isFinite) && Object.values(manque).every(Number.isFinite));
  for (const k of ZOOMS) for (const m of [1, 2, 3]) {
    assert.equal(recouvre(L.zoneBulle(k, m), note), false, `zoom ${k} : marque de note`);
    assert.equal(recouvre(L.zoneBulle(k, m), manque), false, `zoom ${k} : pastille des réglages manquants`);
  }
  assert.ok(p.bloc('Champs').querySelector('.dr-note-m'), 'la marque de note est toujours là');
  assert.ok(p.bloc('Champs').querySelector('.dr-mb'), 'le « ⋯ » aussi');
});

test('page : au clavier, la bulle choisit son bloc et montre « Dernier passage » ; le focus reste sur la bulle', async () => {
  const p = await page();
  await p.tester();
  await bulles(p.bloc('Branche B'))[0].emettre('click', { detail: 0 }); await attendre();
  assert.ok(p.bloc('Branche B').classList.contains('sel'), 'le bloc est choisi');
  const side = p.body.querySelector('#drSide')!;
  assert.ok(side.querySelectorAll('h2').some((h) => h.textContent === 'Dernier passage'), 'le dernier passage est montré');
  assert.equal(actif, bulles(p.bloc('Branche B'))[0], 'le focus est sur la bulle redessinée');
});

test('page : à la réouverture, la bulle suit le dernier passage ; un bloc exécuté seul garde son rond, sans deuxième nombre', async () => {
  const seul = { seul: 'Seul', status: 'succès', nodes: { Seul: { count: 4, items: [], outputs: [4] } } };
  const p = await page({ runs: [seul, { ...PASSAGE, trigger: 'Départ' }] });
  assert.equal(bulles(p.bloc('Champs'))[0]?.textContent, '3', 'la bulle du dernier passage, sans relancer');
  assert.equal(p.bloc('Seul').querySelector('.dr-seul')?.textContent, '4', 'le rond « exécuté seul » reste');
  assert.equal(bulles(p.bloc('Seul')).length, 0, 'pas de deuxième nombre sur le même bloc');
});

// ------------------------------------------------------------------ relecture : la bulle dit le vrai, et seulement pour le bloc qui a tourné
test('relecture : un bloc retiré puis remis sous le même nom n\'hérite pas de la bulle de l\'ancien (il n\'a pas tourné)', async () => {
  const flow = { ...ici(FLOW), nodes: [...ici(FLOW).nodes.filter((n) => n.name !== 'Branche A'), { name: 'Attendre', type: 'temps.attendre', params: { secondes: 1 }, position: [900, 60] }],
    connections: { ...ici(FLOW).connections, Test: [[{ node: 'Attendre' }], [{ node: 'Branche B' }]] } };
  const run = { ...ici(PASSAGE), nodes: { ...ici(PASSAGE).nodes, Attendre: { count: 1, items: [{ a: 1 }], ms: 1, outputs: [1] } } };
  const p = await page({ flow, run });
  await p.tester();
  assert.equal(bulles(p.bloc('Attendre'))[0]?.textContent, '1', 'le bloc qui a tourné a sa bulle');
  await p.bloc('Attendre').emettre('keydown', { key: 'Delete' }); await attendre();
  assert.equal(p.body.querySelectorAll('.dr-node').some((x) => (x.getAttribute('aria-label') ?? '').startsWith('Attendre (')), false, 'retiré');
  await p.bouton('Attendre').emettre('click'); await attendre(); // (la colonne d'ajout : un bloc neuf, sous le même nom)
  const neuf = p.bloc('Attendre');
  assert.ok(neuf, 'le bloc neuf est là');
  assert.equal(bulles(neuf).length, 0, 'un bloc neuf, jamais lancé : aucune bulle');
  assert.equal(neuf.querySelector('.dr-cnt'), null, 'ni ligne de résultat');
  assert.equal(neuf.classList.contains('ok'), false, 'ni marque de réussite');
  assert.equal(bulles(p.bloc('Champs'))[0]?.textContent, '3', 'les autres blocs gardent la leur');
});

test('relecture : après « Tester », le nombre par sortie suit les sorties de l\'automatisation qui a tourné (pas celles d\'avant)', async () => {
  // Les cas d'un aiguillage ont changé d'ordre avant « Tester » : le serveur dit les sorties nouvelles ; le moteur compte dans cet ordre.
  const p = await page({ outputs: { Test: ['oui', 'non'] }, outputsApres: { Test: ['non', 'oui'] } });
  await p.tester();
  const test = p.bloc('Test');
  const ports = test.querySelectorAll('.dr-port').filter((x) => x.classList.contains('out')).map((x) => x.querySelector('.dr-pl')?.textContent ?? '');
  assert.deepEqual(ports, ['non1', 'oui2'], 'chaque sortie a son nom de maintenant et son nombre');
  assert.match(bulles(test)[0].getAttribute('aria-label') ?? '', /non : 1, oui : 2/);
});

test('relecture : à la réouverture, une automatisation changée depuis le dernier passage ne montre pas de nombre par sortie (le total reste)', async () => {
  const flow = { ...ici(FLOW), updatedAt: '2026-11-20T10:00:00.000Z' };
  const p = await page({ flow, runs: [{ ...ici(PASSAGE), trigger: 'Départ', startedAt: '2026-11-20T09:00:00.000Z' }] });
  const test = p.bloc('Test');
  assert.equal(bulles(test)[0]?.textContent, '3', 'le total du dernier passage');
  assert.equal(test.querySelector('.dr-pn'), null, 'pas de nombre par sortie : les sorties ont pu changer');
  assert.doesNotMatch(bulles(test)[0].getAttribute('aria-label') ?? '', /oui|non/);
  // Pas changée depuis : le détail est sûr.
  const q = await page({ flow: { ...flow, updatedAt: '2026-11-20T08:00:00.000Z' }, runs: [{ ...ici(PASSAGE), trigger: 'Départ', startedAt: '2026-11-20T09:00:00.000Z' }] });
  assert.equal(q.bloc('Test').querySelectorAll('.dr-pn').length, 2);
});

test('relecture : le bloc choisi reste visible comme choisi après un test ; la ligne de résultat n\'est pas écrite dans la couleur pâle seule', async () => {
  const p = await page();
  await p.tester();
  await bulles(p.bloc('Champs'))[0].emettre('click', { detail: 0 }); await attendre();
  assert.ok(p.bloc('Champs').classList.contains('sel') && p.bloc('Champs').classList.contains('ok'));
  // Une règle pour « choisi ET passé » (sinon celle de « passé », écrite après, cache l'anneau du choix), qui garde l'accent.
  assert.match(p.regle('.dr-node.sel.ok .dr-rond'), /var\(--accent\)/);
  assert.match(p.regle('.dr-node.sel.err .dr-rond'), /var\(--accent\)/);
  assert.ok(p.css.indexOf('.dr-node.sel.ok .dr-rond') > p.css.indexOf('.dr-node.ok .dr-rond'), 'écrite après');
  // La ligne de résultat : mêlée à l'encre (le vert ou le rouge seuls faisaient 3,6 à 4,4:1 sur le fond).
  const cnt = /\.dr-node \.dr-cnt\{([^}]*)\}/.exec(p.css)?.[1] ?? '';
  assert.match(cnt, /color:color-mix\(in srgb,var\(--good\) \d+%,var\(--ink\)\)/);
  assert.match(p.regle('.dr-node.err .dr-cnt'), /color:color-mix\(in srgb,var\(--bad\) \d+%,var\(--ink\)\)/);
});

test('relecture : le nombre de la bulle s\'écrit à la manière de la langue de la page', () => {
  const L = logique();
  const b = L.bulleDe('A', { count: 12345, items: [] })!;
  assert.equal(b.texte, (12345).toLocaleString(), 'le nombre, groupé selon la langue (rien en dur)');
});
