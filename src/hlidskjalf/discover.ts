// Horus — le trône d'où Odin voit les neuf mondes : découverte du réseau local.
//
// Sans dépendance et sans droits administrateur :
//   1. réseaux privés des interfaces de la machine (jamais d'adresse publique) ;
//   2. balayage TCP léger : une connexion refusée prouve aussi qu'un hôte existe ;
//   3. table ARP / voisins du système → adresses MAC ;
//   4. mDNS (Bonjour) et SSDP (UPnP) → noms et services annoncés ;
//   5. DNS inverse.
// Tout texte venant d'un appareil est assaini (un nom mDNS peut contenir une injection).

import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { reverse } from 'node:dns/promises';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { SCAN_PORTS, WEB_PORTS, netbiosName, probeWeb, upnpDescribe, type WebEndpoint } from './identify.ts';

export interface Subnet { iface: string; address: string; cidr: string; prefix: number; hosts: string[] }

export interface Found {
  ip: string;
  mac?: string;
  hostname?: string;
  name?: string;
  model?: string;
  ports: number[];
  services: string[];
  server?: string;
  network: string;
  isGateway?: boolean;
  /** Interfaces web trouvées (balayage complet). */
  web?: WebEndpoint[];
  /** Nom NetBIOS (Windows, NAS, Samba). */
  netbios?: string;
  manufacturer?: string;
  /** Système et version (SMB/NTLM, bannière SSH, Apple). */
  os?: string;
}

// ---------- Adresses ----------

const toInt = (ip: string) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const toIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

export function isPrivateV4(ip: string): boolean {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/**
 * Réseaux à explorer : uniquement les réseaux PRIVÉS des interfaces de la machine.
 * Un masque trop large (/16) est réduit au /24 de la machine : on ne balaie jamais
 * plus de 1 024 adresses par interface.
 */
/** Interfaces virtuelles de la machine (réseau des conteneurs d'Odin, ponts de conteneurs ou de VM) : ce n'est pas ton réseau local. */
export const VIRTUAL_IFACE = /^(odin0|od[0-9a-f]{10}[hc]|docker\d*|br-[0-9a-f]+|veth|virbr|cni|flannel|podman|lxcbr|lxdbr|vnet|tap)/;
export function localSubnets(ifaces = networkInterfaces()): Subnet[] {
  const out: Subnet[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL_IFACE.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivateV4(a.address)) continue;
      let prefix = a.netmask.split('.').reduce((n, o) => n + Number(o).toString(2).replace(/0/g, '').length, 0);
      if (prefix < 22) prefix = 24;
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const net = (toInt(a.address) & mask) >>> 0;
      const size = 2 ** (32 - prefix);
      const hosts: string[] = [];
      for (let i = 1; i < size - 1; i++) hosts.push(toIp(net + i));
      out.push({ iface: name, address: a.address, cidr: `${toIp(net)}/${prefix}`, prefix, hosts });
    }
  }
  return out;
}

export function inSubnet(ip: string, cidr: string): boolean {
  const [base, p] = cidr.split('/');
  const mask = Number(p) === 0 ? 0 : (0xffffffff << (32 - Number(p))) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === ((toInt(base) & mask) >>> 0);
}

// ---------- Texte venant des appareils ----------

