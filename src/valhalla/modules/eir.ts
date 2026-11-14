// Hygie — santé des machines en direct : processeur, mémoire, disques, réseau, charge, températures,
// processus gourmands. Mesures partagées avec Hydre et Argo (calculées une seule fois ici).

import { readdirSync, readFileSync, statfsSync } from 'node:fs';
import { cpus, loadavg, totalmem, freemem, uptime } from 'node:os';
import type { Kpi, Module, ModCtx } from '../types.ts';
import { cpuPct, DEFAULT_LIMITS, health, level, parseMem, parseNvidia, parsePs, parseSmart, parseStat, parseWho, toSeries, type Health, type Limits, type Lvl } from '../eir/collect.ts';
import { choixDePoste, PARAM_POSTE, posteDe, type Poste } from '../postes.ts';
import { metrics } from '../metrics.ts';

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
/** Instantané partagé (utilisé aussi par Hydre, Argo, Forseti). */
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
const TONE: Record<Lvl, Kpi['tone']> = { ok: 'bon', suivre: 'neutre', attention: 'attention', grave: 'mauvais' };
const WORD: Record<Lvl, string> = { ok: 'bon', suivre: 'à suivre', attention: 'attention', grave: 'grave' };
const limits = (ctx: ModCtx, k: string): Limits => ({ ...DEFAULT_LIMITS[k], ...((ctx.settings.seuils as Record<string, Partial<Limits>> | undefined)?.[k] ?? {}) });
const rate = (b: number) => `${human(b)}/s`;
const mbps = (b: number) => `${(b * 8 / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mb/s`;
const dur = (s: number) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return d ? `${d} j ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} min`; };
const PERIODS: Record<string, number> = { '1h': 3600_000, '24h': 864e5, '7j': 7 * 864e5, '30j': 30 * 864e5, '1an': 365 * 864e5 };

// Les mesures lentes (programmes extérieurs) : toutes les 10 minutes seulement.
/** Le nom de l'appli Tirésias (santé détaillée des disques) si elle est installée. */
const tiresias = (ctx: ModCtx) => ctx.modules().find((m) => m.id === 'durinn')?.name;
let last: Health | undefined, extra: { at: number; smart: Array<{ dev: string } & NonNullable<ReturnType<typeof parseSmart>>>; gpu: ReturnType<typeof parseNvidia>; who: ReturnType<typeof parseWho> } = { at: 0, smart: [], gpu: [], who: [] };
async function slow(ctx: ModCtx): Promise<void> {
  if (Date.now() - extra.at < 600_000) return;
  extra.at = Date.now();
  const gpu = await ctx.run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw', '--format=csv,noheader,nounits'], { timeoutMs: 8000 }).catch(() => ({ code: 1, out: '', err: '' }));
  const who = await ctx.run('who', [], { timeoutMs: 4000 }).catch(() => ({ code: 1, out: '', err: '' }));
  const smart: typeof extra.smart = [];
  const scan = await ctx.run('smartctl', ['--scan'], { timeoutMs: 8000, sudo: true }).catch(() => ({ code: 1, out: '', err: '' }));
  for (const dev of scan.out.split('\n').map((l) => l.split(' ')[0]).filter((d) => /^\/dev\/[\w/]+$/.test(d)).slice(0, 12)) {
    const r = await ctx.run('smartctl', ['-H', '-A', '-i', '-j', dev], { timeoutMs: 15000, sudo: true }).catch(() => ({ code: 1, out: '', err: '' }));
    const x = parseSmart(r.out); if (x) smart.push({ dev, ...x });
  }
  extra = { at: extra.at, smart, gpu: gpu.code === 0 ? parseNvidia(gpu.out) : [], who: who.code === 0 ? parseWho(who.out) : [] };
}
function current(): Health { return last && Date.now() - last.at < 20_000 ? last : (last = health()); }

