// Banc « questions et recherche sur le web » : le FAUX WEB LOCAL. Rien ne sort de la machine.
//
// Les pages fabriquées (pages.json : fiches, articles, forums, annonces, pages périmées, homonymes, pages piégées, pages qui
// se contredisent, en français, anglais, espagnol, allemand et japonais) sont servies par un petit serveur HTTP sur
// 127.0.0.1, derrière deux sortes de moteurs :
//   - la PAGE DE RÉSULTATS d'un grand moteur (format de la page HTML de DuckDuckGo) : c'est ce que lit Lyncée, le moteur
//     d'Odin, chemin par défaut de Pythie. Wikipédia, Wikidata et les réponses instantanées répondent « rien » (les noms
//     du banc sont inventés : un vrai Wikipédia ne les connaît pas) ; Brave, Yahoo et Bing rendent une page sans résultat ;
//   - un moteur au format SearXNG (JSON), pour qui veut mesurer Pythie branchée sur une instance.
//
// Adresses : chaque page a une adresse canonique NEUTRE https://<site>.example.org/a/<numéro> (ni la langue ni la sorte de
// page ne s'y lisent). Pour une question, le moteur rend ces adresses avec un JETON dans le nom d'hôte
// (https://<site>--t17.example.org/a/…) : le journal de la question (requêtes envoyées, pages lues) se tient par jeton, et
// la pause « humaine » que le produit marque entre deux pages d'un même site ne s'étend pas d'une question à l'autre. Les
// moteurs sans jeton dans leur adresse (DuckDuckGo, Wikipédia…) écrivent au journal du jeton COURANT (`poserJeton`).
//
// Réseau coupé (`brancherReseau`) : seuls les noms en .example.org se résolvent, vers 192.0.2.1 (adresse de
// documentation, jamais routée) ; `fetch` ne laisse passer que le faux web ; toute connexion TCP (donc aussi TLS et
// node:http) hors de 127.0.0.1, tout envoi UDP et toute résolution DNS directe (resolve*, reverse) sont refusés et comptés
// (`refusees`).
//
// Le moteur : BM25 sur le titre (compté deux fois) et le texte de chaque page, jetons « lettres latines et chiffres »
// d'un côté, autres écritures de l'autre, multiplié par le POIDS de la page (tiré une fois pour toutes à la fabrique, comme
// la notoriété d'un site : la bonne page n'est pas toujours première). Extrait : le paragraphe qui partage le plus de mots
// avec la requête (240 signes au plus). Le texte caché d'une page (consigne piégée) est indexé : un vrai moteur le voit aussi.
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import dnsp from 'node:dns/promises';
import dns from 'node:dns';
import net from 'node:net';
import dgram from 'node:dgram';

export interface Paragraphe { t: string; cache?: boolean; consigne?: boolean }
export interface PageFaite { id: string; url: string; site: string; langue: string; sorte: string; titre: string; paragraphes: Paragraphe[]; publie: string; poids?: number; jeu?: string }
export interface Toile { version: number; origine: string; pages: PageFaite[] }
export interface Journal { requetes: Array<{ q: string; langue?: string; moteur?: string }>; lues: string[] }
export interface FauxWeb {
  port: number; base: string; toile: Toile; parId: Map<string, PageFaite>; parUrl: Map<string, PageFaite>;
  /** Le fetch du faux web : seules ses adresses (et les moteurs imités) passent. */
  fetcher: typeof fetch;
  journal(jeton: string): Journal;
  /** Le jeton de la question en cours (journal des moteurs qui n'ont pas de jeton dans leur adresse). */
  poserJeton(jeton: string): void;
  /** Les adresses refusées (hors du faux web) depuis le démarrage. */
  refusees: string[];
  /** Adresse canonique (sans jeton) → identifiant de page, ou undefined. */
  pageDe(url: string): string | undefined;
  /** Adresse d'une page vue par une question (avec son jeton). */
  adresse(pageId: string, jeton: string): string;
  chercher(q: string, n?: number): Array<{ page: PageFaite; score: number; extrait: string }>;
  fermer(): Promise<void>;
}

