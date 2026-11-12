// Le VPN WireGuard, écrit dans Odin : rien à installer. Odin parle le protocole WireGuard lui-même
// (le même que l'appli WireGuard des téléphones et des ordinateurs) :
//   - poignée de main Noise_IKpsk2 (clés X25519, BLAKE2s, ChaCha20-Poly1305, clé pré-partagée) ;
//   - paquets chiffrés avec compteur et fenêtre anti-rejeu ;
//   - nouvelles clés toutes les 2 minutes, sessions refusées après 3 minutes sans renouvellement ;
//   - « cookies » quand Odin est submergé de poignées de main (protection contre la saturation) ;
//   - routage par clé : un appareil ne peut envoyer que depuis ses adresses autorisées ;
//   - maintien de connexion (persistant et passif), itinérance (l'appareil change de réseau, ça suit).
// Les paquets entrent et sortent du système par une carte réseau virtuelle (TUN), ouverte par un petit
// relais en Python standard (tun.py) ; sans carte (essais), on branche n'importe quel « port » de paquets.

import { spawn, type ChildProcess } from 'node:child_process';
import dgram from 'node:dgram';
import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';
import { dirname, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AEAD, AEAD_OPEN, DH, dhGenerate, HASH, KDF1, KDF2, KDF3, MAC, pubOf, random, XAEAD, XAEAD_OPEN } from './crypto.ts';

const CONSTRUCTION = Buffer.from('Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s');
const IDENTIFIER = Buffer.from('WireGuard v1 zx2c4 Jason@zx2c4.com');
const LABEL_MAC1 = Buffer.from('mac1----'), LABEL_COOKIE = Buffer.from('cookie--');
const C0 = HASH(CONSTRUCTION), H0 = HASH(C0, IDENTIFIER), EMPTY = Buffer.alloc(0), ZERO16 = Buffer.alloc(16);
export const T = { REKEY_AFTER_TIME: 120_000, REJECT_AFTER_TIME: 180_000, REKEY_ATTEMPT_TIME: 90_000, REKEY_TIMEOUT: 5_000, KEEPALIVE_TIMEOUT: 10_000, COOKIE_LIFE: 120_000 };
const REKEY_AFTER_MESSAGES = 2n ** 60n, REJECT_AFTER_MESSAGES = 2n ** 64n - 2n ** 13n - 1n, WINDOW = 2048;

/** Horodatage TAI64N (12 octets) : protège contre le rejeu d'une ancienne poignée de main. */
export function tai64n(ms: number): Buffer {
  const b = Buffer.alloc(12);
  b.writeBigUInt64BE(BigInt(Math.floor(ms / 1000)) + 0x400000000000000an, 0);
  b.writeUInt32BE(Math.floor(ms % 1000) * 1_000_000, 8);
  return b;
}
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

