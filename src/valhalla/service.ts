// Valhalla en marche : démarre les modules, leurs surveillances, le fil d'alertes (envoyées sur ta
// messagerie selon leur gravité), les événements entre modules (réflexes et Talos), et le choix du
// bon module pour un besoin, avec ou sans IA.

import { Metrics, setMetrics } from './metrics.ts';
import { accord } from '../core/genre.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { understand, type Understood } from './huginn.ts';
import { explainListen } from './hostports.ts';
import type { Action, ActionResult, Alert, AlertIn, By, Level, Manip, ModCtx, Module, NotifyOpts } from './types.ts';
import { refusAppli, agissant, type Agissant } from './sso/acces.ts';
import { Journal } from './base/journal.ts';
import { noterEchange, numeroEchange, type Echange } from './echanges.ts';
import { Automatismes } from './automatismes.ts';
import { enClair, fermer, migrerAppli, ouvrir, privesAppli } from '../prive.ts';
import { reglageFichierEcrit } from '../reglages-note.ts';
import { relayerEvenement } from './pronoia/branchement.ts';
import { activeDans, basculerDans, ecrireActivation, estEssentielle, lireActivation, texteDesactivee, type EtatActivation } from './activation.ts';

const RANK: Record<Level, number> = { info: 0, moyenne: 1, haute: 2, critique: 3 };
const ICON: Record<Level, string> = { info: 'ℹ️', moyenne: '🟡', haute: '🟠', critique: '🔴' };
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/**
 * L'action en cours, pour les appels qu'elle fait à d'autres applis pendant qu'elle tourne. `pasLui` : elle n'a pas été
 * lancée par le propriétaire en personne (automatisation, réflexe, Odin seul, membre, conversation marquée) — tout ce
 * qu'elle déclenche ne l'est pas non plus. `valide` : le propriétaire l'a lancée et elle montrait ce qui change (son
 * « grave ») : sa validation couvre ce qu'elle demande ensuite.
 */
const enCours = new AsyncLocalStorage<{ pasLui: boolean; valide: boolean; fini?: boolean }>();
/** Fermetures qui ont une validation (elle dit ce qui ne sera plus joignable) : la règle du réflexe ne les vise pas. */
const FERMETURES = new Set(['garmr.fermer_port', 'gjoll.fermer_port', 'hlid.fermer_box']);
/**
 * Le journal des manips garde les 500 dernières faites sans toi (Odin, réflexe, automatisation, autre assistant), comme
 * avant ; ce que fait un membre de la famille a sa propre limite (les 200 dernières de chacun) : ses actions ne chassent
 * jamais du journal ce qu'Odin a fait seul et qui attend ta décision, ni ce qu'a fait un autre membre.
 */
function bornerManips(l: Manip[]): Manip[] {
  const garde = new Set(l.filter((x) => x.by !== 'membre').slice(-500)), parMembre = new Map<string, Manip[]>();
  for (const x of l) if (x.by === 'membre') { const k = x.par?.login ?? '', t = parMembre.get(k); if (t) t.push(x); else parMembre.set(k, [x]); }
  for (const m of parMembre.values()) for (const x of m.slice(-200)) garde.add(x);
  return l.filter((x) => garde.has(x));
}

export interface ValhallaDeps {
  notify?(text: string, o?: NotifyOpts): Promise<void>;
  ask?(text: string): Promise<string>;
  fetch?: typeof fetch;
  now?(): Date;
  /** exécution de commande (remplaçable dans les tests) */
  run?: ModCtx['run'];
  /** niveau d'autonomie d'Odin (Heimdall) : en « breaker », Odin décide seul de garder ses manips */
  autonomy?(): 'prudent' | 'equilibre' | 'autonome' | 'breaker';
}

export class Valhalla {
  readonly events = new EventEmitter();
  readonly dir: string;
  private mods = new Map<string, Module>();
  private ctxs = new Map<string, ModCtx>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private journalAlertes: Journal<Alert>;
  private recent = new Map<string, number>();
  private deps: ValhallaDeps;
  constructor(home: string, modules: Module[], deps: ValhallaDeps = {}) {
    this.deps = deps;
    this.dir = join(home, 'valhalla');
    mkdirSync(this.dir, { recursive: true });
    // Le fil d'alertes : dans la base d'Odin dès qu'elle est prête (sinon valhalla/alertes.jsonl, comme avant).
    this.journalAlertes = new Journal<Alert>('alertes', this.dir, { garder: 5000 });
    for (const m of modules) this.mods.set(m.id, m);
    this.events.setMaxListeners(100);
    // Les mesures gardées dans le temps (courbes, déclencheurs, tableaux de bord).
    this.metrics = new Metrics(join(this.dir, 'mesures'), deps.now ? () => deps.now!().getTime() : Date.now); setMetrics(this.metrics);
    // Le registre des automatismes : tout ce que les applis font toutes seules, visible et réglable dans Talos.
    this.automatismes = new Automatismes({ dir: this.dir, now: () => this.deps.now?.() ?? new Date(), modules: () => this.modules(), ctx: (id) => this.ctx(id), alert: (m, a) => this.alert(m, a), ack: (ids) => this.ack(ids), act: (m, a, i) => this.act(m, a, i, { by: 'toi' }), desactivee: (id) => !this.estActive(id) });
    // Les applis actives ou désactivées (activation.ts) : sans réglage, toutes actives.
    this.activation = lireActivation(home);
  }
  readonly metrics: Metrics;
  readonly automatismes: Automatismes;

