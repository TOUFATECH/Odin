// Rán : les paquets réseau d'une machine, comme Wireshark, en direct et en historique.
// Deux façons de capturer, choisies seules :
// - sur la machine elle-même, quand Odin y a accès (Réglages → Droits et machines) : tcpdump y tourne par SSH
//   et voit TOUT ce qui entre et sort de cette machine (la connexion SSH de la capture est écartée) ;
// - sinon sur la machine d'Odin, filtrée sur l'adresse : sur un réseau commuté (switch, box), Odin ne voit
//   alors que ce que cette machine échange avec lui, et ce qu'elle diffuse à tout le réseau — sauf si Odin
//   est le routeur ou reçoit une copie du trafic (port miroir). L'interface le dit clairement.
// Chaque paquet capturé (en direct ou en enregistrement continu) est gardé dans l'historique : 7 jours et
// 20 000 paquets par machine au plus. Seuls les en-têtes sont lus (qui parle à qui, protocole, taille) :
// jamais le contenu des paquets.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { askpassScript, listMachines, sshArgs, withAdmin, type Machine } from '../machines/access.ts';

export interface Packet { at: number; ip: string; dir: 'entrant' | 'sortant' | 'autre'; proto: string; src: string; sport?: number; dst: string; dport?: number; len: number; info: string }

