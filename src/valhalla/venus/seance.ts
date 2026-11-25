// Vénus, la maison (lot V8) : le vote en famille et les séances, comme Vote.js et Seance.js du dépôt Venus.
//
//  - Le vote : l'écran principal propose les idées de « Ce soir » ; chacun rejoint avec un code de 4 lettres (ou le QR)
//    et touche son choix, qu'il peut changer tant que le vote est ouvert ; « Voir le résultat » clôt le vote et Odin
//    donne le gagnant (le plus de voix ; à égalité, l'idée proposée en premier). Une voix par appareil.
//  - La séance : une salle (un code de 4 lettres) attachée à un titre ; la rejoindre ouvre ce titre.
//
// Rangé dans la table « seances » de VENUS_ODIN (repli fichiers). Tout expire (3 h) et le nombre est borné. Seul le
// propriétaire (et ses profils) y entre : la garde des routes de Vénus passe avant. Rien n'est lu sur Internet.
import { randomInt } from 'node:crypto';
import type { Enr, MagasinVenus } from './base.ts';
import { catalogue } from './app/appli.ts';

export const DUREE_MS = 3 * 60 * 60 * 1000;
const MAX_OUVERTS = 20, MAX_IDEES = 6, MAX_VOTANTS = 40;
const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O (confondus avec 1 et 0)
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();

/** Un code tel que tapé : 4 lettres ou chiffres, en majuscules. Pur. */
export const codeNet = (v: unknown): string => s(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
const vivants = (mag: MagasinVenus, genre: 'vote' | 'salle', maintenant: number): Enr[] => {
  const l: Enr[] = [];
  for (const e of mag.liste('seances')) { if (Number(e.data.expire) <= maintenant) { mag.retirer('seances', e.id); continue; } if (e.data.genre === genre) l.push(e); }
  return l;
};
function nouveauCode(mag: MagasinVenus, prefixe: string): string {
  for (let i = 0; i < 50; i++) { const c = Array.from({ length: 4 }, () => LETTRES[randomInt(LETTRES.length)]).join(''); if (!mag.get('seances', `${prefixe}-${c}`)) return c; }
  throw new Error('Trop de codes ouverts : réessayez dans un moment.');
}

// ---------------------------------------------------------------- vote
export interface IdeeVote { id: string; title: string; year?: number; runtime?: number; poster?: string; backdrop?: string; votes: number; voters: string[] }
export interface EtatVote { code: string; host: string; items: IdeeVote[]; voters: number; done: boolean; winner: string | null }
type Voix = Record<string, { item: string; nom: string }>;

function etat(e: Enr): EtatVote {
  const voix = (e.data.voix ?? {}) as Voix, idees = (e.data.idees ?? []) as Array<Omit<IdeeVote, 'votes' | 'voters'>>;
  const items = idees.map((x) => { const v = Object.values(voix).filter((y) => y.item === x.id); return { ...x, votes: v.length, voters: v.map((y) => y.nom).filter(Boolean) }; });
  return { code: s(e.data.code), host: s(e.data.hote), items, voters: Object.keys(voix).length, done: e.data.clos === true, winner: e.data.clos === true ? s(e.data.gagnant) || null : null };
}

/** Ouvre un vote sur 2 à 6 titres de la bibliothèque (les idées de « Ce soir »). */
export function creerVote(mag: MagasinVenus, profil: string, hote: string, itemIds: unknown, maintenant = Date.now()): EtatVote | { erreur: string } {
  const titres = new Map(catalogue(mag, profil).map((x) => [x.id, x]));
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).map(s))].filter((id) => titres.has(id)).slice(0, MAX_IDEES);
  if (ids.length < 2) return { erreur: 'Il faut au moins deux idées pour voter.' };
  if (vivants(mag, 'vote', maintenant).length >= MAX_OUVERTS) return { erreur: 'Trop de votes ouverts : réessayez dans un moment.' };
  const code = nouveauCode(mag, 'vote');
  const idees = ids.map((id) => { const x = titres.get(id)!; return { id, title: x.title, ...(x.year ? { year: x.year } : {}), ...(x.runtime ? { runtime: x.runtime } : {}), ...(x.poster ? { poster: x.poster } : {}), ...(x.backdrop ? { backdrop: x.backdrop } : {}) }; });
  return etat(mag.poser('seances', `vote-${code}`, { genre: 'vote', code, hote: s(hote).slice(0, 60), idees, voix: {}, clos: false, cree: maintenant, expire: maintenant + DUREE_MS }));
}
const voteDe = (mag: MagasinVenus, code: unknown, maintenant: number): Enr | undefined => { const c = codeNet(code); return c.length === 4 ? vivants(mag, 'vote', maintenant).find((e) => e.data.code === c) : undefined; };
/** L'état d'un vote (pour l'écran principal et chaque téléphone), ou rien s'il n'existe pas (ou plus). */
export function lireVote(mag: MagasinVenus, code: unknown, maintenant = Date.now()): EtatVote | undefined { const e = voteDe(mag, code, maintenant); return e ? etat(e) : undefined; }
/** Une voix (ou un changement d'avis) : une par appareil, tant que le vote est ouvert. */
export function voter(mag: MagasinVenus, code: unknown, itemId: unknown, client: unknown, nom: string, maintenant = Date.now()): EtatVote | { erreur: string } {
  const e = voteDe(mag, code, maintenant); if (!e) return { erreur: 'Vote introuvable ou terminé.' };
  if (e.data.clos === true) return { erreur: 'Le vote est terminé.' };
  const it = s(itemId), cl = s(client).replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  if (!cl) return { erreur: 'Appareil inconnu.' };
  if (!((e.data.idees ?? []) as Array<{ id: string }>).some((x) => x.id === it)) return { erreur: 'Ce titre ne fait pas partie du vote.' };
  const voix = { ...((e.data.voix ?? {}) as Voix) };
  if (!voix[cl] && Object.keys(voix).length >= MAX_VOTANTS) return { erreur: 'Trop de votants.' };
  voix[cl] = { item: it, nom: s(nom).slice(0, 60) };
  return etat(mag.poser('seances', e.id, { ...e.data, voix }));
}
/** Clôt le vote : le gagnant est l'idée qui a le plus de voix (à égalité, celle proposée en premier). */
export function cloreVote(mag: MagasinVenus, code: unknown, maintenant = Date.now()): EtatVote | { erreur: string } {
  const e = voteDe(mag, code, maintenant); if (!e) return { erreur: 'Vote introuvable ou terminé.' };
  if (e.data.clos === true) return etat(e);
  const st = etat(e), gagnant = st.items.reduce((a, b) => (b.votes > a.votes ? b : a), st.items[0]);
  return etat(mag.poser('seances', e.id, { ...e.data, clos: true, gagnant: gagnant ? gagnant.id : '' }));
}

