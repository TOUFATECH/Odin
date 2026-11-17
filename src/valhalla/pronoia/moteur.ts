// Prónoia — le moteur : prévoir et pressentir, sans jamais agir. Il rassemble le magasin (chiffré, borné), le modèle des
// demandes (lot 2), les préparations en lecture seule (lot 2) et les prévisions d'événements (lot 3).
//
// Garanties tenues ici (et prouvées par les essais) :
//   - PROPOSER seulement : le moteur ne reçoit AUCUN moyen d'agir, d'envoyer, d'acheter ni de notifier ; il rend des
//     propositions « discrètes », `agit: false`, que la surface montre ou non ;
//   - interrupteur coupé = plus aucune anticipation (rien n'est appris, prévu, préparé, ni proposé) ;
//   - mode privé ou « ne pas garder » : rien n'est appris ni gardé de cet échange ;
//   - jamais un tiers : un événement qui porte sur une autre personne est refusé, jamais appris ;
//   - l'écart entre prévu et arrivé nourrit Noûs (erreur de prédiction), par la fonction `nourrir` injectée ;
//   - mémoire et temps bornés ; tout s'arrête dès qu'Odin doit répondre (`abandonner`).
import { join } from 'node:path';
import { Magasin, nouvelId } from './magasin.ts';
import { ModeleDemandes, SEANCE_MS, type Candidat } from './demande.ts';
import { Preparations, type IssuePreparation } from './preparation.ts';
import { cleEvenement, estPrevisionMeteo, meteo, rythmes, tendances, type Estimation } from './evenements.ts';
import { bilan, type Bilan } from './bilan.ts';
import { borner, estPressentiment, formuler, pourcent } from './honnete.ts';
import type { EvenementDate, Nourrir, OptionsEchange, Preparer, Prevision, Proposition, Reglages, Sorte, SuiteTexte } from './types.ts';

const HEURE = 3_600_000;
/** Les planchers des seuils réglables. */
export const PLANCHER_PRESSENTIMENT = 0.3, PLANCHER_PREVENIR = 0.5;
/** Un événement peut arriver un peu « en avance » (horloges des applis) : au-delà, il est refusé. */
const TOLERANCE_FUTUR_MS = 2 * 60_000;
const plat = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Les types (et clés) qui concernent une personne : jamais acceptés sans le sujet « propriétaire » explicite. */
const PERSONNE = /person|visage|face|voix|voice|locuteur|presence|present|humain|human|individu|silhouette|pieton|habitant|visiteur|invite|occupant|quelqu/;
/**
 * Ce que Prónoia apprend PAR DÉFAUT des événements des applis : la maison et les machines seulement (mesures de la
 * machine, santé des disques, sauvegardes, pannes, météo). Tout le reste (caméras, VPN, connexions, nouveaux appareils,
 * réservations, recherches, ordres à la voix, arrivées…) est ignoré avant même d'entrer : ces événements « neutres »
 * diraient quand une personne arrive. Ouvrir un couple de plus est une action grave du propriétaire.
 */
export const SOURCES_DEFAUT: readonly string[] = [
  'eir/mesure', 'durinn/etat_disque', 'sindri/sauvegarde_ok', 'sindri/sauvegarde_echec', 'vordr/panne', 'vordr/retour', 'vordr/probleme',
  'zeus/releve', 'zeus/bilan', 'zeus/source_en_panne', 'naglfar/conteneur_arrete', 'ymir/vm_arretee', 'bru/tunnel_arrete', 'valgrind/certificat_renouvele',
];
/** Un couple « appli/type » propre (minuscules, lettres, chiffres, _ et -). */
export const coupleSource = (x: unknown): string | undefined => { const m = /^\s*([a-z0-9_-]{1,40})\s*\/\s*([a-z0-9_-]{1,60})\s*$/.exec(String(x ?? '').toLowerCase()); return m ? `${m[1]}/${m[2]}` : undefined; };
export const concernePersonne = (ev: Pick<EvenementDate, 'type' | 'cle'>): boolean => PERSONNE.test(plat(`${ev.type} ${ev.cle ?? ''}`));

