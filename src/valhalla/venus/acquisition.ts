// Vénus · Acquisition native : la chaîne complète DANS Odin, sans serveur à part.
//   « À venir » ou une demande  →  Hnoss (la demande, qui l'a faite, où elle en est)
//   →  Sirius (films) ou Pléiades (séries et animés) : le titre suivi, la qualité voulue, le dossier, ce qui manque
//   →  Delta : les sources du propriétaire (format de recherche standard des indexeurs), le meilleur résultat
//   →  Comète : la file, liens directs par les briques d'Atalante, taille vérifiée, antivirus, renommage, rangement
//   →  le scan du fichier : le titre est visible et lisible dans Vénus.
// Odyssée (livres) garde son chemin actuel. Le moteur de partage de fichiers de Comète vient au lot suivant.
//
// Règles : seul le propriétaire règle les sources et lance un téléchargement ; un membre (si ses droits sur Vénus le
// permettent) fait une demande, que le propriétaire valide ; aucune source, aucune adresse, aucune clé n'est fournie
// par Odin ; aucun catalogue public n'est lu tant que le propriétaire n'en a pas choisi un.
import type { ModCtx } from '../types.ts';
import { hoteInterdit } from '../lien.ts';
import { magasinVenus, type MagasinVenus } from './base.ts';
import { chercher, meilleur, sources, type Choix, type Requete, type Resultat } from './delta/index.ts';
import { demande, majDemande, type Demande } from './hnoss/index.ts';
import { manquants, poserSuivi, recompter, suivi, suivre, type Suivi } from './suivis/index.ts';
import { ajouter, quandFini, reglagesComete, reseauDelta, type Telechargement } from './comete/index.ts';

/** Les blocs d'acquisition, par leurs noms d'Odin. */
export type Bloc = 'delta' | 'hnoss' | 'sirius' | 'pleiades' | 'odyssee' | 'comete';
export const BLOCS: Record<Bloc, { nom: string; role: string; alternative: string }> = {
  delta: { nom: 'Delta', role: 'sources (format de recherche standard des indexeurs), test', alternative: 'Prowlarr' },
  hnoss: { nom: 'Hnoss', role: 'demandes et envies', alternative: 'Jellyseerr' },
  sirius: { nom: 'Sirius', role: 'films suivis, qualité, dossier', alternative: 'Radarr' },
  pleiades: { nom: 'Pléiades', role: 'séries et animés suivis, épisodes manquants', alternative: 'Sonarr' },
  odyssee: { nom: 'Odyssée', role: 'livres et livres audio', alternative: 'Readarr' },
  comete: { nom: 'Comète', role: 'file des téléchargements (liens directs par Atalante ; partage de fichiers au lot suivant)', alternative: 'qBittorrent' },
};
export type EtatBloc = 'natif' | 'a_porter';
export interface EtatAcquisition { bloc: Bloc; nom: string; etat: EtatBloc; delegue: boolean; note: string }
/** Un serveur Venus externe est-il encore configuré ? Pur. */
export const serveurExterneConfigure = (url: string | undefined, cle: string | undefined): boolean => Boolean((url ?? '').trim() && (cle ?? '').trim());
/** L'état, bloc par bloc : Delta, Hnoss, Sirius, Pléiades et Comète sont natifs ; Odyssée garde son chemin. Pur. */
export function etatAcquisition(externe: boolean): EtatAcquisition[] {
  return (Object.keys(BLOCS) as Bloc[]).map((b) => b === 'odyssee'
    ? { bloc: b, nom: BLOCS[b].nom, etat: 'a_porter', delegue: externe, note: externe ? 'les envies de livres passent encore par le serveur Venus à part' : 'les livres déposés se lisent dans Odin ; les envies de livres restent à porter' }
    : { bloc: b, nom: BLOCS[b].nom, etat: 'natif', delegue: false, note: `dans Odin : ${BLOCS[b].role}` });
}
/** Les tables d'acquisition de VENUS_ODIN, avec leur nombre d'enregistrements. */
export function modeleAcquisition(mag: MagasinVenus): Record<string, number> {
  const o: Record<string, number> = {};
  for (const c of ['sources', 'envies', 'demandes', 'telechargements', 'acq_journal', 'acq_reglages'] as const) o[c] = mag.liste(c).length;
  return o;
}

// ---------------------------------------------------------------- Le catalogue des sorties (place prête, rien de branché)
/**
 * La source de catalogue (dates de sortie, affiches) : AUCUNE par défaut. Tant que le propriétaire n'en a pas choisi,
 * « À venir » ne lit rien sur Internet et le dit. (Question posée au propriétaire, deux réponses prêtes.)
 */
