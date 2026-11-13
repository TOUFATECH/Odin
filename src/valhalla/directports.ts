// Ports directs par appli — « chaque appli sur son port ». http://IP:<port> ouvre directement la page d'une appli
// d'Odin : c'est la même interface, servie sur un port de plus, avec la même connexion exigée (un port direct ne
// donne jamais d'accès sans session : ni clé d'API, ni liens publics, ni création de compte).
//   - Le port se règle (actions de Thermopyles, API /api/ports, Réglages → Ports) ; sans numéro, Odin en propose un.
//   - Refus clairs : port déjà pris (et par qui), gardé par le plan (ports.ts), sous 1024 sans les droits, hors bornes.
//   - Un port direct n'écoute d'abord que sur cette machine. L'ouvrir sur le réseau est une action grave (ton accord) :
//     Odin écoute alors là où son interface écoute, et Cerbère ouvre le pare-feu de la machine. Le refermer ou le
//     retirer enlève la règle. Jamais sur la box (Internet) depuis ici ; jamais sur le réseau tant qu'Odin est réglé
//     sur « cette machine seulement ».
//   - Le changement s'applique tout de suite, sans redémarrer Odin, et il est gardé (valhalla/ports-directs.json).
// Une appli qui a son propre service web (Vénus : Venus sur 8096) garde ce port-là : c'est son service qui y répond,
// Odin ne s'y met pas ; sa page dans Odin peut recevoir un autre port direct, comme les autres.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { lanAddresses } from '../web/access.ts';
import { engine } from './modules/naglfar.ts';
import { holderOf as hostHolder, listeners, type Listener } from './hostports.ts';
import { APPS_RANGE, DIRECT_RANGE, SERVICES_RANGE, WEB, directRefusal, planOf, portsOf, setDirectPorts, suggestDirect, type Proto } from './ports.ts';
import type { Valhalla } from './service.ts';
import type { Action, ActionResult, ModCtx, Module, Section } from './types.ts';

export type Access = 'local' | 'lan' | 'wan';
/** Ce qui est gardé pour une appli : son port, et s'il est ouvert sur le réseau (avec ton accord). */
export interface Direct { port: number; reseau?: boolean; depuis?: string }
export type Etat = 'écoute' | 'pris' | 'fermé';
/** Un port direct tel qu'il est vraiment sur la machine. */
export interface DirectStatus { port: number; etat: Etat; /** ouvert sur le réseau (sinon : cette machine seulement) */ reseau: boolean; /** là où Odin écoute */ sur?: string; /** qui tient le port quand il est pris */ par?: string; /** pourquoi il n'écoute pas */ pourquoi?: string; depuis?: string }

export const directFile = (home: string) => join(home, 'valhalla', 'ports-directs.json');
const ID = /^[a-z0-9_-]{2,40}$/;
function load(home: string): Map<string, Direct> {
  const m = new Map<string, Direct>(), seen = new Set<number>();
  try {
    const j = JSON.parse(readFileSync(directFile(home), 'utf8')) as { applis?: Record<string, Direct> };
    for (const [k, v] of Object.entries(j.applis ?? {})) {
      if (!ID.test(k) || !v || !Number.isInteger(v.port) || v.port < 1 || v.port > 65535 || seen.has(v.port)) continue;
      seen.add(v.port); m.set(k, { port: v.port, ...(v.reseau === true ? { reseau: true } : {}), ...(typeof v.depuis === 'string' ? { depuis: v.depuis.slice(0, 40) } : {}) });
    }
  } catch { /* pas encore de port direct */ }
  return m;
}
function save(home: string, m: Map<string, Direct>): void {
  const f = directFile(home), tmp = `${f}.tmp`; mkdirSync(dirname(f), { recursive: true });
  writeFileSync(tmp, JSON.stringify({ applis: Object.fromEntries(m) }, null, 2), { mode: 0o600 }); renameSync(tmp, f);
}

// ---------------- Qui tient un port (machine : hostports.ts ; applis installées : Argo) ----------------
/** L'appli installée (Argo) qui publie ce port, s'il y en a une. */
function containerOn(port: number): string | undefined {
  try { return engine().ps().find((c) => c.spec.ports.some((p) => p.host === port))?.spec.name; } catch { return undefined; }
}
/** Qui tient ce port ? « l'appli installée « web » (Argo) », « « nginx » (programme n° 812) » ; rien quand la machine ne le dit pas. */
export async function holderOf(port: number, proto: Proto = 'tcp', l?: Listener[]): Promise<string | undefined> {
  const c = containerOn(port); return c ? `l'appli installée « ${c} » (Argo)` : hostHolder(port, proto, l);
}

