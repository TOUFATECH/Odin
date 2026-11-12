// Hringhorni, le moteur de conteneurs d'Odin : noms d'images, dépaquetage sûr, registre (jeton, multi-architecture,
// morceaux vérifiés), puis un vrai conteneur (busybox) quand la machine le permet (administrateur + unshare).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, lstatSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { parseRef } from '../src/valhalla/hringhorni/registry.ts';
import { cleanPath, extractLayer } from '../src/valhalla/hringhorni/tar.ts';
import { resolveIn, setupScript } from '../src/valhalla/hringhorni/script.ts';
import { Engine } from '../src/valhalla/hringhorni/engine.ts';
import { parseArgs } from '../src/valhalla/hringhorni/cli.ts';

/** Une entrée tar (ustar) pour fabriquer des couches de test. */
function entry(name: string, o: { type?: string; data?: Buffer | string; link?: string; mode?: number } = {}): Buffer {
  const data = Buffer.isBuffer(o.data) ? o.data : Buffer.from(o.data ?? ''), h = Buffer.alloc(512);
  h.write(name, 0, 100); h.write(((o.mode ?? (o.type === '5' ? 0o755 : 0o644)).toString(8)).padStart(7, '0'), 100); h.write('0000000', 108); h.write('0000000', 116);
  h.write(data.length.toString(8).padStart(11, '0'), 124); h.write('00000000000', 136); h.fill(' ', 148, 156); h.write(o.type ?? '0', 156); if (o.link) h.write(o.link, 157, 100); h.write('ustar\0' + '00', 257);
  let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
const tarOf = (...e: Buffer[]) => Buffer.concat([...e, Buffer.alloc(1024)]);

test('noms d\'images : comme les autres moteurs', () => {
  assert.deepEqual(parseRef('nginx'), { registry: 'docker.io', repo: 'library/nginx', tag: 'latest', digest: undefined, name: 'nginx:latest' });
  assert.equal(parseRef('jellyfin/jellyfin:10.11.1').repo, 'jellyfin/jellyfin');
  assert.equal(parseRef('ghcr.io/immich-app/immich-server:v2').registry, 'ghcr.io');
  assert.equal(parseRef('localhost:5000/moi/appli').registry, 'localhost:5000');
  assert.equal(parseRef(`alpine@sha256:${'a'.repeat(64)}`).digest, `sha256:${'a'.repeat(64)}`);
  for (const bad of ['', 'Bad Name', 'x;rm -rf /', 'a/../b', 'nginx:<1>']) assert.throws(() => parseRef(bad));
});

test('dépaquetage : rien ne sort de la racine, liens piégés et whiteouts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hr-tar-')), outside = mkdtempSync(join(tmpdir(), 'hr-out-'));
  try {
    assert.equal(cleanPath('../etc/passwd'), null); assert.equal(cleanPath('./a//b/'), 'a/b');
    const l1 = tarOf(entry('etc/', { type: '5' }), entry('etc/garde', { data: 'oui' }), entry('etc/vieux', { data: 'x' }), entry('vide/', { type: '5' }), entry('vide/a', { data: '1' }),
      entry('piege', { type: '2', link: outside }), entry('piege/fichier', { data: 'NON' }), entry('../evade', { data: 'NON' }), entry('/abs', { data: 'ok' }),
      entry('bin/', { type: '5' }), entry('bin/outil', { data: '#!/bin/sh', mode: 0o755 }), entry('bin/lien-dur', { type: '1', link: 'bin/outil' }), entry('dev/null', { type: '3' }));
    const s1 = await extractLayer(Readable.from([gzipSync(l1)]).pipe((await import('node:zlib')).createGunzip()), root, {});
    assert.ok(!existsSync(join(outside, 'fichier')));
    assert.equal(readFileSync(join(root, outside.slice(1), 'fichier'), 'utf8'), 'NON', 'le lien est suivi DANS la racine');
    assert.ok(!existsSync(join(root, '..', 'evade')) && s1.skipped.includes('../evade'));
    assert.equal(readFileSync(join(root, 'abs'), 'utf8'), 'ok');
    assert.equal(lstatSync(join(root, 'bin/outil')).mode & 0o777, 0o755);
    assert.ok(!existsSync(join(root, 'dev/null')), 'pas de périphérique créé depuis une image');
    // couche 2 : efface un fichier, vide un dossier (sauf ce que la couche ajoute)
    const l2 = tarOf(entry('etc/.wh.vieux'), entry('vide/.wh..wh..opq'), entry('vide/b', { data: '2' }));
    await extractLayer(Readable.from([l2]), root, {});
    assert.ok(!existsSync(join(root, 'etc/vieux')) && existsSync(join(root, 'etc/garde')));
    assert.ok(!existsSync(join(root, 'vide/a')) && existsSync(join(root, 'vide/b')));
    assert.equal(readlinkSync(join(root, 'piege')), outside);
    // résolution d'une cible de montage : un lien vers /etc reste dans la racine
    assert.equal(await resolveIn([root], '/piege/x'), `${outside.slice(1)}/x`);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});

