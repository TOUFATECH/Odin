// Vénus, « lance-moi tel film, telle série, à tel épisode » (L2) : l'action « regarder » comprend la saison et
// l'épisode (donnés à part, ou écrits S02E05 / 2x05 dans le titre), la cible jouée est TOUJOURS un fichier (film,
// épisode, piste), un titre ou un épisode absent donne une réponse claire, le scan lit les dossiers « Saison N »,
// et la page de Vénus ouverte avec l'intention de lire un titre démarre le lecteur dessus.
// Titres inventés, dossiers temporaires, aucun service réel (le faux Home Assistant écoute sur 127.0.0.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import vm from 'node:vm';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { venusRoute } from '../src/valhalla/venus/routes.ts';
import { dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import * as bib from '../src/valhalla/venus/bibliotheque.ts';
import { venus } from '../src/valhalla/modules/venus.ts';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const AVEC_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const sansFfmpeg = AVEC_FFMPEG ? false : 'FFmpeg absent de cette machine d\'essai';
type Res = { text: string; data?: Record<string, unknown> };

/** Un Odin d'essai : magasin Vénus vide, module sans serveur à part. */
function monter(settings: Record<string, unknown> = {}) {
  oublierMagasins();
  const home = tmp('venus-regarder-'), dir = dirVenus(home);
  const ctx = { home, dir, settings, saveSettings() {}, alert() {}, emit() {}, now: () => new Date() } as never;
  const regarder = venus(() => '').actions.find((a) => a.id === 'regarder')!;
  return { home, mag: magasinVenus(home, dir), run: (i: Record<string, unknown>) => regarder.run(ctx, { ou: '', ...i }) as Promise<Res>, regarder };
}
/** Une petite bibliothèque inventée, rangée à la main (sans FFmpeg). */
function remplir(mag: ReturnType<typeof magasinVenus>, racine: string) {
  mag.poser('oeuvres', 'film:essai-trois', { type: 'film', titre: 'Essai Trois', fichier: join(racine, 'Essai Trois.mp4'), duree: 60 });
  mag.poser('oeuvres', 'serie:serie-essai', { type: 'serie', titre: 'Serie Essai' });
  for (const [sa, ep] of [[1, 1], [1, 2], [2, 1], [2, 5]]) mag.poser('episodes', `serie:serie-essai:s${sa}e${ep}`, { oeuvre_id: 'serie:serie-essai', saison: sa, episode: ep, titre: 'Serie Essai', fichier: join(racine, `Serie Essai S0${sa}E0${ep}.mp4`), duree: 100 });
  mag.poser('oeuvres', 'album:album-essai', { type: 'album', titre: 'Album Essai' });
  mag.poser('pistes', 'album:album-essai:p1:un', { oeuvre_id: 'album:album-essai', num: 1, titre: 'Un', fichier: join(racine, '01 Un.mp3'), duree: 100 });
  mag.poser('pistes', 'album:album-essai:p2:deux', { oeuvre_id: 'album:album-essai', num: 2, titre: 'Deux', fichier: join(racine, '02 Deux.mp3'), duree: 100 });
  mag.poser('oeuvres', 'livre_audio:livre-essai', { type: 'livre_audio', titre: 'Livre Essai' });
  mag.poser('pistes', 'livre_audio:livre-essai:p1:chap', { oeuvre_id: 'livre_audio:livre-essai', num: 1, titre: 'Chap', fichier: join(racine, '01 Chap.mp3'), duree: 100 });
}
const sansCle = async (f: () => Promise<void>) => { const cle = process.env.VENUS_API_KEY; delete process.env.VENUS_API_KEY; try { await f(); } finally { if (cle === undefined) delete process.env.VENUS_API_KEY; else process.env.VENUS_API_KEY = cle; } };

test('la demande se lit : S02E05, s2e5, « S02 E05 », 2x05 ; sans forme chiffrée, le titre reste entier', () => {
  assert.deepEqual(bib.lireDemande('Serie Essai S02E05'), { titre: 'Serie Essai', saison: 2, episode: 5 });
  assert.deepEqual(bib.lireDemande('serie essai s2e5'), { titre: 'serie essai', saison: 2, episode: 5 });
  assert.deepEqual(bib.lireDemande('Serie Essai S02 E05'), { titre: 'Serie Essai', saison: 2, episode: 5 });
  assert.deepEqual(bib.lireDemande('Serie Essai 2x05'), { titre: 'Serie Essai', saison: 2, episode: 5 });
  assert.deepEqual(bib.lireDemande('Essai Trois'), { titre: 'Essai Trois' });
  // Aucune liste de mots d'une langue dans l'action : « saison », « épisode » sont compris en amont et arrivent à part.
  assert.equal(bib.lireDemande('Serie Essai saison 2 episode 5').saison, undefined);
});

test('« regarder » une série : S02E05 et 2x05 dans le titre, ou saison et épisode donnés à part → CET épisode, lien d\'un fichier', async () => {
  await sansCle(async () => {
    const o = monter();
    try {
      remplir(o.mag, o.home);
      for (const i of [{ quoi: 'Serie Essai S02E05' }, { quoi: 'serie essai 2x05' }, { quoi: 'Serie Essai', saison: 2, episode: 5 }, { quoi: 'Serie Essai', saison: '2', episode: '5' }]) {
        const r = await o.run(i);
        assert.equal(r.data?.cible, 'serie:serie-essai:s2e5', JSON.stringify(i));
        assert.equal(r.data?.lire, '/venus/flux/serie%3Aserie-essai%3As2e5');
        assert.match(r.text, /« Serie Essai » S02E05/);
        assert.match(r.text, /Odéon/);
      }
      // le flux rendu pointe bien un fichier (avant : l'œuvre, sans fichier → 404)
      assert.equal(bib.fichierDeCible(o.mag, 'serie:serie-essai:s2e5')?.fichier, join(o.home, 'Serie Essai S02E05.mp4'));
    } finally { rmSync(o.home, { recursive: true, force: true }); }
  });
});

test('série seule : l\'épisode qui suit le dernier vu, celui en cours s\'il n\'est pas fini, le premier sinon', async () => {
  await sansCle(async () => {
    const o = monter();
    try {
      remplir(o.mag, o.home);
      let r = await o.run({ quoi: 'Serie Essai' });
      assert.equal(r.data?.cible, 'serie:serie-essai:s1e1', 'rien vu : le premier');
      bib.noterReprise(o.mag, 'moi', 'serie:serie-essai:s1e1', 99, 100);
      bib.noterReprise(o.mag, 'moi', 'serie:serie-essai:s1e2', 98, 100); // vu en dernier, fini
      r = await o.run({ quoi: 'Serie Essai' });
      assert.equal(r.data?.cible, 'serie:serie-essai:s2e1', 'le suivant, en passant à la saison suivante');
      bib.noterReprise(o.mag, 'moi', 'serie:serie-essai:s2e1', 40, 100); // commencé, pas fini
      r = await o.run({ quoi: 'Serie Essai' });
      assert.equal(r.data?.cible, 'serie:serie-essai:s2e1', 'pas fini : on le reprend');
      assert.equal(r.data?.reprise_s, 40);
      assert.match(r.text, /à la reprise \(0:40\)/);
      bib.noterReprise(o.mag, 'moi', 'serie:serie-essai:s2e5', 100, 100);
      r = await o.run({ quoi: 'Serie Essai' });
      assert.equal(r.data?.lire, undefined, 'tout vu : aucun lien');
      assert.match(r.text, /dernier épisode/);
    } finally { rmSync(o.home, { recursive: true, force: true }); }
  });
});

test('épisode absent, titre absent, numéro sans saison : une réponse claire qui dit quoi faire, jamais un lien mort', async () => {
  await sansCle(async () => {
    const o = monter();
    try {
      remplir(o.mag, o.home);
      let r = await o.run({ quoi: 'Serie Essai S03E01' });
      assert.equal(r.data?.lire, undefined);
      assert.match(r.text, /S03E01/);
      assert.match(r.text, /saisons? .*1.*2/);
      assert.match(r.text, /Envoyer/);
      assert.match(r.text, /Scanner maintenant/);
      r = await o.run({ quoi: 'Titre Absent' });
      assert.equal(r.data?.lire, undefined);
      assert.match(r.text, /n'est pas dans ta bibliothèque/);
      assert.match(r.text, /Envoyer/);
      assert.match(r.text, /Scanner maintenant/);
      for (const i of [{ quoi: 'Serie Essai 1071' }, { quoi: 'Serie Essai', episode: 1071 }]) {
        r = await o.run(i);
        assert.equal(r.data?.lire, undefined, JSON.stringify(i));
        assert.match(r.text, /sans saison/, JSON.stringify(i));
        assert.match(r.text, /Saison/, 'dit comment le ranger');
      }
    } finally { rmSync(o.home, { recursive: true, force: true }); }
  });
});

test('album et livre audio : la première piste, ou celle de la reprise ; film : le film', async () => {
  await sansCle(async () => {
    const o = monter();
    try {
      remplir(o.mag, o.home);
      let r = await o.run({ quoi: 'Album Essai' });
      assert.equal(r.data?.cible, 'album:album-essai:p1:un');
      assert.equal(r.data?.lire, '/venus/flux/album%3Aalbum-essai%3Ap1%3Aun');
      bib.noterReprise(o.mag, 'moi', 'album:album-essai:p2:deux', 50, 100);
      r = await o.run({ quoi: 'Album Essai' });
      assert.equal(r.data?.cible, 'album:album-essai:p2:deux');
      r = await o.run({ quoi: 'Livre Essai' });
      assert.equal(r.data?.cible, 'livre_audio:livre-essai:p1:chap');
      r = await o.run({ quoi: 'essai trois' });
      assert.equal(r.data?.cible, 'film:essai-trois');
      assert.equal(r.data?.lire, '/venus/flux/film%3Aessai-trois');
      assert.match(r.text, /« Essai Trois » est dans ta bibliothèque/);
    } finally { rmSync(o.home, { recursive: true, force: true }); }
  });
});

test('écran de la maison (faux Home Assistant) : l\'adresse envoyée est celle d\'un épisode ou d\'une piste', async () => {
  const recus: Array<{ media_content_id: string; media_content_type: string }> = [];
  const ha = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/api/states') { res.end(JSON.stringify([{ entity_id: 'media_player.tele_essai', state: 'idle', attributes: { friendly_name: 'Télé essai', device_class: 'tv' } }])); return; }
      if (req.method === 'POST' && req.url === '/api/services/media_player/play_media') { recus.push(JSON.parse(b)); res.end('[]'); return; }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>((r) => ha.listen(0, '127.0.0.1', () => r()));
  const port = (ha.address() as { port: number }).port, tok = process.env.HA_TOKEN;
  process.env.HA_TOKEN = 'jeton-essai';
  try { await sansCle(async () => {
    const o = monter({ haUrl: `http://127.0.0.1:${port}`, origin: 'http://odin.essai' });
    try {
      remplir(o.mag, o.home);
      let r = await o.run({ quoi: 'Serie Essai', saison: 2, episode: 5 });
      assert.match(r.text, /lancé sur Télé essai/);
      assert.match(recus[0].media_content_id, /^http:\/\/odin\.essai\/venus\/flux\/serie%3Aserie-essai%3As2e5\?cle=/);
      r = await o.run({ quoi: 'Album Essai' });
      assert.match(recus[1].media_content_id, /\/venus\/flux\/album%3Aalbum-essai%3Ap1%3Aun\?cle=/);
      assert.equal(recus[1].media_content_type, 'music');
      assert.equal(recus.length, 2);
      // un épisode absent n'est PAS envoyé (avant : l'œuvre entière, lien mort sur la télé)
      r = await o.run({ quoi: 'Serie Essai S09E09' });
      assert.equal(recus.length, 2);
      assert.match(r.text, /S09E09/);
    } finally { rmSync(o.home, { recursive: true, force: true }); }
  }); } finally {
    if (tok === undefined) delete process.env.HA_TOKEN; else process.env.HA_TOKEN = tok;
    ha.closeAllConnections(); await new Promise<void>((r) => ha.close(() => r()));
  }
});

test('dossier « Saison N » / « Season N » : un nom qui ne porte que le numéro d\'épisode est reconnu, la série est le dossier au-dessus', () => {
  const r = join(tmpdir(), 'Series');
  assert.deepEqual(bib.episodeDeDossier(join(r, 'Serie Deux', 'Saison 2', 'E05.mp4'), r), { serie: 'Serie Deux', saison: 2, episode: 5 });
  assert.deepEqual(bib.episodeDeDossier(join(r, 'Serie Deux', 'Season 03', 'Ep 7 1080p.mkv'), r), { serie: 'Serie Deux', saison: 3, episode: 7 });
  assert.deepEqual(bib.episodeDeDossier(join(r, 'Serie Deux', 'Saison 2', '06.mkv'), r), { serie: 'Serie Deux', saison: 2, episode: 6 });
  assert.deepEqual(bib.episodeDeDossier(join(r, 'Serie Deux', 'saison_2', 'Serie Deux - 08.mkv'), r), { serie: 'Serie Deux', saison: 2, episode: 8 });
  assert.equal(bib.episodeDeDossier(join(r, 'Serie Deux', 'Saison 2', 'bande annonce.mp4'), r), undefined, 'sans numéro : non');
  assert.equal(bib.episodeDeDossier(join(r, 'Serie Deux', 'Bonus', 'E05.mp4'), r), undefined, 'pas un dossier de saison : non');
  assert.equal(bib.episodeDeDossier(join(r, 'Saison 2', 'E05.mp4'), r), undefined, 'aucun nom de série au-dessus (la racine déclarée) : non');
});

test('ce que la lecture des noms reconnaissait ne change pas', () => {
  // Valeurs relevées AVANT ce lot (analyserNom n'est pas touché).
  const avant: Array<[string, unknown]> = [
    ['Serie Essai S01E02.mp4', { titre: 'Serie Essai', saison: 1, episode: 2 }],
    ['Serie.Essai.1x02.mkv', { titre: 'Serie Essai', saison: 1, episode: 2 }],
    ['Essai Un (2001).mkv', { titre: 'Essai Un', annee: 2001 }],
    ['episode sans numero.mp4', { titre: 'episode sans numero' }],
    ['E05.mp4', { titre: 'E05' }],
  ];
  for (const [n, v] of avant) assert.deepEqual(bib.analyserNom(n), v, n);
});

test('sans titre (« S02E05 » seul) : rien n\'est choisi au hasard, ni lu, ni envoyé sur un écran — on demande le titre', async () => {
  const recus: unknown[] = [];
  const ha = createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/api/states') { res.end(JSON.stringify([{ entity_id: 'media_player.tele_essai', state: 'idle', attributes: { friendly_name: 'Télé essai', device_class: 'tv' } }])); return; }
      if (req.method === 'POST') { recus.push(b); res.end('[]'); return; }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>((r) => ha.listen(0, '127.0.0.1', () => r()));
  const port = (ha.address() as { port: number }).port, tok = process.env.HA_TOKEN;
  process.env.HA_TOKEN = 'jeton-essai';
  try { await sansCle(async () => {
    for (const reglages of [{}, { haUrl: `http://127.0.0.1:${port}`, origin: 'http://odin.essai' }]) {
      const o = monter(reglages);
      try {
        remplir(o.mag, o.home);
        o.mag.poser('oeuvres', 'film:ab', { type: 'film', titre: 'Ab', fichier: join(o.home, 'Ab.mp4'), duree: 60 }); // le titre le plus court
        for (const i of [{ quoi: 'S02E05' }, { quoi: '2x05' }, { quoi: ' (S02E05) ' }]) {
          const r = await o.run(i);
          assert.equal(r.data?.lire, undefined, JSON.stringify(i));
          assert.equal(r.data?.cible, undefined, JSON.stringify(i));
          assert.doesNotMatch(r.text, /Ab|lancé/, JSON.stringify(i));
          assert.match(r.text, /Quel titre/, JSON.stringify(i));
        }
      } finally { rmSync(o.home, { recursive: true, force: true }); }
    }
    assert.equal(recus.length, 0, 'rien n\'est parti sur la télé');
  }); } finally {
    if (tok === undefined) delete process.env.HA_TOKEN; else process.env.HA_TOKEN = tok;
    ha.closeAllConnections(); await new Promise<void>((r) => ha.close(() => r()));
  }
  // et la recherche elle-même ne rend rien pour une requête vide
  oublierMagasins();
  const home = tmp('venus-regarder-vide-');
  try { const m = magasinVenus(home, dirVenus(home)); m.poser('oeuvres', 'film:ab', { type: 'film', titre: 'Ab' }); assert.equal(bib.trouverOeuvre(m, ''), undefined); assert.equal(bib.trouverOeuvre(m, ' - '), undefined); }
  finally { rmSync(home, { recursive: true, force: true }); }
});

test('la demande se lit aussi entre parenthèses ou crochets : « Titre (S02E05) », « Titre [2x05] »', () => {
  assert.deepEqual(bib.lireDemande('Serie Essai (S02E05)'), { titre: 'Serie Essai', saison: 2, episode: 5 });
  assert.deepEqual(bib.lireDemande('Serie Essai [2x05]'), { titre: 'Serie Essai', saison: 2, episode: 5 });
  assert.deepEqual(bib.lireDemande('Essai Un (2001)'), { titre: 'Essai Un (2001)' }, 'une année entre parenthèses reste dans le titre');
});

test('dossier « Saison N » : le nom de la série est nettoyé comme un nom de fichier, et « Bonus - 01 » n\'est pas l\'épisode 1', () => {
  const r = join(tmpdir(), 'Series');
  assert.deepEqual(bib.episodeDeDossier(join(r, 'Serie Lumen (2020)', 'Saison 2', 'E05.mkv'), r), { serie: 'Serie Lumen', saison: 2, episode: 5 });
  assert.deepEqual(bib.episodeDeDossier(join(r, 'Serie.Lumen.2020.1080p', 'Saison 2', 'E05.mkv'), r), { serie: 'Serie Lumen', saison: 2, episode: 5 });
  assert.deepEqual(bib.episodeDeDossier(join(r, 'Serie.Lumen', 'Saison 2', 'E05.mkv'), r), { serie: 'Serie Lumen', saison: 2, episode: 5 }, 'un point du nom n\'est pas une extension');
  // même slug que le fichier « Saison 1/Serie.Lumen.S01E01.mkv » du même dossier : une seule série
  assert.equal(bib.slug(bib.episodeDeDossier(join(r, 'Serie Lumen (2020)', 'Saison 2', 'E05.mkv'), r)!.serie), bib.slug(bib.analyserNom('Serie.Lumen.S01E01.mkv').titre));
  assert.equal(bib.episodeDeDossier(join(r, 'Serie Lumen', 'Saison 2', 'Bonus - 01.mkv'), r), undefined, '« Bonus - 01 » n\'écrase pas le vrai épisode 1');
  assert.deepEqual(bib.episodeDeDossier(join(r, 'Serie Lumen (2020)', 'Saison 2', 'Serie Lumen - 03.mkv'), r), { serie: 'Serie Lumen', saison: 2, episode: 3 });
});

// ---------------- Avec de vrais petits fichiers (FFmpeg) ----------------
function fabriquer(fichier: string, sorte: 'mp4' | 'mp3'): void {
  const video = ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10'], son = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'];
  const args = sorte === 'mp3' ? [...son, '-c:a', 'libmp3lame'] : [...video, ...son, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'];
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, fichier], { stdio: 'ignore' }).status, 0, `ffmpeg n'a pas fabriqué ${fichier}`);
}
function fakeReq(method: string, headers: Record<string, string> = {}, body?: unknown): IncomingMessage {
  const r = Readable.from(body !== undefined ? [Buffer.from(JSON.stringify(body))] : []) as unknown as IncomingMessage;
  (r as unknown as { method: string }).method = method;
  (r as unknown as { headers: Record<string, string> }).headers = headers;
  return r;
}
class FakeRes extends Writable {
  code?: number; body = '';
  writeHead(code: number): this { this.code = code; return this; }
  _write(chunk: Buffer, _enc: string, cb: () => void): void { this.body += chunk.toString('latin1'); cb(); }
}
async function appel(home: string, method: string, chemin: string, o: { headers?: Record<string, string>; body?: unknown } = {}): Promise<{ code?: number; json: Record<string, unknown>; taille: number }> {
  const res = new FakeRes();
  await venusRoute(fakeReq(method, o.headers, o.body), res as unknown as ServerResponse, new URL(`http://x${chemin}`), { home, proprietaire: () => true, fail: () => undefined, origin: 'http://odin', ip: '127.0.0.1', profil: 'moi' });
  if (!res.writableFinished) await new Promise<void>((r) => { res.once('finish', () => r()); res.once('close', () => r()); setTimeout(r, 2000); });
  let json: Record<string, unknown> = {}; try { json = JSON.parse(res.body) as Record<string, unknown>; } catch { /* flux binaire */ }
  return { code: res.code, json, taille: res.body.length };
}

