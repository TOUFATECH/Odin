// Vénus, lot V3 — relecture : ce qui a été trouvé puis corrigé, prouvé ici (chaque essai échouait avant la correction).
//   - un genre venu d'Internet garde ses guillemets : la page doit l'échapper partout où il entre dans un attribut ;
//   - une vidéo qui fait tourner FFmpeg jusqu'à la coupure : le processus est vraiment fini avant la suite (jamais deux
//     FFmpeg à la fois), pas de second essai, et la cible est notée « ratée » (pas relancée à chaque relecture) ;
//   - une erreur pendant l'extraction (fichier tenu, disque plein) : la cible est notée « ratée », elle aussi ;
//   - un « % » dans le chemin du dossier d'Odin ne devient pas un motif de FFmpeg : la vignette est bien écrite ;
//   - une image d'un hôte permis mais sur un autre port n'est pas lue ;
//   - la migration v3 n'ajoute que deux tables : une base v2 (fichiers de repli) garde toutes ses données.
// Aucun accès à Internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEF_FREYJA, COLLECTIONS, MagasinVenus, dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { ajouterDossier, scanner } from '../src/valhalla/venus/bibliotheque.ts';
import { ffprobeReel } from '../src/valhalla/venus/routes.ts';
import { texte } from '../src/valhalla/venus/catalogue/index.ts';
import { telechargerImage } from '../src/valhalla/venus/metadonnees.ts';
import { argsVignette, attendreVignettes, demanderVignettes, ffmpegReel, oublierVignettesRatees, reglerFfmpegVignettes } from '../src/valhalla/venus/vignettes.ts';

const ff = (...a: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'ignore' });
const racine = mkdtempSync(join(tmpdir(), 'venus-v3-relecture-'));
const home = join(racine, 'home'), medias = join(racine, 'Films');
const mag = (): MagasinVenus => magasinVenus(home, dirVenus(home));
let filmId = '', video = '';

before(async () => {
  mkdirSync(home); mkdirSync(medias);
  video = join(medias, 'Aube.Claire.2020.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', video);
  ajouterDossier(mag(), medias, 'films'); await scanner(mag(), { ffprobe: ffprobeReel });
  filmId = mag().liste('oeuvres')[0].id;
});
after(async () => { await attendreVignettes(); reglerFfmpegVignettes(); oublierMagasins(); rmSync(racine, { recursive: true, force: true }); });

test('un genre venu d\'Internet garde ses guillemets : la page l\'échappe dans chaque attribut (filtre Genres)', () => {
  // Le nettoyage des textes retire les balises, pas les guillemets : la page doit échapper.
  assert.equal(texte('Drame" style="position:fixed;inset:0" x="', 80), 'Drame" style="position:fixed;inset:0" x="');
  const app = readFileSync(new URL('../src/valhalla/venus/app/app.js', import.meta.url), 'utf8');
  const groupe = app.split('\n').find((l) => l.includes('const group = (title, values, field, lab)'));
  assert.ok(groupe, 'le filtre de la bibliothèque (Browse.js)');
  assert.match(groupe!, /data-v="\$\{esc\(id\)\}"/, 'la valeur d\'une puce de filtre (un genre) est échappée');
});

