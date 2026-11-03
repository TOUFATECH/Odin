import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { Gateway } from '../src/bifrost/gateway.ts';
import { loadConfig } from '../src/config.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { envFile, loadEnvFile, providerFor, secretHint, writeSecret } from '../src/settings.ts';
import { makeOdin } from './helpers.ts';

test('clés : ~/.odin/env écrit en 600, relu sans écraser, jamais renvoyé en clair', () => {
  const o = makeOdin([]);
  const env: NodeJS.ProcessEnv = {};
  writeSecret(o.paths, 'ANTHROPIC_API_KEY', 'sk-ant-abcdefghijklmnop1234', env);
  writeSecret(o.paths, 'TELEGRAM_BOT_TOKEN', '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi', env);
  writeSecret(o.paths, 'ANTHROPIC_API_KEY', 'sk-ant-zzzzzzzzzzzzzzzz9999', env); // remplacement, pas doublon
  const text = readFileSync(envFile(o.paths), 'utf8');
  assert.equal(text.match(/ANTHROPIC_API_KEY/g)!.length, 1);
  if (process.platform !== 'win32') assert.equal(statSync(envFile(o.paths)).mode & 0o777, 0o600);
  assert.deepEqual(secretHint('ANTHROPIC_API_KEY', env), { set: true, hint: '…9999' });

  const fresh: NodeJS.ProcessEnv = { TELEGRAM_BOT_TOKEN: 'déjà-là' };
  loadEnvFile(o.paths, fresh);
  assert.equal(fresh.ANTHROPIC_API_KEY, 'sk-ant-zzzzzzzzzzzzzzzz9999');
  assert.equal(fresh.TELEGRAM_BOT_TOKEN, 'déjà-là', 'l\'environnement existant garde la priorité');

  writeSecret(o.paths, 'ANTHROPIC_API_KEY', '', env);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.throws(() => writeSecret(o.paths, 'PATH', '/tmp', env), /non autorisée/);
  assert.throws(() => writeSecret(o.paths, 'OPENAI_API_KEY', 'a b\nEVIL=1', env), /invalide/);
  writeFileSync(envFile(o.paths), 'export OPENAI_API_KEY="sk-guillemets-1234567890"\n# commentaire\n');
  const e2: NodeJS.ProcessEnv = {};
  loadEnvFile(o.paths, e2);
  assert.equal(e2.OPENAI_API_KEY, 'sk-guillemets-1234567890');
  o.cleanup();
});

test('choix du modèle : préréglages, Ollama sans clé, adresses vérifiées', () => {
  assert.deepEqual(providerFor({ preset: 'anthropic', model: 'claude-sonnet-5-5' }), { kind: 'anthropic', model: 'claude-sonnet-5-5', apiKeyEnv: 'ANTHROPIC_API_KEY', priceInPerM: 3, priceOutPerM: 15 });
  assert.deepEqual(providerFor({ preset: 'ollama', model: 'qwen3:14b', baseUrl: 'http://localhost:11434/v1/' }), { kind: 'openai', model: 'qwen3:14b', baseUrl: 'http://localhost:11434/v1' });
  assert.equal(providerFor({ preset: 'openrouter', model: 'x/y' }).apiKeyEnv, 'OPENROUTER_API_KEY');
  assert.throws(() => providerFor({ preset: 'custom', model: 'm', baseUrl: 'file:///etc/passwd' }), /adresse/);
  assert.throws(() => providerFor({ preset: 'anthropic', model: 'deux mots' }), /modèle/);
});

test('onglet Réglages : état sans secret, enregistrement, redémarrage des services', async () => {
  const o = makeOdin([]);
  o.demo = true;
  const port = 21000 + Math.floor(Math.random() * 20000);
  const token = ensureWebToken(o.paths);
  let reloads = 0;
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined, reload: async () => { reloads++; } }, { port, host: '127.0.0.1', token }));
  await gw.start();
  const B = `http://127.0.0.1:${port}`;
  const h = { authorization: `Bearer ${token}`, 'x-odin': '1', 'content-type': 'application/json' };
  const act = async (body: Record<string, unknown>) => (await fetch(`${B}/api/action`, { method: 'POST', headers: h, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>;
  const before = process.env.OPENROUTER_API_KEY;

  try {
    const st = await (await fetch(`${B}/api/state`, { headers: h })).json() as { settings: { demo: boolean; model: { preset: string }; secrets: Record<string, unknown> } };
    assert.equal(st.settings.demo, true);
    assert.equal(st.settings.model.preset, 'anthropic');

    const r = await act({ kind: 'settings_save', section: 'model', preset: 'openrouter', model: 'meta/llama-4', apiKey: 'sk-or-v1-abcdefghijklmnopqrstuvwxyz' });
    assert.deepEqual(r, { ok: true, reloading: true });
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(reloads, 1, 'les services sont relancés avec la nouvelle configuration');
    const cfg = loadConfig(o.paths);
    assert.equal(cfg.providers[0].model, 'meta/llama-4');
    assert.equal(cfg.providers[0].apiKeyEnv, 'OPENROUTER_API_KEY');
    assert.doesNotMatch(readFileSync(o.paths.config, 'utf8'), /sk-or-v1/, 'la clé n\'est jamais dans config.json');
    assert.match(readFileSync(envFile(o.paths), 'utf8'), /OPENROUTER_API_KEY=sk-or-v1-/);
    const st2 = JSON.stringify(await (await fetch(`${B}/api/state`, { headers: h })).json());
    assert.doesNotMatch(st2, /abcdefghijklmnopqrstuvwxyz/, 'la page ne reçoit jamais la clé');
    assert.equal(o.redactor.redact('clé sk-or-v1-abcdefghijklmnopqrstuvwxyz'), 'clé [SECRET]');

    assert.equal((await act({ kind: 'settings_save', section: 'network', enabled: true, intervalMin: 2, notify: true })).ok, false, 'intervalle trop court refusé');
    assert.equal((await act({ kind: 'settings_save', section: 'network', enabled: true, intervalMin: 60, notify: false })).ok, true);
    assert.equal(loadConfig(o.paths).network.intervalMin, 60);
    assert.match(String((await act({ kind: 'settings_save', section: 'telegram', enabled: true, token: 'pas-un-jeton' })).error), /jeton Telegram invalide/);
    assert.match(String((await act({ kind: 'settings_save', section: 'secret', name: 'PATH', value: '/x' })).error), /non autorisée/);
    assert.match(String((await act({ kind: 'settings_save', section: 'mimir', judge: 'n-importe-quoi' })).error), /mimir.judge/);

    const t = await act({ kind: 'settings_test', preset: 'anthropic', model: 'claude-sonnet-5-5', apiKey: '' });
    if (!process.env.ANTHROPIC_API_KEY) assert.match(String(t.message), /ANTHROPIC_API_KEY absente/);
  } finally {
    if (before === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = before;
    await gw.stop();
    o.cleanup();
  }
});
