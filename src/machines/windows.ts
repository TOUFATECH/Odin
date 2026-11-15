// Satellites · les postes Windows du parc. Odin y lance un script PowerShell, par SSH (le serveur OpenSSH livré avec
// Windows) ou par WinRM (PowerShell à distance, lancé depuis le PowerShell de la machine d'Odin).
//
// Le script part toujours sur l'entrée standard, en UTF-8 : jamais sur la ligne de commande (pas de limite de taille,
// aucun jeton visible dans la liste des processus du poste). Par WinRM, le mot de passe du compte voyage lui aussi sur
// l'entrée (première ligne), jamais en argument.

import { runOnMachine, verifierAcces, type Machine } from './access.ts';

export type Lien = 'ssh' | 'winrm';
export type Systeme = 'posix' | 'windows';
export interface Sortie { code: number | null; out: string }
type Run = (cmd: string, args: string[], o?: { timeoutMs?: number; input?: string }) => Promise<{ code: number; out: string; err: string }>;

/** Un script PowerShell prêt pour -EncodedCommand (UTF-16LE puis base64). Pur. */
export const encoder = (ps: string) => Buffer.from(ps, 'utf16le').toString('base64');

/** Le petit lanceur : lit tout le script sur l'entrée (octets UTF-8) puis l'exécute. */
export const LANCEUR = '$ErrorActionPreference=\'Stop\';$i=[Console]::OpenStandardInput();$m=New-Object IO.MemoryStream;$i.CopyTo($m);$s=[Text.Encoding]::UTF8.GetString($m.ToArray());if($s.Length -gt 0 -and $s[0] -eq [char]0xFEFF){$s=$s.Substring(1)};& ([scriptblock]::Create($s))';
const OPTIONS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
/** La commande envoyée par SSH à un poste Windows (que son shell par défaut soit cmd ou PowerShell). Pur. */
export const commandeSsh = (script = LANCEUR) => `powershell ${OPTIONS.join(' ')} -EncodedCommand ${encoder(script)}`;

