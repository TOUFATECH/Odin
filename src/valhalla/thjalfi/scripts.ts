// Genèse · clé USB — les SCRIPTS d'installation posés sur la clé, un par système, créés tout seuls, en
// RÉUTILISANT les recettes de Genèse (recipes.ts). Rien n'est recopié : on appelle les mêmes fonctions que le
// démarrage réseau, et on ajoute ce qui est propre à la clé (installation HORS LIGNE : les logiciels sont
// copiés dans un dossier de la clé, pas téléchargés depuis Odin).
//
//   - Windows : autounattend.xml via unattend() — avec, en plus, le retrait des exigences de Microsoft (TPM
//     2.0, démarrage sécurisé, 4 Go) et un compte local sans compte Microsoft ; les logiciels (copiés sur la
//     clé) s'installent en silencieux à la fin (silentArgs), puis sont effacés du disque installé si voulu.
//   - Ubuntu / Debian : user-data (ubuntuUserData) / preseed (debianPreseed) + late-commands qui installent
//     les paquets .deb copiés sur la clé, ou des paquets du dépôt.
// Tout est MONTRÉ avant d'être écrit (fonction apercu). Pur : aucune écriture ici.

import { ubuntuUserData, ubuntuMetaData, debianPreseed, kickstart, unattend, silentArgs, type Answer } from './recipes.ts';

/** Un logiciel copié sur la clé (dans /logiciels/windows ou /logiciels/linux) et installé à la fin. */
export interface LogicielCle { id: string; fichier: string; args: string; msi: boolean }
export interface OptionsWindows {
  /** retirer les exigences de Microsoft (TPM 2.0, démarrage sécurisé, 4 Go de mémoire) : coché par défaut */
  retirerExigences: boolean;
  /** effacer les installeurs du disque installé une fois les logiciels posés */
  effacerApres: boolean;
}

// ---------------- Windows ----------------
/** Les clés de registre que WinPE pose pour sauter les exigences de Windows 11 (même effet que Rufus). */
const LAB_CONFIG = ['BypassTPMCheck', 'BypassSecureBootCheck', 'BypassRAMCheck', 'BypassStorageCheck', 'BypassCPUCheck'];

/** Ajoute à un autounattend.xml, dans la passe windowsPE, les commandes qui retirent les exigences de Microsoft. Pur. */
export function injecterSautExigences(xml: string): string {
  const cmds = LAB_CONFIG.map((v, i) =>
    `<RunSynchronousCommand wcm:action="add"><Order>${i + 1}</Order><Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v ${v} /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>`).join('');
  const bloc = `<RunSynchronous>${cmds}</RunSynchronous>`;
  // On glisse le bloc juste après l'ouverture du composant Microsoft-Windows-Setup (passe windowsPE).
  return xml.replace(/(<component name="Microsoft-Windows-Setup"[^>]*>)/, `$1${bloc}`);
}

/** L'autounattend.xml de la clé : celui de Genèse, plus le saut des exigences Microsoft (si voulu). Pur. */
export function autounattendCle(a: Answer, fw: 'uefi' | 'bios', opt: OptionsWindows): string {
  const xml = unattend(a, fw);
  return opt.retirerExigences ? injecterSautExigences(xml) : xml;
}

/**
 * Le script lancé à la première ouverture de session Windows, pour la clé : les logiciels sont installés
 * DEPUIS LA CLÉ (hors ligne), en silencieux (silentArgs), puis effacés si voulu ; à la fin, une page locale
 * plein écran (Odin animé) se ferme toute seule. Pur.
 * @param chemin le chemin des logiciels sur la clé, vu depuis Windows (ex. D:\logiciels\windows)
 */
export function apresWindowsCle(logiciels: LogicielCle[], opt: OptionsWindows, chemin = '%ODIN_CLE%\\logiciels\\windows'): string {
  const L = ['$ErrorActionPreference = "Continue"', `$src = "${chemin}"`,
    '# Odin : installation hors ligne des logiciels copiés sur la clé.'];
  for (const s of logiciels) {
    // Le nom de fichier est assaini (liste blanche) AVANT d'entrer dans une chaîne PowerShell : sinon un nom comme
    // « app$(commande).exe » (sous-expression PowerShell dans une chaîne à guillemets doubles) s'exécuterait à
    // l'ouverture de session. Même garde que recipes.ts windowsAfter.
    const nomSur = s.fichier.replace(/[^\w.+-]/g, '_');
    const f = `${chemin}\\${nomSur}`;
    const { args, msi } = s.msi ? { args: '', msi: true } : silentArgs(s.id, s.fichier);
    L.push(msi
      ? `try { Start-Process msiexec.exe -ArgumentList '/i', "\`"${f}\`"", '/qn', '/norestart' -Wait } catch {}`
      : `try { Start-Process "${f}" -ArgumentList '${(s.args || args).replace(/'/g, "''")}' -Wait } catch {}`);
  }
  if (opt.effacerApres) L.push('try { Remove-Item -Recurse -Force "$src" -ErrorAction SilentlyContinue } catch {}');
  L.push('# Fenêtre de fin (Odin animé) : la page locale /ecran-odin/fin.html se ferme d\'elle-même.');
  return `${L.join('\r\n')}\r\n`;
}

