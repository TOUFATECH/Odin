// Le proxy inverse d'Odin (Valgrind) : un nom de domaine → un service de la maison. HTTP et HTTPS (un
// certificat par nom, choisi à la connexion), passage forcé en HTTPS, HSTS, WebSocket, accès par adresses,
// mot de passe (Basic), en-têtes ajoutés, redirections, flux TCP, page « rien ici », journal.
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

export interface Host {
  id: string; domains: string[];
  /** http://192.168.1.10:8080 ou https://… */
  target: string;
  enabled: boolean; forceHttps?: boolean; hsts?: boolean; websocket?: boolean;
  /** garder le nom demandé (Host) vers le service (sinon : celui de la cible) */
  preserveHost?: boolean;
  /** seulement ces adresses ou réseaux (vide : tout le monde) ; refusées : jamais */
  allow?: string[]; deny?: string[];
  /** mot de passe : utilisateur → empreinte scrypt (« sel:empreinte » en hexadécimal) */
  auth?: Record<string, string>;
  /** en-têtes ajoutés à la réponse */
  headers?: Record<string, string>;
  /** certificat : aucun, auto-signé ou Let's Encrypt */
  tls?: 'aucun' | 'auto' | 'letsencrypt';
  timeoutMs?: number;
  /** connexion unique par Vár : il faut être connecté (et dans un groupe autorisé) pour passer */
  sso?: boolean;
}
export interface Redirect { id: string; domain: string; to: string; code: 301 | 302; keepPath: boolean }
export interface Stream { id: string; port: number; target: string; enabled: boolean }
export interface AccessLog { t: number; host: string; ip: string; method: string; path: string; status: number; ms: number; bytes: number; upstream?: string; why?: string }
export interface ProxyDeps {
  hosts: () => Host[]; redirects: () => Redirect[];
  /** le certificat d'un nom (sinon : celui par défaut) */
  cert: (name: string) => { cert: string; key: string } | undefined;
  defaultCert: () => { cert: string; key: string };
  /** réponse au défi Let's Encrypt (HTTP-01) */
  challenge: (token: string) => string | undefined;
  /** adresses bannies par Garmr (refusées partout) */
  banned?: (ip: string) => boolean;
  log?: (e: AccessLog) => void;
  /** mot de passe raté (Garmr peut bannir l'adresse après plusieurs essais) */
  onAuthFail?: (ip: string, host: string) => void;
  /** Vár : qui est connecté (d'après son cookie) et a-t-il le droit d'entrer sur ce site ? */
  sso?: (cookie: string, domain: string, ip: string) => { user: string; groups: string[] } | 'refusé' | undefined;
  /** Vár : le portail de connexion (son nom, et ce qui répond dessus) */
  portal?: { domain: () => string | undefined; url: () => string | undefined; handle: (q: IncomingMessage, r: ServerResponse, secure: boolean) => void };
}

