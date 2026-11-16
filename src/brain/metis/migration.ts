// Bascule vers Métis sans rien casser : une installation qui utilisait l'ancienne dépendance (Ollama / serveur local
// réglé par adresse) ne plante pas, ses réglages sont repris proprement, et le propriétaire est prévenu clairement.
//
// Pièges traités :
//   - memory.embedUrl pointant sur :11434 : la RETIRER du défaut ne suffit PAS (merge() garde la valeur déjà écrite
//     dans config.json). On la neutralise ACTIVEMENT ici (on la met à '').
//   - un fournisseur « local » ou en :11434 dans providers[] : converti en Métis si un GGUF est présent, sinon retiré
//     (Métis est détecté au démarrage par detecterMetis, pas réglé par adresse).
//   - memory.semantic reste vrai ; les vecteurs se recalculent seuls (changement de modèle d'embeddings, store.ts).
//   - l'interrupteur ODIN_NO_LOCAL_BRAIN n'est pas touché.
//
// Idempotente : une deuxième exécution ne change plus rien (plus rien en :11434 à retirer).

import type { OdinConfig, ProviderConfig } from '../../config.ts';
import { tierOf } from '../../providers/router.ts';

export interface ResultatMigration {
  change: boolean;
  providersRetires: number;
  adresseEmbedRetiree: boolean;
  notice?: string;
}

const NOTICE =
  "Odin n'a plus besoin d'Ollama ni de LM Studio : il lit lui-même les modèles ouverts (GGUF) téléchargés par Odin (Métis). " +
  "Ton ancien réglage d'adresse de serveur local a été retiré ; re-télécharge un modèle dans Métis si tu en avais un. " +
  "La mémoire par le sens recalcule ses repères toute seule. Sur une machine sans carte graphique, seuls les petits " +
  'modèles sont utilisables : Métis affiche la vitesse mesurée.';

/**
 * Un fournisseur vise-t-il l'ancien serveur local ? On reprend EXACTEMENT la définition de « local » du routeur
 * (tierOf : palier déclaré « local », ou adresse localhost/127.0.0.1/[::1] sur N'IMPORTE QUEL port — LM Studio :1234,
 * llama.cpp :8080, Ollama :11434…). Une définition plus étroite (seulement :11434) laissait survivre ces serveurs,
 * qui masquaient ensuite Métis (detecterMetis sort dès qu'un fournisseur local reste).
 */
function estAncienLocal(p: ProviderConfig): boolean {
  return tierOf(p) === 'local';
}

/**
 * Met la configuration à jour pour Métis, en place. `aUnModele` : vrai si un GGUF est déjà présent (catalogue non vide).
 * Renvoie ce qui a changé et, si quelque chose a changé, la notice à montrer une seule fois au propriétaire.
 */
export function migrerMetis(cfg: OdinConfig, aUnModele: boolean): ResultatMigration {
  let change = false;
  let providersRetires = 0;
  let adresseEmbedRetiree = false;

  // 1. Neutraliser l'adresse d'embeddings qui visait l'ancien serveur local.
  if (cfg.memory && /:11434(\/|$)/.test(cfg.memory.embedUrl ?? '')) {
    cfg.memory.embedUrl = '';
    adresseEmbedRetiree = true;
    change = true;
  }

  // 2. Retirer les fournisseurs qui visaient l'ancien serveur local. Métis est détecté au démarrage, pas réglé ici.
  if (Array.isArray(cfg.providers)) {
    const avant = cfg.providers.length;
    cfg.providers = cfg.providers.filter((p) => !estAncienLocal(p));
    providersRetires = avant - cfg.providers.length;
    if (providersRetires > 0) change = true;
  }

  const notice = change
    ? (aUnModele
      ? NOTICE
      : NOTICE + ' Aucun modèle ouvert n\'est encore téléchargé : télécharge-en un dans Métis pour que le cerveau local réponde.')
    : undefined;

  return { change, providersRetires, adresseEmbedRetiree, notice };
}
