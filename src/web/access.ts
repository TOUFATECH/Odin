// Qui peut joindre l'interface web, et comment.
//
//   lan   : (par défaut) toutes les interfaces, en HTTPS, mais seuls les appareils de TON
//           sous-réseau sont acceptés (ex. 192.168.1.0/24, détecté automatiquement, ou la
//           liste web.allowedNetworks). Lien type https://192.168.1.20:7777.
//   local : 127.0.0.1 uniquement. Rien n'est visible depuis le réseau.
//   wan   : toutes les adresses, y compris Internet. HTTPS obligatoire : certificat fourni,
//           certificat auto-signé généré ici, ou chiffrement assuré par un proxy (Caddy,
//           Cloudflare Tunnel…) avec behindProxy.
//
// Dans tous les cas le jeton reste exigé pour chaque appel /api, et les essais de jeton
// ratés sont limités par adresse.

import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { OdinConfig, OdinPaths } from '../config.ts';
import { isPrivateHost } from '../heimdall/policy.ts';

export type WebAccess = 'local' | 'lan' | 'wan';
export const ACCESS_LEVELS: WebAccess[] = ['local', 'lan', 'wan'];

/** Adresse d'écoute : la boucle locale, ou toutes les interfaces (IPv4 et IPv6). */
export function bindHost(web: OdinConfig['web']): string {
  return web.access === 'local' ? web.host : '::';
}

/** HTTPS est-il servi par Odin lui-même ? */
export function servesTls(web: OdinConfig['web']): boolean {
  if (web.access === 'wan') return !web.behindProxy;
  if (web.access === 'lan') return web.tls.enabled;
  return false;
}

/** L'adresse de l'appareil qui se connecte est-elle autorisée pour ce mode ? */
export function remoteAllowed(access: WebAccess, remote: string | undefined, networks: string[] = localNetworks()): boolean {
  const ip = (remote ?? '').replace(/^::ffff:/, '');
  if (!ip) return false;
  const loopback = ip === '::1' || /^127\./.test(ip);
  if (access === 'local') return loopback;
  if (access === 'lan') return loopback || networks.some((n) => inCidr(ip, n));
  return true; // wan : le jeton et la limite d'essais protègent
}

/**
 * Sous-réseaux de cette machine (ex. 192.168.1.0/24), seulement les plages privées,
 * plus Tailscale (100.64.0.0/10) si une interface y est. Sert de liste par défaut en LAN.
 */
export function localNetworks(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.internal || !a.cidr) continue;
      if (a.family === 'IPv4' && isPrivateHost(a.address)) {
        if (inCidr(a.address, '100.64.0.0/10')) { out.add('100.64.0.0/10'); continue; }
        const bits = Math.max(16, Number(a.cidr.split('/')[1])); // jamais plus large qu'un /16
        out.add(`${networkOf(a.address, bits)}/${bits}`);
      } else if (a.family === 'IPv6' && /^(fe80|f[cd][0-9a-f]{2}):/i.test(a.address)) {
        out.add(/^fe80/i.test(a.address) ? 'fe80::/10' : `${a.address.split(':').slice(0, 4).join(':')}::/64`);
      }
    }
  }
  return [...out];
}

/** Liste effective : celle de la configuration, sinon les sous-réseaux détectés. */
export const allowedNetworks = (web: OdinConfig['web']) => (web.allowedNetworks.length ? web.allowedNetworks : localNetworks());

export function validCidr(c: string): boolean {
  const [ip, b] = c.split('/');
  const bits = Number(b);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip ?? '')) return ip.split('.').every((x) => Number(x) <= 255) && Number.isInteger(bits) && bits >= 8 && bits <= 32;
  return Boolean(ip?.includes(':')) && Number.isInteger(bits) && bits >= 8 && bits <= 128 && v6(ip) !== null;
}

export function inCidr(ip: string, cidr: string): boolean {
  const [net, b] = cidr.split('/'); const bits = Number(b);
  if (!net || !Number.isInteger(bits)) return false;
  if (ip.includes(':') !== net.includes(':')) return false;
  if (!ip.includes(':')) {
    const a = v4(ip), n = v4(net);
    if (a === null || n === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((a & mask) >>> 0) === ((n & mask) >>> 0);
  }
  const a = v6(ip), n = v6(net);
  if (!a || !n) return false;
  for (let i = 0; i < 128; i += 16) {
    const k = i / 16, take = Math.min(16, Math.max(0, bits - i));
    const mask = take === 0 ? 0 : (0xffff << (16 - take)) & 0xffff;
    if ((a[k] & mask) !== (n[k] & mask)) return false;
  }
  return true;
}

const v4 = (s: string) => { const p = s.split('.').map(Number); return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 : null; };
const networkOf = (ip: string, bits: number) => { const n = (v4(ip)! & ((~0 << (32 - bits)) >>> 0)) >>> 0; return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); };
function v6(s: string): number[] | null {
  const ip = s.split('%')[0];
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const parts = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (parts.length !== 8 || parts.some((x) => !/^[0-9a-f]{1,4}$/i.test(x))) return null;
  return parts.map((x) => parseInt(x, 16));
}

