// Collecte des pages pour la recherche : comportement de navigateur ordinaire et poli (en-têtes d'un
// vrai Chrome, langue française, cookies gardés par site, rythme humain avec pauses variables, une
// seule requête à la fois par site, respect des « 429 / Retry-After »). Pages dynamiques : le vrai
// navigateur d'Odin prend le relais. PDF : texte extrait (pdftotext, sinon extraction simple).
// Odin ne contourne pas les protections (captcha, connexion) : si un site refuse, il passe à une autre source.

import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { inflateSync } from 'node:zlib';
import { assertPublicUrl, isPrivateHost } from '../heimdall/policy.ts';
import { classerErreur } from '../net/fetch-propre.ts';

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
  /** La page dépassait la taille lue au plus : la fin n'a pas été lue (à dire dans les limites). */
  tronquee?: boolean;
}

/** Ce qu'une recherche vérifiée accepte d'attendre et de lire pour UNE page (le reste du temps va aux autres sources). */
export const LECTURE_RECHERCHE = { essais: 2, attenteMaxMs: 3000, maxOctetsHtml: 1_000_000 } as const;

/** Lit le corps d'une réponse sans dépasser `max` octets (le reste n'est pas téléchargé). */
async function corpsBorne(res: Response, max: number): Promise<{ buf: Buffer; coupe: boolean }> {
  if (!res.body) { const b = Buffer.from(await res.arrayBuffer()); return { buf: b.subarray(0, max), coupe: b.length > max }; }
  const reader = res.body.getReader(), parts: Uint8Array[] = [];
  let n = 0, coupe = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); n += value.length;
    if (n > max) { coupe = true; await reader.cancel().catch(() => undefined); break; }
  }
  return { buf: Buffer.concat(parts).subarray(0, max), coupe };
}

/**
 * Récupère une page publique, poliment. Lève une erreur si le site refuse.
 * `essais` : tentatives en tout quand le site dit « trop de requêtes » (429/503), 3 par défaut ; `attenteMaxMs` : attente
 * maximale avant de réessayer (60 s par défaut) ; `maxOctetsHtml` : taille lue au plus pour une page HTML (15 Mo par
 * défaut ; une page énorme bloquerait Odin pendant son analyse). Les PDF gardent leur limite de 15 Mo.
 */
