import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel } from '../src/bifrost/channel.ts';
import { buttonsFor, buttonText } from '../src/bifrost/channel.ts';
import { alarmTime, alarmTool, dayKind, DEFAULT_ALARM, getAlarm, twiml, twilioCall, wakeText } from '../src/home/alarm.ts';
import { makeOdin } from './helpers.ts';

const kvOf = () => { const m = new Map<string, string>(); return { getKv: (k: string) => m.get(k), setKv: (k: string, v: string) => { m.set(k, v); } }; };
const web = (sent: Array<{ t: string; o?: unknown }>): Channel => ({ name: 'web', interactive: true, defaultPeer: 'principal', start: async () => {}, stop: async () => {}, send: async (_p, t, o) => { sent.push({ t, o }); } });

test('réveil : 3 h les jours de travail, 4 h en repos et en vacances (déclarées ou dans l\'agenda)', () => {
  const a = { ...DEFAULT_ALARM, enabled: true };
  const lundi = new Date(2026, 10, 9, 12), samedi = new Date(2026, 10, 14, 12);
  assert.equal(dayKind(a, lundi), 'travail');
  assert.equal(dayKind(a, samedi), 'repos');
  assert.equal(alarmTime(a, lundi)!.at.getHours(), 3);
  assert.equal(alarmTime(a, samedi)!.at.getHours(), 4);
  const vac = { ...a, vacations: [{ from: '2026-11-09', to: '2026-11-13' }] };
  assert.deepEqual([dayKind(vac, lundi), alarmTime(vac, lundi)!.at.getHours()], ['vacances', 4]);
  const ag = [{ start: new Date(2026, 10, 9).getTime(), end: new Date(2026, 10, 10).getTime(), title: 'Congés', allDay: true }];
  assert.equal(dayKind(a, lundi, ag), 'vacances');
  assert.equal(alarmTime({ ...a, skip: ['2026-11-09'] }, lundi), undefined);
  assert.equal(alarmTime({ ...a, off: '' }, samedi), undefined);
  assert.equal(alarmTime({ ...a, enabled: false }, lundi), undefined);
});

test('réveil : réglé en parlant, jours et vacances compris', async () => {
  const kv = kvOf(), ctx = { muninn: kv } as never;
  const r = await alarmTool.run({ action: 'regler', travail: '3h', repos: '4h30', jours: 'lun,mar,mer,jeu,sam' }, ctx);
  assert.match(String(r), /03:00 les jours de travail \(lun, mar, mer, jeu, sam\), 04:30 les jours de repos/);
  await alarmTool.run({ action: 'vacances', du: '2026-12-20', au: '2026-12-31' }, ctx);
  await alarmTool.run({ action: 'appel', telephone: '+262 639 00 00 00' }, ctx);
  const a = getAlarm(kv);
  assert.deepEqual([a.enabled, a.work, a.off, a.workDays, a.phone], [true, '03:00', '04:30', [1, 2, 3, 4, 6], '+262639000000']);
  assert.deepEqual(a.vacations, [{ from: '2026-12-20', to: '2026-12-31' }]);
  await assert.rejects(alarmTool.run({ action: 'appel', telephone: '0639' }, ctx), /international/);
  assert.equal(await alarmTool.run({ action: 'couper' }, ctx), 'Réveil coupé.');
});

test('réveil : appel Twilio (voix française, message lu deux fois), boutons', async () => {
  assert.match(twiml('Debout <vite>'), /^<Response><Say language="fr-FR"[^>]*>Debout  vite <\/Say><Pause length="2"\/><Say/);
  let req: { url: string; body: string; auth: string } | undefined;
  await twilioCall('+262639', '+33100', 'Bonjour', { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok' }, (async (url: string, init: RequestInit) => { req = { url, body: String(init.body), auth: String((init.headers as Record<string, string>).authorization) }; return new Response('{}', { status: 201 }); }) as never);
  assert.equal(req!.url, 'https://api.twilio.com/2010-04-01/Accounts/AC1/Calls.json');
  assert.match(req!.body, /To=%2B262639&From=%2B33100&Twiml=/);
  assert.equal(req!.auth, `Basic ${Buffer.from('AC1:tok').toString('base64')}`);
  await assert.rejects(twilioCall('+1', '+2', 'x', {}), /non configuré/);
  assert.match(wakeText('travail', new Date(2026, 10, 9, 3), 0), /03:00, c'est l'heure de te lever pour le travail/);
  assert.equal(buttonText('al:ok'), '/reveil ok');
  assert.equal(buttonText('al:10'), '/reveil 10');
  assert.ok(buttonsFor({ alarm: { attempt: 0 } }).some((b) => b.id === 'al:ok'));
});

test('réveil : sonne à l\'heure, insiste toutes les 5 min, « encore 10 min » puis « je suis réveillé » arrête', async () => {
  const o = makeOdin([{ text: 'ok' }]);
  const now = Date.now(), d = new Date(now), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  o.muninn.setKv('alarm', JSON.stringify({ ...DEFAULT_ALARM, enabled: true, work: hm, off: hm }));
  const sent: Array<{ t: string; o?: unknown }> = [];
  const gw = new Gateway(o, { owners: { web: ['*'] } }).add(web(sent));
  assert.equal(await gw.alarmTick(now), true);
  assert.match(sent[0].t, /^⏰ Bonjour ! Il est/);
  assert.deepEqual(sent[0].o, { alarm: { attempt: 0 } });
  assert.equal(await gw.alarmTick(now + 60_000), false, 'pas avant 5 min');
  assert.equal(await gw.alarmTick(now + 5 * 60_000), true);
  assert.match(sent.at(-1)!.t, /toujours pas levé/);
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: '/reveil 10' });
  assert.match(sent.at(-1)!.t, /dans 10 min/);
  assert.equal(await gw.alarmTick(now + 9 * 60_000), false, 'pas pendant le répit');
  assert.equal(await gw.alarmTick(now + 11 * 60_000), true, 'resonne après le répit');
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: 'je suis réveillé' });
  assert.match(sent.at(-1)!.t, /bonne journée/);
  assert.equal(await gw.alarmTick(now + 30 * 60_000), false, 'plus de sonnerie');
  o.cleanup();
});
