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
  AJOUTS_AVANT_REPLI, CORRECTIONS_MAX, PREFERENCES, CORRECTIONS_OCTETS_MAX, IndexNgrammes, REGLAGES, apprendreCorrection, creerAiguilleurSync, fichierCalibration, fichierCorrections,
  calibrer, lireCorrections, lireCorrectionsBilan, ngrammes, nettoyer, oublierCalibrations, replier, seuilPour, validationCroisee, type CasValidation, type ModuleMatiere,
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
/**
 * Applis d'essai : quatre applis de quelques mots face aux vraies phrases « pas encore » du dépôt. La règle qui fait
 * passer « pas encore » devant dès la moitié de la part de la première appli (réglée sur la vraie matière) les
 * écraserait : on la garde à 1 ici. La matière par langue du dépôt n'est pas lue (matiere: false) : les essais ne
 * dépendent pas de fichiers en cours d'écriture.
 */
const ESSAI = { rapportHorsChamp: 1 };

test('plusieurs écritures : la bonne appli au premier rang, sans découpage en mots', () => {
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
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
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  for (const p of ['', '   ', '\u0000\u0007\u001b', '?!…']) { const r = a.aiguiller(p); assert.equal(r.decision, 'main', JSON.stringify(p)); assert.deepEqual(r.choix, []); }
  for (const p of ['réserve-moi un billet d\'avion pour Rome', 'book me a flight ticket']) assert.equal(a.aiguiller(p).decision, 'main', p);
});

test('relance : le tour précédent et l\'appli active comptent', () => {
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  const r = a.aiguiller('et celui-là aussi', { precedent: 'bloque le site jeux.example', appli: 'rempart_t', actionPrecedente: 'bloquer' });
  assert.equal(r.choix[0].appli, 'rempart_t');
  assert.equal(r.choix[0].action, 'bloquer');
});

test('correction du propriétaire : apprise, gardée, relue à l\'ouverture', () => {
  const home = dossier();
  try {
    const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    const phrase = 'fais chanter la maison';
    assert.deepEqual(a.apprendre({ demande: phrase, appli: 'lyre_t', action: 'jouer', provenance: 'proprietaire' }), { ok: true });
    assert.deepEqual(a.aiguiller(phrase).choix[0], { ...a.aiguiller(phrase).choix[0], appli: 'lyre_t', action: 'jouer' });
    const b = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(b.bilan.corrections, 1);
    const r = b.aiguiller(phrase).choix[0];
    assert.equal(r.appli, 'lyre_t'); assert.equal(r.action, 'jouer');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('refus : une paire venue d\'un contenu extérieur, sans provenance, ou vers une appli inconnue', () => {
  const home = dossier();
  try {
    const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
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
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES }), b = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  for (const p of ['météo', 'play', '天気', 'bloque', 'note ça', 'rien à voir', 'et demain ?']) assert.deepEqual(a.aiguiller(p), b.aiguiller(p), p);
  assert.deepEqual(a.bilan.calibration.poids, b.bilan.calibration.poids);
});

test('bornes : entrée énorme et caractères de contrôle, sans erreur et vite', () => {
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  const t0 = performance.now();
  const r = a.aiguiller('météo '.repeat(200_000));
  assert.ok(performance.now() - t0 < 5000);
  assert.equal(r.choix[0].appli, 'ciel_t');
  assert.equal(a.aiguiller('joue\u0000 de la\u0007 musique ').choix[0].appli, 'lyre_t');
  assert.equal([...nettoyer('é'.repeat(10_000))].length, 2000);
});

// ------------------------------------------------------------------------------------------------ corrections après relecture (tour 2)
test('appli active (G3) : elle ne détourne pas une demande nette qui parle d\'autre chose', () => {
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
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
    const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(a.bilan.corrections, 0); assert.match(a.bilan.correctionsRaison ?? '', /trop gros/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('correction refaite (M4) : la nouvelle remplace l\'ancienne en mémoire comme dans le fichier', () => {
  const home = dossier();
  try {
    const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    const p = 'zorglub bidule machin chouette';
    assert.equal(a.apprendre({ demande: p, appli: 'rempart_t', action: null, provenance: 'proprietaire' }).ok, true);
    assert.equal(a.apprendre({ demande: 'Zorglub  bidule machin chouette', appli: 'carnet_t', action: null, provenance: 'proprietaire' }).ok, true);
    assert.equal(a.bilan.corrections, 1);
    const r = a.aiguiller(p);
    assert.equal(r.choix[0].appli, 'carnet_t');
    assert.ok(!r.choix.some((c) => c.appli === 'rempart_t'), 'l\'ancienne ne vote plus');
    // Relue à l'ouverture, puis refaite encore : la paire relue (de base) est retirée elle aussi.
    const b = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
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
    const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
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
    const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(a.bilan.calibrationDe, 'calcul');
    const b = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(b.bilan.calibrationDe, 'memoire'); assert.deepEqual(b.bilan.calibration, a.bilan.calibration);
    oublierCalibrations();
    const c = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(c.bilan.calibrationDe, 'fichier'); assert.deepEqual(c.bilan.calibration.poids, a.bilan.calibration.poids);
    assert.equal(creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: [...MODULES, { id: 'neuf_t', name: 'Neuf', words: ['neuf'], actions: [] }], home }).bilan.calibrationDe, 'calcul');
    oublierCalibrations();
    writeFileSync(fichierCalibration(home), JSON.stringify({ empreinte: 'x', calibration: { poids: ['a'], seuilSeul: -5 } }));
    assert.equal(creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home }).bilan.calibrationDe, 'calcul');
    oublierCalibrations();
    const lu = JSON.parse(readFileSync(fichierCalibration(home), 'utf8'));
    lu.calibration.seuilSeul = -5; writeFileSync(fichierCalibration(home), JSON.stringify(lu));
    assert.equal(creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home }).bilan.calibrationDe, 'calcul', 'un seuil hors de [0 ; 1,01] n\'est pas cru');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('action qui engage (M7) : toujours à confirmer, même quand l\'aiguilleur est sûr', () => {
  const mods: ModuleMatiere[] = MODULES.map((m) => ({ ...m, actions: m.actions.map((x) => ({ ...x, read: x.id === 'prevoir' })) }));
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: mods });
  const r1 = a.aiguiller('play some music'), r2 = a.aiguiller('les prévisions de la météo');
  assert.equal(r1.choix[0].action, 'jouer'); assert.equal(r1.confirmer, true);
  assert.equal(r2.choix[0].action, 'prevoir'); assert.equal(r2.confirmer, false);
  assert.equal(creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES }).aiguiller('les prévisions de la météo').confirmer, true, 'lecture seule inconnue : à confirmer');
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

