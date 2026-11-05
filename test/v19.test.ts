import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CORRECTION, preferredProviders, recordOutcome, taskCategory } from '../src/core/agent.ts';
import { anomalies, weeklyReport } from '../src/guard/insight.ts';
import { rememberBefore, undo, undoList } from '../src/undo.ts';
import { formatChecks } from '../src/selftest.ts';
import { readSecretFile, vaultDisable, vaultEnable, vaultLock, vaultState, vaultUnlock, writeSecretFile } from '../src/vault.ts';
import { speakPlan } from '../src/tools/homeassistant.ts';
import { makeOdin } from './helpers.ts';

test('corrections reconnues, catégorie de tâche, modèle préféré selon les réussites', () => {
  assert.ok(CORRECTION.test('non, c\'est le 192.168.1.35'));
  assert.ok(CORRECTION.test('Tu t\'es trompé'));
  assert.ok(!CORRECTION.test('nonobstant, continue'));
  assert.equal(taskCategory('scanne le réseau'), 'reseau');
  assert.equal(taskCategory('cherche le prix du riz'), 'web');
  const o = makeOdin([]);
  try {
    for (let k = 0; k < 6; k++) { recordOutcome(o.muninn, 'web', 'a', k < 2); recordOutcome(o.muninn, 'web', 'b', true); }
    assert.deepEqual(preferredProviders(o.muninn, 'web'), ['b', 'a']);
    assert.equal(preferredProviders(o.muninn, 'code'), undefined, 'pas assez d\'essais');
  } finally { o.cleanup(); }
});

