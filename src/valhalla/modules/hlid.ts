// Thermopyles — le pare-feu et le routeur (comme pfSense / OPNsense, pour la machine d'Odin) : l'état du pare-feu
// (ufw ou firewalld), ses règles, les ports à l'écoute et s'ils sont joignables depuis le réseau, les routes et
// la passerelle, et les ports ouverts sur la box vers Internet (UPnP). Ouvrir ou fermer un port, allumer ou
// éteindre le pare-feu : toujours avec ton accord, et jamais sans garder la porte d'Odin et de SSH ouverte.
// (Bannir une adresse reste le travail de Cerbère.)
import { existsSync } from 'node:fs';
import type { Kpi, ModCtx, Module, Tone } from '../types.ts';
import { ODIN_PORTS, WEB } from '../ports.ts';
import { deleteMapping, discover, externalIp, listMappings, behindCgnat, type Mapping } from '../upnp.ts';

export interface Ecoute { proto: 'tcp' | 'udp'; port: number; adresse: string; portee: 'machine' | 'réseau'; prog?: string }
export interface RegleUfw { vers: string; action: string; depuis: string; v6: boolean }
export interface Ufw { actif: boolean; entrant: string; sortant: string; regles: RegleUfw[] }
export interface Route { vers: string; via?: string; carte?: string; defaut: boolean }
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));

