# ᛟ Odin OS

**Odin OS est un projet distinct de l'application Odin.** L'application Odin (agent IA, applis, interface) est
présentée dans le [README](README.md). Ce document présente le système d'exploitation.

| | Application Odin | Odin OS |
|---|---|---|
| Ce que c'est | l'agent IA et ses applis, qui tournent sur un ordinateur existant (macOS, Linux, Windows) | le système d'exploitation d'Odin : un système complet dont le bureau est servi par Odin |
| Où est le code | branche `main` | branche [`odin-os`](https://github.com/TOUFATECH/Odin/tree/odin-os) |
| Version | voir `package.json` | 0.1.0 (Valaskjálf) |
| Guide | [README](README.md) | `docs/odin-os.md` sur la branche `odin-os` |

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

## Organisation du code (branche `odin-os`)

```
src/os/                              côté Odin : bureau servi sur /os/, API /api/os/…, commande « odin os »
src/os/shell/                        le bureau (JavaScript sans dépendance)
src/valhalla/modules/valaskjalf.ts   l'appli Odin OS dans Odin
os/build/                            construction des images (Docker, LXC, WSL, ISO, téléphone)
os/rootfs/                           fichiers ajoutés aux images (service Odin, session graphique, installeur)
os/android/, os/windows/, os/mobile/, os/docker/   lanceurs et scripts d'installation
```

## Licence

[MIT](LICENSE) © TOUFATECH
