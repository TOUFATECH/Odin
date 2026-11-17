// Correctifs de « Applis, carte et menus » : le volet « À voir » ne cache plus les confirmations d'Odin et se ferme
// quand on ouvre une appli ; le menu replié garde le nom de ses onglets et dit s'il est déplié ; le pied du menu
// ne coupe plus le nom du modèle. Fichiers lus sans navigateur (le dessin est vérifié dans un vrai navigateur).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const lire = (f: string) => readFileSync(new URL(`../src/web/${f}`, import.meta.url), 'utf8');

test('volet « À voir » : aucune confirmation d\'Odin ne s\'ouvre sous le volet modal', () => {
  const src = lire('valhalla.js');
  const debut = src.indexOf('async function manips('), fin = src.indexOf('async function protection(');
  assert.ok(debut > 0 && fin > debut, 'manips() et protection() sont trouvées');
  const corps = src.slice(debut, fin);
  assert.doesNotMatch(corps, /OdinDialog\.confirm\(/, 'les manips passent par confirmerHorsVolet');
  assert.match(corps, /confirmerHorsVolet\(/);
  const aide = src.slice(src.indexOf('async function confirmerHorsVolet('), src.indexOf('function ouvrirVolet('));
  assert.match(aide, /d\.close\(\)/, 'le volet s\'efface le temps de la question');
  assert.match(aide, /finally[\s\S]*d\.showModal\(\)/, 'et revient ensuite');
});

test('volet « À voir » : ouvrir une appli ou changer d\'écran le ferme', () => {
  const src = lire('valhalla.js');
  const v = src.slice(src.indexOf('function ouvrirVolet('), src.indexOf('function ouvrirVolet(') + 1200);
  assert.match(v, /addEventListener\('odin:vue', fermerVolet\)/);
  assert.match(v, /addEventListener\('odin:appli', fermerVolet\)/);
});

test('menu replié : les libellés restent lus (cachés à l\'œil seulement) et l\'état déplié est exposé', () => {
  const src = lire('pages/menu-replie.js');
  assert.doesNotMatch(src, /nav\.side \.lbl[^{]*\{display:none\}/, 'jamais display:none sur les libellés des onglets');
  assert.doesNotMatch(src, /\.br-item span[^{]*\{display:none\}/);
  assert.match(src, /\$\{R\} nav\.side \.lbl,\$\{R\} #navMoreBtn>span:first-child,\$\{B\} \.br-item span\{\$\{CACHE\}\}/);
  assert.match(src, /clip-path:inset\(50%\)/);
  assert.match(src, /panneau\.setAttribute\('aria-expanded', String\(etat !== 'replie'\)\)/);
});

test('menu replié : aria-expanded suit l\'état (replié, déplié, épinglé) sur un faux document', () => {
  const src = lire('pages/menu-replie.js');
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const sur = () => {};
  const elt = () => ({ className: '', style: { setProperty: sur }, setAttribute: sur, removeAttribute: sur, addEventListener: sur, removeEventListener: sur, prepend: sur, append: sur, remove: sur, innerHTML: '', title: '', type: '', textContent: '' });
  const panneau = { ...elt(), setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k), contains: () => false, querySelector: () => null, matches: () => false };
  const conteneur = { ...elt(), classList: { toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); }, remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) } };
  const document = { getElementById: () => null, createElement: elt, head: { append: sur }, addEventListener: sur, removeEventListener: sur, dispatchEvent: sur, readyState: 'complete', activeElement: null };
  const win: { OdinMenu?: { brancher: (c: unknown, o: unknown) => { epingler: (v: boolean) => void; ouvrir: () => void; detacher: () => void } } } = {};
  class CustomEvent { type: string; constructor(t: string) { this.type = t; } }
  const localStorage = { getItem: () => null, setItem: sur };
  vm.runInNewContext(src, { window: Object.assign(win, { addEventListener: sur, removeEventListener: sur }), document, CustomEvent, localStorage, setTimeout, clearTimeout });
  const m = win.OdinMenu!.brancher(conteneur, { panneau, cle: 'essai', actif: () => true });
  assert.equal(attrs.get('aria-expanded'), 'false', 'replié en colonne d\'icônes');
  assert.ok(classes.has('replie'));
  m.ouvrir();
  assert.equal(attrs.get('aria-expanded'), 'true', 'déplié par-dessus');
  m.epingler(true);
  assert.equal(attrs.get('aria-expanded'), 'true', 'épinglé');
  m.detacher();
  assert.equal(attrs.has('aria-expanded'), false);
});

test('pied du menu : le nom du modèle passe à la ligne, « en service » est un point, l\'icône reste sur la ligne', () => {
  const src = lire('pages/pied-menu.js');
  assert.match(src, /\.pm-l\{[^}]*flex-wrap:nowrap/);
  assert.doesNotMatch(src, /\.pm-n>span\{[^}]*nowrap/, 'le modèle n\'est plus coupé en « … »');
  assert.doesNotMatch(src, /\.pm-s\{[^}]*nowrap/, 'l\'identifiant non plus');
  // Dessin réel sur un faux document : le texte « en service » n'occupe plus de place à côté du nom.
  const els: Record<string, Record<string, unknown>> = {
    piedIA: { dataset: {}, addEventListener: () => {}, setAttribute: () => {}, innerHTML: '', title: '', hidden: true, after: () => {} },
    usage: { hidden: true, innerHTML: '' },
  };
  const document = { getElementById: (id: string) => els[id] ?? null, createElement: () => ({}), head: { append: () => {} } };
  const win: { OdinPiedMenu?: { peindre: (s: unknown) => void } } = {};
  vm.runInNewContext(src, { window: win, document, setTimeout });
  win.OdinPiedMenu!.peindre({ settings: { modelePret: true, providers: [{ index: 0, ready: true, model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (Anthropic)', baseUrl: 'http://10.0.0.5/v1' }] }, usage: { tokens_in: 300, tokens_out: 60, cost_usd: 0 } });
  const html = String(els.piedIA.innerHTML);
  assert.match(html, /<i class="pm-on" title="en service"><\/i><span>Anthropic · Claude Sonnet 5\.5<span class="pm-sr"> \(en service\)<\/span><\/span>/);
  assert.match(html, /principal · claude-sonnet-5-5/);
  assert.doesNotMatch(html, /10\.0\.0\.5/);
  assert.match(String(els.usage.innerHTML), /^<svg[^]*<\/svg><span>24 h : 360 jetons · 0\.000 \$<\/span>$/);
});
