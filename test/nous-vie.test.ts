// Essais du lot B de Noûs — la « vie » : corpus scellé, fabrique des lots (3 étapes), ordonnancement de nuit.
// Tout est reproductible : hasard à graine, aucun service réel, aucun Math.random.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Corpus, magasinMemoire, encoderTranche, decoderTranche, dedupe, retirerSouvenir, nomTranche, type ExempleCorpus } from '../src/brain/nous/corpus.ts';
import { prng, tirer, importance, poidsAlignement, poidsLot, aRejouerCetteNuit, composerLot, paireAjustement, lotPreEntrainement, ESPACEMENT } from '../src/brain/nous/etapes.ts';
import { divergence, porteDeQualite, doitSArreter, seanceDeNuit, type EntraineurMin, type Avancee } from '../src/brain/nous/nuit.ts';
import { apprendreDuel, proposerLiensAppris, cosinus, forceNoos, NOEUD_NOOS } from '../src/brain/nous/carte.ts';
import { R } from '../src/brain/neurones.ts';

const ex = (ids: number[], extra: Partial<ExempleCorpus> = {}): ExempleCorpus => ({ morceaux: Int32Array.from(ids), sorte: 'lecture', fiable: false, ...extra });

// ---------------------------------------------------------------------------------------------------
test('corpus : sérialisation aller-retour, doublons retirés', () => {
  const liste = [ex([1, 2, 3], { sorte: 'echange', fiable: true, idSouvenir: 7 }), ex([4, 5])];
  const round = decoderTranche(encoderTranche(liste));
  assert.equal(round.length, 2);
  assert.deepEqual([...round[0].morceaux], [1, 2, 3]);
  assert.equal(round[0].sorte, 'echange');
  assert.equal(round[0].fiable, true);
  assert.equal(round[0].idSouvenir, 7);
  assert.equal(round[1].idSouvenir, undefined);
  // Doublons.
  assert.equal(dedupe([ex([1, 2]), ex([1, 2]), ex([3])]).length, 2);
});

test('corpus : oubli — effacer un souvenir retire ses exemples, le nombre baisse', () => {
  const c = new Corpus(magasinMemoire()); // scellage identité en essai
  c.ajouter('20261116', 'web', [ex([1], { idSouvenir: 42 }), ex([2], { idSouvenir: 42 }), ex([3], { idSouvenir: 99 })]);
  assert.equal(c.compter(), 3);
  const retires = c.oublier(42);
  assert.equal(retires, 2);
  assert.equal(c.compter(), 1);
  // retirerSouvenir pur.
  assert.equal(retirerSouvenir([ex([1], { idSouvenir: 1 }), ex([2], { idSouvenir: 2 })], 1).length, 1);
});

test('corpus : plafond par source : part plafonnee', () => {
  const c = new Corpus(magasinMemoire());
  const n = c.ajouter('20261116', 'siteX', [ex([1]), ex([2]), ex([3]), ex([4])], 2 /* plafond */);
  assert.equal(n, 2);
  assert.equal(c.compterSource('siteX'), 2);
  assert.equal(nomTranche('20261116', 'Site X!'), 'tranche-20261116-site-x.bin');
});

// ---------------------------------------------------------------------------------------------------
test('étapes : hasard à graine reproductible, pas de Math.random', () => {
  const a = prng(123), b = prng(123);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepEqual(sa, sb); // même graine => même suite
  assert.notDeepEqual(sa, [prng(124)(), prng(124)(), prng(124)()]);
  // tirer : sans remise, déterministe à la graine.
  assert.deepEqual(tirer([1, 2, 3, 4, 5], 3, prng(1)), tirer([1, 2, 3, 4, 5], 3, prng(1)));
});

test('étapes : importance, poids alignement, espacement', () => {
  const base = importance({ correction: false, surprise: 0, repetitions: 0, marque: false, nouveaute: 0 });
  assert.equal(base, 1);
  assert.ok(importance({ correction: true, surprise: 1, repetitions: 10, marque: true, nouveaute: 1 }) > base);
  // Poids d'alignement : |note − confiance|, au moins 0,1.
  assert.ok(Math.abs(poidsAlignement(1, 0.2) - 0.8) < 1e-9); // sûr (0,2) et refusé/noté 1 => apprend beaucoup
  assert.equal(poidsAlignement(0.9, 0.9), 0.1); // acceptée et attendue => presque rien (plancher 0,1)
  assert.equal(poidsLot([1, 0], [0.2, 0]).length, 2);
  // Espacement : important => J+1,3,7,30 ; ordinaire => J+1 seulement.
  const JOUR = 86_400_000;
  for (const d of ESPACEMENT) assert.equal(aRejouerCetteNuit(0, d * JOUR, 5), true);
  assert.equal(aRejouerCetteNuit(0, 2 * JOUR, 5), false); // J+2 non planifié
  assert.equal(aRejouerCetteNuit(0, 1 * JOUR, 1), true);  // ordinaire J+1
  assert.equal(aRejouerCetteNuit(0, 3 * JOUR, 1), false); // ordinaire pas à J+3
});

