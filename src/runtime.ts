// Assemblage : construit un Odin complet à partir d'un dossier d'installation.
// Un seul point d'entrée pour la CLI, la passerelle, les tâches planifiées et les tests :
// tout le monde lit la MÊME configuration validée.

import { settingsTools } from './tools/reglages.ts';
import { fermerKv, ouvrirKv } from './prive.ts';
import { migrerDonneesPrivees } from './prive-migration.ts';
import { KV_REGLAGES, reglageKvEcrit } from './reglages-note.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupRestore } from './backup.ts';
import { refuserDossierReelEnEssai, vaultState } from './vault.ts';
import { machineSecrets } from './machines/access.ts';
import { BROWSER_TOOLS, closeBrowsers } from './tools/browser.ts';
import { webSearchTool } from './tools/search.ts';
import { SELF_TOOLS } from './tools/self.ts';
import type { Embedder } from './muninn/embed.ts';
import { embedderQuiSeRecharge } from './brain/nous/plongement.ts';
import { verifierNoyau, noterVerifNoyau, figerReference, empreinteReference, referenceChangee } from './heimdall/noyau.ts';
import { verifierActivation } from './tools/self.ts';
import { memoryProfile } from './tools/profile.ts';
import { changePlan, recoveryPlanTool } from './tools/careplan.ts';
import { evidenceSearch, webResearch } from './tools/research.ts';
import { VIDEO_TOOLS } from './tools/video.ts';
import { APP_TOOLS } from './tools/apps.ts';
import { BRAIN_TOOLS, brainOf } from './tools/brain.ts';
import { draupnirTool } from './tools/draupnir.ts';
import { RUNES_TOOLS } from './tools/runes.ts';
import { valhallaTool } from './tools/valhalla.ts';
import { notionTool } from './tools/notion.ts';
import { seedVault } from './brain/vault.ts';
import { SCRIPT_TOOLS } from './tools/scripts.ts';
import { skillImport } from './tools/skillimport.ts';
import { sign as signContent, verify as verifyContent } from './scripts/guard.ts';
import { PROXMOX_TOOLS } from './tools/proxmox.ts';
import { HA_TOOLS } from './tools/homeassistant.ts';
import { MAIL_TOOLS } from './tools/mail.ts';
import { CALENDAR_TOOLS } from './tools/calendar.ts';
import { DOC_TOOLS } from './tools/docindex.ts';
import { netSecurity } from './tools/network.ts';
import { type OdinConfig, loadConfig, odinPaths, initHome, type OdinPaths, DEFAULT_PERSONA, setConfigValue } from './config.ts';
import { migrerMetis } from './brain/metis/migration.ts';
import { Agent } from './core/agent.ts';
import { type Approver, denyAll, Heimdall } from './heimdall/policy.ts';
import { chargerClesRecues, Redactor, valeursDuCoffreProprietaire } from './heimdall/redact.ts';
import { load as chargerThesauros } from './valhalla/modules/brisingamen.ts';
import type { ModCtx } from './valhalla/types.ts';
import { Mnemosyne } from './muninn/store.ts';
import { buildProvider, idClassement, Router } from './providers/router.ts';
import { routeContext } from './providers/journal.ts';
import { routingHistory } from './tools/routing.ts';
import { BUILTIN_TOOLS, ensureWorkspace } from './tools/builtin.ts';
import { ToolRegistry, type ToolContext } from './tools/registry.ts';
import type { Provider } from './types.ts';
import { Athena } from './yggdrasil/skills.ts';
import { Inventory } from './hlidskjalf/inventory.ts';
import { NETWORK_TOOLS } from './tools/network.ts';
import { adminEnable, machineOnboard } from './tools/onboard.ts';
import { ASSISTANT_TOOLS } from './tools/assistant.ts';
import { recordAnswer, touchTrust, trusted } from './learn/habits.ts';
import { HABIT_TOOLS } from './tools/habits.ts';
import { loadPlugins, pluginSaveTool } from './tools/plugins.ts';
import { updateApplyTool, updateCheckTool } from './tools/update.ts';
import { EVERYDAY_TOOLS } from './tools/everyday.ts';
import { venusTool } from './tools/venus.ts';
import { parentalTool } from './home/parental.ts';
import { alarmTool } from './home/alarm.ts';
import { FILE_TOOLS } from './tools/files.ts';
import { AUDIO_TOOLS } from './tools/audio.ts';
import type { Judge } from './mimir/client.ts';
import { buildJudge } from './mimir/factory.ts';
import { plafonnerAutonomie, rangerQuestionsGardees } from './migrations/aucun-modele-externe.ts';
import { fondreConversations } from './migrations/conversation-unique.ts';
import { Mimir } from './mimir/decisions.ts';
import { loadEnvFile } from './settings.ts';
import { brancherGenre } from './core/genre.ts';
import { estUnModele, fournisseurSansModele, SANS_MODELE, type PorteModele } from './brain/porte-modele.ts';

