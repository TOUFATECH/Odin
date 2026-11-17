// L'aiguilleur prêt en mémoire vive (src/brain/nous/aiguilleur-pret.ts) et le vote rapide de l'aiguilleur :
//   (a) mêmes réponses, dans le même ordre, que l'ancien chemin (gardé comme référence : cheminDeReference) ;
//   (b) une préparation abîmée, périmée ou étrangère est refusée et refaite, jamais utilisée ;
//   (c) ce qui change sur le disque (matière, corrections) est vu à la demande suivante, et une correction retirée
//       disparaît de tout ce qui est gardé (mémoire et disque) ;
//   (d) la mémoire gardée est bornée par le comptable (budget-memoire.ts) et rendue sous pression ;
//   (e) sans rien de gardé, les réponses restent les mêmes.
// Applis d'essai (pas celles du produit) et dossiers d'Odin jetables, sauf le dernier essai qui rejoue tout le jeu de
// travail du banc (test/soul-banc/jeux/developpement.json) sur les applis du produit, dans un dossier jetable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IndexNgrammes, REGLAGES, cheminDeReference, creerAiguilleurSync, fichierCorrections, kPlusProches, oublierCalibrations,
  type ContexteAiguilleur, type ModuleMatiere,
} from '../src/brain/nous/aiguilleur.ts';
import {
  creerAiguilleurPret, decoderPreparation, empreinteCoeur, encoderPreparation, fichierPreparation, oublierPreparations, preparationsGardees, VERIFICATION_MS,
} from '../src/brain/nous/aiguilleur-pret.ts';
import { budgetLibreMo } from '../src/brain/budget-memoire.ts';

const MODULES: ModuleMatiere[] = [
  { id: 'ciel_t', name: 'Ciel', what: 'la météo et les prévisions', does: ['dit quel temps il fera demain', 'tells what the weather will be like'], words: ['météo', 'temps qu\'il fait', 'weather', '天気', '天气', 'погода', 'الطقس', 'मौसम'],
    actions: [{ id: 'prevoir', label: 'Prévisions', what: 'les prévisions des jours qui viennent', words: ['prévisions', 'forecast', '天気予報', '天气预报', 'прогноз погоды', 'توقعات الطقس'] }] },
  { id: 'lyre_t', name: 'Lyre', what: 'écouter de la musique', words: ['musique', 'chanson', 'music', 'song', '音楽', '音乐', 'музыка', 'موسيقى'],
    actions: [{ id: 'jouer', label: 'Jouer', what: 'joue un morceau', words: ['joue', 'play', '再生', '播放', 'включи'] }, { id: 'pause', label: 'Pause', what: 'met la musique en pause', words: ['pause', 'arrête la musique', 'stop the music'] }] },
  { id: 'rempart_t', name: 'Rempart', what: 'le pare-feu qui bloque ou autorise des sites', words: ['pare-feu', 'firewall', 'bloquer un site', 'ファイアウォール'],
    actions: [{ id: 'bloquer', label: 'Bloquer', what: 'bloque un site', words: ['bloque', 'block', 'ブロック', '封锁'] }, { id: 'autoriser', label: 'Autoriser', what: 'débloque un site', words: ['débloque', 'unblock', 'autorise'] }] },
  { id: 'carnet_t', name: 'Carnet', what: 'tes notes', words: ['note', 'notes', 'memo', 'メモ', '笔记'],
    actions: [{ id: 'noter', label: 'Noter', what: 'écrit une note', words: ['note ça', 'write down', 'メモして', '记下'] }] },
];
const ESSAI = { rapportHorsChamp: 1 };
const PHRASES: Array<[string, ContexteAiguilleur | undefined]> = [
  ['la météo demain', undefined], ['what is the weather like', undefined], ['明日の天気は？', undefined], ['明天天气怎么样', undefined], ['какая сегодня погода', undefined],
  ['كيف الطقس اليوم', undefined], ['आज मौसम कैसा है', undefined], ['play some music', undefined], ['音楽を再生して', undefined], ['включи музыку', undefined],
  ['bloque ce site', undefined], ['note ça : acheter du pain', undefined], ['réserve-moi un billet d\'avion pour Rome', undefined], ['', undefined], ['?!…', undefined],
  ['et celui-là aussi', { precedent: 'bloque le site jeux.example', appli: 'rempart_t', actionPrecedente: 'bloquer' }],
  ['et demain ?', { precedent: 'quel temps fait-il', appli: 'ciel_t' }], ['mets en pause', { appli: 'lyre_t' }], ['débloque-le', { precedent: 'bloque ce site' }],
  ['météo '.repeat(500), undefined], ['joue\u0000 de la\u0007 musique ', undefined], ['ｍｅｔｅｏ', undefined],
];
const dossier = () => mkdtempSync(join(tmpdir(), 'odin-aiguilleur-pret-essai-'));
const repondre = (a: { aiguiller: (p: string, c?: ContexteAiguilleur) => unknown }) => PHRASES.map(([p, c]) => a.aiguiller(p, c));
const ENV = ['ODIN_MEMOIRE_LIBRE_MO', 'ODIN_MEMOIRE_MARGE_MO', 'ODIN_MEMOIRE_PLAFOND_MO'] as const;
function avecEnv(v: Partial<Record<typeof ENV[number], string>>, f: () => void): void {
  const avant = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  try { for (const k of ENV) { if (v[k] === undefined) delete process.env[k]; else process.env[k] = v[k]; } f(); }
  finally { for (const k of ENV) { if (avant[k] === undefined) delete process.env[k]; else process.env[k] = avant[k]; } }
}
const attendre = (ms: number) => { const fin = Date.now() + ms; while (Date.now() < fin) { /* attente active : les essais restent synchrones */ } };

