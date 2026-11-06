// Assemblage : construit un Odin complet à partir d'un dossier d'installation.
// Un seul point d'entrée pour la CLI, la passerelle, les tâches planifiées et les tests :
// tout le monde lit la MÊME configuration validée.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupRestore } from './backup.ts';
import { machineSecrets } from './machines/access.ts';
import { BROWSER_TOOLS, closeBrowsers } from './tools/browser.ts';
import { webSearchTool } from './tools/search.ts';
import { SELF_TOOLS } from './tools/self.ts';
import { makeEmbedder } from './muninn/embed.ts';
import { memoryProfile } from './tools/profile.ts';
import { changePlan, recoveryPlanTool } from './tools/careplan.ts';
import { evidenceSearch, webResearch } from './tools/research.ts';
import { VIDEO_TOOLS } from './tools/video.ts';
import { SCRIPT_TOOLS } from './tools/scripts.ts';
import { skillImport } from './tools/skillimport.ts';
import { sign as signContent, verify as verifyContent } from './scripts/guard.ts';
import { PROXMOX_TOOLS } from './tools/proxmox.ts';
import { HA_TOOLS } from './tools/homeassistant.ts';
import { MAIL_TOOLS } from './tools/mail.ts';
import { CALENDAR_TOOLS } from './tools/calendar.ts';
import { DOC_TOOLS } from './tools/docindex.ts';
import { netSecurity } from './tools/network.ts';
import { type OdinConfig, loadConfig, odinPaths, initHome, type OdinPaths, DEFAULT_PERSONA } from './config.ts';
import { Agent } from './core/agent.ts';
import { type Approver, denyAll, Heimdall } from './heimdall/policy.ts';
import { Redactor } from './heimdall/redact.ts';
import { Muninn } from './muninn/store.ts';
import { buildProvider, type Route, Router } from './providers/router.ts';
import { BUILTIN_TOOLS, ensureWorkspace } from './tools/builtin.ts';
import { ToolRegistry, type ToolContext } from './tools/registry.ts';
import type { Provider } from './types.ts';
import { Yggdrasil } from './yggdrasil/skills.ts';
import { Inventory } from './hlidskjalf/inventory.ts';
import { NETWORK_TOOLS } from './tools/network.ts';
import { adminEnable, machineOnboard } from './tools/onboard.ts';
import { ASSISTANT_TOOLS } from './tools/assistant.ts';
import { recordAnswer, touchTrust, trusted } from './learn/habits.ts';
import { HABIT_TOOLS } from './tools/habits.ts';
import { loadPlugins, pluginSaveTool } from './tools/plugins.ts';
import { FILE_TOOLS } from './tools/files.ts';
import type { Judge } from './mimir/client.ts';
import { buildJudge } from './mimir/factory.ts';
import { Mimir } from './mimir/decisions.ts';
import { loadEnvFile } from './settings.ts';

export interface Odin {
  paths: OdinPaths;
  cfg: OdinConfig;
  agent: Agent;
  muninn: Muninn;
  skills: Yggdrasil;
  heimdall: Heimdall;
  tools: ToolRegistry;
  inventory: Inventory;
  mimir?: Mimir;
  redactor: Redactor;
  /** Vrai quand Odin tourne sans vrai modèle (mode démo) : l'interface propose alors la configuration. */
  demo?: boolean;
  close(): void;
}

export interface CreateOptions {
  home?: string;
  approver?: Approver;
  /** Remplace les fournisseurs configurés (tests, mode démo). */
  provider?: Provider;
  send?: ToolContext['send'];
  configOverride?: (c: OdinConfig) => OdinConfig;
  /** Remplace le juge de Mímir (tests). */
  judge?: Judge;
}

