// La grille de 12 colonnes de l'accueil (lot 14 de la maquette validée « Accueil et Home Assistant »).
// Les calculs sont dans src/web/pages/accueil-grille.js, lu ici sans document (il ne doit rien toucher à son
// chargement) : largeur d'un module au téléphone, bornes, pas d'une case, rang d'insertion, et `c` et `w` qui restent
// d'accord après un changement (sinon Hestia, dans cleanLayout, remettrait `c` d'après `w`). Puis la lecture de
// fenetre.js : la fenêtre se dessine bien avec cette grille, sans rien perdre de ce qu'elle savait faire.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { GRILLE as GRILLE_HESTIA, TAILLE_SORTE, cleanLayout, largeurAncienne as ancienneHestia, type Widget } from '../src/valhalla/modules/gladsheim.ts';

type W = Record<string, unknown>;
interface Grille {
  GRILLE: Record<string, number>; MINI: Record<string, [number, number]>; HAUTEUR: Record<string, number>;
  appareil: (l: unknown) => string; taille: (w: W) => { c: number; r: number; pc?: number; pr?: number };
  largeurTel: (w: W) => number; hauteurTel: (w: W) => number | null; hauteurPx: (r: number, tel?: boolean) => number;
  colonne: (l: number, tel?: boolean) => number; cases: (d: number, pas: number, ecart: number) => number;
  apres: (x: number, y: number, r: { left: number; width: number; bottom: number; height: number }) => boolean;
  rang: (a: number, b: number, apres: boolean) => number; largeurAncienne: (c: number) => number;
  changer: (w: W, n: W) => W; agrandir: (w: W) => number; nouvelId: (pris: string[]) => string; style: (w: W) => string; css: (g: string, c: string) => string;
}
const SRC = readFileSync(new URL('../src/web/pages/accueil-grille.js', import.meta.url), 'utf8');
const FE = readFileSync(new URL('../src/web/fenetre.js', import.meta.url), 'utf8');
function charger(): Grille {
  const win: { OdinGrille?: Grille } = {};
  vm.runInNewContext(SRC, { window: win }); // ni document, ni fetch, ni localStorage : rien ne doit s'exécuter d'autre
  assert.ok(win.OdinGrille, 'window.OdinGrille est posé');
  // Les objets rendus viennent d'un autre contexte : ils sont recopiés pour être comparés.
  const ici = (x: unknown) => (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x);
  const g = win.OdinGrille as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, typeof v === 'function' ? (...a: unknown[]) => ici((v as (...x: unknown[]) => unknown)(...a)) : ici(v)])) as unknown as Grille;
}
const G = charger();
const IDS = ['gladsheim', 'midgard', 'vidarr'];
/** Un module passé par Hestia (cleanLayout), comme à « Terminé ». */
const parHestia = (w: W) => cleanLayout({ pages: [{ name: 'P', widgets: [w] }] }, IDS).pages[0].widgets[0] as Widget;

test('grille : les mesures de la maquette (12 colonnes, 4 au téléphone, 74/14 px, 84/12 px, seuils 700 et 1100)', () => {
  const g = G.GRILLE;
  assert.equal(g.colonnes, 12); assert.equal(g.colonnesTel, 4); assert.equal(g.lignesMax, 7);
  assert.equal(g.ligne, 74); assert.equal(g.ecart, 14); assert.equal(g.ligneTel, 84); assert.equal(g.ecartTel, 12);
  assert.equal(g.telephone, 700); assert.equal(g.ordinateur, 1100);
  // Les mêmes bornes que chez Hestia, et les mêmes tailles par sorte.
  assert.equal(g.colonnes, GRILLE_HESTIA.colonnes); assert.equal(g.colonnesTel, GRILLE_HESTIA.colonnesTel); assert.equal(g.lignesMax, GRILLE_HESTIA.lignesMax);
  for (const [kind, t] of Object.entries(TAILLE_SORTE)) {
    assert.deepEqual([...G.MINI[kind]], t.mini, `${kind} : même mini que chez Hestia`);
    assert.equal(G.HAUTEUR[kind], t.r, `${kind} : même hauteur de départ que chez Hestia`);
  }
  for (let c = 1; c <= 12; c++) assert.equal(G.largeurAncienne(c), ancienneHestia(c), `largeur ancienne de ${c}`);
  // L'appareil d'après la largeur : 700 et moins = téléphone ; 1100 et plus = ordinateur.
  assert.equal(G.appareil(390), 'telephone'); assert.equal(G.appareil(700), 'telephone'); assert.equal(G.appareil(701), 'tablette');
  assert.equal(G.appareil(1099), 'tablette'); assert.equal(G.appareil(1100), 'ordinateur'); assert.equal(G.appareil(1280), 'ordinateur');
  assert.equal(G.appareil(undefined), 'ordinateur'); assert.equal(G.appareil(-3), 'ordinateur');
  // La hauteur de r lignes : r × 74 + (r − 1) × 14 ; au téléphone r × 84 + (r − 1) × 12.
  assert.equal(G.hauteurPx(1), 74); assert.equal(G.hauteurPx(2), 162); assert.equal(G.hauteurPx(7), 7 * 74 + 6 * 14);
  assert.equal(G.hauteurPx(1, true), 84); assert.equal(G.hauteurPx(3, true), 3 * 84 + 2 * 12);
});

