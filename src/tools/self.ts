// Odin se modifie et se met à jour lui-même.
//
// - self_info / self_read : voir son propre code (dossier de l'application).
// - self_edit : modifier un fichier de son code ; l'original est sauvegardé AVANT
//   (~/.odin/self-backups/), pour revenir en arrière avec self_rollback.
// - self_check : vérifier que le code se charge (et, au choix, lancer les tests).
// - self_update : récupérer la dernière version (git), en gardant ses propres améliorations.
// - self_restart : redémarrer pour appliquer — refusé si la vérification échoue.
// Heimdall valide selon ton autonomie ; le code de sécurité (heimdall/) ne se modifie jamais
// depuis une conversation qui a lu du contenu non fiable.

import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bool, obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
const clip = (t: string, n = 12_000) => (t.length > n ? `${t.slice(0, n)}\n… [${t.length - n} caractères tronqués]` : t);

/** Dossier de l'application Odin (là où se trouve ce code). */
export const APP_ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));

/** Chemin d'un fichier du code d'Odin (jamais .git ni node_modules, jamais hors du dossier). */
export function appPath(rel: string, root = APP_ROOT): string {
  const p = resolve(root, rel.replace(/^[\\/]+/, ''));
  const r = relative(root, p);
  if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error(`Hors du code d'Odin : ${rel}`);
  if (/^(\.git|node_modules)([\\/]|$)/.test(r)) throw new Error(`Dossier interdit : ${r.split(sep)[0]}`);
  return p;
}

const isSecurityCode = (rel: string) => /^src[\\/]heimdall[\\/]/.test(rel);
const git = (root: string, args: string[]) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 120_000 });
export const hasGit = (root = APP_ROOT) => existsSync(join(root, '.git')) && git(root, ['--version']).status === 0;

// ---------- sauvegardes avant modification ----------

interface ChangeSet { id: string; at: string; files: string[]; reason?: string }
const backupsDir = (home: string) => join(home, 'self-backups');
const manifest = (home: string) => join(backupsDir(home), 'journal.json');
function readJournal(home: string): ChangeSet[] { try { return JSON.parse(readFileSync(manifest(home), 'utf8')) as ChangeSet[]; } catch { return []; } }
function writeJournal(home: string, j: ChangeSet[]) { mkdirSync(backupsDir(home), { recursive: true }); writeFileSync(manifest(home), JSON.stringify(j.slice(-30), null, 2)); }

/** Sauvegarde l'original d'un fichier (une fois par lot de modifications). Fichier nouveau : noté pour être supprimé au retour arrière. */
export function backupFile(home: string, root: string, rel: string, setId: string): void {
  const j = readJournal(home);
  let set = j.find((c) => c.id === setId);
  if (!set) { set = { id: setId, at: new Date().toISOString(), files: [] }; j.push(set); }
  if (set.files.includes(rel)) return;
  const src = join(root, rel), dst = join(backupsDir(home), setId, rel);
  mkdirSync(dirname(dst), { recursive: true });
  if (existsSync(src)) copyFileSync(src, dst); else writeFileSync(`${dst}.nouveau`, '');
  set.files.push(rel);
  writeJournal(home, j);
}

/** Restaure les fichiers d'un lot (le dernier par défaut). */
export function rollback(home: string, root: string, setId?: string): { id: string; files: string[] } | undefined {
  const j = readJournal(home);
  const set = setId ? j.find((c) => c.id === setId) : j.at(-1);
  if (!set) return undefined;
  for (const rel of set.files) {
    const b = join(backupsDir(home), set.id, rel);
    if (existsSync(b)) copyFileSync(b, join(root, rel));
    else if (existsSync(`${b}.nouveau`)) rmSync(join(root, rel), { force: true });
  }
  writeJournal(home, j.filter((c) => c !== set));
  return { id: set.id, files: set.files };
}

// ---------- vérification, mise à jour, redémarrage ----------

