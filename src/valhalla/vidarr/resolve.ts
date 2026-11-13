// Où Sphinx va chercher les réponses : serveurs amont (UDP, TCP, chiffré TLS, chiffré HTTPS),
// en parallèle, l'un après l'autre ou le plus rapide ; ou tout seul depuis la racine d'Internet (récursif,
// sans dépendre d'aucun fournisseur). Un cache garde les réponses le temps qu'elles indiquent.

import dgram from 'node:dgram';
import net from 'node:net';
import tls from 'node:tls';
import { isIPv4, isIPv6 } from 'node:net';
import { RCODE, TYPE, dataText, minTtl, parse, plainData, query, respond, reuse, type Answer, type Message, type RR } from './wire.ts';

export interface Upstream { kind: 'udp' | 'tcp' | 'tls' | 'https' | 'recursif'; host: string; port: number; servername?: string; url?: string; label: string }
/** « 9.9.9.9 », « udp://1.1.1.1:53 », « tcp://… », « tls://dns.quad9.net », « tls://9.9.9.9@dns.quad9.net », « https://dns.quad9.net/dns-query », « récursif ». */
export function parseUpstream(s: string): Upstream {
  const t = s.trim();
  if (/^r[ée]cursif$/i.test(t)) return { kind: 'recursif', host: '', port: 0, label: 'récursif (depuis la racine)' };
  if (/^https:\/\//i.test(t)) { const u = new URL(t); return { kind: 'https', host: u.hostname, port: Number(u.port) || 443, url: u.toString(), label: t }; }
  const m = /^(udp|tcp|tls):\/\/(.+)$/i.exec(t), kind = (m?.[1].toLowerCase() ?? 'udp') as 'udp' | 'tcp' | 'tls', rest = m ? m[2] : t;
  const at = rest.split('@'), addr = at[0], servername = at[1]?.replace(/:\d+$/, '');
  const hp = /^\[([^\]]+)\](?::(\d+))?$/.exec(addr) ?? /^([^:]+)(?::(\d+))?$/.exec(addr) ?? (isIPv6(addr) ? [addr, addr, undefined] : null);
  if (!hp) throw new Error(`serveur amont invalide : ${s}`);
  const host = hp[1], port = Number(hp[2]) || (kind === 'tls' ? 853 : 53);
  if (!isIPv4(host) && !isIPv6(host) && !/^[a-z0-9.-]+$/i.test(host)) throw new Error(`serveur amont invalide : ${s}`);
  return { kind, host, port, servername: servername ?? (isIPv4(host) || isIPv6(host) ? undefined : host), label: t };
}

/** Envoie une question à un serveur et rend sa réponse brute (UDP, avec bascule en TCP si tronquée). */
export function exchangeUdp(q: Buffer, host: string, port: number, timeoutMs = 2500): Promise<Buffer> {
  return new Promise((ok, ko) => {
    const s = dgram.createSocket(isIPv6(host) ? 'udp6' : 'udp4'), id = q.readUInt16BE(0);
    const t = setTimeout(() => { s.close(); ko(new Error(`pas de réponse de ${host}`)); }, timeoutMs);
    s.on('message', (m) => { if (m.length < 12 || m.readUInt16BE(0) !== id) return; clearTimeout(t); s.close(); ok(m); });
    s.on('error', (e) => { clearTimeout(t); s.close(); ko(e); });
    s.send(q, port, host);
  });
}
/** Message DNS sur un flux (TCP ou TLS) : longueur sur 2 octets puis le message. */
function overStream(sock: net.Socket, q: Buffer, timeoutMs: number, what: string): Promise<Buffer> {
  return new Promise((ok, ko) => {
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => { sock.destroy(); ko(new Error(`pas de réponse de ${what}`)); }, timeoutMs);
    sock.on('data', (d: Buffer) => { buf = Buffer.concat([buf, d]); if (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) { clearTimeout(t); sock.end(); ok(buf.subarray(2, 2 + buf.readUInt16BE(0))); } });
    sock.on('error', (e) => { clearTimeout(t); ko(e); });
    const l = Buffer.alloc(2); l.writeUInt16BE(q.length); sock.write(Buffer.concat([l, q]));
  });
}
export const exchangeTcp = (q: Buffer, host: string, port: number, timeoutMs = 4000) => overStream(net.connect({ host, port }), q, timeoutMs, host);
export const exchangeTls = (q: Buffer, host: string, port: number, servername?: string, timeoutMs = 5000, ca?: string | Buffer) =>
  overStream(tls.connect({ host, port, servername: servername ?? (isIPv4(host) || isIPv6(host) ? undefined : host), ...(ca ? { ca } : {}) }), q, timeoutMs, servername ?? host);
