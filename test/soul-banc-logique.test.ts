// Banc de logique (test/soul-banc/logique.ts) : les fonctions pures prouvées sur de petits cas calculés à la main, puis
// les deux jeux contrôlés contre le catalogue RÉEL des applis (chaque appli, action et réglage existe) et contre toute
// la matière d'apprentissage et les autres jeux du banc (aucune fuite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { appariement, comptesL, defautsJeuL, etapeVaut, jugerL, rapportL, releveL, type DemandeL, type EtapeL, type JeuL, type ReponseL } from './soul-banc/logique.ts';
import { normerTexte, type InfosActions } from './soul-banc/comprehension.ts';
import { dossierJetable, environnementBanc, modulesDuProduit } from './soul-banc/catalogue.ts';

const INFOS: InfosActions = new Map([
  ['appareils.commander', [{ key: 'appareil', kind: 'text', required: true }, { key: 'valeur', kind: 'text', required: true }]],
  ['midgard.commander', [{ key: 'appareil', kind: 'text', required: true }, { key: 'valeur', kind: 'text', required: true }]],
  ['gladsheim.meteo', [{ key: 'ville', kind: 'text', required: false, default: '' }]],
  ['garmr.bannir', [{ key: 'ip', kind: 'text', required: true }, { key: 'minutes', kind: 'number', required: false, default: 60 }]],
  ['aegir.stop', []],
]);
const e = (appli: string, action: string, reglages: Record<string, unknown> = {}, o: Partial<EtapeL> = {}): EtapeL => ({ appli, action, reglages: reglages as EtapeL['reglages'], ...o });
const dem = (o: Partial<DemandeL> & { id: string }): DemandeL => ({ langue: 'fr', ecriture: 'Latn', phrase: o.id, logique: ['ordre'], decision: 'agir', etapes: [], aRelire: false, ...o });
const rep = (decision: ReponseL['decision'], etapes: ReponseL['etapes'] = []): ReponseL => ({ decision, etapes });

test('Une étape : même action, mêmes réglages attendus, même condition', () => {
  const a = e('appareils', 'commander', { appareil: 'lampe du salon', valeur: 'off' }, { aussi: ['midgard.commander'] });
  assert.ok(etapeVaut(a, { appli: 'appareils', action: 'commander', reglages: { appareil: 'la lampe du salon', valeur: 'éteins' } }, { infos: INFOS }));
  assert.ok(etapeVaut(a, { appli: 'midgard', action: 'commander', reglages: { appareil: 'Lampe du salon', valeur: 'off' } }), '« aussi » accepte une autre appli·action');
  assert.ok(!etapeVaut(a, { appli: 'appareils', action: 'commander', reglages: { appareil: 'lampe du salon', valeur: 'on' } }));
  assert.ok(!etapeVaut(a, { appli: 'appareils', action: 'commander', reglages: { appareil: 'lampe du salon', valeur: 'off' }, si: true }), 'condition en trop');
  assert.ok(!etapeVaut({ ...a, si: true }, { appli: 'appareils', action: 'commander', reglages: { appareil: 'lampe du salon', valeur: 'off' } }), 'condition oubliée');
  assert.ok(etapeVaut(e('garmr', 'bannir', { ip: '198.51.100.7', minutes: 90 }), { appli: 'garmr', action: 'bannir', reglages: { ip: '198.51.100.7', minutes: '1 h 30', raison: 'x' } }), 'durée convertie, réglage en plus non jugé');
  assert.ok(!etapeVaut(a, { appli: null, action: null, reglages: {} }));
});

test('Appariement une à une (ordre libre) : chaque étape obtenue ne sert qu\'une fois', () => {
  const att = [e('appareils', 'commander', { appareil: 'cuisine', valeur: 'off' }), e('appareils', 'commander', { appareil: 'couloir', valeur: 'off' })];
  const c = { appli: 'appareils', action: 'commander', reglages: { appareil: 'cuisine', valeur: 'off' } }, k = { appli: 'appareils', action: 'commander', reglages: { appareil: 'couloir', valeur: 'off' } };
  assert.equal(appariement(att, [k, c]), 2);
  assert.equal(appariement(att, [c, c]), 1, 'deux fois la même étape n\'en vaut qu\'une');
  assert.equal(appariement(att, []), 0);
});

