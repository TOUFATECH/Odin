// L'aiguilleur, tour 6 (Soul v3) : la part EXPLIQUÉE de la demande et le SECOND TEMPS (src/brain/nous/reclasse.ts).
// Déterminisme, toutes les écritures sans découpage en mots, temps borné, prudence de « seul » quand l'ordre change, et
// l'ancien calcul (CALCUL_TOUR5) toujours disponible derrière le même contrat. Applis d'essai et dossier d'Odin jetable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  CALCUL_TOUR5, IndexNgrammes, REGLAGES, RECLASSE_EXEMPLES_MIN, creerAiguilleurSync, fichierCalibration, oublierCalibrations, type Calibration, type ModuleMatiere, type Paire,
} from '../src/brain/nous/aiguilleur.ts';
import { NB_TRAITS, Reclasseur, ajusterReclasse, noterReclasse, ordreReclasse } from '../src/brain/nous/reclasse.ts';

const dossier = () => mkdtempSync(join(tmpdir(), 'odin-aiguilleur-t6-'));
const ESSAI = { rapportHorsChamp: 1 };

const MODULES: ModuleMatiere[] = [
  { id: 'lyre_t', name: 'Lyre', what: 'écouter de la musique', does: ['joue la musique que tu aimes', 'plays the music you like'], words: ['musique', 'chanson', 'music', 'song', '音楽', '音乐', 'музыка', 'موسيقى', 'संगीत'],
    actions: [{ id: 'jouer', label: 'Jouer', what: 'joue un morceau', words: ['joue', 'play', '再生', '播放', 'включи'] }, { id: 'pause', label: 'Pause', what: 'met la musique en pause', words: ['pause', 'stop the music'] }] },
  { id: 'rempart_t', name: 'Rempart', what: 'le pare-feu qui bloque ou autorise des sites', does: ['bloque les sites dangereux', 'blocks dangerous websites'], words: ['pare-feu', 'firewall', 'bloquer un site', 'ファイアウォール', '防火墙', 'брандмауэр'],
    actions: [{ id: 'bloquer', label: 'Bloquer', what: 'bloque un site', words: ['bloque', 'block', 'ブロック', '封锁'] }] },
  { id: 'carnet_t', name: 'Carnet', what: 'tes notes', does: ['garde tes notes et tes idées', 'keeps your notes and ideas'], words: ['note', 'notes', 'memo', 'メモ', '笔记', 'заметка'],
    actions: [{ id: 'noter', label: 'Noter', what: 'écrit une note', words: ['note ça', 'write down', 'メモして', '记下'], read: true }] },
  { id: 'ciel_t', name: 'Ciel', what: 'la météo et les prévisions', does: ['dit quel temps il fera demain', 'tells what the weather will be like'], words: ['météo', 'weather', '天気', '天气', 'погода', 'الطقس', 'मौसम'],
    actions: [{ id: 'prevoir', label: 'Prévisions', what: 'les prévisions des jours qui viennent', words: ['prévisions', 'forecast', '天気予報', '天气预报'] }] },
];

/** Une calibration fournie : toujours sûre (« seul »), et un second temps qui fait TOUJOURS perdre la première du vote. */
function calibrationQuiRenverse(): Calibration {
  const w = new Array<number>(NB_TRAITS).fill(0); w[1] = -10; // trait « premier » : la tête du vote perd 10 points
  return {
    poids: [20, 0, 0, 0, 0, 0, 0, 0], seuilSeul: 0.5, seuilTrois: 0.4, cas: 0, justesse1: 0, justesse3: 0, horsChamp: { n: 0, justes: 0 }, ms: 0,
    poidsAction: [20, 0, 0, 0, 0, 0, 0, 0], seuilAction: 0.5,
    reclasse: { w, moy: new Array(NB_TRAITS).fill(0), ec: new Array(NB_TRAITS).fill(1) },
  };
}

