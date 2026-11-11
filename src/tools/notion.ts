// notion : ton espace Notion relié au Cerveau, par l'API officielle de Notion (jeton d'intégration
// interne dans le coffre : NOTION_TOKEN ; partage les pages voulues avec l'intégration dans Notion).
//   chercher : pages et bases ; lire : une page en Markdown ; importer : une page → note du Cerveau ;
//   publier : une note du Cerveau → nouvelle page Notion (sous une page ou dans une base) ;
//   base : les lignes d'une base Notion (titre + propriétés).

import { wrapUntrusted } from '../heimdall/injection.ts';
import { brainOf } from './brain.ts';
import { obj, str, type Tool } from './registry.ts';

const s = (v: unknown) => String(v ?? '');
const API = 'https://api.notion.com/v1';
type Rich = Array<{ plain_text?: string; href?: string | null; annotations?: { bold?: boolean; italic?: boolean; code?: boolean; strikethrough?: boolean } }>;
interface Block { id: string; type: string; has_children?: boolean; [k: string]: unknown }

async function notion<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const tok = process.env.NOTION_TOKEN;
  if (!tok) throw new Error('jeton Notion absent : crée une intégration interne sur notion.so/my-integrations, mets son jeton dans le coffre (NOTION_TOKEN) et partage-lui tes pages');
  const r = await fetch(`${API}${path}`, { method: init.method ?? 'GET', headers: { authorization: `Bearer ${tok}`, 'Notion-Version': '2022-06-28', 'content-type': 'application/json' }, body: init.body ? JSON.stringify(init.body) : undefined, signal: init.signal ?? AbortSignal.timeout(30_000) });
  if (r.status === 401) throw new Error('jeton Notion refusé');
  if (r.status === 404) throw new Error('page introuvable : partage-la avec ton intégration dans Notion (… → Connexions)');
  if (!r.ok) throw new Error(`Notion : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return await r.json() as T;
}

/** Texte riche Notion → Markdown. Pur. */
export function richToMd(rt: Rich = []): string {
  return rt.map((t) => {
    let x = t.plain_text ?? '';
    if (!x.trim()) return x;
    const a = t.annotations ?? {};
    if (a.code) x = `\`${x}\``;
    if (a.bold) x = `**${x}**`;
    if (a.italic) x = `*${x}*`;
    if (a.strikethrough) x = `~~${x}~~`;
    if (t.href) x = `[${x}](${t.href})`;
    return x;
  }).join('');
}
/** Blocs Notion → Markdown (titres, listes, cases, citations, encadrés, code, séparateurs). Pur. */
export function blocksToMd(blocks: Block[], depth = 0): string {
  const pad = '  '.repeat(depth);
  let n = 0;
  return blocks.map((b) => {
    const d = (b[b.type] ?? {}) as { rich_text?: Rich; checked?: boolean; language?: string; icon?: { emoji?: string }; url?: string; title?: string };
    const t = richToMd(d.rich_text);
    const kids = Array.isArray(b.children) ? `\n${blocksToMd(b.children as Block[], depth + 1)}` : '';
    if (b.type !== 'numbered_list_item') n = 0;
    switch (b.type) {
      case 'heading_1': return `# ${t}`;
      case 'heading_2': return `## ${t}`;
      case 'heading_3': return `### ${t}`;
      case 'bulleted_list_item': return `${pad}- ${t}${kids}`;
      case 'numbered_list_item': return `${pad}${++n}. ${t}${kids}`;
      case 'to_do': return `${pad}- [${d.checked ? 'x' : ' '}] ${t}${kids}`;
      case 'quote': return `> ${t}`;
      case 'callout': return `> [!note] ${d.icon?.emoji ?? ''} ${t}`.trim();
      case 'code': return `\`\`\`${d.language ?? ''}\n${t}\n\`\`\``;
      case 'divider': return '---';
      case 'toggle': return `- ${t}${kids}`;
      case 'child_page': return `- 📄 ${d.title ?? ''}`;
      case 'bookmark': case 'embed': case 'link_preview': return d.url ? `<${d.url}>` : '';
      case 'paragraph': return `${pad}${t}${kids}`;
      default: return t;
    }
  }).join('\n');
}
/** Markdown (simple) → blocs Notion (100 au plus par envoi). Pur. */
export function mdToBlocks(md: string): unknown[] {
  const rt = (x: string) => [{ type: 'text', text: { content: x.slice(0, 1900) } }];
  const out: unknown[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length && out.length < 100; i++) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf: string[] = []; const lang = l.slice(3).trim(); i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); out.push({ type: 'code', code: { rich_text: rt(buf.join('\n')), language: lang || 'plain text' } }); continue; }
    let m;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(l))) out.push({ type: `heading_${m[1].length}`, [`heading_${m[1].length}`]: { rich_text: rt(m[2]) } });
    else if ((m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(l))) out.push({ type: 'to_do', to_do: { rich_text: rt(m[2]), checked: m[1] !== ' ' } });
    else if ((m = /^\s*[-*+]\s+(.*)$/.exec(l))) out.push({ type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(m[1]) } });
    else if ((m = /^\s*\d+\.\s+(.*)$/.exec(l))) out.push({ type: 'numbered_list_item', numbered_list_item: { rich_text: rt(m[1]) } });
    else if ((m = /^>\s?(.*)$/.exec(l))) out.push({ type: 'quote', quote: { rich_text: rt(m[1]) } });
    else if (/^\s*(---|\*\*\*)\s*$/.test(l)) out.push({ type: 'divider', divider: {} });
    else if (l.trim()) out.push({ type: 'paragraph', paragraph: { rich_text: rt(l.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a)) } });
  }
  return out;
}

