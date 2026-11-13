#!/usr/bin/env bash
# Odin OS — téléphone et cartes ARM (arm64), sur la même base Ubuntu que le reste. Deux livrables :
#  1. odin-os-<version>-arm64-mobile-rootfs.tar.xz : la base Ubuntu + Odin, à lancer sur un téléphone Android dans Termux
#     (proot, sans « rooter » le téléphone : os/mobile/odin-os-termux.sh), ou à importer dans Docker / LXC sur une machine ARM.
#  2. odin-os-<version>-arm64-mobile.img.xz : une image disque qui démarre toute seule (UEFI) sur l'écran téléphone d'Odin OS :
#     machine virtuelle ARM, tablette ou carte qui démarre en UEFI. Un téléphone Android du commerce, lui, demande un portage
#     par modèle (noyau, chargeur de démarrage) : voir docs/odin-os.md.
# Sur un PC (amd64), la construction passe par l'émulation : paquets qemu-user-static et binfmt-support.
export ARCH=arm64
. "$(dirname "$0")/commun.sh"
racine_requise; besoin tar xz mke2fs mkfs.vfat mcopy sfdisk
"$(dirname "$0")/base.sh"
mkdir -p "$SORTIE"

dire "Base Ubuntu pour téléphone (Termux, proot)"
R="$TRAVAIL/mobile-rootfs"; rm -rf "$R"; cp -a "$BASE" "$R"; rm -f "$R/.pret"
mkdir -p "$R/etc/odin-os"; echo mobile > "$R/etc/odin-os/cible"; chown -R 1000:1000 "$R/home/odin"
F1="$SORTIE/odin-os-$VERSION_OS-arm64-mobile-rootfs.tar.xz"
tar --numeric-owner --exclude=./proc/* --exclude=./sys/* --exclude=./dev/* -C "$R" -c . | xz -T0 -6 > "$F1"
rm -rf "$R"

if [ -n "${SANS_IMAGE:-}" ]; then dire "Base pour téléphone prête"; empreinte "$F1"; exit 0; fi

dire "Système de l'image téléphone (noyau, session graphique)"
# Installer le noyau et la session graphique en émulation prend longtemps. Cette étape (les paquets seuls) est gardée
# d'une construction à l'autre tant que la base n'a pas été refaite ; REFAIRE_PAQUETS=1 pour la refaire.
P="$TRAVAIL/mobile-paquets"
if [ ! -f "$P/.paquets" ] || [ "$BASE/.pret" -nt "$P/.paquets" ] || [ -n "${REFAIRE_PAQUETS:-}${REFAIRE:-}" ]; then
  demonter "$P" 2>/dev/null || true; rm -rf "$P"; cp -a "$BASE" "$P"; rm -f "$P/.pret"
  vers_systeme "$P" mobile
  NOYAU="$(dans "$P" apt-cache depends linux-image-generic | sed -n 's/.*Depends: \(linux-image-[0-9][^ ]*-generic\)$/\1/p' | head -1)"
  [ -n "$NOYAU" ] || { echo "Noyau introuvable dans le dépôt." >&2; exit 1; }
  installer "$P" "$NOYAU" initramfs-tools udev kmod zstd systemd-resolved \
    labwc python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0 bubblewrap xdg-dbus-proxy libgl1-mesa-dri fonts-dejavu-core grub-efi-arm64-bin
  dans "$P" update-initramfs -u -k all >/dev/null 2>&1
  avec_services "$P"; demonter "$P"; touch "$P/.paquets"
else
  dire "Paquets du système déjà installés ($P) — REFAIRE_PAQUETS=1 pour les refaire"
fi
S="$TRAVAIL/mobile-systeme"; demonter "$S" 2>/dev/null || true; rm -rf "$S"; cp -a "$P" "$S"; rm -f "$S/.paquets"
# Par-dessus les paquets gardés : Odin et les fichiers du moment (la base vient d'être rafraîchie par base.sh).
rm -rf "$S/opt/odin"; cp -a "$BASE/opt/odin" "$S/opt/odin"
cp -a "$BASE/etc/os-release" "$BASE/etc/issue" "$S/etc/"
cp -a "$RACINE/os/rootfs/commun/." "$RACINE/os/rootfs/systeme/." "$RACINE/os/rootfs/ecran/." "$S/"
find "$S/usr/local/bin" "$S/usr/local/lib/odin-os" -type f -exec chmod +x {} +
monter "$S"; sans_services "$S"
echo fr > "$S/etc/odin-os/clavier"
printf 'LABEL=ODINOS  /          ext4  errors=remount-ro  0 1\nLABEL=ODINEFI /boot/efi  vfat  umask=0077         0 1\n' > "$S/etc/fstab"
mkdir -p "$S/boot/efi" "$S/boot/grub"
dans "$S" systemctl enable odin-os-ecran.service >/dev/null 2>&1
dans "$S" systemctl set-default graphical.target >/dev/null 2>&1
dans "$S" systemctl mask getty@tty1.service >/dev/null 2>&1
cat > "$S/boot/grub/grub.cfg" <<G
# Odin OS $VERSION_OS (téléphone, arm64) — menu de démarrage.
set timeout=2
set default=0
search --no-floppy --label ODINOS --set=root
menuentry "Odin OS $VERSION_OS" {
  linux /boot/vmlinuz root=LABEL=ODINOS rw quiet loglevel=3
  initrd /boot/initrd.img
}
menuentry "Odin OS $VERSION_OS (dépannage : console)" {
  linux /boot/vmlinuz root=LABEL=ODINOS rw systemd.unit=multi-user.target
  initrd /boot/initrd.img
}
G
# Le chargeur de démarrage UEFI est fabriqué avec le GRUB de l'image elle-même : l'outil et ses modules sont de la même
# version (un outil de la machine de construction avec les modules de l'image donne un chargeur qui plante au démarrage).
T="$TRAVAIL/mobile-image"; rm -rf "$T"; mkdir -p "$T"
printf 'search --no-floppy --label ODINOS --set=root\nset prefix=($root)/boot/grub\nconfigfile /boot/grub/grub.cfg\n' > "$S/tmp/demarrage.cfg"
dans "$S" grub-mkstandalone -O arm64-efi --modules="part_gpt ext2 fat normal linux search search_label configfile gzio all_video" -o /tmp/BOOTAA64.EFI "boot/grub/grub.cfg=/tmp/demarrage.cfg" >/dev/null
mv "$S/tmp/BOOTAA64.EFI" "$T/BOOTAA64.EFI"; rm -f "$S/tmp/demarrage.cfg"
sceller "$S"

dire "Image disque (UEFI)"
# Sans périphérique « loop » : chaque partition est fabriquée dans un fichier, puis posée à sa place dans l'image.
truncate -s 200M "$T/efi.fat"; mkfs.vfat -n ODINEFI "$T/efi.fat" >/dev/null
mmd -i "$T/efi.fat" ::/EFI ::/EFI/BOOT; mcopy -i "$T/efi.fat" "$T/BOOTAA64.EFI" ::/EFI/BOOT/BOOTAA64.EFI
truncate -s 3890M "$T/systeme.ext4"; mke2fs -q -t ext4 -L ODINOS -d "$S" "$T/systeme.ext4"
IMG="$T/odin-os-$VERSION_OS-arm64-mobile.img"
truncate -s 4096M "$IMG"
sfdisk --quiet "$IMG" <<P
label: gpt
start=1MiB, size=200MiB, type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B, name=efi
start=201MiB, size=3890MiB, type=0FC63DAF-8483-4772-8E79-3D69D8477DE4, name=odin-os
P
dd if="$T/efi.fat" of="$IMG" bs=1M seek=1 conv=notrunc,sparse status=none
dd if="$T/systeme.ext4" of="$IMG" bs=1M seek=201 conv=notrunc,sparse status=none
rm -f "$T/efi.fat" "$T/systeme.ext4"
# Copie non compressée gardée pour le test dans QEMU (os/build/tester.sh).
mkdir -p "$TRAVAIL/essai-mobile"; cp --sparse=always "$IMG" "$TRAVAIL/essai-mobile/mobile.img"
F2="$SORTIE/$(basename "$IMG").xz"
xz -T0 -6 -c "$IMG" > "$F2"
rm -rf "$T" "$S"
dire "Images pour téléphone prêtes"
empreinte "$F1"; empreinte "$F2"
