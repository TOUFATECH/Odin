// Genèse : lecture des ISO (ISO 9660, Rock Ridge, Joliet, UDF), TFTP, proxy DHCP, menu iPXE, installation
// automatique (Ubuntu, Debian, Rocky, Windows), suivi des machines, historique, et sécurité (machine inconnue
// = son propre disque ; installation automatique une seule fois, seulement si autorisée).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { Iso } from '../src/valhalla/thjalfi/iso.ts';
import { detect, sha512crypt, menu } from '../src/valhalla/thjalfi/recipes.ts';
import { TftpServer } from '../src/valhalla/thjalfi/tftp.ts';
import { ProxyDhcp } from '../src/valhalla/thjalfi/pxe.ts';
import { isLocal, parseRange } from '../src/valhalla/thjalfi/server.ts';
import { buildPacket, parsePacket, MSG } from '../src/valhalla/vidarr/dhcp.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const FIX = join(import.meta.dirname, 'fixtures', 'thjalfi');
/** Les ISO de test (petites, faites pour l'essai) décompressées dans un dossier. */
export function isoDir(dir: string): string { mkdirSync(dir, { recursive: true }); for (const f of readdirSync(FIX)) writeFileSync(join(dir, f.replace(/\.gz$/, '')), gunzipSync(readFileSync(join(FIX, f)))); return dir; }

