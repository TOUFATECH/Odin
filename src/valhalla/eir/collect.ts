// Eir — ce que Glances mesure, lu directement dans le système (Linux : /proc et /sys), sans rien installer :
// processeur par cœur (attente disque, vol de temps des VM), mémoire et échange, charge, réseau par carte
// (filaire, Wi-Fi avec signal, VPN, conteneurs), disques (place et débit lecture / écriture), capteurs
// (températures, ventilateurs, seuils critiques), batterie, RAID logiciel, SMART (avec smartctl), carte
// graphique (nvidia-smi), personnes connectées, connexions réseau, processus.
import { existsSync, readdirSync, readFileSync, statfsSync } from 'node:fs';
import { cpus, hostname, loadavg, release, totalmem, uptime } from 'node:os';

const read = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const num = (f: string) => { const v = Number(read(f).trim()); return Number.isFinite(v) ? v : undefined; };

// ---------------- Seuils et niveaux (comme Glances : prudent / attention / critique) ----------------
export type Lvl = 'ok' | 'suivre' | 'attention' | 'grave';
export interface Limits { suivre: number; attention: number; grave: number }
export const DEFAULT_LIMITS: Record<string, Limits> = {
  cpu: { suivre: 50, attention: 70, grave: 90 }, mem: { suivre: 50, attention: 70, grave: 90 }, swap: { suivre: 50, attention: 70, grave: 90 },
  fs: { suivre: 50, attention: 70, grave: 90 }, load: { suivre: 0.7, attention: 1, grave: 5 }, temp: { suivre: 60, attention: 75, grave: 85 },
  iowait: { suivre: 5, attention: 10, grave: 25 }, gpu: { suivre: 50, attention: 70, grave: 90 },
};
/** Le niveau d'une valeur. Pur. */
export function level(v: number, l: Limits): Lvl { return v >= l.grave ? 'grave' : v >= l.attention ? 'attention' : v >= l.suivre ? 'suivre' : 'ok'; }

// ---------------- Processeur ----------------
export interface CpuTimes { user: number; nice: number; system: number; idle: number; iowait: number; irq: number; softirq: number; steal: number }
/** /proc/stat → temps par processeur (« cpu » = tous). Pur. */
export function parseStat(text: string): Map<string, CpuTimes> {
  const m = new Map<string, CpuTimes>();
  for (const l of text.split('\n')) { const p = l.trim().split(/\s+/); if (!/^cpu\d*$/.test(p[0] ?? '')) continue; const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = p.slice(1).map(Number); m.set(p[0], { user, nice, system, idle, iowait, irq, softirq, steal }); }
  return m;
}
/** Pourcentages entre deux lectures. Pur. */
export function cpuPct(a: CpuTimes, b: CpuTimes): { total: number; user: number; system: number; iowait: number; steal: number } {
  const tot = (x: CpuTimes) => x.user + x.nice + x.system + x.idle + x.iowait + x.irq + x.softirq + x.steal;
  const d = Math.max(1, tot(b) - tot(a)), p = (k: keyof CpuTimes) => Math.max(0, Math.round(((b[k] - a[k]) / d) * 1000) / 10);
  return { total: Math.max(0, Math.min(100, Math.round((1 - (b.idle + b.iowait - a.idle - a.iowait) / d) * 1000) / 10)), user: p('user'), system: p('system'), iowait: p('iowait'), steal: p('steal') };
}

// ---------------- Mémoire ----------------
export function parseMem(text: string): { total: number; available: number; used: number; buffers: number; cached: number; swapTotal: number; swapUsed: number } {
  const g = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0) * 1024;
  const total = g('MemTotal') || totalmem(), available = g('MemAvailable');
  return { total, available, used: total - available, buffers: g('Buffers'), cached: g('Cached'), swapTotal: g('SwapTotal'), swapUsed: g('SwapTotal') - g('SwapFree') };
}

