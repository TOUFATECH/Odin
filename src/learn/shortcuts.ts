// « Comme d'hab », « refais pareil », « la même chose qu'hier » : Odin retrouve de quoi tu parles dans
// son journal des tâches et ses habitudes, et le précise pour lui-même avant de répondre.

import type { TaskEntry } from '../muninn/files.ts';
import type { Known } from './habits.ts';

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");

/** Précision à ajouter à la demande (pur), ou undefined si ce n'est pas un raccourci. */
export function resolveShortcut(text: string, journal: TaskEntry[], habits: Known[], now = Date.now()): string | undefined {
  const s = norm(text).trim();
  if (s.length > 80) return undefined;
  const fmt = (e: TaskEntry) => `« ${e.goal} » (${new Date(e.at).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })})`;
  const done = journal.filter((e) => e.ok && now - e.at < 30 * 86_400_000);
  if (/\b(refais|recommence|relance|encore) (pareil|la meme chose|ca|ce que tu as fait)\b|^(pareil|idem|encore|rebelote|on refait|refais[- ]le)\b/.test(s)) {
    const last = done.at(-1);
    return last ? `« ${text.trim()} » = refaire la dernière tâche : ${fmt(last)}.` : undefined;
  }
  if (/\b(meme chose|pareil|comme) (qu'?|que )?hier\b/.test(s)) {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const h = new Date(now).getHours();
    const cand = done.filter((e) => new Date(e.at).toDateString() === y.toDateString()).sort((a, b) => Math.abs(new Date(a.at).getHours() - h) - Math.abs(new Date(b.at).getHours() - h));
    return cand[0] ? `« ${text.trim()} » = refaire la tâche d'hier : ${fmt(cand[0])}.` : undefined;
  }
  if (/\bcomme d'?hab(itude)?\b|\bcomme toujours\b|\ble truc habituel\b/.test(s)) {
    const min = new Date(now).getHours() * 60 + new Date(now).getMinutes();
    const hab = habits.filter((k) => k.state !== 'refused').sort((a, b) => Math.abs(a.habit.minute - min) - Math.abs(b.habit.minute - min))[0];
    if (hab) return `« ${text.trim()} » = ton habitude : « ${hab.habit.sample} ».`;
    // À défaut : la demande la plus fréquente du journal
    const count = new Map<string, number>();
    for (const e of done) count.set(e.goal, (count.get(e.goal) ?? 0) + 1);
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= 2 ? `« ${text.trim()} » = ce que tu demandes le plus souvent : « ${top[0]} ».` : undefined;
  }
  return undefined;
}
