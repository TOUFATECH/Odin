#!/usr/bin/env node
// Point d'entrée exécutable : Node ≥ 22.18 exécute le TypeScript directement
// (suppression des types native), donc aucune étape de compilation n'est nécessaire.

// Le module SQLite intégré à Node affiche un avertissement « expérimental » : on le masque.
const emit = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (/SQLite is an experimental feature|Type Stripping/i.test(text)) return;
  return emit.call(process, warning, ...rest);
};

try {
  await import('../src/cli/main.ts');
} catch (e) {
  // Le code ne se lit plus à cause d'une fusion ratée (mise à jour interrompue, retouche locale en conflit) :
  // on le remet tel que publié, une seule fois, puis on relance. Rien n'est perdu : les retouches restent de
  // côté (copie .patch dans ~/.odin/self-backups, et « git stash list »). Toute autre erreur remonte telle quelle.
  if (process.env.ODIN_REPARE || !(await healConflict(e))) throw e;
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, ODIN_REPARE: '1' } });
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => child.kill(s));
  process.exitCode = await new Promise((done) => child.on('exit', (code, sig) => done(code ?? (sig ? 1 : 0))));
}

/** Vrai si le code était en conflit et a été remis tel que publié. */
async function healConflict(e) {
  if (e?.code !== 'ERR_INVALID_TYPESCRIPT_SYNTAX' && !/Merge conflict marker/i.test(String(e?.message ?? e))) return false;
  try {
    const { spawnSync } = await import('node:child_process');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = fileURLToPath(new URL('../', import.meta.url));
    const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
    if (git('rev-parse', '--git-dir').status !== 0) return false;
    const bad = `${git('diff', '--name-only', '--diff-filter=U').stdout}${git('grep', '-l', '-I', '-E', '^(<{7}|>{7}) ', '--', '*.ts', '*.mjs', '*.js', '*.json').stdout}`.trim();
    if (!bad) return false;
    try {
      const dir = join(process.env.ODIN_HOME || join(homedir(), '.odin'), 'self-backups');
      const d = git('stash', 'list').stdout.trim() ? git('stash', 'show', '-p', 'stash@{0}') : git('diff', 'HEAD');
      if (d.stdout.trim()) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `retouches-locales-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.patch`), d.stdout); }
    } catch { /* la réserve de git les garde de toute façon */ }
    if (git('reset', '--hard', 'HEAD').status !== 0) return false;
    console.error('[odin] le code était resté en conflit après une mise à jour : je l\'ai remis tel que publié (mes retouches locales sont de côté dans ~/.odin/self-backups). Je redémarre.');
    return true;
  } catch { return false; }
}
