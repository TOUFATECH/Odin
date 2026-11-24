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
/** Une adresse MAC ramenée à une seule écriture (« AA-BB-CC-DD-EE-FF » → « aa:bb:cc:dd:ee:ff ») ; autre chose : en minuscules, tel quel. Pur. */
export const macUnie = (m: unknown): string => { const h = String(m ?? '').toLowerCase().replace(/[\s:.\-]/g, ''); return /^[0-9a-f]{12}$/.test(h) ? h.match(/../g)!.join(':') : String(m ?? '').toLowerCase(); };
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
  /** les autres adresses d'Odin lui-même (toutes ses cartes) : jamais données à un appareil, même par une réservation abîmée */
  propres?: () => string[];
  /** la prise réseau est tombée après le démarrage (carte débranchée, envoi impossible) : le serveur a cessé de servir */
  onError?: (raison: string) => void;
  /** un appareil vient de demander son adresse à un AUTRE serveur d'adresses (sa demande le nomme) : un autre distribue peut-être sur ce réseau */
  onAutre?: (serveur: string, mac: string) => void;
  /** vrai : le serveur se tait (ni offre, ni accord, ni refus) : Odin est en train de vérifier qu'aucun autre serveur d'adresses ne répond, ou n'a pas pu le vérifier */
  muet?: () => boolean }

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

  /**
   * L'adresse à proposer à cet appareil : son adresse fixe, son bail, celle qu'il demande si elle est libre, sinon la
   * première libre. Jamais deux appareils sur la même adresse (lot R3) :
   *  - une adresse réservée à un appareil sort de la plage : elle n'est jamais donnée à un autre, même à celui qui la
   *    tenait avant (son vieux bail ne compte plus) ;
   *  - tant qu'un autre tient encore l'adresse réservée (bail en cours, adresse retenue, adresse signalée « déjà
   *    utilisée »), l'appareil reçoit une adresse de la plage en attendant ;
   *  - l'adresse d'Odin (toutes ses cartes) et celle de la box ne sont données à personne, même si une réservation abîmée
   *    le disait ; celle du serveur DNS de la maison n'est donnée qu'à l'appareil qui la tient ou à qui elle est réservée ;
   *  - jamais l'adresse du réseau lui-même ni son adresse de diffusion, même si la plage les couvre.
   */
  pick(mac: string, wanted?: string): string | undefined {
    const c = this.d.config(), now = this.now(), leases = this.d.leases();
    const lo = ipNum(c.start), hi = ipNum(c.end), dansPlage = (ip: string) => ipNum(ip) >= lo && ipNum(ip) <= hi;
    const refusee = (ip: string) => (this.declined.get(ip) ?? 0) > now;
    const tenueParUnAutre = (ip: string) => leases.some((l) => l.mac !== mac && l.ip === ip && (l.expires > now || (l.hold ?? 0) > now));
    const gardees = this.gardees(c);
    const fixed = c.fixed.find((f) => macUnie(f.mac) === mac);
    if (fixed && !gardees.has(fixed.ip) && !tenueParUnAutre(fixed.ip) && !refusee(fixed.ip)) return fixed.ip;
    const taken = new Set([...leases.filter((l) => l.mac !== mac && (l.expires > now || l.fixed || (l.hold ?? 0) > now)).map((l) => l.ip), ...c.fixed.map((f) => f.ip), ...gardees, ...[...this.offered.entries()].filter(([m, o]) => m !== mac && now - o.at < 60_000).map(([, o]) => o.ip)]);
    for (const [ip, until] of this.declined) if (until > now) taken.add(ip);
    // Son bail : gardé s'il est encore dans la plage (ou si c'est le serveur DNS de la maison) et que personne d'autre n'y a droit.
    const mine = leases.find((l) => l.mac === mac); if (mine && !taken.has(mine.ip) && (dansPlage(mine.ip) || c.dns.includes(mine.ip))) return mine.ip;
    for (const d of c.dns) taken.add(d);
    if (wanted && dansPlage(wanted) && !taken.has(wanted)) return wanted;
    for (let n = lo; n <= hi; n++) if (!taken.has(numIp(n))) return numIp(n);
    // Plus rien de libre : on reprend le bail expiré le plus ancien (jamais une adresse réservée ou gardée).
    const old = leases.filter((l) => !l.fixed && l.mac !== mac && l.expires <= now && (l.hold ?? 0) <= now && dansPlage(l.ip) && !taken.has(l.ip)).sort((a, b) => a.expires - b.expires)[0];
    return old?.ip;
  }
  /** Les adresses d'Odin lui-même : celle des réglages et celles de ses cartes. */
  private gardeesOdin(c: DhcpConfig): Set<string> {
    const g = new Set<string>([c.server]);
    try { for (const ip of this.d.propres?.() ?? []) if (ipPropre(ip)) g.add(ip); } catch { /* sans la liste des cartes : l'adresse des réglages suffit */ }
    return g;
  }
  /** Les adresses qu'Odin ne donne à aucun appareil : la sienne (toutes ses cartes), celle de la box, celle du réseau lui-même et sa diffusion. */
  private gardees(c: DhcpConfig): Set<string> {
    const g = new Set<string>([c.server, c.router]);
    try { for (const ip of this.d.propres?.() ?? []) if (ipPropre(ip)) g.add(ip); } catch { /* sans la liste des cartes : l'adresse des réglages reste gardée */ }
    const r = reseauDe(c); if (r) { g.add(numIp(r.net)); g.add(numIp(r.diffusion)); }
    return g;
  }
  /**
   * Un bail EN COURS hors de la plage distribuée, sans réservation (la plage a été changée un jour, ou la réservation
   * retirée) : Odin ne le renouvelle plus, mais ne le casse pas non plus. L'appareil garde son adresse jusqu'à la fin de
   * ce bail (personne d'autre ne la reçoit d'ici là), puis il redemande et reçoit une adresse de la plage. Un refus net
   * reste donné quand il le faut : adresse hors du réseau, adresse d'Odin ou de la box, adresse réservée à un autre ou
   * signalée, réservation changée par le propriétaire.
   */
  private finitSonBail(mac: string, ip: string, c: DhcpConfig, now: number): boolean {
    const leases = this.d.leases();
    if (!leases.some((l) => l.mac === mac && l.ip === ip && l.expires > now)) return false;
    const r = reseauDe(c); if (!r || !ipPropre(ip) || !ipPropre(c.start) || !ipPropre(c.end)) return false;
    const n = ipNum(ip);
    if (n < r.premiere || n > r.derniere || (n >= ipNum(c.start) && n <= ipNum(c.end))) return false;
    if (c.fixed.some((f) => macUnie(f.mac) === mac || f.ip === ip) || this.gardees(c).has(ip) || (this.declined.get(ip) ?? 0) > now) return false;
    return !leases.some((l) => l.mac !== mac && l.ip === ip && (l.expires > now || (l.hold ?? 0) > now));
  }
  /** Les adresses qu'un appareil a signalées « déjà utilisées » (il a trouvé quelqu'un dessus) : Odin ne les donne plus pendant une heure. */
  signalees(now = this.now()): string[] { return [...this.declined].filter(([, t]) => t > now).map(([ip]) => ip); }
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
    // La question qu'Odin pose lui-même chaque minute (« un autre serveur d'adresses répond-il ? ») part de sa propre adresse :
    // il ne se répond pas, et ne se note ni « vu » ni « en attente ». Un vrai appareil sans adresse demande depuis 0.0.0.0.
    if (type === MSG.DISCOVER && _r && p.ciaddr === '0.0.0.0' && !/^127\./.test(_r.address) && this.gardeesOdin(c).has(_r.address)) return;
    const name = nomAnnonce(p.options.get(12));
    if (type !== MSG.RELEASE && type !== MSG.DECLINE) this.vu(p.mac, now);
    const requested = p.options.get(50)?.length === 4 ? ipStr(p.options.get(50)!, 0) : undefined;
    const serverId = p.options.get(54)?.length === 4 ? ipStr(p.options.get(54)!, 0) : undefined;
    // Lot R4 : pendant qu'Odin vérifie qu'aucun autre serveur d'adresses ne répond (ou tant qu'il n'a pas pu le vérifier), il
    // se tait : jamais deux serveurs qui répondent en même temps. L'appareil redemande quelques secondes plus tard. Un appareil
    // qui nomme un autre serveur reste signalé. Rendre ou signaler une adresse (RELEASE, DECLINE) n'attend aucune réponse.
    if (type === MSG.DISCOVER || type === MSG.REQUEST || type === MSG.INFORM) {
      let muet = false; try { muet = this.d.muet?.() === true; } catch { muet = true; }
      if (muet) { if (type === MSG.REQUEST && serverId && serverId !== c.server && ipPropre(serverId) && serverId !== '0.0.0.0') { try { this.d.onAutre?.(serverId, p.mac); } catch { /* prévenir ne doit rien casser */ } } return; }
    }
    // Contrôle d'accès par adresse MAC : bloquée → rien, en pause → NAK (ou pas d'OFFER), inconnue en liste → en attente.
    const isFixed = c.fixed.some((f) => macUnie(f.mac) === p.mac);
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
      // Il a choisi un autre serveur : rien pour lui ici. Et c'est un signe qu'un autre serveur d'adresses répond (lot R4).
      if (serverId && serverId !== c.server) { this.offered.delete(p.mac); if (ipPropre(serverId) && serverId !== '0.0.0.0') { try { this.d.onAutre?.(serverId, p.mac); } catch { /* prévenir ne doit rien casser */ } } return; }
      const want = requested ?? (p.ciaddr !== '0.0.0.0' ? p.ciaddr : undefined);
      const ip = this.pick(p.mac, want);
      if (want && ip !== want && this.finitSonBail(p.mac, want, c, now)) {
        // Ni accord (son bail n'est pas rallongé) ni refus net (il ne perd pas son adresse sur-le-champ) : il va au bout de son bail.
        if (this.aNoter(p.mac, 'fin de bail', now)) this.d.log?.(`DHCP : ${p.mac} tient ${want}, hors de la plage et sans réservation : son bail va jusqu'au bout, puis il recevra une adresse de la plage`);
        return;
      }
      if (!want || ip !== want) { this.reply(p, MSG.NAK, '0.0.0.0'); return; }
      const fixed = c.fixed.find((f) => macUnie(f.mac) === p.mac), avant = this.d.leases().find((l) => l.mac === p.mac);
      // Un nom donné par le propriétaire reste : le nom que l'appareil annonce ne l'écrase plus.
      const garde = !fixed?.name && avant?.named && avant.name ? avant.name : undefined, classe = classeAnnoncee(p.options.get(60));
      this.keep({ mac: p.mac, ip, name: fixed?.name ?? garde ?? name ?? avant?.name, expires: now + c.leaseSeconds * 1000, ...(fixed && fixed.ip === ip ? { fixed: true } : {}), ...(garde ? { named: true } : {}), ...(classe ? { vendorClass: classe } : {}) });
      this.offered.delete(p.mac); this.reply(p, MSG.ACK, ip); return;
    }
    if (type === MSG.RELEASE) {
      // Il rend SON adresse (celle de son bail en cours) : une autre adresse, ou un bail déjà fini, ne change rien.
      const tous = this.d.leases(), tenu = tous.find((l) => l.mac === p.mac && !l.fixed && l.expires > now && (p.ciaddr === '0.0.0.0' || p.ciaddr === l.ip));
      if (tenu) { this.d.save(tous.map((l) => (l === tenu ? { ...l, expires: now } : l))); this.d.onEvent?.(p.mac, tenu.ip, 'libere'); }
      return;
    }
    if (type === MSG.DECLINE) {
      // « Cette adresse est déjà utilisée » ne compte que pour l'adresse qu'Odin a donnée ou proposée à CET appareil : sinon
      // n'importe quel appareil ferait perdre la leur aux autres (le serveur DNS de la maison compris) d'un seul paquet.
      if (!requested || !(this.d.leases().some((l) => l.mac === p.mac && l.ip === requested) || this.offered.get(p.mac)?.ip === requested)) return;
      this.offered.delete(p.mac);
      if (requested) { this.declined.delete(requested); this.declined.set(requested, now + 3600_000); if (this.declined.size > 1024) for (const k of this.declined.keys()) { this.declined.delete(k); if (this.declined.size <= 768) break; } } this.d.save(this.d.leases().filter((l) => !(l.mac === p.mac && l.ip === requested))); return;
    }
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

