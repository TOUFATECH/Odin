// Le curseur « Transparence du verre » (maquette validée « Accueil et écran de la maison » : un curseur de 0 à 100,
// dont la valeur est gardée pour chaque thème). Dans Réglages → Apparence, gardé par Odin pour chaque thème, le même
// sur tous ses écrans ; le verre n'existe que sur l'accueil (choix du propriétaire du 23/11). Sa décision du 25/11
// (« Décor derrière, verre plus opaque ») : chaque texte de carte reste lisible. Le curseur va donc de 0 à 100 comme
// dans la maquette, mais la transparence posée ne dépasse jamais la limite du thème (celle qui garde 4,5:1 au pire
// point de son décor) ; au-delà, la carte ne devient pas plus transparente, et le réglage le dit en une phrase. Sans
// valeur gardée pour un thème, rien ne change chez lui. Le thème automatique et celui d'un événement ont chacun la leur.
// Le réglage passe par l'action qui existait déjà pour Réglages → Apparence (« regler_mascotte »), réservée au
// propriétaire dès qu'elle parle du verre ; la valeur est rendue par « mascotte ».
// Odin d'essai dans un dossier temporaire ; la page est chargée dans un bac à sable (catalogue puis themes.js), et,
// si Playwright est là, dans un vrai navigateur (390 et 1280 px) sans aucun Odin derrière.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { apparence } from '../src/valhalla/modules/apparence.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { createServer } from 'node:http';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';
import { valhallaPost } from '../src/web/valhalla-api.ts';
import { maisonRoute } from '../src/web/maison-api.ts';

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(`../${chemin}`, import.meta.url)), 'utf8');
const THEMES_JS = lire('src/web/themes.js');
const CATALOGUE_JS = lire('src/web/pages/themes-catalogue.js');

// ------------------------------------------------------------------ côté Odin : gardé, nettoyé, réservé au propriétaire

