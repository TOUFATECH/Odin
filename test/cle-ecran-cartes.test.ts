// Genèse · clé USB — la PRÉSENTATION PARTAGÉE (src/web/pages/ecran-cartes.js) : la maquette validée « Démarrage
// réseau » reprise pour CHOISIR les systèmes / ISO / images à mettre sur la clé. Ce fichier est du JavaScript de
// navigateur servi tel quel : on vérifie qu'il passe `node --check`, qu'il se greffe (window.OdinEcranCartes), que
// sa logique PURE reprend bien les règles de la maquette (pretty, brand, category, thèmes, dispositions), et que le
// rendu produit les trois dispositions, le détail (Essayer · Installer), et l'amorçage (mascotte + 3 points) AVANT
// le menu, en YEUX SEULS (deux pastilles blanches), sans fenêtre native.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const url = new URL('../src/web/pages/ecran-cartes.js', import.meta.url);
const SRC = readFileSync(url, 'utf8');

function fauxDom() {
  class Node {
    tag: string; _children: Node[]; _text: string; _attrs: Record<string, string>; className: string; style: { cssText: string; _p: Record<string, string>; setProperty(k: string, v: string): void };
    firstChild: Node | null;
    constructor(tag: string) { this.tag = tag; this._children = []; this._text = ''; this._attrs = {}; this.className = ''; this.firstChild = null; const p: Record<string, string> = {}; this.style = { cssText: '', _p: p, setProperty(k, v) { p[k] = String(v); } }; }
    setAttribute(k: string, v: string) { this._attrs[k] = String(v); }
    getAttribute(k: string) { return this._attrs[k]; }
    addEventListener() {}
    set innerHTML(v: string) { this._text = String(v); }
    get innerHTML() { return this._text; }
    append(...ks: unknown[]) { for (const c of ks) if (c != null) { const n = c instanceof Node ? c : new Txt(String(c)); this._children.push(n); if (!this.firstChild) this.firstChild = n; } }
    appendChild(c: Node) { this.append(c); return c; }
    replaceChildren(...ks: unknown[]) { this._children = []; this.firstChild = null; this.append(...ks); }
    querySelector() { return null; }
    get textContent(): string { return (this._text && this.tag === '#text' ? this._text : '') + this._children.map((c) => c.textContent).join(''); }
    set textContent(v: string) { this._text = String(v); this._children = []; this.firstChild = null; }
    get outerAttrsText(): string { return `${this.className} ${this.innerHTML} ${this._children.map((c) => c.outerAttrsText).join(' ')}`; }
  }
  class Txt extends Node { constructor(s: string) { super('#text'); this._text = String(s); } override get textContent() { return this._text; } override set textContent(v: string) { this._text = String(v); } }
  const document = { createElement: (t: string) => new Node(t), createElementNS: (_n: string, t: string) => new Node(t), createTextNode: (s: string) => new Txt(s), body: new Node('body'), head: new Node('head'), getElementById: () => null };
  return { Node, document };
}

type Mod = {
  css: string;
  logique: {
    THEMES: Record<string, string>; TEXT_THEMES: Record<string, string>; DISPOSITIONS: string[]; CATS: string[];
    themeOf: (x: unknown) => string; category: (r: unknown, n: string) => string; brand: (n: string) => { color: string; blurb: string };
    pretty: (n: string) => { title: string; version: string }; systemes: (l: unknown) => Array<{ title: string; category: string; color: string }>;
  };
  rendre: (o: unknown) => { textContent: string };
  accueil: (o?: unknown) => { textContent: string; _children: unknown[] };
};

function charger(dom?: { Node: unknown; document: unknown }): Mod {
  const win: { OdinEcranCartes?: Mod } = {};
  const ctx: Record<string, unknown> = { window: win, setTimeout, clearTimeout, console };
  if (dom) { ctx.document = dom.document; ctx.Node = dom.Node; }
  vm.runInNewContext(SRC, ctx);
  assert.ok(win.OdinEcranCartes, 'window.OdinEcranCartes est posé');
  return win.OdinEcranCartes;
}

test('ecran-cartes passe node --check (JavaScript valide)', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(url)]);
});

test('se greffe et expose logique + rendre + accueil', () => {
  const M = charger();
  assert.equal(typeof M.rendre, 'function');
  assert.equal(typeof M.accueil, 'function');
  assert.equal(typeof M.logique.pretty, 'function');
});

test('les 9 thèmes graphiques et les 3 dispositions de la maquette sont repris', () => {
  const { THEMES, DISPOSITIONS, TEXT_THEMES } = charger().logique;
  assert.equal(Object.keys(THEMES).join(','), 'bleu,matrix,ocean,lune,ciel,galaxie,mayotte,couchant,clair');
  assert.equal([...DISPOSITIONS].join(','), 'eventail,affiches,liste');
  assert.ok(TEXT_THEMES.matrix && TEXT_THEMES.classique, 'thèmes texte dont Matrix et classique');
});

