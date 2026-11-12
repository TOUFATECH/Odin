// Hringhorni — la mise à l'échelle automatique. Un « service » = plusieurs copies identiques d'un conteneur
// derrière un répartiteur : le moteur ajoute des copies quand le processeur, la mémoire ou le nombre de
// connexions montent, et en retire une à une (après avoir laissé finir les visiteurs en cours) quand ça
// redescend. Il ne dépasse jamais le budget de la machine (80 % par défaut, ou ce que tu as réglé).
// Un conteneur seul (une base de données) grandit en place : plus de mémoire, plus de processeur, sans arrêt.
import { cpus, freemem, totalmem } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ScaleCfg {
  min: number; max: number;
  /** cibles moyennes par copie : processeur (% de sa part), mémoire (% de sa limite), connexions en cours */
  cpu: number; mem: number; conns: number;
  /** attente avant d'en ajouter encore (s) et durée de calme avant d'en retirer une (s) */
  upCooldown: number; downDelay: number;
}
export const DEFAULT_SCALE: ScaleCfg = { min: 2, max: 10, cpu: 70, mem: 80, conns: 100, upCooldown: 30, downDelay: 300 };
export interface Sample { cpu: number; mem: number; conns: number }
export interface Memory { lastUp?: number; lastDown?: number; lowSince?: number }
export interface Decision { want: number; reason: string; memory: Memory }

const avg = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);
/**
 * Combien de copies il faut (comme l'autoscaler de Kubernetes, en plus prudent) :
 * besoin = copies × charge / cible, sur le pire des trois (processeur, mémoire, connexions) ;
 * on monte vite (jusqu'au double d'un coup), on descend d'une copie à la fois après un long calme.
 */
export function decide(cur: number, s: Sample[], c: ScaleCfg, cap: number, mem: Memory, now: number): Decision {
  const hi = Math.max(c.min, Math.min(c.max, cap));
  if (cur < c.min) return { want: Math.min(c.min, Math.max(cur, hi)), reason: `minimum ${c.min} copies`, memory: mem };
  if (cur > hi) return { want: hi, reason: cap < c.max ? 'budget de la machine atteint' : `maximum ${c.max} copies`, memory: { ...mem, lastDown: now } };
  const rCpu = avg(s.map((x) => x.cpu)) / c.cpu, rMem = avg(s.map((x) => x.mem)) / c.mem, rConn = s.reduce((n, x) => n + x.conns, 0) / Math.max(1, cur) / c.conns;
  const r = Math.max(rCpu, rMem, rConn), why = r === rConn ? `${Math.round(s.reduce((n, x) => n + x.conns, 0))} visiteurs en cours` : r === rCpu ? `processeur à ${Math.round(avg(s.map((x) => x.cpu)))} %` : `mémoire à ${Math.round(avg(s.map((x) => x.mem)))} %`;
  if (r > 1.1) {
    if (mem.lastUp && now - mem.lastUp < c.upCooldown * 1000) return { want: cur, reason: `${why} : copie ajoutée il y a peu, on attend qu'elle prenne sa part`, memory: { ...mem, lowSince: undefined } };
    const want = Math.min(hi, Math.max(cur + 1, Math.ceil(cur * r)), cur * 2);
    return want > cur ? { want, reason: `${why} → ${want} copies`, memory: { ...mem, lastUp: now, lowSince: undefined } } : { want: cur, reason: `${why}, mais ${hi === cap && cap < c.max ? 'budget de la machine atteint' : `maximum ${c.max} copies`}`, memory: { ...mem, lowSince: undefined } };
  }
  // assez de copies pour une de moins ? (la charge restante doit rester sous 80 % des cibles)
  const fewer = cur - 1;
  if (fewer >= c.min && r * cur / Math.max(1, fewer) < 0.8) {
    const since = mem.lowSince ?? now;
    if (now - since >= c.downDelay * 1000 && (!mem.lastDown || now - mem.lastDown >= c.downDelay * 200)) return { want: fewer, reason: `calme depuis ${Math.round((now - since) / 60_000)} min (${why}) → ${fewer} copies`, memory: { ...mem, lowSince: undefined, lastDown: now } };
    return { want: cur, reason: `calme (${why}) : une copie de moins dans ${Math.max(0, Math.round((c.downDelay * 1000 - (now - since)) / 1000))} s si ça dure`, memory: { ...mem, lowSince: since } };
  }
  return { want: cur, reason: `stable (${why})`, memory: { ...mem, lowSince: undefined } };
}

