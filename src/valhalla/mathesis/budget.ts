// Mathésis — le compteur de budget du jour. Il ARRÊTE vraiment le travail : `prendre` refuse toute dépense qui
// ferait dépasser la limite (rien n'est consommé dans ce cas), et le compteur est rangé dans le magasin à chaque
// dépense (un redémarrage ne remet pas le jour à zéro). Il tient aussi le plafond de demandes par site et par jour.
import type { Magasin } from './magasin.ts';
import type { Budgets, GenreBudget } from './types.ts';

interface EtatBudget { jour: string; utilise: Budgets; parSite: Record<string, number> }

const VIDE = (): Budgets => ({ recherches: 0, pages: 0, octets: 0, minutesVideo: 0, appelsPayants: 0, fichiers: 0, octetsFichiers: 0 });

/** Le jour local (AAAA-MM-JJ) d'un instant. */
export function jourDe(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class Budget {
  private readonly magasin: Magasin;
  private readonly limites: () => Budgets;
  private readonly maintenant: () => number;
  constructor(magasin: Magasin, limites: () => Budgets, maintenant: () => number) {
    this.magasin = magasin; this.limites = limites; this.maintenant = maintenant;
  }
  private etat(): EtatBudget {
    const jour = jourDe(this.maintenant());
    const e = this.magasin.lire<EtatBudget | undefined>('budget', undefined);
    if (!e || e.jour !== jour) return { jour, utilise: VIDE(), parSite: {} };
    return { jour, utilise: { ...VIDE(), ...e.utilise }, parSite: { ...(e.parSite ?? {}) } };
  }
  /** Ce qui a été dépensé aujourd'hui. */
  utilise(): Budgets { return this.etat().utilise; }
  /** Ce qui reste aujourd'hui pour un genre (jamais négatif). */
  restant(g: GenreBudget): number { return Math.max(0, this.limites()[g] - this.etat().utilise[g]); }
  /**
   * Dépense `n` unités si (et seulement si) la limite le permet. Rend faux sans rien dépenser sinon.
   * Une quantité invalide ou négative est refusée.
   */
  prendre(g: GenreBudget, n = 1): boolean {
    if (!Number.isFinite(n) || n < 0) return false;
    const e = this.etat();
    if (e.utilise[g] + n > this.limites()[g]) return false;
    e.utilise[g] += n;
    this.magasin.ecrire('budget', e);
    return true;
  }
  /** Note une dépense déjà faite (octets réellement reçus) : bornée à la limite, pour que le compteur reste juste. */
  noter(g: GenreBudget, n: number): void {
    if (!Number.isFinite(n) || n <= 0) return;
    const e = this.etat();
    e.utilise[g] = Math.min(this.limites()[g], e.utilise[g] + n);
    this.magasin.ecrire('budget', e);
  }
  /** Demandes faites aujourd'hui à un site. */
  demandesSite(site: string): number { return this.etat().parSite[site] ?? 0; }
  /** Compte une demande à un site si le plafond du jour le permet ; faux sinon (rien n'est compté). */
  prendreSite(site: string, plafond: number): boolean {
    const e = this.etat();
    const n = e.parSite[site] ?? 0;
    if (n + 1 > plafond) return false;
    e.parSite[site] = n + 1;
    // Borné : au plus 2000 sites retenus par jour.
    const cles = Object.keys(e.parSite);
    if (cles.length > 2000) for (const k of cles.slice(0, cles.length - 2000)) delete e.parSite[k];
    this.magasin.ecrire('budget', e);
    return true;
  }
}
