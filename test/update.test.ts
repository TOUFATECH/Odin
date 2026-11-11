import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { checkApp, conflicted, restorePublished, updateApp } from '../src/tools/self.ts';
import { applyUpdate, checkForUpdate, healInstalled } from '../src/tools/update.ts';
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

// ---------------------------------------------------------------------------------------------
// Retouches locales d'Odin et mises à jour : le code installé n'est jamais laissé en conflit.
// (Vécu : Odin avait retouché « access.ts », la version suivante changeait les mêmes lignes, et la
// mise à jour a laissé des marqueurs de conflit dans le fichier ; plus rien ne se chargeait.)

const MARK = /^<{7} |^>{7} /m;
const read = (dir: string, rel: string) => readFileSync(join(dir, rel), 'utf8');
const stashes = (dir: string) => g(dir, 'stash', 'list').split('\n').filter(Boolean).length;
const patches = (home: string) => (existsSync(join(home, 'self-backups')) ? readdirSync(join(home, 'self-backups')).filter((f) => f.endsWith('.patch')) : []);
/** Un Odin miniature : « runtime » charge « access » (comme le vrai), pour que la vérification de chargement ait un sens. */
function version(dir: string, v: string, files: Record<string, string>) {
  mkdirSync(join(dir, 'src/web'), { recursive: true }); mkdirSync(join(dir, 'src/machines'), { recursive: true }); mkdirSync(join(dir, 'src/cli'), { recursive: true }); mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'odin', version: v }));
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text);
  g(dir, 'add', '-A'); g(dir, 'commit', '-qm', `v${v} : version ${v}`);
}
const ACCESS = (mode: string) => `// Droits d'Odin sur la machine.\nexport const mode = '${mode}';\nexport const ok = true;\n`;
const BASE = { 'src/runtime.ts': 'import { mode } from \'./machines/access.ts\';\nexport const run = mode;\n', 'src/web/server.ts': 'export const web = 1;\n', 'src/machines/access.ts': ACCESS('ancien'), 'src/cli/main.ts': 'import { mode } from \'../machines/access.ts\';\nconsole.log(`odin démarre : ${mode}`);\n' };
/** Un dépôt publié en 1.0.0 et un Odin installé (clone), sans conversion des fins de ligne (contenus comparés à l'octet près). */
function installed(extra: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'odin-retouches-')), origin = join(base, 'origin.git'), dev = join(base, 'dev'), app = join(base, 'app'), home = join(base, 'home');
  g(base, 'init', '-q', '--bare', '-b', 'main', origin);
  g(base, 'clone', '-q', '-c', 'core.autocrlf=false', origin, dev); g(dev, 'checkout', '-qb', 'main');
  version(dev, '1.0.0', { ...BASE, ...extra }); g(dev, 'push', '-q', 'origin', 'main');
  g(base, 'clone', '-q', '-c', 'core.autocrlf=false', origin, app);
  const publish = (v: string, files: Record<string, string>) => { version(dev, v, files); g(dev, 'push', '-q', 'origin', 'main'); };
  return { base, dev, app, home, publish, end: () => rmSync(base, { recursive: true, force: true }) };
}
/** La mise à jour telle que la faisait la 1.6.1 : réserve, récupération, réapplication, puis un « checkout » qui ne défait rien. */
function oldUpdate(app: string) {
  const git = (...a: string[]) => spawnSync('git', ['-C', app, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  git('stash', 'push', '-m', 'odin-auto'); git('pull', '-q', '--ff-only'); const pop = git('stash', 'pop'); git('checkout', '--', '.');
  return pop.status;
}

test('mise à jour : une retouche locale en conflit avec la nouvelle version ne laisse jamais de marqueurs dans le code', () => {
  const w = installed();
  try {
    writeFileSync(join(w.app, 'src/machines/access.ts'), ACCESS('retouche d\'Odin'.replace('\'', ' ')));
    w.publish('1.1.0', { 'src/machines/access.ts': ACCESS('nouveau') });
    const r = applyUpdate(w.app, w.home);
    assert.equal(r.ok, true, r.message); assert.equal(r.restart, true); assert.equal(r.to, '1.1.0');
    assert.equal(read(w.app, 'src/machines/access.ts'), ACCESS('nouveau'), 'la version publiée est gardée telle quelle');
    assert.doesNotMatch(read(w.app, 'src/machines/access.ts'), MARK);
    assert.deepEqual(conflicted(w.app), []);
    assert.ok(checkApp(w.app, false).ok, 'le code installé se charge');
    // Rien n'est perdu : la retouche est dans la réserve de git, et en copie lisible.
    assert.equal(stashes(w.app), 1);
    assert.equal(patches(w.home).length, 1);
    assert.match(read(join(w.home, 'self-backups'), patches(w.home)[0]), /retouche d Odin/);
    assert.match(r.message, /ne s'accordent pas avec la nouvelle version[\s\S]*de côté/);
    assert.match(updateApp(w.app, w.home).message, /Déjà à jour/);
  } finally { w.end(); }
});

test('mise à jour : un code déjà laissé en conflit (par l\'ancienne mise à jour) est réparé, sans rien perdre', () => {
  const w = installed();
  try {
    writeFileSync(join(w.app, 'src/machines/access.ts'), ACCESS('retouche locale'));
    writeFileSync(join(w.app, 'src/web/server.ts'), 'export const web = 2; // autre retouche, sans conflit\n');
    w.publish('1.1.0', { 'src/machines/access.ts': ACCESS('nouveau') });
    assert.notEqual(oldUpdate(w.app), 0, 'la réapplication échoue');
    // L'état vécu : la nouvelle version est sur le disque, avec des marqueurs de conflit, et ne se charge plus.
    assert.match(read(w.app, 'src/machines/access.ts'), MARK);
    assert.deepEqual(conflicted(w.app), ['src/machines/access.ts']);
    assert.equal(checkApp(w.app, false).ok, false);
    // Odin s'en rend compte (version installée ≠ version qui tourne) et répare tout seul.
    const h = healInstalled(w.app, w.home, '1.0.0');
    assert.equal(h.ok, true, h.output); assert.ok(h.healed?.files.includes('src/machines/access.ts'));
    assert.equal(read(w.app, 'src/machines/access.ts'), ACCESS('nouveau'));
    assert.equal(read(w.app, 'src/web/server.ts'), 'export const web = 1;\n', 'tout le code est tel que publié');
    assert.deepEqual(conflicted(w.app), []); assert.ok(checkApp(w.app, false).ok);
    assert.equal(stashes(w.app), 1, 'les retouches restent dans la réserve');
    const patch = read(join(w.home, 'self-backups'), patches(w.home)[0]);
    assert.match(patch, /retouche locale/); assert.match(patch, /autre retouche, sans conflit/); assert.doesNotMatch(patch, MARK, 'la copie est la version propre des retouches');
    // Un code sain : rien à réparer, rien n'est touché.
    assert.deepEqual(restorePublished(w.app, w.home), { ok: true, files: [] });
    // Même état, mais c'est « odin update » qui passe : il remet d'abord le code au propre.
    writeFileSync(join(w.app, 'src/machines/access.ts'), ACCESS('encore une retouche'));
    w.publish('1.2.0', { 'src/machines/access.ts': ACCESS('plus nouveau') });
    oldUpdate(w.app); assert.match(read(w.app, 'src/machines/access.ts'), MARK);
    const u = updateApp(w.app, w.home);
    assert.equal(u.ok, true, u.message); assert.match(u.message, /Déjà à jour[\s\S]*resté en conflit après une mise à jour/);
    assert.equal(read(w.app, 'src/machines/access.ts'), ACCESS('plus nouveau')); assert.ok(checkApp(w.app, false).ok);
  } finally { w.end(); }
});

test('mise à jour : une retouche locale qui casse la nouvelle version est mise de côté, la version publiée est gardée', () => {
  const w = installed({ 'src/runtime.ts': 'export const ok = 1;\n' });
  try {
    // Pas de conflit de texte (fichiers différents), mais la retouche s'appuie sur ce que la nouvelle version retire.
    const mine = 'import { ok } from \'../runtime.ts\';\nexport const web = ok; // retouche d Odin\n';
    writeFileSync(join(w.app, 'src/web/server.ts'), mine);
    w.publish('1.1.0', { 'src/runtime.ts': 'export const fine = 2;\n' });
    const r = applyUpdate(w.app, w.home);
    assert.equal(r.ok, true, r.message); assert.equal(r.restart, true); assert.equal(r.to, '1.1.0');
    assert.match(r.message, /ne marchent plus avec cette version : je les ai mises de côté/);
    assert.equal(read(w.app, 'src/web/server.ts'), 'export const web = 1;\n');
    assert.ok(checkApp(w.app, false).ok);
    assert.equal(stashes(w.app), 1); assert.match(read(join(w.home, 'self-backups'), patches(w.home)[0]), /retouche d Odin/);
  } finally { w.end(); }
});

test('mise à jour : nouvelle version cassée → retour complet au code d\'avant, retouches locales comprises', () => {
  const w = installed({ 'src/runtime.ts': 'export const ok = 1;\n' });
  try {
    const mine = 'export const web = 1; // retouche d Odin\n';
    writeFileSync(join(w.app, 'src/web/server.ts'), mine);
    w.publish('1.1.0', { 'src/runtime.ts': 'export const = cassé;\n' });
    const r = applyUpdate(w.app, w.home);
    assert.equal(r.ok, false); assert.match(r.message, /ne se charge pas : je suis resté en v1\.0\.0/);
    assert.equal(JSON.parse(read(w.app, 'package.json')).version, '1.0.0');
    assert.equal(read(w.app, 'src/runtime.ts'), 'export const ok = 1;\n');
    assert.equal(read(w.app, 'src/web/server.ts'), mine, 'la retouche locale est de nouveau en place');
    assert.equal(stashes(w.app), 0); assert.ok(checkApp(w.app, false).ok, 'le code installé se charge');
    // La même version cassée, cette fois avec une retouche en conflit avec elle : même retour propre.
    writeFileSync(join(w.app, 'src/runtime.ts'), 'export const ok = 1; // retouche sur la ligne qui change\n');
    const r2 = applyUpdate(w.app, w.home);
    assert.equal(r2.ok, false); assert.equal(JSON.parse(read(w.app, 'package.json')).version, '1.0.0');
    assert.equal(read(w.app, 'src/runtime.ts'), 'export const ok = 1; // retouche sur la ligne qui change\n');
    assert.deepEqual(conflicted(w.app), []); assert.ok(checkApp(w.app, false).ok);
  } finally { w.end(); }
});

test('mise à jour faite à la main : une version publiée qui ne se charge pas est remplacée par le code de celle qui tourne', () => {
  const w = installed({ 'src/runtime.ts': 'export const ok = 1;\n' });
  try {
    w.publish('1.1.0', { 'src/runtime.ts': 'export const = cassé;\n' });
    g(w.app, 'pull', '-q', '--ff-only');
    assert.equal(JSON.parse(read(w.app, 'package.json')).version, '1.1.0'); assert.equal(checkApp(w.app, false).ok, false);
    const h = healInstalled(w.app, w.home, '1.0.0');
    assert.equal(h.ok, false); assert.equal(h.back, '1.0.0');
    assert.equal(JSON.parse(read(w.app, 'package.json')).version, '1.0.0'); assert.ok(checkApp(w.app, false).ok, 'un redémarrage ne laisse pas Odin par terre');
    // Si la version d'avant n'est pas celle qui tourne, on ne touche à rien.
    g(w.app, 'pull', '-q', '--ff-only');
    const h2 = healInstalled(w.app, w.home, '0.9.0');
    assert.equal(h2.ok, false); assert.equal(h2.back, undefined); assert.equal(JSON.parse(read(w.app, 'package.json')).version, '1.1.0');
  } finally { w.end(); }
});

test('démarrage : le lanceur répare un code resté en conflit, et ne touche à rien pour une autre erreur', () => {
  const w = installed();
  try {
    // Le vrai lanceur, posé dans l'Odin miniature.
    const launcher = join(import.meta.dirname, '..', 'bin', 'odin.mjs');
    copyFileSync(launcher, join(w.dev, 'bin/odin.mjs')); g(w.dev, 'add', '-A'); g(w.dev, 'commit', '-qm', 'lanceur'); g(w.dev, 'push', '-q', 'origin', 'main'); g(w.app, 'pull', '-q', '--ff-only');
    const start = () => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(w.app, 'bin/odin.mjs')], { encoding: 'utf8', env: { ...process.env, ODIN_HOME: w.home, ODIN_REPARE: '' }, timeout: 60_000 });
    assert.match(start().stdout, /odin démarre : ancien/);
    writeFileSync(join(w.app, 'src/machines/access.ts'), ACCESS('retouche locale'));
    w.publish('1.1.0', { 'src/machines/access.ts': ACCESS('nouveau') });
    oldUpdate(w.app); assert.match(read(w.app, 'src/machines/access.ts'), MARK);
    const s = start();
    assert.equal(s.status, 0, s.stderr); assert.match(s.stdout, /odin démarre : nouveau/); assert.match(s.stderr, /resté en conflit après une mise à jour : je l'ai remis tel que publié/);
    assert.doesNotMatch(read(w.app, 'src/machines/access.ts'), MARK); assert.equal(stashes(w.app), 1); assert.equal(patches(w.home).length, 1);
    // Une vraie erreur de code (pas un conflit) : le lanceur la laisse remonter et ne change rien.
    const broken = 'export const mode = ; // faute de frappe\n';
    writeFileSync(join(w.app, 'src/machines/access.ts'), broken);
    const s2 = start();
    assert.notEqual(s2.status, 0); assert.equal(read(w.app, 'src/machines/access.ts'), broken); assert.equal(patches(w.home).length, 1);
  } finally { w.end(); }
});
