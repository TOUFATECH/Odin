// Vénus sur un Odin neuf, SANS base ni serveur à part : indiquer un dossier de médias, les voir apparaître, en lancer
// un — et chaque cas qui ne peut pas marcher le DIT (quoi faire, où) au lieu d'échouer en silence.
// Les médias sont FABRIQUÉS par FFmpeg (sources lavfi, deux secondes) dans un dossier temporaire ; quand FFmpeg n'est
// pas installé sur la machine d'essai, les essais qui en ont besoin sont sautés (les autres restent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { Readable, Writable } from 'node:stream';
import vm from 'node:vm';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ffprobeReel, venusRoute } from '../src/valhalla/venus/routes.ts';
import { argsTranscodage } from '../src/valhalla/venus/lecture.ts';
import { dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { analyserNom, nettoyerChemin, parcourirReel } from '../src/valhalla/venus/bibliotheque.ts';
import { venus } from '../src/valhalla/modules/venus.ts';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const AVEC_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const sansFfmpeg = AVEC_FFMPEG ? false : 'FFmpeg absent de cette machine d\'essai';

/** Fabrique un petit média (deux secondes, quelques Ko) avec FFmpeg et ses sources synthétiques. */
function fabriquer(fichier: string, sorte: 'mp4' | 'avi' | 'mp3'): void {
  const video = ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10'], son = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'];
  const args = sorte === 'mp3' ? [...son, '-c:a', 'libmp3lame']
    : sorte === 'avi' ? [...video, ...son, '-c:v', 'mpeg4', '-c:a', 'libmp3lame', '-shortest']
      : [...video, ...son, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'];
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, fichier], { stdio: 'ignore' });
  assert.equal(r.status, 0, `ffmpeg n'a pas fabriqué ${sorte}`);
}

function fakeReq(method: string, body?: unknown): IncomingMessage {
  const r = Readable.from(body !== undefined ? [Buffer.from(JSON.stringify(body))] : []) as unknown as IncomingMessage;
  (r as unknown as { method: string }).method = method;
  (r as unknown as { headers: Record<string, string> }).headers = {};
  return r;
}
class FakeRes extends Writable {
  code?: number;
  body = '';
  writeHead(code: number): this { this.code = code; return this; }
  _write(chunk: Buffer, _enc: string, cb: () => void): void { this.body += chunk.toString(); cb(); }
}
async function appel(home: string, method: string, chemin: string, body?: unknown): Promise<{ code?: number; json: Record<string, unknown> }> {
  const res = new FakeRes();
  const ctx = { home, proprietaire: () => true, fail: () => undefined, origin: 'http://odin', ip: '127.0.0.1', profil: 'moi' };
  await venusRoute(fakeReq(method, body), res as unknown as ServerResponse, new URL(`http://x${chemin}`), ctx);
  if (!res.writableFinished) await new Promise<void>((r) => { res.once('finish', () => r()); res.once('close', () => r()); setTimeout(r, 300); });
  let json: Record<string, unknown> = {};
  try { json = res.body ? JSON.parse(res.body) as Record<string, unknown> : {}; } catch { /* flux binaire */ }
  return { code: res.code, json };
}
/** Fait comme si FFmpeg n'était pas installé : un PATH vide le temps de `f`. */
async function sansPath<T>(f: () => Promise<T>): Promise<T> {
  const avant = { PATH: process.env.PATH, Path: process.env.Path }, vide = tmp('venus-path-vide-');
  process.env.PATH = vide; if (process.env.Path !== undefined) process.env.Path = vide;
  try { return await f(); } finally { process.env.PATH = avant.PATH; if (avant.Path !== undefined) process.env.Path = avant.Path; rmSync(vide, { recursive: true, force: true }); }
}

test('un chemin collé entre guillemets (Explorateur de Windows) est nettoyé', () => {
  assert.equal(nettoyerChemin('"D:\\Films"'), 'D:\\Films');
  assert.equal(nettoyerChemin("  '/mnt/films'  "), '/mnt/films');
  assert.equal(nettoyerChemin('/mnt/films'), '/mnt/films');
});