// ---------------- Le gardien des ports directs (créé par l'interface web, qui lui confie ses connexions) ----------------
export interface DirectOpts {
  /** dossier d'Odin (~/.odin) */
  home: string;
  /** port de l'interface d'Odin */
  web: number;
  /** là où l'interface écoute pour le réseau (« :: », « 0.0.0.0 ») ; ne sert pas en accès « cette machine » */
  host: string;
  /** la boucle locale : un port direct qui n'est pas ouvert sur le réseau n'écoute que là */
  loopback?: string;
  access: Access;
  https?: boolean;
  /** remet une connexion entrante au serveur de l'interface : mêmes règles, même chiffrement, même connexion exigée */
  attach(sock: Socket): void;
  log?(text: string): void;
}
interface Open { srv: Server; port: number; host: string; socks: Set<Socket> }
/** Une connexion se reconnaît à ses deux bouts (les mêmes pour la connexion chiffrée et pour celle qui la porte). */
const connKey = (x: { remoteAddress?: string; remotePort?: number; localPort?: number }) => `${x.remoteAddress}|${x.remotePort}|${x.localPort}`;
/** Pourquoi un port n'écoute pas : pris (et par qui), ou refusé par la machine ; `conseil` dit quoi faire. */
interface Down { pris: boolean; par?: string; pourquoi: string; conseil?: string }
let current: DirectPorts | undefined;
/** Le gardien en marche (rien tant que l'interface web d'Odin n'est pas démarrée). */
export const directs = (): DirectPorts | undefined => current;

export class DirectPorts {
  readonly o: DirectOpts;
  private entries = new Map<string, Direct>();
  private open = new Map<string, Open>();
  private down = new Map<string, Down>();
  /** Les connexions arrivées par un port direct, et l'appli de ce port : elles gardent ce statut jusqu'à leur fermeture. */
  private conns = new Map<string, string>();
  private timer?: ReturnType<typeof setInterval>;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(o: DirectOpts) { this.o = o; }

  private get loop(): string { return this.o.loopback ?? '127.0.0.1'; }
  /** Une opération à la fois : deux clics rapprochés ne se marchent pas dessus. */
  private lock<T>(f: () => Promise<T>): Promise<T> { const r = this.queue.then(f, f); this.queue = r.catch(() => undefined); return r; }
  private sync(): void { setDirectPorts(Object.fromEntries([...this.entries].map(([k, v]) => [k, v.port]))); save(this.o.home, this.entries); }
  private listen(app: string, port: number, host: string): Promise<Open> {
    return new Promise((ok, ko) => {
      const socks = new Set<Socket>();
      const srv = createServer((sock) => {
        const k = connKey(sock); this.conns.set(k, app); socks.add(sock);
        sock.once('close', () => { this.conns.delete(k); socks.delete(sock); });
        sock.on('error', () => { /* visiteur parti */ });
        try { this.o.attach(sock); } catch { sock.destroy(); }
      });
      srv.once('error', ko);
      srv.listen(port, host, () => { srv.removeListener('error', ko); srv.on('error', () => { /* rien à faire : l'écoute est en place */ }); ok({ srv, port, host, socks }); });
    });
  }
  /**
   * Ferme une écoute. Les connexions déjà ouvertes par ce port sont coupées elles aussi : tout de suite à l'arrêt
   * d'Odin, sinon deux secondes plus tard (le temps que la réponse à « change ce port », demandée par ce port
   * même, arrive). D'ici là, elles restent traitées comme des connexions de port direct.
   */
  private shut(x: Open | undefined, now = false): void {
    if (!x) return;
    try { x.srv.close(); } catch { /* déjà fermé */ }
    const kill = () => { for (const sock of x.socks) sock.destroy(); };
    if (now) kill(); else setTimeout(kill, 2000).unref?.();
  }
  private async why(port: number, e: unknown): Promise<Down> {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') { const par = await holderOf(port); return { pris: true, par, pourquoi: `le port ${port} est déjà pris par ${par ?? 'un autre programme'}`, conseil: 'choisis-en un autre, ou arrête ce programme' }; }
    if (code === 'EACCES') return port < 1024 ? { pris: false, pourquoi: `le port ${port} est sous 1024 et demande les droits d'administrateur`, conseil: 'choisis un port à partir de 1024, ou lance Odin en administrateur' } : { pris: false, pourquoi: `la machine refuse d'ouvrir le port ${port} (droits manquants)`, conseil: 'choisis-en un autre' };
    return { pris: false, pourquoi: `le port ${port} ne s'ouvre pas (${(e as Error).message})`, conseil: 'choisis-en un autre' };
  }
  private hostOf(e: Direct): string { return e.reseau && this.o.access !== 'local' ? this.o.host : this.loop; }
  /** Met à l'écoute le port gardé d'une appli (au démarrage, puis à chaque nouvel essai tant qu'il est pris). */
  private async bring(app: string): Promise<void> {
    const e = this.entries.get(app); if (!e || this.open.has(app)) return;
    const no = directRefusal(e.port, app, { web: this.o.web });
    if (no) { this.down.set(app, { pris: false, pourquoi: no }); return; }
    try { this.open.set(app, await this.listen(app, e.port, this.hostOf(e))); this.down.delete(app); }
    catch (err) { const w = await this.why(e.port, err), was = this.down.get(app); this.down.set(app, w); if (was?.pourquoi !== w.pourquoi) this.o.log?.(`port direct de ${app} : ${w.pourquoi}`); }
  }