// ---------------- Adresses autorisées (routage par clé) ----------------
export interface Cidr { v6: boolean; net: Buffer; bits: number }
function ipBytes(ip: string): Buffer | undefined {
  if (isIPv4(ip)) return Buffer.from(ip.split('.').map(Number));
  if (!isIPv6(ip)) return undefined;
  const [head, tail = ''] = ip.split('::'), h = head ? head.split(':') : [], t = ip.includes('::') ? (tail ? tail.split(':') : []) : [];
  const v4 = (t.length ? t : h).at(-1)?.includes('.') ? (t.length ? t : h).pop()! : undefined;
  const words = [...h, ...Array(Math.max(0, 8 - h.length - t.length - (v4 ? 2 : 0))).fill('0'), ...t];
  const out = Buffer.alloc(16); words.slice(0, v4 ? 6 : 8).forEach((w, i) => out.writeUInt16BE(parseInt(w || '0', 16), i * 2));
  if (v4) Buffer.from(v4.split('.').map(Number)).copy(out, 12);
  return out;
}
export function parseCidr(s: string): Cidr {
  const [ip, b] = s.trim().split('/'), net = ipBytes(ip);
  if (!net) throw new Error(`adresse invalide : ${s}`);
  const bits = b === undefined ? net.length * 8 : Number(b);
  if (!Number.isInteger(bits) || bits < 0 || bits > net.length * 8) throw new Error(`masque invalide : ${s}`);
  return { v6: net.length === 16, net, bits };
}
export function inCidr(c: Cidr, ip: Buffer): boolean {
  if ((ip.length === 16) !== c.v6) return false;
  const full = c.bits >> 3, rest = c.bits & 7;
  if (!ip.subarray(0, full).equals(c.net.subarray(0, full))) return false;
  if (!rest) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return (ip[full] & mask) === (c.net[full] & mask);
}
/** Source et destination d'un paquet IP (v4 ou v6), et sa vraie longueur (sans le remplissage). */
export function ipInfo(p: Buffer): { src: Buffer; dst: Buffer; len: number } | undefined {
  const v = p[0] >> 4;
  if (v === 4 && p.length >= 20) { const len = p.readUInt16BE(2); return len >= 20 && len <= p.length ? { src: p.subarray(12, 16), dst: p.subarray(16, 20), len } : undefined; }
  if (v === 6 && p.length >= 40) { const len = p.readUInt16BE(4) + 40; return len <= p.length ? { src: p.subarray(8, 24), dst: p.subarray(24, 40), len } : undefined; }
  return undefined;
}

// ---------------- Fenêtre anti-rejeu ----------------
export class Replay {
  private max = -1n; private seen = new Uint8Array(WINDOW);
  /** Vrai si ce compteur n'a jamais servi (et le note) ; faux s'il est rejoué ou trop vieux. */
  accept(n: bigint): boolean {
    if (n > this.max) {
      const gap = n - this.max;
      if (gap >= BigInt(WINDOW)) this.seen.fill(0); else for (let i = this.max + 1n; i < n; i++) this.seen[Number(i % BigInt(WINDOW))] = 0;
      this.max = n; this.seen[Number(n % BigInt(WINDOW))] = 1; return true;
    }
    if (this.max - n >= BigInt(WINDOW)) return false;
    const i = Number(n % BigInt(WINDOW)); if (this.seen[i]) return false; this.seen[i] = 1; return true;
  }
}

// ---------------- Appareils et sessions ----------------
export interface PeerConfig { publicKey: string; presharedKey?: string; allowedIps: string[]; endpoint?: string; persistentKeepalive?: number; name?: string }
interface Keypair { local: number; remote: number; sendKey: Buffer; recvKey: Buffer; sendCounter: bigint; created: number; initiator: boolean; replay: Replay }
interface Handshake { local: number; ePriv: Buffer; c: Buffer; h: Buffer; sent: number }
interface Endpoint { address: string; port: number }
interface Peer {
  cfg: PeerConfig; pub: Buffer; psk: Buffer; ss: Buffer; allowed: Cidr[];
  endpoint?: Endpoint; current?: Keypair; previous?: Keypair; next?: Keypair; hs?: Handshake;
  lastTs?: Buffer; lastInitRecv?: number; firstAttempt?: number; queue: Buffer[];
  rx: number; tx: number; lastHandshake?: number; lastSent?: number; lastRecvData?: number; needKeepalive?: number;
  cookie?: { value: Buffer; at: number }; lastMac1?: Buffer;
}
/** Le chemin des paquets entre le VPN et le système (carte TUN, ou un faux port pour les essais). */
export interface TunPort { write(pkt: Buffer): void; onPacket(cb: (pkt: Buffer) => void): void; close(): void }
export interface DeviceOptions { privateKey: string; listenPort?: number; peers?: PeerConfig[]; tun?: TunPort; now?: () => number; log?: (line: string) => void; mtu?: number; underLoadAt?: number }
export interface PeerStats { publicKey: string; name?: string; endpoint?: string; lastHandshake?: number; rx: number; tx: number; allowedIps: string[] }

