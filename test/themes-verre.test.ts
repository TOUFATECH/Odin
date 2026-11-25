// Le verre sur l'accueil (maquette validée « Accueil et écran de la maison ») : sur la page d'accueil seulement, les
// cartes deviennent du verre posé sur le fond du thème ; partout ailleurs, la zone de travail garde son fond uni.
// Choix du propriétaire du 23/11 (réponse à une question à choix) : le verre sur l'accueil et l'écran de la maison
// seulement, fond uni ailleurs. Sa décision du 25/11 (question à choix) : « Décor derrière, verre plus opaque » — le
// décor du thème derrière l'accueil, comme la maquette, et des cartes assez opaques pour que chaque texte reste lisible,
// sur les 85 thèmes : la lisibilité se calcule sur le pire point du décor qui peut passer derrière une carte.
// Les nombres viennent de la règle de la maquette (surfaceOf), recopiée dans src/web/pages/themes-catalogue.js :
// transparence 0 (plein) → 100 (vitre) ; la carte va d'une opacité a = 0,92 − 0,9 × k à a × 0,45 (k = transparence
// / 100), son flou est max(5, flou de départ × (1 − 0,72 k)). Un thème d'Odin part de 22 s'il est sombre, de 40
// s'il est clair (règle de la maquette pour les thèmes d'Odin).
// themes.js est chargé tel quel dans un bac à sable, avec une page factice (comme test/rapidite-theme-fond.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');
const THEMES_JS = lire('../src/web/themes.js');
const CATALOGUE_JS = lire('../src/web/pages/themes-catalogue.js');

interface Surface { surface: string; blur: number; solid: string; sheen?: number; border?: string }
interface Charge {
  styles: Array<{ id?: string; textContent: string }>;
  apply(id: string): void;
  ids: string[];
  sansCiel: string[];
  panneau(id: string): string;
  sombre(id: string): boolean;
  surfaceOf?: (t: Record<string, unknown>, g: number) => Surface;
  catalogue?: Record<string, Record<string, unknown>>;
}

function charger(avecCatalogue = true): Charge {
  const styles: Array<{ id?: string; textContent: string }> = [];
  const element = () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append: (s: { id?: string; textContent: string }) => styles.push(s) }, createElement: () => element(),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null,
  };
  const window: Record<string, unknown> = { OdinThemes: {}, addEventListener() {} };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), console, navigator: {} });
  (window as { window?: unknown }).window = window;
  if (avecCatalogue) vm.runInContext(CATALOGUE_JS, ctx);
  vm.runInContext(THEMES_JS, ctx);
  const o = window.OdinThemes as { apply(id: string): void; THEMES: Record<string, { sky?: string[]; panel?: string; dark?: boolean; decor?: string }> };
  const cat = window.OdinCatalogueThemes as { surfaceOf?: Charge['surfaceOf']; THEMES: Record<string, Record<string, unknown>> } | undefined;
  const ids = Object.keys(o.THEMES);
  return {
    styles, apply: o.apply, ids, sansCiel: ids.filter((id) => !o.THEMES[id].sky), panneau: (id) => String(o.THEMES[id].panel),
    sombre: (id) => o.THEMES[id].dark === true,
    surfaceOf: cat?.surfaceOf, catalogue: cat?.THEMES,
  };
}

// Le thème d'Odin clair de l'essai a pour identifiant un nom de lieu qui est aussi une donnée d'exemple de la maquette :
// le garde-fou (donnees-exemple.test.ts) ne le laisse pas écrit en clair dans les fichiers de ce chantier. Il est noté
// par son empreinte SHA-256 et retrouvé parmi les thèmes chargés : exactement un identifiant doit l'avoir.
function idParEmpreinte(c: Charge, e: string): string {
  const ids = c.ids.filter((id) => createHash('sha256').update(id, 'utf8').digest('hex') === e);
  assert.equal(ids.length, 1, `le thème d'empreinte ${e.slice(0, 12)}… est chargé, une seule fois`);
  return ids[0];
}
const EMPREINTE_ODIN_CLAIR = '6f7079e2578772196e68c87779b2c70de25f64fdfbd423f8882fc0f39b2aa297';

