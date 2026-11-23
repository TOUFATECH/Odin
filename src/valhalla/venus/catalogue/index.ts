// Vénus · le catalogue des sorties (« À venir » et « Nouveautés »), repris de l'application Venus d'origine
// (dépôt TOUFATECH/Venus : server/upcoming.js et server/discover.js), sans aucun serveur à côté.
//
// Les mêmes sources que Venus, chacune RÉGLÉE PAR LE PROPRIÉTAIRE. Par défaut (sa réponse du 23/11) : le catalogue
// public des films SANS clé est coché, pour que « À venir » des films se remplisse dès le départ ; le reste n'est lu
// que s'il le coche (« Aucun » pour les films : plus rien n'est lu) :
//   - séries : le programme télé public (sans clé) — ce qui se diffuse aux États-Unis, en France et sur les plateformes ;
//   - animés : le programme de diffusion public des animés (sans clé) ;
//   - films  : le catalogue public des films (sans clé), ou le grand catalogue des films et séries avec SA clé
//     (gratuite) ; la clé sert aussi aux Nouveautés des films et des séries, comme dans Venus.
// La clé ne va jamais dans la base : chiffrée avec la clé de la machine, dans un fichier à part (catalogue-cle.json,
// mode 0o600) ; elle n'apparaît dans aucun texte rendu.
//
// Sûreté : chaque réponse est une DONNÉE (taille bornée, temps borné, champs nettoyés de toute balise et coupés),
// jamais du code de page ; aucune image extérieure n'est transmise à la page (elle ne charge rien d'ailleurs) ; le
// réseau est celui de Comète (jamais la machine d'Odin ni le réseau de la maison, aucune redirection suivie).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chiffrerChamp, dechiffrerChamp } from '../../../vault.ts';
import type { MagasinVenus } from '../base.ts';
import { norm } from '../bibliotheque.ts';
import type { Fetch } from '../reseau.ts';

/** Les adresses des catalogues publics (celles du dépôt Venus). */
export const ADRESSES = {
  series: 'https://api.tvmaze.com',
  animes: 'https://graphql.anilist.co',
  filmsPublic: 'https://v3-cinemeta.strem.io',
  grand: 'https://api.themoviedb.org/3',
} as const;

export type Genre = 'movie' | 'show' | 'anime';
export type ModeFilms = 'aucun' | 'public' | 'cle';
export interface ReglagesCatalogue { series: boolean; animes: boolean; films: ModeFilms; aCle: boolean; langue: string }
const s = (v: unknown) => String(v ?? '').trim();
const oui = (v: unknown) => v === true || v === 'true' || v === 'oui' || v === 'on' || v === 1 || v === '1';
const fichierCle = (dir: string) => join(dir, 'catalogue-cle.json');

function lireCle(mag: MagasinVenus): string | undefined {
  try { const o = JSON.parse(readFileSync(fichierCle(mag.dir), 'utf8')) as { cle?: string }; return o.cle ? dechiffrerChamp(mag.home, o.cle) : undefined; } catch { return undefined; }
}
function ecrireCle(mag: MagasinVenus, cle: string | undefined): void {
  mkdirSync(mag.dir, { recursive: true, mode: 0o700 });
  const f = fichierCle(mag.dir), t = `${f}.tmp`;
  writeFileSync(t, JSON.stringify(cle ? { cle: chiffrerChamp(mag.home, cle) } : {}), { mode: 0o600 }); renameSync(t, f);
}

/** Les réglages du catalogue : par défaut, seul le catalogue public des films (sans clé) est coché. */
export function reglagesCatalogue(mag: MagasinVenus): ReglagesCatalogue {
  const d = mag.get('acq_reglages', 'catalogue')?.data ?? {};
  const films = (['aucun', 'public', 'cle'] as string[]).includes(s(d.films)) ? s(d.films) as ModeFilms : 'public';
  return { series: d.series === true, animes: d.animes === true, films, aCle: Boolean(lireCle(mag)), langue: /^[a-z]{2}-[A-Z]{2}$/.test(s(d.langue)) ? s(d.langue) : 'fr-FR' };
}
/** Le catalogue est-il réglé (au moins une source choisie) ? */
export const catalogueRegle = (r: ReglagesCatalogue): boolean => r.series || r.animes || r.films === 'public' || (r.films === 'cle' && r.aCle);

