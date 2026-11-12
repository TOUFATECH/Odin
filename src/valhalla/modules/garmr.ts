// Garmr — le chien de garde : lit les journaux (SSH, web, Odin), repère qui force tes portes et le bannit
// au pare-feu pour un temps (plus long à chaque récidive). Seule action de bannissement d'Odin : Loki,
// Geri et Forseti l'appellent aussi. Jamais ton réseau local ni les adresses que tu protèges.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { isPrivateV4 } from '../../hlidskjalf/discover.ts';
import type { ModCtx, Module } from '../types.ts';

export interface Ban { ip: string; until: number; reason: string; count: number; source: string }
const s = (v: unknown) => String(v ?? '');

/** Échecs d'authentification dans des lignes de journal (SSH, web, mail, Odin). */
export function failures(lines: string): Array<{ ip: string; what: string }> {
  const out: Array<{ ip: string; what: string }> = [];
  const pats: Array<[RegExp, string]> = [
    [/Failed password for (?:invalid user )?\S+ from ([\d.:a-f]+)/i, 'SSH : mauvais mot de passe'],
    [/Invalid user \S* ?from ([\d.:a-f]+)/i, 'SSH : utilisateur inconnu'],
    [/authentication failure;.*rhost=([\d.:a-f]+)/i, 'authentification refusée'],
    [/Connection closed by authenticating user \S+ ([\d.:a-f]+)/i, 'SSH : abandon après essai'],
    [/maximum authentication attempts exceeded .* from ([\d.:a-f]+)/i, 'SSH : trop d\'essais'],
    [/^([\d.:a-f]+) \S+ \S+ \[[^\]]+\] "(?:GET|POST)[^"]*(?:wp-login|xmlrpc|\.env|phpmyadmin|\/\.git)[^"]*" (?:4\d\d|200)/i, 'web : recherche de failles'],
    [/^([\d.:a-f]+) \S+ \S+ \[[^\]]+\] "[^"]*" 401 /, 'web : mot de passe refusé'],
    [/odin-auth: échec de connexion depuis ([\d.:a-f]+)/i, 'Odin : mauvais code'],
    [/SASL \w+ authentication failed.*\[([\d.:a-f]+)\]/i, 'mail : mot de passe refusé'],
  ];
  for (const l of lines.split('\n')) for (const [re, what] of pats) { const m = re.exec(l); if (m && isIP(m[1])) { out.push({ ip: m[1], what }); break; } }
  return out;
}
export const protectedIp = (ip: string, allow: string[] = []) => ip === '127.0.0.1' || ip === '::1' || isPrivateV4(ip) || /^fe80:|^fd/i.test(ip) || allow.includes(ip);

async function fw(ctx: ModCtx, op: 'ban' | 'unban' | 'init', ip = '', seconds = 0): Promise<string> {
  // Le pare-feu lit ses arguments comme un petit programme : seule une vraie adresse IP peut y entrer.
  if (op !== 'init' && !isIP(ip)) throw new Error(`adresse invalide : ${ip.slice(0, 60)}`);
  seconds = Math.min(Math.max(Math.round(Number(seconds) || 0), 0), 366 * 86_400);
  if (await ctx.has('nft')) {
    if (op === 'init') { await ctx.run('nft', ['add', 'table', 'inet', 'odin'], { sudo: true }); await ctx.run('nft', ['add', 'set', 'inet', 'odin', 'garmr4', '{ type ipv4_addr; flags timeout; }'], { sudo: true }); await ctx.run('nft', ['add', 'chain', 'inet', 'odin', 'entree', '{ type filter hook input priority -10; }'], { sudo: true }); const r = await ctx.run('nft', ['list', 'chain', 'inet', 'odin', 'entree'], { sudo: true }); if (!r.out.includes('@garmr4')) await ctx.run('nft', ['add', 'rule', 'inet', 'odin', 'entree', 'ip', 'saddr', '@garmr4', 'drop'], { sudo: true }); return 'nftables'; }
    if (ip.includes(':')) return 'IPv6 non géré';
    const r = await ctx.run('nft', [op === 'ban' ? 'add' : 'delete', 'element', 'inet', 'odin', 'garmr4', `{ ${ip}${op === 'ban' ? ` timeout ${seconds}s` : ''} }`], { sudo: true });
    if (r.code && op === 'ban') throw new Error(r.err.trim() || 'pare-feu inaccessible (droits administrateur nécessaires)');
    return 'nftables';
  }
  if (await ctx.has('iptables')) {
    if (op === 'init') return 'iptables';
    const r = await ctx.run('iptables', [op === 'ban' ? '-I' : '-D', 'INPUT', '-s', ip, '-j', 'DROP', '-m', 'comment', '--comment', 'odin-garmr'], { sudo: true });
    if (r.code && op === 'ban') throw new Error(r.err.trim() || 'pare-feu inaccessible');
    return 'iptables';
  }
  throw new Error('aucun pare-feu pilotable (nftables ou iptables)');
}

