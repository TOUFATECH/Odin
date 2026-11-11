// Skögul — comportements suspects des programmes : exécutables lancés depuis /tmp, programme effacé
// après lancement, shell ouvert par un serveur web, mineurs de cryptomonnaie, nouveaux ports ouverts,
// tâches planifiées modifiées. Une alerte par découverte, envoyée à Forseti.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import type { Module } from '../types.ts';

export interface Proc { pid: number; ppid: number; uid: number; name: string; exe: string; cmd: string }
const rd = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
export function procs(root = '/proc'): Proc[] {
  const out: Proc[] = [];
  for (const d of readdirSync(root)) {
    if (!/^\d+$/.test(d)) continue;
    const st = rd(`${root}/${d}/status`); if (!st) continue;
    let exe = ''; try { exe = readlinkSync(`${root}/${d}/exe`); } catch { /* noyau ou droits */ }
    out.push({ pid: Number(d), ppid: Number(/^PPid:\s+(\d+)/m.exec(st)?.[1] ?? 0), uid: Number(/^Uid:\s+(\d+)/m.exec(st)?.[1] ?? 0), name: /^Name:\s+(.*)$/m.exec(st)?.[1] ?? '', exe, cmd: rd(`${root}/${d}/cmdline`).replace(/\0/g, ' ').trim().slice(0, 300) });
  }
  return out;
}
const WEB = /^(nginx|apache2|httpd|php-fpm.*|php\d*|lighttpd|caddy|uwsgi|gunicorn)$/;
const SHELLS = /^(sh|bash|dash|zsh|ash|busybox|nc|ncat|socat|python\d?|perl)$/;
const MINERS = /(xmrig|kdevtmpfsi|kinsing|minerd|cpuminer|xmr-stak|nbminer|t-rex|lolminer|stratum\+tcp)/i;
/** Règles de comportement : renvoie les découvertes (une par processus et par règle). */
export function judge(list: Proc[]): Array<{ pid: number; rule: string; level: 'critique' | 'haute' | 'moyenne'; detail: string }> {
  const byPid = new Map(list.map((p) => [p.pid, p])), out: Array<{ pid: number; rule: string; level: 'critique' | 'haute' | 'moyenne'; detail: string }> = [];
  for (const p of list) {
    const d = `${p.name} (pid ${p.pid}) : ${p.cmd || p.exe}`;
    if (MINERS.test(`${p.name} ${p.cmd}`)) out.push({ pid: p.pid, rule: 'mineur de cryptomonnaie', level: 'critique', detail: d });
    if (/^\/(tmp|dev\/shm|var\/tmp)\//.test(p.exe)) out.push({ pid: p.pid, rule: 'programme lancé depuis un dossier temporaire', level: 'haute', detail: d });
    if (/ \(deleted\)$/.test(p.exe) && !/^\/(usr|opt|snap)\//.test(p.exe)) out.push({ pid: p.pid, rule: 'programme effacé après son lancement', level: 'haute', detail: d });
    const parent = byPid.get(p.ppid);
    if (parent && WEB.test(parent.name) && SHELLS.test(p.name)) out.push({ pid: p.pid, rule: 'shell ouvert par le serveur web', level: 'critique', detail: `${d} ← ${parent.name}` });
    if (p.uid === 33 && SHELLS.test(p.name) && /-i\b|\/dev\/tcp|-e \/bin/.test(p.cmd)) out.push({ pid: p.pid, rule: 'shell interactif de www-data', level: 'critique', detail: d });
  }
  return out;
}
export function listening(ssOut: string): string[] {
  return [...new Set(ssOut.split('\n').slice(1).map((l) => { const c = l.trim().split(/\s+/); const local = c[3] ?? c[4] ?? ''; const port = local.slice(local.lastIndexOf(':') + 1); const prog = /users:\(\("([^"]+)"/.exec(l)?.[1] ?? '?'; return port && /^\d+$/.test(port) ? `${c[0]}/${port} ${prog}` : ''; }).filter(Boolean))].sort();
}

export const skogul: Module = {
  id: 'skogul', name: 'Skögul', family: 'Sécurité',
  what: 'Surveille le comportement des programmes et signale ce qui n\'est pas normal.',
  does: ['programme lancé depuis /tmp ou /dev/shm', 'programme effacé après son lancement', 'shell ouvert par un serveur web (site piraté)', 'mineurs de cryptomonnaie', 'nouveau port ouvert sur la machine', 'tâches planifiées modifiées', 'arrêt d\'un processus suspect (avec ton accord)'],
  from: ['Falco'], upstream: ['falcosecurity/falco'],
  words: ['comportement', 'suspect', 'processus', 'processus suspect', 'mineur', 'crypto', 'shell', 'piraté', 'pirate', 'port ouvert', 'cron'],
  actions: [
    { id: 'analyser', label: 'Analyser maintenant', what: 'Passe tous les programmes en revue', read: true, words: ['analyse', 'verifie', 'vérifie'], run: () => { const f = judge(procs()); return { text: f.length ? f.map((x) => `- [${x.level}] ${x.rule} — ${x.detail}`).join('\n') : '✓ Aucun comportement suspect.', data: f }; } },
    { id: 'tuer', label: 'Arrêter un processus', what: 'Arrête un processus suspect', params: [{ key: 'pid', label: 'Numéro (PID)', kind: 'number', required: true }], grave: (i) => `arrêter le processus ${String(i.pid)}`, run: async (ctx, i) => { const pid = Number(i.pid); if (!Number.isInteger(pid) || pid < 2) throw new Error('PID invalide'); const r = await ctx.run('kill', ['-9', String(pid)], { sudo: true }); if (r.code) throw new Error(r.err.trim()); return { text: `✋ Processus ${pid} arrêté.` }; } },
  ],
  async view(ctx) {
    const f = judge(procs()), ports = (ctx.settings.ports as string[] | undefined) ?? [];
    return {
      subtitle: 'Analyse toutes les 30 secondes',
      kpis: [{ label: 'Découvertes en cours', value: String(f.length), tone: f.length ? 'mauvais' : 'bon' }, { label: 'Ports à l\'écoute', value: String(ports.length) }],
      sections: [{ kind: 'table', title: 'Comportements suspects', columns: ['Gravité', 'Règle', 'Détail'], empty: '✓ Rien de suspect en ce moment.', rows: f.map((x) => ({ cells: [x.level, x.rule, x.detail], tone: 'mauvais', actions: [{ action: 'tuer', label: 'Arrêter', input: { pid: x.pid } }] })) }],
      side: [{ kind: 'list', title: 'Ports à l\'écoute', items: ports.map((p) => ({ title: p })), empty: 'Lecture en attente.' }],
    };
  },
  watch: { every: 30, async run(ctx) {
    for (const f of judge(procs())) { ctx.alert({ level: f.level, title: `Skögul : ${f.rule}`, detail: f.detail, key: `${f.rule}:${f.pid}`, data: { pid: f.pid } }); ctx.emit('suspect', { règle: f.rule, pid: f.pid, détail: f.detail }); }
    const r = await ctx.run('ss', ['-tulnpH'], { timeoutMs: 10_000 });
    if (!r.code) {
      const now = listening(`x\n${r.out}`), was = ctx.settings.ports as string[] | undefined;
      if (was) for (const p of now) if (!was.includes(p)) { ctx.alert({ level: 'moyenne', title: `Nouveau port ouvert : ${p}`, key: `port:${p}` }); ctx.emit('port_ouvert', { port: p }); }
      ctx.saveSettings({ ports: now });
    }
    const cron = createHash('sha1').update(['/etc/crontab', ...(() => { try { return readdirSync('/etc/cron.d').map((f) => `/etc/cron.d/${f}`); } catch { return []; } })()].map(rd).join('\n')).digest('hex');
    if (ctx.settings.cron && ctx.settings.cron !== cron) ctx.alert({ level: 'haute', title: 'Tâches planifiées du système modifiées', detail: '/etc/crontab ou /etc/cron.d a changé.', key: `cron:${cron}` });
    ctx.saveSettings({ cron });
  } },
};
