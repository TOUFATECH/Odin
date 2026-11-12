// Hringhorni — les commandes : run, ps, stop, start, restart, rm, logs, exec, pull, images, rmi, inspect.
// Mêmes habitudes que les moteurs connus (-d, -p, -v, -e, --name, --restart…), dans le terminal (« odin run … »)
// comme dans la discussion avec Odin (« run nginx », « ps », « logs jf »).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Engine, mo, pctOf, restartOf, type Ctr, type Progress } from './engine.ts';
import { defineService, removeService, services, startService, stopService, tuneService } from './services.ts';

const ALIAS: Record<string, string> = { publish: 'p', volume: 'v', env: 'e', detach: 'd', all: 'a', quiet: 'q', follow: 'f', force: 'f', interactive: 'i', tty: 't', user: 'u', workdir: 'w', memory: 'm', net: 'network', time: 'timeout' };
export const VALUES = new Set(['name', 'p', 'v', 'e', 'env-file', 'restart', 'm', 'cpus', 'u', 'w', 'entrypoint', 'hostname', 'network', 'timeout', 'tail', 'label', 'min', 'max', 'cible-cpu', 'visiteurs', 'budget', 'sante', 'grandir']);
const MULTI = new Set(['p', 'v', 'e', 'label']);
export interface Parsed { flags: Record<string, boolean>; opts: Record<string, string>; multi: Record<string, string[]>; rest: string[] }

