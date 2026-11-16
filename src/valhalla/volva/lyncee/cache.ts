// Lyncée : un cache court des recherches, en mémoire seulement (10 minutes, 200 recherches au plus).
// La même question posée deux fois de suite ne repart pas vers les moteurs.

export class Cache<T> {
  private m = new Map<string, { at: number; v: T }>();
  private maintenant: () => number; private duree: number; private max: number;
  constructor(maintenant: () => number = Date.now, duree = 10 * 60_000, max = 200) { this.maintenant = maintenant; this.duree = duree; this.max = max; }
  lire(cle: string): T | undefined {
    const x = this.m.get(cle); if (!x) return undefined;
    if (this.maintenant() - x.at > this.duree) { this.m.delete(cle); return undefined; }
    return x.v;
  }
  garder(cle: string, v: T): void {
    this.m.delete(cle); this.m.set(cle, { at: this.maintenant(), v });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
  vider(): void { this.m.clear(); }
}
