// Le format des messages DNS (RFC 1035 et suivantes), écrit dans Odin : lire une question ou une réponse
// (noms compressés compris), fabriquer une réponse, corriger les durées de vie d'une réponse en cache.

export const TYPE: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, OPT: 41, DS: 43, RRSIG: 46, NSEC: 47, DNSKEY: 48, SVCB: 64, HTTPS: 65, CAA: 257, ANY: 255 };
export const TYPE_NAME: Record<number, string> = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));
export const typeName = (t: number) => TYPE_NAME[t] ?? `TYPE${t}`;
export const RCODE = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 } as const;
/** Types dont les données contiennent des noms (à décompresser quand on recopie l'enregistrement ailleurs). */
const NAMED = new Set([TYPE.NS, TYPE.CNAME, TYPE.PTR, TYPE.MX, TYPE.SOA, TYPE.SRV]);

export interface Question { name: string; type: number; cls: number }
export interface RR { name: string; type: number; cls: number; ttl: number; data: Buffer; ttlOff: number; dataOff: number }
export interface Message {
  id: number; qr: boolean; opcode: number; aa: boolean; tc: boolean; rd: boolean; ra: boolean; ad: boolean; cd: boolean; rcode: number;
  qd: Question[]; an: RR[]; ns: RR[]; ar: RR[]; raw: Buffer;
}

/** Lit un nom (avec pointeurs de compression) ; rend le nom en minuscules sans point final, et la suite. */
export function readName(b: Buffer, off: number): { name: string; next: number } {
  const labels: string[] = []; let next = -1, jumps = 0, p = off;
  for (;;) {
    if (p >= b.length) throw new Error('nom tronqué');
    const len = b[p];
    if (len === 0) { p++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (p + 1 >= b.length || ++jumps > 64) throw new Error('nom invalide');
      if (next < 0) next = p + 2;
      p = ((len & 0x3f) << 8) | b[p + 1]; continue;
    }
    if (len > 63 || p + 1 + len > b.length) throw new Error('étiquette invalide');
    labels.push(b.toString('latin1', p + 1, p + 1 + len)); p += 1 + len;
    if (labels.length > 127) throw new Error('nom trop long');
  }
  return { name: labels.join('.').toLowerCase(), next: next < 0 ? p : next };
}
export function writeName(name: string): Buffer {
  const parts = name.replace(/\.$/, '').split('.').filter(Boolean), out: Buffer[] = [];
  for (const l of parts) { const x = Buffer.from(l, 'latin1'); if (x.length > 63) throw new Error('étiquette trop longue'); out.push(Buffer.from([x.length]), x); }
  out.push(Buffer.from([0])); const r = Buffer.concat(out);
  if (r.length > 255) throw new Error('nom trop long');
  return r;
}

export function parse(b: Buffer): Message {
  if (b.length < 12) throw new Error('message trop court');
  const f = b.readUInt16BE(2), counts = [4, 6, 8, 10].map((o) => b.readUInt16BE(o));
  const m: Message = { id: b.readUInt16BE(0), qr: Boolean(f & 0x8000), opcode: (f >> 11) & 0xf, aa: Boolean(f & 0x400), tc: Boolean(f & 0x200), rd: Boolean(f & 0x100), ra: Boolean(f & 0x80), ad: Boolean(f & 0x20), cd: Boolean(f & 0x10), rcode: f & 0xf, qd: [], an: [], ns: [], ar: [], raw: b };
  let p = 12;
  for (let i = 0; i < counts[0]; i++) { const n = readName(b, p); p = n.next; if (p + 4 > b.length) throw new Error('question tronquée'); m.qd.push({ name: n.name, type: b.readUInt16BE(p), cls: b.readUInt16BE(p + 2) }); p += 4; }
  for (const [k, sec] of [[1, m.an], [2, m.ns], [3, m.ar]] as const) for (let i = 0; i < counts[k]; i++) {
    const n = readName(b, p); p = n.next; if (p + 10 > b.length) throw new Error('enregistrement tronqué');
    const type = b.readUInt16BE(p), cls = b.readUInt16BE(p + 2), ttl = b.readUInt32BE(p + 4), len = b.readUInt16BE(p + 8);
    if (p + 10 + len > b.length) throw new Error('données tronquées');
    sec.push({ name: n.name, type, cls, ttl, data: b.subarray(p + 10, p + 10 + len), ttlOff: p + 4, dataOff: p + 10 }); p += 10 + len;
  }
  return m;
}

