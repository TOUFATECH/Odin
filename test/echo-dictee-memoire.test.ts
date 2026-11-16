// Écho · demande 2 : une dictée mise en forme est GARDÉE (texte chiffré dans ECHO_ODIN) et laisse un REPÈRE NEUTRE
// dans la mémoire d'Odin (jamais le texte, car la mémoire est en clair sur le disque). Rétention : rien ne s'efface
// tout seul ; le propriétaire peut supprimer une dictée (ou toutes), ce qui efface EN CASCADE le texte chiffré et le
// repère. Aucun service réel : faux hook de mémoire, stockage réel (chiffré) sur un dossier temporaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brancherMemoireDictee, dicteeArchiveDe, garderDictees, oublierDictee, rangerDictee, titreDictee, type PointeurDictee } from '../src/valhalla/rodd/dictee-archive.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { rodd } from '../src/valhalla/modules/rodd.ts';

function ctxTmp(settings: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'odin-dic-'));
  return { home, dir: join(home, 'rodd'), settings: { ...settings }, saveSettings() {}, fin: () => rmSync(home, { recursive: true, force: true }) };
}

test('dictée gardée : texte chiffré retrouvable, repère NEUTRE en mémoire (jamais un mot du texte)', () => {
  const ctx = ctxTmp();
  const points: PointeurDictee[] = []; brancherMemoireDictee({ noter: (p) => points.push(p), oublier() {} });
  try {
    const id = rangerDictee(ctx, { at: '2026-11-16T09:00:00Z', ou: 'Odin (web)', mode: 'corrigé', texte: 'Rendez-vous secret à 15 h.', brut: 'rendez vous secret a 15h' });
    assert.ok(id, 'une dictée gardée rend un identifiant');
    // Le texte reste retrouvable (déchiffré) pour le propriétaire seul.
    const l = dicteeArchiveDe(ctx).lister(10);
    assert.equal(l[0].texte, 'Rendez-vous secret à 15 h.'); assert.equal(l[0].mode, 'corrigé');
    // Le repère en mémoire ne contient QUE identifiant, date et mise en forme — aucun mot de la dictée.
    assert.equal(points.length, 1);
    assert.equal(points[0].dic, id); assert.equal(points[0].mode, 'corrigé'); assert.equal(points[0].date, '2026-11-16T09:00:00Z');
    assert.doesNotMatch(JSON.stringify(points), /secret|Rendez|15/, 'aucun mot de la dictée en mémoire');
  } finally { brancherMemoireDictee(undefined); ctx.fin(); }
});

test('rétention : « Garder l\'historique » décoché ou texte vide → rien gardé, aucun repère', () => {
  const ctx = ctxTmp({ historique: false });
  const points: PointeurDictee[] = []; brancherMemoireDictee({ noter: (p) => points.push(p), oublier() {} });
  try {
    assert.equal(rangerDictee(ctx, { at: '2026-11-16T09:00:00Z', ou: 'x', mode: 'corrigé', texte: 'Bonjour.', brut: 'bonjour' }), undefined);
    assert.equal(dicteeArchiveDe(ctx).compte(), 0); assert.equal(points.length, 0);
    assert.equal(garderDictees({ historique: false }, 'x'), false);
    assert.equal(garderDictees({}, '   '), false, 'texte vide : rien gardé');
    assert.equal(garderDictees({}, 'x'), true);
  } finally { brancherMemoireDictee(undefined); ctx.fin(); }
});

test('suppression en cascade : effacer une dictée (ou toutes) retire le texte chiffré ET le repère en mémoire', () => {
  const ctx = ctxTmp();
  const oublies: string[] = []; brancherMemoireDictee({ noter() {}, oublier: (d) => oublies.push(d) });
  try {
    const a = dicteeArchiveDe(ctx);
    const id1 = rangerDictee(ctx, { at: '2026-11-16T09:00:00Z', ou: 'x', mode: 'corrigé', texte: 'Un.', brut: 'un' })!;
    const id2 = rangerDictee(ctx, { at: '2026-11-16T10:00:00Z', ou: 'x', mode: 'tel quel', texte: 'Deux.', brut: 'deux' })!;
    assert.equal(a.compte(), 2);
    assert.equal(a.effacer(id1), 1); oublierDictee(id1);
    assert.equal(a.compte(), 1); assert.deepEqual(oublies, [id1]);
    assert.equal(a.effacer(), 1); oublierDictee(id2);
    assert.equal(a.compte(), 0); assert.deepEqual(oublies, [id1, id2]);
  } finally { brancherMemoireDictee(undefined); ctx.fin(); }
});

test('titre de dictée : neutre (date + mise en forme), aucune parole', () => {
  assert.equal(titreDictee({ date: '2026-11-16T09:00:00Z', mode: 'corrigé' }), 'Dictée du 2026-11-16 (corrigé)');
  assert.equal(titreDictee({ date: '2026-11-16T09:00:00Z', mode: 'tel quel' }), 'Dictée du 2026-11-16');
});

test('bout en bout : « dicter » garde la dictée (chiffrée) + repère, « dictee_effacer » efface en cascade', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-dic-'));
  const points: PointeurDictee[] = []; brancherMemoireDictee({ noter: (p) => points.push(p), oublier() {} });
  try {
    const v = new Valhalla(home, [rodd]);
    const ctx = v.ctx('rodd');
    await v.act('rodd', 'dicter', { texte: 'un petit mot de test', mode: 'tel quel' });
    assert.equal(dicteeArchiveDe(ctx).compte(), 1, 'la dictée est gardée');
    assert.equal(points.length, 1); assert.equal(points[0].mode, 'tel quel');
    // L'action de liste rend le texte (déchiffré) pour le propriétaire.
    const g = await v.act('rodd', 'dictee_gardees', {});
    assert.match((g.data as { items: Array<{ texte: string }> }).items[0].texte, /un petit mot de test/i);
    // Suppression en cascade par l'action.
    const e = await v.act('rodd', 'dictee_effacer', {});
    assert.match(e.text, /mémoire/);
    assert.equal(dicteeArchiveDe(ctx).compte(), 0);
  } finally { brancherMemoireDictee(undefined); rmSync(home, { recursive: true, force: true }); }
});
