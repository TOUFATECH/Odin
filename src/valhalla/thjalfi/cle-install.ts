// Genèse · clé USB — AJOUTER de VRAIS SYSTÈMES INSTALLÉS sur la clé/le disque, chacun gardant ses fichiers, en
// plus des ISO qui démarrent (Ventoy). Trois voies, toutes étudiées AVEC Ventoy, SANS écrire de code C :
//
//  1) WINDOWS TO GO (choix « installé » pour Windows) : appliquer l'image install.wim de l'ISO Windows officielle
//     dans un VHDX fixe avec DISM (/Apply-Image), le rendre amorçable avec bcdboot, le poser dans /vdisk — Ventoy
//     le démarre NATIVEMENT (démarrage VHD, façon Windows To Go). Options Rufus déjà gérées par Genèse (sans TPM,
//     sans compte Microsoft, sans questions de vie privée, clavier/langue/fuseau d'Odin).
//  2) LINUX PERSISTANT (choix « persistance ») : un fichier de persistance Ventoy posé à côté de l'ISO (greffon
//     persistence), par distribution (casper-rw, vtoycow, MX-Persist, persistence.conf…).
//  3) LINUX INSTALLÉ COMPLET (choix « installé » pour Linux) : une vraie partition, l'installateur la vise (mêmes
//     recettes autoinstall que Genèse), et une entrée GRUB qui enchaîne (chainload) ce système au menu de Ventoy.
//
// Tout est PUR ici : on MONTRE les séquences (DISM, bcdboot, mkfs…) AVANT de les faire ; rien n'est exécuté. Les
// opérations lourdes passent par l'IO injectée de cle-ecrire.ts (creerVhdxWinToGo, creerPersistance), simulée en
// test. On dit HONNÊTEMENT les limites (licence, démarrage sécurisé, clé lente, hôte Windows nécessaire pour bcdboot).

import { DISPOSITION_CLE } from './cle-types.ts';
import type { SystemeCle } from './cle-types.ts';