// ---------------- Un autre poste (Linux ou Mac), lu par SSH ----------------
export interface EtatDistant { poste: string; systeme: string; hote: string; noyau: string; allumeDepuis: number; coeurs: number; cpu?: number; attente?: number; charge: number[]; mem?: { total: number; utilisee: number; echange: number }; disques: Array<{ mount: string; pct: number; libre: number; taille: number }> }
/** Ce que le poste écrit quand on lui demande son état : une suite de rubriques « ---NOM ». */
const SONDE = 'echo ---SYS; uname -s; uname -n; uname -r; echo ---STAT; head -1 /proc/stat 2>/dev/null; sleep 1; head -1 /proc/stat 2>/dev/null; echo ---MEM; cat /proc/meminfo 2>/dev/null; echo ---CHARGE; cat /proc/loadavg 2>/dev/null || uptime; echo ---DUREE; cat /proc/uptime 2>/dev/null; echo ---COEURS; nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null; echo ---DISQUES; df -P -k 2>/dev/null';
/** La réponse d'un poste à la sonde → son état. Pur. */
export function lireSonde(poste: string, out: string): EtatDistant {
  const r: Record<string, string[]> = {}; let cur = '';
  for (const l of out.split('\n')) { const m = /^---([A-Z]+)$/.exec(l.trim()); if (m) { cur = m[1]; r[cur] = []; } else if (cur) r[cur].push(l); }
  const sys = r.SYS ?? [], stat = (r.STAT ?? []).filter((l) => l.startsWith('cpu')), a = parseStat(stat[0] ?? '').get('cpu'), b = parseStat(stat[1] ?? '').get('cpu'), pc = a && b ? cpuPct(a, b) : undefined;
  const memTxt = (r.MEM ?? []).join('\n'), mem = /MemTotal/.test(memTxt) ? parseMem(memTxt) : undefined;
  const chargeTxt = (r.CHARGE ?? []).join(' '), charge = (/load averages?:\s*([\d.,]+)[ ,]+([\d.,]+)[ ,]+([\d.,]+)/.exec(chargeTxt)?.slice(1, 4) ?? chargeTxt.trim().split(/\s+/).slice(0, 3)).map((x) => Number(String(x).replace(',', '.'))).filter((x) => Number.isFinite(x));
  const virtuel = /^(tmpfs|devtmpfs|overlay|shm|none|udev|map|devfs|efivarfs)\b|^\/dev\/loop/;
  const disques = (r.DISQUES ?? []).slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 6 && !virtuel.test(c[0]) && Number(c[1]) > 0 && !/^\/(snap|proc|sys|dev|run|boot\/efi|System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware))(\/|$)/.test(c.slice(5).join(' ')))
    .map((c) => ({ mount: c.slice(5).join(' '), taille: Number(c[1]) * 1024, libre: Number(c[3]) * 1024, utilise: Number(c[2]) * 1024, pct: Math.round((Number(c[2]) / Math.max(1, Number(c[2]) + Number(c[3]))) * 100) }));
  // Un même disque monté à deux endroits (mêmes taille, occupation et place libre) ne compte qu'une fois.
  const vus = new Set<string>(), uniques = disques.filter((d) => { const k = `${d.taille}|${d.utilise}|${d.libre}`; if (vus.has(k)) return false; vus.add(k); return true; }).map(({ utilise: _u, ...d }) => d);
  return { poste, systeme: /Darwin/i.test(sys[0] ?? '') ? 'macOS' : (sys[0] ?? '').trim() || 'inconnu', hote: (sys[1] ?? '').trim(), noyau: (sys[2] ?? '').trim(), allumeDepuis: Math.round(Number((r.DUREE ?? [])[0]?.trim().split(/\s+/)[0]) || 0), coeurs: Number((r.COEURS ?? [])[0]) || 0, ...(pc ? { cpu: pc.total, attente: pc.iowait } : {}), charge, ...(mem ? { mem: { total: mem.total, utilisee: mem.used, echange: mem.swapUsed } } : {}), disques: uniques };
}
async function etatDistant(p: Poste): Promise<EtatDistant> {
  const r = await p.run('sh', ['-c', SONDE], { timeoutMs: 30_000 });
  if (r.code !== 0 && !/---SYS/.test(r.out)) throw new Error(`${p.nom} n'a pas répondu à la demande d'état${r.err.trim() ? ` : ${r.err.trim().split('\n').at(-1)!.slice(0, 160)}` : ''}`);
  return lireSonde(p.nom, r.out);
}
function texteDistant(e: EtatDistant, lv: (v: number, k: string) => string): string {
  const mp = e.mem ? Math.round((e.mem.utilisee / e.mem.total) * 100) : undefined;
  return [`${e.poste}${e.hote && e.hote !== e.poste ? ` (${e.hote})` : ''} · ${e.systeme}${e.noyau ? ` ${e.noyau}` : ''}${e.allumeDepuis ? ` · allumé depuis ${dur(e.allumeDepuis)}` : ''}`,
    `${e.cpu !== undefined ? `Processeur ${e.cpu} % (${lv(e.cpu, 'cpu')}) · ` : ''}${e.coeurs ? `${e.coeurs} cœurs · ` : ''}charge ${e.charge.map((x) => x.toFixed(1)).join(' / ') || '?'}${(e.attente ?? 0) > 5 ? ` · attente disque ${e.attente} %` : ''}`,
    ...(e.mem && mp !== undefined ? [`Mémoire ${human(e.mem.utilisee)} / ${human(e.mem.total)} (${mp} %, ${lv(mp, 'mem')})${e.mem.echange ? ` · échange ${human(e.mem.echange)}` : ''}`] : []),
    ...e.disques.map((d) => `Disque ${d.mount} : ${d.pct} % (${lv(d.pct, 'fs')}) · ${human(d.libre)} libres`)].join('\n');
}

