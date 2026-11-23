// Tirer le coin d'un module ; les sept tailles toutes faites (lot 15 de la maquette validée « Accueil et Home Assistant »).
// Les calculs sont dans src/web/pages/accueil-grille.js, lu ici sans document : une taille plus petite que la mini de
// la sorte est refusée, les sept tailles (Petit 2×1, Moyen 3×2, Large 4×2, Haut 3×4, Grand 4×4, Très grand 6×4,
// Bandeau 12×2), Maj + flèches, le téléphone de 2 à 4 colonnes, et `c` et `w` d'accord après chaque geste (passage
// par Hestia, cleanLayout, comme à « Terminé »). Puis la lecture de fenetre.js : le coin, l'étiquette, la liste, et le
// bouton « Taille » d'avant qui reste.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { TAILLE_SORTE, cleanLayout, largeurAncienne, type Widget } from '../src/valhalla/modules/gladsheim.ts';

type W = Record<string, unknown>;
type N = { c: number; r: number };
interface Grille {
  GRILLE: Record<string, number>; TAILLES: Array<{ nom: string; c: number; r: number }>;
  bornes: (kind: string, tel?: boolean) => { c: [number, number]; r: [number, number] };
  permise: (kind: string, n: N, tel?: boolean) => boolean; taillesPossibles: (kind: string) => Array<{ nom: string; c: number; r: number }>;
  tailleChoisie: (w: W) => string | null; depart: (w: W, tel?: boolean, hauteur?: number) => N;
  tirer: (w: W, dep: N, dx: number, dy: number, colonnePx: number, tel?: boolean) => N;
  pas: (w: W, touche: string, tel?: boolean, hauteur?: number) => N | null; etiquette: (n: N) => string; colonne: (l: number, tel?: boolean) => number;
  taille: (w: W) => { c: number; r: number; pc?: number; pr?: number };
}
const SRC = readFileSync(new URL('../src/web/pages/accueil-grille.js', import.meta.url), 'utf8');
const FE = readFileSync(new URL('../src/web/fenetre.js', import.meta.url), 'utf8');
const win: { OdinGrille?: Record<string, unknown> } = {};
vm.runInNewContext(SRC, { window: win }); // ni document, ni fetch : rien ne doit s'exécuter d'autre
const brut = win.OdinGrille as Record<string, (...a: unknown[]) => unknown>;
assert.ok(brut, 'window.OdinGrille est posé');
// Les objets rendus viennent d'un autre contexte : recopiés pour être comparés. `poser` et `choisir` changent le
// module sur place : ils sont appelés sur un module de l'autre contexte puis recopiés.
const ici = (x: unknown) => (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x);
const G = Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, typeof v === 'function' ? (...a: unknown[]) => ici(v(...a)) : ici(v)])) as unknown as Grille;
/** Pose une taille (ou choisit une taille toute faite) sur `w` : rend ce qui a changé et `w` après. */
function surPlace(nom: 'poser' | 'choisir', w: W, ...a: unknown[]): { rendu: unknown; w: W } {
  const la = vm.runInNewContext(`(${JSON.stringify(w)})`) as W;
  const rendu = ici(brut[nom](la, ...a));
  return { rendu, w: ici(la) as W };
}
const IDS = ['gladsheim', 'midgard', 'vidarr'];
/** Un module passé par Hestia (cleanLayout), comme à « Terminé ». */
const parHestia = (w: W) => cleanLayout({ pages: [{ name: 'P', widgets: [w] }] }, IDS).pages[0].widgets[0] as Widget;
const tailleDe = (w: W) => Object.fromEntries(['w', 'c', 'r', 'pc', 'pr'].filter((k) => w[k] !== undefined).map((k) => [k, w[k]]));

