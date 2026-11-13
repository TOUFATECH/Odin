// Ymir · machines de ce PC : commandes LXC et QEMU construites par Odin, quarantaine, .ody (empreinte, chemins
// dangereux refusés), capture d'écran en PNG, et le parcours complet avec un faux LXC (aucun vrai conteneur créé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { consoleTail, ipLibre, lxcConfig, nomAuto, parseLxcInfo, pngFromRgb, qemuArgs, readPpm, rewriteConfig, safeEntries, RESEAU_DEFAUT, type Machine } from '../src/valhalla/ymir/local.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const M = (o: Partial<Machine> = {}): Machine => ({ id: 'a1b2c3d4e5f6', nom: 'debian-13-20261112-nextcloud', genre: 'lxc', systeme: 'Debian', version: '13', famille: 'Linux', cpu: 2, ram: 2048, disque: 32, ip: '10.0.3.60', mac: '02:0d:1e:00:00:01', cree: 0, apps: [], paquets: [], ...o });

test('noms, adresses, configuration LXC et ligne de commande QEMU', () => {
  assert.equal(nomAuto('Debian', '13.1', new Date(2026, 10, 12), 'Nextcloud famille'), 'debian-13-1-20261112-nextcloud-famille');
  assert.equal(ipLibre(RESEAU_DEFAUT, ['10.0.3.60', '10.0.3.61']), '10.0.3.62');
  const c = lxcConfig(M(), RESEAU_DEFAUT, '/l');
  assert.ok(c.includes('lxc.cgroup2.cpu.max = 200000 100000') && c.includes('lxc.cgroup2.memory.max = 2048M') && c.includes('lxc.net.0.veth.pair = oc-a1b2c3d4') && c.includes('lxc.net.0.ipv4.address = 10.0.3.60/24'));
  const q = lxcConfig(M({ quarantaine: { depuis: 1, raison: 'x', journal: [] } }), RESEAU_DEFAUT, '/l');
  assert.ok(q.includes('lxc.net.0.type = empty') && !q.some((l) => l.includes('veth')), 'en quarantaine : aucune carte réseau');
  const re = rewriteConfig('lxc.include = /usr/share/lxc/config/common.conf\nlxc.net.0.type = veth\nlxc.net.0.link = lxcbr0\nlxc.rootfs.path = dir:/l/x/rootfs\n', q);
  assert.match(re, /lxc\.include = \/usr\/share/); assert.match(re, /lxc\.rootfs\.path/); assert.doesNotMatch(re, /link = lxcbr0/); assert.equal(re.match(/lxc\.net\.0\.type/g)?.length, 1);
  assert.deepEqual(parseLxcInfo('Name: x\nState: RUNNING\nPID: 4242\nIP: 10.0.3.60\nCPU use: 1500000000\nMemory use: 52428800\n'), { state: 'RUNNING', pid: 4242, ip: '10.0.3.60', cpuNs: 1500000000, mem: 52428800 });
  const vm = M({ genre: 'vm', uefi: true });
  const a = qemuArgs(vm, '/vm/x', { kvm: false, ovmf: '/ovmf.fd', installer: '/iso/win.iso' }).join(' ');
  assert.match(a, /accel=tcg/); assert.match(a, /-cpu max/); assert.match(a, /-bios \/ovmf\.fd/); assert.match(a, /-cdrom \/iso\/win\.iso -boot once=d/); assert.match(a, /ifname=ov-a1b2c3d4,script=no/); assert.match(a, /-qmp unix:\/vm\/x\/qmp\.sock,server=on,wait=off/);
  assert.match(qemuArgs({ ...vm, quarantaine: { depuis: 1, raison: '', journal: [] } }, '/vm/x', { kvm: true }).join(' '), /accel=kvm.*-nic none/);
});