// ---------------- Réseau ----------------
export type IfKind = 'filaire' | 'wifi' | 'vpn' | 'conteneurs' | 'autre';
export function ifKind(name: string): IfKind { return /^(wl|wlan|wifi)/.test(name) ? 'wifi' : /^(wg|tun|tap|tailscale|zt)/.test(name) ? 'vpn' : /^(docker|veth|br-|virbr|cni|flannel|lxc)/.test(name) ? 'conteneurs' : /^(eth|en|eno|ens|enp|em|bond)/.test(name) ? 'filaire' : 'autre'; }
export function parseNetDev(text: string): Map<string, { rx: number; tx: number; rxErr: number; txErr: number; drop: number }> {
  const m = new Map<string, { rx: number; tx: number; rxErr: number; txErr: number; drop: number }>();
  for (const l of text.split('\n').slice(2)) { const [name, rest] = l.split(':'); if (!rest) continue; const n = name.trim(); if (n === 'lo') continue; const v = rest.trim().split(/\s+/).map(Number); m.set(n, { rx: v[0], tx: v[8], rxErr: v[2], txErr: v[10], drop: v[3] + v[11] }); }
  return m;
}
/** /proc/net/wireless → qualité du signal en dBm. Pur. */
export function parseWireless(text: string): Map<string, { quality: number; dbm: number }> {
  const m = new Map<string, { quality: number; dbm: number }>();
  for (const l of text.split('\n').slice(2)) { const x = /^\s*(\S+):\s+\S+\s+([\d.]+)\.?\s+(-?[\d.]+)\.?/.exec(l); if (x) m.set(x[1], { quality: Number(x[2]), dbm: Number(x[3]) }); }
  return m;
}
export const signalWord = (dbm: number) => (dbm >= -50 ? 'excellent' : dbm >= -60 ? 'bon' : dbm >= -70 ? 'moyen' : 'faible');

// ---------------- Disques ----------------
export function parseDiskstats(text: string): Map<string, { read: number; write: number; busyMs: number }> {
  const m = new Map<string, { read: number; write: number; busyMs: number }>();
  for (const l of text.split('\n')) { const p = l.trim().split(/\s+/); const name = p[2]; if (!name || !/^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+|md\d+|dm-\d+)$/.test(name)) continue; m.set(name, { read: Number(p[5]) * 512, write: Number(p[9]) * 512, busyMs: Number(p[12]) }); }
  return m;
}
export function filesystems(mounts = read('/proc/mounts')): Array<{ mount: string; dev: string; fs: string; size: number; used: number; free: number; pct: number }> {
  const out: Array<{ mount: string; dev: string; fs: string; size: number; used: number; free: number; pct: number }> = [], seen = new Set<string>();
  for (const l of mounts.split('\n')) {
    const [dev, mount, fs, opts = ''] = l.split(' ');
    if (!dev?.startsWith('/dev/') || seen.has(dev) || /^\/(snap|boot\/efi)/.test(mount) || fs === 'squashfs' || /(^|,)ro(,|$)/.test(opts)) continue;
    seen.add(dev);
    try { const s = statfsSync(mount); const size = s.blocks * s.bsize, free = s.bavail * s.bsize; if (size > 0) out.push({ mount, dev, fs, size, used: size - free, free, pct: Math.round(((size - free) / size) * 1000) / 10 }); } catch { /* */ }
  }
  return out;
}
/** /proc/mdstat → grappes RAID logicielles et leur état. Pur. */
export function parseMdstat(text: string): Array<{ name: string; level: string; disks: number; ok: number; state: 'complet' | 'dégradé' | 'reconstruction'; progress?: number }> {
  const out: Array<{ name: string; level: string; disks: number; ok: number; state: 'complet' | 'dégradé' | 'reconstruction'; progress?: number }> = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = /^(md\d+)\s*:\s*active\s+(?:\([^)]*\)\s*)?(raid\d+|linear)/.exec(lines[i]); if (!h) continue;
    const st = /\[(\d+)\/(\d+)\]\s*\[([U_]+)\]/.exec(lines[i + 1] ?? ''); const pr = /(recovery|resync|reshape)\s*=\s*([\d.]+)%/.exec(lines[i + 2] ?? '');
    const disks = st ? Number(st[1]) : 0, ok = st ? Number(st[2]) : 0;
    out.push({ name: h[1], level: h[2], disks, ok, state: pr ? 'reconstruction' : ok < disks ? 'dégradé' : 'complet', ...(pr ? { progress: Number(pr[2]) } : {}) });
  }
  return out;
}