test('tailles : les sept tailles toutes faites de la maquette, dans son ordre', () => {
  assert.deepEqual(G.TAILLES.map((t) => [t.nom, t.c, t.r]), [['petit', 2, 1], ['moyen', 3, 2], ['large', 4, 2], ['haut', 3, 4], ['grand', 4, 4], ['tresGrand', 6, 4], ['bandeau', 12, 2]]);
  // Chacune se choisit sur un module qui l'accepte : c, r, et l'ancienne largeur w qui suit c.
  for (const t of G.TAILLES) {
    const { rendu, w } = surPlace('choisir', { id: 'aaaa0001', kind: 'chiffres', module: 'vidarr', w: 1, c: 4, r: 2 }, t.nom);
    assert.ok(rendu, `${t.nom} est acceptée par les chiffres clés`);
    assert.equal(w.c, t.c); assert.equal(w.r, t.r); assert.equal(w.w, largeurAncienne(t.c), `${t.nom} : w suit c`);
    assert.equal(G.tailleChoisie(w), t.nom, `${t.nom} : la liste la montre cochée`);
  }
  assert.equal(G.tailleChoisie({ kind: 'chiffres', c: 5, r: 3 }), null, 'une taille tirée à la main n\'est aucune des sept');
  assert.equal(surPlace('choisir', { kind: 'chiffres', c: 4, r: 2, w: 1 }, 'enorme').rendu, null, 'un code inconnu : rien');
  // Chaque code a son texte dans le dictionnaire de fenetre.js.
  const dico = FE.match(/tailles: \{ ([^}]+) \}/)?.[1] ?? '';
  for (const t of G.TAILLES) assert.match(dico, new RegExp(`\\b${t.nom}: '`), `texte de « ${t.nom} »`);
});

test('tailles : une taille plus petite que la mini de la sorte est refusée', () => {
  // La météo et une partie d'appli : 3 × 2 au moins (TAILLE_SORTE chez Hestia).
  for (const [kind, t] of Object.entries(TAILLE_SORTE)) {
    const b = G.bornes(kind);
    assert.deepEqual(b, { c: [t.mini[0], 12], r: [t.mini[1], 7] }, `${kind} : bornes d'après TAILLE_SORTE`);
    const possibles = G.taillesPossibles(kind).map((x) => x.nom);
    for (const x of G.TAILLES) assert.equal(possibles.includes(x.nom), x.c >= t.mini[0] && x.r >= t.mini[1], `${kind} / ${x.nom}`);
  }
  assert.deepEqual(G.taillesPossibles('meteo').map((x) => x.nom), ['moyen', 'large', 'haut', 'grand', 'tresGrand', 'bandeau'], 'Petit (2 × 1) n\'est pas proposé à la météo');
  const meteo = { id: 'aaaa0002', kind: 'meteo', w: 1, c: 4, r: 3 };
  const refus = surPlace('choisir', meteo, 'petit');
  assert.equal(refus.rendu, null, 'Petit est refusé pour la météo'); assert.deepEqual(tailleDe(refus.w), tailleDe(meteo), 'et rien ne change');
  for (const n of [{ c: 2, r: 3 }, { c: 4, r: 1 }, { c: 13, r: 3 }, { c: 4, r: 8 }, { c: 2.5, r: 3 }]) {
    const p = surPlace('poser', meteo, n);
    assert.equal(p.rendu, null, `${n.c} × ${n.r} refusé`); assert.deepEqual(tailleDe(p.w), tailleDe(meteo));
  }
  // Tirer le coin vers le haut à gauche : on s'arrête à la mini, jamais en dessous.
  const t = G.tirer(meteo, { c: 4, r: 3 }, -2000, -2000, 80);
  assert.deepEqual(t, { c: 3, r: 2 }, 'le coin s\'arrête à la mini de la météo');
  assert.deepEqual(G.tirer(meteo, { c: 4, r: 3 }, 5000, 5000, 80), { c: 12, r: 7 }, 'et au plus 12 × 7');
  // Au clavier : la mini, puis plus rien.
  assert.equal(G.pas({ kind: 'meteo', c: 3, r: 2, w: 1 }, 'ArrowLeft'), null, '← refusé à la mini');
  assert.equal(G.pas({ kind: 'meteo', c: 3, r: 2, w: 1 }, 'ArrowUp'), null, '↑ refusé à la mini');
});

