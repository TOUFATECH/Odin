// Genèse · les 13 thèmes gardés sur la maquette « Thèmes du démarrage réseau » : 4 pour le menu texte (iPXE),
// 9 pour l'écran graphique. Le thème Matrix a son titre et ses séparateurs à lui ; chaque thème graphique a sa
// couleur d'accent et la couleur du texte posé dessus ; ton image de fond se pose sous l'un et l'autre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_THEMES, THEMES, textLook } from '../src/valhalla/thjalfi/ecran.ts';
import { ecranPage } from '../src/valhalla/thjalfi/ecran-page.ts';
import { TEXT_BACKGROUNDS, textBackground } from '../src/valhalla/thjalfi/fond.ts';
import { menu } from '../src/valhalla/thjalfi/recipes.ts';

test('les 13 thèmes de la maquette sont là : 4 en texte, 9 en graphique', () => {
  assert.deepEqual(Object.keys(TEXT_THEMES), ['matrix', 'lune', 'aurore', 'neon']);
  assert.deepEqual(Object.keys(THEMES), ['bleu', 'matrix', 'ocean', 'lune', 'ciel', 'galaxie', 'mayotte', 'couchant', 'clair']);
  // Les couleurs du menu texte, telles que sur la maquette (texte, titre, séparateurs, ligne choisie).
  assert.deepEqual(TEXT_THEMES.matrix, { label: 'Matrix', fg: '#7dff9b', title: '#c8ffd4', gap: '#2fbf5a', selBg: '#3dff7a', selFg: '#001a07' });
  assert.deepEqual(TEXT_THEMES.neon, { label: 'Néon', fg: '#f0e6ff', title: '#ff4fd8', gap: '#3af0ff', selBg: '#ff4fd8', selFg: '#12002a' });
  // Chaque thème texte a son image de fond dessinée par Odin (PNG), avec le cadre sombre du menu.
  assert.deepEqual([...TEXT_BACKGROUNDS].sort(), ['aurore', 'lune', 'matrix', 'neon']);
  for (const t of TEXT_BACKGROUNDS) { const b = textBackground(t)!; assert.equal(b.subarray(1, 4).toString('ascii'), 'PNG', t); assert.ok(b.length > 1000, t); }
});

test('menu texte : Matrix a son titre et ses séparateurs ; les autres gardent ceux d\'Odin', () => {
  const entries = [{ id: 'mem', name: 'Memtest', recipe: { kind: 'iso' as const, label: 'essai', auto: false, os: 'outil' as const } }];
  const de = (texte: string) => menu({ base: 'http://192.0.2.1:16000', mac: '38:7a:1f:52:c0:9e', entries, def: 'local', timeout: 0, family: () => 'Linux', texte, look: textLook(texte as never, 'http://192.0.2.1:16000/ecran/fond-texte.png') });
  const m = de('matrix');
  assert.match(m, /^menu ODIN :: CHOISIS UN SYSTEME \(38:7a:1f:52:c0:9e\)$/m);
  assert.match(m, /^item --gap -- \/\/ LINUX \/{30,}$/m);
  assert.match(m, /^console --picture http:\/\/192\.0\.2\.1:16000\/ecran\/fond-texte\.png /m, 'l\'image de fond passe sous le menu');
  assert.match(m, /^colour --rgb 0x7dff9b 7 \|\|$/m);
  const l = de('lune');
  assert.match(l, /^menu ODIN - Choisis un systeme pour ce PC \(38:7a:1f:52:c0:9e\)$/m);
  assert.match(l, /^item --gap -- --- LINUX -{30,}$/m);
  assert.match(l, /^colour --rgb 0xe9e6dc 7 \|\|$/m);
});

test('écran graphique : fonds, voiles et accents des 9 thèmes comme sur la maquette', () => {
  const p = ecranPage();
  for (const t of Object.keys(THEMES)) assert.match(p, new RegExp(`body\\.${t}\\{`), t);
  // L'accent et le texte posé dessus, thème par thème.
  for (const [t, acc, fg] of [['bleu', '#ffffff', '#14204f'], ['matrix', '#3dff7a', '#001a07'], ['lune', '#f4f1e8', '#1a1c26'], ['ciel', '#0b2a4a', '#ffffff'], ['galaxie', '#c9a2ff', '#1a0a3d'], ['couchant', '#ffd36b', '#3a1a00'], ['clair', '#2457c5', '#ffffff']] as const) {
    const corps = new RegExp(`body\\.${t}\\{([^}]*)\\}`).exec(p)![1];
    assert.ok(corps.includes(`--acc:${acc}`), `${t} : accent ${acc}`); assert.ok(corps.includes(`--accfg:${fg}`), `${t} : texte sur l'accent ${fg}`);
  }
  assert.match(p, /\.bar \.y\{background:var\(--acc\);color:var\(--accfg,#3a2a00\)\}/, 'océan et Mayotte gardent l\'accent doré et son texte brun');
  // Le voile posé sur ton image de fond, aux couleurs de chaque thème.
  for (const v of ["bleu:'rgba(11,20,64,.55)'", "matrix:'rgba(0,0,0,.6)'", "ocean:'rgba(3,40,80,.45)'", "lune:'rgba(11,12,20,.5)'", "ciel:'rgba(255,255,255,.35)'", "galaxie:'rgba(7,5,26,.5)'", "mayotte:'rgba(255,255,255,.3)'", "couchant:'rgba(43,16,85,.45)'", "clair:'rgba(246,247,251,.6)'"]) assert.ok(p.includes(v), v);
});
