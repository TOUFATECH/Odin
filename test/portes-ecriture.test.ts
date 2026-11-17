// Lot S, portes restantes : la tâche planifiée « script » passe par Heimdall (executer.ts) comme tout outil ;
// doc_create et media_convert suivent la règle des chemins de S1 (dossier d'Odin, noyau, données du noyau).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Heimdall, type ApprovalRequest, type GateInput } from '../src/heimdall/policy.ts';
import { cheminsCodeDe, deciderPuisLancer } from '../src/heimdall/executer.ts';
import { RACINE_APPLI } from '../src/heimdall/noyau.ts';
import { docCreate } from '../src/tools/files.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { makeOdin } from './helpers.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const ctx = { workspace: tmpdir(), fullAccess: true, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never;

test('doc_create et media_convert dans le dossier d\'Odin : même règle que self_edit (le noyau toujours validé, même avec « jamais »)', async () => {
  const norm = (a: string[]) => a.map((x) => x.replace(/\\/g, '/'));
  assert.deepEqual(norm(cheminsCodeDe('doc_create', { path: join(RACINE_APPLI, 'src', 'heimdall', 'policy.ts') }, ctx)), ['src/heimdall/policy.ts']);
  assert.deepEqual(norm(cheminsCodeDe('media_convert', { input: join(tmpdir(), 'a.wav'), output: join(RACINE_APPLI, 'src', 'vault.ts') }, ctx)), ['src/vault.ts']);
  assert.deepEqual(cheminsCodeDe('doc_create', { path: join(tmpdir(), 'rapport.pdf') }, ctx), [], 'ailleurs : pas une réécriture');
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  h.setAutonomy('breaker'); h.setValidationCode(() => 'jamais');
  const r = await deciderPuisLancer(h, docCreate, { path: join(RACINE_APPLI, 'src', 'heimdall', 'policy.ts'), content: 'x' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(r.decision.allowed, false); assert.equal(r.lancer, undefined); assert.match(demandes[0].reason, /garde-fou d'Odin/);
});

test('doc_create ne peut pas écrire les données du noyau (configuration)', async () => {
  const d = mkdtempSync(join(tmpdir(), 'portes-')); dossiers.push(d);
  mkdirSync(join(d, '.odin'), { recursive: true });
  await assert.rejects(() => Promise.resolve(docCreate.run({ path: join(d, '.odin', 'config.json'), content: 'x' }, ctx)), /Donnée des garde-fous/);
  assert.equal(existsSync(join(d, '.odin', 'config.json')), false);
});

class FakeChannel implements Channel {
  readonly name = 'fake'; readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}

test('la tâche planifiée « script » passe par Heimdall (sans surveillance, au nom de la tâche que tu as programmée)', async () => {
  const o = makeOdin([]);
  const vus: GateInput[] = [];
  const gate = o.heimdall.gate.bind(o.heimdall);
  o.heimdall.gate = async (g: GateInput) => { vus.push(g); return gate(g); };
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(new FakeChannel());
  o.muninn.addJob({ id: 'js1', cron: '0 7 * * *', prompt: '!script {"name":"inexistant","args":"","where":"local","report":false}', channel: 'fake', peer: 'boss', next_run: Date.now() - 1000 });
  await gw.tick();
  const g = vus.find((x) => x.tool === 'script_run');
  assert.ok(g, 'Heimdall a décidé'); assert.equal(g!.unattended, true); assert.equal(g!.sessionId, 'cron:js1');
  o.cleanup();
});
