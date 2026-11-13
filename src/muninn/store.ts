// Mnémosyne — le corbeau de la mémoire. AUCUNE base de données : tout est rangé en fichiers lisibles
// dans ~/.odin/memoire/ (un fichier JSONL par sorte de choses : sessions, messages, souvenirs,
// appairages, tâches planifiées, coûts…), relus au démarrage et gardés en mémoire vive.
// La recherche plein texte se fait en mémoire (mots sans accents, début de mot, classement BM25).
//
// Améliorations :
// - Une seule classe lisible, sans héritage multiple ni état global.
// - Chaque mémoire porte son origine (owner / agent / untrusted). Une mémoire issue d'un
//   contenu non fiable est « en quarantaine » : jamais injectée automatiquement dans le
//   prompt, ce qui empêche l'empoisonnement durable de la mémoire.
// - Rappel classé par pertinence × confiance × fraîcheur.

import { dirname, join } from 'node:path';
import { TextIndex, queryWords, snippet } from './fulltext.ts';
import { migrateFromSqlite } from './migrate.ts';
import { Shelf, type Table } from './tables.ts';
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

/** Transforme une phrase libre en requête sûre (gardée pour compatibilité : mots cherchés par leur début). */
export function ftsQuery(text: string): string {
  return queryWords(text).map((w) => `"${w}"*`).join(' OR ');
}

interface MessageRow { id: number; session_id: string; role: string; content: string; tool_calls: string | null; tool_call_id: string | null; tool_name: string | null; tainted: number; created_at: number }
interface VecRow { id: number; model: string; vec: string }
interface PairingRow { channel: string; peer: string; name: string; code: string; status: string; created_at: number }
interface GrantRow { id: number; key: string; tool: string; example: string; created_at: number; uses: number; last_used: number }
interface KvRow { key: string; value: string }
interface EvidenceRow { id: number; session_id: string; question: string; claim: string; verdict: string; url: string; title: string; site: string; published: string; accessed: string; quote: string; stance: string; tier: string; at: number }
interface SkillRow { name: string; uses: number; last_used: number; ok: number; fails: number; total_ms: number; cost_usd: number }
interface UsageRow { id: number; session_id: string; provider: string; tokens_in: number; tokens_out: number; cost_usd: number; created_at: number; purpose: string }
interface IdentityRow { channel: string; peer: string; user_id: string }
interface RoutingRow { id: number; at: number; turn_id: string; session_id: string; channel: string; request: string; purpose: string; provider: string; label: string; tier: string; min_tier: string; need: string; reason: string; attempts: string; ok: number; ms: number; tokens_in: number; tokens_out: number; cost_usd: number }
/** Conversation mise à la corbeille : effacée pour de bon après 7 jours, sauf si on l'annule. */
export interface TrashRow { id: string; session: SessionRow; messages: MessageRow[]; deleted_at: number; memories: number[] }

const lc = (s: unknown) => String(s ?? '').toLowerCase();
const live = (m: MemoryRow) => m.superseded_by === null || m.superseded_by === undefined;
const pk2 = (a: string, b: string) => `${a}\u0000${b}`;
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);
function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const g = new Map<string, T[]>(); for (const r of rows) { const k = key(r); const a = g.get(k); if (a) a.push(r); else g.set(k, [r]); } return g;
}
export const TRASH_DAYS = 7;

export class Mnemosyne {
  /** Le dossier de la mémoire (null : mémoire vive seulement). */
  readonly dir: string | null;
  readonly shelf: Shelf;
  private readonly sessions: Table<SessionRow & Record<string, unknown>>;
  private readonly messages: Table<MessageRow & Record<string, unknown>>;
  private readonly memories: Table<MemoryRow & Record<string, unknown>>;
  private readonly vectors: Table<VecRow & Record<string, unknown>>;
  private readonly pairings: Table<PairingRow & Record<string, unknown>>;
  private readonly jobs: Table<JobRow & { created_at: number } & Record<string, unknown>>;
  private readonly grants: Table<GrantRow & Record<string, unknown>>;
  private readonly kv: Table<KvRow & Record<string, unknown>>;
  private readonly evidence: Table<EvidenceRow & Record<string, unknown>>;
  private readonly skills: Table<SkillRow & Record<string, unknown>>;
  private readonly missions: Table<MissionRow & Record<string, unknown>>;
  private readonly usage: Table<UsageRow & Record<string, unknown>>;
  private readonly users: Table<UserRow & Record<string, unknown>>;
  private readonly identities: Table<IdentityRow & Record<string, unknown>>;
  private readonly routing: Table<RoutingRow & Record<string, unknown>>;
  private readonly trash: Table<TrashRow & Record<string, unknown>>;
  /** Mode privé : les messages restent en mémoire vive (rien sur le disque) et Odin ne retient rien. */
  privateMode = false;
  private readonly bySession = new Map<string, MessageRow[]>();
  private readonly msgIndex = new TextIndex();
  private readonly memIndex = new TextIndex();

