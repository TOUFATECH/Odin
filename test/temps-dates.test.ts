// Dates relatives et absolues, durées, jours ouvrés, âge : calculés en règles, dans six langues (français, anglais,
// espagnol, allemand, arabe, swahili). L'instant « maintenant » est fixé : jeudi 19 novembre 2026, 10 h en temps
// universel. Une langue non couverte ne rend rien ; une ambiguïté (« 03/04 », « mardi » sans « prochain ») est dite.
import assert from 'node:assert/strict';
import test from 'node:test';
import { age, ajouterMois, joursEntre, joursOuvres, jourSemaine, repondreTemps } from '../src/langue/temps.ts';

const maintenant = new Date(Date.UTC(2026, 10, 19, 10, 0, 0)); // jeudi
const o = (langue?: string) => ({ maintenant, fuseau: 'Europe/Paris', ...(langue ? { langue } : {}) });
const date = (phrase: string, langue?: string) => {
  const r = repondreTemps(phrase, o(langue));
  assert.ok(r, `pas de réponse pour « ${phrase} »`);
  assert.equal(r.reconnu, true, `non reconnu : « ${phrase} » → ${r.direct}`);
  return r;
};

test('fonctions pures : jours entre deux dates, mois ajoutés (fin de mois), jour de la semaine, âge', () => {
  assert.equal(joursEntre('2026-11-19', '2027-03-03'), 104);
  assert.equal(jourSemaine('2027-03-03'), 3);
  assert.deepEqual(ajouterMois('2027-01-31', 1), { date: '2027-02-28', borne: true });
  assert.deepEqual(ajouterMois('2028-01-31', 1), { date: '2028-02-29', borne: true });
  assert.deepEqual(ajouterMois('2027-01-15', 13), { date: '2028-02-15', borne: false });
  assert.equal(joursOuvres('2027-03-01', '2027-03-12'), 10);
  assert.equal(joursOuvres('2027-03-01', '2027-03-12', [5, 6]), 9); // week-end vendredi-samedi : les 5, 6 et 12 retirés
  assert.deepEqual(age('1990-03-03', '2026-11-19'), { ans: 36, mois: 8, jours: 16 });
  assert.deepEqual(age('2000-11-20', '2026-11-19'), { ans: 25, mois: 11, jours: 30 });
});

test('« dans 3 semaines » dans les six langues, en chiffres et en lettres', () => {
  for (const [p, l] of [
    ['dans 3 semaines', 'fr'], ['dans trois semaines', undefined], ['in 3 weeks', undefined], ['in three weeks', 'en'],
    ['dentro de 3 semanas', undefined], ['dentro de tres semanas', 'es'], ['in 3 Wochen', 'de'], ['in drei Wochen', 'de'],
    ['بعد 3 أسابيع', undefined], ['بعد ثلاثة أسابيع', 'ar'], ['baada ya wiki 3', undefined], ['baada ya wiki tatu', 'sw'],
  ] as const) {
    const r = date(p, l);
    assert.equal(r.donnees?.date, '2026-12-10', p);
    assert.ok(r.conseils.some((c) => c.id === 'ajouter-calendrier') && r.conseils.some((c) => c.id === 'creer-rappel'), p);
  }
  assert.equal(date('بعد أسبوعين').donnees?.date, '2026-12-03'); // le duel arabe : deux semaines
});

test('« il y a 3 jours », hier, demain, après-demain', () => {
  for (const [p, l] of [['il y a 3 jours', undefined], ['3 days ago', undefined], ['hace 3 días', undefined], ['vor 3 Tagen', 'de'], ['قبل 3 أيام', undefined], ['siku 3 zilizopita', undefined]] as const) {
    assert.equal(date(p, l).donnees?.date, '2026-11-16', p);
  }
  for (const [p, d] of [['demain', '2026-11-20'], ['kesho', '2026-11-20'], ['غدا', '2026-11-20'], ['übermorgen', '2026-11-21'], ['yesterday', '2026-11-18'], ['anteayer', '2026-11-17'], ['après-demain', '2026-11-21']]) {
    assert.equal(date(p).donnees?.date, d, p);
  }
});

