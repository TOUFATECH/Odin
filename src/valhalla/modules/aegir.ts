// Apollon — la bibliothèque musicale et les radios : indexe tes dossiers de musique (titre, artiste,
// album lus par ffprobe), recherche, listes de lecture, radios web, et lecture sur une enceinte de la
// maison (via la box reliée dans Midgard) ou sur cette machine (mpv/ffplay).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, basename } from 'node:path';
import { haApi, type HaState } from '../../tools/homeassistant.ts';
import type { ModCtx, Module } from '../types.ts';
import { entreeFfmpeg } from '../../files/ffmpeg-entree.ts';

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
    const r = await ctx.run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', ...entreeFfmpeg('son'), file], { timeoutMs: 8000 });
    try { const j = JSON.parse(r.out) as { format?: { duration?: string; tags?: Record<string, string> } }; const t = Object.fromEntries(Object.entries(j.format?.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v])); return { file, title: t.title || f.title, artist: t.artist || t.album_artist || f.artist, album: t.album || album, sec: Math.round(Number(j.format?.duration ?? 0)) }; } catch { /* repli sur le nom */ }
  }
  return { file, ...f, album, sec: 0 };
}
/**
 * Ce qu'Apollon vient de lancer (le widget « Lecteur » de l'accueil le dit) : quoi (le nom de la radio, de la liste ou du
 * morceau), où (l'enceinte de la box ; absent : cette machine), depuis quand (ms). Gardé en mémoire seulement, par dossier
 * d'Apollon (un Odin) : rien n'est écrit sur le disque, un redémarrage d'Odin l'oublie. Oublié à « Arrêter », et quand le
 * lecteur de cette machine s'arrête (fin de la lecture, ou tué de dehors). Une enceinte de la box n'est pas suivie : ce
 * qu'elle joue ensuite, Apollon ne le sait pas (le widget ne dit que « lancé à … »).
 */
export interface Lance { quoi: string; sorte: 'radio' | 'liste' | 'morceau'; enceinte?: string; depuis: number }
const lances = new Map<string, Lance & { n: number }>();
let numeroLance = 0;
/** Un nom venu de dehors (un fichier, une saisie) : sur une ligne, borné. */
const uneLigne = (t: string, n: number) => [...t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, n).join('');
type Suivi = (enceinte: string | undefined, fin?: Promise<unknown>) => void;
/** Garde ce qui vient d'être lancé ; l'oublie quand CE lecteur finit (un lecteur plus ancien qui finit n'efface rien). */
const suivre = (ctx: ModCtx, quoi: string, sorte: Lance['sorte']): Suivi => (enceinte, fin) => {
  const n = ++numeroLance, oublier = () => { if (lances.get(ctx.dir)?.n === n) lances.delete(ctx.dir); };
  lances.set(ctx.dir, { quoi: uneLigne(quoi, 120), sorte, ...(enceinte ? { enceinte: uneLigne(enceinte, 80) } : {}), depuis: ctx.now().getTime(), n });
  fin?.then(oublier, oublier);
};
/** Ce qu'Apollon a lancé et qui n'est ni arrêté ni fini, ou rien. */
export function enCours(ctx: Pick<ModCtx, 'dir'>): Lance | undefined {
  const l = lances.get(ctx.dir); if (!l) return undefined;
  return { quoi: l.quoi, sorte: l.sorte, ...(l.enceinte ? { enceinte: l.enceinte } : {}), depuis: l.depuis };
}
/**
 * Ses radios et ses listes, sans phrase ni adresse : seulement celles qu'un appui sur « jouer » lancerait VRAIMENT sous ce
 * nom (un nom sur une ligne, retrouvé tel quel). Une radio dont le nom en répète un autre, une liste vide, une liste au
 * nom d'une radio : pas proposées (« jouer » lancerait autre chose).
 */
