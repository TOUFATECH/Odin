// Médias reçus : reconnaître un fichier d'après son contenu (fichiers fabriqués octet par octet).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconnaitreNature, reconnaitreOctets } from '../src/medias/reconnaitre.ts';
import { creerBudget, sourceOctets } from '../src/medias/octets.ts';
import { lireMetadonnees } from '../src/medias/metadonnees.ts';
import * as F from './medias-fabriquer.ts';

const nature = (b: Buffer, nom?: string) => reconnaitreNature(sourceOctets(b, creerBudget(), nom), nom);

test('chaque signature donne le bon format et la bonne famille', () => {
  const cas: Array<[Buffer, string, string]> = [
    [F.jpegNu(), 'jpeg', 'image'], [F.pngTextes({}), 'png', 'image'], [F.gif({ images: 2 }), 'gif', 'image'], [F.webp(), 'webp', 'image'],
    [F.heic({ largeur: 64, hauteur: 48 }), 'heic', 'image'], [F.construireTiff({ ifd0: [F.L(0x100, 8), F.L(0x101, 8)] }), 'tiff', 'image'],
    [F.mp3Id3({ version: 3, trames: [['TIT2', F.texteId3('x')]] }), 'mp3', 'son'], [F.tramesMp3(5), 'mp3', 'son'],
    [F.flacVorbis({ commentaires: ['ARTIST=Awa Saïd'] }), 'flac', 'son'], [F.oggOpus({ commentaires: [], granule: 48000 }), 'ogg-opus', 'son'],
    [F.oggVorbis({ commentaires: [], granule: 44100 }), 'ogg-vorbis', 'son'], [F.wav(), 'wav', 'son'], [F.aiff(), 'aiff', 'son'],
    [F.m4aIlst({ atomes: [] }), 'm4a', 'son'], [F.mp4Video({}), 'mp4', 'video'], [F.mp4Video({ marque: 'qt  ' }), 'mov', 'video'],
    [F.mkv({}), 'mkv', 'video'], [F.webm(), 'webm', 'video'], [F.avi(), 'avi', 'video'],
    [F.pdfMinimal({ info: { Title: 'x' } }), 'pdf', 'document'], [F.docxMinimal(), 'docx', 'document'],
    [F.odfMinimal('application/vnd.oasis.opendocument.text'), 'odt', 'document'], [F.epubMinimal(), 'epub', 'document'],
    [F.zipAvec([['a.txt', F.utf8('a')]]), 'zip', 'archive'],
    [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'ole', 'document'], [F.lat('{\\rtf1 bonjour}'), 'rtf', 'document'],
    [Buffer.from([0x1f, 0x8b, 8, 0, 0, 0]), 'gzip', 'archive'], [F.lat('MThd\0\0\0\x06\0\x01\0\x02\x01\xe0'), 'midi', 'son'], [F.lat('#!AMR\n\x3c'), 'amr', 'son'],
  ];
  for (const [b, fmt, fam] of cas) {
    const n = nature(b);
    assert.equal(n.format, fmt, `format attendu ${fmt}`);
    assert.equal(n.famille, fam, `famille de ${fmt}`);
  }
  // xlsx, pptx distingués par le répertoire central.
  const ox = (dossier: string) => F.zipAvec([['[Content_Types].xml', F.utf8('<Types/>')], [`${dossier}/x.xml`, F.utf8('<x/>')]]);
  assert.equal(nature(ox('xl')).format, 'xlsx');
  assert.equal(nature(ox('ppt')).format, 'pptx');
});

test('le contenu fait foi : un JPEG nommé .png est signalé', () => {
  const n = nature(F.jpegNu(), 'vacances.png');
  assert.equal(n.format, 'jpeg');
  assert.equal(n.accordExtension, false);
  assert.equal(n.extensionDonnee, 'png');
  assert.ok(n.alertes.some((a) => a.includes('extension .png mais contenu Photo JPEG')));
  assert.equal(nature(F.jpegNu(), 'photo.JPG').accordExtension, true);
});

