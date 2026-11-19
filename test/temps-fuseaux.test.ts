// L'heure ailleurs, le décalage et les changements d'heure, calculés par la base des fuseaux de Node (Intl). Fuseaux
// d'exemple du monde entier ; années avec et sans heure d'été ; dates des changements recalculées ici par leur règle
// (dernier dimanche de mars…) et comparées à ce que le module trouve ; fuseaux à demi-heure et à trois quarts d'heure ;
// phrases en français, anglais, espagnol, allemand, arabe et swahili ; un lieu inconnu est dit, jamais deviné.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  changementsHeure, decalage, decalageUtc, fuseauValide, fuseauxConnus, heureAilleurs, periodesEcart, repondreHeure, texteUtc, trouverLieux,
} from '../src/langue/temps-fuseaux.ts';

/** Le n-ième dimanche (n ≥ 1) d'un mois, ou le dernier (n = -1), en date UTC. */
function dimanche(annee: number, mois: number, n: number): number {
  if (n > 0) { const j = new Date(Date.UTC(annee, mois - 1, 1)).getUTCDay(); return 1 + ((7 - j) % 7) + 7 * (n - 1); }
  const der = new Date(Date.UTC(annee, mois, 0)); return der.getUTCDate() - der.getUTCDay();
}

test('Europe : les changements tombent le dernier dimanche de mars et d\'octobre à 1 h UTC, de 2024 à 2030', () => {
  for (let a = 2024; a <= 2030; a++) {
    const cs = changementsHeure(a, 'Europe/Paris');
    assert.equal(cs.length, 2, `année ${a}`);
    assert.equal(cs[0].instant.toISOString(), new Date(Date.UTC(a, 2, dimanche(a, 3, -1), 1)).toISOString());
    assert.equal(cs[1].instant.toISOString(), new Date(Date.UTC(a, 9, dimanche(a, 10, -1), 1)).toISOString());
    assert.deepEqual([cs[0].avant, cs[0].apres, cs[0].murAvant, cs[0].murApres], [60, 120, '02:00', '03:00']);
    assert.deepEqual([cs[1].avant, cs[1].apres, cs[1].murAvant, cs[1].murApres], [120, 60, '03:00', '02:00']);
  }
});

test('Amérique du Nord : deuxième dimanche de mars et premier dimanche de novembre, à 2 h locale', () => {
  for (const a of [2025, 2026, 2027]) {
    const cs = changementsHeure(a, 'America/New_York');
    assert.equal(cs.length, 2);
    assert.equal(cs[0].instant.toISOString(), new Date(Date.UTC(a, 2, dimanche(a, 3, 2), 7)).toISOString());
    assert.equal(cs[1].instant.toISOString(), new Date(Date.UTC(a, 10, dimanche(a, 11, 1), 6)).toISOString());
    assert.equal(cs[0].date, `${a}-03-${String(dimanche(a, 3, 2)).padStart(2, '0')}`);
  }
});

test('années avec et sans heure d\'été : Brésil 2018 / 2020, Russie 2010 / 2012, Japon jamais', () => {
  const sp18 = changementsHeure(2018, 'America/Sao_Paulo');
  assert.equal(sp18.length, 2);
  assert.deepEqual(sp18.map((c) => [c.avant, c.apres]), [[-120, -180], [-180, -120]]);
  assert.equal(changementsHeure(2020, 'America/Sao_Paulo').length, 0);
  assert.equal(changementsHeure(2010, 'Europe/Moscow').length, 2);
  assert.equal(changementsHeure(2012, 'Europe/Moscow').length, 0);
  assert.equal(changementsHeure(2026, 'Asia/Tokyo').length, 0);
});

test('hémisphère sud : Sydney recule en avril et avance en octobre', () => {
  const cs = changementsHeure(2026, 'Australia/Sydney');
  assert.deepEqual(cs.map((c) => [c.date.slice(5, 7), c.avant, c.apres]), [['04', 660, 600], ['10', 600, 660]]);
  assert.equal(cs[0].date, `2026-04-${String(dimanche(2026, 4, 1)).padStart(2, '0')}`);
  assert.equal(cs[1].date, `2026-10-${String(dimanche(2026, 10, 1)).padStart(2, '0')}`);
});