/** Les données d'un enregistrement, avec ses noms décompressés (pour le recopier dans une autre réponse). */
export function plainData(msg: Buffer, rr: RR): Buffer {
  if (!NAMED.has(rr.type)) return Buffer.from(rr.data);
  const o = rr.dataOff;
  if (rr.type === TYPE.MX) return Buffer.concat([msg.subarray(o, o + 2), writeName(readName(msg, o + 2).name)]);
  if (rr.type === TYPE.SRV) return Buffer.concat([msg.subarray(o, o + 6), writeName(readName(msg, o + 6).name)]);
  if (rr.type === TYPE.SOA) { const a = readName(msg, o), c = readName(msg, a.next); return Buffer.concat([writeName(a.name), writeName(c.name), msg.subarray(c.next, c.next + 20)]); }
  return writeName(readName(msg, o).name);
}
/** Le nom contenu dans les données (CNAME, NS, PTR) ou l'adresse (A, AAAA), en clair. */
export function dataText(msg: Buffer, rr: RR): string {
  if (rr.type === TYPE.A && rr.data.length === 4) return [...rr.data].join('.');
  if (rr.type === TYPE.AAAA && rr.data.length === 16) return ipv6Text(rr.data);
  if (rr.type === TYPE.CNAME || rr.type === TYPE.NS || rr.type === TYPE.PTR) return readName(msg, rr.dataOff).name;
  if (rr.type === TYPE.MX) return `${rr.data.readUInt16BE(0)} ${readName(msg, rr.dataOff + 2).name}`;
  if (rr.type === TYPE.TXT) { const out: string[] = []; let p = 0; while (p < rr.data.length) { const l = rr.data[p]; out.push(rr.data.toString('utf8', p + 1, p + 1 + l)); p += 1 + l; } return out.join(''); }
  return `${rr.data.length} octets`;
}
export function ipv6Text(b: Buffer): string {
  const w = [...Array(8)].map((_x, i) => b.readUInt16BE(i * 2).toString(16));
  let best = [-1, 0], cur = [-1, 0];
  w.forEach((x, i) => { if (x === '0') { if (cur[0] < 0) cur = [i, 0]; cur[1]++; if (cur[1] > best[1]) best = [...cur]; } else cur = [-1, 0]; });
  if (best[1] < 2) return w.join(':');
  return `${w.slice(0, best[0]).join(':')}::${w.slice(best[0] + best[1]).join(':')}`;
}
export function ipv4Bytes(ip: string): Buffer | undefined { const p = ip.split('.'); return p.length === 4 && p.every((x) => /^\d{1,3}$/.test(x) && Number(x) < 256) ? Buffer.from(p.map(Number)) : undefined; }
export function ipv6Bytes(ip: string): Buffer | undefined {
  if (!/^[0-9a-f:.]+$/i.test(ip) || !ip.includes(':')) return undefined;
  const [h, t] = ip.split('::'); if (ip.split('::').length > 2) return undefined;
  const hs = h ? h.split(':') : [], ts = t !== undefined && t ? t.split(':') : [];
  const fill = ip.includes('::') ? 8 - hs.length - ts.length : 0; if (fill < 0 || (!ip.includes('::') && hs.length !== 8)) return undefined;
  const words = [...hs, ...Array(fill).fill('0'), ...ts]; if (words.length !== 8 || words.some((x) => !/^[0-9a-f]{1,4}$/i.test(x))) return undefined;
  const out = Buffer.alloc(16); words.forEach((x, i) => out.writeUInt16BE(parseInt(x, 16), i * 2)); return out;
}

export interface Answer { name: string; type: number; ttl: number; data: Buffer; cls?: number }
/** Données prêtes à mettre dans une réponse. */
export const rdata = {
  a: (ip: string) => ipv4Bytes(ip) ?? Buffer.alloc(4),
  aaaa: (ip: string) => ipv6Bytes(ip) ?? Buffer.alloc(16),
  name: (n: string) => writeName(n),
  txt: (s: string) => { const b = Buffer.from(s, 'utf8'), parts: Buffer[] = []; for (let i = 0; i < b.length || i === 0; i += 255) { const c = b.subarray(i, i + 255); parts.push(Buffer.from([c.length]), c); if (!b.length) break; } return Buffer.concat(parts); },
  mx: (pref: number, host: string) => { const p = Buffer.alloc(2); p.writeUInt16BE(pref); return Buffer.concat([p, writeName(host)]); },
  soa: (mname: string, rname: string, serial: number, minimum = 300) => { const n = Buffer.alloc(20); n.writeUInt32BE(serial >>> 0, 0); n.writeUInt32BE(3600, 4); n.writeUInt32BE(600, 8); n.writeUInt32BE(604800, 12); n.writeUInt32BE(minimum, 16); return Buffer.concat([writeName(mname), writeName(rname), n]); },
};

