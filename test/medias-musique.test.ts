// Médias reçus : les métadonnées de la musique (fichiers fabriqués octet par octet ; noms fictifs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extraireImageJointe, ficheEnLignes, lireMetadonnees } from '../src/medias/metadonnees.ts';
import { lireWav as lireWavAncien } from '../src/audio/wav.ts';
import * as F from './medias-fabriquer.ts';

const lire = (b: Buffer) => lireMetadonnees({ octets: b });
type Fi = ReturnType<typeof lire>;
const v = (f: Fi, cle: string) => f.champs.find((c) => c.cle === cle)?.valeur;
const c = (f: Fi, cle: string) => f.champs.find((x) => x.cle === cle);
const PNG = F.pngTextes({ largeur: 2, hauteur: 2 });

const tramesLagon = (avecDistributeur = true): Array<[string, Buffer]> => [
  ['TIT2', F.texteId3('Lagon bleu')], ['TPE1', F.texteId3('Awa Saïd')], ['TALB', F.texteId3('Mamoudzou Sessions')], ['TCOM', F.texteId3('Saïd Ali')],
  ['TPUB', F.texteId3('Label Ylang')], ['TCOP', F.texteId3('2025 Ylang Distribution')], ['TCON', F.texteId3('(13)')], ['TRCK', F.texteId3('3/12')],
  ['TSRC', F.texteId3('FR-XXX-25-00001')], ['APIC', F.apic('image/png', 3, 'Pochette', PNG)], ['USLT', F.comm('fra', '', 'Le lagon est bleu')],
  ...(avecDistributeur ? [['TXXX', F.txxx('DISTRIBUTOR', 'Ylang Distribution')] as [string, Buffer]] : []),
];

test('MP3 ID3v2.3 : toutes les étiquettes de la musique', () => {
  const f = lire(F.mp3Id3({ version: 3, trames: tramesLagon() }));
  assert.equal(f.nature.format, 'mp3');
  assert.equal(v(f, 'titre'), 'Lagon bleu');
  assert.equal(v(f, 'artiste'), 'Awa Saïd');
  assert.equal(v(f, 'album'), 'Mamoudzou Sessions');
  assert.equal(v(f, 'compositeur'), 'Saïd Ali');
  assert.equal(v(f, 'label'), 'Label Ylang');
  assert.equal(v(f, 'droits'), '2025 Ylang Distribution');
  assert.equal(v(f, 'genre'), 'Pop');
  assert.equal(v(f, 'piste'), '3/12');
  assert.equal(v(f, 'isrc'), 'FRXXX2500001');
  assert.equal(c(f, 'distributeur')?.source, 'ID3v2.3:TXXX:DISTRIBUTOR');
  assert.equal(v(f, 'distributeur'), 'Ylang Distribution');
  assert.equal(f.images[0].role, 'pochette recto');
  assert.equal(f.images[0].format, 'png');
  assert.equal(f.textesInclus[0].genre, 'paroles');
  assert.equal(f.textesInclus[0].langue, 'fr');
  assert.equal(f.pistes[0].frequenceHz, 44100);
});

test('distributeur absent : dit, jamais déduit, avec les droits bruts', () => {
  const f = lire(F.mp3Id3({ version: 3, trames: tramesLagon(false) }));
  assert.equal(c(f, 'distributeur'), undefined);
  assert.ok(f.manque.some((m) => m.raison === 'distributeur non indiqué dans le fichier'));
  assert.ok(f.remarques.some((r) => r.startsWith('mentions de droits brutes : 2025 Ylang Distribution')));
});

test('ID3 : « / » en 2.3 n\'est pas un séparateur ; NUL en 2.4 l\'est ; tailles u32 en 2.4 ; désynchronisation', () => {
  assert.equal(v(lire(F.mp3Id3({ version: 3, trames: [['TPE1', F.texteId3('AC/DC')]] })), 'artiste'), 'AC/DC');
  const deux = lire(F.mp3Id3({ version: 4, trames: [['TPE1', F.texteId3(['Awa Saïd', 'Saïd Ali'])]] }));
  assert.deepEqual(c(deux, 'artiste')?.valeurs, ['Awa Saïd', 'Saïd Ali']);
  const long = 'Lagon bleu — '.repeat(16);
  const u32 = lire(F.mp3Id3({ version: 4, tailleU32: true, trames: [['TIT2', F.texteId3(long)], ['TPE1', F.texteId3('Awa Saïd')]] }));
  assert.equal(v(u32, 'titre'), long.trim());
  assert.equal(v(u32, 'artiste'), 'Awa Saïd');
  assert.ok(u32.remarques.some((r) => r.includes('tailles ID3v2.3 dans une balise 2.4')));
  const imgDs = Buffer.concat([PNG, Buffer.from([0xff, 0xe0, 0xff, 0x00])]);
  const bds = F.mp3Id3({ version: 3, desynchronise: true, trames: [['TIT2', F.texteId3('Lagon bleu')], ['APIC', F.apic('image/png', 3, '', imgDs)], ['TPE1', F.texteId3('Awa Saïd')]] });
  const ds = lire(bds);
  assert.equal(v(ds, 'titre'), 'Lagon bleu');
  assert.equal(v(ds, 'artiste'), 'Awa Saïd');
  assert.equal(ds.images[0].codage, 'désynchronisé');
  assert.ok(extraireImageJointe({ octets: bds }, ds.images[0])?.equals(imgDs));
});

