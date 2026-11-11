// Eir — santé des machines en direct : processeur, mémoire, disques, réseau, charge, températures,
// processus gourmands. Mesures partagées avec Ymir et Naglfar (calculées une seule fois ici).

import { readdirSync, readFileSync, statfsSync } from 'node:fs';
import { cpus, loadavg, totalmem, freemem, uptime } from 'node:os';
import type { Kpi, Module } from '../types.ts';

const read = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
export const human = (b: number) => { const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; } return `${b < 10 && i ? b.toFixed(1).replace('.', ',') : Math.round(b)} ${u[i]}`; };

/** /proc/stat → pourcentage d'occupation entre deux lectures. */
export function cpuTimes(stat = read('/proc/stat')): { idle: number; total: number } | undefined {
  const l = stat.split('\n').find((x) => x.startsWith('cpu ')); if (!l) return undefined;
  const v = l.trim().split(/\s+/).slice(1).map(Number); const idle = v[3] + (v[4] ?? 0);
  return { idle, total: v.reduce((a, b) => a + b, 0) };
}
export function memInfo(text = read('/proc/meminfo')): { total: number; available: number } {
  const g = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? 0) * 1024;
  const total = g('MemTotal') || totalmem();
  return { total, available: g('MemAvailable') || freemem() };
}
export function netTotals(text = read('/proc/net/dev')): { rx: number; tx: number } {
  let rx = 0, tx = 0;
  for (const l of text.split('\n').slice(2)) { const [name, rest] = l.split(':'); if (!rest || /^\s*(lo|veth|docker|br-)/.test(name)) continue; const v = rest.trim().split(/\s+/).map(Number); rx += v[0]; tx += v[8]; }
  return { rx, tx };
}
export function disks(mounts = read('/proc/mounts')): Array<{ mount: string; fs: string; size: number; used: number; pct: number }> {
  const out: Array<{ mount: string; fs: string; size: number; used: number; pct: number }> = [], seen = new Set<string>();
  for (const l of mounts.split('\n')) {
    const [dev, mount, fs, opts = ''] = l.split(' ');
    // Disques en lecture seule (images squashfs, systèmes montés « ro ») : jamais « pleins » au sens utile.
    if (!dev?.startsWith('/dev/') || seen.has(dev) || /^\/(snap|boot\/efi)/.test(mount) || fs === 'squashfs' || /(^|,)ro(,|$)/.test(opts)) continue;
    seen.add(dev);
    try { const s = statfsSync(mount); const size = s.blocks * s.bsize, free = s.bavail * s.bsize; if (size > 0) out.push({ mount, fs, size, used: size - free, pct: Math.round(((size - free) / size) * 100) }); } catch { /* inaccessible */ }
  }
  return out;
}
export function temps(): Array<{ name: string; c: number }> {
  const out: Array<{ name: string; c: number }> = [];
  try { for (const z of readdirSync('/sys/class/thermal')) { if (!z.startsWith('thermal_zone')) continue; const c = Number(read(`/sys/class/thermal/${z}/temp`)) / 1000; if (c > 0 && c < 150) out.push({ name: read(`/sys/class/thermal/${z}/type`).trim() || z, c: Math.round(c) }); } } catch { /* pas de capteurs */ }
  return out;
}
/** Processus les plus gourmands (mémoire résidente ; le CPU vient de ps). */
export function topProcs(psOut: string, n = 8): Array<{ pid: number; cpu: number; mem: number; cmd: string }> {
  return psOut.trim().split('\n').slice(1).map((l) => { const m = /^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/.exec(l); return m ? { pid: Number(m[1]), cpu: Number(m[2]), mem: Number(m[3]), cmd: m[4].slice(0, 80) } : undefined; }).filter((x): x is { pid: number; cpu: number; mem: number; cmd: string } => Boolean(x)).sort((a, b) => b.cpu - a.cpu).slice(0, n);
}

let prevCpu = cpuTimes(), prevNet = { ...netTotals(), at: Date.now() };
/** Instantané partagé (utilisé aussi par Ymir, Naglfar, Forseti). */
export function snapshot(): { cpu: number; mem: { total: number; used: number; pct: number }; net: { rx: number; tx: number }; load: number[]; disks: ReturnType<typeof disks>; temps: ReturnType<typeof temps>; uptime: number; cores: number } {
  const c = cpuTimes(); let cpu = 0;
  if (c && prevCpu && c.total > prevCpu.total) cpu = Math.round((1 - (c.idle - prevCpu.idle) / (c.total - prevCpu.total)) * 100);
  prevCpu = c;
  const n = netTotals(), dt = Math.max(1, (Date.now() - prevNet.at) / 1000);
  const net = { rx: Math.max(0, (n.rx - prevNet.rx) / dt), tx: Math.max(0, (n.tx - prevNet.tx) / dt) };
  prevNet = { ...n, at: Date.now() };
  const m = memInfo();
  return { cpu, mem: { total: m.total, used: m.total - m.available, pct: Math.round(((m.total - m.available) / m.total) * 100) }, net, load: loadavg(), disks: disks(), temps: temps(), uptime: uptime(), cores: cpus().length };
}

