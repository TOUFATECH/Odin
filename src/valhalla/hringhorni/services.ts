// Hringhorni — les services mis à l'échelle : leur fiche, leur état, et le lancement de leur répartiteur
// (un petit processus par service, comme le gardien d'un conteneur : pas de démon).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMounts, parsePorts } from '../parc.ts';
import type { Engine } from './engine.ts';
import { DEFAULT_SCALE, bytes, type ScaleCfg } from './scale.ts';
import type { Mount, Port } from './store.ts';

export interface Service {
  name: string; image: string; cmd?: string[]; env: Record<string, string>; mounts: Mount[];
  /** ports publiés sur la machine → port dans chaque copie (TCP) */
  ports: Port[];
  /** ressources de CHAQUE copie */
  per: { cpus: string; memory: string };
  scale: ScaleCfg;
  /** part de la machine que les conteneurs peuvent prendre en tout (%) ; ou des valeurs fixes */
  budgetPct: number; budget?: { cpus?: number; memory?: string };
  /** vérification de santé HTTP (sinon : le port répond) */
  health?: string;
  created: string;
}
export interface Replica { name: string; ip?: string; healthy: boolean; draining: boolean; conns: number; cpu: number; mem: number }
export interface ServiceState {
  status: 'démarre' | 'en marche' | 'arrêté'; pid?: number; replicas: Replica[]; want: number; reason: string;
  /** connexions nouvelles par seconde et en cours (tous visiteurs) */
  rate: number; active: number; total: number; refused: number;
  events: Array<{ at: string; text: string }>; history: Array<{ at: string; copies: number; active: number; cpu: number }>; error?: string; updated: string;
}

const dirOf = (e: Engine, name: string) => join(e.store.dir, 'services', name);
const read = <T>(f: string, d: T): T => { try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return d; } };
export function writeJson(f: string, v: unknown) { const t = `${f}.${process.pid}.tmp`; writeFileSync(t, JSON.stringify(v), { mode: 0o600 }); renameSync(t, f); }
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

export function services(e: Engine): Array<{ spec: Service; state: ServiceState }> {
  let names: string[] = []; try { names = readdirSync(join(e.store.dir, 'services')); } catch { /* aucun */ }
  return names.map((n) => serviceOf(e, n)).filter((x): x is { spec: Service; state: ServiceState } => !!x);
}
export function serviceOf(e: Engine, name: string): { spec: Service; state: ServiceState } | undefined {
  const d = dirOf(e, name), spec = read<Service | null>(join(d, 'service.json'), null); if (!spec) return undefined;
  let state = read<ServiceState>(join(d, 'etat.json'), { status: 'arrêté', replicas: [], want: 0, reason: '', rate: 0, active: 0, total: 0, refused: 0, events: [], history: [], updated: '' });
  if (state.status !== 'arrêté' && !alive(state.pid)) state = { ...state, status: 'arrêté', error: state.error ?? 'répartiteur arrêté sans prévenir (machine redémarrée ?)' };
  return { spec, state };
}
export const saveService = (e: Engine, s: Service) => { const d = dirOf(e, s.name); mkdirSync(d, { recursive: true, mode: 0o700 }); writeJson(join(d, 'service.json'), s); };
export const stateFile = (e: Engine, name: string) => join(dirOf(e, name), 'etat.json');