// ------------------------------------------------------------------------------------------------ tour 2 : le calcul
test('appli « aimant » (tour 2) : une appli riche en paires n\'écrase pas la petite appli que la demande vise', () => {
  // gros_t a 200 phrases qui partagent les mots courants de la demande ; petit_t n'a que sa phrase à elle.
  const gros: ModuleMatiere = { id: 'gros_t', name: 'Gros', what: 'beaucoup de choses sur mon ordinateur', words: Array.from({ length: 200 }, (_, i) => `regarde mon ordinateur et dis-moi le point numéro ${i}`), actions: [] };
  const petit: ModuleMatiere = { id: 'petit_t', name: 'Petit', what: 'vide la corbeille', words: ['vide la corbeille de mon ordinateur', 'corbeille'], actions: [] };
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: [...MODULES, gros, petit] });
  assert.equal(a.aiguiller('tu peux vider la corbeille de mon ordinateur').choix[0]?.appli, 'petit_t');
});

test('rien de ressemblant (tour 2) : une écriture que la matière ne connaît pas donne « main » sans liste par défaut', () => {
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  for (const p of ['ᏣᎳᎩ ᎦᏬᏂᎯᏍᏗ ᎠᏍᎦᏯ', 'ⴰⵣⵓⵍ, ⴼⵍⵍⴰⵡⵏ ?']) {
    const r = a.aiguiller(p);
    assert.equal(r.decision, 'main', p); assert.deepEqual(r.choix, [], p);
    assert.ok((r.couverture ?? 1) < REGLAGES.couvertureMin, `${p} : couverture ${r.couverture}`);
  }
  // Sans le seuil, la même demande recevait une liste.
  const b = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, couvertureMin: 0 }, modules: MODULES });
  assert.ok(b.aiguiller('ⴰⵣⵓⵍ, ⴼⵍⵍⴰⵡⵏ ?').choix.length > 0, 'la ponctuation seule suffisait à donner une liste');
});

