// Disque d'Odin chiffré ? (SEC-28, vérifier et guider, sans rien bloquer.) Tout passe par des sorties d'outils
// ENREGISTRÉES (texte figé) rendues par un faux lanceur : aucune commande n'est lancée, aucun vrai disque n'est lu,
// aucune clé n'existe ici. Chemins et noms de volumes neutres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARGS_BITLOCKER, TEXTES, LANGUES_ECRITES, bitLockerPourGenese, chiffreParFichiers, couper, decider, etatBitLocker, largeur, lettreDe, lireBitLocker,
  lireFdesetup, lireFindmnt, phrase, pointDeMontageDf, relierLsblk, rendre, verifierDisqueOdin, windowsFamille,
  type Bilan, type Entrees,
} from '../src/securite/disque-chiffre.ts';
import { inContainer } from '../src/machines/admin.ts';

// ---------------- Faux lanceur ----------------
type Reponse = string | Error;
const absent = () => Object.assign(new Error('introuvable'), { code: 'ENOENT' });
/** Un faux lanceur : chaque règle rend la sortie enregistrée d'une commande ; tout ce qui est lancé est noté. */
function faux(regles: Array<[RegExp, Reponse]>) {
  const vus: string[] = [];
  const lancer = async (cmd: string, args: string[]) => {
    const ligne = `${cmd} ${args.join(' ')}`; vus.push(ligne);
    for (const [re, r] of regles) if (re.test(ligne)) { if (r instanceof Error) throw r; return r; }
    throw absent();
  };
  return { lancer, vus };
}
// Une commande lancée par Odin ne demande jamais un protecteur, une clé, ni ne lance un chiffrement.
const INTERDIT = /KeyProtector|RecoveryPassword|NumericalPassword|Get-BitLockerVolume|Enable-BitLocker|manage-bde|-protectors|luksDump|luksAddKey|luksFormat|dump-(volume|master)-key|cryptsetup|fdesetup (enable|changerecovery|add)|reencrypt/i;
const propre = (vus: string[]) => { for (const v of vus) assert.doesNotMatch(v, INTERDIT, v); };

const WIN = { dossier: 'C:\\Odin-essai\\donnees', cles: 'C:\\Odin-essai\\cles', application: 'C:\\Odin-essai\\app', sauvegardes: 'C:\\Odin-essai\\donnees\\sauvegardes' };
const sortieBl = (volumes: Array<[string, number, number]>, o: { edition?: string; lecture?: string } = {}) =>
  JSON.stringify({ edition: o.edition ?? 'Professional', lecture: o.lecture ?? 'ok', volumes: volumes.map(([l, p, c]) => ({ DriveLetter: l, ProtectionStatus: p, ConversionStatus: c })) });
// Aucun vrai dossier n'est lu : chaque chemin « existe », son vrai chemin est lui-même (sauf liens donnés) et l'identité
// de son volume est celle de sa lettre (sauf volumes donnés).
const idParLettre = (p: string) => lettreDe(p)?.charCodeAt(0);
const windows = async (r: Reponse, chemins: Entrees['chemins'] = WIN, o: { liens?: Record<string, string | Error>; volumes?: Record<string, number> } = {}) => {
  const f = faux([[/EncryptableVolume/, r]]);
  const reel = (p: string) => { const l = o.liens?.[p]; if (l instanceof Error) throw l; return l ?? p; };
  const b = await verifierDisqueOdin({ plateforme: 'win32', chemins, lancer: f.lancer, existe: () => true, reel, idVolume: (p) => o.volumes?.[p] ?? idParLettre(p) });
  propre(f.vus);
  return b;
};