export interface ServiceOpts { name: string; image: string; cmd?: string[]; env?: Record<string, string>; mounts?: string | Mount[]; ports: string | Port[]; cpus?: string; memory?: string; min?: number; max?: number; cpu?: number; conns?: number; budgetPct?: number; health?: string; upCooldown?: number; downDelay?: number }
/** Prépare un service (rien ne démarre). */
export function defineService(e: Engine, o: ServiceOpts): Service {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(o.name)) throw new Error(`nom de service invalide : ${o.name} (minuscules, chiffres, tirets)`);
  if (e.rootless) throw new Error('la mise à l\'échelle demande Odin en administrateur (réseau privé des conteneurs)');
  if (serviceOf(e, o.name)) throw new Error(`le service ${o.name} existe déjà`);
  if (e.ps(true).some((c) => c.spec.name === o.name || c.spec.name.startsWith(`${o.name}-`))) throw new Error(`des conteneurs portent déjà le nom ${o.name}`);
  const ports = typeof o.ports === 'string' ? parsePorts(o.ports) : o.ports; if (!ports.length) throw new Error('un service a besoin d\'au moins un port publié (ex. 8080:80)');
  if (ports.some((p) => p.proto !== 'tcp')) throw new Error('la répartition se fait en TCP (sites, API) : pas d\'UDP');
  const busy = new Set([...e.ps().flatMap((c) => c.spec.ports.map((p) => p.host)), ...services(e).filter((s) => s.state.status !== 'arrêté').flatMap((s) => s.spec.ports.map((p) => p.host))]);
  for (const p of ports) if (busy.has(p.host)) throw new Error(`le port ${p.host} est déjà pris`);
  const mounts = typeof o.mounts === 'string' ? parseMounts(o.mounts) : (o.mounts ?? []);
  const memory = o.memory ?? '512m', cpus = o.cpus ?? '1'; if (!bytes(memory)) throw new Error('mémoire : par exemple 512m'); if (!(Number(cpus) > 0)) throw new Error('cœurs : un nombre');
  const min = Math.max(1, Math.floor(o.min ?? DEFAULT_SCALE.min)), max = Math.max(min, Math.floor(o.max ?? DEFAULT_SCALE.max));
  const s: Service = { name: o.name, image: o.image, cmd: o.cmd, env: o.env ?? {}, mounts, ports, per: { cpus, memory }, scale: { ...DEFAULT_SCALE, min, max, cpu: o.cpu ?? DEFAULT_SCALE.cpu, conns: o.conns ?? DEFAULT_SCALE.conns, upCooldown: o.upCooldown ?? DEFAULT_SCALE.upCooldown, downDelay: o.downDelay ?? DEFAULT_SCALE.downDelay }, budgetPct: Math.min(95, Math.max(10, o.budgetPct ?? 80)), health: o.health, created: new Date().toISOString() };
  saveService(e, s); return s;
}
/** Lance le répartiteur du service (détaché) et attend la première copie prête. */
export async function startService(e: Engine, name: string, waitMs = 60_000): Promise<ServiceState> {
  const cur = serviceOf(e, name); if (!cur) throw new Error(`service inconnu : ${name}`);
  if (cur.state.status !== 'arrêté') return cur.state;
  rmSync(join(dirOf(e, name), 'arret'), { force: true });
  writeJson(stateFile(e, name), { ...cur.state, status: 'démarre', error: undefined, updated: new Date().toISOString() });
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', new URL('./repartiteur.ts', import.meta.url).pathname, e.store.dir, name], { detached: true, stdio: 'ignore', env: { PATH: process.env.PATH ?? '/usr/sbin:/usr/bin:/sbin:/bin', ODIN_SCALE_TICK_MS: process.env.ODIN_SCALE_TICK_MS ?? '' } });
  p.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await new Promise((r) => setTimeout(r, 200));
    const st = serviceOf(e, name)!.state;
    if (st.error && st.status === 'arrêté') throw new Error(`${name} : ${st.error}`);
    if (st.status === 'en marche' && st.replicas.some((r) => r.healthy)) return st;
  }
  return serviceOf(e, name)!.state;
}
/** Arrêt : le répartiteur laisse finir les visiteurs, arrête et retire les copies. */
export async function stopService(e: Engine, name: string, waitMs = 60_000): Promise<void> {
  const cur = serviceOf(e, name); if (!cur) throw new Error(`service inconnu : ${name}`);
  writeFileSync(join(dirOf(e, name), 'arret'), '1');
  if (alive(cur.state.pid)) process.kill(cur.state.pid!, 'SIGTERM');
  const t0 = Date.now(); while (alive(serviceOf(e, name)?.state.pid) && Date.now() - t0 < waitMs) await new Promise((r) => setTimeout(r, 200));
}
export async function removeService(e: Engine, name: string): Promise<void> { await stopService(e, name); rmSync(dirOf(e, name), { recursive: true, force: true }); }
/** Change les réglages d'échelle (le répartiteur les relit tout seul). */
export function tuneService(e: Engine, name: string, p: Partial<ScaleCfg> & { budgetPct?: number; cpus?: string; memory?: string }): Service {
  const cur = serviceOf(e, name); if (!cur) throw new Error(`service inconnu : ${name}`);
  const sc = { ...cur.spec.scale, ...Object.fromEntries(Object.entries(p).filter(([k, v]) => k in DEFAULT_SCALE && v !== undefined && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)])) } as ScaleCfg;
  sc.min = Math.max(1, Math.floor(sc.min)); sc.max = Math.max(sc.min, Math.floor(sc.max));
  const s: Service = { ...cur.spec, scale: sc, budgetPct: p.budgetPct ? Math.min(95, Math.max(10, p.budgetPct)) : cur.spec.budgetPct, per: { cpus: p.cpus ?? cur.spec.per.cpus, memory: p.memory ?? cur.spec.per.memory } };
  saveService(e, s); return s;
}
export const stopFlag = (e: Engine, name: string) => existsSync(join(dirOf(e, name), 'arret'));
