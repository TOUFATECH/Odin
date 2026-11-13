#!/data/data/com.termux/files/usr/bin/sh
# Odin OS sur téléphone Android — installe et lance la base Ubuntu d'Odin OS (arm64) dans Termux, avec proot :
# pas besoin de « rooter » le téléphone, rien n'est modifié dans Android.
#   sh odin-os-termux.sh installer /sdcard/Download/odin-os-0.1.0-arm64-mobile-rootfs.tar.xz
#   sh odin-os-termux.sh demarrer      (puis ouvre Odin Launcher, ou http://127.0.0.1:7777/os/ dans le navigateur)
#   sh odin-os-termux.sh arreter | retirer
set -e
D="$HOME/odin-os"
case "${1:-}" in
  installer)
    A="${2:?Donne le chemin de odin-os-…-arm64-mobile-rootfs.tar.xz}"
    [ -f "$A" ] || { echo "Fichier introuvable : $A (autorise d'abord le stockage : termux-setup-storage)"; exit 1; }
    pkg install -y proot tar xz-utils >/dev/null
    [ ! -d "$D" ] || { echo "Odin OS est déjà installé ($D). Pour recommencer : sh $0 retirer"; exit 1; }
    mkdir -p "$D"
    echo "Je déplie Odin OS (une à deux minutes)…"
    proot --link2symlink tar -xJf "$A" -C "$D" --exclude='./dev/*' 2>/dev/null || true
    [ -x "$D/usr/local/bin/odin-os-demarrer" ] || { echo "L'archive n'a pas pu être dépliée."; rm -rf "$D"; exit 1; }
    printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "$D/etc/resolv.conf"
    echo "Odin OS est installé. Lance-le : sh $0 demarrer"
    ;;
  demarrer)
    [ -d "$D" ] || { echo "Odin OS n'est pas installé : sh $0 installer FICHIER"; exit 1; }
    unset LD_PRELOAD
    command -v termux-wake-lock >/dev/null && termux-wake-lock || true
    echo "Odin OS démarre. Ouvre Odin Launcher, ou http://127.0.0.1:7777/os/ dans le navigateur. (Ctrl+C pour arrêter.)"
    exec proot --kill-on-exit --link2symlink -0 -r "$D" -b /dev -b /proc -b /sys -b "$D/tmp:/dev/shm" -w /home/odin \
      /usr/bin/env -i HOME=/home/odin USER=odin TERM="${TERM:-xterm}" LANG=C.UTF-8 \
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin ODIN_OS=1 ODIN_OS_CIBLE=mobile \
      /usr/local/bin/odin-os-demarrer
    ;;
  arreter) pkill -f odin-os-demarrer 2>/dev/null || pkill -f 'odin.mjs web' 2>/dev/null || true; command -v termux-wake-unlock >/dev/null && termux-wake-unlock || true; echo "Odin OS est arrêté." ;;
  retirer) chmod -R u+rwX "$D" 2>/dev/null || true; rm -rf "$D"; echo "Odin OS est retiré de Termux." ;;
  *) echo "Usage : sh $0 installer FICHIER | demarrer | arreter | retirer" ;;
esac
