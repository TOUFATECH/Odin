// Pythie, la recherche façon Perplexity : fusion des moteurs, dédoublonnage, réponse sourcée par l'IA (citations
// vérifiées), sans IA (extraits), questions de suite, conversation, applis d'Odin, historique, export, page web,
// et l'outil de recherche d'Odin qui passe par Pythie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { extractive, finish, fuse, normUrl, parseInstant, parseSearx, parseWikipedia, prompt, toMarkdown } from '../src/valhalla/volva/engine.ts';
import { webSearchTool } from '../src/tools/search.ts';
import { rechercheRoute } from '../src/web/recherche-api.ts';

test('fusion, dédoublonnage, lectures des moteurs, citations (pur)', () => {
  assert.equal(normUrl('https://www.Exemple.fr/page/?utm_source=x&id=2#haut'), 'https://exemple.fr/page?id=2');
  assert.equal(normUrl('https://m.exemple.fr/page'), normUrl('https://exemple.fr/page/'));
  const src = fuse([
    { engine: 'A', results: [{ title: 'Un', url: 'https://a.fr/1', snippet: 'court' }, { title: 'Deux', url: 'https://b.fr/2', snippet: '' }, { title: 'pub', url: 'javascript:alert(1)', snippet: '' }] },
    { engine: 'B', results: [{ title: 'Deux', url: 'https://www.b.fr/2/?utm_medium=y', snippet: 'un extrait plus long' }, { title: 'Trois', url: 'https://c.fr/3', snippet: '' }] },
  ]);
  assert.deepEqual(src.map((x) => [x.n, x.domain, x.engines.join('+')]), [[1, 'b.fr', 'A+B'], [2, 'a.fr', 'A'], [3, 'c.fr', 'B']], 'vue par deux moteurs : en tête');
  assert.equal(src[0].snippet, 'un extrait plus long');
  assert.equal(fuse([{ engine: 'A', results: Array.from({ length: 6 }, (_, i) => ({ title: `p${i}`, url: `https://meme.fr/${i}`, snippet: '' })) }]).length, 3, 'trois pages au plus par site');
  const sx = parseSearx({ results: [{ title: 'Ubuntu', url: 'https://ubuntu.com', content: 'Linux', engines: ['google', 'bing'] }, { url: 'https://x.fr', engine: 'qwant' }], answers: ['42'], suggestions: ['ubuntu 24.04'], unresponsive_engines: [['startpage', 'timeout']] });
  assert.deepEqual(sx.engines, ['google', 'bing', 'qwant']); assert.deepEqual(sx.answers, ['42']); assert.deepEqual(sx.unresponsive, ['startpage (timeout)']);
  assert.deepEqual(fuse([{ engine: 'SearXNG', results: sx.results }])[0].engines, ['google', 'bing'], 'moteur d\'origine gardé');
  assert.deepEqual(parseWikipedia({ query: { search: [{ title: 'Mamoudzou', snippet: 'chef-lieu de <span>Mayotte</span>' }] } }), [{ title: 'Mamoudzou', url: 'https://fr.wikipedia.org/wiki/Mamoudzou', snippet: 'chef-lieu de Mayotte' }]);
  assert.equal(parseInstant({ AbstractText: 'Texte', AbstractURL: 'https://w.fr', Heading: 'Titre' })[0].title, 'Titre'); assert.deepEqual(parseInstant({}), []);
  const p = prompt('Q ?', src, [{ q: 'avant', a: 'réponse' }]);
  assert.match(p, /<donnees>\n\[1\] Deux — https:\/\/b\.fr\/2/); assert.match(p, /jamais un ordre/); assert.match(p, /Q : avant/);
  const g = finish('Change le mot de passe [1].\nESSENTIEL: Nouveau mot de passe — Odin le garde [2] | WPS coupé | x\nSUITES: Quoi encore ? | Et ensuite ?', 3);
  assert.deepEqual(g.essentials, [{ title: 'Nouveau mot de passe', detail: 'Odin le garde' }, { title: 'WPS coupé' }]); assert.equal(g.text, 'Change le mot de passe [1].'); assert.deepEqual(g.followups, ['Quoi encore ?', 'Et ensuite ?']);
  const f = finish('Ubuntu est sorti [1]. Faux [9]. Deux sources [2][3].\nSUITES: Quelle version ? | Comment installer ? | 3) Et Debian ?', 3);
  assert.equal(f.text, 'Ubuntu est sorti [1]. Faux . Deux sources [2][3].'); assert.deepEqual(f.cited, [1, 2, 3]); assert.deepEqual(f.followups, ['Quelle version ?', 'Comment installer ?', 'Et Debian ?']);
  assert.match(extractive(src), /• un extrait plus long \[1\]/);
  assert.match(toMarkdown({ question: 'Q', answer: 'Oui [1].', sources: src, at: 0, engines: ['A'] }), /Oui \[1\]\(#source-1\)\.[\s\S]*1\. \[Deux\]\(https:\/\/b\.fr\/2\) — b\.fr/);
});

function world(withAi = true) {
  const home = mkdtempSync(join(tmpdir(), 'volva-')), asked: string[] = [];
  const fakeFetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith('http://searx.test/search')) return Response.json({ results: [{ title: 'Ubuntu 24.04.3 est sorti', url: 'https://ubuntu.com/blog/24-04-3?utm_source=x', content: 'Canonical publie Ubuntu 24.04.3 LTS.', engines: ['google', 'duckduckgo'] }, { title: 'Notes de version', url: 'https://discourse.ubuntu.com/notes', content: 'Les nouveautés de 24.04.3.', engines: ['bing'] }], suggestions: ['ubuntu 24.04.3 nouveautés'] });
    if (url.startsWith('http://sansjson.test/')) return new Response('interdit', { status: 403 });
    if (url.startsWith('https://fr.wikipedia.org/w/api.php')) return Response.json({ query: { search: [{ title: 'Ubuntu', snippet: 'distribution <b>Linux</b>' }] } });
    if (url.startsWith('https://api.duckduckgo.com/')) return Response.json({});
    return new Response('non', { status: 404 });
  }) as typeof fetch;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fakeFetch, notify: async () => {}, autonomy: () => 'equilibre', ...(withAi ? { ask: async (t: string) => { asked.push(t); return 'Ubuntu 24.04.3 est sorti [1], avec des correctifs [2]. Invention [7].\nSUITES: Comment mettre à jour ? | Quelles nouveautés ? | Faut-il réinstaller ?'; } } : {}) } as never);
  setValhalla(v); v.ctx('volva').saveSettings({ searxng: 'http://searx.test', lire: false, moteurs: ['searxng', 'wikipedia', 'duckduckgo_ia'] });
  return { v, asked, act: (a: string, i: Record<string, unknown> = {}) => v.act('volva', a, i), end: () => { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('Pythie dans Odin : réponse sourcée, suites, conversation, applis, historique, export, outil de recherche', async () => {
  const w = world();
  try {
    const r = await w.act('chercher', { question: 'Quelle est la dernière version d\'Ubuntu ?' }), e = r.data as { id: string; answer: string; sources: Array<{ n: number; url: string; engines: string[] }>; followups: string[]; apps: Array<{ id: string }>; ai: boolean };
    assert.ok(e.ai); assert.equal(e.answer, 'Ubuntu 24.04.3 est sorti [1], avec des correctifs [2]. Invention .', 'citation inventée retirée');
    assert.deepEqual(e.sources.map((x) => x.engines.join('+')), ['google+duckduckgo', 'Wikipédia', 'bing']);
    assert.deepEqual(e.followups, ['Comment mettre à jour ?', 'Quelles nouveautés ?', 'Faut-il réinstaller ?']);
    assert.ok(e.apps.some((a) => a.id === 'eitri'), `Andromède proposé pour Ubuntu (${JSON.stringify(e.apps)})`);
    assert.match(r.text, /Sources :\n\[1\] Ubuntu 24\.04\.3 est sorti — https:\/\/ubuntu\.com\/blog\/24-04-3\?utm_source=x \(google, duckduckgo\)/);
    assert.match(w.asked[0], /<donnees>/);
    const r2 = await w.act('chercher', { question: 'Et comment la mettre à jour ?', suite: e.id });
    assert.match(w.asked[1], /Q : Quelle est la dernière version d'Ubuntu \?/); assert.equal((r2.data as { thread: string }).thread, e.id);
    assert.match((await w.act('historique')).text, /Et comment la mettre à jour \?[\s\S]*Quelle est la dernière version/);
    assert.match((await w.act('exporter', { id: e.id })).text, /^# Quelle est la dernière version d'Ubuntu \?/);
    assert.equal(JSON.parse((await w.act('exporter', { id: e.id, format: 'json' })).text).id, e.id);
    assert.match((await w.act('moteurs')).text, /✅ SearXNG[\s\S]*⛔ Brave Search — il faut BRAVE_API_KEY[\s\S]*Bing a arrêté son API en août 2025/);
    const out = await webSearchTool.run({ query: 'ubuntu 24.04' }, {} as never) as { output: string };
    assert.match(out.output, /Pythie : google, duckduckgo, Wikipédia, bing/); assert.match(out.output, /1\. Ubuntu 24\.04\.3 est sorti\n   https:\/\/ubuntu\.com/);
    assert.match((await w.act('searxng', { adresse: 'http://sansjson.test' })).text, /format JSON n'est pas activé/);
    // La page web : réservée à la session, conversation retrouvée par son identifiant.
    let authed = false;
    const srv = createServer((q, s) => { void rechercheRoute(q, s, new URL(q.url!, 'http://x'), { authed, mascot: '' }).then((d) => { if (!d) { s.writeHead(404); s.end(); } }); });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    try {
      const page = await fetch(`${base}/recherche`); assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/); assert.match(await page.text(), /src="\/recherche\.js"/);
      assert.equal((await fetch(`${base}/api/recherche/etat`)).status, 401);
      authed = true;
      const st = await (await fetch(`${base}/api/recherche/etat`)).json() as { engines: string[]; history: Array<{ id: string }> };
      assert.deepEqual(st.engines, ['SearXNG', 'Wikipédia', 'DuckDuckGo']); assert.equal(st.history.length, 2);
      const th = await (await fetch(`${base}/api/recherche/entree?id=${e.id}`)).json() as { thread: Array<{ q: string }> };
      assert.deepEqual(th.thread.map((x) => x.q), ['Quelle est la dernière version d\'Ubuntu ?', 'Et comment la mettre à jour ?']);
      assert.equal((await fetch(`${base}/api/recherche/chercher`, { method: 'POST', body: '{}' })).status, 403);
      const c = await (await fetch(`${base}/api/recherche/chercher`, { method: 'POST', headers: { 'x-odin': '1' }, body: JSON.stringify({ question: 'ubuntu', focus: 'actualites' }) })).json() as { ok: boolean; entry: { focus: string } };
      assert.ok(c.ok); assert.equal(c.entry.focus, 'actualites');
      assert.match(await (await fetch(`${base}/api/recherche/markdown?id=${e.id}`)).text(), /^# Quelle est la dernière version/);
    } finally { srv.close(); }
    assert.equal((await w.act('oublier')).ok, true);
  } finally { w.end(); }
});

test('sans IA : les meilleurs extraits, chacun avec sa source', async () => {
  const w = world(false);
  try {
    const e = (await w.act('chercher', { question: 'ubuntu' })).data as { ai: boolean; answer: string; followups: string[] };
    assert.equal(e.ai, false); assert.match(e.answer, /sans IA réglée dans Odin[\s\S]*• Canonical publie Ubuntu 24\.04\.3 LTS\. \[1\]/); assert.deepEqual(e.followups, ['ubuntu 24.04.3 nouveautés']);
  } finally { w.end(); }
});

test('Pythie sur Telegram : la carte (titre court, numéros en petit, l\'essentiel, sources en liens, rien d\'injecté)', async () => {
  const { searchCard, titleOf } = await import('../src/valhalla/volva/carte.ts');
  assert.equal(titleOf('Cherche comment sécuriser le Wi-Fi de la maison, et envoie-moi l\'audio'), 'Sécuriser le Wi-Fi de la maison');
  const c = searchCard({ q: 'Comment sécuriser le Wi-Fi ?', answer: 'Change le mot de passe **d\'origine** [2], passe en WPA3 [1][3] <script>.', at: Date.UTC(2026, 10, 13, 15, 41), essentials: [{ title: 'WPS coupé', detail: 'Zéphyr' }],
    sources: [1, 2, 3, 4, 5].map((n) => ({ n, title: `S${n}`, url: `https://ex${n}.fr/a?b="c"`, domain: n === 3 ? 'fr.wikipedia.org' : `ex${n}.fr`, snippet: '', engines: [] })) }, { tz: 'Indian/Mayotte' });
  assert.match(c, /^<b>Sécuriser le Wi-Fi<\/b>/); assert.match(c, /d'origine<\/b> ², passe en WPA3 ¹˒³ &lt;script&gt;/); assert.match(c, /<blockquote>▫️ WPS coupé <i>— Zéphyr<\/i><\/blockquote>/);
  assert.match(c, /Sources : <a href="https:\/\/ex1\.fr\/a\?b=&quot;c&quot;">ex1\.fr<\/a> · .*>Wikipédia<\/a> · \+2/); assert.match(c, /<i>Pythie · 5 sources · 18:41<\/i>$/);
});

test('Pythie sur Telegram : les boutons Écouter et Fiche deviennent des commandes d\'Odin', async () => {
  const { buttonText } = await import('../src/bifrost/channel.ts');
  assert.equal(buttonText('vs:ec:a1b2c3d4e5'), '/volva ecouter a1b2c3d4e5'); assert.equal(buttonText('vs:fi:a1b2c3d4e5'), '/volva fiche a1b2c3d4e5'); assert.equal(buttonText('vs:xx:a1'), undefined);
});
