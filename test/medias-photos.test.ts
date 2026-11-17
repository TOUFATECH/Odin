// Médias reçus : les métadonnées des photos (fichiers fabriqués octet par octet ; coordonnées d'essai).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lireMetadonnees, ficheEnTexte } from '../src/medias/metadonnees.ts';
import { lirePhoto } from '../src/valhalla/hlin/exif.ts';
import * as F from './medias-fabriquer.ts';

const DATE = '2026:08:14 17:32:05';
const base = { date: DATE, marque: 'Fairphone', modele: 'FP5', lat: -12.7806, lon: 45.2275 };
const lire = (b: Buffer, nom?: string) => lireMetadonnees({ octets: b, nom });
const champ = (f: ReturnType<typeof lire>, cle: string) => f.champs.find((c) => c.cle === cle);

test('JPEG EXIF : date de prise de vue sans fuseau', () => {
  const f = lire(F.jpegExif(base));
  assert.equal(f.illisible, undefined);
  assert.equal(f.dates[0].role, 'prise de vue');
  assert.equal(f.dates[0].iso, '2026-08-14T17:32:05');
  assert.equal(f.dates[0].fuseauSource, 'inconnu');
  assert.equal(champ(f, 'date_prise_de_vue')?.sensible, true);
  assert.equal(champ(f, 'appareil_marque')?.valeur, 'Fairphone');
  assert.equal(champ(f, 'appareil_modele')?.valeur, 'FP5');
  // La date de modification n'est jamais une prise de vue.
  assert.ok(f.dates.some((d) => d.role === 'modification'));
});

test('JPEG EXIF : fuseau donné par OffsetTimeOriginal, ou déduit du GPS', () => {
  const a = lire(F.jpegExif({ ...base, offset: '+03:00' }));
  assert.equal(a.dates[0].fuseauSource, 'fichier');
  assert.equal(a.dates[0].fuseau, '+03:00');
  assert.equal(a.dates[0].utc, '2026-08-14T14:32:05Z');
  const b = lire(F.jpegExif({ ...base, gpsDate: '2026:08:14', gpsHeure: [14, 32, 0] }));
  assert.equal(b.dates[0].fuseau, '+03:00');
  assert.equal(b.dates[0].fuseauSource, 'déduit du GPS');
  assert.equal(b.position?.fiabilite, 'probable');
});

test('JPEG EXIF : position, geo:, GeoJSON, altitude', () => {
  const f = lire(F.jpegExif(base));
  assert.equal(f.position?.lat, -12.7806);
  assert.equal(f.position?.lon, 45.2275);
  assert.equal(f.position?.geo, 'geo:-12.780600,45.227500');
  assert.deepEqual(f.position?.geojson.geometry.coordinates, [45.2275, -12.7806]);
  assert.match(f.position!.enClair, /^12° 46′ 50,2″ S, 45° 13′ 39,0″ E/);
  const g = lire(F.jpegExif({ ...base, alt: 35 }));
  assert.equal(g.position?.altitudeM, 35);
  assert.equal(g.position?.geo, 'geo:-12.780600,45.227500,35');
});

test('JPEG EXIF : positions refusées (0 ; 0, dénominateur nul) et position ancienne', () => {
  const z = lire(F.jpegExif({ ...base, lat: 0, lon: 0 }));
  assert.equal(z.position, undefined);
  assert.ok(z.manque.some((m) => m.raison.includes('0 ; 0')));
  const d = lire(F.jpegExif({ ...base, gpsDenNul: true }));
  assert.equal(d.position, undefined);
  assert.ok(d.manque.some((m) => m.quoi === 'la position'));
  const v = lire(F.jpegExif({ ...base, gpsDate: '2026:08:11', gpsHeure: [14, 32, 0] }));
  assert.equal(v.position?.fiabilite, 'douteuse');
  assert.equal(v.dates[0].fuseauSource, 'inconnu');
});

test('JPEG EXIF : orientation, retouche, numéro de série, réglages', () => {
  const f = lire(F.jpegExif({ ...base, orientation: 6, largeur: 640, hauteur: 480, logiciel: 'Adobe Photoshop 25.0', serie: 'SN-0042', reglages: true }));
  assert.equal(f.orientation?.code, 6);
  assert.equal(f.largeur, 480); assert.equal(f.hauteur, 640);
  assert.ok(f.remarques.some((r) => r.includes('retouche possible')));
  assert.equal(champ(f, 'numero_serie_boitier')?.sensible, true);
  assert.equal(champ(f, 'exposition')?.valeur, '1/250 s');
  assert.equal(champ(f, 'ouverture')?.valeur, 'f/2,8');
  assert.equal(champ(f, 'iso')?.valeur, '100');
  assert.equal(champ(f, 'focale')?.valeur, '4,2 mm');
  assert.equal(champ(f, 'flash')?.valeur, 'non déclenché (désactivé)');
  assert.equal(champ(f, 'correction')?.valeur, '+0,3 EV');
});

