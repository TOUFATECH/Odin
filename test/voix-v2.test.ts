// Voix v2 : 100 % local par défaut, réponse en voix ou en texte, réglages vérifiés, commandes à l'oral,
// export et suppression des conversations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { deleteConvCommand, replyModeCommand } from '../src/bifrost/gateway.ts';
import { exportConversations } from '../src/muninn/export.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { voiceOptions } from '../src/settings.ts';
import { pronounce, sttReady, ttsIsLocal } from '../src/voice/voice.ts';

test('par défaut, la voix reste sur la machine (whisper.cpp + Piper), aucune clé en ligne utilisée', () => {
  const v = DEFAULT_CONFIG.voice;
  assert.equal(v.localOnly, true); assert.equal(v.tts.provider, 'piper'); assert.equal(v.tts.baseUrl, 'local');
  assert.ok(ttsIsLocal(v));
  // Même avec une clé OpenAI présente, la transcription ne passe pas par Internet.
  assert.equal(sttReady({ ...v }, { OPENAI_API_KEY: 'sk-test' }), sttReady({ ...v }, {}));
});

test('réglages vocaux : valeurs vérifiées, mode texte coupe la lecture et les notes vocales', () => {
  const v = DEFAULT_CONFIG.voice;
  const o = voiceOptions({ replyMode: 'texte', listen: { sensitivity: 8, wakeWord: ' Odin ' }, interrupt: { stopWords: 'stop, chut' }, speech: { rate: 1.2, pronunciations: { Mnémosyne: 'Mou-ninne' } } }, v);
  assert.equal(o.replyMode, 'texte'); assert.equal(o.speakReplies, false); assert.equal(o.voiceReplies, false);
  assert.equal(o.listen.sensitivity, 8); assert.equal(o.listen.wakeWord, 'Odin');
  assert.deepEqual(o.interrupt.stopWords, ['stop', 'chut']);
  assert.equal(o.speech.rate, 1.2);
  assert.equal(voiceOptions({ replyMode: 'voix' }, { ...v, ...o }).voiceReplies, true, 'retour à la voix : notes vocales remises');
  assert.throws(() => voiceOptions({ speech: { rate: 3 } }, v), /vitesse/);
  assert.throws(() => voiceOptions({ replyMode: 'chanson' }, v), /voix ou texte/);
  assert.throws(() => voiceOptions({ brain: 'magie' }, v), /auto ou sans-ia/);
});

test('prononciation : mot entier, sans tenir compte des majuscules', () => {
  assert.equal(pronounce('Muninn et MUNINN, pas Muninnette', { muninn: 'Mou-ninne' }), 'Mou-ninne et Mou-ninne, pas Muninnette');
});

test('commandes à l\'oral : « réponds par écrit », « parle-moi », sans confondre avec une vraie demande', () => {
  assert.equal(replyModeCommand('Réponds par écrit.'), 'texte');
  assert.equal(replyModeCommand('Odin, réponds-moi par écrit désormais'), 'texte');
  assert.equal(replyModeCommand('Parle-moi'), 'voix');
  assert.equal(replyModeCommand('réponds-moi à voix haute'), 'voix');
  assert.equal(replyModeCommand('Parle-moi de Docker'), undefined);
  assert.equal(replyModeCommand('Réponds par écrit à Mariam que je suis en retard'), undefined);
  assert.ok(deleteConvCommand('Supprime cette conversation'));
  assert.ok(!deleteConvCommand('Supprime cette conversation avec le plombier dans mes mails'));
});

test('export : Markdown lisible, JSON complet, une conversation ou tout', () => {
  const m = new Mnemosyne(':memory:');
  m.ensureSession('web:a', 'web', 'a'); m.setSessionTitle('web:a', 'Projet Athena');
  m.addMessage('web:a', { role: 'user', content: 'Où en est Athena ?' });
  m.addMessage('web:a', { role: 'tool', content: 'sortie brute', toolName: 'fs_read', toolCallId: 'x' });
  m.addMessage('web:a', { role: 'assistant', content: 'Il reste la page de suivi.' });
  m.ensureSession('web:b', 'web', 'b'); m.addMessage('web:b', { role: 'user', content: 'Bonjour' });
  const md = exportConversations(m, { sessions: ['web:a'] });
  assert.match(md.body, /## Projet Athena/); assert.match(md.body, /\*\*Toi\*\*/); assert.match(md.body, /\*\*Odin\*\*/);
  assert.doesNotMatch(md.body, /sortie brute/, 'les sorties d\'outils seulement sur demande');
  assert.match(md.filename, /^Projet_Athena-\d{4}-\d{2}-\d{2}\.md$/);
  const js = JSON.parse(exportConversations(m, { format: 'json', withTools: true }).body);
  assert.equal(js.conversations.length, 2);
  assert.ok(js.conversations.some((c: { messages: Array<{ tool?: string }> }) => c.messages.some((x) => x.tool === 'fs_read')));
});

test('mode privé : rien n\'est retenu ni écrit', () => {
  const m = new Mnemosyne(':memory:');
  m.privateMode = true;
  m.ensureSession('web:p', 'web', 'p');
  m.addMessage('web:p', { role: 'user', content: 'Secret du jour' });
  assert.equal(m.history('web:p').length, 1, 'la conversation en cours fonctionne');
  assert.equal(m.searchMessages('secret').length, 0, 'mais rien n\'est indexé');
  assert.equal(m.remember('Retiens ce secret', 'owner').id, 0);
  assert.equal(m.listMemories().length, 0);
});
