// L'écran de la maison (/maison) : le verre des cartes et le fond qui vit (maquette validée : le même verre et les mêmes
// ambiances que l'accueil ; ses choix du 25/11 « Décor derrière, verre plus opaque » et du 26/11 « Éteint au départ »).
// - Le calcul du verre (src/web/themes.js) et les dessins des ambiances (src/web/pages/themes-scenes.js) sont ceux de
//   l'accueil : la page les reçoit (themes.js en « calcul seul » : il ne pose rien sur cette page), rien n'est recopié.
// - Les réglages (la transparence pour chaque thème, le fond animé) restent sur l'appareil : aucune requête ne les envoie.
// - Sans réglage, les cartes sont exactement celles d'avant, pour sa session, une clé « complet », une clé de tablette
//   « maison » et un membre (refusé par /api/maison/* depuis le lot des membres : la page tombe sur son thème de départ).
// Un vrai Odin d'essai (dossier temporaire) sert la page et /api/maison/etat ; le script de la page (maison.js) tourne,
// par morceaux, dans un bac à sable avec un petit document, après le catalogue, les ambiances et themes.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import vm from 'node:vm';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const MAISON = readFileSync(new URL('../src/web/maison.js', import.meta.url), 'utf8');
const CATALOGUE = readFileSync(new URL('../src/web/pages/themes-catalogue.js', import.meta.url), 'utf8');
const SCENES = readFileSync(new URL('../src/web/pages/themes-scenes.js', import.meta.url), 'utf8');
const THEMES_JS = readFileSync(new URL('../src/web/themes.js', import.meta.url), 'utf8');

// ---------- Lire maison.js : un bloc qui finit par « } » à deux espaces ----------
function bloc(debut: string): string {
  const i = MAISON.indexOf(`  ${debut}`); assert.ok(i >= 0, `maison.js : « ${debut} » introuvable`);
  const f = MAISON.indexOf('\n  }', i); assert.ok(f > i, `maison.js : fin de « ${debut} » introuvable`);
  const fin = MAISON.indexOf('\n', f + 1);
  return MAISON.slice(i, fin < 0 ? undefined : fin);
}
/** Les thèmes de la page : du titre « Thèmes » jusqu'à la fin du style commun (BASE). */
function themes(): string {
  const i = MAISON.indexOf('  // ---------- Thèmes'); assert.ok(i >= 0, 'maison.js : la partie des thèmes');
  const b = MAISON.indexOf('const BASE = `', i); assert.ok(b > i, 'maison.js : le style commun');
  const f = MAISON.indexOf('`;\n', b + 14); assert.ok(f > b, 'maison.js : fin du style commun');
  return MAISON.slice(i, f + 2);
}
const ligne = (debut: string) => { const i = MAISON.indexOf(`  ${debut}`); assert.ok(i >= 0, `maison.js : « ${debut} »`); return MAISON.slice(i, MAISON.indexOf('\n', i)); };

// ---------- Un petit document ----------
type Txt = { nodeType: 3; t: string; parent?: N | null };
class N {
  nodeType = 1; tag: string; attrs: Record<string, string> = {}; kids: Array<N | Txt> = []; parent: N | null = null; dataset: Record<string, string> = {};
  style: Record<string, unknown>; ecoute: Record<string, Array<(e: unknown) => unknown>> = {}; html = ''; value = ''; checked = false; doc: Doc; odinDessin?: string;
  classList: { toggle: (c: string, oui?: boolean) => void; contains: (c: string) => boolean };
  constructor(tag: string, doc: Doc) {
    this.tag = tag; this.doc = doc;
    this.style = { setProperty: (k: string, v: string) => { this.style[k] = v; } };
    const classes = () => new Set((this.attrs.class ?? '').split(/\s+/).filter(Boolean));
    this.classList = {
      toggle: (c, oui) => { const s = classes(); if (oui ?? !s.has(c)) s.add(c); else s.delete(c); this.attrs.class = [...s].join(' '); },
      contains: (c) => classes().has(c),
    };
  }
  get id() { return this.attrs.id ?? ''; }
  set id(v: string) { this.attrs.id = v; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'checked') this.checked = true; }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k: string) { return k in this.attrs; }
  append(...k: Array<N | Txt | string>) { for (const x of k) { const n = typeof x === 'string' ? { nodeType: 3 as const, t: x } : x; n.parent = this; this.kids.push(n); } }
  prepend(...k: N[]) { for (const x of k.reverse()) { x.parent = this; this.kids.unshift(x); } }
  replaceChildren(...k: N[]) { this.kids = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((x) => x !== this); this.parent = null; } }
  addEventListener(t: string, f: (e: unknown) => unknown) { (this.ecoute[t] ??= []).push(f); }
  set innerHTML(h: string) { this.html = h; }
  get innerHTML() { return this.html; }
  set textContent(t: string) { this.kids = [{ nodeType: 3, t }]; }
  get textContent(): string { return this.kids.map((k) => (k.nodeType === 3 ? (k as Txt).t : (k as N).textContent)).join(''); }
  focus() { this.doc.activeElement = this; }
  closest() { return null; }
  /** Les descendants (lui compris). */
  tous(): N[] { return [this, ...this.kids.filter((k): k is N => k.nodeType === 1).flatMap((k) => k.tous())]; }
}
type Doc = { activeElement: N | null; hidden: boolean; head: N; body: N; ecoute: Record<string, Array<() => void>>; getElementById: (id: string) => N | null; [k: string]: unknown };
function documentNeuf(): Doc {
  const d = { activeElement: null, hidden: false, ecoute: {} } as unknown as Doc;
  d.head = new N('head', d); d.body = new N('body', d);
  Object.assign(d, {
    currentScript: null as N | null,
    createElement: (t: string) => new N(t, d), createElementNS: (_: string, t: string) => new N(t, d), createTextNode: (t: string) => ({ nodeType: 3, t }),
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: (id: string) => d.body.tous().find((n) => n.id === id) ?? null,
    addEventListener: (t: string, f: () => void) => { (d.ecoute[t] ??= []).push(f); },
    documentElement: new N('html', d), readyState: 'complete',
  });
  return d;
}

type Etat = Record<string, unknown> & { ok: boolean; rights: string; theme: string; themes: Record<string, string> };
type Calcul = { verre: Record<string, string | number>; carte: string; tons: Record<string, string>; pal: Record<string, string>; ink: string; sky: string[]; voile: string; ambiance: string | null; dessin: string; force?: number; css: string; dessinable: boolean; curseur: { valeur: number; choisie: boolean; limite: number; pleine?: boolean } };
type Page = { load: () => Promise<void>; css: N; themesView: () => N[]; applyTheme: (k: string) => void; D: () => Etat | null };
type Bac = { page: Page; doc: Doc; win: Record<string, unknown>; stock: Map<string, string>; requetes: string[]; minuteries: number; avecThemes: boolean };
/**
 * La page chargée : `etat` (ou une erreur de connexion, comme pour un membre), ce que l'appareil garde, et avec ou sans
 * themes.js (sans lui : la page d'avant ce lot, qui n'en recevait pas).
 */
