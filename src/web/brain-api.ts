// API de l'espace Cerveau (interface web) : pages, graphe, bases, recherche, corbeille, capture,
// questions au cerveau. Tout passe par le coffre Markdown ; capturer et demander passent par l'agent
// (donc par Heimdall), dans une conversation à part « web:cerveau ».

import { isoDay, sourceOf, TYPES, type NoteMeta } from '../brain/vault.ts';
import type { Odin } from '../runtime.ts';
import { brainOf } from '../tools/brain.ts';

const vaultOf = (odin: Odin) => brainOf({ home: odin.paths.home, careCfg: odin.cfg, workspace: odin.paths.workspace });

/**
 * Connecteurs d'Odin qui alimentent le Cerveau, avec leur état VRAI et le nombre de notes venues d'eux :
 *  - « actif » : un compte à relier, et il est relié (Telegram avec son jeton, la boîte mail renseignée…),
 *    ou une source sans réglage qui a déjà servi ;
 *  - « prêt » : rien à régler, mais rien n'en est encore venu (il suffit d'envoyer un lien ou un fichier) ;
 *  - « non relié » : un compte à relier, pas encore fait.
 * (`on` = actif, gardé pour le graphe.)
 */
export type ConnectorState = 'actif' | 'pret' | 'non-relie';
export interface Connector { id: string; label: string; on: boolean; state: ConnectorState; notes: number; what: string; how: string }
export function connectorsOf(cfgIn: unknown, counts: Map<string, number>, env: NodeJS.ProcessEnv = process.env): Connector[] {
  const cfg = cfgIn as { channels?: Record<string, Record<string, unknown> | undefined>; mail?: Record<string, unknown>; calendar?: Record<string, unknown>; proactive?: { mail?: { enabled?: boolean } } };
  const ch = cfg.channels ?? {}, c = (k: string) => counts.get(k) ?? 0;
  const tok = (k: unknown, d: string) => Boolean(env[typeof k === 'string' && k ? k : d]);
  /** Un compte à relier : actif seulement s'il est vraiment relié. */
  const account = (id: string, label: string, linked: boolean, what: string, where: string, key = id): Connector => ({ id, label, on: linked, state: linked ? 'actif' : 'non-relie', notes: c(key), what, how: linked ? '' : `à relier dans ${where}` });
  /** Une source sans réglage : prête d'office, active dès qu'elle a servi. */
  const open = (id: string, label: string, what: string, how: string, key = id): Connector => ({ id, label, on: c(key) > 0, state: c(key) > 0 ? 'actif' : 'pret', notes: c(key), what, how: c(key) > 0 ? '' : how });
  return [
    { id: 'Discussion', label: 'Discussion', on: true, state: 'actif', notes: c('Discussion'), what: 'ce que tu dis à Odin', how: '' },
    account('Telegram', 'Telegram', Boolean(ch.telegram?.enabled) && tok(ch.telegram?.tokenEnv, 'TELEGRAM_BOT_TOKEN'), 'messages, vocaux, photos, fichiers', 'Réglages → Telegram'),
    account('WhatsApp', 'WhatsApp', Boolean(ch.whatsapp?.enabled) && Boolean(ch.whatsapp?.phoneId), 'messages et pièces jointes', 'Réglages → Messageries'),
    account('Signal', 'Signal', Boolean(ch.signal?.enabled) && Boolean(ch.signal?.url) && Boolean(ch.signal?.number), 'messages et pièces jointes', 'Réglages → Messageries'),
    account('Mail', 'Mail', Boolean(cfg.mail?.imapHost) && Boolean(cfg.mail?.user), 'mails importants, pièces jointes', 'Réglages → Mail'),
    // L'agenda se lit par son adresse iCal (gardée avec les secrets) et s'écrit par CalDAV : l'un des deux suffit.
    account('Agenda', 'Agenda', Boolean(env.CALENDAR_ICS_URL) || Boolean(cfg.calendar?.caldavUrl), 'réunions, rendez-vous', 'Réglages → Agenda'),
    open('YouTube', 'YouTube', 'vidéos résumées et transcrites', 'rien à régler : envoie-moi un lien'),
    open('TikTok', 'TikTok', 'vidéos résumées et transcrites', 'rien à régler : envoie-moi un lien'),
    open('Instagram', 'Instagram', 'reels et publications', 'rien à régler : envoie-moi un lien'),
    open('X', 'X', 'publications', 'rien à régler : envoie-moi un lien'),
    open('Web', 'Pages web', 'articles et pages, résumés', 'rien à régler : envoie-moi un lien'),
    open('Fichiers', 'Fichiers', 'PDF, Word, Excel, images', 'rien à régler : envoie-moi un fichier'),
    open('Vocal', 'Vocaux', 'idées dictées', 'rien à régler : dicte-moi une idée'),
    open('GitHub', 'GitHub', 'dépôts et outils', 'rien à régler : envoie-moi un lien de dépôt'),
    open('Draupnir', 'Draupnir', 'automatisations : formulaires, flux, pages surveillées, webhooks', 'rien à régler : crée une automatisation', 'Automatisation'),
    account('Notion', 'Import Notion', Boolean(env.NOTION_TOKEN), 'pages importées depuis un compte Notion', 'Réglages (clé Notion)'),
  ];
}
function connectors(odin: Odin): Connector[] {
  const counts = new Map<string, number>();
  for (const n of vaultOf(odin).all()) { const s = sourceOf(n); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
  return connectorsOf(odin.cfg, counts);
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
