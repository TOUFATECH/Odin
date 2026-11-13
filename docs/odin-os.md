# Odin OS

Odin OS est le système d'exploitation d'Odin : un système léger, construit sur **Ubuntu 26.04 LTS**, dont le bureau est servi par Odin lui-même. Le même bureau s'affiche partout : dans un navigateur, dans Docker, dans un conteneur LXC, sur un PC, dans Windows et sur un téléphone.

Version : **0.1.0** (`src/os/version.ts`). Dans Odin, l'appli qui s'en occupe s'appelle **Valaskjálf** (la demeure d'Odin).

## L'essayer tout de suite

Odin sert le bureau sur `/os/` :

```
odin os essai          # affiche l'adresse (par exemple https://localhost:7777/os/)
```

- `/os/` : le bureau, avec tes vraies applis d'Odin, tes fichiers et Ullr.
- `/os/?ecran=mobile` : l'écran téléphone.
- `/os/?essai` : une démonstration sans tes données (tout est marqué « Essai »).

## Ce qu'il y a dans le bureau

| | |
|---|---|
| Thèmes (ordinateur) | Odin, Verre (disposition façon Mac), Fenêtres (façon Windows), Libre (façon GNOME), Néon (façon KDE) |
| Styles (téléphone) | Odin, Lavande (façon Android), Verre (façon iPhone) |
| Applis du système | Fichiers, Éditeur, Terminal, Réglages, Odin Store, Odin Install |
| Applis d'Odin | toutes les applis de Valhalla, à installer depuis Odin Store ou au premier démarrage ; Ullr (antivirus) a sa propre page |
| Odin | sa bulle (mascotte) dans le dock : il répond, ouvre les applis, change les réglages |
| Odin Setup | premier démarrage : compte, style, applis d'Odin ; sur l'image PC : clavier et installation sur le disque |

Les thèmes reprennent des dispositions familières. Les icônes, fonds d'écran et polices sont ceux d'Odin OS : aucune marque, icône ou image d'un autre système n'est utilisée.

## Où l'installer

| Où | Comment | Image |
|---|---|---|
| Navigateur | `odin os essai` | aucune |
| Docker | `odin os installer --docker` (options `--port=7788 --nom=odin-os --lan`) | `odin-os-…-amd64-docker.tar.gz`, ou construite depuis `os/docker/Dockerfile` |
| LXC / Proxmox | `odin os installer --lxc` (options `--id=120 --stockage=local-lvm --pont=vmbr0`) | `odin-os-…-amd64-lxc.tar.xz` |
| PC, machine virtuelle | démarrer sur l'ISO, puis Odin Setup → « Tout le disque » | `odin-os-…-amd64.iso` |
| Windows | `os/windows/Installer-OdinOS.ps1` (WSL 2) | `odin-os-…-amd64.wsl` |
| Téléphone Android | Odin Launcher + la base Ubuntu dans Termux | `odin-os-…-launcher.apk`, `odin-os-…-arm64-mobile-rootfs.tar.xz` |
| Machine ARM qui démarre en UEFI | écrire l'image sur le disque | `odin-os-…-arm64-mobile.img.xz` |

### Docker

```
docker load -i odin-os-0.1.0-amd64-docker.tar.gz
docker run -d --name odin-os -p 127.0.0.1:7788:7777 -v odin-os-donnees:/home/odin odin-os:0.1.0
```

Ouvre `http://localhost:7788/os/` : au premier passage, tu crées ton compte. Par défaut le bureau n'est ouvert que sur la machine. Pour l'ouvrir au réseau local : `odin os installer --docker --lan` (il passe alors en HTTPS, avec le certificat d'Odin ; à la main : `-e ODIN_OS_HTTPS=1 -p 7788:7777`). Sans l'image : `docker build -t odin-os:0.1.0 -f os/docker/Dockerfile .` (ou `docker compose -f os/docker/compose.yaml up -d`).

### LXC et Proxmox

- **Proxmox** : copie `odin-os-…-lxc.tar.xz` dans `/var/lib/vz/template/cache/`, puis crée le conteneur depuis l'interface (ou `odin os installer --lxc` sur le Proxmox). Non privilégié, option « nesting ».
- **LXC classique** : `lxc-create -n odin-os -t local -- --fstree odin-os-…-lxc.tar.xz --metadata odin-os-…-lxc-meta.tar.xz`

Le conteneur démarre avec systemd ; Odin écoute en HTTPS sur le port 7777 : `https://ADRESSE:7777/os/`.

### PC et machine virtuelle (ISO)

L'ISO démarre en BIOS et en UEFI, sans rien installer (session d'essai, en mémoire). Odin Setup crée ton compte, puis propose d'installer Odin OS sur **tout un disque** (il est effacé, après confirmation) : ton compte, ton style et tes applis suivent sur le disque. L'installation « à côté d'un autre système » n'est pas encore faite.

Une fois installé, Odin OS demande ton mot de passe à chaque démarrage de la machine.

