// Supprimer engage le propriétaire (campagne des tâches de tous les jours) : « supprime les spams », « supprime ce mail »,
// « delete the spam » → mail_move vers la corbeille ou les indésirables demande sa validation, avec ce qui part et
// combien ; classer ou archiver reste libre. Même chose pour une note du Cerveau mise à la corbeille.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { Heimdall, type ApprovalRequest } from '../src/heimdall/policy.ts';
import { deciderPuisLancer } from '../src/heimdall/executer.ts';
import { mailMove } from '../src/tools/mail.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { BRAIN_TOOLS } from '../src/tools/brain.ts';

const ctx = { workspace: tmpdir(), fullAccess: true, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never;
function odin() {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  h.setAutonomy('equilibre');
  return { h, demandes };
}

test('mail_move vers la corbeille ou les indésirables (toutes langues) → validation, avec ce qui part et combien ; sans réponse, rien', async () => {
  for (const folder of ['[Gmail]/Corbeille', 'Trash', 'Junk', '[Gmail]/Spam', 'Papierkorb', 'Корзина', 'Deleted Items']) {
    const { h, demandes } = odin();
    const r = await deciderPuisLancer(h, mailMove, { uid: '42', folder }, ctx, { sessionId: 's', tainted: false });
    assert.equal(r.decision.allowed, false, folder); assert.equal(r.lancer, undefined, folder);
    assert.equal(demandes.length, 1, folder);
    assert.match(demandes[0].reason, /supprimer 1 e-mail \(n° 42, du dossier « INBOX »\)/, folder);
  }
});

test('classer ou archiver reste libre (rien ne change pour ce qui n\'est pas visé)', () => {
  for (const folder of ['Factures', 'Archive', '[Gmail]/Tous les messages', 'Binance', 'Spammeurs connus/notes']) assert.equal(mailMove.grave?.({ uid: '1', folder }), undefined, folder);
  assert.equal(mailMove.grave?.({ uid: '1', read: 'oui' }), undefined, 'marquer lu');
});

test('une note du Cerveau mise à la corbeille → validation ; créer ou ajouter reste libre', () => {
  const t = BRAIN_TOOLS.find((x) => x.name === 'cerveau_ecrire')!;
  assert.match(t.grave?.({ action: 'corbeille', note: 'Idées vacances' }) ?? '', /mettre à la corbeille 1 note du Cerveau : « Idées vacances »/);
  assert.equal(t.grave?.({ action: 'ajouter', note: 'x', contenu: 'y' }), undefined);
});
