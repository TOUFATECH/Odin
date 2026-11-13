// Hélios — les photos (comme Immich, en plus simple) : Odin range tes photos et vidéos par date à partir de leurs
// informations (EXIF : date de prise de vue, appareil, lieu), montre la frise par année et par mois avec les
// vignettes, trouve les doublons, et crée des albums. Tout reste chez toi : les photos ne bougent pas, Odin ne
// fait que les lire (aucun envoi, aucune IA extérieure). Lecteur EXIF fait maison.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import type { ModCtx, Module } from '../types.ts';

export interface Exif { date?: string; marque?: string; modele?: string; lat?: number; lon?: number; largeur?: number; hauteur?: number; vignette?: Buffer }
export interface Photo { chemin: string; octets: number; mtime: number; date: number; video: boolean; appareil?: string; lat?: number; lon?: number; empreinte?: string }
const s = (x: unknown) => (typeof x === 'string' ? x : x === undefined || x === null ? '' : String(x));
const PHOTO = /\.(jpe?g|png|heic|heif|webp|gif|tiff?|dng|cr2|nef|arw)$/i, VIDEO = /\.(mp4|mov|m4v|avi|mkv|3gp|mts)$/i;

/** Lit les informations EXIF d'un début de fichier JPEG (date, appareil, GPS, taille, vignette). Pur. */
export function lireExif(b: Buffer): Exif {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return {};
  let off = 2;
  while (off + 4 <= b.length && b[off] === 0xff) {
    const mk = b[off + 1], len = b.readUInt16BE(off + 2);
    if (mk === 0xe1 && b.subarray(off + 4, off + 10).toString('latin1') === 'Exif\0\0') { try { return tiff(b.subarray(off + 10, off + 2 + len)); } catch { return {}; } }   // fichier abîmé ou piégé : rien, jamais d'erreur
    if (mk === 0xda || mk === 0xd9) break; off += 2 + len;
  }
  return {};
}
const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
function tiff(t: Buffer): Exif {
  if (t.length < 8) return {};
  const le = t.toString('latin1', 0, 2) === 'II', u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o)), u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const ifd = (o: number): Map<number, { type: number; n: number; at: number }> => {
    const m = new Map<number, { type: number; n: number; at: number }>(); if (o < 8 || o + 2 > t.length) return m;
    const n = u16(o); for (let k = 0; k < n && o + 2 + k * 12 + 12 <= t.length; k++) { const e = o + 2 + k * 12, type = u16(e + 2), cnt = u32(e + 4), sz = (SIZE[type] ?? 1) * cnt; m.set(u16(e), { type, n: cnt, at: sz <= 4 ? e + 8 : u32(e + 8) }); }
    return m;
  };
  const str = (v?: { n: number; at: number }) => (v && v.at + v.n <= t.length ? t.toString('latin1', v.at, v.at + v.n).replace(/\0.*$/s, '').trim() : undefined);
  const num = (v?: { type: number; at: number }) => (!v ? undefined : v.type === 3 ? u16(v.at) : v.type === 4 ? u32(v.at) : undefined);
  const rat = (at: number) => { const d = u32(at + 4); return d ? u32(at) / d : 0; };
  const gps = (v?: { n: number; at: number }) => (v && v.n >= 3 && v.at + 24 <= t.length ? rat(v.at) + rat(v.at + 8) / 60 + rat(v.at + 16) / 3600 : undefined);
  const out: Exif = {}, i0 = ifd(u32(4));
  out.marque = str(i0.get(0x010f)); out.modele = str(i0.get(0x0110));
  const ex = ifd(num(i0.get(0x8769)) ?? 0); out.date = str(ex.get(0x9003)) ?? str(i0.get(0x0132)); out.largeur = num(ex.get(0xa002)); out.hauteur = num(ex.get(0xa003));
  const g = ifd(num(i0.get(0x8825)) ?? 0), lat = gps(g.get(2)), lon = gps(g.get(4));
  if (lat !== undefined && lon !== undefined && (lat || lon)) { out.lat = Math.round((str(g.get(1)) === 'S' ? -lat : lat) * 1e5) / 1e5; out.lon = Math.round((str(g.get(3)) === 'W' ? -lon : lon) * 1e5) / 1e5; }
  const n0 = u16(u32(4)), next = u32(4) + 2 + n0 * 12; if (next + 4 <= t.length) { const i1 = ifd(u32(next)), at = num(i1.get(0x0201)), n = num(i1.get(0x0202)); if (at && n && at + n <= t.length && t[at] === 0xff && t[at + 1] === 0xd8) out.vignette = Buffer.from(t.subarray(at, at + n)); }
  for (const k of Object.keys(out) as Array<keyof Exif>) if (out[k] === undefined || out[k] === '') delete out[k];
  return out;
}
/** « 2024:07:14 18:22:05 » → horodatage (heure locale). Pur. */
export function dateExif(d?: string): number | undefined {
  const m = /^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d):(\d\d)/.exec(d ?? ''); if (!m || m[1] === '0000') return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}
