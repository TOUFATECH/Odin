// Banc de Soul : les fonctions pures du banc (mesure.ts, fuites.ts), prouvées sur de petits cas calculés à la main.
import assert from 'node:assert/strict';
import test from 'node:test';
import { aireRC, calibration, centile, contexteDe, couvertureA, decisions, faussesActions, juste, rapport, relevePar, risqueCouverture, wilson, defautsDuJeu, type Demande, type Reponse, type Resultat } from './soul-banc/mesure.ts';
import { chainesDuTexte, doublonsInternes, fuitesContre, Index, jaccard, normaliser, trigrammes } from './soul-banc/fuites.ts';
import { remettreEnForme } from './soul-banc/methodes.ts';
import { markdown } from './soul-banc/lancer.ts';

const proche = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const dem = (o: Partial<Demande> & { id: string }): Demande => ({ langue: 'fr', ecriture: 'latin', phrase: o.id, appli: 'frigg', action: 'agenda', sorte: 'directe', ...o });
const rep = (choix: Array<[string | null, string | null]>, confiance = 0.5, decision: Reponse['decision'] = 'trois'): Reponse => ({ choix: choix.map(([appli, action], i) => ({ appli, action, score: 10 - i })), decision, confiance });
const res = (d: Demande, r: Reponse, ms = 1): Resultat => ({ demande: d, reponse: r, ms });

test('Wilson : valeurs de référence à 95 %', () => {
  const a = wilson(5, 10); proche(a.p, 0.5); proche(a.bas, 0.236593); proche(a.haut, 0.763407);
  const b = wilson(10, 10); proche(b.bas, 0.722467); assert.equal(b.haut, 1);
  const c = wilson(0, 10); assert.equal(c.bas, 0); proche(c.haut, 0.277533);
  const d = wilson(81, 100); proche(d.bas, 0.72221); proche(d.haut, 0.87486); // 110/135 de la note de logique ressemble à ce cas
  assert.deepEqual(wilson(0, 0), { k: 0, n: 0, p: 0, bas: 0, haut: 1 });
  assert.throws(() => wilson(11, 10));
});

test('Justesse : appli, action, « aussi », hors champ', () => {
  const d = dem({ id: 'a', aussi: ['syn'] });
  assert.ok(juste(d, rep([['frigg', 'agenda']]), 'action', 1));
  assert.ok(juste(d, rep([['frigg', 'creneaux']]), 'appli', 1));
  assert.ok(!juste(d, rep([['frigg', 'creneaux']]), 'action', 1));
  assert.ok(juste(d, rep([['syn', 'n_importe']]), 'action', 1), 'une appli de « aussi » compte, quelle que soit son action');
  assert.ok(!juste(d, rep([['zeus', null], ['frigg', 'agenda']]), 'action', 1));
  assert.ok(juste(d, rep([['zeus', null], ['frigg', 'agenda']]), 'action', 3));
  assert.ok(!juste(d, rep([['a', null], ['b', null], ['c', null], ['frigg', 'agenda']]), 'appli', 3), 'le 4e rang ne compte pas');
  assert.ok(juste(dem({ id: 'b', action: null }), rep([['frigg', 'autre']]), 'action', 1), 'action attendue nulle : l\'appli suffit');
  const h = dem({ id: 'h', appli: null, action: null, sorte: 'hors-champ' });
  assert.ok(juste(h, rep([]), 'action', 1));
  assert.ok(juste(h, rep([['frigg', 'agenda']], 0.2, 'main'), 'action', 1), 'passer la main est juste hors champ');
  assert.ok(!juste(h, rep([['frigg', 'agenda']]), 'action', 1));
  assert.ok(juste(h, rep([['frigg', 'agenda'], [null, null]]), 'action', 3));
});

