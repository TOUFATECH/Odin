// Garde-fou des dossiers réels : un Odin jetable (dossier sous le dossier temporaire, essai, banc) n'écrit JAMAIS
// dans le vrai dossier d'Odin de la personne ni dans le vrai dossier des clés de sa machine, même sans ODIN_HOME ni
// ODIN_CLE_DIR ; et une vraie installation garde exactement son dossier, sa clé et son coffre.
//
// Aucun de ces essais ne vise le vrai profil : chacun fabrique un FAUX profil (dossier temporaire) et le fait passer
// pour celui de la personne dans un sous-processus seulement (USERPROFILE, HOME, LOCALAPPDATA, APPDATA, TEMP, TMP).
// Le dossier temporaire du faux profil est À CÔTÉ de lui, pas au-dessus : sinon le faux ~/.odin serait lui-même
// « sous le dossier temporaire », donc jetable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = (f: string) => pathToFileURL(join(ROOT, 'src', f)).href;
const avecGit = spawnSync('git', ['--version']).status === 0;
const root0 = process.platform !== 'win32' && process.getuid?.() === 0; // root : la clé irait dans /etc, pas de faux profil possible

interface Faux { base: string; profil: string; tmp: string; odinReel: string; clesReelles: string; env: NodeJS.ProcessEnv }
function fauxProfil(): Faux {
  const base = mkdtempSync(join(tmpdir(), 'odin-faux-profil-'));
  const profil = join(base, 'profil'), tmp = join(base, 'tmp'), local = join(profil, 'AppData', 'Local');
  for (const d of [profil, tmp, local, join(profil, 'AppData', 'Roaming')]) mkdirSync(d, { recursive: true });
  const env: NodeJS.ProcessEnv = { ...process.env, USERPROFILE: profil, HOME: profil, LOCALAPPDATA: local, APPDATA: join(profil, 'AppData', 'Roaming'), TEMP: tmp, TMP: tmp, TMPDIR: tmp };
  for (const k of ['ODIN_HOME', 'ODIN_CLE_DIR', 'NODE_TEST_CONTEXT', 'ODIN_ESSAI', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) delete env[k];
  for (const k of Object.keys(env)) if (/^GIT_/i.test(k)) delete env[k]; // un GIT_DIR hérité ferait agir git sur un autre dépôt
  const clesReelles = process.platform === 'win32' ? join(local, 'Odin', 'cles') : join(profil, '.config', 'odin-cles');
  return { base, profil, tmp, odinReel: join(profil, '.odin'), clesReelles, env };
}
/** Lance un module dans le faux profil ; rend ce qu'il écrit en JSON sur sa dernière ligne. */
function lancer(f: Faux, code: string, env: NodeJS.ProcessEnv = {}): { ok: boolean; out: Record<string, unknown>; brut: string } {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], { cwd: f.tmp, env: { ...f.env, ...env }, encoding: 'utf8', timeout: 120_000 });
  const brut = `${r.stdout}${r.stderr}`;
  const der = r.stdout.trim().split('\n').at(-1) ?? '';
  let out: Record<string, unknown> = {};
  try { out = JSON.parse(der) as Record<string, unknown>; } catch { /* sortie brute rendue */ }
  return { ok: r.status === 0, out, brut };
}
const fichiers = (d: string): string[] => { try { return readdirSync(d, { recursive: true }).map(String); } catch { return []; } };
const nettoyer = (f: Faux) => rmSync(f.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

test('(1) un Odin jetable monté sans ODIN_CLE_DIR ne dépose aucune clé dans le dossier des clés du profil', { skip: root0 }, () => {
  const f = fauxProfil();
  try {
    // a) dossier d'Odin sous le dossier temporaire, lancé hors du lanceur d'essais (un banc, un script)
    const home = mkdtempSync(join(f.tmp, 'odin-banc-'));
    const a = lancer(f, `
      const { createOdin } = await import(${JSON.stringify(src('runtime.ts'))});
      const { MockProvider } = await import(${JSON.stringify(src('providers/mock.ts'))});
      const v = await import(${JSON.stringify(src('vault.ts'))});
      const home = ${JSON.stringify(home)};
      const o = createOdin({ home, provider: new MockProvider([]) });
      v.writeSecretFile(home + '/env', 'A=1\\n'); const c = v.chiffrerChamp(home, 'secret');
      const lu = v.readSecretFile(home + '/env'), champ = v.dechiffrerChamp(home, c);
      try { o.close(); } catch {}
      console.log(JSON.stringify({ lu, champ, cle: v.machineKeyFile(home) }));
      process.exit(0);`);
    assert.ok(a.ok, a.brut);
    assert.equal(a.out.lu, 'A=1\n', 'le coffre jetable marche');
    assert.equal(a.out.champ, 'secret');
    assert.deepEqual(fichiers(f.clesReelles), [], `aucune clé dans le profil (clé rangée : ${String(a.out.cle)})`);
    assert.ok(!String(a.out.cle).startsWith(home), 'la clé reste hors du dossier d\'Odin');
    assert.equal(existsSync(f.odinReel), false, 'le vrai ~/.odin n\'est pas créé');

    // b) un banc (ODIN_ESSAI) dont le dossier n'est PAS sous le dossier temporaire
    const ailleurs = join(f.base, 'banc-hors-tmp'); mkdirSync(ailleurs);
    const b = lancer(f, `
      const v = await import(${JSON.stringify(src('vault.ts'))});
      v.writeSecretFile(${JSON.stringify(join(ailleurs, 'env'))}, 'B=2\\n');
      console.log(JSON.stringify({ lu: v.readSecretFile(${JSON.stringify(join(ailleurs, 'env'))}) }));`, { ODIN_ESSAI: '1' });
    assert.ok(b.ok, b.brut);
    assert.equal(b.out.lu, 'B=2\n');
    assert.deepEqual(fichiers(f.clesReelles), [], 'banc : aucune clé dans le profil');

    // c) Odin jetable avec ODIN_CLE_DIR pointé PAR ERREUR sur le dossier des clés du profil (l'incident de 16:02)
    const home2 = mkdtempSync(join(f.tmp, 'odin-banc-'));
    const c = lancer(f, `
      const v = await import(${JSON.stringify(src('vault.ts'))});
      v.writeSecretFile(${JSON.stringify(join(home2, 'env'))}, 'C=3\\n');
      console.log(JSON.stringify({ lu: v.readSecretFile(${JSON.stringify(join(home2, 'env'))}) }));`, { ODIN_CLE_DIR: f.clesReelles });
    assert.ok(c.ok, c.brut);
    assert.equal(c.out.lu, 'C=3\n');
    assert.deepEqual(fichiers(f.clesReelles), [], 'ODIN_CLE_DIR vers le profil : ignoré pour un Odin jetable');
  } finally { nettoyer(f); }
});

/** L'environnement sans aucune variable GIT_* : un GIT_DIR, GIT_WORK_TREE ou GIT_INDEX_FILE hérité ferait agir git
 *  sur un AUTRE dépôt (le 17/11 : un faux commit « v1 » posé dans le vrai dépôt). */
const sansGit = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(env).filter(([k]) => !/^GIT_/i.test(k)));

