// Freyja — ton serveur multimédia (TOUFATECH/Venus) comme appli d'Odin. Nom : le vendredi est le
// jour de Vénus (latin) et de Freyja (nordique) : films, séries, chaînes,
// guide des programmes, enregistrements, écrans ouverts, ma liste, demandes de titres.
// Réutilise l'outil venus et son client (une seule implémentation, pas de doublon).
// Seules les chaînes et sources déjà autorisées dans Venus sont utilisées.

import { bestMatch, venusApi, venusConf, venusTool, type VCard, type VenusConf } from '../../tools/venus.ts';
import type { ModCtx, Module } from '../types.ts';

interface Rec { id: number; channel: string; title: string; start: number; stop: number; status: string; error?: string }
/** États d'un enregistrement dans Venus → mots simples. */
export const REC: Record<string, string> = { scheduled: 'programmé', recording: 'en cours', done: 'terminé', failed: 'échoué', cancelled: 'annulé' };
const failedRec = (r: Rec) => r.status === 'failed' || /erreur|error/i.test(r.status);
/** « 20:30 » aujourd'hui (ou demain si l'heure est passée) ; vide = maintenant. */
export function startAt(hhmm: string, now = new Date()): number {
  const m = /^(\d{1,2})[:h](\d{2})?$/.exec(hhmm.trim()); if (!m) return now.getTime();
  const d = new Date(now); d.setHours(Number(m[1]), Number(m[2] ?? 0), 0, 0);
  if (d.getTime() < now.getTime() - 60_000) d.setDate(d.getDate() + 1);
  return d.getTime();
}
const s = (v: unknown) => String(v ?? '');
const hm = (t: number) => new Date(t).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function venus(url: () => string): Module {
  const conf = (): VenusConf => venusConf({ venus: { url: url() } });
  const tool = (input: Record<string, unknown>) => venusTool.run(input, { venus: { url: url() } } as never).then((r) => (typeof r === "string" ? r : r.output));
  const recordings = async (): Promise<Rec[]> => (await venusApi<{ recordings: Rec[] }>(conf(), 'GET', '/api/recordings')).recordings ?? [];
  const m: Module = {
    id: 'freyja', name: 'Freyja', family: 'Maison',
    what: 'Ton serveur multimédia : films, séries, chaînes, programmes, enregistrements, sur tous tes écrans.',
    does: ['lance un film, une série ou une chaîne sur l\'écran choisi (« mets One Piece sur la télé du salon »)', 'guide des programmes : ce qui passe maintenant et ce soir', 'enregistre une émission ou toutes ses diffusions', 'liste les écrans où Venus est ouvert', 'recherche dans toute la bibliothèque', 'ma liste et demandes de nouveaux titres', 'alerte si un enregistrement échoue'],
    from: ['Venus (TOUFATECH)', 'Jellyfin', 'Plex'], upstream: ['TOUFATECH/Venus'],
    modes: ['Fólkvangr · télé en direct', 'Sessrúmnir · bibliothèque'],
    words: ['venus', 'vénus', 'freyja', 'film', 'films', 'serie', 'série', 'series', 'chaine', 'chaîne', 'tele', 'télé', 'television', 'programme tv', 'ce soir a la tele', 'enregistre', 'enregistrement', 'anime', 'regarder'],
    actions: [
      { id: 'etat', label: 'État', what: 'Serveur joignable, lecture en cours', read: true, run: async () => { const st = await venusApi<{ name?: string; version?: string; authenticated?: boolean; profile?: { name?: string }; elsewhere?: { title: string; device: string } | null }>(conf(), 'GET', '/api/status'); if (st.authenticated === false) throw new Error('Venus refuse la clé API : crées-en une dans Venus → Serveur → Clés API, puis range-la dans le coffre (VENUS_API_KEY)'); return { text: `${st.name ?? 'Venus'} ${st.version ?? ''} · profil ${st.profile?.name ?? '—'}${st.elsewhere ? ` · en lecture : ${st.elsewhere.title} sur ${st.elsewhere.device}` : ''}` }; } },
      { id: 'regarder', label: 'Regarder', what: 'Film, série ou chaîne (nom ou numéro) sur un écran', params: [{ key: 'quoi', label: 'Quoi', kind: 'text', required: true }, { key: 'ou', label: 'Écran (facultatif)', kind: 'text', default: '' }], words: ['mets', 'regarder', 'lance'], run: async (_c, i) => ({ text: await tool({ action: 'regarder', quoi: s(i.quoi), ou: s(i.ou) }) }) },
      { id: 'programme', label: 'Programme', what: 'Ce qui passe maintenant (filtre facultatif)', read: true, params: [{ key: 'quoi', label: 'Chaîne ou émission', kind: 'text', default: '' }], words: ['programme', 'qu est ce qui passe', 'ce soir a la tele', 'programme tv'], run: async (_c, i) => ({ text: await tool({ action: 'programme', quoi: s(i.quoi) }) }) },
      { id: 'enregistrer', undo: (i) => ({ action: 'annuler_enregistrement', input: { titre: i.quoi }, label: 'enregistrement annulé' }), label: 'Enregistrer', what: 'Une émission du guide (24 h)', params: [{ key: 'quoi', label: 'Émission', kind: 'text', required: true }, { key: 'serie', label: 'Toutes les diffusions', kind: 'boolean', default: false }], words: ['enregistre'], run: async (_c, i) => ({ text: await tool({ action: 'enregistrer', quoi: s(i.quoi), serie: i.serie === true ? 'oui' : 'non' }) }) },
      { id: 'enregistrer_plage', label: 'Enregistrer une chaîne', what: 'Une chaîne, à une heure, pendant une durée (sans passer par le guide)', params: [{ key: 'chaine', label: 'Chaîne (nom ou numéro)', kind: 'text', required: true }, { key: 'debut', label: 'Début (HH:MM, vide = maintenant)', kind: 'text', default: '' }, { key: 'minutes', label: 'Durée (minutes)', kind: 'number', default: 60 }, { key: 'titre', label: 'Titre', kind: 'text', default: '' }], run: async (ctx, i) => {
        const chans = await venusApi<VCard[]>(conf(), 'GET', '/api/library?type=channel'), ch = bestMatch(chans, s(i.chaine));
        if (!ch) throw new Error(`chaîne introuvable : ${s(i.chaine)}`);
        const start = startAt(s(i.debut), ctx.now()), minutes = Math.min(720, Math.max(1, Number(i.minutes) || 60));
        await venusApi(conf(), 'POST', '/api/recordings', { channelId: ch.id, title: s(i.titre) || ch.title, start, stop: start + minutes * 60_000 });
        return { text: `⏺ Enregistrement programmé : ${ch.title}, ${hm(start)}, ${minutes} min.` };
      } },
      { id: 'enregistrements', label: 'Enregistrements', what: 'Programmés, en cours, terminés', read: true, run: async () => { const l = await recordings(); return { text: l.slice(0, 30).map((r) => `- ${r.title} · ${r.channel} · ${hm(r.start)} · ${REC[r.status] ?? r.status}${r.error ? ` (${r.error})` : ''}`).join('\n') || 'Aucun enregistrement.', data: l }; } },
      { id: 'annuler_enregistrement', label: 'Annuler un enregistrement', what: 'Annule un enregistrement programmé ou en cours', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }], run: async (_c, i) => { const r = (await recordings()).find((x) => ['scheduled', 'recording'].includes(x.status) && x.title.toLowerCase().includes(s(i.titre).toLowerCase())); if (!r) throw new Error('aucun enregistrement programmé avec ce titre'); await venusApi(conf(), 'DELETE', `/api/recordings/${r.id}`); return { text: `✗ Enregistrement annulé : ${r.title}.` }; } },
      { id: 'ecrans', label: 'Écrans', what: 'Où Venus est ouvert', read: true, words: ['ecrans', 'écrans'], run: async () => ({ text: await tool({ action: 'ecrans' }) }) },
      { id: 'chercher', label: 'Chercher', what: 'Dans la bibliothèque', read: true, params: [{ key: 'quoi', label: 'Titre', kind: 'text', required: true }], words: ['cherche', 'trouve'], run: async (_c, i) => ({ text: await tool({ action: 'chercher', quoi: s(i.quoi) }) }) },
      { id: 'ma_liste', label: 'Ma liste', what: 'Titres gardés pour plus tard', read: true, run: async () => { const l = await venusApi<Array<{ title: string; year?: number; type: string }>>(conf(), 'GET', '/api/mylist'); return { text: l.slice(0, 40).map((x) => `- ${x.title}${x.year ? ` (${x.year})` : ''}`).join('\n') || 'Liste vide.' }; } },
      { id: 'demander', label: 'Demander un titre', what: 'Titre absent de la bibliothèque (via la demande de Venus)', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'type', label: 'Type', kind: 'select', options: ['film', 'série'], default: 'film' }], run: async (_c, i) => { const r = await venusApi<{ state?: string }>(conf(), 'POST', '/api/discover/request', { type: i.type === 'série' ? 'tv' : 'movie', title: s(i.titre) }); return { text: `📥 Demande envoyée : « ${s(i.titre)} »${r.state ? ` (${r.state})` : ''}.` }; } },
    ],
    async view() {
      if (!url() || !process.env.VENUS_API_KEY) return { subtitle: 'Venus n\'est pas relié.', sections: [{ kind: 'text', title: 'Relier Venus', text: 'Réglages → Maison → Venus : l\'adresse de ton serveur, et une clé API créée dans Venus (Serveur → Clés API), rangée dans le coffre (VENUS_API_KEY).' }] };
      const [recs, screens] = await Promise.all([recordings().catch(() => [] as Rec[]), venusApi<Array<{ name: string; tv: boolean; playing: boolean }>>(conf(), 'GET', '/api/devices/open').catch(() => [])]);
      const next = recs.filter((r) => ['scheduled', 'recording'].includes(r.status)).sort((a, b) => a.start - b.start), failed = recs.filter(failedRec);
      return {
        subtitle: `${screens.length} écran(s) ouvert(s) · ${next.length} enregistrement(s) à venir`,
        kpis: [{ label: 'Écrans ouverts', value: String(screens.length) }, { label: 'En lecture', value: String(screens.filter((x) => x.playing).length) }, { label: 'Enregistrements échoués', value: String(failed.length), tone: failed.length ? 'mauvais' : 'bon' }],
        sections: [
          { kind: 'table', title: 'Écrans', columns: ['Écran', 'Type', 'État'], empty: 'Aucun écran n\'a Venus ouvert.', rows: screens.map((x) => ({ cells: [x.name, x.tv ? 'télé' : 'appareil', x.playing ? 'en lecture' : 'ouvert'], tone: x.playing ? 'bon' as const : undefined })) },
          { kind: 'table', title: 'Enregistrements', columns: ['Émission', 'Chaîne', 'Quand', 'État'], empty: 'Aucun enregistrement.', rows: [...next, ...failed].slice(0, 30).map((r) => ({ cells: [r.title, r.channel, hm(r.start), `${REC[r.status] ?? r.status}${r.error ? ` : ${r.error.slice(0, 80)}` : ''}`], tone: failedRec(r) ? 'mauvais' as const : r.status === 'recording' ? 'bon' as const : undefined, actions: failedRec(r) ? [] : [{ action: 'annuler_enregistrement', label: 'Annuler', input: { titre: r.title } }] })) },
        ],
        side: [{ kind: 'form', title: 'Regarder', action: 'regarder', submit: 'Lancer', params: m.actions.find((a) => a.id === 'regarder')?.params ?? [] }, { kind: 'form', title: 'Enregistrer', action: 'enregistrer', submit: 'Programmer', params: m.actions.find((a) => a.id === 'enregistrer')?.params ?? [] }],
      };
    },
    watch: { every: 600, async run(ctx: ModCtx) {
      if (!url() || !process.env.VENUS_API_KEY) return;
      const recs = await recordings(), seen = new Set((ctx.settings.failedSeen as number[] | undefined) ?? []);
      for (const r of recs.filter((x) => failedRec(x) && !seen.has(x.id))) { ctx.alert({ level: 'moyenne', title: `Enregistrement échoué : ${r.title}`, detail: `${r.channel} · ${hm(r.start)}${r.error ? ` · ${r.error}` : ''}`, key: `rec:${r.id}` }); seen.add(r.id); ctx.emit('enregistrement_echoue', { titre: r.title, chaîne: r.channel }); }
      ctx.saveSettings({ failedSeen: [...seen].slice(-500) });
    } },
  };
  return m;
}