// ------------------------------------------------------------------ ressources de la machine
export interface Budget { cpus: number; memory: number }
/** Le budget des conteneurs : un pourcentage de la machine (80 % par défaut), ou des valeurs données. */
export function budget(pct = 80, fixed?: Partial<Budget>): Budget {
  return { cpus: fixed?.cpus ?? Math.max(1, (cpus().length * pct) / 100), memory: fixed?.memory ?? Math.floor((totalmem() * pct) / 100) };
}
export function bytes(s?: string): number { if (!s) return 0; const m = /^(\d+(?:\.\d+)?)([kmg]?)$/i.exec(s.trim()); if (!m) return 0; return Math.round(Number(m[1]) * ({ '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 } as Record<string, number>)[m[2].toLowerCase()]); }
export const human = (n: number) => (n >= 1024 ** 3 ? `${+(n / 1024 ** 3).toFixed(1)}g` : `${Math.round(n / 1024 ** 2)}m`);
/** Combien de copies tiennent encore : budget moins ce que prennent les autres conteneurs, et la mémoire vraiment libre. */
export function capacity(per: { cpus: number; memory: number }, used: { cpus: number; memory: number }, b: Budget, free = freemem(), reserve = 0.1 * totalmem()): number {
  const byCpu = per.cpus > 0 ? Math.floor((b.cpus - used.cpus) / per.cpus) : Infinity;
  const byMem = per.memory > 0 ? Math.floor((b.memory - used.memory) / per.memory) : Infinity;
  const byFree = per.memory > 0 ? Math.floor(Math.max(0, free - reserve) / per.memory) : Infinity;
  return Math.max(0, Math.min(byCpu, byMem, byFree));
}

// ------------------------------------------------------------------ mesures cgroup v2
export interface CgStat { usageUsec: number; memCurrent: number; memMax: number; cpuQuota: number; throttled: number; at: number }
export function cgStat(dir: string, now = Date.now()): CgStat | undefined {
  try {
    const st = Object.fromEntries(readFileSync(join(dir, 'cpu.stat'), 'utf8').trim().split('\n').map((l) => { const [k, v] = l.split(' '); return [k, Number(v)]; }));
    const mx = readFileSync(join(dir, 'memory.max'), 'utf8').trim(), cm = readFileSync(join(dir, 'cpu.max'), 'utf8').trim().split(' ');
    return { usageUsec: st.usage_usec ?? 0, throttled: st.nr_throttled ?? 0, memCurrent: Number(readFileSync(join(dir, 'memory.current'), 'utf8')), memMax: mx === 'max' ? totalmem() : Number(mx), cpuQuota: cm[0] === 'max' ? cpus().length : Number(cm[0]) / Number(cm[1]), at: now };
  } catch { return undefined; }
}
/** Processeur (% de la part donnée) et mémoire (% de la limite) entre deux mesures. */
export function load(a: CgStat, b: CgStat): { cpu: number; mem: number } {
  const dt = Math.max(1, b.at - a.at) * 1000; // µs
  return { cpu: Math.max(0, Math.min(400, ((b.usageUsec - a.usageUsec) / dt / Math.max(0.01, b.cpuQuota)) * 100)), mem: Math.min(100, (b.memCurrent / Math.max(1, b.memMax)) * 100) };
}
/** Change les limites d'un conteneur EN MARCHE (sans l'arrêter). */
export function resizeLive(dir: string, o: { memory?: number; cpus?: number }): void {
  if (o.memory) writeFileSync(join(dir, 'memory.max'), String(Math.round(o.memory)));
  if (o.cpus) writeFileSync(join(dir, 'cpu.max'), `${Math.round(o.cpus * 100000)} 100000`);
}

/** Grandir en place (une base de données) : +25 % de mémoire si elle dépasse 85 %, +½ cœur si le processeur sature ; redescend doucement. */
export interface Vertical { minMem: number; maxMem: number; minCpus: number; maxCpus: number }
export function vertical(cur: { memory: number; cpus: number }, l: { cpu: number; mem: number; usedMem: number }, v: Vertical, calm: boolean): { memory: number; cpus: number; reason?: string } {
  let { memory, cpus: c } = cur; const why: string[] = [];
  if (l.mem > 85 && memory < v.maxMem) { memory = Math.min(v.maxMem, Math.round(memory * 1.25)); why.push(`mémoire à ${Math.round(l.mem)} % → ${human(memory)}`); }
  else if (calm && l.mem < 40 && memory > v.minMem) { const m = Math.max(v.minMem, Math.round(l.usedMem * 2), Math.round(memory * 0.8)); if (m < memory) { memory = m; why.push(`mémoire peu utilisée → ${human(memory)}`); } }
  if (l.cpu > 90 && c < v.maxCpus) { c = Math.min(v.maxCpus, c + 0.5); why.push(`processeur à ${Math.round(l.cpu)} % → ${c} cœurs`); }
  else if (calm && l.cpu < 25 && c > v.minCpus) { c = Math.max(v.minCpus, c - 0.5); why.push(`processeur calme → ${c} cœurs`); }
  return { memory, cpus: c, reason: why.join(' · ') || undefined };
}