test('grille : la largeur d\'un module au téléphone (moitié pour 1 ou 2 colonnes, sinon toute la largeur ; pc à part)', () => {
  assert.equal(G.largeurTel({ kind: 'heure', c: 2 }), 2, '2 colonnes sur 12 : la moitié du téléphone');
  for (const c of [3, 4, 6, 8, 12]) assert.equal(G.largeurTel({ kind: 'heure', c }), 4, `${c} colonnes : toute la largeur`);
  assert.equal(G.largeurTel({ kind: 'heure', c: 1 }), 2, 'plus petit que la mini : ramené à 2, donc la moitié');
  assert.equal(G.largeurTel({ kind: 'heure', w: 1 }), 4, 'un ancien module (w = 1, soit 4 sur 12) : toute la largeur, comme aujourd\'hui');
  assert.equal(G.largeurTel({ kind: 'heure', c: 12, pc: 2 }), 2, 'pc réglé : il l\'emporte');
  assert.equal(G.largeurTel({ kind: 'heure', c: 2, pc: 4 }), 4);
  assert.equal(G.largeurTel({ kind: 'heure', c: 4, pc: 9 }), 4, 'pc trop grand : 4');
  assert.equal(G.largeurTel({ kind: 'heure', c: 4, pc: 1 }), 2, 'pc trop petit : 2');
  assert.equal(G.hauteurTel({ kind: 'section', c: 4, r: 5 }), null, 'sans pr : la hauteur de son contenu');
  assert.equal(G.hauteurTel({ kind: 'section', c: 4, pr: 4 }), 4);
  assert.equal(G.hauteurTel({ kind: 'section', c: 4, pr: 1 }), 2, 'pr plus petit que la mini de la sorte : la mini');
  // Le style d'une carte porte les deux tailles ; la règle de css() choisit selon l'écran.
  assert.equal(G.style({ kind: 'heure', c: 2, r: 1 }), '--c:2;--r:1;--pc:2;--pr:auto;--pmin:150px');
  assert.equal(G.style({ kind: 'meteo', c: 6, r: 4, pc: 4, pr: 3 }), '--c:6;--r:4;--pc:4;--pr:span 3;--pmin:0px');
});

test('grille : bornes (de la mini de la sorte à 12 colonnes et 7 lignes ; valeurs fausses ignorées)', () => {
  assert.deepEqual(G.taille({ kind: 'heure', c: 40, r: 30 }), { c: 12, r: 7 });
  assert.deepEqual(G.taille({ kind: 'meteo', c: 1, r: 1 }), { c: 3, r: 2 }, 'plus petit que la mini de la météo');
  assert.deepEqual(G.taille({ kind: 'heure', c: -4, r: 0 }), { c: 2, r: 1 });
  assert.deepEqual(G.taille({ kind: 'chiffres', w: 2 }), { c: 8, r: 2 }, 'ancien module : c = w × 4, la hauteur de départ');
  assert.deepEqual(G.taille({ kind: 'section', w: 3 }), { c: 12, r: 3 });
  assert.deepEqual(G.taille({ kind: 'heure' }), { c: 4, r: 2 }, 'rien du tout : 4 colonnes (l\'ancienne largeur 1)');
  for (const faux of ['6', 4.5, Number.NaN, Number.POSITIVE_INFINITY, null, true, {}, [6]]) {
    assert.deepEqual(G.taille({ kind: 'chiffres', w: 1, c: faux, r: faux, pc: faux, pr: faux }), { c: 4, r: 2 }, `valeur fausse ${String(faux)}`);
  }
  // Chaque taille bornée ici est la même que celle qu'Hestia garde (pas de saut à « Terminé »).
  for (const kind of Object.keys(TAILLE_SORTE)) for (const c of [0, 1, 2, 3, 5, 7, 12, 13]) for (const r of [0, 1, 4, 7, 9]) {
    const w = { kind, c, r, w: G.largeurAncienne(Math.max(c, 1)), ...(kind === 'meteo' || kind === 'heure' ? {} : { module: 'vidarr' }), ...(kind === 'section' ? { section: 'S' } : {}), ...(kind === 'bouton' ? { action: 'a' } : {}) };
    if (kind === 'site') continue; // un site surveillé n'existe qu'avec Pulsar (essayé dans fenetre-grille)
    const t = G.taille({ ...w }), h = parHestia({ ...w, ...G.changer({ ...w }, {}) });
    assert.equal(h.c, t.c, `${kind} c=${c} r=${r} : même largeur`); assert.equal(h.r, t.r, `${kind} c=${c} r=${r} : même hauteur`);
  }
});