// ---------------- Lecteurs purs ----------------
test('BitLocker : protection et conversion lues en nombres, le doute vaut « inconnu »', () => {
  assert.equal(etatBitLocker(1, 1), 'protege');
  assert.equal(etatBitLocker(0, 1), 'suspendu');
  assert.equal(etatBitLocker(2, 1), 'verrouille');
  assert.equal(etatBitLocker(0, 0), 'non-chiffre');
  for (const c of [2, 3]) assert.equal(etatBitLocker(1, c), 'en-cours');
  // 4 et 5 : conversion EN PAUSE, qui ne reprend pas seule (ce n'est pas « en cours »).
  for (const c of [4, 5]) assert.equal(etatBitLocker(1, c), 'en-pause');
  assert.equal(bitLockerPourGenese('en-pause'), true, 'Genèse ne touche pas un volume BitLocker en pause');
  for (const [p, c] of [[undefined, undefined], [2, 0], ['On', 'FullyEncrypted'], [1, 9], [null, 1]] as Array<[unknown, unknown]>) assert.equal(etatBitLocker(p, c), 'inconnu', `${p}/${c}`);
  assert.deepEqual(lireBitLocker(sortieBl([['C:', 1, 1], ['D:', 0, 0]])).parLettre, { C: 'protege', D: 'non-chiffre' });
  assert.equal(lireBitLocker(sortieBl([['C:', 1, 1]])).edition, 'Professional');
  // Un seul volume rendu comme un objet (PowerShell) : lu pareil.
  assert.deepEqual(lireBitLocker(JSON.stringify({ lecture: 'ok', volumes: { DriveLetter: 'C:', ProtectionStatus: 1, ConversionStatus: 1 } })).parLettre, { C: 'protege' });
  for (const t of ['', 'n\'importe quoi', '[]', 'null', JSON.stringify({ lecture: 'bizarre', volumes: [] })]) assert.equal(lireBitLocker(t).lecture, 'illisible', t);
  // Droits manquants : rien n'est retenu, même si des volumes traînent dans la sortie.
  assert.deepEqual(lireBitLocker(sortieBl([['C:', 1, 1]], { lecture: 'droits-manquants' })), { lecture: 'droits-manquants', edition: 'Professional', parLettre: {} });
  assert.equal(bitLockerPourGenese('suspendu'), true);
  assert.equal(bitLockerPourGenese('non-chiffre'), false);
  assert.equal(bitLockerPourGenese(undefined), 'inconnu');
  assert.equal(windowsFamille('Core'), true); assert.equal(windowsFamille('CoreSingleLanguage'), true); assert.equal(windowsFamille('Professional'), false);
  assert.equal(lettreDe('d:\\x'), 'D'); assert.equal(lettreDe('\\\\?\\E:\\x'), 'E'); assert.equal(lettreDe('\\\\serveur-a\\partage'), undefined);
});

test('la commande BitLocker ne lit que la lettre, la protection, la conversion et l\'édition', () => {
  const t = ARGS_BITLOCKER.join(' ');
  assert.match(t, /Win32_EncryptableVolume/);
  assert.match(t, /Select-Object DriveLetter,ProtectionStatus,ConversionStatus\)/);
  assert.doesNotMatch(t, INTERDIT);
  assert.doesNotMatch(t, /GetKeyProtector|Invoke-CimMethod|ProtectKey|Encrypt\b/i, 'aucune méthode de la classe n\'est appelée');
});

test('Linux et macOS : findmnt, lsblk, lsattr, fdesetup, df lus sans rien lancer', () => {
  assert.deepEqual(lireFindmnt('{"filesystems":[{"source":"/dev/sda2[/@donnees]","target":"/","fstype":"btrfs"}]}'), { source: '/dev/sda2', cible: '/', fstype: 'btrfs' });
  assert.equal(lireFindmnt('pas du json'), undefined);
  assert.equal(chiffreParFichiers('--------------e-----E-- /srv/odin-essai\n'), true);
  assert.equal(chiffreParFichiers('--------------e------- /srv/odin-essai\n'), false);
  assert.equal(chiffreParFichiers('lsattr: Operation not supported While reading flags on /srv/odin-essai'), false);
  assert.equal(lireFdesetup('FileVault is On.\n').etat, 'chiffre');
  assert.equal(lireFdesetup('FileVault is Off.\n').etat, 'pas-chiffre');
  assert.equal(lireFdesetup('FileVault is On.\nDecryption in progress: Percent completed = 40.0\n').raison, 'filevault-en-cours');
  assert.equal(lireFdesetup('Encryption in progress: Percent completed = 12.5\n').etat, 'pas-chiffre');
  assert.equal(lireFdesetup('').etat, 'inconnu');
  assert.equal(pointDeMontageDf('Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3s5 100 50 50 50% /System/Volumes/Data\n'), '/System/Volumes/Data');
  assert.equal(pointDeMontageDf('Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk5s1 100 50 50 50% /Volumes/Disque Externe\n'), '/Volumes/Disque Externe');
  assert.equal(pointDeMontageDf(''), undefined);
  assert.equal(decider([]), 'inconnu', 'rien de vérifié : jamais « chiffré »');
});

