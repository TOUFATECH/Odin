// Eir (façon Glances) : lectures du système, niveaux de couleur, mesures gardées dans le temps (minutes,
// heures, export Prometheus), et la vraie machine lue de bout en bout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as C from '../src/valhalla/eir/collect.ts';
import { Metrics } from '../src/valhalla/metrics.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

test('lectures du système (pures)', () => {
  const a = C.parseStat('cpu  100 0 100 800 0 0 0 0\ncpu0 50 0 50 400 0 0 0 0\n').get('cpu')!, b = C.parseStat('cpu  160 0 140 860 40 0 0 0\n').get('cpu')!;
  assert.deepEqual(C.cpuPct(a, b), { total: 50, user: 30, system: 20, iowait: 20, steal: 0 });
  const m = C.parseMem('MemTotal: 16000000 kB\nMemAvailable: 4000000 kB\nBuffers: 100 kB\nCached: 2000000 kB\nSwapTotal: 2000000 kB\nSwapFree: 1500000 kB\n');
  assert.equal(m.used, 12_000_000 * 1024); assert.equal(m.swapUsed, 500_000 * 1024);
  const n = C.parseNetDev('Inter-|\n face |\n    lo: 1 0 0 0 0 0 0 0 1 0 0 0 0 0 0 0\n  eth0: 1000 10 2 1 0 0 0 0 500 5 3 0 0 0 0 0\n');
  assert.deepEqual(n.get('eth0'), { rx: 1000, tx: 500, rxErr: 2, txErr: 3, drop: 1 }); assert.ok(!n.has('lo'));
  assert.deepEqual(['eth0', 'wlan0', 'wg0', 'docker0', 'enp3s0'].map(C.ifKind), ['filaire', 'wifi', 'vpn', 'conteneurs', 'filaire']);
  assert.deepEqual(C.parseWireless('Inter-|\n face |\nwlan0: 0000   52.  -58.  -256        0      0      0      0      0        0\n').get('wlan0'), { quality: 52, dbm: -58 });
  assert.equal(C.signalWord(-58), 'bon');
  const io = C.parseDiskstats('   8       0 sda 100 0 2000 0 50 0 4000 0 0 300 0\n   8       1 sda1 1 0 1 0 1 0 1 0 0 1 0\n 259 0 nvme0n1 1 0 8 0 1 0 8 0 0 5 0\n');
  assert.deepEqual(io.get('sda'), { read: 2000 * 512, write: 4000 * 512, busyMs: 300 }); assert.ok(!io.has('sda1') && io.has('nvme0n1'));
  const md = C.parseMdstat('Personalities : [raid1]\nmd0 : active raid1 sdb1[1] sda1[0]\n      976630464 blocks super 1.2 [2/1] [U_]\n      [==>......]  recovery = 12.6% (123/976) finish=80min\n\nmd1 : active raid1 sdc1[0] sdd1[1]\n      100 blocks [2/2] [UU]\n');
  assert.deepEqual(md, [{ name: 'md0', level: 'raid1', disks: 2, ok: 1, state: 'reconstruction', progress: 12.6 }, { name: 'md1', level: 'raid1', disks: 2, ok: 2, state: 'complet' }]);
  assert.deepEqual(C.tcpStates('  sl  local rem st\n 0: A:1 B:2 01 x\n 1: A:1 B:2 0A x\n 2: A:1 B:2 01 x\n'), { etablies: 2, ecoute: 1, attente: 0 });
  assert.deepEqual(C.parseWho('awa      pts/0        2026-11-12 09:14 (192.168.1.20)\nroot     tty1         2026-11-12 08:00\n'), [{ user: 'awa', tty: 'pts/0', since: '2026-11-12 09:14', from: '192.168.1.20' }, { user: 'root', tty: 'tty1', since: '2026-11-12 08:00' }]);
  assert.equal(C.parsePs('  PID USER %CPU %MEM RSS STAT TIME COMMAND\n 4242 awa 182.0 12.1 1990000 Rl 01:02:03 /usr/lib/jellyfin/ffmpeg -i film.mkv\n')[0].rss, 1990000 * 1024);
  assert.deepEqual(C.parseNvidia('NVIDIA GeForce RTX 3060, 18, 1024, 12288, 52, 35.5\n')[0], { name: 'NVIDIA GeForce RTX 3060', util: 18, memUsed: 1024 * 1024 ** 2, memTotal: 12288 * 1024 ** 2, temp: 52, watts: 35.5 });
  assert.deepEqual(C.parseSmart(JSON.stringify({ model_name: 'WD Red', smart_status: { passed: true }, temperature: { current: 38 }, power_on_time: { hours: 21000 }, ata_smart_attributes: { table: [{ id: 5, raw: { value: 8 } }, { id: 197, raw: { value: 0 } }] } })), { model: 'WD Red', passed: true, temp: 38, hours: 21000, reallocated: 8, pending: 0, wear: undefined });
  assert.deepEqual([10, 55, 75, 95].map((v) => C.level(v, C.DEFAULT_LIMITS.cpu)), ['ok', 'suivre', 'attention', 'grave']);
});

