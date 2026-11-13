// Dvalinn (conversion et PDF, comme VERT / BentoPDF / Stirling-PDF / Tdarr / IT-Tools) : recettes pures, boîte à
// outils, puis de vraies conversions avec les outils libres de la machine (sautées s'ils manquent).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { familyOf, pages, pdfPlan, plan, qpdfSecretArgs } from '../src/valhalla/dvalinn/plan.ts';
import { outil } from '../src/valhalla/dvalinn/outils.ts';

test('Dvalinn : recettes (pures)', () => {
  assert.equal(familyOf('a.MKV'), 'video'); assert.equal(familyOf('b.heic'), 'image'); assert.equal(familyOf('c.zip'), undefined);
  const v = plan('/x/film.mov', 'mp4', '/o', { codec: 'h265', qualite: 'legere', hauteur: 720 });
  assert.equal(v.cmd, 'ffmpeg'); assert.ok(v.args.includes('libx265') && v.args.includes('30') && v.args.includes('hvc1')); assert.equal(v.out, '/o/film.mp4');
  assert.ok(plan('/x/film.mp4', 'mp3', '/o').args.includes('-vn'));
  assert.match(plan('/x/clip.mp4', 'gif', '/o', { debut: '00:00:05', duree: '3' }).args.join(' '), /-ss 00:00:05 -i \/x\/clip\.mp4 -t 3 .*palettegen/);
  assert.equal(plan('/x/a.png', 'webp', '/o').cmd, 'magick'); assert.equal(plan('/x/a.png', 'webp', '/o').alt?.cmd, 'convert');
  assert.equal(plan('/x/r.docx', 'pdf', '/o').cmd, 'soffice'); assert.equal(plan('/x/n.md', 'docx', '/o').cmd, 'pandoc');
  assert.equal(plan('/x/d.pdf', 'txt', '/o').cmd, 'pdftotext');
  assert.throws(() => plan('/x/a.png', 'mp3', '/o'), /pas possible/); assert.throws(() => plan('/x/a.zip', 'pdf', '/o'), /inconnu/);
  assert.equal(pages('1-3, 5, 8-fin'), '1-3,5,8-z'); assert.throws(() => pages('1;rm -rf'), /invalides/);
  assert.deepEqual(pdfPlan('fusionner', ['/a.pdf', '/b.pdf'], '/o.pdf').args, ['--empty', '--pages', '/a.pdf', '/b.pdf', '--', '/o.pdf']);
  assert.throws(() => pdfPlan('fusionner', ['/a.pdf'], '/o.pdf'), /deux/);
  assert.equal(pdfPlan('proteger', ['/a.pdf'], '/o.pdf', { secretFile: '/s' }).args[0], '@/s', 'mot de passe jamais sur la ligne de commande');
  assert.equal(qpdfSecretArgs('proteger', '/a.pdf', '/o.pdf', 'secret!'), '--encrypt\nsecret!\nsecret!\n256\n--\n/a.pdf\n/o.pdf\n');
  assert.throws(() => qpdfSecretArgs('proteger', '/a', '/o', 'a\nb'), /invalide/);
});

test('Dvalinn : boîte à outils (comme IT-Tools)', () => {
  assert.match(outil('empreinte', 'odin'), /SHA256 : [0-9a-f]{64}/);
  assert.equal(outil('base64', 'Odin'), 'T2Rpbg=='); assert.equal(outil('base64', 'décode: T2Rpbg=='), 'Odin');
  assert.equal(outil('url', 'a b&c'), 'a%20b%26c'); assert.equal(outil('url', 'decode: a%20b'), 'a b');
  assert.equal(outil('uuid', '3').split('\n').length, 3);
  const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"sub":"awa","exp":1700000000}').toString('base64url')}.x`;
  assert.match(outil('jwt', jwt, 1794555000000), /"sub": "awa"[\s\S]*⚠ expiré/);
  assert.match(outil('horodatage', '1700000000'), /2023/); assert.match(outil('horodatage', '2026-11-13T09:00:00Z'), /^1794560400/);
  assert.match(outil('json', '{"a":1}'), /"a": 1/); assert.throws(() => outil('json', '{a'), /JSON invalide/);
  assert.equal(outil('mot_de_passe', '32').length, 32);
  assert.match(outil('sous_reseau', '192.168.1.37/24'), /Réseau : 192\.168\.1\.0\/24[\s\S]*Dernière adresse : 192\.168\.1\.254[\s\S]*254/);
  assert.match(outil('couleur', '#1e5fd6'), /rgb\(30, 95, 214\)/); assert.match(outil('couleur', 'rgb(255, 0, 0)'), /#ff0000[\s\S]*hsl\(0, 100 %, 50 %\)/);
  assert.match(outil('texte', 'Été à Mayotte'), /3 mots[\s\S]*ete-a-mayotte/);
});

