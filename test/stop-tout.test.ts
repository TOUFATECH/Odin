// S7 (U4) — « Stop » arrête tout : les conversations en cours, les tâches de fond (travail continu, tâches planifiées…),
// et met l'initiative en pause jusqu'à « reprends » ; un membre n'arrête que sa conversation ; tracé au journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { makeOdin } from './helpers.ts';

class FakeChannel implements Channel {
  readonly name = 'fake';
  readonly interactive = true;
  sent: Array<{ peer: string; text: string }> = [];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(peer: string, text: string) { this.sent.push({ peer, text }); }
  async stop() {}
}
const msg = (peer: string, text: string): Inbound => ({ channel: 'fake', peer, name: peer, text });

test('« stop » du propriétaire : une conversation longue ET une tâche de fond s\'arrêtent en moins de 2 s ; plus d\'initiative avant « reprends »', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const g = gw as unknown as { aborts: Map<string, AbortController>; signalFond(): AbortSignal };
  const conv = new AbortController(); g.aborts.set('fake:autre', conv);
  const fond = g.signalFond();
  const t0 = Date.now();
  await gw.handle(msg('boss', 'stop'));
  assert.ok(conv.signal.aborted, 'conversation arrêtée'); assert.ok(fond.aborted, 'tâche de fond arrêtée');
  assert.ok(Date.now() - t0 < 2000);
  assert.match(ch.sent.at(-1)!.text, /Tout est arrêté/);
  assert.equal(gw.initiativeEnPause(), true);
  assert.equal(await gw.continuous(Date.now(), true), undefined, 'le travail continu ne démarre pas');
  assert.equal(await gw.breakerRoutines(Date.now()), 0);
  const audit = join(o.paths.logs, 'audit.jsonl');
  if (existsSync(audit)) assert.match(readFileSync(audit, 'utf8'), /"evenement":"stop"/);
  await gw.handle(msg('boss', 'reprends'));
  assert.equal(gw.initiativeEnPause(), false); assert.match(ch.sent.at(-1)!.text, /Je reprends/);
  o.cleanup();
});

test('un membre (ou un autre) n\'arrête que sa conversation ; l\'initiative continue', async () => {
  const o = makeOdin([]);
  const ch = new FakeChannel();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const g = gw as unknown as { aborts: Map<string, AbortController> };
  const proprio = new AbortController(); g.aborts.set('fake:boss', proprio);
  const sienne = new AbortController(); g.aborts.set('fake:nour', sienne);
  o.muninn.approvePairing?.('fake', o.muninn.requestPairing('fake', 'nour', 'nour'));
  await gw.handle(msg('nour', '/stop'));
  assert.ok(sienne.signal.aborted); assert.equal(proprio.signal.aborted, false);
  assert.equal(gw.initiativeEnPause(), false);
  o.cleanup();
});
