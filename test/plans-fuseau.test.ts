// Les tâches à heure fixe des applis comptent à l'heure du lieu d'Odin (celle que Talos écrit), pas à celle de la
// machine : vérification des ISO et des logiciels, tournée d'Andromède et d'Hermès. Lieu à Paris ; le résultat ne
// dépend pas du fuseau de la machine (TZ=UTC ou autre).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionDe, setLieuCourant } from '../src/valhalla/lieu.ts';
import { prochaineVerif, verifDue } from '../src/valhalla/forge/bibliotheque.ts';
import { due, nextRun } from '../src/valhalla/forge/forge.ts';
import { depuisPlanVerif, phrase, prochaine } from '../src/draupnir/rythme.ts';
import { nettoyageDu } from '../src/valhalla/modules/gefjon.ts';
import { due as dueArche } from '../src/valhalla/modules/skuld.ts';

const paris = () => setLieuCourant({ nom: 'Paris', fuseau: 'Europe/Paris', region: regionDe('FR') });

test('vérification des ISO : la prochaine exécution affichée dit la même heure que la phrase', () => {
  paris();
  try {
    const p = { frequence: 'mois' as const, jour: 1, heure: '04:00' };
    const now = new Date('2026-11-16T10:00:00Z');
    assert.equal(phrase(depuisPlanVerif(p)), 'Chaque mois, le 1er à 4 h');
    assert.equal(prochaineVerif(p, now).toISOString(), '2026-12-01T03:00:00.000Z', '4 h à Paris = 3 h UTC en hiver');
    assert.equal(prochaineVerif(p, now).getTime(), prochaine(depuisPlanVerif(p), now)!.getTime());
    // Due à 4 h de Paris le 1er, pas avant.
    assert.equal(verifDue(p, new Date('2026-12-01T02:59:00Z')), false);
    assert.equal(verifDue(p, new Date('2026-12-01T03:00:30Z')), true);
    // Déjà faite ce jour-là : plus due avant le mois suivant.
    assert.equal(verifDue({ ...p, derniere: Date.parse('2026-12-01T03:01:00Z') }, new Date('2026-12-15T10:00:00Z')), false);
    assert.equal(verifDue({ ...p, derniere: Date.parse('2026-12-01T03:01:00Z') }, new Date('2027-01-01T03:00:30Z')), true);
  } finally { setLieuCourant(undefined); }
});

test('tournée d\'Andromède et d\'Hermès : jours et heure du lieu, changement d\'heure compris', () => {
  paris();
  try {
    const plan = { days: [1], at: '03:15', auto: true };
    // Lundi 23 novembre 2026, 3 h 15 à Paris = 2 h 15 UTC.
    assert.equal(nextRun(plan, new Date('2026-11-17T10:00:00Z'))!.toISOString(), '2026-11-23T02:15:00.000Z');
    assert.equal(due(plan, new Date('2026-11-23T02:14:00Z'), 0), false);
    assert.equal(due(plan, new Date('2026-11-23T02:16:00Z'), 0), true);
    assert.equal(due(plan, new Date('2026-11-23T02:16:00Z'), Date.parse('2026-11-23T02:15:30Z')), false, 'pas deux fois');
    // Une seule fois, à une date : l'heure du lieu aussi.
    assert.equal(nextRun({ ...plan, date: '2026-12-02' }, new Date('2026-11-17T10:00:00Z'))!.toISOString(), '2026-12-02T02:15:00.000Z');
    // Printemps : 2 h 30 n'existe pas le dimanche 28 mars 2027 → part à 3 h 00 (heure d'été).
    assert.equal(nextRun({ days: [0], at: '02:30', auto: true }, new Date('2027-03-27T12:00:00Z'))!.toISOString(), '2027-03-28T01:00:00.000Z');
  } finally { setLieuCourant(undefined); }
});

test('Héraclès et Arche : l\'heure du plan est celle du lieu', () => {
  paris();
  try {
    const p = { id: 'ici', poste: '', nomPoste: 'ce serveur', categories: ['temporaires'], quand: 'jour' as const, heure: 4 };
    assert.equal(nettoyageDu(p, new Date('2026-11-16T03:10:00Z')), true, '4 h 10 à Paris');
    assert.equal(nettoyageDu(p, new Date('2026-11-16T04:10:00Z')), false, '5 h 10 à Paris');
    const a = { base: 'x', toutes: 'nuit' as const, heure: 3, garde: { jours: 7, semaines: 4, mois: 6 }, actif: true };
    assert.equal(dueArche(a, new Date('2026-11-15T02:00:00Z'), new Date('2026-11-16T02:05:00Z')), true, '3 h 05 à Paris');
    assert.equal(dueArche(a, new Date('2026-11-15T02:00:00Z'), new Date('2026-11-16T03:05:00Z')), false, '4 h 05 à Paris');
  } finally { setLieuCourant(undefined); }
});
