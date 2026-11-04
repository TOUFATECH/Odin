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
#    5. propose : inventaire du réseau local, démarrage à l'ouverture de session ;
#    6. ouvre l'interface web : tu y choisis le modèle et tes clés (onglet Réglages).
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
# Chemins écrits avec des variables d'environnement : pas de problème d'accents (Jérôme) ni d'encodage du .cmd.
$nodeRef = if ($NodeExe -like "$env:LOCALAPPDATA*") { '%LOCALAPPDATA%' + $NodeExe.Substring($env:LOCALAPPDATA.Length) } else { $NodeExe }
$homeRef = if ($OdinHome -like "$HOME*") { '%USERPROFILE%' + $OdinHome.Substring($HOME.Length) } else { $OdinHome }
$cmd = "@echo off`r`nset ODIN_HOME=$homeRef`r`n`"$nodeRef`" --disable-warning=ExperimentalWarning `"%LOCALAPPDATA%\Odin\app\bin\odin.mjs`" %*`r`n"
[System.IO.File]::WriteAllText((Join-Path $BinDir 'odin.cmd'), $cmd, (New-Object System.Text.UTF8Encoding $false))
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
Info 'Le modèle, les clés et Telegram se règlent ensuite dans l''interface web (onglet Réglages).'

# Qui peut ouvrir l'interface web ? (modifiable plus tard : Réglages → Accès, ou « odin web access »)
$Access = $env:ODIN_WEB_ACCESS
if (-not $Access -and $env:ODIN_YES -ne '1') {
  Write-Host '  Accès à l''interface web :'
  Write-Host '    1) ton réseau local, en HTTPS (recommandé : téléphone, tablette…)'
  Write-Host '    2) cette machine seulement'
  Write-Host '    3) Internet aussi (HTTPS obligatoire, port à ouvrir sur ta box)'
  $ch = Read-Host '  Ton choix [1]'
  $Access = switch ($ch) { '2' { 'local' } '3' { 'wan' } default { 'lan' } }
}
if ($Access -notin @('local', 'lan', 'wan')) { $Access = 'lan' }
& $Odin web access $Access | Out-Null
Ok "Interface web : $(@{ local = 'cette machine seulement'; lan = 'réseau local en HTTPS'; wan = 'réseau local et Internet en HTTPS' }[$Access])"
if ($Access -ne 'local') {
  # Pare-feu Windows : autoriser le port 7777 (réseaux privés ; tous les profils pour Internet).
  $fwProfile = if ($Access -eq 'wan') { 'Any' } else { 'Private' }
  $rule = "New-NetFirewallRule -DisplayName 'Odin (interface web)' -Direction Inbound -Protocol TCP -LocalPort 7777 -Action Allow -Profile $fwProfile | Out-Null"
  if (-not (Get-NetFirewallRule -DisplayName 'Odin (interface web)' -ErrorAction SilentlyContinue)) {
    if (Ask 'Autoriser Odin dans le pare-feu Windows (une fenêtre administrateur va s''ouvrir) ?') {
      try { Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList "-NoProfile -Command $rule"; Ok 'Pare-feu : port 7777 autorisé' }
      catch { Info 'Pare-feu non modifié : autorise le port 7777 toi-même si les autres appareils n''y arrivent pas.' }
    }
  }
}

if ($env:ODIN_NO_SCAN -ne '1' -and (Ask 'Inventorier les appareils de ton réseau local (et suivre leurs changements) ?')) {
  & $Odin net enable | Out-Null
  Info 'Balayage du réseau local en cours (environ 30 secondes)…'
  & $Odin net scan --full
}

$service = $false
if ($env:ODIN_NO_SERVICE -ne '1' -and (Ask 'Lancer Odin automatiquement à l''ouverture de session (interface web + Telegram + tâches) ?')) {
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"& '$Odin' gateway *>> '$OdinHome\logs\gateway.log'`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName 'Odin' -Action $action -Trigger $trigger -Settings $settings -Description 'Odin, agent IA personnel' -Force | Out-Null
  Start-ScheduledTask -TaskName 'Odin'
  $service = $true
  Ok 'Démarrage automatique installé (Planificateur de tâches, sans droits administrateur)'
}

# ---------- Fin : configuration dans le navigateur ----------
Write-Host ''
Gold 'ᛟ  Odin est installé'
Write-Host '  Dernière étape : choisis ton modèle dans l''interface web, onglet Réglages.'
if ($service) {
  $tokFile = Join-Path $OdinHome 'web-token'
  for ($i = 0; $i -lt 10 -and -not (Test-Path $tokFile); $i++) { Start-Sleep -Seconds 1 }
  $scheme = if ($Access -eq 'local') { 'http' } else { 'https' }
  $tok = Get-Content $tokFile -ErrorAction SilentlyContinue
  $url = "$($scheme)://127.0.0.1:7777/?token=$tok"
  Write-Host "  Interface web : $url"
  if ($Access -ne 'local') {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' } | Select-Object -First 1).IPAddress
    if ($ip) { Write-Host "  Depuis ton téléphone ou un autre appareil du réseau : $($scheme)://$($ip):7777/?token=$tok" }
    Write-Host '  (certificat créé par Odin : le navigateur demandera de l''accepter une fois)'
  }
  Start-Process $url
  Write-Host '  Plus tard     : odin web (rouvre l''interface) · odin doctor (diagnostic)'
  Write-Host '  (ouvre un nouveau terminal si la commande « odin » est introuvable)'
} else {
  Write-Host '  Plus tard     : odin web (rouvre l''interface) · odin gateway (tout en arrière-plan)'
  Write-Host '  (ouvre un nouveau terminal si la commande « odin » est introuvable)'
  if ($env:ODIN_YES -ne '1' -and (Ask 'Ouvrir l''interface web maintenant ? (Ctrl+C pour l''arrêter)')) { & $Odin web }
}
