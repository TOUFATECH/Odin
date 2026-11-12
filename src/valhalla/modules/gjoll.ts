// Gjöll — le VPN d'Odin : un seul moteur WireGuard pour les tunnels, les clients avec QR code
// (mode « Gjallarbrú ») et le réseau maillé entre tes appareils (mode « Gleipnir »).
// Clés générées par Odin, configuration écrite et appliquée avec ton accord, QR code à scanner.

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPrivateV4, localSubnets } from '../../hlidskjalf/discover.ts';
import { svg } from '../qr.ts';
import type { ModCtx, Module } from '../types.ts';

export interface Peer { name: string; pub: string; priv?: string; psk: string; ip: string; created: string; enabled: boolean; full: boolean; mesh?: boolean; endpoint?: string; /** fin de l'accès (AAAA-MM-JJ) : passé ce jour, l'appareil est coupé tout seul */ expires?: string }
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
  return sv;
}
/** Complète ce qui dépend de la machine (une fois) : réseaux de la maison, DNS, façon de faire suivre le trafic. */
async function ready(ctx: ModCtx): Promise<Server> {
  const sv = server(ctx); let changed = false;
  if (!sv.lan) { sv.lan = homeLans().filter((c) => !c.startsWith(`${sv.net}.`)); changed = true; }
  if (!sv.dns || sv.dns === `${sv.net}.1`) {
    // Le DNS de la box (il connaît aussi les noms de la maison) ; à défaut, un résolveur public.
    const gw = /default via (\d+\.\d+\.\d+\.\d+)/.exec((await ctx.run('ip', ['route', 'show', 'default'])).out)?.[1];
    sv.dns = gw && isPrivateV4(gw) ? gw : '1.1.1.1'; changed = true;
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
  return `[Interface]\n# Gjöll (Odin) — ne pas modifier à la main\nAddress = ${sv.net}.1/24\nListenPort = ${sv.port}\nPrivateKey = ${sv.priv}\n${sv.mtu ? `MTU = ${sv.mtu}\n` : ''}${f ? `PostUp = ${f.up}\nPostDown = ${f.down}\n` : ''}${ps.filter((p) => p.enabled).map((p) => `\n[Peer]\n# ${p.name}\nPublicKey = ${p.pub}\nPresharedKey = ${p.psk}\nAllowedIPs = ${p.ip}/32\n`).join('')}`;
}
export function clientConf(sv: Server, p: Peer, all: Peer[] = []): string {
  // « Maison seulement » : le réseau du VPN et les réseaux de la maison ; « tout » : tout le trafic.
  const allowed = p.full ? '0.0.0.0/0, ::/0' : [`${sv.net}.0/24`, ...(sv.lan ?? [])].join(', ');
  const mesh = p.mesh ? all.filter((x) => x.mesh && x.enabled && x.name !== p.name && x.endpoint).map((x) => `\n[Peer]\n# ${x.name} (maillage)\nPublicKey = ${x.pub}\nEndpoint = ${x.endpoint}\nAllowedIPs = ${x.ip}/32\nPersistentKeepalive = 25\n`).join('') : '';
  return `[Interface]\nPrivateKey = ${p.priv}\nAddress = ${p.ip}/32\n${sv.dns ? `DNS = ${sv.dns}\n` : ''}${sv.mtu ? `MTU = ${sv.mtu}\n` : ''}\n[Peer]\n# Maison (Odin)\nPublicKey = ${sv.pub}\nPresharedKey = ${p.psk}\nEndpoint = ${sv.endpoint}:${sv.port}\nAllowedIPs = ${allowed}\nPersistentKeepalive = ${sv.keepalive ?? 25}\n${mesh}`;
}
/** `wg show <iface> dump` → dernière poignée de main et trafic par clé publique. */
export function parseDump(out: string): Map<string, { handshake: number; rx: number; tx: number; endpoint: string }> {
  const m = new Map<string, { handshake: number; rx: number; tx: number; endpoint: string }>();
  for (const l of out.trim().split('\n').slice(1)) { const c = l.split('\t'); if (c.length >= 7) m.set(c[0], { endpoint: c[2], handshake: Number(c[4]) * 1000, rx: Number(c[5]), tx: Number(c[6]) }); }
  return m;
}
/** Nom de fichier de la configuration d'un appareil (l'appli WireGuard prend le nom du fichier comme nom du tunnel). */
export const confName = (p: Peer) => `maison-${p.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'appareil'}.conf`;
/** Appareils dont l'accès est arrivé à son terme (jour passé). Pur. */
export const expired = (ps: Peer[], now: Date) => ps.filter((p) => p.enabled && p.expires && p.expires < now.toISOString().slice(0, 10));
/** Où en est la mise en route du VPN : chaque étape, faite ou à faire. */
export async function setup(ctx: ModCtx): Promise<Array<{ title: string; detail?: string; done: boolean; action?: string; input?: Record<string, unknown>; button?: string }>> {
  const sv = server(ctx), wg = await ctx.has('wg'), up = wg ? (await ctx.run('wg', ['show', sv.iface], { sudo: true })).code === 0 : false;
  const known = !/^\[/.test(sv.endpoint), opened = ctx.settings.portOpened === true, ps = peers(ctx);
  return [
    { title: 'Installer WireGuard sur cette machine', detail: 'Le moteur du VPN (libre et gratuit). Odin l\'installe avec ton accord.', done: wg, action: 'installer', button: 'Installer' },
    { title: 'Adresse de la maison sur Internet', detail: known ? `${sv.endpoint}` : 'Odin trouve ton adresse publique. Si elle change souvent, mets plutôt un nom de domaine (formulaire « Adresse de la maison »).', done: known, action: 'detecter', button: 'Trouver mon adresse' },
    { title: `Ouvrir le port ${sv.port} (UDP) sur ta box`, detail: `Dans l'interface de ta box (souvent http://192.168.1.1) : « Redirection de ports » ou « NAT/PAT ». Protocole UDP, port externe ${sv.port}, vers cette machine, port interne ${sv.port}. Puis clique « C'est fait ».`, done: opened, action: 'port', input: { ouvert: true }, button: 'C\'est fait' },
    { title: 'Allumer le tunnel', detail: 'Le VPN démarre et redémarre tout seul avec la machine.', done: up, action: 'allumer', button: 'Allumer' },
    { title: 'Ajouter ton premier appareil', detail: 'Formulaire « Ajouter un appareil » à droite, puis scanne le QR code avec l\'appli WireGuard (iPhone, Android, Windows, Mac).', done: ps.length > 0 },
    { title: 'Essayer depuis dehors', detail: 'Coupe le Wi-Fi du téléphone (4G), active le tunnel dans l\'appli WireGuard : dans le tableau, l\'appareil passe à « connecté ». S\'il reste « jamais », le port n\'est pas ouvert sur la box.', done: ps.some((p) => ((ctx.settings.seen as string[] | undefined) ?? []).includes(p.name)) },
  ];
}
const human = (b: number) => { const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${Math.round(b * 10) / 10} ${u[i]}`; };
async function apply(ctx: ModCtx): Promise<string> {
  const sv = await ready(ctx), conf = serverConf(sv, peers(ctx)), f = join(ctx.dir, `${sv.iface}.conf`);
  writeFileSync(f, conf, { mode: 0o600 });
  if (!(await ctx.has('wg'))) return `Configuration prête (${f}). WireGuard n'est pas installé sur cette machine : demande « installe WireGuard ».`;
  const cp = await ctx.run('install', ['-D', '-m', '600', f, `/etc/wireguard/${sv.iface}.conf`], { sudo: true });
  if (cp.code) return `Configuration prête (${f}) mais je n'ai pas les droits pour l'installer : ${cp.err.trim()}`;
  const up = await ctx.run('wg', ['show', sv.iface], { sudo: true });
  // Interface éteinte : on l'allume ; allumée : on recharge sans couper les connexions en cours.
  const r = up.code ? await ctx.run('wg-quick', ['up', sv.iface], { sudo: true }) : await ctx.run('bash', ['-c', 'wg syncconf "$1" <(wg-quick strip "$1")', 'gjoll', sv.iface], { sudo: true });
  if (r.code) return `Configuration installée mais le tunnel n'a pas pu démarrer : ${r.err.trim().split('\n').pop()}`;
  return `✅ Tunnel ${sv.iface} à jour (${peers(ctx).filter((p) => p.enabled).length} appareil(s)).`;
}

export const gjoll: Module = {
  id: 'gjoll', name: 'Gjöll', family: 'Accès',
  what: 'Le VPN de la maison : tes appareils se connectent chez toi de n\'importe où, chiffré, avec un QR code.',
  does: ['clés générées par Odin (jamais réutilisées)', 'un appareil = une config + un QR code à scanner', 'tout le trafic par la maison, ou seulement le réseau de la maison', 'mode Gleipnir : réseau maillé, les appareils se parlent directement', 'activer, désactiver, révoquer, renommer un appareil', 'date de fin d\'accès : coupé tout seul le jour venu', 'qui est connecté, trafic reçu et envoyé, dernière connexion', 'fichier .conf à télécharger pour un ordinateur', 'assistant de mise en route : installation, adresse, port de la box, essai depuis dehors', 'réglages du tunnel : port, MTU, maintien de connexion', 'alerte quand un appareil se connecte'],
  from: ['WireGuard', 'wg-easy', 'Headscale'], upstream: ['WireGuard/wireguard-tools', 'wg-easy/wg-easy', 'juanfont/headscale'],
  modes: ['Gjallarbrú · clients', 'Gleipnir · réseau maillé'],
  words: ['vpn', 'wireguard', 'tunnel', 'acces a distance', 'accès à distance', 'depuis l exterieur', 'qr code vpn', 'connexion maison', 'mesh', 'maillage'],
  actions: [
    { id: 'installer', label: 'Installer WireGuard', what: 'Installe le moteur du VPN sur cette machine', quick: false, grave: () => 'installer WireGuard sur cette machine', run: async (ctx) => {
      if (await ctx.has('wg')) return { text: 'WireGuard est déjà installé.' };
      const pm = [['apt-get', ['install', '-y', 'wireguard-tools']], ['dnf', ['install', '-y', 'wireguard-tools']], ['pacman', ['-S', '--noconfirm', 'wireguard-tools']], ['apk', ['add', 'wireguard-tools']], ['brew', ['install', 'wireguard-tools']]] as const;
      for (const [cmd, args] of pm) {
        if (!(await ctx.has(cmd))) continue;
        if (cmd === 'apt-get') await ctx.run('apt-get', ['update'], { sudo: true, timeoutMs: 180_000 });
        const r = await ctx.run(cmd, [...args], { sudo: cmd !== 'brew', timeoutMs: 300_000 });
        return r.code ? { ok: false, text: `L'installation a échoué : ${r.err.trim().split('\n').pop()}` } : { text: '✅ WireGuard installé.' };
      }
      return { ok: false, text: 'Je ne trouve pas d\'installeur de paquets sur cette machine. Sous Windows : installe WireGuard depuis wireguard.com/install.' };
    } },
    { id: 'detecter', label: 'Trouver mon adresse publique', what: 'Demande ton adresse Internet (service ipify) et la garde comme adresse de la maison', quick: false, run: async (ctx) => {
      const r = await ctx.fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) }), ip = (await r.text()).trim();
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error('adresse publique introuvable');
      const sv = await ready(ctx); ctx.saveSettings({ server: { ...sv, endpoint: ip } });
      return { text: `🌍 Ton adresse publique : ${ip}. Les appareils joindront ${ip}:${sv.port}. Si ta box change d'adresse (redémarrage), mets plutôt un nom de domaine.` };
    } },
    { id: 'port', label: 'Port ouvert sur la box', what: 'Note que la redirection du port est faite sur la box', quick: false, params: [{ key: 'ouvert', label: 'Port ouvert', kind: 'boolean', default: true }], run: (ctx, i) => { ctx.saveSettings({ portOpened: i.ouvert !== false }); return { text: i.ouvert !== false ? '👍 Noté. Prochaine étape : allumer le tunnel.' : 'Noté : port pas encore ouvert.' }; } },
    { id: 'allumer', label: 'Allumer le tunnel', what: 'Démarre le VPN (et au démarrage de la machine)', grave: () => 'allumer le VPN de la maison', run: async (ctx) => {
      const msg = await apply(ctx), sv = server(ctx);
      if (await ctx.has('systemctl')) await ctx.run('systemctl', ['enable', `wg-quick@${sv.iface}`], { sudo: true });
      return { text: msg };
    } },
    { id: 'eteindre', label: 'Éteindre le tunnel', what: 'Coupe le VPN pour tous les appareils', quick: false, grave: () => 'couper le VPN pour tous les appareils', undo: () => ({ action: 'allumer', input: {}, label: 'Rallumer le tunnel' }), run: async (ctx) => {
      const sv = server(ctx), r = await ctx.run('wg-quick', ['down', sv.iface], { sudo: true });
      if (await ctx.has('systemctl')) await ctx.run('systemctl', ['disable', `wg-quick@${sv.iface}`], { sudo: true });
      return r.code ? { ok: false, text: `Le tunnel n'a pas pu être coupé : ${r.err.trim().split('\n').pop()}` } : { text: '⏹ Tunnel coupé.' };
    } },
    { id: 'appareils', label: 'Appareils VPN', what: 'Liste et état', read: true, words: ['appareils', 'qui est connecte', 'connectés'], run: async (ctx) => { const d = await ctx.has('wg') ? parseDump((await ctx.run('wg', ['show', server(ctx).iface, 'dump'], { sudo: true })).out) : new Map(); return { text: peers(ctx).map((p) => { const x = d.get(p.pub); return `- ${p.name} (${p.ip}) · ${p.enabled ? (x?.handshake && Date.now() - x.handshake < 180_000 ? 'connecté' : 'hors ligne') : 'désactivé'}`; }).join('\n') || 'Aucun appareil.' }; } },
    { id: 'ajouter', label: 'Ajouter un appareil', what: 'Nouvelle config + QR code', params: [{ key: 'nom', label: 'Nom de l\'appareil', kind: 'text', required: true }, { key: 'tout', label: 'Tout le trafic par la maison', kind: 'boolean', default: true }, { key: 'maillage', label: 'Réseau maillé (Gleipnir)', kind: 'boolean', default: false }, { key: 'fin', label: 'Fin de l\'accès (AAAA-MM-JJ, vide = sans fin)', kind: 'text', default: '' }], grave: (i) => `ouvrir l'accès VPN à « ${s(i.nom)} »`, words: ['ajoute', 'nouvel appareil'], run: async (ctx, i) => {
      const ps = peers(ctx), sv = server(ctx), used = new Set(ps.map((p) => p.ip)), fin = s(i.fin).trim();
      if (!/^[\p{L}\p{N} _.'-]{1,40}$/u.test(s(i.nom).trim())) throw new Error('nom : lettres, chiffres, espaces, 40 au plus');
      if (ps.some((p) => p.name === s(i.nom).trim())) throw new Error('un appareil porte déjà ce nom');
      if (fin && !/^\d{4}-\d{2}-\d{2}$/.test(fin)) throw new Error('date attendue sous la forme 2026-12-31');
      let n = 2; while (used.has(`${sv.net}.${n}`)) n++; if (n > 254) throw new Error('plus d\'adresse libre');
      const k = keypair(), p: Peer = { name: s(i.nom).trim(), ...(fin ? { expires: fin } : {}), ...k, psk: randomBytes(32).toString('base64'), ip: `${sv.net}.${n}`, created: ctx.now().toISOString(), enabled: true, full: i.tout !== false, mesh: i.maillage === true };
      ctx.saveSettings({ peers: [...ps, p] });
      const msg = await apply(ctx);
      // Lien Gjöll → Brísingamen : la configuration de l'appareil (sa clé privée) est rangée dans le coffre chiffré.
      const kept = await ctx.call('brisingamen', 'ajouter', { nom: `VPN ${p.name}`, identifiant: p.name, mot_de_passe: clientConf(await ready(ctx), p, [...ps, p]), site: 'Gjöll (VPN de la maison)' }, 'nouvel accès VPN').then((r) => r.ok !== false, () => false);
      const conf = clientConf(await ready(ctx), p, [...ps, p]);
      const noAddr = /^\[/.test(server(ctx).endpoint) ? ' ⚠ L\'adresse de la maison n\'est pas encore connue : ce QR code ne marchera pas. Fais l\'étape « Adresse de la maison », puis rouvre son QR code.' : '';
      return { text: `📱 « ${p.name} » ajouté (${p.ip}). Scanne ce QR code avec l'appli WireGuard.${noAddr}${kept ? ' Sa configuration est rangée dans le coffre (Brísingamen).' : ''}\n${msg}`, data: { name: p.name, svg: svg(conf, { ecc: 'L', scale: 5 }), conf, filename: confName(p) } };
    } },
    { id: 'qr', label: 'QR code', what: 'QR code de configuration (à scanner)', read: true, params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }], run: async (ctx, i) => { const p = peers(ctx).find((x) => x.name === s(i.nom)); if (!p) throw new Error('appareil introuvable'); const sv = await ready(ctx), conf = clientConf(sv, p, peers(ctx)); return { text: /^\[/.test(sv.endpoint) ? `⚠ L'adresse de la maison n'est pas encore connue : ce QR code ne marchera pas tant que l'étape « Adresse de la maison » n'est pas faite.` : `QR code de « ${p.name} » : ouvre l'appli WireGuard → « + » → « Scanner un QR code ».`, data: { svg: svg(conf, { ecc: 'L', scale: 5 }), conf, filename: confName(p) } }; } },
    { id: 'telecharger', label: 'Fichier de configuration', what: 'Le fichier .conf d\'un appareil (pour un ordinateur)', read: true, params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }], run: async (ctx, i) => { const p = peers(ctx).find((x) => x.name === s(i.nom)); if (!p) throw new Error('appareil introuvable'); return { text: `Configuration de « ${p.name} » : dans l'appli WireGuard de l'ordinateur, « Importer un tunnel depuis un fichier ».`, data: { conf: clientConf(await ready(ctx), p, peers(ctx)), filename: confName(p) } }; } },
    { id: 'modifier', label: 'Modifier un appareil', what: 'Nom, tout le trafic ou maison seulement, maillage, date de fin d\'accès', params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }, { key: 'nouveau_nom', label: 'Nouveau nom (vide = inchangé)', kind: 'text', default: '' }, { key: 'tout', label: 'Tout le trafic par la maison', kind: 'select', options: ['inchangé', 'oui', 'non'], default: 'inchangé' }, { key: 'maillage', label: 'Réseau maillé', kind: 'select', options: ['inchangé', 'oui', 'non'], default: 'inchangé' }, { key: 'fin', label: 'Fin de l\'accès (AAAA-MM-JJ, « aucune » pour retirer)', kind: 'text', default: '' }], run: async (ctx, i) => {
      const ps = peers(ctx), p = ps.find((x) => x.name === s(i.nom)); if (!p) throw new Error('appareil introuvable');
      const nn = s(i.nouveau_nom).trim(), fin = s(i.fin).trim();
      if (nn && ps.some((x) => x.name === nn && x !== p)) throw new Error('un appareil porte déjà ce nom');
      if (nn && !/^[\p{L}\p{N} _.'-]{1,40}$/u.test(nn)) throw new Error('nom : lettres, chiffres, espaces, 40 au plus');
      if (fin && fin !== 'aucune' && !/^\d{4}-\d{2}-\d{2}$/.test(fin)) throw new Error('date attendue sous la forme 2026-12-31');
      const q: Peer = { ...p, ...(nn ? { name: nn } : {}), ...(s(i.tout) === 'oui' ? { full: true } : s(i.tout) === 'non' ? { full: false } : {}), ...(s(i.maillage) === 'oui' ? { mesh: true } : s(i.maillage) === 'non' ? { mesh: false } : {}) };
      const today = ctx.now().toISOString().slice(0, 10), wasLate = Boolean(p.expires && p.expires < today);
      // Un accès coupé parce qu'il était arrivé à sa fin se rouvre avec une nouvelle date (ou sans date) ; un appareil désactivé à la main le reste.
      if (fin === 'aucune') { delete q.expires; if (wasLate) q.enabled = true; } else if (fin) { q.expires = fin; if (wasLate && fin >= today) q.enabled = true; }
      ctx.saveSettings({ peers: ps.map((x) => (x === p ? q : x)) });
      const routing = q.full !== p.full || q.mesh !== p.mesh;
      return { text: `✏️ « ${q.name} » modifié${q.expires ? ` · accès jusqu'au ${q.expires}` : ''}.${routing ? ' Rescanne son QR code pour que le changement s\'applique sur l\'appareil.' : ''}\n${await apply(ctx)}` };
    } },
    { id: 'serveur', label: 'Réglages du tunnel', what: 'Port, taille des paquets (MTU), maintien de la connexion', quick: false, params: [{ key: 'port', label: 'Port UDP', kind: 'number', default: 51820 }, { key: 'mtu', label: 'MTU (vide = automatique, 1280 si ça coupe en 4G)', kind: 'text', default: '' }, { key: 'keepalive', label: 'Maintien de la connexion (secondes)', kind: 'number', default: 25 }], grave: () => 'changer les réglages du tunnel VPN', run: async (ctx, i) => {
      const sv = await ready(ctx), port = Number(i.port) || sv.port, mtu = s(i.mtu).trim() ? Number(i.mtu) : undefined, ka = Number(i.keepalive) || 25;
      if (port < 1 || port > 65535) throw new Error('port entre 1 et 65535');
      if (mtu !== undefined && (!Number.isInteger(mtu) || mtu < 1280 || mtu > 1500)) throw new Error('MTU entre 1280 et 1500');
      if (ka < 0 || ka > 600) throw new Error('maintien entre 0 et 600 secondes');
      const nsv: Server = { ...sv, port, keepalive: ka }; if (mtu) nsv.mtu = mtu; else delete nsv.mtu;
      ctx.saveSettings({ server: nsv, ...(port !== sv.port ? { portOpened: false } : {}) });
      return { text: `⚙️ Port ${port}${mtu ? ` · MTU ${mtu}` : ''} · maintien ${ka} s.${port !== sv.port ? ` Ouvre le port ${port} (UDP) sur la box, et rescanne les QR codes.` : ' Rescanne les QR codes pour appliquer sur les appareils.'}\n${await apply(ctx)}` };
    } },
    { id: 'activer', label: 'Activer / désactiver', what: 'Coupe ou rouvre l\'accès d\'un appareil', params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }, { key: 'actif', label: 'Actif', kind: 'boolean', default: false }], run: async (ctx, i) => { ctx.saveSettings({ peers: peers(ctx).map((p) => (p.name === s(i.nom) ? { ...p, enabled: i.actif === true } : p)) }); return { text: `${i.actif === true ? '✅ Réactivé' : '⏸ Désactivé'} : ${s(i.nom)}\n${await apply(ctx)}` }; } },
    { id: 'revoquer', label: 'Révoquer', what: 'Supprime définitivement l\'accès d\'un appareil', params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }], grave: (i) => `révoquer l'accès VPN de « ${s(i.nom)} »`, run: async (ctx, i) => { ctx.saveSettings({ peers: peers(ctx).filter((p) => p.name !== s(i.nom)) }); return { text: `🗝 Accès de ${s(i.nom)} révoqué.\n${await apply(ctx)}` }; } },
    { id: 'adresse', label: 'Adresse publique', what: 'Adresse ou domaine par lequel on joint la maison', params: [{ key: 'adresse', label: 'Adresse ou domaine', kind: 'text', required: true }, { key: 'port', label: 'Port', kind: 'number', default: 51820 }], run: async (ctx, i) => { const sv = await ready(ctx), adr = s(i.adresse).trim(); if (!/^[\w.-]{1,200}$/.test(adr)) throw new Error('adresse ou domaine invalide'); ctx.saveSettings({ server: { ...sv, endpoint: adr, port: Number(i.port) || 51820 } }); return { text: `🌍 Les appareils joindront ${adr}:${Number(i.port) || 51820}. Pense à ouvrir ce port (UDP) sur ta box vers cette machine.\n${await apply(ctx)}` }; } },
    { id: 'reseaux', label: 'Réseaux de la maison', what: 'Réseaux ouverts aux appareils du VPN, et DNS donné aux appareils', params: [{ key: 'reseaux', label: 'Réseaux (ex. 192.168.1.0/24, séparés par des virgules)', kind: 'text', default: '' }, { key: 'dns', label: 'DNS (vide = celui de la box)', kind: 'text', default: '' }], run: async (ctx, i) => {
      const sv = await ready(ctx), lan = s(i.reseaux).split(',').map((x) => x.trim()).filter(Boolean), dns = s(i.dns).trim();
      if (lan.some((c) => !/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(c))) throw new Error('réseau attendu sous la forme 192.168.1.0/24');
      if (dns && !/^\d{1,3}(\.\d{1,3}){3}(,\s*\d{1,3}(\.\d{1,3}){3})*$/.test(dns)) throw new Error('DNS : une ou plusieurs adresses IP');
      ctx.saveSettings({ server: { ...sv, ...(s(i.reseaux).trim() ? { lan } : {}), ...(dns ? { dns } : {}) } });
      return { text: `🏠 Réseaux ouverts au VPN : ${(lan.length ? lan : sv.lan ?? []).join(', ') || 'aucun'} · DNS : ${dns || sv.dns}. Les appareils déjà ajoutés doivent rescanner leur QR code.` };
    } },
  ],
  async view(ctx) {
    const sv = server(ctx), d = await ctx.has('wg') ? parseDump((await ctx.run('wg', ['show', sv.iface, 'dump'], { sudo: true })).out) : new Map();
    const steps = await setup(ctx), ps = peers(ctx), online = ps.filter((p) => { const x = d.get(p.pub); return x?.handshake && Date.now() - x.handshake < 180_000; });
    return {
      subtitle: `Joignable sur ${sv.endpoint}:${sv.port} (UDP) · réseau ${sv.net}.0/24${sv.lan?.length ? ` · maison : ${sv.lan.join(', ')}` : ''}${(await ctx.has('wg')) ? '' : ' · WireGuard pas encore installé'}`,
      tabs: ['Gjallarbrú · clients', 'Gjöll · tunnel', 'Gleipnir · maillage'],
      kpis: [{ label: 'Appareils', value: String(ps.length) }, { label: 'Connectés', value: String(online.length), tone: online.length ? 'bon' : 'neutre' }, { label: 'Maillage', value: String(ps.filter((p) => p.mesh).length) }],
      sections: [...(steps.every((x) => x.done) ? [] : [{ kind: 'steps' as const, title: 'Mettre en route le VPN', items: steps }]), { kind: 'table', title: 'Appareils', columns: ['Appareil', 'Adresse', 'État', 'Reçu', 'Envoyé', 'Trafic', 'Fin d\'accès'], empty: 'Aucun appareil : ajoute ton téléphone à droite.', rows: ps.map((p) => { const x = d.get(p.pub), on = x?.handshake && Date.now() - x.handshake < 180_000; return { cells: [p.name, p.ip, !p.enabled ? 'désactivé' : on ? 'connecté' : x?.handshake ? `vu ${new Date(x.handshake).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : 'jamais', human(x?.rx ?? 0), human(x?.tx ?? 0), p.full ? 'tout' : 'maison seulement', p.expires ?? '—'], tone: !p.enabled ? 'neutre' : on ? 'bon' : undefined, actions: [{ action: 'qr', label: 'QR code', input: { nom: p.name } }, { action: 'telecharger', label: 'Fichier .conf', input: { nom: p.name } }, { action: 'activer', label: p.enabled ? 'Désactiver' : 'Réactiver', input: { nom: p.name, actif: !p.enabled } }, { action: 'revoquer', label: 'Révoquer', input: { nom: p.name } }] }; }) }],
      side: [{ kind: 'form', title: 'Ajouter un appareil', action: 'ajouter', submit: 'Ajouter', params: gjoll.actions.find((a) => a.id === 'ajouter')?.params ?? [] }, { kind: 'form', title: 'Adresse de la maison', action: 'adresse', submit: 'Enregistrer', params: gjoll.actions.find((a) => a.id === 'adresse')?.params ?? [] }, { kind: 'form', title: 'Modifier un appareil', action: 'modifier', submit: 'Modifier', params: gjoll.actions.find((a) => a.id === 'modifier')?.params ?? [] }],
    };
  },
  watch: { every: 120, async run(ctx) {
    // Accès arrivés à leur fin : coupés tout seuls (et dit).
    const late = expired(peers(ctx), ctx.now());
    if (late.length) {
      ctx.saveSettings({ peers: peers(ctx).map((p) => (late.some((x) => x.name === p.name) ? { ...p, enabled: false } : p)) });
      await apply(ctx);
      for (const p of late) ctx.alert({ level: 'info', title: `Accès VPN de « ${p.name} » terminé`, detail: `Fin prévue le ${p.expires}. Pour le rouvrir : Modifier → nouvelle date de fin.`, key: `vpn-fin-${p.name}` });
    }
    if (!(await ctx.has('wg'))) return;
    const d = parseDump((await ctx.run('wg', ['show', server(ctx).iface, 'dump'], { sudo: true })).out), was = (ctx.settings.online as string[] | undefined) ?? [], now: string[] = [];
    for (const p of peers(ctx)) { const x = d.get(p.pub); if (x?.handshake && Date.now() - x.handshake < 180_000) { now.push(p.name); if (!was.includes(p.name)) ctx.emit('vpn_connecte', { appareil: p.name, depuis: x.endpoint }); } }
    const seen = new Set([...((ctx.settings.seen as string[] | undefined) ?? []), ...now]);
    ctx.saveSettings({ online: now, seen: [...seen] });
  } },
};
