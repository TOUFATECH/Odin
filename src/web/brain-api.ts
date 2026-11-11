// API de l'espace Cerveau (interface web) : pages, graphe, bases, recherche, corbeille, capture,
// questions au cerveau. Tout passe par le coffre Markdown ; capturer et demander passent par l'agent
// (donc par Heimdall), dans une conversation à part « web:cerveau ».

import { isoDay, sourceOf, TYPES, type NoteMeta } from '../brain/vault.ts';
import type { Odin } from '../runtime.ts';
import { brainOf } from '../tools/brain.ts';

const vaultOf = (odin: Odin) => brainOf({ home: odin.paths.home, careCfg: odin.cfg, workspace: odin.paths.workspace });

/** Connecteurs d'Odin qui alimentent le Cerveau, avec leur état et le nombre de notes venues d'eux. */
function connectors(odin: Odin): Array<{ id: string; label: string; on: boolean; notes: number; what: string }> {
  const ch = odin.cfg.channels as Record<string, { enabled?: boolean } | undefined>;
  const counts = new Map<string, number>();
  for (const n of vaultOf(odin).all()) { const s = sourceOf(n); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
  const c = (k: string) => counts.get(k) ?? 0;
  const cfg = odin.cfg as unknown as Record<string, Record<string, unknown> | undefined>;
  return [
    { id: 'Discussion', label: 'Discussion', on: true, notes: c('Discussion'), what: 'ce que tu dis à Odin' },
    { id: 'Telegram', label: 'Telegram', on: Boolean(ch.telegram?.enabled), notes: c('Telegram'), what: 'messages, vocaux, photos, fichiers' },
    { id: 'WhatsApp', label: 'WhatsApp', on: Boolean(ch.whatsapp?.enabled), notes: c('WhatsApp'), what: 'messages et pièces jointes' },
    { id: 'Signal', label: 'Signal', on: Boolean(ch.signal?.enabled), notes: c('Signal'), what: 'messages et pièces jointes' },
    { id: 'Mail', label: 'Mail', on: Boolean(cfg.mail?.enabled ?? cfg.mail?.imap), notes: c('Mail'), what: 'mails importants, pièces jointes' },
    { id: 'Agenda', label: 'Agenda', on: Boolean(cfg.calendar?.enabled ?? cfg.calendar?.url), notes: c('Agenda'), what: 'réunions, rendez-vous' },
    { id: 'YouTube', label: 'YouTube', on: true, notes: c('YouTube'), what: 'vidéos résumées et transcrites' },
    { id: 'TikTok', label: 'TikTok', on: true, notes: c('TikTok'), what: 'vidéos résumées et transcrites' },
    { id: 'Instagram', label: 'Instagram', on: true, notes: c('Instagram'), what: 'reels et publications' },
    { id: 'X', label: 'X', on: true, notes: c('X'), what: 'publications' },
    { id: 'Web', label: 'Pages web', on: true, notes: c('Web'), what: 'articles et pages, résumés' },
    { id: 'Fichiers', label: 'Fichiers', on: true, notes: c('Fichiers'), what: 'PDF, Word, Excel, images' },
    { id: 'Vocal', label: 'Vocaux', on: true, notes: c('Vocal'), what: 'idées dictées' },
    { id: 'GitHub', label: 'GitHub', on: true, notes: c('GitHub'), what: 'dépôts et outils' },
    { id: 'Draupnir', label: 'Draupnir', on: true, notes: c('Automatisation'), what: 'automatisations : formulaires, flux, pages surveillées, webhooks' },
    { id: 'Notion', label: 'Import Notion', on: Boolean(process.env.NOTION_TOKEN), notes: c('Notion'), what: 'pages importées depuis un compte Notion' },
  ];
}

export function brainGet(odin: Odin, path: string, q: URLSearchParams): unknown {
  const v = vaultOf(odin);
  switch (path) {
    case '/api/brain/tree': return { ok: true, root: v.root, notes: v.all().map((n) => ({ path: n.path, title: n.title, type: String(n.meta.type ?? (n.path.startsWith('Journal/') ? 'journal' : 'note')), mtime: n.mtime, tags: n.tags.slice(0, 6), favori: n.meta.favori === true, icone: n.meta.icone ?? '' })), types: TYPES, stats: v.stats(), trash: v.trashed().slice(0, 50), connectors: connectors(odin) };
    case '/api/brain/note': {
      const n = v.find(q.get('path') ?? '');
      if (!n) return { ok: false, error: 'note introuvable' };
      const out = n.links.map((l) => ({ target: l, path: v.find(l)?.path }));
      return { ok: true, note: { path: n.path, title: n.title, meta: n.meta, body: n.body, tags: n.tags, mtime: n.mtime }, links: out, backlinks: v.backlinks(n.path).map((o) => ({ path: o.path, title: o.title })), mentions: v.unlinkedMentions(n.path).map((o) => ({ path: o.path, title: o.title })) };
    }
    case '/api/brain/graph': return { ok: true, ...v.graph({ center: q.get('center') || undefined, depth: Number(q.get('depth')) || 1 }) };
    case '/api/brain/search': return { ok: true, results: v.search(q.get('q') ?? '', 30).map((r) => ({ path: r.note.path, title: r.note.title, type: String(r.note.meta.type ?? 'note'), snippet: r.snippet })) };
    case '/api/brain/db': { const t = q.get('type') ?? 'projet'; return { ok: true, type: t, def: TYPES[t], rows: v.database(t) }; }
    default: return undefined;
  }
}

export async function brainPost(odin: Odin, path: string, b: Record<string, unknown>, ask: (text: string) => Promise<{ text: string; answeredBy?: string }>): Promise<unknown> {
  const v = vaultOf(odin), s = (x: unknown) => String(x ?? '');
  try {
    switch (path) {
      case '/api/brain/save': {
        const n = v.find(s(b.path));
        const meta = (b.meta && typeof b.meta === 'object' ? b.meta : n?.meta ?? {}) as NoteMeta;
        const p = v.write(n?.path ?? s(b.path), meta, odin.redactor.redact(s(b.body)));
        return { ok: true, path: p };
      }
      case '/api/brain/create': {
        const type = TYPES[s(b.type)] ? s(b.type) : 'note';
        return { ok: true, path: v.create(s(b.title) || 'Sans titre', type, s(b.body), (b.meta ?? {}) as NoteMeta) };
      }
      case '/api/brain/rename': return { ok: true, path: v.rename(s(b.path), s(b.to)) };
      case '/api/brain/trash': return { ok: true, path: v.trash(s(b.path)) };
      case '/api/brain/restore': return { ok: true, path: v.restore(s(b.file)) };
      case '/api/brain/daily': return { ok: true, path: v.daily(), date: isoDay(new Date()) };
      case '/api/brain/capture': {
        const src = s(b.source).trim();
        if (!src) return { ok: false, error: 'rien à capturer' };
        const r = await ask(`Capture ceci dans mon Cerveau avec cerveau_capturer${b.projet ? ` (projet : ${s(b.projet)})` : ''} : ${src}`);
        return { ok: true, text: r.text };
      }
      case '/api/brain/ask': {
        const question = s(b.question).trim();
        if (!question) return { ok: false, error: 'question vide' };
        const r = await ask(`${question}\n\n[Précision d'Odin pour lui-même : réponds en t'appuyant sur le Cerveau (cerveau_chercher puis cerveau_lire), cite chaque source en [[Titre]] ; si ce n'est pas dans le Cerveau, dis-le.${b.note ? ` Page ouverte : ${s(b.note)}.` : ''}]`);
        const sources = [...new Set([...r.text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim()))].map((t) => ({ title: t, path: v.find(t)?.path })).filter((x) => x.path);
        return { ok: true, text: r.text, sources, answeredBy: r.answeredBy };
      }
      default: return undefined;
    }
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