function debut(f: string, n = 256 * 1024): Buffer { const fd = openSync(f, 'r'); try { const b = Buffer.alloc(n); const r = readSync(fd, b, 0, n, 0); return b.subarray(0, r); } finally { closeSync(fd); } }
/** Une empreinte rapide pour les doublons : taille + début + fin du fichier. */
export function empreinte(f: string, octets: number): string {
  const fd = openSync(f, 'r'); try { const a = Buffer.alloc(Math.min(65536, octets)); readSync(fd, a, 0, a.length, 0); const z = Buffer.alloc(Math.min(65536, octets)); readSync(fd, z, 0, z.length, Math.max(0, octets - z.length)); return createHash('sha1').update(String(octets)).update(a).update(z).digest('hex').slice(0, 20); } finally { closeSync(fd); }
}
/** Parcourt les dossiers, photo par photo (un fichier déjà lu et inchangé n'est pas relu). */
function* parcourir(dossiers: string[], avant: Photo[]): Generator<Photo> {
  const old = new Map(avant.map((p) => [p.chemin, p])), vus = new Set<string>();
  function* walk(d: string, n: number): Generator<Photo> {
    if (n > 8) return; let names: string[] = []; try { names = readdirSync(d); } catch { return; }
    for (const e of names) {
      if (e.startsWith('.')) continue; const p = join(d, e); let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { yield* walk(p, n + 1); continue; }
      const video = VIDEO.test(e); if ((!video && !PHOTO.test(e)) || vus.has(p)) continue; vus.add(p);
      const o = old.get(p); if (o && o.octets === st.size && o.mtime === Math.round(st.mtimeMs)) { yield o; continue; }
      let x: Exif = {}; if (/\.jpe?g$/i.test(e)) try { x = lireExif(debut(p)); } catch { /* illisible */ }
      yield { chemin: p, octets: st.size, mtime: Math.round(st.mtimeMs), date: dateExif(x.date) ?? Math.round(st.mtimeMs), video, ...(x.marque || x.modele ? { appareil: appareil(x.marque, x.modele) } : {}), ...(x.lat !== undefined ? { lat: x.lat, lon: x.lon } : {}) };
    }
  }
  for (const d of dossiers) yield* walk(d, 0);
}
/** Met l'index à jour (un fichier déjà lu et inchangé n'est pas relu). */
export function indexer(dossiers: string[], avant: Photo[] = []): Photo[] {
  return [...parcourir(dossiers, avant)].sort((a, b) => b.date - a.date);
}
/** Le même rangement, sans figer Odin : il rend la main régulièrement (des milliers de photos peuvent prendre du temps). */
export async function indexerDoux(dossiers: string[], avant: Photo[] = []): Promise<Photo[]> {
  const out: Photo[] = []; let t = Date.now();
  for (const p of parcourir(dossiers, avant)) { out.push(p); if (Date.now() - t > 25) { await new Promise<void>((r) => setImmediate(r)); t = Date.now(); } }
  return out.sort((a, b) => b.date - a.date);
}
/** « Apple » + « iPhone 13 » → « Apple iPhone 13 » ; « Canon » + « Canon EOS R6 » → « Canon EOS R6 ». Pur. */
export const appareil = (marque?: string, modele?: string) => (modele && marque && modele.toLowerCase().startsWith(marque.toLowerCase().split(' ')[0]) ? modele : [marque, modele].filter(Boolean).join(' '));
/** Les doublons (même empreinte), le plus ancien gardé en premier. */
export function doublons(l: Photo[]): Photo[][] {
  const parTaille = new Map<number, Photo[]>(); for (const p of l) parTaille.set(p.octets, [...(parTaille.get(p.octets) ?? []), p]);
  const g = new Map<string, Photo[]>();
  for (const same of parTaille.values()) if (same.length > 1) for (const p of same) { try { p.empreinte ??= empreinte(p.chemin, p.octets); } catch { continue; } g.set(p.empreinte, [...(g.get(p.empreinte) ?? []), p]); }
  return [...g.values()].filter((x) => x.length > 1).map((x) => x.sort((a, b) => a.mtime - b.mtime));
}
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const mois = (t: number) => { const d = new Date(t); return `${MOIS[d.getMonth()]} ${d.getFullYear()}`; };
const dossiers = (ctx: ModCtx): string[] => { const l = (ctx.settings.dossiers as string[] | undefined) ?? []; return l.length ? l : ['Pictures', 'Images', 'Photos', 'DCIM'].map((d) => join(homedir(), d)).filter((d) => existsSync(d)); };
const lireIndex = (ctx: ModCtx): Photo[] => { try { return JSON.parse(readFileSync(join(ctx.dir, 'index.json'), 'utf8')) as Photo[]; } catch { return []; } };
const ecrireIndex = (ctx: ModCtx, l: Photo[]) => { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(join(ctx.dir, 'index.json.tmp'), JSON.stringify(l)); renameSync(join(ctx.dir, 'index.json.tmp'), join(ctx.dir, 'index.json')); };
// Les vignettes déjà lues sont gardées en mémoire (400 au plus) : la page ne relit pas les photos à chaque ouverture.
const vignettes = new Map<string, string | undefined>();
function vignette(p: Photo): string | undefined {
  if (!/\.jpe?g$/i.test(p.chemin)) return undefined;
  const k = `${p.chemin}|${p.mtime}`; if (vignettes.has(k)) return vignettes.get(k);
  let out: string | undefined; try { const v = lireExif(debut(p.chemin)).vignette; out = v && v.length < 40_000 ? `data:image/jpeg;base64,${v.toString('base64')}` : undefined; } catch { out = undefined; }
  if (vignettes.size >= 400) vignettes.delete(vignettes.keys().next().value as string); vignettes.set(k, out); return out;
}
export function chercher(l: Photo[], q: { annee?: number; mois?: number; appareil?: string; texte?: string; lieu?: boolean }): Photo[] {
  return l.filter((p) => { const d = new Date(p.date); return (!q.annee || d.getFullYear() === q.annee) && (!q.mois || d.getMonth() + 1 === q.mois) && (!q.appareil || (p.appareil ?? '').toLowerCase().includes(q.appareil.toLowerCase())) && (!q.texte || p.chemin.toLowerCase().includes(q.texte.toLowerCase())) && (!q.lieu || p.lat !== undefined); });
}
const taille = (o: number) => (o >= 1024 ** 3 ? `${(o / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${Math.max(1, Math.round(o / 1024 ** 2))} Mo`);

