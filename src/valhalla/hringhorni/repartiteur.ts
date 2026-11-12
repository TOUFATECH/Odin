// Hringhorni — le répartiteur d'UN service : il reçoit les visiteurs sur les ports publiés et les envoie à la
// copie la moins chargée (une copie qui ne répond pas est sautée : le visiteur ne voit rien), vérifie la santé
// de chaque copie, mesure processeur / mémoire / connexions, et ajoute ou retire des copies tout seul.
// Retirer une copie = plus de nouveaux visiteurs vers elle, on attend que les visites en cours finissent.
//   usage : node repartiteur.ts <dossier du moteur> <service>
import net from 'node:net';
import http from 'node:http';
import { join } from 'node:path';
import { Engine } from './engine.ts';
import { budget, bytes, capacity, cgStat, decide, load, type CgStat, type Memory, type Sample } from './scale.ts';
import { serviceOf, stateFile, stopFlag, writeJson, type Replica, type Service, type ServiceState } from './services.ts';

const [dir, name] = process.argv.slice(2);
const eng = new Engine(dir, { rootless: false });
let spec: Service = serviceOf(eng, name)!.spec;
const TICK = Number(process.env.ODIN_SCALE_TICK_MS) || 5000;
interface B { name: string; id: string; ip?: string; healthy: boolean; draining: boolean; active: number; fails: number; prev?: CgStat; cpu: number; mem: number; born: number }
const backs = new Map<string, B>();
const servers: net.Server[] = [];
let stopping = false, mem: Memory = {}, want = spec.scale.min, reason = 'démarrage', newConns = 0, total = 0, refused = 0, rate = 0;
const events: ServiceState['events'] = [], history: ServiceState['history'] = [];
const note = (t: string) => { events.unshift({ at: new Date().toISOString(), text: t }); events.length = Math.min(events.length, 50); };

function save(status: ServiceState['status'], error?: string) {
  const st: ServiceState = { status, pid: status === 'arrêté' ? undefined : process.pid, replicas: [...backs.values()].map((b): Replica => ({ name: b.name, ip: b.ip, healthy: b.healthy, draining: b.draining, conns: b.active, cpu: Math.round(b.cpu), mem: Math.round(b.mem) })), want, reason, rate: Math.round(rate * 10) / 10, active: [...backs.values()].reduce((n, b) => n + b.active, 0), total, refused, events, history, error, updated: new Date().toISOString() };
  writeJson(stateFile(eng, name), st);
}

// ------------------------------------------------------------------ répartition
function pick(skip: Set<string>): B | undefined {
  let best: B | undefined;
  for (const b of backs.values()) if (b.healthy && !b.draining && b.ip && !skip.has(b.name) && (!best || b.active < best.active)) best = b;
  return best;
}
function serve(p: { host: number; inner: number }) {
  const srv = net.createServer((client) => {
    client.pause(); newConns++; total++;
    const tried = new Set<string>();
    const go = () => {
      const b = pick(tried);
      if (!b) { refused++; client.destroy(); return; }
      tried.add(b.name); b.active++;
      let done = false; const fin = () => { if (!done) { done = true; b.active--; } };
      const up = net.connect({ host: b.ip!, port: p.inner }); let connected = false;
      const t = setTimeout(() => up.destroy(new Error('trop lent')), 3000);
      up.once('connect', () => { clearTimeout(t); connected = true; b.fails = 0; client.pipe(up).pipe(client); client.resume(); });
      up.once('error', () => {
        clearTimeout(t); fin();
        if (connected) { client.destroy(); return; }
        // la copie n'a pas répondu : le visiteur part vers une autre, sans rien voir
        b.fails++; if (b.fails >= 2) b.healthy = false;
        if (tried.size < 3 && !client.destroyed) go(); else { refused++; client.destroy(); }
      });
      up.on('close', () => { fin(); if (connected) client.destroy(); });
      client.once('error', () => up.destroy()); client.once('close', () => { fin(); up.destroy(); });
    };
    go();
  });
  srv.on('error', (e) => { note(`port ${p.host} indisponible : ${(e as Error).message}`); });
  srv.listen(p.host, '0.0.0.0'); servers.push(srv);
}

// ------------------------------------------------------------------ santé et mesures
function check(b: B): Promise<boolean> {
  const port = spec.ports[0].inner;
  if (!b.ip) return Promise.resolve(false);
  if (spec.health) return new Promise((ok) => { const r = http.get({ host: b.ip, port, path: spec.health, timeout: 2000 }, (res) => { res.resume(); ok((res.statusCode ?? 500) < 500); }); r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); }); });
  return new Promise((ok) => { const s = net.connect({ host: b.ip!, port }); const t = setTimeout(() => { s.destroy(); ok(false); }, 2000); s.once('connect', () => { clearTimeout(t); s.end(); ok(true); }); s.once('error', () => { clearTimeout(t); ok(false); }); });
}
async function health() {
  await Promise.all([...backs.values()].map(async (b) => {
    const ok = await check(b);
    if (ok && !b.healthy) { b.healthy = true; b.fails = 0; if (Date.now() - b.born < 120_000) note(`${b.name} prête`); }
    else if (!ok && b.healthy) { b.fails++; if (b.fails >= 2) { b.healthy = false; note(`${b.name} ne répond plus : plus de visiteurs vers elle`); } }
  }));
}
function measure() {
  for (const b of backs.values()) {
    const cur = cgStat(join('/sys/fs/cgroup/odin', b.id.slice(0, 12)));
    if (cur && b.prev) { const l = load(b.prev, cur); b.cpu = l.cpu; b.mem = l.mem; }
    if (cur) b.prev = cur;
  }
}