export function createOdin(opts: CreateOptions = {}): Odin {
  const paths = odinPaths(opts.home);
  initHome(paths);
  try { cleanupRestore(paths); } catch { /* copies d'avant restauration : pas bloquant */ }
  loadEnvFile(paths); // clés enregistrées depuis l'interface web ou l'installateur
  let cfg = loadConfig(paths);
  if (opts.configOverride) cfg = opts.configOverride(cfg);
  ensureWorkspace(paths.workspace);

  const muninn = new Muninn(paths.db);
  const skills = new Yggdrasil(paths.skills, paths.drafts);
  skills.signer = { sign: (c) => signContent(paths.home, c), verify: (c, s) => verifyContent(paths.home, c, s) };
  const redactor = Redactor.fromEnv();
  // Les mots de passe des machines du réseau sont masqués partout (journal, réponses, sorties).
  for (const secret of machineSecrets(paths.home)) redactor.add(secret);
  const heimdall = new Heimdall(cfg.policy, opts.approver ?? denyAll, join(paths.logs, 'audit.jsonl'));
  const tools = new ToolRegistry().register(...BUILTIN_TOOLS, ...NETWORK_TOOLS, ...FILE_TOOLS, ...BROWSER_TOOLS, webSearchTool, ...SELF_TOOLS, ...PROXMOX_TOOLS, netSecurity, ...HA_TOOLS, ...MAIL_TOOLS, ...CALENDAR_TOOLS, ...DOC_TOOLS, memoryProfile, changePlan, recoveryPlanTool, webResearch, evidenceSearch, ...VIDEO_TOOLS, ...SCRIPT_TOOLS, skillImport, machineOnboard, adminEnable, ...ASSISTANT_TOOLS, ...HABIT_TOOLS, pluginSaveTool(() => tools));
  // Extensions Python de ~/.odin/plugins : chacune devient un outil py_<nom>.
  try { const n = loadPlugins(paths.home, paths.workspace, tools); if (n.length) console.error(`[extensions] ${n.length} extension(s) Python : ${n.join(', ')}`); } catch (e) { console.error('[extensions]', (e as Error).message); }
  const inventory = new Inventory(muninn.db);

  const fixed: Route[] = opts.provider ? [{ provider: opts.provider, cfg: { kind: 'mock', model: 'mock' } }] : [];
  const router = opts.provider ? new Router(fixed) : Router.fromConfig(cfg, [], paths);
  router.onPause = (name, reason, until) => console.error(`[modèles] ${name} mis de côté jusqu'à ${new Date(until).toLocaleTimeString('fr-FR')} : ${reason}`);
  router.onUsage = (provider, tin, tout, cost, purpose) => muninn.recordUsage(purpose, provider, tin, tout, cost, purpose);
  // Budget mensuel : au-delà, seuls les modèles gratuits servent (voir Router.complete).
  router.overBudget = () => cfg.routing.monthlyBudgetUsd > 0 && muninn.monthCost() >= cfg.routing.monthlyBudgetUsd;
  const cheapProvider = !opts.provider && cfg.cheapProvider ? buildProvider(cfg.cheapProvider, process.env, paths) : undefined;
  const cheapRouter = cheapProvider ? new Router([{ provider: cheapProvider, cfg: cfg.cheapProvider! }, ...router.routes]) : undefined;

  // Mímir : juge local sans clé par défaut ; Jev, modèle ou cascade selon mimir.judge.
  let mimir: Mimir | undefined;
  if (opts.judge) mimir = new Mimir(opts.judge, cfg.mimir, 'test');
  else if (cfg.mimir.enabled) {
    const built = buildJudge(cfg.mimir, {
      router, cheapRouter, redactor, logFile: join(paths.logs, 'mimir.jsonl'), crossCheck: cfg.routing.crossCheckRisky,
      onUsage: (tin, tout, cost) => muninn.recordUsage('juge', 'jev', tin, tout, cost, 'juge'),
    });
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
      return { severity: r.value.severity, reason: r.value.reason, flags: r.value.flags, requested: r.value.requested };
    }, cfg.mimir.autonomy);
  }
  heimdall.setAutonomy(cfg.mimir.autonomy);
  heimdall.setBreaker(cfg.mimir.breaker);

  const persona = existsSync(paths.persona) ? readFileSync(paths.persona, 'utf8') : DEFAULT_PERSONA;
  const embedder = opts.provider ? undefined : makeEmbedder(cfg);
  const agent = new Agent({ embedder, paths, cfg, router, cheapRouter, muninn, skills, tools, heimdall, redactor, workspace: paths.workspace, home: paths.home, persona, send: opts.send, inventory, mimir });
  return { paths, cfg, agent, muninn, skills, heimdall, tools, inventory, mimir, redactor, close: () => { closeBrowsers(); muninn.close(); } };
}
