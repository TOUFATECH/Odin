// Vénus, la maison (lot V8) : les collections et les listes de lecture, comme Collections.js du dépôt Venus.
//
//  - Une collection rassemble des films, séries ou clips de la bibliothèque. Elle est faite (et changée) par le profil
//    du propriétaire ; tous les profils la voient. Les sagas regroupées d'après le grand catalogue n'existent pas ici :
//    les fiches gardées par Odin ne disent pas à quelle saga appartient un film (rien n'est deviné).
//  - Une liste de lecture appartient à UN profil : des films, clips ou épisodes dans l'ordre choisi (ajouter une série
//    ajoute tous ses épisodes). Un autre profil ne la voit pas, ne la lit pas et ne la change pas.
//
// Rangé dans la table « collections » de VENUS_ODIN (repli fichiers). Noms bornés, nombres bornés.
import { randomBytes } from 'node:crypto';
import type { Enr, MagasinVenus } from './base.ts';
import { episodes } from './bibliotheque.ts';
import { vignetteFaite } from './vignettes.ts';
import { catalogue, PROFIL_PROPRIETAIRE, type TitreVenus } from './app/appli.ts';

const MAX_LISTES = 200, MAX_ELEMENTS = 500, NOM_MAX = 80;
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();
const ID = /^[cl]-[a-f0-9]{12}$/;
/** Un nom de liste ou de collection : une ligne, sans caractère de contrôle, 80 signes au plus. Pur. */
export const nomNet = (v: unknown): string => s(v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOM_MAX);
export const estProprietaire = (profil: string): boolean => profil === PROFIL_PROPRIETAIRE;

type Genre = 'collection' | 'liste';
const tous = (mag: MagasinVenus, g: Genre) => mag.liste('collections').filter((e) => e.data.genre === g && ID.test(e.id));
const elements = (e: Enr): string[] => (Array.isArray(e.data.items) ? (e.data.items as unknown[]).map(s).filter(Boolean) : []);
/** Une collection, ou une liste de CE profil (jamais celle d'un autre). */
function trouver(mag: MagasinVenus, g: Genre, id: unknown, profil: string): Enr | undefined {
  const e = mag.get('collections', s(id)); if (!e || !ID.test(e.id) || e.data.genre !== g) return undefined;
  return g === 'liste' && e.data.profil !== profil ? undefined : e;
}

// Ce qu'on peut mettre dedans : une œuvre (film, série, clip) pour une collection ; un film, un clip ou un épisode pour
// une liste (une série donne tous ses épisodes, dans l'ordre).
const oeuvreOk = (mag: MagasinVenus, id: string) => { const t = mag.get('oeuvres', id)?.data.type; return t === 'film' || t === 'serie'; };
function ciblesDe(mag: MagasinVenus, id: string): string[] {
  const o = mag.get('oeuvres', id);
  if (o?.data.type === 'film') return [id];
  if (o?.data.type === 'serie') return episodes(mag, id).map((e) => e.id);
  return mag.get('episodes', id) ? [id] : [];
}

export interface Tuile { id: string; name: string; count: number; posters: string[]; duration?: number; auto: false }
/** « Collections » : les collections (tous les profils) et les listes de lecture DU profil. */
export function collections(mag: MagasinVenus, profil: string): { collections: Tuile[]; playlists: Tuile[] } {
  const titres = new Map<string, TitreVenus>(catalogue(mag, profil).map((x) => [x.id, x]));
  const posterDe = (id: string) => titres.get(id)?.poster ?? titres.get(s(mag.get('episodes', id)?.data.oeuvre_id))?.poster;
  const tuile = (e: Enr, cibles: boolean): Tuile => {
    const l = elements(e).filter((id) => (cibles ? mag.get('oeuvres', id) || mag.get('episodes', id) : titres.has(id)));
    const posters = [...new Set(l.map(posterDe).filter((x): x is string => !!x))].slice(0, 4);
    const duree = cibles ? l.reduce((a, id) => a + (Number((mag.get('episodes', id) ?? mag.get('oeuvres', id))?.data.duree) || 0), 0) : 0;
    return { id: e.id, name: s(e.data.nom), count: l.length, posters, ...(duree ? { duration: duree } : {}), auto: false };
  };
  const tri = (a: Enr, b: Enr) => Number(b.data.cree) - Number(a.data.cree);
  return { collections: tous(mag, 'collection').sort(tri).map((e) => tuile(e, false)), playlists: tous(mag, 'liste').filter((e) => e.data.profil === profil).sort(tri).map((e) => tuile(e, true)) };
}

/** Une collection : ses titres (vus par ce profil) ; « editable » pour le profil du propriétaire. */
export function collection(mag: MagasinVenus, profil: string, id: unknown): { id: string; name: string; items: TitreVenus[]; editable: boolean; auto: false } | undefined {
  const e = trouver(mag, 'collection', id, profil); if (!e) return undefined;
  const titres = new Map(catalogue(mag, profil).map((x) => [x.id, x]));
  return { id: e.id, name: s(e.data.nom), items: elements(e).map((x) => titres.get(x)).filter((x): x is TitreVenus => !!x), editable: estProprietaire(profil), auto: false };
}

