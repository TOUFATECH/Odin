// Méduse — détection d'intrusion réseau et journal des connexions (mode « Clio ») : chaque connexion de
// la machine est comparée aux listes publiques d'adresses malveillantes (mises à jour chaque jour),
// aux ports typiques des pirates, et notée dans un journal (qui parle à qui, depuis quand).
// Une adresse malveillante est bannie par Cerbère, l'alerte part dans Forseti.

import { isIP } from 'node:net';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPrivateV4 } from '../../hlidskjalf/discover.ts';
import type { ModCtx, Module } from '../types.ts';

export interface Conn { proto: string; local: string; remote: string; rip: string; rport: number; prog: string }
export function parseSs(out: string): Conn[] {
  return out.split('\n').map((l) => {
    const c = l.trim().split(/\s+/); if (c.length < 5) return undefined;
    const proto = c[0], local = c[3] ?? '', remote = c[4] ?? '';
    const cut = remote.lastIndexOf(':'), rip = remote.slice(0, cut).replace(/^\[|\]$/g, '').replace(/^::ffff:/, ''), rport = Number(remote.slice(cut + 1));
    if (!isIP(rip)) return undefined;
    return { proto, local, remote, rip, rport, prog: /users:\(\("([^"]+)"/.exec(l)?.[1] ?? '?' };
  }).filter((x): x is Conn => Boolean(x));
}
/** Listes d'adresses : une IP ou un réseau CIDR par ligne (commentaires #). */
export function parseList(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const l of text.split('\n')) { const m = /^\s*(\d+\.\d+\.\d+\.\d+)(?:\/(\d+))?/.exec(l); if (!m) continue; const ip = toInt(m[1]), bits = Number(m[2] ?? 32); const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0; out.push([(ip & mask) >>> 0, mask]); }
  return out;
}
const toInt = (ip: string) => ip.split('.').reduce((a, x) => ((a << 8) | Number(x)) >>> 0, 0);
export const inList = (ip: string, list: Array<[number, number]>) => { if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false; const n = toInt(ip); return list.some(([net, mask]) => ((n & mask) >>> 0) === net); };
const BAD_PORTS: Record<number, string> = { 3333: 'pool de minage', 4444: 'porte dérobée courante', 5555: 'pool de minage / ADB', 6667: 'IRC (botnets)', 14444: 'pool de minage', 1337: 'porte dérobée', 31337: 'porte dérobée' };
const LISTS = ['https://iplists.firehol.org/files/firehol_level1.netset', 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt'];

let cache: Array<[number, number]> | undefined;
function list(ctx: ModCtx): Array<[number, number]> { if (!cache) { const f = join(ctx.dir, 'listes.txt'); cache = existsSync(f) ? parseList(readFileSync(f, 'utf8')) : []; } return cache; }
async function refresh(ctx: ModCtx): Promise<number> {
  let text = '';
  for (const u of LISTS) { try { const r = await ctx.fetch(u, { signal: AbortSignal.timeout(30_000) }); if (r.ok) text += `${await r.text()}\n`; } catch { /* une liste indisponible */ } }
  if (!text) return list(ctx).length;
  writeFileSync(join(ctx.dir, 'listes.txt'), text); cache = parseList(text); ctx.saveSettings({ listsAt: ctx.now().toISOString() });
  return cache.length;
}
type JournalRow = { prog: string; dest: string; first: string; last: string; n: number };
function journal(ctx: ModCtx): Record<string, JournalRow> { try { return JSON.parse(readFileSync(join(ctx.dir, 'journal.json'), 'utf8')); } catch { return {}; } }

export const geri: Module = {
  id: 'geri', name: 'Méduse', family: 'Sécurité',
  what: 'Surveille les connexions réseau de la machine : adresses malveillantes connues, ports de pirates, et journal de qui parle à qui.',
  does: ['compare chaque connexion aux listes publiques d\'adresses malveillantes (mises à jour chaque jour)', 'repère les ports typiques des pirates (minage, portes dérobées, IRC)', 'journal des connexions (mode Clio) : programme, destination, première et dernière fois', 'bannit les adresses malveillantes via Cerbère', 'alerte quand un programme contacte une nouvelle destination à l\'étranger la nuit'],
  from: ['Suricata', 'Zeek'], upstream: ['OISF/suricata', 'zeek/zeek'],
  modes: ['Clio · journal des connexions'],
  words: ['intrusion', 'connexion', 'connexions', 'trafic', 'reseau suspect', 'réseau suspect', 'qui parle', 'adresse malveillante', 'botnet', 'freki', 'ids'],
  actions: [
    { id: 'connexions', label: 'Connexions en cours', what: 'Qui parle à qui en ce moment', read: true, words: ['connexions', 'qui parle'], run: async (ctx) => { const c = parseSs((await ctx.run('ss', ['-tunpH', 'state', 'established'], { timeoutMs: 10_000 })).out).filter((x) => !isPrivateV4(x.rip)); return { text: c.map((x) => `- ${x.prog} → ${x.rip}:${x.rport}${inList(x.rip, list(ctx)) ? ' ⚠ MALVEILLANTE' : ''}`).join('\n') || 'Aucune connexion vers Internet.', data: c }; } },
    { id: 'journal', label: 'Journal des connexions', what: 'Destinations vues récemment, par programme', read: true, words: ['journal', 'historique'], run: (ctx) => { const j = Object.values(journal(ctx)).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 60); return { text: j.map((r) => `- ${r.prog} → ${r.dest} · ${r.n} fois · dernière ${r.last.slice(0, 16).replace('T', ' ')}`).join('\n') || 'Journal vide.', data: j }; } },
    { id: 'listes', label: 'Mettre à jour les listes', what: 'Télécharge les listes d\'adresses malveillantes', run: async (ctx) => ({ text: `🛰 ${await refresh(ctx)} réseaux malveillants connus.` }) },
    { id: 'verifier', label: 'Vérifier une adresse', what: 'Est-elle dans les listes ?', read: true, params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', required: true }], run: (ctx, i) => { const ip = String(i.ip).trim(); return { text: inList(ip, list(ctx)) ? `⚠ ${ip} est dans les listes d'adresses malveillantes.` : `✓ ${ip} n'est dans aucune liste.` }; } },
  ],
  async view(ctx) {
    const c = parseSs((await ctx.run('ss', ['-tunpH', 'state', 'established'], { timeoutMs: 10_000 })).out).filter((x) => !isPrivateV4(x.rip));
    const j = Object.values(journal(ctx)).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 40), bad = c.filter((x) => inList(x.rip, list(ctx)));
    return {
      subtitle: `Listes à jour : ${ctx.settings.listsAt ? new Date(String(ctx.settings.listsAt)).toLocaleString('fr-FR') : 'jamais'} · ${list(ctx).length} réseaux malveillants connus`,
      tabs: ['Méduse · intrusions', 'Clio · journal'],
      kpis: [{ label: 'Connexions vers Internet', value: String(c.length) }, { label: 'Vers une adresse malveillante', value: String(bad.length), tone: bad.length ? 'mauvais' : 'bon' }, { label: 'Destinations connues', value: String(Object.keys(journal(ctx)).length) }],
      sections: [
        { kind: 'table', title: 'Connexions en cours', columns: ['Programme', 'Destination', 'Port', 'Statut'], empty: 'Aucune connexion vers Internet.', rows: c.map((x) => ({ cells: [x.prog, x.rip, String(x.rport), inList(x.rip, list(ctx)) ? 'MALVEILLANTE' : BAD_PORTS[x.rport] ?? 'normal'], tone: inList(x.rip, list(ctx)) ? 'mauvais' : BAD_PORTS[x.rport] ? 'attention' : undefined, actions: [{ action: 'verifier', label: 'Vérifier', input: { ip: x.rip } }] })) },
        { kind: 'table', title: 'Clio · journal des connexions', columns: ['Programme', 'Destination', 'Fois', 'Première', 'Dernière'], rows: j.map((r) => ({ cells: [r.prog, r.dest, String(r.n), r.first.slice(0, 16).replace('T', ' '), r.last.slice(0, 16).replace('T', ' ')] })) },
      ],
    };
  },
  watch: { every: 45, async run(ctx) {
    const last = ctx.settings.listsAt ? Date.parse(String(ctx.settings.listsAt)) : 0;
    if (ctx.now().getTime() - last > 86_400_000) await refresh(ctx);
    const r = await ctx.run('ss', ['-tunpH', 'state', 'established'], { timeoutMs: 10_000 }); if (r.code) return;
    const j = journal(ctx), now = ctx.now().toISOString();
    for (const c of parseSs(r.out)) {
      if (isPrivateV4(c.rip) || c.rip === '127.0.0.1') continue;
      const k = `${c.prog}|${c.rip}:${c.rport}`;
      const row = j[k] ?? { prog: c.prog, dest: `${c.rip}:${c.rport}`, first: now, last: now, n: 0 };
      if (!j[k]) ctx.emit('nouvelle_destination', { programme: c.prog, ip: c.rip, port: c.rport });
      row.last = now; row.n++; j[k] = row;
      if (inList(c.rip, list(ctx))) {
        ctx.alert({ level: 'critique', title: `${c.prog} parle à une adresse malveillante`, detail: `${c.rip}:${c.rport} est dans les listes publiques (botnet, serveur de commande…).`, key: `bad:${c.rip}`, data: { ip: c.rip } });
        ctx.emit('malveillant', { ip: c.rip, programme: c.prog });
        await ctx.call('garmr', 'bannir', { ip: c.rip, raison: 'adresse malveillante (Méduse)', source: 'Méduse', minutes: 1440 }).catch(() => undefined);
      } else if (BAD_PORTS[c.rport]) ctx.alert({ level: 'haute', title: `${c.prog} utilise le port ${c.rport}`, detail: `${BAD_PORTS[c.rport]} — vers ${c.rip}.`, key: `port:${c.prog}:${c.rport}` });
    }
    const keys = Object.keys(j); if (keys.length > 5000) for (const k of keys.sort((a, b) => j[a].last.localeCompare(j[b].last)).slice(0, keys.length - 5000)) delete j[k];
    writeFileSync(join(ctx.dir, 'journal.json'), JSON.stringify(j));
  } },
};