test('« mardi prochain » dans les six langues ; « samedi prochain » dans la même semaine est dit ambigu', () => {
  for (const [p, l] of [['mardi prochain', undefined], ['next Tuesday', undefined], ['el próximo martes', undefined], ['nächsten Dienstag', undefined], ['الثلاثاء القادم', undefined], ['Jumanne ijayo', undefined]] as const) {
    const r = date(p, l);
    assert.equal(r.donnees?.date, '2026-11-24', p);
    assert.equal(r.donnees?.autre, undefined, p);
  }
  const s = date('samedi prochain');
  assert.equal(s.donnees?.date, '2026-11-21');
  assert.equal(s.donnees?.autre, '2026-11-28');
  assert.ok(s.pasSur.some((x) => x.includes('28 novembre')), s.pasSur.join(' | '));
});

test('« mardi » sans « prochain » : le prochain est pris, et l\'autre lecture est dite', () => {
  const r = date('rendez-vous mardi');
  assert.equal(r.donnees?.date, '2026-11-24');
  assert.equal(r.donnees?.autre, '2026-11-17');
  assert.ok(r.pasSur.some((x) => x.includes('17 novembre')), r.pasSur.join(' | '));
  const d = date('mardi dernier');
  assert.equal(d.donnees?.date, '2026-11-17');
});

test('jusqu\'à une date, jour de la semaine, entre deux dates, jours ouvrés', () => {
  const j = date("combien de jours jusqu'au 3 mars");
  assert.equal(j.donnees?.date, '2027-03-03');
  assert.equal(j.donnees?.jours, 104);
  assert.ok(j.pasSur.some((x) => x.includes('2027')), 'année supposée dite');
  assert.equal(date('how many days until March 3, 2027').donnees?.jours, 104);
  assert.equal(date('cuántos días faltan para el 3 de marzo de 2027').donnees?.jours, 104);
  assert.equal(date('wie viele Tage bis zum 3. März 2027').donnees?.jours, 104);
  assert.equal(date('كم يوما حتى 3 مارس 2027').donnees?.jours, 104);
  assert.equal(date('siku ngapi hadi tarehe 3 Machi 2027').donnees?.jours, 104);

  const w = date('quel jour tombe le 3 mars 2027');
  assert.equal(w.donnees?.jourSemaine, 3);
  assert.match(w.direct, /mercredi/);
  assert.match(date('what day is March 3, 2027').direct, /Wednesday/);

  const e = date('combien de jours entre le 1er mars 2027 et le 15 mars 2027');
  assert.equal(e.donnees?.jours, 14);
  const ou = date('combien de jours ouvrés entre le 1er mars 2027 et le 12 mars 2027');
  assert.equal(ou.donnees?.joursOuvres, 10);
  assert.ok(ou.pasSur.length >= 1, 'jours fériés non retirés : dit');
  assert.equal(date('working days between March 1, 2027 and March 12, 2027').donnees?.joursOuvres, 10);
});

test('« 03/04/2027 » : jour/mois ou mois/jour, l\'ambiguïté est dite (pas tranchée en silence)', () => {
  const fr = date('quel jour tombe le 03/04/2027');
  assert.equal(fr.donnees?.date, '2027-04-03');
  assert.ok(fr.pasSur.some((x) => x.includes('4 mars')), fr.pasSur.join(' | '));
  const en = date('what day is 03/04/2027');
  assert.equal(en.donnees?.date, '2027-03-04');
  assert.ok(en.pasSur.some((x) => x.includes('April 3')), en.pasSur.join(' | '));
  const net = date('quel jour tombe le 13/04/2027');
  assert.equal(net.donnees?.date, '2027-04-13');
  assert.ok(!net.pasSur.some((x) => /13 avril|avril 13/.test(x) && /aussi/.test(x)));
});

test('âge à partir d\'une date de naissance', () => {
  const r = date('quel âge a une personne née le 3 mars 1990');
  assert.equal(r.donnees?.ans, 36);
  assert.equal(date('how old is someone born on March 3, 1990').donnees?.ans, 36);
  assert.equal(date('Alter, geboren am 3. März 1990').donnees?.ans, 36);
});

