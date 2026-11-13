#!/usr/bin/env bash
# Odin OS — paquet pour Windows (WSL 2) : la même base Ubuntu, démarrée par systemd, dans Windows.
# Produit os/sortie/odin-os-<version>-amd64.wsl. Sous Windows : double-clic (WSL récent), ou os/windows/Installer-OdinOS.ps1.
. "$(dirname "$0")/commun.sh"
racine_requise; besoin tar gzip
"$(dirname "$0")/base.sh"

dire "Paquet WSL ($ARCH)"
R="$TRAVAIL/wsl-$ARCH"; demonter "$R" 2>/dev/null || true; rm -rf "$R"; cp -a "$BASE" "$R"
vers_systeme "$R" wsl
# Windows gère le réseau et la résolution des noms du sous-système : systemd ne s'en occupe pas ici.
dans "$R" systemctl disable systemd-networkd.service >/dev/null 2>&1 || true
dans "$R" systemctl mask systemd-networkd-wait-online.service systemd-udevd.service systemd-udevd-kernel.socket systemd-udevd-control.socket >/dev/null 2>&1 || true
cat > "$R/etc/wsl.conf" <<S
# Odin OS dans Windows : systemd démarre Odin, la session s'ouvre avec le compte « odin ».
[boot]
systemd=true

[user]
default=odin

[network]
hostname=odin-os
generateResolvConf=true
S
cat > "$R/etc/wsl-distribution.conf" <<S
# Présentation d'Odin OS dans Windows (WSL 2.4.4 ou plus récent).
[oobe]
defaultUid = 1000
defaultName = OdinOS

[shortcut]
enabled = true
S
# Pas de systemd-resolved ici (Windows écrit /etc/resolv.conf) : ménage et démontage à la main.
rm -f "$R/etc/resolv.conf"; chown -R 1000:1000 "$R/home/odin"
depots "$R" image; avec_services "$R"; nettoyer "$R"; demonter "$R"
mkdir -p "$SORTIE"
F="$SORTIE/odin-os-$VERSION_OS-$ARCH.wsl"
tar --numeric-owner --xattrs --exclude=./proc/* --exclude=./sys/* --exclude=./dev/* -C "$R" -c . | gzip -9 > "$F"
rm -rf "$R"
dire "Paquet WSL prêt"
empreinte "$F"
