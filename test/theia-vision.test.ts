// Théia — cœur de vision (Lot A). Essais du calcul pur : décodage PNG natif (y compris le refus d'un en-tête démesuré
// AVANT allocation), mesures « sans modèle », et ouverture de l'œil (dégradé sans poids ; plongement L2 avec un petit
// poids synthétique écrit au format safetensors maison). Aucun service réel, aucun vrai modèle téléchargé.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decoderImage, redimensionner, normaliser } from '../src/vision/image.ts';
import { voirSansModele, distanceEmpreinte } from '../src/vision/sansmodele.ts';
import { ouvrirOeil } from '../src/vision/oeil.ts';
import type { ImageDecodee } from '../src/vision/index.ts';

// ---------- Fabrique d'un PNG minuscule (le décodeur ne vérifie pas le CRC : on met des zéros) ----------

function morceau(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

function fabriquerPng(w: number, h: number, rgba: Uint8Array): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  const brut = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    brut[y * (1 + w * 4)] = 0; // filtre None
    Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)).copy(brut, y * (1 + w * 4) + 1);
  }
  return Buffer.concat([sig, morceau('IHDR', ihdr), morceau('IDAT', deflateSync(brut)), morceau('IEND', Buffer.alloc(0))]);
}

// ---------- NOYAU 1 : décodage PNG + bornes ----------

test('decoderImage : PNG minuscule rendu fidèlement', () => {
  const rgba = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 0, 255,
  ]);
  const png = fabriquerPng(2, 2, rgba);
  const img = decoderImage(png, 'petit.png');
  assert.equal(img.largeur, 2);
  assert.equal(img.hauteur, 2);
  assert.equal(img.rgba.length, 2 * 2 * 4);
  assert.deepEqual([...img.rgba], [...rgba]);
});

test('decoderImage : PNG aux dimensions démesurées refusé AVANT allocation', () => {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2_000_000, 0); ihdr.writeUInt32BE(2_000_000, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([sig, morceau('IHDR', ihdr)]);
  assert.throws(() => decoderImage(png, 'enorme.png'), /démesurée|trop grande/);
});

test('decoderImage : format inconnu lève ErreurFormatNonNatif', () => {
  const faux = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
  assert.throws(() => decoderImage(faux, 'image.heic'), /non lisible nativement/);
});

test('redimensionner et normaliser produisent les bonnes tailles', () => {
  const img = decoderImage(fabriquerPng(2, 2, new Uint8Array(16).fill(128)), 'g.png');
  const petit = redimensionner(img, 4);
  assert.equal(petit.largeur, 4);
  assert.equal(petit.rgba.length, 4 * 4 * 4);
  const chw = normaliser(petit, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
  assert.equal(chw.length, 3 * 4 * 4);
});

// ---------- NOYAU 2 : voir sans modèle ----------

test('voirSansModele : deux images identiques → distance d\'empreinte 0', () => {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) { rgba[i * 4] = (i * 4) % 256; rgba[i * 4 + 1] = (i * 7) % 256; rgba[i * 4 + 2] = (i * 11) % 256; rgba[i * 4 + 3] = 255; }
  const img = decoderImage(fabriquerPng(8, 8, rgba), 'a.png');
  const a = voirSansModele(img);
  const b = voirSansModele(img);
  assert.equal(distanceEmpreinte(a.empreinte, b.empreinte), 0);
});

test('voirSansModele : image noire → luminosité basse', () => {
  const noir = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < 64; i++) noir[i * 4 + 3] = 255;
  const img = decoderImage(fabriquerPng(8, 8, noir), 'noir.png');
  const s = voirSansModele(img);
  assert.ok(s.luminosite < 0.05, `luminosité attendue basse, obtenue ${s.luminosite}`);
});

test('voirSansModele : bande de texte synthétique → zonesTexte > 0', () => {
  const w = 96, h = 48;
  const rgba = new Uint8Array(w * h * 4).fill(255); // fond blanc
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = 255;
  // Bande centrale de colonnes alternées noir/blanc (contours marqués, comme du texte).
  for (let y = 16; y < 32; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.floor(x / 3) % 2 === 0) {
        const o = (y * w + x) * 4; rgba[o] = 0; rgba[o + 1] = 0; rgba[o + 2] = 0;
      }
    }
  }
  const img = decoderImage(fabriquerPng(w, h, rgba), 'texte.png');
  const s = voirSansModele(img);
  assert.ok(s.zonesTexte > 0, `zonesTexte attendu > 0, obtenu ${s.zonesTexte}`);
});

test('voirSansModele : mouvement estimé entre deux images différentes', () => {
  const blanc = new Uint8Array(8 * 8 * 4).fill(255);
  const noir = new Uint8Array(8 * 8 * 4); for (let i = 0; i < 64; i++) noir[i * 4 + 3] = 255;
  const a = decoderImage(fabriquerPng(8, 8, blanc), 'b.png');
  const b = decoderImage(fabriquerPng(8, 8, noir), 'n.png');
  const s = voirSansModele(a, b);
  assert.ok((s.mouvement ?? 0) > 0.5, `mouvement attendu élevé, obtenu ${s.mouvement}`);
});

// ---------- NOYAU 3 : l'œil (dégradé sans poids, puis petit poids synthétique) ----------

test('ouvrirOeil : sans poids → pret=false, decrire essaye=false, lireTexte lue=false', async () => {
  const oeil = await ouvrirOeil();
  assert.equal(oeil.pret, false);
  assert.equal(oeil.modele, '');
  assert.equal(oeil.dim, 0);
  const img = decoderImage(fabriquerPng(2, 2, new Uint8Array(16).fill(10)), 'x.png');
  const d = await oeil.decrire(img, 'que vois-tu ?');
  assert.equal(d.essaye, false);
  const l = await oeil.lireTexte(img);
  assert.equal(l.lue, false);
  assert.equal(l.texte, '');
  const plong = await oeil.plongementImage(img);
  assert.equal(plong.length, 0);
});