export const eir: Module = {
  id: 'eir', name: 'Hygie', family: 'Machines',
  what: 'La santé de la machine en direct et dans le temps : processeur, mémoire, disques, réseau, capteurs, SMART, RAID, carte graphique, processus. Comme Glances, lisible d\'un coup d\'œil.',
  does: ['processeur par cœur, attente disque, vol de temps (VM), charge 1 / 5 / 15 min', 'mémoire, cache, échange (swap)', 'réseau par carte : filaire, Wi-Fi (signal), VPN, débit et erreurs', 'disques : place, débit lecture / écriture, occupation', 'capteurs : températures (avec seuil critique), ventilateurs, batterie', 'RAID logiciel (complet, dégradé, reconstruction)', 'santé SMART des disques (secteurs réalloués, usure des SSD)', 'carte graphique NVIDIA (charge, mémoire, température, watts)', 'processus : tri par processeur ou mémoire, arrêt d\'un processus avec ton accord', 'personnes connectées, connexions réseau', 'chaque mesure gardée : courbes 1 h, 24 h, 7 j, 30 j, 1 an', 'seuils réglables : vert, bleu, orange, rouge (comme Glances)', 'export pour Prometheus et Grafana', 'alertes : disque plein, mémoire saturée, surchauffe, RAID dégradé, disque qui lâche'],
  from: ['Glances'], upstream: ['nicolargo/glances'],
  words: ['etat de la machine', 'état de la machine', 'etat du serveur', 'état du serveur', 'serveur', 'sante', 'santé', 'processeur', 'cpu', 'memoire', 'mémoire', 'ram', 'disque plein', 'espace disque', 'temperature', 'température', 'charge', 'lent', 'rame', 'processus', 'ressources', 'smart', 'raid', 'ventilateur', 'carte graphique', 'gpu', 'glances'],
  actions: [
    { id: 'etat', label: 'État de la machine', what: 'Mesures du moment, avec leur niveau (de cette machine, ou d\'un autre poste Linux ou Mac)', read: true, params: [PARAM_POSTE], words: ['etat', 'état', 'comment va', 'sante', 'santé'], run: async (ctx, i) => {
      const poste = posteDe(ctx, i.poste); if (!poste.local) { const e = await etatDistant(poste), lvd = (v: number, k: string) => WORD[level(v, limits(ctx, k))]; return { text: texteDistant(e, lvd), data: e }; }
      const h = current(), mp = Math.round((h.mem.used / h.mem.total) * 100), lv = (v: number, k: string) => WORD[level(v, limits(ctx, k))];
      const temps = h.sensors.filter((x) => x.kind === 'temp').sort((a, b) => b.value - a.value).slice(0, 4);
      return { text: [`${h.host} · ${h.os} · allumée depuis ${dur(h.uptime)}`, `Processeur ${h.cpu.total} % (${lv(h.cpu.total, 'cpu')}) · ${h.cores} cœurs · charge ${h.load.map((x) => x.toFixed(1)).join(' / ')}${h.cpu.iowait > 5 ? ` · attente disque ${h.cpu.iowait} %` : ''}`, `Mémoire ${human(h.mem.used)} / ${human(h.mem.total)} (${mp} %, ${lv(mp, 'mem')})${h.mem.swapTotal ? ` · échange ${human(h.mem.swapUsed)}` : ''}`, ...h.fs.map((f) => `Disque ${f.mount} : ${f.pct} % (${lv(f.pct, 'fs')}) · ${human(f.free)} libres`), ...(temps.length ? [`Températures : ${temps.map((x) => `${x.label} ${x.value} °C`).join(', ')}`] : []), ...h.raid.map((r) => `RAID ${r.name} (${r.level}) : ${r.state}${r.progress ? ` ${r.progress} %` : ''}`), ...extra.smart.filter((x) => x.passed === false || (x.reallocated ?? 0) > 0).map((x) => `⚠ SMART ${x.dev} : ${x.passed === false ? 'défaillant' : `${x.reallocated} secteurs réalloués`}`)].join('\n'), data: h };
    } },
    { id: 'processus', label: 'Processus', what: 'Les processus qui consomment le plus (processeur ou mémoire)', read: true, words: ['processus', 'qui consomme', 'gourmand'], params: [{ key: 'tri', label: 'Trier par', kind: 'select', options: ['processeur', 'memoire'], default: 'processeur' }, { key: 'n', label: 'Combien', kind: 'number', default: 15 }, PARAM_POSTE], run: async (ctx, i) => {
      const poste = posteDe(ctx, i.poste), r = await poste.run('ps', ['-eo', 'pid,user,pcpu,pmem,rss,stat,time,args', '--sort', i.tri === 'memoire' ? '-rss' : '-pcpu']);
      const l = parsePs(r.out).slice(0, Math.min(100, Number(i.n) || 15));
      return { text: (poste.local ? '' : `Sur ${poste.nom} :\n`) + l.map((p) => `${p.pid} · ${p.user} · ${p.cpu} % proc. · ${human(p.rss)} · ${p.cmd}`).join('\n') || `${poste.local ? '' : `Sur ${poste.nom} : `}liste indisponible.`, data: l };
    } },
    { id: 'arreter_processus', label: 'Arrêter un processus', what: 'Demande poliment à un programme de s\'arrêter (signal TERM)', quick: false, grave: (i) => `arrêter le processus ${String(i.pid)}`, params: [{ key: 'pid', label: 'Numéro du processus (PID)', kind: 'number', required: true }], run: async (ctx, i) => {
      const pid = Number(i.pid); if (!Number.isInteger(pid) || pid < 2) throw new Error('numéro invalide'); if (pid === process.pid) throw new Error('c\'est Odin lui-même');
      const r = await ctx.run('kill', ['-TERM', String(pid)], { sudo: true }); if (r.code !== 0) throw new Error(r.err.trim() || 'refusé');
      return { text: `⏹ Processus ${pid} prié de s'arrêter.` };
    } },
    { id: 'mesures', label: 'Courbe d\'une mesure', what: 'Les valeurs d\'une mesure sur une période (1h, 24h, 7j, 30j, 1an)', read: true, words: ['courbe de mesure', 'courbe', 'mesure'], params: [{ key: 'serie', label: 'Mesure (ex. eir.cpu)', kind: 'text', default: 'eir.cpu' }, { key: 'periode', label: 'Période', kind: 'select', options: Object.keys(PERIODS), default: '24h' }], run: (_ctx, i) => {
      const m = metrics(); if (!m) throw new Error('mesures indisponibles'); const name = String(i.serie || 'eir.cpu'), span = PERIODS[String(i.periode)] ?? 864e5;
      const s = m.series(name, Date.now() - span, Date.now(), 60); if (!s.length) return { text: `Pas encore de valeurs pour ${name}. Mesures connues : ${m.names('eir.').slice(0, 20).join(', ')}…` };
      const avg = s.reduce((a, x) => a + x.avg, 0) / s.length;
      return { text: `${name} sur ${i.periode ?? '24h'} : moyenne ${avg.toFixed(1)}, minimum ${Math.min(...s.map((x) => x.min)).toFixed(1)}, maximum ${Math.max(...s.map((x) => x.max)).toFixed(1)} (${s.length} points).`, data: s };
    } },
    { id: 'seuils', label: 'Régler les seuils', what: 'À partir de quand une mesure passe en bleu, orange, rouge', params: [{ key: 'mesure', label: 'Mesure', kind: 'select', options: Object.keys(DEFAULT_LIMITS), default: 'cpu' }, { key: 'suivre', label: 'Bleu (à suivre) à partir de', kind: 'number', required: true }, { key: 'attention', label: 'Orange (attention) à partir de', kind: 'number', required: true }, { key: 'grave', label: 'Rouge (grave) à partir de', kind: 'number', required: true }], run: (ctx, i) => {
      const k = String(i.mesure); if (!DEFAULT_LIMITS[k]) throw new Error('mesure inconnue');
      const l = { suivre: Number(i.suivre), attention: Number(i.attention), grave: Number(i.grave) }; if (!(l.suivre < l.attention && l.attention < l.grave)) throw new Error('il faut bleu < orange < rouge');
      ctx.saveSettings({ seuils: { ...((ctx.settings.seuils as object) ?? {}), [k]: l } });
      return { text: `Seuils de ${k} : bleu ${l.suivre}, orange ${l.attention}, rouge ${l.grave}.` };
    } },
    { id: 'exporter', label: 'Exporter pour Prometheus', what: 'Les dernières valeurs au format Prometheus (pour Grafana ou un autre outil)', read: true, words: ['prometheus', 'exporter les mesures'], run: () => ({ text: metrics()?.prometheus() || 'Pas encore de mesures.' }) },
  ],
  async view(ctx, q) {
    const lv = (v: number, k: string) => level(v, limits(ctx, k)), P = choixDePoste(ctx, q);
    // Un autre poste (Linux ou Mac) choisi dans « Sur quel poste ? » : son état, lu par SSH, sans rien y installer.
    if (P.actuel) {
      const poste = posteDe(ctx, P.actuel);
      try {
        const e = await etatDistant(poste), mpd = e.mem ? Math.round((e.mem.utilisee / e.mem.total) * 100) : undefined;
        let psd: ReturnType<typeof parsePs> = [];
        try { psd = parsePs((await poste.run('ps', ['-eo', 'pid,user,pcpu,pmem,rss,stat,time,args', '--sort', '-pcpu'], { timeoutMs: 20_000 })).out).slice(0, 12); } catch { /* « ps » ne connaît pas ces options sur ce système */ }
        return {
          postes: P,
          subtitle: `${e.poste}${e.hote && e.hote !== e.poste ? ` (${e.hote})` : ''} · ${e.systeme}${e.noyau ? ` ${e.noyau}` : ''}${e.coeurs ? ` · ${e.coeurs} cœurs` : ''}${e.allumeDepuis ? ` · allumé depuis ${dur(e.allumeDepuis)}` : ''} · lu par SSH, rien n'est installé dessus`,
          kpis: [...(e.cpu !== undefined ? [{ label: 'Processeur', value: `${e.cpu} %`, pct: e.cpu, tone: TONE[lv(e.cpu, 'cpu')] }] : []), ...(e.mem && mpd !== undefined ? [{ label: 'Mémoire', value: `${human(e.mem.utilisee)} / ${human(e.mem.total)}`, pct: mpd, tone: TONE[lv(mpd, 'mem')] }] : []), { label: 'Charge (1/5/15 min)', value: e.charge.map((x) => x.toFixed(1).replace('.', ',')).join(' · ') || '?' }],
          sections: [psd.length ? { kind: 'table', title: `Processus de ${e.poste}`, columns: ['PID', 'Personne', 'Processeur', 'Mémoire', 'Commande'], rows: psd.map((p) => ({ cells: [String(p.pid), p.user, `${p.cpu} %`, human(p.rss), p.cmd] })) } : { kind: 'text', title: `Processus de ${e.poste}`, text: 'Ce poste ne donne pas la liste de ses processus de cette façon.' }],
          side: [{ kind: 'bars', title: 'Disques (place)', items: e.disques.map((d) => ({ label: d.mount, value: d.pct, display: `${d.pct} % · ${human(d.libre)} libres` })) }],
        };
      } catch (err) { return { postes: P, subtitle: `${poste.nom} ne répond pas`, sections: [{ kind: 'text', title: `${poste.nom} ne répond pas`, tone: 'mauvais', text: `${(err as Error).message}. Vérifie qu'il est allumé et sur le même réseau, puis rouvre la page.` }] }; }
    }
    const h = current(), mp = Math.round((h.mem.used / h.mem.total) * 100);
    const ps = parsePs((await ctx.run('ps', ['-eo', 'pid,user,pcpu,pmem,rss,stat,time,args', '--sort', '-pcpu'])).out).slice(0, 12);
    const net = h.net.filter((n) => n.kind !== 'conteneurs');
    return {
      postes: P,
      subtitle: `${h.host} · ${h.os} · ${h.cores} cœurs · allumée depuis ${dur(h.uptime)}${extra.who.length ? ` · ${extra.who.length} personne(s) connectée(s)` : ''}`,
      kpis: [
        { label: 'Processeur', value: `${h.cpu.total} %`, pct: h.cpu.total, tone: TONE[lv(h.cpu.total, 'cpu')] },
        { label: 'Mémoire', value: `${human(h.mem.used)} / ${human(h.mem.total)}`, pct: mp, tone: TONE[lv(mp, 'mem')] },
        { label: 'Charge (1/5/15 min)', value: h.load.map((x) => x.toFixed(1).replace('.', ',')).join(' · '), pct: Math.min(100, Math.round((h.load[0] / h.cores) * 100)), tone: TONE[lv(h.load[0] / h.cores, 'load')] },
        { label: 'Réseau', value: `↓ ${mbps(net.filter((n) => n.kind !== 'vpn').reduce((a, n) => a + n.rx, 0))} · ↑ ${mbps(net.filter((n) => n.kind !== 'vpn').reduce((a, n) => a + n.tx, 0))}` },
      ],
      sections: [
        { kind: 'table', title: 'Processus', columns: ['PID', 'Personne', 'Processeur', 'Mémoire', 'Commande'], rows: ps.map((p) => ({ cells: [String(p.pid), p.user, `${p.cpu} %`, human(p.rss), p.cmd], tone: TONE[lv(p.cpu / h.cores, 'cpu')] === 'bon' ? undefined : 'attention' as const, actions: [{ action: 'arreter_processus', label: 'Arrêter', input: { pid: p.pid } }] })) },
        { kind: 'table', title: 'Réseau', columns: ['Carte', 'Type', 'Reçu', 'Envoyé', 'Vitesse', 'Signal', 'Erreurs'], empty: 'Aucune carte réseau.', rows: net.map((n) => ({ cells: [n.name, n.kind, mbps(n.rx), mbps(n.tx), n.speed ? `${n.speed} Mb/s` : '—', n.signal ? `${n.signal.dbm} dBm (${n.signal.word})` : '—', String(n.errors)] })) },
        { kind: 'table', title: 'Disques (débit)', columns: ['Disque', 'Lecture', 'Écriture', 'Occupé'], empty: 'Aucun disque lisible.', rows: h.io.map((d) => ({ cells: [d.name, rate(d.read), rate(d.write), `${d.busy} %`], tone: d.busy > 80 ? 'attention' as const : undefined })) },
        ...(h.raid.length ? [{ kind: 'table' as const, title: 'RAID', columns: ['Grappe', 'Type', 'Disques', 'État'], rows: h.raid.map((r) => ({ cells: [r.name, r.level, `${r.ok}/${r.disks}`, `${r.state}${r.progress ? ` (${r.progress} %)` : ''}`], tone: r.state === 'dégradé' ? 'mauvais' as const : r.state === 'reconstruction' ? 'attention' as const : 'bon' as const })) }] : []),
        ...(extra.smart.length ? [{ kind: 'table' as const, title: 'Santé des disques (SMART)', columns: ['Disque', 'Modèle', 'Santé', 'Température', 'Heures', 'Secteurs réalloués', 'Usure SSD'], rows: extra.smart.map((x) => ({ cells: [x.dev, x.model ?? '—', x.passed === false ? 'défaillant' : 'bon', x.temp ? `${x.temp} °C` : '—', x.hours ? String(x.hours) : '—', String(x.reallocated ?? 0), x.wear !== undefined ? `${x.wear} %` : '—'], tone: x.passed === false || (x.reallocated ?? 0) > 0 ? 'mauvais' as const : 'bon' as const, ...(tiresias(ctx) ? { actions: [{ module: 'durinn', action: 'ouvrir', label: `Détail (${tiresias(ctx)})`, input: { disque: x.dev } }] } : {}) })) }] : []),
        ...(extra.gpu.length ? [{ kind: 'table' as const, title: 'Carte graphique', columns: ['Carte', 'Charge', 'Mémoire', 'Température', 'Puissance'], rows: extra.gpu.map((g) => ({ cells: [g.name, `${g.util} %`, `${human(g.memUsed)} / ${human(g.memTotal)}`, `${g.temp} °C`, g.watts ? `${g.watts} W` : '—'], tone: TONE[lv(g.util, 'gpu')] })) }] : []),
        ...(extra.who.length ? [{ kind: 'list' as const, title: 'Personnes connectées', items: extra.who.map((w) => ({ title: w.user, detail: `${w.tty}${w.from ? ` depuis ${w.from}` : ''}`, meta: w.since })) }] : []),
      ],
      side: [
        { kind: 'bars', title: 'Disques (place)', items: h.fs.map((d) => ({ label: d.mount, value: Math.round(d.pct), display: `${d.pct} % · ${human(d.free)} libres` })) },
        { kind: 'list', title: 'Capteurs', items: h.sensors.map((x) => ({ title: x.label, meta: x.kind === 'temp' ? `${x.value} °C${x.crit ? ` (critique ${x.crit})` : ''}` : `${x.value} tr/min`, tone: x.kind === 'temp' ? TONE[lv(x.value, 'temp')] : undefined })), empty: 'Pas de capteur lisible.' },
        ...(h.batteries.length ? [{ kind: 'list' as const, title: 'Batterie', items: h.batteries.map((b) => ({ title: b.name, meta: `${b.pct} % · ${b.status}`, tone: b.pct < 15 ? 'mauvais' as const : undefined })) }] : []),
        { kind: 'list', title: 'Système', items: [{ title: 'Processus', meta: `${h.procs.total} (${h.procs.running} actifs, ${h.procs.threads} fils)` }, { title: 'Connexions TCP', meta: `${h.tcp.etablies} ouvertes · ${h.tcp.ecoute} à l'écoute` }, { title: 'Attente disque', meta: `${h.cpu.iowait} %`, tone: TONE[lv(h.cpu.iowait, 'iowait')] }, ...(h.cpu.steal ? [{ title: 'Temps volé (VM)', meta: `${h.cpu.steal} %` }] : [])] },
      ],
    };
  },
  watch: { every: 60, async run(ctx) {
    const h = (last = health());
    metrics()?.put(toSeries(h));
    void slow(ctx).catch(() => {});
    const fsL = limits(ctx, 'fs'), memL = limits(ctx, 'mem'), tL = limits(ctx, 'temp'), mp = (h.mem.used / h.mem.total) * 100;
    for (const d of h.fs) if (d.pct >= fsL.grave) ctx.alert({ level: d.pct >= 97 ? 'critique' : 'haute', title: `Disque ${d.mount} plein à ${Math.round(d.pct)} %`, detail: `Reste ${human(d.free)}.`, key: `disk:${d.mount}`, steps: ['Regarde ce qui prend de la place (gros fichiers, journaux, sauvegardes, images Docker).', 'Vide les corbeilles et les vieux journaux ; nettoie Docker (Argo).', 'Ou ajoute un disque.'] });
    if (mp >= Math.max(95, memL.grave)) ctx.alert({ level: 'haute', title: `Mémoire saturée (${Math.round(mp)} %)`, key: 'mem', steps: ['Regarde les processus qui consomment le plus de mémoire.', 'Redémarre le programme fautif ou arrête-le (avec ton accord).'] });
    for (const x of h.sensors) if (x.kind === 'temp' && (x.value >= Math.max(90, tL.grave) || (x.crit && x.value >= x.crit - 5))) ctx.alert({ level: 'haute', title: `Surchauffe : ${x.label} à ${x.value} °C`, key: `temp:${x.label}`, steps: ['Vérifie que la machine respire (poussière, ventilateurs, pièce chaude).', 'Allège la charge (transcodages, compilations).'] });
    for (const r of h.raid) if (r.state === 'dégradé') ctx.alert({ level: 'critique', title: `RAID ${r.name} dégradé (${r.ok}/${r.disks} disques)`, detail: 'Un disque de la grappe est absent ou en panne : un deuxième incident ferait perdre les données.', key: `raid:${r.name}`, steps: ['Fais une sauvegarde tout de suite (Phénix).', 'Repère le disque en panne (SMART) et remplace-le.', 'Ajoute le nouveau disque à la grappe : la reconstruction se suit ici.'] });
    // Avec Tirésias, c'est lui qui prévient pour la santé des disques (avec l'historique) : pas d'alerte en double.
    if (!tiresias(ctx)) for (const x of extra.smart) if (x.passed === false || (x.pending ?? 0) > 0) ctx.alert({ level: 'critique', title: `Disque ${x.dev} en train de lâcher (SMART)`, detail: `${x.model ?? ''} : ${x.passed === false ? 'test de santé échoué' : `${x.pending} secteurs illisibles`}.`, key: `smart:${x.dev}`, steps: ['Sauvegarde ce disque maintenant.', 'Remplace-le dès que possible.'] });
    ctx.emit('mesure', { cpu: h.cpu.total, mem: Math.round(mp), disque: Math.max(0, ...h.fs.map((d) => Math.round(d.pct))) });
  } },
};
