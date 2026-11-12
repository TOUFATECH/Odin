// Valgrind — le proxy inverse d'Odin : tes services de la maison sous un vrai nom (nas.exemple.fr →
// 192.168.1.10:5000), en HTTPS avec des certificats Let's Encrypt obtenus et renouvelés tout seuls, ou
// auto-signés pour la maison. Passage forcé en HTTPS, HSTS, WebSocket, accès par adresses, mot de passe,
// redirections, flux TCP, journal et statistiques, graphe. Fonctions reprises (réécrites) de Nginx Proxy
// Manager, Traefik et Caddy. (Valgrind : la grille sacrée devant le Valhalla, que seuls les dignes passent.)
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync, chmodSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { X509Certificate, randomBytes } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import type { GraphDetail, GraphEdge, GraphNode, ModCtx, Module, Param, Tone } from '../types.ts';
import { ProxyServer, hashPassword, inNet, route, type AccessLog, type Host, type Redirect, type Stream } from '../valgrind/proxy.ts';
import { LETS_ENCRYPT, LETS_ENCRYPT_STAGING, newKey, obtain } from '../valgrind/acme.ts';
import { issueCertificate } from '../../web/access.ts';
import { closePorts, openPorts } from '../upnp.ts';
import { check as varCheck, portal as varPortal, portalDomain, portalUrl } from './var.ts';

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
let srv: ProxyServer | undefined, appCtx: ModCtx | undefined;
const challenges = new Map<string, string>(), certCache = new Map<string, { cert: string; key: string; at: number }>();
let banned = new Set<string>();
const ring: AccessLog[] = []; const RING = 20_000;
const authFails = new Map<string, number[]>();

const hosts = (ctx: ModCtx): Host[] => (ctx.settings.hosts as Host[] | undefined) ?? [];
const redirects = (ctx: ModCtx): Redirect[] => (ctx.settings.redirects as Redirect[] | undefined) ?? [];
const streams = (ctx: ModCtx): Stream[] => (ctx.settings.streams as Stream[] | undefined) ?? [];
const ports = (ctx: ModCtx) => ({ http: 80, https: 443, ...(ctx.settings.ports as { http?: number; https?: number } | undefined) });
const DOMAIN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^[a-z0-9-]+\.(local|lan|home|maison|internal)$/;
const lan = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal && /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(i.address))?.address;
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------------- Certificats ----------------
const certDir = (ctx: ModCtx) => join(ctx.dir, 'certs');
const safe = (d: string) => d.replace(/^\*\./, '_joker.').replace(/[^a-z0-9._-]/gi, '_');
function writeCert(ctx: ModCtx, name: string, c: { cert: string; key: string }): void {
  mkdirSync(certDir(ctx), { recursive: true });
  writeFileSync(join(certDir(ctx), `${safe(name)}.pem`), c.cert);
  const kf = join(certDir(ctx), `${safe(name)}-key.pem`); writeFileSync(kf, c.key, { mode: 0o600 }); try { chmodSync(kf, 0o600); } catch { /* Windows */ }
  certCache.set(name, { ...c, at: Date.now() });
}
function readCert(ctx: ModCtx, name: string): { cert: string; key: string } | undefined {
  const hit = certCache.get(name); if (hit && Date.now() - hit.at < 60_000) return hit;
  try { const c = { cert: readFileSync(join(certDir(ctx), `${safe(name)}.pem`), 'utf8'), key: readFileSync(join(certDir(ctx), `${safe(name)}-key.pem`), 'utf8') }; certCache.set(name, { ...c, at: Date.now() }); return c; } catch { return undefined; }
}
/** Ce que dit un certificat : émetteur, fin de validité, jours restants. */
export function certInfo(pem: string, now = Date.now()): { issuer: string; notAfter: string; days: number; names: string[] } {
  const x = new X509Certificate(pem);
  return { issuer: /O=([^\n,]+)/.exec(x.issuer)?.[1] ?? /CN=([^\n,]+)/.exec(x.issuer)?.[1] ?? x.issuer, notAfter: new Date(x.validTo).toISOString().slice(0, 10), days: Math.floor((Date.parse(x.validTo) - now) / 86400_000), names: (x.subjectAltName ?? '').split(',').map((v) => v.trim().replace(/^DNS:/, '')).filter(Boolean) };
}
function selfSigned(ctx: ModCtx, h: Host): void { const r = issueCertificate(h.domains[0].replace(/^\*\./, ''), h.domains, [], { days: 825 }); writeCert(ctx, h.domains[0], r); }
/** Le certificat d'un nom : celui du site (exact ou joker), sinon rien (le certificat par défaut d'Odin répond). */
function certFor(ctx: ModCtx, name: string) { if (name === portalDomain()) return readCert(ctx, name); const h = route(hosts(ctx), name); return h && h.tls !== 'aucun' ? readCert(ctx, h.domains[0]) : undefined; }
function defaultCert(ctx: ModCtx) { let c = readCert(ctx, '_odin'); if (!c) { const r = issueCertificate('Odin', ['odin.local'], [], { days: 825 }); writeCert(ctx, '_odin', r); c = r; } return c; }
async function letsEncrypt(ctx: ModCtx, h: Host): Promise<string> {
  if (!srv?.httpServer || ports(ctx).http !== 80 && ctx.settings.acmeAnyPort !== true) throw new Error('Let\'s Encrypt vérifie par le port 80 : démarre le proxy sur le port 80 (et ouvre-le sur ta box vers cette machine)');
  if (h.domains.some((d) => d.startsWith('*.'))) throw new Error('un nom joker (*.exemple.fr) demande une vérification par le DNS du domaine : pas encore possible ici, prends un certificat auto-signé ou nomme chaque site');
  if (h.domains.some((d) => /\.(local|lan|home|maison|internal)$/.test(d))) throw new Error('Let\'s Encrypt ne signe que des noms publics (pas .maison, .local…) : prends un certificat auto-signé pour la maison');
  const accFile = join(ctx.dir, 'acme-compte.pem');
  if (!existsSync(accFile)) { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(accFile, newKey(), { mode: 0o600 }); }
  const directory = s(ctx.settings.acmeDirectory) || (ctx.settings.acmeStaging === true ? LETS_ENCRYPT_STAGING : LETS_ENCRYPT);
  const r = await obtain(h.domains, { directory, accountKey: readFileSync(accFile, 'utf8'), fetch: ctx.fetch, challenge: (t, a) => { if (a) challenges.set(t, a); else challenges.delete(t); }, pollMs: Number(ctx.settings.acmePollMs ?? 2000), log: (l) => ctx.emit('acme', { ligne: l }) });
  try { createSecureContext({ cert: r.cert, key: r.key }); } catch { throw new Error('le certificat reçu ne va pas avec sa clé : rien n\'a été changé'); }
  writeCert(ctx, h.domains[0], r);
  const i = certInfo(r.cert);
  return `🔐 Certificat ${i.issuer} pour ${h.domains.join(', ')}, valable jusqu'au ${i.notAfter} (renouvelé tout seul 30 jours avant).`;
}

