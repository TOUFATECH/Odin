// Valhalla — les modules d'Odin (réécritures maison des applis du catalogue, sans doublon).
// Chaque module : une page (vue), des actions (aussi utilisables par Odin, Talos et le mode sans IA),
// des alertes, des événements, et des mots-clés pour qu'Odin choisisse le bon module tout seul.

export type Level = 'critique' | 'haute' | 'moyenne' | 'info';
export interface AlertIn { level: Level; title: string; detail?: string; key?: string; data?: Record<string, unknown>; /** image jointe au message (chemin d'un fichier JPEG ou PNG) */ photo?: string; /** ce qu'il faut faire, pas à pas (montré dans la bulle de la mascotte) */ steps?: string[]; /** la manip qui règle le problème (bouton de la bulle) */ fix?: { action: string; label: string; input?: Record<string, unknown>; module?: string } }
/** Options d'un message au propriétaire : urgent (passe « Ne pas déranger »), photo jointe. */
export interface NotifyOpts { urgent?: boolean; photo?: string }
export interface Alert extends AlertIn { id: string; at: string; module: string; ack?: boolean; count: number }

/** Qui a lancé une action : toi (clic, demande explicite), Odin de lui-même, un réflexe entre applis, une automatisation Talos, un autre assistant (MCP). */
export type By = 'toi' | 'odin' | 'réflexe' | 'automatisation' | 'assistant';
/** Comment défaire une action : l'action inverse (de la même appli, sauf mention). */
export interface Undo { action: string; input: Record<string, unknown>; label: string; module?: string }
/**
 * Une « manip » : une action faite sans que tu l'aies demandée toi-même (Odin seul, réflexe, automatisation).
 * Odin te prévient ; tu réponds « garde » ou « annule ». En mode Odin Breaker, il décide seul de garder.
 */
export interface Manip { id: string; at: string; module: string; action: string; label: string; input: Record<string, unknown>; text: string; by: By; why?: string; undo?: Undo; state: 'à décider' | 'gardée' | 'annulée'; decidedBy?: string; decidedAt?: string }

export interface Param { key: string; label: string; kind: 'text' | 'textarea' | 'number' | 'select' | 'boolean' | 'password' | 'image'; options?: string[]; default?: unknown; required?: boolean; help?: string;
  /** « image » : le navigateur la recadre à w × h, l'assombrit (voile 0-1), l'envoie, et l'action reçoit « image:<clé> » (fichier images/<clé>.png|jpg du module) */
  image?: { w: number; h: number; type: 'png' | 'jpeg'; voile?: number };
  /**
   * Ce réglage attend un fichier : dans la page, on peut taper son chemin OU l'envoyer depuis l'appareil (ordinateur,
   * téléphone). Le navigateur le dépose là où l'appli reçoit ses fichiers (`Module.depot`) et l'action reçoit sa
   * référence. `plusieurs` : plusieurs fichiers d'un coup, références séparées par des virgules.
   */
  depot?: { plusieurs?: boolean } }
export interface ActionResult { text: string; data?: unknown; ok?: boolean;
  /** Fichiers que la page peut remettre à l'appareil (bouton « Télécharger ») : `ref` est relu par `Module.retrait`, qui décide. */
  fichiers?: Array<{ nom: string; ref: string }> }
export interface Action {
  id: string; label: string; what: string;
  params?: Param[];
  /** lecture seule (sûr, disponible sans IA et sans accord) */
  read?: boolean;
  /** action grave → accord du propriétaire (Heimdall) ; renvoie la raison */
  grave?: (input: Record<string, unknown>, ctx?: ModCtx) => string | undefined;
  /** mots qui déclenchent cette action quand Odin n'a pas d'IA */
  words?: string[];
  /** comment défaire cette action si elle a réussi (action inverse) ; absent = pas d'annulation automatique */
  undo?: (input: Record<string, unknown>, result: ActionResult, ctx: ModCtx) => Undo | undefined;
  /** trop banale pour le journal des manips (lecture déguisée, accusé de réception…) */
  quiet?: boolean;
  /** sa réponse peut contenir du texte écrit par d'autres (page web, dépôt de code, serveur distant, attaquant) : l'IA la reçoit comme une donnée non fiable, jamais comme un ordre */
  external?: boolean;
  /** `false` : pas de bouton rapide sur la page (l'action reste dans « Autres actions », avec son formulaire) */
  quick?: boolean;
  run(ctx: ModCtx, input: Record<string, unknown>): Promise<ActionResult> | ActionResult;
}

