#!/usr/bin/env bash
# Odin OS — réglages et fonctions communs aux scripts de construction des images.
# Chaque script se lance en root sur une machine Linux (Ubuntu ou Debian) : sudo os/build/images.sh
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"        # racine du dépôt Odin
VERSION_OS="${VERSION_OS:-$(sed -n 's/.*VERSION_OS = .\([0-9.]*\).*/\1/p' "$RACINE/src/os/version.ts")}"
SUITE="${SUITE:-resolute}"                                           # base : Ubuntu 26.04 LTS
ARCH="${ARCH:-amd64}"                                                # amd64 (PC) ou arm64 (téléphone, Raspberry Pi, serveurs ARM)
# Dépôt Ubuntu écrit dans les images. Les processeurs ARM ont leur propre dépôt (« ports »).
if [ "$ARCH" = amd64 ]; then MIROIR_IMAGE="http://archive.ubuntu.com/ubuntu"; SECU_IMAGE="http://security.ubuntu.com/ubuntu"; else MIROIR_IMAGE="http://ports.ubuntu.com/ubuntu-ports"; SECU_IMAGE="$MIROIR_IMAGE"; fi
# Dépôt utilisé pendant la construction : le même, ou une copie locale (MIROIR=file:///chemin) quand la machine n'a pas
# accès au dépôt. Une copie locale est une seule suite déjà vérifiée par celui qui l'a faite : elle n'est pas re-signée.
MIROIR="${MIROIR:-$MIROIR_IMAGE}"
TRAVAIL="${TRAVAIL:-/var/tmp/odin-os}"                               # dossier de travail (plusieurs Go)
SORTIE="${SORTIE:-$RACINE/os/sortie}"                                # images produites
DEPOT_LOCAL=/mnt/odin-depot                                          # où une copie locale du dépôt (MIROIR=file://…) apparaît pendant la construction
BASE="$TRAVAIL/base-$ARCH"
FUSEAU="${FUSEAU:-Indian/Mayotte}"                               # fuseau horaire par défaut des images

dire() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
besoin() { for c in "$@"; do command -v "$c" >/dev/null || { echo "Il manque « $c ». Installe-le puis relance (voir docs/odin-os.md)." >&2; exit 1; }; done; }
racine_requise() { [ "$(id -u)" = 0 ] || { echo "À lancer en root (sudo)." >&2; exit 1; }; }

