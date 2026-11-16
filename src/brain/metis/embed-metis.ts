// Plongements (« embeddings ») par Métis, à partir d'un modèle GGUF de plongements.
//
// Facultatif : par défaut, la mémoire d'Odin prend ses plongements de Noûs (src/brain/nous/plongement.ts), déjà écrit.
// Ceci sert quand on a téléchargé un VRAI modèle de plongements au format GGUF. Le vecteur est la moyenne des derniers
// vecteurs cachés (après la normalisation finale) sur les morceaux, puis mis à la norme 1. Conforme à l'interface
// Embedder EXACTE de src/muninn/embed.ts.
//
// Honnête : tant qu'aucun vrai modèle de plongements GGUF n'a tourné, ce chemin est « codé, pas encore essayé ».

import type { Embedder } from '../../muninn/embed.ts';
import type { ModeleGguf } from './types.ts';
import { creerEtat, avantCache } from './avant.ts';

export function embedderMetis(modele: ModeleGguf): Embedder {
  const nom = `metis:${modele.arch}-${modele.empreinte.slice(0, 8)}`;
  return {
    model: nom,
    async embed(text: string): Promise<Float32Array> {
      const e = await creerEtat(modele);
      const ids = modele.decoupage.encoder(text.slice(0, 2000));
      const C = e.C;
      const acc = new Float64Array(C);
      let n = 0;
      for (let i = 0; i < ids.length && e.pos < e.Tmax; i++) {
        const y = await avantCache(e, ids[i]);
        for (let c = 0; c < C; c++) acc[c] += y[c];
        n++;
      }
      const out = new Float32Array(C);
      if (n === 0) return out;
      // Moyenne puis normalisation L2.
      let ss = 0;
      for (let c = 0; c < C; c++) { const v = acc[c] / n; out[c] = v; ss += v * v; }
      const r = ss > 0 ? 1 / Math.sqrt(ss) : 0;
      for (let c = 0; c < C; c++) out[c] *= r;
      return out;
    },
  };
}
