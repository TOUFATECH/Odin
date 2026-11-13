// Mercure — le relais de messages d'Odin : un serveur MQTT 3.1.1 écrit pour Odin (QoS 0 et 1,
// messages retenus, jokers + et #, identifiants, message de dernière volonté). Les appareils
// (prises flashées, modules ESP, passerelles Zigbee/Z-Wave, capteurs) y publient leur état ;
// Odin s'y abonne et y envoie ses ordres.

import { createServer, type Server, type Socket } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

export interface Msg { topic: string; payload: Buffer; retain: boolean; qos: number }
type Sub = { filter: string; qos: number };
interface Client { id: string; sock: Socket; subs: Sub[]; will?: Msg; user?: string; alive: number; nextId: number }

export function matches(filter: string, topic: string): boolean {
  if (filter === '#') return !topic.startsWith('$');
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
    if (i === 0 && t[0].startsWith('$') && (f[0] === '+')) return false;
  }
  return f.length === t.length;
}
/** Longueur restante (encodage variable MQTT). */
export function encLen(n: number): Buffer { const out: number[] = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0); return Buffer.from(out); }
export function decLen(b: Buffer, at: number): { len: number; used: number } | undefined { let mult = 1, len = 0, i = 0; for (;;) { if (at + i >= b.length) return undefined; const c = b[at + i]; len += (c & 127) * mult; i++; if (!(c & 128)) break; mult *= 128; if (i > 4) throw new Error('longueur invalide'); } return { len, used: i }; }
const str = (s: string) => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
export function packet(type: number, flags: number, body: Buffer): Buffer { return Buffer.concat([Buffer.from([(type << 4) | flags]), encLen(body.length), body]); }
export function publishPacket(m: Msg, id = 0): Buffer {
  const parts: Buffer[] = [str(m.topic)]; if (m.qos > 0) { const i = Buffer.alloc(2); i.writeUInt16BE(id); parts.push(i); }
  parts.push(m.payload); return packet(3, (m.qos << 1) | (m.retain ? 1 : 0), Buffer.concat(parts));
}