  /**
   * `location` : « :memory: » (rien sur le disque), un dossier, ou l'ancien chemin `odin.db` :
   * la mémoire va alors dans le dossier `memoire/` à côté, et l'ancien fichier est converti une fois.
   */
  constructor(location: string) {
    if (location === ':memory:') this.dir = null;
    else if (location.endsWith('.db')) { this.dir = join(dirname(location), 'memoire'); migrateFromSqlite(location, this.dir); }
    else this.dir = location;
    this.shelf = new Shelf(this.dir);
    const s = this.shelf;
    this.sessions = s.table('sessions', (r) => r.id);
    this.messages = s.table('messages', (r) => r.id);
    this.memories = s.table('memories', (r) => r.id);
    this.vectors = s.table('memory_vec', (r) => r.id);
    this.pairings = s.table('pairings', (r) => pk2(r.channel, r.peer));
    this.jobs = s.table('jobs', (r) => r.id);
    this.grants = s.table('grants', (r) => r.id);
    this.kv = s.table('kv', (r) => r.key);
    this.evidence = s.table('evidence', (r) => r.id);
    this.skills = s.table('skill_stats', (r) => r.name);
    this.missions = s.table('missions', (r) => r.id);
    this.usage = s.table('usage', (r) => r.id);
    this.users = s.table('users', (r) => r.id);
    this.identities = s.table('identities', (r) => pk2(r.channel, r.peer));
    this.routing = s.table('routing', (r) => r.id);
    this.trash = s.table('corbeille', (r) => r.id);
    for (const m of this.messages.values()) this.indexMessage(m);
    for (const m of this.memories.values()) this.memIndex.add(m.id, `${m.content} ${m.tags ?? ''}`);
  }

  /** Une autre « table » rangée dans la même mémoire (inventaire du réseau, index des documents…). */
  table<T extends Record<string, unknown>>(name: string, keyOf: (r: T) => string | number): Table<T> { return this.shelf.table<T>(name, keyOf); }
  /** Taille de la mémoire sur le disque, en octets. */
  bytes(): number { return this.shelf.bytes(); }
  /** Réécrit chaque fichier propre (les lignes effacées disparaissent vraiment du disque). */
  compactAll(): void { this.shelf.compactAll(); }
  close(): void { /* rien à fermer : chaque changement est déjà écrit */ }

  private indexMessage(m: MessageRow): void {
    let a = this.bySession.get(m.session_id); if (!a) { a = []; this.bySession.set(m.session_id, a); } a.push(m);
    if (m.role === 'user' || m.role === 'assistant') this.msgIndex.add(m.id, m.content);
  }

  // ---------- Sessions et messages ----------

  ensureSession(id: string, channel = 'cli', peer = 'owner'): SessionRow {
    if (!this.sessions.has(id)) { const now = Date.now(); (this.privateMode ? this.sessions.putVolatile.bind(this.sessions) : this.sessions.put.bind(this.sessions))({ id, channel, peer, title: '', summary: '', compact_upto: 0, tainted: 0, created_at: now, updated_at: now, suspicious: 0 }); }
    return this.getSession(id)!;
  }
  getSession(id: string): SessionRow | undefined { return this.sessions.get(id); }
  listSessions(limit = 20): SessionRow[] { return this.sessions.all().sort((a, b) => b.updated_at - a.updated_at).slice(0, limit); }
  setSessionTitle(id: string, title: string): void { this.sessions.patch(id, { title: title.slice(0, 120) }); }
  markTainted(id: string): void { this.sessions.patch(id, { tainted: 1 }); }
  /** Un contenu manipulateur a été vu : la session reste sous surveillance jusqu'à une nouvelle conversation. */
  markSuspicious(id: string): void { this.sessions.patch(id, { suspicious: 1 }); }

  /** Une nouvelle conversation remet le marquage à zéro (l'historique reste consultable). */
  resetSession(id: string): void {
    const max = Math.max(0, ...(this.bySession.get(id) ?? []).map((m) => m.id));
    this.sessions.patch(id, { compact_upto: max, summary: '', tainted: 0, suspicious: 0 });
  }

  addMessage(sessionId: string, m: Message): number {
    const now = Date.now();
    const row = (this.privateMode ? this.messages.insertVolatile.bind(this.messages) : this.messages.insert.bind(this.messages))({ session_id: sessionId, role: m.role, content: m.content, tool_calls: m.toolCalls ? JSON.stringify(m.toolCalls) : null, tool_call_id: m.toolCallId ?? null, tool_name: m.toolName ?? null, tainted: m.tainted ? 1 : 0, created_at: now });
    if (!this.privateMode) this.indexMessage(row); else { const a = this.bySession.get(sessionId) ?? []; a.push(row); this.bySession.set(sessionId, a); }
    if (!this.privateMode) this.sessions.patch(sessionId, { updated_at: now });
    if (m.tainted) this.markTainted(sessionId);
    return row.id;
  }

  /** Tous les messages d'une session entre deux dates (ligne de temps d'une mission). */
  messagesBetween(sessionId: string, from: number, to: number): Array<{ role: string; content: string; tool_calls: string | null; tool_name: string | null; created_at: number }> {
    return (this.bySession.get(sessionId) ?? []).filter((m) => m.created_at >= from && m.created_at <= to).slice(0, 400)
      .map(({ role, content, tool_calls, tool_name, created_at }) => ({ role, content, tool_calls, tool_name, created_at }));
  }
  /** Historique actif (après la dernière compaction), avec les identifiants de ligne. */
  history(sessionId: string): Array<Message & { rowId: number }> {
    const upto = this.getSession(sessionId)?.compact_upto ?? 0;
    return (this.bySession.get(sessionId) ?? []).filter((r) => r.id > upto).map((r) => ({
      rowId: r.id,
      role: r.role as Message['role'],
      content: r.content,
      toolCalls: r.tool_calls ? (JSON.parse(r.tool_calls) as ToolCall[]) : undefined,
      toolCallId: r.tool_call_id ?? undefined,
      toolName: r.tool_name ?? undefined,
      tainted: r.tainted === 1,
    }));
  }
  /** Tous les messages d'une conversation, du premier au dernier (export). */
  allMessages(sessionId: string): MessageRow[] { return [...(this.bySession.get(sessionId) ?? [])]; }

