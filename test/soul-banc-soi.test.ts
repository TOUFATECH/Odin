// Banc « connaissance de soi » (test/soul-banc/soi.ts) : les fonctions pures prouvées sur de petits cas calculés à la
// main, puis les deux jeux contrôlés (forme, tailles, familles, langues, aucune question commune, aucune fuite vers la
// matière d'apprentissage ni vers les autres jeux) et joués contre les fiches de leur Odin préparé (chaque fiche attendue
// existe ; chaque question d'état trouve sa valeur dans sa fiche).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clesPropres, comptesSoi, defautsJeuSoi, fichesAcceptees, fichesNommees, jetons, jugerSoi, jugerTexte, methodeMots, plat, rapportSoi, releveSoi, type JeuSoi, type QuestionSoi } from './soul-banc/soi.ts';
import type { Fiche } from '../src/brain/nous/connaissance-de-soi.ts';
import { dossierJetable, environnementBanc, modulesDuProduit } from './soul-banc/catalogue.ts';

const q = (o: Partial<QuestionSoi> & { id: string }): QuestionSoi => ({ langue: 'fr', ecriture: 'Latn', question: o.id, famille: 'interface', sorte: 'directe', attendus: ['a'], aRelire: false, ...o });
const fiche = (id: string, texte: string, cles: string[] = [], famille: Fiche['famille'] = 'interface'): Fiche => ({ id, famille, sujet: id, texte, source: 'essai', cles });
const lire = (n: string) => JSON.parse(readFileSync(new URL(`./soul-banc/jeux/${n}.json`, import.meta.url), 'utf8')) as JeuSoi;

test('Juger une question : premier rang, trois premiers, rang réciproque, fausse réponse, fiche à jour', () => {
  const d = q({ id: 'x', attendus: ['b'] });
  const j1 = jugerSoi(d, { ids: ['b', 'a'] }); assert.ok(j1.rang1 && j1.top3 && j1.entiere); assert.equal(j1.rr, 1);
  const j3 = jugerSoi(d, { ids: ['a', 'c', 'b'] }); assert.ok(!j3.rang1 && j3.top3 && !j3.entiere); assert.equal(j3.rr, 1 / 3);
  const j4 = jugerSoi(d, { ids: ['a', 'c', 'd', 'b'] }); assert.ok(!j4.top3); assert.equal(j4.rr, 1 / 4);
  const vide = jugerSoi(d, { ids: [] }); assert.ok(!vide.rang1 && !vide.fausse && !vide.entiere);
  const sans = q({ id: 's', famille: 'aucune', sorte: 'sans-reponse', attendus: [] });
  assert.ok(jugerSoi(sans, { ids: [] }).entiere);
  const f = jugerSoi(sans, { ids: ['a'] }); assert.ok(f.fausse && !f.entiere);
  const parId = new Map([['b', fiche('b', 'Sauvegarde activée, chaque nuit à 2 h.')]]);
  const et = q({ id: 'e', sorte: 'etat', attendus: ['b'], valeur: 'à 2 h' });
  assert.equal(jugerSoi(et, { ids: ['b'] }, parId).aJour, true);
  const faux = jugerSoi(q({ id: 'e2', sorte: 'etat', attendus: ['b'], valeur: 'à 3 h' }), { ids: ['b'] }, parId);
  assert.equal(faux.aJour, false); assert.ok(faux.rang1 && !faux.entiere, 'une fiche fausse casse la question même au bon rang');
  assert.equal(jugerSoi(d, { ids: ['b'] }, parId).aJour, null);
});