export const sol: Module = {
  id: 'sol', name: 'Hélios', family: 'Données',
  what: 'Tes photos et vidéos (comme Immich) : rangées par date grâce à leurs informations (date, appareil, lieu), la frise par année et par mois avec les vignettes, les doublons et tes albums. Tout reste chez toi.',
  does: ['index de tes dossiers de photos (et les tiens en plus), relu seulement quand un fichier change', 'date de prise de vue, appareil et lieu lus dans les photos (EXIF)', 'frise par année et par mois, avec les vignettes', 'recherche par année, mois, appareil, nom ou photos avec lieu', 'doublons trouvés (même contenu, noms différents)', 'albums à partir d\'une recherche', 'aucun envoi : rien ne quitte la maison'],
  from: ['Immich', 'PhotoPrism'], upstream: ['immich-app/immich', 'photoprism/photoprism'],
  words: ['mes photos', 'photothèque', 'phototheque', 'photos de famille', 'album photo', 'albums photo', 'doublons de photos', 'hélios', 'helios', 'immich', 'photoprism'],
  actions: [
    { id: 'indexer', label: 'Ranger les photos', what: 'Parcourt les dossiers et lit les informations des nouvelles photos', words: ['range mes photos', 'indexe mes photos'], run: async (ctx) => {
      const l = await indexerDoux(dossiers(ctx), lireIndex(ctx)); ecrireIndex(ctx, l); ctx.saveSettings({ dernier: ctx.now().getTime() });
      return { text: `📷 ${l.filter((p) => !p.video).length} photo(s) et ${l.filter((p) => p.video).length} vidéo(s) dans ${dossiers(ctx).length} dossier(s).`, data: { photos: l.length } };
    } },
    { id: 'dossier', label: 'Ajouter un dossier', what: 'Un dossier de photos en plus (disque, partage réseau monté…)', words: ['ajoute un dossier de photos'], params: [{ key: 'chemin', label: 'Chemin du dossier', kind: 'text', required: true }], run: (ctx, i) => {
      const d = s(i.chemin).trim(); if (!d || !existsSync(d) || !statSync(d).isDirectory()) throw new Error('dossier introuvable');
      if (/^([\\/]|[A-Za-z]:[\\/]?|\/(etc|proc|sys|dev|boot|usr|bin|sbin|var\/lib)(\/.*)?)$/.test(d)) throw new Error('choisis un dossier de photos précis (pas le disque entier ni un dossier du système)');
      ctx.saveSettings({ dossiers: [...new Set([...dossiers(ctx), d])] }); return { text: `📁 ${d} ajouté : lance « Ranger les photos ».` };
    } },
    { id: 'chercher', label: 'Chercher', what: 'Par année, mois, appareil, nom, ou les photos avec un lieu', words: ['cherche dans mes photos', 'retrouve mes photos'], read: true, params: [{ key: 'annee', label: 'Année', kind: 'number', default: '' }, { key: 'mois', label: 'Mois (1-12)', kind: 'number', default: '' }, { key: 'appareil', label: 'Appareil', kind: 'text', default: '' }, { key: 'texte', label: 'Dans le nom', kind: 'text', default: '' }, { key: 'lieu', label: 'Seulement avec un lieu', kind: 'boolean', default: false }],
      run: (ctx, i) => { const r = chercher(lireIndex(ctx), { annee: Number(i.annee) || undefined, mois: Number(i.mois) || undefined, appareil: s(i.appareil), texte: s(i.texte), lieu: i.lieu === true }); return { text: r.length ? `${r.length} trouvée(s) :\n${r.slice(0, 30).map((p) => `- ${new Date(p.date).toLocaleDateString('fr-FR')} · ${p.appareil ?? ''} · ${p.chemin}`).join('\n')}` : 'Aucune photo.', data: r.slice(0, 500) }; } },
    { id: 'doublons', label: 'Doublons', what: 'Les photos en double (même contenu)', words: ['doublons de photos', 'photos en double'], read: true, run: (ctx) => {
      const g = doublons(lireIndex(ctx)), perdu = g.reduce((a, x) => a + x.slice(1).reduce((b, p) => b + p.octets, 0), 0);
      return { text: g.length ? `${g.length} groupe(s), ${taille(perdu)} en double :\n${g.slice(0, 20).map((x) => `- ${x.map((p) => p.chemin).join('  =  ')}`).join('\n')}` : 'Aucun doublon.', data: g };
    } },
    { id: 'album', label: 'Créer un album', what: 'Un album à partir d\'une recherche (année, mois, appareil, nom)', words: ['crée un album photo'], params: [{ key: 'nom', label: 'Nom de l\'album', kind: 'text', required: true }, { key: 'annee', label: 'Année', kind: 'number', default: '' }, { key: 'mois', label: 'Mois', kind: 'number', default: '' }, { key: 'texte', label: 'Dans le nom', kind: 'text', default: '' }],
      run: (ctx, i) => {
        const nom = s(i.nom).trim().slice(0, 60); if (!nom) throw new Error('nom vide');
        const r = chercher(lireIndex(ctx), { annee: Number(i.annee) || undefined, mois: Number(i.mois) || undefined, texte: s(i.texte) }); if (!r.length) throw new Error('aucune photo pour cet album');
        const albums = (ctx.settings.albums as Record<string, string[]> | undefined) ?? {}; albums[nom] = r.map((p) => p.chemin); ctx.saveSettings({ albums });
        return { text: `🖼 Album « ${nom} » : ${r.length} photo(s).` };
      } },
  ],
  view(ctx) {
    const l = lireIndex(ctx), photos = l.filter((p) => !p.video), annees = [...new Set(l.map((p) => new Date(p.date).getFullYear()))].sort((a, b) => b - a);
    const albums = (ctx.settings.albums as Record<string, string[]> | undefined) ?? {};
    const mois6 = [...new Set(l.map((p) => mois(p.date)))].slice(0, 6);
    return {
      subtitle: l.length ? `${photos.length} photo(s) · ${l.length - photos.length} vidéo(s)` : 'Pas encore rangé : lance « Ranger les photos ».',
      kpis: [{ label: 'Photos', value: String(photos.length) }, { label: 'Vidéos', value: String(l.length - photos.length) }, { label: 'Appareils', value: String(new Set(l.map((p) => p.appareil).filter(Boolean)).size) }, { label: 'Avec un lieu', value: String(l.filter((p) => p.lat !== undefined).length) }, { label: 'Place', value: taille(l.reduce((a, p) => a + p.octets, 0)) }],
      sections: [
        ...(!l.length ? [{ kind: 'steps' as const, title: 'Mise en route', items: [{ title: 'Tes dossiers de photos', detail: dossiers(ctx).join(', ') || 'aucun trouvé : ajoute le tien', done: dossiers(ctx).length > 0 }, { title: 'Ranger les photos', done: false, action: 'indexer', button: 'Ranger' }] }] : []),
        ...mois6.map((m) => ({ kind: 'cards' as const, title: m.charAt(0).toUpperCase() + m.slice(1), items: l.filter((p) => mois(p.date) === m).slice(0, 12).map((p) => { const v = p.video ? undefined : vignette(p); return { ...(v ? { icon: v } : {}), title: p.chemin.split(/[\\/]/).pop() ?? p.chemin, sub: `${new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${p.appareil ? ` · ${p.appareil}` : ''}`, badge: p.video ? 'vidéo' : p.lat !== undefined ? '📍' : undefined }; }) })),
        { kind: 'bars', title: 'Par année', items: annees.map((a) => ({ label: String(a), value: l.filter((p) => new Date(p.date).getFullYear() === a).length })) },
      ],
      side: [{ kind: 'list', title: 'Albums', empty: 'Aucun album : crée-en un à partir d\'une recherche.', items: Object.entries(albums).map(([k, v]) => ({ title: k, detail: `${v.length} photo(s)` })) }, { kind: 'list', title: 'Dossiers', empty: 'Aucun dossier.', items: dossiers(ctx).map((d) => ({ title: d })) }],
    };
  },
  watch: { every: 6 * 3600, async run(ctx) { if (!dossiers(ctx).length) return; ecrireIndex(ctx, await indexerDoux(dossiers(ctx), lireIndex(ctx))); } },
};