test('mesures gardées : minutes, moyennes, heures, fenêtres, Prometheus', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mes-'));
  try {
    let now = new Date('2026-11-12T10:00:30').getTime();
    const m = new Metrics(dir, () => now);
    m.put({ 'eir.cpu': 10, 'vordr.temps.nas': 200 }); m.put({ 'eir.cpu': 30 });
    now += 60_000; m.put({ 'eir.cpu': 50 }); now += 60_000; m.put({ 'eir.cpu': 70 }); now += 60_000; m.flush();
    assert.deepEqual(m.points('eir.cpu', now - 3600_000).map((p) => p[1]), [20, 50, 70], 'moyenne par minute');
    assert.deepEqual(m.names('eir.'), ['eir.cpu']);
    assert.equal(m.fn('eir.cpu', 'max', 10 * 60_000), 70); assert.equal(m.fn('eir.cpu', 'avg', 10 * 60_000), (20 + 50 + 70) / 3); assert.equal(m.fn('eir.cpu', 'delta', 10 * 60_000), 50);
    // Relu depuis le disque (une autre instance) et regroupé.
    const m2 = new Metrics(dir, () => now);
    assert.equal(m2.points('eir.cpu', now - 864e5).length, 3);
    const s = m2.series('eir.cpu', now - 864e5, now, 1); assert.equal(s.length, 1); assert.equal(s[0].max, 70); assert.equal(s[0].min, 20);
    // L'heure suivante : la moyenne horaire est écrite, gardée après la purge des minutes.
    now += 3600_000; m.put({ 'eir.cpu': 5 }); now += 60_000; m.put({ 'eir.cpu': 5 }); m.flush();
    now += 40 * 864e5; assert.ok(m.prune(31) >= 1);
    const old = new Metrics(dir, () => now).points('eir.cpu', now - 60 * 864e5, now);
    assert.equal(old.length, 1, 'une moyenne horaire'); assert.equal(old[0][1], 46.667);
    assert.match(m.prometheus() + new Metrics(dir, () => now).prometheus(), /^|# TYPE/);
    assert.ok(!new Metrics(dir).names().includes('nom invalide'));
    m.put({ 'nom invalide !': 1 }); assert.ok(!m.names().includes('nom invalide !'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('la vraie machine : instantané, séries, appli Eir', async () => {
  C.health(); await new Promise((r) => setTimeout(r, 300)); const h = C.health();
  assert.ok(h.cores >= 1 && h.mem.total > 0 && h.fs.length >= 0 && typeof h.cpu.total === 'number');
  const s = C.toSeries(h); assert.ok('eir.cpu' in s && 'eir.mem' in s && 'eir.load1' in s);
  const home = mkdtempSync(join(tmpdir(), 'eir-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async (cmd) => ({ code: cmd === 'ps' ? 0 : 1, out: cmd === 'ps' ? '  PID USER %CPU %MEM RSS STAT TIME COMMAND\n 1 root 0.0 0.1 1000 Ss 00:00:01 /sbin/init\n' : '', err: '' }), fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  try {
    await v.module('eir')!.watch!.run(v.ctx('eir')); v.metrics.flush();
    assert.ok(v.metrics.names('eir.').includes('eir.cpu'));
    assert.match((await v.act('eir', 'etat')).text, /Processeur .* % \(/);
    assert.match((await v.act('eir', 'mesures', { serie: 'eir.mem', periode: '1h' })).text, /eir\.mem sur 1h : moyenne/);
    assert.match((await v.act('eir', 'seuils', { mesure: 'cpu', suivre: 60, attention: 50, grave: 90 })).text, /bleu < orange < rouge/);
    assert.match((await v.act('eir', 'arreter_processus', { pid: 1 }, { auto: true })).text, /action grave/);
    assert.match((await v.act('eir', 'exporter')).text, /odin_eir_cpu/);
    const view = await v.module('eir')!.view(v.ctx('eir'), new URLSearchParams());
    assert.ok(view.sections.some((x) => x.title === 'Réseau'));
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
