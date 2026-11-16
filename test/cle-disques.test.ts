// Genèse · clé USB — détection des disques : les parseurs lsblk (Linux) et Get-Disk (Windows) sur des sorties
// FIGÉES, le classement externes / internes, les systèmes et le chiffrement reconnus. Fausses listes : aucun
// vrai disque n'est touché.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLsblk, parseGetDisk, classer, genreDisque, systemeDe, chiffrementDe, sourceSimulee, type SortieWindows } from '../src/valhalla/thjalfi/disques.ts';

const GO = 1024 ** 3;

test('genre d\'un disque : clé USB, disque externe, carte, interne', () => {
  assert.equal(genreDisque('usb', true, 16 * GO), 'cle');
  assert.equal(genreDisque('usb', true, 500 * GO), 'disque-externe');
  assert.equal(genreDisque('sd', true, 64 * GO), 'carte');
  assert.equal(genreDisque('nvme', false, 512 * GO), 'interne');
  assert.equal(genreDisque('sata', false, 1000 * GO), 'interne');
});

test('systèmes reconnus par le système de fichiers et l\'étiquette', () => {
  assert.equal(systemeDe('ntfs', 'Windows'), 'windows');
  assert.equal(systemeDe('ext4', 'ubuntu'), 'linux');
  assert.equal(systemeDe('apfs', 'Macintosh HD'), 'macos');
  assert.equal(systemeDe('vfat', 'EFI'), 'efi');
  assert.equal(systemeDe('ntfs', 'ODIN'), 'odin');
});

test('chiffrement reconnu : LUKS, BitLocker, FileVault', () => {
  assert.equal(chiffrementDe('crypto_LUKS', undefined), 'luks');
  assert.equal(chiffrementDe(undefined, 'BitLocker'), 'bitlocker');
  assert.equal(chiffrementDe('apple_corestorage', undefined), 'filevault');
  assert.equal(chiffrementDe('ext4', 'partition'), undefined);
});

test('parseLsblk : une clé USB (externe) et un disque interne chiffré LUKS', () => {
  const json = JSON.stringify({
    blockdevices: [
      { name: 'sda', path: '/dev/sda', type: 'disk', size: 512 * GO, model: 'Samsung SSD', tran: 'nvme', rm: false, children: [
        { name: 'sda1', type: 'part', size: GO, fstype: 'vfat', label: 'EFI', mountpoint: '/boot/efi' },
        { name: 'sda2', type: 'part', size: 500 * GO, fstype: 'crypto_LUKS', children: [{ name: 'root', type: 'crypt', size: 500 * GO, fstype: 'ext4', mountpoint: '/' }] },
      ] },
      { name: 'sdb', path: '/dev/sdb', type: 'disk', size: 16 * GO, model: 'Kingston DT', tran: 'usb', rm: true, children: [
        { name: 'sdb1', type: 'part', size: 16 * GO, fstype: 'exfat', label: 'ODIN' },
      ] },
    ],
  });
  const d = parseLsblk(json);
  assert.equal(d.length, 2);
  const sda = d.find((x) => x.chemin === '/dev/sda')!, sdb = d.find((x) => x.chemin === '/dev/sdb')!;
  assert.equal(sda.externe, false);
  assert.equal(sda.genre, 'interne');
  assert.equal(sda.systemeEnCours, true, 'le disque monté sur / est le système en cours');
  assert.equal(sda.partitions.find((p) => p.nom === 'sda2')!.chiffre, 'luks');
  assert.equal(sdb.externe, true);
  assert.equal(sdb.genre, 'cle');
  assert.equal(sdb.estOdin, true, 'une clé déjà ODIN est reconnue');
  const c = classer(d);
  assert.equal(c.externes.length, 1);
  assert.equal(c.internes.length, 1);
});

test('parseGetDisk : disque système interne + clé USB, BitLocker détecté', () => {
  const w: SortieWindows = {
    disks: [
      { Number: 0, FriendlyName: 'NVMe WD', Size: 512 * GO, BusType: 'NVMe', IsSystem: true },
      { Number: 1, FriendlyName: 'SanDisk USB', Size: 32 * GO, BusType: 'USB' },
    ],
    partitions: [
      { DiskNumber: 0, PartitionNumber: 1, Type: 'System', Size: 300 * 1024 ** 2 },
      { DiskNumber: 0, PartitionNumber: 2, DriveLetter: 'C', Size: 400 * GO, Type: 'Basic' },
      { DiskNumber: 1, PartitionNumber: 1, DriveLetter: 'E', Size: 32 * GO, Type: 'Basic' },
    ],
    volumes: [
      { DriveLetter: 'C', FileSystem: 'NTFS', FileSystemLabel: 'Windows', Size: 400 * GO, SizeRemaining: 100 * GO },
      { DriveLetter: 'E', FileSystem: 'exFAT', FileSystemLabel: 'ODIN', Size: 32 * GO, SizeRemaining: 32 * GO },
    ],
    bitlocker: { C: true },
  };
  const d = parseGetDisk(w);
  const c = classer(d);
  assert.equal(c.internes.length, 1);
  assert.equal(c.externes.length, 1);
  const sys = c.internes[0];
  assert.equal(sys.systemeEnCours, true);
  const win = sys.partitions.find((p) => p.montage === 'C:')!;
  assert.equal(win.systeme, 'windows');
  assert.equal(win.chiffre, 'bitlocker', 'BitLocker vu sur C:');
  assert.equal(win.utiliseOctets, 300 * GO, 'occupation = taille - restant');
  assert.equal(c.externes[0].estOdin, true);
});

test('source simulée : aucune commande, une fausse liste rendue telle quelle', async () => {
  const faux = parseLsblk(JSON.stringify({ blockdevices: [{ name: 'sdx', path: '/dev/sdx', type: 'disk', size: 8 * GO, tran: 'usb', rm: true, children: [] }] }));
  const s = sourceSimulee(faux);
  const l = await s.lister();
  assert.equal(l.length, 1);
  assert.equal(l[0].chemin, '/dev/sdx');
  // Copie défensive : modifier le résultat ne change pas la source.
  l[0].partitions.push({ nom: 'faux', tailleOctets: 0 });
  assert.equal((await s.lister())[0].partitions.length, 0);
});
