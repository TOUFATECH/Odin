// Théia — essais de NON-RÉGRESSION des correctifs du relecteur. Chaque essai aurait attrapé le défaut d'origine :
//   - un JPEG à facteur d'échantillonnage 0 ne doit PAS figer la boucle (il est refusé proprement) ;
//   - un document abîmé/chiffré est « lu en partie », jamais une exception qui remonte ;
//   - un flux image FlateDecode démesuré (bombe zlib) est borné, pas alloué sans fin ;
//   - la mémoire d'images écrit en AJOUT (pas de réécriture complète à chaque image) et relit juste ;
//   - le contexte vidéo persiste en AJOUT (sidecar) et reprend après un arrêt ;
//   - la base THEIA_ODIN est bien enregistrée (migrable « theia »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decoderImage } from '../src/vision/index.ts';
import { imagesPagesPdf, lireDocument, lireOdf } from '../src/valhalla/theia/documents.ts';
import { MemoireImages, oublierMemoiresImages } from '../src/valhalla/theia/memoire-images.ts';
import { decrireParMorceaux, ajouterProgres, lireProgres, effacerProgres, sauverEtat } from '../src/valhalla/theia/video-contexte.ts';
import { brancherTheia, oublierBranchementsTheia } from '../src/valhalla/theia/base.ts';
import { lesMigrables } from '../src/valhalla/base/index.ts';
import type { Frame, Vision } from '../src/video/video.ts';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'theia-corr-')); }

// ------------------------------------------------------------------ Défaut #4 : JPEG, échantillonnage 0
test('decoderJpeg refuse un facteur d\'échantillonnage 0 (pas de boucle infinie)', () => {
  // SOI + SOF0 (16×16, 1 composante, octet d'échantillonnage 0x00). Avant le correctif : hmax=0 ⇒ mcuCols=Infinity.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x00, 0x00]);
  assert.throws(() => decoderImage(jpeg, 'jpg'), /échantillonnage invalide/);
});

// ------------------------------------------------------------------ Défaut #1 : document abîmé/chiffré
test('un .odt corrompu est « lu en partie », sans exception', () => {
  const bruit = Buffer.from('ceci-n-est-pas-un-zip-%%bruit%%'.repeat(10));
  const d = lireOdf(bruit, 'odt');
  assert.equal(d.lu, false);
  assert.equal(d.partiel, true);
  assert.match(d.via, /illisible|chiffré/);
});
test('lireDocument ne lève jamais sur une archive Office cassée', () => {
  const bruit = Buffer.from('PK\x03\x04 mais tronqué et sans répertoire central');
  assert.doesNotThrow(() => lireDocument(bruit, 'casse.odt'));
  assert.equal(lireDocument(bruit, 'casse.odt').lu, false);
});

// ------------------------------------------------------------------ Défaut #5/#6 : bombe zlib (PDF image)
test('imagesPagesPdf borne la décompression d\'un flux FlateDecode démesuré', () => {
  const gonfle = deflateSync(Buffer.alloc(4 * 1024 * 1024, 0)); // 4 Mo de zéros → se décompresse bien au-delà du plafond
  const dict = `<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /BitsPerComponent 8 /ColorSpace /DeviceGray /Filter /FlateDecode /Length ${gonfle.length} >>`;
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n7 0 obj\n' + dict + '\nstream\n', 'latin1'),
    gonfle,
    Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1'),
  ]);
  const imgs = imagesPagesPdf(pdf);
  // Le flux dépasse le plafond (4×4×1 octets) : il est ignoré, pas alloué (80 Mo en mémoire avant le correctif).
  assert.equal(imgs.length, 0);
});