// ---------------- Journal ----------------
function record(ctx: ModCtx, e: AccessLog): void {
  ring.push(e); if (ring.length > RING) ring.splice(0, ring.length - RING);
  try { const d = join(ctx.dir, 'journal'); mkdirSync(d, { recursive: true }); appendFileSync(join(d, `${day(e.t)}.jsonl`), `${JSON.stringify(e)}\n`); } catch { /* disque plein */ }
  // Les robots qui cherchent des failles (/.env, /wp-login.php…) : signalés à Ullr.
  if (/^\/(\.env|\.git\/|wp-login\.php|xmlrpc\.php|phpmyadmin|admin\.php|\.aws\/|cgi-bin\/|vendor\/phpunit|boaform|HNAP1)/i.test(e.path) && e.status >= 400) ctx.emit('scan', { ip: e.ip, chemin: e.path.slice(0, 80), site: e.host });
}
function stats(now: number, hours = 24) {
  const recent = ring.filter((e) => now - e.t < hours * 3600_000), by = new Map<string, { n: number; e4: number; e5: number; ms: number; bytes: number }>();
  for (const e of recent) { const x = by.get(e.host) ?? { n: 0, e4: 0, e5: 0, ms: 0, bytes: 0 }; x.n++; if (e.status >= 500) x.e5++; else if (e.status >= 400) x.e4++; x.ms += e.ms; x.bytes += e.bytes; by.set(e.host, x); }
  return { total: recent.length, by };
}

async function startProxy(ctx: ModCtx): Promise<string> {
  srv?.stop(); appCtx = ctx;
  const d = new ProxyServer({
    hosts: () => hosts(ctx), redirects: () => redirects(ctx), cert: (n) => certFor(ctx, n), defaultCert: () => defaultCert(ctx),
    challenge: (t) => challenges.get(t), banned: (ip) => banned.has(ip), log: (e) => record(ctx, e),
    // Lien Vár → Valgrind : la connexion unique (qui est connecté, a-t-il le droit) et le portail de connexion.
    sso: (cookie, domain, ip) => varCheck(cookie, domain, ip), portal: { domain: () => portalDomain(), url: () => { const u = portalUrl(); if (!u || !srv) return u; return srv.httpsPort === 443 ? u : `${u}:${srv.httpsPort}`; }, handle: (q, r, secure) => void varPortal(q, r, secure) },
    onAuthFail: (ip, host) => {
      const now = Date.now(), list = [...(authFails.get(ip) ?? []).filter((t) => now - t < 600_000), now]; authFails.set(ip, list);
      ctx.emit('mot_de_passe_refuse', { ip, site: host, essais: list.length });
      // Lien Valgrind → Garmr : 5 mauvais mots de passe en 10 minutes, l'adresse est bannie (jamais une adresse de la maison).
      if (list.length === 5) void ctx.call('garmr', 'bannir', { ip, raison: `5 mauvais mots de passe sur ${host} (proxy)`, minutes: 60 }, `trop d'essais de mot de passe sur ${host}`);
    },
  });
  const p = ports(ctx);
  await d.start({ http: p.http, https: p.https });
  srv = d;
  const err = await d.syncStreams(streams(ctx));
  return `✅ Proxy en marche : HTTP sur le port ${d.httpPort}, HTTPS sur le port ${d.httpsPort}. ${hosts(ctx).filter((h) => h.enabled).length} site(s).${err.length ? `\n⚠ ${err.join(' ; ')}` : ''}`;
}