/** Garde lettres, chiffres et ponctuation simple ; 64 caractères au plus. */
export function sanitize(s: string | undefined, max = 64): string | undefined {
  if (!s) return undefined;
  const clean = s.normalize('NFKC').replace(/[^\p{L}\p{N} ._\-'()/+]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return clean || undefined;
}

export function normalizeMac(raw: string): string | undefined {
  const parts = raw.toLowerCase().split(/[:-]/);
  if (parts.length !== 6 || parts.some((p) => !/^[0-9a-f]{1,2}$/.test(p))) return undefined;
  const mac = parts.map((p) => p.padStart(2, '0')).join(':');
  if (mac === 'ff:ff:ff:ff:ff:ff' || mac === '00:00:00:00:00:00' || mac.startsWith('01:00:5e') || mac.startsWith('33:33')) return undefined;
  return mac;
}

/** Bit « administré localement » : adresse MAC privée/aléatoire (téléphones récents). */
export const isRandomMac = (mac: string) => (parseInt(mac.slice(0, 2), 16) & 0b10) !== 0;

// ---------- Table ARP ----------

/** Lit la sortie de `ip neigh`, `/proc/net/arp`, `arp -an` (macOS) ou `arp -a` (Windows). */
export function parseNeighbors(text: string): Array<{ ip: string; mac: string }> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (/incomplete|FAILED/i.test(line)) continue;
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1];
    const macRaw = line.match(/\b([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b/i)?.[1];
    if (!ip || !macRaw) continue;
    const mac = normalizeMac(macRaw);
    if (mac && isPrivateV4(ip)) out.set(ip, mac);
  }
  return [...out].map(([ip, mac]) => ({ ip, mac }));
}

function run(cmd: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((res) => execFile(cmd, args, { timeout, windowsHide: true }, (_e, stdout) => res(String(stdout ?? ''))));
}

export async function readNeighbors(platform = process.platform): Promise<Array<{ ip: string; mac: string }>> {
  if (platform === 'win32') return parseNeighbors(await run('arp', ['-a']));
  if (platform === 'darwin') return parseNeighbors(await run('arp', ['-an']));
  const ipn = await run('ip', ['neigh']);
  return parseNeighbors(ipn || (await run('cat', ['/proc/net/arp'])));
}

export async function defaultGateway(platform = process.platform): Promise<string | undefined> {
  const text = platform === 'win32' ? await run('route', ['print', '0.0.0.0'])
    : platform === 'darwin' ? await run('route', ['-n', 'get', 'default'])
    : await run('ip', ['route', 'show', 'default']);
  const m = platform === 'win32' ? text.match(/0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/)
    : platform === 'darwin' ? text.match(/gateway:\s*(\d+\.\d+\.\d+\.\d+)/) : text.match(/default via (\d+\.\d+\.\d+\.\d+)/);
  return m?.[1];
}

// ---------- Balayage TCP ----------

/** Ports utiles pour reconnaître un appareil (et ce qu'on peut faire avec). */
export const PORTS = SCAN_PORTS;
const ALIVE_PORTS = [80, 443, 445, 62078];

type Probe = 'open' | 'closed' | 'silent';

export function probe(ip: string, port: number, timeoutMs = 450): Promise<Probe> {
  return new Promise((res) => {
    const s = connect({ host: ip, port });
    const done = (r: Probe) => { s.destroy(); res(r); };
    s.setTimeout(timeoutMs, () => done('silent'));
    s.once('connect', () => done('open'));
    s.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'ECONNREFUSED' ? 'closed' : 'silent'));
  });
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

/** Passe 1 : quels hôtes répondent ? Passe 2 : quels ports sont ouverts sur ceux-là ? */
export async function sweep(hosts: string[], known: Set<string>, ports = PORTS, concurrency = 96): Promise<Map<string, number[]>> {
  const alive = new Set(known);
  await pool(hosts.filter((h) => !alive.has(h)), concurrency, async (h) => {
    for (const p of ALIVE_PORTS) {
      if ((await probe(h, p, 350)) !== 'silent') { alive.add(h); return; }
    }
  });
  const open = new Map<string, number[]>();
  const jobs = [...alive].flatMap((h) => ports.map((p) => ({ h, p })));
  await pool(jobs, concurrency, async ({ h, p }) => {
    if ((await probe(h, p)) === 'open') open.set(h, [...(open.get(h) ?? []), p].sort((a, b) => a - b));
    else if (!open.has(h)) open.set(h, []);
  });
  return open;
}

// ---------- mDNS (Bonjour) ----------

export const MDNS_TYPES = ['_services._dns-sd._udp.local', '_http._tcp.local', '_ipp._tcp.local', '_printer._tcp.local', '_googlecast._tcp.local',
  '_airplay._tcp.local', '_raop._tcp.local', '_hap._tcp.local', '_smb._tcp.local', '_ssh._tcp.local', '_homeassistant._tcp.local', '_rtsp._tcp.local'];

export function encodeQuery(names: string[]): Buffer {
  const header = Buffer.alloc(12); // id 0, drapeaux 0 (requête standard)
  header.writeUInt16BE(names.length, 4); // nombre de questions
  const parts: Buffer[] = [header];
  for (const n of names) {
    for (const label of n.split('.')) { const b = Buffer.from(label); parts.push(Buffer.from([b.length]), b); }
    parts.push(Buffer.from([0, 0, 12, 0x80, 1])); // fin du nom, type PTR, classe IN + bit « réponse unicast »
  }
  return Buffer.concat(parts);
}

export interface DnsRecord { name: string; type: number; data: string; port?: number; txt?: Record<string, string> }