const SERVICES: Record<number, string> = { 20: 'FTP-données', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 80: 'HTTP', 110: 'POP3', 123: 'NTP', 137: 'NetBIOS', 138: 'NetBIOS', 139: 'SMB', 143: 'IMAP', 161: 'SNMP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 514: 'Syslog', 587: 'SMTP', 631: 'Imprimante (IPP)', 853: 'DNS chiffré', 993: 'IMAPS', 995: 'POP3S', 1194: 'OpenVPN', 1883: 'MQTT', 1900: 'SSDP (UPnP)', 3306: 'MySQL', 3389: 'Bureau à distance', 5353: 'mDNS', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 8006: 'Proxmox', 8080: 'HTTP', 8096: 'Jellyfin / Venus', 8123: 'Home Assistant', 8443: 'HTTPS', 9000: 'HTTP', 51820: 'WireGuard' };
export const serviceOf = (p?: number) => (p != null ? SERVICES[p] : undefined);
const splitHostPort = (s: string): { host: string; port?: number } => {
  // tcpdump écrit « 192.168.1.5.443 » (IPv4) ou « fe80::1.443 » (IPv6) : le dernier champ est le port s'il y en a un
  const m = /^(.*)\.(\d{1,5})$/.exec(s);
  if (m && isIP(m[1])) return { host: m[1], port: Number(m[2]) };
  return { host: s };
};

/**
 * Une ligne de « tcpdump -l -nn -tt -q -i any » → un paquet (undefined si la ligne n'en est pas un). Exemples :
 *   1731363600.123456 eth0  Out IP 192.168.1.5.443 > 192.168.1.20.51234: tcp 120
 *   1731363600.2 eth0  In  IP 192.168.1.20.5353 > 224.0.0.251.5353: UDP, length 48
 *   1731363600.3 eth0  In  IP 192.168.1.1 > 192.168.1.20: ICMP echo request, id 3, seq 1, length 64
 *   1731363600.4 eth0  B   ARP, Request who-has 192.168.1.20 tell 192.168.1.1, length 46
 */
export function parseLine(line: string, ip: string): Packet | undefined {
  const t = /^(\d{9,11}\.\d+)\s+(.*)$/.exec(line.trim()); if (!t) return undefined;
  const at = Math.round(Number(t[1]) * 1000);
  let rest = t[2].replace(/^\S+\s+(In|Out|B|M|P)\s+/, '').replace(/^(In|Out|B|M|P)\s+/, '');
  const arp = /^ARP, (.*?)(?:, length (\d+))?$/.exec(rest);
  if (arp) {
    const who = /who-has (\S+) tell (\S+)/.exec(arp[1]), rep = /Reply (\S+) is-at (\S+)/.exec(arp[1]);
    const src = who ? who[2] : rep ? rep[1] : '?', dst = who ? who[1] : '?';
    return { at, ip, dir: src === ip ? 'sortant' : 'entrant', proto: 'ARP', src, dst, len: Number(arp[2] ?? 0), info: who ? `Qui a ${who[1]} ? (demande de ${who[2]})` : rep ? `${rep[1]} est à ${rep[2]}` : arp[1].slice(0, 120) };
  }
  const m = /^(IP6?) (\S+) > (\S+?): (.*)$/.exec(rest); if (!m) return undefined;
  const a = splitHostPort(m[2]), b = splitHostPort(m[3]), body = m[4];
  let proto = 'IP', len = 0, info = '';
  let x: RegExpExecArray | null;
  if ((x = /^tcp (\d+)/i.exec(body))) { proto = 'TCP'; len = Number(x[1]); }
  else if ((x = /^UDP, length (\d+)/i.exec(body))) { proto = 'UDP'; len = Number(x[1]); }
  else if ((x = /^ICMP6?,? (.*?)(?:, length (\d+))?$/i.exec(body))) { proto = m[1] === 'IP6' ? 'ICMPv6' : 'ICMP'; info = x[1].replace(/echo request/, 'ping (demande)').replace(/echo reply/, 'ping (réponse)').slice(0, 120); len = Number(x[2] ?? 0); }
  else { proto = body.split(/[\s,]/)[0].toUpperCase().slice(0, 12) || 'IP'; x = /length (\d+)/.exec(body); len = Number(x?.[1] ?? 0); info = body.slice(0, 120); }
  const svc = serviceOf(b.port) ?? serviceOf(a.port);
  if (svc && (proto === 'TCP' || proto === 'UDP')) { info = svc; proto = `${proto}`; }
  if (!info && (proto === 'TCP' || proto === 'UDP')) info = b.port != null ? `port ${b.port}` : '';
  if (/^(224\.|239\.|255\.255\.255\.255|ff0)/.test(b.host)) info = `${info ? info + ' · ' : ''}diffusé à tout le réseau`;
  return { at, ip, dir: a.host === ip ? 'sortant' : b.host === ip ? 'entrant' : 'autre', proto, src: a.host, sport: a.port, dst: b.host, dport: b.port, len, info };
}

// ---------- Historique ----------
let db: DatabaseSync | undefined;
function store(home: string): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(join(home, 'ran.db'));
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS packets (ip TEXT NOT NULL, at INTEGER NOT NULL, dir TEXT, proto TEXT, src TEXT, sport INTEGER, dst TEXT, dport INTEGER, len INTEGER, info TEXT);
    CREATE INDEX IF NOT EXISTS idx_packets ON packets(ip, at DESC);`);
  return db;
}
export const KEEP_DAYS = 7, KEEP_PER_IP = 20_000;
export function save(home: string, list: Packet[]): void {
  if (!list.length) return;
  const d = store(home), ins = d.prepare('INSERT INTO packets(ip, at, dir, proto, src, sport, dst, dport, len, info) VALUES (?,?,?,?,?,?,?,?,?,?)');
  d.exec('BEGIN');
  try { for (const p of list) ins.run(p.ip, p.at, p.dir, p.proto, p.src, p.sport ?? null, p.dst, p.dport ?? null, p.len, p.info); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; }
}
export function prune(home: string, now = Date.now()): number {
  const d = store(home);
  let n = Number(d.prepare('DELETE FROM packets WHERE at < ?').run(now - KEEP_DAYS * 864e5).changes);
  for (const { ip } of d.prepare('SELECT ip FROM packets GROUP BY ip HAVING COUNT(*) > ?').all(KEEP_PER_IP) as Array<{ ip: string }>) {
    n += Number(d.prepare('DELETE FROM packets WHERE ip = ? AND at < (SELECT at FROM packets WHERE ip = ? ORDER BY at DESC LIMIT 1 OFFSET ?)').run(ip, ip, KEEP_PER_IP - 1).changes);
  }
  return n;
}
export function history(home: string, ip: string, o: { limit?: number; q?: string; since?: number } = {}): { packets: Packet[]; total: number; protos: Array<{ proto: string; n: number }>; peers: Array<{ host: string; n: number; bytes: number }>; first?: number; last?: number } {
  const d = store(home), lim = Math.min(2000, Math.max(1, o.limit ?? 300));
  const q = (o.q ?? '').trim().toLowerCase();
  const where = ['ip = ?'], args: Array<string | number> = [ip];
  if (o.since) { where.push('at >= ?'); args.push(o.since); }
  if (q) { where.push("(LOWER(proto) LIKE ? OR src LIKE ? OR dst LIKE ? OR LOWER(info) LIKE ? OR CAST(sport AS TEXT) = ? OR CAST(dport AS TEXT) = ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q, q); }
  const w = where.join(' AND ');
  const rows = d.prepare(`SELECT ip, at, dir, proto, src, sport, dst, dport, len, info FROM packets WHERE ${w} ORDER BY at DESC LIMIT ?`).all(...args, lim) as unknown as Packet[];
  const tot = d.prepare(`SELECT COUNT(*) n, MIN(at) a, MAX(at) b FROM packets WHERE ${w}`).get(...args) as { n: number; a: number | null; b: number | null };
  const protos = d.prepare(`SELECT CASE WHEN info <> '' AND proto IN ('TCP','UDP') AND info NOT LIKE 'port %' THEN info ELSE proto END proto, COUNT(*) n FROM packets WHERE ${w} GROUP BY 1 ORDER BY n DESC LIMIT 12`).all(...args) as Array<{ proto: string; n: number }>;
  const peers = d.prepare(`SELECT CASE WHEN src = ? THEN dst ELSE src END host, COUNT(*) n, SUM(len) bytes FROM packets WHERE ${w} GROUP BY 1 ORDER BY n DESC LIMIT 12`).all(ip, ...args) as Array<{ host: string; n: number; bytes: number }>;
  return { packets: rows.map((r) => ({ ...r, sport: r.sport ?? undefined, dport: r.dport ?? undefined })), total: tot.n, protos, peers, first: tot.a ?? undefined, last: tot.b ?? undefined };
}
export function clear(home: string, ip: string): number { return Number(store(home).prepare('DELETE FROM packets WHERE ip = ?').run(ip).changes); }

// ---------- Capture ----------
export type Where = 'machine' | 'odin';
interface Session { ip: string; where: Where; machine?: string; proc?: ChildProcess; listeners: Set<(p: Packet[]) => void>; recording: boolean; started: number; count: number; dropped: number; error?: string; buf: Packet[]; until: number; status: (s: string) => void; idleSince: number }
const sessions = new Map<string, Session>();
const MAX_PER_SECOND = 300;

/** Machine du coffre qui correspond à cette adresse (ou à ce nom). */
export function machineFor(home: string, ip: string, hostname?: string): Machine | undefined {
  const hosts = new Set([ip, hostname, hostname?.replace(/\.(local|lan|home|box)$/i, '')].filter(Boolean).map((x) => String(x).toLowerCase()));
  return listMachines(home).find((m) => hosts.has(m.host.toLowerCase().replace(/^\[|\]$/g, '')));
}
export const hasTcpdump = () => process.platform !== 'win32' && spawnSync('sh', ['-c', 'command -v tcpdump || [ -x /usr/sbin/tcpdump ] || [ -x /usr/bin/tcpdump ]'], { stdio: 'ignore' }).status === 0;
/** Pourquoi la capture ne peut pas démarrer (ou rien). */
export function problem(err: string): string | undefined {
  if (/not found|introuvable|No such file|command not found/i.test(err)) return 'tcpdump n\'est pas installé. Sur la machine : « sudo apt install tcpdump » (Debian, Ubuntu, Proxmox) ou « sudo dnf install tcpdump ».';
  if (/password is required|a terminal is required|sudo: a password|Sorry, try again|not in the sudoers/i.test(err)) return 'Il faut les droits administrateur pour lire les paquets. Réglages → Droits et machines.';
  if (/Operation not permitted|permission/i.test(err)) return 'La capture des paquets demande les droits administrateur (ou la capacité « cap_net_raw » dans un conteneur).';
  if (/Permission denied \(publickey|Connection refused|timed out|Could not resolve/i.test(err)) return `Connexion SSH impossible : ${err.trim().split('\n').pop()}`;
  return undefined;
}

function launch(home: string, s: Session, m?: Machine): ChildProcess {
  const args = '-l -nn -tt -q -i any';
  if (m) {
    // Sur la machine : tout son trafic, sans la connexion SSH de la capture elle-même
    const cmd = `F="not (host \${SSH_CLIENT%% *} and tcp port \${SSH_CLIENT##* })"; exec sudo -S -p '' tcpdump ${args} "$F" 2>&1`;
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (m.password) Object.assign(env, { SSH_ASKPASS: askpassScript(home), SSH_ASKPASS_REQUIRE: 'force', DISPLAY: env.DISPLAY || ':0', ODIN_ASKPASS_SECRET: m.password });
    const p = spawn('ssh', sshArgs(home, m, ['-T']).concat(cmd), { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const pw = m.sudoPassword ?? m.password; p.stdin.end(pw ? `${pw}\n` : '');
    return p;
  }
  const w = withAdmin(`sudo tcpdump ${args} host ${s.ip} 2>&1`, home);
  return spawn('sh', ['-c', `exec ${w.command}`], { env: { ...process.env, ...w.env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

function begin(home: string, s: Session, m?: Machine): void {
  const p = launch(home, s, m); s.proc = p; s.started = Date.now();
  let tail = '', second = 0, inSecond = 0, errText = '';
  const onData = (d: Buffer) => {
    tail += d.toString();
    const lines = tail.split('\n'); tail = lines.pop() ?? '';
    for (const l of lines) {
      const pk = parseLine(l, s.ip);
      if (!pk) { if (l.trim() && !/listening on|verbose output suppressed|packets? (captured|received|dropped)/.test(l)) errText = `${errText}${l}\n`.slice(-2000); continue; }
      const sec = Math.floor(pk.at / 1000); if (sec !== second) { second = sec; inSecond = 0; }
      if (++inSecond > MAX_PER_SECOND) { s.dropped++; continue; }
      s.count++; s.buf.push(pk);
    }
  };
  p.stdout?.on('data', onData); p.stderr?.on('data', onData);
  p.on('error', (e) => { errText += e.message; });
  p.on('close', (code) => {
    flush(home, s);
    if (sessions.get(key(s.ip)) !== s) return;
    s.proc = undefined;
    if (code !== 0 && code !== null && s.count === 0) { s.error = problem(errText) ?? (errText.trim().split('\n').slice(-2).join(' ') || `tcpdump s'est arrêté (code ${code})`); s.status(s.error); }
    // Enregistrement continu : on relance (doucement) ; sinon la session se termine
    if (s.recording && !s.error) setTimeout(() => { if (sessions.get(key(s.ip)) === s && !s.proc) begin(home, s, m); }, 15_000);
    else if (!s.listeners.size) sessions.delete(key(s.ip));
  });
}
function flush(home: string, s: Session): void {
  if (!s.buf.length) return;
  const b = s.buf; s.buf = [];
  try { save(home, b); } catch { /* disque plein : les paquets restent visibles en direct */ }
  for (const f of s.listeners) { try { f(b); } catch { /* écouteur fermé */ } }
}
const key = (ip: string) => ip;

