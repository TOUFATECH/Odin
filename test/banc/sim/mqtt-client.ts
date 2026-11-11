// Petit client MQTT 3.1.1 pour les appareils simulés du banc (connexion avec identifiant, message
// de dernière volonté, abonnement, publication). Le relais d'Odin est aussi essayé contre un vrai
// client tiers (mosquitto) dans le banc, pour ne pas se valider tout seul.

import { connect, type Socket } from 'node:net';
import { decLen, packet } from '../../../src/valhalla/mqtt.ts';

const str = (s: string | Buffer) => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };

export class MqttClient {
  private sock?: Socket;
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private subacks = new Map<number, () => void>();
  private ping?: ReturnType<typeof setInterval>;
  private handlers: Array<(topic: string, payload: Buffer) => void> = [];
  connected = false;

  on(fn: (topic: string, payload: Buffer) => void): void { this.handlers.push(fn); }

  connect(host: string, port: number, o: { clientId: string; user?: string; pass?: string; will?: { topic: string; payload: string; retain?: boolean }; keepalive?: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect({ host, port }); this.sock = sock;
      const fail = (e: Error) => { this.connected = false; reject(e); };
      sock.once('error', (e) => fail(new Error(`relais injoignable : ${e.message}`)));
      sock.setTimeout(8000, () => { if (!this.connected) { sock.destroy(); fail(new Error('relais muet')); } });
      sock.on('close', () => { this.connected = false; if (this.ping) clearInterval(this.ping); });
      sock.once('connect', () => {
        let flags = 0x02; // session propre
        const payload: Buffer[] = [str(o.clientId)];
        if (o.will) { flags |= 0x04 | (o.will.retain ? 0x20 : 0); payload.push(str(o.will.topic), str(o.will.payload)); }
        if (o.user !== undefined) { flags |= 0x80; payload.push(str(o.user)); }
        if (o.pass !== undefined) { flags |= 0x40; payload.push(str(o.pass)); }
        const keep = Buffer.alloc(2); keep.writeUInt16BE(o.keepalive ?? 30);
        sock.write(packet(1, 0, Buffer.concat([str('MQTT'), Buffer.from([4, flags]), keep, ...payload])));
      });
      sock.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        for (;;) {
          if (this.buf.length < 2) return;
          const L = decLen(this.buf, 1); if (!L || this.buf.length < 1 + L.used + L.len) return;
          const type = this.buf[0] >> 4, flags = this.buf[0] & 15, body = this.buf.subarray(1 + L.used, 1 + L.used + L.len);
          this.buf = this.buf.subarray(1 + L.used + L.len);
          if (type === 2) { // CONNACK
            if (body[1] !== 0) { sock.destroy(); fail(new Error(body[1] === 5 || body[1] === 4 ? 'identifiants refusés par le relais' : `connexion refusée (code ${body[1]})`)); return; }
            this.connected = true; sock.setTimeout(0);
            this.ping = setInterval(() => sock.write(packet(12, 0, Buffer.alloc(0))), Math.max(5, (o.keepalive ?? 30) / 2) * 1000); this.ping.unref();
            resolve();
          } else if (type === 3) { // PUBLISH
            const qos = (flags >> 1) & 3, n = body.readUInt16BE(0), topic = body.subarray(2, 2 + n).toString('utf8');
            let at = 2 + n; if (qos > 0) { const id = body.subarray(at, at + 2); at += 2; sock.write(packet(4, 0, id)); }
            const payload = Buffer.from(body.subarray(at));
            for (const h of this.handlers) h(topic, payload);
          } else if (type === 9) { const id = body.readUInt16BE(0); this.subacks.get(id)?.(); this.subacks.delete(id); }
        }
      });
    });
  }
  publish(topic: string, payload: string | Buffer, o: { retain?: boolean } = {}): void {
    this.sock?.write(packet(3, o.retain ? 1 : 0, Buffer.concat([str(topic), Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')])));
  }
  subscribe(filter: string): Promise<void> {
    return new Promise((resolve) => { const id = this.nextId++; const b = Buffer.alloc(2); b.writeUInt16BE(id); this.subacks.set(id, resolve); this.sock?.write(packet(8, 2, Buffer.concat([b, str(filter), Buffer.from([0])]))); });
  }
  /** Fermeture propre (DISCONNECT) ou brutale (coupure : le relais publie alors la dernière volonté). */
  close(graceful = true): void { if (!this.sock) return; if (graceful) this.sock.end(packet(14, 0, Buffer.alloc(0))); else this.sock.destroy(); this.connected = false; if (this.ping) clearInterval(this.ping); }
}
