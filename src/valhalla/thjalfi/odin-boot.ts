// Genèse · clé USB — « odin-boot » : notre outil, à la place de vtoyboot, pour qu'un disque virtuel Linux
// démarre depuis la clé. Le principe (compris d'après la documentation publique de Ventoy et le dépôt
// ventoy/vtoyboot — référence ci-dessous, SANS recopier son code, qui est sous licence GPLv3) : un disque
// virtuel posé sur la clé n'est pas le disque de démarrage réel du PC ; l'initramfs du système, au tout début,
// doit donc retrouver le fichier image sur la clé, le « monter en boucle » et faire de CE disque la racine.
// odin-boot ajoute ce petit crochet à l'initramfs, une seule fois, dans la machine.
//
//   Référence (principe seulement, pas le code) : https://github.com/ventoy/vtoyboot
//
// Deux familles de générateurs d'initramfs sont couvertes :
//   - initramfs-tools (Debian, Ubuntu) : un « hook » (copie les outils) + un « script local-top » (monte le disque) ;
//   - dracut (Fedora, Rocky, Alma, openSUSE) : un module dracut avec son module-setup.sh et son hook ;
//   - mkinitcpio (Arch) : un « hook » mkinitcpio quand c'est raisonnable ; sinon, odin-boot le dit clairement.
// Le tout est généré ici en PUR (des chaînes de caractères). Le lancement réel (dans une VM ou sur un disque
// éteint) passe par une orchestration injectable, pour que les essais ne touchent jamais un vrai disque.

const ENTETE = '# Généré par Odin (odin-boot) — fait démarrer ce système depuis un disque virtuel posé sur la clé ODIN.\n';

/** Le nom de l'étiquette de la partition de la clé où sont les disques (1re partition Ventoy = ODIN). */
export const LABEL_CLE = 'ODIN';

/** Le script principal odin-boot, à lancer UNE FOIS dans le système invité (ou qu'Odin lance pour toi).
 *  Il détecte le générateur d'initramfs présent, pose les crochets, et reconstruit l'initramfs. Pur. */
export function scriptOdinBoot(): string {
  // Les corps des crochets sont INLINÉS ici, en ici-documents sh (délimiteur entre apostrophes = aucune
  // substitution du shell) : le script posé sur la clé est autonome, sans variable d'environnement à définir.
  return `#!/bin/sh
${ENTETE}# Lance-moi en administrateur (sudo) dans le système Linux à préparer, une seule fois.
# Référence du principe (pas du code) : https://github.com/ventoy/vtoyboot
set -e
echo "odin-boot : préparation du système pour démarrer depuis la clé ODIN..."

poser_fichier() { mkdir -p "$(dirname "$1")"; cat > "$1"; }

if [ -d /etc/initramfs-tools ]; then
  echo "odin-boot : initramfs-tools détecté (Debian/Ubuntu)."
  poser_fichier /etc/initramfs-tools/hooks/odin-boot <<'ODIN_FIN_HOOK_INITRAMFS'
${hookInitramfsTools()}ODIN_FIN_HOOK_INITRAMFS
  poser_fichier /etc/initramfs-tools/scripts/local-top/odin-boot <<'ODIN_FIN_LOCALTOP'
${localTopInitramfs()}ODIN_FIN_LOCALTOP
  chmod +x /etc/initramfs-tools/hooks/odin-boot /etc/initramfs-tools/scripts/local-top/odin-boot
  update-initramfs -u -k all
elif command -v dracut >/dev/null 2>&1; then
  echo "odin-boot : dracut détecté (Fedora/Rocky/Alma/openSUSE)."
  poser_fichier /usr/lib/dracut/modules.d/99odinboot/module-setup.sh <<'ODIN_FIN_DRACUT_SETUP'
${dracutModuleSetup()}ODIN_FIN_DRACUT_SETUP
  poser_fichier /usr/lib/dracut/modules.d/99odinboot/odin-boot.sh <<'ODIN_FIN_DRACUT_HOOK'
${dracutHook()}ODIN_FIN_DRACUT_HOOK
  chmod +x /usr/lib/dracut/modules.d/99odinboot/module-setup.sh /usr/lib/dracut/modules.d/99odinboot/odin-boot.sh
  dracut --force --regenerate-all
elif command -v mkinitcpio >/dev/null 2>&1; then
  echo "odin-boot : mkinitcpio détecté (Arch)."
  poser_fichier /etc/initcpio/hooks/odinboot <<'ODIN_FIN_MKINITCPIO_HOOK'
${mkinitcpioHook()}ODIN_FIN_MKINITCPIO_HOOK
  poser_fichier /etc/initcpio/install/odinboot <<'ODIN_FIN_MKINITCPIO_INSTALL'
${mkinitcpioInstall()}ODIN_FIN_MKINITCPIO_INSTALL
  echo "odin-boot : ajoute 'odinboot' à la liste HOOKS de /etc/mkinitcpio.conf (avant 'filesystems'), puis relance mkinitcpio -P."
else
  echo "odin-boot : générateur d'initramfs non reconnu. Préparation impossible automatiquement ici."
  echo "  Systèmes gérés : initramfs-tools (Debian/Ubuntu), dracut (Fedora/Rocky/Alma/openSUSE), mkinitcpio (Arch)."
  exit 2
fi
echo "odin-boot : terminé. Ce système démarrera depuis son disque virtuel posé sur la clé ODIN."
`;
}

