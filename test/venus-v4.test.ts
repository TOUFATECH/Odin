// Vénus, lots V4-V6 : les écrans de demande et de téléchargement branchés sur la chaîne native, côté Odin.
//   - le catalogue des sorties repris de Venus (programme des séries, des animés, catalogue des films) : rien de lu tant
//     que le propriétaire n'a rien réglé ; réglé, « À venir » se remplit (sources SIMULÉES par un serveur local) ;
//   - la clé du catalogue et celle d'une source ne sont jamais montrées ni écrites en clair ;
//   - ⬇ sur « À venir » (le corps que la page envoie) lance toute la chaîne ; ♡ pose une envie ;
//   - « Demandes au nom de chacun » : un membre libre voit sa demande partir, un autre la voit attendre la validation ;
//     un membre libre ne règle toujours ni les sources ni n'accepte un fichier mis à part.
// Aucun vrai téléchargement, aucun vrai catalogue : tout passe par 127.0.0.1 (réglage d'essai explicite de Comète).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import vm from 'node:vm';
import type { AddressInfo } from 'node:net';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { brancherGarde, type Passage } from '../src/valhalla/ullr/garde.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import { magasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, type Outils } from '../src/valhalla/venus/bibliotheque.ts';
import { attendreComete, reglerOutilsComete, telechargement } from '../src/valhalla/venus/comete/index.ts';
import { texte, viderCacheCatalogue } from '../src/valhalla/venus/catalogue/index.ts';

const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const FICHIERS: Record<string, Buffer> = { '/f/station.mkv': Buffer.concat([EBML, randomBytes(3000)]), '/f/voiles.mkv': Buffer.concat([EBML, randomBytes(3200)]), '/f/tard.mkv': Buffer.concat([EBML, randomBytes(2100)]), '/f/doute.mkv': Buffer.concat([EBML, randomBytes(2000)]) };
const CLE_CAT = 'cle-catalogue-essai-0123456789';
const requetes: string[] = [];
const auj = new Date(), iso = (d: number) => { const x = new Date(Date.now() + d * 864e5); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const item = (titre: string, lien: string) => `<item><title>${titre}</title><link>${lien}</link><enclosure url="${lien}" length="${FICHIERS[new URL(lien).pathname]?.length ?? 0}" type="video/x-matroska"/></item>`;
const F = 'http://fichiers.exemple.test';
function flux(q: string): string {
  const l: string[] = [];
  if (q === 'Station Polaire') l.push(item('Station.Polaire.S02E08.1080p.WEB', `${F}/f/station.mkv`));
  if (q === 'Les Voiles') l.push(item(`Les.Voiles.${auj.getFullYear()}.1080p.WEB`, `${F}/f/voiles.mkv`));
  if (q === 'Tard') l.push(item('Tard.2021.1080p', `${F}/f/tard.mkv`));
  if (q === 'Doute') l.push(item('Doute.2020.1080p', `${F}/f/doute.mkv`));
  return `<?xml version="1.0"?><rss><channel>${l.join('')}</channel></rss>`;
}
const json = (res: import('node:http').ServerResponse, v: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url!, 'http://x'); requetes.push(`${req.method} ${u.pathname}?${u.searchParams.toString()}`);
  if (u.pathname === '/api') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end(u.searchParams.get('t') === 'caps' ? '<caps><searching/></caps>' : flux(u.searchParams.get('q') ?? '')); return; }
  // Le programme des séries (simulé) : une série très suivie, dont le titre porte une balise piégée.
  if (u.pathname.startsWith('/tvmaze/schedule')) {
    const date = u.searchParams.get('date');
    json(res, date === iso(1) && !u.pathname.endsWith('/web') && u.searchParams.get('country') === 'US' ? [{ airdate: date, airstamp: `${date}T20:00:00Z`, season: 2, number: 8, name: 'Le signal', show: { id: 77, name: 'Station Polaire', type: 'Scripted', weight: 95, premiered: '2024-01-01', genres: ['Drama'], summary: '<p>Une base <b>isolée</b>.</p>', network: { name: 'Chaîne <script>alert(1)</script>' } } },
      { airdate: date, season: 1, number: 1, show: { id: 78, name: '<img src=x onerror=alert(1)>Piège', type: 'Scripted', weight: 90 } },
      { airdate: date, season: 1, number: 1, show: { id: 79, name: 'Peu Suivie', type: 'Scripted', weight: 10 } }] : []);
    return;
  }
  if (u.pathname === '/anilist') {
    let corps = ''; for await (const c of req) corps += c;
    const q = JSON.parse(corps) as { query: string };
    json(res, q.query.includes('airingSchedules') ? { data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [{ episode: 5, airingAt: Math.floor((Date.now() + 2 * 864e5) / 1000), media: { id: 501, isAdult: false, popularity: 50000, format: 'TV', title: { english: 'Etoile de Fer', romaji: 'Tetsu no Hoshi' } } }] } } } : { data: { Page: { media: [] } } });
    return;
  }
  if (u.pathname.startsWith('/grand/')) {
    if (u.searchParams.get('api_key') !== CLE_CAT) { res.writeHead(401); res.end('{}'); return; }
    json(res, u.pathname.endsWith('/movie/upcoming') && u.searchParams.get('page') === '1' ? { results: [{ id: 900, title: 'Les Voiles', release_date: iso(10), overview: 'Un film.', popularity: 80 }] } : { results: [] });
    return;
  }
  const corps = FICHIERS[u.pathname]; if (!corps) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-length': corps.length }); res.end(corps);
});
let base = '';
const local: typeof fetch = (u, i) => fetch(String(u)
  .replace(/^http:\/\/(indexeur|fichiers)\.exemple\.test/, base).replace(/^https:\/\/api\.tvmaze\.com/, `${base}/tvmaze`)
  .replace(/^https:\/\/graphql\.anilist\.co/, `${base}/anilist`).replace(/^https:\/\/api\.themoviedb\.org\/3/, `${base}/grand`)
  .replace(/^https:\/\/v3-cinemeta\.strem\.io/, `${base}/public`), i);
