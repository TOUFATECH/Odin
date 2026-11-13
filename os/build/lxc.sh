#!/usr/bin/env bash
# Odin OS — modèle de conteneur LXC (Proxmox ou LXC classique) : la base + systemd + Odin en service.
# Produit os/sortie/odin-os-<version>-<arch>-lxc.tar.xz (le système) et …-lxc-meta.tar.xz (réglages pour lxc-create).
#   Proxmox : copier le .tar.xz dans /var/lib/vz/template/cache/ puis créer le conteneur (ou « odin os installer --lxc »).
#   LXC     : lxc-create -n odin-os -t local -- --fstree …-lxc.tar.xz --metadata …-lxc-meta.tar.xz
. "$(dirname "$0")/commun.sh"
racine_requise; besoin tar xz
"$(dirname "$0")/base.sh"

dire "Modèle LXC ($ARCH)"
R="$TRAVAIL/lxc-$ARCH"; demonter "$R" 2>/dev/null || true; rm -rf "$R"; cp -a "$BASE" "$R"
vers_systeme "$R" lxc
# Dans un conteneur : pas de noyau ni de matériel à gérer ; la console du conteneur donne une invite de connexion.
dans "$R" systemctl mask systemd-udevd.service systemd-udevd-kernel.socket systemd-udevd-control.socket sys-kernel-config.mount sys-kernel-debug.mount >/dev/null 2>&1 || true
sceller "$R"
mkdir -p "$SORTIE"
F="$SORTIE/odin-os-$VERSION_OS-$ARCH-lxc.tar.xz"
tar --numeric-owner --xattrs --exclude=./proc/* --exclude=./sys/* --exclude=./dev/* -C "$R" -c . | xz -T0 -6 > "$F"
# Réglages LXC (pour « lxc-create -t local ») : ceux d'une Ubuntu, en 64 bits.
M="$TRAVAIL/lxc-meta-$ARCH"; rm -rf "$M"; mkdir -p "$M"
[ "$ARCH" = arm64 ] && LA=aarch64 || LA=x86_64
printf 'lxc.include = /usr/share/lxc/config/common.conf\nlxc.arch = %s\n' "$LA" > "$M/config"
printf 'lxc.include = /usr/share/lxc/config/common.conf\nlxc.include = /usr/share/lxc/config/userns.conf\nlxc.arch = %s\n' "$LA" > "$M/config-user"
: > "$M/excludes-user"; printf '/etc/hostname\n/etc/hosts\n' > "$M/templates"; printf 'Odin OS %s : ouvre https://ADRESSE:7777/os/ (adresse : lxc-info -n NOM -iH).\n' "$VERSION_OS" > "$M/create-message"
tar -C "$M" -cJf "${F%.tar.xz}-meta.tar.xz" .
rm -rf "$R" "$M"
dire "Modèle LXC prêt"
empreinte "$F"; empreinte "${F%.tar.xz}-meta.tar.xz"