export function catalogue(mag: MagasinVenus): { regle: boolean; nom?: string; texte: string } {
  const d = mag.get('acq_reglages', 'catalogue')?.data;
  return d?.nom ? { regle: true, nom: String(d.nom), texte: `catalogue : ${String(d.nom)}` } : { regle: false, texte: "Aucun catalogue des sorties n'est réglé : « À venir » ne lit rien sur Internet tant que tu n'en as pas choisi un." };
}

// ---------------------------------------------------------------- Le réseau de Delta (adresses du propriétaire)
/**
 * Un fetch pour les sources : jamais vers la machine d'Odin elle-même (même par un nom qui y mène), jamais de
 * redirection. Le nom est résolu une fois et la connexion part vers l'adresse vérifiée (voir reseau.ts).
 */
export function fetchSources(_ctx: ModCtx): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    if (hoteInterdit(new URL(url).hostname)) throw new Error("l'adresse de la source mène à la machine d'Odin elle-même : refusé");
    return reseauDelta()(url, { ...init, redirect: 'manual' });
  };
}

// ---------------------------------------------------------------- La chaîne
export interface Bilan { demande: Demande; suivi?: Suivi; lances: Telechargement[]; trouves: number; texte: string }
const deux = (n: number) => String(n).padStart(2, '0');
const lab = (x: { saison?: number; episode?: number }) => (x.saison !== undefined ? ` S${deux(x.saison)}E${deux(x.episode ?? 0)}` : '');

/**
 * Fait venir ce qu'une demande attend : suivi (Sirius ou Pléiades), recherche dans Delta, et — seulement si
 * `telecharger` (le propriétaire l'a lancé ou validé) — la mise en file dans Comète.
 */
export async function faireVenir(ctx: ModCtx, idDemande: string, o: { telecharger: boolean }): Promise<Bilan> {
  const mag = magasinVenus(ctx.home, ctx.dir);
  let d = demande(mag, idDemande); if (!d) throw new Error(`demande « ${idDemande} » inconnue`);
  let x = suivre(mag, { genre: d.genre, titre: d.titre, ...(d.anime ? { anime: true } : {}), ...(d.annee ? { annee: d.annee } : {}), ...(d.saisons ? { saisons: d.saisons } : {}), ...(d.episodes ? { episodes: d.episodes } : {}), demande: d.id });
  d = majDemande(mag, d.id, { suivi: x.id })!;
  const fin = (etat: Demande['etat'], note: string, lances: Telechargement[] = [], trouves = 0): Bilan => { const r = majDemande(mag, idDemande, { etat, note })!; return { demande: r, suivi: suivi(mag, x.id), lances, trouves, texte: note }; };
  if (x.etat === 'disponible') return fin('disponible', 'déjà dans la bibliothèque');
  if (!x.dossier) return fin('en attente', `aucun dossier « ${x.genre === 'film' ? 'Films' : 'Séries'} » déclaré dans Vénus : déclare-le, puis relance`);
  if (!sources(mag).some((s) => s.actif)) return fin('en attente', 'aucune source réglée dans Delta : ajoute une source que tu as le droit d\'utiliser');
  const f = fetchSources(ctx), c = reglagesComete(mag), choix: Choix = { qualite: x.qualite, tailleMaxOctets: c.tailleMaxGo * 1e9, langue: x.langue };
  const erreurs: string[] = [], parSaison = new Map<number, Resultat[]>();
  // Une série sans épisodes précis : chaque saison suivie est cherchée, les épisodes trouvés deviennent « voulus ».
  if (x.genre === 'serie') {
    for (const sn of x.saisons) {
      const r = await chercher(mag, f, { genre: 'saison', titre: x.titre, saison: sn }); erreurs.push(...r.erreurs); parSaison.set(sn, r.resultats);
      if (!x.episodes.some((e) => e.saison === sn)) {
        const vus = new Set<number>();
        for (const res of r.resultats) { const m = /[Ss](\d{1,2})[\s.\-]*[Ee](\d{1,4})/.exec(res.titre); if (m && Number(m[1]) === sn) vus.add(Number(m[2])); }
        x = suivre(mag, { genre: 'serie', titre: x.titre, episodes: [...vus].sort((a, b) => a - b).map((episode) => ({ saison: sn, episode })) });
      }
    }
    if (!x.episodes.length) return fin('cherchée', `aucun épisode trouvé pour ${x.saisons.length ? `la saison ${x.saisons.join(', ')}` : 'cette série (donne une saison)'}${erreurs.length ? ` · ${erreurs.join(' ; ')}` : ''}`);
  }
  const lances: Telechargement[] = [], raisons = new Set<string>(); let trouves = 0;
  for (const m of manquants(mag, x)) {
    const req: Requete = x.genre === 'film' ? { genre: 'film', titre: x.titre, ...(x.annee ? { annee: x.annee } : {}) } : { genre: 'episode', titre: x.titre, saison: m.saison!, episode: m.episode! };
    let l = req.saison !== undefined ? parSaison.get(req.saison) : undefined;
    let best = l ? meilleur(l, req, choix) : undefined;
    if (!best?.choisi) { const r = await chercher(mag, f, req); erreurs.push(...r.erreurs); l = r.resultats; best = meilleur(l, req, choix); }
    if (!best.choisi) { for (const e of best.ecartes.slice(0, 3)) raisons.add(e.pourquoi); continue; }
    trouves++;
    if (!o.telecharger) continue;
    try {
      const t = ajouter(ctx, { resultat: best.choisi, cible: x.genre === 'film' ? { genre: 'film', titre: x.titre, ...(x.annee ? { annee: x.annee } : {}) } : { genre: 'episode', titre: x.titre, saison: m.saison, episode: m.episode }, racine: x.dossier, suivi: x.id, demande: d.id });
      lances.push(t);
      const s0 = suivi(mag, x.id)!;
      if (s0.genre === 'film') { s0.etat = 'en téléchargement'; s0.telechargement = t.id; } else { const e = s0.episodes.find((y) => y.saison === m.saison && y.episode === m.episode); if (e) { e.etat = 'en téléchargement'; e.telechargement = t.id; } }
      x = poserSuivi(mag, recompter(mag, s0));
    } catch (e) { raisons.add((e as Error).message); }
  }
  const err = erreurs.length ? ` · ${[...new Set(erreurs)].slice(0, 3).join(' ; ')}` : '';
  if (lances.length) return fin('en téléchargement', `${lances.length} téléchargement(s) lancé(s) dans Comète${err}`, lances, trouves);
  if (trouves && !o.telecharger) return fin(d.qui.proprietaire ? 'cherchée' : 'à valider', `${trouves} trouvé(s) : le téléchargement attend la validation du propriétaire${err}`, [], trouves);
  if (trouves) return fin('échec', `trouvé, mais Comète ne l'a pas pris : ${[...raisons].join(' ; ')}`, [], trouves);
  return fin('cherchée', `pas encore trouvé${raisons.size ? ` (${[...raisons].join(' ; ')})` : ''}${err}`);
}