const home = mkdtempSync(join(tmpdir(), 'venus-v4-')), messages: string[] = [];
let douteux = false;
const faux: Outils = { ffprobe: async (f) => (readFileSync(f).subarray(0, 4).equals(EBML) ? { duree: 120, hauteur: 1080, codecs: ['h264'], audio: ['aac'], sousTitres: [] } : null) };
let v: Valhalla;
const mag = () => magasinVenus(home, v.ctx('freyja').dir);
const act = (a: string, i: Record<string, unknown> = {}) => v.act('freyja', a, i);
const membre = (login: string, a: string, i: Record<string, unknown>) => auNomDe({ login, name: `Membre ${login}`, groups: ['invite'] }, () => v.act('freyja', a, i));
const catalogueRequetes = () => requetes.filter((r) => /\/(tvmaze|anilist|grand|public)/.test(r));
/** La logique de la page (app.js), chargée sans navigateur : le corps exact qu'un clic envoie. */
const L = (() => { const APP = new URL('../src/valhalla/venus/app/', import.meta.url); const ctx = vm.createContext({ window: {}, URLSearchParams, Intl }); vm.runInContext(readFileSync(new URL('planetes.js', APP), 'utf8'), ctx); vm.runInContext(readFileSync(new URL('app.js', APP), 'utf8'), ctx); return (ctx.window as { VenusApp: { L: Record<string, (...a: unknown[]) => { module: string; action: string; input: Record<string, unknown>; confirm?: boolean }> } }).VenusApp.L; })();
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;