test('réglages (tour 6) : la part expliquée et le second temps sont en service ; le calcul du tour 5 reste disponible', () => {
  assert.ok(REGLAGES.explique > 0 && REGLAGES.reclasser, 'tour 6 en service');
  assert.deepEqual(CALCUL_TOUR5, { explique: 0, reclasser: false, candidatesSecond: 3, candidatesRapport: 0, actionRarete: 0, actionModele: 0 });
  assert.ok(REGLAGES.reclasseMarge >= 1, `marge ${REGLAGES.reclasseMarge} : une autre appli ne passe devant que nettement`);
  assert.ok(REGLAGES.viseSeul >= 0.97, '« seul » reste prudent');
  // Ancien calcul : aucun second temps n'est appris, et ses réponses ne dépendent pas des réglages du tour 6.
  const a = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, ...CALCUL_TOUR5 }, modules: MODULES });
  const b = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, ...CALCUL_TOUR5, expliqueParAppli: 1, reclasseMarge: 0, reclasseAlpha: 3 }, modules: MODULES });
  assert.equal(a.bilan.calibration.reclasse, undefined);
  for (const q of ['joue une chanson', 'bloque ce site', 'note ça pour demain', 'quel temps demain', '播放音乐', 'погода завтра']) assert.deepEqual(a.aiguiller(q), b.aiguiller(q), q);
});

test('second temps : une autre tête n\'agit jamais seule, ses notes suivent l\'ordre, l\'action n\'est pas dite sûre', () => {
  const ref = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, reclasser: false }, modules: MODULES, calibration: calibrationQuiRenverse() });
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, calibration: calibrationQuiRenverse() });
  let changes = 0;
  for (const q of ['joue une chanson', 'bloque ce site', 'note ça pour demain', 'quel temps fera-t-il demain', 'play a song', '记下这个笔记']) {
    const r0 = ref.aiguiller(q), r = a.aiguiller(q);
    // Une demande que la matière connaît mal ne décide jamais (couverture) : seules celles où le vote agirait seul comptent.
    if (r0.choix.filter((c) => c.appli !== null).length < 2 || r0.choix[0]?.appli === null || r0.decision !== 'seul') continue;
    assert.notEqual(r.choix[0]?.appli, r0.choix[0]?.appli, `${q} : la tête change`);
    assert.deepEqual(new Set(r.choix.map((c) => c.appli)), new Set(r0.choix.map((c) => c.appli)), `${q} : les mêmes trois choix`);
    assert.equal(r.decision, 'trois', `${q} : une tête changée ne décide pas seule`);
    assert.equal(r.actionSure, false); assert.equal(r.confianceAction, undefined);
    for (let i = 1; i < r.choix.length; i++) assert.ok(r.choix[i].score <= r.choix[i - 1].score, `${q} : notes décroissantes`);
    changes++;
  }
  assert.ok(changes >= 3, `${changes} demandes où le second temps change la tête`);
  // Relance dans une appli active : le second temps n'y touche pas.
  const ctx = { appli: 'lyre_t' };
  assert.deepEqual(a.aiguiller('joue une chanson', ctx).choix, ref.aiguiller('joue une chanson', ctx).choix);
});