  /** Relit les ports gardés et les met à l'écoute. Un port pris par un autre programme est retenté toutes les 30 secondes. */
  async start(): Promise<void> {
    this.entries = load(this.o.home);
    setDirectPorts(Object.fromEntries([...this.entries].map(([k, v]) => [k, v.port])));
    for (const app of this.entries.keys()) await this.bring(app);
    this.timer = setInterval(() => { void this.retry(); }, 30_000); this.timer.unref?.();
    current = this;
  }
  /** Réessaie les ports qui n'écoutent pas (pris par un autre programme au démarrage, par exemple). */
  retry(): Promise<void> { return this.lock(async () => { for (const app of this.entries.keys()) await this.bring(app); }); }
  stop(): void {
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    for (const x of this.open.values()) this.shut(x, true);
    this.open.clear();
    if (current === this) { current = undefined; setDirectPorts({}); }
  }

  /** L'appli dont le port direct a reçu cette connexion (rien : elle est arrivée par l'interface d'Odin elle-même). */
  appOf(sock: { remoteAddress?: string; remotePort?: number; localPort?: number } | undefined): string | undefined {
    return sock && this.conns.size ? this.conns.get(connKey(sock)) : undefined;
  }
  status(app: string): DirectStatus | undefined {
    const e = this.entries.get(app); if (!e) return undefined;
    const x = this.open.get(app), d = this.down.get(app);
    return { port: e.port, etat: x ? 'écoute' : d?.pris ? 'pris' : 'fermé', reseau: Boolean(x && e.reseau && this.o.access !== 'local'), ...(x ? { sur: x.host } : {}), ...(!x && d?.par ? { par: d.par } : {}), ...(!x && d ? { pourquoi: d.pourquoi } : {}), ...(e.depuis ? { depuis: e.depuis } : {}) };
  }
  /** Tu avais ouvert ce port sur le réseau (il ne l'est vraiment que si l'interface d'Odin l'est aussi). */
  wanted(app: string): boolean { return Boolean(this.entries.get(app)?.reseau); }
  all(): Record<string, DirectStatus> { return Object.fromEntries([...this.entries.keys()].map((k) => [k, this.status(k)!])); }
  /** Le premier port libre proposé (plage des ports directs), sans compter ce qui écoute déjà sur la machine. */
  async suggest(): Promise<number | undefined> { return suggestDirect((await listeners()).map((x) => x.port), this.o.web); }

  /**
   * Donne (ou change) le port direct d'une appli. Le nouveau port s'ouvre d'abord, sur cette machine seulement ;
   * l'ancien ne se ferme qu'ensuite. Lève une erreur claire si le plan ou la machine refuse (rien n'a alors changé).
   */
  set(app: string, port: number, o: { name?: (id: string) => string; now?: Date } = {}): Promise<{ avant?: Direct; etat: DirectStatus; meme: boolean }> {
    return this.lock(async () => {
      if (!ID.test(app)) throw new Error('appli inconnue');
      const no = directRefusal(port, app, { web: this.o.web, name: o.name }); if (no) throw new Error(no);
      const avant = this.entries.get(app), old = this.open.get(app);
      if (avant?.port === port && old) return { avant, etat: this.status(app)!, meme: true };
      let next: Open;
      try { next = await this.listen(app, port, this.loop); } catch (e) { const w = await this.why(port, e); throw new Error(`${w.pourquoi} : ${w.conseil}`); }
      this.shut(old);
      this.open.set(app, next); this.down.delete(app);
      this.entries.set(app, { port, depuis: (o.now ?? new Date()).toISOString() });
      this.sync();
      return { avant, etat: this.status(app)!, meme: false };
    });
  }
  /** Ouvre le port direct sur le réseau (là où l'interface d'Odin écoute), ou le ramène à cette machine seulement. */
  network(app: string, on: boolean): Promise<DirectStatus> {
    return this.lock(async () => {
      const e = this.entries.get(app); if (!e) throw new Error('cette appli n\'a pas de port direct : donne-lui d\'abord un port');
      if (on && this.o.access === 'local') throw new Error('Odin est réglé sur « cette machine seulement » (Réglages → Accès) : tant que son interface n\'est pas ouverte au réseau, un port direct ne peut pas l\'être');
      const host = on ? this.o.host : this.loop, cur = this.open.get(app);
      if (!cur || cur.host !== host) {
        this.shut(cur);
        this.open.delete(app);
        try { this.open.set(app, await this.listen(app, e.port, host)); this.down.delete(app); }
        catch (err) {
          // Rien ne change : l'ancienne écoute est remise (si le port vient d'être pris, il sera retenté).
          if (cur) { try { this.open.set(app, await this.listen(app, e.port, cur.host)); } catch { this.down.set(app, await this.why(e.port, err)); } }
          throw new Error((await this.why(e.port, err)).pourquoi);
        }
      }
      if (on) e.reseau = true; else delete e.reseau;
      this.sync();
      return this.status(app)!;
    });
  }
  /** Retire le port direct d'une appli : plus d'écoute, plus rien de gardé. Rend ce qu'il y avait. */
  remove(app: string): Promise<Direct | undefined> {
    return this.lock(async () => {
      const e = this.entries.get(app); if (!e) return undefined;
      this.shut(this.open.get(app));
      this.open.delete(app); this.down.delete(app); this.entries.delete(app); this.sync();
      return e;
    });
  }
}

