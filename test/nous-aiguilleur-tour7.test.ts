// L'aiguilleur, tour 7 (Soul v3) : le second temps sur plus de trois candidates (nbCandidates) et l'action choisie par
// ce qui oppose les actions d'une appli (src/brain/nous/action.ts). Déterminisme, toutes les écritures, temps borné,
// l'appli et sa décision inchangées par le calcul de l'action, et l'ancien calcul (CALCUL_TOUR6) toujours disponible
// derrière le même contrat. Applis d'essai, sans dossier d'Odin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CALCUL_TOUR6, PROVENANCE_ACCEPTEE, REGLAGES, creerAiguilleurSync, nbCandidates, oublierCalibrations, type ModuleMatiere } from '../src/brain/nous/aiguilleur.ts';

const ESSAI = { rapportHorsChamp: 1 };

// Dans chaque appli, toutes les actions parlent du même objet : seule la tournure les sépare.
const MODULES: ModuleMatiere[] = [
  { id: 'onde_t', name: 'Onde', what: 'le wifi de la maison', does: ['gère le wifi de la maison', 'manages the home wifi'], words: ['wifi', 'réseau sans fil', 'wireless', 'ワイファイ', '无线网络', 'вайфай', 'واي فاي', 'वाईफाई'],
    actions: [
      { id: 'allumer', label: 'Allumer', what: 'allume le wifi', words: ['allume le wifi', 'turn on the wifi', 'ワイファイをつけて', '打开无线网络', 'включи вайфай', 'شغل الواي فاي', 'वाईफाई चालू करो'] },
      { id: 'couper', label: 'Couper', what: 'coupe le wifi', words: ['coupe le wifi', 'turn off the wifi', 'ワイファイを切って', '关闭无线网络', 'выключи вайфай', 'أطفئ الواي فاي', 'वाईफाई बंद करो'] },
      { id: 'partager', label: 'Partager', what: 'donne le code du wifi à un invité', words: ['donne le code du wifi', 'share the wifi password', 'ワイファイのパスワードを教えて', '分享无线网络密码', 'дай пароль от вайфая', 'شارك كلمة سر الواي فاي', 'वाईफाई का पासवर्ड बताओ'] },
    ] },
  { id: 'agenda_t', name: 'Agenda', what: 'les rendez-vous', does: ['garde tes rendez-vous', 'keeps your appointments'], words: ['rendez-vous', 'appointment', '予約', '预约', 'встреча', 'موعد', 'अपॉइंटमेंट'],
    actions: [
      { id: 'creer', label: 'Créer', what: 'crée un rendez-vous', words: ['prends un rendez-vous', 'book an appointment', '予約を入れて', '安排一个预约', 'запиши на встречу', 'احجز موعدا', 'अपॉइंटमेंट बुक करो'] },
      { id: 'annuler', label: 'Annuler', what: 'annule un rendez-vous', words: ['annule le rendez-vous', 'cancel the appointment', '予約をキャンセルして', '取消预约', 'отмени встречу', 'ألغ الموعد', 'अपॉइंटमेंट रद्द करो'] },
    ] },
  { id: 'lyre_t', name: 'Lyre', what: 'écouter de la musique', does: ['joue la musique que tu aimes', 'plays the music you like'], words: ['musique', 'chanson', 'music', 'song', '音楽', '音乐', 'музыка', 'موسيقى', 'संगीत'],
    actions: [{ id: 'jouer', label: 'Jouer', what: 'joue un morceau', words: ['joue', 'play', '再生', '播放', 'включи'] }, { id: 'pause', label: 'Pause', what: 'met la musique en pause', words: ['pause', 'stop the music'] }] },
  { id: 'ciel_t', name: 'Ciel', what: 'la météo et les prévisions', does: ['dit quel temps il fera demain', 'tells what the weather will be like'], words: ['météo', 'weather', '天気', '天气', 'погода', 'الطقس', 'मौसम'],
    actions: [{ id: 'prevoir', label: 'Prévisions', what: 'les prévisions des jours qui viennent', words: ['prévisions', 'forecast', '天気予報', '天气预报'] }] },
  { id: 'carnet_t', name: 'Carnet', what: 'tes notes', does: ['garde tes notes et tes idées', 'keeps your notes and ideas'], words: ['note', 'notes', 'memo', 'メモ', '笔记', 'заметка'],
    actions: [{ id: 'noter', label: 'Noter', what: 'écrit une note', words: ['note ça', 'write down', 'メモして', '记下'], read: true }] },
];

