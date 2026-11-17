// Le registre des automatismes : tout ce que les applis font toutes seules, visible dans Talos (« Automatismes »).
// Chaque appli qui a une surveillance (`watch`) y a sa ligne (veille continue ou tâche à rythme réglable), plus les
// tâches qu'elle déclare (`Module.taches` : vérification des ISO, sauvegardes…). Le registre garde les minuteries des
// surveillances (premier passage à 20-40 s, puis toutes les `every` secondes, comme avant), mesure chaque passage,
// sait les lancer à la main, les mettre en pause et, pour les tâches, changer leur rythme.
// Rien n'est écrit sur le disque après un relevé de veille : seulement quand on change quelque chose, ou après le
// passage d'une tâche (<home>/valhalla/automatismes.json, écrit d'un coup).

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JobRow } from '../muninn/store.ts';
import { phrase, prochaine, texteDate, verifierRythme, type GenreRythme, type Rythme } from '../draupnir/rythme.ts';
import type { ActionResult, AlertIn, ModCtx, Module, TacheAppli } from './types.ts';

// ---------------------------------------------------------------- Ce que Talos montre (contrat avec l'interface)

export type SorteLigne = 'veille' | 'tache' | 'automatisation' | 'tache_odin' | 'rappel' | 'rendez_vous';
export interface Passage { at: string; ok: boolean; ms?: number; texte?: string }
export interface Ligne {
  id: string; sorte: SorteLigne; appli?: string; applis: string[];
  nom: string; quoi: string;
  rythme?: Rythme; phrase: string;
  reglable: GenreRythme[];
  prochaine?: string; prochaineTexte?: string;
  derniere?: Passage;
  etat: 'actif' | 'pause' | 'arret' | 'en_cours' | 'erreur';
  pauseJusqua?: string;
  securite?: boolean;
  moyen?: string;
  quand?: string; quandTexte?: string;
  lien?: { vue: 'flows' | 'jobs' | 'app'; appli?: string; flow?: string };
  peut: { lancer: boolean; pause: boolean; rythme: boolean; decaler: boolean; supprimer: boolean };
}
export interface ElementAgenda { quand: string; quandTexte: string; fin?: string; titre: string; sorte: SorteLigne; appli?: string; moyen?: string; ligne?: string }

// ---------------------------------------------------------------- Le classement des surveillances

