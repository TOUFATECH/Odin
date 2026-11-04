// Assemblage : construit un Odin complet à partir d'un dossier d'installation.
// Un seul point d'entrée pour la CLI, la passerelle, les tâches planifiées et les tests :
// tout le monde lit la MÊME configuration validée.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  loadEnvFile(paths); // clés enregistrées depuis l'interface web ou l'installateur
  let cfg = loadConfig(paths);
  if (opts.configOverride) cfg = opts.configOverride(cfg);
  ensureWorkspace(paths.workspace);

  const muninn = new Muninn(paths.db);
  const skills = new Yggdrasil(paths.skills, paths.drafts);
  const redactor = Redactor.fromEnv();
  const heimdall = new Heimdall(cfg.policy, opts.approver ?? denyAll, join(paths.logs, 'audit.jsonl'));
  const tools = new ToolRegistry().register(...BUILTIN_TOOLS, ...NETWORK_TOOLS);
  const inventory = new Inventory(muninn.db);

  const fixed: Route[] = opts.provider ? [{ provider: opts.provider, cfg: { kind: 'mock', model: 'mock' } }] : [];
  const router = opts.provider ? new Router(fixed) : Router.fromConfig(cfg);
  const cheapProvider = !opts.provider && cfg.cheapProvider ? buildProvider(cfg.cheapProvider) : undefined;
  const cheapRouter = cheapProvider ? new Router([{ provider: cheapProvider, cfg: cfg.cheapProvider! }, ...router.routes]) : undefined;

  // Mímir : juge local sans clé par défaut ; Jev, modèle ou cascade selon mimir.judge.
  let mimir: Mimir | undefined;
  if (opts.judge) mimir = new Mimir(opts.judge, cfg.mimir, 'test');
  else if (cfg.mimir.enabled) {
    const built = buildJudge(cfg.mimir, {
      router, cheapRouter, redactor, logFile: join(paths.logs, 'mimir.jsonl'),
      onUsage: (tin, tout, cost) => muninn.recordUsage('mimir', 'jev', tin, tout, cost),
    });
    if (built.warning) console.error(`[mímir] ${built.warning}`);
    mimir = new Mimir(built.judge, cfg.mimir, built.name);
  }
  heimdall.setGrantStore({ find: (k) => muninn.findGrant(k), add: (k, t, e) => muninn.addGrant(k, t, e), touch: (id) => muninn.touchGrant(id) });
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
  const agent = new Agent({ cfg, router, cheapRouter, muninn, skills, tools, heimdall, redactor, workspace: paths.workspace, persona, send: opts.send, inventory, mimir });
  return { paths, cfg, agent, muninn, skills, heimdall, tools, inventory, mimir, redactor, close: () => muninn.close() };
}
