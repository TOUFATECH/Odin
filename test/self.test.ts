import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_ROOT, appPath, backupFile, checkApp, rollback, updateApp } from '../src/tools/self.ts';
import { toolPath } from '../src/heimdall/policy.ts';

test('accès complet : chemins absolus partout pour le propriétaire, secrets d\'Odin protégés', () => {
  const ws = mkdtempSync(join(tmpdir(), 'odin-ws-'));
  const other = mkdtempSync(join(tmpdir(), 'odin-other-'));
  try {
    writeFileSync(join(other, 'notes.txt'), 'x');
    assert.throws(() => toolPath({ workspace: ws }, join(other, 'notes.txt')), /hors de l'espace de travail/);
    assert.equal(toolPath({ workspace: ws, fullAccess: true }, join(other, 'notes.txt')).endsWith('notes.txt'), true);
    assert.throws(() => toolPath({ workspace: ws, fullAccess: true }, '/home/x/.odin/machines.json'), /secrets/);
    assert.throws(() => toolPath({ workspace: ws, fullAccess: true }, '~/.odin/codex-auth.json'), /secrets/);
    assert.throws(() => toolPath({ workspace: ws, fullAccess: true }, '../../etc/passwd'), /hors de l'espace de travail/, 'un chemin relatif reste dans l\'espace de travail');
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});

test('auto-modification : chemins limités au code, sauvegarde puis retour arrière', () => {
  assert.throws(() => appPath('../etc/passwd'), /Hors du code/);
  assert.throws(() => appPath('.git/config'), /interdit/);
  assert.ok(appPath('src/runtime.ts').startsWith(APP_ROOT));
  const root = mkdtempSync(join(tmpdir(), 'odin-app-')), home = mkdtempSync(join(tmpdir(), 'odin-home-'));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.ts'), 'original');
    backupFile(home, root, 'src/a.ts', 'lot1');
    writeFileSync(join(root, 'src/a.ts'), 'modifié');
    backupFile(home, root, 'src/a.ts', 'lot1'); // déjà sauvegardé : l'original n'est pas écrasé
    backupFile(home, root, 'src/nouveau.ts', 'lot1');
    writeFileSync(join(root, 'src/nouveau.ts'), 'neuf');
    const r = rollback(home, root);
    assert.deepEqual(r?.files, ['src/a.ts', 'src/nouveau.ts']);
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'original');
    assert.equal(existsSync(join(root, 'src/nouveau.ts')), false, 'fichier créé : supprimé');
    assert.equal(rollback(home, root), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

test('auto-vérification : le code actuel se charge', () => {
  const r = checkApp(APP_ROOT, false);
  assert.ok(r.ok, r.output);
});

test('mise à jour : récupère la nouvelle version en gardant les améliorations locales', { skip: spawnSync('git', ['--version']).status !== 0 }, () => {
  const base = mkdtempSync(join(tmpdir(), 'odin-git-'));
  const g = (cwd: string, ...a: string[]) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  try {
    const up = join(base, 'up'); mkdirSync(up);
    g(up, 'init', '-q', '-b', 'main'); writeFileSync(join(up, 'a.txt'), 'un\n'); writeFileSync(join(up, 'b.txt'), 'b\n'); g(up, 'add', '.'); g(up, 'commit', '-qm', 'v1');
    g(base, 'clone', '-q', up, 'app');
    const app = join(base, 'app');
    writeFileSync(join(app, 'b.txt'), 'b amélioré par Odin\n');
    writeFileSync(join(up, 'a.txt'), 'deux\n'); g(up, 'commit', '-qam', 'v2');
    const r = updateApp(app);
    assert.ok(r.ok, r.message);
    assert.match(r.message, /Mis à jour/);
    assert.equal(readFileSync(join(app, 'a.txt'), 'utf8'), 'deux\n');
    assert.equal(readFileSync(join(app, 'b.txt'), 'utf8'), 'b amélioré par Odin\n');
    assert.match(updateApp(app).message, /Déjà à jour/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
