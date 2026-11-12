// SNMP v1 / v2c (lecture seule, GET) écrit pour Odin, sans bibliothèque : lire un compteur ou un état sur une
// box, un switch, une imprimante, un onduleur, un NAS (comme Zabbix ou Centreon).
import dgram from 'node:dgram';
import { randomInt } from 'node:crypto';

// ---------------- BER (le codage des messages SNMP) ----------------
function len(n: number): Buffer { if (n < 0x80) return Buffer.from([n]); const b: number[] = []; while (n > 0) { b.unshift(n & 0xff); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); }
const tlv = (t: number, v: Buffer) => Buffer.concat([Buffer.from([t]), len(v.length), v]);
function intBytes(n: number): Buffer { const b: number[] = []; let x = n; do { b.unshift(x & 0xff); x = Math.floor(x / 256); } while (x > 0 && x !== -1); if (n >= 0 && b[0] & 0x80) b.unshift(0); return Buffer.from(b); }
export const int = (n: number) => tlv(0x02, intBytes(n));
export const str = (s: string | Buffer) => tlv(0x04, Buffer.isBuffer(s) ? s : Buffer.from(s));
export const nul = () => Buffer.from([0x05, 0x00]);
export function oid(s: string): Buffer {
  const p = s.replace(/^\./, '').split('.').map(Number); if (p.length < 2 || p.some((x) => !Number.isInteger(x) || x < 0)) throw new Error(`OID invalide : ${s}`);
  const out: number[] = [p[0] * 40 + p[1]];
  for (const x of p.slice(2)) { const b: number[] = [x & 0x7f]; let v = Math.floor(x / 128); while (v > 0) { b.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(...b); }
  return tlv(0x06, Buffer.from(out));
}
export const seq = (...x: Buffer[]) => tlv(0x30, Buffer.concat(x));
interface Node { t: number; v: Buffer; end: number }
function read(b: Buffer, at: number): Node {
  const t = b[at]; let l = b[at + 1], p = at + 2;
  if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) l = l * 256 + b[p + i]; p += n; }
  if (p + l > b.length) throw new Error('réponse SNMP tronquée');
  return { t, v: b.subarray(p, p + l), end: p + l };
}
const kids = (v: Buffer) => { const out: Node[] = []; let at = 0; while (at < v.length) { const n = read(v, at); out.push(n); at = n.end; } return out; };
const uint = (v: Buffer) => { let n = 0; for (const x of v) n = n * 256 + x; return n; };
export function oidText(v: Buffer): string { const out = [Math.floor(v[0] / 40), v[0] % 40]; let x = 0; for (const b of v.subarray(1)) { x = x * 128 + (b & 0x7f); if (!(b & 0x80)) { out.push(x); x = 0; } } return out.join('.'); }
/** Une valeur SNMP en texte ou en nombre. */
export function value(n: Node): string | number | null {
  switch (n.t) {
    case 0x02: return n.v.length ? (n.v[0] & 0x80 ? uint(n.v) - 256 ** n.v.length : uint(n.v)) : 0;
    case 0x04: return /^[\x20-\x7e\t\r\n]*$/.test(n.v.toString('latin1')) ? n.v.toString('utf8') : n.v.toString('hex');
    case 0x06: return oidText(n.v);
    case 0x40: return [...n.v].join('.');
    case 0x41: case 0x42: case 0x43: case 0x46: return uint(n.v); // Counter32, Gauge32, TimeTicks, Counter64
    case 0x05: case 0x80: case 0x81: case 0x82: return null; // NULL, noSuchObject, noSuchInstance, endOfMibView
    default: return n.v.toString('hex');
  }
}

/** Le message GET. Pur. */
export function getRequest(community: string, oids: string[], version: 1 | 2 = 2, id = randomInt(1, 2 ** 31 - 1)): Buffer {
  const vbs = seq(...oids.map((o) => seq(oid(o), nul())));
  return seq(int(version === 1 ? 0 : 1), str(community), tlv(0xa0, Buffer.concat([int(id), int(0), int(0), vbs])));
}
/** Décode une réponse (GetResponse). Pur. */
export function parseResponse(b: Buffer): { id: number; error: number; values: Array<{ oid: string; value: string | number | null }> } {
  const msg = kids(read(b, 0).v), pdu = msg[2]; if (!pdu || pdu.t !== 0xa2) throw new Error('réponse SNMP inattendue');
  const [id, err, , vbs] = kids(pdu.v);
  return { id: uint(id.v), error: uint(err.v), values: kids(vbs.v).map((vb) => { const [o, val] = kids(vb.v); return { oid: oidText(o.v), value: value(val) }; }) };
}
const ERR: Record<number, string> = { 1: 'réponse trop grande', 2: 'OID inconnu', 3: 'mauvaise valeur', 4: 'lecture seule', 5: 'erreur de l\'appareil' };

/** Lit des OID sur un appareil (UDP 161). */
export function snmpGet(host: string, oids: string[], o: { community?: string; version?: 1 | 2; port?: number; timeoutMs?: number } = {}): Promise<Array<{ oid: string; value: string | number | null }>> {
  const id = randomInt(1, 2 ** 31 - 1), msg = getRequest(o.community ?? 'public', oids, o.version ?? 2, id), sock = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
  return new Promise((ok, ko) => {
    const t = setTimeout(() => { sock.close(); ko(new Error('pas de réponse SNMP (communauté fausse, SNMP coupé, ou pare-feu)')); }, o.timeoutMs ?? 3000);
    sock.on('message', (b) => { try { const r = parseResponse(b); if (r.id !== id) return; clearTimeout(t); sock.close(); if (r.error) ko(new Error(`SNMP : ${ERR[r.error] ?? `erreur ${r.error}`}`)); else ok(r.values); } catch (e) { clearTimeout(t); sock.close(); ko(e); } });
    sock.on('error', (e) => { clearTimeout(t); sock.close(); ko(e); });
    sock.send(msg, o.port ?? 161, host);
  });
}
/** Quelques OID utiles, par leur nom. */
export const OIDS: Record<string, string> = { nom: '1.3.6.1.2.1.1.5.0', description: '1.3.6.1.2.1.1.1.0', allume: '1.3.6.1.2.1.1.3.0', 'entrees.1': '1.3.6.1.2.1.2.2.1.10.1', 'sorties.1': '1.3.6.1.2.1.2.2.1.16.1', 'onduleur.batterie': '1.3.6.1.2.1.33.1.2.4.0', 'imprimante.encre': '1.3.6.1.2.1.43.11.1.1.9.1.1' };
