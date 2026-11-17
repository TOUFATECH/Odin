// Outils communs aux tests : installation Odin jetable + fournisseur simulé.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApprovalRequest, Approver } from '../src/heimdall/policy.ts';
import { MockProvider, type Script } from '../src/providers/mock.ts';
import { createOdin, type Odin } from '../src/runtime.ts';
import type { OdinConfig } from '../src/config.ts';
import type { Judge } from '../src/mimir/client.ts';
import { verifierNoyau } from '../src/heimdall/noyau.ts';
import { definirDecouverteParDefaut } from '../src/hlidskjalf/scan.ts';

// Aucun essai ne balaie le VRAI réseau de la machine : sans découverte donnée par l'essai (option `discover` de la
// passerelle), un balayage ne trouve rien. Sinon une ronde d'Odin Breaker sondait tout le réseau de la maison pendant
// les essais, et sa durée dépendait des appareils allumés ce jour-là.
definirDecouverteParDefaut(async () => ({ subnets: [], found: [] }));

// Pendant les essais, Odin n'installe jamais la voix locale tout seul (compilation de Whisper, 500 Mo téléchargés
// dans le vrai dossier de la machine) : un vocal sans rien de prêt reçoit une phrase claire, tout de suite.
process.env.ODIN_NO_VOICE_INSTALL ??= '1';

// Garde-fou des dossiers réels : un essai qui oublierait de donner un dossier d'Odin ne tombe jamais sur le vrai
// (~/.odin, par odinPaths() et les autres valeurs par défaut) : sans ODIN_HOME (ou vide), il en reçoit un jetable,
// retiré à la fin. Le coffre et l'auto-modification refusent de toute façon le vrai dossier sous essai (src/vault.ts).
if (!process.env.ODIN_HOME?.trim()) {
  const jetable = mkdtempSync(join(tmpdir(), 'odin-essai-home-'));
  process.env.ODIN_HOME = jetable;
  process.on('exit', () => { try { rmSync(jetable, { recursive: true, force: true }); } catch { /* tant pis : dossier temporaire */ } });
}

export interface TestOdin extends Odin {
  provider: MockProvider;
  approvals: ApprovalRequest[];
  cleanup(): void;
}

export function makeOdin(script: Script, opts: { approve?: boolean | 'always'; config?: (c: OdinConfig) => OdinConfig; judge?: Judge } = {}): TestOdin {
  // Un Odin d'essai bloque toute action engageante si un garde-fou diffère de sa référence : on le dit clairement ici,
  // plutôt que de laisser l'essai échouer plus loin avec un message qui parle d'autre chose.
  const ecarts = verifierNoyau().ecarts;
  if (ecarts.length) throw new Error(`La référence du noyau est périmée (${ecarts.map((e) => e.fichier).join(', ')}) : lance « npm run noyau:empreintes » avant les essais.`);
  const home = mkdtempSync(join(tmpdir(), 'odin-test-'));
  const provider = new MockProvider(script);
  const approvals: ApprovalRequest[] = [];
  const approver: Approver = { approve: async (r) => { approvals.push(r); return opts.approve ?? false; } };
  // Par défaut, les tests isolent la boucle de l'agent : Mímir n'est actif que si un juge est fourni.
  // L'observation (un appel de modèle en plus après chaque tour) est coupée sauf demande explicite.
  const configOverride = (c: OdinConfig) => {
    const quiet = { ...c, agent: { ...c.agent, review: false, verify: false }, learning: { ...c.learning, observe: false }, journal: { ...c.journal, enabled: false }, watch: { ...c.watch, enabled: false }, continuous: { ...c.continuous, enabled: false, autoResume: false }, quiet: { ...c.quiet, enabled: false }, veille: { enabled: false, at: '12:30' }, update: { auto: 'off' as const, everyHours: 6 }, web: { ...c.web, portsParAppli: false } };
    const base = opts.judge ? quiet : { ...quiet, mimir: { ...quiet.mimir, enabled: false } };
    return opts.config ? opts.config(base) : base;
  };
  const odin = createOdin({ home, provider, approver, configOverride, judge: opts.judge });
  return { ...odin, provider, approvals, cleanup: () => { odin.close(); rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); } }; // un navigateur de test peut encore écrire dans son profil une fraction de seconde
}