async function bac(etat: Etat | 'refuse', garde: Record<string, string> = {}, o: { avecThemes?: boolean; cache?: boolean; stockageCasse?: boolean } = {}): Promise<Bac> {
  const avecThemes = o.avecThemes !== false;
  const doc = documentNeuf(); doc.hidden = o.cache === true;
  const win: Record<string, unknown> = {};
  const stock = new Map(Object.entries(garde)), requetes: string[] = [];
  let minuteries = 0;
  const localStorage = o.stockageCasse
    ? { getItem: () => { throw new Error('fermé'); }, setItem: () => { throw new Error('fermé'); } }
    : { getItem: (k: string) => stock.get(k) ?? null, setItem: (k: string, v: string) => { stock.set(k, String(v)); } };
  const ctx = vm.createContext({
    window: win, document: doc, localStorage, queueMicrotask, matchMedia: () => ({ matches: false }), CSS: { supports: () => true },
    fetch: async (u: string, i?: { body?: string }) => { requetes.push(`fetch ${u} ${i?.body ?? ''}`); throw new Error('pas de réseau ici'); },
    setInterval: () => { minuteries++; return 0; }, setTimeout: () => 0, clearTimeout: () => {}, clearInterval: () => {}, CustomEvent: class { type: string; constructor(type: string) { this.type = type; } },
  });
  win.CSS = ctx.CSS; win.matchMedia = ctx.matchMedia;
  vm.runInContext(CATALOGUE, ctx); vm.runInContext(SCENES, ctx);
  if (avecThemes) {
    const s = new N('script', doc); s.setAttribute('data-calcul-seul', ''); (doc as Record<string, unknown>).currentScript = s;
    vm.runInContext(THEMES_JS, ctx); (doc as Record<string, unknown>).currentScript = null;
  }
  const src = [
    ligne('const MOTS = {'),
    'let D = null, glisse = false, first = false; const seen = new Set();',
    'const nuit = { cacher() {}, montrer() {} }, pet = { say() {} }, hello = () => \'\', cibleOdin = () => \'_top\', dansOdin = false;',
    'const RACINE = document.createElement(\'div\'); document.body.append(RACINE);',
    'const draw = () => { RACINE.replaceChildren(...(D ? themesView() : [])); };',
    'const api = async (p, b) => { REQUETES.push(`api ${p} ${b ? JSON.stringify(b) : \'\'}`); if (ETAT === \'refuse\') throw Object.assign(new Error(\'connexion requise\'), { auth: true }); return ETAT; };',
    'const act = async (p, b) => { REQUETES.push(`act ${p} ${JSON.stringify(b)}`); return { ok: true }; };',
    bloc('const el = ('), themes(), bloc('async function load() {'), bloc('function themesView() {'),
    '({ load, css, themesView, applyTheme, D: () => D });',
  ].join('\n');
  ctx.REQUETES = requetes;
  const page = vm.runInContext(`ETAT = ${JSON.stringify(etat)};\n${src}`, ctx) as Page;
  await page.load();
  return { page, doc, win, stock, requetes, minuteries, avecThemes };
}
// (toutes les cartes, la météo comprise, et les boutons de « Mes boutons », qui sont des cartes eux aussi ; la carte
//  allumée d'un appareil garde sa couleur pleine) — suivi après relecture : le sélecteur des cartes compte les boutons.
const cartesDe = (css: string) => /\.card:not\(\.on\),\.tile\{([^}]*)\}/.exec(css)?.[1];
const couche = (b: Bac) => b.doc.getElementById('odinFond') as N | null;
const calcul = (b: Bac) => (b.win.OdinThemes as { verreMaison: (id: string, voulu?: number, fond?: boolean) => Calcul | undefined }).verreMaison;
const vue = (b: Bac) => b.page.themesView().flatMap((n) => n.tous());
const trouve = (b: Bac, id: string) => vue(b).find((n) => n.id === id);
const lance = (n: N | undefined, type: string, value?: string | boolean) => { assert.ok(n, 'élément'); if (typeof value === 'string') n.value = value; if (typeof value === 'boolean') n.checked = value; for (const f of n.ecoute[type] ?? []) f({ target: n, currentTarget: n }); };

// ---------- Contraste, recalculé ici à la main (norme WCAG), sans le code de la page ----------
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const sur = (fond: number[], c: number[], a: number) => fond.map((v, i) => Math.round(v * (1 - a) + c[i] * a));
const sature = ([r, g, b]: number[], s: number) => [(0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b, (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b, (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b].map((x) => Math.round(Math.max(0, Math.min(255, x))));
// (la fonction d'erreur, approximation d'Abramowitz et Stegun)
const erf = (x: number) => { const s = Math.sign(x), a = Math.abs(x), k = 1 / (1 + 0.3275911 * a); return s * (1 - (((((1.061405429 * k - 1.453152027) * k) + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-a * a)); };
/** Les couleurs d'un décor dessiné (SVG) avec leur opacité, groupes compris. */
function decorDe(svg: string): Array<{ c: number[]; a: number }> {
  const out: Array<{ c: number[]; a: number }> = [], pile: Array<{ fill?: string; stroke?: string; op: number }> = [{ op: 1 }];
  const plein = (c?: string) => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c ?? ''); if (!m) return null; const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1]; return hex(`#${h}`); };
  for (const [, fin, balise, attrs, seule] of svg.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    if (fin) { if (pile.length > 1) pile.pop(); continue; }
    const a: Record<string, string> = {}; for (const [, k, x] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = x;
    const p = pile[pile.length - 1], e = { fill: a.fill ?? p.fill, stroke: a.stroke ?? p.stroke, op: p.op * (a.opacity === undefined ? 1 : Number(a.opacity)) };
    if (balise !== 'g') for (const [c, o] of [[e.fill, a['fill-opacity']], [e.stroke, a['stroke-opacity']]] as const) { const x = plein(c); if (x) out.push({ c: x, a: Math.max(0, Math.min(1, e.op * (o === undefined ? 1 : Number(o)))) }); }
    if (!seule) pile.push(e);
  }
  return out;
}
const rgba = (s: string) => [...s.matchAll(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g)].map((m) => ({ c: [+m[1], +m[2], +m[3]], a: +m[4] }));

// ---------- Un vrai Odin d'essai ----------
const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn };
let v: VraiOdin, cleMaison = '', cleComplet = '';
const SANS_SESSION = { cookie: '' };
before(async () => {
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['gladsheim', 'midgard', 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'maison' })).data as { key: string }).key;
  cleComplet = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette salon', droits: 'complet' })).data as { key: string }).key;
});
after(async () => { await tt.end(); Object.assign(console, orig); });
const etat = async (h: Record<string, string>) => { const r = await v.json('/api/maison/etat', undefined, h); assert.equal(r.status, 200); return r.body as Etat; };
const etats = async () => ({ session: await etat({}), complet: await etat({ ...SANS_SESSION, 'x-odin-maison': cleComplet }), maison: await etat({ ...SANS_SESSION, 'x-odin-maison': cleMaison }) });

test('une tablette à clé reçoit les scripts : les ambiances et le calcul du verre, avant maison.js, sans session, la même politique de sécurité', async () => {
  const r = await fetch(`${v.url}/maison`, { headers: SANS_SESSION });
  assert.equal(r.status, 200);
  const html = await r.text(), nonce = /<script nonce="([^"]+)" src="\/maison\.js">/.exec(html)?.[1];
  assert.ok(nonce, 'maison.js est chargé');
  const ou = (s: string) => html.indexOf(s);
  const cat = ou(`<script nonce="${nonce}" src="/pages/themes-catalogue.js"></script>`), sc = ou(`<script nonce="${nonce}" src="/pages/themes-scenes.js"></script>`), th = ou(`<script nonce="${nonce}" src="/themes.js" data-calcul-seul></script>`);
  assert.ok(sc >= 0, 'les ambiances (themes-scenes.js), avec le nonce de la page');
  assert.ok(th >= 0, 'le calcul du verre (themes.js), avec le nonce de la page, en calcul seul');
  assert.ok(cat < sc && sc < th && th < ou('src="/maison.js"'), 'catalogue, puis ambiances, puis calcul, puis maison.js');
  // La politique de sécurité ne change pas : des scripts de la même origine, avec le nonce, rien d'autre.
  assert.equal(r.headers.get('content-security-policy'), `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`);
  for (const p of ['/pages/themes-scenes.js', '/themes.js']) {
    const c = await fetch(`${v.url}${p}`, { headers: SANS_SESSION });
    assert.equal(c.status, 200, `${p} servi sans session`); assert.match(String(c.headers.get('content-type')), /javascript/);
    assert.ok((await c.text()).length > 1000);
  }
  // La clé de tablette entre toujours, avec les mêmes droits.
  assert.equal((await etat({ ...SANS_SESSION, 'x-odin-maison': cleMaison })).rights, 'maison');
});

