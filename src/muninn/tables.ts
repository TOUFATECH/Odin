// Rangement en fichiers de la mémoire d'Odin — AUCUNE base de données.
// Chaque « table » est un fichier JSONL dans ~/.odin/memoire/ : une ligne par changement
// (« p » = ligne écrite ou modifiée, « d » = ligne effacée). Au démarrage, Odin relit le fichier
// et garde tout en mémoire vive ; chaque changement est ajouté en fin de fichier tout de suite,
// donc une coupure de courant fait perdre au pire la ligne en cours d'écriture.
// Quand le fichier contient trop d'anciennes versions, il est réécrit propre (fichier temporaire
// puis renommage : jamais à moitié écrit). Une ligne abîmée (coupure en pleine écriture) est ignorée.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type Row = Record<string, unknown>;
type Key = string | number;

export class Table<T extends Row> {
  private readonly rows = new Map<Key, T>();
  private ops = 0;
  private seq = 0;
  /** Lignes gardées en mémoire vive seulement (mode privé) : jamais écrites sur le disque. */
  private readonly volatile = new Set<Key>();
  readonly file: string | null;
  private readonly keyOf: (r: T) => Key;

  /** `file` à null : table en mémoire seulement (tests, mode démo). */
  constructor(file: string | null, keyOf: (r: T) => Key) {
    this.file = file; this.keyOf = keyOf;
    if (file && existsSync(file)) this.load(file);
  }

  private load(file: string): void {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      let op: { p?: T; d?: Key; seq?: number };
      try { op = JSON.parse(line); } catch { continue; } // ligne coupée par une panne : ignorée
      if (op.p) { const k = this.keyOf(op.p); this.rows.delete(k); this.rows.set(k, op.p); this.bump(op.p); }
      else if (op.d !== undefined) this.rows.delete(op.d);
      else if (typeof op.seq === 'number') this.seq = Math.max(this.seq, op.seq);
      this.ops++;
    }
  }

  private bump(r: T): void { const id = r.id; if (typeof id === 'number' && id > this.seq) this.seq = id; }
  private write(op: object): void {
    if (!this.file) return;
    appendFileSync(this.file, `${JSON.stringify(op)}\n`);
    if (++this.ops > 2000 && this.ops > this.rows.size * 3) this.compact();
  }

  /** Prochain numéro libre (jamais réutilisé, même après un effacement). */
  nextId(): number { return ++this.seq; }
  get size(): number { return this.rows.size; }
  /** Une copie de la ligne (la modifier ne change rien : passer par patch). */
  get(k: Key): T | undefined { const r = this.rows.get(k); return r ? { ...r } : undefined; }
  has(k: Key): boolean { return this.rows.has(k); }
  /** Toutes les lignes, dans l'ordre d'écriture. */
  all(): T[] { return [...this.rows.values()].map((r) => ({ ...r })); }
  /** Parcours sans copie (lecture seule). */
  values(): IterableIterator<T> { return this.rows.values(); }
  filter(fn: (r: T) => boolean): T[] { const out: T[] = []; for (const r of this.rows.values()) if (fn(r)) out.push({ ...r }); return out; }
  find(fn: (r: T) => boolean): T | undefined { for (const r of this.rows.values()) if (fn(r)) return { ...r }; return undefined; }

  /** Écrit (ou remplace) une ligne entière. */
  put(r: T): T { const k = this.keyOf(r); this.rows.set(k, r); this.bump(r); this.write({ p: r }); return r; }
  /** Ajoute une ligne en mémoire vive seulement (mode privé) : elle disparaît au redémarrage. */
  putVolatile(r: T): T { const k = this.keyOf(r); this.rows.set(k, r); this.volatile.add(k); return r; }
  insertVolatile(r: Omit<T, 'id'>): T { const row = { ...r, id: this.nextId() } as unknown as T; const k = this.keyOf(row); this.rows.set(k, row); this.volatile.add(k); return row; }
  /** Ajoute une ligne avec un nouveau numéro `id`. */
  insert(r: Omit<T, 'id'>): T { const row = { ...r, id: this.nextId() } as unknown as T; return this.put(row); }
  /** Modifie quelques champs d'une ligne existante ; rend false si elle n'existe pas. */
  patch(k: Key, changes: Partial<T>): boolean {
    const r = this.rows.get(k); if (!r) return false;
    const next = { ...r, ...changes }; this.rows.set(k, next); this.write({ p: next }); return true;
  }
  delete(k: Key): boolean { if (!this.rows.delete(k)) return false; if (!this.volatile.delete(k)) this.write({ d: k }); return true; }
  deleteWhere(fn: (r: T) => boolean): number {
    let n = 0; for (const [k, r] of [...this.rows]) if (fn(r)) { this.rows.delete(k); this.write({ d: k }); n++; } return n;
  }

  /** Réécrit le fichier sans les anciennes versions ni les lignes effacées (effacement réel sur le disque). */
  compact(): void {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    const lines = [JSON.stringify({ seq: this.seq }), ...[...this.rows].filter(([k]) => !this.volatile.has(k)).map(([, r]) => JSON.stringify({ p: r }))];
    writeFileSync(tmp, `${lines.join('\n')}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.ops = this.rows.size + 1;
  }
}

/** Un dossier de tables (la mémoire d'Odin, ou une mémoire en RAM pour les tests). */
export class Shelf {
  private readonly tables = new Map<string, Table<Row>>();
  readonly dir: string | null;
  /** `dir` à null : rien n'est écrit sur le disque. */
  constructor(dir: string | null) { this.dir = dir; if (dir) mkdirSync(dir, { recursive: true, mode: 0o700 }); }
  table<T extends Row>(name: string, keyOf: (r: T) => Key): Table<T> {
    if (!/^[a-z0-9_-]{1,40}$/.test(name)) throw new Error(`nom de table invalide : ${name}`);
    let t = this.tables.get(name);
    if (!t) { t = new Table<T>(this.dir ? join(this.dir, `${name}.jsonl`) : null, keyOf) as unknown as Table<Row>; this.tables.set(name, t); }
    return t as unknown as Table<T>;
  }
  compactAll(): void { for (const t of this.tables.values()) t.compact(); }
  /** Taille totale des fichiers de la mémoire, en octets. */
  bytes(): number {
    if (!this.dir || !existsSync(this.dir)) return 0;
    let n = 0; for (const f of readdirSync(this.dir)) { try { n += statSync(join(this.dir, f)).size; } catch { /* fichier parti */ } } return n;
  }
  /** Efface une table (fichier compris). */
  drop(name: string): void { const t = this.tables.get(name); if (t?.file) rmSync(t.file, { force: true }); this.tables.delete(name); }
}
