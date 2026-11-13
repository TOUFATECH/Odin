// Genèse · « recettes » : reconnaître ce que contient une ISO, savoir comment la démarrer par le réseau, et
// écrire le fichier de réponses de l'installation sans rien toucher (Ubuntu autoinstall, Debian preseed,
// Kickstart pour Fedora / Rocky / Alma, unattend.xml pour Windows). Tout est pur ici (sauf la lecture de l'ISO).
import { createHash, randomBytes } from 'node:crypto';
import type { Iso } from './iso.ts';

export type Kind = 'ubuntu' | 'casper' | 'debian' | 'rhel' | 'fedora-live' | 'arch' | 'alpine' | 'debian-live' | 'windows' | 'iso';
export interface Recipe {
  kind: Kind; label: string;
  /** installation automatique possible (fichier de réponses) */
  auto: boolean;
  /** système d'exploitation de la famille (pour les paquets et le message de fin) */
  os: 'linux' | 'windows' | 'outil';
  kernel?: string; initrd?: string[]; codename?: string; version?: string;
  /** ce qu'il manque pour la démarrer (ex. Windows : un partage réseau) */
  needs?: string;
}

/** Ce qu'est une ISO, d'après les fichiers qu'elle contient. */
export async function detect(iso: Iso): Promise<Recipe> {
  const has = (p: string) => iso.exists(p);
  const text = async (p: string) => { try { return (await iso.file(p, 1024 * 1024)).toString('utf8'); } catch { return ''; } };
  const info = (await text('.disk/info')).trim();
  if (await has('sources/boot.wim') && (await has('bootmgr') || await has('efi/boot/bootx64.efi'))) {
    return { kind: 'windows', label: 'Windows (installation par le réseau)', auto: true, os: 'windows', needs: 'un partage réseau (SMB) où Odin dépose les fichiers d\'installation' };
  }
  if (await has('casper/vmlinuz')) {
    const initrd = (await has('casper/initrd')) ? 'casper/initrd' : (await has('casper/initrd.lz')) ? 'casper/initrd.lz' : 'casper/initrd.gz';
    const ubuntu = /ubuntu/i.test(info) || /ubuntu/i.test(iso.label);
    return ubuntu
      ? { kind: 'ubuntu', label: `${/server/i.test(info) || /server/i.test(iso.label) ? 'Ubuntu Server' : 'Ubuntu'} (installation automatique)`, auto: true, os: 'linux', kernel: 'casper/vmlinuz', initrd: [initrd], version: /(\d\d\.\d\d(?:\.\d+)?)/.exec(info)?.[1] }
      : { kind: 'casper', label: `${info.split(/\s+/).slice(0, 2).join(' ') || iso.label || 'Système'} (démarrage)`, auto: false, os: 'linux', kernel: 'casper/vmlinuz', initrd: [initrd] };
  }
  if (await has('install.amd/vmlinuz') && /debian/i.test(info)) {
    const codename = (/"([^"]+)"/.exec(info)?.[1] ?? '').split(/\s+/)[0]?.toLowerCase() || (await iso.list('dists').catch(() => [])).find((d) => d.dir && !['stable', 'testing'].includes(d.name))?.name;
    return { kind: 'debian', label: 'Debian (installation automatique)', auto: true, os: 'linux', codename, version: /(\d+\.\d+(?:\.\d+)?)/.exec(info)?.[1], needs: 'Internet pour le programme d\'installation réseau (deb.debian.org)' };
  }
  if (await has('images/pxeboot/vmlinuz')) {
    if (await has('LiveOS/squashfs.img') && !(await has('BaseOS'))) return { kind: 'fedora-live', label: 'Fedora (démarrage du système live)', auto: false, os: 'linux', kernel: 'images/pxeboot/vmlinuz', initrd: ['images/pxeboot/initrd.img'] };
    return { kind: 'rhel', label: `${/rocky/i.test(iso.label) ? 'Rocky Linux' : /alma/i.test(iso.label) ? 'AlmaLinux' : /fedora/i.test(iso.label) ? 'Fedora' : 'Red Hat et compatibles'} (installation automatique)`, auto: true, os: 'linux', kernel: 'images/pxeboot/vmlinuz', initrd: ['images/pxeboot/initrd.img'] };
  }
  if (await has('arch/boot/x86_64/vmlinuz-linux')) return { kind: 'arch', label: 'Arch Linux (démarrage)', auto: false, os: 'linux', kernel: 'arch/boot/x86_64/vmlinuz-linux', initrd: ['arch/boot/x86_64/initramfs-linux.img'] };
  if (await has('boot/vmlinuz-lts') && await has('apks')) return { kind: 'alpine', label: 'Alpine Linux (démarrage)', auto: false, os: 'linux', kernel: 'boot/vmlinuz-lts', initrd: ['boot/initramfs-lts'] };
  if (await has('live/vmlinuz') && await has('live/filesystem.squashfs')) return { kind: 'debian-live', label: `${/clonezilla/i.test(iso.label + info) ? 'Clonezilla' : /gparted/i.test(iso.label + info) ? 'GParted' : 'Système live'} (démarrage)`, auto: false, os: 'outil', kernel: 'live/vmlinuz', initrd: ['live/initrd.img'] };
  return { kind: 'iso', label: 'ISO démarrée telle quelle', auto: false, os: 'outil' };
}