// ---------------- Le graphe ----------------
export function proxyGraph(hs: Host[], rds: Redirect[], sts: Stream[], st: ReturnType<typeof stats>, cert: (h: Host) => { days: number; issuer: string; notAfter: string } | undefined, on: boolean, bannedN: number): { nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail> } {
  const nodes: GraphNode[] = [{ id: 'internet', label: 'Internet', sub: 'visiteurs', square: true, size: 13, color: '#7FB3E6' }, { id: 'odin', label: 'Odin · Valgrind', sub: on ? 'proxy en marche' : 'proxy arrêté', square: true, size: 18, color: on ? '#4F9DDE' : '#7d8791', hub: true }];
  const edges: GraphEdge[] = [{ a: 'internet', b: 'odin', w: 3, color: '#7FB3E6' }], details: Record<string, GraphDetail> = {};
  details.odin = { kind: 'Proxy', title: 'Valgrind', subtitle: on ? 'en marche' : 'arrêté', chips: [{ label: on ? 'En marche' : 'Arrêté', tone: on ? 'bon' : 'mauvais' }, ...(bannedN ? [{ label: `${bannedN} adresse(s) bannie(s) refusée(s)`, tone: 'attention' as Tone }] : [])], rows: [{ k: 'Sites', v: String(hs.length) }, { k: 'Redirections', v: String(rds.length) }, { k: 'Flux TCP', v: String(sts.length) }, { k: 'Requêtes (24 h)', v: String(st.total) }], actions: [{ action: on ? 'arreter' : 'demarrer', label: on ? 'Arrêter le proxy' : 'Démarrer le proxy', input: {}, primary: !on }] };
  const machines = new Map<string, string[]>();
  for (const h of hs) {
    const id = `h:${h.id}`, x = st.by.get(h.domains[0]), c = h.tls !== 'aucun' ? cert(h) : undefined, err = x && x.n >= 10 && x.e5 / x.n > 0.3;
    const color = !h.enabled ? '#7d8791' : err ? '#EE6A55' : c && c.days < 15 ? '#F0A040' : '#57C98A';
    nodes.push({ id, label: h.domains[0], sub: `${h.tls === 'letsencrypt' ? 'HTTPS (Let\'s Encrypt)' : h.tls === 'auto' ? 'HTTPS (auto-signé)' : 'HTTP'}${x ? ` · ${x.n} req.` : ''}`, size: 8 + Math.min(8, Math.round(Math.sqrt(x?.n ?? 0) / 4)), color, off: !h.enabled, ring: h.auth && Object.keys(h.auth).length ? '#B48CF0' : h.allow?.length ? '#4F9DDE' : undefined, alert: err ? { n: x!.e5, level: 'grave' } : undefined, search: `${h.domains.join(' ')} ${h.target}` });
    edges.push({ a: 'odin', b: id, w: x ? Math.min(3, Math.log10(x.n + 1)) : 0, color: err ? '#EE6A55' : undefined });
    let mk = h.target; try { mk = new URL(h.target).host; } catch { /* cible illisible */ }
    machines.set(mk, [...(machines.get(mk) ?? []), id]);
    details[id] = {
      kind: 'Site du proxy', title: h.domains.join(', '), subtitle: `→ ${h.target}`,
      chips: [{ label: h.enabled ? 'Actif' : 'Coupé', tone: h.enabled ? 'bon' : 'neutre' }, ...(c ? [{ label: `Certificat : ${c.days} j`, tone: (c.days < 15 ? 'attention' : 'bon') as Tone }] : []), ...(h.forceHttps ? [{ label: 'HTTPS forcé' }] : []), ...(h.hsts ? [{ label: 'HSTS' }] : []), ...(h.websocket ? [{ label: 'WebSocket' }] : []), ...(h.auth && Object.keys(h.auth).length ? [{ label: 'Mot de passe', tone: 'bon' as Tone }] : []), ...(h.allow?.length ? [{ label: `Réservé à ${h.allow.join(', ')}` }] : [])],
      rows: [
        { k: 'Cible', v: h.target, src: h.preserveHost ? 'le nom demandé est transmis au service' : '' },
        { k: 'Certificat', v: h.tls === 'aucun' ? 'aucun (HTTP seulement)' : c ? `${c.issuer}, jusqu'au ${c.notAfter}` : 'pas encore obtenu', src: h.tls === 'letsencrypt' ? 'renouvelé tout seul 30 jours avant la fin' : '' },
        { k: 'Requêtes (24 h)', v: x ? `${x.n} · ${x.e4} refusées (4xx) · ${x.e5} erreurs du service (5xx) · ${Math.round(x.ms / x.n)} ms en moyenne` : 'aucune', src: 'journal du proxy' },
      ],
      actions: [{ action: 'tester', label: 'Tester', input: { domaine: h.domains[0] }, primary: true }, ...(h.tls === 'letsencrypt' ? [{ action: 'certificat', label: 'Renouveler le certificat', input: { domaine: h.domains[0] } }] : []), { action: 'activer', label: h.enabled ? 'Couper' : 'Réactiver', input: { domaine: h.domains[0], actif: !h.enabled } }, { action: 'retirer', label: 'Retirer', input: { domaine: h.domains[0] } }],
    };
  }
  for (const [mk, ids] of machines) {
    const ip = mk.replace(/:\d+$/, '');
    nodes.push({ id: `m:${mk}`, label: mk, sub: 'service', size: 6, color: '#E8EAEC' }); for (const i of ids) edges.push({ a: i, b: `m:${mk}` });
    details[`m:${mk}`] = { kind: 'Service de la maison', title: mk, rows: ids.map((i) => ({ k: 'Servi sous', v: details[i].title })), actions: [{ action: 'lire', label: 'Voir ses paquets (Rán)', input: { ip }, module: 'ran' }] };
  }
  for (const r of rds) { const id = `r:${r.id}`; nodes.push({ id, label: r.domain, sub: `→ ${r.to}`, size: 6, color: '#B48CF0' }); edges.push({ a: 'odin', b: id, dash: true, color: '#B48CF0' }); details[id] = { kind: `Redirection ${r.code}`, title: r.domain, subtitle: `→ ${r.to}`, rows: [{ k: 'Chemin gardé', v: r.keepPath ? 'oui' : 'non' }], actions: [{ action: 'retirer_redirection', label: 'Retirer', input: { domaine: r.domain } }] }; }
  for (const x of sts) { const id = `f:${x.id}`; nodes.push({ id, label: `port ${x.port}`, sub: `TCP → ${x.target}`, size: 6, color: '#F0A040', off: !x.enabled }); edges.push({ a: 'odin', b: id, dash: true }); details[id] = { kind: 'Flux TCP', title: `Port ${x.port}`, subtitle: `→ ${x.target}`, actions: [{ action: 'retirer_flux', label: 'Retirer', input: { port: x.port } }] }; }
  return { nodes, edges, details };
}

const byDomain = (ctx: ModCtx, d: unknown): Host => { const x = s(d).toLowerCase(), h = hosts(ctx).find((y) => y.domains.includes(x)); if (!h) throw new Error(`aucun site « ${s(d)} » dans le proxy`); return h; };
const saveHosts = (ctx: ModCtx, l: Host[]) => ctx.saveSettings({ hosts: l });
const ADD: Param[] = [
  { key: 'domaines', label: 'Nom(s) de domaine (séparés par des virgules)', kind: 'text', required: true, help: 'ex. nas.exemple.fr, ou photos.maison pour la maison' },
  { key: 'cible', label: 'Service de la maison', kind: 'text', required: true, help: 'ex. http://192.168.1.10:5000' },
  { key: 'https', label: 'Certificat', kind: 'select', options: ['letsencrypt', 'auto-signé', 'aucun'], default: 'letsencrypt' },
  { key: 'forcer_https', label: 'Toujours passer en HTTPS', kind: 'boolean', default: true },
  { key: 'websocket', label: 'WebSocket (discussions, Home Assistant…)', kind: 'boolean', default: true },
  { key: 'hsts', label: 'HSTS (les navigateurs retiennent le HTTPS)', kind: 'boolean', default: false },
  { key: 'acces', label: 'Réservé à ces adresses (vide : tout le monde)', kind: 'text', default: '', help: 'ex. 192.168.1.0/24, 10.8.0.0/24' },
  { key: 'dns_maison', label: 'À la maison, ce nom mène directement au proxy (Víðarr)', kind: 'boolean', default: true },
  { key: 'surveiller', label: 'Surveiller le service (Vörðr)', kind: 'boolean', default: true },
  { key: 'internet', label: 'Accessible depuis Internet par le tunnel Cloudflare (s\'il est réglé dans Brú)', kind: 'boolean', default: true },
];

