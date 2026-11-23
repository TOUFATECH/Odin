// Glisser un module de l'accueil (lot 16 de la maquette validée « Accueil »).
// Les calculs sont dans src/web/pages/accueil-gestes.js, lu ici sans document : le rang d'insertion (moitié gauche ou
// droite, haut ou bas), le délai de l'appui long, ce qui est gardé au lâcher (en mode Modifier : rien avant
// « Terminé » ; hors de ce mode : tout de suite, avec « Annuler » quelques secondes), un bouton ou un texte qui ne
// démarre pas de glisser, « moins d'animations ». Puis la lecture de fenetre.js : les gestes posés sur les cartes,
// les flèches qui marchent encore, une seule action qui range la fenêtre.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type R = { left: number; top: number; width: number; height: number; bottom?: number };
interface Gestes {
  MESURES: Record<string, number>; CONTROLES: string;
  aDuTexte: (n: unknown) => boolean; zone: (o: Record<string, boolean>) => string;
  depart: (o: Record<string, unknown>) => string; suite: (o: Record<string, unknown>) => string; appui: (o: Record<string, number>) => string;
  apres: (x: number, y: number, r: R, largeur?: number) => boolean; seule: (r: R, largeur: number) => boolean;
  defilement: (y: number, haut: number, bas: number) => number;
  mouvement: (reduit: boolean) => { incline: number; leve: number; prise: number; pose: number };
  auLacher: (o: Record<string, boolean>) => string;
  offre: (avant: string, apres: string, t: number) => { avant: string; apres: string; jusqua: number };
  peutAnnuler: (o: unknown, t: number, gardee: string, modifier?: boolean) => boolean;
}
const SRC = readFileSync(new URL('../src/web/pages/accueil-gestes.js', import.meta.url), 'utf8');
const FE = readFileSync(new URL('../src/web/fenetre.js', import.meta.url), 'utf8');
const win: { OdinGestes?: Record<string, unknown> } = {};
vm.runInNewContext(SRC, { window: win }); // ni document, ni fetch : rien ne doit s'exécuter d'autre à son chargement
const brut = win.OdinGestes as Record<string, (...a: unknown[]) => unknown>;
assert.ok(brut, 'window.OdinGestes est posé');
// Le rang lui-même vient de la grille (pages/accueil-grille.js, lot 14) : lu aussi, sans document.
const winG: { OdinGrille?: { rang: (a: number, b: number, apres: boolean) => number } } = {};
vm.runInNewContext(readFileSync(new URL('../src/web/pages/accueil-grille.js', import.meta.url), 'utf8'), { window: winG });
const rang = winG.OdinGrille!.rang;
/** Le nouvel ordre quand `tenu` est lâché sur `vise` (avant lui, ou après) : comme fenetre.js, rang puis remise à ce rang. */
function placer(ids: string[], tenu: string, vise: string, apresVise: boolean): string[] {
  const a = ids.indexOf(tenu), b = ids.indexOf(vise);
  if (a < 0 || b < 0) return ids.slice();
  const to = rang(a, b, apresVise), reste = ids.filter((x) => x !== tenu);
  reste.splice(to, 0, tenu);
  return reste;
}
const ici = (x: unknown) => (x && typeof x === 'object' ? JSON.parse(JSON.stringify(x)) : x);
const O = Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, typeof v === 'function' ? (...a: unknown[]) => ici(v(...a)) : ici(v)])) as unknown as Gestes;

// Lecture du code sans l'exécuter (comme test/accueil-garde.test.ts) : chaînes et commentaires sautés.
/** Saute une chaîne ('…', "…" ou `…` avec ses ${…}) qui commence en i ; rend l'indice juste après. */
function sauterChaine(s: string, i: number): number {
  const q = s[i];
  for (let j = i + 1; j < s.length;) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) return j + 1;
    if (q === '`' && c === '$' && s[j + 1] === '{') { j = fermer(s, j + 1) + 1; continue; }
    if (q !== '`' && c === '\n') return j;
    j++;
  }
  return s.length;
}

