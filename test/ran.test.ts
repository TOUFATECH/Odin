// Rán : décodeur de paquets (pcap → couches OSI), historique, qui parle à qui, pause, appli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PcapReader, decode, hexdump } from '../src/valhalla/ran-dissect.ts';
import { NETWORK, bpf, clear, flows, history, isPaused, packet, problem, prune, save, setOwnPort, setPaused } from '../src/valhalla/ran.ts';
import { ran, summary } from '../src/valhalla/modules/ran.ts';

// ---------- fabrique de paquets ----------
const B = (...a: number[]) => Buffer.from(a);
const u16 = (n: number) => B(n >> 8, n & 255);
const ip = (s: string) => B(...s.split('.').map(Number));
const eth = (type: number, body: Buffer) => Buffer.concat([B(0xaa, 0xbb, 0xcc, 0, 0, 1), B(0x02, 0, 0, 0, 0, 2), u16(type), body]);
const ipv4 = (src: string, dst: string, proto: number, body: Buffer) => Buffer.concat([B(0x45, 0), u16(20 + body.length), u16(0x1234), u16(0x4000), B(64, proto), u16(0), ip(src), ip(dst), body]);
const udp = (sp: number, dp: number, pl: Buffer) => Buffer.concat([u16(sp), u16(dp), u16(8 + pl.length), u16(0), pl]);
const tcp = (sp: number, dp: number, flags: number, pl: Buffer) => Buffer.concat([u16(sp), u16(dp), B(0, 0, 0, 1), B(0, 0, 0, 0), B(0x50, flags), u16(64240), u16(0), u16(0), pl]);
const name = (n: string) => Buffer.concat([...n.split('.').map((l) => Buffer.concat([B(l.length), Buffer.from(l)])), B(0)]);
const dnsQuery = (n: string) => Buffer.concat([u16(0xbeef), u16(0x0100), u16(1), u16(0), u16(0), u16(0), name(n), u16(1), u16(1)]);
const dnsAnswer = (n: string, a: string) => Buffer.concat([u16(0xbeef), u16(0x8180), u16(1), u16(1), u16(0), u16(0), name(n), u16(1), u16(1), B(0xc0, 12), u16(1), u16(1), B(0, 0, 1, 44), u16(4), ip(a)]);
function clientHello(sni: string): Buffer {
  const host = Buffer.from(sni);
  const ext = Buffer.concat([u16(0), u16(host.length + 5), u16(host.length + 3), B(0), u16(host.length), host, u16(16), u16(5), u16(3), B(2), Buffer.from('h2')]);
  const body = Buffer.concat([u16(0x0303), Buffer.alloc(32), B(0), u16(2), u16(0x1301), B(1, 0), u16(ext.length), ext]);
  const hs = Buffer.concat([B(1), B(0, body.length >> 8, body.length & 255), body]);
  return Buffer.concat([B(22), u16(0x0301), u16(hs.length), hs]);
}
const pcap = (frames: Buffer[], link = 1) => Buffer.concat([Buffer.from('d4c3b2a1020004000000000000000000ffff0000', 'hex'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(link); return b; })(),
  ...frames.flatMap((f, i) => { const h = Buffer.alloc(16); h.writeUInt32LE(1794437548 + i, 0); h.writeUInt32LE(5000, 4); h.writeUInt32LE(f.length, 8); h.writeUInt32LE(f.length, 12); return [h, f]; })]);

const PC = '192.168.1.20', BOX = '192.168.1.1', YT = '142.250.74.14';
const frames = [
  eth(0x0800, ipv4(PC, BOX, 17, udp(40000, 53, dnsQuery('www.youtube.com')))),
  eth(0x0800, ipv4(BOX, PC, 17, udp(53, 40000, dnsAnswer('www.youtube.com', YT)))),
  eth(0x0800, ipv4(PC, YT, 6, tcp(51000, 443, 0x18, clientHello('www.youtube.com')))),
  eth(0x0800, ipv4(PC, '192.168.1.50', 6, tcp(52000, 80, 0x18, Buffer.from('GET /admin HTTP/1.1\r\nHost: nas.local\r\nUser-Agent: curl/8\r\n\r\n')))),
  eth(0x0806, Buffer.concat([u16(1), u16(0x0800), B(6, 4), u16(1), B(2, 0, 0, 0, 0, 2), ip(BOX), Buffer.alloc(6), ip(PC)])),
  eth(0x0800, ipv4(PC, YT, 1, Buffer.concat([B(8, 0), u16(0), u16(7), u16(1)]))),
];