const css = (c: Charge) => c.styles.find((s) => s.id === 'odinThemeStyle')?.textContent ?? c.styles.at(-1)?.textContent ?? '';
/** La valeur d'une variable posée sur :root par le thème. */
const variable = (texte: string, nom: string) => new RegExp(`${nom}:([^;}]*)`).exec(texte)?.[1]?.trim() ?? '';
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };
const alphas = (v: string) => [...v.matchAll(/rgba\(\d+,\d+,\d+,([\d.]+)\)/g)].map((m) => +m[1]);
/** Les variables posées sur :root, et la règle des cartes de l'accueil (qui porte les tons éloignés pour le verre). */
const racine = (t: string) => /:root\[data-odin-theme\]\{([^}]*)\}/.exec(t)?.[1] ?? '';
const regleCartes = (t: string) => /:not\(\.dragging\)\{([^}]*)\}/.exec(t)?.[1] ?? '';

// ---- Le pire point derrière une carte, recalculé ici, sans le code de themes.js ----
const hexRGB = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const sur = (dessous: number[], c: number[], a: number) => dessous.map((v, i) => v * (1 - a) + c[i] * a);
const lumi = (c: number[]) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (x: number[], y: number[]) => { const a = lumi(x), b = lumi(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
// saturate(s) des filtres CSS (matrice de la norme), sur chaque canal, borné à 0-255.
const saturer = ([r, g, b]: number[], s: number) => [
  (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
  (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
  (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
].map((v) => Math.max(0, Math.min(255, v)));
const TEXTES_CARTE = ['--ink', '--muted', '--dim', '--accent-texte', '--good', '--warn', '--bad'];

/** Les couleurs (avec leur opacité) que le dessin d'un décor peut peindre : remplissage et trait de chaque forme, sous
 *  l'opacité de ses groupes. Un tracé sans remplissage dit, dans ces décors, est un trait sans surface. */
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

/** Ce qui peut se trouver derrière une carte de l'accueil, lu dans les règles posées : le dégradé du fond de la page à
 *  ses deux bouts ; le dessin du décor par-dessus (chaque couleur sur le dégradé ou sur une couleur pleine du dessin, et
 *  jusqu'à trois formes translucides l'une sur l'autre, dans tous les ordres : deux bandes d'aurore qui se croisent ;
 *  une même forme deux fois si le dessin en a deux) ; le voile de la barre de côté ; la saturation du verre. */
function derriereLaCarte(t: string, id: string): { vus: number[][]; dessin: boolean } {
  const page = /:root\[data-odin-theme\] body\{([^}]*)\}/.exec(t)?.[1] ?? '';
  const ciel = (/linear-gradient\(180deg,(#[0-9a-f]{6}),(#[0-9a-f]{6})\)/i.exec(page) ?? []).slice(1).map(hexRGB);
  assert.equal(ciel.length, 2, `thème ${id} : le dégradé du fond de la page`);
  const svg = /url\("data:image\/svg\+xml;utf8,([^"]*)"\)/.exec(page)?.[1];
  const formes = svg ? couleursDuDessin(decodeURIComponent(svg)) : [];
  const cle = (x: { c: number[]; a: number }) => `${x.c.join()}/${x.a}`;
  const fois = new Map<string, number>(); for (const x of formes) fois.set(cle(x), (fois.get(cle(x)) ?? 0) + 1);
  const couleurs = [...new Map(formes.map((x) => [cle(x), x])).values()], translucides = couleurs.filter((x) => x.a < 0.99);
  const voile = /body::before\{[^}]*background:rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(t);
  assert.ok(voile, `thème ${id} : le voile`);
  const sat = Number(variable(racine(t), '--v-sat'));
  const dessous: number[][] = [...ciel];
  const empiler = (x: number[], deja: typeof translucides, n: number) => {
    for (const f of translucides) {
      if (deja.filter((g) => g === f).length >= (fois.get(cle(f)) ?? 1)) continue;
      const y = sur(x, f.c, f.a); dessous.push(y);
      if (n > 1) empiler(y, [...deja, f], n - 1);
    }
  };
  for (const u of [...ciel, ...couleurs.filter((x) => x.a >= 0.99).map((x) => x.c)]) {
    for (const x of couleurs) dessous.push(sur(u, x.c, x.a));
    empiler(u, [], 3);
  }
  return { vus: dessous.map((d) => saturer(sur(d, [+voile![1], +voile![2], +voile![3]], +voile![4]), sat)), dessin: couleurs.length > 0 };
}

/** Le pire contraste de chaque texte d'une carte (ses tons tels que posés) sur tout ce qui peut passer derrière elle, vu
 *  à travers la carte à ses deux bouts et sous le reflet en haut. `carte` : une autre carte à essayer (par défaut, celle
 *  que pose le thème). */
function pireDesTextes(t: string, id: string, carte = variable(racine(t), '--v-carte')): Array<{ nom: string; couleur: string; pire: number }> {
  const { vus } = derriereLaCarte(t, id), r = racine(t), cartes = regleCartes(t);
  const bouts = [...carte.matchAll(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g)].map((m) => ({ c: [+m[1], +m[2], +m[3]], a: +m[4] }));
  assert.equal(bouts.length, 2, `thème ${id} : ${carte}`);
  const reflet = Number(variable(r, '--v-reflet')), fonds: number[][] = [];
  for (const f of vus) bouts.forEach((b, i) => { const x = sur(f, b.c, b.a); fonds.push(x); if (i === 0) fonds.push(sur(x, [255, 255, 255], reflet)); });
  const out: Array<{ nom: string; couleur: string; pire: number }> = [];
  for (const nom of TEXTES_CARTE) {
    const couleur = variable(cartes, nom) || variable(r, nom);
    if (!/^#[0-9a-f]{6}$/i.test(couleur)) continue;
    out.push({ nom, couleur, pire: Math.min(...fonds.map((f) => ratio(hexRGB(couleur), f))) });
  }
  return out;
}
/** Le verre posé sur une couche de sa couleur pleine d'opacité p : ce que l'on voit à travers les deux, bout par bout. */
const surCouche = (surface: string, plein: number[], p: number) => surface.replace(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/g, (m, r, v, b, a) => {
  const x = +a, tot = x + (1 - x) * p;
  return `rgba(${[+r, +v, +b].map((c, i) => Math.round((x * c + (1 - x) * p * plein[i]) / (tot || 1))).join(',')},${+tot.toFixed(3)})`;
});

test('verre : la règle de la maquette (surfaceOf) est là, telle quelle, et rend les nombres de la maquette', () => {
  const c = charger();
  assert.equal(typeof c.surfaceOf, 'function', 'le catalogue publie surfaceOf');
  const glace = c.catalogue!.glace;
  assert.equal(glace.gt, 88, 'Glace part de 88');
  const a88 = c.surfaceOf!(glace, 88);
  assert.equal(a88.surface, 'linear-gradient(140deg,rgba(255,255,255,0.128),rgba(255,255,255,0.058))', 'Glace à 88 : de 12,8 % à 5,8 %');
  assert.equal(a88.blur, 7, 'Glace à 88 : flou 7 px');
  assert.equal(a88.solid, '#f3f9ff', 'la couleur pleine reste celle du thème');
  const a0 = c.surfaceOf!(glace, 0);
  assert.equal(a0.surface, 'linear-gradient(140deg,rgba(255,255,255,0.92),rgba(255,255,255,0.414))', 'Glace à 0 : de 92 % à 41,4 %');
  assert.equal(a0.blur, 20);
  const a100 = c.surfaceOf!(glace, 100);
  assert.equal(a100.surface, 'linear-gradient(140deg,rgba(255,255,255,0.02),rgba(255,255,255,0.009))', 'Glace à 100 : de 2 % à 0,9 %');
  assert.equal(a100.blur, 6);
  assert.equal(c.catalogue!.ha.gt, 0, '« Home Assistant » part de 0');
});

test('verre : chaque thème part de sa transparence de départ (flou et reflet) ; la carte n\'en devient que plus opaque', () => {
  const c = charger();
  const auMoins = (id: string, carte: string, depart: number[]) => {
    const a = alphas(carte);
    assert.equal(a.length, 2, `thème ${id} : ${carte}`);
    a.forEach((x, i) => assert.ok(x >= depart[i] - 1e-9, `thème ${id} : bout ${i + 1} à ${x}, départ ${depart[i]}`));
  };
  // Glace (catalogue) : 88 → de 12,8 % à 5,8 %, flou 7 px ; chaque texte s'y lit déjà au pire point de son décor : elle
  // garde exactement son départ.
  c.apply('glace');
  let t = css(c);
  assert.equal(variable(t, '--v-carte'), 'linear-gradient(140deg,rgba(255,255,255,0.128),rgba(255,255,255,0.058))', 'Glace : exactement 12,8 % → 5,8 %');
  assert.equal(variable(t, '--v-flou'), '7px');
  assert.equal(variable(t, '--v-plein'), '#f3f9ff');
  // Home Assistant (catalogue, sans dessin de décor) : 0, sur sa couleur de carte #1c1c1c ; flou de départ 12 ; lisible
  // tel quel, il garde exactement son départ.
  c.apply('ha');
  t = css(c);
  assert.equal(variable(t, '--v-carte'), 'linear-gradient(140deg,rgba(28,28,28,0.92),rgba(28,28,28,0.414))');
  assert.equal(variable(t, '--v-flou'), '12px');
  // Un thème d'Odin sombre : 22, sur son panneau ; flou max(5, 20 × (1 − 0,72 × 0,22)) = 17 ; reflet 0,1 × (1 − 0,65 × 0,22).
  c.apply('nuit');
  t = css(c);
  const p = rgb(c.panneau('nuit'));
  auMoins('nuit', variable(t, '--v-carte'), [0.722, 0.325]);
  assert.match(variable(t, '--v-carte'), new RegExp(`^linear-gradient\\(140deg,rgba\\(${p},[\\d.]+\\),rgba\\(${p},[\\d.]+\\)\\)$`), 'thème d\'Odin sombre : la teinte de son panneau');
  assert.equal(variable(t, '--v-flou'), '17px');
  assert.equal(variable(t, '--v-reflet'), String(+(0.1 * (1 - 0.65 * 0.22)).toFixed(3)));
  assert.equal(variable(t, '--v-plein'), c.panneau('nuit'), 'sombre : la couleur pleine est son panneau');
  // Un thème d'Odin clair : 40, sur du blanc ; flou max(5, 20 × (1 − 0,72 × 0,4)) = 14.
  const clair = idParEmpreinte(c, EMPREINTE_ODIN_CLAIR);
  c.apply(clair);
  t = css(c);
  auMoins(clair, variable(t, '--v-carte'), [0.56, 0.252]);
  assert.equal(variable(t, '--v-flou'), '14px');
  assert.match(variable(t, '--v-carte'), /^linear-gradient\(140deg,rgba\(2[45]\d,2[45]\d,2[45]\d,[\d.]+\),rgba\(2[45]\d,2[45]\d,2[45]\d,[\d.]+\)\)$/, 'thème d\'Odin clair : un verre blanc');
});

test('verre : une carte garde exactement son départ si chaque texte s\'y lit déjà au pire point du décor ; sinon elle ne devient que juste assez opaque', () => {
  // Le départ est recalculé ici avec la règle de la maquette (surfaceOf) : un thème du catalogue garde ses champs de
  // verre ; un thème d'Odin part de 22 sur son panneau s'il est sombre, de 40 sur du blanc s'il est clair. « Lisible »
  // avec un peu de marge : 4,75:1 au pire point (le décor compris). Une carte plus opaque l'est par une couche de sa
  // couleur pleine sous le verre, de 5 % en 5 % : avec 5 % de moins, un texte ne s'y lirait plus aussi bien.
  const c = charger();
  const echecs: string[] = [];
  let gardes = 0, plusOpaques = 0;
  for (const id of c.ids.filter((x) => x !== 'valhalla')) {
    c.apply(id);
    const t = css(c), r = racine(t), carte = variable(r, '--v-carte'), plein = variable(r, '--v-plein');
    const cat = c.catalogue![id];
    const depart = cat?.sc ? c.surfaceOf!(cat, Number(cat.gt)).surface : c.surfaceOf!({ sc: c.sombre(id) ? c.panneau(id) : '#ffffff' }, c.sombre(id) ? 22 : 40).surface;
    const a = alphas(carte), a0 = alphas(depart);
    assert.equal(a.length, 2, `thème ${id} : ${carte}`);
    a.forEach((x, i) => assert.ok(x >= a0[i] - 1e-9, `thème ${id} : bout ${i + 1} à ${x}, départ ${a0[i]} (jamais plus transparent)`));
    const pireDepart = Math.min(...pireDesTextes(t, id, depart).map((x) => x.pire));
    if (pireDepart >= 4.75) {
      gardes++;
      if (carte !== depart) echecs.push(`${id} : lisible dès son départ (${pireDepart.toFixed(2)}:1), carte ${carte} au lieu de ${depart}`);
      continue;
    }
    if (carte === depart) continue;
    plusOpaques++;
    // La couche : retrouvée par l'opacité du premier bout, puis vérifiée en recomposant la carte entière.
    const pas = Math.round(((a[0] - a0[0]) / (1 - a0[0])) * 20);
    if (pas < 1 || pas > 20 || surCouche(depart, hexRGB(plein), pas / 20) !== carte) { echecs.push(`${id} : ${carte} n'est pas le départ sur une couche de ${plein} de 5 % en 5 %`); continue; }
    const pireMoins = Math.min(...pireDesTextes(t, id, surCouche(depart, hexRGB(plein), (pas - 1) / 20)).map((x) => x.pire));
    if (pireMoins >= 4.75) echecs.push(`${id} : couche de ${pas * 5} %, alors que ${(pas - 1) * 5} % suffisait déjà (${pireMoins.toFixed(2)}:1)`);
  }
  assert.deepEqual(echecs, [], 'trop transparente, ou plus opaque que nécessaire');
  assert.ok(gardes >= 15, `des thèmes lisibles dès leur départ le gardent (${gardes})`);
  assert.ok(plusOpaques >= 30, `le décor rend des cartes plus opaques (${plusOpaques})`);
  // Un verre blanc sous un texte clair (thème sombre de Hestia à étoiles) : plus opaque, la carte va vers sa couleur
  // pleine, sombre, jamais vers le blanc.
  for (const id of ['h-etoiles', 'h-espace']) {
    c.apply(id);
    const m = /rgba\((\d+),(\d+),(\d+),[\d.]+\)/.exec(variable(css(c), '--v-carte'))!;
    assert.ok(+m[1] + +m[2] + +m[3] < 3 * 128, `thème ${id} : une carte sombre sous un texte clair (${m[0]})`);
  }
});

test('verre : les 84 thèmes à fond ont un verre complet ; « Valhalla » (sans fond) ne change pas', () => {
  const c = charger();
  assert.equal(c.ids.length, 85, '85 thèmes');
  assert.deepEqual(c.sansCiel, ['valhalla']);
  for (const id of c.ids.filter((x) => x !== 'valhalla')) {
    c.apply(id);
    const t = css(c);
    for (const nom of ['--v-carte', '--v-plein', '--v-bord', '--v-flou', '--v-sat', '--v-reflet', '--v-ombre']) {
      const v = variable(t, nom);
      assert.ok(v && !/undefined|NaN|null/.test(v), `thème ${id} : ${nom} posé (${v})`);
    }
    assert.match(variable(t, '--v-carte'), /^linear-gradient\(140deg,rgba\(\d+,\d+,\d+,[\d.]+\),rgba\(\d+,\d+,\d+,[\d.]+\)\)$/, `thème ${id}`);
    assert.match(variable(t, '--v-flou'), /^\d+px$/, `thème ${id}`);
    assert.match(variable(t, '--v-ombre'), /^(?!none)/, `thème ${id} : une ombre utilisable dans une liste`);
  }
  c.apply('valhalla');
  assert.equal(css(c), '', 'Valhalla garde son habillage d\'origine');
});

test('verre : seulement sur l\'accueil ; partout ailleurs, la zone de travail garde son fond uni', () => {
  const c = charger();
  c.apply('glace');
  const t = css(c);
  // La règle de main (fond uni) ne change pas.
  assert.match(/:root\[data-odin-theme\] main\{([^}]*)\}/.exec(t)?.[1] ?? '', /background:var\(--bg\)/);
  // Une seule autre règle touche le fond de main : quand l'accueil est la vue montrée.
  const autres = [...t.matchAll(/([^{}]*\bmain\b[^{}]*)\{([^}]*)\}/g)].filter((m) => !/^\s*:root\[data-odin-theme\] main\s*$/.test(m[1]) && /background/.test(m[2]));
  assert.deepEqual(autres.map((m) => m[1].trim()), [':root[data-odin-theme] main:has(>#v-home.on)']);
  // Sur l'accueil (sa décision du 25/11 : « Décor derrière, verre plus opaque ») : la zone de travail s'ouvre sur le fond
  // de la page, c'est-à-dire le même dessin du décor, le même dégradé et le même voile que derrière la barre de côté.
  assert.equal(autres[0][2], 'background:transparent');
  // Un thème sombre à décor dessiné : le décor est sur le fond de la page, sous le voile ; l'accueil le laisse voir.
  c.apply('nuit');
  const n = css(c);
  assert.match(/:root\[data-odin-theme\] body\{([^}]*)\}/.exec(n)?.[1] ?? '', /url\("data:image\/svg\+xml/, 'le décor est sur le fond de la page');
  assert.match(/:root\[data-odin-theme\] body::before\{([^}]*)\}/.exec(n)?.[1] ?? '', /position:fixed;inset:0;[^}]*background:rgba\(0,0,0,\.18\)/, 'sous le voile de la barre de côté');
  assert.equal(/:root\[data-odin-theme\] main:has\(>#v-home\.on\)\{([^}]*)\}/.exec(n)?.[1], 'background:transparent', 'le décor derrière les cartes de l\'accueil');
  // Tout ce qui est en verre reste sous #v-home.
  const regles = [...t.matchAll(/([^{}]*)\{([^{}]*blur\(var\(--v-flou\)\)[^{}]*)\}/g)];
  assert.ok(regles.length >= 1, 'une règle de verre');
  for (const [, sel] of regles) for (const s of sel.split(/,(?![^()]*\))/)) assert.match(s, /#v-home /, `le verre reste sur l'accueil : ${s}`);
  // Les cartes en verre : jamais une carte dans une carte, jamais la place laissée par un glisser.
  const cartes = regles.find((m) => /:not\(\.dragging\)/.test(m[1]));
  assert.ok(cartes, 'la règle des cartes, sans la place d\'une carte qu\'on déplace');
  assert.match(cartes![1], /:is\(\.fe-w,\.hpanel,\.hcard,\.card\)/, 'les quatre sortes de cartes');
  assert.match(cartes![1], /:not\(:is\(\.fe-w,\.hpanel,\.hcard,\.card\) \*\)/, 'pas de verre dans le verre');
  const verre = cartes![2];
  assert.match(verre, /background:linear-gradient\(135deg,rgba\(255,255,255,var\(--v-reflet\)\) 0%,rgba\(255,255,255,calc\(var\(--v-reflet\) \* \.25\)\) 28%,transparent 55%\),var\(--v-carte\)/, 'le reflet puis la carte');
  assert.match(verre, /-webkit-backdrop-filter:blur\(var\(--v-flou\)\) saturate\(var\(--v-sat\)\)/);
  assert.match(verre, /(^|;)backdrop-filter:blur\(var\(--v-flou\)\) saturate\(var\(--v-sat\)\)/);
  assert.match(verre, /border-color:var\(--v-bord\)/);
});

test('verre : sans flou possible dans le navigateur, la carte prend la couleur pleine ; aucun fondu (mouvement réduit tenu)', () => {
  const c = charger();
  c.apply('vitre');
  const t = css(c);
  const sans = /@supports not \(\(backdrop-filter:blur\(1px\)\) or \(-webkit-backdrop-filter:blur\(1px\)\)\)\{([^{}]*)\{([^}]*)\}\}/.exec(t);
  assert.ok(sans, 'une règle pour le navigateur sans flou');
  assert.match(sans![1], /#v-home :is\(\.fe-w,\.hpanel,\.hcard,\.card\)/);
  assert.match(sans![2], /background:var\(--v-plein\)/);
  // Le verre n'anime rien : ni fondu ni transition, donc rien à couper quand l'appareil demande moins de mouvement.
  const verre = [...t.matchAll(/#v-home[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join(';');
  assert.ok(verre.length > 0);
  assert.doesNotMatch(verre, /transition|animation/);
});

test('verre : dans chaque thème, les textes des cartes restent lisibles (4,5:1) sur le pire point du décor derrière elles', () => {
  // Ce qui peut se trouver derrière une carte de l'accueil, lu dans les règles posées (derriereLaCarte, plus haut) : le
  // dégradé, le dessin du décor par-dessus (jusqu'à trois formes translucides l'une sur l'autre : sur « Aurore boréale »
  // de Hestia, le croisement des deux bandes d'aurore sous le reflet, compté seul, laissait le rouge d'alerte à 4,3:1),
  // le voile, la saturation du verre ; puis la carte à ses deux bouts et le reflet en haut.
  const c = charger();
  const echecs: string[] = [];
  let avecDecor = 0;
  for (const id of c.ids.filter((x) => x !== 'valhalla')) {
    c.apply(id);
    const t = css(c);
    assert.equal(/main:has\(>#v-home\.on\)\{([^}]*)\}/.exec(t)?.[1], 'background:transparent', `thème ${id} : l'accueil montre le fond de la page`);
    if (derriereLaCarte(t, id).dessin) avecDecor++;
    for (const x of pireDesTextes(t, id)) if (x.pire < 4.5) echecs.push(`${id} ${x.nom} ${x.couleur} : ${x.pire.toFixed(2)}:1`);
  }
  assert.ok(avecDecor >= 50, `des thèmes à décor dessiné (${avecDecor})`);
  assert.deepEqual(echecs, [], 'un texte trop pâle dans le verre');
});

test('verre : sans le catalogue (règle de la maquette absente), rien ne change', () => {
  const c = charger(false);
  c.apply('nuit');
  const t = css(c);
  assert.doesNotMatch(t, /--v-carte|#v-home|backdrop-filter:blur\(var/);
  assert.match(/:root\[data-odin-theme\] main\{([^}]*)\}/.exec(t)?.[1] ?? '', /background:var\(--bg\)/);
});

test('verre : tout texte posé sur le fond de l\'accueil, hors d\'une carte, reçoit une plaque du même verre', () => {
  // Le plan de la maquette : « un titre qui se retrouve sur le fond reçoit une plaque ». Ces textes, lus dans la page
  // (ui.html) et dans la fenêtre (fenetre.js) : le résumé « État détaillé » ; les titres de l'ancienne colonne (#todayBox,
  // h2.sect-t : l'accueil d'un membre de la famille, ou du propriétaire tant que sa fenêtre n'est pas lue ou quand elle
  // est en panne) ; le message de la fenêtre elle-même (chargement, panne) ; les cadres en pointillé posés sur le fond
  // (la page vide, « Ajouter un widget » en mode Modifier). Sans plaque, le décor derrière, le titre de l'ancienne colonne
  // tombait à 1,1:1 sur « Montagne » chez un membre.
  const UI = lire('../src/web/ui.html'), FENETRE = lire('../src/web/fenetre.js');
  assert.match(UI, /<div class="today" id="todayBox"><\/div>/, 'l\'ancienne colonne de l\'accueil');
  assert.ok((UI.match(/el\('h2', \{ class: 'sect-t' \}/g) ?? []).length >= 2, 'ses titres sont des h2.sect-t');
  assert.match(UI, /el\('details', \{ class: 'mx hmore' \}, el\('summary'/, 'le résumé « État détaillé »');
  assert.match(FENETRE, /el\('div', \{ id: 'fenetre'[^)]*\}, el\('p', \{ class: 'fe-err' \}/, 'le message de chargement de la fenêtre');
  assert.match(FENETRE, /host\(\)\.replaceChildren\(el\('p', \{ class: 'fe-err' \}/, 'le message de panne de la fenêtre');
  assert.match(FENETRE, /grid\.append\(el\('div', \{ class: 'fe-drop'/, 'la page vide');
  assert.match(FENETRE, /el\('button', \{ class: 'fe-ajout'/, '« Ajouter un widget »');
  const PLAQUES = ['details\\.hmore>summary', '#todayBox \\.sect-t', '#fenetre>\\.fe-err'], CADRES = ['#feGrid>\\.fe-drop', '#fenetre \\.fe-ajout'];
  const c = charger();
  for (const id of ['h-coucher', 'glace', 'nuit', 'montagne']) {
    c.apply(id);
    const t = css(c);
    const regles = [...t.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(/,(?![^()]*\))/).map((s) => s.trim()), corps: m[2] }));
    const avec = (s: string, f: (corps: string) => boolean) => { const re = new RegExp(`^:root\\[data-odin-theme\\] #v-home ${s}$`); return regles.filter((r) => r.sels.some((x) => re.test(x)) && f(r.corps)); };
    const sans = /@supports not [^{]*\{([^{}]*)\{([^}]*)\}\}/.exec(t);
    for (const p of PLAQUES) {
      const verre = avec(p, (x) => /blur\(var\(--v-flou\)\)/.test(x));
      assert.equal(verre.length, 1, `thème ${id} : ${p} est sous la même règle de verre que les cartes`);
      assert.match(verre[0].corps, /var\(--v-carte\)/);
      assert.match(verre[0].corps, /border-color:var\(--v-bord\)/);
      assert.ok(verre[0].sels.some((x) => /:not\(\.dragging\)/.test(x)), `thème ${id} : ${p} a le verre des cartes, avec leurs tons`);
      const forme = avec(p, (x) => /border:1px solid var\(--v-bord\)/.test(x));
      assert.equal(forme.length, 1, `thème ${id} : ${p} a la forme d'une plaque`);
      assert.match(forme[0].corps, /border-radius:/, `thème ${id} : ${p}, coins ronds`);
      assert.match(forme[0].corps, /width:fit-content/, `thème ${id} : ${p}, la plaque tient au texte`);
      assert.match(forme[0].corps, /padding:[1-9]\d*px \d+px/, `thème ${id} : ${p}, de l'air au-dessus et au-dessous du texte`);
      assert.ok(sans?.[1].split(/,(?![^()]*\))/).some((x) => new RegExp(`#v-home ${p}$`).test(x.trim())), `thème ${id} : sans flou, ${p} prend aussi la couleur pleine`);
    }
    // La plaque du résumé ne colle ni à la carte du dessus ni aux chiffres du dessous (quand il est ouvert).
    assert.equal(avec(PLAQUES[0], (x) => /(^|;)margin:[1-9]\d*px 0($|;)/.test(x)).length, 1, `thème ${id} : de la place autour du résumé`);
    for (const z of CADRES) {
      const verre = avec(z, (x) => /blur\(var\(--v-flou\)\)/.test(x));
      assert.equal(verre.length, 1, `thème ${id} : ${z} a le même verre`);
      assert.match(verre[0].corps, /var\(--v-carte\)/);
      assert.equal(variable(verre[0].corps, '--muted'), variable(regleCartes(t), '--muted'), `thème ${id} : ${z}, les mêmes tons que dans les cartes`);
      assert.doesNotMatch(verre[0].corps, /border|width/, `thème ${id} : ${z} garde son pointillé et sa taille`);
      assert.ok(sans?.[1].split(/,(?![^()]*\))/).some((x) => new RegExp(`#v-home ${z}$`).test(x.trim())), `thème ${id} : sans flou, ${z} prend aussi la couleur pleine`);
    }
  }
});

test('verre : la carte « Odin te propose » garde son bord d\'accent sur l\'accueil', () => {
  // La règle de verre pose le bord des cartes de l'accueil ; ui.html donne à .hcard.sugg un bord teinté d'accent :
  // il est remis juste après, avec la même valeur.
  const c = charger();
  c.apply('glace');
  const t = css(c);
  const i = t.search(/blur\(var\(--v-flou\)\)/);
  const sugg = /:root\[data-odin-theme\] #v-home \.hcard\.sugg\{([^}]*)\}/.exec(t);
  assert.ok(sugg, 'une règle pour la carte « Odin te propose »');
  assert.ok(sugg!.index > i, 'posée après la règle de verre');
  assert.equal(sugg![1], 'border-color:color-mix(in srgb,var(--accent) 45%,var(--line))');
});

test('verre : sans flou possible, les textes des cartes restent lisibles (4,5:1) sur la couleur pleine', () => {
  const c = charger();
  const echecs: string[] = [];
  for (const id of c.ids.filter((x) => x !== 'valhalla')) {
    c.apply(id);
    const t = css(c);
    const r = racine(t), cartes = regleCartes(t);
    const plein = variable(r, '--v-plein');
    if (!/^#[0-9a-f]{6}$/i.test(plein)) { echecs.push(`${id} : couleur pleine ${plein}`); continue; }
    for (const nom of TEXTES_CARTE) {
      const couleur = variable(cartes, nom) || variable(r, nom);
      if (!/^#[0-9a-f]{6}$/i.test(couleur)) continue;
      const x = ratio(hexRGB(couleur), hexRGB(plein));
      if (x < 4.5) echecs.push(`${id} ${nom} ${couleur} sur ${plein} : ${x.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(echecs, [], 'un texte trop pâle sur la couleur pleine');
});
