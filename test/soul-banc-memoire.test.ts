// Banc de mémoire (test/soul-banc/memoire.ts) : les fonctions pures prouvées sur de petits cas calculés à la main, la
// mémoire du produit essayée sur trois souvenirs (rangement daté, remplacement par sujet et clé, oubli), puis les deux
// jeux contrôlés (forme, tailles, langues, aucune fuite vers la matière d'apprentissage ni les autres jeux).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { aLHeure, comptesM, defautsJeuM, jugerM, rapportM, releveM, ressemblance, type JeuM, type QuestionM, type Souvenir } from './soul-banc/memoire.ts';
import { normerTexte } from './soul-banc/comprehension.ts';
import { dossierJetable, environnementBanc, modulesDuProduit } from './soul-banc/catalogue.ts';

const q = (o: Partial<QuestionM> & { id: string }): QuestionM => ({ langue: 'fr', ecriture: 'Latn', question: o.id, sorte: 'reformulee', attendus: [], interdits: [], aRelire: false, ...o });
const s = (id: string, texte: string, o: Partial<Souvenir> = {}): Souvenir => ({ id, texte, sorte: 'fait', date: '2026-01-01T09:00:00', langue: 'fr', ...o });

test('Juger une question avec réponse : premier rang, cinq premiers, rang réciproque', () => {
  const d = q({ id: 'a', attendus: ['s2'] });
  const j1 = jugerM(d, { ids: ['s2', 's1'] });
  assert.ok(j1.rang1 && j1.top5 && j1.entiere); assert.equal(j1.rr, 1);
  const j3 = jugerM(d, { ids: ['s1', 's3', 's2'] });
  assert.ok(!j3.rang1 && j3.top5 && !j3.entiere); assert.equal(j3.rr, 1 / 3);
  const j6 = jugerM(d, { ids: ['a', 'b', 'c', 'd', 'e', 's2'] });
  assert.ok(!j6.top5); assert.equal(j6.rr, 1 / 6);
  const rien = jugerM(d, { ids: [] });
  assert.ok(!rien.rang1 && !rien.top5 && !rien.fausse); assert.equal(rien.rr, 0);
});

test('Sans réponse, plus récent, oubli', () => {
  const sans = q({ id: 's', sorte: 'sans-reponse' });
  assert.ok(jugerM(sans, { ids: [] }).entiere);
  const f = jugerM(sans, { ids: ['s1'] }); assert.ok(f.fausse && !f.entiere);
  const rec = q({ id: 'p', sorte: 'plus-recent', attendus: ['neuf'], interdits: ['vieux'] });
  assert.equal(jugerM(rec, { ids: ['neuf', 'vieux'] }).recent, true);
  assert.equal(jugerM(rec, { ids: ['vieux', 'neuf'] }).recent, false, 'l\'ancien au-dessus du nouveau');
  assert.equal(jugerM(rec, { ids: ['autre', 'neuf'] }).recent, true, 'l\'ancien absent : le plus récent gagne même au 2e rang');
  assert.equal(jugerM(rec, { ids: ['vieux'] }).recent, false);
  assert.equal(jugerM(q({ id: 'x', attendus: ['a'] }), { ids: ['a'] }).recent, null);
  const oubliees = new Set(['o1']);
  const ob = q({ id: 'o', sorte: 'oubli', interdits: ['o1'] });
  assert.equal(jugerM(ob, { ids: [] }, oubliees).oubli, true); assert.ok(jugerM(ob, { ids: [] }, oubliees).entiere);
  const sort = jugerM(ob, { ids: ['o1'] }, oubliees); assert.equal(sort.oubli, false); assert.ok(!sort.entiere);
  const autre = jugerM(ob, { ids: ['z'] }, oubliees); assert.equal(autre.oubli, true); assert.ok(autre.fausse && !autre.entiere, 'rien ne reste : rendre autre chose est une fausse réponse');
  const avecReste = jugerM(q({ id: 'o2', sorte: 'oubli', attendus: ['n'], interdits: ['o1'] }), { ids: ['n', 'o1'] }, oubliees);
  assert.ok(avecReste.rang1 && !avecReste.entiere, 'un oublié rendu, même plus bas, casse la question');
});

