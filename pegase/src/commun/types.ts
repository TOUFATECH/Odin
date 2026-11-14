// Types partagés entre le processus principal et l'interface de Pégase.

export type Theme = 'noir' | 'blanc' | 'bleu' | 'rouge' | 'transparent' | 'glace';
export const THEMES: Theme[] = ['noir', 'blanc', 'bleu', 'rouge', 'transparent', 'glace'];

/** Les collections synchronisées avec Odin (contrat §3). */
export type Collection = 'profil' | 'favoris' | 'onglets' | 'espaces' | 'bureaux' | 'historique' | 'agenda' | 'reglages' | 'telechargements';
export const COLLECTIONS: Collection[] = ['profil', 'favoris', 'onglets', 'espaces', 'bureaux', 'historique', 'agenda', 'reglages', 'telechargements'];

/** Un enregistrement synchronisé (contrat §3). */
export interface Enregistrement<T = any> { id: string; col: Collection; data: T; maj: number; appareil: string; suppr?: true }

export interface Espace { id: string; nom: string; couleur: number; ordre: number; theme?: Theme }

/** Un onglet tel que l'interface le voit (données rangées + état du moment). */
export interface OngletVu {
  id: string; url: string; titre: string; icone?: string; espace: string;
  epingle: boolean; dossier?: string; ordre: number;
  charge: boolean; peutReculer: boolean; peutAvancer: boolean; enVeille: boolean;
  son: boolean; muet: boolean; video: boolean; prive: boolean; plante?: boolean;
  bloques: number; securise: boolean; certificat?: string;
}
export interface DossierVu { id: string; nom: string; espace: string; ouvert: boolean; ordre: number }
export interface Bureau { id: string; espace: string; onglets: string[]; disposition: 'ligne' | 'colonne' | 'grille'; nom?: string; ordre: number }
export interface Favori { id: string; nom: string; url: string; dossier?: string; type: 'favori' | 'dossier'; tuile?: boolean; ordre: number; icone?: string; appli?: string }
export interface Range { id: string; url: string; titre: string; espace: string; quand: number }
export interface Video { onglet: string; titre: string; lecture: boolean; temps: number; duree: number; muet: boolean }
export interface Telechargement {
  id: string; nom: string; taille: number; recu: number; etat: 'reception' | 'analyse' | 'sain' | 'bloque' | 'annule' | 'erreur';
  detail: string; chemin?: string; quand: number; menace?: string;
}
export interface RendezVous { id: string; titre: string; debut: number; fin: number; lieu?: string; agenda?: string; rappel?: number; couleur?: number; note?: string }
export interface HistoireLigne { id: string; url: string; titre: string; date: number; duree?: number; appareil?: string }

export interface Reglages {
  theme: Theme; transparence: number; veilleMinutes: number; rangerHeures: number;
  bloqueur: 'coupe' | 'normal' | 'strict'; cookiesRefus: boolean; videoAuto: boolean;
  dnsSecours: string; analyseOdin: boolean; moteur: 'pythie' | 'duckduckgo' | 'google' | 'qwant';
  synchroHistorique: 'tout' | 'sans-historique' | 'rien'; pageAccueil: 'accueil' | 'vide';
}
export const REGLAGES_DEFAUT: Reglages = {
  theme: 'bleu', transparence: 60, veilleMinutes: 10, rangerHeures: 12, bloqueur: 'normal', cookiesRefus: true,
  videoAuto: true, dnsSecours: 'https://dns.quad9.net/dns-query', analyseOdin: false, moteur: 'duckduckgo',
  synchroHistorique: 'tout', pageAccueil: 'accueil',
};

export type EtatSynchro = { etat: 'local' | 'ok' | 'encours' | 'horsligne'; attente: number; odin?: string; derniere?: number };

export interface Profil { id: string; nom: string; email?: string; couleur: number; lettre: string }

/** L'écran à montrer avant le navigateur (démarrage, 1er lancement, connexion). */
export type Ecran = 'demarrage' | 'odin' | 'compte' | 'sauvegarde' | 'connexion' | 'navigateur';

export interface Etat {
  ecran: Ecran;
  plateforme: string;
  profil: Profil; profils: { id: string; nom: string; couleur: number }[];
  espaces: Espace[]; espaceActif: string;
  onglets: OngletVu[]; dossiers: DossierVu[]; bureaux: Bureau[];
  /** Ce qui est affiché dans la zone de page : un onglet ou un bureau (écran partagé). */
  actif: { type: 'onglet' | 'bureau'; id: string } | null;
  tuiles: Favori[]; favorisBarre: Favori[]; nbFavoris: number;
  ranges: Range[];
  videos: Video[];
  telechargements: Telechargement[];
  reglages: Reglages;
  synchro: EtatSynchro;
  protection: { bloquesTotal: number; dns: string; dnsChiffre: boolean; filtres: number; pret: boolean };
  barreReduite: boolean; panneauOdin: boolean; prive: boolean; maximise: boolean;
  odin?: { url: string; nom: string; connecte: boolean };
  memoire?: number;
}

/** Zone où poser une page web (pixels de la fenêtre). */
export interface Zone { id: string; x: number; y: number; w: number; h: number }

/** L'API minimale que le preload donne à l'interface. */
export interface PegaseApi {
  etat(): Promise<Etat>;
  surEtat(f: (e: Etat) => void): void;
  surCommande(f: (c: string, arg?: any) => void): void;
  faire(action: string, arg?: any): Promise<any>;
  zones(z: Zone[], couche: boolean): void;
}
