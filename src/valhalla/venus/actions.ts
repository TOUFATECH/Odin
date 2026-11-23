// Vénus · les actions de la chaîne d'acquisition native (Hnoss, Sirius, Pléiades, Delta, Comète), exposées par le
// module Vénus (freyja) à la page, à la parole et aux autres applis. Chaque action rend `text` (une phrase simple) et
// `data` (des objets stables pour la page). Liste et contrat : voir ACTIONS_ACQUISITION_DOC plus bas.
//
// Droits : Valhalla contrôle AVANT l'action qu'un membre a le droit d'ouvrir Vénus. Ici :
// - une demande (hnoss_demander) : le propriétaire, ou un membre qui en a le droit ; celle d'un membre attend la
//   validation du propriétaire, qui est prévenu ;
// - les consultations (demandes, suivis, file, journal) ne portent pas encore le drapeau « lecture seule » : le banc
//   d'actions figé (test/soul-banc/jeux, scellé par empreinte) ne les connaît pas ; à poser quand il sera refait ;
// - tout ce qui télécharge, règle une source ou un dossier, valide ou refuse : le propriétaire seul (`proprietaireSeul`).
import type { Action, ActionResult, ModCtx } from '../types.ts';
import { agissant } from '../sso/acces.ts';
import { magasinVenus } from './base.ts';
import { catalogue, etatAcquisition, faireVenir, fetchSources } from './acquisition.ts';
import { demander, demandesHnoss, ligneDemande, lireSaisons, majDemande, PROFIL_PROPRIETAIRE, trouverDemande, type Demande } from './hnoss/index.ts';
import { ligneSuivi, reglagesSuivi, reglerSuivi, retirerSuivi, suivi, suivis, type Applicatif } from './suivis/index.ts';
import { chercher, poserSource, retirerSource, sources, testerSource, type Requete } from './delta/index.ts';
import { accepter, annuler, fileComete, jeter, journalComete, ligneTelechargement, moteursInscrits, pause, reglagesComete, reglerComete, reprendre, retirer, telechargement } from './comete/index.ts';

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
const bilanTexte = (b: Awaited<ReturnType<typeof faireVenir>>): ActionResult => ({ text: `${ligneDemande(b.demande)}${b.lances.length ? `\n${b.lances.map((t) => `⬇ ${ligneTelechargement(t)}`).join('\n')}` : ''}`, data: { demande: b.demande, suivi: b.suivi, telechargements: b.lances, trouves: b.trouves } });