export class WgDevice {
  private priv: Buffer; readonly pub: Buffer; private sock?: dgram.Socket; private v6 = false;
  private peers = new Map<string, Peer>(); private index = new Map<number, { peer: Peer; kp?: Keypair; hs?: Handshake }>();
  private timer?: NodeJS.Timeout; private now: () => number; private log: (l: string) => void;
  private recentInits: number[] = []; private cookieSecret = random(32); private secretAt = 0;
  private macKey: Buffer; private cookieKey: Buffer; port = 0; private mtu: number;

  private o: DeviceOptions;
  constructor(o: DeviceOptions) {
    this.o = o;
    this.priv = Buffer.from(o.privateKey, 'base64');
    if (this.priv.length !== 32) throw new Error('clé privée invalide');
    this.pub = pubOf(this.priv); this.now = o.now ?? Date.now; this.log = o.log ?? (() => {}); this.mtu = o.mtu ?? 1420;
    this.macKey = HASH(LABEL_MAC1, this.pub); this.cookieKey = HASH(LABEL_COOKIE, this.pub);
    this.setPeers(o.peers ?? []);
    o.tun?.onPacket((p) => this.fromSystem(p));
  }

  /** Ouvre le port UDP (IPv4 et IPv6) ; rend le port réellement ouvert. */
  async start(): Promise<number> {
    const open = (type: 'udp4' | 'udp6') => new Promise<dgram.Socket>((ok, ko) => {
      const s = dgram.createSocket({ type, ipv6Only: false, reuseAddr: false });
      s.once('error', ko); s.bind(this.o.listenPort ?? 0, () => { s.off('error', ko); ok(s); });
    });
    try { this.sock = await open('udp6'); this.v6 = true; } catch { this.sock = await open('udp4'); this.v6 = false; }
    this.sock.on('message', (m, r) => { try { this.fromNet(m, { address: r.address.replace(/^::ffff:(?=\d+\.)/, ''), port: r.port }); } catch (e) { this.log(`paquet ignoré : ${(e as Error).message}`); } });
    this.sock.on('error', (e) => this.log(`UDP : ${e.message}`));
    this.port = this.sock.address().port;
    this.timer = setInterval(() => this.tick(), 250); this.timer.unref?.();
    for (const p of this.peers.values()) if (p.cfg.endpoint && !p.endpoint) await this.resolve(p);
    return this.port;
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.sock?.close(); this.sock = undefined; this.o.tun?.close(); }

  /** Met à jour la liste des appareils sans couper ceux qui ne changent pas. */
  setPeers(list: PeerConfig[]): void {
    const keep = new Set<string>();
    for (const c of list) {
      const pub = Buffer.from(c.publicKey, 'base64'); if (pub.length !== 32) throw new Error(`clé publique invalide (${c.name ?? c.publicKey})`);
      const key = pub.toString('base64'); keep.add(key);
      const old = this.peers.get(key), psk = c.presharedKey ? Buffer.from(c.presharedKey, 'base64') : Buffer.alloc(32);
      const allowed = c.allowedIps.map(parseCidr);
      if (old) { old.cfg = c; old.psk = psk; old.allowed = allowed; if (c.endpoint) void this.resolve(old); continue; }
      const p: Peer = { cfg: c, pub, psk, ss: DH(this.priv, pub), allowed, queue: [], rx: 0, tx: 0 };
      this.peers.set(key, p); if (c.endpoint && this.sock) void this.resolve(p);
    }
    for (const [k, p] of this.peers) if (!keep.has(k)) { this.forget(p); this.peers.delete(k); }
  }
  stats(): PeerStats[] {
    return [...this.peers.values()].map((p) => ({ publicKey: p.pub.toString('base64'), name: p.cfg.name, endpoint: p.endpoint ? `${p.endpoint.address}:${p.endpoint.port}` : undefined, lastHandshake: p.lastHandshake, rx: p.rx, tx: p.tx, allowedIps: p.cfg.allowedIps }));
  }

