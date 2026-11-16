// Genèse · clé USB — les DISQUES DE MACHINES VIRTUELLES posés sur la clé, façon extensions de Ventoy.
//   - Windows : VHD et VHDX démarrent tels quels (Ventoy les monte, Windows s'y lance) ;
//   - Linux : un disque .vtoy / .img / .vhd / .raw démarre après une préparation de l'initramfs (notre outil
//     odin-boot, voir odin-boot.ts) ;
//   - VMDK (VMware), QCOW2 (QEMU/Proxmox), VDI (VirtualBox) : à convertir d'abord en VHD ou en raw avec
//     qemu-img (s'il est présent) ;
//   - macOS : un disque virtuel macOS NE démarre PAS sur un PC ordinaire, et la licence d'Apple l'interdit hors
//     matériel Apple. La page le dit, au lieu de faire semblant.
// Tout est PUR ici : on reconnaît le format par le nom et, quand on l'a, par les premiers octets ; on dit ce
// qui marche et ce qu'il faut faire. Aucune conversion n'est lancée ici.

export type FormatVdisk = 'vhd' | 'vhdx' | 'vtoy' | 'raw' | 'vmdk' | 'qcow2' | 'vdi' | 'inconnu';
export type FamilleVdisk = 'windows' | 'linux' | 'macos' | 'inconnu';

export interface AnalyseVdisk {
  format: FormatVdisk;
  famille: FamilleVdisk;
  /** vrai : le disque démarre tel quel depuis la clé (VHD/VHDX Windows) */
  demarreTelQuel: boolean;
  /** vrai : il faut convertir le format avant (VMDK/QCOW2/VDI) */
  convertir: boolean;
  /** le format cible de la conversion, s'il y a lieu */
  cible?: 'vhd' | 'raw';
  /** la commande qemu-img à lancer (montrée avant, jamais exécutée ici) */
  commandeConversion?: string;
  /** vrai : un disque Linux à préparer avec odin-boot avant de pouvoir démarrer depuis la clé */
  prepareOdinBoot: boolean;
  /** ce qu'Odin dit honnêtement dans la page : ce qui marche, ce qui ne marche pas */
  message: string;
}

/** Le format d'un disque virtuel d'après son extension. Pur. */
export function formatParNom(nom: string): FormatVdisk {
  const e = (/\.([a-z0-9]+)$/i.exec(nom.toLowerCase())?.[1]) ?? '';
  const t: Record<string, FormatVdisk> = { vhd: 'vhd', vhdx: 'vhdx', vtoy: 'vtoy', img: 'raw', raw: 'raw', vmdk: 'vmdk', qcow2: 'qcow2', qcow: 'qcow2', vdi: 'vdi' };
  return t[e] ?? 'inconnu';
}

/** Le format d'après les premiers octets du fichier (la « signature »), plus sûr que l'extension. Pur. */
export function formatParEntete(entete: Buffer): FormatVdisk {
  if (entete.length >= 8) {
    const t4 = entete.subarray(0, 4).toString('latin1');
    if (t4 === 'QFI\xfb') return 'qcow2';
    if (entete.subarray(0, 8).toString('latin1') === 'vhdxfile') return 'vhdx';
    if (entete.subarray(0, 0x40).includes(Buffer.from('<<< Oracle VM VirtualBox Disk Image >>>'))) return 'vdi';
    if (entete.subarray(0, 4).toString('latin1') === 'KDMV') return 'vmdk';
  }
  return 'inconnu';
}

/** La famille d'un système d'après le nom du fichier (indice, à confirmer). Pur. */
export function familleParNom(nom: string): FamilleVdisk {
  const n = nom.toLowerCase();
  if (/windows|win1[01]|win7|winserv|w10|w11/.test(n)) return 'windows';
  if (/macos|osx|mac-os|sonoma|ventura|monterey|sequoia/.test(n)) return 'macos';
  if (/ubuntu|debian|fedora|arch|linux|mint|rocky|alma|suse|centos/.test(n)) return 'linux';
  return 'inconnu';
}

/** Analyse complète d'un disque virtuel : format, famille, ce qui marche, ce qu'il faut faire. Pur.
 *  @param entete facultatif : les premiers octets, pour confirmer le format (sinon on se fie au nom). */
export function analyserVdisk(nom: string, entete?: Buffer): AnalyseVdisk {
  const format = (entete ? formatParEntete(entete) : 'inconnu') !== 'inconnu' && entete ? formatParEntete(entete) : formatParNom(nom);
  // La famille : le nom, mais un .vhdx est presque toujours Windows, un .vtoy toujours Linux.
  let famille = familleParNom(nom);
  if (famille === 'inconnu') { if (format === 'vhdx') famille = 'windows'; else if (format === 'vtoy') famille = 'linux'; }

  if (famille === 'macos') {
    return { format, famille, demarreTelQuel: false, convertir: false, prepareOdinBoot: false,
      message: 'macOS ne démarre pas comme disque virtuel sur un PC ordinaire, et la licence d\'Apple l\'interdit hors matériel Apple. Odin ne le propose pas.' };
  }

  const aConvertir = ['vmdk', 'qcow2', 'vdi'].includes(format);
  if (aConvertir) {
    const cible = famille === 'windows' ? 'vhd' : 'raw';
    const sortie = nom.replace(/\.[a-z0-9]+$/i, `.${cible === 'vhd' ? 'vhd' : 'img'}`);
    return { format, famille, demarreTelQuel: false, convertir: true, cible,
      commandeConversion: `qemu-img convert -O ${cible === 'vhd' ? 'vpc' : 'raw'} "${nom}" "${sortie}"`,
      prepareOdinBoot: famille === 'linux',
      message: `Format ${format.toUpperCase()} : à convertir en ${cible === 'vhd' ? 'VHD' : 'image brute'} avec qemu-img avant de le poser sur la clé${famille === 'linux' ? ', puis à préparer avec odin-boot' : ''}. Si qemu-img n\'est pas installé, Odin te le dira.` };
  }

  if (famille === 'windows' && (format === 'vhd' || format === 'vhdx')) {
    return { format, famille, demarreTelQuel: true, convertir: false, prepareOdinBoot: false,
      message: 'VHD/VHDX Windows : se copie sur la clé et démarre tel quel. Rien à préparer.' };
  }

  if (famille === 'linux' && ['vhd', 'raw', 'vtoy'].includes(format)) {
    return { format, famille, demarreTelQuel: format === 'vtoy', convertir: false, prepareOdinBoot: format !== 'vtoy',
      message: format === 'vtoy'
        ? 'Disque Linux déjà préparé (.vtoy) : se copie sur la clé et démarre.'
        : 'Disque Linux : à préparer une fois avec odin-boot (il ajoute à l\'initramfs de quoi retrouver le disque sur la clé), puis il démarre depuis la clé.' };
  }

  return { format, famille, demarreTelQuel: false, convertir: false, prepareOdinBoot: false,
    message: 'Format de disque virtuel non reconnu : Odin ne sait pas le faire démarrer. Donne un VHD/VHDX (Windows) ou une image Linux (.img/.raw/.vtoy).' };
}
