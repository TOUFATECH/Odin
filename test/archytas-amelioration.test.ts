// Archytas — l'amélioration continue et sa PORTE DE QUALITÉ. Une version améliorée ne remplace l'ancienne que
// si elle garde le même comportement (même suite d'actions d'applis) ; sinon elle est refusée. Les versions
// sont gardées, le retour arrière rétablit l'ancienne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerMoteur, type Proposeur, type ScriptDetail, type Stat } from '../src/valhalla/archytas/scripts.ts';
import { EntrepotFichiers } from '../src/valhalla/archytas/base.ts';
import { porteQualite } from '../src/valhalla/archytas/amelioration.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'archytas-ameli-'));

const detail = (etapes: ScriptDetail['etapes']): ScriptDetail => ({ nom: 'S', mission: 'm', description: '', genre: 'declaratif', version: 1, actif: true, cree: 0, modifie: 0, declencheurs: [{ genre: 'manuel' }], stat: { runs: 0, ok: 0, echecs: 0, msMoyen: 0 }, capacites: [], etapes });

test('porte de qualité : même suite d\'actions acceptée, suite différente refusée', () => {
  const ancien = detail([{ faire: 'action', module: 'a', action: 'x' }, { faire: 'poser', variable: 'v', valeur: '1' }, { faire: 'poser', variable: 'v', valeur: '1' }]);
  // Même suite d'actions (on a juste retiré une pose répétée) : accepté.
  assert.equal(porteQualite(ancien, { pourquoi: 'nettoyage', apercuChange: '3→2', etapes: [{ faire: 'action', module: 'a', action: 'x' }, { faire: 'poser', variable: 'v', valeur: '1' }] }).ok, true);
  // Suite d'actions changée : refusé.
  const chg = porteQualite(ancien, { pourquoi: 'autre', apercuChange: 'x', etapes: [{ faire: 'action', module: 'a', action: 'y' }] });
  assert.equal(chg.ok, false);
  assert.match(chg.raison, /comportement/);
});

test('porte de qualité : un script « code » ne se remplace jamais sans l\'accord du propriétaire', () => {
  const codeScript: ScriptDetail = { ...detail(undefined), genre: 'code', code: 'return 1;' };
  assert.equal(porteQualite(codeScript, { pourquoi: 'x', apercuChange: 'y', code: 'return 2;' }).ok, false);
  assert.equal(porteQualite(codeScript, { pourquoi: 'x', apercuChange: 'y', code: 'return 2;' }, true).ok, true);
});

test('appliquer une amélioration qui change le comportement est refusé ; une qui le garde passe', async () => {
  const home = tmp();
  try {
    // Un faux proposeur qui change la suite d'actions : doit être refusé par la porte.
    const proposeurMauvais: Proposeur = { async proposer() { return { pourquoi: 'change tout', apercuChange: '', etapes: [{ faire: 'action', module: 'autre', action: 'z' }] }; } };
    const m = creerMoteur({ entrepot: new EntrepotFichiers(home), proposeur: proposeurMauvais });
    await m.creer({ nom: 'S', mission: 'm', description: '', genre: 'declaratif', etapes: [{ faire: 'action', module: 'a', action: 'x' }], declencheurs: [{ genre: 'manuel' }] });
    await assert.rejects(() => m.appliquerAmelioration('S'), /comportement/);
    // Le script n'a pas changé.
    assert.deepEqual((await m.voir('S'))!.etapes, [{ faire: 'action', module: 'a', action: 'x' }]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('retour arrière : revenir à une version rétablit l\'ancien comportement', async () => {
  const home = tmp();
  try {
    const m = creerMoteur({ entrepot: new EntrepotFichiers(home) });
    const A = [{ faire: 'action' as const, module: 'a', action: 'x' }];
    const B = [{ faire: 'action' as const, module: 'b', action: 'y' }];
    await m.creer({ nom: 'S', mission: 'm', description: '', genre: 'declaratif', etapes: A, declencheurs: [{ genre: 'manuel' }] });
    await m.editer('S', { etapes: B });
    assert.deepEqual((await m.voir('S'))!.etapes, B);
    await m.revenir('S', 1); // version 1 = l'ancien A
    assert.deepEqual((await m.voir('S'))!.etapes, A, 'le retour arrière rétablit l\'ancienne version');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('le proposeur local garde toujours le comportement (jamais de régression silencieuse)', async () => {
  const home = tmp();
  try {
    const { proposeurLocal } = await import('../src/valhalla/archytas/amelioration.ts');
    const m = creerMoteur({ entrepot: new EntrepotFichiers(home), proposeur: proposeurLocal() });
    // Deux poses identiques d'affilée : le proposeur local les déduplique (forme), sans toucher les actions.
    await m.creer({ nom: 'S', mission: 'm', description: '', genre: 'declaratif', etapes: [{ faire: 'poser', variable: 'v', valeur: '1' }, { faire: 'poser', variable: 'v', valeur: '1' }, { faire: 'action', module: 'a', action: 'x' }], declencheurs: [{ genre: 'manuel' }] });
    const p = await m.proposerAmelioration('S');
    assert.ok(p, 'une amélioration de forme est proposée');
    const r = await m.appliquerAmelioration('S');
    assert.equal(r.version, 2);
    const d = await m.voir('S');
    assert.deepEqual(d!.etapes, [{ faire: 'poser', variable: 'v', valeur: '1' }, { faire: 'action', module: 'a', action: 'x' }]);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