test('fuseaux à demi-heure et à trois quarts d\'heure, et un changement d\'une demi-heure', () => {
  const hiver = Date.UTC(2026, 0, 15, 12), ete = Date.UTC(2026, 6, 15, 12);
  assert.equal(decalageUtc(hiver, 'Asia/Kolkata'), 330);
  assert.equal(decalageUtc(hiver, 'Asia/Kathmandu'), 345);
  assert.equal(decalageUtc(hiver, 'Asia/Tehran'), 210);
  assert.equal(decalageUtc(hiver, 'Pacific/Marquesas'), -570);
  assert.deepEqual([decalageUtc(hiver, 'Australia/Adelaide'), decalageUtc(ete, 'Australia/Adelaide')], [630, 570]);
  assert.deepEqual([decalageUtc(hiver, 'America/St_Johns'), decalageUtc(ete, 'America/St_Johns')], [-210, -150]);
  assert.deepEqual([decalageUtc(hiver, 'Pacific/Chatham'), decalageUtc(ete, 'Pacific/Chatham')], [825, 765]);
  assert.deepEqual(changementsHeure(2026, 'Pacific/Chatham').map((c) => [c.avant, c.apres]), [[825, 765], [765, 825]]);
  // Lord Howe ne change que d'une demi-heure.
  assert.deepEqual(changementsHeure(2026, 'Australia/Lord_Howe').map((c) => c.apres - c.avant), [-30, 30]);
  assert.equal(texteUtc(345), 'UTC+5:45');
  assert.equal(texteUtc(-210), 'UTC-3:30');
  assert.equal(texteUtc(0), 'UTC');
});

test('l\'heure ailleurs et le décalage, jour suivant compris', () => {
  const t = new Date(Date.UTC(2026, 0, 15, 10, 32));
  assert.deepEqual(heureAilleurs(t, 'Asia/Tokyo'), { fuseau: 'Asia/Tokyo', date: '2026-01-15', heure: '19:32', utcMinutes: 540 });
  assert.equal(heureAilleurs(t, 'Asia/Kathmandu').heure, '16:17');
  assert.equal(heureAilleurs(Date.UTC(2026, 0, 15, 23), 'Pacific/Kiritimati').date, '2026-01-16');
  assert.equal(decalage(t, 'Europe/Paris', 'America/New_York'), -360);
  assert.equal(decalage(Date.UTC(2026, 2, 20, 12), 'America/New_York', 'Europe/Paris'), 300);
  // L'écart entre New York et Paris change quatre fois en 2026 (les deux ne changent pas le même jour).
  assert.deepEqual(periodesEcart(2026, 'America/New_York', 'Europe/Paris').map((p) => p.ecart), [360, 300, 360, 300, 360]);
  assert.deepEqual(periodesEcart(2026, 'Europe/Paris', 'Europe/Berlin').map((p) => p.ecart), [0]);
});

test('tous les fuseaux de la liste sont connus de la base ; un fuseau ou une année absurde est refusé', () => {
  for (const f of fuseauxConnus()) assert.ok(fuseauValide(f), f);
  assert.equal(fuseauValide('Lune/Base'), false);
  assert.throws(() => changementsHeure(2026, 'Lune/Base'), RangeError);
  assert.throws(() => changementsHeure(1500, 'Europe/Paris'), RangeError);
});

const hiver = new Date(Date.UTC(2026, 0, 15, 10, 32));