test('ID3v1 seul, et ID3v1 en Latin-1 douteux', () => {
  const f = lire(Buffer.concat([F.tramesMp3(5), F.id3v1({ titre: 'Lagon bleu', artiste: 'Awa Said', album: 'Sessions', annee: '2025', piste: 3, genre: 13 })]));
  assert.equal(v(f, 'titre'), 'Lagon bleu');
  assert.equal(c(f, 'titre')?.fiabilite, 'probable');
  assert.equal(v(f, 'piste'), '3');
  assert.equal(v(f, 'genre'), 'Pop');
  const d = lire(Buffer.concat([F.tramesMp3(5), F.id3v1({ titre: Buffer.from('Caf\xe9 du port', 'latin1') })]));
  const t = c(d, 'titre')!;
  assert.equal(t.valeur, 'Café du port');
  assert.equal(t.encodageDouteux, true);
  assert.ok((t.candidats ?? []).length > 0);
  // ID3v1 ne remplace pas l'ID3v2.
  const deux = lire(F.mp3Id3({ version: 3, trames: [['TIT2', F.texteId3('Lagon bleu')]], queue: F.id3v1({ titre: 'Autre' }) }));
  assert.equal(deux.champs.filter((x) => x.cle === 'titre').length, 1);
});

test('APEv2', () => {
  const f = lire(Buffer.concat([F.tramesMp3(5), F.ape([['Title', 'Lagon bleu'], ['Artist', 'Awa Saïd'], ['Label', 'Label Ylang'], ['Distributor', 'Ylang Distribution']])]));
  assert.equal(v(f, 'titre'), 'Lagon bleu');
  assert.equal(v(f, 'label'), 'Label Ylang');
  assert.equal(c(f, 'distributeur')?.source, 'APE:Distributor');
});

test('MP3 : durée exacte par Xing, estimée sans', () => {
  const x = lire(F.mp3Id3({ version: 3, trames: [['TIT2', F.texteId3('x')]], xing: 100 }));
  assert.equal(x.dureeSec, Math.round((100 * 1152 / 44100) * 1000) / 1000);
  assert.equal(x.dureeEstimee, undefined);
  const e = lire(F.mp3Id3({ version: 3, trames: [['TIT2', F.texteId3('x')]] }));
  assert.equal(e.dureeEstimee, true);
  assert.ok(Math.abs(e.dureeSec! - (10 * 417 * 8) / 128000) < 0.01);
});

test('FLAC : commentaires Vorbis répétés, ORGANIZATION → label, image', () => {
  const pic = F.blocPicture(3, 'image/png', PNG, 2, 2).toString('base64');
  const b = F.flacVorbis({ commentaires: ['TITLE=Lagon bleu', 'ARTIST=Awa Saïd', 'artist=Saïd Ali', 'ORGANIZATION=Label Ylang', 'DISTRIBUTOR=Ylang Distribution', 'TRACKNUMBER=3', 'TRACKTOTAL=12', `METADATA_BLOCK_PICTURE=${pic}`], total: 441000 });
  const f = lire(b);
  assert.equal(f.nature.format, 'flac');
  assert.deepEqual(c(f, 'artiste')?.valeurs, ['Awa Saïd', 'Saïd Ali']);
  assert.equal(v(f, 'label'), 'Label Ylang');
  assert.equal(v(f, 'piste'), '3/12');
  assert.equal(f.dureeSec, 10);
  assert.equal(f.images[0].codage, 'base64');
  assert.equal(f.images[0].format, 'png');
  const img = extraireImageJointe({ octets: b }, f.images[0]);
  assert.ok(img && img.equals(PNG));
});

