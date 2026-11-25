// Talos, l'éditeur à nœuds (src/web/flows.js) : les liaisons nommées et le « Filtrer » posé sur la liaison.
// - Un « Si » : ses deux liaisons portent le nom de leur sortie (« oui », « non »), écrit au milieu de chacune.
// - Un « Filtrer » : dessiné comme un petit rond sur la liaison (le trait passe à travers lui). Il reste un bloc : même
//   menu, mêmes données, même place enregistrée ; rien de ce qui est enregistré ne change.
// - Logique (sans document), page (petit document simulé), puis un vrai navigateur à 390 et 1280 px, en clair et en
//   sombre, quand Playwright est là (NODE_PATH vers ses modules).
// Valeurs neutres seulement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after, before } from 'node:test';
import vm from 'node:vm';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';
import { startDraupnir } from '../src/draupnir/odin.ts';

const FLOWS = readFileSync(new URL('../src/web/flows.js', import.meta.url), 'utf8');
const LIEN = readFileSync(new URL('../src/web/pages/talos-lien.js', import.meta.url), 'utf8');

type Pos = [number, number];
interface Logique {
  TYPE_FILTRE: string; SORTIES_NOMMEES: string[]; NODE_W: number;
  milieuLien: (x1: number, y1: number, x2: number, y2: number) => Pos;
  departLien: (pos: Pos, i?: number, m?: number) => Pos;
  arriveeLien: (pos: Pos) => Pos;
  yDessin: (y: number) => number;
  yEnregistre: (y: number) => number;
  zoneBulle: (k?: number, m?: number, filtre?: boolean) => Rect;
  zonesBloc: (k?: number, m?: number) => { plus: Rect; entree: Rect; sorties: Rect[]; nom: Rect };
}
type Rect = { g: number; h: number; d: number; b: number };
const recouvre = (a: Rect, b: Rect) => a.g < b.d && b.g < a.d && a.h < b.b && b.h < a.b;
const ZOOMS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.4, 1.6];
/** Le petit rond du filtre (centre et rayon, dans sa case dessinée, comme sa règle de style : left:73px;top:26px;44 px). */
const PETIT = { x: 95, y: 48, r: 22 };
/** La zone du « ⋯ » du filtre au zoom k (sa règle : 44 px à l'écran, centrée sur le rond, bas à 36 px). */
const menuFiltre = (k: number): Rect => { const z = Math.max(44, 44 / k); return { g: 95 - z / 2, h: 36 - z, d: 95 + z / 2, b: 36 }; };
function logique(): Logique {
  const win: { OdinFlows?: { logique: Logique } } = {};
  const document = { readyState: 'complete', head: { append() {} }, createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), createTextNode: () => ({}), addEventListener() {} };
  vm.runInNewContext(FLOWS, { window: win, document });
  return win.OdinFlows!.logique;
}

test('logique : le milieu d\'une liaison (la courbe dessinée, à mi-chemin) ; le « Si » a des sorties nommées ; le type du filtre', () => {
  const L = logique();
  assert.deepEqual([...L.milieuLien(0, 0, 200, 100)], [100, 50]);
  assert.deepEqual([...L.milieuLien(540, 389, 919, 180)], [729.5, 284.5]);
  assert.deepEqual([...L.SORTIES_NOMMEES], ['logique.si'], 'le « Si » seulement (ce que le plan nomme)');
  assert.equal(L.TYPE_FILTRE, 'logique.filtre');
});

test('logique : la bulle du filtre touche le bord de son petit rond (en haut à droite), sans rien recouvrir, à tous les zooms', () => {
  const L = logique();
  // À la taille réelle : le coin de la pastille (bas gauche) est à moins de 12 px du bord du rond (avant : environ 40 px).
  const b1 = L.zoneBulle(1, 1, true), ecart = Math.hypot(b1.g - PETIT.x, b1.b - PETIT.y) - PETIT.r;
  assert.ok(ecart >= 0 && ecart <= 12, `la pastille touche presque le rond (écart ${ecart.toFixed(1)} px)`);
  assert.ok(b1.g >= PETIT.x && b1.b <= PETIT.y, 'en haut à droite du rond, comme sur un grand bloc');
  // Un bloc ordinaire garde sa place d'hier (rien ne change pour lui).
  assert.deepEqual(L.zoneBulle(1, 1, false), L.zoneBulle(1, 1)); assert.equal(L.zoneBulle(1).g, 142);
  for (const k of ZOOMS) {
    const b = L.zoneBulle(k, 1, true), z = L.zonesBloc(k, 1), dit = `zoom ${k}`;
    assert.ok((b.d - b.g) * k >= 44 - 1e-9 && (b.b - b.h) * k >= 44 - 1e-9, `${dit} : 44 px à l'écran`);
    assert.equal(recouvre(b, menuFiltre(k)), false, `${dit} : le « ⋯ » du filtre`);
    assert.equal(recouvre(b, z.plus), false, `${dit} : le « + »`);
    assert.equal(recouvre(b, z.entree), false, `${dit} : le rond d'entrée`);
    for (const s of z.sorties) assert.equal(recouvre(b, s), false, `${dit} : la sortie`);
    assert.equal(recouvre(b, { g: 73, h: 26, d: 117, b: 70 }), false, `${dit} : le petit rond lui-même`);
  }
});

