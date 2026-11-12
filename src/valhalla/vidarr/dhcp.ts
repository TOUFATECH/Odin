// Le serveur DHCP d'Odin (dans Víðarr) : il donne aux appareils de la maison leur adresse, la box comme
// passerelle et Odin comme DNS. Baux enregistrés, adresses fixes par appareil (adresse MAC), noms des
// appareils retenus (et servis par le DNS : « telephone-awa.maison »). Écrit dans Odin (RFC 2131 / 2132).
//
// À NE PAS faire tourner en même temps que le DHCP de la box : Víðarr vérifie qu'aucun autre serveur ne
// répond avant de s'allumer.

import dgram from 'node:dgram';

export const MSG = { DISCOVER: 1, OFFER: 2, REQUEST: 3, DECLINE: 4, ACK: 5, NAK: 6, RELEASE: 7, INFORM: 8 } as const;
const MAGIC = 0x63825363;
export interface Packet { op: number; xid: number; secs: number; flags: number; ciaddr: string; yiaddr: string; siaddr: string; giaddr: string; mac: string; options: Map<number, Buffer> }

const ipStr = (b: Buffer, o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
export const ipNum = (s: string) => s.split('.').reduce((n, x) => n * 256 + Number(x), 0) >>> 0;
export const numIp = (n: number) => [24, 16, 8, 0].map((sh) => (n >>> sh) & 255).join('.');
const ipBuf = (s: string) => Buffer.from(s.split('.').map(Number));

export function parsePacket(b: Buffer): Packet {
  if (b.length < 240 || b.readUInt32BE(236) !== MAGIC) throw new Error('paquet DHCP invalide');
  const hlen = Math.min(16, b[2]), mac = [...b.subarray(28, 28 + hlen)].map((x) => x.toString(16).padStart(2, '0')).join(':');
  const options = new Map<number, Buffer>(); let p = 240;
  while (p < b.length) {
    const code = b[p]; if (code === 255) break; if (code === 0) { p++; continue; }
    const len = b[p + 1]; if (p + 2 + len > b.length) break;
    options.set(code, Buffer.concat([options.get(code) ?? Buffer.alloc(0), b.subarray(p + 2, p + 2 + len)])); p += 2 + len;
  }
  return { op: b[0], xid: b.readUInt32BE(4), secs: b.readUInt16BE(8), flags: b.readUInt16BE(10), ciaddr: ipStr(b, 12), yiaddr: ipStr(b, 16), siaddr: ipStr(b, 20), giaddr: ipStr(b, 24), mac, options };
}
export function buildPacket(p: Partial<Omit<Packet, 'options'>> & { op: number; xid: number; mac: string; options: Array<[number, Buffer]> }): Buffer {
  const b = Buffer.alloc(240);
  b[0] = p.op; b[1] = 1; b[2] = 6; b.writeUInt32BE(p.xid, 4); b.writeUInt16BE(p.secs ?? 0, 8); b.writeUInt16BE(p.flags ?? 0, 10);
  ipBuf(p.ciaddr ?? '0.0.0.0').copy(b, 12); ipBuf(p.yiaddr ?? '0.0.0.0').copy(b, 16); ipBuf(p.siaddr ?? '0.0.0.0').copy(b, 20); ipBuf(p.giaddr ?? '0.0.0.0').copy(b, 24);
  Buffer.from(p.mac.split(':').map((x) => parseInt(x, 16))).copy(b, 28);
  b.writeUInt32BE(MAGIC, 236);
  const opts: Buffer[] = [];
  for (const [code, v] of p.options) for (let i = 0; i < v.length || i === 0; i += 255) { const c = v.subarray(i, i + 255); opts.push(Buffer.from([code, c.length]), c); if (!v.length) break; }
  const out = Buffer.concat([b, ...opts, Buffer.from([255])]);
  return out.length < 300 ? Buffer.concat([out, Buffer.alloc(300 - out.length)]) : out;
}
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

export interface Lease { mac: string; ip: string; name?: string; expires: number; fixed?: boolean; /** première fois vu (ms) */ first?: number; /** ce que l'appareil dit de lui au DHCP (« android-dhcp-14 », « MSFT 5.0 »…) */ vendorClass?: string }
/** Le système d'après ce que l'appareil dit au DHCP (deviné : à confirmer). Pur. */
export function osFromVendorClass(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const a = /android-dhcp-(\d+)/i.exec(v); if (a) return `Android ${a[1]}`;
  if (/^MSFT/i.test(v)) return 'Windows'; if (/dhcpcd/i.test(v)) return 'Linux ou Android'; if (/udhcp/i.test(v)) return 'Linux embarqué (box, caméra, objet)'; if (/^ubnt|ubiquiti/i.test(v)) return 'Ubiquiti';
  return v.slice(0, 40);
}
/** Une MAC « privée » (bit local) : téléphone ou tablette récents en Wi-Fi, qui changent d'adresse par réseau. */
export const randomMac = (mac: string) => /^.[26ae]/i.test(mac);
export interface DhcpConfig {
  /** adresse d'Odin sur le réseau (identifiant du serveur) */
  server: string;
  start: string; end: string; mask: string; router: string; dns: string[]; leaseSeconds: number; domain?: string;
  /** adresses fixes : MAC → adresse (et nom) */
  fixed: Array<{ mac: string; ip: string; name?: string }>;
}
export interface DhcpDeps { config: () => DhcpConfig; leases: () => Lease[]; save: (l: Lease[]) => void; now?: () => number; onLease?: (l: Lease, isNew: boolean) => void; log?: (s: string) => void }

/** Nom propre pour le DNS (« Téléphone d'Awa » → « telephone-d-awa »). */
export const hostLabel = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

export class DhcpServer {
  sock?: dgram.Socket; port = 67; clientPort = 68;
  private declined = new Map<string, number>(); private offered = new Map<string, { ip: string; at: number }>();
  private d: DhcpDeps; private now: () => number;
  constructor(d: DhcpDeps) { this.d = d; this.now = d.now ?? Date.now; }

  async start(port = 67, clientPort = 68, host = '0.0.0.0'): Promise<void> {
    this.port = port; this.clientPort = clientPort;
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((ok, ko) => { s.once('error', ko); s.bind(port, host, () => { s.off('error', ko); ok(); }); });
    s.setBroadcast(true); s.on('message', (m, r) => { try { this.onMessage(m, r); } catch (e) { this.d.log?.(`DHCP : ${(e as Error).message}`); } });
    this.sock = s;
  }
  stop(): void { try { this.sock?.close(); } catch { /* déjà fermé */ } this.sock = undefined; }

  /** L'adresse à proposer à cet appareil : fixe, son bail, celle qu'il demande si libre, sinon la première libre. */
  pick(mac: string, wanted?: string): string | undefined {
    const c = this.d.config(), now = this.now(), leases = this.d.leases();
    const fixed = c.fixed.find((f) => f.mac.toLowerCase() === mac); if (fixed) return fixed.ip;
    const mine = leases.find((l) => l.mac === mac); if (mine) return mine.ip;
    const lo = ipNum(c.start), hi = ipNum(c.end);
    const taken = new Set([...leases.filter((l) => l.expires > now || l.fixed).map((l) => l.ip), ...c.fixed.map((f) => f.ip), c.server, c.router, ...[...this.offered.entries()].filter(([m, o]) => m !== mac && now - o.at < 60_000).map(([, o]) => o.ip)]);
    for (const [ip, until] of this.declined) if (until > now) taken.add(ip);
    if (wanted && ipNum(wanted) >= lo && ipNum(wanted) <= hi && !taken.has(wanted)) return wanted;
    for (let n = lo; n <= hi; n++) if (!taken.has(numIp(n))) return numIp(n);
    // Plus rien de libre : on reprend le bail expiré le plus ancien.
    const old = leases.filter((l) => !l.fixed && l.expires <= now).sort((a, b) => a.expires - b.expires)[0];
    return old?.ip;
  }
  private reply(p: Packet, type: number, ip: string, extra: Array<[number, Buffer]> = []): void {
    const c = this.d.config(), opts: Array<[number, Buffer]> = [[53, Buffer.from([type])], [54, ipBuf(c.server)]];
    if (type !== MSG.NAK) {
      opts.push([1, ipBuf(c.mask)], [3, ipBuf(c.router)], [6, Buffer.concat(c.dns.map(ipBuf))]);
      if (type !== MSG.ACK || p.options.get(53)?.[0] !== MSG.INFORM) opts.push([51, u32(c.leaseSeconds)], [58, u32(Math.floor(c.leaseSeconds / 2))], [59, u32(Math.floor(c.leaseSeconds * 0.875))]);
      if (c.domain) opts.push([15, Buffer.from(c.domain)]);
    }
    const out = buildPacket({ op: 2, xid: p.xid, flags: p.flags, ciaddr: type === MSG.ACK && p.options.get(53)?.[0] === MSG.INFORM ? p.ciaddr : '0.0.0.0', yiaddr: type === MSG.NAK || p.options.get(53)?.[0] === MSG.INFORM ? '0.0.0.0' : ip, siaddr: '0.0.0.0', giaddr: p.giaddr, mac: p.mac, options: [...opts, ...extra] });
    // Un appareil qui a déjà son adresse reçoit la réponse directement ; sinon à tout le réseau (il n'a pas encore d'adresse).
    const to = p.giaddr !== '0.0.0.0' ? p.giaddr : p.ciaddr !== '0.0.0.0' && type !== MSG.NAK ? p.ciaddr : '255.255.255.255';
    this.sock?.send(out, p.giaddr !== '0.0.0.0' ? this.port : this.clientPort, to);
  }
  private keep(l: Lease): void {
    const all = this.d.leases(), old = all.find((x) => x.mac === l.mac), isNew = !old;
    l = { ...l, first: old?.first ?? this.now(), ...(l.vendorClass ?? old?.vendorClass ? { vendorClass: l.vendorClass ?? old?.vendorClass } : {}) };
    this.d.save([...all.filter((x) => x.mac !== l.mac && x.ip !== l.ip), l]);
    this.d.onLease?.(l, isNew);
  }
  onMessage(m: Buffer, _r?: dgram.RemoteInfo): void {
    const p = parsePacket(m); if (p.op !== 1) return;
    const type = p.options.get(53)?.[0], c = this.d.config(), now = this.now();
    const name = p.options.get(12)?.toString('utf8').replace(/[^\p{L}\p{N} ._'-]/gu, '').slice(0, 63) || undefined;
    const requested = p.options.get(50)?.length === 4 ? ipStr(p.options.get(50)!, 0) : undefined;
    const serverId = p.options.get(54)?.length === 4 ? ipStr(p.options.get(54)!, 0) : undefined;
    if (type === MSG.DISCOVER) {
      const ip = this.pick(p.mac, requested); if (!ip) { this.d.log?.(`DHCP : plus d'adresse libre pour ${p.mac}`); return; }
      this.offered.set(p.mac, { ip, at: now }); this.reply(p, MSG.OFFER, ip); return;
    }
    if (type === MSG.REQUEST) {
      if (serverId && serverId !== c.server) { this.offered.delete(p.mac); return; }   // il a choisi un autre serveur
      const want = requested ?? (p.ciaddr !== '0.0.0.0' ? p.ciaddr : undefined);
      const ip = this.pick(p.mac, want);
      if (!want || ip !== want) { this.reply(p, MSG.NAK, '0.0.0.0'); return; }
      const fixed = c.fixed.find((f) => f.mac.toLowerCase() === p.mac);
      this.keep({ mac: p.mac, ip, name: fixed?.name ?? name ?? this.d.leases().find((l) => l.mac === p.mac)?.name, expires: now + c.leaseSeconds * 1000, ...(fixed ? { fixed: true } : {}), ...(p.options.get(60)?.length ? { vendorClass: p.options.get(60)!.toString('latin1').replace(/[^\x20-\x7e]/g, '').slice(0, 60) } : {}) });
      this.offered.delete(p.mac); this.reply(p, MSG.ACK, ip); return;
    }
    if (type === MSG.RELEASE) { this.d.save(this.d.leases().map((l) => (l.mac === p.mac && !l.fixed ? { ...l, expires: now } : l))); return; }
    if (type === MSG.DECLINE) { if (requested) this.declined.set(requested, now + 3600_000); this.d.save(this.d.leases().filter((l) => !(l.mac === p.mac && l.ip === requested))); return; }
    if (type === MSG.INFORM) this.reply(p, MSG.ACK, p.ciaddr);
  }
}

/** Y a-t-il déjà un serveur DHCP sur le réseau (la box) ? On pose la question comme un appareil, et on écoute. */
export function detectDhcp(o: { waitMs?: number; serverPort?: number; clientPort?: number; to?: string } = {}): Promise<string[]> {
  return new Promise((ok) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true }), found = new Set<string>(), xid = Math.floor(Math.random() * 0xffffffff);
    const mac = `02:${[...Array(5)].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':')}`;
    const done = () => { try { s.close(); } catch { /* */ } ok([...found]); };
    s.on('error', () => done());
    s.on('message', (m) => { try { const p = parsePacket(m); if (p.op === 2 && p.xid === xid) { const id = p.options.get(54); found.add(id?.length === 4 ? ipStr(id, 0) : p.siaddr); } } catch { /* pas pour nous */ } });
    s.bind(o.clientPort ?? 68, () => {
      s.setBroadcast(true);
      s.send(buildPacket({ op: 1, xid, mac, flags: 0x8000, options: [[53, Buffer.from([MSG.DISCOVER])], [55, Buffer.from([1, 3, 6, 15])]] }), o.serverPort ?? 67, o.to ?? '255.255.255.255');
      setTimeout(done, o.waitMs ?? 3000);
    });
  });
}