test('hors du champ (tour 2) : les phrases « horsChamp » de la matière apprennent à dire « pas encore »', () => {
  const dir = dossier();
  try {
    const horsChamp = ['réserve-moi une table au restaurant ce soir', 'commande une pizza', 'trouve-moi un plombier pas cher', 'réserve un taxi pour l\'aéroport', 'achète des billets de concert', 'prends rendez-vous chez le coiffeur'];
    writeFileSync(join(dir, 'fr.json'), JSON.stringify({ langue: 'fr', ecriture: 'latin', origine: 'essai', aRelire: false, applis: { lyre_t: { '*': ['mets un peu de son'], jouer: ['lance ma playlist'] } }, horsChamp }));
    const a = creerAiguilleurSync({ matiere: dir, reglages: ESSAI, modules: MODULES });
    assert.equal(a.bilan.matiere?.paires, 8);
    const r = a.aiguiller('réserve-moi une table au restaurant demain soir');
    assert.equal(r.choix[0]?.appli ?? null, null); assert.equal(r.decision, 'main');
    assert.equal(a.aiguiller('lance ma playlist du matin').choix[0]?.appli, 'lyre_t');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deux applis vraiment possibles (tour 2) : la règle par défaut du propriétaire tranche une quasi-égalité', () => {
  const mods: ModuleMatiere[] = [
    ...MODULES,
    { id: 'arche_t', name: 'Copie', what: 'sauvegarde de la base', words: ['sauvegarde de la base'], actions: [] },
    { id: 'phenix_t', name: 'Copie', what: 'sauvegarde de la base', words: ['sauvegarde de la base', 'sauvegarde de la base complète'], actions: [] },
  ];
  const preferences = [['arche_t', 'phenix_t']] as const, p = 'sauvegarde de la base complète';
  const creer = (margePreference: number) => creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, margePreference }, modules: mods, preferences });
  assert.equal(creer(0).aiguiller(p).choix[0]?.appli, 'phenix_t', 'sans la règle : la plus proche');
  assert.equal(creer(0.9).aiguiller(p).choix[0]?.appli, 'arche_t', 'avec la règle : la préférée');
  // La règle ne joue qu'entre les deux applis nommées : une autre appli en tête n'est jamais déplacée.
  assert.equal(creer(0.9).aiguiller('play some music').choix[0]?.appli, 'lyre_t');
  assert.deepEqual(PREFERENCES.map(([a]) => a), ['skuld', 'vidarr', 'hermod'], 'les règles du propriétaire : Arche, Sphinx, Satellites');
});

