// Genèse · clé USB — la CIBLE de l'écriture (clé USB OU disque dur) et le PLAN DE PLACE affiché AVANT toute
// écriture. La même préparation (Ventoy + systèmes installés + menu) marche sur une clé comme sur un disque dur
// externe, et sur un disque interne quand Genèse y a déjà fait le double démarrage. Un gros disque externe peut
// tout contenir : plusieurs systèmes installés et beaucoup d'ISO.
//
// Garde-fous (règle absolue du propriétaire) :
//  - le plan est TOUJOURS affiché avant d'écrire (c'est son seul rôle ici) ;
//  - on n'écrit que sur la cible choisie : la liste des cibles écrivables sort d'ici, et l'écriture (cle-ecrire.ts)
//    ne touche que l'identifiant choisi — jamais un autre disque ;
//  - si la cible est trop petite, on REFUSE et on propose de réduire la liste, au lieu de tout tasser.
//
// Tout est PUR ici : on lit l'état (déjà détecté par disques.ts), on calcule, on dit. Aucune commande, aucune écriture.

import { choisissable, type Disque } from './disques.ts';
import type { Cible, GenreCible, PlanPlace, SystemeCle } from './cle-types.ts';
import { DISPOSITION_CLE } from './cle-types.ts';
import { planWinToGo, specPersistance } from './cle-install.ts';

const GO = 1024 ** 3;

/** La place que prend chaque genre de système installé (valeurs honnêtes, dites à la personne avant d'écrire). */
export const PLACE = {
  /** une installation Windows To Go tient dans un VHDX d'environ 32 Go */
  winToGoGo: 32,
  /** un Linux installé sur sa partition : 15 à 25 Go selon la distribution (20 par défaut) */
  linuxInstalleGo: 20,
  /** la partition ISO ODIN (les ISO, disques de VM, fichiers de persistance) : au moins 8 Go pour être utile */
  isoOdinMinGo: 8,
} as const;

/** À partir de combien un disque externe est « gros » (il peut tout contenir) : 250 Go. */
const GROS_DISQUE_GO = 250;

/** Le genre de cible d'après le genre de disque reconnu par disques.ts. Pur. */
export function genreCible(genreDisque: Disque['genre']): GenreCible {
  if (genreDisque === 'cle') return 'cle';
  if (genreDisque === 'interne') return 'disque-interne';
  return 'disque-externe'; // disque-externe, ssd, carte
}

/** Une cible (ce sur quoi on écrit) à partir d'un disque détecté. Pur. */
export function cibleDepuisDisque(d: Disque): Cible {
  return { id: d.id, genre: genreCible(d.genre), tailleOctets: d.tailleOctets, estOdin: Boolean(d.estOdin) };
}

/**
 * La liste des cibles ÉCRIVABLES : la MÊME règle que l'étape « Clé » (disques.ts, `choisissable`) — branchées de
 * l'extérieur, retirables, ni le disque du système, ni un disque d'où tourne un système « live », ni celui qui porte
 * Odin. Plus aucun disque interne, même déjà ODIN : le double démarrage sur un disque INTERNE garde sa propre action
 * (cle_plan, cle-plan.ts), à part et inchangée. Pur.
 */
export function ciblesEcrivables(disques: Disque[]): Cible[] {
  return disques.filter((d) => choisissable(d)).map(cibleDepuisDisque);
}

/** Un nom de fichier sûr sur la clé (liste blanche : lettres, chiffres, . _ + -). Pur. */
const nomSur = (n: string) => String(n ?? '').replace(/\.[^.]+$/, '').replace(/[^\w.+-]/g, '_');

/**
 * OÙ va un système installé, et combien de place il prend : LE calcul unique que lisent le plan (planPlace) et
 * l'écriture (cle-ecrire.ts). Un Windows installé est un disque virtuel (VHDX) posé dans /vdisk sur la partition ISO
 * ODIN ; une persistance est un fichier dans /persistence ; un Linux installé a sa vraie partition. ISO et VM : rien
 * (des fichiers ordinaires). Pur.
 */
