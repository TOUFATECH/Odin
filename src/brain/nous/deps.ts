// Le câblage de Noûs : ce dont l'entrée d'apprentissage et les greffes ont besoin, rassemblé en un seul
// objet (NoosDeps) passé partout. On garde ce fichier libre du moteur (src/brain/nous/moteur.ts, écrit par
// l'autre lot) pour que l'entrée d'apprentissage se teste et se vérifie seule ; le moteur, quand il est
// prêt, est câblé au démarrage (src/runtime.ts) et rangé ici via `moteur`/`entraineur` optionnels, décrits
// par des interfaces minimales structurellement compatibles avec le contrat.

import { masquer } from './masque.ts';

/** Les sortes d'apprentissage (contrat §3). */
export type Sorte = 'lecture' | 'echange' | 'maitre' | 'correction' | 'note';

/** Un exemple rangé dans la file, déjà masqué. Que des données ; le worker le lira plus tard. */
export interface ExempleEnFile {
  sorte: Sorte;
  texte: string;
  demande: string;
  reponse: string;
  source: string;
  fiable: boolean;
  note?: number;
  maitre?: string;
  at: number;
  /** Le souvenir d'où vient l'exemple (pour l'oubli), s'il est connu. */
  idSouvenir?: number;
}

/** Une file bornée en mémoire : pousser ne bloque jamais ; quand elle est pleine, le plus ancien part. */
export interface FileApprentissage {
  pousser(e: ExempleEnFile): boolean;
  taille(): number;
  prendre(n: number): ExempleEnFile[];
  vider(): void;
  /** Retire les exemples en attente qui répondent au critère (l'oubli). Rend le nombre retiré. */
  retirerSi?(critere: (e: ExempleEnFile) => boolean): number;
}

/** Fabrique une file bornée (anneau). Par défaut 10 000 exemples : largement assez entre deux séances. */
export function fileBornee(max = 10_000): FileApprentissage {
  const buf: ExempleEnFile[] = [];
  return {
    pousser(e) {
      buf.push(e);
      if (buf.length > max) buf.splice(0, buf.length - max);
      return true;
    },
    taille() { return buf.length; },
    prendre(n) { return buf.splice(0, Math.max(0, n)); },
    vider() { buf.length = 0; },
    retirerSi(critere) { let n = 0; for (let i = buf.length - 1; i >= 0; i--) { try { if (critere(buf[i])) { buf.splice(i, 1); n++; } } catch { /* critère en panne : on garde */ } } return n; },
  };
}

/** Interface minimale du moteur dont Noûs se sert (structurellement compatible avec le Moteur du contrat §1). */
export interface MoteurRef {
  readonly pret: boolean;
  plonger(texte: string, signal?: AbortSignal): Promise<Float32Array>;
  scoreDe(demande: string, reponse: string): Promise<number>;
}

/** Le sac de dépendances de Noûs. Les parties moteur sont optionnelles : absentes, Noûs apprend et se range
 *  quand même (l'entraînement et les propositions arrivent une fois le moteur câblé). */
export interface NoosDeps {
  cfg: { learning: { observe: boolean }; nous?: { actif?: boolean } };
  /** Vrai en mode privé de la voix (muninn). */
  privateMode: () => boolean;
  /** Vrai en démonstration (odin.demo). */
  demo: boolean;
  /** Forçage d'essai : vrai => nourrir() ne fait rien (comme sous le lanceur d'essais). */
  essai?: boolean;
  /** Masquage propre à Noûs avant le corpus ; par défaut masquer(). */
  masquer?: (t: string) => string;
  /** Masquage TECHNIQUE (Heimdall) avant le corpus ; par défaut les motifs publics de src/heimdall/redact.ts.
   *  Le runtime peut y injecter un Redactor.fromEnv() pour masquer aussi les secrets réels des variables d'env. */
  redacteur?: (t: string) => string;
  /** La file d'apprentissage bornée. */
  file: FileApprentissage;
  /** Horloge, injectable pour les essais. */
  maintenant?: () => number;
  /** Le moteur, quand il est prêt (plongements, score pour la préférence du duel). */
  moteur?: MoteurRef;
}

/** Vrai si l'on tourne sous le lanceur d'essais (NODE_TEST_CONTEXT) ou si un essai le force via deps.essai. */
export function enEssai(deps: Pick<NoosDeps, 'essai'>): boolean {
  if (deps.essai === true) return true;
  if (deps.essai === false) return false;
  try { return process.env.NODE_TEST_CONTEXT != null; } catch { return false; }
}

/** Masqueur effectif d'un sac de dépendances. */
export function masqueDe(deps: Pick<NoosDeps, 'masquer'>): (t: string) => string {
  return deps.masquer ?? masquer;
}