test('k plus proches : exactement le tri complet, égalités comprises, pour toute valeur de k', () => {
  let graine = 7; const hasard = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
  for (let essai = 0; essai < 300; essai++) {
    const n = Math.floor(hasard() * 80);
    const idx = Array.from({ length: n }, (_, i) => i * 3 + Math.floor(hasard() * 3)).sort(() => hasard() - 0.5);
    // Beaucoup d'égalités (valeurs arrondies) : le second critère (indice de paire) doit trancher pareil.
    const sim = idx.map(() => Math.round(hasard() * 6) / 6);
    for (const k of [0, 1, 2, 5, 25, n - 1, n, n + 3, 2.5, -1]) {
      const ref = idx.map((_, i) => i).sort((a, b) => sim[b] - sim[a] || idx[a] - idx[b]).slice(0, k);
      assert.deepEqual(kPlusProches(idx, sim, k), ref, `n=${n} k=${k}`);
    }
  }
});

test('vote rapide : mêmes réponses que l\'ancien chemin (référence), corrections et contexte compris', () => {
  const home1 = dossier(), home2 = dossier();
  try {
    oublierCalibrations();
    cheminDeReference(true);
    let ref: unknown[], refCal: unknown;
    try {
      const a = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home: home1 });
      for (const [d, ap] of [['fais chanter la maison', 'lyre_t'], ['la porte du jardin', 'rempart_t']] as const) assert.equal(a.apprendre({ demande: d, appli: ap, action: null, provenance: 'proprietaire' }).ok, true);
      ref = [...repondre(a), a.aiguiller('fais chanter la maison'), a.aiguiller('la porte du jardin')]; refCal = a.bilan.calibration;
    } finally { cheminDeReference(false); }
    oublierCalibrations();
    const b = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home: home2 });
    for (const [d, ap] of [['fais chanter la maison', 'lyre_t'], ['la porte du jardin', 'rempart_t']] as const) assert.equal(b.apprendre({ demande: d, appli: ap, action: null, provenance: 'proprietaire' }).ok, true);
    const vite = [...repondre(b), b.aiguiller('fais chanter la maison'), b.aiguiller('la porte du jardin')];
    assert.deepEqual(vite, ref);
    const { ms: _1, ...c1 } = refCal as { ms: number }, { ms: _2, ...c2 } = b.bilan.calibration;
    assert.deepEqual(c2, c1, 'la calibration (validation croisée par le vote) est la même');
  } finally { rmSync(home1, { recursive: true, force: true }); rmSync(home2, { recursive: true, force: true }); }
});

