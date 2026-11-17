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
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bool, obj, str, type Tool, type ToolContext } from './registry.ts';
import { GRAVE_ACCEPTER, GRAVE_RESTAURER, cheminReelRelatif, ecrireReference, empreinteFichier, estNoyau, noterReferenceConnue, figerReference, verifierNoyau, FICHIER_EMPREINTES } from '../heimdall/noyau.ts';

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

/** Le code de sécurité : le NOYAU d'Odin (src/heimdall/noyau.ts), chemin réel résolu (liens, « .. », majuscules). */
const isSecurityCode = (rel: string) => { const r = cheminReelRelatif(rel); return r !== undefined && estNoyau(r); };
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

/** Les fichiers d'un lot de modifications (le dernier par défaut) : pour que le retour arrière suive la règle du code. */
export function fichiersDuLot(home: string, setId?: string): string[] {
  const j = readJournal(home);
  return (setId ? j.find((c) => c.id === setId) : j.at(-1))?.files ?? [];
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
  // Revenir sur une réécriture du noyau remet une version déjà validée par toi : la référence suit (sinon tout bloque).
  if (set.files.some((f) => { const r = cheminReelRelatif(f, root); return r !== undefined && estNoyau(r); }) && root === APP_ROOT) { ecrireReference(root); noterReferenceConnue(home); }
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

// ---------- le code installé : conflits, retouches locales mises de côté ----------

/** Dossier d'Odin, pour y ranger une copie lisible des retouches mises de côté. */
const defaultHome = () => process.env.ODIN_HOME || join(homedir(), '.odin');

/**
 * Fichiers du code restés en plein conflit : fusion ratée, ou marqueurs de conflit dans un fichier
 * (lignes qui commencent par sept chevrons). Un code dans cet état ne se charge plus.
 */
export function conflicted(root = APP_ROOT): string[] {
  const list = (r: { stdout: string }) => r.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  return [...new Set([
    ...list(git(root, ['diff', '--name-only', '--diff-filter=U'])),
    ...list(git(root, ['grep', '-l', '-I', '-E', '^(<{7}|>{7}) ', '--', '*.ts', '*.mjs', '*.js', '*.json', '*.html'])),
  ])];
}

/** Copie lisible (fichier .patch dans ~/.odin/self-backups) de retouches qu'on va écarter. */
function savePatch(root: string, home: string, args: string[]): string | undefined {
  const d = git(root, args); if (d.status !== 0 || !d.stdout.trim()) return undefined;
  const file = join(backupsDir(home), `retouches-locales-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.patch`);
  try { mkdirSync(backupsDir(home), { recursive: true }); writeFileSync(file, d.stdout); return file; } catch { return undefined; }
}
const isDirty = (root: string) => git(root, ['status', '--porcelain', '--untracked-files=no']).stdout.trim() !== '';
/** Empreinte de l'état du code installé (version récupérée + retouches en cours) : si elle change, une vérification ratée mérite d'être refaite. */
export function treeState(root = APP_ROOT): string {
  if (!hasGit(root)) return '';
  return `${git(root, ['rev-parse', '--short', 'HEAD']).stdout.trim()}+${git(root, ['status', '--porcelain', '--untracked-files=no']).stdout.split('\n').filter(Boolean).length}`;
}

/**
 * Remet le code exactement tel que publié (la version installée, sans aucune retouche locale).
 * Rien n'est perdu : les retouches sont gardées à part, en copie lisible (.patch) et dans la réserve
 * de git (« git stash list »). Sert quand une retouche locale empêche le code de se charger, ou
 * qu'une fusion ratée a laissé des marqueurs de conflit dans les fichiers.
 */
export function restorePublished(root = APP_ROOT, home = defaultHome()): { ok: boolean; aside?: string; files: string[] } {
  if (!hasGit(root)) return { ok: false, files: [] };
  const bad = conflicted(root), dirty = isDirty(root);
  if (!bad.length && !dirty) return { ok: true, files: [] };
  const files = [...new Set([...bad, ...git(root, ['diff', '--name-only', 'HEAD']).stdout.split('\n').map((x) => x.trim()).filter(Boolean)])];
  // En plein conflit, la version propre des retouches est déjà dans la réserve (la réapplication a échoué, git l'y a laissée).
  const stashed = git(root, ['stash', 'list']).stdout.trim() !== '';
  const aside = bad.length && stashed ? savePatch(root, home, ['stash', 'show', '-p', 'stash@{0}']) : savePatch(root, home, ['diff', 'HEAD']);
  if (!bad.length) git(root, ['stash', 'push', '-m', `odin-retouches-${Date.now()}`]);
  // « git checkout -- . » ne sait pas défaire une fusion ratée (« path is unmerged ») : seul ce retour complet retire les marqueurs.
  const r = git(root, ['reset', '--hard', 'HEAD']);
  return { ok: r.status === 0 && !conflicted(root).length, aside, files };
}

/**
 * Met Odin à jour (git pull) en gardant ses propres retouches locales quand elles s'accordent avec
 * la nouvelle version. Si elles ne s'accordent pas, la version publiée est gardée telle quelle et les
 * retouches sont mises de côté (copie .patch + réserve git) : le code n'est jamais laissé en conflit.
 * `stashed` : les retouches attendent dans la réserve (à réappliquer si on revient à la version d'avant).
 */
export function updateApp(root = APP_ROOT, home = defaultHome()): { ok: boolean; message: string; aside?: string; stashed?: boolean } {
  if (!hasGit(root)) return { ok: false, message: 'Odin n\'a pas été installé avec git : relance l\'installateur pour le mettre à jour.' };
  const notes: string[] = [];
  let aside: string | undefined, stashed = false;
  // Une mise à jour précédente a laissé le code en conflit : on le remet d'abord tel que publié.
  if (conflicted(root).length) {
    const r = restorePublished(root, home); aside = r.aside; stashed = true;
    notes.push(`Le code était resté en conflit après une mise à jour (${r.files.slice(0, 3).join(', ')}) : je l'ai remis tel que publié${r.aside ? `, mes retouches sont de côté (${r.aside})` : ''}.`);
  }
  const before = git(root, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  const dirty = isDirty(root);
  if (dirty) {
    aside = savePatch(root, home, ['diff', 'HEAD']) ?? aside;
    if (git(root, ['stash', 'push', '-m', `odin-auto-${Date.now()}`]).status !== 0) return { ok: false, message: 'Impossible de mettre de côté mes modifications locales.' };
  }
  // Sans branche suivie, on récupère origin/<branche actuelle>.
  const tracked = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).status === 0;
  const pull = git(root, tracked ? ['pull', '--ff-only'] : ['pull', '--ff-only', 'origin', git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim() || 'main']);
  if (pull.status !== 0) notes.push(`Mise à jour impossible : ${(pull.stderr || pull.stdout).trim().slice(0, 400)}`);
  if (dirty) {
    if (git(root, ['stash', 'pop']).status !== 0) {
      git(root, ['reset', '--hard', 'HEAD']); stashed = true;
      notes.push(`Mes retouches locales ne s'accordent pas avec la nouvelle version : elle est gardée telle que publiée, et mes retouches sont de côté (${aside ? `${aside}, et ` : ''}« git stash list »).`);
    } else {
      // Réappliquées sans accroc : la copie de secours ne sert plus.
      if (aside) { try { rmSync(aside, { force: true }); } catch { /* tant pis */ } aside = undefined; }
      notes.push('Mes modifications locales sont réappliquées.');
    }
  }
  // Filet : quoi qu'il arrive, jamais de marqueurs de conflit laissés dans le code.
  if (conflicted(root).length) { git(root, ['reset', '--hard', 'HEAD']); stashed = true; }
  if (pull.status !== 0) return { ok: false, message: notes.join('\n'), aside, stashed };
  const after = git(root, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  const log = before === after ? '' : git(root, ['log', '--oneline', `${before}..${after}`]).stdout.trim().split('\n').slice(0, 15).join('\n');
  return { ok: true, message: [before === after ? 'Déjà à jour' : `Mis à jour ${before} → ${after}`, log, ...notes].filter(Boolean).join('\n'), aside, stashed };
}

/** Sous un service (systemd, launchd), on quitte avec un code d'erreur : le service relance Odin. Sinon on se relance soi-même. */
/** Version en mémoire (chargée au démarrage) et version installée sur le disque. */
const RUNNING_VERSION = (() => { try { return (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }).version; } catch { return ''; } })();
export function appVersions(): { running: string; disk: string } {
  let disk = '';
  try { disk = (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }).version; } catch { /* illisible */ }
  return { running: RUNNING_VERSION, disk };
}

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
    const { identityLine } = await import('./scripts.ts');
    const lines = [identityLine(), `Code d'Odin : ${root}`, `Version : ${version}`];
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
  // La validation est décidée par Heimdall (policy.ts, regleCode) : réglage code.validation, noyau toujours validé,
  // contenu extérieur et tâches automatiques validés, membres refusés. Ici : sauvegarde, écriture, trace.
  async run(i, ctx) {
    const p = appPath(s(i.path));
    const rel = relative(APP_ROOT, p);
    if (isSecurityCode(rel) && ctx.isTainted()) return 'Refusé : les garde-fous d\'Odin (son noyau) ne se modifient pas depuis une conversation qui a lu du contenu extérieur. Recommence dans une conversation propre.';
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
    const avant = existsSync(p) ? empreinteFichier(p) : '';
    backupFile(ctx.home, APP_ROOT, rel, id);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, next);
    // Une réécriture du NOYAU n'arrive ici qu'avec ta validation (Heimdall) : la référence suit, dans la même validation.
    const noyau = isSecurityCode(rel);
    if (noyau) { ecrireReference(APP_ROOT); noterReferenceConnue(ctx.home); }
    tracerReecriture(ctx, { outil: 'self_edit', fichier: rel, avant, apres: empreinteFichier(p), pourquoi: s(i.reason), lot: id, noyau });
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
  async run(_i, ctx) {
    const r = updateApp(APP_ROOT, ctx.home);
    // Une mise à jour d'Odin apporte sa référence : elle devient la référence figée et la « dernière connue ».
    if (r.ok && ctx.home) { figerReference(APP_ROOT); noterReferenceConnue(ctx.home); }
    return `${r.ok ? '✓' : '✗'} ${r.message}`;
  },
};