test('second temps : une correction du propriétaire presque identique l\'emporte toujours', () => {
  const home = dossier();
  try {
    const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home, calibration: calibrationQuiRenverse() });
    assert.equal(a.apprendre({ demande: 'la météo de la musique', appli: 'carnet_t', action: 'noter', provenance: 'proprietaire' }).ok, true);
    assert.equal(a.aiguiller('la météo de la musique').choix[0]?.appli, 'carnet_t');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('second temps : une correction du propriétaire qui n\'est qu\'une voisine (une paraphrase) garde aussi sa tête', () => {
  // Le second temps ne voit pas les corrections ; quand le vote met en tête l'appli d'une correction voisine, il n'y touche pas.
  for (const reclasser of [false, true]) {
    const home = dossier();
    try {
      const a = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, reclasser }, modules: MODULES, home, calibration: calibrationQuiRenverse() });
      for (const demande of ['le bulletin du temps en chanson', 'la météo chantée', 'fredonne moi la météo']) assert.equal(a.apprendre({ demande, appli: 'carnet_t', action: 'noter', provenance: 'proprietaire' }).ok, true);
      const r = a.aiguiller('le bulletin météo du temps en chanson');
      assert.ok(r.choix.filter((c) => c.appli !== null).length >= 2, 'au moins deux candidates : le second temps aurait pu jouer');
      assert.equal(r.choix[0]?.appli, 'carnet_t', `reclasser=${reclasser} : ${r.choix.map((c) => c.appli).join(',')}`);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test('second temps : la règle du propriétaire entre deux applis presque à égalité est réappliquée après lui', () => {
  const mods: ModuleMatiere[] = [
    ...MODULES,
    { id: 'arche_t', name: 'Copie', what: 'sauvegarde de la base', words: ['sauvegarde de la base'], actions: [] },
    { id: 'phenix_t', name: 'Copie', what: 'sauvegarde de la base', words: ['sauvegarde de la base', 'sauvegarde de la base complète'], actions: [] },
  ];
  const p = 'sauvegarde de la base complète', preferences = [['arche_t', 'phenix_t']] as const;
  const sans = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, margePreference: 0.9, reclasser: false }, modules: mods, preferences, calibration: calibrationQuiRenverse() });
  const avec = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, margePreference: 0.9 }, modules: mods, preferences, calibration: calibrationQuiRenverse() });
  assert.equal(sans.aiguiller(p).choix[0]?.appli, 'arche_t', 'la règle du propriétaire');
  // Le second temps fait perdre la tête (arche_t) ; s'il met phenix_t devant, la règle la remet derrière arche_t.
  const r = avec.aiguiller(p);
  if (r.choix[0]?.appli === 'phenix_t') assert.fail('la préférence du propriétaire est renversée');
  const i = r.choix.findIndex((c) => c.appli === 'phenix_t'), j = r.choix.findIndex((c) => c.appli === 'arche_t');
  if (i >= 0 && j >= 0 && Math.min(i, j) === 0) assert.ok(j < i);
});

/** Des phrases de deux applis dans neuf écritures (aucun découpage en mots). */
const PHRASES: Array<[string, string]> = [
  ['son', 'joue de la musique'], ['son', 'mets une chanson'], ['son', 'play some music'], ['son', 'put on a song'], ['son', '音楽を再生して'], ['son', '播放音乐'], ['son', 'включи музыку'],
  ['son', 'شغل الموسيقى'], ['son', 'संगीत चलाओ'], ['son', '음악 틀어줘'], ['son', 'spiel musik ab'],
  ['mur', 'bloque ce site'], ['mur', 'ferme le pare-feu'], ['mur', 'block this website'], ['mur', 'turn on the firewall'], ['mur', 'このサイトをブロックして'], ['mur', '封锁这个网站'], ['mur', 'заблокируй сайт'],
  ['mur', 'احظر هذا الموقع'], ['mur', 'इस साइट को ब्लॉक करो'], ['mur', '이 사이트 차단해'], ['mur', 'blockiere die seite'],
  ['note', 'note cette idée'], ['note', 'write this down'], ['note', 'メモして'], ['note', '记下这个'], ['note', 'запиши заметку'], ['note', 'دوّن ملاحظة'], ['note', 'नोट लिखो'], ['note', '메모해줘'],
];
const paires = (): Paire[] => PHRASES.map(([a, t], i) => ({ texte: t, appli: a, action: 'faire', source: 'essai', demande: true, groupe: `g${i}` }));

test('second temps : toutes les écritures, le modèle local départage les candidates sans découpage en mots', () => {
  const ix = new IndexNgrammes(paires(), { ...REGLAGES });
  const rc = new Reclasseur(ix, { alpha: REGLAGES.reclasseAlpha, beta: REGLAGES.reclasseBeta, tours: REGLAGES.reclasseTours, pasLocal: 1, poidsDemande: REGLAGES.poidsDemande });
  const tot = rc.totaux();
  // Seul le modèle local compte (dernier trait) ; les candidates sont données dans le mauvais ordre.
  const w = new Array<number>(NB_TRAITS).fill(0); w[NB_TRAITS - 1] = 1;
  const m = { w, moy: new Array(NB_TRAITS).fill(0), ec: new Array(NB_TRAITS).fill(1) };
  const cas: Array<[string, string]> = [['son', '音楽をかけて'], ['son', 'музыку включи пожалуйста'], ['son', 'شغل موسيقى'], ['son', 'संगीत बजाओ'], ['son', '播放一首音乐'],
    ['mur', 'サイトをブロック'], ['mur', 'сайт заблокируй'], ['mur', 'احظر الموقع'], ['mur', 'साइट ब्लॉक करो'], ['mur', '封锁网站'], ['mur', '사이트 차단']];
  for (const [attendu, q] of cas) {
    const S = attendu === 'son' ? ['mur', 'note', 'son'] : ['son', 'note', 'mur'];
    const X = rc.traits(q, S, [0.4, 0.35, 0.25], tot);
    assert.equal(X.length, 3); assert.ok(X.every((x) => x.length === NB_TRAITS && x.every(Number.isFinite)), q);
    const n = noterReclasse(m, X);
    assert.equal(S[n.indexOf(Math.max(...n))], attendu, `${q} : ${n.map((v) => v.toFixed(2)).join(' ')}`);
  }
});