/** Règle les sources. `cle` : une nouvelle clé (vide = garder) ; `oublier_cle` : la retirer. */
export function reglerCatalogue(mag: MagasinVenus, p: { series?: unknown; animes?: unknown; films?: unknown; cle?: unknown; oublier_cle?: unknown; langue?: unknown }): ReglagesCatalogue {
  const r = reglagesCatalogue(mag), cle = s(p.cle);
  if (cle && !/^[A-Za-z0-9._-]{16,400}$/.test(cle)) throw new Error('clé : seulement des lettres, chiffres, « . », « _ » et « - » (16 caractères au moins)');
  const films = p.films === undefined || s(p.films) === '' ? r.films : (['aucun', 'public', 'cle'] as string[]).includes(s(p.films)) ? s(p.films) as ModeFilms : (() => { throw new Error('films : aucun, public ou cle'); })();
  if (cle) ecrireCle(mag, cle); else if (oui(p.oublier_cle)) ecrireCle(mag, undefined);
  const prec = mag.get('acq_reglages', 'catalogue')?.data ?? {};
  // `nom` garde la forme lue par l'ancienne fonction `catalogue()` d'acquisition.ts (« réglé » ou non).
  const n = { series: p.series === undefined ? r.series : oui(p.series), animes: p.animes === undefined ? r.animes : oui(p.animes), films, langue: /^[a-z]{2}-[A-Z]{2}$/.test(s(p.langue)) ? s(p.langue) : r.langue };
  const regle = catalogueRegle({ ...n, aCle: Boolean(lireCle(mag)) });
  mag.poser('acq_reglages', 'catalogue', { ...prec, ...n, nom: regle ? 'sorties' : '' });
  return reglagesCatalogue(mag);
}

// ---------------------------------------------------------------- lecture bornée (temps, taille), en mémoire 6 h
const MAX = 4 * 1024 * 1024, MAX_CACHE = 300;
// Chaque entrée porte sa fin de vie ; les entrées passées sont retirées à chaque ajout, et au-delà de MAX_CACHE la plus
// ancienne part (avant : rien n'était jamais retiré, la mémoire grossissait chaque jour de plusieurs Mo).
const cache = new Map<string, { exp: number; v: unknown }>();
/** Pour les essais : oublier ce qui a été lu. */
export function viderCacheCatalogue(): void { cache.clear(); }
/** Pour les essais : le nombre d'entrées gardées. */
export const tailleCacheCatalogue = (): number => cache.size;
let delaiTotal = 45_000;
/** Le temps total d'un écran (« À venir », Nouveautés, recherche) : au-delà, les lectures restantes s'arrêtent. Essais : plus court. */
export function reglerDelaiCatalogue(ms = 45_000): void { delaiTotal = ms; }
/** Un réseau dont toutes les requêtes s'arrêtent à la même échéance (posée à sa création). */
const avecEcheance = (f: Fetch): Fetch => { const fin = AbortSignal.timeout(delaiTotal); return (u, i = {}) => f(u, { ...i, signal: i.signal ? AbortSignal.any([i.signal, fin]) : fin }); };
/** Un message d'erreur sans nom de site, sans morceau de réponse. */
const messageDe = (e: unknown): string => {
  const x = e as Error;
  if (x?.name === 'TimeoutError' || x?.name === 'AbortError') return 'le catalogue met trop de temps à répondre';
  const m = s(x?.message);
  return /^(clé refusée|le catalogue|réponse|connexion impossible|seules les adresses|requête refusée)/.test(m) || /refusé$/.test(m) ? m.slice(0, 120) : 'le catalogue est injoignable';
};
async function lire(f: Fetch, url: string, init: RequestInit = {}, ttl = 6 * 3600e3): Promise<unknown> {
  const k = `${init.method ?? 'GET'} ${url} ${typeof init.body === 'string' ? init.body : ''}`, c = cache.get(k), now = Date.now();
  if (c && now < c.exp) return c.v;
  let v: unknown;
  try {
    const r = await f(url, { ...init, redirect: 'manual', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), headers: { accept: 'application/json', ...(init.headers as Record<string, string> ?? {}) } });
    if (r.status === 401 || r.status === 403) { await r.body?.cancel().catch(() => undefined); throw new Error('clé refusée par le catalogue'); }
    if (!r.ok) { await r.body?.cancel().catch(() => undefined); throw new Error(`le catalogue répond ${r.status}`); }
    if (!r.body) throw new Error('réponse vide');
    const lecteur = r.body.getReader(), parts: Uint8Array[] = []; let n = 0;
    for (;;) { const { done, value } = await lecteur.read(); if (done) break; n += value.length; if (n > MAX) { await lecteur.cancel().catch(() => undefined); throw new Error('réponse du catalogue trop grande'); } parts.push(value); }
    try { v = JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown; } catch { throw new Error('réponse illisible du catalogue'); }
  } catch (e) { throw new Error(messageDe(e)); }
  for (const [x, y] of cache) if (y.exp <= now) cache.delete(x);
  while (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(k, { exp: now + ttl, v }); return v;
}
const sur = async <X>(f: () => Promise<X>, repli: X, erreurs: string[]): Promise<X> => { try { return await f(); } catch (e) { erreurs.push(messageDe(e)); return repli; } };
/** Une liste venue d'Internet : un tableau, sinon rien (une réponse piégée ne casse pas l'écran). */
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

