// Médias reçus : une copie d'image sans métadonnées (rien de la position, de l'heure ni de l'appareil ne part avec
// elle), l'image elle-même intacte, l'orientation gardée.
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { test } from 'node:test';
import { lireMetadonnees } from '../src/medias/metadonnees.ts';
import { retirerMetadonnees } from '../src/medias/sans-metadonnees.ts';
import * as F from './medias-fabriquer.ts';

/** Les marqueurs de segments d'un JPEG, jusqu'à SOS. */
function marqueurs(b: Buffer): number[] {
  const r: number[] = [];
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) { const m = b[p + 1]; r.push(m); if (m === 0xda) break; p += 2 + b.readUInt16BE(p + 2); }
  return r;
}

test('JPEG EXIF + GPS + XMP + IPTC + commentaire → plus rien, orientation 6 gardée, image identique après SOS', () => {
  const avant = F.jpegExif({ date: '2026:08:14 17:32:05', marque: 'Fairphone', modele: 'FP5', lat: -12.7806, lon: 45.2275, orientation: 6, serie: 'SN-123',
    xmp: F.xmpPaquet('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Lagon</rdf:li></rdf:Alt></dc:title>'), iptc: [[2, 80, 'Awa Saïd']], commentaire: 'note privée' });
  const f0 = lireMetadonnees({ octets: avant });
  assert.ok(f0.position && f0.dates.length);
  const apres = retirerMetadonnees(avant)!;
  assert.ok(apres);
  const m = marqueurs(apres);
  assert.ok(!m.includes(0xed) && !m.includes(0xfe), 'APP13 ou COM restant');
  assert.equal(m.filter((x) => x === 0xe1).length, 1, 'un seul APP1 (EXIF minimal)');
  const f = lireMetadonnees({ octets: apres });
  assert.equal(f.position, undefined);
  assert.equal(f.dates.length, 0);
  assert.equal(f.champs.find((c) => c.cle === 'appareil_modele'), undefined);
  assert.equal(f.champs.find((c) => c.cle === 'numero_serie_boitier'), undefined);
  assert.equal(f.orientation?.code, 6);
  const sos = (b: Buffer) => b.subarray(b.indexOf(Buffer.from([0xff, 0xda])));
  assert.deepEqual(sos(apres), sos(avant));
});

test('JPEG sans orientation : aucun APP1 ajouté', () => {
  const apres = retirerMetadonnees(F.jpegExif({ date: '2026:08:14 17:32:05', lat: 48.8584, lon: 2.2945 }))!;
  assert.ok(!marqueurs(apres).includes(0xe1));
});

test('PNG : tEXt, iTXt, eXIf, tIME retirés, CRC valides', () => {
  const avant = F.pngTextes({ textes: [['tEXt', 'Author', 'Awa Saïd'], ['iTXt', 'Comment', 'privé']], exif: F.tiffPhoto({ lat: -12.7806, lon: 45.2275, date: '2026:08:14 17:32:05' }), temps: [2026, 8, 14, 17, 32, 5] });
  const apres = retirerMetadonnees(avant)!;
  const types: string[] = [];
  for (let p = 8; p + 12 <= apres.length;) {
    const L = apres.readUInt32BE(p), t = apres.toString('latin1', p + 4, p + 8);
    types.push(t);
    assert.equal(apres.readUInt32BE(p + 8 + L), crc32(apres.subarray(p + 4, p + 8 + L)) >>> 0, `CRC de ${t}`);
    p += 12 + L;
  }
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND']);
  const f = lireMetadonnees({ octets: apres });
  assert.equal(f.position, undefined);
  assert.equal(f.champs.find((c) => c.cle === 'artiste'), undefined);
});

test('WebP : EXIF et XMP retirés, drapeaux VP8X et taille RIFF à jour', () => {
  const avant = F.webp({ exif: F.tiffPhoto({ lat: -12.7806, lon: 45.2275 }), xmp: F.xmpPaquet('<dc:creator>Awa</dc:creator>') });
  const apres = retirerMetadonnees(avant)!;
  assert.equal(apres.readUInt32LE(4), apres.length - 8);
  assert.equal(apres.indexOf('EXIF'), -1);
  assert.equal(apres.indexOf('XMP '), -1);
  assert.equal(apres[20] & 0x0c, 0);
  assert.equal(lireMetadonnees({ octets: apres }).position, undefined);
});

test('autre format ou fichier malformé : undefined, jamais d\'exception', () => {
  assert.equal(retirerMetadonnees(F.gif()), undefined);
  assert.equal(retirerMetadonnees(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), undefined);
  assert.equal(retirerMetadonnees(Buffer.alloc(0)), undefined);
});
