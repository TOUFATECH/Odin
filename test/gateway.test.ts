import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { chunk } from '../src/bifrost/channel.ts';
import { call, makeOdin } from './helpers.ts';

class FakeChannel implements Channel {
  readonly name = 'fake';
  readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}

const msg = (peer: string, text: string): Inbound => ({ channel: 'fake', peer, name: peer, text });
const until = async (cond: () => boolean) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5)); };

test('inconnu : code d\'appairage, aucun appel au modèle ; une fois appairé, traité comme non fiable', async () => {
  const o = makeOdin([{ text: 'bonjour inconnu' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  await gw.handle(msg('stranger', 'salut'));
  assert.match(ch.sent[0].text, /Code d'appairage : [A-Z0-9]{8}/);
  assert.equal(o.provider.calls.length, 0);
  const code = ch.sent[0].text.match(/: ([A-Z0-9]{8})/)![1];
  o.muninn.approvePairing('fake', code);
  await gw.handle(msg('stranger', 'salut'));
  assert.match(o.provider.calls[0].messages[0].content, /<untrusted/);
  assert.equal(ch.sent.at(-1)!.text, 'bonjour inconnu');
  o.cleanup();
});

test('validation relayée au propriétaire : /yes débloque l\'action', async () => {
  const o = makeOdin([call('shell', { command: 'true' }), { text: 'commande lancée' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const turn = gw.handle(msg('boss', 'lance true'));
  await until(() => ch.sent.some((s) => s.text.includes('/yes')));
  const id = ch.sent.find((s) => s.text.includes('/yes'))!.text.match(/\/yes (\S+)/)![1];
  await gw.handle(msg('stranger', `/yes ${id}`));
  assert.match(ch.sent.at(-1)!.text, /Seul le propriétaire/);
  await gw.handle(msg('boss', `/yes ${id}`));
  await turn;
  assert.equal(ch.sent.at(-1)!.text, 'commande lancée');
  assert.match(o.provider.calls[1].messages.at(-1)!.content, /code de sortie : 0/);
  o.cleanup();
});

test('tâche planifiée : exécutée sans surveillance et livrée sur le canal', async () => {
  const o = makeOdin([call('send_message', { channel: 'fake', peer: 'x', text: 'spam' }), { text: 'Rapport du matin' }]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  o.muninn.addJob({ id: 'j1', cron: '0 7 * * *', prompt: 'fais le rapport', channel: 'fake', peer: 'boss', next_run: Date.now() - 1000 });
  await gw.tick();
  assert.match(ch.sent.at(-1)!.text, /⏰[\s\S]*Rapport du matin/);
  assert.ok(!ch.sent.some((s) => s.text === 'spam'), 'envoi externe refusé sans humain');
  assert.ok(o.muninn.listJobs()[0].next_run > Date.now(), 'prochaine exécution avancée');
  o.cleanup();
});

test('découpage des longs messages', () => {
  const parts = chunk('ligne\n'.repeat(2000), 3900);
  assert.ok(parts.every((p) => p.length <= 3900));
  assert.equal(parts.join('\n').replace(/\n+/g, '\n').trim(), 'ligne\n'.repeat(2000).replace(/\n+/g, '\n').trim());
});
