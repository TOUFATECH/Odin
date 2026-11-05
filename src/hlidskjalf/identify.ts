// Hliðskjálf — reconnaître ce que chaque appareil expose : nom, services par port, interfaces web.
//
// - Noms : NetBIOS (ordinateurs Windows, NAS, Samba), description UPnP (box, TV, enceintes :
//   nom, fabricant, modèle), titre de la page web d'administration.
// - Ports : ~60 ports courants, chacun nommé (SSH, partage de fichiers, base de données, Proxmox…).
// - Liens : chaque interface web trouvée (http ou https détecté), avec son titre et son serveur.
// Réseau local PRIVÉ seulement, requêtes courtes, aucune dépendance.

import { createSocket } from 'node:dgram';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** Ports testés lors d'un balayage complet, avec le service habituel. */
export const PORT_SERVICES: Record<number, string> = {
  21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'Web (HTTP)', 81: 'Web', 88: 'Kerberos', 110: 'POP3', 111: 'RPC',
  139: 'Partage Windows (NetBIOS)', 143: 'IMAP', 389: 'LDAP', 443: 'Web (HTTPS)', 445: 'Partage de fichiers (SMB)', 465: 'SMTP chiffré',
  548: 'Partage Apple (AFP)', 554: 'Flux vidéo (RTSP)', 587: 'SMTP (envoi)', 631: 'Impression (IPP)', 853: 'DNS chiffré', 873: 'rsync',
  993: 'IMAP chiffré', 995: 'POP3 chiffré', 1400: 'Sonos', 1883: 'MQTT (domotique)', 2049: 'NFS', 2375: 'Docker (non chiffré)', 3000: 'Web (Grafana…)',
  3306: 'MySQL / MariaDB', 3389: 'Bureau à distance (RDP)', 5000: 'Web (Synology, Flask…)', 5001: 'Web chiffré (Synology)', 5060: 'Téléphonie (SIP)',
  5432: 'PostgreSQL', 5900: 'Écran à distance (VNC)', 6379: 'Redis', 7000: 'AirPlay', 8000: 'Web', 8006: 'Proxmox', 8008: 'Web (Cast)',
  8009: 'Google Cast', 8080: 'Web (proxy, admin)', 8081: 'Web', 8086: 'InfluxDB', 8088: 'Web', 8096: 'Jellyfin / Emby', 8123: 'Home Assistant',
  8200: 'Web', 8443: 'Web chiffré (admin)', 8883: 'MQTT chiffré', 8888: 'Web', 9000: 'Web (Portainer…)', 9090: 'Web (Cockpit, Prometheus)',
  9091: 'Transmission', 9100: 'Impression directe', 9443: 'Web chiffré (Portainer…)', 10000: 'Webmin', 32400: 'Plex', 49152: 'UPnP', 62078: 'Appareil Apple (iOS)',
};
export const SCAN_PORTS = Object.keys(PORT_SERVICES).map(Number);
/** Ports où l'on s'attend à une interface web (le chiffrement est testé). */
export const WEB_PORTS = [80, 81, 443, 3000, 5000, 5001, 8000, 8006, 8008, 8080, 8081, 8088, 8096, 8123, 8200, 8443, 8888, 9000, 9090, 9091, 9443, 10000, 32400];
const TLS_FIRST = new Set([443, 5001, 8006, 8443, 9443, 10000]);

export const serviceName = (port: number) => PORT_SERVICES[port] ?? `port ${port}`;

export interface WebEndpoint { port: number; url: string; title: string; server: string; status: number }

const clean = (t: string, max = 80) => t.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Une requête GET courte (certificat auto-signé accepté : c'est le cas de presque tous les appareils). */
function get(url: string, timeoutMs = 2500): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string } | undefined> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', rejectUnauthorized: false, timeout: timeoutMs, headers: { 'user-agent': 'Odin-Hlidskjalf/1.0', accept: 'text/html,*/*' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => { body += d; if (body.length > 65_536) res.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on('close', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on('error', () => resolve(undefined));
    });
    req.on('timeout', () => { req.destroy(); resolve(undefined); });
    req.on('error', () => resolve(undefined));
    req.end();
  });
}

/** Titre d'une page HTML (pur, testable). */
export function pageTitle(html: string): string {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ?? '';
  return clean(t);
}