const idOf = (x: string) => (/[0-9a-f]{32}|[0-9a-f-]{36}/i.exec(x.replace(/-/g, '').length >= 32 ? x : '')?.[0] ?? x).replace(/-/g, '');
const titleOf = (p: { properties?: Record<string, { type: string; title?: Rich }>; title?: Rich }) => richToMd(p.title ?? Object.values(p.properties ?? {}).find((v) => v.type === 'title')?.title) || 'Sans titre';
function propText(v: Record<string, unknown>): string {
  const t = String(v.type);
  const x = v[t] as unknown;
  if (Array.isArray(x)) return x.map((e) => (e as { plain_text?: string; name?: string }).plain_text ?? (e as { name?: string }).name ?? '').join(', ');
  if (x && typeof x === 'object') return String((x as { name?: string; start?: string }).name ?? (x as { start?: string }).start ?? '');
  return x === null || x === undefined ? '' : String(x);
}

async function readPage(id: string, signal?: AbortSignal): Promise<{ title: string; url: string; md: string; props: Record<string, string> }> {
  const page = await notion<{ url: string; properties: Record<string, Record<string, unknown>> }>(`/pages/${id}`, { signal });
  const children = async (bid: string, depth: number): Promise<Block[]> => {
    const all: Block[] = []; let cursor: string | undefined;
    do {
      const r = await notion<{ results: Block[]; next_cursor: string | null; has_more: boolean }>(`/blocks/${bid}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, { signal });
      for (const b of r.results) { if (b.has_children && depth < 2 && b.type !== 'child_page') b.children = await children(b.id, depth + 1); all.push(b); }
      cursor = r.has_more ? r.next_cursor ?? undefined : undefined;
    } while (cursor && all.length < 1000);
    return all;
  };
  const props: Record<string, string> = {};
  for (const [k, v] of Object.entries(page.properties)) if (v.type !== 'title') { const t = propText(v); if (t) props[k] = t.slice(0, 200); }
  return { title: titleOf(page as never), url: page.url, md: blocksToMd(await children(id, 0)), props };
}

export const notionTool: Tool = {
  name: 'notion',
  description: 'Ton espace Notion relié au Cerveau (API officielle). « chercher » : pages et bases par mot. « lire » : une page (lien ou id) en Markdown. « importer » : une page Notion → note du Cerveau (propriétés gardées, source notée). « publier » : une note du Cerveau → nouvelle page Notion, sous une page parente ou dans une base (id ou lien). « base » : les lignes d\'une base (titre + propriétés).',
  risk: 'network',
  schema: obj({ action: { type: 'string', enum: ['chercher', 'lire', 'importer', 'publier', 'base'] }, cible: str('mot cherché, lien ou id de page/base, ou note du Cerveau (publier)'), parent: str('publier : lien ou id de la page parente ou de la base') }, ['action', 'cible']),
  summarize: (i) => `Notion ${s(i.action)} ${s(i.cible).slice(0, 80)}`,
  lookup: (i) => ['chercher', 'lire', 'base'].includes(s(i.action)),
  async run(i, ctx) {
    const a = s(i.action), c = s(i.cible).trim();
    if (a === 'chercher') {
      const r = await notion<{ results: Array<{ object: string; id: string; url: string; properties?: never; title?: Rich; last_edited_time: string }> }>('/search', { method: 'POST', body: { query: c, page_size: 20 }, signal: ctx.signal });
      return r.results.length ? wrapUntrusted('notion', r.results.map((p) => `- ${p.object === 'database' ? '🗂 base' : '📄'} ${titleOf(p as never)} · ${p.url} · modifiée le ${p.last_edited_time.slice(0, 10)}`).join('\n')) : `Rien dans Notion pour « ${c} » (vérifie que les pages sont partagées avec ton intégration).`;
    }
    if (a === 'lire' || a === 'importer') {
      const p = await readPage(idOf(c), ctx.signal);
      if (a === 'lire') return { output: wrapUntrusted(`notion ${p.title}`, `# ${p.title}\n${Object.entries(p.props).map(([k, v]) => `${k} : ${v}`).join('\n')}\n\n${p.md}`.slice(0, 40_000)), tainted: true };
      const v = brainOf(ctx);
      const path = v.write(`Notion/${p.title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim().slice(0, 120) || 'Sans titre'}`, { type: 'ressource', source: p.url, importé: new Date().toISOString().slice(0, 10), fiable: false, ...p.props }, p.md);
      return `✓ Importé dans le Cerveau : ${path}`;
    }
    if (a === 'publier') {
      const n = brainOf(ctx).find(c);
      if (!n) return `Note du Cerveau introuvable : « ${c} ».`;
      const parentId = idOf(s(i.parent));
      if (!parentId) return 'Donne la page parente ou la base Notion (lien ou id) où publier.';
      // Base ou page ? On essaie la base d'abord (le titre va dans sa colonne titre).
      const db = await notion<{ properties: Record<string, { type: string }> }>(`/databases/${parentId}`, { signal: ctx.signal }).catch(() => undefined);
      const titleKey = db ? Object.entries(db.properties).find(([, v]) => v.type === 'title')?.[0] ?? 'Name' : 'title';
      const body = { parent: db ? { database_id: parentId } : { page_id: parentId }, properties: { [titleKey]: { title: [{ type: 'text', text: { content: n.title } }] } }, children: mdToBlocks(ctx.redactor.redact(n.body)) };
      const page = await notion<{ url: string }>('/pages', { method: 'POST', body, signal: ctx.signal });
      brainOf(ctx).write(n.path, { ...n.meta, notion: page.url }, n.body);
      return `✓ Publié dans Notion : ${page.url}`;
    }
    if (a === 'base') {
      const r = await notion<{ results: Array<{ url: string; properties: Record<string, Record<string, unknown>> }> }>(`/databases/${idOf(c)}/query`, { method: 'POST', body: { page_size: 100 }, signal: ctx.signal });
      return wrapUntrusted('notion', r.results.map((p) => `- ${titleOf(p as never)} · ${Object.entries(p.properties).filter(([, v]) => v.type !== 'title').map(([k, v]) => `${k}: ${propText(v)}`).filter((x) => !x.endsWith(': ')).join(' · ')}`).join('\n') || 'Base vide.');
    }
    return 'action inconnue';
  },
};
