// La famille « Aujourd'hui » des widgets : les blocs de l'accueil d'aujourd'hui qui deviendront des widgets (lots 26
// et 27). Ces quatre-là portent des validations ou parlent de la conduite d'Odin : ils ne quittent JAMAIS l'accueil du
// propriétaire (constat G4) — jamais servis à /maison, même sur une page marquée « Écran de la maison », jamais
// « copiables » vers l'autre écran, jamais à un membre ni à une tablette. Déclarés ici, pas encore posables : l'écran
// ne sait pas encore les dessiner, cleanLayout les jette comme une sorte inconnue.
import type { SorteWidget } from './sorte.ts';

const reservee = { famille: 'aujourdhui', applis: [], taille: { mini: [3, 2], r: 3 }, styles: ['simple'], public: 'proprietaire', accueilSeul: true, posable: false } as const;

export const SORTES_AUJOURDHUI = [
  // « À faire » : les validations en attente, avec « Autoriser » et « Refuser ».
  { id: 'a_faire', ...reservee },
  // « Ce qu'Odin a fait », ses filtres et son « Annuler ».
  { id: 'odin_a_fait', ...reservee },
  // « Tu veux sans doute » : ce qu'Odin propose.
  { id: 'tu_veux', ...reservee },
  // « Comment Odin se comporte » : autonomie, disponibilité, discrétion.
  { id: 'comportement', ...reservee },
] as const satisfies readonly SorteWidget[];
