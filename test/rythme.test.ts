// Le rythme en clair de Talos (src/draupnir/rythme.ts) : phrases, cron aller-retour, prochaine exécution à l'heure du
// lieu (fuseau donné, jamais l'heure de la machine), changement d'heure, plans de vérification des ISO et des logiciels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depuisCron, depuisPlanVerif, lireRythme, phrase, prochaine, prochaineCron, prochaines, texteDate, verifierRythme, versCron, versPlanVerif, type Rythme } from '../src/draupnir/rythme.ts';

test('chaque phrase du contrat', () => {
  const P = (r: Rythme) => phrase(r);
  assert.equal(P({ genre: 'minutes', n: 1 }), 'Chaque minute');
  assert.equal(P({ genre: 'minutes', n: 15 }), 'Toutes les 15 minutes');
  assert.equal(P({ genre: 'heures', n: 1 }), 'Toutes les heures');
  assert.equal(P({ genre: 'heures', n: 2, minute: 30 }), 'Toutes les 2 heures, à la minute 30');
  assert.equal(P({ genre: 'jour', heure: '07:30' }), 'Tous les jours à 7 h 30');
  assert.equal(P({ genre: 'jour', heure: '00:00' }), 'Tous les jours à minuit');
  assert.equal(P({ genre: 'jour', heure: '12:00' }), 'Tous les jours à midi');
  assert.equal(P({ genre: 'semaine', jours: [4, 1], heure: '09:00' }), 'Chaque semaine, le lundi et le jeudi à 9 h');
  assert.equal(P({ genre: 'semaine', jours: [1, 2, 3, 4, 5], heure: '09:00' }), 'Du lundi au vendredi à 9 h');
  assert.equal(P({ genre: 'semaine', jours: [0, 1, 2, 3, 4, 5, 6], heure: '09:00' }), 'Tous les jours à 9 h');
  assert.equal(P({ genre: 'mois', jour: 1, heure: '03:00' }), 'Chaque mois, le 1er à 3 h');
  assert.equal(P({ genre: 'mois', jour: 31, heure: '03:00' }), 'Chaque mois, le 31 (ou le dernier jour) à 3 h');
  assert.equal(P({ genre: 'une_fois', date: '2026-11-18', heure: '15:00' }), 'Une seule fois, le mercredi 18 novembre 2026 à 15 h');
  assert.equal(P({ genre: 'cron', cron: '30 7 * * 1-5' }), 'Du lundi au vendredi à 7 h 30', 'forme simple reconnue');
  assert.equal(P({ genre: 'cron', cron: '30 7 1-7 * 1' }), 'Planning expert : 30 7 1-7 * 1');
  assert.equal(P({ genre: 'secondes', n: 10 }), 'En continu, toutes les 10 secondes');
  assert.equal(P({ genre: 'secondes', n: 60 }), 'En continu, chaque minute');
  assert.equal(P({ genre: 'secondes', n: 300 }), 'Toutes les 5 minutes');
  assert.equal(P({ genre: 'secondes', n: 3600 }), 'Toutes les heures');
  assert.equal(P({ genre: 'libre', texte: 'à l\'heure de chaque plan' }), 'À l\'heure de chaque plan');
});

test('versCron et depuisCron : aller et retour', () => {
  const formes: Rythme[] = [
    { genre: 'minutes', n: 1 }, { genre: 'minutes', n: 15 }, { genre: 'heures', n: 1, minute: 0 }, { genre: 'heures', n: 2, minute: 30 },
    { genre: 'jour', heure: '07:30' }, { genre: 'semaine', jours: [1, 4], heure: '09:00' }, { genre: 'semaine', jours: [1, 2, 3, 4, 5], heure: '09:00' }, { genre: 'mois', jour: 1, heure: '03:00' },
  ];
  for (const r of formes) { const c = versCron(r)!; assert.ok(c, JSON.stringify(r)); assert.deepEqual(depuisCron(c), r, c); assert.equal(versCron(depuisCron(c)), c); }
  assert.equal(versCron({ genre: 'mois', jour: 31, heure: '03:00' }), undefined, 'le dernier jour ne s\'écrit pas en cron');
  assert.equal(versCron({ genre: 'une_fois', date: '2026-11-18', heure: '15:00' }), undefined);
  assert.equal(versCron({ genre: 'minutes', n: 7 }), undefined);
  assert.deepEqual(depuisCron('@daily'), { genre: 'jour', heure: '00:00' });
  assert.deepEqual(depuisCron('*/5 9-17 * * *'), { genre: 'cron', cron: '*/5 9-17 * * *' });
});

test('prochaine : à l\'heure du lieu, quel que soit le fuseau de la machine', () => {
  // Mayotte (UTC+3), machine en UTC : 7 h 30 à Mayotte = 4 h 30 UTC.
  const p = prochaine({ genre: 'jour', heure: '07:30' }, new Date('2026-11-16T10:00:00Z'), 'Indian/Mayotte')!;
  assert.equal(p.toISOString(), '2026-11-17T04:30:00.000Z');
  assert.equal(prochaineCron('30 7 * * *', new Date('2026-11-16T10:00:00Z'), 'Indian/Mayotte')!.toISOString(), '2026-11-17T04:30:00.000Z');
  // Semaine : le lundi et le jeudi à 9 h (16/11/2026 est un lundi).
  assert.deepEqual(prochaines({ genre: 'semaine', jours: [1, 4], heure: '09:00' }, new Date('2026-11-16T03:00:00Z'), 3, 'Indian/Mayotte').map((d) => d.toISOString()), ['2026-11-16T06:00:00.000Z', '2026-11-19T06:00:00.000Z', '2026-11-23T06:00:00.000Z']);
  // Toutes les 2 heures à la minute 30, comptées depuis minuit.
  assert.equal(prochaine({ genre: 'heures', n: 2, minute: 30 }, new Date('2026-11-16T05:00:00Z'), 'Indian/Mayotte')!.toISOString(), '2026-11-16T05:30:00.000Z');
});

