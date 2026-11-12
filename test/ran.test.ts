// Rán : paquets réseau (comme Wireshark) — lecture des lignes de tcpdump, historique gardé 7 jours, causes d'échec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clear, history, parseLine, problem, prune, save, KEEP_PER_IP } from '../src/valhalla/ran.ts';
import { ran } from '../src/valhalla/modules/ran.ts';

test('Rán lit les lignes de tcpdump : TCP, UDP, ICMP, ARP, sens et service', () => {
  const ip = '192.168.1.20';
  const a = parseLine('1794437548.932381 eth0  Out IP 192.168.1.20.51234 > 142.250.74.14.443: tcp 517', ip)!;
  assert.equal(a.at, 1794437548932); assert.equal(a.dir, 'sortant'); assert.equal(a.proto, 'TCP'); assert.equal(a.dport, 443); assert.equal(a.len, 517); assert.equal(a.info, 'HTTPS');
  const b = parseLine('1794437548.2 eth0  In  IP 192.168.1.1.53 > 192.168.1.20.40000: UDP, length 90', ip)!;
  assert.equal(b.dir, 'entrant'); assert.equal(b.proto, 'UDP'); assert.equal(b.info, 'DNS'); assert.equal(b.src, '192.168.1.1');
  const c = parseLine('1794437548.3 eth0  In  IP 192.168.1.1 > 192.168.1.20: ICMP echo request, id 3, seq 1, length 64', ip)!;
  assert.equal(c.proto, 'ICMP'); assert.match(c.info, /ping \(demande\)/); assert.equal(c.len, 64);
  const d = parseLine('1794437548.4 eth0  B   ARP, Request who-has 192.168.1.20 tell 192.168.1.1, length 46', ip)!;
  assert.equal(d.proto, 'ARP'); assert.match(d.info, /Qui a 192\.168\.1\.20/);
  const e = parseLine('1794437548.5 eth0  Out IP 192.168.1.20.5353 > 224.0.0.251.5353: UDP, length 48', ip)!;
  assert.match(e.info, /mDNS · diffusé à tout le réseau/);
  const f = parseLine('1794437548.6 eth0  In  IP6 fe80::1.546 > fe80::2.547: UDP, length 80', 'fe80::2')!;
  assert.equal(f.src, 'fe80::1'); assert.equal(f.dport, 547); assert.equal(f.dir, 'entrant');
  for (const l of ['tcpdump: verbose output suppressed', 'listening on any, link-type LINUX_SLL2', '', '12 packets captured']) assert.equal(parseLine(l, ip), undefined);
});

test('historique : recherche, correspondants, services, 7 jours et 20 000 paquets par machine au plus', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-ran-'));
  const ip = '10.0.0.5', now = Date.now();
  const pk = (i: number, dport: number, at = now - i) => ({ at, ip, dir: 'sortant' as const, proto: 'TCP', src: ip, sport: 40000 + i, dst: '10.0.0.1', dport, len: 100, info: dport === 443 ? 'HTTPS' : 'SSH' });
  save(home, [pk(1, 443), pk(2, 22), pk(3, 443), pk(4, 443, now - 8 * 864e5)]);
  let h = history(home, ip);
  assert.equal(h.total, 4); assert.equal(h.packets[0].sport, 40001, 'le plus récent d\'abord');
  assert.equal(h.peers[0].host, '10.0.0.1'); assert.equal(h.peers[0].n, 4);
  assert.equal(history(home, ip, { q: 'ssh' }).total, 1); assert.equal(history(home, ip, { q: '443' }).total, 3);
  assert.equal(prune(home, now), 1, 'plus vieux que 7 jours : effacé');
  save(home, Array.from({ length: KEEP_PER_IP + 10 }, (_, i) => pk(10 + i, 443, now - 1000 - i)));
  prune(home, now);
  h = history(home, ip, { limit: 1 });
  assert.equal(h.total, KEEP_PER_IP); assert.equal(h.packets[0].sport, 40001, 'les plus récents restent');
  assert.equal(clear(home, ip), KEEP_PER_IP); assert.equal(history(home, ip).total, 0);
});

test('Rán explique pourquoi la capture ne démarre pas', () => {
  assert.match(problem('sh: 1: tcpdump: not found')!, /apt install tcpdump/);
  assert.match(problem('sudo: a password is required')!, /droits administrateur/);
  assert.match(problem('tcpdump: any: You don\'t have permission to perform this capture on that device\n(socket: Operation not permitted)')!, /droits administrateur|cap_net_raw/);
  assert.equal(problem('autre chose'), undefined);
});

test('appli Rán : dans le catalogue, adresse vérifiée, effacement soumis à accord', async () => {
  assert.equal(ran.id, 'ran'); assert.equal(ran.family, 'Sécurité'); assert.ok(ran.words.includes('wireshark'));
  const ctx = { home: mkdtempSync(join(tmpdir(), 'odin-ran-')), settings: {}, saveSettings() {} } as never;
  const h = ran.actions.find((a) => a.id === 'historique')!;
  assert.throws(() => h.run(ctx, { ip: '192.168.1.20; rm -rf /' }), /adresse IP/);
  assert.match(String((await h.run(ctx, { ip: '192.168.1.20' })).text), /Aucun paquet/);
  assert.ok(ran.actions.find((a) => a.id === 'effacer')!.grave!({ ip: '1.2.3.4' }));
});
