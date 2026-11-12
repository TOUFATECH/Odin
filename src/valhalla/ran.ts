// Rán : les paquets réseau, lus en entier et décodés couche par couche (voir ran-dissect.ts), comme Wireshark.
// Deux portées : une machine (son adresse IP) ou tout le réseau. Points de capture :
// - la machine d'Odin (tout ce qui passe par sa carte réseau) ;
// - chaque machine où Odin a un accès (Réglages → Droits et machines), par SSH : tout son trafic. Un hôte
//   Proxmox voit ainsi tout ce qu'échangent ses machines virtuelles ; un routeur Linux, tout le réseau.
// Sur un réseau avec switch ou box, une machine sans point de capture n'est vue que dans ses échanges avec un
// point de capture et dans ce qu'elle diffuse — l'interface le dit. Pause : plus aucune lecture ; « Lis les
// paquets » : la lecture reprend. Les paquets sont gardés 7 jours (250 000 au plus), avec leur contenu brut
// (4 ko au plus par paquet), dans ran.db, sur la machine d'Odin seulement.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { askpassScript, listMachines, sshArgs, withAdmin, type Machine } from '../machines/access.ts';
import { PcapReader, hexdump, isBroadcast, isPrivate, type Decoded, type Layer } from './ran-dissect.ts';

export interface Packet { id: number; at: number; src: string; dst: string; sport?: number; dport?: number; proto: string; app: string; site: string; len: number; info: string; way: string; origin: string }
export interface PacketDetail extends Packet { layers: Layer[]; hex: string; story: string }
export type Scope = string; // « réseau » ou une adresse IP
export const NETWORK = 'réseau';

