// Ouvrir un port sur la box, par Odin lui-même (UPnP IGD, la norme que les box parlent : Livebox, Freebox,
// SFR, Bbox, routeurs…). Écrit pour Odin (norme publique de l'UPnP Forum), sans bibliothèque.
//   1. on cherche la box sur le réseau (SSDP : un message multicast UDP 239.255.255.250:1900) ;
//   2. on lit sa description (XML) pour trouver le service « WANIPConnection » (ou WANPPPConnection) ;
//   3. on lui demande d'ouvrir / fermer un port (SOAP : AddPortMapping, DeletePortMapping), son adresse
//      Internet (GetExternalIPAddress) et la liste des ports ouverts (GetGenericPortMappingEntry).
// Rien n'est ouvert sans qu'on le demande ; chaque ouverture porte la mention « Odin » pour être reconnue.
import dgram from 'node:dgram';

export interface Gateway { location: string; control: string; service: string; host: string; localIp: string; name?: string }
export interface Mapping { external: number; internal: number; proto: 'TCP' | 'UDP'; client: string; desc: string; enabled: boolean; lease: number }
type Fetch = typeof globalThis.fetch;

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml)?.[1]?.trim();
const SERVICES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];

/** Le service d'ouverture de ports dans la description d'une box. Pur. */
export function parseDescription(xml: string, location: string): { control: string; service: string; name?: string } | undefined {
  const base = tag(xml, 'URLBase') || location;
  for (const want of SERVICES) {
    for (const m of xml.matchAll(/<(?:\w+:)?service>([\s\S]*?)<\/(?:\w+:)?service>/g)) {
      if (tag(m[1], 'serviceType') !== want) continue;
      const c = tag(m[1], 'controlURL'); if (!c) continue;
      return { control: new URL(c, base).toString(), service: want, name: tag(xml, 'friendlyName') ?? tag(xml, 'modelName') };
    }
  }
  return undefined;
}

let testTarget: { host: string; port: number; timeoutMs: number } | undefined;
/** Pour les essais : la « box » à interroger (un faux routeur). */
export function setDiscoveryTarget(t: typeof testTarget): void { testTarget = t; }
/** Cherche la box (SSDP) et son service d'ouverture de ports. */
export async function discover(o: { fetch?: Fetch; timeoutMs?: number; target?: { host: string; port: number } } = {}): Promise<Gateway> {
  o = { ...o, target: o.target ?? testTarget, timeoutMs: o.timeoutMs ?? testTarget?.timeoutMs };
  const f = o.fetch ?? fetch, sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }), found: string[] = [];
  await new Promise<void>((ok, ko) => { sock.once('error', ko); sock.bind(0, () => ok()); });
  sock.on('message', (m) => { const loc = /^location:\s*(\S+)/im.exec(m.toString())?.[1]; if (loc && !found.includes(loc)) found.push(loc); });
  const t = o.target ?? { host: '239.255.255.250', port: 1900 };
  for (const st of ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2', ...SERVICES]) {
    sock.send(Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`), t.port, t.host);
  }
  await new Promise((r) => setTimeout(r, o.timeoutMs ?? 2500)); sock.close();
  if (!found.length) throw new Error('aucune box ne répond en UPnP (l\'UPnP est peut-être désactivé dans les réglages de la box)');
  for (const loc of found) {
    try {
      const u = new URL(loc); if (!/^https?:$/.test(u.protocol)) continue;
      const d = parseDescription(await (await f(loc, { signal: AbortSignal.timeout(5000) })).text(), loc); if (!d) continue;
      return { location: loc, ...d, host: u.hostname, localIp: await localIpToward(u.hostname, Number(u.port) || 80) };
    } catch { /* box suivante */ }
  }
  throw new Error('la box répond mais ne propose pas l\'ouverture de ports (service WANIPConnection absent)');
}
/** L'adresse d'Odin sur le réseau de la box (celle que la box doit viser). */
export async function localIpToward(host: string, port: number): Promise<string> {
  const s = dgram.createSocket('udp4');
  try { await new Promise<void>((ok, ko) => s.connect(port, host, (e?: Error) => (e ? ko(e) : ok()))); return s.address().address; } finally { s.close(); }
}

/** Un appel SOAP à la box. Les erreurs de la box (code UPnP) sont rendues lisibles. */
export async function soap(g: Pick<Gateway, 'control' | 'service'>, action: string, args: Record<string, string | number>, f: Fetch = fetch): Promise<string> {
  const body = `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${g.service}">${Object.entries(args).map(([k, v]) => `<${k}>${xmlEsc(String(v))}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  const r = await f(g.control, { method: 'POST', headers: { 'content-type': 'text/xml; charset="utf-8"', soapaction: `"${g.service}#${action}"` }, body, signal: AbortSignal.timeout(8000) });
  const x = await r.text();
  if (!r.ok) {
    const code = Number(tag(x, 'errorCode') ?? 0), why = tag(x, 'errorDescription') ?? '';
    const human: Record<number, string> = { 402: 'paramètres refusés', 501: 'la box a refusé', 606: 'action non autorisée par la box', 714: 'aucune ouverture de ce port', 718: 'ce port est déjà ouvert vers une autre machine', 724: 'la box exige le même numéro de port dehors et dedans', 725: 'la box n\'accepte que les ouvertures permanentes', 726: 'la box exige une adresse vide', 727: 'la box exige un port extérieur précis', 728: 'table des ports de la box pleine' };
    const e = new Error(`box : ${human[code] ?? why ?? `erreur ${r.status}`}${code ? ` (code ${code})` : ''}`) as Error & { code?: number }; e.code = code; throw e;
  }
  return x;
}

export async function externalIp(g: Gateway, f?: Fetch): Promise<string> { return tag(await soap(g, 'GetExternalIPAddress', {}, f), 'NewExternalIPAddress') ?? ''; }
/** Ouvre un port vers Odin. Essaie une ouverture permanente, sinon d'une journée (Odin la renouvelle). */
export async function addMapping(g: Gateway, m: { external: number; internal?: number; proto: 'TCP' | 'UDP'; desc: string; client?: string }, f?: Fetch): Promise<{ lease: number }> {
  const args = (lease: number) => ({ NewRemoteHost: '', NewExternalPort: m.external, NewProtocol: m.proto, NewInternalPort: m.internal ?? m.external, NewInternalClient: m.client ?? g.localIp, NewEnabled: 1, NewPortMappingDescription: m.desc, NewLeaseDuration: lease });
  try { await soap(g, 'AddPortMapping', args(0), f); return { lease: 0 }; }
  catch (e) { if ((e as { code?: number }).code === 725) throw e; await soap(g, 'AddPortMapping', args(86400), f); return { lease: 86400 }; }
}
export async function deleteMapping(g: Gateway, external: number, proto: 'TCP' | 'UDP', f?: Fetch): Promise<void> { await soap(g, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: external, NewProtocol: proto }, f); }
/** Les ports ouverts sur la box (toutes machines). */
export async function listMappings(g: Gateway, f?: Fetch, max = 64): Promise<Mapping[]> {
  const out: Mapping[] = [];
  for (let i = 0; i < max; i++) {
    let x: string; try { x = await soap(g, 'GetGenericPortMappingEntry', { NewPortMappingIndex: i }, f); } catch { break; }
    out.push({ external: Number(tag(x, 'NewExternalPort')), internal: Number(tag(x, 'NewInternalPort')), proto: tag(x, 'NewProtocol') === 'UDP' ? 'UDP' : 'TCP', client: tag(x, 'NewInternalClient') ?? '', desc: tag(x, 'NewPortMappingDescription') ?? '', enabled: tag(x, 'NewEnabled') !== '0', lease: Number(tag(x, 'NewLeaseDuration') ?? 0) });
  }
  return out;
}
/** Adresse Internet privée ou partagée (CGNAT 100.64/10, double box) : ouvrir un port ne servira à rien. Pur. */
export function behindCgnat(ip: string): boolean {
  const p = ip.split('.').map(Number); if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return false;
  return p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] < 32) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] < 128);
}