test('préparation : calculée puis gardée (mémoire, disque), le même cœur nombre pour nombre, les mêmes réponses', () => {
  const home = dossier();
  try {
    oublierPreparations();
    const sync = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES });
    const attendu = repondre(sync);
    const a = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(a.bilan.preparationDe, 'calcul');
    assert.ok(existsSync(fichierPreparation(home)), 'la préparation est écrite dans le dossier d\'Odin');
    assert.deepEqual(repondre(a), attendu);
    const b = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(b.bilan.preparationDe, 'memoire');
    assert.deepEqual(repondre(b), attendu);
    oublierPreparations();
    const c = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(c.bilan.preparationDe, 'fichier');
    assert.deepEqual(repondre(c), attendu);
  } finally { rmSync(home, { recursive: true, force: true }); oublierPreparations(); }
});

test('préparation : encodée puis relue, le cœur est identique ; une empreinte différente est « périmée »', () => {
  const R = { ...REGLAGES, ...ESSAI };
  const paires = [
    { texte: 'la météo de demain', appli: 'ciel_t', action: 'prevoir', source: 'essai', demande: true },
    { texte: '明日の天気', appli: 'ciel_t', action: null, source: 'essai' },
    { texte: 'joue de la musique 🎵 \ud800', appli: 'lyre_t', action: 'jouer', source: 'essai', poids: 2 },
    { texte: 'réserve un vol', appli: null, action: null, source: 'essai', demande: true },
  ];
  const ix = new IndexNgrammes(paires, R), emp = empreinteCoeur(paires, R);
  const buf = encoderPreparation(emp, paires.length, ix.coeur)!;
  const lu = decoderPreparation(buf, emp, paires.length);
  assert.ok('coeur' in lu, JSON.stringify(lu));
  const c = lu.coeur, o = ix.coeur;
  assert.deepEqual([...c.vocab], [...o.vocab], 'même vocabulaire (une demi-paire de substitution comprise), mêmes identifiants');
  assert.deepEqual(Buffer.from(c.idf.buffer), Buffer.from(o.idf.buffer));
  assert.deepEqual(Buffer.from(c.debut.buffer), Buffer.from(o.debut.buffer));
  assert.deepEqual(Buffer.from(c.postDoc.buffer), Buffer.from(o.postDoc.buffer));
  assert.deepEqual(Buffer.from(c.postPoids.buffer), Buffer.from(o.postPoids.buffer));
  assert.equal(c.facteurInconnu, o.facteurInconnu);
  const ix2 = new IndexNgrammes(paires, R, c);
  for (const q of ['météo demain', 'musique', 'vol pour Rome', '天気']) assert.deepEqual(ix2.ressemblances(q), ix.ressemblances(q), q);
  // Une autre matière, d'autres réglages du cœur : une autre empreinte.
  assert.notEqual(empreinteCoeur([...paires, { texte: 'x', appli: 'lyre_t', action: null, source: 'essai' }], R), emp);
  assert.notEqual(empreinteCoeur(paires, { ...R, nMax: 3 }), emp);
  assert.equal(empreinteCoeur(paires, { ...R, poidsMots: 0, k: 7 }), emp, 'un réglage du vote seul ne périme pas le cœur');
  const autre = decoderPreparation(buf, 'f'.repeat(64), paires.length);
  assert.ok('refus' in autre && /périmée/.test(autre.refus));
});