before(async () => {
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening'); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  // Réglage d'essai explicite : tout le réseau de Vénus passe par le serveur local (jamais par défaut).
  reglerOutilsComete({ outils: faux, resoudre: async (h) => (/\.exemple\.test$/.test(h) ? ['203.0.113.10'] : []), reseauEssai: local });
  brancherGarde(async (): Promise<Passage> => ({ ok: !douteux, bloque: false, analyse: true, sha256: '0'.repeat(64), taille: 1, score: 0, pourquoi: [], texte: 'rien', gardien: 'asclepios' } as Passage));
  setVerificateur(() => undefined);
  v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { notify: async (t: string) => { messages.push(t); }, autonomy: () => 'equilibre', fetch: local } as never);
  const ullr = v.modules().find((m) => m.id === 'ullr')!.actions.find((a) => a.id === 'adresse')!;
  ullr.run = (async () => ({ text: '', data: { score: 0 } })) as typeof ullr.run;
  const films = join(home, 'Medias', 'Films'), series = join(home, 'Medias', 'Series'); mkdirSync(films, { recursive: true }); mkdirSync(series, { recursive: true });
  ajouterDossier(mag(), films, 'films'); ajouterDossier(mag(), series, 'series');
});
after(async () => { await attendreComete(); v?.stop(); srv.close(); brancherGarde(undefined); reglerOutilsComete(); rmSync(home, { recursive: true, force: true }); });