// ---------- Historique ----------
let db: DatabaseSync | undefined, dbHome = '';
function store(home: string): DatabaseSync {
  if (db && dbHome === home) return db;
  db?.close(); dbHome = home;
  db = new DatabaseSync(join(home, 'ran.db'));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
    DROP TABLE IF EXISTS packets;
    CREATE TABLE IF NOT EXISTS pk (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, src TEXT, dst TEXT, sport INTEGER, dport INTEGER, proto TEXT, app TEXT, site TEXT, len INTEGER, info TEXT, way TEXT, origin TEXT, story TEXT, layers TEXT, raw BLOB);
    CREATE INDEX IF NOT EXISTS pk_at ON pk(at);
    CREATE INDEX IF NOT EXISTS pk_src ON pk(src, at);
    CREATE INDEX IF NOT EXISTS pk_dst ON pk(dst, at);
    CREATE TABLE IF NOT EXISTS names (ip TEXT PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL);`);
  return db;
}
export const KEEP_DAYS = 7, KEEP_MAX = 250_000, RAW_MAX = 4096;
const cols = 'id, at, src, dst, sport, dport, proto, app, site, len, info, way, origin';
const row = (r: Record<string, unknown>): Packet => ({ id: Number(r.id), at: Number(r.at), src: String(r.src ?? ''), dst: String(r.dst ?? ''), sport: r.sport == null ? undefined : Number(r.sport), dport: r.dport == null ? undefined : Number(r.dport), proto: String(r.proto ?? ''), app: String(r.app ?? ''), site: String(r.site ?? ''), len: Number(r.len ?? 0), info: String(r.info ?? ''), way: String(r.way ?? ''), origin: String(r.origin ?? '') });

/** Garde des paquets décodés ; rend leur forme courte (avec leur numéro). */
export function save(home: string, list: Array<Decoded & { origin: string }>): Packet[] {
  if (!list.length) return [];
  const d = store(home), now = Date.now();
  const ins = d.prepare('INSERT INTO pk(at, src, dst, sport, dport, proto, app, site, len, info, way, origin, story, layers, raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const nm = d.prepare('INSERT INTO names(ip, name, at) VALUES (?,?,?) ON CONFLICT(ip) DO UPDATE SET name = excluded.name, at = excluded.at');
  const out: Packet[] = [];
  d.exec('BEGIN');
  try {
    for (const p of list) {
      for (const [ip, name] of p.names) if (isIP(ip) && name && name.length < 200) nm.run(ip, name, now);
      // Le site d'un paquet vers Internet : son nom appris plus tôt (réponse DNS, SNI) quand il ne le porte pas
      if (!p.site) { const far = !isPrivate(p.dst) && !isBroadcast(p.dst) ? p.dst : !isPrivate(p.src) ? p.src : ''; if (far) p.site = (d.prepare('SELECT name FROM names WHERE ip = ?').get(far) as { name?: string } | undefined)?.name ?? ''; }
      const r = ins.run(p.at, p.src, p.dst, p.sport ?? null, p.dport ?? null, p.proto, p.app, p.site, p.len, p.info, p.way, p.origin, p.story ?? '', JSON.stringify(p.layers), p.raw.subarray(0, RAW_MAX));
      out.push({ id: Number(r.lastInsertRowid), at: p.at, src: p.src, dst: p.dst, sport: p.sport, dport: p.dport, proto: p.proto, app: p.app, site: p.site, len: p.len, info: p.info, way: p.way, origin: p.origin });
    }
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return out;
}
export function prune(home: string, now = Date.now()): number {
  const d = store(home);
  let n = Number(d.prepare('DELETE FROM pk WHERE at < ?').run(now - KEEP_DAYS * 864e5).changes);
  const c = (d.prepare('SELECT COUNT(*) n FROM pk').get() as { n: number }).n;
  if (c > KEEP_MAX) n += Number(d.prepare('DELETE FROM pk WHERE id IN (SELECT id FROM pk ORDER BY id LIMIT ?)').run(c - KEEP_MAX).changes);
  d.prepare('DELETE FROM names WHERE at < ?').run(now - 30 * 864e5);
  return n;
}
function filter(ip: string | undefined, q: string, since?: number, peer?: string): { w: string; a: Array<string | number> } {
  const where: string[] = [], a: Array<string | number> = [];
  if (ip) { where.push('(src = ? OR dst = ?)'); a.push(ip, ip); }
  if (peer) { where.push('(src = ? OR dst = ?)'); a.push(peer, peer); }
  if (since) { where.push('at >= ?'); a.push(since); }
  q = q.trim().toLowerCase();
  if (q) { where.push("(LOWER(proto) LIKE ? OR LOWER(app) LIKE ? OR LOWER(site) LIKE ? OR src LIKE ? OR dst LIKE ? OR LOWER(info) LIKE ? OR CAST(sport AS TEXT) = ? OR CAST(dport AS TEXT) = ?)"); a.push(...Array(6).fill(`%${q}%`), q, q); }
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', a };
}
/** Les paquets gardés (d'une machine, ou de tout le réseau), les plus récents d'abord, avec quelques chiffres. */
export function history(home: string, ip: string | undefined, o: { limit?: number; q?: string; since?: number; peer?: string } = {}) {
  const d = store(home), lim = Math.min(2000, Math.max(1, o.limit ?? 300));
  const { w, a } = filter(ip, o.q ?? '', o.since, o.peer);
  const packets = (d.prepare(`SELECT ${cols} FROM pk ${w} ORDER BY id DESC LIMIT ?`).all(...a, lim) as Array<Record<string, unknown>>).map(row);
  const t = d.prepare(`SELECT COUNT(*) n, MIN(at) a, MAX(at) b, SUM(len) bytes FROM pk ${w}`).get(...a) as { n: number; a: number | null; b: number | null; bytes: number | null };
  const apps = d.prepare(`SELECT COALESCE(NULLIF(app,''), proto) app, COUNT(*) n, SUM(len) bytes FROM pk ${w} GROUP BY 1 ORDER BY n DESC LIMIT 15`).all(...a) as Array<{ app: string; n: number; bytes: number }>;
  const sites = d.prepare(`SELECT site, COUNT(*) n, SUM(len) bytes FROM pk ${w ? `${w} AND` : 'WHERE'} site <> '' GROUP BY site ORDER BY n DESC LIMIT 20`).all(...a) as Array<{ site: string; n: number; bytes: number }>;
  return { packets, total: t.n, bytes: t.bytes ?? 0, first: t.a ?? undefined, last: t.b ?? undefined, apps, sites };
}
/** Un paquet en entier : ses couches (OSI), son contenu brut et ce qui se passe. */
export function packet(home: string, id: number): PacketDetail | undefined {
  const r = store(home).prepare(`SELECT ${cols}, story, layers, raw FROM pk WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) return undefined;
  let layers: Layer[] = []; try { layers = JSON.parse(String(r.layers)); } catch { /* ancien format */ }
  return { ...row(r), layers, story: String(r.story ?? ''), hex: hexdump(r.raw as Uint8Array) };
}
/** Qui parle à qui : une ligne par sens (de → vers), avec ses applis, ses sites, ses paquets et ses octets. */
export function flows(home: string, ip: string | undefined, o: { since?: number; q?: string } = {}) {
  const { w, a } = filter(ip, o.q ?? '', o.since ?? Date.now() - 24 * 3600e3);
  const d = store(home);
  const list = d.prepare(`SELECT src, dst, COUNT(*) n, SUM(len) bytes, MAX(at) last, GROUP_CONCAT(DISTINCT COALESCE(NULLIF(app,''), proto)) apps, MAX(site) site FROM pk ${w} GROUP BY src, dst ORDER BY n DESC LIMIT 600`).all(...a) as Array<{ src: string; dst: string; n: number; bytes: number; last: number; apps: string; site: string | null }>;
  const hosts = [...new Set(list.flatMap((x) => [x.src, x.dst]))].filter(Boolean);
  const names = new Map<string, string>();
  for (const h of hosts) { const r = d.prepare('SELECT name FROM names WHERE ip = ?').get(h) as { name?: string } | undefined; if (r?.name) names.set(h, r.name); }
  return { flows: list.map((x) => ({ ...x, apps: String(x.apps ?? '').split(',').filter(Boolean).slice(0, 6), site: x.site ?? '' })), names: Object.fromEntries(names) };
}
export function clear(home: string, ip?: string): number {
  const d = store(home);
  return Number((ip ? d.prepare('DELETE FROM pk WHERE src = ? OR dst = ?').run(ip, ip) : d.prepare('DELETE FROM pk').run()).changes);
}