export interface Classement { genre: 'veille' | 'tache'; nom: string; quoi: string; securite?: boolean; permis?: GenreRythme[] }
const V = (nom: string, quoi: string, securite = false): Classement => ({ genre: 'veille', nom, quoi, ...(securite ? { securite: true } : {}) });
const T = (nom: string, quoi: string, permis: GenreRythme[], securite = false): Classement => ({ genre: 'tache', nom, quoi, permis, ...(securite ? { securite: true } : {}) });
/** Une entrée par appli qui a une surveillance (`watch`). Un essai vérifie qu'il n'en manque aucune et qu'il n'y en a pas en trop. */
export const CLASSEMENT: Record<string, Classement> = {
  agora: V('Ordres aux appareils', 'Signale un ordre en attente depuis plus d\'un jour et remet le store d\'accord.'),
  argos: V('Mises à jour de sécurité', 'Veille que l\'antivirus, l\'anti-malware et leurs sources sont à jour ; prévient si une vérification a pris du retard.', true),
  bru: V('Tunnel Cloudflare', 'Relance le tunnel et prévient s\'il est coupé.'),
  dvalinn: V('File des conversions', 'Reprend les travaux en attente et efface les dossiers de travail de plus d\'un jour.'),
  eir: V('Santé de la machine', 'Disque, mémoire, processeur, température et mesures des courbes.'),
  forseti: V('Intégrité des fichiers sensibles', 'Empreintes de passwd, sudoers, authorized_keys…', true),
  garmr: V('Journaux et bannissements', 'Lit les journaux, bannit les attaquants et lève les bannissements échus.', true),
  gefjon: V('Nettoyages planifiés', 'Lance chaque plan de nettoyage à son heure.'),
  geri: V('Connexions sortantes', 'Compare les connexions aux listes d\'adresses malveillantes (rafraîchies chaque jour).', true),
  gjoll: V('Trafic du VPN et ouverture de la box', 'Historique du trafic et renouvellement de l\'ouverture UPnP.'),
  gna: T('Ménage des trajets', 'Efface les vieilles positions et vérifie l\'écriture.', ['minutes', 'heures']),
  hermod: V('Machines du parc', 'Teste si chaque machine répond.'),
  himinbjorg: V('Mouvement des caméras', 'Détection de mouvement aux heures surveillées.', true),
  hlid: V('Ports sensibles', 'Services sensibles ouverts avec le pare-feu éteint, ports directs.', true),
  hlin: T('Demandes de retrait (RGPD)', 'Délais dépassés, relances, plainte CNIL.', ['heures', 'jour']),
  idunn: V('Sondes des sites', 'Chaque site à son rythme.'),
  ivaldi: V('Terminaux et projets', 'Ferme les terminaux inactifs, vérifie les projets git toutes les 12 h.'),
  kvasir: T('Nouveautés des projets d\'origine', 'Nouvelles versions sur GitHub, résumé, base Évolutions.', ['heures', 'jour', 'semaine']),
  leikvangr: T('Rangement des jeux', 'Relit les dossiers de jeux.', ['heures', 'jour']),
  mathesis: V('Odin apprend tout seul', 'Cherche ce qu\'il ne sait pas et lit des pages publiques, sous les budgets du jour ; s\'arrête dès qu\'Odin doit répondre.'),
  mimisbrunnr: V('Règles sur les journaux', 'Prévient quand un motif revient trop.', true),
  naglfar: V('Conteneurs', 'Relance les services voulus.'),
  pegase: V('Ronde de Pégase', 'Ronde des appareils, installateurs chaque jour.'),
  pronoia: V('Prévisions à juger', 'Juge les prévisions arrivées à échéance et purge chaque nuit les plus anciennes.'),
  ran: V('Connexions vers l\'étranger', 'Pays inhabituels par appareil.', true),
  sindri: V('Plans de sauvegarde', 'Lance chaque plan à son heure, prévient s\'il est en retard, vérification le dimanche à 4 h 30.'),
  skidbladnir: V('Synchros et envois', 'Synchronise les dossiers, met les envois expirés à la corbeille.'),
  skogul: V('Processus suspects et ports à l\'écoute', 'Processus suspects et nouveaux ports à l\'écoute.', true),
  skuld: V('Sauvegardes des bases', 'Lance les plans de sauvegarde des bases.'),
  svalinn: V('Retour Wi-Fi', 'Annule un changement Wi-Fi si les appareils ne reviennent pas.'),
  syn: V('Seuils des tableaux de bord', 'Prévient quand un seuil est franchi.'),
  syrinx: V('Purge des sons de la nuit', 'Une fois par nuit, efface les écoutes devenues trop anciennes.'),
  thjalfi: V('Postes en installation', 'Suit les postes en cours d\'installation.'),
  ullr: V('Antivirus', 'Pièges, quarantaine, supports amovibles, analyses planifiées.', true),
  valgrind: V('Porte d\'entrée (proxy)', 'Relance le proxy et met à jour les bannis.', true),
  var: V('Sessions expirées', 'Retire les sessions expirées.'),
  freyja: V('Enregistrements échoués', 'Reprend les enregistrements qui ont échoué.'),
  vidarr: V('Historique des menaces', 'Résume chaque jour passé.', true),
  vordr: V('Moniteurs', 'Chaque moniteur à son rythme, déclencheurs et escalade.'),
  ymir: V('Machines virtuelles, ISO déposées, logiciels installés', 'État des machines, ISO déposées à la main, logiciels à mettre à jour.'),
  appareils: T('Piles faibles et appareils muets', 'Prévient quand une pile faiblit ou qu\'un appareil ne donne plus de nouvelles.', ['heures', 'jour']),
  askr: T('Garanties, prêts, licences', 'Échéances des garanties, prêts et licences (une fois par jour).', ['heures', 'jour']),
  bragi: T('Effacement des enregistrements audio', 'Efface les enregistrements audio trop anciens.', ['heures', 'jour']),
  brisingamen: T('Fuites de mots de passe', 'Cherche tes mots de passe dans les fuites connues.', ['jour', 'semaine', 'mois'], true),
  durinn: T('Relevé SMART des disques', 'Relevé SMART des disques (toutes les 6 h par poste).', ['heures']),
  fensalir: V('Disques du NAS', 'Remplissage et panne SMART.'),
  frigg: T('Rappel des rendez-vous clients', 'Rappel la veille des rendez-vous des clients (après 17 h). Les rendez-vous perso passent par les rappels.', []),
  zeus: V('Relevés et bilan de la météo', 'Garde chaque matin ce que chaque source prévoit, puis le compare avec ce qui a été mesuré.'),
  sol: T('Indexation des photos', 'Indexe les nouvelles photos.', ['heures', 'jour']),
  achille: V('Contrôle passif de tes sites', 'Une fois par semaine, une seule page par site déclaré : en-têtes, cookies, certificat.', true),
  atalante: V('File des téléchargements', 'Fait avancer la file et respecte les heures creuses.'),
  dodone: V('Collections programmées', 'Lance chaque collection à son rythme et prévient quand un test échoue.'),
  eitri: V('Passage programmé et résumé du jour', 'Passage aux jours programmés et résumé du jour.'),
  fjalar: V('Passage programmé, scan du dossier des logiciels', 'Passage aux jours programmés, logiciels déposés à la main, vérification planifiée.'),
};

// ---------------------------------------------------------------- Sources hors applis (posées au démarrage)

/** Les tâches planifiées d'Odin (Mnémosyne) : ce que le registre lit et change. */
export interface SourceJobs {
  listJobs(): JobRow[];
  removeJob(id: string): boolean;
  /** ajoute une tâche (la copie d'un rappel unique lancé tout de suite) */
  addJob?(j: Omit<JobRow, 'enabled' | 'last_run'>): void;
  setJobEnabled?(id: string, on: boolean): void;
  setJobNext?(id: string, next: number): void;
  setJobCron?(id: string, cron: string, next: number): void;
}
/** Les automatisations de Talos (le minimum lu par le registre et l'agenda). */
export interface SourceFlows { list(): Array<{ id: string; name: string; active: boolean; nodes: Array<{ name: string; type: string; params: Record<string, unknown>; disabled?: boolean }> }> }
export interface SourcesOdin {
  jobs?: SourceJobs;
  /** changements d'une tâche planifiée, si `jobs` ne les fait pas lui-même */
  majJob?: { activer?(id: string, on: boolean): void; prochaine?(id: string, next: number): void; cron?(id: string, cron: string, next: number): void };
  flows?: () => SourceFlows | undefined;
  /** les rappels de la passerelle : sur le moyen du propriétaire (Telegram d'abord), sans IA */
  rappels?: { programmer(texte: string, quand: Date): string | undefined; annuler(id: string): boolean };
  /** le nom du moyen relié du propriétaire (« Telegram »…) ; undefined : aucune messagerie reliée */
  moyen?: () => string | undefined;
  /** tous les plannings d'Odin entre deux dates (lu par l'agenda de Chronos) */
  agenda?: (de: Date, a: Date) => ElementAgenda[];
}
/** Le nom affiché d'un canal de la passerelle (« telegram » → « Telegram »). */
export function nomMoyen(canal: string): string {
  const N: Record<string, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp', discord: 'Discord', slack: 'Slack', signal: 'Signal', mail: 'E-mail', web: 'Discussion d\'Odin', http: 'Discussion d\'Odin', keryx: 'Kéryx', sms: 'SMS', appel: 'Appel' };
  return N[canal] ?? (canal ? canal.charAt(0).toUpperCase() + canal.slice(1) : 'Discussion d\'Odin');
}
let sources: SourcesOdin = {};
/** Branche les sources d'Odin (au démarrage, après la passerelle et Valhalla). Un appel complète les précédents. */
export function brancherSources(s: SourcesOdin): void { sources = { ...sources, ...s }; }
export const sourcesOdin = (): SourcesOdin => sources;
/** Tous les plannings d'Odin entre deux dates (vide tant que la source n'est pas branchée). */
export function agendaOdin(de: Date, a: Date): ElementAgenda[] { try { return sources.agenda?.(de, a) ?? []; } catch { return []; } }

