// Écho · la capsule de dictée sur un poste Windows. Satellites l'installe à distance (SSH de Windows ou WinRM) dans le
// profil de la personne (%USERPROFILE%\.odin-capsule, lisible par elle seule), la fait démarrer à l'ouverture de
// session (tâche planifiée ; sinon un raccourci dans le dossier Démarrage) et la capsule y veille sur Ctrl+Espace :
// une pression lance la dictée, le texte arrive là où se trouve le curseur. Le retrait arrête la veille, efface la
// tâche ou le raccourci, puis le dossier : rien ne reste.
//
// Ce fichier choisit aussi, pour chaque poste, le bon chemin : script sh (Linux, macOS) ou PowerShell (Windows).

import { runOnMachine, type Machine } from '../../machines/access.ts';
import { detecterSysteme, essais, executerPs, PS_PROTEGER, PS_PYTHON, PS_SORTIR, psTexte, type Lien, type Sortie, type Systeme } from '../../machines/windows.ts';
import type { ModCtx } from '../types.ts';
import { programmeCapsule, scriptEtat, scriptInstallation, scriptReglage, scriptRetrait } from './capsule.ts';

export const TACHE_CAPSULE = 'Odin - Echo (dictee)';
export const RACCOURCI_CAPSULE = 'Odin - Echo (dictee).lnk';
const b64 = (t: string) => Buffer.from(t, 'utf8').toString('base64');
const DEBUT = [
  '$ErrorActionPreference = \'Stop\'', '$ProgressPreference = \'SilentlyContinue\'', PS_SORTIR, PS_PYTHON, PS_PROTEGER,
  '$d = Join-Path $env:USERPROFILE \'.odin-capsule\'',
  `$tache = ${psTexte(TACHE_CAPSULE)}`,
  `$lnk = Join-Path (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs\\Startup') ${psTexte(RACCOURCI_CAPSULE)}`,
  '$env:PYTHONIOENCODING = \'utf-8\'', '$env:ODIN_JSON_ASCII = \'1\'',
  String.raw`function Arreter-Veille {
  $pf = Join-Path $d 'veille.pid'
  if (Test-Path -LiteralPath $pf) {
    $n = 0; if ([int]::TryParse(([IO.File]::ReadAllText($pf)).Trim(), [ref]$n)) { Get-Process -Id $n -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'python*' } | Stop-Process -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $pf -Force -ErrorAction SilentlyContinue
  }
}
function Lire-Python { $f = Join-Path $d 'python.txt'; if (Test-Path -LiteralPath $f) { return ([IO.File]::ReadAllText($f)).Trim() } else { return $null } }
function Demarrage {
  if (Get-ScheduledTask -TaskName $tache -ErrorAction SilentlyContinue) { return 'tâche planifiée' }
  if (Test-Path -LiteralPath $lnk) { return 'dossier Démarrage' }
  return 'aucun'
}`,
];

/**
 * Le script PowerShell d'installation : Python 3 trouvé (sinon refus clair), capsule et configuration écrites
 * (dossier protégé, le jeton n'est jamais affiché), démarrage à l'ouverture de session, veille lancée tout de suite
 * si la personne est connectée, puis l'état de la capsule en JSON. Pur.
 */
