// Rán : les paquets réseau, lus en entier et décodés couche par couche (voir ran-dissect.ts), comme Wireshark.
// Deux portées : une machine (son adresse IP) ou tout le réseau. Points de capture :
// - la machine d'Odin (tout ce qui passe par sa carte réseau) ;
// - chaque machine où Odin a un accès (Réglages → Droits et machines), par SSH : tout son trafic. Un hôte
//   Proxmox voit ainsi tout ce qu'échangent ses machines virtuelles ; un routeur Linux, tout le réseau.
// Sur un réseau avec switch ou box, une machine sans point de capture n'est vue que dans ses échanges avec un
// point de capture et dans ce qu'elle diffuse — l'interface le dit. Pause : plus aucune lecture ; « Lis les
// paquets » : la lecture reprend. Les paquets sont gardés 7 jours (250 000 au plus), avec leur contenu brut
// (4 ko au plus par paquet), en fichiers dans ~/.odin/memoire/paquets/ (jamais de base de données), sur la machine d'Odin seulement.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { isIP } from 'node:net';
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Shelf, type Table } from '../muninn/tables.ts';
import { askpassScript, listMachines, sshArgs, withAdmin, type Machine } from '../machines/access.ts';
import { PcapReader, hexdump, isBroadcast, isPrivate, type Decoded, type Layer } from './ran-dissect.ts';

export interface Packet { id: number; at: number; src: string; dst: string; sport?: number; dport?: number; proto: string; app: string; site: string; len: number; info: string; way: string; origin: string }
export interface PacketDetail extends Packet { layers: Layer[]; hex: string; story: string }
export type Scope = string; // « réseau » ou une adresse IP
export const NETWORK = 'réseau';

// ---------- Historique ----------
interface PkRow { id: number; at: number; src: string; dst: string; sport: number | null; dport: number | null; proto: string; app: string; site: string; len: number; info: string; way: string; origin: string; [k: string]: unknown }
interface NameRow { ip: string; name: string; at: number; [k: string]: unknown }
interface SeenRow { dev: string; kind: string; val: string; first: number; [k: string]: unknown }
// En mémoire vive : la forme courte des paquets. Le détail (couches, contenu brut) est écrit à part, par lots
// de 1 000 paquets (detail-<lot>.jsonl), et relu seulement quand on ouvre un paquet.
let pk: Table<PkRow> | undefined, names: Table<NameRow> | undefined, seen: Table<SeenRow> | undefined, dbHome = '', dir = '';
function store(home: string): { pk: Table<PkRow>; names: Table<NameRow>; seen: Table<SeenRow> } {
  if (pk && names && seen && dbHome === home) return { pk, names, seen };
  dbHome = home; dir = join(home, 'memoire', 'paquets');
  // L'ancien historique SQLite (ran.db) n'est plus lu : ce ne sont que des paquets des 7 derniers jours.
  for (const f of ['ran.db', 'ran.db-wal', 'ran.db-shm']) rmSync(join(home, f), { force: true });
  const shelf = new Shelf(dir);
  pk = shelf.table<PkRow>('pk', (r) => r.id); names = shelf.table<NameRow>('names', (r) => r.ip);
  // Ce que chaque appareil a déjà fait (pays, services) : gardé longtemps, petit.
  seen = shelf.table<SeenRow>('seen', (r) => `${r.dev}|${r.kind}|${r.val}`);
  return { pk, names, seen };
}
export const KEEP_DAYS = 7, KEEP_MAX = 250_000, RAW_MAX = 4096;
const lot = (id: number) => join(dir, `detail-${Math.floor(id / 1000)}.jsonl`);
const row = (r: PkRow): Packet => ({ id: r.id, at: r.at, src: r.src ?? '', dst: r.dst ?? '', sport: r.sport == null ? undefined : r.sport, dport: r.dport == null ? undefined : r.dport, proto: r.proto ?? '', app: r.app ?? '', site: r.site ?? '', len: r.len ?? 0, info: r.info ?? '', way: r.way ?? '', origin: r.origin ?? '' });