- Machine virtuelle : 2 Go de mémoire, un disque de 8 Go ou plus, carte graphique standard.
- Vrai PC : l'image ne contient pas les micrologiciels (`linux-firmware`, plusieurs centaines de Mo). Le réseau filaire marche ; pour le Wi-Fi : `sudo apt install linux-firmware` une fois installé.
- Écrire l'ISO sur une clé : `sudo dd if=odin-os-0.1.0-amd64.iso of=/dev/sdX bs=4M status=progress` (ou balenaEtcher, Rufus en mode DD).

### Windows (WSL 2)

1. WSL doit être installé : PowerShell en administrateur, `wsl --install --no-distribution`, puis redémarrer.
2. Dans le dossier du paquet : `powershell -ExecutionPolicy Bypass -File os\windows\Installer-OdinOS.ps1`
3. Odin OS s'ouvre dans une fenêtre ; raccourci « Odin OS » dans le menu Démarrer.

C'est la même base Ubuntu, démarrée par systemd dans WSL. Arrêter : `wsl --terminate OdinOS`. Retirer : `wsl --unregister OdinOS`.

### Téléphone

Deux pièces, sur la même base Ubuntu (arm64) :

1. **Odin Launcher** (`…-launcher.apk`) : l'écran d'accueil Odin OS. Il affiche le bureau « téléphone », lance les applis Android du téléphone et se propose comme écran d'accueil. Sans Odin joignable, il montre le bureau embarqué en mode essai.
2. **La base Ubuntu d'Odin OS** dans Termux (sans « rooter » le téléphone) :

```
# dans Termux, après avoir copié les fichiers dans Téléchargements
termux-setup-storage
sh odin-os-termux.sh installer /sdcard/Download/odin-os-0.1.0-arm64-mobile-rootfs.tar.xz
sh odin-os-termux.sh demarrer
```

Odin tourne alors sur le téléphone (`http://127.0.0.1:7777`), et Odin Launcher s'y relie tout seul. Tu peux aussi relier le lanceur à l'Odin de ton serveur : Réglages → Téléphone → Odin Launcher.

**Remplacer Android par Odin OS** : l'image `…-arm64-mobile.img.xz` démarre toute seule sur l'écran téléphone, mais seulement sur une machine ARM qui démarre en UEFI (machine virtuelle, certaines tablettes et cartes). Un téléphone du commerce a un chargeur de démarrage et un noyau propres à son modèle : il faut un portage par modèle (comme le font postmarketOS ou Ubuntu Touch). Ce portage n'est pas fait.

## Applis Linux, Windows, Android, Mac

| Applis | Comment | État dans 0.1 |
|---|---|---|
| Linux | Odin Store → Linux (dépôt Ubuntu), ou un fichier `.deb` ouvert dans Fichiers | marche (testé dans Docker) ; les applis à fenêtre s'affichent sur l'image PC |
| Windows | « Odin Bridge Windows » = Wine, installé à la demande | marche pour les programmes 64 bits (testé dans Docker avec un programme console) ; les fenêtres s'affichent sur l'image PC |
| Android | « Odin Bridge Android » = Waydroid, image PC seulement | installeur écrit, paquets vérifiés sur Ubuntu 26.04 ; **pas testé de bout en bout** |
| Mac | « Odin Bridge Mac » = Darling, image PC seulement | expérimental : outils en ligne de commande seulement ; **pas testé de bout en bout** |
| iPhone | impossible | Apple ne le permet pas hors d'un iPhone |

Formats pas encore pris en charge : AppImage, Flatpak, Snap, RPM.

## Construire les images

Sur une machine Ubuntu ou Debian récente, en root :

```
sudo apt install debootstrap docker.io xz-utils zstd squashfs-tools xorriso grub-pc-bin grub-efi-amd64-bin grub-common \
  mtools dosfstools fdisk e2fsprogs curl aapt apksigner zipalign dalvik-exchange libandroid-23-java default-jdk-headless \
  qemu-user-static binfmt-support
sudo os/build/images.sh                # toutes
sudo os/build/images.sh docker iso     # seulement celles-ci
```

Les images arrivent dans `os/sortie/`, avec `SHA256SUMS`. `odin os images` affiche la taille et l'empreinte de chacune.

| Script | Produit |
|---|---|
| `base.sh` | la base commune : Ubuntu minimal (debootstrap), Node.js officiel, Odin dans `/opt/odin` |
| `docker.sh` | image Docker |
| `lxc.sh` | modèle LXC |
| `wsl.sh` | paquet WSL |
| `iso.sh` | ISO pour PC (noyau, labwc, vue du bureau, installeur sur disque) |
| `mobile.sh` | base arm64 pour Termux et image disque UEFI arm64 (`SANS_IMAGE=1` : la base seulement) |
| `apk.sh` | Odin Launcher |
| `tester.sh` | démarre l'ISO ou l'image arm64 dans QEMU et prend des captures d'écran |

À savoir :