/** Un dépôt git d'application, avec une retouche locale (updateApp en fait une copie de côté). */
function depot(f: Faux): string {
  const g = (cwd: string, ...a: string[]) => { const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8', env: sansGit(f.env) }); assert.equal(r.status, 0, r.stderr); };
  const up = join(f.base, 'up'); mkdirSync(up);
  g(up, 'init', '-q', '-b', 'main'); writeFileSync(join(up, 'a.txt'), 'un\n'); g(up, 'add', '.'); g(up, 'commit', '-qm', 'v1');
  g(f.base, 'clone', '-q', '-c', 'core.autocrlf=false', up, 'app');
  const app = join(f.base, 'app');
  writeFileSync(join(app, 'a.txt'), 'retouche locale\n');
  return app;
}

test('(2) un essai qui appelle updateApp ou restorePublished sans dossier : erreur claire, rien dans ~/.odin', { skip: !avecGit }, () => {
  const f = fauxProfil();
  try {
    const app = depot(f);
    for (const fn of ['updateApp', 'restorePublished']) {
      // a) ODIN_HOME retiré après le chargement (la garde de src/vault.ts en avait posé un jetable) : refus franc
      const r = lancer(f, `
        const s = await import(${JSON.stringify(src('tools/self.ts'))});
        delete process.env.ODIN_HOME;
        let erreur = ''; try { s.${fn}(${JSON.stringify(app)}); } catch (e) { erreur = e.message; }
        console.log(JSON.stringify({ erreur }));`, { NODE_TEST_CONTEXT: 'child-v8' });
      assert.ok(r.ok, r.brut);
      assert.match(String(r.out.erreur), /dossier d'Odin jetable|mkdtemp/, `${fn} : refus franc qui dit quoi passer (${r.brut})`);
      // b) tel quel : la garde au chargement a donné un dossier jetable, rien ne va dans ~/.odin
      const b = lancer(f, `
        const s = await import(${JSON.stringify(src('tools/self.ts'))});
        try { s.${fn}(${JSON.stringify(app)}); } catch {}
        console.log(JSON.stringify({ home: process.env.ODIN_HOME }));`, { NODE_TEST_CONTEXT: 'child-v8' });
      assert.ok(b.ok, b.brut);
      assert.ok(String(b.out.home).toLowerCase().startsWith(f.tmp.toLowerCase()), `${fn} : dossier jetable (${String(b.out.home)})`);
      assert.equal(existsSync(f.odinReel), false, `${fn} : rien écrit dans le (faux) ~/.odin : ${fichiers(f.odinReel).join(', ')}`);
    }
  } finally { nettoyer(f); }
});

test('(3) ODIN_HOME vide ne désigne jamais le vrai dossier', { skip: !avecGit }, () => {
  const f = fauxProfil();
  try {
    const app = depot(f);
    // a) un vrai lancement (hors essai) avec ODIN_HOME vide : refus, rien dans ~/.odin
    const r = lancer(f, `
      const s = await import(${JSON.stringify(src('tools/self.ts'))});
      let erreur = ''; try { s.updateApp(${JSON.stringify(app)}); } catch (e) { erreur = e.message; }
      console.log(JSON.stringify({ erreur }));`, { ODIN_HOME: '' });
    assert.ok(r.ok, r.brut);
    assert.match(String(r.out.erreur), /ODIN_HOME/, `ODIN_HOME vide : erreur qui le nomme (${r.brut})`);
    assert.equal(existsSync(f.odinReel), false, `rien dans le (faux) ~/.odin : ${fichiers(f.odinReel).join(', ')}`);
    // b) les essais lancés par l'auto-vérification et par l'activation n'héritent ni du dossier ni des clés de l'Odin qui tourne
    const fr = join(f.base, 'code'); mkdirSync(join(fr, 'src', 'web'), { recursive: true }); mkdirSync(join(fr, 'test'));
    writeFileSync(join(fr, 'src', 'runtime.ts'), 'export {};\n'); writeFileSync(join(fr, 'src', 'web', 'server.ts'), 'export {};\n'); writeFileSync(join(fr, 'src', 'a.ts'), 'export {};\n');
    const trace = join(f.base, 'env-vu.jsonl');
    writeFileSync(join(fr, 'test', 'x.test.ts'), `// importe '../src/a.ts'\nimport { test } from 'node:test';\nimport { appendFileSync } from 'node:fs';\ntest('env', () => { appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ h: process.env.ODIN_HOME ?? null, c: process.env.ODIN_CLE_DIR ?? null }) + '\\n'); });\n`);
    const reelHome = join(f.base, 'odin-qui-tourne'), reelCles = join(f.base, 'cles-qui-tournent');
    const c = lancer(f, `
      const s = await import(${JSON.stringify(src('tools/self.ts'))});
      const a = s.checkApp(${JSON.stringify(fr)}, true), b = s.essaisDuLot(${JSON.stringify(fr)}, ['src/a.ts']);
      console.log(JSON.stringify({ a: a.ok, b: b.ok, sortie: a.output + b.output }));`, { ODIN_HOME: reelHome, ODIN_CLE_DIR: reelCles });
    assert.ok(c.ok, c.brut);
    const vus = readFileSync(trace, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { h: string | null; c: string | null });
    assert.equal(vus.length, 2, `les deux lancements d'essais ont tourné : ${c.brut}`);
    for (const v of vus) assert.deepEqual(v, { h: null, c: null }, 'ni ODIN_HOME (même vide) ni ODIN_CLE_DIR transmis aux essais');
  } finally { nettoyer(f); }
});

/** Dernier commit de src/vault.ts AVANT ce garde-fou (nommé : il ne bouge plus). */
const COMMIT_AVANT = '504905a1';
/**
 * Le code du coffre d'AVANT ce garde-fou, cherché dans l'ordre : le parent du commit qui l'a introduit (ou HEAD tant
 * qu'il n'est pas commité), le commit nommé, puis un fichier donné par ODIN_VAULT_AVANT (copie sans git). git en
 * lecture seule, sans aucune variable GIT_* héritée (sinon il lirait un autre dépôt).
 */
function vaultAvant(): string | undefined {
  const bon = (code: string | undefined) => (code && code.includes('machineKey') && !code.includes('estJetable') ? code : undefined);
  const g = (...a: string[]) => spawnSync('git', ['-c', 'safe.directory=*', '-C', ROOT, ...a], { encoding: 'utf8', env: sansGit(process.env) });
  if (avecGit) {
    const intro = g('log', '--reverse', '--format=%H', '-S', 'estJetable', '--', 'src/vault.ts').stdout?.trim().split('\n')[0];
    for (const rev of [intro ? `${intro}^` : 'HEAD', COMMIT_AVANT]) {
      const r = g('show', `${rev}:src/vault.ts`);
      if (r.status === 0 && bon(r.stdout)) return r.stdout;
    }
  }
  const fichier = process.env.ODIN_VAULT_AVANT;
  return fichier && existsSync(fichier) ? bon(readFileSync(fichier, 'utf8')) : undefined;
}

test('(4) une vraie installation garde son dossier de clés, sa clé et son coffre (coffre fait par le code d\'avant)', { skip: root0 }, () => {
  const ancien = vaultAvant();
  // Jamais sauté en silence : sans le code d'avant, la preuve n'est pas faite, et l'essai le dit en échouant.
  assert.ok(ancien, `code du coffre d'avant introuvable (ni dans git — commit ${COMMIT_AVANT} —, ni dans ODIN_VAULT_AVANT) : la preuve « une vraie installation garde son coffre » n'est pas faite. Joue cet essai dans le dépôt git, ou pose ODIN_VAULT_AVANT sur une copie du src/vault.ts d'avant.`);
  const f = fauxProfil();
  try {
    const dAncien = join(f.base, 'ancien'); mkdirSync(dAncien); writeFileSync(join(dAncien, 'vault.ts'), ancien);
    const home = f.odinReel; mkdirSync(home);
    const ecrire = (mod: string) => `
      const v = await import(${JSON.stringify(mod)});
      const home = ${JSON.stringify(home)};
      v.writeSecretFile(home + '/env', 'TOKEN=vrai\\n'); const champ = v.chiffrerChamp(home, 'adresse');
      console.log(JSON.stringify({ cle: v.machineKeyFile(home), dir: v.machineKeyDir(), champ }));`;
    const lire = (mod: string) => `
      const v = await import(${JSON.stringify(mod)});
      const home = ${JSON.stringify(home)};
      console.log(JSON.stringify({ cle: v.machineKeyFile(home), dir: v.machineKeyDir(), lu: v.readSecretFile(home + '/env'), champ: v.dechiffrerChamp(home, ${'${CHAMP}'}), perdue: v.machineKeyLost(home) ?? null }));`;
    const avant = lancer(f, ecrire(pathToFileURL(join(dAncien, 'vault.ts')).href));
    assert.ok(avant.ok, avant.brut);
    assert.equal(String(avant.out.dir), f.clesReelles, 'le code d\'avant range la clé dans le profil (vraie installation)');
    const cles = fichiers(f.clesReelles), contenu = readFileSync(String(avant.out.cle), 'utf8'), meta = readFileSync(join(home, 'vault.json'), 'utf8');
    assert.equal(cles.length, 1);
    const apres = lancer(f, lire(src('vault.ts')).replace('${CHAMP}', JSON.stringify(String(avant.out.champ))));
    assert.ok(apres.ok, apres.brut);
    assert.equal(apres.out.dir, avant.out.dir, 'même dossier de clés');
    assert.equal(apres.out.cle, avant.out.cle, 'même fichier de clé');
    assert.equal(apres.out.lu, 'TOKEN=vrai\n', 'le coffre fait avant s\'ouvre après');
    assert.equal(apres.out.champ, 'adresse', 'les champs privés aussi');
    assert.equal(apres.out.perdue, null, 'aucune clé déclarée perdue');
    assert.deepEqual(fichiers(f.clesReelles), cles, 'aucune clé ajoutée ni copie');
    assert.equal(readFileSync(String(avant.out.cle), 'utf8'), contenu, 'la clé n\'est pas réécrite');
    assert.equal(readFileSync(join(home, 'vault.json'), 'utf8'), meta, 'vault.json inchangé');
    assert.deepEqual(fichiers(home).filter((x) => x.includes('illisible')), [], 'aucun secret mis de côté');
  } finally { nettoyer(f); }
});

test('(5) une clé qui ne correspond pas n\'est jamais remplacée sans copie gardée à côté', { skip: root0 }, () => {
  const f = fauxProfil();
  try {
    const home = mkdtempSync(join(f.tmp, 'odin-cle-'));
    const r = lancer(f, `
      const { randomBytes } = await import('node:crypto');
      const { readFileSync, writeFileSync, readdirSync } = await import('node:fs');
      const { dirname, basename } = await import('node:path');
      const v = await import(${JSON.stringify(src('vault.ts'))});
      const home = ${JSON.stringify(home)};
      v.ensureVault(home);                       // coffre neuf, aucun secret encore : pas d'« orphelin »
      const f = v.machineKeyFile(home);
      const etrangere = 'brut:' + randomBytes(32).toString('base64');
      writeFileSync(f, etrangere); v.resetVaultCache(home);
      v.chiffrerChamp(home, 'x');                // la clé ne correspond pas : elle est remplacée…
      const copies1 = readdirSync(dirname(f)).filter((n) => n.startsWith(basename(f) + '.'));
      const garde1 = copies1.map((n) => readFileSync(dirname(f) + '/' + n, 'utf8'));
      const etrangere2 = 'brut:' + randomBytes(32).toString('base64');
      writeFileSync(f, etrangere2); v.resetVaultCache(home);
      v.chiffrerChamp(home, 'y');                // …une 2e fois : la 1re copie n'est pas écrasée
      const copies2 = readdirSync(dirname(f)).filter((n) => n.startsWith(basename(f) + '.'));
      const garde2 = copies2.map((n) => readFileSync(dirname(f) + '/' + n, 'utf8'));
      console.log(JSON.stringify({ etrangere, etrangere2, garde1, garde2 }));`);
    assert.ok(r.ok, r.brut);
    const o = r.out as { etrangere: string; etrangere2: string; garde1: string[]; garde2: string[] };
    assert.deepEqual(o.garde1, [o.etrangere], 'la clé remplacée est gardée à côté');
    assert.deepEqual([...o.garde2].sort(), [o.etrangere, o.etrangere2].sort(), 'les deux clés remplacées sont gardées, aucune copie écrasée');
  } finally { nettoyer(f); }
});

test('(6) sous essai, le coffre refuse le vrai dossier ~/.odin (sinon les vrais secrets partiraient en « .illisible »)', { skip: root0 }, () => {
  const f = fauxProfil();
  try {
    mkdirSync(f.odinReel);
    writeFileSync(join(f.odinReel, 'vault.json'), '{"v":2,"mode":"machine","cle":"0123456789abcdef","check":"x"}');
    writeFileSync(join(f.odinReel, 'env.enc'), 'vrai secret chiffré');
    const r = lancer(f, `
      const v = await import(${JSON.stringify(src('vault.ts'))});
      const home = ${JSON.stringify(f.odinReel)};
      const essais = [() => v.readSecretFile(home + '/env'), () => v.writeSecretFile(home + '/env', 'x'), () => v.chiffrerChamp(home, 'x'), () => v.ensureVault(home)];
      console.log(JSON.stringify({ erreurs: essais.map((e) => { try { e(); return ''; } catch (x) { return x.message; } }) }));`, { NODE_TEST_CONTEXT: 'child-v8' });
    assert.ok(r.ok, r.brut);
    for (const e of r.out.erreurs as string[]) assert.match(e, /dossier d'Odin jetable|mkdtemp/, `refus franc : ${r.brut}`);
    assert.deepEqual(fichiers(f.odinReel).sort(), ['env.enc', 'vault.json'], 'rien mis de côté, rien ajouté');
    assert.equal(readFileSync(join(f.odinReel, 'env.enc'), 'utf8'), 'vrai secret chiffré');
  } finally { nettoyer(f); }
});

test('(8) un banc ou un essai qui monte Odin sans dossier ne touche jamais au vrai ~/.odin (ni écriture, ni suppression)', { skip: root0 }, () => {
  for (const contexte of [{ ODIN_ESSAI: '1' }, { NODE_TEST_CONTEXT: 'child-v8' }]) {
    const f = fauxProfil();
    try {
      // Le faux ~/.odin a une copie d'avant restauration : createOdin la supprimait (cleanupRestore) avant tout refus.
      mkdirSync(join(f.odinReel, 'memoire'), { recursive: true });
      writeFileSync(join(f.odinReel, 'memoire', 'notes.json.avant-restauration'), 'copie précieuse');
      const avant = fichiers(f.odinReel).sort();
      const r = lancer(f, `
        const { createOdin } = await import(${JSON.stringify(src('runtime.ts'))});
        const { MockProvider } = await import(${JSON.stringify(src('providers/mock.ts'))});
        const v = await import(${JSON.stringify(src('vault.ts'))});
        let home = '', erreur = '';
        try { const o = createOdin({ provider: new MockProvider([]) }); home = o.paths?.home ?? ''; try { o.close(); } catch {} } catch (e) { erreur = e.message; }
        delete process.env.ODIN_HOME;
        let parDefaut = ''; try { v.dossierOdinParDefaut(); } catch (e) { parDefaut = e.message; }
        console.log(JSON.stringify({ home, erreur, parDefaut }));
        process.exit(0);`, contexte);
      assert.ok(r.ok, r.brut);
      const quoi = Object.keys(contexte)[0];
      assert.deepEqual(fichiers(f.odinReel).sort(), avant, `${quoi} : le (faux) ~/.odin est intact (${r.brut})`);
      assert.equal(readFileSync(join(f.odinReel, 'memoire', 'notes.json.avant-restauration'), 'utf8'), 'copie précieuse');
      if (r.out.home) assert.ok(String(r.out.home).toLowerCase().startsWith(f.tmp.toLowerCase()), `${quoi} : Odin monté dans un dossier jetable (${String(r.out.home)})`);
      assert.match(String(r.out.parDefaut), /dossier d'Odin jetable|mkdtemp/, `${quoi} : sans ODIN_HOME, le dossier par défaut est refusé franchement`);
      assert.ok(!r.brut.includes(f.profil), `${quoi} : aucun message ne montre le chemin du profil`);
    } finally { nettoyer(f); }
  }
});

test('(9) une vraie installation déplacée sous le dossier temporaire garde sa clé et son coffre ; sans sa clé, refus sans rien mettre de côté', { skip: root0 }, () => {
  const f = fauxProfil();
  try {
    const avant = join(f.profil, 'OdinData'), apres = join(f.tmp, 'OdinData');
    const ecrire = lancer(f, `
      const v = await import(${JSON.stringify(src('vault.ts'))});
      const { mkdirSync } = await import('node:fs');
      const h = ${JSON.stringify(avant)}; mkdirSync(h, { recursive: true });
      v.writeSecretFile(h + '/machines.json', '{"secret":"S"}');
      console.log(JSON.stringify({ cle: v.machineKeyFile(h) }));`);
    assert.ok(ecrire.ok, ecrire.brut);
    assert.ok(String(ecrire.out.cle).startsWith(f.clesReelles), 'vraie installation : clé dans le dossier des clés du profil');
    const cles = fichiers(f.clesReelles);
    const deplacer = (de: string, vers: string) => { mkdirSync(vers, { recursive: true }); for (const n of readdirSync(de)) writeFileSync(join(vers, n), readFileSync(join(de, n))); rmSync(de, { recursive: true }); };
    deplacer(avant, apres);
    const lire = (h: string) => lancer(f, `
      const v = await import(${JSON.stringify(src('vault.ts'))});
      const { readdirSync } = await import('node:fs');
      const h = ${JSON.stringify(h)};
      let lu = null, erreur = ''; try { lu = v.readSecretFile(h + '/machines.json') ?? null; } catch (e) { erreur = e.message; }
      console.log(JSON.stringify({ cle: v.machineKeyFile(h), lu, erreur, dossier: readdirSync(h) }));`);
    const r = lire(apres);
    assert.ok(r.ok, r.brut);
    assert.equal(r.out.lu, '{"secret":"S"}', `le coffre s'ouvre toujours (${r.brut})`);
    assert.equal(r.out.cle, ecrire.out.cle, 'même fichier de clé');
    assert.deepEqual((r.out.dossier as string[]).filter((n) => n.includes('illisible')), [], 'aucun secret mis de côté');
    assert.deepEqual(fichiers(f.clesReelles), cles, 'aucune clé ajoutée');
    // Sa clé a disparu : jamais « .illisible » pour la seule raison qu'il est sous le dossier temporaire ; refus clair.
    rmSync(String(ecrire.out.cle));
    const p = lire(apres);
    assert.ok(p.ok, p.brut);
    assert.match(String(p.out.erreur), /dossier temporaire/, `refus qui dit pourquoi (${p.brut})`);
    assert.deepEqual((p.out.dossier as string[]).filter((n) => n.includes('illisible')), [], 'rien mis de côté');
    assert.ok((p.out.dossier as string[]).includes('machines.json.enc'), 'le secret chiffré est toujours là');
  } finally { nettoyer(f); }
});

test('(10) le vrai dossier des clés de la machine se lit sans ambiguïté, même sous un banc (dossierClesMachine)', { skip: root0 }, () => {
  const f = fauxProfil();
  try {
    const r = lancer(f, `
      const v = await import(${JSON.stringify(src('vault.ts'))});
      console.log(JSON.stringify({ d: v.dossierClesMachine() }));`, { ODIN_ESSAI: '1' });
    assert.ok(r.ok, r.brut);
    assert.equal(r.out.d, f.clesReelles);
    assert.deepEqual(fichiers(f.clesReelles), [], 'lu seulement, rien créé');
  } finally { nettoyer(f); }
});

test('(11) un Odin jetable ignore un ODIN_CLE_DIR qui recoupe le dossier des clés, son dossier « Odin » ou le vrai ~/.odin', { skip: root0 }, () => {
  const f = fauxProfil();
  try {
    const cibles = [f.odinReel, f.profil, join(f.clesReelles, 'sous')];
    if (process.platform === 'win32') cibles.push(join(f.env.LOCALAPPDATA!, 'Odin'));
    for (const cible of cibles) {
      const home = mkdtempSync(join(f.tmp, 'odin-banc-'));
      const r = lancer(f, `
        const v = await import(${JSON.stringify(src('vault.ts'))});
        v.writeSecretFile(${JSON.stringify(join(home, 'env'))}, 'K=1\\n');
        console.log(JSON.stringify({ lu: v.readSecretFile(${JSON.stringify(join(home, 'env'))}), cle: v.machineKeyFile(${JSON.stringify(home)}) }));`, { ODIN_CLE_DIR: cible });
      assert.ok(r.ok, r.brut);
      assert.equal(r.out.lu, 'K=1\n');
      assert.ok(!String(r.out.cle).toLowerCase().startsWith(f.profil.toLowerCase()), `ODIN_CLE_DIR=${cible} : clé hors du profil (${String(r.out.cle)})`);
      assert.ok(!r.brut.includes(f.profil), `le message ne montre pas le chemin : ${r.brut}`);
    }
    assert.deepEqual(fichiers(f.profil).filter((x) => /odin|\.cle$/i.test(x)), [], 'aucun dossier ni clé d\'Odin dans le profil');
    assert.equal(existsSync(f.odinReel), false, 'le vrai ~/.odin n\'est pas créé');
  } finally { nettoyer(f); }
});

test('(7) un essai qui oublie ODIN_HOME reçoit un dossier jetable (test/helpers.ts), jamais ~/.odin', { skip: root0 }, () => {
  const f = fauxProfil();
  try {
    for (const vide of [undefined, '']) {
      const r = lancer(f, `
        await import(${JSON.stringify(pathToFileURL(join(ROOT, 'test', 'helpers.ts')).href)});
        const { odinPaths } = await import(${JSON.stringify(src('config.ts'))});
        console.log(JSON.stringify({ home: odinPaths().home }));`, { NODE_TEST_CONTEXT: 'child-v8', ...(vide === undefined ? {} : { ODIN_HOME: vide }) });
      assert.ok(r.ok, r.brut);
      const home = String(r.out.home);
      assert.ok(home.toLowerCase().startsWith(f.tmp.toLowerCase()), `ODIN_HOME ${vide === undefined ? 'absent' : 'vide'} : dossier jetable (${home})`);
      assert.equal(existsSync(home), false, 'retiré à la fin de l\'essai');
    }
    assert.equal(existsSync(f.odinReel), false);
  } finally { nettoyer(f); }
});

test('(12) un essai ou un banc qui donne lui-même le vrai ~/.odin (ou un dossier qui le contient) à createOdin est refusé avant toute écriture ou suppression', { skip: root0 }, () => {
  for (const contexte of [{ ODIN_ESSAI: '1' }, { NODE_TEST_CONTEXT: 'child-v8' }]) {
    const f = fauxProfil();
    try {
      mkdirSync(join(f.odinReel, 'memoire'), { recursive: true });
      writeFileSync(join(f.odinReel, 'memoire', 'notes.json.avant-restauration'), 'copie précieuse');
      writeFileSync(join(f.odinReel, 'config.json'), '{"reglage":"du proprietaire"}');
      const avantOdin = fichiers(f.odinReel).sort(), avantProfil = fichiers(f.profil).sort();
      const r = lancer(f, `
        const { createOdin } = await import(${JSON.stringify(src('runtime.ts'))});
        const { MockProvider } = await import(${JSON.stringify(src('providers/mock.ts'))});
        const erreurs = [];
        for (const home of [${JSON.stringify(f.odinReel)}, ${JSON.stringify(f.profil)}]) {
          try { const o = createOdin({ home, provider: new MockProvider([]) }); try { o.close(); } catch {} erreurs.push(''); } catch (e) { erreurs.push(e.message); }
        }
        console.log(JSON.stringify({ erreurs }));
        process.exit(0);`, contexte);
      const quoi = Object.keys(contexte)[0];
      assert.ok(r.ok, r.brut);
      for (const e of r.out.erreurs as string[]) assert.match(e, /vrai dossier d'Odin/, `${quoi} : refus franc (${r.brut})`);
      assert.deepEqual(fichiers(f.odinReel).sort(), avantOdin, `${quoi} : rien écrit ni supprimé dans le (faux) ~/.odin`);
      assert.deepEqual(fichiers(f.profil).sort(), avantProfil, `${quoi} : rien écrit ni supprimé dans le (faux) profil`);
      assert.equal(readFileSync(join(f.odinReel, 'memoire', 'notes.json.avant-restauration'), 'utf8'), 'copie précieuse');
      assert.equal(readFileSync(join(f.odinReel, 'config.json'), 'utf8'), '{"reglage":"du proprietaire"}');
      assert.ok(!r.brut.includes(f.profil), `${quoi} : aucun message ne montre le chemin du profil`);
    } finally { nettoyer(f); }
  }
});

/** Ce que rendent, dans un sous-processus, les dossiers par défaut des applis (github_app « arreter ») et de Hringhorni. */
const sondeDefauts = (entre: string, avant = '') => `
  ${avant}
  const { githubApp } = await import(${JSON.stringify(src('tools/apps.ts'))});
  const { defaultDir } = await import(${JSON.stringify(src('valhalla/hringhorni/store.ts'))});
  const applis = async () => { try { return String(await githubApp.run({ action: 'arreter', cible: 'exemple/appli' }, {})); } catch (e) { return 'refus : ' + e.message; } };
  const hr = () => { try { return defaultDir(); } catch (e) { return 'refus : ' + e.message; } };
  const premier = { applis: await applis(), hr: hr() };
  ${entre}
  const second = { applis: await applis(), hr: hr() };
  console.log(JSON.stringify({ ...(globalThis.extra ?? {}), premier, second }));
  process.exit(0);`;

test('(13) sous un essai ou un banc, les dossiers par défaut qui ignoraient ODIN_HOME (applis, Hringhorni) ne visent plus le profil', { skip: root0 }, () => {
  for (const contexte of [{ ODIN_ESSAI: '1' }, { NODE_TEST_CONTEXT: 'child-v8' }]) {
    const f = fauxProfil();
    try {
      // Une appli « installée » dans le (faux) ~/.odin : un essai ne doit jamais la voir (ni lancer docker dedans).
      mkdirSync(join(f.odinReel, 'apps', 'exemple-appli'), { recursive: true });
      const avant = fichiers(f.profil).sort();
      const r = lancer(f, sondeDefauts('delete process.env.ODIN_HOME;'), contexte);
      const quoi = Object.keys(contexte)[0];
      assert.ok(r.ok, r.brut);
      const o = r.out as { premier: { applis: string; hr: string }; second: { applis: string; hr: string } };
      // a) ODIN_HOME jetable (posé au chargement) : les défauts le prennent
      assert.match(o.premier.applis, /pas installée/, `${quoi} : applis cherchées dans le dossier jetable, pas dans ~/.odin (${r.brut})`);
      assert.ok(o.premier.hr.toLowerCase().startsWith(f.tmp.toLowerCase()), `${quoi} : Hringhorni dans le dossier jetable (${o.premier.hr})`);
      // b) ODIN_HOME retiré ensuite : refus franc, jamais le profil
      assert.match(o.second.applis, /^refus : .*jetable/, `${quoi} : applis sans dossier : refus (${o.second.applis})`);
      assert.match(o.second.hr, /^refus : .*jetable/, `${quoi} : Hringhorni sans dossier : refus (${o.second.hr})`);
      assert.deepEqual(fichiers(f.profil).sort(), avant, `${quoi} : rien écrit dans le (faux) profil`);
      assert.ok(!r.brut.includes(f.profil), `${quoi} : aucun message ne montre le chemin du profil`);
    } finally { nettoyer(f); }
  }
});

test('(14) une vraie installation ne change en rien : même dossier d\'Odin, mêmes défauts pour les applis et Hringhorni', { skip: root0 }, () => {
  const f = fauxProfil();
  try {
    mkdirSync(join(f.odinReel, 'apps', 'exemple-appli'), { recursive: true });
    const autre = join(f.base, 'odin-ailleurs');
    const r = lancer(f, sondeDefauts(`process.env.ODIN_HOME = ${JSON.stringify(autre)};`, `
      const { createOdin } = await import(${JSON.stringify(src('runtime.ts'))});
      const { MockProvider } = await import(${JSON.stringify(src('providers/mock.ts'))});
      const homes = [];
      for (const home of [undefined, ${JSON.stringify(f.odinReel)}]) { const o = createOdin({ home, provider: new MockProvider([]) }); homes.push(o.paths.home); try { o.close(); } catch {} }
      globalThis.extra = { homes };`));
    assert.ok(r.ok, r.brut);
    const o = r.out as { homes: string[]; premier: { applis: string; hr: string }; second: { applis: string; hr: string } };
    assert.deepEqual(o.homes, [f.odinReel, f.odinReel], `createOdin sans dossier ou avec ~/.odin : le vrai ~/.odin, comme avant (${r.brut})`);
    const hrReel = join(f.profil, '.local', 'share', 'odin', 'hringhorni');
    for (const [k, v] of Object.entries({ 'sans ODIN_HOME': o.premier, 'avec ODIN_HOME': o.second })) {
      assert.doesNotMatch(v.applis, /pas installée|refus/, `${k} : l'appli de ~/.odin est toujours vue (${v.applis})`);
      assert.equal(v.hr, hrReel, `${k} : Hringhorni au même endroit qu'avant`);
    }
    assert.equal(existsSync(autre), false);
  } finally { nettoyer(f); }
});

test('(15) la fabrique de dépôt de ces essais n\'agit que sur son propre dépôt, même avec GIT_DIR, GIT_WORK_TREE et GIT_INDEX_FILE hérités', { skip: !avecGit }, () => {
  const f = fauxProfil();
  try {
    // Un LEURRE jetable joue le dépôt qu'un GIT_DIR hérité viserait (l'incident du 17/11 : le vrai dépôt).
    const leurre = join(f.base, 'leurre'); mkdirSync(leurre);
    const propre = { ...f.env };
    const gl = (...a: string[]) => spawnSync('git', ['-c', 'safe.directory=*', '-C', leurre, ...a], { encoding: 'utf8', env: propre });
    assert.equal(gl('init', '-q').status, 0);
    f.env.GIT_DIR = join(leurre, '.git'); f.env.GIT_WORK_TREE = leurre; f.env.GIT_INDEX_FILE = join(leurre, '.git', 'index-leurre');
    let erreur = '', app = '';
    try { app = depot(f); } catch (e) { erreur = (e as Error).message; }
    assert.notEqual(gl('rev-parse', '-q', '--verify', 'HEAD').status, 0, `aucun commit dans le leurre (${gl('log', '--oneline').stdout})`);
    assert.equal(existsSync(join(leurre, '.git', 'index-leurre')), false, 'aucun index posé dans le leurre');
    assert.deepEqual(readdirSync(leurre), ['.git'], 'rien dans l\'arbre du leurre');
    assert.equal(erreur, '', 'le dépôt d\'essai se fabrique quand même');
    const log = spawnSync('git', ['-c', 'safe.directory=*', '-C', app, 'log', '--format=%s'], { encoding: 'utf8', env: propre });
    assert.equal(log.stdout.trim(), 'v1', 'le commit est dans son propre dépôt');
  } finally { nettoyer(f); }
});