test('Relevés et rapport : comptes et intervalles', () => {
  const qs = [
    q({ id: '1', attendus: ['a'] }), q({ id: '2', attendus: ['b'], langue: 'en' }), q({ id: '3', sorte: 'sans-reponse' }),
    q({ id: '4', sorte: 'plus-recent', attendus: ['n'], interdits: ['v'] }),
  ];
  const rs = [{ ids: ['a'] }, { ids: ['x', 'b'] }, { ids: ['a'] }, { ids: ['v', 'n'] }];
  const js = qs.map((x, i) => ({ question: x, j: jugerM(x, rs[i]) }));
  const r = releveM(js);
  assert.deepEqual([r.rang1.k, r.rang1.n, r.top5.k], [1, 3, 3]);
  assert.ok(Math.abs(r.mrr - (1 + 0.5 + 0.5) / 3) < 1e-12);
  assert.deepEqual([r.fausses.k, r.fausses.n], [1, 1]);
  assert.deepEqual([r.recent.k, r.recent.n], [0, 1]);
  assert.deepEqual([r.entieres.k, r.entieres.n], [1, 4]);
  assert.ok(Math.abs(r.rang1.bas - 0.0615) < 1e-3 && Math.abs(r.rang1.haut - 0.7923) < 1e-3, `Wilson 1/3 : ${r.rang1.bas} ; ${r.rang1.haut}`);
  const rap = rapportM(qs.map((x, i) => ({ question: x, reponse: rs[i], ms: 1 })), { souvenirs: [s('a', 'x'), s('b', 'y', { langue: 'fr' }), s('n', 'z'), s('v', 'w')], oublis: [] });
  assert.deepEqual(Object.keys(rap.parLangue), ['en', 'fr']);
  assert.deepEqual(Object.keys(rap.parLangueDuSouvenir).sort(), ['autre langue', 'même langue', 'sans souvenir attendu']);
  assert.equal(rap.rendus.mediane, 1);
});

// ------------------------------------------------------------------------------------------------ version 2 (relecture du 17/11)
test('Le titre : les questions avec réponse (hors « oubli ») ; « sans réponse » et « oubli » à part ; base « toujours rien » (G2, M6, P7)', () => {
  const qs = [
    q({ id: '1', attendus: ['a'] }), q({ id: '2', sorte: 'sans-reponse' }), q({ id: '3', sorte: 'oubli', interdits: ['o'] }),
    q({ id: '4', sorte: 'plus-recent', attendus: ['n1'], interdits: ['v1'] }), q({ id: '5', sorte: 'plus-recent', attendus: ['n2'], interdits: ['v2'] }),
  ];
  const sv = [s('a', 'x'), s('o', 'y'), s('v1', 'z', { sujet: 'k', cle: 'c' }), s('n1', 'w', { sujet: 'k', cle: 'c' }), s('v2', 'u'), s('n2', 't')];
  const rs = [{ ids: ['a'] }, { ids: ['a'] }, { ids: [] }, { ids: ['n1'] }, { ids: ['v2', 'n2'] }];
  const r = rapportM(qs.map((x, i) => ({ question: x, reponse: rs[i], ms: 1 })), { souvenirs: sv, oublis: ['o'] });
  assert.deepEqual([r.titre.k, r.titre.n], [2, 3], 'questions avec réponse, sans « oubli »');
  assert.deepEqual([r.sansReponse.k, r.sansReponse.n], [0, 1], '« sans réponse » seulement (P7)');
  assert.deepEqual([r.oubli.k, r.oubli.n], [1, 1]);
  const autre = rapportM([{ question: qs[2], reponse: { ids: ['a'] }, ms: 1 }], { souvenirs: sv, oublis: ['o'] });
  assert.deepEqual([autre.oubli.k, autre.oubli.n], [1, 1], '« oubli » : l\'oublié ne ressort pas, même si autre chose ressort');
  assert.deepEqual(Object.keys(r.parSorteDetail).filter((k) => k.startsWith('plus-recent')).sort(), ['plus-recent (classement seul)', 'plus-recent (remplacé par le produit)']);
  assert.equal(r.parSorteDetail['plus-recent (remplacé par le produit)'].n, 1);
  assert.deepEqual([r.base.titre.k, r.base.sansReponse.k, r.base.global.entieres.k], [0, 1, 2], 'toujours rien : 0 au titre');
  assert.equal(r.pireLangue, null);
});