test('vrais fichiers : film, épisode (dont « Saison 2 » sans SxxExx), album, livre audio → le lien rendu répond 206', { skip: sansFfmpeg }, async () => {
  await sansCle(async () => {
    const o = monter();
    const films = tmp('vr-films-'), series = tmp('vr-series-'), musique = tmp('vr-musique-'), livres = tmp('vr-livres-');
    try {
      fabriquer(join(films, 'Essai Trois 2001.mp4'), 'mp4');
      mkdirSync(join(series, 'Serie Deux', 'Saison 2'), { recursive: true });
      fabriquer(join(series, 'Serie Deux', 'Serie Deux S01E01.mp4'), 'mp4');
      fabriquer(join(series, 'Serie Deux', 'Saison 2', 'E05.mp4'), 'mp4');
      fabriquer(join(series, 'Serie Deux', 'Saison 2', 'sans numero.mp4'), 'mp4');
      mkdirSync(join(musique, 'Album Essai')); fabriquer(join(musique, 'Album Essai', '01 Un.mp3'), 'mp3'); fabriquer(join(musique, 'Album Essai', '02 Deux.mp3'), 'mp3');
      mkdirSync(join(livres, 'Livre Essai')); fabriquer(join(livres, 'Livre Essai', '01 Chap.mp3'), 'mp3');
      for (const [c, cat] of [[films, 'films'], [series, 'series'], [musique, 'musique'], [livres, 'livres_audio']]) assert.equal((await appel(o.home, 'POST', '/venus/dossiers', { body: { chemin: c, categorie: cat } })).code, 200);
      const scan = await appel(o.home, 'POST', '/venus/scan');
      const b = scan.json.bilan as { oeuvres: number; episodes: number; raisons: Record<string, number> };
      assert.equal(b.episodes, 2, 'S01E01 et Saison 2/E05');
      assert.equal(b.raisons.episode_sans_numero, 1, 'un nom sans numéro reste de côté, même dans « Saison 2 »');
      assert.equal(b.oeuvres, 4, 'une seule série « Serie Deux » pour les deux saisons');
      for (const [i, attendu] of [
        [{ quoi: 'Essai Trois' }, /^film:/],
        [{ quoi: 'Serie Deux S02E05' }, /:s2e5$/],
        [{ quoi: 'Serie Deux', saison: 1, episode: 1 }, /:s1e1$/],
        [{ quoi: 'Album Essai' }, /:p1:/],
        [{ quoi: 'Livre Essai' }, /:p1:/],
      ] as Array<[Record<string, unknown>, RegExp]>) {
        const r = await o.run(i);
        assert.match(String(r.data?.cible), attendu, JSON.stringify(i));
        const f = await appel(o.home, 'GET', String(r.data?.lire), { headers: { range: 'bytes=0-99' } });
        assert.equal(f.code, 206, `${JSON.stringify(i)} : le flux répond (avant : 404 pour série, album, livre audio)`);
        assert.equal(f.taille, 100);
      }
    } finally { for (const d of [o.home, films, series, musique, livres]) rmSync(d, { recursive: true, force: true }); }
  });
});

