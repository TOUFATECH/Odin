// Prónoia — lot 1, le socle : contrat, magasin chiffré borné, purge, effacement, bilan VRAI et calibration, marquage
// des pressentiments, aucune formule de certitude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Magasin, BORNES } from '../src/valhalla/pronoia/magasin.ts';
import { bilan } from '../src/valhalla/pronoia/bilan.ts';
import { formuler, estPressentiment, MOTS_CERTITUDE, pourcent, demandeAgit } from '../src/valhalla/pronoia/honnete.ts';
import { DEF_PRONOIA, nomBasePronoia } from '../src/valhalla/pronoia/base.ts';
import { REGLAGES_DEFAUT, type Prevision } from '../src/valhalla/pronoia/types.ts';

const T0 = new Date(2026, 10, 2, 8, 0).getTime();
const prev = (o: Partial<Prevision> = {}): Prevision => ({ id: Math.random().toString(36).slice(2), sorte: 'evenement', quoi: 'la porte du garage s\'ouvre', cle: 'domus/porte/garage', echeance: T0 + 3_600_000, confiance: 0.8, sources: [{ type: 'rythme', detail: '12 jours sur 14 vers 8h' }], cree: T0, etat: 'en_attente', verifiable: true, ...o });
const vides = { servies: 0, manquees: 0, perdues: 0, gagneMs: 0, refusees: 0 };

test('la base s\'appelle PRONOIA_ODIN et ses écritures sont déclarées une requête chacune', () => {
  assert.equal(nomBasePronoia(), 'PRONOIA_ODIN');
  for (const sql of Object.values(DEF_PRONOIA.ecritures)) assert.equal(sql.split(';').length, 1, sql);
  assert.match(DEF_PRONOIA.migrations[0].sql, /GRANT SELECT ON v_bilan, v_compteurs TO odin_lecture/);
});

