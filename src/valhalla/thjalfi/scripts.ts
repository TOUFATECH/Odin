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
  // Les options de l'étape « Options Windows » (lot C3). Absentes : le fichier de réponses reste celui de Genèse.
  /** compte local, sans compte en ligne (vrai) ; faux : Windows demande son compte en ligne */
  compteLocal?: boolean;
  /** le nom du compte local ; son mot de passe n'est JAMAIS écrit : il est demandé à la première ouverture de session */
  nomCompte?: string;
  /** passer les écrans de confidentialité (diagnostic, publicité, localisation), tout au plus discret */
  sansViePrivee?: boolean;
  /** langue, clavier et fuseau repris d'Odin (vrai) ; faux : Windows les demande */
  langueOdin?: boolean;
  /** le disque du PC est choisi au moment d'installer : aucun disque n'est effacé tout seul */
  disqueAuChoix?: boolean;
}

/** Un nom de compte Windows acceptable (1 à 20 caractères, sans " / \ [ ] : ; | = , + * ? < > @, pas de point final). Pur. */
export function nomCompteValide(nom: string): boolean {
  const n = String(nom ?? '').trim();
  // En plus des caractères refusés par Windows : % (cmd remplacerait %NOM% dans « net user »), les caractères invisibles
  // ou de sens d'écriture (un nom qui se lit autrement qu'il s'écrit), et ceux qu'un fichier XML ne peut pas porter.
  return n.length >= 1 && n.length <= 20 && !/["/\\[\]:;|=,+*?<>@%\p{Cc}\p{Cf}\p{Cs}\p{Co}￾￿]/u.test(n) && !/\.$/.test(n);
}

/** Les options Windows appliquées à un autounattend.xml de Genèse (compte, confidentialité, langue, disque). Pur. */
export function appliquerOptionsWindows(xml: string, opt: OptionsWindows): string {
  let x = xml;
  if (opt.disqueAuChoix) {
    // Aucun disque n'est effacé tout seul : sans DiskConfiguration ni InstallTo, l'installation demande le disque.
    x = x.replace(/<DiskConfiguration>[\s\S]*?<\/DiskConfiguration>/, '').replace(/<InstallTo>[\s\S]*?<\/InstallTo>/, '');
  }
  if (opt.compteLocal === false) {
    // Le compte est demandé par Windows lui-même : ni compte local créé, ni ouverture de session automatique.
    x = x.replace(/<UserAccounts>[\s\S]*?<\/UserAccounts>/, '').replace(/<AutoLogon>[\s\S]*?<\/AutoLogon>/, '')
      .replace(/<HideOnlineAccountScreens>true<\/HideOnlineAccountScreens>/, '<HideOnlineAccountScreens>false</HideOnlineAccountScreens>');
  } else if (opt.compteLocal === true) {
    const nom = nomCompteValide(opt.nomCompte ?? '') ? String(opt.nomCompte).trim() : 'Odin';
    const xn = nom.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // Le mot de passe n'est jamais écrit sur la clé : le compte est créé sans, ouvre la première session tout seul (pour
    // les logiciels), puis Windows oblige à en choisir un (net user … /logonpasswordchg:yes).
    x = x.replace(/<UserAccounts>[\s\S]*?<\/UserAccounts>/, `<UserAccounts><LocalAccounts><LocalAccount wcm:action="add"><Name>${xn}</Name><Group>Administrators</Group></LocalAccount></LocalAccounts></UserAccounts>`)
      .replace(/<AutoLogon>[\s\S]*?<\/AutoLogon>/, `<AutoLogon><Enabled>true</Enabled><LogonCount>1</LogonCount><Username>${xn}</Username></AutoLogon>`)
      .replace(/(<\/FirstLogonCommands>)/, `<SynchronousCommand wcm:action="add"><Order>2</Order><CommandLine>net user "${xn}" /logonpasswordchg:yes</CommandLine><Description>Odin : mot de passe choisi à la prochaine ouverture de session</Description></SynchronousCommand>$1`);
  }
  if (opt.sansViePrivee === false) x = x.replace(/<ProtectYourPC>\d<\/ProtectYourPC>/, '');
  else if (opt.sansViePrivee === true) x = x.replace(/<ProtectYourPC>\d<\/ProtectYourPC>/, '<ProtectYourPC>3</ProtectYourPC>');
  if (opt.langueOdin === false) {
    x = x.replace(/<component name="Microsoft-Windows-International-Core-WinPE"[\s\S]*?<\/component>/, '')
      .replace(/<component name="Microsoft-Windows-International-Core"[\s\S]*?<\/component>/, '')
      .replace(/<TimeZone>[\s\S]*?<\/TimeZone>/, '');
  }
  return x;
}

// ---------------- Windows ----------------
/** Les clés de registre que WinPE pose pour sauter les exigences matérielles de Windows 11. */
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
  const xml = appliquerOptionsWindows(lancementLocal(unattend(a, fw)), opt);
  return opt.retirerExigences ? injecterSautExigences(xml) : xml;
}
/**
 * La clé est HORS LIGNE : à la première ouverture de session, le script de fin est pris sur place (\odin\apres.ps1, posé
 * dans le système installé ou sur la clé), jamais téléchargé. Le fichier de réponses du démarrage réseau, lui, le
 * télécharge depuis Odin et l'exécute (iex) : sur une clé, n'importe quelle machine qui répondrait au nom d'Odin sur le
 * réseau ferait alors tourner son code, en administrateur, sur le PC neuf. Pur.
 */