export const selfRestart: Tool = {
  name: 'self_restart',
  description: 'Redémarre Odin pour appliquer une modification ou une mise à jour. Refusé si le code ne se charge pas (sauf « force »). Annonce-le à l\'utilisateur AVANT : la réponse arrive, puis Odin revient en quelques secondes.',
  risk: 'exec',
  schema: obj({ force: bool('redémarrer même si la vérification échoue (déconseillé)') }),
  summarize: () => 'redémarrer Odin',
  async run(i, ctx) {
    const r = checkApp(APP_ROOT, false);
    if (!r.ok && !i.force) return `Redémarrage refusé : le code ne se charge pas. Corrige ou annule (self_rollback).\n${clip(r.output, 3000)}`;
    // Essais d'abord : ceux des fichiers réécrits (et l'essai du noyau). Un essai cassé = la réécriture n'est pas activée.
    const lot = ctx.home ? readJournal(ctx.home).at(-1) : undefined;
    if (lot && !i.force) {
      const e = essaisDuLot(APP_ROOT, lot.files);
      if (!e.ok) return `Activation refusée : un essai échoue après la réécriture (${lot.files.join(', ')}). Corrige, ou reviens en arrière (self_rollback).\n${clip(e.output, 3000)}`;
    }
    // Retour arrière automatique si Odin ne repart pas bien (src/tools/self.ts, verifierActivation au démarrage).
    if (lot && ctx.home) marquerActivation(ctx.home, lot.id);
    if (process.env.ODIN_NO_RESTART) return 'Redémarrage simulé (tests).';
    return restartSelf(4000);
  },
};