test('second temps : déterministe, et la marge garde l\'ordre du vote quand l\'écart est faible', () => {
  const ix = new IndexNgrammes(paires(), { ...REGLAGES });
  const faire = () => {
    const rc = new Reclasseur(ix, { alpha: 0.1, beta: 0.5, tours: 5, pasLocal: 1, poidsDemande: 2 });
    const tot = rc.totaux();
    const ex = PHRASES.map(([a, t], i) => { const S = ['son', 'mur', 'note'].sort((x, y) => ((x === a ? 1 : 0) - (y === a ? 1 : 0)) || (i % 2 ? 1 : -1) * (x < y ? -1 : 1)); return { X: rc.traits(t, S, [0.5, 0.3, 0.2], tot), y: S.indexOf(a) }; });
    return ajusterReclasse(ex, 200);
  };
  const m1 = faire(), m2 = faire();
  assert.deepEqual(m1, m2, 'mêmes poids pour la même matière');
  assert.ok(m1.w.every(Number.isFinite));
  assert.deepEqual(ordreReclasse([0, 0.9, 0.2], 1), [0, 1, 2], 'écart 0,9 < marge 1 : ordre du vote');
  assert.deepEqual(ordreReclasse([0, 1.5, 0.2], 1), [1, 2, 0], 'écart 1,5 : la deuxième passe devant');
  assert.deepEqual(ordreReclasse([2, 0.1, 0.5], 1), [0, 2, 1], 'la tête reste ; les suivantes par note');
});

test('part expliquée : une appli dont les paires reprennent le même mot explique moins que celle qui couvre l\'action ET l\'objet', () => {
  const p: Paire[] = [
    { texte: 'sauvegarde', appli: 'a', action: null, source: 'essai' }, { texte: 'sauvegarder', appli: 'a', action: null, source: 'essai' }, { texte: 'lance la sauvegarde', appli: 'a', action: null, source: 'essai' },
    { texte: 'sauvegarde', appli: 'b', action: null, source: 'essai' }, { texte: 'base de données', appli: 'b', action: null, source: 'essai' },
  ];
  const ix = new IndexNgrammes(p, { ...REGLAGES });
  const { idx, sim, q } = ix.ressemblances('sauvegarde la base de données');
  const de = (a: string) => idx.map((d, i) => (ix.paire(d).appli === a ? i : -1)).filter((i) => i >= 0);
  const E = ix.expliquer(q, idx, [de('a'), de('b')], 1);
  assert.ok(E[0] >= 0 && E[0] <= 1 && E[1] >= 0 && E[1] <= 1, `${E[0]} ${E[1]}`);
  assert.ok(E[1] > E[0] + 0.2, `b explique ${E[1].toFixed(3)}, a ${E[0].toFixed(3)}`);
  // Toutes les écritures : la même mesure sur du chinois et du russe (n-grammes de caractères).
  const p2: Paire[] = [{ texte: '备份', appli: 'a', action: null, source: 'essai' }, { texte: '备份数据', appli: 'a', action: null, source: 'essai' }, { texte: '备份', appli: 'b', action: null, source: 'essai' }, { texte: '数据库', appli: 'b', action: null, source: 'essai' },
    { texte: 'копия', appli: 'a', action: null, source: 'essai' }, { texte: 'база данных', appli: 'b', action: null, source: 'essai' }];
  const ix2 = new IndexNgrammes(p2, { ...REGLAGES });
  for (const t of ['备份数据库', 'копия базы данных']) {
    const r = ix2.ressemblances(t), d2 = (a: string) => r.idx.map((d, i) => (ix2.paire(d).appli === a ? i : -1)).filter((i) => i >= 0);
    const E2 = ix2.expliquer(r.q, r.idx, [d2('a'), d2('b')], 1);
    assert.ok(E2[1] > E2[0], `${t} : ${E2[0].toFixed(3)} ${E2[1].toFixed(3)}`);
  }
});

