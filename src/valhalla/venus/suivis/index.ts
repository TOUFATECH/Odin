// Vénus · Sirius (films) et Pléiades (séries et animés) : la liste suivie. Chaque titre suivi garde la qualité
// voulue, le dossier de la bibliothèque où il sera rangé, et ce qui manque encore (le film, ou les épisodes).
// Rangé dans VENUS_ODIN, collection `envies` ; les réglages (qualité, dossier par défaut) dans `acq_reglages`.
//
// Un titre arrive dans la liste tout seul : depuis une demande (Hnoss) ou depuis « À venir ». Ce qui est déjà dans la
// bibliothèque (même identifiant que le rangement du scan) ne manque pas.
import type { MagasinVenus } from '../base.ts';
import { dossiers, slug, type Categorie } from '../bibliotheque.ts';
import { QUALITES, type Qualite } from '../delta/index.ts';

export type Applicatif = 'sirius' | 'pleiades';
export interface EpisodeVoulu { saison: number; episode: number; etat: 'manquant' | 'en téléchargement' | 'disponible' | 'échec'; telechargement?: string; note?: string }
export interface Suivi {
  id: string; applicatif: Applicatif; genre: 'film' | 'serie'; titre: string; annee?: number; anime?: boolean;
  qualite: Qualite; dossier: string; langue: 'vf' | 'toutes';
  /** film : son état ; série : saisons suivies et épisodes voulus */
  etat: 'manquant' | 'en téléchargement' | 'disponible' | 'échec'; saisons: number[]; episodes: EpisodeVoulu[];
  demandes: string[]; ajoute: number; telechargement?: string; note?: string;
}
export interface ReglagesSuivi { qualite: Qualite; dossier: string; dossierAnimes: string; langue: 'vf' | 'toutes' }
const s = (v: unknown) => String(v ?? '').trim();
export const CATEGORIE_DE: Record<Applicatif, Categorie> = { sirius: 'films', pleiades: 'series' };

/** Les réglages d'un applicatif (qualité voulue, dossier par défaut). */
export function reglagesSuivi(mag: MagasinVenus, a: Applicatif): ReglagesSuivi {
  const d = mag.get('acq_reglages', a)?.data ?? {};
  return { qualite: (QUALITES as string[]).includes(s(d.qualite)) ? s(d.qualite) as Qualite : '1080p', dossier: s(d.dossier), dossierAnimes: s(d.dossierAnimes), langue: d.langue === 'toutes' ? 'toutes' : 'vf' };
}
/** Règle un applicatif. Le dossier doit être un dossier DÉCLARÉ de la bibliothèque, de la bonne catégorie. */
export function reglerSuivi(mag: MagasinVenus, a: Applicatif, p: Partial<ReglagesSuivi>): ReglagesSuivi {
  const avant = reglagesSuivi(mag, a), n = { ...avant };
  if (p.qualite !== undefined) { if (!(QUALITES as string[]).includes(s(p.qualite))) throw new Error(`qualité : ${QUALITES.join(', ')}`); n.qualite = p.qualite; }
  for (const k of ['dossier', 'dossierAnimes'] as const) if (p[k] !== undefined) { const c = s(p[k]); if (c && !dossierDeclare(mag, c, CATEGORIE_DE[a])) throw new Error(`« ${c} » n'est pas un dossier « ${CATEGORIE_DE[a]} » déclaré dans Vénus : déclare-le d'abord (Réglages → Dossiers)`); n[k] = c; }
  if (p.langue !== undefined) n.langue = p.langue === 'toutes' ? 'toutes' : 'vf';
  mag.poser('acq_reglages', a, { ...n });
  return n;
}
/** Ce chemin est-il exactement un dossier déclaré (actif) de cette catégorie ? */
export const dossierDeclare = (mag: MagasinVenus, chemin: string, c: Categorie): boolean => dossiers(mag).some((d) => d.actif && d.categorie === c && d.chemin === chemin);
/** Le dossier où ranger : celui du réglage, sinon le premier dossier déclaré de la catégorie (rien si aucun). */
export function dossierCible(mag: MagasinVenus, a: Applicatif, anime = false): string | undefined {
  const r = reglagesSuivi(mag, a), c = CATEGORIE_DE[a];
  for (const x of [anime ? r.dossierAnimes : '', r.dossier]) if (x && dossierDeclare(mag, x, c)) return x;
  return dossiers(mag).find((d) => d.actif && d.categorie === c)?.chemin;
}
/** L'identifiant d'un suivi : le même que l'œuvre rangée par le scan (film:slug-annee, serie:slug). Pur. */
export const idSuivi = (genre: 'film' | 'serie', titre: string, annee?: number): string => (genre === 'film' ? `film:${slug(titre)}${annee ? `-${annee}` : ''}` : `serie:${slug(titre)}`);