export interface ElementListe { id: string; title: string; showTitle?: string; season?: number; episode?: number; year?: number; duration?: number; still?: string; backdrop?: string; progress?: { position: number; watched: boolean } }
/** Une liste de lecture de CE profil : ses vidéos dans l'ordre, avec où il en est. */
export function liste(mag: MagasinVenus, profil: string, id: unknown): { id: string; name: string; items: ElementListe[]; duration: number } | undefined {
  const e = trouver(mag, 'liste', id, profil); if (!e) return undefined;
  const titres = new Map(catalogue(mag, profil).map((x) => [x.id, x]));
  const items = elements(e).flatMap((cid): ElementListe[] => {
    const ep = mag.get('episodes', cid), o = ep ? mag.get('oeuvres', s(ep.data.oeuvre_id)) : mag.get('oeuvres', cid); if (!o) return [];
    const t = titres.get(o.id), r = mag.get('reprise', `${profil}:${cid}`), duree = Number((ep ?? o).data.duree) || 0;
    const pos = r ? Number(r.data.position_s) || 0 : 0, dr = (r && Number(r.data.duree_s)) || duree, still = vignetteFaite(mag, cid);
    return [{ id: cid, title: ep ? s(ep.data.titre) || (t?.title ?? s(o.data.titre)) : (t?.title ?? s(o.data.titre)), ...(ep ? { showTitle: t?.title ?? s(o.data.titre), season: Number(ep.data.saison), episode: Number(ep.data.episode) } : {}),
      ...(!ep && t?.year ? { year: t.year } : {}), ...(duree ? { duration: duree } : {}), ...(still ? { still } : {}), ...(t?.backdrop ? { backdrop: t.backdrop } : {}),
      ...(r ? { progress: { position: pos, watched: dr > 0 && pos >= dr * 0.95 } } : {}) }];
  });
  return { id: e.id, name: s(e.data.nom), items, duration: items.reduce((a, x) => a + (x.duration ?? 0), 0) };
}

const nouvelId = (g: Genre) => `${g === 'collection' ? 'c' : 'l'}-${randomBytes(6).toString('hex')}`;
type Refus = { erreur: string; code: number };

/** Crée une collection (profil du propriétaire seulement), avec un premier titre si donné. */
export function creerCollection(mag: MagasinVenus, profil: string, nom: unknown, itemId?: unknown): { id: string; name: string } | Refus {
  if (!estProprietaire(profil)) return { erreur: 'Seul le propriétaire crée une collection.', code: 403 };
  const n = nomNet(nom); if (!n) return { erreur: 'Donnez un nom à la collection', code: 400 };
  if (tous(mag, 'collection').length >= MAX_LISTES) return { erreur: 'Trop de collections.', code: 409 };
  const it = s(itemId), id = nouvelId('collection');
  mag.poser('collections', id, { genre: 'collection', nom: n, items: it && oeuvreOk(mag, it) ? [it] : [], cree: Date.now() });
  return { id, name: n };
}
/** Crée une liste de lecture pour ce profil ; un titre donné y entre tout de suite (une série : tous ses épisodes). */
export function creerListe(mag: MagasinVenus, profil: string, nom: unknown, itemId?: unknown): { id: string; name: string; added: number } | Refus {
  const n = nomNet(nom); if (!n) return { erreur: 'Donnez un nom à la liste', code: 400 };
  if (tous(mag, 'liste').filter((e) => e.data.profil === profil).length >= MAX_LISTES) return { erreur: 'Trop de listes.', code: 409 };
  const items = itemId ? ciblesDe(mag, s(itemId)).slice(0, MAX_ELEMENTS) : [], id = nouvelId('liste');
  mag.poser('collections', id, { genre: 'liste', profil, nom: n, items, cree: Date.now() });
  return { id, name: n, added: items.length };
}

/**
 * Change une collection ou une liste : renommer, supprimer (les vidéos restent dans Vénus), ajouter, retirer, ou
 * (liste) remettre dans un ordre donné. Une collection ne se change que depuis le profil du propriétaire ; une liste
 * seulement par son profil.
 */
export function changer(mag: MagasinVenus, profil: string, genre: Genre, id: unknown, b: Record<string, unknown>): { ok: true; added?: number } | Refus {
  const e = trouver(mag, genre, id, profil); if (!e) return { erreur: 'introuvable', code: 404 };
  if (genre === 'collection' && !estProprietaire(profil)) return { erreur: 'Seul le propriétaire change une collection.', code: 403 };
  const faire = s(b.faire), l = elements(e);
  if (faire === 'supprimer') { mag.retirer('collections', e.id); return { ok: true }; }
  if (faire === 'renommer') { const n = nomNet(b.name); if (!n) return { erreur: 'Le nom est obligatoire', code: 400 }; mag.poser('collections', e.id, { ...e.data, nom: n }); return { ok: true }; }
  if (faire === 'retirer') { const it = s(b.itemId); mag.poser('collections', e.id, { ...e.data, items: l.filter((x) => x !== it) }); return { ok: true }; }
  if (faire === 'ajouter') {
    const it = s(b.itemId), neufs = genre === 'collection' ? (oeuvreOk(mag, it) ? [it] : []) : ciblesDe(mag, it);
    if (!neufs.length) return { erreur: 'Ce titre n’est pas (ou plus) dans la bibliothèque.', code: 404 };
    const ajout = neufs.filter((x) => !l.includes(x)), tout = [...l, ...ajout];
    if (tout.length > MAX_ELEMENTS) return { erreur: 'Liste pleine.', code: 409 };
    if (ajout.length) mag.poser('collections', e.id, { ...e.data, items: tout });
    return { ok: true, added: ajout.length };
  }
  if (faire === 'ordre' && genre === 'liste') {
    // Le nouvel ordre ne peut que réordonner ce qui est déjà là : rien n'entre ni ne se perd par là.
    const o = (Array.isArray(b.order) ? b.order : []).map(s), memes = o.length === l.length && [...o].sort().join('\n') === [...l].sort().join('\n');
    if (!memes) return { erreur: 'Ordre invalide.', code: 400 };
    mag.poser('collections', e.id, { ...e.data, items: o }); return { ok: true };
  }
  return { erreur: 'Action inconnue.', code: 400 };
}