test('commandes : options comme les moteurs connus', () => {
  const a = parseArgs(['-d', '--name', 'jf', '-p', '8096:8096', '-p', '7359:7359/udp', '-v', '/data/jf:/config', '-e', 'TZ=Indian/Mayotte', '--restart', 'unless-stopped', '--memory', '2g', 'jellyfin/jellyfin', 'arg1']);
  assert.equal(a.flags.d, true); assert.equal(a.opts.name, 'jf'); assert.deepEqual(a.multi.p, ['8096:8096', '7359:7359/udp']);
  assert.deepEqual(a.multi.e, ['TZ=Indian/Mayotte']); assert.deepEqual(a.rest, ['jellyfin/jellyfin', 'arg1']);
  const b = parseArgs(['--name=x', '-it', 'alpine', 'sh', '-c', 'echo -n hi']);
  assert.equal(b.opts.name, 'x'); assert.equal(b.flags.i, true); assert.deepEqual(b.rest, ['alpine', 'sh', '-c', 'echo -n hi']);
});

/** Un petit registre local : jeton obligatoire, liste multi-architecture, un morceau qu'on peut abîmer. */
function fakeRegistry(layers: Buffer[], o: { corrupt?: boolean } = {}): Promise<{ srv: Server; port: number }> {
  const sha = (b: Buffer) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
  const cfg = Buffer.from(JSON.stringify({ architecture: 'amd64', os: 'linux', config: { Env: ['PATH=/bin', 'BONJOUR=odin'], Cmd: ['/bin/sh', '-c', 'echo bonjour; sleep 30'], WorkingDir: '/' } }));
  const blobs = new Map<string, Buffer>([[sha(cfg), cfg], ...layers.map((l) => [sha(l), l] as [string, Buffer])]);
  const man = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha(cfg), size: cfg.length }, layers: layers.map((l) => ({ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: sha(l), size: l.length })) }));
  const idx = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ mediaType: 'application/vnd.oci.image.manifest.v1+json', digest: sha(man), size: man.length, platform: { os: 'linux', architecture: process.arch === 'arm64' ? 'arm64' : 'amd64' } }, { mediaType: 'x', digest: `sha256:${'0'.repeat(64)}`, size: 1, platform: { os: 'unknown', architecture: 'unknown' } }] }));
  return new Promise((res) => {
    const srv = createServer((req, r) => {
      const port = (srv.address() as { port: number }).port;
      if (req.url!.startsWith('/jeton')) { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ token: 'ok' })); }
      if (req.headers.authorization !== 'Bearer ok') { r.statusCode = 401; r.setHeader('www-authenticate', `Bearer realm="http://127.0.0.1:${port}/jeton",service="test",scope="repository:odin/boite:pull"`); return r.end(); }
      const m = /^\/v2\/odin\/boite\/(manifests|blobs)\/(.+)$/.exec(req.url!); if (!m) { r.statusCode = 404; return r.end(); }
      if (m[1] === 'manifests') { const b = m[2] === '1' ? idx : m[2] === sha(man) ? man : null; if (!b) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', b === idx ? 'application/vnd.oci.image.index.v1+json' : 'application/vnd.oci.image.manifest.v1+json'); return r.end(b); }
      const b = blobs.get(m[2]); if (!b) { r.statusCode = 404; return r.end(); }
      if (o.corrupt && b !== cfg) { const x = Buffer.from(b); x[x.length - 1] ^= 1; return r.end(x); }
      r.end(b);
    }).listen(0, '127.0.0.1', () => res({ srv, port: (srv.address() as { port: number }).port }));
  });
}
const busyboxLayer = () => {
  const bb = readFileSync('/usr/bin/busybox'), tools = ['sh', 'echo', 'sleep', 'cat', 'ls', 'id', 'hostname', 'httpd', 'mkdir', 'ps'];
  return gzipSync(tarOf(entry('bin/', { type: '5' }), entry('bin/busybox', { data: bb, mode: 0o755 }), ...tools.map((t) => entry(`bin/${t}`, { type: '2', link: 'busybox' })),
    entry('etc/', { type: '5' }), entry('etc/passwd', { data: 'root:x:0:0:root:/root:/bin/sh\nnobody:x:65534:65534:nobody:/:/bin/sh\n' }), entry('etc/group', { data: 'root:x:0:\nnobody:x:65534:\n' }),
    entry('www/', { type: '5' }), entry('www/index.html', { data: 'salut depuis le conteneur' })));
};