const versSuivi = (e: { id: string; data: Record<string, unknown>; maj: number }): Suivi => ({ id: e.id, ...(e.data as Omit<Suivi, 'id'>) });
export const suivi = (mag: MagasinVenus, id: string): Suivi | undefined => { const e = mag.get('envies', id); return e && e.data.applicatif ? versSuivi(e) : undefined; };
export const suivis = (mag: MagasinVenus, a?: Applicatif): Suivi[] => mag.liste('envies').filter((e) => e.data.applicatif && (!a || e.data.applicatif === a)).map(versSuivi).sort((x, y) => y.ajoute - x.ajoute);
export function poserSuivi(mag: MagasinVenus, x: Suivi): Suivi { const { id, ...data } = x; mag.poser('envies', id, data as unknown as Record<string, unknown>); return suivi(mag, id)!; }

/**
 * Ajoute un titre à la liste suivie (ou complète celui qui y est : nouvelles saisons, nouveaux épisodes). Un film déjà
 * dans la bibliothèque est « disponible » ; un épisode déjà là aussi.
 */
export function suivre(mag: MagasinVenus, o: { genre: 'film' | 'serie'; titre: string; annee?: number; anime?: boolean; saisons?: number[]; episodes?: Array<{ saison: number; episode: number }>; demande?: string; qualite?: Qualite }): Suivi {
  const a: Applicatif = o.genre === 'film' ? 'sirius' : 'pleiades', r = reglagesSuivi(mag, a), id = idSuivi(o.genre, o.titre, o.annee);
  const avant = suivi(mag, id), dossier = avant?.dossier && dossierDeclare(mag, avant.dossier, CATEGORIE_DE[a]) ? avant.dossier : dossierCible(mag, a, o.anime) ?? '';
  const eps = [...(avant?.episodes ?? [])];
  for (const e of o.episodes ?? []) if (!eps.some((x) => x.saison === e.saison && x.episode === e.episode)) eps.push({ saison: e.saison, episode: e.episode, etat: 'manquant' });
  const x: Suivi = {
    id, applicatif: a, genre: o.genre, titre: avant?.titre ?? o.titre, ...(o.annee ?? avant?.annee ? { annee: o.annee ?? avant?.annee } : {}), ...(o.anime || avant?.anime ? { anime: true } : {}),
    qualite: o.qualite ?? avant?.qualite ?? r.qualite, dossier, langue: avant?.langue ?? r.langue,
    etat: avant?.etat ?? 'manquant', saisons: [...new Set([...(avant?.saisons ?? []), ...(o.saisons ?? [])])].sort((p, q) => p - q), episodes: eps.sort((p, q) => p.saison - q.saison || p.episode - q.episode),
    demandes: [...new Set([...(avant?.demandes ?? []), ...(o.demande ? [o.demande] : [])])], ajoute: avant?.ajoute ?? Date.now(),
    ...(avant?.telechargement ? { telechargement: avant.telechargement } : {}),
  };
  return poserSuivi(mag, recompter(mag, x));
}
/** Remet les états d'après la bibliothèque (ce qui y est rangé est disponible). */
export function recompter(mag: MagasinVenus, x: Suivi): Suivi {
  if (x.genre === 'film') { if (mag.get('oeuvres', x.id)) { x.etat = 'disponible'; delete x.telechargement; } return x; }
  for (const e of x.episodes) if (mag.get('episodes', `${x.id}:s${e.saison}e${e.episode}`)) { e.etat = 'disponible'; delete e.telechargement; }
  x.etat = x.episodes.length && x.episodes.every((e) => e.etat === 'disponible') ? 'disponible' : x.episodes.some((e) => e.etat === 'en téléchargement') ? 'en téléchargement' : 'manquant';
  return x;
}
/** Ce qui manque (film ou épisodes), après relecture de la bibliothèque. */
export function manquants(mag: MagasinVenus, x: Suivi): Array<{ saison?: number; episode?: number }> {
  const r = recompter(mag, x);
  if (r.genre === 'film') return r.etat === 'manquant' || r.etat === 'échec' ? [{}] : [];
  return r.episodes.filter((e) => e.etat === 'manquant' || e.etat === 'échec').map((e) => ({ saison: e.saison, episode: e.episode }));
}
export function retirerSuivi(mag: MagasinVenus, id: string): boolean { return suivi(mag, id) ? mag.retirer('envies', id) : false; }
/** Une ligne lisible. Pur. */
export const ligneSuivi = (x: Suivi): string => {
  const ep = (e: EpisodeVoulu) => `S${String(e.saison).padStart(2, '0')}E${String(e.episode).padStart(2, '0')}`;
  const manque = x.episodes.filter((e) => e.etat !== 'disponible');
  return `${x.genre === 'film' ? '🎬' : '📺'} ${x.titre}${x.annee ? ` (${x.annee})` : ''} · ${x.qualite} · ${x.etat}${x.genre === 'serie' ? ` · ${x.episodes.length - manque.length}/${x.episodes.length} épisode(s)${manque.length ? ` · manque ${manque.slice(0, 6).map(ep).join(', ')}${manque.length > 6 ? '…' : ''}` : ''}` : ''}${x.dossier ? '' : ' · aucun dossier de bibliothèque'}`;
};
