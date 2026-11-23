// Vénus, lot V3 : affiches, fonds, vignettes et fiches (distribution, notes, genres), servis DEPUIS Odin.
//   - une vignette tirée d'une vraie vidéo fabriquée par ffmpeg (lavfi), gardée, servie par Odin ; une seule extraction
//     à la fois ; un nom de fichier piégé ne change rien aux arguments de FFmpeg ;
//   - sans réglage enregistré du catalogue : rien n'est lu sur Internet (seulement les vignettes et le nom du fichier) ;
//   - réglé : la fiche (résumé, genres, note, distribution) et les images viennent d'une source SIMULÉE (serveur local,
//     réglage d'essai explicite de Comète), sont rangées dans VENUS_ODIN, et la page ne reçoit aucune adresse extérieure ;
//   - une « image » piégée (page, SVG, script caché, bombe de décompression, trop lourde, redirection) est refusée ;
//   - la fiche d'une personne ; un non-propriétaire n'ouvre rien de tout ça.
// Aucun accès à Internet : tout passe par 127.0.0.1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { dirVenus, magasinVenus, oublierMagasins, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, scanner } from '../src/valhalla/venus/bibliotheque.ts';
import { ffprobeReel, venusRoute } from '../src/valhalla/venus/routes.ts';
import { reglerOutilsComete } from '../src/valhalla/venus/comete/index.ts';
import { reglerCatalogue, viderCacheCatalogue } from '../src/valhalla/venus/catalogue/index.ts';
import { attendreFiches, enrichir, fichierImage, idPersonne, lancerFiches, personne, telechargerImage, verifierImage } from '../src/valhalla/venus/metadonnees.ts';
import { argsVignette, attendreVignettes, demanderVignettes, fabriquerVignette, reglerFfmpegVignettes, vignetteFaite } from '../src/valhalla/venus/vignettes.ts';

const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'ignore' });
const racine = mkdtempSync(join(tmpdir(), 'venus-v3-'));
const outils = join(racine, 'outils'); mkdirSync(outils);
// De vraies images (JPEG) fabriquées par ffmpeg, servies par la source simulée.
const JPEG = (() => { const f = join(outils, 'a.jpg'); ff('-f', 'lavfi', '-i', 'color=c=0x336699:s=200x300', '-frames:v', '1', f); return readFileSync(f); })();
const JPEG_LARGE = (() => { const f = join(outils, 'b.jpg'); ff('-f', 'lavfi', '-i', 'color=c=0x993366:s=640x360', '-frames:v', '1', f); return readFileSync(f); })();
/** Un PNG dont l'en-tête annonce 100 000 × 100 000 pixels (bombe de décompression). */
const BOMBE = (() => { const b = Buffer.alloc(80); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(100000, 16); b.writeUInt32BE(100000, 20); return b; })();
const POLYGLOTTE = Buffer.concat([JPEG, Buffer.from('<html><script>alert(1)</script></html>')]);

