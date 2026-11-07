// Outils communs aux tests : installation Odin jetable + fournisseur simulé.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalRequest, Approver } from '../src/heimdall/policy.ts';
import { MockProvider, type Script } from '../src/providers/mock.ts';
import { createOdin, type Odin } from '../src/runtime.ts';
import type { OdinConfig } from '../src/config.ts';
import type { Judge } from '../src/mimir/client.ts';

export interface TestOdin extends Odin {
  provider: MockProvider;
  approvals: ApprovalRequest[];
  cleanup(): void;
}

export function makeOdin(script: Script, opts: { approve?: boolean | 'always'; config?: (c: OdinConfig) => OdinConfig; judge?: Judge } = {}): TestOdin {
  const home = mkdtempSync(join(tmpdir(), 'odin-test-'));
  const provider = new MockProvider(script);
  const approvals: ApprovalRequest[] = [];
  const approver: Approver = { approve: async (r) => { approvals.push(r); return opts.approve ?? false; } };
  // Par défaut, les tests isolent la boucle de l'agent : Mímir n'est actif que si un juge est fourni.
  // L'observation (un appel de modèle en plus après chaque tour) est coupée sauf demande explicite.
  const configOverride = (c: OdinConfig) => {
    const quiet = { ...c, agent: { ...c.agent, review: false, verify: false }, learning: { ...c.learning, observe: false }, journal: { ...c.journal, enabled: false }, watch: { ...c.watch, enabled: false }, continuous: { ...c.continuous, enabled: false, autoResume: false }, quiet: { ...c.quiet, enabled: false }, veille: { enabled: false, at: '12:30' }, update: { auto: 'off' as const, everyHours: 6 } };
    const base = opts.judge ? quiet : { ...quiet, mimir: { ...quiet.mimir, enabled: false } };
    return opts.config ? opts.config(base) : base;
  };
  const odin = createOdin({ home, provider, approver, configOverride, judge: opts.judge });
  return { ...odin, provider, approvals, cleanup: () => { odin.close(); rmSync(home, { recursive: true, force: true }); } };
}

export const call = (name: string, input: Record<string, unknown>, id = `c_${Math.random().toString(36).slice(2, 8)}`) => ({ toolCalls: [{ id, name, input }] });
