// Vénus · envoyer des films, des séries ou de la musique depuis le téléphone ou le PC vers la bibliothèque : envoi en
// morceaux avec reprise après une coupure, fichier analysé (taille, antivirus, vraie nature) avant d'être rangé dans
// un dossier DÉCLARÉ, sans jamais écraser. Les refus disent pourquoi. Propriétaire seul.
// Médias FABRIQUÉS par FFmpeg (deux secondes) dans des dossiers temporaires ; sans FFmpeg, ces essais-là sont sautés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import vm from 'node:vm';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, bibliotheque, fichierDeCible, scanner } from '../src/valhalla/venus/bibliotheque.ts';
import { deplacerSansEcraser, dossierMorceauxVenus, importerEnvoi, nomPropre, preparerEnvoi, purgerEnvois, DUREE_ABANDON_MS } from '../src/valhalla/venus/envoi.ts';
import { brancherGarde } from '../src/valhalla/ullr/garde.ts';
import { ffprobeReel, venusRoute } from '../src/valhalla/venus/routes.ts';
import { recevoirMorceau } from '../src/web/morceaux.ts';
import { venus } from '../src/valhalla/modules/venus.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { T } from './banc/lib.ts';
import { vraiOdin } from './banc/odin-vrai.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
const AVEC_FFMPEG = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const sansFfmpeg = AVEC_FFMPEG ? false : 'FFmpeg absent de cette machine d\'essai';
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
/** Un faux « film » : l'en-tête d'un programme Windows (MZ … PE). */
const PROGRAMME = (() => { const b = Buffer.alloc(4096); b.write('MZ', 0, 'latin1'); b.writeUInt32LE(0x80, 0x3c); b.write('PE\0\0', 0x80, 'latin1'); return b; })();

function fabriquer(fichier: string, sorte: 'mp4' | 'mp3'): Buffer {
  const video = ['-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10'], son = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2'];
  const args = sorte === 'mp3' ? [...son, '-c:a', 'libmp3lame'] : [...video, ...son, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'];
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args, fichier], { stdio: 'ignore' });
  assert.equal(r.status, 0, `ffmpeg n'a pas fabriqué ${sorte}`);
  return readFileSync(fichier);
}
/** Un monde : un Odin (dossier de données) et un dossier média déclaré. */
function monde(categorie: 'films' | 'series' | 'musique' = 'films') {
  oublierMagasins();
  const home = tmp('venus-envoi-'), medias = tmp('venus-envoi-medias-'), dir = dirVenus(home), depot = join(dir, 'depots');
  const mag = magasinVenus(home, dir);
  ajouterDossier(mag, medias, categorie);
  return { home, medias, mag, depot, fin: () => { rmSync(home, { recursive: true, force: true }); rmSync(medias, { recursive: true, force: true }); } };
}
const part = (depot: string, id: string) => join(dossierMorceauxVenus(depot), `${id}.part`);
const pasDeFfprobe = async (): Promise<null> => { throw new Error('ffprobe ne doit pas être appelé'); };
/** Un morceau tel que la route le reçoit (requête en flux). */
const requete = (b: Buffer) => Readable.from([b]) as unknown as IncomingMessage;

test('nom piégé neutralisé : aucun « ..\\ » ni « / », caractères interdits retirés, noms réservés évités, toutes les langues gardées', () => {
  assert.equal(nomPropre('..\\..\\x.mp4'), 'x.mp4');
  assert.equal(nomPropre('../../etc/film.mkv'), 'film.mkv');
  assert.equal(nomPropre('a<b>:c|d?.mp4'), 'a_b__c_d_.mp4');
  assert.equal(nomPropre('CON.mp4'), 'CON_.mp4');
  assert.equal(nomPropre('  .cache.mp4  '), 'cache.mp4');
  assert.equal(nomPropre('東京物語 (1953).mkv'), '東京物語 (1953).mkv');
  assert.equal(nomPropre('مسلسل S01E02.mp4'), 'مسلسل S01E02.mp4');
  assert.equal(nomPropre('...'), '');
});

