// Le message commun « hors ligne » et le repli d'image (src/web/pages/hors-ligne.js), plus l'état réseau partagé
// (src/web/pages/reseau.js). Les deux fichiers sont chargés dans un petit faux DOM (node:vm), sans navigateur ni réseau :
// on vérifie que message(...) dit bien quoi / pourquoi / depuis / ce qu'on montre à la place (marqué « ancien »), que
// « Réessayer » rappelle bien la fonction donnée, et que OdinImgRepli pose un onerror qui remplace l'image cassée.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// ---- un faux DOM minimal ----
class Noeud {
  nodeType = 1;
  tag: string;
  ns?: string;
  attrs = new Map<string, string>();
  kids: Noeud[] = [];
  handlers = new Map<string, Array<(e?: unknown) => void>>();
  style: Record<string, string> = {};
  parentNode: Noeud | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  disabled = false;
  width = 0;
  alt = '';
  private _text = '';
  id = '';
  constructor(tag: string, ns?: string) { this.tag = tag; this.ns = ns; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); if (k === 'id') this.id = v; if (k === 'alt') this.alt = v; }
  getAttribute(k: string) { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  addEventListener(t: string, fn: (e?: unknown) => void) { const l = this.handlers.get(t) ?? []; l.push(fn); this.handlers.set(t, l); }
  fire(t: string, e?: unknown) { for (const fn of this.handlers.get(t) ?? []) fn(e); }
  append(...n: Array<Noeud | string>) { for (const x of n) { const nd = typeof x === 'string' ? txtNode(x) : x; nd.parentNode = this; this.kids.push(nd); } }
  prepend(...n: Noeud[]) { for (const x of [...n].reverse()) { x.parentNode = this; this.kids.unshift(x); } }
  remove() { if (!this.parentNode) return; const i = this.parentNode.kids.indexOf(this); if (i >= 0) this.parentNode.kids.splice(i, 1); this.parentNode = null; }
  replaceWith(n: Noeud) { if (!this.parentNode) return; const i = this.parentNode.kids.indexOf(this); if (i >= 0) { n.parentNode = this.parentNode; this.parentNode.kids[i] = n; } }
  replaceChild(neuf: Noeud, vieux: Noeud) { const i = this.kids.indexOf(vieux); if (i >= 0) { neuf.parentNode = this; this.kids[i] = neuf; } }
  querySelector(sel: string) { const cls = sel.startsWith('.') ? sel.slice(1) : null; const tag = cls ? null : sel; const go = (n: Noeud): Noeud | null => { for (const k of n.kids) { if (cls && (k.getAttribute('class') ?? '').split(/\s+/).includes(cls)) return k; if (tag && k.tag === tag) return k; const d = go(k); if (d) return d; } return null; }; return go(this); }
  set textContent(v: string) { this._text = v; this.kids = []; }
  get textContent(): string { if (this.kids.length === 0) return this._text; return this.kids.map((k) => k.textContent).join(''); }
}
function txtNode(s: string): Noeud { const n = new Noeud('#text'); n.nodeType = 3; n.textContent = s; return n; }

function faireDoc() {
  const head = new Noeud('head');
  const body = new Noeud('body');
  const doc = {
    head, body,
    createElement: (t: string) => new Noeud(t),
    createElementNS: (ns: string, t: string) => new Noeud(t, ns),
    createTextNode: (s: string) => txtNode(s),
    getElementById: (id: string): Noeud | null => { const go = (n: Noeud): Noeud | null => { if (n.id === id) return n; for (const k of n.kids) { const d = go(k); if (d) return d; } return null; }; return go(body); },
  };
  return doc;
}

type Monde = { win: Record<string, any>; doc: ReturnType<typeof faireDoc> };
function charger(): Monde {
  const doc = faireDoc();
  const listeners = new Map<string, Array<(e?: unknown) => void>>();
  const win: Record<string, any> = {
    addEventListener: (t: string, fn: (e?: unknown) => void) => { const l = listeners.get(t) ?? []; l.push(fn); listeners.set(t, l); },
    _emit: (t: string, detail: unknown) => { for (const fn of listeners.get(t) ?? []) fn({ detail }); },
  };
  class CustomEvent { type: string; detail: unknown; constructor(t: string, o: { detail: unknown }) { this.type = t; this.detail = o.detail; } }
  const ctx = { window: win, document: doc, CustomEvent, Date, Number, Object, Math, String } as Record<string, unknown>;
  for (const f of ['hors-ligne.js', 'reseau.js']) {
    const src = readFileSync(new URL(`../src/web/pages/${f}`, import.meta.url), 'utf8');
    vm.runInNewContext(src, ctx);
  }
  return { win, doc };
}

test('hors-ligne : les deux fichiers se chargent sans navigateur et posent leurs objets', () => {
  const { win } = charger();
  assert.ok(win.OdinHorsLigne, 'window.OdinHorsLigne posé');
  assert.ok(win.OdinImgRepli, 'window.OdinImgRepli posé');
  assert.ok(win.OdinReseau, 'window.OdinReseau posé');
});