// ------------------------------------------------------------------ Adresses fixes et plan (maquette « Réseau », lot R3)
// « Réserver » une adresse fixe pour un appareil, et le plan de tout le réseau. Ici, la partie pure : aucune prise
// réseau, aucun fichier. Les règles : jamais deux appareils sur la même adresse ; jamais l'adresse d'Odin, de la box ou
// du serveur DNS de la maison ; une adresse réservée dans la plage distribuée en sort (`pick` ne la donne à personne
// d'autre) ; une réservation ne débloque rien. Les noms montrés sont donnés par l'appelant (déjà nettoyés).

const OCTET = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])';
const IP_STRICTE = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);
/**
 * Une adresse IPv4 bien écrite (quatre nombres de 0 à 255, séparés par des points, sans zéro devant, rien d'autre) →
 * elle-même ; sinon vide. Une adresse IPv6, un nombre, une adresse avec un masque ou un port : vide. Pur.
 */
export function ipPropre(v: unknown): string {
  if (typeof v !== 'string' || v.length > 40) return '';
  const t = v.replace(/^[ \t]+|[ \t]+$/g, '');
  return IP_STRICTE.test(t) ? t : '';
}
/** Le réseau de la maison d'après les réglages du DHCP (la passerelle et le masque). */
export interface Reseau { net: number; diffusion: number; premiere: number; derniere: number; prefixe: number }
/** Rien si les réglages ne décrivent pas un réseau valable (masque troué, réseau trop grand ou trop petit). Pur. */
export function reseauDe(c: Pick<DhcpConfig, 'router' | 'mask' | 'server'>): Reseau | undefined {
  const m = ipPropre(c.mask), r = ipPropre(c.router) || ipPropre(c.server); if (!m || !r) return undefined;
  const masque = ipNum(m), inv = ~masque >>> 0;
  if ((inv & (inv + 1)) !== 0) return undefined;   // un masque, c'est des 1 puis des 0
  const prefixe = 32 - Math.round(Math.log2(inv + 1));
  if (prefixe < 8 || prefixe > 30) return undefined;
  const net = (ipNum(r) & masque) >>> 0, diffusion = (net | inv) >>> 0;
  return { net, diffusion, premiere: net + 1, derniere: diffusion - 1, prefixe };
}