export interface DepsPronoia {
  /** le dossier d'Odin (clé de la machine pour chiffrer) */
  home: string;
  /** le dossier de Prónoia (défaut : <home>/valhalla/pronoia) */
  dir?: string;
  maintenant?: () => number;
  /** lecture seule : recherche, rappel (voir types.ts) */
  preparer?: Preparer;
  /** l'entrée de Noûs, déjà liée à ses dépendances (elle respecte elle-même le mode privé) */
  nourrir?: Nourrir;
  /** la suite d'un texte par Noûs, quand il est disponible */
  suiteNous?: SuiteTexte;
  /** le mode privé global d'Odin */
  prive?: () => boolean;
  preparation?: { ttlMs?: number; max?: number; budgetMs?: number };
  /** au-dessous de cette confiance, on ne prépare pas d'avance (on ne gaspille pas) */
  seuilPreparer?: number;
}

export class Pronoia {
  readonly magasin: Magasin;
  private d: DepsPronoia;
  private now: () => number;
  private modele: ModeleDemandes;
  private prep?: Preparations;
  private suiteEnCours?: AbortController;
  /** combien d'événements sur un tiers ont été refusés (jamais appris) */
  refusesTiers = 0;
  /** combien d'événements d'une rafale ont été laissés (file pleine) */
  evenementsLaisses = 0;

  /** Prónoia apprend-elle de ce couple (appli, type) ? La liste blanche par défaut, plus ce que le propriétaire a ouvert. */
  sourcePermise(appli: string, type: string): boolean {
    const c = `${appli}/${type}`.toLowerCase();
    return SOURCES_DEFAUT.includes(c) || this.magasin.etat.reglages.sourcesOuvertes.includes(c);
  }
  /** Les sources apprises : celles par défaut et celles ouvertes par le propriétaire. */
  sources(): Array<{ source: string; ouverte: boolean }> {
    return [...SOURCES_DEFAUT.map((source) => ({ source, ouverte: false })), ...this.magasin.etat.reglages.sourcesOuvertes.filter((x) => !SOURCES_DEFAUT.includes(x)).map((source) => ({ source, ouverte: true }))];
  }
  /** Ouvre un couple « appli/type » (grave, décidé par le propriétaire). */
  ouvrirSource(x: string): string {
    const c = coupleSource(x); if (!c) throw new Error('source à écrire « appli/type » (ex. appareils/etat)');
    const r = this.magasin.etat.reglages;
    if (!SOURCES_DEFAUT.includes(c) && !r.sourcesOuvertes.includes(c)) r.sourcesOuvertes = [...r.sourcesOuvertes, c].slice(-100);
    this.magasin.sauver(); return c;
  }
  /** Referme un couple ouvert (un clic : c'est une protection). Les couples par défaut restent. */
  fermerSource(x: string): boolean {
    const c = coupleSource(x); if (!c) return false;
    const r = this.magasin.etat.reglages, avant = r.sourcesOuvertes.length;
    r.sourcesOuvertes = r.sourcesOuvertes.filter((y) => y !== c); this.magasin.sauver(); return r.sourcesOuvertes.length !== avant;
  }

  constructor(d: DepsPronoia) {
    this.d = d;
    this.now = d.maintenant ?? Date.now;
    this.magasin = new Magasin(d.home, d.dir ?? join(d.home, 'valhalla', 'pronoia'));
    this.modele = new ModeleDemandes(this.magasin.etat.demandes, this.now());
    this.creerPreparations();
  }
  /** Les préparations partagent les mesures du magasin (à refaire si l'état est remplacé). */
  private creerPreparations(): void {
    this.prep = this.d.preparer ? new Preparations({ preparer: this.d.preparer, maintenant: this.now, mesures: this.magasin.etat.mesures, ...this.d.preparation }) : undefined;
  }

  get reglages(): Reglages { return { ...this.magasin.etat.reglages }; }
  get actif(): boolean { return this.magasin.etat.reglages.actif; }
  private enPrive(o?: OptionsEchange): boolean {
    if (o?.prive || o?.nePasGarder) return true;
    try { return this.d.prive?.() === true; } catch { return true; }
  }
  /** Le moteur travaille-t-il pour cet échange ? (allumé et pas privé) */
  private travaille(o?: OptionsEchange): boolean { return this.actif && !this.enPrive(o); }

