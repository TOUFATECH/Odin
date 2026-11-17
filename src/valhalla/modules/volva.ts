// Pythie · la recherche : une question en français, plusieurs moteurs interrogés ensemble (Lyncée, le moteur
// d'Odin, qui interroge lui-même DuckDuckGo, Brave, Yahoo, Bing, Wikipédia… sans clé ni instance externe ; ton
// instance externe si tu en as une ; Brave, Tavily selon tes clés), résultats fusionnés et dédoublonnés,
// pages lues, réponse rédigée par l'IA réglée dans Odin avec des sources numérotées cliquables, questions de
// suite, et les applis d'Odin qui peuvent agir sur le sujet. Toutes les recherches d'Odin passent par Pythie.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { politeFetch } from '../../research/fetch.ts';
import { webSearch, type SearchProvider, type SearchResult } from '../../tools/search.ts';
import { classerErreur } from '../../net/fetch-propre.ts';
import { marquerService } from '../../net/etat-internet.ts';
import { valhallaOf } from '../odin.ts';
import { extractive, finish, FOCUS, fuse, parseInstant, parseSearx, parseWikipedia, prompt, toMarkdown, type Focus, type Source } from '../volva/engine.ts';
import type { ActionResult, ModCtx, Module, Param } from '../types.ts';
import { sonDit } from './bragi.ts';
import { RESULTATS_DEFAUT, RESULTATS_MAX, resultatsMarkdown, resultatsParles, type Affichage, type Sorte } from '../volva/demande.ts';
import { categorieDe, chercherLyncee, etatsLyncee, phrasePause, reglerLyncee, reprendreMoteur, verifierLyncee } from '../volva/lyncee/meta.ts';
import { ADAPTATEURS } from '../volva/lyncee/adaptateurs.ts';
import { CATEGORIES } from '../volva/lyncee/types.ts';
import { effacerQuestions, noterQuestion } from '../volva/questions.ts';