test('grille : le pas d\'une case (un geste avance case par case, arrondi à la plus proche)', () => {
  const col = G.colonne(12 * 80 + 11 * 14); // une grille de 1 114 px : des colonnes de 80 px
  assert.equal(col, 80);
  assert.equal(G.colonne(4 * 80 + 3 * 12, true), 80, 'au téléphone : 4 colonnes, écart de 12 px');
  const pas = (d: number) => G.cases(d, col, G.GRILLE.ecart);
  assert.equal(pas(0), 0); assert.equal(pas(30), 0, 'moins d\'une demi-case : rien');
  assert.equal(pas(47), 1, 'plus d\'une demi-case (94 / 2) : une case'); assert.equal(pas(94), 1); assert.equal(pas(94 * 3), 3);
  assert.equal(pas(-94), -1, 'vers la gauche'); assert.equal(pas(-30), 0);
  assert.equal(G.cases(100, 0, 0), 0, 'une grille sans largeur ne bouge rien'); assert.equal(G.cases(Number.NaN, 80, 14), 0);
  // Les hauteurs, ligne par ligne : 74 + 14.
  assert.equal(G.cases(88, G.GRILLE.ligne, G.GRILLE.ecart), 1); assert.equal(G.cases(88 * 2 + 10, G.GRILLE.ligne, G.GRILLE.ecart), 2);
});

test('grille : le rang d\'insertion (moitié gauche : avant, moitié droite ou bas de la carte : après)', () => {
  const r = { left: 100, width: 200, bottom: 300, height: 160 };
  assert.equal(G.apres(150, 200, r), false, 'moitié gauche'); assert.equal(G.apres(250, 200, r), true, 'moitié droite');
  assert.equal(G.apres(150, 295, r), true, 'tout en bas de la carte (une carte pleine largeur au téléphone)');
  assert.equal(G.apres(150, 200, { left: 0, width: 0, bottom: 0, height: 0 }), false);
  /** La liste après avoir mis l'élément `a` au rang rendu. */
  const poser = (l: string[], a: number, b: number, ap: boolean) => { const to = G.rang(a, b, ap), x = l.slice(); const [m] = x.splice(a, 1); x.splice(to, 0, m); return x.join(''); };
  const l = ['A', 'B', 'C', 'D'];
  assert.equal(poser(l, 0, 2, false), 'BACD', 'A lâché avant C'); assert.equal(poser(l, 0, 2, true), 'BCAD', 'A lâché après C');
  assert.equal(poser(l, 3, 1, false), 'ADBC', 'D lâché avant B'); assert.equal(poser(l, 3, 1, true), 'ABDC', 'D lâché après B');
  assert.equal(poser(l, 0, 3, true), 'BCDA', 'A lâché après le dernier');
  assert.equal(G.rang(1, 2, false), 1, 'lâché juste avant son voisin suivant : ne bouge pas');
  assert.equal(G.rang(2, 1, true), 2, 'lâché juste après son voisin précédent : ne bouge pas');
  assert.equal(G.rang(2, 2, true), 2, 'sur lui-même : ne bouge pas'); assert.equal(G.rang(-1, 2, true), -1, 'introuvable : rien');
});

