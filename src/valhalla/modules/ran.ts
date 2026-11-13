// Ariane (appli) : les paquets réseau, lus en entier et décodés couche par couche (OSI), comme Wireshark.
// Carte interactive de qui parle à qui (machines du réseau et sites d'Internet, avec des flèches), liste des
// paquets, détail de chaque paquet (couches, champs, contenu brut) et explication en français par Odin.
// « Lis les paquets » (tout le réseau ou une machine), « Pause » : plus rien n'est lu.
// Comme Sniffnet aussi : débit en direct (entrant / sortant), trafic par appareil, services, pays (table locale),
// alerte quand un appareil parle à un pays nouveau ou quand le débit dépasse ton seuil.

import { isIP } from 'node:net';
import type { ModCtx, Module } from '../types.ts';
import { NETWORK, capture, clear, devices, external, firstSeen, flows, history, isPaused, knownSince, packet, recentFirsts, setPaused, shutdown, startPump, state, stopRecording, throughput, type Packet } from '../ran.ts';
import { ATTRIBUTION, country, countryName, flag, hasTable, updateTable } from '../geoip.ts';

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

/** Le trafic comme Sniffnet : appareils, applis et services, pays, sur la dernière heure. Pur sur le magasin. */
export function traffic(home: string, sinceMin = 60) {
  const since = Date.now() - sinceMin * 60e3, ext = external(home, since), devs = devices(home, since);
  const svc = new Map<string, number>(), cty = new Map<string, number>();
  for (const e of ext) { svc.set(e.site || e.app, (svc.get(e.site || e.app) ?? 0) + e.bytes); const c = country(home, e.far); if (c) cty.set(c, (cty.get(c) ?? 0) + e.bytes); }
  const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { devs, services: top(svc), countries: top(cty), table: hasTable(home) };
}
const LEARN_MS = 24 * 3600e3;

