// Essais du lot B de Noûs (le réseau profond) : masquage, arbitre du duel, niveaux, compteurs, raisonnement,
// entrée d'apprentissage. Tout est pur : aucun service réel, aucun hasard (les tests sont reproductibles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { masquer, MASQUE, contientSecret } from '../src/brain/nous/masque.ts';
import { arbitrer, preferenceDuDuel, appui, coherente, contredit, type Candidat, type ContexteArbitre } from '../src/brain/nous/duel.ts';
import { compteursVides, noterPoste, noterDuel, noterNiveau, noterCalibration, noterCout, partDuTravail, partDuels, partNiveaux, calibration, cout, wilsonLow, quantile } from '../src/brain/nous/compteurs.ts';
import { choisirNiveau, reflexeAutorise, conflit, etatDomaineVide, fiabilite, type EtatDomaine, type Signaux } from '../src/brain/nous/niveaux.ts';
import { fautIlRaisonner, estimerEtapes, verifierCalcul, raisonner } from '../src/brain/nous/raisonnement.ts';
import { nourrir } from '../src/brain/nous/entree.ts';
import { fileBornee, type NoosDeps } from '../src/brain/nous/deps.ts';

// ---------------------------------------------------------------------------------------------------
// Masquage : « mot de passe », « mdp », e-mail, téléphone, IBAN masqués AVANT le corpus.
test('masque : les secrets « à la française » disparaissent, le label reste', () => {
  const cas: Array<[string, string]> = [
    ['mon mot de passe est secret123', 'secret123'],
    ['mdp: hunter2', 'hunter2'],
    ['mot de passe = Tr0ub4dor', 'Tr0ub4dor'],
    ['écris à jean.dupont@exemple.fr stp', 'jean.dupont@exemple.fr'],
    ['appelle-moi au 06 12 34 56 78', '06 12 34 56 78'],
    ['vire sur FR76 3000 6000 0112 3456 7890 189 demain', 'FR76 3000 6000 0112 3456 7890 189'],
    ['téléphone +33 6 12 34 56 78', '+33 6 12 34 56 78'],
  ];
  for (const [phrase, secret] of cas) {
    const m = masquer(phrase);
    assert.ok(m.includes(MASQUE), `masqué attendu dans « ${phrase} » → ${m}`);
    assert.ok(!m.includes(secret), `le secret « ${secret} » ne doit plus être là → ${m}`);
  }
  // Le label reste (le réseau apprend la forme, pas le secret).
  assert.ok(masquer('mot de passe: abc123').startsWith('mot de passe'));
  // Idempotent et jamais levé.
  assert.equal(masquer(masquer('mdp: x9y8z7')), masquer('mdp: x9y8z7'));
  assert.equal(masquer(''), '');
  assert.equal(contientSecret('vire sur FR76 3000 6000 0112 3456 7890 189'), true);
  assert.equal(contientSecret('bonjour'), false);
});

