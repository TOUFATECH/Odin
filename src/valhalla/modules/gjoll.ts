// Vortex — le VPN d'Odin : un seul moteur WireGuard pour les tunnels, les clients avec QR code
// (mode « Charon ») et le réseau maillé entre tes appareils (mode « Orion »).
// Le protocole WireGuard est ÉCRIT DANS ODIN (../wireguard/) : rien à installer. Les téléphones et les
// ordinateurs se connectent avec l'appli WireGuard habituelle, que le moteur d'Odin comprend.

import { openOnHost } from '../hostports.ts';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { champChiffre } from '../../vault.ts';
import { WgDevice, systemTun, type Flow, type PeerConfig, type TunPort } from '../wireguard/engine.ts';
import { isPrivateV4, localSubnets } from '../../hlidskjalf/discover.ts';
import { svg } from '../qr.ts';
import type { GraphDetail, GraphEdge, GraphNode, ModCtx, Module } from '../types.ts';
import { nameForIp, recentDomains } from './vidarr.ts';
import { localDay } from '../vidarr/history.ts';
import { closePorts, discover, externalIp, hoteDeBox, listMappings, openPorts, type Gateway } from '../upnp.ts';
import { depuisAdresse, texteSur } from '../vidarr/appareils.ts';
import { adresseBoxSure, adressePublique, avisOrigine, estLaBox, gardeVpn, hoteDe, nomVpn, trouverPair, vueVpn, type AppareilVpn, type Dernier, type EnDirect, type TunnelVpn, type VueVpn } from '../gjoll/vue.ts';
import { agissant } from '../sso/acces.ts';
import { actionJournal, auProprietaireSeul, avecJournal } from '../vidarr/qui-a-fait.ts';
import { accesDemande, dessinSur, finDemandee, nomAppareil } from '../gjoll/ajout.ts';
import { cleGardee, coffreOuvert, empreinteDe, marquerConfig, renommerConfig, retirerConfig, SITE_AVANT } from '../gjoll/coffre.ts';

/**
 * `priv` : la clé privée de l'appareil. Depuis le lot R8 elle est dans le coffre (Thésauros), et seulement là ; elle ne
 * reste ici (chiffrée au repos, src/prive.ts) que le temps d'y entrer : coffre fermé, Thésauros désactivé, appareil d'avant ce lot.
 */
export interface Peer { name: string; pub: string; priv?: string; psk: string; ip: string; created: string; enabled: boolean; full: boolean; mesh?: boolean; endpoint?: string; /** fin de l'accès (AAAA-MM-JJ) : passé ce jour, l'appareil est coupé tout seul */ expires?: string; /** passe par le DNS d'Odin (Sphinx) : pubs et sites dangereux bloqués aussi en dehors de la maison */ odinDns?: boolean;
  /** « seulement certaines adresses » : les seules adresses de la maison que l'appareil fait passer par le VPN (vide : tous les réseaux de la maison) */
  seules?: string[];
  /** le compte Persona de la personne à qui est l'appareil (rattaché par la page de connexion, lot R0) : « qui est connecté » ne montre à un membre que les siens */
  compte?: string }
export function keypair(): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  return { priv: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64'), pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') };
}
export interface Server {
  priv: string; pub: string; net: string; port: number; endpoint: string; dns: string; iface: string;
  /** Réseaux de la maison ouverts aux appareils du VPN (ex. 192.168.1.0/24). */
  lan?: string[];
  /** Comment la machine fait suivre le trafic du VPN vers la maison et Internet. */
  nat?: 'iptables' | 'nft' | 'aucun';
  /** taille des paquets dans le tunnel (vide = automatique) */
  mtu?: number;
  /** relance de la connexion toutes les N secondes (garde le tunnel ouvert derrière une box) */
  keepalive?: number;
}
const s = (v: unknown) => String(v ?? '');
/** Réseaux locaux de la machine à ouvrir au VPN (pas les ponts de conteneurs ni les autres tunnels). */
export function homeLans(subnets = localSubnets()): string[] {
  return [...new Set(subnets.filter((x) => !/^(wg|docker|br-|veth|virbr|tailscale|zt|tun|tap|lxc|podman|cni|ob)/.test(x.iface)).map((x) => x.cidr))];
}
function server(ctx: ModCtx): Server {
  let sv = ctx.settings.server as Server | undefined;
  if (!sv) { const k = keypair(); sv = { ...k, net: '10.8.0', port: 51820, endpoint: s(ctx.settings.endpoint) || '[ADRESSE PUBLIQUE OU DOMAINE]', dns: '', iface: 'wg0' }; ctx.saveSettings({ server: sv }); }
  // Le nom de l'interface part dans des commandes lancées en administrateur : lettres, chiffres, tiret, rien d'autre.
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,14}$/.test(String(sv.iface))) sv = { ...sv, iface: 'wg0' };
  verifierCles(ctx);
  // Un tunnel noté sans sa paire de clés (jamais créée) : elle est créée ici, une fois.
  if (!sv.priv || !sv.pub) { sv = { ...sv, ...keypair() }; ctx.saveSettings({ server: sv }); }
  return sv;
}
/**
 * Les clés du VPN sont chiffrées au repos avec la clé de la machine (src/prive.ts). Si cette clé a changé ou manque, elles
 * sont illisibles : Odin le dit et ne touche à rien. Il n'en fabrique jamais d'autres en silence (tous les appareils
 * seraient coupés sans explication), et n'écrit plus dans ses réglages (les valeurs chiffrées seraient perdues).
 */
