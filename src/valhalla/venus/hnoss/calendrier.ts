// Vénus · Hnoss : le calendrier des sorties, comme « Ajouter à mon calendrier » dans l'onglet « À venir » de l'appli
// Venus d'origine (Upcoming.js) : « les épisodes de vos séries, les sorties de films demandées et vos favoris »
// apparaissent dans l'agenda du téléphone ou de l'ordinateur, mis à jour tout seuls, par un lien personnel.
//
// - Les sorties viennent de ce qui est GARDÉ dans VENUS_ODIN (table `sorties`) : le dernier relevé de « À venir » pour
//   chaque genre. Rien de gardé : un calendrier vide, jamais une sortie inventée. Rien n'est lu sur Internet ici.
// - Un profil ne reçoit que SES envies et SES demandes (plus les séries déjà dans la bibliothèque de la maison).
// - Le lien : un par profil ; on ne garde que son empreinte (pour le retrouver) et le lien chiffré par la clé de la
//   machine (pour le remontrer) ; en demander un neuf rend l'ancien inutilisable.
// - Le fichier ne suppose aucune langue : le titre tel qu'il est, et S01E02 pour un épisode.
import { createHash, randomBytes } from 'node:crypto';
import { chiffrerChamp, dechiffrerChamp } from '../../../vault.ts';
import type { MagasinVenus } from '../base.ts';
import { norm } from '../bibliotheque.ts';
import { demandesHnoss, envies } from './index.ts';

export type GenreSortie = 'movie' | 'show' | 'anime';
export const GENRES_SORTIE: GenreSortie[] = ['movie', 'show', 'anime'];
/** Une sortie gardée (la forme des entrées de « À venir », sans ce qui ne sert pas au calendrier). */
export interface SortieGardee {
  id: string; key: string; kind: GenreSortie; title: string; date: string; at?: number;
  season?: number; episode?: number; epTitle?: string; year?: number; nas?: string;
}
/** Le nombre de sorties gardées par genre (celui de « À venir »). */
export const MAX_SORTIES = 400;

const s = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').trim();
const propre = (v: unknown, n: number) => s(v).replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const entier = (v: unknown, min: number, max: number) => { const x = Number(v); return v !== undefined && v !== null && v !== '' && Number.isInteger(x) && x >= min && x <= max ? x : undefined; };
const empreinte = (t: string) => createHash('sha256').update(t).digest('hex');
const idReleve = (kind: GenreSortie) => `sorties:${kind}`;
/** Le dernier instant accepté pour une heure de diffusion (au-delà : illisible, on garde le jour seul). */
const AT_MAX = Date.UTC(2200, 0, 1);
/** Un jour AAAA-MM-JJ qui existe vraiment (le 31 février ou le mois 13 sont écartés), ou rien. */
const jourValide = (v: unknown): string | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s(v)); if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? m[0] : undefined;
};
/** Le profil de « Qui regarde ? » (`p:<login>` pour un membre) vu comme celui des envies et demandes (`<login>`). */
const profilHnoss = (profil: string): string => (profil.startsWith('p:') ? profil.slice(2) : profil);

/** Une entrée de « À venir » nettoyée (titre et jour obligatoires), ou rien. Pur. */
export function sortieGardee(x0: unknown, kind: GenreSortie): SortieGardee | undefined {
  const x = x0 && typeof x0 === 'object' ? x0 as Record<string, unknown> : {};
  const title = propre(x.title, 200), jour = jourValide(x.date);
  if (!title || !jour) return undefined;
  const key = propre(x.key, 120) || `name:${norm(title)}`, at = Number(x.at), season = entier(x.season, 0, 200), episode = entier(x.episode, 0, 5000);
  const nas = s(x.nas), epTitle = propre(x.epTitle, 120), year = entier(x.year, 1880, 2100);
  return {
    id: empreinte(`${kind}|${key}|${season ?? ''}|${episode ?? ''}|${jour}`).slice(0, 24), key, kind, title, date: jour,
    ...(Number.isFinite(at) && at > 0 && at < AT_MAX ? { at } : {}), ...(season !== undefined ? { season } : {}), ...(episode !== undefined ? { episode } : {}),
    ...(epTitle ? { epTitle } : {}), ...(year !== undefined ? { year } : {}), ...(/^[A-Za-z0-9_.:-]{1,200}$/.test(nas) ? { nas } : {}),
  };
}

/** Garde le relevé de « À venir » d'un genre (il remplace le précédent du même genre). Rend le nombre gardé. */
export function garderSorties(mag: MagasinVenus, kind: GenreSortie, entries: unknown[], maintenant = Date.now()): number {
  if (!GENRES_SORTIE.includes(kind)) throw new Error('genre : movie, show ou anime');
  const vus = new Set<string>(), l: SortieGardee[] = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const x = sortieGardee(e, kind); if (!x || vus.has(x.id)) continue;
    vus.add(x.id); l.push(x); if (l.length >= MAX_SORTIES) break;
  }
  mag.poser('sorties', idReleve(kind), { kind, releve: maintenant, entries: l });
  return l.length;
}
/** Les sorties gardées (d'un genre, ou de tous), dans l'ordre des jours. */
export function sortiesGardees(mag: MagasinVenus, kind?: GenreSortie): SortieGardee[] {
  const out: SortieGardee[] = [];
  for (const k of kind ? [kind] : GENRES_SORTIE) {
    const e = mag.get('sorties', idReleve(k));
    for (const x of Array.isArray(e?.data.entries) ? e.data.entries : []) { const y = sortieGardee(x, k); if (y) out.push(y); }
  }
  return out.sort((a, b) => (a.at ?? Date.parse(`${a.date}T12:00:00Z`)) - (b.at ?? Date.parse(`${b.date}T12:00:00Z`)) || a.title.localeCompare(b.title));
}