test('préparation abîmée, tronquée, étrangère ou périmée : refusée, refaite, réécrite, jamais utilisée', () => {
  const home = dossier();
  try {
    oublierPreparations();
    const attendu = repondre(creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES }));
    creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    const f = fichierPreparation(home), bon = readFileSync(f);
    const casses: Array<[string, Buffer, RegExp]> = [
      ['un octet changé au milieu des tableaux', (() => { const b = Buffer.from(bon); b[b.length >> 1] ^= 0x5a; return b; })(), /abîmée/],
      ['un octet changé à la fin', (() => { const b = Buffer.from(bon); b[b.length - 3] ^= 0x01; return b; })(), /abîmée/],
      ['tronquée', bon.subarray(0, bon.length - 100), /abîmée/],
      ['vide', Buffer.alloc(0), /abîmée/],
      ['autre chose', Buffer.from('{"bonjour": true}'), /abîmée/],
      ['en-tête démesuré', (() => { const b = Buffer.from(bon); b.writeUInt32LE(0xfffffff0, 8); return b; })(), /abîmée/],
      ['autre empreinte', Buffer.from(bon.toString('latin1').replace(/"empreinte":"[0-9a-f]{64}"/, `"empreinte":"${'0'.repeat(64)}"`), 'latin1'), /périmée/],
    ];
    for (const [nom, octets, raison] of casses) {
      oublierPreparations();
      writeFileSync(f, octets);
      const a = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
      assert.equal(a.bilan.preparationDe, 'calcul', nom);
      assert.match(a.bilan.preparationRaison ?? '', raison, nom);
      assert.deepEqual(repondre(a), attendu, nom);
      assert.deepEqual(readFileSync(f), bon, `${nom} : réécrite`);
    }
    // Une somme de contrôle juste sur des tableaux faux (fichier fabriqué) : les tableaux sont quand même vérifiés.
    oublierPreparations();
    const ix = new IndexNgrammes([{ texte: 'abc', appli: 'lyre_t', action: null, source: 'essai' }], { ...REGLAGES, ...ESSAI });
    const faux = { ...ix.coeur, postDoc: Uint16Array.from(ix.coeur.postDoc, () => 9) };
    const r = decoderPreparation(encoderPreparation('e', 1, faux)!, 'e', 1);
    assert.ok('refus' in r && /hors bornes/.test(r.refus), JSON.stringify(r));
  } finally { rmSync(home, { recursive: true, force: true }); oublierPreparations(); }
});

test('disque changé pendant qu\'Odin tourne : la matière et les corrections sont vues à la demande suivante ; une correction retirée disparaît de tout ce qui est gardé', () => {
  const home = dossier(), mat = dossier();
  try {
    oublierPreparations();
    const fichier = (phrases: string[]) => writeFileSync(join(mat, 'fr.json'), JSON.stringify({ langue: 'fr', ecriture: 'latin', origine: 'essai', aRelire: false, applis: { carnet_t: { noter: ['garde une note'] }, lyre_t: { jouer: phrases } }, horsChamp: [] }));
    fichier(['joue un air']);
    const a = creerAiguilleurPret({ matiere: mat, reglages: ESSAI, modules: MODULES, home });
    const q = 'zorglub bidulophone';
    assert.deepEqual(a.aiguiller(q), creerAiguilleurSync({ matiere: mat, reglages: ESSAI, modules: MODULES }).aiguiller(q));
    fichier(['joue un air', 'zorglub bidulophone']);
    attendre(VERIFICATION_MS + 50);
    const apres = a.aiguiller(q);
    assert.deepEqual(apres, creerAiguilleurSync({ matiere: mat, reglages: ESSAI, modules: MODULES }).aiguiller(q), 'la nouvelle matière est prise');
    assert.equal(apres.choix[0]?.appli, 'lyre_t');
    assert.equal(preparationsGardees().nombre, 1, 'la préparation de l\'ancienne matière est oubliée');
    // Une correction apprise : la préparation du disque (faite sans elle) est effacée aussitôt.
    assert.ok(existsSync(fichierPreparation(home)));
    assert.equal(a.apprendre({ demande: 'quxwyvz plimtrok', appli: 'rempart_t', action: 'bloquer', provenance: 'proprietaire' }).ok, true);
    assert.equal(existsSync(fichierPreparation(home)), false);
    assert.equal(a.aiguiller('quxwyvz plimtrok').choix[0]?.appli, 'rempart_t');
    // Un nouveau démarrage la garde avec la correction…
    oublierPreparations();
    const b = creerAiguilleurPret({ matiere: mat, reglages: ESSAI, modules: MODULES, home });
    assert.equal(b.aiguiller('quxwyvz plimtrok').choix[0]?.appli, 'rempart_t');
    assert.ok(readFileSync(fichierPreparation(home)).toString('utf16le').includes('plim'), 'la correction est dans la préparation');
    // … puis le propriétaire la retire du fichier : à la demande suivante, elle n'est plus nulle part.
    const j = JSON.parse(readFileSync(fichierCorrections(home), 'utf8'));
    j.corrections = []; writeFileSync(fichierCorrections(home), JSON.stringify(j));
    attendre(VERIFICATION_MS + 50);
    assert.deepEqual(b.aiguiller('quxwyvz plimtrok'), creerAiguilleurSync({ matiere: mat, reglages: ESSAI, modules: MODULES, home }).aiguiller('quxwyvz plimtrok'));
    assert.equal(b.bilan.corrections, 0);
    assert.equal(preparationsGardees().nombre, 1, 'seule la préparation sans la correction est gardée en mémoire');
    assert.equal(readFileSync(fichierPreparation(home)).toString('utf16le').includes('plim'), false, 'ni sur le disque');
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(mat, { recursive: true, force: true }); oublierPreparations(); }
});

