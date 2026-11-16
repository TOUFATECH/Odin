// Lyncée : la santé de chaque moteur. Un moteur qui bloque (contrôle anti-robot, refus, consentement), qui limite
// le débit ou qui tombe en panne est mis en pause, de plus en plus longtemps ; une réussite remet tout à zéro.
// Jamais de nouvel essai déguisé, jamais de captcha résolu : on attend, puis on réessaie une fois, poliment.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type GenreEchec = 'blocage' | 'limite' | 'panne';
const MIN = 60_000, H = 60 * MIN;
/** Les paliers de pause, échec après échec. */
export const PALIERS: Record<GenreEchec, number[]> = {
  blocage: [30 * MIN, 2 * H, 12 * H, 24 * H],
  limite: [5 * MIN, 30 * MIN, 2 * H, 6 * H],
  panne: [0, MIN, 5 * MIN, 30 * MIN],
};
export interface SanteMoteur { echecs: number; jusqua?: number; raison?: string; genre?: GenreEchec; dernierSucces?: number }

export class Sante {
  private m = new Map<string, SanteMoteur>();
  private fichier?: string;
  private maintenant: () => number;
  constructor(maintenant: () => number = Date.now, fichier?: string) { this.maintenant = maintenant; if (fichier) this.relier(fichier); }

  /** Garde la santé dans un fichier (lyncee-sante.json du dossier de Pythie) et relit ce qu'il contient. */
  relier(fichier: string): void {
    this.fichier = fichier;
    try {
      const j = JSON.parse(readFileSync(fichier, 'utf8')) as Record<string, SanteMoteur>;
      for (const [id, s] of Object.entries(j)) if (s && typeof s.echecs === 'number') this.m.set(id, { echecs: Math.max(0, Math.min(99, s.echecs)), ...(typeof s.jusqua === 'number' ? { jusqua: s.jusqua } : {}), ...(s.raison ? { raison: String(s.raison).slice(0, 200) } : {}), ...(s.genre ? { genre: s.genre } : {}), ...(typeof s.dernierSucces === 'number' ? { dernierSucces: s.dernierSucces } : {}) });
    } catch { /* pas encore de fichier */ }
  }
  private garder(): void {
    if (!this.fichier) return;
    try { mkdirSync(dirname(this.fichier), { recursive: true }); writeFileSync(this.fichier, JSON.stringify(Object.fromEntries(this.m))); } catch { /* disque plein : la santé reste en mémoire */ }
  }
  /** Le moteur peut-il être interrogé maintenant ? */
  libre(id: string): boolean { const s = this.m.get(id); return !s?.jusqua || s.jusqua <= this.maintenant(); }
  /** Un échec : la pause suivante selon son genre (0 = pas de pause). Renvoie la fin de la pause, s'il y en a une. */
  echec(id: string, raison: string, genre: GenreEchec): number | undefined {
    const s = this.m.get(id) ?? { echecs: 0 }, echecs = s.echecs + 1, paliers = PALIERS[genre];
    const duree = paliers[Math.min(echecs - 1, paliers.length - 1)];
    const jusqua = duree > 0 ? this.maintenant() + duree : undefined;
    this.m.set(id, { ...s, echecs, raison: raison.slice(0, 200), genre, ...(jusqua ? { jusqua } : { jusqua: undefined }) });
    this.garder();
    return jusqua;
  }
  /** Une réussite (même avec 0 résultat, sans signe de blocage) : le compteur repart de zéro. */
  reussite(id: string): void { this.m.set(id, { echecs: 0, dernierSucces: this.maintenant() }); this.garder(); }
  /** Reprise à la main : la pause est levée tout de suite (le compteur reste, pour la prochaine fois). */
  reprendre(id: string): void { const s = this.m.get(id); if (s) { this.m.set(id, { ...s, jusqua: undefined }); this.garder(); } }
  etat(id: string): SanteMoteur { const s = this.m.get(id); return s ? { ...s } : { echecs: 0 }; }
}
