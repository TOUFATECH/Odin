// Genèse · le serveur HTTP des machines qui démarrent par le réseau : menu iPXE, fichiers des ISO (lus
// directement dans le .iso, avec reprise), fichiers de réponses, et retours d'avancement des installations.
// Il ne répond qu'aux adresses du réseau local (jamais à Internet). Aucun mot de passe ne passe en clair :
// les fichiers de réponses ne contiennent que l'empreinte (Linux) ou la forme encodée de Windows.
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Readable } from 'node:stream';

/** Adresse du réseau local (ou de la machine elle-même) ? Pur. */
export function isLocal(ip: string): boolean {
  const a = ip.replace(/^::ffff:/, '');
  if (a === '::1' || a.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/i.test(a)) return true;
  const p = a.split('.').map(Number); if (p.length !== 4 || p.some((x) => !Number.isInteger(x))) return false;
  return p[0] === 10 || p[0] === 127 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}
/** « bytes=100-199 » → début et fin (incluse). Pur. */
export function parseRange(h: string | undefined, size: number): { start: number; end: number } | undefined | 'invalide' {
  if (!h) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim()); if (!m || (!m[1] && !m[2])) return 'invalide';
  let start = m[1] ? Number(m[1]) : size - Number(m[2]), end = m[1] && m[2] ? Number(m[2]) : size - 1;
  if (!m[1]) start = Math.max(0, start); end = Math.min(end, size - 1);
  return start > end || start >= size ? 'invalide' : { start, end };
}

export interface FileOut { size: number; open: (start: number, end: number) => Promise<Readable> | Readable; type?: string }
export interface HttpDeps {
  /** /boot.ipxe → le petit script qui redemande le menu avec l'adresse MAC */
  bootScript: () => string;
  menu: (mac: string, fw: string, from: string) => Promise<string>;
  /** un fichier d'une ISO (« /f/<id>/<chemin> ») ou l'ISO entière (« /iso/<id>.iso ») */
  isoFile: (id: string, path: string | undefined) => Promise<FileOut | undefined>;
  /** un fichier du dossier de démarrage (wimboot, programme d'installation Debian…) */
  bootFile: (path: string) => string | undefined;
  /** un fichier de réponses (« /seed/<jeton>/<nom> ») ou le script Windows d'après (« /w/<jeton>/apres.ps1 ») */
  seed: (token: string, name: string, from: string) => Promise<string | undefined>;
  /** un installateur de Hermès pour cette installation (« /logiciel/<jeton>/<fichier> ») */
  software: (token: string, file: string) => string | undefined;
  /** « /etat/<jeton>?e=… » : où en est l'installation */
  report: (token: string, q: URLSearchParams, from: string) => boolean;
  /** une machine charge un fichier (pour suivre l'avancement) */
  fetched: (mac: string | undefined, what: 'noyau' | 'iso' | 'fichier', id: string, path: string, from: string) => void;
  /** L'écran d'Odin (« /ecran ») : la page, l'état pour une machine, un choix, et l'attente côté iPXE. */
  ecran?: {
    page: () => string;
    etat: (mac: string, from: string) => Promise<unknown>;
    choisir: (mac: string, iso: string, mode: string, from: string) => Promise<unknown>;
    attente: (mac: string, fw: string, n: number, from: string) => Promise<string>;
  };
  log?: (s: string) => void;
}

export class PxeHttp {
  server?: Server; port = 16000; private d: HttpDeps;
  constructor(d: HttpDeps) { this.d = d; }
  async start(port = 16000, host = '0.0.0.0'): Promise<void> {
    const s = createServer((q, r) => { void this.handle(q, r).catch((e) => { this.d.log?.(`HTTP : ${(e as Error).message}`); if (!r.headersSent) { r.writeHead(500); } r.end(); }); });
    await new Promise<void>((ok, ko) => { s.once('error', ko); s.listen(port, host, () => { s.off('error', ko); ok(); }); });
    this.server = s; this.port = (s.address() as { port: number }).port;
  }
  stop(): void { this.server?.closeAllConnections?.(); this.server?.close(); this.server = undefined; }

