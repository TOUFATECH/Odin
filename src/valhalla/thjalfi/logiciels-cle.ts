// Genèse · clé USB et PC par le réseau — CHOISIR DES LOGICIELS PAR SYSTÈME, FILTRÉS PAR OS, puis les INSTALLER
// À LA FIN. Tout est pur ici : aucune écriture disque, aucune install réelle. On RÉUTILISE scripts.ts (LogicielCle,
// apresWindowsCle, scriptsLinuxCle) et recipes.ts (silentArgs) ; ce fichier ne fait que le TRI :
//   - à quel OS va un système choisi (Windows, Windows Server, Ubuntu/Debian, Ubuntu Server, autres Linux) ;
//   - quels logiciels DÉJÀ TÉLÉCHARGÉS (bibliothèque d'Hermès / forge, et ce qu'Atalante a rangé) conviennent à cet OS ;
//   - lesquels savent s'installer EN SILENCIEUX de façon sûre, et lesquels sont seulement « copiés, à installer à la main ».
// On ne PROMET jamais une install silencieuse quand le mode n'est pas connu (garde-fou du propriétaire).

import { silentArgs } from './recipes.ts';
import type { LogicielCle } from './cle-types.ts';

/** L'OS visé par un système choisi (le seul qui compte pour trier les logiciels). */
export type OsCible = 'windows' | 'linux';
/** Le système choisi, avec son OS et s'il s'agit d'un serveur (Windows Server, Ubuntu Server…). */
export interface SystemeChoisi { os: OsCible; serveur: boolean }

/** La famille d'un fichier d'installateur, d'après son extension (sans rien exécuter). Pur. */
export type FamilleLog = 'windows' | 'linux-deb' | 'linux-rpm' | 'linux-flatpak' | 'linux-appimage' | 'macos' | 'android' | 'archive' | 'autre';
export function familleLogiciel(fichier: string): FamilleLog {
  const e = (/\.([a-z0-9]+)$/i.exec(fichier)?.[1] ?? '').toLowerCase();
  if (['exe', 'msi', 'msix', 'msixbundle', 'appx'].includes(e)) return 'windows';
  if (e === 'deb') return 'linux-deb';
  if (e === 'rpm') return 'linux-rpm';
  if (e === 'flatpakref' || e === 'flatpak') return 'linux-flatpak';
  if (e === 'appimage') return 'linux-appimage';
  if (['dmg', 'pkg'].includes(e)) return 'macos';
  if (e === 'apk') return 'android';
  if (e === 'zip') return 'archive';
  return 'autre';
}

/** L'OS visé par un fichier (Windows / Linux), ou rien si ce n'est ni l'un ni l'autre. Pur. */
export function osDuFichier(fichier: string): OsCible | undefined {
  const f = familleLogiciel(fichier);
  if (f === 'windows') return 'windows';
  if (f.startsWith('linux-')) return 'linux';
  return undefined;
}

/**
 * Quel OS vise un système choisi, et est-ce un serveur ? On lit d'abord la recette (recipe.os de recipes.ts), sinon
 * la famille/le nom (côté clé, la maquette range en « Windows » / « Linux »). « server » dans le nom = serveur. Pur.
 */
export function osDuSysteme(s: { recipe?: { os?: string }; famille?: string; nom?: string; fichier?: string }): SystemeChoisi {
  const txt = `${s.famille ?? ''} ${s.nom ?? ''} ${s.fichier ?? ''}`.toLowerCase();
  const os: OsCible = s.recipe?.os === 'windows' ? 'windows'
    : s.recipe?.os === 'linux' ? 'linux'
      : /windows|win\b/.test(txt) ? 'windows' : 'linux';
  const serveur = /server|serveur/.test(txt);
  return { os, serveur };
}

/** Les ids de sources dont le mode d'install silencieux Windows est CONNU et sûr (sinon on ne le promet pas). */
export const SILENCE_WINDOWS_CONNUE = new Set(['firefox', 'vscode', 'node', '7zip', 'notepadpp', 'git', 'obs', 'powertoys', 'vlc', 'keepassxc', 'putty', 'wireguard']);

/** Le mode d'installation d'un logiciel à la fin de l'installation de l'OS, et si le silencieux est VRAIMENT connu. */
export interface ModeInstall {
  os: OsCible | 'autre';
  /** on peut l'installer tout seul (silencieux) de façon sûre */
  silencieux: boolean;
  /** le mode silencieux est connu (pas deviné) : sinon on ne le promet pas */
  connu: boolean;
  /** les arguments silencieux Windows (voir silentArgs) */
  args: string;
  /** paquet MSI (installé par msiexec /qn) */
  msi: boolean;
  /** la façon de l'installer, en clair */
  methode: string;
  /** ce qu'il faut dire quand on ne peut pas promettre le silencieux */
  note?: string;
}
/**
 * Comment ce logiciel s'installe à la fin. Windows : MSI (toujours silencieux), ou .exe dont le mode est connu
 * (SILENCE_WINDOWS_CONNUE) ; un .exe inconnu est « copié, à installer à la main ». Linux : .deb/.rpm (dpkg/apt,
 * silencieux), Flatpak (silencieux) ; un .appimage ou une archive est seulement copié. Pur.
 */
