// Ariane : le décodeur de paquets, couche par couche (modèle OSI), comme Wireshark.
// Entrée : le flux « pcap » que tcpdump écrit (-w -). Sortie : pour chaque paquet, ses couches (liaison, réseau,
// transport, session/présentation, application) avec tous leurs champs, l'appli reconnue, le site (nom DNS,
// nom TLS « SNI », hôte HTTP), un résumé, une explication en français et le contenu brut (hexadécimal).
// Le contenu d'une connexion chiffrée (HTTPS, SSH, QUIC…) ne se lit pas : seuls ses en-têtes et le nom du site
// demandé (quand il est en clair) le sont, comme dans Wireshark sans les clés.

export interface Field { k: string; v: string }
export interface Layer { osi: number; name: string; title: string; fields: Field[] }
export interface Decoded {
  at: number; len: number; caplen: number;
  src: string; dst: string; sport?: number; dport?: number;
  /** protocole le plus haut reconnu (DNS, HTTP, TLS, TCP, UDP, ARP…) */
  proto: string;
  /** appli ou service (HTTPS, DNS, SSH, Jellyfin…) */
  app: string;
  /** site ou nom concerné (youtube.com, nas.local…) quand il est connu */
  site: string;
  info: string;
  /** sens vu par la capture : reçu par la machine capturée, envoyé, diffusé */
  way: 'reçu' | 'envoyé' | 'diffusé' | '';
  layers: Layer[];
  /** noms appris dans ce paquet (réponses DNS, SNI, hôte HTTP) : adresse → nom */
  names: Array<[string, string]>;
  raw: Uint8Array;
  /** ce qui se passe, en clair */
  story?: string;
}

const PORTS: Record<number, string> = { 20: 'FTP-données', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 69: 'TFTP', 80: 'HTTP', 88: 'Kerberos', 110: 'POP3', 123: 'NTP', 137: 'NetBIOS', 138: 'NetBIOS', 139: 'SMB', 143: 'IMAP', 161: 'SNMP', 162: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 500: 'IPsec', 514: 'Syslog', 548: 'AFP', 554: 'RTSP', 587: 'SMTP', 631: 'Imprimante (IPP)', 636: 'LDAPS', 853: 'DNS chiffré', 873: 'rsync', 993: 'IMAPS', 995: 'POP3S', 1194: 'OpenVPN', 1433: 'SQL Server', 1883: 'MQTT', 1900: 'SSDP (UPnP)', 2049: 'NFS', 3000: 'HTTP', 3306: 'MySQL', 3389: 'Bureau à distance', 3478: 'STUN', 5000: 'HTTP', 5060: 'SIP', 5222: 'XMPP', 5353: 'mDNS', 5355: 'LLMNR', 5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 6881: 'BitTorrent', 7777: 'Odin', 8000: 'HTTP', 8006: 'Proxmox', 8080: 'HTTP', 8096: 'Jellyfin / Venus', 8123: 'Home Assistant', 8443: 'HTTPS', 8883: 'MQTT chiffré', 9000: 'HTTP', 9090: 'HTTP', 9100: 'Imprimante', 10000: 'Webmin', 27017: 'MongoDB', 32400: 'Plex', 51820: 'WireGuard' };
export const portName = (p?: number) => (p != null ? PORTS[p] : undefined);
const ETHER: Record<number, string> = { 0x0800: 'IPv4', 0x86dd: 'IPv6', 0x0806: 'ARP', 0x8100: 'VLAN', 0x88cc: 'LLDP', 0x888e: 'EAPOL (Wi-Fi)', 0x8863: 'PPPoE', 0x8864: 'PPPoE' };
const IPPROTO: Record<number, string> = { 1: 'ICMP', 2: 'IGMP', 6: 'TCP', 17: 'UDP', 41: 'IPv6 dans IPv4', 47: 'GRE', 50: 'ESP (IPsec)', 58: 'ICMPv6', 89: 'OSPF', 112: 'VRRP', 132: 'SCTP' };
const ICMP4: Record<number, string> = { 0: 'ping (réponse)', 3: 'destination injoignable', 5: 'redirection', 8: 'ping (demande)', 11: 'durée de vie dépassée (traceroute)', 13: 'heure (demande)', 14: 'heure (réponse)' };
const UNREACH: Record<number, string> = { 0: 'réseau injoignable', 1: 'machine injoignable', 2: 'protocole injoignable', 3: 'port fermé', 4: 'fragmentation nécessaire', 13: 'interdit par un filtre' };
const ICMP6: Record<number, string> = { 1: 'destination injoignable', 2: 'paquet trop gros', 3: 'durée de vie dépassée', 128: 'ping (demande)', 129: 'ping (réponse)', 133: 'recherche de routeur', 134: 'annonce de routeur', 135: 'recherche de voisin', 136: 'annonce de voisin', 143: 'abonnement multicast (MLD)' };
const DNSTYPE: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 47: 'NSEC', 65: 'HTTPS', 255: 'ANY' };
const RCODE: Record<number, string> = { 0: 'réussie', 1: 'requête mal formée', 2: 'serveur en panne', 3: 'ce nom n\'existe pas', 4: 'non pris en charge', 5: 'refusée' };
const DHCPMSG: Record<number, string> = { 1: 'DISCOVER (cherche un serveur)', 2: 'OFFER (propose une adresse)', 3: 'REQUEST (demande l\'adresse)', 4: 'DECLINE', 5: 'ACK (adresse accordée)', 6: 'NAK (refusée)', 7: 'RELEASE (rend l\'adresse)', 8: 'INFORM' };
const TLSVER: Record<number, string> = { 0x0300: 'SSL 3.0', 0x0301: 'TLS 1.0', 0x0302: 'TLS 1.1', 0x0303: 'TLS 1.2', 0x0304: 'TLS 1.3' };
const TLSHS: Record<number, string> = { 1: 'ClientHello (début de connexion)', 2: 'ServerHello', 4: 'NewSessionTicket', 8: 'EncryptedExtensions', 11: 'Certificate', 12: 'ServerKeyExchange', 14: 'ServerHelloDone', 16: 'ClientKeyExchange', 20: 'Finished' };