// Écrit un fichier safetensors maison (en-tête JSON u64LE + tenseurs F32).
function ecrireSafetensors(chemin: string, tenseurs: Array<{ nom: string; dims: number[]; data: Float32Array }>, meta: Record<string, string>): void {
  const entete: Record<string, unknown> = { __metadata__: meta };
  let pos = 0;
  const morceaux: Buffer[] = [];
  for (const t of tenseurs) {
    const octets = Buffer.alloc(t.data.length * 4);
    for (let i = 0; i < t.data.length; i++) octets.writeFloatLE(t.data[i], i * 4);
    entete[t.nom] = { dtype: 'F32', shape: t.dims, data_offsets: [pos, pos + octets.length] };
    pos += octets.length; morceaux.push(octets);
  }
  const jsonEntete = Buffer.from(JSON.stringify(entete), 'utf8');
  const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(jsonEntete.length), 0);
  writeFileSync(chemin, Buffer.concat([len, jsonEntete, ...morceaux]));
}

// Fabrique un petit encodeur d'images ViT jouet (valeurs déterministes) pour exercer la passe avant.
function petitViT(): { tenseurs: Array<{ nom: string; dims: number[]; data: Float32Array }>; meta: Record<string, string> } {
  const dim = 8, ff = 16, patch = 8, image = 8; // grille 1×1 → T = 2
  const r = (n: number, g = 1): Float32Array => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin((i + 1) * g) * 0.1; return a; };
  const uns = (n: number): Float32Array => new Float32Array(n).fill(1);
  const zeros = (n: number): Float32Array => new Float32Array(n);
  const t: Array<{ nom: string; dims: number[]; data: Float32Array }> = [
    { nom: 'proj_patch.poids', dims: [dim, 3 * patch * patch], data: r(dim * 3 * patch * patch, 0.3) },
    { nom: 'proj_patch.biais', dims: [dim], data: r(dim, 0.7) },
    { nom: 'jeton_classe', dims: [dim], data: r(dim, 1.1) },
    { nom: 'pos', dims: [2, dim], data: r(2 * dim, 0.5) },
    { nom: 'bloc.0.ln1.poids', dims: [dim], data: uns(dim) },
    { nom: 'bloc.0.ln1.biais', dims: [dim], data: zeros(dim) },
    { nom: 'bloc.0.q.poids', dims: [dim, dim], data: r(dim * dim, 0.2) },
    { nom: 'bloc.0.q.biais', dims: [dim], data: zeros(dim) },
    { nom: 'bloc.0.k.poids', dims: [dim, dim], data: r(dim * dim, 0.25) },
    { nom: 'bloc.0.k.biais', dims: [dim], data: zeros(dim) },
    { nom: 'bloc.0.v.poids', dims: [dim, dim], data: r(dim * dim, 0.35) },
    { nom: 'bloc.0.v.biais', dims: [dim], data: zeros(dim) },
    { nom: 'bloc.0.sortie.poids', dims: [dim, dim], data: r(dim * dim, 0.4) },
    { nom: 'bloc.0.sortie.biais', dims: [dim], data: zeros(dim) },
    { nom: 'bloc.0.ln2.poids', dims: [dim], data: uns(dim) },
    { nom: 'bloc.0.ln2.biais', dims: [dim], data: zeros(dim) },
    { nom: 'bloc.0.ff1.poids', dims: [ff, dim], data: r(ff * dim, 0.15) },
    { nom: 'bloc.0.ff1.biais', dims: [ff], data: zeros(ff) },
    { nom: 'bloc.0.ff2.poids', dims: [dim, ff], data: r(dim * ff, 0.18) },
    { nom: 'bloc.0.ff2.biais', dims: [dim], data: zeros(dim) },
    { nom: 'ln_final.poids', dims: [dim], data: uns(dim) },
    { nom: 'ln_final.biais', dims: [dim], data: zeros(dim) },
  ];
  const meta = { dim: '8', profondeur: '1', tetes: '2', image: '8', patch: '8', moy: '0.48,0.46,0.41', ec: '0.27,0.26,0.28', nom: 'vit-jouet' };
  return { tenseurs: t, meta };
}

test('ouvrirOeil : petit poids image présent → plongement L2 ≈ 1 et dim cohérente', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'theia-'));
  try {
    const { tenseurs, meta } = petitViT();
    ecrireSafetensors(join(dossier, 'oeil-image.safetensors'), tenseurs, meta);
    const oeil = await ouvrirOeil({ cache: dossier });
    assert.equal(oeil.pret, true);
    assert.equal(oeil.dim, 8);
    assert.equal(oeil.modele, 'vit-jouet');
    const img: ImageDecodee = decoderImage(fabriquerPng(8, 8, remplirDegrade(8, 8)), 'd.png');
    const vec = await oeil.plongementImage(img);
    assert.equal(vec.length, 8);
    let norme = 0; for (let i = 0; i < vec.length; i++) norme += vec[i] * vec[i];
    norme = Math.sqrt(norme);
    assert.ok(Math.abs(norme - 1) < 1e-3, `norme L2 attendue ≈ 1, obtenue ${norme}`);
    // Sans modèle image→texte, decrire reste honnête.
    const d = await oeil.decrire(img, 'décris');
    assert.equal(d.essaye, false);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

function remplirDegrade(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    rgba[o] = (x * 32) % 256; rgba[o + 1] = (y * 32) % 256; rgba[o + 2] = ((x + y) * 16) % 256; rgba[o + 3] = 255;
  }
  return rgba;
}
