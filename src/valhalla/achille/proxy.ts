// Achille · le proxy d'essai (mandataire HTTP et CONNECT). Éteint par défaut ; allumé par une action grave, il
// s'éteint tout seul (2 h par défaut). Les règles :
//   - seuls les appareils autorisés peuvent s'en servir (liste d'adresses IP ; la boucle locale est permise) ;
//   - une cible hors de ta portée reçoit 403 « refusé : hors de ta portée », notée au journal : jamais de tunnel aveugle ;
//   - une cible dans ta portée : le HTTPS est lu avec un certificat signé par l'autorité d'Achille, puis transmis ;
//     le certificat invalide d'une adresse de la maison est accepté mais noté comme défaut ;
//   - le Host d'une requête dans un tunnel ne change pas la cible : c'est l'hôte du CONNECT, vérifié, qui compte ;
//   - les corps des échanges (256 Ko au plus) restent en mémoire seulement (200 derniers) ; le journal garde méthode,
//     lien, code, durée, taille et en-têtes, avec les valeurs secrètes masquées (●●●●).
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect as tlsConnect, TLSSocket } from 'node:tls';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { once } from 'node:events';
import { nu, type Portee } from './portee.ts';
import type { Autorite } from './ca.ts';
import { controler, type Defaut } from './controles.ts';
import { masquerEntetes, masquerUrl } from './outils.ts';

export const MAX_CORPS = 256 * 1024, MAX_ECHANGES = 200, MAX_ENVOI = 10 * 1024 * 1024;
export type Connecter = (hote: string, port: number, adresse: string) => Duplex;
export const CONNECTER_SYSTEME: Connecter = (_h, port, adresse) => netConnect({ host: adresse, port });

export interface Echange {
  id: string; at: string; methode: string; url: string; code: number; ms: number; taille: number;
  /** en mémoire seulement (jamais sur le disque) */
  entetesReq: Record<string, string | string[] | undefined>; entetesRep: Record<string, string | string[] | undefined>;
  corpsReq: Buffer; corpsRep: Buffer; tronque: boolean;
  defauts: Defaut[]; certInvalide?: string; rejeu?: boolean; client?: string;
}
export interface LigneJournal {
  at: string; genre: 'echange' | 'refus' | 'rejeu' | 'proxy' | 'controle' | 'domaine' | 'appareil' | 'erreur';
  methode?: string; url?: string; code?: number; ms?: number; taille?: number;
  entetesReq?: Record<string, string>; entetesRep?: Record<string, string>; client?: string; raison?: string; texte?: string;
}
export interface Requete { methode: string; url: string; entetes: Record<string, string | string[] | undefined>; corps?: Buffer }

