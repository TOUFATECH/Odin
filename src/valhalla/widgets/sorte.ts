// Les widgets de la fenêtre d'Odin (maquette validée « Accueil », lot 23) : ce qu'est une SORTE de widget, et les
// mots communs à toutes les familles. Une famille par fichier (infos.ts, odin.ts, maison.ts, aujourdhui.ts) : deux
// lots de widgets de familles différentes ne touchent pas le même fichier. Rien ici ne lit Odin directement : la
// lecture passe par une « source » donnée par l'appelant (source.ts pour le vrai Odin, un faux dans les essais).
import type { Widget } from '../modules/gladsheim.ts';
import type { View } from '../types.ts';

/**
 * Les quatre familles de la maquette (une par fichier), la veille (les alertes, les sites d'Arachné : veille.ts) et les
 * listes d'Odin (l'agenda de Chronos, les recherches de Pythie, les sauvegardes de Phénix, les pubs bloquées par
 * Sphinx : listes.ts). Puis le widget de n'importe quelle appli (applis.ts). Puis ses automatisations de Talos et ce
 * qui part aujourd'hui (automatisations.ts). Puis la santé de la machine d'Odin et de ses disques (sante.ts). Puis son
 * stockage : volumes, partages, disques, lus par Pyramide (stockage.ts).
 */
