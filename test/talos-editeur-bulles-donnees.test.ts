// Talos, l'éditeur à nœuds (src/web/flows.js) : la bulle des données d'un passage (lot 5c du plan des maquettes).
// Il touche la bulle d'un bloc : une bulle plus grande s'ouvre, accrochée au bloc, avec ce que le bloc a rendu (20 éléments
// au plus, ce que le moteur garde déjà), la durée, ou l'erreur entière. Ce qu'il a reçu n'est montré que s'il se déduit
// du bloc d'avant, et c'est dit. Sans passage : « Ce bloc n'a pas encore tourné ». Échap, le bouton « × » (44 px) ou un
// toucher ailleurs la ferment ; le focus revient sur la bulle. Les données sont écrites comme du texte, jamais comme du
// code de page ; elles restent dans la page (ni presse-papiers, ni journal). Le moteur n'est pas touché.
// - Logique (sans document) : passageDe, placeDonnees.
// - Page (petit document simulé, aucun navigateur).
// Valeurs neutres seulement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

type Run = { count: number; items: unknown[]; ms?: number; error?: string; outputs?: number[]; input?: unknown[]; inputCount?: number };
type Element = { titre: string; texte: string; coupe: boolean };
type Passage = { vide: boolean; texte?: string; resume: string; duree: string; erreur: string; elements: Element[]; garde: string; rien: string; entree: { montree: boolean; mention: string; elements: Element[] } };
interface Logique {
  MOTS: Record<string, string>;
  MAX_PASSAGE: number;
  passageDe: (run: Run | undefined, o?: { sorties?: string[]; entree?: unknown; declencheur?: boolean }) => Passage;
  placeDonnees: (cw: number, ch: number, a: { x: number; h: number; b: number }, bw: number, bh: number) => { left: number; top: number; largeur: number; hmax: number; sens: string; pointe: number };
}
function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document, URL, Intl });
  return win.OdinFlows!.logique;
}
const remplir = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_m, x: string) => String(v[x] ?? ''));
const ELEMENTS = (n: number) => Array.from({ length: n }, (_, i) => ({ rang: i + 1 }));
const echappe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------ logique
test('logique : la bulle des données montre ce que le bloc a rendu, 20 éléments au plus, et dit combien sont gardés', () => {
  const L = logique();
  assert.equal(L.MAX_PASSAGE, 20);
  const p = L.passageDe({ count: 25, items: ELEMENTS(25), ms: 12, outputs: [25] });
  assert.equal(p.vide, false);
  assert.equal(p.elements.length, 20, 'jamais plus de 20');
  assert.deepEqual(JSON.parse(p.elements[0].texte), { rang: 1 }); assert.deepEqual(JSON.parse(p.elements[19].texte), { rang: 20 });
  assert.equal(p.elements[0].titre, remplir(L.MOTS['donnees.element'], { i: 1, n: (25).toLocaleString() }));
  assert.equal(p.garde, remplir(L.MOTS['donnees.garde'], { k: 20 }));
  assert.equal(p.resume, remplir(L.MOTS['donnees.resume'], { n: 25, s: 's' }));
  const tout = L.passageDe({ count: 3, items: ELEMENTS(3), ms: 1 });
  assert.equal(tout.elements.length, 3); assert.equal(tout.garde, '', 'tout est gardé : rien à dire');
  const rien = L.passageDe({ count: 0, items: [], ms: 1 });
  assert.equal(rien.elements.length, 0); assert.equal(rien.rien, L.MOTS['donnees.rien']);
});

test('logique : la durée s\'écrit selon la langue de la page (rien en dur), en secondes à partir d\'une seconde', () => {
  const L = logique();
  const f = (v: number, u: string, d: number) => new Intl.NumberFormat(undefined, { style: 'unit', unit: u, unitDisplay: 'short', maximumFractionDigits: d }).format(v);
  assert.equal(L.passageDe({ count: 1, items: [{}], ms: 42 }).duree, remplir(L.MOTS['donnees.duree'], { t: f(42, 'millisecond', 0) }));
  assert.equal(L.passageDe({ count: 1, items: [{}], ms: 1500 }).duree, remplir(L.MOTS['donnees.duree'], { t: f(1.5, 'second', 2) }));
  assert.equal(L.passageDe({ count: 1, items: [{}] }).duree, '', 'sans durée connue : rien d\'inventé');
});

test('logique : l\'erreur est gardée entière ; sans passage, « Ce bloc n\'a pas encore tourné »', () => {
  const L = logique();
  const long = `${'x'.repeat(300)} fin du message`;
  const p = L.passageDe({ count: 0, items: [], error: long });
  assert.equal(p.erreur, long, 'l\'erreur entière, pas coupée');
  assert.equal(p.rien, '', 'en erreur : on ne dit pas « il n\'a rien rendu »');
  const v = L.passageDe(undefined);
  assert.equal(v.vide, true); assert.equal(v.texte, L.MOTS['donnees.vide']); assert.equal(L.MOTS['donnees.vide'], 'Ce bloc n\'a pas encore tourné.');
});

