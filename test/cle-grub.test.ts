// Genèse · clé USB : le thème GRUB (mode texte). On vérifie que theme.txt reprend les couleurs du thème texte, que
// l'image fixe est le dessin officiel figé (Odin yeux seuls : deux pastilles blanches, aucune bouche/sourcil/joue),
// que la barre en caractères marche, et que les limites de GRUB sont dites honnêtement. Fonctions pures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barreGrubTexte, buildGrubTheme } from '../src/valhalla/thjalfi/cle-grub.ts';
import { TEXT_THEMES } from '../src/valhalla/thjalfi/ecran.ts';

test('theme.txt reprend les couleurs du thème texte (ligne choisie, texte, titre)', () => {
  const f = buildGrubTheme('matrix');
  const t = f['theme.txt'];
  assert.ok(t.includes(`item_color = "${TEXT_THEMES.matrix.fg}"`), 'couleur du texte');
  assert.ok(t.includes(`selected_item_color = "${TEXT_THEMES.matrix.selFg}"`), 'couleur de la ligne choisie');
  assert.ok(t.includes(`color = "${TEXT_THEMES.matrix.title}"`), 'couleur du titre');
  assert.ok(t.includes('desktop-image: "background.png"'), 'image de fond matricielle');
  assert.ok(t.includes('text = "ODIN"'), 'le titre ODIN');
  // Chaque thème texte produit son theme.txt.
  for (const th of ['matrix', 'lune', 'aurore', 'neon', 'classique'] as const) {
    assert.ok(buildGrubTheme(th)['theme.txt'].includes('+ boot_menu {'), th);
  }
});

test('image fixe : Odin officiel figé, mascotte YEUX SEULS (deux pastilles blanches, rien d\'autre)', () => {
  const f = buildGrubTheme('neon');
  const bg = f['background.svg'], odin = f['odin.svg'];
  assert.ok(bg.includes('<svg'), 'un SVG de fond');
  assert.ok(bg.includes('>ODIN<'), 'le logo ODIN');
  // Deux pastilles blanches (les yeux), et aucune bouche / sourcil / joue.
  const pastilles = (odin.match(/<rect[^>]*rx="4\.5"[^>]*fill="#fff"/g) || []).length;
  assert.equal(pastilles, 2, 'exactement deux yeux en pastille');
  for (const interdit of ['bouche', 'sourcil', 'joue', 'mouth', 'brow', 'cheek']) assert.ok(!odin.toLowerCase().includes(interdit), `pas de ${interdit}`);
  // Les halos officiels d'Odin sont là.
  assert.ok(odin.includes('odHalo'), 'les halos');
});

test('barre en caractères et limites de GRUB dites honnêtement', () => {
  assert.equal(barreGrubTexte('matrix', 40).replace(/\s+/g, ' ').trim().startsWith('['), true);
  assert.match(barreGrubTexte('lune', 50), /\] +50%$/);
  const lis = buildGrubTheme('matrix')['LISEZMOI.txt'];
  assert.match(lis, /animation fluide.*NON/s);
  assert.match(lis, /mode graphique/i);
  assert.match(lis, /d.marrage s.curis/i); // l'inscription de la clé au 1er démarrage est expliquée
});