test('lit les ISO sans les extraire : Rock Ridge, Joliet, ISO 9660 nu et UDF (Windows), et reconnaît le système', async () => {
  const d = mkdtempSync(join(tmpdir(), 'thjalfi-iso-'));
  try {
    isoDir(d);
    const want: Record<string, [string, boolean]> = { 'ubuntu-24.04.3-live-server-amd64.iso': ['ubuntu', true], 'debian-13.1.0-amd64-netinst.iso': ['debian', true], 'Rocky-9.6-x86_64-minimal.iso': ['rhel', true], 'Win11_24H2_French_x64.iso': ['windows', true], 'memtest86plus-7.20.iso': ['iso', false] };
    for (const [f, [kind, auto]] of Object.entries(want)) {
      const i = await Iso.open(join(d, f));
      try { const r = await detect(i); assert.equal(r.kind, kind, f); assert.equal(r.auto, auto, f); } finally { await i.close(); }
    }
    const u = await Iso.open(join(d, 'ubuntu-24.04.3-live-server-amd64.iso'));
    assert.deepEqual(u.kinds, ['rr', 'joliet']);
    assert.equal((await u.file('casper/vmlinuz')).length, 12000, 'vrai nom (Rock Ridge), contenu entier');
    assert.equal((await u.file('CASPER/VMLINUZ')).subarray(0, 12).toString(), 'NOYAU-UBUNTU', 'nom sans tenir compte des majuscules');
    const part = await u.stream('casper/vmlinuz', 12, 24); const chunks: Buffer[] = []; for await (const c of part.body) chunks.push(c as Buffer);
    assert.equal(Buffer.concat(chunks).toString(), 'NOYAU-UBUNTU', 'un morceau (reprise HTTP)');
    assert.equal(await u.exists('../etc/passwd'), false, 'pas de sortie de l\'ISO');
    await u.close();
    const w = await Iso.open(join(d, 'Win11_24H2_French_x64.iso'));
    assert.equal(w.kinds[0], 'udf', 'Windows : l\'UDF passe devant l\'ISO 9660 presque vide');
    assert.equal((await w.file('sources/boot.wim')).length, 45000); assert.deepEqual((await w.list('boot')).map((x) => x.name).sort(), ['bcd', 'boot.sdi']);
    await w.close();
    await assert.rejects(Iso.open(join(d, '..', 'absent.iso')));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('mot de passe chiffré « $6$ » identique à celui de Linux (openssl passwd -6)', () => {
  assert.equal(sha512crypt('motdepasse', 'saltsalt'), '$6$saltsalt$6sLDRVb.i2ttZCw6bRkP/HJeSdDdLn40hUNCqoNR.aB8.wQB.eQ.gM/PB9FxKsM1FD2IZNPhxF/iZ0ZYF5PWO/');
  assert.equal(sha512crypt('Odin-Thjalfi!2026', 'aB3./xyzQwerty12'), '$6$aB3./xyzQwerty12$hbpP4tdmXB.lYf1x2ccoHayLYWE7Drrcb5HlkVXO07NX2DK188QfU2q8CF9Zzw9W0wyrChylmQ9mPWxH5zX5a0');
  assert.match(sha512crypt('x'), /^\$6\$[./0-9A-Za-z]{16}\$[./0-9A-Za-z]{86}$/);
});

test('TFTP : le chargeur part en entier, avec ou sans options (taille de bloc, taille du fichier)', async () => {
  const data = Buffer.alloc(5000); for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const sent: string[] = [];
  const t = new TftpServer({ file: (n) => (n === 'undionly.kpxe' ? data : undefined), sent: (n) => sent.push(n) }); await t.start(0, '127.0.0.1');
  const get = (name: string, opts: string[]) => new Promise<{ data: Buffer; oack?: string; err?: string }>((ok) => {
    const c = dgram.createSocket('udp4'), parts: Buffer[] = []; let oack: string | undefined;
    c.on('message', (m, r) => {
      const op = m.readUInt16BE(0);
      if (op === 5) { c.close(); ok({ data: Buffer.alloc(0), err: m.subarray(4, m.length - 1).toString('latin1') }); return; }
      if (op === 6) { oack = m.subarray(2).toString('latin1'); c.send(Buffer.from([0, 4, 0, 0]), r.port, r.address); return; }
      if (op === 3) { const n = m.readUInt16BE(2), body = m.subarray(4); parts[n] = body; c.send(Buffer.from([0, 4, m[2], m[3]]), r.port, r.address); const blk = opts.includes('blksize') ? 1024 : 512; if (body.length < blk) { setTimeout(() => c.close(), 50); ok({ data: Buffer.concat(parts.filter(Boolean)), oack }); } }
    });
    c.send(Buffer.concat([Buffer.from([0, 1]), Buffer.from(`${name}\0octet\0${opts.join('\0')}${opts.length ? '\0' : ''}`, 'latin1')]), t.port, '127.0.0.1');
  });
  try {
    assert.ok((await get('undionly.kpxe', [])).data.equals(data), 'blocs de 512');
    const r = await get('undionly.kpxe', ['blksize', '1024', 'tsize', '0']);
    assert.ok(r.data.equals(data)); assert.match(r.oack ?? '', /blksize\x001024\x00tsize\x005000/, 'options acceptées');
    assert.match((await get('../../etc/passwd', [])).err ?? '', /refusé/);
    assert.match((await get('absent.efi', [])).err ?? '', /absent/);
    await new Promise((r2) => setTimeout(r2, 100)); assert.equal(sent.length, 2);
  } finally { t.stop(); }
});

/** Une demande DHCP d'une machine qui démarre par le réseau. */
function discover(mac: string, arch: number, ipxe = false, port?: number): Buffer {
  const a = Buffer.alloc(2); a.writeUInt16BE(arch);
  return buildPacket({ op: 1, xid: 0x1234, mac, options: [[53, Buffer.from([MSG.DISCOVER])], [60, Buffer.from('PXEClient:Arch:00007:UNDI:003016')], [93, a], ...(ipxe ? [[77, Buffer.from('iPXE')] as [number, Buffer]] : [])], ...(port ? {} : {}) });
}
test('proxy DHCP : seules les machines PXE reçoivent le chargeur qui leur va, sans jamais d\'adresse', async () => {
  const c = dgram.createSocket({ type: 'udp4', reuseAddr: true }); await new Promise<void>((ok) => c.bind(0, '0.0.0.0', ok)); const cport = (c.address() as { port: number }).port;
  const got: Buffer[] = []; c.on('message', (m) => got.push(m));
  const seen: string[] = [];
  const p = new ProxyDhcp({ server: () => '192.168.1.10', httpPort: () => 16000, seen: (mac, fw) => seen.push(`${mac} ${fw}`) }); await p.start(0, 0, cport, '0.0.0.0');
  const send = (b: Buffer) => c.send(b, p.ports.dhcp, '127.0.0.1');
  try {
    send(discover('52:54:00:00:00:01', 7)); send(discover('52:54:00:00:00:02', 0)); send(discover('52:54:00:00:00:03', 7, true));
    send(buildPacket({ op: 1, xid: 9, mac: '52:54:00:00:00:04', options: [[53, Buffer.from([MSG.DISCOVER])]] }));
    await new Promise((r) => setTimeout(r, 300));
    const by = Object.fromEntries(got.map((b) => { const x = parsePacket(b); return [x.mac, { x, file: b.subarray(108, 236).toString('latin1').replace(/\0+$/, '') }]; }));
    assert.equal(by['52:54:00:00:00:01'].file, 'ipxe.efi', 'UEFI 64 bits'); assert.equal(by['52:54:00:00:00:02'].file, 'undionly.kpxe', 'BIOS');
    assert.equal(by['52:54:00:00:00:03'].file, 'http://192.168.1.10:16000/boot.ipxe', 'iPXE lancé : le menu par HTTP');
    assert.equal(by['52:54:00:00:00:04'], undefined, 'pas une machine PXE : pas de réponse');
    assert.equal(by['52:54:00:00:00:01'].x.yiaddr, '0.0.0.0', 'aucune adresse donnée'); assert.equal(by['52:54:00:00:00:01'].x.siaddr, '192.168.1.10');
    assert.deepEqual(seen.sort(), ['52:54:00:00:00:01 uefi', '52:54:00:00:00:02 bios', '52:54:00:00:00:03 uefi']);
  } finally { p.stop(); c.close(); }
});

test('petits outils : réseau local seulement, morceaux HTTP, menu par défaut sur le disque', () => {
  assert.ok(isLocal('192.168.1.5') && isLocal('::ffff:10.0.0.2') && isLocal('127.0.0.1') && !isLocal('8.8.8.8') && !isLocal('203.0.113.4'));
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 }); assert.deepEqual(parseRange('bytes=-10', 1000), { start: 990, end: 999 }); assert.equal(parseRange('bytes=2000-', 1000), 'invalide');
  const m = menu({ base: 'http://o:1', mac: 'aa:bb:cc:dd:ee:ff', entries: [{ id: 'mem', name: 'Memtest', recipe: { kind: 'iso', label: 'x', auto: false, os: 'outil' } }], def: 'local', timeout: 10 });
  assert.match(m, /choose --default local --timeout 10000/); assert.match(m, /sanboot --no-describe \$\{base\}\/iso\/mem\.iso/);
});

// ---------------- De bout en bout, avec Odin ----------------
interface W { v: Valhalla; home: string; base: string; get: (p: string, h?: Record<string, string>) => Promise<{ status: number; text: string; buf: Buffer }>; sent: string[]; end: () => void }
async function world(fetchFn?: typeof fetch): Promise<W> {
  const home = mkdtempSync(join(tmpdir(), 'thjalfi-')), sent: string[] = [];
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fetchFn ?? ((async () => { throw new Error('réseau coupé'); }) as never), notify: async (t: string) => { sent.push(t); }, autonomy: () => 'equilibre' } as never);
  await v.act('eitri', 'dossier', { chemin: isoDir(join(home, 'iso')) });
  const boot = join(home, 'valhalla', 'thjalfi', 'boot'); mkdirSync(boot, { recursive: true }); writeFileSync(join(boot, 'undionly.kpxe'), 'KPXE'); writeFileSync(join(boot, 'ipxe.efi'), 'EFI');
  v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 0, pxe: 0, client: 0 }, ip: '127.0.0.1', mode: 'aucun' });
  const r = await v.act('thjalfi', 'allumer'); assert.match(r.text, /▶ Genèse allumé : menu sur http:\/\/127\.0\.0\.1:\d+\/boot\.ipxe/);
  const base = /http:\/\/127\.0\.0\.1:\d+/.exec(r.text)![0];
  const get = async (p: string, h: Record<string, string> = {}) => { const x = await fetch(`${base}${p}`, { headers: h }); const buf = Buffer.from(await x.arrayBuffer()); return { status: x.status, text: buf.toString(), buf }; };
  return { v, home, base, get, sent, end: () => { v.stop(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; rmSync(home, { recursive: true, force: true }); } };
}
const machine = async (w: W, mac: string) => ((await w.v.act('thjalfi', 'machines')).data as Array<{ mac: string; step: string; iso?: string; host?: string; ip?: string }>).find((m) => m.mac === mac);

