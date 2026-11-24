// Le serveur DHCP d'Odin (dans Sphinx) : il donne aux appareils de la maison leur adresse, la box comme
// passerelle et Odin comme DNS. Baux enregistrés, adresses fixes par appareil (adresse MAC), noms des
// appareils retenus (et servis par le DNS : « telephone-awa.maison »). Écrit dans Odin (RFC 2131 / 2132).
//
// À NE PAS faire tourner en même temps que le DHCP de la box : Sphinx vérifie qu'aucun autre serveur ne
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
export function buildPacket(p: Partial<Omit<Packet, 'options'>> & { op: number; xid: number; mac: string; options: Array<[number, Buffer]>; /** nom du fichier de démarrage (PXE) */ file?: string; sname?: string }): Buffer {
  const b = Buffer.alloc(240);
  b[0] = p.op; b[1] = 1; b[2] = 6; b.writeUInt32BE(p.xid, 4); b.writeUInt16BE(p.secs ?? 0, 8); b.writeUInt16BE(p.flags ?? 0, 10);
  ipBuf(p.ciaddr ?? '0.0.0.0').copy(b, 12); ipBuf(p.yiaddr ?? '0.0.0.0').copy(b, 16); ipBuf(p.siaddr ?? '0.0.0.0').copy(b, 20); ipBuf(p.giaddr ?? '0.0.0.0').copy(b, 24);
  Buffer.from(p.mac.split(':').map((x) => parseInt(x, 16))).copy(b, 28);
  if (p.sname) b.write(p.sname.slice(0, 63), 44, 'latin1');
  if (p.file) b.write(p.file.slice(0, 127), 108, 'latin1');
  b.writeUInt32BE(MAGIC, 236);
  const opts: Buffer[] = [];
  for (const [code, v] of p.options) for (let i = 0; i < v.length || i === 0; i += 255) { const c = v.subarray(i, i + 255); opts.push(Buffer.from([code, c.length]), c); if (!v.length) break; }
  const out = Buffer.concat([b, ...opts, Buffer.from([255])]);
  return out.length < 300 ? Buffer.concat([out, Buffer.alloc(300 - out.length)]) : out;
}
/**
 * Démarrage par le réseau (Genèse) : quand le DHCP d'Odin répond à une machine qui démarre en PXE, il ajoute
 * l'adresse du serveur de démarrage et le nom du chargeur. Genèse branche ce crochet quand il est allumé.
 */
export const pxeHook: { get?: (p: Packet) => { siaddr: string; file: string; options: Array<[number, Buffer]> } | undefined } = {};
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

export interface Lease { mac: string; ip: string; name?: string; expires: number; fixed?: boolean; /** première fois vu (ms) */ first?: number; /** ce que l'appareil dit de lui au DHCP (« android-dhcp-14 », « MSFT 5.0 »…) */ vendorClass?: string;
  /** date d'arrivée : début de la présence en cours (nouveau bail, ou retour après un bail fini) (ms) */
  since?: number;
  /** « vu connecté » : la dernière fois qu'Odin lui a donné ou renouvelé son bail (ms). Les signes entre deux (une simple
   *  demande) restent en mémoire (`DhcpServer.dernierSigne`) : rien n'est écrit sur le disque pour eux. */
  seen?: number;
  /** adresse retenue jusqu'à (ms) : après un refus net (appareil bloqué ou en pause), son adresse n'est redonnée à personne
   *  avant la fin du bail d'origine (il peut ne pas avoir obéi au refus : jamais deux appareils sur la même adresse) */
  hold?: number;
  /** le nom a été donné par le propriétaire : le nom que l'appareil annonce ne l'écrase plus */
  named?: boolean }