export type Famille = 'infos' | 'odin' | 'maison' | 'aujourdhui' | 'veille' | 'listes' | 'applis' | 'automatisations' | 'sante' | 'stockage'
  // les appareils du réseau, lus dans le registre d'Odin, et le débit lu par Ariane (reseau.ts)
  | 'reseau';
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
  /**
   * Les mêmes alertes pas encore vues, lues de la même façon, pour la liste : leur identifiant, leur appli (et son nom),
   * leur titre, leur gravité, leur heure (ms). Ni leur détail, ni leurs données. Absente : cette source ne sait pas les lire.
   */
  alertesAVoir?(): ReadonlyArray<{ id: string; appli: string; nomAppli: string; titre: string; niveau: string; at: number }>;
  /** Les sites surveillés par Arachné (sans phrase, sans adresse). Rien (undefined) : Arachné n'est pas là. Absente : pas lue. */
  sitesVeille?(): readonly SiteVeille[] | undefined;
  /**
   * Les rendez-vous à venir de Chronos (src/valhalla/modules/frigg.ts, rendezVousAVenir), et le fuseau d'Odin où lire
   * leurs heures. Rien (undefined) : Chronos n'est pas là. Absente : pas lue.
   */
  rendezVous?(): { fuseau: string; liste: ReadonlyArray<{ id: string; titre: string; debut: number; fin: number; attente: boolean }> } | undefined;
  /** Les recherches gardées par Pythie : l'identifiant, la question, l'heure (ms). Rien : Pythie n'est pas là. Absente : pas lue. */
  recherches?(): ReadonlyArray<{ id: string; q: string; at: number }> | undefined;
  /**
   * L'état des sauvegardes de Phénix (src/valhalla/modules/sindri.ts, etatSauvegardes) et le fuseau d'Odin : des comptes
   * et des heures, ni nom de plan, ni chemin, ni destination, ni erreur. Rien : Phénix n'est pas là. Absente : pas lue.
   */
  sauvegardes?(): { fuseau: string; plans: number; derniere?: { at: number; type: string; octets?: number }; echecs: number; echecA?: number; enRetard: number; sansMesure: number; prochaine?: number } | undefined;
  /**
   * Ce que Sphinx a bloqué aujourd'hui (src/valhalla/modules/vidarr.ts, pubsBloquees) et le fuseau d'Odin : des comptes,
   * ni domaine, ni appareil. Rien : Sphinx n'est pas là. Absente : pas lue.
   */
  blocages?(): { fuseau: string; allume: boolean; questions: number; bloquees: number; depuis?: number; complet: boolean } | undefined;
  /**
   * Ce que le catalogue d'Odin dit d'une appli, pour son widget : son nom, sa famille, sa phrase, activée ou non, et ses
   * actions rapides (celles de sa page : rapides, sans champ obligatoire), chacune grave ou non. Rien (undefined) :
   * l'appli n'existe pas (inconnue, retirée). Absente : pas lue.
   */
  ficheAppli?(id: string): { id: string; name: string; family: string; what: string; active: boolean; actions: ReadonlyArray<{ id: string; label: string; grave: boolean }> } | undefined;
  /**
   * Les applis épinglées de qui regarde (les épingles du menu, src/web/epingles-api.ts, lues comme GET /api/epingles les
   * lit : par compte), dans leur ordre : rien que leurs identifiants, seulement celles qui existent dans Odin (ni les vues,
   * ni une appli retirée). `proprietaire` : les siennes ; `membre` : celles du membre au nom de qui la lecture est faite.
   * Rien (undefined) : on ne sait pas de qui les lire. Absente : pas lue.
   */
  epingles?(qui: 'proprietaire' | 'membre'): readonly string[] | undefined;
  /**
   * Ce que Talos montre dans sa liste « Automatismes » (src/web/talos-api.ts, la route GET /api/draupnir/automatismes,
   * lue telle quelle), et le fuseau d'Odin où Talos calcule ses heures : pour chaque ligne, son identifiant, sa sorte, son
   * nom, ce qu'elle fait, son rythme en clair, son état et sa prochaine heure (ISO). Rien (undefined) : Talos n'est pas
   * démarré, désactivé, ou ne répond pas. Absente : pas lue.
   */
  automatismes?(): Promise<{ fuseau: string; lignes: ReadonlyArray<{ id: string; sorte: string; nom: string; quoi: string; phrase: string; etat: string; prochaine?: string }> } | undefined>;
  /**
   * La santé de la machine d'Odin telle que Hygie la range chaque minute dans le magasin de mesures (src/valhalla/eir/collect.ts,
   * toSeries) : les relevés récents du processeur, de la mémoire, de chaque disque monté et de chaque capteur de température,
   * et les seuils de Hygie (ses réglages sur ses seuils de départ). `systeme` : le système de la machine (Hygie ne lit que
   * Linux : ailleurs, rien n'est lu). `mesures` absent : le magasin de mesures n'est pas là. Absente : pas lue.
   */
  santeMachine?(): { systeme: string; seuils?: Record<string, { suivre: number; attention: number; grave: number }>; mesures?: { cpu: Releves; mem: Releves; disques: readonly Releves[]; temperatures: readonly Releves[] } } | undefined;
  /**
   * La dernière lecture des disques de la machine d'Odin gardée par Tirésias (src/valhalla/modules/durinn.ts, Lecture), SANS
   * en relancer une : son heure (ISO), ce qui l'a empêchée (`panne` : un code de Tirésias), et ses disques tels qu'il les
   * garde. `systeme` : le système de la machine (Tirésias ne lit pas les disques sous Windows). `lecture` absente : Tirésias
   * n'a encore rien lu. Absente : pas lue.
   */
  disquesSante?(): { systeme: string; lecture?: { quand: string; panne?: string; disques: ReadonlyArray<unknown> } } | undefined;
  /**
   * Le stockage de la machine d'Odin (jamais un autre poste), tel que Pyramide le lit avec ses lectures « Disques » et
   * « Partages » (src/valhalla/modules/fensalir.ts) : ses disques, ses volumes montés, ses partages, lus sans confiance par
   * le widget (stockage.ts). `systeme` : le système de la machine (Pyramide ne lit pas les disques sous Windows : rien
   * n'y est lancé). Rien (undefined) : Pyramide n'est pas là, ou ne répond pas. Absente : pas lue.
   */
  stockage?(): Promise<{ systeme: string; disques: unknown; volumes: unknown; partages: unknown } | undefined>;
  /**
   * Les appareils de la maison tels que l'écran de la maison les reçoit déjà (etat.rooms de /api/maison/etat : ceux de
   * Constellation et des box reliées, lus par Midgard, src/valhalla/modules/midgard.ts, homeDevices), avec les unités
   * d'Odin. La valeur du moment seulement : jamais les relevés gardés dans le temps. Rien (undefined) : Midgard n'est pas
   * là, ou ne répond pas. Absente : pas lue.
   */
  appareilsMaison?(): Promise<{ unites: 'metrique' | 'imperial'; appareils: readonly AppareilVu[] } | undefined>;
  /**
   * Les scènes que Midgard garde (src/valhalla/modules/midgard.ts, homeScenes), dans leur ordre : le nom de chacune, le
   * nombre de ses étapes, et si elle ouvre la maison (sceneRisk : la règle qui demande son accord pour la lancer). Ni ses
   * étapes, ni un identifiant d'appareil. Rien (undefined) : Midgard n'est pas là. Absente : pas lue.
   */
  scenesMaison?(): ReadonlyArray<{ nom: string; etapes: number; ouvre: boolean }> | undefined;
  /**
   * Les appareils du réseau tels que le registre d'Odin les connaît (src/hlidskjalf/inventory.ts, sans les retirés), lus
   * par le branchement de reseau.ts : le nom lisible (deviceLabel), l'adresse, en ligne ou non au dernier balayage,
   * sa dernière nouvelle (ms) ; `at` : l'heure du dernier balayage. Jamais un balayage lancé par cette lecture. Rien
   * (undefined) : le registre n'est pas branché. Absente : pas lue.
   */
  appareilsReseau?(): { at?: number; appareils: ReadonlyArray<{ nom: string; ip: string; enLigne: boolean; vuA?: number }> } | undefined;
  /**
   * Le débit qu'Ariane mesure en lisant les paquets (src/valhalla/ran.ts, throughput) : reçu (d'Internet vers la maison) et
   * envoyé, en octets par seconde, et l'heure de la mesure. Rien (undefined) : Ariane n'est pas là, est en pause ou ne lit
   * pas les paquets. Absente : pas lue.
   */
  debitReseau?(): { recu: number; envoye: number; at: number } | undefined;
}

