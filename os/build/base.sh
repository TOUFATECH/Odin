#!/usr/bin/env bash
# Odin OS — système de base : Ubuntu minimal + Node.js officiel + Odin (services et bureau).
# Sert de point de départ à toutes les images (Docker, LXC, WSL, ISO, téléphone).
# ARCH=arm64 os/build/base.sh construit la base pour téléphone et cartes ARM (émulation : paquet qemu-user-static).
. "$(dirname "$0")/commun.sh"
racine_requise; besoin debootstrap chroot

if [ -f "$BASE/.pret" ] && [ -z "${REFAIRE:-}" ]; then dire "Base déjà construite ($BASE) — REFAIRE=1 pour la reconstruire"; else
  dire "Base Ubuntu $SUITE ($ARCH) dans $BASE"
  demonter "$BASE" 2>/dev/null || true; rm -rf "$BASE"; mkdir -p "$BASE"
  [ -e "/usr/share/debootstrap/scripts/$SUITE" ] || ln -s gutsy "/usr/share/debootstrap/scripts/$SUITE"
  case "$MIROIR" in file://*) SIGNATURE=--no-check-gpg;; *) SIGNATURE=;; esac
  debootstrap $SIGNATURE --variant=minbase --arch="$ARCH" --components=main,universe \
    --include=ca-certificates,sudo,iproute2,procps,tzdata \
    "$SUITE" "$BASE" "$MIROIR" > "$TRAVAIL/base-$ARCH.log" 2>&1 || { tail -20 "$TRAVAIL/base-$ARCH.log"; exit 1; }

  # Dépôts : paquets, mises à jour et correctifs de sécurité.
  depots "$BASE" construction
  # Système léger : ni documentation, ni pages de manuel, ni traductions inutiles, ni paquets « recommandés ».
  cat > "$BASE/etc/dpkg/dpkg.cfg.d/odin-leger" <<S
path-exclude=/usr/share/doc/*
path-include=/usr/share/doc/*/copyright
path-exclude=/usr/share/man/*
path-exclude=/usr/share/info/*
path-exclude=/usr/share/locale/*
path-include=/usr/share/locale/fr/*
path-include=/usr/share/locale/locale.alias
S
  printf 'APT::Install-Recommends "false";\nAPT::Install-Suggests "false";\nAcquire::Languages "none";\n' > "$BASE/etc/apt/apt.conf.d/90odin"
  monter "$BASE"; sans_services "$BASE"
  dans "$BASE" apt-get update -qq
  dans "$BASE" apt-get -y -qq dist-upgrade >/dev/null
  rm -rf "$BASE"/usr/share/doc/*/[!c]* "$BASE"/usr/share/man/* "$BASE"/usr/share/info/*
  find "$BASE/usr/share/locale" -mindepth 1 -maxdepth 1 ! -name fr ! -name locale.alias -exec rm -rf {} + 2>/dev/null || true

  # Compte « odin » : celui qui fait tourner Odin et ouvre la session.
  dans "$BASE" useradd -m -u 1000 -s /bin/bash -c "Odin" odin
  printf 'odin ALL=(ALL:ALL) NOPASSWD: ALL\n' > "$BASE/etc/sudoers.d/odin"; chmod 0440 "$BASE/etc/sudoers.d/odin"
  ln -sf "/usr/share/zoneinfo/$FUSEAU" "$BASE/etc/localtime"; echo "$FUSEAU" > "$BASE/etc/timezone"
  avec_services "$BASE"; demonter "$BASE"
  installer_node "$BASE"
  touch "$BASE/.pret"
fi

dire "Odin $(sed -n 's/.*"version": "\(.*\)".*/\1/p' "$RACINE/package.json") et bureau Odin OS $VERSION_OS dans la base"
rm -rf "$BASE/opt/odin"; mkdir -p "$BASE/opt/odin"
( cd "$RACINE" && git ls-files -z package.json LICENSE bin src | tar --null -T - -cf - ) | tar -C "$BASE/opt/odin" -xf -
cp -a "$RACINE/os/rootfs/commun/." "$BASE/"
find "$BASE/usr/local/bin" "$BASE/usr/local/lib/odin-os" -type f -exec chmod +x {} +
cat > "$BASE/etc/os-release" <<S
NAME="Odin OS"
VERSION="$VERSION_OS"
ID=odin-os
ID_LIKE="ubuntu debian"
PRETTY_NAME="Odin OS $VERSION_OS"
VERSION_ID="$VERSION_OS"
VERSION_CODENAME=$SUITE
UBUNTU_CODENAME=$SUITE
HOME_URL="https://github.com/TOUFATECH/Odin"
S
# Les dossiers temporaires existent toujours, ouverts à tous avec le « sticky bit » (comme sur tout Linux).
install -d -m 1777 "$BASE/tmp" "$BASE/var/tmp"
echo "odin-os" > "$BASE/etc/hostname"; printf '127.0.0.1 localhost\n127.0.1.1 odin-os\n' > "$BASE/etc/hosts"
printf 'Odin OS %s \\n \\l\n\n' "$VERSION_OS" > "$BASE/etc/issue"
depots "$BASE" image
nettoyer "$BASE" 2>/dev/null || { monter "$BASE"; nettoyer "$BASE"; demonter "$BASE"; }
dire "Base prête : $(du -sh --exclude=proc --exclude=sys --exclude=dev "$BASE" | cut -f1)"
