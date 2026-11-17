// Les écrans de Talos et des épingles (src/web/pages/*.js) : jamais le mot « null » écrit en clair (replaceChildren
// reçoit des null des ternaires), boutons de la liste « Automatismes » dans la colonne du texte, noms des applis
// lisibles dans la grille de « Faire un lien », focus gardé quand on retire une épingle au clavier.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const lire = (f: string) => readFileSync(new URL(`../src/web/pages/${f}`, import.meta.url), 'utf8');
const FICHIERS = ['talos-automatismes.js', 'talos-lien.js', 'talos-rythme.js', 'talos-dossiers.js', 'epingles.js', 'appli-auto.js'];

/** Le texte des arguments de chaque appel `replaceChildren(…)` (parenthèses équilibrées). */
function appels(t: string): string[] {
  const out: string[] = [];
  for (let i = t.indexOf('replaceChildren('); i >= 0; i = t.indexOf('replaceChildren(', i + 1)) {
    let p = 0, j = i + 'replaceChildren'.length;
    for (; j < t.length; j++) { if (t[j] === '(') p++; else if (t[j] === ')' && --p === 0) break; }
    out.push(t.slice(i, j + 1));
  }
  return out;
}

test('aucun null passé à replaceChildren sans filtre (il s\'écrirait « null »)', () => {
  for (const f of FICHIERS) {
    for (const a of appels(lire(f))) {
      if (!/[?:]\s*null\b/.test(a)) continue;
      assert.match(a, /\.filter\(Boolean\)\)$/, `${f} : ${a.slice(0, 120)}… filtre ses null avant replaceChildren`);
    }
  }
});

test('liste « Automatismes » : tout sauf l\'icône va dans la colonne du texte', () => {
  assert.ok(lire('talos-automatismes.js').includes('.au-l>*:not(.au-ic){grid-column:2'), 'les boutons (.au-b) ne tombent pas dans la colonne de 36 px de l\'icône');
});

test('« Faire un lien » : les rangées de la grille des applis prennent la hauteur de leur contenu', () => {
  const css = /\.li-g\{[^}]*\}/.exec(lire('talos-lien.js'))?.[0] ?? '';
  assert.match(css, /grid-auto-rows:max-content/);
  assert.match(css, /align-content:start/);
});

test('retirer une épingle depuis le menu garde le focus (ligne voisine, sinon « Épingler une appli… »)', () => {
  const t = lire('epingles.js');
  assert.match(t, /'nav-ep-x'[^\n]*onclick: \(\) => retirerDuMenu\(id\)/, 'le bouton « Retirer » du menu passe par retirerDuMenu');
  const f = /async function retirerDuMenu\(id\) \{[\s\S]*?\n {2}\}/.exec(t)?.[0] ?? '';
  assert.match(f, /nextElementSibling/); assert.match(f, /previousElementSibling/); assert.match(f, /\.nav-ep-add/); assert.match(f, /\.focus\(\)/);
});
