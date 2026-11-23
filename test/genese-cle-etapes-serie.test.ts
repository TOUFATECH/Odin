// Genèse · Clés USB, lot C1 : cle_disques renvoie le numéro de série de chaque disque (lsblk « serial », Get-Disk
// « SerialNumber »), et un disque interne ou celui du système n'est jamais « choisissable ». Sorties de commandes FIGÉES
// et source SIMULÉE : aucune commande n'est lancée, aucun vrai disque n'est lu.
import assert from 'node:assert/strict';
import test from 'node:test';
import { choisissable, classer, parseGetDisk, parseLsblk, serieLisible, sourceReelle, sourceSimulee, type SortieWindows } from '../src/valhalla/thjalfi/disques.ts';
import { cleUsb } from '../src/valhalla/thjalfi/cle-ecrire.ts';

const G = 1024 ** 3;

test('serie : un numéro lisible est gardé (nettoyé) ; un faux numéro partagé ne prouve rien et est ignoré', () => {
  assert.equal(serieLisible('  AA11BB227F2A  '), 'AA11BB227F2A');
  assert.equal(serieLisible('0123_4567_89AB_CDEF.'), '0123_4567_89AB_CDEF');
  for (const faux of ['', '   ', '0000000000', '0000_0000_0000', 'FFFFFFFF', '---', 'ab', null, undefined, 42]) assert.equal(serieLisible(faux), undefined, String(faux));
});

test('lsblk : chaque disque porte son numéro de série', () => {
  const json = JSON.stringify({ blockdevices: [
    { name: 'sda', path: '/dev/sda', type: 'disk', size: 512 * G, model: 'SSD FAUX', serial: 'SSDFAUX0001 ', tran: 'nvme', rm: false, children: [{ name: 'sda1', type: 'part', size: 512 * G, fstype: 'ext4', mountpoint: '/' }] },
    { name: 'sdb', path: '/dev/sdb', type: 'disk', size: 64 * G, model: 'Cle FAUSSE', serial: 'AA11BB227F2A', tran: 'usb', rm: true, children: [] },
    { name: 'sdc', path: '/dev/sdc', type: 'disk', size: 16 * G, model: 'Cle sans numero', serial: null, tran: 'usb', rm: true, children: [] },
  ] });
  const d = parseLsblk(json);
  assert.equal(d.find((x) => x.chemin === '/dev/sdb')!.serie, 'AA11BB227F2A');
  assert.equal(d.find((x) => x.chemin === '/dev/sda')!.serie, 'SSDFAUX0001');
  assert.equal('serie' in d.find((x) => x.chemin === '/dev/sdc')!, false, 'pas de numéro inventé');
});

test('Get-Disk : SerialNumber lu, et demandé à la commande', async () => {
  const w: SortieWindows = {
    disks: [{ Number: 0, FriendlyName: 'SSD FAUX', SerialNumber: 'SSDFAUX0002', Size: 512 * G, BusType: 'NVMe', IsBoot: true, IsSystem: true }, { Number: 9, FriendlyName: 'Cle FAUSSE', SerialNumber: ' AA11BB227F2A ', Size: 64 * G, BusType: 'USB' }],
    partitions: [], volumes: [],
  };
  const d = parseGetDisk(w);
  assert.equal(d.find((x) => x.id === 'physicaldrive9')!.serie, 'AA11BB227F2A');
  // La vraie source demande bien SerialNumber à Get-Disk (lanceur faux : rien n'est lancé pour de vrai).
  const vus: string[] = [];
  await sourceReelle('win32', async (_c, args) => { vus.push(args.join(' ')); return '[]'; }).lister();
  assert.ok(vus.some((a) => /Get-Disk \| Select-Object [^|]*\bSerialNumber\b/.test(a)), 'SerialNumber demandé');
});

test('choisissable : jamais un disque interne, jamais le disque du système (même en USB)', () => {
  const base = { externe: true, amovible: true };
  assert.equal(choisissable(base), true);
  assert.equal(choisissable({ externe: false, amovible: false }), false);
  assert.equal(choisissable({ ...base, systemeEnCours: true }), false);
  assert.equal(choisissable({ externe: true, amovible: false }), false);
  assert.equal(choisissable(null), false); assert.equal(choisissable(undefined), false);
});