// ---------------- Capteurs (hwmon), batterie ----------------
export function sensors(root = '/sys/class/hwmon'): Array<{ chip: string; label: string; kind: 'temp' | 'fan'; value: number; crit?: number }> {
  const out: Array<{ chip: string; label: string; kind: 'temp' | 'fan'; value: number; crit?: number }> = [];
  if (!existsSync(root)) return out;
  for (const h of readdirSync(root)) {
    const d = `${root}/${h}`, chip = read(`${d}/name`).trim() || h; let files: string[] = []; try { files = readdirSync(d); } catch { continue; }
    for (const f of files) {
      const t = /^temp(\d+)_input$/.exec(f), fa = /^fan(\d+)_input$/.exec(f);
      if (t) { const v = num(`${d}/${f}`); if (v === undefined || v <= 0 || v > 200_000) continue; const crit = num(`${d}/temp${t[1]}_crit`); out.push({ chip, label: read(`${d}/temp${t[1]}_label`).trim() || `${chip} ${t[1]}`, kind: 'temp', value: Math.round(v / 100) / 10, ...(crit && crit < 200_000 ? { crit: Math.round(crit / 1000) } : {}) }); }
      if (fa) { const v = num(`${d}/${f}`); if (v !== undefined && v > 0) out.push({ chip, label: read(`${d}/fan${fa[1]}_label`).trim() || `Ventilateur ${fa[1]}`, kind: 'fan', value: v }); }
    }
  }
  // Sans hwmon : les zones thermiques.
  if (!out.some((x) => x.kind === 'temp') && existsSync('/sys/class/thermal')) for (const z of readdirSync('/sys/class/thermal')) { if (!z.startsWith('thermal_zone')) continue; const v = num(`/sys/class/thermal/${z}/temp`); if (v && v > 0 && v < 150_000) out.push({ chip: 'thermal', label: read(`/sys/class/thermal/${z}/type`).trim() || z, kind: 'temp', value: Math.round(v / 100) / 10 }); }
  return out;
}
export function batteries(root = '/sys/class/power_supply'): Array<{ name: string; pct: number; status: string }> {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((b) => read(`${root}/${b}/type`).trim() === 'Battery').map((b) => ({ name: b, pct: num(`${root}/${b}/capacity`) ?? 0, status: ({ Charging: 'en charge', Discharging: 'sur batterie', Full: 'pleine', 'Not charging': 'branchée' } as Record<string, string>)[read(`${root}/${b}/status`).trim()] ?? read(`${root}/${b}/status`).trim() }));
}

