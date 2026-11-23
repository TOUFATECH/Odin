// Vénus, lots V4-V6 — relecture : le catalogue des sorties face à un Internet hostile, et les deux réponses du
// propriétaire du 23/11 (films publics sans clé cochés par défaut ; « Nouveau » cherche dans le grand catalogue).
//   - le programme des animés pose sa question en POST : le réseau vérifié du catalogue doit l'accepter (avant : refusé,
//     « À venir » des animés ne marchait jamais en vrai) ; une adresse de la maison ou d'Odin reste refusée ;
//   - une réponse de forme piégée ne casse pas l'écran ; un catalogue qui ne répond pas ne bloque pas l'écran des minutes ;
//   - la mémoire des lectures se vide ; les messages d'erreur ne portent ni nom de site ni morceau de réponse ;
//   - un identifiant de catalogue piégé ne passe pas dans la clé d'une sortie.
// Aucun appel réel à Internet : un serveur local (127.0.0.1), avec le réglage d'essai explicite de Comète.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { magasinVenus } from '../src/valhalla/venus/base.ts';
import { fetchVerifie } from '../src/valhalla/venus/reseau.ts';
import { reglerOutilsComete, reseauCatalogue } from '../src/valhalla/venus/comete/index.ts';
import { aVenir, chercherTitre, nouveautes, reglagesCatalogue, reglerCatalogue, reglerDelaiCatalogue, tailleCacheCatalogue, texte, viderCacheCatalogue } from '../src/valhalla/venus/catalogue/index.ts';