test('déclarer un dossier : guillemets retirés, dossier inexistant refusé AVEC la raison, exemple de chemin donné', async () => {
  const home = tmp('venus-rep-'), medias = tmp('venus-rep-medias-');
  try {
    oublierMagasins();
    let r = await appel(home, 'POST', '/venus/dossiers', { chemin: `"${medias}"`, categorie: 'films' });
    assert.equal(r.code, 200);
    assert.ok((r.json.dossiers as Array<{ chemin: string }>).some((d) => d.chemin === medias), 'rangé sans les guillemets');
    r = await appel(home, 'POST', '/venus/dossiers', { chemin: join(medias, 'nexiste-pas'), categorie: 'films' });
    assert.equal(r.code, 400, 'un dossier qui n\'existe pas est refusé tout de suite');
    assert.match(String(r.json.error), /n'existe pas/);
    r = await appel(home, 'GET', '/venus/dossiers');
    assert.equal(typeof r.json.exemple, 'string');
    assert.equal(r.json.exemple, process.platform === 'win32' ? 'D:\\Films' : '/mnt/films');
    assert.equal(typeof (r.json.outils as { ffprobe: boolean }).ffprobe, 'boolean');
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(medias, { recursive: true, force: true }); }
});

test('le parcours dit pourquoi un fichier est laissé de côté, et quel dossier a disparu', { skip: sansFfmpeg }, async () => {
  const home = tmp('venus-rep-'), films = tmp('venus-rep-films-'), series = tmp('venus-rep-series-'), parti = tmp('venus-rep-parti-');
  try {
    oublierMagasins();
    fabriquer(join(films, 'Essai Un 2001.mp4'), 'mp4');
    fabriquer(join(films, 'un son.mp3'), 'mp3'); // un son dans « Films »
    writeFileSync(join(films, 'notes.txt'), 'pas un média');
    fabriquer(join(series, 'Serie Essai S01E02.mp4'), 'mp4');
    fabriquer(join(series, 'episode sans numero.mp4'), 'mp4');
    for (const [c, cat] of [[films, 'films'], [series, 'series'], [parti, 'musique']]) assert.equal((await appel(home, 'POST', '/venus/dossiers', { chemin: c, categorie: cat })).code, 200);
    rmSync(parti, { recursive: true, force: true }); // le disque est débranché après la déclaration
    const r = await appel(home, 'POST', '/venus/scan');
    assert.equal(r.code, 200);
    const b = r.json.bilan as { oeuvres: number; episodes: number; raisons: Record<string, number>; exemples: Array<{ fichier: string; raison: string }>; dossiersIntrouvables: string[] };
    assert.equal(b.oeuvres, 2, 'un film et une série');
    assert.equal(b.episodes, 1);
    assert.equal(b.raisons.hors_categorie, 1);
    assert.equal(b.raisons.pas_un_media, 1);
    assert.equal(b.raisons.episode_sans_numero, 1);
    assert.deepEqual(b.dossiersIntrouvables, [parti]);
    assert.ok(b.exemples.some((x) => x.fichier === 'episode sans numero.mp4' && x.raison === 'episode_sans_numero'), 'le nom du fichier est donné avec sa raison');
    assert.equal(r.json.alerte, undefined, 'FFmpeg est là : pas d\'alerte');
    // La bibliothèque montre le film, et son flux part tel quel (MP4 / H.264).
    const bib = await appel(home, 'GET', '/venus/bibliotheque?type=film');
    const film = (bib.json.oeuvres as Array<{ id: string; titre: string }>)[0];
    assert.equal(film.titre, 'Essai Un');
    const plan = await appel(home, 'GET', `/venus/plan/${encodeURIComponent(film.id)}`);
    assert.deepEqual([plan.json.pret, plan.json.mode], [true, 'direct']);
  } finally { for (const d of [home, films, series, parti]) rmSync(d, { recursive: true, force: true }); }
});

test('FFmpeg introuvable pour Odin : le parcours et le lecteur le DISENT (avant : « 0 œuvre » muet)', { skip: sansFfmpeg }, async () => {
  const home = tmp('venus-rep-'), films = tmp('venus-rep-films-');
  try {
    oublierMagasins();
    fabriquer(join(films, 'Essai Deux.avi'), 'avi');
    assert.equal((await appel(home, 'POST', '/venus/dossiers', { chemin: films, categorie: 'films' })).code, 200);
    const muet = await sansPath(() => appel(home, 'POST', '/venus/scan'));
    assert.match(String(muet.json.alerte), /FFmpeg est introuvable/);
    assert.match(String(muet.json.alerte), /redémarre Odin/);
    assert.equal((muet.json.bilan as { raisons: Record<string, number> }).raisons.illisible, 1);
    const liste = await sansPath(() => appel(home, 'GET', '/venus/dossiers'));
    assert.deepEqual(liste.json.outils, { ffprobe: false, ffmpeg: false });
    // FFmpeg revenu : le film entre ; un AVI se convertit, donc sans ffmpeg le plan dit pourquoi il ne se lira pas.
    const ok = await appel(home, 'POST', '/venus/scan');
    assert.equal((ok.json.bilan as { oeuvres: number }).oeuvres, 1);
    const id = (await appel(home, 'GET', '/venus/bibliotheque')).json.oeuvres as Array<{ id: string }>;
    const plan = await sansPath(() => appel(home, 'GET', `/venus/plan/${encodeURIComponent(id[0].id)}`));
    assert.equal(plan.json.pret, false);
    assert.equal(plan.json.mode, 'mp4');
    assert.match(String(plan.json.error), /FFmpeg est introuvable/);
    const flux = await sansPath(() => appel(home, 'GET', `/venus/flux/${encodeURIComponent(id[0].id)}`));
    assert.equal(flux.code, 503, 'le flux à convertir répond une erreur claire, pas un tuyau vide');
    assert.equal((await appel(home, 'GET', `/venus/plan/${encodeURIComponent(id[0].id)}`)).json.pret, true);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(films, { recursive: true, force: true }); }
});

test('un MKV déjà en H.264 est recopié en MP4 (pas réencodé), et le flux produit est bien un MP4', { skip: sansFfmpeg }, async () => {
  const d = tmp('venus-rep-mkv-'), mkv = join(d, 'Essai Quatre.mkv'), mp4 = join(d, 'source.mp4');
  try {
    fabriquer(mp4, 'mp4');
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-c', 'copy', mkv], { stdio: 'ignore' }).status, 0);
    const probe = await ffprobeReel(mkv);
    assert.ok(probe && /^h264/.test(probe.codecs[0]));
    const args = argsTranscodage(mkv, 'mp4', 0, probe!);
    assert.equal(args[args.indexOf('-c:v') + 1], 'copy', 'la vidéo est recopiée');
    assert.equal(args[args.indexOf('-c:a') + 1], 'copy', 'l\'audio AAC est recopié');
    assert.ok(!args.includes('libx264'));
    const r = spawnSync('ffmpeg', args, { maxBuffer: 50e6 });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.subarray(4, 8).toString('latin1'), 'ftyp', 'un vrai MP4 sort du tuyau');
    // Une vidéo qui n'est pas en H.264 (MPEG-4 d'un AVI) reste réencodée, comme avant.
    assert.ok(argsTranscodage('/f.avi', 'mp4', 0, { duree: 2, codecs: ['mpeg4'], audio: ['mp3'], sousTitres: [] }).includes('libx264'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('module Vénus sans serveur à part : la barre du haut ne garde que ce qui marche dans Odin, et le sous-titre parle de la bibliothèque', async () => {
  const cle = process.env.VENUS_API_KEY; delete process.env.VENUS_API_KEY;
  const home = tmp('venus-rep-');
  try {
    oublierMagasins();
    const m = venus(() => '');
    const rapides = m.actions.filter((a) => a.quick !== false && !(a.params ?? []).some((p) => p.required)).map((a) => a.id);
    for (const id of ['sante', 'programme', 'medias', 'bygul', 'nouveautes', 'adresse']) assert.ok(!rapides.includes(id), `${id} quitte la barre du haut`);
    for (const id of ['etat', 'ma_liste', 'mes_livres']) assert.ok(rapides.includes(id), `${id} reste`);
    assert.ok(m.actions.some((a) => a.id === 'sante'), 'l\'action existe toujours (Autres actions)');
    const vue = await m.view({ home, dir: dirVenus(home), settings: {}, saveSettings() {}, alert() {}, emit() {}, now: () => new Date() } as never, new URLSearchParams());
    assert.match(String(vue.subtitle), /Bibliothèque dans Odin : 0 titre/);
    // Relié : tout revient dans la barre.
    process.env.VENUS_API_KEY = 'cle-essai';
    const relie = venus(() => 'http://127.0.0.1:9');
    assert.ok(relie.actions.some((a) => a.id === 'sante' && a.quick !== false));
  } finally { if (cle === undefined) delete process.env.VENUS_API_KEY; else process.env.VENUS_API_KEY = cle; rmSync(home, { recursive: true, force: true }); }
});

test('« Regarder » sans serveur à part ni Home Assistant : dit où le titre se lit (Odéon, navigateur), jamais « pas relié »', async () => {
  const cle = process.env.VENUS_API_KEY; delete process.env.VENUS_API_KEY;
  const home = tmp('venus-rep-');
  try {
    oublierMagasins();
    const dir = dirVenus(home), ctx = { home, dir, settings: {}, saveSettings() {}, alert() {}, emit() {}, now: () => new Date() } as never;
    magasinVenus(home, dir).poser('oeuvres', 'film:essai-trois', { type: 'film', titre: 'Essai Trois', fichier: join(home, 'x.mp4') });
    const regarder = venus(() => '').actions.find((a) => a.id === 'regarder')!;
    const ici = await regarder.run(ctx, { quoi: 'essai trois', ou: '' });
    assert.match(ici.text, /« Essai Trois » est dans ta bibliothèque/);
    assert.match(ici.text, /navigateur/);
    assert.match(ici.text, /Home Assistant/);
    assert.doesNotMatch(ici.text, /pas relié/);
    assert.equal((ici.data as { lire: string }).lire, '/venus/flux/film%3Aessai-trois');
    const absent = await regarder.run(ctx, { quoi: 'titre absent', ou: '' });
    assert.match(absent.text, /n'est pas dans ta bibliothèque/);
    assert.match(absent.text, /Scanner maintenant/);
  } finally { if (cle === undefined) delete process.env.VENUS_API_KEY; else process.env.VENUS_API_KEY = cle; rmSync(home, { recursive: true, force: true }); }
});

test('page : le panneau des dossiers affiche les erreurs, le bilan et FFmpeg manquant ; le lecteur demande pourquoi', () => {
  const lire = (f: string) => readFileSync(new URL(`../src/web/pages/${f}`, import.meta.url), 'utf8');
  const win: Record<string, unknown> = { OdinPages: {} };
  const c = vm.createContext({ window: win, URLSearchParams });
  for (const f of ['venus-lecteur.js', 'venus.js']) vm.runInContext(lire(f), c, { filename: f });
  const L = (win.OdinVenus as { logique: Record<string, (...a: unknown[]) => unknown> }).logique;
  const lignes = L.bilanLignes({ alerte: 'FFmpeg est introuvable', bilan: { oeuvres: 1, raisons: { illisible: 2, dossier_introuvable: 1 }, exemples: [{ fichier: 'a.mkv', raison: 'illisible' }], dossiersIntrouvables: ['E:\\Films'] } }) as string[];
  assert.equal(lignes[0], 'FFmpeg est introuvable');
  assert.ok(lignes.some((l) => l.includes('Dossier introuvable : E:\\Films')));
  assert.ok(lignes.some((l) => l.includes('2 illisible par ffprobe')));
  assert.ok(lignes.some((l) => l.includes('a.mkv')));
  assert.equal(JSON.stringify(L.bilanLignes({ error: 'refusé' })), JSON.stringify(['refusé']));
  assert.equal(L.outilsManquants({ ffprobe: true, ffmpeg: true }), '');
  assert.match(String(L.outilsManquants({ ffprobe: false, ffmpeg: true })), /ffprobe manquant/);
  const src = lire('venus.js');
  assert.doesNotMatch(src, /ex\. \/mnt\/films/, 'plus d\'exemple Linux en dur');
  assert.match(src, /if \(r && r\.error\) \{ dire\(r\.error\)/, 'l\'erreur d\'ajout est affichée');
  const lect = (win.OdinVenusLecteur as { logique: Record<string, (...a: unknown[]) => unknown> }).logique;
  assert.equal(lect.planUrl('film:x'), '/venus/plan/film%3Ax');
  assert.match(lire('venus-lecteur.js'), /logique\.planUrl\(cible\.id\)/);
});

// ---------------- Après relecture ----------------
test('un titre suivi de son année entre parenthèses ou crochets ne garde pas « ( » à la fin', () => {
  assert.deepEqual(analyserNom('Essai Un (2001).mkv'), { titre: 'Essai Un', annee: 2001 });
  assert.deepEqual(analyserNom('Essai Un [2001] 1080p.mp4'), { titre: 'Essai Un', annee: 2001 });
  assert.equal(analyserNom('Essai Un 2001.mp4').titre, 'Essai Un');
});

test('« Chercher » et « Ma liste » avec une adresse mais sans clé restent dans Odin (comme la barre du haut)', async () => {
  const cle = process.env.VENUS_API_KEY; delete process.env.VENUS_API_KEY;
  const home = tmp('venus-rep-');
  try {
    oublierMagasins();
    const dir = dirVenus(home), ctx = { home, dir, settings: {}, saveSettings() {}, alert() {}, emit() {}, now: () => new Date() } as never;
    magasinVenus(home, dir).poser('oeuvres', 'film:essai-cinq', { type: 'film', titre: 'Essai Cinq', fichier: join(home, 'x.mp4') });
    const m = venus(() => 'http://127.0.0.1:9'); // une adresse (port fermé), pas de clé : pas relié
    const chercher = await m.actions.find((a) => a.id === 'chercher')!.run(ctx, { quoi: 'cinq' });
    assert.equal(chercher.text, '- Essai Cinq · film');
    const rien = await m.actions.find((a) => a.id === 'chercher')!.run(ctx, { quoi: 'absent' });
    assert.match(rien.text, /Rien dans la bibliothèque de Vénus/);
    const liste = await m.actions.find((a) => a.id === 'ma_liste')!.run(ctx, {});
    assert.equal(liste.text, 'Liste vide.');
  } finally { if (cle === undefined) delete process.env.VENUS_API_KEY; else process.env.VENUS_API_KEY = cle; rmSync(home, { recursive: true, force: true }); }
});

test('déclarer un dossier : chemin complet exigé, et « dossier\ » et « dossier » ne font qu\'une entrée', async () => {
  const home = tmp('venus-rep-'), medias = tmp('venus-rep-medias-');
  try {
    oublierMagasins();
    for (const relatif of ['.', 'Films']) {
      const r = await appel(home, 'POST', '/venus/dossiers', { chemin: relatif, categorie: 'films' });
      assert.equal(r.code, 400, `« ${relatif} » est refusé`);
      assert.match(String(r.json.error), /chemin complet/);
    }
    assert.equal((await appel(home, 'POST', '/venus/dossiers', { chemin: medias + sep, categorie: 'films' })).code, 200);
    const r = await appel(home, 'POST', '/venus/dossiers', { chemin: medias, categorie: 'films' });
    assert.deepEqual((r.json.dossiers as Array<{ chemin: string }>).map((d) => d.chemin), [medias]);
    const retire = await appel(home, 'POST', '/venus/dossiers', { chemin: medias + sep, faire: 'retirer' });
    assert.deepEqual(retire.json.dossiers, []);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(medias, { recursive: true, force: true }); }
});

test('un lien vers un dossier parent ne fait pas tourner le parcours : chaque fichier n\'est vu qu\'une fois', () => {
  const d = tmp('venus-rep-boucle-');
  try {
    mkdirSync(join(d, 'sous'));
    writeFileSync(join(d, 'sous', 'film.mp4'), 'x');
    symlinkSync(d, join(d, 'sous', 'retour'), process.platform === 'win32' ? 'junction' : 'dir');
    const vus = parcourirReel(d).map((f) => basename(f.chemin));
    assert.deepEqual(vus, ['film.mp4']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