/** Le hook initramfs-tools : copie les outils nécessaires (losetup) dans l'initramfs. Pur. */
export function hookInitramfsTools(): string {
  return `#!/bin/sh
${ENTETE}PREREQ=""
prereqs() { echo "$PREREQ"; }
case "$1" in prereqs) prereqs; exit 0;; esac
. /usr/share/initramfs-tools/hook-functions
copy_exec /sbin/losetup /sbin
copy_exec /sbin/blkid /sbin
`;
}

/** Le script local-top initramfs-tools : trouve la clé ODIN, monte le disque virtuel en boucle, en fait la racine. Pur. */
export function localTopInitramfs(): string {
  return `#!/bin/sh
${ENTETE}PREREQ=""
prereqs() { echo "$PREREQ"; }
case "$1" in prereqs) prereqs; exit 0;; esac
# Trouver la partition de la clé nommée ${LABEL_CLE} et le disque virtuel d'Odin posé dessus.
cle=$(blkid -L ${LABEL_CLE} 2>/dev/null || true)
[ -n "$cle" ] || exit 0
mkdir -p /run/odin-cle
mount -o ro "$cle" /run/odin-cle 2>/dev/null || exit 0
img=$(ls /run/odin-cle/vdisk/*.img /run/odin-cle/vdisk/*.vhd /run/odin-cle/vdisk/*.raw 2>/dev/null | head -n 1)
[ -n "$img" ] || exit 0
# Monter le disque virtuel en boucle : l'initramfs continuera à partir de ce disque.
losetup -f -P "$img"
`;
}

/** dracut : module-setup.sh (déclare le module et ses dépendances). Pur. */
export function dracutModuleSetup(): string {
  return `#!/bin/bash
${ENTETE}check() { return 0; }
depends() { echo "base"; }
install() {
  inst_multiple losetup blkid mount
  inst_hook pre-mount 90 "$moddir/odin-boot.sh"
}
`;
}

/** dracut : le hook pre-mount (même rôle que le local-top d'initramfs-tools). Pur. */
export function dracutHook(): string {
  return `#!/bin/sh
${ENTETE}cle=$(blkid -L ${LABEL_CLE} 2>/dev/null || true)
[ -n "$cle" ] || exit 0
mkdir -p /run/odin-cle
mount -o ro "$cle" /run/odin-cle 2>/dev/null || exit 0
img=$(ls /run/odin-cle/vdisk/*.img /run/odin-cle/vdisk/*.vhd /run/odin-cle/vdisk/*.raw 2>/dev/null | head -n 1)
[ -n "$img" ] || exit 0
losetup -f -P "$img"
`;
}

