// Mises à jour d'Odin : il regarde régulièrement si une nouvelle version est publiée sur GitHub,
// te prévient (bouton « Mettre à jour »), ou se met à jour tout seul si tu l'as choisi.
// Une mise à jour : récupérer le code (en gardant ses propres améliorations), vérifier que le nouveau
// code se charge, sinon revenir aussitôt à la version d'avant ; puis redémarrer.

import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROOT, checkApp, restartSelf, updateApp } from './self.ts';
import { obj, type Tool } from './registry.ts';

const git = (root: string, args: string[]) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 120_000 });
/** git sans bloquer Odin (le réseau peut être lent). */
const gitA = (root: string, args: string[]) => new Promise<{ status: number; stdout: string; stderr: string }>((res) => { execFile('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 120_000 }, (e, stdout, stderr) => res({ status: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })); });
const hasGit = (root: string) => existsSync(join(root, '.git')) && git(root, ['rev-parse', '--git-dir']).status === 0;
const versionOf = (pkg: string) => { try { return (JSON.parse(pkg) as { version?: string }).version ?? ''; } catch { return ''; } };

export interface UpdateInfo {
  /** Version installée sur le disque. */
  current: string;
  /** Dernière version publiée ('' si inconnue). */
  latest: string;
  /** Nombre de changements publiés pas encore récupérés. */
  behind: number;
  /** Ce qui change (titres des changements, les plus récents d'abord). */
  changes: string[];
  available: boolean;
  /** La mise à jour peut-elle se faire depuis Odin (installé avec git) ? */
  canApply: boolean;
  checkedAt: number;
  error?: string;
}

/** Va voir s'il y a une nouvelle version (git fetch ; ne change rien au code). */
export async function checkForUpdate(root = APP_ROOT, now = Date.now()): Promise<UpdateInfo> {
  const current = versionOf(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!hasGit(root)) return { current, latest: '', behind: 0, changes: [], available: false, canApply: false, checkedAt: now, error: 'Odin a été installé sans git : relance l\'installateur pour le mettre à jour.' };
  const f = (await gitA(root, ['fetch', '--quiet']));
  if (f.status !== 0) return { current, latest: '', behind: 0, changes: [], available: false, canApply: true, checkedAt: now, error: `Impossible de joindre GitHub : ${(f.stderr || '').trim().slice(0, 200)}` };
  // Branche suivie ; à défaut origin/<branche actuelle>, puis origin/main.
  let up = (await gitA(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).stdout.trim();
  if (!up) {
    const br = (await gitA(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    for (const c of [`origin/${br}`, 'origin/main']) if ((await gitA(root, ['rev-parse', '--verify', '--quiet', c])).status === 0) { up = c; break; }
    // Dépôt sans branches distantes enregistrées : on récupère directement la branche sur GitHub.
    if (!up && (await gitA(root, ['fetch', '--quiet', 'origin', br || 'main'])).status === 0) up = 'FETCH_HEAD';
  }
  if (!up) return { current, latest: '', behind: 0, changes: [], available: false, canApply: false, checkedAt: now, error: 'Pas de branche suivie sur GitHub.' };
  const behind = Number((await gitA(root, ['rev-list', '--count', `HEAD..${up}`])).stdout.trim() || 0);
  const latest = versionOf((await gitA(root, ['show', `${up}:package.json`])).stdout) || current;
  const changes = behind ? (await gitA(root, ['log', '--format=%s', `HEAD..${up}`])).stdout.trim().split('\n').filter(Boolean).slice(0, 12) : [];
  return { current, latest, behind, changes, available: behind > 0, canApply: true, checkedAt: now };
}

/**
 * Applique la mise à jour : récupère, vérifie que le nouveau code se charge, sinon revient à la
 * version d'avant (rien n'est perdu). Ne redémarre pas : c'est à l'appelant de le faire.
 */
export function applyUpdate(root = APP_ROOT): { ok: boolean; message: string; from: string; to: string; restart: boolean } {
  const from = versionOf(readFileSync(join(root, 'package.json'), 'utf8'));
  const before = hasGit(root) ? git(root, ['rev-parse', 'HEAD']).stdout.trim() : '';
  const u = updateApp(root);
  if (!u.ok) return { ok: false, message: u.message, from, to: from, restart: false };
  const after = hasGit(root) ? git(root, ['rev-parse', 'HEAD']).stdout.trim() : '';
  const to = versionOf(readFileSync(join(root, 'package.json'), 'utf8'));
  if (before === after) return { ok: true, message: 'Odin est déjà à jour.', from, to, restart: false };
  const c = checkApp(root, false);
  if (!c.ok) {
    // Le nouveau code ne se charge pas : retour immédiat à la version qui marchait.
    git(root, ['reset', '--keep', before]);
    return { ok: false, message: `La nouvelle version ne se charge pas : je suis resté en v${from}.\n${c.output.slice(0, 500)}`, from, to: from, restart: false };
  }
  return { ok: true, message: `Odin passe de la v${from} à la v${to}.\n${u.message.split('\n').slice(1, 9).join('\n')}`.trim(), from, to, restart: true };
}

/** État gardé pour l'interface et les rappels (clé-valeur de Muninn). */
export interface Kv { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void }
export const lastUpdateInfo = (kv: Kv): UpdateInfo | undefined => { try { return JSON.parse(kv.getKv('update-info') ?? 'null') ?? undefined; } catch { return undefined; } };

export const updateCheckTool: Tool = {
  name: 'update_check',
  description: 'Regarde si une nouvelle version d\'Odin est publiée, et ce qu\'elle apporte. Ne change rien.',
  risk: 'network',
  schema: obj({}),
  async run(_i, ctx) {
    const r = await checkForUpdate();
    ctx.muninn.setKv('update-info', JSON.stringify(r));
    if (r.error) return r.error;
    return r.available ? `Nouvelle version disponible : v${r.latest} (tu as la v${r.current}), ${r.behind} changement(s) :\n${r.changes.map((c) => `- ${c}`).join('\n')}` : `Odin est à jour (v${r.current}).`;
  },
};

export const updateApplyTool: Tool = {
  name: 'update_apply',
  description: 'Met Odin à jour avec la dernière version publiée (garde tes améliorations locales, vérifie que le nouveau code se charge, sinon revient en arrière), puis redémarre. Préviens le propriétaire avant : tu reviens en quelques secondes.',
  risk: 'exec',
  schema: obj({}),
  summarize: () => 'mettre Odin à jour et redémarrer',
  async run(_i, ctx) {
    const r = applyUpdate();
    ctx.muninn.setKv('update-info', JSON.stringify(await checkForUpdate()));
    if (!r.ok || !r.restart) return `${r.ok ? '✓' : '✗'} ${r.message}`;
    ctx.muninn.setKv('updated-to', `${r.from}→${r.to}`);
    if (process.env.ODIN_NO_RESTART) return `✓ ${r.message}\n(redémarrage simulé)`;
    return `✓ ${r.message}\n${restartSelf(5000)}`;
  },
};