test('Contrôle de forme d\'un jeu, ressemblance question-souvenir', () => {
  assert.deepEqual(defautsJeuM({}), ['le jeu n\'a pas de listes « souvenirs » et « questions »']);
  const base = { version: 1, origine: 'essai', maintenant: '2026-11-17T10:00:00' };
  const ok: JeuM = { ...base, souvenirs: [s('a', 'Le code du cellier est 4412.'), s('b', 'Nouveau code du cellier : 9031.', { date: '2026-05-01T09:00:00' })], oublis: [], questions: [q({ id: 'q', sorte: 'plus-recent', attendus: ['b'], interdits: ['a'], question: 'comment ouvrir la réserve ?' })] };
  assert.deepEqual(defautsJeuM(ok), []);
  const d = defautsJeuM({ ...base, souvenirs: [s('a', 't'), s('a', 'u'), s('c', 'v', { date: '2027-01-01T00:00:00' }), s('d', 'w', { sujet: 'x' })], oublis: ['zz'], questions: [
    q({ id: 'q1', sorte: 'plus-recent', attendus: ['c'], interdits: [] }), q({ id: 'q2', sorte: 'sans-reponse', attendus: ['a'] }),
    q({ id: 'q3', attendus: ['inconnu'] }), q({ id: 'q4', sorte: 'autre-langue', attendus: ['d'] }), q({ id: 'q5', question: 'Le code du cellier est 4412 ?', attendus: ['a'] }),
  ] });
  const a = (re: RegExp) => assert.ok(d.some((x) => re.test(x)), `défaut attendu : ${re} dans ${JSON.stringify(d)}`);
  a(/id en double/); a(/rangé après « maintenant »/); a(/sujet et clé vont ensemble/); a(/oubli inconnu « zz »/); a(/plus récent sans ancien/);
  a(/sans réponse, mais des souvenirs attendus/); a(/souvenir inconnu « inconnu »/); a(/« autre-langue », mais dans la langue du souvenir/);
  const parId = new Map([['a', s('a', 'Le code du cellier est 4412.')]]);
  assert.ok(ressemblance(q({ id: 'r', question: 'Le code du cellier est 4412 ?', attendus: ['a'] }), parId) > 0.8);
  assert.ok(ressemblance(q({ id: 'r', question: 'comment ouvrir la réserve ?', attendus: ['a'] }), parId) < 0.3);
});

test('aLHeure : l\'horloge du produit est figée le temps d\'un appel, puis rendue', () => {
  const t = new Date('2026-03-04T05:06:07').getTime();
  assert.equal(aLHeure(t, () => Date.now()), t);
  assert.notEqual(Date.now(), t);
  assert.throws(() => aLHeure(t, () => { throw new Error('x'); }));
  assert.notEqual(Date.now(), t, 'rendue même après une erreur');
});