test('themes.js en calcul seul : ne pose aucun thème, ne demande rien à Odin, ne lance aucune minuterie ; il publie le calcul', async () => {
  const b = await bac(await etat({}));
  assert.equal(b.doc.head.kids.filter((n) => (n as N).id === 'odinThemeStyle').length, 0, 'aucun style de thème d\'Odin');
  assert.equal((b.doc.documentElement as N).dataset.odinTheme, undefined, 'aucun thème d\'Odin posé sur la page');
  assert.deepEqual(b.requetes.filter((x) => x.startsWith('fetch')), [], 'aucune requête de themes.js');
  assert.equal(b.minuteries, 0, 'aucune minuterie');
  assert.equal(typeof calcul(b), 'function');
  // Le même calcul que l'accueil : la carte de l'accueil, ses mots.
  const c = calcul(b)('h-etoiles', 30, false)!;
  assert.match(String(c.verre['--v-carte']), /^linear-gradient\(140deg,rgba\(/);
  assert.equal((b.win.OdinThemes as { TEXTES: Record<string, string> }).TEXTES.verre, 'Transparence du verre');
});

test('sans réglage : exactement les cartes d\'avant, pour sa session, une clé « complet », une tablette « maison » et un membre', async () => {
  const e = await etats();
  for (const [qui, x] of [...Object.entries(e), ['membre', 'refuse']] as Array<[string, Etat | 'refuse']>) {
    const avant = await bac(x, {}, { avecThemes: false }), apres = await bac(x);
    assert.equal(apres.page.css.textContent, avant.page.css.textContent, `${qui} : le même style, mot pour mot`);
    assert.equal(cartesDe(apres.page.css.textContent), undefined, `${qui} : aucune carte en verre`);
    assert.doesNotMatch(apres.page.css.textContent, /--v-carte|odinFond|body::before/, `${qui} : ni verre, ni couche, ni voile`);
    assert.equal(couche(apres), null, `${qui} : aucun élément de fond`);
    assert.match(apres.page.css.textContent, /\.card\{background:var\(--card\);[^}]*backdrop-filter:blur\(14px\)/, `${qui} : la carte d'avant, son flou de 14 px`);
  }
});

test('fond allumé : l\'ambiance du thème est derrière les cartes, au-dessus des décors de Hestia, ne prend aucun clic, et la carte devient assez opaque', async () => {
  const e = { ...(await etat({})), theme: 'etoiles' };
  const b = await bac(e, { 'odin.maison.verre': JSON.stringify({ fond: true }) });
  const c = couche(b);
  assert.ok(c, 'la couche est là');
  assert.equal(b.doc.body.kids[0], c, 'en premier dans la page : derrière tout l\'écran');
  assert.equal(c.getAttribute('aria-hidden'), 'true'); assert.ok(c.hasAttribute('inert'), 'hors du clavier');
  assert.equal(c.dataset.ambiance, 'stars', 'l\'ambiance du thème (Ciel étoilé : étoiles)');
  assert.equal(c.innerHTML, (b.win.OdinScenes as { html: (n: string, t: unknown) => string }).html('stars', (b.win.OdinThemes as { THEMES: Record<string, unknown> }).THEMES['h-etoiles']), 'le dessin de themes-scenes.js, tel quel');
  const css = b.page.css.textContent;
  assert.match(css, /#odinFond\{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none;contain:paint\}/, 'derrière les cartes, sans clic');
  assert.match(css, /#odinFond \*\{pointer-events:none\}/, 'aucun de ses dessins ne prend un clic');
  // Le décor dessiné de Hestia reste au fond de la page ; l'ambiance passe au-dessus de lui, sous les cartes.
  assert.match(css, /body\{background:var\(--decor,none\) center bottom\/100% auto no-repeat fixed,linear-gradient/);
  assert.match(b.doc.body.style['--decor'] as string, /^url\("data:image\/svg\+xml/, 'le décor de Hestia est toujours là');
  const k = cartesDe(css); assert.ok(k, 'les cartes deviennent du verre');
  assert.match(k, /var\(--v-carte\)/); assert.match(k, /backdrop-filter:blur\(var\(--v-flou\)\)/);
  assert.match(css, /@supports not \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{\.card:not\(\.on\),\.tile\{background:var\(--v-plein\)\}\}/, 'sans flou possible : la carte pleine');
});

test('fond allumé : chaque texte de carte garde 4,5 pour 1 au pire moment de l\'ambiance, pour chaque thème de l\'écran (recalculé à la main)', async () => {
  const b = await bac(await etat({}));
  const liste = Object.keys((await etat({})).themes);
  const CAT = b.win.OdinCatalogueThemes as { DECORS?: Record<string, string>; HESTIA: Record<string, { decor?: string }> };
  const calc = calcul(b), scenes = b.win.OdinScenes as { couleurs: (n: string, t: unknown) => Array<[string, number, number?]> }, TH = (b.win.OdinThemes as { THEMES: Record<string, { dark: boolean; sky: string[]; decor?: string }> }).THEMES;
  let vus = 0;
  for (const id of liste) {
    const ic = id.startsWith('o-') ? id.slice(2) : `h-${id}`;
    for (const voulu of [undefined, 100]) {
      const c = calc(ic, voulu, true); if (!c || !c.ambiance) continue;
      vus++;
      const t = TH[ic], sat = Number(c.verre['--v-sat']) || 1, voile = t.dark ? [0, 0, 0] : [255, 255, 255], kv = t.dark ? 0.18 : 0.22;
      // Le décor dessiné de Hestia est celui que la page pose (le même dessin que le calcul compte).
      if (!id.startsWith('o-')) assert.equal(t.decor ?? '', CAT.DECORS?.[CAT.HESTIA[id].decor ?? ''] ?? '', `${id} : le calcul compte le décor que la page dessine`);
      // Le fond, couche par couche, comme la page le pose : le dégradé, le décor dessiné (une forme, ou deux translucides
      // l'une sur l'autre), le voile ; puis l'ambiance à sa plus forte opacité (une forme, ou deux l'une sur l'autre ; un
      // point fin compte pour ce que le flou du verre en laisse) ; saturé par le verre.
      const sigma = parseFloat(String(c.verre['--v-flou'])) || 0;
      const dec = [...new Map(decorDe(t.decor ?? '').map((f) => [`${f.c}/${f.a}`, f])).values()], dt = dec.filter((f) => f.a < 0.99);
      const socles = [...t.sky.map(hex), ...dec.filter((f) => f.a >= 0.99).map((f) => f.c)];
      const bases = [...socles, ...socles.flatMap((x) => dec.flatMap((f) => [sur(x, f.c, f.a), ...(f.a < 0.99 ? dt.filter((g) => g !== f).map((g) => sur(sur(x, f.c, f.a), g.c, g.a)) : [])]))].map((x) => sur(x, voile, kv));
      const formes = scenes.couleurs(c.ambiance, t).map(([h, a, w]) => ({ c: hex(h), a: Number(w) > 0 && sigma > 0 ? a * erf(Number(w) / (2 * Math.SQRT2 * sigma)) : a }));
      const fonds = [...bases, ...bases.flatMap((x) => formes.flatMap((f) => [sur(x, f.c, f.a), ...(f.a < 0.99 ? formes.filter((g) => g !== f).map((g) => sur(sur(x, f.c, f.a), g.c, g.a)) : [])]))].map((x) => sature(x, sat));
      // La carte à ses deux bouts ; le reflet blanc, posé au-dessus, est entier au premier bout (en haut à gauche) et
      // s'efface avant l'autre.
      const bouts = rgba(String(c.verre['--v-carte'])), reflet = Number(c.verre['--v-reflet']) || 0;
      const vu = fonds.flatMap((f) => bouts.flatMap((bt, j) => { const x = sur(f, bt.c, bt.a); return j === 0 ? [x, sur(x, [255, 255, 255], reflet)] : [x]; }));
      const textes = { '--text': c.ink, '--muted': c.pal['--muted'], '--good': c.pal['--good'], '--warn': c.pal['--warn'], '--bad': c.pal['--bad'], ...c.tons };
      for (const [n, h] of Object.entries(textes)) {
        if (!/^#[0-9a-f]{6}$/i.test(h)) continue;
        const pire = Math.min(...vu.map((f) => ratio(hex(h), f)));
        assert.ok(pire >= 4.5, `${id} (transparence ${voulu ?? 'de départ'}) : ${n} ${h} à ${pire.toFixed(2)} pour 1`);
      }
    }
  }
  assert.ok(vus >= 20, `des thèmes à ambiance vérifiés (${vus})`);
});

test('mouvement réduit : rien d\'animé ; page cachée : tout en pause, et repart quand elle revient', async () => {
  const e = { ...(await etat({})), theme: 'neige' };
  const b = await bac(e, { 'odin.maison.verre': JSON.stringify({ fond: true }) }, { cache: true });
  const css = b.page.css.textContent;
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{#odinFond,#odinFond \*\{animation:none!important;transition:none!important\}\}/, 'mouvement réduit : aucune animation');
  assert.match(css, /#odinFond\.fige,#odinFond\.fige \*\{animation-play-state:paused!important\}/);
  const c = couche(b)!; assert.ok(c.classList.contains('fige'), 'page cachée au chargement : en pause');
  b.doc.hidden = false; for (const f of b.doc.ecoute.visibilitychange ?? []) f();
  assert.equal(c.classList.contains('fige'), false, 'page revue : tout repart');
  b.doc.hidden = true; for (const f of b.doc.ecoute.visibilitychange ?? []) f();
  assert.ok(c.classList.contains('fige'), 'page cachée : en pause');
  // Seulement des transformations et de l'opacité dans les animations des ambiances.
  for (const [, corps] of css.matchAll(/@keyframes [\w-]+\{((?:[^{}]*\{[^{}]*\})*)\}/g)) for (const [, decl] of corps.matchAll(/\{([^{}]*)\}/g)) for (const p of decl.split(';').filter(Boolean)) assert.match(p.split(':')[0], /^(transform|opacity)$/, `animation : ${p}`);
});

test('le réglage du verre d\'une tablette reste sur la tablette : aucune requête ne l\'envoie (le curseur, l\'interrupteur)', async () => {
  const e = await etats();
  for (const [qui, x] of Object.entries(e)) {
    const b = await bac(x); b.requetes.length = 0;
    lance(trouve(b, 'mvVerre'), 'input', '55'); lance(trouve(b, 'mvVerre'), 'change', '60');
    lance(trouve(b, 'mvFond'), 'change', true);
    assert.deepEqual(b.requetes, [], `${qui} : rien n'est envoyé`);
    assert.deepEqual(JSON.parse(b.stock.get('odin.maison.verre')!), { verres: { [x.theme]: 60 }, fond: true }, `${qui} : gardé sur l'appareil`);
    assert.ok(cartesDe(b.page.css.textContent), `${qui} : les cartes suivent le réglage`);
    assert.ok(couche(b), `${qui} : le fond s'allume`);
    lance(trouve(b, 'mvFond'), 'change', false);
    assert.equal(couche(b), null, `${qui} : éteint, la couche part`);
  }
});

test('le curseur : les mêmes mots que sur l\'accueil, de 0 à 100, gardé pour chaque thème, et il dit sa limite', async () => {
  const e = { ...(await etat({})), theme: 'etoiles' };
  const b = await bac(e, { 'odin.maison.verre': JSON.stringify({ verres: { etoiles: 100, nuit: 20 } }) });
  const X = (b.win.OdinThemes as { TEXTES: Record<string, string> }).TEXTES, n = vue(b), c = n.find((x) => x.id === 'mvVerre')!;
  assert.equal(c.getAttribute('type'), 'range'); assert.equal(c.getAttribute('min'), '0'); assert.equal(c.getAttribute('max'), '100');
  assert.equal(c.value, '100', 'la valeur gardée pour ce thème');
  assert.ok(n.some((x) => x.tag === 'label' && x.textContent.startsWith(X.verre)), 'son nom : « Transparence du verre »');
  const lim = calcul(b)('h-etoiles', 100, false)!.curseur.limite, dit = n.find((x) => x.id === 'mvVerreLimite')!;
  if (lim < 100) assert.equal(dit.textContent, (lim === 0 ? X.verrePlein : X.verreLimite).replace('{n}', String(lim)), 'au-delà de sa limite, il le dit');
  assert.ok(n.some((x) => x.id === 'mvFond' && x.getAttribute('role') === 'switch'), 'l\'interrupteur est un vrai interrupteur');
  assert.equal(n.find((x) => x.id === 'mvFond')!.checked, false, 'éteint au départ');
});

test('un thème sans ambiance dans le catalogue : aucun élément créé, les cartes d\'avant, et la page le dit', async () => {
  for (const th of ['clair', 'plage']) {
    const e = { ...(await etat({})), theme: th };
    const avant = await bac(e, {}, { avecThemes: false }), b = await bac(e, { 'odin.maison.verre': JSON.stringify({ fond: true }) });
    assert.equal(couche(b), null, `${th} : aucune couche`);
    assert.equal(b.page.css.textContent, avant.page.css.textContent, `${th} : les cartes d'avant`);
    const X = (b.win.OdinThemes as { TEXTES: Record<string, string> }).TEXTES;
    assert.equal(trouve(b, 'mvFondSans')!.textContent, X.fondSans.replace('{nom}', e.themes[th]), `${th} : le dit`);
  }
});

test('un réglage illisible ou piégé dans le stockage de l\'appareil ne casse rien : nettoyé, borné', async () => {
  const e = { ...(await etat({})), theme: 'nuit' };
  const pieges = ['pas du json', '[]', 'null', '"oui"', JSON.stringify({ fond: 'oui', verres: [1, 2] }),
    '{"fond":true,"verres":{"__proto__":{"pollue":1},"nuit":5000,"verre":-40,"<b>":10,"constructor":3,"acier":"30"}}'];
  for (const p of pieges) {
    const b = await bac(e, { 'odin.maison.verre': p });
    assert.ok(b.page.D(), `${p} : la page est chargée`);
    assert.doesNotMatch(b.page.css.textContent, /NaN|undefined|Infinity/, `${p} : aucun nombre cassé`);
    assert.equal(({} as Record<string, unknown>).pollue, undefined, 'aucune pollution');
    assert.ok(vue(b).length > 0, `${p} : la page « Thèmes » se dessine`);
  }
  // Le dernier : la valeur trop grande est bornée à 100, le fond allumé est lu ; les clés étranges sont laissées.
  const b = await bac(e, { 'odin.maison.verre': pieges[pieges.length - 1] });
  assert.equal(trouve(b, 'mvVerre')!.value, String(calcul(b)('h-nuit', 100, true)!.curseur.valeur));
  assert.equal(trouve(b, 'mvVerre')!.value, '100');
  lance(trouve(b, 'mvVerre'), 'change', '42');
  assert.deepEqual(JSON.parse(b.stock.get('odin.maison.verre')!), { verres: { nuit: 42, verre: 0 }, fond: true }, 'réécrit propre');
  // Un stockage fermé (navigation privée) : la page se charge, sans verre ni fond.
  const f = await bac(e, {}, { stockageCasse: true });
  assert.equal(couche(f), null); assert.equal(cartesDe(f.page.css.textContent), undefined);
});

test('le réglage et le focus tiennent quand la page se redessine (toutes les 15 s, ou au lâcher du curseur)', async () => {
  const e = { ...(await etat({})), theme: 'acier' };
  const b = await bac(e, { 'odin.maison.verre': JSON.stringify({ verres: { acier: 35 }, fond: true }) });
  for (const id of ['mvVerre', 'mvFond']) {
    await b.page.load(); // le redessin automatique
    const avant = b.doc.getElementById(id)!; assert.ok(avant, `${id} à l'écran`); avant.focus();
    await b.page.load(); await new Promise((r) => setImmediate(r));
    const apres = b.doc.getElementById(id)!;
    assert.notEqual(apres, avant, `${id} : redessiné`);
    assert.equal(b.doc.activeElement, apres, `${id} : le focus y revient`);
  }
  assert.equal(b.doc.getElementById('mvVerre')!.value, '35', 'la valeur tient');
  assert.equal(b.doc.getElementById('mvFond')!.checked, true, 'le fond reste allumé');
  // Pendant qu'on fait glisser, l'écran ne se redessine pas ; au lâcher, si.
  const c = b.doc.getElementById('mvVerre')!; lance(c, 'pointerdown'); lance(c, 'input', '50');
  await b.page.load(); assert.equal(b.doc.getElementById('mvVerre'), c, 'pas de redessin pendant le geste');
  lance(c, 'change', '50'); assert.notEqual(b.doc.getElementById('mvVerre'), c, 'redessiné au lâcher');
  assert.equal(b.doc.getElementById('mvVerre')!.value, '50');
});

test('fond allumé : les textes posés sur le fond hors du bandeau (titres, messages, notes, boutons, noms des thèmes) reçoivent le verre de la carte', async () => {
  const e = { ...(await etat({})), theme: 'etoiles' };
  const b = await bac(e, { 'odin.maison.verre': JSON.stringify({ fond: true }) }), css = b.page.css.textContent;
  const v = calcul(b)('h-etoiles', undefined, true)!; assert.ok(v.ambiance, 'Ciel étoilé a son ambiance');
  // Les boutons de « Mes boutons » sont des cartes : le même verre (son flou, ses tons) que les autres.
  assert.ok(cartesDe(css)?.includes(v.carte), 'les boutons sont en verre comme les cartes');
  // Les titres de section, les familles de thèmes, les notes, les messages vides : une plaque du même verre, avec les
  // mêmes tons que la carte (ils gardent donc 4,5 pour 1, comme le texte des cartes).
  const PL = '#main>.sec,#main>.fam,#main>p.muted,#main .empty,.th>span';
  const i = css.indexOf(`${PL}{`); assert.ok(i >= 0, 'une plaque sous les textes posés sur le fond');
  const corps = css.slice(i + PL.length + 1, css.indexOf('}', i));
  assert.ok(corps.startsWith(v.carte), 'le verre de la carte');
  for (const [k, c] of Object.entries({ '--text': v.ink, '--muted': v.pal['--muted'], ...v.tons })) if (/^#[0-9a-f]{6}$/i.test(c)) assert.ok(corps.includes(`;${k}:${c}`), `le ton ${k} de la carte`);
  assert.match(css, /\.th>span\{color:var\(--text\)\}/, 'le nom d\'un thème prend le texte du verre');
  assert.match(css, /@supports not \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{#main>\.sec,#main>\.fam,#main>p\.muted,#main \.empty,\.th>span\{background:var\(--v-plein\)\}\}/, 'sans flou possible : la plaque pleine');
  // Fond éteint (le curseur seul) : pas de plaque ; sans réglage : rien du tout.
  const c = await bac(e, { 'odin.maison.verre': JSON.stringify({ verres: { etoiles: 40 } }) });
  assert.doesNotMatch(c.page.css.textContent, /#main>\.sec/, 'fond éteint : pas de plaque');
  assert.ok(cartesDe(c.page.css.textContent), 'fond éteint : les cartes et les boutons suivent le curseur');
  assert.doesNotMatch((await bac(e)).page.css.textContent, /#main>\.sec|\.tile\{background:linear|--v-carte/, 'sans réglage : rien');
});

test('sans réglage, le curseur ne montre pas une transparence que l\'écran n\'a pas : il dit « cartes d\'origine »', async () => {
  const e = { ...(await etat({})), theme: 'etoiles' };
  const b = await bac(e), X = (b.win.OdinThemes as { TEXTES: Record<string, string> }).TEXTES;
  const val = trouve(b, 'mvVerreVal')!;
  assert.doesNotMatch(val.textContent, /\d/, 'aucun nombre');
  assert.equal(val.textContent, /verreOrigine: '([^']*)'/.exec(MAISON)?.[1], 'les mots de la page');
  lance(trouve(b, 'mvVerre'), 'change', '40');
  assert.equal(trouve(b, 'mvVerreVal')!.textContent, X.verreValeur.replace('{n}', '40'), 'après un choix : la valeur');
  // Fond allumé sans choix du curseur : les cartes sont en verre à la transparence de départ, et le curseur la montre.
  const f = await bac(e, { 'odin.maison.verre': JSON.stringify({ fond: true }) });
  assert.equal(trouve(f, 'mvVerreVal')!.textContent, X.verreValeur.replace('{n}', String(calcul(f)('h-etoiles', undefined, true)!.curseur.valeur)));
});

test('la page « Thèmes » : la case du fond animé est alignée sur le libellé du curseur (sans marge à gauche)', () => {
  assert.match(MAISON, /\.vf input\[type=checkbox\]\{width:24px;height:24px;margin:0;/);
});

// ---------- Le cadre de l'écran, fond allumé : le bandeau, les onglets de pièces, la barre de côté, la barre du bas ----------
// Fond allumé, les textes posés hors des cartes (le salut et la date, la recherche et son texte d'attente, la pastille, les
// boutons ronds, les onglets, la barre de côté, sa punaise et sa poignée, la barre du bas et sa feuille « Plus ») reçoivent
// le même verre que les cartes, sorti du même calcul (themes.js) : ils gardent 4,5 pour 1 comme le texte des cartes.
// Fond éteint ou sans réglage : rien ne change.
const CADRES = '.top .search,.round,.top .retour,.tabs,.side,.side.libre,.bnav,.feuille';
test('fond allumé : le cadre de l\'écran (bandeau, onglets, barre de côté, barre du bas et « Plus ») reçoit le verre des cartes, avec leurs tons ; éteint : rien', async () => {
  const e = { ...(await etat({})), theme: 'etoiles' };
  const b = await bac(e, { 'odin.maison.verre': JSON.stringify({ fond: true }) }), css = b.page.css.textContent;
  const v = calcul(b)('h-etoiles', undefined, true)!; assert.ok(v.ambiance);
  // (seulement le texte et le texte discret : la pastille rouge du nombre d'alertes garde son rouge)
  const tons = Object.entries({ '--text': v.ink, '--muted': v.tons['--muted'] ?? v.pal['--muted'] }).map(([k, c]) => `;${k}:${c}`).join('');
  assert.ok(css.includes(`${CADRES}{${v.carte};color:var(--text)${tons}}`), 'le verre de la carte, ses tons, sous chaque cadre');
  assert.ok(css.includes(`.poignee{color:var(--muted)${tons}}.poignee::before{${v.carte}}`), 'la poignée : le même verre sur sa bande');
  assert.ok(css.includes(`.top .hello{position:relative;z-index:0;color:var(--text)${tons}}.top .hello::before{content:'';position:absolute;inset:-6px -12px;z-index:-1;pointer-events:none;border:1px solid var(--v-bord);border-radius:14px;${v.carte}}`), 'le salut et la date : une plaque derrière eux, qui ne déplace rien et ne prend aucun clic');
  assert.ok(css.includes('.top .search input::placeholder{color:var(--muted);opacity:1}'), 'le texte d\'attente de la recherche prend le texte discret du verre');
  assert.ok(css.includes('.tabs{width:fit-content;max-width:100%;border-radius:24px}'), 'les onglets : une plaque à leur mesure');
  assert.ok(css.includes(`@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){${CADRES},.poignee::before,.top .hello::before{background:var(--v-plein)}}`), 'sans flou possible : la plaque pleine');
  // Fond éteint (le curseur seul), fond sur « non » et sans réglage : aucun de ces styles.
  for (const g of [{ 'odin.maison.verre': JSON.stringify({ verres: { etoiles: 40 } }) }, { 'odin.maison.verre': JSON.stringify({ fond: false }) }, {}] as Array<Record<string, string>>) {
    const c = (await bac(e, g)).page.css.textContent;
    // (le style commun dessine déjà la bande de la poignée, « .poignee::before{content… » : seul le verre y serait de plus)
    assert.ok(!c.includes(CADRES) && !c.includes('.top .hello::before') && !c.includes('::placeholder') && !c.includes('.poignee::before{background'), `${JSON.stringify(g)} : le cadre d'avant`);
  }
});

// ---------- Dans un vrai navigateur (ignoré, en le disant, sans Playwright sur la machine) ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
type PageNav = { goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>; evaluate<R>(f: string | ((a: any) => R), a?: unknown): Promise<R>; waitForTimeout(ms: number): Promise<void>; route(u: string, f: (r: any) => Promise<void>): Promise<void>; screenshot(o?: Record<string, unknown>): Promise<Buffer>; click(s: string): Promise<void>; mouse: { move(x: number, y: number): Promise<void> }; addStyleTag(o: { content: string }): Promise<any>; on(e: string, f: (x: Error) => void): void };
type CtxNav = { newPage(): Promise<PageNav>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: (a: any) => void, a?: unknown): Promise<void>; close(): Promise<void> };
type Nav = { newContext(o: Record<string, unknown>): Promise<CtxNav>; close(): Promise<void> };
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Nav> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Nav | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
// Les thèmes les plus durs (le plan et la relecture) : deux d'Odin très clairs ou très sombres, Ciel étoilé, Neige, Pluie,
// et Aurore boréale (un thème de Hestia à décor dessiné ; Ciel étoilé et Neige en ont un aussi) ; Lagon (Hestia, des
// vagues), dont l'onglet choisi et l'entrée en cours de la barre de côté avaient un voile blanc de plus sur la plaque.
const DURS = ['o-glace', 'o-ha', 'etoiles', 'neige', 'o-pluie', 'boreale', 'lagon'];
const PIECES_NAV = ['Pièce A', 'Pièce B', 'Pièce C'];
/**
 * L'écran de la maison dans un navigateur : avec une tablette « maison » (le thème et le réglage gardés sur l'appareil)
 * ou avec sa session (le thème gardé par Odin). Trois pièces inventées pour avoir des onglets ; un prénom inventé pour
 * la pastille s'il n'y en a pas. `sansCalcul` : la page sans themes.js, celle d'avant le verre.
 */
async function ouvrirNav(largeur: number, theme: string, reglage: unknown, o: { session?: boolean; barre?: '0' | '1'; sansCalcul?: boolean } = {}) {
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: largeur < 800 ? 844 : 900 }, reducedMotion: 'no-preference', colorScheme: 'dark' });
  if (o.session) {
    await valhallaOf()!.act('gladsheim', 'theme', { theme });
    const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  }
  await ctx.addInitScript(([t, r, br]: [string, string | null, string]) => {
    try { localStorage.setItem('odin.maison.theme', t); if (r === null) localStorage.removeItem('odin.maison.verre'); else localStorage.setItem('odin.maison.verre', r); localStorage.setItem('odin.maison.barre', br); } catch { /* */ }
  }, [theme, reglage === null ? null : JSON.stringify(reglage), o.barre ?? '0']);
  const page = await ctx.newPage(), erreurs: string[] = [];
  page.on('pageerror', (x) => erreurs.push(String(x)));
  await page.route('**/api/maison/etat', async (r: any) => { const rep = await r.fetch(); const j = await rep.json(); j.rooms = PIECES_NAV.map((nom, i) => ({ name: nom, devices: [{ id: `e${i}`, name: `Appareil ${i + 1}`, kind: 'prise', state: 'off' }] })); j.name ||= 'Awa'; await r.fulfill({ response: rep, json: j }); });
  if (o.sansCalcul) await page.route('**/themes.js', (r: any) => r.abort());
  await page.goto(`${v.url}/maison${o.session ? '' : `#cle=${cleMaison}`}`);
  await page.waitForSelector('.app main .top .hello', { timeout: 30000 });
  await page.waitForTimeout(700);
  return { ctx, page, erreurs };
}
// Les zones du cadre dont on lit chaque texte (et chaque icône).
const ZONES = ['.top .hello', '.top .search', '.round', '.top .retour', '.me', '.tabs', '.side', '.poignee', '.bnav', '.feuille'];
// Chaque texte visible de ces zones : sa boîte (une par ligne), sa couleur ; les icônes ; le texte d'attente de la recherche.
const BOITES = `((zones) => { const out = [], vu = (e) => { const s = getComputedStyle(e); return s.visibility === 'visible' && s.display !== 'none' && e.getClientRects().length > 0; };
  const pose = (r, c, nom, racine) => { const x = Math.max(0, Math.ceil(r.left)), y = Math.max(0, Math.ceil(r.top)), x2 = Math.min(innerWidth, Math.floor(r.right)), y2 = Math.min(innerHeight, Math.floor(r.bottom));
    if (x2 - x < 2 || y2 - y < 2) return; const h = document.elementFromPoint((x + x2) / 2, (y + y2) / 2); if (!h || !(racine === h || racine.contains(h))) return; out.push({ x, y, w: x2 - x, h: y2 - y, c, nom }); };
  for (const z of zones) for (const racine of document.querySelectorAll(z)) { if (!vu(racine)) continue;
    for (const e of [racine, ...racine.querySelectorAll('*')]) { if (e.closest('.dot') || !vu(e)) continue; const cs = getComputedStyle(e);
      if (e.tagName === 'svg') { pose(e.getBoundingClientRect(), cs.color, z + ' (icône)', racine); continue; } if (e.closest('svg')) continue;
      if (e.tagName === 'INPUT' && e.placeholder && !e.value) { const r = e.getBoundingClientRect(); pose({ left: r.left, top: r.top + 2, right: r.right, bottom: r.bottom - 2 }, getComputedStyle(e, '::placeholder').color, z + ' (texte d attente)', racine); continue; }
      for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const g = document.createRange(); g.selectNodeContents(n); for (const r of g.getClientRects()) pose(r, cs.color, z + ' « ' + n.textContent.trim().slice(0, 24) + ' »', racine); } } }
  return out; })`;
// Pour la photo : les textes et les icônes du cadre deviennent transparents (on ne garde que ce qu'il y a derrière) ; la
// mascotte et ce qui l'accompagne sont cachés le temps de la mesure.
const SANS_TEXTE = '.top,.top *,.tabs *,.side *,.poignee,.bnav *,.feuille *,.me{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}'
  + '.top svg,.tabs svg,.side svg,.poignee svg,.bnav svg,.feuille svg,.round svg,.dot{visibility:hidden!important}::placeholder{color:transparent!important}';
const SANS_MASCOTTE = '.pet,.bubble,.ball,.toast{visibility:hidden!important}';
// Les instants de l'ambiance (chaque animation de la couche arrêtée au même temps) : de quoi tomber sur son pire moment.
const INSTANTS = [0, 1300, 2900, 4700, 6100, 8300, 11500];
const figer = (p: PageNav, t: number) => p.evaluate(`(() => { for (const a of document.getAnimations()) { const c = a.effect && a.effect.target; if (c && c.closest && c.closest('#odinFond')) { a.pause(); a.currentTime = ${t}; } } })()`);
type Boite = { x: number; y: number; w: number; h: number; c: string; nom: string };
/** Le pire contraste, mesuré au pixel, de chaque texte du cadre, sur toutes les photos (les instants de l'ambiance). */
async function contrastes(p: PageNav, zones: string[], analyse: PageNav): Promise<Array<{ nom: string; min: number }>> {
  await p.addStyleTag({ content: SANS_MASCOTTE }); await p.waitForTimeout(50);
  const boites = await p.evaluate<Boite[]>(`${BOITES}(${JSON.stringify(zones)})`);
  const cache = await p.addStyleTag({ content: SANS_TEXTE }); await p.waitForTimeout(80);
  const photos: string[] = [];
  for (const t of INSTANTS) { await figer(p, t); await p.waitForTimeout(40); photos.push((await p.screenshot()).toString('base64')); }
  await cache.evaluate((n: any) => n.remove());
  return analyse.evaluate(async ([imgs, bx]: [string[], Boite[]]) => {
    const lin = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }, lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const g = globalThis as any, datas: any[] = [];
    for (const b64 of imgs) { const bin = g.atob(b64), u8 = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j); const bm = await g.createImageBitmap(new g.Blob([u8], { type: 'image/png' })); const cv = new g.OffscreenCanvas(bm.width, bm.height), cx = cv.getContext('2d'); cx.drawImage(bm, 0, 0); datas.push(cx.getImageData(0, 0, bm.width, bm.height)); }
    return bx.map((t) => { const m = (t.c.match(/[\d.]+/g) || []).map(Number), a = m.length > 3 ? m[3] : 1; let min = 99;
      for (const d of datas) for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) { const i = (y * d.width + x) * 4, pr = d.data[i], pg = d.data[i + 1], pb = d.data[i + 2];
        const l1 = lum(m[0] * a + pr * (1 - a), m[1] * a + pg * (1 - a), m[2] * a + pb * (1 - a)), l2 = lum(pr, pg, pb), r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); if (r < min) min = r; }
      return { nom: t.nom, min: Math.round(min * 100) / 100 }; });
  }, [photos, boites]);
}
const durs = (r: Array<{ nom: string; min: number }>) => r.filter((x) => x.min < 4.5).map((x) => `${x.nom} ${x.min}`);
type Etape = [string, string[], ((p: PageNav) => Promise<void>) | null];

for (const largeur of [1280, 390]) {
  test(`navigateur, ${largeur} px, fond allumé, au pire moment de l'ambiance : chaque texte du cadre garde 4,5 pour 1, mesuré au pixel (${DURS.join(', ')})`, { skip: sansNav, timeout: 900000 }, async () => {
    const ctxA = await nav!.newContext({}), analyse = await ctxA.newPage();
    const manque: string[] = [], vus = new Set<string>();
    try {
      for (const theme of DURS) {
        // Grand écran : la barre de côté épinglée ; puis détachée (sa poignée), puis ouverte à la souris. Téléphone : avec
        // sa session, le bandeau et la barre du bas, puis la feuille « Plus ».
        const passes: Array<[string, { session?: boolean; barre?: '0' | '1' }, Etape[]]> = largeur > 800
          ? [['épinglée', { barre: '1' }, [['bandeau', ZONES, null]]], ['détachée', { barre: '0' }, [['poignée', ['.poignee', '.tabs'], null], ['barre ouverte', ['.side'], async (p) => { await p.mouse.move(2, 400); await p.waitForTimeout(900); }]]]]
          : [['session', { session: true }, [['bandeau', ZONES, null], ['« Plus »', ['.feuille', '.bnav'], async (p) => { await p.click('.bnav .plus'); await p.waitForTimeout(400); }]]]];
        for (const [quoi, o, etapes] of passes) {
          const { ctx, page, erreurs } = await ouvrirNav(largeur, theme, { fond: true }, o);
          try {
            // (Home Assistant n'a pas d'ambiance dans le catalogue : fond allumé, rien n'y bouge, et le cadre est celui
            //  d'avant, comme ses cartes ; ses textes sont lus quand même)
            const allume = theme !== 'o-ha';
            assert.equal(await page.evaluate('!!document.getElementById("odinFond")'), allume, `${theme} : le fond`);
            if (!allume) assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".tabs")).backdropFilter'), 'none', `${theme} : sans ambiance, le cadre d'avant`);
            // La pastille à l'initiale et le logo de la barre de côté sont posés sur leur propre rond plein (la couleur
            // « allumée » du thème) : l'ambiance ne passe pas sous eux. Fond allumé, leur lettre garde 4,5 pour 1 elle aussi,
            // mesurée comme les autres (elle n'est plus mise à part).
            // (une couleur pleine, ou un dégradé de couleurs pleines)
            const pleins = await page.evaluate<string[]>('[...document.querySelectorAll(".me,.side .logo")].map((e) => { const s = getComputedStyle(e); return s.backgroundImage === "none" ? s.backgroundColor : s.backgroundImage; })');
            for (const c of pleins) assert.ok(/rgb\(/.test(c) && !/rgba\(/.test(c), `${theme} : un rond plein (${c})`);
            for (const [nom, zones, avant] of etapes) {
              if (avant) await avant(page);
              const r = await contrastes(page, zones, analyse);
              for (const x of r) vus.add(zones.find((z) => x.nom.startsWith(z)) ?? x.nom);
              // (sans ambiance, rien ne change : ce qui est lu est le cadre d'avant, noté)
              if (allume) manque.push(...durs(r).map((x) => `${theme} ${largeur} px, ${quoi}, ${nom} : ${x}`));
              // (ODIN_MESURES : chaque mesure, pour le carnet)
              if (process.env.ODIN_MESURES) process.stderr.write(`# mesure ${theme} ${largeur} ${quoi} ${nom} : ${r.map((x) => `${x.nom} ${x.min}`).join(' | ')}\n`);
            }
            assert.deepEqual(erreurs, [], 'aucune erreur de page');
          } finally { await ctx.close(); }
        }
      }
    } finally { await ctxA.close(); }
    // Chaque partie du cadre a été lue (la recherche n'existe qu'au grand écran, la barre du bas qu'au téléphone).
    for (const z of largeur > 800 ? ['.top .hello', '.top .search', '.round', '.me', '.tabs', '.side', '.poignee'] : ['.top .hello', '.round', '.top .retour', '.me', '.tabs', '.bnav', '.feuille']) assert.ok(vus.has(z), `${z} mesuré`);
    assert.deepEqual(manque, [], 'textes sous 4,5 pour 1');
  });
}

// Les styles calculés du cadre (le texte, le fond, le flou, la taille, la place), et ceux de ses pseudo-éléments.
const STYLES_CADRE = `((zones) => { const P = ['color', 'background-image', 'background-color', 'backdrop-filter', 'border-top-color', 'border-top-width', 'box-shadow', 'border-radius', 'width', 'height', 'padding-left', 'padding-top', 'position', 'z-index', 'opacity', 'display', 'visibility', 'content', 'inset'];
  const lit = (e, ps) => { const s = getComputedStyle(e, ps); return P.map((k) => k + ':' + s.getPropertyValue(k)).join(';'); }, out = {};
  zones.forEach((z) => document.querySelectorAll(z).forEach((r, i) => [r, ...r.querySelectorAll('*')].forEach((e, j) => { if (e.closest('svg') && e.tagName !== 'svg') return; const k = z + '#' + i + '/' + j + ' ' + e.tagName + '.' + e.getAttribute('class'); const b = e.getBoundingClientRect();
    out[k] = lit(e, null) + ';rect:' + [b.left, b.top, b.width, b.height].map(Math.round).join(',') + ';avant:' + lit(e, '::before') + (e.tagName === 'INPUT' ? ';attente:' + lit(e, '::placeholder') : ''); })));
  return out; })`;
test('navigateur, 390 et 1280 px : fond éteint ou sans réglage, les styles calculés du cadre sont exactement ceux d\'avant (la page sans le calcul du verre)', { skip: sansNav, timeout: 600000 }, async () => {
  for (const largeur of [1280, 390]) for (const theme of ['o-glace', 'etoiles', 'boreale']) {
    const lire = async (r: unknown, o: { sansCalcul?: boolean } = {}) => { const { ctx, page } = await ouvrirNav(largeur, theme, r, { barre: '1', ...o }); try { return await page.evaluate<Record<string, string>>(`${STYLES_CADRE}(${JSON.stringify(ZONES)})`); } finally { await ctx.close(); } };
    const avant = await lire(null, { sansCalcul: true });
    assert.ok(Object.keys(avant).length > 20, 'le cadre est lu');
    for (const r of [null, { fond: false }, { fond: false, verres: { [theme]: 40 } }]) assert.deepEqual(await lire(r), avant, `${theme} ${largeur} px, ${JSON.stringify(r)} : le cadre d'avant`);
  }
});

const CIBLES = ['.round', '.top .retour', '.top .search input', '.tabs button', '.side .nav', '.side .pinb', '.poignee', '.bnav .nav', '.bnav .nid', '.feuille .nav'];
const CIBLES_VUES = `((sels) => { const out = []; for (const s of sels) document.querySelectorAll(s).forEach((e, i) => { const st = getComputedStyle(e); if (st.display === 'none' || st.visibility !== 'visible' || !e.getClientRects().length) return; const r = e.getBoundingClientRect();
  const h = r.width && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : e; out.push({ s: s + '#' + i, rect: [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 2) / 2), touche: !!h && (h === e || e.contains(h)) }); }); return out; })`;
const VISIBLES = '[...document.querySelectorAll("body *")].filter((e) => !e.closest("#odinFond,.pet,.bubble,.ball,.toast,template,script,style") && e.getClientRects().length && getComputedStyle(e).visibility === "visible").map((e) => e.tagName + "." + e.getAttribute("class"))';
test('navigateur, fond allumé : aucune plaque ne prend un clic ni ne change la taille ou la place d\'une cible ; elles tiennent au redessin ; en plein écran, rien de plus n\'apparaît', { skip: sansNav, timeout: 600000 }, async () => {
  for (const [largeur, o] of [[1280, { barre: '1' }], [1280, { barre: '0' }], [390, { session: true }]] as Array<[number, { session?: boolean; barre?: '0' | '1' }]>) {
    for (const theme of ['etoiles', 'o-glace']) {
      const voir = async (r: unknown, plus: boolean) => {
        const { ctx, page } = await ouvrirNav(largeur, theme, r, o);
        try {
          await page.addStyleTag({ content: SANS_MASCOTTE });
          if (plus) { await page.click('.bnav .plus'); await page.waitForTimeout(400); }
          const c = await page.evaluate<Array<{ s: string; rect: number[]; touche: boolean }>>(`${CIBLES_VUES}(${JSON.stringify(CIBLES)})`);
          // Le redessin automatique (toutes les 15 s) : la page relit son état quand elle redevient visible.
          await page.evaluate('document.dispatchEvent(new Event("visibilitychange"))'); await page.waitForTimeout(1200);
          const apres = await page.evaluate<string>('getComputedStyle(document.querySelector(".tabs")).backdropFilter');
          let pleinVu: string[] = [];
          if (!plus) {
            await page.click('.top .round.plein'); await page.waitForTimeout(500);
            pleinVu = await page.evaluate<string[]>(VISIBLES);
            assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".top")).display'), 'none', 'plein écran : le bandeau reste caché');
          }
          return { c, apres, pleinVu };
        } finally { await ctx.close(); }
      };
      for (const plus of largeur < 800 ? [false, true] : [false]) {
        const off = await voir(null, plus), on = await voir({ fond: true }, plus), qui = `${theme} ${largeur} px ${JSON.stringify(o)}${plus ? ' « Plus »' : ''}`;
        assert.ok(off.c.length >= 5, `${qui} : des cibles`);
        assert.deepEqual(on.c, off.c, `${qui} : mêmes cibles, même taille, même place, et le doigt tombe sur elles`);
        // (feuille « Plus » ouverte, son voile couvre le reste de l'écran : seules la barre du bas et la feuille se touchent)
        for (const x of on.c) if (!plus || /^\.(bnav|feuille) /.test(x.s)) assert.ok(x.touche, `${qui} : ${x.s} prend son clic`);
        assert.notEqual(on.apres, 'none', `${qui} : la plaque tient au redessin`);
        assert.equal(off.apres, 'none', `${qui} : fond éteint, pas de plaque`);
        assert.deepEqual(on.pleinVu, off.pleinVu, `${qui} : en plein écran, rien de plus n'apparaît`);
      }
    }
  }
});

test('navigateur, 1280 px, fond allumé : sa session et une tablette « maison » voient le même cadre (un membre est refusé, plus haut)', { skip: sansNav, timeout: 300000 }, async () => {
  const lire = async (o: { session?: boolean }) => { const { ctx, page } = await ouvrirNav(1280, 'o-glace', { fond: true }, { barre: '1', ...o }); try { return await page.evaluate<Record<string, string>>(`${STYLES_CADRE}(${JSON.stringify(['.top .hello', '.top .search', '.tabs'])})`); } finally { await ctx.close(); } };
  const t = await lire({}), s = await lire({ session: true });
  // (la place peut différer : le retour vers Odin de sa session ; le style, jamais)
  const sansPlace = (x: Record<string, string>) => Object.fromEntries(Object.entries(x).map(([k, y]) => [k, y.replace(/;rect:[^;]*/, '').replace(/;width:[^;]*/, '')]));
  assert.deepEqual(sansPlace(s), sansPlace(t));
  assert.match(t['.tabs#0/0 DIV.tabs'] ?? '', /backdrop-filter:blur/, 'la plaque est là');
});
