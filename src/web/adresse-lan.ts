// L'adresse de la machine d'Odin sur le réseau de la maison (pour un QR code lu par un téléphone).
// On écarte les réseaux de conteneurs, les tunnels (réseaux privés virtuels) et les adresses de secours 169.254.x,
// qu'aucun autre appareil de la maison ne peut joindre. Pur : la liste des interfaces est passée en paramètre.
import type { NetworkInterfaceInfo } from 'node:os';
import { VIRTUAL_IFACE } from '../hlidskjalf/discover.ts';

/** Les noms d'interfaces de tunnel (réseau privé virtuel, réseau maillé). */
export const TUNNEL_IFACE = /tailscale|zerotier|^zt|wireguard|^wg\d|^utun|^tun\d|^tap|openvpn|nordlynx|vpn|hamachi|^ppp/i;

/** Rang d'une adresse IPv4 : 192.168 d'abord, puis 10, puis 172.16-31 ; undefined si elle ne convient pas. */
function rang(ip: string): number | undefined {
  if (/^192\.168\./.test(ip)) return 0;
  if (/^10\./.test(ip)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return undefined; // 169.254 (adresse de secours), 100.64/10 (tunnels), publique… : pas l'adresse de la maison
}

/** La meilleure adresse IPv4 de la maison parmi les interfaces, ou undefined. Pur. */
export function adresseLan(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | undefined {
  const candidates: Array<{ ip: string; r: number }> = [];
  for (const [nom, liste] of Object.entries(interfaces)) {
    if (VIRTUAL_IFACE.test(nom) || TUNNEL_IFACE.test(nom)) continue;
    for (const i of liste ?? []) {
      if (!i || i.family !== 'IPv4' || i.internal) continue;
      const r = rang(i.address); if (r !== undefined) candidates.push({ ip: i.address, r });
    }
  }
  return candidates.sort((a, b) => a.r - b.r)[0]?.ip;
}