/** Modules Python courants installés tout seuls au premier besoin (nom importé → paquet PyPI officiel). */
export const PY_AUTO: Record<string, string> = {
  docx: 'python-docx', openpyxl: 'openpyxl', pptx: 'python-pptx', pypdf: 'pypdf', fitz: 'pymupdf', pdfplumber: 'pdfplumber', reportlab: 'reportlab', fpdf: 'fpdf2',
  pandas: 'pandas', numpy: 'numpy', matplotlib: 'matplotlib', PIL: 'pillow', xlsxwriter: 'xlsxwriter', xlrd: 'xlrd', odf: 'odfpy', docxtpl: 'docxtpl',
  markdown: 'markdown', bs4: 'beautifulsoup4', lxml: 'lxml', requests: 'requests', yaml: 'pyyaml', tabulate: 'tabulate', qrcode: 'qrcode', cv2: 'opencv-python-headless',
  scipy: 'scipy', sklearn: 'scikit-learn', nmap: 'python-nmap', scapy: 'scapy', psutil: 'psutil', paramiko: 'paramiko', dateutil: 'python-dateutil', pytz: 'pytz', chardet: 'chardet',
  pytesseract: 'pytesseract', ebooklib: 'ebooklib', icalendar: 'icalendar', vobject: 'vobject', feedparser: 'feedparser', jinja2: 'jinja2', rich: 'rich', httpx: 'httpx',
};
/** Paquets Node courants installés tout seuls (dans ~/.odin/node-tools). */
export const NODE_AUTO = new Set(['exceljs', 'xlsx', 'docx', 'pdf-lib', 'pdfkit', 'pptxgenjs', 'mammoth', 'csv-parse', 'csv-stringify', 'cheerio', 'marked', 'jszip', 'dayjs', 'qrcode', 'axios', 'yaml', 'archiver', 'node-html-parser', 'pdf-parse']);