function readName(buf: Buffer, off: number, depth = 0): [string, number] {
  const labels: string[] = [];
  let end = -1;
  while (off < buf.length && depth < 20) {
    const len = buf[off];
    if (len === 0) { off++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = off + 2;
      off = ((len & 0x3f) << 8) | buf[off + 1];
      depth++;
      continue;
    }
    labels.push(buf.toString('utf8', off + 1, off + 1 + len));
    off += len + 1;
  }
  return [labels.join('.'), end >= 0 ? end : off];
}

/** Décode les enregistrements d'une réponse DNS (PTR, SRV, TXT, A). Tolérant aux paquets abîmés. */
export function parseDns(buf: Buffer): DnsRecord[] {
  const out: DnsRecord[] = [];
  try {
    const qd = buf.readUInt16BE(4);
    const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
    let off = 12;
    for (let i = 0; i < qd; i++) off = readName(buf, off)[1] + 4;
    for (let i = 0; i < total && off < buf.length; i++) {
      const [name, o] = readName(buf, off);
      const type = buf.readUInt16BE(o);
      const len = buf.readUInt16BE(o + 8);
      const rd = o + 10;
      if (type === 12) out.push({ name, type, data: readName(buf, rd)[0] });
      else if (type === 33) out.push({ name, type, data: readName(buf, rd + 6)[0], port: buf.readUInt16BE(rd + 4) });
      else if (type === 1 && len === 4) out.push({ name, type, data: [...buf.subarray(rd, rd + 4)].join('.') });
      else if (type === 16) {
        const txt: Record<string, string> = {};
        for (let p = rd; p < rd + len;) { const l = buf[p]; const kv = buf.toString('utf8', p + 1, p + 1 + l); const eq = kv.indexOf('='); if (eq > 0) txt[kv.slice(0, eq).toLowerCase()] = kv.slice(eq + 1); p += l + 1; }
        out.push({ name, type, data: '', txt });
      }
      off = rd + len;
    }
  } catch { /* paquet tronqué : on garde ce qui a été lu */ }
  return out;
}

/** Résume les enregistrements mDNS d'un appareil : nom, modèle, services. */
export function summarizeMdns(records: DnsRecord[]): { name?: string; model?: string; services: string[] } {
  const services = new Set<string>();
  let name: string | undefined, model: string | undefined;
  for (const r of records) {
    const svc = (r.type === 12 ? r.data : r.name).match(/(_[a-z0-9-]+\._(?:tcp|udp))\.local$/i)?.[1];
    if (svc && !svc.startsWith('_services')) services.add(svc.toLowerCase());
    if (r.type === 12 && !r.name.startsWith('_services')) name ??= r.data.split('._')[0];
    if (r.txt) { model ??= r.txt.md ?? r.txt.ty ?? r.txt.model ?? r.txt.rpmd ?? r.txt.usb_mdl; name = r.txt.fn ?? name; }
  }
  return { name: sanitize(name), model: sanitize(model), services: [...services] };
}

export function mdnsScan(waitMs = 2500): Promise<Map<string, DnsRecord[]>> {
  return new Promise((res) => {
    const found = new Map<string, DnsRecord[]>();
    const sock = createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => { try { sock.close(); } catch { /* déjà fermé */ } res(found); });
    sock.on('message', (msg, rinfo) => { if (isPrivateV4(rinfo.address)) found.set(rinfo.address, [...(found.get(rinfo.address) ?? []), ...parseDns(msg)]); });
    sock.bind(0, () => {
      sock.send(encodeQuery(MDNS_TYPES), 5353, '224.0.0.251');
      setTimeout(() => { try { sock.close(); } catch { /* déjà fermé */ } res(found); }, waitMs);
    });
  });
}

// ---------- SSDP (UPnP) ----------

export function parseSsdp(text: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(1)) { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  return h;
}

export function ssdpScan(waitMs = 3000): Promise<Map<string, Record<string, string>[]>> {
  return new Promise((res) => {
    const found = new Map<string, Record<string, string>[]>();
    const sock = createSocket('udp4');
    sock.on('error', () => { try { sock.close(); } catch { /* déjà fermé */ } res(found); });
    sock.on('message', (msg, rinfo) => { if (isPrivateV4(rinfo.address)) found.set(rinfo.address, [...(found.get(rinfo.address) ?? []), parseSsdp(msg.toString())]); });
    sock.bind(0, () => {
      sock.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n'), 1900, '239.255.255.250');
      setTimeout(() => { try { sock.close(); } catch { /* déjà fermé */ } res(found); }, waitMs);
    });
  });
}

