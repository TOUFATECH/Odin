// Hydre · la bibliothèque d'ISO (commune avec Andromède) : importer une ISO (dossier, lien, envoi en morceaux),
// toujours par l'antivirus ; choisir une ISO de la bibliothèque à la création d'une VM, Hydre réglant ce qu'il faut
// selon le système (Windows : UEFI, TPM, pilotes virtio ; macOS : limites dites ; Linux : virtio) ; une machine où un
// virus est trouvé part en quarantaine. Aucune vraie machine : fausses commandes (QEMU, LXC), fausses ISO (petits
// fichiers), et un « EICAR simulé » : un fichier inoffensif dont l'empreinte est dans la base de signatures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { intelOf } from '../src/valhalla/modules/ullr.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { dossierMorceaux, idEnvoi } from '../src/valhalla/ymir/bibliotheque.ts';
import { archDuNom, editionDuNom, profilVm, systemeDuNom } from '../src/valhalla/ymir/isos.ts';
import { qemuArgs, type Machine } from '../src/valhalla/ymir/local.ts';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
type Alerte = { level: string; title: string; detail?: string };
type Iso = { id: string; nom: string; chemin: string; systeme: string; detail: string; distribution?: string; origine: string; sha256?: string; antivirus?: { verdict: string }; profil?: { uefi: boolean; tpm: boolean; disque: string; reseau: string; pilotes?: string; notes: string[]; avertissement?: string } };