/** Interface web d'un port : https d'abord sur les ports habituellement chiffrés, sinon http, puis l'autre. */
export async function probeWeb(ip: string, port: number): Promise<WebEndpoint | undefined> {
  const order = TLS_FIRST.has(port) ? ['https', 'http'] : ['http', 'https'];
  for (const scheme of order) {
    const url = `${scheme}://${ip}${(scheme === 'http' && port === 80) || (scheme === 'https' && port === 443) ? '' : `:${port}`}/`;
    const r = await get(url);
    if (!r || !r.status) continue;
    if (r.status === 400 && /plain HTTP request was sent to HTTPS|speak HTTP to an HTTPS/i.test(r.body)) continue;
    const server = clean(String(r.headers.server ?? r.headers['x-powered-by'] ?? ''), 60);
    let title = pageTitle(r.body);
    if (!title && r.status >= 300 && r.status < 400 && r.headers.location) title = `→ ${clean(String(r.headers.location), 60)}`;
    return { port, url, title, server, status: r.status };
  }
  return undefined;
}

// ---------- NetBIOS (nom des ordinateurs Windows, NAS, Samba) ----------

/** Requête « NBSTAT » (statut du nœud) : liste les noms d'une machine (pur, testable). */
export function nbstatQuery(id = 0x4f44): Buffer {
  const b = Buffer.alloc(50);
  b.writeUInt16BE(id, 0); b.writeUInt16BE(0x0000, 2); b.writeUInt16BE(1, 4); // une question
  b[12] = 0x20; // nom encodé (32 octets) : « * » suivi de zéros
  const name = Buffer.alloc(16); name[0] = 0x2a;
  for (let i = 0; i < 16; i++) { b[13 + i * 2] = 0x41 + (name[i] >> 4); b[14 + i * 2] = 0x41 + (name[i] & 0x0f); }
  b[45] = 0; b.writeUInt16BE(0x0021, 46); b.writeUInt16BE(0x0001, 48); // type NBSTAT, classe IN
  return b;
}

/** Nom principal d'une réponse NBSTAT : premier nom unique de type « station » (0x00) (pur, testable). */
export function parseNbstat(msg: Buffer): string | undefined {
  try {
    let off = 12;
    while (off < msg.length && msg[off] !== 0) off += msg[off] + 1; // nom de la question/réponse
    off += 1 + 2 + 2 + 4 + 2; // fin du nom, type, classe, TTL, longueur
    const count = msg[off]; off += 1;
    for (let i = 0; i < count && off + 18 <= msg.length; i++, off += 18) {
      const name = msg.subarray(off, off + 15).toString('latin1').trim();
      const suffix = msg[off + 15], group = (msg[off + 16] & 0x80) !== 0;
      if (suffix === 0x00 && !group && name) return name;
    }
  } catch { /* réponse tronquée */ }
  return undefined;
}

export function netbiosName(ip: string, timeoutMs = 1200): Promise<string | undefined> {
  return new Promise((resolve) => {
    const sock = createSocket('udp4');
    const done = (n?: string) => { try { sock.close(); } catch { /* déjà fermé */ } resolve(n); };
    const t = setTimeout(() => done(), timeoutMs);
    sock.on('error', () => { clearTimeout(t); done(); });
    sock.on('message', (msg) => { clearTimeout(t); done(parseNbstat(msg)); });
    sock.send(nbstatQuery(), 137, ip, (e) => { if (e) { clearTimeout(t); done(); } });
  });
}

// ---------- UPnP : description de l'appareil (box, TV, enceintes, NAS) ----------

export interface UpnpInfo { friendlyName?: string; manufacturer?: string; modelName?: string; presentationURL?: string }

/** Champs utiles d'une description UPnP (pur, testable). */
export function parseUpnp(xml: string): UpnpInfo {
  const tag = (t: string) => { const m = xml.match(new RegExp(`<${t}>([^<]{1,200})</${t}>`, 'i')); return m ? clean(m[1]) : undefined; };
  return { friendlyName: tag('friendlyName'), manufacturer: tag('manufacturer'), modelName: tag('modelName'), presentationURL: tag('presentationURL') };
}

export async function upnpDescribe(location: string, ip: string): Promise<UpnpInfo | undefined> {
  try {
    const u = new URL(location);
    if (u.hostname !== ip) return undefined; // on ne suit que l'appareil lui-même
    const r = await get(location, 2500);
    return r?.status === 200 ? parseUpnp(r.body) : undefined;
  } catch { return undefined; }
}

/** Nom lisible tiré d'un titre de page (« pve - Proxmox Virtual Environment » → pve). Pur, testable. */
export function nameFromTitle(title: string): string | undefined {
  const m = /^(.+?)\s+-\s+Proxmox (?:Virtual Environment|Backup Server)/i.exec(title) ?? /^(.+?)\s+[-|–]\s+(?:Synology|DSM|TrueNAS|OpenMediaVault|Home Assistant|Unraid)/i.exec(title);
  return m?.[1]?.trim() || undefined;
}