/** Le lanceur WinRM, exécuté sur la machine d'Odin : 1re ligne de l'entrée = mot de passe, le reste = le script. Pur. */
export function lanceurWinrm(m: Pick<Machine, 'host' | 'user' | 'port' | 'domain'>): string {
  verifierAcces(m.host, m.user, m.domain);
  const compte = `${m.domain ? `${m.domain}\\` : ''}${m.user}`.replace(/'/g, "''"), ssl = m.port === 5986;
  return [
    '$ErrorActionPreference=\'Stop\'',
    '$i=[Console]::OpenStandardInput();$m=New-Object IO.MemoryStream;$i.CopyTo($m);$t=[Text.Encoding]::UTF8.GetString($m.ToArray())',
    '$k=$t.IndexOf([char]10);if($k -lt 0){$k=$t.Length};$pw=$t.Substring(0,$k).TrimEnd([char]13);$s=if($k -lt $t.Length){$t.Substring($k+1)}else{\'\'}',
    `$o=@{ComputerName='${m.host.replace(/^\[|\]$/g, '')}';Port=${ssl ? 5986 : 5985};ScriptBlock=[scriptblock]::Create($s)}`,
    ...(ssl ? ['$o.UseSSL=$true'] : []),
    `if($pw){$o.Credential=New-Object Management.Automation.PSCredential('${compte}',(ConvertTo-SecureString $pw -AsPlainText -Force))}`,
    'Invoke-Command @o',
  ].join('\n');
}

/**
 * Pour les essais seulement : remplace le poste distant (un faux SSH ou un faux PowerShell). `script` est le script
 * PowerShell complet (Windows) ; `commande` une commande shell ordinaire (détection du système).
 */
export const essais: { windows?: (m: Machine, script: string, lien: Lien) => Promise<Sortie>; commande?: (m: Machine, commande: string) => Promise<Sortie> } = {};

/** Lance un script PowerShell sur un poste Windows et rend sa sortie (texte). */
export async function executerPs(home: string, run: Run, m: Machine, script: string, o: { lien?: Lien; timeoutMs?: number } = {}): Promise<Sortie> {
  const lien = o.lien ?? 'ssh';
  if (essais.windows) return essais.windows(m, script, lien);
  if (lien === 'ssh') return runOnMachine(home, m, commandeSsh(), { stdin: Buffer.from(script, 'utf8'), timeoutMs: o.timeoutMs ?? 120_000 });
  const ps = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const r = await run(ps, [...OPTIONS, '-EncodedCommand', encoder(lanceurWinrm(m))], { input: `${m.password ?? ''}\n${script}`, timeoutMs: o.timeoutMs ?? 120_000 })
    .catch((e: Error) => ({ code: 1, out: '', err: /ENOENT/.test(e.message) ? `${ps} absent sur la machine d'Odin (WinRM impossible)` : e.message }));
  return { code: r.code, out: `${r.out}${r.code !== 0 && r.err ? `\n${r.err}` : ''}` };
}

/** Une commande shell ordinaire sur un poste (détection), par SSH. */
const commande = (home: string, m: Machine, cmd: string): Promise<Sortie> => (essais.commande ? essais.commande(m, cmd) : runOnMachine(home, m, cmd, { timeoutMs: 20_000 }).catch((e: Error) => ({ code: 1, out: e.message })));

/** Le système d'un poste joint par SSH : Linux / macOS (« posix ») ou Windows. */
export async function detecterSysteme(home: string, m: Machine): Promise<Systeme> {
  const u = await commande(home, m, 'uname -s');
  if (u.code === 0 && /linux|darwin|bsd/i.test(u.out)) return 'posix';
  const w = await commande(home, m, 'cmd /c ver');
  if (/windows/i.test(w.out)) return 'windows';
  throw new Error(`${m.label} : système non reconnu (${(u.out || w.out).trim().split('\n').at(-1)?.slice(0, 120) || 'pas de réponse'})`);
}

// ---------------- Morceaux de PowerShell communs ----------------

/** `Sortir $objet` : une ligne JSON en ASCII (les accents en \uXXXX) : rien ne s'abîme, quel que soit l'encodage de la console. */
export const PS_SORTIR = String.raw`function Sortir($o) { $j = $o | ConvertTo-Json -Compress -Depth 6; [regex]::Replace($j, '[^\x00-\x7F]', { param($c) '\u{0:x4}' -f [int][char]$c.Value }) }`;
/** `Trouver-Python` : le chemin de python.exe (3.8 ou plus), par le lanceur « py », « python » ou « python3 » ; sinon $null. */
export const PS_PYTHON = String.raw`function Trouver-Python {
  foreach ($e in @(@{ c = 'py'; a = @('-3') }, @{ c = 'python'; a = @() }, @{ c = 'python3'; a = @() })) {
    $cmd = Get-Command $e.c -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $cmd) { continue }
    try { $x = & $cmd.Source @($e.a + @('-c', 'import sys; print(sys.executable if sys.version_info >= (3, 8) else str())')) 2>$null | Select-Object -Last 1 } catch { $x = $null }
    if ($x -and (Test-Path -LiteralPath ([string]$x).Trim())) { return ([string]$x).Trim() }
  }
  return $null
}
function Python-Silencieux($py) { $w = Join-Path (Split-Path -Parent $py) 'pythonw.exe'; if (Test-Path -LiteralPath $w) { return $w } else { return $py } }`;
/** `Proteger $dossier` : ce dossier n'est lisible que par le compte qui l'installe (et le système). */
export const PS_PROTEGER = String.raw`function Proteger($d, [switch]$Systeme) {
  $moi = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $droits = @('/inheritance:r', '/grant:r', ('*' + $moi + ':(OI)(CI)F'), '/grant:r', '*S-1-5-18:(OI)(CI)F')
  if ($Systeme) { $droits += @('/grant:r', '*S-1-5-32-544:(OI)(CI)F') }
  & icacls.exe $d @droits | Out-Null
}
function Ecrire-B64($chemin, $b64) { [IO.File]::WriteAllBytes($chemin + '.tmp', [Convert]::FromBase64String($b64)); Move-Item -LiteralPath ($chemin + '.tmp') -Destination $chemin -Force }`;
/** Un texte PowerShell entre apostrophes (rien n'y est interprété). Pur. */
export const psTexte = (t: string) => `'${t.replace(/'/g, "''")}'`;