// ---------- Capture ----------
export interface Source { label: string; machine?: Machine }
interface Session { scope: Scope; procs: Array<{ src: Source; proc?: ChildProcess; error?: string; count: number }>; listeners: Set<(p: Packet[]) => void>; status: Set<(s: string) => void>; recording: boolean; buf: Array<Decoded & { origin: string }>; until: number; seen: Map<string, number>; dropped: number }
const sessions = new Map<Scope, Session>();
let paused = false;
const MAX_PER_SECOND = 400;
let ownPort = 0;
/** Port de l'interface web d'Odin : ses propres échanges avec le navigateur ne sont jamais capturés (sinon le direct se capturerait lui-même). */
export function setOwnPort(p: number): void { ownPort = p; }

/** Machine du coffre qui correspond à cette adresse (ou à ce nom). */
export function machineFor(home: string, ip: string, hostname?: string): Machine | undefined {
  const hosts = new Set([ip, hostname, hostname?.replace(/\.(local|lan|home|box)$/i, '')].filter(Boolean).map((x) => String(x).toLowerCase()));
  return listMachines(home).find((m) => hosts.has(m.host.toLowerCase().replace(/^\[|\]$/g, '')));
}
/** Points de capture d'une portée : la machine elle-même si Odin y a accès, sinon Odin ; tout le réseau : Odin + chaque machine accessible. */
export function sourcesFor(home: string, scope: Scope, hostname?: string): Source[] {
  if (scope === NETWORK) return [{ label: 'Odin' }, ...listMachines(home).map((m) => ({ label: m.label, machine: m }))];
  const m = machineFor(home, scope, hostname);
  return m ? [{ label: m.label, machine: m }] : [{ label: 'Odin' }];
}
export const hasTcpdump = () => process.platform !== 'win32' && spawnSync('sh', ['-c', 'command -v tcpdump || [ -x /usr/sbin/tcpdump ] || [ -x /usr/bin/tcpdump ]'], { stdio: 'ignore' }).status === 0;
export function problem(err: string): string | undefined {
  if (/not found|introuvable|No such file|command not found/i.test(err)) return 'tcpdump n\'est pas installé. Sur la machine : « sudo apt install tcpdump » (Debian, Ubuntu, Proxmox) ou « sudo dnf install tcpdump ».';
  if (/password is required|a terminal is required|sudo: a password|Sorry, try again|not in the sudoers/i.test(err)) return 'Il faut les droits administrateur pour lire les paquets. Réglages → Droits et machines.';
  if (/Operation not permitted|permission/i.test(err)) return 'La capture des paquets demande les droits administrateur (ou la capacité « cap_net_raw » dans un conteneur).';
  if (/Permission denied \(publickey|Connection refused|timed out|Could not resolve|No route/i.test(err)) return `Connexion SSH impossible : ${err.trim().split('\n').pop()}`;
  return undefined;
}
/** Filtre tcpdump : la portée, sans les échanges de l'interface d'Odin avec le navigateur. */
export function bpf(scope: Scope): string {
  const parts: string[] = [];
  if (scope !== NETWORK) parts.push(`host ${scope}`);
  if (ownPort) parts.push(`not tcp port ${ownPort}`);
  return parts.join(' and ');
}

function launch(home: string, scope: Scope, src: Source): ChildProcess {
  const args = `-U -w - -s 0 -nn -i any`;
  const filt = bpf(scope);
  if (src.machine) {
    const m = src.machine;
    // Sur la machine : sans la connexion SSH de la capture elle-même
    const ssh = `not (host \${SSH_CLIENT%% *} and tcp port \${SSH_CLIENT##* })`;
    const cmd = `F="${filt}"; F="\${F:+($F) and }${ssh}"; exec sudo -S -p '' tcpdump ${args} "$F"`;
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (m.password) Object.assign(env, { SSH_ASKPASS: askpassScript(home), SSH_ASKPASS_REQUIRE: 'force', DISPLAY: env.DISPLAY || ':0', ODIN_ASKPASS_SECRET: m.password });
    const p = spawn('ssh', sshArgs(home, m, ['-T']).concat(cmd), { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const pw = m.sudoPassword ?? m.password; p.stdin.end(pw ? `${pw}\n` : '');
    return p;
  }
  const w = withAdmin(`sudo tcpdump ${args}${filt ? ` '${filt}'` : ''}`, home);
  return spawn('sh', ['-c', `exec ${w.command}`], { env: { ...process.env, ...w.env }, stdio: ['ignore', 'pipe', 'pipe'] });
}
function begin(home: string, s: Session, slot: Session['procs'][number]): void {
  if (paused) return;
  const p = launch(home, s.scope, slot.src); slot.proc = p; slot.error = undefined;
  const reader = new PcapReader(slot.src.label);
  let second = 0, inSecond = 0, err = '';
  p.stdout?.on('data', (d: Buffer) => {
    let list: Decoded[] = [];
    try { list = reader.push(d); } catch (e) { err += (e as Error).message; p.kill('SIGTERM'); return; }
    for (const pk of list) {
      const sec = Math.floor(pk.at / 1000); if (sec !== second) { second = sec; inSecond = 0; }
      if (++inSecond > MAX_PER_SECOND) { s.dropped++; continue; }
      // Un même paquet vu par deux points de capture (Odin et l'hôte Proxmox, par exemple) n'est gardé qu'une fois
      const k = `${pk.src}|${pk.dst}|${pk.sport}|${pk.dport}|${pk.len}|${Buffer.from(pk.raw.subarray(Math.max(0, pk.raw.length - 24))).toString('base64')}`;
      const was = s.seen.get(k); if (was && pk.at - was < 1500) continue; s.seen.set(k, pk.at);
      if (s.scope !== NETWORK && pk.src !== s.scope && pk.dst !== s.scope && pk.proto !== 'ARP') continue;
      slot.count++; s.buf.push(Object.assign(pk, { origin: slot.src.label }));
    }
    if (s.seen.size > 20000) s.seen.clear();
  });
  p.stderr?.on('data', (d: Buffer) => { const t = d.toString(); if (!/listening on|verbose output suppressed|data link type|packets? (captured|received|dropped)/.test(t)) err = `${err}${t}`.slice(-2000); });
  p.on('error', (e) => { err += e.message; });
  p.on('close', (code) => {
    if (slot.proc !== p) return;
    slot.proc = undefined;
    if (code && slot.count === 0) { slot.error = problem(err) ?? (err.trim().split('\n').slice(-2).join(' ') || `tcpdump s'est arrêté (code ${code})`); for (const f of s.status) f(`${slot.src.label} : ${slot.error}`); }
    if (sessions.get(s.scope) === s && !paused && (s.recording || s.listeners.size) && !slot.error) setTimeout(() => { if (sessions.get(s.scope) === s && !slot.proc && !paused) begin(home, s, slot); }, 10_000);
  });
}
function flush(home: string, s: Session): void {
  if (!s.buf.length) return;
  const b = s.buf; s.buf = [];
  let saved: Packet[] = [];
  try { saved = save(home, b); } catch { saved = b.map((p, i) => ({ id: -i - 1, at: p.at, src: p.src, dst: p.dst, sport: p.sport, dport: p.dport, proto: p.proto, app: p.app, site: p.site, len: p.len, info: p.info, way: p.way, origin: p.origin })); }
  for (const f of s.listeners) { try { f(saved); } catch { /* écouteur fermé */ } }
}

/** Démarre (ou rejoint) la lecture d'une portée : une adresse IP, ou NETWORK pour tout le réseau. */
export function capture(home: string, scope: Scope, o: { hostname?: string; onPackets?: (p: Packet[]) => void; onStatus?: (s: string) => void; recording?: boolean; maxMs?: number } = {}) {
  if (scope !== NETWORK && !isIP(scope)) throw new Error('adresse IP invalide');
  let s = sessions.get(scope);
  if (!s) {
    const srcs = sourcesFor(home, scope, o.hostname);
    s = { scope, procs: srcs.map((src) => ({ src, count: 0 })), listeners: new Set(), status: new Set(), recording: false, buf: [], until: 0, seen: new Map(), dropped: 0 };
    sessions.set(scope, s);
    for (const slot of s.procs) { if (!slot.src.machine && !hasTcpdump()) slot.error = problem('tcpdump: command not found'); else begin(home, s, slot); }
  }
  const sess = s;
  if (o.recording) sess.recording = true;
  const fn = o.onPackets, st = o.onStatus;
  if (fn) sess.listeners.add(fn); if (st) sess.status.add(st);
  sess.until = Math.max(sess.until, Date.now() + (o.maxMs ?? 30 * 60_000));
  const all = sess.procs.every((x) => x.error);
  const stop = () => {
    if (fn) sess.listeners.delete(fn); if (st) sess.status.delete(st);
    if (!sess.listeners.size && !sess.recording) end(sess);
  };
  return { scope, sources: sess.procs.map((x) => ({ label: x.src.label, machine: Boolean(x.src.machine), error: x.error ?? null })), paused, stop, error: all ? sess.procs.map((x) => x.error).filter(Boolean).join(' · ') : undefined };
}
function end(s: Session): void { for (const x of s.procs) { const p = x.proc; x.proc = undefined; p?.kill('SIGTERM'); } if (sessions.get(s.scope) === s) sessions.delete(s.scope); }
export function stopRecording(scope: Scope): void { const s = sessions.get(scope); if (!s) return; s.recording = false; if (!s.listeners.size) end(s); }
/** Pause : plus aucun paquet n'est lu (captures arrêtées). Reprise : les lectures en cours redémarrent. */
export function setPaused(home: string, on: boolean): void {
  paused = on;
  for (const s of sessions.values()) {
    if (on) { for (const x of s.procs) { const p = x.proc; x.proc = undefined; p?.kill('SIGTERM'); } for (const f of s.status) f('En pause : Rán ne lit plus les paquets.'); }
    else { for (const x of s.procs) if (!x.proc && !x.error) begin(home, s, x); for (const f of s.status) f('Lecture reprise.'); }
  }
}
export const isPaused = () => paused;
export function state(scope: Scope) {
  const s = sessions.get(scope);
  return { paused, live: Boolean(s && s.listeners.size), recording: Boolean(s?.recording), dropped: s?.dropped ?? 0, sources: s ? s.procs.map((x) => ({ label: x.src.label, machine: Boolean(x.src.machine), on: Boolean(x.proc), count: x.count, error: x.error ?? null })) : [] };
}
let timer: NodeJS.Timeout | undefined;
export function startPump(home: string): void {
  if (timer) return;
  let n = 0;
  timer = setInterval(() => {
    for (const s of [...sessions.values()]) {
      flush(home, s);
      if (!s.recording && s.listeners.size && Date.now() > s.until) { for (const f of s.status) f('Lecture arrêtée au bout de 30 minutes : relance-la si besoin.'); s.listeners.clear(); end(s); }
    }
    if (++n % 7200 === 1) { try { prune(home); } catch { /* base indisponible */ } }
  }, 500);
  timer.unref?.();
}
export function stopAll(): void { for (const s of [...sessions.values()]) end(s); if (timer) clearInterval(timer); timer = undefined; }
/** Arrêt d'Odin (ou de l'appli) : plus de lecture, et la base des paquets est fermée (Windows ne supprime pas un fichier ouvert). */
export function shutdown(): void { stopAll(); try { db?.close(); } catch { /* déjà fermée */ } db = undefined; dbHome = ''; }
