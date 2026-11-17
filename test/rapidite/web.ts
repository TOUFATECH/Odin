// Banc de rapidité : la RECHERCHE SUR LE WEB, sur un FAUX WEB LOCAL (aucune requête vers Internet).
//
//   node --disable-warning=ExperimentalWarning test/rapidite/web.ts [--court]
//
// Un serveur HTTP du banc joue : un moteur (format SearXNG) qui répond vite ou tarde, des sites normaux, un site LENT
// (30 s, au-delà des 25 s d'attente d'Odin), une page LOURDE (3 Mo), un site SURCHARGÉ (429 « reviens dans 3 s »), et
// deux pages d'un même site (pause « humaine » entre les deux). Les noms en .test sont dirigés vers ce serveur (le
// résolveur et fetch sont enveloppés) ; toute autre adresse est refusée et comptée.
// Le modèle est faux, à délai fixe : il joue le chercheur, le vérificateur (citations copiées MOT POUR MOT des pages) et
// le rédacteur. On mesure : la frise des étapes de la recherche vérifiée, ce qui attend quoi, le fil d'Odin bloqué
// (retard de la boucle), et ce que garde la validation (verdicts, groupes de sources). Puis un tour complet
// « cherche-moi… » par la passerelle : quand la mascotte peut réagir, premier mot, réponse sourcée.
// Maquette (dans le banc seulement) : un délai de collecte de 6 s par page, pour mesurer le gain SANS toucher à la validation.

process.env.ODIN_ESSAI = '1';
process.env.ODIN_NO_VOICE_INSTALL = '1';
process.env.ODIN_NO_LOCAL_BRAIN = '1';

import { createServer, type Server } from 'node:http';
import dnsp from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chargeMachine, ecrireResultat, ms, retardBoucle, stat, tableau } from './outils.ts';
import type { AgentEvent, CompletionRequest, ModelResponse, Provider } from '../../src/types.ts';

