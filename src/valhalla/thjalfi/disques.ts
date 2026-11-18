// Genèse · clé USB — voir sûrement TOUS les disques de la machine où Odin tourne, et les ranger en deux
// familles : « externes » (clés USB, disques et SSD externes, cartes mémoire) et « internes » (les disques du
// PC, dont celui du système en cours). Pour chaque disque : son genre reconnu par le bus, sa taille, son
// modèle, ses partitions avec leur occupation, les systèmes déjà présents (Windows, Linux, macOS) et le
// chiffrement (BitLocker, LUKS, FileVault).
//
// Rien n'est écrit ici : ce module ne fait QUE lire et classer. Les parseurs (parseLsblk, parseGetDisk) sont
// PURS — ils prennent la sortie figée d'une commande et rendent la liste des disques, sans rien lancer. Pour
// les essais, une « source simulée » rend une fausse liste : jamais un vrai disque n'est touché.

import { ARGS_BITLOCKER, bitLockerPourGenese, lireBitLocker, type SortieBitLocker } from '../../securite/disque-chiffre.ts';

/** Le genre d'un disque, deviné par le bus et la taille (pour l'icône de la page, façon Utilitaire de disque). */
export type Genre = 'cle' | 'disque-externe' | 'ssd' | 'carte' | 'interne';
/** Un système reconnu sur une partition, d'après son système de fichiers et son nom. */
export type SystemePresent = 'windows' | 'linux' | 'macos' | 'efi' | 'recovery' | 'odin' | 'donnees';
/** Un chiffrement reconnu (le disque est verrouillé tant qu'on n'a pas sa clé). */
export type Chiffrement = 'bitlocker' | 'luks' | 'filevault';

export interface Partition {
  /** le nom du périphérique (sda1, Disk #0 Partition 2…) */
  nom: string;
  /** l'étiquette de volume, si elle existe (ODIN, Windows, Data…) */
  label?: string;
  /** le système de fichiers (ntfs, ext4, vfat, apfs…) */
  fs?: string;
  tailleOctets: number;
  /** l'espace déjà occupé, quand on le connaît (sinon absent) */
  utiliseOctets?: number;
  /** le système reconnu sur cette partition */
  systeme?: SystemePresent;
  /** le chiffrement de cette partition, s'il y en a un */
  chiffre?: Chiffrement;
  /** le point de montage, s'il est monté */
  montage?: string;
  /** vrai : son chiffrement n'a pas pu être lu (droits d'administrateur manquants…) — ni « chiffré » ni « non chiffré » */
  chiffreInconnu?: true;
}

export interface Disque {
  /** un identifiant stable pour la page (chemin nettoyé) */
  id: string;
  /** le chemin du périphérique (/dev/sda, \\.\PhysicalDrive0…) */
  chemin: string;
  modele?: string;
  tailleOctets: number;
  genre: Genre;
  /** vrai : disque externe (clé, disque externe, carte) ; faux : disque interne du PC */
  externe: boolean;
  /** le bus (usb, sata, nvme, sd…) tel que la commande le donne */
  bus?: string;
  /** vrai : le disque peut être retiré (clé, carte, disque externe) */
  amovible: boolean;
  /** vrai : c'est le disque d'où tourne le système en ce moment (jamais effacé) */
  systemeEnCours?: boolean;
  /** vrai : la clé est déjà une clé ODIN (mise à jour sans tout effacer) */
  estOdin?: boolean;
  partitions: Partition[];
  /** le chiffrement global du disque, s'il est connu avant d'ouvrir les partitions */
  chiffre?: Chiffrement;
}

export interface Disques { externes: Disque[]; internes: Disque[] }

const KILO = 1024;
/** Un identifiant stable et lisible tiré du chemin du disque. Pur. */
const idDe = (chemin: string) => chemin.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'disque';

/** Le genre d'un disque d'après son bus, s'il est amovible et sa taille. Pur. */
export function genreDisque(bus: string | undefined, amovible: boolean, tailleOctets: number): Genre {
  const b = (bus ?? '').toLowerCase();
  if (/sd|mmc/.test(b)) return 'carte';
  if (!amovible) return 'interne';
  // Amovible : une petite capacité branchée en USB est une clé ; au-delà de ~130 Go, un disque externe.
  if (/usb/.test(b)) return tailleOctets > 130 * KILO ** 3 ? 'disque-externe' : 'cle';
  return 'disque-externe';
}

