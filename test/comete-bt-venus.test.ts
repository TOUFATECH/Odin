// Vénus · le parcours complet avec le moteur de partage de fichiers de Comète, SANS Internet :
//   à venir → demande (Hnoss) → Sirius → Delta trouve un lien magnet → Comète (moteur de partage : tracker, pairs,
//   description, morceaux vérifiés) → vidéo seulement, antivirus → rangé, renommé → scanné → visible dans Vénus.
// Et : un lien direct qui convient passe devant un lien de partage ; une série par un lien .torrent (seul l'épisode
// voulu est gardé) ; les réglages du partage (propriétaire seul, bornés, écoute coupée par défaut).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { brancherGarde, type Passage } from '../src/valhalla/ullr/garde.ts';
import { magasinVenus } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, bibliotheque, fichierDeCible, type Outils } from '../src/valhalla/venus/bibliotheque.ts';
import { attendreComete, moteursInscrits, reglerOutilsComete, telechargement } from '../src/valhalla/venus/comete/index.ts';
import { reglerEssaiPartage } from '../src/valhalla/venus/comete/bt/moteur.ts';
import { ecrire, lire } from '../src/valhalla/venus/comete/bt/bencode.ts';
import { EBML, compact, fabriquer, fauxPair, type FauxPair } from './comete-bt-aides.ts';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const film = fabriquer({ nom: 'Etoile Filante (2023)', tailleVideo: 400_000 });
const serie = fabriquer({ nom: 'Les Astres S01', tailleVideo: 200_000, chemins: [Buffer.from('Les.Astres.S01E02.1080p.mkv')] });
const directVideo = Buffer.concat([EBML, randomBytes(3000)]);
let pairsFilm: FauxPair[] = [], pairsSerie: FauxPair[] = [];
const item = (titre: string, lien: string, type: string, taille?: number) => `<item><title>${titre}</title><link>${lien.replace(/&/g, '&amp;')}</link><enclosure url="${lien.replace(/&/g, '&amp;')}" length="${taille ?? 0}" type="${type}"/></item>`;
const magnetFilm = () => `magnet:?xt=urn:btih:${film.empreinte.toString('hex')}&dn=Etoile.Filante.2023.1080p&tr=${encodeURIComponent('http://tracker.exemple.test/announce')}`;
function flux(q: URLSearchParams): string {
  const t = q.get('q') ?? '', items: string[] = [];
  if (t === 'Etoile Filante') items.push(item('Etoile.Filante.2023.1080p.WEB', magnetFilm(), 'application/x-bittorrent', 9e8));
  if (t === 'Comete Directe') items.push(item('Comete.Directe.2022.1080p.MULTI', magnetFilm(), 'application/x-bittorrent', 9e8), item('Comete.Directe.2022.1080p.WEB', 'http://fichiers.exemple.test/f/direct.mkv', 'video/x-matroska', directVideo.length));
  if (t === 'Les Astres' && (!q.get('ep') || q.get('ep') === '2')) items.push(item('Les.Astres.S01E02.1080p.WEB', 'http://fichiers.exemple.test/t/astres.torrent', 'application/x-bittorrent', 5e8));
  return `<?xml version="1.0"?><rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${items.join('')}</channel></rss>`;
}
let srv: Server, base = '';
const annonces: string[] = [];
const home = mkdtempSync(join(tmpdir(), 'venus-bt-'));
const local: typeof fetch = (u, i) => fetch(String(u).replace(/^http:\/\/[a-z]+\.exemple\.test/, base), i);
const faux: Outils = { ffprobe: async (f) => (readFileSync(f).subarray(0, 4).equals(EBML) ? { duree: 120, hauteur: 1080, codecs: ['h264'], audio: ['aac'], sousTitres: [] } : null) };
let v: Valhalla;
const mag = () => magasinVenus(home, v.ctx('freyja').dir);
const films = join(home, 'Medias', 'Films'), series = join(home, 'Medias', 'Series');
const act = (a: string, i: Record<string, unknown> = {}) => v.act('freyja', a, i);