// ------------------------------------------------------------------------------------------------ faux web
const PHRASES: Record<string, string[]> = {
  a: ['Le NAS Synology DS923+ consomme environ 35 watts en fonctionnement avec quatre disques.', 'En veille prolongée, la consommation du DS923+ descend vers 13 watts selon le constructeur.'],
  b: ['Selon nos mesures au wattmètre, le DS923+ chargé de quatre disques tire 35 watts en accès.', 'Disques au repos, nous avons relevé une puissance de 13 watts environ.'],
  c: ['La fiche technique officielle indique 35,5 W en accès et 13,4 W en hibernation des disques.', 'Ces valeurs sont données pour quatre disques durs de 4 To installés.'],
  d: ['Un lecteur rapporte une facture annuelle de 40 euros pour son DS923+ allumé jour et nuit.', 'La consommation dépend surtout du nombre et du type de disques installés.'],
  e: ['Le test complet du DS923+ conclut à une consommation raisonnable, autour de 35 watts.', 'Le processeur AMD Ryzen R1600 reste sobre même sous charge.'],
};
function page(site: string, titre: string, texte: string[], lourd = 0): string {
  // Chaque site écrit à sa façon (sinon l'analyse des sources les range, à raison, dans un seul groupe de reprises).
  const propre = `Article rédigé par l'équipe ${site} (${site.split('').reverse().join('')}), relu le ${site.length + 3} septembre.`;
  const corps = texte.map((t) => `<p>${t} ${propre}</p>`).join('\n');
  const remplissage = lourd ? `<div>${'<p>Paragraphe de remplissage sans rapport avec la question, ajouté pour alourdir la page et ralentir son analyse.</p>\n'.repeat(Math.ceil(lourd / 120))}</div>` : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${titre}</title><meta name="author" content="Rédaction ${site}"><meta property="article:published_time" content="2026-09-1${site.length % 9}T10:00:00Z"></head><body><nav>Accueil · Tests · Contact</nav><article><h1>${titre}</h1>${corps}${remplissage}</article><footer>© ${site}</footer></body></html>`;
}

export interface FauxWeb { port: number; serveur: Server; requetes: Array<{ t: number; chemin: string }>; moteurMs: number; fermer(): Promise<void> }
export async function fauxWeb(): Promise<FauxWeb> {
  const requetes: FauxWeb['requetes'] = [];
  const etat = { moteurMs: 300 };
  const serveur = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x'); requetes.push({ t: performance.now(), chemin: u.pathname });
    const [, hote, ...reste] = u.pathname.split('/');
    const envoyer = (code: number, type: string, corps: string, en: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': type, ...en }); res.end(corps); };
    // Le moteur : /moteur/<scenario>/search?q=…&format=json
    if (hote === 'moteur') {
      const scen = reste[0] ?? 'propre', run = reste[1] ?? 'r0', q = u.searchParams.get('q') ?? '';
      const hosts = (h: string) => `https://${h}-${run}.test`;
      const contraire = /plus élevée|contredit/i.test(q);
      // Cas difficiles (la validation ne doit jamais devenir plus optimiste parce qu'une page tarde) :
      //  - contra-lente : la recherche CONTRADICTOIRE trouve une page lente (7 s) qui contredit ;
      //  - officiel-lent : la seule source officielle (primaire) est lente (7 s), un seul autre groupe dit « pour » ;
      //  - deux-groupes : deux groupes disent « pour », une troisième page (recherche principale) lente contredit.
      if (scen === 'contra-lente' || scen === 'officiel-lent' || scen === 'deux-groupes') {
        const base = [
          { title: 'DS923+ : consommation mesurée', url: `${hosts('site-a')}/ds923-conso`, content: 'mesure' },
          ...(scen !== 'officiel-lent' ? [{ title: 'Test du Synology DS923+', url: `${hosts('site-b')}/test-ds923`, content: 'test' }] : []),
          ...(scen === 'contra-lente' ? [{ title: 'Fiche technique DS923+', url: `${hosts('site-c')}/fiche`, content: 'fiche' }, { title: 'Retour de lecteur DS923+', url: `${hosts('site-d')}/lecteur`, content: 'lecteur' }] : []),
          ...(scen === 'officiel-lent' ? [{ title: 'Fiche officielle de consommation', url: `https://officiel-${run}.gouv.fr/ds923`, content: 'officiel' }] : []),
          ...(scen === 'deux-groupes' ? [{ title: 'Forum : le DS923+ consomme plus', url: `${hosts('contre-lent')}/forum`, content: 'forum' }] : []),
        ];
        const liste = scen === 'contra-lente' && contraire ? [{ title: 'Démenti : le DS923+ consomme plus', url: `${hosts('contre-lent')}/dementi`, content: 'démenti' }] : contraire ? [] : base;
        setTimeout(() => envoyer(200, 'application/json', JSON.stringify({ results: liste })), etat.moteurMs);
        return;
      }
      const res8 = [
        { title: 'DS923+ : consommation mesurée', url: `${hosts('site-a')}/ds923-conso`, content: 'Le NAS DS923+ consomme environ 35 W.' },
        { title: 'Test du Synology DS923+', url: `${hosts('site-b')}/test-ds923`, content: 'Mesures au wattmètre.' },
        { title: 'Fiche technique DS923+', url: `${hosts('site-c')}/fiche`, content: 'Données officielles.' },
        ...(scen === 'realiste' ? [
          { title: 'Forum : DS923+ et facture', url: `${hosts('lent')}/forum`, content: 'Un fil de discussion.' },
          { title: 'Actualité NAS', url: `${hosts('surcharge')}/actu`, content: 'Actualité.' },
          { title: 'Comparatif géant des NAS 2026', url: `${hosts('lourd')}/comparatif`, content: 'Comparatif.' },
          { title: 'Forum : suite de la discussion', url: `${hosts('lent')}/forum-2`, content: 'Suite.' },
        ] : []),
        { title: 'DS923+ : seconde page du même site', url: `${hosts('site-a')}/ds923-veille`, content: 'Veille et hibernation.' },
        { title: 'Retour de lecteur DS923+', url: `${hosts('site-d')}/lecteur`, content: 'Facture annuelle.' },
        { title: 'Test complet DS923+', url: `${hosts('site-e')}/test`, content: 'Conclusion.' },
      ].map((x) => ({ ...x, content: `${x.content} (${q.slice(0, 20)})` }));
      // Une requête qui cherche la contradiction ne ramène pas toute la liste : deux pages (comme un vrai moteur, qui
      // répond autre chose à « … plus élevée que prévu »). Ces pages-là sont attendues par la collecte.
      const pourContra = res8.filter((x) => /site-c|site-e/.test(x.url));
      setTimeout(() => envoyer(200, 'application/json', JSON.stringify({ results: contraire ? pourContra : res8 })), scen === 'moteur-lent' ? 4000 : etat.moteurMs);
      return;
    }
    const nom = (hote ?? '').replace(/-r\d+\.(test|gouv\.fr)$/, '');
    if (nom === 'contre-lent') { const t = setTimeout(() => envoyer(200, 'text/html; charset=utf-8', page(nom, 'Démenti sur la consommation du DS923+', ['FAUX : le NAS Synology DS923+ consomme en réalité environ 60 watts, pas 35.', 'Nos relevés sur un mois contredisent la fiche du constructeur.'])), 7000); res.on('close', () => clearTimeout(t)); return; }
    if (nom === 'officiel') { const t = setTimeout(() => envoyer(200, 'text/html; charset=utf-8', page(nom, 'Rapport officiel : consommation des NAS', ['Le rapport officiel indique que le DS923+ consomme 35 watts en fonctionnement.', 'Mesure réalisée par le laboratoire public de référence.'])), 7000); res.on('close', () => clearTimeout(t)); return; }
    const lettre = /^site-([a-e])$/.exec(nom)?.[1];
    if (lettre) { const p2 = u.pathname.includes('veille'); setTimeout(() => envoyer(200, 'text/html; charset=utf-8', page(nom, `${nom} — ${p2 ? 'veille' : 'consommation'} du DS923+`, p2 ? [...PHRASES[lettre]].reverse() : PHRASES[lettre])), 60 + lettre.charCodeAt(0) % 5 * 20); return; }
    if (nom === 'lent') { const t = setTimeout(() => envoyer(200, 'text/html', page(nom, 'Forum lent', PHRASES.d)), 30_000); res.on('close', () => clearTimeout(t)); return; }
    if (nom === 'lourd') { envoyer(200, 'text/html; charset=utf-8', page(nom, 'Comparatif géant', PHRASES.e, 3_000_000)); return; }
    if (nom === 'surcharge') { envoyer(429, 'text/plain', 'trop de requêtes', { 'retry-after': '3' }); return; }
    envoyer(404, 'text/plain', 'inconnu');
  });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const port = (serveur.address() as { port: number }).port;
  return { port, serveur, requetes, get moteurMs() { return etat.moteurMs; }, set moteurMs(v: number) { etat.moteurMs = v; }, fermer: () => new Promise<void>((ok) => { serveur.closeAllConnections?.(); serveur.close(() => ok()); }) } as FauxWeb;
}

