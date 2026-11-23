// Le menu de gauche dans l'ordre de la maquette validée « Accueil » (lot 20) : Accueil, Home Assistant, Applis,
// Discussion, Cerveau, Thèmes, le réseau (« Maison »), « Plus », Réglages. Rien n'est perdu : chaque page d'avant
// garde son entrée et son identifiant. « Thèmes » est un raccourci vers Réglages → Apparence, sans data-view : la
// connaissance de soi d'Odin garde « Réglages » pour nom de la page des réglages. « Maison 3D » et « Humeurs »
// n'arrivent que le jour où leur page existe.
//
// ui.html est lu comme du texte ; le geste de « Thèmes » est rejoué avec de fausses fonctions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { lireInterface, texteHtml } from '../src/brain/nous/connaissance-de-soi.ts';

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const GUIDE = readFileSync(new URL('../src/web/guide.js', import.meta.url), 'utf8');

/** Le menu de gauche entier (<nav id="sideNav">). */
function menu(): string {
  const i = UI.indexOf('id="sideNav"');
  assert.ok(i > 0, 'le menu (#sideNav) existe');
  return UI.slice(UI.lastIndexOf('<nav', i), UI.indexOf('</nav>', i));
}

/** Les entrées du premier niveau, dans l'ordre : les onglets hors du bloc « Plus », et le bouton « Plus ». */
function premierNiveau(): { libelle: string; vue: string | null; balise: string }[] {
  const m = menu(), debutPlus = m.indexOf('<div class="navmore" id="navMore"'), finPlus = m.indexOf('</div>', m.indexOf('id="navEpingles"')) + 6;
  assert.ok(debutPlus > 0 && finPlus > debutPlus, 'le bloc « Plus » existe');
  const haut = m.slice(0, debutPlus) + m.slice(m.indexOf('</div>', finPlus) + 6);
  const out: { libelle: string; vue: string | null; balise: string }[] = [];
  for (const x of haut.matchAll(/<(button|a) class="(tab|nav-more)"([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const lbl = /<span class="lbl">([\s\S]*?)<\/span>/.exec(x[4]) ?? /<span>([\s\S]*?)<\/span>/.exec(x[4]);
    out.push({ libelle: texteHtml(lbl ? lbl[1] : ''), vue: /data-view="([^"]+)"/.exec(x[3])?.[1] ?? null, balise: x[0] });
  }
  return out;
}

test('le menu suit l\'ordre de la maquette : Accueil, Home Assistant, Applis, Discussion, Cerveau, Thèmes, le réseau, Plus, Réglages', () => {
  assert.deepEqual(premierNiveau().map((e) => e.libelle), ['Accueil', 'Home Assistant', 'Applis', 'Discussion', 'Cerveau', 'Thèmes', 'Maison', 'Plus', 'Réglages']);
  assert.deepEqual(premierNiveau().map((e) => e.vue), ['home', 'maison', 'apps', 'chat', 'brain', null, 'net', null, 'settings']);
});

test('rien n\'est perdu : chaque page d\'avant garde son entrée et son identifiant, une seule fois', () => {
  const vues = [...menu().matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...vues].sort(), ['apps', 'audit', 'brain', 'chat', 'flows', 'home', 'jobs', 'maison', 'missions', 'net', 'profil', 'runes', 'settings', 'skills'], 'mêmes pages qu\'avant, aucune en double');
  // Le bloc « Plus » garde ses sept pages et les épingles.
  const m = menu(), plus = m.slice(m.indexOf('id="navMore"'), m.indexOf('id="navEpingles"'));
  assert.deepEqual([...plus.matchAll(/data-view="([^"]+)"/g)].map((x) => x[1]), ['flows', 'runes', 'missions', 'skills', 'jobs', 'audit', 'profil']);
  // « Home Assistant » reste caché au départ (montré au propriétaire seul, par pages/menu-ecrans.js) et s'ouvre dans Odin.
  assert.match(m, /<a class="tab" id="navMaison" href="#maison" data-view="maison" hidden>/);
});

test('aucun libellé en double dans le menu', () => {
  const libelles = [...menu().matchAll(/<span class="lbl">([\s\S]*?)<\/span>/g)].map((m) => texteHtml(m[1]));
  assert.ok(libelles.length >= 14, `${libelles.length} libellés`);
  assert.deepEqual(libelles.filter((l, i) => libelles.indexOf(l) !== i), [], 'chaque libellé une seule fois');
});

test('« Thèmes » n\'a pas de data-view : la page des réglages s\'appelle toujours « Réglages » pour Odin', () => {
  const themes = premierNiveau().find((e) => e.libelle === 'Thèmes');
  assert.ok(themes, 'l\'entrée « Thèmes » existe');
  assert.doesNotMatch(themes.balise, /data-view=/, 'pas de data-view sur le raccourci');
  assert.match(themes.balise, /^<button class="tab" type="button" id="navThemes"/);
  // Ce que lit la connaissance de soi : la page « settings » au menu, nommée « Réglages », et aucune page « Thèmes ».
  const lu = lireInterface(UI);
  const reglages = lu.pages.find((p) => p.id === 'settings');
  assert.ok(reglages && reglages.menu, 'page settings au menu');
  assert.equal(reglages.libelle, 'Réglages');
  assert.ok(!lu.pages.some((p) => p.libelle === 'Thèmes'), 'aucune page nommée « Thèmes »');
  for (const id of ['home', 'chat', 'brain', 'net', 'apps', 'settings']) assert.ok(lu.pages.some((p) => p.id === id && p.menu), `page ${id} au menu`);
});

/** Rejoue le geste de « Thèmes » avec de fausses fonctions ; rend les gestes faits, dans l'ordre. */
function rejouerThemes(): string[] {
  const lignes = UI.split('\n');
  const ligne = lignes.filter((l) => l.includes('$(\'#navThemes\')') && l.includes('addEventListener'));
  assert.equal(ligne.length, 1, 'un seul branchement du raccourci');
  const def = lignes.filter((l) => /^\s*function ouvrirThemes\(\)/.test(l));
  assert.equal(def.length, 1, 'le geste a sa fonction, sur une ligne');
  const gestes: string[] = [];
  const ecoute: { clic?: () => void } = {};
  const $ = (sel: string) => {
    if (sel === '#navThemes') return { addEventListener: (t: string, f: () => void) => { assert.equal(t, 'click'); ecoute.clic = f; } };
    if (sel === '#v-settings .tauto') return { scrollIntoView: (o: { block?: string }) => gestes.push(`descend:tauto:${o?.block}`) };
    return null;
  };
  const show = (v: string) => gestes.push(`show:${v}`);
  const openSettings = (s: string) => gestes.push(`rubrique:${s}`);
  new Function('$', 'show', 'openSettings', `${def[0]}\n${ligne[0]}`)($, show, openSettings);
  assert.ok(ecoute.clic, 'le clic est écouté');
  ecoute.clic();
  return gestes;
}

test('« Thèmes » ouvre les Réglages à la rubrique Apparence', () => {
  const gestes = rejouerThemes();
  assert.deepEqual(gestes.slice(0, 2), ['show:settings', 'rubrique:apparence']);
  // La rubrique visée existe bien dans les réglages.
  assert.match(UI, /<article class="card" data-sec="apparence">/);
  // Le lecteur d'écran sait où il mène.
  assert.match(UI, /id="navThemesDit" hidden>Ouvre les Réglages, rubrique Apparence</);
});

test('« Thèmes » montre les thèmes, pas le choix des animations posé en tête de la carte Apparence', () => {
  // themes.js pose en tête de la carte la place des animations (12 cartes, lot 17), puis « Automatique » (.tauto) et les familles.
  const THEMES = readFileSync(new URL('../src/web/themes.js', import.meta.url), 'utf8');
  assert.match(THEMES, /<section id="themeAnims"[^']*<\/section><div class="tauto">/, 'les thèmes commencent à .tauto, juste après les animations');
  // Le geste descend jusqu'aux thèmes, après avoir ouvert la rubrique (qui remet la page en haut).
  assert.deepEqual(rejouerThemes(), ['show:settings', 'rubrique:apparence', 'descend:tauto:start']);
  // Un peu d'air au-dessus de « Automatique » : le bouton n'est pas coupé par le haut de la page.
  assert.match(UI, /#v-settings \.tauto\{scroll-margin-top:\d+px\}/);
});

test('la palette (Ctrl K) trouve « Thèmes », avec le nom du menu, seulement s\'il est visible', () => {
  const src = UI.slice(UI.indexOf('function palSource()'), UI.indexOf('function palRender()'));
  assert.match(src, /\$\('#navThemes'\)/, 'la palette lit l\'entrée du menu');
  assert.match(src, /navThemes[^\n]*!\w+\.hidden[^\n]*ouvrirThemes/, 'visible seulement, et le même geste que le menu');
  assert.doesNotMatch(src, /'Thèmes'/, 'aucun libellé de plus : celui du menu');
});

test('« Maison 3D » et « Humeurs » attendent leur page ; le menu replié reste la colonne d\'icônes', () => {
  const libelles = premierNiveau().map((e) => e.libelle);
  if (!/id="v-maison3d"/.test(UI)) assert.ok(!libelles.includes('Maison 3D'));
  if (!/id="v-humeurs"/.test(UI)) assert.ok(!libelles.includes('Humeurs'));
  // Chaque entrée du premier niveau a son icône (la colonne repliée n'affiche qu'elles).
  for (const e of premierNiveau()) assert.match(e.balise, /<svg/, `${e.libelle} a une icône`);
  // L'icône de « Thèmes » est une palette, pas un visage : aucun œil ni bouche dessinés comme sur la maquette « Humeurs ».
  const icone = /<svg[\s\S]*?<\/svg>/.exec(premierNiveau().find((e) => e.libelle === 'Thèmes')!.balise)![0];
  assert.doesNotMatch(icone, /M8 14s|smile|bouche/i);
  // Le menu replié cache les libellés à l'œil seulement (pages/menu-replie.js n'est pas touché par ce lot).
  assert.match(readFileSync(new URL('../src/web/pages/menu-replie.js', import.meta.url), 'utf8'), /\$\{R\} nav\.side \.lbl/);
});

test('la visite guidée et le guide disent le nouvel ordre', () => {
  assert.match(UI, /Le menu : Accueil, Home Assistant \(quand ta maison est reliée\), Applis, Discussion, Cerveau, Thèmes/);
  assert.doesNotMatch(UI, /Le menu : Accueil, Discussion, Missions et Réseau/);
  assert.match(GUIDE, /« Thèmes », dans le menu, ouvre directement la rubrique Apparence\./);
});