test('grille : `c` et `w` restent d\'accord après un changement (Hestia garde la nouvelle largeur)', () => {
  const w: W = { id: 'aaaaaaaa', kind: 'chiffres', module: 'vidarr', w: 1, c: 4, r: 2 };
  assert.deepEqual(G.changer(w, { c: 9 }), { c: 9, r: 2, w: 3 }); assert.equal(w.c, 9); assert.equal(w.w, 3, 'w suit c');
  assert.equal(parHestia(w).c, 9, 'Hestia garde 9 (sans w à jour, elle aurait remis 4)');
  // Le contre-essai : c changé seul, w oublié → Hestia remet c d'après w. C'est ce que changer() évite.
  assert.equal(parHestia({ ...w, c: 6, w: 3 }).c, 12);
  // Le bouton « Taille » : 4 → 8 → 12 → 4, c et w toujours d'accord, et gardés tels quels par Hestia.
  const b: W = { id: 'bbbbbbbb', kind: 'heure', w: 1, c: 4, r: 2 };
  for (const [c, ww] of [[8, 2], [12, 3], [4, 1], [8, 2]]) {
    assert.equal(G.agrandir(b), ww); assert.equal(b.c, c); assert.equal(b.w, ww);
    assert.equal(parHestia(b).c, c, `Hestia garde ${c}`);
  }
  // Une largeur entre deux (6) passe à la suivante (8) ; une sorte plus large que 4 au départ garde sa mini.
  const m: W = { kind: 'meteo', c: 6, r: 3, w: 2 }; assert.equal(G.agrandir(m), 2); assert.equal(m.c, 8);
  // La taille du téléphone se change à part, sans toucher l'ordinateur, et se retire.
  const t: W = { kind: 'section', module: 'vidarr', section: 'S', c: 8, r: 3, w: 2 };
  G.changer(t, { pc: 2, pr: 4 }); assert.deepEqual([t.c, t.w, t.pc, t.pr], [8, 2, 2, 4]);
  const h = parHestia(t); assert.deepEqual([h.c, h.w, h.pc, h.pr], [8, 2, 2, 4], 'Hestia garde les deux tailles');
  G.changer(t, { pc: undefined }); assert.equal('pc' in t, false, 'pc retiré : le téléphone choisit');
});

test('grille : une largeur qui ne va pas avec `w` suit `w`, comme chez Hestia (l\'écran montre ce que « Terminé » garde)', () => {
  // Relecture : avant, l'écran montrait c = 6 pour { c: 6, w: 3 } et Hestia gardait 12 (la carte sautait à « Terminé »).
  for (const kind of ['heure', 'meteo', 'chiffres', 'section']) for (let c = 1; c <= 12; c++) for (const ww of [1, 2, 3]) {
    const w = { kind, c, r: 3, w: ww, ...(kind === 'meteo' || kind === 'heure' ? {} : { module: 'vidarr' }), ...(kind === 'section' ? { section: 'S' } : {}) };
    assert.equal(G.taille({ ...w }).c, parHestia({ ...w }).c, `${kind} c=${c} w=${ww}`);
  }
  assert.equal(G.taille({ kind: 'heure', c: 6, w: 3 }).c, 12);
  assert.equal(G.taille({ kind: 'heure', c: 6, w: '2' }).c, 6, 'w écrit en texte : lu comme chez Hestia');
  // Un changement de largeur l'emporte sur l'ancienne w, et w le suit.
  const x: W = { kind: 'heure', c: 4, w: 1 }; G.changer(x, { c: 10 }); assert.deepEqual([x.c, x.w], [10, 3]);
  const y: W = { kind: 'heure', c: 8, w: 2 }; G.changer(y, { c: 'dix' }); assert.deepEqual([y.c, y.w], [8, 2], 'largeur fausse : rien ne change');
  G.changer(y, { pr: 3 }); assert.deepEqual([y.c, y.w, y.pr], [8, 2, 3], 'la hauteur du téléphone seule : la largeur reste');
});