const CLES_ILLISIBLES = 'les clés du VPN sont illisibles (la clé de cette machine a changé ou manque). Rien n\'est changé. Remets la clé de la machine à sa place (sauvegarde d\'Odin) puis redémarre Odin';
function verifierCles(ctx: ModCtx): void {
  // Illisible = écrite chiffrée dans le fichier des réglages, mais absente une fois relue (une valeur illisible est retirée à la lecture).
  let ecrit: { server?: { priv?: unknown }; peers?: Array<{ psk?: unknown; priv?: unknown } | null> } = {};
  try { ecrit = JSON.parse(readFileSync(join(ctx.dir, 'réglages.json'), 'utf8')) as typeof ecrit; } catch { return; }
  const perdue = (lue: unknown, e: unknown): boolean => champChiffre(e) && (typeof lue !== 'string' || !lue);
  const sv = ctx.settings.server as Server | undefined, ps = peers(ctx), ep = Array.isArray(ecrit.peers) ? ecrit.peers : [];
  if (perdue(sv?.priv, ecrit.server?.priv) || ep.some((e, k) => perdue(ps[k]?.psk, e?.psk) || perdue(ps[k]?.priv, e?.priv))) throw new Error(CLES_ILLISIBLES);
}
/** Le port du VPN, lu sans rien créer (pour ce que montre une validation). */
const portVpn = (ctx?: ModCtx): number => Number((ctx?.settings.server as Server | undefined)?.port) || 51820;
/** Complète ce qui dépend de la machine (une fois) : réseaux de la maison, DNS, façon de faire suivre le trafic. */
async function ready(ctx: ModCtx): Promise<Server> {
  const sv = server(ctx); let changed = false;
  if (!sv.lan) { sv.lan = homeLans().filter((c) => !c.startsWith(`${sv.net}.`)); changed = true; }
  if (!sv.dns || sv.dns === `${sv.net}.1`) {
    // Le DNS de la box (il connaît aussi les noms de la maison). Box introuvable : on garde ce qui était
    // (celui d'Odin, ou rien = celui de l'appareil) ; Odin ne choisit jamais seul un DNS hors de la maison,
    // c'est au propriétaire de le donner (« Réseaux de la maison », avec sa validation).
    const gw = /default via (\d+\.\d+\.\d+\.\d+)/.exec((await ctx.run('ip', ['route', 'show', 'default'])).out)?.[1];
    if (gw && isPrivateV4(gw)) { sv.dns = gw; changed = true; }
  }
  if (!sv.nat) { sv.nat = (await ctx.has('iptables')) ? 'iptables' : (await ctx.has('nft')) ? 'nft' : 'aucun'; changed = true; }
  if (changed) ctx.saveSettings({ server: sv });
  return sv;
}
const peers = (ctx: ModCtx): Peer[] => (ctx.settings.peers as Peer[] | undefined) ?? [];
/** Règles posées à l'allumage du tunnel : la machine fait suivre le trafic du VPN (maison et Internet). */
export function forwarding(sv: Server): { up: string; down: string } | undefined {
  const net = `${sv.net}.0/24`;
  if (sv.nat === 'iptables') return {
    up: `sysctl -q -w net.ipv4.ip_forward=1; iptables -I FORWARD -i %i -j ACCEPT; iptables -I FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -A POSTROUTING -s ${net} ! -o %i -j MASQUERADE`,
    down: `iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT; iptables -t nat -D POSTROUTING -s ${net} ! -o %i -j MASQUERADE`,
  };
  if (sv.nat === 'nft') return {
    up: `sysctl -q -w net.ipv4.ip_forward=1; nft add table inet odin_vpn; nft 'add chain inet odin_vpn sortie { type nat hook postrouting priority 100 ; }'; nft add rule inet odin_vpn sortie ip saddr ${net} oifname != "%i" masquerade`,
    down: 'nft delete table inet odin_vpn',
  };
  return undefined;
}
export function serverConf(sv: Server, ps: Peer[]): string {
  const f = forwarding(sv);
  return `[Interface]\n# Vortex (Odin) — ne pas modifier à la main\nAddress = ${sv.net}.1/24\nListenPort = ${sv.port}\nPrivateKey = ${sv.priv}\n${sv.mtu ? `MTU = ${sv.mtu}\n` : ''}${f ? `PostUp = ${f.up}\nPostDown = ${f.down}\n` : ''}${ps.filter((p) => p.enabled).map((p) => `\n[Peer]\n# ${p.name}\nPublicKey = ${p.pub}\nPresharedKey = ${p.psk}\nAllowedIPs = ${p.ip}/32\n`).join('')}`;
}
export function clientConf(sv: Server, p: Peer, all: Peer[] = []): string {
  // « Maison seulement » : le réseau du VPN et les réseaux de la maison ; « tout » : tout le trafic.
  // « Seulement certaines adresses » : Odin dans le VPN (son DNS, sa page) et ces adresses-là, rien d'autre.
  const allowed = p.full ? '0.0.0.0/0, ::/0' : p.seules?.length ? [`${sv.net}.1/32`, ...p.seules].join(', ') : [`${sv.net}.0/24`, ...(sv.lan ?? [])].join(', ');
  const mesh = p.mesh ? all.filter((x) => x.mesh && x.enabled && x.name !== p.name && x.endpoint).map((x) => `\n[Peer]\n# ${x.name} (maillage)\nPublicKey = ${x.pub}\nEndpoint = ${x.endpoint}\nAllowedIPs = ${x.ip}/32\nPersistentKeepalive = 25\n`).join('') : '';
  const dns = p.odinDns ? `${sv.net}.1` : sv.dns;
  return `[Interface]\nPrivateKey = ${p.priv}\nAddress = ${p.ip}/32\n${dns ? `DNS = ${dns}\n` : ''}${sv.mtu ? `MTU = ${sv.mtu}\n` : ''}\n[Peer]\n# Maison (Odin)\nPublicKey = ${sv.pub}\nPresharedKey = ${p.psk}\nEndpoint = ${sv.endpoint}:${sv.port}\nAllowedIPs = ${allowed}\nPersistentKeepalive = ${sv.keepalive ?? 25}\n${mesh}`;
}
/** Nom de fichier de la configuration d'un appareil (l'appli WireGuard prend le nom du fichier comme nom du tunnel). */
export const confName = (p: Peer) => `maison-${p.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'appareil'}.conf`;
/** Appareils dont l'accès est arrivé à son terme (jour passé). Pur. */
export const expired = (ps: Peer[], now: Date) => ps.filter((p) => p.enabled && p.expires && p.expires < now.toISOString().slice(0, 10));
/** Où en est la mise en route du VPN : chaque étape, faite ou à faire. */
export async function setup(ctx: ModCtx): Promise<Array<{ title: string; detail?: string; done: boolean; action?: string; input?: Record<string, unknown>; button?: string }>> {
  const sv = server(ctx), why = await engineReady(ctx), up = Boolean(dev);
  const known = !/^\[/.test(sv.endpoint), upnp = ctx.settings.upnp as { cgnat?: boolean } | undefined, opened = ctx.settings.portOpened === true || Boolean(upnp && !upnp.cgnat), ps = peers(ctx);
  return [
    { title: 'Moteur VPN d\'Odin', detail: why ? `Pas prêt : ${why}.` : 'Le moteur VPN de Vortex est intégré à Odin : rien à installer.', done: !why },
    { title: 'Adresse de la maison sur Internet', detail: known ? `${sv.endpoint}` : 'Odin lit ton adresse publique sur la box (aucun site extérieur). Si la box ne répond pas, ou si l\'adresse change souvent, écris-la ou mets un nom de domaine (formulaire « Adresse de la maison »).', done: known, action: 'detecter', button: 'Lire l\'adresse sur la box' },
    { title: `Ouvrir le port ${sv.port} (UDP) sur ta box`, detail: upnp?.cgnat ? 'Ouvert par Odin, mais ta box n\'a pas d\'adresse Internet à elle (Starlink, 4G, double box) : demande une adresse publique à l\'opérateur ou mets la box en mode « bridge ».' : `Odin l'ouvre lui-même si la box accepte l'UPnP (bouton). Sinon, dans l'interface de ta box (souvent http://192.168.1.1) : « Redirection de ports » ou « NAT/PAT », UDP ${sv.port} vers cette machine, puis « C'est fait » dans le formulaire.`, done: opened, ...(ctx.settings.upnpFailed === true ? { action: 'port', input: { ouvert: true }, button: 'C\'est fait' } : { action: 'ouvrir_port', button: 'Ouvrir le port' }) },
    { title: 'Allumer le tunnel', detail: 'Le VPN démarre, et redémarre tout seul avec Odin.', done: up, action: 'allumer', button: 'Allumer' },
    { title: 'Ajouter ton premier appareil', detail: 'Formulaire « Ajouter un appareil » à droite, puis scanne le QR code avec l\'appli WireGuard (iPhone, Android, Windows, Mac).', done: ps.length > 0 },
    { title: 'Essayer depuis dehors', detail: 'Coupe le Wi-Fi du téléphone (4G), active le tunnel dans l\'appli WireGuard : dans le tableau, l\'appareil passe à « connecté ». S\'il reste « jamais », le port n\'est pas ouvert sur la box.', done: ps.some((p) => ((ctx.settings.seen as string[] | undefined) ?? []).includes(p.name)) },
  ];
}
const human = (b: number) => { const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${Math.round(b * 10) / 10} ${u[i]}`; };
// ---------------- Lien avec Sphinx (le DNS d'Odin) ----------------
/** L'appareil passe par le DNS d'Odin : Sphinx le connaît sous son nom (journal, réglages propres). */
async function linkDns(ctx: ModCtx, p: Peer, before?: string): Promise<string> {
  // Étapes de l'action du propriétaire (« interne ») : Sphinx les accepte sous son action de départ, jamais seules.
  if (before && before !== p.name) await ctx.call('vidarr', 'retirer_appareil', { nom: `VPN · ${before}` }, 'appareil VPN renommé', { interne: true }).catch(() => undefined);
  if (!p.odinDns) { await ctx.call('vidarr', 'retirer_appareil', { nom: `VPN · ${p.name}` }, 'appareil VPN sans le DNS d\'Odin', { interne: true }).catch(() => undefined); return ''; }
  const r = await ctx.call('vidarr', 'appareil', { nom: `VPN · ${p.name}`, adresses: p.ip, filtrage: 'global', parental: false, recherche_sure: false, services: '', amont: '' }, 'appareil VPN qui passe par le DNS d\'Odin', { interne: true }).catch((e: Error) => ({ ok: false, text: e.message }));
  return r.ok === false ? ` ⚠ Lien avec le DNS d'Odin : ${r.text}` : ' Il passe par le DNS d\'Odin (Sphinx) : pubs et sites dangereux bloqués aussi hors de la maison.';
}

// ---------------- Le moteur VPN d'Odin ----------------
let dev: WgDevice | undefined, devPort = 0, devIface = '';
/** Carte réseau du système (remplaçable pour les essais). */
let openTun: (name: string) => Promise<TunPort> = (name) => systemTun(name, { sudo: typeof process.getuid === 'function' && process.getuid() !== 0 });
export function setTunFactory(f: (name: string) => Promise<TunPort>): void { openTun = f; }
export const engine = () => dev;
/** Ce que le moteur d'Odin demande à la machine : Linux, la carte réseau virtuelle, Python (fourni par le système). */
export async function engineReady(ctx: ModCtx): Promise<string | undefined> {
  if (process.platform !== 'linux') return `le moteur VPN d'Odin tourne pour l'instant sur Linux (cette machine : ${process.platform})`;
  if (!existsSync('/dev/net/tun')) return 'la carte réseau virtuelle (/dev/net/tun) n\'existe pas sur cette machine';
  if (!(await ctx.has('python3'))) return 'Python 3 manque sur cette machine (il est présent sur presque tous les Linux)';
  return undefined;
}
const peerConfigs = (ps: Peer[]): PeerConfig[] => ps.filter((p) => p.enabled).map((p) => ({ name: p.name, publicKey: p.pub, presharedKey: p.psk, allowedIps: [`${p.ip}/32`], ...(p.mesh && p.endpoint ? { endpoint: p.endpoint } : {}) }));
/** Allume (ou met à jour) le tunnel avec le moteur d'Odin : carte réseau, adresse, appareils, partage de connexion. */
async function bringUp(ctx: ModCtx): Promise<string> {
  const sv = await ready(ctx), ps = peers(ctx);
  if (dev && devPort === sv.port && devIface === sv.iface) { dev.setPeers(peerConfigs(ps)); return `✅ Tunnel ${sv.iface} à jour (${ps.filter((p) => p.enabled).length} appareil(s)).`; }
  if (dev) await bringDown(ctx);
  const why = await engineReady(ctx); if (why) throw new Error(why);
  const tun = await openTun(sv.iface);
  const ip = async (args: string[]) => { const r = await ctx.run('ip', args, { sudo: true }); if (r.code) throw new Error(`ip ${args.join(' ')} : ${r.err.trim()}`); };
  try {
    await ip(['address', 'flush', 'dev', sv.iface]);
    await ip(['address', 'add', `${sv.net}.1/24`, 'dev', sv.iface]);
    await ip(['link', 'set', sv.iface, 'mtu', String(sv.mtu ?? 1420), 'up']);
    const d = new WgDevice({ privateKey: sv.priv, listenPort: sv.port, tun, mtu: sv.mtu ?? 1420, peers: peerConfigs(ps), log: (l) => ctx.emit('vpn_journal', { ligne: l }) });
    await d.start(); dev = d; devPort = sv.port; devIface = sv.iface;
  } catch (e) { tun.close(); throw e; }
  const f = forwarding(sv);
  if (f) await ctx.run('sh', ['-c', f.up.replaceAll('%i', sv.iface)], { sudo: true });
  return `✅ Tunnel ${sv.iface} allumé par Odin (port ${sv.port} UDP, ${ps.filter((p) => p.enabled).length} appareil(s)).`;
}
async function bringDown(ctx: ModCtx): Promise<void> {
  const sv = server(ctx), f = forwarding(sv);
  dev?.stop(); dev = undefined; devPort = 0;
  if (f) await ctx.run('sh', ['-c', f.down.replaceAll('%i', sv.iface)], { sudo: true });
}
/** Après un changement : le tunnel allumé se met à jour ; éteint, la configuration est simplement gardée. */
async function apply(ctx: ModCtx): Promise<string> {
  if (ctx.settings.on !== true && !dev) return 'Configuration enregistrée (le tunnel est éteint : « Allumer le tunnel »).';
  try { return await bringUp(ctx); } catch (e) { return `⚠ Le tunnel n'a pas pu se mettre à jour : ${(e as Error).message}`; }
}
/** Débit de chaque appareil : la différence de trafic entre deux regards (octets par seconde). */
const lastSeen = new Map<string, { rx: number; tx: number; t: number; rate?: { rx: number; tx: number } }>();
function rates(d: Map<string, { rx: number; tx: number }>, now: number): Map<string, { rx: number; tx: number }> {
  const out = new Map<string, { rx: number; tx: number }>();
  for (const [k, x] of d) {
    const o = lastSeen.get(k), dt = o ? (now - o.t) / 1000 : 0;
    const r = o && dt >= 1 ? { rx: Math.max(0, (x.rx - o.rx) / dt), tx: Math.max(0, (x.tx - o.tx) / dt) } : o?.rate;
    if (!o || dt >= 1) lastSeen.set(k, { rx: x.rx, tx: x.tx, t: now, rate: r });
    if (r) out.set(k, r);
  }
  return out;
}
const mbps = (bps: number) => `${(bps * 8 / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Mb/s`;
/** Le graphe du VPN : Odin au centre, chaque appareil relié par son tunnel (vert s'il est connecté), ce qu'il joint (maison, Internet) et ses domaines. */
export function vpnGraph(sv: Server, ps: Peer[], d: Map<string, { handshake: number; rx: number; tx: number; endpoint: string }>, r: Map<string, { rx: number; tx: number }>, now: number, domains: (ip: string) => Array<{ name: string; n: number; blocked: boolean; list?: string }> = () => [], fl: Flow[] = [], nameOf: (ip: string) => string | undefined = () => undefined): { nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail> } {
  const nodes: GraphNode[] = [{ id: 'odin', label: 'Odin · Vortex', sub: `${sv.iface} · ${sv.net}.1 · port ${sv.port}`, square: true, size: 18, color: '#4F9DDE', hub: true }];
  const edges: GraphEdge[] = [], details: Record<string, GraphDetail> = {};
  details.odin = { kind: 'Tunnel', title: `Tunnel ${sv.iface}`, subtitle: `${sv.endpoint}:${sv.port} (UDP) · réseau ${sv.net}.0/24`, chips: [{ label: dev ? 'Allumé' : 'Éteint', tone: dev ? 'bon' : 'mauvais' }], rows: [{ k: 'Appareils', v: `${ps.length}, dont ${ps.filter((p) => { const x = d.get(p.pub); return x?.handshake && now - x.handshake < 180_000; }).length} connectés`, src: '' }, { k: 'Maison joignable', v: sv.lan?.join(', ') || '—', src: '' }], actions: [{ action: dev ? 'eteindre' : 'allumer', label: dev ? 'Éteindre le tunnel' : 'Allumer le tunnel', input: {}, primary: !dev }] };
  if (sv.lan?.length) { nodes.push({ id: 'maison', label: 'Maison', sub: sv.lan.join(', '), square: true, size: 13, color: '#7FB3E6' }); edges.push({ a: 'odin', b: 'maison', w: 2, color: '#7FB3E6' }); details.maison = { kind: 'Réseau', title: 'Réseau de la maison', subtitle: sv.lan.join(', '), rows: [{ k: 'Joint par', v: ps.filter((p) => p.enabled).map((p) => p.name).join(', ') || 'personne', src: '' }] }; }
  if (ps.some((p) => p.full)) { nodes.push({ id: 'internet', label: 'Internet', sub: 'par la box de la maison', square: true, size: 13, color: '#7FB3E6' }); edges.push({ a: 'odin', b: 'internet', w: 2, color: '#7FB3E6' }); details.internet = { kind: 'Internet', title: 'Internet', subtitle: 'les appareils en « tout le trafic » sortent par la maison', rows: [{ k: 'Appareils', v: ps.filter((p) => p.full).map((p) => p.name).join(', '), src: '' }] }; }
  const maxT = Math.max(1, ...ps.map((p) => { const x = d.get(p.pub); return (x?.rx ?? 0) + (x?.tx ?? 0); }));
  const dt = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
  for (const p of ps) {
    const x = d.get(p.pub), on = Boolean(p.enabled && x?.handshake && now - x.handshake < 180_000), id = `v:${p.name}`, rt = r.get(p.pub), ip = p.ip.split('/')[0];
    const ended = Boolean(p.expires && p.expires < new Date(now).toISOString().slice(0, 10));
    nodes.push({ id, label: p.name, sub: `${ip}${on ? ' · connecté' : ended ? ' · accès terminé' : !p.enabled ? ' · désactivé' : ' · hors ligne'}`, size: 8 + Math.round(8 * Math.sqrt(((x?.rx ?? 0) + (x?.tx ?? 0)) / maxT)), color: on ? '#57C98A' : '#E8EAEC', off: !on, ring: ended ? '#EE6A55' : undefined });
    edges.push({ a: id, b: 'odin', w: on ? 3 : 0, color: on ? '#57C98A' : undefined, dash: !on });
    const doms = p.odinDns ? domains(ip).slice(0, 8) : [];
    for (const dm of doms) { const did = `d:${dm.name}`; if (!nodes.some((n) => n.id === did)) nodes.push({ id: did, label: dm.name, sub: dm.blocked ? 'bloqué' : 'demandé', size: 4, color: dm.blocked ? '#F0A040' : '#8E959D' }); edges.push({ a: id, b: did, dash: dm.blocked, color: dm.blocked ? '#F0A040' : undefined }); details[did] ??= { kind: dm.blocked ? 'Domaine bloqué' : 'Domaine demandé', title: dm.name, rows: [{ k: 'Par', v: p.name, src: 'DNS d\'Odin (Sphinx)' }], actions: [dm.blocked ? { action: 'autoriser', label: 'Autoriser', input: { domaine: dm.name }, module: 'vidarr' } : { action: 'bloquer', label: 'Bloquer', input: { domaine: dm.name }, module: 'vidarr' }] }; }
    details[id] = {
      kind: 'Appareil du VPN', title: p.name, subtitle: `${ip} · ${on ? 'connecté' : x?.handshake ? `vu le ${dt(x.handshake)}` : 'jamais connecté'}`,
      chips: [{ label: on ? 'Connecté' : ended ? 'Accès terminé' : !p.enabled ? 'Désactivé' : 'Hors ligne', tone: on ? 'bon' : ended ? 'mauvais' : 'neutre' }, { label: p.full ? 'Tout le trafic' : 'Maison seulement' }, ...(p.odinDns ? [{ label: 'DNS d\'Odin', tone: 'bon' as const }] : []), ...(p.mesh ? [{ label: 'Maillage' }] : [])],
      rows: [
        { k: 'Adresse VPN', v: ip, src: 'Vortex' },
        { k: 'Vient de', v: x?.endpoint || '—', src: x?.endpoint ? (isPrivateV4(x.endpoint.split(':')[0]) ? 'réseau privé (même maison ou même box)' : 'adresse publique : 4G, autre Wi-Fi…') : '' },
        ...(rt ? [{ k: 'Débit', v: `↓ ${mbps(rt.tx)} · ↑ ${mbps(rt.rx)}`, src: 'mesuré dans le tunnel' }] : []),
        { k: 'Échangé', v: `reçu ${human(x?.rx ?? 0)} · envoyé ${human(x?.tx ?? 0)}`, src: 'depuis l\'allumage du tunnel' },
        { k: 'Dernier contact', v: x?.handshake ? dt(x.handshake) : 'jamais', src: 'poignée de main du tunnel' },
        { k: 'Accès', v: p.expires ? `jusqu'au ${p.expires}` : 'sans date de fin', src: '' },
      ],
      ...(doms.length ? { list: { title: 'Domaines demandés (15 dernières minutes)', items: doms.map((dm) => ({ text: dm.name, meta: `${dm.n}${dm.blocked ? ' · bloqué' : ''}`, tone: dm.blocked ? 'attention' as const : undefined })) } } : {}),
      // Pas de bouton « QR code » ici (lot R8) : la page générique le montrerait d'un clic, sans confirmation ni masquage. Il se demande sur la carte de l'appareil (« QR code ou fichier »).
      actions: [{ action: 'lire', label: 'Voir ses paquets (Ariane)', input: { ip }, module: 'ran' }, { action: 'activer', label: p.enabled ? 'Couper l\'accès' : 'Rouvrir l\'accès', input: { nom: p.name, actif: !p.enabled }, primary: !p.enabled }],
    };
  }
  // Tout le trafic : les destinations de chaque appareil (les plus grosses des 15 dernières minutes).
  for (const p of ps) {
    const id = `v:${p.name}`, mine = fl.filter((f) => f.device === p.name && now - f.last < 15 * 60_000);
    const by = new Map<string, { remote: string; name?: string; bytes: number; services: Set<string>; where: string }>();
    for (const f of mine) { const nm = nameOf(f.remote), key = nm ?? f.remote, x = by.get(key) ?? { remote: f.remote, name: nm, bytes: 0, services: new Set<string>(), where: whereTo(f.remote, sv) }; x.bytes += f.up + f.down; x.services.add(serviceOf(f.proto, f.port)); by.set(key, x); }
    const top = [...by.values()].filter((x) => x.where !== 'Odin').sort((a, b) => b.bytes - a.bytes).slice(0, 6), max = Math.max(1, ...top.map((x) => x.bytes));
    for (const x of top) {
      const nid = x.name ? `d:${x.name}` : `ip:${x.remote}`;
      if (!nodes.some((n) => n.id === nid)) nodes.push({ id: nid, label: x.name ?? x.remote, sub: `${x.where} · ${[...x.services].slice(0, 2).join(', ')}`, size: 4 + Math.round(4 * Math.sqrt(x.bytes / max)), color: x.where === 'Internet' ? '#7FB3E6' : '#B48CF0' });
      edges.push({ a: id, b: nid, w: 1 + Math.round(3 * Math.sqrt(x.bytes / max)), color: '#57C98A' });
      details[nid] ??= { kind: x.where === 'Internet' ? 'Destination sur Internet' : 'Destination dans la maison', title: x.name ?? x.remote, subtitle: x.name ? x.remote : undefined, rows: [], actions: [{ action: 'lire', label: 'Voir les paquets (Ariane)', input: { ip: x.remote }, module: 'ran' }] };
      details[nid].rows!.push({ k: p.name, v: `${human(x.bytes)} · ${[...x.services].join(', ')}`, src: 'trafic vu dans le tunnel (15 min)' });
    }
  }
  // Maillage : les appareils maillés se joignent directement.
  const mesh = ps.filter((p) => p.mesh); for (let i = 0; i < mesh.length; i++) for (let j = i + 1; j < mesh.length; j++) edges.push({ a: `v:${mesh[i].name}`, b: `v:${mesh[j].name}`, dash: true, color: '#7FB3E6' });
  return { nodes, edges, details };
}
// ---------------- Trafic du VPN (tout ce qui passe dans le tunnel, par appareil) ----------------
const PORTS: Record<number, string> = { 20: 'FTP', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'Mail (envoi)', 53: 'DNS', 67: 'DHCP', 80: 'Web (HTTP)', 110: 'Mail', 123: 'Heure (NTP)', 143: 'Mail', 443: 'Web (HTTPS)', 445: 'Partage Windows', 465: 'Mail (envoi)', 554: 'Caméra (RTSP)', 587: 'Mail (envoi)', 853: 'DNS chiffré', 993: 'Mail', 995: 'Mail', 1883: 'Domotique (MQTT)', 3389: 'Bureau à distance', 3478: 'Appels (STUN)', 5000: 'NAS', 5001: 'NAS', 5060: 'Téléphonie (SIP)', 5353: 'mDNS', 8006: 'Proxmox', 8080: 'Web', 8096: 'Jellyfin', 8123: 'Home Assistant', 8443: 'Web (HTTPS)', 32400: 'Plex', 51820: 'WireGuard' };
/** Le service d'après le protocole et le port. Pur. */
export function serviceOf(proto: string, port: number): string {
  if (proto === 'UDP' && port === 443) return 'Web (QUIC)';
  if (proto === 'ICMP') return 'Ping';
  return PORTS[port] ? `${PORTS[port]} · ${proto} ${port}` : port ? `${proto} ${port}` : proto;
}
/** Où va l'échange : Odin, un autre appareil du VPN, la maison ou Internet. Pur. */
export function whereTo(ip: string, sv: Pick<Server, 'net'>): 'Odin' | 'VPN' | 'maison' | 'Internet' {
  if (ip === `${sv.net}.1`) return 'Odin';
  if (ip.startsWith(`${sv.net}.`)) return 'VPN';
  return isPrivateV4(ip) || /^(fd|fe80)/i.test(ip) ? 'maison' : 'Internet';
}
const flows = (): Flow[] => VU.flux();
type DayFlow = { device: string; proto: string; remote: string; name?: string; port: number; up: number; down: number; pk: number; first: number; last: number };
const dayFile = (ctx: ModCtx, day: string) => join(ctx.dir, 'trafic', `${day}.json`);
export function readTraffic(ctx: ModCtx, day: string): DayFlow[] { try { return JSON.parse(readFileSync(dayFile(ctx, day), 'utf8')) as DayFlow[]; } catch { return []; } }
const seenTotals = new Map<string, { up: number; down: number; pk: number }>();
/** Ajoute à la journée ce qui est passé depuis le dernier passage (rien n'est perdu si le tunnel redémarre). */
export function saveTraffic(ctx: ModCtx, now: number, fl: Flow[] = flows()): number {
  const day = localDay(now), list = readTraffic(ctx, day), idx = new Map(list.map((x, i) => [`${x.device}|${x.proto}|${x.remote}|${x.port}`, i]));
  let added = 0;
  for (const f of fl) {
    const k = `${f.device}|${f.proto}|${f.remote}|${f.port}`, o = seenTotals.get(k) ?? { up: 0, down: 0, pk: 0 }, pk = f.pkUp + f.pkDown;
    // Le moteur a redémarré (compteurs remis à zéro) : tout compte.
    const reset = f.up < o.up || f.down < o.down, du = reset ? f.up : f.up - o.up, dd = reset ? f.down : f.down - o.down, dp = reset ? pk : pk - o.pk;
    seenTotals.set(k, { up: f.up, down: f.down, pk });
    if (!du && !dd) continue;
    const i = idx.get(k);
    if (i === undefined) { idx.set(k, list.length); list.push({ device: f.device, proto: f.proto, remote: f.remote, name: nameForIp(f.remote), port: f.port, up: du, down: dd, pk: dp, first: f.first, last: f.last }); }
    else { const x = list[i]; x.up += du; x.down += dd; x.pk += dp; x.last = Math.max(x.last, f.last); x.name ??= nameForIp(f.remote); }
    added++;
  }
  if (added) { mkdirSync(join(ctx.dir, 'trafic'), { recursive: true }); writeFileSync(dayFile(ctx, day), JSON.stringify(list.sort((a, b) => b.up + b.down - a.up - a.down).slice(0, 5000))); }
  return added;
}

/**
 * Ce que le moteur du tunnel dit en ce moment (remplaçable pour les essais : le moteur ne tourne que sous Linux) :
 * allumé ou non, et pour chaque appareil la dernière poignée de main, le trafic, l'adresse d'où il vient.
 */
export const VU = {
  allume: (): boolean => Boolean(dev),
  direct: (): Map<string, EnDirect> => new Map((dev?.stats() ?? []).map((x) => [x.publicKey, { handshake: x.lastHandshake ?? 0, rx: x.rx, tx: x.tx, endpoint: x.endpoint ?? '' }])),
  flux: (): Flow[] => dev?.flows() ?? [],
};
/** État des appareils vu par le moteur : dernière poignée de main, trafic, adresse d'où ils viennent. */
function live(): Map<string, EnDirect> { return VU.direct(); }

// ---------------- La box (UPnP) : l'adresse de la maison, le port ----------------
/**
 * Ce que Vortex demande à la box (remplaçable pour les essais : aucun vrai paquet). L'adresse de la maison sur Internet
 * est LUE SUR LA BOX (lot R7) : plus aucun site extérieur n'est interrogé pour la connaître.
 */
export const BOX = {
  /** La passerelle de la machine (par où elle sort sur Internet) : c'est elle, la box. Vide : Odin ne la connaît pas. */
  passerelle: async (ctx: ModCtx): Promise<string> => {
    try { const gw = /default via (\d+\.\d+\.\d+\.\d+)/.exec((await ctx.run('ip', ['route', 'show', 'default'])).out)?.[1] ?? ''; return hoteDeBox(gw) ? gw : ''; } catch { return ''; }
  },
  /** L'adresse de la maison, et QUI l'a donnée (`hote`) : sur un réseau, n'importe quel appareil peut répondre à la place de la box. */
  adresse: async (f?: typeof fetch, passerelle = ''): Promise<{ ip: string; nom: string; hote?: string }> => {
    let gw: Gateway;
    // La passerelle connue d'abord : un autre appareil qui répond plus vite ne prend pas sa place.
    try { gw = await discover({ fetch: f, ...(passerelle ? { hote: passerelle } : {}) }); } catch (e) { if (!passerelle) throw e; gw = await discover({ fetch: f }); }
    // Une box est sur le réseau de la maison : la réponse de quelqu'un d'autre n'est pas crue.
    if (!hoteDeBox(gw.host, true)) throw new Error('ce qui a répondu n\'est pas sur le réseau de la maison');
    return { ip: await externalIp(gw, f), nom: gw.name ?? '', hote: gw.host };
  },
  ouvrir: openPorts, fermer: closePorts,
};
/** Le port du VPN ouvert par Odin sur la box suit le port du tunnel : l'ancien est refermé (rien ne reste ouvert pour rien). */
async function refermerAncienPort(ctx: ModCtx, ancien: number): Promise<string> {
  const up = ctx.settings.upnp as { port?: number } | undefined; if (!up) return '';
  const port = Number(up.port) || ancien; ctx.saveSettings({ upnp: undefined });
  try { await BOX.fermer([{ port, proto: 'UDP' }], ctx.fetch); return ` L'ancien port ${port} est refermé sur la box.`; }
  catch (e) { return ` \u26a0 L'ancien port ${port} est peut-être resté ouvert sur la box (${texteSur((e as Error).message, 120) || 'elle ne répond pas'}) : referme-le dans l'interface de la box.`; }
}

// ---------------- Ce que la page montre (lot R7) : appareils et tunnel, jamais une clé ----------------
const derniers = (ctx: ModCtx): Record<string, Dernier> => ({ ...((ctx.settings.derniers as Record<string, Dernier> | undefined) ?? {}) });
/** Garde la dernière connexion de chaque appareil (quand, depuis quelle adresse) : la carte le dit encore, tunnel éteint. */
function noterDerniers(ctx: ModCtx): void {
  const d = live(), avant = derniers(ctx), apres: Record<string, Dernier> = {}; let change = false;
  for (const p of peers(ctx)) {
    const x = d.get(p.pub), o = avant[p.pub], n = x?.handshake && x.handshake > (o?.t ?? 0) ? { t: x.handshake, de: hoteDe(x.endpoint) } : o;
    if (n) apres[p.pub] = n;
    if (n !== o) change = true;
  }
  if (change || Object.keys(avant).length !== Object.keys(apres).length) ctx.saveSettings({ derniers: apres });
}
/** Le trafic du jour par appareil : ce qui est déjà rangé dans la journée, plus ce qui est passé depuis. Rien n'est écrit. */
function traficDuJour(ctx: ModCtx, now: number): Map<string, { up: number; down: number }> {
  const out = new Map<string, { up: number; down: number }>(), plus = (k: string, up: number, down: number) => { const o = out.get(k) ?? { up: 0, down: 0 }; o.up += up; o.down += down; out.set(k, o); };
  for (const x of readTraffic(ctx, localDay(now))) plus(x.device, x.up, x.down);
  for (const fl of VU.flux()) { const o = seenTotals.get(`${fl.device}|${fl.proto}|${fl.remote}|${fl.port}`) ?? { up: 0, down: 0, pk: 0 }, reset = fl.up < o.up || fl.down < o.down; plus(fl.device, reset ? fl.up : fl.up - o.up, reset ? fl.down : fl.down - o.down); }
  return out;
}
/** L'état du tunnel, lu sans rien créer ni rien lancer. */
function tunnelVu(ctx: ModCtx, moteur = ''): TunnelVpn {
  const sv = ctx.settings.server as Server | undefined, up = ctx.settings.upnp as { cgnat?: boolean } | undefined, b = ctx.settings.box as { quand?: number; ok?: boolean; texte?: string; ip?: string } | undefined;
  const adresse = sv?.endpoint && !/^\[/.test(sv.endpoint) ? texteSur(sv.endpoint, 200) : '', src = ctx.settings.adresseSource;
  return {
    allume: VU.allume(), moteur, port: portVpn(ctx), adresse, trouvee: adresse && (src === 'box' || src === 'main') ? src : '',
    box: b ? { quand: Number(b.quand) || 0, ok: b.ok === true, texte: texteSur(b.texte, 400), ip: adresseBoxSure(b.ip) } : null,
    portBox: up?.cgnat ? 'partage' : up ? 'odin' : ctx.settings.portOpened === true ? 'main' : 'non',
    reseau: `${texteSur(sv?.net ?? '10.8.0', 11)}.0/24`, maison: (sv?.lan ?? []).map((x) => texteSur(x, 43)).filter(Boolean), dns: texteSur(sv?.dns ?? '', 100),
  };
}
/** Tout ce que la page montre, avec les droits de celui qui demande (un membre : ses appareils seulement, sans le tunnel). */
function vpnVu(ctx: ModCtx, moteur = ''): VueVpn {
  const now = ctx.now().getTime();
  return vueVpn({ pairs: peers(ctx), direct: live(), derniers: derniers(ctx), trafic: traficDuJour(ctx, now), now, origine: depuisAdresse(), membre: agissant()?.login, tunnel: tunnelVu(ctx, moteur) });
}
/** Ce que le garde-fou sait d'un appareil : est-ce celui que tu tiens ? Odin sait-il d'où tu agis ? */
function gardeDe(ctx: ModCtx, p: Peer | undefined): { d?: AppareilVpn; origineConnue: boolean } {
  const v = vueVpn({ pairs: p ? [p] : [], direct: live(), derniers: derniers(ctx), trafic: new Map(), now: ctx.now().getTime(), origine: depuisAdresse(), tunnel: tunnelVu(ctx) });
  return { d: v.appareils[0], origineConnue: v.origineConnue };
}
/** Avant d'éteindre le tunnel : passes-tu par le VPN en ce moment ? */
function avisTunnel(ctx: ModCtx): string {
  const o = depuisAdresse(), net = String((ctx.settings.server as Server | undefined)?.net ?? '10.8.0');
  if (!o) return ' \u26a0 Odin ne sait pas depuis quel appareil tu agis : si tu passes par le VPN, tu perds Odin avec lui.';
  const parVpn = o.startsWith(`${net}.`) || peers(ctx).some((p) => gardeDe(ctx, p).d?.ici);
  return parVpn ? ' \u26a0 ATTENTION : tu passes par le VPN en ce moment, tu vas te couper d\'Odin et tu ne pourras pas le rallumer de dehors.' : '';
}
/** Changer le port du tunnel coupe tout le monde d'un coup (toi compris, si tu passes par le VPN) : la confirmation le dit. */
const avisPort = (ctx: ModCtx | undefined): string => { let moi = ''; try { if (ctx) moi = avisTunnel(ctx).replace(' \u26a0', ''); } catch { /* sans avis */ } return ` \u26a0 Tous les appareils connectés sont coupés d'un coup : chacun doit reprendre son QR code ou son fichier.${moi}`; };
/** Un numéro de port bien écrit (entier, de 1 à 65535). */
const portValide = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 65535;
/** Le moteur peut-il tourner ici ? Demandé au plus une fois par minute (la page relit toutes les 5 secondes). */
let moteurVu = { t: 0, why: '' };
async function moteurPret(ctx: ModCtx): Promise<string> {
  if (VU.allume()) return '';
  const t = Date.now(); if (t - moteurVu.t > 60_000) moteurVu = { t, why: (await engineReady(ctx)) ?? '' };
  return moteurVu.why;
}
const ETATS_VPN: Record<AppareilVpn['etat'], string> = { connecte: 'connecté', absent: 'pas connecté', jamais: 'jamais connecté', coupe: 'accès coupé', fini: 'accès terminé' };

// ---------------- Lot R8 : la configuration d'un appareil, gardée au coffre, remontrée sur un geste ----------------
/** L'adresse de la maison telle qu'elle a été validée (lot R7) : lue sur la box, ou écrite et confirmée par le propriétaire. Vide : pas encore connue. */
const adresseValidee = (sv: Server): string => (/^[A-Za-z0-9_.-]{1,200}$/.test(String(sv.endpoint ?? '')) && /[A-Za-z0-9]/.test(String(sv.endpoint)) ? String(sv.endpoint) : '');
/** Les entrées du coffre d'appareils retirés pendant que le coffre était fermé : à effacer dès qu'il est ouvert. Aucune clé ici : l'empreinte de la clé publique, et le nom. */
const aEffacer = (ctx: ModCtx): Array<{ empreinte: string; nom: string }> => ((ctx.settings.aEffacer as Array<{ empreinte: string; nom: string }> | undefined) ?? []).filter((x) => x && typeof x.empreinte === 'string' && typeof x.nom === 'string');
/**
 * Range au coffre la configuration d'un appareil, par le lien Vortex → Thésauros qui existait (il reste visible dans
 * les liens entre applis). `false` : coffre fermé, ou Thésauros désactivé ; rien n'y est écrit.
 */
async function garderAuCoffre(ctx: ModCtx, p: Peer, conf: string): Promise<boolean> {
  if (!coffreOuvert(ctx)) return false;
  const ok = await ctx.call('brisingamen', 'ajouter', { nom: `VPN ${p.name}`, identifiant: p.name, mot_de_passe: conf, site: SITE_AVANT }, 'nouvel accès VPN').then((r) => r.ok !== false, () => false);
  return ok && marquerConfig(ctx, { pub: p.pub, nom: p.name });
}
/**
 * Ce qui attend le coffre : une clé d'appareil encore dans les réglages (appareil d'avant ce lot, ou ajouté coffre fermé)
 * y est rangée puis oubliée ici ; l'entrée d'un appareil retiré coffre fermé y est effacée. Coffre fermé : rien ne bouge.
 */
async function rangerAuCoffre(ctx: ModCtx): Promise<void> {
  if (!coffreOuvert(ctx)) return;
  const sv = ctx.settings.server as Server | undefined; if (!sv?.priv) return;
  const ranges = new Set<string>();
  for (const p of peers(ctx)) {
    // La liste a pu changer pendant une attente : un appareil retiré entre-temps n'est pas rangé, et s'il vient de l'être, son entrée repart.
    const la = (): boolean => peers(ctx).some((x) => x.pub === p.pub);
    if (!p.priv || !la() || !(await garderAuCoffre(ctx, p, clientConf(sv, p, peers(ctx))))) continue;
    if (la()) ranges.add(p.pub); else retirerConfig(ctx, { pub: p.pub, nom: p.name });
  }
  const attente = aEffacer(ctx), reste = attente.filter((x) => retirerConfig(ctx, x).ferme);
  if (!ranges.size && reste.length === attente.length) return;
  // Relu ici (pas avant l'attente) : rien de ce qui a changé entre-temps n'est écrasé.
  ctx.saveSettings({ peers: peers(ctx).map((p) => { if (!ranges.has(p.pub)) return p; const { priv: _cle, ...sans } = p; return sans; }), aEffacer: reste.length ? reste : undefined });
}
/**
 * La configuration d'un appareil, refaite au moment où le propriétaire la demande : sa clé privée relue dans le coffre,
 * l'adresse de la maison validée (jamais une adresse inconnue), ses réglages d'aujourd'hui. Un refus est une phrase claire.
 */
async function confDe(ctx: ModCtx, nom: unknown): Promise<{ p: Peer; conf?: string; refus?: string; code?: string }> {
  const vu = trouverPair(peers(ctx), nom); if (!vu) throw new Error('appareil introuvable');
  const sv = await ready(ctx);
  try { await rangerAuCoffre(ctx); } catch { /* le rangement ne bloque jamais la demande */ }
  const p = peers(ctx).find((x) => x.pub === vu.pub) ?? vu, n = nomVpn(p.name);
  if (!adresseValidee(sv)) return { p, code: 'adresse', refus: `L'adresse de la maison n'est pas encore connue : sans elle, la configuration de « ${n} » ne mènerait nulle part. Fais d'abord l'étape « Adresse de la maison » (onglet « Tunnel »). Rien n'est montré.` };
  const g = cleGardee(ctx, { pub: p.pub, nom: p.name }), cle = g.cle ?? p.priv;
  // Une entrée d'avant ce lot : marquée de la clé publique de l'appareil (les restes du même nom sont effacés).
  if (g.ancienne) marquerConfig(ctx, { pub: p.pub, nom: p.name });
  if (!cle) return g.ferme
    ? { p, code: 'coffre', refus: `Le coffre est fermé : la configuration de « ${n} » y est gardée chiffrée, Odin ne peut pas la relire. Ouvre le coffre (Accueil), puis redemande. Rien n'est montré.` }
    : { p, code: 'absente', refus: `La configuration de « ${n} » n'est plus dans le coffre (Thésauros) : Odin ne peut pas la remontrer. Retire cet appareil, puis ajoute-le de nouveau (il aura une nouvelle clé).` };
  return { p, conf: clientConf(sv, { ...p, priv: cle }, peers(ctx)) };
}
/** Ce qu'il faut savoir avant de scanner : un appareil coupé ou arrivé à sa fin ne se connectera pas. */
const etatPourQr = (ctx: ModCtx, p: Peer): string => (p.expires && p.expires < ctx.now().toISOString().slice(0, 10) ? ` ⚠ Son accès est terminé depuis le ${p.expires} : il ne se connectera pas tant qu'il n'a pas une nouvelle date de fin.` : !p.enabled ? ' ⚠ Son accès est coupé : il ne se connectera pas tant que tu ne l\'as pas rouvert.' : '');
/** L'image et le dessin du QR code d'une configuration ; rien si elle est trop longue pour un QR code. */
function qrDe(conf: string): { svg: string; dessin: NonNullable<ReturnType<typeof dessinSur>> } | undefined {
  const d = dessinSur(conf); if (!d) return undefined;
  try { return { svg: svg(conf, { ecc: 'L', scale: 5 }), dessin: d }; } catch { return undefined; }
}
const TROP_LONGUE = 'Cette configuration est trop longue pour un QR code : prends le fichier (« Fichier de configuration ») et ouvre-le dans l\'appli VPN de l\'appareil.';
/** L'accès d'un appareil, en mots (pour une confirmation). */
const accesEnMots = (i: Record<string, unknown>): string => { const a = s(i.acces).trim(); return a === 'adresses' ? `seulement ces adresses de la maison : ${texteSur(i.adresses, 200) || 'aucune'}` : a === 'maison' || (!a && i.tout === false) ? 'le réseau de la maison seulement' : 'tout son trafic passe par la maison'; };

/**
 * Lot R1 (maquette Réseau validée) : tout ce qui change le VPN, et le QR code ou le fichier d'un appareil (sa clé privée),
 * est au propriétaire seul, par tous les chemins ; chaque changement est noté « qui a fait quoi ». Les autres lectures
 * restent ouvertes selon les droits d'aujourd'hui.
 */
const reseauProprio = (l: Module['actions'], lectures: Module['actions'] = []): Module['actions'] => [...avecJournal('gjoll_actes', auProprietaireSeul(clesLisibles(l), ['qr', 'telecharger'])), ...lectures, actionJournal('gjoll_actes', 'Vortex')];
/** Aucune action qui écrit (ni le QR code, ni le fichier) ne part quand les clés du VPN sont illisibles : rien n'est réécrit par-dessus. */
const clesLisibles = (l: Module['actions']): Module['actions'] => l.map((a) => (a.read && a.id !== 'qr' && a.id !== 'telecharger' ? a : { ...a, run: async (ctx: ModCtx, i: Record<string, unknown>) => { verifierCles(ctx); return a.run(ctx, i); } }));

export const gjoll: Module = {
  id: 'gjoll', name: 'Vortex', family: 'Accès',
  what: 'Le VPN de la maison : tes appareils se connectent chez toi de n\'importe où, chiffré, avec un QR code.',
  does: ['clés générées par Odin (jamais réutilisées)', 'un appareil = une config + un QR code à scanner', 'tout le trafic par la maison, ou seulement le réseau de la maison', 'mode Orion : réseau maillé, les appareils se parlent directement', 'activer, désactiver, révoquer, renommer un appareil', 'date de fin d\'accès : coupé tout seul le jour venu', 'qui est connecté, trafic reçu et envoyé, dernière connexion', 'fichier .conf à télécharger pour un ordinateur', 'moteur VPN écrit dans Odin (Charon) : rien à installer ; les téléphones et ordinateurs se connectent avec l\'appli VPN gratuite « WireGuard »', 'assistant de mise en route : adresse, port de la box, essai depuis dehors', 'réglages du tunnel : port, MTU, maintien de connexion', 'chaque appareil peut passer par le DNS d\'Odin (Sphinx) : pubs et sites dangereux bloqués aussi hors de la maison', 'alerte quand un appareil se connecte'],
  from: ['WireGuard', 'wg-easy', 'Headscale', 'NetBird'], upstream: ['WireGuard/wireguard-go', 'WireGuard/wireguard-tools', 'wg-easy/wg-easy', 'juanfont/headscale', 'netbirdio/netbird'],
  modes: ['Charon · clients', 'Orion · réseau maillé'],
  words: ['vpn', 'wireguard', 'tunnel', 'acces a distance', 'accès à distance', 'depuis l exterieur', 'qr code vpn', 'connexion maison', 'mesh', 'maillage'],
  actions: reseauProprio([
    { id: 'trafic', label: 'Trafic du VPN', what: 'Tout ce qui est passé dans le tunnel : par appareil, vers où, quel service, combien (en direct ou un jour passé)', read: true, params: [{ key: 'jour', label: 'Jour (AAAA-MM-JJ, vide : en direct)', kind: 'text', default: '' }, { key: 'appareil', label: 'Appareil (vide : tous)', kind: 'text', default: '' }], run: (ctx, i) => {
      const day = String(i.jour ?? '').trim(), who = String(i.appareil ?? '').trim().toLowerCase(), sv = server(ctx);
      if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('jour au format AAAA-MM-JJ');
      const rows = (day ? readTraffic(ctx, day).map((x) => ({ ...x, name: x.name })) : flows().map((f) => ({ device: f.device, proto: f.proto, remote: f.remote, name: nameForIp(f.remote), port: f.port, up: f.up, down: f.down, pk: f.pkUp + f.pkDown, first: f.first, last: f.last }))).filter((x) => !who || x.device.toLowerCase().includes(who));
      if (!rows.length) return { text: day ? `Rien d'enregistré dans le tunnel le ${day}.` : dev ? 'Rien n\'est encore passé dans le tunnel.' : 'Le tunnel est éteint.' };
      const per = new Map<string, { up: number; down: number }>(); for (const x of rows) { const o = per.get(x.device) ?? { up: 0, down: 0 }; o.up += x.up; o.down += x.down; per.set(x.device, o); }
      const top = [...rows].sort((a, b) => b.up + b.down - a.up - a.down).slice(0, 15);
      return { text: [`🔎 Trafic du VPN ${day ? `le ${day}` : 'en direct'} :`, ...[...per].map(([d, o]) => `- ${d} : ↑ ${human(o.up)} · ↓ ${human(o.down)}`), 'Plus gros échanges :', ...top.map((x) => `- ${x.device} → ${x.name ? `${x.name} (${x.remote})` : x.remote} · ${whereTo(x.remote, sv)} · ${serviceOf(x.proto, x.port)} · ↑ ${human(x.up)} ↓ ${human(x.down)}`)].join('\n'), data: { rows } };
    } },
    { id: 'ouvrir_port', label: 'Ouvrir le port du VPN sur la box', what: 'Odin ouvre lui-même le port du VPN sur la box (UPnP). Par ce seul port : Odin, son DNS (pubs bloquées), la maison et Internet par la maison', quick: false,
      // Ouvrir la box vers la maison : ta validation, en voyant le port (lu sans rien créer).
      grave: (_i, ctx) => `ouvrir le port ${portVpn(ctx)}/udp de la box vers cette machine (UPnP) : le VPN de la maison devient joignable depuis Internet`,
      run: async (ctx) => {
      const sv = server(ctx);
      // La box refuse ou n'a pas l'UPnP : l'étape repasse au réglage à la main (« C'est fait »).
      const r = await BOX.ouvrir([{ port: sv.port, proto: 'UDP' }], 'Odin · VPN Vortex', ctx.fetch).catch((e) => { ctx.saveSettings({ upnpFailed: true }); throw new Error(`${(e as Error).message}. Ouvre-le à la main : UDP ${sv.port} vers cette machine dans « Redirection de ports » de la box, puis « C'est fait ».`); });
      ctx.saveSettings({ upnpFailed: false });
      ctx.saveSettings({ upnp: { port: sv.port, lease: r.lease, at: Date.now(), ip: adresseBoxSure(r.ip), cgnat: r.cgnat } });
      // L'adresse que la box donne au passage n'est gardée que si c'est bien la box qui a répondu (la passerelle connue) :
      // sinon un appareil de la maison ferait pointer les appareils du VPN vers l'adresse de son choix.
      if (adressePublique(r.ip) && estLaBox(r.gw?.host, await BOX.passerelle(ctx)) && (!sv.endpoint || sv.endpoint.startsWith('['))) ctx.saveSettings({ server: { ...sv, endpoint: adresseBoxSure(r.ip) }, adresseSource: 'box' });
      // Le nom que la box se donne est un texte venu du réseau : nettoyé.
      return { text: `${texteSur(r.text, 900)}\nUn seul port suffit : une fois connecté au VPN, ton téléphone joint l'interface d'Odin, le DNS d'Odin (pubs et sites dangereux bloqués), les appareils de la maison et, en « tout le trafic », Internet par la maison. Le DHCP, lui, ne sert que sur place (il donne les adresses du réseau local) : le VPN donne ses propres adresses.` };
    } },
    { id: 'fermer_port', label: 'Fermer le port du VPN sur la box', what: 'Le VPN ne sera plus joignable depuis Internet', quick: false, grave: (_i, ctx) => { let avis = ''; try { if (ctx) avis = avisTunnel(ctx); } catch { /* sans avis */ } return `refermer le port du VPN : plus d'accès à la maison depuis l'extérieur${avis}`; }, run: async (ctx) => {
      // Le port qu'Odin a ouvert (il peut dater d'avant un changement de port) et celui du tunnel d'aujourd'hui.
      const sv = server(ctx), ouvert = Number((ctx.settings.upnp as { port?: number } | undefined)?.port) || sv.port;
      const t = await BOX.fermer([...new Set([ouvert, sv.port])].map((port) => ({ port, proto: 'UDP' as const })), ctx.fetch); ctx.saveSettings({ upnp: undefined }); return { text: texteSur(t, 400) };
    } },
    { id: 'ports_box', label: 'Ports ouverts sur la box', what: 'La liste des ports ouverts sur la box (par Odin ou d\'autres appareils)', read: true, run: async (ctx) => {
      const gw = await discover({ fetch: ctx.fetch }), l = await listMappings(gw, ctx.fetch);
      // Le nom de la box, et le nom de chaque ouverture (n'importe quel appareil de la maison peut en écrire un) : des textes venus du réseau, nettoyés.
      const nom = texteSur(gw.name, 40), sur = l.map((m) => ({ ...m, external: Number(m.external) || 0, internal: Number(m.internal) || 0, client: texteSur(m.client, 45), desc: texteSur(m.desc, 60) }));
      return { text: sur.length ? [`Box${nom ? ` « ${nom} »` : ''} : ${sur.length} port(s) ouvert(s).`, ...sur.map((m) => `- ${m.external}/${m.proto} → ${m.client}:${m.internal} · ${m.desc || 'sans nom'}${m.client === gw.localIp ? ' (Odin)' : ''}${m.enabled ? '' : ' (désactivé)'}`)].join('\n') : 'Aucun port ouvert sur la box.', data: { mappings: sur } };
    } },
    // Lot R7 : l'adresse de la maison est LUE SUR LA BOX (UPnP). Plus aucun site extérieur n'est interrogé. Si la box ne répond
    // pas, c'est dit, et l'adresse reste à écrire à la main (« Adresse de la maison »). Un nom de domaine mis à la main est gardé.
    { id: 'detecter', label: 'Lire mon adresse publique sur la box', what: 'Demande à la box (UPnP) l\'adresse de la maison sur Internet et la garde ; aucun site extérieur n\'est interrogé', quick: false, run: async (ctx) => {
      const quand = ctx.now().getTime();
      const rate = (texte: string, ip = ''): Error => { ctx.saveSettings({ box: { quand, ok: false, texte, ip } }); return new Error(`${texte} Odin ne demande cette adresse à aucun site extérieur : écris-la à la main (« Adresse de la maison » : l'adresse, ou un nom de domaine). Rien n'est changé.`); };
      let b: { ip: string; nom: string; hote?: string };
      const passerelle = await BOX.passerelle(ctx);
      try { b = await BOX.adresse(ctx.fetch, passerelle); } catch (e) { throw rate(`La box ne répond pas (${texteSur((e as Error).message, 160) || 'aucune réponse'}).`); }
      const ip = adresseBoxSure(b.ip), nom = texteSur(b.nom, 40), box = `la box${nom ? ` « ${nom} »` : ''}`;
      if (!ip) throw rate('La box a répondu, mais sans adresse lisible.');
      if (!adressePublique(ip)) throw rate(`La box dit ${ip} : ce n'est pas une adresse Internet à elle (adresse partagée par l'opérateur, adresse réservée, ou une autre box devant elle). De dehors, on ne joint pas la maison par cette adresse.`, ip);
      const sv = await ready(ctx), avant = /^\[/.test(sv.endpoint) ? '' : sv.endpoint;
      // Sur le réseau de la maison, n'importe quel appareil peut répondre à la place de la box et donner l'adresse de son
      // choix (les appareils du VPN iraient frapper chez un autre). Odin ne garde tout seul que la réponse de la passerelle
      // connue de la machine ; sinon rien n'est changé, et c'est au propriétaire de l'écrire (« Adresse de la maison » : il
      // voit l'adresse d'avant et celle d'après, et il valide).
      if (!estLaBox(b.hote, passerelle) && avant !== ip) {
        const qui = adresseBoxSure(b.hote), texte = `${qui ? `L'appareil ${qui} du réseau` : 'Un appareil du réseau'}${nom ? ` (« ${nom} »)` : ''} dit que l'adresse de la maison est ${ip}, mais Odin ne peut pas vérifier que c'est bien ta box${passerelle ? ` (ta box est à ${passerelle})` : ''}.`;
        ctx.saveSettings({ box: { quand, ok: false, texte, ip } });
        return { ok: false, text: `${texte} Rien n'est changé. Si c'est la bonne adresse, écris-la toi-même (« Adresse de la maison ») : Odin te montrera ce qui change avant de l'enregistrer.`, data: { code: 'a_confirmer', ip } };
      }
      if (avant && !adresseBoxSure(avant)) {
        ctx.saveSettings({ box: { quand, ok: true, texte: `Lue sur ${box} : ${ip}. Ton nom de domaine est gardé.`, ip } });
        return { text: `🌍 Adresse de la maison lue sur ${box} : ${ip}. Tu as mis un nom de domaine (${texteSur(avant, 200)}) : il est gardé, rien n'est changé. Vérifie qu'il mène bien à ${ip}.`, data: { ip, change: false, garde: true } };
      }
      const change = Boolean(avant) && avant !== ip;
      ctx.saveSettings({ server: { ...sv, endpoint: ip }, ...(estLaBox(b.hote, passerelle) ? { adresseSource: 'box' } : {}), box: { quand, ok: true, texte: `Lue sur ${box} : ${ip}.`, ip } });
      return { text: `🌍 Adresse de la maison lue sur ${box} : ${ip} (aucun site extérieur interrogé). Les appareils joindront ${ip}:${sv.port}.${change ? ` Elle a changé (avant : ${avant}) : les appareils déjà ajoutés ne joignent plus la maison tant qu'ils n'ont pas repris leur QR code ou leur fichier.` : ''} Si ta box change d'adresse (redémarrage), mets plutôt un nom de domaine.`, data: { ip, change } };
    } },
    { id: 'port', label: 'Port ouvert sur la box', what: 'Note que la redirection du port est faite sur la box', quick: false, params: [{ key: 'ouvert', label: 'Port ouvert', kind: 'boolean', default: true }], run: (ctx, i) => { ctx.saveSettings({ portOpened: i.ouvert !== false }); return { text: i.ouvert !== false ? '👍 Noté. Prochaine étape : allumer le tunnel.' : 'Noté : port pas encore ouvert.' }; } },
    { id: 'allumer', label: 'Allumer le tunnel', what: 'Démarre le VPN (et au démarrage de la machine)', grave: (_i, ctx) => `allumer le VPN de la maison : le port ${portVpn(ctx)}/udp s'ouvre dans le pare-feu de la machine (Cerbère)`, run: async (ctx) => {
      const msg = await bringUp(ctx); ctx.saveSettings({ on: true });
      return { text: `${msg}${await openOnHost(ctx, [[server(ctx).port, 'udp', 'VPN Vortex']])}` };
    } },
    { id: 'eteindre', label: 'Éteindre le tunnel', what: 'Coupe le VPN pour tous les appareils', quick: false, grave: (_i, ctx) => { let avis = ''; try { if (ctx) avis = avisTunnel(ctx); } catch { /* sans avis */ } return `couper le VPN pour tous les appareils${avis}`; }, undo: () => ({ action: 'allumer', input: {}, label: 'Rallumer le tunnel' }), run: async (ctx) => {
      noterDerniers(ctx); await bringDown(ctx); ctx.saveSettings({ on: false });
      return { text: `⏹ Tunnel coupé.${ctx.settings.upnp ? ' Le port du VPN reste ouvert sur la box (plus rien n\'y répond) : « Fermer le port sur la box » le referme.' : ''}` };
    } },
    { id: 'appareils', label: 'Appareils VPN', what: 'Liste et état', read: true, words: ['appareils', 'qui est connecte', 'connectés'], run: async (ctx) => {
      // « Avec mes droits » : un membre de la famille ne voit que les appareils de son compte ; le propriétaire voit tout.
      const d = live(), q = agissant(), l = q ? peers(ctx).filter((p) => p.compte === q.login) : peers(ctx);
      return { text: l.map((p) => { const x = d.get(p.pub); return `- ${p.name} (${p.ip}) · ${p.enabled ? (x?.handshake && Date.now() - x.handshake < 180_000 ? 'connecté' : 'hors ligne') : 'désactivé'}`; }).join('\n') || (q ? 'Aucun appareil VPN à ton nom.' : 'Aucun appareil.') };
    } },
    // Lot R8 : « Ajouter un appareil » en 3 étapes (la page). Le nom est nettoyé et borné ; l'accès est « toute la maison »,
    // « Internet par la maison » ou « seulement certaines adresses » (de la maison, jamais d'Internet) ; la configuration
    // (avec la clé privée de l'appareil) part dans le coffre, et seulement là quand il est ouvert. `montrer: false` (la
    // page) : la réponse ne porte aucune clé ; le QR code se demande ensuite, sur un geste (« qr »).
    { id: 'ajouter', label: 'Ajouter un appareil', what: 'Nouvelle config + QR code', params: [{ key: 'nom', label: 'Nom de l\'appareil', kind: 'text', required: true }, { key: 'tout', label: 'Tout le trafic par la maison', kind: 'boolean', default: true }, { key: 'maillage', label: 'Réseau maillé (Orion)', kind: 'boolean', default: false }, { key: 'fin', label: 'Fin de l\'accès (AAAA-MM-JJ, vide = sans fin)', kind: 'text', default: '' }, { key: 'dns_odin', label: 'Passer par le DNS d\'Odin (Sphinx)', kind: 'boolean', default: true }, { key: 'acces', label: 'Accès : « maison », « internet » ou « adresses » (vide : d\'après « Tout le trafic »)', kind: 'text', default: '' }, { key: 'adresses', label: 'Pour « adresses » : les seules adresses de la maison (ex. 10.0.0.10, séparées par des virgules)', kind: 'text', default: '' }, { key: 'montrer', label: 'Montrer tout de suite le QR code (il porte la clé secrète de l\'appareil)', kind: 'boolean', default: false }],
      grave: (i) => `ouvrir l'accès VPN à « ${nomVpn(i.nom)} » (${accesEnMots(i)}${/^\d{4}-\d{2}-\d{2}$/.test(s(i.fin).trim()) ? `, jusqu'au ${s(i.fin).trim()}` : ''})`, words: ['ajoute', 'nouvel appareil'], run: async (ctx, i) => {
      // Aucune attente entre la vérification du nom et l'écriture : deux ajouts en même temps ne prennent ni le même nom ni la même adresse.
      const sv = await ready(ctx), ps = peers(ctx), used = new Set(ps.map((p) => p.ip)), nom = nomAppareil(i.nom);
      if (ps.some((p) => p.name === nom || nomVpn(p.name) === nomVpn(nom))) throw new Error('un appareil porte déjà ce nom');
      const fin = finDemandee(i.fin), acces = accesDemande(i, sv.lan ?? []);
      // Une fin d'accès déjà passée : l'appareil serait ouvert jusqu'à la veille suivante, puis coupé. Refusé avant de créer quoi que ce soit.
      if (fin && fin < ctx.now().toISOString().slice(0, 10)) throw new Error(`la fin de l'accès (${fin}) est déjà passée : choisis une date à partir d'aujourd'hui, ou aucune. Rien n'est créé.`);
      let n = 2; while (used.has(`${sv.net}.${n}`)) n++; if (n > 254) throw new Error('plus d\'adresse libre');
      const k = keypair(), p: Peer = { name: nom, ...(fin ? { expires: fin } : {}), pub: k.pub, psk: randomBytes(32).toString('base64'), ip: `${sv.net}.${n}`, created: ctx.now().toISOString(), enabled: true, full: acces.full, ...(acces.seules ? { seules: acces.seules } : {}), mesh: i.maillage === true, odinDns: i.dns_odin !== false };
      const conf = clientConf(sv, { ...p, priv: k.priv }, [...ps, p]);
      ctx.saveSettings({ peers: [...ps, { ...p, priv: k.priv }] });
      // Lien Vortex → Thésauros : la configuration de l'appareil (sa clé privée) est rangée dans le coffre chiffré, et
      // seulement là : dès qu'elle y est, elle quitte les réglages de Vortex. Coffre fermé : elle y attend (chiffrée au
      // repos), et entrera au coffre dès qu'il sera ouvert.
      const kept = await garderAuCoffre(ctx, p, conf);
      // Retiré pendant l'attente du coffre (deux gestes en même temps) : son entrée du coffre repart avec lui.
      if (kept && !peers(ctx).some((x) => x.pub === p.pub)) retirerConfig(ctx, { pub: p.pub, nom: p.name });
      if (kept) ctx.saveSettings({ peers: peers(ctx).map((x) => (x.pub === p.pub ? p : x)) });
      const msg = await apply(ctx), dnsNote = await linkDns(ctx, p);
      const connue = Boolean(adresseValidee(sv)), q = connue && i.montrer !== false ? qrDe(conf) : undefined;
      const noAddr = connue ? '' : ' ⚠ L\'adresse de la maison n\'est pas encore connue : pas de QR code pour l\'instant. Fais l\'étape « Adresse de la maison », puis montre son QR code.';
      const garde = kept ? ' Sa configuration est rangée dans le coffre (Thésauros), chiffrée : tu pourras remontrer son QR code.' : ' ⚠ Le coffre est fermé : sa configuration attend, chiffrée, dans les réglages de Vortex ; elle ira dans le coffre dès qu\'il sera ouvert.';
      return { text: `📱 « ${p.name} » ajouté (${p.ip}).${q ? ' Scanne ce QR code avec l\'appli WireGuard.' : connue && i.montrer !== false ? ` ${TROP_LONGUE}` : ''}${noAddr}${dnsNote}${garde}\n${msg}`, data: { name: p.name, ip: p.ip, garde: kept, adresse: connue, filename: confName(p), ...(q ? { svg: q.svg, dessin: q.dessin } : {}), ...(connue && i.montrer !== false ? { conf } : {}) } };
    } },
    // Remontrer le QR code, ou remettre le fichier : un geste du propriétaire (« propriétaire seul », lot R1), noté « qui a
    // fait quoi ». La page le fait confirmer dans la carte de l'appareil avant de le demander ; ces deux lectures restent
    // sans validation côté serveur, comme le lot R1 les a fixées (sa session les reçoit en une demande). La clé est relue
    // dans le coffre au moment du geste ; rien n'est gardé ailleurs.
    { id: 'qr', label: 'QR code', what: 'QR code de configuration (à scanner)', read: true, params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }],
      run: async (ctx, i) => {
        const c = await confDe(ctx, i.nom); if (!c.conf) return { ok: false, text: String(c.refus), data: { code: c.code } };
        const q = qrDe(c.conf); if (!q) return { ok: false, text: TROP_LONGUE, data: { code: 'long' } };
        return { text: `QR code de « ${nomVpn(c.p.name)} » : ouvre l'appli WireGuard → « + » → « Scanner un QR code ».${etatPourQr(ctx, c.p)}`, data: { svg: q.svg, dessin: q.dessin, conf: c.conf, filename: confName(c.p) } };
      } },
    { id: 'telecharger', label: 'Fichier de configuration', what: 'Le fichier .conf d\'un appareil (pour un ordinateur)', read: true, params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }],
      run: async (ctx, i) => {
        const c = await confDe(ctx, i.nom); if (!c.conf) return { ok: false, text: String(c.refus), data: { code: c.code } };
        return { text: `Configuration de « ${nomVpn(c.p.name)} » : dans l'appli WireGuard de l'ordinateur, « Importer un tunnel depuis un fichier ».${etatPourQr(ctx, c.p)}`, data: { conf: c.conf, filename: confName(c.p) } };
      } },
    { id: 'modifier', label: 'Modifier un appareil', what: 'Nom, tout le trafic ou maison seulement, maillage, date de fin d\'accès', params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }, { key: 'nouveau_nom', label: 'Nouveau nom (vide = inchangé)', kind: 'text', default: '' }, { key: 'tout', label: 'Tout le trafic par la maison', kind: 'select', options: ['inchangé', 'oui', 'non'], default: 'inchangé' }, { key: 'maillage', label: 'Réseau maillé', kind: 'select', options: ['inchangé', 'oui', 'non'], default: 'inchangé' }, { key: 'fin', label: 'Fin de l\'accès (AAAA-MM-JJ, « aucune » pour retirer)', kind: 'text', default: '' }, { key: 'dns_odin', label: 'DNS d\'Odin (Sphinx)', kind: 'select', options: ['inchangé', 'oui', 'non'], default: 'inchangé' }], run: async (ctx, i) => {
      const ps = peers(ctx), p = ps.find((x) => x.name === s(i.nom)); if (!p) throw new Error('appareil introuvable');
      const nn = s(i.nouveau_nom).trim() ? nomAppareil(i.nouveau_nom) : '', fin = s(i.fin).trim();
      // Une date de fin déjà passée coupe l'appareil à la prochaine veille : jamais celui que tu tiens sans que tu le dises.
      if (p.enabled && /^\d{4}-\d{2}-\d{2}$/.test(fin) && fin < ctx.now().toISOString().slice(0, 10)) { const g = gardeVpn(gardeDe(ctx, p).d, 'couper', { leMien: i.le_mien === true }); if (g.refus) return { ok: false, text: g.refus, data: { code: g.code } }; }
      if (nn && ps.some((x) => x.name === nn && x !== p)) throw new Error('un appareil porte déjà ce nom');
      if (fin && fin !== 'aucune') finDemandee(fin);
      const q: Peer = { ...p, ...(nn ? { name: nn } : {}), ...(s(i.tout) === 'oui' ? { full: true } : s(i.tout) === 'non' ? { full: false } : {}), ...(s(i.maillage) === 'oui' ? { mesh: true } : s(i.maillage) === 'non' ? { mesh: false } : {}), ...(s(i.dns_odin) === 'oui' ? { odinDns: true } : s(i.dns_odin) === 'non' ? { odinDns: false } : {}) };
      const today = ctx.now().toISOString().slice(0, 10), wasLate = Boolean(p.expires && p.expires < today);
      // Un accès coupé parce qu'il était arrivé à sa fin se rouvre avec une nouvelle date (ou sans date) ; un appareil désactivé à la main le reste.
      if (fin === 'aucune') { delete q.expires; if (wasLate) q.enabled = true; } else if (fin) { q.expires = fin; if (wasLate && fin >= today) q.enabled = true; }
      ctx.saveSettings({ peers: ps.map((x) => (x === p ? q : x)) });
      // Sa configuration gardée au coffre porte son nom : elle le suit (coffre fermé : elle reste reconnue par sa clé publique).
      if (q.name !== p.name) renommerConfig(ctx, { pub: p.pub, avant: p.name, apres: q.name });
      const routing = q.full !== p.full || q.mesh !== p.mesh || Boolean(q.odinDns) !== Boolean(p.odinDns);
      const dnsNote = q.odinDns !== p.odinDns || q.name !== p.name ? await linkDns(ctx, q, p.name) : '';
      return { text: `✏️ « ${q.name} » modifié${q.expires ? ` · accès jusqu'au ${q.expires}` : ''}.${dnsNote}${routing ? ' Rescanne son QR code pour que le changement s\'applique sur l\'appareil.' : ''}\n${await apply(ctx)}` };
    } },
    { id: 'serveur', label: 'Réglages du tunnel', what: 'Port, taille des paquets (MTU), maintien de la connexion', quick: false, params: [{ key: 'port', label: 'Port UDP', kind: 'number', default: 51820 }, { key: 'mtu', label: 'MTU (vide = automatique, 1280 si ça coupe en 4G)', kind: 'text', default: '' }, { key: 'keepalive', label: 'Maintien de la connexion (secondes)', kind: 'number', default: 25 }], grave: (i, ctx) => `changer les réglages du tunnel VPN${ctx && (Number(i.port) || portVpn(ctx)) !== portVpn(ctx) ? ` : il écoutera sur le port ${texteSur(i.port, 8)}/udp au lieu de ${portVpn(ctx)}/udp${avisPort(ctx)}` : ''}`, run: async (ctx, i) => {
      const sv = await ready(ctx), port = Number(i.port) || sv.port, mtu = s(i.mtu).trim() ? Number(i.mtu) : undefined, ka = Number(i.keepalive) || 25;
      if (!portValide(port)) throw new Error('port entre 1 et 65535');
      if (mtu !== undefined && (!Number.isInteger(mtu) || mtu < 1280 || mtu > 1500)) throw new Error('MTU entre 1280 et 1500');
      if (ka < 0 || ka > 600) throw new Error('maintien entre 0 et 600 secondes');
      const nsv: Server = { ...sv, port, keepalive: ka }; if (mtu) nsv.mtu = mtu; else delete nsv.mtu;
      ctx.saveSettings({ server: nsv, ...(port !== sv.port ? { portOpened: false } : {}) });
      const ancien = port !== sv.port ? await refermerAncienPort(ctx, sv.port) : '';
      return { text: `⚙️ Port ${port}${mtu ? ` · MTU ${mtu}` : ''} · maintien ${ka} s.${port !== sv.port ? ` Ouvre le port ${port} (UDP) sur la box, et rescanne les QR codes.${ancien}` : ' Rescanne les QR codes pour appliquer sur les appareils.'}\n${await apply(ctx)}` };
    } },
    // Lot R7 : jamais couper ni retirer l'appareil que tu tiens sans que tu l'aies dit en clair (« le_mien »), et un
    // avertissement dans la confirmation quand Odin ne sait pas depuis quel appareil tu agis.
    { id: 'activer', label: 'Activer / désactiver', what: 'Coupe ou rouvre l\'accès d\'un appareil', params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }, { key: 'actif', label: 'Actif', kind: 'boolean', default: false }],
      grave: (i, ctx) => {
        if (i.actif === true) return `rouvrir l'accès au VPN de la maison pour l'appareil « ${nomVpn(i.nom)} »`;
        // Couper reste libre, sauf quand c'est l'appareil que tu tiens ou qu'Odin ne sait pas d'où tu agis.
        let avis = ''; try { const p = ctx ? trouverPair(peers(ctx), i.nom) : undefined; if (ctx && p?.enabled) { const g = gardeDe(ctx, p); avis = avisOrigine(g.d, g.origineConnue); } } catch { /* sans avis */ }
        return avis ? `couper l'accès au VPN de « ${nomVpn(i.nom)} » (tu pourras le rouvrir)${avis}` : undefined;
      },
      run: async (ctx, i) => {
        const ps = peers(ctx), p = trouverPair(ps, i.nom), actif = i.actif === true; if (!p) throw new Error('appareil introuvable');
        if (!actif && p.enabled) { const g = gardeVpn(gardeDe(ctx, p).d, 'couper', { leMien: i.le_mien === true }); if (g.refus) return { ok: false, text: g.refus, data: { code: g.code } }; }
        if (actif && p.expires && p.expires < ctx.now().toISOString().slice(0, 10)) throw new Error(`l'accès de « ${nomVpn(p.name)} » est terminé depuis le ${p.expires} : donne-lui d'abord une nouvelle date de fin (« Modifier un appareil »). Rien n'est changé.`);
        ctx.saveSettings({ peers: ps.map((x) => (x === p ? { ...x, enabled: actif } : x)) });
        return { text: `${actif ? '✅ Réactivé' : '⏸ Désactivé'} : ${p.name}\n${await apply(ctx)}` };
      } },
    { id: 'revoquer', label: 'Révoquer', what: 'Supprime définitivement l\'accès d\'un appareil : sa clé ne vaut plus rien', params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }],
      grave: (i, ctx) => {
        let avis = ''; try { const p = ctx ? trouverPair(peers(ctx), i.nom) : undefined; if (ctx && p) { const g = gardeDe(ctx, p); avis = avisOrigine(g.d, g.origineConnue); } } catch { /* sans avis */ }
        return `révoquer l'accès VPN de « ${nomVpn(i.nom)} » : sa clé ne vaudra plus rien, il faudra l'ajouter de nouveau${avis}`;
      },
      run: async (ctx, i) => {
        const ps = peers(ctx), p = trouverPair(ps, i.nom); if (!p) throw new Error('appareil introuvable');
        const g = gardeVpn(gardeDe(ctx, p).d, 'retirer', { leMien: i.le_mien === true }); if (g.refus) return { ok: false, text: g.refus, data: { code: g.code } };
        const d = derniers(ctx); delete d[p.pub];
        // Sa configuration gardée au coffre est effacée avec lui (lot R8). Coffre fermé : notée, effacée dès qu'il sera ouvert.
        const c = retirerConfig(ctx, { pub: p.pub, nom: p.name });
        ctx.saveSettings({ peers: ps.filter((x) => x !== p), derniers: d, ...(c.ferme ? { aEffacer: [...aEffacer(ctx), { empreinte: empreinteDe(p.pub), nom: p.name }].slice(-250) } : {}) });
        await ctx.call('vidarr', 'retirer_appareil', { nom: `VPN · ${p.name}` }, 'accès VPN révoqué', { interne: true }).catch(() => undefined);
        const coffre = c.retires ? ' Sa configuration gardée au coffre est effacée.' : c.ferme && !p.priv ? ' Le coffre est fermé : sa configuration gardée y sera effacée dès qu\'il sera ouvert (elle ne sert plus à rien).' : '';
        return { text: `🗝 Accès de ${p.name} révoqué : sa clé ne vaut plus rien.${coffre}\n${await apply(ctx)}` };
      } },
    { id: 'adresse', label: 'Adresse publique', what: 'Adresse ou domaine par lequel on joint la maison', params: [{ key: 'adresse', label: 'Adresse ou domaine', kind: 'text', required: true }, { key: 'port', label: 'Port', kind: 'number', default: 51820 }],
      // Changer l'adresse publique du VPN (ou son port) : validation, avant → après. La même : rien à valider.
      grave: (i, ctx) => {
        const sv = ctx?.settings.server as Server | undefined, adr = s(i.adresse).trim(), port = Number(i.port) || 51820, p0 = portVpn(ctx);
        const avant = sv?.endpoint && !/^\[/.test(sv.endpoint) ? `${sv.endpoint}:${p0}` : 'pas encore connue', apres = `${adr}:${port}`;
        if (!/^[\w.-]{1,200}$/.test(adr) || avant === apres) return undefined;
        return `changer l'adresse publique du VPN de la maison : ${avant} → ${apres} (les appareils joindront la maison par ${apres})${port !== p0 ? ` ; le VPN écoutera sur le port ${port}/udp au lieu de ${p0}/udp (le pare-feu de la machine n'est pas changé)${avisPort(ctx)}` : ''}`;
      },
      run: async (ctx, i) => {
        const sv = await ready(ctx), adr = s(i.adresse).trim(), port = Number(i.port) || 51820;
        if (!/^[\w.-]{1,200}$/.test(adr) || !/[A-Za-z0-9]/.test(adr)) throw new Error('adresse ou domaine invalide');
        // Un port mal écrit éteindrait le tunnel pour tout le monde (il ne pourrait plus écouter) : refusé avant d'y toucher.
        if (!portValide(port)) throw new Error('port entre 1 et 65535. Rien n\'est changé.');
        ctx.saveSettings({ server: { ...sv, endpoint: adr, port }, adresseSource: 'main', ...(port !== sv.port ? { portOpened: false } : {}) });
        const ancien = port !== sv.port ? await refermerAncienPort(ctx, sv.port) : '';
        return { text: `🌍 Les appareils joindront ${adr}:${port}. Pense à ouvrir ce port (UDP) sur ta box vers cette machine.${ancien}\n${await apply(ctx)}` };
      } },
    { id: 'reseaux', label: 'Réseaux de la maison', what: 'Réseaux ouverts aux appareils du VPN, et DNS donné aux appareils', params: [{ key: 'reseaux', label: 'Réseaux (ex. 192.168.1.0/24, séparés par des virgules)', kind: 'text', default: '' }, { key: 'dns', label: 'DNS (vide = celui de la box)', kind: 'text', default: '' }],
      // Ouvrir un réseau de plus aux appareils du VPN : validation, avant → après. Retirer un réseau : libre.
      // Un DNS hors de la maison (ni une adresse de la maison, ni Odin) : validation ; celui de la maison ou d'Odin : libre.
      grave: (i, ctx) => {
        const sv = ctx?.settings.server as Server | undefined, out: string[] = [];
        const avant = sv?.lan ?? [], apres = s(i.reseaux).split(',').map((x) => x.trim()).filter(Boolean);
        if (apres.some((x) => !avant.includes(x))) out.push(`ouvrir aux appareils du VPN les réseaux de la maison : ${avant.join(', ') || 'aucun'} → ${apres.join(', ')}`);
        const dns = s(i.dns).split(',').map((x) => x.trim()).filter(Boolean), net = sv?.net ?? '10.8.0';
        const dehors = dns.filter((x) => !isPrivateV4(x) && !x.startsWith(`${net}.`));
        if (dehors.length && dns.join(', ') !== (sv?.dns ?? '').split(',').map((x) => x.trim()).join(', ')) out.push(`donner aux appareils du VPN un DNS hors de la maison : ${sv?.dns || 'celui de la box'} → ${dns.join(', ')} ; leurs demandes de noms (les sites qu'ils visitent) partiront vers ce serveur extérieur (${dehors.join(', ')})`);
        return out.length ? out.join(' ; ') : undefined;
      },
      run: async (ctx, i) => {
      const sv = await ready(ctx), lan = s(i.reseaux).split(',').map((x) => x.trim()).filter(Boolean), dns = s(i.dns).trim();
      if (lan.some((c) => !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(c))) throw new Error('réseau attendu sous la forme 192.168.1.0/24');
      if (dns && !/^\d{1,3}(\.\d{1,3}){3}(,\s*\d{1,3}(\.\d{1,3}){3})*$/.test(dns)) throw new Error('DNS : une ou plusieurs adresses IP');
      ctx.saveSettings({ server: { ...sv, ...(s(i.reseaux).trim() ? { lan } : {}), ...(dns ? { dns } : {}) } });
      return { text: `🏠 Réseaux ouverts au VPN : ${(lan.length ? lan : sv.lan ?? []).join(', ') || 'aucun'} · DNS : ${dns || sv.dns || 'aucun donné (chaque appareil garde le sien)'}. Les appareils déjà ajoutés doivent rescanner leur QR code.` };
    } },
  ], [
    // Lot R7 : ce que la page de Vortex montre. Une lecture : aucune clé dedans (ni celle d'un appareil, ni celle d'Odin).
    // Un membre de la famille n'y voit que les appareils rattachés à son compte, et rien du tunnel (ni l'adresse de la maison).
    // Réservée au propriétaire en personne (ou à un membre, avec sa vue réduite) : ni une automatisation, ni un assistant ne
    // lit d'où se connectent les appareils ni l'adresse de la maison. Hors du journal « qui a fait quoi » : la page la relit
    // toutes les 5 secondes.
    { id: 'appareils_vus', label: 'Appareils du VPN et tunnel (la page)', what: 'Chaque appareil du VPN : connecté ou non, dernière connexion, depuis quelle adresse, trafic du jour ; et l\'état du tunnel. Aucune clé n\'est donnée', read: true, external: true, quick: false, proprietaireSeul: () => !agissant(), run: async (ctx) => {
      const v = vpnVu(ctx, agissant() ? '' : await moteurPret(ctx)), tn = v.tunnel;
      const quand = (x: number) => new Date(x).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      const tete = v.limite || `Tunnel ${v.allume ? 'allumé' : 'éteint'}${tn?.adresse ? ` · maison : ${tn.adresse}, port ${tn.port} (UDP)` : tn ? ' · adresse de la maison pas encore connue' : ''}.`;
      return { text: [tete, ...v.appareils.map((d) => `- ${d.nom} (${d.ip}) · ${ETATS_VPN[d.etat]}${d.vu ? ` · dernière connexion ${quand(d.vu)}${d.depuis ? ` depuis ${d.depuis}` : ''}` : ''} · reçu ${human(d.recu)} · envoyé ${human(d.envoye)}`), ...(v.appareils.length || v.limite ? [] : ['Aucun appareil.'])].join('\n'), data: v };
    } },
  ]),
  async view(ctx) {
    const sv = server(ctx), d = live(), now = Date.now();
    const graph = { kind: 'graph' as const, title: 'Graphe du VPN', ...vpnGraph(sv, peers(ctx), d, rates(d, now), now, (ip) => recentDomains(ip, now - 15 * 60_000), flows(), nameForIp), legend: [['#4F9DDE', 'Odin, maison, Internet'], ['#57C98A', 'connecté (tunnel)'], ['#7d8791', 'hors ligne'], ['#F0A040', 'bloqué par le DNS'], ['#EE6A55', 'accès terminé']] as Array<[string, string]>, empty: 'Aucun appareil : ajoute ton téléphone à droite.' };
    const steps = await setup(ctx), ps = peers(ctx), online = ps.filter((p) => { const x = d.get(p.pub); return x?.handshake && Date.now() - x.handshake < 180_000; });
    return {
      subtitle: `Joignable sur ${sv.endpoint}:${sv.port} (UDP) · réseau ${sv.net}.0/24${sv.lan?.length ? ` · maison : ${sv.lan.join(', ')}` : ''}${dev ? ' · tunnel allumé' : ' · tunnel éteint'}`,
      tabs: ['Charon · clients', 'Vortex · tunnel', 'Orion · maillage'],
      kpis: [{ label: 'Appareils', value: String(ps.length) }, { label: 'Connectés', value: String(online.length), tone: online.length ? 'bon' : 'neutre' }, { label: 'Maillage', value: String(ps.filter((p) => p.mesh).length) }],
      sections: [...(steps.every((x) => x.done) ? [] : [{ kind: 'steps' as const, title: 'Mettre en route le VPN', items: steps }]), graph, { kind: 'table', title: 'Appareils', columns: ['Appareil', 'Adresse', 'État', 'Reçu', 'Envoyé', 'Trafic', 'Fin d\'accès'], empty: 'Aucun appareil : ajoute ton téléphone à droite.', rows: ps.map((p) => { const x = d.get(p.pub), on = x?.handshake && Date.now() - x.handshake < 180_000; return { cells: [p.name, p.ip, !p.enabled ? 'désactivé' : on ? 'connecté' : x?.handshake ? `vu ${new Date(x.handshake).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : 'jamais', human(x?.rx ?? 0), human(x?.tx ?? 0), `${p.full ? 'tout' : 'maison seulement'}${p.odinDns ? ' · DNS d\'Odin' : ''}`, p.expires ?? '—'], tone: !p.enabled ? 'neutre' : on ? 'bon' : undefined, actions: [{ action: 'activer', label: p.enabled ? 'Désactiver' : 'Réactiver', input: { nom: p.name, actif: !p.enabled } }, { action: 'revoquer', label: 'Révoquer', input: { nom: p.name } }] }; }) }, { kind: 'table', title: 'Trafic du VPN (tout ce qui passe dans le tunnel)', columns: ['Appareil', 'Vers', 'Où', 'Service', '↑ Envoyé', '↓ Reçu', 'Paquets', 'Dernière activité'], empty: dev ? 'Rien n\'est encore passé dans le tunnel.' : 'Tunnel éteint.', rows: flows().sort((a, b) => b.last - a.last).slice(0, 80).map((f) => { const w = whereTo(f.remote, sv), nm = nameForIp(f.remote); return { cells: [f.device, nm ? `${nm} (${f.remote})` : f.remote, w, serviceOf(f.proto, f.port), human(f.up), human(f.down), String(f.pkUp + f.pkDown), new Date(f.last).toLocaleTimeString('fr-FR')], tone: now - f.last < 60_000 ? 'bon' as const : undefined, actions: [{ action: 'lire', label: 'Paquets (Ariane)', input: { ip: f.remote }, module: 'ran' }] }; }) }],
      side: [{ kind: 'form', title: 'Ajouter un appareil', action: 'ajouter', submit: 'Ajouter', params: gjoll.actions.find((a) => a.id === 'ajouter')?.params ?? [] }, { kind: 'form', title: 'Adresse de la maison', action: 'adresse', submit: 'Enregistrer', params: gjoll.actions.find((a) => a.id === 'adresse')?.params ?? [] }, { kind: 'form', title: 'Modifier un appareil', action: 'modifier', submit: 'Modifier', params: gjoll.actions.find((a) => a.id === 'modifier')?.params ?? [] }],
    };
  },
  // Odin redémarre : le tunnel qui était allumé se rallume tout seul.
  async start(ctx) { if (ctx.settings.on === true) { try { await bringUp(ctx); } catch (e) { ctx.alert({ level: 'haute', title: 'Le VPN n\'a pas pu redémarrer', detail: (e as Error).message, key: 'vpn-demarrage' }); } } },
  stop() { dev?.stop(); dev = undefined; devPort = 0; },
  watch: { every: 120, async run(ctx) {
    // Clés illisibles (la clé de la machine a changé) : la veille ne touche à rien, et le dit une fois.
    try { verifierCles(ctx); } catch (e) { ctx.alert({ level: 'haute', title: 'Les clés du VPN sont illisibles', detail: `${(e as Error).message}.`, key: 'vpn-cles' }); return; }
    // Ce qui attend le coffre (une clé d'appareil encore dans les réglages, une entrée à effacer) y est rangé dès qu'il est ouvert.
    try { await rangerAuCoffre(ctx); } catch { /* au prochain passage */ }
    // Le trafic du tunnel rejoint l'historique de la journée (un fichier par jour).
    if (dev) saveTraffic(ctx, Date.now());
    // Ouverture de la box d'une journée : renouvelée deux fois par jour.
    const up = ctx.settings.upnp as { port: number; lease: number; at: number } | undefined;
    if (up?.lease && Date.now() - up.at > 12 * 3600_000) { try { const r = await BOX.ouvrir([{ port: up.port, proto: 'UDP' }], 'Odin · VPN Vortex', ctx.fetch); ctx.saveSettings({ upnp: { ...up, lease: r.lease, at: Date.now() } }); } catch (e) { ctx.alert({ level: 'haute', title: 'Le port du VPN n\'a pas pu être rouvert sur la box', detail: (e as Error).message, key: 'vpn-upnp' }); } }
    // Accès arrivés à leur fin : coupés tout seuls (et dit).
    const late = expired(peers(ctx), ctx.now());
    if (late.length) {
      ctx.saveSettings({ peers: peers(ctx).map((p) => (late.some((x) => x.name === p.name) ? { ...p, enabled: false } : p)) });
      await apply(ctx);
      for (const p of late) ctx.alert({ level: 'info', title: `Accès VPN de « ${p.name} » terminé`, detail: `Fin prévue le ${p.expires}. Pour le rouvrir : Modifier → nouvelle date de fin.`, key: `vpn-fin-${p.name}`, lien: 'gjoll-alerte-fin-acces' });
    }
    if (!dev) return;
    noterDerniers(ctx);
    const d = live(), was = (ctx.settings.online as string[] | undefined) ?? [], now: string[] = [];
    for (const p of peers(ctx)) { const x = d.get(p.pub); if (x?.handshake && Date.now() - x.handshake < 180_000) { now.push(p.name); if (!was.includes(p.name)) ctx.emit('vpn_connecte', { appareil: p.name, depuis: x.endpoint }); } }
    const seen = new Set([...((ctx.settings.seen as string[] | undefined) ?? []), ...now]);
    ctx.saveSettings({ online: now, seen: [...seen] });
  } },
};