/** mkinitcpio : le hook runtime (Arch). Pur. */
export function mkinitcpioHook(): string {
  return `#!/bin/ash
${ENTETE}run_hook() {
  cle=$(blkid -L ${LABEL_CLE} 2>/dev/null)
  [ -n "$cle" ] || return 0
  mkdir -p /run/odin-cle
  mount -o ro "$cle" /run/odin-cle 2>/dev/null || return 0
  img=$(ls /run/odin-cle/vdisk/*.img /run/odin-cle/vdisk/*.vhd /run/odin-cle/vdisk/*.raw 2>/dev/null | head -n 1)
  [ -n "$img" ] && losetup -f -P "$img"
}
`;
}

/** mkinitcpio : le script d'installation (déclare quoi copier dans l'initramfs). Pur. */
export function mkinitcpioInstall(): string {
  return `#!/bin/bash
${ENTETE}build() {
  add_binary losetup
  add_binary blkid
  add_runscript
}
help() { echo "Fait démarrer ce système depuis un disque virtuel posé sur la clé ${LABEL_CLE}."; }
`;
}

/** Tous les fichiers générés par odin-boot, prêts à poser (nom → contenu). Pur. Utile pour les essais. */
export function fichiersOdinBoot(): Record<string, string> {
  return {
    'odin-boot': scriptOdinBoot(),
    'hooks/odin-boot': hookInitramfsTools(),
    'scripts/local-top/odin-boot': localTopInitramfs(),
    'dracut/99odinboot/module-setup.sh': dracutModuleSetup(),
    'dracut/99odinboot/odin-boot.sh': dracutHook(),
    'mkinitcpio/hooks/odinboot': mkinitcpioHook(),
    'mkinitcpio/install/odinboot': mkinitcpioInstall(),
  };
}

// ---------------- L'orchestration : Odin lance odin-boot lui-même ----------------
// Pour ne JAMAIS toucher un vrai disque pendant les essais, tout passe par un « exécuteur » injecté.
export interface ExecuteurPreparation {
  /** lancer odin-boot dans une VM connue d'Odin qui tourne (src/machines/, droits administrateur) */
  dansVm?(vm: string, script: string): Promise<{ ok: boolean; sortie: string }>;
  /** préparer un disque virtuel éteint : copie de sauvegarde, montage lecture-écriture (qemu-nbd/guestmount), odin-boot, démontage */
  surDisqueEteint?(chemin: string, script: string): Promise<{ ok: boolean; sortie: string; sauvegarde?: string }>;
}

export interface CiblePreparation {
  /** préparer dans une machine virtuelle qui tourne : son identifiant dans Odin */
  vm?: string;
  /** ou préparer un fichier de disque virtuel éteint : son chemin */
  disque?: string;
}

export interface ResultatPreparation { ok: boolean; message: string; sauvegarde?: string }

/**
 * Prépare un disque virtuel pour la clé : Odin lance odin-boot lui-même (dans une VM qui tourne, ou sur un
 * disque éteint après une copie de sauvegarde), puis vérifie le résultat. L'exécuteur réel est injecté ;
 * pour les essais, on passe un exécuteur simulé qui ne touche à rien.
 */
export async function preparerDisque(cible: CiblePreparation, exe: ExecuteurPreparation): Promise<ResultatPreparation> {
  const script = scriptOdinBoot();
  if (cible.vm) {
    if (!exe.dansVm) return { ok: false, message: 'Odin ne sait pas lancer odin-boot dans cette machine virtuelle ici.' };
    const r = await exe.dansVm(cible.vm, script);
    return { ok: r.ok, message: r.ok ? `odin-boot lancé dans la machine « ${cible.vm} » : le disque démarrera depuis la clé.` : `odin-boot a échoué dans « ${cible.vm} » : ${r.sortie}` };
  }
  if (cible.disque) {
    if (!exe.surDisqueEteint) return { ok: false, message: 'Odin ne peut pas préparer ce disque éteint ici (qemu-nbd ou guestmount absent).' };
    const r = await exe.surDisqueEteint(cible.disque, script);
    return { ok: r.ok, ...(r.sauvegarde ? { sauvegarde: r.sauvegarde } : {}), message: r.ok ? `Disque « ${cible.disque} » préparé par odin-boot (une copie de sauvegarde a été faite avant).` : `Préparation impossible : ${r.sortie}` };
  }
  return { ok: false, message: 'Choisis une machine virtuelle qui tourne, ou un fichier de disque virtuel à préparer.' };
}
