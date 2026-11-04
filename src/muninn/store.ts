// Muninn — le corbeau de la mémoire. Un seul fichier SQLite (module natif node:sqlite,
// aucune dépendance) contient : sessions, messages (recherche plein texte FTS5),
// mémoires avec PROVENANCE et niveau de confiance, appairages, tâches planifiées, coûts.
//
// Améliorations :
// - Une seule classe lisible, sans héritage multiple ni état global.
// - Chaque mémoire porte son origine (owner / agent / untrusted). Une mémoire issue d'un
//   contenu non fiable est « en quarantaine » : jamais injectée automatiquement dans le
//   prompt, ce qui empêche l'empoisonnement durable de la mémoire.
// - Rappel classé par pertinence × confiance × fraîcheur.

import { DatabaseSync } from 'node:sqlite';
import type { Message, ToolCall } from '../types.ts';

export type Origin = 'owner' | 'agent' | 'untrusted';
export const TRUST: Record<Origin, number> = { owner: 1, agent: 0.7, untrusted: 0.2 };

export interface MemoryRow {
  id: number;
  kind: string;
  content: string;
  origin: Origin;
  trust: number;
  tags: string;
  created_at: number;
  last_used_at: number;
  uses: number;
  pinned: number;
}

export interface SessionRow {
  id: string;
  channel: string;
  peer: string;
  title: string;
  summary: string;
  compact_upto: number;
  tainted: number;
  created_at: number;
  updated_at: number;
  suspicious?: number;
}

export interface MissionRow {
  id: string; session_id: string; goal: string; status: string; origin: string;
  steps: number; tool_calls: number; cost_usd: number; subagents: number; last_tool: string; result: string;
  started_at: number; updated_at: number; ended_at: number | null;
}

export interface JobRow {
  id: string;
  cron: string;
  prompt: string;
  channel: string;
  peer: string;
  enabled: number;
  last_run: number;
  next_run: number;
  /** 1 si créée pendant un tour marqué (contenu non fiable lu) : exécutée sans confiance. */
  tainted?: number;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, channel TEXT NOT NULL DEFAULT 'cli', peer TEXT NOT NULL DEFAULT 'owner',
  title TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', compact_upto INTEGER NOT NULL DEFAULT 0,
  tainted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, tool_calls TEXT, tool_call_id TEXT, tool_name TEXT,
  tainted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, id);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content); END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content); END;
CREATE TABLE IF NOT EXISTS memories(
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL,
  origin TEXT NOT NULL, trust REAL NOT NULL, tags TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, tags, content='memories', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags); END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content, tags ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
  INSERT INTO memories_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags); END;
CREATE TABLE IF NOT EXISTS pairings(
  channel TEXT NOT NULL, peer TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', code TEXT NOT NULL,
  status TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(channel, peer));