/** Le système reconnu sur une partition, d'après son système de fichiers et son étiquette. Pur. */
export function systemeDe(fs: string | undefined, label: string | undefined): SystemePresent | undefined {
  const f = (fs ?? '').toLowerCase(), l = (label ?? '').toLowerCase();
  if (l === 'odin') return 'odin';
  if (/recovery|winre|récupération|recuperation/.test(l)) return 'recovery';
  if (f === 'vfat' || f === 'fat32' || f === 'fat' || /efi|system/.test(l)) { if (/efi/.test(l) || f === 'vfat' || f === 'fat32') return 'efi'; }
  if (f === 'ntfs' || /windows/.test(l)) return 'windows';
  if (/^(ext[234]|btrfs|xfs|f2fs|reiserfs)$/.test(f) || /linux|ubuntu|debian/.test(l)) return 'linux';
  if (/^(apfs|hfsplus|hfs)$/.test(f) || /macintosh|macos/.test(l)) return 'macos';
  if (f === 'vfat' || f === 'fat32' || f === 'exfat') return 'donnees';
  return undefined;
}

/** Le chiffrement d'après le système de fichiers / type de partition. Pur. */
export function chiffrementDe(fstype: string | undefined, type: string | undefined): Chiffrement | undefined {
  const x = `${(fstype ?? '').toLowerCase()} ${(type ?? '').toLowerCase()}`;
  if (/crypto_luks|luks/.test(x)) return 'luks';
  if (/bitlocker/.test(x)) return 'bitlocker';
  if (/filevault|apple_corestorage/.test(x)) return 'filevault';
  return undefined;
}

// ---------------- Linux : lsblk -J -O -b ----------------
interface LsblkNode {
  name?: string; path?: string; type?: string; size?: number | string; model?: string; serial?: string;
  tran?: string; rm?: boolean; hotplug?: boolean; ro?: boolean; label?: string; fstype?: string;
  fsused?: number | string; mountpoint?: string | null; mountpoints?: Array<string | null>; pkname?: string | null;
  children?: LsblkNode[];
}
const nombre = (x: number | string | undefined): number => (typeof x === 'number' ? x : x ? Number(x) || 0 : 0);

/**
 * Lit la sortie JSON de `lsblk -J -O -b` (Linux) et rend la liste des disques. Pur.
 * Un disque branché en USB (tran=usb) ou amovible (rm=1) est « externe » ; les cartes SD (tran=sd/mmc) aussi.
 */
export function parseLsblk(json: string, racineSysteme?: string): Disque[] {
  let root: { blockdevices?: LsblkNode[] };
  try { root = JSON.parse(json); } catch { return []; }
  const out: Disque[] = [];
  for (const d of root.blockdevices ?? []) {
    if (d.type !== 'disk' && d.type !== 'loop') continue;
    const bus = d.tran ?? undefined, amovible = Boolean(d.rm) || Boolean(d.hotplug) || bus === 'usb' || bus === 'sd';
    const taille = nombre(d.size);
    const parts: Partition[] = [];
    let systemeEnCours = false;
    const chercherParts = (n: LsblkNode) => {
      for (const c of n.children ?? []) {
        if (c.type === 'crypt') { chercherParts(c); continue; }
        const montages = (c.mountpoints ?? [c.mountpoint ?? null]).filter(Boolean) as string[];
        if (montages.includes('/') || montages.includes('/boot') || montages.includes('/boot/efi')) systemeEnCours = true;
        const chiffre = chiffrementDe(c.fstype, c.type);
        const p: Partition = {
          nom: c.name ?? '', ...(c.label ? { label: c.label } : {}), ...(c.fstype ? { fs: c.fstype } : {}),
          tailleOctets: nombre(c.size), ...(c.fsused !== undefined ? { utiliseOctets: nombre(c.fsused) } : {}),
          ...(montages[0] ? { montage: montages[0] } : {}),
        };
        const sys = chiffre ? undefined : systemeDe(c.fstype, c.label);
        if (sys) p.systeme = sys; if (chiffre) p.chiffre = chiffre;
        parts.push(p);
        if (c.children?.length) chercherParts(c);
      }
    };
    chercherParts(d);
    const chemin = d.path ?? `/dev/${d.name ?? ''}`;
    if (racineSysteme && chemin === racineSysteme) systemeEnCours = true;
    const dis: Disque = {
      id: idDe(chemin), chemin, ...(d.model ? { modele: d.model.trim() } : {}), tailleOctets: taille,
      genre: genreDisque(bus, amovible, taille), externe: amovible, ...(bus ? { bus } : {}), amovible,
      ...(systemeEnCours ? { systemeEnCours: true } : {}), partitions: parts,
    };
    if (parts.some((p) => p.label?.toUpperCase() === 'ODIN')) dis.estOdin = true;
    out.push(dis);
  }
  return out;
}

