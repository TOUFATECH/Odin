// Vénus · les actions de la chaîne d'acquisition native (Hnoss, Sirius, Pléiades, Delta, Comète), exposées par le
// module Vénus (freyja) à la page, à la parole et aux autres applis. Chaque action rend `text` (une phrase simple) et
// `data` (des objets stables pour la page). Liste et contrat : voir ACTIONS_ACQUISITION_DOC plus bas.
//
// Droits : Valhalla contrôle AVANT l'action qu'un membre a le droit d'ouvrir Vénus. Ici :
// - une demande (hnoss_demander, hnoss_envie) : le propriétaire, ou un membre qui en a le droit ; celle d'un membre
//   attend la validation du propriétaire, qui est prévenu — SAUF si le propriétaire l'a désigné « libre » (Réglages →
//   Demandes, « Demandes au nom de chacun ») : sa demande part tout de suite (l'IA et la parole demandent confirmation) ;
// - les consultations (demandes, suivis, file, journal) ne portent pas encore le drapeau « lecture seule » : le banc
//   d'actions figé (test/soul-banc/jeux, scellé par empreinte) ne les connaît pas ; à poser quand il sera refait ;
// - tout ce qui télécharge, règle une source ou un dossier, valide ou refuse : le propriétaire seul (`proprietaireSeul`).
import type { Action, ActionResult, ModCtx } from '../types.ts';
import { agissant } from '../sso/acces.ts';
import { magasinVenus } from './base.ts';
import { catalogue, etatAcquisition, faireVenir, fetchSources } from './acquisition.ts';
import { demander, demandesHnoss, envies, estLibre, ligneDemande, lireSaisons, majDemande, membresLibres, PROFIL_PROPRIETAIRE, reglerMembresLibres, retirerEnvie, trouverDemande, type Demande } from './hnoss/index.ts';
import { garderSorties } from './hnoss/calendrier.ts';
import { aVenir, chercherTitre, nouveautes, reglagesCatalogue, reglerCatalogue, type Genre } from './catalogue/index.ts';
import { persona, personnes } from '../sso/etat.ts';
import { ligneSuivi, reglagesSuivi, reglerSuivi, retirerSuivi, suivi, suivis, type Applicatif } from './suivis/index.ts';
import { chercher, poserSource, retirerSource, sources, testerSource, type Requete } from './delta/index.ts';
import { ligneReglagesPartage, reglagesPartage, reglerPartage, type ReglagesPartage } from './comete/bt/moteur.ts';
import { accepter, annuler, fileComete, jeter, journalComete, ligneTelechargement, moteursInscrits, pause, reglagesComete, reglerComete, reprendre, reseauCatalogue as reseauDuCatalogue, retirer, telechargement } from './comete/index.ts';

const s = (v: unknown) => String(v ?? '').trim();
const oui = (v: unknown) => v === true || v === 'true' || v === 'oui';
const mag = (ctx: ModCtx) => magasinVenus(ctx.home, ctx.dir);
/** Qui demande : un membre de Persona (son identifiant), sinon le propriétaire. */
const quiDe = (): Demande['qui'] => { const a = agissant(); return a ? { login: a.login, nom: a.name, proprietaire: false } : { login: PROFIL_PROPRIETAIRE, nom: '', proprietaire: true }; };
const genreDe = (v: unknown): 'film' | 'serie' => (/s[ée]rie|anim|tv|show/i.test(s(v)) ? 'serie' : 'film');
const anneeDe = (v: unknown): number | undefined => { const n = Number(s(v)); return Number.isInteger(n) && n >= 1880 && n <= 2100 ? n : undefined; };
function parametresDemande(i: Record<string, unknown>): Omit<Parameters<typeof demander>[1], 'qui'> {
  const genre = genreDe(i.genre ?? i.type), saisons = lireSaisons(i.saisons ?? i.saison ?? ''), ep = Number(s(i.episode));
  return { genre, titre: s(i.titre), ...(genre === 'serie' && (/anim/i.test(s(i.genre ?? i.type)) || oui(i.anime)) ? { anime: true } : {}), ...(anneeDe(i.annee) ? { annee: anneeDe(i.annee) } : {}), ...(genre === 'serie' && saisons.length ? { saisons } : {}), ...(genre === 'serie' && saisons.length === 1 && Number.isInteger(ep) && ep > 0 ? { episodes: [{ saison: saisons[0], episode: ep }] } : {}) };
}
const P_DEMANDE = [
  { key: 'titre', label: 'Titre', kind: 'text' as const, required: true },
  { key: 'genre', label: 'Genre', kind: 'select' as const, options: ['film', 'série', 'animé'], default: 'film' },
  { key: 'annee', label: 'Année (facultatif)', kind: 'text' as const, default: '' },
  { key: 'saisons', label: 'Saisons (série : 1, 1-3, 1,2)', kind: 'text' as const, default: '' },
  { key: 'episode', label: 'Épisode (une seule saison, facultatif)', kind: 'text' as const, default: '' },
];
const P_DEM_ID = { key: 'demande', label: 'Demande (identifiant ou titre)', kind: 'text' as const, required: true };
const P_T_ID = { key: 'id', label: 'Téléchargement (identifiant)', kind: 'text' as const, required: true };
/** Pour un membre : les identifiants de SES demandes (il ne voit que ce qui en vient). Rien pour le propriétaire. */
const siennes = (ctx: ModCtx): Set<string> | undefined => { const q = quiDe(); return q.proprietaire ? undefined : new Set(demandesHnoss(mag(ctx), q.login).map((d) => d.id)); };
const demandeDe = (ctx: ModCtx, q: unknown): Demande => { const d = trouverDemande(mag(ctx), s(q)); if (!d) throw new Error(`aucune demande « ${s(q)} »`); return d; };
/** Un membre que le propriétaire a désigné « libre » : sa demande part sans validation. */
const libre = (ctx: ModCtx): boolean => { const q = quiDe(); return !q.proprietaire && estLibre(mag(ctx), q.login); };
/** Le profil de Vénus de qui parle (« moi » pour le propriétaire). */
const profilDe = (): string => { const q = quiDe(); return q.proprietaire ? PROFIL_PROPRIETAIRE : q.login; };
/** Les membres de la famille (comptes d'Odin), pour « Demandes au nom de chacun ». */
const membres = (): Array<{ login: string; nom: string }> => { const p = persona(); return p ? personnes(p).filter((x) => x.active && !x.proprio && x.login).map((x) => ({ login: x.login, nom: x.name || x.login })) : []; };
const genreCatalogue = (v: unknown): Genre => (/anim/i.test(s(v)) ? 'anime' : /s[ée]rie|show|tv/i.test(s(v)) ? 'show' : 'movie');
/** Le catalogue lit Internet par le réseau de Comète : jamais la machine d'Odin ni la maison, aucune redirection. */
const reseauCatalogue = () => reseauDuCatalogue();
const graveTelecharger = (i: Record<string, unknown>) => `télécharger « ${s(i.titre).slice(0, 60) || 'un titre'} » dans Vénus`;
const favorisDe = (ctx: ModCtx) => new Set(envies(mag(ctx), profilDe()).map((d) => d.cle).filter((x): x is string => !!x));
/**
 * Une demande posée : le propriétaire ou un membre libre → validée et lancée (suivi, recherche, téléchargement) ;
 * un autre membre → « à valider », le propriétaire est prévenu.
 */