async function rdns(ip: string): Promise<string | undefined> {
  try { return sanitize((await Promise.race([reverse(ip), new Promise<string[]>((r) => setTimeout(() => r([]), 1500))]))[0]); } catch { return undefined; }
}

// ---------- Orchestration ----------

export interface DiscoverOptions { full: boolean; subnets?: Subnet[] }

export async function discover(o: DiscoverOptions): Promise<{ subnets: Subnet[]; found: Found[] }> {
  const subnets = o.subnets ?? localSubnets();
  if (!subnets.length) return { subnets, found: [] };
  const [mdns, ssdp, gw, before] = await Promise.all([mdnsScan(), ssdpScan(), defaultGateway(), readNeighbors()]);
  const known = new Set([...before.map((n) => n.ip), ...mdns.keys(), ...ssdp.keys()]);
  const hosts = subnets.flatMap((s) => s.hosts);
  const ports = o.full ? await sweep(hosts, new Set([...known].filter((ip) => hosts.includes(ip)))) : new Map<string, number[]>();
  const neigh = await readNeighbors();
  const macs = new Map([...before, ...neigh].map((n) => [n.ip, n.mac]));
  const ips = new Set([...known, ...ports.keys(), ...macs.keys()].filter((ip) => subnets.some((s) => inSubnet(ip, s.cidr))));
  for (const s of subnets) ips.delete(s.address); // la machine d'Odin elle-même est ajoutée à part

  const found: Found[] = [];
  for (const ip of ips) {
    const m = summarizeMdns(mdns.get(ip) ?? []);
    const sh = ssdp.get(ip) ?? [];
    const server = sanitize(sh.find((h) => h.server)?.server, 80);
    const upnp = sh.map((h) => h.st ?? '').filter((st) => /^urn:/.test(st)).map((st) => st.replace(/^urn:[^:]+:(device|service):/, 'upnp:').replace(/:\d+$/, ''));
    found.push({
      ip, mac: macs.get(ip), name: m.name, model: m.model, server,
      ports: ports.get(ip) ?? [], services: [...new Set([...m.services, ...upnp])].slice(0, 20),
      network: subnets.find((s) => inSubnet(ip, s.cidr))!.cidr, isGateway: ip === gw,
    });
  }
  // Noms et interfaces : DNS inverse, NetBIOS, description UPnP ; interfaces web (balayage complet).
  await pool(found, 16, async (f) => {
    const sh = ssdp.get(f.ip) ?? [];
    const [host, nb, up] = await Promise.all([
      f.name ? Promise.resolve(undefined) : rdns(f.ip),
      f.ports.some((p) => p === 139 || p === 445) || !o.full ? netbiosName(f.ip) : Promise.resolve(undefined),
      (async () => { const loc = sh.find((h) => h.location)?.location; return loc ? upnpDescribe(loc, f.ip) : undefined; })(),
    ]);
    if (host) f.hostname = host;
    if (nb) f.netbios = sanitize(nb, 40);
    if (up) { f.name ??= up.friendlyName; f.model ??= up.modelName; f.manufacturer = up.manufacturer; }
    if (o.full) {
      const web: WebEndpoint[] = [];
      for (const p of f.ports.filter((x) => WEB_PORTS.includes(x))) { const w = await probeWeb(f.ip, p); if (w) web.push(w); }
      f.web = web;
      if (!f.server) f.server = web.find((w) => w.server)?.server;
      // Système et nom exact : Windows / Samba (SMB sans mot de passe), Linux (SSH), Apple.
      const deep = await import('./deep.ts');
      const [smb, ssh] = await Promise.all([f.ports.includes(445) ? deep.smbInfo(f.ip) : undefined, f.ports.includes(22) ? deep.sshBanner(f.ip) : undefined]);
      if (smb?.computer) f.netbios ??= sanitize(smb.computer, 40);
      if (smb?.dnsName && !f.hostname) f.hostname = sanitize(smb.dnsName);
      f.os = smb?.os ?? (ssh ? deep.osFromSsh(ssh) : undefined);
    }
    if (f.model && /^(iPhone|iPad|Mac|iMac|AppleTV|AudioAccessory)\w*\d+,\d+$/.test(f.model)) { const deep = await import('./deep.ts'); f.model = deep.appleModelName(f.model); f.os ??= /^iPhone/.test(f.model) ? 'iOS' : /^iPad/.test(f.model) ? 'iPadOS' : /^(Mac|iMac)/.test(f.model) ? 'macOS' : undefined; }
    if (!f.os && f.ports.includes(62078)) f.os = 'iOS / iPadOS';
  });
  return { subnets, found };
}