export class MqttBroker {
  private srv?: Server;
  private clients = new Map<string, Client>();
  readonly retained = new Map<string, Msg>();
  private listeners: Array<{ filter: string; fn: (m: Msg) => void }> = [];
  private auth?: { user: string; pass: string };
  constructor(o: { user?: string; pass?: string } = {}) { if (o.user && o.pass) this.auth = { user: o.user, pass: o.pass }; }
  listen(port: number, host = '0.0.0.0'): Promise<void> { return new Promise((res, rej) => { this.srv = createServer((s) => this.accept(s)); this.srv.once('error', rej); this.srv.listen(port, host, () => res()); }); }
  close(): void { for (const c of this.clients.values()) c.sock.destroy(); this.clients.clear(); this.srv?.close(); }
  connected(): Array<{ id: string; user?: string; subs: string[] }> { return [...this.clients.values()].map((c) => ({ id: c.id, user: c.user, subs: c.subs.map((x) => x.filter) })); }
  /** Abonnement interne (Odin). */
  on(filter: string, fn: (m: Msg) => void): () => void { const l = { filter, fn }; this.listeners.push(l); for (const m of this.retained.values()) if (matches(filter, m.topic)) fn(m); return () => { this.listeners = this.listeners.filter((x) => x !== l); }; }
  /** Publication interne (Odin → appareils). */
  publish(topic: string, payload: string | Buffer, o: { retain?: boolean; qos?: number } = {}): void { this.route({ topic, payload: Buffer.isBuffer(payload) ? payload : Buffer.from(payload), retain: Boolean(o.retain), qos: o.qos ?? 0 }); }
  private route(m: Msg): void {
    if (m.retain) { if (m.payload.length) this.retained.set(m.topic, m); else this.retained.delete(m.topic); }
    for (const l of this.listeners) if (matches(l.filter, m.topic)) { try { l.fn(m); } catch { /* auditeur en erreur */ } }
    for (const c of this.clients.values()) {
      const sub = c.subs.filter((x) => matches(x.filter, m.topic)).sort((a, b) => b.qos - a.qos)[0];
      if (!sub) continue;
      const qos = Math.min(sub.qos, m.qos, 1); c.nextId = (c.nextId % 65535) + 1;
      c.sock.write(publishPacket({ ...m, qos, retain: false }, c.nextId));
    }
  }
  private accept(sock: Socket): void {
    let buf = Buffer.alloc(0), client: Client | undefined;
    sock.setTimeout(90_000, () => sock.destroy());
    sock.on('error', () => {});
    const drop = (graceful: boolean) => { if (!client) return; if (this.clients.get(client.id) === client) this.clients.delete(client.id); if (!graceful && client.will) this.route(client.will); client = undefined; };
    sock.on('close', () => drop(false));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]); if (buf.length > 1024 * 1024) { sock.destroy(); return; }
      for (;;) {
        if (buf.length < 2) return;
        let L; try { L = decLen(buf, 1); } catch { sock.destroy(); return; }
        if (!L || buf.length < 1 + L.used + L.len) return;
        const type = buf[0] >> 4, flags = buf[0] & 15, body = buf.subarray(1 + L.used, 1 + L.used + L.len);
        buf = buf.subarray(1 + L.used + L.len);
        try { this.handle(sock, type, flags, body, () => client, (c) => { client = c; }, drop); } catch { sock.destroy(); return; }
      }
    });
  }
  private handle(sock: Socket, type: number, flags: number, b: Buffer, get: () => Client | undefined, set: (c: Client) => void, drop: (g: boolean) => void): void {
    const rd = (at: number) => { const n = b.readUInt16BE(at); return { s: b.subarray(at + 2, at + 2 + n), next: at + 2 + n }; };
    if (type === 1) { // CONNECT
      const proto = rd(0), lvl = b[proto.next], cf = b[proto.next + 1], keep = b.readUInt16BE(proto.next + 2);
      let at = proto.next + 4; const id = rd(at); at = id.next;
      let will: Msg | undefined, user: string | undefined, pass: string | undefined;
      if (cf & 4) { const wt = rd(at); const wp = rd(wt.next); at = wp.next; will = { topic: wt.s.toString(), payload: Buffer.from(wp.s), qos: (cf >> 3) & 3, retain: Boolean(cf & 32) }; }
      if (cf & 128) { const u = rd(at); user = u.s.toString(); at = u.next; }
      if (cf & 64) { const p = rd(at); pass = p.s.toString(); at = p.next; }
      if (proto.s.toString() !== 'MQTT' || lvl !== 4) { sock.end(packet(2, 0, Buffer.from([0, 1]))); return; }
      if (this.auth && !(user === this.auth.user && pass !== undefined && pass.length === this.auth.pass.length && timingSafeEqual(Buffer.from(pass), Buffer.from(this.auth.pass)))) { sock.end(packet(2, 0, Buffer.from([0, 5]))); return; }
      const cid = id.s.toString() || `odin-${Math.random().toString(36).slice(2, 10)}`;
      this.clients.get(cid)?.sock.destroy();
      const c: Client = { id: cid, sock, subs: [], will, user, alive: keep, nextId: 0 };
      this.clients.set(cid, c); set(c);
      if (keep) sock.setTimeout(keep * 1500, () => sock.destroy());
      sock.write(packet(2, 0, Buffer.from([0, 0])));
      return;
    }
    const c = get(); if (!c) { sock.destroy(); return; }
    switch (type) {
      case 3: { // PUBLISH
        const qos = (flags >> 1) & 3, t = rd(0); let at = t.next, id = 0;
        if (qos > 0) { id = b.readUInt16BE(at); at += 2; }
        const topic = t.s.toString(); if (/[#+]/.test(topic)) { sock.destroy(); return; }
        this.route({ topic, payload: Buffer.from(b.subarray(at)), retain: Boolean(flags & 1), qos: Math.min(qos, 1) });
        if (qos === 1) { const p = Buffer.alloc(2); p.writeUInt16BE(id); sock.write(packet(4, 0, p)); }
        if (qos === 2) { const p = Buffer.alloc(2); p.writeUInt16BE(id); sock.write(packet(5, 0, p)); }
        return;
      }
      case 6: { sock.write(packet(7, 0, b.subarray(0, 2))); return; } // PUBREL → PUBCOMP
      case 8: { // SUBSCRIBE
        const id = b.subarray(0, 2); let at = 2; const codes: number[] = [];
        while (at < b.length) { const f = rd(at); const qos = Math.min(b[f.next] & 3, 1); at = f.next + 1; const filter = f.s.toString(); c.subs = [...c.subs.filter((x) => x.filter !== filter), { filter, qos }]; codes.push(qos); for (const m of this.retained.values()) if (matches(filter, m.topic)) sock.write(publishPacket({ ...m, qos: 0, retain: true })); }
        sock.write(packet(9, 0, Buffer.concat([id, Buffer.from(codes)])));
        return;
      }
      case 10: { const id = b.subarray(0, 2); let at = 2; while (at < b.length) { const f = rd(at); at = f.next; c.subs = c.subs.filter((x) => x.filter !== f.s.toString()); } sock.write(packet(11, 0, id)); return; }
      case 12: sock.write(packet(13, 0, Buffer.alloc(0))); return;
      case 14: drop(true); sock.end(); return;
      default: return;
    }
  }
}
