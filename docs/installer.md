# Installer Odin

## La commande

macOS et Linux :

```bash
curl -fsSL https://raw.githubusercontent.com/TOUFATECH/Odin/main/install.sh | bash
```

Windows (PowerShell, sans droits administrateur) :

```powershell
irm https://raw.githubusercontent.com/TOUFATECH/Odin/main/install.ps1 | iex
```

L'installateur :

1. vérifie Node.js 22.18 ou plus ; s'il manque, il télécharge la version officielle (somme SHA-256 vérifiée) dans ton
   dossier personnel, sans toucher au Node du système ;
2. installe Odin (`~/.odin/app` sur macOS et Linux, `%LOCALAPPDATA%\Odin\app` sur Windows) ;
3. crée la commande `odin` ;
4. prépare `~/.odin` (configuration, personnalité, mémoire, espace de travail) ;
5. te demande : qui peut ouvrir l'interface, si Odin est un homme ou une femme (sa voix et ses accords), l'inventaire
   du réseau local, le démarrage automatique (launchd, systemd ou Planificateur de tâches) ;
6. ouvre l'interface web.

Variables : `ODIN_YES=1` (aucune question), `ODIN_NO_SERVICE=1`, `ODIN_NO_SCAN=1`, `ODIN_GENRE=homme|femme`,
`ODIN_REPO=<adresse git>`, `ODIN_HOME=<dossier>`.

**Seul Node.js est nécessaire.** Les programmes qui servent à certaines applis (`ffmpeg`, `tesseract`, un compilateur C
pour la voix sur la machine, `lxc` et `qemu` pour créer des machines, Docker pour quelques cas) sont listés dans le
[README](../README.md#installer) ; Odin te dit quand il en a besoin et sait souvent les installer lui-même.

## Depuis les sources

```bash
git clone https://github.com/TOUFATECH/Odin.git
cd Odin
npm install          # uniquement les outils de développement
npm link             # la commande « odin »
odin init
```

Node.js exécute directement le TypeScript : il n'y a rien à compiler.

## Dans un conteneur

Un `Dockerfile` est fourni (Odin lui-même n'a pas besoin de Docker : c'est seulement une façon de l'installer).

```bash
docker build -t odin .
# À la maison (Linux) : Odin voit tes appareils (balayage, identification, DNS, VPN, démarrage réseau)
docker run -d --name odin --network host --cap-add NET_ADMIN --cap-add NET_RAW -v odin-data:/data odin
# Isolé (réseau « bridge ») : seulement la discussion et le web ; Odin ne voit pas la maison (il te le dit)
docker run -d --name odin -p 8888:8888 -v odin-data:/data odin
docker exec -it odin node bin/odin.mjs chat
```

- En conteneur isolé, « le réseau local » d'Odin est celui du conteneur : il ne peut ni balayer ni identifier les
  postes de la maison. Avec `--network host`, il est sur le même réseau que la machine.
- Les applis qui lisent la machine (disques, journaux, pare-feu, ménage) lisent alors le conteneur, pas la machine
  hôte : pour elles, installe Odin directement sur la machine.
- Dans le conteneur, Odin est administrateur du conteneur (sudo sans mot de passe pour son compte) : il peut y
  installer ce dont il a besoin. Ne le lance pas avec `--security-opt no-new-privileges`, qui l'en empêcherait.
- L'interface est en mode réseau local : publie le port (`-p 8888:8888`) et ouvre `https://<ip-de-la-machine>:8888`.
- Les clés se règlent dans l'interface (Réglages), comme pour une installation normale.

## Mettre à jour

`odin update`, puis Odin redémarre ses services.

## Désinstaller

- macOS : `launchctl unload ~/Library/LaunchAgents/ai.odin.gateway.plist`
- Linux : `systemctl --user disable --now odin`
- Windows : `Unregister-ScheduledTask Odin`

Puis supprime `~/.odin` (et `~/.local/bin/odin`, ou `%LOCALAPPDATA%\Odin` sous Windows). Fais d'abord une sauvegarde si
tu veux garder ta mémoire : `odin backup`.
