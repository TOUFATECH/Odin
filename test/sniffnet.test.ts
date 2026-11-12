// Rán comme Sniffnet : débit entrant / sortant, trafic par appareil, pays (table locale), premières fois.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { country, countryName, flag, lookupIn, parseTable } from '../src/valhalla/geoip.ts';
import { devices, dirOf, external, firstSeen, knownSince, save, shutdown, throughput } from '../src/valhalla/ran.ts';
import { traffic } from '../src/valhalla/modules/ran.ts';

test('table des pays : lecture, recherche, nom et drapeau', () => {
  const t = parseTable('"1.0.0.0","1.0.0.255","AU"\n8.8.8.0,8.8.8.255,US\n2001:db8::,2001:db8::ffff,FR\nbad,line\n90.0.0.0,90.127.255.255,FR\n');
  assert.equal(t.cc.length, 3, 'IPv6 et lignes cassées ignorées');
  assert.equal(lookupIn(t, '8.8.8.8'), 'US'); assert.equal(lookupIn(t, '90.10.1.2'), 'FR'); assert.equal(lookupIn(t, '9.9.9.9'), undefined); assert.equal(lookupIn(t, 'x'), undefined);
  assert.equal(countryName('FR'), 'France'); assert.equal(flag('FR'), '🇫🇷');
});

test('trafic : sens, débit, appareils, pays, premières fois', () => {
  const home = mkdtempSync(join(tmpdir(), 'ran-sn-'));
  try {
    writeFileSync(join(home, 'ip-pays.csv'), '8.8.8.0,8.8.8.255,US\n90.0.0.0,90.127.255.255,FR\n');
    assert.equal(dirOf('192.168.1.10', '8.8.8.8'), 'sortant'); assert.equal(dirOf('8.8.8.8', '192.168.1.10'), 'entrant'); assert.equal(dirOf('192.168.1.10', '192.168.1.1'), 'local');
    const now = Date.now(), pk = (at: number, src: string, dst: string, len: number, app: string, site = '') => ({ at, src, dst, sport: 50000, dport: 443, proto: 'TCP', app, site, len, info: '', way: '', origin: 'test', names: [] as Array<[string, string]>, layers: [], raw: Buffer.alloc(0), story: '' });
    save(home, [pk(now - 30_000, '192.168.1.10', '8.8.8.8', 2_000_000, 'HTTPS', 'dns.google'), pk(now - 20_000, '8.8.8.8', '192.168.1.10', 5_000_000, 'HTTPS', 'dns.google'),
      pk(now - 15_000, '192.168.1.20', '90.1.2.3', 300_000, 'QUIC', 'free.fr'), pk(now - 5_000, '192.168.1.10', '192.168.1.20', 1000, 'SMB')] as never);
    const tp = throughput(home, { since: now - 60_000, bucketMs: 60_000, until: now });
    assert.deepEqual(tp.map((x) => [x.entrant, x.sortant, x.local]), [[5_000_000, 2_300_000, 1000]]);
    const d = devices(home, now - 60_000);
    assert.equal(d[0].ip, '192.168.1.10'); assert.equal(d[0].sent, 2_001_000); assert.equal(d[0].recv, 5_000_000);
    assert.equal(country(home, '90.1.2.3'), 'FR');
    const t = traffic(home);
    assert.deepEqual(t.countries.map(([c]) => c), ['US', 'FR']); assert.equal(t.services[0][0], 'dns.google');
    assert.equal(external(home, now - 60_000).length, 3);
    assert.equal(firstSeen(home, '192.168.1.10', 'pays', 'US'), true); assert.equal(firstSeen(home, '192.168.1.10', 'pays', 'US'), false);
    assert.ok(knownSince(home, '192.168.1.10')! <= Date.now());
  } finally { shutdown(); rmSync(home, { recursive: true, force: true }); }
});
