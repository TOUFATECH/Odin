// Genèse · le serveur HTTP des machines qui démarrent par le réseau : menu iPXE, fichiers des ISO (lus
// directement dans le .iso, avec reprise), fichiers de réponses, et retours d'avancement des installations.
// Il ne répond qu'aux adresses du réseau local (jamais à Internet). Aucun mot de passe ne passe en clair :
// les fichiers de réponses ne contiennent que l'empreinte (Linux) ou la forme encodée de Windows.
// Une exception, connue : le mot de passe d'installation tapé sur un poste (« /cle.ipxe ») arrive en clair sur le
// réseau local, parce que l'iPXE officiel n'a pas de chiffrement ; il n'est jamais dans l'adresse ni gardé.
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { Readable, Writable } from 'node:stream';

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
  /** q : tout ce que le PC dit de lui dans l'adresse (numéro de série, identifiant, taille du disque) */
  menu: (mac: string, fw: string, from: string, q?: URLSearchParams) => Promise<string>;
  /** un fichier d'une ISO (« /f/<id>/<chemin> ») ou l'ISO entière (« /iso/<id>.iso ») */
  isoFile: (id: string, path: string | undefined) => Promise<FileOut | undefined>;
  /** un fichier du dossier de démarrage (wimboot, programme d'installation Debian…) */
  bootFile: (path: string) => string | undefined;
  /** un fichier de réponses (« /seed/<jeton>/<nom> ») ou le script Windows d'après (« /w/<jeton>/apres.ps1 ») */
  seed: (token: string, name: string, from: string) => Promise<string | undefined>;
  /** un installateur de Hermès pour cette installation (« /logiciel/<jeton>/<fichier> ») */
  software: (token: string, file: string, from?: string) => string | undefined;
  /** « /etat/<jeton>?e=… » : où en est l'installation */
  report: (token: string, q: URLSearchParams, from: string) => boolean;
  /** le petit système de l'écran sur le PC : son calque (« /ecran/ovl/<mac>.apkovl.tar.gz ») */
  overlay?: (mac: string) => Buffer | undefined;
  /** les paquets d'Alpine, copiés par Odin (« /alpine/v3.x/main/x86_64/… ») */
  alpine?: (path: string) => Promise<Buffer | undefined>;
  /** une machine charge un fichier (pour suivre l'avancement) */
  fetched: (mac: string | undefined, what: 'noyau' | 'iso' | 'fichier', id: string, path: string, from: string) => void;
  /** L'écran d'Odin (« /ecran ») : la page, l'état pour une machine, un choix, et l'attente côté iPXE. */
  ecran?: {
    page: () => string;
    etat: (mac: string, from: string) => Promise<unknown>;
    choisir: (mac: string, iso: string, mode: string, from: string) => Promise<unknown>;
    attente: (mac: string, fw: string, n: number, from: string) => Promise<string>;
    /** les images de fond : « texte » (PNG pour iPXE) et « graphique » (l'écran graphique) ; absente = rien */
    fond?: (kind: 'texte' | 'graphique') => { type: string; data: Buffer } | undefined;
    /** la fenêtre plein écran d'Odin ouverte en fin d'installation (« /ecran/fin ») : page locale qui se ferme seule */
    fin?: () => string;
  };
  /** Le suivi des installations (suivi.ts). Un poste a-t-il droit à ce fichier ? La raison du refus (403), ou rien. */
  garde?: (mac: string | undefined, from: string, quoi: 'fichier' | 'jeton') => string | undefined;
  /** ce que le poste dit de lui en demandant le menu (numéro de série, modèle, « l'image n'a pas démarré ») */
  vu?: (mac: string, q: URLSearchParams, from: string) => void;
  /** des octets d'une image viennent de partir vers un poste (au plus toutes les 2 s, et à la fin de l'envoi) */
  servi?: (mac: string | undefined, from: string, id: string, octets: number) => void;
  /** le mot de passe d'installation donné par un poste (« /cle.ipxe ») → le script iPXE de la suite */
  cle?: (mac: string, fw: string, from: string, mdp: string, qui: string) => Promise<string>;
  log?: (s: string) => void;
}
/** Le corps d'une demande, borné (au-delà : rien). */
function lireCorps(q: IncomingMessage, max: number): Promise<string | undefined> {
  return new Promise((ok) => {
    const parts: Buffer[] = []; let n = 0, fini = false;
    const rendre = (v: string | undefined) => { if (!fini) { fini = true; ok(v); } };
    q.on('data', (c: Buffer) => { n += c.length; if (n > max) { rendre(undefined); q.resume(); } else parts.push(c); });
    q.on('end', () => rendre(Buffer.concat(parts).toString('utf8'))); q.on('error', () => rendre(undefined));
  });
}