test('mémoire bornée par le comptable : au-delà, les plus anciennes sont oubliées ; sous pression, tout est rendu ; sans rien de gardé, mêmes réponses', () => {
  oublierPreparations();
  const variantes = [4, 3, 5].map((nMax) => ({ ...ESSAI, nMax }));
  const attendus = variantes.map((r) => repondre(creerAiguilleurSync({ matiere: false, reglages: r, modules: MODULES })));
  // Place de chaque préparation, mesurée par un premier passage sans limite.
  const tailles: number[] = [];
  avecEnv({}, () => { for (const r of variantes) { oublierPreparations(); creerAiguilleurPret({ matiere: false, reglages: r, modules: MODULES, disque: false }); tailles.push(preparationsGardees().mo); } });
  assert.ok(tailles.every((x) => x > 0), JSON.stringify(tailles));
  oublierPreparations();
  // Le budget (libre − marge, moitié) laisse tenir la plus grosse, jamais deux : on en remplit trois.
  const libre = String(2 * Math.max(...tailles) + 1);
  assert.ok(Math.floor(Number(libre) / 2) < Math.min(...tailles) + Math.max(...tailles), `budget pour ${tailles.join(', ')} Mo`);
  avecEnv({ ODIN_MEMOIRE_LIBRE_MO: libre, ODIN_MEMOIRE_MARGE_MO: '0' }, () => {
    variantes.forEach((r, i) => {
      const a = creerAiguilleurPret({ matiere: false, reglages: r, modules: MODULES, disque: false });
      assert.deepEqual(repondre(a), attendus[i]);
      const g = preparationsGardees();
      assert.ok(g.nombre <= 1, `au plus une gardée (${g.nombre})`);
      assert.ok(g.mo <= Math.floor(Number(libre) / 2), `${g.mo} Mo gardés pour un budget de ${Math.floor(Number(libre) / 2)}`);
    });
    // La première (la plus ancienne) a été oubliée pour faire place : elle est recalculée.
    assert.equal(creerAiguilleurPret({ matiere: false, reglages: variantes[0], modules: MODULES, disque: false }).bilan.preparationDe, 'calcul');
    assert.equal(preparationsGardees().nombre, 1);
    // Sous pression (mémoire libre sous la marge) : tout ce qui est gardé est rendu.
    process.env.ODIN_MEMOIRE_MARGE_MO = String(Number(libre) + 1);
    assert.equal(budgetLibreMo(), 0);
    assert.deepEqual(preparationsGardees(), { nombre: 0, mo: 0 });
    // Et sans rien de gardé (aucune place), les réponses restent justes.
    const a = creerAiguilleurPret({ matiere: false, reglages: variantes[0], modules: MODULES, disque: false });
    assert.equal(preparationsGardees().nombre, 0);
    assert.deepEqual(repondre(a), attendus[0]);
  });
  const b = creerAiguilleurPret({ matiere: false, reglages: variantes[1], modules: MODULES, memoire: false, disque: false });
  assert.equal(b.bilan.preparationDe, 'calcul');
  assert.deepEqual(repondre(b), attendus[1]);
  oublierPreparations();
});

