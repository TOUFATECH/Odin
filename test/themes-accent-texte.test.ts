// Glace et Maison claire (famille « Mis en avant ») : leur accent de la maquette (#1f8fff, #f59e0b) se lit mal en
// texte sur leur fond clair. Réponse du propriétaire : « Assombrir le texte seul ». Donc une variable de plus,
// --accent-texte : une teinte plus foncée de la même couleur pour ces deux thèmes, et exactement --accent pour tous les
// autres. Elle ne sert qu'au texte (liens, texte en accent, icônes de texte) et à l'anneau du thème choisi ; les fonds,
// les boutons, les pastilles et les bordures gardent --accent.
// themes.js est chargé tel quel dans un bac à sable, avec une page factice (comme test/themes-catalogue.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const lire = (chemin: string) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');
const THEMES_JS = lire('../src/web/themes.js');
const CATALOGUE_JS = lire('../src/web/pages/themes-catalogue.js');
const UI = lire('../src/web/ui.html');

interface Theme { name: string; dark?: boolean; sky?: string[]; panel?: string; ink?: string; accent?: string; accentTexte?: string }
interface Odin { THEMES: Record<string, Theme>; palette(t: Theme): Record<string, string>; apply(id: string): void }

/** themes.js dans une page factice (avec ou sans le catalogue de la maquette, chargé avant lui). */
function charger(catalogue = true): Odin & { styles: Array<{ textContent: string }>; maquette?: Record<string, unknown> } {
  const styles: Array<{ textContent: string }> = [];
  const element = () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append: (s: { textContent: string }) => styles.push(s) }, createElement: () => element(),
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null,
  };
  const window: Record<string, unknown> = { OdinThemes: {}, addEventListener() {} };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), console, navigator: {} });
  (window as { window?: unknown }).window = window;
  if (catalogue) vm.runInContext(CATALOGUE_JS, ctx);
  vm.runInContext(THEMES_JS, ctx);
  const o = window.OdinThemes as Odin;
  return { THEMES: JSON.parse(JSON.stringify(o.THEMES)) as Record<string, Theme>, palette: (t) => ({ ...o.palette(t) }), apply: o.apply, styles, maquette: window.OdinCatalogueThemes as Record<string, unknown> | undefined };
}

