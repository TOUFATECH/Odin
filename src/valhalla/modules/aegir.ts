// Ægir — la bibliothèque musicale et les radios : indexe tes dossiers de musique (titre, artiste,
// album lus par ffprobe), recherche, listes de lecture, radios web, et lecture sur une enceinte de la
// maison (via la box reliée dans Midgard) ou sur cette machine (mpv/ffplay).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, basename } from 'node:path';
import { haApi, type HaState } from '../../tools/homeassistant.ts';
import type { ModCtx, Module } from '../types.ts';

export interface Track { file: string; title: string; artist: string; album: string; sec: number }
export interface Radio { name: string; url: string }
const s = (v: unknown) => String(v ?? '');
const AUDIO = new Set(['.mp3', '.flac', '.ogg', '.opus', '.m4a', '.aac', '.wav', '.wma']);
const lib = (ctx: ModCtx): Track[] => (ctx.settings.library as Track[] | undefined) ?? [];
const radios = (ctx: ModCtx): Radio[] => (ctx.settings.radios as Radio[] | undefined) ?? [];
const lists = (ctx: ModCtx): Record<string, string[]> => (ctx.settings.playlists as Record<string, string[]> | undefined) ?? {};
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** « Artiste - Titre.mp3 » → { artist, title } quand les tags manquent. */
export function fromName(file: string): { artist: string; title: string } {
  const b = basename(file, extname(file)).replace(/^\d+[\s._-]+/, '').replace(/_/g, ' ');
  const i = b.indexOf(' - '); return i > 0 ? { artist: b.slice(0, i).trim(), title: b.slice(i + 3).trim() } : { artist: '', title: b.trim() };
}
export function search(tracks: Track[], q: string): Track[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  return tracks.filter((t) => { const h = norm(`${t.title} ${t.artist} ${t.album}`); return words.every((w) => h.includes(w)); });
}
function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 50_000) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1); else if (AUDIO.has(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}
async function tags(ctx: ModCtx, file: string, probe: boolean): Promise<Track> {
  const f = fromName(file), album = basename(join(file, '..'));
  if (probe) {
    const r = await ctx.run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', file], { timeoutMs: 8000 });
    try { const j = JSON.parse(r.out) as { format?: { duration?: string; tags?: Record<string, string> } }; const t = Object.fromEntries(Object.entries(j.format?.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v])); return { file, title: t.title || f.title, artist: t.artist || t.album_artist || f.artist, album: t.album || album, sec: Math.round(Number(j.format?.duration ?? 0)) }; } catch { /* repli sur le nom */ }
  }
  return { file, ...f, album, sec: 0 };
}
async function play(ctx: ModCtx, url: string, where: string): Promise<string> {
  if (where && where !== 'ici') {
    const ha = s(ctx.settings.haUrl).replace(/\/$/, ''), token = process.env.HA_TOKEN; if (!ha || !token) throw new Error('relie ta box dans Ægir (même adresse que Midgard) pour jouer sur une enceinte');
    if (!/^https?:\/\//.test(url)) throw new Error('une enceinte ne peut lire qu\'une adresse web (radio) : les fichiers locaux se jouent « ici »');
    // L'enceinte est cherchée dans la box par son nom (ou son identifiant), comme pour les annonces.
    const players = (await haApi(ha, token, 'GET', '/states') as HaState[]).filter((x) => x.entity_id.startsWith('media_player.') && x.state !== 'unavailable');
    const q = norm(where), p = players.find((x) => x.entity_id === where) ?? players.find((x) => norm(`${x.entity_id} ${x.attributes.friendly_name ?? ''}`).includes(q));
    if (!p) throw new Error(`enceinte « ${where} » introuvable. Disponibles : ${players.map((x) => x.attributes.friendly_name ?? x.entity_id).slice(0, 12).join(', ') || 'aucune'}`);
    await haApi(ha, token, 'POST', '/services/media_player/play_media', { entity_id: p.entity_id, media_content_id: url, media_content_type: 'music' });
    return `▶ Sur ${p.attributes.friendly_name ?? p.entity_id}.`;
  }
  const bin = (await ctx.has('mpv')) ? ['mpv', ['--no-video', '--really-quiet', url]] as const : (await ctx.has('ffplay')) ? ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', url]] as const : undefined;
  if (!bin) throw new Error('ni mpv ni ffplay sur cette machine');
  void ctx.run(bin[0], [...bin[1]], { timeoutMs: 6 * 3600_000 });
  return '▶ Lecture sur cette machine.';
}

export const aegir: Module = {
  id: 'aegir', name: 'Ægir', family: 'Maison',
  what: 'Ta musique et tes radios : bibliothèque, recherche, listes, lecture sur les enceintes.',
  does: ['indexe tes dossiers de musique (titre, artiste, album, durée)', 'recherche par mots', 'listes de lecture', 'radios web', 'lecture sur une enceinte de la maison ou sur cette machine', 'arrêt de la lecture'],
  from: ['Navidrome', 'Jellyfin (musique)', 'Music Assistant', 'Mopidy'], upstream: ['navidrome/navidrome', 'music-assistant/server'],
  modes: ['Ran · radios'],
  words: ['musique', 'chanson', 'chansons', 'album', 'artiste', 'radio', 'playlist', 'liste de lecture', 'ecouter', 'écouter', 'joue'],
  actions: [
    { id: 'indexer', label: 'Indexer', what: 'Relit les dossiers de musique', read: true, words: ['indexe', 'actualise'], run: async (ctx) => {
      const dirs = ((ctx.settings.dirs as string[] | undefined) ?? []).filter((d) => existsSync(d) && statSync(d).isDirectory());
      if (!dirs.length) return { text: 'Ajoute d\'abord un dossier de musique.' };
      const files = dirs.flatMap((d) => walk(d)), probe = await ctx.has('ffprobe'), out: Track[] = [];
      for (let i = 0; i < files.length; i += 8) out.push(...await Promise.all(files.slice(i, i + 8).map((f) => tags(ctx, f, probe))));
      ctx.saveSettings({ library: out, indexed: ctx.now().toISOString() });
      return { text: `🎵 ${out.length} morceau(x) indexé(s)${probe ? '' : ' (sans ffprobe : titres tirés des noms de fichiers)'}.` };
    } },
    { id: 'dossier', label: 'Ajouter un dossier', what: 'Dossier de musique sur cette machine', params: [{ key: 'chemin', label: 'Chemin', kind: 'text', required: true }], run: (ctx, i) => { const d = s(i.chemin).trim(); if (!existsSync(d)) throw new Error('dossier introuvable'); ctx.saveSettings({ dirs: [...new Set([...((ctx.settings.dirs as string[]) ?? []), d])] }); return { text: `📁 ${d} ajouté. Lance « Indexer ».` }; } },
    { id: 'chercher', label: 'Chercher', what: 'Titre, artiste, album', read: true, params: [{ key: 'q', label: 'Recherche', kind: 'text', required: true }], words: ['cherche', 'trouve'], run: (ctx, i) => { const r = search(lib(ctx), s(i.q)); return { text: r.slice(0, 30).map((t) => `- ${t.artist ? `${t.artist} — ` : ''}${t.title} (${t.album})`).join('\n') || 'Rien trouvé.', data: r.slice(0, 100) }; } },
    { id: 'jouer', label: 'Jouer', what: 'Un morceau, une liste ou une radio, ici ou sur une enceinte', params: [{ key: 'quoi', label: 'Morceau, liste ou radio', kind: 'text', required: true }, { key: 'ou', label: 'Où (ici, ou nom de l\'enceinte)', kind: 'text', default: 'ici' }], words: ['joue', 'mets', 'ecouter', 'écouter'], run: async (ctx, i) => {
      const q = s(i.quoi), where = s(i.ou) || 'ici';
      const radio = radios(ctx).find((r) => norm(r.name) === norm(q)); if (radio) return { text: await play(ctx, radio.url, where) };
      const pl = lists(ctx)[q]; if (pl?.length) return { text: await play(ctx, pl[0], where) + ` (liste « ${q} », ${pl.length} morceaux)` };
      const t = search(lib(ctx), q)[0]; if (!t) throw new Error(`rien trouvé pour « ${q} »`);
      return { text: `${await play(ctx, t.file, where)} ${t.artist ? `${t.artist} — ` : ''}${t.title}` };
    } },
    { id: 'stop', label: 'Arrêter', what: 'Arrête la lecture sur cette machine', run: async (ctx) => { await ctx.run('pkill', ['-f', '^(mpv --no-video|ffplay -nodisp)']); return { text: '⏹ Arrêté.' }; } },
    { id: 'liste', label: 'Créer une liste', what: 'Nom + recherche : les morceaux trouvés forment la liste', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'q', label: 'Recherche', kind: 'text', required: true }], run: (ctx, i) => { const r = search(lib(ctx), s(i.q)); ctx.saveSettings({ playlists: { ...lists(ctx), [s(i.nom)]: r.map((t) => t.file) } }); return { text: `📜 Liste « ${s(i.nom)} » : ${r.length} morceau(x).` }; } },
    { id: 'radio', label: 'Ajouter une radio', what: 'Nom + adresse du flux', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'adresse', label: 'Adresse (http…)', kind: 'text', required: true }], run: (ctx, i) => { if (!/^https?:\/\//.test(s(i.adresse))) throw new Error('adresse http(s) attendue'); ctx.saveSettings({ radios: [...radios(ctx).filter((r) => r.name !== s(i.nom)), { name: s(i.nom), url: s(i.adresse).trim() }] }); return { text: `📻 ${s(i.nom)} ajoutée.` }; } },
  ],
  view(ctx) {
    const l = lib(ctx), artists = new Set(l.map((t) => t.artist).filter(Boolean)), albums = new Set(l.map((t) => t.album));
    const byArtist = [...artists].map((a) => ({ label: a, value: l.filter((t) => t.artist === a).length })).sort((a, b) => b.value - a.value).slice(0, 10);
    return {
      subtitle: `${l.length} morceau(x) · ${artists.size} artiste(s) · ${radios(ctx).length} radio(s)`,
      tabs: ['Ægir · bibliothèque', 'Ran · radios'],
      kpis: [{ label: 'Morceaux', value: String(l.length) }, { label: 'Albums', value: String(albums.size) }, { label: 'Listes', value: String(Object.keys(lists(ctx)).length) }],
      sections: [
        { kind: 'bars', title: 'Artistes les plus présents', items: byArtist },
        { kind: 'table', title: 'Radios', columns: ['Radio', 'Adresse'], empty: 'Aucune radio.', rows: radios(ctx).map((r) => ({ cells: [r.name, r.url], actions: [{ action: 'jouer', label: 'Écouter ici', input: { quoi: r.name, ou: 'ici' } }] })) },
        { kind: 'list', title: 'Listes de lecture', empty: 'Aucune liste.', items: Object.entries(lists(ctx)).map(([n, f]) => ({ title: n, detail: `${f.length} morceau(x)` })) },
      ],
      side: [{ kind: 'form', title: 'Ajouter un dossier', action: 'dossier', submit: 'Ajouter', params: aegir.actions[1].params! }, { kind: 'form', title: 'Ajouter une radio', action: 'radio', submit: 'Ajouter', params: aegir.actions[6].params! }],
    };
  },
};
