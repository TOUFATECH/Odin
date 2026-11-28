// Sa réponse du 27/11 : « Oui, efface-la » — l'aperçu d'une caméra n'est jamais gardé sur le disque, et le dossier des
// aperçus ne part pas dans la sauvegarde.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nettoyerApercus, preview } from '../src/valhalla/modules/himinbjorg.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { backupManifest } from '../src/backup.ts';
import { makeOdin } from './helpers.ts';

const IMAGE = Buffer.from('image-essai-jpeg');

/** Un faux Cyclope : ffmpeg écrit l'image d'essai dans le fichier demandé (son dernier argument), ou échoue. */
function fauxCtx(dir: string, echoue = false) {
  const appels: string[] = [];
  const ctx = {
    dir, settings: { cams: [{ name: 'Entrée essai', url: 'rtsp://exemple.invalid/flux', motion: false, record: false, sensitivity: 2 }] },
    now: () => new Date(),
    run: async (cmd: string, args: string[]) => {
      appels.push(cmd);
      if (echoue) return { code: 1, out: '', err: 'flux coupé' };
      writeFileSync(args[args.length - 1], IMAGE); return { code: 0, out: '', err: '' };
    },
  } as unknown as ModCtx;
  return { ctx, appels };
}

test('aperçu : l\'image est rendue en mémoire et son fichier est effacé aussitôt', async () => {
  const o = makeOdin([]);
  const dir = join(o.paths.home, 'valhalla', 'himinbjorg'); mkdirSync(dir, { recursive: true });
  const { ctx } = fauxCtx(dir);
  const img = await preview(ctx, 'entrée essai');
  assert.ok(Buffer.isBuffer(img), 'une image, pas un chemin de fichier');
  assert.deepEqual(img, IMAGE);
  const ap = join(dir, 'apercus');
  assert.deepEqual(existsSync(ap) ? readdirSync(ap) : [], [], 'aucune image ne reste sur le disque');
});

test('aperçu : une prise ratée ne laisse rien non plus, et l\'erreur est dite', async () => {
  const o = makeOdin([]);
  const dir = join(o.paths.home, 'valhalla', 'himinbjorg'); mkdirSync(dir, { recursive: true });
  const { ctx } = fauxCtx(dir, true);
  // Un autre nom de caméra que l'essai d'avant (le regroupement de 4 s est gardé par caméra).
  (ctx.settings.cams as Array<{ name: string }>)[0].name = 'Portail essai';
  await assert.rejects(preview(ctx, 'Portail essai'), /photo impossible/);
  const ap = join(dir, 'apercus');
  assert.deepEqual(existsSync(ap) ? readdirSync(ap) : [], []);
});

test('aperçu : deux demandes rapprochées ne font qu\'une prise, et la seconde reçoit la même image', async () => {
  const o = makeOdin([]);
  const dir = join(o.paths.home, 'valhalla', 'himinbjorg'); mkdirSync(dir, { recursive: true });
  const { ctx, appels } = fauxCtx(dir);
  // Un autre nom de caméra que les essais d'avant (le regroupement de 4 s est gardé par caméra).
  (ctx.settings.cams as Array<{ name: string }>)[0].name = 'Garage essai';
  const [a, b] = await Promise.all([preview(ctx, 'Garage essai'), preview(ctx, 'garage essai')]);
  assert.deepEqual(a, IMAGE); assert.deepEqual(b, IMAGE);
  assert.equal(appels.filter((x) => x === 'ffmpeg').length, 1);
});

test('nettoyage : les restes de plus d\'une minute partent (dont l\'image gardée avant le 27/11), une prise en cours reste', () => {
  const o = makeOdin([]);
  const dir = join(o.paths.home, 'valhalla', 'himinbjorg'), ap = join(dir, 'apercus'); mkdirSync(ap, { recursive: true });
  const vieux = join(ap, 'entree.jpg'), frais = join(ap, 'entree-1-1.jpg');
  writeFileSync(vieux, IMAGE); writeFileSync(frais, IMAGE);
  const t = Date.now(); utimesSync(vieux, new Date(t - 3600_000), new Date(t - 3600_000));
  nettoyerApercus({ dir } as unknown as ModCtx, t);
  assert.equal(existsSync(vieux), false, 'la vieille image est effacée');
  assert.equal(existsSync(frais), true, 'une prise de moins d\'une minute est laissée');
  // Le nettoyage tourne à chaque tour de Cyclope, avant même de savoir s'il y a une caméra à surveiller.
  const src = readFileSync(new URL('../src/valhalla/modules/himinbjorg.ts', import.meta.url), 'utf8');
  assert.match(src, /async run\(ctx\) \{\s*nettoyerApercus\(ctx\);/);
});

test('sauvegarde : le dossier des aperçus n\'y part pas, le reste de Cyclope si', () => {
  const o = makeOdin([]);
  const dir = join(o.paths.home, 'valhalla', 'himinbjorg');
  mkdirSync(join(dir, 'apercus'), { recursive: true }); mkdirSync(join(dir, 'photos'), { recursive: true });
  writeFileSync(join(dir, 'apercus', 'entree.jpg'), IMAGE); writeFileSync(join(dir, 'photos', 'alerte.jpg'), IMAGE);
  const noms = backupManifest(o.paths).map((f) => f.name);
  assert.ok(!noms.some((n) => n.startsWith('valhalla/himinbjorg/apercus')), 'aucun aperçu dans la sauvegarde');
  assert.ok(noms.includes('valhalla/himinbjorg/photos/alerte.jpg'), 'les photos d\'alerte restent sauvegardées comme avant');
});

test('la route de l\'écran de la maison envoie l\'image reçue, sans relire un fichier', () => {
  const src = readFileSync(new URL('../src/web/maison-api.ts', import.meta.url), 'utf8');
  const ligne = src.split('\n').find((l) => l.includes('await preview(')) ?? '';
  assert.match(ligne, /res\.end\(img\)/);
  assert.doesNotMatch(ligne, /readFileSync/);
});