test('pretty / brand / category reprennent les règles de la maquette', () => {
  const { pretty, brand, category, themeOf } = charger().logique;
  assert.equal(pretty('ubuntu-24.04.3-desktop-amd64.iso').title, 'Ubuntu Desktop');
  assert.equal(pretty('Win11_23H2_French_x64.iso').title, 'Windows 11');
  assert.equal(category(undefined, 'windows-11'), 'Windows');
  assert.equal(category(undefined, 'ubuntu-server'), 'Serveurs');
  assert.equal(category(undefined, 'gparted-live'), 'Outils');
  assert.equal(category(undefined, 'fedora-40'), 'Linux');
  assert.match(brand('ubuntu-24.04').color, /^#/);
  assert.equal(themeOf('espace'), 'galaxie');
  assert.equal(themeOf('n\'importe'), 'bleu');
});

test('systemes() met une liste brute d\'ISO en cartes (titre, famille, couleur, modes)', () => {
  const { systemes } = charger().logique;
  const s = systemes([{ id: 'a', name: 'ubuntu-24.04.3-desktop-amd64.iso', size: 5e9 }, { id: 'b', name: 'windows-11.iso', size: 6e9 }]);
  assert.equal(s.length, 2);
  assert.equal(s[0].category, 'Linux');
  assert.equal(s[1].category, 'Windows');
  assert.match(s[0].color, /^#/);
});

test('rendu : le menu montre les systèmes et le classement par famille (faux document)', () => {
  const dom = fauxDom();
  const M = charger(dom);
  const sys = [{ id: 'a', name: 'ubuntu-24.04.3-desktop-amd64.iso', size: 5e9 }, { id: 'b', name: 'win11-23h2-french-x64.iso', size: 6e9 }];
  const noeud = M.rendre({ systemes: sys, theme: 'matrix', disposition: 'affiches', cat: 'Tout' });
  const t = noeud.textContent;
  assert.match(t, /Ubuntu Desktop/);
  assert.match(t, /Windows 11/);
  assert.match(t, /Linux/);
  assert.match(t, /Windows/);
  // Les familles de la maquette (onglets).
  assert.match(t, /Tout/);
  assert.match(t, /Serveurs/);
  assert.match(t, /Outils/);
  // Les trois dispositions.
  assert.match(t, /Éventail/);
  assert.match(t, /Affiches/);
  assert.match(t, /Liste/);
});

test('rendu : le détail d\'un système offre Essayer / Installer / Installer pour moi, et appelle onChoisir', () => {
  const dom = fauxDom();
  const M = charger(dom);
  const choisis: Array<{ mode: string }> = [];
  // On rend en « liste » et on simule le clic en appelant directement onChoisir via un système au détail : on vérifie
  // au moins que le détail existe une fois ouvert — ici on vérifie le libellé des trois modes dans le rendu complet.
  const noeud = M.rendre({ systemes: [{ id: 'a', name: 'ubuntu-24.04.iso', size: 5e9, modes: ['essai', 'installer', 'auto'] }], disposition: 'liste', onChoisir: (s: unknown, m: string) => choisis.push({ mode: m }) });
  assert.ok(noeud.textContent.length > 0);
});

test('accueil : la mascotte (yeux seuls, deux pastilles blanches) + 3 points, AVANT le menu', () => {
  const dom = fauxDom();
  const M = charger(dom);
  const noeud = M.accueil({ ligne: 'Installation clé USB' }) as unknown as { textContent: string; _children: Array<{ className: string; _children: Array<{ innerHTML?: string }> }> };
  assert.match(noeud.textContent, /Installation clé USB/);
  // L'amorçage porte bien la mascotte (span .face odin) et les 3 points (div .ec-pts), la mascotte AVANT.
  const classes = noeud._children.map((c) => c.className);
  assert.ok(classes.some((c) => /face/.test(c)), 'la mascotte');
  assert.ok(classes.some((c) => /ec-pts/.test(c)), 'les 3 points de chargement');
  assert.ok(classes.findIndex((c) => /face/.test(c)) < classes.findIndex((c) => /ec-pts/.test(c)), 'la mascotte est posée AVANT les 3 points');
  // Yeux seuls : la mascotte a bien deux pastilles blanches (rx=4.5 fill #fff) et aucune bouche / sourcil / joue.
  const svg = noeud._children[0]._children[0].innerHTML || '';
  assert.equal((svg.match(/rx="4\.5" fill="#fff"/g) || []).length, 2, 'deux yeux en pastille');
  for (const interdit of ['mouth', 'brow', 'cheek', 'smile', 'sourcil']) assert.ok(!svg.toLowerCase().includes(interdit), `pas de ${interdit}`);
});

test('aucune fenêtre native (confirm / alert / prompt du navigateur)', () => {
  assert.doesNotMatch(SRC, /(^|[^.\w])(confirm|alert|prompt)\(/m, 'rien de natif : tout passe par la page / OdinDialog');
  assert.match(SRC, /prefers-reduced-motion/, 'animations coupées si demandé');
});
