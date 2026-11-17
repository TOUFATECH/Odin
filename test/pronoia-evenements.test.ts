// Prónoia — lot 3 : prévoir les événements de la maison à partir d'« événements datés d'une appli » (journal, Théia,
// Syrinx, mesures, météo), avec confiance et raison ; prévenir seulement si c'est utile ; l'écart prévu/arrivé nourrit
// Noûs ; jamais de suivi d'un tiers ; une prévision propose seulement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banc, a, hasard, HEURE, JOUR, MIN } from './pronoia-outils-essai.ts';
import { BORNES } from '../src/valhalla/pronoia/magasin.ts';
import { MOTS_CERTITUDE } from '../src/valhalla/pronoia/honnete.ts';
import type { Banc } from './pronoia-outils-essai.ts';

/** 14 jours : la porte du garage (vue par Théia) s'ouvre vers 8h, sauf 2 jours ; Théia envoie aussi un événement le soir. */
function garage(b: Banc, jours = 14, manques = new Set([3, 9])): void {
  // l'historique est dans le passé : un événement daté dans le futur serait refusé
  if (b.horloge.t < a(jours, 0)) b.horloge.t = a(jours, 0);
  for (let j = 0; j < jours; j++) {
    if (!manques.has(j)) b.p.recevoirEvenement({ appli: 'theia', type: 'porte_ouverte', cle: 'garage', at: a(j, 8, (j * 7) % 15) });
    b.p.recevoirEvenement({ appli: 'theia', type: 'mouvement', cle: 'jardin', at: a(j, 21, 0) });
  }
}

