# ᛟ Odin OS

**Odin OS est un projet distinct de l'application Odin.** Cette branche (`odin-os`) porte le système d'exploitation et
ses applications. L'application Odin (agent IA, applis, interface) vit sur la branche
[`main`](https://github.com/TOUFATECH/Odin/tree/main), avec sa propre documentation.

| | Application Odin | Odin OS |
|---|---|---|
| Ce que c'est | l'agent IA et ses applis, qui tournent sur un ordinateur existant (macOS, Linux, Windows) | le système d'exploitation d'Odin : un système complet dont le bureau est servi par Odin |
| Où est le code | branche [`main`](https://github.com/TOUFATECH/Odin/tree/main) | cette branche : `os/`, `src/os/`, `applications/` |
| Version | voir `package.json` sur `main` | 0.1.0 (Valaskjálf) |
| Guide | la documentation de `main` | [`docs/odin-os.md`](docs/odin-os.md) |

Les applis d'Odin sont destinées à être réunies dans Odin OS ; d'ici là, les deux projets avancent séparément.

---

## Ce qu'est Odin OS

Un système léger, construit sur **Ubuntu 26.04 LTS** (systemd, labwc, vue WebKit), dont le bureau est servi par Odin
lui-même. Le même bureau s'affiche partout : dans un navigateur, dans Docker, dans un conteneur LXC, sur un PC, dans
Windows (WSL 2) et sur un téléphone.

- **Bureau** : cinq thèmes sur ordinateur, trois styles sur téléphone, avec la bulle d'Odin dans le dock.
- **Applis du système** : Fichiers, Éditeur, Terminal, Réglages, Odin Store, Odin Install.
- **Applis d'Odin** : toutes les applis de l'application Odin, à installer depuis Odin Store ou au premier démarrage.
- **Premier démarrage** (Odin Setup) : compte, style, applis ; sur PC, clavier et installation sur le disque.

## Les applications de l'OS (`applications/`)

Elles se connectent à l'application Odin avec le compte Odin (connexion unique) ; l'application Odin garde les services
qui les servent (synchronisation de Pégase, store d'Agora).

| Dossier | Ce que c'est | Fabrication (`.github/workflows/`) |
|---|---|---|
| `applications/pegase/` | Pégase, le navigateur, pour Windows, Mac et Linux (Electron) | `pegase-desktop.yml` ; une étiquette `pegase-v*` posée sur cette branche publie les installateurs dans une Release GitHub |
| `applications/pegase-android/` | Pégase pour Android | `pegase-android.yml` |
| `applications/pegase-plume/` | Plume (le correcteur) emballé pour Pégase | fabriqué par `construire.mjs`, utilisé par `pegase-desktop.yml` |
| `applications/agora-poste/` | Agora, le store d'Odin sur l'ordinateur (Electron) | `agora-poste.yml` (son essai pour de vrai récupère l'application Odin de `main`) |
| `applications/agora-android/` | Agora sur le téléphone | `agora-android.yml` |
| `applications/commun/` | les quelques fichiers de l'application Odin dont elles ont besoin, **copiés** (voir `ORIGINE.md`), et `verifier.mjs` qui les compare à `main` | lancé par `pegase-desktop.yml` |

Ces fabrications vivent sur cette branche : elles partent sur un envoi (push) ou une étiquette ; le lancement à la main
depuis l'onglet Actions n'est proposé par GitHub que pour les fabrications de la branche par défaut.

## Où il s'installe

| Où | Comment |
|---|---|
| Navigateur | `odin os essai`, puis `/os/` |
| Docker | `odin os installer --docker` |
| LXC / Proxmox | `odin os installer --lxc` |
| PC, machine virtuelle | ISO (BIOS et UEFI), installation sur tout un disque |
| Windows | WSL 2 (`os/windows/Installer-OdinOS.ps1`) |
| Téléphone Android | Odin Launcher + base Ubuntu dans Termux |

## Ce qui reste à faire

| Sujet | État |
|---|---|
| Installation à côté d'un autre système (PC) | pas encore faite |
| Applis Android (Waydroid) et Mac (Darling) | installeurs écrits, pas testés de bout en bout |
| Formats AppImage, Flatpak, Snap, RPM | pas encore pris en charge |
| Remplacer Android sur un téléphone du commerce | demande un portage par modèle, pas fait |
| Serveur d'Odin (parc d'entreprise : comptes et rôles, enrôlement des appareils, sauvegardes chiffrées, gestion à distance, console web) | en préparation, d'après le cahier des charges d'Odin OS |

## Organisation du code (cette branche)

```
src/os/                              côté Odin : bureau servi sur /os/, API /api/os/…, commande « odin os »
src/os/shell/                        le bureau (JavaScript sans dépendance)
src/valhalla/modules/valaskjalf.ts   l'appli Odin OS dans Odin
os/build/                            construction des images (Docker, LXC, WSL, ISO, téléphone)
os/rootfs/                           fichiers ajoutés aux images (service Odin, session graphique, installeur)
os/android/, os/windows/, os/mobile/, os/docker/   lanceurs et scripts d'installation
applications/                        les applications de l'OS (Pégase, Agora) et leurs fichiers partagés
```

## Licence

[MIT](LICENSE) © TOUFATECH