test('correction presque identique (tour 2) : elle l\'emporte même sur le centre d\'une appli', () => {
  const home = dossier();
  try {
    const a = creerAiguilleurSync({ matiere: false, modules: MODULES, home });
    assert.equal(a.apprendre({ demande: 'la météo de la musique', appli: 'carnet_t', action: 'noter', provenance: 'proprietaire' }).ok, true);
    const r = a.aiguiller('la météo de la musique');
    assert.equal(r.choix[0]?.appli, 'carnet_t'); assert.equal(r.choix[0]?.action, 'noter');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ relecture du tour 2
test('« seul » réglé sur l\'appli (G1) : une action juste 9 fois sur 10 n\'empêche plus d\'agir seul sur l\'appli', () => {
  // 200 cas sûrs de leur appli (toujours juste), dont l'action est fausse une fois sur dix, quelle que soit la confiance.
  const cas: CasValidation[] = Array.from({ length: 200 }, (_, i) => {
    const part = 0.3 + 0.7 * (i / 199);
    return {
      appli: 'lyre_t', action: 'jouer', appliJuste: true, appliJuste3: true, juste1: i % 10 !== 0, juste3: true,
      vote: { candidats: [{ appli: 'lyre_t', part, action: i % 10 ? 'jouer' : 'pause', partAction: 0.6 }, { appli: 'ciel_t', part: 1 - part, action: null, partAction: 0 }], sim1: part, motsTete: null, motsVide: true, couverture: 1, partHorsChamp: 0 },
    } as unknown as CasValidation;
  });
  const c = calibrer(cas, REGLAGES);
  assert.ok(c.seuilSeul < 1.01, `seuil « seul » ${c.seuilSeul}`);
  assert.equal(c.seuilAction, 1.01, 'l\'action, juste à 90 %, n\'atteint pas les 95 % visés : elle reste à demander');
});

test('validation croisée (M1) : les phrases sœurs (même groupe) tombent dans le même pli', () => {
  // Deux traductions de la même idée, et rien d'autre de ressemblant : testée, l'une ne doit pas voir l'autre voter.
  const paires = [
    { texte: 'zorglub bidule chouette', appli: 'a', action: null, source: 'matiere:fr', demande: true, groupe: 'a.*#0' },
    { texte: 'zorglub bidule chouettes', appli: 'a', action: null, source: 'matiere:en', demande: true, groupe: 'a.*#0' },
    { texte: 'autre chose sans rapport', appli: 'b', action: null, source: 'module:mots' },
  ];
  const ix = new IndexNgrammes(paires, REGLAGES);
  const cas = validationCroisee(ix, new Map([['a', [0, 1]], ['b', [2]]]), undefined, 5);
  assert.equal(cas.length, 2);
  for (const c of cas) assert.ok(c.vote.sim1 < 0.5, `la sœur a voté (ressemblance ${c.vote.sim1})`);
});

// ------------------------------------------------------------------------------------------------ tour 3 (Soul v3)
test('« seul » (tour 3) : sur des cas sûrs justes 96 fois sur 100 seulement, l\'aiguilleur n\'agit plus seul', () => {
  // 200 cas rangés par confiance décroissante ; une appli fausse tous les 25 cas, en commençant par le plus sûr : les
  // premiers cas ne sont jamais justes à plus de 96 %. Visé à 95 % (tour 2), « seul » restait permis ; visé à 97 %
  // (tour 3 : avec la matière ajoutée, « décide seul et se trompe » montait sur le jeu de travail), il ne l'est plus.
  const conf = Array.from({ length: 200 }, (_, i) => 1 - i / 200), juste = conf.map((_, i) => i % 25 !== 0);
  assert.ok(REGLAGES.viseSeul >= 0.97, `viseSeul ${REGLAGES.viseSeul}`);
  assert.equal(seuilPour(conf, juste, REGLAGES.viseSeul), 1.01, 'aucun seuil « seul » sous 97 % de justesse');
  assert.ok(seuilPour(conf, juste, 0.95) < 1.01, 'à 95 %, le même jeu permettait « seul »');
});

test('matière (tour 3) : les actions complétées ont une phrase sœur dans chacune des quinze langues', () => {
  // Une même idée, à la même place de la liste, dans les quinze fichiers (groupe « appli.action#n ») : ni une langue
  // oubliée, ni des listes désalignées. Le shimaoré et le kibushi n'y sont pas : leur matière viendra du propriétaire.
  const LANGUES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'nl', 'pt', 'ru', 'sw', 'tr', 'zh'];
  const dossierMatiere = new URL('../src/brain/nous/matiere/', import.meta.url);
  const fichiers = LANGUES.map((l) => JSON.parse(readFileSync(new URL(`${l}.json`, dossierMatiere), 'utf8')) as { langue: string; applis: Record<string, Record<string, Array<string | null>>> });
  for (let i = 0; i < LANGUES.length; i++) assert.equal(fichiers[i].langue, LANGUES[i]);
  const CLES = ('saga.noter saga.chercher runes.client runes.evolution garmr.bannis garmr.proteger geri.verifier geri.journal ullr.analyser ullr.fichier argos.incidents urdr.lignes skuld.sauvegarder '
    + 'skuld.verifier_site svalinn.tester_debit vidarr.bloquer_horaires vidarr.dhcp_fixe vordr.prendre_en_main vordr.ajouter askr.attribuer var.inviter var.mot_de_passe thjalfi.suivi gladsheim.bouton '
    + 'zeus.bilan gna.exporter gna.nommer_lieu apparence.theme commandes.chercher volva.chercher appareils.commander midgard.commander midgard.pont freyja.livre_ajouter frigg.reserver frigg.prestation '
    + 'kvasir.verifier champollion.garder gefjon.demarrage sol.dossier ivaldi.journal leikvangr.jeux hlin.etat hel.recuperer agora.forcer achille.controle_passif syrinx.purger pronoia.couper '
    + 'keryx.historique snotra.creer eir.mesures').split(' ');
  const sansSoeurs = CLES.filter((k) => {
    const [a, b] = k.split('.'), listes = fichiers.map((f) => f.applis[a]?.[b] ?? []);
    const L = Math.max(...listes.map((l) => l.length));
    for (let n = 0; n < L; n++) if (listes.every((l) => typeof l[n] === 'string' && l[n]!.trim() !== '')) return false;
    return true;
  });
  assert.deepEqual(sansSoeurs, []);
});

test('matière (tour 3, relecture) : aucune phrase des actions complétées n\'est presque une demande des deux jeux de l\'aiguilleur ni du jeu figé des tâches', async () => {
  // Une phrase de matière presque identique à une demande du banc fausse sa mesure. fuites.ts ne signale qu'à partir de
  // 0,8 (trigrammes) : ici, plus serré, pour les actions complétées au tour 3 : 75 % des mots en commun (phrases d'au
  // moins 4 mots) ou 0,7 de trigrammes. Le message ne donne que des repères (langue, action, numéro), jamais une phrase.
  // Le jeu figé des tâches (taches-principal : demandes et choix) est aussi couvert : une phrase sw de svalinn.tester_debit
  // y ressemblait (repère tp177).
  const { normaliser, trigrammes, jaccard } = await import('./soul-banc/fuites.ts');
  const LANGUES = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'nl', 'pt', 'ru', 'sw', 'tr', 'zh'];
  const CLES = ('saga.noter saga.chercher runes.client runes.evolution garmr.bannis garmr.proteger geri.verifier geri.journal ullr.analyser ullr.fichier argos.incidents urdr.lignes skuld.sauvegarder '
    + 'skuld.verifier_site svalinn.tester_debit vidarr.bloquer_horaires vidarr.dhcp_fixe vordr.prendre_en_main vordr.ajouter askr.attribuer var.inviter var.mot_de_passe thjalfi.suivi gladsheim.bouton '
    + 'zeus.bilan gna.exporter gna.nommer_lieu apparence.theme commandes.chercher volva.chercher appareils.commander midgard.commander midgard.pont freyja.livre_ajouter frigg.reserver frigg.prestation '
    + 'kvasir.verifier champollion.garder gefjon.demarrage sol.dossier ivaldi.journal leikvangr.jeux hlin.etat hel.recuperer agora.forcer achille.controle_passif syrinx.purger pronoia.couper '
    + 'keryx.historique snotra.creer eir.mesures').split(' ');
  const mots = (t: string) => new Set(normaliser(t).split(' ').filter(Boolean));
  const partMots = (a: Set<string>, b: Set<string>) => { const i = [...a].filter((x) => b.has(x)).length; return i / (a.size + b.size - i || 1); };
  const demandes = ['principal', 'developpement', 'taches-principal'].flatMap((j) => {
    const x = JSON.parse(readFileSync(new URL(`./soul-banc/jeux/${j}.json`, import.meta.url), 'utf8')) as { demandes: Array<{ id: string; phrase: string }>; choix?: Array<{ id: string; phrase: string }> };
    return [...x.demandes, ...(x.choix ?? [])];
  }).map((d) => ({ id: d.id, m: mots(d.phrase), t: trigrammes(d.phrase) }));
  const proches: string[] = [];
  for (const l of LANGUES) {
    const f = JSON.parse(readFileSync(new URL(`../src/brain/nous/matiere/${l}.json`, import.meta.url), 'utf8')) as { applis: Record<string, Record<string, Array<string | null>>> };
    for (const k of CLES) {
      const [a, b] = k.split('.');
      (f.applis[a]?.[b] ?? []).forEach((p, n) => {
        if (typeof p !== 'string') return;
        const m = mots(p), t = trigrammes(p);
        for (const d of demandes) if ((m.size >= 4 && partMots(m, d.m) >= 0.75) || jaccard(t, d.t) >= 0.7) proches.push(`${l}:${k}#${n}~${d.id}`);
      });
    }
  }
  assert.deepEqual(proches, []);
});

// ------------------------------------------------------------------------------------------------ tour 4 (Soul v3)
const CLES_TOUR4 = ('saga.noter saga.attention saga.chercher runes.evolution runes.client draupnir.* eir.mesures forseti.chercher garmr.bannis garmr.proteger garmr.journal geri.verifier '
  + 'geri.journal ullr.analyser ullr.fichier ullr.plan argos.incidents urdr.base_sauvegarder urdr.lignes skuld.sauvegarder ymir.isoler_machine idunn.vider_cache brisingamen.ajouter gjoll.* '
  + 'vidarr.bloquer_horaires vidarr.dhcp_fixe vidarr.baux vordr.prendre_en_main askr.attribuer valgrind.proteger valgrind.ouvrir_ports var.inviter var.creer_groupe skidbladnir.lien eitri.dossier '
  + 'fjalar.surveilles thjalfi.mot_de_passe gladsheim.bouton zeus.mois zeus.sources zeus.comparer gna.pause gna.exporter gna.nommer_lieu apparence.theme apparence.etat apparence.mascotte '
  + 'commandes.chercher appareils.commander midgard.commander midgard.pont midgard.maison bragi.mot_entendu freyja.programme freyja.livre_ajouter frigg.reserver frigg.prestation kvasir.verifier '
  + 'champollion.garder gefjon.demarrage ivaldi.cloner ivaldi.journal leikvangr.jeux leikvangr.listes_retroarch hlin.etat hlin.demandes hlin.resultat hel.recuperer hel.resultats agora.forcer '
  + 'achille.controle_passif achille.declarer_domaine syrinx.ecouter_clip syrinx.purger pronoia.couper vordr.ajouter sindri.sauvegarder volva.chercher eir.etat snotra.creer var.mot_de_passe '
  + 'thjalfi.reinstaller').split(' ');
const LANGUES_TOUR4 = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'nl', 'pt', 'ru', 'sw', 'tr', 'zh'];
const lireMatiereTour4 = () => LANGUES_TOUR4.map((l) => JSON.parse(readFileSync(new URL(`../src/brain/nous/matiere/${l}.json`, import.meta.url), 'utf8')) as { langue: string; applis: Record<string, Record<string, Array<string | null>>> });