  // ---------------- Applis actives ou désactivées
  private activation: EtatActivation;
  /** Une appli désactivée reste visible (grisée) ; elle ne démarre pas et rien ne la lance. Inconnue : active. */
  estActive(id: string): boolean { return activeDans(this.activation, id); }
  /** Une appli indispensable au fonctionnement d'Odin (toujours active). */
  estEssentielle(id: string): boolean { return estEssentielle(id); }
  /**
   * Active (`oui`) ou désactive une appli : le réglage est gardé sur le disque, puis l'appli démarre (avec sa
   * surveillance) ou s'arrête. Ses données ne sont jamais touchées. La personne qui le demande est vérifiée avant
   * (route web : le propriétaire seul).
   */
  async activer(id: string, oui: boolean): Promise<{ ok: boolean; text: string; active?: boolean }> {
    const m = this.mods.get(id); if (!m) return { ok: false, text: 'Appli inconnue.' };
    if (!oui && estEssentielle(m.id)) return { ok: false, text: `${m.name} est indispensable au fonctionnement d'Odin : elle reste active.`, active: true };
    if (this.estActive(m.id) === oui) return { ok: true, text: oui ? `${m.name} est déjà active.` : `${m.name} est déjà désactivée.`, active: oui };
    const avant = this.activation, apres = basculerDans(avant, m.id, oui);
    try { ecrireActivation(join(this.dir, '..'), apres); } catch (e) { return { ok: false, text: `Réglage non enregistré (${(e as Error).message}) : rien n'a changé.`, active: !oui }; }
    this.activation = apres;
    if (oui) { if (this.lance && !this.demarres.has(m.id)) await this.demarrerUne(m); }
    else { this.automatismes.desarmer(m.id); if (this.demarres.delete(m.id)) { try { m.stop?.(); } catch { /* rien */ } } }
    this.events.emit('activation', { module: m.id, active: oui });
    return { ok: true, text: oui ? `${m.name} est activée.` : `${m.name} est désactivée : plus de notification, de tâche ni d'automatisation (seule une alerte de sécurité critique passe encore, par Forseti). Ses données sont gardées.`, active: oui };
  }

  modules(): Module[] { return [...this.mods.values()]; }
  module(id: string): Module | undefined {
    const n = norm(id);
    return this.mods.get(id) ?? this.modules().find((m) => norm(m.name) === n || norm(m.id) === n || (m.modes ?? []).some((x) => norm(x).startsWith(n)) || m.from.some((x) => norm(x) === n));
  }

  // ---------------- Contexte d'un module
  ctx(id: string): ModCtx {
    const have = this.ctxs.get(id); if (have) return have;
    const dir = join(this.dir, id); mkdirSync(dir, { recursive: true });
    const sf = join(dir, 'réglages.json');
    // Les valeurs privées (position de la maison…) sont chiffrées dans le fichier, déchiffrées ici, en mémoire.
    const home = join(this.dir, '..'), prives = privesAppli(id);
    const brut: Record<string, unknown> = existsSync(sf) ? JSON.parse(readFileSync(sf, 'utf8')) : {};
    const settings: Record<string, unknown> = prives.length ? ouvrir(home, brut) : brut;
    // Écriture sûre : le dossier est recréé s'il a disparu, et le fichier est remplacé d'un coup (jamais à moitié écrit).
    // Puis la base d'Odin (Alexandrie) en garde une copie quand elle est branchée (reglages-base.ts).
    const ecrire = () => { mkdirSync(dir, { recursive: true }); const tmp = `${sf}.tmp`; writeFileSync(tmp, JSON.stringify(prives.length ? fermer(home, settings, prives) : settings, null, 2), { mode: 0o600 }); renameSync(tmp, sf); reglageFichierEcrit(home, sf); };
    if (prives.length && enClair(brut, prives)) { migrerAppli(id, settings); try { ecrire(); } catch { /* relu en clair, chiffré au prochain enregistrement */ } }
    const c: ModCtx = {
      home, dir, settings,
      saveSettings: (patch) => { Object.assign(settings, patch); ecrire(); },
      alert: (a) => this.alert(id, a),
      emit: (type, data = {}) => {
        if (!this.estActive(id)) return; // appli désactivée : aucun événement (ni lien, ni automatisation)
        const e = { module: id, type, data, at: (this.deps.now?.() ?? new Date()).toISOString() };
        this.events.emit('event', e);
        relayerEvenement(home, e); // Prónoia : après coup, jamais bloquant ; rien si elle est coupée ou absente
      },
      run: this.deps.run ?? run,
      has: async (cmd) => (await (this.deps.run ?? run)('sh', ['-c', `command -v ${cmd.replace(/[^\w.-]/g, '')}`])).code === 0,
      fetch: this.deps.fetch ?? fetch,
      notify: async (t, o) => { if (this.estActive(id)) await this.deps.notify?.(t, o); },
      ask: this.deps.ask,
      call: (m, a, input = {}, why, o) => !this.estActive(id) ? Promise.resolve({ ok: false, text: texteDesactivee(this.mods.get(id)?.name ?? id) }) : this.act(m, a, input, o?.interne ? { by: 'toi', de: id } : { by: 'réflexe', why: why ?? `réflexe de ${this.mods.get(id)?.name ?? id}`, de: id }),
      now: () => this.deps.now?.() ?? new Date(),
      // Un membre de la famille qui lit par une autre appli que Sphinx (Forseti, Chroniques, Hydre…) : les alertes de
      // Sphinx des autres appareils n'y sont pas. Le propriétaire, ses automatisations et Odin lui-même : tout, comme avant.
      alerts: (o) => (agissant() && id !== 'vidarr' ? this.alertesPourMembre(o) : this.alerts(o)),
      ack: (ids) => this.ack(ids),
      modules: () => this.modules(),
      order: (text) => this.order(text, `appli:${id}`),
    };
    this.ctxs.set(id, c);
    return c;
  }