export const CHEMIN_PAGES = new URL('./pages.json', import.meta.url);
export function lireToile(chemin: URL | string = CHEMIN_PAGES): Toile { return JSON.parse(readFileSync(chemin, 'utf8')) as Toile; }
/** Adresse rendue par le faux DNS : 192.0.2.1 (TEST-NET-1, réservée à la documentation, jamais routée). */
export const ADRESSE_FAUSSE = '192.0.2.1';

// ------------------------------------------------------------------------------------------------ pur : texte et moteur
export const replier = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
/** Jetons d'un texte : suites latines/chiffres d'un côté, suites d'autres lettres de l'autre. */
export function jetons(s: string): string[] { return replier(s).match(/[a-z0-9]+|[^\s\p{P}\p{S}a-z0-9]+/gu) ?? []; }
const echapper = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** La page en HTML (titre, auteur, date de publication, paragraphes ; un paragraphe caché a `display:none`). */
export function html(p: PageFaite): string {
  const corps = p.paragraphes.map((x) => (x.cache ? `<p style="display:none">${echapper(x.t)}</p>` : `<p>${echapper(x.t)}</p>`)).join('\n');
  const annonce = p.sorte === 'pub' ? ' class="annonce sponsorisee"' : '';
  return `<!doctype html><html lang="${p.langue}"><head><meta charset="utf-8"><title>${echapper(p.titre)}</title><meta name="author" content="Rédaction ${echapper(p.site)}"><meta property="article:published_time" content="${p.publie}T09:00:00Z"></head><body><nav>Accueil · Rubriques · Contact</nav><article${annonce}><h1>${echapper(p.titre)}</h1>\n${corps}\n</article><footer>© ${echapper(p.site)}</footer></body></html>`;
}

