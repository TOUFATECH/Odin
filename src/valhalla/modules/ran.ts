// Rán (appli) : les paquets réseau, lus en entier et décodés couche par couche (OSI), comme Wireshark.
// Carte interactive de qui parle à qui (machines du réseau et sites d'Internet, avec des flèches), liste des
// paquets, détail de chaque paquet (couches, champs, contenu brut) et explication en français par Odin.
// « Lis les paquets » (tout le réseau ou une machine), « Pause » : plus rien n'est lu.

import { isIP } from 'node:net';
import type { ModCtx, Module } from '../types.ts';
import { NETWORK, capture, clear, flows, history, isPaused, packet, setPaused, shutdown, startPump, state, stopRecording, type Packet } from '../ran.ts';

const s = (v: unknown) => String(v ?? '').trim();
const recorded = (ctx: ModCtx): string[] => ((ctx.settings.record as string[] | undefined) ?? []).filter((x) => isIP(x) || x === NETWORK);
const time = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = (t: number) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} Mo` : b >= 1e3 ? `${Math.round(b / 1e3)} ko` : `${b} o`);
const line = (p: Packet) => `${time(p.at)}  ${p.src}${p.sport != null ? `:${p.sport}` : ''} → ${p.dst}${p.dport != null ? `:${p.dport}` : ''}  ${p.app || p.proto}${p.site ? ` (${p.site})` : ''}  ${size(p.len)}  ${p.info}`;
/** Portée demandée : une adresse IP, sinon tout le réseau (« tout », « réseau », vide). */
const scopeOf = (i: Record<string, unknown>) => { const ip = s(i.ip ?? i.adresse); if (!ip || /^(tout|tous|réseau|reseau|toutes?)/i.test(ip)) return NETWORK; if (!isIP(ip)) throw new Error('donne l\'adresse IP de la machine (ex. 192.168.1.20), ou « tout le réseau »'); return ip; };
const label = (sc: string) => (sc === NETWORK ? 'tout le réseau' : sc);

/** Résumé lisible (pour la discussion et pour Odin) : qui parle à qui, applis, sites. */
export function summary(home: string, scope: string, sinceMin = 60): string {
  const ip = scope === NETWORK ? undefined : scope, since = Date.now() - sinceMin * 60e3;
  const h = history(home, ip, { limit: 12, since }), f = flows(home, ip, { since });
  if (!h.total) return `Aucun paquet lu pour ${label(scope)} ces ${sinceMin} dernières minutes. Dis « lis les paquets${ip ? ` de ${ip}` : ''} » pour commencer.`;
  const name = (x: string) => (f.names[x] ? `${x} (${f.names[x]})` : x);
  return [`📡 ${label(scope)}, ${sinceMin} dernières minutes : ${h.total} paquets, ${size(h.bytes)}.`,
    `**Qui parle à qui** :\n${f.flows.slice(0, 10).map((x) => `- ${name(x.src)} → ${name(x.dst)} : ${x.n} paquets, ${size(x.bytes)} (${x.apps.join(', ')})`).join('\n')}`,
    h.apps.length ? `**Applis** : ${h.apps.slice(0, 8).map((a) => `${a.app} (${a.n})`).join(', ')}` : '',
    h.sites.length ? `**Sites et noms** : ${h.sites.slice(0, 10).map((x) => `${x.site} (${x.n})`).join(', ')}` : '',
    `**Derniers paquets** :\n${h.packets.slice(0, 8).map((p) => `- ${line(p)}`).join('\n')}`].filter(Boolean).join('\n');
}

export const ran: Module = {
  id: 'ran', name: 'Rán', family: 'Sécurité',
  what: 'Les paquets réseau lus en entier et décodés couche par couche, comme Wireshark : la carte de qui parle à qui, chaque paquet en détail, et Odin qui explique.',
  does: ['lit tous les paquets (tout le réseau ou une machine) et les décode couche par couche : liaison, réseau, transport, chiffrement, application', 'reconnaît les applis et les sites : DNS, HTTP, HTTPS (nom du site), QUIC, DHCP, SSH, mDNS, UPnP, NTP…', 'carte interactive : machines et sites d\'Internet reliés par des flèches, de qui vers qui', 'détail de chaque paquet : tous les champs et le contenu brut (hexadécimal) ; le contenu chiffré reste illisible', 'pause et reprise de la lecture ; historique 7 jours ; Odin explique ce qui se passe'],
  from: ['Wireshark', 'tcpdump'], upstream: ['wireshark/wireshark', 'the-tcpdump-group/tcpdump'],
  words: ['paquet', 'paquets', 'wireshark', 'tcpdump', 'trafic', 'capture réseau', 'capturer', 'sniffer', 'qui parle', 'flux réseau', 'lis les paquets', 'lire les paquets'],
  actions: [
    { id: 'lire', label: 'Lire les paquets', what: 'Lit les paquets de tout le réseau (ou d\'une machine) et les garde dans l\'historique', quick: false, words: ['lis les paquets', 'lire les paquets', 'vas-y lis', 'reprends la lecture', 'capture le réseau'],
      params: [{ key: 'ip', label: 'Adresse IP (vide : tout le réseau)', kind: 'text', default: '' }],
      run: (ctx, i) => {
        const sc = scopeOf(i); if (isPaused()) { setPaused(ctx.home, false); ctx.saveSettings({ paused: false }); }
        const list = recorded(ctx); if (!list.includes(sc)) ctx.saveSettings({ record: [...list, sc] });
        const c = capture(ctx.home, sc, { recording: true, maxMs: 365 * 864e5 });
        if (c.error) return { ok: false, text: c.error };
        return { text: `📡 Je lis les paquets de ${label(sc)}. Points de capture : ${c.sources.map((x) => `${x.label}${x.machine ? ' (tout son trafic)' : ''}${x.error ? ` — ${x.error}` : ''}`).join(', ')}. Dis « pause » pour arrêter la lecture.` };
      } },
    { id: 'pause', label: 'Pause', what: 'Arrête toute lecture de paquets (l\'historique reste)', quick: true, words: ['pause', 'mets les paquets en pause', 'arrête la capture des paquets', 'stoppe la capture'],
      run: (ctx) => { setPaused(ctx.home, true); ctx.saveSettings({ paused: true }); return { text: '⏸ Pause : je ne lis plus aucun paquet. Dis « lis les paquets » pour reprendre.' }; } },
    { id: 'reprendre', label: 'Reprendre la lecture', what: 'Reprend la lecture des paquets après une pause', quick: true, words: ['reprends la lecture des paquets', 'reprendre la lecture des paquets', 'continue de lire les paquets'],
      run: (ctx) => { setPaused(ctx.home, false); ctx.saveSettings({ paused: false }); const r = recorded(ctx); for (const sc of r) capture(ctx.home, sc, { recording: true, maxMs: 365 * 864e5 }); return { text: `▶ Lecture reprise${r.length ? ` (${r.map(label).join(', ')})` : ''}.` }; } },
    { id: 'expliquer', label: 'Ce qui se passe', what: 'Résumé de qui parle à qui, applis et sites (tout le réseau ou une machine)', read: true, quick: false, words: ['que se passe-t-il sur le réseau', 'qui parle à qui', 'explique les paquets', 'résume le trafic'],
      params: [{ key: 'ip', label: 'Adresse IP (vide : tout le réseau)', kind: 'text', default: '' }, { key: 'minutes', label: 'Sur les dernières… (minutes)', kind: 'number', default: 60 }],
      run: (ctx, i) => ({ text: summary(ctx.home, scopeOf(i), Math.min(7 * 1440, Math.max(1, Number(i.minutes) || 60))) }) },
    { id: 'paquet', label: 'Détail d\'un paquet', what: 'Toutes les couches et le contenu d\'un paquet, par son numéro', read: true, quick: false,
      params: [{ key: 'id', label: 'Numéro du paquet', kind: 'number', required: true }],
      run: (ctx, i) => {
        const p = packet(ctx.home, Number(i.id)); if (!p) return { ok: false, text: 'Paquet introuvable (effacé ou trop ancien).' };
        return { text: `Paquet n° ${p.id} — ${day(p.at)}\n${p.story}\n${p.layers.map((l) => `**${l.osi}. ${l.title}**\n${l.fields.map((x) => `- ${x.k} : ${x.v}`).join('\n')}`).join('\n')}` };
      } },
    { id: 'retirer', label: 'Ne plus suivre en continu', what: 'Retire une machine (ou tout le réseau) de la lecture continue ; l\'historique reste', quick: false,
      params: [{ key: 'ip', label: 'Adresse IP (vide : tout le réseau)', kind: 'text', default: '' }],
      run: (ctx, i) => { const sc = scopeOf(i); ctx.saveSettings({ record: recorded(ctx).filter((x) => x !== sc) }); stopRecording(sc); return { text: `Lecture de ${label(sc)} arrêtée. L'historique reste 7 jours.` }; } },
    { id: 'effacer', label: 'Effacer l\'historique', what: 'Supprime les paquets gardés (tout le réseau ou une machine)', quick: false, grave: (i) => `effacer les paquets gardés de ${s(i.ip) || 'tout le réseau'}`,
      params: [{ key: 'ip', label: 'Adresse IP (vide : tout)', kind: 'text', default: '' }],
      run: (ctx, i) => { const sc = scopeOf(i); return { text: `${clear(ctx.home, sc === NETWORK ? undefined : sc)} paquet(s) effacé(s).` }; } },
  ],
  view(ctx) {
    const rec = recorded(ctx), h = history(ctx.home, undefined, { limit: 1, since: Date.now() - 3600e3 });
    return {
      subtitle: isPaused() ? '⏸ En pause : aucun paquet n\'est lu.' : rec.length ? `📡 Lecture en cours : ${rec.map(label).join(', ')}.` : 'Touche « Lire les paquets » : tout le réseau, ou tape l\'adresse d\'une machine.',
      kpis: [{ label: 'Paquets (1 h)', value: String(h.total), tone: h.total ? 'bon' : undefined }, { label: 'Volume (1 h)', value: size(h.bytes) }, { label: 'Lecture', value: isPaused() ? 'en pause' : rec.length ? 'en cours' : 'arrêtée', tone: isPaused() ? 'mauvais' : undefined }],
      sections: [
        { kind: 'list', title: 'Points de capture', empty: 'Aucune lecture en cours.',
          items: rec.flatMap((sc) => state(sc).sources.map((x) => ({ title: `${label(sc)} — ${x.label}`, detail: x.error ?? (x.machine ? 'tout le trafic de cette machine' : 'ce qui passe par la carte réseau d\'Odin'), meta: `${x.count} paquet(s)`, tone: x.error ? 'mauvais' as const : 'bon' as const }))) },
        { kind: 'text', title: 'Ce que Rán voit', text: 'Rán lit les paquets en entier et les décode couche par couche. Ce qui est chiffré (HTTPS, QUIC, SSH, VPN) reste illisible, comme dans Wireshark : on voit qui parle à qui, le nom du site (quand il passe en clair), le volume, pas le contenu. Pour tout voir d\'une machine, donne à Odin un accès à cette machine (Réglages → Droits et machines) : un hôte Proxmox montre tout le trafic de ses machines virtuelles, un routeur Linux celui de tout le réseau. Sinon, sur un réseau avec switch ou box, Odin ne voit que ses propres échanges et ce que les machines diffusent à tout le réseau.' },
      ],
    };
  },
  stop() { shutdown(); },
  start(ctx) {
    startPump(ctx.home);
    if (ctx.settings.paused) setPaused(ctx.home, true);
    for (const sc of recorded(ctx)) { try { capture(ctx.home, sc, { recording: true, maxMs: 365 * 864e5 }); } catch { /* adresse devenue invalide */ } }
  },
};
