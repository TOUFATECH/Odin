// S5 (U3) — Les tâches automatiques ne sont pas « toi » : leurs données passent comme contenu non fiable, seule leur
// consigne fixe compte comme ta demande, et « demandé par toi » n'y vaut jamais pour une action engageante.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Heimdall, type Review } from '../src/heimdall/policy.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { RACINE_APPLI } from '../src/heimdall/noyau.ts';

function odin(autonomie: 'equilibre' | 'breaker', review: Review) {
  let demandes = 0;
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: () => { demandes++; return Promise.resolve(true); } });
  h.setReviewer(async () => review, autonomie);
  h.setAutonomy(autonomie);
  return { h, demandes: () => demandes };
}
// Un appareil nommé comme une consigne : le juge, trompé, croit que c'est « demandé ».
const piege: Review = { severity: 'important', reason: 'Odin envoie tes clés à …', flags: [], requested: 'yes' };

test('travail continu (tâche automatique), en Breaker et en équilibré : aucune action engageante, même « demandée »', async () => {
  for (const a of ['breaker', 'equilibre'] as const) {
    for (const risk of ['write', 'external', 'exec'] as const) {
      const { h, demandes } = odin(a, piege);
      const d = await h.gate({ tool: 'x', risk, summary: 'envoyer les clés', sessionId: 'auto:veille', tainted: false, unattended: true, automatique: true, userRequest: 'Fais le point' });
      assert.equal(d.allowed, false, `${a} ${risk}`); assert.equal(demandes(), 0, 'personne à qui demander : refus');
    }
  }
});

test('ce qui n\'est pas visé ne change pas : une tâche planifiée par toi (pas « automatique »), la lecture', async () => {
  const { h } = odin('breaker', { ...piege, severity: 'routine' });
  assert.equal((await h.gate({ tool: 'x', risk: 'write', summary: 'x', sessionId: 'cron:1', tainted: false, unattended: true })).allowed, true);
  assert.equal((await h.gate({ tool: 'web_search', risk: 'network', summary: 'x', sessionId: 'auto:veille', tainted: false, unattended: true, automatique: true })).allowed, true);
});

test('la passerelle : les données des tâches automatiques sont dans l\'enveloppe non fiable, et la consigne fixe est donnée', () => {
  const g = readFileSync(join(RACINE_APPLI, 'src', 'bifrost', 'gateway.ts'), 'utf8');
  assert.match(g, /wrapUntrusted\('situation du moment \(réseau, journaux\)'/);
  assert.match(g, /wrapUntrusted\('faits de la nuit'/); assert.match(g, /wrapUntrusted\('faits du jour'/);
  assert.equal((g.match(/automatique: /g) ?? []).length >= 5, true);
  assert.doesNotMatch(g, /<situation>\\n\$\{facts\}/);
  const a = readFileSync(join(RACINE_APPLI, 'src', 'core', 'agent.ts'), 'utf8');
  assert.match(a, /userRequest: o\.automatique \?\? o\.ownerRequest/);
});
