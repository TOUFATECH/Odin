# Odin OS pour Windows - demarre Odin OS (WSL) et ouvre son bureau dans une fenetre d'application.
$ErrorActionPreference = 'SilentlyContinue'
$nom = 'OdinOS'
$adresse = 'http://localhost:7777'

# Un processus discret garde le sous-systeme en marche (sinon Windows l'arrete quand plus rien ne l'utilise).
$garde = Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { $_.CommandLine -match 'odin-os-garde' }
if (-not $garde) { Start-Process wsl.exe -ArgumentList '-d', $nom, '-u', 'odin', '--exec', '/bin/sh', '-c', 'exec sleep 2147483647 # odin-os-garde' -WindowStyle Hidden }

# Odin met quelques secondes a demarrer.
$pret = $false
for ($i = 0; $i -lt 60 -and -not $pret; $i++) {
  try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$adresse/health"; if ($r.StatusCode -eq 200) { $pret = $true } } catch { Start-Sleep -Seconds 1 }
}
if (-not $pret) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show("Odin OS ne repond pas encore. Reessaie dans un instant, ou regarde : wsl -d OdinOS -- journalctl -u odin -n 30", 'Odin OS') | Out-Null; exit 1 }

# Fenetre d'application (Edge ou Chrome), sinon le navigateur par defaut.
$navigateurs = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe")
$n = $navigateurs | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($n) { Start-Process $n -ArgumentList "--app=$adresse/os/", '--start-maximized' } else { Start-Process "$adresse/os/" }
