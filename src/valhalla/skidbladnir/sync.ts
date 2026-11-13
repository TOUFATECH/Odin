// Nébuleuse — synchronisation de deux dossiers (façon Syncthing, sur la machine d'Odin : un espace et un
// disque, une clé USB, un partage du NAS monté…). Dans les deux sens ou dans un seul. Rien n'est perdu :
// une suppression va à la corbeille, deux modifications en même temps gardent les deux (copie « conflit »).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { HIDDEN } from './store.ts';

export type Way = 'deux' | 'vers_dossier' | 'vers_espace';
export interface FileState { size: number; mtime: number }
export interface SyncReport { copiedAB: string[]; copiedBA: string[]; deletedA: string[]; deletedB: string[]; conflicts: string[]; errors: string[] }

/** Les fichiers d'un dossier (chemin relatif → taille et date), sans les dossiers cachés d'Odin. */
export function scan(dir: string): Map<string, FileState> {
  const out = new Map<string, FileState>(); if (!existsSync(dir)) return out;
  const walk = (d: string, rel: string, depth: number) => {
    if (depth > 30) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (HIDDEN.has(e.name) || e.name.startsWith('.odin') || e.isSymbolicLink()) continue;
      const p = rel ? `${rel}/${e.name}` : e.name, abs = join(d, e.name);
      if (e.isDirectory()) walk(abs, p, depth + 1);
      else if (e.isFile()) { const s = statSync(abs); out.set(p, { size: s.size, mtime: Math.floor(s.mtimeMs / 1000) }); }
    }
  };
  walk(dir, '', 0); return out;
}
const same = (x?: FileState, y?: FileState) => Boolean(x && y && x.size === y.size && Math.abs(x.mtime - y.mtime) <= 2);

/** Ce qu'il faut faire, sans rien toucher. Pur. `last` : l'état des deux côtés à la dernière synchro. */
export function plan(a: Map<string, FileState>, b: Map<string, FileState>, last: Record<string, FileState>, way: Way): Array<{ path: string; op: 'AB' | 'BA' | 'delA' | 'delB' | 'conflit' }> {
  const out: Array<{ path: string; op: 'AB' | 'BA' | 'delA' | 'delB' | 'conflit' }> = [];
  const all = new Set([...a.keys(), ...b.keys()]);
  for (const p of [...all].sort()) {
    const x = a.get(p), y = b.get(p), s = last[p];
    if (x && y) {
      if (same(x, y)) continue;
      const ca = !same(x, s), cb = !same(y, s);
      if (way === 'vers_dossier') { out.push({ path: p, op: 'AB' }); continue; }
      if (way === 'vers_espace') { out.push({ path: p, op: 'BA' }); continue; }
      if (ca && !cb) out.push({ path: p, op: 'AB' }); else if (cb && !ca) out.push({ path: p, op: 'BA' }); else out.push({ path: p, op: 'conflit' });
    } else if (x && !y) {
      // Absent de B : supprimé de B depuis la dernière fois (et A inchangé) → supprimé de A ; sinon nouveau → copié.
      if (s && same(x, s) && way === 'deux') out.push({ path: p, op: 'delA' }); else if (way !== 'vers_espace') out.push({ path: p, op: 'AB' }); else if (s && same(x, s)) out.push({ path: p, op: 'delA' });
    } else if (y && !x) {
      if (s && same(y, s) && way === 'deux') out.push({ path: p, op: 'delB' }); else if (way !== 'vers_dossier') out.push({ path: p, op: 'BA' }); else if (s && same(y, s)) out.push({ path: p, op: 'delB' });
    }
  }
  return out;
}

function copy(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  const tmp = `${to}.odin-part`; copyFileSync(from, tmp); const st = statSync(from); utimesSync(tmp, st.atime, st.mtime); renameSync(tmp, to);
}
/** Met un fichier de côté dans la corbeille de synchro du dossier (jamais effacé). */
function aside(root: string, rel: string): void {
  const to = join(root, '.odin-corbeille', `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`, rel);
  mkdirSync(dirname(to), { recursive: true }); renameSync(join(root, rel), to);
}
const conflictName = (rel: string, who: string) => { const e = extname(rel); return `${rel.slice(0, rel.length - e.length)} (conflit ${who} ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h')})${e}`; };

/** Synchronise A (l'espace) et B (le dossier). L'état de la dernière fois est gardé dans B. */
export function syncPair(A: string, B: string, way: Way, o: { trashA?: (rel: string) => void; nameB?: string } = {}): SyncReport {
  const r: SyncReport = { copiedAB: [], copiedBA: [], deletedA: [], deletedB: [], conflicts: [], errors: [] };
  if (!existsSync(B)) throw new Error(`dossier introuvable : ${B} (disque débranché ?)`);
  const stFile = join(B, '.odin-synchro.json');
  let last: Record<string, FileState> = {}; try { last = JSON.parse(readFileSync(stFile, 'utf8')); } catch { /* première fois */ }
  const a = scan(A), b = scan(B);
  for (const step of plan(a, b, last, way)) {
    try {
      const pa = join(A, step.path), pb = join(B, step.path);
      if (step.op === 'AB') { copy(pa, pb); r.copiedAB.push(step.path); }
      else if (step.op === 'BA') { copy(pb, pa); r.copiedBA.push(step.path); }
      else if (step.op === 'delA') { if (o.trashA) o.trashA(step.path); else aside(A, step.path); r.deletedA.push(step.path); }
      else if (step.op === 'delB') { aside(B, step.path); r.deletedB.push(step.path); }
      else {
        // Les deux ont changé : le plus récent garde la place, l'autre est gardé à côté sous un nom « conflit ».
        const x = a.get(step.path)!, y = b.get(step.path)!;
        if (x.mtime >= y.mtime) { const c = conflictName(step.path, o.nameB ?? 'dossier'); copy(pb, join(A, c)); copy(pa, pb); copy(pb, join(B, c)); r.conflicts.push(c); }
        else { const c = conflictName(step.path, 'espace'); copy(pa, join(B, c)); copy(pb, pa); copy(pa, join(A, c)); r.conflicts.push(c); }
      }
    } catch (e) { r.errors.push(`${step.path} : ${(e as Error).message}`); }
  }
  // Nouvel état commun (ce qui est pareil des deux côtés).
  const a2 = scan(A), b2 = scan(B), next: Record<string, FileState> = {};
  for (const [p, x] of a2) { const y = b2.get(p); if (same(x, y)) next[p] = x; }
  writeFileSync(stFile, JSON.stringify(next));
  return r;
}
