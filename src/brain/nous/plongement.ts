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

/** Adapte un Moteur de Noûs à l'interface Embedder de la mémoire. */
export function embedderNoos(m: Moteur): Embedder {
  return {
    model: m.modeleEmbedding,
    embed(text: string, signal?: AbortSignal): Promise<Float32Array> { return m.plonger(text, signal); },
  };
}
