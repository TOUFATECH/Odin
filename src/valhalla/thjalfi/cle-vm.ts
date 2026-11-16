// Genèse · clé USB — COPIER une VM pour qu'elle DÉMARRE sur un vrai PC depuis la clé/le disque. Odin connaît déjà
// les machines virtuelles par Hydre (ymir) : on CHOISIT une VM, on copie son disque sur la clé, on le prépare.
//   - VM LOCALE d'Hydre (ce PC) : son disque qcow2 est lisible → copie directe (conversion si besoin + odin-boot
//     pour un Linux, ou VHDX Windows To Go + injection des pilotes de base pour un Windows).
//   - VM d'un serveur PROXMOX du cluster : Hydre n'expose PAS le disque d'une telle VM → on le dit honnêtement et
//     on propose la voie « disque exporté déposé » (vzdump/qm/qemu-img côté Proxmox, puis dépôt à la racine).
//
// Honnêteté (dite à la page) : une VM taillée pour une machine virtuelle peut manquer de pilotes sur un vrai PC ;
// la copie peut être grosse et longue (barre de progression, par le réseau depuis Proxmox) ; jamais la VM EN MARCHE
// sans l'arrêter proprement ou en faire un instantané d'abord (cohérence du disque).
//
// Tout est PUR ici : lister les VM (via Hydre) et MONTRER le plan de copie. La copie réelle passe par l'IO injectée
// de cle-ecrire.ts (copierDisqueVm) ; en test, un faux Hydre et une IO simulée — aucun vrai disque, aucun Proxmox réel.

import { DISPOSITION_CLE } from './cle-types.ts';
import type { SourceVm } from './cle-types.ts';
import { analyserVdisk, familleParNom } from './vdisk.ts';