export class Moteur {
  private docs: Array<{ page: PageFaite; tf: Map<string, number>; long: number }> = [];
  private df = new Map<string, number>();
  private moyenne = 1;
  constructor(pages: PageFaite[]) {
    for (const page of pages) {
      const tf = new Map<string, number>();
      const ts = [...jetons(page.titre), ...jetons(page.titre), ...page.paragraphes.flatMap((x) => jetons(x.t))];
      for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ page, tf, long: ts.length });
    }
    this.moyenne = this.docs.reduce((s, d) => s + d.long, 0) / Math.max(1, this.docs.length);
  }
  chercher(q: string, n = 8): Array<{ page: PageFaite; score: number; extrait: string }> {
    const qs = [...new Set(jetons(q))], N = this.docs.length, k1 = 1.2, b = 0.75;
    const out: Array<{ page: PageFaite; score: number; extrait: string }> = [];
    for (const d of this.docs) {
      let s = 0;
      for (const t of qs) {
        const f = d.tf.get(t); if (!f) continue;
        const df = this.df.get(t) ?? 0, idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.long / this.moyenne));
      }
      if (s > 0) out.push({ page: d.page, score: s * (d.page.poids ?? 1), extrait: '' });
    }
    out.sort((x, y) => y.score - x.score || (x.page.id < y.page.id ? -1 : 1));
    return out.slice(0, n).map((r) => ({ ...r, extrait: extrait(r.page, qs) }));
  }
}
/** Le paragraphe qui partage le plus de jetons avec la requête (le premier en cas d'égalité), 240 signes au plus. */
export function extrait(p: PageFaite, qs: string[]): string {
  let best = p.paragraphes[0]?.t ?? '', bs = -1;
  for (const x of p.paragraphes) { const j = new Set(jetons(x.t)); const s = qs.filter((t) => j.has(t)).length; if (s > bs) { bs = s; best = x.t; } }
  return best.slice(0, 240);
}
/** La page de résultats imitée (structure de la page HTML de DuckDuckGo : blocs « result », liens « result__a »). */
export function pageResultats(rs: Array<{ titre: string; url: string; extrait: string }>): string {
  const blocs = rs.map((r) => `<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="${echapper(r.url)}">${echapper(r.titre)}</a></h2><a class="result__snippet" href="${echapper(r.url)}">${echapper(r.extrait)}</a></div></div>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>résultats</title></head><body><div id="links" class="results">${blocs.join('\n')}</div></body></html>`;
}

// ------------------------------------------------------------------------------------------------ adresses
const HOTE = /^https?:\/\/([a-z0-9-]+?)--(t[0-9a-z]+)\.example\.org(\/[^?#]*)?/i;
const HOTE_NU = /^https?:\/\/([a-z0-9-]+)\.example\.org(\/[^?#]*)?/i;
/** Retire le jeton d'une adresse vue par une question. */
export function sansJeton(url: string): string { return url.replace(/^(https?:\/\/[a-z0-9-]+?)--t[0-9a-z]+(\.example\.org)/i, '$1$2'); }
export function avecJeton(url: string, jeton: string): string { return url.replace(/^(https?:\/\/[a-z0-9-]+?)(\.example\.org)/i, `$1--${jeton}$2`); }
const canon = (u: string) => sansJeton(u).replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
/** Les moteurs imités, par nom d'hôte. */
const MOTEURS_IMITES = new Set(['html.duckduckgo.com', 'lite.duckduckgo.com', 'search.brave.com', 'search.yahoo.com', 'www.bing.com', 'fr.wikipedia.org', 'www.wikidata.org', 'api.duckduckgo.com']);

// ------------------------------------------------------------------------------------------------ le serveur
export async function demarrerFauxWeb(toile: Toile = lireToile()): Promise<FauxWeb> {
  const parId = new Map(toile.pages.map((p) => [p.id, p])), parUrl = new Map(toile.pages.map((p) => [canon(p.url), p]));
  const moteur = new Moteur(toile.pages);
  const journaux = new Map<string, Journal>();
  let courant = 't0';
  const journal = (j: string) => { let x = journaux.get(j); if (!x) journaux.set(j, (x = { requetes: [], lues: [] })); return x; };
  const serveur: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const envoyer = (code: number, type: string, corps: string) => { res.writeHead(code, { 'content-type': `${type}; charset=utf-8` }); res.end(corps); };
    const [, quoi, a, ...reste] = u.pathname.split('/');
    // Le moteur au format SearXNG : /moteur/<jeton>/search?q=…&format=json
    if (quoi === 'moteur' && reste[0] === 'search') {
      const q = u.searchParams.get('q') ?? '';
      journal(a).requetes.push({ q, moteur: 'searxng', ...(u.searchParams.get('language') ? { langue: u.searchParams.get('language')! } : {}) });
      const results = moteur.chercher(q).map((r) => ({ title: r.page.titre, url: avecJeton(r.page.url, a), content: r.extrait, engines: ['moteur du banc'] }));
      return envoyer(200, 'application/json', JSON.stringify({ query: q, results, answers: [], suggestions: [], unresponsive_engines: [] }));
    }
    // Une page : /site/<hôte sans jeton>/<chemin>?jeton=…
    if (quoi === 'site') {
      const p = parUrl.get(canon(`https://${a}.example.org/${reste.join('/')}`));
      const j = u.searchParams.get('jeton') ?? '';
      if (!p) return envoyer(404, 'text/html', '<!doctype html><title>Introuvable</title><p>Cette page n\'existe pas.</p>');
      if (j) journal(j).lues.push(p.id);
      return envoyer(200, 'text/html', html(p));
    }
    envoyer(404, 'text/plain', 'inconnu');
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', () => ok()));
  const port = (serveur.address() as { port: number }).port, base = `http://127.0.0.1:${port}`;
  const refusees: string[] = [];
  const origine = globalThis.fetch;
  const repondre = (corps: string, type: string, statut = 200) => new Response(corps, { status: statut, headers: { 'content-type': `${type}; charset=utf-8` } });
  /** Un moteur imité : la requête est notée au journal du jeton courant, la réponse vient du moteur du banc (ou est vide). */
  async function imiter(url: URL, init?: RequestInit): Promise<Response> {
    const h = url.hostname;
    let q = '', langue: string | undefined;
    if (h.endsWith('duckduckgo.com') && h !== 'api.duckduckgo.com') {
      const corps = new URLSearchParams(typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '');
      q = corps.get('q') ?? url.searchParams.get('q') ?? ''; langue = (corps.get('kl') ?? url.searchParams.get('kl') ?? '').split('-').pop() || undefined;
      journal(courant).requetes.push({ q, moteur: h, ...(langue ? { langue } : {}) });
      if (h === 'lite.duckduckgo.com') return repondre('<!doctype html><html><body><table></table></body></html>', 'text/html');
      return repondre(pageResultats(moteur.chercher(q, 10).map((r) => ({ titre: r.page.titre, url: avecJeton(r.page.url, courant), extrait: r.extrait }))), 'text/html');
    }
    q = url.searchParams.get('q') ?? url.searchParams.get('p') ?? url.searchParams.get('srsearch') ?? url.searchParams.get('search') ?? '';
    langue = h === 'fr.wikipedia.org' || h === 'www.wikidata.org' ? 'fr' : (url.searchParams.get('setlang') ?? url.searchParams.get('kl') ?? '').split('-')[0] || undefined;
    if (q) journal(courant).requetes.push({ q, moteur: h, ...(langue ? { langue } : {}) });
    if (h === 'fr.wikipedia.org') return repondre(JSON.stringify({ batchcomplete: '', query: { searchinfo: { totalhits: 0 }, search: [] } }), 'application/json');
    if (h === 'www.wikidata.org') return repondre(JSON.stringify({ search: [], success: 1 }), 'application/json');
    if (h === 'api.duckduckgo.com') return repondre(JSON.stringify({ AbstractText: '', AbstractURL: '', Heading: '', Answer: '', RelatedTopics: [] }), 'application/json');
    return repondre('<!doctype html><html><head><title>résultats</title></head><body><main></main></body></html>', 'text/html');
  }
  const fetcher = (async (entree: string | URL | Request, init?: RequestInit) => {
    const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.toString() : entree.url;
    const m = HOTE.exec(url);
    if (m) return origine(`${base}/site/${m[1].toLowerCase()}${m[3] ?? '/'}?jeton=${encodeURIComponent(m[2].toLowerCase())}`, init);
    const nu = HOTE_NU.exec(url);
    if (nu) return origine(`${base}/site/${nu[1].toLowerCase()}${nu[2] ?? '/'}?jeton=${encodeURIComponent(courant)}`, init);
    if (url.startsWith(`${base}/`)) return origine(url, init);
    let u: URL | undefined; try { u = new URL(url); } catch { /* illisible */ }
    if (u && u.protocol === 'https:' && MOTEURS_IMITES.has(u.hostname)) return imiter(u, init);
    refusees.push(url.slice(0, 200));
    throw new Error('banc : réseau coupé (adresse hors du faux web)');
  }) as typeof fetch;
  return {
    port, base, toile, parId, parUrl, fetcher, refusees,
    journal: (j) => { const x = journal(j); return { requetes: [...x.requetes], lues: [...x.lues] }; },
    poserJeton: (j) => { courant = j; },
    pageDe: (url) => parUrl.get(canon(url))?.id,
    adresse: (id, j) => avecJeton(parId.get(id)!.url, j),
    chercher: (q, n) => moteur.chercher(q, n),
    fermer: () => new Promise<void>((ok) => { serveur.closeAllConnections?.(); serveur.close(() => ok()); }),
  };
}

// ------------------------------------------------------------------------------------------------ réseau coupé
const LOCAL = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);
const RESOLVE = ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];
/** La destination d'un appel à `net.Socket.prototype.connect` (toutes ses formes). */
function destination(args: unknown[]): { host?: string; port?: unknown; path?: string } {
  let a0 = args[0];
  if (Array.isArray(a0)) a0 = a0[0];
  if (a0 && typeof a0 === 'object') { const o = a0 as { host?: string; port?: unknown; path?: string }; return { host: o.host, port: o.port, path: o.path }; }
  if (typeof a0 === 'number' || (typeof a0 === 'string' && /^\d+$/.test(a0))) return { port: a0, host: typeof args[1] === 'string' ? args[1] : undefined };
  if (typeof a0 === 'string') return { path: a0 };
  return {};
}
/**
 * Coupe le réseau de tout le processus (voir l'en-tête). Rend la fonction qui remet tout comme avant.
 */
export function brancherReseau(w: Pick<FauxWeb, 'fetcher' | 'refusees'>): () => void {
  const faux = (h: string) => /\.example\.org$/i.test(h);
  const refus = (quoi: string, code = 'ENOTFOUND') => Object.assign(new Error(`banc : réseau coupé (${quoi})`), { code });
  const avant: Array<[object, string, unknown]> = [];
  const remplacer = (o: object, k: string, f: unknown) => { avant.push([o, k, (o as Record<string, unknown>)[k]]); (o as Record<string, unknown>)[k] = f; };
  remplacer(dnsp, 'lookup', async (h: string, o?: { all?: boolean }) => {
    if (!faux(h)) { w.refusees.push(`dns:${h}`); throw refus(`nom « ${h} » non résolu`); }
    const a = { address: ADRESSE_FAUSSE, family: 4 }; return o?.all ? [a] : a;
  });
  remplacer(dns, 'lookup', (h: string, o: unknown, cb?: unknown) => {
    const f = (typeof o === 'function' ? o : cb) as (e: Error | null, a?: unknown, fam?: number) => void;
    if (!faux(h)) { w.refusees.push(`dns:${h}`); return process.nextTick(() => f(refus(`nom « ${h} » non résolu`))); }
    const all = typeof o === 'object' && o !== null && (o as { all?: boolean }).all;
    process.nextTick(() => (all ? f(null, [{ address: ADRESSE_FAUSSE, family: 4 }]) : f(null, ADRESSE_FAUSSE, 4)));
  });
  for (const k of RESOLVE) {
    if (typeof (dns as unknown as Record<string, unknown>)[k] === 'function') remplacer(dns, k, (h: string, ...r: unknown[]) => { w.refusees.push(`dns-${k}:${h}`); const cb = r.find((x) => typeof x === 'function') as ((e: Error) => void) | undefined; if (cb) process.nextTick(() => cb(refus(`résolution directe de « ${h} »`))); });
    if (typeof (dnsp as unknown as Record<string, unknown>)[k] === 'function') remplacer(dnsp, k, async (h: string) => { w.refusees.push(`dns-${k}:${h}`); throw refus(`résolution directe de « ${h} »`); });
    for (const R of [dns.Resolver.prototype, dnsp.Resolver.prototype]) if (typeof (R as unknown as Record<string, unknown>)[k] === 'function') remplacer(R, k, function (h: string, ...r: unknown[]) { w.refusees.push(`dns-${k}:${h}`); const cb = r.find((x) => typeof x === 'function') as ((e: Error) => void) | undefined; if (cb) { process.nextTick(() => cb(refus(`résolution directe de « ${h} »`))); return undefined; } return Promise.reject(refus(`résolution directe de « ${h} »`)); });
  }
  const connecter = net.Socket.prototype.connect;
  remplacer(net.Socket.prototype, 'connect', function (this: net.Socket, ...args: unknown[]) {
    const d = destination(args);
    if (d.path || LOCAL.has(String(d.host ?? 'localhost').toLowerCase())) return (connecter as (...a: unknown[]) => net.Socket).apply(this, args);
    w.refusees.push(`tcp:${d.host}:${String(d.port ?? '')}`);
    const e = refus(`connexion vers ${d.host}:${String(d.port ?? '')} refusée`, 'ECONNREFUSED');
    process.nextTick(() => this.destroy(e));
    return this;
  });
  remplacer(dgram.Socket.prototype, 'send', function (this: dgram.Socket, ...args: unknown[]) {
    w.refusees.push('udp');
    const cb = args.find((x) => typeof x === 'function') as ((e: Error) => void) | undefined, e = refus('envoi UDP refusé', 'ECONNREFUSED');
    process.nextTick(() => (cb ? cb(e) : this.emit('error', e)));
  });
  syncBuiltinESMExports();
  const fetchG = globalThis.fetch;
  globalThis.fetch = w.fetcher;
  return () => {
    for (const [o, k, f] of avant.reverse()) (o as Record<string, unknown>)[k] = f;
    syncBuiltinESMExports(); globalThis.fetch = fetchG;
  };
}