const isoDir = DISPOSITION_CLE.iso.replace(/^\//, '');
const vdiskDir = DISPOSITION_CLE.vdisk.replace(/^\//, '');
const persistDir = DISPOSITION_CLE.persistance.replace(/^\//, '');

// ---------------- 1) Windows To Go ----------------
/** Les options reprises de Rufus (déjà gérées par Genèse) pour une installation Windows allégée. */
export interface OptionsWinToGo {
  /** retirer les exigences de Microsoft (TPM 2.0, démarrage sécurisé, mémoire, processeur) */
  sansTpm?: boolean;
  /** compte local, pas de compte Microsoft obligatoire */
  sansCompteMicrosoft?: boolean;
  /** pas de questions de vie privée au premier écran */
  sansViePrivee?: boolean;
  langue?: string; clavier?: string; fuseau?: string;
  /** la taille du VHDX, en Go (défaut 32) */
  tailleGo?: number;
  /** l'index de l'édition dans install.wim (défaut 1) */
  index?: number;
  /** des pilotes à injecter (réseau/stockage), pour une VM copiée taillée pour une machine virtuelle */
  pilotes?: string[];
}

export interface PlanWinToGo {
  /** les étapes dites en français, montrées avant d'écrire */
  etapes: string[];
  /** les commandes exactes (DISM, bcdboot, reg) montrées avant — JAMAIS exécutées ici (voir IoCle.creerVhdxWinToGo) */
  commandes: string[];
  /** les limites dites honnêtement à la page */
  limites: string[];
  /** vrai : bcdboot et le magasin BCD n'existent que sous Windows → il faut un hôte Windows (ou une VM Windows d'appoint) */
  besoinHoteWindows: boolean;
  /** le VHDX produit, posé dans /vdisk (Ventoy le démarre tel quel) */
  vhdx: string;
}

/** Les clés de registre qui retirent les exigences de Windows 11 (même effet que Rufus), posées hors ligne. */
const BYPASS = ['BypassTPMCheck', 'BypassSecureBootCheck', 'BypassRAMCheck', 'BypassStorageCheck', 'BypassCPUCheck'];

/**
 * Le plan Windows To Go : appliquer install.wim dans un VHDX fixe (DISM), le rendre amorçable (bcdboot), poser le
 * VHDX dans /vdisk. Pur : rien n'est exécuté, tout est MONTRÉ. L'exécution réelle passe par IoCle.creerVhdxWinToGo.
 * @param isoWindows le nom de l'ISO Windows officielle (son install.wim sera monté par l'IO réelle)
 * @param nom un nom lisible pour le fichier produit
 */
export function planWinToGo(isoWindows: string, nom: string, opt: OptionsWinToGo = {}): PlanWinToGo {
  const base = (nom || isoWindows).replace(/\.[^.]+$/, '').replace(/[^\w.+-]/g, '_') || 'windows-to-go';
  const vhdx = `${vdiskDir}/${base}-wintogo.vhdx`;
  const tailleGo = Math.max(16, Math.round(opt.tailleGo ?? 32));
  const index = Math.max(1, Math.round(opt.index ?? 1));
  const lettreVhdx = 'W:'; // la lettre où l'IO monte le VHDX (montré, pas exécuté)
  const efi = 'S:'; // la partition EFI du VHDX

  const commandes = [
    `# 1) Créer un VHDX fixe de ${tailleGo} Go, le monter, le partitionner (EFI + Windows), puis appliquer l'image.`,
    `dism /Apply-Image /ImageFile:"${isoDir}/${isoWindows}:sources\\install.wim" /Index:${index} /ApplyDir:${lettreVhdx}\\`,
    `# 2) Rendre le VHDX amorçable (chargeur Windows dans la partition EFI).`,
    `bcdboot ${lettreVhdx}\\Windows /s ${efi} /f ALL`,
  ];
  if (opt.sansTpm) {
    commandes.push('# 3) Retirer les exigences de Windows 11 (TPM, démarrage sécurisé, mémoire…) dans le registre hors ligne.');
    commandes.push(`reg load HKLM\\OdinWTG ${lettreVhdx}\\Windows\\System32\\config\\SYSTEM`);
    for (const v of BYPASS) commandes.push(`reg add HKLM\\OdinWTG\\Setup\\LabConfig /v ${v} /t REG_DWORD /d 1 /f`);
    commandes.push('reg unload HKLM\\OdinWTG');
  }
  for (const p of opt.pilotes ?? []) commandes.push(`dism /Image:${lettreVhdx}\\ /Add-Driver /Driver:"${p}" /Recurse`);

  const etapes = [
    `Je crée un disque Windows To Go de ${tailleGo} Go (fichier ${vhdx}).`,
    `J'applique l'édition n°${index} de Windows depuis l'ISO officielle (DISM), sans la modifier.`,
    'Je rends ce disque amorçable (bcdboot), puis Ventoy le démarre tel quel depuis la clé.',
    ...(opt.sansTpm ? ['Je retire les exigences de Windows 11 (TPM, démarrage sécurisé, mémoire) comme Rufus.'] : []),
    ...(opt.sansCompteMicrosoft ? ['Compte local, sans compte Microsoft obligatoire.'] : []),
    ...(opt.sansViePrivee ? ['Pas de questions de vie privée au premier écran.'] : []),
    ...((opt.pilotes?.length ?? 0) ? [`J'injecte ${opt.pilotes!.length} pilote(s) de base (réseau/stockage) pour un vrai PC.`] : []),
  ];

  const limites = [
    'Licence : Windows To Go officiel visait l\'édition Entreprise. Une clé normale marche techniquement, mais la licence est à vérifier — aucune activation n\'est contournée.',
    'Une clé USB lente rend Windows lent : préfère une clé ou un SSD USB rapide.',
    'Démarrage sécurisé : la clé de Ventoy s\'inscrit au 1er démarrage (MokManager), expliqué à l\'écran.',
    'bcdboot et le magasin BCD n\'existent que sous Windows : la fabrication du VHDX demande un hôte Windows (ou une VM Windows d\'appoint). Sinon, Odin ne propose que « démarrer un VHDX déjà prêt ».',
  ];

  return { etapes, commandes, limites, besoinHoteWindows: true, vhdx };
}

// ---------------- 2) Linux persistant (greffon persistence de Ventoy) ----------------
export interface SpecPersistance {
  /** l'étiquette ext du fichier de persistance, attendue par la distribution */
  label: string;
  /** la taille voulue du fichier, en Mo (défaut 4096) */
  tailleMo: number;
  fs: 'ext4' | 'ext2' | 'xfs';
  /** vrai : la distribution a besoin d'un fichier persistence.conf « / union » à l'intérieur (Debian/Kali/Clonezilla) */
  conf: boolean;
}

/** Les familles de distributions reconnues pour la persistance Ventoy, par mot-clé du nom de l'ISO. */
const FAMILLES_PERSIST: Array<{ test: RegExp; label: string; conf: boolean; note?: string }> = [
  { test: /ubuntu|mint|elementary|zorin|pop[-_]?os|lubuntu|xubuntu|kubuntu/, label: 'casper-rw', conf: false },
  { test: /\bmx\b|mx-?linux|antix/, label: 'MX-Persist', conf: false },
  { test: /kali|debian|clonezilla/, label: 'persistence', conf: true },
  { test: /arch|fedora|rocky|alma|centos|nobara/, label: 'vtoycow', conf: false, note: 'selinux=0' },
];

/**
 * Le fichier de persistance d'une distribution (créé façon CreatePersistentImg.sh de Ventoy) : étiquette, système
 * de fichiers et fichier persistence.conf selon la distribution. Garde fichiers et réglages d'un système live. Pur.
 * @param distribution le nom de l'ISO (ou de la distribution) — l'étiquette en dépend
 */
export function specPersistance(distribution: string, tailleMo = 4096): SpecPersistance {
  const n = distribution.toLowerCase();
  const fam = FAMILLES_PERSIST.find((f) => f.test.test(n));
  const label = fam?.label ?? 'casper-rw';
  const conf = fam?.conf ?? false;
  // Fedora/Arch (vtoycow) et la plupart des ext veulent de l'ext4 ; ext2 reste possible si demandé par la distro.
  return { label, tailleMo: Math.max(256, Math.round(tailleMo)), fs: 'ext4', conf };
}

/** Une entrée du tableau `persistence` de ventoy.json (greffon persistence). */
export interface EntreePersistance {
  image: string;
  /** le ou les fichiers de persistance (Ventoy accepte une liste) */
  backend: string;
  /** 1 : la persistance est choisie d'office au démarrage (sans redemander) */
  autosel?: number;
  /** le délai, en secondes, du petit menu de persistance (0 : pas de menu) */
  timeout?: number;
}

/**
 * Le tableau `persistence` de ventoy.json pour tous les systèmes « persistance ». Appelé par buildVentoyJson
 * (cle-boot.ts). Pour chaque système en choix 'persistance', émet l'entrée (image + fichier de persistance posé
 * dans /persistence). Pur. Vide si aucun système n'est en persistance (ventoy.json inchangé).
 */
export function entreesPersistance(systemes: SystemeCle[]): EntreePersistance[] {
  const out: EntreePersistance[] = [];
  for (const s of systemes) {
    if ((s.choix ?? 'iso') !== 'persistance') continue;
    const spec = s.persistance ?? specPersistance(s.fichier);
    const base = s.fichier.replace(/\.[^.]+$/, '').replace(/[^\w.+-]/g, '_');
    out.push({
      image: `${DISPOSITION_CLE.iso}/${s.fichier}`,
      backend: `${DISPOSITION_CLE.persistance}/${base}-${spec.label}.dat`,
      autosel: 1,
      timeout: 5,
    });
  }
  return out;
}

/** La commande qui crée un fichier de persistance (montrée avant, jamais exécutée ici ; faite par IoCle.creerPersistance). Pur. */
export function commandePersistance(spec: SpecPersistance, chemin: string): string[] {
  const cmds = [
    `dd if=/dev/zero of="${chemin}" bs=1M count=${spec.tailleMo} status=progress`,
    `mkfs.${spec.fs} -F -L ${spec.label} "${chemin}"`,
  ];
  if (spec.conf) cmds.push(`# puis, à l'intérieur : écrire /persistence.conf contenant « / union » (Debian/Kali/Clonezilla).`);
  return cmds;
}

// ---------------- 3) Linux installé complet (partition + chainload GRUB) ----------------
export interface PlanInstallLinux {
  etapes: string[];
  /** l'entrée GRUB qui enchaîne (chainload) le système installé, ajoutée au menu personnalisé de Ventoy */
  grubEntree: string;
  limites: string[];
  /** la partition visée (étiquette, taille) */
  partition: { label: string; tailleGo: number };
}

/**
 * Le plan d'une installation Linux COMPLÈTE sur une partition de la cible : l'installateur (mêmes recettes
 * autoinstall que Genèse) vise cette partition, et une entrée GRUB qui enchaîne ce système est ajoutée au menu
 * de Ventoy. Pur. LIMITE : viser une partition précise est le plus délicat ; automatisé d'abord pour les
 * distributions dont la recette existe (Ubuntu/Debian/RHEL), au cas par cas.
 */
export function planInstallLinux(s: SystemeCle): PlanInstallLinux {
  const base = s.fichier.replace(/\.[^.]+$/, '').replace(/[^\w.+-]/g, '_') || 'linux';
  const label = `ODIN-${base}`.slice(0, 16).toUpperCase();
  const tailleGo = Math.max(10, Math.round(s.installPartition?.tailleGo ?? 20));
  const auto = ['ubuntu', 'casper', 'debian', 'rhel', 'fedora-live'].includes(s.recipe.kind);
  // L'entrée GRUB (chainload) qui démarre le système installé depuis sa partition (étiquette ext).
  const grubEntree = [
    `menuentry "${s.nom} (installé)" --class linux {`,
    `  search --no-floppy --label --set=root ${label}`,
    '  configfile /boot/grub/grub.cfg',
    '}',
  ].join('\n');
  const etapes = [
    `Je crée une partition « ${label} » de ${tailleGo} Go pour ${s.nom}.`,
    auto
      ? `L'installateur de ${s.nom} vise cette partition (recette automatique de Genèse : ${s.recipe.kind}).`
      : `${s.nom} n'a pas encore de recette automatique : l'installation vers cette partition se fait au cas par cas.`,
    'J\'ajoute une entrée au menu qui enchaîne (chainload) ce système installé.',
  ];
  const limites = [
    'Une installation visant une partition précise est la plus délicate : automatisée d\'abord pour Ubuntu/Debian/RHEL.',
    ...(auto ? [] : [`${s.nom} : pas de recette automatique — à faire au cas par cas, avec ton aide.`]),
  ];
  return { etapes, grubEntree, limites, partition: { label, tailleGo } };
}

// ---------------- Entrées de menu des disques installés (auto) ----------------
/** Une entrée menu_class pour ventoy.json (icône d'un fichier au menu). */
export interface EntreeMenuClasse { key: string; class: string }

/**
 * Les entrées menu_class SUPPLÉMENTAIRES pour les disques produits par les systèmes installés (Windows To Go,
 * copies de VM), posés dans /vdisk : Ventoy les démarre, et ces entrées leur donnent la bonne icône. Appelé par
 * buildVentoyJson (cle-boot.ts), concaténé au menu_class existant. Pur. Vide si aucun système installé/VM
 * (ventoy.json inchangé pour les cas actuels).
 */
export function entreesVdiskAuto(systemes: SystemeCle[]): EntreeMenuClasse[] {
  const out: EntreeMenuClasse[] = [];
  for (const s of systemes) {
    const choix = s.choix ?? 'iso';
    // Famille insensible à la casse ('Windows' serveur, 'windows' page) : un Windows « installé » = Windows To Go.
    if (choix === 'installe' && (s.winToGo || String(s.famille).toLowerCase() === 'windows')) {
      const base = (s.nom || s.fichier).replace(/\.[^.]+$/, '').replace(/[^\w.+-]/g, '_');
      out.push({ key: `${base}-wintogo.vhdx`, class: 'windows' });
    } else if (choix === 'vm' && s.vmSource) {
      const base = s.vmSource.nom.replace(/[^\w.+-]/g, '_');
      out.push({ key: base, class: s.vmSource.famille === 'windows' ? 'windows' : 'vdisk' });
    }
  }
  return out;
}