/** Empreinte d'un mot de passe (scrypt, sel aléatoire). */
export function hashPassword(p: string): string { const salt = randomBytes(16); return `${salt.toString('hex')}:${scryptSync(p, salt, 32).toString('hex')}`; }
export function checkPassword(p: string, h: string): boolean { const [s, d] = h.split(':'); if (!s || !d) return false; const a = scryptSync(p, Buffer.from(s, 'hex'), 32), b = Buffer.from(d, 'hex'); return a.length === b.length && timingSafeEqual(a, b); }
const v4 = (ip: string) => ip.replace(/^::ffff:/, '');
/** L'adresse du visiteur : celle de la connexion, ou celle que Cloudflare donne quand la requête vient du tunnel local (cloudflared tourne sur la machine d'Odin). */
export function visitor(q: IncomingMessage): string {
  const ip = v4(q.socket.remoteAddress ?? ''), cf = String(q.headers['cf-connecting-ip'] ?? '').trim();
  return (ip === '127.0.0.1' || ip === '::1') && cf && net.isIP(cf) ? v4(cf) : ip;
}
/** L'adresse est-elle dans ce réseau (192.168.1.0/24) ou est-ce elle (192.168.1.5) ? IPv4. Pur. */
export function inNet(ip: string, net0: string): boolean {
  const a = v4(ip), [n, bits = '32'] = net0.split('/'); if (!net.isIPv4(a) || !net.isIPv4(n)) return a === n;
  const num = (x: string) => x.split('.').reduce((s, o) => s * 256 + Number(o), 0) >>> 0, m = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (num(a) & m) === (num(n) & m);
}
/** Le site qui répond à ce nom : exact, puis joker (*.exemple.fr). Pur. */
export function route(hosts: Host[], name: string): Host | undefined {
  const n = name.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return hosts.find((h) => h.enabled && h.domains.includes(n)) ?? hosts.find((h) => h.enabled && h.domains.some((d) => d.startsWith('*.') && n.endsWith(d.slice(1)) && n !== d.slice(2)));
}
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const page = (title: string, text: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#16181c;color:#f3f4f6}main{max-width:460px;padding:24px;text-align:center}h1{font-size:22px}p{color:#c3c7ce;line-height:1.5}</style></head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

export class ProxyServer {
  httpServer?: http.Server; httpsServer?: https.Server; streams = new Map<string, net.Server>();
  httpPort = 0; httpsPort = 0;
  private open = new Set<() => void>();
  private d: ProxyDeps; private ctxCache = new Map<string, { pem: string; ctx: tls.SecureContext }>();
  constructor(d: ProxyDeps) { this.d = d; }

  async start(o: { http?: number; https?: number; host?: string }): Promise<void> {
    const listen = (s: net.Server, p: number) => new Promise<number>((ok, ko) => { s.once('error', ko); s.listen(p, o.host ?? '0.0.0.0', () => { s.off('error', ko); ok((s.address() as net.AddressInfo).port); }); });
    if (o.http !== undefined) {
      const s = http.createServer((q, r) => void this.handle(q, r, false)); s.on('upgrade', (q, sock, head) => this.upgrade(q, sock as net.Socket, head, false));
      this.httpPort = await listen(s, o.http); this.httpServer = s;
    }
    if (o.https !== undefined) {
      const def = this.d.defaultCert();
      const s = https.createServer({ cert: def.cert, key: def.key, minVersion: 'TLSv1.2', SNICallback: (name, cb) => { try { cb(null, this.secure(name)); } catch (e) { cb(e as Error); } } }, (q, r) => void this.handle(q, r, true));
      s.on('upgrade', (q, sock, head) => this.upgrade(q, sock as net.Socket, head, true));
      this.httpsPort = await listen(s, o.https); this.httpsServer = s;
    }
  }
  /** Ouvre (ou referme) les flux TCP : un port d'Odin → un service. */
  async syncStreams(list: Stream[], host = '0.0.0.0'): Promise<string[]> {
    const errors: string[] = [], want = new Map(list.filter((x) => x.enabled).map((x) => [`${x.port}>${x.target}`, x]));
    for (const [k, s] of this.streams) if (!want.has(k)) { s.close(); this.streams.delete(k); }
    for (const [k, x] of want) {
      if (this.streams.has(k)) continue;
      const [th, tp] = [x.target.replace(/:\d+$/, ''), Number(/:(\d+)$/.exec(x.target)?.[1])];
      const s = net.createServer((c) => { const u = net.connect(tp, th); c.pipe(u).pipe(c); const end = () => { c.destroy(); u.destroy(); this.open.delete(end); }; this.open.add(end); c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', end); });
      try { await new Promise<void>((ok, ko) => { s.once('error', ko); s.listen(x.port, host, () => ok()); }); this.streams.set(k, s); } catch (e) { errors.push(`port ${x.port} : ${(e as Error).message}`); }
    }
    return errors;
  }
  stop(): void { for (const x of [this.httpServer, this.httpsServer]) { x?.close(); x?.closeAllConnections(); } for (const s of this.streams.values()) s.close(); for (const f of [...this.open]) f(); this.httpServer = this.httpsServer = undefined; this.streams.clear(); this.ctxCache.clear(); }
  private secure(name: string): tls.SecureContext {
    const c = this.d.cert(name.toLowerCase()) ?? this.d.defaultCert(), pem = c.cert;
    const hit = this.ctxCache.get(name); if (hit && hit.pem === pem) return hit.ctx;
    const ctx = tls.createSecureContext({ cert: c.cert, key: c.key }); this.ctxCache.set(name, { pem, ctx }); return ctx;
  }
  /** Les gardes : bannie, liste d'accès, mot de passe. Rend la raison du refus et son code. */
  private guard(q: IncomingMessage, h: Host, ip: string, secure = false): { status: number; why: string; headers?: Record<string, string>; user?: { user: string; groups: string[] } } | undefined {
    if (this.d.banned?.(ip)) return { status: 403, why: 'adresse bannie (Garmr)' };
    if (h.deny?.some((n) => inNet(ip, n))) return { status: 403, why: 'adresse refusée' };
    if (h.allow?.length && !h.allow.some((n) => inNet(ip, n))) return { status: 403, why: 'adresse pas autorisée' };
    if (h.auth && Object.keys(h.auth).length) {
      const m = /^Basic\s+(.+)$/i.exec(String(q.headers.authorization ?? '')), raw = m ? Buffer.from(m[1], 'base64').toString('utf8') : '';
      const i = raw.indexOf(':'), user = raw.slice(0, i), pass = raw.slice(i + 1);
      if (!m || i < 0 || !h.auth[user] || !checkPassword(pass, h.auth[user])) { if (m) this.d.onAuthFail?.(ip, h.domains[0]); return { status: 401, why: m ? 'mauvais mot de passe' : 'mot de passe demandé', headers: { 'www-authenticate': 'Basic realm="Odin", charset="UTF-8"' } }; }
    }
    if (h.sso) {
      const who = this.d.sso?.(String(q.headers.cookie ?? ''), String(q.headers.host ?? '').toLowerCase().replace(/:\d+$/, ''), ip), portal = this.d.portal?.url();
      if (who === 'refusé') return { status: 403, why: 'pas dans un groupe autorisé (Vár)' };
      if (!who) {
        if (!portal) return { status: 503, why: 'connexion unique sans portail (Vár)' };
        const back = `${secure ? 'https' : 'http'}://${q.headers.host}${q.url ?? '/'}`;
        return { status: 302, why: 'connexion demandée (Vár)', headers: { location: `${portal}/?rd=${encodeURIComponent(back)}` } };
      }
      return { status: 0, why: '', user: who };
    }
    return undefined;
  }
  async handle(q: IncomingMessage, r: ServerResponse, secure: boolean): Promise<void> {
    const t0 = Date.now(), ip = visitor(q), name = String(q.headers.host ?? '').toLowerCase().replace(/:\d+$/, ''), path = q.url ?? '/';
    const done = (status: number, why?: string, upstream?: string, bytes = 0) => this.d.log?.({ t: t0, host: name, ip, method: q.method ?? 'GET', path: path.slice(0, 300), status, ms: Date.now() - t0, bytes, upstream, why });
    // Défi Let's Encrypt : servi sur le port 80 pour tous les noms.
    const ch = /^\/\.well-known\/acme-challenge\/([\w-]{10,200})$/.exec(path);
    if (ch && !secure) { const a = this.d.challenge(ch[1]); r.writeHead(a ? 200 : 404, { 'content-type': 'text/plain' }); r.end(a ?? ''); return done(a ? 200 : 404, 'défi Let\'s Encrypt'); }
    // Le portail de connexion de Vár répond sous son propre nom.
    if (this.d.portal && name && name === this.d.portal.domain()) { this.d.portal.handle(q, r, secure); return done(200, 'portail Vár'); }
    const rd = this.d.redirects().find((x) => x.domain === name);
    if (rd) { const to = rd.keepPath ? `${rd.to.replace(/\/$/, '')}${path}` : rd.to; r.writeHead(rd.code, { location: to }); r.end(); return done(rd.code, 'redirection'); }
    const h = route(this.d.hosts(), name);
    if (!h) { r.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); r.end(page('Rien ici', `Aucun site n'est rangé sous le nom « ${name.replace(/[<>&"]/g, '')} » dans le proxy d'Odin.`)); return done(404, 'nom inconnu'); }
    if (!secure && h.forceHttps && this.httpsServer) { const port = this.httpsPort === 443 ? '' : `:${this.httpsPort}`; r.writeHead(301, { location: `https://${name}${port}${path}` }); r.end(); return done(301, 'vers HTTPS'); }
    const g0 = this.guard(q, h, ip, secure), who = g0?.status === 0 ? g0.user : undefined, g = g0?.status === 0 ? undefined : g0;
    if (g?.status === 302) { r.writeHead(302, g.headers); r.end(); return done(302, g.why); }
    if (g) { r.writeHead(g.status, { 'content-type': 'text/html; charset=utf-8', ...g.headers }); r.end(page(g.status === 401 ? 'Mot de passe' : 'Accès refusé', g.status === 401 ? 'Ce site demande un identifiant et un mot de passe.' : 'Cette adresse n\'a pas accès à ce site.')); return done(g.status, g.why); }
    const u = new URL(h.target), lib = u.protocol === 'https:' ? https : http;
    const headers: Record<string, string | string[]> = {};
    // Les en-têtes d'identité ne viennent jamais du visiteur : seul Vár les pose.
    for (const [k, v] of Object.entries(q.headers)) if (v !== undefined && !HOP.has(k.toLowerCase()) && !/^remote-|^x-remote-/i.test(k)) headers[k] = v;
    if (who) { headers['remote-user'] = who.user; headers['remote-groups'] = who.groups.join(','); }
    headers['x-forwarded-for'] = [q.headers['x-forwarded-for'], ip].filter(Boolean).join(', ');
    headers['x-forwarded-proto'] = secure ? 'https' : 'http'; headers['x-forwarded-host'] = name; headers['x-real-ip'] = ip;
    if (!h.preserveHost) headers.host = u.host;
    const up = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), method: q.method, path: `${u.pathname.replace(/\/$/, '')}${path}`, headers, rejectUnauthorized: false, timeout: h.timeoutMs ?? 60_000 }, (ur) => {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(ur.headers)) if (v !== undefined && !HOP.has(k.toLowerCase())) out[k] = v;
      for (const [k, v] of Object.entries(h.headers ?? {})) out[k.toLowerCase()] = v;
      if (secure && h.hsts) out['strict-transport-security'] = 'max-age=31536000';
      r.writeHead(ur.statusCode ?? 502, out);
      let bytes = 0; ur.on('data', (c: Buffer) => { bytes += c.length; });
      ur.pipe(r); ur.on('end', () => done(ur.statusCode ?? 502, undefined, h.target, bytes));
    });
    up.on('timeout', () => up.destroy(new Error('délai dépassé')));
    up.on('error', (e) => { if (!r.headersSent) { const to = /délai/.test(e.message); r.writeHead(to ? 504 : 502, { 'content-type': 'text/html; charset=utf-8' }); r.end(page('Service indisponible', `Le service derrière ce nom ne répond pas (${to ? 'trop long' : 'éteint ou injoignable'}). Odin te prévient s'il reste en panne.`)); done(to ? 504 : 502, e.message, h.target); } else r.destroy(); });
    q.pipe(up);
  }
  /** WebSocket (et tout « Upgrade ») : relié tel quel au service, après les mêmes gardes. */
  private upgrade(q: IncomingMessage, sock: net.Socket, head: Buffer, secure: boolean): void {
    const ip = visitor(q), name = String(q.headers.host ?? '').toLowerCase().replace(/:\d+$/, ''), h = route(this.d.hosts(), name);
    const refuse = (code: number, why: string) => { sock.end(`HTTP/1.1 ${code} ${why}\r\nconnection: close\r\n\r\n`); this.d.log?.({ t: Date.now(), host: name, ip, method: 'UPGRADE', path: q.url ?? '/', status: code, ms: 0, bytes: 0, why }); };
    if (!h) return refuse(404, 'Not Found'); if (!h.websocket) return refuse(400, 'WebSocket off');
    const g = this.guard(q, h, ip, secure); if (g && g.status !== 0) return refuse(g.status === 302 ? 401 : g.status, g.status === 401 || g.status === 302 ? 'Unauthorized' : 'Forbidden');
    const u = new URL(h.target), port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
    const up = u.protocol === 'https:' ? tls.connect({ host: u.hostname, port, servername: net.isIP(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false }) : net.connect(port, u.hostname);
    up.on(u.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
      const lines = [`${q.method} ${u.pathname.replace(/\/$/, '')}${q.url} HTTP/1.1`];
      for (const [k, v] of Object.entries(q.headers)) if (v !== undefined && k !== 'host' && !/^(x-)?remote-/i.test(k)) for (const x of [v].flat()) lines.push(`${k}: ${x}`);
      if (g?.user) lines.push(`remote-user: ${g.user.user}`, `remote-groups: ${g.user.groups.join(',')}`);
      lines.push(`host: ${h.preserveHost ? q.headers.host : u.host}`, `x-forwarded-for: ${ip}`, `x-forwarded-proto: ${secure ? 'https' : 'http'}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`); if (head.length) up.write(head);
      sock.pipe(up).pipe(sock);
      this.d.log?.({ t: Date.now(), host: name, ip, method: 'UPGRADE', path: q.url ?? '/', status: 101, ms: 0, bytes: 0, upstream: h.target });
    });
    const end = () => { sock.destroy(); up.destroy(); this.open.delete(end); }; this.open.add(end); up.on('error', end); sock.on('error', end); up.on('close', end); sock.on('close', end);
  }
}
