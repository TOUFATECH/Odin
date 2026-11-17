// S9 (U5) — Pause automatique sur comportement inhabituel : plus de 3 envois vers l'extérieur dans un même tour, un
// destinataire jamais vu, ou plus de 10 écritures en une minute → le tour s'arrête sur une validation (l'alerte au
// propriétaire) ; il ne reprend qu'avec son accord.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Heimdall, type ApprovalRequest } from '../src/heimdall/policy.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

function breaker(reponse: boolean | 'rien' = 'rien') {
  const demandes: ApprovalRequest[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'inhab-'));
  const h = new Heimdall({ ...DEFAULT_CONFIG.policy, approvalTimeoutSec: 1 }, { approve: (r) => { demandes.push(r); return reponse === 'rien' ? new Promise(() => { /* pas de réponse */ }) : Promise.resolve(reponse); } }, join(dir, 'logs', 'audit.jsonl'));
  h.setAutonomy('breaker');
  return { h, demandes, fin: () => rmSync(dir, { recursive: true, force: true }) };
}

test('un tour qui tente 5 envois : arrêté au 4e (validation demandée, sans réponse rien), alerte au propriétaire', async () => {
  const { h, demandes, fin } = breaker();
  const res: boolean[] = [];
  for (let i = 0; i < 5; i++) res.push((await h.gate({ tool: 'http_request', risk: 'external', summary: `POST ${i}`, sessionId: 's', tainted: false, tour: 't1', envoi: true })).allowed);
  assert.deepEqual(res.slice(0, 3), [true, true, true]);
  assert.equal(res[3], false); assert.match(demandes[0].reason, /comportement inhabituel.*4e envoi/);
  assert.equal(demandes[0].grantable, false);
  // un autre tour repart de zéro
  assert.equal((await h.gate({ tool: 'http_request', risk: 'external', summary: 'x', sessionId: 's', tainted: false, tour: 't2', envoi: true })).allowed, true);
  fin();
});

test('un destinataire jamais vu : pause ; une fois accepté par toi, il est connu', async () => {
  const { h, demandes, fin } = breaker(true);
  const g = { tool: 'http_request', risk: 'external' as const, summary: 'x', sessionId: 's', tainted: false, tour: 'a', destinataire: 'telegram:333' };
  assert.equal((await h.gate(g)).allowed, true); assert.match(demandes[0].reason, /destinataire jamais vu \(telegram:333\)/);
  assert.equal((await h.gate({ ...g, tour: 'b' })).allowed, true); assert.equal(demandes.length, 1, 'connu désormais');
  fin();
});

test('plus de 10 écritures en une minute : la 11e attend ton accord ; 10 passent comme avant', async () => {
  const { h, demandes, fin } = breaker();
  const res: boolean[] = [];
  for (let i = 0; i < 11; i++) res.push((await h.gate({ tool: 'fs_write', risk: 'write', summary: `écrire ${i}`, sessionId: 's', tainted: false })).allowed);
  assert.equal(res.slice(0, 10).every(Boolean), true); assert.equal(res[10], false);
  assert.match(demandes[0].reason, /11 écritures en moins d'une minute/);
  fin();
});

test('11 LECTURES d\'applis en une minute (outil valhalla, risque « exec » mais lecture seule) ne déclenchent rien', async () => {
  const { h, demandes, fin } = breaker();
  const res: boolean[] = [];
  for (let i = 0; i < 11; i++) res.push((await h.gate({ tool: 'valhalla', risk: 'exec', summary: `applis etat ${i}`, sessionId: 's', tainted: false, lookup: true })).allowed);
  assert.equal(res.every(Boolean), true); assert.equal(demandes.length, 0);
  fin();
});

test('relecture, constat 4 : « éteins toutes les lumières » (4 pièces, ha_call) et 4 clics ne sont pas des envois ; les écritures d\'une tâche de fond ne comptent pas pour ta conversation', async () => {
  const { h, demandes, fin } = breaker();
  for (const p of ['salon', 'cuisine', 'chambre', 'bureau', 'entree']) assert.equal((await h.gate({ tool: 'ha_call', risk: 'external', summary: `light.turn_off light.${p}`, sessionId: 's', tainted: false, tour: 'lum' })).allowed, true, p);
  for (let i = 0; i < 5; i++) assert.equal((await h.gate({ tool: 'browser_click', risk: 'external', summary: `clic ${i}`, sessionId: 's', tainted: false, tour: 'nav' })).allowed, true);
  for (let i = 0; i < 11; i++) await h.gate({ tool: 'fs_write', risk: 'write', summary: `fond ${i}`, sessionId: 'auto:veille', tainted: false, tour: 'fond' });
  const avant = demandes.length;
  assert.equal((await h.gate({ tool: 'fs_write', risk: 'write', summary: 'la mienne', sessionId: 'web:moi', tainted: false, tour: 'moi' })).allowed, true);
  assert.equal(demandes.length, avant, 'pas de pause pour ta conversation');
  for (let i = 0; i < 12; i++) await h.gate({ tool: 'shell', risk: 'exec', summary: `ls ${i}`, sessionId: 's', tainted: false, tour: 'cmd' });
  assert.equal(demandes.filter((d) => /commandes?|écritures/.test(d.reason) && d.summary.startsWith('ls')).length, 0, 'les commandes ne comptent pas comme des écritures');
  fin();
});