/** Indice de ce qui ferme la parenthèse, l'accolade ou le crochet ouvert en i (chaînes et commentaires sautés). */
function fermer(s: string, i: number): number {
  const ouvre = s[i], ferme = ({ '(': ')', '{': '}', '[': ']' } as Record<string, string>)[ouvre];
  assert.ok(ferme, `pas d'ouverture en ${i}`);
  let n = 0;
  for (let j = i; j < s.length;) {
    const c = s[j];
    if (c === '\'' || c === '"' || c === '`') { j = sauterChaine(s, j); continue; }
    if (c === '/' && s[j + 1] === '/') { const k = s.indexOf('\n', j); if (k < 0) break; j = k; continue; }
    if (c === '/' && s[j + 1] === '*') { const k = s.indexOf('*/', j); if (k < 0) break; j = k + 2; continue; }
    if (c === ouvre) n++;
    else if (c === ferme && --n === 0) return j;
    j++;
  }
  throw new Error(`« ${ouvre} » ouvert en ${i} jamais fermé`);
}

/** Le texte entier de la fonction `nom` de fenetre.js (définie une seule fois). */
function fonction(nom: string): string {
  const m = [...FE.matchAll(new RegExp(`(?:async\\s+)?function\\s+${nom}\\s*\\(`, 'g'))];
  assert.equal(m.length, 1, `fenetre.js : la fonction ${nom} existe, une seule fois`);
  const i = m[0].index ?? 0, corps = FE.indexOf('{', fermer(FE, FE.indexOf('(', i)));
  return FE.slice(i, fermer(FE, corps) + 1);
}

test('gestes : chargé sans document, rien ne s\'exécute ; les mesures de la maquette', () => {
  assert.equal(O.MESURES.appuiLong, 480, 'appui long : 480 ms (la maquette)');
  assert.equal(O.MESURES.seuil, 6, 'à la souris, le glisser commence après 6 px');
  assert.ok(O.MESURES.annuler >= 3000 && O.MESURES.annuler <= 10000, '« Annuler » reste offert quelques secondes');
  assert.doesNotMatch(SRC, /document\.|addEventListener|setTimeout|fetch\(/, 'aucun accès au document, aucun minuteur : des calculs seuls');
});

test('gestes : le rang d\'insertion, selon la moitié survolée (gauche, droite ; haut, bas)', () => {
  const carte = { left: 100, top: 50, width: 200, height: 100 };
  // Deux cartes sur une rangée de 1 000 px : la moitié gauche place avant, la droite après.
  assert.equal(O.apres(150, 60, carte, 1000), false, 'moitié gauche : avant');
  assert.equal(O.apres(250, 60, carte, 1000), true, 'moitié droite : après');
  assert.equal(O.apres(150, 140, carte, 1000), false, 'en bas mais à gauche : avant (la maquette lit la moitié en largeur)');
  // Une carte seule sur sa rangée (le téléphone) : la moitié du haut place avant, celle du bas après.
  const seule = { left: 0, top: 50, width: 980, height: 100 };
  assert.equal(O.apres(900, 70, seule, 1000), false, 'carte seule, moitié du haut : avant (même à droite)');
  assert.equal(O.apres(10, 130, seule, 1000), true, 'carte seule, moitié du bas : après (même à gauche)');
  assert.equal(O.apres(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 1000), false, 'carte sans taille : avant');
  assert.equal(O.seule(seule, 1000), true, 'presque toute la largeur : seule sur sa rangée');
  assert.equal(O.seule(carte, 1000), false, 'côte à côte');
  // L'ordre qui en sort.
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(placer(ids, 'a', 'c', false), ['b', 'a', 'c', 'd'], 'a lâché avant c');
  assert.deepEqual(placer(ids, 'a', 'c', true), ['b', 'c', 'a', 'd'], 'a lâché après c');
  assert.deepEqual(placer(ids, 'd', 'b', false), ['a', 'd', 'b', 'c'], 'd lâché avant b');
  assert.deepEqual(placer(ids, 'd', 'b', true), ['a', 'b', 'd', 'c'], 'd lâché après b');
  assert.deepEqual(placer(ids, 'b', 'c', false), ids, 'b lâché juste avant c : rien ne bouge');
  assert.deepEqual(placer(ids, 'b', 'a', true), ids, 'b lâché juste après a : rien ne bouge');
  assert.deepEqual(placer(ids, 'b', 'b', true), ids, 'sur lui-même : rien');
  assert.deepEqual(placer(ids, 'x', 'b', true), ids, 'un module inconnu : rien');
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'], 'la liste donnée n\'est pas changée');
  // fenetre.js s'en sert, et met la carte à ce rang.
  const s = fonction('startDrag');
  assert.match(s, /OG\.seule\(r, grid\.clientWidth\) \? G\.rang\(a, cartes\.indexOf\(t\), OG\.apres\(ev\.clientX, ev\.clientY, r, grid\.clientWidth\)\)/, 'carte seule : la moitié du haut ou du bas');
  assert.match(s, /: G\.rang\(a, cartes\.indexOf\(t\), G\.apres\(ev\.clientX, ev\.clientY, t\.getBoundingClientRect\(\)\)\)/, 'côte à côte : la règle de la grille (moitié droite, ou le bas)');
  assert.match(s, /grid\.insertBefore\(box, reste\[to\] \?\? null\)/, 'la carte est remise à ce rang');
});