  private async resolve(p: Peer): Promise<void> {
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(p.cfg.endpoint ?? ''); if (!m) return;
    try { const a = isIPv4(m[1]) || isIPv6(m[1]) ? m[1] : (await lookup(m[1])).address; p.endpoint = { address: a, port: Number(m[2]) }; } catch (e) { this.log(`adresse introuvable pour ${p.cfg.name ?? 'un appareil'} : ${(e as Error).message}`); }
  }
  private forget(p: Peer): void { for (const [i, e] of this.index) if (e.peer === p) this.index.delete(i); p.current = p.previous = p.next = p.hs = undefined; p.queue = []; }
  private newIndex(): number { let i; do { i = random(4).readUInt32LE(0); } while (this.index.has(i)); return i; }
  private send(p: Peer, msg: Buffer): void {
    if (!this.sock || !p.endpoint) return;
    const addr = this.v6 && isIPv4(p.endpoint.address) ? `::ffff:${p.endpoint.address}` : p.endpoint.address;
    this.sock.send(msg, p.endpoint.port, addr); p.tx += msg.length; p.lastSent = this.now();
  }

  // ---------------- Poignée de main (initiateur) ----------------
  /** Lance une poignée de main vers un appareil dont on connaît l'adresse. */
  initiate(p: Peer): void {
    const now = this.now();
    if (!p.endpoint || (p.hs && now - p.hs.sent < T.REKEY_TIMEOUT)) return;
    if (p.hs) this.index.delete(p.hs.local);
    p.firstAttempt ??= now;
    const e = dhGenerate(), local = this.newIndex(), msg = Buffer.alloc(148);
    msg[0] = 1; msg.writeUInt32LE(local, 4); e.pub.copy(msg, 8);
    let c = KDF1(C0, e.pub), h = HASH(HASH(H0, p.pub), e.pub), k: Buffer;
    [c, k] = KDF2(c, DH(e.priv, p.pub));
    const st = AEAD(k, 0n, this.pub, h); st.copy(msg, 40); h = HASH(h, st);
    [c, k] = KDF2(c, p.ss);
    const ts = AEAD(k, 0n, tai64n(now), h); ts.copy(msg, 88); h = HASH(h, ts);
    this.macs(p, msg, HASH(LABEL_MAC1, p.pub));
    p.hs = { local, ePriv: e.priv, c, h, sent: now }; this.index.set(local, { peer: p, hs: p.hs });
    this.send(p, msg);
  }
  private macs(p: Peer, msg: Buffer, key: Buffer): void {
    const n = msg.length, mac1 = MAC(key, msg.subarray(0, n - 32)); mac1.copy(msg, n - 32); p.lastMac1 = mac1;
    (p.cookie && this.now() - p.cookie.at < T.COOKIE_LIFE ? MAC(p.cookie.value, msg.subarray(0, n - 16)) : ZERO16).copy(msg, n - 16);
  }

  // ---------------- Réception ----------------
  private fromNet(m: Buffer, from: Endpoint): void {
    const type = m.length >= 4 && m[1] === 0 && m[2] === 0 && m[3] === 0 ? m[0] : 0;
    if (type === 1 && m.length === 148) this.onInitiation(m, from);
    else if (type === 2 && m.length === 92) this.onResponse(m, from);
    else if (type === 3 && m.length === 64) this.onCookie(m);
    else if (type === 4 && m.length >= 32) this.onData(m, from);
  }
  /** Sous une pluie de poignées de main, Odin demande à l'autre de prouver son adresse (cookie) avant de calculer quoi que ce soit. */
  private checkMacs(m: Buffer, from: Endpoint): 'ok' | 'non' | 'cookie' {
    const n = m.length;
    if (!same(MAC(this.macKey, m.subarray(0, n - 32)), m.subarray(n - 32, n - 16))) return 'non';
    const now = this.now(); this.recentInits = this.recentInits.filter((t) => now - t < 1000); this.recentInits.push(now);
    if (this.recentInits.length <= (this.o.underLoadAt ?? 64)) return 'ok';
    return same(MAC(this.cookieFor(from), m.subarray(0, n - 16)), m.subarray(n - 16)) ? 'ok' : 'cookie';
  }
  private cookieFor(from: Endpoint): Buffer {
    if (this.now() - this.secretAt > T.COOKIE_LIFE) { this.cookieSecret = random(32); this.secretAt = this.now(); }
    const port = Buffer.alloc(2); port.writeUInt16BE(from.port);
    return MAC(this.cookieSecret, Buffer.concat([Buffer.from(from.address), port]));
  }
  private sendCookie(m: Buffer, from: Endpoint): void {
    const reply = Buffer.alloc(64), nonce = random(24);
    reply[0] = 3; m.copy(reply, 4, 4, 8); nonce.copy(reply, 8);
    XAEAD(this.cookieKey, nonce, this.cookieFor(from), m.subarray(m.length - 32, m.length - 16)).copy(reply, 32);
    const addr = this.v6 && isIPv4(from.address) ? `::ffff:${from.address}` : from.address;
    this.sock?.send(reply, from.port, addr);
  }

