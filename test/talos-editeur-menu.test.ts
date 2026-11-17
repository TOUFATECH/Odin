// Talos, l'éditeur à nœuds (src/web/flows.js) : le menu d'un bloc (étape 5a).
// - Logique (sans document) : un nom vide ou déjà pris est refusé avec sa raison ; la note posée, modifiée, retirée
//   (un bloc sans note n'a rien de plus).
// - Page (petit document simulé, aucun navigateur) : le menu s'ouvre au clic droit, à l'appui long au doigt, par le
//   bouton « ⋯ » et au clavier ; il n'a que Renommer, Ajouter (ou Modifier) la note, Retirer ; Échap, Tab, un toucher
//   ailleurs le referment ; le clic droit garde le menu du navigateur hors des blocs ; renommer sur place (les fils
//   suivent), le double-clic sur le nom ; la note marquée sur le bloc et lisible ; un nom ou une note piégés restent
//   du texte ; ouvrir puis enregistrer à l'identique.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { resolve } from '../src/draupnir/engine.ts';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const LIEN = readFileSync(new URL('../src/web/pages/talos-lien.js', import.meta.url), 'utf8');

type Noeud0 = { name: string; type: string; params: Record<string, unknown>; position: [number, number]; note?: string };
type Wf = { nodes: Noeud0[]; connections: Record<string, Array<Array<{ node: string }>>> };
interface Logique {
  nomValide: (wf: Wf, ancien: string, texte: unknown) => { ok: boolean; nom?: string; error?: string };
  poserNote: (n: Noeud0, texte: unknown) => boolean;
  renommerDans: (texte: string, de: string, vers: string, dansJson?: boolean) => string | null;
  suivreRenommage: (wf: Wf, de: string, vers: string, estJson?: (n: Noeud0, cle: string) => boolean) => { ok: boolean; error?: string; changes?: Array<{ i: number; cle: string; valeur: unknown }> };
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

const HYDRE = { id: 'ymir', nom: 'Hydre', famille: 'Machines', evenements: ['alerte'], actions: [
  { id: 'verifier_isos', label: 'Vérifier toutes les ISO', what: '', params: [], read: false, grave: false },
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
const deux = (): Wf => ({ nodes: [{ name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] }, { name: 'Si', type: 'logique.si', params: {}, position: [340, 160] }], connections: { Lancer: [[{ node: 'Si' }]] } });

test('renommer : un nom vide (ou fait d\'espaces) ou déjà pris est refusé, avec sa raison ; le nom est pris sans ses espaces autour', () => {
  const L = logique(), wf = deux();
  for (const v of ['', '   ', undefined]) { const r = L.nomValide(wf, 'Si', v); assert.equal(r.ok, false); assert.match(r.error ?? '', /nom/i); assert.match(r.error ?? '', /vide/i); }
  const pris = L.nomValide(wf, 'Si', 'Lancer');
  assert.equal(pris.ok, false); assert.match(pris.error ?? '', /« Lancer » est déjà pris/);
  assert.deepEqual(ici(L.nomValide(wf, 'Si', '  Contrôle  ')), { ok: true, nom: 'Contrôle' });
  assert.deepEqual(ici(L.nomValide(wf, 'Si', 'Si')), { ok: true, nom: 'Si' }, 'son propre nom : permis (rien ne change)');
});

test('la note : posée, modifiée, retirée ; un texte vide la retire ; un bloc sans note n\'a pas de champ « note »', () => {
  const L = logique(), n: Noeud0 = { name: 'Si', type: 'logique.si', params: {}, position: [0, 0] }, avant = JSON.stringify(n);
  assert.equal(L.poserNote(n, '  '), false, 'rien à poser');
  assert.equal(JSON.stringify(n), avant);
  assert.equal(L.poserNote(n, 'Vérifier le seuil\navec Maëlle'), true); assert.equal(n.note, 'Vérifier le seuil\navec Maëlle');
  assert.equal(L.poserNote(n, '  Seuil à 3  '), true); assert.equal(n.note, 'Seuil à 3', 'modifiée (sans les espaces autour)');
  assert.equal(L.poserNote(n, 'Seuil à 3'), false, 'le même texte : rien ne change');
  assert.equal(L.poserNote(n, ''), true); assert.equal('note' in n, false, 'retirée : le champ disparaît');
  assert.equal(JSON.stringify(n), avant, 'aller-retour : identique');
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
  const ctx = { window, document, fetch, location: { reload() {} }, requestAnimationFrame: () => 0, setTimeout, clearTimeout, console };
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

type P = Awaited<ReturnType<typeof page>>;
const canvasDe = (p: P) => p.body.querySelector('#drCanvas')!;
/** Un clic droit sur `n` : → true si le menu du navigateur a été empêché. */
async function clicDroit(n: Noeud, x = 300, y = 200) {
  let empeche = false;
  await n.emettre('contextmenu', { clientX: x, clientY: y, button: 2, preventDefault() { empeche = true; } });
  return empeche;
}
const choixDuMenu = () => menu()?.querySelectorAll('button').map((b) => b.textContent) ?? [];
const nomDe = (p: P, bloc: string) => p.bloc(bloc).querySelector('.dr-nom')!;
const fenNote = () => racine.querySelector('.dr-note-ed');

test('page : le clic droit sur un bloc ouvre son menu (Renommer, Ajouter une note, Retirer), sans le menu du navigateur', async () => {
  const p = await page();
  assert.equal(await clicDroit(p.bloc('Si')), true, 'le menu du navigateur est empêché sur un bloc');
  const m = menu()!;
  assert.ok(m, 'un menu s\'ouvre');
  assert.equal(m.getAttribute('role'), 'menu');
  assert.match(m.getAttribute('aria-label') ?? '', /Si/);
  assert.deepEqual(choixDuMenu(), ['Renommer', 'Ajouter une note', 'Retirer'], 'ces trois choix, et seulement eux');
  assert.ok(m.querySelectorAll('button').every((b) => b.getAttribute('role') === 'menuitem'));
  assert.equal(actif, m.querySelector('button'), 'le focus va au premier choix');
  // Un clic droit sur un rond ou le « + » du bloc : le même menu.
  await canvasDe(p).emettre('pointerdown', { clientX: 1, clientY: 1 });
  assert.equal(await clicDroit(p.bloc('Fin').querySelector('.dr-plus')!), true);
  assert.match(menu()!.getAttribute('aria-label') ?? '', /Fin/);
});

test('page : ailleurs que sur un bloc, le clic droit garde le menu du navigateur', async () => {
  const p = await page();
  assert.equal(await clicDroit(canvasDe(p)), false, 'le fond du schéma');
  assert.equal(await clicDroit(p.fil('Si', 'Fin')!), false, 'un fil');
  assert.equal(await clicDroit(p.bouton('Enregistrer')!), false, 'la barre');
  assert.equal(await clicDroit(p.body.querySelector('#drSide')!), false, 'le panneau');
  assert.equal(menu(), null);
});

test('page : le bouton « ⋯ » de chaque bloc ouvre le même menu ; sa zone de toucher fait 44 px à l\'écran', async () => {
  const p = await page();
  for (const nom of ['Lancer', 'Si', 'Attendre', 'Fin']) {
    const b = p.bloc(nom).querySelector('.dr-mb')!;
    assert.ok(b, `« ⋯ » sur ${nom}`);
    assert.equal(b.tagName, 'BUTTON'); assert.equal(b.getAttribute('aria-haspopup'), 'menu');
    assert.match(b.getAttribute('aria-label') ?? '', new RegExp(nom));
  }
  // Au doigt ou à la souris : un toucher dessus (le clic qui suit n'en ouvre pas un second).
  const mb = p.bloc('Attendre').querySelector('.dr-mb')!;
  await mb.emettre('pointerdown', { clientX: 400, clientY: 100, pointerId: 5, button: 0, pointerType: 'touch' });
  await mb.emettre('pointerup', { clientX: 400, clientY: 100, pointerId: 5, pointerType: 'touch' });
  await mb.emettre('click', { clientX: 400, clientY: 100, detail: 1 });
  assert.deepEqual(choixDuMenu(), ['Renommer', 'Ajouter une note', 'Retirer']);
  assert.match(menu()!.getAttribute('aria-label') ?? '', /Attendre/);
  assert.equal(racine.querySelectorAll('.dr-fil-menu').length, 1);
  assert.equal(p.body.querySelector('#drNn'), null, 'le bloc n\'est pas choisi pour autant');
  // Au clavier (Tab jusqu'à « ⋯ », Entrée : un clic sans pointeur).
  await canvasDe(p).emettre('pointerdown', { clientX: 1, clientY: 1 });
  assert.equal(menu(), null);
  await p.bloc('Fin').querySelector('.dr-mb')!.emettre('click', { detail: 0 });
  assert.match(menu()!.getAttribute('aria-label') ?? '', /Fin/);
  // Un geste parti de « ⋯ » fait glisser le bloc, sans menu.
  await canvasDe(p).emettre('pointerdown', { clientX: 1, clientY: 1 });
  const mb2 = p.bloc('Fin').querySelector('.dr-mb')!;
  await mb2.emettre('pointerdown', { clientX: 400, clientY: 300, pointerId: 6, button: 0, pointerType: 'mouse' });
  await mb2.emettre('pointermove', { clientX: 460, clientY: 330, pointerId: 6 });
  await mb2.emettre('pointerup', { clientX: 460, clientY: 330, pointerId: 6 });
  assert.equal(menu(), null, 'pas de menu après un glissement');
  assert.deepEqual(ici((await p.enregistre()).nodes.find((x) => x.name === 'Fin')!.position), [960, 330], 'le bloc a glissé');
  const regle = (sel: string) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(p.css)?.[1] ?? '';
  assert.match(regle('.dr-mb'), /width:var\(--dr-z,44px\)/); assert.match(regle('.dr-mb'), /height:var\(--dr-z,44px\)/);
});

test('page : l\'appui long au doigt ouvre le menu (et ne choisit pas le bloc) ; un toucher court ne l\'ouvre pas', async () => {
  const p = await page();
  const b = p.bloc('Fin');
  await b.emettre('pointerdown', { clientX: 700, clientY: 300, pointerId: 7, pointerType: 'touch', button: 0 });
  await b.emettre('pointerup', { clientX: 700, clientY: 300, pointerId: 7, pointerType: 'touch' });
  await new Promise((ok) => setTimeout(ok, 700));
  assert.equal(menu(), null, 'toucher court : pas de menu');
  assert.equal(p.body.querySelector('#drNn')?.getAttribute('value'), 'Fin', 'toucher court : le bloc est choisi, comme avant');
  const s = p.bloc('Si');
  await s.emettre('pointerdown', { clientX: 400, clientY: 200, pointerId: 8, pointerType: 'touch', button: 0 });
  await new Promise((ok) => setTimeout(ok, 700));
  assert.ok(menu(), 'appui long : le menu s\'ouvre');
  assert.match(menu()!.getAttribute('aria-label') ?? '', /Si/);
  await s.emettre('pointerup', { clientX: 400, clientY: 200, pointerId: 8, pointerType: 'touch' });
  assert.ok(menu(), 'lever le doigt garde le menu ouvert');
  // Après le doigt levé, le navigateur donne le focus au bloc touché : le menu reste.
  await menu()!.querySelector('button')!.emettre('focusout', { relatedTarget: p.bloc('Si') });
  assert.ok(menu(), 'le focus donné au bloc lui-même ne referme pas son menu');
  assert.equal(p.body.querySelector('#drNn')?.getAttribute('value'), 'Fin', 'le bloc n\'a pas été choisi par l\'appui long');
  // Le navigateur du téléphone envoie aussi un clic droit : un seul menu.
  await clicDroit(s);
  assert.equal(racine.querySelectorAll('.dr-fil-menu').length, 1);
  // Un doigt qui glisse ne déclenche pas d'appui long.
  await canvasDe(p).emettre('pointerdown', { clientX: 1, clientY: 1 });
  const a = p.bloc('Attendre');
  await a.emettre('pointerdown', { clientX: 400, clientY: 100, pointerId: 9, pointerType: 'touch', button: 0 });
  await a.emettre('pointermove', { clientX: 440, clientY: 130, pointerId: 9, pointerType: 'touch' });
  await new Promise((ok) => setTimeout(ok, 700));
  assert.equal(menu(), null, 'un bloc qu\'on fait glisser n\'ouvre pas de menu');
  await a.emettre('pointerup', { clientX: 440, clientY: 130, pointerId: 9, pointerType: 'touch' });
});

test('page : au clavier, la touche Menu (ou Maj+F10) l\'ouvre sur le bloc choisi ; les flèches ; Échap rend le focus au bloc ; Tab et un toucher ailleurs le referment', async () => {
  const p = await page();
  const b = p.bloc('Si');
  b.focus(); await b.emettre('keydown', { key: 'ContextMenu' });
  const m = menu()!;
  assert.ok(m, 'la touche Menu ouvre le menu');
  const [r, n, x] = m.querySelectorAll('button');
  assert.equal(actif, r);
  await m.emettre('keydown', { key: 'ArrowDown', target: r }); assert.equal(actif, n);
  await m.emettre('keydown', { key: 'ArrowDown', target: n }); assert.equal(actif, x);
  await m.emettre('keydown', { key: 'ArrowUp', target: x }); assert.equal(actif, n);
  await m.emettre('keydown', { key: 'Escape' });
  assert.equal(menu(), null, 'Échap referme');
  assert.match(actif?.getAttribute('aria-label') ?? '', /^Si \(/, 'le focus revient au bloc');
  // Maj+F10.
  const b2 = p.bloc('Si'); b2.focus(); await b2.emettre('keydown', { key: 'F10', shiftKey: true });
  assert.ok(menu(), 'Maj+F10 aussi');
  const [c1] = menu()!.querySelectorAll('button');
  await c1.emettre('focusout', { relatedTarget: p.bouton('Enregistrer') });
  assert.equal(menu(), null, 'Tab hors du menu le referme');
  await clicDroit(p.bloc('Fin'));
  await canvasDe(p).emettre('pointerdown', { clientX: 1, clientY: 1 });
  assert.equal(menu(), null, 'un toucher ailleurs le referme');
  assert.deepEqual(ici((await p.enregistre())), ici(FLOW), 'rien n\'a changé');
});

test('page : « Renommer » : le nom se modifie sur le bloc ; nom vide ou pris refusé avec la raison ; les fils suivent le nouveau nom', async () => {
  const p = await page();
  await clicDroit(p.bloc('Si'));
  await p.bouton('Renommer', menu()!)!.emettre('click'); await attendre();
  assert.equal(menu(), null);
  const inp = p.bloc('Si').querySelector('.dr-renom')!;
  assert.ok(inp, 'un champ sur le bloc lui-même');
  assert.equal(inp.getAttribute('value'), 'Si'); assert.equal(actif, inp, 'le focus y va');
  inp.value = 'Fin'; await inp.emettre('keydown', { key: 'Enter' });
  const err = p.bloc('Si').querySelector('.dr-renom-e')!;
  assert.match(err.textContent, /« Fin » est déjà pris/, 'la raison est écrite sous le champ'); assert.equal(err.hidden, false);
  assert.equal(inp.getAttribute('aria-invalid'), 'true');
  inp.value = '   '; await inp.emettre('keydown', { key: 'Enter' });
  assert.match(p.bloc('Si').querySelector('.dr-renom-e')!.textContent, /vide/);
  assert.ok(p.bloc('Si').querySelector('.dr-renom'), 'toujours en cours : on peut corriger');
  inp.value = 'Contrôle du seuil'; await inp.emettre('keydown', { key: 'Enter' }); await attendre();
  assert.equal(p.body.querySelector('.dr-renom'), null, 'le champ disparaît');
  assert.ok(p.bloc('Contrôle du seuil'), 'le bloc porte son nouveau nom');
  assert.ok(p.fil('Lancer', 'Contrôle du seuil') && p.fil('Contrôle du seuil', 'Fin'), 'les fils suivent');
  const f = await p.enregistre();
  assert.deepEqual(f.nodes.map((n) => n.name), ['Lancer', 'Contrôle du seuil', 'Attendre', 'Fin']);
  assert.deepEqual(ici(f.connections), { Lancer: [[{ node: 'Contrôle du seuil' }]], 'Contrôle du seuil': [[{ node: 'Attendre' }], [{ node: 'Fin' }]] }, 'les fils, dans le même ordre');
  // Échap annule.
  await clicDroit(p.bloc('Fin'));
  await p.bouton('Renommer', menu()!)!.emettre('click'); await attendre();
  const i2 = p.bloc('Fin').querySelector('.dr-renom')!; i2.value = 'Autre';
  await i2.emettre('keydown', { key: 'Escape' }); await attendre();
  assert.equal(p.body.querySelector('.dr-renom'), null); assert.ok(p.bloc('Fin'), 'Échap : le nom ne change pas');
  assert.match(actif?.getAttribute('aria-label') ?? '', /^Fin \(/, 'le focus revient au bloc');
});

test('page : quitter le champ du nom l\'enregistre s\'il est bon, sinon le nom ne change pas et la raison est dite', async () => {
  const p = await page();
  await clicDroit(p.bloc('Attendre'));
  await p.bouton('Renommer', menu()!)!.emettre('click'); await attendre();
  let inp = p.bloc('Attendre').querySelector('.dr-renom')!; inp.value = 'Lancer';
  await inp.emettre('focusout', { relatedTarget: null }); await attendre();
  assert.equal(p.body.querySelector('.dr-renom'), null);
  assert.ok(p.bloc('Attendre'), 'nom pris : il ne change pas');
  assert.match(p.body.querySelector('#drSt')!.textContent, /« Lancer » est déjà pris/);
  await clicDroit(p.bloc('Attendre'));
  await p.bouton('Renommer', menu()!)!.emettre('click'); await attendre();
  inp = p.bloc('Attendre').querySelector('.dr-renom')!; inp.value = 'Pause';
  await inp.emettre('focusout', { relatedTarget: null }); await attendre();
  assert.ok(p.bloc('Pause'));
});

test('page : le double-clic sur le NOM d\'un bloc le renomme ; le double-clic sur un endroit vide garde son rôle (ajouter un bloc)', async () => {
  const p = await page();
  for (let i = 0; i < 2; i++) {
    const nom = nomDe(p, 'Fin');
    await nom.emettre('pointerdown', { clientX: 750, clientY: 310, pointerId: 1, button: 0, pointerType: 'mouse' });
    await nom.emettre('pointerup', { clientX: 750, clientY: 310, pointerId: 1, pointerType: 'mouse' });
  }
  const inp = p.bloc('Fin').querySelector('.dr-renom');
  assert.ok(inp, 'double-clic sur le nom : le champ du nom');
  await inp!.emettre('keydown', { key: 'Escape' }); await attendre();
  // Double-clic sur le bloc ailleurs que sur son nom : pas de renommage.
  for (let i = 0; i < 2; i++) {
    const b = p.bloc('Attendre');
    await b.emettre('pointerdown', { clientX: 750, clientY: 110, pointerId: 1, button: 0, pointerType: 'mouse' });
    await b.emettre('pointerup', { clientX: 750, clientY: 110, pointerId: 1, pointerType: 'mouse' });
  }
  assert.equal(p.body.querySelector('.dr-renom'), null, 'hors du nom : pas de renommage');
  // Double-clic sur le fond : la fenêtre de choix de l'étape 1.
  const c = canvasDe(p);
  for (let i = 0; i < 2; i++) { await c.emettre('pointerdown', { clientX: 50, clientY: 50, pointerId: 2, button: 0 }); await c.emettre('pointerup', { clientX: 50, clientY: 50, pointerId: 2 }); }
  await attendre();
  assert.ok(racine.querySelector('.dr-choix'), 'le double-clic sur le vide ajoute un bloc, comme avant');
});

test('page : « Ajouter une note » : un texte attaché au bloc, marqué sur le schéma et lisible ; « Modifier la note » ; la retirer', async () => {
  const p = await page();
  await clicDroit(p.bloc('Si'));
  await p.bouton('Ajouter une note', menu()!)!.emettre('click'); await attendre();
  const fen = fenNote()!;
  assert.ok(fen, 'une fenêtre pour la note');
  assert.equal(fen.getAttribute('role'), 'dialog');
  const ta = fen.querySelector('textarea')!;
  assert.equal(actif, ta, 'le focus va au texte');
  assert.equal(p.bouton('Retirer la note', fen), undefined, 'pas encore de note à retirer');
  ta.value = 'Seuil choisi avec Maëlle\nà revoir en mars';
  await p.bouton('Enregistrer la note', fen)!.emettre('click'); await attendre();
  assert.equal(fenNote(), null, 'la fenêtre se ferme');
  const b = p.bloc('Si');
  assert.ok(b.querySelector('.dr-note-m'), 'une petite marque sur le bloc');
  const desc = b.getAttribute('aria-describedby');
  assert.ok(desc && p.body.querySelector(`#${desc}`)?.textContent.includes('Seuil choisi avec Maëlle'), 'le bloc est décrit par sa note (lecteur d\'écran)');
  // Lisible au survol et au focus : une bulle avec le texte.
  await b.emettre('pointerenter', { pointerType: 'mouse' });
  assert.match(canvasDe(p).querySelector('.dr-note-bulle')?.textContent ?? '', /Seuil choisi avec Maëlle/, 'au survol');
  await b.emettre('pointerleave', { pointerType: 'mouse' });
  assert.equal(canvasDe(p).querySelector('.dr-note-bulle'), null, 'la souris partie, la bulle aussi');
  b.focus(); await b.emettre('focusin');
  assert.match(canvasDe(p).querySelector('.dr-note-bulle')?.textContent ?? '', /à revoir en mars/, 'au focus');
  await b.emettre('focusout');
  let f = await p.enregistre();
  assert.equal((f.nodes[1] as { note?: string }).note, 'Seuil choisi avec Maëlle\nà revoir en mars');
  assert.equal('note' in (f.nodes[2] as object), false, 'les autres blocs n\'ont rien de plus');
  // Modifier.
  await clicDroit(p.bloc('Si'));
  assert.deepEqual(choixDuMenu(), ['Renommer', 'Modifier la note', 'Retirer']);
  await p.bouton('Modifier la note', menu()!)!.emettre('click'); await attendre();
  assert.equal(fenNote()!.querySelector('textarea')!.textContent, 'Seuil choisi avec Maëlle\nà revoir en mars', 'la note d\'avant est reprise');
  fenNote()!.querySelector('textarea')!.value = 'Seuil à 3';
  await p.bouton('Enregistrer la note', fenNote()!)!.emettre('click'); await attendre();
  f = await p.enregistre(); assert.equal((f.nodes[1] as { note?: string }).note, 'Seuil à 3');
  // Annuler ne change rien ; Échap non plus.
  await clicDroit(p.bloc('Si')); await p.bouton('Modifier la note', menu()!)!.emettre('click'); await attendre();
  fenNote()!.querySelector('textarea')!.value = 'autre chose';
  await p.bouton('Annuler', fenNote()!)!.emettre('click'); await attendre();
  await clicDroit(p.bloc('Si')); await p.bouton('Modifier la note', menu()!)!.emettre('click'); await attendre();
  fenNote()!.querySelector('textarea')!.value = 'autre chose';
  await fenNote()!.emettre('keydown', { key: 'Escape' }); await attendre();
  assert.equal(fenNote(), null);
  f = await p.enregistre(); assert.equal((f.nodes[1] as { note?: string }).note, 'Seuil à 3');
  // Retirer la note.
  await clicDroit(p.bloc('Si')); await p.bouton('Modifier la note', menu()!)!.emettre('click'); await attendre();
  await p.bouton('Retirer la note', fenNote()!)!.emettre('click'); await attendre();
  assert.equal(p.bloc('Si').querySelector('.dr-note-m'), null, 'plus de marque');
  f = await p.enregistre();
  assert.deepEqual(ici(f), ici(FLOW), 'note retirée : la définition redevient exactement celle d\'avant');
});

test('page : « Retirer » : la même confirmation qu\'avant ; le bloc part avec ses fils ; « non » ne change rien', async () => {
  const q = await page(FLOW, false);
  await clicDroit(q.bloc('Si'));
  await q.bouton('Retirer', menu()!)!.emettre('click'); await attendre();
  assert.deepEqual(q.questions, ['Retirer l\'étape « Si » ?']);
  assert.ok(q.bloc('Si'), '« non » : le bloc reste');
  const p = await page();
  await clicDroit(p.bloc('Si'));
  await p.bouton('Retirer', menu()!)!.emettre('click'); await attendre();
  assert.deepEqual(p.questions, ['Retirer l\'étape « Si » ?'], 'la confirmation d\'aujourd\'hui');
  const f = await p.enregistre();
  assert.deepEqual(f.nodes.map((n) => n.name), ['Lancer', 'Attendre', 'Fin']);
  assert.deepEqual(ici(f.connections), { Lancer: [[]] }, 'ses fils partent avec lui');
});

test('page : un nom et une note piégés restent du texte (aucune balise créée)', async () => {
  const PIEGE = '<img src=x onerror="alert(1)">Bloc';
  const flow = { ...FLOW, nodes: FLOW.nodes.map((n) => (n.name === 'Fin' ? { ...n, name: PIEGE, note: '<script>alert(2)</script><b>note</b>' } : n)), connections: { ...FLOW.connections, Si: [[{ node: 'Attendre' }], [{ node: PIEGE }]] } };
  const p = await page(flow);
  const b = p.bloc(PIEGE);
  assert.ok(b.textContent.includes(PIEGE), 'le nom, tel quel');
  await b.emettre('pointerenter', { pointerType: 'mouse' });
  assert.equal(canvasDe(p).querySelector('.dr-note-bulle')!.textContent, '<script>alert(2)</script><b>note</b>');
  await clicDroit(b);
  assert.match(menu()!.getAttribute('aria-label') ?? '', /<img/);
  await p.bouton('Renommer', menu()!)!.emettre('click'); await attendre();
  const inp = p.body.querySelector('.dr-renom')!; inp.value = '<svg onload=alert(3)>'; await inp.emettre('keydown', { key: 'Enter' }); await attendre();
  await clicDroit(p.bloc('<svg onload=alert(3)>'));
  await p.bouton('Modifier la note', menu()!)!.emettre('click'); await attendre();
  assert.equal(fenNote()!.querySelector('textarea')!.textContent, '<script>alert(2)</script><b>note</b>');
  for (const t of ['IMG', 'SCRIPT']) assert.equal(racine.querySelectorAll(t.toLowerCase()).length, 0, `aucun ${t}`);
  assert.equal(racine.querySelectorAll('svg').length, 1, 'un seul SVG : celui des fils du schéma');
  assert.deepEqual(racine.tous().flatMap((x) => Object.keys(x.attrs).filter((k) => /^on/i.test(k))), [], 'aucun attribut « on… » posé');
  assert.ok(racine.tous().every((x) => !x.html), 'aucun innerHTML écrit');
});

test('page : une automatisation existante (avec et sans note) s\'ouvre et s\'enregistre à l\'identique', async () => {
  let p = await page();
  assert.deepEqual(ici(await p.enregistre()), ici(FLOW));
  const avec = { ...FLOW, nodes: FLOW.nodes.map((n) => (n.name === 'Attendre' ? { ...n, note: 'Pause pour Tomas' } : n)) };
  p = await page(avec);
  assert.ok(p.bloc('Attendre').querySelector('.dr-note-m'), 'la note d\'avant est marquée');
  // Au doigt (pas de survol) : toucher le bloc le choisit, et sa note se lit.
  const a = p.bloc('Attendre');
  await a.emettre('pointerdown', { clientX: 5, clientY: 5, pointerId: 1, pointerType: 'touch', button: 0 });
  await a.emettre('pointerup', { clientX: 5, clientY: 5, pointerId: 1, pointerType: 'touch' });
  assert.equal(canvasDe(p).querySelector('.dr-note-bulle')?.textContent, 'Pause pour Tomas', 'le bloc choisi montre sa note');
  await p.bloc('Lancer').emettre('pointerenter', { pointerType: 'mouse' });
  assert.equal(canvasDe(p).querySelector('.dr-note-bulle')?.textContent, 'Pause pour Tomas', 'survoler un bloc sans note ne cache pas celle du bloc choisi');
  assert.deepEqual(ici(await p.enregistre()), ici(avec));
});

test('page : survoler un bloc dont la note est vide ne cache pas la note du bloc choisi', async () => {
  const avec = { ...FLOW, nodes: FLOW.nodes.map((n) => (n.name === 'Attendre' ? { ...n, note: 'Pause pour Tomas' } : n.name === 'Lancer' ? { ...n, note: '' } : n)) };
  const p = await page(avec);
  assert.equal(p.bloc('Lancer').querySelector('.dr-note-m'), null, 'une note vide n\'est pas marquée');
  const a = p.bloc('Attendre');
  await a.emettre('pointerdown', { clientX: 5, clientY: 5, pointerId: 1, pointerType: 'touch', button: 0 });
  await a.emettre('pointerup', { clientX: 5, clientY: 5, pointerId: 1, pointerType: 'touch' });
  assert.equal(canvasDe(p).querySelector('.dr-note-bulle')?.textContent, 'Pause pour Tomas', 'le bloc choisi montre sa note');
  await p.bloc('Lancer').emettre('pointerenter', { pointerType: 'mouse' });
  assert.equal(canvasDe(p).querySelector('.dr-note-bulle')?.textContent, 'Pause pour Tomas', 'survoler un bloc à la note vide ne cache pas celle du bloc choisi');
});

// ------------------------------------------------------------------ renommer : les données prises chez le bloc le suivent
// Toutes les écritures que le moteur lit (src/draupnir/engine.ts, resolve et readPath) : $node["X"], $node['X'], $node.X,
// $node[12] (un bloc nommé « 12 »), avec ou sans espaces, suivies de .json, .items, [..] ou de rien. Rien d'autre.
const lit = (v: unknown, nom: string, json: unknown) => resolve(v, { $json: {}, $node: { [nom]: { json, items: [json] } }, $now: '', $today: '', $index: 0, $items: [], $workflow: { id: '', name: '' } } as never);
const JSON_FICHE = { nom: 'Ana', a: [7] };

test('renommer : chaque écriture que le moteur lit suit le nouveau nom, et le moteur y relit la même donnée', () => {
  const L = logique();
  const formes = [
    'Bonjour {{ $node["Fiche"].json.nom }} !', '{{ $node[\'Fiche\'].json.nom }}', '{{$node [ "Fiche" ] . json . nom}}',
    '{{ $node.Fiche.json.nom }}', '{{ $node . Fiche . json.nom }}', '{{ $node["Fiche"].json["nom"] }}', '{{ $node["Fiche"].json.a[0] }}',
    '{{ $node["Fiche"].items[0].nom }}', '{{ $node["Fiche"].json }}', '{{ $node["Fiche"] }}', 'a {{ $node["Fiche"].json.nom }} b {{ $node.Fiche.json.a }}',
  ];
  const noms = ['Fiche lue', 'Fiche2', 'Fiche "A"', 'l\'avis', '[x]', 'a]b', 'a\']b', 'a"]b', 'a\\b', '日本の表 ✓', 'قراءة الملف', 'Ὀδυσσεύς'];
  for (const t of formes) {
    const avant = lit(t, 'Fiche', JSON_FICHE);
    assert.notEqual(avant, undefined); assert.notEqual(avant, '');
    for (const vers of noms) {
      const r = L.renommerDans(t, 'Fiche', vers);
      assert.equal(typeof r, 'string', `${t} → ${vers}`);
      assert.deepEqual(lit(r, vers, JSON_FICHE), avant, `le moteur relit la même donnée chez « ${vers} » : ${r}`);
      assert.notDeepEqual(lit(r, 'Fiche', JSON_FICHE), avant, `plus rien ne vise l'ancien nom : ${r}`);
    }
  }
  // L'écriture d'avant est gardée quand le nouveau nom s'y écrit : seul le nom change.
  assert.equal(L.renommerDans('{{ $node["Fiche"].json.nom }}', 'Fiche', 'Fiche lue'), '{{ $node["Fiche lue"].json.nom }}');
  assert.equal(L.renommerDans('{{ $node[\'Fiche\'].json.nom }}', 'Fiche', 'Fiche lue'), '{{ $node[\'Fiche lue\'].json.nom }}');
  assert.equal(L.renommerDans('{{$node [ "Fiche" ] . json . nom}}', 'Fiche', 'Fiche lue'), '{{$node [ "Fiche lue" ] . json . nom}}');
  assert.equal(L.renommerDans('{{ $node.Fiche.json.nom }}', 'Fiche', 'Fiche2'), '{{ $node.Fiche2.json.nom }}');
  assert.equal(L.renommerDans('{{ $node.Fiche.json.nom }}', 'Fiche', 'Fiche lue'), '{{ $node["Fiche lue"].json.nom }}', 'le point ne prend pas d\'espace : des crochets');
  assert.equal(L.renommerDans('{{ $node["Fiche"].json.nom }}', 'Fiche', 'Fiche "A"'), '{{ $node[\'Fiche "A"\'].json.nom }}', 'l\'autre guillemet');
  assert.equal(L.renommerDans('{{ $node["Fiche"].json.Fiche }}', 'Fiche', 'Fiche lue'), '{{ $node["Fiche lue"].json.Fiche }}', 'une clé du même nom ne bouge pas');
  // Un bloc nommé par un nombre : $node[12] (et $node[012], que le moteur lit « 12 »).
  for (const t of ['{{ $node[12].json.nom }}', '{{ $node[012].json.nom }}', '{{ $node.12.json.nom }}']) {
    const r = L.renommerDans(t, '12', 'Treize')!;
    assert.equal(lit(t, '12', JSON_FICHE), 'Ana');
    assert.equal(lit(r, 'Treize', JSON_FICHE), 'Ana', `${t} → ${r}`);
  }
  assert.equal(L.renommerDans('{{ $node[12].json.nom }}', '12', '13'), '{{ $node[13].json.nom }}');
  assert.equal(L.renommerDans('{{ $node[012].json.nom }}', '012', 'X'), '{{ $node[012].json.nom }}', 'le moteur y lit « 12 », pas « 012 »');
});

test('renommer : un texte hors d\'une expression, un autre bloc au nom voisin, ce que le moteur ne lit pas : rien ne change', () => {
  const L = logique();
  for (const t of ['Fiche', 'la Fiche {{ $json.Fiche }}', '$node["Fiche"].json.a', '{{ $node["Fiche 2"].json.a }}', '{{ $node["Ma Fiche"].json.a }}',
    '{{ $node.Fiches.json.a }}', '{{ $node["Fich"].json.a }}', '{{ $Node["Fiche"].json.a }}', '{{ $nodes["Fiche"].json.a }}', '{{ $node["Fiche"].json.a + 1 }}',
    '{{ $node["Fiche"]. }}', '{{ $json["Fiche"] }}', '{{ $node["X"].json["Fiche"] }}', '{{ $node["X"].json.Fiche }}', '{ $node["Fiche"].json.a }', '{{ $node }}', '']) {
    assert.equal(L.renommerDans(t, 'Fiche', 'Fiche lue'), t, `inchangé : ${t}`);
  }
});

test('renommer : un nom que l\'expression ne saurait pas écrire → null ; dans des réglages rangés en texte JSON, ni guillemet double ni barre oblique inverse', () => {
  const L = logique(), t = '{{ $node["Fiche"].json.nom }}', j = '{"x":"{{ $node[\'Fiche\'].json.nom }}"}';
  for (const vers of ['a{b', 'a}b', 'ligne 1\nligne 2', 'constructor', '__proto__']) assert.equal(L.renommerDans(t, 'Fiche', vers), null, vers);
  for (const vers of ['Fiche "A"', 'a\\b', 'a\tb']) assert.equal(L.renommerDans(j, 'Fiche', vers, true), null, `JSON : ${vers}`);
  assert.equal(L.renommerDans('rien de cité', 'Fiche', 'a{b'), 'rien de cité', 'sans citation : rien à écrire, pas de refus');
  for (const vers of ['l\'avis', '[x]', '日本の表 ✓', 'قراءة الملف']) {
    const r = L.renommerDans(j, 'Fiche', vers, true)!;
    assert.equal(typeof r, 'string', vers);
    assert.doesNotThrow(() => JSON.parse(r), `le JSON reste valide : ${r}`);
    assert.deepEqual(JSON.parse(String(lit(r, vers, JSON_FICHE))), { x: 'Ana' }, `le moteur y relit la donnée : ${r}`);
  }
});

test('renommer dans toute l\'automatisation : chaque bloc qui cite l\'ancien nom (même deux fois), et seulement ses réglages lus par le moteur', () => {
  const L = logique();
  const CODE = 'return [{ a: "{{ $node[\\"Fiche\\"].json.a }}" }];';
  const cle = '{{ $node["Fiche"].json.k }}';
  const wf = (n: string) => ({ nodes: [
    { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [0, 0] },
    { name: 'Fiche', type: 'temps.attendre', params: { secondes: 1 }, position: [0, 0] },
    { name: 'Fiche 2', type: 'logique.si', params: { condition: '{{ $node["Fiche 2"].json.a }}' }, position: [0, 0] },
    { name: 'Si', type: 'logique.si', params: { condition: `{{ $node["${n}"].json.ok }} et {{ $node['${n}'].json.n }}` }, position: [0, 0], note: 'voir {{ $node["Fiche"].json.a }}' },
    { name: 'Hydre', type: 'module.action', params: { module: 'ymir', action: 'demarrer', entrée: `{"x":"{{ $node['${n}'].json.a }}","y":2}` }, position: [0, 0] },
    { name: 'Objet', type: 'module.action', params: { module: 'ymir', action: 'demarrer', entrée: { [cle]: [`{{ $node["${n}"].json.a }}`, 3, true, null] } }, position: [0, 0] },
    { name: 'Code', type: 'données.code', params: { code: CODE }, position: [0, 0] },
  ], connections: {} }) as unknown as Wf;
  const estJson = (_n: Noeud0, k: string) => k === 'entrée';
  const w = wf('Fiche'), r = L.suivreRenommage(w, 'Fiche', 'Fiche lue', estJson);
  assert.equal(r.ok, true);
  assert.deepEqual(ici(r.changes!.map((c) => [c.i, c.cle])), [[3, 'condition'], [4, 'entrée'], [5, 'entrée']], 'Fiche 2, la note, le code et la clé d\'un objet ne bougent pas');
  assert.deepEqual(ici(w), ici(wf('Fiche')), 'rien n\'est écrit avant qu\'on l\'applique');
  for (const c of r.changes!) w.nodes[c.i].params[c.cle] = c.valeur;
  assert.deepEqual(ici(w), ici(wf('Fiche lue')));
  // Un nom que la donnée rangée en texte JSON ne saurait pas écrire : refusé, rien n'est proposé.
  const r2 = L.suivreRenommage(wf('Fiche'), 'Fiche', 'Fiche "A"', estJson);
  assert.equal(r2.ok, false); assert.match(r2.error!, /« Hydre »/); assert.equal(r2.changes, undefined);
  // Sans rien qui le cite, tout nom permis l'est encore.
  assert.deepEqual(ici(L.suivreRenommage(wf('Fiche'), 'Lancer', 'a{b', estJson)), { ok: true, changes: [] });
});

test('renommer : un nom que des données visent déjà (un bloc qui n\'existe plus) est refusé, sinon A → B → A ne rendrait pas l\'automatisation de départ', () => {
  const L = logique();
  const wf = (cond: unknown, code = '') => ({ nodes: [
    { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [0, 0] },
    { name: 'A', type: 'temps.attendre', params: { secondes: 1 }, position: [0, 0] },
    { name: 'Si', type: 'logique.si', params: { condition: cond }, position: [0, 0], note: 'voir {{ $node["C"].json.ok }}' },
    { name: 'Code', type: 'données.code', params: { code }, position: [0, 0] },
  ], connections: {} }) as unknown as Wf;
  // Chaque écriture que lit le moteur, dans un texte, une liste, un objet : refusé, avec le bloc qui la porte.
  for (const orpheline of ['{{ $node["B"].json.ok }}', '{{ $node[\'B\'].json.ok }}', '{{ $node.B.json.ok }}', ['x', '{{$node [ "B" ] . json}}'], { k: '{{ $node["B"].json.ok }}' }]) {
    const cond = Array.isArray(orpheline) ? ['{{ $node["A"].json.ok }}', ...orpheline] : typeof orpheline === 'object' ? { a: '{{ $node["A"].json.ok }}', ...orpheline } : `{{ $node["A"].json.ok }} / ${orpheline}`;
    const w = wf(cond), avant = ici(w), r = L.suivreRenommage(w, 'A', 'B');
    assert.equal(r.ok, false, JSON.stringify(orpheline)); assert.match(r.error!, /« Si ».*« B »/); assert.equal(r.changes, undefined);
    assert.deepEqual(ici(w), avant, 'rien n\'est écrit');
  }
  const n12 = L.suivreRenommage(wf('{{ $node["A"].json.ok }} / {{ $node[012].json.ok }}'), 'A', '12');
  assert.equal(n12.ok, false, 'le bloc « 12 » visé par $node[012]');
  // Ce que le moteur ne résout pas (la note, le code d'un bloc « Code », le texte hors {{ }}, un nom voisin) ne compte pas.
  const libre = wf('B : {{ $node["A"].json.ok }} / {{ $node["B 2"].json.ok }} / {{ $nodes["B"].json }}', 'return [{ a: "{{ $node[\\"C\\"].json.a }}" }];');
  assert.equal(L.suivreRenommage(libre, 'A', 'B').ok, true);
  assert.equal(L.suivreRenommage(libre, 'A', 'C').ok, true);
});

/** Lancer → Fiche → Fiche 2 → Si → Hydre : Si et Hydre prennent des données chez « Fiche » (et Si chez « Fiche 2 »). */
const FLOW_D = { id: 'f2', name: 'Données', active: false, nodes: [
  { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] },
  { name: 'Fiche', type: 'temps.attendre', params: { secondes: 1 }, position: [340, 160] },
  { name: 'Fiche 2', type: 'temps.attendre', params: { secondes: 2 }, position: [620, 160] },
  { name: 'Si', type: 'logique.si', params: { condition: 'Fiche : {{ $node["Fiche"].json.ok }} et {{ $node[\'Fiche\'].json.n }} puis {{ $node["Fiche 2"].json.ok }}' }, position: [900, 160] },
  { name: 'Hydre', type: 'module.action', params: { module: 'ymir', action: 'verifier_isos', entrée: '{"x":"{{ $node[\'Fiche\'].json.a }}"}' }, position: [1180, 160] },
], connections: { Lancer: [[{ node: 'Fiche' }]], Fiche: [[{ node: 'Fiche 2' }]], 'Fiche 2': [[{ node: 'Si' }]], Si: [[{ node: 'Hydre' }], []] } };

async function renommerParMenu(p: P, de: string, vers: string, touche = 'Enter') {
  await clicDroit(p.bloc(de));
  await p.bouton('Renommer', menu()!)!.emettre('click'); await attendre();
  const inp = p.bloc(de).querySelector('.dr-renom')!; inp.value = vers;
  if (touche) { await inp.emettre('keydown', { key: touche }); await attendre(); }
  return inp;
}

test('page : renommer par le menu, puis par le double-clic sur le nom : les données suivent ; revenir au premier nom rend l\'automatisation de départ', async () => {
  const p = await page(FLOW_D);
  await renommerParMenu(p, 'Fiche', 'Fiche lue');
  let f = await p.enregistre();
  assert.equal(f.nodes[3].params.condition, 'Fiche : {{ $node["Fiche lue"].json.ok }} et {{ $node[\'Fiche lue\'].json.n }} puis {{ $node["Fiche 2"].json.ok }}');
  assert.equal((f.nodes[4].params as Record<string, unknown>).entrée, '{"x":"{{ $node[\'Fiche lue\'].json.a }}"}');
  assert.equal(f.nodes[2].params.secondes, 2);
  for (let i = 0; i < 2; i++) {
    const nom = nomDe(p, 'Fiche lue');
    await nom.emettre('pointerdown', { clientX: 400, clientY: 170, pointerId: 1, button: 0, pointerType: 'mouse' });
    await nom.emettre('pointerup', { clientX: 400, clientY: 170, pointerId: 1, pointerType: 'mouse' });
  }
  const inp = p.bloc('Fiche lue').querySelector('.dr-renom')!; inp.value = 'Fiche';
  await inp.emettre('keydown', { key: 'Enter' }); await attendre();
  f = await p.enregistre();
  assert.deepEqual(ici(f), ici(FLOW_D), 'A → B → A : l\'automatisation de départ, à l\'identique');
});

test('page : le panneau ouvert sur un bloc qui prend une donnée chez le bloc renommé montre aussitôt le nouveau nom', async () => {
  const p = await page(FLOW_D);
  await p.bloc('Si').emettre('keydown', { key: 'Enter' }); await attendre();
  const avant = p.body.querySelector('#drp-condition')!;
  assert.deepEqual(avant.querySelectorAll('.dr-pastille').map((x) => x.querySelector('.dr-p-t')!.textContent), ['Fiche · ok', 'Fiche · n', 'Fiche 2 · ok']);
  await renommerParMenu(p, 'Fiche', 'Fiche lue');
  const pa = p.body.querySelector('#drp-condition')!.querySelectorAll('.dr-pastille');
  assert.deepEqual(pa.map((x) => x.querySelector('.dr-p-t')!.textContent), ['Fiche lue · ok', 'Fiche lue · n', 'Fiche 2 · ok']);
  assert.ok(pa.every((x) => !x.classList.contains('bad')), 'aucune n\'est marquée « renommé »');
  assert.deepEqual(pa.map((x) => x.getAttribute('data-src')), ['{{ $node["Fiche lue"].json.ok }}', '{{ $node[\'Fiche lue\'].json.n }}', '{{ $node["Fiche 2"].json.ok }}']);
  // Par le champ « Nom de l'étape » du panneau.
  await p.bloc('Fiche lue').emettre('keydown', { key: 'Enter' }); await attendre();
  const nn = p.body.querySelector('#drNn')!; nn.value = 'Fiche ✓'; await nn.emettre('change', { target: { value: 'Fiche ✓' } }); await attendre();
  const f = await p.enregistre();
  assert.equal(f.nodes[1].name, 'Fiche ✓');
  assert.equal(f.nodes[3].params.condition, 'Fiche : {{ $node["Fiche ✓"].json.ok }} et {{ $node[\'Fiche ✓\'].json.n }} puis {{ $node["Fiche 2"].json.ok }}');
  assert.equal((f.nodes[4].params as Record<string, unknown>).entrée, '{"x":"{{ $node[\'Fiche ✓\'].json.a }}"}');
});

test('page : un renommage refusé (nom pris, vide, ou que les données ne sauraient pas écrire) ne réécrit rien', async () => {
  const p = await page(FLOW_D);
  let inp = await renommerParMenu(p, 'Fiche', 'Fiche 2');
  assert.match(p.bloc('Fiche').querySelector('.dr-renom-e')!.textContent, /« Fiche 2 » est déjà pris/);
  inp.value = ''; await inp.emettre('keydown', { key: 'Enter' });
  assert.match(p.bloc('Fiche').querySelector('.dr-renom-e')!.textContent, /vide/);
  inp.value = 'Fiche "A"'; await inp.emettre('keydown', { key: 'Enter' }); await attendre();
  assert.ok(p.bloc('Fiche').querySelector('.dr-renom'), 'toujours en cours : on peut corriger');
  assert.match(p.bloc('Fiche').querySelector('.dr-renom-e')!.textContent, /« Hydre »/, 'la raison nomme le bloc dont la donnée ne s\'écrirait pas');
  await inp.emettre('keydown', { key: 'Escape' }); await attendre();
  // Quitter le champ avec ce nom : refusé aussi, la raison dans la ligne d'état.
  inp = await renommerParMenu(p, 'Fiche', 'Fiche "A"', '');
  await inp.emettre('focusout', { relatedTarget: null }); await attendre();
  assert.ok(p.bloc('Fiche')); assert.match(p.body.querySelector('#drSt')!.textContent, /Nom inchangé.*« Hydre »/);
  // Par le panneau.
  await p.bloc('Fiche').emettre('keydown', { key: 'Enter' }); await attendre();
  const nn = p.body.querySelector('#drNn')!; nn.value = 'Fiche "A"'; await nn.emettre('change', { target: nn }); await attendre();
  assert.equal(nn.value, 'Fiche');
  assert.deepEqual(ici(await p.enregistre()), ici(FLOW_D), 'rien n\'a changé');
});

test('page : renommer un bloc du nom d\'un bloc qui n\'existe plus et que des données visent encore est refusé, avec la raison ; rien ne change', async () => {
  const flow = ici(FLOW_D); flow.nodes[3].params.condition += ' et {{ $node["Fiche 3"].json.ok }}';
  const p = await page(flow);
  const inp = await renommerParMenu(p, 'Fiche', 'Fiche 3');
  assert.ok(p.bloc('Fiche').querySelector('.dr-renom'), 'toujours en cours : on peut corriger');
  assert.match(p.bloc('Fiche').querySelector('.dr-renom-e')!.textContent, /« Si ».*« Fiche 3 »/);
  await inp.emettre('keydown', { key: 'Escape' }); await attendre();
  assert.deepEqual(ici(await p.enregistre()), ici(flow), 'rien n\'a changé');
});