test('de bout en bout : machine inconnue → son disque ; machine autorisée → Ubuntu s\'installe seule, une fois, puis prévient Odin', async () => {
  const w = await world();
  try {
    assert.match((await w.get('/boot.ipxe')).text, /chain http:\/\/127\.0\.0\.1:\d+\/menu\.ipxe\?mac=\$\{netX\/mac\}/);
    const unknown = (await w.get('/menu.ipxe?mac=52-54-00-aa-00-01&fw=efi')).text;
    assert.match(unknown, /choose --default local/, 'machine inconnue : son propre disque par défaut');
    assert.match(unknown, /item e-ubuntu-24-04-3-live-server-amd64 ubuntu-24\.04\.3-live-server-amd64 - Ubuntu Server/); assert.doesNotMatch(unknown, /autoinstall/, 'jamais d\'installation automatique pour une inconnue');
    assert.equal((await machine(w, '52:54:00:aa:00:01'))?.step, 'menu');
    // On autorise une machine en installation automatique (action grave : refusée depuis une automatisation).
    assert.equal((await w.v.act('thjalfi', 'autoriser', { mac: '52:54:00:aa:00:02', iso: 'ubuntu', nom: 'Bureau 1', auto: true }, { auto: true })).ok, false);
    assert.match((await w.v.act('thjalfi', 'autoriser', { mac: '52:54:00:aa:00:02', iso: 'ubuntu', nom: 'Bureau 1', auto: true })).text, /installation automatique, profil Standard/);
    const m = (await w.get('/menu.ipxe?mac=52:54:00:aa:00:02&fw=pcbios')).text;
    assert.match(m, /choose --default e-ubuntu-24-04-3-live-server-amd64 --timeout 5000/);
    const token = /seed\/([\w-]+)\//.exec(m)![1];
    assert.match(m, /kernel \$\{base\}\/f\/ubuntu-24-04-3-live-server-amd64\/casper\/vmlinuz\?m=52:54:00:aa:00:02 initrd=initrd ip=dhcp url=\$\{base\}\/iso\/ubuntu-24-04-3-live-server-amd64\.iso autoinstall ds=nocloud-net;s=\$\{base\}\/seed\//);
    // La machine charge le noyau (lu dans l'ISO), puis l'ISO entière par morceaux.
    const k = await w.get('/f/ubuntu-24-04-3-live-server-amd64/casper/vmlinuz?m=52:54:00:aa:00:02'); assert.equal(k.status, 200); assert.equal(k.buf.length, 12000);
    const part = await w.get('/iso/ubuntu-24-04-3-live-server-amd64.iso', { range: 'bytes=0-99' }); assert.equal(part.status, 206); assert.equal(part.buf.length, 100);
    assert.equal((await machine(w, '52:54:00:aa:00:02'))?.step, 'chargement');
    // Les réponses : nom, compte, empreinte du mot de passe (jamais en clair), retour vers Odin.
    const ud = (await w.get(`/seed/${token}/user-data`)).text;
    assert.match(ud, /hostname: bureau-1/); assert.match(ud, /username: admin/); assert.match(ud, /password: "\$6\$/); assert.match(ud, new RegExp(`/etat/${token}\\?e=logiciels`));
    assert.equal((await w.get(`/seed/${token}/meta-data`)).text, `instance-id: odin-thjalfi-${token}\n`);
    assert.equal((await w.get('/seed/faux-jeton-tres-long-1234/user-data')).status, 404, 'jeton inconnu');
    assert.equal((await w.get(`/etat/${token}?e=installation`)).text, 'ok');
    await w.get(`/etat/${token}?e=logiciels`);
    assert.equal((await w.get(`/etat/${token}?e=fini&nom=bureau-1&ip=192.168.1.50`)).text, 'ok');
    const done = await machine(w, '52:54:00:aa:00:02'); assert.equal(done?.step, 'fini'); assert.equal(done?.host, 'bureau-1'); assert.equal(done?.ip, '192.168.1.50');
    const h = (await w.v.act('thjalfi', 'historique')).text; assert.match(h, /bureau-1 \(192\.168\.1\.50\) · ubuntu-24\.04\.3-live-server-amd64 · fini/);
    assert.match((await w.v.act('thjalfi', 'isos')).text, /ubuntu-24\.04\.3-live-server-amd64 : Ubuntu Server \(installation automatique\) · déployée 1 fois, 1 réussie/);
    // Une seule fois : au démarrage suivant, la machine reprend son disque.
    assert.match((await w.get('/menu.ipxe?mac=52:54:00:aa:00:02&fw=pcbios')).text, /choose --default e-ubuntu/, 'même ISO proposée…');
    assert.doesNotMatch((await w.get('/menu.ipxe?mac=52:54:00:aa:00:02&fw=pcbios')).text, /autoinstall/, '…mais sans installation automatique');
    // La page : machines passées, compteurs.
    const view = await w.v.modules().find((x) => x.id === 'thjalfi')!.view(w.v.ctx('thjalfi'), new URLSearchParams());
    const past = view.sections.find((x) => x.title === 'Déjà passées') as { rows: Array<{ cells: string[] }> };
    assert.equal(past.rows[0].cells[1], 'bureau-1'); assert.equal(past.rows[0].cells[2], '192.168.1.50');
    assert.ok(view.sections.some((x) => x.kind === 'bars'), 'déploiements par ISO');
  } finally { w.end(); }
});

test('Debian, Rocky et Windows : chaque fichier de réponses, et les logiciels de Hermès en silencieux', async () => {
  const w = await world();
  try {
    // Debian : le programme d'installation réseau doit être préparé.
    await w.v.act('thjalfi', 'autoriser', { mac: '52:54:00:bb:00:01', iso: 'debian', auto: true });
    assert.match((await w.get('/menu.ipxe?mac=52:54:00:bb:00:01')).text, /programme d'installation reseau de Debian n'est pas encore pret/);
    const deb = join(w.home, 'valhalla', 'thjalfi', 'boot', 'debian', 'trixie'); mkdirSync(deb, { recursive: true }); writeFileSync(join(deb, 'linux'), 'L'); writeFileSync(join(deb, 'initrd.gz'), 'I');
    const dm = (await w.get('/menu.ipxe?mac=52:54:00:bb:00:01')).text; const dt = /seed\/([\w-]+)\//.exec(dm)![1];
    assert.match(dm, /kernel \$\{base\}\/boot\/debian\/trixie\/linux\?m=52:54:00:bb:00:01 initrd=initrd auto=true priority=critical url=\$\{base\}\/seed\/[\w-]+\/preseed\.cfg hostname=pc-bb0001/);
    assert.equal((await w.get('/boot/debian/trixie/linux?m=52:54:00:bb:00:01')).text, 'L');
    assert.equal((await machine(w, '52:54:00:bb:00:01'))?.iso, 'debian-13-1-0-amd64-netinst', 'le noyau réseau compte pour l\'ISO Debian');
    const pre = (await w.get(`/seed/${dt}/preseed.cfg`)).text; assert.match(pre, /passwd\/user-password-crypted password \$6\$/); assert.match(pre, /netcfg\/hostname string pc-bb0001/);
    // Rocky : Kickstart, dépôt servi depuis l'ISO.
    await w.v.act('thjalfi', 'autoriser', { mac: '52:54:00:bb:00:02', iso: 'rocky', auto: true });
    const rm = (await w.get('/menu.ipxe?mac=52:54:00:bb:00:02')).text; const rt = /seed\/([\w-]+)\//.exec(rm)![1];
    assert.match(rm, /inst\.repo=\$\{base\}\/f\/rocky-9-6-x86-64-minimal\/ inst\.ks=\$\{base\}\/seed\/[\w-]+\/ks\.cfg/);
    assert.match((await w.get(`/seed/${rt}/ks.cfg`)).text, /url --url=http:\/\/127\.0\.0\.1:\d+\/f\/rocky-9-6-x86-64-minimal\/\n[\s\S]*user --name=admin --groups=wheel --password=\$6\$/);
    assert.equal((await w.get('/f/rocky-9-6-x86-64-minimal/BaseOS/repodata/repomd.xml')).text, '<repomd/>', 'le dépôt est lu dans l\'ISO');
    // Windows : partage obligatoire, puis wimboot + réponses + logiciels de Hermès.
    assert.match((await w.v.act('thjalfi', 'autoriser', { mac: '52:54:00:bb:00:03', iso: 'win11', auto: true })).text, /règle d'abord le partage réseau/);
    await w.v.act('thjalfi', 'partage_windows', { unc: '\\\\nas\\iso', dossier: join(w.home, 'nas'), utilisateur: 'odin', mot_de_passe: 'secret-du-nas' });
    assert.match((await w.v.act('thjalfi', 'preparer_windows', { iso: 'win11' })).text, /✅ Win11_24H2_French_x64 : 7 fichiers/);
    assert.equal(readFileSync(join(w.home, 'nas', '.thjalfi', 'win11-24h2-french-x64', 'sources', 'boot.wim')).length, 45000);
    await w.v.act('fjalar', 'dossier', { chemin: join(w.home, 'logiciels') }); mkdirSync(join(w.home, 'logiciels', 'Firefox'), { recursive: true }); writeFileSync(join(w.home, 'logiciels', 'Firefox', 'Firefox Setup 140.0.exe'), 'MZ-FIREFOX');
    await w.v.act('thjalfi', 'profil', { nom: 'Bureau', utilisateur: 'awa', logiciels: 'firefox, vlc' });
    await w.v.act('thjalfi', 'autoriser', { mac: '52:54:00:bb:00:03', iso: 'win11', profil: 'Bureau', auto: true });
    const wm = (await w.get('/menu.ipxe?mac=52:54:00:bb:00:03&fw=efi')).text; const wt = /seed\/([\w-]+)\//.exec(wm)![1];
    assert.match(wm, /kernel \$\{base\}\/boot\/wimboot\?m=52:54:00:bb:00:03 gui/); assert.match(wm, /initrd --name boot\.wim \$\{base\}\/f\/win11-24h2-french-x64\/sources\/boot\.wim boot\.wim/);
    const cmd = (await w.get(`/seed/${wt}/odin.cmd`)).text; assert.match(cmd, /net use O: \\\\nas\\iso\\\.thjalfi\\win11-24h2-french-x64 \/user:odin "secret-du-nas"/);
    const ua = (await w.get(`/seed/${wt}/unattend.xml`)).text; assert.match(ua, /<ComputerName>pc-bb0003<\/ComputerName>/); assert.match(ua, /<Name>awa<\/Name>/); assert.match(ua, /<Type>EFI<\/Type>/); assert.doesNotMatch(ua, /<PlainText>true/);
    const ps = (await w.get(`/w/${wt}/apres.ps1`)).text; assert.match(ps, /Firefox%20Setup%20140\.0\.exe/); assert.match(ps, /-ArgumentList '-ms'/); assert.doesNotMatch(ps, /VLC/, 'pas encore dans Hermès : sauté');
    assert.equal((await w.get(`/logiciel/${wt}/Firefox%20Setup%20140.0.exe`)).text, 'MZ-FIREFOX');
    assert.ok((await w.get(`/logiciel/${wt}/..%2F..%2Fsecrets.json`)).status >= 400);
    await w.get(`/etat/${wt}?e=logiciel&nom=Firefox&ok=1`); await w.get(`/etat/${wt}?e=fini&nom=PC-AWA&ip=192.168.1.61`);
    const v = w.v.alerts({ module: 'thjalfi' }).find((a) => /PC-AWA installée/.test(a.title)); assert.ok(v, 'Odin prévient de la fin');
  } finally { w.end(); }
});

test('préparer : chargeurs officiels téléchargés, Debian vérifiée par son empreinte, rien d\'autre', async () => {
  const sha = (b: string) => createHash('sha256').update(b).digest('hex');
  const files: Record<string, string> = { 'https://boot.ipxe.org/undionly.kpxe': 'K', 'https://boot.ipxe.org/x86_64-efi/ipxe.efi': 'E', 'https://boot.ipxe.org/arm64-efi/ipxe.efi': 'A', 'https://github.com/ipxe/wimboot/releases/latest/download/wimboot': 'W', 'https://deb.debian.org/debian/dists/trixie/main/installer-amd64/current/images/netboot/debian-installer/amd64/linux': 'LINUX', 'https://deb.debian.org/debian/dists/trixie/main/installer-amd64/current/images/netboot/debian-installer/amd64/initrd.gz': 'INITRD' };
  files['https://deb.debian.org/debian/dists/trixie/main/installer-amd64/current/images/SHA256SUMS'] = `${sha('LINUX')}  ./netboot/debian-installer/amd64/linux\n${sha('AUTRE')}  ./netboot/debian-installer/amd64/initrd.gz\n`;
  const w = await world((async (u: string) => (u in files ? new Response(files[u]) : new Response('non', { status: 404 }))) as never);
  try {
    const t = (await w.v.act('thjalfi', 'preparer')).text;
    assert.match(t, /✅ undionly\.kpxe/); assert.match(t, /✅ wimboot/); assert.match(t, /Debian trixie · ✅ linux \(0 Ko, empreinte vérifiée\)/);
    assert.match(t, /Debian trixie · initrd\.gz : empreinte différente de celle publiée, fichier jeté/);
    assert.equal(readFileSync(join(w.home, 'valhalla', 'thjalfi', 'boot', 'undionly.kpxe'), 'utf8'), 'K');
  } finally { w.end(); }
});

test('écran d\'Odin : choisir sur un téléphone, la machine attend puis démarre ; « Installer pour moi » attend ton accord', async () => {
  const w = await world();
  const mac = '52:54:00:cc:00:01', U = 'ubuntu-24-04-3-live-server-amd64';
  try {
    const m0 = (await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text;
    assert.match(m0, /item ecran Choisir sur l'ecran d'Odin/); assert.match(m0, /chain http:\/\/127\.0\.0\.1:\d+\/ecran\/attente\.ipxe\?mac=52:54:00:cc:00:01&fw=\$\{platform\}/);
    assert.match(m0, /choose --default local/, 'par défaut, toujours le disque');
    const page = await fetch(`${w.base}/ecran?mac=${mac}`); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/); assert.match(await page.text(), /démarrage par le réseau/);
    const st = JSON.parse((await w.get(`/ecran/etat?mac=${mac}`)).text) as { systemes: Array<{ id: string; modes: string[]; title: string; category: string }>; dit: Record<string, string>; disposition: string };
    const u = st.systemes.find((x) => x.id === U)!; assert.deepEqual(u.modes, ['installer', 'auto']); assert.equal(u.category, 'Serveurs'); assert.equal(st.disposition, 'eventail');
    assert.match(st.dit[U], /je te demande ton accord avant/);
    // La machine attend : elle redemande toutes les 3 s, puis reprend son disque (5 min).
    const a0 = (await w.get(`/ecran/attente.ipxe?mac=${mac}&fw=efi&n=0`)).text; assert.match(a0, /sleep 3/); assert.match(a0, /n=1 /); assert.match(a0, /ecran\?mac=52:54:00:cc:00:01/);
    assert.match((await w.get(`/ecran/attente.ipxe?mac=${mac}&fw=efi&n=100`)).text, /Pas de choix[\s\S]*goto local/);
    // Un mode que ce système n'a pas : refusé.
    assert.equal((JSON.parse((await w.get(`/ecran/choisir?mac=${mac}&iso=${U}&mode=essai`)).text) as { ok: boolean }).ok, false);
    assert.equal((JSON.parse((await w.get(`/ecran/choisir?iso=${U}&mode=installer`)).text) as { ok: boolean }).ok, false, 'sans adresse de machine');
    // « Installer » : la machine reprend le menu, qui lance l'ISO tout de suite, sans installation automatique — une seule fois.
    assert.match((JSON.parse((await w.get(`/ecran/choisir?mac=${mac}&iso=${U}&mode=installer`)).text) as { texte: string }).texte, /C'est parti/);
    assert.match((await w.get(`/ecran/attente.ipxe?mac=${mac}&fw=efi&n=7`)).text, /chain http:\/\/127\.0\.0\.1:\d+\/menu\.ipxe\?mac=52:54:00:cc:00:01&fw=efi/);
    const m1 = (await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text; assert.match(m1, new RegExp(`choose --default e-${U} --timeout 0 `)); assert.doesNotMatch(m1, /autoinstall/);
    assert.match((await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text, /choose --default local --timeout 10000/, 'le choix ne sert qu\'une fois');
    // « Échap » : le disque, tout de suite.
    await w.get(`/ecran/choisir?mac=${mac}&mode=disque`); assert.match((await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text, /choose --default local --timeout 0 /);
    // « Installer pour moi » : une demande, une alerte ; rien ne s'efface avant ton accord.
    assert.match((JSON.parse((await w.get(`/ecran/choisir?mac=${mac}&iso=${U}&mode=auto`)).text) as { texte: string }).texte, /j'attends ton accord/);
    assert.match((await w.get(`/ecran/attente.ipxe?mac=${mac}&fw=efi&n=0`)).text, /accord demande/);
    assert.match((await w.get(`/ecran/attente.ipxe?mac=${mac}&fw=efi&n=150`)).text, /n=151 /, 'en attente d\'accord, la machine patiente plus longtemps');
    const tab = (await w.v.act('thjalfi', 'tableau')).data as { demandes: Array<{ id: string; statut: string; mac: string }>; chiffres: { enCours: number }; url: string };
    const d = tab.demandes[0]; assert.equal(d.statut, 'attente'); assert.equal(d.mac, mac); assert.match(tab.url, /\/ecran$/);
    assert.ok(w.v.alerts().some((x) => /demande « Installer pour moi »/.test(x.title) && x.fix?.action === 'decider'), 'alerte avec le bouton');
    assert.equal(JSON.parse((await w.get(`/ecran/etat?mac=${mac}`)).text).demande.statut, 'attente');
    // L'accord est une action grave : refusée depuis une automatisation.
    assert.equal((await w.v.act('thjalfi', 'decider', { id: d.id, accord: 'oui' }, { auto: true })).ok, false);
    assert.match((await w.v.act('thjalfi', 'decider', { id: d.id, accord: 'oui' })).text, /Accepté : pc-cc0001 installe ubuntu-24\.04\.3-live-server-amd64 tout seul/);
    assert.equal((await w.v.act('thjalfi', 'decider', { id: d.id, accord: 'non' })).ok, false, 'déjà décidé');
    assert.match((await w.get(`/ecran/attente.ipxe?mac=${mac}&fw=efi&n=3`)).text, /chain .*\/menu\.ipxe/);
    assert.match((await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text, /autoinstall/, 'accord donné : installation automatique');
    // Refus et « sans effacer ».
    const mac2 = '52:54:00:cc:00:02';
    await w.get(`/ecran/choisir?mac=${mac2}&iso=${U}&mode=auto`);
    let d2 = ((await w.v.act('thjalfi', 'tableau')).data as typeof tab).demandes.find((x) => x.mac === mac2)!;
    assert.match((await w.v.act('thjalfi', 'decider', { id: d2.id, accord: 'non' })).text, /Refusé : rien n'est touché/);
    assert.doesNotMatch((await w.get(`/menu.ipxe?mac=${mac2}&fw=efi`)).text, /autoinstall/);
    await w.get(`/ecran/choisir?mac=${mac2}&iso=${U}&mode=auto`);
    d2 = ((await w.v.act('thjalfi', 'tableau')).data as typeof tab).demandes.find((x) => x.mac === mac2 && x.statut === 'attente')!;
    assert.match((await w.v.act('thjalfi', 'decider', { id: d2.id, accord: 'sans_effacer' })).text, /installation normale/);
    const m2 = (await w.get(`/menu.ipxe?mac=${mac2}&fw=efi`)).text; assert.match(m2, new RegExp(`--default e-${U} --timeout 0 `)); assert.doesNotMatch(m2, /autoinstall/);
    // Réglages de l'écran : par défaut, thème.
    assert.match((await w.v.act('thjalfi', 'ecran', { parDefaut: true, theme: 'mayotte', disposition: 'liste', attente: 2 })).text, /proposé et par défaut · liste · graphique Mayotte · texte Matrix · attente 2 min/);
    assert.match((await w.get('/menu.ipxe?mac=52:54:00:cc:00:03&fw=efi')).text, /choose --default ecran --timeout 10000/);
    assert.match((await w.get('/ecran/attente.ipxe?mac=52:54:00:cc:00:03&n=40')).text, /Pas de choix/, '2 min');
    assert.equal(JSON.parse((await w.get('/ecran/etat?mac=52:54:00:cc:00:03')).text).theme, 'mayotte');
  } finally { w.end(); }
});

test('écran : familles, modes, noms lisibles et ce que dit Odin', async () => {
  const { category, modes, pretty, brand, odinSays, systems } = await import('../src/valhalla/thjalfi/ecran.ts');
  assert.equal(category({ kind: 'windows', label: '', auto: true, os: 'windows' }, 'Win11_24H2_French_x64'), 'Windows');
  assert.equal(category(undefined, 'clonezilla-live-3.2'), 'Outils'); assert.equal(category({ kind: 'casper', label: '', auto: false, os: 'linux' }, 'linuxmint-22-cinnamon'), 'Linux');
  assert.deepEqual(modes({ kind: 'casper', label: '', auto: false, os: 'linux' }), ['essai', 'installer']); assert.deepEqual(modes({ kind: 'windows', label: '', auto: true, os: 'windows' }), ['auto']); assert.deepEqual(modes(undefined), []);
  assert.deepEqual(pretty('ubuntu-24.04.3-desktop-amd64'), { title: 'Ubuntu Desktop', version: '24.04.3' });
  assert.equal(brand('debian-13.1.0-amd64-netinst').color, '#C70036'); assert.equal(brand('inconnu').color, '#5B6CD6');
  const sys = systems([{ id: 'a', name: 'linuxmint-22-cinnamon', size: 3e9, recipe: { kind: 'casper', label: 'Mint', auto: false, os: 'linux' } }, { id: 'b', name: 'illisible', size: 1 }], { a: { lances: 3, finis: 2 } });
  assert.equal(sys.length, 1, 'une ISO illisible n\'est pas proposée'); assert.equal(sys[0].deployed, 2);
  assert.match(odinSays(sys[0], 'efi'), /essaie-le d'abord, rien n'est écrit/); assert.match(odinSays(undefined, ''), /Choisis un système/);
});

test('thèmes de l\'écran : texte iPXE (couleurs + image de fond PNG dessinée par Odin), graphique, et tes images à toi', async () => {
  const w = await world(), mac = '52:54:00:dd:00:01';
  try {
    const m = (await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text;
    assert.match(m, /console --picture http:\/\/127\.0\.0\.1:\d+\/ecran\/fond-texte\.png .*\|\|/, 'image de fond, sans bloquer un iPXE qui ne sait pas');
    assert.match(m, /colour --rgb 0x7dff9b 7 \|\|/, 'thème Matrix par défaut'); assert.match(m, /cpair --foreground 0 --background 1 2 \|\|/);
    assert.doesNotMatch(m, /Touches :/, 'la liste des touches n\'est plus affichée');
    for (const line of m.split('\n').filter((l) => /^(console|colour|cpair) /.test(l))) assert.match(line, /\|\|$/, `toujours rattrapé : ${line}`);
    const png = await w.get('/ecran/fond-texte.png'); assert.equal(png.status, 200); assert.equal(png.buf.subarray(1, 4).toString(), 'PNG'); assert.equal(png.buf.readUInt32BE(16), 1024); assert.equal(png.buf.readUInt32BE(20), 768);
    assert.equal((await w.get('/ecran/fond-graphique')).status, 404, 'pas d\'image à toi : le décor du thème');
    assert.equal(JSON.parse((await w.get(`/ecran/etat?mac=${mac}`)).text).theme, 'bleu');
    // ancien réglage « nuit » → bleu ; thème texte « lune »
    w.v.ctx('thjalfi').saveSettings({ ecran: { theme: 'nuit' } });
    assert.match((await w.v.act('thjalfi', 'ecran', { texte: 'lune', theme: 'galaxie' })).text, /graphique Galaxie · texte Lune/);
    assert.match((await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text, /colour --rgb 0xe9e6dc 7/);
    // tes images : déposées par l'interface (images/), puis prises par le réglage
    const imgs = join(w.home, 'valhalla', 'thjalfi', 'images'); mkdirSync(imgs, { recursive: true });
    writeFileSync(join(imgs, 'fond_texte.png'), png.buf); writeFileSync(join(imgs, 'fond_graphique.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
    assert.match((await w.v.act('thjalfi', 'ecran', { fond_texte: 'image:fond_texte', fond_graphique: 'image:fond_graphique' })).text, /fond texte : ton image · fond graphique : ton image/);
    const g = await w.get('/ecran/fond-graphique'); assert.equal(g.status, 200); assert.equal(g.buf[0], 0xff);
    assert.equal(JSON.parse((await w.get(`/ecran/etat?mac=${mac}`)).text).fond, true);
    assert.match((await w.v.act('thjalfi', 'ecran', { fond_texte: 'image:absente' })).text, /introuvable/);
    writeFileSync(join(imgs, 'faux.png'), 'pas une image'); assert.match((await w.v.act('thjalfi', 'ecran', { fond_texte: 'image:faux' })).text, /PNG/);
    assert.match((await w.v.act('thjalfi', 'ecran', { sans_fond_graphique: true })).text, /fond graphique : celui du thème/);
    assert.equal((await w.get('/ecran/fond-graphique')).status, 404);
    // classique : plus de couleurs ni d'image (sauf la tienne)
    await w.v.act('thjalfi', 'ecran', { texte: 'classique', sans_fond_texte: true });
    const c = (await w.get(`/menu.ipxe?mac=${mac}&fw=efi`)).text; assert.doesNotMatch(c, /colour|console --picture/);
    assert.equal((await w.get('/ecran/fond-texte.png')).status, 404);
  } finally { w.end(); }
});