export const ran: Module = {
  id: 'ran', name: 'Ariane', family: 'Sécurité',
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
    { id: 'trafic', label: 'Trafic par appareil', what: 'Comme Sniffnet : ce que chaque appareil envoie et reçoit, ses applis, ses pays, sur la dernière heure', read: true, words: ['trafic', 'bande passante', 'débit', 'qui consomme', 'quels pays'], run: (ctx) => {
      const t = traffic(ctx.home);
      if (!t.devs.length) return { text: 'Rien de lu cette dernière heure : « lis les paquets » pour commencer.' };
      return { text: [`📶 Dernière heure :`, ...t.devs.slice(0, 8).map((d) => `- ${d.name || d.ip} : ↑ ${size(d.sent)} · ↓ ${size(d.recv)} (${d.apps.join(', ')})`),
        t.services.length ? `**Services** : ${t.services.slice(0, 8).map(([k, v]) => `${k} (${size(v)})`).join(', ')}` : '',
        t.table ? (t.countries.length ? `**Pays** : ${t.countries.map(([c, v]) => `${flag(c)} ${countryName(c)} (${size(v)})`).join(', ')}` : '') : '_Pays : ajoute la table des pays (« mets à jour la table des pays »)._'].filter(Boolean).join('\n'), data: t };
    } },
    { id: 'table_pays', label: 'Mettre à jour la table des pays', what: 'Télécharge la table « adresse → pays » (DB-IP, gratuite, CC BY 4.0) ; aucune adresse de ton réseau n\'est envoyée', words: ['table des pays', 'pays des adresses'], run: async (ctx) => { const r = await updateTable(ctx.home, ctx.fetch); return { text: `🌍 Table des pays à jour (${r.month}, ${r.rows.toLocaleString('fr-FR')} plages). ${ATTRIBUTION}.` }; } },
    { id: 'seuil', label: 'Alerte de débit', what: 'Prévenir quand le réseau dépasse un débit (Mo/s) ; 0 pour ne plus prévenir', params: [{ key: 'mo_s', label: 'Débit (Mo/s)', kind: 'text', required: true }], words: ['alerte de débit', 'seuil de débit'], run: (ctx, i) => {
      const v = Number(s(i.mo_s).replace(',', '.')); if (!Number.isFinite(v) || v < 0 || v > 10_000) throw new Error('un débit en Mo/s, par exemple 5');
      ctx.saveSettings({ seuil: v }); return { text: v ? `🔔 Odin te prévient au-delà de ${v} Mo/s.` : '🔕 Plus d\'alerte de débit.' };
    } },
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
      refreshMs: rec.length && !isPaused() ? 5000 : undefined,
      sections: [
        ...(() => {
          const now = Date.now(), b = 10_000, tp = throughput(ctx.home, { since: now - 10 * 60e3, bucketMs: b, until: now }), t = traffic(ctx.home), firsts = recentFirsts(ctx.home, now - 24 * 3600e3);
          const mos = (x: number) => x / 1e6 / (b / 1000);
          return [
            { kind: 'courbe' as const, title: 'Débit en direct (10 min)', unit: 'Mo/s', empty: 'Pas encore de trafic lu : « Lire les paquets ».', labels: tp.map((x) => new Date(x.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })),
              series: [{ name: '↓ Entrant', tone: 'bon' as const, points: tp.map((x) => mos(x.entrant)) }, { name: '↑ Sortant', tone: 'attention' as const, points: tp.map((x) => mos(x.sortant)) }, { name: 'Dans la maison', tone: 'neutre' as const, points: tp.map((x) => mos(x.local)) }] },
            { kind: 'table' as const, title: 'Appareils (1 h)', columns: ['Appareil', 'Envoyé', 'Reçu', 'Applis', 'Pays'], empty: 'Aucun appareil vu cette dernière heure.',
              rows: t.devs.slice(0, 25).map((d) => ({ cells: [d.name ? `${d.name} (${d.ip})` : d.ip, size(d.sent), size(d.recv), d.apps.join(', '), [...new Set(d.peers.map(([ip]) => country(ctx.home, ip)).filter(Boolean) as string[])].slice(0, 5).map(flag).join(' ')] })) },
            { kind: 'bars' as const, title: 'Services et sites (1 h)', items: t.services.map(([k, v]) => ({ label: k, value: v, display: size(v) })) },
            ...(t.table ? [{ kind: 'bars' as const, title: 'Pays (1 h)', items: t.countries.map(([c, v]) => ({ label: `${flag(c)} ${countryName(c)}`, value: v, display: size(v) })) }]
              : [{ kind: 'text' as const, title: 'Pays', text: 'Pour voir les pays, ajoute la table « adresse → pays » (gratuite, gardée chez toi) : action « Mettre à jour la table des pays ».' }]),
            { kind: 'list' as const, title: 'Premières fois (24 h)', empty: 'Rien de nouveau : Odin apprend les habitudes de chaque appareil pendant 24 h, puis te prévient d\'un nouveau pays.', items: firsts.filter((f) => f.kind === 'pays').map((f) => ({ title: `${f.dev} → ${flag(f.val)} ${countryName(f.val)}`, detail: 'premier échange avec ce pays', meta: day(f.first), tone: 'attention' as const })) },
          ];
        })(),
        { kind: 'list', title: 'Points de capture', empty: 'Aucune lecture en cours.',
          items: rec.flatMap((sc) => state(sc).sources.map((x) => ({ title: `${label(sc)} — ${x.label}`, detail: x.error ?? (x.machine ? 'tout le trafic de cette machine' : 'ce qui passe par la carte réseau d\'Odin'), meta: `${x.count} paquet(s)`, tone: x.error ? 'mauvais' as const : 'bon' as const }))) },
        { kind: 'text', title: 'Ce que Ariane voit', text: 'Ariane lit les paquets en entier et les décode couche par couche. Ce qui est chiffré (HTTPS, QUIC, SSH, VPN) reste illisible, comme dans Wireshark : on voit qui parle à qui, le nom du site (quand il passe en clair), le volume, pas le contenu. Pour tout voir d\'une machine, donne à Odin un accès à cette machine (Réglages → Droits et machines) : un hôte Proxmox montre tout le trafic de ses machines virtuelles, un routeur Linux celui de tout le réseau. Sinon, sur un réseau avec switch ou box, Odin ne voit que ses propres échanges et ce que les machines diffusent à tout le réseau.' },
      ],
    };
  },
  // Comme les notifications de Sniffnet : un appareil qui parle à un pays nouveau (après 24 h d'apprentissage), un débit trop fort.
  watch: { every: 60, run(ctx) {
    const since = Number(ctx.settings.vuJusque ?? Date.now() - 60e3), now = Date.now();
    for (const e of external(ctx.home, since)) {
      const c = country(ctx.home, e.far); if (!c) continue;
      const learning = (knownSince(ctx.home, e.dev) ?? now) > now - LEARN_MS;
      if (firstSeen(ctx.home, e.dev, 'pays', c, now) && !learning) ctx.alert({ level: 'moyenne', title: `${e.dev} parle pour la première fois avec ${flag(c)} ${countryName(c)}`, detail: `${e.site || e.far} · ${e.app} · ${size(e.bytes)}`, key: `pays:${e.dev}:${c}` });
      firstSeen(ctx.home, e.dev, 'service', e.site || e.app, now);
    }
    const lim = Number(ctx.settings.seuil ?? 0);
    if (lim > 0) { const tp = throughput(ctx.home, { since: now - 60e3, bucketMs: 60e3, until: now })[0]; const v = (tp.entrant + tp.sortant) / 1e6 / 60; if (v > lim) ctx.alert({ level: 'moyenne', title: `Débit élevé : ${v.toFixed(1)} Mo/s`, detail: `au-delà de ton seuil de ${lim} Mo/s`, key: 'seuil' }); }
    ctx.saveSettings({ vuJusque: now });
  } },
  stop() { shutdown(); },
  start(ctx) {
    startPump(ctx.home);
    if (ctx.settings.paused) setPaused(ctx.home, true);
    for (const sc of recorded(ctx)) { try { capture(ctx.home, sc, { recording: true, maxMs: 365 * 864e5 }); } catch { /* adresse devenue invalide */ } }
  },
};