// ---------------- La page ----------------
test('page : ouverte avec l\'intention de lire, elle trouve la cible et prépare le lecteur à la reprise', () => {
  const lire = (f: string) => readFileSync(new URL(`../src/web/pages/${f}`, import.meta.url), 'utf8');
  const win: Record<string, unknown> = { OdinPages: {} };
  const c = vm.createContext({ window: win, URLSearchParams });
  for (const f of ['venus-lecteur.js', 'venus.js']) vm.runInContext(lire(f), c, { filename: f });
  const L = (win.OdinVenus as { logique: Record<string, (...a: unknown[]) => unknown> }).logique;
  const j = (v: unknown) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(j(L.cibleVoulue({ module: 'freyja', lire: 'serie:serie-essai:s2e5' })), { cible: 'serie:serie-essai:s2e5', oeuvre: 'serie:serie-essai' });
  assert.deepEqual(j(L.cibleVoulue({ module: 'freyja', lire: '/venus/flux/serie%3Aserie-essai%3As2e5' })), { cible: 'serie:serie-essai:s2e5', oeuvre: 'serie:serie-essai' });
  assert.deepEqual(j(L.cibleVoulue({ module: 'freyja', lire: { cible: 'album:a:p1:un', oeuvre: 'album:a' } })), { cible: 'album:a:p1:un', oeuvre: 'album:a' });
  assert.equal(L.cibleVoulue({ module: 'freyja', onglet: 'etat' }), null);
  const serie = { oeuvre: { id: 'serie:serie-essai', type: 'serie', titre: 'Serie Essai' }, episodes: [{ id: 'serie:serie-essai:s2e5', saison: 2, episode: 5, duree: 100, reprise_s: 40, sous_titres: [] }] };
  assert.deepEqual(j(L.elementLecteur(serie, 'serie:serie-essai:s2e5')), { id: 'serie:serie-essai:s2e5', titre: 'Serie Essai · S02E05', type: 'episode', duree_s: 100, reprise_s: 40, sousTitres: [] });
  const film = { oeuvre: { id: 'film:essai-trois', type: 'film', titre: 'Essai Trois', duree: 60 }, reprise: { position_s: 31 } };
  assert.equal(j(L.elementLecteur(film, 'film:essai-trois')).reprise_s, 31);
  assert.equal(L.elementLecteur(serie, 'serie:serie-essai:s9e9'), null);
  // la page s'en sert à l'ouverture
  assert.match(lire('venus.js'), /want && want\.lire/);
});