// ---------------- Sur un port direct : ce qui est permis sans session, et la page servie ----------------
/** Sans session, un port direct ne sert que l'écran de connexion : la page, ses fichiers, et la connexion elle-même. Pur. */
export function directOpen(method: string, path: string): boolean {
  if (method === 'GET') return path === '/' || path === '/health' || /^\/(?:[\w-]+\.(?:js|png|svg|ico|webmanifest)|pages\/[a-z0-9-]+\.js|fonts\/[\w.-]+\.woff2)$/.test(path);
  return method === 'POST' && (path === '/api/account/login' || path === '/api/account/logout');
}
/** L'écran où mène le port direct d'une appli (Thot, Papyrus et Talos ont leur propre écran). Pur. */
export const directView = (app: string): string => ({ saga: 'brain', runes: 'runes', draupnir: 'flows' } as Record<string, string>)[app] ?? `app=${app}`;
const escHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** La page servie sur un port direct : la même interface, qui s'ouvre sur l'appli, avec son nom dans l'onglet. Pur. */
export function directPage(html: string, app: string, name = ''): string {
  if (!ID.test(app)) return html;
  return html.replace('<html lang="fr">', `<html lang="fr" data-direct="${directView(app)}">`).replace('<title>Odin</title>', `<title>${escHtml(name || app)} · Odin</title>`);
}

// ---------------- La vue d'ensemble (Réglages → Ports, page de l'appli, Thermopyles) ----------------
export interface ServicePort { port: number; proto: Proto; quoi: string; etat: Etat | 'inconnu'; par?: string; /** allumé seulement si tu le demandes */ facultatif?: boolean; /** une interface web à elle : c'est déjà son port direct */ web?: boolean; adresse?: string }
export interface AppPort {
  id: string; nom: string; famille: string;
  /** son port direct (rien : sa page est dans l'interface d'Odin) */
  port: number | null; etat: Etat; reseau: boolean; par?: string;
  /** la phrase à afficher telle quelle */
  note: string;
  /** ce que dit le plan pour elle, sans le port direct */
  plan: string;
  /** l'écran où mène son port direct (« app=<id> ») */
  vue: string;
  services: ServicePort[];
}
export interface Overview {
  ok: true;
  interface: { port: number; https: boolean; acces: Access; /** l'interface web n'est pas démarrée : rien ne peut écouter */ arretee?: boolean };
  plages: { directs: readonly [number, number]; installees: readonly [number, number]; services: readonly [number, number] };
  /** un port libre à proposer */
  propose: number | null;
  applis: AppPort[];
  installees: Array<{ nom: string; image: string; etat: string; ports: Array<{ port: number; vers: number; proto: Proto }> }>;
}
const tcpProbe = (host: string, port: number, ms = 700) => new Promise<boolean>((ok) => {
  const s = connect({ host, port }); const end = (v: boolean) => { s.destroy(); ok(v); };
  s.setTimeout(ms, () => end(false)); s.once('connect', () => end(true)); s.once('error', () => end(false));
});
function noteOf(nom: string, st: DirectStatus | undefined, web: number, access: Access, wanted: boolean): string {
  if (!st) return `Pas de port direct : sa page est dans l'interface d'Odin (port ${web}).`;
  if (st.etat === 'écoute') return st.reseau ? `Écoute sur le port ${st.port}, ouvert sur le réseau.` : `Écoute sur le port ${st.port}, depuis cette machine seulement${wanted && access === 'local' ? ' (Odin est réglé sur « cette machine »)' : ''}.`;
  if (st.etat === 'pris') return `Le port ${st.port} est pris par ${st.par ?? 'un autre programme'} : Odin le reprendra dès qu'il sera libre. En attendant, ${nom} reste dans l'interface (port ${web}).`;
  return `Le port ${st.port} est fermé${st.pourquoi ? ` : ${st.pourquoi}` : ''}.`;
}
/** Tous les ports des applis, tels qu'ils sont vraiment : port direct, ports de service du plan, applis installées. */
export async function overview(mods: Module[], o: { home?: string; adresses?: Record<string, string>; seulement?: string } = {}): Promise<Overview> {
  const g = directs(), web = g?.o.web ?? WEB, access = g?.o.access ?? 'local', l = await listeners();
  const kept = g ? undefined : (o.home ? load(o.home) : new Map<string, Direct>());
  const applis: AppPort[] = [];
  for (const m of mods) {
    if (o.seulement && m.id !== o.seulement) continue;
    const k = kept?.get(m.id), st: DirectStatus | undefined = g ? g.status(m.id) : k ? { port: k.port, etat: 'fermé', reseau: false, pourquoi: 'l\'interface web d\'Odin n\'est pas démarrée' } : undefined;
    const services: ServicePort[] = [], plan = portsOf(m.id);
    // L'adresse réglée pour le service web de l'appli (Venus : Réglages → Vénus) : elle vaut pour UN service, celui de
    // ce port-là (sinon le principal). On n'en montre que « http(s)://machine:port », jamais un identifiant qui y serait écrit.
    let u: URL | undefined; try { const x = new URL(o.adresses?.[m.id] ?? ''); if (/^https?:$/.test(x.protocol)) u = x; } catch { /* pas d'adresse réglée */ }
    const portU = u ? Number(u.port) || (u.protocol === 'https:' ? 443 : 80) : 0;
    const cible = u ? plan.find((p) => p.web && p.port === portU) ?? plan.find((p) => p.web && !p.optional) ?? plan.find((p) => p.web) : undefined;
    for (const p of plan) {
      const here = l.filter((x) => x.proto === p.proto && x.port === p.port);
      let etat: ServicePort['etat'] = 'inconnu', par: string | undefined, adresse: string | undefined;
      if (u && p === cible) { adresse = u.origin; etat = await tcpProbe(u.hostname.replace(/^\[|\]$/g, ''), portU) ? 'écoute' : 'fermé'; }
      else if (l.length) {
        // Tenu par Odin, ou par le programme prévu (Venus, la base) : il écoute. Tenu par un autre programme : pris.
        const mine = here.some((x) => x.pid === process.pid || x.pid === undefined), other = here.find((x) => x.pid !== undefined && x.pid !== process.pid);
        if (!here.length) etat = p.where === 'interne' ? 'inconnu' : 'fermé';
        else if (p.by || mine) etat = 'écoute';
        else { etat = 'pris'; par = other?.prog ? `« ${other.prog} » (programme n° ${other.pid})` : undefined; }
      }
      services.push({ port: p.port, proto: p.proto, quoi: p.what, etat, ...(par ? { par } : {}), ...(p.optional ? { facultatif: true } : {}), ...(p.web ? { web: true } : {}), ...(adresse ? { adresse } : {}) });
    }
    applis.push({ id: m.id, nom: m.name, famille: m.family, port: st?.port ?? null, etat: st?.etat ?? 'fermé', reseau: st?.reseau ?? false, ...(st?.par ? { par: st.par } : {}), note: noteOf(m.name, st, web, access, Boolean(g?.wanted(m.id))), plan: planOf(m.id), vue: directView(m.id), services });
  }
  let installees: Overview['installees'] = [];
  if (!o.seulement) { try { installees = engine().ps(true).map((c) => ({ nom: c.spec.name, image: c.spec.image, etat: c.state.status, ports: c.spec.ports.map((p) => ({ port: p.host, vers: p.inner, proto: p.proto })) })); } catch { /* moteur absent */ } }
  return {
    ok: true, interface: { port: web, https: Boolean(g?.o.https), acces: access, ...(g ? {} : { arretee: true }) },
    plages: { directs: DIRECT_RANGE, installees: APPS_RANGE, services: SERVICES_RANGE },
    propose: suggestDirect([...l.map((x) => x.port), ...installees.flatMap((c) => c.ports.map((p) => p.port))], web) ?? null, applis, installees,
  };
}