test('décodeur : chaque couche (OSI) de DNS, TLS (nom du site), HTTP, ARP et ICMP', () => {
  const r = new PcapReader('Odin');
  const all = pcap(frames);
  // Le flux arrive par morceaux : le lecteur les recolle
  const got = [...r.push(all.subarray(0, 30)), ...r.push(all.subarray(30, 200)), ...r.push(all.subarray(200))];
  assert.equal(got.length, frames.length);
  const [q, a, hello, web, arp, ping] = got;
  assert.equal(q.proto, 'DNS'); assert.equal(q.site, 'www.youtube.com'); assert.match(q.info, /quelle adresse pour www\.youtube\.com/);
  assert.deepEqual(q.layers.map((l) => l.osi), [1, 2, 3, 4, 7]);
  assert.equal(q.at, 1794437548005);
  assert.match(a.info, /A 142\.250\.74\.14/); assert.deepEqual(a.names, [[YT, 'www.youtube.com']]);
  assert.equal(hello.proto, 'TLS'); assert.equal(hello.site, 'www.youtube.com'); assert.equal(hello.app, 'HTTPS');
  const tlsLayer = hello.layers.find((l) => l.name === 'TLS')!;
  assert.equal(tlsLayer.osi, 6); assert.ok(tlsLayer.fields.some((f) => f.k === 'Site demandé (SNI)' && f.v === 'www.youtube.com'));
  assert.ok(tlsLayer.fields.some((f) => /ALPN/.test(f.k) && f.v === 'h2'));
  assert.match(hello.story!, /connexion chiffrée/);
  assert.equal(web.proto, 'HTTP'); assert.equal(web.site, 'nas.local'); assert.match(web.info, /GET nas\.local\/admin/);
  assert.ok(web.layers.find((l) => l.name === 'HTTP')!.fields.some((f) => f.k === 'User-Agent' && f.v === 'curl/8'));
  assert.match(web.story!, /en clair/);
  assert.deepEqual(web.names, [], 'un serveur du réseau local ne prend pas le nom donné dans la requête (proxy possible)');
  assert.deepEqual(hello.names, [[YT, 'www.youtube.com']]);
  const tcpL = web.layers.find((l) => l.name === 'TCP')!; assert.ok(tcpL.fields.some((f) => f.k === 'Drapeaux' && f.v === 'PSH, ACK'));
  assert.equal(arp.proto, 'ARP'); assert.match(arp.info, /Qui a 192\.168\.1\.20/);
  assert.equal(ping.proto, 'ICMP'); assert.equal(ping.info, 'ping (demande)');
  assert.match(hexdump(web.raw), /^0000  aa bb cc 00 00 01/);
});

test('décodeur : capture Linux « any » (SLL2), IPv6, DHCP, données non reconnues', () => {
  const sll2 = (body: Buffer, way: number) => Buffer.concat([u16(0x0800), u16(0), B(0, 0, 0, 2), u16(1), B(way, 6), B(2, 0, 0, 0, 0, 2, 0, 0), body]);
  const d = decode(new Uint8Array(sll2(ipv4(PC, BOX, 17, udp(40000, 53, dnsQuery('a.fr'))), 4)), 276, 1, 60);
  assert.equal(d.way, 'envoyé'); assert.equal(d.proto, 'DNS');
  const dh = Buffer.alloc(300); dh[0] = 1; dh.writeUInt32BE(0x63825363, 236); Buffer.from([53, 1, 1, 12, 4, ...Buffer.from('tele'), 255]).copy(dh, 240);
  const x = decode(new Uint8Array(eth(0x0800, ipv4('0.0.0.0', '255.255.255.255', 17, udp(68, 67, dh)))), 1, 1, 342);
  assert.equal(x.proto, 'DHCP'); assert.equal(x.site, 'tele'); assert.match(x.info, /DISCOVER/);
  const v6 = Buffer.concat([B(0x60, 0, 0, 0), u16(16), B(17, 64), Buffer.alloc(15), B(1), Buffer.alloc(15), B(2), udp(5000, 5001, Buffer.from('bonjour'))]);
  const y = decode(new Uint8Array(eth(0x86dd, v6)), 1, 1, 70);
  assert.equal(y.src, '::1'); assert.equal(y.dst, '::2'); assert.ok(y.layers.some((l) => l.name === 'Données' && l.fields.some((f) => f.v === 'bonjour')));
  assert.throws(() => new PcapReader().push(Buffer.alloc(30, 7)), /illisible/);
});

