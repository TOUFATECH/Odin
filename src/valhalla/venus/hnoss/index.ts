// Vénus · Hnoss : les demandes et les envies. Une demande (un film, ou une série et ses saisons) est gardée dans
// VENUS_ODIN, dans la collection privée `demandes` (chiffrée au repos, jamais dans une vue en clair), avec qui l'a faite
// et où elle en est : à valider, en attente, cherchée, en téléchargement, disponible, échec.
//
// Qui peut demander : le propriétaire, et un membre de la famille SI ses droits sur Vénus le permettent (le contrôle
// est fait par Valhalla avant l'action). La demande d'un membre attend la validation du propriétaire : seul lui lance
// un téléchargement.
import { randomBytes } from 'node:crypto';
import type { Enr, MagasinVenus } from '../base.ts';

export type EtatDemande = 'à valider' | 'en attente' | 'cherchée' | 'en téléchargement' | 'disponible' | 'échec';
export const ETATS_DEMANDE: EtatDemande[] = ['à valider', 'en attente', 'cherchée', 'en téléchargement', 'disponible', 'échec'];
export type GenreDemande = 'film' | 'serie';
export interface Demande {
  id: string; genre: GenreDemande; titre: string; annee?: number; anime?: boolean; saisons?: number[]; episodes?: Array<{ saison: number; episode: number }>;
  /** le profil de Vénus (« moi » pour le propriétaire, l'identifiant du membre sinon) */
  profil: string; qui: { login: string; nom: string; proprietaire: boolean };
  etat: EtatDemande; note?: string; valideePar?: string; suivi?: string; quand: number; maj: number;
  /** une envie (♡ dans « À venir » ou « Nouveautés ») et la clé de sa sortie dans le catalogue */ envie?: boolean; cle?: string;
}
/** Le profil du propriétaire dans Vénus (le même que les routes /venus/*). */
export const PROFIL_PROPRIETAIRE = 'moi';
const s = (v: unknown) => String(v ?? '').trim();
const propre = (t: string, n: number) => t.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

const versDemande = (e: Enr): Demande => {
  const d = e.data;
  return {
    id: e.id, genre: d.genre === 'serie' || d.type === 'série' || d.type === 'serie' ? 'serie' : 'film', titre: s(d.titre),
    ...(Number(d.annee) ? { annee: Number(d.annee) } : {}), ...(d.anime === true ? { anime: true } : {}),
    ...(Array.isArray(d.saisons) && d.saisons.length ? { saisons: (d.saisons as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 0) } : {}),
    ...(Array.isArray(d.episodes) && d.episodes.length ? { episodes: d.episodes as Demande['episodes'] } : {}),
    profil: s(d.profil) || PROFIL_PROPRIETAIRE, qui: (d.qui as Demande['qui']) ?? { login: s(d.profil) || PROFIL_PROPRIETAIRE, nom: '', proprietaire: (s(d.profil) || PROFIL_PROPRIETAIRE) === PROFIL_PROPRIETAIRE },
    etat: (ETATS_DEMANDE as string[]).includes(s(d.etat)) ? s(d.etat) as EtatDemande : 'en attente',
    ...(d.note ? { note: s(d.note) } : {}), ...(d.valideePar ? { valideePar: s(d.valideePar) } : {}), ...(d.suivi ? { suivi: s(d.suivi) } : {}),
    quand: Number(d.quand) || e.maj, maj: e.maj, ...(d.envie === true ? { envie: true } : {}), ...(d.cle ? { cle: s(d.cle) } : {}),
  };
};
/** Les saisons d'une demande, lues dans « 1 », « 1,2 », « 1-3 » ou un tableau. Pur. */
export function lireSaisons(v: unknown): number[] {
  if (Array.isArray(v)) return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 100))].sort((a, b) => a - b);
  const out = new Set<number>();
  for (const p of s(v).split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(p); if (!m) throw new Error(`saisons : « ${p} » n'est pas un numéro (ex. 1, 1-3, 1,2)`);
    const a = Number(m[1]), b = Number(m[2] ?? m[1]); for (let k = Math.min(a, b); k <= Math.max(a, b) && out.size < 60; k++) out.add(k);
  }
  return [...out].sort((a, b) => a - b);
}