const mac = (b: Uint8Array, o: number) => Array.from(b.subarray(o, o + 6), (x) => x.toString(16).padStart(2, '0')).join(':');
const ip4 = (b: Uint8Array, o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
function ip6(b: Uint8Array, o: number): string {
  const g: string[] = []; for (let i = 0; i < 16; i += 2) g.push(((b[o + i] << 8) | b[o + i + 1]).toString(16));
  // forme courte : la plus longue suite de zéros devient « :: »
  let best = -1, bl = 0; for (let i = 0; i < 8;) { if (g[i] === '0') { let j = i; while (j < 8 && g[j] === '0') j++; if (j - i > bl && j - i > 1) { best = i; bl = j - i; } i = j; } else i++; }
  return best < 0 ? g.join(':') : `${g.slice(0, best).join(':')}::${g.slice(best + bl).join(':')}`;
}
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const f = (k: string, v: unknown): Field => ({ k, v: String(v) });
const ascii = (b: Uint8Array) => Array.from(b, (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : c === 10 ? '\n' : c === 13 ? '' : c === 9 ? '\t' : '·')).join('');
const printable = (b: Uint8Array) => { if (!b.length) return false; let n = 0; for (const c of b.subarray(0, 400)) if ((c >= 32 && c < 127) || c === 10 || c === 13 || c === 9) n++; return n / Math.min(400, b.length) > 0.85; };
export const isPrivate = (a: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.|fe80:|fc|fd|::1$|::$)/i.test(a);
export const isBroadcast = (a: string) => /^(224\.|239\.|255\.255\.255\.255|ff0)/i.test(a) || /\.255$/.test(a);
const size = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} Mo` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace('.', ',')} ko` : `${n} octets`);

