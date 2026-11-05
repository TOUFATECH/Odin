// Identification approfondie d'UN appareil du réseau : nom d'hôte, système et version, modèle
// (iPhone, Mac…), ports ouverts, partages réseau (SMB, NFS, AFP) et fichiers partagés.
//
// - Windows / Samba (NAS, Linux) : échange SMB2 + NTLM sans mot de passe → nom de l'ordinateur,
//   domaine, version exacte de Windows (numéro de build). Aucune connexion n'est ouverte.
// - Apple (iPhone, iPad, Mac, Apple TV) : question mDNS posée directement à l'appareil → nom
//   « Mon-iPhone.local », identifiant de modèle (iPhone16,2…) traduit en nom commercial.
// - Linux : bannière SSH (OpenSSH + distribution) → Debian 12, Ubuntu 24.04…
// - Partages : smbclient (liste des partages, contenu d'un dossier) et showmount (NFS) s'ils sont
//   installés sur la machine d'Odin ; avec le mot de passe si la machine est dans le coffre.
// Réseau local PRIVÉ seulement, lecture seule, aucune dépendance.

import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { reverse } from 'node:dns/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeQuery, parseDns, type DnsRecord } from './discover.ts';
import { netbiosName, PORT_SERVICES, SCAN_PORTS, serviceName } from './identify.ts';

// ---------------- Ports ----------------

const EXTRA_PORTS = [135, 137, 3260, 5357, 5985, 5986, 7100, 8291, 9001, 49153, 50000];
/** Ports ouverts (connexion TCP simple, en parallèle). */
export async function openPorts(ip: string, ports = [...new Set([...SCAN_PORTS, ...EXTRA_PORTS])], timeoutMs = 900): Promise<number[]> {
  const one = (port: number) => new Promise<number | undefined>((res) => {
    const s = connect({ host: ip, port, timeout: timeoutMs });
    s.once('connect', () => { s.destroy(); res(port); });
    s.once('timeout', () => { s.destroy(); res(undefined); });
    s.once('error', () => res(undefined));
  });
  const out: number[] = [];
  for (let k = 0; k < ports.length; k += 40) out.push(...(await Promise.all(ports.slice(k, k + 40).map(one))).filter((p): p is number => p !== undefined));
  return out.sort((a, b) => a - b);
}

// ---------------- SSH ----------------

export function sshBanner(ip: string, timeoutMs = 2500): Promise<string | undefined> {
  return new Promise((res) => {
    const sock = connect({ host: ip, port: 22, timeout: timeoutMs });
    let buf = '';
    const done = (v?: string) => { sock.destroy(); res(v); };
    sock.on('data', (d) => { buf += d.toString('latin1'); if (buf.includes('\n')) done(buf.split(/\r?\n/)[0].slice(0, 120)); });
    sock.on('timeout', () => done()); sock.on('error', () => done());
  });
}

/** Système deviné d'après la bannière SSH (pur, testable). */
export function osFromSsh(banner: string): string | undefined {
  const b = banner;
  const deb = /Debian-[\w.]*\+deb(\d+)/.exec(b);
  if (deb) return `Linux Debian ${deb[1]}`;
  const ub = /OpenSSH_([\d.]+p\d)[- ]Ubuntu/.exec(b);
  if (ub) return `Linux Ubuntu ${({ '7.6p1': '18.04', '8.2p1': '20.04', '8.9p1': '22.04', '9.3p1': '23.10', '9.6p1': '24.04', '9.7p1': '24.10', '9.9p1': '25.04', '10.0p2': '25.10' } as Record<string, string>)[ub[1]] ?? `(OpenSSH ${ub[1]})`}`;
  if (/Raspbian/i.test(b)) return 'Linux Raspberry Pi OS';
  if (/FreeBSD/i.test(b)) return 'FreeBSD';
  if (/for_Windows/i.test(b)) return 'Windows (serveur OpenSSH)';
  if (/Debian/i.test(b)) return 'Linux Debian';
  if (/dropbear/i.test(b)) return 'Linux embarqué (box, routeur, caméra…)';
  if (/RouterOS|ROSSSH/i.test(b)) return 'MikroTik RouterOS';
  if (/Cisco/i.test(b)) return 'Cisco';
  if (/OpenSSH/.test(b)) return 'Linux / Unix (OpenSSH)';
  return undefined;
}

