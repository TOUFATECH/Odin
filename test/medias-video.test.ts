// Médias reçus : les métadonnées des vidéos (fichiers fabriqués octet par octet ; coordonnées d'essai).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lireMetadonnees } from '../src/medias/metadonnees.ts';
import * as F from './medias-fabriquer.ts';

const lire = (b: Buffer) => lireMetadonnees({ octets: b });
type Fi = ReturnType<typeof lire>;
const v = (f: Fi, cle: string) => f.champs.find((c) => c.cle === cle)?.valeur;

const mdta = { 'com.apple.quicktime.creationdate': '2026-08-14T17:32:05+0300', 'com.apple.quicktime.location.ISO6709': '+48.8584+002.2945+035.0/', 'com.apple.quicktime.make': 'Fairphone', 'com.apple.quicktime.model': 'FP5' };

test('MP4 : pistes, rotation, langue, images par seconde, mdta, ISO 6709, ©xyz', () => {
  const f = lire(F.mp4Video({ mdta, xyz: '-12.7806+045.2275/', rotation: 90, langue: 'fra', ilst: [F.atome('\xa9nam', 'Arrivée au port'), F.atome('\xa9too', 'Lavf61.7.100')] }));
  assert.equal(f.illisible, undefined);
  assert.equal(f.nature.format, 'mp4');
  assert.equal(f.dureeSec, 5);
  const vid = f.pistes.find((p) => p.genre === 'vidéo')!;
  const son = f.pistes.find((p) => p.genre === 'son')!;
  assert.equal(vid.rotationDeg, 90);
  assert.equal(vid.imagesParSeconde, 25);
  assert.match(vid.codec!, /^H\.264 \(AVC\) profil High 4\.1/);
  assert.equal(f.largeur, 480); assert.equal(f.hauteur, 854);
  assert.equal(son.langueDeclaree, 'fr');
  assert.equal(son.codec, 'AAC-LC');
  assert.equal(vid.langueDeclaree, undefined);
  // Date de prise de vue avec fuseau, depuis la clé QuickTime.
  const d = f.dates.find((x) => x.role === 'prise de vue')!;
  assert.equal(d.fuseau, '+03:00');
  assert.equal(d.utc, '2026-08-14T14:32:05Z');
  // Position : la clé ISO 6709 l'emporte sur ©xyz ; l'autre est gardée ; désaccord signalé.
  assert.equal(f.position?.lat, 48.8584); assert.equal(f.position?.lon, 2.2945); assert.equal(f.position?.altitudeM, 35);
  assert.equal(f.autresPositions[0]?.lat, -12.7806);
  assert.ok(f.remarques.some((r) => r.includes('positions en désaccord')));
  assert.equal(v(f, 'titre'), 'Arrivée au port');
  assert.equal(v(f, 'appareil_marque'), 'Fairphone');
  assert.ok(f.remarques.includes('passée par FFmpeg (réencodage possible)'));
});

test('MP4 : moov en fin de fichier, et date du conteneur (1904)', () => {
  const sec1904 = Math.floor(Date.UTC(2026, 7, 14, 14, 32, 5) / 1000) + 2_082_844_800;
  const f = lire(F.mp4Video({ moovEnFin: true, creation1904: sec1904 }));
  assert.equal(f.dureeSec, 5);
  assert.equal(f.pistes.length, 2);
  const c = f.champs.find((x) => x.cle === 'date_creation_fichier')!;
  assert.equal(c.brut, '2026-08-14T14:32:05Z');
  assert.equal(c.sensible, true);
  assert.ok(f.remarques.some((r) => r.includes('heure locale écrite comme UTC')));
});

test('MKV avec SeekHead : Info, Tracks, Tags, Chapters', () => {
  const f = lire(F.mkv({ tags: [[50, 'TITLE', 'Arrivée au port'], [50, 'ARTIST', 'Awa Saïd'], [50, 'DISTRIBUTED_BY', 'Ylang Distribution']] }));
  assert.equal(f.illisible, undefined);
  assert.equal(f.partiel, undefined);
  assert.equal(f.nature.format, 'mkv');
  assert.equal(f.dureeSec, 5);
  const [vi, so, st] = f.pistes;
  assert.equal(vi.codec, 'H.264 (AVC)'); assert.equal(vi.largeur, 1920); assert.equal(vi.hauteur, 1080); assert.equal(vi.imagesParSeconde, 25);
  assert.equal(so.codec, 'Opus'); assert.equal(so.langueDeclaree, 'fr'); assert.equal(so.frequenceHz, 48000);
  assert.equal(st.genre, 'sous-titres'); assert.equal(st.codec, 'SRT (texte)');
  assert.equal(st.langueDeclaree, undefined, 'une piste sans Language n\'a pas de langue (jamais « eng »)');
  assert.equal(v(f, 'titre'), 'Arrivée au port');
  assert.equal(v(f, 'artiste'), 'Awa Saïd');
  const dist = f.champs.find((c) => c.cle === 'distributeur')!;
  assert.equal(dist.valeur, 'Ylang Distribution'); assert.equal(dist.fiabilite, 'sure');
  assert.equal(f.chapitres.length, 2);
  assert.equal(f.chapitres[1].titre, 'Le port'); assert.equal(f.chapitres[1].debutSec, 2.5); assert.equal(f.chapitres[1].langue, 'fr');
});

test('MKV : un Cluster de taille inconnue avant les Tags, sans SeekHead → partiel', () => {
  const f = lire(F.mkv({ seekHead: false, clusterInconnu: true, tags: [[50, 'TITLE', 'Jamais lu']] }));
  assert.ok(f.partiel?.includes('Tags et chapitres peut-être en fin de fichier'), f.partiel);
  assert.equal(f.illisible, undefined);
  assert.equal(f.pistes.length, 3);
  assert.equal(v(f, 'titre'), undefined);
});

test('WebM', () => {
  const f = lire(F.webm());
  assert.equal(f.nature.format, 'webm');
  assert.equal(f.pistes[0].codec, 'VP9');
  assert.equal(f.largeur, 640);
  assert.equal(v(f, 'titre'), 'Essai WebM');
});

test('AVI : IDIT et INFO ISFT', () => {
  const f = lire(F.avi({ idit: 'Tue Jul 14 18:22:05 2026', logiciel: 'Caméra Ylang 2.1' }));
  assert.equal(f.nature.format, 'avi');
  assert.equal(f.dureeSec, 5);
  assert.equal(f.largeur, 320);
  assert.equal(f.pistes[0].codec, 'Motion JPEG');
  assert.equal(f.pistes[0].imagesParSeconde, 25);
  assert.equal(v(f, 'logiciel'), 'Caméra Ylang 2.1');
  assert.equal(f.dates.find((d) => d.role === 'prise de vue')?.iso, '2026-07-14T18:22:05');
  const g = lire(F.avi({ idit: '2026:07:14 18:22:05' }));
  assert.equal(g.dates.find((d) => d.role === 'prise de vue')?.iso, '2026-07-14T18:22:05');
});