/** Adresses de cette machine sur le réseau local (pour afficher les liens). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.internal) continue;
      if (a.family === 'IPv4' && isPrivateHost(a.address)) out.push(a.address);
    }
  }
  return [...new Set(out)];
}

/** Liens d'accès à afficher, du plus local au plus large. */
export function accessUrls(web: OdinConfig['web'], token: string, actual?: { access: WebAccess; https: boolean }): string[] {
  if (actual) web = { ...web, access: actual.access };
  const scheme = (actual ? actual.https : servesTls(web)) ? 'https' : 'http';
  // Sans jeton (compte déjà créé) : le lien mène à l'écran de connexion.
  const q = token ? `/?token=${token}` : '/';
  const urls = [`${scheme}://${web.access === 'local' && web.host === '::1' ? '[::1]' : '127.0.0.1'}:${web.port}${q}`];
  if (web.access !== 'local') {
    for (const ip of lanAddresses()) urls.push(`${scheme}://${ip}:${web.port}${q}`);
    const name = hostname().replace(/\.local$/, '');
    if (/^[a-z0-9-]+$/i.test(name)) urls.push(`${scheme}://${name}.local:${web.port}${q}`);
  }
  if (web.access === 'wan' && web.publicUrl) urls.push(`${web.publicUrl.replace(/\/$/, '')}${q}`);
  return urls;
}

export interface TlsMaterial { key: string; cert: string; fingerprint: string; selfSigned: boolean; /** Autorité locale d'Odin (à installer sur tes appareils). */ ca?: string; caFingerprint?: string }
const isPrivateIp = (ip: string) => /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);

/**
 * Certificat HTTPS : celui configuré (web.tls.cert/key), sinon un certificat auto-signé
 * créé par Odin lui-même dans ~/.odin/tls (aucun outil externe : marche aussi sous Windows).
 * Il couvre localhost, 127.0.0.1, les adresses locales de la machine et son nom ; il est
 * recréé si ces adresses changent. Le navigateur demandera de l'accepter une fois :
 * compare l'empreinte affichée dans Réglages.
 */
export function ensureTls(paths: OdinPaths, web: OdinConfig['web']): TlsMaterial {
  if (web.tls.cert && web.tls.key) {
    const cert = readFileSync(web.tls.cert, 'utf8'), key = readFileSync(web.tls.key, 'utf8');
    return { cert, key, fingerprint: new X509Certificate(cert).fingerprint256, selfSigned: false };
  }
  const dir = join(paths.home, 'tls');
  const certFile = join(dir, 'cert.pem'), keyFile = join(dir, 'key.pem'), namesFile = join(dir, 'names.json');
  const name = hostname().replace(/\.local$/, '');
  const dns = ['localhost', ...(/^[a-z0-9-]+$/i.test(name) ? [name, `${name}.local`] : [])];
  if (web.publicUrl) { try { const h = new URL(web.publicUrl).hostname; if (!/^[\d.]+$/.test(h)) dns.push(h); } catch { /* ignorée */ } }
  const ips = ['127.0.0.1', ...lanAddresses()];
  // Certificat stable : on ne le régénère que si un nom ou une adresse NÉCESSAIRE manque, jamais parce
  // qu'une adresse a disparu (Wi-Fi coupé, VPN…). Sinon le navigateur redemanderait de l'accepter sans cesse.
  // Les noms déjà présents sont conservés, les nouveaux ajoutés.
  let have: { dns: string[]; ips: string[] } = { dns: [], ips: [] };
  try { if (existsSync(namesFile)) have = JSON.parse(readFileSync(namesFile, 'utf8')) as typeof have; } catch { /* fichier illisible : régénéré */ }
  const missing = dns.some((d) => !have.dns?.includes(d)) || ips.some((i) => !have.ips?.includes(i)) || !existsSync(join(dir, 'ca.pem'));
  const expired = existsSync(certFile) && (() => { try { return new Date(new X509Certificate(readFileSync(certFile)).validTo).getTime() - Date.now() < 30 * 86_400_000; } catch { return true; } })();
  if (!existsSync(certFile) || !existsSync(keyFile) || missing || expired) {
    mkdirSync(dir, { recursive: true });
    const allDns = [...new Set([...(have.dns ?? []), ...dns])].slice(0, 32), allIps = [...new Set([...(have.ips ?? []), ...ips])].slice(0, 32);
    const ca = ensureCa(dir, name);
    const { cert: leaf, key } = issueCertificate('Odin', allDns.filter((d) => isLocalName(d, name)), allIps.filter((i) => isPrivateIp(i)), { signer: ca });
    const cert = leaf + ca.cert; // chaîne complète : certificat d'Odin puis autorité
    writeFileSync(keyFile, key, { mode: 0o600 });
    try { chmodSync(keyFile, 0o600); } catch { /* Windows */ }
    writeFileSync(certFile, cert);
    writeFileSync(namesFile, JSON.stringify({ dns: allDns, ips: allIps }));
  }
  const cert = readFileSync(certFile, 'utf8');
  const caPem = existsSync(join(dir, 'ca.pem')) ? readFileSync(join(dir, 'ca.pem'), 'utf8') : undefined;
  return { cert, key: readFileSync(keyFile, 'utf8'), fingerprint: new X509Certificate(cert).fingerprint256, selfSigned: true, ca: caPem, caFingerprint: caPem ? new X509Certificate(caPem).fingerprint256 : undefined };
}