const tone = (p: number, warn = 80, bad = 92) => (p >= bad ? 'mauvais' : p >= warn ? 'attention' : 'bon') as Kpi['tone'];

export const eir: Module = {
  id: 'eir', name: 'Eir', family: 'Machines',
  what: 'La santé de la machine en direct : processeur, mémoire, disques, réseau, températures, processus.',
  does: ['mesures en direct (processeur, mémoire, disques, réseau, charge, températures)', 'processus les plus gourmands', 'alertes : disque presque plein, mémoire saturée, surchauffe', 'mesures partagées avec Ymir, Naglfar et Forseti'],
  from: ['Glances'], upstream: ['nicolargo/glances'],
  words: ['etat de la machine', 'état de la machine', 'etat du serveur', 'état du serveur', 'serveur', 'sante', 'santé', 'processeur', 'cpu', 'memoire', 'mémoire', 'ram', 'disque plein', 'espace disque', 'temperature', 'température', 'charge', 'lent', 'rame', 'processus', 'ressources'],
  actions: [
    { id: 'etat', label: 'État de la machine', what: 'Mesures du moment', read: true, words: ['etat', 'état', 'comment va', 'sante', 'santé'], run: () => {
      const s = snapshot();
      return { text: `Processeur ${s.cpu} % (${s.cores} cœurs, charge ${s.load.map((x) => x.toFixed(1)).join(' / ')}) · mémoire ${human(s.mem.used)} / ${human(s.mem.total)} (${s.mem.pct} %)\n${s.disks.map((d) => `Disque ${d.mount} : ${d.pct} % (${human(d.used)} / ${human(d.size)})`).join('\n')}${s.temps.length ? `\nTempératures : ${s.temps.map((t) => `${t.name} ${t.c} °C`).join(', ')}` : ''}\nAllumée depuis ${Math.round(s.uptime / 86400)} jour(s).`, data: s };
    } },
    { id: 'processus', label: 'Processus gourmands', what: 'Les 8 processus qui consomment le plus', read: true, words: ['processus', 'qui consomme', 'gourmand'], run: async (ctx) => {
      const r = await ctx.run('ps', ['-eo', 'pid,pcpu,pmem,args', '--sort=-pcpu']);
      const top = topProcs(r.out);
      return { text: top.map((p) => `${p.pid} · ${p.cpu} % CPU · ${p.mem} % mém · ${p.cmd}`).join('\n') || 'Liste indisponible.', data: top };
    } },
  ],
  async view(ctx) {
    const s = snapshot(), top = topProcs((await ctx.run('ps', ['-eo', 'pid,pcpu,pmem,args', '--sort=-pcpu'])).out);
    return {
      subtitle: `${s.cores} cœurs · allumée depuis ${Math.round(s.uptime / 86400)} jour(s)`,
      kpis: [
        { label: 'Processeur', value: `${s.cpu} %`, pct: s.cpu, tone: tone(s.cpu, 85, 95) },
        { label: 'Mémoire', value: `${human(s.mem.used)} / ${human(s.mem.total)}`, pct: s.mem.pct, tone: tone(s.mem.pct, 85, 95) },
        { label: 'Réseau', value: `↓ ${human(s.net.rx)}/s · ↑ ${human(s.net.tx)}/s` },
        { label: 'Charge (1/5/15 min)', value: s.load.map((x) => x.toFixed(1).replace('.', ',')).join(' · '), pct: Math.min(100, Math.round((s.load[0] / s.cores) * 100)) },
      ],
      sections: [
        { kind: 'table', title: 'Processus les plus gourmands', columns: ['PID', 'CPU', 'Mémoire', 'Commande'], rows: top.map((p) => ({ cells: [String(p.pid), `${p.cpu} %`, `${p.mem} %`, p.cmd], tone: p.cpu > 80 ? 'attention' : undefined })) },
      ],
      side: [
        { kind: 'bars', title: 'Disques', items: s.disks.map((d) => ({ label: d.mount, value: d.pct, display: `${d.pct} % · ${human(d.size - d.used)} libres` })) },
        { kind: 'list', title: 'Températures', items: s.temps.map((t) => ({ title: t.name, meta: `${t.c} °C`, tone: t.c > 85 ? 'mauvais' : t.c > 75 ? 'attention' : 'bon' })), empty: 'Pas de capteur de température lisible.' },
      ],
    };
  },
  watch: { every: 120, run(ctx) {
    const s = snapshot();
    for (const d of s.disks) if (d.pct >= 90) ctx.alert({ level: d.pct >= 97 ? 'critique' : 'haute', title: `Disque ${d.mount} plein à ${d.pct} %`, detail: `Reste ${human(d.size - d.used)}.`, key: `disk:${d.mount}` });
    if (s.mem.pct >= 95) ctx.alert({ level: 'haute', title: `Mémoire saturée (${s.mem.pct} %)`, key: 'mem' });
    for (const t of s.temps) if (t.c >= 90) ctx.alert({ level: 'haute', title: `Surchauffe : ${t.name} à ${t.c} °C`, key: `temp:${t.name}` });
    ctx.emit('mesure', { cpu: s.cpu, mem: s.mem.pct, disque: Math.max(0, ...s.disks.map((d) => d.pct)) });
  } },
};
