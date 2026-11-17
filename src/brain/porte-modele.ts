// La porte du modèle de langue d'Odin : une seule question, « y a-t-il un modèle prêt ? ».
//
// Décision du propriétaire (17/11/2026) : aucun modèle qui ne soit pas le sien. Tant que son propre modèle de langue
// n'est pas entraîné, la porte est vide : Odin répond par ses actions directes, sa mémoire et Soul, et tout ce qui
// demandait un modèle de langue dit « pas encore », dans la langue de la personne. « Sans modèle » n'est PAS une
// démonstration : Soul apprend, les mises à jour, les alertes et l'accès marchent comme d'habitude.
//
// Ici, seulement ce que la séparation « sans modèle » / « démo » demande : la question `pret()` et le fournisseur vide
// qui tient la place d'un modèle dans la boucle de l'agent (il ne répond jamais : il lève « pas encore »).

import type { Provider } from '../types.ts';
import { ModelePasEntraine } from '../langue/pas-entraine.ts';

/** La porte du modèle de langue, vue par le reste d'Odin. */
export interface PorteModele {
  /** Vrai seulement quand un modèle de langue peut répondre. */
  pret(): boolean;
}

/** Le nom du fournisseur vide (aucun modèle de langue). */
export const SANS_MODELE = 'aucun-modele';

/** Le fournisseur qui tient la place du modèle absent : chaque demande lève « pas encore » (sorte « de langue »). */
export function fournisseurSansModele(langue?: string): Provider {
  return { name: SANS_MODELE, complete: async () => { throw new ModelePasEntraine('rediger', langue); } };
}

/** Vrai quand ce fournisseur est un vrai modèle (et pas la place vide). Pur. */
export function estUnModele(p: Pick<Provider, 'name'>): boolean { return p.name !== SANS_MODELE; }

/** Le modèle d'un Odin est-il prêt ? Tolérant : un objet sans porte (faux Odin d'essai) n'a pas de modèle. */
export function modelePret(odin: { modele?: Partial<PorteModele> } | undefined): boolean {
  try { return odin?.modele?.pret?.() === true; } catch { return false; }
}