  // ---------------- Démarrage
  /** Change à chaque arrêt : un démarrage encore en cours s'en aperçoit et s'arrête là. */
  private tour = 0;
  /** Démarré (start appelé) ; les applis effectivement démarrées. */
  private lance = false;
  private demarres = new Set<string>();
  async start(): Promise<void> {
    const tour = this.tour; this.lance = true;
    for (const m of this.modules()) {
      // Une appli désactivée ne démarre pas : ni serveur, ni surveillance (elle démarrera quand on l'active).
      if (!this.estActive(m.id) || this.demarres.has(m.id)) continue; // déjà démarrée (activée pendant ce démarrage)
      if (!(await this.demarrerUne(m, tour))) return;
    }
  }
  /** Démarre une appli et arme sa surveillance. false : Odin a été arrêté pendant ce démarrage. */
  private async demarrerUne(m: Module, tour = this.tour): Promise<boolean> {
    this.demarres.add(m.id);
    try { await m.start?.(this.ctx(m.id)); } catch (e) { this.alert(m.id, { level: 'moyenne', title: `${m.name} n'a pas pu démarrer`, detail: await explainListen(e), key: `start:${m.id}` }); }
    // Odin arrêté pendant ce démarrage : l'appli qui vient de démarrer est arrêtée à son tour, les suivantes ne
    // démarrent pas (sinon leurs serveurs et leurs minuteries resteraient ouverts après l'arrêt).
    if (tour !== this.tour) { try { m.stop?.(); } catch { /* rien */ } return false; }
    // Désactivée pendant son démarrage : arrêtée maintenant qu'elle a fini de démarrer (rien ne reste allumé).
    if (!this.estActive(m.id)) { this.demarres.delete(m.id); try { m.stop?.(); } catch { /* rien */ } return true; }
    if (m.watch) {
      const tick = async () => { try { await m.watch!.run(this.ctx(m.id)); } catch (e) { this.alert(m.id, { level: 'info', title: `${m.name} : surveillance en échec`, detail: (e as Error).message, key: `watch:${m.id}` }); throw e; } };
      // Le registre des automatismes (Talos) garde les minuteries : 20-40 s puis toutes les `every` secondes, pause, passage mesuré.
      this.automatismes.armer(m, tick);
    }
    return true;
  }
  stop(): void { this.tour++; this.lance = false; this.demarres.clear(); this.automatismes.arreter(); if (this.extraTimer) clearTimeout(this.extraTimer); this.extraTimer = undefined; for (const t of this.timers) { clearInterval(t); clearTimeout(t); } this.timers = []; for (const m of this.modules()) { try { m.stop?.(); } catch { /* rien */ } } try { this.metrics.flush(); } catch { /* disque */ } this.journalAlertes.fermer(); }

