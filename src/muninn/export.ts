// Export des conversations avec Odin : une conversation, une période ou tout l'historique,
// en Markdown (lisible), JSON (complet) ou texte brut. Rien ne sort de la machine : le fichier est
// seulement proposé au téléchargement dans l'interface.

import type { Mnemosyne } from './store.ts';

export type ExportFormat = 'md' | 'json' | 'txt';
export interface ExportRequest { sessions?: string[]; from?: number; to?: number; format?: ExportFormat; withTools?: boolean }

const when = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const who = (role: string) => (role === 'user' ? 'Toi' : role === 'assistant' ? 'Odin' : role === 'tool' ? 'Outil' : role);

/** Construit le fichier d'export. Rend son contenu, son type et un nom de fichier. */
export function exportConversations(m: Mnemosyne, r: ExportRequest): { body: string; mime: string; filename: string; count: number } {
  const format: ExportFormat = r.format ?? 'md';
  const ids = r.sessions?.length ? r.sessions : m.listSessions(100_000).map((s) => s.id);
  const convs = ids.map((id) => m.getSession(id)).filter((s): s is NonNullable<typeof s> => Boolean(s)).map((s) => ({
    session: s,
    messages: m.allMessages(s.id).filter((x) => (r.withTools || x.role === 'user' || x.role === 'assistant') && (!r.from || x.created_at >= r.from) && (!r.to || x.created_at <= r.to)),
  })).filter((c) => c.messages.length);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = convs.length === 1 ? (convs[0].session.title || convs[0].session.id).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').slice(0, 60) : 'conversations-odin';
  if (format === 'json') {
    const body = JSON.stringify({ exported_at: new Date().toISOString(), conversations: convs.map((c) => ({ id: c.session.id, title: c.session.title, created_at: c.session.created_at, messages: c.messages.map((x) => ({ role: x.role, content: x.content, at: new Date(x.created_at).toISOString(), ...(x.tool_name ? { tool: x.tool_name } : {}) })) })) }, null, 2);
    return { body, mime: 'application/json; charset=utf-8', filename: `${base}-${stamp}.json`, count: convs.length };
  }
  if (format === 'txt') {
    const body = convs.map((c) => [`${c.session.title || 'Conversation avec Odin'}`, ...c.messages.map((x) => `[${when(x.created_at)}] ${who(x.role)} : ${x.content}`)].join('\n')).join('\n\n----------\n\n');
    return { body, mime: 'text/plain; charset=utf-8', filename: `${base}-${stamp}.txt`, count: convs.length };
  }
  const body = [`# Conversations avec Odin`, `Exporté le ${when(Date.now())} · ${convs.length} conversation(s)`, '',
    ...convs.flatMap((c) => [`## ${c.session.title || 'Conversation avec Odin'}`, `_Commencée le ${when(c.session.created_at)}_`, '',
      ...c.messages.flatMap((x) => [`**${who(x.role)}** · ${when(x.created_at)}`, '', x.content, ''])]),
  ].join('\n');
  return { body, mime: 'text/markdown; charset=utf-8', filename: `${base}-${stamp}.md`, count: convs.length };
}
