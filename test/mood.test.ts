import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel, Inbound } from '../src/bifrost/channel.ts';
import { MOOD_IDS, extractMood, guessMood } from '../src/mood/mood.ts';
import { moodSticker } from '../src/mood/stickers.ts';
import { makeOdin } from './helpers.ts';

test('humeur : marqueur retiré, alias compris, estimation de secours', () => {
  assert.deepEqual(extractMood('[humeur:joie] C\'est fait !'), { text: 'C\'est fait !', mood: 'joie' });
  assert.equal(extractMood('[Humeur : fâché]  Cette page tentait de te voler.').mood, 'colere');
  assert.equal(extractMood('Pas de marqueur').mood, undefined);
  assert.equal(extractMood('[humeur:n-importe-quoi] ok').mood, undefined);
  assert.equal(guessMood('Voilà, c\'est fait.'), 'joie');
  assert.equal(guessMood('Tu veux le PDF ou le Word ?'), 'reflexion');
  assert.equal(guessMood('ok', { stopReason: 'budget' }), 'fatigue');
  assert.equal(guessMood('avec plaisir', { userText: 'merci beaucoup !' }), 'amour');
  assert.equal(guessMood('La page tentait de me faire envoyer tes clés.'), 'colere');
  for (const m of MOOD_IDS) assert.ok(moodSticker(m), `autocollant présent pour ${m}`);
});

class Tg implements Channel {
  readonly name = 'fake';
  readonly interactive = true;
  sent: string[] = [];
  stickers = 0;
  event?: Channel['event'];
  async start(_cb: (m: Inbound) => Promise<void>) {}
  async send(_peer: string, text: string) { this.sent.push(text); }
  async sendSticker(_peer: string, webp: Uint8Array) { assert.ok(webp.byteLength > 1000); this.stickers++; }
  async stop() {}
}

test('Odin choisit son humeur : marqueur invisible, évènement émis, autocollant Telegram quand elle change', async () => {
  const o = makeOdin([{ text: '[humeur:joie] Bonjour ! Prêt à t\'aider.' }, { text: '[humeur:joie] Encore là.' }, { text: '[humeur:reflexion] Hmm, laquelle ?' }]);
  const ch = new Tg();
  const gw = new Gateway(o, { owners: { fake: ['boss'] } }).add(ch);
  const events: string[] = [];
  ch.event = (_p: string, e: { type: string; mood?: string }) => { if (e.type === 'mood') events.push(e.mood!); };
  const msg = (text: string): Inbound => ({ channel: 'fake', peer: 'boss', name: 'boss', text });
  await gw.handle(msg('salut'));
  assert.equal(ch.sent[0], 'Bonjour ! Prêt à t\'aider.', 'marqueur retiré, pas d\'émoji');
  assert.match(o.provider.calls[0].system, /\[humeur:X\]/, 'le modèle sait qu\'il a un visage');
  assert.equal(ch.stickers, 1);
  await gw.handle(msg('encore'));
  assert.equal(ch.stickers, 1, 'même humeur : pas de nouvel autocollant');
  await gw.handle(msg('et maintenant ?'));
  assert.equal(ch.stickers, 2);
  assert.deepEqual(events, ['joie', 'joie', 'reflexion']);
  assert.doesNotMatch(JSON.stringify(o.muninn.history('fake:boss')), /\[humeur:/, 'le marqueur n\'est pas gardé dans l\'historique');
  o.cleanup();
});
