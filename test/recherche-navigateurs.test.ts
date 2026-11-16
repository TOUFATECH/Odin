// Odin, moteur de recherche des navigateurs : description OpenSearch, page de résultats classique (sans script),
// suggestions pendant la frappe, retour après connexion, vignettes jamais tirées du réseau de la maison.
// Aucun service réel : un faux fetch et un serveur local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { rechercheRoute } from '../src/web/recherche-api.ts';
import { esc, lienSur, pageListe } from '../src/web/recherche-liste.ts';
import { descriptionOpenSearch, lireDemande, lireSuggestions, LIEN_RECHERCHE, NOM_MOTEUR, oublierCompteurs, origineSure, suggestionPermise, suiteDe, suiteSure } from '../src/web/recherche-navigateurs.ts';
import { adresseInterdite, adressePublique, remplacerResolution } from '../src/web/adresse-publique.ts';
import { chercherVignette, remplacerTransport, transportReseau } from '../src/web/vignette-sure.ts';
import { adresseLan } from '../src/web/adresse-lan.ts';
import { noterQuestion } from '../src/valhalla/volva/questions.ts';
import type { ReponseLyncee } from '../src/valhalla/volva/lyncee/meta.ts';

test('description OpenSearch : nom court, modèles, échappement, origine vérifiée (pur)', () => {
  const x = descriptionOpenSearch('https://odin.maison.test:8443');
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(x, /xmlns="http:\/\/a9\.com\/-\/spec\/opensearch\/1\.1\/"/);
  const court = /<ShortName>([^<]*)<\/ShortName>/.exec(x)![1];
  assert.equal(court, NOM_MOTEUR); assert.ok(court.length <= 16);
  assert.match(LIEN_RECHERCHE, new RegExp(`title="${court}"`), 'le titre du lien = le nom court');
  assert.match(x, /<Url type="text\/html" method="get" template="https:\/\/odin\.maison\.test:8443\/recherche\?q=\{searchTerms\}"\/>/);
  assert.match(x, /<Url type="application\/x-suggestions\+json" template="https:\/\/odin\.maison\.test:8443\/api\/recherche\/suggestions\?q=\{searchTerms\}"\/>/);
  assert.match(x, /rel="self" template="https:\/\/odin\.maison\.test:8443\/opensearch\.xml"/);
  assert.match(x, /<InputEncoding>UTF-8<\/InputEncoding>/); assert.match(x, /\/icon-192\.png<\/Image>/);
  assert.match(x, /<Description>Recherche d&apos;Odin \(Lyncée\)/, 'texte échappé');
  assert.doesNotMatch(x.replace(/&(amp|lt|gt|quot|apos);/g, ''), /&/, 'aucun & nu');
  assert.doesNotMatch(x, /192\.168|toufatech|@/i, 'aucune donnée privée');
  assert.equal(origineSure('evil"><x'), undefined); assert.equal(origineSure('https://a.test/chemin'), undefined); assert.equal(origineSure('javascript:alert(1)'), undefined);
  assert.equal(origineSure('http://[fd00::1]:8080'), 'http://[fd00::1]:8080'); assert.equal(origineSure('https://odin.test'), 'https://odin.test');
});

test('retour après connexion : seulement une page /recherche d\'Odin (pur)', () => {
  assert.ok(suiteSure('/recherche?q=a')); assert.ok(suiteSure('/recherche'));
  for (const x of ['//exemple.com', 'https://x', '/\\x', '/autre', '/recherche?q=a#x', '/recherche?q=a b', '/recherchex', '/recherche/../admin']) assert.equal(suiteSure(x), false, x);
  const d = lireDemande(new URLSearchParams('q=%20tour%00eiffel%20&cat=pirate&p=99'));
  assert.deepEqual(d, { q: 'tour eiffel', cat: 'web', p: 10 });
  assert.equal(suiteDe({ q: 'a&b c', cat: 'images', p: 2 }), '/recherche?q=a%26b+c&cat=images&p=2');
  assert.ok(suiteSure(suiteDe({ q: '#\\ <x> //', cat: 'web', p: 1 })));
});