test('logique : ce qu\'il a reçu n\'est montré que s\'il se déduit, et c\'est dit ; un déclencheur ne reçoit rien', () => {
  const L = logique(), run = { count: 1, items: [{ a: 1 }], ms: 1 };
  const non = L.passageDe(run, { entree: null });
  assert.equal(non.entree.montree, false); assert.equal(non.entree.elements.length, 0); assert.equal(non.entree.mention, L.MOTS['donnees.recu.non']);
  const oui = L.passageDe(run, { entree: { ok: true, items: [{ json: { b: 2 } }], tronque: false } });
  assert.equal(oui.entree.montree, true); assert.deepEqual(JSON.parse(oui.entree.elements[0].texte), { b: 2 });
  assert.equal(oui.entree.mention, L.MOTS['donnees.recu.deduit'], 'dit : déduit du bloc d\'avant');
  const coupe = L.passageDe(run, { entree: { ok: true, items: [{ json: {} }], tronque: true } });
  assert.match(coupe.entree.mention, new RegExp(echappe(L.MOTS['donnees.recu.tronque'])));
  const refus = L.passageDe(run, { entree: { ok: false, raison: 'x' } });
  assert.equal(refus.entree.montree, false, 'un refus d\'entreeSeul : rien de montré');
  const trig = L.passageDe(run, { declencheur: true, entree: { ok: true, items: [{ json: {} }] } });
  assert.equal(trig.entree.montree, false); assert.equal(trig.entree.mention, L.MOTS['donnees.recu.declencheur']);
});

test('logique : chaque élément d\'un bloc à plusieurs sorties dit sa sortie quand elle se sait', () => {
  const L = logique();
  const p = L.passageDe({ count: 3, items: ELEMENTS(3), outputs: [1, 2] }, { sorties: ['oui', 'non'] });
  assert.deepEqual(p.elements.map((e) => e.titre), [1, 2, 3].map((i) => remplir(L.MOTS['donnees.element.sortie'], { i, n: 3, o: i === 1 ? 'oui' : 'non' })));
  const doute = L.passageDe({ count: 5, items: ELEMENTS(3), outputs: [1, 2] }, { sorties: ['oui', 'non'] });
  assert.equal(doute.elements[0].titre, remplir(L.MOTS['donnees.element'], { i: 1, n: 5 }), 'le total ne se retrouve pas : pas de sortie inventée');
});

