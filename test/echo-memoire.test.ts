// Écho · pont vers la mémoire d'Odin. On vérifie : seul un POINTEUR NEUTRE entre en mémoire (jamais le texte des tours
// ni le résumé), un titre neutre correct, et la suppression qui retire le pointeur. La mémoire est remplacée par un
// faux (le module ne connaît pas muninn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brancherMemoireConversation, noterConversation, oublierConversation, titreNeutre } from '../src/valhalla/rodd/conversation-memoire.ts';
import type { PointeurConversation } from '../src/valhalla/rodd/conversation-memoire.ts';

test('titre neutre : date, langues, nombre de tours', () => {
  assert.equal(titreNeutre({ date: '2026-11-16T14:02:00', langues: ['français', 'japonais'], nTours: 12 }), 'Conversation traduite du 2026-11-16, français ↔ japonais, 12 tours');
  assert.equal(titreNeutre({ date: '2026-11-16T09:00:00', langues: ['français', 'anglais'], nTours: 1 }), 'Conversation traduite du 2026-11-16, français ↔ anglais, 1 tour');
});

test('pointeur neutre : aucun texte de tour ni résumé ; titre par défaut ; suppression', () => {
  const notes: PointeurConversation[] = [], oublis: string[] = [];
  brancherMemoireConversation({ noter: (p) => notes.push(p), oublier: (c) => oublis.push(c) });
  try {
    // Un titre par défaut (calculé) quand le propriétaire n'en donne pas.
    noterConversation({ conv: 'c1', titre: '', langues: ['français', 'japonais'], nTours: 12, date: '2026-11-16T14:02:00' });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].titre, 'Conversation traduite du 2026-11-16, français ↔ japonais, 12 tours');
    // Le titre court du propriétaire est gardé tel quel.
    noterConversation({ conv: 'c2', titre: 'Le livreur japonais de mardi', parProprietaire: true, langues: ['français', 'japonais'], nTours: 4, date: '2026-11-17T10:00:00' });
    assert.equal(notes[1].titre, 'Le livreur japonais de mardi'); assert.equal(notes[1].parProprietaire, true);
    // Aucun des pointeurs ne contient de texte de tour ni de résumé : seulement titre, langues, nTours, date, conv.
    for (const p of notes) assert.deepEqual(Object.keys(p).sort(), ['conv', 'date', 'langues', 'nTours', 'parProprietaire', 'titre'].filter((k) => k in p).sort());
    // Un identifiant invalide n'entre pas.
    noterConversation({ conv: 'mauvais/id', titre: 'x', langues: [], nTours: 1, date: '2026-11-16' });
    assert.equal(notes.length, 2);
    // Suppression : le pointeur est retiré par l'identifiant.
    oublierConversation('c1'); assert.deepEqual(oublis, ['c1']);
    oublierConversation('mauvais/id'); assert.deepEqual(oublis, ['c1'], 'identifiant invalide ignoré');
  } finally { brancherMemoireConversation(undefined); }
  // Débranché : plus rien n'est noté (pas d'erreur).
  noterConversation({ conv: 'c3', titre: 'x', langues: [], nTours: 1, date: '2026-11-16' });
  oublierConversation('c3');
});