export class PxeHttp {
  server?: Server; port = 16000; private d: HttpDeps;
  constructor(d: HttpDeps) { this.d = d; }
  async start(port = 16000, host = '0.0.0.0'): Promise<void> {
    const s = createServer((q, r) => { void this.handle(q, r).catch((e) => { this.d.log?.(`HTTP : ${(e as Error).message}`); if (!r.headersSent) { r.writeHead(500); } r.end(); }); });
    await new Promise<void>((ok, ko) => { s.once('error', ko); s.listen(port, host, () => { s.off('error', ko); ok(); }); });
    this.server = s; this.port = (s.address() as { port: number }).port;
    // Les connexions ouvertes, par adresse : une installation annulée ou un poste bloqué est coupé tout de suite.
    s.on('connection', (c) => { const ip = (c.remoteAddress ?? '').replace(/^::ffff:/, ''); let l = this.ouvertes.get(ip); if (!l) { l = new Set(); this.ouvertes.set(ip, l); } l.add(c); c.once('close', () => { l.delete(c); if (!l.size && this.ouvertes.get(ip) === l) this.ouvertes.delete(ip); }); });
  }
  private ouvertes = new Map<string, Set<Socket>>();
  /** Ferme tout de suite les connexions de cette adresse (téléchargements en cours compris). */
  couper(ip: string): number { const l = [...(this.ouvertes.get(ip) ?? [])]; for (const c of l) c.destroy(); return l.length; }
  stop(): void { this.server?.closeAllConnections?.(); this.server?.close(); this.server = undefined; }
  /**
   * Une demande traitée EXACTEMENT comme par le réseau (mêmes règles, même ordre), sans rien écouter : aucun port ouvert,
   * aucune machine réelle. Sert aux essais de sûreté (un PC qui démarre est simulé par son adresse et ce qu'il demande).
   */
  async simuler(method: string, url: string, from: string, headers: Record<string, string> = {}, corps = ''): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
    const q = Readable.from(corps ? [Buffer.from(corps)] : []) as unknown as IncomingMessage & { socket: { remoteAddress: string } };
    Object.assign(q, { method, url, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), socket: { remoteAddress: from } });
    const parts: Buffer[] = [], h: Record<string, unknown> = {}; let status = 200;
    const w = new Writable({ write(c, _e, cb) { parts.push(Buffer.from(c)); cb(); } }) as unknown as ServerResponse & { headersSent: boolean };
    let envoye = false;
    Object.defineProperty(w, 'headersSent', { get: () => envoye });
    Object.assign(w, {
      setHeader: (k: string, v: unknown) => { h[k.toLowerCase()] = v; return w; },
      writeHead: (st: number, hh?: Record<string, unknown>) => { status = st; envoye = true; for (const [k, v] of Object.entries(hh ?? {})) h[k.toLowerCase()] = v; return w; },
    });
    const fini = new Promise<void>((ok) => { w.once('finish', () => ok()); w.once('close', () => ok()); });
    await this.handle(q, w);
    await fini;
    return { status, headers: h, body: Buffer.concat(parts).toString('utf8') };
  }

  private async handle(q: IncomingMessage, r: ServerResponse): Promise<void> {
    const from = (q.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!isLocal(from)) { r.writeHead(403); r.end('réseau local seulement'); return; }
    // Seule l'adresse du mot de passe d'installation accepte un envoi (POST) : le mot de passe ne va jamais dans l'adresse.
    if (q.method !== 'GET' && q.method !== 'HEAD' && !(q.method === 'POST' && /^\/cle\.ipxe(\?|$)/.test(q.url ?? ''))) { r.writeHead(405); r.end(); return; }
    const u = new URL(q.url ?? '/', 'http://x'), path = decodeURIComponent(u.pathname);
    if (path.split('/').includes('..')) { r.writeHead(400); r.end(); return; }
    const text = (body: string, type = 'text/plain; charset=utf-8') => { r.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) }); r.end(q.method === 'HEAD' ? undefined : body); };
    if (path === '/boot.ipxe') return text(this.d.bootScript());
    if (path === '/cle.ipxe' && this.d.cle) {
      if (u.searchParams.has('mdp') || u.searchParams.has('password')) { r.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); r.end('le mot de passe ne se donne pas dans l\'adresse'); return; }
      let mdp = '', qui = '';
      if (q.method === 'POST') {
        const corps = await lireCorps(q, 2048); if (corps === undefined) { r.writeHead(413, { connection: 'close' }); r.end(); return; }
        const p = new URLSearchParams(corps); mdp = p.get('mdp') ?? ''; qui = p.get('qui') ?? '';
      } else {
        // iPXE sans la commande « params » : identification HTTP simple (en-tête Authorization).
        const a = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(q.headers.authorization ?? '');
        if (!a) { r.writeHead(401, { 'www-authenticate': 'Basic realm="Odin Genese", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); r.end('mot de passe demandé'); return; }
        const t = Buffer.from(a[1], 'base64').toString('utf8'), k = t.indexOf(':'); mdp = k < 0 ? '' : t.slice(k + 1);
      }
      return text(await this.d.cle(normMac(u.searchParams.get('mac') ?? ''), u.searchParams.get('fw') ?? '', from, mdp.slice(0, 200), qui.slice(0, 80)));
    }
    if (path === '/menu.ipxe') { const mac = normMac(u.searchParams.get('mac') ?? ''); this.d.vu?.(mac, u.searchParams, from); return text(await this.d.menu(mac, u.searchParams.get('fw') ?? '', from, u.searchParams)); }
    if (this.d.ecran && /^\/ecran(\/|$)/.test(path)) {
      const e = this.d.ecran, mac = normMac(u.searchParams.get('mac') ?? '');
      const json = (x: unknown) => text(JSON.stringify(x), 'application/json; charset=utf-8');
      if (path === '/ecran' || path === '/ecran/') { r.setHeader('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"); r.setHeader('x-content-type-options', 'nosniff'); return text(e.page(), 'text/html; charset=utf-8'); }
      if (path === '/ecran/etat') return json(await e.etat(mac, from));
      if (path === '/ecran/fin' && e.fin) { r.setHeader('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"); r.setHeader('x-content-type-options', 'nosniff'); return text(e.fin(), 'text/html; charset=utf-8'); }
      if (path === '/ecran/choisir') return json(await e.choisir(mac, u.searchParams.get('iso') ?? '', u.searchParams.get('mode') ?? '', from));
      const fm = /^\/ecran\/fond-(texte|graphique)(?:\.\w+)?$/.exec(path);
      if (fm) { const f = e.fond?.(fm[1] as 'texte' | 'graphique'); if (!f) { r.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return void r.end('pas d\'image'); } r.writeHead(200, { 'content-type': f.type, 'cache-control': 'no-cache', 'content-length': f.data.length, 'x-content-type-options': 'nosniff' }); return void r.end(q.method === 'HEAD' ? undefined : f.data); }
      if (path === '/ecran/attente.ipxe') return text(await e.attente(mac, u.searchParams.get('fw') ?? '', Math.max(0, Math.min(10_000, Number(u.searchParams.get('n')) || 0)), from));
    }
    // Poste bloqué, installation arrêtée, installations suspendues ou mot de passe pas donné : aucun fichier n'est servi.
    if (this.d.garde && /^\/(f|iso|boot|seed|w|logiciel|alpine|ecran\/ovl)\//.test(path)) {
      const ovl = /^\/ecran\/ovl\/([0-9a-f]{12})\./.exec(path), qm = u.searchParams.get('m');
      const non = this.d.garde(ovl ? normMac(ovl[1]) : qm ? normMac(qm) : undefined, from, /^\/(seed|w|logiciel)\//.test(path) ? 'jeton' : 'fichier');
      if (non) { r.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); r.end(non); return; }
    }
    let m = /^\/f\/([\w.-]+)\/(.+)$/.exec(path);
    if (m) {
      const f = await this.d.isoFile(m[1], m[2]); if (!f) { r.writeHead(404); r.end('absent'); return; }
      const mac = u.searchParams.get('m') ? normMac(u.searchParams.get('m')!) : undefined;
      this.d.fetched(mac, mac ? 'noyau' : 'fichier', m[1], m[2], from);
      const id = m[1]; return this.send(q, r, f, this.d.servi ? (n) => this.d.servi!(mac, from, id, n) : undefined);
    }
    m = /^\/iso\/([\w.-]+)\.iso$/.exec(path);
    if (m) {
      const f = await this.d.isoFile(m[1], undefined); if (!f) { r.writeHead(404); r.end('absent'); return; }
      if (!q.headers.range || /^bytes=0-/.test(q.headers.range)) this.d.fetched(u.searchParams.get('m') ? normMac(u.searchParams.get('m')!) : undefined, 'iso', m[1], '', from);
      const id = m[1], mac = u.searchParams.get('m') ? normMac(u.searchParams.get('m')!) : undefined; return this.send(q, r, f, this.d.servi ? (n) => this.d.servi!(mac, from, id, n) : undefined);
    }
    m = /^\/ecran\/ovl\/([0-9a-f]{12})\.apkovl\.tar\.gz$/.exec(path);
    if (m && this.d.overlay) { const b = this.d.overlay(normMac(m[1])); if (!b) { r.writeHead(404); r.end('absent'); return; } r.writeHead(200, { 'content-type': 'application/gzip', 'content-length': b.length, 'cache-control': 'no-store' }); return void r.end(q.method === 'HEAD' ? undefined : b); }
    m = /^\/alpine\/(v\d+\.\d+\/(?:main|community)\/x86_64\/[\w.+-]+)$/.exec(path);
    if (m && this.d.alpine) { const b = await this.d.alpine(m[1]); if (!b) { r.writeHead(404); r.end('absent'); return; } r.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': b.length }); return void r.end(q.method === 'HEAD' ? undefined : b); }
    m = /^\/boot\/([\w./-]+)$/.exec(path);
    if (m) {
      const p = this.d.bootFile(m[1]); if (!p) { r.writeHead(404); r.end('absent'); return; }
      if (u.searchParams.get('m')) this.d.fetched(normMac(u.searchParams.get('m')!), 'noyau', 'boot', m[1], from);
      const size = statSync(p).size; return this.send(q, r, { size, open: (s, e) => createReadStream(p, { start: s, end: e }) });
    }
    m = /^\/(seed|w)\/([A-Za-z0-9_-]{16,})\/([\w.-]+)$/.exec(path);
    if (m) { const body = await this.d.seed(m[2], m[1] === 'w' ? `w:${m[3]}` : m[3], from); if (body === undefined) { r.writeHead(404); r.end('absent'); return; } return text(body, /\.xml$/.test(m[3]) ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8'); }
    m = /^\/logiciel\/([A-Za-z0-9_-]{16,})\/([^/]+)$/.exec(path);
    if (m) { const p = this.d.software(m[1], m[2], from); if (!p) { r.writeHead(404); r.end('absent'); return; } const size = statSync(p).size; return this.send(q, r, { size, open: (s, e) => createReadStream(p, { start: s, end: e }), type: 'application/octet-stream' }); }
    m = /^\/etat\/([A-Za-z0-9_-]{16,})$/.exec(path);
    if (m) { const ok = this.d.report(m[1], u.searchParams, from); r.writeHead(ok ? 200 : 404, { 'content-type': 'text/plain; charset=utf-8' }); r.end(ok ? 'ok' : 'inconnu'); return; }
    r.writeHead(404); r.end('absent');
  }
  /** Envoie un fichier, en entier ou par morceaux (Range), sans tout charger en mémoire. */
  private async send(q: IncomingMessage, r: ServerResponse, f: FileOut, compte?: (octets: number) => void): Promise<void> {
    const range = parseRange(q.headers.range, f.size);
    if (range === 'invalide') { r.writeHead(416, { 'content-range': `bytes */${f.size}` }); r.end(); return; }
    const start = range?.start ?? 0, end = range?.end ?? f.size - 1;
    r.writeHead(range ? 206 : 200, { 'content-type': f.type ?? 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': Math.max(0, end - start + 1), ...(range ? { 'content-range': `bytes ${start}-${end}/${f.size}` } : {}) });
    if (q.method === 'HEAD' || f.size === 0) { r.end(); return; }
    const body = await f.open(start, end);
    body.on('error', () => r.destroy()); r.on('close', () => body.destroy());
    // Les octets partis vers le poste (avancement réel) : dits au plus toutes les 2 s, et à la fin.
    if (compte) { let n = 0, t = Date.now(); const dire = () => { if (n) { const x = n; n = 0; try { compte(x); } catch { /* le suivi ne gêne jamais l'envoi */ } } }; body.on('data', (c: Buffer) => { n += c.length; if (Date.now() - t >= 2000) { t = Date.now(); dire(); } }); body.once('end', dire); r.once('close', dire); }
    body.pipe(r);
  }
}
/** « 52-54-00-12-34-56 », « 525400123456 » → « 52:54:00:12:34:56 ». Pur. */
export function normMac(s: string): string {
  const h = s.toLowerCase().replace(/[^0-9a-f]/g, ''); return h.length === 12 ? h.match(/../g)!.join(':') : '';
}

// ---------------- Déployer (lot S6) : le PC qui démarre est-il celui autorisé ? ----------------
/** Ce qu'un PC dit de lui au démarrage, nettoyé : numéro de série, identifiant de carte mère, taille du disque (octets). */
export interface IdentiteVue { serie?: string; uuid?: string; disque?: number }
/** L'identité gardée au moment d'autoriser (vue par Odin avant, jamais donnée par la page). */
export interface IdentiteAttendue { mac: string; serie?: string; uuid?: string; disque?: number }
/** La taille du disque dite par le PC (« disque=<octets> », par l'écran d'Odin sur le PC) ; iPXE seul ne la connaît pas. Pur. */
export function tailleDisqueVue(q: URLSearchParams | undefined): number | undefined {
  const v = (q?.get('disque') ?? '').trim();
  if (!/^\d{1,16}$/.test(v)) return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 1024 ** 3 / 2 ? n : undefined;
}
const pareil = (a: string | undefined, b: string | undefined) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
/**
 * AVANT d'effacer un disque : le PC qui démarre doit être EXACTEMENT celui autorisé. L'adresse MAC d'abord ; puis le
 * numéro de série et l'identifiant de carte mère connus au moment d'autoriser (un PC qui ne les donne plus, ou en donne
 * d'autres, est refusé : une adresse MAC se recopie, pas les deux) ; puis la taille du disque quand les deux la
 * connaissent (iPXE seul ne la connaît pas). Rend la raison du refus, ou rien si c'est bien lui. Pur.
 */
export function identiteDifferente(att: IdentiteAttendue, mac: string, vu: IdentiteVue): string | undefined {
  const m = normMac(mac);
  if (!att.mac || !m || m !== normMac(att.mac)) return 'adresse MAC différente';
  if (att.serie) { if (!vu.serie) return 'numéro de série absent'; if (!pareil(att.serie, vu.serie)) return 'numéro de série différent'; }
  if (att.uuid) { if (!vu.uuid) return 'identifiant de la carte mère absent'; if (!pareil(att.uuid, vu.uuid)) return 'identifiant de la carte mère différent'; }
  if (att.disque && vu.disque && att.disque !== vu.disque) return 'taille du disque différente';
  return undefined;
}
/** Une autorisation de déploiement : UN PC (ou « le prochain PC qui démarre » : mac vide), pour ce système et ces réglages. */
export interface AutorisationPc {
  id: string; lot: string;
  /** l'adresse du PC autorisé ; vide : le prochain PC qui démarre par le réseau (une seule fois) */
  mac: string;
  iso: string; isoNom?: string; facon: 'auto' | 'menu'; nom: string;
  /** le profil de logiciels (lot S4) et les options Windows (étape 5) */
  profil?: string; windows?: Record<string, unknown>;
  /** l'identité gardée au moment d'autoriser */
  serie?: string; uuid?: string; disque?: number;
  /** le mot de passe du compte de CE PC, chiffré (jamais en clair sur le disque) */
  mdp?: string;
  cree: number; expire: number;
  /** utilisée : elle ne sert plus jamais (aucun rejeu) */
  consommee?: { at: number; mac: string; token?: string };
  /** annulée (identité différente au démarrage, remplacée, ou retirée) ; vu : l'appareil refusé parce que ce n'était pas lui */
  annulee?: { at: number; raison: string; vu?: IdentiteVue };
}
/** Encore valable : ni utilisée, ni annulée, ni expirée. Pur. */
export const autorisationValable = (a: AutorisationPc, now: number) => !a.consommee && !a.annulee && now < a.expire;
/**
 * L'autorisation qui vaut pour CE PC qui démarre : la sienne d'abord (par son adresse MAC), sinon « le prochain PC qui
 * démarre » (la plus ancienne encore valable). Rien d'utilisé, d'annulé ou d'expiré ne revient. « Le prochain » ne va
 * JAMAIS à un PC déjà pris dans un déploiement depuis moins de 24 h (nommé dans une autorisation, ou qui en a utilisé
 * une) : un PC déployé qui redémarre par le réseau (l'installateur le fait) n'est pas effacé une deuxième fois, et un PC
 * refusé (identité différente) ne repasse pas par « le prochain ». Pur.
 */
export const PRIS_PAR_UN_DEPLOIEMENT_MS = 24 * 3600_000;
export function autorisationPour(l: AutorisationPc[], mac: string, now: number): AutorisationPc | undefined {
  const m = normMac(mac); if (!m) return undefined;
  const tous = (Array.isArray(l) ? l : []).filter((a) => a && typeof a === 'object');
  const ok = tous.filter((a) => autorisationValable(a, now));
  const sienne = ok.find((a) => a.mac && normMac(a.mac) === m); if (sienne) return sienne;
  const dernier = (a: AutorisationPc) => Math.max(Number(a.cree) || 0, Number(a.consommee?.at) || 0, Number(a.annulee?.at) || 0);
  const deja = tous.some((a) => ((a.mac && normMac(a.mac) === m) || (a.consommee?.mac && normMac(a.consommee.mac) === m)) && now - dernier(a) < PRIS_PAR_UN_DEPLOIEMENT_MS);
  return deja ? undefined : ok.filter((a) => !a.mac).sort((a, b) => a.cree - b.cree)[0];
}
/** Une identité dite au démarrage pour une adresse MAC (gardée 24 h, pour voir si deux appareils citent la même adresse). */
export interface IdentiteNotee { serie?: string; uuid?: string; disque?: number; at: number; /** vue pour la première fois */ premiere?: number }
/** Combien de temps Odin se souvient de ce qu'une adresse MAC a dit d'elle (pour voir qu'elle a changé, même après 24 h). */
export const MEMOIRE_IDENTITES_MS = 400 * 24 * 3600_000;
/** Une identité connue pour une adresse MAC, à faire choisir au propriétaire. cle : son nom stable (rien de secret). */
export interface IdentiteConnue { cle: string; serie?: string; uuid?: string; disque?: number; premiere: number; derniere: number; maintenant?: boolean; refusee?: boolean }
const bas = (x: unknown) => String(x ?? '').trim().toLowerCase();
/** Le nom stable d'une identité : numéro de série, carte mère, taille du disque. Pur. */
export const cleIdentite = (x: IdentiteVue) => `${bas(x.serie)}|${bas(x.uuid)}|${x.disque && x.disque > 0 ? x.disque : ''}`;
/**
 * Les identités connues pour une adresse MAC, regroupées (même série et même carte mère ; un disque inconnu ne fait pas
 * une autre identité, deux tailles différentes si). Seules celles qui disent une série ou une carte mère comptent : une
 * autorisation sans elles ne vérifierait que l'adresse. Pur.
 */
export function identitesConnues(l: Array<IdentiteVue & { at: number; premiere?: number; maintenant?: boolean; refusee?: boolean }>): IdentiteConnue[] {
  const groupes = new Map<string, Array<(typeof l)[number]>>();
  for (const x of l) if (x && (x.serie || x.uuid) && Number.isFinite(Number(x.at))) { const k = `${bas(x.serie)}|${bas(x.uuid)}`; groupes.set(k, [...(groupes.get(k) ?? []), x]); }
  const out: IdentiteConnue[] = [];
  for (const g of groupes.values()) {
    const disques = [...new Set(g.map((x) => x.disque).filter((d): d is number => typeof d === 'number' && d > 0))];
    const parts = disques.length > 1 ? disques.map((d) => g.filter((x) => x.disque === d || !x.disque)) : [g];
    for (const [k, p] of parts.entries()) {
      const d = disques.length > 1 ? disques[k] : disques[0], s0 = p.find((x) => x.serie)?.serie, u0 = p.find((x) => x.uuid)?.uuid;
      const id: IdentiteVue = { ...(s0 ? { serie: s0 } : {}), ...(u0 ? { uuid: u0 } : {}), ...(d ? { disque: d } : {}) };
      out.push({ cle: cleIdentite(id), ...id, premiere: Math.min(...p.map((x) => Number(x.premiere ?? x.at))), derniere: Math.max(...p.map((x) => Number(x.at))), ...(p.some((x) => x.maintenant) ? { maintenant: true } : {}), ...(p.some((x) => x.refusee) ? { refusee: true } : {}) });
    }
  }
  return out.sort((a, b) => a.premiere - b.premiere).slice(0, 6);
}
/**
 * Faut-il que le propriétaire dise QUELLE identité est la bonne avant d'effacer ? Oui si le dernier essai de ce PC a été
 * refusé parce que ce n'était pas lui, ou si une autre identité était connue AVANT celle vue maintenant (même il y a plus
 * de 24 h), ou si l'appareil vu maintenant ne dit rien de lui alors qu'une identité est connue. Pur.
 */
export function choixIdentiteExige(connues: IdentiteConnue[], refuseAvant: boolean): boolean {
  if (refuseAvant) return connues.length > 0;
  const m = connues.find((x) => x.maintenant);
  if (!m) return connues.length > 0 && connues.some((x) => !x.maintenant);
  return connues.some((x) => x !== m && x.premiere < m.premiere);
}
/** Une fenêtre de 24 h : deux identités différentes vues pour la même adresse dans ce temps = adresse peut-être recopiée. */
export const FENETRE_IDENTITES_MS = 24 * 3600_000;
/**
 * Deux appareils différents ont-ils démarré avec cette adresse MAC ces dernières 24 h ? (Autre numéro de série, autre
 * carte mère, ou autre taille de disque quand les deux la disent.) Une adresse MAC et ce que le PC dit de lui se recopient
 * par n'importe quelle demande du réseau : avant d'autoriser un effacement, une identité contestée est refusée plutôt que
 * de garder la dernière venue. Rend les identités en conflit (au plus 3), ou rien. Pur.
 */
export function identitesEnConflit(l: IdentiteNotee[] | undefined, now: number): string[] {
  const r = (Array.isArray(l) ? l : []).filter((x) => x && now - Number(x.at) < FENETRE_IDENTITES_MS && now >= Number(x.at) - 60_000);
  const cle = (x: IdentiteNotee) => `${String(x.serie ?? '').trim().toLowerCase()}|${String(x.uuid ?? '').trim().toLowerCase()}`;
  const cles = [...new Set(r.filter((x) => x.serie || x.uuid).map(cle))];
  const disques = [...new Set(r.map((x) => x.disque).filter((d): d is number => typeof d === 'number' && d > 0))];
  if (cles.length < 2 && disques.length < 2) return [];
  return [...cles.map((k) => { const [se, u] = k.split('|'); return [se && `série ${se}`, u && `carte mère ${u.slice(0, 8)}…`].filter(Boolean).join(', '); }), ...(disques.length > 1 ? disques.map((d) => `disque de ${Math.round(d / 1024 ** 3)} Go`) : [])].slice(0, 3);
}