export async function politeFetch(raw: string, o: { signal?: AbortSignal; pause?: () => number; fetcher?: typeof fetch; allowPrivate?: boolean; essais?: number; attenteMaxMs?: number; maxOctetsHtml?: number } = {}): Promise<Page> {
  const f = o.fetcher ?? fetch;
  let url = o.allowPrivate ? new URL(raw) : assertPublicUrl(raw);
  const accessed = new Date().toISOString();
  for (let hop = 0; hop < 5; hop++) {
    const a = await lookup(url.hostname, { all: true });
    if (!o.allowPrivate && a.some((x) => isPrivateHost(x.address))) throw new Error(`${url.hostname} pointe vers un réseau interne`);
    if (a.some((x) => /^(::ffff:)?169\.254\.169\.254$|^fd00:ec2::254$/i.test(x.address))) throw new Error('adresse de métadonnées cloud refusée');
    const host = url.hostname;
    let res: Response | undefined;
    const essais = Math.max(1, o.essais ?? 3), attenteMax = o.attenteMaxMs ?? 60_000;
    for (let attempt = 0; attempt < essais; attempt++) {
      try { res = await paced(host, () => f(url, { redirect: 'manual', headers: { ...BROWSER_HEADERS, ...(cookies(host) ? { cookie: cookies(host) } : {}) }, signal: AbortSignal.any([...(o.signal ? [o.signal] : []), AbortSignal.timeout(25_000)]) }), o.signal, o.pause); }
      catch (e) { if ((e as Error).name === 'AbortError' && o.signal?.aborted) throw e; throw new Error(classerErreur(e, host).message); }
      keepCookies(host, res);
      if (res.status !== 429 && res.status !== 503) break;
      if (attempt === essais - 1) break; // plus d'essai : le refus est rendu tel quel (« refuse (HTTP 429) »)
      // Trop de requêtes : on attend ce que le site demande (dans la limite permise), puis on réessaie.
      const ra = Number(res.headers.get('retry-after')) || 5 * (attempt + 1);
      await res.body?.cancel().catch(() => undefined);
      await sleep(Math.min(attenteMax, ra * 1000), o.signal);
    }
    if (res!.status >= 300 && res!.status < 400 && res!.headers.get('location')) { url = o.allowPrivate ? new URL(res!.headers.get('location')!, url) : assertPublicUrl(new URL(res!.headers.get('location')!, url).toString()); continue; }
    const type = res!.headers.get('content-type') ?? '';
    const { buf, coupe } = await corpsBorne(res!, /html/i.test(type) && !/pdf/i.test(type) ? Math.min(o.maxOctetsHtml ?? 15 * 1024 * 1024, 15 * 1024 * 1024) : 15 * 1024 * 1024);
    if (res!.status >= 400) throw new Error(`${host} refuse (HTTP ${res!.status})`);
    if (/pdf/i.test(type) || buf.subarray(0, 5).toString('latin1') === '%PDF-') {
      const text = await pdfText(buf);
      return { url: raw, finalUrl: url.toString(), status: res!.status, kind: 'pdf', title: pdfTitle(buf) || decodeURIComponent(url.pathname.split('/').pop() ?? ''), text, links: [], accessed, via: 'http' };
    }
    const body = buf.toString('utf8');
    if (/html/i.test(type) || /^\s*</.test(body)) return { ...extractArticle(body, url.toString()), url: raw, finalUrl: url.toString(), status: res!.status, kind: 'html', accessed, via: 'http', ...(coupe ? { tronquee: true } : {}) };
    return { url: raw, finalUrl: url.toString(), status: res!.status, kind: 'texte', title: url.pathname, text: body.slice(0, 200_000), links: [], accessed, via: 'http' };
  }
  throw new Error('trop de redirections');
}

/** Page « vide » à la lecture simple (application JavaScript, page de vérification) : le navigateur fera mieux. */
export const needsBrowser = (p: Page) => p.kind === 'html' && p.text.length < 400;

// ---------------- Extraction du texte principal (à la Trafilatura) ----------------

/**
 * Un caractère d'une entité numérique, comme avant (« &#0; » et les demi-caractères compris) ; SEUL un numéro impossible
 * (« &#99999999; », au-delà de U+10FFFF), qui faisait lever une exception, donne désormais « � ».
 */
const point = (n: number): string => (Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '�');
const ent = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => point(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => point(parseInt(n, 16)));

// Une page est une donnée HOSTILE : aucune recherche ci-dessous ne reparcourt le reste du document pour chaque balise
// ouverte (des balises jamais fermées figeaient Odin : 2 Mo de « <p> » = 46 s). Les balises et leurs fermetures sont
// repérées une fois (temps linéaire), puis retrouvées par recherche dichotomique ; sur une page normale, le résultat
// est le même qu'avec les expressions d'origine (essais de non-régression : test/extraction-pages.test.ts).
/** Les positions de `motif` (en minuscules) dans `bas`, dans l'ordre. */
function positions(bas: string, motif: string): number[] {
  const out: number[] = [];
  for (let i = bas.indexOf(motif); i >= 0; i = bas.indexOf(motif, i + motif.length)) out.push(i);
  return out;
}
/** La première position ≥ x d'une liste triée (−1 s'il n'y en a pas). */
function premierApres(l: number[], x: number): number {
  let a = 0, b = l.length;
  while (a < b) { const m = (a + b) >> 1; if (l[m] < x) a = m + 1; else b = m; }
  return a < l.length ? l[a] : -1;
}
/** Retire les balises (comme /<[^>]+>/g → ' '), en temps linéaire. */
function sansBalises(h: string): string {
  const out: string[] = [];
  let pos = 0;
  for (;;) {
    const i = h.indexOf('<', pos);
    if (i < 0) break;
    const gt = h.indexOf('>', i + 1);
    if (gt < 0) break; // plus aucune balise fermée : le reste est du texte
    if (gt === i + 1) { out.push(h.slice(pos, i + 1)); pos = i + 1; continue; } // « <> » n'est pas une balise
    out.push(h.slice(pos, i), ' ');
    pos = gt + 1;
  }
  out.push(h.slice(pos));
  return out.join('');
}
const strip = (h: string) => ent(sansBalises(h.replace(/<br\s*\/?>/gi, '\n'))).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
/**
 * Les balises ouvrantes `<nom…>` dans l'ordre (position, fin, texte borné). Un `<nom` qui se trouve DANS la balise
 * précédente n'est pas une nouvelle balise ; après une balise jamais fermée, plus aucune balise ne l'est : on s'arrête.
 */