// ---------------- Ports ouverts sur la machine d'Odin (pare-feu de la machine) ----------------
export interface OpenPort { port: number; proto: 'tcp' | 'udp'; why: string; by: string; via: string; at: number; box?: boolean }
const openPorts = (ctx: ModCtx): OpenPort[] => (ctx.settings.openPorts as OpenPort[] | undefined) ?? [];
/** Le pare-feu actif de la machine (ufw, firewalld), ou aucun (alors le port est déjà joignable). */
async function hostFirewall(ctx: ModCtx): Promise<'ufw' | 'firewalld' | undefined> {
  if (await ctx.has('ufw')) { const r = await ctx.run('ufw', ['status'], { sudo: true }); if (/Status:\s*active|État\s*:\s*actif/i.test(r.out)) return 'ufw'; }
  if (await ctx.has('firewall-cmd')) { const r = await ctx.run('firewall-cmd', ['--state'], { sudo: true }); if (/running/.test(r.out)) return 'firewalld'; }
  return undefined;
}
/** Ouvre (ou ferme) un port sur la machine. Rend le moyen utilisé. */
export async function hostPort(ctx: ModCtx, op: 'ouvrir' | 'fermer', port: number, proto: 'tcp' | 'udp', why = ''): Promise<string> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port invalide');
  const fw = await hostFirewall(ctx);
  if (fw === 'ufw') { const r = await ctx.run('ufw', op === 'ouvrir' ? ['allow', `${port}/${proto}`, 'comment', `Odin ${why}`.slice(0, 60).replace(/[^\w .:-]/g, '')] : ['delete', 'allow', `${port}/${proto}`], { sudo: true }); if (r.code) throw new Error(r.err.trim() || 'ufw a refusé (droits administrateur nécessaires)'); return 'ufw'; }
  if (fw === 'firewalld') { for (const perm of [[], ['--permanent']]) { const r = await ctx.run('firewall-cmd', [...perm, op === 'ouvrir' ? `--add-port=${port}/${proto}` : `--remove-port=${port}/${proto}`], { sudo: true }); if (r.code) throw new Error(r.err.trim() || 'firewalld a refusé'); } return 'firewalld'; }
  return 'aucun pare-feu actif';
}

export function bans(ctx: ModCtx): Ban[] { return ((ctx.settings.bans as Ban[] | undefined) ?? []).filter((b) => b.until > ctx.now().getTime()); }
export async function ban(ctx: ModCtx, ip: string, reason: string, source = 'Garmr', baseMinutes?: number): Promise<{ text: string; ok: boolean }> {
  if (!isIP(ip)) return { ok: false, text: `adresse invalide : ${ip}` };
  const allow = (ctx.settings.allow as string[] | undefined) ?? [];
  if (protectedIp(ip, allow)) return { ok: false, text: `${ip} est protégée (réseau local ou liste blanche) : pas de bannissement.` };
  const hist = (ctx.settings.history as Record<string, number> | undefined) ?? {};
  const n = (hist[ip] ?? 0) + 1;
  const minutes = Math.min(60 * 24 * 30, (baseMinutes ?? Number(ctx.settings.minutes ?? 60)) * 4 ** (n - 1)); // récidive : ×4
  const how = await fw(ctx, 'ban', ip, minutes * 60);
  const until = ctx.now().getTime() + minutes * 60_000;
  ctx.saveSettings({ bans: [...bans(ctx).filter((b) => b.ip !== ip), { ip, until, reason, count: n, source }], history: { ...hist, [ip]: n } });
  ctx.emit('banni', { ip, raison: reason, minutes, récidive: n, source });
  return { ok: true, text: `⛔ ${ip} banni ${minutes >= 1440 ? `${Math.round(minutes / 1440)} j` : minutes >= 60 ? `${Math.round(minutes / 60)} h` : `${minutes} min`} (${reason}${n > 1 ? `, récidive n°${n}` : ''}) via ${how}.` };
}