  // ---------------- Actions
  action(moduleId: string, actionId: string): { m: Module; a: Action } | undefined {
    const m = this.module(moduleId); const a = m?.actions.find((x) => x.id === actionId || norm(x.label) === norm(actionId));
    return m && a ? { m, a } : undefined;
  }
  /**
   * `auto` : appel sans personne (automatisation, autre assistant) → les actions graves sont refusées.
   * `by` : qui agit. Tout ce qui n'est pas « toi » et qui change quelque chose est noté dans le
   * journal des manips : tu es prévenu, et tu peux garder ou annuler.
   */
  act(moduleId: string, actionId: string, input: Record<string, unknown> = {}, o: { auto?: boolean; by?: By; why?: string; /** l'appli qui demande (appel entre applis) */ de?: string; /** qui parle à Odin (outil de l'agent) */ qui?: 'owner' | 'member' | 'guest'; /** conversation marquée (contenu extérieur lu) */ marque?: boolean } = {}): Promise<ActionResult> {
    if (!o.de) return this.agir(moduleId, actionId, input, o);
    // Même promesse rendue que sans échange (aucune attente en plus pour l'appli qui appelle) : la réponse part juste après.
    // Seule exception à « propriétaire seul » : le réflexe de sécurité de Hydre (quarantaine) COUPE une machine d'Internet ; jamais la rouvrir.
    const { de, ...reste } = o, fin = this.echange(de, moduleId, actionId), p = this.agir(moduleId, actionId, input, { ...reste, entreApplis: true, coupureSecurite: de === 'ymir' && `${moduleId}.${actionId}` === 'vidarr.couper_machine' && reste.by === 'réflexe' && !reste.auto && !reste.qui && !reste.marque });
    if (fin) p.then((r) => fin(r.ok !== false), () => fin(false));
    return p;
  }
  private async agir(moduleId: string, actionId: string, input: Record<string, unknown>, o: { auto?: boolean; by?: By; why?: string; qui?: 'owner' | 'member' | 'guest'; marque?: boolean; /** demandé par une appli (ctx.call) */ entreApplis?: boolean; coupureSecurite?: boolean }): Promise<ActionResult> {
    const f = this.action(moduleId, actionId);
    if (!f) return { ok: false, text: `Action inconnue : ${moduleId} → ${actionId}` };
    // Appli désactivée : rien ne la lance (page, parole, automatisation, lien entre applis, tâche) ; Odin propose de l'activer.
    if (!this.estActive(f.m.id)) return { ok: false, text: texteDesactivee(f.m.name) };
    const refus = refusAppli(f.m.id, o.by); if (refus) return { ok: false, text: refus }; // droits par appli (personne de Persona)
    // « Propriétaire seul » : ni une automatisation, ni un réflexe, ni Odin seul, ni un membre, ni une personne de Persona,
    // ni une conversation marquée. (La fonction « grave » ne sait pas qui appelle : c'est décidé ici.)
    // Un appel entre applis (même « interne ») garde qui a lancé l'action de départ : une autre appli ne sert pas de détour.
    // Sans action de départ en cours (veille, démarrage, route d'une appli, minuteur armé par une action finie) : ce n'est
    // pas le propriétaire en personne.
    const enDirect = enCours.getStore(), parent = o.entreApplis && enDirect && !enDirect.fini ? enDirect : undefined;
    const pasLui = Boolean(o.auto || (o.by !== undefined && o.by !== 'toi') || (o.qui !== undefined && o.qui !== 'owner') || o.marque || agissant() || (o.entreApplis && !parent) || parent?.pasLui);
    const seul = typeof f.a.proprietaireSeul === 'function' ? f.a.proprietaireSeul(input, this.ctx(f.m.id)) : f.a.proprietaireSeul === true;
    if (seul && pasLui && !(o.coupureSecurite && !parent))
      return { ok: false, text: `${f.m.name} · ${f.a.label} : seul le propriétaire le règle lui-même (pas une automatisation, pas quelqu'un d'autre, pas après un contenu extérieur).` };
    const why = f.a.grave?.(input, this.ctx(f.m.id));
    if (o.auto && why) return { ok: false, text: `${f.m.name} · ${f.a.label} : action grave (${why}), elle demande ton accord et ne part pas d'une automatisation.` };
    // Demandé par une autre action en cours : ce qui est réservé au propriétaire et qui demande sa validation ne passe que
    // si l'action de départ l'a eue (elle montrait ce qui change).
    if (parent && seul && why && !parent.valide) return { ok: false, text: `${f.m.name} · ${f.a.label} : ${why} — cela demande ta validation, et l'action qui le demandait ne l'a pas eue.` };
    // Un réflexe (une appli qui en appelle une autre, sans le propriétaire en personne : réflexe, veille, automatisation)
    // n'atteint une action grave que si l'action de départ a été validée par lui (sa validation montrait ce qui suit).
    // Sinon : refusé, jamais fait en silence, et il est prévenu. (L'étape déclarée « interne » d'une action qu'il a lancée
    // lui-même garde la règle ci-dessus.) Fermer un port n'ouvre rien : un réflexe peut toujours fermer, comme avant.
    if (o.entreApplis && why && pasLui && !parent?.valide && !FERMETURES.has(`${f.m.id}.${f.a.id}`)) {
      this.alert(f.m.id, { level: 'haute', title: `Refusé sans ta validation : ${f.a.label}`, detail: `${why} (demandé par ${o.why ?? 'une autre appli'}). Si tu le veux, lance-le toi-même dans ${f.m.name} : sa validation te montrera ce qui change.`, key: `sans-validation:${f.a.id}:${why.slice(0, 80)}` });
      return { ok: false, text: `${f.m.name} · ${f.a.label} : ${why} — cela demande ta validation, et l'action qui le demandait ne l'a pas eue.` };
    }
    for (const p of f.a.params ?? []) if (p.required && (input[p.key] === undefined || input[p.key] === '')) return { ok: false, text: `Il manque « ${p.label} ».` };
    // Un membre de la famille (personne de Persona connectée à l'interface d'Odin) qui agit lui-même : noté à son nom dans
    // « mes manips », sans déranger le propriétaire. Son droit sur l'appli a déjà été contrôlé plus haut avec le « by »
    // reçu (refusAppli) : ce « membre » ne sert qu'au journal. Les étapes internes d'une action restent sous l'action de départ.
    const membre = !o.auto && !o.entreApplis && (o.by === undefined || o.by === 'toi') ? agissant() : undefined;
    const by: By = membre ? 'membre' : o.by ?? (o.auto ? 'automatisation' : 'toi');
    try {
      // La validation ne vaut que pendant l'action : ce qu'elle laisse derrière elle (minuteur, promesse) n'en hérite pas.
      const ici: { pasLui: boolean; valide: boolean; fini?: boolean } = { pasLui, valide: parent ? parent.valide : !pasLui && Boolean(why) };
      let r: ActionResult; try { r = await enCours.run(ici, () => f.a.run(this.ctx(f.m.id), input)); } finally { ici.valide = false; ici.fini = true; }
      this.events.emit('action', { module: f.m.id, action: f.a.id, ok: r.ok !== false, by });
      if (r.ok !== false && by !== 'toi' && !f.a.read && !f.a.quiet) this.noteManip(f.m, f.a, input, r, by, o.why, membre);
      return { ok: true, ...r };
    } catch (e) { this.events.emit('action', { module: f.m.id, action: f.a.id, ok: false, by }); return { ok: false, text: `${f.m.name} · ${f.a.label} : ${(e as Error).message}` }; }
  }

