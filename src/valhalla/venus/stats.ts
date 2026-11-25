// Vénus, la maison (lot V8) : « Mes statistiques », la rétrospective de l'année et « Qui regarde ce soir ? ».
// Comme les pages Stats.js, Recap.js et Tonight.js (Together) du dépôt Venus, mais calculé ici d'après ce qu'Odin
// garde vraiment : la reprise de chaque profil (une ligne par film ou épisode : position atteinte, durée, date de la
// dernière lecture). Rien n'est inventé : un titre revu compte une fois, au jour et à l'heure de sa dernière lecture ;
// le temps compté est la position atteinte (la durée entière quand c'est fini).
//
// Chaque profil ne reçoit que SES chiffres (le profil de la requête). « Qui regarde ce soir ? » lit la reprise des
// profils cochés pour écarter ce que l'un d'eux a déjà commencé ou vu, sans rien renvoyer de leur historique.
import type { Enr, MagasinVenus } from './base.ts';
import { catalogue, type ProfilVenus, type TitreVenus } from './app/appli.ts';

const FINI = 0.95;
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const h1 = (x: number) => Math.round(x * 100) / 100;

/** Une lecture gardée : la cible, l'œuvre, ce qu'elle a duré, quand. */
interface Passage { cible: string; oeuvre: Enr; episode?: Enr; secondes: number; fini: boolean; quand: number }

/** Les passages d'un profil, d'après sa reprise (seulement ce qui est encore dans la bibliothèque). */
export function passages(mag: MagasinVenus, profil: string): Passage[] {
  const out: Passage[] = [];
  for (const r of mag.liste('reprise')) {
    if (r.data.profil !== profil) continue;
    const cible = s(r.data.cible_id), ep = mag.get('episodes', cible);
    const oeuvre = ep ? mag.get('oeuvres', s(ep.data.oeuvre_id)) : mag.get('oeuvres', cible);
    if (!oeuvre || (oeuvre.data.type !== 'film' && oeuvre.data.type !== 'serie')) continue;
    const duree = Number(r.data.duree_s) || Number((ep ?? oeuvre).data.duree) || 0, pos = Math.max(0, Number(r.data.position_s) || 0);
    const fini = duree > 0 && pos >= duree * FINI;
    const secondes = fini ? duree : duree > 0 ? Math.min(pos, duree) : pos;
    if (secondes <= 0) continue;
    out.push({ cible, oeuvre, ...(ep ? { episode: ep } : {}), secondes, fini, quand: Number(r.data.maj) || r.maj });
  }
  return out;
}

const jourDe = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** La plus longue suite de jours qui se suivent (jours « AAAA-MM-JJ »). Pur. */
export function plusLongueSerie(jours: string[]): number {
  const l = [...new Set(jours)].sort(); let best = 0, cur = 0, prev = 0;
  for (const j of l) { const t = Date.UTC(Number(j.slice(0, 4)), Number(j.slice(5, 7)) - 1, Number(j.slice(8, 10))); cur = prev && t - prev === 864e5 ? cur + 1 : 1; prev = t; best = Math.max(best, cur); }
  return best;
}

export interface StatsTitre { id: string; title: string; poster?: string; hours: number; eps: number }
export interface Stats {
  year: number; years: number[]; totalHours: number; allTimeHours: number; movies: number; episodes: number; days: number; streak: number;
  genres: Array<{ name: string; hours: number }>; topShows: StatsTitre[]; topAnime: StatsTitre[];
  lastMovies: Array<{ id: string; title: string; poster?: string; at: number }>; completedShows: Array<{ id: string; title: string; poster?: string }>;
  months: Array<{ m: number; hours: number }>; weekdays: Array<{ w: number; hours: number }>; hoursOfDay: Array<{ h: number; hours: number }>;
  byKind: Array<{ kind: 'movie' | 'show' | 'anime' | 'clip'; hours: number }>; calendar: Record<string, number>; bestMonth: { m: number; hours: number } | null; person: string | null;
}

/**
 * Les statistiques d'un profil pour une année : heures, films et épisodes vus jusqu'au bout, jours avec une lecture,
 * plus longue suite de jours, mois, jours de la semaine, heures de la journée, genres, séries et animés les plus
 * suivis, derniers films, séries terminées, et la personne la plus vue (au moins 3 titres). D'après la reprise.
 */