export function modeInstall(id: string, fichier: string): ModeInstall {
  const fam = familleLogiciel(fichier), aCopier = (os: OsCible | 'autre', methode: string): ModeInstall =>
    ({ os, silencieux: false, connu: false, args: '', msi: false, methode, note: 'sera copié sur la clé, à installer à la main (mode silencieux non connu)' });
  switch (fam) {
    case 'windows': {
      const { args, msi } = silentArgs(id, fichier);
      if (msi) return { os: 'windows', silencieux: true, connu: true, args: '', msi: true, methode: 'MSI (msiexec /qn /norestart)' };
      if (SILENCE_WINDOWS_CONNUE.has(id)) return { os: 'windows', silencieux: true, connu: true, args, msi: false, methode: `install silencieuse (${args})` };
      return aCopier('windows', 'installateur Windows (.exe) sans mode silencieux connu');
    }
    case 'linux-deb': return { os: 'linux', silencieux: true, connu: true, args: '', msi: false, methode: 'paquet .deb (dpkg -i, puis apt -f install)' };
    case 'linux-rpm': return { os: 'linux', silencieux: true, connu: true, args: '', msi: false, methode: 'paquet .rpm (rpm/dnf)' };
    case 'linux-flatpak': return { os: 'linux', silencieux: true, connu: true, args: '', msi: false, methode: 'Flatpak (flatpak install -y)' };
    case 'linux-appimage': return aCopier('linux', 'AppImage (se lance tel quel, pas d\'installation)');
    case 'macos': return aCopier('autre', 'logiciel macOS (.dmg/.pkg) : pas pour une clé Windows ou Linux');
    case 'android': return aCopier('autre', 'application Android (.apk)');
    case 'archive': return aCopier('autre', 'archive (.zip) : à extraire à la main');
    default: return aCopier('autre', 'type d\'installateur non reconnu');
  }
}

/** Un logiciel compatible avec l'OS d'un système choisi ? (Windows → installateurs Windows ; Linux → paquets Linux.) Pur. */
export function compatible(fichier: string, cible: SystemeChoisi): boolean {
  return osDuFichier(fichier) === cible.os;
}

/** Une fiche de logiciel téléchargé (bibliothèque d'Hermès / forge, ou rangé par Atalante). */
export interface FicheLog { id?: string; source?: string; nom?: string; fichier?: string; chemin?: string; version?: string }
/** Un logiciel proposé pour un système : filtré par OS, avec le signalement « silencieux » ou « à la main ». */
export interface LogicielDispo {
  id: string; nom: string; fichier: string; chemin?: string; version?: string;
  famille: FamilleLog; os: OsCible | 'autre';
  silencieux: boolean; methode: string; note?: string;
}

/** Le nom de fichier d'une fiche (champ `fichier`, sinon le dernier segment de `chemin`). Pur. */
function fichierDe(f: FicheLog): string {
  if (f.fichier) return f.fichier;
  const c = (f.chemin ?? '').replace(/\\/g, '/');
  return c.slice(c.lastIndexOf('/') + 1);
}

/**
 * Les logiciels DISPONIBLES pour un système, pris dans ce qui est DÉJÀ TÉLÉCHARGÉ, filtrés par OS. Chacun est marqué
 * « silencieux » (installé tout seul à la fin) ou signalé « à installer à la main » quand le mode n'est pas connu. Pur.
 */
export function logicielsPourSysteme(fiches: FicheLog[], cible: SystemeChoisi): LogicielDispo[] {
  const out: LogicielDispo[] = [];
  for (const f of fiches) {
    const fichier = fichierDe(f); if (!fichier) continue;
    if (!compatible(fichier, cible)) continue;
    const id = f.source ?? f.id ?? fichier, m = modeInstall(id, fichier);
    out.push({ id, nom: f.nom ?? fichier, fichier, ...(f.chemin ? { chemin: f.chemin } : {}), ...(f.version ? { version: f.version } : {}),
      famille: familleLogiciel(fichier), os: m.os, silencieux: m.silencieux && m.connu, methode: m.methode, ...(m.note ? { note: m.note } : {}) });
  }
  return out;
}

/**
 * L'OS auquel un logiciel est installé TOUT SEUL (silencieux et connu) à la fin, ou `undefined` s'il est seulement
 * copié (à installer à la main). Sert à scripts.ts : Windows ne lance que ses installateurs Windows sûrs, Linux ses
 * paquets. Pur.
 */
export function installeAuto(id: string, fichier: string): OsCible | undefined {
  const m = modeInstall(id, fichier);
  return m.silencieux && m.connu && (m.os === 'windows' || m.os === 'linux') ? m.os : undefined;
}

/** La conversion d'un choix de logiciels vers ce que scripts.ts consomme (clé USB). Pur. */
export interface PourScripts {
  /** les logiciels Windows installés en silencieux à la fin (apresWindowsCle) */
  windows: LogicielCle[];
  /** les .deb installés par les late-commands Linux (scriptsLinuxCle) */
  debs: string[];
  /** les fichiers seulement copiés (à installer à la main), par OS */
  copieWindows: string[];
  copieLinux: string[];
}
export function versScripts(choisis: Array<{ id?: string; source?: string; fichier: string }>): PourScripts {
  const windows: LogicielCle[] = [], debs: string[] = [], copieWindows: string[] = [], copieLinux: string[] = [];
  for (const c of choisis) {
    const id = c.source ?? c.id ?? c.fichier, m = modeInstall(id, c.fichier), auto = installeAuto(id, c.fichier);
    if (auto === 'windows') windows.push({ id, fichier: c.fichier, args: m.args, msi: m.msi });
    else if (auto === 'linux' && familleLogiciel(c.fichier) === 'linux-deb') debs.push(c.fichier);
    else if (m.os === 'windows') copieWindows.push(c.fichier);
    else if (m.os === 'linux') copieLinux.push(c.fichier);
  }
  return { windows, debs, copieWindows, copieLinux };
}