// ---------------------------------------------------------------------------------------- relecture de la part C
const SECRET = 'quxwyvz plimtrok';
const contientSecret = (f: string) => existsSync(f) && readFileSync(f).toString('utf16le').includes('plim');
const viderCorrections = (home: string) => { const j = JSON.parse(readFileSync(fichierCorrections(home), 'utf8')); j.corrections = []; writeFileSync(fichierCorrections(home), JSON.stringify(j)); };
const P = await import('../src/brain/nous/aiguilleur-pret.ts') as Record<string, unknown>;

test('relecture 1 : une correction retirée à la main n\'est plus servie, même juste après une vérification', () => {
  const home = dossier();
  try {
    oublierPreparations();
    const a = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(a.apprendre({ demande: SECRET, appli: 'rempart_t', action: 'bloquer', provenance: 'proprietaire' }).ok, true);
    attendre(VERIFICATION_MS + 50); a.aiguiller('météo'); // une vérification vient d'avoir lieu
    viderCorrections(home);
    const servi = a.aiguiller(SECRET);
    assert.deepEqual(servi, creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home }).aiguiller(SECRET), 'la demande suivante ne connaît plus la correction');
    assert.equal(a.bilan.corrections, 0);
    assert.equal(contientSecret(fichierPreparation(home)), false, 'ni le disque');
  } finally { rmSync(home, { recursive: true, force: true }); oublierPreparations(); }
});

test('relecture 1 : oublierCorrection retire la correction du fichier, de la mémoire et du disque sur-le-champ', () => {
  const home = dossier();
  try {
    oublierPreparations();
    const oublierCorrection = P.oublierCorrection as (home: string, demande: string) => { ok: boolean; retiree?: boolean };
    assert.equal(typeof oublierCorrection, 'function', 'une fonction « oublier » que l\'oubli peut appeler');
    const a = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(a.apprendre({ demande: SECRET, appli: 'rempart_t', action: 'bloquer', provenance: 'proprietaire' }).ok, true);
    oublierPreparations();
    const b = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(b.aiguiller(SECRET).choix[0]?.appli, 'rempart_t');
    assert.ok(contientSecret(fichierPreparation(home)));
    // Sans attendre et sans aucune demande : tout est oublié.
    assert.deepEqual(oublierCorrection(home, 'QUXWYVZ, plimtrok !'), { ok: true, retiree: true });
    assert.equal(readFileSync(fichierCorrections(home), 'utf8').includes('plim'), false, 'le fichier des corrections');
    assert.equal(contientSecret(fichierPreparation(home)), false, 'la préparation du disque');
    assert.deepEqual(preparationsGardees(), { nombre: 0, mo: 0 }, 'les cœurs gardés en mémoire');
    const attendu = creerAiguilleurSync({ matiere: false, reglages: ESSAI, modules: MODULES, home }).aiguiller(SECRET);
    assert.deepEqual(a.aiguiller(SECRET), attendu, 'les aiguilleurs vivants');
    assert.deepEqual(b.aiguiller(SECRET), attendu);
    assert.equal(b.bilan.corrections, 0);
    assert.deepEqual(oublierCorrection(home, SECRET), { ok: true, retiree: false }, 'déjà oubliée');
  } finally { rmSync(home, { recursive: true, force: true }); oublierPreparations(); }
});

test('relecture 1 : correction retirée à la main sans aucune demande : la préparation du disque est effacée dans la seconde', async () => {
  const home = dossier();
  try {
    oublierPreparations();
    const a = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(a.apprendre({ demande: SECRET, appli: 'rempart_t', action: 'bloquer', provenance: 'proprietaire' }).ok, true);
    oublierPreparations();
    const b = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.ok(contientSecret(fichierPreparation(home)));
    viderCorrections(home);
    await new Promise((r) => setTimeout(r, 2 * VERIFICATION_MS + 200));
    assert.equal(contientSecret(fichierPreparation(home)), false, 'plus sur le disque');
    assert.equal(preparationsGardees().nombre, 0, 'plus en mémoire');
    assert.equal(b.bilan.corrections, 0);
  } finally { rmSync(home, { recursive: true, force: true }); oublierPreparations(); }
});