export function statistiques(mag: MagasinVenus, profil: string, annee: number): Stats {
  const tout = passages(mag, profil), titres = new Map<string, TitreVenus>(catalogue(mag, profil).map((x) => [x.id, x]));
  const an = tout.filter((p) => new Date(p.quand).getFullYear() === annee);
  const heures = (l: Passage[]) => l.reduce((a, p) => a + p.secondes, 0) / 3600;
  const months = Array.from({ length: 12 }, (_, m) => ({ m, hours: 0 })), weekdays = Array.from({ length: 7 }, (_, w) => ({ w, hours: 0 })), hoursOfDay = Array.from({ length: 24 }, (_, h) => ({ h, hours: 0 }));
  const kinds = new Map<'movie' | 'show' | 'anime' | 'clip', number>(), genres = new Map<string, number>(), calendar: Record<string, number> = {};
  const series = new Map<string, { hours: number; eps: number; quand: number }>(), gens = new Map<string, { nom: string; titres: Set<string> }>();
  for (const p of an) {
    const d = new Date(p.quand), hrs = p.secondes / 3600, t = titres.get(p.oeuvre.id), cat = t?.category ?? (p.oeuvre.data.type === 'serie' ? 'show' : 'movie');
    months[d.getMonth()].hours += hrs; weekdays[(d.getDay() + 6) % 7].hours += hrs; hoursOfDay[d.getHours()].hours += hrs;
    kinds.set(cat, (kinds.get(cat) ?? 0) + hrs);
    for (const g of t?.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + hrs);
    const k = jourDe(p.quand); calendar[k] = (calendar[k] ?? 0) + Math.round(p.secondes / 60);
    if (p.episode) { const x = series.get(p.oeuvre.id) ?? { hours: 0, eps: 0, quand: 0 }; x.hours += hrs; if (p.fini) x.eps++; x.quand = Math.max(x.quand, p.quand); series.set(p.oeuvre.id, x); }
    const fi = p.oeuvre.data.fiche as { distribution?: Array<{ personne?: string; nom?: string }>; equipe?: Array<{ personne?: string; nom?: string }> } | undefined;
    for (const r of [...(fi?.distribution ?? []).slice(0, 5), ...(fi?.equipe ?? []).slice(0, 2)]) {
      const id = s(r.personne), nom = s(r.nom); if (!id || !nom) continue;
      const x = gens.get(id) ?? { nom, titres: new Set<string>() }; x.titres.add(p.oeuvre.id); gens.set(id, x);
    }
  }
  const img = (id: string) => { const p = titres.get(id)?.poster; return p ? { poster: p } : {}; };
  const titreDe = (o: Enr) => titres.get(o.id)?.title ?? (s(o.data.titre) || o.id);
  const top = (cat: 'show' | 'anime'): StatsTitre[] => [...series.entries()].filter(([id]) => (titres.get(id)?.category ?? 'show') === cat)
    .sort((a, b) => b[1].hours - a[1].hours).slice(0, 5).map(([id, x]) => ({ id, title: titreDe(mag.get('oeuvres', id)!), ...img(id), hours: h1(x.hours), eps: x.eps }));
  const films = an.filter((p) => !p.episode && p.fini && (titres.get(p.oeuvre.id)?.category ?? 'movie') === 'movie').sort((a, b) => b.quand - a.quand);
  const jours = Object.keys(calendar);
  const best = months.reduce((a, b) => (b.hours > a.hours ? b : a), months[0]);
  const personne = [...gens.values()].filter((x) => x.titres.size >= 3).sort((a, b) => b.titres.size - a.titres.size)[0];
  // Une série « terminée cette année » : tous ses épisodes de la bibliothèque vus jusqu'au bout, le dernier cette année
  // (la plus récente lecture de ses épisodes, toutes années confondues, tombe dans l'année demandée).
  const finDe = new Map<string, number>();
  for (const p of tout) if (p.episode) finDe.set(p.oeuvre.id, Math.max(finDe.get(p.oeuvre.id) ?? 0, p.quand));
  const completedShows = [...series.keys()].filter((id) => { const t = titres.get(id); return !!t && !!t.episodes && t.unseen === 0 && new Date(finDe.get(id) ?? 0).getFullYear() === annee; })
    .map((id) => ({ id, title: titreDe(mag.get('oeuvres', id)!), ...img(id) }));
  const years = [...new Set(tout.map((p) => new Date(p.quand).getFullYear()))].sort((a, b) => b - a);
  return {
    year: annee, years, totalHours: h1(heures(an)), allTimeHours: h1(heures(tout)), movies: films.length, episodes: an.filter((p) => p.episode && p.fini).length,
    days: jours.length, streak: plusLongueSerie(jours),
    genres: [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, hours]) => ({ name, hours: h1(hours) })),
    topShows: top('show'), topAnime: top('anime'),
    lastMovies: films.slice(0, 8).map((p) => ({ id: p.oeuvre.id, title: titreDe(p.oeuvre), ...img(p.oeuvre.id), at: p.quand })), completedShows,
    months: months.map((x) => ({ m: x.m, hours: h1(x.hours) })), weekdays: weekdays.map((x) => ({ w: x.w, hours: h1(x.hours) })), hoursOfDay: hoursOfDay.map((x) => ({ h: x.h, hours: h1(x.hours) })),
    byKind: (['movie', 'show', 'anime', 'clip'] as const).map((kind) => ({ kind, hours: h1(kinds.get(kind) ?? 0) })), calendar,
    bestMonth: best.hours ? { m: best.m, hours: h1(best.hours) } : null, person: personne ? personne.nom : null,
  };
}

