// Le décor d'un thème ne passe jamais derrière la zone de travail (choix du propriétaire du 17/11 : fond uni dans la
// zone de travail ; le décor ne se voit plus que derrière la barre de côté), sauf sur l'accueil (son choix du 23/11,
// réponse à une question à choix : « le verre sur l'accueil et l'écran de la maison seulement, fond uni ailleurs » ; puis
// sa décision du 25/11, question à choix : « Décor derrière, verre plus opaque » — le décor du thème derrière l'accueil,
// comme la maquette, les cartes assez opaques pour que chaque texte reste lisible). Fond uni partout, sauf l'accueil.
// On charge src/web/themes.js tel quel (avec le catalogue des thèmes chargé avant lui, comme dans la page), avec une
// page factice, on applique des thèmes à décor, et on lit les règles CSS réellement posées sur `main`.
// (Le contrôle à l'écran, thème par thème et à 1280 et 390 px, est fait avec l'outil d'affichage.)
// RAPIDITE_SRC : dossier d'une autre copie de src (pour rejouer l'essai sur l'ancienne version).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(process.env.RAPIDITE_SRC ? join(process.env.RAPIDITE_SRC, 'web', 'themes.js') : fileURLToPath(new URL('../src/web/themes.js', import.meta.url)), 'utf8');
const fichierCatalogue = process.env.RAPIDITE_SRC ? join(process.env.RAPIDITE_SRC, 'web', 'pages', 'themes-catalogue.js') : fileURLToPath(new URL('../src/web/pages/themes-catalogue.js', import.meta.url));
const catalogue = existsSync(fichierCatalogue) ? readFileSync(fichierCatalogue, 'utf8') : '';

function charger() {
  const styles: Array<{ id?: string; textContent: string }> = [];
  const element = () => ({ textContent: '', style: {}, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [] });
  const document = {
    readyState: 'complete', documentElement: { dataset: {} as Record<string, string>, dispatchEvent() {}, addEventListener() {} },
    head: { append: (s: { id?: string; textContent: string }) => styles.push(s) },
    createElement: (t: string) => { const e = element(); if (t === 'style') return e; return e; },
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null,
  };
  const window: Record<string, unknown> = { OdinThemes: {}, addEventListener() {} };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: () => null, setItem() {} }, fetch: () => Promise.reject(new Error('hors ligne')), CustomEvent: class { t: string; constructor(t: string) { this.t = t; } }, setTimeout, clearTimeout, setInterval: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), console, navigator: {} });
  (window as { window?: unknown }).window = window;
  if (catalogue) vm.runInContext(catalogue, ctx);
  vm.runInContext(source, ctx);
  return { styles, apply: (window.OdinThemes as { apply(id: string): void }).apply };
}

test('thèmes à décor : la zone de travail a un fond uni partout, sauf l\'accueil (le décor ne passe derrière aucun texte ailleurs)', () => {
  const { styles, apply } = charger();
  for (const t of ['pluie', 'orage', 'neige', 'nuit', 'mayotte']) {
    apply(t);
    const css = styles.find((s) => s.id === 'odinThemeStyle')?.textContent ?? styles.at(-1)?.textContent ?? '';
    assert.match(css, /data:image\/svg\+xml/, `le thème ${t} a bien un décor`);
    const regleMain = /:root\[data-odin-theme\] main\{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.match(regleMain, /background:var\(--bg\)/, `thème ${t} : la zone de travail doit avoir un fond uni (règle : ${regleMain})`);
    // Toute autre règle qui change le fond de `main` ne vaut que quand l'accueil est la vue montrée.
    const exceptions = [...css.matchAll(/([^{}]*\bmain\b[^{}]*)\{([^}]*)\}/g)].filter((m) => /background/.test(m[2]) && m[1].trim() !== ':root[data-odin-theme] main').map((m) => m[1].trim());
    for (const e of exceptions) assert.equal(e, ':root[data-odin-theme] main:has(>#v-home.on)', `thème ${t} : le fond de la zone de travail ne s'ouvre que sur l'accueil (${e})`);
    // Sur l'accueil seulement, le décor est permis (sa décision du 25/11 : « Décor derrière, verre plus opaque ») : la zone
    // de travail y laisse voir le fond de la page, le même que derrière la barre de côté (dessin, dégradé et voile).
    const accueil = /:root\[data-odin-theme\] main:has\(>#v-home\.on\)\{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.equal(accueil, 'background:transparent', `thème ${t} : l'accueil montre le décor du thème (${accueil})`);
  }
});
