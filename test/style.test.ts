import { test } from 'node:test';
import assert from 'node:assert/strict';
import { charterIssues, polishReply } from '../src/core/style.ts';
import { buildSystemPrompt } from '../src/core/prompt.ts';

const TOOLS = ['net_inventory', 'machine_status', 'web_search', 'reminder_set'];

test('charte : formule creuse retirée, noms d\'outils cachés, émojis limités', () => {
  assert.equal(polishReply('Bien sûr ! Le NAS va bien, disque à **92 %**.', TOOLS), 'Le NAS va bien, disque à **92 %**.');
  assert.equal(polishReply('Bien sûr !'), 'Bien sûr !', 'rien derrière : on garde');
  assert.equal(polishReply("J'ai vérifié via l'outil machine_status : tout est en ligne (net_inventory).", TOOLS), "J'ai vérifié : tout est en ligne.");
  assert.equal(polishReply('### 🛡️ Sécurité\nRAS ✅✅✅', TOOLS), '### Sécurité\nRAS ✅');
  assert.equal(polishReply('🎉 a 🎉 b 🔥 c 🚀 d 💡 e').match(/\p{Extended_Pictographic}/gu)!.length, 2);
  assert.equal(polishReply('a\n\n\n\nb   '), 'a\n\nb');
  assert.equal(polishReply('Utilise `reminder_set` si besoin', []), 'Utilise `reminder_set` si besoin', 'sans liste d\'outils, rien n\'est retiré');
});

test('charte : contrôle qualité et place dans le prompt', () => {
  assert.deepEqual(charterIssues('Oui, le disque est à 92 %.', TOOLS), []);
  assert.deepEqual(charterIssues('Bien sûr ! machine_status dit OK 🎉🎉🎉🎉', TOOLS), ['formule creuse au début', 'trop d\'émojis', 'nom d\'outil visible (machine_status)']);
  const sys = buildSystemPrompt({ persona: '# Odin', name: 'Odin', now: new Date(), channel: 'web', workspace: '/w', summary: '', pinned: [], recalled: [], skillsIndex: '', tainted: false });
  assert.ok(sys.indexOf('## Charte de réponse') < sys.indexOf('## Contexte'), 'la charte vient juste après la personnalité');
  assert.doesNotMatch(sys, /niveau de certitude sur chaque fait/);
});