test('calibration (tour 6) : le second temps est appris sur la matière, gardé, relu, et refusé s\'il est abîmé ; temps borné', () => {
  const home = dossier(), dir = dossier();
  try {
    // Une matière d'essai : les phrases ci-dessus et leurs variantes, rangées par appli dans un seul fichier.
    const mods: ModuleMatiere[] = [...MODULES, { id: 'son', name: 'Son', actions: [{ id: 'faire', label: 'Faire' }] }, { id: 'mur', name: 'Mur', actions: [{ id: 'faire', label: 'Faire' }] }, { id: 'note', name: 'Note', actions: [{ id: 'faire', label: 'Faire' }] }];
    const applis: Record<string, Record<string, string[]>> = { son: { faire: [] }, mur: { faire: [] }, note: { faire: [] } };
    for (const [a0, t] of PHRASES) applis[a0].faire.push(t, `${t} maintenant`, `s'il te plaît ${t}`);
    writeFileSync(join(dir, 'fr.json'), JSON.stringify({ langue: 'fr', ecriture: 'mixte', origine: 'essai', aRelire: false, applis }));
    const opts = { matiere: dir, reglages: ESSAI, modules: mods, home };
    oublierCalibrations();
    const t0 = performance.now();
    const a = creerAiguilleurSync(opts);
    const ms = performance.now() - t0;
    assert.ok(ms < 60_000, `construction en ${Math.round(ms)} ms`);
    const c = a.bilan.calibration;
    assert.ok(c.reclasse, 'le second temps est appris');
    assert.ok((c.reclasseCas ?? 0) >= RECLASSE_EXEMPLES_MIN && (c.reclasseCas ?? 0) <= c.cas, `${c.reclasseCas} exemples pour ${c.cas} cas`);
    assert.equal(c.reclasse.w.length, NB_TRAITS);
    // Trop peu d'exemples : pas de second temps, et l'aiguilleur répond quand même.
    const petit = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
    if ((petit.bilan.calibration.reclasseCas ?? 0) < RECLASSE_EXEMPLES_MIN) assert.equal(petit.bilan.calibration.reclasse, undefined);
    assert.ok(petit.aiguiller('joue une chanson').choix.length > 0);
    // Relue du dossier d'Odin (même matière) ; abîmée (un écart nul, une longueur fausse), elle est refaite.
    oublierCalibrations();
    const b = creerAiguilleurSync(opts);
    assert.equal(b.bilan.calibrationDe, 'fichier');
    assert.deepEqual(b.bilan.calibration.reclasse, c.reclasse);
    const f = fichierCalibration(home), j = JSON.parse(readFileSync(f, 'utf8'));
    j.calibration.reclasse = { w: new Array(NB_TRAITS).fill(1), moy: new Array(NB_TRAITS).fill(0), ec: new Array(NB_TRAITS).fill(0) };
    writeFileSync(f, JSON.stringify(j)); oublierCalibrations();
    assert.equal(creerAiguilleurSync(opts).bilan.calibrationDe, 'calcul');
    j.calibration.reclasse = { w: [1, 2], moy: [0, 0], ec: [1, 1] };
    writeFileSync(f, JSON.stringify(j)); oublierCalibrations();
    assert.equal(creerAiguilleurSync(opts).bilan.calibrationDe, 'calcul');
    // Par demande : borné, même avec une entrée énorme.
    const t1 = performance.now();
    for (let i = 0; i < 50; i++) a.aiguiller(`joue une chanson ${i} ${'x'.repeat(i * 40)}`);
    const parDemande = (performance.now() - t1) / 50;
    assert.ok(parDemande < 1000, `${parDemande.toFixed(1)} ms par demande`);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); oublierCalibrations(); }
});
