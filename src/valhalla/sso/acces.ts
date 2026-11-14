// Qui agit en ce moment ? Une personne de Persona connectée à l'interface d'Odin (pas le propriétaire) : ses demandes
// passent dans ce contexte, et Valhalla refuse toute action d'une appli sur laquelle elle n'a pas de droit — qu'elle vienne
// d'un bouton, de l'API ou d'une phrase (Logos). Un seul endroit : `Valhalla.act` demande `refusAppli`.
// Ce fichier n'importe rien d'Odin (le vérificateur est branché par la connexion unique au démarrage).

import { AsyncLocalStorage } from 'node:async_hooks';

export interface Agissant { login: string; name: string; groups: string[] }
const courant = new AsyncLocalStorage<Agissant>();
let verif: ((moduleId: string, qui: Agissant) => string | undefined) | undefined;

/** Branche la règle (appelé par la connexion unique). */
export function setVerificateur(f: (moduleId: string, qui: Agissant) => string | undefined): void { verif = f; }
/** Fait tourner `f` au nom de cette personne. */
export function auNomDe<T>(qui: Agissant, f: () => T): T { return courant.run(qui, f); }
export const agissant = (): Agissant | undefined => courant.getStore();
/**
 * Le message de refus si la personne en cours n'a pas le droit d'agir sur cette appli (undefined : permis).
 * Les appels entre applis (réflexes, automatisations) ne sont pas filtrés : ils suivent une action déjà permise.
 */
export function refusAppli(moduleId: string, by?: string): string | undefined {
  const q = courant.getStore(); if (!q || (by && by !== 'toi')) return undefined;
  if (!verif) return 'Les droits des applis ne sont pas encore chargés : réessaie dans un moment.';
  return verif(moduleId, q);
}
