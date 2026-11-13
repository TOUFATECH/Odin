// La mémoire d'Odin en fichiers lisibles, que tu peux ouvrir et corriger à la main :
//   ~/.odin/SOUL.md    sa personnalité (qui il est, comment il parle) — ex-ODIN.md
//   ~/.odin/USER.md    ce qu'il sait de toi (préférences, personnes, habitudes)
//   ~/.odin/MEMORY.md  ce qu'il sait du reste (machines, projets, faits, façons de faire, leçons)
// Les deux derniers sont synchronisés avec sa base (Mnémosyne) dans les deux sens : une ligne que tu
// modifies est corrigée, une ligne que tu supprimes est oubliée, une ligne que tu ajoutes est retenue
// (comme venant de toi). Chaque ligne garde son numéro en commentaire invisible : <!-- #12 -->.
// Rien de ce qui vient d'un contenu non fiable (web, mails) n'est écrit dans ces fichiers.

import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MemoryRow, Mnemosyne } from './store.ts';

export const USER_KINDS = new Set(['preference', 'person']);
export const isAboutUser = (m: Pick<MemoryRow, 'kind' | 'subject'>) => USER_KINDS.has(m.kind) || /^(proprietaire|moi|owner|personne:)/i.test(m.subject ?? '');

const LABEL: Record<string, string> = { fact: 'Faits', environment: 'Environnement', mission: 'Missions et projets', procedure: 'Façons de faire', project: 'Projets', lesson: 'Leçons apprises', episode: 'Conversations passées', preference: 'Préférences', person: 'Personnes' };
/** Rubrique écrite par Odin seul (relue, jamais réimportée). */
export const JOURNAL = 'Journal des tâches (écrit par Odin)';

/** Contenu d'un fichier mémoire (pur). */
export interface TaskEntry { at: number; goal: string; ok: boolean; tools: string[]; result: string }
/** Note une tâche faite (50 dernières), pour le journal de MEMORY.md. */
export function recordTask(muninn: { getKv(k: string): string | undefined | null; setKv(k: string, v: string): void }, e: TaskEntry): void {
  let l: TaskEntry[] = []; try { l = JSON.parse(muninn.getKv('task-journal') ?? '[]') as TaskEntry[]; } catch { /* vide */ }
  l.push(e); muninn.setKv('task-journal', JSON.stringify(l.slice(-50)));
}

export function renderMemoryFile(title: string, intro: string, rows: MemoryRow[], journal: TaskEntry[] = []): string {
  const groups = new Map<string, MemoryRow[]>();
  for (const r of rows) { const k = LABEL[r.kind] ?? 'Divers'; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const out = [`# ${title}`, '', intro, ''];
  for (const [k, list] of groups) {
    out.push(`## ${k}`, '');
    for (const r of list) out.push(`- ${r.content.replace(/\s*\n\s*/g, ' ').trim()}${r.pinned ? ' 📌' : ''} <!-- #${r.id} -->`);
    out.push('');
  }
  if (journal.length) {
    out.push(`## ${JOURNAL}`, '');
    for (const e of journal.slice().reverse().slice(0, 30)) out.push(`- ${new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ${e.ok ? '✅' : '⚠️'} ${e.goal}${e.tools.length ? ` (${e.tools.join(', ')})` : ''}`);
    out.push('');
  }
  return out.join('\n');
}

/** Lignes d'un fichier mémoire : { id?, texte, rubrique }. Pur. */
export function parseMemoryFile(text: string): Array<{ id?: number; content: string; section: string; pinned: boolean }> {
  const out: Array<{ id?: number; content: string; section: string; pinned: boolean }> = [];
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const h = /^##\s+(.+)$/.exec(line); if (h) { section = h[1].trim(); continue; }
    if (section === JOURNAL) continue;
    const m = /^\s*[-*]\s+(.+?)\s*$/.exec(line); if (!m) continue;
    const id = /<!--\s*#(\d+)\s*-->/.exec(m[1]);
    const content = m[1].replace(/<!--[\s\S]*?-->/g, '').replace(/\s*📌\s*$/, '').trim();
    if (content) out.push({ id: id ? Number(id[1]) : undefined, content, section, pinned: /📌/.test(m[1]) });
  }
  return out;
}