function monde(o: { outils?: RegExp } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'odin-hiso-')), alertes: Alerte[] = [], lancees: string[][] = [], web = new Map<string, Buffer>();
  const outils = o.outils ?? /qemu-system-x86_64|qemu-img|ip$|lxc-/;
  const etat = new Map<string, string>();
  const run = async (cmd: string, args: string[]) => {
    lancees.push([cmd, ...args]);
    if (cmd === 'sh') return { code: outils.test(args[1] ?? '') ? 0 : 1, out: '', err: '' };
    if (cmd === 'ping') return { code: 1, out: '', err: '' };
    const P = args[args.indexOf('-P') + 1], name = args[args.indexOf('-n') + 1];
    if (cmd === 'lxc-create') { mkdirSync(join(P, name, 'rootfs', 'etc'), { recursive: true }); writeFileSync(join(P, name, 'config'), `lxc.rootfs.path = dir:${join(P, name, 'rootfs')}\nlxc.uts.name = ${name}\n`); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-start') { etat.set(name, 'RUNNING'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-stop') { etat.set(name, 'STOPPED'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-info') return { code: 0, out: `Name: ${name}\nState: ${etat.get(name) ?? 'STOPPED'}\n`, err: '' };
    return { code: 0, out: '', err: '' };
  };
  const fetchFn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input), b = web.get(url); if (!b) return new Response('introuvable', { status: 404 });
    const range = /bytes=(\d+)-/.exec(String((init?.headers as Record<string, string> | undefined)?.range ?? ''));
    return range ? new Response(b.subarray(Number(range[1])), { status: 206 }) : new Response(b, { status: 200, headers: { 'content-length': String(b.length) } });
  };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: run as never, fetch: fetchFn as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  v.events.on('alert', (a: Alerte) => alertes.push(a));
  const espace = join(home, 'nas', 'iso');
  const signer = (c: Buffer) => { intelOf(v.ctx('ullr')).build([{ hashes: [{ sha: sha(c), family: 'Agent-simulé' }], stamp: { id: 'essai', at: new Date().toISOString(), count: 1, licence: 'essai' } }]); };
  const isos = async () => ((await v.act('ymir', 'bibliotheque_iso')).data as { isos: Iso[] }).isos;
  return { v, home, alertes, lancees, web, espace, signer, isos, act: (a: string, i: Record<string, unknown> = {}, o2: { auto?: boolean } = {}) => v.act('ymir', a, i, o2), fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('reconnaître le système d\'une ISO (par son nom quand elle n\'est pas lisible) : Windows, macOS, Linux et sa distribution, autre', () => {
  assert.deepEqual(systemeDuNom('ubuntu-24.04.3-desktop-amd64.iso'), { systeme: 'Linux', detail: 'Ubuntu 24.04.3', distribution: 'Ubuntu', version: '24.04.3' });
  assert.equal(systemeDuNom('debian-13.2.0-amd64-netinst.iso').detail, 'Debian 13.2.0');
  assert.deepEqual([systemeDuNom('Win11_24H2_French_x64.iso').systeme, systemeDuNom('Win11_24H2_French_x64.iso').detail], ['Windows', 'Windows 11']);
  assert.equal(systemeDuNom('fr-fr_windows_server_2025_x64.iso').systeme, 'Windows');
  assert.deepEqual([systemeDuNom('Install-macOS-Sequoia-15.1.iso').systeme, systemeDuNom('Install-macOS-Sequoia-15.1.iso').detail], ['macOS', 'macOS Sequoia']);
  assert.deepEqual([systemeDuNom('linuxmint-22-cinnamon-64bit.iso').distribution, systemeDuNom('nixos-24.11-gnome-x86_64.iso').distribution, systemeDuNom('manjaro-kde-24.1.iso').systeme], ['Linux Mint', 'NixOS', 'Linux']);
  assert.equal(systemeDuNom('virtio-win-0.1.262.iso').pilotes, true);
  assert.equal(systemeDuNom('outil-inconnu.iso').systeme, 'Autre');
  assert.deepEqual([archDuNom('debian-13.2.0-amd64-netinst.iso'), archDuNom('ubuntu-24.04-live-server-arm64.iso'), archDuNom('vieux-i386.iso'), archDuNom('sans.iso')], ['x86_64', 'arm64', 'x86 (32 bits)', undefined]);
  assert.deepEqual([editionDuNom('ubuntu-24.04.3-live-server-amd64.iso'), editionDuNom('ubuntu-24.04.3-desktop-amd64.iso'), editionDuNom('debian-13.2.0-amd64-netinst.iso'), editionDuNom('Rocky-9.6-x86_64-minimal.iso')], ['serveur', 'bureau', 'installation par le réseau', 'minimale']);
});

test('ce qu\'Hydre règle selon le système : Windows (UEFI, TPM, pilotes virtio si possible), macOS (limites dites), Linux (virtio)', () => {
  const pc = { ovmf: true, swtpm: true, kvm: true };
  const w = profilVm({ systeme: 'Windows', detail: 'Windows 11' }, pc, '/iso/virtio-win.iso');
  assert.deepEqual([w.uefi, w.tpm, w.disque, w.reseau, w.pilotes], [true, true, 'virtio', 'virtio', '/iso/virtio-win.iso']); assert.equal(w.avertissement, undefined);
  assert.ok(w.notes.some((n) => /UEFI/.test(n)) && w.notes.some((n) => /TPM 2\.0/.test(n)) && w.notes.some((n) => /Pilotes virtio \(virtio-win\.iso\)/.test(n)));
  // Sans pilotes ni swtpm : du matériel que Windows connaît seul, et c'est dit.
  const w2 = profilVm({ systeme: 'Windows', detail: 'Windows 11' }, { ovmf: false, swtpm: false, kvm: false });
  assert.deepEqual([w2.uefi, w2.tpm, w2.disque, w2.reseau], [false, false, 'sata', 'e1000']);
  assert.ok(w2.notes.some((n) => /Windows 11 refusera de continuer/.test(n)) && w2.notes.some((n) => /SATA et carte réseau e1000/.test(n)) && w2.notes.some((n) => /pas KVM/.test(n)));
  const m = profilVm({ systeme: 'macOS', detail: 'macOS Sequoia' }, pc);
  assert.match(m.avertissement!, /licence d'Apple ne l'autorise que sur du matériel Apple[\s\S]*OpenCore/);
  const l = profilVm({ systeme: 'Linux', detail: 'Debian 13' }, pc);
  assert.deepEqual([l.uefi, l.tpm, l.disque, l.reseau, l.avertissement], [true, false, 'virtio', 'virtio', undefined]);
  // La ligne de commande QEMU suit le profil.
  const vm = { id: 'a1', nom: 'win', genre: 'vm', cpu: 2, ram: 4096, mac: '02:0d:1e:00:00:01', uefi: true, profil: { disque: 'sata', reseau: 'e1000', tpm: true, pilotes: '/iso/virtio-win.iso' } } as unknown as Machine;
  const a = qemuArgs(vm, '/vm/win', { kvm: true, ovmf: '/ovmf.fd', installer: '/iso/Win11.iso', tpm: '/vm/win/tpm.sock' }).join(' ');
  assert.match(a, /-device ahci,id=ahci0 .*-device ide-hd,drive=d0,bus=ahci0\.0/); assert.match(a, /-device e1000,netdev=n0/); assert.match(a, /-cdrom \/iso\/Win11\.iso -boot once=d/);
  assert.match(a, /-drive file=\/iso\/virtio-win\.iso,media=cdrom,readonly=on/); assert.match(a, /-tpmdev emulator,id=tpm0,chardev=tpm0 -device tpm-tis,tpmdev=tpm0/); assert.match(a, /-bios \/ovmf\.fd/);
  const lin = qemuArgs({ ...vm, profil: { disque: 'virtio', reseau: 'virtio' } } as Machine, '/vm/l', { kvm: true }).join(' ');
  assert.match(lin, /if=virtio,format=qcow2/); assert.match(lin, /virtio-net-pci/); assert.doesNotMatch(lin, /tpm|ahci/);
});

test('importer une ISO : dossier, lien, envoi en morceaux ; l\'antivirus d\'abord ; une ISO infectée n\'entre pas dans la bibliothèque', async () => {
  const w = monde();
  try {
    assert.match((await w.act('espace_iso', { dossier: w.espace })).text, /Espace ISO : .*Hydre et Andromède/);
    assert.equal((await w.v.act('eitri', 'etat')).data && ((await w.v.act('eitri', 'etat')).data as { dossier: string }).dossier, w.espace, 'un seul réglage, celui d\'Andromède');
    const src = join(w.home, 'cle-usb'); mkdirSync(src, { recursive: true });
    // 1. Depuis un dossier (ou un partage monté) : copiée, analysée, rangée dans « Importées ».
    const ubuntu = Buffer.from(`fausse ISO Ubuntu ${Math.random()}`); writeFileSync(join(src, 'ubuntu-24.04.3-desktop-amd64.iso'), ubuntu);
    const r1 = await w.act('importer_iso', { chemin: join(src, 'ubuntu-24.04.3-desktop-amd64.iso') });
    assert.equal(r1.ok, true); assert.match(r1.text, /📀 ubuntu-24\.04\.3-desktop-amd64\.iso : Ubuntu 24\.04\.3 \(Linux\) · .* · empreinte [a-f0-9]{16}… · antivirus : rien trouvé/);
    assert.deepEqual(readFileSync(join(w.espace, 'Importées', 'ubuntu-24.04.3-desktop-amd64.iso')), ubuntu); assert.ok(existsSync(join(src, 'ubuntu-24.04.3-desktop-amd64.iso')), 'l\'original reste');
    // 2. Depuis un lien http(s).
    const win = Buffer.from(`fausse ISO Windows ${Math.random()}`); w.web.set('https://exemple.fr/iso/Win11_24H2_French_x64.iso', win);
    const r2 = await w.act('importer_iso', { lien: 'https://exemple.fr/iso/Win11_24H2_French_x64.iso' });
    assert.match(r2.text, /Windows 11 \(Windows\)/); assert.equal((await w.act('importer_iso', { lien: 'ftp://exemple.fr/x.iso' })).ok, false);
    // 3. Envoi depuis le navigateur en morceaux : reprise là où il s'est arrêté, puis import.
    const mac = Buffer.from(`fausse ISO macOS ${Math.random()}`), nom = 'Install-macOS-Sequoia.iso';
    const p0 = (await w.act('preparer_envoi_iso', { nom, taille: mac.length })).data as { envoi: string; recu: number };
    assert.equal(p0.envoi, idEnvoi(nom, mac.length)); assert.equal(p0.recu, 0);
    mkdirSync(dossierMorceaux(w.v.ctx('ymir')), { recursive: true }); writeFileSync(join(dossierMorceaux(w.v.ctx('ymir')), `${p0.envoi}.part`), mac.subarray(0, 10));
    assert.equal(((await w.act('preparer_envoi_iso', { nom, taille: mac.length })).data as { recu: number }).recu, 10, 'après une coupure : on sait où reprendre');
    writeFileSync(join(dossierMorceaux(w.v.ctx('ymir')), `${p0.envoi}.part`), mac);
    assert.match((await w.act('importer_iso', { envoi: p0.envoi, nom })).text, /macOS Sequoia \(macOS\)/);
    assert.ok(!existsSync(join(dossierMorceaux(w.v.ctx('ymir')), `${p0.envoi}.part`)), 'le morceau a rejoint la bibliothèque');
    // 4. Une ISO infectée (EICAR simulé par empreinte) : bloquée avant d'entrer, notification, quarantaine.
    const virus = Buffer.from(`ISO piégée (simulée) ${Math.random()}`); writeFileSync(join(src, 'debian-13.2.0-amd64-netinst.iso'), virus); w.signer(virus);
    const r4 = await w.act('importer_iso', { chemin: join(src, 'debian-13.2.0-amd64-netinst.iso') });
    assert.equal(r4.ok, false); assert.match(r4.text, /🚫 debian-13\.2\.0-amd64-netinst\.iso est bloqué par l'antivirus \(Malware connu : Agent-simulé, trouvé par empreinte\)[\s\S]*n'entre pas dans la bibliothèque/);
    assert.ok(!existsSync(join(w.espace, 'Importées', 'debian-13.2.0-amd64-netinst.iso')));
    const q = (w.v.ctx('ullr').settings.quarantine as Array<{ id: string; nom: string; origine: string; file: string }>)[0];
    assert.equal(q.nom, 'debian-13.2.0-amd64-netinst.iso'); assert.match(q.origine, /Hydre · ISO \(dossier\)/);
    assert.ok(w.alertes.some((a) => /Asclépios a bloqué debian-13\.2\.0-amd64-netinst\.iso/.test(a.title) && /AVANT de créer une machine virtuelle/.test(a.detail ?? '')));
    // La bibliothèque : nom, système, taille, empreinte, date, antivirus.
    const l = await w.isos();
    assert.deepEqual(l.map((x) => `${x.systeme}:${x.detail}:${x.origine}:${x.antivirus?.verdict}`).sort(), ['Linux:Ubuntu 24.04.3:dossier:sain', 'Windows:Windows 11:lien:sain', 'macOS:macOS Sequoia:envoi:sain']);
    assert.ok(l.every((x) => /^[a-f0-9]{64}$/.test(x.sha256 ?? '')) && l.find((x) => x.systeme === 'Linux')!.sha256 === sha(ubuntu));
    assert.match((await w.act('bibliotheque_iso')).text, /ubuntu-24\.04\.3-desktop-amd64\.iso · Linux \(Ubuntu 24\.04\.3\) · .* · antivirus : sain/);
    // Libérée (avec ton accord) : elle prend sa place dans l'espace ISO, comme si de rien n'était.
    assert.equal((await w.v.act('ullr', 'liberer', { id: q.id }, { auto: true })).ok, false);
    await w.v.act('ullr', 'liberer', { id: q.id });
    assert.deepEqual(readFileSync(join(w.espace, 'Importées', 'debian-13.2.0-amd64-netinst.iso')), virus);
    assert.ok((await w.isos()).some((x) => x.nom === 'debian-13.2.0-amd64-netinst.iso'), 'visible dans la bibliothèque');
    // Retirer : grave.
    assert.equal((await w.act('retirer_iso', { iso: 'debian-13.2.0' }, { auto: true })).ok, false);
    assert.match((await w.act('retirer_iso', { iso: 'debian-13.2.0' })).text, /retirée/); assert.ok(!existsSync(join(w.espace, 'Importées', 'debian-13.2.0-amd64-netinst.iso')));
  } finally { w.fin(); }
});

test('créer une VM : la liste propose les ISO de la bibliothèque, étiquetées par système, et Hydre règle le matériel', async () => {
  const w = monde({ outils: /qemu-system-x86_64|qemu-img|ip$|swtpm/ });
  try {
    await w.act('espace_iso', { dossier: w.espace }); mkdirSync(join(w.espace, 'Windows 11'), { recursive: true });
    // Des ISO d'Andromède (déjà dans l'espace ISO : utilisées sur place, sans copie) et des pilotes virtio.
    writeFileSync(join(w.espace, 'Windows 11', 'Win11_24H2_French_x64.iso'), 'windows'); writeFileSync(join(w.espace, 'debian-13.2.0-amd64-netinst.iso'), 'debian'); writeFileSync(join(w.espace, 'Install-macOS-Sequoia.iso'), 'macos');
    const D = (await w.act('tableau_machines')).data as { isos: Iso[] };
    assert.deepEqual(D.isos.map((x) => `${x.systeme} · ${x.detail}`).sort(), ['Linux · Debian 13.2.0', 'Windows · Windows 11', 'macOS · macOS Sequoia']);
    const iw = D.isos.find((x) => x.systeme === 'Windows')!;
    assert.deepEqual([iw.profil!.tpm, iw.profil!.disque, iw.profil!.reseau], [true, 'sata', 'e1000'], 'sans ISO de pilotes : SATA et e1000');
    assert.match(D.isos.find((x) => x.systeme === 'macOS')!.profil!.avertissement!, /licence d'Apple/);
    // Windows 11 : TPM (swtpm présent), disque SATA, l'ISO d'Andromède utilisée sur place.
    const r = await w.act('creer_machine', { genre: 'vm', iso: iw.id, fin: 'bureau', coeurs: 2, memoire: 4, disque: 64, apps: '' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /✅ .* créée \(VM Windows 11 /); assert.match(r.text, /Puce TPM 2\.0 virtuelle/); assert.match(r.text, /disque SATA et carte réseau e1000/);
    const m = r.data as Machine; assert.equal(m.iso, join(w.espace, 'Windows 11', 'Win11_24H2_French_x64.iso')); assert.equal(m.famille, 'Windows'); assert.deepEqual(m.profil, { disque: 'sata', reseau: 'e1000', tpm: true });
    const q = w.lancees.find((c) => c[0] === 'qemu-system-x86_64')!.join(' ');
    assert.ok(q.includes(`-cdrom ${m.iso}`), 'l\'ISO de la bibliothèque est donnée telle quelle à la VM'); assert.match(q, /ide-hd,drive=d0/); assert.match(q, /-device e1000/); assert.match(q, /tpm-tis/);
    assert.ok(w.lancees.some((c) => c[0] === 'swtpm' && c.includes('--tpm2')), 'puce TPM lancée à côté');
    assert.deepEqual(((await w.isos()).find((x) => x.systeme === 'Windows') as unknown as { vms: string[] }).vms, [m.nom], 'la fiche dit quelle machine s\'en sert');
    // Avec l'ISO de pilotes virtio dans la bibliothèque : disque et réseau virtio, pilotes en second lecteur.
    writeFileSync(join(w.espace, 'virtio-win-0.1.262.iso'), 'pilotes');
    const r2 = await w.act('creer_machine', { genre: 'vm', iso: 'Win11_24H2', fin: 'jeux', apps: '' });
    assert.deepEqual((r2.data as Machine).profil, { disque: 'virtio', reseau: 'virtio', tpm: true, pilotes: join(w.espace, 'virtio-win-0.1.262.iso') });
    assert.ok(w.lancees.filter((c) => c[0] === 'qemu-system-x86_64')[1].join(' ').includes(`file=${join(w.espace, 'virtio-win-0.1.262.iso')},media=cdrom`));
    // Linux : virtio, pas de TPM.
    const r3 = await w.act('creer_machine', { genre: 'vm', iso: 'debian-13.2.0-amd64-netinst', fin: 'web', apps: '' });
    assert.match(r3.text, /créée \(VM Debian 13\.2\.0/); assert.deepEqual((r3.data as Machine).profil, { disque: 'virtio', reseau: 'virtio', tpm: false });
    // macOS : refusé tant que les limites ne sont pas acceptées.
    const r4 = await w.act('creer_machine', { genre: 'vm', iso: 'Install-macOS-Sequoia', apps: '' });
    assert.equal(r4.ok, false); assert.match(r4.text, /licence d'Apple ne l'autorise que sur du matériel Apple[\s\S]*Coche « j'ai compris »/);
    const r5 = await w.act('creer_machine', { genre: 'vm', iso: 'Install-macOS-Sequoia', macos_compris: true, apps: '' });
    assert.equal(r5.ok, true, r5.text); assert.match(r5.text, /macOS : limites acceptées/);
    // Une ISO inconnue : message clair.
    assert.match((await w.act('creer_machine', { genre: 'vm', iso: 'pas-la.iso', apps: '' })).text, /ISO introuvable dans la bibliothèque/);
  } finally { w.fin(); }
});

test('une machine où un virus est trouvé part en quarantaine : isolée, démarrage en mode analyse seulement, sortie avec ton accord', async () => {
  const w = monde();
  try {
    const r = await w.act('creer_machine', { genre: 'lxc', modele: 'debian trixie', fin: 'web', apps: '' });
    assert.equal(r.ok, true, r.text);
    const m = r.data as Machine, rootfs = join(w.home, 'valhalla', 'ymir', 'machines', 'lxc', m.nom, 'rootfs');
    const virus = Buffer.from(`programme piégé dans la machine (simulé) ${Math.random()}`); w.signer(virus);
    mkdirSync(join(rootfs, 'usr', 'local', 'bin'), { recursive: true }); writeFileSync(join(rootfs, 'usr', 'local', 'bin', 'outil'), virus);
    const an = await w.act('analyser_machine', { machine: m.nom });
    assert.equal(an.ok, false); assert.match(an.text, /⚠ /);
    const liste = (await w.act('locales')).data as Machine[];
    assert.ok(liste[0].quarantaine, 'marquée en quarantaine dans la liste'); assert.match(liste[0].quarantaine!.raison, /virus trouvé par l'antivirus/);
    assert.match((await w.act('locales')).text, /^- 🔒 /);
    const al = w.alertes.find((a) => /en quarantaine : virus trouvé/.test(a.title))!;
    assert.equal(al.level, 'critique'); assert.match(al.detail!, /Quoi : la machine .*Pourquoi : l'antivirus a trouvé .*Ce qui a été fait : réseau coupé, elle ne démarre plus qu'en mode analyse/);
    // Démarrage impossible, sauf en mode analyse (sans réseau).
    await w.act('arreter_machine', { machine: m.nom });
    const d0 = await w.act('demarrer_machine', { machine: m.nom });
    assert.equal(d0.ok, false); assert.match(d0.text, /est en quarantaine .* elle ne démarre qu'en mode analyse, sans réseau/);
    assert.match((await w.act('demarrer_machine', { machine: m.nom, analyse: true })).text, /démarrée en mode analyse \(sans aucun réseau/);
    assert.match(readFileSync(join(w.home, 'valhalla', 'ymir', 'machines', 'lxc', m.nom, 'config'), 'utf8'), /lxc\.net\.0\.type = empty/, 'aucune carte réseau');
    // Rien n'y est installé pendant la quarantaine.
    // Sortie : action grave, et seulement après une analyse propre (le fichier a été mis en quarantaine par Asclépios).
    assert.equal((await w.act('liberer_machine', { machine: m.nom, origine: 'outil téléchargé' }, { auto: true })).ok, false);
    assert.ok(!existsSync(join(rootfs, 'usr', 'local', 'bin', 'outil')), 'le fichier infecté a quitté la machine (quarantaine d\'Asclépios)');
    const an2 = await w.act('analyser_machine', { machine: m.nom }); assert.equal(an2.ok, true, an2.text);
    const lib = await w.act('liberer_machine', { machine: m.nom, origine: 'outil téléchargé hors d\'Hermès' });
    assert.match(lib.text, /🔓 .* est de retour sur le réseau/);
    assert.equal(((await w.act('locales')).data as Machine[])[0].quarantaine, undefined);
  } finally { w.fin(); }
});
