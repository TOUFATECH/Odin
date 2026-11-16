// Genèse · clé USB — le PLAN d'un double démarrage sur un disque INTERNE, calculé et affiché AVANT toute
// écriture. Ici, rien n'est exécuté : aucune commande de partition. On lit l'état du disque (déjà détecté par
// disques.ts) et on dit, en clair, ce qu'Odin ferait : « Ce disque a Windows sur 400 Go ; je réduis Windows de
// 60 Go, je crée une partition ODIN de 60 Go et j'ajoute Odin au menu de démarrage ; rien n'est effacé ».
//
// Garde-fous (règle absolue du propriétaire) :
//  - jamais d'effacement d'une partition existante : seulement de l'espace libre, ou une réduction vérifiée ;
//  - arrêt net si le disque est chiffré sans clé de récupération (BitLocker, FileVault, LUKS) ;
//  - une réduction n'est proposée que si la partition visée a un système de fichiers connu, sain, et assez de
//    place réellement libre ;
//  - le disque du système en cours ne se touche qu'avec ce plan, une confirmation forte et l'accord d'Odin.

import type { Disque, Partition } from './disques.ts';

const GO = 1024 ** 3;
export const ODIN_MIN_GO = 25;

/** Une étape du plan, dite en français, avec son effet (sûr, ou à confirmer). */
export interface Etape {
  texte: string;
  /** vrai : rien n'est détruit (ajout dans l'espace libre, nouvelle entrée de menu) */
  sur: boolean;
}

export interface Plan {
  /** vrai : le plan peut être proposé ; faux : Odin s'arrête et dit pourquoi */
  possible: boolean;
  /** la raison de l'arrêt, s'il y a lieu */
  blocage?: string;
  /** la manière d'obtenir la place : de l'espace déjà libre, ou une réduction d'une partition saine */
  methode?: 'espace-libre' | 'reduction';
  /** la partition qu'on réduirait (jamais effacée), le cas échéant */
  reduire?: { nom: string; systeme?: string; deOctets: number; versOctets: number; gagneOctets: number };
  /** la partition ODIN qui serait créée */
  nouvelle?: { label: 'ODIN'; tailleOctets: number };
  etapes: Etape[];
  /** ce qui est sauvegardé avant d'écrire (table de partitions, entrée de démarrage) */
  sauvegardes: string[];
  avertissements: string[];
}

const fmtGo = (o: number) => `${Math.round(o / GO)} Go`;

/** L'espace libre d'un disque : sa taille moins ce que prennent les partitions. Pur. */
export function espaceLibre(d: Disque): number {
  const pris = d.partitions.reduce((s, p) => s + Math.max(0, p.tailleOctets), 0);
  return Math.max(0, d.tailleOctets - pris);
}

/** Un système de fichiers qu'Odin sait réduire sans risque (Windows NTFS, ext4). Pur. */
function reductible(p: Partition): boolean {
  const f = (p.fs ?? '').toLowerCase();
  return !p.chiffre && (f === 'ntfs' || f === 'ext4' || f === 'ext3');
}

/**
 * Le plan de double démarrage : installer Odin À CÔTÉ de l'existant, sans rien casser. Pur.
 * @param d le disque interne visé (déjà détecté)
 * @param tailleGo la taille voulue pour la partition ODIN (Go)
 */