// ---- Certificat X.509 auto-signé (ECDSA P-256), encodé à la main en DER ----

const der = (tag: number, body: Buffer): Buffer => {
  const n = body.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};
const seq = (...b: Buffer[]) => der(0x30, Buffer.concat(b));
const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [a * 40 + b];
  for (const v of rest) { const t = [v & 127]; for (let x = v >> 7; x > 0; x >>= 7) t.unshift((x & 127) | 128); bytes.push(...t); }
  return der(0x06, Buffer.from(bytes));
};
const utcTime = (d: Date) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const cn = (v: string) => seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(v, 'utf8')))));

export interface Signer { cn: string; key: KeyObject; ski: Buffer }
const skiOf = (spki: Buffer) => createHash('sha1').update(spki).digest();

/**
 * Certificat X.509 (ECDSA P-256) : auto-signé, ou signé par l'autorité locale d'Odin (signer).
 * isCA : autorité de certification limitée aux adresses privées et aux noms locaux (name constraints).
 */
export function issueCertificate(commonName: string, dns: string[], ips: string[], o: { signer?: Signer; isCA?: boolean; days?: number; permittedDns?: string[] } = {}): { cert: string; key: string; keyObj: KeyObject; ski: Buffer } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const serial = randomBytes(16); serial[0] &= 0x7f; serial[0] |= 0x01; // positif, non nul
  const ecdsaSha256 = seq(oid('1.2.840.10045.4.3.2'));
  const days = o.days ?? 825;
  const now = new Date(Date.now() - 3600_000), end = new Date(now.getTime() + days * 86_400_000);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const ski = skiOf(spki);
  const ext = (id: string, value: Buffer, critical = false) => seq(oid(id), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), der(0x04, value));
  const exts: Buffer[] = [];
  if (o.isCA) {
    exts.push(ext('2.5.29.19', seq(der(0x01, Buffer.from([0xff])), der(0x02, Buffer.from([0]))), true)); // CA, longueur de chaîne 0
    exts.push(ext('2.5.29.15', der(0x03, Buffer.from([0x01, 0x06])), true));                             // keyCertSign, cRLSign
    // Limites de l'autorité : elle ne peut signer QUE pour des adresses privées et des noms locaux.
    const ipNet = (a: number[], m: number[]) => seq(der(0x87, Buffer.from([...a, ...m])));
    const subtrees = [
      ipNet([10, 0, 0, 0], [255, 0, 0, 0]), ipNet([172, 16, 0, 0], [255, 240, 0, 0]), ipNet([192, 168, 0, 0], [255, 255, 0, 0]),
      ipNet([127, 0, 0, 0], [255, 0, 0, 0]), ipNet([100, 64, 0, 0], [255, 192, 0, 0]),
      ...(o.permittedDns ?? []).map((d) => seq(der(0x82, Buffer.from(d, 'ascii')))),
    ];
    exts.push(ext('2.5.29.30', seq(der(0xa0, Buffer.concat(subtrees))), true));
  } else {
    const san = seq(...dns.map((d) => der(0x82, Buffer.from(d, 'ascii'))), ...ips.map((ip) => der(0x87, Buffer.from(ip.split('.').map(Number)))));
    exts.push(ext('2.5.29.17', san));
    exts.push(ext('2.5.29.19', seq(), true));                                    // pas une autorité
    exts.push(ext('2.5.29.15', der(0x03, Buffer.from([0x07, 0x80])), true));     // digitalSignature
    exts.push(ext('2.5.29.37', seq(oid('1.3.6.1.5.5.7.3.1'))));                  // serverAuth
  }
  exts.push(ext('2.5.29.14', der(0x04, ski)));                                   // subjectKeyIdentifier
  if (o.signer) exts.push(ext('2.5.29.35', seq(der(0x80, o.signer.ski))));       // authorityKeyIdentifier
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),                                      // version 3
    der(0x02, serial), ecdsaSha256, cn(o.signer?.cn ?? commonName), seq(utcTime(now), utcTime(end)), cn(commonName),
    spki, der(0xa3, seq(...exts)),
  );
  const signature = sign('sha256', tbs, o.signer?.key ?? privateKey);
  const certDer = seq(tbs, ecdsaSha256, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const b64 = certDer.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return { cert: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, keyObj: privateKey, ski };
}

