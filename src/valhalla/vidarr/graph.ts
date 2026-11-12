// Le graphe du réseau (même dessin que le Cerveau) : Odin au centre, la box et Internet, chaque poste avec
// ses adresses, et les domaines qu'il a demandés (gris), bloqués (orange, en pointillé) ou dangereux (rouge).
// Un clic sur un point ouvre sa fiche. Pur : tout ce qu'il faut savoir arrive en paramètre.
import type { GraphDetail, GraphEdge, GraphNode, Tone } from '../types.ts';
import type { ClientRule } from './server.ts';
import { isCut } from './server.ts';
import type { Lease } from './dhcp.ts';
import { osFromVendorClass, randomMac } from './dhcp.ts';
import type { Summary } from './history.ts';

export const C = { odin: '#4F9DDE', infra: '#7FB3E6', poste: '#E8EAEC', ok: '#8E959D', bloque: '#F0A040', menace: '#EE6A55', nouveau: '#F0A040', vpn: '#57C98A' };
export interface DeviceInfo { mac?: string; model?: string; kind?: string; vendor?: string; firstSeen?: number }
export interface NetInfo {
  odinIp: string; router: string; upstreams: string[]; dhcpOn: boolean; dnsOn: boolean; port: number;
  leases: Lease[]; clients: ClientRule[];
  /** ce que le registre réseau d'Odin sait d'une adresse */
  device: (ip: string) => DeviceInfo | undefined;
  vendorOf: (mac: string) => string;
  /** débit moyen de la dernière minute (Rán), en octets par seconde, si la capture tourne */
  rate?: (ip: string) => number | undefined;
  /** nom d'un appareil du VPN (10.8.0.x) */
  vpnName?: (ip: string) => string | undefined;
  now: number; periodLabel: string;
}
const fmt = (n: number) => n.toLocaleString('fr-FR');
const mbps = (bps: number) => `${(bps * 8 / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mb/s`;
const dt = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export function networkGraph(sum: Summary, o: NetInfo): { nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail> } {
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [], details: Record<string, GraphDetail> = {};
  const at = new Date(o.now);
  // Le cœur : Odin, la box, Internet.
  nodes.push({ id: 'odin', label: 'Odin', sub: `DNS${o.dhcpOn ? ' + DHCP' : ''} · ${o.odinIp}`, square: true, size: 18, color: C.odin, hub: true });
  nodes.push({ id: 'box', label: 'Box', sub: o.router, square: true, size: 13, color: C.infra });
  nodes.push({ id: 'internet', label: 'Internet', sub: o.upstreams.slice(0, 2).join(' · '), square: true, size: 13, color: C.infra });
  edges.push({ a: 'odin', b: 'box', w: 2, color: C.infra }, { a: 'box', b: 'internet', w: 2, color: C.infra });
  const totalClients = Object.keys(sum.clients).length;
  details.odin = {
    kind: 'Odin', title: 'DNS et DHCP d\'Odin', subtitle: `${o.odinIp} · ${o.dnsOn ? `DNS en marche (port ${o.port})` : 'DNS arrêté'} · ${o.dhcpOn ? 'DHCP en marche' : 'DHCP arrêté'}`,
    chips: [{ label: o.dnsOn ? 'DNS en marche' : 'DNS arrêté', tone: o.dnsOn ? 'bon' : 'mauvais' }, { label: o.dhcpOn ? 'DHCP d\'Odin' : 'DHCP de la box', tone: o.dhcpOn ? 'bon' : 'neutre' }],
    rows: [
      { k: o.periodLabel, v: `${fmt(sum.total)} requêtes · ${fmt(sum.blocked)} bloquées (${sum.total ? Math.round(sum.blocked / sum.total * 100) : 0} %) · ${fmt(sum.threats)} dangereuses`, src: 'Víðarr' },
      { k: 'Postes', v: `${totalClients} ont posé des questions`, src: 'Víðarr' },
      { k: 'DNS proposé', v: o.dhcpOn ? `Odin (${o.odinIp}), donné à chaque appareil par le DHCP` : 'celui de la box : pour que tous passent par Odin, allume le DHCP d\'Odin', src: 'diffusion Wi-Fi et câble' },
      { k: 'Serveurs amont', v: o.upstreams.join(', ') || '—', src: 'Víðarr' },
    ],
    actions: [{ action: o.dnsOn ? 'arreter' : 'demarrer', label: o.dnsOn ? 'Arrêter le DNS' : 'Démarrer le DNS', input: {}, primary: !o.dnsOn }, { action: 'dhcp_chercher', label: 'Chercher un autre DHCP', input: {} }],
  };
  details.box = { kind: 'Routeur', title: 'Box Internet', subtitle: o.router, rows: [{ k: 'Rôle', v: o.dhcpOn ? 'passerelle vers Internet (son DHCP doit rester coupé)' : 'passerelle et DHCP (elle donne les adresses)', src: '' }, { k: 'Diffuser le DNS d\'Odin', v: o.dhcpOn ? 'fait par le DHCP d\'Odin : tous les appareils, Wi-Fi et câble' : 'allume le DHCP d\'Odin (après avoir coupé celui de la box)', src: 'recommandé' }], actions: [{ action: 'dhcp_chercher', label: 'Qui donne les adresses ?', input: {} }] };
  details.internet = { kind: 'Internet', title: 'Serveurs DNS amont', subtitle: o.upstreams.join(' · '), rows: [{ k: 'Chiffrement', v: o.upstreams.some((u) => /^(tls|https):/.test(u)) ? 'oui (TLS ou HTTPS)' : 'non : questions en clair vers Internet', src: '' }] };
  // Les postes : ceux qui ont posé des questions, plus ceux qui ont un bail sans avoir encore demandé.
  const ips = new Set([...Object.keys(sum.clients), ...o.leases.filter((l) => l.fixed || l.expires > o.now).map((l) => l.ip)]);
  const ranked = [...ips].sort((a, b) => (sum.clients[b]?.n ?? 0) - (sum.clients[a]?.n ?? 0)).slice(0, 80);
  const maxN = Math.max(1, ...ranked.map((ip) => sum.clients[ip]?.n ?? 0));
  const domainNodes = new Map<string, GraphNode>(), domainBy = new Map<string, Array<[string, number, boolean]>>();
  for (const ip of ranked) {
    const c = sum.clients[ip], lease = o.leases.find((l) => l.ip === ip), dev = o.device(ip) ?? {}, mac = lease?.mac ?? dev.mac;
    const rule = o.clients.find((r) => r.ids.includes(ip)), cut = isCut(rule, at), vpn = o.vpnName?.(ip) ?? (rule?.name.startsWith('VPN · ') ? rule.name : undefined);
    const name = rule?.name ?? lease?.name ?? c?.name ?? vpn ?? dev.model ?? ip;
    const first = lease?.first ?? dev.firstSeen, fresh = first !== undefined && o.now - first < 24 * 3600_000;
    const id = `p:${ip}`, rate = o.rate?.(ip);
    nodes.push({ id, label: name, sub: ip, size: 7 + Math.round(9 * Math.sqrt((c?.n ?? 0) / maxN)), color: vpn ? C.vpn : C.poste, off: cut, ring: c?.threats ? C.menace : fresh ? C.nouveau : undefined, alert: c?.threats ? { n: c.threats, level: 'grave' } : undefined, search: `${ip} ${mac ?? ''} ${dev.vendor ?? ''}` });
    edges.push({ a: id, b: 'odin', w: c ? Math.min(3, Math.log10(c.n + 1)) : 0, dash: cut, color: cut ? C.menace : undefined });
    const vendor = mac ? o.vendorOf(mac) : dev.vendor;
    const conn = vpn ? 'VPN (tunnel Gjöll)' : mac && randomMac(mac) ? 'Wi-Fi (adresse privée de téléphone ou tablette)' : 'Wi-Fi ou câble : la box le dirait';
    const tops = Object.entries(c?.domains ?? {}).sort((x, y) => y[1].n - x[1].n);
    const chips: Array<{ label: string; tone?: Tone }> = [];
    if (cut) chips.push({ label: rule?.cutSchedule ? `Coupé ${rule.cutSchedule.from} → ${rule.cutSchedule.to}` : 'Coupé d\'Internet', tone: 'mauvais' });
    else if (rule?.cut && rule.cutSchedule) chips.push({ label: `Coupé ${rule.cutSchedule.from} → ${rule.cutSchedule.to}`, tone: 'attention' });
    if (fresh) chips.push({ label: 'Nouveau sur le réseau', tone: 'attention' });
    if (c?.threats) chips.push({ label: `${c.threats} demande(s) dangereuse(s)`, tone: 'mauvais' });
    if (rule?.parental) chips.push({ label: 'Contrôle parental', tone: 'bon' });
    if (rule?.filtering === 'non') chips.push({ label: 'Sans filtrage', tone: 'attention' });
    if (lease?.fixed) chips.push({ label: 'Adresse fixe' });
    details[id] = {
      kind: vpn ? 'Appareil du VPN' : 'Poste', title: name, subtitle: `${ip}${c ? ` · dernière question ${dt(c.last)}` : ' · pas encore de question'}`, chips,
      rows: [
        { k: 'Adresse IP', v: ip, src: lease ? (lease.fixed ? 'adresse fixe du DHCP d\'Odin' : `bail du DHCP d'Odin jusqu'au ${dt(lease.expires)}`) : vpn ? 'VPN' : 'vue par le DNS' },
        { k: 'Adresse MAC', v: mac ?? 'inconnue', src: mac ? (lease ? 'DHCP' : 'registre réseau') : 'allume le DHCP d\'Odin pour la connaître' },
        { k: 'Fabricant', v: vendor || (mac && randomMac(mac) ? 'caché (adresse privée)' : 'inconnu'), src: 'déduit de la MAC' },
        { k: 'Modèle', v: dev.model || osFromVendorClass(lease?.vendorClass) || 'inconnu', src: dev.model ? 'registre réseau (l\'appareil le dit)' : lease?.vendorClass ? 'deviné d\'après le DHCP : à confirmer' : '' },
        { k: 'Connexion', v: conn, src: '' },
        ...(rate !== undefined ? [{ k: 'Débit', v: mbps(rate), src: 'Rán, dernière minute (ce qui passe par Odin)' }] : []),
        { k: o.periodLabel, v: c ? `${fmt(c.n)} requêtes · ${fmt(c.b)} bloquées · ${tops.length} domaines` : 'aucune requête', src: 'Víðarr' },
        ...(first ? [{ k: 'Vu la 1re fois', v: dt(first), src: '' }] : []),
      ],
      list: { title: 'Domaines les plus demandés', items: tops.slice(0, 12).map(([d, x]) => ({ text: d, meta: `${fmt(x.n)}${x.b ? ` · ${x.threat ? 'dangereux' : 'bloqué'}` : ''}`, tone: x.threat ? 'mauvais' as const : x.b ? 'attention' as const : undefined })) },
      actions: [
        cut || rule?.cut ? { action: 'retablir_machine', label: 'Rétablir Internet', input: { ip }, primary: true } : { action: 'couper_machine', label: 'Couper d\'Internet', input: { ip, nom: name } },
        { action: 'lire', label: 'Voir ses paquets (Rán)', input: { ip }, module: 'ran' },
        ...(mac ? [{ action: 'dhcp_fixe', label: lease?.fixed ? 'Adresse fixe ✓' : 'Garder cette adresse', input: { mac, ip, nom: name === ip ? '' : name } }] : []),
        { action: 'tester', label: 'Tester un domaine pour lui', input: { domaine: tops[0]?.[0] ?? 'exemple.fr', appareil: ip } },
      ],
    };
    // Ses domaines : tous les dangereux, les 4 plus bloqués et les 5 plus demandés.
    const pick = [...tops.filter(([, x]) => x.threat), ...tops.filter(([, x]) => x.b && !x.threat).slice(0, 4), ...tops.filter(([, x]) => !x.b).slice(0, 5)];
    for (const [d, x] of pick) {
      const did = `d:${d}`;
      if (!domainNodes.has(did)) { domainNodes.set(did, { id: did, label: d, sub: x.threat ? 'dangereux' : x.b ? `bloqué · ${x.list ?? ''}` : 'demandé', size: x.threat ? 7 : 4, color: x.threat ? C.menace : x.b ? C.bloque : C.ok }); domainBy.set(did, []); }
      domainBy.get(did)!.push([name, x.n, Boolean(x.b)]);
      edges.push({ a: id, b: did, dash: Boolean(x.b), color: x.threat ? C.menace : x.b ? C.bloque : undefined });
    }
  }
  for (const [did, n] of domainNodes) {
    nodes.push(n);
    const d = did.slice(2), who = domainBy.get(did)!, blocked = who.some(([, , b]) => b);
    details[did] = {
      kind: n.color === C.menace ? 'Site dangereux' : blocked ? 'Domaine bloqué' : 'Domaine demandé', title: d, subtitle: String(n.sub ?? ''),
      rows: [{ k: 'Demandé par', v: who.map(([w, k]) => `${w} (${fmt(k)})`).join(', '), src: o.periodLabel }],
      actions: [blocked ? { action: 'autoriser', label: 'Autoriser ce domaine', input: { domaine: d }, primary: true } : { action: 'bloquer', label: 'Bloquer ce domaine', input: { domaine: d } }, { action: 'bloquer_horaires', label: 'Bloquer 21:00 → 07:00', input: { domaine: d, jours: 'tous', de: '21:00', a: '07:00' } }],
    };
  }
  return { nodes, edges, details };
}
