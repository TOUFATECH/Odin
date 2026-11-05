// Collecte des pages pour la recherche : comportement de navigateur ordinaire et poli (en-têtes d'un
// vrai Chrome, langue française, cookies gardés par site, rythme humain avec pauses variables, une
// seule requête à la fois par site, respect des « 429 / Retry-After »). Pages dynamiques : le vrai
// navigateur d'Odin prend le relais. PDF : texte extrait (pdftotext, sinon extraction simple).
// Odin ne contourne pas les protections (captcha, connexion) : si un site refuse, il passe à une autre source.

import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { inflateSync } from 'node:zlib';
import { assertPublicUrl, isPrivateHost } from '../heimdall/policy.ts';

export const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8',
  'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.7,en;q=0.6',
  'sec-ch-ua': '"Chromium";v="141", "Google Chrome";v="141", "Not?A_Brand";v="24"',
  'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'none', 'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

// ---------------- Rythme humain par site ----------------

const lastHit = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();
const jar = new Map<string, Map<string, string>>();
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((r, j) => { const t = setTimeout(r, ms); signal?.addEventListener('abort', () => { clearTimeout(t); j(new Error('interrompu')); }, { once: true }); });
/** Pause entre deux pages d'un même site : 1,5 à 4 s, comme une personne qui lit. */
export const humanPause = (rand = Math.random) => 1500 + Math.floor(rand() * 2500);

/** Une requête à la fois par site, avec une pause variable depuis la précédente. */
async function paced<T>(host: string, f: () => Promise<T>, signal?: AbortSignal, pause = humanPause): Promise<T> {
  const prev = queues.get(host) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const wait = (lastHit.get(host) ?? 0) + pause() - Date.now();
    if (wait > 0) await sleep(wait, signal);
    try { return await f(); } finally { lastHit.set(host, Date.now()); }
  });
  queues.set(host, run);
  return run as Promise<T>;
}

function cookies(host: string): string { return [...(jar.get(host) ?? new Map()).entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
function keepCookies(host: string, res: Response): void {
  const set = res.headers.getSetCookie?.() ?? [];
  if (!set.length) return;
  const m = jar.get(host) ?? new Map<string, string>();
  for (const c of set) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) m.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
  jar.set(host, m);
}

export interface Page {
  url: string; finalUrl: string; status: number; kind: 'html' | 'pdf' | 'texte';
  title: string; text: string; author?: string; published?: string; siteName?: string;
  links: string[]; accessed: string; via: 'http' | 'navigateur' | 'extrait du moteur';
}

/** Récupère une page publique, poliment. Lève une erreur si le site refuse. */
export async function politeFetch(raw: string, o: { signal?: AbortSignal; pause?: () => number; fetcher?: typeof fetch; allowPrivate?: boolean } = {}): Promise<Page> {
  const f = o.fetcher ?? fetch;
  let url = o.allowPrivate ? new URL(raw) : assertPublicUrl(raw);
  const accessed = new Date().toISOString();
  for (let hop = 0; hop < 5; hop++) {
    const a = await lookup(url.hostname, { all: true });
    if (!o.allowPrivate && a.some((x) => isPrivateHost(x.address))) throw new Error(`${url.hostname} pointe vers un réseau interne`);
    if (a.some((x) => /^(::ffff:)?169\.254\.169\.254$|^fd00:ec2::254$/i.test(x.address))) throw new Error('adresse de métadonnées cloud refusée');
    const host = url.hostname;
    let res: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await paced(host, () => f(url, { redirect: 'manual', headers: { ...BROWSER_HEADERS, ...(cookies(host) ? { cookie: cookies(host) } : {}) }, signal: AbortSignal.any([...(o.signal ? [o.signal] : []), AbortSignal.timeout(25_000)]) }), o.signal, o.pause);
      keepCookies(host, res);
      if (res.status !== 429 && res.status !== 503) break;
      // Trop de requêtes : on attend ce que le site demande (60 s max), puis on réessaie.
      const ra = Number(res.headers.get('retry-after')) || 5 * (attempt + 1);
      await sleep(Math.min(60, ra) * 1000, o.signal);
    }
    if (res!.status >= 300 && res!.status < 400 && res!.headers.get('location')) { url = o.allowPrivate ? new URL(res!.headers.get('location')!, url) : assertPublicUrl(new URL(res!.headers.get('location')!, url).toString()); continue; }
    const type = res!.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res!.arrayBuffer()).subarray(0, 15 * 1024 * 1024);
    if (res!.status >= 400) throw new Error(`${host} refuse (HTTP ${res!.status})`);
    if (/pdf/i.test(type) || buf.subarray(0, 5).toString('latin1') === '%PDF-') {
      const text = await pdfText(buf);
      return { url: raw, finalUrl: url.toString(), status: res!.status, kind: 'pdf', title: pdfTitle(buf) || decodeURIComponent(url.pathname.split('/').pop() ?? ''), text, links: [], accessed, via: 'http' };
    }
    const body = buf.toString('utf8');
    if (/html/i.test(type) || /^\s*</.test(body)) return { ...extractArticle(body, url.toString()), url: raw, finalUrl: url.toString(), status: res!.status, kind: 'html', accessed, via: 'http' };
    return { url: raw, finalUrl: url.toString(), status: res!.status, kind: 'texte', title: url.pathname, text: body.slice(0, 200_000), links: [], accessed, via: 'http' };
  }
  throw new Error('trop de redirections');
}

/** Page « vide » à la lecture simple (application JavaScript, page de vérification) : le navigateur fera mieux. */
export const needsBrowser = (p: Page) => p.kind === 'html' && p.text.length < 400;

