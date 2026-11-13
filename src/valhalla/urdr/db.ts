// Urðr — une base PostgreSQL (zéro SQLite dans Odin) : ses tables, leurs colonnes et leurs liens,
// les lignes avec filtres, tri et pages, et les modifications ligne par ligne (Urðr Studio), plus le SQL libre.
// Les noms de tables et de colonnes viennent toujours de la base elle-même (jamais du texte reçu tel quel),
// et les valeurs passent en paramètres.
import { Pg, ident, type PgOpts } from './pg.ts';

export interface Column { name: string; type: string; nullable: boolean; default?: string; pk: boolean; ref?: { table: string; column: string } }
export interface TableInfo { name: string; rows: number }
export interface Rel { from: string; column: string; to: string; toColumn: string }
export type Op = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'contient' | 'commence par' | 'vide' | 'pas vide';
export const OPS: Op[] = ['=', '!=', '<', '>', '<=', '>=', 'contient', 'commence par', 'vide', 'pas vide'];
export interface Filter { col: string; op: Op; value?: string }
export interface RowsQuery { filters?: Filter[]; sort?: string; dir?: 'asc' | 'desc'; limit?: number; offset?: number }
export interface Rows { columns: string[]; rows: Array<Array<string | null>>; total: number; key: string[] }
export interface SqlResult { columns: string[]; rows: Array<Array<string | null>>; command: string; count: number; ms: number }
export type Value = string | null;

export interface Driver {
  kind: 'postgres';
  tables(): Promise<TableInfo[]>;
  columns(table: string): Promise<Column[]>;
  relations(): Promise<Rel[]>;
  rows(table: string, q: RowsQuery): Promise<Rows>;
  update(table: string, key: Record<string, Value>, changes: Record<string, Value>): Promise<number>;
  insert(table: string, values: Record<string, Value>): Promise<number>;
  remove(table: string, key: Record<string, Value>): Promise<number>;
  /** SQL libre, une seule instruction ; `write: false` = la base refuse toute écriture. */
  sql(text: string, write: boolean): Promise<SqlResult>;
  close(): Promise<void>;
}

/** Découpe un texte SQL en instructions (en tenant compte des chaînes, des noms entre guillemets, des commentaires et des $$). */
export function statements(sql: string): string[] {
  const out: string[] = []; let cur = '', i = 0;
  while (i < sql.length) {
    const c = sql[i], two = sql.slice(i, i + 2);
    if (two === '--') { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e; continue; }
    if (two === '/*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; cur += ' '; continue; }
    if (c === "'" || c === '"' || c === '`') { let j = i + 1; while (j < sql.length) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } j++; } cur += sql.slice(i, j + 1); i = j + 1; continue; }
    if (c === '$') { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) { const e = sql.indexOf(m[0], i + m[0].length); const j = e < 0 ? sql.length : e + m[0].length; cur += sql.slice(i, j); i = j; continue; } }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Une lecture ? (SELECT, WITH sans écriture, EXPLAIN, SHOW, VALUES, TABLE, PRAGMA de lecture). Tout le reste demande ton accord. */