test('tailles : tirer le coin, la taille saute de case en case', () => {
  const w = { kind: 'chiffres', c: 4, r: 2, w: 1 }, col = G.colonne(1200); // (1200 − 11 × 14) / 12 ≈ 87 px
  const pas = col + 14, ligne = 74 + 14;
  assert.deepEqual(G.depart(w), { c: 4, r: 2 });
  assert.deepEqual(G.tirer(w, { c: 4, r: 2 }, 0, 0, col), { c: 4, r: 2 }, 'sans bouger : rien');
  assert.deepEqual(G.tirer(w, { c: 4, r: 2 }, pas * 0.4, ligne * 0.4, col), { c: 4, r: 2 }, 'moins d\'une demi-case : rien');
  assert.deepEqual(G.tirer(w, { c: 4, r: 2 }, pas * 0.6, ligne * 0.6, col), { c: 5, r: 3 }, 'plus d\'une demi-case : une case');
  assert.deepEqual(G.tirer(w, { c: 4, r: 2 }, pas * 3, ligne * 2, col), { c: 7, r: 4 });
  assert.deepEqual(G.tirer(w, { c: 4, r: 2 }, -pas * 2, -ligne, col), { c: 2, r: 1 });
  assert.equal(G.etiquette({ c: 7, r: 4 }), '7 × 4', 'l\'étiquette « c × r »');
});

