// Relecture du lot S, constats moyens et petits (8, 9, 11, 12, 13, 15) : chacun avec son essai.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Heimdall, type ApprovalRequest } from '../src/heimdall/policy.ts';
import { cheminsCodeDe, deciderPuisLancer } from '../src/heimdall/executer.ts';
import { extraireCles, masquerCodes } from '../src/heimdall/redact.ts';
import { selfAcceptCore } from '../src/tools/self.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { makeOdin } from './helpers.ts';

const dossiers: string[] = [];
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
function odin() {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  h.setAutonomy('breaker'); h.setValidationCode(() => 'jamais');
  return { h, demandes };
}

test('constat 8 : « accepter cette version » après une page lue est refusé sans question ; la demande montre les fichiers en écart', async () => {
  const { h, demandes } = odin();
  const d = await h.gate({ tool: 'self_accept_core', risk: 'exec', summary: 'accepter', sessionId: 's', tainted: true, grave: selfAcceptCore.grave!({}) });
  assert.equal(d.allowed, false); assert.equal(demandes.length, 0);
  assert.match(selfAcceptCore.grave!({}) ?? '', /^accepter la version actuelle des garde-fous d'Odin comme référence( \(aucun écart\)|\nFichiers en écart)/);
});

class FakeChannel implements Channel {
  readonly name = 'fake'; readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}
test('constat 9 (et relecture 2, constat 8) : après « stop », une tâche échue ne démarre pas ; à « reprends », elle est reportée à sa prochaine heure et c\'est dit', async () => {
  const o = makeOdin([{ text: 'rapport fait' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'stop' });
  o.muninn.addJob({ id: 'jp', cron: '0 7 * * *', prompt: 'fais le rapport', channel: 'fake', peer: 'boss', next_run: Date.now() - 1000 });
  await gw.tick();
  assert.equal(o.provider.calls.length, 0, 'la tâche n\'a pas tourné');
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: 'reprends' });
  await gw.tick();
  assert.equal(o.provider.calls.length, 0, 'à « reprends », la tâche manquée ne part pas d\'un coup');
  assert.match(ch.sent.at(-1)!.text, /Tâches sautées pendant la pause \(reprises à leur prochaine heure\) : fais le rapport/);
  assert.ok(o.muninn.listJobs()[0].next_run > Date.now(), 'reportée à sa prochaine échéance');
  o.cleanup();
});

test('constat 11 : un retour arrière qui touche le noyau suit la règle du code (validation, même avec « jamais »)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rollback-')); dossiers.push(home);
  mkdirSync(join(home, 'self-backups'), { recursive: true });
  writeFileSync(join(home, 'self-backups', 'journal.json'), JSON.stringify([{ id: 'lot-1', at: '', files: ['src/heimdall/policy.ts'] }]));
  const ctx = { workspace: tmpdir(), fullAccess: true, home, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never;
  assert.deepEqual(cheminsCodeDe('self_rollback', {}, ctx).map((x) => x.replace(/\\/g, '/')), ['src/heimdall/policy.ts']);
  const { h, demandes } = odin();
  const rb = { name: 'self_rollback', description: '', risk: 'write' as const, schema: { type: 'object', properties: {} }, async run() { return 'restauré'; } } as never;
  const r = await deciderPuisLancer(h, rb, {}, ctx, { sessionId: 's', tainted: false });
  assert.equal(r.decision.allowed, false); assert.match(demandes[0].reason, /garde-fou d'Odin/);
});

test('constats 12 et 13 : pas de fausse clé dans une adresse ordinaire ; code postal et numéro de commande gardés, vrai code masqué', () => {
  assert.deepEqual(extraireCles('https://exemple.fr/desk-booking-system-overview-2025').cles, []);
  assert.deepEqual(extraireCles('le document risk-management-framework-version-finale').cles, []);
  assert.equal(extraireCles('ma clé sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789').cles.length, 1, 'une vraie clé reste reconnue');
  assert.equal(masquerCodes('Livraison : code postal 75011'), 'Livraison : code postal 75011');
  assert.equal(masquerCodes('Confirmation de votre commande n° 482913'), 'Confirmation de votre commande n° 482913');
  assert.doesNotMatch(masquerCodes('Votre code de vérification : 482913'), /482913/);
  assert.doesNotMatch(masquerCodes('Your one-time login code is 731905'), /731905/);
});

test('constat 15 : changer un réglage après une page lue est refusé tout de suite, sans te poser une question inutile', async () => {
  const { h, demandes } = odin();
  const d = await h.gate({ tool: 'settings_set', risk: 'exec', summary: 'régler autonomie', sessionId: 's', tainted: true, grave: 'me laisser agir seul davantage' });
  assert.equal(d.allowed, false); assert.equal(demandes.length, 0);
});