test('calibration (tour 4) : la validation croisée teste assez de cas pour que le seuil « seul » ne dépende pas du tirage', () => {
  // Sur le jeu de travail, avec la matière du tour 4 : 1 500 cas → aucun seuil « seul » ; 3 000 → 45 décisions seules
  // dont 2 fausses ; 10 000 et 40 000 → le même seuil (0,908), 0 fausse. En dessous de 10 000, le seuil saute.
  assert.ok(REGLAGES.casMax >= 10_000, `casMax ${REGLAGES.casMax}`);
  assert.ok(REGLAGES.viseSeul >= 0.97, `viseSeul ${REGLAGES.viseSeul}`);
});

test('matière (tour 4) : 82 actions reçoivent une idée de plus, en phrases sœurs dans les quinze langues', () => {
  // Le shimaoré et le kibushi n'y sont pas : leur matière viendra du propriétaire (demandes du 17/11, section 23).
  const fichiers = lireMatiereTour4();
  for (let i = 0; i < LANGUES_TOUR4.length; i++) assert.equal(fichiers[i].langue, LANGUES_TOUR4[i]);
  assert.equal(CLES_TOUR4.length, 82);
  let completes = 0;
  for (const k of CLES_TOUR4) {
    const [a, b] = k.split('.'), listes = fichiers.map((f) => f.applis[a]?.[b] ?? []);
    const L = Math.max(...listes.map((l) => l.length));
    for (let n = 0; n < L; n++) if (listes.every((l) => typeof l[n] === 'string' && l[n]!.trim() !== '')) completes++;
  }
  // 112 idées complètes dans les quinze langues avant le tour 4, une de plus par action ensuite.
  assert.ok(completes >= 112 + 82, `idées complètes ${completes}`);
});

