// La famille « Aujourd'hui » des widgets : les blocs de l'accueil devenus des widgets (lots 26 et 27). Ces neuf-là
// portent des validations, parlent de la conduite d'Odin ou de la maison du propriétaire : ils ne quittent JAMAIS l'accueil du propriétaire (constat
// G4) — jamais servis à /maison, même sur une page marquée « Écran de la maison », jamais « copiables » vers l'autre
// écran, jamais à un membre ni à une tablette. Leur page (« Aujourd'hui ») peut, elle, être montrée sur l'écran de la
// maison (validé le 24/11) : seuls les widgets ordinaires qu'on y a posés y vont.
// Lot 26 : « Tu veux sans doute », « À faire » et « Ce qu'Odin a fait » sont posables. Leur donnée n'est pas relue
// ici : le propriétaire la reçoit déjà, en direct, dans l'état de sa page (les validations, les propositions, le fil du
// jour) — une seule lecture par page. Le serveur ne rend donc que le droit de les voir et d'où vient la donnée
// (`source: 'etat'`), jamais un chiffre.
// Lot 27 (première part) : « Comment Odin se comporte » est posable lui aussi, de la même manière. Ses trois réglages
// (autonomie, disponibilité, discrétion) sont dans l'état de la page du propriétaire ; les changer passe par les mêmes
// gestes qu'avant (`set_autonomy`, `set_control`), avec les mêmes protections : rien n'est ouvert ici.
// Lot 27 (deuxième part) : les cinq chiffres cliquables (appareils en ligne, missions en cours, risques repérés,
// dépenses du mois, mode d'Odin) sont posables de la même manière. Ils sont calculés par la page du propriétaire, d'après
// l'état qu'elle reçoit déjà ; chacun mène à son détail, comme avant : rien n'est lu ni ouvert ici.
// Lot 27 (troisième part) : les quatre tuiles d'état (Surveillance, Sauvegarde, Résumé du matin, Application) sont
// posables de la même manière, une par widget. Ce sont les mêmes cartes, dessinées par la page du propriétaire d'après
// l'état qu'elle reçoit déjà ; leurs boutons font les mêmes gestes qu'avant (les réglages de la sauvegarde, la routine
// du matin par `routine_add`, l'installation et les notifications de l'appareil) : rien n'est lu ni ouvert ici.
import type { EtatWidget, SorteWidget } from './sorte.ts';

const reservee = { famille: 'aujourdhui', applis: [], styles: ['simple'], public: 'proprietaire', accueilSeul: true } as const;
/** Leurs tailles : une liste (4 lignes au départ) ou une rangée (de propositions, de réglages : 2 lignes). */
const liste = { mini: [3, 2], r: 4 } as const, rangee = { mini: [3, 2], r: 2 } as const;
/** Une tuile d'état : trois colonnes au moins, deux lignes au départ (la carte grandit avec son contenu). */
const tuile = { mini: [3, 2], r: 2 } as const;
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
  // « Comment Odin se comporte » : autonomie, disponibilité, discrétion. Il se retire et se repose, comme les deux d'avant.
  { id: 'comportement', ...reservee, taille: rangee, posable: true, nettoyer: etiquette, lire: dansLEtat },
  // Les cinq chiffres cliquables : appareils en ligne, missions en cours, risques repérés, dépenses du mois, mode d'Odin.
  // Les dépenses et le mode sont à lui seul. Ils se retirent et se reposent, comme tous ceux-ci sauf « À faire ».
  { id: 'chiffres_cles', ...reservee, taille: rangee, posable: true, nettoyer: etiquette, lire: dansLEtat },
  // Les quatre tuiles d'état. La surveillance (disques, appareils importants) et la sauvegarde parlent de sa maison ; le
  // résumé du matin crée une routine pour lui ; l'application installe Odin sur SON appareil. Elles se retirent.
  { id: 'surveillance', ...reservee, taille: tuile, posable: true, nettoyer: etiquette, lire: dansLEtat },
  { id: 'sauvegarde', ...reservee, taille: tuile, posable: true, nettoyer: etiquette, lire: dansLEtat },
  { id: 'resume_matin', ...reservee, taille: tuile, posable: true, nettoyer: etiquette, lire: dansLEtat },
  { id: 'application', ...reservee, taille: tuile, posable: true, nettoyer: etiquette, lire: dansLEtat },
] as const satisfies readonly SorteWidget[];

/**
 * La page « Aujourd'hui » de la fenêtre : rangée sous un code (son nom est écrit par l'interface, dans sa langue, pas
 * dans la donnée), avec ses widgets de départ. Des identifiants fixes : tant que le propriétaire n'a pas rangé sa
 * fenêtre, tous ceux qui la lisent (la page, la route des widgets) voient les mêmes. `c` : colonnes sur 12 ; la
 * hauteur est celle de départ de chaque sorte. Les cinq chiffres EN TÊTE, sur toute la largeur, comme la maquette (choix
 * du propriétaire) ; puis les propositions sur toute la largeur, deux colonnes, comme avant ; les réglages d'Odin en
 * dernier, sur toute la largeur (ils étaient sous la fenêtre : rien ne bouge à l'écran) ; enfin les quatre tuiles d'état,
 * côte à côte sur trois colonnes chacune, dans leur ordre d'avant (elles étaient sous la fenêtre, dans « État détaillé » :
 * la maquette ne les montre pas, elles gardent donc leur place, à la fin).
 * `depuis` : la livraison de l'accueil qui a apporté ce widget (1 : lot 26 ; 2 : lot 27, première part ; 3 : lot 27,
 * deuxième part ; 4 : lot 27, troisième part). Une fenêtre rangée avant cette livraison le reçoit une fois (gladsheim.ts, avecAujourdhui).
 * `tete` : une fenêtre déjà rangée le reçoit EN TÊTE de sa page (ce qui y était descend d'une rangée) ; sans `tete`, à
 * la fin.
 */
export const PAGE_AUJOURDHUI = {
  code: 'aujourdhui', id: '0a0f0000',
  widgets: [
    { id: '0a0f0005', kind: 'chiffres_cles', c: 12, depuis: 3, tete: true },
    { id: '0a0f0001', kind: 'tu_veux', c: 12, depuis: 1 },
    { id: '0a0f0002', kind: 'a_faire', c: 6, depuis: 1 },
    { id: '0a0f0003', kind: 'odin_a_fait', c: 6, depuis: 1 },
    { id: '0a0f0004', kind: 'comportement', c: 12, depuis: 2 },
    { id: '0a0f0006', kind: 'surveillance', c: 3, depuis: 4 },
    { id: '0a0f0007', kind: 'sauvegarde', c: 3, depuis: 4 },
    { id: '0a0f0008', kind: 'resume_matin', c: 3, depuis: 4 },
    { id: '0a0f0009', kind: 'application', c: 3, depuis: 4 },
  ],
} as const;
/**
 * La dernière livraison de l'accueil du propriétaire que la fenêtre peut avoir reçue. La fenêtre le porte (`accueil`),
 * et la page le renvoie quand elle range : un widget retiré après l'avoir reçu ne revient donc pas, et une page restée
 * ouverte depuis avant la livraison (elle ne le renvoie pas) ne le fait pas disparaître.
 */
export const ACCUEIL_RECU = 4;
/** Les codes de pages connus. */
export const CODES_PAGES = [PAGE_AUJOURDHUI.code] as const;
export type CodePage = (typeof CODES_PAGES)[number];
