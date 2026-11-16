// Genèse · clé USB — le COMPOSEUR (src/web/pages/thjalfi-cle-composer.js) et l'APERÇU DU MENU
// (src/web/pages/thjalfi-cle-menu.js). Ces fichiers sont du JavaScript de navigateur servi tel quel : on vérifie
// qu'ils passent `node --check`, qu'ils se greffent (window.OdinGeneseCleComposer / window.OdinGeneseCleMenu),
// que leur logique PURE est juste (cible, trois choix, limites honnêtes, résumé du plan, entrées du menu), et que
// le rendu produit les trois choix et le plan SANS fenêtre native du navigateur (tout passe par OdinDialog).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const urlDe = (f: string) => new URL(`../src/web/pages/${f}`, import.meta.url);
const lire = (f: string) => readFileSync(urlDe(f), 'utf8');
const SRC_COMP = lire('thjalfi-cle-composer.js');
const SRC_MENU = lire('thjalfi-cle-menu.js');

// Un faux document minimal : el() n'en a besoin que pour créer des nœuds et rassembler du texte. Une vraie classe
// (pas Object.assign, qui figerait les accesseurs) pour que textContent reste calculé.
function fauxDom() {
  class Node {
    tag: string; _children: Node[]; _text: string; _attrs: Record<string, string>; className: string; style: { cssText: string };
    constructor(tag: string) { this.tag = tag; this._children = []; this._text = ''; this._attrs = {}; this.className = ''; this.style = { cssText: '' }; }
    setAttribute(k: string, v: string) { this._attrs[k] = String(v); }
    getAttribute(k: string) { return this._attrs[k]; }
    addEventListener() {}
    append(...ks: unknown[]) { for (const c of ks) if (c != null) this._children.push(c instanceof Node ? c : new Txt(String(c))); }
    appendChild(c: Node) { this._children.push(c); return c; }
    replaceChildren(...ks: unknown[]) { this._children = []; this.append(...ks); }
    querySelector() { return null; }
    get textContent(): string { return (this._text || '') + this._children.map((c) => c.textContent).join(''); }
    set textContent(v: string) { this._text = String(v); this._children = []; }
  }
  class Txt extends Node { constructor(s: string) { super('#text'); this._text = String(s); } override get textContent() { return this._text; } override set textContent(v: string) { this._text = String(v); } }
  const document = { createElement: (t: string) => new Node(t), createElementNS: (_n: string, t: string) => new Node(t), createTextNode: (s: string) => new Txt(s), body: new Node('body'), head: new Node('head'), getElementById: () => null };
  return { Node, document };
}

type Comp = {
  ouvrir: unknown;
  logique: {
    cibleDepuis: (d: unknown) => { id: string; genre: string; tailleOctets: number; estOdin: boolean };
    choix: () => Array<{ id: string; titre: string; desc: string }>;
    limites: (c: string, f: string) => string[];
    grosDisque: (c: { genre: string; tailleOctets: number }) => boolean;
    planResume: (p: unknown) => { peutEcrire: boolean; blocage: string; lignes: Array<{ efface: boolean; texte: string }>; resteGo: number; avertissements: string[] };
    phraseOk: (s: unknown) => boolean;
    entreesMenu: (e: unknown) => Array<{ nom: string; genre: string; demarrable: boolean }>;
    serialiser: (s: unknown) => Record<string, unknown>;
  };
  rendu: { carteSysteme: (s: unknown, o?: unknown) => { textContent: string }; cartePlan: (p: unknown) => { textContent: string } };
};

function chargerComposeur(dom?: { Node: unknown; document: unknown }): Comp {
  const win: { OdinGeneseCleComposer?: Comp } = {};
  const ctx: Record<string, unknown> = { window: win, setTimeout, clearTimeout, fetch: () => Promise.resolve({ json: async () => ({}) }), console };
  if (dom) { ctx.document = dom.document; ctx.Node = dom.Node; }
  vm.runInNewContext(SRC_COMP, ctx);
  assert.ok(win.OdinGeneseCleComposer, 'window.OdinGeneseCleComposer est posé');
  return win.OdinGeneseCleComposer;
}