/** « No module named 'docx' » → paquet à installer, s'il est dans la liste sûre. Pur. */
export function missingPyPackage(out: string): string | undefined {
  const m = /No module named '([\w.]+)'/.exec(out);
  return m ? PY_AUTO[m[1].split('.')[0]] : undefined;
}
/** « Cannot find module 'exceljs' » → paquet Node à installer, s'il est dans la liste sûre. Pur. */
export function missingNodePackage(out: string): string | undefined {
  const m = /Cannot find (?:module|package) '([@\w./-]+)'/.exec(out);
  const name = m?.[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m?.[1].split('/')[0];
  return name && NODE_AUTO.has(name) ? name : undefined;
}

export const pythonRun: Tool = {
  name: 'python',
  description: 'Exécute un script Python 3 sur la machine : documents (Word, Excel, PowerPoint, PDF, CSV…) à lire, créer ou modifier, calculs, données, graphiques, fichiers, système, réseau. Les bibliothèques courantes (python-docx, openpyxl, python-pptx, pypdf, pymupdf, reportlab, pandas, matplotlib, pillow…) s\'installent toutes seules au premier besoin. « admin » l\'exécute avec sudo si tu as les droits administrateur.',
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
    const exec = () => shell.run({ command: `${i.admin && process.platform !== 'win32' ? 'sudo ' : ''}${py} "${file}"`, cwd: i.cwd, timeout_sec: 600 }, ctx);
    let out = await exec();
    // Bibliothèque courante absente : installée (paquet officiel PyPI, liste sûre), puis on relance. Jusqu'à 3 fois.
    const installed: string[] = [];
    for (let k = 0; k < 3; k++) {
      const pkg = missingPyPackage(typeof out === 'string' ? out : out.output);
      if (!pkg || installed.includes(pkg)) break;
      const r = await shell.run({ command: `${py} -m pip install --user --quiet --disable-pip-version-check ${pkg} 2>&1 || ${py} -m pip install --user --quiet --break-system-packages --disable-pip-version-check ${pkg} 2>&1`, timeout_sec: 600 }, ctx);
      installed.push(pkg);
      if (/error|not found|No module named pip/i.test(typeof r === 'string' ? r : r.output) && !/Successfully|already satisfied/i.test(typeof r === 'string' ? r : r.output)) break;
      out = await exec();
    }
    if (!installed.length) return out;
    const text = typeof out === 'string' ? out : out.output;
    return `(installé tout seul : ${installed.join(', ')})\n${text}`;
  },
};

