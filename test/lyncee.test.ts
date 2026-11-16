// Lyncée, le moteur de Pythie : fusion de plusieurs moteurs, santé (pauses croissantes), débit poli, cache court,
// filtre des résultats, requêtes sans cookie ni référent, questions notées. Faux fetch par hôte : AUCUN service réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { categorieDe, creerLyncee } from '../src/valhalla/volva/lyncee/meta.ts';
import { nettoyer } from '../src/valhalla/volva/lyncee/filtre.ts';
import { effacerQuestions, noterQuestion, questionsRecentes } from '../src/valhalla/volva/questions.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { gather } from '../src/valhalla/modules/volva.ts';
import { webSearch, webSearchTool } from '../src/tools/search.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const MIN = 60_000;
// Pages de moteurs fabriquées (neutres) : chaque moteur renvoie les adresses qu'on lui donne.
const ddg = (us: string[]) => us.map((u) => `<div class="result results_links web-result"><h2 class="result__title"><a class="result__a" href="${u}">Titre ${u}</a></h2><a class="result__snippet">extrait</a></div>`).join('');
const brave = (us: string[]) => us.map((u) => `<div class="snippet" data-type="web"><a href="${u}"><div class="title search-snippet-title" title="Titre ${u}">x</div></a><div class="generic-snippet"><div class="content">extrait brave</div></div></div>`).join('');
const yahoo = (us: string[]) => us.map((u) => `<div class="dd algo algo-sr Sr"><div class="compTitle"><a href="${u}"><h3 class="title">Titre ${u}</h3></a></div></div>`).join('');
const bing = (us: string[]) => us.map((u) => `<li class="b_algo"><h2><a href="${u}">Titre ${u}</a></h2><p>extrait bing</p></li>`).join('');
const BING_BLOQUE = '<ol><li class="b_no">Aucun résultat</li></ol><script>var PoWChallenge={};</script>';
const imagesBing = (us: string[]) => us.map((u, i) => `<a class="iusc" m="${JSON.stringify({ purl: u, turl: `https://ts1.mm.bing.net/th?id=v${i}`, t: `Image ${i}` }).replace(/"/g, '&quot;')}" href="/x"></a>`).join('');

type Reponse = { status?: number; body?: string; headers?: Record<string, string>; jamais?: boolean };
function fauxFetch(regles: Record<string, (u: URL, init: RequestInit) => Reponse>) {
  const appels: Array<{ url: string; init: RequestInit }> = [];
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)); appels.push({ url: url.toString(), init });
    const r = (regles[url.hostname] ?? (() => ({ status: 404, body: 'non' })))(url, init);
    if (r.jamais) return new Promise<Response>((_, ko) => { init.signal?.addEventListener('abort', () => ko(Object.assign(new Error('délai'), { name: 'TimeoutError' }))); });
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, appels, vers: (h: string) => appels.filter((a) => new URL(a.url).hostname === h).length };
}
const WIKI_VIDE = () => ({ body: JSON.stringify({ query: { search: [] } }) });

