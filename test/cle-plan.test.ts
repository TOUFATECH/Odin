// Genèse · clé USB — le plan de double démarrage et le plan de retrait, sur des tables de partitions SIMULÉES.
// Garde-fous : arrêt si chiffré, refus si pas de place, réduction seulement d'un FS sain. Aucune commande réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDualBoot, planRetrait, espaceLibre } from '../src/valhalla/thjalfi/cle-plan.ts';
import type { Disque } from '../src/valhalla/thjalfi/disques.ts';

const GO = 1024 ** 3;
const disque = (o: Partial<Disque> & { partitions: Disque['partitions'] }): Disque => ({
  id: 'd', chemin: '/dev/sda', tailleOctets: 500 * GO, genre: 'interne', externe: false, amovible: false, ...o,
});

test('espace libre : taille moins les partitions', () => {
  const d = disque({ tailleOctets: 500 * GO, partitions: [{ nom: 'p1', tailleOctets: 100 * GO }] });
  assert.equal(espaceLibre(d), 400 * GO);
});

test('plan : de l\'espace libre suffisant, rien n\'est touché', () => {
  const d = disque({ tailleOctets: 500 * GO, partitions: [{ nom: 'p1', tailleOctets: 400 * GO, fs: 'ntfs', systeme: 'windows' }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, true);
  assert.equal(p.methode, 'espace-libre');
  assert.equal(p.nouvelle?.tailleOctets, 60 * GO);
  assert.ok(p.etapes.every((e) => e.sur), 'aucune étape destructrice');
  assert.ok(p.sauvegardes.length >= 1, 'la table de partitions est sauvegardée');
});

test('plan : réduction d\'un Windows sain quand il n\'y a pas assez d\'espace libre', () => {
  const d = disque({ tailleOctets: 500 * GO, partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', systeme: 'windows', utiliseOctets: 200 * GO }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, true);
  assert.equal(p.methode, 'reduction');
  assert.equal(p.reduire?.nom, 'C');
  assert.ok(p.reduire && p.reduire.versOctets < p.reduire.deOctets, 'Windows est réduit, pas effacé');
  // Une étape de réduction est marquée « pas sûre » (elle demande vérification), mais aucune n'efface.
  assert.ok(p.etapes.some((e) => !e.sur));
});

test('garde-fou : disque chiffré sans clé → arrêt net', () => {
  const d = disque({ chiffre: 'bitlocker', partitions: [{ nom: 'C', tailleOctets: 480 * GO, fs: 'ntfs', chiffre: 'bitlocker' }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false);
  assert.match(p.blocage ?? '', /chiffré|BitLocker/i);
  assert.equal(p.etapes.length, 0);
});

test('garde-fou : pas assez de place et FS non réductible → refus', () => {
  const d = disque({ tailleOctets: 60 * GO, partitions: [{ nom: 'p1', tailleOctets: 58 * GO, fs: 'exfat' }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false);
  assert.match(p.blocage ?? '', /place|réduit/i);
});

test('garde-fou : Windows presque plein n\'est pas réduit', () => {
  const d = disque({ tailleOctets: 256 * GO, partitions: [{ nom: 'C', tailleOctets: 250 * GO, fs: 'ntfs', systeme: 'windows', utiliseOctets: 240 * GO }] });
  const p = planDualBoot(d, 60);
  assert.equal(p.possible, false, 'pas 60 Go + 10 de marge réellement libres');
});

test('plan de retrait : enlève la partition ODIN, jamais les autres', () => {
  const d = disque({ partitions: [{ nom: 'C', tailleOctets: 400 * GO, fs: 'ntfs', systeme: 'windows' }, { nom: 'ODIN', tailleOctets: 60 * GO, label: 'ODIN', systeme: 'odin' }] });
  const p = planRetrait(d);
  assert.equal(p.possible, true);
  assert.match(p.etapes.map((e) => e.texte).join(' '), /ODIN/);
  // Sans partition ODIN, il n'y a rien à retirer.
  const sans = disque({ partitions: [{ nom: 'C', tailleOctets: 400 * GO, fs: 'ntfs', systeme: 'windows' }] });
  assert.equal(planRetrait(sans).possible, false);
});