const vus: string[] = [];
let mode: 'piege' | 'muet' | 'normal' = 'normal';
const CLE = 'cle-grand-catalogue-essai-42';
const srv = createServer(async (req, res) => {
  let corps = ''; for await (const c of req) corps += c;
  const u = new URL(req.url!, 'http://x'); vus.push(`${req.method} ${u.pathname}?${u.searchParams.toString()} ${corps}`);
  if (mode === 'muet') return; // ne répond jamais
  const json = (v: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (u.pathname === '/echo') { json({ recu: corps }); return; }
  if (u.pathname.startsWith('/tvmaze/schedule')) {
    // forme piégée : genres en texte, réseau en nombre, identifiant piégé, puis du texte qui n'est pas du JSON
    if (u.searchParams.get('country') === 'FR') { res.writeHead(200); res.end('<html>pas du json "secret-du-site"</html>'); return; }
    json(mode === 'piege' ? [null, 'texte', { show: { name: 'Forme Piégée', type: 'Scripted', weight: 99, genres: 'Drama', network: 5, externals: 'x', id: '"]><x' }, airdate: u.searchParams.get('date'), season: 1, number: 2 }] : []);
    return;
  }
  if (u.pathname.startsWith('/public/catalog')) { json({ metas: [] }); return; }
  if (u.pathname.startsWith('/grand/search/')) {
    if (u.searchParams.get('api_key') !== CLE) { res.writeHead(401); res.end(); return; }
    json({ results: [{ id: 31, title: 'Les Voiles &amp; le Vent', release_date: '2025-03-02', overview: '<b>Un</b> film', poster_path: '/a.jpg' }, { id: '"><img>', title: 'Piège' }] });
    return;
  }
  res.writeHead(404); res.end();
});
let base = '';
const local: typeof fetch = (u, i) => fetch(String(u).replace(/^https:\/\/api\.tvmaze\.com/, `${base}/tvmaze`).replace(/^https:\/\/v3-cinemeta\.strem\.io/, `${base}/public`).replace(/^https:\/\/api\.themoviedb\.org\/3/, `${base}/grand`), i);
const home = mkdtempSync(join(tmpdir(), 'venus-v4-relu-'));
const mag = () => magasinVenus(home, join(home, 'venus'));

before(async () => { srv.listen(0, '127.0.0.1'); await once(srv, 'listening'); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; });
after(() => { srv.closeAllConnections(); srv.close(); reglerOutilsComete(); reglerDelaiCatalogue(); rmSync(home, { recursive: true, force: true }); });

test('le réseau vérifié du catalogue accepte le POST des animés (un texte court), et refuse toujours la maison et Odin', async () => {
  const f = fetchVerifie({ resoudre: async () => ['127.0.0.1'], refuser: () => undefined, post: true });
  const r = await f(`${base}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"x"}' });
  assert.deepEqual(await r.json(), { recu: '{"query":"x"}' }, 'le corps du POST part bien');
  await assert.rejects(fetchVerifie({ resoudre: async () => ['127.0.0.1'], refuser: () => undefined })(`${base}/echo`, { method: 'POST', body: 'x' }), /requête refusée/, 'sans `post` : refusé (Delta, Comète)');
  await assert.rejects(f(`${base}/echo`, { method: 'POST', body: 'x'.repeat(20_000) }), /requête refusée/, 'un gros corps : refusé');
  // Le vrai réseau du catalogue (sans réglage d'essai) : un nom qui mène à la machine ou à la maison est refusé.
  reglerOutilsComete({ resoudre: async () => ['192.168.1.20'] });
  await assert.rejects(reseauCatalogue()('https://graphql.anilist.co/', { method: 'POST', body: '{}' }), /refusé/);
  reglerOutilsComete({ resoudre: async () => ['127.0.0.1'] });
  const avant = vus.length;
  await assert.rejects(reseauCatalogue()(`${base}/echo`, { method: 'POST', body: '{}' }), /refusé/);
  assert.equal(vus.length, avant, 'rien n\'est parti vers 127.0.0.1');
  reglerOutilsComete();
});

test('réponse de forme piégée : l\'écran tient, rien de piégé ne passe ; messages sans nom de site ni morceau de réponse', async () => {
  reglerOutilsComete({ reseauEssai: local }); viderCacheCatalogue(); mode = 'piege';
  reglerCatalogue(mag(), { series: true });
  const a = await aVenir(mag(), local, 'show');
  const x = a.entries.find((e) => e.title === 'Forme Piégée'); assert.ok(x, JSON.stringify(a));
  assert.deepEqual(x.genres, [], 'des genres en texte sont ignorés');
  assert.equal(x.network, undefined);
  assert.match(x.key, /^name:/, 'un identifiant piégé ne devient pas une clé');
  assert.ok(a.erreurs.length >= 1);
  for (const e of a.erreurs) assert.ok(!/secret-du-site|tvmaze|127\.0\.0\.1|Unexpected/.test(e), e);
  assert.equal(texte('Tom &amp; Jerry &lt;script&gt; &#233;t&eacute;'), 'Tom & Jerry script été');
  mode = 'normal';
});

test('un catalogue qui ne répond pas : l\'écran rend la main à l\'échéance, pas après des minutes', async () => {
  viderCacheCatalogue(); mode = 'muet'; reglerDelaiCatalogue(400);
  const t0 = Date.now(), a = await aVenir(mag(), local, 'show');
  assert.ok(Date.now() - t0 < 5000, `rendu en ${Date.now() - t0} ms`);
  assert.equal(a.entries.length, 0); assert.ok(a.erreurs.some((e) => /trop de temps/.test(e)), JSON.stringify(a.erreurs));
  mode = 'normal'; reglerDelaiCatalogue(); srv.closeAllConnections();
});

test('la mémoire des lectures reste bornée', async () => {
  viderCacheCatalogue();
  for (let k = 0; k < 18; k++) await aVenir(mag(), local, 'show', new Set(), Date.now() + k * 9 * 864e5);
  assert.ok(tailleCacheCatalogue() <= 300, String(tailleCacheCatalogue()));
});

test('réponse du propriétaire : le catalogue public des films (sans clé) est coché par défaut ; « Aucun » coupe tout', async () => {
  const m2 = magasinVenus(home, join(home, 'venus-2'));
  assert.equal(reglagesCatalogue(m2).films, 'public'); assert.equal(reglagesCatalogue(m2).series, false); assert.equal(reglagesCatalogue(m2).animes, false);
  viderCacheCatalogue(); const avant = vus.length;
  const a = await aVenir(m2, local, 'movie'); assert.equal(a.source, true, '« À venir » des films lit le catalogue public dès le départ');
  assert.ok(vus.slice(avant).some((r) => r.startsWith('GET /public/catalog/movie/year/')), 'le catalogue public est lu');
  assert.ok(!vus.slice(avant).some((r) => /\/(tvmaze|grand)/.test(r)), 'rien d\'autre');
  reglerCatalogue(m2, { films: 'aucun' }); const n = vus.length;
  assert.equal((await aVenir(m2, local, 'movie')).source, false); assert.equal(vus.length, n, '« Aucun » : plus rien n\'est lu');
});

test('réponse du propriétaire : « Nouveau » cherche le titre dans le grand catalogue quand sa clé est réglée, sinon rien n\'est lu', async () => {
  const m3 = magasinVenus(home, join(home, 'venus-3')), avant = vus.length;
  const sans = await chercherTitre(m3, local, 'Les Voiles', 'movie');
  assert.equal(sans.source, false); assert.equal(vus.length, avant, 'sans clé : aucune requête');
  reglerCatalogue(m3, { films: 'cle', cle: CLE });
  const r = await chercherTitre(m3, local, 'Les Voiles (2025)', 'movie');
  assert.equal(r.source, true);
  assert.deepEqual(r.items.map((x) => [x.key, x.title, x.year, x.overview]), [['film:31', 'Les Voiles & le Vent', 2025, 'Un film']]);
  assert.ok(!JSON.stringify(r).includes('a.jpg'), 'aucune image extérieure n\'est transmise');
  assert.ok(vus.at(-1)!.startsWith('GET /grand/search/movie?') && vus.at(-1)!.includes('query=Les+Voiles') && vus.at(-1)!.includes('year=2025'), vus.at(-1));
  assert.ok(!JSON.stringify(r).includes(CLE));
  const n = await nouveautes(m3, local, 'movie'); assert.equal(n.source, true);
});
