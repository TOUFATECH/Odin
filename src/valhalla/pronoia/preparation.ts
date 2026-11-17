// Prónoia — lot 2 : préparer d'avance la réponse probable, pour répondre en un instant. Préparer = LECTURE SEULE : on
// appelle la fonction « préparer » injectée (recherche, rappel), jamais une action ; une demande qui agit est refusée
// avant même l'appel. Le résultat est gardé un temps court (TTL), dans un cache borné. Tout s'arrête dès qu'Odin doit
// répondre (abandonner()). Le temps gagné est MESURÉ : durée réelle de la préparation moins le temps de service.
import { performance } from 'node:perf_hooks';
import { demandeAgit, demandesEquivalentes } from './honnete.ts';
import type { MesuresPreparation } from './magasin.ts';
import type { Preparer } from './types.ts';

export interface OptionsPreparations {
  preparer: Preparer;
  maintenant: () => number;
  mesures: MesuresPreparation;
  /** durée de vie d'une réponse préparée (ms) */
  ttlMs?: number;
  /** nombre de réponses préparées gardées au plus */
  max?: number;
  /** temps au plus pour une préparation (ms) : au-delà, elle est abandonnée */
  budgetMs?: number;
}

interface Pret { cle: string; demande: string; texte: string; pret: number; dureeMs: number }
export type IssuePreparation = 'prete' | 'deja' | 'refusee' | 'abandon' | 'erreur';

export class Preparations {
  private o: Required<OptionsPreparations>;
  private cache = new Map<string, Pret>();
  private enCours = new Map<string, AbortController>();
  constructor(o: OptionsPreparations) { this.o = { ttlMs: 10 * 60_000, max: 8, budgetMs: 3000, ...o }; }

  get taille(): number { return this.cache.size; }
  get occupees(): number { return this.enCours.size; }

  /** Prépare la réponse probable à `demande` (clé de rapprochement `cle`). Ne lève jamais. */
  async preparer(cle: string, demande: string): Promise<IssuePreparation> {
    if (demandeAgit(demande)) { this.o.mesures.refusees++; return 'refusee'; }
    this.oublierPerimees();
    if (this.cache.has(cle) || this.enCours.has(cle)) return 'deja';
    const ctrl = new AbortController();
    this.enCours.set(cle, ctrl);
    const minuterie = setTimeout(() => ctrl.abort(), this.o.budgetMs);
    minuterie.unref?.();
    const t0 = performance.now();
    try {
      const texte = await Promise.race([
        this.o.preparer(demande, { signal: ctrl.signal, lectureSeule: true }),
        new Promise<never>((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('abandon')), { once: true })),
      ]);
      if (ctrl.signal.aborted) return 'abandon';
      const dureeMs = performance.now() - t0;
      this.cache.set(cle, { cle, demande, texte: String(texte ?? ''), pret: this.o.maintenant(), dureeMs });
      while (this.cache.size > this.o.max) { const k = this.cache.keys().next().value as string; this.cache.delete(k); this.o.mesures.perdues++; }
      return 'prete';
    } catch {
      return ctrl.signal.aborted ? 'abandon' : 'erreur';
    } finally { clearTimeout(minuterie); if (this.enCours.get(cle) === ctrl) this.enCours.delete(cle); }
  }

  /**
   * La vraie demande arrive : si une réponse a été préparée pour une demande ÉQUIVALENTE (mêmes mots, mêmes nombres,
   * même moment — voir `demandesEquivalentes`) et qu'elle est fraîche, on la sert ; sinon c'est une demande manquée.
   * La clé de groupe ne sert qu'à retrouver le candidat : elle ne suffit jamais à servir (« convertis 250 euros » ne
   * reçoit pas la réponse de « convertis 100 euros »). La réponse servie est retirée du cache (une seule fois).
   * `gagneMs` est le temps de préparation évité : une estimation (la réponse aurait pris à peu près ce temps-là).
   */
  servir(cle: string | undefined, recue: string): { texte: string; gagneMs: number; prepareeMs: number } | undefined {
    const t0 = performance.now();
    this.oublierPerimees();
    const p = cle ? this.cache.get(cle) : undefined;
    if (!p || !demandesEquivalentes(p.demande, recue)) { this.o.mesures.manquees++; return undefined; }
    this.cache.delete(p.cle);
    const serviMs = performance.now() - t0;
    const gagneMs = Math.max(0, p.dureeMs - serviMs);
    this.o.mesures.servies++; this.o.mesures.gagneMs += gagneMs;
    return { texte: p.texte, gagneMs, prepareeMs: p.dureeMs };
  }

  /** Odin doit répondre (ou l'interrupteur est coupé) : toutes les préparations en cours s'arrêtent. */
  abandonner(): number {
    const n = this.enCours.size;
    for (const c of this.enCours.values()) c.abort();
    this.enCours.clear();
    return n;
  }

  /** Vide tout (interrupteur coupé, effacement). */
  vider(): void { this.abandonner(); this.cache.clear(); }

  private oublierPerimees(): void {
    const n = this.o.maintenant();
    for (const [k, p] of this.cache) if (n - p.pret > this.o.ttlMs) { this.cache.delete(k); this.o.mesures.perdues++; }
  }
}