export function aEcouter(ctx: Pick<ModCtx, 'settings'>): { radios: string[]; listes: Array<{ nom: string; morceaux: number }> } {
  const propre = (t: unknown): t is string => typeof t === 'string' && t !== '' && t.length <= 200 && uneLigne(t, 200) === t;
  const vus = new Set<string>(), r: string[] = [];
  for (const x of radios(ctx as ModCtx)) { const k = norm(s(x?.name)); if (vus.has(k)) continue; vus.add(k); if (propre(x?.name)) r.push(x.name); }
  const l = Object.entries(lists(ctx as ModCtx)).filter(([n, f]) => propre(n) && !vus.has(norm(n)) && Array.isArray(f) && f.length > 0).map(([nom, f]) => ({ nom, morceaux: f.length }));
  return { radios: r, listes: l };
}
async function play(ctx: ModCtx, url: string, where: string, suivi?: Suivi): Promise<string> {
  if (where && where !== 'ici') {
    const ha = s(ctx.settings.haUrl).replace(/\/$/, ''), token = process.env.HA_TOKEN; if (!ha || !token) throw new Error('relie ta box dans Apollon (même adresse que Midgard) pour jouer sur une enceinte');
    if (!/^https?:\/\//.test(url)) throw new Error('une enceinte ne peut lire qu\'une adresse web (radio) : les fichiers locaux se jouent « ici »');
    // L'enceinte est cherchée dans la box par son nom (ou son identifiant), comme pour les annonces.
    const players = (await haApi(ha, token, 'GET', '/states') as HaState[]).filter((x) => x.entity_id.startsWith('media_player.') && x.state !== 'unavailable');
    const q = norm(where), p = players.find((x) => x.entity_id === where) ?? players.find((x) => norm(`${x.entity_id} ${x.attributes.friendly_name ?? ''}`).includes(q));
    if (!p) throw new Error(`enceinte « ${where} » introuvable. Disponibles : ${players.map((x) => x.attributes.friendly_name ?? x.entity_id).slice(0, 12).join(', ') || 'aucune'}`);
    await haApi(ha, token, 'POST', '/services/media_player/play_media', { entity_id: p.entity_id, media_content_id: url, media_content_type: 'music' });
    suivi?.(s(p.attributes.friendly_name ?? p.entity_id));
    return `▶ Sur ${p.attributes.friendly_name ?? p.entity_id}.`;
  }
  // « -- » / « -i » : ce qui suit est toujours lu comme le morceau à jouer, jamais comme une option du lecteur.
  const bin = (await ctx.has('mpv')) ? ['mpv', ['--no-video', '--really-quiet', '--', url]] as const : (await ctx.has('ffplay')) ? ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-i', url]] as const : undefined;
  if (!bin) throw new Error('ni mpv ni ffplay sur cette machine');
  const fin = ctx.run(bin[0], [...bin[1]], { timeoutMs: 6 * 3600_000 });
  if (suivi) suivi(undefined, fin); else void fin;
  return '▶ Lecture sur cette machine.';
}

export const aegir: Module = {
  id: 'aegir', name: 'Apollon', family: 'Maison',
  what: 'Ta musique et tes radios : bibliothèque, recherche, listes, lecture sur les enceintes.',
  does: ['indexe tes dossiers de musique (titre, artiste, album, durée)', 'recherche par mots', 'listes de lecture', 'radios web', 'lecture sur une enceinte de la maison ou sur cette machine', 'arrêt de la lecture'],
  from: ['Navidrome', 'Jellyfin (musique)', 'Music Assistant', 'Mopidy'], upstream: ['navidrome/navidrome', 'music-assistant/server'],
  modes: ['Euterpe · radios'],
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
    { id: 'jouer', undo: () => ({ action: 'stop', input: {}, label: 'lecture arrêtée' }), label: 'Jouer', what: 'Un morceau, une liste ou une radio, ici ou sur une enceinte', params: [{ key: 'quoi', label: 'Morceau, liste ou radio', kind: 'text', required: true }, { key: 'ou', label: 'Où (ici, ou nom de l\'enceinte)', kind: 'text', default: 'ici' }], words: ['joue', 'mets', 'ecouter', 'écouter'], run: async (ctx, i) => {
      const q = s(i.quoi), where = s(i.ou) || 'ici';
      const radio = radios(ctx).find((r) => norm(r.name) === norm(q)); if (radio) return { text: await play(ctx, radio.url, where, suivre(ctx, radio.name, 'radio')) };
      const pl = lists(ctx)[q]; if (pl?.length) return { text: await play(ctx, pl[0], where, suivre(ctx, q, 'liste')) +` (liste « ${q} », ${pl.length} morceaux)` };
      const t = search(lib(ctx), q)[0]; if (!t) throw new Error(`rien trouvé pour « ${q} »`);
      const nom = `${t.artist ? `${t.artist} — ` : ''}${t.title}`;
      return { text: `${await play(ctx, t.file, where, suivre(ctx, nom, 'morceau'))} ${nom}` };
    } },
    { id: 'stop', label: 'Arrêter', what: 'Arrête la lecture sur cette machine', run: async (ctx) => { await ctx.run('pkill', ['-f', '^(mpv --no-video|ffplay -nodisp)']); lances.delete(ctx.dir); return { text: '⏹ Arrêté.' }; } },
    { id: 'liste', label: 'Créer une liste', what: 'Nom + recherche : les morceaux trouvés forment la liste', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'q', label: 'Recherche', kind: 'text', required: true }], run: (ctx, i) => { const r = search(lib(ctx), s(i.q)); ctx.saveSettings({ playlists: { ...lists(ctx), [s(i.nom)]: r.map((t) => t.file) } }); return { text: `📜 Liste « ${s(i.nom)} » : ${r.length} morceau(x).` }; } },
    { id: 'radio', label: 'Ajouter une radio', what: 'Nom + adresse du flux', params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'adresse', label: 'Adresse (http…)', kind: 'text', required: true }], run: (ctx, i) => { if (!/^https?:\/\//.test(s(i.adresse))) throw new Error('adresse http(s) attendue'); ctx.saveSettings({ radios: [...radios(ctx).filter((r) => r.name !== s(i.nom)), { name: s(i.nom), url: s(i.adresse).trim() }] }); return { text: `📻 ${s(i.nom)} ajoutée.` }; } },
  ],
  view(ctx) {
    const l = lib(ctx), artists = new Set(l.map((t) => t.artist).filter(Boolean)), albums = new Set(l.map((t) => t.album));
    const byArtist = [...artists].map((a) => ({ label: a, value: l.filter((t) => t.artist === a).length })).sort((a, b) => b.value - a.value).slice(0, 10);
    return {
      subtitle: `${l.length} morceau(x) · ${artists.size} artiste(s) · ${radios(ctx).length} radio(s)`,
      tabs: ['Apollon · bibliothèque', 'Euterpe · radios'],
      kpis: [{ label: 'Morceaux', value: String(l.length) }, { label: 'Albums', value: String(albums.size) }, { label: 'Listes', value: String(Object.keys(lists(ctx)).length) }],
      sections: [
        { kind: 'bars', title: 'Artistes les plus présents', items: byArtist },
        { kind: 'table', title: 'Radios', columns: ['Radio', 'Adresse'], empty: 'Aucune radio.', rows: radios(ctx).map((r) => ({ cells: [r.name, r.url], actions: [{ action: 'jouer', label: 'Écouter ici', input: { quoi: r.name, ou: 'ici' } }] })) },
        { kind: 'list', title: 'Listes de lecture', empty: 'Aucune liste.', items: Object.entries(lists(ctx)).map(([n, f]) => ({ title: n, detail: `${f.length} morceau(x)` })) },
      ],
      side: [{ kind: 'form', title: 'Ajouter un dossier', action: 'dossier', submit: 'Ajouter', params: aegir.actions.find((a) => a.id === 'dossier')?.params ?? [] }, { kind: 'form', title: 'Ajouter une radio', action: 'radio', submit: 'Ajouter', params: aegir.actions.find((a) => a.id === 'radio')?.params ?? [] }],
    };
  },
};