// Les noms .test vont au faux web ; tout le reste est refusé et compté.
export const horsBanc = { tentatives: 0, adresses: [] as string[] };
let PORT = 0;
/** Dirige les noms en .test vers ce faux web (pour un essai qui monte son propre faux web). */
export function brancher(web: FauxWeb): void { PORT = web.port; }
const fetchOrigine = globalThis.fetch;
globalThis.fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
  const url = typeof entree === 'string' ? entree : entree instanceof URL ? entree.href : entree.url;
  const m = /^https?:\/\/([a-z0-9-]+\.test|[a-z0-9]+-r\d+\.gouv\.fr)(\/.*)?$/i.exec(url);
  if (m && PORT) return fetchOrigine(`http://127.0.0.1:${PORT}/${m[1]}${m[2] ?? '/'}`, init);
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return fetchOrigine(entree as never, init);
  horsBanc.tentatives++; horsBanc.adresses.push(url.slice(0, 80));
  throw new Error('réseau coupé par le banc de rapidité');
}) as typeof fetch;
const lookupOrigine = dnsp.lookup;
(dnsp as unknown as { lookup: unknown }).lookup = (async (h: string, o?: unknown) => (/\.test$|-r\d+\.gouv\.fr$/i.test(h) ? [{ address: '93.184.216.34', family: 4 }] : (lookupOrigine as (h: string, o?: unknown) => Promise<unknown>)(h, o))) as never;
syncBuiltinESMExports();

