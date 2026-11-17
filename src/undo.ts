// Annuler : avant qu'Odin écrase ou modifie un fichier, l'ancienne version est gardée
// (~/.odin/undo/, 30 jours). Depuis la ligne de temps d'une mission, un clic la remet en place.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

/**
 * Revoit toutes les copies d'annulation encore actives d'un fichier : `revoir` reçoit le texte de la copie et rend le
 * nouveau texte, ou null quand la copie ne peut pas être revue (elle est alors oubliée, avec son entrée). Une entrée sans
 * copie (le fichier n'existait pas : l'annuler le supprimerait) est oubliée aussi. Sert à une migration qui ne doit pas
 * pouvoir être défaite par « annule tout ». Rend le nombre d'entrées revues ou oubliées.
 */
export function reviserCopies(home: string, path: string, revoir: (texte: string) => string | null): number {
  const l = undoList(home), cible = resolve(path);
  let n = 0;
  const garder = l.filter((e) => {
    if (e.undone || resolve(e.path) !== cible) return true;
    n++;
    if (!e.backup) return false;
    let neuf: string | null = null;
    try { neuf = revoir(readFileSync(e.backup, 'utf8')); } catch { neuf = null; }
    if (neuf === null) { rmSync(e.backup, { force: true }); return false; }
    writeFileSync(e.backup, neuf, { mode: 0o600 });
    return true;
  });
  if (n) save(home, garder);
  return n;
}
export const undoFiles =(home: string) => { try { return readdirSync(dir(home)).length; } catch { return 0; } };