test('matière (tour 4) : aucune phrase des actions complétées n\'est presque une demande d\'un des jeux du banc', async () => {
  // Mêmes seuils que le contrôle du tour 3 (75 % des mots pour une phrase d'au moins 4 mots, ou 0,7 de trigrammes),
  // contre TOUS les jeux de test/soul-banc/jeux (demandes et choix). Le message ne donne que des repères, jamais une phrase.
  const { normaliser, trigrammes, jaccard } = await import('./soul-banc/fuites.ts');
  const { readdirSync } = await import('node:fs');
  const mots = (t: string) => new Set(normaliser(t).split(' ').filter(Boolean));
  const partMots = (a: Set<string>, b: Set<string>) => { const i = [...a].filter((x) => b.has(x)).length; return i / (a.size + b.size - i || 1); };
  const dossierJeux = new URL('./soul-banc/jeux/', import.meta.url);
  const demandes: Array<{ id: string; m: Set<string>; t: Set<string> }> = [];
  const collecter = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(collecter); return; }
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if (typeof o.phrase === 'string' && typeof o.id === 'string') demandes.push({ id: o.id, m: mots(o.phrase), t: trigrammes(o.phrase) });
    for (const v of Object.values(o)) if (v && typeof v === 'object') collecter(v);
  };
  for (const n of readdirSync(dossierJeux).filter((n) => n.endsWith('.json'))) collecter(JSON.parse(readFileSync(new URL(n, dossierJeux), 'utf8')));
  const fichiers = lireMatiereTour4(), proches: string[] = [];
  fichiers.forEach((f, i) => {
    for (const k of CLES_TOUR4) {
      const [a, b] = k.split('.'), l = f.applis[a]?.[b] ?? [];
      // L'idée du tour 4 est la dernière de la liste.
      const p = l[l.length - 1];
      if (typeof p !== 'string') continue;
      const m = mots(p), t = trigrammes(p);
      for (const d of demandes) if ((m.size >= 4 && partMots(m, d.m) >= 0.75) || jaccard(t, d.t) >= 0.7) proches.push(`${LANGUES_TOUR4[i]}:${k}#${l.length - 1}~${d.id}`);
    }
  });
  assert.ok(demandes.length > 1000, `demandes lues ${demandes.length}`);
  assert.deepEqual(proches, []);
});

