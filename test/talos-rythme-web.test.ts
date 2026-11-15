// Talos, le choix du rythme en clair (src/web/pages/talos-rythme.js) : les champs du sélecteur et le rythme envoyé à
// Odin se répondent exactement, et un rythme impossible est refusé avant d'être envoyé. Le fichier est lu sans
// document, comme dans le navigateur avant que la page soit prête : il ne doit rien toucher à son chargement.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type Rythme = Record<string, unknown>;
interface Logique { versChamps: (r: Rythme) => Rythme; depuisChamps: (c: Rythme) => Rythme; valide: (r: Rythme, permis?: string[]) => string; phrase: (r: Rythme) => string }
function charger(): Logique {
  const win: { OdinRythme?: { logique: Logique } } = {};
  vm.runInNewContext(readFileSync(new URL('../src/web/pages/talos-rythme.js', import.meta.url), 'utf8'), { window: win });
  assert.ok(win.OdinRythme, 'window.OdinRythme est posé');
  return win.OdinRythme.logique;
}
/** Une valeur venue du contexte du fichier, ramenée dans celui de l'essai (les tableaux d'un autre contexte ne se comparent pas tels quels). */
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

test('rythme : aller-retour exact entre le rythme et les champs du sélecteur, pour chaque genre', () => {
  const L = charger();
  const rythmes: Rythme[] = [
    { genre: 'jour', heure: '07:30' },
    { genre: 'semaine', jours: [1, 4], heure: '09:00' },
    { genre: 'semaine', jours: [0, 1, 2, 3, 4, 5, 6], heure: '21:15' },
    { genre: 'mois', jour: 1, heure: '04:00' },
    { genre: 'mois', jour: 31, heure: '03:00' },
    { genre: 'une_fois', date: '2026-11-18', heure: '15:00' },
    { genre: 'minutes', n: 15 },
    { genre: 'heures', n: 2 },
    { genre: 'heures', n: 2, minute: 30 },
    { genre: 'cron', cron: '30 7 * * 1-5' },
  ];
  for (const r of rythmes) {
    const c = L.versChamps(r);
    assert.equal(c.genre, r.genre);
    assert.deepEqual(ici(L.depuisChamps(c)), r, `${JSON.stringify(r)} revient tel quel`);
    assert.equal(L.valide(L.depuisChamps(c)), '', `${JSON.stringify(r)} est valable`);
  }
  // Les jours cochés dans le désordre sont rangés, sans doublon.
  assert.deepEqual(ici(L.depuisChamps({ genre: 'semaine', jours: [4, 1, 4], heure: '09:00' })), { genre: 'semaine', jours: [1, 4], heure: '09:00' });
  // Sans rythme de départ : tous les jours à 7 h 30.
  assert.deepEqual(ici(L.depuisChamps(L.versChamps(undefined as unknown as Rythme))), { genre: 'jour', heure: '07:30' });
});

test('rythme : ce qui est impossible est refusé avec une phrase claire', () => {
  const L = charger();
  const refuses: Rythme[] = [
    { genre: 'jour', heure: '25:00' },
    { genre: 'jour', heure: '7h30' },
    { genre: 'semaine', jours: [], heure: '09:00' },
    { genre: 'semaine', jours: [7], heure: '09:00' },
    { genre: 'mois', jour: 0, heure: '04:00' },
    { genre: 'mois', jour: 32, heure: '04:00' },
    { genre: 'une_fois', date: '2026-02-30', heure: '15:00' },
    { genre: 'minutes', n: 0 },
    { genre: 'minutes', n: 1441 },
    { genre: 'heures', n: 0 },
    { genre: 'heures', n: 25 },
    { genre: 'heures', n: 2, minute: 60 },
    { genre: 'cron', cron: '30 7 * *' },
    { genre: 'inconnu' },
  ];
  for (const r of refuses) { const e = L.valide(r); assert.ok(typeof e === 'string' && e.length > 5, `${JSON.stringify(r)} est refusé (${e})`); }
  // Un genre que la ligne ne permet pas.
  assert.notEqual(L.valide({ genre: 'minutes', n: 5 }, ['jour', 'semaine', 'mois']), '');
  assert.equal(L.valide({ genre: 'mois', jour: 1, heure: '04:00' }, ['jour', 'semaine', 'mois']), '');
});

test('rythme : la phrase écrite en attendant celle d\'Odin a la même forme', () => {
  const L = charger();
  assert.equal(L.phrase({ genre: 'jour', heure: '07:30' }), 'Tous les jours à 7 h 30');
  assert.equal(L.phrase({ genre: 'jour', heure: '00:00' }), 'Tous les jours à minuit');
  assert.equal(L.phrase({ genre: 'jour', heure: '12:00' }), 'Tous les jours à midi');
  assert.equal(L.phrase({ genre: 'semaine', jours: [4, 1], heure: '09:00' }), 'Chaque semaine, le lundi et le jeudi à 9 h');
  assert.equal(L.phrase({ genre: 'semaine', jours: [1, 2, 3, 4, 5], heure: '09:00' }), 'Du lundi au vendredi à 9 h');
  assert.equal(L.phrase({ genre: 'mois', jour: 1, heure: '04:00' }), 'Chaque mois, le 1er à 4 h');
  assert.equal(L.phrase({ genre: 'mois', jour: 31, heure: '03:00' }), 'Chaque mois, le 31 (ou le dernier jour) à 3 h');
  assert.equal(L.phrase({ genre: 'une_fois', date: '2026-11-18', heure: '15:00' }), 'Une seule fois, le mercredi 18 novembre 2026 à 15 h');
  assert.equal(L.phrase({ genre: 'minutes', n: 1 }), 'Chaque minute');
  assert.equal(L.phrase({ genre: 'heures', n: 2, minute: 30 }), 'Toutes les 2 heures, à la minute 30');
  assert.equal(L.phrase({ genre: 'secondes', n: 10 }), 'En continu, toutes les 10 secondes');
  assert.equal(L.phrase({ genre: 'cron', cron: '30 7 * * 1-5' }), 'Planning expert : 30 7 * * 1-5');
});