// ---------- Applications ----------
function dnsName(b: Uint8Array, o: number, depth = 0): { name: string; end: number } {
  const parts: string[] = []; let end = -1, p = o, guard = 0;
  while (p < b.length && guard++ < 128) {
    const l = b[p];
    if (l === 0) { p++; break; }
    if ((l & 0xc0) === 0xc0) { if (end < 0) end = p + 2; if (depth > 8) break; p = ((l & 0x3f) << 8) | b[p + 1]; depth++; continue; }
    parts.push(ascii(b.subarray(p + 1, p + 1 + l))); p += l + 1;
  }
  return { name: parts.join('.') || '<racine>', end: end < 0 ? p : end };
}
function dns(b: Uint8Array, tcp: boolean, d: Decoded, label: string): Layer | undefined {
  if (tcp) b = b.subarray(2);
  if (b.length < 12) return undefined;
  const id = u16(b, 0), fl = u16(b, 2), qd = u16(b, 4), an = u16(b, 6), ns = u16(b, 8), ar = u16(b, 10);
  if (qd > 50 || an > 200) return undefined;
  const isResp = Boolean(fl & 0x8000), rcode = fl & 0xf;
  const fields = [f('Identifiant', `0x${id.toString(16)}`), f('Type', isResp ? 'réponse' : 'question'), f('Résultat', isResp ? RCODE[rcode] ?? rcode : '—'), f('Questions / réponses', `${qd} / ${an} (+${ns + ar} autres)`)];
  let p = 12; const qs: string[] = [], ans: string[] = [];
  for (let i = 0; i < qd && p < b.length; i++) { const n = dnsName(b, p); p = n.end; const t = u16(b, p); p += 4; qs.push(`${n.name} (${DNSTYPE[t] ?? t})`); fields.push(f(`Question ${i + 1}`, `${n.name} — type ${DNSTYPE[t] ?? t}`)); }
  for (let i = 0; i < an && p + 10 <= b.length; i++) {
    const n = dnsName(b, p); p = n.end; const t = u16(b, p), ttl = u32(b, p + 4), rl = u16(b, p + 8); p += 10;
    let v = ''; if (t === 1 && rl === 4) v = ip4(b, p); else if (t === 28 && rl === 16) v = ip6(b, p); else if (t === 5 || t === 12 || t === 2) v = dnsName(b, p).name; else v = `${rl} octets`;
    if ((t === 1 || t === 28) && v) d.names.push([v, n.name.replace(/\.$/, '')]);
    ans.push(`${DNSTYPE[t] ?? t} ${v}`); fields.push(f(`Réponse ${i + 1}`, `${n.name} → ${DNSTYPE[t] ?? t} ${v} (gardée ${ttl} s)`)); p += rl;
  }
  const q0 = qs[0]?.replace(/ \(.*$/, '') ?? '';
  d.site ||= q0.replace(/\.local$|\.$/, (x) => (x === '.' ? '' : x)); d.proto = label; d.app = label;
  d.info = isResp ? `Réponse ${label} : ${q0}${ans.length ? ' → ' + ans.slice(0, 3).join(', ') : rcode ? ` (${RCODE[rcode] ?? rcode})` : ''}` : `Question ${label} : quelle adresse pour ${q0} ?`;
  return { osi: 7, name: label, title: `${label} (annuaire des noms) : ${isResp ? 'réponse' : 'question'}`, fields };
}
function http(b: Uint8Array, d: Decoded): Layer | undefined {
  const head = ascii(b.subarray(0, 2048)); const m = /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT|PROPFIND|MKCOL|SUBSCRIBE|NOTIFY|M-SEARCH) (\S+) (HTTP\/[\d.]+)|^(HTTP\/[\d.]+) (\d{3}) ?(.*)$/m.exec(head.split('\n')[0] ?? '');
  if (!m || head.indexOf(m[0]) !== 0) return undefined;
  const lines = head.split('\n'), fields: Field[] = [f('Ligne', lines[0])];
  const hdr: Record<string, string> = {};
  for (const l of lines.slice(1, 40)) { if (!l.trim()) break; const i = l.indexOf(':'); if (i > 0) { const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim(); hdr[k.toLowerCase()] = v; fields.push(f(k, v)); } }
  const bodyAt = head.indexOf('\n\n'); const body = bodyAt > 0 ? head.slice(bodyAt + 2, bodyAt + 2 + 600).trim() : '';
  if (body) fields.push(f('Contenu (début)', body));
  const host = hdr.host?.replace(/:\d+$/, '') ?? '';
  // Le nom n'est attaché à l'adresse que pour un serveur d'Internet joint directement (pas un proxy : CONNECT, réseau local)
  if (host) { d.site = host; if (!isIP4or6(host) && m[1] !== 'CONNECT' && !isPrivate(d.dst)) d.names.push([d.dst, host]); }
  d.proto = m[1] === 'NOTIFY' || m[1] === 'M-SEARCH' ? 'SSDP' : 'HTTP'; d.app ||= d.proto;
  d.info = m[1] ? `${m[1]} ${host}${m[2]}` : `Réponse ${m[5]} ${m[6]}${hdr['content-type'] ? ` · ${hdr['content-type'].split(';')[0]}` : ''}${hdr['content-length'] ? ` · ${size(Number(hdr['content-length']))}` : ''}`;
  return { osi: 7, name: d.proto, title: `${d.proto} (web, en clair) : ${m[1] ? 'requête' : 'réponse'}`, fields };
}
const isIP4or6 = (s: string) => /^\d+\.\d+\.\d+\.\d+$|:/.test(s);
function tls(b: Uint8Array, d: Decoded): Layer | undefined {
  const ct = b[0]; if (![20, 21, 22, 23].includes(ct) || b.length < 5 || b[1] !== 3) return undefined;
  const ver = u16(b, 1), rlen = u16(b, 3);
  const fields = [f('Type d\'enregistrement', { 20: 'changement de chiffrement', 21: 'alerte', 22: 'poignée de main (handshake)', 23: 'données chiffrées' }[ct]), f('Version annoncée', TLSVER[ver] ?? `0x${ver.toString(16)}`), f('Longueur', size(rlen))];
  let title = 'TLS (connexion chiffrée)';
  d.proto = 'TLS'; d.info = ct === 23 ? `Données chiffrées (${size(rlen)})` : ct === 21 ? 'Alerte TLS' : 'TLS';
  if (ct === 22 && b.length > 9) {
    const hs = b[5]; fields.push(f('Message', TLSHS[hs] ?? hs));
    d.info = `TLS ${TLSHS[hs]?.split(' ')[0] ?? 'poignée de main'}`;
    if (hs === 1 || hs === 2) {
      let p = 9; const v2 = u16(b, p); p += 2 + 32; fields.push(f('Version proposée', TLSVER[v2] ?? v2));
      const sid = b[p]; p += 1 + sid;
      if (hs === 1) { const cs = u16(b, p); fields.push(f('Suites de chiffrement proposées', cs / 2)); p += 2 + cs; const cm = b[p]; p += 1 + cm; }
      else { fields.push(f('Suite de chiffrement choisie', `0x${u16(b, p).toString(16)}`)); p += 3; }
      if (p + 2 <= b.length) {
        const end = Math.min(b.length, p + 2 + u16(b, p)); p += 2;
        while (p + 4 <= end) {
          const t = u16(b, p), l = u16(b, p + 2), x = p + 4;
          if (t === 0 && hs === 1 && x + 5 <= b.length) { const n = ascii(b.subarray(x + 5, x + 5 + u16(b, x + 3))); d.site = n; if (!isPrivate(d.dst)) d.names.push([d.dst, n]); fields.push(f('Site demandé (SNI)', n)); }
          if (t === 16 && x + 2 <= b.length) { const alpn: string[] = []; let q = x + 2; while (q < x + l && q < b.length) { const n = b[q]; alpn.push(ascii(b.subarray(q + 1, q + 1 + n))); q += 1 + n; } fields.push(f('Protocoles proposés (ALPN)', alpn.join(', '))); }
          if (t === 43 && hs === 2 && x + 2 <= b.length) fields.push(f('Version choisie', TLSVER[u16(b, x)] ?? u16(b, x)));
          p = x + l;
        }
      }
      if (hs === 1) d.info = `Début de connexion chiffrée${d.site ? ` vers ${d.site}` : ''}`;
      title = `TLS : ${TLSHS[hs]}`;
    }
  }
  return { osi: 6, name: 'TLS', title, fields };
}
function dhcp(b: Uint8Array, d: Decoded): Layer | undefined {
  if (b.length < 240 || u32(b, 236) !== 0x63825363) return undefined;
  const fields = [f('Opération', b[0] === 1 ? 'demande' : 'réponse'), f('Machine (MAC)', mac(b, 28)), f('Adresse actuelle', ip4(b, 12)), f('Adresse proposée', ip4(b, 16)), f('Serveur', ip4(b, 20))];
  let p = 240, type = 0, name = '';
  while (p < b.length && b[p] !== 255) {
    const t = b[p]; if (t === 0) { p++; continue; } const l = b[p + 1], v = b.subarray(p + 2, p + 2 + l);
    if (t === 53) type = v[0]; if (t === 12) { name = ascii(v); fields.push(f('Nom de la machine', name)); } if (t === 50 && l === 4) fields.push(f('Adresse demandée', ip4(v, 0))); if (t === 60) fields.push(f('Type d\'appareil', ascii(v))); if (t === 6) fields.push(f('Serveurs DNS donnés', Array.from({ length: l / 4 }, (_, i) => ip4(v, i * 4)).join(', '))); if (t === 3 && l >= 4) fields.push(f('Routeur donné', ip4(v, 0))); if (t === 51 && l === 4) fields.push(f('Durée du bail', `${Math.round(u32(v, 0) / 3600)} h`));
    p += 2 + l;
  }
  fields.unshift(f('Message', DHCPMSG[type] ?? type));
  d.proto = 'DHCP'; d.app = 'DHCP'; if (name) d.site = name; d.info = `DHCP ${(DHCPMSG[type] ?? '').split(' ')[0]}${name ? ` · ${name}` : ''}`;
  return { osi: 7, name: 'DHCP', title: `DHCP (distribution des adresses) : ${DHCPMSG[type] ?? type}`, fields };
}
function textApp(b: Uint8Array, d: Decoded, name: string, title: string): Layer {
  const t = ascii(b.subarray(0, 900)).trim(); d.proto = name; d.app ||= name; d.info = `${name} : ${t.split('\n')[0].slice(0, 90)}`;
  return { osi: 7, name, title, fields: t.split('\n').filter(Boolean).slice(0, 25).map((l, i) => { const k = l.indexOf(':'); return k > 0 && k < 40 ? f(l.slice(0, k), l.slice(k + 1).trim()) : f(`Ligne ${i + 1}`, l); }) };
}
function application(payload: Uint8Array, d: Decoded, tcp: boolean): Layer[] {
  const out: Layer[] = []; if (!payload.length) return out;
  const ports = [d.sport, d.dport];
  const has = (...p: number[]) => ports.some((x) => x != null && p.includes(x));
  let l: Layer | undefined;
  if (has(53, 5353, 5355)) l = dns(payload, tcp, d, has(5353) ? 'mDNS' : has(5355) ? 'LLMNR' : 'DNS');
  else if (has(67, 68)) l = dhcp(payload, d);
  else if (has(1900)) l = textApp(payload, d, 'SSDP', 'SSDP (découverte UPnP des appareils)');
  else if (has(123) && payload.length >= 48) { const v = (payload[0] >> 3) & 7, mode = payload[0] & 7; d.proto = 'NTP'; d.app = 'NTP'; d.info = `Heure (NTP v${v}, ${mode === 3 ? 'demande' : mode === 4 ? 'réponse' : `mode ${mode}`})`; l = { osi: 7, name: 'NTP', title: 'NTP (mise à l\'heure)', fields: [f('Version', v), f('Mode', mode === 3 ? 'client' : mode === 4 ? 'serveur' : mode), f('Strate', payload[1])] }; }
  else if (tcp) {
    l = tls(payload, d) ?? http(payload, d);
    if (!l && /^SSH-[\d.]+-/.test(ascii(payload.subarray(0, 60)))) { const v = ascii(payload.subarray(0, 120)).split('\n')[0]; d.proto = 'SSH'; d.app = 'SSH'; d.info = `SSH : ${v}`; l = { osi: 7, name: 'SSH', title: 'SSH (accès à distance, chiffré)', fields: [f('Logiciel annoncé', v)] }; }
    if (!l && /^(220|EHLO|HELO|MAIL FROM|RCPT TO|\+OK|\* OK|USER |PASS )/i.test(ascii(payload.subarray(0, 20)))) l = textApp(payload, d, d.app || 'Texte', `${d.app || 'Protocole texte'} (en clair)`);
  } else if (has(443) && payload.length > 20 && (payload[0] & 0x80)) { d.proto = 'QUIC'; d.app = 'HTTPS (HTTP/3)'; d.info = `QUIC chiffré (${size(payload.length)})`; l = { osi: 6, name: 'QUIC', title: 'QUIC (HTTP/3, chiffré)', fields: [f('Forme', 'en-tête long (début de connexion)'), f('Version', `0x${u32(payload, 1).toString(16)}`)] }; }
  else if (has(51820)) { d.proto = 'WireGuard'; d.app = 'WireGuard'; d.info = `VPN WireGuard (${['', 'début', 'réponse', 'cookie', 'données'][payload[0]] ?? 'données'})`; l = { osi: 6, name: 'WireGuard', title: 'WireGuard (VPN chiffré)', fields: [f('Message', payload[0])] }; }
  if (l) out.push(l);
  if (!l || l.name === 'TLS' || l.name === 'QUIC') {
    out.push({ osi: 7, name: 'Données', title: `Données (${size(payload.length)})${l ? ' — chiffrées, illisibles sans les clés' : printable(payload) ? ' — texte lisible' : ''}`, fields: [f('Taille', size(payload.length)), ...(!l && printable(payload) ? [f('Texte', ascii(payload.subarray(0, 700)))] : [])] });
    if (!l && printable(payload)) d.info ||= ascii(payload.subarray(0, 80)).split('\n')[0];
  }
  return out;
}

