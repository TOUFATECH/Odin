// Le cœur de calcul de Noûs (src/brain/nous/calcul.ts) : gradients justes, masque causal, perte qui tombe,
// reproductible à la graine, génération avec/sans mémoire des clés/valeurs identique, arrêt propre.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Reseau, perteSur, seance, type LotBrut } from '../src/brain/nous/calcul.ts';
import { avecPoids, mesurerEtChoisir, TAILLES } from '../src/brain/nous/tailles.ts';

const petitEssai = avecPoids({ taille: 'petit', C: 16, couches: 2, tetes: 2, vocab: 11, contexte: 8 });

test('rétropropagation : dérivées à ~1e-3 des différences finies (bruit Float32 normal)', () => {
  const r = new Reseau(petitEssai); r.initialiser(42);
  const ids = new Int32Array([1, 5, 2, 8, 3, 0, 7, 4]);
  const perte = (): number => { r.jeterGrad(); const l = r.perteEtGrad(ids); r.jeterGrad(); return l; };
  r.jeterGrad(); r.perteEtGrad(ids); const g = Float32Array.from(r.grads); r.jeterGrad();
  const d = r.disp, eps = 1e-3;
  const indices = [d.wte + 7, d.wpe + 3, d.couches[0].wq + 5, d.couches[0].wo + 11, d.couches[0].w1 + 33, d.couches[0].w2 + 20, d.couches[1].wk + 9, d.lnfg + 2, d.couches[0].ln2b + 4];
  let pire = 0;
  for (const i of indices) {
    const orig = r.poids[i];
    r.poids[i] = orig + eps; const lp = perte();
    r.poids[i] = orig - eps; const lm = perte();
    r.poids[i] = orig;
    const num = (lp - lm) / (2 * eps), ana = g[i];
    const rel = Math.abs(num - ana) / Math.max(1e-4, Math.abs(num) + Math.abs(ana));
    if (rel > pire) pire = rel;
  }
  assert.ok(pire < 5e-2, `écart relatif maximal ${pire.toExponential(3)}`);
});

test('masque causal : changer un morceau futur ne change aucune sortie antérieure', () => {
  const r = new Reseau(petitEssai); r.initialiser(3);
  const ids = new Int32Array([1, 5, 2, 8, 3, 0, 7, 4]);
  const a = r.avant(ids, true).logits!;
  const ids2 = Int32Array.from(ids); ids2[7] = (ids2[7] + 3) % petitEssai.vocab; // change le dernier morceau
  const b = r.avant(ids2, true).logits!;
  const V = r.disp.V;
  for (let t = 0; t < ids.length - 1; t++) for (let vv = 0; vv < V; vv++) {
    assert.equal(a[t * V + vv], b[t * V + vv], `la position ${t} ne doit pas dépendre du morceau futur`);
  }
});

test('la perte tombe sur un minuscule corpus appris par cœur', () => {
  const hy = avecPoids({ taille: 'petit', C: 32, couches: 3, tetes: 4, vocab: 16, contexte: 16 });
  const r = new Reseau(hy); r.initialiser(7);
  const corpus = [new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]), new Int32Array([9, 10, 11, 12, 1, 2, 3, 4]), new Int32Array([5, 6, 7, 8, 9, 10, 11, 12])];
  let premiere = 0, derniere = 0;
  for (let s = 0; s < 160; s++) {
    r.jeterGrad(); let L = 0; for (const seq of corpus) L += r.perteEtGrad(seq); L /= corpus.length; r.pasAdamW(1e-3);
    if (s === 0) premiere = L; derniere = L;
  }
  assert.ok(Math.abs(premiere - Math.log(16)) < 0.3, `départ ~ln(16) : ${premiere.toFixed(3)}`);
  assert.ok(derniere < 0.5, `perte finale ${derniere.toFixed(3)} doit être proche de 0`);
});

test('reproductible : même graine => mêmes poids et mêmes sorties', () => {
  const r1 = new Reseau(petitEssai); r1.initialiser(99);
  const r2 = new Reseau(petitEssai); r2.initialiser(99);
  assert.deepEqual(Array.from(r1.poids), Array.from(r2.poids));
  const ids = new Int32Array([2, 4, 6, 1, 3]);
  assert.deepEqual(Array.from(r1.avant(ids, true).logits!), Array.from(r2.avant(ids, true).logits!));
  const g1 = r1.generer([1, 2, 3], 5, { temperature: 0.8, graine: 123 });
  const g2 = r2.generer([1, 2, 3], 5, { temperature: 0.8, graine: 123 });
  assert.deepEqual(g1.ids, g2.ids, 'génération à même graine identique');
});

