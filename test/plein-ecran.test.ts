// Plein écran et déplacement au clavier (src/web/pages/plein-ecran.js) : chaque touche fait ce qu'elle dit, le zoom
// reste entre ses bornes, et le point actif est bien le plus proche du centre.
// Le fichier est lu sans document : il ne doit rien toucher à son chargement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type Action = { type: string; dx?: number; dy?: number; f?: number } | null;
interface Logique {
  touche: (key: string, maj?: boolean) => Action;
  borner: (k: number, min?: number, max?: number) => number;
  plusProche: (points: Array<{ id: string; x: number; y: number }>, cx: number, cy: number) => string | null;
}
const source = readFileSync(new URL('../src/web/pages/plein-ecran.js', import.meta.url), 'utf8');
function charger(): Logique {
  const win: { OdinPleinEcran?: { logique: Logique; actif: () => unknown } } = {};
  vm.runInNewContext(source, { window: win });
  assert.ok(win.OdinPleinEcran, 'window.OdinPleinEcran est posé');
  assert.equal(win.OdinPleinEcran.actif(), null, 'rien en plein écran au chargement');
  return win.OdinPleinEcran.logique;
}
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

test('plein écran : se charge sans document, et une seconde fois ne remplace rien', () => {
  const win: { OdinPleinEcran?: unknown } = {};
  vm.runInNewContext(source, { window: win });
  const premier = win.OdinPleinEcran;
  vm.runInNewContext(source, { window: win });
  assert.equal(win.OdinPleinEcran, premier);
});

test('plein écran : les flèches déplacent (Maj : trois fois plus), + et − zooment, 0 recadre, Entrée et Espace ouvrent', () => {
  const L = charger();
  assert.deepEqual(ici(L.touche('ArrowLeft', false)), { type: 'deplacer', dx: 60, dy: 0 });
  assert.deepEqual(ici(L.touche('ArrowRight', false)), { type: 'deplacer', dx: -60, dy: 0 });
  assert.deepEqual(ici(L.touche('ArrowUp', true)), { type: 'deplacer', dx: 0, dy: 180 });
  assert.deepEqual(ici(L.touche('ArrowDown', false)), { type: 'deplacer', dx: 0, dy: -60 });
  assert.deepEqual(ici(L.touche('+', false)), { type: 'zoom', f: 1.25 });
  assert.deepEqual(ici(L.touche('=', false)), { type: 'zoom', f: 1.25 });
  assert.deepEqual(ici(L.touche('-', false)), { type: 'zoom', f: 0.8 });
  assert.deepEqual(ici(L.touche('0', false)), { type: 'recadrer' });
  assert.deepEqual(ici(L.touche('Enter', false)), { type: 'ouvrir' });
  assert.deepEqual(ici(L.touche(' ', false)), { type: 'ouvrir' });
  assert.equal(L.touche('a', false), null);
  assert.equal(L.touche('Tab', false), null, 'Tab sort de la carte comme d\'habitude');
});

test('plein écran : le zoom reste entre 0,2 et 4', () => {
  const L = charger();
  assert.equal(L.borner(0.1), 0.2);
  assert.equal(L.borner(9), 4);
  assert.equal(L.borner(1.5), 1.5);
  assert.equal(L.borner(Number.NaN), 0.2);
  assert.equal(L.borner(3, 0.5, 2), 2);
});

test('plein écran : le point actif est le plus proche du centre', () => {
  const L = charger();
  const pts = [{ id: 'a', x: 100, y: 0 }, { id: 'b', x: -20, y: 10 }, { id: 'c', x: 0, y: -60 }];
  assert.equal(L.plusProche(pts, 0, 0), 'b');
  assert.equal(L.plusProche(pts, 90, 5), 'a');
  assert.equal(L.plusProche(pts, 0, -50), 'c');
  assert.equal(L.plusProche([], 0, 0), null);
});

test('plein écran : le plein écran du navigateur vise toute la page, et les libellés sont ceux prévus', () => {
  assert.match(source, /documentElement\.requestFullscreen|de\.requestFullscreen/);
  assert.doesNotMatch(source, /cible\.requestFullscreen/, 'jamais sur la partie seule : la mascotte et les fenêtres restent au-dessus');
  assert.match(source, /Quitter le plein écran \(Échap\)/);
  assert.match(source, /Flèches : se déplacer · \+ et − : zoomer · 0 : tout voir · Entrée : ouvrir/);
  assert.match(source, /z-index:40/);
  assert.match(source, /prefers-reduced-motion/);
  assert.doesNotMatch(source, /window\.(confirm|alert|prompt)\(/);
});

test('plein écran : avec un thème à décor, main ne garde pas la carte sous le menu replié', () => {
  // themes.js pose « main{position:relative;z-index:1} » : la couche 40 resterait enfermée sous le menu (35).
  assert.match(source, /html\[data-plein-ecran="1"\] main\{z-index:auto!important\}/);
});

test('plein écran : passer d\'une partie à une autre (graphe redessiné) ne quitte pas le plein écran du navigateur', () => {
  const classes = () => { const s = new Set<string>(); return { add: (c: string) => s.add(c), remove: (c: string) => s.delete(c), contains: (c: string) => s.has(c) }; };
  let sorties = 0, demandes = 0;
  const attrs = new Map<string, string>();
  const documentElement = {
    setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k),
    requestFullscreen: () => { demandes++; doc.fullscreenElement = documentElement; return Promise.resolve(); },
  };
  const evts: Array<{ actif: boolean }> = [];
  const doc: Record<string, unknown> = {
    fullscreenElement: null, documentElement,
    getElementById: () => ({}), createElement: () => ({}), head: { append: () => {} },
    addEventListener: () => {}, querySelector: () => null,
    dispatchEvent: (e: { detail: { actif: boolean } }) => { evts.push(e.detail); },
    exitFullscreen: () => { sorties++; doc.fullscreenElement = null; return Promise.resolve(); },
  };
  class CustomEvent { detail: unknown; constructor(_t: string, o: { detail: unknown }) { this.detail = o.detail; } }
  const win: { OdinPleinEcran?: { entrer: (c: unknown) => void; remplacer: (c: unknown) => void; sortir: () => void; actif: () => unknown } } = {};
  vm.runInNewContext(source, { window: win, document: doc, CustomEvent });
  const P = win.OdinPleinEcran!;
  const a = { classList: classes() }, b = { classList: classes() }, c = { classList: classes() };
  P.entrer(a);
  assert.equal(demandes, 1);
  P.remplacer(b);
  assert.equal(P.actif(), b);
  assert.ok(b.classList.contains('pe-plein') && !a.classList.contains('pe-plein'));
  assert.equal(sorties, 0, 'remplacer ne sort pas du plein écran du navigateur');
  P.entrer(c);
  assert.equal(P.actif(), c);
  assert.equal(sorties, 0, 'entrer sur une autre partie non plus');
  assert.equal(attrs.get('data-plein-ecran'), '1');
  P.sortir();
  assert.equal(sorties, 1);
  assert.equal(P.actif(), null);
});