test('Risque-couverture : paliers, risque, aire, couverture à risque donné', () => {
  // confiances 0.9 (juste), 0.8 (juste), 0.8 (faux), 0.2 (faux)
  const rs = [
    res(dem({ id: '1' }), rep([['frigg', 'agenda']], 0.9)),
    res(dem({ id: '2' }), rep([['frigg', 'agenda']], 0.8)),
    res(dem({ id: '3' }), rep([['zeus', 'x']], 0.8)),
    res(dem({ id: '4' }), rep([['zeus', 'x']], 0.2)),
  ];
  const rc = risqueCouverture(rs);
  assert.deepEqual(rc.map((p) => [p.seuil, p.repond, p.erreurs]), [[0.9, 1, 0], [0.8, 3, 1], [0.2, 4, 2]]);
  proche(rc[1].couverture, 0.75); proche(rc[1].risque, 1 / 3); proche(rc[2].risque, 0.5);
  proche(aireRC(rc), 0.25 * 0 + 0.5 * (1 / 3) + 0.25 * 0.5);
  assert.deepEqual(couvertureA(rc, 0.1), { seuil: 0.9, couverture: 0.25, risque: 0 });
  assert.equal(couvertureA(rc, 0.5).couverture, 1);
  assert.equal(couvertureA(risqueCouverture([res(dem({ id: 'x' }), rep([['zeus', 'x']], 1))]), 0.1).seuil, null);
  // Hors champ : « répondre » en proposant une appli est une erreur, même si la méthode passe la main.
  const h = dem({ id: 'h', appli: null, action: null, sorte: 'hors-champ' });
  assert.equal(risqueCouverture([res(h, rep([['frigg', 'agenda']], 0.9, 'main'))])[0].erreurs, 1);
  assert.equal(risqueCouverture([res(h, rep([], 0.9, 'main'))])[0].erreurs, 0);
});

test('Calibration : parfaite, puis écart connu', () => {
  const ok = (c: number) => res(dem({ id: `o${c}` }), rep([['frigg', 'agenda']], c));
  const ko = (c: number) => res(dem({ id: `k${c}` }), rep([['zeus', 'x']], c));
  // case 0.5–0.6 : 2 justes sur 4 à 0.55 → écart 0.05 ; case 0.9–1.0 : 4 justes sur 4 à 0.95 → 0.05.
  const c = calibration([ok(0.55), ok(0.55), ko(0.55), ko(0.55), ok(0.95), ok(0.95), ok(0.95), ok(0.95)]);
  proche(c.ece, 0.05); proche(c.mce, 0.05);
  assert.equal(c.cases[5].n, 4); assert.equal(c.cases[9].n, 4);
  // Toujours faux à confiance 1 : écart 1. Confiance 1 tombe dans la dernière case.
  proche(calibration([ko(1), ko(1)]).ece, 1);
  assert.equal(calibration([]).ece, 0);
});

test('Décisions, hors champ, centiles, relevé par groupe', () => {
  const h = dem({ id: 'h', appli: null, action: null, sorte: 'hors-champ' });
  const rs = [
    res(dem({ id: '1' }), rep([['frigg', 'agenda']], 0.9, 'seul'), 1),
    res(dem({ id: '2' }), rep([['zeus', 'x'], ['frigg', 'agenda']], 0.5, 'trois'), 2),
    res(h, rep([['frigg', 'agenda']], 0.9, 'seul'), 3),
    res({ ...h, id: 'h2' }, rep([], 0, 'main'), 100),
  ];
  const d = decisions(rs);
  assert.deepEqual([d.seul, d.trois, d.main], [2, 1, 1]);
  assert.equal(d.justesSeul.k, 1); assert.equal(d.justesSeul.n, 2); assert.equal(d.dansTrois.k, 1);
  const f = faussesActions(rs); assert.equal(f.n, 2); assert.equal(f.agitSeule.k, 1); assert.equal(f.proposeAppli.k, 1);
  assert.equal(centile([1, 2, 3, 100], 0.5), 2); assert.equal(centile([1, 2, 3, 100], 0.95), 100); assert.equal(centile([], 0.5), 0);
  const g = relevePar(rs, (x) => x.appli ?? '(hors champ)', ['frigg', 'syn']);
  assert.equal(g.syn.n, 0, 'une appli sans demande figure avec 0'); assert.equal(g.frigg.n, 2); assert.equal(g['(hors champ)'].n, 2);
  const r = rapport(rs, ['frigg', 'syn', 'zeus']);
  assert.equal(r.global.n, 4); assert.equal(r.dansLeChamp.n, 2); assert.equal(Object.keys(r.parAppli).length, 4);
});

