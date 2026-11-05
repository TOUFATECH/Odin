import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditNetwork, autoBackup, healthCheck, newAlerts, setBackupPassword } from '../src/guard/watch.ts';
import { formatResources } from '../src/tools/proxmox.ts';
import type { Device } from '../src/hlidskjalf/inventory.ts';
import { makeOdin } from './helpers.ts';

const dev = (o: Partial<Device>): Device => ({ id: o.ip!, ip: '', mac: '', hostname: '', name: '', model: '', kind: 'inconnu', ports: [], services: [], server: '', network: '', status: 'online', first_seen: 0, last_seen: Date.now(), label: '', web: [], ...o } as Device);

test('audit de sécurité : ports à risque, administration non chiffrée, appareil inconnu récent ; grave en premier', () => {
  const now = Date.now();
  const f = auditNetwork([
    dev({ ip: '10.0.0.2', name: 'Box', kind: 'routeur', ports: [80], web: [{ port: 80, url: 'http://10.0.0.2/', title: 'Box', server: '', status: 200 }] }),
    dev({ ip: '10.0.0.3', name: 'Vieux PC', kind: 'ordinateur / serveur', ports: [22, 3389, 23] }),
    dev({ ip: '10.0.0.4', ports: [], first_seen: now - 3600_000 }),
    dev({ ip: '10.0.0.5', name: 'Docker', ports: [2375], status: 'offline' }),
  ], now);
  assert.deepEqual(f.map((x) => x.level), ['grave', 'attention', 'attention', 'info']);
  assert.match(f[0].title, /Telnet/);
  assert.ok(f.some((x) => /non chiffrée/.test(x.title) && x.ip === '10.0.0.2'));
  assert.ok(!f.some((x) => x.ip === '10.0.0.5'), 'un appareil hors ligne n\'est pas audité');
});

test('surveillance : appareil important tombé puis revenu, alerte envoyée une fois, certificat proche de l\'expiration', async () => {
  const o = makeOdin([]);
  const state = join(o.paths.logs, 'watch.json');
  try {
    const nas = dev({ ip: '10.0.0.9', id: 'nas', name: 'Coffre', status: 'offline', web: [{ port: 5001, url: 'https://10.0.0.9:5001/', title: 'DSM', server: '', status: 200 }] });
    const cfg = { enabled: true, intervalMin: 60, devices: ['nas'], diskPct: 101, certDays: 14 };
    const a1 = await healthCheck({ devices: [nas], cfg, paths: o.paths, certs: async () => 5 });
    const m1 = newAlerts(a1, state);
    assert.ok(m1.some((m) => /Coffre .* ne répond plus/.test(m)));
    assert.equal(m1.filter((m) => /certificat/.test(m)).length, 0, 'certificats vérifiés seulement pour les appareils en ligne');
    assert.deepEqual(newAlerts(a1, state), [], 'pas de répétition');
    const back = { ...nas, status: 'online' as const };
    const m2 = newAlerts(await healthCheck({ devices: [back], cfg, paths: o.paths, certs: async () => 5 }), state);
    assert.ok(m2.some((m) => /de nouveau en ligne/.test(m)));
    assert.ok(m2.some((m) => /expire dans 5 jour/.test(m)));
  } finally { o.cleanup(); }
});

test('sauvegarde automatique : chiffrée, une par jour, rotation', () => {
  const o = makeOdin([]);
  const dir = mkdtempSync(join(tmpdir(), 'odin-bk-'));
  try {
    const cfg = { enabled: true, hour: 3, dir, keep: 2 };
    assert.match(autoBackup(o.paths, cfg, new Date('2026-11-05T04:00:00'))?.error ?? '', /mot de passe/);
    setBackupPassword(o.paths, 'motdepasse-solide');
    assert.equal(autoBackup(o.paths, cfg, new Date('2026-11-05T02:00:00')), undefined, 'pas avant l\'heure');
    for (const d of ['2026-11-03', '2026-11-04']) writeFileSync(join(dir, `odin-sauvegarde-${d}.odinbk`), 'x');
    const r = autoBackup(o.paths, cfg, new Date('2026-11-05T04:00:00'));
    assert.ok(r?.file && existsSync(r.file));
    assert.equal(autoBackup(o.paths, cfg, new Date('2026-11-05T05:00:00')), undefined, 'une seule par jour');
    assert.deepEqual(readdirSync(dir).sort(), ['odin-sauvegarde-2026-11-04.odinbk', 'odin-sauvegarde-2026-11-05.odinbk']);
  } finally { o.cleanup(); rmSync(dir, { recursive: true, force: true }); }
});

test('Proxmox : liste lisible des nœuds, VM et conteneurs', () => {
  const s = formatResources([
    { type: 'node', node: 'pve', status: 'online', cpu: 0.12, mem: 4 * 1024 ** 3, maxmem: 32 * 1024 ** 3 },
    { type: 'lxc', node: 'pve', vmid: 105, name: 'odin', status: 'running', mem: 1024 ** 3, maxmem: 2 * 1024 ** 3 },
    { type: 'qemu', node: 'pve', vmid: 100, name: 'windows', status: 'stopped' },
  ]);
  assert.match(s, /Nœud pve : online · CPU 12 %/);
  assert.match(s.split('\n')[1], /^○ 100 windows · machine virtuelle · stopped/);
  assert.match(s, /● 105 odin · conteneur LXC · running · nœud pve · mémoire 1\.0 Go \/ 2\.0 Go/);
});

test('habitudes : demandes répétées repérées, ignorées sur demande', async () => {
  const o = makeOdin(Array.from({ length: 4 }, () => ({ text: 'ok' })));
  try {
    for (const t of ['Quelle est la météo à Mamoudzou ?', 'quelle est la meteo a Mamoudzou stp', 'Quelle est la météo à Mamoudzou', 'bonjour']) await o.agent.run(t, { sessionId: 'web:principal' });
    const h = o.muninn.habits();
    assert.equal(h.length, 1);
    assert.equal(h[0].count, 3);
    o.muninn.ignoreHabit(h[0].key);
    assert.deepEqual(o.muninn.habits(), []);
  } finally { o.cleanup(); }
});
