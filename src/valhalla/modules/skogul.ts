// Némésis — comportements suspects des programmes : exécutables lancés depuis /tmp, programme effacé
// après lancement, shell ouvert par un serveur web, mineurs de cryptomonnaie, nouveaux ports ouverts,
// tâches planifiées modifiées. Une alerte par découverte, envoyée à Forseti.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { basename } from 'node:path';
import type { Module } from '../types.ts';
import { choixDePoste, PARAM_POSTE, posteDe, type Poste } from '../postes.ts';

const s = (x: unknown) => String(x ?? '').trim();
export interface Proc { pid: number; ppid: number; uid: number; name: string; exe: string; cmd: string }
const rd = (f: string) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
/** Les programmes en cours. Linux : /proc. macOS et BSD : la commande « ps ». Windows : pas encore lu (liste vide). */
export function procs(root = '/proc'): Proc[] {
  if (!existsSync(root)) return root === '/proc' && process.platform !== 'win32' ? psProcs() : [];
  const out: Proc[] = [];
  for (const d of readdirSync(root)) {
    if (!/^\d+$/.test(d)) continue;
    const st = rd(`${root}/${d}/status`); if (!st) continue;
    let exe = ''; try { exe = readlinkSync(`${root}/${d}/exe`); } catch { /* noyau ou droits */ }
    out.push({ pid: Number(d), ppid: Number(/^PPid:\s+(\d+)/m.exec(st)?.[1] ?? 0), uid: Number(/^Uid:\s+(\d+)/m.exec(st)?.[1] ?? 0), name: /^Name:\s+(.*)$/m.exec(st)?.[1] ?? '', exe, cmd: rd(`${root}/${d}/cmdline`).replace(/\0/g, ' ').trim().slice(0, 300) });
  }
  return out;
}
/** Sans /proc : deux appels à « ps », l'un pour le programme, l'autre pour sa ligne de commande (les chemins peuvent contenir des espaces). */
export function psProcs(run: (args: string[]) => string = (args) => spawnSync('ps', args, { encoding: 'utf8', timeout: 8000 }).stdout ?? ''): Proc[] {
  const cmds = new Map<number, string>(), out: Proc[] = [];
  for (const l of run(['-axo', 'pid=,args=']).split('\n')) { const m = /^\s*(\d+)\s+(.*)$/.exec(l); if (m) cmds.set(Number(m[1]), m[2].trim().slice(0, 300)); }
  for (const l of run(['-axo', 'pid=,ppid=,uid=,comm=']).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l); if (!m) continue;
    const exe = m[4].trim(); out.push({ pid: Number(m[1]), ppid: Number(m[2]), uid: Number(m[3]), name: basename(exe), exe: exe.startsWith('/') ? exe : '', cmd: cmds.get(Number(m[1])) ?? exe });
  }
  return out;
}
/** Ce qu'on demande à un autre poste, en une seule connexion : les programmes (« ps »), et sur Linux le vrai chemin de chacun (/proc). */
const SONDE = `ps -axo pid=,args= 2>/dev/null; echo ---PROG; ps -axo pid=,ppid=,uid=,comm= 2>/dev/null; echo ---EXE; for d in /proc/[0-9]*; do e=$(readlink "$d/exe" 2>/dev/null) && printf '%s\\t%s\\n' "\${d#/proc/}" "$e"; done 2>/dev/null; true`;
/** Lit la réponse d'un poste à la sonde : la liste des programmes, avec leur vrai chemin quand le poste l'a donné. Pur. */
export function lireSondeProcs(out: string): Proc[] {
  const [args = '', reste = ''] = out.split(/^---PROG$/m), [prog = '', exe = ''] = reste.split(/^---EXE$/m);
  const chemins = new Map<number, string>(); for (const l of exe.split('\n')) { const k = l.indexOf('\t'); if (k > 0 && /^\d+$/.test(l.slice(0, k))) chemins.set(Number(l.slice(0, k)), l.slice(k + 1).trim()); }
  return psProcs((a) => (a[1] === 'pid=,args=' ? args : prog)).map((p) => (chemins.has(p.pid) ? { ...p, exe: chemins.get(p.pid)!, name: p.name || basename(chemins.get(p.pid)!.replace(/ \(deleted\)$/, '')) } : p));
}
/** Les programmes en cours d'un autre poste (Linux ou Mac), lus par SSH ; `complet` : avec les droits d'administrateur (chemins de tous les comptes). */
export async function procsDistants(poste: Poste): Promise<{ procs: Proc[]; complet: boolean }> {
  let r = await poste.run('sh', ['-c', SONDE], { timeoutMs: 30_000, sudo: true }), complet = true;
  if (r.code !== 0 || !r.out.includes('---PROG')) { r = await poste.run('sh', ['-c', SONDE], { timeoutMs: 30_000 }); complet = false; }
  if (r.code !== 0 || !r.out.includes('---PROG')) throw new Error(`${poste.nom} n'a pas donné la liste de ses programmes${r.err.trim() ? ` : ${r.err.trim().split('\n').pop()!.slice(0, 160)}` : ''}`);
  // La sonde elle-même (sh, ps, sudo, la connexion) n'est pas un comportement suspect du poste.
  return { procs: lireSondeProcs(r.out).filter((p) => !p.cmd.includes('---PROG')), complet };
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
  id: 'skogul', name: 'Némésis', family: 'Sécurité',
  what: 'Surveille le comportement des programmes et signale ce qui n\'est pas normal.',
  does: ['programme lancé depuis /tmp ou /dev/shm', 'programme effacé après son lancement', 'shell ouvert par un serveur web (site piraté)', 'mineurs de cryptomonnaie', 'nouveau port ouvert sur la machine', 'tâches planifiées modifiées', 'arrêt d\'un processus suspect (avec ton accord)'],
  from: ['Falco'], upstream: ['falcosecurity/falco'],
  words: ['comportement', 'suspect', 'processus', 'processus suspect', 'mineur', 'crypto', 'shell', 'piraté', 'pirate', 'port ouvert', 'cron'],
  actions: [
    { id: 'analyser', label: 'Analyser maintenant', what: 'Passe tous les programmes en revue (de cette machine, ou d\'un autre poste Linux ou Mac)', read: true, external: true, params: [PARAM_POSTE], words: ['analyse', 'verifie', 'vérifie'], run: async (ctx, i) => {
      const poste = posteDe(ctx, i.poste);
      if (poste.local) { const f = judge(procs()); return { text: f.length ? f.map((x) => `- [${x.level}] ${x.rule} — ${x.detail}`).join('\n') : '✓ Aucun comportement suspect.', data: f }; }
      const d = await procsDistants(poste), f = judge(d.procs), note = d.complet ? '' : '\n(Sans les droits d\'administrateur sur ce poste : je ne vois pas d\'où sont lancés les programmes des autres comptes.)';
      return { text: `${poste.nom} · ${d.procs.length} programme(s) en cours\n${f.length ? f.map((x) => `- [${x.level}] ${x.rule} — ${x.detail}`).join('\n') : '✓ Aucun comportement suspect.'}${note}`, data: { poste: poste.nom, programmes: d.procs.length, decouvertes: f, complet: d.complet } };
    } },
    { id: 'tuer', label: 'Arrêter un processus', what: 'Arrête un processus suspect (sur cette machine, ou sur un autre poste)', params: [{ key: 'pid', label: 'Numéro (PID)', kind: 'number', required: true }, PARAM_POSTE], grave: (i) => `arrêter le processus ${String(i.pid)}${s(i.poste) ? ` sur ${s(i.poste)}` : ''}`, run: async (ctx, i) => {
      const pid = Number(i.pid); if (!Number.isInteger(pid) || pid < 2) throw new Error('PID invalide');
      const poste = posteDe(ctx, i.poste), r = await poste.run('kill', ['-9', String(pid)], { sudo: true }); if (r.code) throw new Error(r.err.trim() || 'arrêt refusé');
      return { text: `✋ Processus ${pid} arrêté${poste.local ? '' : ` sur ${poste.nom}`}.` };
    } },
  ],
  async view(ctx, q) {
    const P = choixDePoste(ctx, q);
    // Un autre poste (Linux ou Mac) choisi dans « Sur quel poste ? » : ses programmes, lus par SSH.
    if (P.actuel) {
      const poste = posteDe(ctx, P.actuel);
      try {
        const d = await procsDistants(poste), fd = judge(d.procs);
        return { postes: P, subtitle: `${poste.nom} · ${d.procs.length} programme(s) en cours · lu par SSH${d.complet ? '' : ' · sans les droits d\'administrateur : je ne vois pas d\'où sont lancés les programmes des autres comptes'}`,
          kpis: [{ label: 'Découvertes en cours', value: String(fd.length), tone: fd.length ? 'mauvais' : 'bon' }, { label: 'Programmes en cours', value: String(d.procs.length) }],
          sections: [{ kind: 'table', title: `Comportements suspects sur ${poste.nom}`, columns: ['Gravité', 'Règle', 'Détail'], empty: '✓ Rien de suspect en ce moment.', rows: fd.map((x) => ({ cells: [x.level, x.rule, x.detail], tone: 'mauvais', actions: [{ action: 'tuer', label: 'Arrêter', input: { pid: x.pid, poste: poste.id } }] })) }] };
      } catch (err) { return { postes: P, subtitle: `${poste.nom} ne répond pas`, sections: [{ kind: 'text', title: `${poste.nom} ne répond pas`, tone: 'mauvais', text: `${(err as Error).message}. Vérifie qu'il est allumé et sur le même réseau, puis rouvre la page.` }] }; }
    }
    const f = judge(procs()), ports = (ctx.settings.ports as string[] | undefined) ?? [];
    return {
      postes: P,
      subtitle: process.platform === 'win32' ? 'Sur Windows, je ne lis pas encore les programmes en cours : cette page reste vide.' : 'Analyse toutes les 30 secondes',
      kpis: [{ label: 'Découvertes en cours', value: String(f.length), tone: f.length ? 'mauvais' : 'bon' }, { label: 'Ports à l\'écoute', value: String(ports.length) }],
      sections: [{ kind: 'table', title: 'Comportements suspects', columns: ['Gravité', 'Règle', 'Détail'], empty: '✓ Rien de suspect en ce moment.', rows: f.map((x) => ({ cells: [x.level, x.rule, x.detail], tone: 'mauvais', actions: [{ action: 'tuer', label: 'Arrêter', input: { pid: x.pid } }] })) }],
      side: [{ kind: 'list', title: 'Ports à l\'écoute', items: ports.map((p) => ({ title: p })), empty: 'Lecture en attente.' }],
    };
  },
  watch: { every: 30, async run(ctx) {
    for (const f of judge(procs())) { ctx.alert({ level: f.level, title: `Némésis : ${f.rule}`, detail: f.detail, key: `${f.rule}:${f.pid}`, data: { pid: f.pid } }); ctx.emit('suspect', { règle: f.rule, pid: f.pid, détail: f.detail }); }
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