// ------------------------------------------------------------------ un petit document simulé (comme les essais des fils)
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
    '/api/draupnir/applis': () => ({ ok: true, applis: [] }),
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
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

// Le catalogue : les blocs du moteur, tels que l'éditeur les reçoit (sorties du « Si » : oui, non).
const CATALOG = [
  { type: 'déclencheur.manuel', label: 'Lancer à la main', group: 'Déclencheurs', trigger: true, params: [] },
  { type: 'logique.si', label: 'Si', group: 'Logique', outputs: ['oui', 'non'], params: [{ key: 'valeur', default: '{{ $json.statut }}' }] },
  { type: 'logique.filtre', label: 'Filtrer', group: 'Logique', params: [{ key: 'valeur', default: '{{ $json.statut }}' }, { key: 'opérateur', default: 'existe' }] },
  { type: 'logique.attendre', label: 'Attendre', group: 'Logique', params: [{ key: 'secondes', default: 5 }] },
];
// Une automatisation enregistrée d'avant (rien n'y est ajouté) : un Si, un Filtrer entre deux blocs.
const FLOW = { id: 'l1', name: 'Liaisons', active: false, nodes: [
  { name: 'Lancer', type: 'déclencheur.manuel', params: {}, position: [60, 160] as Pos },
  { name: 'Si', type: 'logique.si', params: { valeur: '{{ $json.a }}', opérateur: 'égal', comparer: '1' }, position: [340, 160] as Pos },
  { name: 'Garder', type: 'logique.filtre', params: { valeur: '{{ $json.b }}', opérateur: 'existe', comparer: '' }, position: [620, 60] as Pos },
  { name: 'Après', type: 'logique.attendre', params: { secondes: 5 }, position: [900, 60] as Pos },
  { name: 'Sinon', type: 'logique.attendre', params: { secondes: 1 }, position: [620, 300] as Pos },
], connections: { Lancer: [[{ node: 'Si' }]], Si: [[{ node: 'Garder' }], [{ node: 'Sinon' }]], Garder: [[{ node: 'Après' }]] } as Record<string, Array<Array<{ node: string }>>> };

test('page : les deux liaisons d\'un « Si » portent le nom de leur sortie, au milieu de chacune ; écrit comme du texte', async () => {
  const L = logique(), p = await page(ici(FLOW));
  const noms = p.body.querySelectorAll('.dr-fil-nom');
  assert.deepEqual(noms.map((x) => x.textContent), ['oui', 'non'], 'deux liaisons nommées');
  for (const [i, vers] of [[0, 'Garder'], [1, 'Sinon']] as const) {
    const b = FLOW.nodes.find((n) => n.name === vers)!.position;
    const [x1, y1] = L.departLien(FLOW.nodes[1].position, i, 2), [x2, y2] = L.arriveeLien(b), [mx, my] = L.milieuLien(x1, y1, x2, y2);
    assert.equal(Number(noms[i].getAttribute('x')), mx); assert.equal(Number(noms[i].getAttribute('y')), my);
    assert.equal(noms[i].getAttribute('aria-hidden'), 'true', 'le lien le dit déjà au lecteur d\'écran');
    assert.equal(noms[i].html, '', 'jamais d\'innerHTML');
  }
  assert.equal(p.fil('Si', 'Garder')!.getAttribute('aria-label'), 'Lien Si → Garder (sortie oui)');
  // Toujours le mot « oui » / « non » au rond de sortie (rien de retiré).
  assert.deepEqual(p.bloc('Si').querySelectorAll('.dr-pl').map((x) => x.textContent), ['oui', 'non']);
  assert.match(p.css, /\.dr-fil-nom\{[^}]*pointer-events:none/);
  assert.match(p.css, /\.dr-fil-nom\{[^}]*paint-order:stroke/, 'lisible devant les points de la liaison');
});

