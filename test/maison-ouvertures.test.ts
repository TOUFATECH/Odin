// S6 (M1) — Serrures, alarme, portail : ouvrir, déverrouiller ou désarmer est TOUJOURS validé (garde en code, même en
// Breaker, sans modèle) ; fermer et armer restent libres ; jamais depuis une tâche automatique, un invité, ou après un
// contenu extérieur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { Heimdall, type ApprovalRequest } from '../src/heimdall/policy.ts';
import { deciderPuisLancer, lireEntitesAvec } from '../src/heimdall/executer.ts';
import { graveMaison } from '../src/heimdall/maison.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const ctx = { workspace: tmpdir(), fullAccess: true, sessionId: 's', channel: 'web', peer: 'p', isTainted: () => false } as never;
const haCall = { name: 'ha_call', description: '', risk: 'external' as const, schema: { type: 'object', properties: {} }, async run() { return 'Fait'; } } as never;
function breaker() {
  const demandes: ApprovalRequest[] = [];
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return new Promise(() => { /* pas de réponse */ }); } });
  h.setAutonomy('breaker');
  return { h, demandes };
}
lireEntitesAvec(async (_c, e) => (e === 'scene.depart' ? { nom: 'Départ', entites: ['light.salon', 'lock.porte_entree'] } : e === 'cover.portail' ? { nom: 'Portail', classe: 'gate' } : { nom: e }));

test('Breaker : « ouvre le portail » → bouton ; « ferme le portail » → fait ; la scène « Départ » qui déverrouille → bouton', async () => {
  const { h, demandes } = breaker();
  const ouvre = await deciderPuisLancer(h, haCall, { domain: 'cover', service: 'open_cover', entity_id: 'cover.portail' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(ouvre.decision.allowed, false); assert.equal(demandes.length, 1); assert.equal(demandes[0].grantable, false);
  assert.match(demandes[0].reason, /ouvrir ou désarmer la maison : ouvrir \(cover\.portail\)/);
  const ferme = await deciderPuisLancer(h, haCall, { domain: 'cover', service: 'close_cover', entity_id: 'cover.portail' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(ferme.decision.allowed, true);
  const scene = await deciderPuisLancer(h, haCall, { domain: 'scene', service: 'turn_on', entity_id: 'scene.depart' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(scene.decision.allowed, false); assert.match(demandes.at(-1)!.reason, /lock\.porte_entree/);
  const lumiere = await deciderPuisLancer(h, haCall, { domain: 'light', service: 'turn_on', entity_id: 'light.salon' }, ctx, { sessionId: 's', tainted: false });
  assert.equal(lumiere.decision.allowed, true, 'le reste ne change pas');
});

test('serrure et alarme : déverrouiller et désarmer validés ; verrouiller et armer libres', () => {
  assert.ok(graveMaison('lock', 'unlock', 'lock.porte'));
  assert.equal(graveMaison('lock', 'lock', 'lock.porte'), undefined);
  assert.ok(graveMaison('alarm_control_panel', 'alarm_disarm', 'alarm_control_panel.maison'));
  assert.equal(graveMaison('alarm_control_panel', 'alarm_arm_away', 'alarm_control_panel.maison'), undefined);
  assert.ok(graveMaison('switch', 'turn_on', 'switch.portail_garage'));
  assert.equal(graveMaison('switch', 'turn_off', 'switch.portail_garage'), undefined);
});

test('jamais depuis une tâche automatique, un invité ou après un contenu extérieur : refus, sans même demander', async () => {
  for (const e of [{ unattended: true }, { automatique: true }, { tainted: true }, { maxAutonomy: 'prudent' as const }]) {
    const { h, demandes } = breaker();
    const r = await deciderPuisLancer(h, haCall, { domain: 'lock', service: 'unlock', entity_id: 'lock.porte' }, ctx, { sessionId: 's', tainted: false, ...e });
    assert.equal(r.decision.allowed, false, JSON.stringify(e)); assert.equal(demandes.length, 0, JSON.stringify(e));
  }
});

test('relecture, constat 6 : homeassistant.turn_off sur une serrure, un script au nom neutre qui ouvre, une automatisation illisible → validation ; un script qui n\'allume que des lampes → libre ; Midgard refuse d\'office en tâche automatique', async () => {
  assert.ok(graveMaison('homeassistant', 'turn_off', 'lock.porte_entree'));
  assert.ok(graveMaison('lock', 'open', 'lock.porte'));
  assert.ok(graveMaison('script', 'turn_on', 'script.arrivee', { 'script.arrivee': { nom: 'Arrivée', entites: ['light.entree', 'lock.porte_entree'] } }));
  assert.ok(graveMaison('automation', 'trigger', 'automation.bienvenue', {}), 'contenu illisible : prudence');
  assert.equal(graveMaison('script', 'turn_on', 'script.soiree', { 'script.soiree': { nom: 'Soirée', entites: ['light.salon', 'light.cuisine'] } }), undefined);
  const { sensitive } = await import('../src/valhalla/modules/midgard.ts');
  assert.match(sensitive('ha:lock.porte', 'off') ?? '', /^ouvrir ou désarmer la maison : déverrouiller/);
  const { h, demandes } = breaker();
  const d = await h.gate({ tool: 'valhalla', risk: 'exec', summary: 'midgard', sessionId: 'auto:veille', tainted: false, unattended: true, automatique: true, grave: sensitive('ha:lock.porte', 'on') });
  assert.equal(d.allowed, false); assert.equal(demandes.length, 0, 'refus d\'office, sans question');
});