/**
 * Un appareil de la maison vu par un petit chiffre (maison.ts). `ids` : son identifiant et ses clés de valeur, pour
 * reconnaître une humidité (jamais montrés) ; `piece`, `sorte` (lumière, prise, capteur…), `etat`, `unite` : ce que
 * l'écran de la maison reçoit déjà ; `marche` et `arret` : ce qui veut dire allumé ou éteint pour lui ; `enLigne` faux :
 * hors ligne ; `vuA` : sa dernière nouvelle (ms). Absents : on ne le sait pas. `liens` : ce qui relie un capteur au
 * module qui le porte (ses sujets d'état, le module Tasmota) : une prise et sa puissance en partagent un (jamais montrés).
 */
export interface AppareilVu { ids: string; piece: string; sorte: string; etat: string; unite: string; marche: string; arret: string; enLigne?: boolean; vuA?: number; liens?: readonly string[];
  /** Pour les widgets d'un appareil (maison-appareils.ts) : son identifiant et son nom, tels que l'écran de la maison les reçoit (etat.rooms), et faux s'il ne reçoit aucun ordre (un capteur). */
  id?: string; nom?: string; commandable?: boolean }

/** Une suite de relevés d'une mesure : [instant (ms), valeur]. */
export type Releves = ReadonlyArray<readonly [number, number]>;

/** Un site surveillé par Arachné, tel qu'un widget le lit (src/valhalla/modules/idunn.ts, sitesVeille). */
export interface SiteVeille {
  nom: string;
  /** Répond-il ? Absent : pas encore vérifié. */
  enLigne?: boolean;
  /** Il répond, mais plus lentement que le seuil d'Arachné. */
  lent: boolean;
  /** Son temps de réponse à la dernière vérification (ms), si Arachné le garde. */
  ms?: number;
  /** L'heure de sa dernière vérification (ms). */
  verifieA?: number;
  /** En panne : depuis quand (ms), si Arachné l'a noté. */
  enPanneDepuis?: number;
  /** « Relancer » existe pour lui (il est relié à Vercel). */
  relancer: boolean;
  /** Tous les combien il est vérifié (minutes). */
  toutesLes: number;
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
  /**
   * Jamais sur l'écran de la maison (au mur, lu par toute la maison), à personne, lui compris : ce qui est à une personne
   * (ses épingles, ses alertes) ou ce qui nommerait ses disques et ses partages. Lue par la règle de cet écran
   * (admiseALaMaison) et par « Copier vers l'autre écran ». Elle ne fait que refuser.
   */
  jamaisALaMaison?: boolean;
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
