// Genèse · l'écran graphique d'Odin directement sur le PC qui démarre (façon B validée : « A d'abord, B si je
// choisis l'écran d'Odin »). Le PC démarre un petit système officiel d'Alpine Linux, chargé par le réseau, qui
// n'ouvre qu'une chose : la page /ecran d'Odin, en plein écran (cage + Chromium en mode kiosque). Quand un système
// est choisi (sur ce PC, un téléphone ou un autre PC), le petit système redémarre la machine, qui suit son choix.
// Rien n'est écrit sur le disque du PC. Les paquets d'Alpine passent par Odin (copie locale) : la première fois
// il faut Internet, ensuite tout est sur le réseau de la maison. Fonctions pures (sauf le tar).
import { gzipSync } from 'node:zlib';

export const ALPINE_MIRROR = 'https://dl-cdn.alpinelinux.org/alpine';
/** Les paquets du petit système : l'affichage (cage), le navigateur, les pilotes graphiques, une police. */
export const KIOSK_PACKAGES = ['alpine-base', 'cage', 'seatd', 'chromium', 'mesa-dri-gallium', 'mesa-egl', 'font-dejavu', 'font-noto-emoji', 'eudev', 'libinput', 'xkeyboard-config', 'efibootmgr'];

export interface NetbootRelease { branch: string; version: string; file: string; sha256: string; size?: number }
/** Lit latest-releases.yaml d'Alpine et trouve l'archive « netboot » (noyau, initramfs, modloop). Pur. */
export function parseLatest(yaml: string): NetbootRelease | undefined {
  for (const block of yaml.split(/\n-\s*\n|\n- /)) {
    const get = (k: string) => new RegExp(`^\\s*${k}:\\s*"?([^"\\n]+)"?\\s*$`, 'm').exec(block)?.[1]?.trim();
    if (get('flavor') !== 'alpine-netboot') continue;
    const branch = get('branch'), version = get('version'), file = get('file'), sha256 = get('sha256');
    if (branch && version && file && sha256 && /^[0-9a-f]{64}$/.test(sha256) && /^[\w.-]+\.tar\.gz$/.test(file)) return { branch, version, file, sha256, size: Number(get('size')) || undefined };
  }
  return undefined;
}

/** Les fichiers d'une archive tar (ustar, noms longs GNU compris). Pur. */
export function untar(b: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>(); let off = 0, longName = '';
  while (off + 512 <= b.length) {
    const h = b.subarray(off, off + 512); if (h.every((x) => x === 0)) break;
    const str = (s: number, n: number) => h.subarray(s, s + n).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8) || 0, type = String.fromCharCode(h[156] || 48), prefix = str(345, 155);
    const name = longName || (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100)); longName = '';
    const data = b.subarray(off + 512, off + 512 + size); off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === '0' || type === '\0') out.set(name.replace(/^\.\//, ''), Buffer.from(data));
  }
  return out;
}

