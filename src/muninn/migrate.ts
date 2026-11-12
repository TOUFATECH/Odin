// Passage unique de l'ancienne mémoire (fichier SQLite odin.db) aux fichiers de ~/.odin/memoire/.
// C'est le SEUL endroit d'Odin qui sait encore lire un fichier SQLite, et seulement pour le convertir :
// au premier démarrage de cette version, chaque table devient un fichier JSONL, puis l'ancien fichier est
// renommé « odin.db.ancien-AAAA-MM-JJ » (gardé comme sauvegarde, plus jamais ouvert).
// Le module SQLite de Node n'est chargé qu'à ce moment-là, et jamais si la conversion est déjà faite.

import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Tables connues de l'ancienne base et clé de chaque ligne (les autres sont ignorées : index de recherche, réglages internes). */
const TABLES = ['sessions', 'messages', 'memories', 'memory_vec', 'pairings', 'jobs', 'grants', 'kv', 'evidence', 'skill_stats', 'missions', 'usage', 'users', 'identities', 'routing', 'devices', 'device_events', 'scans'];
const JSON_COLS: Record<string, string[]> = { devices: ['ports', 'services', 'web'], scans: ['networks'] };

type Sqlite = { DatabaseSync: new (file: string, o?: { readOnly?: boolean }) => { prepare(sql: string): { all(): Array<Record<string, unknown>> }; close(): void } };

/** Convertit `dbFile` dans `dir` si ce n'est pas déjà fait. Rend le nombre de lignes converties (0 : rien à faire). */
export function migrateFromSqlite(dbFile: string, dir: string): number {
  const done = join(dir, 'migration.json');
  if (!existsSync(dbFile) || existsSync(done)) return 0;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (readdirSync(dir).some((f) => f.endsWith('.jsonl'))) return 0; // une mémoire en fichiers existe déjà : on n'y touche pas
  const sqlite = process.getBuiltinModule?.('node:sqlite') as Sqlite | undefined;
  if (!sqlite) throw new Error('impossible de convertir l\'ancienne mémoire : mets Node.js à jour (22.18 ou plus)');
  const db = new sqlite.DatabaseSync(dbFile, { readOnly: true });
  let total = 0;
  const report: Record<string, number> = {};
  try {
    const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String(r.name)));
    for (const name of TABLES) {
      if (!have.has(name)) continue;
      const rows = db.prepare(`SELECT rowid AS _rowid, * FROM "${name}"`).all();
      const lines = rows.map((r) => {
        const row: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (k === '_rowid') continue;
          row[k] = v instanceof Uint8Array ? Buffer.from(v).toString('base64') : typeof v === 'bigint' ? Number(v) : v;
        }
        if (row.id === undefined && name === 'usage') row.id = Number(r._rowid);
        for (const c of JSON_COLS[name] ?? []) if (typeof row[c] === 'string') { try { row[c] = JSON.parse(row[c] as string); } catch { row[c] = []; } }
        return JSON.stringify({ p: row });
      });
      writeFileSync(join(dir, `${name}.jsonl`), lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
      report[name] = rows.length; total += rows.length;
    }
  } finally { db.close(); }
  const stamp = new Date().toISOString().slice(0, 10);
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(dbFile + suffix)) renameSync(dbFile + suffix, `${dbFile}.ancien-${stamp}${suffix}`);
  writeFileSync(done, JSON.stringify({ from: dbFile, at: new Date().toISOString(), rows: report }, null, 2), { mode: 0o600 });
  console.error(`[mémoire] ancienne base convertie en fichiers : ${total} lignes (${dir})`);
  return total;
}
