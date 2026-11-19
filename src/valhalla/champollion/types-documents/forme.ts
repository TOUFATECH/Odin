// Forme des données par langue pour reconnaître un document déposé (voir analyse.ts, typeDocument).
// Chaque langue donne ses mots, écrits comme dans un document (accents compris) : ils sont ramenés à la même forme
// que le texte (minuscules, sans accents) au chargement. Un mot précédé de « ^ » ne compte qu'en début de ligne.
// Rien ici n'est un ordre : ce sont des indices pour lire, et des libellés de boutons qui ne font que proposer.

/** Les types reconnus (« inconnu » quand rien ne tranche). */
export type TypeConnu =
  | 'facture' | 'devis' | 'contrat' | 'billet' | "carte d'embarquement" | 'relevé bancaire' | 'ordonnance' | 'formulaire'
  | 'courrier administratif' | 'CV';
export const TYPES_CONNUS: readonly TypeConnu[] = [
  'facture', 'devis', 'contrat', 'billet', "carte d'embarquement", 'relevé bancaire', 'ordonnance', 'formulaire', 'courrier administratif', 'CV',
];

/** Les sortes de références lues (numéro de facture, de contrat, de réservation…). */
export type SorteReference = 'facture' | 'devis' | 'contrat' | 'réservation' | 'client' | 'commande' | 'vol' | 'dossier';
export const SORTES_REFERENCE: readonly SorteReference[] = ['facture', 'devis', 'contrat', 'réservation', 'client', 'commande', 'vol', 'dossier'];

/** La liste FERMÉE des boutons qu'un document peut faire proposer. « Payer » n'y est pas : seulement le préparer. */
export type IdBouton = 'convertir-word' | 'convertir-pdf' | 'extraire-tableau' | 'ajouter-echeance' | 'preparer-paiement';

export interface DonneesLangue {
  /** Mots courants, pour reconnaître la langue du document. */
  mots: string[];
  /** Pour chaque type : `forts` (le nom du document, 3 points) et `indices` (1 point). */
  types: Record<TypeConnu, { forts: string[]; indices: string[] }>;
  /** Étiquettes en début de ligne : la valeur suit (ou est sur la ligne suivante). */
  emetteur: string[];
  destinataire: string[];
  /** Étiquettes d'une référence ; la valeur est le premier mot qui suit et qui porte un chiffre. */
  references: Partial<Record<SorteReference, string[]>>;
  /** Étiquettes avant une date, qui disent son rôle. `generiques` : « Date : » seul (émission, ou voyage sur un billet). */
  dates: { echeance: string[]; validite: string[]; voyage: string[]; emission: string[]; generiques: string[] };
  /** Étiquettes des lignes de montants ; `horsLignes` : des montants qui ne sont pas des lignes d'articles (acompte…). */
  montants: { ttc: string[]; ht: string[]; tva: string[]; total: string[]; horsLignes: string[] };
  /** Mentions qui disent qu'une facture est déjà réglée (en tout ou en partie) ou que c'est un avoir : aucun paiement proposé. */
  regle: string[];
  /** Les mois (janvier → décembre), seulement là où le lecteur de dates des réservations ne les connaît pas. */
  mois?: string[][];
  boutons: Record<IdBouton, string>;
}
