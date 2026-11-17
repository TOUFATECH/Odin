// S2 — L'argent toujours validé (note « Réécrire son code », § 2.2 A) : « dépense oui » ou « incertain » selon le juge →
// ta validation même en Breaker ; et, sans aucun modèle, une garde en code sur les pages et adresses de paiement.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { Heimdall, type ApprovalRequest, type Review } from '../src/heimdall/policy.ts';
import { deciderPuisLancer } from '../src/heimdall/executer.ts';
import { graveArgent, oublierPages, signePaiement } from '../src/heimdall/paiement.ts';
import { decideAction } from '../src/mimir/decisions.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

beforeEach(() => oublierPages());

function breaker(review?: Review) {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  if (review) h.setReviewer(async () => review, 'breaker');
  h.setAutonomy('breaker');
  return { h, demandes };
}
const ctx = { workspace: tmpdir(), fullAccess: true, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never;
const outil = (name: string, sortie = 'ok', risk: 'external' | 'network' = 'external') => { let n = 0; return { t: { name, description: '', risk, schema: { type: 'object', properties: {} }, async run() { n++; return sortie; } } as never, lances: () => n }; };

test('Breaker : le juge dit « dépense oui » ou « incertain » → ta validation (grave, jamais « toujours ») ; sans réponse, rien', async () => {
  for (const argent of ['oui', 'incertain'] as const) {
    const { h, demandes } = breaker({ severity: 'grave', reason: 'achat', flags: [], requested: 'yes', argent });
    const d = await h.gate({ tool: 'http_request', risk: 'external', summary: 'acheter', sessionId: 's', tainted: false });
    assert.equal(d.allowed, false, argent); assert.equal(demandes.length, 1, argent);
    assert.equal(demandes[0].severity, 'grave'); assert.equal(demandes[0].grantable, false);
  }
  // le juge ne parle pas d'argent : Breaker agit comme avant
  const { h, demandes } = breaker({ severity: 'important', reason: 'x', flags: [], requested: 'yes' });
  assert.equal((await h.gate({ tool: 'http_request', risk: 'external', summary: 'x', sessionId: 's', tainted: false })).allowed, true);
  assert.equal(demandes.length, 0);
});

test('le juge : « dépense incertaine » devient grave, avec le drapeau argent', () => {
  const lv = { requested: 'yes', deletes: 'no', sends_out: 'no', system_change: 'no', money: 'unsure', private_data: 'no', irreversible: 'no' } as const;
  const v = decideAction(lv, { risk: 'external', tainted: false });
  assert.equal(v.severity, 'grave'); assert.equal(v.argent, 'incertain');
  assert.equal(decideAction({ ...lv, money: 'yes' }, { risk: 'external', tainted: false }).argent, 'oui');
  assert.equal(decideAction({ ...lv, money: 'no' }, { risk: 'external', tainted: false }).argent, undefined);
});

test('sans aucun modèle : un clic sur une page qui porte « Payer » → ta validation, même en Breaker ; une page ordinaire → rien à demander', async () => {
  const { h, demandes } = breaker();
  const look = outil('browser_look', 'Page « Panier » — [12] bouton « Payer 49,90 € » — Numéro de carte', 'network');
  await (await deciderPuisLancer(h, look.t, {}, ctx, { sessionId: 's', tainted: false })).lancer!();
  const clic = outil('browser_click');
  const r = await deciderPuisLancer(h, clic.t, { element: 12 }, ctx, { sessionId: 's', tainted: false });
  assert.equal(r.decision.allowed, false); assert.equal(clic.lances(), 0); assert.equal(demandes.length, 1);
  assert.match(demandes[0].reason, /paiement possible/);
  // une autre conversation, une page ordinaire
  const look2 = outil('browser_look', 'Page « Météo de Mamoudzou » — [3] lien « Demain »', 'network');
  await (await deciderPuisLancer(h, look2.t, {}, ctx, { sessionId: 't', tainted: false })).lancer!();
  const r2 = await deciderPuisLancer(h, clic.t, { element: 3 }, ctx, { sessionId: 't', tainted: false });
  assert.equal(r2.decision.allowed, true); assert.equal(demandes.length, 1);
});

test('la garde en code : signes de paiement, numéro de carte saisi, adresse de paiement connue', () => {
  assert.equal(signePaiement('Valider le paiement'), 'Valider le paiement');
  assert.ok(signePaiement('Place your order'));
  assert.equal(signePaiement('Les tortues de Mayotte pondent la nuit'), undefined);
  assert.match(graveArgent('browser_type', { text: '4970 1012 3456 7890' }, 'x') ?? '', /numéro de carte/);
  assert.match(graveArgent('http_request', { url: 'https://api.stripe.com/v1/charges' }, 'x') ?? '', /api\.stripe\.com/);
  assert.equal(graveArgent('http_request', { url: 'https://api.open-meteo.com/v1/forecast' }, 'x'), undefined);
});