test('page : le « Filtrer » est un petit rond posé sur la liaison (le trait passe à travers lui), son nom dessous', async () => {
  const L = logique(), p = await page(ici(FLOW));
  const f = p.bloc('Garder');
  assert.ok(f.classList.contains('dr-filtre'));
  assert.equal(f.getAttribute('aria-label'), 'Garder (Filtrer)', 'le même nom pour le lecteur d\'écran');
  assert.ok(!p.bloc('Après').classList.contains('dr-filtre') && !p.bloc('Si').classList.contains('dr-filtre'));
  assert.equal(f.querySelectorAll('.dr-rond').length, 1); assert.equal(f.querySelector('.dr-nom')!.textContent, 'Garder');
  // Le trait à travers lui : de son rond d'entrée à son rond de sortie, à mi-hauteur.
  const t = p.body.querySelectorAll('.dr-traverse');
  assert.equal(t.length, 1);
  const [x1, y1] = L.arriveeLien([620, 60]), [x2, y2] = L.departLien([620, 60]);
  assert.equal(t[0].getAttribute('d'), `M${x1},${y1} L${x2},${y2}`);
  assert.ok(t[0].classList.contains('dr-link'), 'dessiné comme une liaison (petits ronds)');
  // Le petit rond : 44 px dessinés ; sa zone de toucher garde 44 px à l'écran même dézoomé ; le reste de la case laisse passer.
  const r = /\.dr-node\.dr-filtre \.dr-rond\{([^}]*)\}/.exec(p.css)?.[1] ?? '';
  assert.match(r, /width:44px/); assert.match(r, /height:44px/);
  assert.match(p.css, /\.dr-node\.dr-filtre \.dr-rond::after\{[^}]*var\(--dr-z,44px\)/);
  assert.match(p.css, /\.dr-node\.dr-filtre\{[^}]*pointer-events:none/); assert.match(p.css, /\.dr-node\.dr-filtre>\*\{pointer-events:auto\}/);
  // Il garde ses ronds à relier, son « + », son « ⋯ ».
  assert.equal(f.querySelectorAll('.dr-port').length, 2); assert.equal(f.querySelectorAll('.dr-plus').length, 1); assert.equal(f.querySelectorAll('.dr-mb').length, 1);
});

