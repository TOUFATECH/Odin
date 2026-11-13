#!/usr/bin/env bash
# Odin OS — construit les images et affiche, pour chacune, sa taille et son empreinte SHA-256.
#   sudo os/build/images.sh                 toutes : docker lxc wsl iso apk mobile
#   sudo os/build/images.sh docker iso      seulement celles-ci
# Machine de construction : Ubuntu ou Debian récent, en root. Paquets : debootstrap docker.io xz-utils zstd squashfs-tools
# xorriso grub-pc-bin grub-efi-amd64-bin grub-common mtools dosfstools fdisk e2fsprogs curl ; pour l'APK : aapt apksigner
# zipalign dalvik-exchange libandroid-23-java default-jdk-headless ; pour le téléphone (arm64) : qemu-user-static binfmt-support.
. "$(dirname "$0")/commun.sh"
racine_requise
CIBLES="${*:-docker lxc wsl iso apk mobile}"
for c in $CIBLES; do
  [ -x "$(dirname "$0")/$c.sh" ] || { echo "Image inconnue : $c (docker, lxc, wsl, iso, apk, mobile)" >&2; exit 1; }
  # L'image téléphone se construit pour arm64 ; les autres pour l'architecture demandée (amd64 par défaut).
  "$(dirname "$0")/$c.sh"
done
dire "Images d'Odin OS $VERSION_OS ($SORTIE)"
( cd "$SORTIE" && while read -r h n; do [ -f "$n" ] && printf '%-48s %11s octets (%s)\n  SHA-256 : %s\n' "$n" "$(stat -c %s "$n")" "$(numfmt --to=iec-i --suffix=o "$(stat -c %s "$n")")" "$h"; done < SHA256SUMS )