// ---------- Couches basses ----------
const TCPFLAGS = ['FIN', 'SYN', 'RST', 'PSH', 'ACK', 'URG', 'ECE', 'CWR'];
function transport(b: Uint8Array, o: number, end: number, proto: number, d: Decoded): void {
  if (proto === 6 && o + 20 <= end) {
    const off = (b[o + 12] >> 4) * 4, flags = b[o + 13], fl = TCPFLAGS.filter((_, i) => flags & (1 << i));
    d.sport = u16(b, o); d.dport = u16(b, o + 2);
    const pl = b.subarray(o + off, end);
    d.layers.push({ osi: 4, name: 'TCP', title: `TCP (transport fiable) : port ${d.sport} → ${d.dport}${fl.length ? ` [${fl.join(', ')}]` : ''}`, fields: [f('Port source', `${d.sport}${portName(d.sport) ? ` (${portName(d.sport)})` : ''}`), f('Port destination', `${d.dport}${portName(d.dport) ? ` (${portName(d.dport)})` : ''}`), f('Numéro de séquence', u32(b, o + 4)), f('Accusé de réception', u32(b, o + 8)), f('Drapeaux', fl.join(', ') || 'aucun'), f('Fenêtre', u16(b, o + 14)), f('Taille de l\'en-tête', `${off} octets`), f('Données transportées', size(pl.length))] });
    d.proto = 'TCP'; d.app = portName(d.dport) ?? portName(d.sport) ?? '';
    d.info = flags & 2 ? (flags & 16 ? 'Ouverture de connexion acceptée' : `Ouverture de connexion${d.app ? ` (${d.app})` : ''}`) : flags & 4 ? 'Connexion refusée / coupée' : flags & 1 ? 'Fin de connexion' : pl.length ? `${d.app || 'TCP'} : ${size(pl.length)} de données` : 'Accusé de réception';
    d.layers.push(...application(pl, d, true));
  } else if (proto === 17 && o + 8 <= end) {
    d.sport = u16(b, o); d.dport = u16(b, o + 2); const pl = b.subarray(o + 8, end);
    d.layers.push({ osi: 4, name: 'UDP', title: `UDP (transport rapide, sans garantie) : port ${d.sport} → ${d.dport}`, fields: [f('Port source', `${d.sport}${portName(d.sport) ? ` (${portName(d.sport)})` : ''}`), f('Port destination', `${d.dport}${portName(d.dport) ? ` (${portName(d.dport)})` : ''}`), f('Longueur', size(u16(b, o + 4)))] });
    d.proto = 'UDP'; d.app = portName(d.dport) ?? portName(d.sport) ?? ''; d.info = `${d.app || 'UDP'} : ${size(pl.length)}`;
    d.layers.push(...application(pl, d, false));
  } else if ((proto === 1 || proto === 58) && o + 4 <= end) {
    const t = b[o], c = b[o + 1], name = (proto === 1 ? ICMP4 : ICMP6)[t] ?? `type ${t}`;
    d.proto = proto === 1 ? 'ICMP' : 'ICMPv6'; d.app = d.proto; d.info = `${name}${t === 3 && proto === 1 ? ` : ${UNREACH[c] ?? c}` : ''}`;
    d.layers.push({ osi: 3, name: d.proto, title: `${d.proto} (messages de contrôle) : ${d.info}`, fields: [f('Type', `${t} — ${name}`), f('Code', `${c}${t === 3 && proto === 1 ? ` — ${UNREACH[c] ?? ''}` : ''}`), ...(t === 8 || t === 0 || t === 128 || t === 129 ? [f('Identifiant', u16(b, o + 4)), f('Numéro', u16(b, o + 6))] : [])] });
  } else { d.proto = IPPROTO[proto] ?? `IP ${proto}`; d.app = d.proto; d.info = d.proto; }
}
function network(b: Uint8Array, o: number, type: number, d: Decoded): void {
  if (type === 0x0800 && o + 20 <= b.length) {
    const ihl = (b[o] & 15) * 4, tot = u16(b, o + 2), proto = b[o + 9], fr = u16(b, o + 6);
    d.src = ip4(b, o + 12); d.dst = ip4(b, o + 16);
    d.layers.push({ osi: 3, name: 'IPv4', title: `IPv4 (adresses) : ${d.src} → ${d.dst}`, fields: [f('Source', `${d.src}${isPrivate(d.src) ? ' (réseau local)' : ' (Internet)'}`), f('Destination', `${d.dst}${isBroadcast(d.dst) ? ' (diffusion)' : isPrivate(d.dst) ? ' (réseau local)' : ' (Internet)'}`), f('Protocole', `${proto} (${IPPROTO[proto] ?? '?'})`), f('Durée de vie (TTL)', `${b[o + 8]} sauts`), f('Taille totale', size(tot)), f('Identifiant', u16(b, o + 4)), f('Fragmentation', fr & 0x4000 ? 'interdite' : fr & 0x3fff ? 'fragment' : 'non'), f('Qualité de service (DSCP)', b[o + 1] >> 2)] });
    if ((fr & 0x1fff) === 0) transport(b, o + ihl, Math.min(b.length, o + tot || b.length), proto, d); else { d.proto = 'IPv4'; d.info = 'Fragment IP'; }
  } else if (type === 0x86dd && o + 40 <= b.length) {
    let nh = b[o + 6], p = o + 40; d.src = ip6(b, o + 8); d.dst = ip6(b, o + 24);
    const plen = u16(b, o + 4);
    d.layers.push({ osi: 3, name: 'IPv6', title: `IPv6 (adresses) : ${d.src} → ${d.dst}`, fields: [f('Source', d.src), f('Destination', d.dst), f('En-tête suivant', `${nh} (${IPPROTO[nh] ?? '?'})`), f('Limite de sauts', b[o + 7]), f('Taille des données', size(plen))] });
    for (let i = 0; i < 6 && [0, 43, 60, 44].includes(nh) && p + 8 <= b.length; i++) { const next = b[p]; p += nh === 44 ? 8 : (b[p + 1] + 1) * 8; nh = next; }
    transport(b, p, Math.min(b.length, o + 40 + plen), nh, d);
  } else if (type === 0x0806 && o + 28 <= b.length) {
    const op = u16(b, o + 6); d.src = ip4(b, o + 14); d.dst = ip4(b, o + 24); d.proto = 'ARP'; d.app = 'ARP';
    d.info = op === 1 ? `Qui a ${d.dst} ? Répondez à ${d.src}` : `${d.src} est à l'adresse matérielle ${mac(b, o + 8)}`;
    d.layers.push({ osi: 2, name: 'ARP', title: `ARP (qui a cette adresse ?) : ${op === 1 ? 'question' : 'réponse'}`, fields: [f('Opération', op === 1 ? 'question' : 'réponse'), f('Expéditeur (MAC)', mac(b, o + 8)), f('Expéditeur (IP)', d.src), f('Cible (MAC)', mac(b, o + 18)), f('Cible (IP)', d.dst)] });
  } else { d.proto = ETHER[type] ?? `0x${type.toString(16)}`; d.app = d.proto; d.info = d.proto; d.src ||= '?'; d.dst ||= '?'; }
}