test('XMP (titre en deux langues) et IPTC', () => {
  const xmp = F.xmpPaquet('<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Lagon bleu</rdf:li><rdf:li xml:lang="fr">Lagon bleu</rdf:li><rdf:li xml:lang="en">Blue lagoon</rdf:li></rdf:Alt></dc:title>'
    + '<dc:subject><rdf:Bag><rdf:li>mer</rdf:li><rdf:li>lagon</rdf:li></rdf:Bag></dc:subject>', 'photoshop:City="Mamoudzou"');
  const f = lire(F.jpegExif({ ...base, xmp, iptc: [[2, 80, 'Awa Saïd'], [2, 5, 'Lagon bleu']] }));
  const t = f.champs.filter((c) => c.cle === 'titre');
  assert.equal(t[0].valeur, 'Lagon bleu');
  assert.equal(t[0].langue, 'fr');
  assert.deepEqual(t[0].valeurs, ['Lagon bleu', 'Blue lagoon']);
  assert.ok(t[0].source.includes('XMP') && t[0].source.includes('IPTC:2:5'));
  assert.deepEqual(champ(f, 'mots_cles')?.valeurs, ['mer', 'lagon']);
  assert.equal(champ(f, 'artiste')?.valeur, 'Awa Saïd');
  assert.equal(champ(f, 'artiste')?.source, 'IPTC:2:80');
  assert.equal(champ(f, 'ville')?.sensible, true);
});

test('PNG : tEXt, iTXt XMP, eXIf, tIME (jamais une prise de vue)', () => {
  const tiff = F.tiffPhoto(base);
  const f = lire(F.pngTextes({ textes: [['tEXt', 'Author', 'Awa Saïd'.normalize('NFC').replace('ï', 'i')], ['zTXt', 'Comment', 'Vue du port']], xmp: F.xmpPaquet('', 'xmp:CreatorTool="Odin essai"'), exif: tiff, temps: [2026, 8, 15, 9, 0, 0] }));
  assert.equal(champ(f, 'artiste')?.valeur, 'Awa Said');
  assert.equal(champ(f, 'commentaire')?.valeur, 'Vue du port');
  assert.equal(champ(f, 'logiciel')?.valeur, 'Odin essai');
  assert.equal(champ(f, 'appareil_modele')?.valeur, 'FP5');
  assert.equal(f.position?.lat, -12.7806);
  const mod = f.champs.filter((c) => c.cle === 'date_modification');
  assert.ok(mod.some((c) => c.source === 'PNG:tIME'));
  assert.ok(!f.champs.some((c) => c.cle === 'date_prise_de_vue' && c.source === 'PNG:tIME'));
  assert.equal(f.largeur, 64);
  // eXIf avec le préfixe « Exif\0\0 » aussi.
  assert.equal(lire(F.pngTextes({ exif: tiff, exifPrefixe: true })).position?.lon, 45.2275);
});

test('WebP (VP8X + EXIF), HEIC (irot), GIF animé', () => {
  const w = lire(F.webp({ largeur: 320, hauteur: 200, exif: F.tiffPhoto(base) }));
  assert.equal(w.largeur, 320); assert.equal(w.hauteur, 200);
  assert.equal(champ(w, 'appareil_marque')?.valeur, 'Fairphone');
  const h = lire(F.heic({ largeur: 4032, hauteur: 3024, irot: 1, exif: F.tiffPhoto(base) }));
  assert.equal(h.nature.format, 'heic');
  assert.equal(h.orientation?.texte, 'tournée de 270° (sens horaire)');
  assert.equal(h.largeur, 3024); assert.equal(h.hauteur, 4032);
  assert.equal(h.dates[0].iso, '2026-08-14T17:32:05');
  assert.equal(h.position?.lat, -12.7806);
  const g = lire(F.gif({ images: 3, delai: 10, boucle: true }));
  assert.match(champ(g, 'animation')!.valeur, /^3 images, 0,3 s/);
});

test('même lecture que le lecteur EXIF existant d\'Odin (Hélios / Gygès)', () => {
  const b = F.jpegExif(base);
  const ancien = lirePhoto(b).exif;
  const f = lire(b);
  assert.equal(ancien.marque, champ(f, 'appareil_marque')?.valeur);
  assert.equal(ancien.modele, champ(f, 'appareil_modele')?.valeur);
  assert.ok(Math.abs((ancien.lat ?? 0) - f.position!.lat) < 1e-5);
  assert.ok(Math.abs((ancien.lon ?? 0) - f.position!.lon) < 1e-5);
  const d = ancien.date ?? '';
  assert.equal(`${d.slice(0, 4)}-${d.slice(5, 7)}-${d.slice(8, 10)}T${d.slice(11, 19)}`, f.dates[0].iso);
});

test('ficheEnTexte : la forme imposée, sensibles masqués par défaut', () => {
  const f = lire(F.jpegExif(base), 'photo.jpg');
  const montre = ficheEnTexte(f, { sensibles: 'montrer' });
  assert.ok(montre.startsWith('Photo JPEG · '), montre);
  assert.ok(montre.includes('- Pris le : 14/08/2026 à 17:32 (fuseau inconnu)'));
  assert.ok(montre.includes('- Position : 12° 46′ 50,2″ S, 45° 13′ 39,0″ E (−12,780600 ; 45,227500)'));
  assert.ok(montre.includes('- Appareil : Fairphone FP5'));
  assert.ok(montre.includes('Ce qui manque\n- Réglages de prise de vue : absent du fichier.'));
  const cache = ficheEnTexte(f);
  assert.ok(cache.includes('- Lieu : présent dans le fichier (gardé sur la machine)'));
  assert.ok(cache.includes('- Pris le : 14/08/2026'));
  assert.ok(!cache.includes('17:32'));
  assert.ok(!cache.includes('12,78'));
});

test('photo sans métadonnées : le manque est dit, sans soupçon', () => {
  const f = lire(F.jpegNu());
  assert.ok(f.manque.some((m) => m.code === 'retire-probable' && m.raison.includes('messageries')));
});
