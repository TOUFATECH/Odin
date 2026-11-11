// Gjöll — le VPN d'Odin : un seul moteur WireGuard pour les tunnels, les clients avec QR code
// (mode « Gjallarbrú ») et le réseau maillé entre tes appareils (mode « Gleipnir »).
// Clés générées par Odin, configuration écrite et appliquée avec ton accord, QR code à scanner.

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPrivateV4, localSubnets } from '../../hlidskjalf/discover.ts';
import { svg } from '../qr.ts';
import type { ModCtx, Module } from '../types.ts';

export interface Peer { name: string; pub: string; priv?: string; psk: string; ip: string; created: string; enabled: boolean; full: boolean; mesh?: boolean; endpoint?: string }
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
}
const s = (v: unknown) => String(v ?? '');
/** Réseaux locaux de la machine à ouvrir au VPN (pas les ponts de conteneurs ni les autres tunnels). */
export function homeLans(subnets = localSubnets()): string[] {
  return [...new Set(subnets.filter((x) => !/^(wg|docker|br-|veth|virbr|tailscale|zt|tun|tap|lxc|podman|cni|ob)/.test(x.iface)).map((x) => x.cidr))];
}
function server(ctx: ModCtx): Server {
  let sv = ctx.settings.server as Server | undefined;
  if (!sv) { const k = keypair(); sv = { ...k, net: '10.8.0', port: 51820, endpoint: s(ctx.settings.endpoint) || '[ADRESSE PUBLIQUE OU DOMAINE]', dns: '', iface: 'wg0' }; ctx.saveSettings({ server: sv }); }
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
  return `[Interface]\n# Gjöll (Odin) — ne pas modifier à la main\nAddress = ${sv.net}.1/24\nListenPort = ${sv.port}\nPrivateKey = ${sv.priv}\n${f ? `PostUp = ${f.up}\nPostDown = ${f.down}\n` : ''}${ps.filter((p) => p.enabled).map((p) => `\n[Peer]\n# ${p.name}\nPublicKey = ${p.pub}\nPresharedKey = ${p.psk}\nAllowedIPs = ${p.ip}/32\n`).join('')}`;
}
export function clientConf(sv: Server, p: Peer, all: Peer[] = []): string {
  // « Maison seulement » : le réseau du VPN et les réseaux de la maison ; « tout » : tout le trafic.
  const allowed = p.full ? '0.0.0.0/0, ::/0' : [`${sv.net}.0/24`, ...(sv.lan ?? [])].join(', ');
  const mesh = p.mesh ? all.filter((x) => x.mesh && x.enabled && x.name !== p.name && x.endpoint).map((x) => `\n[Peer]\n# ${x.name} (maillage)\nPublicKey = ${x.pub}\nEndpoint = ${x.endpoint}\nAllowedIPs = ${x.ip}/32\nPersistentKeepalive = 25\n`).join('') : '';
  return `[Interface]\nPrivateKey = ${p.priv}\nAddress = ${p.ip}/32\n${sv.dns ? `DNS = ${sv.dns}\n` : ''}\n[Peer]\n# Maison (Odin)\nPublicKey = ${sv.pub}\nPresharedKey = ${p.psk}\nEndpoint = ${sv.endpoint}:${sv.port}\nAllowedIPs = ${allowed}\nPersistentKeepalive = 25\n${mesh}`;
}
/** `wg show <iface> dump` → dernière poignée de main et trafic par clé publique. */
export function parseDump(out: string): Map<string, { handshake: number; rx: number; tx: number; endpoint: string }> {
  const m = new Map<string, { handshake: number; rx: number; tx: number; endpoint: string }>();
  for (const l of out.trim().split('\n').slice(1)) { const c = l.split('\t'); if (c.length >= 7) m.set(c[0], { endpoint: c[2], handshake: Number(c[4]) * 1000, rx: Number(c[5]), tx: Number(c[6]) }); }
  return m;
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
  const r = up.code ? await ctx.run('wg-quick', ['up', sv.iface], { sudo: true }) : await ctx.run('bash', ['-c', `wg syncconf ${sv.iface} <(wg-quick strip ${sv.iface})`], { sudo: true });
  if (r.code) return `Configuration installée mais le tunnel n'a pas pu démarrer : ${r.err.trim().split('\n').pop()}`;
  return `✅ Tunnel ${sv.iface} à jour (${peers(ctx).filter((p) => p.enabled).length} appareil(s)).`;
}