  /**
   * Une appli en appelle une autre : la demande, puis la réponse, partent en direct vers les pages ouvertes (le lien
   * entre les deux brille dans les graphes). Seuls les identifiants et le nom de l'action sortent, jamais les données.
   */
  private echange(de: string, moduleId: string, actionId: string): ((ok: boolean) => void) | undefined {
    const f = this.action(moduleId, actionId), src = this.mods.get(de);
    if (!f || !src || f.m.id === de) return undefined;
    const id = numeroEchange(), base = { id, de, vers: f.m.id, action: f.a.id, deNom: src.name, versNom: f.m.name, libelle: f.a.label };
    const dire = (e: Echange) => { try { noterEchange(e); this.events.emit('echange', e); } catch { /* l'affichage ne gêne jamais l'appel */ } };
    const quand = () => (this.deps.now?.() ?? new Date()).toISOString();
    dire({ ...base, phase: 'demande', ok: true, at: quand() });
    return (ok) => dire({ ...base, phase: 'reponse', ok, at: quand() });
  }

  /** Niveau d'autonomie d'Odin (prudent, équilibré, autonome, Breaker). */
  autonomy(): 'prudent' | 'equilibre' | 'autonome' | 'breaker' { return this.deps.autonomy?.() ?? 'equilibre'; }

  /**
   * Une demande en français, comprise SANS IA (Logos) puis exécutée. `confirm` : tu as confirmé une
   * action grave (sinon elle n'est pas lancée : la réponse dit ce qu'il faut confirmer).
   */
  async order(text: string, session = 'principal', o: { by?: By; confirm?: boolean; /** pas le propriétaire en personne (la clé d'API) : « propriétaire seul » refusé */ qui?: 'owner' | 'member' | 'guest' } = {}): Promise<ActionResult & { understood?: Understood; confirm?: string }> {
    const u = await understand(this, text, session);
    if (!u) return { ok: false, text: 'Je n\'ai pas compris quelle appli utiliser. Dis-le avec le nom de l\'appli ou de la chose (« arrête le conteneur web », « bannis 203.0.113.9 », « les alertes »).' };
    if (u.kind === 'say' || u.kind === 'ask') return { ok: true, text: u.text, understood: u };
    if (u.kind === 'manip') {
      // Garder ou annuler ce qu'Odin a fait seul : le propriétaire, pas un membre (qui ne lit pas non plus ce que ce serait).
      if (agissant()) return { ok: false, text: 'Garder ou annuler ce qu\'Odin a fait de lui-même, c\'est le propriétaire qui le décide.', understood: u };
      // Annuler lance l'action inverse : si elle est grave (redonner un droit…), elle demande la validation, comme sur la page.
      if (!u.keep && !o.confirm) { const why = this.graveAnnulation(u.id); if (why) return { ok: false, text: `${why}. C'est une action grave : confirme-la.`, confirm: why, understood: u }; }
      // L'action inverse part au nom de qui parle : la clé d'API, ou une phrase venue d'une appli (la voix), n'atteint pas le « propriétaire seul ».
      const r = await this.decide(u.id, u.keep, 'toi', { qui: session.startsWith('appli:') ? 'guest' : o.qui }); return { ok: r.ok, text: r.text, understood: u };
    }
    const f = this.action(u.module, u.action)!;
    if (!this.estActive(f.m.id)) return { ok: false, text: texteDesactivee(f.m.name), understood: u };
    const why = f.a.grave?.(u.input, this.ctx(f.m.id));
    if (why && !o.confirm) return { ok: false, text: `${u.label} : ${why}. C'est une action grave : confirme-la.`, confirm: why, understood: u };
    const r = await this.act(u.module, u.action, u.input, { by: o.by ?? 'toi', qui: o.qui, de: session.startsWith('appli:') ? session.slice(6) : undefined });
    return { ...r, text: `${u.label}\n${r.text}`, understood: u };
  }