// ---------------- Le menu iPXE ----------------
export interface Entry { id: string; name: string; recipe: Recipe }
export interface MenuIn {
  base: string; mac: string; entries: Entry[];
  /** l'entrée choisie par défaut et le délai (s) ; « local » = démarrer sur le disque de la machine */
  def: string; timeout: number;
  /** pour l'installation automatique de cette machine : jeton et entrée */
  auto?: { id: string; token: string; host: string };
  netboot?: (codename: string) => { kernel: string; initrd: string } | undefined;
  /** l'écran d'Odin : choisir le système sur un téléphone ou un PC du réseau (la machine attend le choix) */
  ecran?: boolean;
  /** l'habillage de l'écran texte (image de fond, couleurs) : lignes iPXE déjà prêtes (voir ecran.ts textLook) */
  look?: string[];
  /** l'écran graphique sur le PC lui-même (petit système) : lignes iPXE après « :ecran » ; sans elles, on attend un choix fait sur un téléphone */
  kiosk?: string[];
  /** la famille d'une entrée (Windows, Linux, Serveurs, Outils), pour ranger le menu */
  family?: (e: Entry) => string;
}
/** Texte du menu : les écrans de démarrage n'affichent que l'ASCII (accents retirés). Pur. */
const q = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9 ._()+'-]/g, ' ').replace(/\s+/g, ' ').trim();