test('le magasin est chiffré au repos, relu, borné, purgé et effaçable', () => {
  const home = mkdtempSync(join(tmpdir(), 'pronoia-'));
  try {
    const m = new Magasin(home, join(home, 'valhalla', 'pronoia'));
    m.ajouterDemande({ at: T0, texte: 'quelle météo pour aujourd\'hui à Lyon' });
    m.poserPrevision(prev({ quoi: 'secret-quoi-unique' }));
    m.sauver();
    const brut = readFileSync(m.fichier, 'utf8');
    assert.match(brut, /^odc1:/);
    assert.doesNotMatch(brut, /météo|secret-quoi-unique/);
    const relu = new Magasin(home, join(home, 'valhalla', 'pronoia'));
    assert.equal(relu.etat.demandes[0].texte, 'quelle météo pour aujourd\'hui à Lyon');
    assert.equal(relu.etat.previsions[0].quoi, 'secret-quoi-unique');
    // bornes
    for (let i = 0; i < BORNES.demandes + 50; i++) relu.etat.demandes.push({ at: T0 + i, texte: `d${i}` });
    relu.sauver();
    assert.equal(relu.etat.demandes.length, BORNES.demandes);
    // purge : durée de garde
    relu.etat.reglages.gardeJours = 1;
    relu.etat.demandes.push({ at: T0 - 5 * 86_400_000, texte: 'vieille' });
    const retire = relu.purger(T0 + 1000);
    assert.ok(retire >= 1);
    assert.ok(!relu.etat.demandes.some((d) => d.texte === 'vieille'));
    // effacer tout : rien ne reste, les réglages si
    relu.effacerTout();
    assert.equal(relu.etat.demandes.length + relu.etat.previsions.length + relu.etat.evenements.length, 0);
    assert.equal(relu.etat.reglages.gardeJours, 1);
    assert.equal(new Magasin(home, join(home, 'valhalla', 'pronoia')).etat.demandes.length, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('le magasin écrit aussi dans la base quand elle est prête, contenus chiffrés', () => {
  const home = mkdtempSync(join(tmpdir(), 'pronoia-'));
  try {
    const m = new Magasin(home, join(home, 'p'));
    const ecrit: unknown[][] = [];
    m.brancherMiroir({ ecrire: (...ls) => { for (const l of ls) ecrit.push(l); } });
    m.ajouterDemande({ at: T0, texte: 'texte privé de la demande' });
    m.poserPrevision(prev());
    assert.deepEqual(ecrit.map((l) => l[0]), ['demande_pose', 'prevision_pose']);
    for (const l of ecrit) for (const v of l) assert.ok(!(typeof v === 'string' && v.includes('texte privé')));
    for (const l of ecrit) assert.ok(String(l[0]) in DEF_PRONOIA.ecritures);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('le taux de réussite est le vrai : périmées et en attente hors du taux, rien d\'arrondi vers le haut', () => {
  const l = [
    ...Array.from({ length: 2 }, () => prev({ etat: 'realisee' })),
    ...Array.from({ length: 1 }, () => prev({ etat: 'ratee' })),
    ...Array.from({ length: 5 }, () => prev({ etat: 'perimee' })),
    ...Array.from({ length: 4 }, () => prev({ etat: 'en_attente' })),
  ];
  const b = bilan(l, vides);
  assert.equal(b.taux, 2 / 3);
  assert.match(b.texte, /66\.6 %/); // 66,66… arrondi vers le BAS, jamais 67
  assert.match(b.texte, /5 prévision\(s\) périmée\(s\)/);
  assert.equal(bilan([], vides).taux, undefined);
  assert.match(bilan([], vides).texte, /pas de taux/);
});

test('calibration : 100 prévisions dites à 80 %, 80 réalisées → la tranche observe 80 %', () => {
  const l = Array.from({ length: 100 }, (_, i) => prev({ confiance: 0.8, etat: i < 80 ? 'realisee' : 'ratee' }));
  l.push(...Array.from({ length: 50 }, (_, i) => prev({ confiance: 0.3, etat: i < 35 ? 'realisee' : 'ratee' })));
  const b = bilan(l, vides);
  const t8 = b.tranches.find((t) => t.de <= 0.8 && 0.8 < t.a)!;
  assert.equal(t8.jugees, 100);
  assert.equal(t8.observee, 0.8);
  assert.ok(Math.abs(t8.ecart!) < 1e-9);
  const t3 = b.tranches.find((t) => t.de <= 0.3 && 0.3 < t.a)!;
  assert.equal(t3.observee, 0.7); // trop prudente : l'écart est montré (+0,4), pas caché
  assert.ok(t3.ecart! > 0.39);
});

test('un pressentiment est marqué comme tel ; aucun texte ne parle de certitude', () => {
  const r = REGLAGES_DEFAUT;
  const faible = prev({ confiance: 0.42 }), forte = prev({ confiance: 0.999 });
  assert.equal(estPressentiment(faible, r), true);
  assert.equal(estPressentiment(forte, r), false);
  const tf = formuler(faible, r, T0), tF = formuler(forte, r, T0);
  assert.match(tf, /^Pressentiment \(confiance 42 %, peu sûr\)/);
  assert.match(tF, /^Prévision \(confiance 99 %\)/); // 99,9 % → 99, jamais 100
  for (const t of [tf, tF]) {
    assert.doesNotMatch(t, MOTS_CERTITUDE);
    assert.match(t, /pas une certitude/);
    assert.match(t, /D'après : 12 jours sur 14 vers 8h/);
    assert.match(t, /Estimation faite/);
  }
  assert.equal(pourcent(1.7), 100);
  assert.equal(pourcent(NaN), 0);
});

test('une demande qui agit est reconnue (jamais préparée d\'avance)', () => {
  for (const t of ['Envoie un message à Paul', 'achète du lait', 'éteins la lumière du salon', 'supprime ce fichier', 'paie la facture']) assert.equal(demandeAgit(t), true, t);
  for (const t of ['quelle météo demain', 'résume mes mails non lus', 'où en est le disque du serveur']) assert.equal(demandeAgit(t), false, t);
});