// ---------------- Les actions (dans Thermopyles) ----------------
export const DIRECT_MODULE = 'hlid';
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
/** L'appli désignée, par son identifiant ou par son nom affiché. */
export function findApp(mods: Module[], x: unknown): Module {
  const k = norm(s(x)); if (!k) throw new Error('dis de quelle appli il s\'agit (par exemple Vénus)');
  const m = mods.find((a) => a.id === k) ?? mods.find((a) => norm(a.name) === k) ?? (k.length >= 3 ? mods.find((a) => norm(a.name).startsWith(k)) : undefined);
  if (!m) throw new Error(`appli inconnue : « ${s(x).slice(0, 40)} » (donne son nom, par exemple Vénus)`);
  return m;
}
function need(): DirectPorts {
  const g = directs(); if (!g) throw new Error('l\'interface web d\'Odin n\'est pas démarrée : un port direct mène à cette interface, il n\'y a donc rien à ouvrir. Lance Odin avec son interface (« odin gateway »), puis recommence');
  return g;
}
const url = (g: DirectPorts, port: number, host: string) => `${g.o.https ? 'https' : 'http'}://${host}:${port}`;
const here = (g: DirectPorts) => (g.o.loopback === '::1' ? '[::1]' : g.o.loopback && g.o.loopback !== 'localhost' ? g.o.loopback : '127.0.0.1');
/** L'adresse à donner aux autres appareils : celle de la machine sur le réseau, si elle en a une. */
const fromNetwork = (g: DirectPorts, port: number) => { const ip = lanAddresses()[0]; return ip ? url(g, port, ip) : `${g.o.https ? 'https' : 'http'}://<adresse de la machine d'Odin>:${port}`; };
const whereTo = (g: DirectPorts) => (g.o.access === 'wan' ? 'ton réseau, et Internet si ta box ou ton hébergeur laisse passer ce port' : 'les appareils de ton réseau');