/** Ce qu'il faut pour interroger Hydre : la méthode `call` d'un ModCtx (ou un faux, en test). */
export interface AppelHydre {
  call(module: string, action: string, input?: Record<string, unknown>, why?: string): Promise<{ data?: unknown; ok?: boolean; text?: string }>;
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/** La famille d'une VM d'après son système / son nom (Windows, Linux, ou inconnu). Pur. */
export function familleVm(indice: string): SourceVm['famille'] {
  const n = indice.toLowerCase();
  if (/windows|win1[01]|win7|winserv/.test(n)) return 'windows';
  const f = familleParNom(indice);
  if (f === 'linux') return 'linux';
  if (/debian|ubuntu|alpine|rocky|alma|fedora|arch|linux|mint|kali|centos|opensuse|nixos/.test(n)) return 'linux';
  return 'inconnu';
}

/**
 * La liste des VM qu'on peut copier sur la clé, via Hydre :
 *  - les VM LOCALES de ce PC (ctx.call('ymir','locales')) : disque qcow2 lisible → copie directe ;
 *  - les VM des serveurs Proxmox (ctx.call('ymir','machines')) : Hydre n'en donne pas le disque → voie « dépôt ».
 * Pur quant à Odin (ne lit rien du disque ici) : ne fait qu'interroger Hydre et ranger le résultat. Tolérant : si
 * une réponse n'a pas de données (Hydre absent, Proxmox non réglé), cette source est simplement vide.
 */
export async function listerVms(ctx: AppelHydre): Promise<SourceVm[]> {
  const out: SourceVm[] = [];
  // 1) Les VM locales d'Hydre (disque lisible).
  const loc = await ctx.call('ymir', 'locales', {}, 'les VM de ce PC pour une copie sur la clé').catch(() => ({ data: [] }));
  for (const m of asArray(loc.data)) {
    const o = obj(m);
    if (str(o.genre) !== 'vm') continue;
    out.push({
      origine: 'hydre-locale', vmid: str(o.id), nom: str(o.nom),
      famille: familleVm(`${str(o.systeme)} ${str(o.nom)}`),
      // Le disque qcow2 d'une VM locale d'Hydre (rangé dans son dossier vm/<nom>/disque.qcow2).
      disque: `${str(o.nom)}/disque.qcow2`, instantaneFait: false,
    });
  }
  // 2) Les VM des serveurs Proxmox du cluster (pas de disque exposé).
  const pve = await ctx.call('ymir', 'machines', {}, 'les VM Proxmox pour une copie sur la clé').catch(() => ({ data: [] }));
  for (const r of asArray(pve.data)) {
    const o = obj(r);
    if (o.vmid === undefined || str(o.type) === 'lxc') continue;
    out.push({
      origine: 'proxmox', vmid: typeof o.vmid === 'number' ? o.vmid : str(o.vmid),
      ...(str(o.server) ? { serveur: str(o.server) } : {}),
      nom: str(o.name) || `vm-${str(o.vmid)}`, famille: familleVm(str(o.name)), instantaneFait: false,
    });
  }
  return out;
}

export interface PlanCopieVm {
  /** vrai : la copie directe est possible ; faux : Odin s'arrête et dit pourquoi (dont la voie « dépôt ») */
  possible: boolean;
  blocage?: string;
  etapes: string[];
  avertissements: string[];
  /** le fichier posé sur la clé (/vdisk/…) une fois la copie faite */
  destination?: string;
  /** la commande de conversion (qemu-img) si le format source n'est pas démarrable tel quel ; montrée, jamais exécutée */
  conversion?: string;
  /** vrai : un disque Linux à préparer avec odin-boot avant de démarrer depuis la clé */
  prepareOdinBoot?: boolean;
  /** vrai : un Windows → VHDX Windows To Go + injection des pilotes de base (réseau/stockage) par DISM */
  pilotesWindows?: boolean;
  /** vrai : passer par un disque de VM exporté et déposé à la racine (VM Proxmox sans disque exposé) */
  voieDepot?: boolean;
}

/**
 * Le plan de copie d'une VM sur la clé. Pur : MONTRE les étapes, ne copie rien (la copie réelle passe par
 * IoCle.copierDisqueVm, avec une barre de progression). Garde-fous :
 *  - jamais la VM EN MARCHE : il faut l'arrêter proprement ou un instantané d'abord (source.instantaneFait) ;
 *  - VM Proxmox sans disque exposé → voie « disque exporté déposé » (on le dit, on ne fait pas semblant).
 */
export function planCopieVm(source: SourceVm): PlanCopieVm {
  const avert: string[] = [
    'Une VM taillée pour une machine virtuelle peut manquer de pilotes sur un vrai PC.',
    'La copie peut être grosse et longue (barre de progression ; par le réseau depuis Proxmox).',
  ];

  // VM Proxmox du cluster : Hydre ne donne pas son disque → voie « dépôt ».
  if (source.origine === 'proxmox' && !source.disque) {
    return {
      possible: false, voieDepot: true,
      blocage: `La VM « ${source.nom} » est sur un serveur Proxmox : Hydre n'expose pas son disque. Exporte-la côté Proxmox (vzdump/qm, puis qemu-img si besoin) et DÉPOSE le fichier obtenu à la racine de la clé — Odin le reconnaîtra et le préparera.`,
      etapes: [
        'Côté Proxmox : arrête la VM (ou prends un instantané), puis exporte son disque.',
        'Dépose le disque exporté à la racine de la clé : Odin l\'indexe et le prépare au démarrage.',
      ],
      avertissements: avert,
    };
  }

  // Jamais la VM en marche : arrêt propre ou instantané d'abord (cohérence du disque).
  if (!source.instantaneFait) {
    return {
      possible: false,
      blocage: `Arrête proprement « ${source.nom} », ou prends-en un instantané, AVANT de copier son disque : sinon la copie serait incohérente (fichiers à moitié écrits).`,
      etapes: ['Arrête la VM (arrêt propre) ou prends un instantané.', 'Puis relance la copie.'],
      avertissements: avert,
    };
  }

  const nom = source.nom.replace(/[^\w.+-]/g, '_') || 'vm';
  if (source.famille === 'windows') {
    const destination = `${DISPOSITION_CLE.vdisk}/${nom}-wintogo.vhdx`;
    return {
      possible: true, destination, pilotesWindows: true,
      etapes: [
        `J'enveloppe le disque de « ${source.nom} » en VHDX Windows To Go (posé dans /vdisk).`,
        'J\'injecte les pilotes de base (réseau/stockage : virtio → vrai matériel) par DISM /Add-Driver /Recurse.',
        'Ventoy démarre ce VHDX tel quel depuis la clé.',
      ],
      avertissements: [...avert, 'Windows : licence à vérifier, aucune activation contournée ; démarrage sécurisé expliqué à l\'écran.'],
    };
  }

  // Linux (ou inconnu traité comme Linux) : convertir si besoin, puis préparer avec odin-boot.
  const a = analyserVdisk(source.disque ?? `${nom}.qcow2`);
  const destination = `${DISPOSITION_CLE.vdisk}/${nom}.${a.cible === 'vhd' ? 'vhd' : 'img'}`;
  return {
    possible: true, destination,
    ...(a.convertir && a.commandeConversion ? { conversion: a.commandeConversion } : {}),
    prepareOdinBoot: true,
    etapes: [
      ...(a.convertir ? [`Je convertis le disque (${a.format.toUpperCase()}) au format brut avec qemu-img.`] : []),
      'Je prépare le disque avec odin-boot (il retrouve la clé au démarrage), puis je le pose dans /vdisk.',
      'Ventoy démarre ce disque depuis la clé.',
    ],
    avertissements: avert,
  };
}
