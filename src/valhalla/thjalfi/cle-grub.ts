// Genèse · clé USB : le thème GRUB de Ventoy (mode TEXTE), aux couleurs du thème texte choisi, avec le logo et Odin
// en image FIXE (yeux seuls, dessin officiel figé). GRUB ne fait pas d'animation fluide : on le dit honnêtement —
// l'animation d'Odin vit dans le mode graphique (petit système Alpine hors ligne, voir ecran-offline.ts). Ici, le
// menu est habillé (couleurs, titre, séparateurs, image de fond) et, là où le chargeur le permet, une barre de
// progression en caractères. Fonctions PURES : rien n'est écrit ; le lot A pose ces fichiers dans /ventoy/theme/odin
// et transforme l'image en PNG (GRUB lit des images matricielles, pas du SVG).
import { TEXT_THEMES, barreTexte, textThemeOf } from './ecran.ts';
import type { TextTheme } from './ecran.ts';
import { TEINTE_ODIN, fondDuTheme, odinSvg } from './ecrans-communs.ts';
import type { Teintes } from './ecrans-communs.ts';
import { TITRE_ENTREE_ODIN, asciiMenu, entreesMenuCle, reglagesDemarrage, titreEntreeTexte } from './cle-boot.ts';
import type { PreparationCle } from './cle-types.ts';

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

// ======================================================================================================================
// Lot C7 · le MENU TEXTE de la clé (maquette validée, écran « Démarrage → menu texte »). Ventoy ouvre ce menu par sa
// touche F6 (fichier /ventoy/ventoy_grub.cfg, lu par GRUB) ; en mode texte par défaut, ventoy.json l'ouvre tout seul
// (cle-boot.ts). Ce que le chargeur sait faire en mode texte, dit honnêtement :
//  - les couleurs : GRUB n'a que 16 couleurs nommées en mode texte ; on prend la plus proche de chaque couleur du thème ;
//  - Odin : une image FIXE en caractères (son corps à la couleur du thème, ses deux yeux blancs, rien d'autre) ;
//  - la barre : en caractères « [####....] », redessinée chaque seconde pendant l'attente (Échap arrête l'attente) ;
//  - les textes : en ASCII seulement (le mode texte n'affiche pas l'Unicode : « é » s'écrit « e »).
// Tout nom venu d'ailleurs (nom de système, fichier) passe par asciiMenu / nomMenuTexte / fichierSurMenu : aucun
// guillemet, $, \, accolade, point-virgule ni retour à la ligne n'arrive dans le fichier. Rien de personnel n'y est
// écrit (ni mot de passe, ni nom de compte, ni adresse). Fonction PURE : rien n'est écrit ici.
// ======================================================================================================================

/** Les 16 couleurs nommées de GRUB en mode texte (palette VGA), pour trouver la plus proche d'une couleur du thème. */
const COULEURS_GRUB: Array<[string, number, number, number]> = [
  ['black', 0, 0, 0], ['blue', 0, 0, 170], ['green', 0, 170, 0], ['cyan', 0, 170, 170], ['red', 170, 0, 0],
  ['magenta', 170, 0, 170], ['brown', 170, 85, 0], ['light-gray', 170, 170, 170], ['dark-gray', 85, 85, 85],
  ['light-blue', 85, 85, 255], ['light-green', 85, 255, 85], ['light-cyan', 85, 255, 255], ['light-red', 255, 85, 85],
  ['light-magenta', 255, 85, 255], ['yellow', 255, 255, 85], ['white', 255, 255, 255],
];
export const NOMS_COULEURS_GRUB = COULEURS_GRUB.map((c) => c[0]);

/** La couleur nommée de GRUB la plus proche d'une couleur « #rrggbb » (blanc si illisible). Pur. */
export function couleurGrub(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 'white';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  let mieux = 'white', d = Infinity;
  for (const [n, R, G, B] of COULEURS_GRUB) { const e = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (e < d) { d = e; mieux = n; } }
  return mieux;
}

/** La couleur du corps d'Odin dans le menu texte, par thème (celle de la maquette validée). Jamais blanche : ses yeux le sont. */
const CORPS_ODIN_TEXTE: Record<TextTheme, string> = { matrix: '#3dff7a', lune: '#d8d2bd', aurore: '#7dffcf', neon: '#ff4fd8', classique: '#3f82f0' };