/** Décode une trame selon le type de lien du flux pcap (1 Ethernet, 113 Linux SLL, 276 Linux SLL2, 0/12/101 IP brut). */
export function decode(frame: Uint8Array, link: number, at: number, len: number, iface = ''): Decoded {
  const d: Decoded = { at, len, caplen: frame.length, src: '', dst: '', proto: '?', app: '', site: '', info: '', way: '', layers: [], names: [], raw: frame };
  d.layers.push({ osi: 1, name: 'Trame', title: `Trame : ${size(len)} sur le fil${frame.length < len ? ` (${size(frame.length)} capturés)` : ''}`, fields: [f('Heure', new Date(at).toISOString()), f('Taille sur le fil', size(len)), f('Taille capturée', size(frame.length)), ...(iface ? [f('Point de capture', iface)] : [])] });
  let type = 0, o = 0;
  if (link === 1 && frame.length >= 14) {
    type = u16(frame, 12); o = 14;
    const fields = [f('Destination (MAC)', mac(frame, 0)), f('Source (MAC)', mac(frame, 6)), f('Type', `0x${type.toString(16)} (${ETHER[type] ?? '?'})`)];
    if (type === 0x8100) { fields.push(f('VLAN', u16(frame, 14) & 0xfff)); type = u16(frame, 16); o = 18; }
    d.layers.push({ osi: 2, name: 'Ethernet', title: `Ethernet (câble / Wi-Fi) : ${mac(frame, 6)} → ${mac(frame, 0)}`, fields });
  } else if (link === 113 && frame.length >= 16) {
    const pt = u16(frame, 0); type = u16(frame, 14); o = 16;
    d.way = pt === 4 ? 'envoyé' : pt === 0 ? 'reçu' : pt === 1 || pt === 2 ? 'diffusé' : '';
    d.layers.push({ osi: 2, name: 'Linux', title: `Liaison (capture Linux) : ${d.way || 'trafic vu'}`, fields: [f('Sens', d.way || 'autre machine'), f('Adresse matérielle', mac(frame, 6)), f('Type', ETHER[type] ?? type)] });
  } else if (link === 276 && frame.length >= 20) {
    type = u16(frame, 0); const pt = frame[10]; o = 20;
    d.way = pt === 4 ? 'envoyé' : pt === 0 ? 'reçu' : pt === 1 || pt === 2 ? 'diffusé' : '';
    d.layers.push({ osi: 2, name: 'Linux', title: `Liaison (capture Linux) : ${d.way || 'trafic vu'}`, fields: [f('Sens', d.way || 'autre machine'), f('Interface n°', u32(frame, 4)), f('Adresse matérielle', mac(frame, 12)), f('Type', ETHER[type] ?? type)] });
  } else if (link === 0 && frame.length >= 4) { const fam = frame[0] || frame[3]; type = fam === 2 ? 0x0800 : 0x86dd; o = 4; }
  else if (link === 12 || link === 101 || link === 228 || link === 229) { type = (frame[0] >> 4) === 6 ? 0x86dd : 0x0800; o = 0; }
  if (type) network(frame, o, type, d);
  if (!d.app) d.app = d.proto;
  d.story = story(d);
  return d;
}

