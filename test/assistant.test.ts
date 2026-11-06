import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Gateway } from '../src/bifrost/gateway.ts';
import type { Channel } from '../src/bifrost/channel.ts';
import { nags, parseRepeat, parseTime, parseWhen, reminderReply } from '../src/cron/reminders.ts';
import { weatherLine, weatherWords, morningBriefing } from '../src/bifrost/briefing.ts';
import { installScript } from '../src/voice/local.ts';
import { call, makeOdin } from './helpers.ts';

const NOW = new Date(2026, 10, 6, 21, 30); // vendredi 6 novembre 2026, 21 h 30
const fmt = (d?: Date) => d ? `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : '—';

test('rappels : dates en français courant', () => {
  assert.equal(fmt(parseWhen('vendredi', NOW)), '13/11 9:00');
  assert.equal(fmt(parseWhen('payer EDM vendredi 14h', NOW)), '13/11 14:00');
  assert.equal(fmt(parseWhen('demain soir', NOW)), '7/11 19:00');
  assert.equal(fmt(parseWhen('dans 20 min', NOW)), '6/11 21:50');
  assert.equal(fmt(parseWhen('dans 1h30', NOW)), '6/11 23:00');
  assert.equal(fmt(parseWhen('dans une demi-heure', NOW)), '6/11 22:00');
  assert.equal(fmt(parseWhen('à 18h', NOW)), '7/11 18:00', 'heure passée : demain');
  assert.equal(fmt(parseWhen('le 5 décembre', NOW)), '5/12 9:00');
  assert.equal(fmt(parseWhen('05/12 à 14h30', NOW)), '5/12 14:30');
  assert.equal(fmt(parseWhen('samedi à 7h du soir', NOW)), '7/11 19:00');
  assert.equal(fmt(parseWhen('jeudi après-midi', NOW)), '12/11 15:00');
  assert.equal(fmt(parseWhen('2026-11-20 10:00', NOW)), '20/11 10:00');
  assert.equal(parseWhen('un jour peut-être', NOW), undefined);
  assert.deepEqual(parseTime('vers midi'), { h: 12, m: 0 });
});

test('rappels : répétitions → cron', () => {
  assert.equal(parseRepeat('tous les jours à 8h', NOW), '0 8 * * *');
  assert.equal(parseRepeat('chaque lundi 9h', NOW), '0 9 * * 1');
  assert.equal(parseRepeat('en semaine à 7h30', NOW), '30 7 * * 1-5');
  assert.equal(parseRepeat('tous les mois le 5', NOW), '0 9 5 * *');
  assert.equal(parseRepeat('tous les ans le 3 mars', NOW), '0 9 3 3 *');
  assert.equal(parseRepeat('toutes les 2 heures', NOW), '0 */2 * * *');
  assert.equal(parseRepeat('0 9 * * 1', NOW), '0 9 * * 1');
  assert.equal(parseRepeat('quand tu veux', NOW), undefined);
});

test('rappels : réponses « fait » / « plus tard »', () => {
  assert.deepEqual(reminderReply("c'est fait"), { done: true });
  assert.deepEqual(reminderReply('payé !'), { done: true });
  const later = reminderReply('plus tard', NOW);
  assert.ok(later && 'snooze' in later && later.snooze.getTime() === NOW.getTime() + 3600_000);
  const d = reminderReply('dans 20 min', NOW);
  assert.ok(d && 'snooze' in d && d.snooze.getTime() === NOW.getTime() + 20 * 60_000);
  assert.equal(reminderReply('ok'), undefined, '« ok » reste pour les validations');
  assert.equal(reminderReply('quelle heure est-il ?'), undefined);
});

function web(sent: Array<{ t: string; o?: unknown }>): Channel {
  return { name: 'web', interactive: true, defaultPeer: 'principal', start: async () => {}, stop: async () => {}, send: async (_p, t, o) => { sent.push({ t, o }); } };
}

test('rappel : envoyé avec boutons, relancé tant que pas fait, « c\'est fait » arrête', async () => {
  const o = makeOdin([call('reminder_set', { at: 'dans 2 heures', text: 'payer la facture EDM' }), { text: 'Noté.' }]);
  await o.agent.run('rappelle-moi de payer EDM dans 2 heures', { sessionId: 'web:principal', channel: 'web', peer: 'principal' });
  const job = o.muninn.listJobs().find((j) => j.cron === '@reminder')!;
  assert.ok(job && Math.abs(job.next_run - (Date.now() + 2 * 3600_000)) < 120_000);
  const sent: Array<{ t: string; o?: unknown }> = [];
  const gw = new Gateway(o, { owners: { web: ['*'] } }).add(web(sent));
  const t0 = job.next_run + 1000;
  await gw.tick(t0);
  assert.match(sent[0].t, /^🔔 Rappel : payer la facture EDM/);
  assert.deepEqual(sent[0].o, { reminder: { id: job.id } });
  assert.equal(nags(o.muninn).length, 1);
  await gw.tick(t0 + 31 * 60_000);
  assert.match(sent.at(-1)!.t, /je reviens vers toi.*payer la facture EDM/);
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: "c'est fait" });
  assert.match(sent.at(-1)!.t, /réglé/);
  assert.equal(nags(o.muninn).length, 0);
  await gw.tick(t0 + 5 * 3600_000);
  assert.equal(sent.filter((x) => /payer la facture/.test(x.t) && x.t.startsWith('🔔')).length, 2, 'plus de relance');
  o.cleanup();
});

test('rappel : bouton « plus tard » le reprogramme ; récurrent : revient chaque fois', async () => {
  const o = makeOdin([call('reminder_set', { repeat: 'tous les jours à 8h', text: 'prendre les médicaments' }), { text: 'Noté.' }]);
  await o.agent.run('rappelle-moi chaque jour à 8h mes médicaments', { sessionId: 'web:principal', channel: 'web', peer: 'principal' });
  const job = o.muninn.listJobs().find((j) => j.prompt.startsWith('[rappel] '))!;
  assert.equal(job.cron, '0 8 * * *');
  const sent: Array<{ t: string; o?: unknown }> = [];
  const gw = new Gateway(o, { owners: { web: ['*'] } }).add(web(sent));
  await gw.tick(job.next_run + 1000);
  assert.match(sent[0].t, /^🔔 Rappel : prendre les médicaments/);
  const id = (sent[0].o as { reminder: { id: string } }).reminder.id;
  assert.ok(o.muninn.listJobs().find((j) => j.id === job.id)!.next_run > job.next_run + 23 * 3600_000, 'prochaine fois demain');
  await gw.handle({ channel: 'web', peer: 'principal', name: 'moi', text: `/rappel later ${id} 10` });
  assert.match(sent.at(-1)!.t, /je te le rappelle/);
  assert.equal(o.muninn.listJobs().filter((j) => j.cron === '@reminder').length, 1);
  assert.equal(nags(o.muninn).length, 0);
  o.cleanup();
});

test('briefing du matin : météo (Open-Meteo), rappels du jour, nuit', async () => {
  assert.deepEqual(weatherWords(0), ['☀️', 'grand soleil']);
  assert.equal(weatherLine('Mamoudzou', { daily: { weather_code: [80], temperature_2m_max: [31.4], temperature_2m_min: [24.6], precipitation_probability_max: [60], wind_speed_10m_max: [20] } }), '🌦 Météo à Mamoudzou : averses, 25° → 31°, pluie 60 %.');
  const o = makeOdin([]);
  const now = Date.now();
  o.muninn.addJob({ id: 'rem_x', cron: '@reminder', prompt: 'appeler la mairie', channel: 'web', peer: 'principal', next_run: now + 3600_000, tainted: 0 });
  const b = await morningBriefing(o, '- sauvegarde faite', now);
  assert.match(b.text, /☀️ Bonjour/);
  assert.match(b.text, /🔔 Rappels d'aujourd'hui :\n• \d\d:\d\d — appeler la mairie/);
  assert.match(b.text, /🌙 Cette nuit :\n- sauvegarde faite/);
  assert.match(b.text, /ta ville/);
  assert.match(b.speech, /appeler la mairie/);
  o.cleanup();
});

test('voix locale : le script installe Whisper et Piper (voix tom), sans rien d\'autre', () => {
  const s = installScript({ stt: true, tts: true, model: 'small' });
  assert.match(s, /whisper\.cpp/); assert.match(s, /ggml-small\.bin/); assert.match(s, /fr_FR\/tom\/medium\/fr_FR-tom-medium/);
  assert.doesNotMatch(installScript({ stt: false, tts: true, model: 'small' }), /whisper\.cpp/);
  assert.doesNotMatch(s, /rm -rf/);
});
