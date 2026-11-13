# Odin OS pour Windows - installe Odin OS dans WSL 2 (la meme base Ubuntu que partout ailleurs) et cree un raccourci.
# Usage (PowerShell, dans le dossier ou se trouve le paquet odin-os-<version>-amd64.wsl) :
#   powershell -ExecutionPolicy Bypass -File .\Installer-OdinOS.ps1
# Options : -Paquet chemin\vers\odin-os.wsl   -Dossier C:\OdinOS   -Remplacer (efface une installation existante)
param([string]$Paquet = '', [string]$Dossier = (Join-Path $env:LOCALAPPDATA 'OdinOS'), [switch]$Remplacer)
$ErrorActionPreference = 'Stop'
$env:WSL_UTF8 = '1'
$nom = 'OdinOS'

if (-not $Paquet) { $Paquet = Get-ChildItem -Path $PSScriptRoot, (Get-Location) -Filter 'odin-os-*.wsl' -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty FullName }
if (-not $Paquet -or -not (Test-Path $Paquet)) { Write-Host "Paquet Odin OS introuvable. Place odin-os-<version>-amd64.wsl a cote de ce script, ou donne -Paquet." -ForegroundColor Red; exit 1 }

# WSL 2 doit deja etre la : son installation demande les droits administrateur et un redemarrage.
& wsl.exe --status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "WSL n'est pas installe sur ce PC." -ForegroundColor Yellow
  Write-Host "Ouvre PowerShell en administrateur, lance :  wsl --install --no-distribution"
  Write-Host "Redemarre le PC, puis relance ce script."
  exit 1
}
$existe = (& wsl.exe -l -q) -contains $nom
if ($existe -and -not $Remplacer) { Write-Host "Odin OS est deja installe. Pour le reinstaller (ses donnees seront effacees) : ajoute -Remplacer." -ForegroundColor Yellow; exit 1 }
if ($existe) { & wsl.exe --terminate $nom *> $null; & wsl.exe --unregister $nom }

Write-Host "Installation d'Odin OS dans WSL ($Paquet)..."
New-Item -ItemType Directory -Force -Path $Dossier | Out-Null
& wsl.exe --import $nom $Dossier $Paquet --version 2
if ($LASTEXITCODE -ne 0) { Write-Host "L'import a echoue." -ForegroundColor Red; exit 1 }

# Le lanceur est copie a cote des donnees ; le raccourci du menu Demarrer pointe dessus.
$lanceur = Join-Path $Dossier 'Lancer-OdinOS.ps1'
Copy-Item (Join-Path $PSScriptRoot 'Lancer-OdinOS.ps1') $lanceur -Force
$raccourci = Join-Path ([Environment]::GetFolderPath('Programs')) 'Odin OS.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($raccourci)
$s.TargetPath = 'powershell.exe'
$s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$lanceur`""
$s.WorkingDirectory = $Dossier
$s.Description = 'Odin OS'
$s.Save()

Write-Host "Odin OS est installe. Je le demarre..." -ForegroundColor Green
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $lanceur
Write-Host "Pour le rouvrir : menu Demarrer > Odin OS (ou http://localhost:7777/os/ dans un navigateur)."
Write-Host "Pour l'arreter : wsl --terminate OdinOS    Pour le retirer : wsl --unregister OdinOS"
