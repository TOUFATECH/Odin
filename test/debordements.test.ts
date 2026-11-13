// Débordements et éléments mal placés : le détecteur (test/banc/debordements.ts) est essayé sur des pages
// d'essai (un défaut voulu par case ; une page propre qui ne doit rien déclencher), dans un vrai navigateur.
// Sans Playwright sur la machine, l'essai est ignoré (il le dit).
//   /home/claude/odin-wt/outils/navigateur.sh <copie> test/debordements.test.ts

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyser, type Defaut, type PageQ } from './banc/debordements.ts';

interface Page extends PageQ { goto(url: string): Promise<unknown>; close(): Promise<void> }
interface Navigateur { newPage(o?: Record<string, unknown>): Promise<Page>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sans = pw ? false : 'Playwright n\'est pas installé sur cette machine';
const essai = (nom: string) => 'file://' + fileURLToPath(new URL(`./fixtures/debordements/${nom}`, import.meta.url));

let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });

/** Ouvre une page d'essai à la largeur donnée et rend ses défauts (sans regroupement : un défaut par élément). */
async function defauts(nom: string, largeur: number, hauteur = 800): Promise<Defaut[]> {
  const p = await nav!.newPage({ viewport: { width: largeur, height: hauteur }, deviceScaleFactor: 1 });
  try { await p.goto(essai(nom)); await p.waitForTimeout(150); return (await analyser(p, { regrouper: false })).defauts; } finally { await p.close(); }
}
const a = (ds: Defaut[], type: string, sel: string) => ds.find((d) => d.type === type && d.selecteur === sel);

test('détecteur : chaque défaut voulu de la page d\'essai est trouvé, avec sa mesure', { skip: sans }, async () => {
  const ds = await defauts('defauts.html', 1280);
  const attendus: Array<[string, string, RegExp]> = [
    ['defilement-horizontal', '#trop-large', /dépasse de l'écran de \d+ px à droite/],
    ['coupe', '#coupe', /texte coupé à droite par sa boîte : \d+ px invisibles/],
    ['coupe', '#coupe-haut', /texte coupé en hauteur : \d+ ligne\(s\) cachée\(s\)/],
    ['texte-tronque', '#tronque', /tronqué par « … »/],
    ['hors-boite', '#hors-boite', /texte sort de sa boîte de \d+ px à droite/],
    ['hors-boite', '#bouton-hors', /bouton sort de sa boîte de \d+ px à droite/],
    ['recouvert', '#dessous', /recouvert par un autre élément \(#dessus\)/],
    ['sous-fixe', '#bulle', /sous un élément flottant .* Un titre caché sous la bulle/],
    ['sous-fixe', '#barre-bas', /sous la barre du bas même tout en bas de la page/],
    ['hors-ecran', '#dehors', /sort de l'écran de 40 px à droite/],
    ['chevauchement', '#b2', /se chevauchent sur 60 × 44 px/],
    ['onglets-lignes', '#onglets', /rangée d'onglets sur 2 lignes \(4 onglets/],
    ['onglets-coupes', '#onglets-coupes', /ne tiennent pas dans la largeur : \d+ px invisibles/],
    ['bouton-3-lignes', '#bouton3', /libellé de bouton sur 3 lignes/],
    ['image-deformee', '#dessin', /déformé\(e\) de 100 %/],
    ['image-deformee', '#image', /affiché\(e\) en 200 × 100 px/],
    ['contraste', '#pale', /contraste 1\.9:1 \(il faut 4\.5:1\) : texte #bbbbbb sur #ffffff/],
    ['focus-invisible', '#sans-focus', /rien ne montre que cet élément a le focus/],
  ];
  for (const [type, sel, mesure] of attendus) { const d = a(ds, type, sel); assert.ok(d, `défaut « ${type} » attendu sur ${sel} ; trouvés : ${ds.map((x) => `${x.type} ${x.selecteur}`).join(', ')}`); assert.match(d.mesure, mesure, `${type} ${sel}`); }
  // Chaque défaut a de quoi être retrouvé et capturé : un sélecteur, une place à l'écran, une gravité.
  for (const d of ds) { assert.ok(d.selecteur && d.rect.w >= 0 && ['grave', 'moyen', 'mineur', 'info'].includes(d.gravite), JSON.stringify(d)); }
  // Les cibles tactiles ne sont vérifiées que sur téléphone.
  assert.equal(ds.some((d) => d.type === 'cible-tactile'), false, 'pas de cible tactile signalée sur ordinateur');
  const tel = await defauts('defauts.html', 390, 844);
  assert.match(a(tel, 'cible-tactile', '#cible')?.mesure ?? '', /cible tactile de 20 × 20 px/);
});

test('détecteur : une page bien faite ne déclenche aucun défaut grave ni moyen (ordinateur et téléphone)', { skip: sans }, async () => {
  for (const largeur of [1280, 768, 390, 320]) {
    const ds = (await defauts('propre.html', largeur, largeur > 500 ? 800 : 740)).filter((d) => d.gravite === 'grave' || d.gravite === 'moyen');
    assert.deepEqual(ds.map((d) => `${d.type} ${d.selecteur} : ${d.mesure}`), [], `page propre à ${largeur} px`);
  }
  // Le tableau large reste dans sa zone à défilement : un simple signalement sur téléphone, pas un débordement de la page.
  const tel = await defauts('propre.html', 390, 740);
  assert.ok(tel.some((d) => d.type === 'zone-defile' && d.selecteur.includes('tw')) && !tel.some((d) => d.type === 'defilement-horizontal'));
});

test('détecteur : un texte sans fond posé sur le décor du thème est signalé, pas celui d\'une carte', { skip: sans }, async () => {
  const ds = await defauts('decor.html', 1280);
  const nu = a(ds, 'sur-decor', '#nu');
  assert.ok(nu, 'le texte sans fond est signalé'); assert.match(nu.mesure, /au pire 1\.\d:1 \(texte #10363a sur #0b5f6e\)/); assert.equal(nu.gravite, 'grave');
  assert.ok(a(ds, 'sur-decor', '#nu-bas'), 'même hors de l\'écran (il passera sur le décor en défilant)');
  assert.equal(ds.some((d) => d.selecteur === '#protege'), false, 'le texte dans une carte n\'est pas signalé');
});