test('fin de mois, sans fuseau, bornes, langues non couvertes, phrases hors sujet', () => {
  const fm = repondreTemps('dans 1 mois', { maintenant: new Date(Date.UTC(2027, 0, 31, 12)), fuseau: 'UTC', langue: 'fr' });
  assert.equal(fm?.donnees?.date, '2027-02-28');
  assert.ok(fm?.pasSur.length);
  const sf = repondreTemps('demain', { maintenant, langue: 'fr' });
  assert.equal(sf?.donnees?.date, '2026-11-20');
  assert.ok(sf?.pasSur.some((x) => x.includes('UTC')));
  const loin = repondreTemps('dans 100000 ans', o('fr'));
  assert.equal(loin?.reconnu, false);
  assert.equal(repondreTemps('demain', o('it')), undefined);
  assert.equal(repondreTemps('domani', o()), undefined);
  assert.equal(repondreTemps('allume la lumière du salon', o()), undefined);
  assert.equal(repondreTemps('x'.repeat(2000), o('fr')), undefined);
});

test('une durée en plusieurs parties est additionnée, jamais coupée sans le dire', () => {
  assert.equal(date('dans 3 semaines et 2 jours', 'fr').donnees?.date, '2026-12-12');
  assert.equal(date('in 3 weeks and 2 days', 'en').donnees?.date, '2026-12-12');
  assert.equal(date('dentro de 1 mes y 2 días', 'es').donnees?.date, '2026-12-21');
  assert.equal(date('in 2 Wochen und 1 Tag', 'de').donnees?.date, '2026-12-04');
  assert.equal(date('بعد أسبوعين ويومين', 'ar').donnees?.date, '2026-12-05');
  assert.equal(date('baada ya wiki 2 na siku 1', 'sw').donnees?.date, '2026-12-04');
  assert.equal(date('il y a 1 an et 2 mois', 'fr').donnees?.date, '2025-09-19');
  // Des jours et des heures mêlés, ou « et demi » : pas de réponse devinée.
  assert.equal(repondreTemps('dans 2 jours et 3 heures', o('fr')), undefined);
  assert.equal(repondreTemps('dans un an et demi', o('fr')), undefined);
  assert.equal(repondreTemps('in a year and a half', o('en')), undefined);
});

test('un jour de la semaine qui ne va pas avec la date est dit', () => {
  const v = date('vendredi 13', 'fr');
  assert.equal(v.donnees?.date, '2027-08-13'); // le prochain vendredi 13 ; le 13 décembre 2026 est un dimanche
  assert.ok(v.pasSur.some((x) => x.includes('13 décembre 2026') && x.includes('dimanche')), v.pasSur.join(' | '));
  assert.equal(date('Friday the 13th', 'en').donnees?.date, '2027-08-13');
  assert.equal(date('vendredi 20', 'fr').donnees?.date, '2026-11-20');
  const m = date('mardi 2 décembre 2026', 'fr');
  assert.equal(m.donnees?.date, '2026-12-02');
  assert.ok(m.pasSur.some((x) => x.includes('mardi') && x.includes('mercredi')), m.pasSur.join(' | '));
  assert.equal(date('quel jour tombe le samedi 5 décembre 2026', 'fr').pasSur.some((x) => x.includes('samedi')), false);
});

test("l'autre lecture d'une date sans année est elle aussi à venir ; l'anglais britannique lit jour/mois", () => {
  const r = date('03/12', 'fr');
  assert.equal(r.donnees?.date, '2026-12-03');
  assert.equal(r.donnees?.autre, '2027-03-12');
  const gb = date('03/04', 'en-GB');
  assert.equal(gb.donnees?.date, '2027-04-03');
  assert.equal(gb.donnees?.autre, '2027-03-04');
  assert.equal(date('03/04', 'en').donnees?.date, '2027-03-04');
  assert.equal(date('03/04', 'en-US').donnees?.date, '2027-03-04');
});

test('pas de calendrier ni de rappel proposés pour une date passée', () => {
  assert.deepEqual(date('il y a 3 jours', 'fr').conseils, []);
  assert.deepEqual(date('quel jour tombe le 4 juillet 1776', 'fr').conseils, []);
  assert.deepEqual(date('3 hours ago', 'en').conseils, []);
  assert.deepEqual(date('hier', 'fr').conseils, []);
  assert.equal(date('dans 3 jours', 'fr').conseils.length, 2);
  assert.equal(date('in 3 hours', 'en').conseils.length, 2);
});