// ---------------- Windows / Samba : SMB2 + NTLM (sans mot de passe) ----------------

export interface SmbInfo { dialect: string; signingRequired: boolean; computer?: string; domain?: string; dnsName?: string; dnsDomain?: string; os?: string; build?: string }

function smb2Header(command: number, messageId: number): Buffer {
  const h = Buffer.alloc(64);
  h.write('\xfeSMB', 0, 'latin1'); h.writeUInt16LE(64, 4); h.writeUInt16LE(command, 12); h.writeUInt16LE(1, 14);
  h.writeBigUInt64LE(BigInt(messageId), 24);
  return h;
}
const netbios = (b: Buffer) => { const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); };

export function smbNegotiate(): Buffer {
  const dialects = [0x0202, 0x0210, 0x0300, 0x0302];
  const body = Buffer.alloc(36 + dialects.length * 2);
  body.writeUInt16LE(36, 0); body.writeUInt16LE(dialects.length, 2); body.writeUInt16LE(1, 4);
  dialects.forEach((d, k) => body.writeUInt16LE(d, 36 + k * 2));
  return netbios(Buffer.concat([smb2Header(0, 0), body]));
}
export function smbSessionSetup(): Buffer {
  const flags = 0x00000001 | 0x00000002 | 0x00000004 | 0x00000200 | 0x00008000 | 0x00080000 | 0x00800000 | 0x02000000 | 0x20000000 | 0x80000000;
  const ntlm = Buffer.alloc(40);
  ntlm.write('NTLMSSP\0', 0, 'latin1'); ntlm.writeUInt32LE(1, 8); ntlm.writeUInt32LE(flags >>> 0, 12);
  ntlm.writeUInt8(10, 32); ntlm.writeUInt16LE(19041, 34); ntlm.writeUInt8(15, 39);
  const body = Buffer.alloc(24);
  body.writeUInt16LE(25, 0); body.writeUInt8(1, 3); body.writeUInt16LE(64 + 24, 12); body.writeUInt16LE(ntlm.length, 14);
  return netbios(Buffer.concat([smb2Header(1, 1), body, ntlm]));
}

/** Nom commercial d'une version de Windows d'après son numéro de build (pur, testable). */
export function windowsName(major: number, minor: number, build: number): string {
  if (major === 10) {
    if (build >= 26100) return `Windows 11 24H2+ / Server 2025 (build ${build})`;
    if (build >= 22000) return `Windows 11 (build ${build})`;
    if (build === 20348) return 'Windows Server 2022';
    if (build === 17763) return 'Windows 10 1809 / Server 2019';
    if (build === 14393) return 'Windows 10 1607 / Server 2016';
    return `Windows 10 (build ${build})`;
  }
  return ({ '6.3': 'Windows 8.1 / Server 2012 R2', '6.2': 'Windows 8 / Server 2012', '6.1': 'Windows 7 / Server 2008 R2', '6.0': 'Windows Vista / Server 2008', '5.1': 'Windows XP' } as Record<string, string>)[`${major}.${minor}`] ?? `Windows ${major}.${minor} (build ${build})`;
}

/** Lit le défi NTLM (nom de l'ordinateur, domaine, version) dans une réponse (pur, testable). */
export function parseNtlmChallenge(buf: Buffer): Omit<SmbInfo, 'dialect' | 'signingRequired'> | undefined {
  const at = buf.indexOf('NTLMSSP\0', 0, 'latin1');
  if (at < 0 || buf.readUInt32LE(at + 8) !== 2) return undefined;
  const m = buf.subarray(at);
  const out: Omit<SmbInfo, 'dialect' | 'signingRequired'> = {};
  const len = m.readUInt16LE(40), off = m.readUInt32LE(44);
  for (let p = off; p + 4 <= off + len && p + 4 <= m.length;) {
    const id = m.readUInt16LE(p), l = m.readUInt16LE(p + 2);
    if (id === 0) break;
    const v = m.toString('utf16le', p + 4, p + 4 + l);
    if (id === 1) out.computer = v; else if (id === 2) out.domain = v; else if (id === 3) out.dnsName = v; else if (id === 4) out.dnsDomain = v;
    p += 4 + l;
  }
  if (m.readUInt32LE(20) & 0x02000000 && m.length >= 56) {
    const [maj, min, build] = [m[48], m[49], m.readUInt16LE(50)];
    out.build = `${maj}.${min}.${build}`;
    out.os = maj === 6 && min === 1 && build === 0 ? 'Samba (Linux, NAS…)' : windowsName(maj, min, build);
  }
  return out;
}

