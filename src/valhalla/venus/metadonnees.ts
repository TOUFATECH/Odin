// Vénus · les fiches des titres (lot V3) : affiche, fond, résumé, genres, note, distribution (personnes et rôles),
// reprises de l'application Venus d'origine (dépôt TOUFATECH/Venus : server/metadata.js, server/posters.js,
// server/credits-free.js) et servies DEPUIS ODIN.
//
// Les mêmes sources que Venus, et les mêmes réglages que le catalogue des sorties (Réglages → Demandes) :
//   - avec la clé du grand catalogue (« Films : grand catalogue ») : la fiche complète des films et des séries
//     (recherche par titre et année, puis la fiche avec sa distribution), comme matchMovie / matchShow ;
//   - sans clé, « catalogue public des films » coché : la fiche publique du film (résumé, genres, note, distribution) ;
//   - sans clé, « programme télé des séries » (ou des animés) coché : la fiche publique de la série.
// Rien n'est lu tant que le propriétaire n'a pas ENREGISTRÉ ce réglage : sans lui, Vénus n'a que les vignettes tirées
// des vidéos et ce que dit le nom du fichier.
//
// Sûreté : le réseau est celui du catalogue (celui de Comète : jamais la machine d'Odin ni la maison, aucune
// redirection), chaque lecture est bornée en temps et en taille ; tout texte venu d'Internet est nettoyé (aucune balise)
// et coupé ; une image n'est gardée que si c'est une VRAIE image (JPEG, PNG ou WebP lus à leurs premiers octets,
// dimensions lues dans l'en-tête et bornées : pas de bombe de décompression, 8 Mo au plus, aucun script dedans), venue
// d'un des hôtes d'images de ces catalogues. Elle est copiée une fois dans le dossier de Vénus, puis servie par Odin :
// la page ne charge jamais une image d'Internet, et ne reçoit aucune adresse extérieure ni aucun chemin de la machine.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Enr, MagasinVenus } from './base.ts';
import { norm } from './bibliotheque.ts';
import { ADRESSES, reglagesCatalogue, texte, type ReglagesCatalogue } from './catalogue/index.ts';
import type { Fetch } from './reseau.ts';
import { dechiffrerChamp } from '../../vault.ts';

const s = (v: unknown) => String(v ?? '').trim();
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const entier = (v: unknown, min: number, max: number): number | undefined => { const x = Number(v); return Number.isInteger(x) && x >= min && x <= max ? x : undefined; };
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