test('annuler : un fichier modifié revient, un fichier créé disparaît', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-undo-'));
  try {
    const f = join(home, 'note.txt'), g = join(home, 'nouveau.txt');
    writeFileSync(f, 'avant'); rememberBefore(home, 's', f, 'fs_write'); writeFileSync(f, 'après');
    rememberBefore(home, 's', g, 'fs_write'); writeFileSync(g, 'x');
    const [a, b] = undoList(home);
    undo(home, a.id); undo(home, b.id);
    assert.equal(readFileSync(f, 'utf8'), 'avant');
    assert.ok(!existsSync(g));
    assert.throws(() => undo(home, a.id), /déjà annulée/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('heures calmes (nuit, rendez-vous) et anomalies (appareil inconnu la nuit, surcharge)', async () => {
  const { Gateway } = await import('../src/bifrost/gateway.ts');
  const o = makeOdin([], { config: (c) => ({ ...c, quiet: { enabled: true, from: '22:30', to: '07:00', agenda: true } }) });
  try {
    const gw = new Gateway(o, { owners: {} });
    assert.equal(gw.quietNow(new Date('2026-11-05T23:10:00').getTime()), 'nuit');
    assert.equal(gw.quietNow(new Date('2026-11-05T12:00:00').getTime()), undefined);
    const s = new Date('2026-11-05T14:00:00').getTime();
    o.muninn.setKv('agenda-today', JSON.stringify([{ start: s, end: s + 3600_000, title: 'Dentiste' }]));
    assert.match(gw.quietNow(s + 600_000)!, /Dentiste/);
    const now = new Date('2026-11-05T08:00:00').getTime();
    const ev = [{ device_id: 'd1', kind: 'nouveau', detail: 'x', at: new Date('2026-11-05T03:12:00').getTime() }];
    const dev = [{ id: 'd1', ip: '192.168.1.77', mac: 'aa:bb', hostname: '', name: '', label: '', kind: 'inconnu', status: 'online' }] as never;
    let out = anomalies({ kv: o.muninn, events: ev, devices: dev, paths: o.paths, now, load: 0 });
    assert.match(out[0].text, /cette nuit à 03:12.*192\.168\.1\.77/);
    for (let k = 0; k < 3; k++) out = anomalies({ kv: o.muninn, events: [], devices: [], paths: o.paths, now, load: 999 });
    assert.ok(out.some((x) => x.key === 'load'), 'surcharge durable');
  } finally { o.cleanup(); }
});

test('bilan de la semaine et rapport du test complet', () => {
  const now = Date.now(), d = 86_400_000;
  const r = weeklyReport([{ status: 'terminée', started_at: now - d, ended_at: now - d + 60_000, cost_usd: 0.1 }, { status: 'échouée', started_at: now - 2 * d, ended_at: null, cost_usd: 0.2 }, { status: 'terminée', started_at: now - 9 * d, ended_at: now - 9 * d + 1000, cost_usd: 0 }], [{ created_at: now - d, origin: 'owner' }], now);
  assert.match(r, /Missions : 2 \(semaine d'avant : 1\)/);
  assert.match(r, /Réussite : 50 %/);
  assert.equal(formatChecks([{ name: 'Mail', ok: false, detail: 'refusé', fix: 'mot de passe d\'application' }, { name: 'Agenda', ok: null, detail: 'non relié' }]), '❌ Mail : refusé\n   → mot de passe d\'application\n⚪ Agenda : non relié');
});

test('coffre : secrets chiffrés sur le disque, illisibles verrouillé, rendus en clair si désactivé', () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-vault-'));
  try {
    const env = join(home, 'env');
    writeSecretFile(env, 'HA_TOKEN=abc123\n');
    assert.equal(vaultState(home), 'off');
    assert.throws(() => vaultEnable(home, 'court'), /trop court/);
    vaultEnable(home, 'un mot de passe solide');
    assert.ok(!existsSync(env) && existsSync(`${env}.enc`));
    assert.ok(!readFileSync(`${env}.enc`).includes('abc123'), 'chiffré');
    assert.equal(readSecretFile(env), 'HA_TOKEN=abc123\n');
    vaultLock(home);
    assert.equal(vaultState(home), 'locked');
    assert.equal(readSecretFile(env), undefined);
    assert.throws(() => writeSecretFile(env, 'x'), /verrouillé/);
    assert.throws(() => vaultUnlock(home, 'faux mot de passe'), /incorrect/);
    vaultUnlock(home, 'un mot de passe solide');
    writeSecretFile(join(home, 'machines.json'), '[]');
    vaultDisable(home, 'un mot de passe solide');
    assert.equal(vaultState(home), 'off');
    assert.equal(readFileSync(env, 'utf8'), 'HA_TOKEN=abc123\n');
    assert.equal(readFileSync(join(home, 'machines.json'), 'utf8'), '[]');
  } finally { vaultLock(home); rmSync(home, { recursive: true, force: true }); }
});

test('enceintes : tts.speak si disponible, sinon ancien service', () => {
  const p = speakPlan([{ entity_id: 'tts.piper', state: 'ok', attributes: {} }], 'media_player.salon', 'Bonjour');
  assert.equal(p.path, '/services/tts/speak');
  assert.equal(p.data.media_player_entity_id, 'media_player.salon');
  assert.equal(speakPlan([], 'media_player.salon', 'x').path, '/services/tts/google_translate_say');
});

test('raccourci Siri / Android : /api/ask répond en texte simple, jeton Bearer obligatoire (pas de cookie)', async () => {
  const { Gateway } = await import('../src/bifrost/gateway.ts');
  const { WebChannel, ensureWebToken } = await import('../src/web/server.ts');
  const o = makeOdin([{ text: '**Il fait 28 °C** à Mamoudzou. [humeur:joie]' }]);
  const port = 21000 + Math.floor(Math.random() * 20000), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined as never }, { port, host: '127.0.0.1', token }));
  await gw.start();
  try {
    const B = `http://127.0.0.1:${port}/api/ask`;
    assert.equal((await fetch(B, { method: 'POST', headers: { cookie: `odin_token=${token}` }, body: 'météo ?' })).status, 401);
    const r = await fetch(B, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Quel temps fait-il ?' }) });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'Il fait 28 °C à Mamoudzou.');
  } finally { await gw.stop(); o.cleanup(); }
});
