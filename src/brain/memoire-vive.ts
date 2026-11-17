// La mémoire vive du Cerveau : ce que le coffre de notes (vault.ts) garde en mémoire pour ne relire que ce qui a changé.
//
//  - le MIROIR du dossier : pour chaque dossier lu, ses entrées dans l'ordre exact où le système les a données. Quand
//    la surveillance du dossier signale des changements, seuls les dossiers et les notes touchés sont relus ; la liste
//    des notes est refaite EN MÉMOIRE, dans le même ordre qu'un parcours complet du disque (donc mêmes réponses, dans
//    le même ordre) ;
//  - la PART auprès du comptable (budget-memoire.ts) : le coffre déclare ce qu'il garde (notes lues, textes repliés,
//    index) ; si le budget ne suffit pas, ou si la machine manque de mémoire, il ne garde plus rien entre deux
//    demandes : Odin reste juste, seulement plus lent ;
//  - ODIN_MEMOIRE_VIVE=non coupe tout : le coffre reprend exactement le chemin d'avant (référence des essais et des
//    bancs).
//
// Ici, rien ne lit le disque : vault.ts lit, ce module range et décide.

import { rendre, reserver, surPression } from './budget-memoire.ts';

/** Une entrée de dossier, telle que le système l'a rendue. */
export interface EntreeDossier { nom: string; dossier: boolean; fichier: boolean }

/** La mémoire vive est-elle coupée (chemin d'avant, pour comparer) ? */
export const viveCoupee = (): boolean => process.env.ODIN_MEMOIRE_VIVE === 'non';

/** Ce que coûte en mémoire une note gardée (texte, texte replié, propriétés, index), en octets : estimation prudente. */
export function octetsGardes(notes: Array<{ size: number }>): number {
  let s = 0; for (const n of notes) s += n.size * 4 + 1500;
  return s;
}

/** Le dossier parent d'un chemin relatif ('' pour la racine). Pur. */
export function parent(rel: string): string { const i = rel.lastIndexOf('/'); return i < 0 ? '' : rel.slice(0, i); }
/** Chemin relatif propre (barres « / », sans barre au début ni à la fin). Pur. */
export function propre(rel: string): string { return rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''); }

const TOUTES = new Set<WeakRef<MemoireVive>>();
const RENDRE = new FinalizationRegistry<string>((nom) => rendre(nom));
let branchee = false;
/** Une seule inscription auprès du comptable : sous pression, chaque mémoire vive encore en vie se vide. */
function brancher(): void {
  if (branchee) return;
  branchee = true;
  surPression(() => {
    for (const r of [...TOUTES]) { const m = r.deref(); if (!m) { TOUTES.delete(r); continue; } m.vider(); }
  });
}

let numero = 0;
export class MemoireVive {
  readonly nom: string;
  /** Dossier relatif ('' = racine) → ses entrées, dans l'ordre du système. */
  readonly dossiers = new Map<string, EntreeDossier[]>();
  /** Le miroir couvre tout ce qu'un parcours complet lirait (posé par un parcours complet). */
  complet = false;
  /** Quelque chose n'a pas pu être suivi (changement sans nom, budget refusé…) : le prochain tour relit tout. */
  toutRelire = true;
  /** Ce qui est réservé auprès du comptable, en Mo (0 : rien de gardé). */
  reserveMo = 0;
  /** La réservation est accordée : le coffre peut garder ses notes entre deux demandes. */
  accordee = false;
  private signales = new Set<string>();
  private readonly surVidage: () => void;

  constructor(surVidage: () => void) {
    this.nom = `cerveau-notes-${++numero}`;
    this.surVidage = surVidage;
    TOUTES.add(new WeakRef(this));
    RENDRE.register(this, this.nom);
    brancher();
  }

  /** La surveillance a vu bouger ce chemin (relatif au coffre) ; `null` : un changement sans nom, tout relire. */
  signaler(rel: string | null): void {
    if (rel === null || !propre(rel)) { this.toutRelire = true; this.signales.clear(); return; }
    if (this.signales.size > 5000) { this.toutRelire = true; this.signales.clear(); return; } // une avalanche : relire tout coûte moins
    this.signales.add(propre(rel));
  }
  /** Les chemins signalés depuis la dernière fois (et on repart de zéro). */
  prendre(): Set<string> { const s = this.signales; this.signales = new Set(); return s; }

  /** Retire un dossier et tout ce qu'il contient du miroir. */
  oublierDossier(rel: string): void {
    const pre = rel ? `${rel}/` : '';
    for (const k of [...this.dossiers.keys()]) if (k === rel || (pre && k.startsWith(pre)) || (!rel)) this.dossiers.delete(k);
  }

  /** Ce que coûte le miroir des dossiers, en octets : chaque entrée compte (pièces jointes, images…), pas seulement les notes. */
  octetsMiroir(): number {
    let s = 0;
    for (const [rel, l] of this.dossiers) { s += 200 + rel.length * 2; for (const e of l) s += 120 + e.nom.length * 2; }
    return s;
  }

  /**
   * Demande au comptable la place de ce qui est gardé. Refusé : on ne garde rien (vidage), et la réponse est false.
   */
  tenir(octets: number): boolean {
    const mo = Math.max(1, Math.ceil(octets / 1_048_576));
    if (mo === this.reserveMo && this.accordee) return true;
    if (reserver(this.nom, mo)) { this.reserveMo = mo; this.accordee = true; return true; }
    this.vider();
    return false;
  }

  /** Vide tout ce qui est gardé (pression, budget refusé) et rend la place au comptable. */
  vider(): void {
    rendre(this.nom);
    this.reserveMo = 0; this.accordee = false;
    this.dossiers.clear(); this.complet = false; this.toutRelire = true; this.signales.clear();
    try { this.surVidage(); } catch { /* le coffre se remet de lui-même à la demande suivante */ }
  }
}