/** Cerbère ouvre le port dans le pare-feu de la machine (étape de l'action que tu as lancée : pas de manip à part). */
async function firewallOpen(ctx: ModCtx, port: number, nom: string): Promise<{ ok: boolean; text: string }> {
  const r = await ctx.call('garmr', 'ouvrir_port', { port, proto: 'tcp', pour: `page directe de ${nom}`, par: 'Thermopyles (port direct)' }, `ouvrir le port direct de ${nom} sur le réseau`, { interne: true }).catch((e) => ({ ok: false, text: (e as Error).message }));
  if (r.ok === false) return { ok: false, text: r.text.replace(/^Cerbère · Ouvrir un port : /, '') };
  return { ok: true, text: /déjà joignable/.test(r.text) ? 'La machine n\'a pas de pare-feu actif : rien d\'autre à ouvrir.' : `Cerbère a ouvert le port ${port} dans le pare-feu de la machine.` };
}
/** Cerbère retire la règle du pare-feu, s'il l'avait posée. */
async function firewallClose(ctx: ModCtx, port: number): Promise<string> {
  const l = await ctx.call('garmr', 'ports_ouverts', {}, undefined, { interne: true }).catch(() => undefined);
  const had = Array.isArray(l?.data) && (l!.data as Array<{ port: number; proto: string }>).some((x) => x.port === port && x.proto === 'tcp');
  if (!had) return '';
  const r = await ctx.call('garmr', 'fermer_port', { port, proto: 'tcp' }, 'fermer un port direct', { interne: true }).catch((e) => ({ ok: false, text: (e as Error).message }));
  return r.ok === false ? ` ⚠ Cerbère n'a pas pu retirer la règle du pare-feu (${r.text.replace(/^Cerbère · Fermer un port : /, '')}) : retire-la dans Cerbère → Ports ouverts par Odin.` : ' Cerbère a retiré la règle du pare-feu.';
}
/** Ouvre sur le réseau le port direct d'une appli : Odin écoute là où son interface écoute, puis Cerbère ouvre le pare-feu. Tout ou rien. */
async function openNetwork(ctx: ModCtx, g: DirectPorts, m: Module): Promise<string> {
  const st = await g.network(m.id, true);
  const fw = await firewallOpen(ctx, st.port, m.name);
  if (!fw.ok) { await g.network(m.id, false).catch(() => undefined); throw new Error(`le pare-feu de la machine a refusé d'ouvrir le port ${st.port} (${fw.text}) : rien n'est ouvert, ${m.name} reste joignable depuis cette machine seulement`); }
  return `🔓 Le port ${st.port} de ${m.name} est ouvert sur le réseau : ${fromNetwork(g, st.port)} ouvre directement sa page. ${fw.text} La connexion à Odin reste exigée.`;
}
const graveOpen = (ctx: ModCtx | undefined, i: Record<string, unknown>, port?: number): string => {
  const g = directs(); let nom = s(i.appli) || 'cette appli', p = port;
  try { if (ctx) { const m = findApp(ctx.modules(), i.appli); nom = m.name; p ??= g?.status(m.id)?.port; } } catch { /* nom inconnu : dit tel quel */ }
  return `ouvrir ${p ? `le port ${p}` : 'le port direct'} de ${nom} sur le réseau : sa page sera joignable depuis ${g ? whereTo(g) : 'les appareils de ton réseau'} (la connexion à Odin reste exigée), et le pare-feu de la machine laissera entrer ce port`;
};
const APPLI = { key: 'appli', label: 'Appli (son nom, par exemple Vénus)', kind: 'text' as const, required: true };