  private async handle(q: IncomingMessage, r: ServerResponse): Promise<void> {
    const from = (q.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!isLocal(from)) { r.writeHead(403); r.end('réseau local seulement'); return; }
    if (q.method !== 'GET' && q.method !== 'HEAD') { r.writeHead(405); r.end(); return; }
    const u = new URL(q.url ?? '/', 'http://x'), path = decodeURIComponent(u.pathname);
    if (path.split('/').includes('..')) { r.writeHead(400); r.end(); return; }
    const text = (body: string, type = 'text/plain; charset=utf-8') => { r.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) }); r.end(q.method === 'HEAD' ? undefined : body); };
    if (path === '/boot.ipxe') return text(this.d.bootScript());
    if (path === '/menu.ipxe') { const mac = normMac(u.searchParams.get('mac') ?? ''); return text(await this.d.menu(mac, u.searchParams.get('fw') ?? '', from)); }
    if (this.d.ecran && /^\/ecran(\/|$)/.test(path)) {
      const e = this.d.ecran, mac = normMac(u.searchParams.get('mac') ?? '');
      const json = (x: unknown) => text(JSON.stringify(x), 'application/json; charset=utf-8');
      if (path === '/ecran' || path === '/ecran/') { r.setHeader('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"); r.setHeader('x-content-type-options', 'nosniff'); return text(e.page(), 'text/html; charset=utf-8'); }
      if (path === '/ecran/etat') return json(await e.etat(mac, from));
      if (path === '/ecran/choisir') return json(await e.choisir(mac, u.searchParams.get('iso') ?? '', u.searchParams.get('mode') ?? '', from));
      if (path === '/ecran/attente.ipxe') return text(await e.attente(mac, u.searchParams.get('fw') ?? '', Math.max(0, Math.min(10_000, Number(u.searchParams.get('n')) || 0)), from));
    }
    let m = /^\/f\/([\w.-]+)\/(.+)$/.exec(path);
    if (m) {
      const f = await this.d.isoFile(m[1], m[2]); if (!f) { r.writeHead(404); r.end('absent'); return; }
      const mac = u.searchParams.get('m') ? normMac(u.searchParams.get('m')!) : undefined;
      this.d.fetched(mac, mac ? 'noyau' : 'fichier', m[1], m[2], from);
      return this.send(q, r, f);
    }
    m = /^\/iso\/([\w.-]+)\.iso$/.exec(path);
    if (m) {
      const f = await this.d.isoFile(m[1], undefined); if (!f) { r.writeHead(404); r.end('absent'); return; }
      if (!q.headers.range || /^bytes=0-/.test(q.headers.range)) this.d.fetched(u.searchParams.get('m') ? normMac(u.searchParams.get('m')!) : undefined, 'iso', m[1], '', from);
      return this.send(q, r, f);
    }
    m = /^\/boot\/([\w./-]+)$/.exec(path);
    if (m) {
      const p = this.d.bootFile(m[1]); if (!p) { r.writeHead(404); r.end('absent'); return; }
      if (u.searchParams.get('m')) this.d.fetched(normMac(u.searchParams.get('m')!), 'noyau', 'boot', m[1], from);
      const size = statSync(p).size; return this.send(q, r, { size, open: (s, e) => createReadStream(p, { start: s, end: e }) });
    }
    m = /^\/(seed|w)\/([A-Za-z0-9_-]{16,})\/([\w.-]+)$/.exec(path);
    if (m) { const body = await this.d.seed(m[2], m[1] === 'w' ? `w:${m[3]}` : m[3], from); if (body === undefined) { r.writeHead(404); r.end('absent'); return; } return text(body, /\.xml$/.test(m[3]) ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8'); }
    m = /^\/logiciel\/([A-Za-z0-9_-]{16,})\/([^/]+)$/.exec(path);
    if (m) { const p = this.d.software(m[1], m[2]); if (!p) { r.writeHead(404); r.end('absent'); return; } const size = statSync(p).size; return this.send(q, r, { size, open: (s, e) => createReadStream(p, { start: s, end: e }), type: 'application/octet-stream' }); }
    m = /^\/etat\/([A-Za-z0-9_-]{16,})$/.exec(path);
    if (m) { const ok = this.d.report(m[1], u.searchParams, from); r.writeHead(ok ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8' }); r.end(ok ? 'ok' : 'inconnu'); return; }
    r.writeHead(404); r.end('absent');
  }
  /** Envoie un fichier, en entier ou par morceaux (Range), sans tout charger en mémoire. */
  private async send(q: IncomingMessage, r: ServerResponse, f: FileOut): Promise<void> {
    const range = parseRange(q.headers.range, f.size);
    if (range === 'invalide') { r.writeHead(416, { 'content-range': `bytes */${f.size}` }); r.end(); return; }
    const start = range?.start ?? 0, end = range?.end ?? f.size - 1;
    r.writeHead(range ? 206 : 200, { 'content-type': f.type ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': Math.max(0, end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${f.size}` } : {}) });
    if (q.method === 'HEAD' || f.size === 0) { r.end(); return; }
    const body = await f.open(start, end);
    body.on('error', () => r.destroy()); r.on('close', () => body.destroy());
    body.pipe(r);
  }
}
/** « 52-54-00-12-34-56 », « 525400123456 » → « 52:54:00:12:34:56 ». Pur. */
export function normMac(s: string): string {
  const h = s.toLowerCase().replace(/[^0-9a-f]/g, ''); return h.length === 12 ? h.match(/../g)!.join(':') : '';
}
