// Tes documents : Odin les indexe (nom, date, texte des PDF, Word, Excel, PowerPoint, textes) dans
// les dossiers que tu choisis (ton NAS monté, par exemple), puis retrouve « la facture EDF de mars ».
// Pour ranger ou renommer, il utilise ensuite ses outils de fichiers (avec ta validation).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { readDocx, readPptx, readXlsx } from '../files/office.ts';
import { readPdf } from '../files/pdf.ts';
import { wrapUntrusted } from '../heimdall/injection.ts';
import { num, obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.json', '.log', '.html', '.xml', '.yml', '.yaml']);
const DOC_EXT = new Set(['.pdf', '.docx', '.xlsx', '.pptx', ...TEXT_EXT]);
const SKIP = /^(\.|node_modules$|@eaDir$|#recycle$|\$RECYCLE\.BIN$|System Volume Information$)/;

export function ensureDocsTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS docs(path TEXT PRIMARY KEY, name TEXT NOT NULL, ext TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, indexed_at INTEGER NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(path UNINDEXED, name, body, tokenize='unicode61 remove_diacritics 2');`);
}

/** Texte d'un document (ou son seul nom pour les autres fichiers). */
export function docText(path: string): string {
  const ext = extname(path).toLowerCase();
  try {
    if (ext === '.pdf') return readPdf(readFileSync(path), path).text.slice(0, 200_000);
    if (ext === '.docx') return readDocx(readFileSync(path)).slice(0, 200_000);
    if (ext === '.pptx') return readPptx(readFileSync(path)).slice(0, 200_000);
    if (ext === '.xlsx') return readXlsx(readFileSync(path), 300).map((sh) => `${sh.name}\n${sh.rows.map((r) => r.join(' ')).join('\n')}`).join('\n').slice(0, 200_000);
    if (TEXT_EXT.has(ext)) return readFileSync(path, 'utf8').slice(0, 200_000);
  } catch { /* fichier illisible : seul son nom compte */ }
  return '';
}

/** Indexe (ou met à jour) les dossiers : seuls les fichiers nouveaux ou modifiés sont relus. */
export function indexDocs(db: DatabaseSync, dirs: string[], o: { maxFiles?: number; maxBytes?: number } = {}): { files: number; updated: number; removed: number } {
  ensureDocsTable(db);
  const maxFiles = o.maxFiles ?? 50_000, maxBytes = o.maxBytes ?? 50 * 1024 * 1024;
  const seen = new Set<string>(); let updated = 0;
  const get = db.prepare('SELECT mtime, size FROM docs WHERE path = ?');
  const up = db.prepare('INSERT OR REPLACE INTO docs(path, name, ext, size, mtime, indexed_at) VALUES (?,?,?,?,?,?)');
  const delFts = db.prepare('DELETE FROM docs_fts WHERE path = ?'), addFts = db.prepare('INSERT INTO docs_fts(path, name, body) VALUES (?,?,?)');
  const walk = (dir: string, depth: number) => {
    if (depth > 12 || seen.size >= maxFiles) return;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.test(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      let st; try { st = statSync(p); } catch { continue; }
      seen.add(p);
      const cur = get.get(p) as { mtime: number; size: number } | undefined;
      if (cur && cur.mtime === Math.floor(st.mtimeMs) && cur.size === st.size) continue;
      const ext = extname(e.name).toLowerCase();
      const body = DOC_EXT.has(ext) && st.size <= maxBytes ? docText(p) : '';
      up.run(p, e.name, ext, st.size, Math.floor(st.mtimeMs), Date.now());
      delFts.run(p); addFts.run(p, e.name.replace(/[_.-]+/g, ' '), body);
      updated++;
    }
  };
  for (const d of dirs) walk(d, 0);
  let removed = 0;
  const inDirs = (p: string) => dirs.some((d) => p.startsWith(d));
  for (const r of db.prepare('SELECT path FROM docs').all() as Array<{ path: string }>) {
    if (inDirs(r.path) && !seen.has(r.path)) { db.prepare('DELETE FROM docs WHERE path = ?').run(r.path); delFts.run(r.path); removed++; }
  }
  return { files: seen.size, updated, removed };
}

/** Recherche plein texte (nom et contenu), les plus pertinents d'abord. */
export function findDocs(db: DatabaseSync, query: string, limit = 15): Array<{ path: string; name: string; size: number; mtime: number; snippet: string }> {
  ensureDocsTable(db);
  const terms = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{2,}/g) ?? [];
  if (!terms.length) return [];
  const fts = terms.map((t) => `"${t}"*`).join(' ');
  return db.prepare(`SELECT f.path, d.name, d.size, d.mtime, snippet(docs_fts, 2, '«', '»', '…', 12) AS snippet FROM docs_fts f JOIN docs d ON d.path = f.path WHERE docs_fts MATCH ? ORDER BY bm25(docs_fts, 0, 5, 1) LIMIT ?`).all(fts, limit) as Array<{ path: string; name: string; size: number; mtime: number; snippet: string }>;
}

export const docFind: Tool = {
  name: 'doc_find',
  description: 'Retrouve tes documents (dossiers indexés dans Réglages → Documents) par leur nom ou leur contenu : « facture EDF mars », « contrat assurance voiture »… Renvoie les chemins, à ouvrir avec doc_read ou fs_read.',
  risk: 'read',
  taints: true,
  schema: obj({ query: str('ce que tu cherches'), count: num('nombre de résultats (15 par défaut)') }, ['query']),
  async run(i, ctx: ToolContext) {
    if (!ctx.docs?.dirs.length) return 'Aucun dossier de documents choisi : Réglages → Documents.';
    const r = findDocs(ctx.muninn.db, s(i.query), Math.min(50, Number(i.count ?? 15)));
    if (!r.length) return 'Aucun document trouvé (l\'index est mis à jour chaque nuit ; doc_index pour le refaire maintenant).';
    const text = r.map((d, k) => `${k + 1}. ${d.path}\n   ${new Date(d.mtime).toLocaleDateString('fr-FR')} · ${(d.size / 1024).toFixed(0)} Ko${d.snippet && d.snippet !== d.name ? `\n   ${d.snippet.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`).join('\n');
    return { output: wrapUntrusted('documents', text), tainted: true };
  },
};

export const docIndex: Tool = {
  name: 'doc_index',
  description: 'Met à jour l\'index de tes documents maintenant (seuls les fichiers nouveaux ou modifiés sont relus).',
  risk: 'read',
  schema: obj({}),
  async run(_i, ctx) {
    if (!ctx.docs?.dirs.length) return 'Aucun dossier de documents choisi : Réglages → Documents.';
    const r = indexDocs(ctx.muninn.db, ctx.docs.dirs);
    return `Index à jour : ${r.files} fichier(s), ${r.updated} relu(s), ${r.removed} retiré(s) — dossiers : ${ctx.docs.dirs.map((d) => basename(d) || d).join(', ')}.`;
  },
};

export const DOC_TOOLS: Tool[] = [docFind, docIndex];
