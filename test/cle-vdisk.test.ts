// Genèse · clé USB — reconnaissance des disques virtuels et plan de conversion ; honnêteté macOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyserVdisk, formatParNom, formatParEntete, familleParNom } from '../src/valhalla/thjalfi/vdisk.ts';

test('format par le nom et par l\'en-tête', () => {
  assert.equal(formatParNom('disque.vhdx'), 'vhdx');
  assert.equal(formatParNom('image.qcow2'), 'qcow2');
  assert.equal(formatParNom('win.vmdk'), 'vmdk');
  assert.equal(formatParNom('vm.vtoy'), 'vtoy');
  assert.equal(formatParEntete(Buffer.from('QFI\xfb........', 'latin1')), 'qcow2');
  assert.equal(formatParEntete(Buffer.from('vhdxfile....', 'latin1')), 'vhdx');
});

test('familleParNom reconnaît Windows, Linux, macOS', () => {
  assert.equal(familleParNom('win11.vhdx'), 'windows');
  assert.equal(familleParNom('ubuntu-22.img'), 'linux');
  assert.equal(familleParNom('macos-sonoma.qcow2'), 'macos');
});

test('VHD/VHDX Windows : démarre tel quel, rien à préparer', () => {
  const a = analyserVdisk('windows11.vhdx');
  assert.equal(a.famille, 'windows');
  assert.equal(a.demarreTelQuel, true);
  assert.equal(a.convertir, false);
  assert.equal(a.prepareOdinBoot, false);
});

test('disque Linux brut : à préparer avec odin-boot', () => {
  const a = analyserVdisk('ubuntu.img');
  assert.equal(a.famille, 'linux');
  assert.equal(a.prepareOdinBoot, true);
  assert.equal(a.demarreTelQuel, false);
  // Un .vtoy est déjà préparé.
  assert.equal(analyserVdisk('ubuntu.vtoy').demarreTelQuel, true);
});

test('VMDK / QCOW2 / VDI : plan de conversion qemu-img', () => {
  const win = analyserVdisk('windows11.vmdk');
  assert.equal(win.convertir, true);
  assert.equal(win.cible, 'vhd');
  assert.match(win.commandeConversion ?? '', /qemu-img convert -O vpc/);
  const lin = analyserVdisk('ubuntu.qcow2');
  assert.equal(lin.cible, 'raw');
  assert.equal(lin.prepareOdinBoot, true, 'Linux converti : ensuite odin-boot');
});

test('macOS : honnêteté, Odin ne fait pas semblant', () => {
  const a = analyserVdisk('macos-ventura.qcow2');
  assert.equal(a.famille, 'macos');
  assert.equal(a.demarreTelQuel, false);
  assert.equal(a.convertir, false);
  assert.match(a.message, /licence d'Apple|ne démarre pas/i);
});