/** Les couleurs du menu texte d'un thème, en couleurs nommées de GRUB (« texte/fond »). Pur. */
export function couleursMenuTexte(texte: TextTheme) {
  const c = couleurs(texte);
  let corps = couleurGrub(CORPS_ODIN_TEXTE[texte] ?? CORPS_ODIN_TEXTE.classique);
  if (corps === 'white') corps = 'light-gray';
  const choisi = couleurGrub(c.selBg);
  let surChoisi = couleurGrub(c.selFg);
  if (choisi === surChoisi) surChoisi = choisi === 'black' ? 'white' : 'black';
  return {
    normal: `${couleurGrub(c.fg)}/black`,
    choisi: `${surChoisi}/${choisi}`,
    titre: `${couleurGrub(c.title)}/black`,
    discret: `${couleurGrub(c.gap)}/black`,
    corps,
  };
}

type CleTexte = 'sousTitre' | 'graphique' | 'disque' | 'demarreDans' | 'aideAttente' | 'viaListe' | 'pasDeGraphique' | 'pasDeDisque' | 'refuse';
/**
 * Les textes du menu texte, par langue, écrits avec leurs accents (le chargeur les reçoit en ASCII). `{nom}` et `{s}`
 * sont remplacés. Une langue absente prend l'anglais (voir textesMenuTexte).
 */
export const TEXTES_MENU_TEXTE: Record<string, Record<CleTexte, string>> = {
  fr: {
    sousTitre: 'clé USB · mode texte', graphique: 'Passer en mode graphique', disque: 'Démarrer sur le disque du PC',
    demarreDans: '{nom} démarre dans {s} s', aideAttente: 'Échap : choisir moi-même   (puis G : mode graphique)',
    viaListe: 'Ce système démarre depuis la liste complète de la clé : appuie sur Échap, puis choisis-le.',
    pasDeGraphique: 'Le mode graphique n\'est pas sur cette clé. Appuie sur Échap puis sur F7.',
    pasDeDisque: 'Aucun système trouvé sur le disque du PC.', refuse: 'Le menu texte refuse le nom de ce fichier : choisis-le dans la liste complète.',
  },
  en: {
    sousTitre: 'USB key · text mode', graphique: 'Switch to graphical mode', disque: 'Boot from the PC disk',
    demarreDans: '{nom} starts in {s} s', aideAttente: 'Esc: let me choose   (then G: graphical mode)',
    viaListe: 'This system starts from the full list of the key: press Esc, then choose it.',
    pasDeGraphique: 'Graphical mode is not on this key. Press Esc, then F7.',
    pasDeDisque: 'No system found on the PC disk.', refuse: 'The text menu refuses this file name: choose it in the full list.',
  },
  es: {
    sousTitre: 'llave USB · modo texto', graphique: 'Pasar al modo gráfico', disque: 'Arrancar desde el disco del PC',
    demarreDans: '{nom} arranca en {s} s', aideAttente: 'Esc: elegir yo   (luego G: modo gráfico)',
    viaListe: 'Este sistema arranca desde la lista completa de la llave: pulsa Esc y elígelo.',
    pasDeGraphique: 'El modo gráfico no está en esta llave. Pulsa Esc y luego F7.',
    pasDeDisque: 'No hay ningún sistema en el disco del PC.', refuse: 'El menú de texto rechaza este nombre de archivo: elígelo en la lista completa.',
  },
  de: {
    sousTitre: 'USB-Stick · Textmodus', graphique: 'In den Grafikmodus wechseln', disque: 'Von der Festplatte des PCs starten',
    demarreDans: '{nom} startet in {s} s', aideAttente: 'Esc: selbst wählen   (dann G: Grafikmodus)',
    viaListe: 'Dieses System startet aus der vollständigen Liste des Sticks: Esc drücken und es wählen.',
    pasDeGraphique: 'Der Grafikmodus ist nicht auf diesem Stick. Esc drücken, dann F7.',
    pasDeDisque: 'Kein System auf der Festplatte des PCs gefunden.', refuse: 'Das Textmenü lehnt diesen Dateinamen ab: in der vollständigen Liste wählen.',
  },
  it: {
    sousTitre: 'chiavetta USB · modalità testo', graphique: 'Passa alla modalità grafica', disque: 'Avvia dal disco del PC',
    demarreDans: '{nom} si avvia tra {s} s', aideAttente: 'Esc: scelgo io   (poi G: modalità grafica)',
    viaListe: 'Questo sistema si avvia dall\'elenco completo della chiavetta: premi Esc, poi sceglilo.',
    pasDeGraphique: 'La modalità grafica non è su questa chiavetta. Premi Esc, poi F7.',
    pasDeDisque: 'Nessun sistema trovato sul disco del PC.', refuse: 'Il menu testo rifiuta questo nome di file: sceglilo nell\'elenco completo.',
  },
  pt: {
    sousTitre: 'pen USB · modo texto', graphique: 'Mudar para o modo gráfico', disque: 'Arrancar pelo disco do PC',
    demarreDans: '{nom} arranca em {s} s', aideAttente: 'Esc: escolho eu   (depois G: modo gráfico)',
    viaListe: 'Este sistema arranca a partir da lista completa da pen: carrega em Esc e escolhe-o.',
    pasDeGraphique: 'O modo gráfico não está nesta pen. Carrega em Esc e depois em F7.',
    pasDeDisque: 'Nenhum sistema encontrado no disco do PC.', refuse: 'O menu de texto recusa este nome de ficheiro: escolhe-o na lista completa.',
  },
};

