// Une fausse base PostgreSQL en mémoire (pour les essais sans serveur) : tables, clés, liens, lignes, SQL simulé.
import { isRead, type Column, type Driver, type Rel, type Rows, type RowsQuery, type SqlResult, type TableInfo, type Value } from '../src/valhalla/urdr/db.ts';

export interface FakeTable { columns: Column[]; rows: Array<Record<string, Value>> }
export class FakeDriver implements Driver {
  kind = 'postgres' as const; sqls: Array<{ text: string; write: boolean }> = [];
  t: Record<string, FakeTable>;
  constructor(t: Record<string, FakeTable>) { this.t = t; }
  private tab(n: string) { const x = this.t[n]; if (!x) throw new Error(`table inconnue : ${n}`); return x; }
  async tables(): Promise<TableInfo[]> { return Object.entries(this.t).map(([name, x]) => ({ name, rows: x.rows.length })); }
  async columns(n: string) { return this.tab(n).columns; }
  async relations(): Promise<Rel[]> { return Object.entries(this.t).flatMap(([from, x]) => x.columns.filter((c) => c.ref).map((c) => ({ from, column: c.name, to: c.ref!.table, toColumn: c.ref!.column }))); }
  async rows(n: string, q: RowsQuery): Promise<Rows> {
    const x = this.tab(n), cols = x.columns.map((c) => c.name);
    let l = x.rows.filter((r) => (q.filters ?? []).every((f) => f.op === '=' ? r[f.col] === f.value : f.op === 'contient' ? String(r[f.col] ?? '').includes(f.value ?? '') : true));
    if (q.sort && cols.includes(q.sort)) l = [...l].sort((a, b) => String(a[q.sort!]).localeCompare(String(b[q.sort!])) * (q.dir === 'desc' ? -1 : 1));
    return { columns: cols, rows: l.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 50)).map((r) => cols.map((c) => r[c] ?? null)), total: l.length, key: x.columns.filter((c) => c.pk).map((c) => c.name) };
  }
  private match(r: Record<string, Value>, k: Record<string, Value>) { return Object.entries(k).every(([c, v]) => r[c] === v); }
  async update(n: string, k: Record<string, Value>, ch: Record<string, Value>) { let c = 0; for (const r of this.tab(n).rows) if (this.match(r, k)) { Object.assign(r, ch); c++; } return c; }
  async insert(n: string, v: Record<string, Value>) { this.tab(n).rows.push({ ...v }); return 1; }
  async remove(n: string, k: Record<string, Value>) { const x = this.tab(n), b = x.rows.length; x.rows = x.rows.filter((r) => !this.match(r, k)); return b - x.rows.length; }
  async sql(text: string, write: boolean): Promise<SqlResult> {
    this.sqls.push({ text, write }); if (!write && !isRead(text)) throw new Error('lecture seule : la base refuse d\'écrire');
    return write ? { columns: [], rows: [], command: `${text.trim().split(/\s+/)[0].toUpperCase()} 1`, count: 1, ms: 0 } : { columns: ['n'], rows: [['1']], command: 'SELECT 1', count: 1, ms: 0 };
  }
  async close() { /* rien */ }
}