function balises(html: string, bas: string, nom: string, gts: number[]): Array<{ i: number; gt: number; t: string }> {
  const out: Array<{ i: number; gt: number; t: string }> = [];
  let apres = 0;
  for (const i of positions(bas, `<${nom}`)) {
    if (i < apres) continue;
    const gt = premierApres(gts, i + nom.length + 1);
    // La balise ENTIÈRE (jamais coupée) : les balises sont disjointes, et chaque examen ci-dessous est linéaire.
    out.push({ i, gt, t: html.slice(i, gt < 0 ? html.length : gt + 1) });
    if (gt < 0) break;
    apres = gt + 1;
  }
  return out;
}
/**
 * Ce que contient une balise <meta…> pour la lecture des métadonnées, repéré UNE fois et en temps linéaire : les
 * attributs « name/property/itemprop=" » (début du mot, début de la valeur) et « content=" » (valeur, guillemet de fin).
 */
interface Attrs { tl: string; noms: Array<{ p: number; v: number }>; contenus: Array<{ c: number; v: number; q: number }> }
const QUOTE = (ch: string | undefined) => ch === '"' || ch === "'";
function attrsMeta(b: { t: string; a?: Attrs }): Attrs {
  if (b.a) return b.a;
  const t = b.t, tl = t.toLowerCase(), noms: Attrs['noms'] = [], contenus: Attrs['contenus'] = [];
  // le guillemet suivant (« " » ou « ' ») de chaque position, calculé de droite à gauche
  const suivant = new Int32Array(t.length + 1).fill(-1);
  for (let i = t.length - 1; i >= 0; i--) suivant[i] = QUOTE(t[i]) ? i : suivant[i + 1];
  for (const kw of ['name', 'property', 'itemprop']) {
    for (let p = tl.indexOf(kw, 6); p >= 0; p = tl.indexOf(kw, p + 1)) if (tl[p + kw.length] === '=' && QUOTE(tl[p + kw.length + 1])) noms.push({ p, v: p + kw.length + 2 });
  }
  noms.sort((x, y) => x.p - y.p);
  for (let c = tl.indexOf('content=', 6); c >= 0; c = tl.indexOf('content=', c + 1)) {
    if (!QUOTE(tl[c + 8])) continue;
    const q = suivant[c + 9] ?? -1;
    if (q > c + 9) contenus.push({ c, v: c + 9, q });
  }
  return (b.a = { tl, noms, contenus });
}
/** Le texte de l'attribut à partir de v est-il ce nom (« . » vaut n'importe quel caractère sauf saut de ligne, comme avant) ? */
const estNom = (tl: string, v: number, n: string) => {
  for (let k = 0; k < n.length; k++) { const ch = tl[v + k]; if (ch === undefined || (n[k] === '.' ? /[\n\r\u2028\u2029]/.test(ch) : ch !== n[k])) return false; }
  return QUOTE(tl[v + n.length]);
};
/**
 * La valeur « content » d'une <meta> nommée `n`, EXACTEMENT comme les deux expressions d'origine
 * `<meta[^>]+(?:name|property|itemprop)=["']n["'][^>]*content=["']([^"']+)["']` puis `<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property|itemprop)=["']n["']`
 * (insensibles à la casse, gourmandes), mais en temps linéaire : une balise démesurée ne coûte plus un temps quadratique.
 */
