// API de l'espace Cerveau (interface web) : pages, graphe, bases, recherche, corbeille, capture,
// questions au cerveau. Tout passe par le coffre Markdown ; capturer et demander passent par l'agent
// (donc par Heimdall), dans une conversation à part « web:cerveau ».

import { isoDay, sourceOf, TYPES, type NoteMeta } from '../brain/vault.ts';
import type { Odin } from '../runtime.ts';
import { brainOf } from '../tools/brain.ts';

const vaultOf = (odin: Odin) => brainOf({ home: odin.paths.home, careCfg: odin.cfg, workspace: odin.paths.workspace });

/** État d'un connecteur : actif (configuré et en marche), coupé (configuré mais désactivé), à configurer, ou
 *  intégré (rien à régler : il marche dès l'installation). Un connecteur n'est jamais dit « actif » sans être configuré. */
export type ConnState = 'actif' | 'coupé' | 'à configurer' | 'intégré';
export interface Connector { id: string; label: string; on: boolean; state: ConnState; notes: number; what: string; how: string }

/** Connecteurs d'Odin qui alimentent le Cerveau, avec leur état réel et le nombre de notes venues d'eux. */
export function connectors(odin: Pick<Odin, 'cfg'>, counts: Map<string, number> = new Map(), env: NodeJS.ProcessEnv = process.env): Connector[] {
  const ch = (odin.cfg.channels ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const cfg = odin.cfg as unknown as Record<string, Record<string, unknown> | undefined>;
  const c = (k: string) => counts.get(k) ?? 0;
  const has = (k: string) => Boolean(String(env[k] ?? '').trim());
  const owners = (x: Record<string, unknown> | undefined) => Array.isArray(x?.owners) && (x!.owners as unknown[]).length > 0;
  /** configuré + activé → actif ; configuré seulement → coupé ; sinon à configurer */
  const st = (configured: boolean, enabled = true): ConnState => (configured ? (enabled ? 'actif' : 'coupé') : 'à configurer');
  const tg = ch.telegram, wa = ch.whatsapp, sg = ch.signal, ml = cfg.mail, cal = cfg.calendar;
  const list: Array<Omit<Connector, 'on' | 'notes'> & { key?: string }> = [
    { id: 'Discussion', label: 'Discussion', state: 'actif', what: 'ce que tu dis à Odin', how: '' },
    { id: 'Telegram', label: 'Telegram', state: st(has(String(tg?.tokenEnv ?? 'TELEGRAM_BOT_TOKEN')) && owners(tg), Boolean(tg?.enabled)), what: 'messages, vocaux, photos, fichiers', how: 'Réglages → Telegram' },
    { id: 'WhatsApp', label: 'WhatsApp', state: st(has('WHATSAPP_TOKEN') && Boolean(wa?.phoneId), Boolean(wa?.enabled)), what: 'messages et pièces jointes', how: 'Réglages → WhatsApp' },
    { id: 'Signal', label: 'Signal', state: st(Boolean(sg?.url) && Boolean(sg?.number), Boolean(sg?.enabled)), what: 'messages et pièces jointes', how: 'Réglages → Signal' },
    { id: 'Mail', label: 'Mail', state: st(Boolean(ml?.imapHost) && Boolean(ml?.user) && has('MAIL_PASSWORD')), what: 'mails importants, pièces jointes', how: 'Réglages → Mail' },
    { id: 'Agenda', label: 'Agenda', state: st(Boolean(cal?.caldavUrl) || has('CALENDAR_ICS_URL')), what: 'réunions, rendez-vous', how: 'Réglages → Agenda' },
    { id: 'YouTube', label: 'YouTube', state: 'intégré', what: 'vidéos résumées et transcrites', how: '' },
    { id: 'TikTok', label: 'TikTok', state: 'intégré', what: 'vidéos résumées et transcrites', how: '' },
    { id: 'Instagram', label: 'Instagram', state: 'intégré', what: 'reels et publications', how: '' },
    { id: 'X', label: 'X', state: 'intégré', what: 'publications', how: '' },
    { id: 'Web', label: 'Pages web', state: 'intégré', what: 'articles et pages, résumés', how: '' },
    { id: 'Fichiers', label: 'Fichiers', state: 'intégré', what: 'PDF, Word, Excel, images', how: '' },
    { id: 'Vocal', label: 'Vocaux', state: 'intégré', what: 'idées dictées', how: '' },
    { id: 'GitHub', label: 'GitHub', state: st(has('GITHUB_TOKEN') || has('GH_TOKEN')), what: 'dépôts et outils', how: 'Réglages → Coffre : GITHUB_TOKEN' },
    { id: 'Draupnir', label: 'Draupnir', key: 'Automatisation', state: 'intégré', what: 'automatisations : formulaires, flux, pages surveillées, webhooks', how: '' },
    { id: 'Notion', label: 'Import Notion', state: st(has('NOTION_TOKEN')), what: 'pages importées depuis un compte Notion', how: 'Réglages → Coffre : NOTION_TOKEN' },
  ];
  return list.map(({ key, ...x }) => ({ ...x, on: x.state === 'actif', notes: c(key ?? x.id) }));
}
function connectorsOf(odin: Odin): Connector[] {
  const counts = new Map<string, number>();
  for (const n of vaultOf(odin).all()) { const s = sourceOf(n); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
  return connectors(odin, counts);
}

export function brainGet(odin: Odin, path: string, q: URLSearchParams): unknown {
  const v = vaultOf(odin);
  switch (path) {
    case '/api/brain/tree': return { ok: true, root: v.root, notes: v.all().map((n) => ({ path: n.path, title: n.title, type: String(n.meta.type ?? (n.path.startsWith('Journal/') ? 'journal' : 'note')), mtime: n.mtime, tags: n.tags.slice(0, 6), favori: n.meta.favori === true, icone: n.meta.icone ?? '' })), types: TYPES, stats: v.stats(), trash: v.trashed().slice(0, 50), connectors: connectorsOf(odin) };
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
