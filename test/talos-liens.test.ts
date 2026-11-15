// « Faire un lien » dans Talos (src/draupnir/liens.ts) : un déclencheur simple relié à une ou plusieurs fonctions
// d'applis devient une automatisation ordinaire, visible ensuite dans l'éditeur à nœuds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFlow, normalize } from '../src/draupnir/engine.ts';
import { CATALOG } from '../src/draupnir/nodes.ts';
import { actionLiable, construireLien, evenementsDe } from '../src/draupnir/liens.ts';
import { importN8n, planningDe, Talos } from '../src/draupnir/service.ts';
import type { Module } from '../src/valhalla/types.ts';

const appli = (id: string, name: string, actions: Module['actions']): Module => ({ id, name, family: 'Machines', what: 'essai', does: [], from: [], upstream: [], words: [], actions, view: () => ({ sections: [] }) });
const APPLIS: Module[] = [
  appli('ymir', 'Hydre', [{ id: 'verifier_isos', label: 'Vérifier toutes les ISO', what: 'x', run: () => ({ text: 'ok' }) }, { id: 'retirer_iso', label: 'Retirer une ISO', what: 'x', params: [{ key: 'iso', label: 'ISO', kind: 'text', required: true }], grave: () => 'supprimer une ISO', run: () => ({ text: 'ok' }) }]),
  appli('gladsheim', 'Odin', [{ id: 'dire', label: 'Prévenir', what: 'x', params: [{ key: 'texte', label: 'Texte', kind: 'text', required: true }], run: () => ({ text: 'ok' }) }]),
];

test('un lien « chaque mois » + 2 étapes : une automatisation que l\'éditeur accepte', () => {
  const r = construireLien({ quand: { sorte: 'rythme', rythme: { genre: 'mois', jour: 1, heure: '04:00' } }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }, { appli: 'gladsheim', action: 'dire', entree: { texte: 'Vérification faite : {{ $json.texte }}' } }, { appli: 'ymir', action: 'verifier_isos' }], activer: true }, APPLIS);
  assert.ok(r.ok, !r.ok ? r.error : '');
  if (!r.ok) return;
  const f = r.flow;
  assert.equal(checkFlow(normalize(f), CATALOG), undefined);
  assert.deepEqual(f.nodes!.map((n) => n.name), ['Chaque mois, le 1er à 4 h', 'Hydre · Vérifier toutes les ISO', 'Odin · Prévenir', 'Hydre · Vérifier toutes les ISO 2'], 'noms uniques');
  assert.deepEqual(f.nodes!.map((n) => n.position), [[60, 160], [300, 160], [540, 160], [780, 160]]);
  assert.deepEqual(f.nodes![0].params, { mode: 'simple', rythme: { genre: 'mois', jour: 1, heure: '04:00' } });
  assert.equal(f.nodes![0].type, 'déclencheur.planning');
  assert.deepEqual(f.nodes![2].params, { module: 'gladsheim', action: 'dire', entrée: JSON.stringify({ texte: 'Vérification faite : {{ $json.texte }}' }) });
  assert.deepEqual(f.connections!['Chaque mois, le 1er à 4 h'], [[{ node: 'Hydre · Vérifier toutes les ISO' }]]);
  assert.deepEqual(f.connections!['Odin · Prévenir'], [[{ node: 'Hydre · Vérifier toutes les ISO 2' }]]);
  assert.equal(f.origin, 'lien'); assert.equal(f.active, true);
  assert.equal(f.name, 'Chaque mois, le 1er à 4 h → Hydre · Vérifier toutes les ISO'); assert.equal(r.phrase, f.name);
  assert.equal(planningDe(f.nodes![0].params)!.phrase, 'Chaque mois, le 1er à 4 h');
});