test('capture d\'écran PPM → PNG réduit, console sans couleurs, chemins d\'archive sûrs', () => {
  const w = 8, h = 4, px = Buffer.alloc(w * h * 3, 200); px[0] = 0;
  const ppm = Buffer.concat([Buffer.from(`P6\n# capture\n${w} ${h}\n255\n`), px]);
  const r = readPpm(ppm); assert.equal(r.w, 8); assert.equal(r.h, 4);
  const png = pngFromRgb(r.w, r.h, r.px, 4);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 4); assert.equal(png.readUInt32BE(20), 2, 'réduit de moitié');
  const idat = png.indexOf('IDAT'), len = png.readUInt32BE(idat - 4), raw = inflateSync(png.subarray(idat + 4, idat + 4 + len)); assert.equal(raw.length, (4 * 3 + 1) * 2);
  assert.throws(() => readPpm(Buffer.from('P5\n1 1\n255\n\0')), /PPM attendu/);
  assert.deepEqual(consoleTail('\x1b[32m[ ok ]\x1b[0m démarré\r\n\n\x1b[1mlogin:\x1b[0m ', 2), ['[ ok ] démarré', 'login:']);
  assert.ok(safeEntries(['x/', 'x/config', 'x/rootfs/etc/passwd'], 'x'));
  assert.ok(!safeEntries(['x/config', '../etc/passwd'], 'x')); assert.ok(!safeEntries(['/etc/passwd'], 'x')); assert.ok(!safeEntries(['y/config'], 'x')); assert.ok(!safeEntries(['x/../../z'], 'x'));
});