// Des demandes dans plusieurs langues et écritures (aucune n'est une phrase de la matière d'essai mot pour mot).
const DEMANDES = [
  'coupe vite le wifi', 'please turn the wifi off now', 'ワイファイを今すぐ切って', '请关闭家里的无线网络', 'выключи пожалуйста вайфай', 'أطفئ الواي فاي الآن', 'वाईफाई अभी बंद करो',
  'allume-moi le wifi', 'can you turn on the wifi', '打开无线网络吧', 'включи вайфай дома', 'donne le code du wifi à mon invité', 'share the wifi password with my guest',
  'annule mon rendez-vous de demain', 'cancel my appointment tomorrow', '予約をキャンセルしてください', '取消明天的预约', 'отмени завтрашнюю встречу', 'ألغ موعدي غدا', 'कल का अपॉइंटमेंट रद्द करो',
  'prends-moi un rendez-vous', 'book me an appointment', '安排明天的预约', 'запиши меня на встречу', 'joue une chanson', 'quel temps fera-t-il demain', 'note ça pour plus tard', '天气怎么样', 'погода завтра',
];

const ANCIEN_ACTION = { actionRarete: 0, actionModele: 0 };

test('réglages (tour 7) : plus de candidates au second temps et l\'action par opposition sont en service ; le calcul du tour 6 reste disponible', () => {
  assert.ok(REGLAGES.candidatesSecond > 3 && REGLAGES.candidatesRapport > 0, 'second temps élargi');
  assert.ok(REGLAGES.actionRarete > 0 && REGLAGES.actionModele > 0 && REGLAGES.actionModele < 1, 'action par opposition');
  assert.ok(REGLAGES.viseSeul >= 0.97, '« seul » reste prudent');
  assert.deepEqual(CALCUL_TOUR6, { candidatesSecond: 3, candidatesRapport: 0, actionRarete: 0, actionModele: 0 });
  // Le calcul du tour 6 ne dépend pas des réglages du tour 7 qu'il éteint.
  const a = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, ...CALCUL_TOUR6 }, modules: MODULES });
  const b = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, ...CALCUL_TOUR6, actionTours: 9, actionPas: 0.1 }, modules: MODULES });
  assert.deepEqual(b.bilan.calibration.poidsAction, a.bilan.calibration.poidsAction);
  for (const q of DEMANDES) assert.deepEqual(b.aiguiller(q), a.aiguiller(q), q);
});

test('nbCandidates : trois toujours, puis les suivantes tant que leur part compte encore, jamais plus que le réglage', () => {
  const R = { ...REGLAGES, candidatesSecond: 5, candidatesRapport: 0.2 };
  const c = (...p: number[]) => p.map((part) => ({ part }));
  assert.equal(nbCandidates(c(0.9, 0.05, 0.03, 0.01, 0.01), R), 3);
  assert.equal(nbCandidates(c(0.4, 0.3, 0.1, 0.09, 0.085), R), 5);
  assert.equal(nbCandidates(c(0.4, 0.3, 0.1, 0.09, 0.07, 0.04), R), 4, 'une candidate sous 0,2 × la première arrête la liste');
  assert.equal(nbCandidates(c(0.5, 0.2, 0.15, 0.15, 0.15, 0.15), R), 5, 'au plus candidatesSecond');
  assert.equal(nbCandidates(c(0.6, 0.4), R), 2);
  assert.equal(nbCandidates(c(0.4, 0.3, 0.1, 0.09, 0.085), { ...R, candidatesSecond: 3 }), 3, 'le calcul du tour 6');
});

test('action par opposition : l\'appli, l\'ordre des applis et la décision ne changent pas ; seules les actions et leur confiance', () => {
  const ancien = creerAiguilleurSync({ matiere: false, reglages: { ...ESSAI, ...ANCIEN_ACTION }, modules: MODULES });
  const nouveau = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  const actions = new Map(MODULES.map((m) => [m.id, new Set(m.actions.map((x) => x.id))]));
  for (const q of DEMANDES) {
    const r0 = ancien.aiguiller(q), r = nouveau.aiguiller(q);
    assert.deepEqual(r.choix.map((c) => c.appli), r0.choix.map((c) => c.appli), `${q} : mêmes applis dans le même ordre`);
    assert.equal(r.decision, r0.decision, `${q} : même décision`);
    assert.equal(r.confiance, r0.confiance, `${q} : même confiance dans l'appli`);
    for (const c of r.choix) if (c.appli !== null && c.action !== null) assert.ok(actions.get(c.appli)?.has(c.action), `${q} : ${c.appli}.${c.action} est une action de l'appli`);
    // « seul » sans action sûre dit toujours de demander l'action.
    if (r.decision === 'seul' && !r.actionSure) assert.ok(/demander/.test(r.raison));
  }
});