/** À quoi sert une adresse du réseau : la box, Odin, le serveur DNS, une adresse fixe, un bail en cours, une adresse retenue, libre dans la plage, libre hors de la plage. */
export type SorteAdresse = 'box' | 'odin' | 'dns' | 'fixe' | 'bail' | 'retenue' | 'plage' | 'libre';
export interface EntreeAdresses {
  config: DhcpConfig; leases: Lease[]; now: number;
  /** les adresses qu'un appareil a signalées « déjà utilisées » (`DhcpServer.signalees`) */
  signalees?: string[];
  /** les autres adresses d'Odin lui-même (ses cartes réseau) */
  odin?: string[];
  /** les adresses qui ont posé une question au DNS d'Odin il y a peu : un appareil réglé à la main s'y trouve peut-être (Odin ne le voit pas autrement) */
  vues?: string[];
  /** les appareils verrouillés : adresse MAC → la box, Odin ou le serveur DNS de la maison */
  verrous?: Record<string, 'box' | 'odin' | 'dns'>;
  /** le nom à montrer pour une adresse MAC (déjà nettoyé) */
  nom?: (mac: string) => string;
  /** une heure lisible */
  heure?: (t: number) => string;
  /** le DHCP d'Odin distribue-t-il les adresses ? (faux : c'est la box) */
  allume?: boolean;
}
interface Occupee { sorte: Exclude<SorteAdresse, 'plage' | 'libre'> | 'signalee'; mac?: string; jusqua?: number }
/** Chaque adresse du réseau qui n'est pas libre, et pourquoi. La première raison posée reste (Odin, la box, le DNS passent devant). */
function occupees(o: EntreeAdresses, r: Reseau): Map<number, Occupee> {
  const c = o.config, m = new Map<number, Occupee>();
  const poser = (ip: unknown, x: Occupee) => { const t = ipPropre(ip); if (!t) return; const n = ipNum(t); if (n >= r.premiere && n <= r.derniere && !m.has(n)) m.set(n, x); };
  for (const ip of [c.server, ...(o.odin ?? [])]) poser(ip, { sorte: 'odin' });
  poser(c.router, { sorte: 'box' });
  for (const d of c.dns ?? []) poser(d, { sorte: 'dns' });
  for (const f of c.fixed ?? []) poser(f.ip, { sorte: 'fixe', mac: macUnie(f.mac) });
  for (const l of o.leases) if (l.expires > o.now) poser(l.ip, { sorte: 'bail', mac: l.mac.toLowerCase(), jusqua: l.expires });
  for (const l of o.leases) if (!(l.expires > o.now) && (l.hold ?? 0) > o.now) poser(l.ip, { sorte: 'retenue', mac: l.mac.toLowerCase(), jusqua: l.hold });
  for (const ip of o.signalees ?? []) poser(ip, { sorte: 'signalee' });
  return m;
}
/** La plage distribuée, ramenée dans le réseau (vide, `lo > hi`, si elle est à l'envers ou dehors). */
function plageDe(c: DhcpConfig, r: Reseau): { lo: number; hi: number } {
  const a = ipPropre(c.start), b = ipPropre(c.end); if (!a || !b) return { lo: 1, hi: 0 };
  return { lo: Math.max(ipNum(a), r.premiere), hi: Math.min(ipNum(b), r.derniere) };
}
/** La première adresse libre, hors de la plage distribuée d'abord (sinon dans la plage). Vide : plus rien de libre. Pur. */
export function premiereLibre(o: EntreeAdresses): string {
  const r = reseauDe(o.config); if (!r) return '';
  const occ = occupees(o, r), { lo, hi } = plageDe(o.config, r);
  // Une adresse qui vient de parler au DNS d'Odin n'est pas proposée : un appareil réglé à la main s'y trouve peut-être.
  const parle = new Set((o.vues ?? []).map((ip) => ipPropre(ip)).filter(Boolean).map(ipNum)), libre = (n: number) => !occ.has(n) && !parle.has(n);
  let pas = 0;
  for (let n = r.premiere; n <= r.derniere && pas < 65_536; n++, pas++) { if (lo <= hi && n === lo) { n = hi; continue; } if (libre(n)) return numIp(n); }
  for (let n = lo; n <= hi && pas < 131_072; n++, pas++) if (libre(n)) return numIp(n);
  return '';
}

