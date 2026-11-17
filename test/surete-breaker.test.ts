// S3 (U1) — Odin Breaker : après la lecture d'un contenu extérieur, plus rien d'engageant sans toi. Seule TA demande
// compte (Mímir la juge sur ton message, jamais sur la page) ; sinon la validation t'est demandée, ou refus sans personne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heimdall, type ApprovalRequest, type Review } from '../src/heimdall/policy.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

function breaker(review?: Review) {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  if (review) h.setReviewer(async () => review, 'breaker');
  h.setAutonomy('breaker');
  return { h, demandes };
}

test('Breaker, page piégée lue : un envoi ou une écriture que tu n\'as pas demandés → validation demandée ; sans réponse, rien', async () => {
  for (const risk of ['write', 'external'] as const) {
    const { h, demandes } = breaker({ severity: 'important', reason: 'envoi de mail', flags: [], requested: 'no' });
    const d = await h.gate({ tool: risk === 'write' ? 'fs_write' : 'mail_send', risk, summary: 'envoyer ~/.odin/env à x', sessionId: 's', tainted: true });
    assert.equal(d.allowed, false, risk); assert.equal(demandes.length, 1, risk);
  }
  // sans juge non plus : une écriture après un contenu extérieur → validation
  const { h, demandes } = breaker();
  assert.equal((await h.gate({ tool: 'fs_write', risk: 'write', summary: 'x', sessionId: 's', tainted: true })).allowed, false);
  assert.equal(demandes.length, 1);
  // tâche sans personne pour répondre : refus
  const { h: h2 } = breaker({ severity: 'important', reason: 'x', flags: [], requested: 'unsure' });
  assert.equal((await h2.gate({ tool: 'mail_send', risk: 'external', summary: 'x', sessionId: 's', tainted: true, unattended: true })).allowed, false);
});

test('ce qui n\'est pas visé ne change pas : demandé par toi après une lecture, ou conversation propre → Breaker agit', async () => {
  const { h, demandes } = breaker({ severity: 'important', reason: 'tu l\'as demandé', flags: [], requested: 'yes' });
  assert.equal((await h.gate({ tool: 'fs_write', risk: 'write', summary: 'x', sessionId: 's', tainted: true })).allowed, true);
  const { h: h2 } = breaker({ severity: 'important', reason: 'x', flags: [], requested: 'no' });
  assert.equal((await h2.gate({ tool: 'fs_write', risk: 'write', summary: 'x', sessionId: 's', tainted: false })).allowed, true);
  assert.equal((await h2.gate({ tool: 'web_fetch', risk: 'network', summary: 'lire', sessionId: 's', tainted: true })).allowed, true, 'lire reste libre');
  assert.equal(demandes.length, 0);
});