// ---------------------------------------------------------------- Le registre

/** Une pause. Celle d'un lien écrit entre applis (`lien:<id>`) porte aussi `lien: true` et `protege`. */
interface PauseEtat { depuis: string; jusqua?: string; alerte?: string; lien?: true; protege?: boolean }
/** Un geste sur un lien écrit : qui, quand, quel lien. */
export interface GesteLien { at: string; lien: string; geste: 'coupé' | 'rétabli'; par: string; jusqua?: string }
interface Etat { pauses: Record<string, PauseEtat>; rythmes: Record<string, Rythme>; derniers: Record<string, Passage>; journal: GesteLien[] }
export interface HoteAutomatismes {
  dir: string;
  now(): Date;
  modules(): Module[];
  ctx(id: string): ModCtx;
  alert(module: string, a: AlertIn): unknown;
  /** marque des alertes comme vues (la pause levée retire la sienne) */
  ack?(ids: string[]): void;
  /** lance l'action d'une appli (par le propriétaire) */
  act(module: string, action: string, input: Record<string, unknown>): Promise<ActionResult>;
}
/** Une tâche inscrite hors des applis : `faire` remplace l'action de l'appli. */
export type TacheInscrite = TacheAppli & { faire?: () => Promise<ActionResult | void> };
type Reponse<T> =({ ok: true } & T) | { ok: false; code: string; error: string; confirm?: string };

let actif: Automatismes | undefined;
/** La tâche `tache` de l'appli `module` est-elle en pause dans Talos ? Lu par l'appli avant son passage planifié. */
export function tacheEnPause(module: string, tache: string): boolean { return actif?.enPause(`tache:${module}:${tache}`) ?? false; }

// ---------------------------------------------------------------- Les liens écrits entre applis, coupés depuis la page
// Couper un lien, c'est une pause d'identifiant `lien:<id>` dans ce registre (pas de registre à part). Seule
// `couperLien` y mène : `pause()` refuse un `lien:` qui n'arrive pas par elle (la marque ci-dessous n'est pas exportée).
// Un essai vérifie que seule la route de la page (src/web/talos-api.ts) importe `couperLien`.
const PAR_LA_PAGE: unique symbol = Symbol('lien coupé depuis la page');
/** Le lien à couper, tiré de LINKS par la route de la page (ce fichier n'importe pas links.ts). */
export interface LienACouper {
  id: string; nom: string; de: string; protege: false | { raison: string };
  /** les autres liens coupés par le même interrupteur (même point de coupure) */
  aussi?: string[];
  /** qui fait le geste (journal) */
  qui: string;
  /** une précision dite dans la confirmation et dans l'alerte de coupure (un lien d'alerte : l'appli continue d'agir) */
  note?: string;
}
export type EtatLien = { depuis: string; jusqua?: string };
/** Coupe (`couper` vrai) ou rétablit un lien écrit. RÉSERVÉ à la route de la page, appelée par la session du propriétaire. */
export function couperLien(l: LienACouper, couper: boolean, o: { jusqua?: string; confirme?: boolean } = {}): Reponse<{ lien: string; coupe?: EtatLien }> {
  if (!actif) return { ok: false, code: 'introuvable', error: 'Les applis ne sont pas démarrées.' };
  return actif.pause(`lien:${l.id}`, couper, { ...o, [PAR_LA_PAGE]: l }) as Reponse<{ lien: string; coupe?: EtatLien }>;
}
/** Ce lien écrit est-il coupé ? Lu par `wireReflexes` avant d'agir. Un état abîmé ou illisible ne coupe rien. */
export function lienCoupe(id: string): boolean { return actif?.lienCoupe(id) ?? false; }
/** L'état d'un lien coupé (depuis, jusqu'à), sinon undefined. */
export function etatLien(id: string): EtatLien | undefined { return actif?.etatLien(id); }
/** Les gestes sur les liens (les plus récents à la fin). */
export function journalLiens(): GesteLien[] { return actif?.journalLiens() ?? []; }

const PAS = 30_000, GARDER = 20, MAX_PAUSE_SECU = 24 * 3600_000, JOURNAL = 500;
/** Les surveillances qui font un long travail dans leur passage (sauvegardes, vérifications, téléchargements) : 6 h avant d'être dites bloquées. */
const LONGUES = new Set(['sindri', 'skuld', 'ymir', 'eitri', 'fjalar', 'gefjon', 'skidbladnir', 'dvalinn', 'sol', 'kvasir', 'durinn', 'brisingamen', 'leikvangr', 'pegase', 'atalante']);
/** Les surveillances qui protègent sans être des veilles de sécurité : leur pause sans fin pose une alerte haute. */
const PROTEGENT = new Set(['sindri', 'skuld', 'svalinn']);

/** « Stop » du propriétaire : tant que l'initiative est en pause, aucun automatisme des applis ne démarre. */
let pauseGlobale: () => boolean = () => false;
export function brancherPauseGlobale(f: () => boolean): void { pauseGlobale = f; }

