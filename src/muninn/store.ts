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
import type { RouteEntry } from '../providers/journal.ts';

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
  /** De quoi ou de qui parle ce souvenir (« proprietaire », « nas », « personne:Mariam »…). */
  subject?: string;
  /** Ce qu'il dit du sujet (« adresse_ip », « heure_reveil »…) : un nouveau fait de même clé remplace l'ancien. */
  topic?: string;
  /** D'où il vient (conversation, outil, document…) et quand. */
  source?: string;
  superseded_by?: number | null;
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

/** Une personne qui parle à Odin : propriétaire (tout), membre (de confiance, autonomie plafonnée, validations chez le propriétaire) ou invité (contenu non fiable). */
export type UserRole = 'owner' | 'member' | 'guest';
export interface UserRow { id: string; name: string; role: UserRole; autonomy: 'prudent' | 'equilibre' | 'autonome'; created_at: number }

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
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, question TEXT NOT NULL, claim TEXT NOT NULL, verdict TEXT NOT NULL,
  url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '', published TEXT NOT NULL DEFAULT '', accessed TEXT NOT NULL, quote TEXT NOT NULL,
  stance TEXT NOT NULL, tier TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS evidence_claim ON evidence(at);
CREATE TABLE IF NOT EXISTS skill_stats(name TEXT PRIMARY KEY, uses INTEGER NOT NULL DEFAULT 0, last_used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS missions(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL, origin TEXT NOT NULL DEFAULT 'user',
  steps INTEGER NOT NULL DEFAULT 0, tool_calls INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, subagents INTEGER NOT NULL DEFAULT 0,
  last_tool TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ended_at INTEGER);
CREATE TABLE IF NOT EXISTS usage(session_id TEXT, provider TEXT, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, autonomy TEXT NOT NULL DEFAULT 'prudent', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities(channel TEXT NOT NULL, peer TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(channel, peer));
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
    for (const col of ["subject TEXT NOT NULL DEFAULT ''", "topic TEXT NOT NULL DEFAULT ''", "source TEXT NOT NULL DEFAULT ''", 'superseded_by INTEGER']) {
      try { this.db.exec(`ALTER TABLE memories ADD COLUMN ${col}`); } catch { /* colonne déjà présente */ }
    }
    this.db.exec('CREATE TABLE IF NOT EXISTS memory_vec(id INTEGER PRIMARY KEY, model TEXT NOT NULL, vec BLOB NOT NULL)');
    // Journal des routages : quelle IA a traité quoi, pourquoi, et qui a été essayé avant.
    this.db.exec(`CREATE TABLE IF NOT EXISTS routing(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, turn_id TEXT NOT NULL, session_id TEXT NOT NULL,
      channel TEXT NOT NULL, request TEXT NOT NULL, purpose TEXT NOT NULL, provider TEXT NOT NULL, label TEXT NOT NULL, tier TEXT NOT NULL, min_tier TEXT NOT NULL,
      need TEXT NOT NULL, reason TEXT NOT NULL, attempts TEXT NOT NULL, ok INTEGER NOT NULL, ms INTEGER NOT NULL, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL, cost_usd REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS routing_turn ON routing(turn_id); CREATE INDEX IF NOT EXISTS routing_session ON routing(session_id, at); CREATE INDEX IF NOT EXISTS routing_at ON routing(at);`);
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
  /** Tous les messages d'une session entre deux dates (ligne de temps d'une mission). */
  messagesBetween(sessionId: string, from: number, to: number): Array<{ role: string; content: string; tool_calls: string | null; tool_name: string | null; created_at: number }> {
    return this.db.prepare('SELECT role, content, tool_calls, tool_name, created_at FROM messages WHERE session_id = ? AND created_at >= ? AND created_at <= ? ORDER BY id LIMIT 400').all(sessionId, from, to) as never;
  }
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

  remember(content: string, origin: Origin, kind = 'fact', tags = '', meta: { subject?: string; topic?: string; source?: string } = {}): { id: number; updated: boolean; replaced?: string } {
    const norm = content.trim();
    const now = Date.now();
    const dup = this.db.prepare('SELECT id, trust FROM memories WHERE lower(content) = lower(?) AND superseded_by IS NULL').get(norm) as { id: number; trust: number } | undefined;
    if (dup) {
      // Une confirmation par une source plus fiable fait monter la confiance, jamais l'inverse.
      this.db.prepare('UPDATE memories SET trust = MAX(trust, ?), origin = CASE WHEN ? > trust THEN ? ELSE origin END, last_used_at = ? WHERE id = ?')
        .run(TRUST[origin], TRUST[origin], origin, now, dup.id);
      return { id: dup.id, updated: true };
    }
    const subject = (meta.subject ?? '').trim().toLowerCase().slice(0, 60), topic = (meta.topic ?? '').trim().toLowerCase().slice(0, 60);
    // Un fait plus récent sur le même sujet et la même clé remplace l'ancien (gardé dans l'historique),
    // sauf si l'ancien vient d'une source plus fiable (ex. ce que TU as dit, face à une page web).
    const old = subject && topic ? this.db.prepare('SELECT id, content, trust FROM memories WHERE subject = ? AND topic = ? AND superseded_by IS NULL ORDER BY id DESC LIMIT 1').get(subject, topic) as { id: number; content: string; trust: number } | undefined : undefined;
    if (old && old.trust > TRUST[origin]) return { id: old.id, updated: true };
    const r = this.db.prepare('INSERT INTO memories(kind, content, origin, trust, tags, created_at, last_used_at, subject, topic, source) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(kind, norm, origin, TRUST[origin], tags, now, now, subject, topic, (meta.source ?? '').slice(0, 120));
    const id = Number(r.lastInsertRowid);
    if (old) this.db.prepare('UPDATE memories SET superseded_by = ? WHERE id = ?').run(id, old.id);
    return { id, updated: false, replaced: old?.content };
  }

  /** Oubli : les souvenirs périmés ou jamais utilisés s'effacent (jamais ceux que tu as épinglés ou validés). */
  decay(now = Date.now()): number {
    const day = 86_400_000;
    const r1 = this.db.prepare("DELETE FROM memories WHERE pinned = 0 AND superseded_by IS NOT NULL AND created_at < ?").run(now - 180 * day);
    const r2 = this.db.prepare("DELETE FROM memories WHERE pinned = 0 AND origin != 'owner' AND kind = 'mission' AND last_used_at < ?").run(now - 90 * day);
    const r3 = this.db.prepare("DELETE FROM memories WHERE pinned = 0 AND origin = 'untrusted' AND last_used_at < ?").run(now - 30 * day);
    const r4 = this.db.prepare("DELETE FROM memories WHERE pinned = 0 AND origin = 'agent' AND uses = 0 AND last_used_at < ?").run(now - 365 * day);
    this.db.exec('DELETE FROM memory_vec WHERE id NOT IN (SELECT id FROM memories)');
    return Number(r1.changes) + Number(r2.changes) + Number(r3.changes) + Number(r4.changes);
  }

  /** Leçons apprises (corrections, erreurs vérifiées) : les plus récentes et les plus pertinentes. */
  lessons(query = '', limit = 6): MemoryRow[] {
    const rel = query ? this.recall(query, 20).filter((m) => m.kind === 'lesson') : [];
    const recent = this.db.prepare("SELECT * FROM memories WHERE kind = 'lesson' AND superseded_by IS NULL ORDER BY id DESC LIMIT ?").all(limit) as unknown as MemoryRow[];
    const seen = new Set<number>();
    return [...rel, ...recent].filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, limit);
  }

  /** Fiche d'un sujet : tout ce qu'Odin sait d'un appareil, d'une personne, de toi (faits actuels + anciens). */
  profile(subject: string): { current: MemoryRow[]; history: MemoryRow[] } {
    const s = `%${subject.trim().toLowerCase()}%`;
    const rows = this.db.prepare("SELECT * FROM memories WHERE origin != 'untrusted' AND (subject LIKE ? OR lower(content) LIKE ? OR lower(tags) LIKE ?) ORDER BY created_at DESC LIMIT 200").all(s, s, s) as unknown as MemoryRow[];
    return { current: rows.filter((r) => !r.superseded_by), history: rows.filter((r) => r.superseded_by) };
  }

  /** Les sujets connus, avec leur nombre de faits (fiches). */
  subjects(): Array<{ subject: string; n: number }> {
    return this.db.prepare("SELECT subject, COUNT(*) AS n FROM memories WHERE subject != '' AND superseded_by IS NULL AND origin != 'untrusted' GROUP BY subject ORDER BY n DESC LIMIT 100").all() as Array<{ subject: string; n: number }>;
  }

  // ---------- Recherche par le sens (vecteurs facultatifs) ----------
  setVector(id: number, model: string, vec: Float32Array): void { this.db.prepare('INSERT OR REPLACE INTO memory_vec(id, model, vec) VALUES (?,?,?)').run(id, model, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)); }
  missingVectors(model: string, limit = 50): Array<{ id: number; content: string }> {
    return this.db.prepare("SELECT m.id, m.content FROM memories m LEFT JOIN memory_vec v ON v.id = m.id AND v.model = ? WHERE v.id IS NULL AND m.superseded_by IS NULL AND m.origin != 'untrusted' LIMIT ?").all(model, limit) as Array<{ id: number; content: string }>;
  }
  /** Les souvenirs les plus proches d'un vecteur (cosinus). */
  nearest(model: string, q: Float32Array, limit = 6): MemoryRow[] {
    const rows = this.db.prepare("SELECT m.*, v.vec FROM memory_vec v JOIN memories m ON m.id = v.id WHERE v.model = ? AND m.superseded_by IS NULL AND m.origin != 'untrusted'").all(model) as unknown as Array<MemoryRow & { vec: Uint8Array }>;
    const norm = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1, qn = norm(q);
    return rows.map((r) => { const v = new Float32Array(r.vec.buffer.slice(r.vec.byteOffset, r.vec.byteOffset + r.vec.byteLength)); let d = 0; for (let i = 0; i < Math.min(v.length, q.length); i++) d += v[i] * q[i]; return { r, s: d / (norm(v) * qn) }; })
      .filter((x) => x.s > 0.45).sort((a, b) => b.s - a.s).slice(0, limit).map(({ r: { vec: _v, ...m } }) => m as MemoryRow);
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
      WHERE memories_fts MATCH ? AND m.superseded_by IS NULL ${includeQuarantined ? '' : "AND m.origin != 'untrusted'"}
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
    return this.db.prepare("SELECT * FROM memories WHERE pinned = 1 AND origin != 'untrusted' AND superseded_by IS NULL ORDER BY id LIMIT 20").all() as unknown as MemoryRow[];
  }

  listMemories(limit = 50): MemoryRow[] {
    return this.db.prepare('SELECT * FROM memories ORDER BY last_used_at DESC LIMIT ?').all(limit) as unknown as MemoryRow[];
  }

  /** Modifie le texte d'un souvenir (par toi, ou par Odin quand il range sa mémoire). */
  editMemory(id: number, content: string, owner = false): boolean {
    return Number(this.db.prepare(`UPDATE memories SET content = ?${owner ? ", origin = 'owner', trust = 1" : ''} WHERE id = ?`).run(content.slice(0, 1000), id).changes) > 0;
  }
  getMemory(id: number): MemoryRow | undefined { return this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as unknown as MemoryRow | undefined; }
  /** Remet un souvenir effacé (annulation du rangement). */
  restoreMemory(m: MemoryRow): void {
    if (this.getMemory(m.id)) this.db.prepare('UPDATE memories SET content = ?, origin = ?, trust = ?, pinned = ? WHERE id = ?').run(m.content, m.origin, m.trust, m.pinned, m.id);
    else this.db.prepare('INSERT INTO memories(id, kind, content, origin, trust, tags, created_at, last_used_at, uses, pinned) VALUES (?,?,?,?,?,?,?,?,?,?)').run(m.id, m.kind, m.content, m.origin, m.trust, m.tags, m.created_at, m.last_used_at, m.uses, m.pinned);
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

  // ---------- Personnes (famille, équipe) ----------

  userFor(channel: string, peer: string): UserRow | undefined {
    return this.db.prepare('SELECT u.* FROM identities i JOIN users u ON u.id = i.user_id WHERE i.channel = ? AND i.peer = ?').get(channel, peer) as unknown as UserRow | undefined;
  }
  listUsers(): Array<UserRow & { identities: Array<{ channel: string; peer: string }> }> {
    const users = this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as UserRow[];
    const ids = this.db.prepare('SELECT channel, peer, user_id FROM identities').all() as Array<{ channel: string; peer: string; user_id: string }>;
    return users.map((u) => ({ ...u, identities: ids.filter((i) => i.user_id === u.id).map(({ channel, peer }) => ({ channel, peer })) }));
  }
  saveUser(u: { id?: string; name: string; role: UserRole; autonomy?: UserRow['autonomy'] }): UserRow {
    const name = u.name.trim().slice(0, 60);
    if (!name) throw new Error('un nom est requis');
    if (!['owner', 'member', 'guest'].includes(u.role)) throw new Error('rôle : owner, member ou guest');
    const autonomy = u.autonomy ?? 'prudent';
    if (!['prudent', 'equilibre', 'autonome'].includes(autonomy)) throw new Error('autonomie d\'un membre : prudent, equilibre ou autonome (jamais breaker)');
    const id = u.id ?? `u_${randomCode().toLowerCase()}${Date.now().toString(36)}`;
    this.db.prepare('INSERT INTO users(id, name, role, autonomy, created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, autonomy = excluded.autonomy').run(id, name, u.role, autonomy, Date.now());
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
  }
  deleteUser(id: string): void {
    this.db.prepare('DELETE FROM identities WHERE user_id = ?').run(id);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
  linkIdentity(channel: string, peer: string, userId: string): void {
    if (!this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new Error('personne inconnue');
    this.db.prepare('INSERT OR REPLACE INTO identities(channel, peer, user_id) VALUES (?,?,?)').run(channel, peer, userId);
    this.db.prepare("INSERT OR REPLACE INTO pairings(channel, peer, name, code, status, created_at) VALUES (?,?,?,?, 'approved', ?)").run(channel, peer, '', '', Date.now());
  }
  unlinkIdentity(channel: string, peer: string): void {
    this.db.prepare('DELETE FROM identities WHERE channel = ? AND peer = ?').run(channel, peer);
    this.db.prepare('DELETE FROM pairings WHERE channel = ? AND peer = ?').run(channel, peer);
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

  // ---------- Habitudes ----------

  /**
   * Demandes que tu fais souvent (au moins « min » fois en « days » jours, hors tâches planifiées) :
   * Odin propose d'en faire une tâche automatique. Les demandes ignorées ne reviennent pas.
   */
  habits(days = 14, min = 3, now = Date.now()): Array<{ text: string; count: number; key: string }> {
    const rows = this.db.prepare("SELECT m.content FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.role = 'user' AND m.tainted = 0 AND m.created_at >= ? AND s.id NOT LIKE 'cron:%' AND s.id NOT LIKE 'breaker:%' AND s.id NOT LIKE 'auto:%' AND m.content NOT LIKE 'Travail continu%' AND m.content NOT LIKE 'Reprends la mission%'").all(now - days * 86_400_000) as Array<{ content: string }>;
    const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\b(stp|svp|s il te plait|merci|odin|peux tu|tu peux|est ce que)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const groups = new Map<string, { text: string; count: number }>();
    for (const r of rows) {
      const k = norm(r.content).slice(0, 80);
      if (k.length < 8 || k.split(' ').length < 2) continue;
      const g = groups.get(k);
      if (g) g.count++; else groups.set(k, { text: r.content.trim().slice(0, 200), count: 1 });
    }
    const ignored = new Set((this.db.prepare("SELECT value FROM kv WHERE key LIKE 'habit-ignored:%'").all() as Array<{ value: string }>).map((r) => r.value));
    const jobs = this.listJobs().map((j) => norm(j.prompt));
    return [...groups].filter(([k, g]) => g.count >= min && !ignored.has(k) && !jobs.some((j) => j.includes(k) || k.includes(j)))
      .map(([key, g]) => ({ key, ...g })).sort((a, b) => b.count - a.count).slice(0, 5);
  }
  /** Tes derniers messages (pour repérer tes besoins : mail, agenda…). */
  recentUserTexts(limit = 300, days = 30, now = Date.now()): string[] {
    return (this.db.prepare("SELECT content FROM messages WHERE role = 'user' AND tainted = 0 AND created_at >= ? ORDER BY id DESC LIMIT ?").all(now - days * 86_400_000, limit) as Array<{ content: string }>).map((r) => r.content);
  }
  /** Archive une preuve (adresse, titre, dates, passage exact qui justifie l'affirmation). */
  addEvidence(e: { session: string; question: string; claim: string; verdict: string; url: string; title: string; site: string; published?: string; accessed: string; quote: string; stance: string; tier: string }): void {
    this.db.prepare('INSERT INTO evidence(session_id, question, claim, verdict, url, title, site, published, accessed, quote, stance, tier, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(e.session, e.question.slice(0, 500), e.claim.slice(0, 500), e.verdict, e.url.slice(0, 1000), e.title.slice(0, 300), e.site, e.published ?? '', e.accessed, e.quote.slice(0, 600), e.stance, e.tier, Date.now());
  }
  /** Preuves déjà archivées sur un sujet (recherche simple). */
  findEvidence(q: string, limit = 20): Array<{ claim: string; verdict: string; url: string; title: string; published: string; accessed: string; quote: string; stance: string; at: number }> {
    const like = `%${q.replace(/[%_]/g, '').slice(0, 100)}%`;
    return this.db.prepare('SELECT claim, verdict, url, title, published, accessed, quote, stance, at FROM evidence WHERE claim LIKE ? OR question LIKE ? OR quote LIKE ? ORDER BY at DESC LIMIT ?').all(like, like, like, limit) as never;
  }

  getKv(key: string): string | undefined { return (this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value; }
  setKv(key: string, value: string): void { if (value) this.db.prepare('INSERT OR REPLACE INTO kv(key, value) VALUES (?, ?)').run(key, value); else this.db.prepare('DELETE FROM kv WHERE key = ?').run(key); }
  kvPrefix(prefix: string): Record<string, string> { return Object.fromEntries((this.db.prepare('SELECT key, value FROM kv WHERE key LIKE ?').all(`${prefix}%`) as Array<{ key: string; value: string }>).map((r) => [r.key.slice(prefix.length), r.value])); }
  ignoreHabit(key: string): void { this.db.prepare('INSERT OR REPLACE INTO kv(key, value) VALUES (?, ?)').run(`habit-ignored:${key}`, key); }

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

  // ---------- Journal des routages ----------

  recordRoute(e: RouteEntry): void {
    this.db.prepare('INSERT INTO routing(at, turn_id, session_id, channel, request, purpose, provider, label, tier, min_tier, need, reason, attempts, ok, ms, tokens_in, tokens_out, cost_usd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(e.at, e.turnId, e.sessionId, e.channel, e.request.slice(0, 160), e.purpose, e.provider, e.label, e.tier, e.minTier, e.need, e.reason.slice(0, 300), JSON.stringify(e.attempts.slice(0, 20)), e.ok ? 1 : 0, Math.round(e.ms), e.tokensIn, e.tokensOut, e.costUsd);
  }
  /** Les chiffres des économies depuis une date : tâches faites sans IA, demandes confiées à une IA, par fournisseur. */
  savingsData(since: number): { direct: number; learned: number; aiTurns: number; aiCalls: number; spentUsd: number; tokens: number; byProvider: Array<{ provider: string; label: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }>; reasons: Array<{ reason: string; n: number }> } {
    const one = (sql: string, ...a: Array<string | number>) => this.db.prepare(sql).get(...a) as Record<string, number | null>;
    const d = one("SELECT COUNT(*) AS n, SUM(CASE WHEN reason LIKE 'appris le %' THEN 1 ELSE 0 END) AS learned FROM routing WHERE purpose = 'sans-ia' AND at >= ?", since);
    const ai = one("SELECT COUNT(DISTINCT turn_id) AS turns, COUNT(*) AS calls, SUM(cost_usd) AS cost, SUM(tokens_in + tokens_out) AS tokens FROM routing WHERE provider != '' AND ok = 1 AND at >= ?", since);
    const byProvider = (this.db.prepare("SELECT provider, MAX(label) AS label, COUNT(*) AS calls, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(cost_usd) AS cost FROM routing WHERE provider != '' AND ok = 1 AND at >= ? GROUP BY provider ORDER BY calls DESC").all(since) as Array<Record<string, string | number>>)
      .map((r) => ({ provider: String(r.provider), label: String(r.label ?? ''), calls: Number(r.calls), tokensIn: Number(r.tin ?? 0), tokensOut: Number(r.tout ?? 0), costUsd: Number(r.cost ?? 0) }));
    const reasons = (this.db.prepare("SELECT reason, COUNT(*) AS n FROM routing WHERE purpose = 'sans-ia' AND at >= ? GROUP BY reason ORDER BY n DESC LIMIT 8").all(since) as Array<{ reason: string; n: number }>).map((r) => ({ reason: String(r.reason), n: Number(r.n) }));
    return { direct: Number(d.n ?? 0), learned: Number(d.learned ?? 0), aiTurns: Number(ai.turns ?? 0), aiCalls: Number(ai.calls ?? 0), spentUsd: Number(ai.cost ?? 0), tokens: Number(ai.tokens ?? 0), byProvider, reasons };
  }
  /** Ménage du journal, une fois par jour : on garde 6 mois, 50 000 appels au plus. */
  pruneRoutes(now = Date.now()): number {
    return Number(this.db.prepare('DELETE FROM routing WHERE at < ? OR id <= (SELECT MAX(id) - 50000 FROM routing)').run(now - 183 * 86_400_000).changes);
  }
  /** Appels journalisés, du plus récent au plus ancien. */
  routes(q: { limit?: number; sessionId?: string; turnId?: string; since?: number; provider?: string } = {}): RouteEntry[] {
    const where: string[] = [], args: Array<string | number> = [];
    if (q.sessionId) { where.push('session_id = ?'); args.push(q.sessionId); }
    if (q.turnId) { where.push('turn_id = ?'); args.push(q.turnId); }
    if (q.since) { where.push('at >= ?'); args.push(q.since); }
    if (q.provider) { where.push('provider = ?'); args.push(q.provider); }
    const rows = this.db.prepare(`SELECT * FROM routing ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, id DESC LIMIT ?`).all(...args, Math.min(500, q.limit ?? 50)) as Array<Record<string, string | number>>;
    return rows.map((r) => ({
      at: Number(r.at), turnId: String(r.turn_id), sessionId: String(r.session_id), channel: String(r.channel), request: String(r.request), purpose: String(r.purpose),
      provider: String(r.provider), label: String(r.label), tier: String(r.tier), minTier: String(r.min_tier), need: String(r.need), reason: String(r.reason),
      attempts: (() => { try { return JSON.parse(String(r.attempts)); } catch { return []; } })(), ok: Number(r.ok) === 1, ms: Number(r.ms),
      tokensIn: Number(r.tokens_in), tokensOut: Number(r.tokens_out), costUsd: Number(r.cost_usd),
    }));
  }
  /** Derniers tours d'une conversation (le plus récent d'abord). */
  recentTurns(sessionId: string, limit = 5): string[] {
    return (this.db.prepare("SELECT turn_id, MAX(at) AS t FROM routing WHERE session_id = ? AND turn_id != '' GROUP BY turn_id ORDER BY t DESC LIMIT ?").all(sessionId, limit) as Array<{ turn_id: string }>).map((r) => r.turn_id);
  }
  /** Bilan par IA depuis une date : appels, réussites, échecs, temps moyen, jetons, coût. */
  routeStats(since: number): Array<{ provider: string; label: string; calls: number; ok: number; failed: number; avg_ms: number; tokens: number; cost_usd: number }> {
    return this.db.prepare("SELECT provider, MAX(label) AS label, COUNT(*) AS calls, SUM(ok) AS ok, SUM(1 - ok) AS failed, CAST(AVG(ms) AS INTEGER) AS avg_ms, SUM(tokens_in + tokens_out) AS tokens, SUM(cost_usd) AS cost_usd FROM routing WHERE at >= ? AND provider != '' GROUP BY provider ORDER BY calls DESC").all(since) as never;
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
  /** Missions coupées net (Odin redémarré pendant le travail) : à reprendre. */
  interruptedMissions(since: number): MissionRow[] { return this.db.prepare("SELECT * FROM missions WHERE status = 'en cours' AND updated_at >= ?").all(since) as unknown as MissionRow[]; }
  /** Missions à relancer : échouées (modèle indisponible…) ou arrêtées faute d'étapes. */
  stalledMissions(since: number): MissionRow[] { return this.db.prepare("SELECT * FROM missions WHERE status IN ('échouée', 'en attente') AND updated_at >= ? ORDER BY updated_at DESC LIMIT 10").all(since) as unknown as MissionRow[]; }
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

  /** Résultat d'une mission où la compétence a servi (réussite, durée, coût). */
  skillOutcome(name: string, ok: boolean, ms = 0, cost = 0): void {
    try { this.db.exec('ALTER TABLE skill_stats ADD COLUMN ok INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà là */ }
    try { this.db.exec('ALTER TABLE skill_stats ADD COLUMN fails INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà là */ }
    try { this.db.exec('ALTER TABLE skill_stats ADD COLUMN total_ms INTEGER NOT NULL DEFAULT 0'); } catch { /* déjà là */ }
    try { this.db.exec('ALTER TABLE skill_stats ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0'); } catch { /* déjà là */ }
    this.db.prepare('INSERT INTO skill_stats(name, uses, last_used) VALUES (?, 0, ?) ON CONFLICT(name) DO NOTHING').run(name, Date.now());
    this.db.prepare(`UPDATE skill_stats SET ${ok ? 'ok = ok + 1' : 'fails = fails + 1'}, total_ms = total_ms + ?, cost_usd = cost_usd + ? WHERE name = ?`).run(Math.round(ms), cost, name);
  }

  touchSkill(name: string): void {
    this.db.prepare('INSERT INTO skill_stats(name, uses, last_used) VALUES (?, 1, ?) ON CONFLICT(name) DO UPDATE SET uses = uses + 1, last_used = excluded.last_used').run(name, Date.now());
  }

  skillStats(): Array<{ name: string; uses: number; last_used: number; ok: number; fails: number; total_ms: number; cost_usd: number }> {
    return (this.db.prepare('SELECT * FROM skill_stats ORDER BY uses DESC').all() as Array<Record<string, number | string>>).map((r) => ({ name: String(r.name), uses: Number(r.uses), last_used: Number(r.last_used), ok: Number(r.ok ?? 0), fails: Number(r.fails ?? 0), total_ms: Number(r.total_ms ?? 0), cost_usd: Number(r.cost_usd ?? 0) }));
  }
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1 ambigus
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