  // ------------------------------------------------------------------ Interrupteur et réglages
  /** Coupe toute anticipation : préparations arrêtées, cache vidé, prévisions en attente périmées (plus suivies). */
  couper(): void {
    this.abandonner(); this.prep?.vider();
    const n = this.now();
    for (const p of this.magasin.etat.previsions) if (p.etat === 'en_attente') { p.etat = 'perimee'; p.resolue = n; this.magasin.poserPrevision(p); }
    this.magasin.etat.reglages.actif = false; this.magasin.sauver();
  }
  allumer(): void { this.magasin.etat.reglages.actif = true; this.magasin.sauver(); }
  regler(r: Partial<Omit<Reglages, 'actif'>>): Reglages {
    const g = this.magasin.etat.reglages;
    // Planchers : une prévision à 1 % ne cesse jamais d'être un pressentiment, ni ne devient « à prévenir ».
    if (typeof r.seuilPressentiment === 'number') g.seuilPressentiment = Math.max(PLANCHER_PRESSENTIMENT, borner(r.seuilPressentiment));
    if (typeof r.seuilPrevenir === 'number') g.seuilPrevenir = Math.max(PLANCHER_PREVENIR, borner(r.seuilPrevenir), g.seuilPressentiment);
    g.seuilPrevenir = Math.max(g.seuilPrevenir, g.seuilPressentiment);
    if (typeof r.gardeJours === 'number' && r.gardeJours >= 1) g.gardeJours = Math.min(3650, Math.floor(r.gardeJours));
    this.magasin.sauver();
    return this.reglages;
  }

  // ------------------------------------------------------------------ Propositions
  private proposer(p: Prevision): Proposition {
    return { prevision: { ...p, sources: p.sources.map((s) => ({ ...s })) }, texte: formuler(p, this.magasin.etat.reglages, this.now()), niveau: 'discret', agit: false };
  }
  private nouvelle(sorte: Sorte, e: Omit<Estimation, 'sorte'>): Prevision {
    return { ...e, sorte, id: nouvelId(), cree: this.now(), etat: 'en_attente', confiance: borner(e.confiance) };
  }
  /** Pose une prévision sauf si une même (sorte, clé) attend déjà ; rend celle qui fait foi. */
  private poser(p: Prevision): Prevision {
    const deja = this.magasin.etat.previsions.find((x) => x.etat === 'en_attente' && x.sorte === p.sorte && x.cle === p.cle && (x.attendu === undefined || p.attendu === undefined || Math.abs(x.attendu - p.attendu) < 6 * HEURE));
    if (deja) return deja;
    this.magasin.poserPrevision(p);
    return p;
  }

  /** Juge une prévision et transmet l'écart prévu/arrivé à Noûs (erreur de prédiction). */
  private juger(p: Prevision, etat: 'realisee' | 'ratee' | 'perimee', arrive?: { texte: string; at: number }): void {
    p.etat = etat; p.resolue = this.now();
    if (etat === 'realisee' && arrive && typeof p.attendu === 'number') p.ecartMin = Math.round((arrive.at - p.attendu) / 60_000);
    this.magasin.poserPrevision(p);
    if (etat === 'perimee' || !this.d.nourrir) return;
    const prevu = `${p.quoi} (confiance ${pourcent(p.confiance)} %)`;
    const texte = etat === 'realisee'
      ? `Prévision réalisée — prévu : ${prevu} ; arrivé : ${arrive?.texte ?? p.quoi}${p.ecartMin !== undefined ? ` (écart ${p.ecartMin >= 0 ? '+' : ''}${p.ecartMin} min)` : ''}.`
      : `Prévision ratée — prévu : ${prevu} ; arrivé : ${arrive ? arrive.texte : 'rien dans la fenêtre attendue'}.`;
    try { this.d.nourrir({ sorte: 'note', texte, source: `pronoia:${p.sorte}`, fiable: true }); } catch { /* Noûs ne gêne jamais */ }
  }