test('français : l\'heure là-bas, l\'écart avec ici, les points de l\'année et la suite proposée', () => {
  const r = repondreHeure('Quelle heure est-il à Tokyo ?', { maintenant: hiver, fuseauIci: 'Europe/Paris' })!;
  assert.equal(r.reconnu, true);
  assert.equal(r.langue, 'fr');
  assert.match(r.direct, /là-bas \(Tokyo, jeudi 15 janvier\), 8\sheures de plus qu'ici\./);
  assert.equal(r.donnees!.ecartMinutes, 480);
  assert.ok(r.points.some((p) => /Tokyo : pas de changement d'heure en 2026 \(UTC\+9\)/.test(p)), r.points.join('\n'));
  assert.ok(r.points.some((p) => /^ici : changement d'heure le 29 mars/.test(p)), r.points.join('\n'));
  assert.deepEqual(r.conseils.map((c) => [c.id, c.libelle]), [['convertir-heure', 'Convertir une autre heure'], ['planifier-appel', 'Planifier un appel']]);
  assert.equal(r.calcul!.par, 'Intl');
  assert.match(r.calcul!.texte, /base des fuseaux/);
});

test('anglais, espagnol, allemand, arabe, swahili', () => {
  const en = repondreHeure('What time is it in New York?', { maintenant: hiver, fuseauIci: 'Europe/Paris' })!;
  assert.equal(en.langue, 'en');
  assert.match(en.direct, /6 hours behind here/);
  const es = repondreHeure('¿Qué hora es en Tokio?', { maintenant: hiver, fuseauIci: 'Europe/Madrid' })!;
  assert.equal(es.langue, 'es');
  assert.equal(es.lieux[0].fuseau, 'Asia/Tokyo');
  assert.match(es.direct, /8 horas más que aquí/);
  const de = repondreHeure('Wie spät ist es in Kathmandu?', { maintenant: hiver, fuseauIci: 'Europe/Berlin' })!;
  assert.equal(de.langue, 'de');
  assert.equal(de.donnees!.ecartMinutes, 285);
  assert.match(de.direct, /4 Stunden.*45 Minuten später als hier/);
  const ar = repondreHeure('كم الساعة بطوكيو؟', { maintenant: hiver, fuseauIci: 'Africa/Cairo' })!;
  assert.equal(ar.langue, 'ar');
  assert.equal(ar.lieux[0].nom, 'طوكيو');
  assert.equal(ar.donnees!.ecartMinutes, 420);
  const sw = repondreHeure('Ni saa ngapi Lagos sasa?', { maintenant: hiver, fuseauIci: 'Africa/Nairobi' })!;
  assert.equal(sw.langue, 'sw');
  assert.equal(sw.lieux[0].fuseau, 'Africa/Lagos');
  assert.match(sw.direct, /nyuma ya hapa/);
  assert.equal(sw.conseils[1].libelle, 'Panga simu');
  // Une langue sans textes ici : l'anglais.
  assert.equal(repondreHeure('Tokyo time', { maintenant: hiver, langue: 'swb' })!.langue, 'en');
});

test('deux lieux nommés, année écrite : les périodes d\'écart de cette année-là', () => {
  const r = repondreHeure('Décalage horaire entre New York et Paris en 2027', { maintenant: hiver })!;
  assert.equal(r.annee, 2027);
  assert.deepEqual(r.lieux.map((l) => l.fuseau), ['America/New_York', 'Europe/Paris']);
  assert.match(r.direct, /Paris a 6\sheures d'avance/);
  assert.equal(r.points.filter((p) => /^Du /.test(p)).length, 5);
  assert.ok(r.points.some((p) => p.startsWith(`Paris : changement d'heure le ${dimanche(2027, 3, -1)} mars`)), r.points.join('\n'));
});

test('sans fuseau d\'ici : l\'heure là-bas et son décalage UTC', () => {
  const r = repondreHeure('What time is it in Mumbai?', { maintenant: hiver })!;
  assert.match(r.direct, /4:02\s?PM there \(Mumbai, Thursday, January 15\), UTC\+5:30\./);
});

test('un lieu inconnu est dit, jamais deviné', () => {
  const r = repondreHeure('Quelle heure est-il à Zorblax ?', { maintenant: hiver, fuseauIci: 'Europe/Paris' })!;
  assert.equal(r.reconnu, false);
  assert.deepEqual(r.inconnus, ['Zorblax']);
  assert.match(r.direct, /Je ne connais pas ce lieu : « Zorblax »/);
  assert.equal(r.points.length, 0);
  const deux = repondreHeure('Décalage entre Paris et Zorblax', { maintenant: hiver })!;
  assert.equal(deux.reconnu, false);
  assert.deepEqual(deux.inconnus, ['Zorblax']);
  assert.match(repondreHeure('What time is it in Narnia?', { maintenant: hiver })!.direct, /I don’t know this place: “Narnia”/);
});

test('un pays à plusieurs fuseaux : celui de la capitale, et c\'est dit', () => {
  const r = repondreHeure('Quelle heure est-il aux États-Unis ?', { maintenant: hiver, fuseauIci: 'Europe/Paris' })!;
  assert.equal(r.lieux[0].fuseau, 'America/New_York');
  assert.match(r.pasSur[0], /plusieurs fuseaux : j'ai pris celui de la capitale/);
  const sw = repondreHeure('Ni saa ngapi Marekani?', { maintenant: hiver })!;
  assert.equal(sw.lieux[0].sorte, 'pays');
  assert.equal(sw.pasSur.length, 1);
});

test('identifiants de fuseau, décalages UTC, ville et son pays', () => {
  assert.equal(trouverLieux('heure à Asia/Kathmandu').lieux[0].fuseau, 'Asia/Kathmandu');
  assert.equal(trouverLieux('time at UTC+5:30').lieux[0].fuseau, '+05:30');
  assert.equal(trouverLieux('Quelle heure à Tokyo au Japon ?').lieux.length, 1);
  assert.deepEqual(trouverLieux('Hora en Ciudad de México y Buenos Aires').lieux.map((l) => l.fuseau), ['America/Mexico_City', 'America/Argentina/Buenos_Aires']);
});

test('ce qui n\'est pas une question d\'heure ailleurs n\'est pas pris', () => {
  assert.equal(repondreHeure('Je pars à Tokyo demain', { maintenant: hiver }), undefined);
  assert.equal(repondreHeure('Quelle heure est-il ?', { maintenant: hiver, fuseauIci: 'Europe/Paris' }), undefined);
  assert.equal(repondreHeure('', { maintenant: hiver }), undefined);
});

test('un mot courant après « in », « und », « في » n\'est pas pris pour un lieu inconnu', () => {
  const ici = { maintenant: hiver, fuseauIci: 'Europe/Paris' };
  const cas: Array<[string, string[]]> = [
    ['What time is it in Tokyo and I want to call', ['Asia/Tokyo']],
    ['Time difference between London and New York in Summer?', ['Europe/London', 'America/New_York']],
    ['Wie spät ist es in Tokio und Zeit in Berlin', ['Asia/Tokyo', 'Europe/Berlin']],
    ['كم الساعة في مدينة طوكيو', ['Asia/Tokyo']],
    ['What time is it in Central London?', ['Europe/London']],
  ];
  for (const [p, fuseaux] of cas) {
    const r = repondreHeure(p, ici)!;
    assert.deepEqual(r.inconnus, [], p);
    assert.equal(r.reconnu, true, p);
    assert.deepEqual(r.lieux.map((l) => l.fuseau), fuseaux, p);
  }
  // Le vrai nom inconnu reste dit, même derrière « مدينة » ou « Stadt ».
  assert.deepEqual(repondreHeure('كم الساعة في مدينة زوربلاكس', ici)!.inconnus, ['زوربلاكس']);
  assert.deepEqual(repondreHeure('Wie spät ist es in der Stadt Zorblax?', ici)!.inconnus, ['Zorblax']);
});

test('une heure écrite dans la question n\'est pas convertie : c\'est dit, dans chaque langue', () => {
  const ici = { maintenant: hiver, fuseauIci: 'Europe/Paris' };
  for (const p of ['Quelle heure à Tokyo quand il est 9 h ici ?', 'What time is it in Tokyo at 9am here?', 'Wie spät ist es in Tokio, wenn es hier 21 Uhr ist?', '¿Qué hora es en Tokio a las 9 aquí?', 'كم الساعة في طوكيو عندما تكون الساعة 9 هنا؟', 'Ni saa ngapi Tokyo ikiwa hapa ni saa 3?', 'Heure à Tokyo quand il est 21:15 ici ?']) {
    const r = repondreHeure(p, ici)!;
    assert.equal(r.reconnu, true, p);
    assert.ok(r.heureEcrite, p);
    assert.equal(r.pasSur.length, 1, p);
  }
  assert.match(repondreHeure('Quelle heure à Tokyo quand il est 9 h ici ?', ici)!.pasSur[0], /« 9 h ».*pas encore convertie/);
  // Un décalage écrit (UTC+5:30) ou une durée n'est pas une heure écrite.
  assert.equal(repondreHeure('What time is it at UTC+5:30?', ici)!.heureEcrite, undefined);
  assert.equal(repondreHeure('Quelle heure est-il à Tokyo ?', ici)!.pasSur.length, 0);
});

test('Etc/GMT+5 est un seul fuseau (UTC-5) ; « Chatham » seul et « the turkey » ne sont pas devinés', () => {
  const etc = trouverLieux('heure à Etc/GMT+5').lieux;
  assert.deepEqual(etc.map((l) => l.fuseau), ['Etc/GMT+5']);
  assert.equal(decalageUtc(hiver, etc[0].fuseau), -300);
  assert.deepEqual(trouverLieux('What time is it in Chatham?').lieux, []);
  assert.equal(trouverLieux('heure aux îles Chatham').lieux[0].fuseau, 'Pacific/Chatham');
  assert.equal(repondreHeure('What time should I put the turkey in the oven?', { maintenant: hiver }), undefined);
  assert.deepEqual(trouverLieux('What time is it in Turkey?').lieux.map((l) => l.fuseau), ['Europe/Istanbul']);
  assert.deepEqual(trouverLieux('what time is it in turkey').lieux.map((l) => l.fuseau), ['Europe/Istanbul']);
  assert.deepEqual(trouverLieux('quelle heure à paris').lieux.map((l) => l.fuseau), ['Europe/Paris']);
});

test('un nombre comme 1900 n\'est l\'année que s\'il est dit comme une année ; une date invalide ne fait pas lever', () => {
  assert.equal(repondreHeure('meet at 1900 in Tokyo, what time is that?', { maintenant: hiver })!.annee, 2026);
  assert.equal(repondreHeure('Time difference London Tokyo in 2027', { maintenant: hiver })!.annee, 2027);
  assert.equal(repondreHeure('Zeitunterschied Berlin Tokio im Jahr 2028', { maintenant: hiver })!.annee, 2028);
  assert.equal(repondreHeure('فرق التوقيت بين لندن وطوكيو عام 2027', { maintenant: hiver })!.annee, 2027);
  assert.equal(repondreHeure('What time is it in Tokyo?', { maintenant: new Date('pas une date') }), undefined);
});