/** Fabrique une réponse à `q` (même identifiant, même question). `ra` : récursion disponible. */
export function respond(q: Message, o: { rcode?: number; an?: Answer[]; ns?: Answer[]; ar?: Answer[]; aa?: boolean; ra?: boolean; tc?: boolean } = {}): Buffer {
  const h = Buffer.alloc(12);
  h.writeUInt16BE(q.id, 0);
  h.writeUInt16BE(0x8000 | (q.opcode << 11) | (o.aa ? 0x400 : 0) | (o.tc ? 0x200 : 0) | (q.rd ? 0x100 : 0) | (o.ra !== false ? 0x80 : 0) | (q.cd ? 0x10 : 0) | ((o.rcode ?? 0) & 0xf), 2);
  const qd = q.qd.slice(0, 1), an = o.an ?? [], ns = o.ns ?? [], ar = o.ar ?? [];
  h.writeUInt16BE(qd.length, 4); h.writeUInt16BE(an.length, 6); h.writeUInt16BE(ns.length, 8); h.writeUInt16BE(ar.length, 10);
  const parts: Buffer[] = [h];
  for (const x of qd) { const t = Buffer.alloc(4); t.writeUInt16BE(x.type, 0); t.writeUInt16BE(x.cls, 2); parts.push(writeName(x.name), t); }
  for (const r of [...an, ...ns, ...ar]) { const t = Buffer.alloc(10); t.writeUInt16BE(r.type, 0); t.writeUInt16BE(r.cls ?? 1, 2); t.writeUInt32BE(Math.max(0, Math.floor(r.ttl)) >>> 0, 4); t.writeUInt16BE(r.data.length, 8); parts.push(writeName(r.name), t, r.data); }
  return Buffer.concat(parts);
}
/** Une question à envoyer (récursion demandée ou non), avec EDNS pour les réponses longues. */
export function query(name: string, type: number, o: { id?: number; rd?: boolean; edns?: boolean; cd?: boolean } = {}): Buffer {
  const h = Buffer.alloc(12); h.writeUInt16BE(o.id ?? Math.floor(Math.random() * 65536), 0); h.writeUInt16BE((o.rd !== false ? 0x100 : 0) | (o.cd ? 0x10 : 0), 2); h.writeUInt16BE(1, 4);
  const t = Buffer.alloc(4); t.writeUInt16BE(type, 0); t.writeUInt16BE(1, 2);
  if (o.edns === false) return Buffer.concat([h, writeName(name), t]);
  h.writeUInt16BE(1, 10);
  const opt = Buffer.alloc(11); opt[0] = 0; opt.writeUInt16BE(TYPE.OPT, 1); opt.writeUInt16BE(4096, 3); opt.writeUInt32BE(0, 5); opt.writeUInt16BE(0, 9);
  return Buffer.concat([h, writeName(name), t, opt]);
}
/** Recopie une réponse en changeant son identifiant et en retirant `age` secondes aux durées de vie. */
export function reuse(raw: Buffer, id: number, age = 0, floor = 0): Buffer {
  const b = Buffer.from(raw); b.writeUInt16BE(id, 0);
  if (age > 0 || floor > 0) { const m = parse(b); for (const r of [...m.an, ...m.ns]) b.writeUInt32BE(Math.max(floor, r.ttl - age) >>> 0, r.ttlOff); for (const r of m.ar) if (r.type !== TYPE.OPT) b.writeUInt32BE(Math.max(floor, r.ttl - age) >>> 0, r.ttlOff); }
  return b;
}
/** Le plus petit TTL d'une réponse (pour savoir combien de temps la garder) ; NXDOMAIN : minimum du SOA. */
export function minTtl(m: Message): number | undefined {
  const rrs = [...m.an, ...m.ns].filter((r) => r.type !== TYPE.OPT);
  if (!rrs.length) return undefined;
  if (!m.an.length) { const soa = m.ns.find((r) => r.type === TYPE.SOA); if (soa) return Math.min(soa.ttl, soa.data.length >= 4 ? soa.data.readUInt32BE(soa.data.length - 4) : soa.ttl); }
  return Math.min(...rrs.map((r) => r.ttl));
}