export function planDualBoot(d: Disque, tailleGo = ODIN_MIN_GO): Plan {
  const avert: string[] = [];
  const besoin = Math.max(ODIN_MIN_GO, Math.round(tailleGo)) * GO;
  // Arrêt net : un disque chiffré sans clé de récupération ne doit jamais être redimensionné.
  const chiffre = d.chiffre ?? d.partitions.find((p) => p.chiffre)?.chiffre;
  if (chiffre) {
    const nom = { bitlocker: 'BitLocker', filevault: 'FileVault', luks: 'LUKS' }[chiffre];
    return { possible: false, blocage: `Ce disque est chiffré (${nom}). Odin ne le touche pas tant que tu n'as pas sa clé de récupération : déchiffre-le ou donne la clé, puis recommence.`, etapes: [], sauvegardes: [], avertissements: avert };
  }
  // macOS : on ne touche pas au disque d'un Mac ici (voir la page : Boot Camp / Asahi, selon le Mac).
  if (d.partitions.some((p) => p.systeme === 'macos')) avert.push('Ce disque contient macOS : sur un Mac, le double démarrage passe par les outils d\'Apple (Boot Camp sur Mac Intel) ou Asahi Linux (Mac Apple Silicon). Voir la page.');

  const libre = espaceLibre(d);
  // 1) De l'espace déjà libre : le plus sûr, rien n'est touché.
  if (libre >= besoin) {
    return {
      possible: true, methode: 'espace-libre', nouvelle: { label: 'ODIN', tailleOctets: besoin },
      etapes: [
        { texte: `Ce disque a ${fmtGo(libre)} d'espace libre.`, sur: true },
        { texte: `Je crée une partition « ODIN » de ${fmtGo(besoin)} dans cet espace libre. Rien n'est effacé.`, sur: true },
        { texte: 'J\'ajoute « Odin » au menu de démarrage du PC, à côté de ce qui existe déjà.', sur: true },
      ],
      sauvegardes: ['la table de partitions du disque', 'l\'entrée de démarrage actuelle'], avertissements: avert,
    };
  }
  // 2) Réduire une partition saine : seulement si elle a un FS connu et assez de place réellement libre.
  const candidates = d.partitions
    .filter(reductible)
    .map((p) => ({ p, libreDedans: p.utiliseOctets !== undefined ? p.tailleOctets - p.utiliseOctets : undefined }))
    .filter((x) => x.libreDedans !== undefined && x.libreDedans - besoin >= 10 * GO) // 10 Go de marge gardés au système
    .sort((a, b) => (b.libreDedans ?? 0) - (a.libreDedans ?? 0));
  const c = candidates[0];
  if (c && c.libreDedans !== undefined) {
    const manque = besoin - libre;
    const versOctets = c.p.tailleOctets - manque;
    const nomSys = c.p.systeme === 'windows' ? 'Windows' : c.p.systeme === 'linux' ? 'Linux' : (c.p.label ?? c.p.nom);
    return {
      possible: true, methode: 'reduction',
      reduire: { nom: c.p.nom, ...(nomSys ? { systeme: nomSys } : {}), deOctets: c.p.tailleOctets, versOctets, gagneOctets: manque },
      nouvelle: { label: 'ODIN', tailleOctets: besoin },
      etapes: [
        { texte: `Ce disque a ${nomSys} sur ${fmtGo(c.p.tailleOctets)}${c.p.utiliseOctets !== undefined ? ` (dont ${fmtGo(c.p.utiliseOctets)} occupés)` : ''}.`, sur: true },
        { texte: `Je vérifie que ${nomSys} est sain, puis je le réduis de ${fmtGo(manque)} (il restera ${fmtGo(versOctets)}). Aucune donnée n'est effacée.`, sur: false },
        { texte: `Je crée une partition « ODIN » de ${fmtGo(besoin)} dans la place ainsi libérée.`, sur: true },
        { texte: 'J\'ajoute « Odin » au menu de démarrage du PC, sans remplacer le chargeur existant.', sur: true },
      ],
      sauvegardes: ['la table de partitions du disque (avant la réduction)', 'l\'entrée de démarrage actuelle'],
      avertissements: [...avert, `Ferme ${nomSys} proprement avant (pas de mise en veille prolongée), pour que la réduction soit sûre.`],
    };
  }
  // Pas de place : on refuse plutôt que de toucher à l'existant.
  const grosse = [...d.partitions].sort((a, b) => b.tailleOctets - a.tailleOctets)[0];
  const raison = grosse && !reductible(grosse)
    ? `La plus grande partition (${grosse.fs ?? 'système de fichiers inconnu'}) ne peut pas être réduite sans risque par Odin.`
    : `Il manque de la place : il faut ${fmtGo(besoin)} libres, et ce disque n'en a pas assez à récupérer.`;
  return { possible: false, blocage: `${raison} Libère de la place (déplace ou supprime des fichiers toi-même), puis recommence.`, etapes: [], sauvegardes: [], avertissements: avert };
}

/** Le plan pour RETIRER Odin d'un disque (défaire le double démarrage) : enlever l'entrée de menu et la
 *  partition ODIN ; jamais les autres partitions. On rend de la place à l'existant. Pur. */
export function planRetrait(d: Disque): Plan {
  const odin = d.partitions.find((p) => p.label?.toUpperCase() === 'ODIN' || p.systeme === 'odin');
  if (!odin) return { possible: false, blocage: 'Aucune partition « ODIN » sur ce disque : il n\'y a rien à retirer.', etapes: [], sauvegardes: [], avertissements: [] };
  return {
    possible: true, methode: 'espace-libre',
    etapes: [
      { texte: 'J\'enlève l\'entrée « Odin » du menu de démarrage du PC (le chargeur existant est remis en avant).', sur: true },
      { texte: `Je supprime la partition « ODIN » (${fmtGo(odin.tailleOctets)}) et je rends sa place au disque. Les autres partitions ne sont pas touchées.`, sur: false },
      { texte: 'Tu peux ensuite agrandir une partition voisine toi-même pour récupérer cette place, si tu veux.', sur: true },
    ],
    sauvegardes: ['la table de partitions du disque', 'l\'entrée de démarrage actuelle'],
    avertissements: ['Vérifie que tu n\'as rien laissé d\'important sur la partition ODIN : elle sera supprimée.'],
  };
}