test('page : la règle de la bulle du filtre dit la même place que la logique ; sa pastille des réglages manquants ne passe jamais sous elle', async () => {
  const L = logique(), p = await page(ici(FLOW));
  const regle = (sel: string) => new RegExp(`(?:^|[}\\n])${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(p.css)?.[1] ?? '';
  // Calcule une longueur de la règle (calc, min, var) pour un zoom donné.
  const vaut = (t: string, k: number) => {
    const z = Math.max(44, 44 / k), x = t.replace(/var\(--dr-z,44px\)/g, `${z}px`).replace(/var\(--dr-sh,48px\)/g, '48px');
    assert.match(x, /^[\d.\s+\-*/(),a-z]*$/, x);
    return Function(`return ${x.replace(/calc\(/g, '(').replace(/min\(/g, 'Math.min(').replace(/max\(/g, 'Math.max(').replace(/px/g, '')};`)() as number;
  };
  const r = regle('.dr-node.dr-filtre .dr-bulle');
  const left = /(?:^|;)left:([^;]+)/.exec(r)?.[1], top = /(?:^|;)top:([^;]+)/.exec(r)?.[1];
  assert.ok(left && top, `la règle de la bulle du filtre : ${r}`);
  for (const k of ZOOMS) {
    const z = Math.max(44, 44 / k), b = L.zoneBulle(k, 1, true);
    assert.ok(Math.abs(vaut(left!, k) - b.g) < 1e-6, `zoom ${k} : left ${vaut(left!, k)} / ${b.g}`);
    assert.ok(Math.abs(vaut(top!, k) + z - b.b) < 1e-6, `zoom ${k} : bas ${vaut(top!, k) + z} / ${b.b}`);
  }
  // Le « ⋯ » du filtre : bas à 36 px (ce que menuFiltre suppose).
  assert.match(regle('.dr-node.dr-filtre .dr-mb'), /top:calc\(36px - var\(--dr-z,44px\)\)/);
  // La pastille des réglages manquants du filtre : près de son petit rond (en bas à gauche), jamais sous sa bulle.
  const m = regle('.dr-node.dr-filtre .dr-manque'), px = (k: string) => Number(new RegExp(`(?:^|;)${k}:(-?[\\d.]+)px`).exec(m)?.[1]);
  const manque: Rect = { g: px('left'), h: px('top'), d: px('left') + 22, b: px('top') + 22 };
  assert.ok(Number.isFinite(manque.g) && Number.isFinite(manque.h), `la règle de la pastille du filtre : ${m}`);
  for (const k of ZOOMS) assert.equal(recouvre(L.zoneBulle(k, 1, true), manque), false, `zoom ${k} : pastille sous la bulle`);
  const ec = Math.hypot((manque.g + manque.d) / 2 - PETIT.x, (manque.h + manque.b) / 2 - PETIT.y) - PETIT.r - 11;
  assert.ok(ec >= 0 && ec <= 8, `la pastille touche presque le petit rond (écart ${ec.toFixed(1)} px)`);
  assert.ok(manque.h >= PETIT.y + 2, 'sous le trait qui traverse le rond');
  assert.ok(manque.b <= 76, 'au-dessus du nom');
});

test('page : le menu du petit rond est celui d\'un bloc (mêmes choix) ; au clavier comme au doigt', async () => {
  const p = await page(ici(FLOW));
  assert.ok(p.bloc('Garder').classList.contains('dr-filtre'), 'le petit rond');
  const choix = async (nom: string) => {
    await p.bloc(nom).emettre('contextmenu', { clientX: 10, clientY: 10 }); await attendre();
    const m = menu(); assert.ok(m, `menu de ${nom}`);
    const t = m!.querySelectorAll('button').map((b) => b.textContent.trim()); await m!.emettre('keydown', { key: 'Escape' }); await attendre(); return t;
  };
  const filtre = await choix('Garder'), autre = await choix('Après');
  assert.ok(filtre.length >= 4, filtre.join('|'));
  assert.deepEqual(filtre, autre, 'les mêmes choix que tout autre bloc');
  // Au clavier : le bloc se choisit (Entrée) ; il reste dans l'ordre de tabulation.
  await p.bloc('Garder').emettre('keydown', { key: 'Enter' }); await attendre();
  assert.ok(p.bloc('Garder').classList.contains('sel'));
  assert.equal(p.bloc('Garder').getAttribute('tabindex'), '0');
});

test('page : le petit rond se déplace comme un bloc ; sa place enregistrée change seule, rien d\'autre', async () => {
  const L = logique(), p = await page(ici(FLOW));
  const k = Number(/scale\(([\d.]+)\)/.exec(p.body.querySelector('.dr-world')!.style.transform ?? '')?.[1] ?? 1);
  assert.ok(p.bloc('Garder').classList.contains('dr-filtre'), 'le petit rond');
  const r = p.bloc('Garder').querySelector('.dr-rond')!;
  await r.emettre('pointerdown', { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  await r.emettre('pointermove', { clientX: 160, clientY: 144, pointerId: 1 });
  await r.emettre('pointerup', { clientX: 160, clientY: 144, pointerId: 1 }); await attendre();
  const w = await p.enregistre();
  const g = w.nodes.find((n) => n.name === 'Garder')!;
  assert.deepEqual(g.position, [Math.round(620 + 60 / k), L.yEnregistre(L.yDessin(60) + 44 / k)], 'déplacé du geste à l\'écran');
  // Le reste : identique (mêmes données, même type, mêmes liens).
  const sans = (x: typeof w) => x.nodes.map((n) => ({ ...n, position: n.name === 'Garder' ? null : n.position }));
  assert.deepEqual(ici(sans(w)), ici(sans(FLOW as unknown as typeof w))); assert.deepEqual(ici(w.connections), ici(FLOW.connections));
});

test('page : une automatisation d\'avant s\'ouvre au même endroit et s\'enregistre à l\'identique (rien d\'ajouté)', async () => {
  const L = logique(), p = await page(ici(FLOW));
  for (const n of FLOW.nodes) {
    const d = p.bloc(n.name);
    assert.match(d.getAttribute('style') ?? '', new RegExp(`left:${n.position[0]}px;top:${L.yDessin(n.position[1])}px`), n.name);
  }
  const w = await p.enregistre();
  assert.deepEqual(ici(w.nodes), ici(FLOW.nodes)); assert.deepEqual(ici(w.connections), ici(FLOW.connections));
});

// ------------------------------------------------------------------ dans un vrai navigateur (390 et 1280 px, clair et sombre)
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, window: any;
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  evaluate<R, A = unknown>(f: string | ((a: A) => R), a?: A): Promise<R>; waitForTimeout(ms: number): Promise<void>;
  on(e: string, f: (x: { type?: () => string; text?: () => string } & Error) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
  mouse: { click(x: number, y: number, o?: Record<string, unknown>): Promise<void> };
  keyboard: { press(k: string): Promise<void> };
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: (() => void) | string): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let od: VraiOdin, nav: Navigateur, idFlux = '';
before(async () => {
  if (!pw) return;
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  od = await vraiOdin(tt, { compte: true });
  // Talos n'est pas lancé par vraiOdin : on le démarre (comme les autres essais de Talos dans un vrai Odin).
  tt.onEnd(startDraupnir(od.o, async () => undefined));
  const r = await od.json('/api/draupnir/save', { flow: { name: FLOW.name, active: false, nodes: FLOW.nodes, connections: FLOW.connections } });
  idFlux = String((r.body.flow as { id?: string } | undefined)?.id ?? '');
  assert.ok(idFlux, JSON.stringify(r.body));
  // Un passage (jusqu'au filtre) : les bulles se posent, celle du filtre comprise.
  const x = await od.json('/api/draupnir/run', { id: idFlux, items: [{ json: { a: '1', b: 'x' } }], stopAfter: 'Garder' });
  assert.equal((x.body as { ok?: boolean }).ok, true, JSON.stringify(x.body));
  // L'apparence d'origine (comme le banc de qualité) : le clair et le sombre se choisissent alors par odin.theme.
  await od.json('/api/valhalla/act', { module: 'apparence', action: 'theme', input: { theme: 'valhalla' } });
  nav = await pw.chromium.launch();
});
after(async () => { await nav?.close(); await tt.end(); Object.assign(console, orig); });

for (const largeur of [390, 1280]) for (const theme of ['light', 'dark'] as const) {
  test(`navigateur, ${largeur} px, ${theme === 'light' ? 'clair' : 'sombre'} : les noms « oui » et « non » sur les liaisons, le petit rond du filtre touchable (44 px), son menu, rien qui déborde`, { skip: sans }, async () => {
    const doigt = largeur < 500;
    const ctx = await nav.newContext({ viewport: { width: largeur, height: doigt ? 844 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: theme });
    try {
      const [n, ...v] = od.session.split('='); await ctx.addCookies([{ name: n, value: v.join('='), url: od.url, httpOnly: true, sameSite: 'Strict' }]);
      // Le vrai clair ou le vrai sombre (colorScheme seul ne suffit pas : le thème du compte l'emporterait).
      await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.theme', ${JSON.stringify(theme === 'light' ? 'clair' : 'sombre')}); } catch {}`);
      const page = await ctx.newPage(), erreurs: string[] = [];
      page.on('pageerror', (e) => erreurs.push(String(e)));
      await page.goto(od.url + '/'); await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
      await page.evaluate(async (id: string) => { window.OdinShow('flows'); await window.OdinFlows.edit(id); }, idFlux);
      await page.waitForSelector('#drCanvas .dr-node.dr-filtre', { timeout: 20000 }); await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const noms = [...document.querySelectorAll('#drCanvas .dr-fil-nom')].map((t: any) => { const r = t.getBoundingClientRect(), s = getComputedStyle(t); return { t: t.textContent, w: r.width, h: r.height, fill: s.fill, stroke: s.stroke, vis: s.visibility }; });
        const rond = document.querySelector('#drCanvas .dr-node.dr-filtre .dr-rond').getBoundingClientRect(), cv = document.querySelector('#drCanvas').getBoundingClientRect();
        const cx = rond.left + rond.width / 2, cy = rond.top + rond.height / 2;
        // La zone touchable : au moins 44 px de large et de haut autour du milieu du rond (le bloc filtre répond).
        const touche = (dx: number, dy: number) => { const e = document.elementFromPoint(cx + dx, cy + dy); return Boolean(e?.closest?.('.dr-node.dr-filtre')); };
        const dedans = cx > cv.left && cx < cv.right && cy > cv.top && cy < cv.bottom;
        return { noms, rond: { w: rond.width, h: rond.height }, zone: dedans ? [touche(-21, 0), touche(21, 0), touche(0, -21), touche(0, 21)] : null, deborde: document.documentElement.scrollWidth > window.innerWidth + 1, grand: document.querySelector('#drCanvas .dr-node:not(.dr-filtre) .dr-rond').getBoundingClientRect().width, bulle: (() => {
        // La bulle du filtre (après le passage), dans sa case dessinée, ramenée au schéma (÷ le zoom).
        const f = document.querySelector('#drCanvas .dr-node.dr-filtre'), b = f.querySelector('.dr-bulle'); if (!b) return null;
        const t = getComputedStyle(document.querySelector('#drCanvas .dr-world')).transform, x = /^matrix\(([-\d.e]+)/.exec(t), k = x ? Number(x[1]) : 1;
        const nr = f.getBoundingClientRect(), br = b.getBoundingClientRect();
        return { k, g: (br.left - nr.left) / k, b: (br.bottom - nr.top) / k };
      })() };
      });
      assert.deepEqual(m.noms.map((x) => x.t), ['oui', 'non']);
      for (const x of m.noms) { assert.ok(x.w > 0 && x.h > 0 && x.vis === 'visible', `« ${x.t} » se voit`); assert.notEqual(x.fill, x.stroke, 'le texte se détache de son contour'); }
      assert.ok(m.rond.w < m.grand / 2 + 1, `le rond du filtre est petit (${m.rond.w} contre ${m.grand})`);
      assert.ok(m.zone, 'le petit rond se voit dans la fenêtre du schéma (sinon sa zone ne serait pas vérifiée)');
      assert.deepEqual(m.zone, [true, true, true, true], 'zone de toucher de 44 px autour du petit rond');
      // Le vrai clair ou le vrai sombre : le nom écrit sur la liaison est foncé en clair, clair en sombre.
      const lum = (c: string) => { const [r, g, b] = (c.match(/[\d.]+/g) ?? []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
      for (const x of m.noms) assert.ok(theme === 'light' ? lum(x.fill) < 0.5 : lum(x.fill) > 0.5, `« ${x.t} » en ${theme} : ${x.fill}`);
      // La bulle du filtre : à la place que dit la logique (au bord de son petit rond), dans le vrai navigateur.
      assert.ok(m.bulle, 'la bulle du filtre après le passage');
      const attendu = logique().zoneBulle(m.bulle!.k, 1, true);
      assert.ok(Math.abs(m.bulle!.g - attendu.g) < 1.5 && Math.abs(m.bulle!.b - attendu.b) < 1.5, `bulle ${JSON.stringify(m.bulle)} / ${JSON.stringify(attendu)}`);
      // Ouverte, la bulle des données pointe sur elle.
      await page.evaluate(() => document.querySelector('#drCanvas .dr-node.dr-filtre .dr-bulle').click());
      await page.waitForSelector('#drPassage', { timeout: 5000 }); await page.waitForTimeout(100);
      const vise = await page.evaluate(() => { const b = document.querySelector('#drCanvas .dr-node.dr-filtre .dr-bulle').getBoundingClientRect(), d = document.querySelector('#drPassage'), c = document.querySelector('#drCanvas').getBoundingClientRect(), r = d.getBoundingClientRect(); return { centre: b.left + b.width / 2 - c.left, pointe: r.left - c.left + Number.parseFloat(d.style.getPropertyValue('--dr-pointe') || 'NaN') }; });
      assert.ok(Math.abs(vise.centre - vise.pointe) < 2, `la pointe vise la bulle du filtre : ${JSON.stringify(vise)}`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      assert.equal(m.deborde, false, 'rien ne déborde de la largeur de l\'écran');
      // Son menu : au clavier (touche Menu sur le bloc).
      await page.evaluate(() => document.querySelector('#drCanvas .dr-node.dr-filtre').focus());
      await page.keyboard.press('Shift+F10'); await page.waitForSelector('.dr-fil-menu', { timeout: 5000 });
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('.dr-fil-menu button')].length >= 4));
      await page.keyboard.press('Escape');
      if (process.env.TALOS_CAPTURES) await page.screenshot({ path: `${process.env.TALOS_CAPTURES}/liaisons-${largeur}-${theme}.png` });
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  });
}
declare function getComputedStyle(n: unknown): { fill: string; stroke: string; visibility: string; transform: string };