/**
 * Ce que le calendrier d'un profil montre : les épisodes des séries déjà dans la bibliothèque, et ce que CE profil a
 * demandé ou mis dans « Mes envies » (♡). Les demandes et envies des autres profils n'y sont jamais.
 */
export function sortiesDuCalendrier(mag: MagasinVenus, profil: string): SortieGardee[] {
  const p = profilHnoss(s(profil)); if (!p) return [];
  const cles = new Set(envies(mag, p).map((d) => d.cle).filter(Boolean) as string[]);
  const demandes = demandesHnoss(mag, p).filter((d) => d.etat !== 'échec');
  // Une demande sans clé se reconnaît à son titre ET à son année quand les deux la portent (pas un homonyme d'une autre année).
  const demandee = (x: SortieGardee) => demandes.some((d) => (d.genre === 'film') === (x.kind === 'movie')
    && (d.cle ? d.cle === x.key : norm(d.titre) === norm(x.title) && (!d.annee || !x.year || d.annee === x.year)));
  return sortiesGardees(mag).filter((x) => (x.kind !== 'movie' && x.nas) || cles.has(x.key) || demandee(x));
}

// ---------------------------------------------------------------- le fichier iCalendar (RFC 5545)
const pad = (n: number, l = 2) => String(n).padStart(l, '0');
const utc = (t: number) => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
/** Le texte d'une valeur, échappé (barre oblique inverse, point-virgule, virgule, retour à la ligne). Pur. */
export const echapperIcs = (t: string): string => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Une ligne pliée à 75 octets (suite précédée d'une espace), sans couper un caractère. Pur. */
export function plierIcs(ligne: string): string {
  const out: string[] = []; let cur = '', n = 0;
  for (const c of ligne) {
    const b = Buffer.byteLength(c), lim = out.length ? 74 : 75;
    if (n + b > lim) { out.push(cur); cur = ''; n = 0; }
    cur += c; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const resume = (x: SortieGardee): string => (x.kind === 'movie' ? x.title
  : `${x.title}${x.season !== undefined ? ` S${pad(x.season)}E${pad(x.episode ?? 0)}` : x.episode !== undefined ? ` E${pad(x.episode)}` : ''}`);
/** Le calendrier (texte iCalendar, fins de ligne CRLF) de ces sorties. Rien : un calendrier vide. Pur. */
export function icsCalendrier(sorties: SortieGardee[], maintenant = Date.now()): string {
  const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Odin//Venus//', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Venus'];
  const stamp = utc(maintenant), vus = new Set<string>();
  for (const x of sorties) {
    if (vus.has(x.id)) continue; vus.add(x.id);
    l.push('BEGIN:VEVENT', `UID:${x.id}@venus.odin`, `DTSTAMP:${stamp}`,
      x.at ? `DTSTART:${utc(x.at)}` : `DTSTART;VALUE=DATE:${x.date.replace(/-/g, '')}`,
      `SUMMARY:${echapperIcs(resume(x))}`, ...(x.epTitle ? [`DESCRIPTION:${echapperIcs(x.epTitle)}`] : []), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  l.push('END:VCALENDAR');
  return `${l.map(plierIcs).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------- le lien personnel
const JETON = /^[A-Za-z0-9_-]{20,100}$/;
const idLien = (jeton: string) => `cal:${empreinte(jeton)}`;
const liensDe = (mag: MagasinVenus, profil: string) => mag.liste('sorties').filter((e) => e.data.calendrier === true && e.data.profil === profil);
/**
 * Le jeton du lien personnel d'un profil : le même tant qu'il vit ; `nouveau` en crée un autre et l'ancien ne vaut
 * plus. En base : l'empreinte (identifiant) et le jeton chiffré par la clé de la machine, jamais le jeton en clair.
 */
export function lienCalendrier(mag: MagasinVenus, home: string, profil: string, o: { nouveau?: boolean; maintenant?: number } = {}): string {
  const p = s(profil); if (!p || p.length > 64) throw new Error('profil inconnu');
  for (const e of liensDe(mag, p)) {
    if (o.nouveau) { mag.retirer('sorties', e.id); continue; }
    try { const j = dechiffrerChamp(home, s(e.data.secret)); if (JETON.test(j) && idLien(j) === e.id) return j; } catch { /* illisible : remplacé */ }
    mag.retirer('sorties', e.id);
  }
  const jeton = randomBytes(24).toString('base64url');
  mag.poser('sorties', idLien(jeton), { calendrier: true, profil: p, secret: chiffrerChamp(home, jeton), cree: o.maintenant ?? Date.now() });
  return jeton;
}
/** Le profil d'un lien de calendrier, ou rien (lien inconnu, remplacé, mal formé). */
export function profilDuCalendrier(mag: MagasinVenus, jeton: string): string | undefined {
  const j = s(jeton); if (!JETON.test(j)) return undefined;
  const e = mag.get('sorties', idLien(j));
  return e && e.data.calendrier === true && s(e.data.profil) ? s(e.data.profil) : undefined;
}
