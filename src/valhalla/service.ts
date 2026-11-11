// Valhalla en marche : démarre les modules, leurs surveillances, le fil d'alertes (envoyées sur ta
// messagerie selon leur gravité), les événements entre modules (réflexes et Draupnir), et le choix du
// bon module pour un besoin, avec ou sans IA.

import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, ActionResult, Alert, AlertIn, Level, ModCtx, Module } from './types.ts';

const RANK: Record<Level, number> = { info: 0, moyenne: 1, haute: 2, critique: 3 };
const ICON: Record<Level, string> = { info: 'ℹ️', moyenne: '🟡', haute: '🟠', critique: '🔴' };
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export interface ValhallaDeps {
  notify?(text: string): Promise<void>;
  ask?(text: string): Promise<string>;
  fetch?: typeof fetch;
  now?(): Date;
  /** exécution de commande (remplaçable dans les tests) */
  run?: ModCtx['run'];
}

export class Valhalla {
  readonly events = new EventEmitter();
  readonly dir: string;
  private mods = new Map<string, Module>();
  private ctxs = new Map<string, ModCtx>();
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private alertsFile: string;
  private recent = new Map<string, number>();
  private deps: ValhallaDeps;
  constructor(home: string, modules: Module[], deps: ValhallaDeps = {}) {
    this.deps = deps;
    this.dir = join(home, 'valhalla');
    mkdirSync(this.dir, { recursive: true });
    this.alertsFile = join(this.dir, 'alertes.jsonl');
    for (const m of modules) this.mods.set(m.id, m);
    this.events.setMaxListeners(100);
  }

  modules(): Module[] { return [...this.mods.values()]; }
  module(id: string): Module | undefined {
    const n = norm(id);
    return this.mods.get(id) ?? this.modules().find((m) => norm(m.name) === n || norm(m.id) === n || (m.modes ?? []).some((x) => norm(x).startsWith(n)) || m.from.some((x) => norm(x) === n));
  }

  // ---------------- Contexte d'un module
  ctx(id: string): ModCtx {
    const have = this.ctxs.get(id); if (have) return have;
    const dir = join(this.dir, id); mkdirSync(dir, { recursive: true });
    const sf = join(dir, 'réglages.json');
    const settings: Record<string, unknown> = existsSync(sf) ? JSON.parse(readFileSync(sf, 'utf8')) : {};
    const c: ModCtx = {
      home: join(this.dir, '..'), dir, settings,
      saveSettings: (patch) => { Object.assign(settings, patch); writeFileSync(sf, JSON.stringify(settings, null, 2)); },
      alert: (a) => this.alert(id, a),
      emit: (type, data = {}) => { this.events.emit('event', { module: id, type, data, at: (this.deps.now?.() ?? new Date()).toISOString() }); },
      run: this.deps.run ?? run,
      has: async (cmd) => (await (this.deps.run ?? run)('sh', ['-c', `command -v ${cmd.replace(/[^\w.-]/g, '')}`])).code === 0,
      fetch: this.deps.fetch ?? fetch,
      notify: async (t) => { await this.deps.notify?.(t); },
      ask: this.deps.ask,
      call: (m, a, input = {}) => this.act(m, a, input),
      now: () => this.deps.now?.() ?? new Date(),
      alerts: (o) => this.alerts(o),
      ack: (ids) => this.ack(ids),
      modules: () => this.modules(),
    };
    this.ctxs.set(id, c);
    return c;
  }

  // ---------------- Démarrage
  async start(): Promise<void> {
    for (const m of this.modules()) {
      try { await m.start?.(this.ctx(m.id)); } catch (e) { this.alert(m.id, { level: 'moyenne', title: `${m.name} n'a pas pu démarrer`, detail: (e as Error).message, key: `start:${m.id}` }); }
      if (m.watch) {
        const tick = async () => { try { await m.watch!.run(this.ctx(m.id)); } catch (e) { this.alert(m.id, { level: 'info', title: `${m.name} : surveillance en échec`, detail: (e as Error).message, key: `watch:${m.id}` }); } };
        this.timers.push(setTimeout(tick, 20_000 + Math.random() * 20_000) as unknown as ReturnType<typeof setInterval>, setInterval(tick, m.watch.every * 1000));
      }
    }
  }
  stop(): void { for (const t of this.timers) { clearInterval(t); clearTimeout(t); } this.timers = []; for (const m of this.modules()) { try { m.stop?.(); } catch { /* rien */ } } }

  // ---------------- Actions
  action(moduleId: string, actionId: string): { m: Module; a: Action } | undefined {
    const m = this.module(moduleId); const a = m?.actions.find((x) => x.id === actionId || norm(x.label) === norm(actionId));
    return m && a ? { m, a } : undefined;
  }
  /** `auto` : appel sans personne (automatisation, réflexe) → les actions graves sont refusées. */
  async act(moduleId: string, actionId: string, input: Record<string, unknown> = {}, o: { auto?: boolean } = {}): Promise<ActionResult> {
    const f = this.action(moduleId, actionId);
    if (!f) return { ok: false, text: `Action inconnue : ${moduleId} → ${actionId}` };
    const why = f.a.grave?.(input);
    if (o.auto && why) return { ok: false, text: `${f.m.name} · ${f.a.label} : action grave (${why}), elle demande ton accord et ne part pas d'une automatisation.` };
    for (const p of f.a.params ?? []) if (p.required && (input[p.key] === undefined || input[p.key] === '')) return { ok: false, text: `Il manque « ${p.label} ».` };
    try { const r = await f.a.run(this.ctx(f.m.id), input); this.events.emit('action', { module: f.m.id, action: f.a.id, ok: r.ok !== false }); return { ok: true, ...r }; }
    catch (e) { return { ok: false, text: `${f.m.name} · ${f.a.label} : ${(e as Error).message}` }; }
  }