// ---------------------------------------------------------------- images : vérifiées, gardées, servies par Odin
/** Taille maximale d'une image téléchargée (octets). */
export const IMAGE_MAX = 8 * 1024 * 1024;
/** Côté maximal et nombre maximal de pixels d'une image (au-delà : refusée, une bombe de décompression ne passe pas). */
export const COTE_MAX = 8000, PIXELS_MAX = 40_000_000;
/** Les hôtes d'images des catalogues de Venus (affiches, fonds, photos). Aucun autre n'est lu. */
export const HOTES_IMAGES = /(^|\.)(image\.tmdb\.org|images\.metahub\.space|static\.tvmaze\.com)$/;
export type GenreImage = 'affiche' | 'fond' | 'photo' | 'vignette';
export interface ImageLue { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp'; largeur: number; hauteur: number }

/** Les dimensions d'un JPEG, lues dans son en-tête (segment SOF). Pur. */
function dimsJpeg(b: Buffer): [number, number] | undefined {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const n = b.readUInt16BE(i + 2);
    if (n < 2) return undefined;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    if (m === 0xda || m === 0xd9) return undefined;
    i += 2 + n;
  }
  return undefined;
}
/** Les dimensions d'un WebP (VP8, VP8L ou VP8X). Pur. */
function dimsWebp(b: Buffer): [number, number] | undefined {
  if (b.length < 30) return undefined;
  const c = b.toString('ascii', 12, 16);
  if (c === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (c === 'VP8L' && b[20] === 0x2f) { const x = b.readUInt32LE(21); return [(x & 0x3fff) + 1, ((x >> 14) & 0x3fff) + 1]; }
  if (c === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  return undefined;
}
/**
 * Est-ce une VRAIE image qu'Odin peut garder et servir ? JPEG, PNG ou WebP reconnus à leurs premiers octets (jamais
 * SVG, HTML ni script), dimensions lues dans l'en-tête et bornées (côté ≤ 8000, 40 millions de pixels au plus : une
 * bombe de décompression est refusée sans être décodée), 8 Mo au plus, aucun morceau de page ou de script dedans. Pur.
 */
export function verifierImage(b: Buffer): ImageLue | { refus: string } {
  if (b.length < 64) return { refus: 'trop petite pour être une image' };
  if (b.length > IMAGE_MAX) return { refus: 'image trop lourde' };
  let lu: Omit<ImageLue, 'largeur' | 'hauteur'> | undefined, dims: [number, number] | undefined;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { lu = { mime: 'image/jpeg', ext: 'jpg' }; dims = dimsJpeg(b); }
  else if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.toString('ascii', 12, 16) === 'IHDR') { lu = { mime: 'image/png', ext: 'png' }; dims = [b.readUInt32BE(16), b.readUInt32BE(20)]; }
  else if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') { lu = { mime: 'image/webp', ext: 'webp' }; dims = dimsWebp(b); }
  if (!lu) return { refus: "ce n'est pas une image (JPEG, PNG ou WebP)" };
  if (!dims || !(dims[0] > 0) || !(dims[1] > 0)) return { refus: 'dimensions illisibles' };
  if (dims[0] > COTE_MAX || dims[1] > COTE_MAX || dims[0] * dims[1] > PIXELS_MAX) return { refus: 'image démesurée (bombe de décompression ?)' };
  // Une image « polyglotte » (une page ou un script caché dans l'image) est refusée.
  const bas = b.toString('latin1').toLowerCase();
  if (bas.includes('<script') || bas.includes('<html') || bas.includes('javascript:')) return { refus: 'image piégée (contient une page ou un script)' };
  return { ...lu, largeur: dims[0], hauteur: dims[1] };
}

/** Le dossier des images gardées par Odin (dans le dossier de Vénus). */
export const dossierImages = (mag: MagasinVenus): string => join(mag.dir, 'images');
const ID_IMAGE = /^[a-f0-9]{32}$/;
/** Le fichier d'une image gardée, s'il est là (jamais un chemin venu de dehors : l'identifiant est vérifié). */
export function fichierImage(mag: MagasinVenus, id: string): { chemin: string; mime: string } | undefined {
  if (!ID_IMAGE.test(id)) return undefined;
  const e = mag.get('images', id); if (!e) return undefined;
  const ext = s(e.data.ext); if (!['jpg', 'png', 'webp'].includes(ext)) return undefined;
  const chemin = join(dossierImages(mag), `${id}.${ext}`);
  return existsSync(chemin) ? { chemin, mime: s(e.data.mime) } : undefined;
}
/** Garde une image déjà en mémoire (vérifiée ici) : rend son identifiant, ou rien. */
export function garderImage(mag: MagasinVenus, cle: string, b: Buffer, genre: GenreImage): string | undefined {
  const v = verifierImage(b); if ('refus' in v) return undefined;
  const id = sha(cle).slice(0, 32), dir = dossierImages(mag);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = join(dir, `${id}.${v.ext}`), tmp = `${f}.tmp`;
  writeFileSync(tmp, b, { mode: 0o600 }); renameSync(tmp, f);
  mag.poser('images', id, { genre, ext: v.ext, mime: v.mime, largeur: v.largeur, hauteur: v.hauteur, taille: b.length, quand: Date.now() });
  return id;
}
/** Une image d'Internet, téléchargée UNE fois (si elle est déjà gardée, rien n'est relu) : rend son identifiant. */
export async function telechargerImage(mag: MagasinVenus, f: Fetch, url: string, genre: GenreImage): Promise<string | undefined> {
  let u: URL; try { u = new URL(url); } catch { return undefined; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !HOTES_IMAGES.test(u.hostname)) return undefined;
  const id = sha(u.href).slice(0, 32); if (fichierImage(mag, id)) return id;
  try {
    const r = await f(u.href, { redirect: 'manual', headers: { accept: 'image/jpeg, image/png, image/webp' }, signal: AbortSignal.timeout(20_000) });
    const type = s(r.headers.get('content-type')).toLowerCase(), annonce = Number(r.headers.get('content-length') || 0);
    if (r.status !== 200 || !/^image\/(jpeg|png|webp)\b/.test(type) || annonce > IMAGE_MAX || !r.body) { await r.body?.cancel().catch(() => undefined); return undefined; }
    const lecteur = r.body.getReader(), parts: Uint8Array[] = []; let n = 0;
    for (;;) { const { done, value } = await lecteur.read(); if (done) break; n += value.length; if (n > IMAGE_MAX) { await lecteur.cancel().catch(() => undefined); return undefined; } parts.push(value); }
    return garderImage(mag, u.href, Buffer.concat(parts), genre);
  } catch { return undefined; }
}

// ---------------------------------------------------------------- fiches
/** Une personne de la distribution d'un titre (dans la fiche). */
export interface Role { personne: string; nom: string; role: string; photo?: string }
/** La fiche d'un titre, gardée sur l'œuvre (champ `fiche`) dans VENUS_ODIN. */
export interface FicheTitre {
  source: 'grand' | 'films' | 'series'; titre?: string; original?: string; annee?: number; resume?: string; accroche?: string;
  genres: string[]; note?: number; noteCritiques?: number; affiche?: string; fond?: string; distribution: Role[]; equipe: Role[]; quand: number;
}
/** Le titre de la bibliothèque est-il assez proche d'un résultat (mots communs, comme closeEnough de Venus) ? Pur. */
export function proche(a: string, b: string): boolean {
  const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true;
  const STOP = new Set(['the', 'a', 'an', 'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'of', 'and', 'et', 'no', 'wo', 'ni', 'to', 'ga', 'wa']);
  const sx = x.split(' ').filter((w) => !STOP.has(w)), sy = y.split(' ').filter((w) => !STOP.has(w));
  if (!sx.length || !sy.length) return false;
  const commun = sx.filter((w) => sy.includes(w)).length, court = Math.min(sx.length, sy.length), long = Math.max(sx.length, sy.length);
  return commun >= (court >= 4 ? court - 1 : court) && commun / long >= 0.7;
}
/** Le meilleur résultat : titre proche, même année (à un an près), puis le rang. Pur. */
function meilleur<X>(l: X[], titre: string, annee: number | undefined, nom: (x: X) => string[], an: (x: X) => number | undefined): X | undefined {
  const ok = l.filter((x) => nom(x).some((n) => proche(n, titre)));
  if (!annee) return ok[0];
  return ok.find((x) => an(x) === annee) ?? ok.find((x) => Math.abs((an(x) ?? 0) - annee) <= 1) ?? ok.find((x) => !an(x));
}
const MAX_JSON = 2 * 1024 * 1024;
/** Une réponse JSON bornée (temps, taille), sans redirection. */
async function lireJson(f: Fetch, url: string, init: RequestInit = {}): Promise<unknown> {
  const r = await f(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json', ...(init.headers as Record<string, string> ?? {}) } });
  if (r.status === 404) { await r.body?.cancel().catch(() => undefined); return undefined; }
  if (r.status !== 200 || !r.body) { await r.body?.cancel().catch(() => undefined); throw new Error(`le catalogue répond ${r.status}`); }
  const lecteur = r.body.getReader(), parts: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await lecteur.read(); if (done) break; n += value.length; if (n > MAX_JSON) { await lecteur.cancel().catch(() => undefined); throw new Error('réponse trop grande'); } parts.push(value); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown; } catch { throw new Error('réponse illisible'); }
}
const lireCleCatalogue = (mag: MagasinVenus): string | undefined => {
  try { const o = JSON.parse(readFileSync(join(mag.dir, 'catalogue-cle.json'), 'utf8')) as { cle?: string }; return o.cle ? dechiffrer(mag, o.cle) : undefined; } catch { return undefined; }
};
const dechiffrer = (m: MagasinVenus, c: string): string | undefined => { try { return dechiffrerChamp(m.home, c); } catch { return undefined; } };

/** Le réglage du catalogue a-t-il été ENREGISTRÉ par le propriétaire ? (le défaut implicite ne suffit pas ici) */
export const reglageEnregistre = (mag: MagasinVenus): boolean => !!mag.get('acq_reglages', 'catalogue');
/** La source des fiches pour une œuvre, d'après le réglage (rien = aucune lecture). Pur à partir du réglage. */
export function sourceFiche(r: ReglagesCatalogue, type: 'film' | 'serie', anime: boolean, enregistre: boolean, aCle: boolean): FicheTitre['source'] | undefined {
  if (!enregistre) return undefined;
  if (r.films === 'cle' && aCle) return 'grand';
  if (type === 'film') return r.films === 'public' ? 'films' : undefined;
  return r.series || (anime && r.animes) ? 'series' : undefined;
}

const nomsPersonne = (l: unknown, n: number, role: (x: Record<string, unknown>) => string, photo: (x: Record<string, unknown>) => string | undefined) => {
  const vus = new Set<string>(), out: Array<{ nom: string; role: string; photoUrl?: string }> = [];
  for (const x0 of liste(l)) {
    const x = objet(x0), nom = texte(x.name ?? objet(x.person).name, 120); if (!nom || vus.has(norm(nom))) continue;
    vus.add(norm(nom)); const p = photo(x); out.push({ nom, role: texte(role(x), 120), ...(p ? { photoUrl: p } : {}) }); if (out.length >= n) break;
  }
  return out;
};
const tmdbImg = (taille: string, p: unknown) => (/^\/[A-Za-z0-9_-]{1,100}\.(jpg|png|webp)$/.test(s(p)) ? `https://image.tmdb.org/t/p/${taille}${s(p)}` : undefined);
interface Brute { titre?: string; original?: string; annee?: number; resume?: string; accroche?: string; genres: string[]; note?: number; noteCritiques?: number; afficheUrl?: string; fondUrl?: string; distribution: Array<{ nom: string; role: string; photoUrl?: string }>; equipe: Array<{ nom: string; role: string; photoUrl?: string }> }

/** Le grand catalogue (avec la clé) : recherche, puis la fiche et sa distribution (metadata.js : matchMovie, matchShow). */
async function depuisGrand(f: Fetch, cle: string, langue: string, type: 'film' | 'serie', titre: string, annee?: number): Promise<Brute | undefined> {
  const t = type === 'film' ? 'movie' : 'tv';
  const url = (chemin: string, p: Record<string, string>) => { const u = new URL(`${ADRESSES.grand}${chemin}`); for (const [k, v] of Object.entries(p)) if (v) u.searchParams.set(k, v); if (cle.length <= 40) u.searchParams.set('api_key', cle); return u.toString(); };
  const entete = cle.length > 40 ? { headers: { authorization: `Bearer ${cle}` } } : {};
  const champAn = type === 'film' ? 'year' : 'first_air_date_year';
  let res = liste(objet(await lireJson(f, url(`/search/${t}`, { query: titre, language: langue, include_adult: 'false', [champAn]: annee ? String(annee) : '' }), entete)).results);
  if (!res.length && annee) res = liste(objet(await lireJson(f, url(`/search/${t}`, { query: titre, language: langue, include_adult: 'false' }), entete)).results);
  const an = (x: Record<string, unknown>) => entier(s(x.release_date || x.first_air_date).slice(0, 4), 1880, 2100);
  const best = meilleur(res.slice(0, 10).map(objet), titre, annee, (x) => [s(x.title || x.name), s(x.original_title || x.original_name)], an);
  const id = best && entier(best.id, 1, 1e10); if (!id) return undefined;
  const d = objet(await lireJson(f, url(`/${t}/${id}`, { language: langue, append_to_response: 'credits' }), entete));
  const credits = objet(d.credits);
  const note = Number(d.vote_average);
  return {
    titre: texte(d.title || d.name, 200), original: texte(d.original_title || d.original_name, 200), annee: entier(s(d.release_date || d.first_air_date).slice(0, 4), 1880, 2100),
    resume: texte(d.overview, 1200), accroche: texte(d.tagline, 200), genres: liste(d.genres).map((g) => texte(objet(g).name, 40)).filter(Boolean).slice(0, 6),
    ...(Number(d.vote_count) > 3 && note > 0 && note <= 10 ? { note: Math.round(note * 10) / 10 } : {}),
    afficheUrl: tmdbImg('w500', d.poster_path), fondUrl: tmdbImg('w1280', d.backdrop_path),
    distribution: nomsPersonne(credits.cast, 20, (x) => s(x.character), (x) => tmdbImg('w185', x.profile_path)),
    equipe: nomsPersonne(liste(credits.crew).filter((x) => /^(Director|Screenplay|Writer|Creator|Original Music Composer)$/.test(s(objet(x).job))), 6, (x) => s(x.job) === 'Director' ? 'Réalisation' : s(x.job) === 'Original Music Composer' ? 'Musique' : 'Scénario', (x) => tmdbImg('w185', x.profile_path)),
  };
}
/** Le catalogue public des films (sans clé) : recherche, puis la fiche publique du film (posters.js, credits-free.js). */
async function depuisFilmsPublic(f: Fetch, titre: string, annee?: number): Promise<Brute | undefined> {
  const d = objet(await lireJson(f, `${ADRESSES.filmsPublic}/catalog/movie/top/search=${encodeURIComponent(titre)}.json`));
  const an = (x: Record<string, unknown>) => entier(s(x.releaseInfo || x.year).slice(0, 4), 1880, 2100);
  const best = meilleur(liste(d.metas).slice(0, 20).map(objet), titre, annee, (x) => [s(x.name)], an);
  const tt = best && /^tt\d{1,12}$/.test(s(best.imdb_id || best.id)) ? s(best.imdb_id || best.id) : undefined; if (!tt) return undefined;
  const m = objet(objet(await lireJson(f, `${ADRESSES.filmsPublic}/meta/movie/${tt}.json`)).meta);
  const castBrut = liste(m.credits_cast).length ? m.credits_cast : liste(m.cast).map((name) => ({ name }));
  const note = Number.parseFloat(s(m.imdbRating));
  return {
    titre: texte(m.name, 200), annee: entier(s(m.releaseInfo || m.year).slice(0, 4), 1880, 2100) ?? (best ? an(best) : undefined), resume: texte(m.description, 1200),
    genres: liste(m.genres ?? m.genre).map((g) => texte(g, 40)).filter(Boolean).slice(0, 6), ...(note > 0 && note <= 10 ? { noteCritiques: Math.round(note * 10) / 10 } : {}),
    afficheUrl: `https://images.metahub.space/poster/medium/${tt}/img`, fondUrl: `https://images.metahub.space/background/medium/${tt}/img`,
    distribution: nomsPersonne(castBrut, 20, (x) => s(x.character), (x) => tmdbImg('w185', x.profile_path)),
    equipe: nomsPersonne(liste(m.credits_crew).length ? liste(m.credits_crew).filter((x) => /^(Director|Screenplay|Writer)$/.test(s(objet(x).job))) : liste(m.director).map((name) => ({ name, job: 'Director' })), 6, (x) => (s(x.job) === 'Director' ? 'Réalisation' : 'Scénario'), (x) => tmdbImg('w185', x.profile_path)),
  };
}
const tvmazeImg = (v: unknown) => { const u = s(objet(v).original || objet(v).medium); return /^https:\/\/static\.tvmaze\.com\//.test(u) ? u : undefined; };
/** Le programme télé public des séries (sans clé) : la série, sa distribution, son fond (posters.js : findShow, findShowBackdrop). */
async function depuisSeries(f: Fetch, titre: string, annee?: number, anime = false): Promise<Brute | undefined> {
  const l = liste(await lireJson(f, `${ADRESSES.series}/search/shows?q=${encodeURIComponent(titre)}`)).map((x) => objet(objet(x).show))
    .filter((x) => !anime || s(x.type) === 'Animation' || s(x.language) === 'Japanese' || liste(x.genres).includes('Anime'));
  const best = meilleur(l.slice(0, 10), titre, annee, (x) => [s(x.name)], (x) => entier(s(x.premiered).slice(0, 4), 1880, 2100));
  const id = best && entier(best.id, 1, 1e9); if (!id) return undefined;
  const d = objet(await lireJson(f, `${ADRESSES.series}/shows/${id}?embed[]=cast&embed[]=crew`)), e = objet(d._embedded);
  const images = liste(await lireJson(f, `${ADRESSES.series}/shows/${id}/images`).catch(() => [])).map(objet);
  const fond = images.filter((i) => s(i.type) === 'background').map((i) => objet(objet(i.resolutions).original)).sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))[0];
  const note = Number(objet(d.rating).average);
  return {
    titre: texte(d.name, 200), annee: entier(s(d.premiered).slice(0, 4), 1880, 2100), resume: texte(d.summary, 1200), genres: liste(d.genres).map((g) => texte(g, 40)).filter(Boolean).slice(0, 6),
    ...(note > 0 && note <= 10 ? { note: Math.round(note * 10) / 10 } : {}), afficheUrl: tvmazeImg(d.image), fondUrl: fond && /^https:\/\/static\.tvmaze\.com\//.test(s(fond.url)) ? s(fond.url) : undefined,
    distribution: nomsPersonne(liste(e.cast).map((c) => ({ name: objet(objet(c).person).name, character: objet(objet(c).character).name, image: objet(objet(c).person).image })), 20, (x) => s(x.character), (x) => tvmazeImg(x.image)),
    equipe: nomsPersonne(liste(e.crew).filter((c) => /Creator|Developer/i.test(s(objet(c).type))).map((c) => ({ name: objet(objet(c).person).name, image: objet(objet(c).person).image })), 4, () => 'Création', (x) => tvmazeImg(x.image)),
  };
}

/** L'identifiant d'une personne (par son nom simplifié) : le même pour tous les titres où elle apparaît. Pur. */
export const idPersonne = (nom: string): string => `pe-${sha(norm(nom) || nom).slice(0, 24)}`;
/** Range une personne et son rôle dans un titre (collection `personnes`). */
function poserPersonne(mag: MagasinVenus, oeuvreId: string, p: { nom: string; role: string }, photo: string | undefined): string {
  const id = idPersonne(p.nom), avant = mag.get('personnes', id)?.data ?? {};
  const titres = { ...objet(avant.titres), [oeuvreId]: p.role };
  mag.poser('personnes', id, { nom: p.nom, ...(photo ?? avant.photo ? { photo: photo ?? avant.photo } : {}), titres });
  return id;
}

export type Resultat = 'fait' | 'introuvable' | 'sans_source' | 'erreur';
/**
 * Lit la fiche d'UNE œuvre (film ou série) selon le réglage, télécharge ses images (une fois, vérifiées), range la
 * fiche sur l'œuvre et les personnes dans `personnes`. Sans réglage enregistré : rien n'est lu (« sans_source »).
 */
export async function enrichir(mag: MagasinVenus, f: Fetch, oeuvreId: string): Promise<Resultat> {
  const o = mag.get('oeuvres', oeuvreId); if (!o || (o.data.type !== 'film' && o.data.type !== 'serie')) return 'sans_source';
  const type = o.data.type as 'film' | 'serie', anime = s(o.data.categorie) === 'anime';
  const r = reglagesCatalogue(mag), cle = r.films === 'cle' ? lireCleCatalogue(mag) : undefined;
  const src = sourceFiche(r, type, anime, reglageEnregistre(mag), !!cle); if (!src) return 'sans_source';
  const titre = s(o.data.titre), annee = entier(o.data.annee, 1880, 2100);
  const noter = (etat: string) => { const x = mag.get('oeuvres', oeuvreId); if (x) mag.poser('oeuvres', oeuvreId, { ...x.data, fiche_essai: { etat, source: src, n: (Number(objet(x.data.fiche_essai).n) || 0) + 1, quand: Date.now() } }); };
  let b: Brute | undefined;
  try { b = src === 'grand' ? await depuisGrand(f, cle!, r.langue, type, titre, annee) : src === 'films' ? await depuisFilmsPublic(f, titre, annee) : await depuisSeries(f, titre, annee, anime); }
  catch { noter('erreur'); return 'erreur'; }
  if (!b) { noter('introuvable'); return 'introuvable'; }
  const affiche = b.afficheUrl ? await telechargerImage(mag, f, b.afficheUrl, 'affiche') : undefined;
  const fond = b.fondUrl ? await telechargerImage(mag, f, b.fondUrl, 'fond') : undefined;
  const ranger = async (l: Brute['distribution'], photos: number): Promise<Role[]> => {
    const out: Role[] = [];
    for (const [k, p] of l.entries()) {
      const photo = p.photoUrl && k < photos ? await telechargerImage(mag, f, p.photoUrl, 'photo') : undefined;
      const id = poserPersonne(mag, oeuvreId, p, photo);
      out.push({ personne: id, nom: p.nom, role: p.role, ...(photo ? { photo } : {}) });
    }
    return out;
  };
  const distribution = await ranger(b.distribution, 12), equipe = await ranger(b.equipe, 4);
  const fiche: FicheTitre = { source: src, ...(b.titre ? { titre: b.titre } : {}), ...(b.original ? { original: b.original } : {}), ...(b.annee ? { annee: b.annee } : {}), ...(b.resume ? { resume: b.resume } : {}), ...(b.accroche ? { accroche: b.accroche } : {}),
    genres: b.genres, ...(b.note ? { note: b.note } : {}), ...(b.noteCritiques ? { noteCritiques: b.noteCritiques } : {}), ...(affiche ? { affiche } : {}), ...(fond ? { fond } : {}), distribution, equipe, quand: Date.now() };
  const x = mag.get('oeuvres', oeuvreId)!;
  mag.poser('oeuvres', oeuvreId, { ...x.data, fiche, fiche_essai: { etat: 'fait', source: src, n: 0, quand: Date.now() } });
  return 'fait';
}

/** Une œuvre attend-elle sa fiche ? (pas encore lue, ou un échec ancien : 3 essais au plus, espacés d'un jour). Pur. */
export function attendFiche(o: Enr, maintenant = Date.now()): boolean {
  if (o.data.type !== 'film' && o.data.type !== 'serie') return false;
  if (o.data.fiche) return false;
  const e = objet(o.data.fiche_essai), n = Number(e.n) || 0;
  return n === 0 || (n < 3 && maintenant - (Number(e.quand) || 0) > 864e5);
}
let enCours: Promise<void> | undefined;
/**
 * Lance (en fond, UNE œuvre à la fois, 20 au plus par passage) la lecture des fiches qui manquent. Sans réglage
 * enregistré : rien. Rend le nombre d'œuvres qui attendent (la page se rafraîchit tant qu'il y en a).
 */
export function lancerFiches(mag: MagasinVenus, f: () => Fetch): number {
  if (!reglageEnregistre(mag)) return 0;
  const r = reglagesCatalogue(mag), aCle = r.films === 'cle' && !!lireCleCatalogue(mag);
  const attente = mag.liste('oeuvres').filter((o) => attendFiche(o) && sourceFiche(r, o.data.type as 'film' | 'serie', s(o.data.categorie) === 'anime', true, aCle));
  if (!attente.length || enCours) return attente.length;
  enCours = (async () => {
    const reseau = f();
    for (const o of attente.slice(0, 20)) { if ((await enrichir(mag, reseau, o.id)) === 'erreur') break; }
  })().catch(() => undefined).finally(() => { enCours = undefined; });
  return attente.length;
}
/** (essais) attendre la fin du passage en cours. */
export const attendreFiches = async (): Promise<void> => { while (enCours) await enCours; };

// ---------------------------------------------------------------- ce que la page reçoit (aucune adresse extérieure)
/** L'adresse d'Odin d'une image gardée. */
export const urlImage = (id: string | undefined): string | undefined => (id && ID_IMAGE.test(id) ? `/venus/api/image/${id}` : undefined);
/** La fiche d'une œuvre pour la page : textes nettoyés, images d'Odin seulement. */
export function fichePage(mag: MagasinVenus, o: Enr): Record<string, unknown> | undefined {
  const fi = o.data.fiche as FicheTitre | undefined; if (!fi) return undefined;
  const ok = (id?: string) => (id && fichierImage(mag, id) ? urlImage(id) : undefined);
  const gens = (l: Role[] | undefined) => liste(l).map((x0) => { const x = x0 as Role; return { id: s(x.personne), name: s(x.nom), role: s(x.role), ...(ok(x.photo) ? { photo: ok(x.photo) } : {}) }; }).filter((x) => /^pe-[a-f0-9]{24}$/.test(x.id) && x.name);
  return { ...(fi.resume ? { overview: fi.resume } : {}), ...(fi.accroche ? { tagline: fi.accroche } : {}), genres: liste(fi.genres).map((g) => s(g)).filter(Boolean),
    ...(fi.note ? { vote: fi.note } : {}), ...(fi.noteCritiques ? { critics: fi.noteCritiques } : {}), ...(fi.original ? { originalTitle: fi.original } : {}),
    ...(ok(fi.affiche) ? { poster: ok(fi.affiche) } : {}), ...(ok(fi.fond) ? { backdrop: ok(fi.fond) } : {}), cast: gens(fi.distribution), crew: gens(fi.equipe) };
}
/** La fiche d'une personne : son nom, sa photo, et les titres de la bibliothèque où elle apparaît (avec son rôle). */
export function personne(mag: MagasinVenus, id: string): { id: string; name: string; photo?: string; titres: Array<{ id: string; role: string }> } | undefined {
  if (!/^pe-[a-f0-9]{24}$/.test(id)) return undefined;
  const p = mag.get('personnes', id); if (!p) return undefined;
  const titres = Object.entries(objet(p.data.titres)).filter(([oid]) => mag.get('oeuvres', oid)).map(([oid, role]) => ({ id: oid, role: s(role) }));
  const photo = s(p.data.photo) && fichierImage(mag, s(p.data.photo)) ? urlImage(s(p.data.photo)) : undefined;
  return { id, name: s(p.data.nom), ...(photo ? { photo } : {}), titres };
}
/** (essais) retirer toutes les images gardées. */
export function viderImages(mag: MagasinVenus): void { rmSync(dossierImages(mag), { recursive: true, force: true }); mag.vider('images'); }
