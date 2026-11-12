// Le parc d'Ymir : noms automatiques, ports libres, dossiers refusés, installation Docker vérifiée pas à pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoName, freePort, parseMounts, parsePorts, slug, usedPorts } from '../src/valhalla/parc.ts';
import { installDocker, parc } from '../src/valhalla/modules/ymir.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { useEngine } from '../src/valhalla/modules/naglfar.ts';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('noms automatiques : préfixe du type, ce que c\'est, numéro libre', () => {
  assert.equal(slug('jellyfin/jellyfin:10.11.1'), 'jellyfin');
  assert.equal(slug('Windows 11 Pro'), 'windows-11-pro');
  assert.equal(autoName('Docker', 'jellyfin/jellyfin', []), 'dk-jellyfin-01');
  assert.equal(autoName('Docker', 'jellyfin/jellyfin', ['dk-jellyfin-01']), 'dk-jellyfin-02');
  assert.equal(autoName('LXC', 'Debian 13', []), 'lxc-debian-13-01');
  assert.equal(autoName('Pile', 'immich', []), 'pile-immich-01');
});

test('ports : on lit ce qui est pris, on prend le suivant libre', () => {
  const used = usedPorts(['0.0.0.0:8096->8096/tcp, [::]:8096->8096/tcp'], 'LISTEN 0 4096 0.0.0.0:8097 0.0.0.0:*\nLISTEN 0 128 127.0.0.1:631 0.0.0.0:*');
  assert.deepEqual([...used].sort(), [631, 8096, 8097]);
  assert.equal(freePort(8096, used), 8098);
  assert.equal(freePort(3000, used), 3000);
  assert.deepEqual(parsePorts('8096:8096, 7359/udp'), [{ host: 8096, inner: 8096, proto: 'tcp' }, { host: 7359, inner: 7359, proto: 'udp' }]);
  assert.throws(() => parsePorts('80;rm'), /port invalide/);
  assert.throws(() => parsePorts('70000:80'), /port invalide/);
});

test('dossiers : chemins absolus seulement, jamais le système ni le socket Docker', () => {
  assert.deepEqual(parseMounts('/data/medias:/media:ro, /data/jf:/config'), [{ host: '/data/medias', inner: '/media', ro: true }, { host: '/data/jf', inner: '/config', ro: false }]);
  for (const bad of ['/:/host', '/etc:/etc', '/var/run/docker.sock:/var/run/docker.sock', 'data:/x', '/data/../etc:/x']) assert.throws(() => parseMounts(bad), /dossier/);
});

/** Un contexte simulé : Docker présent, 8096 déjà pris par un autre conteneur. */
function fakeCtx(o: { exitAfterRun?: boolean } = {}) {
  const runs: string[][] = [], calls: Array<[string, string, Record<string, unknown>]> = [], saved: Record<string, unknown>[] = [];
  const ctx = {
    settings: {} as Record<string, unknown>,
    saveSettings: (x: Record<string, unknown>) => { saved.push(x); Object.assign(ctx.settings, x); },
    has: async (c: string) => c === 'docker',
    run: async (cmd: string, args: string[]) => {
      runs.push([cmd, ...args]);
      if (cmd === 'ss') return { code: 0, out: 'LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*', err: '' };
      if (args[0] === 'ps') return { code: 0, out: JSON.stringify({ Names: 'autre', Ports: '0.0.0.0:8096->8096/tcp' }), err: '' };
      if (args[0] === 'image') return { code: 0, out: '512000000', err: '' };
      if (args[0] === 'inspect') return { code: 0, out: o.exitAfterRun ? 'exited' : 'running', err: '' };
      if (args[0] === 'logs') return { code: 0, out: 'erreur : config absente', err: '' };
      return { code: 0, out: '', err: '' };
    },
    call: async (mod: string, act: string, input: Record<string, unknown>) => {
      calls.push([mod, act, input]);
      if (mod === 'naglfar' && act === 'lister') return { text: '', data: [{ Names: 'jellyfin', Image: 'jellyfin/jellyfin', State: 'running', Status: 'Up', Ports: '', Labels: '' }, { Names: 'immich_server', Image: 'immich', State: 'running', Status: 'Up', Ports: '', Labels: 'com.docker.compose.project=immich' }] };
      if (mod === 'thjalfi') return { text: '', data: [{ mac: 'aa:bb', host: 'bureau', ip: '192.168.1.20', step: 'fini', isoName: 'Windows 11' }] };
      return { text: 'ok' };
    },
  };
  return { ctx: ctx as unknown as ModCtx, runs, calls, saved };
}