export function smbInfo(ip: string, timeoutMs = 3000, port = 445): Promise<SmbInfo | undefined> {
  return new Promise((res) => {
    const s = connect({ host: ip, port, timeout: timeoutMs });
    let buf = Buffer.alloc(0), step = 0, info: SmbInfo | undefined;
    const done = () => { s.destroy(); res(info); };
    s.once('connect', () => s.write(smbNegotiate()));
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
        const msg = buf.subarray(4, 4 + buf.readUInt32BE(0)); buf = buf.subarray(4 + msg.length);
        if (msg.toString('latin1', 0, 4) !== '\xfeSMB') return done();
        if (step === 0) {
          const dialect = msg.readUInt16LE(64 + 4), mode = msg.readUInt16LE(64 + 2);
          info = { dialect: `SMB ${({ 0x0202: '2.0.2', 0x0210: '2.1', 0x0300: '3.0', 0x0302: '3.0.2', 0x0311: '3.1.1' } as Record<number, string>)[dialect] ?? dialect.toString(16)}`, signingRequired: Boolean(mode & 2) };
          step = 1; s.write(smbSessionSetup());
        } else { Object.assign(info!, parseNtlmChallenge(msg) ?? {}); return done(); }
      }
    });
    s.on('timeout', done); s.on('error', done); s.on('close', () => res(info));
  });
}

// ---------------- Apple et mDNS (question directe à l'appareil) ----------------

const APPLE: Record<string, string> = {
  'iPhone12,1': 'iPhone 11', 'iPhone12,3': 'iPhone 11 Pro', 'iPhone12,5': 'iPhone 11 Pro Max', 'iPhone12,8': 'iPhone SE (2e gén.)',
  'iPhone13,1': 'iPhone 12 mini', 'iPhone13,2': 'iPhone 12', 'iPhone13,3': 'iPhone 12 Pro', 'iPhone13,4': 'iPhone 12 Pro Max',
  'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13', 'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max', 'iPhone14,6': 'iPhone SE (3e gén.)',
  'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus', 'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus', 'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus', 'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max', 'iPhone17,5': 'iPhone 16e',
  'iPhone18,3': 'iPhone 17', 'iPhone18,4': 'iPhone Air', 'iPhone18,1': 'iPhone 17 Pro', 'iPhone18,2': 'iPhone 17 Pro Max',
  'AppleTV11,1': 'Apple TV 4K (3e gén.)', 'AppleTV6,2': 'Apple TV 4K', 'AudioAccessory5,1': 'HomePod mini', 'AudioAccessory6,1': 'HomePod (2e gén.)',
};
/** Nom commercial d'un identifiant de modèle Apple (pur, testable). */
export function appleModelName(id: string): string {
  if (APPLE[id]) return `${APPLE[id]} (${id})`;
  const fam = [['iPhone', 'iPhone'], ['iPad', 'iPad'], ['MacBookPro', 'MacBook Pro'], ['MacBookAir', 'MacBook Air'], ['Macmini', 'Mac mini'], ['iMac', 'iMac'], ['MacPro', 'Mac Pro'], ['Mac', 'Mac (puce Apple)'], ['AppleTV', 'Apple TV'], ['AudioAccessory', 'HomePod'], ['Watch', 'Apple Watch']].find(([p]) => id.startsWith(p));
  return fam ? `${fam[1]} (${id})` : id;
}