function odinDEssai() {
  const home = mkdtempSync(join(tmpdir(), 'odin-verre-reglage-'));
  const v = new Valhalla(home, [apparence], { notify: async () => {} });
  return { v, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
const regler = (v: Valhalla, j: Record<string, unknown>, o: Record<string, unknown> = {}) => v.act('apparence', 'regler_mascotte', { reglages: JSON.stringify(j) }, o as never);
const verreDOdin = async (v: Valhalla) => ((await v.act('apparence', 'mascotte', {})).data as { verre?: Record<string, number> }).verre;

test('verre gardé par Odin : une valeur hors de 0-100 est ramenée dans les bornes ; un thème inconnu ou une valeur qui n\'est pas un nombre ne compte pas', async () => {
  const { v, fin } = odinDEssai();
  try {
    assert.deepEqual(await verreDOdin(v), {}, 'rien de gardé : « mascotte » le dit (chaque thème garde sa transparence de départ)');
    const r = await regler(v, { verre: { glace: -20, nuit: 150, foret: 42.6, neige: '70', ciel: Number.NaN, inconnu: 50, valhalla: 50, 'ev-noel': 1e9 } });
    assert.equal(r.ok, true, r.text);
    assert.deepEqual(await verreDOdin(v), { glace: 0, nuit: 100, foret: 43, 'ev-noel': 100 });
    // Rien d'utilisable : rien n'est enregistré, et c'est dit.
    const rien = await regler(v, { verre: { neige: 'beaucoup' } });
    assert.equal(rien.ok, false); assert.match(rien.text, /rien à enregistrer/);
    assert.deepEqual(await verreDOdin(v), { glace: 0, nuit: 100, foret: 43, 'ev-noel': 100 });
  } finally { fin(); }
});

test('verre gardé par Odin : une valeur par thème (régler un thème ne touche pas aux autres)', async () => {
  const { v, fin } = odinDEssai();
  try {
    await regler(v, { verre: { glace: 30 } });
    await regler(v, { verre: { nuit: 70 } });
    assert.deepEqual(await verreDOdin(v), { glace: 30, nuit: 70 });
    await regler(v, { verre: { glace: 55 } });
    assert.deepEqual(await verreDOdin(v), { glace: 55, nuit: 70 });
    // Un autre réglage de la même page ne l'efface pas.
    await regler(v, { humeurTheme: false });
    assert.deepEqual(await verreDOdin(v), { glace: 55, nuit: 70 });
  } finally { fin(); }
});

test('verre gardé par Odin : réservé au propriétaire (ni une automatisation, ni un membre, ni après un contenu extérieur) ; le reste de la page ne change pas', async () => {
  const { v, fin } = odinDEssai();
  try {
    const a = v.action('apparence', 'regler_mascotte')!.a;
    assert.equal(typeof a.proprietaireSeul, 'function', 'propriétaire seul quand il s\'agit du verre');
    for (const [qui, o] of [['une automatisation', { auto: true, by: 'automatisation' }], ['un membre', { qui: 'member' }], ['un contenu extérieur', { marque: true }]] as const) {
      const r = await regler(v, { verre: { glace: 10 } }, o);
      assert.equal(r.ok, false, qui); assert.match(r.text, /seul le propriétaire/, qui);
    }
    assert.deepEqual(await verreDOdin(v), {}, 'rien n\'a été gardé');
    // Le propriétaire, lui, le règle.
    assert.equal((await regler(v, { verre: { glace: 10 } })).ok, true);
    assert.deepEqual(await verreDOdin(v), { glace: 10 });
    // Ce qui était permis avant (l'interrupteur de l'humeur) l'est toujours.
    assert.equal((await regler(v, { humeurTheme: false }, { qui: 'member' })).ok, true);
  } finally { fin(); }
});

test('verre gardé par Odin : refusé aussi à la clé d\'API et à une tablette « maison » ; la valeur ne bouge pas', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-verre-entrees-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé par l\'essai'); }) as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  setValhalla(v); resetGladsheim();
  const srv = createServer((req, res) => { void maisonRoute(req, res, new URL(req.url!, 'http://x'), { authed: false, name: '', mascot: '<svg></svg>', fail: () => {}, ask: async () => '' }).then((fait) => { if (!fait) { res.writeHead(404); res.end(); } }); });
  try {
    assert.equal((await regler(v, { verre: { glace: 30 } })).ok, true, 'le propriétaire le règle');
    const reglages = JSON.stringify({ verre: { glace: 5 } });
    // La clé d'API (pas la session du propriétaire).
    const cle = await valhallaPost('/api/valhalla/act', { module: 'apparence', action: 'regler_mascotte', input: { reglages }, confirm: true }) as { ok: boolean; text: string };
    assert.equal(cle.ok, false, 'la clé d\'API'); assert.match(cle.text, /pas avec la clé d'API/);
    // Une tablette « maison » : même par un bouton posé sur l'écran de la maison.
    assert.notEqual((await v.act('gladsheim', 'bouton', { nom: 'Verre', appli: 'apparence', action: 'regler_mascotte', reglages: `reglages=${reglages}` })).ok, false);
    const tuile = (v.ctx('gladsheim').settings.tiles as Array<{ id: string; action: string }>).find((x) => x.action === 'regler_mascotte')!;
    await new Promise<void>((ok) => srv.listen(0, 'localhost', () => ok()));
    const base = `http://localhost:${(srv.address() as { port: number }).port}`;
    const key = ((await v.act('gladsheim', 'cle_tablette', { nom: 'Tablette entrée', droits: 'maison' })).data as { key: string }).key;
    const r = await (await fetch(`${base}/api/maison/bouton`, { method: 'POST', headers: { 'x-odin-maison': key, 'x-odin': '1', 'content-type': 'application/json' }, body: JSON.stringify({ id: tuile.id, confirm: true }) })).json() as { ok: boolean; text: string };
    assert.equal(r.ok, false, 'tablette « maison »'); assert.match(r.text, /seul le propriétaire/);
    assert.deepEqual(await verreDOdin(v), { glace: 30 }, 'aucun refusé n\'a changé la valeur');
  } finally { await new Promise<void>((ok) => { srv.close(() => ok()); }); setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ côté page : jamais illisible

interface Curseur { valeur: number; choisie: boolean; limite: number }
interface Charge { styles: Array<{ id?: string; textContent: string }>; O: { apply(id: string): void; verre(id: string): Curseur | undefined; reglerVerre(v: number, fini: boolean): Promise<void>; sync(): Promise<boolean>; THEMES: Record<string, { sky?: string[] }> }; surfaceOf: (t: Record<string, unknown>, g: number) => { surface: string }; catalogue: Record<string, Record<string, unknown>> }
function charger(garde: unknown = null): Charge {
  const styles: Array<{ id?: string; textContent: string }> = [];
  const element = () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append: (s: { id?: string; textContent: string }) => styles.push(s) }, createElement: () => element(),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null,
  };
  const window: Record<string, unknown> = { addEventListener() {} };
  window.window = window;
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => JSON.stringify(garde), setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, console });
  vm.runInContext(CATALOGUE_JS, ctx);
  vm.runInContext(THEMES_JS, ctx);
  const cat = window.OdinCatalogueThemes as { surfaceOf: Charge['surfaceOf']; THEMES: Charge['catalogue'] };
  return { styles, O: window.OdinThemes as Charge['O'], surfaceOf: cat.surfaceOf, catalogue: cat.THEMES };
}
const css = (c: Charge) => c.styles.find((s) => s.id === 'odinThemeStyle')?.textContent ?? '';
const variable = (texte: string, nom: string) => new RegExp(`${nom}:([^;}]*)`).exec(texte)?.[1]?.trim() ?? '';
const racine = (t: string) => /:root\[data-odin-theme\]\{([^}]*)\}/.exec(t)?.[1] ?? '';
const regleCartes = (t: string) => /:not\(\.dragging\)\{([^}]*)\}/.exec(t)?.[1] ?? '';