export class Automatismes {
  private hote: HoteAutomatismes;
  private fichier: string;
  private etat: Etat;
  private ticks = new Map<string, () => Promise<void>>();
  private minuteries = new Map<string, Array<ReturnType<typeof setTimeout>>>();
  private horloge?: ReturnType<typeof setInterval>;
  private dus = new Map<string, number>();
  /** les passages en cours : début (heure d'Odin) et jeton (un passage déclaré bloqué ne libère plus la place) */
  private enCours = new Map<string, { debut: number; jeton: number }>();
  private jetons = 0;
  private passages = new Map<string, Passage[]>();
  constructor(hote: HoteAutomatismes) {
    this.hote = hote;
    this.fichier = join(hote.dir, 'automatismes.json');
    this.etat = this.lire();
    actif = this;
  }

  // ---------------- Rangement (seulement aux changements, et après le passage d'une tâche)
  private lire(): Etat {
    const vide: Etat = { pauses: {}, rythmes: {}, derniers: {}, journal: [] };
    try { if (!existsSync(this.fichier)) return vide; const e = JSON.parse(readFileSync(this.fichier, 'utf8')) as Partial<Etat>; return { pauses: e.pauses ?? {}, rythmes: e.rythmes ?? {}, derniers: e.derniers ?? {}, journal: Array.isArray(e.journal) ? e.journal.slice(-JOURNAL) : [] }; } catch { return vide; }
  }
  private ecrire(): void {
    try { const tmp = `${this.fichier}.tmp`; writeFileSync(tmp, JSON.stringify(this.etat, null, 1)); renameSync(tmp, this.fichier); } catch { /* disque plein : l'état reste en mémoire */ }
  }

  // ---------------- Minuteries
  private module(id: string): Module | undefined { return this.hote.modules().find((m) => m.id === id); }
  private classement(m: Module): Classement { return CLASSEMENT[m.id] ?? { genre: 'veille', nom: m.name, quoi: m.what }; }
  /** Le rythme choisi pour la surveillance d'une appli (seulement une tâche réglable). */
  private rythmeChoisi(m: Module): Rythme | undefined {
    const c = this.classement(m), r = this.etat.rythmes[`veille:${m.id}`];
    return r && c.genre === 'tache' && (c.permis ?? []).includes(r.genre) ? r : undefined;
  }
  /** Arme la surveillance d'une appli : `tick` est le passage (il lève une erreur s'il échoue). */
  armer(m: Module, tick: () => Promise<void>): void {
    if (!m.watch) return;
    this.ticks.set(m.id, tick);
    this.programmer(m);
    if (!this.horloge) { this.horloge = setInterval(() => void this.verifierDus().catch(() => undefined), PAS); (this.horloge as { unref?: () => void }).unref?.(); }
  }
  private programmer(m: Module): void {
    for (const t of this.minuteries.get(m.id) ?? []) { clearTimeout(t); clearInterval(t); }
    this.minuteries.delete(m.id); this.dus.delete(m.id);
    if (!m.watch || !this.ticks.has(m.id)) return;
    const r = this.rythmeChoisi(m);
    if (r) {
      // Rythme changé : c'est l'horloge du registre (30 s) qui lance le passage à son heure (un passage manqué est rattrapé une fois).
      const der = this.etat.derniers[`veille:${m.id}`], depuis = der ? new Date(der.at) : this.hote.now();
      this.dus.set(m.id, (prochaine(r, depuis) ?? new Date(this.hote.now().getTime() + 86_400_000)).getTime());
      return;
    }
    // Comme avant : premier passage entre 20 et 40 s, puis toutes les `every` secondes.
    const auto = () => { if (!pauseGlobale()) void this.passer(`veille:${m.id}`, false).catch(() => undefined); };
    this.minuteries.set(m.id, [setTimeout(auto, 20_000 + Math.random() * 20_000), setInterval(auto, m.watch.every * 1000)]);
  }
  arreter(): void {
    for (const l of this.minuteries.values()) for (const t of l) { clearTimeout(t); clearInterval(t); }
    this.minuteries.clear(); this.dus.clear();
    if (this.horloge) clearInterval(this.horloge);
    this.horloge = undefined;
  }
  /** Le tour de l'horloge (toutes les 30 s) : reprise des pauses échues, passages dus des rythmes changés. */
  async verifierDus(): Promise<void> {
    // Les coupures de liens échues ou abîmées se lèvent même pendant le « Stop » : le lien agit déjà de nouveau
    // (lienCoupe relit l'état au moment d'agir), son alerte ne doit pas rester affichée.
    for (const id of Object.keys(this.etat.pauses)) if (id.startsWith('lien:')) this.enPause(id);
    if (pauseGlobale()) return;
    for (const id of Object.keys(this.etat.pauses)) this.enPause(id);
    const now = this.hote.now().getTime();
    for (const [mid, quand] of [...this.dus]) {
      if (now < quand) continue;
      const m = this.module(mid), r = m && this.rythmeChoisi(m);
      this.dus.set(mid, ((r ? prochaine(r, new Date(now)) : undefined) ?? new Date(now + 86_400_000)).getTime());
      await this.passer(`veille:${mid}`, false).catch(() => undefined);
    }
  }