const requetes: string[] = [];
const IMG = (res: ServerResponse, b: Buffer, type = 'image/jpeg') => { res.writeHead(200, { 'content-type': type, 'content-length': b.length }); res.end(b); };
const JSONR = (res: ServerResponse, v: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
const CLE = 'cle-grand-catalogue-essai-0123';
const source = createServer((req: IncomingMessage, res: ServerResponse) => {
  const u = new URL(req.url!, 'http://x'); requetes.push(`${u.pathname}${u.search}`);
  const p = u.pathname;
  // Le catalogue public des films (simulé)
  if (p.startsWith('/public/catalog/movie/top/search=')) { const q = decodeURIComponent(p.slice('/public/catalog/movie/top/search='.length).replace(/\.json$/, '')); JSONR(res, { metas: q === 'Brume Polaire' ? [{ id: 'tt0000001', name: 'Brume Polaire', releaseInfo: '2021' }, { id: 'tt0000009', name: 'Brume', releaseInfo: '1990' }] : q.startsWith('Piege') ? [{ id: 'tt0000002', name: q, releaseInfo: '2020' }] : [] }); return; }
  if (p === '/public/meta/movie/tt0000001.json') { JSONR(res, { meta: { name: 'Brume Polaire', releaseInfo: '2021', description: '<p>Une base <b>isolée</b> dans la brume.</p><script>alert(1)</script>', genres: ['Drame', 'Science-fiction'], imdbRating: '7.4', credits_cast: [{ name: 'Awa <img src=x onerror=alert(1)>Diallo', character: 'La pilote', profile_path: '/photoawa.jpg' }, { name: 'Malo Rivière', character: 'Le gardien' }], credits_crew: [{ name: 'Inès Bello', job: 'Director' }] } }); return; }
  if (p === '/public/meta/movie/tt0000002.json') { JSONR(res, { meta: { name: 'Piege piégé', description: 'Un piège.', genres: ['Thriller'] } }); return; }
  // Les hôtes d'images (simulés)
  if (p === '/metahub/poster/medium/tt0000001/img') { IMG(res, JPEG); return; }
  if (p === '/metahub/background/medium/tt0000001/img') { IMG(res, JPEG_LARGE); return; }
  if (p === '/tmdbimg/t/p/w185/photoawa.jpg') { IMG(res, JPEG); return; }
  // Le film « Piege » : chaque image est piégée.
  if (p === '/metahub/poster/medium/tt0000002/img') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end('<!doctype html><html><script>alert(1)</script></html>'); return; }
  if (p === '/metahub/background/medium/tt0000002/img') { res.writeHead(302, { location: 'https://images.metahub.space/poster/medium/tt0000001/img' }); res.end(); return; }
  // Les autres pièges, appelés directement
  if (p === '/tmdbimg/t/p/w500/svg.jpg') { IMG(res, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml'); return; }
  if (p === '/tmdbimg/t/p/w500/svgcache.jpg') { IMG(res, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>' + ' '.repeat(100))); return; }
  if (p === '/tmdbimg/t/p/w500/bombe.png') { IMG(res, BOMBE, 'image/png'); return; }
  if (p === '/tmdbimg/t/p/w500/poly.jpg') { IMG(res, POLYGLOTTE); return; }
  if (p === '/tmdbimg/t/p/w500/enorme.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(Buffer.concat([JPEG, Buffer.alloc(9 * 1024 * 1024)])); return; }
  // Le programme public des séries (simulé)
  if (p === '/tvmaze/search/shows') { JSONR(res, u.searchParams.get('q') === 'Station Lumen' ? [{ show: { id: 42, name: 'Station Lumen', premiered: '2019-03-01' } }] : []); return; }
  if (p === '/tvmaze/shows/42') { JSONR(res, { id: 42, name: 'Station Lumen', premiered: '2019-03-01', summary: '<p>Une station <i>lointaine</i>.</p>', genres: ['Drama'], rating: { average: 8.1 }, image: { original: 'https://static.tvmaze.com/uploads/lumen.jpg' }, _embedded: { cast: [{ person: { name: 'Awa Diallo', image: { medium: 'https://static.tvmaze.com/uploads/awa.jpg' } }, character: { name: 'La commandante' } }], crew: [{ type: 'Creator', person: { name: 'Noé Kar' } }] } }); return; }
  if (p === '/tvmaze/shows/42/images') { JSONR(res, [{ type: 'background', resolutions: { original: { url: 'https://static.tvmaze.com/uploads/lumen-fond.jpg', width: 1920 } } }]); return; }
  if (p.startsWith('/tvmazeimg/uploads/')) { IMG(res, p.includes('fond') ? JPEG_LARGE : JPEG); return; }
  // Le grand catalogue (simulé), avec sa clé
  if (p.startsWith('/grand/')) {
    if (u.searchParams.get('api_key') !== CLE) { res.writeHead(401); res.end('{}'); return; }
    if (p === '/grand/search/movie') { JSONR(res, { results: u.searchParams.get('query') === 'Brume Polaire' ? [{ id: 77, title: 'Brume Polaire', release_date: '2021-05-01' }] : [] }); return; }
    if (p === '/grand/movie/77') { JSONR(res, { id: 77, title: 'Brume Polaire', tagline: 'Personne ne reste seul.', overview: 'Résumé du grand catalogue.', release_date: '2021-05-01', vote_average: 7.9, vote_count: 900, genres: [{ name: 'Drame' }], poster_path: '/affiche77.jpg', backdrop_path: '/fond77.jpg', credits: { cast: [{ name: 'Awa Diallo', character: 'La pilote', profile_path: '/photoawa.jpg' }], crew: [{ name: 'Inès Bello', job: 'Director' }] } }); return; }
    JSONR(res, { results: [] }); return;
  }
  if (p.startsWith('/tmdbimg/')) { IMG(res, JPEG); return; }
  res.writeHead(404); res.end();
});
let base = '';
const local: typeof fetch = (u, i) => fetch(String(u)
  .replace(/^https:\/\/v3-cinemeta\.strem\.io/, `${base}/public`).replace(/^https:\/\/api\.tvmaze\.com/, `${base}/tvmaze`)
  .replace(/^https:\/\/api\.themoviedb\.org\/3/, `${base}/grand`).replace(/^https:\/\/image\.tmdb\.org/, `${base}/tmdbimg`)
  .replace(/^https:\/\/images\.metahub\.space/, `${base}/metahub`).replace(/^https:\/\/static\.tvmaze\.com/, `${base}/tvmazeimg`), i);

// Odin (les vraies routes de Vénus), propriétaire connecté — ou non.
let odin: Server, odinUrl = '', proprio = true;
const home = join(racine, 'home'); mkdirSync(home);
const medias = join(racine, 'Films'), series = join(racine, 'Series');
const mag = (): MagasinVenus => magasinVenus(home, dirVenus(home));
const api = async (chemin: string) => { const r = await fetch(`${odinUrl}${chemin}`); return { status: r.status, type: r.headers.get('content-type') ?? '', entetes: r.headers, corps: Buffer.from(await r.arrayBuffer()) }; };
const apiJson = async (chemin: string) => { const r = await api(chemin); return { status: r.status, json: JSON.parse(r.corps.toString('utf8')) as Record<string, unknown>, texte: r.corps.toString('utf8') }; };

before(async () => {
  source.listen(0, '127.0.0.1'); await once(source, 'listening'); base = `http://127.0.0.1:${(source.address() as AddressInfo).port}`;
  // Réglage d'essai explicite : tout le réseau de Vénus passe par la source locale (jamais par défaut).
  reglerOutilsComete({ reseauEssai: local });
  odin = createServer((req, res) => { void venusRoute(req, res, new URL(req.url!, 'http://odin'), { home, proprietaire: () => proprio, fail: () => undefined, origin: 'http://odin', ip: '127.0.0.1', profil: 'moi' }).then((ok) => { if (!ok) { res.writeHead(404); res.end(); } }); });
  odin.listen(0, '127.0.0.1'); await once(odin, 'listening'); odinUrl = `http://127.0.0.1:${(odin.address() as AddressInfo).port}`;
  mkdirSync(medias); mkdirSync(join(series, 'Station Lumen', 'Saison 1'), { recursive: true });
  const video = (f: string, d = 4) => ff('-f', 'lavfi', '-i', `testsrc=duration=${d}:size=320x240:rate=10`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', f);
  video(join(medias, 'Brume.Polaire.2021.1080p.mp4'));
  // Un nom de fichier piégé (caractères d'un interprète de commandes) : rien ne doit s'exécuter ni changer d'option.
  video(join(medias, 'Piege $(echo pwned) & ; -y.2020.mp4'), 2);
  video(join(series, 'Station Lumen', 'Saison 1', 'Station.Lumen.S01E01.mp4'), 3);
  video(join(series, 'Station Lumen', 'Saison 1', 'Station.Lumen.S01E02.mp4'), 3);
  ajouterDossier(mag(), medias, 'films'); ajouterDossier(mag(), series, 'series');
  await scanner(mag(), { ffprobe: ffprobeReel });
});
after(async () => { await attendreVignettes(); await attendreFiches(); reglerOutilsComete(); reglerFfmpegVignettes(); source.close(); odin?.close(); oublierMagasins(); rmSync(racine, { recursive: true, force: true }); });

test('vignette : une image tirée de la vraie vidéo (ffmpeg), gardée, servie par Odin ; arguments fixes, nom piégé sans effet', async () => {
  const m = mag(), film = m.liste('oeuvres').find((o) => o.data.titre === 'Brume Polaire')!;
  assert.ok(film, JSON.stringify(m.liste('oeuvres').map((o) => o.data.titre)));
  assert.equal(vignetteFaite(m, film.id), undefined, 'pas encore faite');
  const url = await fabriquerVignette(m, film.id);
  assert.match(String(url), /^\/venus\/api\/image\/[a-f0-9]{32}$/);
  const r = await api(`/venus/api/vignette/${encodeURIComponent(film.id)}`);
  assert.equal(r.status, 200); assert.equal(r.type, 'image/jpeg');
  assert.equal(r.entetes.get('x-content-type-options'), 'nosniff'); assert.match(String(r.entetes.get('content-security-policy')), /sandbox/);
  const v = verifierImage(r.corps); assert.ok(!('refus' in v), JSON.stringify(v));
  assert.equal((v as { largeur: number }).largeur, 480, 'réduite à 480 px de large');
  // Le nom piégé : les arguments restent les mêmes, le fichier est UN argument, rien ne s'exécute.
  const piege = m.liste('oeuvres').find((o) => /Piege/.test(String(o.data.titre)))!;
  const chemin = String(piege.data.fichier), a = argsVignette(chemin, join(racine, 'x.jpg'), 3);
  assert.equal(a[a.indexOf('-i') + 1], chemin); assert.ok(a.includes('-protocol_whitelist') && a[a.indexOf('-protocol_whitelist') + 1] === 'file');
  assert.match(String(await fabriquerVignette(m, piege.id)), /^\/venus\/api\/image\//);
  assert.ok(!existsSync(join(process.cwd(), 'pwned')) && !readdirSync(medias).some((f) => /pwned$/.test(f)));
  // Une cible inconnue, ou un fichier hors de la bibliothèque : FFmpeg n'est pas lancé.
  assert.equal(await fabriquerVignette(m, '../../etc/passwd'), undefined);
});

test('une seule extraction à la fois (machine de 4 cœurs)', async () => {
  const m = mag(); let enVol = 0, max = 0, appels = 0;
  reglerFfmpegVignettes(async () => { appels++; enVol++; max = Math.max(max, enVol); await new Promise((r) => setTimeout(r, 40)); enVol--; return false; });
  try {
    const eps = m.liste('episodes').map((e) => e.id); assert.equal(eps.length, 2);
    const n = demanderVignettes(m, eps); assert.equal(n, 2);
    await attendreVignettes();
    assert.ok(appels >= 2); assert.equal(max, 1, 'jamais deux FFmpeg en même temps');
  } finally { reglerFfmpegVignettes(); }
});

test('sans réglage enregistré : rien n\'est lu sur Internet ; la page n\'a que les vignettes et le nom du fichier', async () => {
  requetes.length = 0;
  const m = mag(), film = m.liste('oeuvres').find((o) => o.data.titre === 'Brume Polaire')!;
  assert.equal(await enrichir(m, local, film.id), 'sans_source');
  assert.equal(lancerFiches(m, () => local), 0);
  const c = await apiJson('/venus/api/catalogue'); assert.equal(c.status, 200);
  await attendreFiches();
  assert.equal(requetes.length, 0, `aucune requête : ${requetes.join(', ')}`);
  const t = (c.json.titres as Array<{ id: string; title: string; poster?: string; genres?: unknown }>).find((x) => x.id === film.id)!;
  assert.equal(t.title, 'Brume Polaire'); assert.equal(t.genres, undefined);
  assert.match(String(t.poster), /^\/venus\/api\/image\//, 'l\'affiche est la vignette tirée de la vidéo');
  assert.ok(!c.texte.includes('http'), 'aucune adresse extérieure envoyée à la page');
});

test('réglé (catalogue public des films, programme des séries) : fiches et images d\'une source simulée, rangées et servies par Odin', async () => {
  const m = mag(); requetes.length = 0; viderCacheCatalogue();
  reglerCatalogue(m, { films: 'public', series: true });
  const c0 = await apiJson('/venus/api/catalogue');
  assert.ok((c0.json.attente as { fiches: number }).fiches >= 2, JSON.stringify(c0.json.attente));
  await attendreFiches();
  const film = m.liste('oeuvres').find((o) => o.data.titre === 'Brume Polaire')!;
  const fi = film.data.fiche as Record<string, unknown>;
  assert.ok(fi, 'la fiche est rangée sur l\'œuvre (VENUS_ODIN)');
  assert.equal(fi.resume, 'Une base isolée dans la brume. alert(1)', 'balises retirées : le reste est du texte');
  assert.ok(!String(fi.resume).includes('<'), 'le résumé est du texte');
  assert.deepEqual(fi.genres, ['Drame', 'Science-fiction']); assert.equal(fi.noteCritiques, 7.4);
  assert.ok(requetes.some((r) => r.startsWith('/public/catalog/movie/top/search=Brume%20Polaire')), requetes.join('\n'));
  // Les images : téléchargées une fois, gardées, servies par Odin.
  const c = await apiJson('/venus/api/catalogue');
  const t = (c.json.titres as Array<Record<string, unknown>>).find((x) => x.id === film.id)!;
  assert.deepEqual(t.genres, ['Drame', 'Science-fiction']); assert.equal(t.critics, 7.4);
  assert.match(String(t.poster), /^\/venus\/api\/image\/[a-f0-9]{32}$/); assert.match(String(t.backdrop), /^\/venus\/api\/image\/[a-f0-9]{32}$/);
  assert.notEqual(t.poster, t.backdrop);
  const img = await api(String(t.backdrop)); assert.equal(img.status, 200); assert.equal(img.type, 'image/jpeg'); assert.ok(img.corps.equals(JPEG_LARGE));
  assert.ok(!c.texte.includes('http'), 'aucune adresse extérieure envoyée à la page');
  const avant = requetes.length; await enrichir(m, local, film.id);
  assert.ok(!requetes.slice(avant).some((r) => r.startsWith('/metahub')), 'une image déjà gardée n\'est pas relue');
  // La série : programme public, distribution et fond.
  const serie = m.liste('oeuvres').find((o) => o.data.titre === 'Station Lumen')!;
  const fs = serie.data.fiche as Record<string, unknown>;
  assert.equal(fs.resume, 'Une station lointaine .'); assert.equal(fs.note, 8.1);
  const ts = (c.json.titres as Array<Record<string, unknown>>).find((x) => x.id === serie.id)!;
  assert.equal(ts.vote, 8.1); assert.match(String(ts.backdrop), /^\/venus\/api\/image\//);
  // La fiche du titre pour la page : textes nettoyés, distribution, images d'Odin seulement.
  const f = await apiJson(`/venus/api/titre/${encodeURIComponent(film.id)}`);
  const meta = f.json.meta as { overview: string; cast: Array<{ id: string; name: string; role: string; photo?: string }>; crew: Array<{ name: string; role: string }> };
  assert.equal(meta.cast[0].name, 'Awa Diallo', 'un nom venu d\'Internet est du texte (balise retirée)'); assert.equal(meta.cast[0].role, 'La pilote');
  assert.match(String(meta.cast[0].photo), /^\/venus\/api\/image\//); assert.equal(meta.cast[1].photo, undefined);
  assert.deepEqual(meta.crew.map((x) => [x.name, x.role]), [['Inès Bello', 'Réalisation']]);
  assert.ok(!f.texte.includes('http') && !f.texte.includes('<img'), f.texte);
  // Dans la base : les images et les personnes ont leur registre.
  assert.ok(m.liste('images').length >= 4); assert.ok(m.get('personnes', idPersonne('Awa Diallo')));
  const dir = dirVenus(home); assert.ok(readdirSync(dir).includes('images.jsonl') && readdirSync(dir).includes('personnes.jsonl'));
});

test('distribution et fiche d\'une personne : ses titres de la bibliothèque, avec son rôle', async () => {
  const m = mag(), id = idPersonne('Awa Diallo');
  const p = personne(m, id)!; assert.equal(p.name, 'Awa Diallo'); assert.equal(p.titres.length, 2, 'le film et la série');
  const r = await apiJson(`/venus/api/personne/${id}`); assert.equal(r.status, 200);
  const titres = r.json.titres as Array<{ title: string; role: string; poster?: string }>;
  assert.deepEqual(titres.map((x) => [x.title, x.role]).sort(), [['Brume Polaire', 'La pilote'], ['Station Lumen', 'La commandante']]);
  assert.match(String(r.json.photo), /^\/venus\/api\/image\//);
  assert.equal((await apiJson('/venus/api/personne/pe-..%2F..%2Fetc')).status, 404);
  assert.equal((await apiJson('/venus/api/image/..%2F..%2Fsecret')).status, 404);
});

test('avec la clé du grand catalogue : sa fiche (accroche, note, distribution) remplace la fiche publique', async () => {
  const m = mag(); requetes.length = 0;
  reglerCatalogue(m, { films: 'cle', cle: CLE });
  const film = m.liste('oeuvres').find((o) => o.data.titre === 'Brume Polaire')!;
  assert.equal(await enrichir(m, local, film.id), 'fait');
  const fi = m.get('oeuvres', film.id)!.data.fiche as Record<string, unknown>;
  assert.equal(fi.source, 'grand'); assert.equal(fi.accroche, 'Personne ne reste seul.'); assert.equal(fi.note, 7.9);
  assert.ok(!requetes.some((r) => r.includes(CLE) && !r.startsWith('/grand/')), 'la clé ne part que vers le grand catalogue');
  assert.ok(!JSON.stringify(m.liste('oeuvres')).includes(CLE) && !JSON.stringify(m.liste('images')).includes(CLE), 'la clé n\'est rangée nulle part en clair');
  reglerCatalogue(m, { films: 'public' });
});

test('image piégée refusée : page, SVG, script caché, bombe de décompression, trop lourde, redirection, hôte inconnu', async () => {
  const m = mag();
  for (const chemin of ['svg.jpg', 'svgcache.jpg', 'bombe.png', 'poly.jpg', 'enorme.jpg']) {
    assert.equal(await telechargerImage(m, local, `https://image.tmdb.org/t/p/w500/${chemin}`, 'affiche'), undefined, chemin);
  }
  assert.equal(await telechargerImage(m, local, `${base}/tmdbimg/t/p/w500/x.jpg`, 'affiche'), undefined, 'http et hôte hors liste : refusé');
  assert.equal(await telechargerImage(m, local, 'https://exemple.test/x.jpg', 'affiche'), undefined, 'hôte inconnu');
  assert.deepEqual(verifierImage(BOMBE), { refus: 'image démesurée (bombe de décompression ?)' });
  assert.ok('refus' in verifierImage(POLYGLOTTE)); assert.ok('refus' in verifierImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(200))));
  // Le film « Piege » : sa fiche passe, ses images piégées (page déguisée, redirection) ne sont pas gardées.
  const piege = m.liste('oeuvres').find((o) => /Piege/.test(String(o.data.titre)))!;
  assert.equal(await enrichir(m, local, piege.id), 'fait');
  const fi = m.get('oeuvres', piege.id)!.data.fiche as Record<string, unknown>;
  assert.equal(fi.affiche, undefined); assert.equal(fi.fond, undefined); assert.deepEqual(fi.genres, ['Thriller']);
  for (const e of m.liste('images')) assert.ok(fichierImage(m, e.id), 'tout ce qui est gardé est une vraie image');
});

test('un non-propriétaire n\'ouvre ni les images, ni les vignettes, ni les personnes', async () => {
  const m = mag(), img = m.liste('images')[0].id, film = m.liste('oeuvres').find((o) => o.data.titre === 'Brume Polaire')!;
  proprio = false;
  try {
    for (const c of [`/venus/api/image/${img}`, `/venus/api/vignette/${encodeURIComponent(film.id)}`, `/venus/api/personne/${idPersonne('Awa Diallo')}`, '/venus/api/catalogue']) assert.equal((await api(c)).status, 401, c);
  } finally { proprio = true; }
});