  /** Juge les prévisions dont l'échéance est passée : un événement vérifiable non venu = raté ; sinon périmée. */
  cloturer(): Prevision[] {
    const n = this.now(), jugees: Prevision[] = [];
    for (const p of this.magasin.etat.previsions) {
      if (p.etat !== 'en_attente' || p.echeance >= n) continue;
      // demande/suite : une prévision conditionnelle (« si tu demandes quelque chose, ce sera… ») : sans demande, on ne
      // peut pas la juger — elle est périmée, pas ratée.
      this.juger(p, p.sorte === 'evenement' && p.verifiable ? 'ratee' : 'perimee');
      jugees.push(p);
    }
    if (jugees.length) this.magasin.sauver();
    return jugees;
  }

  // ------------------------------------------------------------------ Lot 2 : les demandes
  /**
   * Une vraie demande arrive. Si sa réponse a été préparée d'avance, elle est rendue (avec le temps gagné mesuré) ; les
   * prévisions de demande en attente sont jugées ; puis la demande est apprise. En privé : rien de tout ça.
   */
  noterDemande(texte: string, o?: OptionsEchange): { servie?: { texte: string; gagneMs: number; prepareeMs: number }; jugees: Prevision[] } {
    this.abandonner(); // Odin doit répondre (privé ou non) : les préparations en cours s'arrêtent
    if (!this.travaille(o)) return { jugees: [] };
    const n = this.now();
    const g = this.modele.groupeDe(texte);
    const servie = this.prep?.servir(g?.cle, texte);
    const jugees: Prevision[] = [];
    for (const p of this.magasin.etat.previsions) {
      if (p.etat !== 'en_attente' || (p.sorte !== 'demande' && p.sorte !== 'suite')) continue;
      if (p.echeance < n) { this.juger(p, 'perimee'); continue; }
      this.juger(p, g && g.cle === p.cle ? 'realisee' : 'ratee', { texte, at: n });
      jugees.push(p);
    }
    this.magasin.ajouterDemande({ at: n, texte: texte.trim().slice(0, 240) });
    this.modele.apprendre({ at: n, texte });
    if (o?.differer) this.magasin.planifierSauvegarde(); else this.magasin.sauver();
    return { servie, jugees };
  }

  private candidatsEnPropositions(sorte: Sorte, l: Candidat[], garderPremiere: boolean): Proposition[] {
    const n = this.now();
    return l.map((c, i) => {
      const p = this.nouvelle(sorte, { quoi: `demander « ${c.texte} »`, cle: c.cle, echeance: n + SEANCE_MS, confiance: c.confiance, sources: c.sources, verifiable: true });
      // Seule la première est suivie et jugée (le bilan mesure donc le « premier choix », sans tricher sur les suivants).
      return this.proposer(garderPremiere && i === 0 ? this.poser(p) : p);
    });
  }

  /**
   * Devine les prochaines demandes probables maintenant (heure, jour, enchaînement) et prépare d'avance, en lecture
   * seule, les réponses assez probables. Rend les propositions tout de suite ; `preparees` se résout quand les
   * préparations ont fini (ou ont été abandonnées).
   */
  anticiper(k = 3, o?: OptionsEchange): { propositions: Proposition[]; preparees: Promise<IssuePreparation[]> } {
    if (!this.travaille(o)) return { propositions: [], preparees: Promise.resolve([]) };
    const props = this.candidatsEnPropositions('demande', this.modele.prochaines(this.now(), k), true);
    this.magasin.sauver();
    return { propositions: props, preparees: this.lancerPreparations(props) };
  }

  /** Les questions qui suivront probablement cet échange (enchaînements), tenues prêtes. */
  questionsSuivantes(texte: string, k = 3, o?: OptionsEchange): { propositions: Proposition[]; preparees: Promise<IssuePreparation[]> } {
    if (!this.travaille(o)) return { propositions: [], preparees: Promise.resolve([]) };
    const props = this.candidatsEnPropositions('suite', this.modele.questionsSuivantes(texte, this.now(), k), true);
    this.magasin.sauver();
    return { propositions: props, preparees: this.lancerPreparations(props) };
  }