/** Garde des paquets décodés ; rend leur forme courte (avec leur numéro). */
export function save(home: string, list: Array<Decoded & { origin: string }>): Packet[] {
  if (!list.length) return [];
  const d = store(home), now = Date.now();
  const out: Packet[] = [];
  for (const p of list) {
    for (const [ip, name] of p.names) if (isIP(ip) && name && name.length < 200) d.names.put({ ip, name, at: now });
    // Le site d'un paquet vers Internet : son nom appris plus tôt (réponse DNS, SNI) quand il ne le porte pas
    if (!p.site) { const far = !isPrivate(p.dst) && !isBroadcast(p.dst) ? p.dst : !isPrivate(p.src) ? p.src : ''; if (far) p.site = d.names.get(far)?.name ?? ''; }
    const r = d.pk.insert({ at: p.at, src: p.src, dst: p.dst, sport: p.sport ?? null, dport: p.dport ?? null, proto: p.proto, app: p.app, site: p.site, len: p.len, info: p.info, way: p.way, origin: p.origin });
    appendFileSync(lot(r.id), `${JSON.stringify({ id: r.id, story: p.story ?? '', layers: p.layers, raw: Buffer.from(p.raw.subarray(0, RAW_MAX)).toString('base64') })}\n`);
    out.push(row(r));
  }
  return out;
}
function dropLots(minId: number): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) { const m = /^detail-(\d+)\.jsonl$/.exec(f); if (m && (Number(m[1]) + 1) * 1000 <= minId) rmSync(join(dir, f), { force: true }); }
}
export function prune(home: string, now = Date.now()): number {
  const d = store(home);
  let n = d.pk.deleteWhere((r) => r.at < now - KEEP_DAYS * 864e5);
  const c = d.pk.size;
  if (c > KEEP_MAX) { const cut = d.pk.all().map((r) => r.id).sort((a, b) => a - b)[c - KEEP_MAX - 1]; n += d.pk.deleteWhere((r) => r.id <= cut); }
  d.names.deleteWhere((r) => r.at < now - 30 * 864e5);
  if (n) { d.pk.compact(); d.names.compact(); dropLots(Math.min(Infinity, ...d.pk.all().map((r) => r.id))); }
  return n;
}
function filter(ip: string | undefined, q: string, since?: number, peer?: string): (r: PkRow) => boolean {
  q = q.trim().toLowerCase();
  const like = (v: unknown) => String(v ?? '').toLowerCase().includes(q);
  return (r) => (!ip || r.src === ip || r.dst === ip) && (!peer || r.src === peer || r.dst === peer) && (!since || r.at >= since)
    && (!q || like(r.proto) || like(r.app) || like(r.site) || like(r.src) || like(r.dst) || like(r.info) || String(r.sport) === q || String(r.dport) === q);
}
const count = <K>(rows: PkRow[], key: (r: PkRow) => K) => { const g = new Map<K, { n: number; bytes: number }>(); for (const r of rows) { const k = key(r), x = g.get(k) ?? { n: 0, bytes: 0 }; x.n++; x.bytes += r.len ?? 0; g.set(k, x); } return g; };
/** Les paquets gardés (d'une machine, ou de tout le réseau), les plus récents d'abord, avec quelques chiffres. */
export function history(home: string, ip: string | undefined, o: { limit?: number; q?: string; since?: number; peer?: string } = {}) {
  const d = store(home), lim = Math.min(2000, Math.max(1, o.limit ?? 300));
  const rows = d.pk.filter(filter(ip, o.q ?? '', o.since, o.peer));
  const packets = [...rows].sort((a, b) => b.id - a.id).slice(0, lim).map(row);
  const ats = rows.map((r) => r.at);
  const apps = [...count(rows, (r) => r.app || r.proto)].map(([app, x]) => ({ app, n: x.n, bytes: x.bytes })).sort((a, b) => b.n - a.n).slice(0, 15);
  const sites = [...count(rows.filter((r) => r.site !== ''), (r) => r.site)].map(([site, x]) => ({ site, n: x.n, bytes: x.bytes })).sort((a, b) => b.n - a.n).slice(0, 20);
  return { packets, total: rows.length, bytes: rows.reduce((s, r) => s + (r.len ?? 0), 0), first: ats.length ? Math.min(...ats) : undefined, last: ats.length ? Math.max(...ats) : undefined, apps, sites };
}
/** Un paquet en entier : ses couches (OSI), son contenu brut et ce qui se passe. */
export function packet(home: string, id: number): PacketDetail | undefined {
  const r = store(home).pk.get(id);
  if (!r) return undefined;
  let det: { story?: string; layers?: Layer[]; raw?: string } = {};
  try { for (const line of readFileSync(lot(id), 'utf8').split('\n')) { if (line.startsWith(`{"id":${id},`)) { det = JSON.parse(line); break; } } } catch { /* détail perdu */ }
  return { ...row(r), layers: det.layers ?? [], story: det.story ?? '', hex: hexdump(new Uint8Array(Buffer.from(det.raw ?? '', 'base64'))) };
}
/** Qui parle à qui : une ligne par sens (de → vers), avec ses applis, ses sites, ses paquets et ses octets. */
export function flows(home: string, ip: string | undefined, o: { since?: number; q?: string } = {}) {
  const d = store(home);
  const g = new Map<string, { src: string; dst: string; n: number; bytes: number; last: number; apps: Set<string>; site: string }>();
  for (const r of d.pk.filter(filter(ip, o.q ?? '', o.since ?? Date.now() - 24 * 3600e3))) {
    const k = `${r.src}\u0000${r.dst}`, x = g.get(k) ?? { src: r.src, dst: r.dst, n: 0, bytes: 0, last: 0, apps: new Set<string>(), site: '' };
    x.n++; x.bytes += r.len ?? 0; x.last = Math.max(x.last, r.at); x.apps.add(r.app || r.proto); if ((r.site ?? '') > x.site) x.site = r.site; g.set(k, x);
  }
  const list = [...g.values()].sort((a, b) => b.n - a.n).slice(0, 600);
  const hosts = [...new Set(list.flatMap((x) => [x.src, x.dst]))].filter(Boolean);
  const nm = new Map<string, string>();
  for (const h of hosts) { const n = d.names.get(h)?.name; if (n) nm.set(h, n); }
  return { flows: list.map((x) => ({ src: x.src, dst: x.dst, n: x.n, bytes: x.bytes, last: x.last, apps: [...x.apps].filter(Boolean).slice(0, 6), site: x.site })), names: Object.fromEntries(nm) };
}
// ---------- Trafic en direct (comme Sniffnet) ----------
/** Le sens d'un paquet vu de la maison : sortant (maison → Internet), entrant (Internet → maison) ou local. */
export const dirOf = (src: string, dst: string): 'sortant' | 'entrant' | 'local' => (isPrivate(src) && !isPrivate(dst) && !isBroadcast(dst) ? 'sortant' : !isPrivate(src) && isPrivate(dst) ? 'entrant' : 'local');
const appOf = (r: PkRow) => r.app || r.proto;
/** Le débit par tranche de temps (octets entrants, sortants, locaux). */
export function throughput(home: string, o: { since: number; bucketMs: number; ip?: string; until?: number }): Array<{ t: number; entrant: number; sortant: number; local: number }> {
  const d = store(home), until = o.until ?? Date.now(), n = Math.max(1, Math.min(720, Math.ceil((until - o.since) / o.bucketMs)));
  const out = Array.from({ length: n }, (_, i) => ({ t: o.since + i * o.bucketMs, entrant: 0, sortant: 0, local: 0 }));
  for (const r of d.pk.values()) { if (r.at < o.since || r.at >= until || (o.ip && r.src !== o.ip && r.dst !== o.ip)) continue; const i = Math.min(n - 1, Math.floor((r.at - o.since) / o.bucketMs)); out[i][dirOf(r.src, r.dst)] += r.len; }
  return out;
}
/** Les appareils de la maison : envoyé, reçu, paquets, applis, pairs d'Internet. */
export function devices(home: string, since: number) {
  const d = store(home), m = new Map<string, { ip: string; sent: number; recv: number; n: number; apps: Map<string, number>; peers: Map<string, number>; last: number }>();
  const get = (ip: string) => { let x = m.get(ip); if (!x) m.set(ip, x = { ip, sent: 0, recv: 0, n: 0, apps: new Map(), peers: new Map(), last: 0 }); return x; };
  for (const r of d.pk.values()) {
    if (r.at < since) continue;
    for (const [ip, me, other] of [[r.src, 'sent', r.dst], [r.dst, 'recv', r.src]] as const) {
      if (!isPrivate(ip) || isBroadcast(ip)) continue;
      const x = get(ip), a = appOf(r); x[me] += r.len; x.n++; x.last = Math.max(x.last, r.at); x.apps.set(a, (x.apps.get(a) ?? 0) + r.len);
      if (!isPrivate(other) && !isBroadcast(other)) x.peers.set(other, (x.peers.get(other) ?? 0) + r.len);
    }
  }
  return [...m.values()].map((x) => ({ ip: x.ip, name: d.names.get(x.ip)?.name ?? '', sent: x.sent, recv: x.recv, n: x.n, last: x.last,
    apps: [...x.apps].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k), peers: [...x.peers].sort((a, b) => b[1] - a[1]).slice(0, 50) }))
    .sort((a, b) => b.sent + b.recv - (a.sent + a.recv));
}
/** Les échanges avec Internet depuis `since` : (appareil, adresse, appli, site, octets) pour pays et nouveautés. */
export function external(home: string, since: number): Array<{ dev: string; far: string; app: string; site: string; bytes: number }> {
  const g = new Map<string, { dev: string; far: string; app: string; site: string; bytes: number }>();
  for (const r of store(home).pk.values()) {
    if (r.at < since) continue; const w = dirOf(r.src, r.dst); if (w === 'local') continue;
    const dev = w === 'sortant' ? r.src : r.dst, far = w === 'sortant' ? r.dst : r.src, app = appOf(r), site = r.site ?? '', k = `${r.src}|${r.dst}|${app}|${site}`;
    const x = g.get(k); if (x) x.bytes += r.len; else g.set(k, { dev, far, app, site, bytes: r.len });
  }
  return [...g.values()];
}
/** Retient ce qu'un appareil a déjà fait ; rend true la première fois (pays, service…). */
export function firstSeen(home: string, dev: string, kind: string, val: string, now = Date.now()): boolean {
  const t = store(home).seen; if (t.has(`${dev}|${kind}|${val}`)) return false; t.put({ dev, kind, val, first: now }); return true;
}
/** Depuis quand on connaît cet appareil (première chose retenue). */
export function knownSince(home: string, dev: string): number | undefined { let f: number | undefined; for (const r of store(home).seen.values()) if (r.dev === dev && (f === undefined || r.first < f)) f = r.first; return f; }
export function recentFirsts(home: string, since: number): Array<{ dev: string; kind: string; val: string; first: number }> {
  return store(home).seen.filter((r) => r.first >= since).sort((a, b) => b.first - a.first).slice(0, 40).map(({ dev, kind, val, first }) => ({ dev, kind, val, first }));
}

export function clear(home: string, ip?: string): number {
  const d = store(home);
  const n = d.pk.deleteWhere((r) => !ip || r.src === ip || r.dst === ip);
  d.pk.compact(); if (!ip) dropLots(Infinity);
  return n;
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
export function shutdown(): void { stopAll(); pk = undefined; names = undefined; dbHome = ''; }