/** Les langues dont les phrases du menu ne sont pas encore fournies, et la langue montrée en attendant. */
export const LANGUES_EN_ATTENTE: Record<string, string> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, { swb: 'fr', buc: 'fr', shimaore: 'fr', kibushi: 'fr' }));

/** Les textes d'une langue, rendus sûrs pour le chargeur (ASCII). Langue absente du dictionnaire : l'anglais. Pur. */
export function textesMenuTexte(langue?: string): Record<CleTexte, string> {
  const brute = String(langue ?? '').toLowerCase().split(/[-_]/)[0];
  // Shimaoré (swb) et kibushi (buc) : leurs phrases viendront du propriétaire (jamais inventées) ; en attendant, le
  // français, la langue écrite qu'on lit autour d'eux.
  const l = LANGUES_EN_ATTENTE[brute] ?? brute;
  // (relecture C7 : seules les vraies langues du dictionnaire ; « constructor », « __proto__ »… ne cassent plus rien)
  const src = Object.hasOwn(TEXTES_MENU_TEXTE, l) ? TEXTES_MENU_TEXTE[l] : TEXTES_MENU_TEXTE.en;
  const out = {} as Record<CleTexte, string>;
  for (const k of Object.keys(src) as CleTexte[]) out[k] = asciiMenu(src[k].replace(/\{nom\}/g, '@NOM@').replace(/\{s\}/g, '@S@'), ' .,:!?()+_/#=%*[]\'-@');
  return out;
}

/** Une chaîne entre guillemets doubles pour GRUB : rien d'autre que de l'ASCII sûr (asciiMenu filtre tout le reste). */
const q = (s: string) => `"${asciiMenu(s, undefined, false).trimEnd()}"`;

/**
 * Odin FIGÉ en caractères (5 lignes) : un corps aux coins arrondis à la couleur du thème, deux yeux blancs en
 * pastille, ni bouche, ni sourcils, ni joues. GRUB change de couleur entre deux bouts d'une même ligne (echo -n). Pur.
 */
function odinFige(corps: string, normal: string): string[] {
  const C = `${corps}/${corps}`, Y = 'white/white', fond = 'black/black';
  const seg = (couleur: string, n: number) => [`set color_normal=${couleur}`, `echo -n "${' '.repeat(n)}"`];
  const ligne = (...parts: Array<[string, number]>) => [...parts.flatMap(([c, n]) => seg(c, n)), `set color_normal=${normal}`, 'echo ""'];
  return [
    ...ligne([fond, 6], [C, 10]),
    ...ligne([fond, 4], [C, 14]),
    ...ligne([fond, 4], [C, 3], [Y, 2], [C, 4], [Y, 2], [C, 3]),
    ...ligne([fond, 4], [C, 14]),
    ...ligne([fond, 6], [C, 10]),
  ];
}