/** Ce qui se passe, en une ou deux phrases simples (la bulle d'Odin et la fiche du paquet). */
export function story(d: Decoded): string {
  const where = (a: string) => (isBroadcast(a) ? 'tout le réseau' : isPrivate(a) ? a : `${a} (Internet)`);
  const site = d.site ? ` « ${d.site} »` : '';
  switch (d.proto) {
    case 'DNS': case 'mDNS': case 'LLMNR': return d.info.startsWith('Question') ? `${d.src} demande à ${where(d.dst)} l'adresse du site${site} : c'est l'annuaire d'Internet (DNS), première étape avant toute connexion.` : `${d.src} répond à ${d.dst} : ${d.info.replace(/^Réponse \S+ : /, '')}.`;
    case 'TLS': return d.info.startsWith('Début') ? `${d.src} ouvre une connexion chiffrée (HTTPS) vers${site || ` ${where(d.dst)}`}. Le nom du site se lit encore ; la suite sera chiffrée, donc illisible.` : `${d.src} et ${d.dst} échangent des données chiffrées${site} : on voit la taille, pas le contenu.`;
    case 'QUIC': return `${d.src} échange avec ${where(d.dst)} en QUIC (HTTP/3, utilisé par Google, YouTube…) : chiffré, contenu illisible.`;
    case 'HTTP': return `${d.src} parle en HTTP (non chiffré) avec ${where(d.dst)}${site} : tout se lit en clair, y compris les mots de passe éventuels. ${d.info}.`;
    case 'SSDP': return `${d.src} annonce ou cherche des appareils sur le réseau (UPnP : télé, box, imprimantes…).`;
    case 'DHCP': return `Distribution des adresses : ${d.info}. C'est ainsi qu'un appareil obtient son adresse en arrivant sur le réseau.`;
    case 'ARP': return `${d.info}. ARP relie une adresse IP à une carte réseau : c'est normal et très fréquent.`;
    case 'ICMP': case 'ICMPv6': return `${d.src} → ${where(d.dst)} : ${d.info} (message de contrôle du réseau).`;
    case 'SSH': return `Connexion d'administration à distance (SSH) entre ${d.src} et ${d.dst}, chiffrée.`;
    case 'NTP': return `${d.src} met son horloge à l'heure auprès de ${where(d.dst)}.`;
    case 'TCP': return `${d.src}:${d.sport} → ${where(d.dst)}:${d.dport}${d.app ? ` (${d.app})` : ''} : ${d.info}.`;
    case 'UDP': return `${d.src}:${d.sport} → ${where(d.dst)}:${d.dport}${d.app ? ` (${d.app})` : ''} : ${d.info}.`;
    default: return `${d.src || '?'} → ${d.dst || '?'} : ${d.info || d.proto}.`;
  }
}