// ---------------- Extraction du texte principal (à la Trafilatura) ----------------

const ent = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const strip = (h: string) => ent(h.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
const meta = (html: string, ...names: string[]) => {
  for (const n of names) {
    const m = new RegExp(`<meta[^>]+(?:name|property|itemprop)=["']${n}["'][^>]*content=["']([^"']+)["']`, 'i').exec(html) ?? new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property|itemprop)=["']${n}["']`, 'i').exec(html);
    if (m) return ent(m[1]).trim();
  }
  return undefined;
};

/** Titre, auteur, date de publication, site, texte principal et liens sortants d'une page HTML (pur, testable). */
export function extractArticle(html: string, base: string): Pick<Page, 'title' | 'text' | 'author' | 'published' | 'siteName' | 'links'> {
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => { try { const j = JSON.parse(m[1]) as unknown; return Array.isArray(j) ? j : [(j as { '@graph'?: unknown[] })['@graph'] ?? j].flat(); } catch { return []; } }) as Array<Record<string, unknown>>;
  const art = ld.find((x) => /Article|Report|NewsArticle|BlogPosting|WebPage/.test(String(x['@type'] ?? ''))) ?? {};
  const ldAuthor = art.author as { name?: string } | Array<{ name?: string }> | string | undefined;
  const author = meta(html, 'author', 'article:author', 'dc.creator', 'parsely-author') ?? (typeof ldAuthor === 'string' ? ldAuthor : Array.isArray(ldAuthor) ? ldAuthor.map((a) => a.name).filter(Boolean).join(', ') : ldAuthor?.name) ?? undefined;
  const published = meta(html, 'article:published_time', 'datePublished', 'date', 'dc.date', 'publish-date', 'og:published_time', 'article:modified_time')
    ?? (art.datePublished as string | undefined) ?? /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1] ?? /\/(20\d{2})\/(\d{2})\/(\d{2})\//.exec(base)?.slice(1).join('-');
  const title = meta(html, 'og:title', 'twitter:title') ?? strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '') ?? '';
  const siteName = meta(html, 'og:site_name', 'application-name');
  // Retire ce qui n'est pas le contenu (menus, pubs, pieds de page, formulaires, commentaires).
  let h = html.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|template|button|select)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(div|section|ul)[^>]+(?:class|id)=["'][^"']*(?:cookie|consent|newsletter|share|social|comment|related|sidebar|menu|breadcrumb|advert|pub-|promo)[^"']*["'][\s\S]*?<\/\1>/gi, ' ');
  const zone = /<article[\s\S]*?<\/article>/i.exec(h)?.[0] ?? /<main[\s\S]*?<\/main>/i.exec(h)?.[0] ?? /<div[^>]+(?:class|id)=["'][^"']*(?:content|article|post|entry|story|texte)[^"']*["'][\s\S]*$/i.exec(h)?.[0] ?? h;
  h = zone;
  const blocks = [...h.matchAll(/<(h[1-4]|p|li|blockquote|td|pre)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ tag: m[1].toLowerCase(), t: strip(m[2]) })).filter((b) => b.t.length > (b.tag.startsWith('h') ? 3 : 40) || (b.tag === 'li' && b.t.length > 15));
  const text = (blocks.length >= 3 ? blocks.map((b) => (b.tag.startsWith('h') ? `\n## ${b.t}` : b.tag === 'li' ? `- ${b.t}` : b.t)).join('\n') : strip(h)).replace(/\n{3,}/g, '\n\n').trim().slice(0, 200_000);
  const links = [...new Set([...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)].map((m) => { try { return new URL(ent(m[1]), base).toString(); } catch { return ''; } }).filter((u) => /^https?:/.test(u)))].slice(0, 400);
  return { title: title.slice(0, 300), text, author: author?.slice(0, 120), published: normalizeDate(published), siteName, links };
}

export function normalizeDate(d?: string): string | undefined {
  if (!d) return undefined;
  const t = Date.parse(d);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

// ---------------- PDF ----------------

const run = (cmd: string, args: string[], input: Buffer) => new Promise<string | undefined>((res) => {
  const p = execFile(cmd, args, { maxBuffer: 50 << 20, timeout: 60_000 }, (e, out) => res(e ? undefined : out));
  p.stdin?.end(input);
});
/** Texte d'un PDF : pdftotext (poppler) s'il est là, sinon extraction simple des flux de texte. */
export async function pdfText(buf: Buffer): Promise<string> {
  return ((await run('pdftotext', ['-layout', '-enc', 'UTF-8', '-', '-'], buf)) ?? naivePdfText(buf)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 300_000);
}
export function pdfTitle(buf: Buffer): string { return /\/Title\s*\(([^)]{3,200})\)/.exec(buf.toString('latin1'))?.[1] ?? ''; }
/** Extraction de secours, sans dépendance : flux compressés (Flate) puis opérateurs Tj / TJ. */
export function naivePdfText(buf: Buffer): string {
  const raw = buf.toString('latin1'), out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let s = m[1];
    try { s = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { /* flux non compressé */ }
    for (const t of s.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj|\[((?:\((?:\\.|[^\\)])*\)|[^\]])*)\]\s*TJ/g)) {
      const parts = [...t[0].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((p) => p[1].replace(/\\([0-7]{1,3})/g, (_x, o: string) => String.fromCharCode(parseInt(o, 8))).replace(/\\([nrt()\\])/g, (_x, c: string) => ({ n: '\n', r: '', t: ' ' } as Record<string, string>)[c] ?? c));
      out.push(parts.join(''));
    }
    out.push('\n');
  }
  return out.join(' ').replace(/ *\n */g, '\n');
}