test('préparer : aucun dossier déclaré → « déclare d\'abord un dossier » ; dossier non déclaré, mauvaise catégorie, pas une vidéo → refusés', () => {
  oublierMagasins();
  const home = tmp('venus-envoi-vide-'), dir = dirVenus(home), mag = magasinVenus(home, dir);
  try {
    assert.throws(() => preparerEnvoi(mag, join(dir, 'depots'), { nom: 'Film.mp4', taille: 10, dossier: '' }), /Aucun dossier média déclaré : déclare d'abord un dossier/);
  } finally { rmSync(home, { recursive: true, force: true }); }
  const w = monde('films');
  try {
    assert.throws(() => preparerEnvoi(w.mag, w.depot, { nom: 'Film.mp4', taille: 10, dossier: join(w.medias, 'ailleurs') }), /pas un de tes dossiers média déclarés/);
    assert.throws(() => preparerEnvoi(w.mag, w.depot, { nom: 'Film.mp4', taille: 10, categorie: 'musique', dossier: w.medias }), /rangé en « films », pas en « musique »/);
    assert.throws(() => preparerEnvoi(w.mag, w.depot, { nom: 'notes.txt', taille: 10, dossier: w.medias }), /n'est pas une vidéo d'après son nom/);
    assert.throws(() => preparerEnvoi(w.mag, w.depot, { nom: 'chanson.mp3', taille: 10, dossier: w.medias }), /n'est pas une vidéo/);
    assert.throws(() => preparerEnvoi(w.mag, w.depot, { nom: 'Film.mp4', taille: 0, dossier: w.medias }), /taille invalide/);
  } finally { w.fin(); }
});

test('série mal nommée : refusée dès la préparation, avant le premier octet, avec la raison', () => {
  const w = monde('series');
  try {
    assert.throws(() => preparerEnvoi(w.mag, w.depot, { nom: 'Ma série épisode deux.mkv', taille: 1000, dossier: w.medias }), /épisode sans numéro.*S01E02.*Titre S01E02\.mkv/);
    assert.ok(!existsSync(dossierMorceauxVenus(w.depot)) || readdirSync(dossierMorceauxVenus(w.depot)).length === 0, 'rien n\'est entamé');
    const p = preparerEnvoi(w.mag, w.depot, { nom: 'Ma série S01E02.mkv', taille: 1000, dossier: w.medias });
    assert.equal(p.categorie, 'series'); assert.equal(p.recu, 0);
  } finally { w.fin(); }
});

test('place : refus s\'il resterait moins de 10 % du disque ; plafond des envois en cours ; reprise au bon octet', () => {
  const w = monde('films');
  try {
    const memeDisque = () => true;
    // Disque de 10 000 octets, 1 000 libres : 10 % gardés → plus rien pour l'envoi.
    assert.throws(() => preparerEnvoi(w.mag, w.depot, { nom: 'Gros.mp4', taille: 500, dossier: w.medias }, { place: () => ({ libre: 1000, total: 10_000 }), memeDisque }), /Place insuffisante sur le disque d'Odin.*10 % du disque libres/);
    // 3 000 libres → 2 000 disponibles : un envoi de 1 500 passe, un second de 1 000 dépasse le plafond.
    const place = () => ({ libre: 3000, total: 10_000 });
    const a = preparerEnvoi(w.mag, w.depot, { nom: 'Premier.mp4', taille: 1500, dossier: w.medias }, { place, memeDisque });
    assert.equal(a.recu, 0); assert.equal(a.place?.garde, 1000);
    assert.throws(() => preparerEnvoi(w.mag, w.depot, { nom: 'Second.mp4', taille: 1000, dossier: w.medias }, { place, memeDisque }), /Plafond des envois en cours atteint : 1 autre\(s\) envoi\(s\)/);
    // Le premier avance (1 000 reçus) : il n'attend plus que 500, le second (1 000) tient.
    writeFileSync(part(w.depot, a.envoi), Buffer.alloc(1000));
    assert.equal(preparerEnvoi(w.mag, w.depot, { nom: 'Premier.mp4', taille: 1500, dossier: w.medias }, { place, memeDisque }).recu, 1000, 'reprise : on sait où en est l\'envoi');
    assert.equal(preparerEnvoi(w.mag, w.depot, { nom: 'Second.mp4', taille: 1000, dossier: w.medias }, { place, memeDisque }).recu, 0);
    // Dossier d'arrivée sur un autre disque trop plein : refusé aussi (le fichier y serait copié).
    assert.throws(() => preparerEnvoi(w.mag, w.depot, { nom: 'Troisième.mp4', taille: 100, dossier: w.medias }, { place: (c) => (c === w.medias ? { libre: 1000, total: 10_000 } : { libre: 9000, total: 10_000 }), memeDisque: () => false }), /Place insuffisante dans le dossier d'arrivée/);
  } finally { w.fin(); }
});

test('envoi abandonné depuis 2 jours : effacé (et sa fiche) ; un envoi récent est gardé', () => {
  const w = monde('films');
  try {
    const vieux = preparerEnvoi(w.mag, w.depot, { nom: 'Vieux.mp4', taille: 100, dossier: w.medias });
    const recent = preparerEnvoi(w.mag, w.depot, { nom: 'Récent.mp4', taille: 100, dossier: w.medias });
    writeFileSync(part(w.depot, vieux.envoi), Buffer.alloc(40)); writeFileSync(part(w.depot, recent.envoi), Buffer.alloc(40));
    const avant = (Date.now() - DUREE_ABANDON_MS - 60_000) / 1000;
    for (const f of readdirSync(dossierMorceauxVenus(w.depot)).filter((n) => n.startsWith(vieux.envoi))) utimesSync(join(dossierMorceauxVenus(w.depot), f), avant, avant);
    const r = purgerEnvois(w.depot);
    assert.equal(r.fichiers, 2, 'le .part et la fiche'); assert.equal(r.octets > 40, true);
    assert.ok(!existsSync(part(w.depot, vieux.envoi)));
    assert.ok(existsSync(part(w.depot, recent.envoi)), 'l\'envoi récent reste');
  } finally { w.fin(); }
});

test('import : taille différente refusée ; envoi incomplet gardé pour la reprise ; envoi inconnu refusé', async () => {
  const w = monde('films');
  try {
    assert.match((await importerEnvoi(w.mag, w.depot, 'f'.repeat(24))).texte, /envoi inconnu/);
    assert.match((await importerEnvoi(w.mag, w.depot, '../../x')).texte, /envoi inconnu/);
    const p = preparerEnvoi(w.mag, w.depot, { nom: 'Film.mp4', taille: 100, dossier: w.medias });
    writeFileSync(part(w.depot, p.envoi), Buffer.alloc(50));
    const inc = await importerEnvoi(w.mag, w.depot, p.envoi, { ffprobe: pasDeFfprobe });
    assert.equal(inc.ok, false); assert.match(inc.texte, /envoi incomplet : .* reçus sur .*reprend/); assert.ok(existsSync(part(w.depot, p.envoi)), 'gardé pour la reprise');
    writeFileSync(part(w.depot, p.envoi), Buffer.alloc(120));
    const trop = await importerEnvoi(w.mag, w.depot, p.envoi, { ffprobe: pasDeFfprobe });
    assert.equal(trop.ok, false); assert.match(trop.texte, /la taille reçue \(120 octets\) n'est pas la taille annoncée \(100 octets\)/);
    assert.ok(!existsSync(part(w.depot, p.envoi)), 'le fichier reçu est effacé');
    assert.equal(bibliotheque(w.mag).length, 0);
  } finally { w.fin(); }
});

test('illisible par ffprobe (FFmpeg absent) : refusé pour l\'instant, le fichier reçu est GARDÉ et un nouvel envoi ne repart pas de zéro', async () => {
  const w = monde('films');
  try {
    // Les octets d'une vraie tête MP4 (ftyp isom) : la nature est « vidéo », l'antivirus ne trouve rien.
    const mp4 = Buffer.alloc(2048); mp4.writeUInt32BE(24, 0); mp4.write('ftypisom', 4, 'latin1'); mp4.write('isomiso2avc1mp41', 8 + 8, 'latin1');
    const p = preparerEnvoi(w.mag, w.depot, { nom: 'Plus Tard (2022).mp4', taille: mp4.length, dossier: w.medias });
    writeFileSync(part(w.depot, p.envoi), mp4);
    const r = await importerEnvoi(w.mag, w.depot, p.envoi, { ffprobe: async () => null });
    assert.equal(r.ok, false); assert.equal(!r.ok && r.garde, true); assert.match(r.texte, /illisible par ffprobe.*installe-le puis renvoie le même fichier/);
    assert.ok(existsSync(part(w.depot, p.envoi)), 'gardé à sa place');
    assert.equal(preparerEnvoi(w.mag, w.depot, { nom: 'Plus Tard (2022).mp4', taille: mp4.length, dossier: w.medias }).recu, mp4.length, 'rien à renvoyer');
    assert.deepEqual(readdirSync(w.medias), []);
  } finally { w.fin(); }
});

test('faux « film.mp4 » qui est un programme : refusé (l\'antivirus le voit d\'abord) ; un non-média sans danger refusé par sa vraie nature, effacé ; rien dans la bibliothèque ni dans le dossier', async () => {
  const w = monde('films');
  try {
    const p = preparerEnvoi(w.mag, w.depot, { nom: 'film.mp4', taille: PROGRAMME.length, dossier: w.medias });
    writeFileSync(part(w.depot, p.envoi), PROGRAMME);
    const r = await importerEnvoi(w.mag, w.depot, p.envoi, { ffprobe: pasDeFfprobe });
    // L'antivirus le voit d'abord (programme déguisé) : refusé et mis à l'écart, sans que FFmpeg le lise.
    assert.equal(r.ok, false); assert.match(r.texte, /Refusé : .*(Programme|ni une vidéo ni un son)/);
    assert.ok(!existsSync(part(w.depot, p.envoi)));
    // Un fichier sans danger mais qui n'est pas un média (un PDF nommé « .mkv ») : refusé par sa vraie nature, effacé.
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
    const q = preparerEnvoi(w.mag, w.depot, { nom: 'film.mkv', taille: pdf.length, dossier: w.medias });
    writeFileSync(part(w.depot, q.envoi), pdf);
    const r2 = await importerEnvoi(w.mag, w.depot, q.envoi, { ffprobe: pasDeFfprobe });
    assert.equal(r2.ok, false); assert.match(r2.texte, /n'est ni une vidéo ni un son — d'après son contenu, c'est : Document PDF/);
    assert.ok(!existsSync(part(w.depot, q.envoi)));
    assert.deepEqual(readdirSync(w.medias), []); assert.equal(bibliotheque(w.mag).length, 0);
  } finally { w.fin(); }
});

test('fichier d\'essai des antivirus (EICAR) nommé « film.mp4 » : bloqué avant toute lecture par FFmpeg, mis à l\'écart, rien dans la bibliothèque', async () => {
  const w = monde('films');
  try {
    const p = preparerEnvoi(w.mag, w.depot, { nom: 'film.mp4', taille: EICAR.length, dossier: w.medias });
    writeFileSync(part(w.depot, p.envoi), EICAR);
    const r = await importerEnvoi(w.mag, w.depot, p.envoi, { ffprobe: pasDeFfprobe });
    assert.equal(r.ok, false); assert.equal(!r.ok && r.bloque, true); assert.match(r.texte, /bloqué.*mis à l'écart/);
    assert.ok(!existsSync(part(w.depot, p.envoi)), 'il a quitté sa place');
    assert.deepEqual(readdirSync(w.medias), []); assert.equal(bibliotheque(w.mag).length, 0);
  } finally { w.fin(); }
});

test('envoi complet : 3 morceaux, une coupure, un mauvais octet, reprise au bon octet ; analysé, rangé sans écraser, lisible par /venus/flux', { skip: sansFfmpeg }, async () => {
  const w = monde('films'), src = tmp('venus-envoi-src-');
  try {
    const film = fabriquer(join(src, 'f.mp4'), 'mp4'), nom = 'Le Voyage (2001).mp4';
    // Un fichier du même nom est déjà là : il ne sera pas écrasé.
    writeFileSync(join(w.medias, nom), 'déjà là');
    const p = preparerEnvoi(w.mag, w.depot, { nom, taille: film.length, dossier: w.medias });
    const t = Math.ceil(film.length / 3);
    let m = await recevoirMorceau(requete(film.subarray(0, t)), w.depot, p.envoi, 0);
    assert.deepEqual(m, { ok: true, recu: t });
    // Un morceau envoyé au mauvais octet : rien n'est écrit, la réponse dit où reprendre.
    m = await recevoirMorceau(requete(film.subarray(0, t)), w.depot, p.envoi, 0);
    assert.equal(m.ok, false); assert.match(String(m.error), new RegExp(`reprise : ${t} octet`));
    // Coupure au milieu du deuxième morceau : seule une partie arrive.
    const moitie = t + Math.floor(t / 2);
    await recevoirMorceau(requete(film.subarray(t, moitie)), w.depot, p.envoi, t);
    const repris = preparerEnvoi(w.mag, w.depot, { nom, taille: film.length, dossier: w.medias });
    assert.equal(repris.envoi, p.envoi, 'même fichier, même envoi'); assert.equal(repris.recu, moitie, 'reprise au bon octet');
    await recevoirMorceau(requete(film.subarray(moitie, 2 * t)), w.depot, p.envoi, moitie);
    m = await recevoirMorceau(requete(film.subarray(2 * t)), w.depot, p.envoi, 2 * t);
    assert.deepEqual(m, { ok: true, recu: film.length });
    const r = await importerEnvoi(w.mag, w.depot, p.envoi, { ffprobe: ffprobeReel });
    assert.equal(r.ok, true, r.texte);
    assert.match(r.texte, /« Le Voyage » analysé et rangé \(Le Voyage \(2001\) \(2\)\.mp4\)/);
    assert.equal(readFileSync(join(w.medias, nom), 'utf8'), 'déjà là', 'aucun écrasement');
    assert.deepEqual(readFileSync(join(w.medias, 'Le Voyage (2001) (2).mp4')), film, 'le fichier reçu est intact');
    assert.ok(!existsSync(part(w.depot, p.envoi)), 'plus rien en attente');
    const carte = bibliotheque(w.mag, { type: 'film' }).find((o) => o.titre === 'Le Voyage');
    assert.ok(carte, 'le titre est dans la grille'); assert.equal(carte!.annee, 2001);
    assert.equal(fichierDeCible(w.mag, carte!.id)?.fichier, join(w.medias, 'Le Voyage (2001) (2).mp4'));
    // Lisible d'un clic : la route du lecteur sert le flux.
    const res = new (class extends Writable { code?: number; n = 0; writeHead(c: number) { this.code = c; return this; } setHeader() { return this; } _write(c: Buffer, _e: string, cb: () => void) { this.n += c.length; cb(); } })();
    const req = Readable.from([]) as unknown as IncomingMessage; Object.assign(req, { method: 'GET', headers: {} });
    await venusRoute(req, res as unknown as ServerResponse, new URL(`http://x/venus/flux/${encodeURIComponent(carte!.id)}`), { home: w.home, proprietaire: () => true, fail: () => undefined, origin: 'http://odin', ip: '127.0.0.1', profil: 'moi' });
    if (!res.writableFinished) await new Promise<void>((ok) => { res.once('finish', () => ok()); setTimeout(ok, 2000); });
    assert.ok(res.code === 200 || res.code === 206, `flux : ${res.code}`); assert.ok(res.n > 0, 'des octets partent');
    // Le scan, qui partage le même rangement, retrouve le même titre (aucun doublon).
    await scanner(w.mag, { ffprobe: ffprobeReel });
    assert.equal(bibliotheque(w.mag, { type: 'film' }).filter((o) => o.titre === 'Le Voyage').length, 1);
  } finally { w.fin(); rmSync(src, { recursive: true, force: true }); }
});

test('musique : un MP3 envoyé dans un dossier de musique devient une piste de l\'album (le dossier) ; un son envoyé comme film est refusé', { skip: sansFfmpeg }, async () => {
  const w = monde('musique'), src = tmp('venus-envoi-src-');
  try {
    const son = fabriquer(join(src, 's.mp3'), 'mp3');
    const p = preparerEnvoi(w.mag, w.depot, { nom: '01 Chanson.mp3', taille: son.length, dossier: w.medias });
    writeFileSync(part(w.depot, p.envoi), son);
    const r = await importerEnvoi(w.mag, w.depot, p.envoi, { ffprobe: ffprobeReel });
    assert.equal(r.ok, true, r.texte); assert.equal(r.ok && r.genre, 'piste');
    assert.equal(bibliotheque(w.mag, { type: 'album' }).length, 1);
  } finally { w.fin(); }
  const f = monde('films');
  try {
    const son = readFileSync(join(src, 's.mp3'));
    const p = preparerEnvoi(f.mag, f.depot, { nom: 'Faux film.mp4', taille: son.length, dossier: f.medias });
    writeFileSync(part(f.depot, p.envoi), son);
    const r = await importerEnvoi(f.mag, f.depot, p.envoi, { ffprobe: pasDeFfprobe });
    assert.equal(r.ok, false); assert.match(r.texte, /est un son .*pas une vidéo/);
  } finally { f.fin(); rmSync(src, { recursive: true, force: true }); }
});

test('les deux actions sont « propriétaire seul » : un membre, un invité, une automatisation sont refusés ; le propriétaire passe', async () => {
  oublierMagasins();
  const home = tmp('venus-envoi-v-'), medias = tmp('venus-envoi-v-medias-');
  const v = new Valhalla(home, [venus(() => '')], { notify: async () => {}, autonomy: () => 'equilibre' } as never);
  try {
    ajouterDossier(magasinVenus(home, v.ctx('freyja').dir), medias, 'films');
    const m = venus(() => '');
    for (const id of ['preparer_envoi_media', 'importer_media']) assert.equal(m.actions.find((a) => a.id === id)?.proprietaireSeul, true, id);
    // Elles écrivent (une fiche, des effacements, un rangement) : aucune n'est « lecture seule ».
    for (const id of ['preparer_envoi_media', 'importer_media']) assert.notEqual(m.actions.find((a) => a.id === id)?.read, true, `${id} n'est pas en lecture seule`);
    const entree = { nom: 'Film.mp4', taille: 100, dossier: medias };
    for (const o of [{ qui: 'member' as const }, { qui: 'guest' as const }, { auto: true }]) {
      const r = await v.act('freyja', 'preparer_envoi_media', entree, o);
      assert.equal(r.ok, false); assert.match(r.text, /seul le propriétaire/);
      assert.match((await v.act('freyja', 'importer_media', { envoi: 'a'.repeat(24) }, o)).text, /seul le propriétaire/);
    }
    const r = await v.act('freyja', 'preparer_envoi_media', entree);
    assert.notEqual(r.ok, false, r.text); assert.match(String((r.data as { envoi: string }).envoi), /^[a-f0-9]{24}$/);
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); rmSync(medias, { recursive: true, force: true }); }
});

test('par le vrai serveur : le propriétaire envoie en morceaux et le titre apparaît ; la session d\'un membre est refusée (préparer, morceau, importer)', { skip: sansFfmpeg, timeout: 180_000 }, async () => {
  const tt = new T(), orig = { log: console.log, error: console.error, warn: console.warn }, medias = tmp('venus-envoi-srv-'), src = tmp('venus-envoi-src-');
  for (const k of ['log', 'error', 'warn'] as const) console[k] = () => {};
  try {
    const v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => ['var', 'freyja'].includes(m.id)) }), va = valhallaOf()!;
    assert.equal((await v.json('/venus/dossiers', { chemin: medias, categorie: 'films' })).status, 200);
    const film = fabriquer(join(src, 'f.mp4'), 'mp4'), nom = 'Essai Serveur (2024).mp4';
    const p = await v.json('/api/valhalla/act', { module: 'freyja', action: 'preparer_envoi_media', input: { nom, taille: film.length, dossier: medias } });
    const envoi = String(((p.body.data ?? {}) as { envoi?: string }).envoi ?? ''); assert.match(envoi, /^[a-f0-9]{24}$/, JSON.stringify(p.body));
    const morceau = async (debut: number, b: Buffer, cookie = v.session) => (await fetch(`${v.url}/api/valhalla/morceau?module=freyja&envoi=${envoi}&debut=${debut}`, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/octet-stream', cookie }, body: b })).json() as Promise<{ ok: boolean; recu: number; error?: string }>;
    const t = Math.ceil(film.length / 2);
    assert.equal((await morceau(0, film.subarray(0, t))).recu, t);
    assert.match(String((await morceau(0, film.subarray(0, t))).error), /reprise/);
    assert.equal((await morceau(t, film.subarray(t))).recu, film.length);
    const imp = await v.json('/api/valhalla/act', { module: 'freyja', action: 'importer_media', input: { envoi } });
    assert.notEqual(imp.body.ok, false, JSON.stringify(imp.body));
    const bib = await v.json('/venus/bibliotheque?type=film');
    assert.ok((bib.body.oeuvres as Array<{ titre: string }>).some((o) => o.titre === 'Essai Serveur'), JSON.stringify(bib.body));

    // Un membre (même avec le droit Vénus) : refusé à chaque étape.
    const MDP = 'une-riviere-calme-sous-la-lune-48';
    assert.equal((await va.act('var', 'ajouter', { login: 'membre-e', nom: 'Membre E', groupes: 'invite', mot_de_passe: MDP })).ok, true);
    for (const appli of ['odin', 'freyja']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-e' })).ok, true);
    lierProprietaire(persona()!);
    let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' });
    r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
    r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: 'membre-e', motdepasse: MDP }) });
    r = await fetch(r.headers.get('location')!, { redirect: 'manual' });
    const cm = r.headers.getSetCookie().find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? ''; assert.ok(cm, 'le membre a une session');
    const prep = await v.json('/api/valhalla/act', { module: 'freyja', action: 'preparer_envoi_media', input: { nom: 'M.mp4', taille: 10, dossier: medias } }, { cookie: cm });
    assert.equal(prep.status, 403, JSON.stringify(prep.body));
    const mo = await fetch(`${v.url}/api/valhalla/morceau?module=freyja&envoi=${'b'.repeat(24)}&debut=0`, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/octet-stream', cookie: cm }, body: Buffer.from('x') });
    assert.ok(mo.status >= 400, `morceau d'un membre : ${mo.status}`);
    assert.equal((await v.json('/api/valhalla/act', { module: 'freyja', action: 'importer_media', input: { envoi } }, { cookie: cm })).status, 403);
    assert.ok(!existsSync(join(dirVenus(v.o.paths.home), 'depots', '.morceaux', `${'b'.repeat(24)}.part`)), 'rien n\'est écrit pour le membre');
  } finally {
    await tt.end(); Object.assign(console, orig);
    rmSync(medias, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true });
  }
});

test('page : la zone d\'envoi (dossier déclaré, plusieurs fichiers, barre par fichier) et sa logique pure ; seulement des routes d\'Odin', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'web', 'pages', 'venus.js'), 'utf8');
  const win: Record<string, unknown> = { OdinPages: {} };
  const c = vm.createContext({ window: win, URLSearchParams });
  vm.runInContext(src, c, { filename: 'venus.js' });
  const L = (win.OdinVenus as { logique: Record<string, (...a: unknown[]) => unknown> }).logique;
  assert.equal(L.typeDeCategorie('series'), 'serie'); assert.equal(L.typeDeCategorie('musique'), 'album'); assert.equal(L.typeDeCategorie('livres_audio'), 'livre_audio'); assert.equal(L.typeDeCategorie('films'), 'film');
  assert.match(String(L.accepter('films')), /^video\/\*,.*\.mkv/); assert.match(String(L.accepter('musique')), /^audio\/\*,.*\.flac/);
  assert.equal(L.pourcent(0, 0), 0); assert.equal(L.pourcent(50, 200), 25); assert.equal(L.pourcent(300, 200), 100);
  assert.equal(L.morceauUrl('abc', 12), '/api/valhalla/morceau?module=freyja&envoi=abc&debut=12');
  assert.equal(L.libelleDossier({ chemin: 'D:\\Médias\\Films' }, 'Films'), 'Films · Films (D:\\Médias\\Films)', 'lisible sur un téléphone : le nom du dossier d\'abord');
  assert.equal(L.libelleDossier({ chemin: '/mnt/series/' }, 'Séries'), 'Séries · series (/mnt/series/)');
  assert.equal(L.sansEntete('Vénus · Préparer un envoi de média : « x.mkv » : épisode sans numéro'), '« x.mkv » : épisode sans numéro');
  assert.equal(L.sansEntete('Refusé : autre chose'), 'Refusé : autre chose');
  assert.match(src, /Envoyer des films, séries ou musique depuis cet appareil/);
  assert.match(src, /type: 'file', multiple: true/);
  assert.match(src, /Déclare d\\'abord un dossier média ci-dessus/);
  assert.match(src, /connexion coupée, reprise…/); assert.match(src, /analyse en cours/);
  assert.match(src, /\.vn-env \.vn-b,\.vn-env select,\.vn-env \.choisir\{min-height:44px\}/, 'cibles de 44 px');
  assert.match(src, /act\('preparer_envoi_media'/); assert.match(src, /act\('importer_media'/);
  assert.match(src, /modifie: file\.lastModified/, 'la date du fichier part avec la préparation');
});

test('déplacement : un original qu\'on ne peut pas effacer (EBUSY) ne crée qu\'UN fichier, rendu tel quel ; rien n\'est écrasé', () => {
  const src = tmp('venus-envoi-dep-src-'), dest = tmp('venus-envoi-dep-dest-');
  try {
    const f = join(src, 'recu.import'); writeFileSync(f, 'contenu');
    writeFileSync(join(dest, 'Titre.mkv'), 'déjà là');
    let appels = 0;
    const occupe = () => { appels++; throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); };
    const r = deplacerSansEcraser(f, dest, 'Titre.mkv', 7, { unlink: occupe as never });
    assert.equal(r, join(dest, 'Titre (2).mkv'));
    assert.equal(appels, 1, 'un seul essai d\'effacement');
    assert.deepEqual(readdirSync(dest).sort(), ['Titre (2).mkv', 'Titre.mkv'], 'un seul nouveau fichier');
    assert.equal(readFileSync(join(dest, 'Titre.mkv'), 'utf8'), 'déjà là', 'aucun écrasement');
    // Même chose par la copie (autre disque) : copié une fois, original laissé à la purge.
    writeFileSync(join(src, 'b.import'), 'contenu');
    const r2 = deplacerSansEcraser(join(src, 'b.import'), dest, 'Titre.mkv', 7, { link: (() => { throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' }); }) as never, unlink: occupe as never });
    assert.equal(r2, join(dest, 'Titre (3).mkv')); assert.equal(readdirSync(dest).length, 3);
  } finally { rmSync(src, { recursive: true, force: true }); rmSync(dest, { recursive: true, force: true }); }
});

test('deux fichiers différents de même nom et même taille (dates différentes) : deux envois distincts, le second repart de zéro', () => {
  const w = monde('films');
  try {
    const a = preparerEnvoi(w.mag, w.depot, { nom: 'Film.mp4', taille: 10_000, dossier: w.medias, modifie: 1_700_000_000_000 });
    writeFileSync(part(w.depot, a.envoi), Buffer.alloc(5000, 1));
    const b = preparerEnvoi(w.mag, w.depot, { nom: 'Film.mp4', taille: 10_000, dossier: w.medias, modifie: 1_700_000_999_000 });
    assert.notEqual(b.envoi, a.envoi); assert.equal(b.recu, 0, 'aucun octet du premier n\'est repris');
    // Le même fichier (même date) reprend bien où il en était.
    assert.equal(preparerEnvoi(w.mag, w.depot, { nom: 'Film.mp4', taille: 10_000, dossier: w.medias, modifie: 1_700_000_000_000 }).recu, 5000);
  } finally { w.fin(); }
});

test('EICAR sans Asclépios (gardien de secours) : refusé quand même, ni dans le dossier ni dans la bibliothèque, FFmpeg jamais appelé', async () => {
  brancherGarde(undefined);
  const w = monde('films');
  try {
    const p = preparerEnvoi(w.mag, w.depot, { nom: 'film.mp4', taille: EICAR.length, dossier: w.medias });
    writeFileSync(part(w.depot, p.envoi), EICAR);
    const r = await importerEnvoi(w.mag, w.depot, p.envoi, { ffprobe: pasDeFfprobe });
    assert.equal(r.ok, false); assert.match(r.texte, /^Refusé : /);
    assert.ok(!existsSync(part(w.depot, p.envoi)));
    assert.deepEqual(readdirSync(w.medias), []); assert.equal(bibliotheque(w.mag).length, 0);
  } finally { w.fin(); }
});