test('tailles : Maj + flèches (→ ← une colonne, ↓ ↑ une ligne)', () => {
  const w = { kind: 'chiffres', c: 4, r: 2, w: 1 };
  assert.deepEqual(G.pas(w, 'ArrowRight'), { c: 5, r: 2 });
  assert.deepEqual(G.pas(w, 'ArrowLeft'), { c: 3, r: 2 });
  assert.deepEqual(G.pas(w, 'ArrowDown'), { c: 4, r: 3 });
  assert.deepEqual(G.pas(w, 'ArrowUp'), { c: 4, r: 1 });
  assert.equal(G.pas(w, 'Enter'), null, 'une autre touche : rien');
  assert.equal(G.pas({ kind: 'chiffres', c: 12, r: 7 }, 'ArrowRight'), null, '→ refusé à 12 colonnes');
  assert.equal(G.pas({ kind: 'chiffres', c: 12, r: 7 }, 'ArrowDown'), null, '↓ refusé à 7 lignes');
  // Dans fenetre.js : sur la poignée, Maj + flèche change la taille AVANT que les flèches seules ne déplacent.
  const grip = FE.slice(FE.indexOf("const grip = el('button'"), FE.indexOf("grip.addEventListener('pointerdown'"));
  assert.match(grip, /onkeydown: \(e\) => \{ if \(e\.shiftKey\) \{ if \(tailleClavier\(w, e\.key, box\)\) e\.preventDefault\(\); return; \} if \(e\.key === 'ArrowLeft'/, 'Maj d\'abord, puis les flèches seules');
  const tc = FE.slice(FE.indexOf('function tailleClavier('), FE.indexOf('function tailles('));
  assert.match(tc, /G\.pas\(w, touche, tel, h\)/, 'la nouvelle taille vient de la grille');
  assert.match(tc, /if \(!n\) \{ dire\(TXT\.refusee\(/, 'refusée : elle est dite, rien ne change');
  assert.match(tc, /G\.poser\(w, n, tel\); dire\(TXT\.taille\(/, 'acceptée : posée et dite aux lecteurs d\'écran');
  assert.match(tc, /querySelector\('\.fe-grip'\)\?\.focus\(\)/, 'la poignée garde le focus');
});

test('tailles : au téléphone, de 2 à 4 colonnes (pc, pr), la taille de l\'ordinateur ne bouge pas', () => {
  for (const kind of Object.keys(TAILLE_SORTE)) assert.deepEqual(G.bornes(kind, true).c, [2, 4], `${kind} : 2 à 4 colonnes au téléphone`);
  assert.deepEqual(G.bornes('meteo', true).r, [2, 7], 'les lignes gardent la mini de la sorte');
  const w = { id: 'aaaa0003', kind: 'meteo', w: 2, c: 6, r: 3 }, col = G.colonne(358, true);
  assert.deepEqual(G.depart(w, true, 3 * 84 + 2 * 12), { c: 4, r: 3 }, 'sans pc ni pr : 4 colonnes, et la hauteur vue comptée en lignes');
  assert.deepEqual(G.depart({ ...w, pc: 2, pr: 5 }, true), { c: 2, r: 5 }, 'avec pc et pr : eux');
  assert.deepEqual(G.tirer(w, { c: 4, r: 3 }, -2000, 0, col, true), { c: 2, r: 3 }, 'pas moins de 2 colonnes');
  assert.deepEqual(G.tirer(w, { c: 2, r: 3 }, 2000, 0, col, true), { c: 4, r: 3 }, 'pas plus de 4');
  assert.deepEqual(G.tirer(w, { c: 4, r: 3 }, -(col + 12), 84 + 12, col, true), { c: 3, r: 4 }, 'une case du téléphone (colonne + 12 px, ligne de 84 + 12 px)');
  assert.equal(G.pas({ ...w, pc: 4 }, 'ArrowRight', true), null, '→ refusé à 4 colonnes');
  assert.equal(G.pas({ ...w, pc: 2, pr: 3 }, 'ArrowLeft', true), null, '← refusé à 2 colonnes');
  assert.deepEqual(G.pas({ ...w, pc: 2, pr: 3 }, 'ArrowRight', true), { c: 3, r: 3 });
  for (const n of [{ c: 1, r: 3 }, { c: 5, r: 3 }]) assert.equal(surPlace('poser', w, n, true).rendu, null, `${n.c} colonnes refusé au téléphone`);
  const p = surPlace('poser', w, { c: 2, r: 4 }, true);
  assert.equal(p.w.pc, 2); assert.equal(p.w.pr, 4);
  assert.equal(p.w.c, 6); assert.equal(p.w.r, 3); assert.equal(p.w.w, 2, 'la taille de l\'ordinateur ne bouge pas');
  // Dans fenetre.js : le téléphone est reconnu par la grille (700 px et moins).
  assert.match(FE, /const auTel = \(\) => G\.appareil\(innerWidth\) === 'telephone';/);
});

test('tailles : c et w restent d\'accord après chaque geste, et Hestia garde tout tel quel', () => {
  let w: W = { id: 'aaaa0004', kind: 'chiffres', module: 'vidarr', w: 1, c: 4, r: 2 };
  const gestes: Array<[string, (x: W) => { rendu: unknown; w: W }]> = [
    ['tirer 4 → 9 colonnes', (x) => surPlace('poser', x, G.tirer(x, G.depart(x), (G.colonne(1200) + 14) * 5, 0, G.colonne(1200)))],
    ['Maj + ←', (x) => surPlace('poser', x, G.pas(x, 'ArrowLeft'))],
    ['Maj + ↓', (x) => surPlace('poser', x, G.pas(x, 'ArrowDown'))],
    ['Bandeau', (x) => surPlace('choisir', x, 'bandeau')],
    ['Petit', (x) => surPlace('choisir', x, 'petit')],
    ['Très grand', (x) => surPlace('choisir', x, 'tresGrand')],
    ['téléphone : tirer à 2 colonnes', (x) => surPlace('poser', x, G.tirer(x, G.depart(x, true, 200), -1000, 0, G.colonne(358, true), true), true)],
    ['téléphone : Maj + →', (x) => surPlace('poser', x, G.pas(x, 'ArrowRight', true), true)],
    ['Moyen', (x) => surPlace('choisir', x, 'moyen')],
  ];
  for (const [nom, f] of gestes) {
    const g = f(w);
    assert.ok(g.rendu, `${nom} : accepté`);
    w = g.w;
    assert.equal(w.w, largeurAncienne(w.c as number), `${nom} : w = largeurAncienne(c)`);
    const h = parHestia(w);
    assert.deepEqual(tailleDe(h as unknown as W), tailleDe(w), `${nom} : Hestia garde la taille telle quelle`);
  }
  assert.deepEqual(tailleDe(w), { w: 1, c: 3, r: 2, pc: 3, pr: 2 });
});

test('tailles : fenetre.js pose le coin (44 px, mode Modifier), l\'étiquette « c × r », la liste, et garde « Taille »', () => {
  const css = FE.slice(FE.indexOf('const css = `'), FE.indexOf("document.head.append(el('style'"));
  assert.match(css, /\.fe-rz\{display:none\}\.fe-edit \.fe-rz\{display:block;position:absolute;right:0;bottom:0;width:44px;height:44px;[^}]*cursor:nwse-resize;touch-action:none/, 'le coin : 44 px, en mode Modifier seulement, au doigt aussi');
  assert.match(css, /\.fe-szb\{display:none;[^}]*\}\.fe-w\.resizing \.fe-szb\{display:block\}/, 'l\'étiquette se montre pendant le geste');
  const wd = FE.slice(FE.indexOf('async function widget('), FE.indexOf('function say('));
  assert.match(wd, /const rz = el\('span', \{ class: 'fe-rz', 'aria-hidden': 'true' \}\)/, 'le coin est caché aux lecteurs d\'écran (le clavier passe par la poignée)');
  assert.match(wd, /rz\.addEventListener\('pointerdown', \(e\) => startResize\(e, box, w, szb\)\);/, 'souris et doigt : pointerdown');
  assert.match(wd, /box\.append\(grip, chrome, rz, szb\);/, 'le coin et l\'étiquette sont posés sur la carte');
  // Le bouton « Taille » d'aujourd'hui reste, tant que le nouveau moyen n'est pas essayé par lui.
  assert.match(wd, /'aria-label': 'Changer la taille', onclick: \(\) => \{ w\.w = G\.agrandir\(w\); draw\(\); \}/, '« Taille » (4, 8, 12) est gardé');
  assert.match(wd, /'aria-label': TXT\.boutonTailles, onclick: \(\) => tailles\(w\)/, 'un bouton ouvre la liste des sept tailles');
  const sr = FE.slice(FE.indexOf('function startResize('), FE.indexOf('function tailleClavier('));
  assert.match(sr, /if \(!edit \|\| e\.button > 0 \|\| coinEnCours\) return;/, 'hors du mode Modifier, le coin ne fait rien');
  assert.match(sr, /G\.tirer\(w, dep, x\.clientX - x0, x\.clientY - y0, colonnePx, tel\)/, 'la taille vient de la grille, case par case');
  assert.match(sr, /G\.poser\(w, n, tel\); box\.setAttribute\('style', G\.style\(w\)\); szb\.textContent = G\.etiquette\(n\);/, 'la carte grandit et l\'étiquette suit');
  assert.match(sr, /const POINTEUR = \['pointermove', 'pointerup', 'pointercancel'\];/, 'un geste interrompu (doigt) se termine proprement');
  assert.doesNotMatch(sr, /regler_fenetre|act\(/, 'rien n\'est gardé avant « Terminé »');
  const tl = FE.slice(FE.indexOf('function tailles('), FE.indexOf('function add('));
  assert.match(tl, /G\.taillesPossibles\(w\.kind\)/, 'la liste ne propose que les tailles permises');
  assert.match(tl, /type: 'radio', name: 'feTaille'/, 'des boutons radio, comme dans la maquette');
  assert.match(tl, /if \(!G\.choisir\(w, v\)\) \{/, 'une taille refusée ne change rien');
  assert.match(css, /\.fe-sizes label\{[^}]*min-height:44px/, 'chaque choix fait 44 px de haut');
});

// Relecture du lot 15 : les gestes du coin qui cassaient (vus à l'écran) — un second doigt qui tirait la carte, Échap
// qui ne faisait rien, une souris relâchée hors de la fenêtre qui continuait de tirer au simple survol.
test('tailles : le geste du coin — un seul pointeur, Échap remet tout, une souris relâchée ailleurs finit', () => {
  const g = brut.geste as (id: number, ev: Record<string, unknown>) => string;
  assert.equal(typeof g, 'function', 'la grille dit que faire de chaque événement du geste');
  assert.equal(g(7, { type: 'pointermove', pointerId: 7, pointerType: 'touch', buttons: 1 }), 'suivre', 'le doigt du coin tire');
  assert.equal(g(7, { type: 'pointermove', pointerId: 8, pointerType: 'touch', buttons: 1 }), 'ignorer', 'un second doigt ne tire rien');
  assert.equal(g(7, { type: 'pointerup', pointerId: 8, pointerType: 'touch' }), 'ignorer', 'lever le second doigt ne finit pas le geste');
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) assert.equal(g(7, { type, pointerId: 7 }), 'finir', `${type} : le geste finit`);
  assert.equal(g(1, { type: 'pointermove', pointerId: 1, pointerType: 'mouse', buttons: 1 }), 'suivre');
  assert.equal(g(1, { type: 'pointermove', pointerId: 1, pointerType: 'mouse', buttons: 0 }), 'finir', 'souris sans bouton : relâchée hors de la fenêtre');
  assert.equal(g(1, { type: 'keydown', key: 'Escape' }), 'annuler', "Échap : la taille d'avant revient");
  assert.equal(g(1, { type: 'keydown', key: 'a' }), 'ignorer');
  assert.equal(g(1, { type: 'blur' }), 'annuler', "la fenêtre perd le focus : la taille d'avant revient");
  // memo / remettre : la taille revient telle quelle, une clé absente au départ est retirée (pas de pr inventé).
  const la = vm.runInNewContext('({ id: "aaaa0009", kind: "meteo", w: 1, c: 4, r: 3 })') as W;
  const m = brut.memo(la);
  brut.poser(la, { c: 2, r: 5 }, true); brut.poser(la, { c: 9, r: 6 });
  assert.deepEqual(tailleDe(ici(brut.remettre(la, m)) as W), { w: 1, c: 4, r: 3 });
  // Dans fenetre.js : un seul geste à la fois, le pointeur suivi par son numéro, Échap écouté avant tout le reste.
  const sr = FE.slice(FE.indexOf('function startResize('), FE.indexOf('function tailleClavier('));
  assert.match(sr, /if \(!edit \|\| e\.button > 0 \|\| coinEnCours\) return;/, 'un seul geste à la fois');
  assert.match(sr, /const quoi = G\.geste\(id, x\);/, 'chaque événement passe par la grille');
  assert.match(sr, /addEventListener\('keydown', ev, true\); addEventListener\('blur', ev\); rz\.addEventListener\('lostpointercapture', ev\);/);
  assert.match(sr, /if \(annule\) \{ G\.remettre\(w, avant\);/, "annulé : la taille d'avant, sans nouveau dessin");
});

test('tailles : la liste met le focus sur la taille cochée ; une carte étroite garde ses boutons hors de la poignée', () => {
  const tl = FE.slice(FE.indexOf('function tailles('), FE.indexOf('function add('));
  assert.match(tl, /\(radios\.querySelector\('input:checked'\) \?\? radios\.querySelector\('input'\)\)\?\.focus\(\);/, 'focus sur la taille cochée');
  assert.ok(tl.indexOf('?.focus();') > tl.indexOf('dialog(TXT.titreTailles'), "après l'ouverture du dialogue");
  // Quatre boutons de 30 px (↔, ⤡, ⚙, ✕) + la poignée ne tiennent pas sous 160 px de large : la règle étroite.
  // Contenu de la carte = largeur − 34 px (marges de 16 px et bordure) : 125 px de contenu, 159 px de carte.
  const css = FE.slice(FE.indexOf('const css = `'), FE.indexOf("document.head.append(el('style'"));
  const r = css.match(/@container \(max-width:(\d+)px\)\{\.fe-edit \.fe-chrome\{gap:2px\}\.fe-edit \.fe-chrome button\{width:24px;height:24px;[^}]*\}\.fe-edit \.fe-grip\{top:auto;bottom:-12px\}\}/);
  assert.ok(r, 'la règle des cartes étroites');
  assert.ok(Number(r[1]) + 34 >= 4 * 30 + 3 * 4 + 30 + 4 - 12, 'elle couvre toute carte où les boutons toucheraient la poignée');
  // « Petit » (2 × 1) met les chiffres clés sur 2 colonnes (78 px de carte vers 1000 px) : leurs cases ne débordent plus.
  assert.match(css, /\.fe-w \.va-kpis\{margin:0;grid-template-columns:repeat\(auto-fill,minmax\(min\(120px,100%\),1fr\)\)\}/, 'les cases des chiffres rétrécissent avec la carte');
  assert.ok(4 * 24 + 3 * 2 <= 94 + 12,'à 24 px, quatre boutons tiennent sur la plus étroite (2 colonnes à 1100 px : 94 px)');
});