// ---------------------------------------------------------------- séance
export interface Salle { code: string; itemId: string; host: string; expire: number }
const salleDe = (e: Enr): Salle => ({ code: s(e.data.code), itemId: s(e.data.item), host: s(e.data.hote), expire: Number(e.data.expire) });
/** Ouvre une salle de séance pour un titre que le lecteur sait ouvrir (film, clip ou épisode de la bibliothèque). */
export function creerSalle(mag: MagasinVenus, itemId: unknown, hote: string, maintenant = Date.now()): Salle | { erreur: string } {
  const id = s(itemId), ok = (mag.get('oeuvres', id)?.data.type === 'film') || !!mag.get('episodes', id);
  if (!ok) return { erreur: 'Ce titre n’est pas (ou plus) dans la bibliothèque.' };
  if (vivants(mag, 'salle', maintenant).length >= MAX_OUVERTS) return { erreur: 'Trop de séances ouvertes : réessayez dans un moment.' };
  const code = nouveauCode(mag, 'salle');
  return salleDe(mag.poser('seances', `salle-${code}`, { genre: 'salle', code, item: id, hote: s(hote).slice(0, 60), cree: maintenant, expire: maintenant + DUREE_MS }));
}
/** Une salle par son code, ou rien (code mal formé, inconnu, expiré, titre retiré de la bibliothèque). */
export function lireSalle(mag: MagasinVenus, code: unknown, maintenant = Date.now()): Salle | undefined {
  const c = codeNet(code); if (c.length !== 4) return undefined;
  const e = vivants(mag, 'salle', maintenant).find((x) => x.data.code === c); if (!e) return undefined;
  const sa = salleDe(e); return mag.get('oeuvres', sa.itemId) || mag.get('episodes', sa.itemId) ? sa : undefined;
}