  // ---------------- Manips : ce qu'Odin a fait sans que tu le demandes (garder / annuler)
  private get manipsFile(): string { return join(this.dir, 'manips.json'); }
  private readManips(): Manip[] { try { const l = JSON.parse(readFileSync(this.manipsFile, 'utf8')) as Manip[]; return Array.isArray(l) ? l : []; } catch { return []; } }
  private writeManips(l: Manip[]): void { const tmp = `${this.manipsFile}.tmp`; writeFileSync(tmp, JSON.stringify(bornerManips(l))); renameSync(tmp, this.manipsFile); }
  private told: number[] = [];
  private extra = 0;
  private extraTimer?: ReturnType<typeof setTimeout>;
  private noteManip(m: Module, a: Action, input: Record<string, unknown>, r: ActionResult, by: By, why?: string, membre?: Agissant): void {
    const now = this.deps.now?.() ?? new Date(), all = this.readManips();
    let id = ''; do { id = Math.random().toString(36).slice(2, 6); } while (!/^[a-z]/.test(id) || all.some((x) => x.id === id));
    let undo: Manip['undo']; try { undo = a.undo?.(input, r, this.ctx(m.id)); } catch { /* pas d'annulation proposée */ }
    // Les mots de passe et jetons éventuels des réglages ne sont jamais recopiés dans le journal.
    // Un réglage déclaré privé (numéro, nom d'une personne) non plus.
    const safe = Object.fromEntries(Object.entries(input).map(([k, v]) => { const p = (a.params ?? []).find((x) => x.key === k); return [k, p?.kind === 'password' || p?.prive === true || /mot_?de_?passe|password|secret|jeton|token|cle\b|clé/i.test(k) ? '•••' : typeof v === 'string' ? v.slice(0, 300) : v]; }));
    const breaker = this.deps.autonomy?.() === 'breaker';
    // Simple tenue de registre par réflexe (une fiche créée, une configuration rangée au coffre) : rien à
    // annuler, rien à décider — c'est noté dans le journal, sans te déranger.
    const bookkeeping = by === 'réflexe' && !undo;
    // Ce qu'un membre de la famille fait lui-même : rangé à son nom, sans te déranger (rien à décider : il en avait le
    // droit, ou tu as validé sa demande) ; tu peux toujours l'annuler depuis « mes manips ».
    const par = membre ? { login: membre.login.slice(0, 64), name: membre.name.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').slice(0, 80) } : undefined;
    const manip: Manip = { id, at: now.toISOString(), module: m.id, action: a.id, label: `${m.name} · ${a.label}`, input: safe, text: r.text.split('\n')[0].slice(0, 300), by, why: par ? why ?? `fait par ${par.name} (membre de la famille)${membre?.accord ? ', sa demande validée par toi' : ''}` : why, undo, state: breaker || bookkeeping || par ? 'gardée' : 'à décider',
      ...(par ? { par, decidedBy: membre?.accord ? 'toi (sa demande validée)' : `${par.name} (son droit sur l'appli)`, decidedAt: now.toISOString() } : breaker ? { decidedBy: 'Odin (mode Breaker)', decidedAt: now.toISOString() } : bookkeeping ? { decidedBy: 'réflexe (rien à annuler)', decidedAt: now.toISOString() } : {}) };
    try { this.writeManips([...all, manip]); } catch { /* disque plein ou dossier disparu : la manip reste faite, le journal non */ }
    this.events.emit('manip', manip);
    if (bookkeeping || par) return;
    // Tu es prévenu : au plus 3 messages par 10 minutes, puis un seul message de rattrapage.
    const t = now.getTime(); this.told = this.told.filter((x) => t - x < 600_000);
    if (this.told.length >= 3) {
      this.extra++;
      this.extraTimer ??= setTimeout(() => { const n = this.extra; this.extra = 0; this.extraTimer = undefined; if (n) void this.deps.notify?.(`🤖 J'ai fait ${n} autre(s) manip(s) entre-temps. Dis « mes manips » pour les voir, « garde tout » ou « annule <code> ».`).catch(() => {}); }, 600_000);
      (this.extraTimer as { unref?: () => void }).unref?.();
      return;
    }
    this.told.push(t);
    void this.deps.notify?.(this.manipText(manip)).catch(() => {});
  }
  /** Le message envoyé pour une manip (aussi lu par la mascotte). */
  manipText(x: Manip): string {
    const who = { odin: 'de moi-même', 'réflexe': 'par réflexe', automatisation: 'par une automatisation', assistant: 'à la demande d\'un autre assistant', membre: `par ${x.par?.name ?? 'un membre de la famille'}`, toi: '' }[x.by];
    const tail = x.state === 'à décider' ? (x.undo ? ` Réponds « garde ${x.id} » ou « annule ${x.id} ».` : ` Je ne sais pas l'annuler ${accord('tout seul', 'toute seule')}. Réponds « garde ${x.id} » pour la valider.`)
      : x.state === 'gardée' && x.decidedBy?.startsWith('Odin') ? ` Je la garde (mode Breaker).${x.undo ? ` « annule ${x.id} » pour revenir en arrière.` : ''}` : '';
    return `🤖 Manip faite ${who} : ${x.label} — ${x.text}${x.why ? ` (${x.why})` : ''}.${tail}`;
  }
  manips(o: { state?: Manip['state']; limit?: number; module?: string } = {}): Manip[] {
    let l = this.readManips().reverse();
    if (o.state) l = l.filter((x) => x.state === o.state);
    if (o.module) l = l.filter((x) => x.module === o.module);
    return l.slice(0, o.limit ?? 100);
  }
  /** Les manips visées par `id` : un code, « tout » (celles à décider) ou « dernière ». */
  private choisirManips(all: Manip[], id: string): Manip[] {
    const want = id.trim().toLowerCase();
    // « La dernière » : ce qu'Odin (ou un réflexe, une automatisation…) a fait sans toi, jamais l'action d'un membre de la famille.
    return /^(tout|toutes|tous)$/.test(want) ? all.filter((x) => x.state === 'à décider') : /^(derni[eè]re|dernier|la derni[eè]re)$/.test(want) || !want ? all.filter((x) => x.state !== 'annulée' && x.by !== 'membre').slice(-1) : all.filter((x) => x.id === want);
  }
  /** Ce que montrerait la validation pour annuler `id` (un code, « tout » ou « dernière ») : rien si aucune action inverse n'est grave. */
  graveAnnulation(id: string): string | undefined {
    const l = this.choisirManips(this.readManips(), id).filter((x) => x.state !== 'annulée' && x.undo).map((x) => { const g = this.action(x.undo!.module ?? x.module, x.undo!.action); try { return g?.a.grave?.(x.undo!.input, this.ctx(g.m.id)); } catch { return undefined; } }).filter(Boolean);
    return l.length ? l.join(' ; ') : undefined;
  }
  /**
   * « garde » ou « annule » une manip (`id`, ou « tout » / « dernière »). Annuler lance l'action inverse, au nom de qui
   * le demande (`comme` : l'outil de l'agent passe qui parle et si la conversation est marquée).
   */
  async decide(id: string, keep: boolean, by = 'toi', comme: { by?: By; qui?: 'owner' | 'member' | 'guest'; marque?: boolean } = {}): Promise<{ ok: boolean; text: string; manips: Manip[] }> {
    const all = this.readManips(), now = (this.deps.now?.() ?? new Date()).toISOString();
    const want = id.trim().toLowerCase(), pick = this.choisirManips(all, id);
    if (!pick.length) return { ok: false, text: want && !/^(tout|toutes|tous|derni)/.test(want) ? `Je ne trouve pas la manip « ${id} ». Dis « mes manips » pour voir les codes.` : 'Aucune manip en attente.', manips: [] };
    const out: string[] = []; let ok = true;
    for (const x of pick) {
      if (keep) { if (x.state === 'annulée') { out.push(`${x.label} : déjà annulée.`); ok = false; continue; } x.state = 'gardée'; x.decidedBy = by; x.decidedAt = now; out.push(`✓ Gardé : ${x.label} — ${x.text}`); continue; }
      if (x.state === 'annulée') { out.push(`${x.label} : déjà annulée.`); continue; }
      if (!x.undo) { out.push(`✗ ${x.label} : je ne sais pas l'annuler ${accord('tout seul', 'toute seule')} (${x.text}).`); ok = false; continue; }
      const r = await this.act(x.undo.module ?? x.module, x.undo.action, x.undo.input, { ...comme, by: comme.by ?? 'toi' });
      if (r.ok === false) { out.push(`✗ ${x.label} : l'annulation a échoué (${r.text.slice(0, 160)}).`); ok = false; continue; }
      x.state = 'annulée'; x.decidedBy = by; x.decidedAt = now; out.push(`↩ Annulé : ${x.label} (${x.undo.label}).`);
    }
    this.writeManips(all);
    for (const x of pick) this.events.emit('manip', x);
    return { ok, text: out.join('\n'), manips: pick };
  }

  // ---------------- Alertes
  alert(module: string, a: AlertIn): Alert | undefined {
    // Appli désactivée : aucune alerte, aucun message (elle ne devrait rien faire ; si un reste tourne, il se tait).
    // Règle prudente : une alerte CRITIQUE (sûreté : fichier dangereux encore en place…) n'est jamais perdue ; Forseti,
    // toujours active, la porte à sa place (sans bouton qui viserait l'appli désactivée).
    if (this.mods.has(module) && !this.estActive(module)) {
      if (a.level !== 'critique' || !this.mods.has('forseti')) return undefined;
      return this.alert('forseti', { ...a, title: `${this.mods.get(module)!.name} (désactivée) : ${a.title}`, key: `${module}:${a.key ?? a.title}`, fix: undefined });
    }
    const now = this.deps.now?.() ?? new Date();
    const key = `${module}:${a.key ?? a.title}`;
    const last = this.recent.get(key);
    // Une alerte qui porte la clé d'un lien écrit (links.ts, « par son alerte ») que le propriétaire a coupé depuis
    // Talos : rangée et visible comme d'habitude, mais son message ne part pas, et elle le dit. Un état illisible ne
    // coupe rien ; une alerte sans clé ne change pas.
    const coupeDe = (): boolean => { if (typeof a.lien !== 'string') return false; try { return this.automatismes.lienCoupe(a.lien) === true; } catch { return false; } };
    let coupe: boolean | undefined;
    // Même alerte dans les 6 h : comptée, pas renvoyée — sauf une alerte retenue par un lien coupé (son message n'est
    // jamais parti) : une fois le lien rétabli, sa première occurrence passe.
    if (last && now.getTime() - last < 6 * 3600_000 && (!this.retenues.has(key) || (coupe = coupeDe()))) { this.bump(key); return undefined; }
    coupe ??= coupeDe();
    this.recent.set(key, now.getTime());
    if (coupe) this.retenues.add(key); else this.retenues.delete(key);
    const al: Alert = { ...a, id: Math.random().toString(36).slice(2, 10), at: now.toISOString(), module, count: 1, key, ...(coupe ? { nonEnvoye: 'message non envoyé : lien coupé par toi' } : {}) };
    this.journalAlertes.ajouter(al);
    this.events.emit('alert', al);
    const min = (this.settings().alertLevel as Level) ?? 'haute';
    if (!coupe && RANK[a.level] >= RANK[min]) {
      const m = this.mods.get(module);
      // Une alerte critique passe même en « Ne pas déranger » ; une photo (caméra) part avec le message.
      void this.deps.notify?.(`${ICON[a.level]} ${m?.name ?? module} — ${a.title}${a.detail ? `\n${a.detail}` : ''}`, { urgent: a.level === 'critique', ...(a.photo ? { photo: a.photo } : {}) }).catch(() => {});
    }
    return al;
  }
  /** Les alertes rangées sans que leur message parte (lien coupé) : elles ne comptent pas comme « déjà envoyées ». */
  private retenues = new Set<string>();
  private bump(key: string): void { this.counts.set(key, (this.counts.get(key) ?? 1) + 1); }
  private counts = new Map<string, number>();
  alerts(o: { module?: string; level?: Level; q?: string; limit?: number } = {}): Alert[] {
    const acked = this.acked();
    let all = this.journalAlertes.tout().reverse();
    all = all.map((a) => ({ ...a, ack: acked.has(a.id), count: this.counts.get(a.key ?? '') ?? a.count }));
    if (o.module) all = all.filter((a) => a.module === o.module);
    if (o.level) all = all.filter((a) => RANK[a.level] >= RANK[o.level!]);
    if (o.q) { const q = norm(o.q); all = all.filter((a) => norm(`${a.title} ${a.detail ?? ''} ${a.module}`).includes(q)); }
    return all.slice(0, o.limit ?? 200);
  }
  /**
   * Les adresses MAC de l'appareil que tient le membre qui agit en ce moment : c'est Sphinx qui le reconnaît, par
   * l'origine de sa demande (la même lecture que sa page « Appareils », faite en son nom). Personne n'agit, pas le droit
   * sur Sphinx, Sphinx désactivé, aucun appareil reconnu, ou une réponse qui n'est pas celle faite à un membre : aucune.
   */
  macsDeSonAppareil(): Set<string> {
    const rien = new Set<string>();
    try {
      if (!agissant() || refusAppli('vidarr')) return rien;
      const f = this.estActive('vidarr') ? this.action('vidarr', 'baux_vus') : undefined; if (!f || f.m.id !== 'vidarr') return rien;
      const r = f.a.run(this.ctx('vidarr'), {});
      if (r instanceof Promise) { r.catch(() => undefined); return rien; } // la lecture de Sphinx répond tout de suite ; sinon : aucune
      const d = r.data as { proprietaire?: unknown; appareils?: Array<{ mac?: unknown }> } | undefined;
      if (d?.proprietaire !== false || !Array.isArray(d.appareils)) return rien;
      return new Set(d.appareils.map((x) => (typeof x?.mac === 'string' ? x.mac.trim().toLowerCase() : '')).filter(Boolean));
    } catch { return rien; }
  }
  /**
   * Les alertes pour un membre qui lit par une autre appli que Sphinx : celles de Sphinx (et celles que Forseti porte
   * pour Sphinx désactivé) sont retirées, sauf celles de l'appareil qu'il tient — la règle de la garde (sso/garde.ts).
   * Le tri se fait avant la limite : les alertes des autres ne prennent pas la place des siennes.
   */
  private alertesPourMembre(o: { module?: string; level?: Level; q?: string; limit?: number } = {}): Alert[] {
    const macs = this.macsDeSonAppareil();
    const deSphinx = (a: Alert) => a.module === 'vidarr' || (a.module === 'forseti' && (a.key ?? '').startsWith('forseti:vidarr:'));
    const sienne = (a: Alert) => { const mac = a.data?.mac; return typeof mac === 'string' && macs.has(mac.trim().toLowerCase()); };
    return this.alerts({ ...o, limit: Number.MAX_SAFE_INTEGER }).filter((a) => !deSphinx(a) || sienne(a)).slice(0, o.limit ?? 200);
  }
  private acked(): Set<string> { try { return new Set(JSON.parse(readFileSync(join(this.dir, 'alertes-vues.json'), 'utf8'))); } catch { return new Set(); } }
  ack(ids: string[]): void { const s = this.acked(); for (const i of ids) s.add(i); writeFileSync(join(this.dir, 'alertes-vues.json'), JSON.stringify([...s].slice(-5000))); }

  settings(): Record<string, unknown> { try { return JSON.parse(readFileSync(join(this.dir, 'réglages.json'), 'utf8')); } catch { return {}; } }
  saveSettings(patch: Record<string, unknown>): void { const f = join(this.dir, 'réglages.json'); writeFileSync(f, JSON.stringify({ ...this.settings(), ...patch }, null, 2)); reglageFichierEcrit(join(this.dir, '..'), f); }

  // ---------------- Choisir le module pour un besoin (sans IA : mots-clés)
  find(need: string): Array<{ m: Module; score: number; action?: Action }> {
    const t = ` ${norm(need).replace(/[^\w\s-]/g, ' ')} `;
    const hit = (w: string) => { const n = norm(w); return n.includes(' ') ? t.includes(n) : new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t); };
    return this.modules().map((m) => {
      let score = 0;
      for (const w of m.words) if (hit(w)) score += w.includes(' ') ? 3 : 2;
      if (hit(m.name)) score += 5;
      for (const x of m.from) if (hit(x)) score += 4;
      for (const x of m.modes ?? []) if (hit(x.split(' ')[0])) score += 3;
      let action: Action | undefined, best = 0;
      for (const a of m.actions) { const s = (a.words ?? []).filter(hit).length * 2 + (hit(a.label) ? 2 : 0); if (s > best) { best = s; action = a; } }
      return { m, score: score + best, action };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  }
  describe(m: Module): string {
    return `**${m.name}** (${m.family}) — ${m.what}\nCe qu'il fait :\n${m.does.map((d) => `- ${d}`).join('\n')}${m.modes?.length ? `\nModes : ${m.modes.join(', ')}` : ''}\nActions : ${m.actions.map((a) => `${a.label}${a.grave ? ' (avec ton accord)' : ''}`).join(' · ')}\nReprend les fonctions de : ${m.from.join(', ')}.`;
  }
}

/** Commande système avec délai ; sudo -n si demandé (jamais de mot de passe tapé). */
export function run(cmd: string, args: string[], o: { timeoutMs?: number; input?: string; sudo?: boolean } = {}): Promise<{ code: number; out: string; err: string }> {
  const [c, a] = o.sudo && process.getuid?.() !== 0 ? ['sudo', ['-n', cmd, ...args]] : [cmd, args];
  return new Promise((resolve) => {
    const p = execFile(c, a, { timeout: o.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (err, out, er) => resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, out: String(out), err: String(er || (err && !out ? err.message : '')) }));
    if (o.input !== undefined) { p.stdin?.end(o.input); }
  });
}