// ------------------------------------------------------------------------------------------------ tour 5 (Soul v3)
// 300 actions qui n'avaient aucune phrase (ou seulement en arabe, russe, swahili et turc) reçoivent une idée, en phrases
// sœurs dans les quinze langues. Une phrase écartée au contrôle (trop proche d'une demande d'un jeu, nom de logiciel
// copié) laisse sa place vide (null) : l'idée garde ses sœurs dans les autres langues.
const CLES_TOUR5 = ('ullr.adresse ullr.restaurer_distant ullr.liberer ullr.reanalyser ullr.revenir ullr.rapport ullr.incident saga.fiches vidarr.etat vidarr.retirer_liste '
  + 'vidarr.retirer_horaire vidarr.horaires vidarr.dhcp_mode vidarr.reglages var.couper_sessions var.retirer_acces var.taille_sauvegardes '
  + 'var.relier_proprietaire var.donner_site var.journal urdr.colonnes urdr.sql_schema urdr.base_retour hlin.resultats hlin.relancer hlin.retirer_accord '
  + 'gna.conservation garmr.fermer_port valgrind.activer valgrind.retirer_flux ivaldi.creer_depot ivaldi.enregistrer_fichier achille.decoder '
  + 'achille.historique achille.journal gefjon.programmes hel.ouvrir hel.destination skuld.historique apparence.evenements eir.seuils ymir.demarrer '
  + 'ymir.verifier_ip ymir.cloner_machine ymir.supprimer_machine ymir.quarantaine_machine ymir.retirer_iso ymir.verifier_isos ymir.auto_isoler '
  + 'freyja.enregistrer_plage ullr.isoler ullr.fichier_internet ullr.accepter ullr.verifier_arrivee ullr.regle ullr.rapports ullr.reputation '
  + 'vidarr.autoriser vidarr.regle vidarr.mettre_a_jour vidarr.historique vidarr.dhcp_chercher vidarr.dhcp_mac_etat vidarr.vider_cache var.proteger_site '
  + 'var.acces_cases var.couper_appareil var.renommer_groupe var.retirer_site urdr.relier urdr.modifier urdr.appliquer_schema urdr.base_repasser '
  + 'hlin.fiches hlin.marquer hlin.effacer_fiche gna.partage garmr.ports_ouverts valgrind.acces valgrind.tester ivaldi.terminaux ivaldi.remettre_fichier '
  + 'achille.eteindre_proxy achille.echange gefjon.gros_fichiers gefjon.desinstaller hel.table syrinx.corriger skuld.second_site geri.etat eir.exporter '
  + 'ymir.arreter ymir.arreter_machine ymir.ip_machine ymir.exporter_machine ymir.espace_iso ymir.parcourir ymir.comptes_rendus_iso ymir.serveur '
  + 'freyja.enregistrements ullr.mettre_a_jour ullr.message ullr.refuser ullr.sources ullr.importer ullr.exception ullr.failles vidarr.retablir_machine '
  + 'vidarr.retirer_regle vidarr.services vidarr.retirer_appareil vidarr.dhcp_reglages vidarr.dhcp_approuver vidarr.journal var.liberer_site '
  + 'var.acces_aux_applis var.inscrire_logiciel var.supprimer_groupe var.groupes urdr.acces urdr.ajouter_ligne urdr.exporter_schema urdr.base_lire '
  + 'hlin.guide hlin.photo hlin.cle_fuites gna.retirer_lieu valgrind.fermer_ports valgrind.connexion_unique valgrind.journal ivaldi.fermer_terminal '
  + 'ivaldi.lancer_projet achille.verifier_domaine achille.comparer gefjon.analyser gefjon.planifier_nettoyage hel.proposer syrinx.parole '
  + 'skuld.rattraper_site geri.comportement ymir.parc ymir.redemarrer ymir.apercu_machine ymir.console_machine ymir.importer_machine ymir.bibliotheque_iso '
  + 'ymir.fiche_iso ymir.isos_pxe freyja.chercher_vf freyja.annuler_enregistrement ullr.faux_positif ullr.restaurer ullr.bloquer ullr.cles ullr.plans '
  + 'ullr.exceptions ullr.sentinelles vidarr.pause vidarr.listes vidarr.appareil vidarr.nom_local vidarr.dhcp_demarrer vidarr.recap_machine var.modifier '
  + 'var.reglages var.ajouter_appli var.oublier_autorisation var.mettre_dans_groupe var.annuler_invitation urdr.oublier urdr.supprimer_ligne urdr.journal '
  + 'urdr.base_traces hlin.envoyee hlin.moi gna.etat gna.fond_de_carte valgrind.demarrer valgrind.portail valgrind.reglages ivaldi.projets '
  + 'ivaldi.demander_ia achille.retirer_domaine achille.encoder gefjon.journal_systeme gefjon.lancer_nettoyage hel.reparer syrinx.retrouver skuld.archives '
  + 'leikvangr.favori ymir.demarrer_machine ymir.revenir ymir.ressources_machine ymir.clavier_machine ymir.reseau_machines ymir.preparer_envoi_iso '
  + 'ymir.iso_deplacee ymir.logiciels_disponibles freyja.etat freyja.prevenir ullr.analyser_poste ullr.supprimer ullr.delai_decision ullr.source '
  + 'ullr.retirer_plan ullr.retirer_exception ullr.protection vidarr.demarrer vidarr.ajouter_liste vidarr.couper_machine vidarr.retirer_nom '
  + 'vidarr.dhcp_arreter vidarr.dns_chiffre var.retirer var.personnes var.ajouter_retour var.proteger_tout var.sortir_du_groupe var.adresse_liens '
  + 'urdr.ouvrir urdr.schema_base urdr.base_odin urdr.base_inventaire hlin.noter_demande hlin.societe gna.lieux gna.tuile valgrind.arreter '
  + 'valgrind.retirer_redirection ivaldi.mettre_a_jour ivaldi.fichiers ivaldi.regler_terminaux achille.ajouter_appareil achille.defauts '
  + 'gefjon.desactiver_demarrage gefjon.retirer_nettoyage hel.remettre syrinx.mesurer apparence.regler_mascotte leikvangr.dossier ymir.disque_machine '
  + 'ymir.locales ymir.ranger_machine ymir.modele_machine ymir.analyser_machine ymir.importer_iso ymir.verification_iso ymir.installer_logiciel '
  + 'freyja.adresse freyja.ecrans ullr.isoler_distant ullr.detail_quarantaine ullr.etat_sources ullr.versions ullr.arreter ullr.incidents saga.completer '
  + 'vidarr.arreter vidarr.activer_liste vidarr.couper_video vidarr.pubs_reseaux vidarr.dhcp_retirer_fixe vidarr.reprendre var.confirmer_double_auth '
  + 'var.donner_acces var.retirer_appli var.delier_proprietaire var.double_auth_groupe var.retirer_cle urdr.tables urdr.placer_tables urdr.base_restaurer '
  + 'urdr.base_renommer hlin.reponse hlin.proche gna.eteindre garmr.ouvrir_port valgrind.retirer valgrind.flux ivaldi.recuperer ivaldi.lire_fichier '
  + 'ivaldi.dossier achille.retirer_appareil achille.certificat gefjon.reactiver_demarrage hel.arreter hel.analyser syrinx.regler apparence.montrer '
  + 'leikvangr.variantes ymir.installer_docker ymir.tableau_machines ymir.categorie_machines ymir.creer_depuis_modele ymir.liberer_machine ymir.ajouter_iso '
  + 'ymir.plan_verif_iso ymir.mettre_a_jour_logiciels freyja.sante freyja.chercher').split(' ');