test('relecture 2 : une préparation périmée qu\'on ne peut pas réécrire est quand même effacée', () => {
  const home = dossier();
  try {
    oublierPreparations();
    const a = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home });
    assert.equal(a.apprendre({ demande: SECRET, appli: 'rempart_t', action: 'bloquer', provenance: 'proprietaire' }).ok, true);
    oublierPreparations();
    creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home, surveiller: false });
    const f = fichierPreparation(home);
    assert.ok(contientSecret(f));
    chmodSync(f, 0o444);
    viderCorrections(home);
    oublierPreparations();
    const c = creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: MODULES, home, surveiller: false });
    assert.equal(c.bilan.preparationDe, 'calcul');
    assert.equal(contientSecret(f), false, 'le texte retiré n\'est plus sur le disque');
  } finally { try { chmodSync(fichierPreparation(home), 0o666); } catch { /* absente */ } rmSync(home, { recursive: true, force: true }); oublierPreparations(); }
});

test('relecture 3 : deux cœurs gardés au plus, quel que soit le budget', () => {
  oublierPreparations();
  const cal = { poids: [], seuilSeul: 1, seuilTrois: 1 } as never;
  for (let i = 0; i < 6; i++) {
    creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: [...MODULES, { id: `m${i}`, name: `M${i}`, words: [`mot${i}`], actions: [] }], disque: false, calibration: cal });
    assert.ok(preparationsGardees().nombre <= 2, `${preparationsGardees().nombre} cœurs gardés`);
  }
  assert.equal(preparationsGardees().nombre, 2);
  // Les deux plus récents sont gardés : le dernier repart de la mémoire.
  assert.equal(creerAiguilleurPret({ matiere: false, reglages: ESSAI, modules: [...MODULES, { id: 'm5', name: 'M5', words: ['mot5'], actions: [] }], disque: false, calibration: cal }).bilan.preparationDe, 'memoire');
  oublierPreparations();
});

test('jeu de travail du banc, applis du produit : le vote rapide et l\'aiguilleur prêt rendent exactement les réponses de l\'ancien chemin', async () => {
  const home = dossier();
  process.env.ODIN_ESSAI = '1'; process.env.ODIN_NO_VOICE_INSTALL = '1';
  try {
    const { allModules } = await import('../src/valhalla/odin.ts');
    const { USAGES } = await import('../src/valhalla/links.ts');
    const { SURVOL } = await import('../src/valhalla/survol.ts');
    const { contexteDe } = await import('./soul-banc/mesure.ts');
    const mods = allModules({ paths: { home, workspace: home }, cfg: { venus: {}, voice: {} } } as never);
    const jeu = JSON.parse(readFileSync(new URL('./soul-banc/jeux/developpement.json', import.meta.url), 'utf8')) as { demandes: Array<{ phrase: string; contexte?: unknown }> };
    const o = { modules: mods, usages: USAGES, survol: SURVOL, reglages: { poidsMots: 0 } };
    const tout = (a: { aiguiller: (p: string, c?: ContexteAiguilleur) => unknown }) => jeu.demandes.map((d) => a.aiguiller(d.phrase, contexteDe(d.contexte) as ContexteAiguilleur));
    oublierCalibrations(); oublierPreparations();
    cheminDeReference(true);
    let ref: unknown[], cal: unknown;
    try { const a = creerAiguilleurSync(o); ref = tout(a); cal = a.bilan.calibration; } finally { cheminDeReference(false); }
    oublierCalibrations();
    const b = creerAiguilleurPret({ ...o, home });
    assert.equal(b.bilan.preparationDe, 'calcul');
    const { ms: _1, ...c1 } = cal as { ms: number }, { ms: _2, ...c2 } = b.bilan.calibration;
    assert.deepEqual(c2, c1);
    assert.deepEqual(tout(b), ref);
    oublierPreparations(); oublierCalibrations();
    const c = creerAiguilleurPret({ ...o, home });
    assert.equal(c.bilan.preparationDe, 'fichier'); assert.equal(c.bilan.calibrationDe, 'fichier');
    assert.deepEqual(tout(c), ref);
  } finally { rmSync(home, { recursive: true, force: true }); oublierPreparations(); }
});