export const gjoll: Module = {
  id: 'gjoll', name: 'Gjöll', family: 'Accès',
  what: 'Le VPN de la maison : tes appareils se connectent chez toi de n\'importe où, chiffré, avec un QR code.',
  does: ['clés générées par Odin (jamais réutilisées)', 'un appareil = une config + un QR code à scanner', 'tout le trafic par la maison, ou seulement le réseau de la maison', 'mode Gleipnir : réseau maillé, les appareils se parlent directement', 'activer, désactiver, révoquer un appareil', 'qui est connecté, trafic, dernière connexion', 'alerte si un appareil inconnu essaie'],
  from: ['WireGuard', 'wg-easy', 'Headscale'], upstream: ['WireGuard/wireguard-tools', 'wg-easy/wg-easy', 'juanfont/headscale'],
  modes: ['Gjallarbrú · clients', 'Gleipnir · réseau maillé'],
  words: ['vpn', 'wireguard', 'tunnel', 'acces a distance', 'accès à distance', 'depuis l exterieur', 'qr code vpn', 'connexion maison', 'mesh', 'maillage'],
  actions: [
    { id: 'appareils', label: 'Appareils VPN', what: 'Liste et état', read: true, words: ['appareils', 'qui est connecte', 'connectés'], run: async (ctx) => { const d = await ctx.has('wg') ? parseDump((await ctx.run('wg', ['show', server(ctx).iface, 'dump'], { sudo: true })).out) : new Map(); return { text: peers(ctx).map((p) => { const x = d.get(p.pub); return `- ${p.name} (${p.ip}) · ${p.enabled ? (x?.handshake && Date.now() - x.handshake < 180_000 ? 'connecté' : 'hors ligne') : 'désactivé'}`; }).join('\n') || 'Aucun appareil.' }; } },
    { id: 'ajouter', label: 'Ajouter un appareil', what: 'Nouvelle config + QR code', params: [{ key: 'nom', label: 'Nom de l\'appareil', kind: 'text', required: true }, { key: 'tout', label: 'Tout le trafic par la maison', kind: 'boolean', default: true }, { key: 'maillage', label: 'Réseau maillé (Gleipnir)', kind: 'boolean', default: false }], grave: (i) => `ouvrir l'accès VPN à « ${s(i.nom)} »`, words: ['ajoute', 'nouvel appareil'], run: async (ctx, i) => {
      const ps = peers(ctx), sv = server(ctx), used = new Set(ps.map((p) => p.ip));
      let n = 2; while (used.has(`${sv.net}.${n}`)) n++; if (n > 254) throw new Error('plus d\'adresse libre');
      const k = keypair(), p: Peer = { name: s(i.nom), ...k, psk: randomBytes(32).toString('base64'), ip: `${sv.net}.${n}`, created: ctx.now().toISOString(), enabled: true, full: i.tout !== false, mesh: i.maillage === true };
      ctx.saveSettings({ peers: [...ps, p] });
      const msg = await apply(ctx);
      return { text: `📱 « ${p.name} » ajouté (${p.ip}). Ouvre Gjöll pour scanner son QR code avec l'appli WireGuard.\n${msg}`, data: { name: p.name } };
    } },
    { id: 'qr', label: 'QR code', what: 'QR code de configuration (à scanner)', read: true, params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }], run: async (ctx, i) => { const p = peers(ctx).find((x) => x.name === s(i.nom)); if (!p) throw new Error('appareil introuvable'); const sv = await ready(ctx), conf = clientConf(sv, p, peers(ctx)); return { text: 'QR code prêt (visible dans Gjöll).', data: { svg: svg(conf, { ecc: 'L', scale: 5 }), conf } }; } },
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
    const ps = peers(ctx), online = ps.filter((p) => { const x = d.get(p.pub); return x?.handshake && Date.now() - x.handshake < 180_000; });
    return {
      subtitle: `Joignable sur ${sv.endpoint}:${sv.port} (UDP) · réseau ${sv.net}.0/24${sv.lan?.length ? ` · maison : ${sv.lan.join(', ')}` : ''}${(await ctx.has('wg')) ? '' : ' · WireGuard pas encore installé'}`,
      tabs: ['Gjallarbrú · clients', 'Gjöll · tunnel', 'Gleipnir · maillage'],
      kpis: [{ label: 'Appareils', value: String(ps.length) }, { label: 'Connectés', value: String(online.length), tone: online.length ? 'bon' : 'neutre' }, { label: 'Maillage', value: String(ps.filter((p) => p.mesh).length) }],
      sections: [{ kind: 'table', title: 'Appareils', columns: ['Appareil', 'Adresse', 'État', 'Reçu', 'Envoyé', 'Trafic'], empty: 'Aucun appareil : ajoute ton téléphone à droite.', rows: ps.map((p) => { const x = d.get(p.pub), on = x?.handshake && Date.now() - x.handshake < 180_000; return { cells: [p.name, p.ip, !p.enabled ? 'désactivé' : on ? 'connecté' : x?.handshake ? `vu ${new Date(x.handshake).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : 'jamais', human(x?.rx ?? 0), human(x?.tx ?? 0), p.full ? 'tout' : 'maison seulement'], tone: !p.enabled ? 'neutre' : on ? 'bon' : undefined, actions: [{ action: 'qr', label: 'QR code', input: { nom: p.name } }, { action: 'activer', label: p.enabled ? 'Désactiver' : 'Réactiver', input: { nom: p.name, actif: !p.enabled } }, { action: 'revoquer', label: 'Révoquer', input: { nom: p.name } }] }; }) }],
      side: [{ kind: 'form', title: 'Ajouter un appareil', action: 'ajouter', submit: 'Ajouter', params: gjoll.actions[1].params! }, { kind: 'form', title: 'Adresse de la maison', action: 'adresse', submit: 'Enregistrer', params: gjoll.actions[5].params! }],
    };
  },
  watch: { every: 120, async run(ctx) {
    if (!(await ctx.has('wg'))) return;
    const d = parseDump((await ctx.run('wg', ['show', server(ctx).iface, 'dump'], { sudo: true })).out), was = (ctx.settings.online as string[] | undefined) ?? [], now: string[] = [];
    for (const p of peers(ctx)) { const x = d.get(p.pub); if (x?.handshake && Date.now() - x.handshake < 180_000) { now.push(p.name); if (!was.includes(p.name)) ctx.emit('vpn_connecte', { appareil: p.name, depuis: x.endpoint }); } }
    ctx.saveSettings({ online: now });
  } },
};