before(async () => {
  pairsFilm = await Promise.all([fauxPair(film), fauxPair(film), fauxPair(film, { mauvais: (i) => i === 3 })]);
  pairsSerie = await Promise.all([fauxPair(serie), fauxPair(serie)]);
  srv = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/api') { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end(u.searchParams.get('t') === 'caps' ? '<caps><searching/></caps>' : flux(u.searchParams)); return; }
    if (u.pathname === '/announce') {
      annonces.push(req.url!);
      const brut = /info_hash=([^&]+)/.exec(req.url!)?.[1] ?? '';
      const ps = Buffer.from(unescape(brut), 'latin1').equals(film.empreinte) ? pairsFilm : pairsSerie;
      res.writeHead(200); res.end(ecrire({ interval: 60, peers: compact(ps.map((p) => p.port)) })); return;
    }
    if (u.pathname === '/t/astres.torrent') { const t = ecrire({ announce: Buffer.from('http://tracker.exemple.test/announce'), info: lireInfoDict(serie.info) }); res.writeHead(200, { 'content-length': t.length }); res.end(t); return; }
    if (u.pathname === '/f/direct.mkv') {
      const m = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''));
      if (m) { const d = Number(m[1]), f = m[2] ? Number(m[2]) : directVideo.length - 1, part = directVideo.subarray(d, f + 1); res.writeHead(206, { 'content-range': `bytes ${d}-${f}/${directVideo.length}`, 'content-length': part.length, 'accept-ranges': 'bytes', etag: '"d1"' }); res.end(part); return; }
      res.writeHead(200, { 'content-length': directVideo.length, etag: '"d1"' }); res.end(directVideo); return;
    }
    res.writeHead(404); res.end();
  });
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening'); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  // Réglage d'essai explicite : le réseau passe par le serveur local, les faux pairs locaux sont permis (jamais par défaut).
  reglerOutilsComete({ outils: faux, resoudre: async (h) => (/\.exemple\.test$/.test(h) ? ['203.0.113.10'] : []), reseauEssai: local });
  reglerEssaiPartage({ patience: 5000 });
  brancherGarde(async (): Promise<Passage> => ({ ok: true, bloque: false, analyse: true, sha256: '0'.repeat(64), taille: 1, score: 0, pourquoi: [], texte: 'rien', gardien: 'asclepios' } as Passage));
  v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { notify: async () => undefined, autonomy: () => 'equilibre', fetch: local } as never);
  const ullr = v.modules().find((m) => m.id === 'ullr')!.actions.find((a) => a.id === 'adresse')!;
  ullr.run = (async () => ({ text: '', data: { score: 0 } })) as typeof ullr.run;
  mkdirSync(films, { recursive: true }); mkdirSync(series, { recursive: true });
  ajouterDossier(mag(), films, 'films'); ajouterDossier(mag(), series, 'series');
  assert.equal((await act('delta_ajouter', { nom: 'Mon indexeur', type: 'torznab', adresse: 'http://indexeur.exemple.test/api', cle: 'cle-essai' })).ok, true);
});
after(async () => { await attendreComete(); v?.stop(); srv?.close(); for (const p of [...pairsFilm, ...pairsSerie]) await p.fermer(); brancherGarde(undefined); reglerOutilsComete(); reglerEssaiPartage(); rmSync(home, { recursive: true, force: true }); });
// Le dictionnaire info d'un partage fabriqué (pour écrire un .torrent qui pointe vers le faux tracker).
const lireInfoDict = (info: Buffer) => lire(info).valeur;

test('le moteur de partage est inscrit dans Comète', () => {
  assert.ok(moteursInscrits().some((n) => /partage de fichiers/.test(n)), moteursInscrits().join(', '));
});