test('catalogue par défaut : seul le catalogue public des films (sans clé) est lu ; séries, animés et Nouveautés le disent et ne lisent rien', async () => {
  // Réponse du propriétaire (23/11) : « À venir » des films se remplit dès le départ par le catalogue public sans clé.
  for (const genre of ['série', 'animé']) {
    const r = await act('a_venir', { genre }); const d = r.data as { source: boolean; entries: unknown[]; texte: string };
    assert.equal(d.source, false); assert.equal(d.entries.length, 0); assert.match(d.texte, /n'est réglé|ne lit rien/);
  }
  const n = (await act('sorties_nouveautes', { genre: 'film' })).data as { source: boolean; texte: string };
  assert.equal(n.source, false); assert.match(n.texte, /clé/);
  assert.equal(catalogueRequetes().length, 0, 'aucune requête vers un catalogue');
  const fi = (await act('a_venir', { genre: 'film' })).data as { source: boolean };
  assert.equal(fi.source, true, 'les films : le catalogue public, coché par défaut');
  assert.ok(catalogueRequetes().length > 0 && catalogueRequetes().every((r) => r.startsWith('GET /public/')), JSON.stringify(catalogueRequetes()));
});

test('réglage du catalogue et des sources : propriétaire seul, la clé n\'est jamais montrée ni écrite en clair', async () => {
  assert.equal((await v.act('freyja', 'catalogue_regler', { series: true }, { qui: 'member' })).ok, false, 'un membre ne règle pas le catalogue');
  assert.equal((await membre('lina', 'catalogue_regler', { series: true })).ok, false);
  const r = await act('catalogue_regler', { series: true, animes: true, films: 'cle', cle: CLE_CAT });
  assert.equal(r.ok, true, r.text); assert.ok(!r.text.includes(CLE_CAT));
  const e = await act('catalogue_etat'); assert.ok(!JSON.stringify(e).includes(CLE_CAT)); assert.equal((e.data as { reglages: { aCle: boolean } }).reglages.aCle, true);
  const s = await act('delta_ajouter', { nom: 'Mon indexeur', adresse: 'http://indexeur.exemple.test/api', cle: 'cle-source-essai-456' }); assert.equal(s.ok, true, s.text);
  const l = await act('delta_sources'); assert.ok(!JSON.stringify(l).includes('cle-source-essai-456'));
  const dir = v.ctx('freyja').dir;
  for (const f of readdirSync(dir)) if (/\.(jsonl?|db)$/.test(f)) { const c = readFileSync(join(dir, f), 'utf8'); assert.ok(!c.includes(CLE_CAT) && !c.includes('cle-source-essai-456'), `aucune clé en clair dans ${f}`); }
  assert.equal(texte('<b>Titre</b> piégé'), 'Titre piégé', 'un texte de catalogue est nettoyé');
});

test('catalogue réglé : « À venir » rempli (sources simulées), titres nettoyés, ce qui est peu suivi écarté', async () => {
  viderCacheCatalogue();
  const sr = (await act('a_venir', { genre: 'série' })).data as { source: boolean; entries: Array<{ title: string; season?: number; episode?: number; date: string; overview?: string; network?: string; key: string }>; suggestions: unknown[] };
  assert.equal(sr.source, true);
  const st = sr.entries.find((x) => x.title === 'Station Polaire'); assert.ok(st, JSON.stringify(sr.entries));
  assert.equal(st.season, 2); assert.equal(st.episode, 8); assert.equal(st.date, iso(1)); assert.equal(st.overview, 'Une base isolée .');
  assert.ok(!JSON.stringify(sr).includes('<'), 'aucune balise ne passe : les titres sont du texte');
  assert.ok(!sr.entries.some((x) => x.title === 'Peu Suivie'), 'une série peu suivie hors bibliothèque est écartée (comme Venus)');
  assert.ok(sr.suggestions.length >= 1);
  const an = (await act('a_venir', { genre: 'animé' })).data as { entries: Array<{ title: string; episode?: number; kind: string }> };
  assert.deepEqual(ici(an.entries.map((x) => [x.title, x.episode, x.kind])), [['Etoile de Fer', 5, 'anime']]);
  const fi = (await act('a_venir', { genre: 'film' })).data as { entries: Array<{ title: string; key: string }> };
  assert.ok(fi.entries.some((x) => x.title === 'Les Voiles'), JSON.stringify(fi));
  assert.ok(catalogueRequetes().some((r) => r.startsWith('GET /grand/movie/upcoming') && r.includes(`api_key=${CLE_CAT}`)), 'la clé part seulement au catalogue');
  assert.ok(!JSON.stringify(fi).includes(CLE_CAT));
});

test('⬇ sur « À venir » : le corps envoyé par la page (confirm: true) lance toute la chaîne', async () => {
  const sr = (await act('a_venir', { genre: 'série' })).data as { entries: Array<Record<string, unknown>> };
  const e = sr.entries.find((x) => x.title === 'Station Polaire')!;
  const corps = L.obtenir(e);
  assert.equal(corps.action, 'hnoss_obtenir'); assert.equal(corps.confirm, true, 'le clic est la confirmation');
  assert.deepEqual(ici(corps.input), { titre: 'Station Polaire', genre: 'série', saisons: '2', episode: '8' });
  const f = v.action('freyja', 'hnoss_obtenir')!; assert.ok(f.a.grave?.(corps.input, v.ctx('freyja')), 'sans confirm, la route demande la confirmation');
  const r = await act(corps.action, corps.input); assert.equal(r.ok, true, r.text);
  const d = r.data as { demande: { etat: string }; telechargements: Array<{ id: string; cible: { saison: number; episode: number } }> };
  assert.equal(d.telechargements.length, 1, r.text); assert.deepEqual(ici([d.telechargements[0].cible.saison, d.telechargements[0].cible.episode]), [2, 8]);
  assert.equal(d.demande.etat, 'en téléchargement');
  await attendreComete();
  assert.equal(telechargement(mag(), d.telechargements[0].id)?.etat, 'termine');
});

test('♡ : l\'envie est posée (et lancée pour le propriétaire), « À venir » la marque, ♡ de nouveau la retire', async () => {
  const fi = (await act('a_venir', { genre: 'film' })).data as { entries: Array<Record<string, unknown>> };
  const e = fi.entries.find((x) => x.title === 'Les Voiles')!;
  const corps = L.envie(e, false);
  assert.equal(corps.action, 'hnoss_envie'); assert.equal(corps.confirm, true); assert.equal(corps.input.cle, e.key);
  const r = await act(corps.action, corps.input); assert.equal(r.ok, true, r.text);
  const l = (await act('hnoss_envies')).data as { envies: Array<{ titre: string; envie: boolean; cle: string; etat: string }> };
  assert.equal(l.envies.length, 1); assert.equal(l.envies[0].cle, e.key); assert.equal(l.envies[0].etat, 'en téléchargement');
  const de = ((await act('a_venir', { genre: 'film' })).data as { entries: Array<{ key: string; wanted?: boolean }> }).entries.find((x) => x.key === e.key);
  assert.equal(de?.wanted, true, '« À venir » montre le ♡ allumé');
  await attendreComete();
  const off = L.envie(e, true); assert.equal(off.input.retirer, true); assert.equal(off.confirm, undefined, 'retirer ne télécharge rien');
  assert.equal((await act(off.action, off.input)).ok, true);
  assert.equal(((await act('hnoss_envies')).data as { envies: unknown[] }).envies.length, 0);
});

test('Demandes au nom de chacun : un membre libre part sans validation, un autre attend ; le libre ne règle rien', async () => {
  assert.equal((await membre('lina', 'hnoss_regler_libres', { libres: 'lina' })).ok, false, 'un membre ne se rend pas libre lui-même');
  const r = await act('hnoss_regler_libres', { libres: 'lina' }); assert.equal(r.ok, true, r.text);
  assert.deepEqual(ici((r.data as { libres: string[] }).libres), ['lina']);
  // Le libre : la demande part (l'IA et la parole demanderaient confirmation : l'action est grave pour lui).
  const g = await auNomDe({ login: 'lina', name: 'Lina', groups: ['invite'] }, async () => v.action('freyja', 'hnoss_demander')!.a.grave?.({ titre: 'Tard' }, v.ctx('freyja')));
  assert.ok(g, 'pour un membre libre, la demande télécharge : grave');
  const a = await membre('lina', 'hnoss_demander', { titre: 'Tard', genre: 'film', annee: '2021' }); assert.equal(a.ok, true, a.text);
  assert.equal((a.data as { demande: { etat: string; valideePar?: string } }).demande.etat, 'en téléchargement', a.text);
  assert.match(String((a.data as { demande: { valideePar?: string } }).demande.valideePar), /^libre:lina$/);
  // L'autre membre : à valider, le propriétaire est prévenu.
  messages.length = 0;
  const b = await membre('omar', 'hnoss_demander', { titre: 'Doute', genre: 'film' }); assert.equal(b.ok, true, b.text);
  assert.equal((b.data as { demande: { etat: string } }).demande.etat, 'à valider'); assert.ok(messages.some((m) => /Doute/.test(m) && /valider/.test(m)));
  assert.equal(await auNomDe({ login: 'omar', name: 'Omar', groups: ['invite'] }, async () => v.action('freyja', 'hnoss_demander')!.a.grave?.({ titre: 'Doute' }, v.ctx('freyja'))), undefined, 'rien ne télécharge : pas grave');
  // Le libre ne règle toujours ni les sources, ni Comète, et n'accepte pas un fichier mis à part.
  assert.equal((await membre('lina', 'delta_ajouter', { nom: 'X', adresse: 'http://indexeur.exemple.test/api' })).ok, false);
  assert.equal((await membre('lina', 'comete_regler', { simultanes: 4 })).ok, false);
  await attendreComete();
  douteux = true;
  const c = await act('hnoss_obtenir', { titre: 'Doute', genre: 'film', annee: '2020' }); const id = (c.data as { telechargements: Array<{ id: string }> }).telechargements[0]?.id; assert.ok(id, c.text);
  await attendreComete(); douteux = false;
  assert.equal(telechargement(mag(), id)?.etat, 'a_part');
  assert.equal((await membre('lina', 'comete_accepter', { id })).ok, false, 'un membre libre n\'accepte pas un fichier mis à part');
  assert.equal((await act('comete_jeter', { id })).ok, true);
  // Retiré de la liste : la demande suivante de Lina attend de nouveau.
  await act('hnoss_regler_libres', { libres: '' });
  const z = await membre('lina', 'hnoss_demander', { titre: 'Autre Chose', genre: 'film' }); assert.equal((z.data as { demande: { etat: string } }).demande.etat, 'à valider');
});