export const actionsAcquisition: Action[] = [
  // ---------------- Hnoss
  { id: 'hnoss_demander', label: 'Demander un titre', what: "Hnoss : une demande de film ou de série (et ses saisons). Celle d'un membre attend la validation du propriétaire ; le téléchargement se lance seulement après sa confirmation", params: P_DEMANDE, quick: false,
    words: ['telecharge le film', 'télécharge le film', 'telecharge la serie', 'télécharge la série', 'telecharge l anime', 'télécharge l\'animé', 'demande le film', 'demande la serie', 'demande la série', 'fais venir', 'je veux le film', 'je veux la serie', 'je veux la série', 'ajoute aux demandes'],
    run: async (ctx, i) => {
      const qui = quiDe(), m = mag(ctx), d = demander(m, { ...parametresDemande(i), qui });
      if (!qui.proprietaire) {
        await ctx.notify(`📥 Vénus · demande de ${qui.nom || qui.login} : ${d.titre}${d.annee ? ` (${d.annee})` : ''}${d.saisons?.length ? `, saison(s) ${d.saisons.join(', ')}` : ''}. À valider dans Vénus → Demandes.`).catch(() => undefined);
        return { text: `📥 Demande notée : « ${d.titre} ». Elle attend la validation du propriétaire.`, data: { demande: d } };
      }
      // Le propriétaire : suivi et recherche tout de suite ; le téléchargement attend sa confirmation (« valide la demande »).
      const b = await faireVenir(ctx, d.id, { telecharger: false });
      const r = bilanTexte(b);
      return { ...r, text: `${r.text}${b.trouves ? `\nPour lancer le téléchargement : « valide la demande ${d.titre} ».` : ''}`, data: { ...(r.data as object), confirmer: b.trouves ? { action: 'hnoss_valider', input: { demande: d.id } } : undefined } };
    } },
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
  { id: 'a_venir', label: 'À venir', quick: false, what: 'Les titres suivis qui ne sont pas encore là, et le catalogue des sorties (aucun n\'est branché par défaut)',
    run: (ctx) => { const m = mag(ctx), c = catalogue(m), mes = siennes(ctx), l = suivis(m).filter((x) => x.etat !== 'disponible' && (!mes || x.demandes.some((d) => mes.has(d)))); return { text: `${c.texte}${l.length ? `\n${l.slice(0, 30).map(ligneSuivi).join('\n')}` : ''}`, data: { catalogue: c, titres: [], suivis: l } }; } },
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
      return { text: [`${r.resultats.length} résultat(s)`, ...r.resultats.slice(0, 20).map((x, k) => `${k + 1}. ${x.titre} · ${x.sourceNom}${x.taille ? ` · ${(x.taille / 1e9).toFixed(1)} Go` : ''} · ${x.direct ? 'lien direct' : x.genre === 'partage' ? 'partage (pas encore)' : 'non pris'}`), ...r.erreurs.map((e) => `⚠ ${e}`)].join('\n'), data: { resultats: r.resultats.map(({ lien: _l, ...x }) => x), erreurs: r.erreurs } };
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
  { id: 'comete_regler', label: 'Régler Comète', what: 'Taille maximale d\'un fichier (Go), téléchargements simultanés, débit maximum (Mo/s, 0 = libre)', quick: false, proprietaireSeul: true,
    params: [{ key: 'taille_max_go', label: 'Taille maximale (Go)', kind: 'number', default: 60 }, { key: 'simultanes', label: 'Simultanés (1 à 4)', kind: 'number', default: 2 }, { key: 'debit_mo', label: 'Débit max (Mo/s, 0 = libre)', kind: 'number', default: 0 }],
    run: (ctx, i) => { const r = reglerComete(mag(ctx), { ...(i.taille_max_go !== undefined && s(i.taille_max_go) ? { tailleMaxGo: Number(i.taille_max_go) } : {}), ...(i.simultanes !== undefined && s(i.simultanes) ? { simultanes: Number(i.simultanes) } : {}), ...(i.debit_mo !== undefined && s(i.debit_mo) ? { debitMo: Number(i.debit_mo) } : {}) }); return { text: `Comète : ${r.tailleMaxGo} Go au plus · ${r.simultanes} à la fois · ${r.debitMo ? `${r.debitMo} Mo/s` : 'débit libre'}.`, data: { reglages: r } }; } },
  { id: 'comete_journal', label: 'Journal des téléchargements', quick: false, external: true, what: 'Chaque ajout, fin, échec, annulation (sans paramètres d\'adresse)', proprietaireSeul: true,
    run: (ctx) => { const l = journalComete(mag(ctx)); return { text: l.length ? l.map((x) => `${new Date(x.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${x.quoi} · ${x.titre}${x.texte ? ` · ${x.texte}` : ''}`).join('\n') : 'Aucun téléchargement noté.', data: { journal: l } }; } },
  { id: 'acquisition', label: 'Applicatifs de Vénus', quick: false, what: 'Hnoss, Sirius, Pléiades, Delta, Comète : ce qui marche dans Odin, les réglages',
    run: (ctx) => { const m = mag(ctx), e = etatAcquisition(false); if (siennes(ctx)) return { text: e.map((x) => `${x.nom} : ${x.note}`).join('\n'), data: { blocs: e } }; return { text: e.map((x) => `${x.etat === 'natif' ? '✅' : '…'} ${x.nom} : ${x.note}`).join('\n'), data: { blocs: e, sirius: reglagesSuivi(m, 'sirius'), pleiades: reglagesSuivi(m, 'pleiades'), comete: reglagesComete(m), catalogue: catalogue(m), sources: sources(m).length } }; } },
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
 *  a_venir         → data { catalogue: { regle, texte }, titres: [], suivis[] }
 *  delta_sources → data { sources[] } (jamais de clé) · delta_ajouter { nom, type, adresse, cle?, priorite?, actif? } · delta_retirer { id } · delta_tester { id } · delta_chercher { titre, genre, annee?, saison?, episode? }
 *  comete_file     → data { telechargements[] : { id, titre, cible, etat, fait, total, vitesse (octets/s), texte, chemin, bibliotheque } } (à relire toutes les 2 s tant que l'un est en_cours)
 *  état « a_part » : l'antivirus doute, le fichier attend → comete_accepter { id } (grave) ou comete_jeter { id }
 *  comete_pause / comete_reprendre / comete_annuler / comete_retirer { id } · comete_regler { taille_max_go?, simultanes?, debit_mo? } · comete_journal
 *  acquisition     → data { blocs, sirius, pleiades, comete, catalogue, sources }
 */
export const ACTIONS_ACQUISITION_DOC = true;
