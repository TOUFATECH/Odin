// Mise à l'échelle automatique du moteur (Hringhorni) : la décision (monter vite, descendre doucement, budget de
// la machine), grandir en place, et un vrai service (copies busybox derrière le répartiteur) qui monte avec les
// visiteurs, remplace une copie tuée sans perdre de visiteur, puis redescend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SCALE, capacity, decide, vertical } from '../src/valhalla/hringhorni/scale.ts';
import { Engine } from '../src/valhalla/hringhorni/engine.ts';
import { defineService, removeService, serviceOf, startService, tuneService } from '../src/valhalla/hringhorni/services.ts';
import { busyboxLayer, fakeRegistry } from './oci-fixtures.ts';
import { cli } from '../src/valhalla/hringhorni/cli.ts';
import { readFileSync } from 'node:fs';

const C = { ...DEFAULT_SCALE, min: 2, max: 10, conns: 100, cpu: 70, upCooldown: 30, downDelay: 300 };
const s = (n: number, cpu: number, conns: number) => Array.from({ length: n }, () => ({ cpu, mem: 30, conns }));

test('décision : monter vite, jamais au-delà du budget, descendre d\'une copie après un long calme', () => {
  const t = 1_000_000;
  let d = decide(2, s(2, 95, 50), C, 10, {}, t); assert.equal(d.want, 3, 'processeur à 95 % pour 70 visé → 3'); assert.match(d.reason, /processeur à 95 %/);
  d = decide(2, s(2, 20, 600), C, 10, {}, t); assert.equal(d.want, 4, '1200 visiteurs pour 100 par copie : on double au plus d\'un coup');
  d = decide(4, s(4, 20, 600), C, 10, d.memory, t + 10_000); assert.equal(d.want, 4, 'on attend que les nouvelles copies prennent leur part');
  d = decide(4, s(4, 20, 600), C, 10, d.memory, t + 40_000); assert.equal(d.want, 8);
  d = decide(8, s(8, 20, 600), C, 6, {}, t); assert.equal(d.want, 6, 'budget de la machine'); assert.match(d.reason, /budget/);
  d = decide(8, s(8, 20, 600), C, 9, {}, t + 1); assert.equal(d.want, 9);
  // calme : une de moins seulement après 5 min
  let m = decide(4, s(4, 10, 5), C, 10, {}, t); assert.equal(m.want, 4); assert.ok(m.memory.lowSince);
  m = decide(4, s(4, 10, 5), C, 10, m.memory, t + 200_000); assert.equal(m.want, 4);
  m = decide(4, s(4, 10, 5), C, 10, m.memory, t + 301_000); assert.equal(m.want, 3); assert.match(m.reason, /calme depuis 5 min/);
  m = decide(3, s(3, 10, 5), C, 10, m.memory, t + 302_000); assert.equal(m.want, 3, 'une à la fois');
  assert.equal(decide(2, s(2, 5, 1), C, 10, { lowSince: 0 }, t).want, 2, 'jamais sous le minimum');
  assert.equal(decide(1, [], C, 10, {}, t).want, 2, 'minimum rétabli');
  // un pic bref ne fait pas redescendre : le calme repart de zéro
  m = decide(4, s(4, 10, 5), C, 10, { lowSince: t }, t + 100_000); m = decide(4, s(4, 60, 90), C, 10, m.memory, t + 110_000); assert.equal(m.memory.lowSince, undefined);
});

test('budget : ce qui tient encore sur la machine', () => {
  const G = 1024 ** 3;
  assert.equal(capacity({ cpus: 1, memory: G / 2 }, { cpus: 2, memory: 2 * G }, { cpus: 6.4, memory: 12.8 * G }, 64 * G, 0), 4, 'processeur : (6,4 − 2) / 1');
  assert.equal(capacity({ cpus: 0.5, memory: 2 * G }, { cpus: 0, memory: 8 * G }, { cpus: 16, memory: 12 * G }, 64 * G, 0), 2, 'mémoire du budget');
  assert.equal(capacity({ cpus: 0.5, memory: G }, { cpus: 0, memory: 0 }, { cpus: 16, memory: 64 * G }, 3 * G, G), 2, 'mémoire vraiment libre (réserve gardée)');
});