CREATE TABLE IF NOT EXISTS jobs(
  id TEXT PRIMARY KEY, cron TEXT NOT NULL, prompt TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'cli',
  peer TEXT NOT NULL DEFAULT 'owner', enabled INTEGER NOT NULL DEFAULT 1, last_run INTEGER NOT NULL DEFAULT 0,
  next_run INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS grants(
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, tool TEXT NOT NULL, example TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, last_used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS skill_stats(name TEXT PRIMARY KEY, uses INTEGER NOT NULL DEFAULT 0, last_used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS missions(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL, origin TEXT NOT NULL DEFAULT 'user',
  steps INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, subagents INTEGER NOT NULL DEFAULT 0,
  last_tool TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ended_at INTEGER);
CREATE TABLE IF NOT EXISTS usage(session_id TEXT, provider TEXT, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, created_at INTEGER);
`;

/** Transforme une phrase libre en requête FTS5 sûre (pas d'erreur de syntaxe possible). */
export function ftsQuery(text: string): string {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 16);
  return [...new Set(words)].map((w) => `"${w}"*`).join(' OR ');
}

export class Muninn {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(SCHEMA);
    try { this.db.exec('ALTER TABLE jobs ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0'); } catch { /* colonne déjà présente */ }
    try { this.db.exec("ALTER TABLE usage ADD COLUMN purpose TEXT NOT NULL DEFAULT 'agent'"); } catch { /* colonne déjà présente */ }
    try { this.db.exec('ALTER TABLE sessions ADD COLUMN suspicious INTEGER NOT NULL DEFAULT 0'); } catch { /* colonne déjà présente */ }
  }

  close(): void { this.db.close(); }

  // ---------- Sessions et messages ----------

  ensureSession(id: string, channel = 'cli', peer = 'owner'): SessionRow {
    const now = Date.now();
    this.db.prepare('INSERT OR IGNORE INTO sessions(id, channel, peer, created_at, updated_at) VALUES (?,?,?,?,?)').run(id, channel, peer, now, now);
    return this.getSession(id)!;
  }

  getSession(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }

  listSessions(limit = 20): SessionRow[] {
    return this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit) as unknown as SessionRow[];
  }

  setSessionTitle(id: string, title: string): void {
    this.db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title.slice(0, 120), id);
  }

  markTainted(id: string): void {
    this.db.prepare('UPDATE sessions SET tainted = 1 WHERE id = ?').run(id);
  }
  /** Un contenu manipulateur a été vu : la session reste sous surveillance jusqu'à une nouvelle conversation. */
  markSuspicious(id: string): void {
    this.db.prepare('UPDATE sessions SET suspicious = 1 WHERE id = ?').run(id);
  }

  /** Une nouvelle conversation remet le marquage à zéro (l'historique reste consultable). */
  resetSession(id: string): void {
    const max = this.db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM messages WHERE session_id = ?').get(id) as { m: number };
    this.db.prepare("UPDATE sessions SET compact_upto = ?, summary = '', tainted = 0, suspicious = 0 WHERE id = ?").run(max.m, id);
  }

  addMessage(sessionId: string, m: Message): number {
    const now = Date.now();
    const r = this.db.prepare(
      'INSERT INTO messages(session_id, role, content, tool_calls, tool_call_id, tool_name, tainted, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(sessionId, m.role, m.content, m.toolCalls ? JSON.stringify(m.toolCalls) : null, m.toolCallId ?? null, m.toolName ?? null, m.tainted ? 1 : 0, now);
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    if (m.tainted) this.markTainted(sessionId);
    return Number(r.lastInsertRowid);
  }

  /** Historique actif (après la dernière compaction), avec les identifiants de ligne. */
  history(sessionId: string): Array<Message & { rowId: number }> {
    const s = this.getSession(sessionId);
    const rows = this.db.prepare('SELECT * FROM messages WHERE session_id = ? AND id > ? ORDER BY id').all(sessionId, s?.compact_upto ?? 0) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      rowId: r.id as number,
      role: r.role as Message['role'],
      content: r.content as string,
      toolCalls: r.tool_calls ? (JSON.parse(r.tool_calls as string) as ToolCall[]) : undefined,
      toolCallId: (r.tool_call_id as string) ?? undefined,
      toolName: (r.tool_name as string) ?? undefined,
      tainted: r.tainted === 1,
    }));
  }

  /** Enregistre une compaction : les messages ≤ uptoRowId sont résumés par `summary`. */
  compact(sessionId: string, uptoRowId: number, summary: string): void {
    this.db.prepare('UPDATE sessions SET compact_upto = ?, summary = ? WHERE id = ?').run(uptoRowId, summary, sessionId);
  }

  /** Recherche plein texte dans TOUTES les conversations passées. */
  searchMessages(query: string, limit = 8): Array<{ session_id: string; role: string; snippet: string; created_at: number }> {
    const q = ftsQuery(query);
    if (!q) return [];
    return this.db.prepare(`
      SELECT m.session_id, m.role, snippet(messages_fts, 0, '«', '»', '…', 16) AS snippet, m.created_at
      FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
      WHERE messages_fts MATCH ? AND m.role IN ('user','assistant')
      ORDER BY bm25(messages_fts) LIMIT ?`).all(q, limit) as Array<{ session_id: string; role: string; snippet: string; created_at: number }>;
  }

  // ---------- Mémoire durable ----------

  remember(content: string, origin: Origin, kind = 'fact', tags = ''): { id: number; updated: boolean } {
    const norm = content.trim();
    const now = Date.now();
    const dup = this.db.prepare('SELECT id, trust FROM memories WHERE lower(content) = lower(?)').get(norm) as { id: number; trust: number } | undefined;
    if (dup) {
      // Une confirmation par une source plus fiable fait monter la confiance, jamais l'inverse.
      this.db.prepare('UPDATE memories SET trust = MAX(trust, ?), origin = CASE WHEN ? > trust THEN ? ELSE origin END, last_used_at = ? WHERE id = ?')
        .run(TRUST[origin], TRUST[origin], origin, now, dup.id);
      return { id: dup.id, updated: true };
    }
    const r = this.db.prepare('INSERT INTO memories(kind, content, origin, trust, tags, created_at, last_used_at) VALUES (?,?,?,?,?,?,?)')
      .run(kind, norm, origin, TRUST[origin], tags, now, now);
    return { id: Number(r.lastInsertRowid), updated: false };
  }

  /**
   * Rappel classé : pertinence BM25 × confiance × fraîcheur (demi-vie ~30 jours) × épinglage.
   * `includeQuarantined` = false exclut les mémoires d'origine non fiable.
   */
  recall(query: string, limit = 6, includeQuarantined = false): MemoryRow[] {
    const q = ftsQuery(query);
    if (!q) return [];
    const rows = this.db.prepare(`
      SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts JOIN memories m ON m.id = memories_fts.rowid
      WHERE memories_fts MATCH ? ${includeQuarantined ? '' : "AND m.origin != 'untrusted'"}
      ORDER BY rank LIMIT 40`).all(q) as unknown as Array<MemoryRow & { rank: number }>;
    const now = Date.now();
    const scored = rows.map((r) => {
      const ageDays = (now - r.last_used_at) / 86_400_000;
      const score = -r.rank * r.trust * (1 / (1 + ageDays / 30)) * (r.pinned ? 1.5 : 1);
      return { r, score };
    }).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.r);
    const touch = this.db.prepare('UPDATE memories SET uses = uses + 1, last_used_at = ? WHERE id = ?');
    for (const r of scored) touch.run(now, r.id);
    return scored;
  }

  /** Mémoires épinglées : toujours présentes dans le prompt (préférences clés). */
  pinned(): MemoryRow[] {
    return this.db.prepare("SELECT * FROM memories WHERE pinned = 1 AND origin != 'untrusted' ORDER BY id LIMIT 20").all() as unknown as MemoryRow[];
  }

  listMemories(limit = 50): MemoryRow[] {
    return this.db.prepare('SELECT * FROM memories ORDER BY last_used_at DESC LIMIT ?').all(limit) as unknown as MemoryRow[];
  }

  forget(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM memories WHERE id = ?').run(id).changes) > 0;
  }

  pin(id: number, on = true): void {
    this.db.prepare('UPDATE memories SET pinned = ? WHERE id = ?').run(on ? 1 : 0, id);
  }

  /** Validation humaine d'une mémoire en quarantaine : elle devient fiable. */
  vouch(id: number): void {
    this.db.prepare("UPDATE memories SET origin = 'owner', trust = 1 WHERE id = ?").run(id);
  }

  // ---------- Appairage des inconnus (canaux de messagerie) ----------

  pairingStatus(channel: string, peer: string): 'approved' | 'pending' | 'none' {
    const r = this.db.prepare('SELECT status FROM pairings WHERE channel = ? AND peer = ?').get(channel, peer) as { status: string } | undefined;
    return (r?.status as 'approved' | 'pending') ?? 'none';
  }

  requestPairing(channel: string, peer: string, name: string): string {
    const existing = this.db.prepare("SELECT code, created_at FROM pairings WHERE channel = ? AND peer = ? AND status = 'pending'").get(channel, peer) as { code: string; created_at: number } | undefined;
    if (existing && Date.now() - existing.created_at < 3_600_000) return existing.code;
    const code = randomCode();
    this.db.prepare("INSERT OR REPLACE INTO pairings(channel, peer, name, code, status, created_at) VALUES (?,?,?,?, 'pending', ?)").run(channel, peer, name, code, Date.now());
    return code;
  }

  approvePairing(channel: string, code: string): { peer: string; name: string } | undefined {
    const r = this.db.prepare("SELECT peer, name, created_at FROM pairings WHERE channel = ? AND code = ? AND status = 'pending'").get(channel, code.toUpperCase()) as { peer: string; name: string; created_at: number } | undefined;
    if (!r || Date.now() - r.created_at > 3_600_000) return undefined; // code expiré après 1 h
    this.db.prepare("UPDATE pairings SET status = 'approved' WHERE channel = ? AND peer = ?").run(channel, r.peer);
    return { peer: r.peer, name: r.name };
  }

  listPairings(): Array<{ channel: string; peer: string; name: string; code: string; status: string }> {
    return this.db.prepare('SELECT channel, peer, name, code, status FROM pairings ORDER BY created_at DESC').all() as Array<{ channel: string; peer: string; name: string; code: string; status: string }>;
  }

  // ---------- Tâches planifiées ----------

  addJob(j: Omit<JobRow, 'enabled' | 'last_run'>): void {
    this.db.prepare('INSERT INTO jobs(id, cron, prompt, channel, peer, next_run, created_at, tainted) VALUES (?,?,?,?,?,?,?,?)').run(j.id, j.cron, j.prompt, j.channel, j.peer, j.next_run, Date.now(), j.tainted ? 1 : 0);
  }

  listJobs(): JobRow[] { return this.db.prepare('SELECT * FROM jobs ORDER BY next_run').all() as unknown as JobRow[]; }

  dueJobs(now: number): JobRow[] {
    return this.db.prepare('SELECT * FROM jobs WHERE enabled = 1 AND next_run <= ?').all(now) as unknown as JobRow[];
  }

  /** Avance la prochaine exécution AVANT de lancer la tâche : au plus une exécution même après un crash. */
  advanceJob(id: string, lastRun: number, nextRun: number): void {
    this.db.prepare('UPDATE jobs SET last_run = ?, next_run = ? WHERE id = ?').run(lastRun, nextRun, id);
  }

  removeJob(id: string): boolean { return Number(this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id).changes) > 0; }

  // ---------- Autorisations permanentes (« toujours autoriser ») ----------

  findGrant(key: string): { id: number } | undefined {
    return this.db.prepare('SELECT id FROM grants WHERE key = ?').get(key) as { id: number } | undefined;
  }

  addGrant(key: string, tool: string, example: string): void {
    this.db.prepare('INSERT OR IGNORE INTO grants(key, tool, example, created_at) VALUES (?,?,?,?)').run(key, tool, example, Date.now());
  }

  touchGrant(id: number): void {
    this.db.prepare('UPDATE grants SET uses = uses + 1, last_used = ? WHERE id = ?').run(Date.now(), id);
  }

  listGrants(): Array<{ id: number; key: string; tool: string; example: string; created_at: number; uses: number; last_used: number }> {
    return this.db.prepare('SELECT * FROM grants ORDER BY created_at DESC').all() as Array<{ id: number; key: string; tool: string; example: string; created_at: number; uses: number; last_used: number }>;
  }

  revokeGrant(idOrKey: string | number): boolean {
    return Number(this.db.prepare('DELETE FROM grants WHERE id = ? OR key = ?').run(Number(idOrKey) || -1, String(idOrKey)).changes) > 0;
  }

  // ---------- Statistiques ----------

  recordUsage(sessionId: string, provider: string, tin: number, tout: number, cost: number, purpose = 'agent'): void {
    this.db.prepare('INSERT INTO usage(session_id, provider, tokens_in, tokens_out, cost_usd, created_at, purpose) VALUES (?,?,?,?,?,?,?)').run(sessionId, provider, tin, tout, cost, Date.now(), purpose);
  }

  // ---------- Missions (chaque tour de l'agent, pour l'onglet Missions) ----------

  startMission(m: { id: string; sessionId: string; goal: string; origin: string }): void {
    const now = Date.now();
    this.db.prepare('INSERT INTO missions(id, session_id, goal, status, origin, started_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(m.id, m.sessionId, m.goal.slice(0, 300), 'en cours', m.origin, now, now);
  }
  progressMission(id: string, p: { steps?: number; toolCalls?: number; costUsd?: number; subagents?: number; lastTool?: string }): void {
    this.db.prepare('UPDATE missions SET steps = COALESCE(?, steps), tool_calls = COALESCE(?, tool_calls), cost_usd = COALESCE(?, cost_usd), subagents = subagents + COALESCE(?, 0), last_tool = COALESCE(?, last_tool), updated_at = ? WHERE id = ?')
      .run(p.steps ?? null, p.toolCalls ?? null, p.costUsd ?? null, p.subagents ?? null, p.lastTool ?? null, Date.now(), id);
  }
  endMission(id: string, status: 'terminée' | 'arrêtée' | 'échouée' | 'en attente', result: string, costUsd?: number): void {
    this.db.prepare('UPDATE missions SET status = ?, result = ?, cost_usd = COALESCE(?, cost_usd), ended_at = ?, updated_at = ? WHERE id = ?').run(status, result.slice(0, 2000), costUsd ?? null, Date.now(), Date.now(), id);
  }
  listMissions(limit = 50): MissionRow[] {
    return this.db.prepare('SELECT * FROM missions ORDER BY (status = \'en cours\') DESC, updated_at DESC LIMIT ?').all(limit) as unknown as MissionRow[];
  }
  getMission(id: string): MissionRow | undefined { return this.db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as MissionRow | undefined; }

  /** Coût par fournisseur et par finalité depuis une date (Réglages → Modèle). */
  usageBreakdown(ts: number): Array<{ provider: string; purpose: string; calls: number; tokens: number; cost_usd: number }> {
    return this.db.prepare('SELECT provider, purpose, COUNT(*) AS calls, SUM(tokens_in + tokens_out) AS tokens, SUM(cost_usd) AS cost_usd FROM usage WHERE created_at >= ? GROUP BY provider, purpose ORDER BY cost_usd DESC').all(ts) as never;
  }
  /** Dépense depuis le 1er du mois (heure locale). */
  monthCost(now = new Date()): number {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return Number((this.db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM usage WHERE created_at >= ?').get(start) as { c: number }).c);
  }

  usageSince(ts: number): { tokens_in: number; tokens_out: number; cost_usd: number } {
    return this.db.prepare('SELECT COALESCE(SUM(tokens_in),0) AS tokens_in, COALESCE(SUM(tokens_out),0) AS tokens_out, COALESCE(SUM(cost_usd),0) AS cost_usd FROM usage WHERE created_at >= ?').get(ts) as { tokens_in: number; tokens_out: number; cost_usd: number };
  }

  touchSkill(name: string): void {
    this.db.prepare('INSERT INTO skill_stats(name, uses, last_used) VALUES (?, 1, ?) ON CONFLICT(name) DO UPDATE SET uses = uses + 1, last_used = excluded.last_used').run(name, Date.now());
  }

  skillStats(): Array<{ name: string; uses: number; last_used: number }> {
    return this.db.prepare('SELECT * FROM skill_stats ORDER BY uses DESC').all() as Array<{ name: string; uses: number; last_used: number }>;
  }
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1 ambigus
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