export type Tone = 'bon' | 'attention' | 'mauvais' | 'neutre';
export interface Kpi { label: string; value: string; pct?: number; tone?: Tone; hint?: string }
/** Où une section se range dans une page à onglets. */
export interface Rangement {
  /** l'onglet où elle se montre (un de `View.onglets`) ; absent : le premier onglet */
  onglet?: string;
  /** dans une page à onglets, elle prend toute la largeur (les tableaux, journaux et graphes la prennent d'office) */
  large?: boolean;
}
export type Section = Rangement & (
  | { kind: 'table'; title: string; columns: string[]; rows: Array<{ cells: string[]; tone?: Tone; actions?: Array<{ action: string; label: string; input: Record<string, unknown>; /** une autre appli (ex. « ran ») */ module?: string }> }>; empty?: string }
  | { kind: 'list'; title: string; items: Array<{ title: string; detail?: string; tone?: Tone; meta?: string; /** un fichier de l'appli à remettre à l'appareil (bouton « Télécharger », lu par `Module.retrait`) */ fichier?: { nom: string; ref: string } }>; empty?: string; /** une phrase sous la liste */ aide?: string }
  /** Des cartes avec une icône (data: ou /…), un état, une barre de progression et des boutons. */
  | { kind: 'cards'; title: string; items: Array<{ icon?: string; title: string; sub?: string; badge?: string; tone?: Tone; progress?: number; meta?: string; actions?: Array<{ action: string; label: string; input: Record<string, unknown>; module?: string }> }>; empty?: string }
  | { kind: 'log'; title: string; lines: string[] }
  | { kind: 'text'; title: string; text: string; tone?: Tone }
  | { kind: 'bars'; title: string; items: Array<{ label: string; value: number; display?: string }> }
  /** Des courbes dans le temps (débit entrant / sortant…) : une valeur par étiquette. */
  | { kind: 'courbe'; title: string; labels: string[]; series: Array<{ name: string; tone?: Tone; points: number[] }>; unit?: string; empty?: string }
  | { kind: 'form'; title: string; action: string; params: Param[]; submit: string; /** une phrase sous le bouton */ aide?: string; /** des réglages envoyés tels quels avec le formulaire, sans champ à remplir */ fixe?: Record<string, unknown> }
  /**
   * Une zone où déposer un fichier de l'appareil (ou le choisir) : il est envoyé à l'appli (`Module.depot`), puis `action`
   * part avec sa référence dans le réglage `champ`. Avec `choix`, la page demande d'abord ce qu'on peut faire de ce
   * fichier (formats de sortie…) : l'action de lecture `choix.action` reçoit `{ nom }` et rend `data: ChoixDepot`.
   * Avec `lien` (et `choix`), on peut donner à la place le lien d'un fichier : `lien.action` reçoit le lien dans `lien.champ`, plus les choix faits.
   */
  | { kind: 'depot'; title: string; action: string; champ: string; plusieurs?: boolean; texte?: string; bouton?: string; aide?: string;
      lien?: { action: string; champ: string; label: string; aide?: string };
      choix?: { action: string; /** le titre au-dessus des choix (« Convertir en ») */ titre: string; /** le libellé du bouton final ; « {choix} » est remplacé par le choix fait (« Convertir en {choix} ») */ envoyer: string } }
  /** Une carte de boutons : chacun lance une action. Plus, au besoin, une liste déroulante et son bouton. */
  | { kind: 'actions'; title: string; boutons: Array<{ action: string; label: string; input?: Record<string, unknown>; primary?: boolean }>;
      liste?: { label: string; action: string; champ: string; valeurs: Array<{ valeur: string; label: string }>; bouton: string; /** dernière ligne de la liste : une valeur à taper soi-même (« Un autre dossier… ») */ libre?: string };
      aide?: string }
  /** assistant de configuration : étapes dans l'ordre, faites ou non, chacune avec l'action qui la fait */
  | { kind: 'steps'; title: string; items: Array<{ title: string; detail?: string; done: boolean; action?: string; input?: Record<string, unknown>; button?: string }> }
  /** graphe (même dessin que le Cerveau) : un clic sur un point ouvre sa fiche ; périodes pour revoir le passé */
  | { kind: 'graph'; title: string; nodes: GraphNode[]; edges: GraphEdge[]; details: Record<string, GraphDetail>; legend?: Array<[string, string]>; periods?: { current: string; options: Array<{ id: string; label: string }>; when?: string }; empty?: string }
);
/** Ce qu'on peut faire d'un fichier déposé (rendu dans `data` par l'action `choix` d'une section « depot »). */
export interface ChoixDepot {
  /** ce qu'est le fichier, en un mot (« vidéo », « sous-titres ») */ famille?: string;
  /** pourquoi on ne peut rien en faire (alors `groupes` est vide) */ refus?: string;
  /** le réglage de l'action qui reçoit le choix (« format ») */ champ: string;
  groupes: Array<{ titre: string; valeurs: Array<{ valeur: string; label: string }> }>; defaut?: string;
  /** d'autres réglages à boutons (« Qualité ») */ options?: Array<{ champ: string; titre: string; valeurs: Array<{ valeur: string; label: string }>; defaut?: string }>;
}
/** Un point du graphe : couleur, taille, anneau (nouveau, dangereux), carré (Odin, box, Internet), éteint. */
export interface GraphNode { id: string; label: string; sub?: string; color?: string; size?: number; ring?: string; square?: boolean; off?: boolean; hub?: boolean; alert?: { n: number; level: 'grave' | 'attention' }; search?: string }
export interface GraphEdge { a: string; b: string; color?: string; dash?: boolean; w?: number; title?: string; arrow?: 'to' | 'both' }
/** La fiche d'un point : titres, pastilles, lignes « clé · valeur · d'où vient l'info », liste, boutons. */
export interface GraphDetail { kind: string; title: string; subtitle?: string; chips?: Array<{ label: string; tone?: Tone }>; rows?: Array<{ k: string; v: string; src?: string }>; list?: { title: string; items: Array<{ text: string; meta?: string; tone?: Tone }> }; actions?: Array<{ action: string; label: string; input: Record<string, unknown>; module?: string; primary?: boolean }> }
/** Un poste que la page propose dans « Sur quel poste ? » (`id` vide : la machine d'Odin). */
export interface ChoixPoste { id: string; nom: string; /** pour le dessin et le libellé : « Windows », « Linux », « Mac », « NAS » */ sys?: string }
export interface View { subtitle?: string; kpis?: Kpi[]; sections: Section[]; side?: Section[]; tabs?: string[]; /** la page se met à jour toute seule (ex. une barre de progression) */ refreshMs?: number;
  /**
   * Les onglets de la page, dans l'ordre : 4 au plus, un mot court chacun (« Analyser », « Résultats », « Réglages »),
   * toujours sur une seule ligne. Chaque section dit le sien (`onglet`) ; une section sans onglet va dans le premier.
   * Sans `onglets`, la page reste d'un seul tenant (sections, puis `side` à droite).
   */
  onglets?: string[];
  /**
   * « Sur quel poste ? » en haut de la page : l'appli sait travailler sur un autre poste du coffre des machines.
   * La page garde le choix, le renvoie à la vue (`?poste=<id>` dans `q`) et le met dans le réglage `poste` de chaque
   * action qui en a un (ce réglage n'est alors plus montré dans les formulaires). Voir `choixDePoste` (postes.ts).
   */
  postes?: { actuel: string; choix: ChoixPoste[]; /** proposer « Ajouter un poste » : un écran en étapes (quel poste, son compte, essai de connexion) */ ajouter?: boolean;
    /** titre et phrase de cet écran (sinon « Ajouter un poste ») */ titre?: string; texte?: string;
    /** les ordinateurs vus sur le réseau, pas encore dans le coffre : proposés à la première étape */ trouves?: Array<{ adresse: string; nom: string; sys?: string }>;
    /**
     * Une dernière étape propre à l'appli (« Quoi analyser ? ») : des cartes à cocher, puis `action` part avec le poste
     * (`poste`), la carte cochée (`champ`) et, si la carte demande une précision, sa valeur (`demande.champ`).
     * « {poste} » dans `envoyer` est remplacé par le nom du poste.
     */
    ensuite?: { titre: string; champ: string; cartes: Array<{ valeur: string; titre: string; detail?: string; demande?: { champ: string; label: string; exemple?: string } }>; defaut?: string; action: string; envoyer: string; aide?: string } } }