/**
 * Le menu texte complet (le contenu de /ventoy/ventoy_grub.cfg) pour une préparation. Pur.
 *  - en tête : Odin figé, « O D I N », la ligne du mode, aux couleurs du thème texte choisi ;
 *  - les entrées numérotées dans l'ORDRE CHOISI, avec les MÊMES NOMS que le menu graphique (entreesMenuCle) ;
 *  - « G · Passer en mode graphique », « D · Démarrer sur le disque du PC », puis la liste complète de Ventoy ;
 *  - l'attente : chaque seconde la barre « [####....] » et « X démarre dans N s » ; Échap l'arrête ; à la fin, l'entrée
 *    par défaut démarre (le système par défaut, sinon le disque du PC : jamais un installateur choisi au hasard) ;
 *    délai 0 = on attend qu'on choisisse.
 * `graphique` : le chemin sur la clé de l'image du mode graphique (lot C6), quand elle existe. `installes` : les
 * entrées GRUB des Linux installés (cle-install.ts, déjà rendues sûres), gardées dans le même fichier.
 */
export function buildMenuTexte(prep: PreparationCle, o: { graphique?: string; installes?: string[] } = {}): string {
  // (relecture C7 : un thème texte inconnu prend le thème par défaut au lieu de casser l'écriture)
  const texte = textThemeOf(prep.texte);
  const { delai, langue } = reglagesDemarrage(prep);
  const t = textesMenuTexte(langue);
  const col = couleursMenuTexte(texte);
  const entrees = entreesMenuCle(prep);
  const parDefaut = entrees.find((e) => e.defaut);
  const idDefaut = parDefaut ? `odin-${parDefaut.numero}` : 'odin-disque';
  const nomDefaut = parDefaut ? parDefaut.nomTexte : t.disque;
  const graphique = o.graphique && /^\/[A-Za-z0-9][A-Za-z0-9._+/-]{0,200}$/.test(o.graphique) && !o.graphique.includes('..') ? o.graphique : '';
  const sep = '-'.repeat(58);

  const L: string[] = [
    `# Odin - Genese : le menu TEXTE de la cle ODIN (theme ${asciiMenu(couleurs(texte).label)}), ouvert par Ventoy (touche F6).`,
    '# Fichier fabrique par Odin : les noms sont filtres (ASCII, aucun signe du chargeur). Rien de personnel ici.',
    'terminal_output console',
    `set menu_color_normal=${col.normal}`,
    `set menu_color_highlight=${col.choisi}`,
    `set color_normal=${col.normal}`,
    '',
    '# En-tete : Odin fige (yeux seuls), le nom, le mode.',
    'function odin_entete {',
    '  clear',
    ...odinFige(col.corps, col.normal).map((x) => '  ' + x),
    `  set color_normal=${col.titre}`,
    '  echo "    O D I N"',
    `  set color_normal=${col.discret}`,
    `  echo ${q('    ' + t.sousTitre)}`,
    `  echo "${sep}"`,
    `  set color_normal=${col.normal}`,
    '}',
    '',
    '# Ecran d attente : l en-tete, la liste dans l ordre choisi, les deux entrees de plus.',
    'function odin_ecran {',
    '  odin_entete',
    ...entrees.map((e) => `  echo ${q(' ' + titreEntreeTexte(e))}`),
    `  set color_normal=${col.discret}`,
    `  echo ${q(' G  ' + t.graphique)}`,
    `  echo ${q(' D  ' + t.disque)}`,
    `  echo "${sep}"`,
    `  set color_normal=${col.normal}`,
    '}',
    '',
    '# Demarrer un systeme de la cle : les ISO Linux qui savent demarrer d un fichier (loopback.cfg) demarrent ici ;',
    '# les autres (Windows...) demarrent depuis la liste complete de Ventoy, ou elles portent le meme nom.',
    'function odin_demarrer {',
    '  if loopback odinloop "${vtoy_iso_part}${odin_iso}"; then',
    '    if [ -f (odinloop)/boot/grub/loopback.cfg ]; then',
    '      set iso_path="${odin_iso}"',
    '      export iso_path',
    '      set root=(odinloop)',
    '      configfile (odinloop)/boot/grub/loopback.cfg',
    '    fi',
    '    loopback -d odinloop',
    '  fi',
    `  echo ${q(t.viaListe)}`,
    '  sleep 4',
    '}',
    '',
    '# Demarrer sur le disque du PC : le premier disque qui n est pas la cle ODIN (UEFI : son chargeur ; BIOS : son',
    '# secteur de demarrage). Rien n est ecrit sur aucun disque.',
    'function odin_disque {',
    '  if [ -n "${vtoydev}" ]; then',
    '  for d in hd0 hd1 hd2 hd3 hd4 hd5; do',
    '    if [ "${d}" != "${vtoydev}" ]; then',
    '      if [ "${grub_platform}" = "efi" ]; then',
    '        for p in 1 2 3 4 5 6; do',
    '          for f in /EFI/Microsoft/Boot/bootmgfw.efi /EFI/ubuntu/shimx64.efi /EFI/debian/shimx64.efi /EFI/fedora/shimx64.efi /EFI/BOOT/BOOTX64.EFI; do',
    '            if [ -f "(${d},${p})${f}" ]; then',
    '              chainloader "(${d},${p})${f}"',
    '              boot',
    '            fi',
    '          done',
    '        done',
    '      else',
    '        if [ -e "(${d})" ]; then',
    '          set root="(${d})"',
    '          chainloader +1',
    '          boot',
    '        fi',
    '      fi',
    '    fi',
    '  done',
    '  fi',
    `  echo ${q(t.pasDeDisque)}`,
    '  sleep 4',
    '}',
    '',
  ];

  // L'attente, déroulée seconde par seconde (GRUB ne sait pas compter) : barre en caractères, Échap l'arrête.
  if (delai > 0) {
    L.push('# Attente : chaque seconde, la barre et le compte a rebours ; Echap arrete l attente et montre le menu.', 'set odin_attente=oui');
    for (let s = delai; s >= 1; s--) {
      const pct = Math.round(((delai - s) / delai) * 100);
      const barre = barreTexte(texte, pct, 24).replace(/\s+\d+%$/, '');
      const ligne = `${t.demarreDans.replace('@NOM@', nomDefaut).replace('@S@', String(s))}  ${barre}`;
      L.push('if [ "${odin_attente}" = "oui" ]; then', '  odin_ecran', `  echo ${q(ligne)}`, `  echo ${q(t.aideAttente)}`,
        '  if sleep --interruptible 1; then set odin_attente=oui; else set odin_attente=non; fi', 'fi');
    }
    L.push('if [ "${odin_attente}" = "oui" ]; then set timeout=0; else set timeout=-1; fi');
  } else {
    L.push('# Delai 0 : pas de demarrage tout seul, on attend qu on choisisse.', 'set timeout=-1');
  }
  L.push(`set default=${idDefaut}`, '', '# Le menu : les systemes dans l ordre choisi (touches 1 a 9), puis G et D.');

  for (const e of entrees) {
    const hk = e.numero <= 9 ? ` --hotkey=${e.numero}` : '';
    L.push(`menuentry ${q(titreEntreeTexte(e))} --id odin-${e.numero}${hk} --class odin {`);
    if (e.chemin) L.push(`  set odin_iso="${e.chemin}"`, '  odin_demarrer');
    else L.push(`  echo ${q(t.refuse)}`, '  sleep 4');
    L.push('}');
  }
  L.push(`menuentry ${q(' G  ' + t.graphique)} --id odin-graphique --hotkey=g --class odin {`);
  if (graphique) L.push(`  set odin_iso="${graphique}"`, '  odin_demarrer');
  else L.push(`  echo ${q(t.pasDeGraphique)}`, '  sleep 4');
  L.push('}');
  L.push(`menuentry ${q(' D  ' + t.disque)} --id odin-disque --hotkey=d --class odin {`, '  odin_disque', '}');
  // Relecture C7 : l'entrée au titre FIXE que vise ventoy.json en mode texte (« F6>ODIN ») ; elle relit ce menu (attente
  // comprise). Ventoy choisit « F6>… » par le titre exact : un titre qui change (langue, numéro) ne serait jamais trouvé.
  L.push(`menuentry "${TITRE_ENTREE_ODIN}" --id odin-menu --hotkey=o --class odin {`, '  configfile "${vtoy_iso_part}/ventoy/ventoy_grub.cfg"', '}');
  // La liste complète de Ventoy (son entrée de retour documentée : nom VTOY_RET, classe vtoyret).
  L.push('menuentry "VTOY_RET" --class=vtoyret {', '  echo ""', '}');
  for (const x of o.installes ?? []) L.push('', x);
  L.push('');
  return L.join('\n');
}
