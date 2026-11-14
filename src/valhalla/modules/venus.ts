// Vénus — ton serveur multimédia (TOUFATECH/Venus) comme appli d'Odin. Nom : le vendredi est le
// jour de Vénus (latin) et de Vénus (nordique) : films, séries, chaînes,
// guide des programmes, enregistrements, écrans ouverts, ma liste, demandes de titres.
// Réutilise l'outil venus et son client (une seule implémentation, pas de doublon).
// Seules les chaînes et sources déjà autorisées dans Venus sont utilisées.

import { bestMatch, venusApi, venusConf, venusTool, type VCard, type VenusConf } from '../../tools/venus.ts';
import type { ModCtx, Module } from '../types.ts';
import { actionRestaurer, carteSauvegarde } from '../sso/persona.ts';

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
export interface VHealth { ok?: boolean; name?: string; version?: string; uptime?: number; scanning?: boolean; playing?: number; disk?: { free: number; total: number } | null }
/** /api/health de Venus → une phrase : en marche depuis, lectures, analyse, disque (alerte sous 10 % libres). */
export function santeText(h: VHealth): string {
  const go = (b: number) => `${(b / 1e9).toFixed(b > 1e11 ? 0 : 1)} Go`, j = h.uptime ? Math.floor(h.uptime / 86400) : 0;
  const disk = h.disk ? ` · disque : ${go(h.disk.free)} libres sur ${go(h.disk.total)}${h.disk.free / h.disk.total < 0.1 ? ' ⚠️ presque plein' : ''}` : '';
  return `✅ ${h.name ?? 'Venus'}${h.version ? ` ${h.version}` : ''} en marche${h.uptime ? ` depuis ${j ? `${j} j` : `${Math.round(h.uptime / 3600)} h`}` : ''} · ${h.playing ?? 0} lecture(s)${h.scanning ? ' · analyse de la bibliothèque en cours' : ''}${disk}`;
}
/** Une source de Delta (sans sa clé). */
export interface BygulSource { id: number; name: string; enabled: boolean; priority: number; health: string; fails: number; last_error?: string | null; queries: number; grabs: number; avgMs: number | null; paused_until?: number | null }
/** Delta en clair (pur) : santé, priorité, chiffres. */
export function bygulText(l: BygulSource[]): string {
  if (!l.length) return 'Aucune source dans Delta : ajoute un indexeur autorisé (« ajoute une source »).';
  const ic: Record<string, string> = { bonne: '🟢', fragile: '🟠', 'en pause': '⏸', coupée: '⚪', 'pas encore essayée': '⚪' };
  return l.map((x) => `${ic[x.health] ?? '•'} n° ${x.id} ${x.name} · priorité ${x.priority} · ${x.health}${x.health === 'en pause' && x.paused_until ? ` jusqu'à ${new Date(x.paused_until).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''} · ${x.queries} recherche(s), ${x.grabs} téléchargement(s)${x.avgMs !== null ? `, ${x.avgMs} ms` : ''}${x.last_error && x.health !== 'bonne' ? ` · ${x.last_error}` : ''}`).join('\n');
}
const kindOf = (t: string) => (/épisode|episode/i.test(t) ? 'episode' : /album/i.test(t) ? 'album' : /audio/i.test(t) ? 'audiobook' : /livre/i.test(t) ? 'book' : 'movie');
interface BygulHit { title: string; link: string; size: number; seeders?: number; indexer: string; sourceId?: number; ok: boolean; score: number | null; why: string | null }
/** L'état des médias automatiques de Venus (GET /api/admin/acquire). */
export interface MediaWant { id: number; kind: string; title: string; season: number; episode: number; status: string; progress: number; note?: string | null; file?: string | null }
export interface MediaState { on: boolean; client: { type: string } | null; sources: Array<{ id: number; name: string; kind: string; enabled: boolean }>; wants: MediaWant[]; log: Array<{ at: number; text: string; title?: string }> }
const ST: Record<string, string> = { attente: 'en attente', pas_trouve: 'pas encore trouvé', pas_sorti: 'pas encore sorti', telechargement: 'en téléchargement', range: 'rangé', erreur: 'erreur' };
/** Le résumé en une phrase et une liste (pur). */
export function mediasText(d: MediaState): string {
  if (!d.on) return 'Médias automatiques coupés dans Venus (dis « règle les médias automatiques »).';
  const by = (st: string) => d.wants.filter((w) => w.status === st);
  const dl = by('telechargement'), lab = (w: MediaWant) => (w.kind === 'episode' ? `${w.title} S${String(w.season).padStart(2, '0')}E${String(w.episode).padStart(2, '0')}` : w.title);
  return [`${d.sources.length} source(s) · moteur ${d.client?.type && d.client.type !== 'venus' ? d.client.type : 'Comète'} · ${dl.length} en téléchargement · ${by('attente').length + by('pas_trouve').length} à trouver · ${by('range').length} rangé(s)${by('erreur').length ? ` · ⚠ ${by('erreur').length} en erreur` : ''}`,
    ...dl.slice(0, 10).map((w) => `- ⬇ ${lab(w)} : ${w.progress} %`), ...by('erreur').slice(0, 5).map((w) => `- ⚠ ${lab(w)} : ${w.note ?? 'erreur'}`),
    ...(d.sources.length ? [] : ['Aucune source : ajoute un indexeur autorisé (« ajoute une source »).'])].join('\n');
}
const s = (v: unknown) => String(v ?? '');

/** Les filtres par catégorie appliqués par Venus (GET /api/admin/acquire → filtres). */
export interface MediaFilter { label: string; reglee?: boolean; min?: number; max?: number; cible?: number; langues?: Record<string, number>; seuil?: number; hevc?: number; maxGo?: number; formats?: string[]; langue?: string; ancienAvant?: number }
export const CATS = ['films', 'animation', 'series', 'animes', 'musique', 'livres', 'livres_audio'] as const;
const catOf = (v: string) => { const x = v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''); return ({ film: 'films', films_d_animation: 'animation', film_d_animation: 'animation', serie: 'series', anime: 'animes', livre: 'livres', livres_audios: 'livres_audio', livre_audio: 'livres_audio', audio: 'livres_audio', books: 'livres', audiobooks: 'livres_audio' } as Record<string, string>)[x] ?? x; };
const langWord = (f: MediaFilter, k: string) => { const v = f.langues?.[k]; if (v === undefined) return '?'; return v <= (f.seuil ?? -200) ? 'refusée' : v >= 80 ? `oui (+${v})` : v >= 0 ? `acceptée (${v})` : `en attendant mieux (${v})`; };
/** Les filtres en texte, une ligne par catégorie (pur). */
export function filtresText(f: Record<string, MediaFilter>): string {
  return CATS.filter((c) => f[c]).map((c) => {
    const x = f[c], mark = x.reglee ? ' ✎' : '';
    if (x.langues) return `${x.label}${mark} : ${x.min}p → ${x.max}p, visé ${x.cible}p · MULTI ${langWord(x, 'multi')} · VF ${langWord(x, 'vf')} · VOSTFR ${langWord(x, 'vostfr')} · anglais ${langWord(x, 'vo')}${x.hevc ? ` · HEVC +${x.hevc}` : ''} · ≤ ${x.maxGo} Go${x.ancienAvant ? ` · 480p avant ${x.ancienAvant}` : ''}`;
    return `${x.label}${mark} : ${(x.formats ?? []).join(' > ')} · ${x.langue === 'fr' ? 'en français' : x.langue === 'fr_en' ? 'français ou anglais' : 'toutes langues'}`;
  }).join('\n') + '\n(✎ = réglé par toi ; le reste = filtre de départ)';
}
/** Ce qu'on envoie à Venus pour régler une catégorie (pur). Champs vides = inchangés. */
export function filtreBody(i: Record<string, unknown>): { categories: Record<string, unknown> } {
  const cat = catOf(s(i.categorie));
  if (!(CATS as readonly string[]).includes(cat)) throw new Error(`catégorie inconnue : ${s(i.categorie)} (films, animation, series, animes, musique, livres, livres_audio)`);
  if (i.depart === true || i.depart === 'true') return { categories: { [cat]: null } };
  const o: Record<string, unknown> = {}, n = (v: unknown) => (s(v).trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
  for (const [k, key] of [['min', 'min'], ['max', 'max'], ['cible', 'cible'], ['hevc', 'hevc'], ['taille_max_go', 'maxGo']] as const) { const v = n(i[k]); if (v !== undefined) o[key] = v; }
  const langues: Record<string, number> = {};
  const vost = s(i.vostfr); if (vost) langues.vostfr = vost === 'favoriser' ? 90 : vost === 'refuser' ? -500 : -100;
  const en = s(i.anglais); if (en) langues.vo = en === 'refuser' ? -1000 : -100;
  if (Object.keys(langues).length) o.langues = langues;
  if (vost === 'favoriser') o.cibleLangues = ['multi', 'vf', 'vostfr']; else if (vost) o.cibleLangues = ['multi', 'vf'];
  const fm = s(i.formats).split(/[,\s>]+/).map((x) => x.trim().toLowerCase()).filter(Boolean); if (fm.length) o.formats = fm;
  if (['fr', 'fr_en', 'tout'].includes(s(i.langue))) o.langue = s(i.langue);
  if (!Object.keys(o).length) throw new Error('rien à changer : donne au moins une valeur');
  return { categories: { [cat]: o } };
}

/** Une arrivée dans Venus (fil /api/arrivals) : épisode, film, série, ou VF arrivée. */
export interface Arrival { kind: 'episode' | 'movie' | 'show' | 'vf'; at: number; id: number; title?: string; show?: string; showId?: number; season?: number; episode?: number; vf?: boolean | null; anime?: boolean; text?: string; type?: string; year?: number }
const ep = (a: Arrival) => `S${String(a.season ?? 0).padStart(2, '0')}E${String(a.episode ?? 0).padStart(2, '0')}`;
/** Messages à envoyer (pur) : un par série (épisodes groupés), un par film, un par VF arrivée.
 *  mode « vf » : seulement les épisodes en VF et les VF arrivées. */
export function arrivalMessages(items: Arrival[], mode: 'tout' | 'vf' = 'tout'): string[] {
  const out: string[] = [], byShow = new Map<string, Arrival[]>();
  for (const a of [...items].sort((x, y) => x.at - y.at)) {
    if (a.kind === 'episode') { if (mode === 'vf' && a.vf !== true) continue; const k = a.show ?? String(a.showId); byShow.set(k, [...(byShow.get(k) ?? []), a]); }
    else if (a.kind === 'vf') out.push(`🇫🇷 VF arrivée sur Venus : ${a.text ?? `« ${a.title} »`}`);
    else if (a.kind === 'movie' && mode === 'tout') out.push(`🎬 Nouveau film sur Venus : « ${a.title} »${a.year ? ` (${a.year})` : ''}${a.vf ? ' · VF' : ''}`);
  }
  for (const [show, eps] of byShow) {
    const vf = eps.every((e) => e.vf === true) ? ' en VF' : eps.some((e) => e.vf === true) ? ' (dont VF)' : '';
    out.push(eps.length === 1 ? `📺 Épisode arrivé sur Venus${vf} : ${show} ${ep(eps[0])}${eps[0].title && !/^(É|E)pisode \d+$/i.test(eps[0].title) ? ` · ${eps[0].title}` : ''}`
      : `📺 ${eps.length} épisodes arrivés sur Venus${vf} : ${show} ${ep(eps[0])} → ${ep(eps[eps.length - 1])}`);
  }
  return out;
}
const hm = (t: number) => new Date(t).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function venus(url: () => string): Module {
  const conf = (): VenusConf => venusConf({ venus: { url: url() } });
  const tool = (input: Record<string, unknown>) => venusTool.run(input, { venus: { url: url() } } as never).then((r) => (typeof r === "string" ? r : r.output));
  const recordings = async (): Promise<Rec[]> => (await venusApi<{ recordings: Rec[] }>(conf(), 'GET', '/api/recordings')).recordings ?? [];
  const bygulQuery = (i: Record<string, unknown>) => { const k = kindOf(s(i.type)), y = s(i.annee); const q = new URLSearchParams({ q: s(i.titre), kind: k, ...(k === 'movie' && y ? { year: y } : {}), ...(k === 'episode' ? { season: y || '1', episode: s(i.episode) || '1' } : {}) }); return venusApi<{ results: BygulHit[]; errors: string[] }>(conf(), 'GET', `/api/admin/acquire/search?${q}`); };
  const m: Module = {
    id: 'freyja', name: 'Vénus', family: 'Maison',
    what: 'Ton serveur multimédia : films, séries, chaînes, programmes, enregistrements, sur tous tes écrans.',
    does: ['lance un film, une série ou une chaîne sur l\'écran choisi (« mets One Piece sur la télé du salon »)', 'guide des programmes : ce qui passe maintenant et ce soir', 'enregistre une émission ou toutes ses diffusions', 'liste les écrans où Venus est ouvert', 'recherche dans toute la bibliothèque', 'ma liste et demandes de nouveaux titres', 'alerte si un enregistrement échoue', 'te prévient quand un épisode arrive (et quand la VF arrive)', 'demande la VF d\'un titre à Radarr / Sonarr', 'met le dernier épisode, le suivant ou S2E5 d\'une série'],
    from: ['Venus (TOUFATECH)', 'Jellyfin', 'Plex'], upstream: ['TOUFATECH/Venus'],
    modes: ['Odéon · bibliothèque et télé en direct', 'Delta · sources', 'Hnoss · demandes', 'Sirius · films', 'Pléiades · séries et animés', 'Odyssée · livres et livres audio', 'Comète · téléchargements'],
    words: ['venus', 'vénus', 'freyja', 'film', 'films', 'serie', 'série', 'series', 'chaine', 'chaîne', 'tele', 'télé', 'television', 'programme tv', 'ce soir a la tele', 'enregistre', 'enregistrement', 'anime', 'regarder', 'vf', 'version francaise', 'episode', 'épisode', 'episodes', 'épisodes'],
    actions: [
      { id: 'etat', label: 'État', what: 'Serveur joignable, lecture en cours', read: true, run: async () => { const st = await venusApi<{ name?: string; version?: string; authenticated?: boolean; profile?: { name?: string }; elsewhere?: { title: string; device: string } | null }>(conf(), 'GET', '/api/status'); if (st.authenticated === false) throw new Error('Venus refuse la clé API : crées-en une dans Venus → Serveur → Clés API, puis range-la dans le coffre (VENUS_API_KEY)'); return { text: `${st.name ?? 'Venus'} ${st.version ?? ''} · profil ${st.profile?.name ?? '—'}${st.elsewhere ? ` · en lecture : ${st.elsewhere.title} sur ${st.elsewhere.device}` : ''}` }; } },
      { id: 'adresse', label: 'Adresse de Venus', what: 'L\'adresse du serveur Venus relié (pour la surveillance de Pulsar)', read: true, quiet: true, run: async () => ({ text: url() ? `Venus : ${url()}` : 'Venus n\'est pas relié.', data: { url: url() } }) },
      { id: 'sante', label: 'Santé de Venus', what: 'En marche depuis, lectures en cours, analyse de la bibliothèque, place libre', read: true, words: ['sante de venus', 'santé de venus', 'venus va bien'], run: async () => {
        const h = await venusApi<VHealth>(conf(), 'GET', '/api/health');
        if (!h.ok) throw new Error('Venus ne répond pas correctement');
        return { text: santeText(h), data: h };
      } },
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
      { id: 'enregistrements', label: 'Enregistrements', what: 'Programmés, en cours, terminés', read: true, words: ['mes enregistrements', 'liste des enregistrements', 'enregistrements programmes', 'enregistrements programmés'], run: async () => { const l = await recordings(); return { text: l.slice(0, 30).map((r) => `- ${r.title} · ${r.channel} · ${hm(r.start)} · ${REC[r.status] ?? r.status}${r.error ? ` (${r.error})` : ''}`).join('\n') || 'Aucun enregistrement.', data: l }; } },
      { id: 'annuler_enregistrement', label: 'Annuler un enregistrement', what: 'Annule un enregistrement programmé ou en cours', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }], run: async (_c, i) => { const r = (await recordings()).find((x) => ['scheduled', 'recording'].includes(x.status) && x.title.toLowerCase().includes(s(i.titre).toLowerCase())); if (!r) throw new Error('aucun enregistrement programmé avec ce titre'); await venusApi(conf(), 'DELETE', `/api/recordings/${r.id}`); return { text: `✗ Enregistrement annulé : ${r.title}.` }; } },
      { id: 'nouveautes', label: 'Nouveautés', what: 'Épisodes, films et VF arrivés ces derniers jours', read: true, params: [{ key: 'jours', label: 'Jours', kind: 'number', default: 3 }], words: ['nouveaux episodes', 'nouveaux épisodes', 'nouveautes venus', 'nouveautés venus', 'derniers ajouts', 'quoi de neuf sur venus', 'episodes arrives', 'épisodes arrivés'], run: async (_c, i) => {
        const days = Math.min(30, Math.max(1, Number(i.jours) || 3));
        const r = await venusApi<{ items: Arrival[] }>(conf(), 'GET', `/api/arrivals?since=${Date.now() - days * 86400_000}&limit=300`);
        const lines = arrivalMessages(r.items ?? []);
        return { text: lines.length ? lines.join('\n') : `Rien de nouveau sur Venus depuis ${days} jour${days > 1 ? 's' : ''}.`, data: r.items };
      } },
      { id: 'chercher_vf', label: 'Chercher en VF', what: 'Demande la version française d\'un film ou d\'une série à Radarr / Sonarr (via Venus)', params: [{ key: 'quoi', label: 'Titre', kind: 'text', required: true }], words: ['en vf', 'version francaise', 'version française', 'chercher en vf', 'cherche en vf', 'demande la vf', 'la vf de'], run: async (_c, i) => {
        const cards = (await venusApi<VCard[]>(conf(), 'GET', '/api/library')).filter((x) => x.type === 'movie' || x.type === 'show');
        const it = bestMatch(cards, s(i.quoi).replace(/\s+en (vf|version fran[cç]aise)$/i, '').replace(/^(la )?vf (de |d'|du )/i, ''));
        if (!it) throw new Error(`« ${s(i.quoi)} » n'est pas dans Venus`);
        const r = await venusApi<{ text: string }>(conf(), 'POST', `/api/items/${it.id}/vf`);
        return { text: `🇫🇷 ${r.text}` };
      } },
      { id: 'prevenir', label: 'Me prévenir des arrivées', what: 'Nouveaux épisodes et films (tout), seulement la VF, ou rien', words: ['previens moi', 'préviens-moi', 'previens', 'préviens', 'prevenir', 'ne me previens plus'], params: [{ key: 'quoi', label: 'Quoi', kind: 'select', options: ['tout', 'vf', 'rien'], default: 'tout' }], run: async (ctx, i) => {
        const v = ['tout', 'vf', 'rien'].includes(s(i.quoi)) ? s(i.quoi) : 'tout';
        ctx.saveSettings({ arrivals: v });
        return { text: v === 'rien' ? 'Je ne te préviens plus des arrivées sur Venus.' : v === 'vf' ? 'Je te préviens quand un épisode ou un film arrive en VF.' : 'Je te préviens de chaque épisode et film qui arrive sur Venus (avec la VF quand elle est là).' };
      } },
      { id: 'ecrans', label: 'Écrans', what: 'Où Venus est ouvert', read: true, words: ['ecrans', 'écrans'], run: async () => ({ text: await tool({ action: 'ecrans' }) }) },
      { id: 'chercher', label: 'Chercher', what: 'Dans la bibliothèque', read: true, params: [{ key: 'quoi', label: 'Titre', kind: 'text', required: true }], words: ['cherche', 'trouve'], run: async (_c, i) => ({ text: await tool({ action: 'chercher', quoi: s(i.quoi) }) }) },
      // ---------------- Médias automatiques (dans Venus) : Hnoss · Sirius · Pléiades · Odyssée · Comète
      { id: 'medias', label: 'Médias automatiques', what: 'Hnoss (demandes), Sirius (films), Pléiades (séries), Odyssée (livres), Comète (téléchargements) : envies, téléchargements en cours, rangés, journal', read: true, words: ['medias automatiques', 'médias automatiques', 'telechargements', 'téléchargements', 'en cours de telechargement', 'hnoss', 'gersemi', 'hildisvini', 'hildisvíni', 'folkvangr', 'fólkvangr', 'sjofn', 'sjöfn'], run: async () => {
        const d = await venusApi<MediaState>(conf(), 'GET', '/api/admin/acquire');
        return { text: mediasText(d), data: d };
      } },
      { id: 'medias_regler', label: 'Régler les médias automatiques', what: 'Activer (le ♡, « À venir » et « Télécharger » passent au moteur de Venus), meilleures versions, partage après téléchargement. Les langues et qualités se règlent par catégorie (« filtre des médias »)', params: [{ key: 'actif', label: 'Actif', kind: 'boolean', default: true }, { key: 'ameliorer', label: 'Chercher de meilleures versions', kind: 'boolean', default: true }, { key: 'partager', label: 'Continuer à partager après', kind: 'boolean', default: true }], run: async (_c, i) => {
        await venusApi(conf(), 'PUT', '/api/admin/acquire', { on: i.actif !== false && i.actif !== 'false', upgrade: i.ameliorer !== false && i.ameliorer !== 'false', keepSeeding: i.partager !== false && i.partager !== 'false' });
        return { text: `Médias automatiques ${i.actif === false || i.actif === 'false' ? 'coupés' : 'actifs : ♡, « À venir » et « Télécharger » passent par Delta et Comète'}.` };
      } },
      { id: 'medias_filtres', label: 'Filtres des médias', what: 'Qualité et langues appliquées par catégorie : films, films d\'animation, séries, animés, musique, livres, livres audio', read: true, words: ['filtres des medias', 'filtres des médias', 'profils de qualite', 'profils de qualité'], run: async () => {
        const d = await venusApi<{ filtres: Record<string, MediaFilter> }>(conf(), 'GET', '/api/admin/acquire');
        return { text: filtresText(d.filtres), data: d.filtres };
      } },
      { id: 'medias_filtre', label: 'Régler le filtre d\'une catégorie', what: 'Résolution min / max / visée, VOSTFR (favoriser, en attendant la VF, refuser), anglais, bonus HEVC, taille max ; formats et langue pour musique et livres. Champs vides = inchangés', params: [
        { key: 'categorie', label: 'Catégorie', kind: 'select', options: [...CATS], default: 'films' },
        { key: 'min', label: 'Résolution minimale', kind: 'select', options: ['', '400', '480', '720', '1080'], default: '' },
        { key: 'max', label: 'Résolution maximale', kind: 'select', options: ['', '720', '1080', '2160'], default: '' },
        { key: 'cible', label: 'Résolution visée', kind: 'select', options: ['', '720', '1080', '2160'], default: '' },
        { key: 'vostfr', label: 'VOSTFR', kind: 'select', options: ['', 'favoriser', 'en_attendant', 'refuser'], default: '' },
        { key: 'anglais', label: 'Sans français', kind: 'select', options: ['', 'refuser', 'accepter'], default: '' },
        { key: 'hevc', label: 'Bonus HEVC', kind: 'text', default: '' },
        { key: 'taille_max_go', label: 'Taille max (Go)', kind: 'text', default: '' },
        { key: 'formats', label: 'Formats (musique, livres) dans l\'ordre', kind: 'text', default: '' },
        { key: 'langue', label: 'Langue (musique, livres)', kind: 'select', options: ['', 'fr', 'fr_en', 'tout'], default: '' },
        { key: 'depart', label: 'Revenir au filtre de départ', kind: 'boolean', default: false },
      ], run: async (_c, i) => {
        const body = filtreBody(i);
        await venusApi(conf(), 'PUT', '/api/admin/acquire', body);
        const d = await venusApi<{ filtres: Record<string, MediaFilter> }>(conf(), 'GET', '/api/admin/acquire');
        const cat = Object.keys(body.categories)[0];
        return { text: `${body.categories[cat] === null ? 'Filtre de départ remis' : 'Filtre réglé'} :\n${filtresText({ [cat]: d.filtres[cat] }).split('\n')[0]}` };
      } },
      { id: 'medias_lots', label: 'Recherche par lots', what: 'Pour ne pas saturer les indexeurs : envies cherchées par passage (toutes les 15 min), pause entre deux recherches, meilleures versions par passage, recherches par minute et par source', params: [{ key: 'taille', label: 'Envies par passage', kind: 'number', default: 10 }, { key: 'pause', label: 'Pause entre deux (secondes)', kind: 'number', default: 4 }, { key: 'ameliorations', label: 'Meilleures versions par passage', kind: 'number', default: 5 }, { key: 'par_minute', label: 'Recherches par minute et par source', kind: 'number', default: 10 }], run: async (_c, i) => {
        await venusApi(conf(), 'PUT', '/api/admin/acquire', { lots: { taille: Number(i.taille) || 10, pauseS: Number(i.pause) >= 0 ? Number(i.pause) : 4, ameliorations: Number(i.ameliorations) >= 0 ? Number(i.ameliorations) : 5, parMinute: Number(i.par_minute) || 10 } });
        const d = await venusApi<{ lots: { taille: number; pauseS: number; ameliorations: number; parMinute: number } }>(conf(), 'GET', '/api/admin/acquire');
        return { text: `Par lots : ${d.lots.taille} envie(s) par passage, ${d.lots.pauseS} s entre deux, ${d.lots.ameliorations} meilleure(s) version(s), au plus ${d.lots.parMinute} recherche(s) par minute et par source.` };
      } },
      { id: 'medias_autotest', label: 'Autotest des médias', what: 'Un film du domaine public (archive.org) traverse toute la chaîne : Delta, téléchargement, rangement, vérification ; puis tout est retiré', params: [{ key: 'archive', label: 'Identifiant archive.org (vide = The Skeleton Dance, 1929)', kind: 'text', default: '' }], run: async (_c, i) => {
        const r = await venusApi<{ item: { id: string } }>(conf(), 'POST', '/api/admin/acquire/selftest', s(i.archive) ? { id: s(i.archive) } : {});
        return { text: `Autotest lancé (archive.org : ${r.item.id}). Dis « état de l'autotest » pour suivre.` };
      } },
      { id: 'medias_autotest_etat', label: 'État de l\'autotest', what: 'Les étapes de l\'autotest des médias', read: true, words: ['etat de l autotest', 'état de l\'autotest', 'autotest des medias', 'autotest des médias'], run: async () => {
        const r = await venusApi<{ running: boolean; result: string | null; steps: Array<{ text: string; ok: boolean }> }>(conf(), 'GET', '/api/admin/acquire/selftest');
        if (!r.steps.length) return { text: 'Aucun autotest lancé.' };
        return { text: [`Autotest ${r.running ? 'en cours…' : r.result === 'réussi' ? '✅ réussi' : '❌ en échec'}`, ...r.steps.map((x) => `${x.ok ? '✓' : '✗'} ${x.text}`)].join('\n'), ok: r.running || r.result === 'réussi' };
      } },
      { id: 'medias_source', label: 'Ajouter une source', what: 'Un indexeur Torznab ou Newznab (adresse et clé). Venus ne fournit aucune source : n\'ajoute que des sources autorisées', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'type', label: 'Type', kind: 'select', options: ['torznab', 'newznab'], default: 'torznab' }, { key: 'adresse', label: 'Adresse de l\'API', kind: 'text', required: true }, { key: 'cle', label: 'Clé', kind: 'password', default: '' }], run: async (_c, i) => {
        const r = await venusApi<{ id: number }>(conf(), 'POST', '/api/admin/acquire/sources', { name: s(i.nom), kind: s(i.type) || 'torznab', url: s(i.adresse), key: s(i.cle) });
        return { text: `Source « ${s(i.nom)} » ajoutée (n° ${r.id}). La clé reste dans Venus.` };
      } },
      // ---------------- Delta · Sources (comme Prowlarr, recodé dans Venus)
      { id: 'bygul', label: 'Delta · Sources', what: 'Les sources du bloc Médias : santé (bonne, fragile, en pause), priorité, recherches, téléchargements obtenus, temps de réponse', read: true, words: ['bygul', 'sources', 'indexeurs', 'prowlarr', 'sante des sources'], run: async () => {
        const d = await venusApi<MediaState>(conf(), 'GET', '/api/admin/acquire');
        return { text: bygulText(d.sources as unknown as BygulSource[]), data: d.sources };
      } },
      { id: 'bygul_tester', label: 'Tester une source', what: 'Connexion et ce que la source sait chercher (films, séries, musique, livres)', read: true, params: [{ key: 'id', label: 'Numéro de la source', kind: 'number', required: true }], run: async (_c, i) => {
        const r = await venusApi<{ ok: boolean; ms: number; error?: string; caps?: Record<string, boolean> }>(conf(), 'POST', `/api/admin/acquire/sources/${Number(i.id)}/test`);
        return { text: r.ok ? `✅ Source ${Number(i.id)} : répond en ${r.ms} ms · ${['films', 'series', 'musique', 'livres'].filter((k) => r.caps?.[k]).join(', ') || 'recherche générale seulement'}` : `❌ Source ${Number(i.id)} : ${r.error}`, ok: r.ok };
      } },
      { id: 'bygul_importer_prowlarr', label: 'Importer depuis Prowlarr', what: 'Reprend les indexeurs de TON Prowlarr (actifs et coupés, priorités) ; Delta passe par l\'API Torznab de Prowlarr. Un nouvel import met à jour sans doublon', params: [{ key: 'adresse', label: 'Adresse de Prowlarr (ex. http://192.168.1.170:9696)', kind: 'text', required: true }, { key: 'cle', label: 'Clé API de Prowlarr', kind: 'password', required: true }], words: ['importe prowlarr', 'importer prowlarr', 'importe mes indexeurs'], run: async (_c, i) => {
        const r = await venusApi<{ added: number; updated: number; active: number; disabled: number; total: number }>(conf(), 'POST', '/api/admin/acquire/sources/import-prowlarr', { url: s(i.adresse), key: s(i.cle) });
        return { text: `Prowlarr : ${r.total} indexeur(s) · ${r.active} actif(s), ${r.disabled} coupé(s) · ${r.added} ajouté(s), ${r.updated} mis à jour. La clé reste dans Venus. Dis « teste toutes les sources » pour les vérifier.` };
      } },
      { id: 'bygul_tester_tout', label: 'Tester toutes les sources', what: 'Teste les sources actives une à une (connexion, ce qu\'elles savent chercher)', read: true, words: ['teste toutes les sources', 'tester les sources', 'teste les indexeurs'], run: async () => {
        const l = await venusApi<Array<{ id: number; name: string; ok: boolean; ms: number; error?: string }>>(conf(), 'POST', '/api/admin/acquire/sources/test-all');
        const ko = l.filter((x) => !x.ok);
        return { text: [`${l.length - ko.length} / ${l.length} source(s) répondent.`, ...l.map((x) => `${x.ok ? '🟢' : '🔴'} n° ${x.id} ${x.name}${x.ok ? ` · ${x.ms} ms` : ` · ${x.error}`}`)].join('\n'), ok: !ko.length };
      } },
      { id: 'bygul_regler', label: 'Régler une source', what: 'Activer ou couper, priorité (1 = d\'abord), types servis, recherches par minute', params: [{ key: 'id', label: 'Numéro de la source', kind: 'number', required: true }, { key: 'actif', label: 'Active', kind: 'boolean', default: true }, { key: 'priorite', label: 'Priorité (1 à 50)', kind: 'number', default: 25 }, { key: 'types', label: 'Types (films, series, musique, livres ; vide = tous)', kind: 'text', default: '' }, { key: 'par_minute', label: 'Recherches par minute (vide = réglage général)', kind: 'text', default: '' }], run: async (_c, i) => {
        const kinds = s(i.types).split(/[,\s]+/).map((x) => x.trim().toLowerCase().replace('séries', 'series')).filter(Boolean);
        await venusApi(conf(), 'PUT', `/api/admin/acquire/sources/${Number(i.id)}`, { enabled: i.actif !== false && i.actif !== 'false', priority: Number(i.priorite) || 25, kinds, rpm: Number(s(i.par_minute)) || null });
        return { text: `Source ${Number(i.id)} : ${i.actif === false || i.actif === 'false' ? 'coupée' : 'active'}, priorité ${Number(i.priorite) || 25}${kinds.length ? `, ${kinds.join(', ')}` : ''}.` };
      } },
      { id: 'bygul_chercher', label: 'Chercher dans les sources', what: 'Recherche à la main dans toutes les sources : versions notées (VF, qualité), et pourquoi les autres sont écartées', read: true, params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'type', label: 'Type', kind: 'select', options: ['film', 'épisode', 'album', 'livre', 'livre audio'], default: 'film' }, { key: 'annee', label: 'Année / saison', kind: 'text', default: '' }, { key: 'episode', label: 'Épisode', kind: 'text', default: '' }], words: ['cherche dans les sources', 'recherche manuelle'], run: async (_c, i) => {
        const r = await bygulQuery(i);
        return { text: r.results.length ? r.results.slice(0, 12).map((x, k) => `${k + 1}. ${x.ok ? '✅' : '✗'} ${x.title} · ${(x.size / 1e9).toFixed(1).replace('.', ',')} Go · ${x.seeders ?? '?'} sources · ${x.indexer}${x.ok ? ` · note ${x.score}` : ` · ${x.why}`}`).join('\n') : `Rien trouvé${r.errors.length ? ` (${r.errors.join(' ; ')})` : ''}.`, data: r };
      } },
      { id: 'bygul_telecharger', label: 'Télécharger un résultat', what: 'Télécharge le résultat n° N de la recherche (par Comète), puis le range dans Venus', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'type', label: 'Type', kind: 'select', options: ['film', 'épisode', 'album', 'livre', 'livre audio'], default: 'film' }, { key: 'annee', label: 'Année / saison', kind: 'text', default: '' }, { key: 'episode', label: 'Épisode', kind: 'text', default: '' }, { key: 'numero', label: 'Numéro du résultat', kind: 'number', default: 1 }], run: async (_c, i) => {
        const r = await bygulQuery(i), x = r.results[Math.max(1, Number(i.numero) || 1) - 1];
        if (!x) throw new Error('pas de résultat à ce numéro');
        const k = kindOf(s(i.type)), y = Number(s(i.annee)) || undefined;
        await venusApi(conf(), 'POST', '/api/admin/acquire/grab', { link: x.link, title: x.title, sourceId: x.sourceId, kind: k, name: s(i.titre), ...(k === 'movie' && y ? { year: y } : {}), ...(k === 'episode' ? { season: y ?? 1, episode: Number(s(i.episode)) || 1 } : {}) });
        return { text: `⬇ ${x.title} : téléchargement lancé (Comète), rangé dans Venus à la fin.` };
      } },
      { id: 'medias_vouloir', label: 'Je veux… (album, livre, livre audio)', what: 'Ajoute une envie à la main : un album (Musique), un livre ou un livre audio (Odyssée), un film ; Venus le cherche dans Delta, le télécharge et le range', params: [{ key: 'type', label: 'Type', kind: 'select', options: ['album', 'livre', 'livre audio', 'film'], default: 'album' }, { key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'qui', label: 'Artiste ou auteur', kind: 'text', default: '' }, { key: 'annee', label: 'Année', kind: 'text', default: '' }], words: ['je veux l album', 'telecharge l album', 'télécharge l\'album', 'je veux le livre', 'livre audio de'], run: async (_c, i) => {
        const k = kindOf(s(i.type)), y = Number(s(i.annee)) || undefined;
        const r = await venusApi<{ id: number; search: { ok: boolean; why?: string; pick?: { r: { title: string } } } }>(conf(), 'POST', '/api/admin/acquire/wants', { kind: k, title: s(i.titre), ...(k === 'album' ? { artist: s(i.qui) } : s(i.qui) ? { author: s(i.qui) } : {}), ...(y ? { year: y } : {}) });
        return { text: r.search.ok ? `⬇ ${s(i.titre)} : ${r.search.pick?.r.title ?? 'trouvé'}, téléchargement lancé.` : `${s(i.titre)} ajouté aux envies : ${r.search.why ?? 'pas encore trouvé'} (Venus recherchera tout seul).` };
      } },
      { id: 'medias_retirer_source', label: 'Retirer une source', what: 'Retire une source de Venus', quick: false, params: [{ key: 'id', label: 'Numéro de la source', kind: 'number', required: true }], run: async (_c, i) => { await venusApi(conf(), 'DELETE', `/api/admin/acquire/sources/${Number(i.id)}`); return { text: `Source ${Number(i.id)} retirée.` }; } },
      { id: 'medias_moteur', label: 'Moteur de téléchargement', what: 'Comète (le moteur de Venus, par défaut), ou un qBittorrent / Transmission / SABnzbd que tu as déjà', params: [{ key: 'type', label: 'Moteur', kind: 'select', options: ['venus', 'qbittorrent', 'transmission', 'sabnzbd'], default: 'venus' }, { key: 'adresse', label: 'Adresse (moteur existant)', kind: 'text', default: '' }, { key: 'utilisateur', label: 'Utilisateur', kind: 'text', default: '' }, { key: 'mot_de_passe', label: 'Mot de passe ou clé', kind: 'password', default: '' }], run: async (_c, i) => {
        const type = s(i.type) || 'venus';
        await venusApi(conf(), 'PUT', '/api/admin/acquire', { client: { type, url: s(i.adresse), user: s(i.utilisateur), ...(type === 'sabnzbd' ? { key: s(i.mot_de_passe) } : { password: s(i.mot_de_passe) }) } });
        return { text: type === 'venus' ? 'Téléchargements : Comète, le moteur de Venus.' : `Téléchargements : ${type} (${s(i.adresse)}).` };
      } },
      { id: 'medias_chercher', label: 'Chercher maintenant', what: 'Relance tout de suite la recherche d\'une envie (titre)', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }], run: async (_c, i) => {
        const d = await venusApi<MediaState>(conf(), 'GET', '/api/admin/acquire'), q = s(i.titre).toLowerCase();
        const w = d.wants.find((x) => x.title.toLowerCase() === q) ?? d.wants.find((x) => x.title.toLowerCase().includes(q));
        if (!w) throw new Error(`« ${s(i.titre)} » n'est pas dans les envies`);
        const r = await venusApi<{ ok: boolean; why?: string; pick?: { r: { title: string } } }>(conf(), 'POST', `/api/admin/acquire/wants/${w.id}/search`);
        return { text: r.ok ? `⬇ ${w.title} : ${r.pick?.r.title ?? 'version trouvée'}, téléchargement lancé.` : `${w.title} : ${r.why ?? 'rien trouvé'}.`, ok: r.ok };
      } },
      { id: 'ma_liste', label: 'Ma liste', what: 'Titres gardés pour plus tard', read: true, run: async () => { const l = await venusApi<Array<{ title: string; year?: number; type: string }>>(conf(), 'GET', '/api/mylist'); return { text: l.slice(0, 40).map((x) => `- ${x.title}${x.year ? ` (${x.year})` : ''}`).join('\n') || 'Liste vide.' }; } },
      { id: 'demander', label: 'Demander un titre', what: 'Titre absent de la bibliothèque (via la demande de Venus)', params: [{ key: 'titre', label: 'Titre', kind: 'text', required: true }, { key: 'type', label: 'Type', kind: 'select', options: ['film', 'série'], default: 'film' }], run: async (_c, i) => { const r = await venusApi<{ state?: string }>(conf(), 'POST', '/api/discover/request', { type: i.type === 'série' ? 'tv' : 'movie', title: s(i.titre) }); return { text: `📥 Demande envoyée : « ${s(i.titre)} »${r.state ? ` (${r.state})` : ''}.` }; } },
      actionRestaurer('venus'),
    ],
    async view() {
      if (!url() || !process.env.VENUS_API_KEY) return { subtitle: 'Venus n\'est pas relié.', sections: [...carteSauvegarde('venus'), { kind: 'text', title: 'Relier Venus', text: 'Réglages → Maison → Venus : l\'adresse de ton serveur, et une clé API créée dans Venus (Serveur → Clés API), rangée dans le coffre (VENUS_API_KEY).' }] };
      const [recs, screens] = await Promise.all([recordings().catch(() => [] as Rec[]), venusApi<Array<{ name: string; tv: boolean; playing: boolean }>>(conf(), 'GET', '/api/devices/open').catch(() => [])]);
      const next = recs.filter((r) => ['scheduled', 'recording'].includes(r.status)).sort((a, b) => a.start - b.start), failed = recs.filter(failedRec);
      return {
        subtitle: `${screens.length} écran(s) ouvert(s) · ${next.length} enregistrement(s) à venir`,
        kpis: [{ label: 'Écrans ouverts', value: String(screens.length) }, { label: 'En lecture', value: String(screens.filter((x) => x.playing).length) }, { label: 'Enregistrements échoués', value: String(failed.length), tone: failed.length ? 'mauvais' : 'bon' }],
        sections: [
          ...carteSauvegarde('venus'),
          { kind: 'table', title: 'Écrans', columns: ['Écran', 'Type', 'État'], empty: 'Aucun écran n\'a Venus ouvert.', rows: screens.map((x) => ({ cells: [x.name, x.tv ? 'télé' : 'appareil', x.playing ? 'en lecture' : 'ouvert'], tone: x.playing ? 'bon' as const : undefined })) },
          { kind: 'table', title: 'Enregistrements', columns: ['Émission', 'Chaîne', 'Quand', 'État'], empty: 'Aucun enregistrement.', rows: [...next, ...failed].slice(0, 30).map((r) => ({ cells: [r.title, r.channel, hm(r.start), `${REC[r.status] ?? r.status}${r.error ? ` : ${r.error.slice(0, 80)}` : ''}`], tone: failedRec(r) ? 'mauvais' as const : r.status === 'recording' ? 'bon' as const : undefined, actions: failedRec(r) ? [] : [{ action: 'annuler_enregistrement', label: 'Annuler', input: { titre: r.title } }] })) },
        ],
        side: [{ kind: 'form', title: 'Regarder', action: 'regarder', submit: 'Lancer', params: m.actions.find((a) => a.id === 'regarder')?.params ?? [] }, { kind: 'form', title: 'Enregistrer', action: 'enregistrer', submit: 'Programmer', params: m.actions.find((a) => a.id === 'enregistrer')?.params ?? [] }],
      };
    },
    watch: { every: 300, async run(ctx: ModCtx) {
      if (!url() || !process.env.VENUS_API_KEY) return;
      const recs = await recordings(), seen = new Set((ctx.settings.failedSeen as number[] | undefined) ?? []);
      for (const r of recs.filter((x) => failedRec(x) && !seen.has(x.id))) { ctx.alert({ level: 'moyenne', title: `Enregistrement échoué : ${r.title}`, detail: `${r.channel} · ${hm(r.start)}${r.error ? ` · ${r.error}` : ''}`, key: `rec:${r.id}` }); seen.add(r.id); ctx.emit('enregistrement_echoue', { titre: r.title, chaîne: r.channel }); }
      ctx.saveSettings({ failedSeen: [...seen].slice(-500) });
      // Arrivées (épisodes, films, VF) : « Épisode arrivé sur Venus : One Piece S01E1071 »
      const mode = s(ctx.settings.arrivals || 'tout');
      const since = Number(ctx.settings.arrivalsSince) || 0, now = Date.now();
      if (mode === 'rien') { ctx.saveSettings({ arrivalsSince: now }); return; }
      if (!since) { ctx.saveSettings({ arrivalsSince: now }); return; } // première fois : on ne ressort pas tout l'historique
      const r = await venusApi<{ now?: number; items: Arrival[] }>(conf(), 'GET', `/api/arrivals?since=${since}&limit=300`).catch(() => null);
      if (!r) return;
      for (const t of arrivalMessages(r.items ?? [], mode === 'vf' ? 'vf' : 'tout').slice(0, 10)) { await ctx.notify(t); ctx.emit('arrivee', { texte: t }); }
      ctx.saveSettings({ arrivalsSince: r.now ?? now });
    } },
  };
  return m;
}
