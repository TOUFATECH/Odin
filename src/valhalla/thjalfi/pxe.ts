// Genèse · la réponse aux machines qui démarrent par le réseau (PXE).
//   - « proxy DHCP » : la box (ou un autre DHCP) donne l'adresse, Odin ajoute seulement « démarre avec ce
//     chargeur, chez moi » (ports 67 et 4011). Rien à régler sur la box.
//   - avec le DHCP d'Odin (Sphinx) : le crochet ajoute la même chose dans sa réponse.
// Le chargeur est iPXE (binaires officiels). Une fois iPXE lancé, il redemande et reçoit l'adresse HTTP du menu.
import dgram from 'node:dgram';
import { buildPacket, MSG, parsePacket, type Packet } from '../vidarr/dhcp.ts';

export type Firmware = 'bios' | 'uefi' | 'uefi32' | 'arm64';
export interface Boot { siaddr: string; file: string; options: Array<[number, Buffer]> }
const ipBuf = (s: string) => Buffer.from(s.split('.').map(Number));

/** Le micrologiciel d'une machine d'après sa demande (option 93 « architecture du client »). Pur. */
export function firmwareOf(p: Packet): Firmware {
  const a = p.options.get(93); const n = a && a.length >= 2 ? a.readUInt16BE(0) : 0;
  return n === 6 ? 'uefi32' : n === 7 || n === 9 ? 'uefi' : n === 11 ? 'arm64' : 'bios';
}
/** Une machine qui démarre par le réseau (« PXEClient ») ? iPXE déjà lancé (« iPXE ») ? Pur. */
export function isPxe(p: Packet): boolean { return (p.options.get(60)?.toString('latin1') ?? '').startsWith('PXEClient'); }
export function isIpxe(p: Packet): boolean { return (p.options.get(77)?.toString('latin1') ?? '').includes('iPXE') || p.options.get(175) !== undefined; }
/** Le chargeur à donner selon le micrologiciel (iPXE pour le BIOS, l'UEFI 64 bits et ARM). Pur. */
export function loaderFor(fw: Firmware): string { return fw === 'bios' ? 'undionly.kpxe' : fw === 'arm64' ? 'ipxe-arm64.efi' : fw === 'uefi32' ? 'ipxe-i386.efi' : 'ipxe.efi'; }

/** Ce qu'il faut ajouter à une réponse DHCP pour cette machine (ou rien si ce n'est pas une machine PXE). Pur. */
export function bootFor(p: Packet, server: string, httpPort: number): Boot | undefined {
  if (!isPxe(p) && !isIpxe(p)) return undefined;
  const file = isIpxe(p) ? `http://${server}:${httpPort}/boot.ipxe` : loaderFor(firmwareOf(p));
  const opts: Array<[number, Buffer]> = [[60, Buffer.from('PXEClient')], [66, Buffer.from(server)], [67, Buffer.from(file)]];
  // Options PXE (43) : pas de recherche de serveur de démarrage, prendre directement le fichier donné.
  if (!isIpxe(p)) opts.push([43, Buffer.from([6, 1, 8, 255])]);
  const uuid = p.options.get(97); if (uuid) opts.push([97, uuid]);
  return { siaddr: server, file, options: opts };
}

export interface ProxyDeps { server: () => string; httpPort: () => number; allowed?: (mac: string) => boolean; seen?: (mac: string, fw: Firmware, ipxe: boolean, from: string) => void; log?: (s: string) => void }

/** Le proxy DHCP : répond seulement aux machines PXE, sans jamais donner d'adresse (la box s'en charge). */
export class ProxyDhcp {
  private socks: dgram.Socket[] = []; ports = { dhcp: 67, pxe: 4011 }; clientPort = 68;
  private d: ProxyDeps;
  constructor(d: ProxyDeps) { this.d = d; }
  async start(dhcpPort = 67, pxePort = 4011, clientPort = 68, host = '0.0.0.0'): Promise<void> {
    this.clientPort = clientPort;
    for (const [port, kind] of [[dhcpPort, 'dhcp'], [pxePort, 'pxe']] as const) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      await new Promise<void>((ok, ko) => { s.once('error', ko); s.bind(port, host, () => { s.off('error', ko); ok(); }); });
      s.setBroadcast(true);
      s.on('message', (m, r) => { try { this.onMessage(s, kind, m, r); } catch (e) { this.d.log?.(`PXE : ${(e as Error).message}`); } });
      this.socks.push(s); this.ports[kind] = (s.address() as { port: number }).port;
    }
  }
  stop(): void { for (const s of this.socks) try { s.close(); } catch { /* */ } this.socks = []; }

  onMessage(s: dgram.Socket, kind: 'dhcp' | 'pxe', m: Buffer, r: dgram.RemoteInfo): void {
    const p = parsePacket(m); if (p.op !== 1) return;
    const type = p.options.get(53)?.[0];
    if (!isPxe(p) && !isIpxe(p)) return;
    if (this.d.allowed && !this.d.allowed(p.mac)) { this.d.log?.(`PXE : ${p.mac} n'est pas dans la liste des machines autorisées`); return; }
    const server = this.d.server(), boot = bootFor(p, server, this.d.httpPort()); if (!boot) return;
    if (kind === 'dhcp' && type === MSG.DISCOVER) this.d.seen?.(p.mac, firmwareOf(p), isIpxe(p), r.address);
    const answer = kind === 'dhcp' ? (type === MSG.DISCOVER ? MSG.OFFER : undefined) : (type === MSG.REQUEST || type === MSG.INFORM ? MSG.ACK : undefined);
    if (!answer) return;
    // En proxy, on ne donne jamais d'adresse : yiaddr reste vide (la box l'a donnée ou va la donner).
    const out = buildPacket({ op: 2, xid: p.xid, flags: p.flags, ciaddr: p.ciaddr, yiaddr: '0.0.0.0', siaddr: server, giaddr: p.giaddr, mac: p.mac, file: boot.file, options: [[53, Buffer.from([answer])], [54, ipBuf(server)], ...boot.options] });
    if (kind === 'pxe') s.send(out, r.port, r.address);
    else s.send(out, this.clientPort, p.ciaddr !== '0.0.0.0' ? p.ciaddr : '255.255.255.255');
  }
}
