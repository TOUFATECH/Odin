import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { encodeQuery, isRandomMac, localSubnets, parseDns, parseNeighbors, parseSsdp, probe, sanitize, summarizeMdns, type Found } from '../src/hlidskjalf/discover.ts';
import { classify, formatReport, Inventory, linksFor } from '../src/hlidskjalf/inventory.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { makeOdin } from './helpers.ts';

const iface = (address: string, netmask: string, internal = false) => ({ address, netmask, family: 'IPv4' as const, mac: '00:00:00:00:00:00', internal, cidr: null });

test('réseaux explorés : privés seulement, jamais plus de 1 024 adresses', () => {
  const s = localSubnets({ wlan0: [iface('192.168.1.42', '255.255.255.0')], eth1: [iface('10.20.5.7', '255.255.0.0')], pub: [iface('84.12.3.4', '255.255.255.0')], lo: [iface('127.0.0.1', '255.0.0.0', true)] });
  assert.deepEqual(s.map((x) => x.cidr), ['192.168.1.0/24', '10.20.5.0/24']);
  assert.equal(s[0].hosts.length, 254);
  assert.equal(s[0].hosts[0], '192.168.1.1');
});

test('table ARP : Linux, /proc, macOS et Windows', () => {
  const linux = parseNeighbors('192.168.1.1 dev wlan0 lladdr a4:91:b1:0:0:1 REACHABLE\n192.168.1.9 dev wlan0  INCOMPLETE\nfe80::1 dev wlan0 lladdr a4:91:b1:00:00:01 router STALE');
  assert.deepEqual(linux, [{ ip: '192.168.1.1', mac: 'a4:91:b1:00:00:01' }]);
  const proc = parseNeighbors('IP address       HW type     Flags       HW address            Mask     Device\n192.168.1.20     0x1         0x2         3c:2a:f4:11:22:33     *        wlan0');
  assert.equal(proc[0].mac, '3c:2a:f4:11:22:33');
  const mac = parseNeighbors('? (192.168.1.30) at 0:11:32:aa:bb:cc on en0 ifscope [ethernet]\n? (192.168.1.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]\n? (224.0.0.251) at 1:0:5e:0:0:fb on en0');
  assert.deepEqual(mac, [{ ip: '192.168.1.30', mac: '00:11:32:aa:bb:cc' }]);
  const win = parseNeighbors('Interface : 192.168.1.42 --- 0x5\n  Adresse Internet      Adresse physique      Type\n  192.168.1.40          b8-27-eb-12-34-56     dynamique\n  192.168.1.255         ff-ff-ff-ff-ff-ff     statique');
  assert.deepEqual(win, [{ ip: '192.168.1.40', mac: 'b8:27:eb:12:34:56' }]);
  assert.equal(isRandomMac('8e:12:34:56:78:9a'), true);
  assert.equal(isRandomMac('b8:27:eb:12:34:56'), false);
});

test('les noms annoncés par les appareils sont assainis', () => {
  assert.equal(sanitize('TV <script>alert(1)</script>'), 'TV script alert(1) /script');
  assert.equal(sanitize('a'.repeat(200))!.length, 64);
  assert.equal(sanitize('   '), undefined);
});

/** Fabrique une réponse mDNS réaliste (avec pointeurs de compression). */
function mdnsAnswer(): Buffer {
  const name = (s: string) => Buffer.concat([...s.split('.').map((l) => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)])), Buffer.from([0])]);
  const head = Buffer.alloc(12); head.writeUInt16BE(0x8400, 2); head.writeUInt16BE(2, 6);
  const svc = name('_googlecast._tcp.local');            // offset 12
  const ptrRr = Buffer.alloc(10); ptrRr.writeUInt16BE(12, 0); ptrRr.writeUInt16BE(1, 2); ptrRr.writeUInt32BE(120, 4);
  const inst = Buffer.concat([Buffer.from([10]), Buffer.from('TV-Salon-1'), Buffer.from([0xc0, 12])]);
  ptrRr.writeUInt16BE(inst.length, 8);
  const txtName = Buffer.from([0xc0, 12 + svc.length + 10]); // pointe vers l'instance
  const kv = ['md=Chromecast', 'fn=TV salon'].map((s) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)]));
  const txtData = Buffer.concat(kv);
  const txtRr = Buffer.alloc(10); txtRr.writeUInt16BE(16, 0); txtRr.writeUInt16BE(1, 2); txtRr.writeUInt16BE(txtData.length, 8);
  return Buffer.concat([head, svc, ptrRr, inst, txtName, txtRr, txtData]);
}

test('mDNS : requête bien formée, réponse décodée (compression incluse)', () => {
  const q = encodeQuery(['_ipp._tcp.local']);
  assert.equal(q.readUInt16BE(4), 1);
  assert.equal(q.subarray(12, 17).toString('latin1'), '\x04_ipp');
  const recs = parseDns(mdnsAnswer());
  assert.equal(recs[0].data, 'TV-Salon-1._googlecast._tcp.local');
  const s = summarizeMdns(recs);
  assert.deepEqual(s, { name: 'TV salon', model: 'Chromecast', services: ['_googlecast._tcp'] });
  assert.deepEqual(parseDns(Buffer.from([1, 2, 3])), [], 'paquet tronqué toléré');
});

test('SSDP : en-têtes lus', () => {
  const h = parseSsdp('HTTP/1.1 200 OK\r\nSERVER: Linux UPnP/1.0 Synology/DSM\r\nST: urn:schemas-upnp-org:device:MediaServer:1\r\nLOCATION: http://192.168.1.30:5000/desc.xml\r\n\r\n');
  assert.equal(h.server, 'Linux UPnP/1.0 Synology/DSM');
  assert.equal(h.location, 'http://192.168.1.30:5000/desc.xml');
});