test('prévoit un événement de la maison avec sa confiance et sa raison, puis mesure l\'écart et nourrit Noûs', () => {
  const b = banc();
  try {
    garage(b);
    b.horloge.t = a(14, 6, 0);
    const props = b.p.prevoirEvenements();
    const p = props.find((x) => x.prevision.cle === 'theia/porte_ouverte/garage');
    assert.ok(p, JSON.stringify(props.map((x) => x.prevision.cle)));
    // 12 jours sur 14 observés → (12 + 1) / (14 + 2) = 0,8125
    assert.equal(p!.prevision.confiance, 13 / 16);
    assert.match(p!.texte, /^Prévision \(confiance 81 %\)/);
    assert.match(p!.texte, /12 jour\(s\) sur 14 observé\(s\), vers 8h/);
    assert.match(p!.texte, /aujourd'hui vers/);
    assert.doesNotMatch(p!.texte, MOTS_CERTITUDE);
    assert.equal(p!.agit, false);
    b.notes.length = 0;
    b.horloge.t = a(14, 8, 20);
    const r = b.p.recevoirEvenement({ appli: 'theia', type: 'porte_ouverte', cle: 'garage', at: a(14, 8, 20) });
    assert.equal(r.jugees.length, 1);
    assert.equal(r.jugees[0].etat, 'realisee');
    assert.ok(typeof r.jugees[0].ecartMin === 'number' && r.jugees[0].ecartMin! > 0);
    assert.match(b.notes[0].texte, /^Prévision réalisée — prévu : porte ouverte \(garage\) \(confiance 81 %\)/);
    assert.match(b.notes[0].texte, /écart \+\d+ min/);
    assert.equal(b.notes[0].source, 'pronoia:evenement');
  } finally { b.fermer(); }
});

test('un événement prévu qui ne vient pas est jugé raté, et Noûs le sait', () => {
  const b = banc();
  try {
    garage(b);
    b.horloge.t = a(14, 6, 0);
    b.p.prevoirEvenements();
    b.horloge.t = a(14, 12, 0);
    const bil = b.p.bilan();
    assert.equal(bil.parSorte.evenement.ratees, 1);
    assert.ok(b.notes.some((n) => /Prévision ratée .*rien dans la fenêtre attendue/.test(n.texte)));
  } finally { b.fermer(); }
});

test('Théia et Syrinx sont reçues comme de simples événements datés (sans dépendre de leur code)', () => {
  const b = banc();
  try {
    b.horloge.t = a(10, 11, 0);
    for (let j = 0; j < 10; j++) b.p.recevoirEvenement({ appli: 'syrinx', type: 'sonnette', at: a(j, 12, 5) });
    const p = b.p.prevoirEvenements().find((x) => x.prevision.cle === 'syrinx/sonnette');
    assert.ok(p);
    assert.match(p!.texte, /d'après syrinx/);
  } finally { b.fermer(); }
});

test('tendance : « la machine va manquer de place » est prévue avec sa confiance, puis jugée', () => {
  const b = banc();
  try {
    b.horloge.t = a(9, 4, 0);
    for (let j = 0; j < 10; j++) b.p.recevoirEvenement({ appli: 'naglfar', type: 'disque', cle: '/data', at: a(j, 3, 0), valeur: 70 + 2.5 * j + (j % 2 ? 0.3 : -0.3), seuil: 100 });
    b.horloge.t = a(9, 4, 0);
    const p = b.p.prevoirEvenements().find((x) => x.prevision.cle === 'naglfar/disque//data#seuil');
    assert.ok(p);
    assert.ok(p!.prevision.confiance > 0.8 && p!.prevision.confiance <= 0.9);
    assert.match(p!.texte, /atteindra 100/);
    assert.match(p!.texte, /10 mesures, \+2\.\d+ par jour/);
    const attendu = p!.prevision.attendu!;
    assert.ok(Math.abs(attendu - a(12, 3, 0)) < JOUR, new Date(attendu).toString());
    b.horloge.t = attendu;
    const r = b.p.recevoirEvenement({ appli: 'naglfar', type: 'disque', cle: '/data', at: attendu, valeur: 100.2, seuil: 100 });
    assert.equal(r.jugees[0]?.etat, 'realisee');
  } finally { b.fermer(); }
});

test('météo : la probabilité de Zeus est relayée telle quelle ; peu sûre, c\'est un pressentiment ; non vérifiable, elle périme', () => {
  const b = banc();
  try {
    b.horloge.t = a(0, 9, 0);
    b.p.recevoirEvenement({ appli: 'zeus', type: 'pluie', at: a(0, 8, 0), probabilite: 0.35, pour: a(0, 17, 0) });
    const p = b.p.prevoirEvenements().find((x) => x.prevision.cle === 'zeus/pluie');
    assert.ok(p);
    assert.equal(p!.prevision.confiance, 0.35);
    assert.match(p!.texte, /^Pressentiment \(confiance 35 %, peu sûr\)/);
    assert.match(p!.texte, /relayée sans être recalculée/);
    assert.equal(p!.prevision.verifiable, false);
    b.horloge.t = a(1, 0, 0);
    const bil = b.p.bilan();
    assert.equal(bil.perimees, 1);
    assert.equal(bil.taux, undefined, 'une prévision non vérifiable n\'entre pas dans le taux');
  } finally { b.fermer(); }
});

test('LIMITE vie privée : jamais de suivi d\'un tiers (aucun événement sur une autre personne n\'est appris ni prévu)', () => {
  const b = banc();
  try {
    for (let j = 0; j < 20; j++) {
      const r = b.p.recevoirEvenement({ appli: 'theia', type: 'personne_rentre', cle: 'voisine', at: a(j, 18, 0), sujet: 'tiers' });
      assert.equal(r.accepte, false);
    }
    assert.equal(b.p.refusesTiers, 20);
    assert.equal(b.p.magasin.etat.evenements.length, 0);
    b.horloge.t = a(20, 12, 0);
    assert.deepEqual(b.p.prevoirEvenements(), []);
    // le propriétaire lui-même : permis (ses propres habitudes)
    for (let j = 0; j < 5; j++) b.p.recevoirEvenement({ appli: 'theia', type: 'retour_maison', at: a(j, 18, 30), sujet: 'proprietaire' });
    b.horloge.t = a(5, 12, 0);
    assert.ok(b.p.prevoirEvenements().some((x) => x.prevision.cle === 'theia/retour_maison'));
  } finally { b.fermer(); }
});

test('prévenir seulement si c\'est utile : sûr, proche, sans répétition ; jamais un pressentiment ; toujours discret', () => {
  const b = banc();
  try {
    garage(b);
    b.p.recevoirEvenement({ appli: 'zeus', type: 'orage', at: a(13, 20, 0), probabilite: 0.4, pour: a(14, 8, 30) });
    b.horloge.t = a(14, 5, 0);
    b.p.prevoirEvenements();
    assert.deepEqual(b.p.aPrevenir(), [], 'trop tôt (au-delà de l\'horizon de 2 h)');
    b.horloge.t = a(14, 7, 0);
    const l = b.p.aPrevenir();
    assert.equal(l.length, 1);
    assert.equal(l[0].prevision.cle, 'theia/porte_ouverte/garage');
    assert.equal(l[0].niveau, 'discret');
    assert.equal(l[0].agit, false);
    b.horloge.t = a(14, 7, 10);
    assert.deepEqual(b.p.aPrevenir(), [], 'pas de répétition');
  } finally { b.fermer(); }
});

test('LIMITE : même à confiance maximale, une prévision d\'événement ne déclenche rien', () => {
  const b = banc();
  try {
    b.horloge.t = a(60, 5, 30);
    for (let j = 0; j < 60; j++) b.p.recevoirEvenement({ appli: 'domus', type: 'chaudiere_allumee', at: a(j, 6, 0) });
    const props = b.p.prevoirEvenements();
    assert.ok(props[0].prevision.confiance > 0.95);
    const l = b.p.aPrevenir();
    assert.equal(l.length, 1);
    for (const p of [...props, ...l]) { assert.equal(p.agit, false); assert.equal(p.niveau, 'discret'); }
    // aucune action, aucun envoi : le moteur n'a pas d'exécuteur ; seules des notes d'apprentissage vont à Noûs
    assert.ok(b.notes.every((n) => n.source.startsWith('pronoia:')));
  } finally { b.fermer(); }
});

test('calibration mesurée : un événement vrai 8 jours sur 10 est annoncé et observé autour de 80 %', () => {
  const b = banc();
  try {
    const r = hasard(2026);
    for (let j = 0; j < 220; j++) {
      b.horloge.t = a(j, 6, 0);
      if (j >= 20) b.p.prevoirEvenements();
      if (r() < 0.8) { b.horloge.t = a(j, 7, Math.floor(r() * 20)); b.p.recevoirEvenement({ appli: 'domus', type: 'volets_ouverts', at: b.horloge.t }); }
      b.horloge.t = a(j, 22, 0);
      b.p.recevoirEvenement({ appli: 'domus', type: 'veille', at: b.horloge.t });
      b.p.cloturer();
    }
    const bil = b.p.bilan();
    const ev = bil.parSorte.evenement;
    assert.ok(ev.realisees + ev.ratees >= 190, String(ev.realisees + ev.ratees));
    for (const t of bil.tranches.filter((x) => x.jugees >= 30)) assert.ok(Math.abs(t.ecart!) < 0.1, `tranche ${t.de} : annoncé ${t.annoncee.toFixed(2)}, observé ${t.observee!.toFixed(2)}`);
    console.log(`# mesuré : ${ev.realisees + ev.ratees} prévisions d'événement jugées, taux ${(ev.taux! * 100).toFixed(1)} % ; tranches ${bil.tranches.map((t) => `${t.annoncee.toFixed(2)}→${t.observee!.toFixed(2)} (${t.jugees})`).join(', ')}`);
  } finally { b.fermer(); }
});

test('mode privé ou interrupteur coupé : aucun événement appris, aucune prévision', () => {
  const b = banc();
  try {
    assert.equal(b.p.recevoirEvenement({ appli: 'theia', type: 'x', at: a(0, 1) }, { prive: true }).accepte, false);
    b.p.couper();
    assert.equal(b.p.recevoirEvenement({ appli: 'theia', type: 'x', at: a(0, 2) }).accepte, false);
    assert.deepEqual(b.p.prevoirEvenements(), []);
    assert.deepEqual(b.p.aPrevenir(), []);
    assert.equal(b.p.magasin.etat.evenements.length, 0);
  } finally { b.fermer(); }
});

test('mémoire bornée : les événements ne dépassent jamais la borne', () => {
  const b = banc();
  try {
    const t0 = a(0, 0);
    for (let i = 0; i < BORNES.evenements + 300; i++) b.p.magasin.ajouterEvenement({ appli: 'naglfar', type: 'cpu', at: t0 + i * MIN, valeur: 10, seuil: 100 });
    b.p.magasin.sauver();
    assert.equal(b.p.magasin.etat.evenements.length, BORNES.evenements);
    b.horloge.t = t0 + 6 * HEURE;
    const t1 = performance.now();
    b.p.prevoirEvenements();
    assert.ok(performance.now() - t1 < 2000, 'prévoir reste rapide sur la borne');
  } finally { b.fermer(); }
});