  /** Un passage automatique (celui des minuteries) : sauté en pause ou si le précédent n'est pas fini. */
  passageAuto(id: string): Promise<Passage | 'en_cours' | 'pause' | 'introuvable'> { return this.passer(id, false); }
  /**
   * Un passage : sauté s'il est en pause (sauf à la main) ou si le précédent n'est pas fini ; mesuré (durée, réussite) ;
   * gardé en mémoire (20 par ligne) ; noté sur le disque seulement pour une tâche.
   */
  private async passer(id: string, main: boolean): Promise<Passage | 'en_cours' | 'pause' | 'introuvable'> {
    if (!main && this.enPause(id)) return 'pause';
    // Une seule chose à la fois par appli : sa surveillance et ses tâches font souvent le même travail (vérification
    // des ISO, sauvegarde d'un plan). Un passage bloqué depuis trop longtemps est déclaré en échec et libère la place.
    const occupe = this.occupe(id);
    if (occupe) return 'en_cours';
    const fait = this.travail(id);
    if (!fait) return 'introuvable';
    const jeton = ++this.jetons, debut = this.hote.now().getTime();
    this.enCours.set(id, { debut, jeton });
    const t0 = Date.now(), at = new Date(debut).toISOString();
    let ok = true, texte = 'Passage réussi.';
    try { const r = await fait.run(); if (r) { ok = r.ok !== false; texte = r.text.split('\n')[0] || texte; } } catch (e) { ok = false; texte = (e as Error).message || 'échec'; }
    // Déclaré bloqué entre-temps : la place a déjà été libérée et le passage noté en échec.
    if (this.enCours.get(id)?.jeton !== jeton) return { at, ok: false, ms: Date.now() - t0, texte: 'Passage bloqué.' };
    this.enCours.delete(id);
    const p: Passage = { at, ok, ms: Date.now() - t0, texte: texte.slice(0, 300) };
    this.noterPassage(id, p, fait.tache);
    return p;
  }
  private noterPassage(id: string, p: Passage, tache: boolean): void {
    this.passages.set(id, [p, ...(this.passages.get(id) ?? [])].slice(0, GARDER));
    if (tache) { this.etat.derniers[id] = p; this.ecrire(); }
  }
  /** Le passage de la même appli encore en cours (s'il n'est pas bloqué), sinon undefined. */
  private occupe(id: string): string | undefined {
    const mid = id.split(':')[1], now = this.hote.now().getTime();
    for (const [k, e] of [...this.enCours]) {
      if (k.split(':')[1] !== mid) continue;
      if (now - e.debut > this.delaiBloque(k)) { this.bloquer(k, now - e.debut); continue; }
      return k;
    }
    return undefined;
  }
  /** Le temps au bout duquel un passage automatique est dit bloqué : 2 × son rythme (de 1 min à 30 min) ; 6 h pour un long travail. */
  private delaiBloque(id: string): number {
    const [genre, mid] = id.split(':'), m = this.module(mid);
    if (genre !== 'veille' || !m?.watch || LONGUES.has(m.id) || this.classement(m).genre === 'tache') return 6 * 3600_000;
    return Math.min(30 * 60_000, Math.max(60_000, 2 * m.watch.every * 1000));
  }
  /** Un passage qui ne rend pas la main : noté en échec, alerte posée, place libérée pour les passages suivants. */
  private bloquer(id: string, ms: number): void {
    const e = this.enCours.get(id); if (!e) return;
    this.enCours.delete(id);
    const min = Math.max(1, Math.round(ms / 60_000));
    this.noterPassage(id, { at: new Date(e.debut).toISOString(), ok: false, ms, texte: `Passage bloqué : pas de réponse depuis ${min} min.` }, false);
    const mid = id.split(':')[1], m = this.module(mid), l = this.ligne(id);
    this.hote.alert(mid, { level: l?.securite ? 'haute' : 'moyenne', title: `${m?.name ?? mid} : surveillance bloquée`, detail: `« ${l?.nom ?? id} » n'a pas répondu depuis ${min} min. Les passages suivants repartent ; regarde dans Talos si cela recommence.`, key: `bloque:${id}` });
  }
  /** Ce que fait une ligne du registre, et si c'est une tâche (son passage est alors noté sur le disque). */
  private travail(id: string): { run: () => Promise<ActionResult | void>; tache: boolean } | undefined {
    const [genre, mid, tid] = id.split(':');
    const m = mid ? this.module(mid) : undefined; if (!m) return undefined;
    if (genre === 'veille' && m.watch) {
      const tick = this.ticks.get(m.id) ?? (async () => { await m.watch!.run(this.hote.ctx(m.id)); });
      return { run: tick, tache: this.classement(m).genre === 'tache' };
    }
    if (genre === 'tache') {
      const t = this.tachesDe(m).find((x) => x.id === tid) as TacheInscrite | undefined; if (!t) return undefined;
      if (t.faire) { const f = t.faire; return { run: async () => { const r = await f(); if (r && r.ok === false) throw new Error(r.text); return r; }, tache: true }; }
      return { run: async () => { const r = await this.hote.act(m.id, t.lancer.action, t.lancer.input ?? {}); if (r.ok === false) throw new Error(r.text); return r; }, tache: true };
    }
    return undefined;
  }
  private tachesDe(m: Module): TacheAppli[] {
    let l: TacheAppli[] = []; try { l = m.taches?.(this.hote.ctx(m.id)) ?? []; } catch { /* rien */ }
    return [...l, ...(this.inscrites.get(m.id) ?? [])];
  }
  private inscrites = new Map<string, TacheInscrite[]>();
  /**
   * Inscrit une tâche faite hors des applis, rangée sous l'appli qui la montre (la sauvegarde chiffrée de la base d'Odin,
   * sous Alexandrie) : `faire` la lance ; la minuterie qui la fait lit `tacheEnPause(module, id)`.
   */
  inscrire(module: string, t: TacheInscrite): void { this.inscrites.set(module, [...(this.inscrites.get(module) ?? []).filter((x) => x.id !== t.id), t]); }