// Le pire point derrière une carte, recalculé ici sans le code de themes.js (la même lecture que test/themes-verre.test.ts) :
// le dégradé, le dessin du décor (jusqu'à trois formes translucides l'une sur l'autre), le voile, la saturation du
// verre ; puis la carte à ses deux bouts et le reflet en haut.
const hexRGB = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const sur = (dessous: number[], c: number[], a: number) => dessous.map((v, i) => v * (1 - a) + c[i] * a);
const lumi = (c: number[]) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (x: number[], y: number[]) => { const a = lumi(x), b = lumi(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const saturer = ([r, g, b]: number[], s: number) => [
  (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
  (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
  (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
].map((v) => Math.max(0, Math.min(255, v)));
function couleursDuDessin(svg: string): Array<{ c: number[]; a: number }> {
  const plein = (s: string | undefined) => (!s || s === 'none' ? null : /^#[0-9a-f]{3}$/i.test(s) ? [1, 2, 3].map((i) => parseInt(s[i] + s[i], 16)) : /^#[0-9a-f]{6}$/i.test(s) ? [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) : null);
  const out: Array<{ c: number[]; a: number }> = [];
  const groupes: Array<{ fill?: string; stroke?: string; op: number }> = [{ op: 1 }];
  for (const [, fin, balise, attributs, seule] of svg.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    if (fin) { groupes.pop(); continue; }
    const at = (n: string) => new RegExp(`(?:^|\\s)${n}="([^"]*)"`).exec(attributs)?.[1];
    const g = groupes.at(-1)!, e = { fill: at('fill') ?? g.fill, stroke: at('stroke') ?? g.stroke, op: g.op * Number(at('opacity') ?? 1) };
    if (balise !== 'g' && balise !== 'svg') {
      const f = plein(e.fill), s = plein(e.stroke);
      if (f) out.push({ c: f, a: e.op * Number(at('fill-opacity') ?? 1) });
      if (s) out.push({ c: s, a: e.op * Number(at('stroke-opacity') ?? 1) });
    }
    if (!seule) groupes.push(e);
  }
  return out;
}
function pireDesTextes(t: string, id: string): number {
  const page = /:root\[data-odin-theme\] body\{([^}]*)\}/.exec(t)?.[1] ?? '';
  const ciel = (/linear-gradient\(180deg,(#[0-9a-f]{6}),(#[0-9a-f]{6})\)/i.exec(page) ?? []).slice(1).map(hexRGB);
  assert.equal(ciel.length, 2, `thème ${id} : le dégradé`);
  const svg = /url\("data:image\/svg\+xml;utf8,([^"]*)"\)/.exec(page)?.[1];
  const formes = svg ? couleursDuDessin(decodeURIComponent(svg)) : [];
  const cle = (x: { c: number[]; a: number }) => `${x.c.join()}/${x.a}`;
  const fois = new Map<string, number>(); for (const x of formes) fois.set(cle(x), (fois.get(cle(x)) ?? 0) + 1);
  const couleurs = [...new Map(formes.map((x) => [cle(x), x])).values()], translucides = couleurs.filter((x) => x.a < 0.99);
  const voile = /body::before\{[^}]*background:rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(t)!;
  const r = racine(t), sat = Number(variable(r, '--v-sat')), dessous: number[][] = [...ciel];
  const empiler = (x: number[], deja: typeof translucides, n: number) => {
    for (const f of translucides) {
      if (deja.filter((g) => g === f).length >= (fois.get(cle(f)) ?? 1)) continue;
      const y = sur(x, f.c, f.a); dessous.push(y);
      if (n > 1) empiler(y, [...deja, f], n - 1);
    }
  };
  for (const u of [...ciel, ...couleurs.filter((x) => x.a >= 0.99).map((x) => x.c)]) { for (const x of couleurs) dessous.push(sur(u, x.c, x.a)); empiler(u, [], 3); }
  const vus = dessous.map((d) => saturer(sur(d, [+voile[1], +voile[2], +voile[3]], +voile[4]), sat));
  const bouts = [...variable(r, '--v-carte').matchAll(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g)].map((m) => ({ c: [+m[1], +m[2], +m[3]], a: +m[4] }));
  assert.equal(bouts.length, 2, `thème ${id} : la carte`);
  const reflet = Number(variable(r, '--v-reflet')), fonds: number[][] = [];
  for (const f of vus) bouts.forEach((b, i) => { const x = sur(f, b.c, b.a); fonds.push(x); if (i === 0) fonds.push(sur(x, [255, 255, 255], reflet)); });
  let pire = 21;
  for (const nom of ['--ink', '--muted', '--dim', '--accent-texte', '--good', '--warn', '--bad']) {
    const c = variable(regleCartes(t), nom) || variable(r, nom);
    if (/^#[0-9a-f]{6}$/i.test(c)) for (const f of fonds) pire = Math.min(pire, ratio(hexRGB(c), f));
  }
  return pire;
}

test('verre sur la page : sans valeur gardée pour un thème, sa carte est celle d\'aujourd\'hui ; la valeur d\'un autre thème n\'y change rien', () => {
  const sans = charger(), avec = charger({ mode: 'fixe', theme: 'glace', verre: { nuit: 100, foret: 0 } });
  for (const id of Object.keys(sans.O.THEMES)) {
    if (id === 'nuit' || id === 'foret') continue;
    sans.O.apply(id); avec.O.apply(id);
    assert.equal(css(avec), css(sans), `thème ${id}`);
    const c = avec.O.verre(id);
    if (id === 'valhalla') { assert.equal(c, undefined, 'Valhalla n\'a pas de verre : pas de curseur'); continue; }
    assert.equal(c!.choisie, false, `thème ${id} : rien de choisi`);
  }
  // Le curseur d'un thème sans valeur gardée montre sa transparence de départ (Glace : 88, comme la maquette).
  assert.equal(sans.O.verre('glace')!.valeur, 88);
});

test('verre sur la page : la valeur choisie change la carte de ce thème, tout de suite, selon la règle de la maquette', () => {
  const c = charger();
  c.O.apply('glace');
  const lim = c.O.verre('glace')!.limite;
  assert.ok(lim >= 88, `Glace se lit dès sa transparence de départ (limite ${lim})`);
  c.O.reglerVerre(50, false);
  assert.equal(variable(css(c), '--v-carte'), c.surfaceOf(c.catalogue.glace, 50).surface, 'Glace à 50 : la carte de la maquette à 50');
  assert.equal(c.O.verre('glace')!.valeur, 50);
  c.O.reglerVerre(-30, false);
  assert.equal(c.O.verre('glace')!.valeur, 0, 'ramené dans les bornes');
  assert.equal(variable(css(c), '--v-carte'), c.surfaceOf(c.catalogue.glace, 0).surface);
  // Un autre thème ne bouge pas.
  const avant = (() => { const d = charger(); d.O.apply('nuit'); return css(d); })();
  c.O.apply('nuit');
  assert.equal(css(c), avant, 'Nuit garde sa carte');
});

test('verre sur la page : jamais illisible — au-delà de la limite de chaque thème, la carte ne devient pas plus transparente, et tout texte reste à 4,5:1', () => {
  const c = charger();
  const echecs: string[] = [];
  let limites = 0;
  for (const id of Object.keys(c.O.THEMES).filter((x) => x !== 'valhalla')) {
    c.O.apply(id);
    const k = c.O.verre(id)!;
    c.O.reglerVerre(100, false);
    const a100 = css(c);
    const p = pireDesTextes(a100, id);
    if (p < 4.5) echecs.push(`${id} à 100 : ${p.toFixed(2)}:1`);
    // La limite : au moins la transparence de départ du thème (celle d'aujourd'hui).
    const gt = c.catalogue[id]?.sc ? Number(c.catalogue[id].gt) : c.O.THEMES[id].sky && k.choisie === false ? k.valeur : NaN;
    if (!(k.limite >= gt)) echecs.push(`${id} : limite ${k.limite} sous le départ ${gt}`);
    if (k.limite < 100) limites++;
    // Au-delà de la limite, la carte ne change plus : à 100, c'est exactement celle de la limite (et entre les deux).
    for (const g of [k.limite, Math.min(100, k.limite + 1), Math.round((k.limite + 100) / 2)]) {
      c.O.reglerVerre(g, false);
      if (css(c) !== a100) echecs.push(`${id} : à ${g}, la carte doit être celle de 100 (la limite est ${k.limite})`);
    }
    // Une limite au-dessus du départ : la carte de la maquette y est lisible telle quelle, sans couche de plus.
    const v = c.catalogue[id]?.sc ? c.catalogue[id] : null;
    if (v && k.limite > gt && variable(racine(a100), '--v-carte') !== c.surfaceOf(v, k.limite).surface) echecs.push(`${id} : la carte de la maquette à ${k.limite}`);
    // Vers l'opaque aussi, jamais illisible (un verre clair sous un texte clair prend sa couleur pleine).
    for (let g = 0; g <= 100; g += 10) {
      c.O.reglerVerre(g, false);
      const p0 = pireDesTextes(css(c), id);
      if (p0 < 4.5) echecs.push(`${id} à ${g} : ${p0.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(echecs, []);
  assert.ok(limites >= 10, `des thèmes ont une limite sous 100 (${limites})`);
});

// ------------------------------------------------------------------ côté page : le curseur de Réglages → Apparence

type Noeud = El | Texte;
class Texte { parent: El | null = null; textContent: string; constructor(t: string) { this.textContent = t; } }
class El {
  parent: El | null = null; enfants: Noeud[] = []; attrs: Record<string, string> = {}; style: Record<string, string> = {}; value = '';
  ecoutes: Record<string, Array<(e: unknown) => void>> = {};
  dataset: Record<string, string>; tagName: string;
  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
    const soi = this;
    this.dataset = new Proxy({}, { get: (_c, k) => soi.attrs[`data-${String(k)}`], set: (_c, k, v) => { soi.attrs[`data-${String(k)}`] = String(v); return true; } });
  }
  get id() { return this.attrs.id ?? ''; } set id(v: string) { this.attrs.id = v; }
  get className() { return this.attrs.class ?? ''; } set className(v: string) { this.attrs.class = v; }
  get type() { return this.attrs.type ?? ''; } set type(v: string) { this.attrs.type = v; }
  get title() { return this.attrs.title ?? ''; } set title(v: string) { this.attrs.title = v; }
  get hidden() { return 'hidden' in this.attrs; } set hidden(v: boolean) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  get checked() { return this.attrs.checked !== undefined; } set checked(v: boolean) { if (v) this.attrs.checked = ''; else delete this.attrs.checked; }
  get classList() {
    const lst = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => lst().includes(c),
      add: (...cs: string[]) => { this.className = [...new Set([...lst(), ...cs])].join(' '); },
      remove: (...cs: string[]) => { this.className = lst().filter((x) => !cs.includes(x)).join(' '); },
      toggle: (c: string, force?: boolean) => { const oui = force ?? !lst().includes(c); if (oui) this.classList.add(c); else this.classList.remove(c); return oui; },
    };
  }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k: string) { return k in this.attrs; }
  get textContent(): string { return this.enfants.map((e) => e.textContent).join(''); }
  set textContent(v: string) { this.enfants = []; if (v !== '') this.append(String(v)); }
  set innerHTML(html: string) { this.enfants = []; analyser(html, this); }
  get innerHTML() { return ''; }
  append(...xs: Array<Noeud | string>) { for (const x of xs) { const n = typeof x === 'string' ? new Texte(x) : x; n.parent = this; this.enfants.push(n); } }
  after(x: El) { const p = this.parent!; x.parent = p; p.enfants.splice(p.enfants.indexOf(this) + 1, 0, x); }
  addEventListener(t: string, f: (e: unknown) => void) { (this.ecoutes[t] ||= []).push(f); }
  emettre(t: string) { for (const f of this.ecoutes[t] ?? []) f({ type: t, target: this }); }
  *tous(): Generator<El> { for (const e of this.enfants) if (e instanceof El) { yield e; yield* e.tous(); } }
  querySelectorAll(sel: string) { const ms = sel.split(',').map((s) => s.trim()); return [...this.tous()].filter((e) => ms.some((m) => correspond(e, m))); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
}
function correspond(e: El, sel: string): boolean {
  const m = /^([a-z0-9]*)((?:[#.][\w-]+|\[[^\]]+\])*)$/i.exec(sel); if (!m) throw new Error(`sélecteur non pris : ${sel}`);
  if (m[1] && e.tagName !== m[1].toLowerCase()) return false;
  for (const p of m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) ?? []) {
    if (p[0] === '#' && e.id !== p.slice(1)) return false;
    if (p[0] === '.' && !e.classList.contains(p.slice(1))) return false;
    if (p[0] === '[') { const a = /^\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]$/.exec(p)!; const v = e.getAttribute(a[1]); if (v === null) return false; const voulu = a[2] ?? a[3]; if (voulu !== undefined && v !== voulu) return false; }
  }
  return true;
}
function analyser(html: string, dans: El) {
  let ici = dans;
  for (const m of html.matchAll(/<\/([\w-]+)\s*>|<([\w-]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g)) {
    if (m[1]) { ici = ici.parent ?? dans; continue; }
    if (m[5] !== undefined) { ici.append(m[5]); continue; }
    const e = new El(m[2]);
    for (const a of (m[3] ?? '').matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) e.attrs[a[1]] = a[2] ?? '';
    ici.append(e);
    if (!m[4] && !/^(br|img|input|meta|link)$/i.test(m[2])) ici = e;
  }
}

interface Serveur { mode: string; theme: string; verre: Record<string, number>; event?: { id: string; name: string }; panne?: boolean; appels: Array<{ action: string; input: Record<string, unknown> }> }
/** La carte Apparence de Réglages, avec un Odin factice qui garde le verre comme le vrai (une valeur par thème). */
function page(serveur: Omit<Serveur, 'appels'>, o: { sansFlou?: boolean } = {}) {
  const corps = new El('body');
  corps.innerHTML = '<article class="card" data-sec="apparence"><h2>Apparence</h2><p class="sub">-</p></article>';
  const styles: El[] = [];
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append: (s: El) => styles.push(s) }, hidden: false, createElement: (t: string) => new El(t),
    querySelector: (s: string) => corps.querySelector(s), querySelectorAll: (s: string) => corps.querySelectorAll(s), getElementById: (id: string) => corps.querySelector(`#${id}`), addEventListener() {},
  };
  const s: Serveur = { ...serveur, appels: [] };
  const fetch = async (_url: string, x: { body: string }) => {
    const { action, input } = JSON.parse(x.body) as { action: string; input: Record<string, unknown> };
    if (s.panne) throw new TypeError('Failed to fetch');
    s.appels.push({ action, input });
    if (action === 'regler_mascotte') { const j = JSON.parse(String(input.reglages)) as { verre?: Record<string, number> }; if (j.verre) s.verre = { ...s.verre, ...j.verre }; }
    return { ok: true, json: async () => ({ data: { mode: s.mode, theme: s.theme, verre: s.verre, event: s.event, evenements: { themes: true } } }) };
  };
  const window: Record<string, unknown> = { addEventListener() {}, ...(o.sansFlou ? { CSS: { supports: () => false } } : {}) };
  window.window = window;
  const ctx = vm.createContext({ window, document, fetch, localStorage: { getItem: () => null, setItem() {} }, CustomEvent: class { type: string; constructor(type: string) { this.type = type; } }, setTimeout, clearTimeout, setInterval: () => 0 });
  vm.runInContext(CATALOGUE_JS, ctx);
  vm.runInContext(THEMES_JS, ctx);
  const carte = corps.querySelector('article.card')!;
  const O = window.OdinThemes as Charge['O'];
  return { carte, serveur: s, O, styles, curseur: () => carte.querySelector('#themeVerre')!, texte: (id: string) => carte.querySelector(`#${id}`)! };
}
const attendre = () => new Promise((r) => setTimeout(r, 30));
const appelsVerre = (s: Serveur) => s.appels.filter((a) => a.action === 'regler_mascotte').map((a) => JSON.parse(String(a.input.reglages)));

test('curseur : un vrai champ (curseur de 0 à 100, pas de 1, nommé « Transparence du verre »), qui se règle aux flèches ; le verre se voit tout de suite, la valeur part au lâcher', async () => {
  const p = page({ mode: 'fixe', theme: 'glace', verre: {} });
  await attendre();
  const c = p.curseur();
  assert.equal(c.tagName, 'input'); assert.equal(c.getAttribute('type'), 'range', 'un curseur du navigateur : flèches, Début, Fin, Page haut et bas');
  assert.deepEqual([c.getAttribute('min'), c.getAttribute('max'), c.getAttribute('step')], ['0', '100', '1']);
  assert.equal(c.ecoutes.keydown, undefined, 'aucune touche détournée');
  const label = p.carte.querySelector('label[for="themeVerre"]')!;
  assert.ok(label && label.textContent.includes('Transparence du verre'), 'nommé par son étiquette');
  assert.equal(p.texte('themeVerreBox').hidden, false);
  assert.equal(c.value, '88', 'Glace : sa transparence de départ');
  assert.equal(p.texte('themeVerreVal').textContent, '88 %');
  assert.match(p.texte('themeVerreAide').textContent, /Glace/, 'le thème réglé est dit');
  // Une flèche vers la gauche : le navigateur change la valeur, puis « input » et « change ».
  c.value = '87'; c.emettre('input');
  assert.equal(p.O.verre('glace')!.valeur, 87, 'le verre se voit tout de suite');
  assert.equal(appelsVerre(p.serveur).length, 0, 'rien ne part pendant qu\'on fait glisser');
  c.emettre('change'); await attendre();
  assert.deepEqual(appelsVerre(p.serveur), [{ verre: { glace: 87 } }], 'la valeur part vers Odin, pour ce thème seulement');
  assert.equal(p.texte('themeVerreVal').textContent, '87 %');
  // Odin injoignable : la page remet la valeur qu'Odin a vraiment.
  p.serveur.panne = true;
  c.value = '20'; c.emettre('input'); c.emettre('change'); await attendre();
  assert.equal(c.value, '87'); assert.equal(p.O.verre('glace')!.valeur, 87);
});

test('curseur : au-delà de la limite du thème, le réglage le dit en une phrase ; sans flou possible, il dit que les cartes gardent leur couleur pleine', async () => {
  const c0 = charger();
  const borne = Object.keys(c0.O.THEMES).find((id) => { const k = c0.O.verre(id); return k && k.limite < 90; })!;
  assert.ok(borne, 'un thème dont la limite est sous 90');
  const lim = c0.O.verre(borne)!.limite;
  const p = page({ mode: 'fixe', theme: borne, verre: { [borne]: lim } });
  await attendre();
  assert.equal(p.texte('themeVerreLimite').hidden, true, 'à la limite : rien à dire');
  p.curseur().value = '100'; p.curseur().emettre('input');
  assert.equal(p.texte('themeVerreLimite').hidden, false);
  assert.equal(p.texte('themeVerreLimite').textContent, `Au-delà de ${lim} %, les cartes de ce thème ne deviennent pas plus transparentes : leurs textes ne se liraient plus.`);
  assert.equal(p.texte('themeVerreVal').textContent, '100 %', 'le curseur montre ce qui est choisi (il ne semble pas cassé)');
  const sf = page({ mode: 'fixe', theme: 'glace', verre: {} }, { sansFlou: true });
  await attendre();
  assert.equal(sf.texte('themeVerreLimite').textContent, 'Ce navigateur ne sait pas flouter : les cartes y gardent leur couleur pleine.');
  // Valhalla n'a pas de verre : pas de curseur.
  const v = page({ mode: 'fixe', theme: 'valhalla', verre: {} });
  await attendre();
  assert.equal(v.texte('themeVerreBox').hidden, true);
});

test('curseur : le thème automatique et le thème d\'un événement ont chacun leur valeur', async () => {
  const p = page({ mode: 'auto', theme: 'ciel', verre: { ciel: 12 } });
  await attendre();
  assert.equal(p.curseur().value, '12', 'le thème automatique du moment');
  p.curseur().value = '15'; p.curseur().emettre('input'); p.curseur().emettre('change'); await attendre();
  assert.deepEqual(appelsVerre(p.serveur).at(-1), { verre: { ciel: 15 } });
  // Le jour d'un événement, son thème est affiché : le curseur règle le sien, sans toucher au thème automatique.
  p.serveur.event = { id: 'noel', name: 'Noël' };
  await p.O.sync();
  const d = p.O.verre('ev-noel')!;
  assert.equal(d.choisie, false);
  assert.equal(p.curseur().value, String(d.valeur));
  p.curseur().value = '5'; p.curseur().emettre('input'); p.curseur().emettre('change'); await attendre();
  assert.deepEqual(appelsVerre(p.serveur).at(-1), { verre: { 'ev-noel': 5 } });
  assert.deepEqual(p.serveur.verre, { ciel: 15, 'ev-noel': 5 });
});

// ------------------------------------------------------------------ dans un vrai navigateur (390 et 1280 px)

interface PageNav { route(u: string, f: (r: { request(): { url(): string; postData(): string | null }; fulfill(o: Record<string, unknown>): Promise<void> }) => unknown): Promise<void>; goto(u: string): Promise<unknown>; focus(s: string): Promise<void>; keyboard: { press(k: string): Promise<void> }; evaluate<T>(f: string): Promise<T>; waitForTimeout(ms: number): Promise<void>; close(): Promise<void> }
interface Navigateur { newPage(o?: Record<string, unknown>): Promise<PageNav>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });

test('curseur dans un vrai navigateur : 44 px au doigt, les flèches le règlent, le verre de l\'accueil change tout de suite', { skip: sansNav }, async () => {
  for (const largeur of [390, 1280]) {
    const p = await nav!.newPage({ viewport: { width: largeur, height: 800 }, deviceScaleFactor: 1 });
    try {
      const recus: unknown[] = []; let garde: Record<string, number> = {};
      await p.route('http://odin.test/**', async (r) => {
        const u = r.request().url();
        if (u.endsWith('/api/valhalla/act')) {
          const b = JSON.parse(r.request().postData() ?? '{}') as { action: string; input: { reglages?: string } };
          if (b.action === 'regler_mascotte') { const j = JSON.parse(b.input.reglages ?? '{}') as { verre: Record<string, number> }; recus.push(j); garde = { ...garde, ...j.verre }; }
          return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { mode: 'fixe', theme: 'glace', verre: garde } }) });
        }
        if (u.endsWith('/catalogue.js')) return r.fulfill({ contentType: 'text/javascript', body: CATALOGUE_JS });
        if (u.endsWith('/themes.js')) return r.fulfill({ contentType: 'text/javascript', body: THEMES_JS });
        return r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><main><section id="v-home" class="on"><div class="card">Accueil</div></section><article class="card" data-sec="apparence"><h2>Apparence</h2><p class="sub">-</p></article></main><script src="/catalogue.js"></script><script src="/themes.js"></script>' });
      });
      await p.goto('http://odin.test/');
      await p.waitForTimeout(100);
      const mesure = await p.evaluate<{ h: number; w: number; v: string }>('(() => { const r = document.getElementById("themeVerre").getBoundingClientRect(); return { h: r.height, w: r.width, v: document.getElementById("themeVerre").value }; })()');
      assert.ok(mesure.h >= 44, `${largeur} px : ${mesure.h} px de haut`);
      assert.ok(mesure.w >= 100, `${largeur} px : ${mesure.w} px de large`);
      // Le contour du focus (sa largeur plus son décalage, autour du curseur) ne passe pas sur la ligne d'aide juste en dessous.
      await p.focus('#themeVerre');
      const contour = await p.evaluate<{ bas: number; aide: number }>('(() => { const c = document.getElementById("themeVerre"), st = getComputedStyle(c), r = c.getBoundingClientRect(); return { bas: r.bottom + parseFloat(st.outlineOffset) + parseFloat(st.outlineWidth), aide: document.getElementById("themeVerreAide").getBoundingClientRect().top }; })()');
      assert.ok(contour.bas <= contour.aide, `${largeur} px : le contour du focus descend à ${contour.bas} px, l'aide commence à ${contour.aide} px`);
      await p.evaluate('document.activeElement.blur()');
      assert.equal(mesure.v, '88');
      const carte = () => p.evaluate<string>('getComputedStyle(document.querySelector("#v-home .card")).backgroundImage');
      const avant = await carte();
      await p.focus('#themeVerre');
      await p.keyboard.press('ArrowLeft');
      await p.keyboard.press('ArrowLeft');
      await p.waitForTimeout(100);
      assert.equal(await p.evaluate<string>('document.getElementById("themeVerre").value'), '86', 'deux flèches : 88 → 86');
      assert.notEqual(await carte(), avant, 'la carte de l\'accueil a changé tout de suite');
      assert.deepEqual(recus.at(-1), { verre: { glace: 86 } });
      assert.equal(await p.evaluate<string>('document.getElementById("themeVerreVal").textContent'), '86 %');
      const debord = await p.evaluate<number>('document.documentElement.scrollWidth - innerWidth');
      assert.ok(debord <= 0, `${largeur} px : rien ne déborde (${debord})`);
    } finally { await p.close(); }
  }
});