export async function exchangeHttps(q: Buffer, url: string, f: typeof fetch = fetch, timeoutMs = 5000): Promise<Buffer> {
  const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message' }, body: new Uint8Array(q), signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---------------- Cache ----------------
export interface CacheEntry { raw: Buffer; at: number; ttl: number; upstream: string }
export class DnsCache {
  private m = new Map<string, CacheEntry>(); hits = 0; misses = 0;
  o: { max: number; minTtl: number; maxTtl: number; optimistic: boolean; now: () => number };
  constructor(o: { max: number; minTtl: number; maxTtl: number; optimistic: boolean; now: () => number }) { this.o = o; }
  key = (name: string, type: number, dnssec = false) => `${name}|${type}|${dnssec ? 1 : 0}`;
  get(k: string): { raw: Buffer; age: number; stale: boolean; upstream: string } | undefined {
    const e = this.m.get(k); if (!e) { this.misses++; return undefined; }
    const age = Math.floor((this.o.now() - e.at) / 1000);
    if (age >= e.ttl && !this.o.optimistic) { this.m.delete(k); this.misses++; return undefined; }
    if (age >= e.ttl + 86400) { this.m.delete(k); this.misses++; return undefined; }   // périmée depuis plus d'un jour
    this.m.delete(k); this.m.set(k, e); this.hits++;                                   // la plus récemment servie va au bout
    return { raw: e.raw, age, stale: age >= e.ttl, upstream: e.upstream };
  }
  put(k: string, raw: Buffer, upstream: string): void {
    let m: Message; try { m = parse(raw); } catch { return; }
    if (m.rcode !== RCODE.NOERROR && m.rcode !== RCODE.NXDOMAIN) return;
    if (m.tc) return;
    const t = minTtl(m) ?? (m.rcode === RCODE.NXDOMAIN ? 60 : 30);
    const ttl = Math.min(this.o.maxTtl || 86400, Math.max(this.o.minTtl, t));
    if (ttl <= 0) return;
    this.m.delete(k); this.m.set(k, { raw, at: this.o.now(), ttl, upstream });
    while (this.m.size > this.o.max) this.m.delete(this.m.keys().next().value!);
  }
  clear(): void { this.m.clear(); }
  get size(): number { return this.m.size; }
}

// ---------------- Récursif : depuis la racine ----------------
/** Les 13 serveurs racine d'Internet (adresses IPv4 publiées par l'IANA). */
export const ROOTS = ['198.41.0.4', '170.247.170.2', '192.33.4.12', '199.7.91.13', '192.203.230.10', '192.5.5.241', '192.112.36.4', '198.97.190.53', '192.36.148.17', '192.58.128.30', '193.0.14.129', '199.7.83.42', '202.12.27.33'];
export interface RecursiveOpts { roots?: Array<{ host: string; port: number }>; ask?: (q: Buffer, host: string, port: number) => Promise<Buffer>; maxDepth?: number }
const toAnswer = (msg: Buffer, r: RR): Answer => ({ name: r.name, type: r.type, ttl: r.ttl, cls: r.cls, data: plainData(msg, r) });

/** Résout un nom tout seul, comme un résolveur complet : racine → domaine de premier niveau → serveur du domaine, en suivant les alias. */
export async function recurse(name: string, type: number, o: RecursiveOpts = {}, depth = 0, seen = new Set<string>()): Promise<{ rcode: number; an: Answer[]; ns: Answer[] }> {
  if (depth > (o.maxDepth ?? 8)) throw new Error('résolution trop longue');
  const ask = o.ask ?? (async (q, h, p) => { const r = await exchangeUdp(q, h, p); return parse(r).tc ? exchangeTcp(q, h, p) : r; });
  let servers = (o.roots ?? ROOTS.map((host) => ({ host, port: 53 }))).slice();
  const chain: Answer[] = [];
  let qname = name;
  for (let hop = 0; hop < 40; hop++) {
    let m: Message | undefined, lastErr: Error | undefined;
    for (const s of servers.sort(() => Math.random() - 0.5).slice(0, 4)) {
      try { const raw = await ask(query(qname, type, { rd: false }), s.host, s.port); m = parse(raw); if (m.rcode === RCODE.SERVFAIL || m.rcode === RCODE.REFUSED) { m = undefined; continue; } break; } catch (e) { lastErr = e as Error; }
    }
    if (!m) throw lastErr ?? new Error(`aucun serveur ne répond pour ${qname}`);
    const raw = m.raw;
    const direct = m.an.filter((r) => r.name === qname && (r.type === type || type === TYPE.ANY));
    const alias = m.an.find((r) => r.name === qname && r.type === TYPE.CNAME);
    if (direct.length) {
      // La réponse peut contenir la suite de la chaîne d'alias : on la garde telle quelle.
      return { rcode: RCODE.NOERROR, an: [...chain, ...m.an.filter((r) => r.type === TYPE.CNAME || r.type === type).map((r) => toAnswer(raw, r))], ns: [] };
    }
    if (alias && type !== TYPE.CNAME) {
      const target = dataText(raw, alias); chain.push(toAnswer(raw, alias));
      // La suite de la chaîne est peut-être déjà dans la réponse.
      const more = m.an.filter((r) => r !== alias);
      let t = target; for (;;) { const nx = more.find((r) => r.name === t && r.type === TYPE.CNAME); if (!nx) break; chain.push(toAnswer(raw, nx)); t = dataText(raw, nx); }
      const fin = more.filter((r) => r.name === t && r.type === type);
      if (fin.length) return { rcode: RCODE.NOERROR, an: [...chain, ...fin.map((r) => toAnswer(raw, r))], ns: [] };
      if (seen.has(t) || chain.length > 10) throw new Error('boucle d\'alias');
      seen.add(t);
      const rest = await recurse(t, type, o, depth + 1, seen);
      return { rcode: rest.rcode, an: [...chain, ...rest.an], ns: rest.ns };
    }
    if (m.rcode === RCODE.NXDOMAIN) return { rcode: RCODE.NXDOMAIN, an: chain, ns: m.ns.filter((r) => r.type === TYPE.SOA).map((r) => toAnswer(raw, r)) };
    const referral = m.ns.filter((r) => r.type === TYPE.NS);
    if (!referral.length || m.aa) return { rcode: RCODE.NOERROR, an: chain, ns: m.ns.filter((r) => r.type === TYPE.SOA).map((r) => toAnswer(raw, r)) };
    // Délégation : on passe aux serveurs du niveau en dessous (adresses jointes, sinon on les cherche).
    const names = referral.map((r) => dataText(raw, r));
    const glue = m.ar.filter((r) => r.type === TYPE.A && names.includes(r.name)).map((r) => ({ host: dataText(raw, r), port: 53 }));
    if (glue.length) { servers = glue; continue; }
    let found: Array<{ host: string; port: number }> = [];
    for (const n of names.slice(0, 3)) {
      if (seen.has(`ns:${n}`)) continue; seen.add(`ns:${n}`);
      try { const r = await recurse(n, TYPE.A, o, depth + 1, seen); found = r.an.filter((a) => a.type === TYPE.A).map((a) => ({ host: [...a.data].join('.'), port: o.roots?.[0]?.port ?? 53 })); if (found.length) break; } catch { /* le suivant */ }
    }
    if (!found.length) throw new Error(`serveurs de ${referral[0].name || 'la zone'} introuvables`);
    servers = found;
  }
  throw new Error('trop de délégations');
}
/** Une réponse prête pour le client, fabriquée à partir d'une résolution récursive. */
export function recursiveAnswer(q: Message, r: { rcode: number; an: Answer[]; ns: Answer[] }): Buffer { return respond(q, { rcode: r.rcode, an: r.an, ns: r.ns }); }

// ---------------- Les serveurs amont ----------------
export interface Forwarder { strategy: 'parallele' | 'ordre' | 'rapide'; upstreams: Upstream[]; fetch?: typeof fetch; ca?: string | Buffer; recursive?: RecursiveOpts; timeoutMs?: number }
const avg = new Map<string, number>();
/** Envoie la question au(x) serveur(s) amont ; rend la réponse brute (identifiant d'origine) et qui a répondu. */
export async function forward(raw: Buffer, q: Message, f: Forwarder): Promise<{ raw: Buffer; upstream: string }> {
  const one = async (u: Upstream): Promise<{ raw: Buffer; upstream: string }> => {
    const t0 = Date.now(); let out: Buffer;
    if (u.kind === 'recursif') out = recursiveAnswer(q, await recurse(q.qd[0].name, q.qd[0].type, f.recursive));
    else if (u.kind === 'https') out = await exchangeHttps(reuse(raw, 0), u.url!, f.fetch, f.timeoutMs);
    else if (u.kind === 'tls') out = await exchangeTls(raw, u.host, u.port, u.servername, f.timeoutMs, f.ca);
    else if (u.kind === 'tcp') out = await exchangeTcp(raw, u.host, u.port, f.timeoutMs);
    else { out = await exchangeUdp(raw, u.host, u.port, f.timeoutMs); if (parse(out).tc) out = await exchangeTcp(raw, u.host, u.port, f.timeoutMs); }
    avg.set(u.label, 0.7 * (avg.get(u.label) ?? Date.now() - t0) + 0.3 * (Date.now() - t0));
    return { raw: reuse(out, q.id), upstream: u.label };
  };
  const ups = f.upstreams; if (!ups.length) throw new Error('aucun serveur amont');
  if (f.strategy === 'parallele') return Promise.any(ups.map(one)).catch((e: AggregateError) => { throw e.errors?.[0] ?? e; });
  const order = f.strategy === 'rapide' ? [...ups].sort((a, b) => (avg.get(a.label) ?? 50) - (avg.get(b.label) ?? 50)) : ups;
  let last: Error | undefined;
  for (const u of order) { try { return await one(u); } catch (e) { last = e as Error; } }
  throw last ?? new Error('aucun serveur amont ne répond');
}
export const upstreamTimes = () => Object.fromEntries(avg);
