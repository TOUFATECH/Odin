// Tes documents : Odin les indexe (nom, date, texte des PDF, Word, Excel, PowerPoint, textes) dans
// les dossiers que tu choisis (ton NAS monté, par exemple), puis retrouve « la facture EDF de mars ».
// Pour ranger ou renommer, il utilise ensuite ses outils de fichiers (avec ta validation).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { snippet as cut, TextIndex } from '../muninn/fulltext.ts';
import type { Table } from '../muninn/tables.ts';
import { readDocx, readPptx, readXlsx } from '../files/office.ts';
import { readPdf } from '../files/pdf.ts';
import { wrapUntrusted } from '../heimdall/injection.ts';
import { num, obj, str, type Tool, type ToolContext } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.json', '.log', '.html', '.xml', '.yml', '.yaml']);
const DOC_EXT = new Set(['.pdf', '.docx', '.xlsx', '.pptx', ...TEXT_EXT]);
const SKIP = /^(\.|node_modules$|@eaDir$|#recycle$|\$RECYCLE\.BIN$|System Volume Information$)/;

/** Où ranger l'index : la mémoire d'Odin (fichier `docs.jsonl`), jamais une base de données. */
export interface DocHost { table<T extends Record<string, unknown>>(name: string, keyOf: (r: T) => string | number): Table<T> }
interface DocRow { path: string; name: string; ext: string; size: number; mtime: number; indexed_at: number; body: string; [k: string]: unknown }
/** Texte gardé par document pour la recherche (le reste se relit dans le fichier lui-même). */
const BODY_MAX = 50_000;
interface Idx { name: TextIndex; body: TextIndex; ids: Map<string, number>; paths: Map<number, string>; next: number }
const cache = new WeakMap<object, Idx>();
const docsOf = (h: DocHost) => h.table<DocRow>('docs', (r) => r.path);
function idxOf(h: DocHost): Idx {
  let x = cache.get(h);
  if (!x) { x = { name: new TextIndex(), body: new TextIndex(), ids: new Map(), paths: new Map(), next: 1 }; cache.set(h, x); for (const r of docsOf(h).values()) addIdx(x, r); }
  return x;
}
function addIdx(x: Idx, r: DocRow): void {
  let id = x.ids.get(r.path); if (!id) { id = x.next++; x.ids.set(r.path, id); x.paths.set(id, r.path); }
  x.name.add(id, r.name.replace(/[_.-]+/g, ' ')); x.body.add(id, r.body);
}
function dropIdx(x: Idx, path: string): void { const id = x.ids.get(path); if (!id) return; x.name.remove(id); x.body.remove(id); x.ids.delete(path); x.paths.delete(id); }

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
export function indexDocs(h: DocHost, dirs: string[], o: { maxFiles?: number; maxBytes?: number } = {}): { files: number; updated: number; removed: number } {
  const docs = docsOf(h), x = idxOf(h);
  const maxFiles = o.maxFiles ?? 50_000, maxBytes = o.maxBytes ?? 50 * 1024 * 1024;
  const seen = new Set<string>(); let updated = 0;
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
      const cur = docs.get(p);
      if (cur && cur.mtime === Math.floor(st.mtimeMs) && cur.size === st.size) continue;
      const ext = extname(e.name).toLowerCase();
      const body = DOC_EXT.has(ext) && st.size <= maxBytes ? docText(p) : '';
      addIdx(x, docs.put({ path: p, name: e.name, ext, size: st.size, mtime: Math.floor(st.mtimeMs), indexed_at: Date.now(), body: body.slice(0, BODY_MAX) }));
      updated++;
    }
  };
  for (const d of dirs) walk(d, 0);
  let removed = 0;
  const inDirs = (p: string) => dirs.some((d) => p.startsWith(d));
  for (const r of docs.all()) {
    if (inDirs(r.path) && !seen.has(r.path)) { docs.delete(r.path); dropIdx(x, r.path); removed++; }
  }
  if (removed) docs.compact();
  return { files: seen.size, updated, removed };
}

/** Dossiers à indexer : ceux choisis, sinon les dossiers habituels (Documents, Téléchargements, Bureau, fichiers reçus). */
export function docDirs(chosen: string[] | undefined, workspace?: string): string[] {
  if (chosen?.length) return chosen;
  const h = homedir();
  return [...['Documents', 'Téléchargements', 'Downloads', 'Bureau', 'Desktop', 'Images', 'Pictures'].map((d) => join(h, d)), ...(workspace ? [join(workspace, 'inbox')] : [])].filter((d) => { try { return existsSync(d) && statSync(d).isDirectory(); } catch { return false; } });
}

/** Recherche plein texte (nom et contenu) : tous les mots doivent être trouvés, le nom compte 5 fois plus. */
export function findDocs(h: DocHost, query: string, limit = 15): Array<{ path: string; name: string; size: number; mtime: number; snippet: string }> {
  const terms = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{2,}/g) ?? [];
  if (!terms.length) return [];
  const docs = docsOf(h), x = idxOf(h);
  let total: Map<number, number> | undefined;
  for (const term of [...new Set(terms)]) {
    const s = new Map<number, number>();
    for (const r of x.name.search(term, () => true, 100_000)) s.set(r.id, (s.get(r.id) ?? 0) + 5 * r.score);
    for (const r of x.body.search(term, () => true, 100_000)) s.set(r.id, (s.get(r.id) ?? 0) + r.score);
    total = total ? new Map([...total].filter(([id]) => s.has(id)).map(([id, v]) => [id, v + s.get(id)!])) : s;
  }
  return [...(total ?? [])].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => docs.get(x.paths.get(id)!)!).filter(Boolean)
    .map((d) => ({ path: d.path, name: d.name, size: d.size, mtime: d.mtime, snippet: d.body ? cut(d.body, query, 12) : d.name }));
}

export const docFind: Tool = {
  name: 'doc_find',
  description: 'Retrouve tes documents et fichiers (Documents, Téléchargements, Bureau, fichiers reçus, ou les dossiers de Réglages → Documents) par leur nom ou leur contenu, PDF, Word, Excel compris : « facture EDF mars », « contrat assurance voiture »… Renvoie les chemins, à ouvrir avec doc_read ou fs_read.',
  risk: 'read',
  taints: true,
  schema: obj({ query: str('ce que tu cherches'), count: num('nombre de résultats (15 par défaut)') }, ['query']),
  async run(i, ctx: ToolContext) {
    const dirs = docDirs(ctx.docs?.dirs, ctx.workspace);
    if (!dirs.length) return 'Aucun dossier de documents trouvé : choisis-en dans Réglages → Documents.';
    // Premier usage : index fait tout de suite (ensuite chaque nuit).
    if (!docsOf(ctx.muninn).size) { try { indexDocs(ctx.muninn, dirs); } catch { /* on cherche avec ce qu'on a */ } }
    const r = findDocs(ctx.muninn, s(i.query), Math.min(50, Number(i.count ?? 15)));
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
    const dirs = docDirs(ctx.docs?.dirs, ctx.workspace);
    if (!dirs.length) return 'Aucun dossier de documents trouvé : choisis-en dans Réglages → Documents.';
    const r = indexDocs(ctx.muninn, dirs);
    return `Index à jour : ${r.files} fichier(s), ${r.updated} relu(s), ${r.removed} retiré(s) — dossiers : ${dirs.map((d) => basename(d) || d).join(', ')}.`;
  },
};

export const DOC_TOOLS: Tool[] = [docFind, docIndex];
