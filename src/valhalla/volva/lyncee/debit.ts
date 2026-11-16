// Lyncée : le débit poli. Une seule requête à la fois vers un même moteur, et un temps minimal entre deux.
// Si l'attente dépasse le délai de la recherche, on n'attend pas : le moteur est sauté (« occupé »), sans pause.

const dormir = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, ko) => {
  if (ms <= 0) return ok();
  if (signal?.aborted) return ko(signal.reason);
  const t = setTimeout(() => { signal?.removeEventListener('abort', fin); ok(); }, ms);
  const fin = () => { clearTimeout(t); ko(signal?.reason); };
  signal?.addEventListener('abort', fin, { once: true });
});

export class Debit {
  private file = new Map<string, Promise<void>>();
  private prochain = new Map<string, number>();
  private maintenant: () => number; private attendre: (ms: number, signal?: AbortSignal) => Promise<void>;
  constructor(maintenant: () => number = Date.now, attendre: (ms: number, signal?: AbortSignal) => Promise<void> = dormir) { this.maintenant = maintenant; this.attendre = attendre; }

  /**
   * Prend le tour d'un moteur. Renvoie la fonction qui rend la main (à appeler une fois la requête finie),
   * ou undefined si l'attente dépasserait `limite` ms (le moteur est alors sauté).
   */
  async prendre(id: string, intervalle: number, limite: number, signal?: AbortSignal): Promise<(() => void) | undefined> {
    const debut = this.maintenant(), avant = this.file.get(id) ?? Promise.resolve();
    let rendre!: () => void; const mien = new Promise<void>((ok) => { rendre = ok; });
    this.file.set(id, avant.then(() => mien));
    // La requête précédente vers ce moteur doit être finie (une à la fois).
    const reste = () => limite - (this.maintenant() - debut);
    const ac = new AbortController(), sig = signal ? AbortSignal.any([signal, ac.signal]) : ac.signal;
    const fini = await Promise.race([avant.then(() => true), this.attendre(Math.max(0, reste()), sig).then(() => false, () => false)]);
    ac.abort(); // plus besoin de la minuterie d'attente
    if (signal?.aborted) { void avant.then(rendre); return undefined; }
    if (!fini) { void avant.then(rendre); return undefined; }
    const attente = Math.max(0, (this.prochain.get(id) ?? 0) - this.maintenant());
    if (attente > reste()) { rendre(); return undefined; }
    try { await this.attendre(attente, signal); } catch { rendre(); return undefined; }
    this.prochain.set(id, this.maintenant() + intervalle);
    return rendre;
  }
}
