// Juger ce qu'Odin apprend AVANT de s'en servir : le niveau de confiance, la cohérence (dates impossibles,
// chiffres absurdes), l'intérêt (pub/hors-sujet écartés) et la fraîcheur (prix/actu courte, définition longue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chiffreAbsurde, dateImpossible, fraicheurDe, FRAICHEUR, juger, niveauDeVerdict, sansInteret } from '../src/learn/confiance.ts';

test('le verdict de la recherche se mappe vers un niveau de confiance', () => {
  assert.equal(niveauDeVerdict({ verdict: 'confirmé', independent: 3 }), 'confirmé');
  assert.equal(niveauDeVerdict({ verdict: 'probable', independent: 1 }), 'à vérifier');
  assert.equal(niveauDeVerdict({ verdict: 'contredit', independent: 0 }), 'contesté');
  assert.equal(niveauDeVerdict({ verdict: 'incertain', independent: 1 }), 'contesté');
  assert.equal(niveauDeVerdict({ verdict: 'insuffisant', independent: 0 }), 'à vérifier');
});

test('« confirmé » demande plusieurs sources ; une seule source reste « à vérifier »', () => {
  const confirme = juger({ texte: 'La tour Eiffel mesure 330 mètres de haut.', verdict: { verdict: 'confirmé', independent: 3 } });
  assert.equal(confirme.niveau, 'confirmé');
  assert.ok(confirme.confiance > 0.8);
  const seule = juger({ texte: 'La tour Eiffel mesure 330 mètres de haut.', verdict: { verdict: 'probable', independent: 1 } });
  assert.equal(seule.niveau, 'à vérifier');
});

test('« contesté » quand les sources se contredisent (les deux versions seront gardées)', () => {
  const j = juger({ texte: 'Le chiffre annoncé est de 12 000.', verdict: { verdict: 'incertain', independent: 2 } });
  assert.equal(j.niveau, 'contesté');
  assert.ok(j.garder, 'un fait contesté est gardé (Odin garde les deux versions)');
});

test('le propriétaire prime : « donné par toi », toujours gardé', () => {
  const j = juger({ texte: 'Mon réveil est à 7 h.', proprietaire: true });
  assert.equal(j.niveau, 'donné par toi');
  assert.equal(j.confiance, 1);
  assert.ok(j.garder);
});

test('une date impossible met le fait en doute (jamais avalé tel quel)', () => {
  assert.equal(dateImpossible('réunion le 30 février 2025'), true);
  assert.equal(dateImpossible('31 avril, fermé'), true);
  assert.equal(dateImpossible('le 28 février, puis le 15 mars'), false);
  const j = juger({ texte: 'La signature a eu lieu le 30 février 2025.', verdict: { verdict: 'confirmé', independent: 3 } });
  assert.equal(j.niveau, 'à vérifier', 'un « confirmé » incohérent redescend à « à vérifier »');
  assert.ok(j.raisons.includes('date impossible'));
});

test('un chiffre absurde met le fait en doute', () => {
  assert.equal(chiffreAbsurde('150 % des électeurs ont voté pour'), true);
  assert.equal(chiffreAbsurde('âgé de 250 ans'), true);
  assert.equal(chiffreAbsurde('80 % des foyers équipés'), false);
  const j = juger({ texte: '150 % des électeurs ont approuvé.', verdict: { verdict: 'confirmé', independent: 2 } });
  assert.equal(j.niveau, 'à vérifier');
  assert.ok(j.raisons.includes('chiffre absurde'));
});

test('la publicité et le hors-sujet ne sont pas retenus', () => {
  assert.equal(sansInteret('Cliquez ici pour profiter de la promo !'), true);
  assert.equal(sansInteret('Acceptez nos cookies pour continuer'), true);
  assert.equal(sansInteret('   '), true);
  assert.equal(sansInteret('La photosynthèse transforme la lumière en énergie.'), false);
  const j = juger({ texte: 'Abonnez-vous à notre newsletter !', verdict: { verdict: 'probable', independent: 1 } });
  assert.equal(j.garder, false);
});

test('la fraîcheur est courte pour un prix ou une actualité, longue pour une définition', () => {
  assert.equal(fraicheurDe("Le prix de l'essence aujourd'hui est de 1,85 €."), FRAICHEUR.COURTE);
  assert.equal(fraicheurDe('Dernière version et mise à jour disponibles.'), FRAICHEUR.COURTE);
  assert.equal(fraicheurDe("Définition de l'osmose : passage d'un solvant."), FRAICHEUR.LONGUE);
  assert.equal(fraicheurDe('La Garonne est un fleuve du sud-ouest.'), FRAICHEUR.MOYENNE);
});