type Menu = {
  construire: unknown; ouvrir: unknown;
  logique: { grouper: (e: unknown[]) => { groupes: Array<{ famille: string; entrees: unknown[] }>; apart: unknown[] }; filtrer: (e: unknown[], q: string) => unknown[]; demo: (n?: number) => unknown[]; info: (g: string) => { libelle: string; demarrable: boolean } };
};
function chargerMenu(dom?: { Node: unknown; document: unknown }): Menu {
  const win: { OdinGeneseCleMenu?: Menu } = {};
  const ctx: Record<string, unknown> = { window: win, setTimeout, clearTimeout, console };
  if (dom) { ctx.document = dom.document; ctx.Node = dom.Node; }
  vm.runInNewContext(SRC_MENU, ctx);
  assert.ok(win.OdinGeneseCleMenu, 'window.OdinGeneseCleMenu est posé');
  return win.OdinGeneseCleMenu;
}

test('les deux fichiers passent node --check (JavaScript valide)', () => {
  for (const f of ['thjalfi-cle-composer.js', 'thjalfi-cle-menu.js']) {
    execFileSync(process.execPath, ['--check', fileURLToPath(urlDe(f))]);
  }
});

test('composeur : se greffe et expose ouvrir + logique', () => {
  const C = chargerComposeur();
  assert.equal(typeof C.ouvrir, 'function');
  assert.equal(typeof C.logique.cibleDepuis, 'function');
  assert.equal(typeof C.rendu.carteSysteme, 'function');
});

test('composeur : la cible suit le genre (clé / disque externe / disque interne)', () => {
  const { cibleDepuis } = chargerComposeur().logique;
  assert.equal(cibleDepuis({ id: 'a', genre: 'cle', externe: true, tailleOctets: 32 * 1024 ** 3 }).genre, 'cle');
  assert.equal(cibleDepuis({ id: 'b', genre: 'disque-externe', externe: true, tailleOctets: 2 * 1024 ** 4 }).genre, 'disque-externe');
  assert.equal(cibleDepuis({ id: 'c', genre: 'ssd', externe: true, tailleOctets: 1 }).genre, 'disque-externe');
  assert.equal(cibleDepuis({ id: 'd', genre: 'interne', externe: false, tailleOctets: 1 }).genre, 'disque-interne');
  assert.equal(cibleDepuis({ id: 'e', genre: 'cle', externe: true, tailleOctets: 1, estOdin: true }).estOdin, true);
});

test('composeur : il y a bien TROIS choix, dans l\'ordre iso / installe / vm', () => {
  const ch = chargerComposeur().logique.choix();
  assert.equal(ch.map((c) => c.id).join(','), 'iso,installe,vm');
  assert.match(ch[0].titre, /ISO/);
  assert.match(ch[1].titre, /installé/i);
  assert.match(ch[2].titre, /VM/);
});

test('composeur : les limites sont dites honnêtement par choix et famille', () => {
  const { limites } = chargerComposeur().logique;
  const win = limites('installe', 'windows').join(' ');
  assert.match(win, /[Ll]icence/);
  assert.match(win, /lent/);
  assert.match(win, /Secure Boot|MokManager/);
  assert.match(win, /bcdboot|hôte.*Windows/);
  const linux = limites('installe', 'linux').join(' ');
  assert.match(linux, /persistance|Ubuntu|Debian/);
  const pers = limites('persistance', 'linux').join(' ');
  assert.match(pers, /Ventoy/);
  const vmL = limites('vm', 'windows').join(' ');
  assert.match(vmL, /pilotes/);
  assert.match(vmL, /instantané|arrête/);
});

test('composeur : le résumé du plan distingue effacé / gardé et le reste', () => {
  const { planResume } = chargerComposeur().logique;
  const r = planResume({ possible: true, partitions: [{ role: 'ISO ODIN', tailleGo: 10, efface: true }, { role: 'WinToGo', tailleGo: 32, efface: false }], resteGo: 20, avertissements: ['clé lente'] });
  assert.equal(r.peutEcrire, true);
  assert.equal(r.lignes.length, 2);
  assert.equal(r.lignes[0].efface, true);
  assert.equal(r.lignes[1].efface, false);
  assert.equal(r.resteGo, 20);
  assert.deepEqual(r.avertissements, ['clé lente']);
  assert.equal(planResume({ possible: false, blocage: 'trop petit' }).peutEcrire, false);
});

test('composeur : la confirmation forte demande la phrase exacte', () => {
  const { phraseOk } = chargerComposeur().logique;
  assert.equal(phraseOk('EFFACER'), true);
  assert.equal(phraseOk('  effacer '), true);
  assert.equal(phraseOk('oui'), false);
  assert.equal(phraseOk(''), false);
  assert.equal(phraseOk(null), false);
});