export type CodeAdresse = 'libre' | 'plage' | 'meme' | 'mac' | 'reglages' | 'ecriture' | 'ipv6' | 'nulle' | 'diffusion' | 'reseau' | 'hors' | 'verrou' | 'odin' | 'box' | 'dns' | 'reservee' | 'bail' | 'retenue' | 'signalee' | 'vue';
export interface VerdictAdresse {
  /** l'adresse peut être réservée à cet appareil */
  ok: boolean; code: CodeAdresse;
  /** l'adresse, bien écrite (vide si elle ne l'est pas) */
  ip: string; mac: string;
  /** la réponse en une phrase : « Libre. », « Dans la plage distribuée… », « Refusé : … » */
  message: string;
  /** ce qu'il faut savoir en plus (il reste bloqué, il changera d'adresse à son prochain renouvellement…) */
  avis: string[];
  dansPlage: boolean;
  /** la première adresse libre qu'Odin propose (hors de la plage distribuée d'abord) */
  proposee: string;
  /** l'appareil qui a déjà cette adresse (refus « déjà prise ») */
  aQui?: string;
}
/**
 * Peut-on réserver cette adresse à cet appareil ? Refusé : adresse mal écrite, IPv6, 0.0.0.0, diffusion, adresse du
 * réseau, hors du réseau ; l'adresse d'Odin, de la box, du serveur DNS ; déjà réservée à un autre, tenue par un autre
 * (bail en cours), retenue (appareil bloqué qui ne l'a pas encore lâchée), signalée « déjà utilisée », ou une adresse
 * depuis laquelle un AUTRE appareil parle encore au DNS d'Odin (réglé à la main, ou bail fini mais adresse gardée). Dans la plage
 * distribuée : accepté, et dit (elle sort de la plage). Rien n'est écrit, rien n'est débloqué. Pur.
 */