test('température : elle agit vraiment (basse concentre sur l\'argmax, haute disperse)', () => {
  // Réseau un peu entraîné pour qu\'un jeton se détache après un contexte donné.
  const hy = avecPoids({ taille: 'petit', C: 32, couches: 3, tetes: 4, vocab: 16, contexte: 16 });
  const r = new Reseau(hy); r.initialiser(7);
  const corpus = [new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]), new Int32Array([9, 10, 11, 12, 1, 2, 3, 4])];
  for (let s = 0; s < 120; s++) { r.jeterGrad(); for (const seq of corpus) r.perteEtGrad(seq); r.pasAdamW(1e-3); }
  const amorce = [1, 2, 3, 4, 5, 6, 7];
  const histo = (temp: number): number[] => { const h = new Array(hy.vocab).fill(0); for (let g = 1; g <= 300; g++) h[r.generer(amorce, 1, { temperature: temp, graine: g }).ids[0]]++; return h; };
  const bas = histo(0.3), haut = histo(3);
  // Si la température était ignorée (bug : division codée par 1), les deux tirages seraient IDENTIQUES.
  assert.notDeepEqual(bas, haut, 'la température doit changer la distribution des tirages');
  const argmax = r.generer(amorce, 1, { temperature: 0 }).ids[0];
  assert.ok(bas[argmax] > haut[argmax], `T basse doit choisir l'argmax plus souvent (${bas[argmax]} vs ${haut[argmax]})`);
});

test('mémoire des clés/valeurs : logits identiques à la passe complète (~1e-4 en Float32)', () => {
  const r = new Reseau(petitEssai); r.initialiser(5);
  const seq = new Int32Array([1, 4, 2, 7, 3, 6, 5]);
  const cache = r.logitsCache(seq), plein = r.logitsDerniere(seq);
  let pire = 0; for (let i = 0; i < plein.length; i++) pire = Math.max(pire, Math.abs(cache[i] - plein[i]));
  assert.ok(pire < 1e-3, `écart max cache/plein ${pire.toExponential(3)}`);
  // et la génération gloutonne doit donner la même suite avec et sans cache
  const avec = r.generer([1, 2, 3, 4], 6, { temperature: 0 }).ids;
  const sans = r.genererSansCache([1, 2, 3, 4], 6);
  assert.deepEqual(avec, sans, 'génération gloutonne identique avec et sans cache');
});

test('arrêt : un signal avant la séance renvoie interrompue=true sans toucher aux poids', () => {
  const r = new Reseau(petitEssai); r.initialiser(11);
  const avant = Float32Array.from(r.poids);
  const lots: LotBrut[] = [{ entrees: [new Int32Array([1, 2, 3, 4, 5]), new Int32Array([5, 4, 3, 2, 1])] }];
  const av = seance(r, lots, { dureeMs: 5000, graine: 1, signal: { aborted: true } });
  assert.equal(av.interrompue, true);
  assert.equal(av.pas, 0);
  assert.deepEqual(Array.from(r.poids), Array.from(avant), 'poids inchangés après arrêt immédiat');
});

test('séance courte : la perte est finie et des pas sont faits', () => {
  const r = new Reseau(petitEssai); r.initialiser(13);
  const entrees: Int32Array[] = []; for (let i = 0; i < 24; i++) entrees.push(new Int32Array([1 + (i % 9), 2, 3, 4, 5, 6]));
  const av = seance(r, [{ entrees }], { dureeMs: 2000, graine: 2, tailleLot: 4, maxPas: 6 });
  assert.ok(av.pas > 0 && av.pas <= 6);
  assert.ok(Number.isFinite(av.perte));
  for (let i = 0; i < r.poids.length; i++) assert.ok(Number.isFinite(r.poids[i]), 'aucun poids NaN/Inf');
});

test('divergence : une perte infinie n\'est pas appliquée, les poids restent finis', () => {
  const r = new Reseau(petitEssai); r.initialiser(17);
  const entrees: Int32Array[] = []; for (let i = 0; i < 40; i++) entrees.push(new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]));
  // un taux d'apprentissage délirant ferait diverger : le garde-fou doit écarter les lots à perte non finie.
  const av = seance(r, [{ entrees }], { dureeMs: 2000, graine: 1, tailleLot: 4, lr: 1e7 });
  for (let i = 0; i < r.poids.length; i++) assert.ok(Number.isFinite(r.poids[i]), `poids ${i} non fini`);
  assert.ok(Number.isFinite(av.perte));
});

test('gabarits : tailles conformes au contrat et mesurerEtChoisir renvoie un Hyper valable', async () => {
  assert.equal(TAILLES.moyen.C, 128); assert.equal(TAILLES.moyen.couches, 8); assert.equal(TAILLES.moyen.tetes, 4);
  assert.equal(TAILLES.moyen.vocab, 4096); assert.equal(TAILLES.moyen.contexte, 128);
  const h = await mesurerEtChoisir({ cible: 'petit' });
  assert.ok(['petit', 'moyen', 'grand'].includes(h.taille));
  assert.ok(h.poids > 0);
});