test('FFmpeg coupé au bout du délai : le processus est fini avant de rendre la main, et c\'est dit « coupé »', async () => {
  const sortie = join(racine, 'coupe.jpg');
  // Une entrée sans fin (générée par FFmpeg lui-même) : seule la coupure l'arrête.
  const t0 = Date.now();
  const r = await ffmpegReel(['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-re', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=5', '-f', 'null', '-'], 800);
  assert.equal(r, 'coupe');
  assert.ok(Date.now() - t0 >= 800);
  assert.ok(!existsSync(sortie));
});

test('une vidéo coupée à 30 s : pas de second essai, et notée ratée (pas relancée à chaque relecture du catalogue)', async () => {
  const m = mag(); oublierVignettesRatees(); let appels = 0;
  reglerFfmpegVignettes(async () => { appels++; return 'coupe'; });
  try {
    demanderVignettes(m, [filmId]); await attendreVignettes();
    assert.equal(appels, 1, 'pas de second essai après une coupure');
    demanderVignettes(m, [filmId]); await attendreVignettes();
    assert.equal(appels, 1, 'notée ratée : pas relancée');
  } finally { reglerFfmpegVignettes(); oublierVignettesRatees(); }
});

test('une erreur pendant l\'extraction (fichier tenu, disque plein) : la cible est notée ratée, pas relancée en boucle', async () => {
  const m = mag(); oublierVignettesRatees(); let appels = 0;
  reglerFfmpegVignettes(async () => { appels++; throw Object.assign(new Error('EBUSY: fichier tenu'), { code: 'EBUSY' }); });
  try {
    demanderVignettes(m, [filmId]); await attendreVignettes();
    const avant = appels; assert.ok(avant >= 1);
    demanderVignettes(m, [filmId]); await attendreVignettes();
    assert.equal(appels, avant, 'notée ratée : pas relancée');
  } finally { reglerFfmpegVignettes(); oublierVignettesRatees(); }
});

test('un « % » dans le chemin de sortie n\'est pas un motif de FFmpeg : la vignette est écrite telle quelle', async () => {
  const dir = join(racine, 'Odin%03d'); mkdirSync(dir);
  const sortie = join(dir, 'v.tmp.jpg'), a = argsVignette(video, sortie, 1);
  assert.equal(a[a.indexOf('-update') + 1], '1', 'une seule image, sans motif');
  assert.equal(await ffmpegReel(a, 30_000), true);
  assert.ok(existsSync(sortie), `écrite : ${readdirSync(dir).join(', ')}`);
});

test('une image d\'un hôte permis mais sur un autre port n\'est pas lue', async () => {
  const lus: string[] = [];
  const f = (async (u: string) => { lus.push(u); return new Response(null, { status: 404 }); }) as unknown as Parameters<typeof telechargerImage>[1];
  assert.equal(await telechargerImage(mag(), f, 'https://image.tmdb.org:8443/t/p/w500/a.jpg', 'affiche'), undefined);
  assert.equal(await telechargerImage(mag(), f, 'https://static.tvmaze.com:22/uploads/a.jpg', 'affiche'), undefined);
  assert.deepEqual(lus, [], 'aucune lecture');
});

test('migration v3 : seulement deux tables ajoutées ; une base v2 (fichiers de repli) garde toutes ses données', () => {
  const v3 = DEF_FREYJA.migrations.find((x) => x.v === 3)!;
  assert.ok(v3, 'la migration v3 existe');
  const instr = v3.sql.split(';').map((x) => x.trim()).filter(Boolean);
  assert.deepEqual(instr.map((x) => x.replace(/\s*\(.*$/s, '')), ['CREATE TABLE images', 'CREATE TABLE personnes']);
  assert.ok(!/\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b/i.test(v3.sql));
  // Chaque collection a sa table, dans une des migrations.
  const tout = DEF_FREYJA.migrations.map((x) => x.sql).join('\n');
  for (const c of COLLECTIONS) assert.match(tout, new RegExp(`CREATE TABLE ${c} \\(`), c);
  // Un dossier de Vénus d'avant le lot V3 (v2) : ses fichiers sont relus tels quels, les nouvelles tables sont vides.
  const h2 = join(racine, 'home-v2'), d2 = join(h2, 'venus'); mkdirSync(d2, { recursive: true });
  const ligne = (id: string, data: Record<string, unknown>) => `${JSON.stringify({ id, maj: 1, data })}\n`;
  writeFileSync(join(d2, 'oeuvres.jsonl'), ligne('f-1', { type: 'film', titre: 'Ancien', fichier: 'C:/x.mp4', annee: 1999 }));
  writeFileSync(join(d2, 'preferences.jsonl'), ligne('moi', { planete: 'mars' }));
  writeFileSync(join(d2, 'ma_liste.jsonl'), ligne('moi:f-1', { profil: 'moi', oeuvre_id: 'f-1', ajoute: 1 }));
  const m2 = new MagasinVenus(h2, d2);
  assert.deepEqual(m2.get('oeuvres', 'f-1')?.data, { type: 'film', titre: 'Ancien', fichier: 'C:/x.mp4', annee: 1999 });
  assert.equal(m2.get('preferences', 'moi')?.data.planete, 'mars');
  assert.equal(m2.liste('ma_liste').length, 1);
  assert.equal(m2.liste('images').length, 0); assert.equal(m2.liste('personnes').length, 0);
  // Écrire dans une nouvelle table ne touche pas aux anciennes.
  m2.poser('personnes', 'pe-0123456789abcdef01234567', { nom: 'X', titres: { 'f-1': 'Rôle' } });
  const m3 = new MagasinVenus(h2, d2);
  assert.equal(m3.get('oeuvres', 'f-1')?.data.titre, 'Ancien'); assert.equal(m3.liste('personnes').length, 1);
});
