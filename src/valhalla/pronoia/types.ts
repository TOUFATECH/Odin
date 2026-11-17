// Prónoia — le contrat. Une prévision n'est jamais un fait : c'est une ESTIMATION statistique faite dans Odin
// (fréquences, enchaînements, rythmes dans le temps, tendance) à partir de ce qu'Odin a appris chez toi, avec sa
// confiance, sa date et ce sur quoi elle se fonde. Sous un seuil de confiance, c'est un « pressentiment », dit comme tel.
// Une prévision PROPOSE seulement : le moteur n'a aucun moyen d'agir, d'envoyer, d'acheter ni d'alerter.

/** Ce qu'on prévoit : la prochaine demande, la suite d'un échange, ou un événement de la maison. */
export type Sorte = 'demande' | 'suite' | 'evenement';
/** L'état d'une prévision dans le temps. */
export type Etat = 'en_attente' | 'realisee' | 'ratee' | 'perimee';

/** Sur quoi se fonde une prévision (affiché tel quel, jamais caché). */
export interface Source {
  /** habitude, enchainement, heure, raccourci, rythme, tendance, meteo, nous, appli */
  type: 'habitude' | 'enchainement' | 'heure' | 'raccourci' | 'rythme' | 'tendance' | 'meteo' | 'nous' | 'appli';
  /** en clair, court : « 12 fois sur 14 jours vers 7h30 » */
  detail: string;
}

export interface Prevision {
  id: string;
  sorte: Sorte;
  /** ce qui est prévu, en clair (« demander la météo », « la porte du garage s'ouvre ») */
  quoi: string;
  /** clé de rapprochement avec ce qui arrivera (mots porteurs d'une demande, appli/type/clé d'un événement) */
  cle: string;
  /** début de la fenêtre où on l'attend (ms) ; absent = dès maintenant */
  des?: number;
  /** le moment le plus probable (ms), pour mesurer l'écart prévu/arrivé */
  attendu?: number;
  /** échéance : après elle, la prévision est jugée (ms) */
  echeance: number;
  /** 0..1 : la probabilité estimée, jamais arrondie vers le haut */
  confiance: number;
  sources: Source[];
  /** date de la prévision (ms) */
  cree: number;
  etat: Etat;
  /** quand elle a été jugée (ms) */
  resolue?: number;
  /** écart mesuré entre prévu et arrivé, en minutes (événement arrivé dans la fenêtre) */
  ecartMin?: number;
  /** peut-on la juger (une observation arrivera-t-elle) ? sinon elle devient « périmée », pas « ratée » */
  verifiable: boolean;
}

/**
 * Un événement daté d'une appli, reçu SANS dépendre de son code : journal de Valhalla, détection de Théia ou de Syrinx,
 * météo de Zeus, mesure d'une machine. `sujet` dit sur qui il porte : un événement sur un TIERS est refusé (jamais de
 * suivi d'une autre personne).
 */
export interface EvenementDate {
  appli: string;
  type: string;
  /** ms */
  at: number;
  /** précise l'objet (« garage », « disque /data ») ; jamais le nom d'une personne */
  cle?: string;
  /** une mesure (pour une tendance : place occupée en %, etc.) */
  valeur?: number;
  /** le seuil que la mesure ne doit pas dépasser (100 pour un disque plein) */
  seuil?: number;
  /** pour la météo : la probabilité donnée par la source (0..1) et l'échéance de ce qu'elle annonce */
  probabilite?: number;
  pour?: number;
  /** sur qui porte l'événement : la maison (défaut), le propriétaire lui-même, ou un tiers (refusé) */
  sujet?: 'maison' | 'proprietaire' | 'tiers';
}

/** Une demande du propriétaire, retenue pour apprendre ses habitudes. */
export interface Demande { at: number; texte: string }

/** Options d'un échange : en mode privé ou « ne pas garder », rien n'est appris ni gardé. */
export interface OptionsEchange { prive?: boolean; nePasGarder?: boolean; /** sauvegarde différée (rafales, fil d'une réponse) */ differer?: boolean }

/**
 * La fonction « préparer » injectée : LECTURE SEULE (recherche, rappel). Elle reçoit un signal d'abandon : dès qu'Odin
 * doit répondre, la préparation s'arrête. Elle ne reçoit aucun moyen d'agir ; Prónoia refuse en plus de préparer une
 * demande qui agit (envoyer, acheter, éteindre…).
 */
export type Preparer = (demande: string, o: { signal: AbortSignal; lectureSeule: true }) => Promise<string>;

/** Nourrir Noûs (src/brain/nous/entree.ts `nourrir`, déjà lié à ses dépendances) : l'écart prévu/arrivé. */
export type Nourrir = (n: { sorte: 'note'; texte: string; source: string; fiable: boolean }) => void;

/** La suite probable d'un texte par Noûs, quand il est disponible (sinon absent). */
export type SuiteTexte = (prefixe: string, o: { signal: AbortSignal }) => Promise<{ suite: string; confiance?: number } | undefined>;

/** Ce que Prónoia rend à la surface : une proposition, jamais un ordre. */
export interface Proposition {
  prevision: Prevision;
  /** le texte honnête à montrer (confiance, date, sources ; « pressentiment » si peu sûr) */
  texte: string;
  /** toujours « discret » : jamais d'alerte intrusive sur une simple prévision */
  niveau: 'discret';
  /** toujours faux : c'est le propriétaire qui décide */
  agit: false;
}

export interface Reglages {
  /** l'interrupteur : coupé = plus aucune anticipation */
  actif: boolean;
  /** sous ce seuil, c'est un pressentiment */
  seuilPressentiment: number;
  /** au-dessus de ce seuil (et pas un pressentiment), on peut proposer de prévenir */
  seuilPrevenir: number;
  /** durée de garde des prévisions, demandes et événements (jours) */
  gardeJours: number;
  /** couples « appli/type » ouverts par le propriétaire EN PLUS de la liste blanche par défaut (action grave) */
  sourcesOuvertes: string[];
}
export const REGLAGES_DEFAUT: Reglages = { actif: true, seuilPressentiment: 0.6, seuilPrevenir: 0.7, gardeJours: 60, sourcesOuvertes: [] };

// ------------------------------------------------------------------ Points de branchement des passages suivants
/**
 * (Lot 4, NON CODÉ) Prévoir dans une vidéo ou un son : Théia ou Syrinx donnent une suite d'observations datées d'UNE
 * source ; Prónoia rendra la suite probable (pour mieux interpréter, jamais pour inventer) et, quand la suite réelle
 * arrive, l'écart est transmis à Noûs par le même `Nourrir`.
 */
export interface PrevoyeurFlux {
  source: 'theia' | 'syrinx';
  observer(obs: { t: number; etiquette: string; confiance: number }): void;
  suiteProbable(horizonS: number): Array<{ etiquette: string; confiance: number; t: number }>;
}