// ------------------------------------------------------------------------------------------------ faux modèle
const dormir = (t: number) => new Promise<void>((r) => setTimeout(r, t));
/** Le faux modèle de la recherche (chercheur, vérificateur, rédacteur), à délai fixe. */
export function fauxLlm(delaiMs: number, journal: Array<{ role: string; debut: number; fin: number }>) {
  return async (system: string, user: string): Promise<string> => {
    const role = system.startsWith('Tu es le CHERCHEUR') ? 'chercheur' : system.startsWith('Tu es le VÉRIFICATEUR') ? 'verificateur' : system.startsWith('Tu es le RÉDACTEUR') ? 'redacteur' : 'autre';
    const debut = performance.now(); await dormir(delaiMs);
    let out = 'ok';
    if (role === 'chercheur') out = JSON.stringify({ type: 'fait', claims: ['Le NAS Synology DS923+ consomme environ 35 watts en fonctionnement'], country: '', period: 'actuelle', precision: 'watts', queries: ['consommation DS923+ watts', 'DS923+ power consumption', 'fiche technique DS923+ consommation'], contra: ['DS923+ consommation plus élevée que prévu'] });
    else if (role === 'verificateur') {
      // Cite mot pour mot la première phrase de chaque source (comme un bon vérificateur) : la validation la contrôle.
      const ev: Array<{ source: number; quote: string; stance: string }> = [];
      // Une page qui dit « FAUX » contredit (stance « contre ») : la validation doit la voir.
      for (const bloc of user.split(/\n(?=\[\d+\] )/)) {
        const m = /^\[(\d+)\] [^\n]*\n([\s\S]*)$/.exec(bloc); if (!m) continue;
        const lignes = m[2].split('\n').filter((l) => l.length >= 20 && !/^\[|^<|^>/.test(l)), contre = lignes.find((l) => /\bFAUX\b/.test(l));
        const ligne = contre ?? lignes[0]; if (!ligne) continue;
        const q = (contre ? ligne.slice(ligne.indexOf('FAUX')) : ligne).split(/(?<=\.)\s/)[0].slice(0, 200);
        if (q.length >= 12) ev.push({ source: Number(m[1]), quote: q, stance: contre ? 'contre' : 'pour' });
      }
      out = JSON.stringify({ claims: [{ claim: 'Le NAS Synology DS923+ consomme environ 35 watts en fonctionnement', kind: 'fait', evidence: ev }], new_claims: [] });
    } else if (role === 'redacteur') out = 'Le DS923+ consomme environ 35 W en fonctionnement [1][2]. ✓ confirmé par plusieurs sources indépendantes.\n\nSources : [1] … [2] …';
    journal.push({ role, debut, fin: performance.now() });
    return out;
  };
}

// ------------------------------------------------------------------------------------------------ une recherche vérifiée
async function uneRecherche(web: FauxWeb, o: { scenario: 'propre' | 'realiste' | 'moteur-lent'; depth: 'rapide' | 'normale'; llmMs: number; run: number; collecteMaxMs?: number }) {
  const { research } = await import('../../src/research/research.ts');
  const fetchMod = await import('../../src/research/fetch.ts'), { politeFetch } = fetchMod;
  const lecture = (fetchMod as { LECTURE_RECHERCHE?: object }).LECTURE_RECHERCHE ?? {}; // comme l'outil web_research
  const etapes: Array<{ t: number; etape: string }> = [], llm: Array<{ role: string; debut: number; fin: number }> = [], pages: Array<{ url: string; debut: number; fin: number; ok: boolean; octets: number; erreur?: string }> = [];
  const t0 = performance.now();
  const fetchPage = async (u: string, fin?: AbortSignal) => {
    const p = { url: u, debut: performance.now() - t0, fin: 0, ok: false, octets: 0 } as (typeof pages)[number]; pages.push(p);
    const lire = politeFetch(u, { allowPrivate: false, signal: fin, ...lecture });
    try {
      const r = o.collecteMaxMs ? await Promise.race([lire, dormir(o.collecteMaxMs).then(() => { throw new Error(`délai de collecte (${o.collecteMaxMs} ms) dépassé`); })]) : await lire;
      p.ok = true; p.octets = r.text.length; return r;
    } catch (e) { p.erreur = (e as Error).message.slice(0, 80); throw e; } finally { p.fin = performance.now() - t0; }
  };
  const { r, maxMs, p99Ms } = await retardBoucle(() => research('Combien consomme le NAS Synology DS923+ ?', {
    llm: fauxLlm(o.llmMs, llm), depth: o.depth, provider: 'searxng', searxngUrl: `http://127.0.0.1:${web.port}/moteur/${o.scenario}/r${o.run}`, env: {}, fetchPage,
    onStep: (s) => etapes.push({ t: performance.now() - t0, etape: s }),
  }));
  const total = performance.now() - t0;
  return {
    total, etapes: etapes.map((e) => ({ ...e, t: Math.round(e.t) })), llm: llm.map((x) => ({ role: x.role, debut: Math.round(x.debut - t0), fin: Math.round(x.fin - t0) })),
    pages: pages.map((p) => ({ ...p, debut: Math.round(p.debut), fin: Math.round(p.fin) })),
    sources: r.sources.length, groupes: new Set(r.sources.map((s) => s.cluster)).size, verdicts: r.claims.map((c) => `${c.verdict} (${c.independent} groupe(s), ${c.evidence.length} preuve(s))`),
    erreurs: r.errors, moteurs: r.engines, boucleMaxMs: Math.round(maxMs * 10) / 10, boucleP99Ms: Math.round(p99Ms * 10) / 10,
    premierePageUtile: Math.min(...pages.filter((p) => p.ok).map((p) => p.fin)),
  };
}

// ------------------------------------------------------------------------------------------------ un tour « cherche-moi… »
async function tourAgent(web: FauxWeb, llmMs: number, run: number) {
  const { createOdin } = await import('../../src/runtime.ts');
  const { Gateway } = await import('../../src/bifrost/gateway.ts');
  const journal: Array<{ role: string; debut: number; fin: number }> = [];
  const llm = fauxLlm(llmMs, journal);
  const appels: number[] = [];
  const provider: Provider = {
    name: 'faux', async complete(req: CompletionRequest): Promise<ModelResponse> {
      appels.push(performance.now());
      const usage = { inputTokens: 100, outputTokens: 50 };
      if (/^Tu es le (CHERCHEUR|VÉRIFICATEUR|RÉDACTEUR)/.test(req.system)) return { text: await llm(req.system, String(req.messages.at(-1)?.content ?? '')), toolCalls: [], usage, stopReason: 'end' };
      if (req.system.startsWith('Tu relis')) { await dormir(llmMs); return { text: '{"ok": true}', toolCalls: [], usage, stopReason: 'end' }; }
      const last = req.messages.at(-1);
      await dormir(llmMs);
      if (last?.role !== 'tool') return { text: '', toolCalls: [{ id: `c${appels.length}`, name: 'web_research', input: { question: 'Combien consomme le NAS Synology DS923+ ?', depth: 'rapide' } }], usage, stopReason: 'tool_use' };
      const texte = '[humeur:satisfaction] Le DS923+ consomme environ 35 W en fonctionnement (confirmé par plusieurs sources indépendantes).';
      for (let i = 0; i < texte.length; i += 12) { req.onDelta?.(texte.slice(i, i + 12)); await dormir(20); }
      return { text: texte, toolCalls: [], usage, stopReason: 'end' };
    },
  };
  const home = mkdtempSync(join(tmpdir(), 'odin-rapidite-web-'));
  const odin = createOdin({ home, provider, approver: { approve: async () => true }, configOverride: (c) => ({ ...c, search: { ...c.search, provider: 'searxng', searxngUrl: `http://127.0.0.1:${web.port}/moteur/propre/t${run}` }, learning: { ...c.learning, observe: false }, journal: { ...c.journal, enabled: false }, watch: { ...c.watch, enabled: false }, continuous: { ...c.continuous, enabled: false, autoResume: false }, quiet: { ...c.quiet, enabled: false }, veille: { enabled: false, at: '12:30' }, update: { auto: 'off' as const, everyHours: 6 }, mimir: { ...c.mimir, enabled: false } }) });
  const evts: Array<{ t: number; type: string; nom?: string }> = []; let envoi = 0;
  const canal = { name: 'web', interactive: true, async start() {}, async stop() {}, async send() { envoi = performance.now(); }, event(_p: string, e: AgentEvent) { evts.push({ t: performance.now(), type: e.type, nom: (e as { name?: string }).name }); } };
  const gw = new Gateway(odin, { owners: { web: ['moi'] } }).add(canal as never);
  const t0 = performance.now();
  const { maxMs } = await retardBoucle(() => gw.handle({ channel: 'web', peer: 'moi', name: 'moi', text: 'Cherche-moi combien consomme le NAS Synology DS923+, avec des sources.' }));
  const fin = performance.now() - t0;
  const premier = (type: string) => { const e = evts.find((x) => x.type === type); return e ? Math.round(e.t - t0) : NaN; };
  try { odin.close(); rmSync(home, { recursive: true, force: true }); } catch { /* */ }
  const ts = evts.find((x) => x.type === 'tool_start')?.t ?? 0, te = evts.find((x) => x.type === 'tool_end')?.t ?? 0;
  const pendant = evts.filter((x) => x.t > ts && x.t < te).map((x) => x.type);
  return { evenementsPendantRecherche: pendant.length, typesPendantRecherche: [...new Set(pendant)], fin: Math.round(fin), reponseEnvoyee: Math.round(envoi - t0), thinking: premier('thinking'), toolStart: premier('tool_start'), toolEnd: premier('tool_end'), premierMot: premier('delta'), mood: premier('mood'), appelsModele: appels.length, boucleMaxMs: Math.round(maxMs), etapesRecherche: journal.map((j) => `${j.role} ${Math.round(j.debut - t0)}→${Math.round(j.fin - t0)}`) };
}

// ------------------------------------------------------------------------------------------------ programme
export async function bancWeb(o: { court?: boolean } = {}) {
  const web = await fauxWeb(); PORT = web.port;
  const charge = await chargeMachine(1000);
  const res: Record<string, unknown> = { charge };
  const lignes: Array<Array<string | number>> = [];
  let run = 0;
  const cas: Array<{ nom: string; scenario: 'propre' | 'realiste' | 'moteur-lent'; depth: 'rapide' | 'normale'; llmMs: number; n: number; collecteMaxMs?: number }> = [
    { nom: 'propre, normale, modèle 0 ms (temps propre)', scenario: 'propre', depth: 'normale', llmMs: 0, n: o.court ? 2 : 5 },
    { nom: 'propre, normale, modèle 1 s', scenario: 'propre', depth: 'normale', llmMs: 1000, n: o.court ? 1 : 3 },
    { nom: 'propre, rapide, modèle 1 s', scenario: 'propre', depth: 'rapide', llmMs: 1000, n: o.court ? 1 : 3 },
    { nom: 'réaliste (lent 30 s, lourd 3 Mo, 429), normale, modèle 1 s', scenario: 'realiste', depth: 'normale', llmMs: 1000, n: o.court ? 1 : 2 },
    { nom: 'MAQUETTE réaliste + délai de collecte 6 s', scenario: 'realiste', depth: 'normale', llmMs: 1000, n: o.court ? 1 : 2, collecteMaxMs: 6000 },
    { nom: 'moteur lent (4 s), normale, modèle 1 s', scenario: 'moteur-lent', depth: 'normale', llmMs: 1000, n: o.court ? 1 : 2 },
  ];
  const parCas: Record<string, unknown> = {};
  for (const c of cas) {
    const runs = [];
    for (let i = 0; i < c.n; i++) runs.push(await uneRecherche(web, { ...c, run: ++run }));
    const t = stat(runs.map((x) => x.total)), pu = stat(runs.map((x) => x.premierePageUtile));
    parCas[c.nom] = { total: t, premierePageUtile: pu, exemple: runs[0], verdicts: runs.map((x) => x.verdicts.join(' ; ')), boucleMax: stat(runs.map((x) => x.boucleMaxMs)) };
    lignes.push([c.nom, ms(t.mediane), ms(t.max), ms(pu.mediane), runs[0].sources, runs[0].groupes, runs[0].verdicts.join(' ; ').slice(0, 50), ms(stat(runs.map((x) => x.boucleMaxMs)).max)]);
  }
  res.recherche = parCas;
  // Le tour complet « cherche-moi… » par la passerelle (profondeur rapide, modèle 1 s).
  const tours = [];
  for (let i = 0; i < (o.court ? 1 : 3); i++) tours.push(await tourAgent(web, 1000, ++run));
  res.tourAgent = tours;
  res.horsBanc = horsBanc;
  await web.fermer();
  const texte = `Recherche web (faux web local) — charge machine ${charge.occupation} %.\n` +
    tableau(['cas', 'total méd.', 'total max', '1re page utile', 'sources', 'groupes', 'verdict', 'fil bloqué max'], lignes) +
    `\n\nFrise d'un cas réaliste : ${JSON.stringify((parCas['réaliste (lent 30 s, lourd 3 Mo, 429), normale, modèle 1 s'] as { exemple: { etapes: unknown; pages: unknown; llm: unknown } }).exemple, null, 0).slice(0, 3000)}\n` +
    `\nTour « cherche-moi… » (passerelle, modèle 1 s, profondeur rapide) :\n${tours.map((t) => JSON.stringify(t)).join('\n')}\n` +
    `Adresses hors banc tentées (refusées) : ${horsBanc.tentatives} ${[...new Set(horsBanc.adresses.map((a) => a.replace(/^(https?:\/\/[^/]+).*/, '$1')))].join(', ')}\n`;
  return { res, texte };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const court = process.argv.includes('--court');
  const { res, texte } = await bancWeb({ court });
  ecrireResultat(`web${court ? '-court' : ''}`, res, texte);
  console.log(texte);
  process.exit(0);
}
