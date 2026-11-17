// Le décor d'un thème ne passe jamais derrière la zone de travail (choix du propriétaire du 17/11 : fond uni dans la
// zone de travail ; le décor ne se voit plus que derrière la barre de côté). On charge src/web/themes.js tel quel, avec
// une page factice, on applique des thèmes à décor, et on lit la règle CSS réellement posée sur `main`.
// (Le contrôle à l'écran, thème par thème et à 1280 et 390 px, est fait avec l'outil d'affichage.)
// RAPIDITE_SRC : dossier d'une autre copie de src (pour rejouer l'essai sur l'ancienne version).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(process.env.RAPIDITE_SRC ? join(process.env.RAPIDITE_SRC, 'web', 'themes.js') : fileURLToPath(new URL('../src/web/themes.js', import.meta.url)), 'utf8');

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
  vm.runInContext(source, ctx);
  return { styles, apply: (window.OdinThemes as { apply(id: string): void }).apply };
}

test('thèmes à décor : la zone de travail a un fond uni (le décor ne passe derrière aucun texte)', () => {
  const { styles, apply } = charger();
  for (const t of ['pluie', 'orage', 'neige', 'nuit', 'mayotte']) {
    apply(t);
    const css = styles.find((s) => s.id === 'odinThemeStyle')?.textContent ?? styles.at(-1)?.textContent ?? '';
    assert.match(css, /data:image\/svg\+xml/, `le thème ${t} a bien un décor`);
    const regleMain = /:root\[data-odin-theme\] main\{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.match(regleMain, /background:var\(--bg\)/, `thème ${t} : la zone de travail doit avoir un fond uni (règle : ${regleMain})`);
  }
});