test('Ogg Opus : durée (granule − pre-skip) / 48 000, 48 kHz', () => {
  const f = lire(F.oggOpus({ commentaires: ['TITLE=Lagon bleu', 'ARTIST=Awa Saïd'], granule: 48000 * 3 + 312, preskip: 312 }));
  assert.equal(f.nature.format, 'ogg-opus');
  assert.equal(f.dureeSec, 3);
  assert.equal(f.pistes[0].frequenceHz, 48000);
  assert.equal(v(f, 'titre'), 'Lagon bleu');
  const o = lire(F.oggVorbis({ commentaires: ['ALBUM=Mamoudzou Sessions'], granule: 44100 * 2 }));
  assert.equal(o.dureeSec, 2);
  assert.equal(v(o, 'album'), 'Mamoudzou Sessions');
});

test('M4A : ilst iTunes, forme libre, pochette, xid → distributeur probable + ISRC', () => {
  const f = lire(F.m4aIlst({ atomes: [F.atome('\xa9nam', 'Lagon bleu'), F.atome('\xa9ART', 'Awa Saïd'), F.atome('\xa9alb', 'Mamoudzou Sessions'), F.atome('\xa9wrt', 'Saïd Ali'),
    F.atome('cprt', '2025 Ylang Distribution'), F.trkn(3, 12), F.covr(PNG, 13), F.libre('LABEL', 'Label Ylang'), F.atome('xid ', 'Ylang Distribution:isrc:FRXXX2500001')] }));
  assert.equal(f.nature.format, 'm4a');
  assert.equal(v(f, 'titre'), 'Lagon bleu');
  assert.equal(v(f, 'compositeur'), 'Saïd Ali');
  assert.equal(v(f, 'droits'), '2025 Ylang Distribution');
  assert.equal(v(f, 'piste'), '3/12');
  assert.equal(v(f, 'label'), 'Label Ylang');
  assert.equal(c(f, 'distributeur')?.fiabilite, 'probable');
  assert.equal(v(f, 'distributeur'), 'Ylang Distribution');
  assert.equal(v(f, 'isrc'), 'FRXXX2500001');
  // MIME annoncé « image/jpeg », octets PNG : le format vient des octets.
  assert.equal(f.images[0].mimeDeclare, 'image/jpeg');
  assert.equal(f.images[0].format, 'png');
  const b = F.m4aIlst({ atomes: [F.covr(PNG, 13)] });
  const img = extraireImageJointe({ octets: b }, lire(b).images[0]);
  assert.ok(img && img.equals(PNG));
  assert.equal(f.pistes[0].codec, 'AAC-LC');
});

test('WAV : INFO (ISRC lu comme « source »), bext ; même format que le lecteur WAV d\'Odin', () => {
  const b = F.wav({ info: [['INAM', 'Lagon bleu'], ['IART', 'Awa Saïd'], ['ISRC', 'Studio Ylang']], bext: { description: 'Prise 3', originator: 'Studio Ylang', date: '2025-06-01', heure: '10:20:30' } });
  const f = lire(b);
  assert.equal(v(f, 'titre'), 'Lagon bleu');
  assert.equal(c(f, 'isrc'), undefined);
  assert.equal(c(f, 'x:Source')?.valeur, 'Studio Ylang');
  assert.equal(v(f, 'description'), 'Prise 3');
  assert.equal(c(f, 'date_enregistrement')?.brut, '2025-06-01T10:20:30');
  assert.equal(f.dureeSec, 1);
  const ancien = lireWavAncien(b);
  assert.equal(ancien.fs, f.pistes[0].frequenceHz);
  assert.equal(ancien.canaux, f.pistes[0].canaux);
  assert.equal(ancien.duree, f.dureeSec);
});

test('AIFF : fréquence en flottant 80 bits', () => {
  const f = lire(F.aiff({ nom: 'Lagon bleu' }));
  assert.equal(f.pistes[0].frequenceHz, 44100);
  assert.equal(f.dureeSec, 1);
  assert.equal(v(f, 'titre'), 'Lagon bleu');
});

test('ficheEnLignes rend les lignes « Nom : valeur »', () => {
  const l = ficheEnLignes(lire(F.mp3Id3({ version: 3, trames: tramesLagon() })), { detail: 'court' });
  for (const x of ['Artiste : Awa Saïd', 'Compositeur : Saïd Ali', 'Label : Label Ylang', 'Distributeur : Ylang Distribution']) assert.ok(l.includes(x), x);
});