// ---------------------------------------------------------------- le calcul du contraste (WCAG 2.x)
// Luminance relative d'une couleur sRGB : chaque canal c = valeur/255 est linéarisé
// (c ≤ 0,03928 ? c / 12,92 : ((c + 0,055) / 1,055)^2,4), puis L = 0,2126 R + 0,7152 G + 0,0722 B.
// Contraste entre deux couleurs = (L claire + 0,05) / (L foncée + 0,05) ; 4,5:1 au moins pour du texte courant (AA).
const canaux = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lineaire = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (h: string) => { const [r, g, b] = canaux(h).map(lineaire); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** La teinte (en degrés, 0-360) d'une couleur : même formule que le modèle TSL. */
const teinte = (h: string) => {
  const [r, g, b] = canaux(h).map((v) => v / 255), M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
  if (!d) return 0;
  const x = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (x * 60 + 360) % 360;
};

// Les deux teintes choisies (même teinte que l'accent, plus sombres) et leur accent de la maquette, qui ne bouge pas.
const PLUS_FONCE: Record<string, { accent: string; texte: string }> = {
  glace: { accent: '#1f8fff', texte: '#0061c2' },
  clair: { accent: '#f59e0b', texte: '#945f06' },
};

test('Glace et Maison claire : le texte en accent atteint 4,5:1 sur la carte et sur le fond, dans la même teinte', () => {
  const c = charger();
  for (const [id, { accent, texte }] of Object.entries(PLUS_FONCE)) {
    const t = c.THEMES[id], p = c.palette(t);
    assert.equal(p['--accent-texte'], texte, `${id} : la teinte du texte`);
    // La carte (--panel, --panel2) et le fond (--bg, et les deux bouts du dégradé du fond, sky).
    const fonds = { '--panel': p['--panel'], '--panel2': p['--panel2'], '--bg': p['--bg'], 'fond haut': t.sky![0], 'fond bas': t.sky![1] };
    for (const [nom, fond] of Object.entries(fonds)) {
      const r = contraste(texte, fond);
      assert.ok(r >= 4.5, `${id} : ${texte} sur ${nom} (${fond}) = ${r.toFixed(2)}:1, il faut 4,5:1`);
      // Avant : l'accent de la maquette, en texte, n'y arrivait pas.
      assert.ok(contraste(accent, fond) < 4.5, `${id} : l'accent ${accent} sur ${nom} était déjà lisible ?`);
    }
    assert.ok(Math.abs(teinte(texte) - teinte(accent)) <= 1, `${id} : même teinte (${teinte(accent).toFixed(1)}° → ${teinte(texte).toFixed(1)}°)`);
    assert.ok(luminance(texte) < luminance(accent), `${id} : plus foncé`);
  }
});

test('Glace et Maison claire : --accent reste la couleur de la maquette (fonds, boutons, pastilles)', () => {
  const c = charger();
  for (const [id, { accent }] of Object.entries(PLUS_FONCE)) {
    assert.equal(c.THEMES[id].accent, accent, `${id} : accent du thème`);
    assert.equal(c.palette(c.THEMES[id])['--accent'], accent, `${id} : --accent`);
    assert.equal((c.maquette!.THEMES as Record<string, { accent: string }>)[id].accent, accent, `${id} : accent du catalogue`);
  }
});

// L'empreinte de toutes les variables des 84 thèmes à couleurs, sans --accent-texte, relevée AVANT ce changement
// (themes.js et themes-catalogue.js du 19/11) : rien d'autre ne bouge, pour aucun thème.
const EMPREINTE_AVANT = '6c88084b26913e5f6b7af6991aab508b0fecb7ecf593333f3788a78c69cc617f';

test('les 83 autres thèmes : toutes les variables d\'avant à l\'identique, --accent-texte vaut --accent', () => {
  const c = charger();
  const ids = Object.keys(c.THEMES);
  assert.equal(ids.length, 85);
  const avecCouleurs = ids.filter((id) => c.THEMES[id].sky);
  assert.equal(avecCouleurs.length, 84, 'Valhalla, seul, n\'a pas de couleurs à lui');
  const tout = avecCouleurs.map((id) => { const p = c.palette(c.THEMES[id]); delete p['--accent-texte']; return [id, Object.entries(p)]; });
  assert.equal(createHash('sha256').update(JSON.stringify(tout)).digest('hex'), EMPREINTE_AVANT, 'les variables d\'avant ont changé');
  const autres = ids.filter((id) => !(id in PLUS_FONCE));
  assert.equal(autres.length, 83);
  for (const id of autres) {
    assert.equal(c.THEMES[id].accentTexte, undefined, `${id} : pas de teinte de texte à part`);
    if (!c.THEMES[id].sky) continue;
    const p = c.palette(c.THEMES[id]);
    assert.equal(p['--accent-texte'], p['--accent'], `${id} : --accent-texte = --accent`);
  }
  // Valhalla : aucune variable posée par themes.js ; la page retombe sur --accent (voir l'essai sur ui.html).
  c.apply('valhalla');
  assert.equal(c.styles.at(-1)?.textContent, '');
  // Sans le catalogue de la maquette, chaque thème d'Odin garde aussi --accent-texte = --accent.
  const sans = charger(false);
  for (const [id, t] of Object.entries(sans.THEMES)) if (t.sky) assert.equal(sans.palette(t)['--accent-texte'], t.accent, `${id} (sans catalogue)`);
});

/** Les déclarations CSS (propriété, valeur) d'une feuille de style, commentaires retirés. */
function declarations(css: string): Array<[string, string]> {
  const sans = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...sans.matchAll(/(?<=[{;]\s*)([-\w]+)\s*:([^;{}]*)/g)].map((m) => [m[1], m[2].trim()]);
}

test('ui.html : le texte en accent passe à --accent-texte, jamais un fond, une bordure ni un bouton', () => {
  const debut = UI.indexOf('<style>'), fin = UI.indexOf('</style>', debut);
  assert.ok(debut >= 0 && fin > debut);
  const decl = declarations(UI.slice(debut + 7, fin));
  const nouvelles = decl.filter(([, v]) => v.includes('--accent-texte'));
  assert.ok(nouvelles.length >= 20, `les règles de texte en accent (${nouvelles.length})`);
  for (const [prop, v] of nouvelles) {
    assert.equal(prop, 'color', `${prop}:${v} — seul le texte prend la nouvelle variable`);
    // Repli : sans thème d'Odin (Valhalla, Clair épuré), c'est --accent, comme avant.
    assert.equal(v, 'var(--accent-texte,var(--accent))');
  }
  for (const [prop, v] of decl) {
    if (/^(background|border|outline|box-shadow|accent-color|fill|stroke)/.test(prop)) assert.ok(!v.includes('--accent-texte'), `${prop}:${v}`);
    if (prop === 'color') assert.notEqual(v, 'var(--accent)', 'un texte en accent est resté sur --accent');
  }
  assert.ok(!/--accent-texte\s*:/.test(UI), 'ui.html ne pose pas --accent-texte lui-même');
  // Les fonds et les boutons en accent sont toujours là.
  assert.ok(decl.some(([p, v]) => p === 'background' && v === 'var(--accent)'), 'des fonds restent en --accent');
});

test('Réglages → Apparence : l\'anneau du thème choisi prend --accent-texte ; la pastille de chaque vignette garde l\'accent', () => {
  assert.match(THEMES_JS, /#themeGrid button\[aria-pressed=true\]\{outline:3px solid var\(--accent-texte,var\(--accent\)\);outline-offset:2px\}/);
  assert.match(THEMES_JS, /<i style="background:\$\{t\.accent \|\| '#E3AC3F'\}"><\/i>/);
});
