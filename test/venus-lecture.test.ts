// Vénus · Odéon natif — la lecture : choix direct / transcodage, en-tête Range, sous-titres (choix et conversion),
// arguments FFmpeg. Pur, aucun flux réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { argsSousTitres, argsTranscodage, choisirSousTitres, lireRange, lisible, planLecture, srtVersVtt, estVtt } from '../src/valhalla/venus/lecture.ts';
import type { Probe } from '../src/valhalla/venus/bibliotheque.ts';

const probe = (codecs: string[], audio = ['aac']): Probe => ({ duree: 3600, codecs, audio, sousTitres: [] });

test('lisible : MP4/h264 oui, MKV non, MP4/HEVC non, MP4/AC3 non', () => {
  assert.equal(lisible(probe(['h264']), '/x.mp4'), true);
  assert.equal(lisible(probe(['h264']), '/x.mkv'), false, 'conteneur MKV non lisible');
  assert.equal(lisible(probe(['hevc']), '/x.mp4'), false, 'HEVC à transcoder');
  assert.equal(lisible(probe(['h264'], ['ac3']), '/x.mp4'), false, 'AC3 à transcoder');
  assert.equal(lisible(undefined, '/x.mp4'), true, 'conteneur sûr, codecs inconnus : on tente');
});

test('planLecture : direct, MP4 (court) ou HLS (long) ; audio', () => {
  assert.equal(planLecture({ chemin: '/x.mp4', probe: probe(['h264']), type: 'video', duree: 100 }).mode, 'direct');
  assert.equal(planLecture({ chemin: '/x.mkv', probe: probe(['hevc']), type: 'video', duree: 100 }).mode, 'mp4');
  assert.equal(planLecture({ chemin: '/x.mkv', probe: probe(['hevc']), type: 'video', duree: 3600 }).mode, 'hls');
  assert.equal(planLecture({ chemin: '/x.wma', type: 'audio' }).mode, 'mp4', 'format audio peu lisible : transcodé');
  assert.equal(planLecture({ chemin: '/x.flac', type: 'audio' }).mode, 'direct');
  assert.equal(planLecture({ chemin: '/x.mp3', type: 'audio' }).mode, 'direct');
});

test('lireRange : plage complète, partielle, derniers octets', () => {
  assert.deepEqual(lireRange(undefined, 1000), { debut: 0, fin: 999, partiel: false });
  assert.deepEqual(lireRange('bytes=100-199', 1000), { debut: 100, fin: 199, partiel: true });
  assert.deepEqual(lireRange('bytes=500-', 1000), { debut: 500, fin: 999, partiel: true });
  assert.deepEqual(lireRange('bytes=-200', 1000), { debut: 800, fin: 999, partiel: true });
  assert.equal(lireRange('bytes=5000-6000', 1000).debut, 999, 'borné à la taille');
});

test('arguments FFmpeg : transcodage (reprise), sous-titres', () => {
  const mp4 = argsTranscodage('/f.mkv', 'mp4', 90);
  assert.ok(mp4.includes('libx264') && mp4.includes('-ss') && mp4[mp4.indexOf('-ss') + 1] === '90' && mp4.at(-1) === 'pipe:1');
  const hls = argsTranscodage('/f.mkv', 'hls');
  assert.ok(hls.includes('hls') && !hls.includes('-ss'));
  assert.deepEqual(argsSousTitres('/f.mkv', { index: 3 }).filter((x) => x === '0:3'), ['0:3']);
});

test('sous-titres : choix par langue (puis fr, puis premier), SRT → VTT', () => {
  const l = [{ langue: 'en', index: 1 }, { langue: 'fr', index: 2 }];
  assert.equal(choisirSousTitres(l, 'fr')?.index, 2);
  assert.equal(choisirSousTitres(l)?.index, 2, 'fr par défaut');
  assert.equal(choisirSousTitres([{ langue: 'de', index: 5 }])?.index, 5, 'premier à défaut de fr');
  assert.equal(choisirSousTitres([], 'fr'), undefined);
  const vtt = srtVersVtt('1\n00:00:01,000 --> 00:00:02,500\nBonjour\n');
  assert.ok(estVtt(vtt) && vtt.includes('00:00:01.000 --> 00:00:02.500') && vtt.includes('Bonjour'));
});
