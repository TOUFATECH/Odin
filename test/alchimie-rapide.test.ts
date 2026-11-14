// Alchimie en 4 clics (panneau près d'Odin) : formats proposés et tailles estimées, qualité, rognage, date de prise
// (pur), puis pour de vrai : fichiers vérifiés par l'antivirus, image PNG → JPG avec la date gardée et le cadre rogné,
// conversions récentes, fichier joint dans la Discussion, et le mode sans IA (« convertis ce fichier en PDF »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { cadre, choixPour, dateExif, estimer, jpegAvecDate, nomRecette, qualiteDe, taillePropre } from '../src/valhalla/dvalinn/rapide.ts';
import { plan } from '../src/valhalla/dvalinn/plan.ts';
import { CLICK_CATALOG, DEFAULT_CLICKS2 } from '../src/valhalla/clics.ts';
import { filtreHeif, lireHeif } from '../src/valhalla/dvalinn/heic.ts';
import { fileURLToPath } from 'node:url';

test('Alchimie rapide : tuiles, estimations, qualité, rognage, date (pur)', () => {
  const c = choixPour([{ nom: 'IMG_1.heic', taille: 3.8e6 }, { nom: 'IMG_2.heic', taille: 3.8e6 }], [['png', 'jpg', 'webp', 'avif', 'gif', 'pdf'], ['png', 'jpg', 'webp', 'avif', 'gif', 'pdf']]);
  assert.deepEqual(c.tuiles.map((t) => t.format), ['jpg', 'png', 'webp', 'pdf'], 'JPG, PNG, WEBP, PDF en tuiles (comme la maquette)');
  assert.deepEqual(c.tuiles.map((t) => t.desc), ['Pour tout le monde', 'Sans perte', 'Le plus léger', 'Un seul document']);
  assert.equal(c.tuiles[0].estim, '≈ 1,1 Mo chacune'); assert.equal(c.tuiles[3].estim, '1 fichier', 'plusieurs photos → un seul PDF');
  assert.deepEqual(c.autres.map((x) => x.label), ['AVIF', 'GIF']); assert.equal(c.defaut, 'jpg');
  assert.deepEqual(c.options, { qualite: true, date: true, rogner: true });
  const d = choixPour([{ nom: 'devis.docx', taille: 50e3 }], [['pdf', 'odt', 'rtf', 'txt', 'html', 'md']]);
  assert.deepEqual(d.tuiles.map((t) => t.format), ['pdf', 'odt', 'txt', 'rtf']); assert.deepEqual(d.options, { qualite: false, date: false, rogner: false });
  assert.equal(choixPour([{ nom: 'a.png', taille: 1 }, { nom: 'b.mp3', taille: 1 }], [['jpg', 'pdf'], ['wav']]).tuiles.length, 0, 'rien en commun : pas de tuile');
  assert.ok(estimer('a.png', 1e6, 'webp', 60) < estimer('a.png', 1e6, 'webp', 95), 'la qualité change l\'estimation');
  assert.equal(estimer('a.xyz', 1e6, 'jpg'), 0);
  assert.equal(taillePropre(11.4e6), '11 Mo'); assert.equal(taillePropre(1.1e6), '1,1 Mo'); assert.equal(taillePropre(800), '1 ko');
  assert.equal(qualiteDe(95), 'haute'); assert.equal(qualiteDe(85), 'normale'); assert.equal(qualiteDe(50), 'legere');
  assert.deepEqual(cadre(400, 300, 'carre'), { w: 300, h: 300 }); assert.deepEqual(cadre(1920, 1000, '16:9'), { w: 1777, h: 999 });
  assert.deepEqual(cadre(300, 400, '4:3'), { w: 300, h: 400 }, 'une photo en hauteur garde un cadre en hauteur'); assert.equal(cadre(10, 10, 'rond'), undefined);
  assert.equal(nomRecette('IMG_1.heic', 'jpg'), 'Photos → JPG'); assert.equal(nomRecette('devis.docx', 'pdf'), 'Word → PDF'); assert.equal(nomRecette('film.mov', 'mp4', 'legere'), 'Vidéo → MP4 léger');
  assert.equal(dateExif('2025:07:14 09:30:05')?.getHours(), 9); assert.equal(dateExif('n\'importe quoi'), undefined);
  // la date seule dans le JPEG : en-tête EXIF juste après le début du fichier, rien d'autre
  const j = jpegAvecDate(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), new Date(2025, 6, 14, 9, 30, 5));
  assert.equal(j.subarray(0, 4).toString('hex'), 'ffd8ffe1'); assert.ok(j.includes(Buffer.from('Exif\0\0', 'binary'))); assert.equal(j.toString('latin1').split('2025:07:14 09:30:05').length - 1, 3);
  assert.ok(!/GPS|Make|Model/.test(j.toString('latin1')));
  assert.throws(() => jpegAvecDate(Buffer.from('pas une image'), new Date()), /JPEG/);
  // recettes d'image : redressée, rognée au centre, qualité précise
  const p = plan('/x/a.heic', 'jpg', '/o', { pct: 85, cadre: { w: 300, h: 300 } }).args.join(' ');
  assert.match(p, /-auto-orient -gravity center -crop 300x300\+0\+0 \+repage .*-quality 85 -strip \/o\/a\.jpg/);
  // 4 clics : Alchimie, tout de suite, sans question
  assert.equal(DEFAULT_CLICKS2['4'], 'alchimie'); assert.equal(CLICK_CATALOG.find((a) => a.id === 'alchimie')?.grave, false);
});

