// S8 (U6) — Aucun secret en clair : une clé collée est retirée AVANT l'enregistrement et le modèle, rangée au coffre,
// et Odin le dit ; dans un mail lu, un code à usage unique ou un lien de réinitialisation est masqué.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { makeOdin } from './helpers.ts';
import { extraireCles, masquerCodes } from '../src/heimdall/redact.ts';
import { Heimdall } from '../src/heimdall/policy.ts';
import { deciderPuisLancer } from '../src/heimdall/executer.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

class FakeChannel implements Channel {
  readonly name = 'fake';
  readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}
const CLE = 'sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

test('coller une clé : ni l\'historique ni le message envoyé au modèle ne la contiennent ; rangée au coffre ; Odin le dit', async () => {
  const o = makeOdin([{ text: 'noté' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  await gw.handle({ channel: 'fake', peer: 'boss', name: 'boss', text: `voici ma clé OpenAI ${CLE} garde-la` });
  assert.ok(o.provider.calls.length >= 1);
  assert.doesNotMatch(JSON.stringify(o.provider.calls), new RegExp(CLE));
  const hist = o.muninn.history('fake:boss').map((x) => x.content).join('\n');
  assert.doesNotMatch(hist, new RegExp(CLE)); assert.match(hist, /\[clé mise au coffre\]/);
  assert.ok(ch.sent.some((x) => /au coffre.*Change-la si elle a circulé/.test(x.text)));
  assert.ok(readdirSync(o.paths.home).some((f) => f.startsWith('secrets-cles-recues.json')), 'rangée (chiffrée) au coffre');
  assert.equal(o.redactor.redact(`x ${CLE}`), 'x [SECRET]');
  o.cleanup();
});

test('un mail « Votre code : 482913 » : mail_read ne montre pas 482913 ; un lien de réinitialisation non plus ; le reste ne change pas', async () => {
  const h = new Heimdall(DEFAULT_CONFIG.policy, { approve: async () => true });
  const mailRead = { name: 'mail_read', description: '', risk: 'read' as const, schema: { type: 'object', properties: {} }, async run() { return 'De : banque\nVotre code de connexion : 482913\nRéinitialiser : https://banque.fr/reset?token=abc\nRendez-vous le 12/11 à 14 h, 49,90 €.'; } } as never;
  const r = await deciderPuisLancer(h, mailRead, {}, { workspace: tmpdir(), sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never, { sessionId: 's', tainted: false });
  const out = String(await r.lancer!());
  assert.doesNotMatch(out, /482913/); assert.match(out, /code de connexion reçu — masqué/);
  assert.doesNotMatch(out, /token=abc/);
  assert.match(out, /Rendez-vous le 12\/11 à 14 h, 49,90 €/);
  assert.equal(masquerCodes('Le marché ouvre à 6 h'), 'Le marché ouvre à 6 h');
  assert.deepEqual(extraireCles('rien de secret ici').cles, []);
});