export interface ModCtx {
  home: string;
  /** dossier de données du module */
  dir: string;
  settings: Record<string, unknown>;
  saveSettings(patch: Record<string, unknown>): void;
  alert(a: AlertIn): void;
  emit(type: string, data?: Record<string, unknown>): void;
  run(cmd: string, args: string[], o?: { timeoutMs?: number; input?: string; sudo?: boolean }): Promise<{ code: number; out: string; err: string }>;
  has(cmd: string): Promise<boolean>;
  fetch: typeof fetch;
  notify(text: string, o?: NotifyOpts): Promise<void>;
  /** IA d'Odin si disponible (sinon undefined) */
  ask?: (text: string) => Promise<string>;
  /** action d'un autre module (liens entre modules) ; `why` explique le réflexe dans le journal des manips */
  /** `o.interne` : étape interne d'une action déjà lancée (par toi, ou notée elle-même comme manip) : pas de manip à part pour cette étape */
  call(module: string, action: string, input?: Record<string, unknown>, why?: string, o?: { interne?: boolean }): Promise<ActionResult>;
  now(): Date;
  /** fil d'alertes commun (Forseti) */
  alerts(o?: { module?: string; level?: Level; q?: string; limit?: number }): Alert[];
  ack(ids: string[]): void;
  /** liste des modules (pour Valhalla et les explications) */
  modules(): Module[];
  /** comprend une demande en français SANS IA (Logos) et l'exécute ; une action grave n'est jamais lancée ainsi */
  order(text: string): Promise<ActionResult>;
}