const sh = (cmd: string, args: string[], o: { timeoutMs?: number } = {}) => new Promise<{ code: number; out: string; err: string }>((ok) => execFile(cmd, args, { timeout: o.timeoutMs ?? 120000, maxBuffer: 1 << 24 }, (e, out, err) => ok({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out: String(out), err: String(err) })));
const has = async (c: string) => (await sh('sh', ['-c', `command -v ${c}`])).code === 0;
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

test('Alchimie rapide : pour de vrai (antivirus, PNG → JPG daté et rogné, récentes, fichier joint, sans IA)', { timeout: 180000 }, async (t) => {
  const im = (await has('magick')) || (await has('convert'));
  const home = mkdtempSync(join(tmpdir(), 'alchimie-rapide-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: join(home, 'workspace') }, cfg: DEFAULT_CONFIG } as never), { run: (c, a, o) => sh(c, a, o), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const at = join(v.ctx('dvalinn').dir, 'atelier'); mkdirSync(at, { recursive: true });
  try {
    // L'antivirus d'abord : le fichier d'essai des antivirus est refusé, laissé là, jamais ouvert.
    writeFileSync(join(at, 'outil.txt'), EICAR);
    let r = await v.act('dvalinn', 'preparer', { fichiers: 'atelier:outil.txt' }); assert.equal(r.ok, false); assert.match(r.text, /outil\.txt : fichier suspect .* je ne le convertis pas/, r.text);
    r = await v.act('dvalinn', 'convertir', { fichier: 'atelier:outil.txt', format: 'pdf' }); assert.equal(r.ok, false); assert.match(r.text, /Fichier suspect/);
    assert.ok(existsSync(join(at, 'outil.txt')) && !existsSync(join(at, 'outil.pdf')));
    assert.match((await v.act('dvalinn', 'preparer', { fichiers: 'atelier:absent.png' })).text, /introuvable/);
    if (!im) { t.diagnostic('ImageMagick absent : conversions d\'images sautées'); return; }
    // Deux vraies images (une photo en paysage) : préparées, vérifiées, puis converties en JPG.
    await sh('convert', ['-size', '400x300', 'gradient:#8DB3C9-#34505F', join(at, 'IMG_2031.png')]);
    await sh('convert', ['-size', '200x200', 'plasma:fractal', join(at, 'IMG_2032.png')]);
    r = await v.act('dvalinn', 'preparer', { fichiers: 'atelier:IMG_2031.png,atelier:IMG_2032.png', qualite: 85 });
    assert.notEqual(r.ok, false, r.text); assert.match(r.text, /2 fichier\(s\) · PNG · .* · vérifiés par Asclépios/);
    const d = r.data as { tuiles: Array<{ format: string }>; fichiers: Array<{ ref: string }>; antivirus: string };
    assert.deepEqual(d.tuiles.map((x) => x.format), ['jpg', 'webp', 'pdf', 'avif'], 'un PNG ne se propose pas en PNG');
    assert.equal(d.antivirus, 'sain');
    const prise = new Date(2025, 6, 14, 9, 30, 5); const { utimesSync } = await import('node:fs'); utimesSync(join(at, 'IMG_2031.png'), prise, prise);
    r = await v.act('dvalinn', 'convertir', { fichier: d.fichiers[0].ref, format: 'jpg', qualite: 85, garder_date: true, rogner: 'carre' });
    assert.notEqual(r.ok, false, r.text); assert.match(r.text, /✅ IMG_2031\.png → IMG_2031\.jpg/);
    const jpg = join(at, 'IMG_2031.jpg'), b = readFileSync(jpg);
    assert.equal(b.subarray(0, 3).toString('hex'), 'ffd8ff', 'un vrai JPEG');
    assert.equal((await sh('identify', ['-format', '%w %h', jpg])).out, '300 300', 'rogné en carré au centre');
    assert.match((await sh('identify', ['-format', '%[EXIF:DateTimeOriginal]', jpg])).out, /^2025:07:14 09:30:05/, 'la date de prise est gardée');
    assert.equal(Math.round(statSync(jpg).mtimeMs / 1000), Math.round(prise.getTime() / 1000), 'et la date du fichier aussi');
    const data = r.data as { avant: number; apres: number; sorties: string[] }; assert.ok(data.avant > 0 && data.apres > 0); assert.deepEqual(data.sorties, ['atelier:IMG_2031.jpg']);
    // Plusieurs photos → un seul PDF (images → PDF).
    r = await v.act('dvalinn', 'pdf', { operation: 'images_en_pdf', fichiers: d.fichiers.map((x) => x.ref).join(',') }); assert.notEqual(r.ok, false, r.text);
    // Les conversions récentes, à refaire : la même sorte vers le même format remonte en tête, sans doublon.
    r = await v.act('dvalinn', 'convertir', { fichier: d.fichiers[1].ref, format: 'jpg', qualite: 70 }); assert.notEqual(r.ok, false, r.text);
    const rec = (await v.act('dvalinn', 'recentes')).data as Array<{ titre: string; vers: string; qualite?: number }>;
    assert.deepEqual(rec.map((x) => x.titre), ['Images → JPG', 'Images → PDF']); assert.equal(rec[0].qualite, 70);
    // Une vraie photo HEIC d'iPhone (grille de 2 × 2 tuiles HEVC, date de prise dans l'Exif) → JPG, même sans décodeur HEVC dans ImageMagick.
    const fab = fileURLToPath(new URL('./banc/faire-heic.py', import.meta.url));
    if ((await sh('python3', [fab, join(at, 'IMG_2033.heic'), '640', '480', 'grille', '2025:07:14 09:30:05'])).code === 0) {
      const h = lireHeif(readFileSync(join(at, 'IMG_2033.heic')));
      assert.deepEqual([h.colonnes, h.lignes, h.largeur, h.hauteur, h.date], [2, 2, 620, 470, '2025:07:14 09:30:05']); assert.equal(filtreHeif(h), 'tile=2x2,crop=620:470:0:0');
      assert.equal(filtreHeif({ ...h, rotation: 90 }), 'tile=2x2,crop=620:470:0:0,transpose=2');
      r = await v.act('dvalinn', 'preparer', { fichiers: 'atelier:IMG_2033.heic' }); assert.match(r.text, /HEIC/); assert.equal((r.data as { tuiles: Array<{ format: string }> }).tuiles[0].format, 'jpg');
      r = await v.act('dvalinn', 'convertir', { fichier: 'atelier:IMG_2033.heic', format: 'jpg', qualite: 85, garder_date: true }); assert.notEqual(r.ok, false, r.text);
      const hj = join(at, 'IMG_2033.jpg'); assert.equal(readFileSync(hj).subarray(0, 3).toString('hex'), 'ffd8ff');
      assert.equal((await sh('identify', ['-format', '%w %h', hj])).out, '620 470', 'les tuiles assemblées, coupées à la taille de la photo');
      assert.match((await sh('identify', ['-format', '%[EXIF:DateTimeOriginal]', hj])).out, /^2025:07:14 09:30:05/, 'la date de prise de la photo HEIC est gardée');
      assert.throws(() => lireHeif(Buffer.from('pas une photo')), /HEIC/);
    } else t.diagnostic('python3 ou libx265 absent : photo HEIC non essayée');
    // Un fichier joint dans la Discussion (inbox/…) : « Odin, convertis ce fichier en PDF ».
    const inbox = join(home, 'workspace', 'inbox'); mkdirSync(inbox, { recursive: true }); await sh('convert', ['-size', '120x80', 'xc:#4F7FF0', join(inbox, 'recu.png')]);
    r = await v.act('dvalinn', 'convertir', { fichier: 'inbox/recu.png', format: 'pdf' }); assert.notEqual(r.ok, false, r.text); assert.ok(existsSync(join(inbox, 'recu.pdf')), 'le résultat est écrit à côté du fichier joint');
    // Sans IA (Logos) : la phrase et le fichier joint arrivent chez Alchimie, le format est compris (« en JPG »).
    const o = await v.order('Odin, convertis ce fichier en JPG\n\n[Fichier reçu : inbox/recu.png (image/png, 1 Ko)]', 'essai-1');
    assert.match(o.text, /Alchimie · Convertir un fichier/, o.text); assert.ok(existsSync(join(inbox, 'recu.jpg')), o.text);
    assert.match((await v.order('convertis ce fichier en PDF', 'essai-2')).text, /il me manque « Fichier »/, 'sans fichier : Alchimie le demande');
    for (const [k, phrase] of ['il fait beau à Mamoudzou', 'mon fils a de la fièvre', 'on se voit en juin'].entries()) assert.doesNotMatch((await v.order(phrase, `banal-${k}`)).text, /Alchimie/, phrase);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
