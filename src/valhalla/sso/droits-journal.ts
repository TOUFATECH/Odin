// Le journal des changements de droits (Profil, lot 5) : chaque droit donné ou limité est écrit au journal des
// personnes, dans la mémoire d'Odin (src/muninn/personnes.ts, noterDroit). Persona ne connaît pas la mémoire d'Odin :
// Odin branche ici, au démarrage, la fonction qui écrit. Sans branchement, rien n'est écrit et rien ne casse.
// Jamais un mot de passe ni une clé : seulement qui, quoi, pour qui, avant → après. Tout est rangé en CODES (identifiants
// d'applis, de groupes, de rôles), jamais en phrases d'une langue : l'écran les traduit dans la langue de qui lit.

/** Un changement de droit. `registre` : « odin » (rôle et autonomie, mémoire d'Odin) ou « persona » (accès aux applis, groupes, compte). */
export interface ChangementDroit {
  registre: 'odin' | 'persona';
  /** Pour qui : l'id d'une personne de la mémoire d'Odin, « @identifiant », « groupe:<nom> » ou « * » dans Persona. */
  pour: string;
  /** Quoi (code) : « acces:<id de l'appli> », « groupes », « compte », « role », « autonomie », « identite », « personne ». */
  quoi: string;
  /** Avant / après, en codes : listes séparées par « , », « actif » / « coupe », « clé=valeur;… » ; vide = rien. */
  avant: string;
  apres: string;
  /** « donne » : un droit de plus (passé par la validation) ; « limite » : un droit de moins. */
  sens: 'donne' | 'limite';
  /** Par où : « web » (Personnes), « persona » (l'appli). */
  canal?: string;
  t?: number;
}

let ecrire: ((c: ChangementDroit) => void) | undefined;

/** Odin branche l'écriture au journal des personnes (undefined : débranché). */
export function brancherJournalDroits(f: ((c: ChangementDroit) => void) | undefined): void { ecrire = f; }

/** Écrit un changement de droit ; ne lève jamais (le journal ne fait jamais échouer le changement). */
export function noterChangementDroit(c: ChangementDroit): void {
  try { ecrire?.(c); } catch { /* jamais bloquant */ }
}