// ---------------- Windows ----------------
test('Windows : tous les volumes BitLocker protégés → chiffré, sans pas-à-pas', async () => {
  const b = await windows(sortieBl([['C:', 1, 1]]));
  assert.equal(b.decision, 'chiffre');
  assert.equal(b.volumes.length, 4);
  const r = rendre(b, 'fr');
  assert.equal(r.symbole, '✓');
  assert.equal(r.ligne, 'Disque d\'Odin : chiffré');
  assert.deepEqual(r.guide, []);
  assert.deepEqual(r.details, ['C: — dossier d\'Odin, clé de la machine, application, sauvegardes : chiffré par BitLocker, protection active']);
});

test('Windows : volume non chiffré → pas chiffré, et le pas-à-pas laisse la personne faire', async () => {
  const b = await windows(sortieBl([['C:', 0, 0]]));
  assert.equal(b.decision, 'pas-chiffre');
  const r = rendre(b, 'fr');
  assert.equal(r.symbole, '✗');
  const g = r.guide.join('\n');
  assert.match(g, /odin backup/);
  assert.match(g, /active BitLocker sur C:/);
  assert.match(g, /compte Microsoft.*autre option/);
  assert.match(g, /ni toi ni Odin/);
  assert.match(g, /Odin ne lance aucun chiffrement et ne lit jamais la clé/);
});

test('Windows : protection SUSPENDUE → pas « chiffré » ; reprise guidée', async () => {
  const b = await windows(sortieBl([['C:', 0, 1]]));
  assert.equal(b.decision, 'pas-chiffre');
  const g = rendre(b, 'fr').guide.join('\n');
  assert.match(g, /suspendue sur C:/);
  assert.doesNotMatch(g, /active BitLocker/, 'on ne pousse pas à chiffrer un disque déjà chiffré');
});

test('Windows : le dossier d\'Odin sur un autre volume compte (C: protégé, D: non) ; un lecteur inconnu de BitLocker → inconnu', async () => {
  const autre = { ...WIN, dossier: 'D:\\Odin-essai\\donnees', sauvegardes: 'E:\\sauvegardes' };
  const b = await windows(sortieBl([['C:', 1, 1], ['D:', 0, 0]]), autre);
  assert.equal(b.decision, 'pas-chiffre');
  assert.equal(b.volumes.find((v) => v.role === 'dossier')!.etat, 'pas-chiffre');
  assert.equal(b.volumes.find((v) => v.role === 'sauvegardes')!.raison, 'volume-absent');
  const b2 = await windows(sortieBl([['C:', 1, 1]]), { ...WIN, sauvegardes: 'E:\\sauvegardes' });
  assert.equal(b2.decision, 'inconnu', 'C: chiffré mais E: invérifiable : pas « chiffré »');
  assert.match(rendre(b2, 'fr').guide.join('\n'), /je ne peux pas vérifier \(E:\)/);
  const b3 = await windows(sortieBl([['C:', 1, 1]]), { ...WIN, sauvegardes: '\\\\serveur-a\\partage' });
  assert.equal(b3.decision, 'inconnu');
});

