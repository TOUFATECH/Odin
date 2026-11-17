// Plongements de Noûs sans serveur externe.
//
// La mémoire d'Odin (src/muninn) retrouve « mon serveur de fichiers » à partir de « le NAS » grâce à des
// plongements (« embeddings ») : un vecteur par souvenir. Aujourd'hui elle les demande à un serveur Ollama EXTERNE —
// contraire à la règle du propriétaire (zéro instance externe). Noûs les fournit lui-même : la moyenne de sa dernière
// normalisation donne un vecteur de sens. On branche cela sur l'interface Embedder EXACTE de src/muninn/embed.ts.
//
// Le modèle est versionné « noos-v<n> » : quand il change, src/muninn/store.ts recalcule seul les anciens vecteurs.

import type { Embedder } from '../../muninn/embed.ts';
import type { Moteur } from './moteur.ts';
import { listerReprises } from './reprise.ts';

/** Adapte un Moteur de Noûs à l'interface Embedder de la mémoire. */
export function embedderNoos(m: Moteur): Embedder {
  return {
    model: m.modeleEmbedding,
    embed(text: string, signal?: AbortSignal): Promise<Float32Array> { return m.plonger(text, signal); },
  };
}

/**
 * L'Embedder de la mémoire d'Odin : le moteur de Noûs chargé au premier besoin, et RECHARGÉ tout seul quand un
 * nouveau point de reprise apparaît (l'entraînement en écrit un quand il fait mieux sur le banc). Vérifié au plus une
 * fois par minute (une lecture de dossier). Pour ne pas refaire tous les vecteurs de la mémoire à chaque petit progrès,
 * un nouveau point n'est pris qu'au bout de `attenteMs` (6 h ; le premier point, tout de suite).
 *
 * L'étiquette du modèle suit la VERSION de Noûs (« noos-v<n> ») : quand elle change, la mémoire refait ses vecteurs
 * (store.missingVectors). Tant qu'aucun moteur n'est prêt, embed() échoue proprement : la recherche se fait par mots.
 */
export interface EmbedderRechargeable extends Embedder {
  recharger(): void;
  /**
   * Un nouveau point de reprise attend ses vecteurs (constat 13) : la recherche reste servie par l'ANCIEN moteur et ses
   * vecteurs, pendant que ceux du nouveau sont préparés à part (vecteurs-fond.ts) ; puis `basculer()` d'un coup.
   */
  candidat(): Promise<Embedder | undefined>;
  basculer(): void;
  abandonnerCandidat(): void;
}

export function embedderQuiSeRecharge(home: string, o: { verifMs?: number; attenteMs?: number; maintenant?: () => number } = {}): EmbedderRechargeable {
  const verif = o.verifMs ?? 60_000, attente = o.attenteMs ?? 6 * 3600_000, now = o.maintenant ?? Date.now;
  let moteurP: Promise<Moteur | undefined> | undefined;      // EN SERVICE (la recherche)
  let candidatP: Promise<Moteur | undefined> | undefined;    // le nouveau, tant que ses vecteurs ne sont pas faits
  let moteurN = -1, candidatN = -1, verifieA = 0, chargeA = 0;
  let moteurCharge: Moteur | undefined;
  const charge = (n: number) => (n < 0 ? Promise.resolve(undefined) : import('./moteur.ts').then((m) => m.chargerMoteur(home)).catch(() => undefined));
  const verifier = (): void => {
    const t = now();
    if (moteurP && t - verifieA <= verif) return;
    verifieA = t;
    const n = listerReprises(home)[0] ?? -1;
    if (!moteurP) { moteurN = n; chargeA = t; moteurP = charge(n); return; }
    // Un nouveau point : le PREMIER est pris tout de suite (aucun vecteur à garder) ; les suivants deviennent candidats.
    if (n !== moteurN && n !== candidatN && (moteurN < 0 || t - chargeA > attente)) {
      chargeA = t;
      if (moteurN < 0) { const ancien = moteurP; moteurN = n; moteurP = charge(n); void ancien.then((m) => m?.arreter()).catch(() => undefined); return; }
      const ancienCand = candidatP; candidatN = n; candidatP = charge(n);
      if (ancienCand) void ancienCand.then((m) => m?.arreter()).catch(() => undefined);
    }
  };
  return {
    get model(): string { return moteurCharge ? moteurCharge.modeleEmbedding : 'noos'; },
    async embed(text: string, signal?: AbortSignal): Promise<Float32Array> {
      verifier();
      const m = await moteurP;
      if (!m) { moteurCharge = undefined; throw new Error('plongements indisponibles : Noûs pas encore prêt (repli recherche par mots)'); }
      moteurCharge = m;
      return m.plonger(text, signal);
    },
    async candidat(): Promise<Embedder | undefined> {
      verifier();
      const c = await candidatP;
      return c ? { model: c.modeleEmbedding, embed: (t: string, s?: AbortSignal) => c.plonger(t, s) } : undefined;
    },
    /** Le candidat ne marche pas (plusieurs échecs) : abandonné, le moteur en service reste (et ses vecteurs se font). */
    abandonnerCandidat(): void {
      const c = candidatP; candidatP = undefined;
      if (c) void c.then((m) => m?.arreter()).catch(() => undefined);
    },
    basculer(): void {
      if (!candidatP) return;
      const ancien = moteurP;
      moteurP = candidatP; moteurN = candidatN; candidatP = undefined; candidatN = -1;
      void moteurP.then((m) => { moteurCharge = m; }).catch(() => undefined);
      if (ancien) void ancien.then((m) => m?.arreter()).catch(() => undefined);
    },
    /** (essais) vérifier tout de suite le dossier au prochain appel. */
    recharger(): void { verifieA = 0; chargeA = 0; },
  };
}
