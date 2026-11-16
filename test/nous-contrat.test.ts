// Essai d'intégration « au contrat » A↔B, au niveau des types : le vrai Moteur / Entraîneur du lot A
// (src/brain/nous/moteur.ts) satisfait les interfaces minimales contre lesquelles le lot B a codé, et les
// formats de lot et de séance sont identiques des deux côtés. Vérifié par tsc (import type, aucune exécution
// du moteur). Si lot A change ces types, cet essai le signale.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Moteur, Entraineur, Lot as LotMoteur, SeanceOpts as SeanceOptsMoteur, Avancee as AvanceeMoteur } from '../src/brain/nous/moteur.ts';
import type { MoteurRef } from '../src/brain/nous/deps.ts';
import type { EntraineurMin, Avancee as AvanceeB, SeanceOpts as SeanceOptsB } from '../src/brain/nous/nuit.ts';
import type { Lot as LotB } from '../src/brain/nous/etapes.ts';

// « B satisfait par A » : A doit être assignable à B (A possède au moins les membres de B).
type Satisfait<Attendu, Fourni extends Attendu> = Fourni;

// Chaque ligne échoue à la compilation si la compatibilité est rompue.
type _1 = Satisfait<MoteurRef, Moteur>;               // le Moteur fournit plonger/scoreDe/pret
type _2 = Satisfait<EntraineurMin, Entraineur>;       // l'Entraîneur fournit seance/perteSur/ecrire/revenirA
type _3 = Satisfait<LotB, LotMoteur>;                 // Lot identiques (sens 1)
type _3b = Satisfait<LotMoteur, LotB>;                // Lot identiques (sens 2)
type _4 = Satisfait<SeanceOptsB, SeanceOptsMoteur>;   // SeanceOpts identiques
type _4b = Satisfait<SeanceOptsMoteur, SeanceOptsB>;
type _5 = Satisfait<AvanceeB, AvanceeMoteur>;         // Avancee identiques
type _5b = Satisfait<AvanceeMoteur, AvanceeB>;

// Un emploi des alias pour que tsc les vérifie vraiment (évite « déclaré mais jamais lu »).
type _Toutes = [_1, _2, _3, _3b, _4, _4b, _5, _5b];

test('contrat A↔B : le moteur du lot A satisfait les interfaces minimales du lot B', () => {
  // La vraie vérification est faite par tsc ci-dessus ; ici on confirme juste que l'essai a chargé.
  const _marque: _Toutes | undefined = undefined;
  assert.equal(_marque, undefined);
});