test('Forme d\'un jeu et d\'une réponse', () => {
  assert.deepEqual(defautsDuJeu({ version: 1, origine: 'x', demandes: [dem({ id: 'a' })] }), []);
  const d = defautsDuJeu({ demandes: [dem({ id: 'a' }), dem({ id: 'a', sorte: 'autre', phrase: ' ' })] });
  assert.equal(d.length, 3);
  assert.deepEqual(defautsDuJeu({}), ['le jeu n\'a pas de liste « demandes »']);
  const r = remettreEnForme({ choix: [{ module: 'b', action: 'y', score: 1 }, { appli: 'a', score: 5 }, { appli: 'aucune', score: 3 }], decision: 'seul', confiance: 7 });
  assert.deepEqual(r.choix.map((c) => c.appli), ['a', null, 'b']); assert.equal(r.confiance, 1); assert.equal(r.decision, 'seul');
  assert.equal(remettreEnForme(undefined).decision, 'main');
});

// ------------------------------------------------------------------------------------------------ corrections après relecture (tour 2)
test('Relances (G1) : un contexte en texte devient le tour précédent ; une autre forme est refusée', () => {
  assert.deepEqual(contexteDe('bloque le site jeux.example'), { precedent: 'bloque le site jeux.example' });
  assert.deepEqual(contexteDe({ precedent: 'a', appli: 'frigg' }), { precedent: 'a', appli: 'frigg' });
  assert.equal(contexteDe(undefined), undefined);
  assert.equal(contexteDe('   '), undefined);
  const d = defautsDuJeu({ demandes: [dem({ id: 'a', sorte: 'relance', contexte: 'texte' as never }), dem({ id: 'b', sorte: 'relance', contexte: 42 as never }), dem({ id: 'c', sorte: 'relance', contexte: ['x'] as never }), dem({ id: 'e', sorte: 'relance' })] });
  assert.deepEqual(d.map((x) => x.split(' ')[1]), ['1', '2', '3'], 'nombre, liste, relance sans contexte : refusés ; texte : accepté');
  // L'appli active du contexte qui EST la réponse attendue est comptée et dite.
  const rel = (id: string, appliCtx: string, juste: boolean, justeSans: boolean): Resultat => ({
    demande: dem({ id, sorte: 'relance', contexte: { precedent: 'x', appli: appliCtx } }),
    reponse: rep(juste ? [['frigg', 'agenda']] : [['zeus', 'x']]), ms: 1,
    reponseSansAppli: rep(justeSans ? [['frigg', 'agenda']] : [['zeus', 'x']]),
  });
  const r = rapport([rel('1', 'frigg', true, false), rel('2', 'frigg', true, true), rel('3', 'zeus', false, false)]);
  assert.equal(r.relances.n, 3); assert.equal(r.relances.appliActiveEstLaReponse, 2);
  assert.equal(r.relances.avecContexte.k, 2); assert.equal(r.relances.sansAppliActive.k, 1); assert.equal(r.relances.sansAppliActive.n, 3);
});

test('Hors champ (G2) : justesse forcée, et la couche de décision dite inerte si elle n\'agit jamais seule', () => {
  const h = (id: string, r: Reponse) => res(dem({ id, appli: null, action: null, sorte: 'hors-champ' }), r);
  const rs = [h('1', rep([['frigg', 'agenda']], 0.2, 'main')), h('2', rep([[null, null]], 0.2, 'main')), h('3', rep([], 0, 'main')), res(dem({ id: '4' }), rep([['frigg', 'agenda']], 0.4, 'trois'))];
  const r = rapport(rs);
  assert.equal(r.horsChampForce.k, 2, 'premier choix « frigg » : faux même si la méthode passe la main'); assert.equal(r.horsChampForce.n, 3);
  assert.equal(r.global.appli1.k, 4, 'le relevé « toutes » compte encore la main comme juste (on le dit, en dessous)');
  assert.equal(r.decisionInerte, true);
  assert.equal(rapport([res(dem({ id: '5' }), rep([['frigg', 'agenda']], 0.9, 'seul'))]).decisionInerte, false);
  const md = markdown('j', 'm', r, { charge: '?', fige: true });
  const i = (s: string) => { const k = md.indexOf(s); assert.ok(k >= 0, s); return k; };
  assert.ok(i('dans le champ d\'Odin') < i('toutes les demandes'), 'le champ vient en tête');
  i('hors du champ, forcée à répondre'); i('n\'agit jamais seule');
});

