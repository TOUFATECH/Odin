// Les widgets de la fenêtre d'Odin (maquette validée « Accueil », lot 23) : ce qu'est une SORTE de widget, et les
// mots communs à toutes les familles. Une famille par fichier (infos.ts, odin.ts, maison.ts, aujourdhui.ts) : deux
// lots de widgets de familles différentes ne touchent pas le même fichier. Rien ici ne lit Odin directement : la
// lecture passe par une « source » donnée par l'appelant (source.ts pour le vrai Odin, un faux dans les essais).
import type { Widget } from '../modules/gladsheim.ts';
import type { View } from '../types.ts';

/** Les quatre familles de la maquette (une par fichier). */
export type Famille = 'infos' | 'odin' | 'maison' | 'aujourdhui';
/**
 * Qui peut recevoir un widget de cette sorte, au plus (constat M12, trois niveaux) :
 * - `proprietaire` : lui seul (le défaut, quand rien n'est écrit) ;
 * - `membre` : aussi un membre de la famille QUI A LE DROIT sur chaque appli lue ;
 * - `maison` : aussi une tablette « maison » (seulement les familles « infos » et « maison », sans action grave).
 * Chaque niveau contient le précédent. Un widget « vie privée » reste fermé à un membre et à une tablette tant que le
 * propriétaire ne l'a pas ouvert pour cette personne (sa réponse à la question 15 : un par un, par personne).
 */
export type Public = 'proprietaire' | 'membre' | 'maison';
/** Qui regarde : le propriétaire, un membre de la famille, une tablette au mur avec une clé « maison ». */
export type Qui = 'proprietaire' | 'membre' | 'maison';
/** Où le widget serait montré : l'accueil (la fenêtre d'Odin) ou l'écran de la maison (/maison). */
export type Ecran = 'accueil' | 'maison';

/**
 * Les cinq états d'un widget, les mêmes pour tous, portés par un code et jamais par une phrase (les mots sont dans
 * l'interface, à un seul endroit) :
 * - `ok` : la donnée, avec l'heure où elle a été lue ;
 * - `vide` : rien à montrer ; `raison` dit pourquoi (un code), pour l'unique bouton qui y remédie ;
 * - `source_absente` : Odin ne sait pas (encore) lire cela, ou l'appli n'est pas là ;
 * - `refuse` : la personne n'a pas le droit ; `appli` dit laquelle quand c'est une question d'appli ;
 * - `ancien` : la source ne répond plus ; la dernière donnée reste, avec son heure.
 */
export type EtatWidget =
  | { etat: 'ok'; at: number; donnee: Record<string, unknown> }
  | { etat: 'vide'; raison: string }
  | { etat: 'source_absente'; raison: string }
  | { etat: 'refuse'; raison: string; appli?: string }
  | { etat: 'ancien'; at: number; donnee: Record<string, unknown>; motif: string };
export const ETATS = ['ok', 'vide', 'source_absente', 'refuse', 'ancien'] as const;

/** Ce que la fonction « la donnée d'un widget » sait de qui regarde. */
export interface Lecteur {
  qui: Qui;
  ecran: Ecran;
  /** Pour un membre : a-t-il le droit sur cette appli ? Absent : non. */
  peutLire?: (appli: string) => boolean;
  /**
   * Ce que le propriétaire a ouvert à cette personne ou à cette tablette : un widget POUR une appli de la vie privée,
   * clé `cleOuverture(widget, appli)` (« identifiant@appli »). Absent : rien.
   */
  ouverts?: ReadonlySet<string>;
}

/** Une appli vue par un widget : son identifiant, son nom, sa famille dans Odin. */
export interface AppliVue { id: string; name: string; family: string }
/** Une action d'appli vue par un widget (bouton) : ce qu'il faut pour décider qui peut la lancer. */
export interface ActionVue { label: string; grave: boolean; proprietaireSeul: boolean }
/** Tout ce qu'un widget peut lire. Donnée par l'appelant : le vrai Odin (source.ts) ou un faux (essais). */
export interface SourceWidget {
  appli(id: string): AppliVue | undefined;
  vue(id: string): Promise<View | null>;
  action(appli: string, action: string, input: Record<string, string>): ActionVue | undefined;
  /** La météo du lieu d'Odin, si elle a pu être lue ; `ancien` : la dernière lecture a échoué. */
  meteo(): Promise<{ donnee: Record<string, unknown>; at: number; ancien: boolean; motif: string } | undefined>;
  /** Le lieu d'Odin : `choisi` faux tant que personne (ni lui, ni Odin tout seul) ne l'a réglé. */
  lieu(): { choisi: boolean; nom: string; fuseau: string; heure12: boolean };
  maintenant(): number;
  /**
   * Les alertes pas encore vues (« vu » : ack), telles que Valhalla les garde : rien que l'appli de chacune, ni titre ni
   * détail. Lues au nom de qui regarde (pour un membre, sans celles de Sphinx qui ne sont pas de son appareil).
   * Absente : cette source ne sait pas les lire.
   */
  alertesNonVues?(): ReadonlyArray<{ appli: string }>;
}

/** Les outils de nettoyage donnés à une sorte par cleanLayout. */
export interface Outils { str: (v: unknown, n: number) => string }

/** Une sorte de widget. */
export interface SorteWidget {
  id: string;
  famille: Famille;
  /**
   * Les applis lues. `choisie` : l'appli que la personne a choisie pour ce widget (son champ `module`) ;
   * sinon la liste fixe (vide : aucune appli derrière).
   */
  applis: 'choisie' | readonly string[];
  /** Ses tailles : la plus petite [colonnes sur 12, lignes] et la hauteur de départ. */
  taille: { mini: readonly [number, number]; r: number };
  /** Ses styles (le premier est celui de départ). Un seul : la sorte n'a pas de choix de style. */
  styles: readonly string[];
  /** Son public au plus. Absent : propriétaire seul. */
  public?: Public;
  /** Jamais hors de l'accueil du propriétaire : jamais servie à /maison, jamais « copiable » vers l'autre écran (constat G4). */
  accueilSeul?: boolean;
  /** Vrai : se déplace mais ne se retire pas de la fenêtre (« À faire », constat M11). Absent : se retire. */
  fixe?: boolean;
  /** Vrai : cleanLayout l'accepte déjà (l'écran sait la dessiner). Faux : déclarée, pas encore posable. */
  posable: boolean;
  /** Les réglages propres à la sorte, nettoyés sur `out` (déjà muni de id, kind, taille, module). Faux : le widget est jeté. */
  nettoyer?: (o: Record<string, unknown>, out: Widget, t: Outils) => boolean;
  /** La donnée de ce widget (les droits sont déjà vérifiés). Absent : `source_absente`. */
  lire?: (w: Widget, src: SourceWidget, l: Lecteur) => Promise<EtatWidget>;
}

/** Une valeur montrée porte-t-elle une vraie mesure (un chiffre autre que 0) ? « 0 », « — », « 0 / 0 », « arrêtée » : non. */
export const porteUneMesure = (v: unknown) => /[1-9]/.test(String(v ?? ''));