const kindOf = (section: string, user: boolean) => Object.entries(LABEL).find(([, v]) => v.toLowerCase() === section.toLowerCase())?.[0] ?? (user ? 'preference' : 'fact');

export interface SyncReport { edited: number; forgotten: number; added: number }

/**
 * Synchronise USER.md et MEMORY.md avec Mnémosyne. Si tu as modifié un fichier depuis la dernière
 * écriture d'Odin, tes changements sont appliqués d'abord ; puis les deux fichiers sont réécrits.
 */
export function syncMemoryFiles(home: string, muninn: Mnemosyne): SyncReport {
  const rep: SyncReport = { edited: 0, forgotten: 0, added: 0 };
  const state = JSON.parse(muninn.getKv('memfiles') ?? '{}') as Record<string, { at: number; ids: number[] }>;
  for (const [file, user] of [['USER.md', true], ['MEMORY.md', false]] as const) {
    const p = join(home, file), last = state[file];
    if (!existsSync(p) || !last || statSync(p).mtimeMs <= last.at + 1000) continue;
    const lines = parseMemoryFile(readFileSync(p, 'utf8'));
    const seen = new Set<number>();
    for (const l of lines) {
      if (l.id != null && last.ids.includes(l.id)) {
        seen.add(l.id);
        const cur = muninn.getMemory(l.id);
        if (cur && cur.content.replace(/\s*\n\s*/g, ' ').trim() !== l.content) { muninn.editMemory(l.id, l.content, true); rep.edited++; }
      } else if (!/\[SECRET\]/.test(l.content)) {
        muninn.remember(l.content, 'owner', kindOf(l.section, user), '', user ? { subject: 'proprietaire', source: `${file} (écrit par toi)` } : { source: `${file} (écrit par toi)` });
        rep.added++;
      }
    }
    for (const id of last.ids) if (!seen.has(id) && muninn.getMemory(id)) { muninn.forget(id); rep.forgotten++; }
  }
  // Réécriture depuis la base (la source de vérité)
  const all = muninn.listMemories(2000).filter((m) => m.origin !== 'untrusted' && !m.superseded_by).sort((a, b) => a.id - b.id);
  const user = all.filter(isAboutUser), rest = all.filter((m) => !isAboutUser(m));
  const now = Date.now();
  writeFileSync(join(home, 'USER.md'), renderMemoryFile('Ce qu\'Odin sait de toi', '> Tu peux corriger, supprimer ou ajouter des lignes (« - … ») : Odin applique tes changements à sa prochaine mise à jour (toutes les 10 minutes). Ne mets jamais de mot de passe ici.', user), { mode: 0o600 });
  let journal: TaskEntry[] = []; try { journal = JSON.parse(muninn.getKv('task-journal') ?? '[]') as TaskEntry[]; } catch { /* vide */ }
  writeFileSync(join(home, 'MEMORY.md'), renderMemoryFile('Mémoire d\'Odin', '> Ce qu\'Odin sait de ta maison, tes machines, tes projets et ce qu\'il a appris, mis à jour après chaque tâche. Modifiable comme USER.md (sauf le journal des tâches).', rest, journal), { mode: 0o600 });
  for (const f of ['USER.md', 'MEMORY.md']) { try { chmodSync(join(home, f), 0o600); } catch { /* Windows */ } }
  muninn.setKv('memfiles', JSON.stringify({ 'USER.md': { at: now, ids: user.map((m) => m.id) }, 'MEMORY.md': { at: now, ids: rest.map((m) => m.id) } }));
  return rep;
}

/** USER.md en bref, pour le prompt (toujours présent, comme le profil de Hermes). */
export function userBrief(home: string, max = 1500): string {
  const p = join(home, 'USER.md');
  if (!existsSync(p)) return '';
  const lines = parseMemoryFile(readFileSync(p, 'utf8')).map((l) => `- ${l.content}`);
  let out = '';
  for (const l of lines) { if (out.length + l.length > max) break; out += `${l}\n`; }
  return out.trim();
}