const SAUTS = new Set(['connection', 'proxy-connection', 'keep-alive', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);
let compteur = 0;
const nouvelId = () => `e${Date.now().toString(36)}${(compteur++).toString(36)}`;
const lisible = (t: string | string[] | undefined) => /text\/|json|xml|javascript/i.test(Array.isArray(t) ? t.join() : t ?? '');

/** La ligne de journal d'un échange : valeurs secrètes masquées, sans corps. */
export const ligneDe = (e: Echange, genre: 'echange' | 'rejeu' = 'echange'): LigneJournal => ({
  at: e.at, genre, methode: e.methode, url: masquerUrl(e.url), code: e.code, ms: e.ms, taille: e.taille,
  entetesReq: masquerEntetes(e.entetesReq), entetesRep: masquerEntetes(e.entetesRep), ...(e.client ? { client: e.client } : {}),
  ...(e.certInvalide ? { raison: `certificat invalide : ${e.certInvalide}` } : {}),
});

/**
 * Envoie une requête vers une cible DÉJÀ vérifiée (`p`, résultat de dansLaPortee) : la connexion va à l'adresse
 * vérifiée, jamais résolue une seconde fois. `vers` : la réponse est transmise au fur et à mesure (proxy).
 */
export async function envoyer(rq: Requete, p: Portee, o: { connecter?: Connecter; vers?: ServerResponse; delaiMs?: number } = {}): Promise<Echange> {
  if (!p.ok || !p.adresse) throw new Error(`refusé : hors de ta portée (${p.raison})`);
  const u = new URL(rq.url), https = u.protocol === 'https:', port = Number(u.port) || (https ? 443 : 80), hote = nu(u.hostname);
  const t0 = Date.now(), corpsReq = rq.corps ?? Buffer.alloc(0);
  const brut = (o.connecter ?? CONNECTER_SYSTEME)(hote, port, p.adresse);
  let s: Duplex = brut, certInvalide: string | undefined, certFin: string | undefined;
  try {
    if (https) {
      const t = tlsConnect({ socket: brut as Socket, ...(isIP(hote) ? {} : { servername: hote }), rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] });
      await Promise.race([once(t, 'secureConnect'), new Promise((_r, ko) => setTimeout(() => ko(new Error('délai dépassé (TLS)')), o.delaiMs ?? 30_000).unref())]);
      certFin = t.getPeerCertificate()?.valid_to;
      if (!t.authorized) {
        if (!p.prive) { t.destroy(); throw new Error(`certificat invalide sur un site public (${String(t.authorizationError)}) : refusé`); }
        certInvalide = String(t.authorizationError);
      }
      s = t;
    }
    const entetes: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(rq.entetes)) if (v !== undefined && !SAUTS.has(k.toLowerCase())) entetes[k.toLowerCase()] = v;
    entetes.host = u.host; entetes.connection = 'close';
    if (corpsReq.length) entetes['content-length'] = String(corpsReq.length); else delete entetes['content-length'];
    const req = request({ method: rq.methode, path: `${u.pathname}${u.search}`, headers: entetes, createConnection: () => s as Socket, timeout: o.delaiMs ?? 30_000 });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    const rep = await new Promise<IncomingMessage>((ok, ko) => { req.once('response', ok); req.once('error', ko); req.end(corpsReq); });
    const garde: Buffer[] = []; let taille = 0, gardee = 0;
    if (o.vers) { const h: Record<string, string | string[]> = {}; for (const [k, v] of Object.entries(rep.headers)) if (v !== undefined && !SAUTS.has(k)) h[k] = v; o.vers.writeHead(rep.statusCode ?? 502, h); }
    for await (const c of rep as AsyncIterable<Buffer>) {
      taille += c.length;
      if (gardee < MAX_CORPS) { const x = c.subarray(0, MAX_CORPS - gardee); garde.push(x); gardee += x.length; }
      if (o.vers && !o.vers.write(c)) await once(o.vers, 'drain');
    }
    o.vers?.end();
    const corpsRep = Buffer.concat(garde), e: Echange = {
      id: nouvelId(), at: new Date(t0).toISOString(), methode: rq.methode, url: u.toString(), code: rep.statusCode ?? 0, ms: Date.now() - t0, taille,
      entetesReq: { ...rq.entetes }, entetesRep: rep.headers, corpsReq: corpsReq.subarray(0, MAX_CORPS), corpsRep, tronque: taille > MAX_CORPS || corpsReq.length > MAX_CORPS, defauts: [],
      ...(certInvalide ? { certInvalide } : {}),
    };
    e.defauts = controler({ url: e.url, code: e.code, entetes: rep.headers, ...(lisible(rep.headers['content-type']) ? { corps: corpsRep.toString('utf8') } : {}), ...(certFin ? { certFin: new Date(certFin).toISOString() } : {}) });
    if (certInvalide) e.defauts.unshift({ code: 'certificat-invalide', niveau: 'moyen', titre: `Certificat invalide (${certInvalide})`, conseil: 'Donne à ce site un certificat valide (autorité de la maison ou Let\'s Encrypt) : sinon, tes appareils apprennent à ignorer les alertes.' });
    return e;
  } finally { s.destroy(); brut.destroy(); }
}

export interface OptionsProxy {
  port: number; hote?: string;
  /** la machine d'Odin elle-même peut s'en servir (vrai par défaut) */ boucleLocale?: boolean;
  portee(hote: string): Promise<Portee>;
  /** les adresses IP des appareils autorisés */
  appareils(): string[];
  autorite(): Autorite;
  noter(l: LigneJournal): void;
  surEchange?(e: Echange): void;
  surArret?(pourquoi: string): void;
  connecter?: Connecter;
}
interface Cible { hote: string; port: number; p: Portee }

/** Le proxy d'essai. `allumer(dureeMs)` rend le port d'écoute. */
export class ProxyAchille {
  readonly echanges: Echange[] = [];
  private srv?: Server; private interne?: Server; private minuterie?: ReturnType<typeof setTimeout>;
  private cibles = new WeakMap<object, Cible>();
  private sockets = new Set<Duplex>();
  jusqua?: number; port?: number;
  private o: OptionsProxy;
  constructor(o: OptionsProxy) { this.o = o; }
  get allume(): boolean { return Boolean(this.srv); }

