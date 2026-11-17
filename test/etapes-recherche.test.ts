// Les étapes d'une recherche vont à l'interface : pendant un outil long, la page reçoit « je lis 8 sources… » au lieu de
// rester muette (recette de l'agent « rapidité », point 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { call, makeOdin } from './helpers.ts';
import { RACINE_APPLI } from '../src/heimdall/noyau.ts';
import type { AgentEvent } from '../src/types.ts';

test('un outil qui dit ses étapes : la boucle les envoie comme événements, pendant l\'outil', async () => {
  const o = makeOdin([call('essai_long', {}), { text: 'fini' }]);
  o.tools.register({ name: 'essai_long', description: 'essai', risk: 'read', schema: { type: 'object', properties: {} }, async run(_i, ctx) { ctx.etape?.('Je cherche avec plusieurs moteurs'); ctx.etape?.('Je lis 8 sources'); return 'ok'; } });
  const evts: AgentEvent[] = [];
  await o.agent.run('cherche', { sessionId: 'web:moi', onEvent: (e) => evts.push(e) });
  const etapes = evts.filter((e) => e.type === 'etape').map((e) => (e as { texte: string }).texte);
  assert.deepEqual(etapes, ['Je cherche avec plusieurs moteurs', 'Je lis 8 sources']);
  const i = evts.findIndex((e) => e.type === 'etape'), fin = evts.findIndex((e) => e.type === 'tool_end');
  assert.ok(i < fin, 'avant la fin de l\'outil');
  o.cleanup();
});

test('la recherche vérifiée branche ses étapes, et la page les montre', () => {
  assert.match(readFileSync(join(RACINE_APPLI, 'src', 'tools', 'research.ts'), 'utf8'), /onStep: \(t\) => ctx\.etape\?\.\(t\)/);
  assert.match(readFileSync(join(RACINE_APPLI, 'src', 'web', 'ui.html'), 'utf8'), /else if \(e\.type === 'etape'\)/);
});