# Commande lancée dans un système en construction (chroot), sans rien hériter de la machine hôte.
dans() { local r="$1"; shift; chroot "$r" /usr/bin/env -i HOME=/root TERM=dumb LANG=C.UTF-8 PATH=/usr/sbin:/usr/bin:/sbin:/bin DEBIAN_FRONTEND=noninteractive "$@"; }
monter() {
  local r="$1"; mountpoint -q "$r/proc" || mount -t proc proc "$r/proc"; mountpoint -q "$r/sys" || mount -t sysfs sys "$r/sys"; mountpoint -q "$r/dev" || mount --bind /dev "$r/dev"; mountpoint -q "$r/dev/pts" || mount -t devpts devpts "$r/dev/pts" 2>/dev/null || true
  # Copie locale du dépôt : montée en lecture seule dans le système en construction, à l'écart des dossiers que l'on nettoie.
  case "$MIROIR" in file://*) local d="$r$DEPOT_LOCAL"; mkdir -p "$d"; mountpoint -q "$d" || { mount --bind "${MIROIR#file://}" "$d"; mount -o remount,bind,ro "$d"; };; esac
}
demonter() {
  local r="$1" d="$1$DEPOT_LOCAL" m
  if mountpoint -q "$d" 2>/dev/null; then umount -l "$d"; fi; [ -d "$d" ] && rmdir "$d" 2>/dev/null || true
  for m in dev/pts dev sys proc; do mountpoint -q "$r/$m" && umount -l "$r/$m" || true; done
}
# Dépôts du système en construction : `depots <racine> construction` (dépôt de travail) ou `depots <racine> image` (dépôts publics, pour l'image livrée).
depots() {
  local r="$1" m="$MIROIR" s="$MIROIR"; [ "$2" = image ] && { m="$MIROIR_IMAGE"; s="$SECU_IMAGE"; }; [ "$2" != image ] && [ "$MIROIR" = "$MIROIR_IMAGE" ] && s="$SECU_IMAGE"
  case "$2:$MIROIR" in construction:file://*) printf 'deb [trusted=yes] file://%s %s main universe\n' "$DEPOT_LOCAL" "$SUITE" > "$r/etc/apt/sources.list"; rm -f "$r"/etc/apt/sources.list.d/*; return;; esac
  printf 'deb %s %s main universe\ndeb %s %s-updates main universe\ndeb %s %s-security main universe\n' "$m" "$SUITE" "$m" "$SUITE" "$s" "$SUITE" > "$r/etc/apt/sources.list"; rm -f "$r"/etc/apt/sources.list.d/*
}
# Pas de démarrage de services pendant l'installation des paquets.
sans_services() { printf '#!/bin/sh\nexit 101\n' > "$1/usr/sbin/policy-rc.d"; chmod +x "$1/usr/sbin/policy-rc.d"; }
avec_services() { rm -f "$1/usr/sbin/policy-rc.d"; }
installer() { local r="$1"; shift; dans "$r" apt-get install -y -qq --no-install-recommends "$@" >/dev/null; }
nettoyer() {
  local r="$1" m
  dans "$r" apt-get clean
  # Garde-fou : on n'efface rien à travers un montage resté dans un dossier temporaire.
  for m in tmp var/tmp; do if grep -q " $(readlink -f "$r/$m")/" /proc/mounts; then echo "Un montage est resté dans $r/$m : nettoyage refusé." >&2; return 1; fi; done
  rm -rf "$r"/var/lib/apt/lists/* "$r"/var/cache/apt/*.bin "$r"/tmp/* "$r"/var/tmp/* "$r"/var/log/*.log "$r"/var/log/apt/* "$r"/root/.cache; : > "$r/etc/machine-id"; }

# Fait d'une copie de la base un système complet, démarré par systemd (images LXC, WSL, PC, téléphone) :
# `vers_systeme <racine> <cible> [paquets en plus…]`, puis les ajouts propres à l'image, puis `sceller <racine>`.
vers_systeme() {
  local r="$1" c="$2"; shift 2
  rm -f "$r/.pret"; mkdir -p "$r/etc/odin-os"; echo "$c" > "$r/etc/odin-os/cible"
  monter "$r"; sans_services "$r"; depots "$r" construction
  cp --remove-destination /etc/resolv.conf "$r/etc/resolv.conf" 2>/dev/null || true
  dans "$r" apt-get update -qq
  installer "$r" systemd-sysv dbus libpam-systemd netbase iputils-ping less nano "$@"
  cp -a "$RACINE/os/rootfs/systeme/." "$r/"
  dans "$r" systemctl enable odin.service systemd-networkd.service >/dev/null 2>&1
}
# Dernière étape d'une image système : résolution des noms (installée en dernier, car elle remplace /etc/resolv.conf), ménage, démontage.
sceller() {
  local r="$1"
  installer "$r" systemd-resolved
  dans "$r" systemctl enable systemd-resolved.service >/dev/null 2>&1 || true
  ln -sf ../run/systemd/resolve/stub-resolv.conf "$r/etc/resolv.conf"
  chown -R 1000:1000 "$r/home/odin"
  depots "$r" image; avec_services "$r"; nettoyer "$r"; demonter "$r"
}

# Node.js : le binaire officiel de nodejs.org (empreinte vérifiée). Celui d'Ubuntu ne convient pas : il est compilé sans
# la lecture directe du TypeScript, dont Odin a besoin. NODE_BINAIRE=/chemin/node : utiliser un binaire officiel déjà téléchargé.
NODE_VERSION="${NODE_VERSION:-22.23.4}"
NODE_SHA256_x64="1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce"     # node-v22.23.4-linux-x64.tar.xz
NODE_SHA256_arm64="6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b"   # node-v22.23.4-linux-arm64.tar.xz
installer_node() {
  local r="$1" a=x64 f somme; [ "$ARCH" = arm64 ] && a=arm64
  mkdir -p "$r/opt/node/bin"
  if [ -n "${NODE_BINAIRE:-}" ]; then install -m 755 "$NODE_BINAIRE" "$r/opt/node/bin/node"
  else
    besoin curl xz; f="node-v$NODE_VERSION-linux-$a.tar.xz"; somme="NODE_SHA256_$a"
    [ -f "$TRAVAIL/$f" ] || curl -fsSL -o "$TRAVAIL/$f" "https://nodejs.org/dist/v$NODE_VERSION/$f"
    echo "${!somme}  $TRAVAIL/$f" | sha256sum -c --quiet - || { echo "Empreinte de $f inattendue : téléchargement refusé." >&2; rm -f "$TRAVAIL/$f"; exit 1; }
    tar -xJf "$TRAVAIL/$f" -C "$r/opt/node" --strip-components=1 "node-v$NODE_VERSION-linux-$a/bin/node" "node-v$NODE_VERSION-linux-$a/LICENSE"
  fi
  ln -sf /opt/node/bin/node "$r/usr/local/bin/node"
}

# Taille lisible et empreinte SHA-256 d'une image ; le fichier SHA256SUMS garde une ligne par image, toujours à jour.
empreinte() {
  local f="$1" h t n; n="$(basename "$f")"
  h="$(sha256sum "$f" | cut -d' ' -f1)"; t="$(stat -c %s "$f")"
  touch "$SORTIE/SHA256SUMS"; { grep -v "  $n\$" "$SORTIE/SHA256SUMS" || true; printf '%s  %s\n' "$h" "$n"; } | sort -k2 > "$SORTIE/.sommes"; mv "$SORTIE/.sommes" "$SORTIE/SHA256SUMS"
  printf '%-48s %11s octets (%s)\n  SHA-256 : %s\n' "$n" "$t" "$(numfmt --to=iec-i --suffix=o "$t")" "$h"
}