export const call = (name: string, input: Record<string, unknown>, id = `c_${Math.random().toString(36).slice(2, 8)}`) => ({ toolCalls: [{ id, name, input }] });

/** Un faux moteur de conteneurs (Hringhorni) pour les essais : les conteneurs donnés, chaque commande notée « odin <verbe> <nom> ». */
export function fakeEngine(list: Array<{ Names: string; Image: string; State: string }>, log: (cmd: string) => void = () => {}): import('../src/valhalla/modules/naglfar.ts').EngineLike {
  type C = import('../src/valhalla/hringhorni/engine.ts').Ctr;
  const ctrs: C[] = list.map((x, i) => ({ id: `${String(i).padStart(2, '0')}${'a'.repeat(62)}`, spec: { id: `${i}`, name: x.Names, image: x.Image, imageId: 'i', cmd: [], env: {}, workdir: '/', user: '', ports: [], mounts: [], restart: 'non', hostname: x.Names, network: 'hote', autoRemove: false, created: new Date(2026, 0, 1 + i).toISOString(), labels: {} }, state: { status: x.State === 'running' ? 'en marche' : 'sorti' } }));
  const find = (n: string) => { const c = ctrs.find((x) => x.spec.name === n); if (!c) throw new Error(`conteneur inconnu : ${n}`); return c; };
  const set = (n: string, status: C['state']['status'], verb: string) => { log(`odin ${verb} ${n}`); const c = find(n); c.state = { ...c.state, status }; return c; };
  return {
    ps: (all = false) => ctrs.filter((c) => all || c.state.status === 'en marche'), find,
    start: async (n: string) => set(n, 'en marche', 'start'), stop: async (n: string) => set(n, 'arrêté', 'stop'), restart: async (n: string) => set(n, 'en marche', 'restart'),
    rm: async (n: string) => { log(`odin rm ${n}`); const c = find(n); ctrs.splice(ctrs.indexOf(c), 1); return c.spec; },
    run: async (o: { image: string; name?: string }) => { log(`odin run ${o.name ?? ''} ${o.image}`.replace(/\s+/g, ' ')); const c: C = { ...ctrs[0], spec: { ...ctrs[0].spec, name: o.name ?? 'dk-x-01', image: o.image }, state: { status: 'en marche' } }; ctrs.push(c); return c; },
    logs: (n: string) => { find(n); return [{ at: '', stream: 'o' as const, text: 'prêt' }]; },
    images: () => [], findImage: () => undefined, pull: async (n: string) => { log(`odin pull ${n}`); return { id: 'b'.repeat(64), names: [n], digest: '', config: {}, configDigest: '', layers: [], size: 1e6, pulled: '' }; },
    rmi: async (n: string) => { log(`odin rmi ${n}`); return { id: 'b'.repeat(64), names: [n], digest: '', config: {}, configDigest: '', layers: [], size: 0, pulled: '' }; },
    execArgs: async (n: string, argv: string[]) => { log(`odin exec ${n} ${argv.join(' ')}`); return { cmd: 'echo', args: argv, env: {} }; },
    inspect: (n: string) => ({ name: n }),
    jobs: () => [],
    runJob: (o: { image: string; name?: string }) => { log(`odin run ${o.name ?? ''} ${o.image}`.replace(/\s+/g, ' ')); return { id: 'j1', kind: 'installer', image: o.image, phase: 'attente', pct: 0, done: 0, total: 0, note: '', started: '' }; },
    pullJob: (n: string) => { log(`odin pull ${n}`); return { id: 'j2', kind: 'récupérer', image: n, phase: 'attente', pct: 0, done: 0, total: 0, note: '', started: '' }; },
    startJob: () => ({ id: 'j3', kind: 'mettre à jour', image: '', phase: 'attente', pct: 0, done: 0, total: 0, note: '', started: '' }),
  } as unknown as import('../src/valhalla/modules/naglfar.ts').EngineLike;
}