// ---------------------------------------------------------------- données nettoyées
const ENTITES: Record<string, string> = { amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: ' ', gt: ' ', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
const entite = (m: string, x: string): string => {
  if (x[0] === '#') { const c = x[1] === 'x' || x[1] === 'X' ? parseInt(x.slice(2), 16) : parseInt(x.slice(1), 10); return Number.isInteger(c) && c > 31 && c < 0x110000 && c !== 60 && c !== 62 ? String.fromCodePoint(c) : ' '; }
  return ENTITES[x.toLowerCase()] ?? m;
};
/** Un texte venu d'un catalogue : sans balise, entités lues, sans caractère de contrôle ni « < > », coupé. Pur. */
export const texte = (v: unknown, n = 300): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/<[^>]*>/g, ' ').replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, entite).replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const entier = (v: unknown, min: number, max: number): number | undefined => { const x = Number(v); return Number.isInteger(x) && x >= min && x <= max ? x : undefined; };
const jour = (v: unknown): string | undefined => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(v)); return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined; };
const pad = (n: number) => String(n).padStart(2, '0');
/** Le jour local (AAAA-MM-JJ) d'un instant. Pur. */
export const jourLocal = (t: number): string => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const DAY = 864e5;

/** Une sortie (même forme que les entrées de Venus, sans image). */
export interface Sortie {
  key: string; kind: Genre; title: string; date: string; at?: number; season?: number; episode?: number; epTitle?: string;
  year?: number; release?: string; network?: string; overview?: string; genres?: string[]; pop: number;
  /** l'œuvre de la bibliothèque, si le titre y est déjà */ nas?: string;
  /** en favori (« Mes envies ») pour ce profil */ wanted?: boolean;
}
export interface Bibliotheque { film: Map<string, string>; serie: Map<string, string>; anime: Map<string, string> }
/** Les titres déjà dans la bibliothèque, par titre simplifié. */
export function indexBibliotheque(mag: MagasinVenus): Bibliotheque {
  const b: Bibliotheque = { film: new Map(), serie: new Map(), anime: new Map() };
  for (const o of mag.liste('oeuvres')) {
    const t = norm(s(o.data.titre)); if (!t) continue;
    if (o.data.type === 'film') b.film.set(t, o.id);
    if (o.data.type === 'serie') { b.serie.set(t, o.id); if (o.data.categorie === 'anime') b.anime.set(t, o.id); }
  }
  return b;
}

