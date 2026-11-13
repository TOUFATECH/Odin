// Völva · la recherche : une question en français, plusieurs moteurs interrogés ensemble (ton SearXNG, qui
// réunit Google, Bing, DuckDuckGo, Qwant, Startpage, Mojeek, Yahoo…, plus Brave, Wikipédia, Tavily, Exa selon
// tes clés), résultats fusionnés et dédoublonnés, pages lues, réponse rédigée par l'IA réglée dans Odin avec
// des sources numérotées cliquables, questions de suite, et les applis d'Odin qui peuvent agir sur le sujet.
// Toutes les recherches d'Odin passent par Völva quand il est réglé. Reprend les idées de Perplexica (Vane),
// Perplexity et SearXNG (piloté à côté, jamais copié : SearXNG est sous AGPL).
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { politeFetch } from '../../research/fetch.ts';
import { webSearch, type SearchProvider, type SearchResult } from '../../tools/search.ts';
import { valhallaOf } from '../odin.ts';
import { extractive, finish, FOCUS, fuse, parseInstant, parseSearx, parseWikipedia, prompt, toMarkdown, type Focus, type Source } from '../volva/engine.ts';
import type { ModCtx, Module, Param } from '../types.ts';

const s = (v: unknown) => String(v ?? '');
/** Les moteurs que Völva sait interroger, et ce qu'il faut pour chacun. */
export const ENGINES: Record<string, { label: string; need?: string; env?: string[]; note?: string; keyless?: boolean }> = {
  searxng: { label: 'SearXNG (Google, Bing, DuckDuckGo, Qwant, Startpage, Mojeek, Yahoo…)', need: 'ton instance SearXNG (« Installer SearXNG » la lance à côté d\'Odin)', note: 'SearXNG interroge ces moteurs comme un navigateur : leurs conditions d\'usage s\'appliquent ; garde un usage personnel et raisonnable.' },
  brave: { label: 'Brave Search', env: ['BRAVE_API_KEY'], note: 'clé gratuite avec 5 $ de crédit par mois (environ 1 000 recherches)' },
  wikipedia: { label: 'Wikipédia', keyless: true },
  duckduckgo_ia: { label: 'DuckDuckGo (réponses instantanées)', keyless: true },
  tavily: { label: 'Tavily', env: ['TAVILY_API_KEY'] },
  exa: { label: 'Exa (recherche par le sens)', env: ['EXA_API_KEY'] },
  google: { label: 'Google (Programmable Search)', env: ['GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX'], note: 'fermé aux nouveaux clients ; Google l\'arrête le 1er janvier 2027 : passe par SearXNG' },
  duckduckgo: { label: 'DuckDuckGo (page web)', keyless: true, note: 'secours sans clé' },
  mojeek: { label: 'Mojeek (page web)', keyless: true, note: 'secours sans clé' },
};
export interface Entry { id: string; at: number; q: string; focus: Focus; answer: string; sources: Source[]; engines: string[]; followups: string[]; apps: Array<{ id: string; name: string; action?: string; label?: string }>; ai: boolean; errors: string[]; read?: number; essentials?: Array<{ title: string; detail?: string }>; thread?: string }

let cfg: () => { searxngUrl?: string } = () => ({});
const searxUrl = (ctx: ModCtx) => (s(ctx.settings.searxng) || cfg().searxngUrl || '').replace(/\/$/, '');
const ready = (ctx: ModCtx, e: string) => (e === 'searxng' ? Boolean(searxUrl(ctx)) : (ENGINES[e]?.env ?? []).every((k) => process.env[k]));
/** Les moteurs actifs : ceux choisis et prêts ; par défaut tous ceux qui sont prêts (les pages web en secours seulement). */
export function activeEngines(ctx: ModCtx): string[] {
  const chosen = ctx.settings.moteurs as string[] | undefined;
  const list = (chosen ?? Object.keys(ENGINES).filter((e) => !['duckduckgo', 'mojeek'].includes(e))).filter((e) => ENGINES[e] && ready(ctx, e));
  return list.some((e) => !['wikipedia', 'duckduckgo_ia'].includes(e)) || chosen ? list : [...list, 'duckduckgo'];
}
const histFile = (ctx: ModCtx) => join(ctx.dir, 'historique.json');
export function history(ctx: ModCtx): Entry[] { try { return JSON.parse(readFileSync(histFile(ctx), 'utf8')) as Entry[]; } catch { return []; } }
function saveHistory(ctx: ModCtx, l: Entry[]): void { try { mkdirSync(ctx.dir, { recursive: true }); writeFileSync(histFile(ctx), JSON.stringify(l.slice(0, Math.max(10, Math.min(1000, Number(ctx.settings.garder) || 200))))); } catch { /* disque plein */ } }

