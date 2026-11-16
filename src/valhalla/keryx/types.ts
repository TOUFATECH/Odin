// Kéryx — l'assistant d'Odin joignable DE DEHORS (le héraut grec, « kêryx », qui porte et exécute les messages).
// Il AGIT à la place du propriétaire (mails, agenda, autres applis), il ne fait pas que répondre. On le joint sans
// appli par les messageries déjà en place (Telegram, Signal) et par la voix d'Odin ; les SMS (modem) et l'appel (SIP)
// sont codés mais pas encore essayés sur du vrai matériel, éteints par défaut.
//
// « Alternative à » : Instinct. Ce fichier range les types du contrat partagé entre les deux lots.

/** La ligne par laquelle Kéryx est joignable pour les SMS et les appels (« aucune » = seulement les messageries déjà là). */
export type Ligne = 'aucune' | 'modem' | 'sip';

/** Le niveau d'autonomie accordé à Kéryx une fois le code secret prouvé. */
export type NiveauAuto = 'prudent' | 'equilibre' | 'autonome';

/** Une chose que Kéryx a le droit de surveiller et de signaler de lui-même. */
export interface Surveillance {
  id: string;
  quoi: 'rappel_rdv' | 'mail_important';
  /** Le réglage libre de la surveillance (ex. « 30 » minutes avant, ou un mot-clé). */
  reglage: string;
  actif: boolean;
}

/** Les réglages de Kéryx (la page les règle ; les secrets vont au coffre, jamais ici). */
export interface ReglagesKeryx {
  ligne: Ligne;
  /** La liste blanche de numéros / identifiants connus (rangée chiffrée, comme les propriétaires). */
  numeros: string[];
  autonomieApresSecret: NiveauAuto;
  /** Une action grave par appel vocal : interdite, ou confirmée sur un second canal (message). */
  actionGraveParAppel: 'interdite' | 'second_canal';
  surveillances: Surveillance[];
  modem?: { port: string; debit: number };
  sip?: { serveur: string; utilisateur: string /* mot de passe au coffre, jamais ici */ };
}

/** Une entrée de la chronologie : un échange (entrant/sortant) ou une action faite par Kéryx. */
export interface EntreeTrace {
  id: string;
  quand: string /* ISO */;
  canal: string;
  pair: string;
  sens: 'entrant' | 'sortant' | 'action';
  texte: string;
  action?: { outil: string; resume: string; confirmee: boolean; gravite: 'routine' | 'important' | 'grave' };
  resultat?: 'faite' | 'refusee' | 'en_attente';
}

/** L'état de Kéryx montré à l'écran (le point fort « vie privée » affiché noir sur blanc). */
export interface EtatKeryx {
  ligne: Ligne;
  canauxActifs: string[];
  mailBranche: boolean;
  agendaBranche: boolean;
  viePrivee: { captureEcran: false; pistageLieu: false };
  telephonieEssayee: false;
}

/** Le résultat d'un essai contre un FAUX pair (bouton ESSAYER, et les tests). */
export interface Essai {
  quoi: 'sip' | 'modem';
  etapes: { sens: '→' | '←'; trame: string }[];
  ok: boolean;
  note: string /* « codé, pas essayé sur du vrai matériel » */;
}

/** La note affichée et écrite partout pour ce qui n'a pas été vu marcher en vrai. */
export const NON_ESSAYE = 'codé, pas essayé sur du vrai matériel';

/** Les valeurs de départ des réglages : aucune ligne, prudence maximale, vie privée garantie. */
export const REGLAGES_DEFAUT: ReglagesKeryx = {
  ligne: 'aucune',
  numeros: [],
  autonomieApresSecret: 'prudent',
  actionGraveParAppel: 'interdite',
  surveillances: [],
};