test('fusion de plusieurs moteurs : une page vue par trois moteurs passe devant, 3 par site (6 en images)', async () => {
  let t = 1e12; const L = creerLyncee({ maintenant: () => t });
  const { f } = fauxFetch({
    'html.duckduckgo.com': () => ({ body: ddg(['https://seul.fr/a', 'https://meme.fr/1', 'https://meme.fr/2', 'https://meme.fr/3', 'https://meme.fr/4', 'https://commun.fr/page']) }),
    'search.brave.com': () => ({ body: brave(['https://autre.fr/b', 'https://commun.fr/page/']) }),
    'search.yahoo.com': () => ({ body: yahoo(['https://www.commun.fr/page?utm_source=x']) }),
    'www.bing.com': () => ({ body: BING_BLOQUE }),
    'fr.wikipedia.org': WIKI_VIDE,
  });
  const r = await L.chercher('hauteur tour', { fetcher: f, delai: 2000 });
  assert.equal(r.resultats[0].domain, 'commun.fr', 'vue par trois moteurs : en tête');
  assert.deepEqual(r.resultats[0].engines, ['DuckDuckGo', 'Brave', 'Yahoo']);
  assert.equal(r.resultats.filter((x) => x.domain === 'meme.fr').length, 3, 'trois pages au plus par site');
  assert.deepEqual(r.moteurs, ['DuckDuckGo', 'Brave', 'Yahoo', 'Wikipédia'], 'chaque moteur qui a répondu, dans l\'ordre');
  assert.ok(r.erreurs.some((e) => /^Bing en pause jusqu'à \d\d:\d\d : contrôle anti-robot$/.test(e)), r.erreurs.join(' ; '));
  assert.equal(r.duCache, false); assert.equal(r.categorie, 'web');
  t += MIN;
  // (une autre instance : Bing, en pause après son contrôle anti-robot, l'est pour toutes ses catégories)
  const im = await creerLyncee({ maintenant: () => t }).chercher('tour images', { categorie: 'images', fetcher: fauxFetch({ 'www.bing.com': () => ({ body: imagesBing(Array.from({ length: 9 }, (_, i) => `https://photos.fr/${i}`)) }) }).f, delai: 2000 });
  assert.equal(im.resultats.length, 6, 'six images au plus par site'); assert.match(im.resultats[0].thumb!, /^https:\/\/ts1\.mm\.bing\.net\//);
  assert.equal(categorieDe('wikipedia'), 'savoir'); assert.equal(categorieDe('sons'), 'videos'); assert.equal(categorieDe('tout'), 'web');
});

test('un moteur en panne ou lent n\'empêche pas les autres (délai par moteur)', async () => {
  const L = creerLyncee();
  const { f } = fauxFetch({
    'html.duckduckgo.com': () => ({ body: ddg(['https://ok.fr/a']) }),
    'lite.duckduckgo.com': () => ({ status: 500 }),
    'search.brave.com': () => ({ jamais: true }),
    'search.yahoo.com': () => ({ status: 503 }),
    'www.bing.com': () => ({ body: '<ol></ol>' }),
    'fr.wikipedia.org': WIKI_VIDE,
  });
  const debut = Date.now();
  const r = await L.chercher('panne', { fetcher: f, delai: 300 });
  assert.ok(Date.now() - debut < 2000, 'la recherche n\'attend pas le moteur lent');
  assert.deepEqual(r.resultats.map((x) => x.url), ['https://ok.fr/a']);
  assert.ok(r.erreurs.some((e) => /^Brave : ne répond pas/.test(e)), r.erreurs.join(' ; '));
  assert.ok(r.erreurs.some((e) => /^Yahoo : a répondu 503/.test(e)), r.erreurs.join(' ; '));
  assert.equal(L.etats().find((e) => e.id === 'brave')!.etat, 'pret', 'premier échec réseau : pas de pause');
});

test('santé : blocage → pause de 30 min puis 2 h, aucune requête pendant la pause, reprise ; 0 résultat ≠ blocage', async () => {
  let t = 1e12; const dir = mkdtempSync(join(tmpdir(), 'lyncee-'));
  try {
    const L = creerLyncee({ maintenant: () => t, dossier: dir });
    const ff = fauxFetch({ 'www.bing.com': () => ({ body: BING_BLOQUE }), 'html.duckduckgo.com': () => ({ body: '<html>rien</html>' }), 'fr.wikipedia.org': WIKI_VIDE });
    await L.chercher('q1', { fetcher: ff.f, delai: 1000 });
    let bi = L.etats().find((e) => e.id === 'bing')!;
    assert.deepEqual([bi.etat, bi.jusqua, bi.raison], ['pause', t + 30 * MIN, 'contrôle anti-robot']);
    const dd = L.etats().find((e) => e.id === 'duckduckgo')!;
    assert.deepEqual([dd.etat, dd.echecs], ['pret', 0], '0 résultat sans signe de blocage : pas de pause');
    assert.ok(JSON.parse(readFileSync(join(dir, 'lyncee-sante.json'), 'utf8')).bing.jusqua > t, 'santé gardée dans lyncee-sante.json');
    t += 5 * MIN; const avant = ff.vers('www.bing.com');
    const r2 = await L.chercher('q2', { fetcher: ff.f, delai: 1000 });
    assert.equal(ff.vers('www.bing.com'), avant, 'aucune requête pendant la pause');
    assert.ok(r2.pauses.some((p) => p.id === 'bing'));
    t += 30 * MIN; await L.chercher('q3', { fetcher: ff.f, delai: 1000 });
    assert.equal(ff.vers('www.bing.com'), avant + 1, 'réessayé à l\'échéance');
    bi = L.etats().find((e) => e.id === 'bing')!; assert.equal(bi.jusqua, t + 120 * MIN, 'puis 2 h');
    assert.equal(L.reprendre('bing'), true); assert.equal(L.etats().find((e) => e.id === 'bing')!.etat, 'pret', 'reprise à la main');
    assert.equal(L.reprendre('inconnu'), false);
    // Une nouvelle instance relit la santé gardée.
    assert.equal(creerLyncee({ maintenant: () => t, dossier: dir }).etats().find((e) => e.id === 'bing')!.etat, 'pret', 'reprise gardée');
    // Une limite de débit (429) : 5 min dès le premier échec.
    const L2 = creerLyncee({ maintenant: () => t });
    await L2.chercher('q4', { fetcher: fauxFetch({ 'search.brave.com': () => ({ status: 429 }) }).f, delai: 1000 });
    assert.equal(L2.etats().find((e) => e.id === 'brave')!.jusqua, t + 5 * MIN);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('débit poli, cache court, sans:[…], requêtes sans cookie ni référent', async () => {
  const t = 1e12; const L = creerLyncee({ maintenant: () => t });
  const ff = fauxFetch({ 'html.duckduckgo.com': () => ({ body: ddg(['https://a.fr/1']) }), 'fr.wikipedia.org': () => ({ body: JSON.stringify({ query: { search: [{ title: 'Page' }] } }) }) });
  const r1 = await L.chercher('Débit', { fetcher: ff.f, delai: 300 });
  assert.ok(r1.moteurs.includes('DuckDuckGo'));
  const n1 = ff.appels.length;
  const r2 = await L.chercher('débit', { fetcher: ff.f, delai: 300 });
  assert.equal(r2.duCache, true); assert.equal(ff.appels.length, n1, 'deuxième appel : rien ne part (cache, clé en minuscules)');
  const r3 = await L.chercher('autre question', { fetcher: ff.f, delai: 300 });
  assert.equal(ff.appels.length, n1, 'deux requêtes rapprochées vers un même moteur : sautées (intervalle minimal)');
  assert.ok(r3.erreurs.some((e) => /DuckDuckGo occupé/.test(e))); assert.equal(r3.pauses.length, 0, 'occupé : pas de pause');
  const L2 = creerLyncee(), f2 = fauxFetch({ 'html.duckduckgo.com': () => ({ body: ddg(['https://a.fr/1']) }) });
  await L2.chercher('savoir', { fetcher: f2.f, delai: 500, sans: ['wikipedia'] });
  assert.equal(f2.vers('fr.wikipedia.org'), 0, 'sans:["wikipedia"] respecté');
  for (const a of [...ff.appels, ...f2.appels]) {
    assert.equal(a.init.credentials, 'omit'); assert.equal(a.init.redirect, 'manual'); assert.equal(a.init.referrerPolicy, 'no-referrer');
    assert.ok(!Object.keys(a.init.headers as Record<string, string>).some((k) => /cookie|referer|authorization/i.test(k)), a.url);
  }
  // Une redirection vers un autre hôte n'est jamais suivie.
  const L3 = creerLyncee(), f3 = fauxFetch({ 'search.yahoo.com': () => ({ status: 302, headers: { location: 'http://192.168.1.1/' } }) });
  const r4 = await L3.chercher('redirection', { fetcher: f3.f, delai: 500 });
  assert.equal(f3.vers('192.168.1.1'), 0); assert.ok(r4.erreurs.some((e) => /Yahoo : redirection inattendue/.test(e)));
});

test('filtre : http(s) public seulement, liens directs, publicités et adresses de la maison refusées (pur)', () => {
  const ok = { title: '<b>Titre</b> &amp; plus', url: 'https://exemple.fr/a', snippet: 'x'.repeat(900), thumb: 'javascript:alert(1)' };
  assert.deepEqual(nettoyer(ok), { title: 'Titre & plus', url: 'https://exemple.fr/a', snippet: 'x'.repeat(500) }, 'texte clair, borné, vignette dangereuse retirée');
  for (const url of ['javascript:alert(1)', 'http://192.168.1.2/', 'http://10.0.0.1/admin', 'https://box.local/', 'http://routeur.lan/', 'http://nas.home.arpa/', 'http://localhost:8080/', 'http://[::1]/', 'http://intranet/', 'https://duckduckgo.com/y.js?ad_domain=x', 'https://www.bing.com/aclick?ld=1', 'https://r.search.yahoo.com/cbclk2/x/RU=https%3a%2f%2fa.fr/RK=0', 'https://www.googleadservices.com/pagead/aclk', 'ftp://exemple.fr/f', 'https://user:mdp@exemple.fr/'])
    assert.equal(nettoyer({ title: 't', url, snippet: '' }), undefined, url);
  assert.equal(nettoyer({ title: 't', url: '//duckduckgo.com/l/?uddg=http%3A%2F%2F10.0.0.1%2F', snippet: '' }), undefined, 'adresse locale cachée dans un lien de moteur');
  assert.equal(nettoyer({ title: 't', url: 'https://r.search.yahoo.com/RV=2/RU=https%3a%2f%2fexemple.fr%2fb/RK=2', snippet: '' })!.url, 'https://exemple.fr/b');
  assert.equal(nettoyer({ title: '', url: 'https://exemple.fr/c', snippet: '', thumb: 'http://192.168.0.5/t.jpg' })!.thumb, undefined, 'vignette locale retirée');
});

test('questions notées pour les suggestions : sans doublon, réglable, effaçable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'questions-'));
  try {
    const settings: Record<string, unknown> = {}, ctx = { dir, settings } as unknown as ModCtx;
    noterQuestion(ctx, 'Hauteur tour Eiffel'); noterQuestion(ctx, 'météo demain'); noterQuestion(ctx, 'hauteur tour eiffel');
    assert.deepEqual(questionsRecentes(ctx).map((x) => x.q), ['hauteur tour eiffel', 'météo demain'], 'la plus récente en tête, sans doublon');
    for (let i = 0; i < 230; i++) noterQuestion(ctx, `q${i}`);
    assert.equal(questionsRecentes(ctx).length, 200, '200 au plus');
    settings.noterQuestions = false; noterQuestion(ctx, 'secrète');
    assert.ok(!questionsRecentes(ctx).some((x) => x.q === 'secrète'), 'réglage coupé : rien n\'est noté');
    effacerQuestions(ctx); assert.deepEqual(questionsRecentes(ctx), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Pythie sans instance externe ni clé : résultats, vignettes, outil web_search et webSearch passent par Lyncée', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pythie-lyncee-'));
  const fake = fauxFetch({
    'html.duckduckgo.com': () => ({ body: ddg(['https://commun.fr/page', 'https://ddg.fr/a']) }),
    'search.brave.com': (u) => ({ body: u.pathname === '/images' ? '' : brave(['https://commun.fr/page']) }),
    'www.bing.com': (u) => ({ body: u.pathname.startsWith('/images') ? imagesBing(['https://photos.fr/1', 'https://photos.fr/2']) : '<ol></ol>' }),
    'fr.wikipedia.org': WIKI_VIDE,
    'commons.wikimedia.org': () => ({ body: readFileSync(join(import.meta.dirname, 'echantillons-lyncee', 'commons.json'), 'utf8') }),
  });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fake.f, notify: async () => {}, autonomy: () => 'equilibre' } as never);
  setValhalla(v);
  try {
    const ctx = v.ctx('volva');
    // Les onglets Images (/api/recherche/medias passe par gather) : de vraies vignettes, sans instance externe.
    const g = await gather(ctx, 'tour eiffel photos', 'images', 24);
    const ly = g.lists.find((l) => l.engine === 'Lyncée')!;
    assert.ok(ly && ly.results.length >= 3, JSON.stringify(g.errors));
    assert.ok((ly.results as Array<{ thumb?: string }>).every((r) => /^https:\/\//.test(r.thumb ?? '')), 'chaque image a sa vignette');
    assert.ok(!fake.appels.some((a) => /searx|:8888/.test(a.url)), 'aucune instance externe');
    // L'outil de recherche d'Odin, en « auto » sans clé : Pythie, donc Lyncée.
    const out = await webSearchTool.run({ query: 'question pour lyncee' }, { signal: AbortSignal.timeout(20_000) } as never);
    const texte = typeof out === 'string' ? out : String(out.output);
    assert.match(texte, /<untrusted/); assert.match(texte, /Pythie : DuckDuckGo, Brave/);
    // webSearch sans clé : Lyncée d'abord.
    const w = await webSearch('autre question pour lyncee', 5, { env: {}, fetcher: fake.f });
    assert.equal(w.provider, 'lyncee'); assert.ok(w.results.some((r) => r.url === 'https://commun.fr/page'));
  } finally { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('contrôle anti-robot ou limite : aucun nouvel essai par une autre porte du même service, pause commune', async () => {
  let t = 1e12; const L = creerLyncee({ maintenant: () => t });
  // DuckDuckGo (page html) affiche son contrôle : la version légère n'est jamais appelée, les deux sont en pause.
  const ff = fauxFetch({ 'html.duckduckgo.com': () => ({ body: '<div class="anomaly-modal">bots use DuckDuckGo too</div>' }), 'lite.duckduckgo.com': () => ({ body: ddg(['https://a.fr/1']) }), 'fr.wikipedia.org': WIKI_VIDE });
  await L.chercher('q1', { fetcher: ff.f, delai: 1000 });
  assert.equal(ff.vers('lite.duckduckgo.com'), 0, 'pas de repli après un contrôle');
  const etat = (id: string) => L.etats().find((e) => e.id === id)!.etat;
  assert.deepEqual([etat('duckduckgo'), etat('duckduckgo_lite')], ['pause', 'pause']);
  t += MIN; await L.chercher('q2', { fetcher: ff.f, delai: 1000 });
  assert.equal(ff.vers('lite.duckduckgo.com') + ff.vers('html.duckduckgo.com'), 1, 'rien pendant la pause, par aucune porte');
  // Une limite (202) : pareil.
  const L2 = creerLyncee({ maintenant: () => t }), f2 = fauxFetch({ 'html.duckduckgo.com': () => ({ status: 202 }), 'lite.duckduckgo.com': () => ({ body: ddg(['https://a.fr/1']) }) });
  await L2.chercher('q3', { fetcher: f2.f, delai: 1000 }); assert.equal(f2.vers('lite.duckduckgo.com'), 0);
  // Une PANNE de la page html : la version légère sert de repli.
  const L3 = creerLyncee({ maintenant: () => t }), f3 = fauxFetch({ 'html.duckduckgo.com': () => ({ status: 503 }), 'lite.duckduckgo.com': () => ({ body: '<table><tr><td><a rel="nofollow" href="https://a.fr/1" class="result-link">A</a></td></tr></table>' }) });
  await L3.chercher('q4', { fetcher: f3.f, delai: 1000 }); assert.equal(f3.vers('lite.duckduckgo.com'), 1, 'repli en cas de panne');
  // Brave refuse en Web (429) : ses onglets Images, Vidéos et Actualités ne le sollicitent plus.
  const L4 = creerLyncee({ maintenant: () => t }), f4 = fauxFetch({ 'search.brave.com': () => ({ status: 429 }) });
  await L4.chercher('q5', { fetcher: f4.f, delai: 1000 });
  for (const c of ['images', 'videos', 'actualites'] as const) await L4.chercher('q5', { categorie: c, fetcher: f4.f, delai: 1000 });
  assert.equal(f4.vers('search.brave.com'), 1, 'un seul appel à Brave');
  assert.ok(['brave', 'brave_images', 'brave_videos', 'brave_actus'].every((id) => L4.etats().find((e) => e.id === id)!.etat === 'pause'));
  assert.equal(L4.reprendre('brave_images'), true); assert.equal(L4.etats().find((e) => e.id === 'brave')!.etat, 'pret', 'reprise de tout le service');
  // Bing bloqué en Web : Bing Images ne l'interroge plus non plus.
  const L5 = creerLyncee({ maintenant: () => t }), f5 = fauxFetch({ 'www.bing.com': () => ({ body: BING_BLOQUE }) });
  await L5.chercher('q6', { fetcher: f5.f, delai: 1000 }); await L5.chercher('q6', { categorie: 'images', fetcher: f5.f, delai: 1000 });
  assert.equal(f5.vers('www.bing.com'), 1);
});

test('débit par hôte : deux adaptateurs du même hôte ne partent pas ensemble', async () => {
  const L = creerLyncee(), ff = fauxFetch({ 'search.brave.com': () => ({ body: '' }), 'www.bing.com': () => ({ body: '' }) });
  await Promise.all([L.chercher('h1', { categorie: 'images', fetcher: ff.f, delai: 300 }), L.chercher('h1', { categorie: 'videos', fetcher: ff.f, delai: 300 })]);
  assert.equal(ff.vers('www.bing.com'), 1, 'Bing Images puis Bing Vidéos : le second attend l\'intervalle, donc sauté');
  assert.equal(ff.vers('search.brave.com'), 1);
});

test('cache : la liste la plus large est gardée, chaque appel la découpe à son n', async () => {
  const L = creerLyncee(), urls = Array.from({ length: 20 }, (_, i) => `https://site${i}.fr/p`);
  const ff = fauxFetch({ 'html.duckduckgo.com': () => ({ body: ddg(urls) }) });
  const a = await L.chercher('cache n', { fetcher: ff.f, delai: 500, n: 5, sans: ['wikipedia'] });
  const b = await L.chercher('cache n', { fetcher: ff.f, delai: 500, n: 40, sans: ['wikipedia'] });
  assert.equal(a.resultats.length, 5); assert.equal(b.duCache, true); assert.equal(b.resultats.length, 20);
});

test('un seul moteur répond (Wikipédia) : ses dix résultats restent, l\'avis « aucun grand moteur » est donné', async () => {
  const L = creerLyncee();
  const wiki = () => ({ body: JSON.stringify({ query: { search: Array.from({ length: 10 }, (_, i) => ({ title: `Page ${i}` })) } }) });
  const ff = fauxFetch({ 'fr.wikipedia.org': wiki, 'html.duckduckgo.com': () => ({ status: 202 }), 'search.brave.com': () => ({ status: 429 }), 'search.yahoo.com': () => ({ status: 500 }), 'www.bing.com': () => ({ body: BING_BLOQUE }) });
  const r = await L.chercher('wiki seul', { fetcher: ff.f, delai: 1000 });
  assert.equal(r.resultats.length, 10); assert.equal(r.erreurs[0], 'Web : aucun grand moteur ne répond (au mieux Wikipédia)');
  const sv = await creerLyncee().chercher('wiki savoir', { categorie: 'savoir', fetcher: fauxFetch({ 'fr.wikipedia.org': wiki, 'www.wikidata.org': () => ({ body: '{"search":[]}' }) }).f, delai: 1000 });
  assert.equal(sv.resultats.length, 10, 'Savoir : pas de coupe par site');
});

test('Google Actualités : la limite par site suit le journal, pas news.google.com', async () => {
  const item = (i: number) => `<item><title>Titre ${i} - Journal ${i}</title><link>https://news.google.com/rss/articles/A${i}?oc=5</link><source url="https://journal${i}.exemple">Journal ${i}</source></item>`;
  const ff = fauxFetch({ 'news.google.com': () => ({ body: `<rss><channel>${Array.from({ length: 8 }, (_, i) => item(i)).join('')}</channel></rss>` }) });
  const r = await creerLyncee().chercher('actus', { categorie: 'actualites', fetcher: ff.f, delai: 1000 });
  assert.equal(r.resultats.length, 8); assert.equal(r.resultats[0].domain, 'journal0.exemple'); assert.match(r.resultats[0].snippet, /lien via Google Actualités/);
});

test('webSearch « auto » : Wikipédia seul ne suffit pas, le secours passe avant, sans réinterroger un service en pause', async () => {
  const wiki = () => ({ body: JSON.stringify({ query: { search: [{ title: 'Tour Eiffel' }] } }) });
  const ff = fauxFetch({ 'fr.wikipedia.org': wiki, 'html.duckduckgo.com': () => ({ status: 202 }), 'lite.duckduckgo.com': () => ({ status: 202 }), 'search.brave.com': () => ({ status: 429 }), 'search.yahoo.com': () => ({ status: 500 }), 'www.bing.com': () => ({ body: BING_BLOQUE }),
    'www.mojeek.com': () => ({ body: '<ul><li class="r1"><a class="title" href="https://mojeek.exemple/a">Mojeek A</a><p class="s">texte</p></li></ul>' }) });
  const w = await webSearch('question wiki seul secours', 5, { env: {}, fetcher: ff.f });
  assert.equal(w.provider, 'mojeek'); assert.deepEqual(w.results.map((r) => r.url), ['https://mojeek.exemple/a']);
  assert.match(w.note ?? '', /en pause|occupé/);
  assert.ok(ff.vers('html.duckduckgo.com') <= 1, 'DuckDuckGo en pause : le secours ne le réinterroge pas');
  assert.ok(ff.vers('www.bing.com') <= 1, 'Bing en pause : idem');
  // Sans aucun secours : la liste partielle de Wikipédia, avec l'avis.
  const f2 = fauxFetch({ 'fr.wikipedia.org': wiki });
  const w2 = await webSearch('question wiki seul sans secours', 5, { env: {}, fetcher: f2.f, provider: 'lyncee' });
  assert.equal(w2.provider, 'lyncee'); assert.equal(w2.results.length, 1); assert.ok(w2.note);
});