/** Le script iPXE d'une machine : menu, entrée par défaut, démarrage de chaque ISO. Pur. */
export function menu(m: MenuIn): string {
  const L = ['#!ipxe', `# Odin · Genèse — ${m.mac}`, `set base ${m.base}`, 'isset ${menu-timeout} || set menu-timeout 0', ...(m.look ?? []), ''];
  // L'écran de démarrage (maquette A1) : ce PC, son adresse, Odin trouvé ; Échap = son disque.
  if (m.timeout > 0) {
    const host = /^https?:\/\/([^/]+)/.exec(m.base)?.[1] ?? m.base;
    L.push('echo', 'echo ODIN - Genese : demarrage par le reseau', 'echo Carte reseau .... ${netX/mac}', 'echo Micrologiciel ... ${platform} ${buildarch}', 'echo Adresse ......... ${netX/ip}', `echo Serveur Odin .... ${host} OK`, 'echo',
      'prompt --key 0x1b --timeout 2500 Menu dans 3 s   (Echap : demarrer sur le disque de ce PC) && goto local ||', '');
  }
  L.push(`menu ODIN - Choisis un systeme pour ce PC (${m.mac})`);
  if (m.ecran) L.push(`item ecran Choisir sur l'ecran d'Odin ${m.kiosk?.length ? '(ici en graphique, ou sur un telephone)' : '(telephone ou PC du reseau)'}`);
  L.push('item local Demarrer sur le disque de cette machine');
  // Les systèmes rangés par famille (maquette « Démarrage réseau ») : Windows, Linux, Serveurs, Outils
  const fam = (e: Entry) => m.family?.(e) ?? 'ISO';
  const order = ['Windows', 'Linux', 'Serveurs', 'Outils', 'ISO'], groups = [...new Set(m.entries.map(fam))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  let lastFam = '';
  for (const e of [...m.entries].sort((a, b) => groups.indexOf(fam(a)) - groups.indexOf(fam(b)))) {
    if (fam(e) !== lastFam) { lastFam = fam(e); L.push(`item --gap -- --- ${q(lastFam).toUpperCase()} ${'-'.repeat(Math.max(3, 44 - lastFam.length))}`); } const label = `${q(e.name)} - ${q(m.auto?.id === e.id ? e.recipe.label : e.recipe.label.replace(/\(installation automatique\)/, '(installation)'))}`; L.push(`item e-${e.id} ${label.length > 62 ? `${label.slice(0, 61)}.` : label}`); }
  L.push('item --gap --', 'item shell Ligne de commande iPXE');
  L.push(`choose --default ${m.def === 'local' || (m.def === 'ecran' && m.ecran) ? m.def : `e-${m.def}`} --timeout ${Math.max(0, Math.round(m.timeout * 1000))} sel || goto local`, 'goto ${sel}', '');
  L.push(':local', 'echo Demarrage sur le disque...', 'iseq ${platform} efi && exit 1 ||', 'sanboot --no-describe --drive 0x80 || exit 1', '');
  L.push(':shell', 'shell', 'goto local', '');
  if (m.ecran) L.push(':ecran', ...(m.kiosk ?? []), ':ecran-tel', `chain ${m.base}/ecran/attente.ipxe?mac=${m.mac}&fw=\${platform} || goto local`, '');
  for (const e of m.entries) L.push(...entry(m, e), '');
  L.push(':echec', 'echo Le demarrage a echoue. Retour au menu dans 10 s.', 'sleep 10', `chain ${m.base}/menu.ipxe?mac=${m.mac} || goto local`);
  return `${L.join('\n')}\n`;
}
function entry(m: MenuIn, e: Entry): string[] {
  const r = e.recipe, f = `\${base}/f/${e.id}`, mark = `?m=${m.mac}`, auto = m.auto?.id === e.id ? m.auto : undefined;
  const seed = auto ? `\${base}/seed/${auto.token}` : '';
  const out = [`:e-${e.id}`, `echo Chargement : ${q(e.name)}`, 'echo Ne debranche pas le cable reseau.'];
  const kernel = (path: string, args: string) => out.push(`kernel ${f}/${path}${mark} initrd=initrd ${args}`.trimEnd());
  const initrd = (path: string, name = 'initrd') => out.push(`initrd --name ${name} ${f}/${path}`);
  switch (r.kind) {
    case 'ubuntu':
      kernel(r.kernel!, `ip=dhcp url=\${base}/iso/${e.id}.iso${auto ? ` autoinstall ds=nocloud-net;s=${seed}/ cloud-config-url=/dev/null` : ''} ---`); initrd(r.initrd![0]); break;
    case 'casper':
      kernel(r.kernel!, `boot=casper ip=dhcp url=\${base}/iso/${e.id}.iso ---`); initrd(r.initrd![0]); break;
    case 'debian': {
      const nb = m.netboot?.(r.codename ?? '');
      if (!nb) { out.push('echo Le programme d\'installation reseau de Debian n\'est pas encore pret dans Odin.', 'goto echec'); return out; }
      out.push(`kernel \${base}/${nb.kernel}${mark} initrd=initrd ${auto ? `auto=true priority=critical url=${seed}/preseed.cfg hostname=${auto.host} domain= ` : ''}language=fr country=FR locale=fr_FR.UTF-8 keymap=fr ---`.replace(/\s+---$/, ' ---'));
      out.push(`initrd --name initrd \${base}/${nb.initrd}`); break;
    }
    case 'rhel':
      kernel(r.kernel!, `ip=dhcp inst.repo=${f}/${auto ? ` inst.ks=${seed}/ks.cfg` : ''} inst.lang=fr_FR.UTF-8 inst.keymap=fr`); initrd(r.initrd![0]); break;
    case 'fedora-live':
      kernel(r.kernel!, `ip=dhcp root=live:${f}/LiveOS/squashfs.img rd.live.image`); initrd(r.initrd![0]); break;
    case 'arch':
      kernel(r.kernel!, `archisobasedir=arch archiso_http_srv=${f}/ ip=dhcp`); initrd(r.initrd![0]); break;
    case 'alpine':
      kernel(r.kernel!, `ip=dhcp alpine_repo=${f}/apks modloop=${f}/boot/modloop-lts`); initrd(r.initrd![0]); break;
    case 'debian-live':
      kernel(r.kernel!, `boot=live components fetch=${f}/live/filesystem.squashfs ip=dhcp`); initrd(r.initrd![0]); break;
    case 'windows':
      if (!auto) { out.push('echo Windows s\'installe seulement pour une machine autorisee dans Odin (installation automatique).', 'goto echec'); return out; }
      out.push(`kernel \${base}/boot/wimboot${mark} gui`,
        `iseq \${platform} efi && initrd --name bootx64.efi ${f}/efi/boot/bootx64.efi bootx64.efi ||`,
        `iseq \${platform} pcbios && initrd --name bootmgr ${f}/bootmgr bootmgr ||`,
        `initrd --name BCD ${f}/boot/bcd BCD`, `initrd --name boot.sdi ${f}/boot/boot.sdi boot.sdi`,
        `initrd --name winpeshl.ini ${seed}/winpeshl.ini winpeshl.ini`, `initrd --name odin.cmd ${seed}/odin.cmd odin.cmd`, `initrd --name unattend.xml ${seed}/unattend.xml unattend.xml`,
        `initrd --name boot.wim ${f}/sources/boot.wim boot.wim`); break;
    default:
      out.push(`sanboot --no-describe \${base}/iso/${e.id}.iso${mark} || goto echec`); return out;
  }
  out.push('boot || goto echec');
  return out;
}

// ---------------- Les fichiers de réponses ----------------
export interface Answer {
  host: string; user: string; password: string; locale: string; keymap: string; timezone: string;
  /** paquets Linux en plus */
  packages: string[];
  /** adresse de retour vers Odin (avancement) */
  report: string;
  /** Windows : partage où sont les fichiers d'installation, et les logiciels à installer */
  share?: { unc: string; user?: string; password?: string };
  software?: Array<{ name: string; url: string; args: string; msi: boolean }>;
  /** Debian / RHEL : dépôt (adresse) */
  repo?: string; mirror?: string;
}
const yamlStr = (s: string) => JSON.stringify(s);
/** La fin commune sous Linux : un petit service qui prévient Odin au premier démarrage (nom pris, adresse). */
function linuxFirstBoot(a: Answer): string {
  return `[Unit]\nDescription=Odin Genèse : fin du deploiement\nWants=network-online.target\nAfter=network-online.target\n[Service]\nType=oneshot\nExecStart=/bin/sh -c 'IP=$(hostname -I | cut -d" " -f1); (curl -fsS "${a.report}?e=fini&nom=$(hostname)&ip=$IP" || wget -qO- "${a.report}?e=fini&nom=$(hostname)&ip=$IP") >/dev/null 2>&1; systemctl disable odin-thjalfi.service'\n[Install]\nWantedBy=multi-user.target\n`;
}
const b64 = (s: string) => Buffer.from(s).toString('base64');

/** Ubuntu (autoinstall de Subiquity) : user-data. */
export function ubuntuUserData(a: Answer): string {
  const unit = b64(linuxFirstBoot(a));
  return `#cloud-config\nautoinstall:\n  version: 1\n  locale: ${a.locale}\n  keyboard: {layout: ${a.keymap}}\n  timezone: ${a.timezone}\n  refresh-installer: {update: false}\n  identity:\n    hostname: ${a.host}\n    username: ${a.user}\n    password: ${yamlStr(sha512crypt(a.password))}\n  ssh: {install-server: true, allow-pw: true}\n  storage: {layout: {name: lvm}}\n  packages: [${['curl', ...a.packages].map(yamlStr).join(', ')}]\n  early-commands:\n    - ${yamlStr(`wget -qO- '${a.report}?e=installation' || true`)}\n  late-commands:\n    - ${yamlStr(`echo ${unit} | base64 -d > /target/etc/systemd/system/odin-thjalfi.service`)}\n    - curtin in-target -- systemctl enable odin-thjalfi.service\n    - ${yamlStr(`wget -qO- '${a.report}?e=logiciels' || true`)}\n  shutdown: reboot\n`;
}
export const ubuntuMetaData = (token: string) => `instance-id: odin-thjalfi-${token}\n`;

/** Debian : preseed. */
export function debianPreseed(a: Answer): string {
  const unit = b64(linuxFirstBoot(a)), m = a.mirror ?? 'deb.debian.org';
  return [
    `d-i debian-installer/locale string ${a.locale}`, `d-i keyboard-configuration/xkb-keymap select ${a.keymap}`,
    'd-i netcfg/choose_interface select auto', `d-i netcfg/get_hostname string ${a.host}`, 'd-i netcfg/get_domain string', `d-i netcfg/hostname string ${a.host}`,
    'd-i mirror/country string manual', `d-i mirror/http/hostname string ${m}`, 'd-i mirror/http/directory string /debian', 'd-i mirror/http/proxy string',
    'd-i passwd/root-login boolean false', `d-i passwd/user-fullname string ${a.user}`, `d-i passwd/username string ${a.user}`, `d-i passwd/user-password-crypted password ${sha512crypt(a.password)}`,
    'd-i clock-setup/utc boolean true', `d-i time/zone string ${a.timezone}`, 'd-i clock-setup/ntp boolean true',
    'd-i partman-auto/method string lvm', 'd-i partman-auto-lvm/guided_size string max', 'd-i partman-lvm/device_remove_lvm boolean true', 'd-i partman-md/device_remove_md boolean true', 'd-i partman-lvm/confirm boolean true', 'd-i partman-lvm/confirm_nooverwrite boolean true',
    'd-i partman-auto/choose_recipe select atomic', 'd-i partman-partitioning/confirm_write_new_label boolean true', 'd-i partman/choose_partition select finish', 'd-i partman/confirm boolean true', 'd-i partman/confirm_nooverwrite boolean true', 'd-i partman-efi/non_efi_system boolean true',
    'd-i apt-setup/cdrom/set-first boolean false', 'tasksel tasksel/first multiselect standard, ssh-server', `d-i pkgsel/include string ${['curl', 'sudo', ...a.packages].join(' ')}`, 'd-i pkgsel/upgrade select full-upgrade', 'popularity-contest popularity-contest/participate boolean false',
    'd-i grub-installer/only_debian boolean true', 'd-i grub-installer/bootdev string default',
    `d-i preseed/early_command string wget -qO- '${a.report}?e=installation' || true`,
    `d-i preseed/late_command string echo ${unit} | base64 -d > /target/etc/systemd/system/odin-thjalfi.service; in-target systemctl enable odin-thjalfi.service; in-target usermod -aG sudo ${a.user}; wget -qO- '${a.report}?e=logiciels' || true`,
    'd-i finish-install/reboot_in_progress note', '',
  ].join('\n');
}

/** Fedora, Rocky, AlmaLinux : Kickstart. */
export function kickstart(a: Answer): string {
  const unit = linuxFirstBoot(a);
  return `# Odin · Genèse\ntext\n${a.repo ? `url --url=${a.repo}\n` : ''}lang ${a.locale}\nkeyboard ${a.keymap}\ntimezone ${a.timezone} --utc\nnetwork --bootproto=dhcp --hostname=${a.host} --activate\nrootpw --lock\nuser --name=${a.user} --groups=wheel --password=${sha512crypt(a.password)} --iscrypted\nzerombr\nclearpart --all --initlabel\nautopart\nbootloader\nfirstboot --disable\nreboot\n\n%pre\ncurl -fsS '${a.report}?e=installation' || true\n%end\n\n%packages\n@core\ncurl\n${a.packages.join('\n')}${a.packages.length ? '\n' : ''}%end\n\n%post\ncat > /etc/systemd/system/odin-thjalfi.service <<'ODIN'\n${unit}ODIN\nsystemctl enable odin-thjalfi.service\ncurl -fsS '${a.report}?e=logiciels' || true\n%end\n`;
}

/** Windows : ce que WinPE lance (au lieu de l'installateur) : relier le partage, puis lancer l'installation. */
export function winpeshl(): string { return '[LaunchApps]\r\n"%SYSTEMROOT%\\System32\\wpeinit.exe"\r\n"%SYSTEMROOT%\\System32\\cmd.exe", "/c %SYSTEMROOT%\\System32\\odin.cmd"\r\n'; }
export function odinCmd(a: Answer): string {
  const s = a.share!; const user = s.user ? ` /user:${s.user} "${(s.password ?? '').replace(/"/g, '')}"` : '';
  return ['@echo off', 'echo Odin - Genèse : preparation de l\'installation de Windows...', 'wpeutil InitializeNetwork', 'ping -n 6 127.0.0.1 >nul',
    `powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing '${a.report}?e=installation' | Out-Null } catch {}" 2>nul`,
    `net use O: ${s.unc}${user}`, 'if errorlevel 1 (echo Le partage reseau ne repond pas. & pause & exit /b 1)',
    'O:\\setup.exe /unattend:X:\\Windows\\System32\\unattend.xml', ''].join('\r\n');
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** unattend.xml : disque effacé et partagé automatiquement (UEFI et BIOS), compte local, logiciels au premier démarrage. */
export function unattend(a: Answer, fw: 'uefi' | 'bios'): string {
  const pw = (p: string, suffix: string) => Buffer.from(`${p}${suffix}`, 'utf16le').toString('base64');
  const lang = a.locale.replace('_', '-').replace(/\..*$/, '');
  const disk = fw === 'uefi'
    ? '<CreatePartitions><CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>300</Size></CreatePartition><CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>16</Size></CreatePartition><CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition></CreatePartitions><ModifyPartitions><ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>System</Label></ModifyPartition><ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition></ModifyPartitions>'
    : '<CreatePartitions><CreatePartition wcm:action="add"><Order>1</Order><Type>Primary</Type><Size>500</Size></CreatePartition><CreatePartition wcm:action="add"><Order>2</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition></CreatePartitions><ModifyPartitions><ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>NTFS</Format><Label>System</Label><Active>true</Active></ModifyPartition><ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>2</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition></ModifyPartitions>';
  const part = fw === 'uefi' ? 3 : 2, arch = 'processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State"';
  const after = `powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((New-Object Net.WebClient).DownloadString('${a.report.replace(/\/etat\//, '/w/')}/apres.ps1'))"`;
  return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" ${arch}><SetupUILanguage><UILanguage>${lang}</UILanguage></SetupUILanguage><InputLocale>${lang}</InputLocale><SystemLocale>${lang}</SystemLocale><UILanguage>${lang}</UILanguage><UserLocale>${lang}</UserLocale></component>
    <component name="Microsoft-Windows-Setup" ${arch}>
      <DiskConfiguration><Disk wcm:action="add"><DiskID>0</DiskID><WillWipeDisk>true</WillWipeDisk>${disk}</Disk></DiskConfiguration>
      <ImageInstall><OSImage><InstallTo><DiskID>0</DiskID><PartitionID>${part}</PartitionID></InstallTo><InstallFrom><MetaData wcm:action="add"><Key>/IMAGE/INDEX</Key><Value>1</Value></MetaData></InstallFrom></OSImage></ImageInstall>
      <UserData><AcceptEula>true</AcceptEula><ProductKey><Key></Key><WillShowUI>OnError</WillShowUI></ProductKey></UserData>
    </component>
  </settings>
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" ${arch}><ComputerName>${xml(a.host.slice(0, 15))}</ComputerName><TimeZone>${xml(windowsZone(a.timezone))}</TimeZone></component>
  </settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" ${arch}><InputLocale>${lang}</InputLocale><SystemLocale>${lang}</SystemLocale><UILanguage>${lang}</UILanguage><UserLocale>${lang}</UserLocale></component>
    <component name="Microsoft-Windows-Shell-Setup" ${arch}>
      <OOBE><HideEULAPage>true</HideEULAPage><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC></OOBE>
      <UserAccounts><LocalAccounts><LocalAccount wcm:action="add"><Name>${xml(a.user)}</Name><Group>Administrators</Group><Password><Value>${pw(a.password, 'Password')}</Value><PlainText>false</PlainText></Password></LocalAccount></LocalAccounts></UserAccounts>
      <AutoLogon><Enabled>true</Enabled><LogonCount>1</LogonCount><Username>${xml(a.user)}</Username><Password><Value>${pw(a.password, 'Password')}</Value><PlainText>false</PlainText></Password></AutoLogon>
      <FirstLogonCommands><SynchronousCommand wcm:action="add"><Order>1</Order><CommandLine>${xml(after)}</CommandLine><Description>Odin Genèse : logiciels et fin</Description></SynchronousCommand></FirstLogonCommands>
    </component>
  </settings>
</unattend>
`;
}
/** Le script PowerShell lancé à la première ouverture de session : logiciels (silencieux), puis « fini ». */
export function windowsAfter(a: Answer): string {
  const sw = a.software ?? [];
  const lines = ['$ErrorActionPreference = "Continue"', `$odin = '${a.report}'`, 'function Dire($e, $x) { try { (New-Object Net.WebClient).DownloadString("$odin?e=$e$x") | Out-Null } catch {} }', 'Dire "logiciels" ""', '$dir = Join-Path $env:TEMP "odin-thjalfi"; New-Item -ItemType Directory -Force -Path $dir | Out-Null'];
  for (const s of sw) {
    const file = `$dir\\${s.url.split('/').pop()!.replace(/[^\w.+-]/g, '_')}`;
    lines.push(`try { (New-Object Net.WebClient).DownloadFile('${s.url}', "${file}"); ${s.msi ? `Start-Process msiexec.exe -ArgumentList '/i', "\`"${file}\`"", '/qn', '/norestart' -Wait` : `Start-Process "${file}" -ArgumentList '${s.args.replace(/'/g, "''")}' -Wait`}; Dire "logiciel" "&nom=${encodeURIComponent(s.name)}&ok=1" } catch { Dire "logiciel" "&nom=${encodeURIComponent(s.name)}&ok=0" }`);
  }
  lines.push('$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" } | Select-Object -First 1).IPAddress', 'Dire "fini" "&nom=$env:COMPUTERNAME&ip=$ip"', 'Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue');
  return `${lines.join('\r\n')}\r\n`;
}
/** Les fuseaux Windows pour les fuseaux les plus courants chez toi. */
function windowsZone(tz: string): string {
  const z: Record<string, string> = { 'Indian/Mayotte': 'E. Africa Standard Time', 'Europe/Paris': 'Romance Standard Time', 'Indian/Reunion': 'Arabian Standard Time', 'Africa/Nairobi': 'E. Africa Standard Time', UTC: 'UTC' };
  return z[tz] ?? 'UTC';
}

/** Les options silencieuses des installateurs connus de Hermès (sinon « /S », le plus courant). Pur. */
export function silentArgs(sourceId: string, file: string): { args: string; msi: boolean } {
  if (/\.msi$/i.test(file)) return { args: '', msi: true };
  const known: Record<string, string> = { firefox: '-ms', vscode: '/VERYSILENT /NORESTART /MERGETASKS=!runcode', '7zip': '/S', notepadpp: '/S', git: '/VERYSILENT /NORESTART', obs: '/S', powertoys: '/quiet /norestart', vlc: '/L=1036 /S' };
  return { args: known[sourceId] ?? '/S', msi: false };
}

// ---------------- Mot de passe chiffré (crypt SHA-512, « $6$ ») ----------------
const ITOA = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Empreinte « $6$ » (glibc crypt SHA-512) : ce que Linux range dans /etc/shadow. Écrit d'après la spécification publique. */
export function sha512crypt(password: string, salt = randomSalt(), rounds = 5000): string {
  const P = Buffer.from(password), S = Buffer.from(salt.slice(0, 16));
  const H = () => createHash('sha512');
  const B = H().update(P).update(S).update(P).digest();
  const a = H().update(P).update(S);
  for (let n = P.length; n > 0; n -= 64) a.update(B.subarray(0, Math.min(64, n)));
  for (let n = P.length; n > 0; n >>= 1) a.update(n & 1 ? B : P);
  const A = a.digest();
  const dp = H(); for (let i = 0; i < P.length; i++) dp.update(P); const DP = dp.digest();
  const Pb = Buffer.alloc(P.length); for (let i = 0; i < P.length; i++) Pb[i] = DP[i % 64];
  const ds = H(); for (let i = 0; i < 16 + A[0]; i++) ds.update(S); const DS = ds.digest();
  const Sb = Buffer.alloc(S.length); for (let i = 0; i < S.length; i++) Sb[i] = DS[i % 64];
  let C = A;
  for (let i = 0; i < rounds; i++) {
    const c = H();
    c.update(i & 1 ? Pb : C); if (i % 3) c.update(Sb); if (i % 7) c.update(Pb); c.update(i & 1 ? C : Pb);
    C = c.digest();
  }
  const order = [[0, 21, 42], [22, 43, 1], [44, 2, 23], [3, 24, 45], [25, 46, 4], [47, 5, 26], [6, 27, 48], [28, 49, 7], [50, 8, 29], [9, 30, 51], [31, 52, 10], [53, 11, 32], [12, 33, 54], [34, 55, 13], [56, 14, 35], [15, 36, 57], [37, 58, 16], [59, 17, 38], [18, 39, 60], [40, 61, 19], [62, 20, 41]];
  let out = '';
  const enc = (b2: number, b1: number, b0: number, n: number) => { let w = (b2 << 16) | (b1 << 8) | b0; for (let i = 0; i < n; i++) { out += ITOA[w & 63]; w >>= 6; } };
  for (const [x, y, z] of order) enc(C[x], C[y], C[z], 4);
  enc(0, 0, C[63], 2);
  return `$6$${rounds !== 5000 ? `rounds=${rounds}$` : ''}${S.toString()}$${out}`;
}
function randomSalt(): string { const r = randomBytes(16); let s = ''; for (const b of r) s += ITOA[b & 63]; return s; }