export function placeInstalle(s: SystemeCle): { role: 'WinToGo' | 'Linux installé' | 'persistance'; tailleGo: number; lieu: 'partition' | 'fichier'; fichier?: string } | undefined {
  const choix = s.choix ?? 'iso';
  // La famille peut arriver capitalisée du serveur ('Windows') ou en minuscule de la page ('windows') : on compare
  // sans tenir compte de la casse, sinon un Windows « installé » retombe à tort en « Linux installé ».
  const estWindows = String(s.famille).toLowerCase() === 'windows';
  if (choix === 'installe') {
    if (s.winToGo || estWindows) {
      const tailleGo = Math.max(1, Math.round(s.winToGo?.tailleGo ?? PLACE.winToGoGo));
      const vhdx = planWinToGo(s.fichier, s.nom, { tailleGo }).vhdx.replace(/^.*\//, '');
      return { role: 'WinToGo', tailleGo, lieu: 'fichier', fichier: `${DISPOSITION_CLE.vdisk.slice(1)}/${vhdx}` };
    }
    return { role: 'Linux installé', tailleGo: Math.max(1, Math.round(s.installPartition?.tailleGo ?? PLACE.linuxInstalleGo)), lieu: 'partition' };
  }
  if (choix === 'persistance') {
    const spec = s.persistance ? { ...s.persistance } : specPersistance(s.fichier);
    const mo = s.persistance?.tailleMo ?? 4096;
    return { role: 'persistance', tailleGo: Math.max(1, Math.round(mo / 1024)), lieu: 'fichier', fichier: `${DISPOSITION_CLE.persistance.slice(1)}/${nomSur(s.fichier)}-${spec.label}.dat` };
  }
  return undefined; // 'iso' et 'vm' : des fichiers posés sur la partition ISO ODIN
}

/** La place à RÉSERVER hors de la partition ISO ODIN (les seules vraies partitions : les Linux installés), en Go. Pur. */
export function reserveGo(plan: PlanPlace): number {
  return plan.partitions.filter((p) => p.role !== 'ISO ODIN' && p.lieu === 'partition').reduce((n, p) => n + p.tailleGo, 0);
}

/** Les options du plan de place : la taille voulue pour la partition ISO ODIN et si l'on efface la cible. */
export interface OptionsPlace {
  /** la place voulue pour la partition ISO ODIN (ISO + disques de VM + fichiers de persistance), en Go ;
   *  absente : la partition ISO ODIN prend tout l'espace restant */
  isoGo?: number;
  /** vrai : préparer en effaçant la cible (clé non ODIN) ; faux : mise à jour d'une cible déjà ODIN (rien d'effacé en plus) ;
   *  absente : déduit de cible.estOdin */
  effacer?: boolean;
}

/**
 * Le PLAN DE PLACE : comment répartir la cible entre la partition ISO ODIN (les ISO, disques de VM, fichiers de
 * persistance) et les partitions des systèmes installés (Windows To Go, Linux installés). Dit la taille de chacune,
 * ce qui est effacé et ce qui est gardé, la place qui reste, et prévient (cible trop petite, gros disque externe).
 * Pur : rien n'est écrit. On REFUSE plutôt que de tasser une cible trop petite.
 */
export function planPlace(cible: Cible, systemes: SystemeCle[], opt: OptionsPlace = {}): PlanPlace {
  const avert: string[] = [];
  const efface = opt.effacer ?? !cible.estOdin;
  const totalGo = cible.tailleOctets / GO;

  // Les partitions des systèmes installés et les fichiers de persistance.
  // (placeInstalle : le MÊME calcul que l'écriture, qui pose le Windows installé en fichier dans /vdisk.)
  const installes: Array<NonNullable<ReturnType<typeof placeInstalle>>> = [];
  for (const s of systemes) { const p = placeInstalle(s); if (p) installes.push(p); }
  const sommeInstalles = installes.reduce((n, p) => n + p.tailleGo, 0);

  // La partition ISO ODIN : la taille voulue, sinon tout l'espace restant (au moins le minimum).
  const isoVoulu = opt.isoGo !== undefined ? Math.max(PLACE.isoOdinMinGo, Math.round(opt.isoGo)) : undefined;
  const resteApresInstalles = totalGo - sommeInstalles;

  // Trop petit : même le minimum de la partition ISO ODIN ne tient pas à côté des systèmes installés.
  if (resteApresInstalles < PLACE.isoOdinMinGo) {
    const manqueGo = Math.ceil(sommeInstalles + PLACE.isoOdinMinGo - totalGo);
    return {
      possible: false,
      blocage: `Cette cible fait ${Math.round(totalGo)} Go : il manque environ ${manqueGo} Go pour tout contenir (les systèmes installés demandent ${sommeInstalles} Go, plus au moins ${PLACE.isoOdinMinGo} Go pour les ISO). Réduis la liste (retire un système installé, ou choisis « ISO qui démarre » au lieu de « installé »), puis recommence.`,
      partitions: [],
      resteGo: 0,
      avertissements: avert,
    };
  }

  // La partition ISO ODIN prend la taille voulue, ou tout le reste.
  const isoGo = isoVoulu !== undefined ? Math.min(isoVoulu, resteApresInstalles) : resteApresInstalles;
  const partitions: PlanPlace['partitions'] = [
    { role: 'ISO ODIN', tailleGo: Math.round(isoGo), efface, lieu: 'partition' },
    ...installes.map((p) => ({
      role: p.role,
      tailleGo: p.tailleGo,
      lieu: p.lieu,
      ...(p.fichier ? { fichier: p.fichier } : {}),
      // Une partition installée (WinToGo, Linux installé) efface si l'on prépare à neuf ; un fichier de
      // persistance est posé sur la partition ISO ODIN (jamais un effacement à lui seul).
      efface: p.role === 'persistance' ? false : efface,
    })),
  ];

  const resteGo = Math.max(0, Math.round(totalGo - partitions.reduce((n, p) => n + p.tailleGo, 0)));

  if (cible.genre === 'disque-externe' && totalGo >= GROS_DISQUE_GO) {
    avert.push(`Ce gros disque externe (${Math.round(totalGo)} Go) peut tout contenir — plusieurs systèmes installés et beaucoup d'ISO.`);
  }
  if (cible.genre === 'disque-interne') {
    avert.push('Cible interne : le double démarrage sur ce disque doit déjà avoir été préparé par Genèse (partition ODIN), sinon passe par « plan de double démarrage » d\'abord.');
  }
  if (efface) {
    avert.push('La cible sera partitionnée à neuf : tout son contenu actuel sera effacé. Les systèmes marqués « gardé » ne le sont qu\'après cette préparation.');
  }
  if (installes.some((p) => p.role === 'WinToGo')) {
    avert.push('Windows To Go : une clé USB lente rend Windows lent — préfère une clé ou un SSD USB rapide. Licence Windows à vérifier (Windows To Go officiel visait l\'édition Entreprise) ; aucune activation n\'est contournée.');
  }

  return { possible: true, partitions, resteGo, avertissements: avert };
}
