import { readFileSync } from 'node:fs';

// Hliðskjálf — reconnaître le fabricant d'un appareil à partir de son adresse MAC (préfixe OUI),
// et en déduire un nom lisible quand l'appareil n'en annonce pas. Liste courte des marques les
// plus sûres, puis la base officielle de l'IEEE si elle est sur la machine ; aucune requête réseau.

// Préfixes sûrs (machines virtuelles, cartes et marques très courantes). Pour tout le reste, Odin lit la
// base officielle de l'IEEE si elle est installée (paquets ieee-data, arp-scan ou nmap).
const OUI: Record<string, string> = {
  'BC:24:11': 'Proxmox', '52:54:00': 'QEMU/KVM', '00:0C:29': 'VMware', '00:50:56': 'VMware', '00:05:69': 'VMware', '00:15:5D': 'Hyper-V', '08:00:27': 'VirtualBox', '02:42:AC': 'Docker',
  'B8:27:EB': 'Raspberry Pi', 'DC:A6:32': 'Raspberry Pi', 'E4:5F:01': 'Raspberry Pi', 'D8:3A:DD': 'Raspberry Pi', '2C:CF:67': 'Raspberry Pi',
  '00:11:32': 'Synology', '00:08:9B': 'QNAP', '24:5E:BE': 'QNAP', '00:17:88': 'Philips Hue', '00:0E:58': 'Sonos', '5C:AA:FD': 'Sonos',
  '24:0A:C4': 'Espressif (objet connecté)', '30:AE:A4': 'Espressif (objet connecté)', 'A4:CF:12': 'Espressif (objet connecté)', '84:CC:A8': 'Espressif (objet connecté)', 'EC:FA:BC': 'Espressif (objet connecté)',
};

const DB_FILES = ['/usr/share/ieee-data/oui.txt', '/usr/share/arp-scan/ieee-oui.txt', '/usr/share/nmap/nmap-mac-prefixes', '/usr/share/misc/oui.txt', '/usr/local/share/nmap/nmap-mac-prefixes'];
let db: Map<string, string> | undefined;
/** Base IEEE locale (lue une fois) : formats ieee-data, arp-scan et nmap. */
function ieee(): Map<string, string> {
  if (db) return db;
  db = new Map();
  for (const f of DB_FILES) {
    let text = '';
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = line.match(/^([0-9A-Fa-f]{2})[-:]?([0-9A-Fa-f]{2})[-:]?([0-9A-Fa-f]{2})(?:\s+\(hex\))?\s+(.+)$/);
      if (m) db.set(`${m[1]}:${m[2]}:${m[3]}`.toUpperCase(), tidy(m[4]));
    }
    if (db.size) break;
  }
  return db;
}
/** « Synology Incorporated » → « Synology ». */
const tidy = (n: string) => n.trim().replace(/[,.]?\s+(Incorporated|Inc|Corporation|Corp|Co|Ltd|Limited|LLC|GmbH|S\.?A\.?S?|AG|B\.?V|Technologies|Technology|Electronics|International|Communications|Networks?)\b\.?/gi, '').replace(/[,.\s]+$/, '').slice(0, 40);

/** Fabricant d'après la MAC (pur, testable). Une MAC « aléatoire » (téléphones récents) n'en a pas. */
export function vendorOf(mac: string | undefined): string {
  if (!mac) return '';
  const m = mac.toUpperCase().replace(/-/g, ':');
  return OUI[m.slice(0, 8)] ?? ieee().get(m.slice(0, 8)) ?? '';
}

/** Indices tirés des titres des interfaces web (Proxmox, Synology DSM, Home Assistant…). */
export const WEB_HINTS: Array<[RegExp, string, string]> = [
  [/proxmox/i, 'serveur', 'Proxmox'], [/synology|diskstation|\bdsm\b/i, 'stockage (NAS)', 'Synology'], [/qnap|qts/i, 'stockage (NAS)', 'QNAP'], [/truenas|freenas|openmediavault|unraid/i, 'stockage (NAS)', ''],
  [/home assistant/i, 'domotique', 'Home Assistant'], [/jeedom|domoticz|homebridge|node-red|zigbee2mqtt/i, 'domotique', ''],
  [/openwrt|luci|pfsense|opnsense|unifi|mikrotik|routeros|freebox|livebox|bbox|fritz|tp-link|netgear|edgeos/i, 'routeur', ''],
  [/portainer|cockpit|webmin|grafana|prometheus|uptime kuma|nextcloud|gitea|pi-hole|adguard|vaultwarden/i, 'serveur', ''],
  [/plex|jellyfin|emby|kodi/i, 'multimédia', ''], [/printer|imprimante|laserjet|officejet|epson|brother|canon|kyocera/i, 'imprimante', ''],
  [/camera|caméra|ipcam|hikvision|dahua|reolink|nvr|frigate/i, 'caméra', ''],
];

/** Catégories affichées, dans l'ordre, avec un pictogramme. */
export const CATEGORIES: Array<{ kind: string; icon: string }> = [
  { kind: 'routeur', icon: '📡' }, { kind: 'serveur', icon: '🗄️' }, { kind: 'machine virtuelle', icon: '🧊' }, { kind: 'stockage (NAS)', icon: '💾' },
  { kind: 'ordinateur', icon: '💻' }, { kind: 'ordinateur / serveur', icon: '💻' }, { kind: 'téléphone / tablette', icon: '📱' }, { kind: 'multimédia', icon: '📺' },
  { kind: 'domotique', icon: '🏠' }, { kind: 'caméra', icon: '📹' }, { kind: 'imprimante', icon: '🖨️' }, { kind: 'inconnu', icon: '❔' },
];
