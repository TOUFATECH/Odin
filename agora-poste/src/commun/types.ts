// Ce que le processus principal d'Agora montre à l'interface (une seule forme, envoyée à chaque changement).

export type Mode = 'proposee' | 'office' | 'retiree';
/** Une ligne du store (ce qu'Odin propose ou impose, et ce qui est vraiment sur ce poste). */
export interface LigneStore {
  id: string; nom: string; desc: string; mode: Mode; par: string;
  /** imposée (installée d'office ou forcée) : la personne ne peut pas l'enlever */ impose: boolean;
  installee: boolean; versionLocale?: string; versionOdin?: string;
  /** il y a un installateur pour ce système */ installable: boolean;
  /** appli d'Odin (web) : « Ouvrir » ouvre Odin dans le navigateur */ web?: string;
  enCours?: { action: 'installer' | 'desinstaller' | 'mettre_a_jour'; progression?: number };
  erreur?: string; majDispo: boolean;
}
export interface EtatUI {
  connexion: 'aucune' | 'connexion' | 'ok' | 'horsligne';
  odin?: { adresse: string; nom: string };
  personne?: { nom: string; login: string; groupes: string[] };
  appareil?: { nom: string; plateforme: string };
  store: LigneStore[];
  historique: Array<{ quand: number; texte: string; ok: boolean }>;
  /** bannière en haut du store (« 2 nouveautés arrivent dans ton store ») */ message?: string;
  /** ce que l'écran de connexion doit dire (erreur, code demandé) */ connexionInfo?: { erreur?: string; codeRequis?: boolean; trouves?: Array<{ adresse: string; nom: string }> };
  enLigne: boolean;
  version: string;
}