export function scriptInstallationWindows(c: { odin: string; jeton: string; poste: string; mode: string; empreinte: string }): string {
  // Le contrôle des valeurs et la configuration sont ceux du script Linux / macOS (même capsule, même fichier).
  const sh = scriptInstallation(c), conf = /\("capsule\.json", "([A-Za-z0-9+/=]+)"/.exec(sh)?.[1];
  if (!conf) throw new Error('configuration de la capsule introuvable');
  return [...DEBUT, String.raw`$py = Trouver-Python
if (-not $py) { Sortir @{ ok = $false; erreur = 'Python 3 absent sur ce poste : installe-le (python.org ou Microsoft Store) puis recommence' }; exit 3 }
$pyw = Python-Silencieux $py
Arreter-Veille
New-Item -ItemType Directory -Force -Path $d | Out-Null
Proteger $d`,
  `Ecrire-B64 (Join-Path $d 'capsule.py') '${b64(programmeCapsule())}'`,
  `Ecrire-B64 (Join-Path $d 'capsule.json') '${conf}'`,
  String.raw`[IO.File]::WriteAllText((Join-Path $d 'python.txt'), $py)
$arg = '"' + (Join-Path $d 'capsule.py') + '" veiller'
$nom = $env:USERNAME; if ($env:USERDOMAIN) { $nom = $env:USERDOMAIN + '\' + $env:USERNAME }
$demarrage = 'aucun'
try {
  $a = New-ScheduledTaskAction -Execute $pyw -Argument $arg -WorkingDirectory $d
  $t = New-ScheduledTaskTrigger -AtLogOn -User $nom
  $p = New-ScheduledTaskPrincipal -UserId $nom -LogonType Interactive -RunLevel Limited
  $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $tache -Action $a -Trigger $t -Principal $p -Settings $s -Description 'Odin : dictée Écho (Ctrl+Espace)' -Force | Out-Null
  Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
  $demarrage = 'tâche planifiée'
  try { Start-ScheduledTask -TaskName $tache } catch { }
} catch {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lnk) | Out-Null
  $w = New-Object -ComObject WScript.Shell
  $l = $w.CreateShortcut($lnk)
  $l.TargetPath = $pyw; $l.Arguments = $arg; $l.WorkingDirectory = $d; $l.WindowStyle = 7; $l.Description = 'Odin : dictée Écho (Ctrl+Espace)'
  $l.Save()
  $demarrage = 'dossier Démarrage'
}
$e = & $py (Join-Path $d 'capsule.py') etat 2>$null | Select-Object -Last 1
try { $o = $e | ConvertFrom-Json } catch { Sortir @{ ok = $false; erreur = 'la capsule ne répond pas après installation' }; exit 4 }
$o | Add-Member -NotePropertyName demarrage -NotePropertyValue $demarrage -Force
$o | Add-Member -NotePropertyName raccourci -NotePropertyValue 'Ctrl+Espace' -Force
Sortir $o`].join('\n');
}

/** L'état de la capsule d'un poste Windows (avec son démarrage et sa veille). Pur. */
export function scriptEtatWindows(): string {
  return [...DEBUT, String.raw`$py = Lire-Python
if (-not $py -or -not (Test-Path -LiteralPath (Join-Path $d 'capsule.py'))) { Sortir @{ ok = $false; erreur = 'pas de capsule sur ce poste' }; exit 0 }
$e = & $py (Join-Path $d 'capsule.py') etat 2>$null | Select-Object -Last 1
try { $o = $e | ConvertFrom-Json } catch { Sortir @{ ok = $false; erreur = 'la capsule ne répond pas (Python déplacé ?)' }; exit 0 }
$veille = $false; $pf = Join-Path $d 'veille.pid'
if (Test-Path -LiteralPath $pf) { $n = 0; if ([int]::TryParse(([IO.File]::ReadAllText($pf)).Trim(), [ref]$n)) { $veille = [bool](Get-Process -Id $n -ErrorAction SilentlyContinue) } }
$o | Add-Member -NotePropertyName demarrage -NotePropertyValue (Demarrage) -Force
$o | Add-Member -NotePropertyName veille -NotePropertyValue $veille -Force
Sortir $o`].join('\n');
}

/** Change la mise en forme par défaut (même contrôle que sous Linux). Pur. */
export function scriptReglageWindows(mode: string): string {
  scriptReglage(mode);
  return [...DEBUT, String.raw`$py = Lire-Python
if (-not $py) { Sortir @{ ok = $false; erreur = 'pas de capsule sur ce poste' }; exit 3 }`,
  `& $py (Join-Path $d 'capsule.py') regler --mode ${psTexte(mode)} 2>$null | Select-Object -Last 1`].join('\n');
}

/** Retrait complet : veille arrêtée, tâche planifiée et raccourci effacés, dossier effacé. Pur. */
export function scriptRetraitWindows(): string {
  return [...DEBUT, String.raw`Arreter-Veille
try { Unregister-ScheduledTask -TaskName $tache -Confirm:$false -ErrorAction Stop } catch { }
Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force }
$reste = @(); if (Test-Path -LiteralPath $d) { $reste += $d }; if (Test-Path -LiteralPath $lnk) { $reste += $lnk }; if (Get-ScheduledTask -TaskName $tache -ErrorAction SilentlyContinue) { $reste += $tache }
Sortir @{ ok = ($reste.Count -eq 0); reste = $reste }`].join('\n');
}

// ---------------- Le bon chemin pour chaque poste ----------------

const s = (v: unknown) => String(v ?? '');
/** Comment joindre ce poste et quel est son système (donnés, retenus, devinés d'après l'inventaire, ou demandés au poste). */
export async function systemePoste(ctx: ModCtx, m: Machine, i: Record<string, unknown> = {}): Promise<{ systeme: Systeme; lien: Lien }> {
  const memo = (ctx.settings.systemes as Record<string, { systeme: Systeme; lien: Lien }> | undefined) ?? {};
  const lien: Lien = s(i.acces) === 'winrm' ? 'winrm' : s(i.acces) === 'ssh' ? 'ssh' : memo[m.id]?.lien ?? 'ssh';
  const voulu = s(i.systeme).toLowerCase();
  let systeme: Systeme | undefined = lien === 'winrm' || voulu === 'windows' ? 'windows' : /linux|mac/.test(voulu) ? 'posix' : memo[m.id]?.systeme;
  const os = s((ctx.settings.inventory as Record<string, { os?: string }> | undefined)?.[m.id]?.os);
  if (!systeme && os) systeme = /windows/i.test(os) ? 'windows' : 'posix';
  systeme ??= await detecterSysteme(ctx.home, m);
  if (memo[m.id]?.systeme !== systeme || memo[m.id]?.lien !== lien) ctx.saveSettings({ systemes: { ...memo, [m.id]: { systeme, lien } } });
  return { systeme, lien };
}

/** Lance l'un des scripts de la capsule sur un poste, dans la langue de son système. */
export async function surPoste(ctx: ModCtx, m: Machine, quoi: { posix: string; windows: () => string }, i: Record<string, unknown> = {}, timeoutMs = 90_000): Promise<Sortie & { systeme: Systeme }> {
  const { systeme, lien } = await systemePoste(ctx, m, i);
  if (systeme === 'windows') return { ...(await executerPs(ctx.home, ctx.run, m, quoi.windows(), { lien, timeoutMs })), systeme };
  const r = essais.commande ? await essais.commande(m, quoi.posix) : await runOnMachine(ctx.home, m, quoi.posix, { timeoutMs });
  return { ...r, systeme };
}

/** Les quatre gestes de Satellites sur la capsule d'un poste, quel que soit son système. */
export const gestesCapsule = {
  installer: (c: Parameters<typeof scriptInstallation>[0]) => ({ posix: scriptInstallation(c), windows: () => scriptInstallationWindows(c) }),
  etat: () => ({ posix: scriptEtat(), windows: scriptEtatWindows }),
  regler: (mode: string) => ({ posix: scriptReglage(mode), windows: () => scriptReglageWindows(mode) }),
  retirer: () => ({ posix: scriptRetrait(), windows: scriptRetraitWindows }),
};
/** Le conseil donné après l'installation, selon le système. Pur. */
export function apresInstallation(systeme: Systeme, e: Record<string, unknown> | undefined): string {
  if (systeme === 'windows') return e?.demarrage === 'tâche planifiée' ? 'Ctrl+Espace lance la dictée (veille démarrée à chaque ouverture de session par une tâche planifiée).' : 'Ctrl+Espace lance la dictée dès la prochaine ouverture de session (raccourci dans le dossier Démarrage).';
  return 'Crée sur ce poste un raccourci clavier qui lance : python3 ~/.odin-capsule/capsule.py dicter';
}
