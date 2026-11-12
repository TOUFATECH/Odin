// Rán (appli) : les paquets réseau de tes machines, comme Wireshark. Tu donnes une adresse IP (ou tu touches une
// machine sur la carte) : Rán montre les paquets en direct et garde l'historique (7 jours). Enregistrement
// continu possible pour les machines à surveiller. Seuls les en-têtes sont lus, jamais le contenu.

import { isIP } from 'node:net';
import type { ModCtx, Module } from '../types.ts';
import { capture, clear, history, machineFor, serviceOf, startPump, state, stopRecording, type Packet } from '../ran.ts';

const s = (v: unknown) => String(v ?? '').trim();
const recorded = (ctx: ModCtx): string[] => ((ctx.settings.record as string[] | undefined) ?? []).filter((x) => isIP(x));
const time = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = (t: number) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1).replace('.', ',')} Mo` : b >= 1e3 ? `${Math.round(b / 1e3)} ko` : `${b} o`);
const row = (p: Packet) => [time(p.at), p.dir === 'entrant' ? '→ reçu' : p.dir === 'sortant' ? '← envoyé' : '·', p.proto, `${p.src}${p.sport != null ? `:${p.sport}` : ''}`, `${p.dst}${p.dport != null ? `:${p.dport}` : ''}`, size(p.len), p.info];
const ipOf = (i: Record<string, unknown>) => { const ip = s(i.ip ?? i.adresse); if (!isIP(ip)) throw new Error('donne l\'adresse IP de la machine (ex. 192.168.1.20)'); return ip; };

/** Capture de quelques secondes (sans écran : depuis la discussion, une automatisation, la bulle d'Odin). */
function snapshot(ctx: ModCtx, ip: string, seconds: number): Promise<{ list: Packet[]; where: string; error?: string }> {
  return new Promise((resolve) => {
    const got: Packet[] = []; let err: string | undefined;
    const c = capture(ctx.home, ip, { onPackets: (p) => got.push(...p), onStatus: (x) => { err = x; }, maxMs: seconds * 1000 + 5000 });
    if (c.error) { c.stop(); resolve({ list: [], where: c.where, error: c.error }); return; }
    setTimeout(() => { c.stop(); resolve({ list: got, where: c.where === 'machine' ? `sur ${c.machine}` : 'depuis la machine d\'Odin', error: err }); }, seconds * 1000 + 700);
  });
}

export const ran: Module = {
  id: 'ran', name: 'Rán', family: 'Sécurité',
  what: 'Les paquets réseau d\'une machine, comme Wireshark : en direct et en historique, à partir de son adresse IP.',
  does: ['montre en direct les paquets qui entrent et sortent d\'une machine (protocole, de qui, vers qui, taille, service)', 'garde l\'historique 7 jours, avec recherche et les correspondants les plus fréquents', 'sur une machine où Odin a accès (SSH), capture tout son trafic ; sinon depuis la machine d\'Odin', 'enregistrement continu des machines que tu choisis', 'ne lit que les en-têtes, jamais le contenu des paquets'],
  from: ['Wireshark', 'tcpdump'], upstream: ['wireshark/wireshark', 'the-tcpdump-group/tcpdump'],
  words: ['paquet', 'paquets', 'wireshark', 'tcpdump', 'trafic', 'capture réseau', 'capturer', 'sniffer', 'qui parle', 'flux réseau'],
  actions: [
    { id: 'capturer', label: 'Capturer', what: 'Paquets d\'une machine pendant quelques secondes', read: true, quick: false, external: true, words: ['capture', 'capturer', 'paquets de', 'trafic de'],
      params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', required: true }, { key: 'secondes', label: 'Durée (secondes)', kind: 'number', default: 10 }],
      run: async (ctx, i) => {
        const ip = ipOf(i), sec = Math.min(60, Math.max(2, Number(i.secondes) || 10));
        const r = await snapshot(ctx, ip, sec);
        if (r.error && !r.list.length) return { ok: false, text: r.error };
        const by = new Map<string, number>(); for (const p of r.list) by.set(p.info || p.proto, (by.get(p.info || p.proto) ?? 0) + 1);
        const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} : ${n}`).join(' · ');
        return { text: `📡 ${ip}, ${sec} s ${r.where} : ${r.list.length} paquet(s)${top ? `\n${top}` : ''}\n${r.list.slice(-15).map((p) => `- ${row(p).join('  ')}`).join('\n')}`, data: { count: r.list.length } };
      } },
    { id: 'historique', label: 'Historique', what: 'Derniers paquets gardés pour une machine', read: true, quick: false, words: ['historique des paquets', 'derniers paquets'],
      params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', required: true }, { key: 'filtre', label: 'Filtre (protocole, port, adresse, service)', kind: 'text', default: '' }],
      run: (ctx, i) => {
        const ip = ipOf(i), h = history(ctx.home, ip, { limit: 30, q: s(i.filtre) });
        if (!h.total) return { text: `Aucun paquet gardé pour ${ip}. Lance « En direct » sur sa fiche, ou l'enregistrement continu.` };
        return { text: `${h.total} paquet(s) pour ${ip} (du ${day(h.first!)} au ${day(h.last!)}).\nCorrespondants : ${h.peers.slice(0, 5).map((p) => `${p.host} (${p.n})`).join(', ')}\nServices : ${h.protos.slice(0, 6).map((p) => `${p.proto} (${p.n})`).join(', ')}\n${h.packets.slice(0, 15).map((p) => `- ${row(p).join('  ')}`).join('\n')}` };
      } },
    { id: 'enregistrer', label: 'Enregistrer en continu', what: 'Garde tous les paquets d\'une machine dans l\'historique, en permanence', quick: false, undo: (i) => ({ action: 'arreter', input: { ip: i.ip }, label: 'enregistrement arrêté' }),
      params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', required: true }],
      run: (ctx, i) => {
        const ip = ipOf(i); const list = recorded(ctx); if (!list.includes(ip)) ctx.saveSettings({ record: [...list, ip] });
        const c = capture(ctx.home, ip, { recording: true, maxMs: 365 * 864e5 });
        return { ok: !c.error, text: c.error ?? `Enregistrement continu de ${ip} ${c.where === 'machine' ? `(sur ${c.machine}, tout son trafic)` : '(depuis la machine d\'Odin)'} : l'historique se remplit.` };
      } },
    { id: 'arreter', label: 'Arrêter l\'enregistrement', what: 'Arrête l\'enregistrement continu d\'une machine (l\'historique reste)', quick: false,
      params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', required: true }],
      run: (ctx, i) => { const ip = ipOf(i); ctx.saveSettings({ record: recorded(ctx).filter((x) => x !== ip) }); stopRecording(ip); return { text: `Enregistrement de ${ip} arrêté. Son historique reste 7 jours.` }; } },
    { id: 'effacer', label: 'Effacer l\'historique', what: 'Supprime les paquets gardés d\'une machine', quick: false, grave: (i) => `effacer l'historique des paquets de ${s(i.ip)}`,
      params: [{ key: 'ip', label: 'Adresse IP', kind: 'text', required: true }],
      run: (ctx, i) => { const ip = ipOf(i); return { text: `${clear(ctx.home, ip)} paquet(s) effacé(s) pour ${ip}.` }; } },
  ],
  view(ctx) {
    const rec = recorded(ctx);
    return {
      subtitle: 'Donne l\'adresse IP d\'une machine, ou touche-la sur la carte de la Maison : ses paquets en direct et en historique.',
      kpis: [{ label: 'Enregistrées en continu', value: String(rec.length) }, { label: 'Historique gardé', value: '7 jours' }],
      sections: [
        { kind: 'list', title: 'Enregistrement continu', empty: 'Aucune machine enregistrée en continu. Sur la fiche d\'une machine : « Enregistrer en continu ».',
          items: rec.map((ip) => { const st = state(ip), h = history(ctx.home, ip, { limit: 1 }); return { title: ip, detail: st.error ?? (st.where === 'machine' ? `sur ${st.machine} : tout son trafic` : 'depuis la machine d\'Odin'), meta: `${h.total} paquet(s) gardé(s)`, tone: st.error ? 'mauvais' : 'bon' }; }) },
        { kind: 'text', title: 'Ce que Rán voit', text: 'Sur une machine où Odin a un accès (Réglages → Droits et machines), la capture se fait sur la machine elle-même : tout son trafic. Sinon elle se fait depuis la machine d\'Odin : sur un réseau avec switch ou box, Odin ne voit alors que ce que cette machine échange avec lui et ce qu\'elle diffuse à tout le réseau (sauf si Odin est le routeur ou reçoit une copie du trafic). Rán lit seulement les en-têtes : qui parle à qui, le protocole, la taille — jamais le contenu.' },
      ],
    };
  },
  start(ctx) {
    startPump(ctx.home);
    // Les enregistrements continus reprennent au démarrage d'Odin
    for (const ip of recorded(ctx)) { try { capture(ctx.home, ip, { recording: true, maxMs: 365 * 864e5 }); } catch { /* adresse devenue invalide */ } }
  },
};
export { machineFor, serviceOf };