test('parcours d\'un film : à venir → Delta trouve un magnet → Comète (partage) → vérifié → rangé → visible dans Vénus', async () => {
  const r = await act('hnoss_obtenir', { titre: 'Etoile Filante', genre: 'film', annee: '2023' });
  assert.equal(r.ok, true, r.text);
  const d = r.data as { demande: { id: string }; telechargements: Array<{ id: string; moteur: string }> };
  assert.equal(d.telechargements.length, 1, r.text); assert.equal(d.telechargements[0].moteur, 'partage');
  await attendreComete();
  const t = telechargement(mag(), d.telechargements[0].id)!;
  assert.equal(t.etat, 'termine', t.texte);
  const final = join(films, 'Etoile Filante (2023)', 'Etoile Filante (2023).mkv');
  assert.equal(t.chemin, final);
  assert.equal(sha(readFileSync(final)), sha(film.video), 'seule la vidéo du partage, exacte, est rangée');
  assert.ok(bibliotheque(mag()).some((c) => c.id === 'film:etoile-filante-2023'), 'visible dans Vénus');
  assert.equal(fichierDeCible(mag(), 'film:etoile-filante-2023')?.fichier, final);
  assert.ok(annonces.some((a) => a.includes('peer_id=-OD0100-')), 'le tracker a été questionné');
  // Rien ne reste dans le dossier de travail de Comète (ni morceaux de bord, ni état, ni extrait, ni texte).
  const travail = join(v.ctx('freyja').dir, 'comete', 'en-cours');
  assert.deepEqual(existsSync(travail) ? readdirSync(travail) : [], []);
  assert.ok(!readdirSync(join(films, 'Etoile Filante (2023)')).some((x) => /sample|txt/i.test(x)));
  const j = await act('comete_journal'); assert.match(j.text, /terminé/);
});

test('un lien direct qui convient passe devant un lien de partage', async () => {
  const r = await act('hnoss_obtenir', { titre: 'Comete Directe', genre: 'film', annee: '2022' });
  const d = r.data as { telechargements: Array<{ id: string; moteur: string }> };
  assert.equal(d.telechargements[0]?.moteur, 'direct', r.text);
  await attendreComete();
  assert.equal(telechargement(mag(), d.telechargements[0].id)!.etat, 'termine');
});

test('une série par un lien .torrent : seul l\'épisode voulu, rangé sous la saison', async () => {
  const r = await act('hnoss_obtenir', { titre: 'Les Astres', genre: 'série', saisons: '1', episode: '2' });
  assert.equal(r.ok, true, r.text);
  const d = r.data as { telechargements: Array<{ id: string; moteur: string }> };
  assert.equal(d.telechargements[0]?.moteur, 'partage', r.text);
  await attendreComete();
  const t = telechargement(mag(), d.telechargements[0].id)!;
  assert.equal(t.etat, 'termine', t.texte);
  assert.equal(t.chemin, join(series, 'Les Astres', 'Saison 01', 'Les Astres - S01E02.mkv'));
  assert.equal(sha(readFileSync(t.chemin!)), sha(serie.video));
});

test('réglages du partage : propriétaire seul, bornés ; écoute entrante coupée par défaut et jamais sans port', async () => {
  const e = (await act('acquisition')).data as { partage: { ecoute: boolean; envoiPendant: boolean; envoiKo: number; ratio: number } };
  assert.equal(e.partage.ecoute, false); assert.equal(e.partage.envoiKo, 100); assert.equal(e.partage.ratio, 1);
  assert.equal((await v.act('freyja', 'comete_regler', { envoi_ko: '5' }, { qui: 'member' })).ok, false, 'un membre ne règle rien');
  assert.equal((await act('comete_regler', { ecoute: 'oui' })).ok, false, 'pas d\'écoute sans port');
  const r = await act('comete_regler', { pairs_max: '999', envoi_ko: '20', ratio: '0.5', envoi_pendant: 'non' });
  assert.equal(r.ok, true, r.text);
  const p = (r.data as { partage: { maxPairs: number; envoiKo: number; ratio: number; envoiPendant: boolean } }).partage;
  assert.deepEqual([p.maxPairs, p.envoiKo, p.ratio, p.envoiPendant], [50, 20, 0.5, false]);
  assert.match(r.text, /envoi coupé/); assert.match(r.text, /connexions sortantes seulement/);
});