test('historique, noms appris, qui parle à qui, détail, ménage', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-ran-'));
  const list = new PcapReader('Odin').push(pcap(frames)).map((d) => Object.assign(d, { origin: 'Odin', at: Date.now() - 1000 }));
  const saved = save(home, list);
  assert.equal(saved.length, frames.length); assert.ok(saved.every((p) => p.id > 0));
  // Le ping vers YouTube porte le nom appris par la réponse DNS
  assert.equal(saved[5].site, 'www.youtube.com');
  const h = history(home, PC);
  assert.equal(h.total, 6); assert.ok(h.sites.some((x) => x.site === 'www.youtube.com'));
  assert.equal(history(home, PC, { peer: YT }).total, 2);
  assert.equal(history(home, undefined, { q: 'http' }).total >= 2, true);
  const f = flows(home, undefined);
  assert.ok(f.flows.some((x) => x.src === PC && x.dst === YT && x.n === 2));
  assert.equal(f.names[YT], 'www.youtube.com');
  const p = packet(home, saved[2].id)!;
  assert.equal(p.site, 'www.youtube.com'); assert.ok(p.layers.length >= 5); assert.match(p.hex, /^0000 /); assert.match(p.story, /chiffrée/);
  assert.match(summary(home, NETWORK, 60), /Qui parle à qui/);
  assert.match(summary(home, PC, 60), /www\.youtube\.com/);
  assert.equal(prune(home, Date.now() + 8 * 864e5), 6);
  save(home, list); assert.equal(clear(home, PC), 6);
});

test('pause, filtre de capture sans l\'interface d\'Odin, causes d\'échec', () => {
  setOwnPort(7777);
  assert.equal(bpf(NETWORK), 'not tcp port 7777');
  assert.equal(bpf('192.168.1.20'), 'host 192.168.1.20 and not tcp port 7777');
  const home = mkdtempSync(join(tmpdir(), 'odin-ran-'));
  setPaused(home, true); assert.equal(isPaused(), true); setPaused(home, false); assert.equal(isPaused(), false);
  assert.match(problem('sh: 1: tcpdump: not found')!, /apt install tcpdump/);
  assert.match(problem('sudo: a password is required')!, /droits administrateur/);
  assert.equal(problem('autre chose'), undefined);
});

test('appli Rán : actions, portée « tout le réseau », effacement soumis à accord', async () => {
  assert.equal(ran.id, 'ran'); assert.ok(ran.words.includes('wireshark'));
  for (const id of ['lire', 'pause', 'reprendre', 'expliquer', 'paquet', 'effacer']) assert.ok(ran.actions.some((a) => a.id === id), id);
  const saved: Record<string, unknown> = {};
  const ctx = { home: mkdtempSync(join(tmpdir(), 'odin-ran-')), settings: saved, saveSettings(x: Record<string, unknown>) { Object.assign(saved, x); } } as never;
  const ex = ran.actions.find((a) => a.id === 'expliquer')!;
  assert.throws(() => ex.run(ctx, { ip: '192.168.1.20; rm -rf /' }), /adresse IP/);
  assert.match(String((await ex.run(ctx, { ip: '' })).text), /tout le réseau/);
  await ran.actions.find((a) => a.id === 'pause')!.run(ctx, {});
  assert.equal(saved.paused, true); assert.equal(isPaused(), true);
  await ran.actions.find((a) => a.id === 'reprendre')!.run(ctx, {});
  assert.equal(saved.paused, false);
  assert.ok(ran.actions.find((a) => a.id === 'effacer')!.grave!({ ip: '' }));
});