// ---------------- Windows : Get-Disk / Get-Partition / Get-Volume / BitLocker (Win32_EncryptableVolume) ----------------
/** Ce qu'Odin ramasse côté Windows (chaque commande rendue en JSON, réunies dans un objet). */
export interface SortieWindows {
  disks: Array<{ Number: number; FriendlyName?: string; Model?: string; Size?: number; BusType?: string; IsBoot?: boolean; IsSystem?: boolean; Path?: string }>;
  partitions: Array<{ DiskNumber: number; PartitionNumber: number; DriveLetter?: string | null; Size?: number; Type?: string; GptType?: string; IsBoot?: boolean; IsSystem?: boolean }>;
  volumes: Array<{ DriveLetter?: string | null; FileSystem?: string | null; FileSystemLabel?: string | null; Size?: number; SizeRemaining?: number }>;
  /** BitLocker par lettre de lecteur (lecture de securite/disque-chiffre.ts, déjà réduite) : vrai, faux, ou « inconnu » si elle n'a pas pu se faire */
  bitlocker?: Record<string, boolean | 'inconnu'>;
}
const BUS_WIN: Record<string, string> = { USB: 'usb', SATA: 'sata', NVMe: 'nvme', RAID: 'raid', SAS: 'sas', ATA: 'sata', SD: 'sd', MMC: 'sd', 'File Backed Virtual': 'virtuel' };

/** Lit les sorties de Get-Disk/Get-Partition/Get-Volume (+ BitLocker) et rend la liste des disques. Pur. */
export function parseGetDisk(w: SortieWindows): Disque[] {
  const volParLettre = new Map<string, SortieWindows['volumes'][number]>();
  for (const v of w.volumes ?? []) if (v.DriveLetter) volParLettre.set(String(v.DriveLetter).toUpperCase(), v);
  const out: Disque[] = [];
  for (const d of w.disks ?? []) {
    const bus = BUS_WIN[d.BusType ?? ''] ?? ((d.BusType ?? '').toLowerCase() || undefined);
    const amovible = bus === 'usb' || bus === 'sd';
    const taille = Number(d.Size) || 0;
    const parts: Partition[] = [];
    for (const p of (w.partitions ?? []).filter((x) => x.DiskNumber === d.Number)) {
      const lettre = p.DriveLetter ? String(p.DriveLetter).toUpperCase() : '';
      const v = lettre ? volParLettre.get(lettre) : undefined;
      const gpt = (p.GptType ?? '').toLowerCase(), type = (p.Type ?? '').toLowerCase();
      const efi = type === 'system' || /c12a7328-f81f-11d2-ba4b-00a0c93ec93b/.test(gpt);
      const recovery = type === 'recovery' || /de94bba4-06d1-4d40-a16a-bfd50179d6ac/.test(gpt);
      const part: Partition = {
        nom: `Disque ${d.Number} partition ${p.PartitionNumber}`, ...(v?.FileSystemLabel ? { label: v.FileSystemLabel } : {}),
        ...(v?.FileSystem ? { fs: v.FileSystem.toLowerCase() } : {}), tailleOctets: Number(p.Size ?? v?.Size) || 0,
        ...(v && v.Size !== undefined && v.SizeRemaining !== undefined ? { utiliseOctets: Number(v.Size) - Number(v.SizeRemaining) } : {}),
        ...(lettre ? { montage: `${lettre}:` } : {}),
      };
      const sys: SystemePresent | undefined = efi ? 'efi' : recovery ? 'recovery' : systemeDe(v?.FileSystem ?? undefined, v?.FileSystemLabel ?? undefined);
      if (sys) part.systeme = sys;
      const bl = lettre ? w.bitlocker?.[lettre] : undefined;
      if (bl === true) part.chiffre = 'bitlocker';
      else if (bl === 'inconnu') part.chiffreInconnu = true;
      parts.push(part);
    }
    const chemin = d.Path ?? `\\\\.\\PhysicalDrive${d.Number}`;
    const dis: Disque = {
      id: idDe(`physicaldrive${d.Number}`), chemin, ...(d.FriendlyName || d.Model ? { modele: (d.FriendlyName ?? d.Model ?? '').trim() } : {}),
      tailleOctets: taille, genre: genreDisque(bus, amovible, taille), externe: amovible, ...(bus ? { bus } : {}), amovible,
      ...(d.IsBoot || d.IsSystem ? { systemeEnCours: true } : {}), partitions: parts,
    };
    if (parts.some((p) => p.label?.toUpperCase() === 'ODIN')) dis.estOdin = true;
    out.push(dis);
  }
  return out;
}