// ---------------------------------------------------------------- séries : le programme télé public
interface Diffusion { airdate?: string; airstamp?: string; season?: number; number?: number; name?: string; show?: Record<string, unknown>; _embedded?: { show?: Record<string, unknown> } }
const estAnime = (sh: Record<string, unknown>) => liste(sh.genres).includes('Anime');
async function series(f: Fetch, lib: Bibliotheque, now: number, erreurs: string[]): Promise<Sortie[]> {
  const out = new Map<string, Sortie>();
  for (let d = -1; d <= 7; d++) {
    const date = jourLocal(now + d * DAY);
    const listes = await Promise.all([`${ADRESSES.series}/schedule?country=US&date=${date}`, `${ADRESSES.series}/schedule?country=FR&date=${date}`, `${ADRESSES.series}/schedule/web?date=${date}`]
      .map((u) => sur(async () => liste(await lire(f, u)) as Diffusion[], [], erreurs)));
    for (const e0 of listes.flat()) {
      const e = objet(e0) as Diffusion, sh0 = e.show ?? objet(e._embedded).show; if (!sh0 || typeof sh0 !== 'object') continue;
      const sh = objet(sh0);
      if (!['Scripted', 'Animation', 'Documentary'].includes(s(sh.type)) || estAnime(sh)) continue;
      const titre = texte(sh.name, 200); if (!titre) continue;
      const nas = lib.serie.get(norm(titre)), poids = Number(sh.weight) || 0;
      if (!nas && poids < 80) continue; // seulement les séries suivies par beaucoup de monde (comme Venus)
      const season = entier(e.season, 0, 200), episode = entier(e.number, 0, 5000), at = Date.parse(s(e.airstamp));
      const k = `${norm(titre)}|${season ?? ''}|${episode ?? ''}`; if (out.has(k)) continue;
      const ext = objet(sh.externals), id = entier(ext.thetvdb, 1, 1e9) ?? entier(sh.id, 1, 1e9);
      const reseau = objet(sh.network ?? sh.webChannel).name;
      out.set(k, { key: id ? `serie:${id}` : `name:${norm(titre)}`, kind: 'show', title: titre, date: jour(e.airdate) ?? date, ...(Number.isFinite(at) ? { at } : {}),
        ...(season !== undefined ? { season } : {}), ...(episode !== undefined ? { episode } : {}), ...(texte(e.name, 120) && !/^(episode \d+|TBA)$/i.test(s(e.name)) ? { epTitle: texte(e.name, 120) } : {}),
        ...(entier(s(sh.premiered).slice(0, 4), 1880, 2100) ? { year: Number(s(sh.premiered).slice(0, 4)) } : {}), ...(texte(reseau, 60) ? { network: texte(reseau, 60) } : {}),
        ...(texte(sh.summary, 400) ? { overview: texte(sh.summary, 400) } : {}), genres: liste(sh.genres).slice(0, 4).map((g) => texte(g, 30)).filter(Boolean),
        pop: poids, ...(nas ? { nas } : {}) });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- animés : le programme de diffusion public
const Q_SEMAINE = 'query ($from: Int, $to: Int, $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage } airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { episode airingAt media { id isAdult popularity format episodes title { romaji english } description(asHtml: false) } } } }';
const Q_LISTE = 'query ($season: MediaSeason, $year: Int, $sort: [MediaSort], $status: MediaStatus) { Page(perPage: 24) { media(type: ANIME, season: $season, seasonYear: $year, sort: $sort, status: $status, isAdult: false, format_in: [TV, TV_SHORT, MOVIE, ONA]) { id format averageScore popularity episodes nextAiringEpisode { episode airingAt } title { romaji english native } description(asHtml: false) startDate { year month day } } } }';
const graphe = (f: Fetch, query: string, variables: Record<string, unknown>) => lire(f, ADRESSES.animes, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) }, 3 * 3600e3) as Promise<{ data?: { Page?: Record<string, unknown> } }>;
interface Media { id?: number; isAdult?: boolean; popularity?: number; format?: string; episodes?: number; averageScore?: number; title?: { romaji?: string; english?: string; native?: string }; description?: string; startDate?: { year?: number; month?: number; day?: number }; nextAiringEpisode?: { episode?: number; airingAt?: number } }
async function animes(f: Fetch, lib: Bibliotheque, now: number, erreurs: string[]): Promise<Sortie[]> {
  const out: Sortie[] = [];
  for (let page = 1; page <= 6; page++) {
    const d = await sur(() => graphe(f, Q_SEMAINE, { from: Math.floor((now - DAY) / 1000), to: Math.floor((now + 7 * DAY) / 1000), page }), {}, erreurs);
    const pg = d.data?.Page as { pageInfo?: { hasNextPage?: boolean }; airingSchedules?: Array<{ episode?: number; airingAt?: number; media?: Media }> } | undefined;
    if (!pg) break;
    for (const a0 of liste(pg.airingSchedules)) {
      const a = objet(a0) as { episode?: number; airingAt?: number; media?: Media }, m = objet(a.media) as Media; if (m.isAdult || !['TV', 'TV_SHORT', 'ONA'].includes(s(m.format))) continue;
      const id = entier(m.id, 1, 1e9), titre = texte(objet(m.title).english || objet(m.title).romaji, 200); if (!titre) continue;
      const nas = lib.anime.get(norm(titre)) ?? lib.serie.get(norm(titre)) ?? lib.serie.get(norm(texte(objet(m.title).romaji, 200)));
      if (!nas && (Number(m.popularity) || 0) < 15000) continue;
      const at = (Number(a.airingAt) || 0) * 1000; if (!at) continue;
      out.push({ key: id ? `anime:${id}` : `name:${norm(titre)}`, kind: 'anime', title: titre, date: jourLocal(at), at, ...(entier(a.episode, 0, 5000) !== undefined ? { episode: Number(a.episode) } : {}),
        ...(texte(m.description, 400) ? { overview: texte(m.description, 400) } : {}), pop: Number(m.popularity) || 0, ...(nas ? { nas } : {}) });
    }
    if (!pg.pageInfo?.hasNextPage) break;
  }
  return out;
}
const versNouveaute = (m0: unknown) => {
  const m = objet(m0) as Media, ti = objet(m.title) as NonNullable<Media['title']>, titre = texte(ti.english || ti.romaji, 200), sd = objet(m.startDate) as NonNullable<Media['startDate']>;
  return { key: `anime:${entier(m.id, 1, 1e9) ?? norm(titre)}`, kind: 'anime' as Genre, type: m.format === 'MOVIE' ? 'movie' : 'tv', title: titre, original: texte(ti.romaji || ti.native, 200),
    overview: texte(m.description, 500), date: entier(sd.year, 1900, 2100) ? [sd.year, entier(sd.month, 1, 12), entier(sd.day, 1, 31)].filter(Boolean).map((n, i) => (i ? pad(Number(n)) : String(n))).join('-') : undefined,
    score: entier(m.averageScore, 1, 100), anime: true, ...(entier(objet(m.nextAiringEpisode).airingAt, 1, 1e11) ? { next: { episode: entier(objet(m.nextAiringEpisode).episode, 0, 5000) ?? 0, at: Number(objet(m.nextAiringEpisode).airingAt) * 1000 } } : {}) };
};
const SAISONS = ['WINTER', 'WINTER', 'SPRING', 'SPRING', 'SPRING', 'SUMMER', 'SUMMER', 'SUMMER', 'FALL', 'FALL', 'FALL', 'WINTER'];

// ---------------------------------------------------------------- films
const quand = (dates: Array<[unknown, string]>, de: string, a: string, auj: string): { date: string; release: string } | undefined => {
  const ev = dates.map(([d, l]) => (jour(d) ? { date: jour(d)!, release: l } : undefined)).filter((x): x is { date: string; release: string } => !!x && x.date >= de && x.date <= a);
  return ev.filter((x) => x.date >= auj).sort((x, y) => x.date.localeCompare(y.date))[0] ?? ev.sort((x, y) => y.date.localeCompare(x.date))[0];
};
const enTete = (cle: string) => (cle.length > 40 ? { headers: { authorization: `Bearer ${cle}` } } : {});
const avecCle = (u: string, cle: string, p: Record<string, string>) => { const x = new URL(u); for (const [k, v] of Object.entries(p)) x.searchParams.set(k, v); if (cle.length <= 40) x.searchParams.set('api_key', cle); return x.toString(); };
interface FicheGrand { id?: number; title?: string; name?: string; original_title?: string; original_name?: string; overview?: string; release_date?: string; first_air_date?: string; popularity?: number; vote_average?: number; vote_count?: number; original_language?: string; genre_ids?: number[] }
async function grand(f: Fetch, cle: string, chemin: string, langue: string, page = 1): Promise<FicheGrand[]> {
  const d = await lire(f, avecCle(`${ADRESSES.grand}${chemin}`, cle, { language: langue, region: langue.split('-')[1] ?? 'FR', page: String(page) }), enTete(cle)) as { results?: FicheGrand[] };
  return liste(objet(d).results).slice(0, 60).map(objet) as FicheGrand[];
}
async function films(f: Fetch, mag: MagasinVenus, lib: Bibliotheque, now: number, r: ReglagesCatalogue, erreurs: string[]): Promise<Sortie[]> {
  const de = jourLocal(now - 21 * DAY), a = jourLocal(now + 180 * DAY), auj = jourLocal(now), out = new Map<string, Sortie>();
  const ajouter = (x: Sortie) => { if (!out.has(x.key)) out.set(x.key, x); };
  const cle = r.films === 'cle' ? lireCle(mag) : undefined;
  if (cle) {
    for (const ch of ['/movie/upcoming', '/movie/now_playing']) for (const page of [1, 2]) for (const x of await sur(() => grand(f, cle, ch, r.langue, page), [], erreurs)) {
      const date = jour(x.release_date); if (!date || date < de || date > a) continue;
      const titre = texte(x.title, 200); if (!titre) continue;
      const id = entier(x.id, 1, 1e10); if (!id) continue;
      ajouter({ key: `film:${id}`, kind: 'movie', title: titre, date, release: 'Au cinéma', year: Number(date.slice(0, 4)), ...(texte(x.overview, 400) ? { overview: texte(x.overview, 400) } : {}), pop: Number(x.popularity) || 0, ...(lib.film.get(norm(titre)) ? { nas: lib.film.get(norm(titre)) } : {}) });
    }
  }
  // Sans clé (ou trop peu de films) : le catalogue public des films, par année, classés par popularité.
  if (r.films === 'public' || (cle && out.size < 12)) {
    const annees = [...new Set([new Date(now - 21 * DAY).getFullYear(), new Date(now).getFullYear(), new Date(now + 180 * DAY).getFullYear()])];
    const metas: Array<Record<string, unknown> & { rang: number }> = [];
    for (const y of annees) {
      const d = await sur(async () => (await lire(f, `${ADRESSES.filmsPublic}/catalog/movie/year/genre=${y}.json`, {}, 12 * 3600e3)) as { metas?: Array<Record<string, unknown>> }, {}, erreurs);
      for (const m of liste(objet(d).metas).slice(0, 100)) metas.push({ ...objet(m), rang: metas.length });
    }
    const vus = new Set<string>(), afaire = metas.filter((m) => /^tt\d{1,12}$/.test(s(m.id)) && !vus.has(s(m.id)) && vus.add(s(m.id))).slice(0, 120);
    let k = 0;
    const ouvrier = async () => {
      while (k < afaire.length) {
        const m = afaire[k++]; let sortie = m.released;
        if (!sortie) { const p = objet(await sur(() => lire(f, `${ADRESSES.filmsPublic}/meta/movie/${s(m.id)}.json`, {}, 24 * 3600e3), {}, erreurs)), meta = objet(p.meta); sortie = meta.released; m.description ??= meta.description; m.genres ??= meta.genres; }
        const w = quand([[sortie, 'Sortie']], de, a, auj); if (!w) continue;
        const titre = texte(m.name, 200); if (!titre) continue;
        ajouter({ key: `film:${s(m.id)}`, kind: 'movie', title: titre, date: w.date, release: w.release, year: Number(w.date.slice(0, 4)), ...(texte(m.description, 400) ? { overview: texte(m.description, 400) } : {}),
          genres: (Array.isArray(m.genres) ? m.genres : []).slice(0, 4).map((g) => texte(g, 30)).filter(Boolean), pop: 1e5 - m.rang, ...(lib.film.get(norm(titre)) ? { nas: lib.film.get(norm(titre)) } : {}) });
      }
    };
    await Promise.all(Array.from({ length: 6 }, ouvrier));
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- « À venir » (Upcoming.js / upcoming.js)
export interface AVenir { regle: boolean; source: boolean; texte: string; entries: Sortie[]; suggestions: Sortie[]; erreurs: string[]; kind: Genre }
/**
 * Ce qui sort ou se diffuse autour d'aujourd'hui, jour par jour, pour un genre. `favoris` : les clés en « Mes envies ».
 * Non réglé : rien n'est lu, et le texte le dit.
 */
export async function aVenir(mag: MagasinVenus, f: Fetch, kind: Genre, favoris: Set<string> = new Set(), now = Date.now()): Promise<AVenir> {
  const r = reglagesCatalogue(mag), lib = indexBibliotheque(mag), erreurs: string[] = [];
  const source = kind === 'show' ? r.series : kind === 'anime' ? r.animes : r.films === 'public' || (r.films === 'cle' && r.aCle);
  if (!source) return { regle: catalogueRegle(r), source: false, kind, entries: [], suggestions: [], erreurs, texte: kind === 'movie' ? 'Aucun catalogue des films n\'est réglé : « À venir » ne lit rien sur Internet tant que tu n\'en as pas choisi un (Réglages → Demandes).' : `Aucun programme des ${kind === 'anime' ? 'animés' : 'séries'} n'est réglé : « À venir » ne lit rien sur Internet tant que tu ne l'as pas activé (Réglages → Demandes).` };
  const g = avecEcheance(f);
  const entries = await sur(() => (kind === 'show' ? series(g, lib, now, erreurs) : kind === 'anime' ? animes(g, lib, now, erreurs) : films(g, mag, lib, now, r, erreurs)), [] as Sortie[], erreurs);
  for (const e of entries) if (favoris.has(e.key)) e.wanted = true;
  entries.sort((a, b) => (a.at ?? Date.parse(`${a.date}T12:00:00Z`)) - (b.at ?? Date.parse(`${b.date}T12:00:00Z`)) || b.pop - a.pop);
  // Propositions : les titres les plus suivis, ni dans la bibliothèque, un par titre (comme Venus).
  const vus = new Set<string>(), suggestions: Sortie[] = [];
  for (const e of [...entries].filter((x) => !x.nas).sort((a, b) => b.pop - a.pop)) { const k = kind === 'movie' ? e.key : norm(e.title); if (vus.has(k)) continue; vus.add(k); suggestions.push(e); if (suggestions.length >= 24) break; }
  return { regle: true, source: true, kind, entries: entries.slice(0, 400), suggestions, erreurs: [...new Set(erreurs)].slice(0, 3), texte: `${entries.length} ${kind === 'movie' ? 'sortie(s)' : 'épisode(s)'}` };
}

// ---------------------------------------------------------------- « Nouveautés » (Nouveautes.js / discover.js)
export interface Nouveaute { key: string; kind: Genre; type: string; title: string; original?: string; overview?: string; date?: string; score?: number; anime?: boolean; next?: { episode: number; at: number }; inLibrary?: string; wanted?: boolean }
export interface Nouveautes { regle: boolean; source: boolean; sections: Array<{ title: string; items: Nouveaute[]; error?: string }>; texte: string }
export async function nouveautes(mag: MagasinVenus, f0: Fetch, kind: Genre, favoris: Set<string> = new Set(), now = new Date()): Promise<Nouveautes> {
  const f = avecEcheance(f0);
  const r = reglagesCatalogue(mag), lib = indexBibliotheque(mag), cle = r.films === 'cle' ? lireCle(mag) : undefined;
  const source = kind === 'anime' ? r.animes : Boolean(cle);
  if (!source) return { regle: catalogueRegle(r), source: false, sections: [], texte: kind === 'anime' ? 'Le programme des animés n\'est pas activé (Réglages → Demandes).' : 'Les nouveautés des films et des séries viennent du grand catalogue : ajoute sa clé (gratuite) dans Réglages → Demandes. Les animés marchent sans clé.' };
  const section = async (title: string, fn: () => Promise<Nouveaute[]>) => { try { return { title, items: await fn() }; } catch (e) { return { title, items: [], error: messageDe(e) }; } };
  const depuisGrand = (l: FicheGrand[], type: 'movie' | 'tv'): Nouveaute[] => l.filter((x) => entier(x.id, 1, 1e10)).map((x) => {
    const titre = texte(x.title || x.name, 200);
    return { key: `${type === 'movie' ? 'film' : 'serie'}:${x.id}`, kind: (type === 'movie' ? 'movie' : x.original_language === 'ja' && liste(x.genre_ids).includes(16) ? 'anime' : 'show') as Genre, type, title: titre, original: texte(x.original_title || x.original_name, 200),
      overview: texte(x.overview, 500), date: jour(x.release_date || x.first_air_date), score: (Number(x.vote_count) || 0) > 3 ? Math.round((Number(x.vote_average) || 0) * 10) : undefined };
  }).filter((x) => x.title);
  let sections: Nouveautes['sections'];
  if (kind === 'movie') sections = await Promise.all([section('Au cinéma en ce moment', async () => depuisGrand(await grand(f, cle!, '/movie/now_playing', r.langue), 'movie')), section('Bientôt au cinéma', async () => depuisGrand(await grand(f, cle!, '/movie/upcoming', r.langue), 'movie')), section('Tendances de la semaine', async () => depuisGrand(await grand(f, cle!, '/trending/movie/week', r.langue), 'movie'))]);
  else if (kind === 'show') sections = await Promise.all([section('Nouveaux épisodes cette semaine', async () => depuisGrand(await grand(f, cle!, '/tv/on_the_air', r.langue), 'tv')), section('Diffusés aujourd’hui', async () => depuisGrand(await grand(f, cle!, '/tv/airing_today', r.langue), 'tv')), section('Tendances de la semaine', async () => depuisGrand(await grand(f, cle!, '/trending/tv/week', r.langue), 'tv'))]);
  else {
    const ordre = ['WINTER', 'SPRING', 'SUMMER', 'FALL'], sn = SAISONS[now.getMonth()], an = now.getFullYear() + (now.getMonth() === 11 ? 1 : 0);
    const i = ordre.indexOf(sn), suiv = i === 3 ? { season: 'WINTER', year: an + 1 } : { season: ordre[i + 1], year: an };
    const lister = async (v: Record<string, unknown>) => liste(objet(objet(objet(await graphe(f, Q_LISTE, v)).data).Page).media).slice(0, 24).map(versNouveaute).filter((x) => x.title);
    sections = await Promise.all([section('Cette saison', () => lister({ season: sn, year: an, sort: ['POPULARITY_DESC'] })), section('En diffusion, les plus suivis', () => lister({ status: 'RELEASING', sort: ['TRENDING_DESC'] })), section('La saison prochaine', () => lister({ season: suiv.season, year: suiv.year, sort: ['POPULARITY_DESC'] }))]);
  }
  for (const sec of sections) for (const x of sec.items) {
    const t = norm(x.title), o = x.original ? norm(x.original) : '';
    const id = x.type === 'movie' ? lib.film.get(t) ?? (o ? lib.film.get(o) : undefined) : lib.serie.get(t) ?? (o ? lib.serie.get(o) : undefined);
    if (id) x.inLibrary = id; if (favoris.has(x.key)) x.wanted = true;
  }
  return { regle: true, source: true, sections, texte: `${sections.reduce((n, x) => n + x.items.length, 0)} titre(s)` };
}

// ---------------------------------------------------------------- « Nouveau » (Request.js) : chercher un titre
export interface Trouve { key: string; kind: Genre; title: string; year?: number; overview?: string; inLibrary?: string; animeHint?: boolean }
export interface Recherche { source: boolean; items: Trouve[]; texte: string; erreur?: string }
/**
 * Le titre tapé dans « Nouveau », cherché dans le grand catalogue quand sa clé est réglée (comme Venus : titre, année,
 * résumé ; l'affiche est dessinée par la page, aucune image extérieure n'est transmise). Sans clé : rien n'est lu, la
 * page ajoute le titre tel quel.
 */
export async function chercherTitre(mag: MagasinVenus, f0: Fetch, q: unknown, kind: Genre): Promise<Recherche> {
  const r = reglagesCatalogue(mag), cle = r.films === 'cle' ? lireCle(mag) : undefined, terme = texte(q, 120);
  if (!cle) return { source: false, items: [], texte: 'Sans la clé du grand catalogue, le titre est ajouté tel quel.' };
  if (terme.length < 2) return { source: true, items: [], texte: 'Tapez au moins deux lettres.' };
  const f = avecEcheance(f0), lib = indexBibliotheque(mag), type = kind === 'movie' ? 'movie' : 'tv';
  const m = /^(.*?)\s*\((\d{4})\)$/.exec(terme), titre = m ? m[1] : terme, annee = m ? m[2] : '';
  try {
    const d = objet(await lire(f, avecCle(`${ADRESSES.grand}/search/${type}`, cle, { query: titre, language: r.langue, include_adult: 'false', ...(annee ? { [type === 'movie' ? 'year' : 'first_air_date_year']: annee } : {}) }), enTete(cle), 3600e3));
    const items = liste(d.results).slice(0, 20).map(objet).filter((x) => entier(x.id, 1, 1e10)).map((x0) => {
      const x = x0 as FicheGrand, t = texte(x.title || x.name, 200), j = jour(x.release_date || x.first_air_date), o = texte(x.original_title || x.original_name, 200);
      const ici = type === 'movie' ? lib.film.get(norm(t)) ?? (o ? lib.film.get(norm(o)) : undefined) : lib.serie.get(norm(t)) ?? (o ? lib.serie.get(norm(o)) : undefined);
      return { key: `${type === 'movie' ? 'film' : 'serie'}:${x.id}`, kind: type === 'movie' ? 'movie' as Genre : kind, title: t, ...(j ? { year: Number(j.slice(0, 4)) } : {}), ...(texte(x.overview, 300) ? { overview: texte(x.overview, 300) } : {}), ...(ici ? { inLibrary: ici } : {}), ...(type === 'tv' && x.original_language === 'ja' && liste(x.genre_ids).includes(16) ? { animeHint: true } : {}) };
    }).filter((x) => x.title);
    if (kind === 'anime') items.sort((a, b) => Number(Boolean(b.animeHint)) - Number(Boolean(a.animeHint)));
    return { source: true, items, texte: items.length ? `${items.length} résultat${items.length > 1 ? 's' : ''}` : 'Aucun résultat.' };
  } catch (e) { return { source: true, items: [], texte: messageDe(e), erreur: messageDe(e) }; }
}