const ASK = ['_device-info._tcp.local', '_companion-link._tcp.local', '_apple-mobdev2._tcp.local', '_airplay._tcp.local', '_raop._tcp.local', '_smb._tcp.local', '_afpovertcp._tcp.local', '_nfs._tcp.local', '_workstation._tcp.local', '_ssh._tcp.local', '_sftp-ssh._tcp.local', '_rfb._tcp.local', '_services._dns-sd._udp.local'];
export interface MdnsInfo { hostname?: string; name?: string; model?: string; services: string[] }

/** Résume ce qu'un appareil répond en mDNS (pur, testable). */
export function mdnsInfo(records: DnsRecord[]): MdnsInfo {
  const services = new Set<string>();
  let hostname: string | undefined, name: string | undefined, model: string | undefined;
  for (const r of records) {
    const svc = (r.type === 12 ? r.data : r.name).match(/(_[a-z0-9-]+\._(?:tcp|udp))\.local$/i)?.[1]?.toLowerCase();
    if (svc && svc !== '_services._dns-sd._udp' && svc !== '_device-info._tcp') services.add(svc);
    if (r.type === 12 && /in-addr\.arpa$/i.test(r.name)) hostname ??= r.data.replace(/\.$/, '');
    if (r.type === 33 && /\.local$/i.test(r.data)) hostname ??= r.data;
    if (r.type === 12 && !r.name.startsWith('_services') && !/in-addr/.test(r.name)) name ??= r.data.split('._')[0];
    if (r.txt) model ??= r.txt.model ?? r.txt.rpmd ?? r.txt.md ?? r.txt.am;
  }
  return { hostname, name, model, services: [...services] };
}