  private garder(e: Echange): void { this.echanges.push(e); if (this.echanges.length > MAX_ECHANGES) this.echanges.splice(0, this.echanges.length - MAX_ECHANGES); this.o.noter(ligneDe(e)); this.o.surEchange?.(e); }
  private autorise(sock: { remoteAddress?: string }): string | undefined {
    const a = nu(sock.remoteAddress ?? '');
    return (this.o.boucleLocale !== false && (/^127\./.test(a) || a === '::1')) || this.o.appareils().map(nu).includes(a) ? a : undefined;
  }
  private refuser(res: ServerResponse, url: string, raison: string, client: string): void {
    this.o.noter({ at: new Date().toISOString(), genre: 'refus', url: masquerUrl(url), raison, client });
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }); res.end(`refusé : hors de ta portée (${raison})\n`);
  }

  private async traiter(req: IncomingMessage, res: ServerResponse, cible?: Cible): Promise<void> {
    const client = nu(req.socket.remoteAddress ?? (cible ? 'tunnel' : '?'));
    let url: string, p: Portee;
    try {
      if (cible) { url = `https://${cible.hote}${cible.port === 443 ? '' : `:${cible.port}`}${req.url?.startsWith('/') ? req.url : '/'}`; p = cible.p; }
      else {
        if (!/^http:\/\//i.test(req.url ?? '')) {
          if (req.url === '/achille.crt') { res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="achille.crt"' }); res.end(this.o.autorite().cert); return; }
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Proxy d\'essai d\'Achille : règle ton appareil pour passer par ici, puis ouvre l\'un de tes sites. Certificat : /achille.crt\n'); return;
        }
        url = req.url!; p = await this.o.portee(new URL(url).hostname);
        if (!p.ok) { this.refuser(res, url, p.raison, client); return; }
      }
      const morceaux: Buffer[] = []; let n = 0;
      for await (const c of req as AsyncIterable<Buffer>) { n += c.length; if (n > MAX_ENVOI) { res.writeHead(413); res.end('trop gros'); return; } morceaux.push(c); }
      const e = await envoyer({ methode: req.method ?? 'GET', url, entetes: req.headers, corps: Buffer.concat(morceaux) }, p, { connecter: this.o.connecter, vers: res });
      e.client = client; this.garder(e);
    } catch (err) {
      this.o.noter({ at: new Date().toISOString(), genre: 'erreur', url: masquerUrl(req.url ?? ''), raison: (err as Error).message.slice(0, 200), client });
      if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`Achille : ${(err as Error).message}\n`); } else res.destroy();
    }
  }

  /** Allume le proxy pour `dureeMs` (puis il s'éteint tout seul). Rend le port. */
  async allumer(dureeMs: number): Promise<number> {
    if (this.srv) { this.prolonger(dureeMs); return this.port!; }
    this.interne = createServer((req, res) => { void this.traiter(req, res, this.cibles.get(req.socket)); });
    const srv = createServer((req, res) => {
      const c = this.autorise(req.socket); if (!c) { this.o.noter({ at: new Date().toISOString(), genre: 'refus', raison: 'appareil non autorisé', client: nu(req.socket.remoteAddress ?? '') }); res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('refusé : appareil non autorisé\n'); return; }
      void this.traiter(req, res);
    });
    srv.on('connection', (s) => { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); });
    srv.on('connect', (req: IncomingMessage, sock: Duplex, head: Buffer) => { void this.tunnel(req, sock, head); });
    srv.listen(this.o.port, this.o.hote ?? '0.0.0.0');
    await once(srv, 'listening');
    this.srv = srv; this.port = (srv.address() as { port: number }).port;
    this.o.noter({ at: new Date().toISOString(), genre: 'proxy', texte: `proxy allumé sur le port ${this.port}` });
    this.prolonger(dureeMs);
    return this.port;
  }
  private prolonger(dureeMs: number): void {
    if (this.minuterie) clearTimeout(this.minuterie);
    this.jusqua = Date.now() + dureeMs;
    this.minuterie = setTimeout(() => this.eteindre('délai écoulé'), dureeMs); this.minuterie.unref?.();
  }
  private async tunnel(req: IncomingMessage, sock: Duplex, head: Buffer): Promise<void> {
    sock.on('error', () => undefined);
    const client = this.autorise(req.socket);
    const [, h6, h4, ps] = /^(?:\[([^\]]+)\]|([^:]+)):(\d{1,5})$/.exec(req.url ?? '') ?? [];
    const hote = nu(h6 ?? h4 ?? ''), port = Number(ps);
    const non = (raison: string, texte: string) => { this.o.noter({ at: new Date().toISOString(), genre: 'refus', url: `https://${hote || '?'}:${port || '?'}`, raison, client: client ?? nu(req.socket.remoteAddress ?? '') }); sock.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${texte}\n`); };
    if (!client) return non('appareil non autorisé', 'refusé : appareil non autorisé');
    if (!hote || !port || port > 65535) return non('cible illisible', 'refusé : cible illisible');
    const p = await this.o.portee(hote);
    if (!p.ok) return non(p.raison, 'refusé : hors de ta portée');
    let feuille: { cert: string; key: string };
    try { feuille = this.o.autorite().pour(hote); } catch (e) { return non((e as Error).message, `refusé : ${(e as Error).message}`); }
    this.sockets.add(sock); sock.on('close', () => this.sockets.delete(sock));
    sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) sock.unshift(head);
    const t = new TLSSocket(sock as Socket, { isServer: true, cert: feuille.cert, key: feuille.key, ALPNProtocols: ['http/1.1'] });
    t.on('error', () => undefined);
    this.cibles.set(t, { hote, port, p });
    this.interne!.emit('connection', t);
  }
  eteindre(pourquoi = 'à la demande'): void {
    if (!this.srv) return;
    if (this.minuterie) clearTimeout(this.minuterie);
    this.srv.close(); this.interne?.close();
    for (const s of this.sockets) s.destroy();
    this.sockets.clear(); this.srv = undefined; this.interne = undefined; this.jusqua = undefined; this.minuterie = undefined;
    this.o.noter({ at: new Date().toISOString(), genre: 'proxy', texte: `proxy éteint (${pourquoi})` });
    this.o.surArret?.(pourquoi);
  }
}