/** Lecteur de flux pcap (tcpdump -w -) : on lui donne les morceaux reçus, il rend les paquets décodés. */
export class PcapReader {
  private buf: Buffer = Buffer.alloc(0); private link = -1; private le = true; private nano = false; private started = false;
  private iface: string;
  constructor(iface = '') { this.iface = iface; }
  push(chunk: Buffer): Decoded[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Decoded[] = [];
    if (!this.started) {
      if (this.buf.length < 24) return out;
      const m = this.buf.readUInt32LE(0);
      if (m === 0xa1b2c3d4 || m === 0xa1b23c4d) this.le = true; else if (this.buf.readUInt32BE(0) === 0xa1b2c3d4 || this.buf.readUInt32BE(0) === 0xa1b23c4d) this.le = false; else throw new Error('flux de capture illisible');
      this.nano = (this.le ? this.buf.readUInt32LE(0) : this.buf.readUInt32BE(0)) === 0xa1b23c4d;
      this.link = this.le ? this.buf.readUInt32LE(20) : this.buf.readUInt32BE(20);
      this.buf = this.buf.subarray(24); this.started = true;
    }
    const r32 = (o: number) => (this.le ? this.buf.readUInt32LE(o) : this.buf.readUInt32BE(o));
    while (this.buf.length >= 16) {
      const incl = r32(8); if (incl > 262144) throw new Error('flux de capture désaligné');
      if (this.buf.length < 16 + incl) break;
      const at = r32(0) * 1000 + Math.floor(r32(4) / (this.nano ? 1e6 : 1e3)), orig = r32(12);
      const frame = new Uint8Array(this.buf.subarray(16, 16 + incl));
      try { out.push(decode(frame, this.link, at, orig, this.iface)); } catch { /* trame abîmée : ignorée */ }
      this.buf = this.buf.subarray(16 + incl);
    }
    return out;
  }
}

/** Contenu brut en hexadécimal et en texte, comme le panneau du bas de Wireshark. */
export function hexdump(b: Uint8Array, max = 4096): string {
  const lines: string[] = [];
  for (let i = 0; i < Math.min(b.length, max); i += 16) {
    const row = b.subarray(i, i + 16);
    lines.push(`${i.toString(16).padStart(4, '0')}  ${Array.from(row, (x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${Array.from(row, (c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('')}`);
  }
  return lines.join('\n');
}
