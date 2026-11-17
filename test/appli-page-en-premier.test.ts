// La page d'une appli qui a sa propre page dessinée (window.OdinPages[id]) : cette page vient en premier, juste sous
// l'en-tête ; la présentation générique reste là mais repliée, et les boutons rapides génériques passent après elle.
// Une appli sans page propre ne change pas. Le vrai script valhalla.js tourne dans une page minimale (sans navigateur).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

type N = {
  tag: string; attrs: Record<string, string>; childNodes: N[]; parentNode: N | null; className: string; hidden: boolean; open: boolean;
  textContent: string; style: { cssText: string; width?: string }; nodeType: number; append: (...k: N[]) => void; [k: string]: unknown;
};

/** Une page minimale : de quoi dessiner la page d'une appli et la relire dans l'ordre du document. */
function pageMinimale() {
  const make = (tag: string): N => {
    const n: N = {
      tag, attrs: {}, childNodes: [], parentNode: null, className: '', hidden: false, open: false, textContent: '', style: { cssText: '' }, nodeType: 1,
      get children() { return n.childNodes.filter((c) => c.nodeType === 1); },
      get firstChild() { return n.childNodes[0] ?? null; },
      get lastChild() { return n.childNodes.at(-1) ?? null; },
      classList: { add: (c: string) => { n.className = `${n.className} ${c}`.trim(); }, contains: (c: string) => n.className.split(/\s+/).includes(c) },
      setAttribute: (k: string, v: string) => { n.attrs[k] = String(v); if (k === 'hidden') n.hidden = true; if (k === 'open') n.open = true; },
      getAttribute: (k: string) => n.attrs[k] ?? null,
      addEventListener() {}, removeEventListener() {}, focus() {}, scrollIntoView() {},
      append: (...k: N[]) => { for (const c of k) { if (c.parentNode) c.parentNode.childNodes = c.parentNode.childNodes.filter((x) => x !== c); c.parentNode = n; n.childNodes.push(c); } },
      replaceChildren: (...k: N[]) => { for (const c of n.childNodes) c.parentNode = null; n.childNodes = []; (n.append as (...x: N[]) => void)(...k); },
      insertBefore: (c: N, ref: N | null) => { (n.append as (...x: N[]) => void)(c); if (ref) { n.childNodes.pop(); n.childNodes.splice(n.childNodes.indexOf(ref), 0, c); } return c; },
      remove: () => { if (n.parentNode) n.parentNode.childNodes = n.parentNode.childNodes.filter((x) => x !== n); n.parentNode = null; },
      querySelector: () => null, querySelectorAll: () => [],
      set innerHTML(_v: string) { /* icônes : sans importance ici */ },
    };
    return n;
  };
  const body = make('div'); body.className = 'body';
  const app = make('div');
  const document = {
    readyState: 'complete', head: make('head'), body: make('body'), activeElement: null,
    createElement: make, createElementNS: (_ns: string, t: string) => make(t),
    createTextNode: (t: string) => ({ ...make('#text'), nodeType: 3, textContent: t }),
    addEventListener() {}, dispatchEvent() { return true; }, getElementById: () => null,
    querySelector: (s: string) => (s === '#v-app .body' ? body : s === '#app' ? app : null), querySelectorAll: () => [],
  };
  return { document, body };
}

/** Lance valhalla.js, ouvre l'appli `id` (sa vue : `vue`) et rend la page dessinée. `propre` : sa page à elle, s'il y en a une. */
async function ouvrir(id: string, propre: ((o: { host: N }, doc: { createElement: (t: string) => N }) => unknown) | null) {
  const { document, body } = pageMinimale();
  const vue = {
    ok: true, name: id, what: 'Ce que fait l\'appli.', does: ['une chose'], similaires: [{ nom: 'Autre appli' }], alerts: [], links: [],
    actions: [{ id: 'rapide', label: 'Bouton rapide', what: 'un bouton générique', params: [] }],
    view: { subtitle: 'état', kpis: [{ label: 'Chiffre', value: '3' }], sections: [{ kind: 'text', title: 'Section générique', text: 'texte' }] },
  };
  const ctx: Record<string, unknown> = {
    document, console, URLSearchParams, CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
    location: { reload() {}, hostname: 'localhost' }, localStorage: { getItem: () => null, setItem() {} },
    fetch: async (u: string) => ({ status: 200, json: async () => (u.startsWith('/api/valhalla/view') ? vue : { ok: false }) }),
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {},
  };
  ctx.window = ctx;
  if (propre) ctx.OdinPages = { [id]: (o: { host: N }) => propre(o, document) };
  vm.runInNewContext(readFileSync(new URL('../src/web/valhalla.js', import.meta.url), 'utf8'), ctx);
  await (ctx.OdinApps as { app: (i: string) => Promise<void> }).app(id);
  // L'ordre du document : chaque élément, en profondeur, comme le navigateur le lit de haut en bas.
  const ordre: N[] = [];
  const parcours = (n: N) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; ordre.push(c); parcours(c); } };
  parcours(body);
  const rang = (classe: string) => ordre.findIndex((n) => n.className.split(/\s+/).includes(classe));
  return { ordre, rang, fiche: ordre.find((n) => n.className === 'va-plus') };
}

/** Une page propre qui dessine une carte (comme la bibliothèque de Vénus). */
const propre = (o: { host: N }, doc: { createElement: (t: string) => N }) => { const c = doc.createElement('section'); c.className = 'page-propre'; o.host.append(c); };