test('parc : Docker, piles et ordinateurs réunis, noms automatiques gardés', async () => {
  const f = fakeCtx(), { units } = await parc(f.ctx);
  assert.deepEqual(units.map((u) => `${u.kind}:${u.auto}`), ['Docker:dk-jellyfin-01', 'Pile:pile-immich-01', 'PC:pc-windows-11-01']);
  const again = await parc(f.ctx);
  assert.deepEqual(again.units.map((u) => u.auto), units.map((u) => u.auto), 'les noms ne changent pas d\'un appel à l\'autre');
  assert.equal(f.saved.length, 1, 'enregistrés une seule fois');
});

/** Un faux moteur d'Odin : « autre » tourne déjà sur le port 8096. */
function fakeEng(o: { exitAfterRun?: boolean } = {}) {
  const ran: Array<Record<string, unknown>> = [];
  const autre = { id: 'x', spec: { name: 'autre', ports: [{ host: 8096, inner: 8096, proto: 'tcp' }] }, state: { status: 'en marche' } };
  let made: { spec: { name: string }; state: { status: string; exitCode?: number } } | null = null;
  useEngine(() => ({
    getTools: async () => ({}),
    pull: async (n: string) => ({ id: 'b'.repeat(64), names: [n], size: 512e6 }),
    ps: () => [autre, ...(made ? [made] : [])],
    run: async (opts: Record<string, unknown>) => { ran.push(opts); made = { spec: { name: String(opts.name) }, state: { status: o.exitAfterRun ? 'sorti' : 'en marche', exitCode: o.exitAfterRun ? 1 : undefined } }; return made; },
    find: (n: string) => (n === 'autre' ? autre : made!),
    logs: () => [{ text: 'erreur : config absente' }],
  }) as never);
  return ran;
}

test('installer un conteneur : port pris corrigé, santé vérifiée, suivi branché (moteur d\'Odin, sans Docker)', async () => {
  const ran = fakeEng(), f = fakeCtx(), dir = mkdtempSync(join(tmpdir(), 'parc-'));
  try {
    const r = await installDocker(f.ctx, { image: 'jellyfin/jellyfin:10.11.1', ports: '8096:8096', dossiers: `${dir}/jf:/config`, memoire: '4g' }, async () => {});
    assert.ok(r.ok, JSON.stringify(r.steps));
    assert.equal(r.name, 'dk-jellyfin-02', 'dk-jellyfin-01 est déjà dans le parc');
    assert.deepEqual(r.ports.map((p) => p.host), [8097]);
    assert.equal(r.steps.find((x) => x.t === 'Choisir les ports')?.state, 'corrigé');
    assert.equal(r.steps[0].t, 'Vérifier le moteur d\'Odin');
    assert.ok(existsSync(join(dir, 'jf')), 'dossier créé');
    assert.deepEqual((ran[0].ports as Array<{ host: number }>).map((p) => p.host), [8097]);
    assert.equal(ran[0].memory, '4g'); assert.equal(ran[0].restart, 'sauf-arret');
    assert.ok(!f.runs.some((x) => /docker|podman/.test(x[0])), 'ni Docker ni Podman');
    assert.ok(f.calls.some(([m, a, i]) => m === 'vordr' && a === 'ajouter' && i.cible === '127.0.0.1:8097'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('installer un conteneur : arrêt net si le conteneur tombe, rien d\'inventé', async () => {
  fakeEng({ exitAfterRun: true });
  const f = fakeCtx(), r = await installDocker(f.ctx, { image: 'jellyfin/jellyfin', ports: '9000' }, async () => {});
  assert.equal(r.ok, false);
  assert.match(r.steps.at(-1)!.note ?? '', /config absente/);
  assert.ok(!f.calls.some(([m]) => m === 'vordr'), 'pas de sonde sur un conteneur en échec');
  await assert.rejects(installDocker(f.ctx, { image: 'x; rm -rf /' }), /image invalide/);
  await assert.rejects(installDocker(f.ctx, { image: 'nginx', dossiers: '/etc:/etc' }), /refusé/);
});