export function verifierAdresse(o: EntreeAdresses & { mac: string; ip: unknown }): VerdictAdresse {
  const c = o.config, mac = macUnie(o.mac), nom = (m?: string) => (m ? o.nom?.(m) || m : 'un autre appareil');
  const heure = o.heure ?? ((t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; });
  const r = reseauDe(c), proposee = r ? premiereLibre(o) : '', propose = proposee ? ` Odin propose ${proposee}.` : ' Il ne reste aucune adresse libre.';
  const non = (code: CodeAdresse, message: string, plus: Partial<VerdictAdresse> = {}): VerdictAdresse => ({ ok: false, code, ip: '', mac, message, avis: [], dansPlage: false, proposee, ...plus });
  if (!MAC_SIMPLE.test(mac)) return non('mac', 'Adresse MAC mal écrite : six groupes de deux caractères (chiffres et lettres de a à f).', { mac: '' });
  if (!r) return non('reglages', 'Les réglages du DHCP (passerelle, masque) ne décrivent pas un réseau valable : corrige-les d\'abord. Rien n\'est réservé.');
  if (typeof o.ip === 'string' && o.ip.includes(':')) return non('ipv6', 'Refusé : c\'est une adresse IPv6. Le DHCP d\'Odin distribue des adresses IPv4 : quatre nombres séparés par des points.');
  const ip = ipPropre(o.ip);
  if (!ip) return non('ecriture', 'Adresse mal écrite : quatre nombres de 0 à 255 séparés par des points, sans zéro devant et rien d\'autre.');
  const n = ipNum(ip), de = numIp(r.premiere), a = numIp(r.derniere);
  if (n === 0) return non('nulle', 'Refusé : 0.0.0.0 veut dire « aucune adresse », aucun appareil ne peut la porter.');
  if (n === 0xffffffff) return non('diffusion', 'Refusé : 255.255.255.255 est l\'adresse de diffusion (elle parle à tout le monde à la fois).');
  if (n < r.net || n > r.diffusion) return non('hors', `Adresse hors du réseau de la maison (${de} à ${a}).${propose}`);
  if (n === r.net) return non('reseau', `Refusé : ${ip} est l'adresse du réseau lui-même, aucun appareil ne peut la porter.${propose}`);
  if (n === r.diffusion) return non('diffusion', `Refusé : ${ip} est l'adresse de diffusion du réseau (elle parle à tous les appareils à la fois).${propose}`);
  const verrou = o.verrous?.[mac];
  if (verrou) return non('verrou', verrou === 'box' ? 'Refusé : cet appareil est la box, la passerelle de toute la maison. Son adresse ne se change pas d\'ici : elle se règle dans la box, puis dans les réglages du DHCP.'
    : verrou === 'odin' ? 'Refusé : cet appareil est Odin lui-même. Son adresse ne se change pas d\'ici : elle se règle sur la machine d\'Odin.'
      : 'Refusé : cet appareil est le serveur DNS de la maison (celui qu\'Odin donne à tous les appareils). Changer son adresse couperait les noms, donc Internet, à tout le monde. Change d\'abord le DNS donné aux appareils (réglages du DHCP).');
  const x = occupees(o, r).get(n), autre = Boolean(x?.mac && x.mac !== mac);
  if (x?.sorte === 'odin') return non('odin', `Refusé : ${ip} est l'adresse d'Odin lui-même. Elle n'est donnée à aucun appareil.${propose}`);
  if (x?.sorte === 'box') return non('box', `Refusé : ${ip} est l'adresse de la box, la passerelle de toute la maison. Elle n'est donnée à aucun appareil.${propose}`);
  if (x?.sorte === 'dns') return non('dns', `Refusé : ${ip} est l'adresse du serveur DNS de la maison (celui qu'Odin donne à tous les appareils). Elle n'est donnée à aucun autre appareil.${propose}`);
  // Déjà réservée à un autre, quelle que soit la ligne des réglages qui le dit (deux lignes sur la même adresse : jamais confirmé).
  const aUnAutre = (c.fixed ?? []).find((f) => ipPropre(f.ip) === ip && macUnie(f.mac) !== mac);
  if (aUnAutre) return non('reservee', `Refusé : ${ip} est déjà réservée à « ${nom(macUnie(aUnAutre.mac))} ».${propose}`, { aQui: macUnie(aUnAutre.mac) });
  if (x?.sorte === 'fixe' && autre) return non('reservee', `Refusé : ${ip} est déjà réservée à « ${nom(x.mac)} ».${propose}`, { aQui: x.mac });
  if (x?.sorte === 'bail' && autre) return non('bail', `Refusé : ${ip} est déjà à « ${nom(x.mac)} » (son bail court jusqu'à ${heure(x.jusqua ?? 0)}).${propose}`, { aQui: x.mac });
  if (x?.sorte === 'retenue' && autre) return non('retenue', `Refusé : ${ip} est retenue jusqu'à ${heure(x.jusqua ?? 0)} : « ${nom(x.mac)} », bloqué ou en pause, ne l'a peut-être pas encore lâchée.${propose}`, { aQui: x.mac });
  if (x?.sorte === 'signalee') return non('signalee', `Refusé : un appareil a signalé que ${ip} est déjà utilisée par quelqu'un (une adresse réglée à la main, sans doute).${propose}`);
  // Une adresse réservée à cet appareil mais qu'un AUTRE tient encore (réglage ancien ou abîmé) : jamais deux sur la même.
  const tenant = o.leases.find((l) => l.mac.toLowerCase() !== mac && l.ip === ip && (l.expires > o.now || (l.hold ?? 0) > o.now));
  if (tenant) return non(tenant.expires > o.now ? 'bail' : 'retenue', `Refusé : ${ip} est encore tenue par « ${nom(tenant.mac.toLowerCase())} » jusqu'à ${heure(Math.max(tenant.expires, tenant.hold ?? 0))}.${propose}`, { aQui: tenant.mac.toLowerCase() });
  const tenu = o.leases.find((l) => l.mac.toLowerCase() === mac && l.expires > o.now), vues = o.vues ?? [];
  // Une adresse qui vient de parler au DNS d'Odin sans être celle que cet appareil tient : quelqu'un s'en sert. Refusé quand
  // c'est sûrement un AUTRE appareil (jamais deux sur la même adresse) ; dans le doute, accepté et dit (plus bas).
  if (vues.includes(ip) && !(tenu && tenu.ip === ip)) {
    const ancien = o.leases.find((l) => l.mac.toLowerCase() !== mac && l.ip === ip);
    if (ancien) return non('vue', `Refusé : « ${nom(ancien.mac.toLowerCase())} » utilise encore ${ip} : son bail est fini, mais une question vient d'être posée au DNS d'Odin depuis cette adresse. Réessaie dans dix minutes, ou choisis une autre adresse.${propose}`, { aQui: ancien.mac.toLowerCase() });
    if (tenu && vues.includes(tenu.ip)) return non('vue', `Refusé : un autre appareil utilise ${ip} en ce moment (une adresse réglée à la main, sans doute) : une question vient d'être posée au DNS d'Odin depuis cette adresse, alors que cet appareil-ci parle depuis ${tenu.ip}.${propose}`);
  }
  // Accepté. Ce qu'il faut savoir en plus.
  const { lo, hi } = plageDe(c, r), dans = (k: number) => k >= lo && k <= hi, dansPlage = dans(n), avis: string[] = [];
  const avant = (c.fixed ?? []).find((f) => macUnie(f.mac) === mac);
  const meme = avant?.ip === ip;
  if (avant && !meme && ipPropre(avant.ip)) avis.push(`Son ancienne adresse fixe ${avant.ip} redevient libre${dans(ipNum(avant.ip)) ? ' : elle revient dans la plage distribuée' : ''}.`);
  if (tenu && tenu.ip !== ip) avis.push(`Il tient encore ${tenu.ip} : il passera à ${ip} à son prochain renouvellement, au plus tard à ${heure(tenu.expires)} (ou dès qu'il se reconnecte).`);
  else if (tenu) avis.push('Il tient déjà cette adresse : rien ne change pour lui, elle lui reste.');
  else avis.push('Prise en compte dès qu\'il demandera une adresse à Odin.');
  // Odin ne voit pas un appareil réglé à la main… sauf s'il passe par son DNS : il le dit, sans refuser (c'est peut-être cet appareil-là).
  if (!(tenu && tenu.ip === ip) && vues.includes(ip)) avis.push(`Une question a été posée au DNS d'Odin depuis ${ip} il y a peu : un appareil réglé à la main l'utilise peut-être déjà. Si c'est cet appareil, tout va bien ; sinon, choisis une autre adresse.`);
  const pol = c.macPolicy, etat = pol?.etats[mac];
  if (etat === 'bloque') avis.push('Il est bloqué, et il le reste : une adresse fixe ne débloque rien. Il la recevra quand tu le débloqueras.');
  else if (etat === 'pause') avis.push('Il est en pause, et il le reste : une adresse fixe ne lève pas la pause. Il la recevra à la fin de la pause.');
  else if (pol?.mode === 'liste' && etat !== 'actif') avis.push('Seuls les appareils approuvés reçoivent une adresse : lui en réserver une vaut accord, il recevra celle-ci.');
  if (randomMac(mac)) avis.push('Adresse MAC privée : s\'il change d\'adresse MAC, la réservation ne le suivra pas.');
  if (o.allume === false) avis.push('Aujourd\'hui la box distribue les adresses : c\'est noté, et appliqué dès qu\'Odin les distribuera.');
  const message = meme ? 'C\'est déjà son adresse fixe.' : dansPlage ? 'Dans la plage distribuée : Odin la retire de la plage pour qu\'aucun autre appareil ne la reçoive.' : 'Libre.';
  return { ok: true, code: meme ? 'meme' : dansPlage ? 'plage' : 'libre', ip, mac, message, avis, dansPlage, proposee };
}