// ------------------------------------------------------------------ Défaut #11 : mémoire d'images en AJOUT
test('MemoireImages écrit en ajout et relit juste (dernière ligne gagne)', () => {
  oublierMemoiresImages();
  const dir = tmp();
  try {
    const m = new MemoireImages(dir);
    for (let i = 0; i < 300; i++) m.ajouter(`img${i}`, `s${i}`, Float32Array.from([i, i + 1, i + 2]));
    assert.equal(m.taille, 300);
    m.ajouter('img5', 's5-bis', Float32Array.from([9, 9, 9])); // remplacement : la dernière ligne doit gagner
    // Relecture depuis le disque (nouvelle instance) : tout est là, et img5 est la version « bis ».
    const r = new MemoireImages(dir);
    assert.equal(r.taille, 300);
    const img5 = r.liste().find((e) => e.id === 'img5')!;
    // Vecteur [9,9,9] normalisé L2 → composantes égales et positives.
    assert.ok(img5.vecteur[0] > 0 && Math.abs(img5.vecteur[0] - img5.vecteur[1]) < 1e-6);
    assert.equal(img5.source, 's5-bis');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ Défaut #12 : contexte vidéo en AJOUT (sidecar)
test('le sidecar de progression s\'écrit en ajout, se relit et s\'efface', () => {
  const dir = tmp();
  try {
    ajouterProgres(dir, 'v1', [{ i: 0, seen: 'plan 0' }, { i: 1, seen: 'plan 1' }]);
    ajouterProgres(dir, 'v1', [{ i: 2, seen: 'plan 2' }]);
    const d = lireProgres(dir, 'v1');
    assert.equal(d.length, 3);
    assert.equal(d[2].seen, 'plan 2');
    effacerProgres(dir, 'v1');
    assert.equal(lireProgres(dir, 'v1').length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('decrireParMorceaux reprend d\'un sidecar sans redécrire les images déjà faites', async () => {
  const dir = tmp(), atelier = tmp();
  try {
    // 4 fausses images (la fausse vision ne lit pas leur contenu, mais lookFrames lit le fichier).
    const frames: Frame[] = [];
    for (let i = 0; i < 4; i++) { const f = join(atelier, `p${i}.jpg`); writeFileSync(f, Buffer.from([0xff, 0xd8])); frames.push({ t: i, file: f }); }
    // On pré-note les images 0 et 1 comme déjà faites, dans l'état plein ; et l'image 2 dans le sidecar incrémental.
    sauverEtat(dir, 'vid', { faits: [0, 1], frames: frames.map((f, i) => (i < 2 ? { ...f, seen: `deja ${i}` } : f)), fini: false });
    ajouterProgres(dir, 'vid', [{ i: 2, seen: 'sidecar 2' }]);
    let appels = 0;
    const vision: Vision = async (_q, imgs) => { appels += imgs.length; return '[0:00] vue\n'; };
    const res = await decrireParMorceaux({ cle: 'vid', frames, vision, dossierEtat: dir, parMorceau: 2 });
    assert.equal(res.fini, true);
    // Seule l'image 3 restait à décrire (0,1 pleins ; 2 dans le sidecar) : la vision n'a été appelée que pour 1 image.
    assert.equal(appels, 1);
    assert.equal(frames[2].seen, 'sidecar 2'); // reprise du delta, pas réécrit
    // Le plein état final est écrit et le sidecar effacé.
    assert.equal(lireProgres(dir, 'vid').length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(atelier, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ Défaut #2 : base THEIA_ODIN enregistrée
test('brancherTheia enregistre le migrable « theia » (sinon la base n\'est jamais créée)', () => {
  oublierBranchementsTheia();
  const dir = tmp();
  try {
    assert.equal(lesMigrables().some((m) => m.id === 'theia'), false);
    brancherTheia(dir);
    const m = lesMigrables().find((x) => x.id === 'theia');
    assert.ok(m, 'le migrable theia doit être inscrit');
    assert.equal(m!.nom, 'Théia');
    brancherTheia(dir); // idempotent : pas de double inscription (même id)
    assert.equal(lesMigrables().filter((x) => x.id === 'theia').length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
