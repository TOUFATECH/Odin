// Vénus · Acquisition (PHASE 2, squelette posé). Le bloc d'acquisition natif complet — Delta (sources/indexeurs),
// Hnoss (demandes), Sirius (films), Pléiades (séries), Odyssée (livres), Comète (téléchargement + seeding) — avec les
// filtres de qualité/langue, la recherche par lots, l'autotest et l'import Prowlarr. Ici : le MODÈLE de données (tables
// de VENUS_ODIN déjà créées par base.ts) et le SQUELETTE ; le gros reste à porter (dit honnêtement, bloc par bloc).
//
// BASCULE « serveur externe pour le non-porté » : tant qu'un bloc n'est pas porté nativement, si un serveur Venus
// externe est encore configuré, Vénus peut continuer à s'en servir POUR CE BLOC ; tout ce qui EST porté marche sans
// lui. La cible reste « zéro externe ».
//
// Comète = Atalante : on NE recode PAS un client torrent. Atalante (l'appli de téléchargement d'Odin : file, reprise,
// antivirus) est réutilisée par l'interface `MoteurTelechargement` ci-dessous. Le torrent/magnet et le seeding natifs
// restent à étudier (WebTorrent / transmission-cli) : à ce stade, honnêtement, non disponibles sans une brique en plus.
import type { MagasinVenus } from './base.ts';

/** Les blocs d'acquisition, par leurs noms d'Odin. */
export type Bloc = 'delta' | 'hnoss' | 'sirius' | 'pleiades' | 'odyssee' | 'comete';
export const BLOCS: Record<Bloc, { nom: string; role: string; alternative: string }> = {
  delta: { nom: 'Delta', role: 'sources / indexeurs (Torznab, Newznab), test, import Prowlarr', alternative: 'Prowlarr' },
  hnoss: { nom: 'Hnoss', role: 'demandes de titres', alternative: 'Jellyseerr' },
  sirius: { nom: 'Sirius', role: 'films', alternative: 'Radarr' },
  pleiades: { nom: 'Pléiades', role: 'séries', alternative: 'Sonarr' },
  odyssee: { nom: 'Odyssée', role: 'livres et livres audio', alternative: 'Readarr' },
  comete: { nom: 'Comète', role: 'téléchargement + seeding (réutilise Atalante)', alternative: 'qBittorrent' },
};

/** L'état porté / à porter d'un bloc. En phase 1, tous les blocs d'acquisition sont « à porter » (squelette). */
export type EtatBloc = 'natif' | 'a_porter';

export interface EtatAcquisition { bloc: Bloc; nom: string; etat: EtatBloc; delegue: boolean; note: string }

/** Un serveur Venus externe est-il encore configuré (pour la bascule du non-porté) ? Pur. */
export const serveurExterneConfigure = (url: string | undefined, cle: string | undefined): boolean => Boolean((url ?? '').trim() && (cle ?? '').trim());

/**
 * L'état de l'acquisition, bloc par bloc : ce qui est natif (phase 1 : rien encore), ce qui reste à porter, et si un
 * serveur externe prend le relais en attendant. Pur, testable.
 */
export function etatAcquisition(externe: boolean): EtatAcquisition[] {
  return (Object.keys(BLOCS) as Bloc[]).map((b) => ({
    bloc: b, nom: BLOCS[b].nom, etat: 'a_porter',
    delegue: externe,
    note: externe ? `pas encore porté : relais par le serveur Venus externe (${BLOCS[b].role})` : `pas encore porté, et aucun serveur externe : indisponible pour l'instant (${BLOCS[b].role})`,
  }));
}

/** Le moteur de téléchargement réutilisé pour Comète (Atalante). Injecté : Vénus ne recode pas un client torrent. */
export interface MoteurTelechargement {
  /** met un lien/magnet en file (rend un identifiant de tâche) */
  ajouter(lien: string, o?: { nom?: string; dossier?: string }): Promise<string>;
  /** l'état d'une tâche */
  etat(id: string): Promise<{ avancement: number; fini: boolean; fichier?: string } | undefined>;
}

/** Les tables d'acquisition posées dans VENUS_ODIN (créées par base.ts), avec leur nombre d'enregistrements. */
export function modeleAcquisition(mag: MagasinVenus): Record<string, number> {
  const o: Record<string, number> = {};
  for (const c of ['sources', 'envies', 'filtres', 'telechargements', 'acq_journal', 'lots', 'acq_reglages', 'autotest'] as const) o[c] = mag.liste(c).length;
  return o;
}

/**
 * Pose une source (Delta) dans le modèle natif (sa clé NE va PAS ici : elle reste au coffre, hors base). Squelette :
 * la recherche réelle dans la source reste à porter (phase 2).
 */
export function poserSource(mag: MagasinVenus, o: { id: string; nom: string; type: 'torznab' | 'newznab'; adresse: string; actif?: boolean; priorite?: number }): void {
  mag.poser('sources', o.id, { nom: o.nom, type: o.type, adresse: o.adresse, actif: o.actif !== false, priorite: o.priorite ?? 25 });
}
/** Le résumé de Comète : le moteur réutilisé (Atalante) et le point honnête sur le torrent/seeding natif. */
export const resumeComete = (moteur: MoteurTelechargement | undefined): string =>
  moteur ? 'Comète réutilise Atalante (file, reprise, antivirus). Le torrent/magnet et le seeding natifs restent à étudier (WebTorrent / transmission-cli).'
    : 'Comète (téléchargement) : à brancher sur Atalante. Torrent/seeding natif non disponible sans une brique en plus (dit honnêtement).';