// ---------------- Parcours complet avec un faux LXC ----------------
function fakeLxc(home: string) {
  const calls: string[][] = [], state = new Map<string, string>();
  const run = async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (cmd === 'sh') return { code: /lxc-|ip$|tar|qemu/.test(args[1]) ? 0 : 1, out: '', err: '' };
    if (cmd === 'ping') return { code: args.at(-1) === '10.0.3.60' ? 0 : 1, out: '', err: '' }; // .60 est déjà prise sur le réseau
    const P = args[args.indexOf('-P') + 1], name = args[args.indexOf('-n') + 1];
    if (cmd === 'lxc-create') { mkdirSync(join(P, name, 'rootfs', 'etc'), { recursive: true }); writeFileSync(join(P, name, 'config'), `lxc.include = /usr/share/lxc/config/common.conf\nlxc.rootfs.path = dir:${join(P, name, 'rootfs')}\nlxc.uts.name = ${name}\nlxc.net.0.type = veth\nlxc.net.0.link = lxcbr0\n`); writeFileSync(join(P, name, 'rootfs', 'etc', 'hostname'), name); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-start') { state.set(name, 'RUNNING'); writeFileSync(join(P, name, 'console.log'), '\x1b[32m[ ok ]\x1b[0m Started Nextcloud.\nlogin: '); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-stop') { state.set(name, 'STOPPED'); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-info') return existsSync(join(P, name)) ? { code: 0, out: `Name: ${name}\nState: ${state.get(name) ?? 'STOPPED'}\n${state.get(name) === 'RUNNING' ? 'IP: 10.0.3.61\n' : ''}CPU use: 1000000\nMemory use: 104857600\n`, err: '' } : { code: 1, out: '', err: 'absent' };
    if (cmd === 'lxc-copy') { const N = args[args.indexOf('-N') + 1]; await new Promise((ok) => execFile('cp', ['-a', join(P, name), join(P, N)], ok)); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-destroy') { rmSync(join(P, name), { recursive: true, force: true }); return { code: 0, out: '', err: '' }; }
    if (cmd === 'lxc-attach' || cmd === 'lxc-cgroup' || cmd === 'ip' || cmd === 'df') return { code: 0, out: '', err: '' };
    if (cmd === 'tar') return new Promise<{ code: number; out: string; err: string }>((ok) => execFile('tar', args.filter((x) => x !== '--numeric-owner'), { maxBuffer: 1 << 24 }, (e, out, err) => ok({ code: e ? 1 : 0, out, err })));
    return { code: 1, out: '', err: `commande inattendue ${cmd}` };
  };
  return { run, calls, state, home };
}

test('créer un LXC, ranger, ressources, quarantaine (règle « rouge = isoler »), analyse, sortie, .ody exporté puis réimporté', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ymir-')), F = fakeLxc(home);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: F.run as never, fetch: (async () => { throw new Error('hors ligne'); }) as never, notify: async () => {}, autonomy: () => 'equilibre' });
  try {
    const r = await v.act('ymir', 'creer_machine', { genre: 'lxc', modele: 'debian trixie', fin: 'Nextcloud famille', coeurs: 2, memoire: 2, disque: 8, apps: 'vordr, vidarr', paquets: 'nextcloud, postgresql, rm -rf /', categorie: 'Cloud maison' });
    assert.match(r.text, /✅ debian-13-\d{8}-nextcloud-famille créée \(LXC Debian 13, 2 cœur\(s\), 2 Go, 8 Go\) · 10\.0\.3\.61/, '.60 répond au ping : Odin prend la suivante');
    const create = F.calls.find((c) => c[0] === 'lxc-create')!; assert.deepEqual(create.slice(-7), ['--', '-d', 'debian', '-r', 'trixie', '-a', 'amd64']); assert.ok(create.includes('--fssize') && create.includes('8G'));
    const attach = F.calls.find((c) => c[0] === 'lxc-attach')!; assert.match(attach.at(-1)!, /apt-get install -yq nextcloud postgresql$/, 'un paquet au nom dangereux est écarté');
    const nom = (r.data as Machine).nom, P = join(home, 'valhalla', 'ymir', 'machines', 'lxc');
    const cfg = readFileSync(join(P, nom, 'config'), 'utf8'); assert.match(cfg, /lxc\.net\.0\.ipv4\.address = 10\.0\.3\.61\/24/); assert.match(cfg, /lxc\.rootfs\.path = dir:/);
    assert.match((await v.act('vidarr', 'etat')).text + JSON.stringify(v.ctx('vidarr').settings), new RegExp(`${nom}\\.maison`), 'nom sur le réseau');
    // Tableau, aperçu, ressources.
    const tab = (await v.act('ymir', 'tableau_machines')).data as { machines: Array<{ nom: string; etat: { state: string } }>; hote: { coeurs: number }; categories: Array<{ nom: string }> };
    assert.equal(tab.machines[0].etat.state, 'en marche'); assert.ok(tab.hote.coeurs >= 1); assert.ok(tab.categories.some((c) => c.nom === 'Cloud maison'));
    assert.deepEqual(((await v.act('ymir', 'apercu_machine', { machine: nom })).data as { lignes: string[] }).lignes, ['[ ok ] Started Nextcloud.', 'login:']);
    assert.match((await v.act('ymir', 'ressources_machine', { machine: nom, coeurs: 1, memoire: 1 })).text, /1 cœur\(s\), 1 Go — appliqué tout de suite/);
    assert.ok(F.calls.some((c) => c[0] === 'lxc-cgroup' && c.includes('memory.max') && c.includes('1024M')));
    // Une alerte critique qui vise la machine : Odin l'isole tout seul.
    v.ctx('ullr').alert({ level: 'critique', title: 'Rançongiciel arrêté sur 10.0.3.61', detail: 'facture.pdf.exe', key: 'test-ranson' });
    await v.modules().find((m) => m.id === 'ymir')!.watch!.run(v.ctx('ymir'));
    const q = ((await v.act('ymir', 'quarantaine_machine', { machine: nom })).data as { machine: Machine; chemin: Array<{ titre: string }> });
    assert.ok(q.machine.quarantaine, 'isolée'); assert.match(q.machine.quarantaine!.raison, /Rançongiciel/); assert.ok(q.chemin.some((c) => /Rançongiciel/.test(c.titre)));
    assert.match(readFileSync(join(P, nom, 'config'), 'utf8'), /lxc\.net\.0\.type = empty/, 'sans réseau, même après un redémarrage');
    assert.ok(F.calls.some((c) => c.join(' ') === 'ip link set oc-' + q.machine.id.slice(0, 8) + ' nomaster'));
    assert.ok(v.alerts().some((a) => /isolée par Odin/.test(a.title) && a.fix?.action === 'analyser_machine'));
    // Sortir sans analyse : refusé ; action grave.
    assert.equal((await v.act('ymir', 'liberer_machine', { machine: nom }, { auto: true })).ok, false);
    assert.match((await v.act('ymir', 'liberer_machine', { machine: nom })).text, /lance d'abord une analyse complète/);
    const an = await v.act('ymir', 'analyser_machine', { machine: nom }); assert.match(an.text, /✅/);
    assert.match((await v.act('ymir', 'liberer_machine', { machine: nom })).text, /de retour sur le réseau \(10\.0\.3\.61\)/);
    assert.match(readFileSync(join(P, nom, 'config'), 'utf8'), /lxc\.net\.0\.link = lxcbr0/);
    // .ody : machine éteinte d'abord.
    assert.match((await v.act('ymir', 'exporter_machine', { machine: nom, dossier: join(home, 'nas') })).text, /arrête d'abord/);
    await v.act('ymir', 'arreter_machine', { machine: nom });
    const ex = await v.act('ymir', 'exporter_machine', { machine: nom, dossier: join(home, 'nas') }); assert.match(ex.text, /📦 .*\.ody/);
    const ody = (ex.data as { fichier: string }).fichier;
    const im = await v.act('ymir', 'importer_machine', { fichier: ody, nom: 'copie-nextcloud' });
    assert.match(im.text, /📥 copie-nextcloud importée \(LXC Debian 13\) · 10\.0\.3\.62 · empreinte vérifiée/);
    const c2 = readFileSync(join(P, 'copie-nextcloud', 'config'), 'utf8'); assert.match(c2, /lxc\.uts\.name = copie-nextcloud/); assert.match(c2, new RegExp(`rootfs\\.path = dir:${join(P, 'copie-nextcloud')}/rootfs`)); assert.match(c2, /10\.0\.3\.62\/24/);
    assert.equal(readFileSync(join(P, 'copie-nextcloud', 'rootfs', 'etc', 'hostname'), 'utf8'), nom, 'le disque est bien là');
    // Un .ody modifié : refusé.
    const bad = join(home, 'bad'); mkdirSync(bad); await new Promise((ok) => execFile('tar', ['-C', bad, '-xf', ody], ok));
    const man = JSON.parse(readFileSync(join(bad, 'manifest.json'), 'utf8')); man.sha256 = '0'.repeat(64); writeFileSync(join(bad, 'manifest.json'), JSON.stringify(man));
    await new Promise((ok) => execFile('tar', ['-C', bad, '-cf', join(home, 'abime.ody'), 'manifest.json', 'machine.tgz'], ok));
    assert.match((await v.act('ymir', 'importer_machine', { fichier: join(home, 'abime.ody') })).text, /empreinte différente/);
    // Clone et suppression (grave).
    assert.match((await v.act('ymir', 'cloner_machine', { machine: nom, nom: 'Nextcloud test' })).text, /nextcloud-test : copie prête \(10\.0\.3\.63\)/);
    assert.equal((await v.act('ymir', 'supprimer_machine', { machine: 'nextcloud-test' }, { auto: true })).ok, false);
    assert.match((await v.act('ymir', 'supprimer_machine', { machine: 'nextcloud-test' })).text, /supprimée/); assert.ok(!existsSync(join(P, 'nextcloud-test')));
    assert.match((await v.act('ymir', 'locales')).text, /copie-nextcloud/);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
