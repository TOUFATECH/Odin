// Freyja — ton serveur multimédia (TOUFATECH/Venus) comme appli d'Odin. Nom : le vendredi est le
// jour de Vénus (latin) et de Freyja (nordique) : films, séries, chaînes,
// guide des programmes, enregistrements, écrans ouverts, ma liste, demandes de titres.
// Réutilise l'outil venus et son client (une seule implémentation, pas de doublon).
// Seules les chaînes et sources déjà autorisées dans Venus sont utilisées.

import { venusApi, venusConf, venusTool, type VenusConf } from '../../tools/venus.ts';
import type { ModCtx, Module } from '../types.ts';

interface Rec { id: number; channel: string; title: string; start: number; stop: number; status: string; error?: string }
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
      { id: 'etat', label: 'État', what: 'Serveur joignable, lecture en cours', read: true, run: async () => { const st = await venusApi<{ name?: string; version?: string; profile?: { name?: string }; elsewhere?: { title: string; device: string } | null }>(conf(), 'GET', '/api/status'); return { text: `${st.name ?? 'Venus'} ${st.version ?? ''} · profil ${st.profile?.name ?? '—'}${st.elsewhere ? ` · en lecture : ${st.elsewhere.title} sur ${st.elsewhere.device}` : ''}` }; } },
      { id: 'regarder', label: 'Regarder', what: 'Film, série ou chaîne (nom ou numéro) sur un écran', params: [{ key: 'quoi', label: 'Quoi', kind: 'text', required: true }, { key: 'ou', label: 'Écran (facultatif)', kind: 'text', default: '' }], words: ['mets', 'regarder', 'lance'], run: async (_c, i) => ({ text: await tool({ action: 'regarder', quoi: s(i.quoi), ou: s(i.ou) }) }) },
      { id: 'programme', label: 'Programme', what: 'Ce qui passe maintenant (filtre facultatif)', read: true, params: [{ key: 'quoi', label: 'Chaîne ou émission', kind: 'text', default: '' }], words: ['programme', 'qu est ce qui passe', 'ce soir'], run: async (_c, i) => ({ text: await tool({ action: 'programme', quoi: s(i.quoi) }) }) },
      { id: 'enregistrer', label: 'Enregistrer', what: 'Une émission du guide (24 h)', params: [{ key: 'quoi', label: 'Émission', kind: 'text', required: true }, { key: 'serie', label: 'Toutes les diffusions', kind: 'boolean', default: false }], words: ['enregistre'], run: async (_c, i) => ({ text: await tool({ action: 'enregistrer', quoi: s(i.quoi), serie: i.serie === true ? 'oui' : 'non' }) }) },
      { id: 'enregistrements', label: 'Enregistrements', what: 'Programmés, en cours, terminés', read: true, run: async () => { const l = await recordings(); return { text: l.slice(0, 30).map((r) => `- ${r.title} · ${r.channel} · ${hm(r.start)} · ${r.status}${r.error ? ` (${r.error})` : ''}`).join('\n') || 'Aucun enregistrement.' }; } },
      { id: 'ecrans', label: 'Écrans', what: 'Où Venus est ouvert', read: true, words: ['ecrans', 'écrans'], run: async () => ({ text: await tool({ action: 'ecrans' }) }) },
      { id: 'chercher', label: 'Chercher', what: 'Dans la bibliothèque', read: true, params: [{ key: 'quoi', label: 'Titre', kind: 'text', required: true }], words: ['cherche', 'trouve'], run: async (_c, i) => ({ text: await tool({ action: 'chercher', quoi: s(i.quoi) }) }) },
      { id: 'ma_liste', label: 'Ma liste', what: 'Titres gardés pour plus tard', read: true, run: async () => { const l = await venusApi<Array<{ title: string; year?: number; type: string }>>(conf(), 'GET', '/api/mylist'); return { text: l.slice(0, 40).map((x) => `- ${x.title}${x.year ? ` (${x.year})` : ''}`).join('\n') || 'Liste vide.' }; } },
      { id: 'demander', label: 'Demander un titre', what: 'Titre absent de la bibliothèque (via la demande de Venus)', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'type', label: 'Type', kind: 'select', options: ['film', 'série'], default: 'film' }], run: async (_c, i) => { const r = await venusApi<{ state?: string }>(conf(), 'POST', '/api/discover/request', { type: i.type === 'série' ? 'tv' : 'movie', title: s(i.titre) }); return { text: `📥 Demande envoyée : « ${s(i.titre)} »${r.state ? ` (${r.state})` : ''}.` }; } },
    ],
    async view() {
      if (!url() || !process.env.VENUS_API_KEY) return { subtitle: 'Venus n\'est pas relié.', sections: [{ kind: 'text', title: 'Relier Venus', text: 'Réglages → Maison → Venus : l\'adresse de ton serveur, et une clé API créée dans Venus (Serveur → Clés API), rangée dans le coffre (VENUS_API_KEY).' }] };
      const [recs, screens] = await Promise.all([recordings().catch(() => [] as Rec[]), venusApi<Array<{ name: string; tv: boolean; playing: boolean }>>(conf(), 'GET', '/api/devices/open').catch(() => [])]);
      const now = Date.now(), next = recs.filter((r) => r.stop > now).sort((a, b) => a.start - b.start), failed = recs.filter((r) => /erreur|error|échec|failed/i.test(r.status));
      return {
        subtitle: `${screens.length} écran(s) ouvert(s) · ${next.length} enregistrement(s) à venir`,
        kpis: [{ label: 'Écrans ouverts', value: String(screens.length) }, { label: 'En lecture', value: String(screens.filter((x) => x.playing).length) }, { label: 'Enregistrements échoués', value: String(failed.length), tone: failed.length ? 'mauvais' : 'bon' }],
        sections: [
          { kind: 'table', title: 'Écrans', columns: ['Écran', 'Type', 'État'], empty: 'Aucun écran n\'a Venus ouvert.', rows: screens.map((x) => ({ cells: [x.name, x.tv ? 'télé' : 'appareil', x.playing ? 'en lecture' : 'ouvert'], tone: x.playing ? 'bon' as const : undefined })) },
          { kind: 'table', title: 'Enregistrements', columns: ['Émission', 'Chaîne', 'Quand', 'État'], empty: 'Aucun enregistrement.', rows: [...next, ...failed].slice(0, 30).map((r) => ({ cells: [r.title, r.channel, hm(r.start), r.status], tone: /erreur|error|failed/i.test(r.status) ? 'mauvais' as const : undefined })) },
        ],
        side: [{ kind: 'form', title: 'Regarder', action: 'regarder', submit: 'Lancer', params: m.actions[1].params! }, { kind: 'form', title: 'Enregistrer', action: 'enregistrer', submit: 'Programmer', params: m.actions[3].params! }],
      };
    },
    watch: { every: 600, async run(ctx: ModCtx) {
      if (!url() || !process.env.VENUS_API_KEY) return;
      const recs = await recordings(), seen = new Set((ctx.settings.failedSeen as number[] | undefined) ?? []);
      for (const r of recs.filter((x) => /erreur|error|failed/i.test(x.status) && !seen.has(x.id))) { ctx.alert({ level: 'moyenne', title: `Enregistrement échoué : ${r.title}`, detail: `${r.channel} · ${hm(r.start)}${r.error ? ` · ${r.error}` : ''}`, key: `rec:${r.id}` }); seen.add(r.id); ctx.emit('enregistrement_echoue', { titre: r.title, chaîne: r.channel }); }
      ctx.saveSettings({ failedSeen: [...seen].slice(-500) });
    } },
  };
  return m;
}