test('une balise ID3 devant un FLAC est sautée et signalée', () => {
  const b = Buffer.concat([F.balisId3({ version: 3, trames: [['TIT2', F.texteId3('Lagon bleu')]] }), F.flacVorbis({ commentaires: ['TITLE=Lagon bleu'] })]);
  const n = nature(b);
  assert.equal(n.format, 'flac');
  assert.ok(n.debut > 0);
  assert.ok(n.alertes.some((a) => a.includes('balise ID3 devant un FLAC')));
  const f = lireMetadonnees({ octets: b });
  assert.equal(f.champs.find((c) => c.cle === 'titre')?.valeur, 'Lagon bleu');
});

test('« mp42 » sans piste vidéo devient un son après lecture', () => {
  const b = F.mp4Video({ marque: 'mp42', sansVideo: true });
  assert.equal(nature(b).famille, 'video');
  const f = lireMetadonnees({ octets: b });
  assert.equal(f.nature.famille, 'son');
  assert.ok(f.nature.alertes.some((a) => a.includes('sans piste vidéo')));
});

test('textes : encodages et sortes', () => {
  const t = 'Bonjour, ceci est un texte — été à Mamoudzou.\n';
  assert.deepEqual([nature(F.texte('utf-8', t)).encodage?.nom, nature(F.texte('utf-8', t)).encodage?.bom], ['utf-8', false]);
  assert.deepEqual([nature(F.texte('utf-8-bom', t)).encodage?.nom, nature(F.texte('utf-8-bom', t)).encodage?.bom], ['utf-8', true]);
  assert.equal(nature(F.texte('utf-16le-bom', t)).encodage?.nom, 'utf-16le');
  assert.equal(nature(F.texte('utf-16be-bom', t)).encodage?.nom, 'utf-16be');
  const sansBom = nature(F.texte('utf-16le', t));
  assert.equal(sansBom.encodage?.nom, 'utf-16le'); assert.equal(sansBom.encodage?.sur, false);
  assert.equal(nature(F.texte('utf-16be', t)).encodage?.nom, 'utf-16be');
  assert.equal(nature(F.texte('utf-32le-bom', t)).encodage?.nom, 'utf-32le');
  const w = nature(F.texte('windows-1252', 'Café crème, déjà payé.\n'));
  assert.equal(w.famille, 'texte'); assert.equal(w.encodage?.sur, false); assert.ok((w.encodage?.candidats ?? []).length > 0);
  assert.equal(nature(F.utf8(F.srt([['00:00:01,000', '00:00:02,500', 'Bonjour']]))).format, 'srt');
  assert.equal(nature(F.utf8('WEBVTT\n\n00:01.000 --> 00:02.000\nBonjour\n')).format, 'vtt');
  assert.equal(nature(F.utf8('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')).format, 'svg');
  assert.equal(nature(F.utf8('<!DOCTYPE html><html><body>x</body></html>')).format, 'html');
  assert.equal(nature(F.utf8('{"a": [1, 2, 3]}')).format, 'json');
  assert.equal(nature(F.utf8('nom;age;ville\nAwa;30;Mamoudzou\nSaïd;41;Dzaoudzi\n')).format, 'csv');
  assert.equal(nature(F.utf8('[Script Info]\nTitle: x\n')).format, 'ass');
  assert.equal(nature(Buffer.from(Array.from({ length: 600 }, (_, i) => (i * 7) % 256))).format, 'inconnu');
});

test('3 octets FF FB 90 seuls ne font pas un MP3', () => {
  assert.notEqual(reconnaitreOctets(Buffer.from([0xff, 0xfb, 0x90])).format, 'mp3');
  assert.notEqual(reconnaitreOctets(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0])).format, 'mp3');
});

test('données en queue après un JPEG', () => {
  const n = nature(F.jpegExif({ date: '2026:08:14 17:32:05', queue: 1204 }));
  assert.ok(n.alertes.includes('données en queue : 1 204 octets'), n.alertes.join(' | '));
});
