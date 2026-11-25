import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

test('sauvegarde : les versions légères de Vénus (valhalla/freyja/hors-ligne), des copies qu\'Odin sait refaire, n\'y partent pas ; le reste de Vénus y est toujours', () => {
  const o = makeOdin([]);
  const other = mkdtempSync(join(tmpdir(), 'odin-restore-'));
  try {
    const venus = join(o.paths.home, 'valhalla', 'freyja'), legeres = join(venus, 'hors-ligne');
    mkdirSync(legeres, { recursive: true });
    writeFileSync(join(legeres, 'dl-aaaaaaaaaaaa.mp4'), Buffer.alloc(4096, 7));
    writeFileSync(join(legeres, 'dl-bbbbbbbbbbbb.part.mp4'), Buffer.alloc(512, 7));
    // La liste des téléchargements et la bibliothèque de Vénus (le repli en fichiers), juste à côté du dossier des vidéos.
    writeFileSync(join(venus, 'hors_ligne.jsonl'), `${JSON.stringify({ id: 'dl-aaaaaaaaaaaa', maj: 1, data: { profil: 'moi', cible: 'film:a', titre: 'Le Phare', quality: '720p', etat: 'ready' } })}\n`);
    writeFileSync(join(venus, 'oeuvres.jsonl'), `${JSON.stringify({ id: 'film:a', maj: 1, data: { type: 'film', titre: 'Le Phare' } })}\n`);
    // Un dossier du même nom ailleurs (l'espace de travail) n'est pas concerné.
    mkdirSync(join(o.paths.workspace, 'hors-ligne'), { recursive: true });
    writeFileSync(join(o.paths.workspace, 'hors-ligne', 'notes.txt'), 'gardé');

    const names = backupManifest(o.paths).map((f) => f.name);
    assert.deepEqual(names.filter((n) => n.startsWith('valhalla/freyja/hors-ligne')), [], 'aucune version légère dans la sauvegarde');
    for (const n of ['config.json', 'valhalla/freyja/hors_ligne.jsonl', 'valhalla/freyja/oeuvres.jsonl', 'workspace/hors-ligne/notes.txt']) assert.ok(names.includes(n), `${n} reste sauvegardé`);

    // La vraie archive, restaurée sur une machine « neuve » : la liste de Vénus revient, pas les vidéos.
    const r = restoreBackup(odinPaths(other), createBackup(o.paths, 'motdepasse-solide'), 'motdepasse-solide');
    assert.ok(r.files >= 4);
    assert.ok(existsSync(join(other, 'valhalla', 'freyja', 'hors_ligne.jsonl')) && existsSync(join(other, 'valhalla', 'freyja', 'oeuvres.jsonl')));
    assert.ok(!existsSync(join(other, 'valhalla', 'freyja', 'hors-ligne')), 'le dossier des versions légères n\'est pas dans l\'archive');
    assert.equal(readFileSync(join(other, 'workspace', 'hors-ligne', 'notes.txt'), 'utf8'), 'gardé');
  } finally { o.cleanup(); rmSync(other, { recursive: true, force: true }); }
});