async function poserEtLancer(ctx: ModCtx, i: Record<string, unknown>, o: { envie?: boolean } = {}): Promise<ActionResult> {
  const qui = quiDe(), m = mag(ctx), d = demander(m, { ...parametresDemande(i), qui, ...(o.envie ? { envie: true, cle: s(i.cle) } : {}) });
  if (!qui.proprietaire && !estLibre(m, qui.login)) {
    await ctx.notify(`📥 Vénus · ${o.envie ? 'envie' : 'demande'} de ${qui.nom || qui.login} : ${d.titre}${d.annee ? ` (${d.annee})` : ''}${d.saisons?.length ? `, saison(s) ${d.saisons.join(', ')}` : ''}. À valider dans Vénus → Réglages → Demandes.`).catch(() => undefined);
    return { text: `📥 ${o.envie ? 'Envie' : 'Demande'} notée : « ${d.titre} ». Elle attend la validation du propriétaire.`, data: { demande: d } };
  }
  majDemande(m, d.id, { etat: d.etat === 'à valider' ? 'en attente' : d.etat, valideePar: qui.proprietaire ? PROFIL_PROPRIETAIRE : `libre:${qui.login}` });
  if (!qui.proprietaire) await ctx.notify(`📥 Vénus · ${qui.nom || qui.login} (demandes libres) a lancé : ${d.titre}.`).catch(() => undefined);
  return bilanTexte(await faireVenir(ctx, d.id, { telecharger: true }));
}
const bilanTexte = (b: Awaited<ReturnType<typeof faireVenir>>): ActionResult => ({ text: `${ligneDemande(b.demande)}${b.lances.length ? `\n${b.lances.map((t) => `⬇ ${ligneTelechargement(t)}`).join('\n')}` : ''}`, data: { demande: b.demande, suivi: b.suivi, telechargements: b.lances, trouves: b.trouves } });