test('Juger une demande « agir » : toutes les étapes, dans le bon ordre', () => {
  const d = dem({ id: 'o', etapes: [e('aegir', 'stop'), e('appareils', 'commander', { appareil: 'salon', valeur: 'on' })] });
  const stop = { appli: 'aegir', action: 'stop', reglages: {} }, salon = { appli: 'appareils', action: 'commander', reglages: { appareil: 'salon', valeur: 'on' } };
  const bon = jugerL(d, rep('agir', [stop, salon]));
  assert.ok(bon.entiere); assert.equal(bon.bonOrdre, true); assert.equal(bon.trouvees, 2); assert.equal(bon.inventees, 0); assert.ok(bon.premiereJuste);
  const envers = jugerL(d, rep('agir', [salon, stop]));
  assert.ok(!envers.entiere); assert.equal(envers.bonOrdre, false); assert.ok(envers.toutesTrouvees);
  const une = jugerL(d, rep('agir', [stop]));
  assert.ok(!une.entiere); assert.equal(une.trouvees, 1); assert.equal(une.bonOrdre, null, 'l\'ordre ne se juge que si tout est trouvé');
  const trop = jugerL(d, rep('agir', [stop, salon, { appli: 'garmr', action: 'bannir', reglages: { ip: '198.51.100.1' } }]));
  assert.ok(!trop.entiere); assert.equal(trop.inventees, 1);
  const libre = jugerL({ ...d, ordreLibre: true }, rep('agir', [salon, stop]));
  assert.ok(libre.entiere, 'ordre libre : l\'ordre ne compte pas'); assert.equal(libre.bonOrdre, null);
  const passe = jugerL(d, rep('passer'));
  assert.ok(!passe.entiere && !passe.decisionJuste && passe.prudent);
});

test('Juger « demander », « rien », « refuser » : la décision, sans rien faire', () => {
  for (const decision of ['demander', 'rien', 'refuser'] as const) {
    const d = dem({ id: decision, decision, logique: ['contradiction'] });
    assert.ok(jugerL(d, rep(decision)).entiere);
    const p = jugerL(d, rep('passer'));
    assert.ok(!p.entiere && p.prudent, 'passer la main est prudent, pas juste');
    const a = jugerL(d, rep('agir', [{ appli: 'aegir', action: 'stop', reglages: {} }]));
    assert.ok(!a.entiere && !a.prudent); assert.equal(a.inventees, 1);
  }
});

test('Relevés et rapport : comptes, plafond d\'une étape, sortes multiples', () => {
  const d1 = dem({ id: '1', logique: ['ordre', 'plusieurs'], etapes: [e('aegir', 'stop'), e('appareils', 'commander', { appareil: 'a', valeur: 'on' })] });
  const d2 = dem({ id: '2', logique: ['negation'], langue: 'en', etapes: [e('appareils', 'commander', { appareil: 'b', valeur: 'off' })] });
  const d3 = dem({ id: '3', logique: ['contradiction'], decision: 'refuser' });
  const r1 = rep('agir', [{ appli: 'aegir', action: 'stop', reglages: {} }]);
  const r2 = rep('agir', [{ appli: 'appareils', action: 'commander', reglages: { appareil: 'b', valeur: 'off' } }]);
  const r3 = rep('passer');
  const js = [[d1, r1], [d2, r2], [d3, r3]].map(([d, r]) => ({ demande: d as DemandeL, j: jugerL(d as DemandeL, r as ReponseL) }));
  const g = releveL(js);
  assert.deepEqual([g.entieres.k, g.entieres.n], [1, 3]);
  assert.deepEqual([g.etapes.k, g.etapes.n], [2, 3]);
  assert.deepEqual([g.plafondUneEtape.k, g.plafondUneEtape.n], [2, 3], 'd2 (une étape) et d3 (refuser)');
  assert.deepEqual([g.prudence.k, g.prudence.n], [1, 1]);
  assert.deepEqual([g.premiere.k, g.premiere.n], [2, 2]);
  assert.deepEqual([g.avecInventees.k, g.inventees.k, g.inventees.n], [0, 0, 2]);
  const r = rapportL([{ demande: d1, reponse: r1, ms: 1 }, { demande: d2, reponse: r2, ms: 1 }, { demande: d3, reponse: r3, ms: 1 }]);
  assert.deepEqual(Object.keys(r.parSorte), ['contradiction', 'negation', 'ordre', 'plusieurs']);
  assert.equal(r.parSorte.ordre.n, 1); assert.equal(r.parSorte.plusieurs.n, 1);
  assert.deepEqual(r.decisions, { 'agir → agir': 2, 'refuser → passer': 1 });
  assert.equal(r.francais.n, 2); assert.equal(r.autres.n, 1);
});

