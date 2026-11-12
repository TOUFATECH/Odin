import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupManifest, cleanupRestore, createBackup, decryptBackup, encryptBackup, restoreBackup } from '../src/backup.ts';
import { odinPaths } from '../src/config.ts';
import { zip } from '../src/files/zip.ts';
import { makeOdin } from './helpers.ts';

test('sauvegarde chiffrée : tout ~/.odin sauf journaux et certificat, illisible sans mot de passe, restaurée à l\'identique', () => {
  const o = makeOdin([]);
  const other = mkdtempSync(join(tmpdir(), 'odin-restore-'));
  try {
    writeFileSync(join(o.paths.home, 'env'), 'ANTHROPIC_API_KEY=sk-secret\n', { mode: 0o600 });
    writeFileSync(join(o.paths.workspace, 'notes.txt'), 'bonjour');
    writeFileSync(join(o.paths.logs, 'odin.log'), 'bruit');
    writeFileSync(join(o.paths.home, 'web-cert'), 'cert');
    o.muninn.remember('rapports en PDF', 'owner');

    const names = backupManifest(o.paths).map((f) => f.name);
    assert.ok(names.includes('config.json') && names.includes('env') && names.includes('memoire/memories.jsonl') && names.includes('workspace/notes.txt'));
    assert.ok(!names.some((n) => n.startsWith('logs/') || n === 'web-cert'), 'journaux et certificat exclus');
    assert.ok(!backupManifest(o.paths, { workspace: false }).some((n) => n.name.startsWith('workspace/')));

    const data = createBackup(o.paths, 'motdepasse-solide');
    assert.equal(data.subarray(0, 7).toString(), 'ODINBK1');
    assert.doesNotMatch(data.toString('latin1'), /sk-secret|config\.json|notes\.txt/, 'rien en clair, pas même les noms');
    assert.throws(() => decryptBackup(data, 'mauvais-mot-de-passe'), /mot de passe incorrect/);
    assert.throws(() => createBackup(o.paths, 'court'), /8 caractères/);
    assert.throws(() => decryptBackup(Buffer.from('pas une sauvegarde du tout, vraiment pas, non non non'), 'motdepasse-solide'), /pas une sauvegarde/);

    // Restauration sur une machine « neuve »
    const p2 = odinPaths(other);
    const r = restoreBackup(p2, data, 'motdepasse-solide');
    assert.ok(r.files >= 4);
    assert.equal(readFileSync(join(other, 'env'), 'utf8'), 'ANTHROPIC_API_KEY=sk-secret\n');
    if (process.platform !== 'win32') assert.equal(statSync(join(other, 'env')).mode & 0o777, 0o600, 'les clés restent lisibles par toi seul');
    assert.equal(readFileSync(join(other, 'workspace', 'notes.txt'), 'utf8'), 'bonjour');
    assert.ok(existsSync(join(other, 'memoire', 'memories.jsonl')));
    assert.ok(!names.includes('odin.db'), 'plus aucune base SQLite');
    assert.deepEqual(JSON.parse(readFileSync(join(other, 'config.json'), 'utf8')), JSON.parse(readFileSync(o.paths.config, 'utf8')));

    // Restauration par-dessus un Odin existant : l'ancien est gardé jusqu'au prochain démarrage.
    writeFileSync(join(other, 'workspace', 'notes.txt'), 'version locale');
    const r2 = restoreBackup(p2, data, 'motdepasse-solide');
    assert.ok(r2.replaced.includes('workspace/notes.txt'));
    assert.equal(readFileSync(join(other, 'workspace', 'notes.txt.avant-restauration'), 'utf8'), 'version locale');
    assert.equal(readFileSync(join(other, 'workspace', 'notes.txt'), 'utf8'), 'bonjour');
    assert.ok(cleanupRestore(p2) >= 1);
    assert.ok(!existsSync(join(other, 'workspace', 'notes.txt.avant-restauration')));

    // Archive piégée : un chemin qui sort du dossier est refusé avant d'écrire quoi que ce soit.
    const evil = encryptBackup(zip([{ name: '_sauvegarde.json', data: Buffer.from('{}') }, { name: 'config.json', data: Buffer.from('{}') }, { name: '../evil.txt', data: Buffer.from('x') }]), 'motdepasse-solide');
    assert.throws(() => restoreBackup(p2, evil, 'motdepasse-solide'), /chemin refusé/);
    assert.ok(!existsSync(join(other, '..', 'evil.txt')));
  } finally { o.cleanup(); rmSync(other, { recursive: true, force: true }); }
});