test('cle_disques : la liste rendue à la page porte le numéro de série (source simulée)', async () => {
  const action = cleUsb().actions.find((a) => a.id === 'cle_disques')!;
  const faux = [
    { id: 'faux-cle', chemin: 'faux', modele: 'Cle FAUSSE', serie: 'AA11BB227F2A', tailleOctets: 64 * G, genre: 'cle' as const, externe: true, bus: 'usb', amovible: true, partitions: [] },
    { id: 'faux-ssd', chemin: 'faux0', modele: 'SSD FAUX', tailleOctets: 512 * G, genre: 'interne' as const, externe: false, amovible: false, systemeEnCours: true, partitions: [] },
  ];
  const r = await action.run({ settings: { cleDisquesTest: faux } } as never, {}) as { ok: boolean; data: ReturnType<typeof classer> };
  assert.equal(r.ok, true);
  assert.equal(r.data.externes[0].serie, 'AA11BB227F2A');
  assert.deepEqual(classer(await sourceSimulee(faux).lister()).internes.map((x) => x.id), ['faux-ssd']);
});

// ------------------------------------------------------------------ relecture adverse (sorties FIGÉES, rien n'est lancé)
const lsblk = (...blockdevices: unknown[]) => JSON.stringify({ blockdevices });

test('relecture : un disque interne SATA « branchable à chaud » (HOTPLUG=1, RM=0) reste interne et n\'est jamais choisissable', () => {
  const d = parseLsblk(lsblk(
    { name: 'sda', path: '/dev/sda', type: 'disk', size: 2000 * G, model: 'HDD FAUX', serial: 'HDDFAUX00001', tran: 'sata', rm: false, hotplug: true, children: [{ name: 'sda1', type: 'part', size: 2000 * G, fstype: 'ext4', mountpoint: '/srv/donnees' }] },
    { name: 'sdb', path: '/dev/sdb', type: 'disk', size: 64 * G, model: 'Cle FAUSSE', serial: 'AA11BB227F2A', tran: 'usb', rm: true, hotplug: true, children: [] },
  ));
  const hdd = d.find((x) => x.chemin === '/dev/sda')!;
  assert.equal(hdd.externe, false); assert.equal(choisissable(hdd), false);
  assert.equal(choisissable(d.find((x) => x.chemin === '/dev/sdb')), true);
});

test('relecture : un ancien lsblk rend « 0 » et « 1 » en texte : « 0 » ne veut jamais dire amovible', () => {
  const d = parseLsblk(lsblk(
    { name: 'sda', path: '/dev/sda', type: 'disk', size: String(512 * G), model: 'SSD FAUX', tran: 'sata', rm: '0', hotplug: '0', children: [] },
    { name: 'sdb', path: '/dev/sdb', type: 'disk', size: String(64 * G), model: 'Cle FAUSSE', tran: 'usb', rm: '1', hotplug: '1', children: [] },
    { name: 'sdc', path: '/dev/sdc', type: 'disk', size: String(64 * G), model: 'Lecteur FAUX', tran: '', rm: '1', hotplug: '0', children: [] },
  ));
  assert.equal(choisissable(d.find((x) => x.chemin === '/dev/sda')), false, 'rm « 0 » : interne');
  assert.equal(choisissable(d.find((x) => x.chemin === '/dev/sdb')), true);
  assert.equal(choisissable(d.find((x) => x.chemin === '/dev/sdc')), true, 'rm « 1 » : amovible');
});

test('relecture : la clé d\'où démarre un Linux « live » (montée sous /run/live/medium, /cdrom…) est le disque du système', () => {
  for (const montage of ['/run/live/medium', '/cdrom', '/run/archiso/bootmnt', '/run/initramfs/live', '/lib/live/mount/medium', '/boot/firmware', '/efi', '[SWAP]', '/usr', '/var', '/home']) {
    const d = parseLsblk(lsblk({ name: 'sdb', path: '/dev/sdb', type: 'disk', size: 32 * G, model: 'Cle FAUSSE', serial: 'AA11BB227F2A', tran: 'usb', rm: true, children: [{ name: 'sdb1', type: 'part', size: 32 * G, fstype: 'iso9660', mountpoints: [montage] }] }));
    assert.equal(d[0].systemeEnCours, true, montage); assert.equal(choisissable(d[0]), false, montage);
  }
});

