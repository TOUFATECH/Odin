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

// ---- Étape 0 (défaut trouvé par l'étude du disque chiffré, pas une demande) : sous Windows, la vraie source lit
// BitLocker par lettre. Sorties ENREGISTRÉES (texte figé) rendues par un faux lanceur : rien n'est lancé.
import { sourceReelle } from '../src/valhalla/thjalfi/disques.ts';

const W_DISQUES = JSON.stringify([{ Number: 0, FriendlyName: 'Disque interne A', Size: 512 * GO, BusType: 'NVMe', IsSystem: true }]);
const W_PARTS = JSON.stringify([
  { DiskNumber: 0, PartitionNumber: 1, Type: 'System', Size: 300 * 1024 ** 2 },
  { DiskNumber: 0, PartitionNumber: 2, DriveLetter: 'C', Size: 400 * GO, Type: 'Basic' },
  { DiskNumber: 0, PartitionNumber: 3, DriveLetter: 'D', Size: 100 * GO, Type: 'Basic' },
]);
// Get-Volume rend « NTFS » pour un volume BitLocker déverrouillé : c'est pourquoi il était vu non chiffré.
const W_VOLUMES = JSON.stringify([
  { DriveLetter: 'C', FileSystem: 'NTFS', FileSystemLabel: 'Systeme', Size: 400 * GO, SizeRemaining: 100 * GO },
  { DriveLetter: 'D', FileSystem: 'NTFS', FileSystemLabel: 'Donnees', Size: 100 * GO, SizeRemaining: 50 * GO },
]);
/** Un faux lanceur : il rend la sortie enregistrée de chaque commande et note ce qu'on lui a demandé. */
function fauxWindows(bitlocker: string | Error) {
  const vus: string[] = [];
  const lancer = async (cmd: string, args: string[]) => {
    const t = args.join(' '); vus.push(`${cmd} ${t}`);
    if (/EncryptableVolume/.test(t)) { if (bitlocker instanceof Error) throw bitlocker; return bitlocker; }
    if (/Get-Disk/.test(t)) return W_DISQUES;
    if (/Get-Partition/.test(t)) return W_PARTS;
    if (/Get-Volume/.test(t)) return W_VOLUMES;
    return '[]';
  };
  return { lancer, vus };
}
const partition = (d: Awaited<ReturnType<ReturnType<typeof sourceReelle>['lister']>>, lettre: string) => d[0].partitions.find((p) => p.montage === `${lettre}:`)!;

test('étape 0 · Windows, vraie source : un volume BitLocker protégé est vu « chiffré (BitLocker) » (il était vu non chiffré)', async () => {
  // Sortie enregistrée de la lecture BitLocker (Win32_EncryptableVolume : lettre, protection, conversion ; jamais de clé).
  const sortie = JSON.stringify({ edition: 'Professional', lecture: 'ok', volumes: [{ DriveLetter: 'C:', ProtectionStatus: 1, ConversionStatus: 1 }, { DriveLetter: 'D:', ProtectionStatus: 0, ConversionStatus: 0 }] });
  const f = fauxWindows(sortie);
  const d = await sourceReelle('win32', f.lancer).lister();
  assert.equal(partition(d, 'C').chiffre, 'bitlocker', 'C: est chiffré par BitLocker');
  assert.equal(partition(d, 'D').chiffre, undefined, 'D: n\'est pas chiffré');
  assert.equal(partition(d, 'D').chiffreInconnu, undefined, 'D: est lu, donc pas inconnu');
  assert.ok(f.vus.some((x) => /EncryptableVolume/.test(x)), 'la lecture BitLocker est lancée');
  // La commande ne demande jamais un protecteur ni une clé de récupération.
  for (const x of f.vus) assert.doesNotMatch(x, /KeyProtector|RecoveryPassword|NumericalPassword|Get-BitLockerVolume|manage-bde/i);
});

test('étape 0 · Windows : une protection BitLocker SUSPENDUE reste un disque BitLocker (Genèse n\'y touche pas)', async () => {
  const sortie = JSON.stringify({ edition: 'Professional', lecture: 'ok', volumes: [{ DriveLetter: 'C:', ProtectionStatus: 0, ConversionStatus: 1 }, { DriveLetter: 'D:', ProtectionStatus: 0, ConversionStatus: 0 }] });
  const d = await sourceReelle('win32', fauxWindows(sortie).lancer).lister();
  assert.equal(partition(d, 'C').chiffre, 'bitlocker');
});

test('étape 0 · Windows : sans les droits d\'administrateur, l\'état BitLocker est « inconnu », jamais « non chiffré »', async () => {
  for (const sortie of [
    JSON.stringify({ edition: 'Professional', lecture: 'droits-manquants', volumes: [] }),
    new Error('commande refusée'),
    '',
  ]) {
    const d = await sourceReelle('win32', fauxWindows(sortie).lancer).lister();
    for (const l of ['C', 'D']) {
      assert.equal(partition(d, l).chiffre, undefined);
      assert.equal(partition(d, l).chiffreInconnu, true, `${l}: inconnu (${sortie instanceof Error ? 'erreur' : sortie || 'vide'})`);
    }
  }
});