export function mdnsAsk(ip: string, waitMs = 1800): Promise<MdnsInfo> {
  return new Promise((res) => {
    const recs: DnsRecord[] = [];
    const s = createSocket('udp4');
    const end = () => { try { s.close(); } catch { /* fermé */ } res(mdnsInfo(recs)); };
    s.on('error', end);
    s.on('message', (m, r) => { if (r.address === ip) recs.push(...parseDns(m)); });
    s.bind(0, () => {
      const rev = `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
      s.send(encodeQuery([...ASK, rev]), 5353, ip);
      setTimeout(end, waitMs);
    });
  });
}

// ---------------- Partages (smbclient, showmount) ----------------

const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 15_000) => new Promise<{ ok: boolean; out: string; missing?: boolean }>((res) => {
  execFile(cmd, args, { timeout, env: { ...process.env, ...env, LANG: 'C' }, maxBuffer: 2 << 20 }, (e, out, err) => res({ ok: !e, out: `${out}${err}`, missing: (e as NodeJS.ErrnoException | null)?.code === 'ENOENT' }));
});
function authFile(user?: string, password?: string): { args: string[]; clean: () => void } {
  if (!user || !password) return { args: ['-N'], clean: () => undefined };
  const dir = mkdtempSync(join(tmpdir(), 'odin-smb-')), f = join(dir, 'auth');
  writeFileSync(f, `username = ${user}\npassword = ${password}\n`, { mode: 0o600 });
  return { args: ['-A', f], clean: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface Share { name: string; type: string; comment: string }
/** Liste « smbclient -g » (pur, testable). */
export function parseSmbShares(out: string): Share[] {
  return out.split('\n').map((l) => l.split('|')).filter((p) => p.length >= 3 && /^(Disk|Printer|IPC)$/.test(p[0])).map(([type, name, comment]) => ({ type: type === 'Disk' ? 'dossier' : type === 'Printer' ? 'imprimante' : 'système', name, comment: comment.trim() }));
}
export async function smbShares(ip: string, user?: string, password?: string): Promise<{ shares?: Share[]; note?: string }> {
  const a = authFile(user, password);
  try {
    const r = await run('smbclient', ['-L', `//${ip}`, '-g', '-m', 'SMB3', ...a.args]);
    if (r.missing) return { note: 'smbclient n\'est pas installé sur la machine d\'Odin (sudo apt install smbclient) : impossible de lister les partages' };
    const shares = parseSmbShares(r.out);
    if (shares.length) return { shares };
    if (/ACCESS_DENIED|LOGON_FAILURE/.test(r.out)) return { note: user ? 'identifiants refusés' : 'les partages ne sont visibles qu\'avec un compte (ajoute l\'appareil dans Réglages → Droits et machines)' };
    return { note: r.out.trim().split('\n').at(-1)?.slice(0, 160) || 'aucun partage' };
  } finally { a.clean(); }
}
/** Lignes de « smbclient ls » (pur, testable). */
export function parseSmbLs(out: string): Array<{ name: string; dir: boolean; size: number; date: string }> {
  return out.split('\n').map((l) => /^\s+(.+?)\s+([A-Z]*)\s+(\d+)\s+(\w{3} \w{3} +\d+ [\d:]+ \d{4})\s*$/.exec(l)).filter((m): m is RegExpExecArray => Boolean(m) && m![1] !== '.' && m![1] !== '..')
    .map((m) => ({ name: m[1], dir: m[2].includes('D'), size: Number(m[3]), date: new Date(m[4]).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }));
}
/** Contenu d'un dossier partagé (lecture seule). */
export async function smbList(ip: string, share: string, path = '', user?: string, password?: string): Promise<string> {
  if (/[\0\n'"]/.test(share + path)) return 'Nom de partage ou chemin invalide.';
  const a = authFile(user, password);
  try {
    const dir = path.replace(/\//g, '\\').replace(/^\\+|\\+$/g, '');
    const r = await run('smbclient', [`//${ip}/${share}`, ...a.args, '-m', 'SMB3', '-c', `ls "${dir ? `${dir}\\` : ''}*"`]);
    if (r.missing) return 'smbclient n\'est pas installé sur la machine d\'Odin (sudo apt install smbclient).';
    const items = parseSmbLs(r.out);
    if (items.length) return items.slice(0, 300).map((x) => `${x.dir ? '📁' : '📄'} ${x.name}${x.dir ? '' : ` (${x.size < 1024 ? `${x.size} o` : x.size < 1 << 20 ? `${Math.round(x.size / 1024)} Ko` : `${(x.size / 1048576).toFixed(1)} Mo`})`} · ${x.date}`).join('\n') + (items.length > 300 ? `\n… et ${items.length - 300} autres` : '');
    return /NT_STATUS_\w+/.exec(r.out)?.[0].replace('NT_STATUS_ACCESS_DENIED', 'accès refusé (il faut un compte : Réglages → Droits et machines)').replace('NT_STATUS_BAD_NETWORK_NAME', 'ce partage n\'existe pas').replace('NT_STATUS_NO_SUCH_FILE', 'dossier vide ou introuvable') ?? 'Dossier vide.';
  } finally { a.clean(); }
}
export async function nfsExports(ip: string): Promise<{ exports?: string[]; note?: string }> {
  const r = await run('showmount', ['-e', '--no-headers', ip], undefined, 8000);
  if (r.missing) return { note: 'showmount absent (sudo apt install nfs-common)' };
  return r.ok ? { exports: r.out.trim().split('\n').filter(Boolean) } : { note: r.out.trim().slice(0, 160) };
}

// ---------------- Tout ensemble ----------------

export interface DeepInfo {
  ip: string; hostnames: string[]; os?: string; model?: string; ports: number[];
  smb?: SmbInfo; ssh?: string; mdns: MdnsInfo; netbios?: string;
  shares?: Share[]; sharesNote?: string; nfs?: string[]; apple: boolean;
}

export async function deepIdentify(ip: string, o: { user?: string; password?: string; ports?: number[] } = {}): Promise<DeepInfo> {
  const ports = o.ports ?? await openPorts(ip);
  const [mdns, nb, ssh, smb, rdns] = await Promise.all([
    mdnsAsk(ip), netbiosName(ip),
    ports.includes(22) ? sshBanner(ip) : Promise.resolve(undefined),
    ports.includes(445) ? smbInfo(ip) : Promise.resolve(undefined),
    Promise.race([reverse(ip).catch(() => [] as string[]), new Promise<string[]>((r) => setTimeout(() => r([]), 1500))]),
  ]);
  const apple = ports.includes(62078) || mdns.services.some((s) => /companion-link|apple-mobdev|airplay|raop|device-info/.test(s)) || /^(iPhone|iPad|Mac|AppleTV|AudioAccessory|iMac)/.test(mdns.model ?? '');
  let os = smb?.os ?? (ssh ? osFromSsh(ssh) : undefined);
  const model = mdns.model ? (apple ? appleModelName(mdns.model) : mdns.model) : undefined;
  if (apple) {
    const m = mdns.model ?? '';
    os = /^iPhone/.test(m) || (ports.includes(62078) && !/^(Mac|iMac)/.test(m) && !/^iPad/.test(m)) ? 'iOS (iPhone)' : /^iPad/.test(m) ? 'iPadOS' : /^AppleTV/.test(m) ? 'tvOS' : /^AudioAccessory/.test(m) ? 'audioOS (HomePod)' : /^(Mac|iMac)/.test(m) || mdns.services.includes('_rfb._tcp') ? 'macOS' : os ?? 'Apple';
  }
  if (!os && ports.includes(3389)) os = 'Windows (bureau à distance ouvert)';
  if (!os && (ports.includes(135) || ports.includes(5357))) os = 'Windows';
  const hostnames = [...new Set([mdns.hostname, ...rdns.map((x) => x.replace(/\.$/, '')), smb?.dnsName, smb?.computer, nb].filter(Boolean) as string[])];
  const out: DeepInfo = { ip, hostnames, os, model, ports, smb, ssh, mdns, netbios: nb, apple };
  if (ports.includes(445) || ports.includes(139)) { const r = await smbShares(ip, o.user, o.password); out.shares = r.shares; out.sharesNote = r.note; }
  if (ports.includes(2049) || ports.includes(111)) out.nfs = (await nfsExports(ip)).exports;
  return out;
}

/** Fiche lisible (pur, testable). */
export function formatDeep(d: DeepInfo, kind = ''): string {
  const L: string[] = [`Appareil ${d.ip}${kind ? ` — classé « ${kind} »` : ''}`];
  L.push(`Nom d'hôte : ${d.hostnames.length ? d.hostnames.join(' · ') : 'aucun nom annoncé'}${d.mdns.name && !d.hostnames.includes(d.mdns.name) ? ` (nom affiché : ${d.mdns.name})` : ''}`);
  L.push(`Système : ${d.os ?? 'inconnu'}${d.smb?.build && !/Samba/.test(d.os ?? '') ? ` — version ${d.smb.build}` : ''}`);
  if (d.model) L.push(`Modèle : ${d.model}`);
  if (d.apple && !d.model) L.push('Modèle : appareil Apple (le modèle exact n\'est pas annoncé ; iOS le cache souvent quand l\'écran est verrouillé)');
  if (d.smb?.domain && d.smb.domain !== d.smb.computer) L.push(`Domaine / groupe de travail : ${d.smb.domain}${d.smb.dnsDomain ? ` (${d.smb.dnsDomain})` : ''}`);
  if (d.ssh) L.push(`SSH : ${d.ssh}`);
  L.push(`Ports ouverts (${d.ports.length}) : ${d.ports.map((p) => `${p} ${PORT_SERVICES[p] ? `(${serviceName(p)})` : ''}`.trim()).join(', ') || 'aucun'}`);
  if (d.mdns.services.length) L.push(`Services annoncés : ${d.mdns.services.join(', ')}`);
  const net: string[] = [];
  if (d.smb) net.push(`SMB (${d.smb.dialect}${d.smb.signingRequired ? ', signature exigée' : ', signature non exigée ⚠'})`);
  if (d.ports.includes(548) || d.mdns.services.includes('_afpovertcp._tcp')) net.push('AFP (partage Apple)');
  if (d.nfs?.length || d.ports.includes(2049)) net.push('NFS');
  if (d.ports.includes(21)) net.push('FTP');
  if (net.length) L.push(`Partage réseau : ${net.join(', ')}`);
  if (d.shares?.length) L.push(`Dossiers partagés : ${d.shares.filter((s) => s.type !== 'système').map((s) => `${s.name}${s.comment ? ` (${s.comment})` : ''}`).join(', ') || 'aucun (seulement les partages système)'}`);
  else if (d.sharesNote) L.push(`Dossiers partagés : ${d.sharesNote}`);
  if (d.nfs?.length) L.push(`Exports NFS : ${d.nfs.join(' ; ')}`);
  return L.join('\n');
}