// ---------------- Linux ----------------
/** Les scripts Linux de la clé : user-data (+ meta-data) pour Ubuntu, preseed pour Debian, kickstart pour RHEL.
 *  On réutilise les recettes de Genèse ; les paquets .deb copiés sur la clé sont ajoutés en late-commands. Pur. */
export function scriptsLinuxCle(a: Answer, famille: 'ubuntu' | 'debian' | 'rhel', token: string, debsCle: string[] = []): Record<string, string> {
  if (famille === 'ubuntu') {
    let ud = ubuntuUserData(a);
    if (debsCle.length) {
      // Installer les .deb copiés sur la clé après l'installation de base (montée en /cdrom par l'installateur).
      const cmd = debsCle.map((d) => `    - curtin in-target -- sh -c "dpkg -i /cdrom/logiciels/linux/${d} || apt-get -y -f install"`).join('\n');
      ud = ud.replace(/( {2}shutdown: reboot)/, `${cmd}\n$1`);
    }
    return { 'user-data': ud, 'meta-data': ubuntuMetaData(token) };
  }
  if (famille === 'debian') {
    let ps = debianPreseed(a);
    if (debsCle.length) ps = ps.replace(/(d-i preseed\/late_command string )/, `$1${debsCle.map((d) => `cp /cdrom/logiciels/linux/${d} /target/tmp/ && in-target dpkg -i /tmp/${d} || true; `).join('')}`);
    return { 'preseed.cfg': ps };
  }
  return { 'ks.cfg': kickstart(a) };
}

// ---------------- Script perso ----------------
/** Un modèle de script d'installation que la personne peut adapter (montré et vérifié avant d'être écrit). Pur. */
export function modeleScriptPerso(systeme: 'windows' | 'linux'): string {
  return systeme === 'windows'
    ? `# Odin · script perso (Windows), lancé à la fin de l'installation.\r\n# Adapte-le ; Odin te le remontre avant de l'écrire sur la clé.\r\n# Exemple : Write-Host "Bonjour depuis Odin"\r\n`
    : `#!/bin/sh\n# Odin · script perso (Linux), lancé à la fin de l'installation.\n# Adapte-le ; Odin te le remontre avant de l'écrire sur la clé.\n# Exemple : echo "Bonjour depuis Odin"\n`;
}

/** Refuse un script perso manifestement dangereux (on le MONTRE toujours, et on prévient). Pur. */
export function verifierScriptPerso(contenu: string): string | undefined {
  if (/\brm\s+-rf\s+\/(?:\s|$)|mkfs|dd\s+if=.*of=\/dev\/|:\(\)\s*\{.*\};:|format\s+[a-z]:/i.test(contenu)) return 'Ce script contient une commande qui peut effacer un disque entier. Odin ne l\'écrit pas tel quel : relis-le.';
  if (contenu.length > 64 * 1024) return 'Script trop long (64 Ko au plus).';
  return undefined;
}

/** Tous les scripts d'un système, prêts à montrer AVANT écriture (nom de fichier → contenu). Pur. */
export function apercu(systeme: { famille: 'windows' | 'ubuntu' | 'debian' | 'rhel'; answer: Answer; fw?: 'uefi' | 'bios'; opt?: OptionsWindows; logiciels?: LogicielCle[]; token?: string; debsCle?: string[] }): Record<string, string> {
  if (systeme.famille === 'windows') {
    const opt = systeme.opt ?? { retirerExigences: true, effacerApres: false };
    return {
      'autounattend.xml': autounattendCle(systeme.answer, systeme.fw ?? 'uefi', opt),
      'apres.ps1': apresWindowsCle(systeme.logiciels ?? [], opt),
    };
  }
  return scriptsLinuxCle(systeme.answer, systeme.famille, systeme.token ?? 'cle', systeme.debsCle ?? []);
}