test('matière (tour 5) : 300 actions reçoivent une idée, à la même place dans les quinze langues', () => {
  // Le shimaoré et le kibushi n'y sont pas : leur matière viendra du propriétaire (demandes du 17/11, section 23).
  const fichiers = lireMatiereTour4();
  assert.equal(CLES_TOUR5.length, 300);
  assert.equal(new Set(CLES_TOUR5).size, 300);
  const minces: string[] = [];
  let completes = 0;
  for (const k of CLES_TOUR5) {
    const [a, b] = k.split('.'), listes = fichiers.map((f) => f.applis[a]?.[b] ?? []);
    // Toutes les listes ont la même longueur : l'idée du tour 5 est à la même place partout.
    assert.equal(new Set(listes.map((l) => l.length)).size, 1, `${k} : listes de longueurs différentes`);
    const n = listes[0].length - 1, presentes = listes.filter((l) => typeof l[n] === 'string' && l[n]!.trim() !== '').length;
    if (presentes === 15) completes++;
    if (presentes < 11) minces.push(`${k} (${presentes})`);
  }
  assert.deepEqual(minces, [], 'une idée du tour 5 a gardé au moins onze langues');
  assert.ok(completes >= 277, `idées du tour 5 complètes dans les quinze langues : ${completes}`);
});

test('matière (tour 5) : aucune phrase des actions ajoutées ne ressemble à une demande d\'un des jeux du banc', async () => {
  // Contrôle plus serré que celui des tours 3 et 4 (0,7 / 75 %) : c'est le seuil du tri du tour 5, 0,5 de trigrammes ou
  // 60 % des mots en commun (phrase d'au moins 4 mots), contre TOUS les jeux de test/soul-banc/jeux (demandes et choix).
  // Le message ne donne que des repères (langue, action, numéro, identifiant de la demande), jamais une phrase.
  const { normaliser, trigrammes, jaccard } = await import('./soul-banc/fuites.ts');
  const { readdirSync } = await import('node:fs');
  const mots = (t: string) => new Set(normaliser(t).split(' ').filter(Boolean));
  const partMots = (a: Set<string>, b: Set<string>) => { const i = [...a].filter((x) => b.has(x)).length; return i / (a.size + b.size - i || 1); };
  const dossierJeux = new URL('./soul-banc/jeux/', import.meta.url);
  const demandes: Array<{ id: string; m: Set<string>; t: Set<string> }> = [];
  const collecter = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(collecter); return; }
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if (typeof o.phrase === 'string' && typeof o.id === 'string') demandes.push({ id: o.id, m: mots(o.phrase), t: trigrammes(o.phrase) });
    for (const v of Object.values(o)) if (v && typeof v === 'object') collecter(v);
  };
  for (const n of readdirSync(dossierJeux).filter((n) => n.endsWith('.json'))) collecter(JSON.parse(readFileSync(new URL(n, dossierJeux), 'utf8')));
  const proches: string[] = [];
  lireMatiereTour4().forEach((f, i) => {
    for (const k of CLES_TOUR5) {
      const [a, b] = k.split('.'), l = f.applis[a]?.[b] ?? [];
      // Toutes les phrases de ces listes (tour 5, et les deux phrases d'avant en arabe, russe, swahili et turc pour huit d'entre elles).
      l.forEach((p, n) => {
        if (typeof p !== 'string') return;
        const m = mots(p), t = trigrammes(p);
        for (const d of demandes) if ((m.size >= 4 && partMots(m, d.m) >= 0.6) || jaccard(t, d.t) >= 0.5) proches.push(`${LANGUES_TOUR4[i]}:${k}#${n}~${d.id}`);
      });
    }
  });
  assert.ok(demandes.length > 4000, `demandes lues ${demandes.length}`);
  assert.deepEqual(proches, []);
});
