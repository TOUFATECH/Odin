// S4 (U2) — Envoyer en ton nom = ta validation, destinataire et texte exact montrés, même en Breaker, même demandé ;
// jamais « toujours ». Un message à toi-même reste libre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { Heimdall, type ApprovalRequest, type Review } from '../src/heimdall/policy.ts';
import { deciderPuisLancer } from '../src/heimdall/executer.ts';
import { declarerProprietaires } from '../src/heimdall/envois.ts';
import { sendMessage } from '../src/tools/builtin.ts';
import { mailSend } from '../src/tools/mail.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const ctx = { workspace: tmpdir(), fullAccess: true, sessionId: 'web:p', channel: 'web', peer: 'p', isTainted: () => false, send: async () => {}, redactor: { redact: (t: string) => t } } as never;
function odin(autonomie: 'equilibre' | 'breaker', review?: Review) {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  if (review) h.setReviewer(async () => review, autonomie);
  h.setAutonomy(autonomie);
  return { h, demandes };
}

test('« envoie à Paul : j\'arrive », demandé clairement, en équilibré et en Breaker → bouton avec destinataire et texte ; sans réponse, rien', async () => {
  declarerProprietaires({ telegram: ['111'], web: ['*'] });
  for (const a of ['equilibre', 'breaker'] as const) {
    const { h, demandes } = odin(a, { severity: 'routine', reason: 'message demandé par toi', flags: [], requested: 'yes' });
    const r = await deciderPuisLancer(h, sendMessage, { channel: 'telegram', peer: '222', text: 'j\'arrive' }, ctx, { sessionId: 'web:p', tainted: false });
    assert.equal(r.decision.allowed, false, a); assert.equal(r.lancer, undefined);
    assert.equal(demandes.length, 1, a);
    assert.match(demandes[0].reason, /telegram:222 ce texte exact : « j'arrive »/);
    assert.equal(demandes[0].grantable, false);
    const m = await deciderPuisLancer(h, mailSend, { to: 'paul@exemple.fr', subject: 'Retard', text: 'J\'arrive dans 10 minutes.' }, ctx, { sessionId: 'web:p', tainted: false });
    assert.equal(m.decision.allowed, false);
    assert.match(demandes[1].reason, /paul@exemple\.fr.*« Retard ».*« J'arrive dans 10 minutes\. »/);
  }
});

test('un message que j\'envoie au propriétaire lui-même reste libre (ce qui n\'est pas visé ne change pas)', async () => {
  declarerProprietaires({ telegram: ['111'] });
  const { h, demandes } = odin('breaker', { severity: 'routine', reason: 'x', flags: [], requested: 'yes' });
  const r = await deciderPuisLancer(h, sendMessage, { channel: 'telegram', peer: '111', text: 'rappel' }, ctx, { sessionId: 'web:p', tainted: false });
  assert.equal(r.decision.allowed, true); assert.equal(demandes.length, 0);
});