/** « ss -tulnpH » → les ports à l'écoute (une ligne par port, protocole et adresse). Pur. */
export function lireSs(out: string): Ecoute[] {
  const seen = new Set<string>(), l: Ecoute[] = [];
  for (const line of out.split('\n')) {
    const c = line.trim().split(/\s+/); if (c.length < 5 || !/^(tcp|udp)$/.test(c[0])) continue;
    const local = c[4], k = local.lastIndexOf(':'); if (k < 0) continue;
    const port = Number(local.slice(k + 1)), adresse = local.slice(0, k).replace(/^\[|\]$/g, '').replace(/%.*$/, ''); if (!Number.isInteger(port) || port < 1) continue;
    const portee = /^(127\.|::1$|localhost$)/.test(adresse) ? 'machine' as const : 'réseau' as const, prog = /users:\(\("([^"]+)"/.exec(line)?.[1];
    const key = `${c[0]}/${port}/${portee}`; if (seen.has(key)) { if (prog) { const o = l.find((x) => `${x.proto}/${x.port}/${x.portee}` === key); if (o && !o.prog) o.prog = prog; } continue; }
    seen.add(key); l.push({ proto: c[0] as 'tcp' | 'udp', port, adresse, portee, ...(prog ? { prog } : {}) });
  }
  return l.sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));
}
/** « ufw status verbose » → état, politique par défaut, règles. Pur. */
export function lireUfw(out: string): Ufw {
  const actif = /^Status:\s*active/mi.test(out) || /^État\s*:\s*actif/mi.test(out);
  const d = /^(?:Default|Par défaut)\s*:\s*(\w+)\s*\((?:incoming|entrant)\),\s*(\w+)\s*\((?:outgoing|sortant)\)/mi.exec(out);
  const regles: RegleUfw[] = [];
  for (const line of out.split('\n')) {
    const m = /^(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?: (IN|OUT|FWD))?\s{2,}(.+)$/.exec(line.trimEnd()); if (!m || m[3] === 'OUT' || m[3] === 'FWD') continue;
    regles.push({ vers: m[1].replace(/\s*\(v6\)$/, '').trim(), action: m[2], depuis: m[4].replace(/\s*\(v6\)$/, '').trim(), v6: /\(v6\)/.test(line) });
  }
  return { actif, entrant: (d?.[1] ?? (actif ? 'deny' : 'allow')).toLowerCase(), sortant: (d?.[2] ?? 'allow').toLowerCase(), regles };
}
/** Une règle ufw couvre-t-elle ce port ? (« 22/tcp », « 80,443/tcp », « 8000:8100/tcp », « 53 ») Pur. */
export function couvre(vers: string, port: number, proto: 'tcp' | 'udp'): boolean {
  const m = /^([\d,:]+)(?:\/(tcp|udp))?$/.exec(vers.trim()); if (!m || (m[2] && m[2] !== proto)) return false;
  return m[1].split(',').some((x) => { const [a, b] = x.split(':').map(Number); return b ? port >= a && port <= b : port === a; });
}
export type Acces = 'ouvert' | 'filtré' | 'local';
/** Un port à l'écoute est-il joignable depuis le réseau ? (lié à la machine seule : non ; pare-feu éteint : oui). Pur. */
export function acces(e: Ecoute, fw?: Ufw): { acces: Acces; depuis?: string } {
  if (e.portee === 'machine') return { acces: 'local' };
  if (!fw?.actif) return { acces: 'ouvert', depuis: 'tout le réseau' };
  const r = fw.regles.filter((x) => !x.v6 && couvre(x.vers, e.port, e.proto));
  const non = r.find((x) => x.action === 'DENY' || x.action === 'REJECT'), oui = r.find((x) => x.action === 'ALLOW' || x.action === 'LIMIT');
  if (oui && (!non || r.indexOf(oui) < r.indexOf(non))) return { acces: 'ouvert', depuis: /^Anywhere$/i.test(oui.depuis) ? 'tout le réseau' : oui.depuis };
  if (non) return { acces: 'filtré' };
  return fw.entrant === 'allow' ? { acces: 'ouvert', depuis: 'tout le réseau' } : { acces: 'filtré' };
}
/** « ip -j route » → les routes (la passerelle par défaut en premier). Pur. */
export function lireRoutes(json: string): Route[] {
  try { return (JSON.parse(json) as Array<{ dst: string; gateway?: string; dev?: string }>).map((r) => ({ vers: r.dst === 'default' ? 'Internet (par défaut)' : r.dst, ...(r.gateway ? { via: r.gateway } : {}), ...(r.dev ? { carte: r.dev } : {}), defaut: r.dst === 'default' })).sort((a, b) => Number(b.defaut) - Number(a.defaut)); } catch { return []; }
}
/** À qui est ce port ? (les ports d'Odin sont connus ; sinon le programme à l'écoute). Pur. */
export function quiEst(e: Ecoute): string {
  const o = ODIN_PORTS.find((p) => p.port === e.port && p.proto === e.proto);
  if (o) return `${o.name} : ${o.what}`;
  const connus: Record<number, string> = { 22: 'SSH (prise en main à distance)', 25: 'courrier (SMTP)', 80: 'site web', 443: 'site web (HTTPS)', 139: 'partage Windows (Samba)', 445: 'partage Windows (Samba)', 631: 'impression (CUPS)', 2049: 'partage Linux (NFS)', 3306: 'base MySQL', 5353: 'découverte du réseau (mDNS)', 5432: 'base PostgreSQL', 6379: 'Redis', 8006: 'Proxmox', 3389: 'bureau à distance (RDP)', 5900: 'bureau à distance (VNC)', 111: 'services Linux (rpcbind)', 68: 'adresse de la machine (DHCP)', 123: 'heure (NTP)', 1900: 'découverte du réseau (UPnP)' };
  return connus[e.port] ?? e.prog ?? 'programme inconnu';
}
/** Odin tourne-t-il dans un conteneur ? (ses ports sont alors ceux du conteneur : seuls ceux que tu as publiés sortent) */
export const dansConteneur = (has: (p: string) => boolean = existsSync, env: NodeJS.ProcessEnv = process.env) => has('/.dockerenv') || has('/run/.containerenv') || Boolean(env.container);
const SENSIBLES = new Set([23, 139, 445, 3306, 5432, 6379, 27017, 9200, 5900, 3389, 2375, 111]);
type Fw = 'ufw' | 'firewalld' | 'aucun';
async function quelPareFeu(ctx: ModCtx): Promise<Fw> { if (process.platform !== 'linux') return 'aucun'; if (await ctx.has('ufw')) return 'ufw'; if (await ctx.has('firewall-cmd')) return 'firewalld'; return 'aucun'; }
async function lireEtat(ctx: ModCtx): Promise<{ fw: Fw; ufw?: Ufw; ecoutes: Ecoute[]; routes: Route[]; routage: boolean; firewalld?: { actif: boolean; ports: string[]; services: string[] } }> {
  const fw = await quelPareFeu(ctx); let ufw: Ufw | undefined, firewalld: { actif: boolean; ports: string[]; services: string[] } | undefined;
  if (fw === 'ufw') { const r = await ctx.run('ufw', ['status', 'verbose'], { sudo: true, timeoutMs: 10_000 }); if (!r.code) ufw = lireUfw(r.out); }
  if (fw === 'firewalld') {
    const st = await ctx.run('firewall-cmd', ['--state'], { timeoutMs: 10_000 }), actif = !st.code && /running/.test(st.out);
    const p = actif ? await ctx.run('firewall-cmd', ['--list-ports'], { sudo: true }) : { out: '' }, sv = actif ? await ctx.run('firewall-cmd', ['--list-services'], { sudo: true }) : { out: '' };
    firewalld = { actif, ports: p.out.trim().split(/\s+/).filter(Boolean), services: sv.out.trim().split(/\s+/).filter(Boolean) };
    ufw = { actif, entrant: 'deny', sortant: 'allow', regles: firewalld.ports.map((x) => ({ vers: x.replace('-', ':'), action: 'ALLOW', depuis: 'Anywhere', v6: false })) };
  }
  const ss = process.platform === 'linux' ? await ctx.run('ss', ['-tulnpH'], { timeoutMs: 10_000 }) : { code: 1, out: '' };
  const rt = process.platform === 'linux' ? await ctx.run('ip', ['-j', 'route'], { timeoutMs: 10_000 }) : { code: 1, out: '' };
  const fwd = process.platform === 'linux' ? await ctx.run('cat', ['/proc/sys/net/ipv4/ip_forward'], { timeoutMs: 5000 }) : { code: 1, out: '' };
  return { fw, ufw, ecoutes: ss.code ? [] : lireSs(ss.out), routes: rt.code ? [] : lireRoutes(rt.out), routage: !fwd.code && fwd.out.trim() === '1', firewalld };
}
const portParam = { key: 'port', label: 'Port (ex. 8080)', kind: 'number' as const, required: true };
const protoParam = { key: 'proto', label: 'Protocole', kind: 'select' as const, options: ['tcp', 'udp'], default: 'tcp' };
function lirePort(i: Record<string, unknown>): { port: number; proto: 'tcp' | 'udp' } {
  const port = Number(i.port); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port entre 1 et 65535');
  return { port, proto: s(i.proto) === 'udp' ? 'udp' : 'tcp' };
}
const reseauOk = (x: string) => /^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(x);