/** Un morceau du plan : des adresses qui se suivent et servent à la même chose. */
export interface Tranche { de: string; a: string; n: number; sorte: SorteAdresse }
export interface PlanAdresses {
  /** faux : les réglages du DHCP ne décrivent pas un réseau valable (`erreur` dit pourquoi) */
  ok: boolean; erreur: string;
  /** le réseau (adresse et longueur du masque), sa première et sa dernière adresse utilisables, leur nombre */
  reseau: string; premiere: string; derniere: string; total: number;
  /** la plage distribuée : ses bornes, sa taille, et ce qui s'y trouve (baux en cours, adresses fixes sorties de la plage, adresses retenues, libres) */
  plage: { debut: string; fin: string; taille: number; prises: number; fixes: number; retenues: number; libres: number };
  /** combien d'adresses de chaque sorte */
  comptes: Record<SorteAdresse, number>;
  /** tout le réseau, de la première à la dernière adresse */
  tranches: Tranche[];
  /** où sont Odin et la box (vide : hors de ce réseau) */
  odin: string; box: string;
  /** la première adresse libre qu'Odin propose pour une réservation */
  proposee: string;
}
/** Le plan de tout le réseau : la box, Odin, le DNS, les adresses fixes, la plage distribuée (prises, libres), les adresses retenues, le reste. Pur. */
export function planAdresses(o: EntreeAdresses): PlanAdresses {
  const c = o.config, r = reseauDe(c), zero = (): Record<SorteAdresse, number> => ({ box: 0, odin: 0, dns: 0, fixe: 0, bail: 0, retenue: 0, plage: 0, libre: 0 });
  if (!r) return { ok: false, erreur: 'Les réglages du DHCP (passerelle, masque) ne décrivent pas un réseau valable.', reseau: '', premiere: '', derniere: '', total: 0, plage: { debut: '', fin: '', taille: 0, prises: 0, fixes: 0, retenues: 0, libres: 0 }, comptes: zero(), tranches: [], odin: '', box: '', proposee: '' };
  const occ = occupees(o, r), { lo, hi } = plageDe(c, r), cles = [...occ.keys()].sort((x, y) => x - y);
  const sorteDe = (k: number): SorteAdresse => { const s = occ.get(k)?.sorte; return s && s !== 'signalee' ? s : k >= lo && k <= hi ? 'plage' : 'libre'; };
  const tranches: Tranche[] = [], comptes = zero(), plage = { debut: lo <= hi ? numIp(lo) : '', fin: lo <= hi ? numIp(hi) : '', taille: lo <= hi ? hi - lo + 1 : 0, prises: 0, fixes: 0, retenues: 0, libres: 0 };
  const ajouter = (de: number, a: number, sorte: SorteAdresse) => {
    const n = a - de + 1, der = tranches[tranches.length - 1]; comptes[sorte] += n;
    const dans = lo <= hi ? Math.max(0, Math.min(a, hi) - Math.max(de, lo) + 1) : 0;
    if (sorte === 'bail') plage.prises += dans; else if (sorte === 'fixe') plage.fixes += dans; else if (sorte === 'retenue') plage.retenues += dans; else if (sorte === 'plage') plage.libres += dans;
    if (der && der.sorte === sorte) { der.a = numIp(a); der.n += n; } else tranches.push({ de: numIp(de), a: numIp(a), n, sorte });
  };
  // On avance d'une adresse occupée à la suivante : le temps ne dépend pas de la taille du réseau.
  let k = r.premiere, i = 0;
  while (k <= r.derniere) {
    while (i < cles.length && cles[i] < k) i++;
    if (i < cles.length && cles[i] === k) { ajouter(k, k, sorteDe(k)); k++; continue; }
    let fin = i < cles.length ? cles[i] - 1 : r.derniere;
    if (lo <= hi) { if (k < lo) fin = Math.min(fin, lo - 1); else if (k <= hi) fin = Math.min(fin, hi); }
    ajouter(k, fin, sorteDe(k)); k = fin + 1;
  }
  const ou = (s: 'odin' | 'box') => { for (const [n, x] of occ) if (x.sorte === s) return numIp(n); return ''; };
  return { ok: true, erreur: '', reseau: `${numIp(r.net)}/${r.prefixe}`, premiere: numIp(r.premiere), derniere: numIp(r.derniere), total: r.derniere - r.premiere + 1, plage, comptes, tranches, odin: ou('odin'), box: ou('box'), proposee: premiereLibre(o) };
}
