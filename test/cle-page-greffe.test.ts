// Genèse · clé USB — la greffe de l'onglet dans la page, et le rendu des cartes de disque. Ces fichiers sont du
// JavaScript de navigateur (servis tels quels) : on les inspecte comme du texte (pas de DOM ici).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lire = (chemin: string) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');

test('la page de Genèse branche bien l\'onglet « Clé USB » (OdinGeneseCle)', () => {
  const tj = lire('src/web/pages/thjalfi.js');
  // L'onglet apparaît dans la liste des onglets.
  assert.match(tj, /\.\.\.\(window\.OdinGeneseCle\?\.onglets \?\? \[\]\)/, 'onglet « Clé USB » ajouté à la liste');
  // Et il est routé vers son dessinateur (comme le suivi).
  assert.match(tj, /window\.OdinGeneseCle\?\.onglets\.some\(\(\[id\]\) => id === S\.tab\)/, 'routage de l\'onglet « Clé USB »');
  assert.match(tj, /window\.OdinGeneseCle\.dessiner\(/, 'appel du dessinateur de la clé');
});

test('carte de disque : le bouton « Préparer » apparaît sur un disque EXTERNE comme sur une clé', () => {
  const cle = lire('src/web/pages/thjalfi-cle.js');
  // La branche « externe » (clés ET disques externes) pose un bouton qui ouvre la préparation.
  assert.match(cle, /if \(d\.externe\) \{[\s\S]*?class: 'cle-pill pri', onclick: \(\) => outils\.preparer\(d\)/, 'bouton Préparer sous d.externe');
  // Un gros disque externe est annoncé comme pouvant tout contenir.
  assert.match(cle, /Gros disque externe : il peut tout contenir/, 'avertissement « gros disque »');
  // « Préparer » ouvre le composeur (cible, trois choix, VM, plan, progression) avant toute écriture.
  assert.match(cle, /window\.OdinGeneseCleComposer\?\.ouvrir/, 'préparer ouvre le composeur');
});

test('carte de disque : les sections Externes et Internes sont inchangées', () => {
  const cle = lire('src/web/pages/thjalfi-cle.js');
  assert.match(cle, /'Disques externes'/, 'section Externes');
  assert.match(cle, /'Disques internes'/, 'section Internes');
  // Le double démarrage interne existant reste (plan, retirer).
  assert.match(cle, /outils\.plan\(d\)/, 'plan de double démarrage interne gardé');
});

test('carte de disque : pas de « undefined » affiché sous un disque interne non-ODIN', () => {
  const cle = lire('src/web/pages/thjalfi-cle.js');
  // On n'ajoute le bouton « Retirer » qu'avec une garde explicite (sinon append natif insère le texte « undefined »).
  assert.match(cle, /if \(d\.estOdin\) acts\.append\(el\('button', \{ class: 'cle-pill warn'/, 'bouton « Retirer » sous garde if');
  // L'ancienne forme fautive (d.estOdin && el(...)) passée à append natif ne doit plus exister.
  assert.doesNotMatch(cle, /d\.estOdin && el\('button', \{ class: 'cle-pill warn'/, 'plus de d.estOdin && el(...) dans un append natif');
});