  private onInitiation(m: Buffer, from: Endpoint): void {
    const mac = this.checkMacs(m, from); if (mac === 'non') return; if (mac === 'cookie') { this.sendCookie(m, from); return; }
    const sender = m.readUInt32LE(4), ePub = m.subarray(8, 40), encStatic = m.subarray(40, 88), encTs = m.subarray(88, 116);
    let c = KDF1(C0, ePub), h = HASH(HASH(H0, this.pub), ePub), k: Buffer;
    [c, k] = KDF2(c, DH(this.priv, ePub));
    const spub = AEAD_OPEN(k, 0n, encStatic, h); if (!spub) return;
    h = HASH(h, encStatic);
    const p = this.peers.get(spub.toString('base64')); if (!p) return;
    [c, k] = KDF2(c, p.ss);
    const ts = AEAD_OPEN(k, 0n, encTs, h); if (!ts) return;
    h = HASH(h, encTs);
    const now = this.now();
    if (p.lastTs && Buffer.compare(ts, p.lastTs) <= 0) return;                  // rejeu d'une ancienne poignée de main
    if (p.lastInitRecv !== undefined && now - p.lastInitRecv < 20) return;      // plus de 50 par seconde : ignoré
    p.lastTs = Buffer.from(ts); p.lastInitRecv = now;
    // Réponse
    const e = dhGenerate(), local = this.newIndex(), r = Buffer.alloc(92);
    r[0] = 2; r.writeUInt32LE(local, 4); r.writeUInt32LE(sender, 8); e.pub.copy(r, 12);
    c = KDF1(c, e.pub); h = HASH(h, e.pub);
    c = KDF1(c, DH(e.priv, ePub)); c = KDF1(c, DH(e.priv, p.pub));
    let t: Buffer; [c, t, k] = KDF3(c, p.psk); h = HASH(h, t);
    const empty = AEAD(k, 0n, EMPTY, h); empty.copy(r, 44);
    const [recvKey, sendKey] = KDF2(c, EMPTY);
    this.macs(p, r, HASH(LABEL_MAC1, p.pub));
    if (p.next) this.index.delete(p.next.local);
    const kp: Keypair = { local, remote: sender, sendKey, recvKey, sendCounter: 0n, created: now, initiator: false, replay: new Replay() };
    p.next = kp; this.index.set(local, { peer: p, kp });
    p.endpoint = from; this.send(p, r);
    p.lastHandshake = now;
  }
  private onResponse(m: Buffer, from: Endpoint): void {
    const mac = this.checkMacs(m, from); if (mac === 'non') return; if (mac === 'cookie') { this.sendCookie(m, from); return; }
    const sender = m.readUInt32LE(4), e = this.index.get(m.readUInt32LE(8));
    if (!e?.hs) return;
    const p = e.peer, hs = e.hs, ePub = m.subarray(12, 44), empty = m.subarray(44, 60);
    let c = KDF1(hs.c, ePub), h = HASH(hs.h, ePub), k: Buffer, t: Buffer;
    c = KDF1(c, DH(hs.ePriv, ePub)); c = KDF1(c, DH(this.priv, ePub));
    [c, t, k] = KDF3(c, p.psk); h = HASH(h, t);
    if (!AEAD_OPEN(k, 0n, empty, h)) return;
    const [sendKey, recvKey] = KDF2(c, EMPTY), now = this.now();
    const kp: Keypair = { local: hs.local, remote: sender, sendKey, recvKey, sendCounter: 0n, created: now, initiator: true, replay: new Replay() };
    this.rotate(p, kp); this.index.set(hs.local, { peer: p, kp });
    p.hs = undefined; p.firstAttempt = undefined; p.endpoint = from; p.lastHandshake = now;
    // Les paquets en attente partent ; sinon un paquet vide confirme la session à l'autre bout.
    const q = p.queue; p.queue = [];
    if (q.length) for (const x of q) this.sendData(p, x); else this.sendData(p, EMPTY);
  }
  private rotate(p: Peer, kp: Keypair): void {
    if (p.previous && p.previous !== kp) this.index.delete(p.previous.local);
    p.previous = p.current; p.current = kp; if (p.next === kp) p.next = undefined;
  }
  private onCookie(m: Buffer): void {
    const e = this.index.get(m.readUInt32LE(4)); if (!e || !e.peer.lastMac1) return;
    const v = XAEAD_OPEN(HASH(LABEL_COOKIE, e.peer.pub), m.subarray(8, 32), m.subarray(32, 64), e.peer.lastMac1);
    if (v) e.peer.cookie = { value: v, at: this.now() };
  }
  private onData(m: Buffer, from: Endpoint): void {
    const e = this.index.get(m.readUInt32LE(4)), kp = e?.kp; if (!e || !kp) return;
    const p = e.peer, counter = m.readBigUInt64LE(8), now = this.now();
    if (now - kp.created > T.REJECT_AFTER_TIME || counter >= REJECT_AFTER_MESSAGES) return;
    const plain = AEAD_OPEN(kp.recvKey, counter, m.subarray(16), EMPTY); if (!plain) return;
    if (!kp.replay.accept(counter)) return;
    if (p.next === kp) { this.rotate(p, kp); const q = p.queue; p.queue = []; for (const x of q) this.sendData(p, x); }
    p.endpoint = from; p.rx += m.length;
    // L'initiateur renouvelle les clés avant qu'elles ne soient refusées.
    if (kp === p.current && kp.initiator && now - kp.created > T.REJECT_AFTER_TIME - T.KEEPALIVE_TIMEOUT - T.REKEY_TIMEOUT) this.initiate(p);
    if (!plain.length) return;                                                   // maintien de connexion
    const info = ipInfo(plain); if (!info) return;
    if (!p.allowed.some((c) => inCidr(c, info.src))) { this.log(`paquet refusé : ${p.cfg.name ?? 'appareil'} envoie depuis une adresse qui n'est pas la sienne`); return; }
    p.lastRecvData = now; p.needKeepalive ??= now + T.KEEPALIVE_TIMEOUT;
    this.o.tun?.write(plain.subarray(0, info.len));
  }