const s = (v: unknown) => String(v ?? '');
/** Une réponse telle qu'on la dit : sans les renvois [1] ni les étoiles du gras. */
export const spoken = (answer: string) => answer.replace(/\s*\[\d{1,2}\]/g, '').replace(/\*\*/g, '').slice(0, 4000);
/** Les moteurs que Pythie sait interroger, et ce qu'il faut pour chacun. */
export const ENGINES: Record<string, { label: string; need?: string; env?: string[]; note?: string; keyless?: boolean }> = {
  lyncee: { label: 'Lyncée (plusieurs moteurs, sans clé)', keyless: true, note: 'DuckDuckGo, Brave, Yahoo, Bing, Wikipédia… interrogés par Odin lui-même' },
  searxng: { label: 'SearXNG (ton instance, facultative)', need: 'ton instance (facultative : Lyncée suffit)', note: 'SearXNG interroge ces moteurs comme un navigateur : leurs conditions d\'usage s\'appliquent ; garde un usage personnel et raisonnable.' },
  brave: { label: 'Brave Search', env: ['BRAVE_API_KEY'], note: 'clé gratuite avec 5 $ de crédit par mois (environ 1 000 recherches)' },
  wikipedia: { label: 'Wikipédia', keyless: true },
  duckduckgo_ia: { label: 'DuckDuckGo (réponses instantanées)', keyless: true },
  tavily: { label: 'Tavily', env: ['TAVILY_API_KEY'] },
  google: { label: 'Google (Programmable Search)', env: ['GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX'], note: 'fermé aux nouveaux clients ; Google l\'arrête le 1er janvier 2027' },
  duckduckgo: { label: 'DuckDuckGo (page web)', keyless: true, note: 'secours sans clé' },
  mojeek: { label: 'Mojeek (page web)', keyless: true, note: 'souvent bloqué par un captcha' },
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
/** D'où viennent les suggestions pendant la frappe ('duckduckgo' et 'brave' reçoivent ce que tu tapes). */
export const SUGGESTIONS = ['aucune', 'wikipedia', 'duckduckgo', 'brave'];
const heureCourte =(t?: number) => (t ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
/** Les moteurs de Lyncée, un par ligne : ✅ prêt, ⏸ en pause jusqu'à HH:MM (raison), ⚪ coupé. */
function lignesLyncee(): string {
  return etatsLyncee().map((m) => `${m.etat === 'pret' ? '✅' : m.etat === 'pause' ? '⏸' : '⚪'} ${m.etiquette}${m.id.includes('_') ? ` (${m.id})` : ''} — ${m.categories.map((c) => CATEGORIES[c].label).join(', ')}${m.etat === 'pause' ? ` — en pause jusqu'à ${heureCourte(m.jusqua)}${m.raison ? ` : ${m.raison}` : ''}` : m.etat === 'coupe' ? ' — coupé' : ''}`).join('\n');
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
      if (e === 'lyncee') {
        // Lyncée : plusieurs moteurs sans clé, interrogés par Odin lui-même ; la catégorie remplace l'indice du focus.
        const r = await chercherLyncee(q, { categorie: categorieDe(focus), n: Math.max(n, 10), fetcher: f, signal, delai: 6000, sans: activeEngines(ctx).includes('wikipedia') ? ['wikipedia'] : [] });
        errors.push(...r.erreurs, ...r.pauses.map((p) => phrasePause(p)).filter((p) => !r.erreurs.includes(p)));
        return { engine: 'Lyncée', results: r.resultats.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet, engines: x.engines, ...(x.thumb ? { thumb: x.thumb } : {}), ...(x.published ? { published: x.published } : {}) })) };
      }
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
    } catch (err) { const nom = ENGINES[e]?.label.split(' (')[0] ?? e; const { message, etat } = classerErreur(err, nom); marquerService(nom, etat, message); errors.push(message); return { engine: e, results: [] }; }
  }));
  return { lists, errors, answers: [...new Set(answers)].slice(0, 3), suggestions: [...new Set(suggestions)].slice(0, 5) };
}
/** Résultats fusionnés seulement (pour l'outil de recherche d'Odin), sans IA. */
export async function volvaResults(q: string, n = 8): Promise<{ engines: string[]; results: SearchResult[]; errors?: string[] } | undefined> {
  const v = valhallaOf(); if (!v?.module('volva')) return undefined;
  const ctx = v.ctx('volva'); if (ctx.settings.pourOdin === false || !activeEngines(ctx).length) return undefined;
  const g = await gather(ctx, q, 'tout', n), src = fuse(g.lists, n);
  if (!src.length) return undefined;
  return { engines: [...new Set(src.flatMap((x) => x.engines))], results: src.map((x) => ({ title: x.title, url: x.url, snippet: `${x.snippet}${x.engines.length > 1 ? ` [${x.engines.join(', ')}]` : ''}` })), errors: g.errors };
}

/**
 * Depuis la discussion (« fais-moi une recherche sur … ») : les résultats seuls, sans IA, chacun avec son image, son
 * titre et son texte. 5 par défaut ; un nombre demandé (« montre-moi 10 résultats ») devient le réglage. Sans question :
 * la dernière recherche, avec le nouveau nombre. En cartes, tableau, liste, dans le navigateur (page /recherche) ou à
 * voix haute (Orphée) ; pages, vidéos, images ou sons.
 */