// ------------------------------------------------------------------ copies
function sync() {
  const mine = eng.ps(true).filter((c) => c.spec.labels['odin.service'] === name);
  for (const c of mine) {
    const b = backs.get(c.spec.name);
    if (c.state.status === 'en marche') { if (b) b.ip = c.state.ip; else backs.set(c.spec.name, { name: c.spec.name, id: c.id, ip: c.state.ip, healthy: false, draining: false, active: 0, fails: 0, cpu: 0, mem: 0, born: Date.now() }); }
    else if (b && !b.draining) { backs.delete(c.spec.name); note(`${c.spec.name} s'est arrêtée : remplacée`); void eng.rm(c.id, true).catch(() => {}); }
  }
  for (const k of [...backs.keys()]) if (!mine.some((c) => c.spec.name === k)) backs.delete(k);
}
async function add() {
  const taken = new Set(eng.ps(true).map((c) => c.spec.name)); let n = 1; while (taken.has(`${name}-${n}`)) n++;
  const c = await eng.run({ image: spec.image, name: `${name}-${n}`, cmd: spec.cmd, env: spec.env, mounts: spec.mounts, memory: spec.per.memory, cpus: spec.per.cpus, restart: 'non', network: 'pont', labels: { 'odin.service': name } });
  backs.set(c.spec.name, { name: c.spec.name, id: c.id, ip: c.state.ip, healthy: false, draining: false, active: 0, fails: 0, cpu: 0, mem: 0, born: Date.now() });
}
async function retire(b: B, grace = 30_000) {
  b.draining = true; const t0 = Date.now();
  while (b.active > 0 && Date.now() - t0 < grace) await new Promise((r) => setTimeout(r, 200));
  await eng.stop(b.id, 10).catch(() => {}); await eng.rm(b.id, true).catch(() => {}); backs.delete(b.name);
}
/** Ressources prises par les autres conteneurs (hors ce service). */
function others() { let cpus = 0, memory = 0; for (const c of eng.ps()) if (c.spec.labels['odin.service'] !== name) { cpus += Number(c.spec.cpus ?? 0); memory += bytes(c.spec.memory); } return { cpus, memory }; }

let busy = false;
async function tick() {
  if (busy || stopping) return; busy = true;
  try {
    spec = serviceOf(eng, name)?.spec ?? spec; // réglages changés à chaud
    sync(); measure(); await health();
    const live = [...backs.values()].filter((b) => !b.draining), cur = live.length;
    const samples: Sample[] = live.filter((b) => b.healthy).map((b) => ({ cpu: b.cpu, mem: b.mem, conns: b.active }));
    const per = { cpus: Number(spec.per.cpus), memory: bytes(spec.per.memory) };
    const b0 = budget(spec.budgetPct, spec.budget ? { cpus: spec.budget.cpus, memory: spec.budget.memory ? bytes(spec.budget.memory) : undefined } : undefined);
    const cap = cur + capacity(per, (() => { const o = others(); return { cpus: o.cpus + cur * per.cpus, memory: o.memory + cur * per.memory }; })(), b0);
    // une copie qui démarre encore ne compte pas comme « calme » : on attend qu'elle soit prête
    const starting = live.some((b) => !b.healthy && Date.now() - b.born < 60_000);
    const d = starting && cur >= spec.scale.min ? { want: cur, reason: 'une copie démarre', memory: mem } : decide(cur, samples, spec.scale, cap, mem, Date.now());
    mem = d.memory; want = d.want; reason = d.reason;
    if (d.want > cur) { note(`➕ ${d.reason}`); for (let i = cur; i < d.want; i++) await add().catch((e) => note(`copie impossible : ${(e as Error).message}`)); }
    else if (d.want < cur) { const b = live.filter((x) => x.healthy).sort((a, z) => a.active - z.active)[0] ?? live[0]; note(`➖ ${d.reason}`); void retire(b); }
    history.push({ at: new Date().toISOString(), copies: live.filter((b) => b.healthy).length, active: [...backs.values()].reduce((n, b) => n + b.active, 0), cpu: Math.round(samples.reduce((n, s) => n + s.cpu, 0) / Math.max(1, samples.length)) });
    if (history.length > 720) history.splice(0, history.length - 720);
  } catch (e) { note(`erreur : ${(e as Error).message}`); }
  finally { busy = false; }
}

async function shutdown() {
  if (stopping) return; stopping = true; note('arrêt du service');
  for (const s of servers) s.close();
  await Promise.all([...backs.values()].map((b) => retire(b, 15_000)));
  save('arrêté'); process.exit(0);
}
process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());

async function main() {
  save('démarre');
  try { await eng.getTools(); sync(); for (const p of spec.ports) serve(p); }
  catch (e) { save('arrêté', (e as Error).message); process.exit(1); }
  await tick();
  save('en marche');
  setInterval(() => { rate = newConns / (TICK / 1000) * 0.5 + rate * 0.5; newConns = 0; if (stopFlag(eng, name)) void shutdown(); else void tick().then(() => { if (!stopping) save('en marche'); }); }, TICK);
  setInterval(() => { if (!stopping) void health().then(() => save('en marche')); }, Math.min(2000, TICK));
}
main();
