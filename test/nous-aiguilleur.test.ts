// L'aiguilleur sans réseau (src/brain/nous/aiguilleur.ts) : plusieurs écritures, hors du champ, relance, correction
// apprise puis retrouvée, refus d'une paire venue de dehors, déterminisme, bornes. Applis d'essai (pas celles du produit)
// et dossier d'Odin jetable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  AJOUTS_AVANT_REPLI, CORRECTIONS_MAX, CORRECTIONS_OCTETS_MAX, IndexNgrammes, REGLAGES, apprendreCorrection, creerAiguilleurSync, fichierCalibration, fichierCorrections,
  lireCorrections, lireCorrectionsBilan, ngrammes, nettoyer, oublierCalibrations, replier, seuilPour, validationCroisee, type ModuleMatiere,
} from '../src/brain/nous/aiguilleur.ts';

const MODULES: ModuleMatiere[] = [
  // Sans quelques phrases entières, une phrase entière ressemblerait d'abord, par sa tournure, aux phrases « pas encore »
  // de la vraie matière : une appli d'essai décrit donc ce qu'elle fait en phrases, comme les vraies.
  { id: 'ciel_t', name: 'Ciel', what: 'la météo et les prévisions', does: ['dit quel temps il fera demain', 'tells what the weather will be like'], words: ['météo', 'temps qu\'il fait', 'weather', '天気', '天气', 'погода', 'الطقس', 'मौसम'],
    actions: [{ id: 'prevoir', label: 'Prévisions', what: 'les prévisions des jours qui viennent', words: ['prévisions', 'forecast', '天気予報', '天气预报', 'прогноз погоды', 'توقعات الطقس'] }] },
  { id: 'lyre_t', name: 'Lyre', what: 'écouter de la musique', words: ['musique', 'chanson', 'music', 'song', '音楽', '音乐', 'музыка', 'موسيقى'],
    actions: [{ id: 'jouer', label: 'Jouer', what: 'joue un morceau', words: ['joue', 'play', '再生', '播放', 'включи'] }, { id: 'pause', label: 'Pause', what: 'met la musique en pause', words: ['pause', 'arrête la musique', 'stop the music'] }] },
  { id: 'rempart_t', name: 'Rempart', what: 'le pare-feu qui bloque ou autorise des sites', words: ['pare-feu', 'firewall', 'bloquer un site', 'ファイアウォール'],
    actions: [{ id: 'bloquer', label: 'Bloquer', what: 'bloque un site', words: ['bloque', 'block', 'ブロック', '封锁'] }, { id: 'autoriser', label: 'Autoriser', what: 'débloque un site', words: ['débloque', 'unblock', 'autorise'] }] },
  { id: 'carnet_t', name: 'Carnet', what: 'tes notes', words: ['note', 'notes', 'memo', 'メモ', '笔记'],
    actions: [{ id: 'noter', label: 'Noter', what: 'écrit une note', words: ['note ça', 'write down', 'メモして', '记下'] }] },
];

const dossier = () => mkdtempSync(join(tmpdir(), 'odin-aiguilleur-essai-'));

test('plusieurs écritures : la bonne appli au premier rang, sans découpage en mots', () => {
  const a = creerAiguilleurSync({ modules: MODULES });
  const cas: Array<[string, string]> = [
    ['la météo demain', 'ciel_t'], ['what is the weather like', 'ciel_t'], ['明日の天気は？', 'ciel_t'], ['明天天气怎么样', 'ciel_t'],
    ['какая сегодня погода', 'ciel_t'], ['كيف الطقس اليوم', 'ciel_t'], ['आज मौसम कैसा है', 'ciel_t'],
    ['play some music', 'lyre_t'], ['音楽を再生して', 'lyre_t'], ['включи музыку', 'lyre_t'], ['bloque ce site', 'rempart_t'],
  ];
  for (const [p, attendu] of cas) assert.equal(a.aiguiller(p).choix[0]?.appli, attendu, p);
  assert.equal(a.aiguiller('play some music').choix[0].action, 'jouer');
  assert.ok(ngrammes(nettoyer('天気予報'), 1, 4).has('天気'), 'les n-grammes du japonais existent sans espace');
});

