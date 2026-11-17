// Médias reçus : media_info montre maintenant toutes les métadonnées, lues sur la machine sans programme.
// Avec l'ancien code (ffprobe obligatoire, étiquettes jetées), cet essai échoue : PATH vidé → « ffmpeg est introuvable ».
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ffmpegArgs, ficheMedia, mediaInfo } from '../src/files/media.ts';
import * as F from './medias-fabriquer.ts';

let dossier = '';
const chemin = { PATH: process.env.PATH, Path: process.env.Path };
before(() => {
  dossier = mkdtempSync(join(tmpdir(), 'odin-medias-'));
  writeFileSync(join(dossier, 'lagon.mp3'), F.mp3Id3({ version: 3, xing: 100, trames: [
    ['TIT2', F.texteId3('Lagon bleu')], ['TPE1', F.texteId3('Awa Saïd')], ['TALB', F.texteId3('Mamoudzou Sessions')], ['TCOM', F.texteId3('Saïd Ali')],
    ['TPUB', F.texteId3('Label Ylang')], ['TCOP', F.texteId3('2025 Ylang Distribution')], ['TXXX', F.txxx('DISTRIBUTOR', 'Ylang Distribution')]] }));
  writeFileSync(join(dossier, 'photo.jpg'), F.jpegExif({ date: '2026:08:14 17:32:05', marque: 'Fairphone', modele: 'FP5', lat: -12.7806, lon: 45.2275 }));
  // Sans ffprobe ni ffmpeg : le PATH est vidé pendant l'essai.
  process.env.PATH = ''; if (process.env.Path !== undefined) process.env.Path = '';
});
after(() => {
  process.env.PATH = chemin.PATH; if (chemin.Path !== undefined) process.env.Path = chemin.Path;
  rmSync(dossier, { recursive: true, force: true });
});

test('musique : toutes les étiquettes, sans ffprobe', () => {
  const i = mediaInfo(join(dossier, 'lagon.mp3'));
  assert.equal(i.format, 'Musique MP3');
  assert.ok(i.durationSec > 2.6 && i.durationSec < 2.62);
  assert.ok(i.streams[0].startsWith('audio mp3 44100 Hz, 2 canal(aux) (MPEG-1 couche III)'), i.streams[0]);
  for (const x of ['Titre : Lagon bleu', 'Artiste : Awa Saïd', 'Album : Mamoudzou Sessions', 'Compositeur : Saïd Ali', 'Label : Label Ylang', 'Droits (©) : 2025 Ylang Distribution', 'Distributeur : Ylang Distribution'])
    assert.ok(i.streams.some((s) => s.startsWith(x)), `${x} absent de : ${i.streams.join(' | ')}`);
  assert.equal(i.fiche?.exterieur, true);
});

test('photo : le lieu est masqué par défaut, montré sur demande', () => {
  const masque = mediaInfo(join(dossier, 'photo.jpg'));
  assert.ok(masque.streams.includes('Lieu : présent dans le fichier (gardé sur la machine)'));
  assert.ok(masque.streams.some((s) => s.startsWith('Pris le : 14/08/2026')));
  assert.ok(!masque.streams.join(' ').includes('12,78'));
  assert.ok(!masque.streams.join(' ').includes('17:32'));
  assert.ok(masque.streams.some((s) => s.startsWith('Appareil : Fairphone FP5')));
  const montre = mediaInfo(join(dossier, 'photo.jpg'), { sensibles: 'montrer' });
  assert.ok(montre.streams.some((s) => s.startsWith('Position : 12° 46′ 50,2″ S, 45° 13′ 39,0″ E (−12,780600 ; 45,227500)')));
  assert.ok(montre.streams.some((s) => s.startsWith('Pris le : 14/08/2026 à 17:32')));
  assert.equal(ficheMedia(join(dossier, 'photo.jpg')).position?.lat, -12.7806);
});

test('fichier absent : « Fichier introuvable »', () => {
  assert.throws(() => mediaInfo(join(dossier, 'absent.mp4')), /Fichier introuvable : absent\.mp4/);
});

test('ffmpegArgs inchangé', () => {
  assert.deepEqual(ffmpegArgs('in.mp4', 'out.mp3', { audioOnly: true, start: '00:01:00', duration: '30' }), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '00:01:00', '-i', 'in.mp4', '-t', '30', '-vn', 'out.mp3']);
  assert.deepEqual(ffmpegArgs('in.mp4', 'mini.jpg', { frameAt: '5', width: 320 }), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '5', '-i', 'in.mp4', '-frames:v', '1', '-vf', 'scale=320:-2', 'mini.jpg']);
});