  /** Enregistre une compaction : les messages ≤ uptoRowId sont résumés par `summary`. */
  compact(sessionId: string, uptoRowId: number, summary: string): void { this.sessions.patch(sessionId, { compact_upto: uptoRowId, summary }); }

  /** Recherche plein texte dans TOUTES les conversations passées. */
  searchMessages(query: string, limit = 8): Array<{ session_id: string; role: string; snippet: string; created_at: number }> {
    return this.msgIndex.search(query, (id) => { const m = this.messages.get(id); return Boolean(m && (m.role === 'user' || m.role === 'assistant')); }, limit)
      .map(({ id }) => { const m = this.messages.get(id)!; return { session_id: m.session_id, role: m.role, snippet: snippet(m.content, query), created_at: m.created_at }; });
  }

  // ---------- Suppression des conversations (corbeille 7 jours) ----------

  /**
   * Met une conversation à la corbeille : elle disparaît de la liste et de la recherche tout de suite,
   * et peut être remise pendant 7 jours. `forgetMemories` : oublier aussi les souvenirs qui ne viennent
   * QUE de cette conversation (au moment de l'effacement définitif).
   */
  trashSession(id: string, forgetMemories = false): boolean {
    const session = this.sessions.get(id); if (!session) return false;
    const msgs = this.allMessages(id);
    const memories = forgetMemories ? this.memories.filter((m) => m.source === `conversation:${id}` && !m.pinned).map((m) => m.id) : [];
    this.trash.put({ id, session, messages: msgs, deleted_at: Date.now(), memories });
    for (const m of msgs) { this.messages.delete(m.id); this.msgIndex.remove(m.id); }
    this.bySession.delete(id); this.sessions.delete(id);
    this.messages.compact(); this.sessions.compact();
    return true;
  }
  /** Annule une suppression (tant que la conversation est dans la corbeille). */
  restoreSession(id: string): boolean {
    const t = this.trash.get(id); if (!t) return false;
    this.sessions.put(t.session as SessionRow & Record<string, unknown>);
    for (const m of t.messages) { this.messages.put(m as MessageRow & Record<string, unknown>); this.indexMessage(m); }
    (this.bySession.get(id) ?? []).sort((a, b) => a.id - b.id);
    this.trash.delete(id); this.trash.compact();
    return true;
  }
  listTrash(): Array<{ id: string; title: string; messages: number; deleted_at: number }> {
    return this.trash.all().sort((a, b) => b.deleted_at - a.deleted_at).map((t) => ({ id: t.id, title: t.session.title, messages: t.messages.length, deleted_at: t.deleted_at }));
  }
  /** Efface pour de bon ce qui est à la corbeille depuis plus de 7 jours (ou tout, avec `all`). Rend le nombre de conversations effacées. */
  purgeTrash(now = Date.now(), all = false): number {
    let n = 0;
    for (const t of this.trash.all()) {
      if (!all && now - t.deleted_at < TRASH_DAYS * 86_400_000) continue;
      for (const id of t.memories) this.forget(id);
      for (const k of Object.keys(this.kvPrefix(`conv:${t.id}:`))) this.setKv(`conv:${t.id}:${k}`, '');
      if (t.id.startsWith('web:')) { const peer = t.id.slice(4); this.setKv(`title:${peer}`, ''); this.setKv(`pin:${peer}`, ''); }
      this.trash.delete(t.id); n++;
    }
    if (n) { this.trash.compact(); this.memories.compact(); this.vectors.compact(); this.kv.compact(); }
    return n;
  }

  // ---------- Mémoire durable ----------

  remember(content: string, origin: Origin, kind = 'fact', tags = '', meta: { subject?: string; topic?: string; source?: string } = {}): { id: number; updated: boolean; replaced?: string } {
    const norm = content.trim();
    if (this.privateMode) return { id: 0, updated: true }; // mode privé : Odin ne retient rien
    const now = Date.now();
    const low = norm.toLowerCase();
    const dup = this.memories.find((m) => live(m) && m.content.toLowerCase() === low);
    if (dup) {
      // Une confirmation par une source plus fiable fait monter la confiance, jamais l'inverse.
      this.memories.patch(dup.id, { trust: Math.max(dup.trust, TRUST[origin]), origin: TRUST[origin] > dup.trust ? origin : dup.origin, last_used_at: now });
      return { id: dup.id, updated: true };
    }
    const subject = (meta.subject ?? '').trim().toLowerCase().slice(0, 60), topic = (meta.topic ?? '').trim().toLowerCase().slice(0, 60);
    // Un fait plus récent sur le même sujet et la même clé remplace l'ancien (gardé dans l'historique),
    // sauf si l'ancien vient d'une source plus fiable (ex. ce que TU as dit, face à une page web).
    const old = subject && topic ? this.memories.filter((m) => m.subject === subject && m.topic === topic && live(m)).sort((a, b) => b.id - a.id)[0] : undefined;
    if (old && old.trust > TRUST[origin]) return { id: old.id, updated: true };
    const row = this.memories.insert({ kind, content: norm, origin, trust: TRUST[origin], tags, created_at: now, last_used_at: now, uses: 0, pinned: 0, subject, topic, source: (meta.source ?? '').slice(0, 120), superseded_by: null });
    this.memIndex.add(row.id, `${norm} ${tags}`);
    if (old) this.memories.patch(old.id, { superseded_by: row.id });
    return { id: row.id, updated: false, replaced: old?.content };
  }