  private lancerPreparations(props: Proposition[]): Promise<IssuePreparation[]> {
    if (!this.prep) return Promise.resolve([]);
    const seuil = this.d.seuilPreparer ?? 0.3;
    const choisies = props.filter((p) => p.prevision.confiance >= seuil).slice(0, 2);
    return Promise.all(choisies.map((p) => this.prep!.preparer(p.prevision.cle, (p.prevision.quoi.match(/« (.*) »/)?.[1]) ?? p.prevision.quoi)));
  }

  /**
   * Complétion pendant la frappe : les demandes connues qui commencent par ce qui est tapé ; à défaut, la suite proposée
   * par Noûs s'il est branché (dite « pressentiment » faute de confiance mesurée). Rien n'est gardé (la frappe n'est
   * pas une demande). S'arrête dès qu'Odin doit répondre.
   */
  async completer(prefixe: string, k = 3, o?: OptionsEchange): Promise<Proposition[]> {
    if (!this.travaille(o)) return [];
    const n = this.now();
    const l = this.modele.completer(prefixe, n, k);
    if (l.length || !this.d.suiteNous) return l.map((c) => this.proposer(this.nouvelle('demande', { quoi: `demander « ${c.texte} »`, cle: c.cle, echeance: n + SEANCE_MS, confiance: c.confiance, sources: c.sources, verifiable: false })));
    this.suiteEnCours?.abort();
    const ctrl = new AbortController(); this.suiteEnCours = ctrl;
    const minuterie = setTimeout(() => ctrl.abort(), 1500); minuterie.unref?.();
    try {
      const r = await Promise.race([
        this.d.suiteNous(prefixe, { signal: ctrl.signal }),
        new Promise<undefined>((res) => ctrl.signal.addEventListener('abort', () => res(undefined), { once: true })),
      ]);
      if (!r || ctrl.signal.aborted || !r.suite.trim()) return [];
      const conf = typeof r.confiance === 'number' ? Math.min(borner(r.confiance), this.magasin.etat.reglages.seuilPressentiment - 0.01) : 0;
      const texte = `${prefixe}${r.suite}`.trim();
      return [this.proposer(this.nouvelle('demande', { quoi: `demander « ${texte} »`, cle: '', echeance: n + SEANCE_MS, confiance: conf, sources: [{ type: 'nous', detail: typeof r.confiance === 'number' ? 'suite de texte proposée par Noûs' : 'suite de texte proposée par Noûs (confiance non mesurée)' }], verifiable: false }))];
    } catch { return []; } finally { clearTimeout(minuterie); if (this.suiteEnCours === ctrl) this.suiteEnCours = undefined; }
  }

  /** Odin doit répondre : toute anticipation en cours s'arrête tout de suite. Rend le nombre de tâches arrêtées. */
  abandonner(): number {
    let n = this.prep?.abandonner() ?? 0;
    if (this.suiteEnCours) { this.suiteEnCours.abort(); this.suiteEnCours = undefined; n++; }
    return n;
  }