test('changement d\'heure : une heure qui n\'existe pas part à la première minute qui existe, une heure double une seule fois', () => {
  // 29/03/2026 : à Paris, 2 h → 3 h. 2 h 30 n'existe pas : 3 h 00 (01:00 UTC).
  assert.equal(prochaine({ genre: 'jour', heure: '02:30' }, new Date('2026-03-28T12:00:00Z'), 'Europe/Paris')!.toISOString(), '2026-03-29T01:00:00.000Z');
  // 25/10/2026 : 3 h → 2 h. 2 h 30 existe deux fois : la première (00:30 UTC), puis le lendemain seulement.
  const a = prochaine({ genre: 'jour', heure: '02:30' }, new Date('2026-10-24T12:00:00Z'), 'Europe/Paris')!;
  assert.equal(a.toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(prochaine({ genre: 'jour', heure: '02:30' }, a, 'Europe/Paris')!.toISOString(), '2026-10-26T01:30:00.000Z');
});

test('mois : le 31 en février tombe le 28 ; une seule fois passée → rien', () => {
  assert.equal(prochaine({ genre: 'mois', jour: 31, heure: '03:00' }, new Date('2027-02-01T12:00:00Z'), 'Europe/Paris')!.toISOString(), '2027-02-28T02:00:00.000Z');
  assert.equal(prochaine({ genre: 'une_fois', date: '2026-11-01', heure: '15:00' }, new Date('2026-11-16T10:00:00Z'), 'Europe/Paris'), undefined);
  assert.equal(prochaine({ genre: 'une_fois', date: '2026-11-18', heure: '15:00' }, new Date('2026-11-16T10:00:00Z'), 'Indian/Mayotte')!.toISOString(), '2026-11-18T12:00:00.000Z');
  assert.equal(prochaine({ genre: 'secondes', n: 10 }, new Date(), 'Europe/Paris'), undefined);
  assert.equal(prochaine({ genre: 'libre', texte: 'x' }, new Date(), 'Europe/Paris'), undefined);
});

test('texteDate : aujourd\'hui, demain, ou le jour en clair', () => {
  const now = new Date('2026-11-16T10:00:00Z');
  assert.equal(texteDate(new Date('2026-11-16T15:30:00Z'), 'Indian/Mayotte', now), 'aujourd\'hui à 18 h 30');
  assert.equal(texteDate(new Date('2026-11-17T04:30:00Z'), 'Indian/Mayotte', now), 'demain à 7 h 30');
  assert.equal(texteDate(new Date('2026-11-24T01:00:00Z'), 'Indian/Mayotte', now), 'mardi 24 novembre à 4 h');
  assert.equal(texteDate(new Date('2027-01-04T01:00:00Z'), 'Indian/Mayotte', now), 'lundi 4 janvier 2027 à 4 h');
});

test('lireRythme : vérifie et remet en forme, refuse le reste en clair', () => {
  assert.deepEqual(lireRythme({ genre: 'jour', heure: '7h30' }), { genre: 'jour', heure: '07:30' });
  assert.deepEqual(lireRythme({ genre: 'semaine', jours: [7, 1, 1], heure: '9:00' }), { genre: 'semaine', jours: [0, 1], heure: '09:00' });
  assert.deepEqual(lireRythme('30 7 * * *'), { genre: 'cron', cron: '30 7 * * *' });
  for (const x of [undefined, {}, { genre: 'jour', heure: '25:00' }, { genre: 'minutes', n: 0 }, { genre: 'minutes', n: 1441 }, { genre: 'heures', n: 25 }, { genre: 'semaine', jours: [], heure: '09:00' }, { genre: 'mois', jour: 32, heure: '03:00' }, { genre: 'une_fois', date: '2026-02-30', heure: '10:00' }, { genre: 'cron', cron: '1 2 3' }, { genre: 'inconnu' }]) {
    assert.equal(lireRythme(x), undefined, JSON.stringify(x));
    const v = verifierRythme(x); assert.ok(!v.ok && v.error.length > 5);
  }
});

test('plan de vérification des ISO et des logiciels : aller et retour', () => {
  for (const p of [{ frequence: 'jour' as const, jour: 1, heure: '04:00' }, { frequence: 'semaine' as const, jour: 1, heure: '05:00' }, { frequence: 'mois' as const, jour: 28, heure: '04:00' }]) assert.deepEqual(versPlanVerif(depuisPlanVerif(p)), p);
  assert.deepEqual(depuisPlanVerif({ frequence: 'mois', jour: 1, heure: '04:00' }), { genre: 'mois', jour: 1, heure: '04:00' });
  assert.equal(versPlanVerif({ genre: 'mois', jour: 31, heure: '04:00' }), undefined, 'le 31 est refusé pour ces vérifications');
  assert.equal(versPlanVerif({ genre: 'semaine', jours: [1, 4], heure: '04:00' }), undefined);
});
