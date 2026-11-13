#!/usr/bin/env bash
# Odin OS — essai des images dans QEMU, sans écran : la machine démarre, on attend, on prend des captures d'écran.
#   os/build/tester.sh iso [secondes]      l'ISO pour PC, démarrée par son propre menu (BIOS)
#   os/build/tester.sh iso-noyau [s]       la même, noyau lancé directement : le journal de démarrage arrive dans serie.log
#   os/build/tester.sh iso-uefi [s]        l'ISO démarrée en UEFI (paquet ovmf)
#   os/build/tester.sh mobile [s]          l'image téléphone arm64 (UEFI, écran 540 × 960)
# Les captures (ecran-NNN.png) et le journal sont dans $TRAVAIL/essai-<nom>/. Avec /dev/kvm, c'est bien plus rapide.
. "$(dirname "$0")/commun.sh"
QUOI="${1:-iso}"; DUREE="${2:-600}"; PORT=$((4400 + RANDOM % 400))
ISO="${ISO:-$(ls "$SORTIE"/odin-os-*-amd64.iso 2>/dev/null | sort | tail -1)}"
D="$TRAVAIL/essai-${QUOI%%-*}"; mkdir -p "$D"; rm -f "$D"/ecran-*.p?m "$D"/ecran-*.png "$D/serie.log"
KVM=""; [ -w /dev/kvm ] && KVM="-enable-kvm -cpu host"
COMMUN="-display none -monitor tcp:127.0.0.1:$PORT,server,nowait -serial file:$D/serie.log -daemonize -pidfile $D/qemu.pid"
case "$QUOI" in
  iso)       besoin qemu-system-x86_64; qemu-system-x86_64 $KVM -m 2048 -smp 2 -vga std -cdrom "$ISO" -boot d -nic user,model=virtio-net-pci $COMMUN ;;
  iso-noyau) besoin qemu-system-x86_64; qemu-system-x86_64 $KVM -m 2048 -smp 2 -vga std -cdrom "$ISO" -kernel "$D/vmlinuz" -initrd "$D/initrd" -append "boot=live console=tty0 console=ttyS0 loglevel=4 ${AJOUT:-}" ${DISQUE:+-drive if=virtio,format=raw,file=$DISQUE} -nic user,model=virtio-net-pci $COMMUN ;;
  iso-uefi)  besoin qemu-system-x86_64; qemu-system-x86_64 $KVM -m 2048 -smp 2 -vga std -bios /usr/share/ovmf/OVMF.fd -cdrom "$ISO" -nic user,model=virtio-net-pci $COMMUN ;;
  disque)    besoin qemu-system-x86_64; qemu-system-x86_64 $KVM -m 2048 -smp 2 -vga std -drive if=virtio,format=raw,file="$DISQUE" -nic user,model=virtio-net-pci $COMMUN ;;
  mobile)    besoin qemu-system-aarch64; qemu-system-aarch64 -M virt -cpu cortex-a72 -smp 2 -m 2048 -bios /usr/share/qemu-efi-aarch64/QEMU_EFI.fd -drive if=virtio,format=raw,file="$D/mobile.img" -device virtio-gpu-pci,xres=540,yres=960 -device qemu-xhci -device usb-kbd -device usb-tablet -nic user,model=virtio-net-pci $COMMUN ;;
  *) echo "Usage : tester.sh iso|iso-noyau|iso-uefi|mobile [secondes]"; exit 1 ;;
esac
moniteur() { exec 3<>"/dev/tcp/127.0.0.1/$PORT"; printf '%s\n' "$1" >&3; sleep 1; exec 3<&-; exec 3>&-; }
n=0; fin=$((SECONDS + DUREE))
while [ $SECONDS -lt $fin ] && kill -0 "$(cat "$D/qemu.pid")" 2>/dev/null; do
  sleep "${PAS:-30}"; n=$((n + 1)); f="$D/ecran-$(printf '%03d' $n)"
  moniteur "screendump $f.ppm" || true; sleep 1
  [ -s "$f.ppm" ] && command -v convert >/dev/null && convert "$f.ppm" "$f.png" 2>/dev/null && rm -f "$f.ppm"
done
[ -n "${GARDER:-}" ] || { moniteur quit 2>/dev/null || kill "$(cat "$D/qemu.pid")" 2>/dev/null || true; }
echo "Captures : $(ls "$D"/ecran-* 2>/dev/null | wc -l) dans $D (port du moniteur : $PORT)"
