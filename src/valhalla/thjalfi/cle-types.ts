// Genèse · le CONTRAT de la clé USB bootable (nouveau mode « Clé USB » de Genèse, pas une appli à part).
// Ce fichier est écrit EN PREMIER et figé : il relie les deux lots (préparation de la clé d'un côté ; chargeur,
// thèmes, écran hors ligne, écrans communs de l'autre). Que des types et des constantes de disposition — aucun
// code qui s'exécute, aucune écriture disque. La clé s'appelle toujours ODIN et reprend les mêmes thèmes, les
// mêmes recettes et le même écran graphique que le démarrage par le réseau.
import type { Recipe } from './recipes.ts';
import type { Category, Disposition, TextTheme, Theme } from './ecran.ts';
import type { Empreinte } from './cle.ts';

/** Schéma de partition choisi à la préparation, façon Rufus : GPT pour UEFI, MBR pour vieux BIOS (+ UEFI-CSM). */
export type Schema = 'gpt' | 'mbr';
/** Le mode par défaut de l'écran au démarrage : graphique (animé, Alpine hors ligne) ou texte (menu GRUB habillé). */
export type ModeDefaut = 'graphique' | 'texte';
/** Ce que la clé fait d'un système : l'installer, l'essayer sans toucher au disque, ou juste le démarrer (disque virtuel, outil). */
export type ModeSysteme = 'installer' | 'essai' | 'demarrer';

/**
 * Les TROIS CHOIX clairs offerts pour CHAQUE système (cœur de la demande du propriétaire), plus la copie d'une VM :
 *  - 'iso'         : une ISO qui démarre (installateur ou système live) — ne garde pas les fichiers ; c'est le mode actuel ;
 *  - 'installe'    : un système installé qui GARDE les fichiers (Windows To Go, ou Linux installé sur une partition) ;
 *  - 'persistance' : un Linux live avec un fichier de persistance Ventoy (garde fichiers et réglages) ;
 *  - 'vm'          : la copie d'un disque de machine virtuelle (VM locale d'Hydre, VM Proxmox, ou disque déposé).
 * Le propriétaire mélange ce qu'il veut sur la même clé/le même disque, jusqu'à 20+ entrées.
 */
export type ChoixSysteme = 'iso' | 'installe' | 'persistance' | 'vm';

/**
 * D'où vient le disque d'une VM copiée sur la clé (lot A le remplit, lot B l'affiche) :
 *  - 'hydre-locale' : une VM de CE PC gérée par Hydre (disque qcow2 lisible → copie directe possible) ;
 *  - 'proxmox'      : une VM d'un serveur Proxmox du cluster — Hydre n'en expose PAS le disque, d'où la voie
 *                     « disque exporté déposé » (vzdump/qm côté Proxmox, puis dépôt à la racine) ;
 *  - 'depot'        : un disque de VM déjà exporté et déposé par la personne sur la clé/le disque.
 */
export interface SourceVm {
  origine: 'hydre-locale' | 'proxmox' | 'depot';
  /** l'identifiant de la VM côté serveur, quand il existe */
  vmid?: number | string;
  /** le serveur Proxmox d'où vient la VM, le cas échéant */
  serveur?: string;
  nom: string;
  famille: 'windows' | 'linux' | 'inconnu';
  /** le chemin du disque, quand Odin peut le lire (VM locale d'Hydre, ou disque exporté déposé) */
  disque?: string;
  /** vrai : la VM a été arrêtée proprement, ou un instantané pris, AVANT la copie (cohérence du disque) */
  instantaneFait?: boolean;
}

/** Le genre d'une CIBLE d'écriture : la même préparation marche sur une clé USB comme sur un disque dur. */
export type GenreCible = 'cle' | 'disque-externe' | 'disque-interne';
/**
 * Ce sur quoi Odin écrit : une clé USB OU un disque dur (externe USB, ou interne avec le double démarrage déjà
 * fait par Genèse). Un gros disque externe peut tout contenir (plusieurs systèmes installés + beaucoup d'ISO).
 */
export interface Cible {
  id: string;
  genre: GenreCible;
  tailleOctets: number;
  /** vrai : la cible est déjà une clé/un disque ODIN (mise à jour sans tout effacer) */
  estOdin: boolean;
}

/** Un système choisi dans la bibliothèque d'Odin et copié sur la clé (ISO, Windows compris). */
export interface SystemeCle {
  /** le nom du fichier posé dans /ISO (ex. « ubuntu-24.04.3-desktop-amd64.iso ») */
  fichier: string;
  /** le nom lisible montré dans le menu (ex. « Ubuntu Desktop ») */
  nom: string;
  famille: Category;
  mode: ModeSysteme;
  /** la recette d'installation d'Odin (réponses automatiques, logiciels) ; pour un simple démarrage elle peut rester minimale */
  recipe: Recipe;
  /** le CHOIX clair de la personne pour CE système ; absent = 'iso' (comportement actuel) */
  choix?: ChoixSysteme;
  /** choix 'installe' sur un Windows : Windows To Go (VHDX appliqué par DISM, rendu amorçable par bcdboot) */
  winToGo?: { tailleGo: number; editionWim?: string };
  /** choix 'persistance' : le fichier de persistance Ventoy posé à côté de l'ISO (garde fichiers et réglages) */
  persistance?: { label: string; tailleMo: number; fs: 'ext4' | 'ext2' | 'xfs'; conf?: boolean };
  /** choix 'installe' sur un Linux : une vraie partition sur la clé/le disque où le système est installé */
  installPartition?: { tailleGo: number };
  /** choix 'vm' : d'où vient le disque de VM copié et préparé */
  vmSource?: SourceVm;
}