// ---------------- Connexions, personnes, processus ----------------
export function tcpStates(text: string): { etablies: number; ecoute: number; attente: number } {
  let e = 0, l = 0, w = 0; for (const x of text.split('\n').slice(1)) { const st = x.trim().split(/\s+/)[3]; if (st === '01') e++; else if (st === '0A') l++; else if (st === '06' || st === '08') w++; }
  return { etablies: e, ecoute: l, attente: w };
}
export function parseWho(out: string): Array<{ user: string; tty: string; from?: string; since: string }> {
  return out.trim().split('\n').filter(Boolean).map((l) => { const m = /^(\S+)\s+(\S+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}|\w+\s+\d+\s+\d{2}:\d{2})(?:\s+\((.*)\))?/.exec(l); return m ? { user: m[1], tty: m[2], since: m[3], ...(m[4] ? { from: m[4] } : {}) } : undefined; }).filter((x): x is { user: string; tty: string; from?: string; since: string } => Boolean(x));
}
/** Résumé des processus (comme l'en-tête de Glances). */
export function procSummary(): { total: number; running: number; sleeping: number; threads: number } {
  let total = 0, running = 0, sleeping = 0, threads = 0;
  try { for (const p of readdirSync('/proc')) { if (!/^\d+$/.test(p)) continue; const st = read(`/proc/${p}/stat`); const m = /\) (\w) (?:\S+ ){16}(\d+)/.exec(st); if (!m) continue; total++; if (m[1] === 'R') running++; else if (m[1] === 'S' || m[1] === 'D' || m[1] === 'I') sleeping++; threads += Number(m[2]); } } catch { /* */ }
  return { total, running, sleeping, threads };
}
export interface Proc { pid: number; user: string; cpu: number; mem: number; rss: number; state: string; time: string; cmd: string }
/** Sortie de « ps -eo pid,user,pcpu,pmem,rss,stat,time,args ». Pur. */
export function parsePs(out: string): Proc[] {
  return out.trim().split('\n').slice(1).map((l) => { const m = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(l); return m ? { pid: Number(m[1]), user: m[2], cpu: Number(m[3]), mem: Number(m[4]), rss: Number(m[5]) * 1024, state: m[6], time: m[7], cmd: m[8].slice(0, 160) } : undefined; }).filter((x): x is Proc => Boolean(x));
}
/** nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits. Pur. */
export function parseNvidia(out: string): Array<{ name: string; util: number; memUsed: number; memTotal: number; temp: number; watts?: number }> {
  return out.trim().split('\n').filter(Boolean).map((l) => { const p = l.split(',').map((x) => x.trim()); return { name: p[0], util: Number(p[1]) || 0, memUsed: (Number(p[2]) || 0) * 1024 ** 2, memTotal: (Number(p[3]) || 0) * 1024 ** 2, temp: Number(p[4]) || 0, ...(Number(p[5]) ? { watts: Number(p[5]) } : {}) }; });
}
/** smartctl -H -A -j : santé d'un disque. Pur. */
export function parseSmart(json: string): { model?: string; passed?: boolean; temp?: number; hours?: number; reallocated?: number; pending?: number; wear?: number } | undefined {
  try {
    const j = JSON.parse(json) as { model_name?: string; smart_status?: { passed?: boolean }; temperature?: { current?: number }; power_on_time?: { hours?: number }; ata_smart_attributes?: { table?: Array<{ id: number; raw?: { value?: number } }> }; nvme_smart_health_information_log?: { percentage_used?: number; temperature?: number; power_on_hours?: number } };
    const a = (id: number) => j.ata_smart_attributes?.table?.find((x) => x.id === id)?.raw?.value, n = j.nvme_smart_health_information_log;
    return { model: j.model_name, passed: j.smart_status?.passed, temp: j.temperature?.current ?? n?.temperature, hours: j.power_on_time?.hours ?? n?.power_on_hours, reallocated: a(5), pending: a(197), wear: n?.percentage_used };
  } catch { return undefined; }
}

