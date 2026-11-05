import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { appleModelName, formatDeep, mdnsInfo, osFromSsh, parseNtlmChallenge, parseSmbLs, parseSmbShares, smbInfo, windowsName } from '../src/hlidskjalf/deep.ts';

/** Défi NTLM tel qu'un Windows 11 le renvoie (nom, domaine, version). */
function challenge(name: string, domain: string, ver: [number, number, number]): Buffer {
  const av = (id: number, v: string) => { const s = Buffer.from(v, 'utf16le'), h = Buffer.alloc(4); h.writeUInt16LE(id); h.writeUInt16LE(s.length, 2); return Buffer.concat([h, s]); };
  const info = Buffer.concat([av(2, domain), av(1, name), av(4, 'maison.lan'), av(3, `${name.toLowerCase()}.maison.lan`), Buffer.alloc(4)]);
  const m = Buffer.alloc(56);
  m.write('NTLMSSP\0', 0, 'latin1'); m.writeUInt32LE(2, 8); m.writeUInt32LE(0x02800000, 20);
  m.writeUInt16LE(info.length, 40); m.writeUInt16LE(info.length, 42); m.writeUInt32LE(56, 44);
  m[48] = ver[0]; m[49] = ver[1]; m.writeUInt16LE(ver[2], 50);
  return Buffer.concat([m, info]);
}

test('systèmes reconnus : Windows (build), Linux (bannière SSH), modèles Apple', () => {
  assert.equal(windowsName(10, 0, 26100), 'Windows 11 24H2+ / Server 2025 (build 26100)');
  assert.equal(windowsName(10, 0, 22631), 'Windows 11 (build 22631)');
  assert.equal(windowsName(10, 0, 19045), 'Windows 10 (build 19045)');
  assert.equal(windowsName(6, 1, 7601), 'Windows 7 / Server 2008 R2');
  assert.equal(osFromSsh('SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3'), 'Linux Debian 12');
  assert.equal(osFromSsh('SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5'), 'Linux Ubuntu 24.04');
  assert.equal(osFromSsh('SSH-2.0-dropbear_2022.83'), 'Linux embarqué (box, routeur, caméra…)');
  assert.equal(appleModelName('iPhone16,2'), 'iPhone 15 Pro Max (iPhone16,2)');
  assert.equal(appleModelName('MacBookPro18,3'), 'MacBook Pro (MacBookPro18,3)');
  assert.equal(appleModelName('iPhone99,1'), 'iPhone (iPhone99,1)');
});

test('défi NTLM : nom de l\'ordinateur, domaine, version de Windows ; Samba reconnu', () => {
  const r = parseNtlmChallenge(Buffer.concat([Buffer.alloc(80), challenge('PC-SALON', 'MAISON', [10, 0, 22631])]))!;
  assert.equal(r.computer, 'PC-SALON'); assert.equal(r.domain, 'MAISON'); assert.equal(r.dnsName, 'pc-salon.maison.lan');
  assert.equal(r.os, 'Windows 11 (build 22631)'); assert.equal(r.build, '10.0.22631');
  assert.equal(parseNtlmChallenge(challenge('NAS', 'NAS', [6, 1, 0]))!.os, 'Samba (Linux, NAS…)');
});

test('SMB sans mot de passe contre un faux Windows : dialecte, signature, nom, version', async () => {
  const srv = createServer((s) => {
    let n = 0;
    s.on('data', () => {
      const hdr = Buffer.alloc(64); hdr.write('\xfeSMB', 0, 'latin1');
      let body: Buffer;
      if (n++ === 0) { body = Buffer.alloc(65); body.writeUInt16LE(65); body.writeUInt16LE(3, 2); body.writeUInt16LE(0x0302, 4); }
      else body = Buffer.concat([Buffer.alloc(8), challenge('PC-BUREAU', 'MAISON', [10, 0, 26100])]);
      const msg = Buffer.concat([hdr, body]), nb = Buffer.alloc(4); nb.writeUInt32BE(msg.length);
      s.write(Buffer.concat([nb, msg]));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  try {
    const r = await smbInfo('127.0.0.1', 3000, port);
    assert.equal(r?.dialect, 'SMB 3.0.2'); assert.equal(r?.signingRequired, true);
    assert.equal(r?.computer, 'PC-BUREAU'); assert.match(r!.os!, /Windows 11 24H2/);
  } finally { srv.close(); }
});

test('mDNS : nom .local, modèle d\'iPhone ; partages et fichiers ; fiche lisible', () => {
  const m = mdnsInfo([
    { name: '12.1.168.192.in-addr.arpa', type: 12, data: 'iPhone-de-Djin.local' },
    { name: '_companion-link._tcp.local', type: 12, data: 'iPhone de Djin._companion-link._tcp.local' },
    { name: 'iPhone de Djin._companion-link._tcp.local', type: 16, data: '', txt: { rpmd: 'iPhone16,2' } },
  ]);
  assert.deepEqual([m.hostname, m.model, m.name], ['iPhone-de-Djin.local', 'iPhone16,2', 'iPhone de Djin']);
  assert.deepEqual(parseSmbShares('Disk|Photos|Photos de famille\nIPC|IPC$|IPC Service\nPrinter|HP|'), [{ type: 'dossier', name: 'Photos', comment: 'Photos de famille' }, { type: 'système', name: 'IPC$', comment: 'IPC Service' }, { type: 'imprimante', name: 'HP', comment: '' }]);
  const ls = parseSmbLs('  .                                   D        0  Thu Nov  5 20:41:12 2026\n  Vacances 2026                       D        0  Thu Nov  5 20:41:12 2026\n  facture.pdf                         A    84213  Mon Nov  2 09:00:01 2026\n\n\t\t264212084 blocks of size 1024. 1 blocks available');
  assert.deepEqual(ls.map((x) => [x.name, x.dir, x.size]), [['Vacances 2026', true, 0], ['facture.pdf', false, 84213]]);
  const f = formatDeep({ ip: '192.168.1.12', hostnames: ['iPhone-de-Djin.local'], os: 'iOS (iPhone)', model: appleModelName('iPhone16,2'), ports: [62078], mdns: m, apple: true });
  assert.match(f, /Nom d'hôte : iPhone-de-Djin\.local/);
  assert.match(f, /Modèle : iPhone 15 Pro Max/);
  assert.match(f, /62078 \(Appareil Apple \(iOS\)\)/);
});