  // ---------------- Alertes
  alert(module: string, a: AlertIn): Alert | undefined {
    const now = this.deps.now?.() ?? new Date();
    const key = `${module}:${a.key ?? a.title}`;
    const last = this.recent.get(key);
    // Même alerte dans les 6 h : comptée, pas renvoyée.
    if (last && now.getTime() - last < 6 * 3600_000) { this.bump(key); return undefined; }
    this.recent.set(key, now.getTime());
    const al: Alert = { ...a, id: Math.random().toString(36).slice(2, 10), at: now.toISOString(), module, count: 1, key };
    appendFileSync(this.alertsFile, `${JSON.stringify(al)}\n`);
    this.events.emit('alert', al);
    const min = (this.settings().alertLevel as Level) ?? 'haute';
    if (RANK[a.level] >= RANK[min]) {
      const m = this.mods.get(module);
      void this.deps.notify?.(`${ICON[a.level]} ${m?.name ?? module} — ${a.title}${a.detail ? `\n${a.detail}` : ''}`).catch(() => {});
    }
    return al;
  }
  private bump(key: string): void { this.counts.set(key, (this.counts.get(key) ?? 1) + 1); }
  private counts = new Map<string, number>();
  alerts(o: { module?: string; level?: Level; q?: string; limit?: number } = {}): Alert[] {
    if (!existsSync(this.alertsFile)) return [];
    const acked = this.acked();
    let all = readFileSync(this.alertsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Alert).reverse();
    all = all.map((a) => ({ ...a, ack: acked.has(a.id), count: this.counts.get(a.key ?? '') ?? a.count }));
    if (o.module) all = all.filter((a) => a.module === o.module);
    if (o.level) all = all.filter((a) => RANK[a.level] >= RANK[o.level!]);
    if (o.q) { const q = norm(o.q); all = all.filter((a) => norm(`${a.title} ${a.detail ?? ''} ${a.module}`).includes(q)); }
    return all.slice(0, o.limit ?? 200);
  }
  private acked(): Set<string> { try { return new Set(JSON.parse(readFileSync(join(this.dir, 'alertes-vues.json'), 'utf8'))); } catch { return new Set(); } }
  ack(ids: string[]): void { const s = this.acked(); for (const i of ids) s.add(i); writeFileSync(join(this.dir, 'alertes-vues.json'), JSON.stringify([...s].slice(-5000))); }

  settings(): Record<string, unknown> { try { return JSON.parse(readFileSync(join(this.dir, 'réglages.json'), 'utf8')); } catch { return {}; } }
  saveSettings(patch: Record<string, unknown>): void { writeFileSync(join(this.dir, 'réglages.json'), JSON.stringify({ ...this.settings(), ...patch }, null, 2)); }

  // ---------------- Choisir le module pour un besoin (sans IA : mots-clés)
  find(need: string): Array<{ m: Module; score: number; action?: Action }> {
    const t = ` ${norm(need).replace(/[^\w\s-]/g, ' ')} `;
    const hit = (w: string) => { const n = norm(w); return n.includes(' ') ? t.includes(n) : new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t); };
    return this.modules().map((m) => {
      let score = 0;
      for (const w of m.words) if (hit(w)) score += w.includes(' ') ? 3 : 2;
      if (hit(m.name)) score += 5;
      for (const x of m.from) if (hit(x)) score += 4;
      for (const x of m.modes ?? []) if (hit(x.split(' ')[0])) score += 3;
      let action: Action | undefined, best = 0;
      for (const a of m.actions) { const s = (a.words ?? []).filter(hit).length * 2 + (hit(a.label) ? 2 : 0); if (s > best) { best = s; action = a; } }
      return { m, score: score + best, action };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  }
  describe(m: Module): string {
    return `**${m.name}** (${m.family}) — ${m.what}\nCe qu'il fait :\n${m.does.map((d) => `- ${d}`).join('\n')}${m.modes?.length ? `\nModes : ${m.modes.join(', ')}` : ''}\nActions : ${m.actions.map((a) => `${a.label}${a.grave ? ' (avec ton accord)' : ''}`).join(' · ')}\nReprend les fonctions de : ${m.from.join(', ')}.`;
  }
}

/** Commande système avec délai ; sudo -n si demandé (jamais de mot de passe tapé). */
export function run(cmd: string, args: string[], o: { timeoutMs?: number; input?: string; sudo?: boolean } = {}): Promise<{ code: number; out: string; err: string }> {
  const [c, a] = o.sudo && process.getuid?.() !== 0 ? ['sudo', ['-n', cmd, ...args]] : [cmd, args];
  return new Promise((resolve) => {
    const p = execFile(c, a, { timeout: o.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }, (err, out, er) => resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, out: String(out), err: String(er || (err && !out ? err.message : '')) }));
    if (o.input !== undefined) { p.stdin?.end(o.input); }
  });
}