/** Un disque de machine virtuelle copié sur la clé (/vdisk), façon extensions de Ventoy (VHD/VHDX, vDisk Linux). */
export interface VdiskCle {
  fichier: string;
  /** format tel que posé sur la clé (« vhd », « vhdx », « img », « raw », « vtoy »…) ou format source à convertir (« vmdk », « qcow2», « vdi ») */
  format: string;
  /** vrai si le disque a déjà été préparé par odin-boot (initramfs qui retrouve la clé) ; faux = à préparer avant de marcher */
  prepare: boolean;
}

/** Un logiciel choisi, copié sur la clé (/logiciels/windows|linux) et installé en silencieux à la fin. */
export interface LogicielCle {
  id: string;
  fichier: string;
  /** les options silencieuses de l'installateur (voir silentArgs de recipes.ts) */
  args: string;
  /** vrai = paquet MSI Windows (installé par msiexec) */
  msi: boolean;
}

/**
 * Tout ce qui décrit UNE préparation de clé : le schéma, le démarrage sécurisé, le nom (toujours ODIN), le thème
 * graphique et texte et la disposition (les mêmes que le réseau), le mode par défaut, le délai du menu, le mot de
 * passe d'installation éventuel (empreinte, jamais en clair), les systèmes, les images, les disques virtuels, les
 * logiciels, et le système qui démarre seul après le délai (son fichier) le cas échéant.
 */
export interface PreparationCle {
  schema: Schema;
  secureBoot: boolean;
  label: 'ODIN';
  /** la cible : clé USB OU disque dur (absent : une clé, comme avant) */
  cible?: Cible;
  theme: Theme;
  texte: TextTheme;
  disposition: Disposition;
  modeDefaut: ModeDefaut;
  /** délai du menu avant de démarrer le système par défaut, en secondes (0 = pas de démarrage automatique) */
  delai: number;
  motDePasse?: Empreinte;
  systemes: SystemeCle[];
  /** autres images disque brutes copiées (/ISO), sans recette : juste des fichiers à démarrer */
  images: string[];
  vdisks: VdiskCle[];
  logiciels: LogicielCle[];
  /** le fichier (dans /ISO ou /vdisk) qui démarre seul après le délai, si on en veut un */
  defaut?: string;
}

/**
 * La DISPOSITION DE LA CLÉ : où va chaque chose sur la 1re partition (nommée ODIN). Le lot A écrit ces dossiers,
 * le lot B dit seulement leurs chemins (ici) et comment les remplir (fonctions pures). Figé : aucun des deux lots
 * ne change ces chemins sans changer le contrat.
 */
export const DISPOSITION_CLE = {
  /** les ISO et les images disque brutes */
  iso: '/ISO',
  /** les disques de machines virtuelles (VHD/VHDX, vDisk Linux) */
  vdisk: '/vdisk',
  /** les fichiers de persistance Linux posés à côté des ISO (greffon persistence de Ventoy) */
  persistance: '/persistence',
  /** la racine de la 1re partition ODIN : tout fichier déposé ici est scanné et indexé au démarrage */
  racine: '/',
  /** les installeurs de logiciels copiés, rangés par système */
  logicielsWindows: '/logiciels/windows',
  logicielsLinux: '/logiciels/linux',
  /** les greffons de Ventoy : le fichier qui dit tout ce qu'on fait au démarrage */
  ventoyJson: '/ventoy/ventoy.json',
  /** le thème GRUB aux couleurs du thème texte choisi */
  ventoyTheme: '/ventoy/theme/odin',
  /** la copie hors ligne de /ecran : la page, ses données figées, et l'image Alpine « Écran Odin » */
  ecranOffline: '/ecran-odin',
  /** les scripts générés tout seuls (autounattend.xml, user-data, preseed, late-commands, apres.ps1, odin-boot) */
  odin: '/odin',
  /** le journal des empreintes, pour revérifier la clé (une ligne JSON par fichier) */
  journal: '/odin/journal.jsonl',
} as const;

/** Les noms des fichiers générés et rangés dans /odin (contrat entre les deux lots). */
export const FICHIERS_ODIN = {
  autounattend: 'autounattend.xml',
  userData: 'user-data',
  metaData: 'meta-data',
  preseed: 'preseed.cfg',
  kickstart: 'kickstart.cfg',
  apresWindows: 'apres.ps1',
  odinBoot: 'odin-boot',
  /** le script d'indexation lancé au démarrage, qui range au menu tout fichier déposé à la racine */
  odinScan: 'odin-scan',
} as const;

/**
 * Le PLAN DE PLACE, affiché AVANT toute écriture (garde-fou du propriétaire) : combien de place prend chaque
 * système choisi sur la cible, ce qui est effacé, ce qui reste, et les avertissements (cible trop petite, gros
 * disque externe…). Lot A le calcule (cle-cible.ts), lot B l'affiche. Pur : aucune écriture.
 */
export interface PlanPlace {
  /** vrai : le plan tient sur la cible ; faux : Odin s'arrête et dit pourquoi (blocage) */
  possible: boolean;
  blocage?: string;
  partitions: Array<{ role: 'ISO ODIN' | 'WinToGo' | 'Linux installé' | 'persistance'; tailleGo: number; efface: boolean }>;
  /** la place qui resterait libre sur la cible après ce plan, en Go */
  resteGo: number;
  avertissements: string[];
}

/** Le nom de la clé : toujours ODIN, en majuscules (étiquette de la 1re partition, exFAT, comme Ventoy). */
export const NOM_CLE = 'ODIN' as const;
/** Le nom de la 2e partition de Ventoy (le chargeur) : fixe, hérité de Ventoy. */
export const NOM_PARTITION_EFI = 'VTOYEFI' as const;
