# ─────────────────────────────────────────────────────────────────────────────
#  Installateur d'Odin pour Windows (PowerShell 5.1 ou 7)
#
#    irm https://raw.githubusercontent.com/TOUFATECH/Odin/main/install.ps1 | iex
#
#  Ce que fait ce script :
#    1. vérifie Node.js ≥ 22.18, sinon télécharge Node 22 officiel (somme SHA-256
#       vérifiée) dans %LOCALAPPDATA%\Odin\node, sans droits administrateur ;
#    2. télécharge Odin dans %LOCALAPPDATA%\Odin\app ;
#    3. crée la commande « odin » et l'ajoute au PATH de l'utilisateur ;
#    4. initialise %USERPROFILE%\.odin ;
#    5. propose : clé d'API, inventaire du réseau local, démarrage à l'ouverture de session.
#
#  Variables utiles : $env:ODIN_YES = "1", $env:ODIN_NO_SERVICE = "1", $env:ODIN_NO_SCAN = "1",
#  $env:ODIN_REPO = "<url git>".
# ─────────────────────────────────────────────────────────────────────────────
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest est très lent avec la barre de progression
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo    = if ($env:ODIN_REPO) { $env:ODIN_REPO } else { 'https://github.com/TOUFATECH/Odin' }
$Root    = Join-Path $env:LOCALAPPDATA 'Odin'
$AppDir  = Join-Path $Root 'app'
$NodeDir = Join-Path $Root 'node'
$BinDir  = Join-Path $Root 'bin'
$OdinHome = if ($env:ODIN_HOME) { $env:ODIN_HOME } else { Join-Path $HOME '.odin' }

function Gold($t) { Write-Host $t -ForegroundColor Yellow }
function Ok($t)   { Write-Host "  ✓ $t" -ForegroundColor Green }
function Info($t) { Write-Host "  $t" -ForegroundColor DarkGray }
function Ask($q) {
  if ($env:ODIN_YES -eq '1') { return $true }
  $a = Read-Host "  $q [O/n]"
  return ($a -eq '' -or $a -match '^(o|oui|y|yes)$')
}

Gold "ᛟ  Installation d'Odin"

# ---------- 1. Node.js ----------
function Test-Node($exe) {
  try { $v = & $exe -p "process.versions.node" 2>$null } catch { return $false }
  if (-not $v) { return $false }
  $p = $v.Split('.'); $maj = [int]$p[0]; $min = [int]$p[1]
  return ($maj -gt 22) -or ($maj -eq 22 -and $min -ge 18)
}