/** Pose une demande (une seule ouverte par titre, année, genre et profil : la même revient). */
export function demander(mag: MagasinVenus, o: { genre: GenreDemande; titre: string; annee?: number; anime?: boolean; saisons?: number[]; episodes?: Array<{ saison: number; episode: number }>; qui: Demande['qui']; envie?: boolean; cle?: string }): Demande {
  const titre = propre(o.titre, 200); if (!titre) throw new Error('donne un titre');
  if (o.genre !== 'film' && o.genre !== 'serie') throw new Error('genre : film ou série');
  const profil = o.qui.proprietaire ? PROFIL_PROPRIETAIRE : propre(o.qui.login, 60);
  const deja = mag.liste('demandes').map(versDemande).find((d) => d.profil === profil && d.genre === o.genre && d.titre.toLowerCase() === titre.toLowerCase() && (d.annee ?? 0) === (o.annee ?? 0) && d.etat !== 'échec' && d.etat !== 'disponible');
  const id = deja?.id ?? `h-${randomBytes(9).toString('hex')}`;
  const saisons = [...new Set([...(deja?.saisons ?? []), ...(o.saisons ?? [])])].sort((a, b) => a - b);
  const episodes = [...(deja?.episodes ?? []), ...(o.episodes ?? [])].filter((x, k, l) => l.findIndex((y) => y.saison === x.saison && y.episode === x.episode) === k);
  mag.poser('demandes', id, {
    genre: o.genre, type: o.genre === 'serie' ? 'série' : 'film', titre, ...(o.annee ? { annee: o.annee } : {}), ...(o.anime || deja?.anime ? { anime: true } : {}), ...(saisons.length ? { saisons } : {}), ...(episodes.length ? { episodes } : {}),
    profil, qui: { login: propre(o.qui.login, 60), nom: propre(o.qui.nom, 60), proprietaire: o.qui.proprietaire },
    etat: deja?.etat ?? (o.qui.proprietaire ? 'en attente' : 'à valider'), ...(deja?.valideePar ? { valideePar: deja.valideePar } : {}), ...(deja?.suivi ? { suivi: deja.suivi } : {}),
    quand: deja?.quand ?? Date.now(), ...(o.envie || deja?.envie ? { envie: true } : {}), ...(propre(s(o.cle), 120) || deja?.cle ? { cle: propre(s(o.cle), 120) || deja?.cle } : {}),
  });
  return demande(mag, id)!;
}
export const demande = (mag: MagasinVenus, id: string): Demande | undefined => { const e = mag.get('demandes', id); return e ? versDemande(e) : undefined; };
/** Les demandes (toutes pour le propriétaire, les siennes pour un membre), les plus récentes d'abord. */
export const demandesHnoss = (mag: MagasinVenus, profil?: string): Demande[] =>
  mag.liste('demandes').map(versDemande).filter((d) => !profil || d.profil === profil).sort((a, b) => b.quand - a.quand);
/** Change l'état d'une demande (et sa note). */
export function majDemande(mag: MagasinVenus, id: string, p: Partial<Pick<Demande, 'etat' | 'note' | 'valideePar' | 'suivi'>>): Demande | undefined {
  const e = mag.get('demandes', id); if (!e) return undefined;
  mag.poser('demandes', id, { ...e.data, ...p, ...(p.note !== undefined ? { note: propre(p.note, 300) } : {}) });
  return demande(mag, id);
}
export function retirerDemande(mag: MagasinVenus, id: string): boolean { return mag.retirer('demandes', id); }
/** Une demande trouvée par son identifiant ou son titre. */
export function trouverDemande(mag: MagasinVenus, q: string): Demande | undefined {
  const l = demandesHnoss(mag), t = s(q).toLowerCase();
  return l.find((d) => d.id === s(q)) ?? l.find((d) => d.titre.toLowerCase() === t) ?? l.find((d) => d.titre.toLowerCase().includes(t));
}
/** Une ligne lisible. Pur. */
export const ligneDemande = (d: Demande): string => `${d.genre === 'serie' ? '📺' : '🎬'} ${d.titre}${d.annee ? ` (${d.annee})` : ''}${d.saisons?.length ? ` · saison(s) ${d.saisons.join(', ')}` : ''} · ${d.etat}${d.qui.proprietaire ? '' : ` · demandé par ${d.qui.nom || d.qui.login}`}${d.note ? ` · ${d.note}` : ''}`;

// ---------------------------------------------------------------- Mes envies (♡)
/** Les envies d'un profil (les demandes marquées ♡), les plus récentes d'abord. */
export const envies = (mag: MagasinVenus, profil: string): Demande[] => demandesHnoss(mag, profil).filter((d) => d.envie);
/** Retire une envie (par sa clé de catalogue ou son identifiant) : une demande pas encore lancée est retirée, sinon
 *  elle perd seulement son ♡ (ce qui est en téléchargement ou rangé n'est pas touché). Rend la demande touchée. */
export function retirerEnvie(mag: MagasinVenus, profil: string, q: string): Demande | undefined {
  const d = envies(mag, profil).find((x) => x.id === q || (x.cle && x.cle === q)); if (!d) return undefined;
  if (d.etat === 'à valider' || (d.etat === 'en attente' && !d.suivi) || d.etat === 'échec') { retirerDemande(mag, d.id); return d; }
  const e = mag.get('demandes', d.id)!; const { envie: _e, ...reste } = e.data; mag.poser('demandes', d.id, reste);
  return demande(mag, d.id);
}

// ---------------------------------------------------------------- Demandes au nom de chacun (membres « libres »)
// Le propriétaire DÉSIGNE les membres dont les demandes partent sans sa validation ; les autres restent à valider.
// Un membre libre ne règle toujours ni les sources ni Comète, et n'accepte pas un fichier mis à part (« propriétaire seul »).
const LOGIN = /^[A-Za-z0-9_.@-]{1,60}$/;
/** Les identifiants des membres libres. */
export function membresLibres(mag: MagasinVenus): string[] {
  const l = mag.get('acq_reglages', 'hnoss')?.data.libres;
  return Array.isArray(l) ? [...new Set(l.map(s).filter((x) => LOGIN.test(x)))] : [];
}
export const estLibre = (mag: MagasinVenus, login: string): boolean => membresLibres(mag).includes(s(login));
/** Règle la liste des membres libres (identifiants inconnus ou mal formés : ignorés). */
export function reglerMembresLibres(mag: MagasinVenus, logins: unknown, connus?: string[]): string[] {
  const brut = Array.isArray(logins) ? logins : s(logins).split(/[,;\s]+/);
  const l = [...new Set(brut.map(s).filter((x) => LOGIN.test(x) && x !== PROFIL_PROPRIETAIRE && (!connus || connus.includes(x))))].slice(0, 100);
  const prec = mag.get('acq_reglages', 'hnoss')?.data ?? {};
  mag.poser('acq_reglages', 'hnoss', { ...prec, libres: l });
  return membresLibres(mag);
}