export interface Module {
  id: string; name: string; family: 'Données' | 'Machines' | 'Accès' | 'Sécurité' | 'Maison';
  what: string;
  /** fonctions détaillées (pour l'explication « qui fait quoi ») */
  does: string[];
  /** applis d'origine dont il reprend les fonctions (affiché seulement dans « d'où ça vient ») */
  from: string[];
  /** dépôts GitHub suivis pour la veille des nouveautés */
  upstream: string[];
  /** mots-clés (français) pour choisir le module sans IA */
  words: string[];
  /** onglets/modes internes (anciens noms fusionnés) */
  modes?: string[];
  actions: Action[];
  view(ctx: ModCtx, q: URLSearchParams): Promise<View> | View;
  /** Où arrivent les fichiers envoyés depuis le navigateur pour cette appli, et comment une action les désigne ensuite (voir `Param.depot`). */
  depot?(ctx: ModCtx): { dossier: string; ref(nom: string): string };
  /** Le chemin d'un fichier de l'appli que la page a le droit de remettre à l'appareil (ou rien : refusé). Voir `ActionResult.fichiers`. */
  retrait?(ctx: ModCtx, ref: string): string | undefined;
  start?(ctx: ModCtx): void | Promise<void>;
  stop?(): void;
  /** surveillance périodique (alertes) ; appelée toutes les `every` secondes */
  watch?: { every: number; run(ctx: ModCtx): Promise<void> | void };
}