export interface Odin {
  paths: OdinPaths;
  cfg: OdinConfig;
  agent: Agent;
  muninn: Mnemosyne;
  skills: Athena;
  heimdall: Heimdall;
  tools: ToolRegistry;
  inventory: Inventory;
  mimir?: Mimir;
  redactor: Redactor;
  /** La porte du modèle de langue : `pret()` est faux tant qu'aucun modèle ne peut répondre. « Sans modèle » n'est pas
   *  une démonstration : Soul, les mises à jour, les alertes et l'accès marchent pareil ; seul ce qui demandait un
   *  modèle de langue le teste ici. */
  modele: PorteModele;
  close(): void;
}

export interface CreateOptions {
  home?: string;
  approver?: Approver;
  /** Remplace les fournisseurs configurés (essais). */
  provider?: Provider;
  send?: ToolContext['send'];
  configOverride?: (c: OdinConfig) => OdinConfig;
  /** Remplace le juge de Mímir (tests). */
  judge?: Judge;
}

/** Vrai si le catalogue Métis contient déjà un modèle de discussion (lecture synchrone, tolérante). Sert seulement à
 *  choisir le texte de la notice de bascule ; aucune erreur n'est propagée. */
function catalogueMetisChat(home: string): boolean {
  try {
    const f = join(home, 'metis', 'catalogue.json');
    if (!existsSync(f)) return false;
    const d = JSON.parse(readFileSync(f, 'utf8')) as { modeles?: Array<{ type?: string }> };
    return Array.isArray(d.modeles) && d.modeles.some((m) => m && m.type === 'chat');
  } catch { return false; }
}