  /** Oubli : les souvenirs périmés ou jamais utilisés s'effacent (jamais ceux que tu as épinglés ou validés). */
  decay(now = Date.now()): number {
    const day = 86_400_000;
    const gone = this.memories.filter((m) => !m.pinned && (
      (!live(m) && m.created_at < now - 180 * day)
      || (m.origin !== 'owner' && m.kind === 'mission' && m.last_used_at < now - 90 * day)
      || (m.origin === 'untrusted' && m.last_used_at < now - 30 * day)
      || (m.origin === 'agent' && m.uses === 0 && m.last_used_at < now - 365 * day)));
    for (const m of gone) { this.memories.delete(m.id); this.memIndex.remove(m.id); }
    this.vectors.deleteWhere((v) => !this.memories.has(v.id));
    return gone.length;
  }

  /** Leçons apprises (corrections, erreurs vérifiées) : les plus récentes et les plus pertinentes. */
  lessons(query = '', limit = 6): MemoryRow[] {
    const rel = query ? this.recall(query, 20).filter((m) => m.kind === 'lesson') : [];
    const recent = this.memories.filter((m) => m.kind === 'lesson' && live(m)).sort((a, b) => b.id - a.id).slice(0, limit);
    const seen = new Set<number>();
    return [...rel, ...recent].filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, limit);
  }

  /** Fiche d'un sujet : tout ce qu'Odin sait d'un appareil, d'une personne, de toi (faits actuels + anciens). */
  profile(subject: string): { current: MemoryRow[]; history: MemoryRow[] } {
    const s = subject.trim().toLowerCase();
    const rows = this.memories.filter((m) => m.origin !== 'untrusted' && (lc(m.subject).includes(s) || lc(m.content).includes(s) || lc(m.tags).includes(s)))
      .sort((a, b) => b.created_at - a.created_at).slice(0, 200);
    return { current: rows.filter((r) => !r.superseded_by), history: rows.filter((r) => r.superseded_by) };
  }

  /** Les sujets connus, avec leur nombre de faits (fiches). */
  subjects(): Array<{ subject: string; n: number }> {
    const g = groupBy(this.memories.filter((m) => Boolean(m.subject) && live(m) && m.origin !== 'untrusted'), (m) => m.subject!);
    return [...g].map(([subject, a]) => ({ subject, n: a.length })).sort((a, b) => b.n - a.n).slice(0, 100);
  }

  // ---------- Recherche par le sens (vecteurs facultatifs) ----------
  setVector(id: number, model: string, vec: Float32Array): void { this.vectors.put({ id, model, vec: Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64') }); }
  missingVectors(model: string, limit = 50): Array<{ id: number; content: string }> {
    return this.memories.filter((m) => live(m) && m.origin !== 'untrusted' && this.vectors.get(m.id)?.model !== model).slice(0, limit).map((m) => ({ id: m.id, content: m.content }));
  }
  /** Les souvenirs les plus proches d'un vecteur (cosinus). */
  nearest(model: string, q: Float32Array, limit = 6): MemoryRow[] {
    const norm = (a: Float32Array) => Math.sqrt(a.reduce((s, x) => s + x * x, 0)) || 1, qn = norm(q);
    const out: Array<{ r: MemoryRow; s: number }> = [];
    for (const v of this.vectors.values()) {
      if (v.model !== model) continue;
      const r = this.memories.get(v.id); if (!r || !live(r) || r.origin === 'untrusted') continue;
      const b = Buffer.from(v.vec, 'base64'), f = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      let d = 0; for (let i = 0; i < Math.min(f.length, q.length); i++) d += f[i] * q[i];
      out.push({ r, s: d / (norm(f) * qn) });
    }
    return out.filter((x) => x.s > 0.45).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.r);
  }

  /**
   * Rappel classé : pertinence BM25 × confiance × fraîcheur (demi-vie ~30 jours) × épinglage.
   * `includeQuarantined` = false exclut les mémoires d'origine non fiable.
   */
  recall(query: string, limit = 6, includeQuarantined = false): MemoryRow[] {
    const hits = this.memIndex.search(query, (id) => { const m = this.memories.get(id); return Boolean(m && live(m) && (includeQuarantined || m.origin !== 'untrusted')); }, 40);
    const now = Date.now();
    const scored = hits.map(({ id, score }) => {
      const r = this.memories.get(id)!;
      const ageDays = (now - r.last_used_at) / 86_400_000;
      return { r, score: score * r.trust * (1 / (1 + ageDays / 30)) * (r.pinned ? 1.5 : 1) };
    }).sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.r);
    for (const r of scored) this.memories.patch(r.id, { uses: r.uses + 1, last_used_at: now });
    return scored.map((r) => this.memories.get(r.id)!);
  }

  /** Mémoires épinglées : toujours présentes dans le prompt (préférences clés). */
  pinned(): MemoryRow[] { return this.memories.filter((m) => m.pinned === 1 && m.origin !== 'untrusted' && live(m)).sort((a, b) => a.id - b.id).slice(0, 20); }
  listMemories(limit = 50): MemoryRow[] { return this.memories.all().sort((a, b) => b.last_used_at - a.last_used_at).slice(0, limit); }

  /** Modifie le texte d'un souvenir (par toi, ou par Odin quand il range sa mémoire). */
  editMemory(id: number, content: string, owner = false): boolean {
    const ok = this.memories.patch(id, { content: content.slice(0, 1000), ...(owner ? { origin: 'owner' as Origin, trust: 1 } : {}) });
    if (ok) { const m = this.memories.get(id)!; this.memIndex.add(id, `${m.content} ${m.tags ?? ''}`); }
    return ok;
  }
  getMemory(id: number): MemoryRow | undefined { return this.memories.get(id); }
  /** Remet un souvenir effacé (annulation du rangement). */
  restoreMemory(m: MemoryRow): void {
    if (this.memories.has(m.id)) this.memories.patch(m.id, { content: m.content, origin: m.origin, trust: m.trust, pinned: m.pinned });
    else this.memories.put({ subject: '', topic: '', source: '', superseded_by: null, ...m } as MemoryRow & Record<string, unknown>);
    const r = this.memories.get(m.id)!; this.memIndex.add(r.id, `${r.content} ${r.tags ?? ''}`);
  }
  forget(id: number): boolean { this.memIndex.remove(id); this.vectors.delete(id); return this.memories.delete(id); }
  pin(id: number, on = true): void { this.memories.patch(id, { pinned: on ? 1 : 0 }); }
  /** Validation humaine d'une mémoire en quarantaine : elle devient fiable. */
  vouch(id: number): void { this.memories.patch(id, { origin: 'owner', trust: 1 }); }

  // ---------- Personnes (famille, équipe) ----------

  userFor(channel: string, peer: string): UserRow | undefined { const i = this.identities.get(pk2(channel, peer)); return i ? this.users.get(i.user_id) : undefined; }
  listUsers(): Array<UserRow & { identities: Array<{ channel: string; peer: string }> }> {
    const ids = this.identities.all();
    return this.users.all().sort((a, b) => a.created_at - b.created_at).map((u) => ({ ...u, identities: ids.filter((i) => i.user_id === u.id).map(({ channel, peer }) => ({ channel, peer })) }));
  }
  saveUser(u: { id?: string; name: string; role: UserRole; autonomy?: UserRow['autonomy'] }): UserRow {
    const name = u.name.trim().slice(0, 60);
    if (!name) throw new Error('un nom est requis');
    if (!['owner', 'member', 'guest'].includes(u.role)) throw new Error('rôle : owner, member ou guest');
    const autonomy = u.autonomy ?? 'prudent';
    if (!['prudent', 'equilibre', 'autonome'].includes(autonomy)) throw new Error('autonomie d\'un membre : prudent, equilibre ou autonome (jamais breaker)');
    const id = u.id ?? `u_${randomCode().toLowerCase()}${Date.now().toString(36)}`;
    const prev = this.users.get(id);
    return this.users.put({ id, name, role: u.role, autonomy, created_at: prev?.created_at ?? Date.now() });
  }
  deleteUser(id: string): void { this.identities.deleteWhere((i) => i.user_id === id); this.users.delete(id); }
  linkIdentity(channel: string, peer: string, userId: string): void {
    if (!this.users.has(userId)) throw new Error('personne inconnue');
    this.identities.put({ channel, peer, user_id: userId });
    this.pairings.put({ channel, peer, name: '', code: '', status: 'approved', created_at: Date.now() });
  }
  unlinkIdentity(channel: string, peer: string): void { this.identities.delete(pk2(channel, peer)); this.pairings.delete(pk2(channel, peer)); }

  // ---------- Appairage des inconnus (canaux de messagerie) ----------

  pairingStatus(channel: string, peer: string): 'approved' | 'pending' | 'none' {
    return (this.pairings.get(pk2(channel, peer))?.status as 'approved' | 'pending') ?? 'none';
  }
  requestPairing(channel: string, peer: string, name: string): string {
    const existing = this.pairings.get(pk2(channel, peer));
    if (existing?.status === 'pending' && Date.now() - existing.created_at < 3_600_000) return existing.code;
    const code = randomCode();
    this.pairings.put({ channel, peer, name, code, status: 'pending', created_at: Date.now() });
    return code;
  }
  approvePairing(channel: string, code: string): { peer: string; name: string } | undefined {
    const r = this.pairings.find((p) => p.channel === channel && p.code === code.toUpperCase() && p.status === 'pending');
    if (!r || Date.now() - r.created_at > 3_600_000) return undefined; // code expiré après 1 h
    this.pairings.patch(pk2(channel, r.peer), { status: 'approved' });
    return { peer: r.peer, name: r.name };
  }
  listPairings(): Array<{ channel: string; peer: string; name: string; code: string; status: string }> {
    return this.pairings.all().sort((a, b) => b.created_at - a.created_at).map(({ channel, peer, name, code, status }) => ({ channel, peer, name, code, status }));
  }

  // ---------- Habitudes ----------

  /**
   * Demandes que tu fais souvent (au moins « min » fois en « days » jours, hors tâches planifiées) :
   * Odin propose d'en faire une tâche automatique. Les demandes ignorées ne reviennent pas.
   */
  habits(days = 14, min = 3, now = Date.now()): Array<{ text: string; count: number; key: string }> {
    const since = now - days * 86_400_000;
    const rows = this.messages.filter((m) => m.role === 'user' && m.tainted === 0 && m.created_at >= since && this.sessions.has(m.session_id)
      && !/^(cron|breaker|auto):/i.test(m.session_id) && !/^(travail continu|reprends la mission)/i.test(m.content));
    const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\b(stp|svp|s il te plait|merci|odin|peux tu|tu peux|est ce que)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const groups = new Map<string, { text: string; count: number }>();
    for (const r of rows) {
      const k = norm(r.content).slice(0, 80);
      if (k.length < 8 || k.split(' ').length < 2) continue;
      const g = groups.get(k);
      if (g) g.count++; else groups.set(k, { text: r.content.trim().slice(0, 200), count: 1 });
    }
    const ignored = new Set(Object.values(this.kvPrefix('habit-ignored:')));
    const jobs = this.listJobs().map((j) => norm(j.prompt));
    return [...groups].filter(([k, g]) => g.count >= min && !ignored.has(k) && !jobs.some((j) => j.includes(k) || k.includes(j)))
      .map(([key, g]) => ({ key, ...g })).sort((a, b) => b.count - a.count).slice(0, 5);
  }
  /** Tes derniers messages (pour repérer tes besoins : mail, agenda…). */
  recentUserTexts(limit = 300, days = 30, now = Date.now()): string[] {
    const since = now - days * 86_400_000;
    return this.messages.filter((m) => m.role === 'user' && m.tainted === 0 && m.created_at >= since).sort((a, b) => b.id - a.id).slice(0, limit).map((m) => m.content);
  }
  /** Archive une preuve (adresse, titre, dates, passage exact qui justifie l'affirmation). */
  addEvidence(e: { session: string; question: string; claim: string; verdict: string; url: string; title: string; site: string; published?: string; accessed: string; quote: string; stance: string; tier: string }): void {
    this.evidence.insert({ session_id: e.session, question: e.question.slice(0, 500), claim: e.claim.slice(0, 500), verdict: e.verdict, url: e.url.slice(0, 1000), title: e.title.slice(0, 300), site: e.site, published: e.published ?? '', accessed: e.accessed, quote: e.quote.slice(0, 600), stance: e.stance, tier: e.tier, at: Date.now() });
  }
  /** Preuves déjà archivées sur un sujet (recherche simple). */
  findEvidence(q: string, limit = 20): Array<{ claim: string; verdict: string; url: string; title: string; published: string; accessed: string; quote: string; stance: string; at: number }> {
    const s = q.slice(0, 100).toLowerCase();
    return this.evidence.filter((e) => lc(e.claim).includes(s) || lc(e.question).includes(s) || lc(e.quote).includes(s)).sort((a, b) => b.at - a.at).slice(0, limit)
      .map(({ claim, verdict, url, title, published, accessed, quote, stance, at }) => ({ claim, verdict, url, title, published, accessed, quote, stance, at }));
  }

  getKv(key: string): string | undefined { return this.kv.get(key)?.value; }
  setKv(key: string, value: string): void { if (value) this.kv.put({ key, value }); else this.kv.delete(key); }
  kvPrefix(prefix: string): Record<string, string> {
    const out: Record<string, string> = {}; for (const r of this.kv.values()) if (r.key.startsWith(prefix)) out[r.key.slice(prefix.length)] = r.value; return out;
  }
  ignoreHabit(key: string): void { this.kv.put({ key: `habit-ignored:${key}`, value: key }); }

  // ---------- Tâches planifiées ----------

  addJob(j: Omit<JobRow, 'enabled' | 'last_run'>): void {
    if (this.jobs.has(j.id)) throw new Error(`tâche déjà existante : ${j.id}`);
    this.jobs.put({ id: j.id, cron: j.cron, prompt: j.prompt, channel: j.channel, peer: j.peer, enabled: 1, last_run: 0, next_run: j.next_run, created_at: Date.now(), tainted: j.tainted ? 1 : 0 });
  }
  listJobs(): JobRow[] { return this.jobs.all().sort((a, b) => a.next_run - b.next_run); }
  dueJobs(now: number): JobRow[] { return this.jobs.filter((j) => j.enabled === 1 && j.next_run <= now); }
  /** Avance la prochaine exécution AVANT de lancer la tâche : au plus une exécution même après un crash. */
  advanceJob(id: string, lastRun: number, nextRun: number): void { this.jobs.patch(id, { last_run: lastRun, next_run: nextRun }); }
  removeJob(id: string): boolean { return this.jobs.delete(id); }

  // ---------- Autorisations permanentes (« toujours autoriser ») ----------

  findGrant(key: string): { id: number } | undefined { const g = this.grants.find((x) => x.key === key); return g ? { id: g.id } : undefined; }
  addGrant(key: string, tool: string, example: string): void { if (!this.findGrant(key)) this.grants.insert({ key, tool, example, created_at: Date.now(), uses: 0, last_used: 0 }); }
  touchGrant(id: number): void { const g = this.grants.get(id); if (g) this.grants.patch(id, { uses: g.uses + 1, last_used: Date.now() }); }
  listGrants(): GrantRow[] { return this.grants.all().sort((a, b) => b.created_at - a.created_at); }
  revokeGrant(idOrKey: string | number): boolean { return this.grants.deleteWhere((g) => g.id === (Number(idOrKey) || -1) || g.key === String(idOrKey)) > 0; }

  // ---------- Statistiques ----------

  recordUsage(sessionId: string, provider: string, tin: number, tout: number, cost: number, purpose = 'agent'): void {
    this.usage.insert({ session_id: sessionId, provider, tokens_in: tin, tokens_out: tout, cost_usd: cost, created_at: Date.now(), purpose });
  }
  /** Nombre d'appels comptés pour une conversation. */
  usageCount(sessionId: string): number { return this.usage.filter((u) => u.session_id === sessionId).length; }

  // ---------- Journal des routages ----------

  recordRoute(e: RouteEntry): void {
    this.routing.insert({ at: e.at, turn_id: e.turnId, session_id: e.sessionId, channel: e.channel, request: e.request.slice(0, 160), purpose: e.purpose, provider: e.provider, label: e.label, tier: e.tier, min_tier: e.minTier, need: e.need, reason: e.reason.slice(0, 300), attempts: JSON.stringify(e.attempts.slice(0, 20)), ok: e.ok ? 1 : 0, ms: Math.round(e.ms), tokens_in: e.tokensIn, tokens_out: e.tokensOut, cost_usd: e.costUsd });
  }
  /** Les chiffres des économies depuis une date : tâches faites sans IA, demandes confiées à une IA, par fournisseur. */
  savingsData(since: number): { direct: number; learned: number; aiTurns: number; aiCalls: number; spentUsd: number; tokens: number; byProvider: Array<{ provider: string; label: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }>; reasons: Array<{ reason: string; n: number }> } {
    const recent = this.routing.filter((r) => r.at >= since);
    const direct = recent.filter((r) => r.purpose === 'sans-ia');
    const learned = direct.filter((r) => /^(appris le |lien fait avec )/i.test(r.reason)).length;
    const ai = recent.filter((r) => r.provider !== '' && r.ok === 1);
    const byProvider = [...groupBy(ai, (r) => r.provider)].map(([provider, a]) => ({ provider, label: a.map((r) => r.label).sort().at(-1) ?? '', calls: a.length, tokensIn: sum(a, (r) => r.tokens_in), tokensOut: sum(a, (r) => r.tokens_out), costUsd: sum(a, (r) => r.cost_usd) })).sort((a, b) => b.calls - a.calls);
    const reasons = [...groupBy(direct, (r) => r.reason)].map(([reason, a]) => ({ reason, n: a.length })).sort((a, b) => b.n - a.n).slice(0, 8);
    return { direct: direct.length, learned, aiTurns: new Set(ai.map((r) => r.turn_id)).size, aiCalls: ai.length, spentUsd: sum(ai, (r) => r.cost_usd), tokens: sum(ai, (r) => r.tokens_in + r.tokens_out), byProvider, reasons };
  }
  /** Ménage du journal, une fois par jour : on garde 6 mois, 50 000 appels au plus. */
  pruneRoutes(now = Date.now()): number {
    const maxId = Math.max(0, ...this.routing.all().map((r) => r.id));
    const n = this.routing.deleteWhere((r) => r.at < now - 183 * 86_400_000 || r.id <= maxId - 50000);
    if (n) this.routing.compact();
    return n;
  }
  /** Appels journalisés, du plus récent au plus ancien. */
  routes(q: { limit?: number; sessionId?: string; turnId?: string; since?: number; provider?: string } = {}): RouteEntry[] {
    return this.routing.filter((r) => (!q.sessionId || r.session_id === q.sessionId) && (!q.turnId || r.turn_id === q.turnId) && (!q.since || r.at >= q.since) && (!q.provider || r.provider === q.provider))
      .sort((a, b) => b.at - a.at || b.id - a.id).slice(0, Math.min(500, q.limit ?? 50)).map((r) => ({
        at: r.at, turnId: r.turn_id, sessionId: r.session_id, channel: r.channel, request: r.request, purpose: r.purpose,
        provider: r.provider, label: r.label, tier: r.tier, minTier: r.min_tier, need: r.need, reason: r.reason,
        attempts: (() => { try { return JSON.parse(r.attempts); } catch { return []; } })(), ok: r.ok === 1, ms: r.ms,
        tokensIn: r.tokens_in, tokensOut: r.tokens_out, costUsd: r.cost_usd,
      }) as RouteEntry);
  }
  /** Derniers tours d'une conversation (le plus récent d'abord). */
  recentTurns(sessionId: string, limit = 5): string[] {
    const last = new Map<string, number>();
    for (const r of this.routing.values()) if (r.session_id === sessionId && r.turn_id !== '') last.set(r.turn_id, Math.max(last.get(r.turn_id) ?? 0, r.at));
    return [...last].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
  }
  /** Bilan par IA depuis une date : appels, réussites, échecs, temps moyen, jetons, coût. */
  routeStats(since: number): Array<{ provider: string; label: string; calls: number; ok: number; failed: number; avg_ms: number; tokens: number; cost_usd: number }> {
    return [...groupBy(this.routing.filter((r) => r.at >= since && r.provider !== ''), (r) => r.provider)].map(([provider, a]) => ({
      provider, label: a.map((r) => r.label).sort().at(-1) ?? '', calls: a.length, ok: sum(a, (r) => r.ok), failed: sum(a, (r) => 1 - r.ok),
      avg_ms: Math.trunc(sum(a, (r) => r.ms) / a.length), tokens: sum(a, (r) => r.tokens_in + r.tokens_out), cost_usd: sum(a, (r) => r.cost_usd),
    })).sort((a, b) => b.calls - a.calls);
  }

  // ---------- Missions (chaque tour de l'agent, pour l'onglet Missions) ----------

  startMission(m: { id: string; sessionId: string; goal: string; origin: string }): void {
    if (this.missions.has(m.id)) throw new Error(`mission déjà existante : ${m.id}`);
    const now = Date.now();
    this.missions.put({ id: m.id, session_id: m.sessionId, goal: m.goal.slice(0, 300), status: 'en cours', origin: m.origin, steps: 0, tool_calls: 0, cost_usd: 0, subagents: 0, last_tool: '', result: '', started_at: now, updated_at: now, ended_at: null });
  }
  progressMission(id: string, p: { steps?: number; toolCalls?: number; costUsd?: number; subagents?: number; lastTool?: string }): void {
    const m = this.missions.get(id); if (!m) return;
    this.missions.patch(id, { steps: p.steps ?? m.steps, tool_calls: p.toolCalls ?? m.tool_calls, cost_usd: p.costUsd ?? m.cost_usd, subagents: m.subagents + (p.subagents ?? 0), last_tool: p.lastTool ?? m.last_tool, updated_at: Date.now() });
  }
  endMission(id: string, status: 'terminée' | 'arrêtée' | 'échouée' | 'en attente', result: string, costUsd?: number): void {
    const m = this.missions.get(id); if (!m) return;
    this.missions.patch(id, { status, result: result.slice(0, 2000), cost_usd: costUsd ?? m.cost_usd, ended_at: Date.now(), updated_at: Date.now() });
  }
  listMissions(limit = 50): MissionRow[] {
    return this.missions.all().sort((a, b) => Number(b.status === 'en cours') - Number(a.status === 'en cours') || b.updated_at - a.updated_at).slice(0, limit);
  }
  /** Missions coupées net (Odin redémarré pendant le travail) : à reprendre. */
  interruptedMissions(since: number): MissionRow[] { return this.missions.filter((m) => m.status === 'en cours' && m.updated_at >= since); }
  /** Missions à relancer : échouées (modèle indisponible…) ou arrêtées faute d'étapes. */
  stalledMissions(since: number): MissionRow[] { return this.missions.filter((m) => (m.status === 'échouée' || m.status === 'en attente') && m.updated_at >= since).sort((a, b) => b.updated_at - a.updated_at).slice(0, 10); }
  getMission(id: string): MissionRow | undefined { return this.missions.get(id); }

  /** Coût par fournisseur et par finalité depuis une date (Réglages → Modèle). */
  usageBreakdown(ts: number): Array<{ provider: string; purpose: string; calls: number; tokens: number; cost_usd: number }> {
    return [...groupBy(this.usage.filter((u) => u.created_at >= ts), (u) => pk2(u.provider, u.purpose ?? 'agent'))].map(([, a]) => ({
      provider: a[0].provider, purpose: a[0].purpose ?? 'agent', calls: a.length, tokens: sum(a, (u) => u.tokens_in + u.tokens_out), cost_usd: sum(a, (u) => u.cost_usd),
    })).sort((a, b) => b.cost_usd - a.cost_usd);
  }
  /** Dépense depuis le 1er du mois (heure locale). */
  monthCost(now = new Date()): number {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return sum(this.usage.filter((u) => u.created_at >= start), (u) => u.cost_usd);
  }
  usageSince(ts: number): { tokens_in: number; tokens_out: number; cost_usd: number } {
    const a = this.usage.filter((u) => u.created_at >= ts);
    return { tokens_in: sum(a, (u) => u.tokens_in), tokens_out: sum(a, (u) => u.tokens_out), cost_usd: sum(a, (u) => u.cost_usd) };
  }

  /** Résultat d'une mission où la compétence a servi (réussite, durée, coût). */
  skillOutcome(name: string, ok: boolean, ms = 0, cost = 0): void {
    const s = this.skills.get(name) ?? { name, uses: 0, last_used: Date.now(), ok: 0, fails: 0, total_ms: 0, cost_usd: 0 };
    this.skills.put({ ...s, ok: (s.ok ?? 0) + (ok ? 1 : 0), fails: (s.fails ?? 0) + (ok ? 0 : 1), total_ms: (s.total_ms ?? 0) + Math.round(ms), cost_usd: (s.cost_usd ?? 0) + cost });
  }
  touchSkill(name: string): void {
    const s = this.skills.get(name);
    this.skills.put({ ok: 0, fails: 0, total_ms: 0, cost_usd: 0, ...s, name, uses: (s?.uses ?? 0) + 1, last_used: Date.now() });
  }
  skillStats(): Array<{ name: string; uses: number; last_used: number; ok: number; fails: number; total_ms: number; cost_usd: number }> {
    return this.skills.all().sort((a, b) => b.uses - a.uses).map((r) => ({ name: String(r.name), uses: Number(r.uses), last_used: Number(r.last_used), ok: Number(r.ok ?? 0), fails: Number(r.fails ?? 0), total_ms: Number(r.total_ms ?? 0), cost_usd: Number(r.cost_usd ?? 0) }));
  }
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0/I/1 ambigus
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}