/** Le nom qu'un appareil annonce (option 12), nettoyé : lettres, chiffres, espace, point, tiret, apostrophe ; jamais de balise ni de caractère de contrôle. Pur. */
export const nomAnnonce = (b: Buffer | undefined): string | undefined => {
  if (!b) return undefined;
  // Toutes les écritures : les lettres, les chiffres et leurs marques (accents décomposés, voyelles du hindi ou du thaï) restent ;
  // au plus deux marques de suite (pas d'empilement), et la coupe se fait par caractère entier (jamais un demi-caractère).
  const t = b.subarray(0, 1024).toString('utf8').normalize('NFC').replace(/[^\p{L}\p{N}\p{M} ._'-]/gu, '').replace(/(\p{M}{2})\p{M}+/gu, '$1').replace(/^\p{M}+/u, '').replace(/ +/g, ' ').trim();
  return [...t].slice(0, 63).join('').trim() || undefined;
};
/** Ce qu'un appareil dit de lui (option 60), nettoyé : caractères simples seulement, rien qui ouvre une balise. Pur. */
export const classeAnnoncee = (b: Buffer | undefined): string | undefined => b?.toString('latin1').replace(/[^\x20-\x7e]/g, '').replace(/[<>&"'`\\]/g, '').replace(/ +/g, ' ').trim().slice(0, 60) || undefined;
/** Le système d'après ce que l'appareil dit au DHCP (deviné : à confirmer). Pur. */
export function osFromVendorClass(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const a = /android-dhcp-(\d+)/i.exec(v); if (a) return `Android ${a[1]}`;
  if (/^MSFT/i.test(v)) return 'Windows'; if (/dhcpcd/i.test(v)) return 'Linux ou Android'; if (/udhcp/i.test(v)) return 'Linux embarqué (box, caméra, objet)'; if (/^ubnt|ubiquiti/i.test(v)) return 'Ubiquiti';
  return v.slice(0, 40);
}
/** Une adresse MAC bien formée (six octets), telle que le serveur les écrit. */
export const MAC_SIMPLE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
/** Une MAC « privée » (bit local) : téléphone ou tablette récents en Wi-Fi, qui changent d'adresse par réseau. */
export const randomMac = (mac: string) => /^.[26ae]/i.test(mac);

/** L'état d'un appareil au niveau DHCP : actif (reçoit un bail), en pause (plus de renouvellement), bloqué (rien). */
export type MacState = 'actif' | 'pause' | 'bloque';
/**
 * La politique d'accès par adresse MAC :
 *  - mode « ouvert » : tout le monde reçoit une adresse, SAUF les MAC en pause ou bloquées.
 *  - mode « liste » (liste d'autorisation) : seules les MAC approuvées (état « actif ») et les adresses fixes
 *    reçoivent ; une MAC inconnue est ignorée et notée « en attente d'approbation ».
 */
export interface MacPolicy { mode: 'ouvert' | 'liste'; etats: Record<string, MacState>; attente: string[] }
/**
 * Ce que le DHCP fait pour une adresse MAC selon la politique : lui répondre (« ok »), ne rien lui renvoyer parce
 * qu'elle est bloquée (« bloque »), refuser son bail parce qu'elle est en pause (« pause »), ou l'ignorer et la noter
 * en attente parce qu'elle n'est pas encore approuvée (« attente »). Une adresse fixe passe toujours (sauf pause/bloc). Pur.
 */
export function macDecision(policy: MacPolicy | undefined, mac: string, isFixed: boolean): 'ok' | 'bloque' | 'pause' | 'attente' {
  if (!policy) return 'ok';
  const etat = policy.etats[mac.toLowerCase()];
  if (etat === 'bloque') return 'bloque';
  if (etat === 'pause') return 'pause';
  if (policy.mode === 'liste' && !isFixed && etat !== 'actif') return 'attente';
  return 'ok';
}
export interface DhcpConfig {
  /** adresse d'Odin sur le réseau (identifiant du serveur) */
  server: string;
  start: string; end: string; mask: string; router: string; dns: string[]; leaseSeconds: number; domain?: string;
  /** adresses fixes : MAC → adresse (et nom) */
  fixed: Array<{ mac: string; ip: string; name?: string }>;
  /** la politique d'accès par adresse MAC (absente = tout le monde passe) */
  macPolicy?: MacPolicy;
}
export interface DhcpDeps { config: () => DhcpConfig; leases: () => Lease[]; save: (l: Lease[]) => void; now?: () => number; onLease?: (l: Lease, isNew: boolean) => void; log?: (s: string) => void;
  /** une MAC inconnue (liste d'autorisation) ou refusée demande une adresse : à noter en attente, et à signaler */
  onPending?: (mac: string, info: { name?: string; vendorClass?: string; requested?: string }) => void;
  /** un événement de bail s'est produit (donné, renouvelé, libéré, refusé, bloqué) : à garder dans l'historique */
  onEvent?: (mac: string, ip: string, action: 'donne' | 'renouvele' | 'libere' | 'refuse' | 'bloque' | 'attente', name?: string) => void;
  /** la prise réseau est tombée après le démarrage (carte débranchée, envoi impossible) : le serveur a cessé de servir */
  onError?: (raison: string) => void }

/** Nom propre pour le DNS (« Téléphone d'Awa » → « telephone-d-awa »). */
export const hostLabel = (n: string) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

export class DhcpServer {
  sock?: dgram.Socket; port = 67; clientPort = 68;
  private declined = new Map<string, number>(); private offered = new Map<string, { ip: string; at: number }>();
  /** Le dernier signe de chaque appareil (un paquet reçu), en mémoire seulement, borné : rien n'est écrit pour un simple signe. */
  readonly signes = new Map<string, number>();
  /** Le dernier refus ou silence noté pour un appareil (bloqué, en pause, en attente) : au plus une ligne d'historique par 10 minutes. */
  private notes = new Map<string, number>();
  dernierSigne(mac: string): number | undefined { return this.signes.get(mac.toLowerCase()); }
  private d: DhcpDeps; private now: () => number;
  constructor(d: DhcpDeps) { this.d = d; this.now = d.now ?? Date.now; }

  async start(port = 67, clientPort = 68, host = '0.0.0.0'): Promise<void> {
    this.port = port; this.clientPort = clientPort;
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((ok, ko) => { s.once('error', ko); s.bind(port, host, () => { s.off('error', ko); ok(); }); });
    s.setBroadcast(true); s.on('message', (m, r) => { try { this.onMessage(m, r); } catch (e) { this.d.log?.(`DHCP : ${(e as Error).message}`); } });
    // Une erreur de la prise ensuite (carte débranchée, envoi impossible) ne fait pas tomber Odin : on arrête de servir et on prévient.
    s.on('error', (e) => { if (this.sock !== s) return; this.stop(); this.d.log?.(`DHCP : la prise réseau ne répond plus (${e.message}), le serveur s'arrête`); try { this.d.onError?.(e.message); } catch { /* prévenir ne doit rien casser */ } });
    this.sock = s;
  }
  stop(): void { try { this.sock?.close(); } catch { /* déjà fermé */ } this.sock = undefined; }

  /** L'adresse à proposer à cet appareil : fixe, son bail, celle qu'il demande si libre, sinon la première libre. */
  pick(mac: string, wanted?: string): string | undefined {
    const c = this.d.config(), now = this.now(), leases = this.d.leases();
    const fixed = c.fixed.find((f) => f.mac.toLowerCase() === mac); if (fixed) return fixed.ip;
    const mine = leases.find((l) => l.mac === mac); if (mine) return mine.ip;
    const lo = ipNum(c.start), hi = ipNum(c.end);
    const taken = new Set([...leases.filter((l) => l.mac !== mac && (l.expires > now || l.fixed || (l.hold ?? 0) > now)).map((l) => l.ip), ...c.fixed.map((f) => f.ip), c.server, c.router, ...[...this.offered.entries()].filter(([m, o]) => m !== mac && now - o.at < 60_000).map(([, o]) => o.ip)]);
    for (const [ip, until] of this.declined) if (until > now) taken.add(ip);
    if (wanted && ipNum(wanted) >= lo && ipNum(wanted) <= hi && !taken.has(wanted)) return wanted;
    for (let n = lo; n <= hi; n++) if (!taken.has(numIp(n))) return numIp(n);
    // Plus rien de libre : on reprend le bail expiré le plus ancien.
    const old = leases.filter((l) => !l.fixed && l.expires <= now && (l.hold ?? 0) <= now).sort((a, b) => a.expires - b.expires)[0];
    return old?.ip;
  }
  private reply(p: Packet, type: number, ip: string, extra: Array<[number, Buffer]> = []): void {
    const c = this.d.config(), opts: Array<[number, Buffer]> = [[53, Buffer.from([type])], [54, ipBuf(c.server)]];
    if (type !== MSG.NAK) {
      opts.push([1, ipBuf(c.mask)], [3, ipBuf(c.router)], [6, Buffer.concat(c.dns.map(ipBuf))]);
      if (type !== MSG.ACK || p.options.get(53)?.[0] !== MSG.INFORM) opts.push([51, u32(c.leaseSeconds)], [58, u32(Math.floor(c.leaseSeconds / 2))], [59, u32(Math.floor(c.leaseSeconds * 0.875))]);
      if (c.domain) opts.push([15, Buffer.from(c.domain)]);
    }
    let boot: ReturnType<NonNullable<typeof pxeHook.get>>; try { boot = type !== MSG.NAK ? pxeHook.get?.(p) : undefined; } catch { boot = undefined; }
    const out = buildPacket({ op: 2, xid: p.xid, flags: p.flags, ciaddr: type === MSG.ACK && p.options.get(53)?.[0] === MSG.INFORM ? p.ciaddr : '0.0.0.0', yiaddr: type === MSG.NAK || p.options.get(53)?.[0] === MSG.INFORM ? '0.0.0.0' : ip, siaddr: boot?.siaddr ?? '0.0.0.0', giaddr: p.giaddr, mac: p.mac, options: [...opts, ...extra, ...(boot?.options ?? [])], file: boot?.file });
    // Un appareil qui a déjà son adresse reçoit la réponse directement ; sinon à tout le réseau (il n'a pas encore d'adresse).
    const to = p.giaddr !== '0.0.0.0' ? p.giaddr : p.ciaddr !== '0.0.0.0' && type !== MSG.NAK ? p.ciaddr : '255.255.255.255';
    this.sock?.send(out, p.giaddr !== '0.0.0.0' ? this.port : this.clientPort, to);
  }
  private keep(l: Lease): void {
    const all = this.d.leases(), old = all.find((x) => x.mac === l.mac), isNew = !old, now = this.now();
    // Date d'arrivée : gardée tant que le bail d'avant court encore ; un appareil qui revient après la fin de son bail arrive de nouveau.
    const since = old && old.expires > now ? old.since ?? old.first ?? now : now;
    l = { ...l, first: old?.first ?? now, since, seen: now, ...(l.vendorClass ?? old?.vendorClass ? { vendorClass: l.vendorClass ?? old?.vendorClass } : {}) };
    this.d.save([...all.filter((x) => x.mac !== l.mac && x.ip !== l.ip), l]);
    this.d.onLease?.(l, isNew);
  }
  /**
   * « Vu connecté » : un paquet vient d'arriver de cet appareil. Gardé en mémoire seulement (un appareil bloqué ou bavard
   * redemande toutes les quelques secondes, pour toujours : rien ne doit s'écrire sur le disque à ce rythme). Borné.
   */
  private vu(mac: string, now: number): void {
    this.signes.delete(mac); this.signes.set(mac, now);
    if (this.signes.size > 4096) for (const k of this.signes.keys()) { this.signes.delete(k); if (this.signes.size <= 3072) break; }
  }
  /** Vrai au plus une fois par 10 minutes et par appareil : pour ne pas remplir l'historique à chaque paquet refusé. */
  private aNoter(mac: string, quoi: string, now: number): boolean {
    const k = `${quoi} ${mac}`, t = this.notes.get(k); if (t !== undefined && now >= t && now - t < 600_000) return false;
    this.notes.delete(k); this.notes.set(k, now);
    if (this.notes.size > 4096) for (const x of this.notes.keys()) { this.notes.delete(x); if (this.notes.size <= 3072) break; }
    return true;
  }
  /**
   * L'appareil vient de recevoir un refus net (NAK) : son bail est fini tout de suite. Mais il peut ne pas obéir (ou ne
   * jamais avoir reçu le refus) : son adresse reste retenue jusqu'à la fin du bail d'origine, elle n'est redonnée à personne.
   */
  private lacher(mac: string, now: number): void {
    const all = this.d.leases(); if (all.some((l) => l.mac === mac && l.expires > now)) this.d.save(all.map((l) => (l.mac === mac && l.expires > now ? { ...l, expires: now, hold: Math.max(l.hold ?? 0, l.expires) } : l)));
  }
  onMessage(m: Buffer, _r?: dgram.RemoteInfo): void {
    const p = parsePacket(m); if (p.op !== 1) return;
    // Une adresse matérielle qui n'est pas une adresse MAC de six octets : ignorée (elle donnerait un appareil que la page
    // ne peut ni montrer ni bloquer).
    if (m[1] !== 1 || m[2] !== 6 || !MAC_SIMPLE.test(p.mac)) return;
    const type = p.options.get(53)?.[0], c = this.d.config(), now = this.now();
    const name = nomAnnonce(p.options.get(12));
    if (type !== MSG.RELEASE && type !== MSG.DECLINE) this.vu(p.mac, now);
    const requested = p.options.get(50)?.length === 4 ? ipStr(p.options.get(50)!, 0) : undefined;
    const serverId = p.options.get(54)?.length === 4 ? ipStr(p.options.get(54)!, 0) : undefined;
    // Contrôle d'accès par adresse MAC : bloquée → rien, en pause → NAK (ou pas d'OFFER), inconnue en liste → en attente.
    const isFixed = c.fixed.some((f) => f.mac.toLowerCase() === p.mac);
    const dec = macDecision(c.macPolicy, p.mac, isFixed);
    if (dec === 'bloque') {
      // Il tient encore une adresse donnée par Odin et demande à la garder : un seul refus net (NAK), pour qu'il la lâche
      // tout de suite au lieu de la garder jusqu'à la fin du bail. Ensuite, comme pour tout appareil bloqué : plus rien.
      const tenu = type === MSG.REQUEST && (!serverId || serverId === c.server) ? this.d.leases().find((l) => l.mac === p.mac && l.expires > now) : undefined;
      if (tenu && (requested ?? p.ciaddr) === tenu.ip) { this.reply(p, MSG.NAK, '0.0.0.0'); this.lacher(p.mac, now); this.d.onEvent?.(p.mac, tenu.ip, 'refuse', name); this.d.log?.(`DHCP : ${p.mac} est bloqué, son adresse ${tenu.ip} lui est refusée (NAK) : il sort du réseau`); return; }
      if (type === MSG.DISCOVER && this.aNoter(p.mac, 'bloque', now)) { this.d.log?.(`DHCP : ${p.mac} est bloqué, rien ne lui est renvoyé`); this.d.onEvent?.(p.mac, requested ?? '', 'bloque'); }
      return;
    }
    if ((dec === 'attente' || dec === 'pause') && (type === MSG.DISCOVER || type === MSG.REQUEST)) {
      if (dec === 'attente') { const vc = classeAnnoncee(p.options.get(60)); this.d.onPending?.(p.mac, { name, vendorClass: vc, requested }); if (this.aNoter(p.mac, 'attente', now)) { this.d.log?.(`DHCP : ${p.mac} en attente d'approbation, ignoré`); this.d.onEvent?.(p.mac, requested ?? '', 'attente', name); } return; }
      // En pause : NAK pour qu'il perde vite le réseau (noté une fois, pas à chaque nouvelle demande).
      const note = this.aNoter(p.mac, `pause ${type}`, now);
      if (type === MSG.REQUEST) { this.reply(p, MSG.NAK, '0.0.0.0'); this.lacher(p.mac, now); if (note) this.d.onEvent?.(p.mac, requested ?? p.ciaddr, 'refuse', name); }
      if (note) this.d.log?.(`DHCP : ${p.mac} en pause, ${type === MSG.REQUEST ? 'bail refusé (NAK)' : 'pas d\'OFFER'}`);
      return;
    }
    if (type === MSG.DISCOVER) {
      const ip = this.pick(p.mac, requested); if (!ip) { this.d.log?.(`DHCP : plus d'adresse libre pour ${p.mac}`); return; }
      // Les offres restées sans suite (des adresses MAC inventées qui demandent sans jamais prendre) ne s'entassent pas en mémoire.
      if (this.offered.size > 1024) for (const [m2, o2] of this.offered) if (now - o2.at >= 60_000 || now < o2.at) this.offered.delete(m2);
      if (this.offered.size > 4096) this.offered.clear();
      this.offered.set(p.mac, { ip, at: now }); this.reply(p, MSG.OFFER, ip); return;
    }
    if (type === MSG.REQUEST) {
      if (serverId && serverId !== c.server) { this.offered.delete(p.mac); return; }   // il a choisi un autre serveur
      const want = requested ?? (p.ciaddr !== '0.0.0.0' ? p.ciaddr : undefined);
      const ip = this.pick(p.mac, want);
      if (!want || ip !== want) { this.reply(p, MSG.NAK, '0.0.0.0'); return; }
      const fixed = c.fixed.find((f) => f.mac.toLowerCase() === p.mac), avant = this.d.leases().find((l) => l.mac === p.mac);
      // Un nom donné par le propriétaire reste : le nom que l'appareil annonce ne l'écrase plus.
      const garde = !fixed?.name && avant?.named && avant.name ? avant.name : undefined, classe = classeAnnoncee(p.options.get(60));
      this.keep({ mac: p.mac, ip, name: fixed?.name ?? garde ?? name ?? avant?.name, expires: now + c.leaseSeconds * 1000, ...(fixed ? { fixed: true } : {}), ...(garde ? { named: true } : {}), ...(classe ? { vendorClass: classe } : {}) });
      this.offered.delete(p.mac); this.reply(p, MSG.ACK, ip); return;
    }
    if (type === MSG.RELEASE) {
      // Il rend SON adresse (celle de son bail en cours) : une autre adresse, ou un bail déjà fini, ne change rien.
      const tous = this.d.leases(), tenu = tous.find((l) => l.mac === p.mac && !l.fixed && l.expires > now && (p.ciaddr === '0.0.0.0' || p.ciaddr === l.ip));
      if (tenu) { this.d.save(tous.map((l) => (l === tenu ? { ...l, expires: now } : l))); this.d.onEvent?.(p.mac, tenu.ip, 'libere'); }
      return;
    }
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