export const nodeRun: Tool = {
  name: 'node_run',
  description: 'Exécute un script JavaScript avec Node.js (souvent le plus rapide pour JSON, web, Excel avec exceljs, Word avec docx, PDF avec pdf-lib, PowerPoint avec pptxgenjs). Utilise require(). Les paquets courants s\'installent tout seuls au premier besoin.',
  risk: 'exec',
  schema: obj({ code: str('code JavaScript (CommonJS : require)'), cwd: str('dossier où l\'exécuter (facultatif)') }, ['code']),
  summarize: (i) => `node : ${s(i.code).split('\n')[0].slice(0, 120)}`,
  command: (i) => `node -e ${JSON.stringify(s(i.code))}`,
  async run(i, ctx) {
    const dir = join(ctx.workspace, '.odin-tmp'); mkdirSync(dir, { recursive: true });
    const file = join(dir, `script-${Date.now()}.cjs`);
    writeFileSync(file, s(i.code));
    const lib = join(ctx.home ?? join(ctx.workspace, '..'), 'node-tools');
    mkdirSync(lib, { recursive: true });
    if (!existsSync(join(lib, 'package.json'))) writeFileSync(join(lib, 'package.json'), '{"name":"odin-node-tools","private":true}\n');
    const { shell } = await import('./builtin.ts');
    const exec = () => shell.run({ command: `NODE_PATH="${join(lib, 'node_modules')}" node "${file}"`, cwd: i.cwd, timeout_sec: 600 }, ctx);
    let out = await exec();
    const installed: string[] = [];
    for (let k = 0; k < 3; k++) {
      const pkg = missingNodePackage(typeof out === 'string' ? out : out.output);
      if (!pkg || installed.includes(pkg)) break;
      // --ignore-scripts : aucun script d'installation exécuté (protection contre les paquets piégés).
      await shell.run({ command: `npm install --prefix "${lib}" --no-audit --no-fund --ignore-scripts --silent ${pkg} 2>&1`, timeout_sec: 600 }, ctx);
      installed.push(pkg);
      out = await exec();
    }
    if (!installed.length) return out;
    return `(installé tout seul : ${installed.join(', ')})\n${typeof out === 'string' ? out : out.output}`;
  },
};

/**
 * Restaurer le noyau depuis la VERSION DE RÉFÉRENCE : pour chaque fichier du noyau qui s'en écarte, la version du
 * dépôt (git, dernier commit) est remise SEULEMENT si son empreinte est celle de référence. Toujours ton accord.
 */
export const selfRestoreCore: Tool = {
  name: 'self_restore_core',
  description: 'Restaure les garde-fous d\'Odin (son noyau) à l\'identique depuis la version de référence signée (dépôt), quand ils ont été modifiés. Ensuite self_check puis self_restart.',
  risk: 'exec',
  schema: obj({}),
  summarize: () => 'restaurer mes garde-fous depuis la version de référence',
  grave: () => `${GRAVE_RESTAURER}${ecartsMontres()}`,
  async run(_i, ctx) {
    if (!ctx.home) return 'Erreur : dossier d\'Odin inconnu (sauvegarde impossible).';
    const v = verifierNoyau(APP_ROOT);
    if (!v.reference) return `Aucune version de référence (${FICHIER_EMPREINTES} absent).`;
    if (!v.ecarts.length) return 'Le noyau est identique à la version de référence : rien à restaurer.';
    if (!hasGit(APP_ROOT)) return 'Pas de dépôt git ici : je ne peux pas retrouver la version de référence. Réinstalle Odin.';
    const ref = (JSON.parse(readFileSync(join(APP_ROOT, FICHIER_EMPREINTES), 'utf8')) as { fichiers: Record<string, string> }).fichiers;
    const id = setIdFor(ctx), faits: string[] = [], refuses: string[] = [];
    for (const e of v.ecarts) {
      if (e.etat === 'ajouté') { refuses.push(`${e.fichier} (ajouté : à retirer à la main)`); continue; }
      const r = git(APP_ROOT, ['show', `HEAD:${e.fichier}`]);
      if (r.status !== 0) { refuses.push(`${e.fichier} (introuvable dans le dépôt)`); continue; }
      const tmp = join(ctx.home, 'noyau-restauration.tmp');
      writeFileSync(tmp, r.stdout);
      if (empreinteFichier(tmp) !== ref[e.fichier]) { rmSync(tmp, { force: true }); refuses.push(`${e.fichier} (le dépôt n'a pas la version de référence)`); continue; }
      rmSync(tmp, { force: true });
      backupFile(ctx.home, APP_ROOT, e.fichier, id);
      mkdirSync(dirname(join(APP_ROOT, e.fichier)), { recursive: true });
      writeFileSync(join(APP_ROOT, e.fichier), r.stdout);
      faits.push(e.fichier);
    }
    return `${faits.length ? `Restauré (sauvegarde ${id}) : ${faits.join(', ')}.` : 'Rien de restauré.'}${refuses.length ? ` Non restauré : ${refuses.join(' ; ')}.` : ''}${faits.length ? ' Vérifie avec self_check puis self_restart.' : ''}`;
  },
};

