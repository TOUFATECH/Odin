// Règle du propriétaire (15/11/2026) : les pastilles des yeux d'Odin sont TOUJOURS BLANCHES, « qu'importe la situation »
// (émotion, thème clair ou sombre, jour de fête, écran, taille). Jamais noires, jamais sombres, jamais grises, sans ombre
// ni contour sombre autour. Cet essai passe en revue, un par un, les endroits du dépôt qui dessinent la mascotte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const existe = (chemin: string) => existsSync(new URL(`../${chemin}`, import.meta.url));

/** Les éléments d'œil d'un dessin (class="eye …"), avec leur remplissage. */
const yeuxDe = (texte: string) => [...texte.matchAll(/<(rect|path|ellipse|circle)\b[^>]*\bclass=\\?"eye\b[^"\\]*\\?"[\s\S]*?\/>/g)].map((m) => m[0]);
const BLANC = /^(#fff|#ffffff|white)$/i;

/** Les règles CSS d'un texte : sélecteur et déclarations. */
const regles = (texte: string) => [...texte.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), decl: m[2] }));
/** Une règle qui vise les yeux (les pastilles, leur groupe, le regard). */
const visesYeux = (sel: string) => /\.(eye|eyes|regard)\b|\.odin\b[^,]*\.plein\b/.test(sel);
/** Ce qui peut changer la couleur vue d'un œil. */
const COULEUR = /(^|;)\s*(fill|stroke|filter|opacity|color|mix-blend-mode|background|fill-opacity|stroke-opacity)\s*:\s*([^;]*)/g;
/** Les seules valeurs permises sur les yeux : le blanc, ou l'encre de face.js (toujours le blanc). */
const permis = (prop: string, v: string) => (prop === 'fill' || prop === 'stroke') && (BLANC.test(v.trim()) || /^var\(--o-encre\)$/.test(v.trim()));

// ------------------------------------------------------------------ les dessins de la mascotte écrits tels quels
const SVG_FIXES: Array<[string, number]> = [
  ['src/web/ui.html', 8], // connexion (#login), en-tête (#buddy, #buddyM), discussion (#buddyChat) : 4 mascottes, 2 yeux chacune
  ['tools/site/parts/mascot.svg', 2], // site, guide, planche des humeurs, autocollants Telegram
];

test('yeux blancs : chaque mascotte dessinée en dur a des pastilles blanches', () => {
  for (const [chemin, n] of SVG_FIXES) {
    if (!existe(chemin)) continue;
    const yeux = yeuxDe(lire(chemin));
    assert.equal(yeux.length, n, `${chemin} : ${n} yeux attendus, ${yeux.length} trouvés`);
    for (const y of yeux) {
      const fill = /\bfill=\\?"([^"\\]*)\\?"/.exec(y)?.[1] ?? '';
      assert.match(fill, BLANC, `${chemin} : œil non blanc (${y.slice(0, 90)})`);
      assert.doesNotMatch(y, /\b(filter|opacity|fill-opacity|style)=/, `${chemin} : rien d'autre sur l'œil (${y.slice(0, 90)})`);
    }
  }
  // Les pages d'activation et de connexion par QR reçoivent la mascotte de l'écran de connexion (ui.html) : mêmes yeux.
  assert.match(lire('src/web/server.ts'), /const MASCOT = \/<div id="login"/);
});

// ------------------------------------------------------------------ le visage principal (src/web/face.js)
test('yeux blancs : face.js ne peint les yeux qu\'en blanc, sans ombre ni filtre', () => {
  const S = lire('src/web/face.js');
  assert.match(S, /const W = '#fff';/);
  assert.match(S, /const encre = \(\) => W;/, 'l\'encre des yeux est le blanc');
  assert.match(S, /const YEUX_SEULS = true;/); assert.match(S, /const FORMES_LIBRES = false;/);
  // Chaque modèle d'œil se remplit de W (le blanc) ; le cœur prend W par défaut.
  for (const y of yeuxDe(S)) assert.match(y, /fill="\$\{(W|f)\}"/, `modèle d'œil : ${y.slice(0, 80)}`);
  assert.match(S, /const heart = \(cx, cy, s = 6\.5, c = 'eye plein', f = W\)/);
  for (const m of S.matchAll(/heart\(([^)]*)\)/g)) if (/'eye|^[LR], Y$/.test(m[1].trim())) assert.doesNotMatch(m[1], /#/, `un cœur-œil est blanc : heart(${m[1]})`);
  // Aucune ombre, aucun voile sombre sur ou autour des pastilles.
  for (const interdit of ['--o-ombre', 'drop-shadow', 'ENCRE_SOMBRE', '#2a2f3a']) assert.ok(!S.includes(interdit), `face.js : « ${interdit} » interdit`);
  assert.match(S, /\.odin \.plein\{fill:var\(--o-encre\);transition/);
  // L'encre posée est toujours celle de encre() ; ses valeurs écrites dans le CSS sont toutes le blanc.
  for (const m of S.matchAll(/setProperty\('--o-encre', ([^)]*\))\)/g)) assert.equal(m[1], 'encre(t)');
  for (const m of S.matchAll(/--o-encre:([^;}]*)/g)) assert.match(m[1], BLANC, `--o-encre:${m[1]}`);
});