export const valgrind: Module = {
  id: 'valgrind', name: 'Valgrind', family: 'Accès',
  what: 'Le proxy inverse : tes services de la maison sous un vrai nom, en HTTPS (Let\'s Encrypt ou auto-signé), avec accès par adresses, mot de passe, redirections et flux TCP.',
  does: ['un nom de domaine → un service de la maison (HTTP ou HTTPS), jokers *.exemple.fr', 'certificats Let\'s Encrypt obtenus et renouvelés tout seuls (sans envoyer d\'adresse e-mail), ou auto-signés pour la maison', 'passage forcé en HTTPS, HSTS, WebSocket, en-têtes X-Forwarded', 'accès réservé à des adresses ou réseaux ; mot de passe par site (gardé dans le coffre) ; adresses bannies par Garmr refusées', 'redirections 301 / 302, flux TCP (un port → un service)', 'journal et statistiques par site, alertes (certificat, service en panne), robots qui cherchent des failles signalés à Ullr', 'graphe : Internet, le proxy, les sites, les services de la maison'],
  from: ['Nginx Proxy Manager', 'Traefik', 'Caddy'], upstream: ['NginxProxyManager/nginx-proxy-manager', 'traefik/traefik', 'caddyserver/caddy'],
  words: ['proxy', 'reverse proxy', 'proxy inverse', 'nom de domaine', 'certificat', 'let\'s encrypt', 'lets encrypt', 'https', 'sous-domaine', 'redirection', 'rediriger'],
  actions: [
    { id: 'ouvrir_ports', label: 'Ouvrir 80 et 443 sur la box', what: 'Accès direct depuis Internet (sans tunnel) et certificats Let\'s Encrypt : Odin ouvre lui-même les ports de la box (UPnP)', quick: false, grave: () => 'ouvrir les ports 80 et 443 de la box vers Odin (tes sites deviennent joignables directement depuis Internet)', run: async (ctx) => {
      const r = await openPorts([{ port: 80, proto: 'TCP' }, { port: 443, proto: 'TCP' }], 'Odin · proxy Valgrind', ctx.fetch);
      ctx.saveSettings({ upnp: { lease: r.lease, at: Date.now(), ip: r.ip, cgnat: r.cgnat } });
      return { text: `${r.text}${proxyServer() ? '' : ' Démarre le proxy pour qu\'il réponde.'} Sans ouvrir de port, le tunnel Cloudflare (Brú) fait la même chose.` };
    } },
    { id: 'fermer_ports', label: 'Fermer 80 et 443 sur la box', what: 'Plus d\'accès direct depuis Internet (le tunnel Cloudflare continue)', quick: false, run: async (ctx) => { const t = await closePorts([{ port: 80, proto: 'TCP' }, { port: 443, proto: 'TCP' }], ctx.fetch); ctx.saveSettings({ upnp: undefined }); return { text: t }; } },
    { id: 'demarrer', label: 'Démarrer le proxy', what: 'Odin répond sur les ports 80 et 443', quick: false, params: [{ key: 'http', label: 'Port HTTP', kind: 'number', default: 80 }, { key: 'https', label: 'Port HTTPS', kind: 'number', default: 443 }], run: async (ctx, i) => {
      const http = i.http === undefined || i.http === '' ? ports(ctx).http : Number(i.http), https = i.https === undefined || i.https === '' ? ports(ctx).https : Number(i.https);
      for (const p of [http, https]) if (!Number.isInteger(p) || p < 0 || p > 65535) throw new Error('ports entre 1 et 65535');
      ctx.saveSettings({ ports: { http, https } });
      try { const t = await startProxy(ctx); ctx.saveSettings({ on: true }); return { text: t }; }
      catch (e) { const m = (e as Error & { code?: string }); return { ok: false, text: m.code === 'EACCES' ? `Les ports ${http} et ${https} sont réservés à l'administrateur : lance Odin avec le droit d'ouvrir ces ports (sudo setcap 'cap_net_bind_service=+ep' $(which node)), ou choisis d'autres ports.` : m.code === 'EADDRINUSE' ? `Un autre programme utilise déjà le port ${http} ou ${https} (un autre proxy, un serveur web) : arrête-le ou choisis d'autres ports.` : m.message }; }
    } },
    { id: 'arreter', label: 'Arrêter le proxy', what: 'Les sites ne répondent plus par Odin', quick: false, grave: () => 'couper l\'accès à tous les sites servis par le proxy', run: (ctx) => { srv?.stop(); srv = undefined; ctx.saveSettings({ on: false }); return { text: '⏹ Proxy arrêté.' }; } },
    { id: 'ajouter', label: 'Ajouter un site', what: 'Un nom → un service de la maison', params: ADD, run: async (ctx, i) => {
      const domains = s(i.domaines).toLowerCase().split(/[\s,;]+/).filter(Boolean).map((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
      if (!domains.length) throw new Error('quel nom ?'); for (const d of domains) if (!DOMAIN.test(d)) throw new Error(`nom invalide : ${d}`);
      const taken = hosts(ctx).flatMap((h) => h.domains); for (const d of domains) if (taken.includes(d) || redirects(ctx).some((r) => r.domain === d)) throw new Error(`${d} est déjà utilisé dans le proxy`);
      let target = s(i.cible); if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
      try { const u = new URL(target); if (!u.hostname) throw new Error(''); } catch { throw new Error('service invalide (ex. http://192.168.1.10:5000)'); }
      const allow = s(i.acces) ? s(i.acces).split(/[\s,;]+/).filter(Boolean) : [];
      for (const a of allow) if (!/^[\d.]+(\/\d{1,2})?$/.test(a)) throw new Error(`adresse ou réseau invalide : ${a}`);
      const tlsMode = s(i.https) === 'aucun' ? 'aucun' : s(i.https) === 'auto-signé' ? 'auto' : 'letsencrypt';
      const h: Host = { id: randomBytes(5).toString('hex'), domains, target, enabled: true, tls: tlsMode, forceHttps: tlsMode !== 'aucun' && i.forcer_https !== false, websocket: i.websocket !== false, hsts: i.hsts === true, preserveHost: true, ...(allow.length ? { allow } : {}) };
      saveHosts(ctx, [...hosts(ctx), h]);
      const out = [`🌐 ${domains.join(', ')} → ${target}.`];
      if (tlsMode === 'auto') { selfSigned(ctx, h); out.push('🔐 Certificat auto-signé créé (les navigateurs avertissent une fois : pour la maison).'); }
      if (tlsMode === 'letsencrypt') { try { out.push(await letsEncrypt(ctx, h)); } catch (e) { selfSigned(ctx, h); out.push(`⚠ Let's Encrypt pas encore possible : ${(e as Error).message}. Certificat auto-signé en attendant ; « Renouveler le certificat » quand c'est prêt.`); } }
      // Liens : à la maison, le nom mène au proxy (Víðarr) ; le service est surveillé (Vörðr).
      const ip = s(ctx.settings.lanIp) || lan();
      if (i.dns_maison !== false && ip) for (const d of domains.filter((x) => !x.startsWith('*.'))) { const r = await ctx.call('vidarr', 'nom_local', { nom: d, valeur: ip }, `${d} servi par le proxy d'Odin`).catch(() => undefined); if (r?.ok !== false && r) out.push(`🏠 À la maison, ${d} mène directement à Odin (${ip}).`); }
      if (i.surveiller !== false) { const r = await ctx.call('vordr', 'ajouter', { nom: `Service ${domains[0]}`, genre: 'http', cible: target, groupe: 'Proxy', essais: 2, secondes: 60, codes: '200-499' }, `surveiller le service derrière ${domains[0]}`).catch(() => undefined); if (r?.ok !== false && r) out.push(`👁 Service surveillé par Vörðr.`); }
      // Lien Valgrind → Brú : avec un tunnel Cloudflare, le nom est publié sur Internet (règle + DNS chez Cloudflare).
      if (i.internet !== false) for (const d of domains.filter((x) => !x.startsWith('*.') && !/\.(local|lan|home|maison|internal)$/.test(x))) { const r = await ctx.call('bru', 'publier', { domaine: d }, `publier ${d} sur Internet`).catch((e) => ({ ok: false, text: (e as Error).message })); if (r.ok !== false) out.push(r.text); else if (!/crée d'abord le tunnel|clé Cloudflare absente/.test(r.text)) out.push(`⚠ Internet : ${r.text}`); }
      if (!srv) out.push('Le proxy est arrêté : « Démarrer le proxy ».');
      return { text: out.join('\n'), data: { id: h.id } };
    }, undo: (i) => ({ action: 'retirer', input: { domaine: s(i.domaines).split(/[\s,;]+/)[0] }, label: 'Retirer le site' }) },
    { id: 'retirer', label: 'Retirer un site', what: 'Le nom ne mène plus au service', quick: false, params: [{ key: 'domaine', label: 'Domaine', kind: 'text', required: true }], run: (ctx, i) => { const h = byDomain(ctx, i.domaine); saveHosts(ctx, hosts(ctx).filter((x) => x.id !== h.id)); return { text: `🗑 ${h.domains.join(', ')} retiré du proxy.` }; } },
    { id: 'activer', label: 'Couper / réactiver un site', what: 'Sans le retirer', quick: false, params: [{ key: 'domaine', label: 'Domaine', kind: 'text', required: true }, { key: 'actif', label: 'Actif', kind: 'boolean', default: true }], run: (ctx, i) => { const h = byDomain(ctx, i.domaine); saveHosts(ctx, hosts(ctx).map((x) => (x.id === h.id ? { ...x, enabled: i.actif !== false } : x))); return { text: `${i.actif !== false ? '▶' : '⏸'} ${h.domains[0]} ${i.actif !== false ? 'réactivé' : 'coupé'}.` }; } },
    { id: 'proteger', label: 'Protéger par mot de passe', what: 'Le site demande un identifiant et un mot de passe (rangé dans le coffre)', quick: false, params: [{ key: 'domaine', label: 'Domaine', kind: 'text', required: true }, { key: 'utilisateur', label: 'Identifiant', kind: 'text', default: 'odin' }, { key: 'mot_de_passe', label: 'Mot de passe (vide : Odin en choisit un solide)', kind: 'password', default: '' }, { key: 'retirer', label: 'Retirer la protection', kind: 'boolean', default: false }], run: async (ctx, i) => {
      const h = byDomain(ctx, i.domaine);
      if (i.retirer === true) { saveHosts(ctx, hosts(ctx).map((x) => (x.id === h.id ? { ...x, auth: undefined } : x))); return { text: `🔓 ${h.domains[0]} n'a plus de mot de passe.` }; }
      const user = s(i.utilisateur) || 'odin'; if (!/^[\w.@-]{1,40}$/.test(user)) throw new Error('identifiant : lettres, chiffres, . _ - @');
      const pass = s(i.mot_de_passe) || randomBytes(15).toString('base64url'); if (pass.length < 10) throw new Error('10 caractères au moins');
      // Lien Valgrind → Brísingamen : le mot de passe va dans le coffre ; le proxy n'en garde que l'empreinte.
      const v = await ctx.call('brisingamen', 'ajouter', { nom: `Proxy ${h.domains[0]}`, identifiant: user, mot_de_passe: pass, site: `https://${h.domains[0]}`, coffre: 'Personnel' }, `ranger le mot de passe du site ${h.domains[0]}`).catch((e) => ({ ok: false, text: (e as Error).message }));
      saveHosts(ctx, hosts(ctx).map((x) => (x.id === h.id ? { ...x, auth: { ...(x.auth ?? {}), [user]: hashPassword(pass) } } : x)));
      return { text: `🔒 ${h.domains[0]} demande maintenant un mot de passe (identifiant « ${user} »). ${v.ok !== false ? 'Le mot de passe est dans le coffre Brísingamen (« Proxy ' + h.domains[0] + ' »).' : `⚠ Le coffre n'a pas pu le garder (${v.text}) : retiens-le, il n'est affiché nulle part.`}` };
    } },
    { id: 'acces', label: 'Accès par adresses', what: 'Réserver un site à certaines adresses, ou en refuser', quick: false, params: [{ key: 'domaine', label: 'Domaine', kind: 'text', required: true }, { key: 'autoriser', label: 'Seulement (vide : tout le monde)', kind: 'text', default: '' }, { key: 'refuser', label: 'Refuser', kind: 'text', default: '' }], run: (ctx, i) => {
      const h = byDomain(ctx, i.domaine), list = (v: unknown) => s(v).split(/[\s,;]+/).filter(Boolean);
      for (const a of [...list(i.autoriser), ...list(i.refuser)]) if (!/^[\d.]+(\/\d{1,2})?$/.test(a)) throw new Error(`adresse ou réseau invalide : ${a}`);
      saveHosts(ctx, hosts(ctx).map((x) => (x.id === h.id ? { ...x, allow: list(i.autoriser), deny: list(i.refuser) } : x)));
      return { text: `🛂 ${h.domains[0]} : ${list(i.autoriser).length ? `seulement ${list(i.autoriser).join(', ')}` : 'tout le monde'}${list(i.refuser).length ? `, sauf ${list(i.refuser).join(', ')}` : ''}.` };
    } },
    { id: 'rediriger', label: 'Redirection', what: 'Un nom renvoie vers une autre adresse', params: [{ key: 'domaine', label: 'Nom', kind: 'text', required: true }, { key: 'vers', label: 'Vers (adresse complète)', kind: 'text', required: true }, { key: 'code', label: 'Genre', kind: 'select', options: ['301', '302'], default: '301', help: '301 : définitive ; 302 : temporaire' }, { key: 'garder_chemin', label: 'Garder le chemin (/page)', kind: 'boolean', default: true }], run: (ctx, i) => {
      const d = s(i.domaine).toLowerCase(); if (!DOMAIN.test(d) || d.startsWith('*.')) throw new Error('nom invalide');
      if (hosts(ctx).some((h) => h.domains.includes(d)) || redirects(ctx).some((r) => r.domain === d)) throw new Error(`${d} est déjà utilisé dans le proxy`);
      try { const u = new URL(s(i.vers)); if (!/^https?:$/.test(u.protocol)) throw new Error(''); } catch { throw new Error('adresse de destination invalide (https://…)'); }
      ctx.saveSettings({ redirects: [...redirects(ctx), { id: randomBytes(4).toString('hex'), domain: d, to: s(i.vers), code: s(i.code) === '302' ? 302 : 301, keepPath: i.garder_chemin !== false }] });
      return { text: `↪ ${d} → ${s(i.vers)} (${s(i.code) === '302' ? 'temporaire' : 'définitive'}).` };
    } },
    { id: 'connexion_unique', label: 'Connexion unique (Vár)', what: 'Le site demande la connexion d\'Odin', quick: false, params: [{ key: 'domaine', label: 'Domaine', kind: 'text', required: true }, { key: 'actif', label: 'Actif', kind: 'boolean', default: true }], run: (ctx, i) => { const h = byDomain(ctx, i.domaine); saveHosts(ctx, hosts(ctx).map((x) => (x.id === h.id ? { ...x, sso: i.actif !== false } : x))); return { text: `${i.actif !== false ? '🛡' : '🔓'} ${h.domains[0]} ${i.actif !== false ? 'demande la connexion d\'Odin (Vár)' : 'ne demande plus la connexion d\'Odin'}.` }; } },
    { id: 'portail', label: 'Servir le portail de connexion', what: 'Le nom du portail de Vár, avec son certificat', quick: false, params: [{ key: 'domaine', label: 'Nom du portail', kind: 'text', required: true }], run: async (ctx, i) => {
      const d = s(i.domaine).toLowerCase(); if (!DOMAIN.test(d) || d.startsWith('*.')) throw new Error('nom invalide');
      if (hosts(ctx).some((h) => h.domains.includes(d))) throw new Error(`${d} est déjà un site du proxy`);
      const fake: Host = { id: 'portail', domains: [d], target: 'http://127.0.0.1', enabled: true, tls: 'letsencrypt' };
      let how = 'auto-signé'; try { await letsEncrypt(ctx, fake); how = 'Let\'s Encrypt'; } catch { selfSigned(ctx, fake); }
      const ip = s(ctx.settings.lanIp) || lan(); if (ip) await ctx.call('vidarr', 'nom_local', { nom: d, valeur: ip }, `portail ${d} servi par Odin`).catch(() => undefined);
      return { text: `🚪 Portail ${d} servi par le proxy (certificat ${how}).` };
    } },
    { id: 'retirer_redirection', label: 'Retirer une redirection', what: '', quick: false, params: [{ key: 'domaine', label: 'Nom', kind: 'text', required: true }], run: (ctx, i) => { const l = redirects(ctx); if (!l.some((r) => r.domain === s(i.domaine))) throw new Error('aucune redirection pour ce nom'); ctx.saveSettings({ redirects: l.filter((r) => r.domain !== s(i.domaine)) }); return { text: '🗑 Redirection retirée.' }; } },
    { id: 'flux', label: 'Flux TCP', what: 'Un port d\'Odin mène à un service (jeux, SSH, base de données…)', quick: false, params: [{ key: 'port', label: 'Port d\'Odin', kind: 'number', required: true }, { key: 'cible', label: 'Service (adresse:port)', kind: 'text', required: true }], run: async (ctx, i) => {
      const port = Number(i.port), tg = s(i.cible); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port entre 1 et 65535');
      if (!/^[\w.-]+:\d{1,5}$/.test(tg)) throw new Error('service sous la forme 192.168.1.10:22');
      if (streams(ctx).some((x) => x.port === port) || [ports(ctx).http, ports(ctx).https].includes(port)) throw new Error('port déjà utilisé par le proxy');
      const l = [...streams(ctx), { id: randomBytes(4).toString('hex'), port, target: tg, enabled: true }]; ctx.saveSettings({ streams: l });
      const err = srv ? await srv.syncStreams(l) : [];
      return { ok: !err.length, text: err.length ? `⚠ ${err.join(' ; ')}` : `🔀 Port ${port} → ${tg}${srv ? '' : ' (au démarrage du proxy)'}.` };
    } },
    { id: 'retirer_flux', label: 'Retirer un flux', what: '', quick: false, params: [{ key: 'port', label: 'Port', kind: 'number', required: true }], run: async (ctx, i) => { const l = streams(ctx).filter((x) => x.port !== Number(i.port)); if (l.length === streams(ctx).length) throw new Error('aucun flux sur ce port'); ctx.saveSettings({ streams: l }); if (srv) await srv.syncStreams(l); return { text: `🗑 Flux du port ${i.port} retiré.` }; } },
    { id: 'certificat', label: 'Obtenir / renouveler un certificat', what: 'Let\'s Encrypt maintenant (ou auto-signé)', quick: false, params: [{ key: 'domaine', label: 'Domaine', kind: 'text', required: true }], run: async (ctx, i) => { const h = byDomain(ctx, i.domaine); if (h.tls === 'aucun') throw new Error('ce site est en HTTP seulement'); if (h.tls === 'auto') { selfSigned(ctx, h); return { text: `🔐 Nouveau certificat auto-signé pour ${h.domains.join(', ')}.` }; } return { text: await letsEncrypt(ctx, h) }; } },
    { id: 'tester', label: 'Tester un site', what: 'Le nom, le certificat et le service derrière', read: true, params: [{ key: 'domaine', label: 'Domaine', kind: 'text', required: true }], run: async (ctx, i) => {
      const n = s(i.domaine).toLowerCase(), h = route(hosts(ctx), n), rd = redirects(ctx).find((r) => r.domain === n);
      if (rd) return { text: `${n} : redirection ${rd.code} vers ${rd.to}.` };
      if (!h) return { ok: false, text: `${n} : aucun site dans le proxy (page « Rien ici »).` };
      const lines = [`${n} → ${h.target}${h.enabled ? '' : ' (coupé)'}`];
      const c = h.tls !== 'aucun' ? readCert(ctx, h.domains[0]) : undefined;
      if (c) { const x = certInfo(c.cert); lines.push(`Certificat : ${x.issuer}, ${x.days} jour(s) restant(s) (jusqu'au ${x.notAfter}).`); } else if (h.tls !== 'aucun') lines.push('Certificat : pas encore obtenu.');
      const t0 = Date.now();
      try { const r = await ctx.fetch(h.target, { signal: AbortSignal.timeout(8000), redirect: 'manual' }); await r.body?.cancel(); lines.push(`Service : répond (code ${r.status}, ${Date.now() - t0} ms).`); }
      catch (e) { lines.push(`Service : ne répond pas (${(e as Error & { cause?: { code?: string } }).cause?.code ?? (e as Error).message}).`); }
      lines.push(srv ? `Proxy : en marche (HTTP ${srv.httpPort}, HTTPS ${srv.httpsPort}).` : 'Proxy : arrêté.');
      return { text: lines.join('\n') };
    } },
    { id: 'journal', label: 'Journal', what: 'Les dernières requêtes', read: true, params: [{ key: 'filtre', label: 'Site ou adresse (facultatif)', kind: 'text', default: '' }], run: (_ctx, i) => { const f = s(i.filtre).toLowerCase(); const rows = ring.filter((e) => !f || e.host.includes(f) || e.ip.includes(f)).slice(-40).reverse(); return { text: rows.map((e) => `${new Date(e.t).toLocaleTimeString('fr-FR')} ${e.ip} ${e.method} ${e.host}${e.path} → ${e.status} ${e.ms} ms${e.why ? ` (${e.why})` : ''}`).join('\n') || 'Rien.' }; } },
    { id: 'reglages', label: 'Réglages Let\'s Encrypt', what: 'Serveur d\'essai (pour tester sans limite)', quick: false, params: [{ key: 'essai', label: 'Serveur d\'essai de Let\'s Encrypt', kind: 'boolean', default: false }], run: (ctx, i) => { ctx.saveSettings({ acmeStaging: i.essai === true }); return { text: i.essai === true ? '🧪 Let\'s Encrypt d\'essai (certificats non reconnus par les navigateurs, pour tester).' : '✅ Let\'s Encrypt normal.' }; } },
  ],
  view(ctx) {
    const hs = hosts(ctx), now = Date.now(), st = stats(now), certOf = (h: Host) => { const c = readCert(ctx, h.domains[0]); try { return c ? certInfo(c.cert, now) : undefined; } catch { return undefined; } };
    const g = proxyGraph(hs, redirects(ctx), streams(ctx), st, certOf, Boolean(srv), banned.size);
    const e5 = [...st.by.values()].reduce((n, x) => n + x.e5, 0);
    return {
      subtitle: srv ? `En marche · HTTP ${srv.httpPort} · HTTPS ${srv.httpsPort} · ${hs.length} site(s)` : `Arrêté · ${hs.length} site(s) prêts`,
      kpis: [{ label: 'Sites', value: String(hs.filter((h) => h.enabled).length) }, { label: 'Requêtes (24 h)', value: String(st.total) }, { label: 'Erreurs des services (24 h)', value: String(e5), tone: e5 ? 'attention' : 'bon' }, { label: 'Certificats bientôt finis', value: String(hs.filter((h) => { const c = certOf(h); return h.tls !== 'aucun' && c && c.days < 30; }).length) }],
      sections: [
        ...(srv ? [] : [{ kind: 'steps' as const, title: 'Mettre en route', items: [{ title: 'Démarrer le proxy', detail: 'Odin répond sur les ports 80 et 443. Sur ta box : redirige les ports 80 et 443 vers cette machine pour qu\'Internet arrive au proxy.', done: false, action: 'demarrer', button: 'Démarrer' }, { title: 'Ajouter un site', detail: 'Un nom (ex. nas.exemple.fr, qui pointe vers ton adresse publique) → un service de la maison.', done: hs.length > 0 }] }]),
        { kind: 'graph', title: 'Graphe du proxy', ...g, legend: [['#4F9DDE', 'Odin, Internet'], ['#57C98A', 'site qui répond'], ['#F0A040', 'certificat bientôt fini / flux'], ['#EE6A55', 'service en erreur'], ['#B48CF0', 'mot de passe / redirection'], ['#E8EAEC', 'service de la maison']] },
        { kind: 'table', title: 'Sites', columns: ['Nom(s)', 'Service', 'HTTPS', 'Protection', 'Requêtes (24 h)'], empty: 'Aucun site : ajoute-en un à droite.', rows: hs.map((h) => { const x = st.by.get(h.domains[0]), c = certOf(h); return { cells: [h.domains.join(', '), h.target, h.tls === 'aucun' ? 'non' : c ? `${h.tls === 'letsencrypt' ? 'Let\'s Encrypt' : 'auto-signé'} · ${c.days} j` : 'en attente', [h.auth && Object.keys(h.auth).length ? 'mot de passe' : '', h.allow?.length ? `réservé (${h.allow.join(', ')})` : ''].filter(Boolean).join(' · ') || '—', x ? `${x.n} (${x.e5} erreurs)` : '0'], tone: !h.enabled ? 'neutre' as const : x && x.n >= 10 && x.e5 / x.n > 0.3 ? 'mauvais' as const : undefined, actions: [{ action: 'tester', label: 'Tester', input: { domaine: h.domains[0] } }, { action: 'activer', label: h.enabled ? 'Couper' : 'Réactiver', input: { domaine: h.domains[0], actif: !h.enabled } }] }; }) },
        { kind: 'table', title: 'Redirections et flux', columns: ['De', 'Vers', 'Genre'], empty: 'Aucun.', rows: [...redirects(ctx).map((r) => ({ cells: [r.domain, r.to, `redirection ${r.code}`], actions: [{ action: 'retirer_redirection', label: 'Retirer', input: { domaine: r.domain } }] })), ...streams(ctx).map((x) => ({ cells: [`port ${x.port}`, x.target, 'flux TCP'], actions: [{ action: 'retirer_flux', label: 'Retirer', input: { port: x.port } }] }))] },
        { kind: 'list', title: 'Liens avec les prochaines applis', items: [{ title: 'Vár (identités)', detail: 'une seule connexion pour tous les sites du proxy (au lieu d\'un mot de passe par site)' }, { title: 'Skíðblaðnir (fichiers)', detail: 'tes fichiers partagés sous ton nom de domaine, en HTTPS' }, { title: 'Sól (photos)', detail: 'albums publiés par le proxy, réservés à qui tu choisis' }, { title: 'Snotra (bureau)', detail: 'le bureau à distance derrière un nom et un mot de passe' }] },
        { kind: 'log', title: 'Journal (dernières requêtes)', lines: ring.slice(-30).reverse().map((e) => `${new Date(e.t).toLocaleTimeString('fr-FR')} ${e.ip} ${e.method} ${e.host}${e.path.slice(0, 60)} → ${e.status} ${e.ms} ms${e.why ? ` (${e.why})` : ''}`) },
      ],
      side: [{ kind: 'form', title: 'Ajouter un site', action: 'ajouter', submit: 'Ajouter', params: ADD }],
    };
  },
  async start(ctx) {
    appCtx = ctx;
    if (ctx.settings.on === true) { try { await startProxy(ctx); } catch (e) { ctx.alert({ level: 'haute', title: 'Le proxy d\'Odin n\'a pas pu démarrer', detail: `${(e as Error).message}. Tes sites ne répondent plus par Odin.`, key: 'valgrind-demarrage' }); } }
  },
  stop() { srv?.stop(); srv = undefined; },
  // Chaque minute : les adresses bannies par Garmr ; les services en erreur ; une fois par jour, les certificats.
  watch: { every: 60, async run(ctx) {
    appCtx = ctx;
    const b = await ctx.call('garmr', 'bannis', {}).catch(() => undefined); if (Array.isArray(b?.data)) banned = new Set((b.data as Array<{ ip: string }>).map((x) => x.ip));
    if (ctx.settings.on === true && !srv) { try { await startProxy(ctx); } catch { /* alerte déjà donnée */ } }
    const now = Date.now(), recent = ring.filter((e) => now - e.t < 600_000);
    for (const h of hosts(ctx)) { const l = recent.filter((e) => h.domains.includes(e.host) && !e.why?.includes('mot de passe')), bad = l.filter((e) => e.status >= 502 && e.status <= 504).length; if (l.length >= 10 && bad / l.length > 0.5) ctx.alert({ level: 'haute', title: `Le service derrière ${h.domains[0]} ne répond plus`, detail: `${bad} erreurs sur ${l.length} requêtes en 10 minutes (cible ${h.target}). Vérifie que la machine et le programme tournent.`, key: `valgrind-5xx-${h.id}` }); }
    if (ctx.settings.certsCheckedOn === day(now)) return;
    ctx.saveSettings({ certsCheckedOn: day(now) });
    for (const h of hosts(ctx).filter((x) => x.enabled && x.tls !== 'aucun')) {
      const c = readCert(ctx, h.domains[0]); let left = -1; try { if (c) left = certInfo(c.cert, now).days; } catch { /* illisible : on refait */ }
      if (left >= 30) continue;
      try { if (h.tls === 'auto') selfSigned(ctx, h); else await letsEncrypt(ctx, h); ctx.emit('certificat_renouvele', { site: h.domains[0] }); }
      catch (e) { ctx.alert({ level: left < 7 ? 'critique' : 'haute', title: `Certificat de ${h.domains[0]} : renouvellement raté`, detail: `${(e as Error).message}. Il reste ${Math.max(0, left)} jour(s) avant que les navigateurs refusent le site.`, key: `valgrind-cert-${h.id}` }); }
    }
    // Journal détaillé : 14 jours.
    try { const dd = join(ctx.dir, 'journal'), lim = day(now - 14 * 86400_000); for (const f of readdirSync(dd)) if (f.slice(0, 10) < lim) unlinkSync(join(dd, f)); } catch { /* pas de journal */ }
  } },
};
export const proxyServer = () => srv;
export { inNet };