// Défaut trouvé en entraînant pour de vrai (17/11) : aucune borne au contexte. Une suite plus longue lisait ses
// « positions » dans les poids de la première couche (rangés juste après la table des positions) et, à
// l'entraînement, y écrivait des gradients.
const suiteLongue = (n: number, pas: number): Int32Array => Int32Array.from({ length: n }, (_, i) => (i * pas + 1) % petitEssai.vocab);

test('contexte : la passe avant refuse une suite plus longue que le contexte', () => {
  const r = new Reseau(petitEssai); r.initialiser(5);
  assert.throws(() => r.avant(suiteLongue(petitEssai.contexte + 4, 3), true), RangeError);
  assert.doesNotThrow(() => r.avant(suiteLongue(petitEssai.contexte, 3), true));
});

test('contexte : apprendre sur une suite trop longue, c\'est apprendre sur son début et rien d\'autre', () => {
  const long = suiteLongue(20, 3);
  const a = new Reseau(petitEssai); a.initialiser(5); a.jeterGrad(); const pa = a.perteEtGrad(long);
  const b = new Reseau(petitEssai); b.initialiser(5); b.jeterGrad(); const pb = b.perteEtGrad(long.subarray(0, petitEssai.contexte));
  assert.equal(pa, pb, 'même perte que sur le début seul');
  assert.deepEqual(Array.from(a.grads), Array.from(b.grads), 'mêmes gradients : rien d\'écrit ailleurs');
});

test('contexte : le plongement d\'un long texte est la moyenne de ses fenêtres', () => {
  const r = new Reseau(petitEssai); r.initialiser(5);
  const T = petitEssai.contexte, long = suiteLongue(2 * T + 3, 5);
  const v = r.plonger(long);
  const attendu = new Float32Array(petitEssai.C);
  for (const [debut, fin] of [[0, T], [T, 2 * T], [2 * T, 2 * T + 3]]) {
    const w = r.plonger(long.subarray(debut, fin));
    for (let c = 0; c < attendu.length; c++) attendu[c] += w[c] * (fin - debut);
  }
  for (let c = 0; c < attendu.length; c++) assert.ok(Math.abs(v[c] - attendu[c] / long.length) < 1e-5, `composante ${c} : ${v[c]} au lieu de ${attendu[c] / long.length}`);
  // un texte démesuré reste borné : au-delà de huit fenêtres, la fin n'est pas lue
  const enorme = suiteLongue(8 * T + 50, 7);
  assert.deepEqual(Array.from(r.plonger(enorme)), Array.from(r.plonger(enorme.subarray(0, 8 * T))));
});

test('contexte : la perte du banc tenu à part s\'arrête au contexte', () => {
  const r = new Reseau(petitEssai); r.initialiser(5);
  const long = suiteLongue(20, 3);
  assert.equal(perteSur(r, [long]), perteSur(r, [long.subarray(0, petitEssai.contexte)]));
});

// Trouvé à la relecture des corrections ci-dessus : couper une paire « demande → réponse » par la fin ne laissait rien
// à apprendre (perte 0, sans le dire), et une longue demande donnait au duel la meilleure note à n'importe quelle réponse.
test('contexte : une paire trop longue garde sa réponse (la demande est coupée par la gauche)', () => {
  const T = petitEssai.contexte;
  const paire = suiteLongue(T + 6, 3), roles = new Int32Array(paire.length);
  for (let i = paire.length - 5; i < paire.length; i++) roles[i] = 1; // seule la fin (la réponse) s'apprend
  const a = new Reseau(petitEssai); a.initialiser(5); a.jeterGrad(); const pa = a.perteEtGrad(paire, 1, roles);
  const b = new Reseau(petitEssai); b.initialiser(5); b.jeterGrad(); const pb = b.perteEtGrad(paire.subarray(6), 1, roles.subarray(6));
  assert.ok(pa > 0, `la réponse doit être apprise, perte ${pa}`);
  assert.equal(pa, pb, 'même perte que sur la fin de la paire');
  assert.deepEqual(Array.from(a.grads), Array.from(b.grads));
});

test('contexte : le score du duel juge la réponse même après une très longue demande', () => {
  const r = new Reseau(petitEssai); r.initialiser(5);
  const demande = suiteLongue(petitEssai.contexte + 10, 5);
  const bonne = new Int32Array([1, 2, 3]), autre = new Int32Array([9, 9, 9]);
  const sa = r.score(demande, bonne), sb = r.score(demande, autre);
  assert.ok(sa < 0 && sb < 0, `un score est une log-probabilité négative, pas ${sa} et ${sb}`);
  assert.notEqual(sa, sb, 'deux réponses différentes, deux scores');
});