/** Démarre (ou rejoint) la capture d'une machine. Renvoie de quoi s'arrêter et où elle a lieu. */
export function capture(home: string, ip: string, o: { hostname?: string; onPackets?: (p: Packet[]) => void; onStatus?: (s: string) => void; recording?: boolean; maxMs?: number } = {}): { where: Where; machine?: string; stop: () => void; error?: string } {
  if (!isIP(ip)) throw new Error('adresse IP invalide');
  let s = sessions.get(key(ip));
  if (!s) {
    const m = machineFor(home, ip, o.hostname);
    s = { ip, where: m ? 'machine' : 'odin', machine: m?.label, listeners: new Set(), recording: false, started: Date.now(), count: 0, dropped: 0, buf: [], until: 0, status: () => {}, idleSince: Date.now() };
    sessions.set(key(ip), s);
    if (!m && !hasTcpdump()) { s.error = problem('tcpdump: command not found'); }
    else begin(home, s, m);
  }
  const sess = s;
  if (o.recording) sess.recording = true;
  if (o.onStatus) sess.status = o.onStatus;
  const fn = o.onPackets; if (fn) sess.listeners.add(fn);
  sess.until = Math.max(sess.until, Date.now() + (o.maxMs ?? 15 * 60_000));
  const stop = () => {
    if (fn) sess.listeners.delete(fn);
    if (!sess.listeners.size && !sess.recording) { sess.proc?.kill('SIGTERM'); sessions.delete(key(ip)); }
  };
  return { where: sess.where, machine: sess.machine, stop, error: sess.error };
}
/** Arrête l'enregistrement continu d'une machine (le direct éventuel continue). */
export function stopRecording(ip: string): void {
  const s = sessions.get(key(ip)); if (!s) return;
  s.recording = false;
  if (!s.listeners.size) { s.proc?.kill('SIGTERM'); sessions.delete(key(ip)); }
}
export function state(ip: string): { live: boolean; recording: boolean; where?: Where; machine?: string; count: number; dropped: number; error?: string } {
  const s = sessions.get(key(ip));
  return s ? { live: Boolean(s.proc) && s.listeners.size > 0, recording: s.recording, where: s.where, machine: s.machine, count: s.count, dropped: s.dropped, error: s.error } : { live: false, recording: false, count: 0, dropped: 0 };
}
/** Envoi des paquets toutes les demi-secondes, limite de durée des directs, ménage de l'historique. */
let timer: NodeJS.Timeout | undefined;
export function startPump(home: string): void {
  if (timer) return;
  let n = 0;
  timer = setInterval(() => {
    for (const s of sessions.values()) {
      flush(home, s);
      if (!s.recording && s.listeners.size && Date.now() > s.until) { s.status('Direct arrêté au bout de 15 minutes : relance-le si besoin.'); s.listeners.clear(); s.proc?.kill('SIGTERM'); sessions.delete(key(s.ip)); }
    }
    if (++n % 7200 === 1) { try { prune(home); } catch { /* base indisponible */ } }
  }, 500);
  timer.unref?.();
}
export function stopAll(): void { for (const s of sessions.values()) s.proc?.kill('SIGTERM'); sessions.clear(); if (timer) clearInterval(timer); timer = undefined; }