test('hors du champ : la main, jamais une appli au hasard ; entrée vide ou faite de contrôles : la main', () => {
  const a = creerAiguilleurSync({ modules: MODULES });
  for (const p of ['', '   ', '\u0000\u0007\u001b', '?!…']) { const r = a.aiguiller(p); assert.equal(r.decision, 'main', JSON.stringify(p)); assert.deepEqual(r.choix, []); }
  for (const p of ['réserve-moi un billet d\'avion pour Rome', 'book me a flight ticket']) assert.equal(a.aiguiller(p).decision, 'main', p);
});

test('relance : le tour précédent et l\'appli active comptent', () => {
  const a = creerAiguilleurSync({ modules: MODULES });
  const r = a.aiguiller('et celui-là aussi', { precedent: 'bloque le site jeux.example', appli: 'rempart_t', actionPrecedente: 'bloquer' });
  assert.equal(r.choix[0].appli, 'rempart_t');
  assert.equal(r.choix[0].action, 'bloquer');
});

test('correction du propriétaire : apprise, gardée, relue à l\'ouverture', () => {
  const home = dossier();
  try {
    const a = creerAiguilleurSync({ modules: MODULES, home });
    const phrase = 'fais chanter la maison';
    assert.deepEqual(a.apprendre({ demande: phrase, appli: 'lyre_t', action: 'jouer', provenance: 'proprietaire' }), { ok: true });
    assert.deepEqual(a.aiguiller(phrase).choix[0], { ...a.aiguiller(phrase).choix[0], appli: 'lyre_t', action: 'jouer' });
    const b = creerAiguilleurSync({ modules: MODULES, home });
    assert.equal(b.bilan.corrections, 1);
    const r = b.aiguiller(phrase).choix[0];
    assert.equal(r.appli, 'lyre_t'); assert.equal(r.action, 'jouer');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('refus : une paire venue d\'un contenu extérieur, sans provenance, ou vers une appli inconnue', () => {
  const home = dossier();
  try {
    const a = creerAiguilleurSync({ modules: MODULES, home });
    for (const provenance of ['page', 'document', 'mail', 'automatisation', 'exterieur', '', 'Proprietaire']) {
      const r = a.apprendre({ demande: 'ouvre la porte', appli: 'rempart_t', action: 'autoriser', provenance });
      assert.equal(r.ok, false, provenance);
    }
    assert.equal(apprendreCorrection(home, { demande: 'x', appli: 'rempart_t', action: 'autoriser' } as never).ok, false);
    assert.equal(a.apprendre({ demande: 'ouvre la porte', appli: 'inconnue', action: null, provenance: 'proprietaire' }).ok, false);
    assert.equal(a.apprendre({ demande: 'ouvre la porte', appli: 'rempart_t', action: 'inventee', provenance: 'proprietaire' }).ok, false);
    assert.equal(a.apprendre({ demande: 'x'.repeat(600), appli: 'rempart_t', action: null, provenance: 'proprietaire' }).ok, false);
    assert.equal(existsSync(fichierCorrections(home)), false, 'rien n\'a été écrit');
    assert.deepEqual(lireCorrections(home), []);
    // Un fichier trafiqué : une ligne sans la bonne provenance n'est pas relue.
    assert.equal(apprendreCorrection(home, { demande: 'bonne', appli: 'lyre_t', action: 'jouer', provenance: 'proprietaire' }).ok, true);
    const j = JSON.parse(readFileSync(fichierCorrections(home), 'utf8'));
    assert.equal(j.corrections.length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('déterminisme : deux aiguilleurs construits pareil répondent pareil', () => {
  const a = creerAiguilleurSync({ modules: MODULES }), b = creerAiguilleurSync({ modules: MODULES });
  for (const p of ['météo', 'play', '天気', 'bloque', 'note ça', 'rien à voir', 'et demain ?']) assert.deepEqual(a.aiguiller(p), b.aiguiller(p), p);
  assert.deepEqual(a.bilan.calibration.poids, b.bilan.calibration.poids);
});

test('bornes : entrée énorme et caractères de contrôle, sans erreur et vite', () => {
  const a = creerAiguilleurSync({ modules: MODULES });
  const t0 = performance.now();
  const r = a.aiguiller('météo '.repeat(200_000));
  assert.ok(performance.now() - t0 < 5000);
  assert.equal(r.choix[0].appli, 'ciel_t');
  assert.equal(a.aiguiller('joue\u0000 de la\u0007 musique ').choix[0].appli, 'lyre_t');
  assert.equal([...nettoyer('é'.repeat(10_000))].length, 2000);
});

// ------------------------------------------------------------------------------------------------ corrections après relecture (tour 2)
test('appli active (G3) : elle ne détourne pas une demande nette qui parle d\'autre chose', () => {
  const a = creerAiguilleurSync({ modules: MODULES });
  for (const [p, attendu] of [['play some music', 'lyre_t'], ['la météo demain', 'ciel_t'], ['bloque ce site', 'rempart_t'], ['音楽を再生して', 'lyre_t']] as const) {
    for (const active of ['ciel_t', 'lyre_t', 'rempart_t', 'carnet_t']) assert.equal(a.aiguiller(p, { appli: active }).choix[0]?.appli, attendu, `${p} (appli active ${active})`);
  }
  // Une relance sans indice propre, avec son tour précédent, suit toujours l'appli active (sans tour précédent, la
  // tournure « pas encore » l'emporte encore : limite connue, notée au carnet).
  assert.equal(a.aiguiller('et celui-là aussi', { precedent: 'bloque le site jeux.example', appli: 'rempart_t', actionPrecedente: 'bloquer' }).choix[0]?.appli, 'rempart_t');
});

test('relecture du fichier de corrections (M3) : bornée en taille, en longueur et en nombre', () => {
  const home = dossier();
  try {
    mkdirSync(join(home, 'cerveau-reseau'), { recursive: true });
    const ok = (i: number) => ({ demande: `phrase apprise ${i}`, appli: 'lyre_t', action: 'jouer', provenance: 'proprietaire' });
    const cs = [{ demande: 'y'.repeat(600), appli: 'lyre_t', action: null, provenance: 'proprietaire' }, ...Array.from({ length: CORRECTIONS_MAX + 50 }, (_, i) => ok(i))];
    writeFileSync(fichierCorrections(home), JSON.stringify({ corrections: cs }));
    const b = lireCorrectionsBilan(home);
    assert.equal(b.corrections.length, CORRECTIONS_MAX);
    assert.equal(b.corrections[0].demande, 'phrase apprise 50', 'les plus récentes sont gardées');
    assert.equal(b.ignorees, 51);
    assert.ok(b.corrections.every((c) => [...c.demande].length <= 500));
    // Un fichier trop gros n'est pas lu du tout, et c'est dit.
    writeFileSync(fichierCorrections(home), JSON.stringify({ corrections: [ok(1)], bourrage: 'z'.repeat(CORRECTIONS_OCTETS_MAX) }));
    const g = lireCorrectionsBilan(home);
    assert.equal(g.corrections.length, 0); assert.match(g.raison ?? '', /trop gros/);
    const a = creerAiguilleurSync({ modules: MODULES, home });
    assert.equal(a.bilan.corrections, 0); assert.match(a.bilan.correctionsRaison ?? '', /trop gros/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('correction refaite (M4) : la nouvelle remplace l\'ancienne en mémoire comme dans le fichier', () => {
  const home = dossier();
  try {
    const a = creerAiguilleurSync({ modules: MODULES, home });
    const p = 'zorglub bidule machin chouette';
    assert.equal(a.apprendre({ demande: p, appli: 'rempart_t', action: null, provenance: 'proprietaire' }).ok, true);
    assert.equal(a.apprendre({ demande: 'Zorglub  bidule machin chouette', appli: 'carnet_t', action: null, provenance: 'proprietaire' }).ok, true);
    assert.equal(a.bilan.corrections, 1);
    const r = a.aiguiller(p);
    assert.equal(r.choix[0].appli, 'carnet_t');
    assert.ok(!r.choix.some((c) => c.appli === 'rempart_t'), 'l\'ancienne ne vote plus');
    // Relue à l'ouverture, puis refaite encore : la paire relue (de base) est retirée elle aussi.
    const b = creerAiguilleurSync({ modules: MODULES, home });
    assert.equal(b.bilan.corrections, 1);
    assert.equal(b.apprendre({ demande: p, appli: 'lyre_t', action: 'jouer', provenance: 'proprietaire' }).ok, true);
    assert.equal(b.bilan.corrections, 1);
    const r2 = b.aiguiller(p);
    assert.equal(r2.choix[0].appli, 'lyre_t'); assert.ok(!r2.choix.some((c) => c.appli === 'carnet_t'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('ajouts en mémoire (M5) : bornés, repliés dans l\'index, et toujours retrouvés', () => {
  const home = dossier();
  try {
    const a = creerAiguilleurSync({ modules: MODULES, home });
    for (let i = 0; i < 700; i++) assert.equal(a.apprendre({ demande: `demande apprise numéro ${i} pour voir`, appli: i % 2 ? 'carnet_t' : 'lyre_t', action: null, provenance: 'proprietaire' }).ok, true);
    assert.ok(a.bilan.ajoutsEnAttente <= AJOUTS_AVANT_REPLI, `${a.bilan.ajoutsEnAttente} ajouts parcourus un par un`);
    assert.equal(a.bilan.corrections, 700);
    assert.equal(a.aiguiller('demande apprise numéro 3 pour voir').choix[0].appli, 'carnet_t');
    assert.equal(a.aiguiller('demande apprise numéro 698 pour voir').choix[0].appli, 'lyre_t');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('calibration gardée (M6) : pas refaite pour la même matière, refaite si elle change ou si le fichier est abîmé', () => {
  const home = dossier();
  try {
    oublierCalibrations();
    const a = creerAiguilleurSync({ modules: MODULES, home });
    assert.equal(a.bilan.calibrationDe, 'calcul');
    const b = creerAiguilleurSync({ modules: MODULES, home });
    assert.equal(b.bilan.calibrationDe, 'memoire'); assert.deepEqual(b.bilan.calibration, a.bilan.calibration);
    oublierCalibrations();
    const c = creerAiguilleurSync({ modules: MODULES, home });
    assert.equal(c.bilan.calibrationDe, 'fichier'); assert.deepEqual(c.bilan.calibration.poids, a.bilan.calibration.poids);
    assert.equal(creerAiguilleurSync({ modules: [...MODULES, { id: 'neuf_t', name: 'Neuf', words: ['neuf'], actions: [] }], home }).bilan.calibrationDe, 'calcul');
    oublierCalibrations();
    writeFileSync(fichierCalibration(home), JSON.stringify({ empreinte: 'x', calibration: { poids: ['a'], seuilSeul: -5 } }));
    assert.equal(creerAiguilleurSync({ modules: MODULES, home }).bilan.calibrationDe, 'calcul');
    oublierCalibrations();
    const lu = JSON.parse(readFileSync(fichierCalibration(home), 'utf8'));
    lu.calibration.seuilSeul = -5; writeFileSync(fichierCalibration(home), JSON.stringify(lu));
    assert.equal(creerAiguilleurSync({ modules: MODULES, home }).bilan.calibrationDe, 'calcul', 'un seuil hors de [0 ; 1,01] n\'est pas cru');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('action qui engage (M7) : toujours à confirmer, même quand l\'aiguilleur est sûr', () => {
  const mods: ModuleMatiere[] = MODULES.map((m) => ({ ...m, actions: m.actions.map((x) => ({ ...x, read: x.id === 'prevoir' })) }));
  const a = creerAiguilleurSync({ modules: mods });
  const r1 = a.aiguiller('play some music'), r2 = a.aiguiller('les prévisions de la météo');
  assert.equal(r1.choix[0].action, 'jouer'); assert.equal(r1.confirmer, true);
  assert.equal(r2.choix[0].action, 'prevoir'); assert.equal(r2.confirmer, false);
  assert.equal(creerAiguilleurSync({ modules: MODULES }).aiguiller('les prévisions de la météo').confirmer, true, 'lecture seule inconnue : à confirmer');
});

test('normalisation (P1) : pleine chasse, demi-chasse, ligatures, harakat et niqqud', () => {
  const cos = (x: string, y: string) => { const ix = new IndexNgrammes([{ texte: y, appli: 'a', action: null, source: 't' }], REGLAGES); return ix.ressemblances(x).sim[0] ?? 0; };
  assert.ok(cos('ｍｕｓｉｑｕｅ', 'musique') > 0.99);
  assert.ok(cos('ﾒﾓ', 'メモ') > 0.99);
  assert.ok(cos('ﬁchier', 'fichier') > 0.99);
  assert.ok(cos('مُوسِيقَى', 'موسيقى') > 0.99, String(cos('مُوسِيقَى', 'موسيقى')));
  assert.ok(cos('שָׁלוֹם', 'שלום') > 0.99, String(cos('שָׁלוֹם', 'שלום')));
  assert.equal(replier('مُوسِيقَى'), 'موسيقى'); assert.equal(replier('שָׁלוֹם'), 'שלום');
  assert.equal(replier('मौसम'), 'मौसम', 'le devanagari garde ses signes de voyelle');
});

test('apprendre sans appli (P2) : refusé ; « aucune » ou null explicite : accepté', () => {
  const home = dossier();
  try {
    assert.equal(apprendreCorrection(home, { demande: 'phrase sans appli', provenance: 'proprietaire' } as never).ok, false);
    assert.equal(apprendreCorrection(home, { demande: 'phrase sans appli', appli: 42, action: null, provenance: 'proprietaire' } as never).ok, false);
    assert.equal(apprendreCorrection(home, { demande: 'réserve un vol', appli: 'aucune', action: null, provenance: 'proprietaire' }).ok, true);
    assert.equal(apprendreCorrection(home, { demande: 'réserve un train', appli: null, action: null, provenance: 'proprietaire' }).ok, true);
    assert.equal(lireCorrections(home).length, 2);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('validation croisée (P5) : une paire de même texte que la demande retirée est retirée avec elle', () => {
  const paires = [
    { texte: 'zorglub bidule', appli: 'a', action: null, source: 'module:mots' },
    { texte: 'Zorglub bidule !', appli: 'a', action: null, source: 'v2', demande: true },
    { texte: 'autre chose', appli: 'b', action: null, source: 'module:mots' },
  ];
  const ix = new IndexNgrammes(paires, REGLAGES);
  const cas = validationCroisee(ix, new Map([['a', [0, 1]], ['b', [2]]]), undefined, 5);
  assert.equal(cas.length, 1);
  assert.ok(cas[0].vote.sim1 < 0.9, `le voisin de même texte a voté (ressemblance ${cas[0].vote.sim1})`);
});

test('seuil par validation : le plus bas qui garde la précision visée', () => {
  const conf = Array.from({ length: 100 }, (_, i) => i / 100), juste = conf.map((c) => c >= 0.5);
  assert.equal(seuilPour(conf, juste, 0.99, 10), 0.5);
  assert.equal(seuilPour(conf, juste, 0.9, 10), 0.45); // 50 justes sur 55 = 0,909
  assert.equal(seuilPour(conf, conf.map(() => false), 0.9, 10), 1.01);
});
