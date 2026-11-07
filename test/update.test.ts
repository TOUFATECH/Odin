import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyUpdate, checkForUpdate } from '../src/tools/update.ts';
import { buttonText, buttonsFor } from '../src/bifrost/channel.ts';

const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
function release(dir: string, version: string, runtime = 'export const ok = 1;\n') {
  mkdirSync(join(dir, 'src/web'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'odin', version }));
  writeFileSync(join(dir, 'src/runtime.ts'), runtime);
  writeFileSync(join(dir, 'src/web/server.ts'), 'export const web = 1;\n');
  g(dir, 'add', '-A'); g(dir, 'commit', '-qm', `v${version} : version ${version}`);
}

test('mise à jour : détectée, appliquée, et retour en arrière si la nouvelle version ne se charge pas', async () => {
  const base = mkdtempSync(join(tmpdir(), 'odin-maj-'));
  const origin = join(base, 'origin.git'), dev = join(base, 'dev'), app = join(base, 'app');
  g(base, 'init', '-q', '--bare', '-b', 'main', origin);
  g(base, 'clone', '-q', origin, dev); g(dev, 'checkout', '-qb', 'main');
  release(dev, '1.0.0'); g(dev, 'push', '-q', 'origin', 'main');
  g(base, 'clone', '-q', origin, app);
  assert.equal((await checkForUpdate(app)).available, false);

  release(dev, '1.1.0'); g(dev, 'push', '-q', 'origin', 'main');
  const info = await checkForUpdate(app);
  assert.equal(info.available, true); assert.equal(info.latest, '1.1.0'); assert.equal(info.current, '1.0.0');
  assert.deepEqual(info.changes, ['v1.1.0 : version 1.1.0']);
  assert.equal(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version, '1.0.0', 'vérifier ne change rien');

  const r = applyUpdate(app);
  assert.equal(r.ok, true); assert.equal(r.restart, true); assert.equal(r.to, '1.1.0');
  assert.equal((await checkForUpdate(app)).available, false);

  // Version cassée : Odin reste sur celle qui marche.
  release(dev, '1.2.0', 'export const = cassé;\n'); g(dev, 'push', '-q', 'origin', 'main');
  const bad = applyUpdate(app);
  assert.equal(bad.ok, false); assert.match(bad.message, /ne se charge pas : je suis resté en v1\.1\.0/);
  assert.equal(JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).version, '1.1.0');
  rmSync(base, { recursive: true, force: true });
});

test('mise à jour : bouton sur toutes les messageries', () => {
  assert.deepEqual(buttonsFor({ update: { version: '1.2' } }).map((b) => b.id), ['up:go', 'up:later']);
  assert.equal(buttonText('up:go'), '/update');
  assert.equal(buttonText('up:later'), '/update plus tard');
});