test('composeur : les entrées du menu réunissent systèmes installés, VM et fichiers de la racine', () => {
  const { entreesMenu } = chargerComposeur().logique;
  const e = entreesMenu({
    systemes: [{ nom: 'Win', choix: 'installe', famille: 'windows' }, { nom: 'VM1', choix: 'vm', famille: 'linux' }],
    racine: [{ nom: 'x.iso', genre: 'iso', demarrable: true }, { nom: 'notes.txt', genre: 'non-demarrable', demarrable: false }],
  });
  assert.equal(e.length, 4);
  assert.equal(e.map((x) => x.genre).join(','), 'installe,vm,iso,non-demarrable');
  assert.equal(e[3].demarrable, false);
});

test('composeur : serialiser rend le descripteur du contrat (choix + champs optionnels)', () => {
  const { serialiser } = chargerComposeur().logique;
  const o = serialiser({ nom: 'Ubuntu', famille: 'linux', choix: 'persistance', persistance: { label: 'casper-rw', tailleMo: 8192, fs: 'ext4' } });
  assert.equal(o.choix, 'persistance');
  assert.equal(o.mode, 'installer');
  assert.ok(o.persistance);
  const v = serialiser({ nom: 'VM', famille: 'windows', choix: 'vm', vmSource: { origine: 'proxmox', nom: 'VM', famille: 'windows' } });
  assert.equal(v.choix, 'vm');
  assert.ok(v.vmSource);
});

test('composeur : le rendu produit les trois choix et le plan (faux document, aucune fenêtre native)', () => {
  const dom = fauxDom();
  const C = chargerComposeur(dom);
  const carte = C.rendu.carteSysteme({ nom: 'Ubuntu', famille: 'linux', choix: 'installe' }, {});
  const t = carte.textContent;
  assert.match(t, /ISO qui démarre/);
  assert.match(t, /Système installé/);
  assert.match(t, /Copie d'une VM/);
  // Sous-choix Linux et limites honnêtes rendus.
  assert.match(t, /Persistance|Installation complète/);
  const plan = C.rendu.cartePlan({ possible: true, partitions: [{ role: 'ISO ODIN', tailleGo: 10, efface: true }, { role: 'WinToGo', tailleGo: 32, efface: false }], resteGo: 20, avertissements: ['clé lente'] });
  const p = plan.textContent;
  assert.match(p, /Plan de place/);
  assert.match(p, /ISO ODIN/);
  assert.match(p, /effacé/);
  assert.match(p, /gardé/);
  assert.match(p, /Reste libre/);
  assert.match(p, /clé lente/);
});

test('composeur : aucune fenêtre native (confirm / alert / prompt du navigateur)', () => {
  assert.doesNotMatch(SRC_COMP, /(^|[^.\w])(confirm|alert|prompt)\(/m, 'tout passe par OdinDialog');
  assert.match(SRC_COMP, /OdinDialog/, 'OdinDialog est bien utilisé');
  assert.match(SRC_COMP, /prefers-reduced-motion/);
});

test('menu : se greffe, groupe par famille, filtre, et la démo fait 20+ entrées', () => {
  const M = chargerMenu();
  assert.equal(typeof M.construire, 'function');
  assert.equal(typeof M.ouvrir, 'function');
  const d = M.logique.demo(24);
  assert.ok(d.length >= 24, '24 entrées ou plus');
  const g = M.logique.grouper(d as unknown[]);
  assert.ok(g.groupes.length >= 2, 'plusieurs familles');
  assert.ok(g.apart.length >= 1, 'les non-démarrables sont à part');
  const f = M.logique.filtrer([{ nom: 'Ubuntu', type: 'Live', famille: 'linux' }, { nom: 'Windows', type: '', famille: 'windows' }], 'ubun');
  assert.equal(f.length, 1);
  assert.equal(M.logique.info('non-demarrable').demarrable, false);
});

test('menu : le rendu liste 20+ entrées lisibles avec recherche (faux document)', () => {
  const dom = fauxDom();
  const M = chargerMenu(dom);
  const noeud = (M.construire as (e: unknown, o?: unknown) => { textContent: string })(M.logique.demo(24), { defaut: 'Windows 11 (installé) #1', delai: 10 });
  const t = noeud.textContent;
  assert.match(t, /Menu de démarrage ODIN/);
  assert.match(t, /Windows/);
  assert.match(t, /par défaut/);
  assert.match(t, /démarre seul après 10 s/);
  assert.doesNotMatch(SRC_MENU, /(^|[^.\w])(confirm|alert|prompt)\(/m, 'aucune fenêtre native');
});