test('registre : jeton, bonne architecture, morceaux vérifiés ; un morceau abîmé est refusé', { skip: !existsSync('/usr/bin/busybox') && 'busybox absent' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hr-reg-')), layer = busyboxLayer();
  const ok = await fakeRegistry([layer]), bad = await fakeRegistry([layer], { corrupt: true });
  try {
    const e = new Engine(dir, { rootless: true }), steps: string[] = [];
    const phases: string[] = []; let maxPct = 0;
    const { pctOf } = await import('../src/valhalla/hringhorni/engine.ts');
    const img = await e.pull(`127.0.0.1:${ok.port}/odin/boite:1`, (t) => steps.push(t), (p) => { if (phases.at(-1) !== p.phase) phases.push(p.phase); const k = pctOf(p, false); assert.ok(k >= maxPct - 0.0001 || p.phase !== phases.at(-1), 'la barre ne recule pas'); maxPct = Math.max(maxPct, k); });
    assert.deepEqual(phases, ['télécharger', 'monter', 'fini'], 'téléchargement, montage, terminé');
    assert.equal(maxPct, 100);
    assert.ok(steps.includes('Image prête'));
    assert.ok(existsSync(join(e.store.rootfs(img.id), 'bin/busybox')));
    assert.equal(lstatSync(join(e.store.rootfs(img.id), 'bin/sh')).isSymbolicLink(), true);
    assert.deepEqual(img.config.config?.Cmd, ['/bin/sh', '-c', 'echo bonjour; sleep 30']);
    assert.equal(e.images().length, 1);
    const e2 = new Engine(mkdtempSync(join(tmpdir(), 'hr-reg2-')), { rootless: true });
    await assert.rejects(e2.pull(`127.0.0.1:${bad.port}/odin/boite:1`), /altéré/);
    assert.equal(e2.images().length, 0, 'rien gardé');
    rmSync(e2.store.dir, { recursive: true, force: true });
    // le script de préparation : outils de base seulement, racine enfermée, capacités réduites
    const spec = await e.create({ image: img.names[0], name: 'essai', network: 'hote' });
    const sc = setupScript(await e.plan(spec));
    assert.match(sc, /mount -t overlay/); assert.match(sc, /--bounding-set=-all,\+chown/); assert.match(sc, /--root=/);
    assert.doesNotMatch(sc, /docker|podman|kube/i);
    await assert.rejects(e.create({ image: img.names[0], name: 'essai' }), /déjà pris/);
    await assert.rejects(e.create({ image: img.names[0], mounts: '/etc:/x' }), /refusé/);
    assert.equal((await e.rm('essai')).name, 'essai');
    // une installation suivie : la barre va jusqu'au bout, l'interface la relit
    const { cli } = await import('../src/valhalla/hringhorni/cli.ts');
    const lines: string[] = []; assert.equal(await cli(['pull', `127.0.0.1:${ok.port}/odin/boite:1`], { out: (t) => lines.push(t), err: (t) => lines.push(t), interactive: false, tty: false }, e), 0);
    assert.ok(lines.some((l) => /\[█+░*\] +\d+ % Téléchargement|Montage|Terminé/.test(l)), lines.join('\n'));
    const j = e.pullJob(`127.0.0.1:${ok.port}/odin/boite:1`);
    for (let k = 0; k < 50 && !e.jobs().find((x) => x.id === j.id)?.ended; k++) await new Promise((r) => setTimeout(r, 50));
    const done = e.jobs().find((x) => x.id === j.id)!;
    assert.equal(done.phase, 'fini'); assert.equal(done.pct, 100);
    const bad2 = e.startJob('installer', 'x', async () => { throw new Error('plus de place'); });
    for (let k = 0; k < 20 && !e.jobs().find((x) => x.id === bad2.id)?.ended; k++) await new Promise((r) => setTimeout(r, 25));
    assert.match(e.jobs().find((x) => x.id === bad2.id)!.note, /Échec : plus de place/);
  } finally { ok.srv.close(); bad.srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

const canRun = (() => { try { return process.getuid?.() === 0 && existsSync('/usr/bin/busybox') && (execFileSync('unshare', ['-m', '-p', '--fork', 'true']), true); } catch { return false; } })();
test('un vrai conteneur : lancer, lister, journal, exec, isolé, port publié, arrêt, suppression', { skip: !canRun && 'il faut être administrateur avec unshare et busybox' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hr-run-')), reg = await fakeRegistry([busyboxLayer()]);
  const data = join(dir, 'donnees'); mkdirSync(data); writeFileSync(join(data, 'note.txt'), 'partagé');
  const e = new Engine(dir);
  try {
    const ref = `127.0.0.1:${reg.port}/odin/boite:1`;
    const net = (await import('node:child_process')).spawnSync('ip', ['netns', 'add', 'odin-essai-test']).status === 0 ? 'pont' : 'hote';
    if (net === 'pont') execFileSync('ip', ['netns', 'del', 'odin-essai-test']);
    const c = await e.run({ image: ref, name: 'boite', network: net, mounts: `${data}:/donnees:ro`, ports: '18089:8080', cmd: ['/bin/sh', '-c', 'echo bonjour $BONJOUR; httpd -f -p 8080 -h /www'] });
    assert.equal(c.state.status, 'en marche');
    if (net === 'pont') assert.match(c.state.ip ?? '', /^10\.89\.0\.\d+$/, 'réseau privé des conteneurs');
    assert.equal(e.ps().length, 1);
    for (let i = 0; i < 30 && !e.logs('boite').some((l) => /bonjour odin/.test(l.text)); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(e.logs('boite').some((l) => l.text === 'bonjour odin'), JSON.stringify(e.logs('boite')));
    const run = async (argv: string[]) => { const x = await e.execArgs('boite', argv); return execFileSync(x.cmd, x.args, { env: x.env, encoding: 'utf8' }); };
    assert.equal((await run(['cat', '/donnees/note.txt'])), 'partagé');
    assert.equal((await run(['hostname'])).trim(), 'boite');
    assert.doesNotMatch(await run(['ls', '/']), /home|claude|root\b.*opt/, 'la machine n\'est pas visible');
    assert.match(await run(['ls', '/']), /bin/);
    assert.equal((await run(['sh', '-c', 'echo $$'])).trim() !== '1', true);
    const w = await (await e.execArgs('boite', ['sh', '-c', 'echo x > /donnees/y 2>/dev/null && echo ecrit || echo lecture-seule'])); assert.equal(execFileSync(w.cmd, w.args, { env: w.env, encoding: 'utf8' }).trim(), 'lecture-seule');
    let page = ''; for (let i = 0; i < 30 && !page; i++) { try { page = await (await fetch('http://127.0.0.1:18089/')).text(); } catch { await new Promise((r) => setTimeout(r, 150)); } }
    assert.equal(page, 'salut depuis le conteneur');
    const s = await e.stop('boite', 2);
    assert.equal(s.state.status, 'arrêté');
    assert.equal(e.ps().length, 0); assert.equal(e.ps(true).length, 1);
    await e.rm('boite');
    assert.equal(e.ps(true).length, 0);
  } finally {
    for (const c of e.ps(true)) await e.rm(c.id, true).catch(() => {});
    reg.srv.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('dans la discussion : les commandes comme dans un terminal, sans « odin » devant', async () => {
  const { chatCommand, graveOf } = await import('../src/valhalla/modules/naglfar.ts');
  const known = () => ['web', 'base'];
  assert.equal(chatCommand('ps', known), 'ps');
  assert.equal(chatCommand('ps -a', known), 'ps -a');
  assert.equal(chatCommand('run -d --name web2 -p 8080:80 nginx', known), 'run -d --name web2 -p 8080:80 nginx');
  assert.equal(chatCommand('run nginx', known), 'run nginx');
  assert.equal(chatCommand('logs web', known), 'logs web');
  assert.equal(chatCommand('exec web sh -c "ls /"', known), `exec web sh -c 'ls /'`);
  assert.equal(chatCommand('stop web base', known), 'stop web base');
  assert.equal(chatCommand('pull ghcr.io/immich-app/immich-server:v2', known), 'pull ghcr.io/immich-app/immich-server:v2');
  for (const no of ['stop la musique', 'start le film', 'run vite chercher le pain', 'logs du serveur', 'ps je suis là', 'images de chats', 'arrête web', 'bonjour']) assert.equal(chatCommand(no, known), undefined, no);
  assert.match(graveOf('run -d nginx') ?? '', /lancer/); assert.match(graveOf('rm web') ?? '', /supprimer/); assert.match(graveOf('exec web ls') ?? '', /commande/);
  assert.equal(graveOf('ps'), undefined); assert.equal(graveOf('logs web'), undefined); assert.equal(graveOf('stop web'), undefined);
});

test('dans la discussion : « ps » et « logs web » partent vers Naglfar sans IA ; « stop la musique » non', async () => {
  const { offlineAct } = await import('../src/core/offline-act.ts');
  const { useEngine } = await import('../src/valhalla/modules/naglfar.ts');
  const { fakeEngine } = await import('./helpers.ts');
  useEngine(() => fakeEngine([{ Names: 'web', Image: 'nginx', State: 'running' }]));
  const calls: Array<[string, Record<string, unknown>]> = [];
  const run = async (name: string, input: Record<string, unknown>) => { calls.push([name, input]); return { ok: true, content: 'fait' }; };
  const has = (t: string) => t === 'valhalla';
  for (const [say, line] of [['ps', 'ps'], ['logs web', 'logs web'], ['run -d -p 8080:80 nginx', 'run -d -p 8080:80 nginx']] as const) {
    calls.length = 0; await offlineAct(say, run, has, 's', { strict: true });
    assert.deepEqual(calls[0], ['valhalla', { action: 'action', appli: 'naglfar', quoi: 'commande', entree: JSON.stringify({ ligne: line }) }], say);
  }
  calls.length = 0; await offlineAct('stop la musique', run, has, 's', { strict: true });
  assert.ok(!calls.some(([, i]) => i.quoi === 'commande'), 'pas une commande de conteneurs');
});