test('grandir en place (base de données) : +25 % de mémoire, +½ cœur, redescendre doucement', () => {
  const G = 1024 ** 3, v = { minMem: G, maxMem: 8 * G, minCpus: 1, maxCpus: 4 };
  let r = vertical({ memory: 2 * G, cpus: 1 }, { cpu: 95, mem: 90, usedMem: 1.8 * G }, v, false);
  assert.equal(r.memory, 2.5 * G); assert.equal(r.cpus, 1.5); assert.match(r.reason!, /mémoire à 90 %.*processeur à 95 %/);
  r = vertical({ memory: 8 * G, cpus: 4 }, { cpu: 99, mem: 99, usedMem: 8 * G }, v, false); assert.equal(r.memory, 8 * G); assert.equal(r.reason, undefined, 'au plafond');
  r = vertical({ memory: 4 * G, cpus: 2 }, { cpu: 10, mem: 20, usedMem: 0.8 * G }, v, true); assert.ok(r.memory < 4 * G && r.memory >= 1.6 * G); assert.equal(r.cpus, 1.5);
  assert.equal(vertical({ memory: 4 * G, cpus: 2 }, { cpu: 10, mem: 20, usedMem: 0.8 * G }, v, false).reason, undefined, 'pas de calme assez long : rien');
});

const canRun = (() => { try { return process.getuid?.() === 0 && existsSync('/usr/bin/busybox') && (execFileSync('unshare', ['-m', '-p', '--fork', 'true']), execFileSync('ip', ['netns', 'add', 'odin-essai-scale']), execFileSync('ip', ['netns', 'del', 'odin-essai-scale']), true); } catch { return false; } })();
let dbg: (() => unknown) | undefined;
const until = async (f: () => boolean, ms: number, what: string) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error(`trop long : ${what} ${JSON.stringify(dbg?.())}`); await new Promise((r) => setTimeout(r, 200)); } };