type TarEntry = { name: string; data?: string | Buffer; mode?: number; link?: string; dir?: boolean };
/** Une archive tar.gz (ustar) à partir d'une liste de fichiers, dossiers et liens. Pur (date fixe). */
export function tarGz(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = e.data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const h = Buffer.alloc(512), put = (s: string, at: number, n: number) => h.write(s.slice(0, n), at, 'utf8');
    const oct = (v: number, n: number) => v.toString(8).padStart(n - 1, '0') + '\0';
    put(e.name + (e.dir && !e.name.endsWith('/') ? '/' : ''), 0, 100); put(oct(e.mode ?? (e.dir ? 0o755 : 0o644), 8), 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8);
    put(oct(e.link || e.dir ? 0 : data.length, 12), 124, 12); put(oct(1_700_000_000, 12), 136, 12); h.fill(' ', 148, 156);
    h[156] = (e.link ? '2' : e.dir ? '5' : '0').charCodeAt(0); if (e.link) put(e.link, 157, 100); put('ustar\0', 257, 6); put('00', 263, 2); put('root', 265, 32); put('root', 297, 32);
    let sum = 0; for (const x of h) sum += x; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    parts.push(h); if (!e.link && !e.dir && data.length) { parts.push(data); const pad = (512 - (data.length % 512)) % 512; if (pad) parts.push(Buffer.alloc(pad)); }
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

/**
 * Le « calque » (apkovl) du petit système pour une machine : paquets à installer, réseau, et le service qui
 * ouvre l'écran d'Odin en plein écran puis redémarre le PC dès qu'un choix est fait. Pur.
 */
export function kioskOverlay(o: { base: string; mac: string; branch: string; keymap?: string }): Buffer {
  const url = `${o.base}/ecran?mac=${o.mac}&pc=1`, etat = `${o.base}/ecran/etat?mac=${o.mac}`;
  const repo = `${o.base}/alpine/${o.branch}`;
  const start = `#!/bin/sh
# Odin · Genèse : l'écran d'Odin sur ce PC (rien n'est écrit sur le disque).
exec >/var/log/odin-ecran.log 2>&1
id odin >/dev/null 2>&1 || adduser -D -G video odin
addgroup odin input 2>/dev/null; addgroup odin seat 2>/dev/null
mkdir -p /run/odin && chown odin /run/odin && chmod 700 /run/odin
rc-service seatd start 2>/dev/null
# Dès qu'un système est choisi (ici, sur un téléphone ou un autre PC), le PC redémarre et le suit.
# En UEFI, le prochain démarrage repasse par le réseau (BootNext) pour lancer le système choisi.
suivant() {
  [ -d /sys/firmware/efi ] || return 0
  mount -t efivarfs efivarfs /sys/firmware/efi/efivars 2>/dev/null
  n=$(efibootmgr 2>/dev/null | grep -iE 'ipv4|pxe|network|r.seau' | head -1 | sed -n 's/^Boot\\([0-9A-Fa-f]\\{4\\}\\).*/\\1/p')
  [ -n "$n" ] && efibootmgr -q -n "$n"
}
( while sleep 2; do wget -q -T 5 -O - '${etat}' 2>/dev/null | grep -q '"relance":true' && { suivant; sleep 1; reboot; }; done ) &
B=$(command -v chromium-browser || command -v chromium)
while true; do
  su odin -s /bin/sh -c "XDG_RUNTIME_DIR=/run/odin WLR_LIBINPUT_NO_DEVICES=1 cage -s -- $B --kiosk --no-first-run --noerrdialogs --disable-translate --disable-features=Translate --ozone-platform=wayland --lang=fr --check-for-update-interval=31536000 '${url}'"
  sleep 2
done
`;
  return tarGz([
    { name: 'etc', dir: true }, { name: 'etc/apk', dir: true }, { name: 'etc/network', dir: true }, { name: 'etc/local.d', dir: true },
    { name: 'etc/runlevels', dir: true }, { name: 'etc/runlevels/default', dir: true }, { name: 'etc/runlevels/boot', dir: true }, { name: 'etc/runlevels/sysinit', dir: true },
    { name: 'etc/fstab', data: '' },
    { name: 'etc/hostname', data: `odin-ecran-${o.mac.replace(/:/g, '').slice(-6)}\n` },
    { name: 'etc/apk/world', data: `${KIOSK_PACKAGES.join('\n')}\n` },
    { name: 'etc/apk/repositories', data: `${repo}/main\n${repo}/community\n` },
    { name: 'etc/network/interfaces', data: 'auto lo\niface lo inet loopback\n\nauto eth0\niface eth0 inet dhcp\n' },
    { name: 'etc/conf.d', dir: true }, { name: 'etc/conf.d/keymaps', data: `keymap="${o.keymap ?? 'fr'}"\n` },
    { name: 'etc/local.d/odin-ecran.start', data: start, mode: 0o755 },
    { name: 'etc/runlevels/sysinit/udev', link: '/etc/init.d/udev' }, { name: 'etc/runlevels/sysinit/udev-trigger', link: '/etc/init.d/udev-trigger' },
    { name: 'etc/runlevels/boot/networking', link: '/etc/init.d/networking' }, { name: 'etc/runlevels/boot/modloop', link: '/etc/init.d/modloop' },
    { name: 'etc/runlevels/default/seatd', link: '/etc/init.d/seatd' }, { name: 'etc/runlevels/default/local', link: '/etc/init.d/local' },
  ]);
}

/** Les lignes iPXE qui démarrent le petit système (après « :ecran »). Pur. */
export function kioskBoot(o: { base: string; mac: string; branch: string }): string[] {
  const b = `${o.base}/boot/alpine`, m = o.mac.replace(/:/g, '');
  return [
    'echo Odin prepare l\'ecran de demarrage sur ce PC (10 a 20 s, plus la premiere fois)...',
    `kernel ${b}/vmlinuz-lts initrd=initramfs-lts modules=loop,squashfs,sd-mod,usb-storage quiet ip=dhcp alpine_repo=${o.base}/alpine/${o.branch}/main,${o.base}/alpine/${o.branch}/community modloop=${b}/modloop-lts apkovl=${o.base}/ecran/ovl/${m}.apkovl.tar.gz || goto ecran-tel`,
    `initrd --name initramfs-lts ${b}/initramfs-lts || goto ecran-tel`,
    'boot || goto ecran-tel',
  ];
}