export function selfSignedCertificate(commonName: string, dns: string[], ips: string[], days = 825): { cert: string; key: string } {
  const { cert, key } = issueCertificate(commonName, dns, ips, { days });
  return { cert, key };
}

/** Noms locaux que l'autorité d'Odin peut couvrir. */
export const LOCAL_SUFFIXES = ['localhost', 'local', 'lan', 'home', 'home.arpa', 'internal', 'ts.net'];
export const isLocalName = (d: string, host: string) => d === host || LOCAL_SUFFIXES.some((s) => d === s || d.endsWith(`.${s}`));

/**
 * Autorité de certification locale d'Odin (~/.odin/tls/ca.pem, clé 600) : une fois installée sur tes
 * appareils, ils font confiance à Odin (appli installable, notifications, plus d'alerte). Elle est
 * limitée aux adresses privées et aux noms locaux : elle ne peut pas servir à se faire passer pour un site d'Internet.
 */
export function ensureCa(dir: string, host: string): Signer & { cert: string } {
  const caFile = join(dir, 'ca.pem'), caKey = join(dir, 'ca-key.pem');
  if (!existsSync(caFile) || !existsSync(caKey)) {
    mkdirSync(dir, { recursive: true });
    const permitted = [...new Set([...LOCAL_SUFFIXES, ...(/^[a-z0-9-]+$/i.test(host) ? [host] : [])])];
    const r = issueCertificate(`Odin — autorité locale (${host})`.slice(0, 60), [], [], { isCA: true, days: 3650, permittedDns: permitted });
    writeFileSync(caKey, r.key, { mode: 0o600 });
    try { chmodSync(caKey, 0o600); } catch { /* Windows */ }
    writeFileSync(caFile, r.cert);
  }
  const cert = readFileSync(caFile, 'utf8'), x = new X509Certificate(cert);
  const key = createPrivateKey(readFileSync(caKey, 'utf8'));
  const cnName = /CN=([^\n]+)/.exec(x.subject)?.[1] ?? 'Odin';
  return { cert, cn: cnName, key, ski: skiOf(x.publicKey.export({ type: 'spki', format: 'der' }) as Buffer) };
}

/** Limite les essais de jeton ratés : 10 en 10 minutes, puis 15 minutes de blocage. */
export class AuthThrottle {
  private fails = new Map<string, { n: number; first: number; until: number }>();
  private max: number; private windowMs: number; private banMs: number;
  constructor(max = 10, windowMs = 600_000, banMs = 900_000) { this.max = max; this.windowMs = windowMs; this.banMs = banMs; }

  blocked(ip: string, now = Date.now()): boolean {
    const f = this.fails.get(ip);
    return Boolean(f && f.until > now);
  }
  fail(ip: string, now = Date.now()): void {
    if (/^(::ffff:)?127\.|^::1$/.test(ip)) return; // la machine elle-même n'est jamais bloquée
    const f = this.fails.get(ip);
    if (!f || now - f.first > this.windowMs) { this.fails.set(ip, { n: 1, first: now, until: 0 }); return; }
    f.n++;
    if (f.n >= this.max) f.until = now + this.banMs;
    if (this.fails.size > 10_000) for (const [k, v] of this.fails) if (v.until <= now && now - v.first > this.windowMs) this.fails.delete(k); // on n'oublie que les entrées périmées
  }
  success(ip: string): void { this.fails.delete(ip); }
}