  // ---------------- Envoi ----------------
  /** Un paquet du système vers le VPN : l'appareil est choisi par l'adresse de destination (la plus précise gagne). */
  fromSystem(pkt: Buffer): void {
    const info = ipInfo(pkt); if (!info) return;
    let best: Peer | undefined, bits = -1;
    for (const p of this.peers.values()) for (const c of p.allowed) if (c.bits > bits && inCidr(c, info.dst)) { best = p; bits = c.bits; }
    if (best) this.sendData(best, pkt);
  }
  private sendData(p: Peer, pkt: Buffer): void {
    const kp = p.current, now = this.now();
    if (!kp || now - kp.created > T.REJECT_AFTER_TIME || kp.sendCounter >= REJECT_AFTER_MESSAGES) {
      if (pkt.length) { p.queue.push(pkt); if (p.queue.length > 128) p.queue.shift(); }
      this.initiate(p); return;
    }
    const pad = pkt.length ? Math.min(Math.ceil(pkt.length / 16) * 16, Math.max(this.mtu, pkt.length)) : 0;
    const plain = Buffer.alloc(pad); pkt.copy(plain);
    const out = Buffer.alloc(16); out[0] = 4; out.writeUInt32LE(kp.remote, 4); out.writeBigUInt64LE(kp.sendCounter, 8);
    const sealed = AEAD(kp.sendKey, kp.sendCounter, plain, EMPTY); kp.sendCounter++;
    this.send(p, Buffer.concat([out, sealed])); p.needKeepalive = undefined;
    if ((kp.initiator && now - kp.created > T.REKEY_AFTER_TIME) || kp.sendCounter > REKEY_AFTER_MESSAGES) this.initiate(p);
  }