// ---------------------------------------------------------------------------------------------------
// L'arbitre NE REÇOIT PAS les compteurs 80-20, et ne tire jamais au sort.
test('arbitre : signature sans compteurs, source sans hasard ni import des compteurs', () => {
  // La signature a exactement 3 paramètres (odin, noos, ctx) — pas de compteurs.
  assert.equal(arbitrer.length, 3);
  // Le code source de l'arbitre n'importe pas les compteurs et n'appelle aucun hasard.
  const src = readFileSync(new URL('../src/brain/nous/duel.ts', import.meta.url), 'utf8');
  assert.ok(!/from ['"][^'"]*compteurs/.test(src), 'duel.ts ne doit pas importer les compteurs');
  assert.ok(!/\bCompteurs\b/.test(src), 'duel.ts ne doit pas manipuler le type Compteurs');
  assert.ok(!/Math\.random/.test(src), 'duel.ts ne doit jamais tirer au sort');
});

function juge(v: number): ContexteArbitre['juge'] { return async () => v; }
const cand = (o: Candidat['origine'], texte: string, extra: Partial<Candidat> = {}): Candidat => ({ origine: o, texte, confiance: 0.8, faits: [], ...extra });

test('arbitre (a) : une proposition qui contredit un fait confirmé perd', async () => {
  const ctx: ContexteArbitre = { donneProprietaire: [], faitsConfirmes: ['prix: 10'], juge: juge(0.5) };
  const odin = cand('cerveau', 'le prix: 20', { faits: ['prix: 20'] });
  const noos = cand('noos', 'le prix: 10', { faits: ['prix: 10'] });
  const v = await arbitrer(odin, noos, ctx);
  assert.deepEqual(v, { gagnant: 'noos', critere: 'a' });
});

test('arbitre (c) : une affirmation sans appui ne gagne jamais ; un aveu honnête la bat', async () => {
  const ctx: ContexteArbitre = { donneProprietaire: [], faitsConfirmes: [], juge: juge(0.5) };
  // Odin bien étayé vs Noûs affirme sans appui.
  let v = await arbitrer(cand('cerveau', 'la réunion est à 14h', { faits: ['réunion 14h'] }), cand('noos', 'la réunion est à 16h'), ctx);
  assert.deepEqual(v, { gagnant: 'cerveau', critere: 'c' });
  // Aveu honnête (appui 1) bat l'affirmation sans appui (appui 0).
  v = await arbitrer(cand('cerveau', 'je ne sais pas'), cand('noos', 'forcément Paul'), ctx);
  assert.equal(v.gagnant, 'cerveau');
  assert.equal(v.critere, 'c');
});

test('arbitre : en cas de doute, Odin passe, et le résultat est déterministe (aucun hasard)', async () => {
  const ctx: ContexteArbitre = { donneProprietaire: [], faitsConfirmes: [], juge: juge(0.5) };
  const a = cand('cerveau', 'je ne sais pas', { faits: [] });
  const b = cand('noos', 'je ne sais pas', { faits: [] });
  const v1 = await arbitrer(a, b, ctx);
  const v2 = await arbitrer(a, b, ctx);
  assert.deepEqual(v1, { gagnant: 'cerveau', critere: 'doute' });
  assert.deepEqual(v1, v2); // déterministe
});

test('arbitre : préférence tirée du duel (la gagnante désignée, par mérite ou non)', async () => {
  const ctx: ContexteArbitre = { donneProprietaire: [], faitsConfirmes: [], juge: juge(0.5) };
  const odin = cand('cerveau', 'réponse étayée', { faits: ['f'] });
  const noos = cand('noos', 'au hasard');
  const v = await arbitrer(odin, noos, ctx);
  const pref = preferenceDuDuel(odin, noos, v);
  assert.equal(pref.origineGagnante, v.gagnant);
  assert.equal(pref.parMerite, v.critere !== 'doute');
  assert.notEqual(pref.gagnante, pref.perdante);
});

test('arbitre : helpers appui/coherente/contredit', () => {
  assert.equal(appui(cand('noos', 'x', { faits: ['a'] })), 2);
  assert.equal(appui(cand('noos', 'je ne sais pas')), 1);
  assert.equal(appui(cand('noos', 'affirmation nue')), 0);
  assert.equal(coherente(cand('noos', 'x', { raisonnement: [{ texte: 'y', faits: ['z'], prouve: false }] })), false);
  assert.equal(contredit('le prix: 20', ['prix: 10']), true);
  assert.equal(contredit('le prix: 10', ['prix: 10']), false);
});

// ---------------------------------------------------------------------------------------------------
// Niveaux : réflexe N1 sous conditions Wilson/calibration/conflit/erreur ; sinon désactivé.
function signauxOk(): Signaux {
  return { sensible: false, reversible: true, margeNoos: 0.5, contreditFait: false, odinNoosDesaccord: false, predictionRecenteEchouee: false, confiance: 0.95, nouvelle: false, appuiCerveau: true, enjeu: 0.1 };
}
function domaineFiable(): EtatDomaine {
  return { ...etatDomaineVide(), succes: 40, essais: 40, ece: 0.02, surpriseMoyenne: 0, seuilSurprise: 0.3 };
}

test('niveaux : réflexe N1 seulement si fiabilité ≥ 0,90 (Wilson), ≥ 30 essais, calibration ≤ 0,05, aucun conflit, aucune erreur', () => {
  const d = domaineFiable(), s = signauxOk();
  assert.ok(fiabilite(d) >= 0.90, `fiabilité ${fiabilite(d)}`);
  assert.equal(reflexeAutorise(d, s), true);
  assert.equal(choisirNiveau(d, s), 1);
  // Trop peu d'essais → N1 refusé.
  assert.equal(reflexeAutorise({ ...d, succes: 10, essais: 10 }, s), false);
  assert.equal(choisirNiveau({ ...d, succes: 10, essais: 10 }, s), 2);
  // Mauvaise calibration → N1 refusé.
  assert.equal(reflexeAutorise({ ...d, ece: 0.2 }, s), false);
  // Conflit → toujours N3.
  assert.equal(conflit({ ...s, margeNoos: 0.05 }, d), true);
  assert.equal(choisirNiveau(d, { ...s, margeNoos: 0.05 }), 3);
  // Sujet sensible → toujours N3.
  assert.equal(choisirNiveau(d, { ...s, sensible: true }), 3);
  // Erreur récente en vigilance → N1 refusé.
  assert.equal(reflexeAutorise({ ...d, vigilance: true, erreursRecentes: 1 }, s), false);
});

// ---------------------------------------------------------------------------------------------------
// Compteurs : part du travail, duels, niveaux, calibration, Brier, coût, Wilson.
test('compteurs : 80-20 mesuré, calibration et Brier, coût, Wilson', () => {
  const c = compteursVides();
  noterPoste(c, true); noterPoste(c, true); noterPoste(c, false); noterPoste(c, false); // 2/4 → 50 %
  assert.deepEqual(partDuTravail(c), { profond: 50, surface: 50, tenus: 4 });
  noterDuel(c, true, false); noterDuel(c, false, false); noterDuel(c, false, true /*égalité*/);
  const du = partDuels(c);
  assert.equal(du.joues, 3); assert.equal(du.gagnes, 1); assert.equal(du.egalites, 1);
  assert.ok(Math.abs(du.part - 0.5) < 1e-9); // 1 gagné sur 2 non-égalités
  noterNiveau(c, 1, true); noterNiveau(c, 1, false); noterNiveau(c, 3, true);
  assert.ok(Math.abs(partNiveaux(c).partN1 - 2 / 3) < 1e-9);
  noterCalibration(c, 0.9, true); noterCalibration(c, 0.9, false);
  const cal = calibration(c);
  assert.ok(cal.brier > 0 && cal.brier < 1);
  assert.ok(cal.ece >= 0);
  noterCout(c, 10, 5); noterCout(c, 30, 5);
  const co = cout(c);
  assert.ok(co.p95Ms >= co.medianeMs);
  // Wilson : 40/40 dépasse 0,90, 30/30 ne l'atteint pas.
  assert.ok(wilsonLow(40, 40) >= 0.90);
  assert.ok(wilsonLow(30, 30) < 0.90);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

// ---------------------------------------------------------------------------------------------------
// Raisonnement : détecteur « faut-il raisonner », découpage, vérification de calcul.
test('raisonnement : le détecteur déclenche sur le difficile, pas sur le simple', () => {
  // Question simple et sûre → pas de raisonnement.
  assert.equal(fautIlRaisonner({ etapesProbables: 1, chiffresDatesAEnchainer: false, propositionsSeContredisent: false, confiance: 0.9 }), false);
  // Plusieurs étapes → raisonner.
  assert.equal(fautIlRaisonner({ etapesProbables: 3, chiffresDatesAEnchainer: false, propositionsSeContredisent: false, confiance: 0.9 }), true);
  // Chiffres/dates à enchaîner → raisonner.
  assert.equal(fautIlRaisonner({ etapesProbables: 1, chiffresDatesAEnchainer: true, propositionsSeContredisent: false, confiance: 0.9 }), true);
  // Propositions du duel contradictoires → raisonner.
  assert.equal(fautIlRaisonner({ etapesProbables: 1, chiffresDatesAEnchainer: false, propositionsSeContredisent: true, confiance: 0.9 }), true);
  // Faible confiance → raisonner.
  assert.equal(fautIlRaisonner({ etapesProbables: 1, chiffresDatesAEnchainer: false, propositionsSeContredisent: false, confiance: 0.4 }), true);
  // Estimation d'étapes.
  assert.ok(estimerEtapes('combien de jours entre le 01/03 et le 10/03 puis ajoute 2 ?').etapes >= 2);
  assert.equal(verifierCalcul('2 + 3 = 5'), true);
  assert.equal(verifierCalcul('2 + 3 = 6'), false);
  assert.equal(verifierCalcul('pas de calcul'), undefined);
});

test('raisonnement : honnête — une étape sans fait reste non prouvée, pas de faux enchaînement', async () => {
  // Aucun fait trouvé → étape non prouvée, conclusion « je ne suis pas sûr ».
  const sans = await raisonner('qui a gagné ?', { faits: () => [] });
  assert.equal(sans.sur, false);
  assert.ok(sans.etapes.every((e) => e.prouve === false));
  // Des faits trouvés et aucune contradiction → étape prouvée.
  const avec = await raisonner('quel prix ?', { faits: () => ['prix connu'], confirmes: [] });
  assert.ok(avec.etapes[0].prouve);
});

// ---------------------------------------------------------------------------------------------------
// nourrir() : ne fait rien en privé/observe=false/essai, ne lève jamais, range quand tout va bien.
function deps(extra: Partial<NoosDeps> = {}): NoosDeps {
  return {
    cfg: { learning: { observe: true }, nous: { actif: true } },
    privateMode: () => false,
    essai: false, // on force « pas en essai » pour tester la mise en file
    file: fileBornee(),
    maintenant: () => 1000,
    ...extra,
  };
}

test('nourrir : range un exemple masqué quand tout va bien', () => {
  const d = deps();
  nourrir(d, { sorte: 'lecture', texte: 'mdp: secret42 et bonjour', source: 'web', fiable: false });
  assert.equal(d.file.taille(), 1);
  const [e] = d.file.prendre(1);
  assert.ok(e.texte.includes(MASQUE) && !e.texte.includes('secret42'));
  assert.equal(e.sorte, 'lecture');
});

test('nourrir : les secrets TECHNIQUES (Heimdall) et carte/NIR n\'entrent jamais dans le corpus', () => {
  // Chaque phrase porte un secret que l'ancien masquage « à la française » laissait passer : Heimdall (motifs
  // publics) et les motifs carte/NIR doivent les retirer AVANT la file, sinon l'exemple est écarté.
  const cas: Array<[string, string]> = [
    ['note password: hunter2 fin', 'hunter2'],
    ['config api_key: AKIA1234567890ABCDEF', 'AKIA1234567890ABCDEF'],
    ['clé sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX ok', 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX'],
    ['entête Bearer eyJhbGciOiJIUzI1NiabcdefghIJKLMNOP reçu', 'eyJhbGciOiJIUzI1NiabcdefghIJKLMNOP'],
    ['ma carte 4111 1111 1111 1111 merci', '4111 1111 1111 1111'],
    ['mon NIR 185127510811142 svp', '185127510811142'],
  ];
  for (const [phrase, secret] of cas) {
    const d = deps();
    nourrir(d, { sorte: 'lecture', texte: phrase, source: 'web', fiable: false });
    for (const e of d.file.prendre(10)) {
      assert.ok(!e.texte.includes(secret), `« ${secret} » ne doit jamais entrer dans le corpus (rangé : ${e.texte})`);
    }
  }
});

test('nourrir : ne fait RIEN en mode privé, observe=false, interrupteur coupé ou essai', () => {
  for (const d of [
    deps({ privateMode: () => true }),
    deps({ cfg: { learning: { observe: false }, nous: { actif: true } } }),
    deps({ cfg: { learning: { observe: true }, nous: { actif: false } } }),
    deps({ essai: true }),
  ]) {
    nourrir(d, { sorte: 'echange', demande: 'q', reponse: 'r', source: 's', fiable: true });
    assert.equal(d.file.taille(), 0);
  }
});

test('nourrir : ne lève jamais, même avec une entrée fausse ou un privateMode en panne', () => {
  const d = deps({ privateMode: () => { throw new Error('panne'); } });
  assert.doesNotThrow(() => nourrir(d, { sorte: 'lecture', texte: 'x', source: 'y', fiable: false }));
  assert.equal(d.file.taille(), 0); // privateMode en panne => on ne range rien (prudence)
  // @ts-expect-error entrée volontairement fausse
  assert.doesNotThrow(() => nourrir(deps(), null));
  // @ts-expect-error entrée volontairement fausse
  assert.doesNotThrow(() => nourrir(deps(), { sorte: 'lecture' }));
});