test('La mémoire du produit : rangement daté, remplacement par sujet et clé, oubli', { timeout: 120_000 }, async () => {
  const { home, fin } = dossierJetable('odin-soul-memoire-essai-');
  environnementBanc(home);
  try {
    const { memoireDuProduit } = await import('./soul-banc/memoire.ts');
    const jeu: JeuM = {
      version: 1, origine: 'essai', maintenant: '2026-11-17T10:00:00', oublis: ['o'],
      souvenirs: [
        s('v', 'Le code du cellier est 4412.', { date: '2025-01-01T09:00:00', sujet: 'maison', cle: 'code_cellier', origine: 'agent' }),
        s('n', 'Le code du cellier est maintenant 9031.', { date: '2026-06-01T09:00:00', sujet: 'maison', cle: 'code_cellier', origine: 'agent' }),
        s('o', 'Le cellier cache les cadeaux de Noël.', { date: '2026-02-01T09:00:00' }),
      ],
      questions: [],
    };
    const p = await memoireDuProduit(home, jeu);
    try {
      assert.equal(p.ranges, 3); assert.equal(p.remplaces, 1, 'même sujet et même clé : l\'ancien est remplacé');
      assert.deepEqual(p.methodes.map((m) => m.nom), ['rappel', 'souvenirs']);
      assert.ok(p.absentes.some((a) => a.nom === 'sens'), 'aucun point de reprise de Soul dans un Odin neuf');
      for (const m of p.methodes) {
        const r = await m.repondre('cellier code');
        assert.deepEqual(r.ids, ['n'], `${m.nom} : seul le plus récent, l'ancien remplacé et l'oublié ne ressortent pas`);
        assert.deepEqual((await m.repondre('zèbre violet')).ids, [], `${m.nom} : rien`);
      }
    } finally { p.fin(); }
  } finally { fin(); }
});

// ------------------------------------------------------------------------------------------------ les deux jeux
const lire = (n: string) => JSON.parse(readFileSync(new URL(`./soul-banc/jeux/${n}.json`, import.meta.url), 'utf8')) as JeuM;
const dev = lire('memoire-developpement'), juge = lire('memoire-principal');

test('Les deux jeux : tailles, langues, écritures, sortes, origine honnête', () => {
  for (const [j, minS, minQ, fige] of [[dev, 150, 200, false], [juge, 300, 300, true]] as const) {
    assert.deepEqual(defautsJeuM(j), []);
    const c = comptesM(j) as { souvenirs: number; questions: number; questionsParLangue: Record<string, number>; questionsParEcriture: Record<string, number>; questionsParSorte: Record<string, number>; souvenirsParSorte: Record<string, number> };
    assert.ok(c.souvenirs >= minS, `${c.souvenirs} souvenirs`); assert.ok(c.questions >= minQ, `${c.questions} questions`);
    assert.equal(Boolean(j.fige), fige);
    const fr = (c.questionsParLangue.fr ?? 0) / c.questions; assert.ok(fr >= 0.4 && fr <= 0.6, `français ${fr}`);
    assert.ok(Object.keys(c.questionsParLangue).filter((l) => l !== 'fr').length >= 8, 'au moins huit autres langues');
    assert.ok(Object.keys(c.questionsParEcriture).length >= 5, 'au moins cinq écritures');
    for (const x of ['reformulee', 'autre-langue', 'indirecte', 'sans-reponse', 'plus-recent', 'oubli']) assert.ok((c.questionsParSorte[x] ?? 0) >= 8, `sorte ${x}`);
    for (const x of ['note', 'fait', 'preference', 'rendez-vous']) assert.ok((c.souvenirsParSorte[x] ?? 0) > 0, `souvenir ${x}`);
    assert.ok(j.souvenirs.some((x) => x.sujet) && j.questions.some((x) => x.sorte === 'plus-recent' && x.interdits.every((i) => !j.souvenirs.find((y) => y.id === i)?.sujet)), 'des corrections avec ET sans sujet ni clé');
    assert.ok(![...Object.keys(c.questionsParLangue), ...j.souvenirs.map((x) => x.langue)].some((l) => /^(swb|buc|shi|kib|zdj|wni)$/.test(l)), 'ni shimaoré ni kibushi');
    assert.match(j.origine, /agent/); assert.match(j.origine, /Non relu par une personne/); assert.match(j.origine, /inventés/);
    assert.equal(j.maintenant, '2026-11-17T10:00:00');
    // Rien de privé : adresses de réseau de documentation seulement, courriels en example.org.
    for (const x of j.souvenirs) {
      for (const ip of x.texte.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) assert.match(ip, /^198\.51\.100\./, `${x.id} : ${ip}`);
      for (const m of x.texte.match(/[^\s@]+@[^\s@]+/g) ?? []) assert.match(m, /@example\.org\.?$/, `${x.id} : ${m}`);
    }
  }
  const ids = new Set([...dev.souvenirs.map((x) => x.id), ...dev.questions.map((x) => x.id)]);
  assert.ok(![...juge.souvenirs.map((x) => x.id), ...juge.questions.map((x) => x.id)].some((i) => ids.has(i)), 'aucun identifiant commun');
  const t = new Set([...dev.souvenirs.map((x) => x.texte), ...dev.questions.map((x) => x.question)].map(normerTexte));
  assert.ok(![...juge.souvenirs.map((x) => x.texte), ...juge.questions.map((x) => x.question)].some((x) => t.has(normerTexte(x))), 'aucun texte commun');
});