export const directActions: Action[] = [
  { id: 'ports_directs', label: 'Ports directs des applis', what: 'Chaque appli qui a son port à elle (http://IP:port ouvre directement sa page) : le port, s\'il écoute, s\'il est ouvert sur le réseau', read: true, words: ['ports directs', 'port direct des applis', 'ports directs des applis', 'quelles applis ont un port direct'], run: async (ctx) => {
    const v = await overview(ctx.modules(), { home: ctx.home }), l = v.applis.filter((a) => a.port !== null);
    return { text: `Interface d'Odin : port ${v.interface.port}${v.interface.arretee ? ' (interface arrêtée)' : ''}.\n${l.length ? l.map((a) => `- ${a.nom} : ${a.port} · ${a.etat}${a.etat === 'écoute' ? (a.reseau ? ' · ouvert sur le réseau' : ' · cette machine seulement') : a.par ? ` par ${a.par}` : ''}`).join('\n') : 'Aucune appli n\'a de port direct : elles sont toutes dans l\'interface d\'Odin.'}${v.propose ? `\nPort libre à proposer : ${v.propose}.` : ''}`, data: v };
  } },
  { id: 'port_direct', label: 'Donner un port direct à une appli', what: 'L\'appli répond sur son port à elle (http://IP:port ouvre directement sa page, avec ta connexion). Sans numéro, Odin en choisit un libre. D\'abord joignable depuis cette machine seulement ; « ouvrir sur le réseau » demande ton accord',
    params: [APPLI, { key: 'port', label: 'Port (vide : Odin en choisit un libre)', kind: 'number' }, { key: 'reseau', label: 'L\'ouvrir aussi sur le réseau', kind: 'boolean', default: false }],
    words: ['donne un port direct', 'donner un port direct', 'change le port direct', 'nouveau port direct'],
    grave: (i, ctx) => (i.reseau === true || i.reseau === 'true' ? graveOpen(ctx, i, Number(i.port) || undefined) : undefined),
    run: async (ctx, i) => {
      const g = need(), m = findApp(ctx.modules(), i.appli), name = (id: string) => ctx.modules().find((x) => x.id === id)?.name ?? id;
      const asked = s(i.port).trim(), port = asked ? Number(asked) : await g.suggest();
      if (port === undefined) throw new Error(`plus aucun port libre entre ${DIRECT_RANGE[0]} et ${DIRECT_RANGE[1]} : donne un numéro de port`);
      const r = await g.set(m.id, port, { name, now: ctx.now() });
      let text = r.meme ? `${m.name} est déjà sur le port ${port}.` : `🚪 ${m.name} ${r.avant ? `passe du port ${r.avant.port} au port ${port} (l'ancien est fermé)` : `a maintenant son port : ${port}`}. Depuis cette machine, ${url(g, port, here(g))} ouvre directement sa page (avec ta connexion habituelle).`;
      // L'ancien port est fermé : si Cerbère lui avait ouvert le pare-feu, la règle part avec lui.
      if (!r.meme && r.avant) text += await firewallClose(ctx, r.avant.port);
      if (i.reseau === true || i.reseau === 'true') text += `\n${await openNetwork(ctx, g, m)}`;
      else if (!r.meme) text += r.avant?.reseau ? ' Le nouveau port n\'est joignable que depuis cette machine : rouvre-le sur le réseau si tu le veux.' : ' Pour les autres appareils : « Ouvrir sur le réseau ».';
      return { text, data: { appli: m.id, port, avant: r.avant ?? null } };
    },
    undo: (_i, r) => { const d = r.data as { appli: string; avant: Direct | null } | undefined; return d ? (d.avant ? { action: 'port_direct', input: { appli: d.appli, port: d.avant.port }, label: `port direct remis à ${d.avant.port}` } : { action: 'retirer_port_direct', input: { appli: d.appli }, label: 'port direct retiré' }) : undefined; } },
  { id: 'ouvrir_port_direct', label: 'Ouvrir un port direct sur le réseau', what: 'Les autres appareils peuvent ouvrir la page de l\'appli sur son port : Odin écoute là où son interface écoute, et Cerbère ouvre le pare-feu de la machine', params: [APPLI], quick: false,
    words: ['ouvre le port direct', 'ouvrir le port direct', 'ouvre sur le reseau le port direct'],
    grave: (i, ctx) => graveOpen(ctx, i),
    run: async (ctx, i) => { const g = need(), m = findApp(ctx.modules(), i.appli); return { text: await openNetwork(ctx, g, m), data: { appli: m.id } }; },
    undo: (_i, r) => { const d = r.data as { appli: string } | undefined; return d ? { action: 'fermer_port_direct', input: { appli: d.appli }, label: 'port direct refermé au réseau' } : undefined; } },
  { id: 'fermer_port_direct', label: 'Fermer un port direct au réseau', what: 'Le port de l\'appli n\'est plus joignable que depuis cette machine, et la règle du pare-feu est retirée', params: [APPLI], quick: false,
    words: ['ferme le port direct', 'fermer le port direct', 'referme le port direct'],
    run: async (ctx, i) => {
      const g = need(), m = findApp(ctx.modules(), i.appli), st = await g.network(m.id, false);
      return { text: `🔒 Le port ${st.port} de ${m.name} n'est plus ouvert sur le réseau : il reste joignable depuis cette machine.${await firewallClose(ctx, st.port)}`, data: { appli: m.id } };
    } },
  { id: 'retirer_port_direct', label: 'Retirer le port direct d\'une appli', what: 'L\'appli n\'a plus de port à elle (sa page reste dans l\'interface d\'Odin) ; la règle du pare-feu est retirée', params: [APPLI], quick: false,
    words: ['retire le port direct', 'retirer le port direct', 'supprime le port direct', 'enleve le port direct'],
    run: async (ctx, i) => {
      const g = need(), m = findApp(ctx.modules(), i.appli), had = await g.remove(m.id);
      if (!had) return { text: `${m.name} n'a pas de port direct.`, data: { appli: m.id, avant: null } };
      return { text: `🔒 ${m.name} n'a plus de port direct (le port ${had.port} est fermé) : sa page reste dans l'interface d'Odin, port ${g.o.web}.${await firewallClose(ctx, had.port)}`, data: { appli: m.id, avant: had } };
    },
    undo: (_i, r) => { const d = r.data as { appli: string; avant: Direct | null } | undefined; return d?.avant ? { action: 'port_direct', input: { appli: d.appli, port: d.avant.port }, label: `port direct ${d.avant.port} remis` } : undefined; } },
];

/** La section « Ports directs des applis » de la page de Thermopyles (les applis qui en ont un). */
export async function directSection(ctx: ModCtx): Promise<Section> {
  const v = await overview(ctx.modules(), { home: ctx.home }), l = v.applis.filter((a) => a.port !== null);
  return { kind: 'table', title: 'Ports directs des applis', columns: ['Appli', 'Port', 'État', 'Joignable'], empty: 'Aucune appli n\'a de port direct : toutes passent par l\'interface d\'Odin. Donne-en un ici (« Donner un port direct à une appli ») ou dans Réglages → Ports.',
    rows: l.map((a) => ({ cells: [a.nom, String(a.port), a.etat === 'pris' ? `pris par ${a.par ?? 'un autre programme'}` : a.etat, a.etat !== 'écoute' ? '—' : a.reseau ? 'depuis le réseau' : 'cette machine seulement'], tone: a.etat === 'écoute' ? (a.reseau ? 'attention' as const : 'bon' as const) : 'mauvais' as const,
      actions: [...(a.etat === 'écoute' ? [a.reseau ? { action: 'fermer_port_direct', label: 'Fermer au réseau', input: { appli: a.nom } } : { action: 'ouvrir_port_direct', label: 'Ouvrir sur le réseau', input: { appli: a.nom } }] : []), { action: 'retirer_port_direct', label: 'Retirer', input: { appli: a.nom } }] })) };
}
/** Surveillance : un port direct pris par un autre programme est retenté, et signalé s'il le reste. */
export async function directWatch(ctx: ModCtx): Promise<void> {
  const g = directs(); if (!g) return;
  await g.retry();
  for (const [app, st] of Object.entries(g.all())) if (st.etat !== 'écoute') {
    const nom = ctx.modules().find((m) => m.id === app)?.name ?? app;
    ctx.alert({ level: 'moyenne', title: `Le port direct de ${nom} (${st.port}) ne répond pas`, detail: st.pourquoi ?? 'il n\'écoute pas', key: `port-direct:${app}:${st.port}`, steps: ['La page de l\'appli reste joignable par l\'interface d\'Odin.', 'Arrête le programme qui tient ce port : Odin le reprend tout seul en moins d\'une minute.', 'Ou choisis un autre port dans Réglages → Ports.'] });
  }
}

// ---------------- L'API web : GET et POST /api/ports ----------------
/** GET /api/ports : la vue d'ensemble ; avec ?appli=<identifiant ou nom>, une seule appli. */
export async function portsGet(v: Valhalla | undefined, q: URLSearchParams, o: { adresses?: Record<string, string> } = {}): Promise<unknown> {
  if (!v) return { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' };
  const one = q.get('appli');
  if (one === null) return overview(v.modules(), { home: v.ctx(DIRECT_MODULE).home, adresses: o.adresses });
  let m: Module; try { m = findApp(v.modules(), one); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const r = await overview(v.modules(), { home: v.ctx(DIRECT_MODULE).home, adresses: o.adresses, seulement: m.id });
  return { ok: true, interface: r.interface, propose: r.propose, appli: r.applis[0] };
}
const FAIRE: Record<string, string> = { regler: 'port_direct', ouvrir: 'ouvrir_port_direct', fermer: 'fermer_port_direct', retirer: 'retirer_port_direct' };
/**
 * POST /api/ports { appli, faire: 'regler' | 'ouvrir' | 'fermer' | 'retirer', port?, reseau?, confirm? } : les mêmes
 * actions que Thermopyles (mêmes refus, même accord pour ce qui est grave), et l'état de l'appli juste après.
 */
export async function portsPost(v: Valhalla | undefined, b: Record<string, unknown>, o: { adresses?: Record<string, string> } = {}): Promise<unknown> {
  if (!v) return { ok: false, error: 'Les applis d\'Odin ne sont pas démarrées.' };
  const id = FAIRE[s(b.faire)], f = id ? v.action(DIRECT_MODULE, id) : undefined;
  if (!f) return { ok: false, error: 'demande inconnue : faire = regler, ouvrir, fermer ou retirer' };
  let m: Module; try { m = findApp(v.modules(), b.appli); } catch (e) { return { ok: false, error: (e as Error).message }; }
  const input: Record<string, unknown> = { appli: m.id, ...(id === 'port_direct' ? { port: b.port === null || b.port === undefined ? '' : b.port, reseau: b.reseau === true } : {}) };
  const why = f.a.grave?.(input, v.ctx(f.m.id));
  if (why && b.confirm !== true) return { ok: false, confirm: `Confirmer : ${why} ?` };
  const r = await v.act(f.m.id, f.a.id, input);
  const after = await overview(v.modules(), { home: v.ctx(DIRECT_MODULE).home, adresses: o.adresses, seulement: m.id });
  const text = r.ok === false ? r.text.replace(/^[^:]+ · [^:]+ : /, '') : r.text;
  return { ok: r.ok !== false, text, ...(r.ok === false ? { error: text } : {}), appli: after.applis[0], interface: after.interface };
}