/** Le code se charge-t-il ? (et les tests passent-ils, si demandé). */
export function checkApp(root = APP_ROOT, tests = false): { ok: boolean; output: string } {
  const node = process.execPath, flags = ['--disable-warning=ExperimentalWarning'];
  const load = spawnSync(node, [...flags, '--input-type=module', '-e', `await import(${JSON.stringify(pathToUrl(join(root, 'src/runtime.ts')))}); await import(${JSON.stringify(pathToUrl(join(root, 'src/web/server.ts')))}); console.log('chargement : ok')`], { encoding: 'utf8', timeout: 120_000, cwd: root });
  let out = `${load.stdout}${load.stderr}`.trim();
  if (load.status !== 0) return { ok: false, output: `Le code ne se charge plus :\n${out}` };
  if (tests && existsSync(join(root, 'test'))) {
    const files = readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.ts')).map((f) => join('test', f));
    const t = spawnSync(node, [...flags, '--test', ...files], { encoding: 'utf8', timeout: 900_000, cwd: root, env: { ...process.env, ODIN_HOME: '' } });
    const summary = `${t.stdout}${t.stderr}`.split('\n').filter((l) => /^# (tests|pass|fail)|^not ok|✖/.test(l)).slice(0, 40).join('\n');
    out += `\ntests :\n${summary}`;
    if (t.status !== 0) return { ok: false, output: out };
  }
  return { ok: true, output: out };
}
const pathToUrl = (p: string) => `file://${p.startsWith('/') ? '' : '/'}${p.replace(/\\/g, '/')}`;

/** Met Odin à jour (git pull) en gardant ses propres modifications locales (stash puis réapplication). */
export function updateApp(root = APP_ROOT): { ok: boolean; message: string } {
  if (!hasGit(root)) return { ok: false, message: 'Odin n\'a pas été installé avec git : relance l\'installateur pour le mettre à jour.' };
  const before = git(root, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=no']).stdout.trim() !== '';
  if (dirty && git(root, ['stash', 'push', '-m', `odin-auto-${Date.now()}`]).status !== 0) return { ok: false, message: 'Impossible de mettre de côté mes modifications locales.' };
  const pull = git(root, ['pull', '--ff-only']);
  let msg = '';
  if (pull.status !== 0) msg = `Mise à jour impossible : ${(pull.stderr || pull.stdout).trim().slice(0, 400)}`;
  if (dirty) {
    const pop = git(root, ['stash', 'pop']);
    if (pop.status !== 0) {
      git(root, ['checkout', '--', '.']);
      msg += `${msg ? '\n' : ''}Mes modifications locales entrent en conflit avec la nouvelle version : la nouvelle version est gardée, mes modifications restent dans « git stash list » (à réappliquer à la main).`;
    }
  }
  if (pull.status !== 0) return { ok: false, message: msg };
  const after = git(root, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  const log = before === after ? '' : git(root, ['log', '--oneline', `${before}..${after}`]).stdout.trim().split('\n').slice(0, 15).join('\n');
  return { ok: true, message: `${before === after ? 'Déjà à jour' : `Mis à jour ${before} → ${after}`}${log ? `\n${log}` : ''}${dirty ? `\n${msg || 'Mes modifications locales sont réappliquées.'}` : ''}` };
}

/** Sous un service (systemd, launchd), on quitte avec un code d'erreur : le service relance Odin. Sinon on se relance soi-même. */
export function restartSelf(delayMs = 1500, exit: (code: number) => void = (c) => process.exit(c)): string {
  const service = process.platform !== 'win32' && Boolean(process.env.INVOCATION_ID || process.env.XPC_SERVICE_NAME?.includes('odin') || process.env.ODIN_SERVICE);
  setTimeout(() => {
    if (!service) {
      const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { detached: true, stdio: 'ignore', env: { ...process.env, ODIN_RESTARTED: '1' }, windowsHide: true });
      child.unref();
    }
    exit(service ? 75 : 0);
  }, delayMs).unref?.();
  return service ? 'Redémarrage par le service dans un instant.' : 'Je me relance dans un instant.';
}

// ---------- outils ----------

const setIdFor = (ctx: ToolContext) => `${new Date().toISOString().slice(0, 10)}-${ctx.sessionId.replace(/[^\w-]/g, '_').slice(0, 40)}`;

export const selfInfo: Tool = {
  name: 'self_info',
  description: 'Ton propre code : dossier, version, modifications locales, sauvegardes, liste des fichiers d\'un dossier (« dir »). Pour t\'améliorer, lis d\'abord le code concerné.',
  risk: 'read',
  schema: obj({ dir: str('sous-dossier à lister (ex. src/tools)') }),
  async run(i, ctx) {
    const root = APP_ROOT;
    const version = (() => { try { return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version; } catch { return '?'; } })();
    const lines = [`Code d'Odin : ${root}`, `Version : ${version}`];
    if (hasGit(root)) {
      lines.push(`Commit : ${git(root, ['log', '-1', '--format=%h %s (%cr)']).stdout.trim()}`);
      const st = git(root, ['status', '--short']).stdout.trim();
      lines.push(st ? `Modifications locales :\n${st}` : 'Aucune modification locale.');
    } else lines.push('Installé sans git (mise à jour : réinstallation).');
    const j = ctx.home ? readJournal(ctx.home) : [];
    if (j.length) lines.push(`Sauvegardes (self_rollback) :\n${j.slice(-5).map((c) => `- ${c.id} : ${c.files.join(', ')}`).join('\n')}`);
    const dir = s(i.dir) ? appPath(s(i.dir)) : join(root, 'src');
    lines.push(`Fichiers de ${relative(root, dir) || '.'} :\n${readdirSync(dir, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join('  ')}`);
    return lines.join('\n');
  },
};

export const selfRead: Tool = {
  name: 'self_read',
  description: 'Lit un fichier de ton propre code (chemin relatif au dossier d\'Odin, ex. src/tools/search.ts).',
  risk: 'read',
  schema: obj({ path: str('fichier, relatif au dossier d\'Odin'), grep: str('ne montrer que les lignes contenant ce texte (facultatif)') }, ['path']),
  async run(i) {
    const p = appPath(s(i.path));
    if (statSync(p).size > 2_000_000) return 'Fichier trop volumineux.';
    const all = readFileSync(p, 'utf8').split('\n').map((l, k) => `${k + 1}\t${l}`);
    const g = s(i.grep);
    return clip((g ? all.filter((l) => l.includes(g)) : all).join('\n'), 40_000);
  },
};

export const selfEdit: Tool = {
  name: 'self_edit',
  description: 'Modifie ton propre code pour t\'améliorer : remplace un passage exact (old → new) ou écrit un fichier entier (content). L\'original est sauvegardé. Ensuite : self_check, puis self_restart pour appliquer.',
  risk: 'exec',
  schema: obj({ path: str('fichier, relatif au dossier d\'Odin'), old: str('passage exact et unique à remplacer'), new: str('nouveau texte'), content: str('contenu complet (nouveau fichier ou réécriture)'), reason: str('pourquoi (amélioration visée)') }, ['path']),
  summarize: (i) => `modifier mon code : ${s(i.path)}${s(i.reason) ? ` — ${s(i.reason)}` : ''}`,
  async run(i, ctx) {
    const p = appPath(s(i.path));
    const rel = relative(APP_ROOT, p);
    if (isSecurityCode(rel) && ctx.isTainted()) return 'Refusé : le code de sécurité (heimdall/) ne se modifie pas depuis une conversation qui a lu du contenu extérieur. Recommence dans une conversation propre.';
    if (!ctx.home) return 'Erreur : dossier d\'Odin inconnu (sauvegarde impossible).';
    let next: string;
    if (i.content !== undefined && i.old === undefined) next = s(i.content);
    else {
      if (!existsSync(p)) return 'Échec : fichier introuvable (donne « content » pour le créer).';
      const text = readFileSync(p, 'utf8');
      const count = text.split(s(i.old)).length - 1;
      if (!s(i.old) || count !== 1) return `Échec : le passage apparaît ${count} fois (il doit être unique).`;
      next = text.replace(s(i.old), () => s(i.new));
    }
    const id = setIdFor(ctx);
    backupFile(ctx.home, APP_ROOT, rel, id);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, next);
    return `Modifié : ${rel} (sauvegarde ${id}). Vérifie avec self_check avant self_restart.`;
  },
};

export const selfCheck: Tool = {
  name: 'self_check',
  description: 'Vérifie que ton code se charge sans erreur ; « tests » lance aussi la suite de tests (plus long). À faire après chaque self_edit.',
  risk: 'exec',
  schema: obj({ tests: bool('lancer aussi les tests') }),
  summarize: (i) => `vérifier mon code${i.tests ? ' (avec les tests)' : ''}`,
  async run(i) {
    const r = checkApp(APP_ROOT, Boolean(i.tests));
    return `${r.ok ? '✓ OK' : '✗ ÉCHEC — corrige ou annule avec self_rollback'}\n${clip(r.output)}`;
  },
};

export const selfRollback: Tool = {
  name: 'self_rollback',
  description: 'Annule ton dernier lot de modifications de code (ou celui donné par « id ») en restaurant les originaux.',
  risk: 'write',
  schema: obj({ id: str('lot à annuler (voir self_info) ; le dernier par défaut') }),
  summarize: (i) => `annuler mes modifications de code${s(i.id) ? ` (${s(i.id)})` : ''}`,
  async run(i, ctx) {
    if (!ctx.home) return 'Erreur : dossier d\'Odin inconnu.';
    const r = rollback(ctx.home, APP_ROOT, s(i.id) || undefined);
    return r ? `Restauré (${r.id}) : ${r.files.join(', ')}` : 'Aucune sauvegarde à restaurer.';
  },
};

export const selfUpdate: Tool = {
  name: 'self_update',
  description: 'Met Odin à jour avec la dernière version publiée, en gardant tes propres améliorations locales. Ensuite self_check puis self_restart.',
  risk: 'exec',
  schema: obj({}),
  summarize: () => 'me mettre à jour (dernière version)',
  async run() {
    const r = updateApp(APP_ROOT);
    return `${r.ok ? '✓' : '✗'} ${r.message}`;
  },
};

export const selfRestart: Tool = {
  name: 'self_restart',
  description: 'Redémarre Odin pour appliquer une modification ou une mise à jour. Refusé si le code ne se charge pas (sauf « force »). Annonce-le à l\'utilisateur AVANT : la réponse arrive, puis Odin revient en quelques secondes.',
  risk: 'exec',
  schema: obj({ force: bool('redémarrer même si la vérification échoue (déconseillé)') }),
  summarize: () => 'redémarrer Odin',
  async run(i) {
    const r = checkApp(APP_ROOT, false);
    if (!r.ok && !i.force) return `Redémarrage refusé : le code ne se charge pas. Corrige ou annule (self_rollback).\n${clip(r.output, 3000)}`;
    if (process.env.ODIN_NO_RESTART) return 'Redémarrage simulé (tests).';
    return restartSelf(4000);
  },
};

export const pythonRun: Tool = {
  name: 'python',
  description: 'Exécute un script Python 3 sur la machine (calculs, fichiers, systèmes, réseau…). « admin » l\'exécute avec sudo si tu as les droits administrateur.',
  risk: 'exec',
  schema: obj({ code: str('code Python'), admin: bool('exécuter en administrateur (sudo)'), cwd: str('dossier où l\'exécuter (facultatif)') }, ['code']),
  summarize: (i) => `python${i.admin ? ' (admin)' : ''} : ${s(i.code).split('\n')[0].slice(0, 120)}`,
  command: (i) => `${i.admin ? 'sudo ' : ''}python3 -c ${JSON.stringify(s(i.code))}`,
  async run(i, ctx) {
    const dir = join(ctx.workspace, '.odin-tmp');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `script-${Date.now()}.py`);
    writeFileSync(file, s(i.code));
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const { shell } = await import('./builtin.ts');
    return shell.run({ command: `${i.admin && process.platform !== 'win32' ? 'sudo ' : ''}${py} "${file}"`, cwd: i.cwd, timeout_sec: 600 }, ctx);
  },
};

export const SELF_TOOLS: Tool[] = [selfInfo, selfRead, selfEdit, selfCheck, selfRollback, selfUpdate, selfRestart, pythonRun];
