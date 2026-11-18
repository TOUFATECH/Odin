// Le nom du premier écran (vue « home ») : un seul nom partout où l'appli le nomme — le menu de gauche, la barre du
// haut du téléphone, la barre du bas, le nom et le titre de la page, la palette (Ctrl K), le guide de la mascotte et la
// visite guidée. L'identifiant de vue ne change pas, et le menu n'a aucun libellé en double. Lu sans navigateur, comme
// test/menu-replie.test.ts : on lit la source de la page.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Le nom attendu, et les identifiants qui ne bougent pas.
const NOM = 'Accueil';
const VUE = 'home';
const ORDRE_MENU = ['home', 'chat', 'brain', 'net', 'apps', 'flows', 'runes', 'missions', 'skills', 'jobs', 'audit', 'profil', 'settings'];

const UI = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
const GUIDE = readFileSync(new URL('../src/web/guide.js', import.meta.url), 'utf8');

/** Texte d'un libellé HTML : entités courantes rendues, espaces resserrés. */
const texte = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&#39;|&apos;|&rsquo;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/** Une chaîne JavaScript entre apostrophes, rendue. */
const chaine = (s: string) => s.replace(/\\(['"\\])/g, '$1');

/** Le bloc du menu de gauche (de <nav … id="sideNav"> à sa fermeture). */
function menuGauche(): string {
  const d = UI.indexOf('id="sideNav"');
  assert.ok(d > 0, 'menu de gauche trouvé');
  return UI.slice(d, UI.indexOf('</nav>', d));
}
/** Le bloc de la barre du bas du téléphone. */
function barreBas(): string {
  const d = UI.indexOf('<nav class="bnav"');
  assert.ok(d > 0, 'barre du bas trouvée');
  return UI.slice(d, UI.indexOf('</nav>', d));
}
/** Les boutons de vue d'un bloc : [identifiant, libellé]. */
const boutons = (bloc: string) => [...bloc.matchAll(/<button class="tab[^"]*" data-view="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
  .map((m) => [m[1], texte(/<span class="lbl">([\s\S]*?)<\/span>/.exec(m[2])?.[1] ?? '')] as const);

/** Chaque endroit où l'appli nomme l'écran « home », avec ce qu'il dit. */
function endroits(): Record<string, string | undefined> {
  const menu = boutons(menuGauche()).find(([v]) => v === VUE)?.[1];
  const bas = boutons(barreBas()).find(([v]) => v === VUE)?.[1];
  const haut = /<span class="mcur" id="mcur">([\s\S]*?)<\/span>/.exec(UI)?.[1];
  const section = new RegExp(`<section class="view[^"]*" id="v-${VUE}" aria-label="([^"]*)">`).exec(UI);
  const titre = section ? /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(UI.slice(section.index, section.index + 2000))?.[1] : undefined;
  const palette = new RegExp(`\\['${VUE}', '((?:[^'\\\\]|\\\\.)*)'\\]`).exec(UI.slice(UI.indexOf('const VIEWS = [')))?.[1];
  const guide = new RegExp(`^\\s{4}${VUE}: \\['((?:[^'\\\\]|\\\\.)*)'`, 'm').exec(GUIDE)?.[1];
  return {
    'menu de gauche': menu, 'barre du bas': bas, 'barre du haut du téléphone': haut && texte(haut),
    'nom de la page (aria-label)': section?.[1] && texte(section[1]), 'titre de la page': titre && texte(titre),
    'palette': palette && chaine(palette), 'guide de la mascotte': guide && chaine(guide),
  };
}

test('le premier écran porte un seul nom : menu, barres, nom et titre de la page, palette, guide', () => {
  const e = endroits();
  for (const [ou, nom] of Object.entries(e)) assert.equal(nom, NOM, `${ou} : « ${nom} »`);
  assert.equal(new Set(Object.values(e)).size, 1, 'un seul nom, pas deux');
});

test('la visite guidée dit le même nom pour le menu', () => {
  const d = UI.indexOf('const CHAPTERS = [');
  assert.ok(d > 0, 'visite guidée trouvée');
  const pas = /\{ v: 'home', q: \['#sideNav', '\.bnav'\], t: '((?:[^'\\]|\\.)*)'/.exec(UI.slice(d));
  assert.ok(pas, 'le pas qui montre le menu');
  assert.match(chaine(pas[1]), new RegExp(`^Le menu : ${NOM}[ ,]`));
});

test('l\'identifiant de vue home ne change pas, ni l\'ordre du menu', () => {
  assert.deepEqual(boutons(menuGauche()).map(([v]) => v), ORDRE_MENU, 'ordre du menu de gauche');
  assert.equal(boutons(barreBas())[0]?.[0], VUE, 'première entrée de la barre du bas');
  assert.match(UI, new RegExp(`<section class="view on" id="v-${VUE}"`), 'la page home est la page de départ');
  assert.match(UI, new RegExp(`const VIEWS = \\[\\['${VUE}', `), 'la palette commence par home');
});

test('aucun libellé en double dans le menu', () => {
  const L = boutons(menuGauche()).map(([, l]) => l);
  assert.ok(L.every(Boolean), 'chaque entrée a son libellé');
  assert.deepEqual(L.filter((l, i) => L.indexOf(l) !== i), [], 'libellés en double');
});
