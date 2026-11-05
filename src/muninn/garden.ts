// Odin range lui-même sa mémoire : il garde ce qui sert, améliore ce qui est flou ou en anglais,
// fusionne les doublons, met à jour ce que la réalité a changé (un appareil « non identifié » qui
// l'est maintenant) et oublie ce qui est périmé. Les souvenirs épinglés par toi ne sont jamais
// touchés ; tout ce qui est modifié ou oublié peut être annulé pendant 7 jours.

import type { Muninn, MemoryRow } from './store.ts';

export type Llm = (system: string, user: string, maxTokens?: number) => Promise<string>;
export interface GardenPlan { update?: Array<{ id: number; content: string; why?: string }>; merge?: Array<{ ids: number[]; content: string }>; forget?: Array<{ id: number; why?: string }> }
export interface GardenReport { updated: number; merged: number; forgotten: number; lines: string[] }

const SYSTEM = `Tu ranges la mémoire à long terme d'un assistant (souvenirs sur son propriétaire, son réseau, ses machines, ses préférences).
Objectif : une mémoire courte, juste, à jour et en français.
- update : reformule un souvenir flou, trop long, en anglais, ou contredit par les FAITS ACTUELS (ex. appareil « non identifié » qui a maintenant un nom).
- merge : fusionne les doublons ou souvenirs qui disent la même chose (une phrase claire).
- forget : oublie ce qui est périmé, ponctuel (état passager, « en cours de… »), faux d'après les faits actuels, ou sans intérêt durable.
- Ne touche pas aux préférences du propriétaire sauf pour les clarifier. Garde tout ce qui est utile.
Réponds en JSON strict : {"update":[{"id":N,"content":"…","why":"…"}],"merge":[{"ids":[N,M],"content":"…"}],"forget":[{"id":N,"why":"…"}]}. Listes vides si rien à faire.`;

export async function gardenMemory(m: Muninn, llm: Llm, facts: string, now = Date.now()): Promise<GardenReport> {
  const all = (m.listMemories(400) as MemoryRow[]).filter((x) => !x.pinned && x.origin !== 'untrusted' && !x.superseded_by && x.kind !== 'lesson');
  const rep: GardenReport = { updated: 0, merged: 0, forgotten: 0, lines: [] };
  if (all.length < 3) return rep;
  const list = all.slice(0, 150).map((x) => `#${x.id} [${x.kind}${x.origin === 'owner' ? ', dit par le propriétaire' : ''}, ${new Date(x.created_at).toLocaleDateString('fr-FR')}] ${x.content}`).join('\n');
  const raw = await llm(SYSTEM, `FAITS ACTUELS :\n${facts}\n\nSOUVENIRS :\n${list}`, 3000);
  const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
  let plan: GardenPlan = {};
  try { plan = JSON.parse(raw.slice(s, e + 1)) as GardenPlan; } catch { return rep; }
  const ok = new Set(all.map((x) => x.id));
  const undo: MemoryRow[] = [];
  const save = (id: number) => { const r = m.getMemory(id); if (r) undo.push(r); };
  for (const u of (plan.update ?? []).slice(0, 30)) {
    if (!ok.has(u.id) || !u.content?.trim()) continue;
    save(u.id); m.editMemory(u.id, u.content.trim()); ok.delete(u.id); rep.updated++;
    rep.lines.push(`Amélioré #${u.id} : ${u.content.trim().slice(0, 100)}`);
  }
  for (const g of (plan.merge ?? []).slice(0, 20)) {
    const ids = (g.ids ?? []).filter((id) => ok.has(id));
    if (ids.length < 2 || !g.content?.trim()) continue;
    ids.forEach(save);
    m.editMemory(ids[0], g.content.trim());
    for (const id of ids.slice(1)) m.forget(id);
    ids.forEach((id) => ok.delete(id)); rep.merged += ids.length - 1;
    rep.lines.push(`Fusionné ${ids.map((i) => `#${i}`).join(' + ')} : ${g.content.trim().slice(0, 100)}`);
  }
  for (const f of (plan.forget ?? []).slice(0, 40)) {
    if (!ok.has(f.id)) continue;
    save(f.id); m.forget(f.id); ok.delete(f.id); rep.forgotten++;
    rep.lines.push(`Oublié #${f.id}${f.why ? ` (${f.why.slice(0, 80)})` : ''}`);
  }
  if (undo.length) m.setKv(`memory-undo:${now}`, JSON.stringify(undo));
  m.setKv('memory-garden-last', JSON.stringify({ at: now, ...rep }));
  return rep;
}

/** Annule un rangement (7 jours). */
export function undoGarden(m: Muninn, at: number): number {
  const raw = m.getKv(`memory-undo:${at}`); if (!raw) return 0;
  const rows = JSON.parse(raw) as MemoryRow[];
  for (const r of rows) m.restoreMemory(r);
  m.setKv(`memory-undo:${at}`, '');
  return rows.length;
}