export function lancementLocal(xml: string): string {
  const cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($d in Get-PSDrive -PSProvider FileSystem) { $p = Join-Path $d.Root \'odin\\apres.ps1\'; if (Test-Path -LiteralPath $p) { & $p; break } }"';
  const x = cmd.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return xml.replace(/<CommandLine>[^<]*DownloadString[^<]*<\/CommandLine>/g, () => `<CommandLine>${x}</CommandLine>`);
}

/**
 * Le script lancé à la première ouverture de session Windows, pour la clé : les logiciels sont installés
 * DEPUIS LA CLÉ (hors ligne), en silencieux (silentArgs), puis effacés si voulu ; à la fin, une page locale
 * plein écran (Odin animé) se ferme toute seule. Pur.
 * @param chemin le chemin des logiciels sur la clé, vu depuis Windows (ex. D:\logiciels\windows)
 */
export function apresWindowsCle(logiciels: LogicielCle[], opt: OptionsWindows, chemin?: string): string {
  // Sans chemin donné : la clé est cherchée parmi les lecteurs (celui qui porte \logiciels\windows). « %ODIN_CLE% »
  // ne voulait rien dire en PowerShell (c'est une écriture de cmd) : le chemin restait littéral, rien ne s'installait.
  const L = ['$ErrorActionPreference = "Continue"',
    chemin !== undefined ? `$src = "${String(chemin).replace(/[`"$]/g, '')}"`
      : '$src = $null; foreach ($d in Get-PSDrive -PSProvider FileSystem) { $t = Join-Path $d.Root \'logiciels\\windows\'; if (Test-Path -LiteralPath $t) { $src = $t; break } }',
    '# Odin : installation hors ligne des logiciels copiés sur la clé.'];
  if (chemin !== undefined) chemin = String(chemin).replace(/[`"$]/g, '');
  for (const s of logiciels) {
    // Le nom de fichier est assaini (liste blanche) AVANT d'entrer dans une chaîne PowerShell : sinon un nom comme
    // « app$(commande).exe » (sous-expression PowerShell dans une chaîne à guillemets doubles) s'exécuterait à
    // l'ouverture de session. Même garde que recipes.ts windowsAfter.
    const nomSur = s.fichier.replace(/[^\w.+-]/g, '_');
    const f = chemin !== undefined ? `${chemin}\\${nomSur}` : `$src\\${nomSur}`;
    const { args, msi } = s.msi ? { args: '', msi: true } : silentArgs(s.id, s.fichier);
    L.push(msi
      ? `try { Start-Process msiexec.exe -ArgumentList '/i', "\`"${f}\`"", '/qn', '/norestart' -Wait } catch {}`
      : `try { Start-Process "${f}" -ArgumentList '${(s.args || args).replace(/'/g, "''")}' -Wait } catch {}`);
  }
  // Effacer les installeurs : seulement une copie posée sur le disque installé, JAMAIS ceux de la clé elle-même.
  if (opt.effacerApres) L.push('try { if ($src -and $env:SystemDrive -and $src.StartsWith($env:SystemDrive, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -Recurse -Force -LiteralPath $src -ErrorAction SilentlyContinue } } catch {}');
  L.push('# Fenêtre de fin (Odin animé) : la page locale /ecran-odin/fin.html se ferme d\'elle-même.');
  return `${L.join('\r\n')}\r\n`;
}

// ---------------- Linux ----------------
/** Les scripts Linux de la clé : user-data (+ meta-data) pour Ubuntu, preseed pour Debian, kickstart pour RHEL.
 *  On réutilise les recettes de Genèse ; les paquets .deb copiés sur la clé sont ajoutés en late-commands. Pur. */
export function scriptsLinuxCle(a: Answer, famille: 'ubuntu' | 'debian' | 'rhel', token: string, debsCle: string[] = []): Record<string, string> {
  // Un nom de paquet entre tel quel dans une commande sh et dans le YAML : seuls les noms sûrs (lettres, chiffres, . _ + -)
  // y entrent ; un nom comme « x"; reboot; ".deb » ou avec un retour à la ligne n'est pas lancé (il reste copié sur la clé).
  const debs = (debsCle ?? []).filter((d) => /^[\w.+-]{1,200}\.deb$/.test(String(d ?? '')) && !String(d).startsWith('-'));
  if (famille === 'ubuntu') {
    let ud = ubuntuUserData(a);
    if (debs.length) {
      // Installer les .deb copiés sur la clé après l'installation de base (montée en /cdrom par l'installateur).
      const cmd = debs.map((d) => `    - curtin in-target -- sh -c "dpkg -i /cdrom/logiciels/linux/${d} || apt-get -y -f install"`).join('\n');
      ud = ud.replace(/( {2}shutdown: reboot)/, (_m, fin: string) => `${cmd}\n${fin}`);
    }
    return { 'user-data': ud, 'meta-data': ubuntuMetaData(token) };
  }
  if (famille === 'debian') {
    let ps = debianPreseed(a);
    if (debs.length) ps = ps.replace(/(d-i preseed\/late_command string )/, (_m, debut: string) => `${debut}${debs.map((d) => `cp /cdrom/logiciels/linux/${d} /target/tmp/ && in-target dpkg -i /tmp/${d} || true; `).join('')}`);
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

/**
 * Le texte d'un script ramené à ce qu'il fait vraiment, pour le lire : Unicode replié (NFKC), caractères invisibles
 * retirés, fins de ligne unifiées, lignes coupées recollées (\ en sh, ` en PowerShell, ^ en cmd), échappements
 * retirés (`F`ormat, f^ormat), morceaux de texte recollés ('Clear'+'-Disk', "rm" "-rf"), tout en minuscules. Pur.
 */
export function texteLisible(contenu: string): string {
  return String(contenu ?? '').normalize('NFKC').replace(/[\p{Cf}]+/gu, '').replace(/\r\n?/g, '\n')
    .replace(/[\\`^]\n/g, ' ')
    .replace(/`(?=[^\n])/g, '').replace(/\^(?=[^\n])/g, '')
    .replace(/(['"])\s*\+\s*(['"])/g, '').replace(/(['"])(['"])/g, '')
    .replace(/['"]/g, '').toLowerCase();
}
/** Un motif de danger : une expression lue sur texteLisible, ou une règle sur tout le texte. */
type Motif = RegExp | ((t: string) => boolean);
/** Télécharger quelque chose (outil ou commande de téléchargement). */
const TELECHARGE = /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|downloadfile|downloaddata|net\.webclient|start-bitstransfer|bitsadmin)\b/;
/** Lancer un fichier (programme, installeur, script). */
const LANCE = /\b(?:start-process|saps|msiexec|chmod\s+\+x|dpkg\s+-i|rpm\s+-i|cmd(?:\.exe)?\s+\/c|wscript|cscript)\b|(?:^|[\s;&|(])\.\/\S|(?:^|[\s;|(])&\s*[$.\\a-z]|\b(?:ba|z|da)?sh\s+\S+\.sh\b/m;
/** Les familles de commandes refusées dans tes scripts, avec ce qu'on dit (lues sur texteLisible). Bornes partout
 *  ([^\n]{0,N}) : aucun motif ne peut ralentir Odin, même sur 64 Ko écrits exprès. */
const DANGERS: Array<{ raison: string; motifs: Motif[] }> = [
  { raison: 'Ce script contient une commande qui peut effacer un disque entier.', motifs: [
    /\brm\b[^\n;|&]{0,80}\s(?:\/|\/\*|~|\$home|\$\{home\}|--no-preserve-root)(?=\s|$|;|&|\|)/m,
    /\b(?:mkfs|wipefs|blkdiscard|mkswap)\b/, /\bshred\b[^\n]{0,80}\/dev\//, /\bdd\b[^\n]{0,120}\bof=\/dev\//, />\s*\/dev\/(?:sd|nvme|hd|vd|mmcblk|disk)/,
    /\b(?:sgdisk|gdisk|sfdisk|fdisk|parted|cfdisk)\b/,
    /\b(?:clear-disk|format-volume|remove-partition|initialize-disk|reset-physicaldisk|set-disk|remove-physicaldisk)\b/,
    /\bdiskpart\b/, /\bformat(?:\.com)?\s+[a-z]:/, /\bcipher(?:\.exe)?\s+\/w/, /\bvssadmin\b[^\n]{0,40}\bdelete\b/, /\bbcdedit\b[^\n]{0,40}\/delete/,
    /\bremove-item\b[^\n]{0,120}(?:\s[a-z]:\\?(?:\*|\s|$)|\$env:systemdrive\\?\*?(?:\s|$))/m, /\b(?:rd|rmdir|del|erase)\s+\/[sq]\b[^\n]{0,40}\s[a-z]:\\?\*?(?:\s|$)/m,
    /:\(\)\s*\{[^\n]{0,40}\};\s*:/,
  ] },
  { raison: 'Ce script télécharge puis lance quelque chose venu d\'Internet. Ajoute plutôt le logiciel à Odin : il passe par l\'antivirus et va sur la clé.', motifs: [
    /\b(?:curl|wget|fetch)\b[^\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|k|da|fi)?sh\b/, /\b(?:ba|z|k|da)?sh\b[^\n]{0,20}\$\([^\n]{0,20}\b(?:curl|wget)\b/, /<\(\s*(?:curl|wget)\b/,
    /\bcertutil\b[^\n]{0,60}-urlcache/, /\b(?:mshta|regsvr32|rundll32)\b[^\n]{0,200}(?:https?:|\\\\)/,
    (t) => TELECHARGE.test(t) && (LANCE.test(t) || /\b(?:iex|invoke-expression)\b|\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/.test(t)),
  ] },
  { raison: 'Ce script coupe l\'antivirus ou le pare-feu.', motifs: [
    /\bset-mppreference\b[^\n]{0,200}\s-disable/, /\badd-mppreference\b[^\n]{0,80}\bexclusion/, /\bdisableantispyware\b|\bdisablerealtimemonitoring\b|\btamperprotection\b/,
    /\bsc(?:\.exe)?\s+(?:stop|config|delete)\s+(?:windefend|mpssvc|wscsvc|sense|wdnissvc)\b/, /\b(?:stop|set)-service\b[^\n]{0,60}\b(?:windefend|mpssvc|wscsvc)\b/,
    /\bnetsh\b[^\n]{0,40}firewall\b[^\n]{0,80}\b(?:off|disable)\b/, /\bset-netfirewallprofile\b[^\n]{0,80}-enabled\s+(?:false|0|\$false)/,
    /\bufw\s+(?:--force\s+)?disable\b/, /\bsystemctl\s+(?:stop|disable|mask)\s+[^\n]{0,40}\b(?:ufw|firewalld|nftables|apparmor|clamav[\w-]*)\b/,
    /\biptables\s+(?:-f|--flush)\b/, /\bnft\s+flush\s+ruleset\b/, /\bsetenforce\s+0\b/,
  ] },
  { raison: 'Ce script ajoute un compte administrateur (ou le cache).', motifs: [
    /\bnet1?(?:\.exe)?\s+localgroup\s+[^\n]{0,60}\/add\b/, /\badd-localgroupmember\b/, /s-1-5-32-544/, /\bspecialaccounts\\userlist\b/,
    /\buser(?:add|mod)\b[^\n]{0,80}\s-(?:o\b|u\s*0\b)/, /\buser(?:add|mod)\b[^\n]{0,80}\s-a?g\s*(?:sudo|wheel|admin|root)\b/,
    /\badduser\b[^\n]{0,60}\b(?:sudo|wheel|admin|root)\b/, /\bgpasswd\b[^\n]{0,30}-a\b[^\n]{0,40}\b(?:sudo|wheel|admin)\b/, /(?:>>?|\btee\b[^\n]{0,20})\s*\/etc\/(?:sudoers|passwd|shadow|group)\b/,
  ] },
  { raison: 'Ce script cache ce qu\'il fait (texte codé, commande assemblée ou cachée dans une variable).', motifs: [
    /\s[-/]enc(?:o|od|ode|oded|odedc\w*)?\b/, /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,120}\s[-/]e(?:c|n)?\s+[a-z0-9+/=]{16,}/,
    /\bfrombase64string\b|\bb64decode\b|\batob\s*\(|\bbase64\s+(?:-d|--decode|-di)\b|\bcertutil\b[^\n]{0,30}-decode|\bopenssl\s+(?:enc|base64)\b[^\n]{0,40}\s-d\b|\bfromhex\b|\bunhexlify\b/,
    /(?:\\x[0-9a-f]{2}){8}/, /(?:\\[0-7]{3}){6}/, /\[scriptblock\]\s*::\s*create\b/, /\.invokecommand\b|\.invokescript\b/,/\bchr\s*\(\s*\d+\s*\)\s*[+.]\s*chr\s*\(/,
    /\b(?:iex|invoke-expression)\b/, /\beval\b/, /\b(?:set-alias|new-alias|sal|nal)\s/, /(?:^|[;&|]\s*)alias\s+\w/m,
    /\[char\]\s*\(?\s*\d+[^\n]{0,20}\[char\]\s*\(?\s*\d+/, /\[char\[\]\]/, /-join\s*(?:$|\)|\|)/m, /\$env:comspec\[/,
    /(?:^|;|&&|\|\|)\s*\$\{?[a-z_]\w*\}?\s+(?![+\-*/.]?=)(?!\|)(?!-(?:eq|ne|gt|lt|ge|le|match|like|and|or|not|is|in|contains)\b)\S/m,
    /(?:^|&)\s*(?:call\s+)?%\w+%\s/m, /(?<![&\w])&\s*\((?!\s*\))/, /(?:^|[\s;|(])\.\s*\(/m,
  ] },
];
/**
 * Refuse un de tes scripts qui fait l'une des choses dangereuses connues : effacer un disque, télécharger puis lancer,
 * couper l'antivirus ou le pare-feu, ajouter un compte administrateur, ou cacher ce qu'il fait (base64, commande
 * assemblée, variable, alias). Lu sur texteLisible, donc les déguisements usuels (échappements, guillemets, Unicode,
 * lignes coupées) ne passent pas. LIMITE, dite franchement : c'est un filtre de texte, il ne peut pas tout deviner d'un
 * programme ; c'est un filet, pas une garantie. Le script n'est jamais lancé par Odin, seulement sur le PC installé,
 * et il est toujours montré avant d'être écrit. Pur.
 */
export function verifierScriptPerso(contenu: string): string | undefined {
  if (String(contenu ?? '').length > 64 * 1024) return 'Script trop long (64 Ko au plus).';
  const t = texteLisible(contenu);
  for (const d of DANGERS) if (d.motifs.some((m) => (typeof m === 'function' ? m(t) : m.test(t)))) return `${d.raison} Odin ne l'écrit pas sur la clé : relis-le.`;
  return undefined;
}

// ---------------- Tes scripts (ajoutés à la main, lancés à la fin, dans l'ordre) ----------------
/** Un script ajouté par la personne : gardé et montré, JAMAIS exécuté par Odin ; lancé seulement sur le PC installé. */
export interface ScriptPerso { nom: string; contenu: string }
/** Le dossier des scripts sur la clé (sous /odin), vu depuis l'installateur Linux (/cdrom) et depuis Windows. */
export const DOSSIER_SCRIPTS = 'odin/scripts';
/** Le chemin des scripts sur la clé vu depuis Windows (même convention que les logiciels, apresWindowsCle). */
// « %ODIN_CLE% » ne veut rien dire en PowerShell : le dossier scripts est pris à côté du script de fin ($PSScriptRoot,
// le dossier d'apres.ps1 : \odin sur la clé comme dans le système installé).
const CHEMIN_SCRIPTS_WINDOWS = '$PSScriptRoot\\scripts';
/** L'OS d'un script, d'après son extension : .ps1 / .cmd / .bat pour Windows, .sh pour Linux. Pur. */
export function osDuScript(nom: string): 'windows' | 'linux' | undefined {
  const e = (/\.([a-z0-9]+)$/i.exec(String(nom ?? ''))?.[1] ?? '').toLowerCase();
  return ['ps1', 'cmd', 'bat'].includes(e) ? 'windows' : e === 'sh' ? 'linux' : undefined;
}
/** Le nom sûr d'un script sur la clé : son rang (01, 02…) puis son nom assaini (liste blanche), l'extension gardée. Pur. */
export function nomScriptSur(nom: string, rang: number): string {
  const n = String(nom ?? '').split(/[\\/]/).pop() ?? '';
  const e = (/\.([a-z0-9]+)$/i.exec(n)?.[1] ?? '').toLowerCase();
  const base = n.replace(/\.[a-z0-9]+$/i, '').normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^\w.+-]+/g, '_').replace(/^[._]+/, '').slice(0, 48) || 'script';
  return `${String(Math.max(1, rang)).padStart(2, '0')}-${base}${e ? `.${e}` : ''}`;
}
/** Les scripts d'un OS, dans l'ordre, avec leur nom sûr sur la clé. Pur. */
export function scriptsPour(os: 'windows' | 'linux', scripts: ScriptPerso[]): Array<ScriptPerso & { fichier: string }> {
  return (scripts ?? []).filter((s) => s && osDuScript(s.nom) === os).map((s, i) => ({ ...s, fichier: nomScriptSur(s.nom, i + 1) }));
}
/** Les lignes PowerShell qui lancent tes scripts Windows, dans l'ordre, après les logiciels. Pur. */
export function lignesScriptsWindows(scripts: Array<{ fichier: string }>, chemin = CHEMIN_SCRIPTS_WINDOWS): string[] {
  if (!scripts.length) return [];
  return ['# Tes scripts, dans l\'ordre (copiés sur la clé, jamais lancés par Odin lui-même).', ...scripts.map((s) => (/\.ps1$/i.test(s.fichier)
    ? `try { Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "\`"${chemin}\\${s.fichier}\`"" -Wait } catch {}`
    : `try { Start-Process cmd.exe -ArgumentList '/c', "\`"${chemin}\\${s.fichier}\`"" -Wait } catch {}`))];
}
/** Ajoute tes scripts Linux à la fin d'une installation (user-data, preseed ou kickstart). Pur. */
export function ajouterScriptsLinux(fichiers: Record<string, string>, scripts: Array<{ fichier: string }>): Record<string, string> {
  if (!scripts.length) return fichiers;
  const out = { ...fichiers };
  if (out['user-data'] !== undefined) {
    const cmd = scripts.map((s) => `    - cp /cdrom/${DOSSIER_SCRIPTS}/${s.fichier} /target/tmp/${s.fichier} && curtin in-target -- sh /tmp/${s.fichier} || true`).join('\n');
    out['user-data'] = out['user-data'].replace(/( {2}shutdown: reboot)/, `    # Tes scripts, dans l'ordre\n${cmd}\n$1`);
  }
  if (out['preseed.cfg'] !== undefined) {
    out['preseed.cfg'] = out['preseed.cfg'].replace(/(d-i preseed\/late_command string .*)$/m, `$1; ${scripts.map((s) => `cp /cdrom/${DOSSIER_SCRIPTS}/${s.fichier} /target/tmp/ && in-target sh /tmp/${s.fichier} || true`).join('; ')}`);
  }
  if (out['ks.cfg'] !== undefined) {
    out['ks.cfg'] += `\n%post --nochroot\n# Tes scripts, dans l'ordre\n${scripts.map((s) => `cp /run/install/repo/${DOSSIER_SCRIPTS}/${s.fichier} /mnt/sysimage/tmp/ || true`).join('\n')}\n%end\n\n%post\n${scripts.map((s) => `sh /tmp/${s.fichier} || true`).join('\n')}\n%end\n`;
  }
  return out;
}

/** Le verdict sur un script ajouté : accepté, ou refusé avec la raison (jamais exécuté, seulement lu). */
export interface VerdictScript { nom: string; ok: boolean; raison?: string }
/**
 * Vérifie un script ajouté AVANT de l'accepter : extension connue, taille, texte lisible, commandes qui effacent un
 * disque (verifierScriptPerso), puis l'antivirus d'Odin (fonction `scan` donnée par l'appelant : rend une raison si
 * c'est dangereux). Le script n'est jamais exécuté ici. Pur (hors `scan`).
 */
export function analyserScript(nom: string, contenu: string, scan?: (nom: string, contenu: string) => string | undefined): VerdictScript {
  const n = String(nom ?? '');
  if (!osDuScript(n)) return { nom: n, ok: false, raison: 'Seuls les scripts .ps1, .cmd, .bat et .sh sont acceptés.' };
  if (typeof contenu !== 'string' || !contenu.trim()) return { nom: n, ok: false, raison: 'Script vide.' };
  if (/\u0000/.test(contenu)) return { nom: n, ok: false, raison: 'Ce fichier n\'est pas un texte : ce n\'est pas un script.' };
  const r = verifierScriptPerso(contenu);
  if (r) return { nom: n, ok: false, raison: r };
  const av = scan ? scan(n, contenu) : undefined;
  if (av) return { nom: n, ok: false, raison: av };
  return { nom: n, ok: true };
}

/** Tous les scripts d'un système, prêts à montrer AVANT écriture (nom de fichier → contenu). Pur. */
export function apercu(systeme: { famille: 'windows' | 'ubuntu' | 'debian' | 'rhel'; answer: Answer; fw?: 'uefi' | 'bios'; opt?: OptionsWindows; logiciels?: LogicielCle[]; token?: string; debsCle?: string[]; scripts?: ScriptPerso[] }): Record<string, string> {
  if (systeme.famille === 'windows') {
    const opt = systeme.opt ?? { retirerExigences: true, effacerApres: false };
    const perso = scriptsPour('windows', systeme.scripts ?? []);
    let apres = apresWindowsCle(systeme.logiciels ?? [], opt);
    // Tes scripts passent après les logiciels, juste avant la fenêtre de fin.
    if (perso.length) apres = apres.replace(/(# Fenêtre de fin)/, (_m, fin: string) => `${lignesScriptsWindows(perso).join('\r\n')}\r\n${fin}`);
    const out: Record<string, string> = { 'autounattend.xml': autounattendCle(systeme.answer, systeme.fw ?? 'uefi', opt), 'apres.ps1': apres };
    for (const s of perso) out[`scripts/${s.fichier}`] = s.contenu;
    return out;
  }
  const perso = scriptsPour('linux', systeme.scripts ?? []);
  const out = ajouterScriptsLinux(scriptsLinuxCle(systeme.answer, systeme.famille, systeme.token ?? 'cle', systeme.debsCle ?? []), perso);
  for (const s of perso) out[`scripts/${s.fichier}`] = s.contenu;
  return out;
}
