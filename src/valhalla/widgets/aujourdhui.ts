// La famille « Aujourd'hui » des widgets : les blocs de l'accueil devenus des widgets (lots 26 et 27). Ces quatre-là
// portent des validations ou parlent de la conduite d'Odin : ils ne quittent JAMAIS l'accueil du propriétaire (constat
// G4) — jamais servis à /maison, même sur une page marquée « Écran de la maison », jamais « copiables » vers l'autre
// écran, jamais à un membre ni à une tablette. Leur page (« Aujourd'hui ») peut, elle, être montrée sur l'écran de la
// maison (validé le 24/11) : seuls les widgets ordinaires qu'on y a posés y vont.
// Lot 26 : « Tu veux sans doute », « À faire » et « Ce qu'Odin a fait » sont posables. Leur donnée n'est pas relue
// ici : le propriétaire la reçoit déjà, en direct, dans l'état de sa page (les validations, les propositions, le fil du
// jour) — une seule lecture par page. Le serveur ne rend donc que le droit de les voir et d'où vient la donnée
// (`source: 'etat'`), jamais un chiffre. « Comment Odin se comporte » (lot 27) est déclaré, pas encore posable.
import type { EtatWidget, SorteWidget } from './sorte.ts';

const reservee = { famille: 'aujourdhui', applis: [], styles: ['simple'], public: 'proprietaire', accueilSeul: true } as const;
/** Leurs tailles : une liste (4 lignes au départ) ou une rangée de propositions (2 lignes). */
const liste = { mini: [3, 2], r: 4 } as const, rangee = { mini: [3, 2], r: 2 } as const;
/** Le titre choisi par le propriétaire : 40 signes. */
const etiquette: NonNullable<SorteWidget['nettoyer']> = (o, out, t) => { if (o.label) out.label = t.str(o.label, 40); return true; };
/** La donnée est dans l'état de la page du propriétaire : ici, seulement « tu peux le voir », et l'heure. */
const dansLEtat: NonNullable<SorteWidget['lire']> = async (_w, src): Promise<EtatWidget> => ({ etat: 'ok', at: src.maintenant(), donnee: { source: 'etat' } });

export const SORTES_AUJOURDHUI = [
  // « À faire » : les validations en attente, avec « Autoriser » et « Refuser ». Il se déplace, il ne se retire pas.
  { id: 'a_faire', ...reservee, taille: liste, fixe: true, posable: true, nettoyer: etiquette, lire: dansLEtat },
  // « Ce qu'Odin a fait », ses filtres et son « Annuler ».
  { id: 'odin_a_fait', ...reservee, taille: liste, posable: true, nettoyer: etiquette, lire: dansLEtat },
  // « Tu veux sans doute » : ce qu'Odin propose.
  { id: 'tu_veux', ...reservee, taille: rangee, posable: true, nettoyer: etiquette, lire: dansLEtat },
  // « Comment Odin se comporte » : autonomie, disponibilité, discrétion.
  { id: 'comportement', ...reservee, taille: { mini: [3, 2], r: 3 }, posable: false },
] as const satisfies readonly SorteWidget[];

/**
 * La page « Aujourd'hui » de la fenêtre : rangée sous un code (son nom est écrit par l'interface, dans sa langue, pas
 * dans la donnée), avec ses trois widgets de départ. Des identifiants fixes : tant que le propriétaire n'a pas rangé sa
 * fenêtre, tous ceux qui la lisent (la page, la route des widgets) voient les mêmes. `c` : colonnes sur 12 ; la
 * hauteur est celle de départ de chaque sorte. Les propositions sur toute la largeur, puis deux colonnes, comme avant.
 */
export const PAGE_AUJOURDHUI = {
  code: 'aujourdhui', id: '0a0f0000',
  widgets: [
    { id: '0a0f0001', kind: 'tu_veux', c: 12 },
    { id: '0a0f0002', kind: 'a_faire', c: 6 },
    { id: '0a0f0003', kind: 'odin_a_fait', c: 6 },
  ],
} as const;
/** Les codes de pages connus. */
export const CODES_PAGES = [PAGE_AUJOURDHUI.code] as const;
export type CodePage = (typeof CODES_PAGES)[number];
