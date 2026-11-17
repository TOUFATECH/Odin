// Ce qu'Odin cherche pour le propriétaire est appris aussi : après une recherche vérifiée, les affirmations PROUVÉES
// passent par l'entrée commune d'apprentissage (niveau, source, date), sans doublon ; rien en mode privé ; une
// affirmation sans preuve n'est jamais rangée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apportsDeRecherche, apprendreDeLaRecherche, depsRecherche, peutApprendreDeLaRecherche, type RechercheVerifiee } from '../src/learn/apprendre-recherche.ts';
import { fileBornee, type NoosDeps } from '../src/brain/nous/deps.ts';
import { Mnemosyne } from '../src/muninn/store.ts';
import { fileNousOdin } from '../src/brain/nous/file-odin.ts';

const NOW = Date.UTC(2026, 10, 17, 9);
const R: RechercheVerifiee = {
  question: 'Quelle est la fréquence radio du protocole Zigbee en Europe ?',
  sources: [{ n: 1, site: 'zigbee.example.org' }, { n: 2, site: 'domotique.example.fr' }, { n: 3, site: 'forum.example.net' }],
  claims: [
    { claim: 'Zigbee fonctionne dans la bande des 2,4 GHz partout dans le monde.', verdict: 'confirmé', independent: 2, evidence: [{ source: 1, stance: 'pour' }, { source: 2, stance: 'pour' }] },
    { claim: 'En Europe, Zigbee peut aussi utiliser la bande des 868 MHz.', verdict: 'probable', independent: 1, evidence: [{ source: 2, stance: 'pour' }] },
    { claim: 'Zigbee utilise toujours le 915 MHz en Europe.', verdict: 'contredit', independent: 0, evidence: [{ source: 1, stance: 'contre' }, { source: 3, stance: 'pour' }] },
    { claim: 'Zigbee consomme moins que tous les autres protocoles.', verdict: 'insuffisant', independent: 0, evidence: [] },
  ],
};

function monter() {
  const muninn = new Mnemosyne(':memory:');
  const file = fileBornee();
  const nous: NoosDeps = { cfg: { learning: { observe: true }, nous: { actif: true } }, privateMode: () => muninn.privateMode, essai: false, file };
  return { muninn, file, deps: { memoire: muninn, nous, maintenant: () => NOW } };
}

test('les affirmations prouvées deviennent des souvenirs avec niveau, source et date ; sans preuve, rien', () => {
  assert.equal(apportsDeRecherche(R, NOW).length, 2, 'ni l\'affirmation sans preuve, ni la contredite');
  const { muninn, file, deps } = monter();
  const res = apprendreDeLaRecherche(deps, R);
  assert.deepEqual(res.map((x) => x.niveaux[0]), ['confirmé', 'à vérifier']);
  const conf = muninn.recall('Zigbee bande 2,4 GHz', 6).find((m) => m.tags.includes('confiance:confirmé'));
  assert.ok(conf);
  assert.equal(conf!.origin, 'agent');
  assert.equal(conf!.source, 'web:domotique.example.fr+zigbee.example.org@2026-11-17');
  assert.ok(!muninn.recall('Zigbee consomme moins', 6).some((m) => /consomme moins/.test(m.content)), 'jamais l\'affirmation sans preuve');
  // Noûs : le confirmé comme fiable, le reste pour la langue seulement.
  const ex = file.prendre(10);
  assert.ok(ex.some((e) => e.fiable && /2,4 GHz/.test(e.texte)));
  assert.ok(ex.some((e) => !e.fiable && /868 MHz/.test(e.texte)));
});

test('la même recherche apprise deux fois : rien n\'est réappris (empreinte)', () => {
  const { deps } = monter();
  apprendreDeLaRecherche(deps, R);
  const deux = apprendreDeLaRecherche(deps, R);
  assert.equal(deux.reduce((s, x) => s + x.retenus, 0), 0);
  assert.equal(deux.reduce((s, x) => s + x.ignores, 0), 2);
});

test('mode privé : rien n\'est appris', () => {
  const { muninn, deps } = monter();
  assert.deepEqual(apprendreDeLaRecherche(deps, R, { prive: true }), []);
  muninn.privateMode = true;
  apprendreDeLaRecherche(deps, R);
  muninn.privateMode = false;
  assert.equal(muninn.recall('Zigbee', 6).length, 0);
});

test('une affirmation contredite n\'est ni rangée ni donnée à Noûs', () => {
  const { muninn, file, deps } = monter();
  apprendreDeLaRecherche(deps, R);
  assert.ok(!muninn.recall('Zigbee 915 MHz Europe', 10, true).some((m) => /915 MHz/.test(m.content)), 'pas de souvenir du démenti');
  assert.ok(!file.prendre(50).some((e) => /915 MHz/.test(e.texte)), 'rien pour Noûs');
});

test('seul le propriétaire, dans une conversation non marquée, hors mode privé, fait apprendre la recherche', () => {
  assert.equal(peutApprendreDeLaRecherche({ proprietaire: true, marquee: false, prive: false }), true);
  assert.equal(peutApprendreDeLaRecherche({ proprietaire: false, marquee: false, prive: false }), false, 'un invité : rien');
  assert.equal(peutApprendreDeLaRecherche({ proprietaire: true, marquee: true, prive: false }), false, 'conversation marquée : rien');
  assert.equal(peutApprendreDeLaRecherche({ proprietaire: true, marquee: false, prive: true }), false, 'mode privé : rien');
});

test('Noûs coupé ou sans configuration : la recherche ne remplit pas sa file', () => {
  // essai: false pour que la garde de Noûs soit vraiment jugée (sous le lanceur d'essais, nourrir() ne fait rien).
  const deps = (odin?: Parameters<typeof depsRecherche>[1]) => {
    const d = depsRecherche(new Mnemosyne(':memory:'), odin);
    return { ...d, nous: { ...d.nous!, essai: false }, maintenant: () => NOW };
  };
  const cas = [
    { cfg: { nous: { actif: false } }, paths: { home: '' } },
    undefined,
  ];
  for (const odin of cas) {
    fileNousOdin.vider();
    apprendreDeLaRecherche(deps(odin), R);
    assert.equal(fileNousOdin.taille(), 0, `file vide (${JSON.stringify(odin ?? 'sans configuration')})`);
  }
  // Allumé : la file reçoit bien le fait confirmé (la garde n'est pas seulement fermée).
  fileNousOdin.vider();
  apprendreDeLaRecherche(deps({ cfg: { nous: { actif: true } }, paths: { home: '' } }), R);
  assert.ok(fileNousOdin.taille() > 0);
  fileNousOdin.vider();
});