test('message(...) : dit quoi, pourquoi, depuis quand, et montre l\'ancien marqué comme tel', () => {
  const { win } = charger();
  const depuis = new Date(); depuis.setHours(14, 2, 0, 0);
  const node = win.OdinHorsLigne.message({ quoi: 'La météo n\'a pas pu être mise à jour', pourquoi: 'Open-Meteo ne répond pas depuis 10 min', depuis: depuis.getTime(), ancien: 'dernières prévisions du 16/11 à 14 h' });
  const t = node.textContent;
  assert.match(t, /La météo n'a pas pu être mise à jour/);
  assert.match(t, /Open-Meteo ne répond pas depuis 10 min/);
  assert.match(t, /depuis 14 h 02/);
  assert.match(t, /dernières prévisions du 16\/11/);
  assert.match(t, /Ancien/);
  // Sans fonction de reprise : on annonce que ça repart tout seul (pas de bouton).
  assert.match(t, /Ça repartira tout seul/);
});

test('message(...) : « Réessayer » rappelle bien la fonction donnée', async () => {
  const { win } = charger();
  let appels = 0;
  const node = win.OdinHorsLigne.message({ quoi: 'Rien', onReessayer: () => { appels++; } });
  const btn = node.querySelector('button');
  assert.ok(btn, 'un bouton Réessayer existe');
  assert.match(btn.textContent, /Réessayer/);
  btn.fire('click');
  await Promise.resolve();
  assert.equal(appels, 1, 'la fonction de reprise a été appelée');
});

test('message(...) : sans « pourquoi », la cause est lue dans l\'état réseau partagé', () => {
  const { win } = charger();
  win.OdinReseau.appliquer({ reseau: 'sans-reseau', depuis: Date.now(), verifieA: Date.now(), services: {} });
  const node = win.OdinHorsLigne.message({ quoi: 'La carte ne charge pas' });
  assert.match(node.textContent, /pas de réseau du tout/);
});

test('OdinImgRepli.brancher : pose un onerror qui essaie le repli puis une pastille (jamais d\'image cassée)', () => {
  const { win } = charger();
  const parent = new Noeud('div');
  const img = new Noeud('img'); img.setAttribute('alt', 'GitHub'); parent.append(img);
  win.OdinImgRepli.brancher(img, { repli: '/icone-locale.svg', lettre: 'G' });
  assert.equal(typeof img.onerror, 'function', 'onerror est branché');
  // 1er échec : on bascule sur le repli local.
  img.onerror!();
  assert.equal(img.getAttribute('src'), null); // setAttribute non utilisé ; on vérifie via la propriété
  assert.equal((img as any).src, '/icone-locale.svg', 'le repli local est tenté');
  // 2e échec : la pastille remplace l'image.
  img.onerror!();
  const rempl = parent.kids[0];
  assert.notEqual(rempl, img, 'l\'image a été remplacée');
  assert.match(rempl.textContent, /G/, 'la pastille porte la lettre');
});

test('OdinImgRepli.brancher : sans repli, l\'échec remplace directement par la pastille', () => {
  const { win } = charger();
  const parent = new Noeud('div');
  const img = new Noeud('img'); img.setAttribute('alt', 'Vidéo'); parent.append(img);
  win.OdinImgRepli.brancher(img, { lettre: 'V' });
  img.onerror!();
  assert.notEqual(parent.kids[0], img);
  assert.match(parent.kids[0].textContent, /V/);
});

test('OdinReseau : état partagé, enLigne(), ecouter() prévient aux changements, bandeau monté et retiré au retour', () => {
  const { win, doc } = charger();
  assert.equal(win.OdinReseau.enLigne(), true, 'en ligne par défaut (pas de fausse alerte)');
  const vus: string[] = [];
  win.OdinReseau.ecouter((net: { reseau: string }) => vus.push(net.reseau));
  // Coupure : l'événement odin:etat porte tout le state.
  win._emit('odin:etat', { internet: { reseau: 'reseau-sans-internet', depuis: Date.now(), verifieA: Date.now(), services: {} } });
  assert.equal(win.OdinReseau.enLigne(), false);
  assert.deepEqual(vus, ['reseau-sans-internet']);
  assert.ok(doc.getElementById('odin-bandeau-reseau'), 'le bandeau est monté quand c\'est coupé');
  assert.match(doc.getElementById('odin-bandeau-reseau')!.textContent, /Pas d'Internet/);
  // Retour : une seule alerte, refermée toute seule.
  win._emit('odin:etat', { internet: { reseau: 'en-ligne', depuis: Date.now(), verifieA: Date.now(), services: {} } });
  assert.equal(win.OdinReseau.enLigne(), true);
  assert.equal(doc.getElementById('odin-bandeau-reseau'), null, 'le bandeau est retiré au retour');
  assert.deepEqual(vus, ['reseau-sans-internet', 'en-ligne']);
});