export const actionsAcquisition: Action[] = [
  // ---------------- Hnoss
  { id: 'hnoss_demander', label: 'Demander un titre', what: "Hnoss : une demande de film ou de série (et ses saisons). Celle d'un membre attend la validation du propriétaire (sauf un membre « libre ») ; le téléchargement se lance seulement après sa confirmation", params: P_DEMANDE, quick: false,
    words: ['telecharge le film', 'télécharge le film', 'telecharge la serie', 'télécharge la série', 'telecharge l anime', 'télécharge l\'animé', 'demande le film', 'demande la serie', 'demande la série', 'fais venir', 'je veux le film', 'je veux la serie', 'je veux la série', 'ajoute aux demandes'],
    // Un membre « libre » : sa demande télécharge tout de suite ; l'IA ou la parole demandent donc sa confirmation.
    grave: (i, ctx) => { try { return ctx && libre(ctx) ? graveTelecharger(i) : undefined; } catch { return undefined; } },
    run: async (ctx, i) => {
      const qui = quiDe(), m = mag(ctx);
      if (!qui.proprietaire) return poserEtLancer(ctx, i);
      const d = demander(m, { ...parametresDemande(i), qui });
      // Le propriétaire : suivi et recherche tout de suite ; le téléchargement attend sa confirmation (« valide la demande »).
      const b = await faireVenir(ctx, d.id, { telecharger: false });
      const r = bilanTexte(b);
      return { ...r, text: `${r.text}${b.trouves ? `\nPour lancer le téléchargement : « valide la demande ${d.titre} ».` : ''}`, data: { ...(r.data as object), confirmer: b.trouves ? { action: 'hnoss_valider', input: { demande: d.id } } : undefined } };
    } },
  { id: 'hnoss_envie', label: 'Mes envies (♡)', what: "Le ♡ d'une sortie « À venir » ou des Nouveautés : le titre rejoint « Mes envies » et part comme une demande (lancée pour le propriétaire et un membre libre, à valider pour les autres). `retirer` : enlève le ♡", params: [...P_DEMANDE, { key: 'cle', label: 'Sortie (clé du catalogue)', kind: 'text', default: '' }, { key: 'retirer', label: 'Retirer le ♡', kind: 'boolean', default: false }], quick: false,
    grave: (i, ctx) => { try { return !oui(i.retirer) && ctx && (quiDe().proprietaire || libre(ctx)) ? graveTelecharger(i) : undefined; } catch { return undefined; } },
    run: async (ctx, i) => {
      if (oui(i.retirer)) { const d = retirerEnvie(mag(ctx), profilDe(), s(i.cle) || s(i.titre)); return d ? { text: `« ${d.titre} » retiré de mes envies.`, data: { demande: d, retire: true } } : { ok: false, text: 'Cette envie n\'existe pas (ou plus).' }; }
      return poserEtLancer(ctx, i, { envie: true });
    } },
  { id: 'hnoss_envies', label: 'Mes envies', what: 'Les envies (♡) de qui parle, et où elles en sont', words: ['mes envies'],
    run: (ctx) => { const l = envies(mag(ctx), profilDe()); return { text: l.length ? l.slice(0, 40).map(ligneDemande).join('\n') : 'Aucune envie.', data: { envies: l } }; } },
  { id: 'hnoss_reglages', label: 'Demandes au nom de chacun', what: 'Les membres de la famille et ceux dont les demandes partent sans validation (« libres »)', quick: false, proprietaireSeul: true,
    run: (ctx) => { const l = membresLibres(mag(ctx)), ms = membres(); return { text: ms.length ? ms.map((x) => `${x.nom} : ${l.includes(x.login) ? 'demandes libres' : 'demandes validées par toi'}`).join('\n') : 'Aucun membre de la famille.', data: { libres: l, membres: ms } }; } },
  { id: 'hnoss_regler_libres', label: 'Régler les demandes libres', what: 'Désigne les membres dont les demandes partent sans ta validation (les autres restent à valider)', params: [{ key: 'libres', label: 'Membres libres (identifiants, séparés par des virgules)', kind: 'text', default: '' }], quick: false, proprietaireSeul: true,
    run: (ctx, i) => { const ms = membres(), l = reglerMembresLibres(mag(ctx), i.libres, ms.length ? ms.map((x) => x.login) : undefined); return { text: l.length ? `Demandes libres : ${l.map((x) => ms.find((y) => y.login === x)?.nom ?? x).join(', ')}.` : 'Toutes les demandes des membres passent par ta validation.', data: { libres: l, membres: ms } }; } },
  { id: 'hnoss_obtenir', label: 'Obtenir (À venir, Demander)', what: "Le clic sur un titre « à venir » ou « Demander » : la demande, le suivi (Sirius ou Pléiades), la recherche dans Delta et le téléchargement dans Comète, tout seuls. Propriétaire seul", params: P_DEMANDE, quick: false, proprietaireSeul: true,
    // Un téléchargement : l'IA, la parole ou un programme demandent la confirmation du propriétaire. Le clic de la page
    // EST cette confirmation : la page envoie `confirm: true` avec le clic.
    grave: (i) => `télécharger « ${s(i.titre).slice(0, 60) || 'un titre'} » dans Vénus`,
    run: async (ctx, i) => { const d = demander(mag(ctx), { ...parametresDemande(i), qui: quiDe() }); majDemande(mag(ctx), d.id, { etat: 'en attente', valideePar: PROFIL_PROPRIETAIRE }); return bilanTexte(await faireVenir(ctx, d.id, { telecharger: true })); } },
  { id: 'hnoss_valider', label: 'Valider une demande', what: 'Le propriétaire valide une demande : recherche et téléchargement lancés', params: [P_DEM_ID], quick: false, proprietaireSeul: true,
    grave: (i, ctx) => { try { const d = ctx ? trouverDemande(mag(ctx), s(i.demande)) : undefined; return `télécharger « ${(d?.titre ?? s(i.demande)).slice(0, 60)} » dans Vénus`; } catch { return 'télécharger un titre dans Vénus'; } },
    run: async (ctx, i) => { const d = demandeDe(ctx, i.demande); majDemande(mag(ctx), d.id, { etat: 'en attente', valideePar: PROFIL_PROPRIETAIRE }); return bilanTexte(await faireVenir(ctx, d.id, { telecharger: true })); } },
  { id: 'hnoss_relancer', label: 'Relancer une demande', what: 'Cherche de nouveau ce qui manque à une demande validée, et le télécharge', params: [P_DEM_ID], quick: false, proprietaireSeul: true,
    run: async (ctx, i) => { const d = demandeDe(ctx, i.demande); if (!d.valideePar) return { ok: false, text: 'Cette demande attend d\'abord ta validation (« valide la demande »).' }; return bilanTexte(await faireVenir(ctx, d.id, { telecharger: true })); } },
  { id: 'hnoss_refuser', label: 'Refuser une demande', what: "Le propriétaire refuse la demande d'un membre (rien n'est téléchargé)", params: [P_DEM_ID, { key: 'raison', label: 'Raison (facultatif)', kind: 'text', default: '' }], quick: false, proprietaireSeul: true,
    run: (ctx, i) => { const d = demandeDe(ctx, i.demande), r = majDemande(mag(ctx), d.id, { etat: 'échec', note: `refusée${s(i.raison) ? ` : ${s(i.raison)}` : ''}` })!; return { text: `✗ ${ligneDemande(r)}`, data: { demande: r } }; } },
  { id: 'hnoss_demandes', label: 'Mes demandes', what: 'Hnoss : les demandes et où elles en sont (toutes pour le propriétaire, les siennes pour un membre)', words: ['mes demandes', 'les demandes de venus', 'demandes en attente'],
    run: (ctx) => { const q = quiDe(), l = demandesHnoss(mag(ctx), q.proprietaire ? undefined : q.login); return { text: l.length ? l.slice(0, 40).map(ligneDemande).join('\n') : 'Aucune demande.', data: { demandes: l } }; } },
  // ---------------- Sirius et Pléiades
  { id: 'suivis', label: 'Titres suivis', quick: false, what: 'Sirius (films) et Pléiades (séries et animés) : ce qui est suivi, la qualité, ce qui manque', params: [{ key: 'applicatif', label: 'Applicatif', kind: 'select', options: ['tous', 'sirius', 'pleiades'], default: 'tous' }], words: ['titres suivis', 'films suivis', 'series suivies', 'séries suivies', 'episodes manquants', 'épisodes manquants'],
    run: (ctx, i) => { const a = ['sirius', 'pleiades'].includes(s(i.applicatif)) ? s(i.applicatif) as Applicatif : undefined, mes = siennes(ctx), l = suivis(mag(ctx), a).filter((x) => !mes || x.demandes.some((d) => mes.has(d))); return { text: l.length ? l.slice(0, 40).map(ligneSuivi).join('\n') : 'Aucun titre suivi.', data: { suivis: l } }; } },
  { id: 'suivi_regler', label: 'Régler Sirius ou Pléiades', what: 'Qualité voulue (toutes, 720p, 1080p, 2160p), dossier de la bibliothèque, dossier des animés, langue (vf ou toutes)', quick: false, proprietaireSeul: true,
    params: [{ key: 'applicatif', label: 'Applicatif', kind: 'select', options: ['sirius', 'pleiades'], default: 'sirius' }, { key: 'qualite', label: 'Qualité', kind: 'select', options: ['', 'toutes', '720p', '1080p', '2160p'], default: '' }, { key: 'dossier', label: 'Dossier (déclaré dans Vénus)', kind: 'text', default: '' }, { key: 'dossier_animes', label: 'Dossier des animés (Pléiades)', kind: 'text', default: '' }, { key: 'langue', label: 'Langue', kind: 'select', options: ['', 'vf', 'toutes'], default: '' }],
    run: (ctx, i) => {
      const a: Applicatif = s(i.applicatif) === 'pleiades' ? 'pleiades' : 'sirius';
      const r = reglerSuivi(mag(ctx), a, { ...(s(i.qualite) ? { qualite: s(i.qualite) as never } : {}), ...(i.dossier !== undefined && s(i.dossier) ? { dossier: s(i.dossier) } : {}), ...(s(i.dossier_animes) ? { dossierAnimes: s(i.dossier_animes) } : {}), ...(s(i.langue) ? { langue: s(i.langue) as never } : {}) });
      return { text: `${a === 'sirius' ? 'Sirius' : 'Pléiades'} : ${r.qualite} · ${r.dossier || 'premier dossier déclaré'} · ${r.langue === 'vf' ? 'VF de préférence' : 'toutes langues'}`, data: { reglages: r } };
    } },
  { id: 'suivi_retirer', label: 'Ne plus suivre', what: 'Retire un titre de la liste suivie (les fichiers rangés restent)', params: [{ key: 'id', label: 'Titre suivi (identifiant)', kind: 'text', required: true }], quick: false, proprietaireSeul: true,
    run: (ctx, i) => { const x = suivi(mag(ctx), s(i.id)); if (!x) return { ok: false, text: 'Titre suivi inconnu.' }; retirerSuivi(mag(ctx), x.id); return { text: `${x.titre} n'est plus suivi.` }; } },
  { id: 'a_venir', label: 'À venir', quick: false, external: true, what: "Les sorties autour d'aujourd'hui (le catalogue réglé par le propriétaire ; aucun par défaut) et les titres suivis qui ne sont pas encore là", params: [{ key: 'genre', label: 'Genre', kind: 'select', options: ['film', 'série', 'animé'], default: 'film' }],
    run: async (ctx, i) => {
      const m = mag(ctx), c = catalogue(m), mes = siennes(ctx), l = suivis(m).filter((x) => x.etat !== 'disponible' && (!mes || x.demandes.some((d) => mes.has(d))));
      const a = await aVenir(m, reseauCatalogue(), genreCatalogue(i.genre ?? i.type), favorisDe(ctx));
      // Le relevé est gardé pour le calendrier (Hnoss) ; un catalogue en panne (rien de lu, une erreur) n'efface pas le
      // précédent ; un catalogue passé à « Aucun » le vide (plus de source : plus de sorties qui vieillissent).
      if (!a.source) garderSorties(m, a.kind, []);
      else if (a.entries.length || !a.erreurs.length) garderSorties(m, a.kind, a.entries);
      const lignes = a.entries.slice(0, 20).map((e) => `${e.date} · ${e.title}${e.season !== undefined ? ` S${e.season}E${e.episode ?? 0}` : ''}${e.nas ? ' · dans Vénus' : ''}`);
      return { text: [a.texte, ...lignes, ...l.slice(0, 30).map(ligneSuivi)].join('\n'), data: { catalogue: c, ...a, titres: a.entries, suivis: l } };
    } },
  { id: 'sorties_nouveautes', label: 'Nouveautés (sorties)', quick: false, external: true, what: 'Films au cinéma et à venir, séries de la semaine, animés de la saison (le catalogue réglé par le propriétaire)', params: [{ key: 'genre', label: 'Genre', kind: 'select', options: ['film', 'série', 'animé'], default: 'film' }],
    run: async (ctx, i) => {
      const n = await nouveautes(mag(ctx), reseauCatalogue(), genreCatalogue(i.genre ?? i.type), favorisDe(ctx));
      return { text: n.source ? [n.texte, ...n.sections.map((x) => `${x.title} : ${x.items.slice(0, 5).map((y) => y.title).join(', ')}`)].join('\n') : n.texte, data: n };
    } },
  { id: 'sorties_chercher', label: 'Chercher un titre (Nouveau)', quick: false, external: true, what: "« Nouveau » : le titre tapé, cherché dans le grand catalogue quand sa clé est réglée (titre, année, résumé) ; sans clé, rien n'est lu et le titre est ajouté tel quel", params: [{ key: 'q', label: 'Titre', kind: 'text', required: true }, { key: 'genre', label: 'Genre', kind: 'select', options: ['film', 'série', 'animé'], default: 'film' }],
    run: async (ctx, i) => { const r = await chercherTitre(mag(ctx), reseauCatalogue(), i.q, genreCatalogue(i.genre ?? i.type)); return { text: r.source ? [r.texte, ...r.items.slice(0, 10).map((x) => `${x.title}${x.year ? ` (${x.year})` : ''}${x.inLibrary ? ' · dans Vénus' : ''}`)].join('\n') : r.texte, data: r }; } },
  { id: 'catalogue_etat', label: 'Catalogue des sorties', quick: false, proprietaireSeul: true, what: 'Les sources des sorties choisies (sans jamais montrer la clé)',
    run: (ctx) => { const r = reglagesCatalogue(mag(ctx)); return { text: `Séries : ${r.series ? 'oui' : 'non'} · Animés : ${r.animes ? 'oui' : 'non'} · Films : ${r.films === 'cle' ? `grand catalogue${r.aCle ? ' (clé gardée)' : ' (clé manquante)'}` : r.films === 'public' ? 'catalogue public' : 'aucun'}`, data: { reglages: r } }; } },
  { id: 'catalogue_regler', label: 'Régler le catalogue des sorties', quick: false, proprietaireSeul: true, what: "D'où viennent les sorties « À venir » et les Nouveautés : programme des séries, programme des animés (sans clé), catalogue des films (public, ou le grand catalogue avec ta clé gratuite, gardée chiffrée)",
    params: [{ key: 'series', label: 'Programme des séries (sans clé)', kind: 'boolean', default: false }, { key: 'animes', label: 'Programme des animés (sans clé)', kind: 'boolean', default: false }, { key: 'films', label: 'Films', kind: 'select', options: ['aucun', 'public', 'cle'], default: 'aucun' }, { key: 'cle', label: 'Clé du grand catalogue (gardée chiffrée, hors base)', kind: 'password', default: '' }, { key: 'oublier_cle', label: 'Oublier la clé', kind: 'boolean', default: false }],
    run: (ctx, i) => { const r = reglerCatalogue(mag(ctx), i); return { text: `Catalogue réglé · séries ${r.series ? 'oui' : 'non'} · animés ${r.animes ? 'oui' : 'non'} · films ${r.films}${r.aCle ? ' · clé gardée chiffrée' : ''}.`, data: { reglages: r } }; } },
  // ---------------- Delta
  { id: 'delta_sources', label: 'Delta · Sources', quick: false, what: 'Tes sources (sans leurs clés) : actives, priorité, recherches, résultats, dernière erreur', proprietaireSeul: true,
    run: (ctx) => { const l = sources(mag(ctx)); return { text: l.length ? l.map((x) => `${x.actif ? '🟢' : '⚪'} ${x.nom} (${x.type}) · priorité ${x.priorite} · ${x.recherches} recherche(s), ${x.trouves} résultat(s)${x.aCle ? ' · clé gardée' : ''}${x.derniereErreur ? ` · ${x.derniereErreur}` : ''}`).join('\n') : 'Aucune source : ajoute une source que tu as le droit d\'utiliser (Delta ne fournit rien).', data: { sources: l } }; } },
  { id: 'delta_ajouter', label: 'Ajouter une source', what: "Une source au format de recherche standard des indexeurs : son adresse et sa clé, données par toi. Odin n'en fournit aucune", quick: false, proprietaireSeul: true,
    params: [{ key: 'nom', label: 'Nom', kind: 'text', required: true }, { key: 'type', label: 'Format', kind: 'select', options: ['torznab', 'newznab'], default: 'torznab' }, { key: 'adresse', label: "Adresse de l'API (https://…/api)", kind: 'text', required: true }, { key: 'cle', label: 'Clé (gardée chiffrée, hors base)', kind: 'password', default: '' }, { key: 'priorite', label: 'Priorité (1 = d\'abord)', kind: 'number', default: 25 }, { key: 'actif', label: 'Active', kind: 'boolean', default: true }],
    run: (ctx, i) => { const x = poserSource(mag(ctx), { nom: s(i.nom), type: s(i.type), adresse: s(i.adresse), cle: s(i.cle), priorite: Number(i.priorite) || 25, actif: i.actif === undefined ? true : oui(i.actif) }); return { text: `Source « ${x.nom} » enregistrée${x.aCle ? ' (clé gardée chiffrée)' : ''}.`, data: { source: x } }; } },
  { id: 'delta_retirer', label: 'Retirer une source', what: 'La source et sa clé sont retirées', params: [{ key: 'id', label: 'Source (identifiant)', kind: 'text', required: true }], quick: false, proprietaireSeul: true,
    run: (ctx, i) => (retirerSource(mag(ctx), s(i.id)) ? { text: `Source ${s(i.id)} retirée.` } : { ok: false, text: 'Source inconnue.' }) },
  { id: 'delta_tester', label: 'Tester une source', what: 'La source répond-elle au format standard ?', params: [{ key: 'id', label: 'Source (identifiant)', kind: 'text', required: true }], quick: false, proprietaireSeul: true, external: true,
    run: async (ctx, i) => { const r = await testerSource(mag(ctx), fetchSources(ctx), s(i.id)); return { ok: r.ok, text: r.texte }; } },
  { id: 'delta_chercher', label: 'Chercher dans les sources', what: 'Recherche à la main : les résultats, lesquels Comète sait prendre', quick: false, proprietaireSeul: true, external: true, params: [...P_DEMANDE.slice(0, 3), { key: 'saison', label: 'Saison', kind: 'text', default: '' }, { key: 'episode', label: 'Épisode', kind: 'text', default: '' }],
    run: async (ctx, i) => {
      const g = genreDe(i.genre ?? i.type), sn = Number(s(i.saison)), ep = Number(s(i.episode));
      const req: Requete = g === 'film' ? { genre: 'film', titre: s(i.titre), ...(anneeDe(i.annee) ? { annee: anneeDe(i.annee) } : {}) } : { genre: Number.isInteger(ep) && ep > 0 ? 'episode' : 'saison', titre: s(i.titre), saison: Number.isInteger(sn) ? sn : 1, ...(ep > 0 ? { episode: ep } : {}) };
      const r = await chercher(mag(ctx), fetchSources(ctx), req);
      return { text: [`${r.resultats.length} résultat(s)`, ...r.resultats.slice(0, 20).map((x, k) => `${k + 1}. ${x.titre} · ${x.sourceNom}${x.taille ? ` · ${(x.taille / 1e9).toFixed(1)} Go` : ''} · ${x.direct ? 'lien direct' : x.genre === 'partage' ? 'partage de fichiers' : 'non pris'}`), ...r.erreurs.map((e) => `⚠ ${e}`)].join('\n'), data: { resultats: r.resultats.map(({ lien: _l, ...x }) => x), erreurs: r.erreurs } };
    } },
  // ---------------- Comète
  { id: 'comete_file', label: 'En téléchargement', what: 'Comète : la file (en attente, en cours, en pause, fini), progression et vitesse', words: ['file de comete', 'file de comète', 'en telechargement sur venus', 'en téléchargement sur vénus'],
    run: (ctx) => { const mes = siennes(ctx), l = fileComete(mag(ctx)).filter((t) => !mes || (t.demande !== undefined && mes.has(t.demande))).map((t) => (mes ? { ...t, chemin: undefined, racine: '' } : t)); return { text: l.length ? l.slice(0, 40).map(ligneTelechargement).join('\n') : 'Rien dans la file de Comète.', data: { telechargements: l, moteurs: moteursInscrits() } }; } },
  { id: 'comete_pause', label: 'Mettre en pause', what: 'Le téléchargement s\'arrête et garde ce qui est reçu', params: [P_T_ID], quick: false, proprietaireSeul: true, run: (ctx, i) => { const t = pause(ctx, s(i.id)); return { text: `⏸ ${ligneTelechargement(t)}`, data: { telechargement: t } }; } },
  { id: 'comete_reprendre', label: 'Reprendre', what: 'Il repart où il s\'était arrêté', params: [P_T_ID], quick: false, proprietaireSeul: true, run: (ctx, i) => { const t = reprendre(ctx, s(i.id)); return { text: `▶ ${ligneTelechargement(t)}`, data: { telechargement: t } }; } },
  { id: 'comete_annuler', label: 'Annuler', what: 'Il s\'arrête et ce qui est reçu est effacé', params: [P_T_ID], quick: false, proprietaireSeul: true, run: (ctx, i) => { const t = annuler(ctx, s(i.id)); return { text: `⏹ ${ligneTelechargement(t)}`, data: { telechargement: t } }; } },
  { id: 'comete_retirer', label: 'Retirer de la file', what: 'Un téléchargement fini, annulé ou en échec quitte la file (le fichier rangé reste)', params: [P_T_ID], quick: false, proprietaireSeul: true, run: (ctx, i) => (retirer(ctx, s(i.id)) ? { text: 'Retiré de la file.' } : { ok: false, text: 'Téléchargement inconnu.' }) },
  { id: 'comete_accepter', label: 'Accepter un fichier mis à part', what: "Un fichier dont l'antivirus doute : tu l'acceptes quand même, il est rangé dans la bibliothèque (noté au journal)", params: [P_T_ID], quick: false, proprietaireSeul: true,
    grave: (i, ctx) => { const t = ctx ? telechargement(mag(ctx), s(i.id)) : undefined; return `ranger « ${(t?.cible.titre ?? s(i.id)).slice(0, 60)} » dans Vénus malgré le doute de l'antivirus`; },
    run: async (ctx, i) => { const t = await accepter(ctx, s(i.id)); return { ok: t.etat === 'termine', text: `${t.etat === 'termine' ? '✓' : '✗'} ${ligneTelechargement(t)}`, data: { telechargement: t } }; } },
  { id: 'comete_jeter', label: 'Jeter un fichier mis à part', what: "Un fichier dont l'antivirus doute : il est effacé, rien n'entre dans la bibliothèque (noté au journal)", params: [P_T_ID], quick: false, proprietaireSeul: true,
    run: (ctx, i) => { const t = jeter(ctx, s(i.id)); return { text: `🗑 ${ligneTelechargement(t)}`, data: { telechargement: t } }; } },
  { id: 'comete_regler', label: 'Régler Comète', what: 'Taille maximale d\'un fichier (Go), téléchargements simultanés, débit maximum (Mo/s, 0 = libre) ; partage de fichiers : pairs à la fois, envoi aux autres pendant le téléchargement (Ko/s, ratio, durée), DHT, écoute entrante (port à ouvrir toi-même sur ta box)', quick: false, proprietaireSeul: true,
    params: [{ key: 'taille_max_go', label: 'Taille maximale (Go)', kind: 'number', default: 60 }, { key: 'simultanes', label: 'Simultanés (1 à 4)', kind: 'number', default: 2 }, { key: 'debit_mo', label: 'Débit max (Mo/s, 0 = libre)', kind: 'number', default: 0 },
      { key: 'pairs_max', label: 'Partage : pairs à la fois (1 à 50)', kind: 'number', default: 30 }, { key: 'envoi_pendant', label: 'Partage : envoyer aux autres pendant le téléchargement', kind: 'select', options: ['oui', 'non'], default: 'oui' },
      { key: 'envoi_ko', label: 'Partage : envoi max (Ko/s)', kind: 'number', default: 100 }, { key: 'ratio', label: 'Partage : ratio max (0 = libre)', kind: 'number', default: 1 }, { key: 'duree_min', label: 'Partage : durée max de l\'envoi (min, 0 = le temps du téléchargement)', kind: 'number', default: 0 },
      { key: 'dht', label: 'Partage : chercher aussi dans le DHT', kind: 'select', options: ['oui', 'non'], default: 'oui' }, { key: 'ecoute', label: 'Partage : écoute entrante', kind: 'select', options: ['non', 'oui'], default: 'non' }, { key: 'port_ecoute', label: 'Partage : port d\'écoute (1024 à 65535)', kind: 'number', default: 0 }],
    run: (ctx, i) => {
      const r = reglerComete(mag(ctx), { ...(i.taille_max_go !== undefined && s(i.taille_max_go) ? { tailleMaxGo: Number(i.taille_max_go) } : {}), ...(i.simultanes !== undefined && s(i.simultanes) ? { simultanes: Number(i.simultanes) } : {}), ...(i.debit_mo !== undefined && s(i.debit_mo) ? { debitMo: Number(i.debit_mo) } : {}) });
      const ouiNon = (v: unknown) => (s(v) ? oui(v) : undefined), nb = (v: unknown) => (v !== undefined && s(v) ? Number(v) : undefined);
      const p: Partial<ReglagesPartage> = {}, poser = <K extends keyof ReglagesPartage>(k: K, v: ReglagesPartage[K] | undefined) => { if (v !== undefined) p[k] = v; };
      poser('maxPairs', nb(i.pairs_max)); poser('envoiPendant', ouiNon(i.envoi_pendant)); poser('envoiKo', nb(i.envoi_ko)); poser('ratio', nb(i.ratio)); poser('dureeMin', nb(i.duree_min)); poser('dht', ouiNon(i.dht)); poser('portEcoute', nb(i.port_ecoute)); poser('ecoute', ouiNon(i.ecoute));
      const q = Object.keys(p).length ? reglerPartage(mag(ctx), p) : reglagesPartage(mag(ctx));
      return { text: `Comète : ${r.tailleMaxGo} Go au plus · ${r.simultanes} à la fois · ${r.debitMo ? `${r.debitMo} Mo/s` : 'débit libre'}.\n${ligneReglagesPartage(q)}.`, data: { reglages: r, partage: q } };
    } },
  { id: 'comete_journal', label: 'Journal des téléchargements', quick: false, external: true, what: 'Chaque ajout, fin, échec, annulation (sans paramètres d\'adresse)', proprietaireSeul: true,
    run: (ctx) => { const l = journalComete(mag(ctx)); return { text: l.length ? l.map((x) => `${new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${x.quoi} · ${x.titre}${x.texte ? ` · ${x.texte}` : ''}`).join('\n') : 'Aucun téléchargement noté.', data: { journal: l } }; } },
  { id: 'acquisition', label: 'Applicatifs de Vénus', quick: false, what: 'Hnoss, Sirius, Pléiades, Delta, Comète : ce qui marche dans Odin, les réglages',
    run: (ctx) => { const m = mag(ctx), e = etatAcquisition(false); if (siennes(ctx)) return { text: e.map((x) => `${x.nom} : ${x.note}`).join('\n'), data: { blocs: e } }; return { text: e.map((x) => `${x.etat === 'natif' ? '✅' : '…'} ${x.nom} : ${x.note}`).join('\n'), data: { blocs: e, sirius: reglagesSuivi(m, 'sirius'), pleiades: reglagesSuivi(m, 'pleiades'), comete: reglagesComete(m), partage: reglagesPartage(m), catalogue: catalogue(m), sources: sources(m).length } }; } },
];
/** Les identifiants des actions natives (bouton rapide toujours présent, sans le serveur à part). */
export const IDS_ACQUISITION = actionsAcquisition.map((a) => a.id);
/** (pour la page) un téléchargement par son identifiant. */
export const telechargementDe = (ctx: ModCtx, id: string) => telechargement(mag(ctx), id);