test('gestes : le délai de l\'appui long (480 ms sans bouger ; s\'il bouge, la page défile)', () => {
  assert.equal(O.appui({ dx: 0, dy: 0, ecoule: 479 }), 'attendre', '479 ms : pas encore');
  assert.equal(O.appui({ dx: 0, dy: 0, ecoule: 480 }), 'tenir', '480 ms : le module est en main');
  assert.equal(O.appui({ dx: 3, dy: 4, ecoule: 600 }), 'tenir', 'un doigt qui tremble un peu (5 px) tient encore');
  assert.equal(O.appui({ dx: 0, dy: 9, ecoule: 100 }), 'annuler', 'un doigt qui part de 9 px fait défiler la page : l\'appui est oublié');
  assert.equal(O.appui({ dx: 0, dy: 30, ecoule: 900 }), 'annuler', 'même après 480 ms, s\'il a bougé');
  // Au doigt, sur une carte, c'est un appui long (la page défile encore) ; à la souris, le glisser s'arme tout de suite.
  for (const modifier of [false, true]) {
    for (const z of ['entete', 'vide']) {
      assert.equal(O.depart({ pointeur: 'touch', modifier, zone: z }), 'appuiLong', `doigt, ${z}, Modifier ${modifier}`);
      assert.equal(O.depart({ pointeur: 'pen', modifier, zone: z }), 'appuiLong', `stylet, ${z}, Modifier ${modifier}`);
      assert.equal(O.depart({ pointeur: 'mouse', modifier, zone: z }), 'glisser', `souris, ${z}, Modifier ${modifier}`);
    }
  }
  assert.equal(O.depart({ pointeur: 'touch', modifier: true, zone: 'poignee' }), 'glisser', 'la poignée attrape tout de suite, au doigt aussi');
  const a = fonction('appuiLong');
  assert.match(a, /setTimeout\(async \(\) => \{[\s\S]*\}, OG\.MESURES\.appuiLong\)/, 'fenetre.js attend OG.MESURES.appuiLong');
  assert.match(a, /if \(!edit\) \{ edit = true; await draw\(\);/, 'hors du mode Modifier, l\'appui long ouvre ce mode (la maquette)');
  assert.match(a, /addEventListener\('touchmove', bloque, \{ passive: false \}\)/, 'une fois tenu, la page ne défile plus sous le doigt');
  assert.match(a, /addEventListener\('contextmenu', menu\)/, 'ni le menu du navigateur');
  assert.match(fonction('attraper'), /else if \(quoi === 'appuiLong'\) appuiLong\(e, box, id\)/);
});

test('gestes : en mode Modifier, rien n\'est gardé avant « Terminé »', () => {
  assert.equal(O.auLacher({ modifier: true, change: true }), 'attendre', 'déplacé en mode Modifier : attendre « Terminé »');
  assert.equal(O.auLacher({ modifier: true, change: false }), 'rien');
  assert.equal(O.auLacher({ modifier: true, change: true, annule: true }), 'remettre', 'Échap : l\'ordre d\'avant revient');
  assert.equal(O.auLacher({ modifier: false, change: true, annule: true }), 'remettre');
  assert.equal(O.peutAnnuler(O.offre('A', 'B', 0), 10, 'B', true), false, 'l\'« Annuler » de quelques secondes n\'existe pas en mode Modifier');
  const s = fonction('startDrag');
  assert.match(s, /const order = idsDe\(grid\), quoi = OG\.auLacher\(\{ modifier, change: [^}]+, annule \}\)/, 'fenetre.js demande à OdinGestes quoi faire au lâcher');
  assert.match(s, /modifier = edit/, 'le mode est lu à l\'appui (le geste ne change pas de règle en route)');
  assert.match(s, /if \(quoi === 'ranger'\) rangerDeplacement\(\);/, 'seul « ranger » range');
  assert.doesNotMatch(s, /save\(|regler_fenetre/, 'le glisser lui-même ne range rien');
  assert.match(s, /page\(\)\.widgets\.sort\(/, 'l\'ordre de la page suit (il partira à « Terminé »)');
  assert.equal(FE.split('\'regler_fenetre\'').length - 1, 1, 'une seule action range la fenêtre : save');
  assert.match(fonction('draw'), /onclick: async \(\) => \{ L = JSON\.parse\(saved\); edit = false;/, '« Annuler » du mode Modifier remet tout');
  assert.match(fonction('draw'), /onclick: save \}/, '« Terminé » range');
});

test('gestes : hors du mode Modifier, gardé au lâcher, et « Annuler » offert quelques secondes', () => {
  assert.equal(O.auLacher({ modifier: false, change: true }), 'ranger', 'hors du mode Modifier : rangé au lâcher');
  assert.equal(O.auLacher({ modifier: false, change: false }), 'rien', 'rien n\'a bougé : rien n\'est rangé');
  const o = O.offre('avant', 'apres', 1000);
  assert.equal(o.jusqua, 1000 + O.MESURES.annuler);
  assert.equal(O.peutAnnuler(o, 1000 + O.MESURES.annuler, 'apres'), true, 'pendant ses secondes : oui');
  assert.equal(O.peutAnnuler(o, 1001 + O.MESURES.annuler, 'apres'), false, 'après : trop tard');
  assert.equal(O.peutAnnuler(o, 2000, 'autre'), false, 'la fenêtre a changé depuis : on ne défait pas sans le dire');
  assert.equal(O.peutAnnuler(O.offre('x', 'x', 0), 10, 'x'), false, 'rien à défaire');
  assert.equal(O.peutAnnuler(null, 0, 'x'), false);
  const r = fonction('rangerDeplacement');
  assert.match(r, /save\(null, '', \{ deplacement: true, fenetre: JSON\.stringify\(L\) \}\)/, 'rangé par save, tel qu\'au lâcher');
  const s = fonction('save');
  assert.match(s, /const avant = saved, envoye = o\.fenetre \?\? JSON\.stringify\(L\);/, 'la fenêtre d\'avant est notée');
  assert.match(s, /if \(!r\.ok\) \{ say\([^)]*\); if \(o\.deplacement && rienDepuis\) \{ L = JSON\.parse\(avant\);[^}]*\} return false; \}/, 'refusé : il le dit, l\'écran revient à ce qui est gardé');
  assert.match(s, /proposerAnnuler\(OG\.offre\(avant, saved, Date\.now\(\)\)\)/, 'puis « Annuler » est offert');
  assert.match(s, /return true;/);
  const p = fonction('proposerAnnuler');
  assert.match(p, /if \(glisse \|\| !OG\.peutAnnuler\(o, quand, saved, edit\)\) \{ say\(TXT\.tropTard\); return; \}/, 'trop tard : il le dit');
  assert.match(p, /L = JSON\.parse\(o\.avant\); await save\(null, TXT\.annule, \{ enFile: true \}\);/, '« Annuler » remet et range la fenêtre d\'avant');
  assert.match(p, /setTimeout\(\(\) => n\.remove\(\), OG\.MESURES\.annuler\)/, 'le bouton part après ses secondes');
  assert.match(p, /role: 'status'/, 'annoncé aux lecteurs d\'écran');
  for (const k of ['deplace', 'annuler', 'annule', 'tropTard', 'enMain', 'place', 'revenu']) assert.match(FE, new RegExp(`\\b${k}: `), `texte « ${k} » dans le dictionnaire`);
});

