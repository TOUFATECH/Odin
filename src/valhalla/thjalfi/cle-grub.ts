// Genèse · clé USB : le thème GRUB de Ventoy (mode TEXTE), aux couleurs du thème texte choisi, avec le logo et Odin
// en image FIXE (yeux seuls, dessin officiel figé). GRUB ne fait pas d'animation fluide : on le dit honnêtement —
// l'animation d'Odin vit dans le mode graphique (petit système Alpine hors ligne, voir ecran-offline.ts). Ici, le
// menu est habillé (couleurs, titre, séparateurs, image de fond) et, là où le chargeur le permet, une barre de
// progression en caractères. Fonctions PURES : rien n'est écrit ; le lot A pose ces fichiers dans /ventoy/theme/odin
// et transforme l'image en PNG (GRUB lit des images matricielles, pas du SVG).
import { TEXT_THEMES, barreTexte } from './ecran.ts';
import type { TextTheme } from './ecran.ts';
import { TEINTE_ODIN, fondDuTheme, odinSvg } from './ecrans-communs.ts';
import type { Teintes } from './ecrans-communs.ts';

/** Les couleurs d'un thème texte, sous une forme sûre (« classique » reprend les couleurs d'iPXE). Pur. */
function couleurs(theme: TextTheme) {
  if (theme === 'classique') return { label: 'Classique', fg: '#cfd8e6', title: '#ffffff', gap: '#5a6b86', selBg: '#2f6fe0', selFg: '#ffffff' };
  return TEXT_THEMES[theme];
}

/** Les teintes du corps d'Odin assorties au thème texte (le menu et Odin se répondent). Pur. */
function teintesDuTexte(theme: TextTheme): Teintes {
  const c = couleurs(theme);
  // Le corps prend la couleur de la ligne choisie, en dégradé vers une version plus claire ; les yeux restent blancs.
  return [c.selBg, c.selBg, eclaircir(c.selBg, 0.35), eclaircir(c.selBg, 0.65)] as Teintes;
}

