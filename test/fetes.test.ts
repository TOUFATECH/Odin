// Événements de l'année, couleurs automatiques d'Odin, clics et pouvoirs (réglages) : calculs purs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { easter, eventsOn, hijri, inRamadan, todayEvent, upcoming } from '../src/valhalla/fetes.ts';
import { cleanClicks, cleanEvents, cleanPowers, odinColor, POWERS, powerForWeather } from '../src/valhalla/modules/apparence.ts';

test('Pâques par le comput', () => {
  assert.equal(easter(2026), '2026-04-05');
  assert.equal(easter(2027), '2027-03-28');
  assert.equal(easter(2024), '2024-03-31');
});

test('calendrier musulman : Ramadan et les deux Aïd', () => {
  assert.equal(hijri('2026-02-18').month, 9);
  assert.ok(inRamadan('2026-03-01'));
  assert.ok(!inRamadan('2026-04-01'));
  assert.ok(eventsOn('2026-03-20').some((e) => e.id === 'aidfitr'));
  assert.ok(eventsOn('2026-05-27').some((e) => e.id === 'aidkebir'));
  // L'annonce officielle diffère d'un jour : on décale
  assert.ok(eventsOn('2026-03-21', { decalageHijri: 1 }).some((e) => e.id === 'aidfitr'));
});

test('événement du jour : réglages, pause, tout couper, Ramadan seul', () => {
  assert.equal(todayEvent('2026-12-25')?.id, 'noel');
  assert.equal(todayEvent('2026-12-25')?.accessory, 'bonnet');
  assert.equal(todayEvent('2026-05-01')?.color, '#2a2f3a');
  assert.equal(todayEvent('2026-12-25', { choix: { noel: false } }), undefined);
  assert.equal(todayEvent('2026-12-25', { pauses: ['2026-12-25'] }), undefined);
  assert.equal(todayEvent('2026-12-25', { actif: false }), undefined);
  // Saint-Valentin coupée par défaut, activable
  assert.equal(todayEvent('2026-02-14'), undefined);
  assert.equal(todayEvent('2026-02-14', { choix: { valentin: true } })?.id, 'valentin');
  // 14 février 2027 tombe pendant le Ramadan : les autres événements sont coupés (sauf réglage contraire)
  assert.ok(inRamadan('2027-02-14'));
  assert.equal(todayEvent('2027-02-14', { choix: { valentin: true } })?.id, 'ramadan');
  assert.equal(todayEvent('2027-02-14', { choix: { valentin: true }, ramadanSeul: false })?.id, 'valentin');
  // Anniversaires
  assert.equal(todayEvent('2026-08-03', { anniversaire: '08-03' })?.id, 'anniversaire');
  assert.match(todayEvent('2026-09-10', { famille: [{ nom: 'Mina', date: '09-10' }] })?.says ?? '', /Mina/);
  // Carnaval : 47 jours avant Pâques (coupé par défaut)
  assert.ok(eventsOn('2026-02-17').some((e) => e.id === 'carnaval'));
});

test('prochains événements : une ligne par fête', () => {
  const l = upcoming('2026-11-12', 366, {});
  assert.equal(l.filter((e) => e.id === 'noel').length, 1);
  assert.equal(l.filter((e) => e.id === 'ramadan').length, 1);
  assert.ok(l.find((e) => e.id === 'paques')?.date === '2027-03-28');
  assert.equal(l.find((e) => e.id === 'halloween')?.on, false);
});

test('couleur d\'Odin en automatique : marée, vent, nuit, chaud, froid', () => {
  assert.equal(odinColor(14, { code: 63, temp: 27 }, true)?.color, '#16306b');
  assert.equal(odinColor(14, { code: 0, temp: 27, wind: 50 })?.color, '#f2f6fa');
  assert.equal(odinColor(23, { code: 0, temp: 27 })?.color, '#f4d35e');
  assert.equal(odinColor(13, { code: 0, temp: 33 })?.color, '#ffd23a');
  assert.equal(odinColor(13, { code: 0, temp: 18 })?.color, '#5b8fd9');
  assert.equal(odinColor(13, { code: 0, temp: 26 }), undefined);
  assert.equal(powerForWeather({ code: 95 }), 'foudre');
  assert.equal(powerForWeather({ code: 0, temp: 34 }), 'feu');
});

test('réglages nettoyés : clics, pouvoirs, événements', () => {
  const c = cleanClicks({ 3: 'rire', 10: 'rien', 25: 'cacher', 6: 'piratage' });
  assert.equal(c[3], 'rire'); assert.equal(c[10], undefined); assert.equal(c[25], undefined); assert.equal(c[6], undefined); assert.equal(c[20], 'redemarrer');
  const p = cleanPowers({ actif: true, favoris: ['feu', 'inconnu'], choix: 'meteo', quand: { clic: true } });
  assert.deepEqual(p.favoris, ['feu']); assert.equal(p.choix, 'meteo'); assert.equal(p.quand.clic, true); assert.equal(p.quand.ferme, true);
  assert.equal(cleanPowers({}).actif, false, 'désactivés au départ');
  assert.equal(Object.keys(POWERS).length, 38);
  const e = cleanEvents({ choix: { noel: false, faux: true }, pauses: ['2026-12-24', 'x'], anniversaire: '13-40', decalageHijri: 9 });
  assert.deepEqual(e.choix, { noel: false }); assert.deepEqual(e.pauses, ['2026-12-24']); assert.equal(e.anniversaire, undefined); assert.equal(e.decalageHijri, 2);
});

test('la fenêtre d\'Odin : pages rangées, nettoyées, jamais d\'appli inventée', async () => {
  const { cleanLayout, defaultLayout } = await import('../src/valhalla/modules/gladsheim.ts');
  const ids = ['vidarr', 'ran', 'vordr', 'ullr', 'ymir', 'naglfar', 'midgard'];
  const d = defaultLayout(ids);
  assert.deepEqual(d.pages.map((p) => p.name), ['Maison', 'Réseau', 'Sécurité', 'Machines']);
  assert.ok(d.pages[0].maison && d.pages[0].widgets[0].kind === 'meteo');
  const l = cleanLayout({ pages: [{ id: 'zz', name: 'Ma\u0000 page très très longue qui déborde', maison: 1, widgets: [
    { kind: 'chiffres', module: 'vidarr', w: 9 }, { kind: 'chiffres', module: 'inventee' }, { kind: 'section', module: 'ran' }, { kind: 'section', module: 'ran', section: 'Flux en direct' },
    { kind: 'bouton', module: 'vidarr', action: 'bloquer', input: { quoi: 'youtube', 'mauvaise clé!': 'x' }, label: 'Bloquer YouTube' }, { kind: 'script', module: 'vidarr' }, { kind: 'meteo' }] }] }, ids);
  const p = l.pages[0];
  assert.equal(p.name.length <= 24 && !/\u0000/.test(p.name), true); assert.equal(p.maison, true);
  assert.deepEqual(p.widgets.map((w) => `${w.kind}:${w.module ?? ''}:${w.w}`), ['chiffres:vidarr:1', 'section:ran:1', 'bouton:vidarr:1', 'meteo::1']);
  assert.deepEqual(p.widgets[2].input, { quoi: 'youtube' });
  assert.throws(() => cleanLayout({ pages: [] }, ids), /au moins une page/);
  assert.equal(cleanLayout({ pages: Array.from({ length: 20 }, () => ({ name: 'x', widgets: [] })) }, ids).pages.length, 8);
});
