// Le bandeau « Pas d'Internet » (src/web/pages/reseau.js) ne doit plus RECOUVRIR la page : avant, il flottait en
// « position: fixed » en haut au centre, par-dessus le titre, les boutons et, sur téléphone, l'en-tête. Il prend
// désormais sa place EN HAUT de la zone de contenu (<main>, à droite de la barre de côté, sous l'en-tête du téléphone)
// et pousse la page ; au retour d'Internet il se replie puis s'en va, sans laisser d'espace vide.
// Petit faux DOM (node:vm), sans navigateur ni réseau.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class Noeud {
  nodeType = 1;
  tag: string;
  attrs = new Map<string, string>();
  kids: Noeud[] = [];
  style: Record<string, string> = {};
  classes = new Set<string>();
  parentNode: Noeud | null = null;
  offsetHeight = 0;
  id = '';
  private _text = '';
  constructor(tag: string) { this.tag = tag; }
  get className() { return [...this.classes].join(' '); }
  set className(v: string) { this.classes = new Set(v.split(/\s+/).filter(Boolean)); }
  classList = { add: (c: string) => { this.classes.add(c); }, contains: (c: string) => this.classes.has(c) };
  setAttribute(k: string, v: string) { this.attrs.set(k, v); if (k === 'id') this.id = v; }
  getAttribute(k: string) { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  removeAttribute(k: string) { this.attrs.delete(k); }
  append(...n: Noeud[]) { for (const x of n) { x.parentNode = this; this.kids.push(x); } }
  prepend(...n: Noeud[]) { for (const x of [...n].reverse()) { x.parentNode = this; this.kids.unshift(x); } }
  remove() { if (!this.parentNode) return; const i = this.parentNode.kids.indexOf(this); if (i >= 0) this.parentNode.kids.splice(i, 1); this.parentNode = null; }
  // Sélecteurs compris : « .classe », « balise » et « balise:not(.classe) ».
  querySelector(sel: string): Noeud | null {
    const pas = /^([a-z]+):not\(\.([\w-]+)\)$/.exec(sel);
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    const ok = (k: Noeud) => (pas ? k.tag === pas[1] && !k.classes.has(pas[2]) : cls ? k.classes.has(cls) : k.tag === sel);
    const go = (n: Noeud): Noeud | null => { for (const k of n.kids) { if (ok(k)) return k; const d = go(k); if (d) return d; } return null; };
    return go(this);
  }
  set textContent(v: string) { this._text = v; this.kids = []; }
  get textContent(): string { return this.kids.length ? this.kids.map((k) => k.textContent).join('') : this._text; }
}

// La structure réelle du haut de l'interface (src/web/ui.html) : <body> > div#app > (div.mbar, nav.side, main > #updBanner…).
function monde(opts: { animation?: boolean } = {}) {
  const head = new Noeud('head');
  const body = new Noeud('body');
  const app = new Noeud('div'); app.setAttribute('id', 'app');
  const mbar = new Noeud('div'); mbar.className = 'mbar';
  const side = new Noeud('nav'); side.className = 'side';
  const main = new Noeud('main');
  const upd = new Noeud('div'); upd.setAttribute('id', 'updBanner');
  const vue = new Noeud('section'); vue.className = 'view';
  main.append(upd, vue); app.append(mbar, side, main); body.append(app);
  const tout = (n: Noeud, f: (x: Noeud) => boolean): Noeud | null => { if (f(n)) return n; for (const k of n.kids) { const d = tout(k, f); if (d) return d; } return null; };
  const doc = {
    head, body,
    createElement: (t: string) => new Noeud(t),
    getElementById: (id: string) => tout(body, (n) => n.id === id),
    querySelector: (sel: string) => (sel === '#app > main' ? (app.kids.find((k) => k.tag === 'main') ?? null) : sel === 'main' ? tout(body, (n) => n.tag === 'main') : null),
  };
  const ecoutes = new Map<string, Array<(e: unknown) => void>>();
  const images: Array<() => void> = [];
  const minuteries: Array<() => void> = [];
  const win: Record<string, any> = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { const l = ecoutes.get(t) ?? []; l.push(fn); ecoutes.set(t, l); },
    emettre: (t: string, detail: unknown) => { for (const fn of ecoutes.get(t) ?? []) fn({ detail }); },
  };
  const ctx: Record<string, unknown> = { window: win, document: doc, Date, Number, Object, Math, String };
  if (opts.animation) {
    ctx.requestAnimationFrame = (f: () => void) => { images.push(f); return images.length; };
    ctx.setTimeout = (f: () => void) => { minuteries.push(f); return minuteries.length; };
  }
  vm.runInNewContext(readFileSync(new URL('../src/web/pages/reseau.js', import.meta.url), 'utf8'), ctx);
  const style = () => head.kids.map((k) => k.textContent).join('\n');
  return { win, doc, body, main, upd, vue, style, images, minuteries };
}

const coupe = { internet: { reseau: 'reseau-sans-internet', depuis: Date.now(), verifieA: Date.now(), services: {} } };
const revenu = { internet: { reseau: 'en-ligne', depuis: Date.now(), verifieA: Date.now(), services: {} } };