/** Éclaircit une couleur « #rrggbb » vers le blanc d'un facteur donné (0 = inchangée, 1 = blanche). Pur. */
function eclaircir(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const to = (h: string) => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * f);
  const hx = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hx(to(m[1]))}${hx(to(m[2]))}${hx(to(m[3]))}`;
}

const sans = (hex: string) => hex.replace('#', '');

/**
 * Le thème GRUB complet d'une clé, pour un thème texte. Renvoie les fichiers à poser dans /ventoy/theme/odin :
 *  - theme.txt : la mise en page du menu de GRUB (gfxmenu), aux couleurs du thème (texte, titre, ligne choisie),
 *    avec un titre, une barre de progression (compte à rebours du menu) et une ligne de bas de page.
 *  - background.svg : l'image FIXE (logo + Odin figé, yeux seuls). Le lot A la transforme en background.png.
 *  - odin.svg : Odin seul, figé, assorti au thème (pour une icône de menu si besoin).
 *  - LISEZMOI.txt : ce que GRUB permet vraiment (pas d'animation fluide ; l'animation est dans le mode graphique).
 * Pur.
 */
export function buildGrubTheme(texte: TextTheme): Record<string, string> {
  const c = couleurs(texte);
  const tint = teintesDuTexte(texte);
  const theme = [
    '# Odin · Genèse : thème GRUB de la clé ODIN (couleurs du thème « ' + c.label + ' »).',
    '# GRUB ne fait pas d\'animation fluide : le logo et Odin sont une image FIXE.',
    '# L\'animation d\'Odin (yeux, halos) vit dans le mode graphique (système Alpine hors ligne).',
    'title-text: ""',
    'desktop-image: "background.png"',
    'desktop-color: "#0b1440"',
    'terminal-font: "Unifont Regular 16"',
    'terminal-box: "terminal_box_*.png"',
    '',
    '+ label {',
    '  top = 9%',
    '  left = 0',
    '  width = 100%',
    '  align = "center"',
    '  text = "ODIN"',
    `  color = "${c.title}"`,
    '  font = "DejaVu Sans Bold 32"',
    '}',
    '',
    '+ label {',
    '  top = 16%',
    '  left = 0',
    '  width = 100%',
    '  align = "center"',
    '  text = "Choisis un système à démarrer"',
    `  color = "${c.fg}"`,
    '  font = "DejaVu Sans 16"',
    '}',
    '',
    '+ boot_menu {',
    '  left = 24%',
    '  width = 52%',
    '  top = 30%',
    '  height = 46%',
    '  item_font = "DejaVu Sans 18"',
    '  item_height = 40',
    '  item_padding = 8',
    '  item_spacing = 6',
    `  item_color = "${c.fg}"`,
    `  selected_item_color = "${c.selFg}"`,
    `  selected_item_pixmap_style = "select_*.png"`,
    '  icon_width = 32',
    '  icon_height = 32',
    '  scrollbar = true',
    `  scrollbar_thumb = "scrollbar_*.png"`,
    '}',
    '',
    '# La barre du compte à rebours du menu (la seule « barre » que GRUB anime vraiment).',
    '+ progress_bar {',
    '  id = "__timeout__"',
    '  left = 24%',
    '  width = 52%',
    '  top = 82%',
    '  height = 18',
    `  text_color = "${c.fg}"`,
    `  fg_color = "${c.selBg}"`,
    `  bg_color = "${c.gap}"`,
    `  border_color = "${c.gap}"`,
    '  text = "Démarrage automatique dans %d s"',
    '}',
    '',
    '+ label {',
    '  top = 92%',
    '  left = 0',
    '  width = 100%',
    '  align = "center"',
    '  text = "Installation clé USB · Odin"',
    `  color = "${c.gap}"`,
    '  font = "DejaVu Sans 14"',
    '}',
    '',
  ].join('\n');

  const background = fondDuTheme({ tint, titre: 'Installation clé USB' });
  const odin = odinSvg({ tint });
  const lisezmoi = [
    'Thème GRUB de la clé ODIN — « ' + c.label + ' ».',
    '',
    'Ce que GRUB permet vraiment :',
    '- un menu habillé (couleurs du thème, titre, image de fond fixe) : OUI ;',
    '- le logo et Odin en image FIXE (yeux seuls, dessin officiel figé) : OUI ;',
    '- une barre pour le compte à rebours du menu : OUI ;',
    '- une animation fluide d\'Odin (yeux qui changent, halos qui tournent) : NON.',
    '  L\'animation vit dans le MODE GRAPHIQUE (petit système Alpine hors ligne sur la clé).',
    '',
    'Le fichier background.svg doit être transformé en background.png (GRUB lit des images matricielles).',
    'La couleur d\'accent du thème : ' + sans(c.selBg) + '.',
    '',
    'Démarrage sécurisé : la clé de Ventoy s\'inscrit au 1er démarrage (MokManager), expliqué à l\'écran.',
    'Si un système ne démarre pas en démarrage sécurisé, désactive-le dans le BIOS/UEFI (touche F2, Suppr ou F10',
    'selon la marque) : Odin ne peut pas le faire à ta place.',
    '',
  ].join('\n');

  return {
    'theme.txt': theme,
    'background.svg': background,
    'odin.svg': odin,
    'LISEZMOI.txt': lisezmoi,
  };
}

/**
 * La barre de progression en CARACTÈRES pour le thème texte (là où le chargeur peut l'afficher, ex. un message
 * GRUB). Ex. « [####------]  40% ». Pur. Honnête : tous les chargeurs ne savent pas la rafraîchir en continu.
 */
export function barreGrubTexte(texte: TextTheme, pct: number): string {
  return barreTexte(texte, pct);
}

export { TEINTE_ODIN };