test('Fuites (M1), langues (M2), « aussi » (P3) : comptés à part dans le rapport', () => {
  const rs = [
    res(dem({ id: 'f1' }), rep([['frigg', 'agenda']])), // fuite, juste
    res(dem({ id: 'a' }), rep([['zeus', 'x']])),
    res(dem({ id: 'b', langue: 'ja' }), rep([['frigg', 'agenda']])),
    res(dem({ id: 'c', langue: 'ja' }), rep([['zeus', 'x']])),
    res(dem({ id: 'd', langue: 'ko' }), rep([['zeus', 'x']])),
    res(dem({ id: 's', langue: 'ko', aussi: ['syn'] }), rep([['syn', 'n_importe']])),
    res(dem({ id: 't', langue: 'ko', aussi: ['syn.bon'] }), rep([['syn', 'mauvais']])),
  ];
  const r = rapport(rs, [], { fuites: new Set(['f1']) });
  assert.equal(r.sansFuites.n, 6); assert.equal(r.sansFuites.appli1.k, 3);
  assert.equal(r.fuites, 1);
  // Par langue, dans le champ : fr 1/2, ja 1/2, ko 2/3 (s et t par « aussi ») → moyenne (0,5 + 0,5 + 0,667) / 3.
  proche(r.langues.moyenne, (0.5 + 0.5 + 2 / 3) / 3);
  assert.equal(r.langues.pire?.langue, 'fr'); assert.equal(r.langues.francais.n, 2); assert.equal(r.langues.autres.n, 5);
  // « aussi » avec une action : l'action doit être la bonne ; le compte strict (sans « aussi ») est publié.
  assert.ok(!juste(rs[6].demande, rs[6].reponse, 'action', 1));
  assert.ok(juste(rs[6].demande, rs[6].reponse, 'appli', 1));
  assert.equal(r.dansLeChampStrict.appli1.k, 2, 'sans « aussi » : f1 et b');
  assert.equal(defautsDuJeu({ demandes: [dem({ id: 'x', aussi: ['syn.bon', 'zeus'] })] }).length, 0);
});

test('Fuites : normalisation, trigrammes, Jaccard', () => {
  assert.equal(normaliser('  Quel TEMPS fait-il ? '), 'quel temps fait il');
  assert.equal(normaliser('Météo : déjà !'), 'meteo deja');
  assert.equal(normaliser('今日の天気は？'), '今日の天気は', 'le japonais garde ses caractères');
  assert.equal(normaliser('मौसम कैसा है?'), 'मौसम कैसा है', 'le devanagari garde ses signes de voyelle');
  assert.deepEqual([...trigrammes('ab')], [' ab', 'ab ']);
  proche(jaccard(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd'])), 0.5);
  assert.equal(jaccard(new Set(), new Set()), 1);
});

test('Fuites : exacte, normalisée, quasi-doublon, rien ; doublons internes ; chaînes d\'un fichier', () => {
  const idx = new Index([{ texte: 'quel temps fait-il ?', source: 'v2' }, { texte: 'lance le film Le Grand Bleu', source: 'v1' }]);
  const f = fuitesContre([
    dem({ id: 'e', phrase: 'quel temps fait-il ?' }),
    dem({ id: 'n', phrase: 'Quel temps fait il' }),
    dem({ id: 'q', phrase: 'lance le film Le Grand Bleuu' }),
    dem({ id: 'r', phrase: 'éteins la lumière du salon' }),
  ], idx);
  assert.deepEqual(f.map((x) => [x.id, x.degre]), [['e', 'exacte'], ['n', 'normalisee'], ['q', 'quasi']]);
  assert.ok(f[2].jaccard >= 0.8 && f[2].jaccard < 1); assert.equal(f[2].source, 'v1');
  const i = doublonsInternes([dem({ id: '1', phrase: 'ouvre la porte' }), dem({ id: '2', phrase: 'Ouvre la porte !' }), dem({ id: '3', phrase: 'quelle heure est-il' })]);
  assert.deepEqual(i.map((x) => [x.id, x.degre, x.source]), [['2', 'normalisee', '#1']]);
  const s = chainesDuTexte("// l'appli d'Odin\nconst a = 'lance la radio', b = \"l'heure qu'il est\";\nconst t = `\ngladsheim.meteo\nfr: il pleut ? | fait-il beau\n`;");
  assert.deepEqual(s.sort(), ['fait-il beau', 'il pleut ?', 'lance la radio', "l'heure qu'il est"].sort());
});
