// Annuler : avant qu'Odin écrase ou modifie un fichier, l'ancienne version est gardée
// (~/.odin/undo/, 30 jours). Depuis la ligne de temps d'une mission, un clic la remet en place.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface UndoEntry { id: string; sessionId: string; at: number; path: string; backup: string | null; tool: string; undone?: boolean }
const dir = (home: string) => join(home, 'undo');
const journal = (home: string) => join(dir(home), 'journal.json');
export function undoList(home: string): UndoEntry[] { try { return JSON.parse(readFileSync(journal(home), 'utf8')) as UndoEntry[]; } catch { return []; } }
function save(home: string, l: UndoEntry[]) { mkdirSync(dir(home), { recursive: true }); writeFileSync(journal(home), JSON.stringify(l.slice(-500))); }

/** À appeler juste AVANT d'écrire un fichier. */
export function rememberBefore(home: string | undefined, sessionId: string, path: string, tool: string): void {
  if (!home) return;
  try {
    mkdirSync(dir(home), { recursive: true });
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let backup: string | null = null;
    if (existsSync(path) && statSync(path).isFile() && statSync(path).size <= 20 * 1024 * 1024) { backup = join(dir(home), `${id}.bak`); copyFileSync(path, backup); }
    const l = undoList(home); l.push({ id, sessionId, at: Date.now(), path, backup, tool }); save(home, l);
    // Ménage : sauvegardes de plus de 30 jours.
    const old = Date.now() - 30 * 86_400_000;
    for (const e of l.filter((x) => x.at < old && x.backup)) rmSync(e.backup!, { force: true });
    if (l.some((x) => x.at < old)) save(home, l.filter((x) => x.at >= old));
  } catch { /* l'annulation ne doit jamais empêcher l'action */ }
}

/** Remet le fichier dans l'état d'avant l'action (ou le supprime s'il n'existait pas). */
export function undo(home: string, id: string): string {
  const l = undoList(home), e = l.find((x) => x.id === id);
  if (!e) throw new Error('action introuvable');
  if (e.undone) throw new Error('déjà annulée');
  if (e.backup) { if (!existsSync(e.backup)) throw new Error('ancienne version expirée'); copyFileSync(e.backup, e.path); }
  else rmSync(e.path, { force: true });
  e.undone = true; save(home, l);
  return e.backup ? `${e.path} remis dans son état d'avant` : `${e.path} supprimé (il n'existait pas avant)`;
}
export const undoFiles = (home: string) => { try { return readdirSync(dir(home)).length; } catch { return 0; } };
