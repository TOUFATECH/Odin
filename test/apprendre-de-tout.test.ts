// L'entrée unique d'apprentissage : chaque recherche/échange/action range en mémoire avec son niveau de
// confiance, nourrit Noûs (fiable seulement si « confirmé »), ne ré-absorbe pas l'identique, respecte le mode
// privé, et NE laisse JAMAIS une recherche écraser une correction du propriétaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apprendreDeTout, type Apport, type DepsApprentissage } from '../src/learn/apprendre-de-tout.ts';
import { fileBornee, type FileApprentissage, type NoosDeps } from '../src/brain/nous/deps.ts';
import { Mnemosyne } from '../src/muninn/store.ts';

const NOW = Date.UTC(2026, 10, 16, 9);

function monter(): { deps: DepsApprentissage; muninn: Mnemosyne; file: FileApprentissage } {
  const muninn = new Mnemosyne(':memory:');
  const file = fileBornee();
  const nous: NoosDeps = {
    cfg: { learning: { observe: true }, nous: { actif: true } },
    privateMode: () => muninn.privateMode,
    essai: false, // on force : sinon NODE_TEST_CONTEXT tairait nourrir()
    file,
    maintenant: () => NOW,
  };
  return { deps: { memoire: muninn, nous, maintenant: () => NOW }, muninn, file };
}

test('recherche confirmée : souvenir « confirmé », rappelable, et Noûs nourri comme fiable', () => {
  const { deps, muninn, file } = monter();
  const apport: Apport = {
    sorte: 'lecture', source: 'web:tour-eiffel.fr', date: NOW,
    faits: [{ texte: 'La tour Eiffel mesure 330 mètres de haut.', sujet: 'tour eiffel', cle: 'hauteur', verdict: { verdict: 'confirmé', independent: 3 } }],
  };
  const r = apprendreDeTout(deps, apport);
  assert.equal(r.retenus, 1);
  assert.deepEqual(r.niveaux, ['confirmé']);
  // Rangé, rappelable (pas en quarantaine), avec son niveau et sa source.
  const rappel = muninn.recall('tour eiffel hauteur', 6);
  assert.equal(rappel.length, 1);
  assert.equal(rappel[0].origin, 'agent');
  assert.ok(rappel[0].tags.includes('confiance:confirmé'));
  assert.ok((rappel[0].source ?? '').startsWith('web:tour-eiffel.fr@'));
  // Noûs nourri, comme fiable (« confirmé »).
  const ex = file.prendre(10);
  assert.equal(ex.length, 1);
  assert.equal(ex[0].fiable, true);
});

test('une seule source : « à vérifier », en quarantaine (hors du rappel courant), Noûs non fiable', () => {
  const { deps, muninn, file } = monter();
  const r = apprendreDeTout(deps, {
    sorte: 'lecture', source: 'web:blog-perso.fr', date: NOW,
    faits: [{ texte: "L'eau bout à 95 degrés au sommet du mont Blanc.", sujet: 'mont blanc', cle: 'ebullition', verdict: { verdict: 'probable', independent: 1 } }],
  });
  assert.equal(r.retenus, 1);
  assert.deepEqual(r.niveaux, ['à vérifier']);
  const id = r.souvenirs[0];
  assert.equal(muninn.getMemory(id)?.origin, 'untrusted');
  // Exclu du rappel courant (quarantaine).
  assert.equal(muninn.recall('mont blanc ebullition', 6).find((m) => m.id === id), undefined);
  // Noûs nourri mais NON fiable (ne sert qu'à apprendre la langue tant que ce n'est pas confirmé).
  const ex = file.prendre(10);
  assert.equal(ex.length, 1);
  assert.equal(ex[0].fiable, false);
});

test('une correction du propriétaire prime et n\'est JAMAIS écrasée par une recherche', () => {
  const { deps, muninn } = monter();
  // Le propriétaire corrige.
  apprendreDeTout(deps, { sorte: 'correction', source: 'conversation:1', faits: [{ texte: 'Mon réveil est à 7 h.', sujet: 'proprietaire', cle: 'heure reveil' }] });
  // Une recherche « confirmée » prétend autre chose sur le même sujet/clé.
  apprendreDeTout(deps, {
    sorte: 'lecture', source: 'web:horaires.fr',
    faits: [{ texte: 'Le réveil du propriétaire est à 9 h.', sujet: 'proprietaire', cle: 'heure reveil', verdict: { verdict: 'confirmé', independent: 2 } }],
  });
  const fiche = muninn.profile('proprietaire');
  const vivants = fiche.current.map((m) => m.content).join(' | ');
  assert.ok(vivants.includes('7 h'), `la correction du propriétaire reste vivante (${vivants})`);
  // La valeur de la recherche n'est jamais devenue un fait vivant.
  assert.ok(!muninn.listMemories(100).some((m) => m.content.includes('9 h') && !m.superseded_by), 'la recherche n\'écrase pas la correction');
});

test('mode privé : rien n\'est rangé ni nourri', () => {
  const { deps, muninn, file } = monter();
  muninn.privateMode = true;
  const r = apprendreDeTout(deps, {
    sorte: 'lecture', source: 'web:x.fr',
    faits: [{ texte: 'Un fait quelconque à ranger.', sujet: 'x', cle: 'y', verdict: { verdict: 'confirmé', independent: 2 } }],
  });
  assert.equal(r.retenus, 0);
  assert.equal(muninn.listMemories(100).length, 0);
  assert.equal(file.taille(), 0);
});

test('même source, même contenu : pas de ré-absorption (idempotence par empreinte)', () => {
  const { deps, file } = monter();
  const apport: Apport = {
    sorte: 'lecture', source: 'web:meme.fr', date: NOW,
    faits: [{ texte: 'Le fait reste identique entre deux passages.', sujet: 's', cle: 'c', verdict: { verdict: 'confirmé', independent: 2 } }],
  };
  const r1 = apprendreDeTout(deps, apport);
  assert.equal(r1.retenus, 1);
  const taille1 = file.taille();
  const r2 = apprendreDeTout(deps, apport);
  assert.equal(r2.retenus, 0);
  assert.equal(r2.ignores, 1);
  // Noûs n'est pas re-nourri d'un contenu déjà appris.
  assert.equal(file.taille(), taille1);
});