test('Version 2 : étiquettes corrigées (G1), rien de proche (≥ 0,6) du jeu de travail (M7)', async () => {
  assert.equal(juge.version, 2); assert.equal(dev.version, 2);
  const qj = (id: string) => juge.questions.find((x) => x.id === id);
  assert.deepEqual([qj('mp-q128')?.attendus, qj('mp-q130')?.attendus, qj('mp-q436')?.attendus], [['mp-b010'], ['mp-b160'], ['mp-b165']]);
  assert.equal(qj('mp-q429'), undefined, 'la réponse n\'existe que dans l\'historique : question retirée');
  const F = await import('./soul-banc/fuites.ts');
  const t = (j: JeuM) => [...j.souvenirs.map((x) => ({ id: x.id, phrase: x.texte })), ...j.questions.map((x) => ({ id: x.id, phrase: x.question }))];
  const proches = F.fuitesContre(t(dev) as never, new F.Index(t(juge).map((x) => ({ texte: x.phrase, source: x.id }))), 0.6);
  assert.deepEqual(proches.map((f) => `${f.id} ~ ${f.source}`), [], 'M7 : aucun gabarit commun au jeu de travail et au jeu figé');
});

test('Les deux jeux contre la matière d\'apprentissage et les autres jeux', { timeout: 600_000 }, async () => {
  const { home, fin } = dossierJetable('odin-soul-memoire-fuites-');
  environnementBanc(home);
  try {
    const mods = await modulesDuProduit(home);
    const F = await import('./soul-banc/fuites.ts');
    const { textesDesJeux } = await import('./soul-banc/logique.ts');
    const { sources } = await F.sourcesApprentissage(mods);
    const index = new F.Index([...sources, ...(await textesDesJeux(['memoire-developpement', 'memoire-principal']))]);
    const textes = (j: JeuM) => [...j.souvenirs.map((x) => ({ id: x.id, phrase: x.texte })), ...j.questions.map((x) => ({ id: x.id, phrase: x.question }))] as never;
    for (const j of [dev, juge]) {
      assert.deepEqual(F.fuitesContre(textes(j), index, 0.8).map((f) => `${f.id} ← ${f.source}`), [], 'aucun texte appris, indexé ou déjà dans un autre jeu');
      assert.deepEqual(F.doublonsInternes(textes(j), 0.8).map((f) => f.id), [], 'aucun quasi-doublon interne');
    }
    assert.deepEqual(F.fuitesContre(textes(dev), new F.Index((textes(juge) as unknown as Array<{ id: string; phrase: string }>).map((x) => ({ texte: x.phrase, source: x.id }))), 0.8).map((f) => f.id), [], 'rien de presque identique entre les deux jeux');
  } finally { fin(); }
});
