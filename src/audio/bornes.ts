// Les bornes de l'oreille d'Odin : l'erreur propre, le délai, l'arrêt, et la main rendue au serveur entre deux
// tranches. Tout son venu de l'extérieur est traité comme hostile : on borne avant d'allouer.

import type { CodeErreurSon } from './contrat.ts';

/** La seule erreur que lève l'oreille d'Odin : un code stable et une phrase lisible. */
export class ErreurSon extends Error {
  readonly code: CodeErreurSon;
  constructor(code: CodeErreurSon, message: string) {
    super(message);
    this.code = code;
    this.name = 'ErreurSon';
  }
}

/** Délai par défaut d'une analyse : 30 minutes. */
export const DELAI_DEFAUT_MS = 30 * 60_000;
/** Taille d'un fichier de transcription envoyé en mémoire au plus (au-delà : un fichier de travail). */
export const MAX_WAV_MEMOIRE = 24 * 1024 * 1024;
/** Durée gardée en mémoire pour la parole quand aucun dossier de travail n'est donné. */
export const MAX_PAROLE_MEMOIRE_S = 30 * 60;

/** Réunit l'arrêt demandé et le délai en un seul signal. */
export function signalAvecDelai(signal: AbortSignal | undefined, delaiMs: number): AbortSignal {
  const ms = Number.isFinite(delaiMs) && delaiMs > 0 ? Math.min(delaiMs, 24 * 3600_000) : DELAI_DEFAUT_MS;
  const delai = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, delai]) : delai;
}

/** Lève ErreurSon 'arrete' si l'analyse a été arrêtée ou si le délai est passé. */
export function verifierArret(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const r = signal.reason as { name?: string } | undefined;
  const delai = r && typeof r === 'object' && r.name === 'TimeoutError';
  throw new ErreurSon('arrete', delai ? 'analyse arrêtée : délai dépassé' : 'analyse arrêtée à la demande');
}

/** Rend la main à la boucle du serveur (entre deux tranches), pour ne pas le figer. */
export function ceder(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/** Ramène toute erreur à une ErreurSon (les autres deviennent 'format'). */
export function enErreurSon(e: unknown, defaut: CodeErreurSon = 'format'): ErreurSon {
  if (e instanceof ErreurSon) return e;
  const m = e instanceof Error ? e.message : String(e);
  return new ErreurSon(defaut, m.slice(0, 300));
}

/** Durée maximale effective (bornée par le plafond du contrat). */
export function maxSecEffectif(maxSec: number | undefined, plafond: number): number {
  if (maxSec === undefined || !Number.isFinite(maxSec) || maxSec <= 0) return plafond;
  return Math.min(maxSec, plafond);
}