test('yeux blancs : face.js, rendu de chaque émotion à chaque taille, et de chaque couleur de repos', async () => {
  const window: { OdinFace?: { liste(): Array<{ id: string }>; dessin(id: string, o?: { taille?: string }): { yeux: string[]; encre: string }; tintBase(c: string): void } } = {};
  runInNewContext(lire('src/web/face.js'), { window, setTimeout, clearTimeout });
  const F = window.OdinFace!;
  const ids = JSON.parse(JSON.stringify(F.liste())).map((m: { id: string }) => m.id) as string[];
  assert.ok(ids.length >= 60);
  const verifier = (quoi: string, d: { yeux: string[]; encre: string }) => {
    assert.equal(d.encre, '#fff', `${quoi} : encre`);
    for (const y of d.yeux) {
      for (const m of y.matchAll(/\b(fill|stroke)="([^"]*)"/g)) assert.ok(BLANC.test(m[2]) || m[2] === 'none', `${quoi} : ${m[1]}="${m[2]}"`);
      assert.doesNotMatch(y, /\b(filter|opacity|fill-opacity|stroke-opacity|style)=/, `${quoi} : rien d'autre sur l'œil`);
    }
  };
  for (const id of ids) for (const taille of ['grand', 'petit', 'mini']) verifier(`${id} (${taille})`, F.dessin(id, { taille }));
  // Au repos, toutes les couleurs de thème et de fête, et des couleurs très claires ou très sombres.
  const themes = [...lire('src/web/themes.js').matchAll(/"?mascot"?\s*:\s*['"](#[0-9a-fA-F]{6})['"]/g)].map((x) => x[1]);
  const { EVENTS } = await import('../src/valhalla/fetes.ts');
  for (const c of [...themes, ...EVENTS.map((e) => e.color), '#ffffff', '#f2f2f2', '#fff4c2', '#000000', '#2a2f3a']) { F.tintBase(c); verifier(`repos ${c}`, F.dessin('neutre')); }
});

// ------------------------------------------------------------------ le CSS de chaque fichier qui dessine ou habille la mascotte
const CSS_MASCOTTE = [
  'src/web/ui.html', 'src/web/face.js', 'src/web/mascotte.js', 'src/web/companion.js', 'src/web/notices.js', 'src/web/dialog.js',
  'src/web/maison.js', 'src/web/maison-api.ts', 'src/web/alchimie.js', 'src/web/guide.js', 'src/web/vie.js', 'src/web/recherche.js',
  'src/web/recherche-api.ts', 'src/web/themes.js', 'src/web/pages/rodd.js', 'src/web/pages/naglfar.js', 'src/web/activate.ts',
  'src/web/connexion-qr-page.ts', 'src/valhalla/thjalfi/ecran-page.ts', 'tools/site/parts/eyes.css', 'tools/site/parts/face.css',
  'tools/guide/template.html', 'tools/render-moods.cjs', 'tools/planche-humeurs.mjs', 'site/assets/face.js',
];

test('yeux blancs : aucune règle CSS ne change la couleur des yeux, ne les assombrit ni ne pose de filtre dessus', () => {
  for (const chemin of CSS_MASCOTTE) {
    if (!existe(chemin)) continue;
    for (const { sel, decl } of regles(lire(chemin))) {
      if (!visesYeux(sel)) continue;
      for (const m of decl.matchAll(COULEUR)) assert.ok(permis(m[2], m[3]), `${chemin} : « ${sel.slice(-80)} { ${m[2]}:${m[3]} } » touche la couleur des yeux`);
    }
  }
  // La mascotte de la discussion n'est plus à demi transparente au repos (ses yeux paraissaient gris sur le thème sombre).
  assert.doesNotMatch(lire('src/web/ui.html'), /\.chat-buddy\{[^}]*opacity:\.\d/);
});

// ------------------------------------------------------------------ fêtes et habits
test('yeux blancs : les fêtes et leurs habits ne touchent pas les yeux', async () => {
  const M = lire('src/web/mascotte.js');
  assert.ok(!M.includes('ev-dark-eyes .eye'), 'plus de règle d\'yeux sombres');
  assert.match(M, /o\.classList\.remove\('ev-dark-eyes'\);/);
  // Les habits dessinés (au-dessus de la tête ou dans le coin en haut à droite, loin des yeux) : la liste est fermée,
  // un nouvel habit doit être regardé avant d'être ajouté ici. Le loup du Carnaval, qui couvrait les yeux, n'est plus dessiné.
  const acc = /const ACC = \{([\s\S]*?)\n {2}\};/.exec(M)?.[1] ?? '';
  const dessines = [...acc.matchAll(/^\s*(\w+): '(.*)',/gm)].filter((m) => m[2] !== '').map((m) => m[1]).sort();
  assert.deepEqual(dessines, ['bonnet', 'citrouille', 'coeur', 'cotillons', 'gateau', 'lune', 'note', 'trefle']);
  assert.match(acc, /masque: '',/);
  // Les couleurs d'yeux déclarées par fête : le blanc.
  const { EVENTS } = await import('../src/valhalla/fetes.ts');
  for (const e of EVENTS as Array<{ id: string; eyes?: string }>) if (e.eyes !== undefined) assert.match(e.eyes, BLANC, `fête ${e.id}`);
});

// ------------------------------------------------------------------ les outils qui refont des images à partir du visage
test('yeux blancs : site, guide, planche et autocollants reprennent le visage de l\'interface', () => {
  assert.match(lire('tools/render-moods.cjs'), /src\/web\/face\.js/);
  assert.match(lire('tools/guide/build.ts'), /'src', 'web', 'face\.js'/);
  assert.match(lire('tools/site/build.ts'), /'src', 'web', 'face\.js'/);
  // La copie publiée du site ne garde ni ombre ni yeux sombres.
  const site = lire('site/assets/face.js');
  for (const interdit of ['--o-ombre', 'drop-shadow', 'ENCRE_SOMBRE']) assert.ok(!site.includes(interdit), `site/assets/face.js : ${interdit}`);
  assert.match(site, /const W = '#fff';/);
});