// ------------------------------------------------------------------------------------------------ version 2 (relecture du 17/11)
test('L\'ordre se juge sur les étapes trouvées, même avec une étape inventée en plus (P2) ; pas de « 1re étape » si l\'ordre est libre (P3)', () => {
  const d = dem({ id: 'o', etapes: [e('aegir', 'stop'), e('appareils', 'commander', { appareil: 'salon', valeur: 'on' })] });
  const stop = { appli: 'aegir', action: 'stop', reglages: {} }, salon = { appli: 'appareils', action: 'commander', reglages: { appareil: 'salon', valeur: 'on' } };
  const ban = { appli: 'garmr', action: 'bannir', reglages: { ip: '198.51.100.1' } };
  assert.equal(jugerL(d, rep('agir', [stop, ban, salon])).bonOrdre, true, 'une étape en trop au milieu ne rend pas l\'ordre faux');
  assert.equal(jugerL(d, rep('agir', [salon, ban, stop])).bonOrdre, false);
  assert.ok(!jugerL(d, rep('agir', [stop, ban, salon])).entiere, 'mais la demande reste ratée');
  const libre = jugerL({ ...d, ordreLibre: true }, rep('agir', [salon, stop]));
  assert.equal(libre.premiereJuste, null);
  const r = releveL([{ demande: { ...d, ordreLibre: true }, j: libre }, { demande: d, j: jugerL(d, rep('agir', [stop, salon])) }]);
  assert.deepEqual([r.premiere.k, r.premiere.n], [1, 1], 'la 1re étape ne se juge que quand l\'ordre compte');
});

test('Le titre se calcule sur les demandes « agir » ; « demander / rien / refuser » à part, sans compter « passer » ; base abstention (G2)', () => {
  const da = dem({ id: 'a', etapes: [e('aegir', 'stop')] }), dd = dem({ id: 'd', decision: 'demander', logique: ['relance'] }), dr = dem({ id: 'r', decision: 'rien', logique: ['negation'] });
  const passe = rep('passer');
  const r = rapportL([{ demande: da, reponse: passe, ms: 1 }, { demande: dd, reponse: passe, ms: 1 }, { demande: dr, reponse: rep('rien'), ms: 1 }]);
  assert.deepEqual([r.titre.k, r.titre.n], [0, 1]);
  assert.deepEqual([r.pasAgir.k, r.pasAgir.n], [1, 2], 'passer n\'est pas « demander »');
  assert.deepEqual([r.base.titre.k, r.base.pasAgir.k, r.base.global.prudence.k, r.base.global.prudence.n], [0, 0, 2, 2], 'toujours passer : 100 % de prudence, 0 ailleurs');
  assert.equal(r.pireLangue, null, 'moins de 10 demandes : pas de « pire langue »');
});

test('Contrôle de forme d\'un jeu', () => {
  assert.deepEqual(defautsJeuL({}), ['le jeu n\'a pas de liste « demandes »']);
  const jeu = (demandes: unknown[]) => ({ version: 1, origine: 'essai', maintenant: '2026-11-17T10:00:00', demandes });
  assert.deepEqual(defautsJeuL(jeu([dem({ id: 'x', logique: ['negation'], etapes: [e('garmr', 'bannir', { ip: '198.51.100.3', minutes: 30 })] })]), INFOS), []);
  const d = defautsJeuL(jeu([
    dem({ id: 'x', etapes: [e('garmr', 'bannir', { adresse: '198.51.100.3' })] }),
    dem({ id: 'x', decision: 'refuser', etapes: [e('aegir', 'stop')] }),
    dem({ id: 'y', logique: ['relance'], etapes: [e('aegir', 'stop', {}, { si: true })] }),
    dem({ id: 'z', logique: ['inconnue' as never], decision: 'agir', etapes: [] }),
    dem({ id: 'w', etapes: [e('garmr', 'bannir', { ip: '198.51.100.3', minutes: 'trente' })] }),
  ]), INFOS);
  const a = (re: RegExp) => assert.ok(d.some((x) => re.test(x)), `défaut attendu : ${re} dans ${JSON.stringify(d)}`);
  a(/réglage inconnu « garmr\.bannir\.adresse »/); a(/id en double/); a(/des étapes pour une décision « refuser »/); a(/relance sans tour précédent/);
  a(/la première étape ne peut pas dépendre/); a(/sorte inconnue « inconnue »/); a(/« agir » sans étape/); a(/minutes attend un nombre/);
});

// ------------------------------------------------------------------------------------------------ les deux jeux
const lire = (n: string) => JSON.parse(readFileSync(new URL(`./soul-banc/jeux/${n}.json`, import.meta.url), 'utf8')) as JeuL;
const dev = lire('logique-developpement'), juge = lire('logique-principal');