$NodeExe = $null
$sys = Get-Command node -ErrorAction SilentlyContinue
if ($sys -and (Test-Node $sys.Source)) {
  $NodeExe = $sys.Source; Ok "Node $(& $NodeExe -v) déjà présent"
} elseif (Test-Path (Join-Path $NodeDir 'node.exe')) {
  $NodeExe = Join-Path $NodeDir 'node.exe'; Ok "Node $(& $NodeExe -v) (installé par Odin)"
}
if (-not $NodeExe -or -not (Test-Node $NodeExe)) {
  Info 'Téléchargement de Node.js 22 (officiel, nodejs.org)…'
  $arch = if ([Environment]::Is64BitOperatingSystem) { if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' } } else { throw 'Windows 32 bits non pris en charge' }
  $base = 'https://nodejs.org/dist/latest-v22.x'
  $sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content -split "`n"
  $line = $sums | Where-Object { $_ -match "node-v[\d.]+-win-$arch\.zip$" } | Select-Object -First 1
  if (-not $line) { throw "Aucune version de Node pour win-$arch" }
  $sha, $file = ($line -split '\s+')[0, 1]
  $tmp = Join-Path $env:TEMP $file
  Invoke-WebRequest "$base/$file" -OutFile $tmp -UseBasicParsing
  if ((Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower() -ne $sha.ToLower()) { throw 'Somme de contrôle de Node invalide (téléchargement corrompu ?)' }
  if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
  $ex = Join-Path $env:TEMP 'odin-node'
  if (Test-Path $ex) { Remove-Item $ex -Recurse -Force }
  Expand-Archive $tmp -DestinationPath $ex
  Move-Item (Get-ChildItem $ex | Select-Object -First 1).FullName $NodeDir
  Remove-Item $tmp, $ex -Recurse -Force -ErrorAction SilentlyContinue
  $NodeExe = Join-Path $NodeDir 'node.exe'
  Ok "Node $(& $NodeExe -v) installé dans $NodeDir (somme SHA-256 vérifiée)"
}

# ---------- 2. Odin ----------
New-Item -ItemType Directory -Force -Path $Root, $BinDir | Out-Null
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git -and (Test-Path (Join-Path $AppDir '.git'))) {
  git -C $AppDir pull --ff-only --quiet; Ok 'Odin mis à jour'
} elseif ($git) {
  if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
  git clone --depth 1 --quiet $Repo $AppDir; Ok 'Odin téléchargé'
} else {
  $zip = Join-Path $env:TEMP 'odin.zip'; $ex = Join-Path $env:TEMP 'odin-src'
  Invoke-WebRequest "$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
  if (Test-Path $ex) { Remove-Item $ex -Recurse -Force }
  Expand-Archive $zip -DestinationPath $ex
  if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
  Move-Item (Get-ChildItem $ex | Select-Object -First 1).FullName $AppDir
  Remove-Item $zip, $ex -Recurse -Force -ErrorAction SilentlyContinue
  Ok 'Odin téléchargé (archive)'
}

# ---------- 3. Commande « odin » ----------
$cmd = "@echo off`r`nset ODIN_HOME=$OdinHome`r`n`"$NodeExe`" --disable-warning=ExperimentalWarning `"$AppDir\bin\odin.mjs`" %*`r`n"
Set-Content -Path (Join-Path $BinDir 'odin.cmd') -Value $cmd -Encoding ASCII
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $BinDir })) {
  [Environment]::SetEnvironmentVariable('Path', ($(if ($userPath) { "$userPath;" } else { '' }) + $BinDir), 'User')
  Info "$BinDir ajouté au PATH de l'utilisateur"
}
$env:Path = "$BinDir;$env:Path"
$Odin = Join-Path $BinDir 'odin.cmd'
Ok "Commande installée : odin"

& $Odin init | Out-Null
Ok "Configuration créée dans $OdinHome"

# ---------- 4. Choix ----------
Write-Host ''
Gold 'Réglages'
if ($env:ODIN_YES -ne '1' -and -not [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY', 'User')) {
  $sec = Read-Host '  Clé Anthropic (Entrée pour passer)' -AsSecureString
  $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if ($key) {
    [Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', $key, 'User'); $env:ANTHROPIC_API_KEY = $key
    Ok 'Clé enregistrée dans tes variables d''environnement utilisateur'
  } else { Info 'Sans clé, Odin démarre en mode démo. Modèle local possible avec Ollama.' }
}

if ($env:ODIN_NO_SCAN -ne '1' -and (Ask 'Inventorier les appareils de ton réseau local (et suivre leurs changements) ?')) {
  & $Odin net enable | Out-Null
  Info 'Balayage du réseau local en cours (environ 30 secondes)…'
  & $Odin net scan --full
}

$service = $false
if ($env:ODIN_NO_SERVICE -ne '1' -and (Ask 'Lancer Odin automatiquement à l''ouverture de session (interface web + Telegram + tâches) ?')) {
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$Odin' gateway *> '$OdinHome\logs\gateway.log'`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'Odin' -Action $action -Trigger $trigger -Settings $settings -Description 'Odin, agent IA personnel' -Force | Out-Null
  Start-ScheduledTask -TaskName 'Odin'
  $service = $true
  Ok 'Démarrage automatique installé (Planificateur de tâches, sans droits administrateur)'
}

# ---------- Fin ----------
Write-Host ''
Gold 'ᛟ  Odin est installé'
if ($service) {
  Start-Sleep -Seconds 3
  $tok = Get-Content (Join-Path $OdinHome 'web-token') -ErrorAction SilentlyContinue
  Write-Host "  Interface web : http://127.0.0.1:7777/?token=$tok"
} else { Write-Host '  Interface web : odin web' }
Write-Host '  Terminal      : odin chat'
Write-Host '  Diagnostic    : odin doctor'
Write-Host '  Réseau        : odin net list'
Write-Host '  (ouvre un nouveau terminal si la commande « odin » est introuvable)'
