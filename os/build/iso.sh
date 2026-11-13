#!/usr/bin/env bash
# Odin OS — image ISO pour PC et machines virtuelles (64 bits, BIOS et UEFI).
# On démarre dessus sans rien installer (session d'essai, en mémoire) ; Odin Setup propose ensuite l'installation sur le disque.
# Produit os/sortie/odin-os-<version>-amd64.iso
. "$(dirname "$0")/commun.sh"
racine_requise; besoin mksquashfs grub-mkrescue xorriso
[ "$ARCH" = amd64 ] || { echo "L'ISO est pour PC (amd64). Pour ARM : os/build/mobile.sh"; exit 1; }
"$(dirname "$0")/base.sh"

dire "Système de l'image PC"
R="$TRAVAIL/pc-$ARCH"; demonter "$R" 2>/dev/null || true; rm -rf "$R"; cp -a "$BASE" "$R"
vers_systeme "$R" pc
# Le noyau d'Ubuntu, sans le gros paquet de micrologiciels (plusieurs centaines de Mo) : une machine virtuelle n'en a pas besoin.
# Sur un vrai PC, le Wi-Fi ou certaines cartes en ont besoin : « sudo apt install linux-firmware » une fois installé.
NOYAU="$(dans "$R" apt-cache depends linux-image-generic | sed -n 's/.*Depends: \(linux-image-[0-9][^ ]*-generic\)$/\1/p' | head -1)"
[ -n "$NOYAU" ] || { echo "Noyau introuvable dans le dépôt." >&2; exit 1; }
dire "Noyau $NOYAU, session graphique et outils d'installation"
installer "$R" "$NOYAU" initramfs-tools live-boot udev kmod zstd \
  labwc python3-gi gir1.2-gtk-4.0 gir1.2-webkit-6.0 bubblewrap xdg-dbus-proxy libgl1-mesa-dri fonts-dejavu-core \
  fdisk dosfstools squashfs-tools grub-pc-bin grub-efi-amd64-bin grub2-common
cp -a "$RACINE/os/rootfs/ecran/." "$RACINE/os/rootfs/pc/." "$R/"
find "$R/usr/local/bin" "$R/usr/local/sbin" "$R/usr/local/lib/odin-os" -type f -exec chmod +x {} +
echo fr > "$R/etc/odin-os/clavier"
dans "$R" systemctl enable odin-os-ecran.service >/dev/null 2>&1
dans "$R" systemctl set-default graphical.target >/dev/null 2>&1
dans "$R" systemctl mask getty@tty1.service >/dev/null 2>&1
dans "$R" update-initramfs -u -k all >/dev/null 2>&1
sceller "$R"

dire "Image ISO"
I="$TRAVAIL/iso-$ARCH"; rm -rf "$I"; mkdir -p "$I/live" "$I/boot/grub"
cp "$(ls "$R"/boot/vmlinuz-* | sort -V | tail -1)" "$I/live/vmlinuz"
cp "$(ls "$R"/boot/initrd.img-* | sort -V | tail -1)" "$I/live/initrd"
mksquashfs "$R" "$I/live/filesystem.squashfs" -comp zstd -Xcompression-level "${COMPRESSION:-19}" -b 1M -noappend -quiet -no-progress -e proc/* sys/* dev/* run/* tmp/*
cat > "$I/boot/grub/grub.cfg" <<G
# Odin OS $VERSION_OS — menu de démarrage de l'image.
set timeout=4
set default=0
insmod all_video
insmod gfxterm
terminal_output gfxterm
menuentry "Odin OS $VERSION_OS" {
  linux /live/vmlinuz boot=live quiet loglevel=3
  initrd /live/initrd
}
menuentry "Odin OS $VERSION_OS (affichage sûr)" {
  linux /live/vmlinuz boot=live nomodeset
  initrd /live/initrd
}
menuentry "Odin OS $VERSION_OS (dépannage : console)" {
  linux /live/vmlinuz boot=live systemd.unit=multi-user.target
  initrd /live/initrd
}
G
mkdir -p "$SORTIE"
F="$SORTIE/odin-os-$VERSION_OS-$ARCH.iso"
grub-mkrescue -o "$F" "$I" -- -volid ODINOS >/dev/null 2>&1
# Noyau et disque mémoire gardés à côté : ils servent au test automatique dans QEMU (os/build/tester.sh).
mkdir -p "$TRAVAIL/essai-iso"; cp "$I/live/vmlinuz" "$I/live/initrd" "$TRAVAIL/essai-iso/"
rm -rf "$I" "$R"
dire "Image ISO prête"
empreinte "$F"