test('bandeau hors ligne : il prend sa place en haut du contenu (<main>), pas par-dessus la page', () => {
  const m = monde();
  m.win.emettre('odin:etat', coupe);
  const b = m.doc.getElementById('odin-bandeau-reseau');
  assert.ok(b, 'le bandeau est toujours monté quand Internet est coupé');
  assert.equal(b!.parentNode, m.main, 'il est dans <main> (à droite de la barre de côté, sous l\'en-tête du téléphone)');
  assert.equal(m.main.kids[0], b, 'il est tout en haut du contenu : il pousse la page au lieu de la recouvrir');
  assert.equal(b!.getAttribute('role'), 'status', 'toujours annoncé comme un état');
  assert.equal(b!.getAttribute('aria-live'), 'polite', 'toujours lu par un lecteur d\'écran');
  assert.match(b!.textContent, /Pas d'Internet/, 'le texte ne change pas');
});

test('bandeau hors ligne : son style ne le pose plus en position fixe, ne le met pas au-dessus des fenêtres, et laisse le texte passer à la ligne', () => {
  const m = monde();
  m.win.emettre('odin:etat', coupe);
  const css = m.style();
  assert.ok(css.length > 0, 'un style est posé');
  assert.doesNotMatch(css, /position\s*:\s*(fixed|absolute|sticky)/, 'pas de position fixe : il ne flotte plus au-dessus du contenu');
  assert.doesNotMatch(css, /z-index/, 'pas de z-index : une confirmation, un menu ou le lecteur en plein écran restent au-dessus');
  assert.doesNotMatch(css, /nowrap|text-overflow\s*:\s*ellipsis/, 'le texte passe à la ligne, il n\'est jamais coupé');
});

test('bandeau hors ligne : au retour d\'Internet, il s\'en va sans laisser d\'espace (sans animation possible : tout de suite)', () => {
  const m = monde();
  m.win.emettre('odin:etat', coupe);
  m.win.emettre('odin:etat', revenu);
  assert.equal(m.doc.getElementById('odin-bandeau-reseau'), null, 'le bandeau est retiré au retour');
  assert.deepEqual(m.main.kids, [m.upd, m.vue], 'la page reprend exactement sa place');
});

test('bandeau hors ligne : quand la cause change pendant qu\'il est affiché, le nouveau texte remplace l\'ancien (pas dans la pastille)', () => {
  const m = monde();
  m.win.emettre('odin:etat', coupe);
  const b = m.doc.getElementById('odin-bandeau-reseau')!;
  const [pt, texte] = b.kids;
  assert.ok(pt.classes.has('pt'));
  m.win.emettre('odin:etat', { internet: { ...coupe.internet, reseau: 'sans-reseau' } });
  assert.equal(m.doc.getElementById('odin-bandeau-reseau'), b, 'toujours le même bandeau');
  assert.deepEqual(b.kids, [pt, texte], 'la pastille et le texte restent en place');
  assert.equal(pt.textContent, '', 'la pastille ne reçoit jamais de texte');
  assert.match(texte.textContent, /^Pas de réseau/, 'le texte affiché est le nouveau');
  assert.doesNotMatch(texte.textContent, /Pas d'Internet/, 'l\'ancien texte n\'est plus affiché');
});

test('bandeau hors ligne : au retour, il se replie en douceur puis disparaît ; une nouvelle coupure pendant le repli ne fait jamais deux bandeaux', () => {
  const m = monde({ animation: true });
  m.win.emettre('odin:etat', coupe);
  const b = m.doc.getElementById('odin-bandeau-reseau')!;
  b.offsetHeight = 38;
  m.win.emettre('odin:etat', revenu);
  assert.equal(m.doc.getElementById('odin-bandeau-reseau'), null, 'plus de bandeau « en cours » dès le retour');
  assert.equal(b.getAttribute('role'), null, 'celui qui se replie n\'est plus annoncé');
  assert.equal(b.getAttribute('aria-hidden'), 'true');
  assert.equal(b.style.maxHeight, '38px', 'il part de sa vraie hauteur');
  for (const f of m.images.splice(0)) f();
  assert.equal(b.style.maxHeight, '0px', 'puis se replie jusqu\'à zéro (pas de saut brusque)');
  // Coupure de nouveau pendant le repli : un seul bandeau, l'ancien est retiré.
  m.win.emettre('odin:etat', coupe);
  const neuf = m.doc.getElementById('odin-bandeau-reseau');
  assert.ok(neuf && neuf !== b);
  assert.equal(m.main.kids.filter((k) => k.tag === 'div' && k.classes.has('odin-bandeau-reseau')).length, 1, 'un seul bandeau dans la page');
  // Retour encore : à la fin de la minuterie, il ne reste rien.
  neuf!.offsetHeight = 38;
  m.win.emettre('odin:etat', revenu);
  for (const f of m.images.splice(0)) f();
  for (const f of m.minuteries.splice(0)) f();
  assert.deepEqual(m.main.kids, [m.upd, m.vue], 'aucun espace vide laissé');
});