export async function resultats(ctx: ModCtx, i: Record<string, unknown>): Promise<ActionResult> {
  const reg = ctx.settings as { nbResultats?: number; derniere?: { q: string; sorte: Sorte } };
  const voulu = Number(i.n), demande = Number.isFinite(voulu) && voulu >= 1;
  const n = demande ? Math.min(RESULTATS_MAX, Math.round(voulu)) : Math.max(1, Math.min(RESULTATS_MAX, Number(reg.nbResultats) || RESULTATS_DEFAUT));
  if (demande && n !== reg.nbResultats) ctx.saveSettings({ nbResultats: n });
  const so = s(i.sorte) as Sorte, aff = s(i.affichage) as Affichage;
  let q = s(i.question).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 400), sorte: Sorte = ['pages', 'videos', 'images', 'sons'].includes(so) ? so : 'pages';
  if (!q && reg.derniere?.q) { q = reg.derniere.q; if (!so) sorte = reg.derniere.sorte ?? 'pages'; }
  if (!q) throw new Error('dis-moi ce que je dois chercher');
  ctx.saveSettings({ derniere: { q, sorte } });
  // Le Web est l'onglet par défaut de la page de résultats : pas de « &cat=web » (lien court, inchangé).
  if (aff === 'navigateur') { const u = `/recherche?q=${encodeURIComponent(q)}${sorte === 'pages' ? '' : `&cat=${sorte === 'images' ? 'images' : 'videos'}`}`; return { text: `🔎 La recherche « ${q} » est prête dans Pythie : [Ouvrir dans le navigateur](${u})`, data: { lien: u } }; }
  const g = await gather(ctx, q, sorte === 'pages' ? 'tout' : sorte, Math.max(n, 8)), src = fuse(g.lists, n);
  const data = { question: q, sorte, n, sources: src, moteurs: [...new Set(src.flatMap((x) => x.engines))], erreurs: g.errors };
  const md = resultatsMarkdown(src, { q, sorte, affichage: aff, n });
  const pied = src.length ? `\n\n*Pour en voir plus : « montre-moi ${Math.min(RESULTATS_MAX, n + 5)} résultats » · autre affichage : « en tableau », « en liste », « dans le navigateur », « à voix haute ».*` : g.errors.length ? `\n(${g.errors.slice(0, 2).join(' ; ')})` : '';
  if (aff === 'audio' && src.length) {
    const r = await ctx.call('bragi', 'dire', { texte: resultatsParles(src, q) }, 'lire à voix haute les résultats de Pythie', { interne: true });
    return r.ok === false ? { text: `${md}\n\nJe n'ai pas pu les lire à voix haute : ${r.text}`, data } : { text: `🔊 Je te lis les résultats.\n\n${md}`, fichiers: r.fichiers, data };
  }
  ctx.emit('recherche', { question: q, sources: src.length, moteurs: data.moteurs.join(', ') });
  return { text: `${md}${pied}`, data };
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
  if (!answer) answer = sources.length ? `${g.answers.length ? `${g.answers.join('\n')}\n\n` : ''}${extractive(sources)}` : `Aucun résultat${g.errors.length ? ` (${g.errors.join(' ; ')})` : ''}. Lyncée n'a rien trouvé : reformule ta question, ou vérifie les moteurs dans Pythie.`;
  if (!followups.length) followups = g.suggestions.slice(0, 3);
  // Les applis d'Odin qui peuvent agir sur le sujet (« tu veux que je le fasse ? »).
  const v = valhallaOf(), apps = (v?.find(q) ?? []).filter((f) => f.score >= 2 && f.m.id !== 'volva').slice(0, 3).map((f) => ({ id: f.m.id, name: f.m.name, ...(f.action ? { action: f.action.id, label: f.action.label } : {}) }));
  const e: Entry = { id: randomBytes(5).toString('hex'), at: Date.now(), q, focus, answer, sources, engines: [...new Set(sources.flatMap((x) => x.engines))], followups, apps, ai, errors: g.errors, read: sources.filter((x) => x.text).length, essentials, ...(o.thread ? { thread: prev[0]?.thread ?? o.thread } : {}) };
  saveHistory(ctx, [e, ...history(ctx)]); noterQuestion(ctx, q);
  ctx.emit('recherche', { question: q, sources: sources.length, moteurs: e.engines.join(', ') });
  return e;
}