test('Les deux jeux : tailles, langues, écritures, sortes, origine honnête', () => {
  for (const [j, min, fige] of [[dev, 200, false], [juge, 300, true]] as const) {
    const c = comptesL(j) as { demandes: number; parLangue: Record<string, number>; parEcriture: Record<string, number>; parSorte: Record<string, number>; parDecision: Record<string, number> };
    assert.ok(c.demandes >= min, `${c.demandes} demandes`);
    assert.equal(Boolean(j.fige), fige);
    const fr = (c.parLangue.fr ?? 0) / c.demandes; assert.ok(fr >= 0.4 && fr <= 0.6, `français ${fr}`);
    assert.ok(Object.keys(c.parLangue).filter((l) => l !== 'fr').length >= 8, 'au moins huit autres langues');
    assert.ok(Object.keys(c.parEcriture).length >= 5, 'au moins cinq écritures');
    for (const s of ['negation', 'condition', 'ordre', 'plusieurs', 'temps', 'quantite', 'comparaison', 'relance', 'correction', 'contradiction']) assert.ok((c.parSorte[s] ?? 0) >= 8, `sorte ${s} : ${c.parSorte[s] ?? 0}`);
    for (const s of ['agir', 'demander', 'rien', 'refuser']) assert.ok((c.parDecision[s] ?? 0) > 0, `décision ${s}`);
    assert.ok(!Object.keys(c.parLangue).some((l) => /^(swb|buc|shi|kib|zdj|wni)$/.test(l)), 'ni shimaoré ni kibushi');
    assert.match(j.origine, /agent/); assert.match(j.origine, /Non relu par une personne/);
    assert.equal(j.maintenant, '2026-11-17T10:00:00');
  }
  const ids = new Set(dev.demandes.map((d) => d.id));
  assert.ok(!juge.demandes.some((d) => ids.has(d.id)), 'aucun identifiant commun');
  const p = new Set(dev.demandes.map((d) => normerTexte(d.phrase)));
  assert.ok(!juge.demandes.some((d) => p.has(normerTexte(d.phrase))), 'aucune phrase commune');
});

test('Version 2 : jeu figé, rien de proche (≥ 0,6) du jeu de travail, assez de « demander » et de « rien »', async () => {
  assert.equal(juge.version, 2); assert.equal(dev.version, 2);
  const F = await import('./soul-banc/fuites.ts');
  const proches = F.fuitesContre(dev.demandes as never, new F.Index(juge.demandes.map((d) => ({ texte: d.phrase, source: d.id }))), 0.6);
  assert.deepEqual(proches.map((f) => `${f.id} ~ ${f.source}`), [], 'M7 : aucun gabarit commun au jeu de travail et au jeu figé');
  const c = comptesL(juge) as { parDecision: Record<string, number> };
  assert.ok(c.parDecision.demander >= 30 && c.parDecision.rien >= 25, `M8 : ${JSON.stringify(c.parDecision)}`);
  assert.ok(![...dev.demandes, ...juge.demandes].some((d) => /^(Hani|Hang)$/.test(d.ecriture)), 'P4 : Hans et Kore, comme les autres jeux');
});

test('Les deux jeux contre le catalogue réel, la matière d\'apprentissage et les autres jeux', { timeout: 600_000 }, async () => {
  const { home, fin } = dossierJetable('odin-soul-logique-essai-');
  environnementBanc(home);
  try {
    const mods = await modulesDuProduit(home);
    const { infosDe } = await import('./soul-banc/comprehension.ts');
    const infos = infosDe(mods);
    assert.deepEqual(defautsJeuL(dev, infos), []);
    assert.deepEqual(defautsJeuL(juge, infos), []);
    const F = await import('./soul-banc/fuites.ts');
    const { textesDesJeux } = await import('./soul-banc/logique.ts');
    const { sources } = await F.sourcesApprentissage(mods);
    const index = new F.Index([...sources, ...(await textesDesJeux(['logique-developpement', 'logique-principal']))]);
    const forme = (j: JeuL) => j.demandes as never;
    for (const j of [dev, juge]) {
      assert.deepEqual(F.fuitesContre(forme(j), index, 0.8).map((f) => `${f.id} ← ${f.source}`), [], 'aucune phrase apprise, indexée ou déjà dans un autre jeu');
      assert.deepEqual(F.doublonsInternes(forme(j), 0.8).map((f) => f.id), [], 'aucun quasi-doublon interne');
    }
    assert.deepEqual(F.fuitesContre(forme(dev), new F.Index(juge.demandes.map((d) => ({ texte: d.phrase, source: d.id }))), 0.8).map((f) => f.id), [], 'rien de presque identique entre les deux jeux');
  } finally { fin(); }
});
