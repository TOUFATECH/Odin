// Hringhorni — le gardien d'UN conteneur (comme « conmon » chez Podman) : il lance le conteneur, tient son
// journal, relaie ses ports, le relance selon la règle choisie, et s'arrête avec lui. Il n'y a pas de démon :
// pas de conteneur en marche, pas de gardien.
//   usage : node gardien.ts <dossier du moteur> <id> <admin|sans-admin>
import { spawn, type ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { Engine } from './engine.ts';
import { defaultRunner, detach, release } from './net.ts';

const [dir, id, mode] = process.argv.slice(2);
const eng = new Engine(dir, { rootless: mode === 'sans-admin' });
const store = eng.store, spec = store.spec(id);
if (!spec) process.exit(2);
const cdir = store.ctr(id), logf = store.log(id);
let stopping = false, child: ChildProcess | null = null, pid1 = 0, restarts = 0;
const servers: Array<{ close(): void }> = [];

function log(stream: 'o' | 'e', text: string) {
  try {
    if (existsSync(logf) && statSync(logf).size > 10_000_000) renameSync(logf, `${logf}.1`); // on garde 10 Mo + l'ancien
    appendFileSync(logf, text.split('\n').filter((l) => l.length).map((l) => `${new Date().toISOString()} ${stream} ${l.slice(0, 16_000)}\n`).join(''), { mode: 0o600 });
  } catch { /* disque plein : on n'arrête pas le conteneur pour ça */ }
}
const say = (t: string) => log('e', `[odin] ${t}`);
/** Le processus 1 du conteneur : l'enfant de « unshare --fork ». */
function findPid1(p: number): number {
  // « ip netns exec » se remplace par unshare (pas de processus en plus) : l'enfant direct d'unshare est le bon
  try { const k = readFileSync(`/proc/${p}/task/${p}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number); return k[0] ?? 0; } catch { return 0; }
}

/** Relaie un port de la machine vers le conteneur (TCP et UDP). */
function relay(hostPort: number, ip: string, inner: number, proto: 'tcp' | 'udp') {
  if (proto === 'tcp') {
    const srv = net.createServer((s) => { const d = net.connect(inner, ip); s.pipe(d).pipe(s); const end = () => { s.destroy(); d.destroy(); }; s.on('error', end); d.on('error', end); });
    srv.on('error', (e) => say(`port ${hostPort} indisponible : ${(e as Error).message}`));
    srv.listen(hostPort, '0.0.0.0'); servers.push(srv);
  } else {
    const sock = dgram.createSocket('udp4'), peers = new Map<string, dgram.Socket>();
    sock.on('message', (m, r) => {
      const k = `${r.address}:${r.port}`; let up = peers.get(k);
      if (!up) { up = dgram.createSocket('udp4'); up.on('message', (b) => sock.send(b, r.port, r.address)); up.on('error', () => {}); peers.set(k, up); setTimeout(() => { up!.close(); peers.delete(k); }, 120_000).unref(); }
      up.send(m, inner, ip);
    });
    sock.on('error', (e) => say(`port ${hostPort}/udp indisponible : ${(e as Error).message}`));
    sock.bind(hostPort, '0.0.0.0'); servers.push({ close: () => { sock.close(); for (const p of peers.values()) p.close(); } });
  }
}

async function launch(ip?: string): Promise<number> {
  const cg = eng.cgroup(spec!), plan = await eng.plan(spec!, { ip, cgroup: cg });
  const argv = eng.outer(spec!, eng.script(plan), plan.tools);
  child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin' } });
  child.stdout!.on('data', (b: Buffer) => log('o', b.toString('utf8')));
  child.stderr!.on('data', (b: Buffer) => log('e', b.toString('utf8')));
  for (let i = 0; i < 50 && !pid1 && child.exitCode === null; i++) { await new Promise((r) => setTimeout(r, 40)); pid1 = findPid1(child.pid!); }
  store.patchState(id, { status: 'en marche', gardien: process.pid, pid: pid1 || child.pid, ip, startedAt: new Date().toISOString(), restarts, rootless: eng.rootless, error: undefined, exitCode: undefined });
  return new Promise((res) => child!.on('exit', (code, sig) => res(code ?? (sig ? 128 + (sig === 'SIGKILL' ? 9 : 15) : 1))));
}

async function main() {
  store.patchState(id, { gardien: process.pid });
  let ip: string | undefined;
  try { ip = await eng.startNetwork(spec!); } catch (e) { store.patchState(id, { status: 'sorti', error: (e as Error).message, finishedAt: new Date().toISOString() }); say((e as Error).message); process.exit(1); }
  for (const p of spec!.ports) { if (spec!.network === 'pont') relay(p.host, ip!, p.inner, p.proto); else if (p.host !== p.inner) relay(p.host, '127.0.0.1', p.inner, p.proto); }
  let code = 0;
  for (;;) {
    try { code = await launch(ip); } catch (e) { say((e as Error).message); store.patchState(id, { error: (e as Error).message }); code = 1; }
    pid1 = 0;
    if (stopping || existsSync(join(cdir, 'arret'))) break;
    const again = spec!.restart === 'toujours' || spec!.restart === 'sauf-arret' || (spec!.restart === 'si-erreur' && code !== 0);
    if (!again) break;
    restarts++; const wait = Math.min(60_000, 1000 * 2 ** Math.min(6, restarts - 1));
    store.patchState(id, { status: 'redémarre', exitCode: code, restarts });
    say(`arrêté (code ${code}) : relance dans ${Math.round(wait / 1000)} s`);
    await new Promise((r) => setTimeout(r, wait));
    if (stopping || existsSync(join(cdir, 'arret'))) break;
  }
  for (const s of servers) { try { s.close(); } catch { /* déjà fermé */ } }
  if (spec!.network === 'pont') { await detach(defaultRunner, id).catch(() => {}); release(ip, id); }
  try { rmSync(join('/sys/fs/cgroup/odin', id.slice(0, 12)), { recursive: false, force: true }); } catch { /* encore occupé */ }
  const manual = existsSync(join(cdir, 'arret'));
  store.patchState(id, { status: manual ? 'arrêté' : 'sorti', exitCode: code, finishedAt: new Date().toISOString(), gardien: undefined, pid: undefined, ip: undefined });
  if (spec!.autoRemove) rmSync(cdir, { recursive: true, force: true });
  process.exit(0);
}

process.on('SIGTERM', () => {
  if (stopping) return; stopping = true;
  let t = 10; try { t = Number(readFileSync(join(cdir, 'arret'), 'utf8').trim() || 10) || 10; } catch { /* arrêt de la machine */ }
  const target = pid1 || child?.pid;
  if (target) { try { process.kill(target, 'SIGTERM'); } catch { /* déjà parti */ } }
  setTimeout(() => { for (const p of [pid1, child?.pid]) if (p) { try { process.kill(p, 'SIGKILL'); } catch { /* parti */ } } }, t * 1000).unref();
});
process.on('SIGINT', () => process.emit('SIGTERM' as never));
main();