/** Accepter la version actuelle du noyau comme nouvelle référence (après un écart signalé). Toujours ton accord. */
export const selfAcceptCore: Tool = {
  name: 'self_accept_core',
  description: 'Accepte la version actuelle des garde-fous d\'Odin (son noyau) comme nouvelle référence, quand le propriétaire le décide après un écart signalé.',
  risk: 'exec',
  schema: obj({}),
  summarize: () => 'accepter la version actuelle de mes garde-fous comme référence',
  // Tu vois les fichiers en écart et le changement (git, quand il est là) avant de répondre.
  grave: () => `${GRAVE_ACCEPTER}${ecartsMontres()}`,
  async run(_i, ctx) {
    const v = verifierNoyau(APP_ROOT);
    if (v.reference && !v.ecarts.length) return 'Le noyau est déjà identique à la référence.';
    const n = ecrireReference(APP_ROOT);
    if (ctx.home) noterReferenceConnue(ctx.home);
    tracerReecriture(ctx, { outil: 'self_accept_core', fichier: v.ecarts.map((e) => e.fichier).join(', '), avant: '', apres: '', pourquoi: 'version actuelle acceptée par le propriétaire', lot: '', noyau: true });
    return `Version actuelle acceptée comme référence (${n} fichiers). Mes actions engageantes sont débloquées.`;
  },
};

/** Le changement des fichiers du noyau en écart (git diff contre le dernier commit, coupé à 4 000 caractères), pour la page. */
export function changementNoyau(root = APP_ROOT): string {
  const v = verifierNoyau(root);
  const f = v.ecarts.filter((e) => e.fichier !== FICHIER_EMPREINTES).map((e) => e.fichier);
  if (!f.length) return '';
  if (!hasGit(root)) return `(pas de dépôt git ici : impossible de montrer les lignes changées de ${f.join(', ')})`;
  return (git(root, ['diff', '--no-color', 'HEAD', '--', ...f]).stdout || '').slice(0, 4000);
}

/** Les fichiers du noyau en écart et leur changement (git diff, coupé à 2 000 caractères). */
export function ecartsMontres(root = APP_ROOT): string {
  const v = verifierNoyau(root);
  if (!v.ecarts.length) return ' (aucun écart)';
  let diff = '';
  if (hasGit(root)) { const r = git(root, ['diff', '--no-color', 'HEAD', '--', ...v.ecarts.filter((e) => e.fichier !== FICHIER_EMPREINTES).map((e) => e.fichier)]); diff = (r.stdout || '').slice(0, 2000); }
  return `\nFichiers en écart : ${v.ecarts.map((e) => `${e.fichier} (${e.etat})`).join(', ')}${diff ? `\nLe changement :\n${diff}` : ''}`;
}

// ---------- trace, essais avant activation, retour arrière automatique ----------

