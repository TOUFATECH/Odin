// Kéryx — l'initiative (« Odin écrit le premier ») : un rappel de rendez-vous qui tombe pendant les heures calmes NE
// DOIT PAS être perdu. Régression du défaut où la clé « déjà dit » était posée AVANT le test des heures calmes, ce qui
// sautait le rappel à jamais. UN FICHIER À LA FOIS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brancherSources } from '../src/valhalla/automatismes.ts';
import { configurerTrace } from '../src/valhalla/keryx/trace.ts';
import { Proactif } from '../src/valhalla/keryx/proactif.ts';
import type { ReglagesKeryx } from '../src/valhalla/keryx/types.ts';

test('proactif : un rappel qui tombe pendant les heures calmes repart une fois le calme terminé (pas perdu)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'keryx-proa-')); configurerTrace(home);
  try {
    const now = Date.parse('2026-11-16T22:00:00.000Z');
    const rdv = new Date(now + 20 * 60_000).toISOString(); // dans 20 min, dans la fenêtre de 30 min
    brancherSources({ agenda: () => [{ quand: rdv, quandTexte: 'à 23 h', titre: 'Dentiste', sorte: 'rendez_vous' }] });
    const reglages: ReglagesKeryx = { ligne: 'aucune', numeros: [], autonomieApresSecret: 'prudent', actionGraveParAppel: 'interdite', surveillances: [{ id: 'r1', quoi: 'rappel_rdv', reglage: '30', actif: true }] };
    const envoyes: string[] = [];
    let calme = true;
    const gw = { notifyOwner: async (t: string): Promise<void> => { envoyes.push(t); }, quietNow: (): string | undefined => (calme ? 'nuit' : undefined) };
    const p = new Proactif(gw, () => reglages);
    // 1) Pendant les heures calmes : rien n'est envoyé, et rien n'est marqué « déjà dit ».
    assert.equal(await p.passer(now), 0);
    assert.equal(envoyes.length, 0);
    // 2) Les heures calmes finies : le rappel repart (il n'a PAS été perdu).
    calme = false;
    assert.equal(await p.passer(now + 60_000), 1);
    assert.equal(envoyes.length, 1);
    assert.match(envoyes[0], /Dentiste/);
    // 3) Ensuite, il ne se répète pas.
    assert.equal(await p.passer(now + 120_000), 0);
  } finally { brancherSources({ agenda: undefined }); rmSync(home, { recursive: true, force: true }); }
});

test('proactif : seuls les RENDEZ-VOUS sont rappelés, jamais une tâche de Talos dans la même fenêtre', async () => {
  const home = mkdtempSync(join(tmpdir(), 'keryx-proa-')); configurerTrace(home);
  try {
    const now = Date.parse('2026-11-16T10:00:00.000Z');
    const dans = (min: number) => new Date(now + min * 60_000).toISOString();
    brancherSources({ agenda: () => [
      { quand: dans(10), quandTexte: 'à 14 h 10', titre: 'Sauvegarde de nuit', sorte: 'tache', appli: 'sindri' },
      { quand: dans(15), quandTexte: 'à 14 h 15', titre: 'Veille des disques', sorte: 'veille', appli: 'durinn' },
      { quand: dans(20), quandTexte: 'à 14 h 20', titre: 'Dentiste', sorte: 'rendez_vous', appli: 'frigg' },
    ] });
    const reglages: ReglagesKeryx = { ligne: 'aucune', numeros: [], autonomieApresSecret: 'prudent', actionGraveParAppel: 'interdite', surveillances: [{ id: 'r1', quoi: 'rappel_rdv', reglage: '30', actif: true }] };
    const envoyes: string[] = [];
    const p = new Proactif({ notifyOwner: async (t: string): Promise<void> => { envoyes.push(t); }, quietNow: (): string | undefined => undefined }, () => reglages);
    assert.equal(await p.passer(now), 1, 'un seul rappel');
    assert.equal(envoyes.length, 1);
    assert.match(envoyes[0], /Dentiste/);
    assert.doesNotMatch(envoyes.join('\n'), /Sauvegarde|Veille/);
  } finally { brancherSources({ agenda: undefined }); rmSync(home, { recursive: true, force: true }); }
});