const sh = (cmd: string, args: string[], o: { timeoutMs?: number } = {}) => new Promise<{ code: number; out: string; err: string }>((ok) => execFile(cmd, args, { timeout: o.timeoutMs ?? 120000, maxBuffer: 1 << 24 }, (e, out, err) => ok({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? (e as { code: number }).code : 1) : 0, out: String(out), err: String(err) })));
const has = async (c: string) => (await sh('sh', ['-c', `command -v ${c}`])).code === 0;

test('Dvalinn : vraies conversions (vidéo, son, image, document, PDF), rien n\'est écrasé, fichiers protégés refusés', { timeout: 240000 }, async (t) => {
  if (!(await has('ffmpeg')) || !(await has('qpdf'))) { t.skip('ffmpeg ou qpdf absent'); return; }
  const home = mkdtempSync(join(tmpdir(), 'dvalinn-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: (c, a, o) => sh(c, a, o), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const at = join(v.ctx('dvalinn').dir, 'atelier'); mkdirSync(at, { recursive: true });
  try {
    await sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', join(at, 'essai.mov')]);
    assert.match((await v.act('dvalinn', 'outils')).text, /✅ ffmpeg/);
    let r = await v.act('dvalinn', 'convertir', { fichier: 'essai.mov', format: 'mp4', qualite: 'legere' }); assert.match(r.text, /✅ essai\.mov → essai\.mp4/, r.text);
    r = await v.act('dvalinn', 'convertir', { fichier: 'atelier:essai.mov', format: 'mp4' }); assert.match(r.text, /essai \(1\)\.mp4|essai-1\.mp4|essai.*\.mp4/, 'un deuxième résultat ne remplace pas le premier');
    assert.equal(readdirSync(at).filter((f) => f.endsWith('.mp4')).length, 2);
    r = await v.act('dvalinn', 'convertir', { fichier: 'essai.mov', format: 'mp3' }); assert.match(r.text, /essai\.mp3/);
    r = await v.act('dvalinn', 'convertir', { fichier: 'essai.mov', format: 'gif', duree: '1', largeur: 160 }); assert.match(r.text, /essai\.gif/);
    if (await has('convert')) {
      await sh('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x480', '-frames:v', '1', join(at, 'photo.png')]);
      r = await v.act('dvalinn', 'convertir', { fichier: 'photo.png', format: 'jpg', largeur: 200 }); assert.match(r.text, /photo\.jpg/, r.text);
      r = await v.act('dvalinn', 'pdf', { operation: 'images_en_pdf', fichiers: 'photo.png, photo.jpg', nom: 'album' }); assert.match(r.text, /album\.pdf/, r.text);
    }
    if (await has('pandoc')) {
      writeFileSync(join(at, 'note.md'), '# Rapport\n\nBonjour **Mayotte**.\n');
      r = await v.act('dvalinn', 'convertir', { fichier: 'note.md', format: 'docx' }); assert.match(r.text, /note\.docx/, r.text);
      if (await has('soffice')) { r = await v.act('dvalinn', 'convertir', { fichier: 'note.docx', format: 'pdf' }); assert.match(r.text, /note\.pdf/, r.text); }
    }
    // PDF : une source de 3 pages faite avec qpdf
    const src = readdirSync(at).find((f) => f.endsWith('.pdf'));
    if (src) {
      await sh('qpdf', ['--empty', '--pages', join(at, src), '1', join(at, src), '1', join(at, src), '1', '--', join(at, 'trois.pdf')]);
      r = await v.act('dvalinn', 'pdf', { operation: 'fusionner', fichiers: `trois.pdf, ${src}`, nom: 'tout' }); assert.match(r.text, /tout\.pdf/, r.text);
      r = await v.act('dvalinn', 'pdf', { operation: 'extraire', fichiers: 'trois.pdf', pages: '2-fin', nom: 'fin' }); assert.match(r.text, /fin\.pdf/);
      assert.match((await sh('qpdf', ['--show-npages', join(at, 'fin.pdf')])).out, /^2/);
      r = await v.act('dvalinn', 'pdf', { operation: 'decouper', fichiers: 'trois.pdf' }); assert.match(r.text, /3 fichier\(s\)/, r.text);
      r = await v.act('dvalinn', 'pdf', { operation: 'pivoter', fichiers: 'trois.pdf', angle: '90' }); assert.match(r.text, /pivoter/);
      r = await v.act('dvalinn', 'pdf', { operation: 'proteger', fichiers: 'trois.pdf', mot_de_passe: 'Secret 42!', nom: 'protege' }); assert.match(r.text, /protege\.pdf/, r.text);
      assert.notEqual((await sh('qpdf', ['--check', join(at, 'protege.pdf')])).code, 0, 'sans mot de passe : illisible');
      r = await v.act('dvalinn', 'pdf', { operation: 'deproteger', fichiers: 'protege.pdf', mot_de_passe: 'Secret 42!', nom: 'libre' }); assert.match(r.text, /libre\.pdf/, r.text);
      assert.equal((await sh('qpdf', ['--check', join(at, 'libre.pdf')])).code, 0);
      r = await v.act('dvalinn', 'pdf', { operation: 'alleger', fichiers: 'tout.pdf' }); assert.match(r.text, /de moins/);
      if (await has('pdftotext')) { r = await v.act('dvalinn', 'convertir', { fichier: 'trois.pdf', format: 'txt' }); assert.match(r.text, /trois\.txt/); }
      if (await has('pdftoppm')) { r = await v.act('dvalinn', 'convertir', { fichier: 'trois.pdf', format: 'png', qualite: 'legere' }); assert.match(r.text, /3 fichiers/, r.text); }
    }
    // Sécurité : pas de sortie de l'atelier, fichiers protégés, dossier système refusé, rien n'est écrasé
    assert.match((await v.act('dvalinn', 'convertir', { fichier: '../../etc/passwd', format: 'pdf' })).text, /interdit/);
    writeFileSync(join(at, 'compte.json'), '{}');
    assert.match((await v.act('dvalinn', 'convertir', { fichier: 'compte.json', format: 'pdf' })).text, /protégé/);
    assert.match((await v.act('dvalinn', 'ajouter_dossier', { nom: 'sys', chemin: '/etc' })).text, /action grave|refusé/);
    assert.ok(existsSync(join(at, 'essai.mov')) && statSync(join(at, 'essai.mov')).size > 1000, 'l\'original est toujours là');
    // Vidéos par lot (comme Tdarr) : la file avance une vidéo à la fois
    mkdirSync(join(at, 'lot')); for (const n of ['a', 'b']) await sh('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=5:duration=1', '-pix_fmt', 'yuv420p', join(at, 'lot', `${n}.mp4`)]);
    assert.match((await v.act('dvalinn', 'lot_videos', { dossier: 'lot', codec: 'h264', qualite: 'legere' })).text, /2 vidéo\(s\) dans la file/);
    for (let k = 0; k < 120 && !/2 finie/.test((await v.act('dvalinn', 'file')).text); k++) { await v.module('dvalinn')!.watch!.run(v.ctx('dvalinn')); await new Promise((x) => setTimeout(x, 250)); }
    assert.match((await v.act('dvalinn', 'file')).text, /2 finie\(s\)/);
    assert.ok(existsSync(join(at, 'lot', 'a.h264.mkv')) && existsSync(join(at, 'lot', 'a.mp4')));
    const view = await v.module('dvalinn')!.view(v.ctx('dvalinn'), new URLSearchParams());
    assert.ok(view.sections.some((x) => x.title === 'Dernières conversions'));
    const dir = v.ctx('dvalinn').dir; for (const f of readdirSync(dir)) if (statSync(join(dir, f)).isFile()) assert.ok(!readFileSync(join(dir, f), 'utf8').includes('Secret 42!'), `le mot de passe n'est gardé nulle part (${f})`);
    assert.ok(!existsSync(join(dir, 'travail')) || readdirSync(join(dir, 'travail')).length === 0, 'dossiers de travail nettoyés');
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});