test('étapes : composition 50/30/20 déterministe ; ajustement masque la demande', () => {
  const nouveaux = Array.from({ length: 50 }, (_, i) => ex([i]));
  const anciens = Array.from({ length: 50 }, (_, i) => ex([100 + i]));
  const rappel = Array.from({ length: 50 }, (_, i) => ex([200 + i]));
  const lot1 = composerLot(nouveaux, anciens, rappel, 10, prng(5));
  const lot2 = composerLot(nouveaux, anciens, rappel, 10, prng(5));
  assert.equal(lot1.length, 10);
  assert.deepEqual(lot1.map((e) => [...e.morceaux]), lot2.map((e) => [...e.morceaux])); // reproductible
  // Pré-entraînement : un lot = les morceaux.
  assert.equal(lotPreEntrainement([ex([1, 2])]).entrees[0].length, 2);
  // Ajustement : on n'apprend pas « sur la demande ».
  const { entree, roles } = paireAjustement(Int32Array.from([1, 2]), Int32Array.from([3, 4]), { demandeDebut: 90, reponseDebut: 91, fin: 92 });
  assert.deepEqual([...entree], [90, 1, 2, 91, 3, 4, 92]);
  // Les positions de la demande (jusqu'au jeton réponse exclu) sont à 0.
  assert.deepEqual([...roles.slice(0, 3)], [0, 0, 0]);
  assert.ok([...roles.slice(3)].every((r) => r === 1));
});

// ---------------------------------------------------------------------------------------------------
// Nuit : porte de qualité et retour arrière avec un faux moteur.
function fauxEntraineur(perteAvant: number, perteApres: number): EntraineurMin & { ecrits: number[]; retours: number[] } {
  const appels = { ecrits: [] as number[], retours: [] as number[] };
  let premier = true;
  const av: Avancee = { pas: 1, morceauxVus: 100, perte: perteApres, tempsMs: 10, interrompue: false };
  return {
    ...appels,
    async seance() { return av; },
    async perteSur() { const p = premier ? perteAvant : perteApres; premier = false; return p; },
    async ecrire(n) { appels.ecrits.push(n); return `reprise-${n}.bin`; },
    async revenirA(n) { appels.retours.push(n); },
  };
}
function depsNuit(e: EntraineurMin) {
  return { entraineur: e, banc: () => [Int32Array.from([1, 2])], lots: () => [], dernierPoint: 3, graine: 1, heuresNuit: 0.0001, filsNuit: 3, signal: new AbortController().signal };
}

test('nuit : un réseau MEILLEUR sur le banc passe en service (point écrit)', async () => {
  const e = fauxEntraineur(2.0, 1.5);
  const b = await seanceDeNuit(depsNuit(e));
  assert.equal(b.misEnService, true);
  assert.equal(b.raison, 'mieux');
  assert.deepEqual((e as any).ecrits, [4]); // dernierPoint 3 → 4
  assert.deepEqual((e as any).retours, []);
});

test('nuit : un reseau PIRE (perte qui remonte) nest pas mis en service, retour arrière', async () => {
  const e = fauxEntraineur(1.5, 2.0); // la perte remonte => divergence
  const b = await seanceDeNuit(depsNuit(e));
  assert.equal(b.misEnService, false);
  assert.equal(b.raison, 'divergence');
  assert.deepEqual((e as any).retours, [3]); // revient au dernier bon
  assert.deepEqual((e as any).ecrits, []);
});

test('nuit : un reseau PAS MEILLEUR (perte égale) nest pas mis en service, retour arrière', async () => {
  const e = fauxEntraineur(1.5, 1.5); // ni mieux ni divergent
  const b = await seanceDeNuit(depsNuit(e));
  assert.equal(b.misEnService, false);
  assert.equal(b.raison, 'pas-mieux');
  assert.deepEqual((e as any).retours, [3]);
  assert.deepEqual((e as any).ecrits, []);
});

test('nuit : une perte NaN (divergence) déclenche le retour arrière', async () => {
  const e = fauxEntraineur(1.5, NaN);
  const b = await seanceDeNuit(depsNuit(e));
  assert.equal(b.misEnService, false);
  assert.equal(b.raison, 'divergence');
  assert.deepEqual((e as any).retours, [3]);
});