export function isRead(sql: string): boolean {
  const st = statements(sql); if (st.length !== 1) return false;
  const t = st[0].replace(/\s+/g, ' ').toLowerCase(), first = t.split(/[\s(]/)[0];
  if (['select', 'show', 'values', 'table'].includes(first)) return !/\binto\b/.test(t.replace(/'[^']*'/g, ''));
  if (first === 'explain') return !/\banalyze\b/.test(t);
  if (first === 'with') return !/\b(insert|update|delete|merge)\b/.test(t.replace(/'[^']*'/g, ''));
  if (first === 'pragma') return !/=/.test(t);
  return false;
}
export const one = (sql: string): string => { const st = statements(sql); if (st.length === 0) throw new Error('requête vide'); if (st.length > 1) throw new Error('une seule instruction à la fois'); return st[0]; };

function where(filters: Filter[], cols: Set<string>, q: (s: string) => string, ph: (n: number) => string, like: string, start = 1): { sql: string; params: Value[] } {
  const parts: string[] = [], params: Value[] = [];
  for (const f of filters) {
    if (!cols.has(f.col)) throw new Error(`colonne inconnue : ${f.col}`);
    const c = q(f.col);
    switch (f.op) {
      case 'vide': parts.push(`${c} IS NULL`); break;
      case 'pas vide': parts.push(`${c} IS NOT NULL`); break;
      case 'contient': params.push(`%${(f.value ?? '').replace(/[\\%_]/g, (m) => '\\' + m)}%`); parts.push(`${like.replace('?', c)} ${ph(start + params.length - 1)} ESCAPE '\\'`); break;
      case 'commence par': params.push(`${(f.value ?? '').replace(/[\\%_]/g, (m) => '\\' + m)}%`); parts.push(`${like.replace('?', c)} ${ph(start + params.length - 1)} ESCAPE '\\'`); break;
      default: if (!OPS.includes(f.op)) throw new Error(`opérateur inconnu : ${f.op}`); params.push(f.value ?? null); parts.push(`${c} ${f.op === '!=' ? '<>' : f.op} ${ph(start + params.length - 1)}`);
    }
  }
  return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', params };
}
const lim = (n: number | undefined, d: number, max: number) => Math.min(max, Math.max(1, Math.floor(Number(n) || d)));

// ---------------------------------------------------------------- PostgreSQL
const qname = (t: string) => { const i = t.indexOf('.'); return i < 0 ? ident(t) : `${ident(t.slice(0, i))}.${ident(t.slice(i + 1))}`; };
export class PgDriver implements Driver {
  kind = 'postgres' as const; private c: Pg; private cache = new Map<string, Column[]>();
  private constructor(c: Pg) { this.c = c; }
  static async open(o: PgOpts): Promise<PgDriver> { return new PgDriver(await Pg.connect(o)); }
  async tables(): Promise<TableInfo[]> {
    const r = await this.c.query(`SELECT n.nspname, c.relname, GREATEST(c.reltuples, 0)::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%' ORDER BY n.nspname <> 'public', n.nspname, c.relname`);
    return r.rows.map(([s, n, k]) => ({ name: s === 'public' ? n! : `${s}.${n}`, rows: Number(k) }));
  }
  private async known(table: string): Promise<string> { if (!(await this.tables()).some((t) => t.name === table)) throw new Error(`table inconnue : ${table}`); return table; }
  async relations(): Promise<Rel[]> {
    const r = await this.c.query(`SELECT n.nspname, cl.relname, a.attname, nf.nspname, cf.relname, af.attname FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace JOIN pg_class cf ON cf.oid = c.confrelid JOIN pg_namespace nf ON nf.oid = cf.relnamespace JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = c.confkey[1] WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1`);
    const nm = (s: string | null, t: string | null) => (s === 'public' ? t! : `${s}.${t}`);
    return r.rows.map(([s, t, col, fs, ft, fc]) => ({ from: nm(s, t), column: col!, to: nm(fs, ft), toColumn: fc! }));
  }
  async columns(table: string): Promise<Column[]> {
    if (this.cache.has(table)) return this.cache.get(table)!;
    await this.known(table);
    const [s, t] = table.includes('.') ? [table.slice(0, table.indexOf('.')), table.slice(table.indexOf('.') + 1)] : ['public', table];
    const r = await this.c.query(`SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull, pg_get_expr(d.adbin, d.adrelid), COALESCE((SELECT true FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)), false) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [s, t]);
    const rels = (await this.relations()).filter((x) => x.from === table);
    const cols = r.rows.map(([n, ty, nu, de, pk]) => ({ name: n!, type: ty!, nullable: nu === 't', default: de ?? undefined, pk: pk === 't', ref: rels.find((x) => x.column === n) ? { table: rels.find((x) => x.column === n)!.to, column: rels.find((x) => x.column === n)!.toColumn } : undefined }));
    this.cache.set(table, cols); return cols;
  }
  private async keyOf(table: string): Promise<string[]> { const k = (await this.columns(table)).filter((c) => c.pk).map((c) => c.name); if (!k.length) throw new Error(`la table ${table} n'a pas de clé primaire : modification ligne par ligne impossible (passe par le SQL)`); return k; }
  async rows(table: string, q: RowsQuery): Promise<Rows> {
    const cols = await this.columns(table), names = new Set(cols.map((c) => c.name));
    const w = where(q.filters ?? [], names, ident, (n) => `$${n}`, '?::text ILIKE');
    const sort = q.sort && names.has(q.sort) ? ` ORDER BY ${ident(q.sort)} ${q.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST` : (cols.some((c) => c.pk) ? ` ORDER BY ${cols.filter((c) => c.pk).map((c) => ident(c.name)).join(', ')}` : '');
    const limit = lim(q.limit, 25, 500), offset = Math.max(0, Math.floor(Number(q.offset) || 0));
    const r = await this.c.readOnly(`SELECT * FROM ${qname(table)}${w.sql}${sort} LIMIT ${limit} OFFSET ${offset}`, w.params);
    const n = await this.c.readOnly(`SELECT count(*) FROM ${qname(table)}${w.sql}`, w.params);
    return { columns: r.fields.map((f) => f.name), rows: r.rows, total: Number(n.rows[0]?.[0] ?? 0), key: cols.filter((c) => c.pk).map((c) => c.name) };
  }
  private async keyWhere(table: string, key: Record<string, Value>, start: number): Promise<{ sql: string; params: Value[] }> {
    const k = await this.keyOf(table); for (const c of k) if (!(c in key)) throw new Error(`clé ${c} manquante`);
    return { sql: k.map((c, i) => `${ident(c)} = $${start + i}`).join(' AND '), params: k.map((c) => key[c]) };
  }
  async update(table: string, key: Record<string, Value>, changes: Record<string, Value>): Promise<number> {
    const names = new Set((await this.columns(table)).map((c) => c.name)), set = Object.keys(changes); if (!set.length) return 0;
    for (const c of set) if (!names.has(c)) throw new Error(`colonne inconnue : ${c}`);
    const w = await this.keyWhere(table, key, set.length + 1);
    return (await this.c.query(`UPDATE ${qname(table)} SET ${set.map((c, i) => `${ident(c)} = $${i + 1}`).join(', ')} WHERE ${w.sql}`, [...set.map((c) => changes[c]), ...w.params])).count;
  }
  async insert(table: string, values: Record<string, Value>): Promise<number> {
    const names = new Set((await this.columns(table)).map((c) => c.name)), cols = Object.keys(values); for (const c of cols) if (!names.has(c)) throw new Error(`colonne inconnue : ${c}`);
    return (await this.c.query(cols.length ? `INSERT INTO ${qname(table)} (${cols.map(ident).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})` : `INSERT INTO ${qname(table)} DEFAULT VALUES`, cols.map((c) => values[c]))).count;
  }
  async remove(table: string, key: Record<string, Value>): Promise<number> { const w = await this.keyWhere(table, key, 1); return (await this.c.query(`DELETE FROM ${qname(table)} WHERE ${w.sql}`, w.params)).count; }
  async sql(text: string, write: boolean): Promise<SqlResult> {
    const st = one(text), t0 = Date.now();
    const r = write ? await this.c.query(st) : await this.c.readOnly(st);
    this.cache.clear();
    return { columns: r.fields.map((f) => f.name), rows: r.rows.slice(0, 1000), command: r.command, count: r.count, ms: Date.now() - t0 };
  }
  close(): Promise<void> { return this.c.close(); }
}