/** L'année demandée (un nombre plausible), sinon l'année en cours. Pur. */
export function anneeDemandee(v: unknown, maintenant = new Date()): number {
  const n = Number(v); return Number.isInteger(n) && n >= 1970 && n <= maintenant.getFullYear() + 1 ? n : maintenant.getFullYear();
}

export interface Ensemble { results: Array<{ item: TitreVenus; why: string[] }>; kids: boolean; kidsSansAge: boolean }
/**
 * « Qui regarde ce soir ? » (Together de Tonight.js) : pour les profils cochés, les films (ou les séries et animés)
 * que personne n'a commencés ni vus, rangés par les genres que chacun regarde le plus, puis par la note. Avec un
 * enfant présent : Odin ne connaît pas l'âge permis des titres, donc rien n'est proposé (jamais un titre au hasard).
 */
export function ensemble(mag: MagasinVenus, tous: ProfilVenus[], ids: string[], kind: 'movie' | 'show', courant: string): Ensemble {
  const choisis = tous.filter((p) => ids.includes(p.id)).slice(0, 12);
  const kids = choisis.some((p) => p.isKids);
  if (!choisis.length) return { results: [], kids: false, kidsSansAge: false };
  if (kids) return { results: [], kids: true, kidsSansAge: true };
  const cats = kind === 'movie' ? ['movie'] : ['show', 'anime'];
  const vues = choisis.map((p) => catalogue(mag, p.id));
  const deja = new Set(vues.flatMap((l) => l.filter((x) => x.status !== 'unseen').map((x) => x.id)));
  // Le goût de chacun : ses heures par genre, ramenées à 1 pour son genre le plus regardé.
  const gouts = vues.map((l) => { const m = new Map<string, number>(); for (const x of l) if (x.status !== 'unseen') for (const g of x.genres ?? []) m.set(g, (m.get(g) ?? 0) + 1); const max = Math.max(1, ...m.values()); return new Map([...m].map(([g, n]) => [g, n / max])); });
  const base = vues[Math.max(0, choisis.findIndex((p) => p.id === courant))] ?? vues[0];
  const results = base.filter((x) => cats.includes(x.category) && !deja.has(x.id)).map((x) => {
    const g = x.genres ?? [], parGenre = g.map((k) => ({ k, v: gouts.reduce((a, m) => a + (m.get(k) ?? 0), 0) })).sort((a, b) => b.v - a.v);
    const score = gouts.reduce((a, m) => a + Math.max(0, ...g.map((k) => m.get(k) ?? 0)), 0) + (x.vote ?? x.critics ?? 0) / 4 + x.added / 1e13;
    return { item: x, why: parGenre.filter((z) => z.v > 0).slice(0, 2).map((z) => z.k), score };
  }).sort((a, b) => b.score - a.score).slice(0, 12).map(({ item, why }) => ({ item, why }));
  return { results, kids: false, kidsSansAge: false };
}
