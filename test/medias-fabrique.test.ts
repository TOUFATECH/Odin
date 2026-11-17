// Médias reçus : la fabrique des briques regarde ce qui existe sur la machine, ne télécharge rien, n'installe rien,
// n'appelle aucun réseau et n'écrit rien dans le dossier d'Odin. Les briques qui dépendent d'un programme facultatif
// (FFmpeg, Tesseract) ne sont vérifiées que si le programme est là ; sinon l'essai le dit.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { hasCommand } from '../src/learn/environment.ts';
import { creerNature } from '../src/medias/reconnaitre.ts';
import { briquesDisponibles } from '../src/medias/fabrique.ts';
import * as F from './medias-fabriquer.ts';

let home = '', temp = '';
const fetchOrigine = globalThis.fetch;
before(() => {
  home = mkdtempSync(join(tmpdir(), 'odin-medias-'));
  temp = mkdtempSync(join(tmpdir(), 'odin-medias-'));
  globalThis.fetch = (() => { throw new Error('la fabrique ne doit appeler aucun réseau'); }) as typeof fetch;
});
after(() => { globalThis.fetch = fetchOrigine; rmSync(home, { recursive: true, force: true }); rmSync(temp, { recursive: true, force: true }); });

test('home vide : ne lève pas, n\'écrit rien dans home, dit ce qui manque', async () => {
  const b = await briquesDisponibles({ home, dossierTemp: temp });
  assert.deepEqual(readdirSync(home), []);
  assert.ok(!b.transcrire, 'pas de Whisper dans un home vide');
  assert.ok(b.absentes.some((m) => m.code === 'transcription'));
  assert.ok(b.absentes.some((m) => m.code === 'traduction'));
  assert.ok(b.reconnaitreLangue);
  assert.ok(b.lireDocument);
  assert.ok(b.detecterConsignes);
  assert.equal(b.reconnaitreLangue!('Bonjour à tous, nous allons visiter le marché couvert de Mamoudzou ce matin.').langue, 'fr');
});

test('lireDocument natif : docx et texte', async () => {
  const b = await briquesDisponibles({ home, dossierTemp: temp });
  const d = await b.lireDocument!(F.docxMinimal(), creerNature('docx'), {});
  assert.ok(d.texte.includes('Bonjour'));
  const t = await b.lireDocument!(F.texte('utf-8', 'Habari za asubuhi'), creerNature('texte', { encodage: { nom: 'utf-8', bom: false, sur: true } }), {});
  assert.equal(t.texte, 'Habari za asubuhi');
});

test('traduction : seulement si elle est donnée, telle quelle', async () => {
  const traduire = async (t: string) => t.toUpperCase();
  const b = await briquesDisponibles({ home, dossierTemp: temp, traduire });
  assert.equal(b.traduire, traduire);
  assert.ok(!b.absentes.some((m) => m.code === 'traduction'));
});

test('briques FFmpeg : présentes seulement si FFmpeg existe', async (t) => {
  const b = await briquesDisponibles({ home, dossierTemp: temp });
  if (!hasCommand('ffmpeg')) {
    t.diagnostic('FFmpeg absent : vérifié que ses briques manquent et que le manque est dit');
    assert.ok(!b.extraireSon && !b.imagesCles && !b.convertirImage);
    assert.ok(b.absentes.some((m) => m.code === 'ffmpeg'));
    return;
  }
  t.diagnostic('FFmpeg présent : extraireSon, imagesCles, convertirImage, extraireSousTitresInclus fabriquées');
  assert.ok(b.extraireSon && b.imagesCles && b.convertirImage && b.extraireSousTitresInclus);
  // Un vrai PNG 8×8 (lignes RVB complètes) fabriqué octet par octet.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    F.chunkPng('IHDR', Buffer.concat([F.u32be(8), F.u32be(8), Buffer.from([8, 2, 0, 0, 0])])),
    F.chunkPng('IDAT', deflateSync(Buffer.alloc((8 * 3 + 1) * 8, 0x80))), F.chunkPng('IEND', Buffer.alloc(0))]);
  const j = await b.convertirImage!({ octets: png, format: 'png' }, {});
  assert.equal(j.format, 'jpeg');
  assert.deepEqual([...j.octets.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.deepEqual(readdirSync(temp).filter((x) => x.startsWith('brique-')), [], 'fichiers temporaires supprimés');
});

test('Tesseract : présent seulement s\'il est installé, et désactivable', async (t) => {
  const b = await briquesDisponibles({ home, dossierTemp: temp, tesseract: false });
  assert.ok(!b.lireTexteImage, 'Tesseract désactivé et aucun poids de Théia dans un home vide');
  assert.ok(b.absentes.some((m) => m.code === 'ocr'));
  if (!hasCommand('tesseract')) { t.diagnostic('Tesseract absent sur cette machine : la lecture de texte d\'image avec Tesseract n\'est pas essayée'); return; }
  const c = await briquesDisponibles({ home, dossierTemp: temp });
  assert.ok(c.lireTexteImage);
});