test('sonde TCP : port ouvert, port fermé', async () => {
  const srv = createServer((s) => s.end()).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = (srv.address() as AddressInfo).port;
  assert.equal(await probe('127.0.0.1', port), 'open');
  srv.close();
  await new Promise((r) => srv.once('close', r));
  assert.equal(await probe('127.0.0.1', port), 'closed');
});

test('classement et liens possibles', () => {
  const f = (p: Partial<Found>) => ({ ports: [], services: [], ...p });
  assert.equal(classify(f({ ports: [80, 631, 9100] })), 'imprimante');
  assert.equal(classify(f({ ports: [80], isGateway: true })), 'routeur');
  assert.equal(classify(f({ ports: [22, 445, 5000] })), 'stockage (NAS)');
  assert.equal(classify(f({ ports: [8123] })), 'domotique');
  assert.equal(classify(f({ services: ['_googlecast._tcp'] })), 'multimédia');
  assert.equal(classify(f({ ports: [554] })), 'caméra');
  assert.equal(classify(f({ ports: [], mac: '8e:12:34:56:78:9a' })), 'téléphone / tablette');
  assert.equal(classify(f({ ports: [22] })), 'ordinateur / serveur');
  const links = linksFor({ ip: '192.168.1.20', ports: [80, 631], services: [], kind: 'imprimante' });
  assert.ok(links.some((l) => l.action === 'Imprimer un document' && l.risk === 'external'));
  assert.ok(links.some((l) => l.how === 'http://192.168.1.20'));
});

const NET = '192.168.1.0/24';
const dev = (ip: string, mac?: string, ports: number[] = []): Found => ({ ip, mac, ports, services: [], network: NET });

test('inventaire : nouveau → déconnecté → retiré → reconnecté, IP changée, autre réseau intact', () => {
  const inv = new Inventory(new DatabaseSync(':memory:'));
  const day = 86_400_000, t0 = Date.parse('2026-11-01T10:00:00Z');
  inv.applyScan([{ ...dev('10.0.0.5', 'aa:aa:aa:aa:aa:aa'), network: '10.0.0.0/24' }], ['10.0.0.0/24'], t0 - day);
  let r = inv.applyScan([dev('192.168.1.20', '3c:2a:f4:11:22:33', [631]), dev('192.168.1.30')], [NET], t0, 7, true);
  assert.equal(r.added.length, 2);
  r = inv.applyScan([dev('192.168.1.21', '3c:2a:f4:11:22:33')], [NET], t0 + 1000);
  assert.deepEqual(r.disconnected.map((d) => d.ip), ['192.168.1.30']);
  assert.match(r.changed[0].what, /192\.168\.1\.20 → 192\.168\.1\.21/);
  assert.deepEqual(inv.get('3c:2a:f4:11:22:33')!.ports, [631], 'balayage rapide : ports conservés');
  r = inv.applyScan([dev('192.168.1.21', '3c:2a:f4:11:22:33')], [NET], t0 + 8 * day);
  assert.deepEqual(r.removed.map((d) => d.ip), ['192.168.1.30']);
  assert.equal(inv.get('aa:aa:aa:aa:aa:aa')!.status, 'online', 'appareil d\'un autre réseau non touché');
  r = inv.applyScan([dev('192.168.1.21', '3c:2a:f4:11:22:33'), dev('192.168.1.30', 'de:ad:be:ef:00:01')], [NET], t0 + 9 * day);
  assert.equal(r.reconnected.length, 1);
  assert.equal(inv.get('de:ad:be:ef:00:01')!.first_seen, t0, 'l\'appareil connu par son IP garde son historique en gagnant une MAC');
  assert.equal(inv.list().length, 3);
  assert.match(formatReport(r), /Reconnectés/);
});

class FakeChannel implements Channel {
  readonly name = 'fake'; readonly interactive = true;
  sent: string[] = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(_p: string, text: string) { this.sent.push(text); }
  async stop() {}
}

test('passerelle : balayage automatique et alerte au propriétaire en cas de changement', async () => {
  const o = makeOdin([], { config: (c) => ({ ...c, network: { ...c.network, enabled: true } }) });
  const ch = new FakeChannel();
  let scans = 0;
  const gw = new Gateway(o, { owners: { fake: ['boss'] }, discover: async () => { scans++; return { subnets: [{ iface: 'x', address: '192.168.1.2', cidr: NET, prefix: 24, hosts: [] }], found: scans === 1 ? [dev('192.168.1.20', '3c:2a:f4:11:22:33', [631])] : [] }; } }).add(ch);
  await gw.tick();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(scans, 1);
  assert.match(ch.sent[0], /Nouveaux : 192\.168\.1\.20 \(imprimante/);
  await gw.tick(); // trop tôt : pas de nouveau balayage
  assert.equal(scans, 1);
  await gw.scanNetwork(false);
  assert.match(ch.sent[1], /Déconnectés/);
  o.cleanup();
});

test('outil net_inventory : liste et détail avec les liens possibles', async () => {
  const o = makeOdin([{ toolCalls: [{ id: 'a', name: 'net_inventory', input: { device: '192.168.1.20' } }] }, { text: 'ok' }]);
  o.inventory.applyScan([dev('192.168.1.20', '3c:2a:f4:11:22:33', [80, 631])], [NET], Date.now(), 7, true);
  await o.agent.run('Que peux-tu faire avec l\'imprimante ?', { sessionId: 's' });
  const out = o.provider.calls[1].messages.at(-1)!.content;
  assert.match(out, /imprimante — online/);
  assert.match(out, /Imprimer un document/);
  o.cleanup();
});
