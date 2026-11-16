// Bascule Métis : l'ancienne dépendance (serveur local réglé par adresse — Ollama :11434, LM Studio :1234, llama.cpp
// :8080) doit DISPARAÎTRE de la configuration au démarrage, l'adresse d'embeddings en :11434 doit être neutralisée, et
// le propriétaire doit être prévenu. On vérifie la fonction migrerMetis (tous les ports locaux, pas seulement :11434)
// ET son branchement réel au démarrage de createOdin (un ancien fournisseur local a disparu de cfg.providers).
// Aucun service réel, aucun vrai modèle.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrerMetis } from '../src/brain/metis/migration.ts';
import type { OdinConfig, ProviderConfig } from '../src/config.ts';

function cfgAvec(providers: ProviderConfig[], embedUrl = ''): OdinConfig {
  return { providers, memory: { semantic: true, embedUrl, embedModel: 'noos' } } as unknown as OdinConfig;
}

test('migrerMetis : retire TOUT serveur local, quel que soit le port (1234, 8080, 11434), garde les distants', () => {
  const cfg = cfgAvec([
    { kind: 'openai', model: 'a', baseUrl: 'http://localhost:1234/v1' }, // LM Studio
    { kind: 'openai', model: 'b', baseUrl: 'http://127.0.0.1:8080' }, // llama.cpp
    { kind: 'openai', model: 'c', baseUrl: 'http://localhost:11434/v1' }, // Ollama
    { kind: 'anthropic', model: 'claude-x', apiKeyEnv: 'ANTHROPIC_API_KEY' }, // distant : gardé
  ]);
  const r = migrerMetis(cfg, false);
  assert.equal(r.providersRetires, 3, 'les trois serveurs locaux sont retirés (pas seulement :11434)');
  assert.equal(cfg.providers.length, 1);
  assert.equal(cfg.providers[0].kind, 'anthropic');
  assert.ok(r.change);
  assert.ok(r.notice && /Ollama/.test(r.notice));
});

test('migrerMetis : un fournisseur à tier:local explicite est retiré même sans adresse localhost', () => {
  const cfg = cfgAvec([
    { kind: 'openai', model: 'x', baseUrl: 'https://exemple.test/v1', tier: 'local' },
    { kind: 'anthropic', model: 'claude-x', apiKeyEnv: 'ANTHROPIC_API_KEY' },
  ]);
  const r = migrerMetis(cfg, false);
  assert.equal(r.providersRetires, 1);
  assert.equal(cfg.providers.length, 1);
  assert.equal(cfg.providers[0].kind, 'anthropic');
});

test('migrerMetis : neutralise embedUrl en :11434 et est idempotente', () => {
  const cfg = cfgAvec([{ kind: 'anthropic', model: 'claude-x', apiKeyEnv: 'K' }], 'http://127.0.0.1:11434/api/embeddings');
  const r1 = migrerMetis(cfg, true);
  assert.ok(r1.adresseEmbedRetiree);
  assert.equal(cfg.memory!.embedUrl, '');
  // Deuxième passage : plus rien à changer.
  const r2 = migrerMetis(cfg, true);
  assert.equal(r2.change, false);
  assert.equal(r2.providersRetires, 0);
  assert.equal(r2.adresseEmbedRetiree, false);
});

test('migrerMetis : rien à faire si aucun serveur local ni adresse :11434', () => {
  const cfg = cfgAvec([{ kind: 'anthropic', model: 'claude-x', apiKeyEnv: 'K' }], '');
  const r = migrerMetis(cfg, false);
  assert.equal(r.change, false);
  assert.equal(r.notice, undefined);
});

test('au démarrage (createOdin), un ancien fournisseur local a disparu de cfg.providers et du fichier', async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-metis-mig-'));
  const ancienneCle = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-cle-bidon'; // pour que le fournisseur distant restant soit constructible
  const config = {
    providers: [
      { kind: 'openai', model: 'llama3', baseUrl: 'http://localhost:11434/v1' },
      { kind: 'anthropic', model: 'claude-x', apiKeyEnv: 'ANTHROPIC_API_KEY' },
    ],
  };
  writeFileSync(join(home, 'config.json'), JSON.stringify(config, null, 2));
  const { createOdin } = await import('../src/runtime.ts');
  const quiet = (c: OdinConfig): OdinConfig => ({
    ...c,
    mimir: { ...c.mimir, enabled: false },
    watch: { ...c.watch, enabled: false },
    continuous: { ...c.continuous, enabled: false, autoResume: false },
    journal: { ...c.journal, enabled: false },
    veille: { enabled: false, at: '12:30' },
    update: { auto: 'off', everyHours: 6 },
    web: { ...c.web, portsParAppli: false },
  });
  let odin: import('../src/runtime.ts').Odin | undefined;
  try {
    odin = createOdin({ home, configOverride: quiet });
    const local = odin.cfg.providers.filter((p) => /11434/.test(p.baseUrl ?? ''));
    assert.equal(local.length, 0, 'le fournisseur :11434 a disparu de la config en mémoire');
    assert.ok(odin.cfg.providers.some((p) => p.kind === 'anthropic'), 'le fournisseur distant est conservé');
    // Persisté : le fichier ne contient plus le serveur local.
    const relu = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as { providers: ProviderConfig[] };
    assert.equal(relu.providers.filter((p) => /11434/.test(p.baseUrl ?? '')).length, 0, 'le fichier config.json ne contient plus le serveur local');
  } finally {
    odin?.close();
    if (ancienneCle === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = ancienneCle;
    rmSync(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
});