export function createOdin(opts: CreateOptions = {}): Odin {
  const paths = odinPaths(opts.home);
  // Un essai ou un banc qui vise le vrai ~/.odin (donné ou par défaut) : refus AVANT toute écriture ou suppression.
  refuserDossierReelEnEssai(paths.home, 'Odin');
  initHome(paths);
  try { cleanupRestore(paths); } catch { /* copies d'avant restauration : pas bloquant */ }
  loadEnvFile(paths); // clés enregistrées depuis l'interface web ou l'installateur
  let cfg = loadConfig(paths);
  if (opts.configOverride) cfg = opts.configOverride(cfg);
  ensureWorkspace(paths.workspace);

  // Bascule vers Métis : l'ancienne dépendance (serveur local réglé par adresse — Ollama, LM Studio, llama.cpp) est
  // retirée des fournisseurs, l'adresse d'embeddings en :11434 est neutralisée (sinon merge() la relirait), et le
  // propriétaire est prévenu une seule fois. On persiste le changement pour que la bascule soit idempotente. GARDE-FOU :
  // si le retrait laissait la liste des fournisseurs VIDE (installation qui n'avait que le serveur local), on la garde
  // telle quelle en mémoire pour qu'Odin démarre quand même — Métis prendra le relais dès qu'un modèle ouvert est là.
  if (!opts.provider) {
    try {
      const avantProviders = Array.isArray(cfg.providers) ? [...cfg.providers] : [];
      const m = migrerMetis(cfg, catalogueMetisChat(paths.home));
      if (m.change) {
        const videeParRetrait = Array.isArray(cfg.providers) && cfg.providers.length === 0 && avantProviders.length > 0;
        if (videeParRetrait) cfg.providers = avantProviders;
        else if (m.providersRetires > 0) { try { setConfigValue(paths, ['providers'], cfg.providers); } catch (e) { console.error('[modèles] bascule Métis (fournisseurs)', (e as Error).message); } }
        if (m.adresseEmbedRetiree) { try { setConfigValue(paths, ['memory', 'embedUrl'], ''); } catch (e) { console.error('[modèles] bascule Métis (embeddings)', (e as Error).message); } }
        if (m.notice) console.error(`[modèles] ${m.notice}`);
      }
    } catch (e) { console.error('[modèles] bascule Métis', (e as Error).message); }
  }

  const muninn = new Mnemosyne(paths.db);
  // Réglages gardés dans la mémoire (réveil…) : champs privés chiffrés, copie dans la base d'Odin (reglages-base.ts).
  muninn.gardeKv = { cles: new Set(KV_REGLAGES), lire: (k, v) => ouvrirKv(paths.home, k, v), ecrire: (k, v) => fermerKv(paths.home, k, v), ecrit: (k, v) => reglageKvEcrit(paths.home, k, v) };
  // Données privées encore en clair (Odin d'avant) : chiffrées une fois.
  try { const m = migrerDonneesPrivees(paths.home, muninn); if (m.length) console.error(`[réglages] données privées chiffrées : ${m.join(', ')}`); } catch (e) { console.error('[réglages]', (e as Error).message); }
  try { fondreConversations({ mu: muninn, langue: cfg.voice?.stt?.language }); } catch (e) { console.error('[conversation unique]', (e as Error).message); } // une fois : copie relue, puis une marque par ancienne conversation (aucun message déplacé)
  // Mode privé (Réglages → Voix) : suit le réglage en direct, sans redémarrer.
  Object.defineProperty(muninn, 'privateMode', { get: () => Boolean(cfg.voice.privacy?.privateMode), set: () => {}, configurable: true });
  const skills = new Athena(paths.skills, paths.drafts);
  skills.signer = { sign: (c) => signContent(paths.home, c), verify: (c, s) => verifyContent(paths.home, c, s) };
  const redactor = Redactor.fromEnv();
  // Les mots de passe des machines du réseau sont masqués partout (journal, réponses, sorties).
  for (const secret of machineSecrets(paths.home)) redactor.add(secret);
  // Le masqueur nourri : les clés reçues et les valeurs du coffre du propriétaire (Thésauros) sont relues à chaque
  // démarrage, en mémoire vive seulement (jamais recopiées ailleurs). Coffre fermé ou illisible : il garde ce qu'il
  // connaît sans lui, et le journal le dit, sans aucune valeur.
  for (const cle of chargerClesRecues(paths.home)) redactor.add(cle);
  try {
    const dirThesauros = join(paths.home, 'valhalla', 'brisingamen');
    if (existsSync(join(dirThesauros, 'coffre.bin'))) {
      let lu = false;
      if (/^[a-f0-9]{64}$/.test(process.env.BRISINGAMEN_KEY ?? '') && vaultState(paths.home) !== 'locked') {
        try { for (const v of valeursDuCoffreProprietaire(chargerThesauros({ dir: dirThesauros } as ModCtx))) redactor.addCoffre(v); lu = true; } catch { /* illisible : dit ci-dessous, sans le message d'erreur */ }
      }
      if (!lu) console.error('[masqueur] coffre fermé ou illisible au démarrage : ses valeurs ne sont pas chargées ; je masque ce que je connais sans lui');
    }
  } catch { /* jamais bloquant */ }
  const heimdall = new Heimdall(cfg.policy, opts.approver ?? denyAll, join(paths.logs, 'audit.jsonl'));
  // La réécriture du code suit le réglage code.validation, lu à chaque décision (changé par la parole ou les Réglages).
  heimdall.setValidationCode(() => cfg.code?.validation);
  // Intégrité du noyau avant chaque action engageante (un écart bloque jusqu'à ta décision).
  heimdall.verifierIntegrite();
  // Une réécriture activée qui n'a pas tenu (2e démarrage sans confirmation) : retour arrière automatique.
  try { const a = verifierActivation(paths.home); if (a.etat === 'defait') { heimdall.noter({ evenement: 'reecriture-defaite', lot: a.lot, fichiers: a.fichiers }); console.error(`[odin] réécriture ${a.lot} défaite automatiquement : Odin n'avait pas tenu après l'activation`); } } catch { /* jamais bloquant */ }
  // Le noyau (garde-fous) comparé à sa version de référence : un écart est journalisé et signalé au propriétaire (une
  // fois, par la passerelle) ; il ne bloque JAMAIS le démarrage, et Odin ne le restaure pas tout seul.
  // La référence est figée au démarrage ; son empreinte est comparée à la DERNIÈRE CONNUE, rangée hors du dossier du
  // code (une réécriture validée, une acceptation ou une mise à jour d'Odin la notent) : une référence refaite autrement
  // (une commande, à la main) est un écart signalé.
  try {
    figerReference();
    const connue = join(paths.home, 'noyau-reference-connue.txt'), actuelle = empreinteReference();
    if (actuelle) {
      if (!existsSync(connue)) writeFileSync(connue, actuelle, { mode: 0o600 });
      else if (readFileSync(connue, 'utf8').trim() !== actuelle) referenceChangee(true);
    }
  } catch { /* jamais bloquant */ }
  try { const v = verifierNoyau(); noterVerifNoyau(v); if (v.ecarts.length) { heimdall.noter({ evenement: 'noyau-ecart', ecarts: v.ecarts }); console.error(`[heimdall] garde-fou modifié hors de la version de référence : ${v.ecarts.map((e) => `${e.fichier} (${e.etat})`).join(', ')}`); } } catch { /* jamais bloquant */ }
  const tools = new ToolRegistry().register(...BUILTIN_TOOLS, ...NETWORK_TOOLS, ...FILE_TOOLS, ...AUDIO_TOOLS, ...BROWSER_TOOLS, webSearchTool, ...SELF_TOOLS, ...PROXMOX_TOOLS, netSecurity, ...HA_TOOLS, ...MAIL_TOOLS, ...CALENDAR_TOOLS, ...DOC_TOOLS, memoryProfile, changePlan, recoveryPlanTool, webResearch, evidenceSearch, ...VIDEO_TOOLS, ...APP_TOOLS, ...BRAIN_TOOLS, draupnirTool, ...RUNES_TOOLS, valhallaTool, notionTool, ...SCRIPT_TOOLS, skillImport, machineOnboard, adminEnable, ...ASSISTANT_TOOLS, ...HABIT_TOOLS, updateCheckTool, updateApplyTool, ...EVERYDAY_TOOLS, venusTool, parentalTool, alarmTool, routingHistory, pluginSaveTool(() => tools), ...settingsTools(() => ({ paths, cfg, heimdall })));
  // Cerveau : coffre Markdown (compatible Obsidian) prêt dès le démarrage ; anciennes fiches reprises.
  try { seedVault(brainOf({ home: paths.home, careCfg: cfg, workspace: paths.workspace }), join(paths.home, 'notes')); } catch (e) { console.error('[cerveau]', (e as Error).message); }
  // Extensions Python de ~/.odin/plugins : chacune devient un outil py_<nom>.
  try { const n = loadPlugins(paths.home, paths.workspace, tools); if (n.length) console.error(`[extensions] ${n.length} extension(s) Python : ${n.join(', ')}`); } catch (e) { console.error('[extensions]', (e as Error).message); }
  const inventory = new Inventory(muninn);

  // Aucun modèle de langue utilisable : la place du modèle est tenue par un fournisseur vide qui répond « pas encore »
  // (dans la langue réglée), sans réessai ni attente. Odin démarre quand même, en vrai (ce n'est pas une démonstration).
  let router: Router;
  if (opts.provider) router = new Router([{ provider: opts.provider, cfg: { kind: 'mock', model: 'mock' } }]);
  else {
    try { router = Router.fromConfig(cfg, [], paths); } catch (e) {
      if (!/Aucun fournisseur/.test((e as Error).message)) throw e;
      router = new Router([{ provider: fournisseurSansModele(cfg.voice?.stt?.language), cfg: { kind: 'mock', model: SANS_MODELE } }], 0);
    }
  }
  const modele: PorteModele = { pret: () => router.routes.some((r) => estUnModele(r.provider)) };
  const pret = modele.pret();
  if (pret) {
    router.onPause = (name, reason, until) => console.error(`[modèles] ${name} mis de côté jusqu'à ${new Date(until).toLocaleTimeString('fr-FR')} : ${reason}`);
    // Coûts rattachés à la vraie conversation (et plus à la finalité), journal de chaque appel.
    router.onUsage = (provider, tin, tout, cost, purpose) => muninn.recordUsage(routeContext()?.sessionId || purpose, provider, tin, tout, cost, purpose);
    router.onRoute = (e) => { try { muninn.recordRoute({ ...e, request: redactor.redact(e.request) }); } catch (x) { console.error('[routage]', (x as Error).message); } };
    // Budget mensuel : au-delà, seuls les modèles gratuits servent (voir Router.complete).
    router.overBudget = () => cfg.routing.monthlyBudgetUsd > 0 && muninn.monthCost() >= cfg.routing.monthlyBudgetUsd;
  }
  const cheapProvider = !opts.provider && pret && cfg.cheapProvider ? buildProvider(cfg.cheapProvider, process.env, paths) : undefined;
  // Classement des agents écrit : le routeur secondaire (résumés, réflexion, aides) suit le même classement ; un agent
  // non classé (le fournisseur « économique » compris) n'y reçoit rien. Sans classement : rien ne change.
  const classement = router.classement;
  const cheapRoutes = cheapProvider ? [{ provider: cheapProvider, cfg: cfg.cheapProvider! }, ...router.routes] : [];
  const cheapRouter = !cheapProvider ? undefined
    : classement ? new Router(cheapRoutes.filter((r) => classement.includes(idClassement(r))), 2, undefined, { classement })
      : new Router(cheapRoutes);
  if (cheapRouter) { cheapRouter.onUsage = router.onUsage; cheapRouter.onRoute = router.onRoute; cheapRouter.overBudget = router.overBudget; }

  // Mímir : le juge local d'Odin, seul (aucun modèle qui ne soit pas le sien). Une installation qui utilisait Jev, un
  // grand modèle, la cascade ou l'avis croisé repasse d'abord en autonomie « prudent », une fois, AVANT que le juge et
  // l'autonomie soient donnés à Heimdall (ci-dessous) : le juge local seul est parfois plus souple qu'eux. Sautée quand
  // l'appelant donne son juge ou réécrit la configuration en mémoire (essais seulement) : ce n'est pas la vraie.
  if (!opts.judge && !opts.configOverride) {
    try { plafonnerAutonomie({ paths, cfg, kv: muninn, noter: (e) => heimdall.noter(e) }); } catch (e) {
      // Jamais bloquant, et jamais plus souple : sans pouvoir décider, l'autonomie de ce démarrage est « prudent ».
      cfg.mimir = { ...cfg.mimir, autonomy: 'prudent' };
      console.error('[mímir] plafond d\'autonomie', (e as Error).message);
    }
    // Les questions gardées pour un modèle : rangées dans une note du Cerveau, seulement quand aucun modèle (ni celui
    // d'Odin, ni un agent connecté) n'est prêt à y répondre. Aucune clé, aucun fournisseur n'est touché.
    try {
      rangerQuestionsGardees({ paths, cfg, kv: muninn, pret, noter: (e) => heimdall.noter(e), masquer: (t) => redactor.redact(t), ranger: (titre, corps) => brainOf({ home: paths.home, careCfg: cfg, workspace: paths.workspace }).create(titre, 'note', corps, { fiable: false }) });
    } catch (e) { console.error('[modèles] questions gardées', (e as Error).message); }
  }
  let mimir: Mimir | undefined;
  if (opts.judge) mimir = new Mimir(opts.judge, cfg.mimir, 'test');
  else if (cfg.mimir.enabled) {
    const built = buildJudge(cfg.mimir, { redactor, logFile: join(paths.logs, 'mimir.jsonl') });
    if (built.warning) console.error(`[mímir] ${built.warning}`);
    mimir = new Mimir(built.judge, cfg.mimir, built.name);
  }
  heimdall.redactor = redactor;
  heimdall.setGrantStore({ find: (k) => muninn.findGrant(k), add: (k, t, e) => muninn.addGrant(k, t, e), touch: (id) => muninn.touchGrant(id) });
  // Habitudes : ce que tu acceptes toujours, Odin finit par le faire seul (jamais le grave).
  heimdall.setHabitStore({ trusted: (k) => trusted(muninn, k), touch: (k) => touchTrust(muninn, k), record: (k, tool, ex, yes) => { recordAnswer(muninn, k, tool, ex, yes); } });
  if (mimir?.cfg.uses.actionReview) {
    heimdall.setReviewer(async (g) => {
      const r = await mimir.reviewAction({ tool: g.tool, risk: g.risk, summary: g.summary, command: g.command, userRequest: g.userRequest ?? '', tainted: g.tainted });
      if (!r.ok) throw new Error(r.error);
      return { severity: r.value.severity, reason: r.value.reason, flags: r.value.flags, requested: r.value.requested, argent: r.value.argent };
    }, cfg.mimir.autonomy);
  }
  heimdall.setAutonomy(cfg.mimir.autonomy);
  heimdall.setBreaker(cfg.mimir.breaker);

  let persona = existsSync(paths.persona) ? readFileSync(paths.persona, 'utf8') : DEFAULT_PERSONA;
  // Ancienne consigne (« toute action… passe par la validation ») : elle faisait demander la permission en texte. Remplacée.
  const OLD_RULE = "  Toute action sur un appareil ou une mise à jour passe par la validation de l'utilisateur.";
  if (persona.includes(OLD_RULE)) {
    persona = persona.replace(OLD_RULE, "- Ce que l'utilisateur te demande, fais-le directement : Heimdall s'occupe des validations quand il le faut.");
    try { writeFileSync(paths.persona, persona); } catch { /* lecture seule : la consigne du code prime de toute façon */ }
  }
  // Odin, homme ou femme : les phrases toutes faites lisent le réglage en cours (il peut changer sans redémarrer).
  brancherGenre(() => cfg.voice.gender);
  // Plongements de la mémoire par Noûs (cerveau profond d'Odin), chargé à la demande au premier besoin ; tant que
  // Noûs n'est pas prêt, l'appel échoue proprement et la recherche par mots prend le relais (repli conservé).
  let embedder: Embedder | undefined;
  if (!opts.provider && cfg.memory?.semantic !== false) {
    // Le moteur de Noûs se recharge tout seul quand un nouveau point de reprise apparaît (src/brain/nous/plongement.ts).
    embedder = embedderQuiSeRecharge(paths.home);
  }
  // Sans modèle : Odin répond par ses actions directes, sa mémoire et Soul (offlineOnly), jamais par un écho.
  const agent = new Agent({ embedder, paths, cfg, router, cheapRouter, muninn, skills, tools, heimdall, redactor, workspace: paths.workspace, home: paths.home, persona, send: opts.send, inventory, mimir, offlineOnly: !pret });
  // Juste après le démarrage, EN ARRIÈRE-PLAN : lire les notes du Cerveau et construire son index de recherche, pour
  // que le premier message ne le paie pas. Une demande qui arrive avant ne fait que l'attendre (même travail).
  const prechauffe = setTimeout(() => { try { const v = brainOf({ home: paths.home, careCfg: cfg, workspace: paths.workspace }); v.all(); v.search('odin', 1); } catch { /* facultatif */ } }, 30);
  (prechauffe as { unref?: () => void }).unref?.();
  return { paths, cfg, agent, muninn, skills, heimdall, tools, inventory, mimir, redactor, modele, close: () => { closeBrowsers(); muninn.close(); } };
}