- **Node.js** : le binaire officiel de nodejs.org (22.23.4, empreinte vérifiée). Celui du dépôt Ubuntu est compilé sans la lecture directe du TypeScript, dont Odin a besoin.
- **arm64 depuis un PC** : la construction passe par l'émulation (`qemu-user-static`). L'installation des paquets de l'image téléphone est longue ; elle est gardée d'une construction à l'autre (`REFAIRE_PAQUETS=1` pour la refaire).
- **Sans accès au dépôt Ubuntu** : `MIROIR=file:///chemin/vers/une/copie` (une seule suite, déjà vérifiée). Sans accès à nodejs.org : `NODE_BINAIRE=/chemin/vers/node` (le binaire officiel, de la même version).
- **Clé de l'APK** : créée une fois dans `~/.odin-os/odin-launcher.jks` (mot de passe : `ODIN_OS_CLE_PASSE`, sinon `odin-os`). Garde-la : une mise à jour de l'appli doit être signée avec la même clé.

## Comment c'est fait

```
src/os/shell/        le bureau : JavaScript simple, sans dépendance (index.html, shell.css, noyau.js, bureau.js, mobile.js…)
src/os/*.ts          côté Odin : fichiers statiques /os/, API /api/os/…, installation Docker/LXC, « odin os »
src/valhalla/modules/valaskjalf.ts  l'appli Odin OS dans Odin
os/build/            scripts de construction des images
os/rootfs/           fichiers ajoutés aux images (service Odin, session graphique, ponts, installeur)
os/android/          sources d'Odin Launcher
os/windows/, os/mobile/, os/docker/  scripts d'installation
```

Sur l'image PC : systemd démarre `odin.service` (Odin, sur `127.0.0.1:7777`) puis `odin-os-ecran.service` : labwc (gestionnaire de fenêtres Wayland) et une vue WebKit plein écran qui affiche `/os/`. Les applis Linux et Windows à fenêtre s'ouvrent par-dessus, dans labwc.

## Sécurité

- Les fichiers du bureau (`/os/…`) ne contiennent aucune donnée ; tout le reste passe par `/api/os/…`, derrière la connexion d'Odin.
- Le bureau ne charge que ses propres fichiers (politique de sécurité stricte, aucun script externe).
- **Fichiers** : seulement le dossier personnel. Les dossiers cachés (`.odin`, `.ssh`…) sont hors d'atteinte, y compris par un lien symbolique. Supprimer = corbeille.
- **Terminal** : de vraies commandes seulement dans une image Odin OS. Sur une machine où Odin est simplement installé, il est fermé ; `odin os terminal on` l'ouvre (c'est ton choix, en ligne de commande, jamais depuis le web). Les commandes dangereuses demandent une confirmation.
- **Paquets et ponts** : seulement dans une image Odin OS. Odin ne touche jamais aux paquets d'une machine où il est simplement installé.
- Dans une image, le compte `odin` a les droits administrateur sans mot de passe : c'est le système d'Odin. Protège donc l'accès au bureau (compte, réseau).

## Ce qui a été testé (0.1.0)

Les essais sur machine ont été faits dans des machines virtuelles QEMU, sans accélération (donc lentes), et dans de vrais conteneurs.

| Quoi | Comment | Résultat |
|---|---|---|
| Bureau, les 5 thèmes, écran téléphone, Odin Setup, Odin Store, Fichiers, Terminal, Réglages, Ullr | captures dans WebKit, en mode essai et avec un Odin réel | marche |
| Image Docker | conteneur réel : compte, bureau, vraies commandes, recherche et installation d'un paquet, pont Windows (Wine) avec un programme console | marche |
| Modèle LXC | `lxc-create` puis démarrage : systemd, service Odin, bureau en HTTPS | marche |
| ISO PC | démarrage par son menu en BIOS et en UEFI, Odin Setup complet (compte, clavier, disque, style, applis), installation sur le disque | marche |
| Disque installé | démarrage en BIOS et en UEFI, mot de passe demandé, bureau au style choisi, vraies commandes dans le Terminal | marche |
| Base arm64 (téléphone) | lancée en émulation : Odin démarre, compte, bureau, commandes | marche |
| Image arm64 UEFI | machine ARM émulée : menu de démarrage, noyau, session graphique, Odin Setup s'affiche | marche jusque-là ; la suite d'Odin Setup n'a pas été parcourue sur cette image |
| Odin Launcher (APK) | compilée, signée, signature vérifiée | pas installée sur un téléphone |
| Paquet WSL et scripts PowerShell | construits | pas testés (il faut un Windows avec WSL) |
| Installation par Proxmox (`pct`) | écrite | pas testée (le modèle est le même que pour `lxc-create`) |
| Ponts Android (Waydroid) et Mac (Darling) | paquets vérifiés sur Ubuntu 26.04 | pas testés de bout en bout |
| Vrai PC, Wi-Fi, son, écran tactile | — | pas testés |

## Pas encore dans 0.1

- Installation à côté d'un autre système, chiffrement du disque.
- Wi-Fi, son, luminosité depuis le bureau ; clavier à l'écran sur l'image téléphone.
- Affichage des applis à fenêtre dans Docker, LXC et WSL (elles s'affichent sur l'image PC).
- Sauvegardes et mises à jour avec retour arrière depuis le bureau (les applis Sindri et Idunn d'Odin font les sauvegardes).
- Portage sur des modèles de téléphone.