test('page classique : texte des moteurs échappé, liens http(s) seuls, onglets, pages, aucun script (pur)', () => {
  assert.equal(lienSur('javascript:alert(1)'), ''); assert.equal(lienSur('data:text/html,x'), ''); assert.equal(lienSur('https://u:p@a.test/'), '');
  assert.equal(lienSur('https://a.test/x y'), 'https://a.test/x%20y');
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  const r: ReponseLyncee = {
    q: 'tour', categorie: 'web', page: 1, duCache: false, suivante: true, erreurs: ['Bing : <b>bloqué</b>'], moteurs: ['DuckDuckGo', 'Yahoo'],
    pauses: [{ id: 'bing', etiquette: 'Bing', categories: ['web'], etat: 'pause', jusqua: Date.now() + 60_000, raison: 'contrôle anti-robot', echecs: 1 }],
    resultats: [
      { n: 1, title: '<script>alert(1)</script>', url: 'https://a.test/page?x=1&y=2', domain: 'a.test', snippet: '<img src=x onerror=alert(2)>', engines: ['DuckDuckGo', 'Yahoo'] },
      { n: 2, title: 'piège', url: 'javascript:alert(3)', domain: 'x', snippet: '', engines: ['Yahoo'] },
    ],
  };
  const h = pageListe(r, { q: 'tour "x"', cat: 'web', p: 1 });
  assert.doesNotMatch(h, /<script|<img src=x|javascript:/i); assert.match(h, /&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.match(h, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.match(h, /href="https:\/\/a\.test\/page\?x=1&amp;y=2" rel="noopener noreferrer"/);
  assert.match(h, /<form method="get" action="\/recherche"[^>]*><input type="search" name="q" value="tour &quot;x&quot;"/);
  assert.match(h, /vu par DuckDuckGo, Yahoo/); assert.match(h, /Bing : en pause jusqu'à \d\d:\d\d \(contrôle anti-robot\)/);
  assert.match(h, /Bing : &lt;b&gt;bloqué&lt;\/b&gt;/);
  for (const c of ['actualites', 'images', 'videos', 'savoir']) assert.match(h, new RegExp(`href="/recherche\\?q=tour%20%22x%22&amp;cat=${c}"`), c);
  assert.match(h, /href="\/recherche\?q=tour%20%22x%22&amp;p=2">Page suivante/); assert.doesNotMatch(h, /Page précédente/);
  assert.match(h, /href="\/recherche\?q=tour%20%22x%22&amp;mode=pythie">Réponse rédigée par Pythie/);
  assert.match(h, /href="\/recherche\/navigateurs"/); assert.ok(h.includes(LIEN_RECHERCHE));
  const im = pageListe({ ...r, categorie: 'images', suivante: false, resultats: [{ n: 1, title: 'Tour', url: 'https://a.test/p', domain: 'a.test', snippet: '', engines: ['Openverse'], thumb: 'https://img.test/t.jpg' }] }, { q: 'tour', cat: 'images', p: 3 });
  assert.match(im, /<img src="\/api\/recherche\/vignette\?u=https%3A%2F%2Fimg\.test%2Ft\.jpg" loading="lazy" alt="Tour">/);
  assert.match(im, /href="\/recherche\?q=tour&amp;cat=images&amp;p=2">← Page précédente/); assert.doesNotMatch(im, /Page suivante/);
});

test('suggestions : limite de 60 par minute et par adresse, lecture des sources ouvertes (pur)', () => {
  oublierCompteurs();
  for (let i = 0; i < 60; i++) assert.ok(suggestionPermise('1.2.3.4', 1000));
  assert.equal(suggestionPermise('1.2.3.4', 2000), false); assert.ok(suggestionPermise('5.6.7.8', 2000)); assert.ok(suggestionPermise('1.2.3.4', 62_000));
  assert.deepEqual(lireSuggestions(['tour', ['Tour Eiffel', 'Tour\u0000 de France'], [], []]), ['Tour Eiffel', 'Tour de France']);
  assert.deepEqual(lireSuggestions([{ phrase: 'tour eiffel' }]), ['tour eiffel']); assert.deepEqual(lireSuggestions({ x: 1 }), []);
  oublierCompteurs();
});

test('vignettes : un nom qui mène au réseau de la maison est refusé', async () => {
  assert.ok(adresseInterdite('192.168.1.10')); assert.ok(adresseInterdite('169.254.169.254')); assert.ok(adresseInterdite('::')); assert.ok(adresseInterdite('0.0.0.0')); assert.equal(adresseInterdite('93.184.215.14'), false);
  remplacerResolution(async (h) => (h === 'piege.test' ? ['93.184.215.14', '192.168.1.10'] : ['93.184.215.14']));
  try {
    await assert.rejects(adressePublique('https://piege.test/a.png'));
    await assert.rejects(adressePublique('http://10.0.0.1/a.png')); await assert.rejects(adressePublique('file:///etc/passwd'));
    assert.equal((await adressePublique('https://images.test/a.png')).hostname, 'images.test');
  } finally { remplacerResolution(); }
});

test('vignettes : le nom est résolu une seule fois, Odin se connecte à l\'adresse vérifiée (pas de second tour DNS)', async () => {
  // Un nom piégé : public au premier tour, la maison ensuite.
  let tours = 0; const ips: string[] = [];
  remplacerResolution(async () => (++tours === 1 ? ['93.184.215.14'] : ['192.168.1.10']));
  remplacerTransport(async (_u, ip) => { ips.push(ip); return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }); });
  try {
    const v = await chercherVignette('https://piege.test/a.png');
    assert.equal(v.type, 'image/png'); assert.equal(tours, 1, 'une seule résolution'); assert.deepEqual(ips, ['93.184.215.14'], 'connexion à l\'adresse vérifiée');
  } finally { remplacerResolution(); remplacerTransport(); }
  // Le vrai transport : il se connecte à l'adresse donnée, sans résoudre le nom (un nom inexistant marche donc).
  const srv = createServer((_q, s) => { s.writeHead(200, { 'content-type': 'image/png' }); s.end(Buffer.from([1, 2, 3])); });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  try {
    const r = await transportReseau(new URL(`http://nom-qui-n-existe-pas.invalid:${(srv.address() as { port: number }).port}/a.png`), '127.0.0.1', AbortSignal.timeout(3000));
    assert.equal(r.status, 200); assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
  } finally { srv.close(); }
});

test('adresse de la maison pour les QR codes : ni 169.254, ni tunnel, 192.168 d\'abord', () => {
  const ip = (address: string) => ({ address, family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null }) as never;
  assert.equal(adresseLan({ Tailscale: [ip('169.254.83.107')], 'vEthernet (WSL)': [ip('172.20.0.1')], 'Wi-Fi': [ip('192.168.1.147')] }), '192.168.1.147');
  assert.equal(adresseLan({ tailscale0: [ip('100.101.1.2')], ZeroTier: [ip('10.147.17.3')], Ethernet: [ip('169.254.1.1')] }), undefined);
  assert.equal(adresseLan({ eth0: [ip('10.0.0.5')], eth1: [ip('192.168.0.9')] }), '192.168.0.9');
});

function monde() {
  const home = mkdtempSync(join(tmpdir(), 'odin-moteur-')), appels: string[] = [];
  const fakeFetch = (async (input: string | URL) => {
    const url = String(input); appels.push(url);
    if (url.startsWith('https://fr.wikipedia.org/w/api.php?action=opensearch')) return Response.json(['tour', ['Tour Eiffel', 'Tour de France']]);
    if (url === 'https://images.test/a.png') return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } });
    return new Response('non', { status: 404 });
  }) as typeof fetch;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fakeFetch, notify: async () => {}, autonomy: () => 'equilibre' } as never);
  setValhalla(v); v.ctx('volva').saveSettings({ lire: false, moteurs: ['wikipedia'] });
  // Les vignettes passent par un transport connecté à l'adresse vérifiée : ici, le faux réseau.
  remplacerTransport(async (u) => fakeFetch(u.toString()));
  return { v, appels, ctx: () => v.ctx('volva'), fin: () => { remplacerTransport(); setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('routes : OpenSearch, mode d\'emploi, page classique, mode Pythie, suggestions, vignettes', async () => {
  const w = monde();
  let authed = false;
  const srv = createServer((q, s) => {
    const origine = String(q.headers['x-origine'] ?? 'https://odin.maison.test:8443');
    void rechercheRoute(q, s, new URL(q.url!, 'http://x'), { authed, mascot: '', origine, ip: String(q.headers['x-ip'] ?? '127.0.0.1') }).then((d) => { if (!d) { s.writeHead(404); s.end(); } });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  try {
    // La description : publique, même sans session.
    const os = await fetch(`${base}/opensearch.xml`);
    assert.equal(os.status, 200); assert.match(os.headers.get('content-type')!, /^application\/opensearchdescription\+xml/); assert.equal(os.headers.get('cache-control'), 'no-cache');
    assert.match(await os.text(), /template="https:\/\/odin\.maison\.test:8443\/recherche\?q=\{searchTerms\}"/);
    assert.equal((await fetch(`${base}/opensearch.xml`, { headers: { 'x-origine': 'http://evil"><x' } })).status, 400, 'hôte piégé');
    const piege = await new Promise<number>((ok) => { const r = request(`${base}/opensearch.xml`, { headers: { 'x-origine': 'https://a.test/"><script>' } }, (x) => { x.resume(); ok(x.statusCode ?? 0); }); r.end(); });
    assert.equal(piege, 400);
    // Le mode d'emploi : l'adresse exacte, un script seulement avec son nonce, aucune fenêtre native.
    const aide = await fetch(`${base}/recherche/navigateurs`), ah = await aide.text(), nonce = /script-src 'nonce-([^']+)'/.exec(aide.headers.get('content-security-policy')!)![1];
    assert.ok(ah.includes('https://odin.maison.test:8443/recherche?q=%s')); assert.ok(ah.includes(LIEN_RECHERCHE));
    assert.equal((ah.match(/<script/g) ?? []).length, (ah.match(new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}"`, 'g')) ?? []).length);
    assert.doesNotMatch(ah, /\balert\(|\bconfirm\(|\bprompt\(/); assert.match(ah, /Safari/); assert.match(ah, /barre des tâches/); assert.match(ah, /odin-cert\.crt/);

    // La page classique sans session : connexion, puis retour à la même recherche.
    const sans = await fetch(`${base}/recherche?q=tour%20eiffel&cat=images`, { redirect: 'manual' });
    assert.equal(sans.status, 302); assert.equal(sans.headers.get('location'), '/?suite=%2Frecherche%3Fq%3Dtour%2Beiffel%26cat%3Dimages');
    assert.ok(suiteSure(decodeURIComponent(sans.headers.get('location')!.slice(8))));
    // Sans session, la page de Pythie elle-même reste servie (inchangée), avec le lien du moteur.
    const vide = await (await fetch(`${base}/recherche`)).text(); assert.match(vide, /src="\/recherche\.js"/); assert.ok(vide.includes(LIEN_RECHERCHE));

    // Suggestions sans session : jamais l'historique.
    noterQuestion(w.ctx(), 'tour eiffel hauteur');
    const fichier = join(w.ctx().dir, 'questions.json'), avant = readFileSync(fichier, 'utf8');
    w.ctx().saveSettings({ suggestions: 'aucune' }); w.appels.length = 0;
    const s0 = await fetch(`${base}/api/recherche/suggestions?q=tour`);
    assert.match(s0.headers.get('content-type')!, /^application\/x-suggestions\+json/); assert.match(s0.headers.get('cache-control')!, /no-store/);
    assert.deepEqual(await s0.json(), ['tour', []]); assert.deepEqual(w.appels, [], 'réglage « aucune » : rien ne sort');
    authed = true;
    assert.deepEqual(await (await fetch(`${base}/api/recherche/suggestions?q=TOUR`)).json(), ['TOUR', ['tour eiffel hauteur']], 'préfixe tiré des questions notées');
    assert.deepEqual(w.appels, []);
    w.ctx().saveSettings({ suggestions: 'wikipedia' });
    assert.deepEqual(await (await fetch(`${base}/api/recherche/suggestions?q=tour`)).json(), ['tour', ['tour eiffel hauteur', 'Tour Eiffel', 'Tour de France']]);
    authed = false;
    assert.deepEqual(await (await fetch(`${base}/api/recherche/suggestions?q=tour`)).json(), ['tour', ['Tour Eiffel', 'Tour de France']], 'sans session : la source ouverte seule');
    assert.ok(w.appels.length && w.appels.every((u) => new URL(u).hostname === 'fr.wikipedia.org'), w.appels.join(' '));
    assert.equal(readFileSync(fichier, 'utf8'), avant, 'rien d\'écrit par les suggestions');
    oublierCompteurs();
    let dernier: unknown;
    for (let i = 0; i < 61; i++) dernier = await (await fetch(`${base}/api/recherche/suggestions?q=tour`, { headers: { 'x-ip': '9.9.9.9' } })).json();
    assert.deepEqual(dernier, ['tour', []], 'au-delà de 60 par minute : liste vide');
    oublierCompteurs();

    // La page classique avec session : liste rendue ici, aucun script, formulaire GET, onglets.
    authed = true; w.ctx().saveSettings({ suggestions: 'aucune' });
    const pc = await fetch(`${base}/recherche?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E&cat=videos&p=2`), ph = await pc.text(), csp = pc.headers.get('content-security-policy')!;
    assert.equal(pc.status, 200); assert.match(csp, /form-action 'self'/); assert.doesNotMatch(csp, /script-src/); assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(pc.headers.get('cache-control'), 'no-store'); assert.equal(pc.headers.get('referrer-policy'), 'no-referrer'); assert.equal(pc.headers.get('x-frame-options'), 'DENY');
    assert.doesNotMatch(ph, /<script/i); assert.match(ph, /value="&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
    assert.match(ph, /<form method="get" action="\/recherche"/); assert.match(ph, /<input type="hidden" name="cat" value="videos">/);
    assert.match(ph, /aria-current="page">Vidéos</); assert.match(ph, /Page précédente/); assert.match(ph, /mode=pythie">Réponse rédigée par Pythie/);
    // Page 2 : la question n'est pas notée de nouveau (seulement en page 1).
    assert.ok(!JSON.parse(readFileSync(fichier, 'utf8')).some((x: { q: string }) => x.q.includes('script')));
    // Le mode Pythie : l'ancienne page, qui lance la réponse rédigée.
    const py = await (await fetch(`${base}/recherche?q=tour&mode=pythie`)).text(); assert.match(py, /src="\/recherche\.js"/); assert.ok(py.includes(LIEN_RECHERCHE));

    // Vignettes : un nom qui mène au réseau de la maison → 404, sans aucun appel ; un nom public → l'image.
    remplacerResolution(async (h) => (h === 'piege.test' ? ['192.168.1.10'] : ['93.184.215.14']));
    w.appels.length = 0;
    assert.equal((await fetch(`${base}/api/recherche/vignette?u=${encodeURIComponent('https://piege.test/a.png')}`)).status, 404);
    assert.deepEqual(w.appels, [], 'aucune requête vers la maison');
    const im = await fetch(`${base}/api/recherche/vignette?u=${encodeURIComponent('https://images.test/a.png')}`);
    assert.equal(im.status, 200); assert.equal(im.headers.get('content-type'), 'image/png');
  } finally { remplacerResolution(); srv.close(); w.fin(); }
});