  // ------------------------------------------------------------------ Lot 3 : les événements
  /**
   * Un événement daté d'une appli arrive. Refusé s'il porte sur un tiers (jamais appris). Il juge les prévisions qui
   * l'attendaient (réalisée + écart mesuré → Noûs), puis il est retenu pour apprendre les rythmes.
   */
  recevoirEvenement(ev: EvenementDate, o?: OptionsEchange): { accepte: boolean; jugees: Prevision[] } {
    if (!ev || typeof ev !== 'object' || typeof ev.at !== 'number' || !Number.isFinite(ev.at) || !ev.appli || !ev.type) return { accepte: false, jugees: [] };
    // Vie privée, par liste blanche : seuls la maison (défaut) et le propriétaire lui-même ; et un événement qui
    // concerne une PERSONNE (personne, visage, voix, présence…) n'est accepté que s'il est dit « propriétaire ».
    const sujet = ev.sujet ?? 'maison';
    if ((sujet !== 'maison' && sujet !== 'proprietaire') || (concernePersonne(ev) && sujet !== 'proprietaire')) { this.refusesTiers++; return { accepte: false, jugees: [] }; }
    if (!this.travaille(o)) return { accepte: false, jugees: [] };
    // Un événement daté dans le futur (horloge fausse, journal rejoué) ne juge rien et n'est pas appris.
    if (ev.at > this.now() + TOLERANCE_FUTUR_MS) return { accepte: false, jugees: [] };
    const propre: EvenementDate = {
      appli: String(ev.appli).slice(0, 40), type: String(ev.type).slice(0, 60), at: ev.at,
      // pour un événement qui concerne une personne (le propriétaire), le libellé n'est jamais gardé
      cle: ev.cle && !concernePersonne(ev) ? String(ev.cle).slice(0, 80) : undefined,
      valeur: ev.valeur, seuil: ev.seuil, probabilite: ev.probabilite, pour: ev.pour, sujet,
    };
    const jugees: Prevision[] = [];
    if (!estPrevisionMeteo(propre)) {
      const cles = new Set([cleEvenement(propre)]);
      if (typeof propre.valeur === 'number' && typeof propre.seuil === 'number' && propre.valeur >= propre.seuil) cles.add(`${cleEvenement(propre)}#seuil`);
      for (const p of this.magasin.etat.previsions) {
        if (p.etat !== 'en_attente' || p.sorte !== 'evenement' || !cles.has(p.cle)) continue;
        if (propre.at < (p.des ?? p.cree) || propre.at > p.echeance) continue;
        this.juger(p, 'realisee', { texte: `${p.quoi} à ${new Date(propre.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, at: propre.at });
        jugees.push(p);
      }
    }
    this.magasin.ajouterEvenement(propre);
    if (o?.differer) this.magasin.planifierSauvegarde(); else this.magasin.sauver();
    return { accepte: true, jugees };
  }

  /** Estime ce qui va probablement arriver (rythmes, tendances, météo) et le pose comme prévisions à juger. */
  prevoirEvenements(o?: OptionsEchange): Proposition[] {
    if (!this.travaille(o)) return [];
    this.cloturer();
    const n = this.now(), evs = this.magasin.etat.evenements;
    const est = [...rythmes(evs, n), ...tendances(evs, n), ...meteo(evs, n)];
    const props = est.map((e) => this.proposer(this.poser(this.nouvelle('evenement', e))));
    this.magasin.sauver();
    return props.sort((a, b) => b.prevision.confiance - a.prevision.confiance);
  }

  /**
   * Ce qui vaut la peine d'être signalé MAINTENANT : prévision sûre (pas un pressentiment), au-dessus du seuil, attendue
   * dans l'horizon, et pas déjà signalée récemment (pas de répétition). Rend des propositions DISCRÈTES : c'est la
   * surface qui choisit de les montrer ; Prónoia ne notifie rien elle-même.
   */
  aPrevenir(horizonMs = 2 * HEURE, o?: OptionsEchange): Proposition[] {
    if (!this.travaille(o)) return [];
    const n = this.now(), r = this.magasin.etat.reglages, deja = this.magasin.etat.prevenus;
    const out: Proposition[] = [];
    for (const p of this.magasin.etat.previsions) {
      if (p.etat !== 'en_attente' || p.sorte !== 'evenement') continue;
      if (estPressentiment(p, r) || p.confiance < r.seuilPrevenir) continue;
      const debut = p.des ?? p.attendu ?? p.echeance;
      if (debut - n > horizonMs || p.echeance < n) continue;
      if (deja[p.cle] !== undefined && n - deja[p.cle] < 12 * HEURE) continue;
      deja[p.cle] = n;
      out.push(this.proposer(p));
    }
    if (out.length) this.magasin.sauver();
    return out;
  }

  // ------------------------------------------------------------------ Lot 1 : bilan, garde, effacement
  previsions(): Prevision[] { return this.magasin.etat.previsions.map((p) => ({ ...p })); }
  bilan(): Bilan {
    this.cloturer();
    const b = bilan(this.magasin.etat.previsions, this.magasin.etat.mesures);
    if (this.magasin.illisible) b.texte = `${this.magasin.illisible}
${b.texte}`;
    return b;
  }
  purger(): number { const r = this.magasin.purger(this.now()); this.magasin.sauver(); this.modele = new ModeleDemandes(this.magasin.etat.demandes, this.now()); return r; }
  effacerTout(): void { this.abandonner(); this.prep?.vider(); this.magasin.effacerTout(); this.creerPreparations(); this.modele = new ModeleDemandes([], this.now()); }
}