/** Ouvre ces ports de la box vers Odin et dit ce qu'il en est (adresse Internet, CGNAT). */
export async function openPorts(ports: Array<{ port: number; proto: 'TCP' | 'UDP' }>, desc: string, f?: Fetch): Promise<{ gw: Gateway; ip: string; cgnat: boolean; lease: number; text: string }> {
  const gw = await discover({ fetch: f }); let lease = 0;
  for (const p of ports) lease = Math.max(lease, (await addMapping(gw, { external: p.port, proto: p.proto, desc }, f)).lease);
  const ip = await externalIp(gw, f).catch(() => ''), cgnat = behindCgnat(ip);
  const list = ports.map((p) => `${p.port}/${p.proto}`).join(', ');
  return { gw, ip, cgnat, lease, text: `🔓 Box${gw.name ? ` « ${gw.name} »` : ''} : ${list} ouvert${ports.length > 1 ? 's' : ''} vers Odin (${gw.localIp})${lease ? ', renouvelé chaque jour par Odin' : ''}.${cgnat ? ` ⚠ Mais ta box n'a pas d'adresse Internet à elle (${ip} : adresse partagée par l'opérateur, cas de Starlink, de la 4G/5G ou d'une double box) : depuis Internet, ce port ne sera pas joignable. Pour le web (Odin, tes sites), le tunnel Cloudflare (Brú) marche quand même ; pour le VPN il faut une adresse publique (option chez l'opérateur) ou mettre la box en mode « bridge ».` : ip ? ` Adresse Internet de la box : ${ip}.` : ''}` };
}
export async function closePorts(ports: Array<{ port: number; proto: 'TCP' | 'UDP' }>, f?: Fetch): Promise<string> {
  const gw = await discover({ fetch: f }); const done: string[] = [];
  for (const p of ports) { try { await deleteMapping(gw, p.port, p.proto, f); done.push(`${p.port}/${p.proto}`); } catch (e) { if ((e as { code?: number }).code !== 714) throw e; } }
  return done.length ? `🔒 Box : ${done.join(', ')} refermé${done.length > 1 ? 's' : ''}.` : 'Rien à refermer : ces ports n\'étaient pas ouverts.';
}