  // ---------------- Pauses
  /** La ligne est-elle en pause ? Une pause échue est levée ici (reprise automatique). */
  enPause(id: string): boolean {
    if (id.startsWith('lien:')) return this.lienCoupe(id.slice(5));
    const p = this.etat.pauses[id]; if (!p) return false;
    if (p.jusqua && Date.parse(p.jusqua) <= this.hote.now().getTime()) { this.reprendre(id); return false; }
    return true;
  }
  /** Lève la pause (et marque vue l'alerte qu'elle avait posée). */
  private reprendre(id: string): void {
    const p = this.etat.pauses[id]; if (!p) return;
    delete this.etat.pauses[id]; this.ecrire();
    if (p.alerte) { try { this.hote.ack?.([p.alerte]); } catch { /* rien */ } }
  }

  // ---------------- Liens écrits coupés (pauses `lien:<id>`)
  /**
   * La coupure du lien, si elle est en règle : une pause marquée `lien`, une date de début lisible, et soit une fin
   * lisible (24 h au plus pour un lien qui protège), soit aucune fin pour un lien qui ne protège pas. Tout le reste
   * (état abîmé, illisible, inconnu) ne coupe RIEN. Une coupure échue est levée ici (rétablie toute seule, journalisée).
   */
  etatLien(idLien: string): EtatLien | undefined {
    const k = `lien:${idLien}`, p = this.etat.pauses[k] as PauseEtat | undefined;
    if (p === undefined) return undefined;
    const e = this.coupureEnRegle(p);
    if (!e) {
      // Abîmée : elle ne coupe rien, donc Odin ne la montre plus comme coupée (entrée retirée, alerte vue, geste noté).
      delete this.etat.pauses[k];
      const a = p && typeof p === 'object' ? (p as PauseEtat).alerte : undefined;
      if (typeof a === 'string') { try { this.hote.ack?.([a]); } catch { /* rien */ } }
      this.noterGeste({ lien: idLien, geste: 'rétabli', par: 'Odin, coupure illisible' });
      return undefined;
    }
    if (e.jusqua && Date.parse(e.jusqua) <= this.hote.now().getTime()) { this.reprendre(k); this.noterGeste({ lien: idLien, geste: 'rétabli', par: 'Odin, à la fin de la durée choisie' }); return undefined; }
    return e;
  }
  /** La coupure lue si elle est en règle, sinon undefined (abîmée). */
  private coupureEnRegle(p: PauseEtat): EtatLien | undefined {
    if (!p || typeof p !== 'object' || p.lien !== true || typeof p.protege !== 'boolean' || typeof p.depuis !== 'string') return undefined;
    const depuis = Date.parse(p.depuis); if (!Number.isFinite(depuis)) return undefined;
    if (p.jusqua === undefined) return p.protege ? undefined : { depuis: p.depuis };
    if (typeof p.jusqua !== 'string') return undefined;
    const j = Date.parse(p.jusqua); if (!Number.isFinite(j)) return undefined;
    if (p.protege && j - depuis > MAX_PAUSE_SECU + 60_000) return undefined;
    return { depuis: p.depuis, jusqua: p.jusqua };
  }
  lienCoupe(idLien: string): boolean { return this.etatLien(idLien) !== undefined; }
  journalLiens(): GesteLien[] { return Array.isArray(this.etat.journal) ? [...this.etat.journal] : []; }
  private noterGeste(g: Omit<GesteLien, 'at'>): void {
    if (!Array.isArray(this.etat.journal)) this.etat.journal = [];
    this.etat.journal = [...this.etat.journal, { at: this.hote.now().toISOString(), ...g }].slice(-JOURNAL);
    this.ecrire();
  }
  private coupures = 0;
  /** La branche `lien:` de la pause : seulement par `couperLien` (la route de la page). */
  private pauseLien(id: string, couper: boolean, o: { jusqua?: string; confirme?: boolean; [PAR_LA_PAGE]?: LienACouper }): Reponse<{ lien: string; coupe?: EtatLien }> {
    const l = o[PAR_LA_PAGE];
    if (!l || `lien:${l.id}` !== id || !/^[a-z0-9]+(-[a-z0-9]+)+$/.test(l.id)) return { ok: false, code: 'interdit', error: 'Un lien entre applis ne se coupe et ne se rétablit que depuis la page des automatisations, par toi.' };
    const idLien = l.id;
    if (!couper) {
      if (this.etat.pauses[id]) { this.reprendre(id); this.noterGeste({ lien: idLien, geste: 'rétabli', par: l.qui }); }
      return { ok: true, lien: idLien };
    }
    const now = this.hote.now().getTime();
    let jusqua: number | undefined;
    if (l.protege) {
      // Un lien qui protège se rétablit tout seul : 1 h par défaut, 24 h au plus (renouvelable par un nouveau geste).
      const voulu = o.jusqua ? Date.parse(o.jusqua) : now + 3600_000;
      if (!Number.isFinite(voulu) || voulu <= now) return { ok: false, code: 'invalide', error: 'La fin de la coupure doit être dans le futur.' };
      jusqua = Math.min(voulu, now + MAX_PAUSE_SECU);
    }
    // « jusqu'à 11 h 00 » aujourd'hui, « jusqu'à demain à 11 h 00 » sinon (pas « jusqu'à à »).
    const fin = jusqua ? texteDate(new Date(jusqua), undefined, new Date(now)).replace(/^aujourd'hui à /, '') : undefined;
    const aussi = `${l.aussi?.length ? ` Le même interrupteur coupe aussi : ${l.aussi.map((x) => `« ${x} »`).join(', ')}.` : ''}${l.note ? ` ${l.note}` : ''}`;
    if (o.confirme !== true) {
      return { ok: false, code: 'accord', error: 'Confirme la coupure de ce lien.', confirm: l.protege
        ? `Couper « ${l.nom} » jusqu'à ${fin} ? Ce lien protège : ${l.protege.raison}. Cela ne sera plus fait jusqu'à ${fin} ; il se rétablira tout seul, et une alerte restera visible en attendant.${aussi}`
        : `Couper « ${l.nom} » ? Il restera coupé jusqu'à ce que tu le rétablisses.${aussi}` };
    }
    // Recouper un lien déjà coupé (renouveler) : l'alerte d'avant est marquée vue, la nouvelle la remplace.
    const avant = this.etat.pauses[id];
    if (avant?.alerte) { try { this.hote.ack?.([avant.alerte]); } catch { /* rien */ } }
    // Chaque coupure a sa propre clé d'alerte : couper, rétablir puis recouper lève bien une nouvelle alerte.
    const alerte = this.hote.alert(l.de, {
      level: l.protege ? 'haute' : 'moyenne',
      title: l.protege ? `Lien coupé jusqu'à ${fin} : ${l.nom}` : `Lien coupé : ${l.nom}`,
      detail: l.protege
        ? `Ce lien protège : ${l.protege.raison}. Il ne le fait plus jusqu'à ${fin}, puis se rétablit tout seul. Pour le rétablir avant : Talos, « Liens entre applis ».${aussi}`
        : `Coupé depuis Talos ; il reste coupé jusqu'à ce que tu le rétablisses (Talos, « Liens entre applis »).${aussi}`,
      key: `coupure:${id}:${now}:${++this.coupures}`,
    });
    const idAlerte = (alerte as { id?: unknown } | undefined)?.id;
    this.etat.pauses[id] = { depuis: new Date(now).toISOString(), ...(jusqua ? { jusqua: new Date(jusqua).toISOString() } : {}), ...(typeof idAlerte === 'string' ? { alerte: idAlerte } : {}), lien: true, protege: Boolean(l.protege) };
    this.noterGeste({ lien: idLien, geste: 'coupé', par: l.qui, ...(jusqua ? { jusqua: new Date(jusqua).toISOString() } : {}) });
    return { ok: true, lien: idLien, ...(this.etatLien(idLien) ? { coupe: this.etatLien(idLien) } : {}) };
  }

  // ---------------- Les lignes
  lignes(): Ligne[] {
    const out: Ligne[] = [], now = this.hote.now();
    for (const m of this.hote.modules()) {
      if (m.watch) out.push(this.ligneVeille(m, now));
      for (const t of this.tachesDe(m)) out.push(this.ligneTache(m, t, now));
    }
    return out;
  }
  ligne(id: string): Ligne | undefined {
    const [genre, mid, tid] = id.split(':'), m = mid ? this.module(mid) : undefined, now = this.hote.now();
    if (!m) return undefined;
    if (genre === 'veille' && m.watch) return this.ligneVeille(m, now);
    if (genre === 'tache') { const t = this.tachesDe(m).find((x) => x.id === tid); if (t) return this.ligneTache(m, t, now); }
    return undefined;
  }
  private etatDe(id: string, d?: Passage): Ligne['etat'] { return this.enCours.has(id) ? 'en_cours' : this.enPause(id) ? 'pause' : d && !d.ok ? 'erreur' : 'actif'; }
  private quand(d: Date | undefined, now: Date): { prochaine?: string; prochaineTexte?: string } { return d ? { prochaine: d.toISOString(), prochaineTexte: texteDate(d, undefined, now) } : {}; }
  private ligneVeille(m: Module, now: Date): Ligne {
    const id = `veille:${m.id}`, c = this.classement(m), choisi = this.rythmeChoisi(m);
    const r: Rythme = choisi ?? { genre: 'secondes', n: m.watch!.every };
    const der = this.passages.get(id)?.[0] ?? this.etat.derniers[id];
    const reglable = c.genre === 'tache' ? [...(c.permis ?? [])] : [];
    let suivante: Date | undefined;
    if (choisi) suivante = this.dus.has(m.id) ? new Date(this.dus.get(m.id)!) : prochaine(choisi, now);
    else if (der && m.watch!.every >= 300) suivante = new Date(Math.max(now.getTime(), Date.parse(der.at) + m.watch!.every * 1000));
    const pause = this.etat.pauses[id];
    return {
      id, sorte: c.genre, appli: m.id, applis: [m.id], nom: c.nom, quoi: c.quoi, rythme: r, phrase: phrase(r), reglable,
      ...(this.enPause(id) ? {} : this.quand(suivante, now)), ...(der ? { derniere: der } : {}), etat: this.etatDe(id, der),
      ...(pause?.jusqua && this.enPause(id) ? { pauseJusqua: pause.jusqua } : {}), ...(c.securite ? { securite: true } : {}),
      lien: { vue: 'app', appli: m.id },
      peut: { lancer: true, pause: true, rythme: reglable.length > 0, decaler: false, supprimer: false },
    };
  }
  private ligneTache(m: Module, t: TacheAppli, now: Date): Ligne {
    const id = `tache:${m.id}:${t.id}`, ctx = this.hote.ctx(m.id);
    let r: Rythme; try { r = t.rythme(ctx) as Rythme; } catch { r = { genre: 'libre', texte: 'rythme inconnu' }; }
    const a = this.passages.get(id)?.[0] ?? this.etat.derniers[id];
    let b: Passage | undefined; try { const x = t.dernier?.(ctx); if (x?.at) b = { at: x.at, ok: x.ok !== false, ...(x.texte ? { texte: x.texte } : {}) }; } catch { /* rien */ }
    const der = a && b ? (Date.parse(a.at) >= Date.parse(b.at) ? a : b) : a ?? b;
    let suivante: Date | undefined; try { suivante = t.prochain?.(ctx, now) ?? prochaine(r, now); } catch { suivante = undefined; }
    const reglable = t.regler ? [...(t.permis ?? [])] : [];
    const pause = this.etat.pauses[id];
    return {
      id, sorte: 'tache', appli: m.id, applis: [m.id], nom: t.nom, quoi: t.quoi, rythme: r, phrase: phrase(r), reglable,
      ...(this.enPause(id) ? {} : this.quand(suivante, now)), ...(der ? { derniere: der } : {}), etat: this.etatDe(id, der),
      ...(pause?.jusqua && this.enPause(id) ? { pauseJusqua: pause.jusqua } : {}), ...(t.securite ? { securite: true } : {}),
      lien: { vue: 'app', appli: m.id },
      peut: { lancer: true, pause: true, rythme: reglable.length > 0, decaler: false, supprimer: false },
    };
  }

  // ---------------- Ce qu'on fait depuis Talos
  async lancer(id: string): Promise<Reponse<{ resultat: { ok: boolean; ms: number; texte: string; at: string } }>> {
    if (!this.ligne(id)) return { ok: false, code: 'introuvable', error: 'Automatisme introuvable.' };
    const p = await this.passer(id, true);
    if (p === 'en_cours') return { ok: false, code: 'en_cours', error: 'Un passage est déjà en cours : attends qu\'il finisse.' };
    if (p === 'introuvable' || p === 'pause') return { ok: false, code: 'introuvable', error: 'Automatisme introuvable.' };
    return { ok: true, resultat: { ok: p.ok, ms: p.ms ?? 0, texte: p.texte ?? '', at: p.at } };
  }
  pause(id: string, pause: boolean, o: { jusqua?: string; confirme?: boolean; [PAR_LA_PAGE]?: LienACouper } = {}): Reponse<{ ligne: Ligne }> | Reponse<{ lien: string; coupe?: EtatLien }> {
    if (id.startsWith('lien:')) return this.pauseLien(id, pause, o);
    const l = this.ligne(id); if (!l) return { ok: false, code: 'introuvable', error: 'Automatisme introuvable.' };
    if (!pause) { this.reprendre(id); return { ok: true, ligne: this.ligne(id)! }; }
    const now = this.hote.now().getTime();
    let jusqua = o.jusqua ? Date.parse(o.jusqua) : undefined;
    if (o.jusqua && (!Number.isFinite(jusqua) || jusqua! <= now)) return { ok: false, code: 'invalide', error: 'La fin de la pause doit être dans le futur.' };
    if (l.securite) {
      jusqua = Math.min(jusqua ?? now + 3600_000, now + MAX_PAUSE_SECU);
      const fin = texteDate(new Date(jusqua), undefined, new Date(now));
      if (!o.confirme) return { ok: false, code: 'accord', confirm: `Mettre en pause « ${l.nom} » laisse la maison sans cette surveillance de sécurité jusqu'à ${fin.replace(/^aujourd'hui /, '')}. Confirme.`, error: 'Cette surveillance protège la maison : confirme la pause.' };
    }
    // Toute pause laisse une alerte visible (marquée vue à la reprise) : haute pour la sécurité et les sauvegardes.
    let alerte: unknown;
    if (l.appli) {
      const m = this.module(l.appli), nom = m?.name ?? l.appli;
      const fin = jusqua ? texteDate(new Date(jusqua), undefined, new Date(now)).replace(/^aujourd'hui /, '') : undefined;
      const haute = l.securite || PROTEGENT.has(l.appli);
      alerte = this.hote.alert(l.appli, {
        level: haute ? 'haute' : 'moyenne',
        title: fin ? `${nom} : surveillance en pause jusqu'à ${fin}` : `${nom} : « ${l.nom} » en pause sans date de fin`,
        detail: fin ? `« ${l.nom} » a été mise en pause depuis Talos. Elle reprend toute seule à la fin de la pause.` : `« ${l.nom} » a été mise en pause depuis Talos et ne reprendra pas toute seule : reprends-la dans Talos.`,
        key: `pause:${id}:${jusqua ?? now}`,
      });
    }
    const idAlerte = (alerte as { id?: unknown } | undefined)?.id;
    this.etat.pauses[id] = { depuis: new Date(now).toISOString(), ...(jusqua ? { jusqua: new Date(jusqua).toISOString() } : {}), ...(typeof idAlerte === 'string' ? { alerte: idAlerte } : {}) };
    this.ecrire();
    return { ok: true, ligne: this.ligne(id)! };
  }
  rythme(id: string, x: unknown): Reponse<{ ligne: Ligne }> {
    const l = this.ligne(id); if (!l) return { ok: false, code: 'introuvable', error: 'Automatisme introuvable.' };
    const v = verifierRythme(x); if (!v.ok) return { ok: false, code: 'invalide', error: v.error };
    if (!l.reglable.includes(v.rythme.genre)) return { ok: false, code: 'invalide', error: l.reglable.length ? `Ce rythme ne convient pas ici : choisis ${l.reglable.map((g) => NOMS_GENRE[g]).join(', ')}.` : 'Ce rythme ne se règle pas.' };
    const [genre, mid, tid] = id.split(':'), m = this.module(mid)!;
    if (genre === 'veille') { this.etat.rythmes[id] = v.rythme; this.ecrire(); this.programmer(m); return { ok: true, ligne: this.ligne(id)! }; }
    const t = this.tachesDe(m).find((y) => y.id === tid);
    try { t!.regler!(this.hote.ctx(m.id), v.rythme); } catch (e) { return { ok: false, code: 'invalide', error: (e as Error).message }; }
    return { ok: true, ligne: this.ligne(id)! };
  }
  historique(id: string): Passage[] {
    const l = this.passages.get(id) ?? [];
    if (l.length) return l.slice(0, GARDER);
    const d = this.etat.derniers[id] ?? this.ligne(id)?.derniere;
    return d ? [d] : [];
  }
}
const NOMS_GENRE: Record<GenreRythme, string> = { minutes: 'toutes les N minutes', heures: 'toutes les N heures', jour: 'tous les jours', semaine: 'chaque semaine', mois: 'chaque mois', une_fois: 'une seule fois', cron: 'un planning expert', secondes: 'en continu', libre: 'libre' };