test('une appli avec sa propre page : la page vient juste sous l\'en-tête, avant la présentation dépliée et les boutons génériques', async () => {
  const p = await ouvrir('venus', propre);
  const page = p.rang('va-custom'), boutons = p.rang('va-acts-bar'), chiffres = p.rang('va-kpis'), entete = p.rang('va-head');
  assert.ok(page > 0 && entete >= 0, 'la page propre est dessinée, sous l\'en-tête');
  assert.ok(boutons > page, `les boutons rapides génériques viennent après la page propre (page ${page}, boutons ${boutons})`);
  assert.ok(chiffres > page, 'les chiffres génériques aussi');
  // Entre l'en-tête et la page propre : rien de la page générique.
  const entre = p.ordre.slice(entete + 1, page).filter((n) => !isDans(n, p.ordre[entete]));
  assert.deepEqual(entre.map((n) => n.className).filter((c) => /va-(acts-bar|kpis|sec|page)/.test(c)), [], 'rien de générique entre l\'en-tête et la page propre');
  assert.ok(p.fiche, 'la présentation reste accessible (à quoi ça sert, applicatifs similaires)');
  assert.equal(p.fiche!.open, false, 'mais repliée : elle ne prend plus le haut de la page');
});

test('une appli sans page propre : rien ne change (présentation dépliée, chiffres et boutons rapides en haut, puis les sections)', async () => {
  const p = await ouvrir('mimir', null);
  assert.equal(p.rang('va-custom'), -1);
  const entete = p.rang('va-head'), chiffres = p.rang('va-kpis'), boutons = p.rang('va-acts-bar'), corps = p.rang('va-page');
  assert.ok(entete < chiffres && chiffres < boutons && boutons < corps, `ordre inchangé : en-tête ${entete}, chiffres ${chiffres}, boutons ${boutons}, sections ${corps}`);
  assert.equal(p.fiche!.open, true, 'la présentation est dépliée en entrant, comme avant');
});

test('une page propre qui n\'a rien à montrer (elle rend false) : la page générique revient comme avant', async () => {
  const p = await ouvrir('venus', () => false);
  assert.equal(p.rang('va-custom'), -1);
  const chiffres = p.rang('va-kpis'), boutons = p.rang('va-acts-bar'), corps = p.rang('va-page');
  assert.ok(chiffres < boutons && boutons < corps, 'ordre générique');
  assert.equal(p.fiche!.open, true, 'présentation dépliée comme pour une appli sans page propre');
});

test('changer vite d\'appli : la page refusée d\'une appli ne déplie pas la présentation de la suivante', async () => {
  // L'appli A n'a finalement rien à montrer (rend false) ; on ouvre B pendant que la page de A se dessine encore.
  const { document, body } = pageMinimale();
  const vue = (id: string) => ({
    ok: true, name: id, what: 'Ce que fait l\'appli.', does: ['une chose'], similaires: [{ nom: 'Autre appli' }], alerts: [], links: [],
    actions: [{ id: 'rapide', label: 'Bouton rapide', what: 'un bouton générique', params: [] }],
    view: { subtitle: 'état', kpis: [{ label: 'Chiffre', value: '3' }], sections: [{ kind: 'text', title: 'Section générique', text: 'texte' }] },
  });
  let ouvreA = () => {}, ouvreB = () => {}, aDemarre = () => {}, bDemarre = () => {};
  const portesA = new Promise<void>((r) => { ouvreA = r; }), portesB = new Promise<void>((r) => { ouvreB = r; });
  const debutA = new Promise<void>((r) => { aDemarre = r; }), debutB = new Promise<void>((r) => { bDemarre = r; });
  const ctx: Record<string, unknown> = {
    document, console, URLSearchParams, CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
    location: { reload() {}, hostname: 'localhost' }, localStorage: { getItem: () => null, setItem() {} },
    fetch: async (u: string) => ({ status: 200, json: async () => (u.startsWith('/api/valhalla/view') ? vue(new URLSearchParams(u.split('?')[1]).get('id')!) : { ok: false }) }),
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {},
    OdinPages: {
      alpha: async () => { aDemarre(); await portesA; return false; },
      beta: async (o: { host: N }) => { bDemarre(); await portesB; propre(o, document); },
    },
  };
  ctx.window = ctx;
  vm.runInNewContext(readFileSync(new URL('../src/web/valhalla.js', import.meta.url), 'utf8'), ctx);
  const apps = ctx.OdinApps as { app: (i: string) => Promise<void> };
  const a = apps.app('alpha'); await debutA;
  const b = apps.app('beta'); await debutB;
  ouvreA(); await a;          // la page de A rend false pendant que celle de B se dessine
  ouvreB(); await b;
  const ordre: N[] = [];
  const parcours = (n: N) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; ordre.push(c); parcours(c); } };
  parcours(body);
  assert.ok(ordre.some((n) => n.className.split(/\s+/).includes('va-custom')), 'la page propre de B est dessinée');
  const fiche = ordre.find((n) => n.className === 'va-plus');
  assert.ok(fiche, 'la présentation de B est là');
  assert.equal(fiche!.open, false, 'et repliée, même si la page de A a été refusée entre-temps');
});

function isDans(n: N, parent: N): boolean { for (let x = n.parentNode; x; x = x.parentNode) if (x === parent) return true; return false; }