/** Range les disques en « externes » et « internes » (l'ordre : d'abord le genre, puis le modèle). Pur. */
export function classer(disques: Disque[]): Disques {
  const tri = (a: Disque, b: Disque) => (a.modele ?? a.chemin).localeCompare(b.modele ?? b.chemin);
  return {
    externes: disques.filter((d) => d.externe).sort(tri),
    internes: disques.filter((d) => !d.externe).sort(tri),
  };
}

// ---------------- La source des disques (vraie ou simulée) ----------------
/** Une source rend la liste des disques ; la vraie lance les commandes, la simulée rend une fausse liste. */
export interface SourceDisques { lister(): Promise<Disque[]> }

/** Source SIMULÉE pour les essais : une liste figée, aucune commande, aucun vrai disque touché. */
export function sourceSimulee(disques: Disque[]): SourceDisques {
  return { lister: async () => disques.map((d) => ({ ...d, partitions: d.partitions.map((p) => ({ ...p })) })) };
}

/** Lance une commande et rend sa sortie texte (séparé pour que les essais ne lancent jamais rien). */
export type Lanceur = (cmd: string, args: string[]) => Promise<string>;

/**
 * Source RÉELLE : lit les disques de la machine où Odin tourne.
 *  - Windows : Get-Disk, Get-Partition, Get-Volume, et BitLocker ;
 *  - Linux : lsblk -J -O -b.
 * Rien n'est écrit. Les commandes sont passées par un « lanceur » (injecté), jamais appelées en dur ici, pour
 * que ce module reste testable sans toucher au système.
 */
export function sourceReelle(plateforme: NodeJS.Platform, lancer: Lanceur, racineSysteme?: string): SourceDisques {
  return {
    async lister(): Promise<Disque[]> {
      if (plateforme === 'win32') {
        const ps = async (expr: string) => { try { return await lancer('powershell', ['-NoProfile', '-NonInteractive', '-Command', `${expr} | ConvertTo-Json -Depth 3 -Compress`]); } catch { return '[]'; } };
        const lire = <T,>(t: string): T[] => { try { const v = JSON.parse(t || '[]'); return Array.isArray(v) ? v : [v]; } catch { return []; } };
        const w: SortieWindows = {
          disks: lire(await ps('Get-Disk | Select-Object Number,FriendlyName,Model,Size,BusType,IsBoot,IsSystem,Path')),
          partitions: lire(await ps('Get-Partition | Select-Object DiskNumber,PartitionNumber,DriveLetter,Size,Type,GptType,IsBoot,IsSystem')),
          volumes: lire(await ps('Get-Volume | Select-Object DriveLetter,FileSystem,FileSystemLabel,Size,SizeRemaining')),
        };
        // BitLocker par lettre (Get-Volume rend « NTFS » pour un volume BitLocker ouvert). Lecture seule, sans clé ;
        // sans les droits d'administrateur, chaque lettre vaut « inconnu », jamais « non chiffré ».
        let bl: SortieBitLocker = { lecture: 'illisible', parLettre: {} };
        try { bl = lireBitLocker(await lancer('powershell', [...ARGS_BITLOCKER])); } catch { /* lecture impossible : inconnu */ }
        const lettres = new Set([...w.volumes, ...w.partitions].map((x) => String(x.DriveLetter ?? '').toUpperCase()).filter((l) => /^[A-Z]$/.test(l)));
        w.bitlocker = Object.fromEntries([...lettres].map((l) => [l, bitLockerPourGenese(bl.parLettre[l])]));
        return parseGetDisk(w);
      }
      let json = '[]'; try { json = await lancer('lsblk', ['-J', '-O', '-b']); } catch { /* lsblk absent */ }
      return parseLsblk(json, racineSysteme);
    },
  };
}