test('Version 2 : le produit jugé sur son texte (la valeur ou le lieu), plusieurs fiches justes, clés propres', () => {
  const fs = [
    { ...fiche('onglet', 'Dans Réglages, l\'onglet « Sauvegarde ».', ['Sauvegarde']), reponse: ['Réglages', 'Sauvegarde'] },
    { ...fiche('infra', 'Sauvegarde chiffrée chaque nuit à 4 h. Elle se règle dans Réglages → Sauvegarde.', ['sauvegarde chiffrée'], 'infrastructure'), reponse: ['Réglages', 'Sauvegarde'] },
    { ...fiche('heure', '« Heure » se règle dans Réglages → Sauvegarde.', ['Heure']), reponse: ['Sauvegarde', 'Heure'] },
    { ...fiche('langue', '« Langue » se règle dans Réglages → Voix.', ['Langue']), reponse: ['Voix', 'Langue'] },
    { ...fiche('cam', 'L\'appareil « Caméra du garage », adresse 198.51.100.22, est déconnecté.', ['Caméra du garage', '198.51.100.22'], 'infrastructure'), reponse: ['198.51.100.22'] },
    fiche('autre', 'Autre chose.', ['Réglages']),
  ];
  const parId = new Map(fs.map((f) => [f.id, f]));
  // M1 : une autre fiche qui dit la même réponse est juste aussi.
  const ou = q({ id: 'o', attendus: ['onglet'] });
  assert.deepEqual([...fichesAcceptees(ou, parId)].sort(), ['heure', 'infra', 'onglet']);
  assert.ok(jugerSoi(ou, { ids: ['infra'] }, parId).rang1, 'la fiche de l\'infrastructure dit le même lieu');
  // G3 : le texte rendu est jugé sur le lieu, pas sur un mot qui « nomme » une fiche.
  assert.ok(jugerTexte(ou, 'C\'est dans Réglages, onglet Sauvegarde.', fs, parId));
  assert.ok(!jugerTexte(ou, 'La sauvegarde est importante.', fs, parId));
  assert.equal(jugerSoi(ou, { ids: [], texte: 'Réglages → Sauvegarde.' }, parId, fs).entiere, true, 'le produit : jugé sur le texte même sans fiche nommée');
  // G3 b : « Langue » ne nomme plus une fiche par hasard ; une question sans réponse n'est plus ratée pour ce mot.
  const sans = q({ id: 's', famille: 'aucune', sorte: 'sans-reponse', attendus: [] });
  assert.ok(!clesPropres(fs).has('Langue') && clesPropres(fs).has('Caméra du garage') && clesPropres(fs).has('198.51.100.22'));
  assert.ok(jugerTexte(sans, 'Je n\'ai pas compris : langue que je ne comprends pas.', fs, parId));
  assert.ok(!jugerTexte(sans, 'La Caméra du garage est déconnectée.', fs, parId));
  // G3 d : une question d'état exige la valeur ; une valeur vague exige aussi le sujet.
  const et = q({ id: 'e', famille: 'infrastructure', sorte: 'etat', attendus: ['cam'], valeur: 'déconnecté' });
  assert.ok(jugerTexte(et, 'La Caméra du garage est déconnecté.', fs, parId));
  assert.ok(!jugerTexte(et, 'Un appareil est déconnecté.', fs, parId), 'valeur vague sans le sujet');
  assert.ok(!jugerTexte(et, 'La Caméra du garage est en ligne.', fs, parId), 'mauvaise valeur');
  const r = rapportSoi([{ question: ou, reponse: { ids: [], texte: 'Réglages → Sauvegarde' }, ms: 1 }, { question: sans, reponse: { ids: [], texte: 'Je ne sais pas.' }, ms: 1 }], parId, fs);
  assert.deepEqual([r.global.entieresAvec.k, r.global.entieresAvec.n, r.global.entieresSans.k, r.global.entieresSans.n], [1, 1, 1, 1], 'publiés séparément');
});

test('Relevés, rapport, intervalles', () => {
  const qs = [q({ id: '1', attendus: ['a'] }), q({ id: '2', attendus: ['b'], langue: 'en', famille: 'modele' }), q({ id: '3', famille: 'aucune', sorte: 'sans-reponse', attendus: [] }), q({ id: '4', attendus: ['c'] })];
  const rs = [{ ids: ['a'] }, { ids: ['x', 'b'] }, { ids: ['a'] }, { ids: [] }];
  const js = qs.map((x, i) => ({ question: x, j: jugerSoi(x, rs[i]), ms: i }));
  const r = releveSoi(js);
  assert.deepEqual([r.rang1.k, r.rang1.n, r.top3.k, r.fausses.k, r.fausses.n, r.entieres.k, r.entieres.n], [1, 3, 2, 1, 1, 1, 4]);
  assert.ok(Math.abs(r.mrr - (1 + 0.5) / 3) < 1e-12);
  assert.ok(Math.abs(r.rang1.bas - 0.0615) < 1e-3 && Math.abs(r.rang1.haut - 0.7923) < 1e-3, `Wilson 1/3 : ${r.rang1.bas} ; ${r.rang1.haut}`);
  const rap = rapportSoi(qs.map((x, i) => ({ question: x, reponse: rs[i], ms: i + 1 })));
  assert.deepEqual(Object.keys(rap.parFamille), ['aucune', 'interface', 'modele']);
  assert.deepEqual(Object.keys(rap.parLangue), ['en', 'fr']);
  assert.equal(rap.temps.mediane, 2); assert.equal(rap.temps.max, 4);
  assert.equal(rap.francais.n, 3); assert.equal(rap.autres.n, 1);
});