// Comète prévient quand un téléchargement finit : le suivi et la demande suivent.
quandFini((ctx, t) => {
  const mag = magasinVenus(ctx.home, ctx.dir); if (!t.suivi) return;
  const x = suivi(mag, t.suivi); if (!x) return;
  const mot = t.etat === 'termine' ? 'disponible' : t.etat === 'echec' ? 'échec' : 'manquant';
  if (x.genre === 'film' && x.telechargement === t.id) { x.etat = mot; if (mot !== 'disponible') delete x.telechargement; if (mot === 'échec') x.note = t.texte; }
  for (const e of x.episodes) if (e.telechargement === t.id) { e.etat = mot; if (mot === 'échec') e.note = t.texte; }
  const r = poserSuivi(mag, recompter(mag, x));
  // Un animé rangé par Pléiades : l'œuvre porte la catégorie « anime » (l'interface de Vénus la lit).
  if (t.etat === 'termine' && r.anime && r.genre === 'serie') { const o = mag.get('oeuvres', r.id); if (o && o.data.categorie !== 'anime') mag.poser('oeuvres', r.id, { ...o.data, categorie: 'anime' }); }
  if (!t.demande) return;
  const enCours = r.genre === 'film' ? r.etat === 'en téléchargement' : r.episodes.some((e) => e.etat === 'en téléchargement');
  if (r.etat === 'disponible') majDemande(mag, t.demande, { etat: 'disponible', note: 'dans la bibliothèque de Vénus' });
  else if (t.etat === 'echec' && !enCours) majDemande(mag, t.demande, { etat: 'échec', note: t.texte ?? 'échec du téléchargement' });
  else if (t.etat === 'annule' && !enCours) majDemande(mag, t.demande, { etat: 'cherchée', note: 'téléchargement annulé' });
  else if (t.etat === 'termine' && !enCours) majDemande(mag, t.demande, { etat: 'cherchée', note: `reçu${lab(t.cible)} ; il manque encore des épisodes` });
});
