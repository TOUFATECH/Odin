// Noûs, étape 5 : la recherche par le sens se met à marcher. Avant tout point de reprise, la mémoire n'a aucun vecteur
// (la recherche se fait par mots) ; dès qu'un point apparaît, le moteur se recharge TOUT SEUL, les souvenirs reçoivent
// leurs vecteurs en arrière-plan (petits lots, arrêt quand Odin répond), et ils sont REFAITS quand le modèle change de
// version. Vrai moteur, petit gabarit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Mnemosyne } from '../src/muninn/store.ts';
import { embedderQuiSeRecharge } from '../src/brain/nous/plongement.ts';
import { remplirVecteurs } from '../src/brain/nous/vecteurs-fond.ts';
import { nouvelEntraineur, gabarit, apprendreDecoupage } from '../src/brain/nous/moteur.ts';

const homes: string[] = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

test('avant : par mots seulement ; après un point de reprise : vecteurs en arrière-plan, recherche par le sens ; nouvelle version : vecteurs refaits', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nous-sens-')); homes.push(home);
  const mem = new Mnemosyne(':memory:');
  const faits = ['Le serveur de fichiers est au grenier.', 'La box internet redémarre chaque lundi.', 'Le compost se retourne chaque mois.', 'La tortue du jardin mange des salades.'];
  for (const f of faits) mem.remember(f, 'owner', 'fact');
  const emb = embedderQuiSeRecharge(home, { verifMs: 0 });

  // AVANT : aucun moteur, aucun vecteur ; la recherche par le sens ne trouve rien (la recherche par mots reste).
  const avant = await remplirVecteurs(mem, emb, { libre: () => true });
  assert.equal(avant.faits, 0); assert.match(avant.raison ?? '', /pas encore prêt/);
  assert.equal(emb.model, 'noos');
  assert.equal(mem.nearest(emb.model, new Float32Array(64).fill(1), 3).length, 0);

  // Un petit réseau apprend et écrit son premier point de reprise (comme le fait l'entraînement quand c'est mieux).
  const dec = apprendreDecoupage(faits, 4096, 7);
  const e = nouvelEntraineur(gabarit('petit'), dec, 42, home);
  await e.seance([{ entrees: faits.map((t) => dec.encoder(t)) }], { dureeMs: 10_000, fils: 1, signal: new AbortController().signal, graine: 1 });
  await e.ecrire(0);

  // APRÈS : le moteur se recharge tout seul, les vecteurs arrivent en arrière-plan, la recherche passe par le sens.
  const t0 = performance.now();
  const apres = await remplirVecteurs(mem, emb, { libre: () => true, lot: 2 });
  assert.equal(apres.faits, 4, JSON.stringify(apres));
  assert.equal(emb.model, 'noos-v1-p2');
  const q = await emb.embed('Où est rangé le NAS ?');
  const proches = mem.nearest(emb.model, q, 2);
  assert.equal(proches.length, 2, 'la recherche par le sens rend des souvenirs (même sans mot commun)');
  console.log(`# mesuré : 4 vecteurs en ${(performance.now() - t0).toFixed(0)} ms (chargement du moteur compris) ; plus proche de « Où est rangé le NAS ? » : « ${proches[0].content} »`);
  assert.equal(mem.missingVectors(emb.model).length, 0);

  // Odin répond : le remplissage s'arrête aussitôt.
  mem.remember('Le portail se ferme à 22 h.', 'owner', 'fact');
  const occupe = await remplirVecteurs(mem, emb, { libre: () => false });
  assert.equal(occupe.faits, 0); assert.equal(occupe.raison, 'Odin répond');

  // Nouvelle version du modèle (nouveau point) : la recherche reste servie par l'ANCIEN moteur et ses vecteurs pendant
  // que ceux du nouveau sont préparés à part (constat 13) ; puis tout bascule d'un coup.
  await e.seance([{ entrees: faits.map((t) => dec.encoder(t)) }], { dureeMs: 10_000, fils: 1, signal: new AbortController().signal, graine: 2 });
  await e.ecrire(1);
  emb.recharger();
  const q1 = await emb.embed('Où est rangé le NAS ?');
  assert.equal(emb.model, 'noos-v1-p2', 'toujours l\'ancien en service');
  assert.equal(mem.nearest(emb.model, q1, 2).length, 2, 'la recherche par le sens trouve toujours (aucun trou)');
  const partiel = await remplirVecteurs(mem, emb, { libre: () => true, lot: 2, budgetMs: 1 });
  assert.equal(partiel.bascule, undefined);
  assert.equal(mem.nearest(emb.model, q1, 2).length, 2, 'pendant la préparation aussi');
  const refaits = await remplirVecteurs(mem, emb, { libre: () => true });
  assert.equal(refaits.bascule, true);
  await emb.embed('essai');
  assert.equal(emb.model, 'noos-v2-p2');
  assert.equal(mem.missingVectors(emb.model).length, 0, 'tous refaits, d\'un coup');
  await e.arreter();
});