test('Lire les fiches nommées dans un texte ; jetons ; recherche par mots', () => {
  const fs = [fiche('p', 'La page Réglages.', ['Réglages']), fiche('o', 'L\'onglet Sauvegarde des réglages.', ['Sauvegarde']), fiche('r', 'Garder les dernières.', ['Garder les … dernières']), fiche('court', 'x', ['ab'])];
  assert.deepEqual(fichesNommees('Va dans Réglages puis Sauvegarde.', fs), ['o', 'p'], 'la clé la plus longue d\'abord');
  assert.deepEqual(fichesNommees('Les sauvegardes', fs), [], 'mot entier seulement');
  assert.deepEqual(fichesNommees('ab ab', fs), [], 'une clé de moins de 4 caractères ne compte pas');
  assert.deepEqual(jetons('Où est la Sauvegarde ?'), ['ou', 'est', 'la', 'sauve']);
  assert.deepEqual(jetons('設定画面'), ['設定', '定画', '画面', '面']);
  const m = methodeMots([fiche('a', 'Sauvegarde chiffrée chaque nuit'), fiche('b', 'Le port de l\'interface est 8888'), fiche('c', 'Le thème de couleur')], { seuil: 0.1 });
  assert.equal((m.repondre('à quelle heure la sauvegarde ?') as { ids: string[] }).ids[0], 'a');
  assert.deepEqual((m.repondre('zzz qqq') as { ids: string[] }).ids, [], 'aucun mot commun : je ne sais pas');
  assert.equal(plat('Déconnecté  É'), 'deconnecte e');
});