test('à la main (jamais actif tout seul) et « quand une appli signale »', () => {
  const m = construireLien({ quand: { sorte: 'main' }, etapes: [{ appli: 'Hydre', action: 'verifier_isos' }], activer: true }, APPLIS);
  assert.ok(m.ok && m.flow.active === false && m.flow.nodes![0].name === 'À la main' && m.flow.nodes![0].type === 'déclencheur.manuel');
  const s = construireLien({ quand: { sorte: 'appli', appli: 'ymir', evenement: 'alerte', niveau: 'critique' }, etapes: [{ appli: 'gladsheim', action: 'dire', entree: { texte: 'x' } }] }, APPLIS);
  assert.ok(s.ok); if (!s.ok) return;
  assert.equal(s.flow.nodes![0].name, 'Quand Hydre signale'); assert.deepEqual(s.flow.nodes![0].params, { module: 'ymir', événement: 'alerte', niveau: 'critique' });
  assert.equal(construireLien({ quand: { sorte: 'appli', appli: 'ymir', evenement: 'inexistant' }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }] }, APPLIS).ok, false);
  assert.ok(evenementsDe('ymir').includes('vm_arretee') && evenementsDe('ymir').includes('alerte'));
});

test('refus : action grave, appli ou fonction inconnue, réglage obligatoire vide, rythme invalide', () => {
  const grave = construireLien({ quand: { sorte: 'main' }, etapes: [{ appli: 'ymir', action: 'retirer_iso', entree: { iso: 'debian' } }] }, APPLIS);
  assert.ok(!grave.ok && grave.code === 'grave' && grave.etape === 0);
  const inconnue = construireLien({ quand: { sorte: 'main' }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }, { appli: 'nulle', action: 'x' }] }, APPLIS);
  assert.ok(!inconnue.ok && inconnue.code === 'introuvable' && inconnue.etape === 1);
  assert.ok(!construireLien({ quand: { sorte: 'main' }, etapes: [{ appli: 'ymir', action: 'rien' }] }, APPLIS).ok);
  const vide = construireLien({ quand: { sorte: 'main' }, etapes: [{ appli: 'gladsheim', action: 'dire', entree: { texte: '  ' } }] }, APPLIS);
  assert.ok(!vide.ok && vide.code === 'invalide');
  assert.ok(construireLien({ quand: { sorte: 'main' }, etapes: [{ appli: 'gladsheim', action: 'dire', entree: { texte: '{{ $json.titre }}' } }] }, APPLIS).ok, 'une expression suffit');
  const r = construireLien({ quand: { sorte: 'rythme', rythme: { genre: 'jour', heure: '25:00' } }, etapes: [{ appli: 'ymir', action: 'verifier_isos' }] }, APPLIS);
  assert.ok(!r.ok && r.code === 'invalide');
  assert.ok(!construireLien({ quand: { sorte: 'main' }, etapes: [] }, APPLIS).ok, 'au moins une étape');
  assert.ok(!construireLien({ quand: { sorte: 'main' }, etapes: Array.from({ length: 9 }, () => ({ appli: 'ymir', action: 'verifier_isos' })) }, APPLIS).ok, '8 étapes au plus');
  const l = actionLiable(APPLIS[0].actions[1]);
  assert.equal(l.grave, true); assert.equal(l.raison, 'Action grave : elle demande ton accord et ne part pas d\'une automatisation.');
  assert.equal(actionLiable(APPLIS[0].actions[0]).grave, false);
});

test('un flow importé en mode cron reste inchangé (compté à l\'heure du lieu)', () => {
  const home = mkdtempSync(join(tmpdir(), 'talos-liens-'));
  const d = new Talos(home, {});
  try {
    const { flow } = importN8n({ name: 'Import', nodes: [{ name: 'Chaque matin', type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: { interval: [{ field: 'cronExpression', expression: '30 7 * * 1-5' }] } } }, { name: 'Fin', type: 'n8n-nodes-base.noOp' }], connections: { 'Chaque matin': { main: [[{ node: 'Fin' }]] } } });
    const w = d.save({ ...flow, active: true });
    const n = d.get(w.id)!.nodes[0];
    assert.deepEqual(n.params, { mode: 'cron', cron: '30 7 * * 1-5' });
    assert.equal(planningDe(n.params)!.phrase, 'Du lundi au vendredi à 7 h 30');
    // Un ancien nœud sans « mode » garde son cron.
    assert.equal(planningDe({ cron: '0 8 * * *' })!.phrase, 'Tous les jours à 8 h');
  } finally { d.stop(); rmSync(home, { recursive: true, force: true }); }
});