/** Une ligne au journal d'audit : quoi (fichier, empreintes avant / après), pourquoi, demandé par qui, lot. */
export function tracerReecriture(ctx: Pick<ToolContext, 'home' | 'sessionId' | 'channel' | 'peer'>, t: { outil: string; fichier: string; avant: string; apres: string; pourquoi: string; lot: string; noyau: boolean }): void {
  if (!ctx.home) return;
  try {
    mkdirSync(join(ctx.home, 'logs'), { recursive: true });
    writeFileSync(join(ctx.home, 'logs', 'audit.jsonl'), JSON.stringify({ t: new Date().toISOString(), evenement: 'reecriture-code', session: ctx.sessionId, par: `${ctx.channel}:${ctx.peer}`, ...t, avant: t.avant.slice(0, 16), apres: t.apres.slice(0, 16) }) + '\n', { flag: 'a' });
  } catch { /* la trace ne bloque jamais */ }
}

/** Les essais d'un lot réécrit : les fichiers d'essai qui importent un module touché, plus l'essai du noyau. */
export function essaisDuLot(root: string, fichiers: string[]): { ok: boolean; output: string; essais: string[] } {
  const noms = fichiers.map((f) => f.split(/[\\/]/).pop()!.replace(/\.(ts|js|mjs)$/, '')).filter(Boolean);
  let tests: string[] = [];
  try { tests = readdirSync(join(root, 'test')).filter((t) => t.endsWith('.test.ts')).filter((t) => { const c = readFileSync(join(root, 'test', t), 'utf8'); return noms.some((n) => c.includes(`/${n}.ts'`) || c.includes(`/${n}.ts"`) || c.includes(`/${n}.js'`)); }); } catch { /* pas de dossier d'essais */ }
  if (existsSync(join(root, 'test', 'noyau.test.ts')) && !tests.includes('noyau.test.ts')) tests.push('noyau.test.ts');
  tests = tests.slice(0, 12);
  if (!tests.length) return { ok: true, output: 'aucun essai lié', essais: [] };
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', ...tests.map((t) => join('test', t))], { encoding: 'utf8', timeout: 600_000, cwd: root, env: (() => { const e: NodeJS.ProcessEnv = { ...process.env, ODIN_NO_RESTART: '1' }; delete e.NODE_TEST_CONTEXT; return e; })() });
  return { ok: r.status === 0, output: `${tests.join(', ')}\n${(r.stdout || '') + (r.stderr || '')}`.slice(-6000), essais: tests };
}

const fichierActivation = (home: string) => join(backupsDir(home), 'activation.json');
/** Avant le redémarrage : la réécriture activée est notée (pour le retour arrière automatique). */
export function marquerActivation(home: string, lot: string): void {
  mkdirSync(backupsDir(home), { recursive: true });
  writeFileSync(fichierActivation(home), JSON.stringify({ lot, at: new Date().toISOString(), demarrages: 0 }));
}
/**
 * Au démarrage : une activation en attente de confirmation ? Au 2e démarrage sans confirmation (Odin n'a pas tenu
 * 10 minutes), le lot est défait. Sinon, la confirmation arrive après 10 minutes de marche. Rend ce qui s'est passé.
 */
export function verifierActivation(home: string, root = APP_ROOT, o: { confirmerApresMs?: number } = {}): { etat: 'rien' | 'en-attente' | 'defait'; lot?: string; fichiers?: string[] } {
  let a: { lot: string; demarrages: number } | undefined;
  try { a = JSON.parse(readFileSync(fichierActivation(home), 'utf8')) as { lot: string; demarrages: number }; } catch { return { etat: 'rien' }; }
  a.demarrages++;
  if (a.demarrages >= 2) {
    const r = rollback(home, root, a.lot);
    rmSync(fichierActivation(home), { force: true });
    return { etat: 'defait', lot: a.lot, fichiers: r?.files ?? [] };
  }
  writeFileSync(fichierActivation(home), JSON.stringify(a));
  const t = setTimeout(() => { try { rmSync(fichierActivation(home), { force: true }); } catch { /* rien */ } }, o.confirmerApresMs ?? 10 * 60_000);
  t.unref?.();
  return { etat: 'en-attente', lot: a.lot };
}

export const SELF_TOOLS: Tool[] = [selfInfo, selfRead, selfEdit, selfCheck, selfRollback, selfUpdate, selfRestart, selfRestoreCore, selfAcceptCore, pythonRun, nodeRun];