test('un vrai service : monte avec les visiteurs, remplace une copie tuée sans perdre personne, redescend', { skip: !canRun && 'il faut être administrateur avec unshare, ip netns et busybox', timeout: 180_000 }, async () => {
  process.env.ODIN_SCALE_TICK_MS = '600';
  const dir = mkdtempSync(join(tmpdir(), 'hr-scale-')), reg = await fakeRegistry([busyboxLayer()]), e = new Engine(dir);
  const held: net.Socket[] = []; let stop = false, ok = 0, failed = 0;
  try {
    const ref = `127.0.0.1:${reg.port}/odin/boite:1`; await e.pull(ref);
    defineService(e, { name: 'site', image: ref, ports: '18190:8080', cmd: ['/bin/sh', '-c', 'httpd -f -p 8080 -h /www'], min: 1, max: 3, conns: 4, cpus: '0.2', memory: '64m', upCooldown: 1, downDelay: 3 });
    dbg = () => { const x = serviceOf(e, 'site')!.state; return { r: x.replicas, ev: x.events.slice(0, 8), reason: x.reason, ps: e.ps(true).map((c) => [c.spec.name, c.state.status, c.state.error]) }; };
    const st = await startService(e, 'site'); assert.equal(st.status, 'en marche'); assert.equal(st.replicas.length, 1);
    // des visiteurs en continu pendant tout l'essai : aucun ne doit échouer
    const visits = (async () => { while (!stop) { try { const t = await (await fetch('http://127.0.0.1:18190/')).text(); if (t === 'salut depuis le conteneur') ok++; else failed++; } catch { failed++; } await new Promise((r) => setTimeout(r, 50)); } })();
    // 16 visiteurs qui restent connectés : 16 / 4 par copie → il en faut 3 (le maximum)
    for (let i = 0; i < 16; i++) held.push(net.connect(18190, '127.0.0.1'));
    await until(() => serviceOf(e, 'site')!.state.replicas.filter((r) => r.healthy).length === 3, 30_000, 'montée à 3 copies');
    assert.ok(serviceOf(e, 'site')!.state.events.some((x) => /➕ .*visiteurs en cours/.test(x.text)), JSON.stringify(serviceOf(e, 'site')!.state.events));
    // on tue une copie : le répartiteur la remplace, les visiteurs passent par les autres
    const victim = e.ps().find((c) => c.spec.name.startsWith('site-'))!; process.kill(victim.state.pid!, 'SIGKILL');
    await until(() => serviceOf(e, 'site')!.state.events.some((x) => /s'est arrêtée : remplacée|ne répond plus/.test(x.text)), 20_000, 'copie tuée vue');
    await until(() => serviceOf(e, 'site')!.state.replicas.filter((r) => r.healthy).length === 3, 30_000, 'copie remplacée');
    // réglage à chaud : 2 au plus
    const out: string[] = []; assert.equal(await cli(['scale', 'site', '1-2'], { out: (t) => out.push(t), err: (t) => out.push(t), interactive: false }, e), 0, out.join('\n')); assert.match(out[0], /de 1 à 2 copies/);
    await until(() => serviceOf(e, 'site')!.state.replicas.filter((r) => !r.draining).length === 2, 20_000, 'maximum abaissé');
    // les visiteurs partent : on redescend à 1 (après le calme de 3 s)
    for (const h of held) h.destroy();
    await until(() => serviceOf(e, 'site')!.state.replicas.length === 1, 40_000, 'descente à 1');
    stop = true; await visits;
    assert.ok(ok > 20, `visites réussies : ${ok}`); assert.equal(failed, 0, `visites perdues : ${failed} sur ${ok + failed}`);
    // grandir en place : une base reçoit plus de mémoire sans s'arrêter
    const db = await e.run({ image: ref, name: 'base', memory: '64m', cpus: '0.5', cmd: ['/bin/sh', '-c', 'sleep 300'] });
    const cg = join('/sys/fs/cgroup/odin', db.id.slice(0, 12));
    if (existsSync(join(cg, 'memory.max'))) {
      assert.equal(readFileSync(join(cg, 'memory.max'), 'utf8').trim(), String(64 * 1024 ** 2));
      const r = await e.resize('base', { memory: '128m', cpus: '1', grow: '64m-1g/0.5-2' });
      assert.equal(readFileSync(join(cg, 'memory.max'), 'utf8').trim(), String(128 * 1024 ** 2)); assert.equal(readFileSync(join(cg, 'cpu.max'), 'utf8').trim(), '100000 100000');
      assert.equal(r.spec.labels['odin.grandir'], '64m-1g/0.5-2'); assert.equal(e.find('base').state.pid, db.state.pid, 'sans redémarrer');
    }
    await e.rm('base', true);
    await removeService(e, 'site');
    assert.equal(e.ps(true).filter((c) => c.spec.name.startsWith('site-')).length, 0, 'copies retirées');
  } finally {
    stop = true; for (const h of held) h.destroy();
    await removeService(e, 'site').catch(() => {});
    for (const c of e.ps(true)) await e.rm(c.id, true).catch(() => {});
    reg.srv.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.ODIN_SCALE_TICK_MS;
  }
});

test('dans la discussion : service, scale, resize ; créer / arrêter / supprimer un service demande ton accord', async () => {
  const { chatCommand, graveOf } = await import('../src/valhalla/modules/naglfar.ts');
  const known = () => ['db', 'web'];
  assert.equal(chatCommand('service ls', known), 'service ls');
  assert.equal(chatCommand('service create --name site -p 8080:80 --min 2 --max 10 nginx', known), 'service create --name site -p 8080:80 --min 2 --max 10 nginx');
  assert.equal(chatCommand('resize db --memory 2g', known), 'resize db --memory 2g');
  assert.equal(chatCommand('service de nettoyage', known), undefined, 'une phrase ordinaire n\'est pas une commande');
  assert.match(graveOf('service create --name site -p 8080:80 nginx')!, /créer un service/);
  assert.match(graveOf('service rm site')!, /supprimer le service site/);
  assert.match(graveOf('service stop site')!, /arrêter/);
  assert.equal(graveOf('service ls'), undefined); assert.equal(graveOf('scale site 2-10'), undefined); assert.equal(graveOf('resize db --memory 2g'), undefined);
});
