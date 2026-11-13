// Les graphes du réseau et du VPN, l'historique (jour, mois, année), les machines coupées et les sites
// bloqués à horaires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DnsServer, DEFAULTS, isCut, type DnsSettings, type LogEntry } from '../src/valhalla/vidarr/server.ts';
import { localDay, merge, period, saveDay, summarize, trim } from '../src/valhalla/vidarr/history.ts';
import { networkGraph } from '../src/valhalla/vidarr/graph.ts';
import { osFromVendorClass, randomMac } from '../src/valhalla/vidarr/dhcp.ts';
import { parse, query, respond, rdata, TYPE, dataText } from '../src/valhalla/vidarr/wire.ts';
import { vpnGraph } from '../src/valhalla/modules/gjoll.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const E = (t: number, client: string, name: string, status: LogEntry['status'] = 'ok', list?: string, clientName?: string): LogEntry => ({ t, client, name, type: 'A', status, ms: 2, rcode: 'NOERROR', ...(list ? { list } : {}), ...(clientName ? { clientName } : {}) });

test('historique : résumé d\'un jour, addition, domaines utiles gardés, jour / mois / année', () => {
  const t = new Date('2026-11-12T09:00:00').getTime();
  const s1 = summarize([E(t, '192.168.1.30', 'pub.fr', 'bloqué', 'Pubs', 'Tablette'), E(t + 1, '192.168.1.30', 'exemple.fr'), E(t + 2, '::ffff:192.168.1.40', 'c2.virus.example', 'bloqué', 'Dangereux')], (e) => e.list === 'Dangereux', '2026-11-12');
  assert.deepEqual([s1.total, s1.blocked, s1.threats, s1.hours[9]], [3, 2, 1, 3]);
  assert.deepEqual(Object.keys(s1.clients), ['192.168.1.30', '192.168.1.40'], 'adresse v4 nettoyée');
  assert.equal(s1.clients['192.168.1.30'].name, 'Tablette'); assert.equal(s1.clients['192.168.1.40'].domains['c2.virus.example'].threat, true);
  const s2 = summarize([E(t + 86400_000, '192.168.1.30', 'exemple.fr')], () => false, '2026-11-13');
  const m = merge(s1, s2);
  assert.deepEqual([m.from, m.to, m.total, m.clients['192.168.1.30'].n, m.clients['192.168.1.30'].domains['exemple.fr'].n], ['2026-11-12', '2026-11-13', 4, 3, 2]);
  // Trop de domaines : les dangereux d'abord, puis les plus demandés.
  const many = summarize([...Array.from({ length: 100 }, (_x, i) => E(t, '1.1.1.1', `d${i}.fr`)), E(t, '1.1.1.1', 'mal.fr', 'bloqué', 'D')], (e) => e.list === 'D');
  const tr = trim(many, 10); assert.equal(Object.keys(tr.clients['1.1.1.1'].domains).length, 10); assert.ok(tr.clients['1.1.1.1'].domains['mal.fr']);
  // Période : jours gardés + aujourd'hui en direct.
  const dir = mkdtempSync(join(tmpdir(), 'hist-'));
  try {
    saveDay(dir, '2026-11-10', s1); saveDay(dir, '2026-10-02', s2);
    const now = new Date('2026-11-12T10:00:00').getTime(), live = [E(now - 60_000, '192.168.1.50', 'aujourdhui.fr')];
    assert.equal(period(dir, 'jour', new Date('2026-11-10T12:00:00'), live, () => false, now).total, 3);
    assert.equal(period(dir, 'mois', new Date(now), live, () => false, now).total, 4, 'novembre : le 10 + aujourd\'hui');
    assert.equal(period(dir, 'annee', new Date(now), live, () => false, now).total, 5, '2026 : octobre + novembre');
    assert.equal(period(dir, 'direct', new Date(now), live, () => false, now).total, 1);
    assert.equal(localDay(new Date('2026-11-12T23:30:00')), '2026-11-12', 'jour local');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('machine coupée (tout de suite ou à horaires) et sites bloqués à horaires', async () => {
  const up = dgram.createSocket('udp4');
  up.on('message', (m, r) => { const q = parse(m); up.send(respond(q, { an: [{ name: q.qd[0].name, type: TYPE.A, ttl: 60, data: rdata.a('93.184.216.34') }] }), r.port, r.address); });
  await new Promise<void>((ok) => up.bind(0, '127.0.0.1', () => ok()));
  let now = new Date('2026-11-12T22:00:00').getTime();
  const st: DnsSettings = { ...DEFAULTS, upstreams: [`udp://127.0.0.1:${(up.address() as { port: number }).port}`], fallback: [], rateLimit: 0, rewrites: { 'nas.maison': ['192.168.1.10'] } };
  const d = new DnsServer({ settings: () => st, lists: () => [], log: () => {}, now: () => now } as never);
  await d.start(0, ['127.0.0.1']);
  const ask = (name: string, from = '127.0.0.1') => new Promise<string[]>((ok, ko) => { const c = dgram.createSocket('udp4'), t = setTimeout(() => { c.close(); ko(new Error('pas de réponse')); }, 1500); c.on('message', (m) => { clearTimeout(t); c.close(); const p = parse(m); ok(p.an.map((r) => dataText(m, r))); }); c.bind(0, from, () => c.send(query(name, TYPE.A), d.port, '127.0.0.1')); });
  try {
    st.clients = [{ id: 'tab', name: 'Tablette', ids: ['127.0.0.2'], cut: true, cutSchedule: { days: [0, 1, 2, 3, 4, 5, 6], from: '21:30', to: '07:00' } }];
    assert.ok(isCut(st.clients[0], new Date(now)) && !isCut(st.clients[0], new Date('2026-11-12T12:00:00')));
    assert.deepEqual(await ask('exemple.fr', '127.0.0.2'), ['0.0.0.0'], '22:00 : coupée');
    assert.deepEqual(await ask('nas.maison', '127.0.0.2'), ['192.168.1.10'], 'la maison reste joignable');
    assert.deepEqual(await ask('exemple.fr'), ['93.184.216.34'], 'les autres passent');
    now = new Date('2026-11-13T08:00:00').getTime(); d.cache.clear();
    assert.deepEqual(await ask('exemple.fr', '127.0.0.2'), ['93.184.216.34'], '8:00 : rétablie toute seule');
    st.timed = [{ rule: '||jeux.fr^', schedule: { days: [0, 1, 2, 3, 4, 5, 6], from: '07:30', to: '16:00' } }];
    assert.deepEqual(await ask('www.jeux.fr'), ['0.0.0.0'], 'bloqué pendant la plage');
    now = new Date('2026-11-13T18:00:00').getTime(); d.cache.clear();
    assert.deepEqual(await ask('www.jeux.fr'), ['93.184.216.34'], 'libre après');
  } finally { d.stop(); up.close(); }
});

test('appli Sphinx : couper / rétablir une machine, bloquer à horaires, graphe du réseau et ses fiches', async () => {
  const home = mkdtempSync(join(tmpdir(), 'reseau-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const act = (a: string, i: Record<string, unknown> = {}) => v.act('vidarr', a, i);
  try {
    v.ctx('vidarr').saveSettings({ leases: [{ mac: '02:aa:bb:cc:dd:01', ip: '192.168.1.100', name: 'Tablette Ali', expires: Date.now() + 3600_000, first: Date.now() - 600_000, vendorClass: 'android-dhcp-14' }, { mac: 'b8:27:eb:00:00:01', ip: '192.168.1.10', name: 'NAS', expires: 0, fixed: true, first: Date.now() - 90 * 86400_000 }] });
    assert.match((await act('couper_machine', { ip: '192.168.1.100', jours: 'lun,mar,mer,jeu,ven', de: '22:30', a: '07:00' })).text, /Tablette Ali \(192\.168\.1\.100\) coupé d'Internet lun, mar, mer, jeu, ven, de 22:30 à 07:00/);
    assert.equal((await act('couper_machine', { ip: 'pas-une-ip' })).ok, false);
    assert.equal((await act('couper_machine', { ip: '192.168.1.10', de: '25:00', a: '07:00' })).ok, false);
    assert.match((await act('bloquer_horaires', { domaine: 'jeux.fr', jours: 'tous', de: '21:00', a: '07:00' })).text, /jeux\.fr bloqué tous les jours, de 21:00 à 07:00 pour toute la maison/);
    const view = await v.module('vidarr')!.view(v.ctx('vidarr'), new URLSearchParams('periode=jour'));
    const g = view.sections.find((x) => x.kind === 'graph') as { nodes: Array<{ id: string; label: string; ring?: string; square?: boolean }>; details: Record<string, { chips?: Array<{ label: string }>; rows?: Array<{ k: string; v: string; src?: string }>; actions?: Array<{ action: string }> }>; periods: { current: string } };
    assert.equal(g.periods.current, 'jour');
    assert.ok(g.nodes.find((n) => n.id === 'odin')?.square && g.nodes.some((n) => n.id === 'box') && g.nodes.some((n) => n.id === 'internet'));
    const tab = g.details['p:192.168.1.100'];
    assert.ok(tab.chips!.some((c) => /Coupé 22:30 → 07:00/.test(c.label)) && tab.chips!.some((c) => c.label === 'Nouveau sur le réseau'));
    const row = (k: string) => tab.rows!.find((r) => r.k === k);
    assert.equal(row('Adresse MAC')?.v, '02:aa:bb:cc:dd:01'); assert.equal(row('Modèle')?.v, 'Android 14'); assert.match(row('Connexion')!.v, /Wi-Fi \(adresse privée/);
    assert.ok(tab.actions!.some((a) => a.action === 'retablir_machine'));
    assert.equal(g.nodes.find((n) => n.id === 'p:192.168.1.10')?.ring, undefined, 'le NAS n\'est pas nouveau');
    assert.match(g.details['p:192.168.1.10'].rows!.find((r) => r.k === 'Fabricant')!.v, /Raspberry/);
    const blocked = view.sections.find((x) => x.title === 'Blocages à horaires') as { rows: Array<{ cells: string[] }> };
    assert.deepEqual(blocked.rows.map((r) => r.cells[0]), ['jeux.fr', '⛔ Tablette Ali (192.168.1.100)']);
    assert.match((await act('retablir_machine', { ip: '192.168.1.100' })).text, /Tablette Ali retrouve Internet/);
    assert.match((await act('retirer_horaire', { domaine: 'jeux.fr' })).text, /n'est plus bloqué/);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('graphe du réseau : postes, domaines demandés, bloqués, dangereux ; graphe du VPN : connectés, débit, domaines', () => {
  const t = Date.now();
  const sum = summarize([E(t, '192.168.1.30', 'pub.fr', 'bloqué', 'Pubs'), E(t, '192.168.1.30', 'exemple.fr'), E(t, '192.168.1.40', 'c2.virus.example', 'bloqué', 'Dangereux'), E(t, '10.8.0.2', 'youtube.com')], (e) => e.list === 'Dangereux');
  const g = networkGraph(sum, { odinIp: '192.168.1.2', router: '192.168.1.1', upstreams: ['tls://9.9.9.9'], dhcpOn: true, dnsOn: true, port: 53, leases: [], clients: [{ id: 'v', name: 'VPN · Téléphone', ids: ['10.8.0.2'] }], device: (ip) => (ip === '192.168.1.40' ? { mac: '24:6f:28:00:00:01', model: 'ESP32' } : undefined), vendorOf: (m) => (m.startsWith('24:6f:28') ? 'Espressif' : ''), rate: (ip) => (ip === '192.168.1.30' ? 250_000 : undefined), now: t, periodLabel: 'Aujourd\'hui' });
  const n = (id: string) => g.nodes.find((x) => x.id === id);
  assert.equal(n('d:pub.fr')?.color, '#F0A040'); assert.equal(n('d:c2.virus.example')?.color, '#EE6A55'); assert.equal(n('d:exemple.fr')?.color, '#8E959D');
  assert.equal(n('p:192.168.1.40')?.ring, '#EE6A55', 'poste qui a demandé un site dangereux : cerclé de rouge');
  assert.equal(n('p:10.8.0.2')?.color, '#57C98A', 'appareil du VPN en vert');
  assert.ok(g.edges.some((e) => e.a === 'p:192.168.1.30' && e.b === 'd:pub.fr' && e.dash), 'lien bloqué en pointillé');
  assert.match(g.details['p:192.168.1.30'].rows!.find((r) => r.k === 'Débit')!.v, /2 Mb\/s/);
  assert.equal(g.details['p:192.168.1.40'].rows!.find((r) => r.k === 'Modèle')!.v, 'ESP32');
  assert.match(g.details['d:pub.fr'].rows![0].v, /192\.168\.1\.30 \(1\)/);
  assert.ok(randomMac('02:aa:bb:cc:dd:01') && randomMac('da:00:00:00:00:01') && !randomMac('b8:27:eb:00:00:01'));
  assert.equal(osFromVendorClass('MSFT 5.0'), 'Windows');
  // VPN
  const sv = { priv: '', pub: '', net: '10.8.0', port: 51820, endpoint: '203.0.113.7', dns: '', iface: 'wg0', lan: ['192.168.1.0/24'] } as never;
  const ps = [{ name: 'Téléphone', pub: 'A', psk: '', ip: '10.8.0.2/32', created: '', enabled: true, full: true, odinDns: true }, { name: 'Invité', pub: 'B', psk: '', ip: '10.8.0.3/32', created: '', enabled: false, full: false, expires: '2020-01-01' }];
  const live = new Map([['A', { handshake: t - 5000, rx: 5e6, tx: 9e7, endpoint: '102.35.1.2:4500' }]]);
  const vg = vpnGraph(sv, ps as never, live, new Map([['A', { rx: 1e5, tx: 1e6 }]]), t, () => [{ name: 'youtube.com', n: 4, blocked: false }, { name: 'doubleclick.net', n: 2, blocked: true }]);
  const vn = (id: string) => vg.nodes.find((x) => x.id === id);
  assert.equal(vn('v:Téléphone')?.color, '#57C98A'); assert.equal(vn('v:Invité')?.off, true); assert.equal(vn('v:Invité')?.ring, '#EE6A55');
  assert.ok(vn('internet') && vn('maison'));
  assert.ok(vg.edges.some((e) => e.a === 'v:Téléphone' && e.b === 'odin' && e.w === 3 && !e.dash));
  assert.ok(vg.edges.some((e) => e.a === 'v:Téléphone' && e.b === 'd:doubleclick.net' && e.dash));
  assert.match(vg.details['v:Téléphone'].rows!.find((r) => r.k === 'Débit')!.v, /↓ 8 Mb\/s · ↑ 0,8 Mb\/s/);
  assert.match(vg.details['v:Téléphone'].rows!.find((r) => r.k === 'Vient de')!.src!, /adresse publique/);
});
