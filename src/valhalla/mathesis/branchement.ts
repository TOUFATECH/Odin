// Mathésis — le branchement sur Odin : la mémoire (muninn) par l'entrée commune d'apprentissage, Noûs, le mode privé,
// le signal « Odin répond » et le moteur de recherche d'Odin. Tout est protégé : une panne ici ne touche jamais Odin.
import { type FileApprentissage, type NoosDeps } from '../../brain/nous/deps.ts';
import { fileNousOdin } from '../../brain/nous/file-odin.ts';
import type { MemoireApprentissage } from '../../learn/apprendre-de-tout.ts';
import type { OptionsModuleMathesis } from './module.ts';
import { odinRepond } from './occupe.ts';
import { chercheurOdin } from './recherche.ts';

/** Ce dont le branchement a besoin d'Odin (sa configuration et, quand il tourne, sa mémoire). */
export interface OdinPourMathesis {
  cfg: { voice?: { privacy?: { privateMode?: boolean } }; learning?: { observe?: boolean }; nous?: { actif?: boolean }; demo?: boolean };
  muninn?: MemoireApprentissage & { forget(id: number): boolean };
  /** Odin en démonstration : jamais de réseau. */
  demo?: boolean;
}

/**
 * Faut-il couper TOUT accès au web ? Oui sous le lanceur d'essais (NODE_TEST_CONTEXT), pour une instance d'essai ou
 * de banc (ODIN_ESSAI, posé par test/banc/odin-vrai.ts — déjà utilisé pour ne pas lire les vrais dossiers), et en
 * démonstration. Alors aucune recherche, aucune résolution de nom, aucune demande ne part.
 */
export function sansReseau(env: Record<string, string | undefined> = process.env, demo = false): boolean {
  return demo || Boolean(env.NODE_TEST_CONTEXT) || Boolean(env.ODIN_ESSAI);
}

/**
 * La file d'apprentissage de Noûs : LA file unique d'Odin (src/brain/nous/file-odin.ts), vidée périodiquement par la
 * passerelle vers le corpus chiffré et borné de Noûs.
 */
export const fileNousMathesis: FileApprentissage = fileNousOdin;

export function optionsOdin(odin: OdinPourMathesis, op: { env?: Record<string, string | undefined> } = {}): OptionsModuleMathesis {
  const prive = (): boolean => { try { return odin.cfg.voice?.privacy?.privateMode === true; } catch { return true; } };
  // « stop » du propriétaire (clé initiative-pause posée par la passerelle) : Mathésis s'arrête aussi, jusqu'à « reprends ».
  const enPause = (): boolean => { try { return (odin.muninn as { getKv?(k: string): string | undefined } | undefined)?.getKv?.('initiative-pause') === '1'; } catch { return false; } };
  const o: OptionsModuleMathesis = { prive, occupe: () => odinRepond() || enPause(), chercher: chercheurOdin() };
  // Essais, banc d'affichage, démonstration : jamais de réseau réel (les essais qui veulent un site passent leurs faux).
  if (sansReseau(op.env ?? process.env, odin.demo === true || odin.cfg.demo === true)) {
    const non = async (): Promise<never> => { throw new Error('aucun réseau dans une instance d\'essai ou de démonstration'); };
    o.chercher = async () => []; o.transport = non; o.resoudre = non;
  }
  const mem = odin.muninn;
  if (mem) {
    const nous: NoosDeps = {
      cfg: { learning: { observe: odin.cfg.learning?.observe !== false }, nous: { actif: odin.cfg.nous?.actif !== false } },
      privateMode: prive, demo: odin.cfg.demo === true, file: fileNousMathesis,
    };
    o.apprentissage = { memoire: mem, nous };
    o.oublierSouvenir = (id) => { try { return mem.forget(id); } catch { return false; } };
  }
  return o;
}