test('nuit : un réseau NEUF (aucun point en service) ne plante jamais, même si le retour arrière lève', async () => {
  // Réseau neuf : revenirA LÈVE (aucun point de reprise à relire). La séance de nuit ne doit PAS remonter l'erreur.
  const retours: number[] = [];
  const base: EntraineurMin = {
    async seance() { return { pas: 1, morceauxVus: 10, perte: 1.5, tempsMs: 1, interrompue: false }; },
    async perteSur() { return 1.5; }, // perte égale ⇒ « pas-mieux » ⇒ on voudrait revenir en arrière
    async ecrire(n) { return `reprise-${n}.bin`; },
    async revenirA(n) { retours.push(n); throw new Error('point de reprise introuvable'); },
  };
  const deps = { entraineur: base, banc: () => [Int32Array.from([1, 2])], lots: () => [], dernierPoint: -1, graine: 1, heuresNuit: 0.0001, filsNuit: 3, signal: new AbortController().signal };
  let b!: Awaited<ReturnType<typeof seanceDeNuit>>;
  await assert.doesNotReject(async () => { b = await seanceDeNuit(deps); });
  assert.equal(b.misEnService, false);
  assert.equal(b.raison, 'pas-mieux');
  assert.deepEqual(retours, [], 'aucun point en service (dernierPoint < 0) ⇒ on ne tente aucun retour arrière');

  // Et si un point est bien en service mais que son fichier a disparu, la panne du retour arrière est avalée.
  const retours2: number[] = [];
  const e2: EntraineurMin = { ...base, async revenirA(n) { retours2.push(n); throw new Error('fichier disparu'); } };
  await assert.doesNotReject(() => seanceDeNuit({ ...deps, entraineur: e2, dernierPoint: 2 }));
  assert.deepEqual(retours2, [2], 'on tente le retour (point en service) mais une panne ne remonte jamais jusqu\'à Odin');
});

test('nuit : porte de qualité, divergence et arrêt (helpers purs)', () => {
  assert.equal(porteDeQualite(2, 1.5), true);
  assert.equal(porteDeQualite(2, 2), false);
  assert.equal(divergence(1.5, NaN), true);
  assert.equal(divergence(1.5, Infinity), true);
  assert.equal(divergence(1.5, 2), true);
  assert.equal(divergence(1.5, 1.4), false);
  assert.equal(doitSArreter(1, 0.1, 0.8), true); // Odin répond
  assert.equal(doitSArreter(0, 0.95, 0.8), true); // machine chargée
  assert.equal(doitSArreter(0, 0.2, 0.8), false);
});

// ---------------------------------------------------------------------------------------------------
// Carte : le nœud Noûs monte quand il gagne, pas quand il perd ; liens appris sous plafonds.
test('carte : un lien noos sujet monte quand Noûs gagne, reste à sa base quand il perd', () => {
  const now = 1_000_000_000;
  const g = apprendreDuel(undefined, 'n:note-A', true, now);
  assert.ok(forceNoos(g.lien, now) > R.BASE.appris, 'gagner renforce le lien');
  const p = apprendreDuel(undefined, 'n:note-B', false, now);
  assert.ok(Math.abs(forceNoos(p.lien, now) - R.BASE.appris) < 1e-9, 'perdre ne renforce pas');
  assert.equal(p.retenu, 0);
  // La clé inclut le nœud 'noos'.
  assert.ok(g.lien.a === NOEUD_NOOS || g.lien.b === NOEUD_NOOS);
});

test('carte : liens appris proposés sous les plafonds APPRIS_PAR_POINT et TOTAL_APPRIS', () => {
  const cands = [
    { a: 'n:1', b: 'n:2', similarite: 0.9 },
    { a: 'n:1', b: 'n:3', similarite: 0.8 },
    { a: 'n:1', b: 'n:4', similarite: 0.4 }, // sous le seuil
  ];
  // Plafond par point simulé : 'n:1' a déjà APPRIS_PAR_POINT - 1 liens → une seule proposition passe.
  const deja = (id: string) => (id === 'n:1' ? R.APPRIS_PAR_POINT - 1 : 0);
  const out = proposerLiensAppris(cands, 0.5, deja, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].b, 'n:2'); // la plus proche d'abord
  // Plafond total atteint → rien.
  assert.equal(proposerLiensAppris(cands, 0.5, () => 0, R.TOTAL_APPRIS).length, 0);
  // Cosinus.
  assert.ok(Math.abs(cosinus(Float32Array.from([1, 0]), Float32Array.from([1, 0])) - 1) < 1e-9);
  assert.ok(Math.abs(cosinus(Float32Array.from([1, 0]), Float32Array.from([0, 1]))) < 1e-9);
});