/** Lit les options jusqu'au premier mot qui n'en est pas une (l'image, ou le conteneur) : la suite est la commande. */
export function parseArgs(args: string[], values = VALUES): Parsed {
  const p: Parsed = { flags: {}, opts: {}, multi: {}, rest: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { p.rest.push(...args.slice(i + 1)); break; }
    if (!a.startsWith('-') || a === '-') { p.rest.push(...args.slice(i)); break; }
    let key: string, val: string | undefined;
    if (a.startsWith('--')) { const eq = a.indexOf('='); key = eq > 0 ? a.slice(2, eq) : a.slice(2); val = eq > 0 ? a.slice(eq + 1) : undefined; key = ALIAS[key] ?? key; }
    else { key = a.slice(1, 2); val = a.length > 2 ? a.slice(2) : undefined; if (!values.has(key) && val) { for (const ch of a.slice(1)) p.flags[ALIAS[ch] ?? ch] = true; continue; } }
    if (values.has(key)) {
      const v = val ?? args[++i]; if (v === undefined) throw new Error(`l'option ${a} attend une valeur`);
      if (MULTI.has(key)) (p.multi[key] ??= []).push(v); else p.opts[key] = v;
    } else p.flags[key] = true;
  }
  return p;
}
/** Découpe une ligne comme un terminal (guillemets simples et doubles). */
export function splitLine(s: string): string[] {
  const out: string[] = []; let cur = '', q: string | null = null, has = false;
  for (const ch of s) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === '\'') { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += ch;
  }
  if (q) throw new Error('guillemet non fermé');
  if (cur || has) out.push(cur);
  return out;
}
export const VERBS = ['run', 'ps', 'stop', 'start', 'restart', 'rm', 'logs', 'log', 'exec', 'pull', 'images', 'image', 'rmi', 'inspect', 'service', 'scale', 'resize'];
const ago = (iso?: string) => { if (!iso) return ''; const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} j`; };
const pad = (rows: string[][]) => { const w = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length))); return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join('  ')).join('\n'); };
export function psTable(l: Ctr[]): string {
  if (!l.length) return 'Aucun conteneur.';
  return pad([['ID', 'NOM', 'IMAGE', 'ÉTAT', 'PORTS', 'COMMANDE'], ...l.map((c) => [c.id.slice(0, 12), c.spec.name, c.spec.image, `${c.state.status}${c.state.status === 'en marche' ? ` (${ago(c.state.startedAt)})` : c.state.exitCode !== undefined ? ` (code ${c.state.exitCode})` : ''}`, c.spec.ports.map((p) => `${p.host}→${p.inner}${p.proto === 'udp' ? '/udp' : ''}`).join(', '), c.spec.cmd.join(' ').slice(0, 40)])]);
}

export interface CliIO { out(s: string): void; err(s: string): void; interactive?: boolean; tty?: boolean }
/** La barre de progression du terminal : téléchargement, montage, démarrage. */
export function bar(p: Progress, withStart = true, width = 28): string {
  const pct = pctOf(p, withStart), full = Math.round((pct / 100) * width);
  const what = p.phase === 'télécharger' ? `Téléchargement ${mo(p.done)} / ${mo(p.total)}` : p.phase === 'monter' ? `Montage${p.layers ? ` (couche ${p.layer || 1}/${p.layers})` : ''}` : p.phase === 'démarrer' ? 'Démarrage' : 'Terminé';
  return `[${'█'.repeat(full)}${'░'.repeat(width - full)}] ${String(pct).padStart(3)} % ${what}`;
}
function barWriter(io: CliIO, withStart = true) {
  let last = '', lastAt = 0, lastPhase = '';
  return (p: Progress) => {
    const line = bar(p, withStart), now = Date.now();
    if (io.tty) { if (line !== last && (now - lastAt > 80 || p.phase !== lastPhase)) { process.stderr.write(`\r${line}\x1b[K`); last = line; lastAt = now; } if (p.phase === 'fini') process.stderr.write('\n'); }
    else if (p.phase !== lastPhase || now - lastAt > 3000) { io.err(line); lastAt = now; }
    lastPhase = p.phase;
  };
}
/** Toutes les commandes. Rend le code de sortie. */
export async function cli(argv: string[], io: CliIO = { out: (s) => console.log(s), err: (s) => console.error(s), interactive: true, tty: Boolean(process.stderr.isTTY) }, eng = new Engine()): Promise<number> {
  const [verb0, ...args] = argv, verb = verb0 === 'log' ? 'logs' : verb0 === 'image' ? 'images' : verb0;
  try {
    switch (verb) {
      case 'pull': { const [name] = parseArgs(args).rest; if (!name) throw new Error('pull <image>'); const img = await eng.pull(name, () => {}, barWriter(io, false)); io.out(`${img.names.at(-1)} prête · ${img.id.slice(0, 12)} · ${mo(img.size)}`); return 0; }
      case 'images': { const l = eng.images(); io.out(l.length ? pad([['IMAGE', 'ID', 'TAILLE', 'RÉCUPÉRÉE'], ...l.flatMap((i) => i.names.map((n) => [n, i.id.slice(0, 12), `${(i.size / 1e6).toFixed(1)} Mo`, `il y a ${ago(i.pulled)}`]))]) : 'Aucune image.'); return 0; }
      case 'rmi': { const a = parseArgs(args); for (const n of a.rest) io.out(`supprimée : ${(await eng.rmi(n, !!a.flags.f)).names.join(', ')}`); return 0; }
      case 'ps': { const a = parseArgs(args); const l = eng.ps(!!a.flags.a); io.out(a.flags.q ? l.map((c) => c.id.slice(0, 12)).join('\n') : psTable(l)); return 0; }
      case 'run': {
        const a = parseArgs(args), [image, ...cmd] = a.rest; if (!image) throw new Error('run [options] <image> [commande…]');
        if (a.flags.t && !a.flags.d) io.err('(terminal interactif pas encore pris en charge : le conteneur tourne, utilise « exec » pour un shell)');
        const env: Record<string, string> = {};
        for (const f of a.opts['env-file'] ? [a.opts['env-file']] : []) for (const l of readFileSync(f, 'utf8').split('\n')) { const m = /^\s*([A-Za-z_]\w*)=(.*)$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
        for (const e of a.multi.e ?? []) { const i = e.indexOf('='); if (i > 0) env[e.slice(0, i)] = e.slice(i + 1); else if (process.env[e] !== undefined) env[e] = process.env[e]!; }
        const labels = Object.fromEntries((a.multi.label ?? []).map((l) => [l.split('=')[0], l.split('=').slice(1).join('=')]));
        const net = a.opts.network === 'host' || a.opts.network === 'hote' ? 'hote' : a.opts.network ? 'pont' : undefined;
        if (!eng.findImage(image)) await eng.pull(image, () => {}, barWriter(io));
        const c = await eng.run({ image, name: a.opts.name, cmd, entrypoint: a.opts.entrypoint ? splitLine(a.opts.entrypoint) : undefined, env, ports: (a.multi.p ?? []).join(','), mounts: (a.multi.v ?? []).join(','), restart: a.opts.restart ? restartOf(a.opts.restart) : undefined, memory: a.opts.m, cpus: a.opts.cpus, user: a.opts.u, workdir: a.opts.w, hostname: a.opts.hostname, network: net, rm: !!a.flags.rm, labels });
        if (a.flags.d || !io.interactive) { io.out(a.flags.d ? c.id.slice(0, 12) : `${c.spec.name} démarré (${c.id.slice(0, 12)})`); return 0; }
        return follow(eng, c.id, io, true);
      }
      case 'start': case 'restart': case 'stop': {
        const a = parseArgs(args, new Set([...VALUES, 't'])); if (!a.rest.length) throw new Error(`${verb} <conteneur…>`);
        for (const n of a.rest) { const c = verb === 'start' ? await eng.start(n) : verb === 'restart' ? await eng.restart(n) : await eng.stop(n, Number(a.opts.timeout ?? a.opts.t ?? 10)); io.out(c.spec.name); }
        return 0;
      }
      case 'rm': { const a = parseArgs(args); if (!a.rest.length) throw new Error('rm [-f] <conteneur…>'); for (const n of a.rest) io.out((await eng.rm(n, !!a.flags.f)).name); return 0; }
      case 'logs': {
        const a = parseArgs(args), [n] = a.rest; if (!n) throw new Error('logs [-f] [--tail N] <conteneur>');
        const lines = eng.logs(n, a.opts.tail ? Number(a.opts.tail) : 500); for (const l of lines) (l.stream === 'e' ? io.err : io.out)(l.text);
        return a.flags.f ? follow(eng, eng.find(n).id, io, false) : 0;
      }
      case 'exec': {
        const a = parseArgs(args), [n, ...cmd] = a.rest; if (!n || !cmd.length) throw new Error('exec [-u utilisateur] [-w dossier] <conteneur> <commande…>');
        const env = Object.fromEntries((a.multi.e ?? []).map((e) => [e.split('=')[0], e.split('=').slice(1).join('=')]));
        const x = await eng.execArgs(n, cmd, { user: a.opts.u, workdir: a.opts.w, env });
        if (!io.interactive) { const r = await new Promise<{ code: number; out: string }>((res) => { const p = spawn(x.cmd, x.args, { env: x.env }); let o = ''; p.stdout.on('data', (b) => { o += b; }); p.stderr.on('data', (b) => { o += b; }); p.on('close', (code) => res({ code: code ?? 1, out: o })); }); io.out(r.out.trimEnd()); return r.code; }
        return new Promise((res) => spawn(x.cmd, x.args, { env: x.env, stdio: 'inherit' }).on('close', (c) => res(c ?? 1)));
      }
      case 'inspect': { const [n] = parseArgs(args).rest; io.out(JSON.stringify(eng.inspect(n), null, 2)); return 0; }
      case 'scale': return cli(['service', 'scale', ...args], io, eng);
      case 'resize': {
        const a = parseArgs(args), [n] = a.rest; if (!n || (!a.opts.m && !a.opts.cpus && !a.opts.grandir)) throw new Error('resize <conteneur> [--memory 2g] [--cpus 2] [--grandir 1g-8g/1-4|non]');
        const c = await eng.resize(n, { memory: a.opts.m, cpus: a.opts.cpus, grow: a.opts.grandir });
        io.out(`${c.spec.name} : ${c.spec.memory ?? 'mémoire libre'} · ${c.spec.cpus ?? 'tous les'} cœurs${c.spec.labels['odin.grandir'] ? ` · grandit tout seul (${c.spec.labels['odin.grandir']})` : ''}`); return 0;
      }
      case 'service': {
        const [sub, ...rest] = args, a = parseArgs(rest);
        const num = (k: string) => (a.opts[k] !== undefined ? Number(a.opts[k]) : undefined);
        if (!sub || sub === 'ls' || sub === 'ps') {
          const l = services(eng); io.out(l.length ? pad([['SERVICE', 'IMAGE', 'ÉTAT', 'COPIES', 'MIN-MAX', 'VISITEURS', 'PORTS', 'POURQUOI'], ...l.map(({ spec: sp, state: st }) => [sp.name, sp.image, st.status, `${st.replicas.filter((r) => r.healthy).length}/${st.replicas.length}`, `${sp.scale.min}-${sp.scale.max}`, String(st.active), sp.ports.map((p) => `${p.host}→${p.inner}`).join(', '), st.reason])]) : 'Aucun service.'); return 0;
        }
        if (sub === 'create' || sub === 'run') {
          const [image, ...cmd] = a.rest, name = a.opts.name; if (!image || !name) throw new Error('service create --name N -p 8080:80 [--min 2] [--max 10] [--cpus 1] [--memory 512m] [--cible-cpu 70] [--visiteurs 100] [--budget 80] [--sante /] <image> [cmd…]');
          const env: Record<string, string> = {}; for (const e of a.multi.e ?? []) { const i = e.indexOf('='); if (i > 0) env[e.slice(0, i)] = e.slice(i + 1); }
          if (!eng.findImage(image)) await eng.pull(image, () => {}, barWriter(io));
          defineService(eng, { name, image, cmd: cmd.length ? cmd : undefined, env, ports: (a.multi.p ?? []).join(','), mounts: (a.multi.v ?? []).join(','), cpus: a.opts.cpus, memory: a.opts.m, min: num('min'), max: num('max'), cpu: num('cible-cpu'), conns: num('visiteurs'), budgetPct: num('budget'), health: a.opts.sante });
          const st = await startService(eng, name); io.out(`${name} : ${st.replicas.filter((r) => r.healthy).length} copie(s) prête(s), mise à l'échelle automatique active.`); return 0;
        }
        const [n, range] = a.rest; if (!n) throw new Error(`service ${sub} <nom>`);
        if (sub === 'start') { const st = await startService(eng, n); io.out(`${n} : ${st.status}`); return 0; }
        if (sub === 'stop') { await stopService(eng, n); io.out(`${n} arrêté`); return 0; }
        if (sub === 'rm') { await removeService(eng, n); io.out(`${n} supprimé`); return 0; }
        if (sub === 'scale') {
          const m = /^(\d+)(?:-(\d+))?$/.exec(range ?? ''); if (!m && !a.opts.min && !a.opts.max) throw new Error('scale <service> <min-max> (ex. 2-10)');
          const sp = tuneService(eng, n, { min: m ? Number(m[1]) : num('min'), max: m ? Number(m[2] ?? m[1]) : num('max'), cpu: num('cible-cpu'), conns: num('visiteurs'), budgetPct: num('budget') });
          io.out(`${n} : de ${sp.scale.min} à ${sp.scale.max} copies · processeur visé ${sp.scale.cpu} % · ${sp.scale.conns} visiteurs par copie`); return 0;
        }
        throw new Error('service ls | create | start | stop | rm | scale');
      }
      default: io.out(HELP); return verb ? 1 : 0;
    }
  } catch (e) { io.err(`✗ ${(e as Error).message}`); return 1; }
}
/** Suit le journal en direct jusqu'à l'arrêt du conteneur (Ctrl+C : on arrête de suivre, il continue). */
async function follow(eng: Engine, id: string, io: CliIO, fromStart: boolean): Promise<number> {
  let seen = fromStart ? 0 : eng.logs(id, 100000).length;
  for (;;) {
    const l = eng.logs(id, 100000); for (const x of l.slice(seen)) (x.stream === 'e' ? io.err : io.out)(x.text); seen = l.length;
    let st; try { st = eng.find(id).state; } catch { return 0; }
    if (st.status !== 'en marche' && st.status !== 'redémarre') { const end = eng.logs(id, 100000); for (const x of end.slice(seen)) (x.stream === 'e' ? io.err : io.out)(x.text); return st.exitCode ?? 0; }
    await new Promise((r) => setTimeout(r, 300));
  }
}
export const HELP = `Hringhorni, le moteur de conteneurs d'Odin (sans démon, sans Docker ni Podman) :
  pull <image>                      récupère une image (Docker Hub, GHCR, Quay, registre privé)
  images · rmi <image>              images présentes · supprimer une image
  run [options] <image> [cmd…]      crée et démarre un conteneur
      -d  --name N  -p 8080:80[/udp]  -v /dossier:/dans[:ro]  -e CLE=valeur  --env-file f
      --restart no|always|on-failure|unless-stopped  --memory 2g  --cpus 1.5  -u utilisateur
      -w dossier  --entrypoint cmd  --hostname h  --network pont|hote  --rm
  ps [-a]                           conteneurs (en marche, ou tous)
  start · stop · restart · rm [-f]  <conteneur…>
  logs [-f] [--tail N] <conteneur>  journal
  exec [-u u] [-w d] <conteneur> <cmd…>  lancer une commande dedans
  inspect <conteneur|image>         tout le détail
  resize <conteneur> --memory 2g --cpus 2 [--grandir 1g-8g/1-4]   sans l'arrêter ; « grandir » : tout seul
Mise à l'échelle automatique (plusieurs copies derrière un répartiteur) :
  service create --name site -p 8080:80 [--min 2] [--max 10] [--cpus 1] [--memory 512m]
                 [--cible-cpu 70] [--visiteurs 100] [--budget 80] [--sante /] <image>
  service ls · service start|stop|rm <nom> · scale <service> 2-10`;