test('relecture : le disque qui porte Odin lui-même (son dossier, son programme) n\'est jamais choisissable', () => {
  const l = parseLsblk(lsblk({ name: 'sdb', path: '/dev/sdb', type: 'disk', size: 256 * G, model: 'SSD USB FAUX', tran: 'usb', rm: true, children: [{ name: 'sdb1', type: 'part', size: 256 * G, fstype: 'ext4', mountpoint: '/media/moi/ODIN-DATA' }] }), undefined, ['/media/moi/ODIN-DATA/odin/.odin']);
  assert.equal(choisissable(l[0]), false);
  // « /media/moi/ODIN » n'est pas le préfixe de « /media/moi/ODIN-DATA » : un nom voisin ne compte pas.
  const l2 = parseLsblk(lsblk({ name: 'sdc', path: '/dev/sdc', type: 'disk', size: 64 * G, tran: 'usb', rm: true, children: [{ name: 'sdc1', type: 'part', size: 64 * G, fstype: 'vfat', mountpoint: '/media/moi/ODIN' }] }), undefined, ['/media/moi/ODIN-DATA/odin']);
  assert.equal(choisissable(l2[0]), true);
  const w = parseGetDisk({ disks: [{ Number: 3, FriendlyName: 'SSD USB FAUX', Size: 256 * G, BusType: 'USB', IsBoot: false, IsSystem: false }], partitions: [{ DiskNumber: 3, PartitionNumber: 1, DriveLetter: 'E', Size: 256 * G, Type: 'Basic' }], volumes: [{ DriveLetter: 'E', FileSystem: 'NTFS', Size: 256 * G, SizeRemaining: 100 * G }] }, ['e:\Odin\app']);
  assert.equal(choisissable(w[0]), false);
});

test('relecture : Get-Disk qui rend le bus en nombre (7 = USB, 11 = SATA) ne casse pas la liste et ne rend rien choisissable par erreur', () => {
  const w = parseGetDisk({ disks: [{ Number: 0, FriendlyName: 'SSD FAUX', Size: 512 * G, BusType: 11 as unknown as string }, { Number: 4, FriendlyName: 'Cle FAUSSE', Size: 64 * G, BusType: 7 as unknown as string }], partitions: [], volumes: [] });
  assert.equal(choisissable(w.find((x) => x.id === 'physicaldrive0')), false);
  assert.equal(choisissable(w.find((x) => x.id === 'physicaldrive4')), true);
});

test('relecture : deux disques au même numéro de série : ce numéro ne prouve rien, il n\'est donné pour aucun', () => {
  const d = parseLsblk(lsblk(
    { name: 'sdb', path: '/dev/sdb', type: 'disk', size: 64 * G, tran: 'usb', rm: true, serial: 'CLONE1234567', children: [] },
    { name: 'sdc', path: '/dev/sdc', type: 'disk', size: 64 * G, tran: 'usb', rm: true, serial: 'CLONE1234567', children: [] },
    { name: 'sdd', path: '/dev/sdd', type: 'disk', size: 64 * G, tran: 'usb', rm: true, serial: 'UNIQUE123456', children: [] },
  ));
  assert.deepEqual(d.map((x) => x.serie), [undefined, undefined, 'UNIQUE123456']);
  const w = parseGetDisk({ disks: [{ Number: 1, Size: 64 * G, BusType: 'USB', SerialNumber: 'CLONE1234567' }, { Number: 2, Size: 64 * G, BusType: 'USB', SerialNumber: ' CLONE1234567' }], partitions: [], volumes: [] });
  assert.deepEqual(w.map((x) => x.serie), [undefined, undefined]);
});

test('relecture : un numéro de série avec des caractères invisibles ou de sens d\'écriture (U+202E) est nettoyé', () => {
  assert.equal(serieLisible('AB\u202ECD\u200B12'), 'ABCD12');
});
