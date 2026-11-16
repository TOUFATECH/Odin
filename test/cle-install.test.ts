// Genèse · clé USB (lot A) — les VRAIS systèmes installés : Windows To Go (DISM + bcdboot), persistance Linux
// (fichier de persistance par distribution), et le tableau `persistence` de ventoy.json. On vérifie les étapes et
// les limites honnêtes, le bon choix d'étiquette de persistance, et un `persistence[]` valide. Fonctions pures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWinToGo, specPersistance, entreesPersistance, planInstallLinux, commandePersistance, entreesVdiskAuto } from '../src/valhalla/thjalfi/cle-install.ts';
import type { SystemeCle } from '../src/valhalla/thjalfi/cle-types.ts';
import type { Recipe } from '../src/valhalla/thjalfi/recipes.ts';

const rec = (kind: Recipe['kind'], os: Recipe['os']): Recipe => ({ kind, label: `${kind}`, auto: true, os });

test('planWinToGo : étapes DISM /Apply-Image puis bcdboot, VHDX dans /vdisk, besoin d\'un hôte Windows', () => {
  const p = planWinToGo('windows-11.iso', 'Windows 11', { tailleGo: 48, index: 2, sansTpm: true, sansCompteMicrosoft: true });
  const cmds = p.commandes.join('\n');
  assert.match(cmds, /dism \/Apply-Image \/ImageFile:.*install\.wim.*\/Index:2/i);
  assert.match(cmds, /bcdboot .*\\Windows \/s .* \/f ALL/i);
  // Le retrait des exigences Windows 11 (Rufus) : clés LabConfig dans le registre hors ligne.
  assert.match(cmds, /LabConfig .*BypassTPMCheck/);
  assert.match(p.vhdx, /vdisk\/.*wintogo\.vhdx$/);
  assert.equal(p.besoinHoteWindows, true);
  // Limites dites honnêtement.
  assert.ok(p.limites.some((l) => /licence/i.test(l)));
  assert.ok(p.limites.some((l) => /lent/i.test(l)));
  assert.ok(p.limites.some((l) => /bcdboot|hôte Windows/i.test(l)));
});

test('planWinToGo : injection de pilotes (VM copiée) par DISM /Add-Driver /Recurse', () => {
  const p = planWinToGo('win.iso', 'Win', { pilotes: ['C:/pilotes/virtio'] });
  assert.match(p.commandes.join('\n'), /\/Add-Driver \/Driver:.*virtio.* \/Recurse/i);
});

test('specPersistance : casper-rw / vtoycow / MX-Persist / persistence.conf selon la distribution', () => {
  assert.equal(specPersistance('ubuntu-24.04-desktop.iso').label, 'casper-rw');
  assert.equal(specPersistance('linuxmint-22.iso').label, 'casper-rw');
  assert.equal(specPersistance('fedora-workstation-41.iso').label, 'vtoycow');
  assert.equal(specPersistance('archlinux-2025.iso').label, 'vtoycow');
  assert.equal(specPersistance('MX-23.iso').label, 'MX-Persist');
  const kali = specPersistance('kali-linux-2025.iso');
  assert.equal(kali.label, 'persistence');
  assert.equal(kali.conf, true); // Kali/Debian/Clonezilla : persistence.conf « / union »
  const deb = specPersistance('debian-live-12.iso');
  assert.equal(deb.conf, true);
  // Taille et système de fichiers par défaut.
  assert.equal(specPersistance('ubuntu.iso', 8192).tailleMo, 8192);
  assert.equal(specPersistance('ubuntu.iso').fs, 'ext4');
});

test('entreesPersistance : un persistence[] valide (image / backend / autosel / timeout)', () => {
  const systemes: SystemeCle[] = [
    { fichier: 'ubuntu.iso', nom: 'Ubuntu', famille: 'Linux', mode: 'demarrer', recipe: rec('ubuntu', 'linux'), choix: 'persistance', persistance: { label: 'casper-rw', tailleMo: 4096, fs: 'ext4' } },
    { fichier: 'win.iso', nom: 'Win', famille: 'Windows', mode: 'installer', recipe: rec('windows', 'windows'), choix: 'iso' },
  ];
  const p = entreesPersistance(systemes);
  assert.equal(p.length, 1); // seul le système en 'persistance'
  assert.equal(p[0].image, '/ISO/ubuntu.iso');
  assert.match(p[0].backend, /^\/persistence\/ubuntu-casper-rw\.dat$/);
  assert.equal(p[0].autosel, 1);
  assert.equal(typeof p[0].timeout, 'number');
});

test('entreesPersistance : vide si aucun système en persistance (ventoy.json inchangé)', () => {
  const systemes: SystemeCle[] = [{ fichier: 'win.iso', nom: 'Win', famille: 'Windows', mode: 'installer', recipe: rec('windows', 'windows'), choix: 'iso' }];
  assert.equal(entreesPersistance(systemes).length, 0);
});

test('commandePersistance : dd + mkfs avec l\'étiquette, et persistence.conf si la distribution le demande', () => {
  const cmds = commandePersistance({ label: 'persistence', tailleMo: 4096, fs: 'ext4', conf: true }, '/persistence/kali.dat').join('\n');
  assert.match(cmds, /dd if=\/dev\/zero of="\/persistence\/kali\.dat" bs=1M count=4096/);
  assert.match(cmds, /mkfs\.ext4 -F -L persistence/);
  assert.match(cmds, /persistence\.conf.*union/i);
});

test('planInstallLinux : partition étiquetée + entrée GRUB chainload', () => {
  const s: SystemeCle = { fichier: 'ubuntu.iso', nom: 'Ubuntu', famille: 'Linux', mode: 'installer', recipe: rec('ubuntu', 'linux'), choix: 'installe', installPartition: { tailleGo: 25 } };
  const p = planInstallLinux(s);
  assert.equal(p.partition.tailleGo, 25);
  assert.match(p.grubEntree, /menuentry "Ubuntu \(installé\)"/);
  assert.match(p.grubEntree, /search .*--label --set=root /);
  assert.match(p.grubEntree, /configfile \/boot\/grub\/grub\.cfg/);
});

test('entreesVdiskAuto : Windows To Go et copie de VM reçoivent leur icône, pas les ISO', () => {
  const systemes: SystemeCle[] = [
    { fichier: 'win.iso', nom: 'Windows', famille: 'Windows', mode: 'installer', recipe: rec('windows', 'windows'), choix: 'installe', winToGo: { tailleGo: 32 } },
    { fichier: 'ubuntu.iso', nom: 'Ubuntu', famille: 'Linux', mode: 'installer', recipe: rec('ubuntu', 'linux'), choix: 'iso' },
    { fichier: 'vm-x', nom: 'VM Debian', famille: 'Linux', mode: 'demarrer', recipe: rec('iso', 'outil'), choix: 'vm', vmSource: { origine: 'hydre-locale', nom: 'VM Debian', famille: 'linux', disque: 'vm/disque.qcow2', instantaneFait: true } },
  ];
  const auto = entreesVdiskAuto(systemes);
  assert.equal(auto.length, 2); // WinToGo + VM, pas l'ISO
  assert.ok(auto.some((e) => e.class === 'windows'));
  assert.ok(auto.some((e) => e.class === 'vdisk'));
});