const LOGS = ['/var/log/auth.log', '/var/log/secure', '/var/log/nginx/access.log', '/var/log/apache2/access.log', '/var/log/mail.log'];

export const garmr: Module = {
  id: 'garmr', name: 'Garmr', family: 'Sécurité',
  what: 'Bannit au pare-feu ceux qui essaient d\'entrer de force (SSH, sites, mail, Odin).',
  does: ['lit les journaux SSH, web, mail et ceux d\'Odin', 'bannit après 5 échecs en 10 minutes (réglable)', 'durée multipliée par 4 à chaque récidive', 'liste blanche ; jamais le réseau local', 'seule action de bannissement d\'Odin, utilisée par Loki, Geri et Forseti'],
  from: ['Fail2ban'], upstream: ['fail2ban/fail2ban'],
  words: ['bannir', 'banni', 'bannis', 'ban', 'bloquer une ip', 'force brute', 'brute force', 'tentatives', 'pare-feu', 'firewall', 'attaque ssh'],
  actions: [
    { id: 'bannis', label: 'Bannis en ce moment', what: 'Adresses bannies et pour combien de temps', read: true, words: ['bannis', 'liste', 'adresses bannies', 'qui est banni'], run: (ctx) => { const b = bans(ctx); return { text: b.map((x) => `- ${x.ip} · ${x.reason} · jusqu'à ${new Date(x.until).toLocaleString('fr-FR')}`).join('\n') || 'Personne n\'est banni.', data: b }; } },
    { id: 'bannir', undo: (i) => ({ action: 'debannir', input: { ip: i.ip }, label: 'adresse débannie' }), label: 'Bannir une adresse', what: 'Bloque une adresse au pare-feu', params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', required: true }, { key: 'raison', label: 'Raison', kind: 'text', default: 'à la demande' }, { key: 'minutes', label: 'Durée (minutes)', kind: 'number', default: 60 }], words: ['bannis', 'bloque'], run: (ctx, i) => ban(ctx, s(i.ip).trim(), s(i.raison) || 'à la demande', s(i.source) || 'toi', Number(i.minutes) || undefined) },
    { id: 'debannir', undo: (i) => ({ action: 'bannir', input: { ip: i.ip, raison: 'bannissement remis', minutes: 60 }, label: 'adresse bannie de nouveau (1 h)' }), label: 'Débannir', what: 'Retire une adresse du pare-feu', params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', required: true }], words: ['debannis', 'débannis', 'autorise'], run: async (ctx, i) => { const ip = s(i.ip).trim(); if (!isIP(ip)) return { ok: false, text: `adresse invalide : ${ip.slice(0, 60)}` }; await fw(ctx, 'unban', ip).catch(() => ''); ctx.saveSettings({ bans: bans(ctx).filter((b) => b.ip !== ip) }); return { text: `✅ ${ip} n'est plus banni.` }; } },
    { id: 'ouvrir_port', label: 'Ouvrir un port', what: 'Sur la machine d\'Odin (pare-feu), et sur la box si demandé (UPnP)', params: [{ key: 'port', label: 'Port', kind: 'number', required: true }, { key: 'proto', label: 'Protocole', kind: 'select', options: ['tcp', 'udp'], default: 'tcp' }, { key: 'pour', label: 'Pour quoi (ex. proxy, VPN)', kind: 'text', default: '' }, { key: 'box', label: 'Aussi sur la box (accès depuis Internet)', kind: 'boolean', default: false }], run: async (ctx, i) => {
      const port = Number(i.port), proto = (i.proto === 'udp' ? 'udp' : 'tcp') as 'tcp' | 'udp', why = String(i.pour ?? '').slice(0, 60);
      const via = await hostPort(ctx, 'ouvrir', port, proto, why);
      let boxText = '';
      if (i.box === true) { try { const { openPorts: upnp } = await import('../upnp.ts'); boxText = ` ${(await upnp([{ port, proto: proto.toUpperCase() as 'TCP' | 'UDP' }], `Odin · ${why || 'port'}`, ctx.fetch)).text}`; } catch (e) { boxText = ` Box : ${(e as Error).message} (sinon : le tunnel Cloudflare, Brú, pour le web).`; } }
      ctx.saveSettings({ openPorts: [...openPorts(ctx).filter((x) => !(x.port === port && x.proto === proto)), { port, proto, why, by: String(i.par ?? 'toi'), via, at: Date.now(), ...(i.box === true ? { box: true } : {}) }] });
      return { text: `🔓 Port ${port}/${proto} ${via === 'aucun pare-feu actif' ? 'déjà joignable (pas de pare-feu actif sur la machine)' : `ouvert sur la machine (${via})`}${why ? ` pour ${why}` : ''}.${boxText}` };
    }, undo: (i) => ({ action: 'fermer_port', input: { port: i.port, proto: i.proto ?? 'tcp' }, label: 'Refermer le port' }) },
    { id: 'fermer_port', label: 'Fermer un port', what: 'Sur la machine d\'Odin (et la box si Odin l\'y avait ouvert)', quick: false, grave: (i) => `fermer le port ${String(i.port)} (le service ne sera plus joignable de l'extérieur de la machine)`, params: [{ key: 'port', label: 'Port', kind: 'number', required: true }, { key: 'proto', label: 'Protocole', kind: 'select', options: ['tcp', 'udp'], default: 'tcp' }], run: async (ctx, i) => {
      const port = Number(i.port), proto = (i.proto === 'udp' ? 'udp' : 'tcp') as 'tcp' | 'udp', x = openPorts(ctx).find((y) => y.port === port && y.proto === proto);
      const via = await hostPort(ctx, 'fermer', port, proto);
      if (x?.box) { try { const { closePorts } = await import('../upnp.ts'); await closePorts([{ port, proto: proto.toUpperCase() as 'TCP' | 'UDP' }], ctx.fetch); } catch { /* box injoignable */ } }
      ctx.saveSettings({ openPorts: openPorts(ctx).filter((y) => y !== x) });
      return { text: `🔒 Port ${port}/${proto} fermé (${via}).` };
    } },
    { id: 'ports_ouverts', label: 'Ports ouverts par Odin', what: 'Ce qu\'Odin a ouvert, pour qui, et comment', read: true, words: ['ports ouverts du pare-feu', 'ports ouverts', 'port ouvert'], run: (ctx) => ({ text: openPorts(ctx).map((x) => `- ${x.port}/${x.proto} · ${x.why || 'sans nom'} · ${x.via}${x.box ? ' + box' : ''} · demandé par ${x.by}`).join('\n') || 'Aucun port ouvert par Odin.', data: openPorts(ctx) }) },
    { id: 'journal', label: 'Surveiller un journal', what: 'Ajoute un fichier journal à lire (application, site…)', params: [{ key: 'fichier', label: 'Chemin du fichier', kind: 'text', required: true }], run: (ctx, i) => { const f = s(i.fichier).trim(); if (!f.startsWith('/') || !existsSync(f)) return { ok: false, text: 'fichier introuvable (chemin complet attendu)' }; ctx.saveSettings({ logs: [...new Set([...((ctx.settings.logs as string[]) ?? []), f])] }); return { text: `👁 ${f} est maintenant surveillé.` }; } },
    { id: 'proteger', label: 'Protéger une adresse', what: 'Ajoute à la liste blanche (jamais bannie)', params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', required: true }], run: (ctx, i) => { const ip = s(i.ip).trim(); if (!isIP(ip)) return { ok: false, text: 'adresse invalide' }; ctx.saveSettings({ allow: [...new Set([...((ctx.settings.allow as string[]) ?? []), ip])] }); return { text: `🛡 ${ip} ne sera jamais bannie.` }; } },
  ],
  async start(ctx) {
    try {
      await fw(ctx, 'init');
      // Le pare-feu oublie tout au redémarrage de la machine : les bannissements encore valables sont remis.
      for (const b of bans(ctx)) await fw(ctx, 'ban', b.ip, Math.max(60, Math.round((b.until - ctx.now().getTime()) / 1000))).catch(() => '');
    } catch { /* pare-feu absent : signalé dans la vue */ }
  },
  view(ctx) {
    const b = bans(ctx), hist = (ctx.settings.history as Record<string, number> | undefined) ?? {};
    const top = Object.entries(hist).sort((a, x) => x[1] - a[1]).slice(0, 8);
    return {
      subtitle: `Bannit après ${ctx.settings.maxretry ?? 5} échecs en ${ctx.settings.findtime ?? 10} min · ${ctx.settings.minutes ?? 60} min la première fois, ×4 à chaque récidive`,
      kpis: [{ label: 'Bannis en ce moment', value: String(b.length), tone: b.length ? 'attention' : 'bon' }, { label: 'Adresses déjà vues', value: String(Object.keys(hist).length) }, { label: 'Liste blanche', value: String(((ctx.settings.allow as string[]) ?? []).length) }],
      sections: [{ kind: 'table', title: 'Ports ouverts par Odin', columns: ['Port', 'Pour', 'Comment', 'Demandé par', 'Le'], empty: 'Aucun : les applis en ouvrent un quand elles en ont besoin.', rows: openPorts(ctx).map((x) => ({ cells: [`${x.port}/${x.proto}`, x.why || '—', `${x.via}${x.box ? ' + box (UPnP)' : ''}`, x.by, new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })], actions: [{ action: 'fermer_port', label: 'Fermer', input: { port: x.port, proto: x.proto } }] })) }, { kind: 'table', title: 'Bannis', columns: ['Adresse', 'Raison', 'Par', 'Jusqu\'à', 'Récidive'], empty: 'Personne n\'est banni.', rows: b.map((x) => ({ cells: [x.ip, x.reason, x.source, new Date(x.until).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }), String(x.count)], actions: [{ action: 'debannir', label: 'Débannir', input: { ip: x.ip } }] })) }],
      side: [{ kind: 'form', title: 'Bannir une adresse', action: 'bannir', submit: 'Bannir', params: garmr.actions.find((a) => a.id === 'bannir')?.params ?? [] }, { kind: 'list', title: 'Les plus insistants', items: top.map(([ip, n]) => ({ title: ip, meta: `${n} fois` })), empty: 'Rien pour l\'instant.' }],
    };
  },
  watch: { every: 30, async run(ctx) {
    const all = (ctx.settings.bans as Ban[] | undefined) ?? [], over = all.filter((b) => b.until <= ctx.now().getTime());
    if (over.length) { for (const b of over) await fw(ctx, 'unban', b.ip).catch(() => ''); ctx.saveSettings({ bans: all.filter((b) => b.until > ctx.now().getTime()) }); }
    // Nouvelles lignes depuis la dernière lecture (journal système, puis fichiers classiques).
    let text = '';
    const since = (ctx.settings.since as string) || new Date(ctx.now().getTime() - 10 * 60_000).toISOString();
    if (ctx.settings.useJournal !== false && await ctx.has('journalctl')) { const r = await ctx.run('journalctl', ['--since', since.replace('T', ' ').slice(0, 19), '-o', 'cat', '--no-pager', '-q'], { sudo: true, timeoutMs: 20_000 }); if (!r.code) text += r.out; }
    const pos = (ctx.settings.pos as Record<string, number> | undefined) ?? {};
    for (const f of [...(ctx.settings.useSystemLogs === false ? [] : LOGS), ...((ctx.settings.logs as string[] | undefined) ?? [])]) { if (!existsSync(f)) continue; try { const size = statSync(f).size, from = pos[f] ?? Math.max(0, size - 200_000); if (size < from) pos[f] = 0; const buf = readFileSync(f, 'utf8').slice(from <= size ? from : 0); text += `\n${buf}`; pos[f] = size; } catch { /* illisible sans droits */ } }
    ctx.saveSettings({ since: ctx.now().toISOString(), pos });
    const fails = failures(text), window = Number(ctx.settings.findtime ?? 10) * 60_000, max = Number(ctx.settings.maxretry ?? 5);
    const seen = (ctx.settings.fails as Record<string, number[]> | undefined) ?? {}, now = ctx.now().getTime();
    for (const f of fails) seen[f.ip] = [...(seen[f.ip] ?? []).filter((t) => now - t < window), now];
    for (const [ip, ts] of Object.entries(seen)) {
      if (ts.length >= max && !bans(ctx).some((b) => b.ip === ip)) {
        const what = fails.find((f) => f.ip === ip)?.what ?? 'échecs répétés';
        const r = await ban(ctx, ip, `${ts.length} échecs : ${what}`).catch((e) => ({ ok: false, text: (e as Error).message }));
        if (r.ok) ctx.alert({ level: 'moyenne', title: `${ip} banni`, detail: r.text, key: `ban:${ip}` });
        delete seen[ip];
      }
      if (!seen[ip]?.some((t) => now - t < window)) delete seen[ip];
    }
    ctx.saveSettings({ fails: seen });
  } },
};
