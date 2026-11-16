// Nettoyage d'un texte AVANT de le ranger en clair dans muninn (point 4 / contrat §4 : aucun secret ni
// donnée privée en clair). La mémoire muninn est écrite en clair sur le disque : un échange, un fichier
// analysé ou un audio transcrit peut contenir un mot de passe, un e-mail, un téléphone, un IBAN… On applique
// ici exactement le même filet que l'entrée de Noûs (src/brain/nous/entree.ts) : Heimdall (clés techniques)
// PUIS le masquage « à la française » (e-mail, téléphone, IBAN, carte, NIR), avec un dernier contrôle : si un
// secret subsiste malgré le masquage, on ne range pas ce texte (l'appelant l'écarte).
//
// Module pur côté logique (le masqueur Heimdall lit les secrets d'environnement une seule fois, au démarrage).

import { Redactor } from '../heimdall/redact.ts';
import { masquer, contientSecret } from '../brain/nous/masque.ts';

// Masqueur technique construit sur les secrets d'environnement (comme Noûs peut l'injecter) : il masque les
// clés publiques connues (sk-ant…, AKIA…, Bearer…) ET les valeurs réelles des variables sensibles.
const redacteur = Redactor.fromEnv();

/** Vrai si un secret technique subsiste encore après masquage. */
function secretTechnique(t: string): boolean {
  return !!t && redacteur.redact(t) !== t;
}

/**
 * Nettoie un texte destiné à muninn. Rend le texte masqué et un drapeau `sur` : faux quand un secret
 * subsiste malgré le masquage (on ne range alors rien en clair). Ne lève jamais.
 */
export function nettoyerPourMemoire(texte: string): { texte: string; sur: boolean } {
  try {
    const net = masquer(redacteur.redact(String(texte ?? '')));
    const sur = !(secretTechnique(net) || contientSecret(net));
    return { texte: net, sur };
  } catch {
    // En cas de doute, on considère le texte NON sûr : mieux vaut ne rien ranger qu'écrire un secret en clair.
    return { texte: '', sur: false };
  }
}