const SEARXNG_SETTINGS = (secret: string) => `# Réglages de SearXNG écrits par Odin (Pythie) : format JSON activé, en français, sans limiteur (usage privé).
use_default_settings: true
general:
  instance_name: "Pythie"
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
    id: 'volva', name: 'Pythie', family: 'Données',
    what: 'La recherche d\'Odin : une question, Lyncée interroge plusieurs moteurs ensemble, une réponse rédigée par ton IA avec des sources cliquables, et les applis d\'Odin qui peuvent agir.',
    modes: ['Lyncée · le moteur de recherche d\'Odin'],
    does: ['Lyncée, le moteur d\'Odin : DuckDuckGo, Brave, Yahoo, Bing, Wikipédia, Wikidata… interrogés par Odin lui-même, sans clé et sans instance externe', 'santé des moteurs : un moteur qui bloque ou limite est mis en pause, jamais contourné, et la recherche continue avec les autres', 'Web, Actualités, Images et Vidéos avec leurs vignettes, Savoir (Wikipédia, Wikidata)', 'plus, si tu les as : Brave, Tavily avec une clé, ton instance externe (facultative)', 'résultats fusionnés et dédoublonnés (une page vue par plusieurs moteurs passe devant), 3 pages au plus par site', 'pages lues, réponse rédigée par l\'IA réglée dans Odin, chaque phrase avec ses sources [1][2], sans rien inventer', 'sans IA : les meilleurs extraits, chacun avec sa source', 'questions de suite, conversation (la suite comprend la question d\'avant), focus Actualités, Wikipédia, Science, Vidéos', 'les applis d\'Odin qui peuvent agir sur le sujet, avec leur bouton', 'historique, export Markdown et JSON, lien de partage, impression en PDF', 'toutes les recherches d\'Odin passent par Pythie et Lyncée', 'Odin comme moteur de recherche de tes navigateurs (mode d\'emploi : /recherche/navigateurs)', 'facultatif : installe et lance une instance externe à côté d\'Odin (Docker)'],
    from: ['Perplexity', 'Perplexica', 'SearXNG', 'Farfalle'], upstream: ['ItzCrazyKns/Perplexica', 'searxng/searxng', 'rashadphz/farfalle'],
    words: ['völva', 'volva', 'recherche', 'cherche sur internet', 'moteur de recherche', 'searxng', 'pose une question à internet', 'lyncée', 'lyncee', 'moteur de recherche du navigateur'],
    actions: [
      { id: 'chercher', label: 'Chercher', what: 'Une question en français : réponse sourcée', read: true, params: ASK, words: ['cherche sur internet', 'recherche sur le web', 'trouve-moi des infos sur'], run: async (ctx, i) => {
        const q = s(i.question).trim().slice(0, 1000); if (!q) throw new Error('pose une question');
        const e = await ask(ctx, q, { focus: s(i.focus) as Focus, deep: i.approfondie === true, thread: s(i.suite) || undefined });
        return { text: `${e.answer}\n\nSources :\n${e.sources.map((x) => `[${x.n}] ${x.title} — ${x.url}${x.engines.length > 1 ? ` (${x.engines.join(', ')})` : ''}`).join('\n')}${e.followups.length ? `\n\nPour aller plus loin : ${e.followups.join(' · ')}` : ''}${e.apps.length ? `\nDans Odin : ${e.apps.map((a) => `${a.name}${a.label ? ` (${a.label})` : ''}`).join(', ')}` : ''}`, data: e };
      } },
      // Pour les autres applis (Gygès) : les résultats seuls. Rien n'est lu, rien ne part vers l'IA, rien ne reste dans l'historique.
      { id: 'brut', label: 'Résultats bruts', what: 'Les résultats des moteurs, fusionnés, sans IA, sans lecture des pages et sans rien garder dans l\'historique (pour les autres applis d\'Odin)', read: true, quick: false, external: true, params: [{ key: 'question', label: 'Question', kind: 'textarea', required: true }, { key: 'n', label: 'Combien', kind: 'number', default: 8 }], run: async (ctx, i) => {
        const q = s(i.question).trim().slice(0, 400); if (!q) throw new Error('pose une question');
        const n = Math.max(1, Math.min(20, Number(i.n) || 8)), g = await gather(ctx, q, 'tout', n), sources = fuse(g.lists, n);
        return { text: sources.map((x) => `[${x.n}] ${x.title} — ${x.url}`).join('\n') || `Aucun résultat${g.errors.length ? ` (${g.errors.join(' ; ')})` : ''}.`, data: { sources, moteurs: activeEngines(ctx), erreurs: g.errors } };
      } },
      { id: 'resultats', label: 'Résultats en cartes', what: 'Les résultats des moteurs sans IA (5 par défaut, réglable), chacun avec son image, son titre et son texte ; en cartes, tableau, liste, dans le navigateur ou à voix haute ; pages, vidéos, images ou sons', read: true, quick: false,
        params: [{ key: 'question', label: 'Question (vide : la dernière)', kind: 'textarea', default: '' }, { key: 'n', label: 'Combien (vide : le réglage, 5 par défaut)', kind: 'number' }, { key: 'sorte', label: 'Quoi', kind: 'select', options: ['pages', 'videos', 'images', 'sons'], default: 'pages' }, { key: 'affichage', label: 'Affichage', kind: 'select', options: ['cartes', 'tableau', 'liste', 'navigateur', 'audio'], default: 'cartes' }],
        run: (ctx, i) => resultats(ctx, i) },
      { id: 'moteurs', label: 'Moteurs', what: 'Ce que chaque moteur demande et s\'il est prêt', read: true, words: ['moteurs de recherche'], run: (ctx) => {
        const act = new Set(activeEngines(ctx));
        return { text: `${Object.entries(ENGINES).map(([k, x]) => `${act.has(k) ? '✅' : ready(ctx, k) ? '⚪' : '⛔'} ${x.label}${!ready(ctx, k) ? ` — il faut ${x.need ?? (x.env ?? []).join(' et ') + ' dans le coffre'}` : ''}${x.note ? ` (${x.note})` : ''}`).join('\n')}\n\nLyncée :\n${lignesLyncee()}\nBing a arrêté son API en août 2025 : Lyncée lit sa page de résultats quand elle répond.` };
      } },
      { id: 'moteur', label: 'Activer / couper un moteur', what: 'Choisir les moteurs interrogés', quick: false, params: [{ key: 'moteur', label: 'Moteur', kind: 'select', options: Object.keys(ENGINES), required: true }, { key: 'actif', label: 'Actif', kind: 'boolean', default: true }], run: (ctx, i) => {
        const e = s(i.moteur); if (!ENGINES[e]) throw new Error('moteur inconnu');
        const cur = new Set((ctx.settings.moteurs as string[] | undefined) ?? activeEngines(ctx)); if (i.actif === false) cur.delete(e); else cur.add(e);
        ctx.saveSettings({ moteurs: [...cur] });
        return { text: `${i.actif === false ? '⚪ coupé' : '✅ actif'} : ${ENGINES[e].label}${i.actif !== false && !ready(ctx, e) ? ` — mais il faut encore ${ENGINES[e].need ?? (ENGINES[e].env ?? []).join(' et ')}` : ''}.` };
      } },
      { id: 'searxng', label: 'Relier mon SearXNG', what: 'L\'adresse de ton instance SearXNG (format JSON activé)', quick: false, params: [{ key: 'adresse', label: 'Adresse (http://…:8888)', kind: 'text', required: true }], run: async (ctx, i) => {
        const u = s(i.adresse).trim().replace(/\/$/, ''); if (!/^https?:\/\/[\w.:[\]-]+(\/[\w./-]*)?$/.test(u)) throw new Error('adresse invalide');
        const r = await (ctx.fetch as typeof fetch)(`${u}/search?q=odin&format=json`, { signal: AbortSignal.timeout(10_000) }).catch((e: Error) => { throw new Error(classerErreur(e, 'SearXNG').message); });
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
        return { text: `🚀 SearXNG démarre sur http://127.0.0.1:${port} (seulement sur cette machine). Pythie l'utilise dès qu'il répond (quelques secondes).` };
      }, undo: () => ({ action: 'arreter_searxng', input: {}, label: 'Arrêter SearXNG' }) },
      { id: 'arreter_searxng', label: 'Arrêter SearXNG', what: 'Arrête et retire le SearXNG lancé par Odin', quick: false, run: async (ctx) => { await ctx.run('docker', ['rm', '-f', 'odin-searxng'], { timeoutMs: 60_000 }); ctx.saveSettings({ searxng: '', searxngLocal: false }); return { text: '⏹ SearXNG arrêté.' }; } },
      { id: 'historique', label: 'Historique', what: 'Les dernières recherches', read: true, words: ['historique des recherches'], params: [{ key: 'n', label: 'Combien', kind: 'number', default: 20 }], run: (ctx, i) => ({ text: history(ctx).slice(0, Math.max(1, Math.min(200, Number(i.n) || 20))).map((h) => `- ${new Date(h.at).toLocaleString('fr-FR')} · ${h.q} (${h.sources.length} sources)`).join('\n') || 'Aucune recherche.' }) },
      { id: 'exporter', label: 'Exporter une recherche', what: 'En Markdown ou en JSON', read: true, params: [{ key: 'id', label: 'Recherche (vide : la dernière)', kind: 'text', default: '' }, { key: 'format', label: 'Format', kind: 'select', options: ['markdown', 'json'], default: 'markdown' }], run: (ctx, i) => {
        const h = history(ctx), e = s(i.id) ? h.find((x) => x.id === s(i.id)) : h[0]; if (!e) throw new Error('recherche introuvable');
        return { text: s(i.format) === 'json' ? JSON.stringify(e, null, 2) : toMarkdown({ question: e.q, answer: e.answer, sources: e.sources, at: e.at, engines: e.engines }) };
      } },
      // Réponse en audio : Orphée la lit avec la voix d'Odin (celle choisie dans Réglages → Voix) ; le son est à télécharger.
      { id: 'ecouter', label: 'Écouter une réponse', what: 'La réponse d\'une recherche, lue à voix haute par Orphée (vide : la dernière)', quiet: true, params: [{ key: 'id', label: 'Recherche (vide : la dernière)', kind: 'text', default: '' }], words: ['lis la derniere recherche', 'lis la dernière recherche', 'lis la reponse', 'lis la réponse', 'recherche a voix haute', 'recherche à voix haute'], run: async (ctx, i) => {
        const h = history(ctx), e = s(i.id) ? h.find((x) => x.id === s(i.id)) : h[0]; if (!e) throw new Error(s(i.id) ? 'cette recherche n\'est plus dans l\'historique' : 'aucune recherche à lire : pose d\'abord une question à Pythie');
        const r = await ctx.call('bragi', 'dire', { texte: spoken(e.answer) }, 'lire à voix haute la réponse de Pythie', { interne: true });
        return r.ok === false ? { ok: false, text: `Je n'ai pas pu lire la réponse : ${r.text}` } : { text: `🔊 « ${e.q.slice(0, 80)} » : la réponse est prête à écouter.`, fichiers: r.fichiers };
      } },
      { id: 'oublier', label: 'Effacer l\'historique', what: 'Toutes les recherches gardées', quick: false, grave: () => 'effacer tout l\'historique des recherches', run: (ctx) => { saveHistory(ctx, []); writeFileSync(histFile(ctx), '[]'); effacerQuestions(ctx); return { text: '🧹 Historique effacé.' }; } },
      { id: 'reglages', label: 'Réglages', what: 'Lire les pages, recherches d\'Odin par Pythie, historique', quick: false, params: [{ key: 'lire', label: 'Lire les pages (réponse plus juste)', kind: 'boolean', default: true }, { key: 'pour_odin', label: 'Les recherches d\'Odin passent par Pythie', kind: 'boolean', default: true }, { key: 'garder', label: 'Recherches gardées', kind: 'number', default: 200 }, { key: 'noter_questions', label: 'Noter mes questions (suggestions pendant la frappe, gardées chez toi)', kind: 'boolean', default: true }, { key: 'suggestions', label: 'Source des suggestions (duckduckgo et brave reçoivent ce que tu tapes)', kind: 'select', options: SUGGESTIONS, default: 'wikipedia' }], run: (ctx, i) => {
        const sug = SUGGESTIONS.includes(s(i.suggestions)) ? s(i.suggestions) : 'wikipedia';
        ctx.saveSettings({ lire: i.lire !== false, pourOdin: i.pour_odin !== false, garder: Math.max(10, Math.min(1000, Number(i.garder) || 200)), noterQuestions: i.noter_questions !== false, suggestions: sug });
        return { text: `⚙ Réglages de Pythie enregistrés.${sug === 'duckduckgo' || sug === 'brave' ? ` Attention : ce que tu tapes part vers ${sug === 'brave' ? 'Brave' : 'DuckDuckGo'} pour les suggestions.` : ''}` };
      } },
      { id: 'reprendre_moteur', label: 'Reprendre un moteur de Lyncée', what: 'Lever tout de suite la pause d\'un moteur de Lyncée', quick: false, params: [{ key: 'moteur', label: 'Moteur', kind: 'select', options: ADAPTATEURS.map((a) => a.id), required: true }], run: (_ctx, i) => {
        const id = s(i.moteur); if (!reprendreMoteur(id)) throw new Error('moteur de Lyncée inconnu');
        return { text: `▶ ${ADAPTATEURS.find((a) => a.id === id)!.etiquette} reprend : Lyncée l'interroge de nouveau dès la prochaine recherche.` };
      } },
      { id: 'couper_moteur_lyncee', label: 'Activer / couper un moteur de Lyncée', what: 'Choisir les moteurs que Lyncée interroge', quick: false, params: [{ key: 'moteur', label: 'Moteur', kind: 'select', options: ADAPTATEURS.map((a) => a.id), required: true }, { key: 'actif', label: 'Actif', kind: 'boolean', default: true }], run: (ctx, i) => {
        const id = s(i.moteur), a = ADAPTATEURS.find((x) => x.id === id); if (!a) throw new Error('moteur de Lyncée inconnu');
        const coupes = new Set(Array.isArray(ctx.settings.lynceeCoupes) ? ctx.settings.lynceeCoupes as string[] : []); if (i.actif === false) coupes.add(id); else coupes.delete(id);
        ctx.saveSettings({ lynceeCoupes: [...coupes] }); reglerLyncee({ coupes: [...coupes] });
        return { text: `${i.actif === false ? '⚪ coupé' : '✅ actif'} dans Lyncée : ${a.etiquette} (${id}).` };
      } },
      { id: 'verifier_moteurs', label: 'Vérifier les moteurs de Lyncée', what: 'Une question neutre vers chaque moteur prêt, pour voir lesquels répondent aujourd\'hui', read: true, quick: false, run: async (ctx) => {
        await verifierLyncee(ctx.fetch as typeof fetch, AbortSignal.timeout(60_000));
        return { text: `Lyncée :\n${lignesLyncee()}` };
      } },
    ],
    // Le son d'une réponse lue (fabriqué par Orphée) peut être remis à l'appareil depuis la page de Pythie.
    retrait: (ctx, ref) => sonDit(join(ctx.dir, '..', 'bragi'), ref),
    start(ctx) {
      // La santé des moteurs de Lyncée est gardée dans le dossier de Pythie ; les moteurs coupés par toi restent coupés.
      reglerLyncee({ dossier: ctx.dir, coupes: Array.isArray(ctx.settings.lynceeCoupes) ? ctx.settings.lynceeCoupes as string[] : [] });
      // Une seule fois : Lyncée s'ajoute aux moteurs déjà choisis (un Odin qui avait réglé ses moteurs le garde aussi).
      const choisis = ctx.settings.moteurs as string[] | undefined;
      if (Array.isArray(choisis) && !choisis.includes('lyncee') && ctx.settings.lynceeAjoute !== true) ctx.saveSettings({ moteurs: ['lyncee', ...choisis], lynceeAjoute: true });
      else if (ctx.settings.lynceeAjoute !== true) ctx.saveSettings({ lynceeAjoute: true });
    },
    async view(ctx) {
      const h = history(ctx), act = activeEngines(ctx), ly = etatsLyncee(), prets = ly.filter((m) => m.etat === 'pret').length, enPause = ly.filter((m) => m.etat === 'pause').length;
      return {
        subtitle: `${act.length} moteur(s) : ${act.map((e) => ENGINES[e].label.split(' (')[0]).join(', ') || 'aucun'} · ${h.length} recherche(s) gardée(s)`,
        kpis: [{ label: 'Moteurs', value: String(act.length), tone: act.length ? 'bon' : 'attention' }, { label: 'Lyncée', value: `${prets} prêts · ${enPause} en pause`, tone: enPause ? 'attention' : 'bon' }, { label: 'IA', value: ctx.ask ? 'oui' : 'sans IA' }, { label: 'Recherches', value: String(h.length) }],
        sections: [
          { kind: 'steps', title: 'Pythie', items: [{ title: 'Ouvrir la page de recherche', detail: '/recherche sur l\'adresse d\'Odin', done: true }, { title: 'Lyncée, le moteur d\'Odin', detail: `${prets} moteurs prêts${enPause ? `, ${enPause} en pause` : ''} (sans clé, sans instance externe)`, done: prets > 0 }, { title: 'Instance externe (facultatif)', detail: searxUrl(ctx) ? `reliée : ${searxUrl(ctx)}` : 'Lyncée suffit ; ton instance s\'ajoute si tu veux', done: true, action: 'installer_searxng', input: {}, button: 'Installer' }, { title: 'Une clé Brave (facultatif)', detail: 'BRAVE_API_KEY dans le coffre', done: Boolean(process.env.BRAVE_API_KEY) }, { title: 'Odin dans ton navigateur', detail: '/recherche/navigateurs', done: false }] },
          { kind: 'table', title: 'Moteurs de Lyncée', columns: ['Moteur', 'Catégories', 'État', 'Jusqu\'à', 'Raison'], empty: 'Aucun moteur.', rows: ly.map((m) => ({ cells: [`${m.etiquette}${m.id.includes('_') ? ` (${m.id})` : ''}`, m.categories.map((c) => CATEGORIES[c].label).join(', '), m.etat === 'pret' ? 'prêt' : m.etat === 'pause' ? 'en pause' : 'coupé', m.etat === 'pause' ? heureCourte(m.jusqua) : '', m.raison ?? ''], ...(m.etat === 'pause' ? { actions: [{ action: 'reprendre_moteur', label: 'Reprendre', input: { moteur: m.id } }] } : {}) })) },
          { kind: 'table', title: 'Dernières recherches', columns: ['Quand', 'Question', 'Sources', 'Moteurs'], empty: 'Aucune recherche.', rows: h.slice(0, 30).map((x) => ({ cells: [new Date(x.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), x.q, String(x.sources.length), x.engines.slice(0, 4).join(', ')], actions: [{ action: 'exporter', label: 'Markdown', input: { id: x.id } }] })) },
        ],
        side: [{ kind: 'form', title: 'Chercher', action: 'chercher', submit: 'Chercher', params: ASK }, { kind: 'form', title: 'Relier mon SearXNG', action: 'searxng', submit: 'Relier', params: [{ key: 'adresse', label: 'Adresse', kind: 'text', required: true }] }],
      };
    },
  };
}
