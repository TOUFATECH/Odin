// Gjöll — le VPN d'Odin : un seul moteur WireGuard pour les tunnels, les clients avec QR code
// (mode « Gjallarbrú ») et le réseau maillé entre tes appareils (mode « Gleipnir »).
// Clés générées par Odin, configuration écrite et appliquée avec ton accord, QR code à scanner.

import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { svg } from '../qr.ts';
import type { ModCtx, Module } from '../types.ts';

export interface Peer { name: string; pub: string; priv?: string; psk: string; ip: string; created: string; enabled: boolean; full: boolean; mesh?: boolean; endpoint?: string }
export function keypair(): { priv: string; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  return { priv: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64'), pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') };
}
export interface Server { priv: string; pub: string; net: string; port: number; endpoint: string; dns: string; iface: string }
const s = (v: unknown) => String(v ?? '');
function server(ctx: ModCtx): Server {
  let sv = ctx.settings.server as Server | undefined;
  if (!sv) { const k = keypair(); sv = { ...k, net: '10.8.0', port: 51820, endpoint: s(ctx.settings.endpoint) || '[ADRESSE PUBLIQUE OU DOMAINE]', dns: '10.8.0.1', iface: 'wg0' }; ctx.saveSettings({ server: sv }); }
  return sv;
}
const peers = (ctx: ModCtx): Peer[] => (ctx.settings.peers as Peer[] | undefined) ?? [];
export function serverConf(sv: Server, ps: Peer[]): string {
  return `[Interface]\n# Gjöll (Odin) — ne pas modifier à la main\nAddress = ${sv.net}.1/24\nListenPort = ${sv.port}\nPrivateKey = ${sv.priv}\n${ps.filter((p) => p.enabled).map((p) => `\n[Peer]\n# ${p.name}\nPublicKey = ${p.pub}\nPresharedKey = ${p.psk}\nAllowedIPs = ${p.ip}/32\n`).join('')}`;
}
export function clientConf(sv: Server, p: Peer, all: Peer[] = []): string {
  const allowed = p.full ? '0.0.0.0/0, ::/0' : `${sv.net}.0/24`;
  const mesh = p.mesh ? all.filter((x) => x.mesh && x.enabled && x.name !== p.name && x.endpoint).map((x) => `\n[Peer]\n# ${x.name} (maillage)\nPublicKey = ${x.pub}\nEndpoint = ${x.endpoint}\nAllowedIPs = ${x.ip}/32\nPersistentKeepalive = 25\n`).join('') : '';
  return `[Interface]\nPrivateKey = ${p.priv}\nAddress = ${p.ip}/32\nDNS = ${sv.dns}\n\n[Peer]\n# Maison (Odin)\nPublicKey = ${sv.pub}\nPresharedKey = ${p.psk}\nEndpoint = ${sv.endpoint}:${sv.port}\nAllowedIPs = ${allowed}\nPersistentKeepalive = 25\n${mesh}`;
}
/** `wg show <iface> dump` → dernière poignée de main et trafic par clé publique. */
export function parseDump(out: string): Map<string, { handshake: number; rx: number; tx: number; endpoint: string }> {
  const m = new Map<string, { handshake: number; rx: number; tx: number; endpoint: string }>();
  for (const l of out.trim().split('\n').slice(1)) { const c = l.split('\t'); if (c.length >= 7) m.set(c[0], { endpoint: c[2], handshake: Number(c[4]) * 1000, rx: Number(c[5]), tx: Number(c[6]) }); }
  return m;
}
const human = (b: number) => { const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return `${Math.round(b * 10) / 10} ${u[i]}`; };
async function apply(ctx: ModCtx): Promise<string> {
  const sv = server(ctx), conf = serverConf(sv, peers(ctx)), f = join(ctx.dir, `${sv.iface}.conf`);
  writeFileSync(f, conf, { mode: 0o600 });
  if (!(await ctx.has('wg'))) return `Configuration prête (${f}). WireGuard n'est pas installé sur cette machine : demande « installe WireGuard ».`;
  const cp = await ctx.run('install', ['-m', '600', f, `/etc/wireguard/${sv.iface}.conf`], { sudo: true });
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
    { id: 'qr', label: 'QR code', what: 'QR code de configuration (à scanner)', read: true, params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }], run: (ctx, i) => { const p = peers(ctx).find((x) => x.name === s(i.nom)); if (!p) throw new Error('appareil introuvable'); return { text: 'QR code prêt (visible dans Gjöll).', data: { svg: svg(clientConf(server(ctx), p, peers(ctx)), { ecc: 'L', scale: 5 }), conf: clientConf(server(ctx), p, peers(ctx)) } }; } },
    { id: 'activer', label: 'Activer / désactiver', what: 'Coupe ou rouvre l\'accès d\'un appareil', params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }, { key: 'actif', label: 'Actif', kind: 'boolean', default: false }], run: async (ctx, i) => { ctx.saveSettings({ peers: peers(ctx).map((p) => (p.name === s(i.nom) ? { ...p, enabled: i.actif === true } : p)) }); return { text: `${i.actif === true ? '✅ Réactivé' : '⏸ Désactivé'} : ${s(i.nom)}\n${await apply(ctx)}` }; } },
    { id: 'revoquer', label: 'Révoquer', what: 'Supprime définitivement l\'accès d\'un appareil', params: [{ key: 'nom', label: 'Appareil', kind: 'text', required: true }], grave: (i) => `révoquer l'accès VPN de « ${s(i.nom)} »`, run: async (ctx, i) => { ctx.saveSettings({ peers: peers(ctx).filter((p) => p.name !== s(i.nom)) }); return { text: `🗝 Accès de ${s(i.nom)} révoqué.\n${await apply(ctx)}` }; } },
    { id: 'adresse', label: 'Adresse publique', what: 'Adresse ou domaine par lequel on joint la maison', params: [{ key: 'adresse', label: 'Adresse ou domaine', kind: 'text', required: true }, { key: 'port', label: 'Port', kind: 'number', default: 51820 }], run: (ctx, i) => { const sv = server(ctx); ctx.saveSettings({ server: { ...sv, endpoint: s(i.adresse).trim(), port: Number(i.port) || 51820 } }); return { text: `🌍 Les appareils joindront ${s(i.adresse)}:${Number(i.port) || 51820}. Pense à ouvrir ce port (UDP) sur ta box vers cette machine.` }; } },
  ],
  async view(ctx) {
    const sv = server(ctx), d = await ctx.has('wg') ? parseDump((await ctx.run('wg', ['show', sv.iface, 'dump'], { sudo: true })).out) : new Map();
    const ps = peers(ctx), online = ps.filter((p) => { const x = d.get(p.pub); return x?.handshake && Date.now() - x.handshake < 180_000; });
    return {
      subtitle: `Joignable sur ${sv.endpoint}:${sv.port} (UDP) · réseau ${sv.net}.0/24${(await ctx.has('wg')) ? '' : ' · WireGuard pas encore installé'}`,
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
