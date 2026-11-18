// Profil, lot 5 : le journal des changements de droits est branché PAR ODIN lui-même, à son démarrage (startValhalla).
// Ici, personne ne le branche à la main : un droit donné dans Persona par le propriétaire, validation à l'appui, écrit
// une ligne « droit » au journal des personnes ; à l'arrêt, le branchement est défait.
// Un vrai Odin (serveur web + applis), dossiers jetables, personnes inventées.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { groupesDe, persona } from '../src/valhalla/sso/etat.ts';
import { readFileSync } from 'node:fs';

const MDP = 'cerf-volant-vert-sur-la-dune-47';
const IDS = ['var', 'brisingamen', 'garmr', 'valgrind', 'hlid'];
interface LigneDroit { sorte: string; droit?: { registre: string; pour: string; quoi: string; avant: string; apres: string; sens: string } }

test('journal des droits : branché au démarrage d\'Odin, un accès donné dans Persona y est écrit ; débranché à l\'arrêt', { timeout: 180_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => IDS.includes(m.id)) }), va = valhallaOf()!, mu = v.o.muninn;
    const droits = () => mu.lignesHistorique((l) => (l.sorte as string) === 'droit') as unknown as LigneDroit[];
    await va.act('var', 'ajouter', { login: 'personne-a', nom: 'Personne A', groupes: 'invite', mot_de_passe: MDP });
    const avant = droits().length;
    // Sans validation : rien n'est donné, rien n'est écrit comme « donné ».
    const sans = await v.json('/api/valhalla/act', { module: 'var', action: 'donner_acces', input: { appli: 'venus', qui: '@personne-a' } });
    assert.notEqual(sans.body.ok, true, 'donner sans validation est refusé');
    assert.ok(!groupesDe(persona()!, 'venus').includes('@personne-a'), 'rien n\'est donné sans validation');
    assert.equal(droits().filter((l) => l.droit?.sens === 'donne' && l.droit.pour === '@personne-a' && l.droit.quoi.startsWith('acces:')).length, 0);
    // Avec la validation du propriétaire : l'accès est donné, et le journal le dit — sans que l'essai ait rien branché.
    const d = await v.json('/api/valhalla/act', { module: 'var', action: 'donner_acces', input: { appli: 'venus', qui: '@personne-a' }, confirm: true });
    assert.equal(d.body.ok, true, JSON.stringify(d.body).slice(0, 300));
    assert.ok(groupesDe(persona()!, 'venus').includes('@personne-a'), 'l\'accès est donné');
    const ligne = droits().filter((l) => l.droit?.sens === 'donne' && l.droit.pour === '@personne-a' && l.droit.quoi.startsWith('acces:')).at(-1);
    assert.ok(droits().length > avant && ligne, `une ligne « droit » de plus (${avant} → ${droits().length})`);
    assert.equal(ligne!.droit!.registre, 'persona');
    assert.ok(!JSON.stringify(ligne).includes(MDP), 'jamais un mot de passe au journal');
    // À l'arrêt, Odin défait son branchement (lu dans le code : le même endroit que les autres branchements de la mémoire).
    const src = readFileSync(new URL('../src/valhalla/odin.ts', import.meta.url), 'utf8');
    assert.match(src, /brancherJournalDroits\(\(c\) => noterDroit\(odin\.muninn, c\)\)/, 'branché au démarrage');
    assert.ok(src.split(/\r?\n/).some((l) => l.includes('return () => {') && l.includes('brancherJournalDroits(undefined)')), 'débranché à l\'arrêt');
  } finally { for (const k of ['log', 'error', 'warn'] as const) console[k] = orig[k]; await tt.end(); }
});