export const hlid: Module = {
  id: 'hlid', name: 'Thermopyles', family: 'Sécurité',
  what: 'Le pare-feu et le routeur (comme pfSense) : l\'état du pare-feu de la machine, ses règles, les ports à l\'écoute et qui peut les joindre, les routes, et les ports ouverts sur la box vers Internet ; ouvrir ou fermer un port se fait avec ton accord.',
  does: ['état du pare-feu (ufw ou firewalld) et sa politique : ce qui entre, ce qui sort', 'chaque port à l\'écoute : à qui il est, et s\'il est joignable depuis le réseau ou seulement depuis la machine', 'ouvrir ou fermer un port (pour tout le réseau ou un seul sous-réseau), avec ton accord', 'allumer le pare-feu sans s\'enfermer dehors : la porte d\'Odin et SSH restent ouvertes', 'les routes et la passerelle, le routage entre réseaux', 'les ports ouverts sur la box vers Internet (UPnP), et leur fermeture', 'alerte : pare-feu éteint avec un service sensible joignable, nouveau port ouvert sur la box'],
  from: ['pfSense', 'OPNsense', 'ufw'], upstream: ['opnsense/core', 'pfsense/pfsense'],
  words: ['pare-feu', 'firewall', 'état du pare-feu', 'règles du pare-feu', 'ufw', 'firewalld', 'routeur', 'ouvrir un port', 'fermer un port', 'redirection de port', 'ports de la box', 'thermopyles', 'hlid', 'pfsense', 'opnsense'],
  actions: [
    { id: 'etat', label: 'État', what: 'Le pare-feu, sa politique et les ports joignables depuis le réseau', read: true, words: ['état du pare-feu', 'règles du pare-feu', 'quels ports sont joignables'], run: async (ctx) => {
      const e = await lireEtat(ctx), ouverts = e.ecoutes.filter((x) => acces(x, e.ufw).acces === 'ouvert');
      return { text: `Pare-feu : ${e.fw === 'aucun' ? 'aucun (ni ufw ni firewalld)' : `${e.fw} ${e.ufw?.actif ? `allumé (entrant : ${e.ufw.entrant === 'deny' ? 'refusé sauf règles' : e.ufw.entrant})` : 'éteint'}`}.\n${ouverts.length} port(s) joignable(s) depuis le réseau :\n${ouverts.map((x) => `- ${x.port}/${x.proto} · ${quiEst(x)}`).join('\n') || '- aucun'}`, data: e };
    } },
    { id: 'ouvrir_port', label: 'Ouvrir un port', what: 'Laisse entrer les connexions sur ce port (pour tout le réseau, ou un sous-réseau)', words: ['ouvre le port', 'ouvrir un port'], params: [portParam, protoParam, { key: 'depuis', label: 'Seulement depuis (ex. 192.168.1.0/24, vide : partout)', kind: 'text', default: '' }],
      grave: (i) => `ouvrir le port ${s(i.port)}/${s(i.proto) || 'tcp'} dans le pare-feu${s(i.depuis) ? ` pour ${s(i.depuis)}` : ' pour tout le monde'}`, run: async (ctx, i) => {
        const { port, proto } = lirePort(i), depuis = s(i.depuis).trim(); if (depuis && !reseauOk(depuis)) throw new Error('réseau sous la forme 192.168.1.0/24');
        const fw = await quelPareFeu(ctx);
        if (fw === 'ufw') { const r = await ctx.run('ufw', depuis ? ['allow', 'from', depuis, 'to', 'any', 'port', String(port), 'proto', proto] : ['allow', `${port}/${proto}`], { sudo: true, timeoutMs: 20_000 }); if (r.code) throw new Error(r.err.trim() || r.out.trim() || 'refusé'); }
        else if (fw === 'firewalld') { if (depuis) throw new Error('avec firewalld, Odin ouvre un port pour tout le réseau (pas de sous-réseau)'); for (const a of [['--permanent', `--add-port=${port}/${proto}`], ['--reload']]) { const r = await ctx.run('firewall-cmd', a, { sudo: true, timeoutMs: 20_000 }); if (r.code) throw new Error(r.err.trim() || 'refusé'); } }
        else throw new Error('pas de pare-feu géré sur cette machine (installe « ufw »)');
        return { text: `🚪 Port ${port}/${proto} ouvert${depuis ? ` pour ${depuis}` : ''}.` };
      }, undo: (i) => ({ action: 'fermer_port', input: { port: i.port, proto: i.proto, depuis: i.depuis }, label: 'Refermer le port' }) },
    { id: 'fermer_port', label: 'Fermer un port', what: 'Retire la règle qui laissait entrer sur ce port', words: ['ferme le port', 'fermer un port'], params: [portParam, protoParam, { key: 'depuis', label: 'Règle limitée à (vide : celle pour partout)', kind: 'text', default: '' }],
      grave: (i) => (Number(i.port) === WEB || Number(i.port) === 22 ? `fermer le port ${s(i.port)} : tu peux perdre l'accès à ${Number(i.port) === WEB ? 'Odin' : 'la machine (SSH)'} depuis le réseau` : `fermer le port ${s(i.port)}/${s(i.proto) || 'tcp'} dans le pare-feu`), run: async (ctx, i) => {
        const { port, proto } = lirePort(i), depuis = s(i.depuis).trim(); if (depuis && !reseauOk(depuis)) throw new Error('réseau sous la forme 192.168.1.0/24');
        const fw = await quelPareFeu(ctx);
        if (fw === 'ufw') { const r = await ctx.run('ufw', depuis ? ['delete', 'allow', 'from', depuis, 'to', 'any', 'port', String(port), 'proto', proto] : ['delete', 'allow', `${port}/${proto}`], { sudo: true, timeoutMs: 20_000 }); if (r.code) throw new Error(r.err.trim() || r.out.trim() || 'refusé'); }
        else if (fw === 'firewalld') { for (const a of [['--permanent', `--remove-port=${port}/${proto}`], ['--reload']]) { const r = await ctx.run('firewall-cmd', a, { sudo: true, timeoutMs: 20_000 }); if (r.code) throw new Error(r.err.trim() || 'refusé'); } }
        else throw new Error('pas de pare-feu géré sur cette machine');
        return { text: `🔒 Port ${port}/${proto} refermé.` };
      } },
    { id: 'allumer', label: 'Allumer le pare-feu', what: 'Tout ce qui entre est refusé, sauf les ports ouverts ; Odin et SSH restent joignables', words: ['allume le pare-feu'], grave: () => 'allumer le pare-feu de la machine (les connexions entrantes non autorisées seront refusées ; Odin et SSH restent ouverts)', run: async (ctx) => {
      if (await quelPareFeu(ctx) !== 'ufw') throw new Error('Odin allume seulement ufw (installe le paquet « ufw ») ; firewalld s\'allume avec « systemctl enable --now firewalld »');
      // Ne jamais s'enfermer dehors : la porte d'Odin, SSH (là où il écoute vraiment) et les ports réseau des applis d'Odin allumées.
      const e = await lireEtat(ctx), ssh = e.ecoutes.filter((x) => x.prog === 'sshd' && x.portee === 'réseau').map((x) => x.port);
      const garder = new Set<string>([`${WEB}/tcp`, ...(ssh.length ? ssh : [22]).map((p) => `${p}/tcp`)]);
      for (const x of e.ecoutes) if (x.portee === 'réseau' && ODIN_PORTS.some((p) => p.port === x.port && p.proto === x.proto && p.where !== 'interne' && p.where !== 'machine')) garder.add(`${x.port}/${x.proto}`);
      for (const k of garder) { const r = await ctx.run('ufw', ['allow', k], { sudo: true, timeoutMs: 20_000 }); if (r.code) throw new Error(`je n'allume pas le pare-feu : impossible de garder ${k} ouvert (${r.err.trim() || 'refusé'})`); }
      const r = await ctx.run('ufw', ['--force', 'enable'], { sudo: true, timeoutMs: 30_000 }); if (r.code) throw new Error(r.err.trim() || 'refusé');
      return { text: `🛡 Pare-feu allumé. Restent ouverts : ${[...garder].join(', ')}. Tout le reste qui entre est refusé.` };
    }, undo: () => ({ action: 'eteindre', input: {}, label: 'Éteindre le pare-feu' }) },
    { id: 'eteindre', label: 'Éteindre le pare-feu', what: 'Plus aucun filtrage : tous les ports à l\'écoute redeviennent joignables', words: ['éteins le pare-feu'], grave: () => 'éteindre le pare-feu : tous les ports à l\'écoute redeviennent joignables depuis le réseau', run: async (ctx) => {
      if (await quelPareFeu(ctx) !== 'ufw') throw new Error('Odin éteint seulement ufw');
      const r = await ctx.run('ufw', ['disable'], { sudo: true, timeoutMs: 30_000 }); if (r.code) throw new Error(r.err.trim() || 'refusé'); return { text: 'Pare-feu éteint.' };
    } },
    { id: 'box', label: 'Ports ouverts sur la box', what: 'Ce que la box laisse entrer d\'Internet vers la maison (UPnP), et ton adresse publique', read: true, external: true, words: ['ports de la box', 'ports ouverts sur la box', 'redirections de la box'], run: async (ctx) => {
      const g = await discover({ fetch: ctx.fetch, timeoutMs: 4000 }), ip = await externalIp(g, ctx.fetch).catch(() => ''), l = await listMappings(g, ctx.fetch);
      ctx.saveSettings({ box: { at: ctx.now().getTime(), nom: g.name ?? g.host, ip, cgnat: ip ? behindCgnat(ip) : false, ports: l } });
      return { text: `${g.name ?? 'Box'} (${g.host})${ip ? ` · adresse publique ${ip}${behindCgnat(ip) ? ' (partagée par l\'opérateur : rien n\'entre d\'Internet)' : ''}` : ''}\n${l.length ? l.map((m) => `- ${m.external}/${m.proto} → ${m.client}:${m.internal} · ${m.desc || 'sans nom'}`).join('\n') : 'Aucun port ouvert par UPnP.'}`, data: { box: g.name ?? g.host, ip, ports: l } };
    } },
    { id: 'fermer_box', label: 'Fermer un port de la box', what: 'Retire une ouverture UPnP de la box (Internet → maison)', words: ['ferme le port de la box'], params: [portParam, { key: 'proto', label: 'Protocole', kind: 'select', options: ['TCP', 'UDP'], default: 'TCP' }],
      grave: (i) => `fermer le port ${s(i.port)}/${s(i.proto) || 'TCP'} sur la box : ce qui passait par là depuis Internet ne passera plus`, run: async (ctx, i) => {
        const port = Number(i.port); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port entre 1 et 65535');
        const g = await discover({ fetch: ctx.fetch, timeoutMs: 4000 }); await deleteMapping(g, port, s(i.proto).toUpperCase() === 'UDP' ? 'UDP' : 'TCP', ctx.fetch);
        return { text: `🔒 Port ${port} fermé sur la box.` };
      } },
  ],
  async view(ctx) {
    const e = await lireEtat(ctx), rows = e.ecoutes.map((x) => ({ x, a: acces(x, e.ufw) })), ouverts = rows.filter((r) => r.a.acces === 'ouvert');
    const box = ctx.settings.box as { at: number; nom: string; ip: string; cgnat: boolean; ports: Mapping[] } | undefined;
    const risque = ouverts.filter((r) => SENSIBLES.has(r.x.port));
    const kpis: Kpi[] = [
      { label: 'Pare-feu', value: e.fw === 'aucun' ? 'Aucun' : e.ufw?.actif ? 'Allumé' : 'Éteint', tone: e.ufw?.actif ? 'bon' : 'attention', hint: e.fw === 'aucun' ? 'ni ufw ni firewalld' : e.fw },
      { label: 'Joignables du réseau', value: String(ouverts.length), tone: risque.length ? 'mauvais' : 'neutre', hint: risque.length ? `sensibles : ${risque.map((r) => r.x.port).join(', ')}` : undefined },
      { label: 'Machine seulement', value: String(rows.filter((r) => r.a.acces === 'local').length) },
      { label: 'Ouverts sur la box', value: box ? String(box.ports.length) : '—', tone: box?.ports.length ? 'attention' : 'neutre', hint: box ? `vu ${new Date(box.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : 'lance « Ports ouverts sur la box »' },
    ];
    const tone = (r: typeof rows[number]): Tone => (r.a.acces === 'ouvert' ? (SENSIBLES.has(r.x.port) ? 'mauvais' : 'attention') : 'neutre');
    return {
      subtitle: process.platform !== 'linux' ? 'Sur cette machine (pas Linux), je ne lis pas encore le pare-feu.' : dansConteneur() ? `Odin tourne dans un conteneur : ce sont ses ports à lui (seuls ceux que tu as publiés sortent), pas ceux de la machine · ${ouverts.length} port(s) à l'écoute` : `${e.fw === 'aucun' ? 'Pas de pare-feu' : e.ufw?.actif ? 'Pare-feu allumé' : 'Pare-feu éteint'} · ${ouverts.length} port(s) joignable(s) du réseau`, kpis,
      sections: [
        ...(e.fw === 'ufw' && !e.ufw?.actif ? [{ kind: 'steps' as const, title: 'Mise en route', items: [{ title: 'Allumer le pare-feu', detail: 'Odin garde sa porte et SSH ouverts, puis refuse le reste', done: false, action: 'allumer', button: 'Allumer' }] }] : []),
        { kind: 'table', title: 'Ports à l\'écoute', columns: ['Port', 'À qui', 'Programme', 'Joignable'], empty: 'Aucun port lu.', rows: rows.map((r) => ({ cells: [`${r.x.port}/${r.x.proto}`, quiEst(r.x), r.x.prog ?? '', r.a.acces === 'ouvert' ? `depuis ${r.a.depuis}` : r.a.acces === 'local' ? 'la machine seulement' : 'non (filtré par le pare-feu)'], tone: tone(r), actions: r.a.acces === 'filtré' ? [{ action: 'ouvrir_port', label: 'Ouvrir', input: { port: r.x.port, proto: r.x.proto } }] : [] })) },
        { kind: 'table', title: 'Règles du pare-feu', columns: ['Vers', 'Action', 'Depuis'], empty: e.fw === 'aucun' ? 'Pas de pare-feu géré (installe « ufw »).' : 'Aucune règle.', rows: (e.ufw?.regles ?? []).filter((r) => !r.v6).map((r) => ({ cells: [r.vers, r.action === 'ALLOW' ? 'laisse entrer' : r.action === 'LIMIT' ? 'laisse entrer (limité)' : 'refuse', /^Anywhere$/i.test(r.depuis) ? 'partout' : r.depuis], tone: r.action === 'ALLOW' || r.action === 'LIMIT' ? 'neutre' as const : 'bon' as const })) },
        { kind: 'table', title: 'Ouverts sur la box (Internet → maison)', columns: ['Port', 'Vers', 'Pour'], empty: box ? 'Aucun port ouvert par UPnP.' : 'Pas encore lu : lance « Ports ouverts sur la box ».', rows: (box?.ports ?? []).map((m) => ({ cells: [`${m.external}/${m.proto}`, `${m.client}:${m.internal}`, m.desc || 'sans nom'], tone: 'attention' as const, actions: [{ action: 'fermer_box', label: 'Fermer', input: { port: m.external, proto: m.proto } }] })) },
      ],
      side: [
        { kind: 'list', title: 'Routes', empty: 'Routes non lues.', items: e.routes.slice(0, 12).map((r) => ({ title: r.vers, detail: `${r.via ? `par ${r.via}` : 'direct'}${r.carte ? ` · ${r.carte}` : ''}` })) },
        { kind: 'text', title: 'Routage', text: e.routage ? 'Cette machine fait passer le trafic entre ses réseaux (routage allumé : VPN, conteneurs, machines virtuelles).' : 'Cette machine ne route pas le trafic des autres.' },
        ...(box?.ip ? [{ kind: 'text' as const, title: 'Adresse publique', text: `${box.ip}${box.cgnat ? ' — partagée par l\'opérateur (CGNAT) : rien ne peut entrer d\'Internet, même avec un port ouvert.' : ''}`, tone: 'neutre' as const }] : []),
      ],
    };
  },
  watch: { every: 900, async run(ctx) {
    const e = await lireEtat(ctx), sens = e.ecoutes.filter((x) => SENSIBLES.has(x.port) && acces(x, e.ufw).acces === 'ouvert');
    // Dans un conteneur, « pare-feu éteint » ne veut rien dire (c'est la machine hôte qui filtre) : pas d'alerte.
    if (sens.length && !e.ufw?.actif && !dansConteneur()) ctx.alert({ level: 'moyenne', title: `Thermopyles : ${sens.length} service(s) sensible(s) joignable(s) du réseau, pare-feu éteint`, detail: sens.map((x) => `${x.port}/${x.proto} (${quiEst(x)})`).join(', '), key: `thermopyles:sensibles:${sens.map((x) => x.port).join('-')}`, steps: ['Allume le pare-feu (Thermopyles → Allumer).', 'Ou limite ces services à la machine seule.'] });
    // Un nouveau port ouvert sur la box (une appli ou un appareil l'a demandé par UPnP) : tu dois le savoir.
    const old = ctx.settings.box as { ports: Mapping[] } | undefined;
    try {
      const g = await discover({ fetch: ctx.fetch, timeoutMs: 3000 }), ip = await externalIp(g, ctx.fetch).catch(() => ''), l = await listMappings(g, ctx.fetch);
      if (old) for (const m of l) if (!/odin/i.test(m.desc) && !old.ports.some((o) => o.external === m.external && o.proto === m.proto)) ctx.alert({ level: 'moyenne', title: `Thermopyles : nouveau port ouvert sur la box, ${m.external}/${m.proto}`, detail: `Internet → ${m.client}:${m.internal} (${m.desc || 'sans nom'}). Si ce n'est pas toi ni Odin, ferme-le.`, key: `thermopyles:box:${m.external}:${m.proto}` });
      ctx.saveSettings({ box: { at: ctx.now().getTime(), nom: g.name ?? g.host, ip, cgnat: ip ? behindCgnat(ip) : false, ports: l } });
    } catch { /* pas de box UPnP : rien à dire */ }
  } },
};