// Sur une matière aussi petite, l'action du tour 6 trouve aussi ces actions : cet essai garde la justesse dans toutes
// les écritures, il ne prouve pas le gain (mesuré au banc, carnet soul-v3-tour-7).
test('action par opposition : la bonne action parmi des actions qui parlent toutes du même objet, dans toutes les écritures', () => {
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  const attendu: Array<[string, string, string]> = [
    ['coupe vite le wifi', 'onde_t', 'couper'], ['please turn the wifi off now', 'onde_t', 'couper'], ['请关闭家里的无线网络', 'onde_t', 'couper'], ['выключи пожалуйста вайфай', 'onde_t', 'couper'],
    ['can you turn on the wifi', 'onde_t', 'allumer'], ['share the wifi password with my guest', 'onde_t', 'partager'],
    ['cancel my appointment tomorrow', 'agenda_t', 'annuler'], ['取消明天的预约', 'agenda_t', 'annuler'], ['book me an appointment', 'agenda_t', 'creer'],
  ];
  for (const [q, appli, action] of attendu) {
    const r = a.aiguiller(q);
    const c = r.choix.find((x) => x.appli === appli);
    assert.ok(c, `${q} : ${appli} parmi les choix`);
    assert.equal(c!.action, action, `${q} : ${appli}.${action}`);
  }
});

test('déterminisme : deux constructions rendent exactement les mêmes calibrations et les mêmes réponses', () => {
  oublierCalibrations();
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  oublierCalibrations();
  const b = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  const { ms: _1, ...c1 } = a.bilan.calibration, { ms: _2, ...c2 } = b.bilan.calibration;
  assert.deepEqual(c2, c1);
  for (const q of DEMANDES) {
    assert.deepEqual(b.aiguiller(q), a.aiguiller(q), q);
    // Et une même demande posée deux fois de suite (les modèles d'action sont gardés après la première).
    assert.deepEqual(a.aiguiller(q), b.aiguiller(q), `${q} (seconde fois)`);
  }
  // Avec une relance : l'action précédente garde la main quand la phrase ne dit rien de l'action.
  const ctx = { appli: 'onde_t', actionPrecedente: 'couper', precedent: 'coupe le wifi' };
  assert.deepEqual(a.aiguiller('et maintenant ?', ctx), b.aiguiller('et maintenant ?', ctx));
});

test('temps borné : construction et réponses de l\'aiguilleur d\'essai', () => {
  oublierCalibrations();
  const t0 = performance.now();
  const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
  const construction = performance.now() - t0;
  assert.ok(construction < 60_000, `construction ${Math.round(construction)} ms`);
  const t1 = performance.now();
  for (let i = 0; i < 3; i++) for (const q of DEMANDES) a.aiguiller(q);
  const parDemande = (performance.now() - t1) / (3 * DEMANDES.length);
  assert.ok(parDemande < 200, `${parDemande.toFixed(1)} ms par demande`);
});

// Relecture du tour 7 (constat 1) : action.ts garde, par appli, un index et un modèle faits sur les paires de l'appli.
// Une correction refaite retire l'ancienne paire : ce qui était gardé doit être refait sans elle, tout de suite, comme
// au tour 6 (contrat M4 : « une correction refaite remplace l'ancienne, en mémoire »), sans attendre une reconstruction.
test('correction refaite : l\'action suit la nouvelle correction tout de suite, même après une reconstruction', () => {
  const P = 'le wifi du salon, maintenant';
  for (const reglages of [ESSAI, { ...ESSAI, ...CALCUL_TOUR6 }]) {
    for (const chauffe of [true, false]) {
      const home = mkdtempSync(join(tmpdir(), 'odin-aiguilleur-tour7-'));
      try {
        oublierCalibrations();
        const a0 = creerAiguilleurSync({ matiere: false, reglages, modules: MODULES, home });
        assert.deepEqual(a0.apprendre({ demande: P, appli: 'onde_t', action: 'partager', provenance: PROVENANCE_ACCEPTEE }), { ok: true });
        // Reconstruit : la correction devient une paire de base, que action.ts apprend.
        const a = creerAiguilleurSync({ matiere: false, reglages, modules: MODULES, home });
        if (chauffe) assert.equal(a.aiguiller(P).choix[0].action, 'partager');
        a.aiguiller('coupe le wifi');
        // Refaite : l'ancienne paire est retirée.
        assert.deepEqual(a.apprendre({ demande: P, appli: 'onde_t', action: 'couper', provenance: PROVENANCE_ACCEPTEE }), { ok: true });
        const r = a.aiguiller(P).choix[0];
        assert.equal(`${r.appli}.${r.action}`, 'onde_t.couper', `${JSON.stringify(reglages)}, ${chauffe ? 'cache chaud' : 'sans chauffe'}`);
        const neuf = creerAiguilleurSync({ matiere: false, reglages, modules: MODULES, home }).aiguiller(P).choix[0];
        assert.equal(`${neuf.appli}.${neuf.action}`, 'onde_t.couper', 'après reconstruction');
      } finally { rmSync(home, { recursive: true, force: true }); }
    }
  }
});