test('Windows : droits manquants, outil absent, sortie vide ou erreur → « je ne peux pas le savoir », jamais « chiffré » ni un appel à chiffrer', async () => {
  for (const r of [sortieBl([], { lecture: 'droits-manquants' }), '', 'Accès refusé', new Error('refusé')]) {
    const b = await windows(r);
    assert.equal(b.decision, 'inconnu', String(r));
    const g = rendre(b, 'fr').guide.join('\n');
    assert.match(g, /terminal en administrateur/);
    assert.doesNotMatch(g, /active BitLocker/);
    // Rien à chiffrer ici : pas la phrase de fin, et « relance odin doctor » une seule fois.
    assert.doesNotMatch(g, /c'est toi qui le fais/);
    assert.equal(g.match(/relance « odin doctor »/g)?.length, 1, g);
  }
  // L'outil du système absent : les droits d'administrateur n'y changeraient rien, on ne les demande pas.
  for (const r of [sortieBl([], { lecture: 'outil-absent' }), absent()]) {
    const b = await windows(r);
    assert.equal(b.decision, 'inconnu', String(r));
    const g = rendre(b, 'fr').guide.join('\n');
    assert.doesNotMatch(g, /terminal en administrateur/, String(r));
    assert.match(g, /ne donne pas l'état de BitLocker/);
    assert.doesNotMatch(g, /active BitLocker/);
  }
});

test('Windows : un lien, une jonction ou un dossier monté vers un autre volume ne donne jamais un faux « chiffré »', async () => {
  const bl = sortieBl([['C:', 1, 1], ['D:', 0, 0]]);
  // Le dossier d'Odin, écrit sous C: (protégé), est une jonction vers D: (pas chiffré) : c'est D: qui compte.
  const b = await windows(bl, WIN, { liens: { [WIN.dossier]: 'D:\\cible-essai' } });
  assert.equal(b.decision, 'pas-chiffre');
  const d = b.volumes.find((v) => v.role === 'dossier')!;
  assert.equal(d.volume, 'D:');
  assert.equal(d.chemin, WIN.dossier, 'le chemin montré reste celui d\'Odin');
  // Un volume monté dans un dossier de C:, sans lettre : son identité n'est pas celle de C: → je ne peux pas le savoir.
  const b2 = await windows(bl, WIN, { volumes: { [WIN.sauvegardes]: 4242 } });
  assert.equal(b2.decision, 'inconnu');
  assert.equal(b2.volumes.find((v) => v.role === 'sauvegardes')!.raison, 'dossier-non-relie');
  // Le vrai chemin ne se lit pas, ou ne rend pas de lettre : je ne peux pas le savoir.
  for (const lien of [new Error('refusé'), '\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\essai']) {
    const b3 = await windows(bl, WIN, { liens: { [WIN.cles]: lien } });
    assert.equal(b3.decision, 'inconnu', String(lien));
    assert.equal(b3.volumes.find((v) => v.role === 'cles')!.raison, 'dossier-non-relie');
  }
  // Le vrai chemin est sur le réseau : son disque est ailleurs.
  const b4 = await windows(sortieBl([['C:', 1, 1]]), WIN, { liens: { [WIN.application]: '\\\\serveur-a\\partage\\app' } });
  assert.equal(b4.decision, 'inconnu');
  assert.equal(b4.volumes.find((v) => v.role === 'application')!.raison, 'chemin-reseau');
});

test('Windows : conversion BitLocker EN PAUSE → pas chiffré, et le guide dit qu\'elle ne reprendra pas seule', async () => {
  const b = await windows(sortieBl([['C:', 1, 4]]));
  assert.equal(b.decision, 'pas-chiffre');
  assert.ok(b.volumes.every((v) => v.raison === 'bitlocker-en-pause'));
  const g = rendre(b, 'fr').guide.join('\n');
  assert.match(g, /en pause sur C: et ne reprendra pas seul/);
  assert.doesNotMatch(g, /laisse-le finir/);
  assert.doesNotMatch(g, /active BitLocker/);
  assert.match(g, /c'est toi qui le fais/);
});

test('Windows Famille DÉJÀ chiffrée (chiffrement de l\'appareil) : ✓, et un mot sur la clé peut-être gardée sur le compte Microsoft', async () => {
  const b = await windows(sortieBl([['C:', 1, 1]], { edition: 'Core' }));
  assert.equal(b.decision, 'chiffre');
  const r = rendre(b, 'fr');
  assert.equal(r.symbole, '✓');
  const g = r.guide.join('\n');
  assert.match(g, /compte Microsoft/);
  assert.match(g, /hors de la machine/);
  assert.doesNotMatch(g, /c'est toi qui le fais|active BitLocker/);
  // Une Pro chiffrée : toujours rien à dire.
  assert.deepEqual(rendre(await windows(sortieBl([['C:', 1, 1]])), 'fr').guide, []);
});

test('affichage : un chemin réseau a son partage en tête ; le japonais sépare par « 、 » ; rien à faire → pas de phrase de fin', async () => {
  const b = await windows(sortieBl([['C:', 1, 1]]), { ...WIN, sauvegardes: '\\\\serveur-a\\partage\\odin' });
  const det = rendre(b, 'fr').details;
  assert.ok(det.some((d) => d.startsWith('\\\\serveur-a\\partage — sauvegardes : ')), det.join('\n'));
  const ja = rendre(await windows(sortieBl([['C:', 1, 1]])), 'ja');
  assert.match(ja.details[0], /Odin のフォルダー、マシンの鍵、アプリケーション、バックアップ/);
  const famille = rendre(await windows(sortieBl([], { edition: 'Core', lecture: 'outil-absent' })), 'fr').guide.join('\n');
  assert.doesNotMatch(famille, /c'est toi qui le fais/);
});

test('affichage : les phrases sont coupées aux espaces, à la largeur du terminal, le japonais compté double', () => {
  const t = phrase('guide.windows.famille', 'fr');
  for (const l of [40, 60, 80, 120]) {
    const lignes = couper(t, l);
    for (const x of lignes) assert.ok(largeur(x) <= l, `${l} : ${x}`);
    assert.equal(lignes.join(' '), t, 'aucun mot coupé ni perdu');
  }
  assert.equal(largeur('確認'), 4);
  const j = phrase('guide.windows.famille', 'ja');
  const lj = couper(j, 40);
  for (const x of lj) assert.ok(largeur(x) <= 40, x);
  assert.equal(lj.join('').replace(/\s/g, ''), j.replace(/\s/g, ''), 'rien de perdu en japonais');
  assert.deepEqual(couper('', 40), ['']);
});

test('Windows Famille sans BitLocker : Odin le dit et n\'oriente pas vers le chiffrement qui envoie la clé chez Microsoft', async () => {
  const b = await windows(sortieBl([], { edition: 'Core', lecture: 'outil-absent' }));
  assert.equal(b.windowsFamille, true);
  const g = rendre(b, 'fr').guide.join('\n');
  assert.match(g, /Famille\) n'a pas BitLocker/);
  assert.match(g, /Odin ne te le conseille pas/);
  assert.doesNotMatch(g, /active BitLocker|Gérer BitLocker/);
  // Même sur une Famille où la lecture a marché et le volume n'est pas chiffré.
  const b2 = await windows(sortieBl([['C:', 0, 0]], { edition: 'Core' }));
  assert.equal(b2.decision, 'pas-chiffre');
  assert.doesNotMatch(rendre(b2, 'fr').guide.join('\n'), /active BitLocker/);
});

// ---------------- Linux ----------------
const LSBLK = JSON.stringify({ blockdevices: [
  { name: 'sda', kname: 'sda', path: '/dev/sda', type: 'disk', children: [
    { name: 'sda1', kname: 'sda1', path: '/dev/sda1', type: 'part', fstype: 'vfat' },
    { name: 'sda2', kname: 'sda2', path: '/dev/sda2', type: 'part', fstype: 'crypto_LUKS', children: [
      { name: 'luks-essai', kname: 'dm-0', path: '/dev/mapper/luks-essai', type: 'crypt', fstype: 'LVM2_member', children: [
        { name: 'vg-racine', kname: 'dm-1', path: '/dev/mapper/vg-racine', type: 'lvm', fstype: 'ext4' },
      ] },
    ] },
  ] },
  { name: 'sdb', kname: 'sdb', path: '/dev/sdb', type: 'disk', children: [
    { name: 'sdb1', kname: 'sdb1', path: '/dev/sdb1', type: 'part', fstype: 'ext4' },
    { name: 'sdb2', kname: 'sdb2', path: '/dev/sdb2', type: 'part', fstype: 'LVM2_member', children: [{ name: 'vg2-donnees', kname: 'dm-2', path: '/dev/mapper/vg2-donnees', type: 'lvm', fstype: 'ext4' }] },
  ] },
  { name: 'sdc', kname: 'sdc', path: '/dev/sdc', type: 'disk', children: [
    { name: 'sdc1', kname: 'sdc1', path: '/dev/sdc1', type: 'part', fstype: 'crypto_LUKS', children: [
      { name: 'luks-c', kname: 'dm-3', path: '/dev/mapper/luks-c', type: 'crypt', fstype: 'LVM2_member', children: [{ name: 'vg2-donnees', kname: 'dm-2', path: '/dev/mapper/vg2-donnees', type: 'lvm', fstype: 'ext4' }] },
    ] },
  ] },
] });
const fm = (source: string, target = '/', fstype = 'ext4') => JSON.stringify({ filesystems: [{ source, target, fstype }] });
const LIN = { dossier: '/srv/odin-essai/donnees', cles: '/etc/odin-essai/cles', application: '/opt/odin-essai/app', sauvegardes: '/srv/odin-essai/donnees/sauvegardes' };
const linux = async (regles: Array<[RegExp, Reponse]>, conteneur?: Entrees['conteneur']) => {
  const f = faux(regles);
  const b = await verifierDisqueOdin({ plateforme: 'linux', chemins: LIN, lancer: f.lancer, existe: () => true, ...(conteneur ? { conteneur } : {}) });
  propre(f.vus);
  return { b, vus: f.vus };
};
const ATTR = '--------------e------- x';

test('Linux : volume sous LUKS (LVM dans LUKS) → chiffré ; sans LUKS → pas chiffré ; LVM à moitié sous LUKS → pas chiffré', async () => {
  assert.deepEqual(relierLsblk(LSBLK, '/dev/mapper/vg-racine'), { etat: 'chiffre', raison: 'luks' });
  assert.deepEqual(relierLsblk(LSBLK, '/dev/dm-1'), { etat: 'chiffre', raison: 'luks' });
  assert.deepEqual(relierLsblk(LSBLK, '/dev/sdb1'), { etat: 'pas-chiffre', raison: 'sans-luks' });
  assert.deepEqual(relierLsblk(LSBLK, '/dev/mapper/vg2-donnees'), { etat: 'pas-chiffre', raison: 'luks-partiel' });
  assert.deepEqual(relierLsblk(LSBLK, '/dev/nvme9n1p1'), { etat: 'inconnu', raison: 'dossier-non-relie' });
  assert.deepEqual(relierLsblk('{}', '/dev/sda2'), { etat: 'inconnu', raison: 'illisible' });
  const { b } = await linux([[/^lsblk/, LSBLK], [/^findmnt/, fm('/dev/mapper/vg-racine')], [/^lsattr/, ATTR]]);
  assert.equal(b.decision, 'chiffre');
  assert.deepEqual(rendre(b, 'fr').guide, []);
  const { b: b2 } = await linux([[/^lsblk/, LSBLK], [/^findmnt/, fm('/dev/sdb1', '/srv')], [/^lsattr/, ATTR]]);
  assert.equal(b2.decision, 'pas-chiffre');
  assert.match(rendre(b2, 'fr').guide.join('\n'), /réinstaller le système en cochant le chiffrement du disque \(LUKS\)/);
});

test('Linux : le dossier d\'Odin sur un autre volume, non chiffré, l\'emporte sur une racine chiffrée', async () => {
  const { b } = await linux([[/^lsblk/, LSBLK], [/^findmnt .*\/srv\/odin-essai/, fm('/dev/sdb1', '/srv')], [/^findmnt/, fm('/dev/mapper/vg-racine')], [/^lsattr/, ATTR]]);
  assert.equal(b.decision, 'pas-chiffre');
  assert.equal(b.volumes.find((v) => v.role === 'application')!.etat, 'chiffre');
  assert.equal(b.volumes.find((v) => v.role === 'dossier')!.etat, 'pas-chiffre');
});

test('Linux : conteneur LXC en cgroup v2 (pas de /lxc/ dans /proc/self/cgroup, container=lxc seulement dans /proc/1/environ) → conteneur, rien n\'est lu', async () => {
  // Ce que voit inContainer avec ce /proc/self/cgroup et sans variable : rien.
  const vu = inContainer('0::/\n', {}, () => false);
  assert.equal(vu, false, 'inContainer seul ne le voit pas');
  // selfIdentity, lui, lit container=lxc dans /proc/1/environ et rend « conteneur LXC ».
  const { b, vus } = await linux([[/^lsblk/, LSBLK], [/^findmnt/, fm('/dev/mapper/vg-racine')]], { inContainer: vu, identite: 'conteneur LXC' });
  assert.equal(b.decision, 'conteneur');
  assert.deepEqual(vus, [], 'aucune commande : lsblk montrerait les disques de l\'hôte');
  const r = rendre(b, 'fr');
  assert.equal(r.symbole, '?');
  assert.match(r.guide.join('\n'), /Vérifie sur l'hôte/);
  // L'autre détecteur seul suffit aussi.
  assert.equal((await linux([], { inContainer: true })).b.decision, 'conteneur');
});

test('Linux : dossier sous fscrypt (drapeau E) ou eCryptfs → inconnu, ni « chiffré » ni « pas chiffré »', async () => {
  const { b } = await linux([[/^lsblk/, LSBLK], [/^findmnt/, fm('/dev/sdb1', '/srv')], [/^lsattr/, '--------------e-----E-- /srv/odin-essai/donnees']]);
  assert.equal(b.decision, 'inconnu');
  assert.ok(b.volumes.every((v) => v.raison === 'chiffrement-fichiers'));
  assert.match(rendre(b, 'fr').guide.join('\n'), /fichier par fichier ne protège pas tout le disque/);
  const { b: b2 } = await linux([[/^lsblk/, LSBLK], [/^findmnt/, fm('/home/.ecryptfs/essai/.Private', '/home/essai', 'ecryptfs')]]);
  assert.equal(b2.decision, 'inconnu');
  assert.equal(b2.volumes[0].raison, 'chiffrement-fichiers');
});

test('Linux : outil absent, sortie illisible, montage qui n\'est pas un disque (overlay, réseau) → inconnu', async () => {
  for (const regles of [
    [[/^findmnt/, fm('/dev/mapper/vg-racine')]], // lsblk absent
    [[/^lsblk/, LSBLK]], // findmnt absent
    [[/^lsblk/, 'pas du json'], [/^findmnt/, fm('/dev/mapper/vg-racine')]],
    [[/^lsblk/, LSBLK], [/^findmnt/, fm('overlay', '/', 'overlay')]],
    [[/^lsblk/, LSBLK], [/^findmnt/, fm('serveur-a:/partage', '/srv', 'nfs4')]],
    [[/^lsblk/, LSBLK], [/^findmnt/, fm('/dev/nvme9n1p1')]],
  ] as Array<Array<[RegExp, Reponse]>>) {
    const { b } = await linux(regles);
    assert.equal(b.decision, 'inconnu', JSON.stringify(regles.map(([re]) => String(re))));
    assert.match(rendre(b, 'fr').guide.join('\n'), /je ne peux pas vérifier/);
  }
});

// ---------------- macOS ----------------
test('macOS : FileVault actif sur le disque de démarrage → chiffré ; désactivé → pas chiffré ; disque externe ou outil absent → inconnu', async () => {
  const DF = (mp: string) => `Filesystem 512-blocks Used Available Capacity Mounted on\n/dev/disk3s5 100 50 50 50% ${mp}\n`;
  const mac = async (regles: Array<[RegExp, Reponse]>) => { const f = faux(regles); const b = await verifierDisqueOdin({ plateforme: 'darwin', chemins: { dossier: '/Users/essai/.odin', application: '/Users/essai/odin-app' }, lancer: f.lancer, existe: () => true }); propre(f.vus); return b; };
  assert.equal((await mac([[/^fdesetup status/, 'FileVault is On.\n'], [/^df/, DF('/System/Volumes/Data')]])).decision, 'chiffre');
  const off = await mac([[/^fdesetup status/, 'FileVault is Off.\n'], [/^df/, DF('/')]]);
  assert.equal(off.decision, 'pas-chiffre');
  assert.match(rendre(off, 'fr').guide.join('\n'), /FileVault → Activer/);
  assert.equal((await mac([[/^fdesetup status/, 'FileVault is On.\n'], [/^df .*\.odin/, DF('/Volumes/Externe')], [/^df/, DF('/')]])).decision, 'inconnu');
  assert.equal((await mac([[/^df/, DF('/')]])).decision, 'inconnu');
});

test('jamais « chiffré » par défaut : des sorties au hasard ne donnent jamais « chiffré »', async () => {
  const dechets = ['', 'null', '{}', '[]', 'erreur', '{"lecture":"ok"}', '{"lecture":"ok","volumes":[{"DriveLetter":"C:"}]}', '{"lecture":"ok","volumes":[{"DriveLetter":"C:","ProtectionStatus":"1"}]}'];
  for (const d of dechets) {
    assert.notEqual((await windows(d)).decision, 'chiffre', `windows ${d}`);
    assert.notEqual((await linux([[/^lsblk/, d], [/^findmnt/, d], [/^lsattr/, d]])).b.decision, 'chiffre', `linux ${d}`);
  }
  const autre = await verifierDisqueOdin({ plateforme: 'freebsd', chemins: { dossier: '/srv/odin-essai' }, lancer: faux([]).lancer });
  assert.equal(autre.decision, 'inconnu');
});

// ---------------- Les phrases ----------------
test('phrases : chaque langue écrite a toutes les phrases, repli anglais puis français, et aucune ne fait lancer un chiffrement par Odin', () => {
  const cles = Object.keys(TEXTES.fr).sort();
  assert.deepEqual([...LANGUES_ECRITES].sort(), ['de', 'en', 'es', 'fr', 'ja']);
  for (const l of LANGUES_ECRITES) {
    assert.deepEqual(Object.keys(TEXTES[l]).sort(), cles, l);
    for (const [k, v] of Object.entries(TEXTES[l])) {
      assert.ok(v.trim(), `${l}.${k} vide`);
      assert.doesNotMatch(v, INTERDIT, `${l}.${k}`);
      // Les paramètres sont les mêmes que ceux du français.
      assert.deepEqual(v.match(/\{\w+\}/g) ?? [], TEXTES.fr[k as keyof typeof TEXTES.fr].match(/\{\w+\}/g) ?? [], `${l}.${k}`);
    }
  }
  assert.equal(phrase('titre', 'de-DE'), 'Odins Laufwerk');
  assert.equal(phrase('titre', 'sw'), 'Odin\'s disk', 'langue pas encore écrite : l\'anglais');
  assert.equal(phrase('titre'), 'Disque d\'Odin', 'sans langue : le français');
  const b: Bilan = { decision: 'inconnu', systeme: 'windows', volumes: [{ role: 'dossier', chemin: 'C:\\x', volume: 'C:', etat: 'inconnu', raison: 'droits-manquants' }] };
  assert.equal(rendre(b, 'ja').ligne, 'Odin のディスク：確認できません');
  assert.equal(rendre(b, 'en').ligne, 'Odin\'s disk: I can\'t tell');
});