test('Contrôle de forme d\'un jeu', () => {
  assert.deepEqual(defautsJeuSoi({}), ['le jeu n\'a pas de liste « questions »']);
  const base = { version: 1, origine: 'essai', maintenant: '2026-11-17T10:00:00', preparation: {} };
  const fs = new Map([['a', fiche('a', 'x')], ['m', fiche('m', 'y', [], 'modele')]]);
  assert.deepEqual(defautsJeuSoi({ ...base, questions: [q({ id: '1' }), q({ id: '2', famille: 'aucune', sorte: 'sans-reponse', attendus: [] })] }, fs), []);
  const d = defautsJeuSoi({ ...base, questions: [q({ id: '1' }), q({ id: '1', question: 'autre' }), q({ id: '3', question: '1' }), q({ id: '4', famille: 'aucune', sorte: 'sans-reponse' }), q({ id: '5', sorte: 'etat' }), q({ id: '6', attendus: ['zz'] }), q({ id: '7', attendus: ['m'] }), q({ id: '8', attendus: [] }), q({ id: '9', famille: 'autre' as never })] }, fs);
  const a = (re: RegExp) => assert.ok(d.some((x) => re.test(x)), `défaut attendu : ${re} dans ${JSON.stringify(d)}`);
  a(/id en double/); a(/question en double/); a(/sans réponse, mais des fiches/); a(/question d'état sans valeur/); a(/fiche inconnue « zz »/); a(/première fiche « m » de la famille modele/); a(/aucune fiche attendue/); a(/famille inconnue/);
});

test('Les deux jeux : tailles, familles, langues, origine honnête, aucune question commune ni fuite', async () => {
  const dev = lire('soi-developpement'), pri = lire('soi-principal');
  assert.equal(pri.fige, true); assert.notEqual(dev.fige, true);
  assert.ok(dev.questions.length >= 200, `développement : ${dev.questions.length}`); assert.ok(pri.questions.length >= 300, `principal : ${pri.questions.length}`);
  for (const j of [dev, pri]) {
    assert.deepEqual(defautsJeuSoi(j), []);
    assert.match(j.origine, /agent/); assert.match(j.origine, /non relu/);
    const c = comptesSoi(j) as { parFamille: Record<string, number>; parSorte: Record<string, number>; francais: number; questions: number; langues: number };
    for (const f of ['infrastructure', 'interface', 'modele', 'acquisition', 'aucune']) assert.ok((c.parFamille[f] ?? 0) >= 10, `famille ${f} : ${c.parFamille[f]}`);
    for (const s of ['directe', 'etat', 'sans-reponse']) assert.ok((c.parSorte[s] ?? 0) >= 20, `sorte ${s} : ${c.parSorte[s]}`);
    assert.ok(c.francais / c.questions >= 0.4 && c.francais / c.questions <= 0.6, `part du français ${c.francais}/${c.questions}`);
    assert.ok(c.langues >= 9, `au moins huit langues en plus du français : ${c.langues}`);
    for (const x of j.questions) assert.equal(x.aRelire, !['fr', 'en'].includes(x.langue), `${x.id} : aRelire`);
    // Rien de privé : adresses de documentation seulement.
    const texte = JSON.stringify(j);
    for (const ip of texte.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? []) assert.ok(ip.startsWith('198.51.100.'), `adresse ${ip}`);
    for (const h of texte.match(/https?:\/\/[^/"]+/g) ?? []) assert.match(h, /example\.(org|net|com)|\/\/198\.51\.100\.\d+/, `adresse ${h}`);
  }
  const p = new Set(pri.questions.map((x) => plat(x.question)));
  assert.deepEqual(dev.questions.filter((x) => p.has(plat(x.question))).map((x) => x.id), [], 'aucune question commune');
  // Aucune fuite : ni vers la matière d'apprentissage, ni vers un autre jeu du banc.
  const { home, fin } = dossierJetable('odin-soi-fuites-');
  environnementBanc(home);
  try {
    const F = await import('./soul-banc/fuites.ts');
    const { textesDesJeux } = await import('./soul-banc/logique.ts');
    const { sources } = await F.sourcesApprentissage(await modulesDuProduit(home));
    const index = new F.Index([...sources, ...(await textesDesJeux(['soi-developpement', 'soi-principal']))]);
    const t = (j: JeuSoi) => j.questions.map((x) => ({ id: x.id, phrase: x.question })) as never;
    for (const j of [dev, pri]) {
      assert.deepEqual(F.fuitesContre(t(j), index, 0.8).map((f) => f.id), [], 'fuite vers l\'apprentissage ou un autre jeu');
      assert.deepEqual(F.doublonsInternes(t(j), 0.8).map((f) => f.id), [], 'doublons internes');
    }
    assert.deepEqual(F.fuitesContre(t(dev), new F.Index(pri.questions.map((x) => ({ texte: x.question, source: x.id }))), 0.8).map((f) => f.id), [], 'développement contre principal');
  } finally { fin(); }
});

test('Joués contre leur Odin préparé : chaque fiche attendue existe, chaque question d\'état trouve sa valeur', async () => {
  const { home, fin } = dossierJetable('odin-soi-jeux-');
  environnementBanc(home);
  try {
    const { preparerOdin } = await import('./soul-banc/soi.ts');
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const n of ['soi-developpement', 'soi-principal']) {
      const j = lire(n);
      const sous = mkdtempSync(join(home, 'j-'));
      process.env.ODIN_HOME = sous;
      const o = await preparerOdin(sous, j.preparation, new Date(j.maintenant).getTime());
      try {
        const parId = new Map(o.fiches.map((f) => [f.id, f]));
        assert.deepEqual(defautsJeuSoi(j, parId), [], n);
        for (const x of j.questions.filter((y) => y.sorte === 'etat')) assert.equal(jugerSoi(x, { ids: x.attendus }, parId).aJour, true, `${n} ${x.id} : « ${x.valeur} » absent de ${x.attendus[0]}`);
        // Version 2 (G3 c) : aucune question impossible pour le produit — la réponse de la fiche, dite telle quelle, est juste.
        const impossibles = j.questions.filter((x) => x.attendus.length && !x.attendus.some((id) => { const f = parId.get(id)!; return jugerTexte(x, `${f.texte} ${(f.reponse ?? []).join(' ')} ${f.cles.join(' ')}`, o.fiches, parId); }));
        assert.deepEqual(impossibles.map((x) => x.id), [], `${n} : questions impossibles`);
        assert.equal(j.version, 2);
        assert.ok(parId.has('interface:onglet:ports'), 'fiche de l\'onglet Ports');
        // M10 : l'inventaire et la surveillance comptent les mêmes appareils importants.
        const nb = (id: string, re: RegExp) => Number(re.exec(parId.get(id)!.texte)?.[1] ?? 0);
        assert.equal(nb('infra:inventaire', /(\d+) important/), nb('infra:surveillance', /(\d+) appareil\(s\) marqué/), `${n} : inventaire et surveillance`);
        // Deux préparations identiques : les mêmes fiches (la mesure ne bouge pas d'un lancement à l'autre).
        const sous2 = mkdtempSync(join(home, 'k-'));
        process.env.ODIN_HOME = sous2;
        const o2 = await preparerOdin(sous2, j.preparation, new Date(j.maintenant).getTime());
        try { assert.deepEqual(o2.fiches.map((f) => [f.id, f.texte]), o.fiches.map((f) => [f.id, f.texte])); } finally { o2.fin(); }
      } finally { o.fin(); }
    }
  } finally { fin(); }
});