const meta = (metas: Array<{ t: string; a?: Attrs }>, ...names: string[]) => {
  for (const nom of names) {
    const n = nom.toLowerCase();
    let val: string | undefined;
    // 1) le nom, puis un « content » après lui : le DERNIER content valable, si un nom valable finit avant lui
    for (const b of metas) {
      const a = attrsMeta(b), cmax = a.contenus[a.contenus.length - 1];
      if (!cmax) continue;
      if (a.noms.some((x) => estNom(a.tl, x.v, n) && x.v + n.length + 1 <= cmax.c)) { val = b.t.slice(cmax.v, cmax.q); break; }
    }
    // 2) « content », puis le nom après lui : le DERNIER content qui finit avant le dernier nom valable
    if (val === undefined) for (const b of metas) {
      const a = attrsMeta(b);
      let pmax = -1; for (const x of a.noms) if (estNom(a.tl, x.v, n)) pmax = Math.max(pmax, x.p);
      if (pmax < 0) continue;
      let c: Attrs['contenus'][number] | undefined; for (const x of a.contenus) if (x.q + 1 <= pmax) c = x;
      if (c) { val = b.t.slice(c.v, c.q); break; }
    }
    if (val !== undefined) return ent(val).trim();
  }
  return undefined;
};
const RETIRER = ['script', 'style', 'noscript', 'svg', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', 'template', 'button', 'select'];
const CADRES = ['div', 'section', 'ul'];
const ATTR_CADRE = /^[^>]+(?:class|id)=["'][^"']*(?:cookie|consent|newsletter|share|social|comment|related|sidebar|menu|breadcrumb|advert|pub-|promo)[^"']*["']/i;
const ATTR_CONTENU = /^<div[^>]+(?:class|id)=["'][^"']*(?:content|article|post|entry|story|texte)[^"']*["']/i;
const BLOCS = ['p', 'li', 'blockquote', 'td', 'pre'];
/**
 * Retire chaque bloc `<nom …</nom>` (jusqu'à la première fermeture qui suit), de gauche à droite, comme
 * `replace(/<(noms)[\s\S]*?<\/\1>/gi, ' ')`. `depuis` dit où chercher la fermeture (ou undefined : pas ce bloc-là).
 */
function retirerBlocs(html: string, noms: string[], depuis: (i: number, nom: string, gts: number[]) => number | undefined = (i, n) => i + 1 + n.length): string {
  const bas = html.toLowerCase(), gts = positions(bas, '>');
  const fermetures = new Map(noms.map((n) => [n, positions(bas, `</${n}>`)]));
  const out: string[] = [];
  let pos = 0, i = bas.indexOf('<');
  while (i >= 0) {
    let fin = -1;
    for (const n of noms) {
      if (!bas.startsWith(n, i + 1)) continue;
      const d = depuis(i, n, gts);
      if (d === undefined) continue;
      const c = premierApres(fermetures.get(n)!, d);
      if (c >= 0) { fin = c + n.length + 3; break; }
    }
    if (fin >= 0) { out.push(html.slice(pos, i), ' '); pos = fin; i = bas.indexOf('<', fin); } else i = bas.indexOf('<', i + 1);
  }
  out.push(html.slice(pos));
  return out.join('');
}

/** Titre, auteur, date de publication, site, texte principal et liens sortants d'une page HTML (pur, testable). */
export function extractArticle(html: string, base: string): Pick<Page, 'title' | 'text' | 'author' | 'published' | 'siteName' | 'links'> {
  const bas = html.toLowerCase(), gts = positions(bas, '>');
  const metas = balises(html, bas, 'meta', gts);
  // Données structurées : chaque <script … application/ld+json …>, jusqu'à sa première fermeture.
  const blocsLd: string[] = [];
  const fermeturesScript = positions(bas, '</script>');
  let apres = 0;
  for (const b of balises(html, bas, 'script', gts)) {
    if (b.i < apres || b.gt < 0 || !/^<script[^>]+application\/ld\+json[^>]*>/i.test(b.t)) continue;
    const c = premierApres(fermeturesScript, b.gt + 1);
    if (c < 0) break;
    blocsLd.push(html.slice(b.gt + 1, c)); apres = c + 9;
  }
  const ld = blocsLd.flatMap((t) => { try { const j = JSON.parse(t) as unknown; return Array.isArray(j) ? j : [(j as { '@graph'?: unknown[] })['@graph'] ?? j].flat(); } catch { return []; } }) as Array<Record<string, unknown>>;
  const art = ld.find((x) => /Article|Report|NewsArticle|BlogPosting|WebPage/.test(String(x['@type'] ?? ''))) ?? {};
  const ldAuthor = art.author as { name?: string } | Array<{ name?: string }> | string | undefined;
  const author = meta(metas, 'author', 'article:author', 'dc.creator', 'parsely-author') ?? (typeof ldAuthor === 'string' ? ldAuthor : Array.isArray(ldAuthor) ? ldAuthor.map((a) => a.name).filter(Boolean).join(', ') : ldAuthor?.name) ?? undefined;
  const temps = (() => { for (const b of balises(html, bas, 'time', gts)) { const m = /^<time[^>]+datetime=["']([^"']+)["']/i.exec(b.t); if (m) return m[1]; } return undefined; })();
  const published = meta(metas, 'article:published_time', 'datePublished', 'date', 'dc.date', 'publish-date', 'og:published_time', 'article:modified_time')
    ?? (art.datePublished as string | undefined) ?? temps ?? /\/(20\d{2})\/(\d{2})\/(\d{2})\//.exec(base)?.slice(1).join('-');
  const titreBrut = (() => { const i = bas.indexOf('<title'); if (i < 0) return undefined; const gt = premierApres(gts, i + 6); if (gt < 0) return undefined; const c = bas.indexOf('</title>', gt + 1); return c < 0 ? undefined : html.slice(gt + 1, c); })();
  const title = meta(metas, 'og:title', 'twitter:title') ?? strip(titreBrut ?? '') ?? '';
  const siteName = meta(metas, 'og:site_name', 'application-name');
  // Retire ce qui n'est pas le contenu (menus, pubs, pieds de page, formulaires, commentaires).
  const sansCode = retirerBlocs(html, RETIRER);
  // Un cadre de menu, de publicité ou de partage (class/id). Sans « > » après lui, aucune fermeture n'est possible ;
  // un `<div` à l'intérieur d'une balise déjà examinée n'est pas réexaminé. La balise est lue entière (l'expression,
  // ancrée et à un seul quantificateur gourmand, est linéaire sur elle).
  let examineJusqua = -1;
  let h = retirerBlocs(sansCode, CADRES, (i, n, g) => {
    if (i < examineJusqua) return undefined;
    const debut = i + 1 + n.length, gt = premierApres(g, debut);
    if (gt < 0) { examineJusqua = Infinity; return undefined; }
    examineJusqua = gt;
    const m = ATTR_CADRE.exec(sansCode.slice(debut, gt));
    return m ? debut + m[0].length : undefined;
  });
  const hb = h.toLowerCase();
  const zone = (() => {
    for (const [o, f] of [['<article', '</article>'], ['<main', '</main>']] as const) {
      const i = hb.indexOf(o); if (i < 0) continue;
      const c = hb.indexOf(f, i + o.length); if (c >= 0) return h.slice(i, c + f.length);
    }
    for (const b of balises(h, hb, 'div', positions(hb, '>'))) if (ATTR_CONTENU.test(b.t)) return h.slice(b.i);
    return h;
  })();
  h = zone;
  // Les blocs de texte (<h1-4>, <p>, <li>, <blockquote>, <td>, <pre>), chacun jusqu'à sa première fermeture.
  const zb = h.toLowerCase(), zgts = positions(zb, '>');
  const fermes = new Map<string, number[]>();
  const fermeturesDe = (n: string): number[] => { let l = fermes.get(n); if (!l) { l = positions(zb, `</${n}>`); fermes.set(n, l); } return l; };
  const trouves: Array<{ tag: string; inner: string }> = [];
  for (let i = zb.indexOf('<'); i >= 0;) {
    const c1 = zb.charCodeAt(i + 2);
    const noms = [...(zb[i + 1] === 'h' && c1 >= 49 && c1 <= 52 ? [`h${String.fromCharCode(c1)}`] : []), ...BLOCS.filter((n) => zb.startsWith(n, i + 1))];
    let fin = -1;
    for (const n of noms) {
      const gt = premierApres(zgts, i + 1 + n.length); if (gt < 0) continue;
      const c = premierApres(fermeturesDe(n), gt + 1); if (c < 0) continue;
      trouves.push({ tag: n, inner: h.slice(gt + 1, c) }); fin = c + n.length + 3; break;
    }
    i = zb.indexOf('<', fin >= 0 ? fin : i + 1);
  }
  const blocks = trouves.map((m) => ({ tag: m.tag, t: strip(m.inner) })).filter((b) => b.t.length > (b.tag.startsWith('h') ? 3 : 40) || (b.tag === 'li' && b.t.length > 15));
  const text = (blocks.length >= 3 ? blocks.map((b) => (b.tag.startsWith('h') ? `\n## ${b.t}` : b.tag === 'li' ? `- ${b.t}` : b.t)).join('\n') : strip(h)).replace(/\n{3,}/g, '\n\n').trim().slice(0, 200_000);
  // Les liens : chaque <a …href="…"> (cherché dans la balise seulement).
  const hrefs: string[] = [];
  let curseur = 0;
  for (const i of positions(bas, '<a')) {
    if (i < curseur) continue;
    const gt = premierApres(gts, i + 2);
    const m = /^[^>]+href=["']([^"'#]+)["']/i.exec(html.slice(i + 2, gt < 0 ? html.length : gt));
    if (m) { hrefs.push(m[1]); curseur = i + 2 + m[0].length; }
    else if (gt < 0) break; // plus aucune balise fermée après : plus de lien
    else curseur = gt; // un `<a` dans cette même balise n'est pas un nouveau lien
  }
  const links = [...new Set(hrefs.map((u) => { try { return new URL(ent(u), base).toString(); } catch { return ''; } }).filter((u) => /^https?:/.test(u)))].slice(0, 400);
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
const PDF_FLUX = 16 * 1024 * 1024, PDF_TOTAL = 64 * 1024 * 1024;
/** Une chaîne PDF décodée (\\ooo en octal, \\n \\r \\t \\( \\) \\\\), comme avant. */
const chainePdf = (c: string) => c.replace(/\\([0-7]{1,3})/g, (_x, o: string) => String.fromCharCode(parseInt(o, 8))).replace(/\\([nrt()\\])/g, (_x, ch: string) => ({ n: '\n', r: '', t: ' ' } as Record<string, string>)[ch] ?? ch);
/**
 * Les textes des opérateurs `(…) Tj` et `[ … ] TJ` d'un flux, lus en UNE passe (temps linéaire : 256 Ko de « ( » ne
 * figent plus Odin). Une chaîne va de « ( » à SA parenthèse fermante : les parenthèses non échappées s'équilibrent,
 * comme le dit la norme PDF (avant, la chaîne s'arrêtait à la première « ) » : « (a(b)c) Tj » était perdu ; c'est le seul
 * cas où le texte lu change, et il n'existe que dans un flux qui imbrique des parenthèses). Dans un tableau TJ, une
 * « ( » sans fermante compte comme un caractère, et le tableau va jusqu'au premier « ] » hors chaîne.
 */
export function textesTj(s: string): string[] {
  const n = s.length;
  // 1) la parenthèse fermante de chaque « ( » (pile, échappements sautés) : -1 si elle n'en a pas
  const ferme = new Int32Array(n).fill(-1), pile: number[] = [];
  for (let i = 0; i < n; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 92 /* \\ */) { i++; continue; }
    if (ch === 40 /* ( */) pile.push(i);
    else if (ch === 41 /* ) */ && pile.length) ferme[pile.pop()!] = i;
  }
  // 2) depuis chaque position, le premier « ] » hors chaîne (calculé de droite à gauche)
  const crochet = new Int32Array(n + 1).fill(-1);
  for (let i = n - 1; i >= 0; i--) {
    const ch = s.charCodeAt(i);
    crochet[i] = ch === 93 /* ] */ ? i : ch === 40 && ferme[i] >= 0 ? crochet[ferme[i] + 1] : crochet[i + 1];
  }
  const blanc = (i: number) => { while (i < n && /\s/.test(s[i])) i++; return i; };
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 40 && ferme[i] >= 0) {
      const j = blanc(ferme[i] + 1);
      if (s.startsWith('Tj', j)) { out.push(chainePdf(s.slice(i + 1, ferme[i]))); i = j + 1; }
    } else if (ch === 91 /* [ */) {
      const c = crochet[i + 1];
      if (c < 0) continue;
      const j = blanc(c + 1);
      if (!s.startsWith('TJ', j)) continue;
      const parts: string[] = [];
      for (let k = i + 1; k < c; k++) if (s.charCodeAt(k) === 40 && ferme[k] >= 0 && ferme[k] < c) { parts.push(chainePdf(s.slice(k + 1, ferme[k]))); k = ferme[k]; }
      out.push(parts.join('')); i = j + 1;
    }
  }
  return out;
}
/** Extraction de secours, sans dépendance : flux compressés (Flate) puis opérateurs Tj / TJ. */
export function naivePdfText(buf: Buffer): string {
  const raw = buf.toString('latin1'), out: string[] = [];
  // Les flux « stream … endstream », trouvés en temps LINÉAIRE (un « stream » jamais fermé faisait tout reparcourir).
  const flux: string[] = [];
  const fins = positions(raw, '\nendstream');
  let apres = 0;
  for (const p of positions(raw, 'stream')) {
    if (p < apres) continue;
    const debut = raw[p + 6] === '\r' && raw[p + 7] === '\n' ? p + 8 : raw[p + 6] === '\n' ? p + 7 : -1;
    if (debut < 0) continue;
    const k = premierApres(fins, debut);
    if (k < 0) break;
    const fin = k - 1 >= debut && raw[k - 1] === '\r' ? k - 1 : k;
    flux.push(raw.slice(debut, fin)); apres = k + 10;
  }
  // La décompression est BORNÉE : 16 Mo par flux, 64 Mo pour tout le document (un petit PDF dont un flux se décompresse
  // en centaines de Mo ne remplit plus la mémoire ; au-delà, le flux est laissé tel quel, comme un flux non compressé).
  let decompresse = 0;
  for (const contenu of flux) {
    let s = contenu;
    if (decompresse < PDF_TOTAL) {
      try { const b = inflateSync(Buffer.from(contenu, 'latin1'), { maxOutputLength: Math.min(PDF_FLUX, PDF_TOTAL - decompresse) }); decompresse += b.length; s = b.toString('latin1'); } catch { /* flux non compressé, ou trop gros une fois décompressé */ }
    }
    for (const t of textesTj(s)) out.push(t);
    out.push('\n');
  }
  return out.join(' ').replace(/ *\n */g, '\n');
}