test('gestes : les flèches du clavier marchent encore, la poignée reste', () => {
  const w = fonction('widget');
  assert.match(w, /e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowUp'\) \{ move\(w\.id, -1\)/, '← et ↑ reculent le module');
  assert.match(w, /e\.key === 'ArrowRight' \|\| e\.key === 'ArrowDown'\) \{ move\(w\.id, 1\)/, '→ et ↓ l\'avancent');
  assert.match(w, /if \(e\.shiftKey\) \{ if \(tailleClavier\(w, e\.key, box\)\)/, 'Maj + flèches : la taille (lot 15)');
  assert.match(w, /grip\.addEventListener\('pointerdown', \(e\) => startDrag\(e, box, w\.id\)\)/, 'la poignée attrape le module');
  assert.match(w, /box\.addEventListener\('pointerdown', \(e\) => attraper\(e, box, w\.id\)\)/, 'et la carte elle-même');
  assert.match(fonction('move'), /\[l\[i\], l\[j\]\] = \[l\[j\], l\[i\]\]/, 'le module change de place avec son voisin');
  // Un seul geste à la fois : le coin, le glisser et l'appui long s'excluent ; un second doigt ne compte pas.
  assert.match(fonction('startDrag'), /if \(glisse \|\| coinEnCours \|\| e\.button > 0\)/);
  assert.match(fonction('startResize'), /if \(glisse \|\| appuiEnCours\) return;/);
  assert.match(fonction('attraper'), /if \(glisse \|\| appuiEnCours \|\| coinEnCours/);
  assert.match(fonction('startDrag'), /G\.geste\(pid, v\)/, 'seul le pointeur du départ compte, Échap annule (G.geste)');
  assert.match(FE, /if \(edit \|\| glisse \|\| appuiEnCours \|\| document\.hidden/, 'la fenêtre ne se redessine pas sous un geste');
});

test('gestes : un clic sur un bouton, ou une sélection de texte, ne démarre pas de glisser', () => {
  for (const pointeur of ['mouse', 'touch']) for (const modifier of [false, true]) {
    assert.equal(O.depart({ pointeur, modifier, zone: 'controle' }), 'rien', `${pointeur}, bouton, Modifier ${modifier}`);
    assert.equal(O.depart({ pointeur, modifier, zone: 'coin' }), 'rien', `${pointeur}, coin (c'est la taille), Modifier ${modifier}`);
  }
  // Hors du mode Modifier, le texte se sélectionne (constat P17) ; l'en-tête et le vide de la carte glissent.
  assert.equal(O.depart({ pointeur: 'mouse', modifier: false, zone: 'texte' }), 'rien', 'souris sur un texte : il se sélectionne');
  assert.equal(O.depart({ pointeur: 'touch', modifier: false, zone: 'texte' }), 'rien', 'doigt sur un texte : sélection du navigateur');
  assert.equal(O.depart({ pointeur: 'mouse', modifier: true, zone: 'texte' }), 'glisser', 'en mode Modifier, toute la carte s\'attrape (la maquette)');
  assert.equal(O.depart({ pointeur: 'mouse', modifier: false, zone: 'vide', bouton: 2 }), 'rien', 'clic droit : rien');
  assert.equal(O.depart({ pointeur: 'touch', modifier: true, zone: 'vide', principal: false }), 'rien', 'un second doigt : rien');
  // La zone : le coin, la poignée et les contrôles d'abord ; l'en-tête avant le texte.
  assert.equal(O.zone({ controle: true, entete: true }), 'controle', '« Ouvrir › » dans l\'en-tête reste un bouton');
  assert.equal(O.zone({ entete: true, texte: true }), 'entete', 'le titre de l\'en-tête glisse');
  assert.equal(O.zone({ texte: true }), 'texte');
  assert.equal(O.zone({}), 'vide');
  assert.equal(O.zone({ coin: true, controle: true }), 'coin');
  const n = (t: string) => ({ nodeType: 3, textContent: t });
  assert.equal(brut.aDuTexte({ childNodes: [n('  '), { nodeType: 1, textContent: 'x' }] }), false, 'un bloc sans texte à lui : du vide');
  assert.equal(brut.aDuTexte({ childNodes: [n(' 28° ')] }), true, 'un texte à lui');
  assert.equal(brut.aDuTexte(null), false);
  for (const c of ['button', 'a', 'input', 'select', 'textarea', '[role=switch]', '.fe-rz']) assert.ok(O.CONTROLES.split(',').includes(c), `${c} est un contrôle`);
  // Une sélection qui commence pendant l'appui l'emporte : le glisser est abandonné.
  assert.equal(O.suite({ dx: 40, dy: 0, selection: true }), 'abandonner');
  assert.equal(O.suite({ dx: 5, dy: 0 }), 'attendre', '5 px : un clic, pas un glisser');
  assert.equal(O.suite({ dx: 6, dy: 0 }), 'commencer');
  const a = fonction('attraper');
  assert.match(a, /const c = t\.closest\(OG\.CONTROLES\);/, 'fenetre.js lit les contrôles de OdinGestes');
  assert.match(a, /texte: OG\.aDuTexte\(t\)/);
  assert.match(fonction('startDrag'), /selection: s !== '' && s !== sel0/, 'et la sélection en cours');
  assert.match(FE, /addEventListener\('click', \(e\) => \{ if \(Date\.now\(\) - finGlisse < 400/, 'le clic qui suit un lâcher n\'ouvre rien');
});

test('gestes : avec « moins d\'animations », rien ne bouge tout seul', () => {
  assert.deepEqual(O.mouvement(true), { incline: 0, leve: 1, prise: 0, pose: 0 }, 'ni pente, ni loupe, ni durée');
  const m = O.mouvement(false);
  assert.ok(m.incline > 0 && m.incline <= 5 && m.leve > 1 && m.pose > 0 && m.pose <= 400, 'sinon un peu de mouvement, bref');
  const s = fonction('startDrag');
  assert.match(FE, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/, 'le réglage de l\'appareil est lu');
  assert.match(s, /M = OG\.mouvement\(reduit\(\)\)/);
  assert.match(s, /if \(M\.prise && ghost\.animate\)/, 'la prise n\'est animée que si on le veut');
  assert.match(s, /if \(M\.pose && g\.animate\)[\s\S]*else enlever\(\);/, 'la pose non plus : sinon la copie disparaît d\'un coup');
  assert.equal((s.match(/\.animate\(/g) ?? []).length, 2, 'aucune autre animation');
});

test('gestes : près du haut ou du bas, la page défile toute seule', () => {
  assert.equal(O.defilement(50, 0, 800), -O.MESURES.pasDefil, 'près du haut : vers le haut');
  assert.equal(O.defilement(760, 0, 800), O.MESURES.pasDefil, 'près du bas : vers le bas');
  assert.equal(O.defilement(400, 0, 800), 0, 'au milieu : rien');
  assert.equal(O.defilement(400, 800, 0), 0, 'zone absurde : rien');
  assert.match(fonction('startDrag'), /OG\.defilement\(y, h, b\)/);
});

// Relecture du lot 16 : ce que les gestes ne doivent pas casser autour d'eux.
test('gestes : deux rangements qui se croisent (réseau lent) ne s\'écrasent pas ; un « Modifier » ouvert entre-temps reste ouvert', () => {
  const s = fonction('save');
  assert.match(FE, /function enFile\(f\) \{ const p = fileRangement\.then\(f\); fileRangement = p\.catch\(\(\) => undefined\); return p; \}/, 'une file : un rangement à la fois, dans l\'ordre');
  assert.match(s, /if \(!o\.enFile\) return enFile\(\(\) => save\(_e, dit, \{ \.\.\.o, enFile: true \}\)\);/, 'save passe par la file (« Terminé » aussi)');
  assert.match(s, /act\('gladsheim', 'regler_fenetre', \{ fenetre: envoye \}\)/, 'c\'est la fenêtre notée qui part, pas celle du moment');
  assert.match(s, /const rienDepuis = !edit && JSON\.stringify\(L\) === envoye;/, 'la réponse ne remplace l\'écran que si rien n\'a changé depuis');
  const dep = s.slice(s.indexOf('if (o.deplacement) {'));
  assert.match(dep, /^if \(o\.deplacement\) \{ if \(rienDepuis\) L = r\.data; proposerAnnuler\([^;]+; return true; \}/, 'un déplacement rangé ne ferme pas le mode Modifier et ne jette rien');
  assert.ok(s.indexOf('if (o.deplacement) {') < s.indexOf('edit = false'), 'seul « Terminé » ferme le mode Modifier');
  assert.match(fonction('rangerDeplacement'), /fenetre: JSON\.stringify\(L\)/, 'chaque déplacement est noté au lâcher : son « Annuler » ne défait que lui');
});

test('gestes : « Annuler » ne défait pas un changement fait ailleurs (un autre appareil)', () => {
  const p = fonction('proposerAnnuler');
  assert.match(p, /return enFile\(async \(\) => \{/, '« Annuler » attend son tour dans la file');
  assert.match(p, /const f = await act\('gladsheim', 'fenetre'\);/, 'il relit la fenêtre gardée chez Hestia');
  assert.match(p, /if \(!f\.ok \|\| JSON\.stringify\(f\.data\) !== o\.apres\) \{[^\n]*say\(TXT\.tropTard\); return; \}/, 'elle a changé depuis : trop tard, rien n\'est écrasé');
  assert.ok(p.indexOf('act(\'gladsheim\', \'fenetre\')') < p.indexOf('L = JSON.parse(o.avant)'), 'relue avant de remettre');
});

test('gestes : pendant un glisser, aucune touche n\'agit (sauf Échap) ; un vrai clic juste après un lâcher compte', () => {
  assert.match(fonction('startDrag'), /if \(quoi === 'ignorer'\) \{ if \(ghost && v\.type === 'keydown'\) \{ v\.preventDefault\(\); v\.stopPropagation\(\); \} return; \}/, 'une flèche sur une poignée ne redessine pas la fenêtre sous le geste');
  assert.match(fonction('move'), /^function move\(id, d\) \{ if \(glisse\) return;/, 'les flèches attendent la fin du glisser');
  assert.match(FE, /addEventListener\('pointerdown', \(\) => \{ if \(!glisse\) finGlisse = 0; \}, true\);/, 'un nouvel appui n\'est pas avalé');
});