  /** Toutes les 250 ms : renvoi des poignées de main sans réponse, maintiens de connexion, clés périmées effacées. */
  private tick(): void {
    const now = this.now();
    for (const p of this.peers.values()) {
      if (p.hs && now - p.hs.sent >= T.REKEY_TIMEOUT + Math.random() * 333) {
        if (p.firstAttempt !== undefined && now - p.firstAttempt > T.REKEY_ATTEMPT_TIME) { this.index.delete(p.hs.local); p.hs = undefined; p.firstAttempt = undefined; p.queue = []; }
        else { const hs = p.hs; p.hs = { ...hs, sent: 0 }; this.index.delete(hs.local); p.hs = undefined; this.initiate(p); }
      }
      if (p.needKeepalive !== undefined && now >= p.needKeepalive && p.current) { p.needKeepalive = undefined; this.sendData(p, EMPTY); }
      const ka = p.cfg.persistentKeepalive;
      if (ka && p.endpoint && now - (p.lastSent ?? 0) >= ka * 1000) this.sendData(p, EMPTY);
      for (const k of [p.previous, p.current, p.next]) if (k && now - k.created > T.REJECT_AFTER_TIME * 3) { this.index.delete(k.local); if (p.previous === k) p.previous = undefined; if (p.current === k) p.current = undefined; if (p.next === k) p.next = undefined; }
    }
  }
}

// ---------------- Carte réseau du système (Linux) ----------------
const HELPER = join(dirname(fileURLToPath(import.meta.url)), 'tun.py');
/** Ouvre la carte réseau virtuelle `name` par le relais Python ; rend un port de paquets. */
export function systemTun(name: string, o: { sudo?: boolean; log?: (l: string) => void } = {}): Promise<TunPort & { proc: ChildProcess }> {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,14}$/.test(name)) return Promise.reject(new Error('nom d\'interface invalide'));
  const cmd = o.sudo ? 'sudo' : 'python3', args = o.sudo ? ['-n', 'python3', HELPER, name] : [HELPER, name];
  const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let cb: (p: Buffer) => void = () => {}, buf: Buffer = Buffer.alloc(0);
  proc.stdout!.on('data', (d: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    while (buf.length >= 2) { const n = buf.readUInt16BE(0); if (buf.length < 2 + n) break; cb(buf.subarray(2, 2 + n)); buf = buf.subarray(2 + n); }
  });
  const port: TunPort & { proc: ChildProcess } = {
    proc,
    write: (p) => { if (proc.stdin!.writable && p.length <= 65535) { const h = Buffer.alloc(2); h.writeUInt16BE(p.length); proc.stdin!.write(Buffer.concat([h, p])); } },
    onPacket: (f) => { cb = f; },
    close: () => { proc.stdin!.end(); proc.kill(); },
  };
  return new Promise((ok, ko) => {
    let err = '';
    proc.stderr!.on('data', (d: Buffer) => { err += d.toString(); if (err.includes('pret')) ok(port); else o.log?.(d.toString().trim()); });
    proc.once('exit', (code) => ko(new Error(`la carte réseau ${name} n'a pas pu s'ouvrir (${code}) : ${err.trim().split('\n').pop() ?? ''}`)));
    proc.once('error', ko);
  });
}