// ---------------- L'instantané complet ----------------
let prev: { at: number; stat: Map<string, CpuTimes>; net: ReturnType<typeof parseNetDev>; io: ReturnType<typeof parseDiskstats> } | undefined;
export interface Health {
  at: number; host: string; os: string; uptime: number; cores: number;
  cpu: { total: number; user: number; system: number; iowait: number; steal: number; perCore: number[] };
  mem: ReturnType<typeof parseMem>; load: number[];
  net: Array<{ name: string; kind: IfKind; rx: number; tx: number; speed?: number; signal?: { dbm: number; word: string }; errors: number }>;
  io: Array<{ name: string; read: number; write: number; busy: number }>;
  fs: ReturnType<typeof filesystems>; sensors: ReturnType<typeof sensors>; batteries: ReturnType<typeof batteries>; raid: ReturnType<typeof parseMdstat>;
  tcp: ReturnType<typeof tcpStates>; procs: ReturnType<typeof procSummary>;
}
/** Tout ce qui se lit sans programme extérieur (rapide, appelé chaque minute). Les débits sont calculés depuis l'appel précédent. */
export function health(now = Date.now()): Health {
  const stat = parseStat(read('/proc/stat')), net = parseNetDev(read('/proc/net/dev')), io = parseDiskstats(read('/proc/diskstats')), wl = parseWireless(read('/proc/net/wireless'));
  const dt = prev ? Math.max(0.5, (now - prev.at) / 1000) : 0;
  const all = stat.get('cpu'), pall = prev?.stat.get('cpu');
  const cpu = all && pall ? cpuPct(pall, all) : { total: 0, user: 0, system: 0, iowait: 0, steal: 0 };
  const perCore = [...stat.keys()].filter((k) => k !== 'cpu').map((k) => { const a = prev?.stat.get(k), b = stat.get(k)!; return a ? cpuPct(a, b).total : 0; });
  const out: Health = {
    at: now, host: hostname(), os: `${read('/etc/os-release').match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] ?? process.platform} · noyau ${release()}`, uptime: uptime(), cores: cpus().length,
    cpu: { ...cpu, perCore }, mem: parseMem(read('/proc/meminfo')), load: loadavg(),
    net: [...net].map(([name, v]) => { const p = prev?.net.get(name), sp = num(`/sys/class/net/${name}/speed`), w = wl.get(name); return { name, kind: ifKind(name), rx: p && dt ? Math.max(0, (v.rx - p.rx) / dt) : 0, tx: p && dt ? Math.max(0, (v.tx - p.tx) / dt) : 0, errors: v.rxErr + v.txErr, ...(sp && sp > 0 ? { speed: sp } : {}), ...(w ? { signal: { dbm: w.dbm, word: signalWord(w.dbm) } } : {}) }; }),
    io: [...io].map(([name, v]) => { const p = prev?.io.get(name); return { name, read: p && dt ? Math.max(0, (v.read - p.read) / dt) : 0, write: p && dt ? Math.max(0, (v.write - p.write) / dt) : 0, busy: p && dt ? Math.min(100, Math.round(((v.busyMs - p.busyMs) / (dt * 1000)) * 100)) : 0 }; }),
    fs: filesystems(), sensors: sensors(), batteries: batteries(), raid: parseMdstat(read('/proc/mdstat')),
    tcp: tcpStates(read('/proc/net/tcp') + read('/proc/net/tcp6').split('\n').slice(1).join('\n')), procs: procSummary(),
  };
  prev = { at: now, stat, net, io };
  return out;
}
/** Les séries à ranger chaque minute (noms stables pour les courbes et les déclencheurs). */
export function toSeries(h: Health): Record<string, number> {
  const s: Record<string, number> = { 'eir.cpu': h.cpu.total, 'eir.cpu.iowait': h.cpu.iowait, 'eir.cpu.steal': h.cpu.steal, 'eir.mem': Math.round((h.mem.used / h.mem.total) * 1000) / 10, 'eir.swap': h.mem.swapTotal ? Math.round((h.mem.swapUsed / h.mem.swapTotal) * 1000) / 10 : 0, 'eir.load1': h.load[0], 'eir.load5': h.load[1], 'eir.load15': h.load[2], 'eir.procs': h.procs.total, 'eir.tcp': h.tcp.etablies };
  const key = (x: string) => x.replace(/[^\w.-]/g, '_').replace(/^_+/, '') || 'racine';
  for (const n of h.net) if (n.kind !== 'conteneurs') { s[`eir.net.${key(n.name)}.rx`] = Math.round(n.rx); s[`eir.net.${key(n.name)}.tx`] = Math.round(n.tx); if (n.signal) s[`eir.wifi.${key(n.name)}`] = n.signal.dbm; }
  s['eir.net.rx'] = Math.round(h.net.filter((n) => n.kind !== 'conteneurs' && n.kind !== 'vpn').reduce((a, n) => a + n.rx, 0)); s['eir.net.tx'] = Math.round(h.net.filter((n) => n.kind !== 'conteneurs' && n.kind !== 'vpn').reduce((a, n) => a + n.tx, 0));
  for (const d of h.io) { s[`eir.io.${key(d.name)}.lecture`] = Math.round(d.read); s[`eir.io.${key(d.name)}.ecriture`] = Math.round(d.write); }
  for (const f of h.fs) s[`eir.fs.${f.mount === '/' ? 'racine' : key(f.mount.slice(1).replace(/\//g, '.'))}`] = f.pct;
  for (const x of h.sensors) s[`eir.${x.kind === 'temp' ? 'temp' : 'ventilo'}.${key(`${x.chip}.${x.label}`.toLowerCase())}`] = x.value;
  for (const b of h.batteries) s[`eir.batterie.${key(b.name)}`] = b.pct;
  return s;
}
