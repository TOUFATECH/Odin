// Genèse · clé USB (lot A) — l'indexeur « tout ce qui est à la racine ». On vérifie qu'une ISO devient une entrée
// « démarrer », qu'un .qcow2 / .vmdk est « à préparer », qu'un VHDX Windows démarre tel quel, et qu'un fichier
// inconnu est listé « non démarrable » et JAMAIS exécuté. Plus le script odin-scan. Fonctions pures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classerRacine, entreesDemarrables, buildScriptScan } from '../src/valhalla/thjalfi/cle-racine.ts';

test('classerRacine : une ISO → entrée « démarrer »', () => {
  const e = classerRacine(['ubuntu-24.04.iso'])[0];
  assert.equal(e.genre, 'iso');
  assert.equal(e.etat, 'demarre');
  assert.equal(e.classe, 'ubuntu');
});

test('classerRacine : .qcow2 et .vmdk → « à préparer » (conversion / odin-boot d\'abord)', () => {
  const es = classerRacine(['debian.qcow2', 'vieux.vmdk']);
  for (const e of es) {
    assert.equal(e.genre, 'vm');
    assert.equal(e.etat, 'a-preparer');
    assert.match(e.message, /à préparer/i);
  }
});

test('classerRacine : un VHDX Windows → démarre tel quel', () => {
  const e = classerRacine(['windows-11.vhdx'])[0];
  assert.equal(e.genre, 'vm');
  assert.equal(e.etat, 'demarre');
  assert.equal(e.classe, 'windows');
});

test('classerRacine : un disque Linux déjà préparé (.vtoy) démarre ; un .img brut est à préparer', () => {
  // .img est reconnu comme raw ; sans indice de famille, Odin reste prudent (non démarrable Windows faute de famille).
  const vtoy = classerRacine(['ubuntu.vtoy'])[0];
  assert.equal(vtoy.etat, 'demarre');
});

test('classerRacine : un fichier inconnu → « non démarrable », jamais exécuté', () => {
  const e = classerRacine(['notes.txt'])[0];
  assert.equal(e.genre, 'non-demarrable');
  assert.equal(e.etat, 'non-demarrable');
  assert.match(e.message, /jamais/i);
});

test('classerRacine : entête confirmant un VHDX Windows (signature « vhdxfile »)', () => {
  const entete = Buffer.from('vhdxfile' + '\0'.repeat(8), 'latin1');
  const e = classerRacine(['disque.bin.vhdx'], { 'disque.bin.vhdx': entete })[0];
  assert.equal(e.etat, 'demarre');
});

test('entreesDemarrables : exclut les fichiers non démarrables', () => {
  const es = classerRacine(['a.iso', 'b.txt', 'c.vhdx']);
  const d = entreesDemarrables(es);
  assert.equal(d.length, 2);
  assert.ok(!d.some((e) => e.genre === 'non-demarrable'));
});

test('buildScriptScan : un script sh qui scanne la racine et distingue démarrable / à préparer / non démarrable', () => {
  const sh = buildScriptScan();
  assert.match(sh, /^#!\/bin\/sh/);
  assert.match(sh, /odin-scan/);
  assert.match(sh, /à préparer/);
  assert.match(sh, /non démarrable/);
  // Étend aux formats de disques de VM au-delà des ISO.
  assert.match(sh, /\*\.qcow2|\*\.vmdk|\*\.vhdx/);
});