test('logique : la bulle reste dans la fenêtre du schéma, dessous si elle tient, sinon dessus ; sa pointe vise la bulle touchée', () => {
  const L = logique();
  const bas = L.placeDonnees(1000, 600, { x: 500, h: 100, b: 124 }, 340, 200);
  assert.equal(bas.sens, 'bas'); assert.equal(bas.top, 134); assert.equal(bas.left, 330); assert.equal(bas.pointe, 170);
  const haut = L.placeDonnees(1000, 600, { x: 500, h: 500, b: 524 }, 340, 200);
  assert.equal(haut.sens, 'haut'); assert.ok(haut.top + Math.min(200, haut.hmax) <= 490 + 1e-9);
  for (const [cw, ch, x] of [[358, 540, 340], [358, 540, 10], [1280, 620, 1270], [300, 200, 150]]) {
    const p = L.placeDonnees(cw, ch, { x, h: ch / 2, b: ch / 2 + 24 }, 340, 400);
    assert.ok(p.left >= 8 && p.left + p.largeur <= cw - 8 + 1e-9, `${cw} : dans la largeur`);
    assert.ok(p.top >= 8 && p.top + p.hmax <= ch - 8 + 1e-9, `${cw}×${ch} : dans la hauteur`);
    assert.ok(p.pointe >= 14 && p.pointe <= p.largeur - 14);
  }
  assert.equal(L.placeDonnees(1000, 600, { x: -50, h: 100, b: 124 }, 340, 200).sens, 'libre', 'bloc hors de la fenêtre : sans pointe');
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
const FLOW = { id: 'p1', name: 'Passage', active: false, nodes: [
  { name: 'Départ', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
  { name: 'Champs', type: 'données.définir', params: { champs: '{"a":1}' }, position: [340, 160] },
  { name: 'Test', type: 'logique.si', params: { condition: '' }, position: [620, 160] },
  { name: 'Branche A', type: 'temps.attendre', params: { secondes: 1 }, position: [900, 60] },
  { name: 'Branche B', type: 'temps.attendre', params: { secondes: 1 }, position: [900, 270] },
], connections: { Départ: [[{ node: 'Champs' }]], Champs: [[{ node: 'Test' }]], Test: [[{ node: 'Branche A' }], [{ node: 'Branche B' }]] } };
const PASSAGE = { status: 'succès', ms: 3, nodes: {
  Départ: { count: 1, items: [{}], ms: 0, outputs: [1] },
  Champs: { count: 3, items: [{ a: 1 }, { a: 2 }, { a: 3 }], ms: 1, outputs: [3] },
  Test: { count: 3, items: [{ a: 1 }, { a: 2 }, { a: 3 }], ms: 1, outputs: [1, 2] },
  'Branche A': { count: 1, items: [{ a: 1 }], ms: 1, outputs: [1] },
  'Branche B': { count: 2, items: [{ a: 2 }, { a: 3 }], ms: 1500, outputs: [2] },
} as Record<string, Run> };

// retenir : le passage ne revient qu'à sa fin (un test en cours) ; flows : d'autres automatisations, par id ; flow : celle qu'on ouvre.
async function page(o: { runs?: unknown[]; run?: unknown; ensuite?: unknown; lang?: string; retenir?: Promise<void>; flows?: Record<string, unknown>; flow?: unknown } = {}) {
  racine = new Noeud('html'); actif = null; if (o.lang) racine.setAttribute('lang', o.lang);
  const vue = new Noeud('section'); vue.setAttribute('id', 'v-flows'); vue.className = 'on';
  const head = new Noeud('div'); head.className = 'head'; const h1 = new Noeud('h1'); const sub = new Noeud('p'); sub.className = 'sub'; head.append(h1, sub);
  const body = new Noeud('div'); body.className = 'body'; vue.append(head, body); racine.append(vue);
  const tete = new Noeud('head');
  const ecoutes: Record<string, Ecoute[]> = {};
  const document = {
    readyState: 'complete', head: tete, body: racine, documentElement: { get lang() { return racine.getAttribute('lang') ?? ''; } }, get activeElement() { return actif; },
    createElement: (t: string) => new Noeud(t), createElementNS: (_n: string, t: string) => new Noeud(t), createTextNode: (t: string) => new Texte(t),
    querySelector: (s: string) => racine.querySelector(s), querySelectorAll: (s: string) => racine.querySelectorAll(s), getElementById: (i: string) => racine.querySelector(`#${i}`),
    addEventListener(t: string, f: Ecoute) { (ecoutes[t] ??= []).push(f); }, removeEventListener(t: string, f: Ecoute) { ecoutes[t] = (ecoutes[t] ?? []).filter((x) => x !== f); },
  };
  // Un toucher : les écoutes du document d'abord (phase de capture).
  const toucher = async (n: Noeud) => { for (const f of [...(ecoutes.pointerdown ?? [])]) await f({ type: 'pointerdown', target: n, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} }); };
  let tours = 0;
  const reponses: Record<string, (c?: Record<string, unknown>, id?: string) => unknown> = {
    '/api/draupnir/state': () => ({ ok: true, flows: [], templates: [], catalog: CAT, dossiers: [] }),
    '/api/draupnir/flow': (_c, id) => ({ ok: true, flow: ici(o.flows?.[id ?? ''] ?? o.flow ?? FLOW), outputs: {}, runs: o.flows?.[id ?? ''] ? [] : ici(o.runs ?? []), versions: [] }),
    '/api/draupnir/save': (c) => ({ ok: true, flow: c?.flow }),
    '/api/draupnir/run': async () => { const run = ici(tours++ && o.ensuite ? o.ensuite : o.run ?? PASSAGE); if (o.retenir) await o.retenir; return { ok: true, run }; },
  };
  const fetch = async (chemin: string, x?: { body?: string }) => {
    const corps = x?.body ? JSON.parse(x.body) as Record<string, unknown> : undefined;
    const f = reponses[chemin.split('?')[0]];
    const id = new URLSearchParams(chemin.split('?')[1] ?? '').get('id') ?? undefined;
    return { status: 200, ok: true, json: async () => (f ? f(corps, id) : { ok: false, error: 'inconnu' }) };
  };
  // Le presse-papiers et la console sont espionnés : rien ne doit y aller.
  const fuites: string[] = [];
  const espion = (quoi: string) => (...a: unknown[]) => { fuites.push(`${quoi} ${a.map(String).join(' ')}`); return Promise.resolve(); };
  const navigator = { clipboard: { writeText: espion('presse-papiers'), write: espion('presse-papiers') } };
  const console = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir'].map((k) => [k, espion(`console.${k}`)]));
  const window: Record<string, unknown> = { OdinDialog: { confirm: async () => true, alert: async () => {}, prompt: async () => null }, getSelection: () => null, navigator };
  const ctx = { window, document, fetch, URL, Intl, navigator, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, clearTimeout, console };
  vm.runInNewContext(FLOWS, ctx);
  await (window.OdinFlows as { edit: (id: string) => Promise<void> }).edit(FLOW.id); await attendre();
  const css = tete.querySelectorAll('style').map((s) => s.textContent).join('\n');
  const regle = (sel: string) => new RegExp(`(?:^|[}\\n])${echappe(sel)}\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const bloc = (nom: string) => body.querySelectorAll('.dr-node').find((x) => (x.getAttribute('aria-label') ?? '').startsWith(`${nom} (`))!;
  const bouton = (texte: string) => body.querySelectorAll('button').find((b) => b.textContent.trim() === texte)!;
  const tester = async () => { await bouton('Tester').emettre('click'); await attendre(); };
  const bulle = (nom: string) => bloc(nom).querySelector('.dr-bulle')!;
  const ouvrir = async (nom: string, detail = 0) => { await bulle(nom).emettre('click', { detail }); await attendre(); };
  const boite = () => body.querySelector('.dr-passage');
  const flows = window.OdinFlows as { edit: (id: string) => Promise<void>; prendre: () => void };
  return { body, css, regle, bloc, bouton, tester, bulle, ouvrir, boite, toucher, fuites, ecoutes, flows };
}
// (ce qu'il a rendu : pas la liste de ce qu'il a reçu)
const textes = (n: Noeud) => n.querySelectorAll('.dr-ps-l li pre').filter((x) => !x.closest('.dr-ps-recu')).map((x) => x.textContent);
const tousLesNoeuds = (n: Noeud): Noeud[] => [n, ...n.enfants.filter((x): x is Noeud => x !== null).flatMap(tousLesNoeuds)];

test('page : toucher la bulle ouvre la bulle des données, accrochée au bloc : ce qu\'il a rendu, la durée ; un dialogue nommé', async () => {
  const p = await page({ lang: 'en' });
  await p.tester();
  assert.equal(p.boite(), null, 'fermée avant qu\'on la touche');
  await p.ouvrir('Branche B');
  const b = p.boite()!;
  assert.ok(b, 'ouverte');
  assert.equal(b.parent, p.body.querySelector('#drCanvas'), 'dans la fenêtre du schéma');
  assert.equal(b.getAttribute('role'), 'dialog'); assert.match(b.getAttribute('aria-label') ?? '', /Branche B/);
  assert.equal(b.querySelector('h2')!.textContent, 'Branche B');
  assert.deepEqual(textes(b).map((t) => JSON.parse(t)), [{ a: 2 }, { a: 3 }], 'ce qu\'il a rendu, élément par élément');
  const resume = b.querySelector('.dr-ps-r')!.textContent;
  assert.match(resume, /2 élément/);
  const sec = new Intl.NumberFormat('en', { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 2 }).format(1.5);
  assert.ok(resume.includes(sec), `la durée selon la langue de la page (${sec}) : ${resume}`);
  assert.equal(p.bulle('Branche B').getAttribute('aria-expanded'), 'true'); assert.equal(p.bulle('Branche B').getAttribute('aria-controls'), b.getAttribute('id'));
  assert.equal(p.bulle('Champs').getAttribute('aria-expanded'), 'false');
  assert.ok(p.bloc('Branche B').classList.contains('sel'), 'la bulle choisit toujours son bloc (lot 5b)');
  // Toucher une autre bulle : la sienne remplace la première.
  await p.ouvrir('Champs');
  assert.equal(p.body.querySelectorAll('.dr-passage').length, 1); assert.equal(p.boite()!.querySelector('h2')!.textContent, 'Champs');
  // La toucher de nouveau la referme.
  await p.ouvrir('Champs');
  assert.equal(p.boite(), null);
});

test('page : jusqu\'à 20 éléments rendus (ce que le moteur garde), et c\'est dit', async () => {
  const run = { ...ici(PASSAGE), nodes: { ...ici(PASSAGE).nodes, Champs: { count: 30, items: ELEMENTS(30), ms: 4, outputs: [30] } } };
  const p = await page({ run });
  await p.tester(); await p.ouvrir('Champs');
  const b = p.boite()!;
  assert.equal(textes(b).length, 20);
  assert.deepEqual(JSON.parse(textes(b)[19]), { rang: 20 });
  assert.ok(b.querySelectorAll('.dr-ps-m').some((x) => /20/.test(x.textContent)), 'dit que seuls les 20 premiers sont gardés');
});

test('page : en erreur, l\'erreur entière (pas les 40 signes écrits sous le bloc)', async () => {
  const long = `${'réglage illisible '.repeat(20)}— fin`;
  const run = { status: 'erreur', ms: 2, error: long, nodes: { Départ: { count: 1, items: [{}], ms: 0, outputs: [1] }, Champs: { count: 0, items: [], ms: 1, error: long } } };
  const p = await page({ run });
  await p.tester(); await p.ouvrir('Champs');
  assert.equal(p.boite()!.querySelector('.dr-ps-e')!.textContent, long);
});

test('page : une donnée qui contient du code de page est montrée comme du texte, jamais comme du code', async () => {
  const piege = '<img src=x onerror=alert(1)>', script = '<script>alert(1)</script>';
  const run = { ...ici(PASSAGE), nodes: { ...ici(PASSAGE).nodes,
    Champs: { count: 2, items: [{ [piege]: script }, { texte: `${piege}${script}` }], ms: 1, outputs: [2] },
    'Branche B': { count: 0, items: [], ms: 1, error: `${script}${piege}` } } };
  const p = await page({ run });
  await p.tester(); await p.ouvrir('Champs');
  let b = p.boite()!;
  const tout = textes(b).join('\n');
  assert.ok(tout.includes(piege) && tout.includes(script), 'la donnée est là, telle quelle, en texte');
  for (const n of tousLesNoeuds(b)) {
    assert.equal(n.html, '', 'jamais d\'innerHTML');
    assert.ok(!['IMG', 'SCRIPT', 'IFRAME', 'OBJECT'].includes(n.tagName), `aucun élément ${n.tagName} créé depuis une donnée`);
  }
  await p.ouvrir('Branche B');
  b = p.boite()!;
  assert.equal(b.querySelector('.dr-ps-e')!.textContent, `${script}${piege}`);
  for (const n of tousLesNoeuds(b)) assert.equal(n.html, '');
  // Dans le code : la bulle des données n'écrit jamais de HTML.
  const code = FLOWS.slice(FLOWS.indexOf('function fermerPassage'), FLOWS.indexOf('function placerPassage'));
  assert.ok(code.length > 200, 'le code de la bulle est là'); assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('page : ce qu\'il a reçu n\'est montré que s\'il se déduit du bloc d\'avant, avec la mention ; sinon c\'est dit', async () => {
  const p = await page();
  const L = logique();
  await p.tester(); await p.ouvrir('Branche B');
  let b = p.boite()!;
  const recu = b.querySelector('.dr-ps-recu')!;
  assert.ok(recu, 'déduit : montré (replié)');
  assert.ok(recu.querySelectorAll('.dr-ps-m').some((x) => x.textContent === L.MOTS['donnees.recu.deduit']), 'et c\'est dit');
  assert.deepEqual(recu.querySelectorAll('pre').map((x) => JSON.parse(x.textContent)), [{ a: 2 }, { a: 3 }], 'la sortie « non » du « Si »');
  // Le déclencheur : il ne reçoit rien.
  await p.ouvrir('Départ');
  b = p.boite()!;
  assert.equal(b.querySelector('.dr-ps-recu'), null);
  assert.ok(b.querySelectorAll('.dr-ps-m').some((x) => x.textContent === L.MOTS['donnees.recu.declencheur']));
  // Un fil posé depuis le passage (pas encore enregistré) : on ne sait plus ce qui est arrivé, rien n'est montré.
  const sortie = p.bloc('Champs').querySelectorAll('.dr-port').find((x) => x.classList.contains('out'))!;
  await sortie.emettre('click', { timeStamp: Date.now() + 10_000 });
  await p.bloc('Branche B').querySelectorAll('.dr-port').find((x) => x.classList.contains('in'))!.emettre('click'); await attendre();
  await p.ouvrir('Branche B');
  b = p.boite()!;
  assert.equal(b.querySelector('.dr-ps-recu'), null, 'plus déductible');
  assert.ok(b.querySelectorAll('.dr-ps-m').some((x) => x.textContent === L.MOTS['donnees.recu.non']));
  assert.equal(textes(b).length, 2, 'ce qu\'il a rendu, lui, reste vrai');
});

test('page : au clavier — Tab entre dans la bulle, Échap la ferme et rend le focus à la bulle ; le bouton « × » fait 44 px', async () => {
  const p = await page();
  await p.tester(); await p.ouvrir('Champs', 0);
  assert.equal(actif, p.bulle('Champs'), 'le focus reste sur la bulle à l\'ouverture');
  await p.bulle('Champs').emettre('keydown', { key: 'Tab', shiftKey: false });
  const x = p.boite()!.querySelector('.dr-ps-x')!;
  assert.equal(actif, x, 'Tab : sur le bouton « × »');
  assert.match(x.getAttribute('aria-label') ?? '', /Champs/);
  assert.match(p.regle('.dr-ps-x'), /width:44px/); assert.match(p.regle('.dr-ps-x'), /height:44px/);
  await x.emettre('keydown', { key: 'Escape' }); await attendre();
  assert.equal(p.boite(), null, 'Échap : fermée');
  assert.equal(actif, p.bulle('Champs'), 'le focus revient sur la bulle');
  assert.equal(p.bulle('Champs').getAttribute('aria-expanded'), 'false');
  // Échap sur la bulle elle-même (le focus y est resté).
  await p.ouvrir('Champs', 0);
  await p.bulle('Champs').emettre('keydown', { key: 'Escape' });
  assert.equal(p.boite(), null); assert.equal(actif, p.bulle('Champs'));
  // Le bouton « × ».
  await p.ouvrir('Champs', 0);
  await p.boite()!.querySelector('.dr-ps-x')!.emettre('click', { detail: 0 });
  assert.equal(p.boite(), null); assert.equal(actif, p.bulle('Champs'));
});

test('page : un toucher ailleurs la ferme ; un toucher dedans, non', async () => {
  const p = await page();
  await p.tester(); await p.ouvrir('Champs', 1);
  await p.toucher(p.boite()!.querySelector('.dr-ps-c')!);
  assert.ok(p.boite(), 'toucher dedans (faire défiler, choisir du texte) : elle reste');
  await p.toucher(p.body.querySelector('#drCanvas')!);
  assert.equal(p.boite(), null, 'toucher le schéma : fermée');
  await p.ouvrir('Champs', 1);
  await p.toucher(p.body.querySelector('#drSide')!);
  assert.equal(p.boite(), null, 'toucher le panneau : fermée');
});

test('page : sans passage, « Ce bloc n\'a pas encore tourné » (un nouveau test où il n\'a pas tourné)', async () => {
  const ensuite = { status: 'succès', ms: 1, nodes: { Départ: { count: 1, items: [{}], ms: 0, outputs: [1] }, Champs: { count: 1, items: [{ a: 1 }], ms: 1, outputs: [1] } } };
  const p = await page({ ensuite });
  const L = logique();
  await p.tester(); await p.ouvrir('Branche B', 0);
  // Au clavier, sans toucher l'écran : un nouveau test ; la bulle ouverte suit le nouveau passage.
  await p.bouton('Tester').emettre('click'); await attendre();
  const b = p.boite()!;
  assert.ok(b, 'toujours ouverte (aucun toucher ailleurs)');
  assert.equal(b.querySelector('.dr-ps-c')!.textContent, L.MOTS['donnees.vide']);
  assert.equal(textes(b).length, 0, 'aucune donnée d\'avant gardée');
});

test('page : rien dans le presse-papiers ni dans la console', async () => {
  const p = await page();
  await p.tester();
  for (const nom of ['Départ', 'Champs', 'Test', 'Branche A', 'Branche B']) { await p.ouvrir(nom, 0); await p.bulle(nom).emettre('keydown', { key: 'Escape' }); }
  await p.ouvrir('Champs', 1); await p.toucher(p.body);
  assert.deepEqual(p.fuites, []);
  const debut = FLOWS.indexOf('// ---------------- La bulle des données d\'un passage : accrochée'), fin = FLOWS.indexOf('/** Le point de la fenêtre (en coordonnées du schéma)');
  assert.ok(debut > 0 && fin > debut, 'le code de la bulle est là');
  assert.doesNotMatch(FLOWS.slice(debut, fin), /clipboard|console\.|localStorage|sessionStorage|fetch\(|api\(/, 'la donnée reste dans la page');
});

test('page : les textes de la bulle viennent du dictionnaire en tête de fichier', () => {
  const L = logique();
  for (const k of ['donnees.dialogue', 'donnees.fermer', 'donnees.vide', 'donnees.resume', 'donnees.duree', 'donnees.erreur', 'donnees.rendu', 'donnees.rien', 'donnees.garde', 'donnees.element', 'donnees.recu', 'donnees.recu.deduit', 'donnees.recu.non', 'donnees.recu.declencheur']) assert.equal(typeof L.MOTS[k], 'string', k);
  assert.ok(FLOWS.indexOf('\'donnees.vide\'') > 0 && FLOWS.indexOf('\'donnees.vide\'') < FLOWS.indexOf('function nodeEl'));
});

// ------------------------------------------------------------------ relecture : la bulle ne montre que le vrai, du bon bloc, de la bonne automatisation
const porte = () => { let ouvrir = () => {}; const p = new Promise<void>((ok) => { ouvrir = ok; }); return { p, ouvrir }; };

test('relecture : une autre automatisation ouverte pendant un test ne prend pas le passage de la première', async () => {
  const g = porte();
  const AUTRE = { ...ici(FLOW), id: 'p2', name: 'Autre' }; // (mêmes noms de blocs : le piège)
  const p = await page({ retenir: g.p, flows: { p2: AUTRE } });
  const enCours = p.bouton('Tester').emettre('click'); await attendre();
  await p.flows.edit('p2'); await attendre();
  g.ouvrir(); await enCours; await attendre();
  assert.equal(p.body.querySelector('.dr-bulle'), null, 'aucune bulle : « Autre » n\'a pas tourné');
  assert.equal(p.body.querySelector('.dr-seul-b'), null);
});

test('relecture : enregistrée de nouveau pendant un test (un fil en plus), ce qu\'il a reçu n\'est plus déduit', async () => {
  const g = porte(), L = logique();
  const p = await page({ retenir: g.p });
  const enCours = p.bouton('Tester').emettre('click'); await attendre();
  // Pendant le passage : un fil de « Champs » à « Branche B », puis « Enregistrer ».
  const sortie = p.bloc('Champs').querySelectorAll('.dr-port').find((x) => x.classList.contains('out'))!;
  await sortie.emettre('click', { timeStamp: Date.now() + 10_000 });
  await p.bloc('Branche B').querySelectorAll('.dr-port').find((x) => x.classList.contains('in'))!.emettre('click'); await attendre();
  await p.bouton('Enregistrer').emettre('click'); await attendre();
  g.ouvrir(); await enCours; await attendre();
  await p.ouvrir('Branche B');
  const b = p.boite()!;
  assert.equal(b.querySelector('.dr-ps-recu'), null, 'le passage a tourné sans ce fil : rien de déduit');
  assert.ok(b.querySelectorAll('.dr-ps-m').some((x) => x.textContent === L.MOTS['donnees.recu.non']));
  assert.equal(textes(b).length, 2, 'ce qu\'il a rendu reste vrai');
});

test('relecture : à la réouverture, ce qu\'il a reçu ne se déduit que si elle n\'a pas été enregistrée après le passage (date lisible)', async () => {
  const L = logique();
  const runs = [{ ...ici(PASSAGE), trigger: 'Départ', startedAt: '2026-11-20T10:00:00.000Z' }];
  const sans = await page({ runs }); // (le schéma ouvert n'a pas de date d'enregistrement : on ne sait pas)
  await sans.ouvrir('Branche B');
  assert.equal(sans.boite()!.querySelector('.dr-ps-recu'), null);
  assert.ok(sans.boite()!.querySelectorAll('.dr-ps-m').some((x) => x.textContent === L.MOTS['donnees.recu.non']));
  const avant = await page({ runs, flow: { ...ici(FLOW), updatedAt: '2026-11-20T09:59:00.000Z' } });
  await avant.ouvrir('Branche B');
  assert.ok(avant.boite()!.querySelector('.dr-ps-recu'), 'enregistrée avant le passage : déduit');
});

test('relecture : redessinée pour le même passage, la bulle garde le focus et « Ce qu\'il a reçu » ouvert ; un nouveau passage le replie', async () => {
  const p = await page();
  await p.tester(); await p.ouvrir('Branche B', 0);
  await p.bulle('Branche B').emettre('keydown', { key: 'Tab', shiftKey: false });
  assert.equal(actif, p.boite()!.querySelector('.dr-ps-x'));
  // On ouvre « Ce qu'il a reçu », puis le schéma est redessiné (le rond d'entrée d'un autre bloc, touché au clavier).
  const det = p.boite()!.querySelector('.dr-ps-recu')! as Noeud & { open?: boolean }; det.open = true;
  await p.bloc('Champs').querySelector('.dr-port.in')!.emettre('click'); await attendre();
  const b = p.boite()!;
  assert.ok(b, 'toujours ouverte');
  assert.equal(actif, b.querySelector('.dr-ps-x'), 'le focus est sur le « × » neuf, pas perdu');
  assert.notEqual(b.querySelector('.dr-ps-recu')!.getAttribute('open'), null, '« Ce qu\'il a reçu » reste ouvert');
  // Un nouveau test (au clavier) : nouveau passage, « Ce qu'il a reçu » replié ; le focus reste dans la bulle.
  await p.bouton('Tester').emettre('click'); await attendre();
  assert.equal(p.boite()!.querySelector('.dr-ps-recu')!.getAttribute('open'), null, 'replié');
  assert.equal(actif, p.boite()!.querySelector('.dr-ps-x'));
});

test('relecture : le rond d\'un bloc exécuté seul est un vrai bouton de 44 px qui ouvre la même bulle des données', async () => {
  const L = logique();
  const seul = { seul: 'Branche A', status: 'succès', nodes: { 'Branche A': { count: 4, items: ELEMENTS(4), ms: 2, outputs: [4] } } };
  const p = await page({ runs: [seul, { ...ici(PASSAGE), trigger: 'Départ' }] });
  const rond = p.bloc('Branche A').querySelector('.dr-seul-b')!;
  assert.ok(rond, 'le bouton');
  assert.equal(rond.tagName, 'BUTTON'); assert.equal(rond.getAttribute('type'), 'button');
  assert.equal(rond.getAttribute('aria-label'), remplir(L.MOTS['seul.elements'], { b: 'Branche A', n: 4, s: 's' }));
  assert.equal(rond.getAttribute('aria-haspopup'), 'dialog'); assert.equal(rond.getAttribute('aria-expanded'), 'false');
  assert.equal(p.bloc('Branche A').querySelector('.dr-seul')!.textContent, '4', 'le rond dessiné reste');
  assert.match(p.regle('.dr-seul-b'), /width:var\(--dr-z,44px\)/); assert.match(p.regle('.dr-seul-b'), /height:var\(--dr-z,44px\)/);
  assert.match(p.regle('.dr-seul-b'), /z-index:1/, 'au-dessus du rond d\'entrée qu\'il chevauche');
  await rond.emettre('click', { detail: 0 }); await attendre();
  const b = p.boite()!;
  assert.ok(b, 'ouverte'); assert.equal(b.querySelector('h2')!.textContent, 'Branche A');
  assert.equal(textes(b).length, 4, 'ce qu\'il a rendu, seul');
  assert.equal(b.querySelector('.dr-ps-recu'), null, 'exécuté seul : rien de déduit');
  const neuf = p.bloc('Branche A').querySelector('.dr-seul-b')!;
  assert.equal(neuf.getAttribute('aria-expanded'), 'true'); assert.equal(actif, neuf, 'le focus reste sur le bouton');
  await p.toucher(neuf); assert.ok(p.boite(), 'toucher son propre bouton ne la ferme pas d\'abord');
  await neuf.emettre('keydown', { key: 'Tab', shiftKey: false });
  assert.equal(actif, p.boite()!.querySelector('.dr-ps-x'));
  await p.boite()!.querySelector('.dr-ps-x')!.emettre('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(actif, p.bloc('Branche A').querySelector('.dr-seul-b'), 'Maj+Tab : retour sur le bouton');
  await p.bloc('Branche A').querySelector('.dr-seul-b')!.emettre('keydown', { key: 'Escape' });
  assert.equal(p.boite(), null); assert.equal(actif, p.bloc('Branche A').querySelector('.dr-seul-b'));
  // En erreur : le bouton le dit.
  const err = { seul: 'Branche A', status: 'erreur', nodes: { 'Branche A': { count: 0, items: [], error: 'arrêt' } } };
  const q = await page({ runs: [err, { ...ici(PASSAGE), trigger: 'Départ' }] });
  assert.equal(q.bloc('Branche A').querySelector('.dr-seul-b')!.getAttribute('aria-label'), remplir(L.MOTS['seul.erreur'], { b: 'Branche A', e: 'arrêt' }));
});

test('relecture : un autre écran de Talos prend la page, la bulle se ferme et son écoute du document part', async () => {
  const p = await page();
  await p.tester(); await p.ouvrir('Champs');
  assert.equal((p.ecoutes.pointerdown ?? []).length, 1);
  p.flows.prendre();
  assert.equal((p.ecoutes.pointerdown ?? []).length, 0, 'plus d\'écoute du document');
});

test('relecture : un bloc nommé « constructor » qui n\'a pas tourné n\'a ni bulle ni données', async () => {
  const flow = { ...ici(FLOW), nodes: [...ici(FLOW).nodes, { name: 'constructor', type: 'temps.attendre', params: { secondes: 1 }, position: [60, 420] }] };
  const p = await page({ flow });
  await p.tester();
  const b = p.body.querySelectorAll('.dr-node').find((x) => (x.getAttribute('aria-label') ?? '').startsWith('constructor ('))!;
  assert.ok(b);
  assert.equal(b.querySelector('.dr-bulle'), null); assert.equal(b.querySelector('.dr-cnt'), null, 'pas de « undefined élément(s) »');
});

test('relecture : ce qu\'on a touché est sorti de la partie visible (au-dessus ou au-dessous) : la bulle se pose dans ce qui se voit, sans pointe', () => {
  const L = logique();
  for (const a of [{ x: 200, h: -80, b: -56 }, { x: 200, h: 700, b: 724 }]) {
    const p = L.placeDonnees(1000, 600, a, 340, 300);
    assert.equal(p.sens, 'libre', JSON.stringify(a)); assert.ok(p.top >= 8 && p.top + p.hmax <= 600 - 8 + 1e-9);
  }
});

// ------------------------------------------------------------------ l'entrée vraie (le moteur garde ce qu'un bloc a reçu)
// Un passage récent porte, pour chaque bloc, ce qu'il a reçu (`input`, 20 éléments au plus ; `inputCount`, le nombre
// entier) : la bulle le montre tel quel et dit que c'est ce que le moteur a gardé. Un passage d'avant n'en a pas : la
// bulle déduit comme avant, et le dit.
test('logique : l\'entrée vraie gardée par le moteur est montrée telle quelle, et c\'est dit ; elle passe avant une entrée déduite', () => {
  const L = logique();
  assert.equal(typeof L.MOTS['donnees.recu.vrai'], 'string');
  const run = { count: 1, items: [{ a: 1 }], ms: 1, input: [{ vrai: 1 }, { vrai: 2 }], inputCount: 2 };
  const p = L.passageDe(run, { entree: { ok: true, items: [{ json: { deduit: 1 } }], tronque: false } });
  assert.equal(p.entree.montree, true);
  assert.deepEqual(p.entree.elements.map((e) => JSON.parse(e.texte)), [{ vrai: 1 }, { vrai: 2 }], 'l\'entrée vraie, pas la déduite');
  assert.equal(p.entree.mention, L.MOTS['donnees.recu.vrai'], 'dit : ce que le moteur a gardé');
  // Gardée même quand rien ne se déduit (fil changé depuis, bloc d'avant exécuté seul) : c'est celle de ce passage.
  assert.deepEqual(L.passageDe(run, { entree: null }).entree.elements.map((e) => JSON.parse(e.texte)), [{ vrai: 1 }, { vrai: 2 }]);
  // En erreur aussi.
  assert.equal(L.passageDe({ count: 0, items: [], error: 'x', input: [{ v: 0 }], inputCount: 1 }).entree.montree, true);
  // Plus reçu que gardé : c'est dit, avec le nombre gardé.
  const beaucoup = L.passageDe({ count: 0, items: [], ms: 1, input: ELEMENTS(20), inputCount: 30 });
  assert.equal(beaucoup.entree.elements.length, 20);
  assert.equal(beaucoup.entree.mention, `${L.MOTS['donnees.recu.vrai']} ${remplir(L.MOTS['donnees.garde'], { k: (20).toLocaleString() })}`);
  // Rien reçu : une liste vide, dite.
  const vide = L.passageDe({ count: 0, items: [], ms: 1, input: [], inputCount: 0 });
  assert.equal(vide.entree.montree, false); assert.equal(vide.entree.mention, `${L.MOTS['donnees.recu.vrai']} ${L.MOTS['donnees.recu.rien']}`);
  // Un déclencheur : inchangé.
  assert.equal(L.passageDe(run, { declencheur: true }).entree.mention, L.MOTS['donnees.recu.declencheur']);
});

test('logique : un passage d\'avant (sans entrée gardée) se relit : l\'entrée déduite, dite comme telle, sinon rien', () => {
  const L = logique(), vieux = { count: 1, items: [{ a: 1 }], ms: 1 };
  const d = L.passageDe(vieux, { entree: { ok: true, items: [{ json: { b: 2 } }], tronque: false } });
  assert.equal(d.entree.montree, true); assert.equal(d.entree.mention, L.MOTS['donnees.recu.deduit']);
  assert.match(L.MOTS['donnees.recu.deduit'], /passage/, 'dit que c\'est ce passage-là qui ne l\'a pas gardé');
  assert.doesNotMatch(L.MOTS['donnees.recu.deduit'], /ne garde pas/, 'plus de phrase devenue fausse sur le moteur');
  assert.doesNotMatch(L.MOTS['donnees.recu.non'], /ne garde pas/);
  // Une entrée mal formée (pas une liste) compte comme absente.
  assert.equal(L.passageDe({ ...vieux, input: 'x' as never }, { entree: null }).entree.mention, L.MOTS['donnees.recu.non']);
});

test('page : l\'entrée vraie d\'un bloc est montrée (repliée), avec la mention ; écrite comme du texte', async () => {
  const piege = '<img src=x onerror=alert(1)>';
  const run = { ...ici(PASSAGE), nodes: { ...ici(PASSAGE).nodes, 'Branche B': { ...ici(PASSAGE).nodes['Branche B'], input: [{ recu: piege }, { recu: 'deux' }], inputCount: 2 } } };
  const p = await page({ run });
  const L = logique();
  await p.tester(); await p.ouvrir('Branche B');
  const recu = p.boite()!.querySelector('.dr-ps-recu')!;
  assert.ok(recu, 'montrée, repliée');
  assert.ok(recu.querySelectorAll('.dr-ps-m').some((x) => x.textContent === L.MOTS['donnees.recu.vrai']), 'et c\'est dit');
  assert.deepEqual(recu.querySelectorAll('pre').map((x) => JSON.parse(x.textContent)), [{ recu: piege }, { recu: 'deux' }], 'l\'entrée vraie, pas la sortie « non » déduite');
  for (const n of tousLesNoeuds(recu)) { assert.equal(n.html, ''); assert.notEqual(n.tagName, 'IMG'); }
});
