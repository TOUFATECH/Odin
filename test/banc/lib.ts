// Banc d'essai virtuel d'Odin — outils communs.
// Chaque scénario essaie une appli d'Odin contre un VRAI service lancé pour l'occasion (Docker,
// pare-feu, WireGuard, serveur de caméras, Venus, Home Assistant, GitHub, serveurs MCP officiels)
// ou, quand le vrai est impossible sur une machine de test (Proxmox, module Tasmota, Telegram),
// contre un simulateur qui parle le même protocole. Rien n'est caché : un scénario dont l'outil
// manque est marqué « ignoré » avec la raison.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla, run as sysRun, type ValhallaDeps } from '../../src/valhalla/service.ts';
import type { Alert, Module } from '../../src/valhalla/types.ts';

export interface Check { name: string; ok: boolean; detail?: string }
export type Mode = 'réel' | 'simulé' | 'réel + simulé';
export interface Result { id: string; title: string; mode: Mode; status: 'réussi' | 'échoué' | 'ignoré'; why?: string; checks: Check[]; notes: string[]; ms: number }
export interface Scenario { id: string; title: string; mode: Mode; what: string; run(t: T): Promise<void> }
export class Skip extends Error {}

export const sh = (cmd: string, args: string[] = [], o: { timeoutMs?: number; input?: string } = {}) => sysRun(cmd, args, o);
export const has = async (cmd: string) => (await sh('sh', ['-c', `command -v ${cmd.replace(/[^\w./-]/g, '')}`])).code === 0;
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const isRoot = () => process.getuid?.() === 0;
/** Attend qu'une condition devienne vraie (sans jamais lever). */
export async function until(fn: () => unknown | Promise<unknown>, ms = 10_000, step = 150): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) { try { if (await fn()) return true; } catch { /* pas encore */ } if (Date.now() > end) return false; await wait(step); }
}
/** Port TCP libre sur cette machine. */
export async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
}

/** Dossier des outils téléchargés pour le banc (`npm run banc:outils`). */
export const TOOLS = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'odin-banc');
/** Chemin d'un outil : variable d'environnement, PATH, puis cache du banc. */
export async function findTool(name: string, envVar: string): Promise<string | undefined> {
  const e = process.env[envVar]; if (e && existsSync(e)) return e;
  const w = (await sh('sh', ['-c', `command -v ${name}`])).out.trim(); if (w) return w;
  const c = join(TOOLS, name); return existsSync(c) ? c : undefined;
}

/** Contexte d'un scénario : vérifications, notes, ménage à la fin. */
export class T {
  checks: Check[] = []; notes: string[] = [];
  private cleanups: Array<() => Promise<unknown> | unknown> = [];
  ok(cond: unknown, name: string, detail?: string): boolean { this.checks.push({ name, ok: Boolean(cond), detail: cond ? undefined : detail }); return Boolean(cond); }
  eq(a: unknown, b: unknown, name: string): boolean { return this.ok(JSON.stringify(a) === JSON.stringify(b), name, `obtenu ${JSON.stringify(a)?.slice(0, 200)}, attendu ${JSON.stringify(b)?.slice(0, 200)}`); }
  match(text: unknown, re: RegExp, name: string): boolean { return this.ok(re.test(String(text)), name, `obtenu « ${String(text).slice(0, 300)} »`); }
  note(text: string): void { this.notes.push(text); }
  skip(why: string): never { throw new Skip(why); }
  /** Exige un outil du système, sinon le scénario est ignoré (avec la raison). */
  async need(...cmds: string[]): Promise<void> { for (const c of cmds) if (!(await has(c))) this.skip(`« ${c} » n'est pas installé sur cette machine`); }
  needRoot(): void { if (!isRoot()) this.skip('droits administrateur nécessaires (lance le banc en root)'); }
  onEnd(fn: () => Promise<unknown> | unknown): void { this.cleanups.unshift(fn); }
  async end(): Promise<void> { for (const c of this.cleanups) { try { await c(); } catch { /* ménage au mieux */ } } this.cleanups = []; }
  /** Dossier temporaire supprimé à la fin. */
  tmp(prefix = 'banc-'): string { const d = mkdtempSync(join(tmpdir(), prefix)); this.onEnd(() => rmSync(d, { recursive: true, force: true })); return d; }
  /** Processus en arrière-plan, arrêté à la fin ; sa sortie est gardée pour le diagnostic. */
  spawn(cmd: string, args: string[], o: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): ChildProcess & { log: () => string } {
    let out = '';
    const p = spawn(cmd, args, { env: o.env ?? process.env, cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'] }) as ChildProcess & { log: () => string };
    p.stdout?.on('data', (d) => { out = (out + d).slice(-20_000); }); p.stderr?.on('data', (d) => { out = (out + d).slice(-20_000); });
    p.on('error', (e) => { out += `\n[erreur de lancement] ${e.message}`; });
    p.log = () => out;
    this.onEnd(async () => { if (p.exitCode === null) { p.kill('SIGTERM'); await until(() => p.exitCode !== null, 3000); if (p.exitCode === null) p.kill('SIGKILL'); } });
    return p;
  }
  /** Valhalla jetable avec les modules donnés ; alertes, messages envoyés et événements sont gardés. */
  valhalla(mods: Module[], deps: ValhallaDeps = {}): { v: Valhalla; home: string; alerts: Alert[]; sent: string[]; notified: Array<{ text: string; urgent?: boolean; photo?: string }>; events: Array<{ module: string; type: string; data: Record<string, unknown> }> } {
    const home = this.tmp('banc-odin-'), sent: string[] = [], notified: Array<{ text: string; urgent?: boolean; photo?: string }> = [], alerts: Alert[] = [], events: Array<{ module: string; type: string; data: Record<string, unknown> }> = [];
    const v = new Valhalla(home, mods, { notify: async (t, o) => { sent.push(t); notified.push({ text: t, ...o }); }, ...deps });
    v.events.on('alert', (a: Alert) => alerts.push(a)); v.events.on('event', (e: { module: string; type: string; data: Record<string, unknown> }) => events.push(e));
    this.onEnd(() => v.stop());
    return { v, home, alerts, sent, notified, events };
  }
}

export async function runScenario(s: Scenario): Promise<Result> {
  const t = new T(), t0 = Date.now();
  let status: Result['status'] = 'réussi', why: string | undefined;
  try { await s.run(t); if (t.checks.some((c) => !c.ok)) status = 'échoué'; if (!t.checks.length) { status = 'échoué'; why = 'aucune vérification faite'; } }
  catch (e) { if (e instanceof Skip) { status = 'ignoré'; why = e.message; } else { status = 'échoué'; why = (e as Error).stack?.split('\n').slice(0, 4).join(' | ') ?? String(e); } }
  finally { await t.end(); }
  return { id: s.id, title: s.title, mode: s.mode, status, why, checks: t.checks, notes: t.notes, ms: Date.now() - t0 };
}