/** Interroge les moteurs actifs, ensemble. */
export async function gather(ctx: ModCtx, q: string, focus: Focus = 'tout', n = 8): Promise<{ lists: Array<{ engine: string; results: SearchResult[] }>; errors: string[]; answers: string[]; suggestions: string[] }> {
  const errors: string[] = [], answers: string[] = [], suggestions: string[] = [], f = ctx.fetch as typeof fetch, signal = AbortSignal.timeout(15_000);
  const query = FOCUS[focus].hint ? `${q} ${FOCUS[focus].hint}` : q;
  const lists = await Promise.all(activeEngines(ctx).map(async (e): Promise<{ engine: string; results: SearchResult[] }> => {
    try {
      if (e === 'searxng') {
        const u = `${searxUrl(ctx)}/search?q=${encodeURIComponent(query)}&format=json&language=fr&categories=${FOCUS[focus].searx}${focus === 'actualites' ? '&time_range=week' : ''}`;
        const r = await f(u, { headers: { accept: 'application/json' }, signal }); if (!r.ok) throw new Error(r.status === 403 ? 'format json non activé dans settings.yml' : `HTTP ${r.status}`);
        const d = parseSearx(await r.json()); answers.push(...d.answers); suggestions.push(...d.suggestions); if (d.unresponsive.length) errors.push(`SearXNG : sans réponse de ${d.unresponsive.slice(0, 4).join(', ')}`);
        return { engine: 'SearXNG', results: d.results };
      }
      if (e === 'wikipedia') { const r = await f(`https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=5&format=json&utf8=1`, { headers: { 'user-agent': 'Odin-Volva/1 (assistant personnel)' }, signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return { engine: 'Wikipédia', results: parseWikipedia(await r.json()) }; }
      if (e === 'duckduckgo_ia') { const r = await f(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&kl=fr-fr`, { signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return { engine: 'DuckDuckGo', results: parseInstant(await r.json()) }; }
      const r = await webSearch(query, n, { provider: e as SearchProvider, searxngUrl: searxUrl(ctx), fetcher: f, signal });
      return { engine: ENGINES[e].label.split(' (')[0], results: r.results };
    } catch (err) { errors.push(`${ENGINES[e]?.label.split(' (')[0] ?? e} : ${(err as Error).message.slice(0, 120)}`); return { engine: e, results: [] }; }
  }));
  return { lists, errors, answers: [...new Set(answers)].slice(0, 3), suggestions: [...new Set(suggestions)].slice(0, 5) };
}
/** Résultats fusionnés seulement (pour l'outil de recherche d'Odin), sans IA. */
export async function volvaResults(q: string, n = 8): Promise<{ engines: string[]; results: SearchResult[] } | undefined> {
  const v = valhallaOf(); if (!v?.module('volva')) return undefined;
  const ctx = v.ctx('volva'); if (ctx.settings.pourOdin === false || !activeEngines(ctx).length) return undefined;
  const g = await gather(ctx, q, 'tout', n), src = fuse(g.lists, n);
  if (!src.length) return undefined;
  return { engines: [...new Set(src.flatMap((x) => x.engines))], results: src.map((x) => ({ title: x.title, url: x.url, snippet: `${x.snippet}${x.engines.length > 1 ? ` [${x.engines.join(', ')}]` : ''}` })) };
}

/** Une recherche complète : moteurs, fusion, lecture des pages, réponse sourcée, suites, applis d'Odin. */
export async function ask(ctx: ModCtx, q: string, o: { focus?: Focus; deep?: boolean; thread?: string; read?: boolean } = {}): Promise<Entry> {
  const focus = o.focus && FOCUS[o.focus] ? o.focus : 'tout', deep = Boolean(o.deep);
  const prev = o.thread ? history(ctx).filter((h) => h.thread === o.thread || h.id === o.thread).reverse() : [];
  const g = await gather(ctx, q, focus, deep ? 10 : 8), sources = fuse(g.lists, deep ? 12 : 8);
  // Lire les meilleures pages (texte seulement, sites publics, poliment).
  if (o.read ?? ctx.settings.lire !== false) await Promise.all(sources.slice(0, deep ? 6 : 4).map(async (x) => { try { const p = await politeFetch(x.url, { fetcher: ctx.fetch as typeof fetch, signal: AbortSignal.timeout(8000) }); x.text = p.text.slice(0, 8000); if (p.published) x.published = p.published.slice(0, 10); } catch { /* page refusée : l'extrait suffit */ } }));
  let answer = '', followups: string[] = [], ai = false, essentials: Array<{ title: string; detail?: string }> = [];
  if (sources.length && ctx.ask) {
    try { const r = finish(await ctx.ask(prompt(q, sources, prev.map((h) => ({ q: h.q, a: h.answer })), deep)), sources.length); answer = r.text; followups = r.followups; essentials = r.essentials; ai = Boolean(answer); } catch (e) { g.errors.push(`IA : ${(e as Error).message.slice(0, 100)}`); }
  }
  if (!answer) answer = sources.length ? `${g.answers.length ? `${g.answers.join('\n')}\n\n` : ''}${extractive(sources)}` : `Aucun résultat${g.errors.length ? ` (${g.errors.join(' ; ')})` : ''}. Règle au moins un moteur dans Völva (SearXNG ou une clé Brave).`;
  if (!followups.length) followups = g.suggestions.slice(0, 3);
  // Les applis d'Odin qui peuvent agir sur le sujet (« tu veux que je le fasse ? »).
  const v = valhallaOf(), apps = (v?.find(q) ?? []).filter((f) => f.score >= 2 && f.m.id !== 'volva').slice(0, 3).map((f) => ({ id: f.m.id, name: f.m.name, ...(f.action ? { action: f.action.id, label: f.action.label } : {}) }));
  const e: Entry = { id: randomBytes(5).toString('hex'), at: Date.now(), q, focus, answer, sources, engines: [...new Set(sources.flatMap((x) => x.engines))], followups, apps, ai, errors: g.errors, read: sources.filter((x) => x.text).length, essentials, ...(o.thread ? { thread: prev[0]?.thread ?? o.thread } : {}) };
  saveHistory(ctx, [e, ...history(ctx)]);
  ctx.emit('recherche', { question: q, sources: sources.length, moteurs: e.engines.join(', ') });
  return e;
}

const SEARXNG_SETTINGS = (secret: string) => `# Réglages de SearXNG écrits par Odin (Völva) : format JSON activé, en français, sans limiteur (usage privé).
use_default_settings: true
general:
  instance_name: "Völva"
server:
  secret_key: "${secret}"
  limiter: false
  image_proxy: false
  bind_address: "0.0.0.0"
search:
  safe_search: 0
  default_lang: "fr"
  formats:
    - html
    - json
ui:
  default_locale: "fr"
`;

const ASK: Param[] = [
  { key: 'question', label: 'Question', kind: 'textarea', required: true },
  { key: 'focus', label: 'Où chercher', kind: 'select', options: Object.keys(FOCUS), default: 'tout' },
  { key: 'approfondie', label: 'Recherche approfondie (plus de sources)', kind: 'boolean', default: false },
];

export function volva(config: () => { searxngUrl?: string } = () => ({})): Module {
  cfg = config;
  return {
    id: 'volva', name: 'Völva', family: 'Données',
    what: 'La recherche façon Perplexity : une question, tous tes moteurs (SearXNG avec Google, Bing, DuckDuckGo, Qwant…, Brave, Wikipédia), une réponse rédigée par ton IA avec des sources cliquables, et les applis d\'Odin qui peuvent agir.',
    does: ['plusieurs moteurs ensemble : ton SearXNG (Google, Bing, DuckDuckGo, Qwant, Startpage, Mojeek, Yahoo…), Brave, Wikipédia, Tavily, Exa', 'résultats fusionnés et dédoublonnés (une page vue par plusieurs moteurs passe devant), 3 pages au plus par site', 'pages lues, réponse rédigée par l\'IA réglée dans Odin, chaque phrase avec ses sources [1][2], sans rien inventer', 'sans IA : les meilleurs extraits, chacun avec sa source', 'questions de suite, conversation (la suite comprend la question d\'avant), focus Actualités, Wikipédia, Science, Vidéos', 'les applis d\'Odin qui peuvent agir sur le sujet, avec leur bouton', 'historique, export Markdown et JSON, lien de partage, impression en PDF', 'toutes les recherches d\'Odin passent par Völva quand il est réglé', 'installe et lance SearXNG à côté d\'Odin (Docker), en français, format JSON activé'],
    from: ['Perplexity', 'Perplexica', 'SearXNG', 'Farfalle'], upstream: ['ItzCrazyKns/Perplexica', 'searxng/searxng', 'rashadphz/farfalle'],
    words: ['völva', 'volva', 'recherche', 'cherche sur internet', 'moteur de recherche', 'perplexity', 'searxng', 'pose une question à internet'],
    actions: [
      { id: 'chercher', label: 'Chercher', what: 'Une question en français : réponse sourcée', read: true, params: ASK, words: ['cherche sur internet', 'recherche sur le web', 'trouve-moi des infos sur'], run: async (ctx, i) => {
        const q = s(i.question).trim().slice(0, 1000); if (!q) throw new Error('pose une question');
        const e = await ask(ctx, q, { focus: s(i.focus) as Focus, deep: i.approfondie === true, thread: s(i.suite) || undefined });
        return { text: `${e.answer}\n\nSources :\n${e.sources.map((x) => `[${x.n}] ${x.title} — ${x.url}${x.engines.length > 1 ? ` (${x.engines.join(', ')})` : ''}`).join('\n')}${e.followups.length ? `\n\nPour aller plus loin : ${e.followups.join(' · ')}` : ''}${e.apps.length ? `\nDans Odin : ${e.apps.map((a) => `${a.name}${a.label ? ` (${a.label})` : ''}`).join(', ')}` : ''}`, data: e };
      } },
      { id: 'moteurs', label: 'Moteurs', what: 'Ce que chaque moteur demande et s\'il est prêt', read: true, words: ['moteurs de recherche'], run: (ctx) => {
        const act = new Set(activeEngines(ctx));
        return { text: `${Object.entries(ENGINES).map(([k, x]) => `${act.has(k) ? '✅' : ready(ctx, k) ? '⚪' : '⛔'} ${x.label}${!ready(ctx, k) ? ` — il faut ${x.need ?? (x.env ?? []).join(' et ') + ' dans le coffre'}` : ''}${x.note ? ` (${x.note})` : ''}`).join('\n')}\nBing a arrêté son API en août 2025 : il reste joignable par SearXNG.` };
      } },
      { id: 'moteur', label: 'Activer / couper un moteur', what: 'Choisir les moteurs interrogés', quick: false, params: [{ key: 'moteur', label: 'Moteur', kind: 'select', options: Object.keys(ENGINES), required: true }, { key: 'actif', label: 'Actif', kind: 'boolean', default: true }], run: (ctx, i) => {
        const e = s(i.moteur); if (!ENGINES[e]) throw new Error('moteur inconnu');
        const cur = new Set((ctx.settings.moteurs as string[] | undefined) ?? activeEngines(ctx)); if (i.actif === false) cur.delete(e); else cur.add(e);
        ctx.saveSettings({ moteurs: [...cur] });
        return { text: `${i.actif === false ? '⚪ coupé' : '✅ actif'} : ${ENGINES[e].label}${i.actif !== false && !ready(ctx, e) ? ` — mais il faut encore ${ENGINES[e].need ?? (ENGINES[e].env ?? []).join(' et ')}` : ''}.` };
      } },
      { id: 'searxng', label: 'Relier mon SearXNG', what: 'L\'adresse de ton instance SearXNG (format JSON activé)', quick: false, params: [{ key: 'adresse', label: 'Adresse (http://…:8888)', kind: 'text', required: true }], run: async (ctx, i) => {
        const u = s(i.adresse).trim().replace(/\/$/, ''); if (!/^https?:\/\/[\w.:[\]-]+(\/[\w./-]*)?$/.test(u)) throw new Error('adresse invalide');
        const r = await (ctx.fetch as typeof fetch)(`${u}/search?q=odin&format=json`, { signal: AbortSignal.timeout(10_000) }).catch((e: Error) => { throw new Error(`SearXNG injoignable : ${e.message}`); });
        if (r.status === 403) throw new Error('SearXNG répond, mais le format JSON n\'est pas activé (search → formats → json dans settings.yml)');
        if (!r.ok) throw new Error(`SearXNG répond ${r.status}`);
        ctx.saveSettings({ searxng: u }); const d = parseSearx(await r.json());
        return { text: `🔗 SearXNG relié (${d.results.length} résultats pour l'essai${d.engines.length ? ` : ${d.engines.slice(0, 8).join(', ')}` : ''}).` };
      } },
      { id: 'installer_searxng', label: 'Installer SearXNG', what: 'Lance SearXNG à côté d\'Odin (Docker), en français, format JSON activé, sur cette machine seulement', quick: false, params: [{ key: 'port', label: 'Port (sur cette machine)', kind: 'number', default: 8888 }], run: async (ctx, i) => {
        if (!(await ctx.has('docker'))) throw new Error('Docker n\'est pas installé sur cette machine');
        const port = Math.max(1024, Math.min(65535, Number(i.port) || 8888)), dir = join(ctx.dir, 'searxng'); mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'settings.yml'), SEARXNG_SETTINGS(randomBytes(32).toString('hex')), { mode: 0o600 });
        await ctx.run('docker', ['rm', '-f', 'odin-searxng'], { timeoutMs: 30_000 });
        const r = await ctx.run('docker', ['run', '-d', '--name', 'odin-searxng', '--restart', 'unless-stopped', '-p', `127.0.0.1:${port}:8080`, '-v', `${dir}:/etc/searxng`, 'docker.io/searxng/searxng:latest'], { timeoutMs: 300_000 });
        if (r.code !== 0) throw new Error(`Docker : ${(r.err || r.out).trim().slice(-300)}`);
        ctx.saveSettings({ searxng: `http://127.0.0.1:${port}`, searxngLocal: true });
        return { text: `🚀 SearXNG démarre sur http://127.0.0.1:${port} (seulement sur cette machine). Völva l'utilise dès qu'il répond (quelques secondes).` };
      }, undo: () => ({ action: 'arreter_searxng', input: {}, label: 'Arrêter SearXNG' }) },
      { id: 'arreter_searxng', label: 'Arrêter SearXNG', what: 'Arrête et retire le SearXNG lancé par Odin', quick: false, run: async (ctx) => { await ctx.run('docker', ['rm', '-f', 'odin-searxng'], { timeoutMs: 60_000 }); ctx.saveSettings({ searxng: '', searxngLocal: false }); return { text: '⏹ SearXNG arrêté.' }; } },
      { id: 'historique', label: 'Historique', what: 'Les dernières recherches', read: true, words: ['historique des recherches'], params: [{ key: 'n', label: 'Combien', kind: 'number', default: 20 }], run: (ctx, i) => ({ text: history(ctx).slice(0, Math.max(1, Math.min(200, Number(i.n) || 20))).map((h) => `- ${new Date(h.at).toLocaleString('fr-FR')} · ${h.q} (${h.sources.length} sources)`).join('\n') || 'Aucune recherche.' }) },
      { id: 'exporter', label: 'Exporter une recherche', what: 'En Markdown ou en JSON', read: true, params: [{ key: 'id', label: 'Recherche (vide : la dernière)', kind: 'text', default: '' }, { key: 'format', label: 'Format', kind: 'select', options: ['markdown', 'json'], default: 'markdown' }], run: (ctx, i) => {
        const h = history(ctx), e = s(i.id) ? h.find((x) => x.id === s(i.id)) : h[0]; if (!e) throw new Error('recherche introuvable');
        return { text: s(i.format) === 'json' ? JSON.stringify(e, null, 2) : toMarkdown({ question: e.q, answer: e.answer, sources: e.sources, at: e.at, engines: e.engines }) };
      } },
      { id: 'oublier', label: 'Effacer l\'historique', what: 'Toutes les recherches gardées', quick: false, grave: () => 'effacer tout l\'historique des recherches', run: (ctx) => { saveHistory(ctx, []); writeFileSync(histFile(ctx), '[]'); return { text: '🧹 Historique effacé.' }; } },
      { id: 'reglages', label: 'Réglages', what: 'Lire les pages, recherches d\'Odin par Völva, historique', quick: false, params: [{ key: 'lire', label: 'Lire les pages (réponse plus juste)', kind: 'boolean', default: true }, { key: 'pour_odin', label: 'Les recherches d\'Odin passent par Völva', kind: 'boolean', default: true }, { key: 'garder', label: 'Recherches gardées', kind: 'number', default: 200 }], run: (ctx, i) => { ctx.saveSettings({ lire: i.lire !== false, pourOdin: i.pour_odin !== false, garder: Math.max(10, Math.min(1000, Number(i.garder) || 200)) }); return { text: '⚙ Réglages de Völva enregistrés.' }; } },
    ],
    async view(ctx) {
      const h = history(ctx), act = activeEngines(ctx);
      return {
        subtitle: `${act.length} moteur(s) : ${act.map((e) => ENGINES[e].label.split(' (')[0]).join(', ') || 'aucun'} · ${h.length} recherche(s) gardée(s)`,
        kpis: [{ label: 'Moteurs', value: String(act.length), tone: act.length ? 'bon' : 'attention' }, { label: 'SearXNG', value: searxUrl(ctx) ? 'relié' : 'non', tone: searxUrl(ctx) ? 'bon' : 'attention' }, { label: 'IA', value: ctx.ask ? 'oui' : 'sans IA' }, { label: 'Recherches', value: String(h.length) }],
        sections: [
          { kind: 'steps', title: 'Völva', items: [{ title: 'Ouvrir la page de recherche', detail: '/recherche sur l\'adresse d\'Odin', done: true }, { title: 'SearXNG (Google, Bing, Qwant…)', detail: searxUrl(ctx) || 'pas encore : « Installer SearXNG » ou « Relier mon SearXNG »', done: Boolean(searxUrl(ctx)), action: 'installer_searxng', input: {}, button: 'Installer' }, { title: 'Une clé Brave (facultatif)', detail: 'BRAVE_API_KEY dans le coffre', done: Boolean(process.env.BRAVE_API_KEY) }] },
          { kind: 'table', title: 'Dernières recherches', columns: ['Quand', 'Question', 'Sources', 'Moteurs'], empty: 'Aucune recherche.', rows: h.slice(0, 30).map((x) => ({ cells: [new Date(x.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), x.q, String(x.sources.length), x.engines.slice(0, 4).join(', ')], actions: [{ action: 'exporter', label: 'Markdown', input: { id: x.id } }] })) },
        ],
        side: [{ kind: 'form', title: 'Chercher', action: 'chercher', submit: 'Chercher', params: ASK }, { kind: 'form', title: 'Relier mon SearXNG', action: 'searxng', submit: 'Relier', params: [{ key: 'adresse', label: 'Adresse', kind: 'text', required: true }] }],
      };
    },
  };
}