/**
 * Contrat pour la page (lot V1) — module « freyja », POST /api/valhalla/act { module: 'freyja', action, input } :
 *  hnoss_obtenir   (action grave : la page envoie `confirm: true` avec le clic — le clic est la confirmation ; l'IA et la parole demandent)
 *  hnoss_obtenir   { titre, genre: film|série, annee?, saisons?, episode? }  → data { demande, suivi, telechargements[], trouves }  (clic « À venir » / « Demander » ; propriétaire)
 *  hnoss_demander  idem → data { demande, confirmer? }   (membre : « à valider » ; propriétaire : cherché, téléchargement après « hnoss_valider »)
 *  hnoss_valider   { demande } (grave : confirmation) · hnoss_refuser { demande, raison? } · hnoss_relancer { demande }
 *  hnoss_demandes  → data { demandes[] }   états : à valider, en attente, cherchée, en téléchargement, disponible, échec
 *  suivis          { applicatif?: tous|sirius|pleiades } → data { suivis[] } · suivi_regler { applicatif, qualite?, dossier?, dossier_animes?, langue? } · suivi_retirer { id }
 *  a_venir         { genre: film|série|animé } → data { regle, source, texte, entries[], suggestions[], erreurs[], titres (= entries), suivis[] }
 *  sorties_nouveautes { genre } → data { regle, source, sections[{ title, items[] }], texte } · catalogue_etat → data { reglages } · catalogue_regler { series?, animes?, films?: aucun|public|cle, cle?, oublier_cle? }
 *  sorties_chercher { q, genre } → data { source, items[{ key, kind, title, year?, overview?, inLibrary? }], texte } (« Nouveau » ; sans clé : source false, rien de lu)
 *  hnoss_envie     { titre, genre, annee?, saisons?, episode?, cle, retirer? } (grave quand elle lance : la page envoie `confirm: true`) · hnoss_envies → data { envies[] }
 *  hnoss_reglages  → data { libres[], membres[{ login, nom }] } · hnoss_regler_libres { libres: "a,b" }
 *  delta_sources → data { sources[] } (jamais de clé) · delta_ajouter { nom, type, adresse, cle?, priorite?, actif? } · delta_retirer { id } · delta_tester { id } · delta_chercher { titre, genre, annee?, saison?, episode? }
 *  comete_file     → data { telechargements[] : { id, titre, cible, etat, fait, total, vitesse (octets/s), texte, chemin, bibliotheque } } (à relire toutes les 2 s tant que l'un est en_cours)
 *  état « a_part » : l'antivirus doute, le fichier attend → comete_accepter { id } (grave) ou comete_jeter { id }
 *  comete_pause / comete_reprendre / comete_annuler / comete_retirer { id } · comete_journal
 *  comete_regler { taille_max_go?, simultanes?, debit_mo?, pairs_max?, envoi_pendant? (oui/non), envoi_ko?, ratio?, duree_min?, dht? (oui/non), ecoute? (oui/non), port_ecoute? } → data { reglages, partage }
 *  acquisition     → data { blocs, sirius, pleiades, comete, partage, catalogue, sources }
 */
export const ACTIONS_ACQUISITION_DOC = true;
