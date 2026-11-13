// Odin OS — tâches longues du système (installer un paquet, un pont, le système sur un disque).
// Le bureau lance la tâche, puis suit son journal : rien n'est bloqué pendant ce temps.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export interface Tache { id: string; titre: string; etat: 'en cours' | 'fini' | 'erreur'; journal: string; code: number | null; debut: number; fin?: number; exclusif: boolean }
const taches = new Map<string, Tache>();
const MAX_JOURNAL = 60_000;

/** Commande d'administration : avec sudo, sauf si Odin est déjà administrateur (téléphone : proot, sans sudo). */
export function admin(cmd: string, args: string[]): [string, string[]] { return process.getuid?.() === 0 ? [cmd, args] : ['sudo', ['-n', cmd, ...args]]; }

/** Lance une commande en tâche de fond. `exclusif` : une seule tâche de ce genre à la fois (apt ne supporte pas deux installations en même temps). */
export function lancerTache(titre: string, cmd: string, args: string[], o: { exclusif?: boolean; env?: NodeJS.ProcessEnv; cwd?: string } = {}): { ok: true; tache: string } | { ok: false; error: string } {
  for (const [id, t] of taches) if (t.fin && Date.now() - t.fin > 3600_000) taches.delete(id);
  if (o.exclusif !== false && [...taches.values()].some((t) => t.exclusif && t.etat === 'en cours')) return { ok: false, error: 'Une installation est déjà en cours : attends qu\'elle se termine.' };
  const t: Tache = { id: randomBytes(8).toString('hex'), titre, etat: 'en cours', journal: '', code: null, debut: Date.now(), exclusif: o.exclusif !== false };
  taches.set(t.id, t);
  const ecrire = (b: Buffer | string) => { t.journal = (t.journal + String(b).replace(/\r(?!\n)/g, '\n')).slice(-MAX_JOURNAL); };
  try {
    const p = spawn(cmd, args, { cwd: o.cwd, env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive', LANG: 'C.UTF-8', ...o.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', ecrire); p.stderr.on('data', ecrire);
    p.on('error', (e) => { ecrire(`\n${e.message}\n`); t.etat = 'erreur'; t.code = -1; t.fin = Date.now(); });
    p.on('close', (code) => { if (t.fin) return; t.code = code; t.etat = code === 0 ? 'fini' : 'erreur'; t.fin = Date.now(); });
  } catch (e) { t.etat = 'erreur'; t.code = -1; t.fin = Date.now(); ecrire((e as Error).message); }
  return { ok: true, tache: t.id };
}
export function etatTache(id: string): { ok: true; etat: Tache['etat']; journal: string; code: number | null; titre: string } | { ok: false; error: string } {
  const t = taches.get(id); if (!t) return { ok: false, error: 'Tâche inconnue (Odin a peut-être redémarré).' };
  return { ok: true, etat: t.etat, journal: t.journal, code: t.code, titre: t.titre };
}
/** Attend la fin d'une tâche (tests et ligne de commande). */
export async function attendreTache(id: string, maxMs = 600_000): Promise<Tache | undefined> {
  const debut = Date.now();
  for (;;) { const t = taches.get(id); if (!t || t.etat !== 'en cours' || Date.now() - debut > maxMs) return t; await new Promise((r) => setTimeout(r, 200)); }
}