test('grille : un module ajouté reçoit un identifiant neuf (Retirer, les flèches et le glisser ne confondent plus deux modules)', () => {
  const pris = ['aaaaaaaa', 'bbbbbbbb'], vus = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const id = G.nouvelId([...pris, ...vus]);
    assert.match(id, /^[0-9a-f]{8}$/, 'la forme qu\'Hestia garde'); assert.ok(!pris.includes(id) && !vus.has(id), 'pris nulle part'); vus.add(id);
  }
  assert.match(G.nouvelId(undefined as unknown as string[]), /^[0-9a-f]{8}$/);
  const id = G.nouvelId([]); assert.equal(parHestia({ id, kind: 'heure', w: 1 }).id, id, 'Hestia le garde tel quel à « Terminé »');
  // La fenêtre s'en sert pour chaque module ajouté (avant : id vide, et « ✕ » sur un module ajouté retirait tous les modules ajoutés).
  // Suit le code : `add` reçoit aussi `muet` (la fiche d'une appli dit elle-même « Posé »).
  // Suit la pose depuis le tiroir : `add` reçoit aussi ce qui suit la pose (`suite` : « Régler » aussitôt sur le choix).
  assert.match(FE, /function add\(w, muet = false, suite\) \{ page\(\)\.widgets\.push\(\{ w: 1, \.\.\.w, id: G\.nouvelId\(/);
  assert.doesNotMatch(FE, /widgets\.push\(\{ id: '', /);
});

test('grille : rien ne s\'exécute à son chargement (pas de document, pas de réseau, pas de stockage)', () => {
  for (const mot of ['document', 'fetch', 'localStorage', 'setTimeout', 'setInterval', 'addEventListener', 'innerHTML']) {
    assert.doesNotMatch(SRC, new RegExp(`\\b${mot}\\b`), `${mot} n'est pas dans accueil-grille.js`);
  }
  assert.match(SRC, /if \(window\.OdinGrille\) return;/, 'chargé deux fois : rien de plus');
  const css = G.css('.g', '.c');
  assert.match(css, /\.g\{display:grid;grid-template-columns:repeat\(12,minmax\(0,1fr\)\);grid-auto-rows:minmax\(74px,auto\);grid-auto-flow:row dense;gap:14px\}/);
  assert.match(css, /\.c\{grid-column:span var\(--c,4\);grid-row:span var\(--r,2\)/);
  assert.match(css, /@media \(max-width:700px\)\{\.g\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);grid-auto-rows:minmax\(84px,auto\);gap:12px\}\.c\{grid-column:span var\(--pc,4\);grid-row:var\(--pr,auto\);min-height:var\(--pmin,150px\)\}\}/);
});

test('fenêtre : dessinée dans la grille de 12 colonnes (et plus dans l\'ancienne de 3)', () => {
  assert.match(FE, /const G = window\.OdinGrille;/, 'fenetre.js lit la grille');
  assert.match(FE, /\$\{G\.css\('\.fe-grid', '\.fe-w'\)\}/, 'le style de la grille vient de accueil-grille.js');
  assert.doesNotMatch(FE, /repeat\(3,minmax\(0,1fr\)\)/, 'plus de grille de 3 colonnes');
  assert.doesNotMatch(FE, /max-width:760px/, 'plus de passage à une colonne à 760 px');
  assert.doesNotMatch(FE, /grid-column:span \$\{w\.w\}/, 'la carte ne prend plus sa largeur de w');
  assert.match(FE, /const box = el\('article', \{ class: 'fe-w', 'data-id': w\.id, style: G\.style\(w\) \}\);/, 'chaque carte .fe-w porte ses tailles');
  assert.match(FE, /onclick: \(\) => \{ w\.w = G\.agrandir\(w\); draw\(\); \}/, 'le bouton « Taille » change c et w ensemble');
  // Au clavier, le focus survit au nouveau dessin (avant : après « Taille », il retombait au début de la page).
  assert.match(FE, /const actif = document\.activeElement, carteActive = actif\?\.closest\?\.\('#feGrid \.fe-w'\)\?\.dataset\.id, nomActif = actif\?\.getAttribute\?\.\('aria-label'\);/);
  assert.match(FE, /n\.dataset\.id === carteActive\)\?\.querySelector\(`\[aria-label="\$\{CSS\.escape\(nomActif\)\}"\]`\)\?\.focus\(\);/);
  // Le contenu reste dans sa carte, même étroite (2 ou 3 colonnes sur une tablette de 701 px) : l'heure rapetisse,
  // la météo et ses heures passent à la ligne (vu à l'écran par le pilote de relecture).
  assert.match(FE, /\.fe-w\{container-type:inline-size\}@container \(max-width:130px\)\{\.fe-h\{flex-wrap:wrap\}\.fe-h \.fe-ic\{display:none\}\}/, 'carte très étroite : le titre passe sans l\'icône');
  assert.match(FE, /\.fe-clock-h\{font-size:clamp\(22px,24cqi,38px\)/);
  assert.match(FE, /\.fe-wx\{display:flex;flex-wrap:wrap;/); assert.match(FE, /\.fe-hours\{display:flex;flex-wrap:wrap;/);
  assert.doesNotMatch(FE, /w\.w = w\.w === 3/, 'plus de changement de w seul');
  assert.match(FE, /G\.rang\(a, cartes\.indexOf\(t\), G\.apres\(ev\.clientX, ev\.clientY, t\.getBoundingClientRect\(\)\)\)/, 'glisser : le rang d\'insertion vient de la grille');
  // La grille est chargée avant la fenêtre : les scripts de pages passent avant fenetre.js dans ui.html.
  const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  assert.ok(UI.indexOf('<!--PAGES-->') >= 0 && UI.indexOf('<!--PAGES-->') < UI.indexOf('src="/fenetre.js"'), 'pages/*.js avant fenetre.js');
});
