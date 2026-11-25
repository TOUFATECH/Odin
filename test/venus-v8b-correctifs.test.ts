// Vénus, la maison (lot V8, seconde part), corrections après relecture, côté Odin : un profil enfant n'enregistre pas
// une version légère déjà prête ; l'effacement au bout de 7 jours ne dépend plus de l'ouverture de la page ; la
// conversion laisse passer une lecture convertie (priorité basse, deux fils) ; la langue du profil et les sous-titres
// texte sont gardés ; un plafond de taille même quand la place libre est inconnue ; « Télécharger la saison » (comme
// Downloads.js et la maquette) ; « Lecture / pause » bascule sur l'écran lui-même ; le ménage des 7 jours est un
// travail du registre des automatismes (visible dans Talos, sa pause respectée) ; les versions légères ne partent pas
// dans la sauvegarde d'Odin, et après une restauration une ligne « prête » sans sa vidéo est retirée. Aucun réseau,
// aucun vrai FFmpeg ni ffprobe (des faux), le magasin de Vénus en fichiers, de faux req/res, des prénoms inventés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { constants as osConst, getPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirVenus, magasinVenus, oublierMagasins, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { venusRoute } from '../src/valhalla/venus/routes.ts';
import * as HL from '../src/valhalla/venus/hors-ligne.ts';
import { reglerPreferences } from '../src/valhalla/venus/app/appli.ts';
import { ACTIONS_ECRAN, planPilotage } from '../src/valhalla/venus/ecrans.ts';
import { brancherPersona } from '../src/valhalla/sso/registre.ts';
import type { Sonde } from '../src/valhalla/venus/pistes.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { setValhalla, valhallaOf } from '../src/valhalla/odin.ts';
import { venus } from '../src/valhalla/modules/venus.ts';
import { backupManifest, createBackup, restoreBackup } from '../src/backup.ts';
import { odinPaths } from '../src/config.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-v8b-correctifs-'));
const MOI = 'moi';
const AN = new Date().getFullYear();
/** Deux profils inventés : Noé (8 ans, profil enfant) et Lou (adulte). */
function personaFaux(home: string): void {
  const ctx = { home, dir: home, settings: { people: [{ login: 'noe', name: 'Noé', active: true, naissance: AN - 8 }, { login: 'lou', name: 'Lou', active: true, naissance: 1990 }] }, saveSettings() {} };
  brancherPersona(() => ctx as never, (t: string, c: string) => `<p>${t}${c}</p>`);
}
const sansPersona = () => brancherPersona(() => undefined, (t: string) => t);

/** Un film, un film sans durée connue, et une série de deux épisodes dans la saison 1 (plus un épisode en saison 2). */
function bibli(m: MagasinVenus, media: string): void {
  const f = join(media, 'Le Phare (2020).mkv'); writeFileSync(f, Buffer.alloc(4096, 3));
  m.poser('oeuvres', 'film:a', { type: 'film', titre: 'Le Phare', annee: 2020, duree: 6000, fichier: f });
  const g = join(media, 'La Dune.mkv'); writeFileSync(g, Buffer.alloc(2048, 5));
  m.poser('oeuvres', 'film:c', { type: 'film', titre: 'La Dune', annee: 2021, fichier: g });
  m.poser('oeuvres', 'serie:s', { type: 'serie', titre: 'Les Îles' });
  for (const [sa, ep] of [[1, 1], [1, 2], [2, 1]]) {
    const e = join(media, `Les Iles S0${sa}E0${ep}.mkv`); writeFileSync(e, Buffer.alloc(1024, 4));
    m.poser('episodes', `serie:s:s${sa}e${ep}`, { oeuvre_id: 'serie:s', saison: sa, episode: ep, titre: 'Les Îles', fichier: e, duree: 1400 });
  }
}
function fauxConvertisseur(o: { octets?: number } = {}) {
  const vus: string[][] = [];
  const convertir = (args: string[], progres: (s: number) => void) => {
    vus.push(args); progres(10);
    writeFileSync(args[args.length - 1], Buffer.alloc(o.octets ?? 777, 1));
    return { fin: Promise.resolve(true), tuer() {} };
  };
  return { vus, convertir };
}
const SANS_PISTES = async (): Promise<Sonde> => ({ sure: false, audio: [], sousTitres: [] });
const outilsDe = (faux: ReturnType<typeof fauxConvertisseur>, o: Record<string, unknown> = {}) => ({ convertir: faux.convertir, ffmpegLa: async () => true, placeLibre: () => 1e15, attenteMs: 1, pistes: SANS_PISTES, ...o });

function fakeReq(method: string, body?: unknown, headers: Record<string, string> = { 'x-odin': '1' }): IncomingMessage {
  const r = Readable.from(body !== undefined ? [Buffer.from(JSON.stringify(body))] : []) as unknown as IncomingMessage;
  Object.assign(r, { method, headers });
  return r;
}
class FakeRes extends Writable {
  code?: number; body = ''; entetes: Record<string, string> = {};
  writeHead(code: number, h: Record<string, string> = {}): this { this.code = code; this.entetes = h; return this; }
  _write(chunk: Buffer, _e: string, cb: () => void): void { this.body += chunk.toString(); cb(); }
}
async function appel(home: string, method: string, chemin: string, body?: unknown, headers?: Record<string, string>) {
  const res = new FakeRes();
  const ctx = { home, proprietaire: () => true, fail: () => undefined, origin: 'http://odin.test', ip: '127.0.0.1', profil: MOI };
  await venusRoute(fakeReq(method, body, headers), res as unknown as ServerResponse, new URL(`http://x${chemin}`), ctx);
  if (!res.writableFinished) await new Promise<void>((r) => { res.once('finish', () => r()); setTimeout(r, 500); });
  let json: unknown = {}; try { json = JSON.parse(res.body) as unknown; } catch { /* pas du JSON */ }
  return { code: res.code, json: json as Record<string, unknown>, body: res.body };
}

test('un profil enfant n’enregistre pas une version légère déjà prête (« Enregistrer ») : refus côté serveur', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); personaFaux(home); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    // une ligne prête de Noé, d'avant qu'il ne soit un profil enfant
    m.poser('hors_ligne', 'dl-aaaaaaaaaaaa', { profil: 'p:noe', cible: 'film:a', titre: 'Le Phare', quality: '720p', etat: 'ready', progress: 100, taille: 10, cree: Date.now(), expire: Date.now() + 3600_000 });
    mkdirSync(HL.dossierHorsLigne(m), { recursive: true }); writeFileSync(join(HL.dossierHorsLigne(m), 'dl-aaaaaaaaaaaa.mp4'), Buffer.alloc(10, 1));
    let r = await appel(home, 'GET', '/venus/api/telechargements/dl-aaaaaaaaaaaa/fichier', undefined, { 'x-odin': '1', 'x-venus-profil': 'p:noe' });
    assert.equal(r.code, 403); assert.equal(r.json.error, 'Un profil enfant ne télécharge pas.');
    r = await appel(home, 'GET', '/venus/api/telechargements/dl-aaaaaaaaaaaa/fichier', undefined, { cookie: 'venus_profil=p%3Anoe' });
    assert.equal(r.code, 403, 'par le témoin du profil aussi');
    // un adulte garde « Enregistrer » sur les siennes
    m.poser('hors_ligne', 'dl-bbbbbbbbbbbb', { profil: 'p:lou', cible: 'film:a', titre: 'Le Phare', quality: '480p', etat: 'ready', progress: 100, taille: 10, cree: Date.now(), expire: Date.now() + 3600_000 });
    writeFileSync(join(HL.dossierHorsLigne(m), 'dl-bbbbbbbbbbbb.mp4'), Buffer.alloc(10, 1));
    r = await appel(home, 'GET', '/venus/api/telechargements/dl-bbbbbbbbbbbb/fichier', undefined, { 'x-odin': '1', 'x-venus-profil': 'p:lou' });
    assert.equal(r.code, 200);
  } finally { sansPersona(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

test('7 jours : une version légère périmée est effacée par le passage de préparation, sans que la page soit ouverte', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    HL.reglerOutilsHorsLigne(outilsDe(fauxConvertisseur()));
    const d = HL.dossierHorsLigne(m); mkdirSync(d, { recursive: true });
    m.poser('hors_ligne', 'dl-cccccccccccc', { profil: MOI, cible: 'film:a', titre: 'Le Phare', quality: '720p', etat: 'ready', progress: 100, taille: 10, cree: 1, expire: Date.now() - 1000 });
    writeFileSync(join(d, 'dl-cccccccccccc.mp4'), Buffer.alloc(10, 1));
    // une demande neuve (POST) passe par planifier() : la ligne périmée et sa vidéo partent, sans lire la liste
    HL.demanderLegere(m, { profil: MOI, itemId: 'film:c', quality: '480p' });
    await HL.planifier(m); await HL.attendreHorsLigne();
    assert.equal(m.get('hors_ligne', 'dl-cccccccccccc'), undefined, 'la ligne périmée est effacée');
    assert.ok(!existsSync(join(d, 'dl-cccccccccccc.mp4')), 'et sa vidéo');
  } finally { HL.reglerOutilsHorsLigne(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

test('une lecture convertie passe devant : deux fils pour FFmpeg, et une priorité basse donnée au processus', async () => {
  const a = HL.argsLegere('/m/film.mkv', '720p', '/o/x.part.mp4');
  const i = a.indexOf('-i');
  assert.deepEqual(a.slice(i - 4, i), ['-protocol_whitelist', 'file', '-format_whitelist', a[i - 1]], 'l’entrée reste protégée');
  const fils = a.reduce<number[]>((acc, x, k) => (x === '-threads' ? [...acc, k] : acc), []);
  assert.ok(fils.length >= 1 && fils.every((k) => a[k + 1] === '2'), 'deux fils, pas toute la machine');
  assert.ok(fils.some((k) => k > i), 'pour l’encodage');
  assert.equal(typeof (HL as Record<string, unknown>).lancerLegere, 'function', 'le lancement est exporté');
  // un vrai processus (Node lui-même, qui attend un peu) lancé comme FFmpeg le serait : sa priorité est abaissée
  const lancer = (HL as unknown as { lancerLegere: (args: string[], p: (s: number) => void, cmd?: string) => { fin: Promise<boolean>; tuer(): void; pid?: number } }).lancerLegere;
  const h = lancer(['-e', 'setTimeout(() => {}, 4000)'], () => undefined, process.execPath);
  try {
    assert.ok(h.pid && h.pid > 0);
    assert.equal(getPriority(h.pid), osConst.priority.PRIORITY_BELOW_NORMAL);
  } finally { h.tuer(); await h.fin; }
});

test('langues : la piste audio de la langue du profil, et les sous-titres texte gardés (en mov_text) ; images et pistes inconnues laissées', async () => {
  assert.equal(typeof (HL as Record<string, unknown>).pistesLegere, 'function');
  const pistesLegere = (HL as unknown as { pistesLegere: (s: Sonde, l: string) => { audio: number; sousTitres: number[] } }).pistesLegere;
  const sonde: Sonde = { sure: true, audio: [{ ordre: 0, codec: 'aac', langue: 'jpn', titre: '', canaux: 2, defaut: true }, { ordre: 1, codec: 'ac3', langue: 'fre', titre: 'VF', canaux: 6, defaut: false }],
    sousTitres: [{ index: 3, codec: 'subrip', langue: 'fre', titre: '', force: false, texte: true }, { index: 4, codec: 'hdmv_pgs_subtitle', langue: 'eng', titre: '', force: false, texte: false }, { index: 5, codec: 'ass', langue: 'eng', titre: '', force: false, texte: true }, { index: 6, codec: 'ttml', langue: 'spa', titre: '', force: false, texte: true }] };
  assert.deepEqual(pistesLegere(sonde, 'fr'), { audio: 1, sousTitres: [3, 5] }, 'la VF, et les sous-titres texte que MP4 sait garder');
  assert.deepEqual(pistesLegere(sonde, ''), { audio: 0, sousTitres: [3, 5] }, 'sans choix du profil : la première piste, comme le lecteur');
  assert.deepEqual(pistesLegere(sonde, 'sw'), { audio: 0, sousTitres: [3, 5] }, 'une langue absente du fichier : la première piste');
  assert.deepEqual(pistesLegere({ ...sonde, sure: false }, 'fr').sousTitres, [], 'pistes devinées (ffprobe absent) : aucun sous-titre, rien de risqué');
  const a = HL.argsLegere('/m/x.mkv', '480p', '/o/y.mp4', { audio: 1, sousTitres: [3, 5] });
  assert.ok(a.includes('0:a:1?') && a.includes('0:3?') && a.includes('0:5?'));
  assert.deepEqual(a.slice(a.indexOf('-c:s'), a.indexOf('-c:s') + 2), ['-c:s', 'mov_text']); assert.ok(!a.includes('-sn'));
  assert.ok(HL.argsLegere('/m/x.mkv', '480p', '/o/y.mp4').includes('-sn'), 'sans sous-titres texte : aucun');
  // de bout en bout : le profil a choisi le français ; ffprobe (faux) dit les pistes
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    reglerPreferences(m, MOI, { audio: 'fr' });
    const faux = fauxConvertisseur();
    HL.reglerOutilsHorsLigne(outilsDe(faux, { pistes: async () => sonde }));
    HL.demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '720p' });
    await HL.planifier(m); await HL.attendreHorsLigne();
    assert.equal(faux.vus.length, 1);
    const v = faux.vus[0];
    assert.equal(v[v.indexOf('0:v:0') + 2], '0:a:1?', 'la piste audio française');
    assert.ok(v.includes('0:3?') && v.includes('0:5?') && !v.includes('0:4?') && !v.includes('0:6?'));
  } finally { HL.reglerOutilsHorsLigne(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

test('plafond de taille : « -fs » toujours posé, même si la place libre est inconnue ; une sortie qui l’atteint n’est jamais « prête »', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    // la place libre est inconnue (le système ne sait pas la dire) : le plafond vient de la durée maximale
    let faux = fauxConvertisseur();
    HL.reglerOutilsHorsLigne(outilsDe(faux, { placeLibre: () => Number.POSITIVE_INFINITY }));
    let t = HL.demanderLegere(m, { profil: MOI, itemId: 'film:c', quality: '720p' }) as { id: string };
    await HL.planifier(m); await HL.attendreHorsLigne();
    let v = faux.vus[0]; assert.ok(v.includes('-fs'), 'un plafond de taille');
    const plafond = Number(v[v.indexOf('-fs') + 1]);
    assert.ok(Number.isFinite(plafond) && plafond > 0 && plafond <= 0.9e9 * 10 * 1.5, `plafond borné : ${plafond}`);
    assert.equal(HL.taches(m, MOI).find((x) => x.id === t.id)?.state, 'ready');
    HL.supprimerLegere(m, MOI, t.id);
    // durée connue : jamais plus du double de l'estimation
    faux = fauxConvertisseur();
    HL.reglerOutilsHorsLigne(outilsDe(faux));
    t = HL.demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '480p' }) as { id: string };
    await HL.planifier(m); await HL.attendreHorsLigne();
    v = faux.vus[0]; assert.equal(Number(v[v.indexOf('-fs') + 1]), Math.floor(0.45e9 * (6000 / 3600) * 2));
    HL.supprimerLegere(m, MOI, t.id);
    // peu de place : le plafond suit la place libre, et une sortie qui l'atteint (coupée) est un échec, effacée
    faux = fauxConvertisseur({ octets: 1500 });
    HL.reglerOutilsHorsLigne(outilsDe(faux, { placeLibre: () => 2 * 1024 ** 3 + 1000 }));
    t = HL.demanderLegere(m, { profil: MOI, itemId: 'film:c', quality: '480p' }) as { id: string };
    await HL.planifier(m); await HL.attendreHorsLigne();
    v = faux.vus[0]; assert.equal(v[v.indexOf('-fs') + 1], '1000');
    const x = HL.taches(m, MOI).find((y) => y.id === t.id)!;
    assert.equal(x.state, 'error'); assert.equal(x.reason, 'place');
    assert.equal(HL.fichierPret(m, MOI, t.id), undefined);
  } finally { HL.reglerOutilsHorsLigne(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

test('« Télécharger la saison » : une ligne par épisode de la saison, sans doublon ; enfant refusé ; saison inconnue', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); personaFaux(home); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    HL.reglerOutilsHorsLigne(outilsDe(fauxConvertisseur()));
    let r = await appel(home, 'POST', '/venus/api/telechargements', { itemId: 'serie:s', saison: 1, quality: '720p' }, { 'x-odin': '1' });
    assert.equal(r.code, 200);
    const l = r.json as unknown as Array<{ id: string; title: string; itemId: string; quality: string }>;
    assert.ok(Array.isArray(l), 'une liste, comme l’appli d’origine');
    assert.deepEqual(l.map((x) => x.title), ['Les Îles S01E01', 'Les Îles S01E02']);
    assert.ok(l.every((x) => x.quality === '720p'));
    r = await appel(home, 'POST', '/venus/api/telechargements', { itemId: 'serie:s', saison: 1, quality: '720p' }, { 'x-odin': '1' });
    assert.deepEqual((r.json as unknown as Array<{ id: string }>).map((x) => x.id), l.map((x) => x.id), 'déjà demandée : rien de refait');
    r = await appel(home, 'POST', '/venus/api/telechargements', { itemId: 'serie:s', saison: 7, quality: '720p' }, { 'x-odin': '1' });
    assert.equal(r.code, 404);
    r = await appel(home, 'POST', '/venus/api/telechargements', { itemId: 'serie:s', saison: 1, quality: '720p' }, { 'x-venus-profil': 'p:noe' });
    assert.equal(r.code, 403, 'sans x-odin');
    r = await appel(home, 'POST', '/venus/api/telechargements', { itemId: 'serie:s', saison: 1, quality: '720p' }, { 'x-odin': '1', 'x-venus-profil': 'p:noe' });
    assert.equal(r.code, 403); assert.equal(r.json.error, 'Un profil enfant ne télécharge pas.');
    await HL.attendreHorsLigne();
    assert.deepEqual(HL.taches(m, MOI).map((x) => x.state), ['ready', 'ready']);
  } finally { HL.reglerOutilsHorsLigne(); sansPersona(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

test('« Lecture / pause » : une seule commande qui bascule sur l’écran lui-même (l’état de la télé fait foi)', () => {
  assert.ok((ACTIONS_ECRAN as string[]).includes('basculer'));
  assert.deepEqual(planPilotage('basculer' as never, 'media_player.salon'), { path: '/services/media_player/media_play_pause', data: { entity_id: 'media_player.salon' } });
});

const dormir = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });
/** Attend qu'une condition devienne vraie (3 s au plus) ; rend ce qu'elle vaut à la fin. */
async function attendreQue(vrai: () => boolean, ms = 3000): Promise<boolean> {
  for (const fin = Date.now() + ms; !vrai() && Date.now() < fin;) await dormir(10);
  return vrai();
}

test('7 jours : le ménage est un travail du registre des automatismes (visible dans Talos) ; il passe tout seul, sans la page ni une demande ; sa pause est respectée partout', async () => {
  assert.equal(typeof (HL as Record<string, unknown>).armerMenage, 'function', 'le ménage s’inscrit au registre des automatismes');
  const home = tmp(), media = tmp(), autre = tmp();
  const avant = valhallaOf();
  // Les applis de cet Odin, avec Vénus. Rien n'est démarré : seul leur registre des automatismes sert ici.
  const v = new Valhalla(home, [venus(() => '')]);
  const ID = `tache:freyja:${HL.MENAGE}`;
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    const d = HL.dossierHorsLigne(m); mkdirSync(d, { recursive: true });
    const perimee = (id: string) => {
      m.poser('hors_ligne', id, { profil: MOI, cible: 'film:a', titre: 'Le Phare', quality: '720p', etat: 'ready', progress: 100, taille: 10, cree: 1, expire: Date.now() - 1000 });
      writeFileSync(join(d, `${id}.mp4`), Buffer.alloc(10, 1));
    };
    const la = (id: string) => m.get('hors_ligne', id) !== undefined && existsSync(join(d, `${id}.mp4`));
    const partie = (id: string) => m.get('hors_ligne', id) === undefined && !existsSync(join(d, `${id}.mp4`));
    HL.reglerOutilsHorsLigne(outilsDe(fauxConvertisseur(), { menageMs: 25 })); // l'heure du ménage, accélérée

    // Sans les applis d'Odin, ou avec celles d'un autre dossier d'Odin : rien d'inscrit, aucune minuterie.
    setValhalla(undefined);
    assert.equal(HL.armerMenage(m), false, 'sans registre, pas de minuterie');
    setValhalla(v);
    assert.equal(HL.armerMenage(magasinVenus(autre, dirVenus(autre))), false, 'le magasin d’un autre Odin ne s’inscrit pas ici');
    assert.equal(v.automatismes.ligne(ID), undefined);

    // La liste lue une fois : le travail est inscrit sous Vénus, avec son nom, sa cadence, « Lancer » et « Pause ».
    assert.deepEqual(HL.taches(m, MOI), []);
    const l = v.automatismes.ligne(ID);
    assert.ok(l, 'le ménage est une ligne du registre');
    assert.equal(l.sorte, 'tache'); assert.equal(l.appli, 'freyja'); assert.equal(l.nom, 'Ménage des versions légères');
    assert.match(l.quoi, /7 jours/); assert.equal(l.phrase, 'Toutes les heures');
    assert.equal(l.peut.lancer, true); assert.equal(l.peut.pause, true); assert.equal(l.etat, 'actif');
    assert.ok(l.prochaine && Date.parse(l.prochaine) > Date.now() - 1000, 'le prochain passage est dit');
    assert.ok(v.automatismes.lignes().some((x) => x.id === ID), 'visible dans la liste de Talos');

    // Le passage de l'heure : une version périmée part toute seule (ni liste lue, ni demande), et le registre le note.
    perimee('dl-cccccccccccc');
    assert.ok(await attendreQue(() => partie('dl-cccccccccccc')), 'effacée par le passage du registre');
    assert.ok(await attendreQue(() => v.automatismes.historique(ID).some((p) => p.ok && /^1 version légère/.test(p.texte ?? ''))), 'le passage est noté dans le registre');

    // En pause dans Talos : plus rien n'est effacé, ni à l'heure, ni à la lecture de la liste, ni au passage de préparation.
    assert.equal((v.automatismes.pause(ID, true) as { ok: boolean }).ok, true);
    assert.equal(v.automatismes.ligne(ID)?.etat, 'pause');
    perimee('dl-dddddddddddd');
    await dormir(200);
    assert.ok(la('dl-dddddddddddd'), 'en pause : le passage de l’heure n’efface rien');
    assert.equal(HL.taches(m, MOI).length, 1);
    assert.ok(la('dl-dddddddddddd'), 'en pause : la lecture de la liste non plus');
    HL.demanderLegere(m, { profil: MOI, itemId: 'film:c', quality: '480p' });
    await HL.planifier(m); await HL.attendreHorsLigne();
    assert.ok(la('dl-dddddddddddd'), 'en pause : le passage de préparation non plus');
    // « Lancer maintenant » reste un geste du propriétaire : il efface, même en pause.
    const r = await v.automatismes.lancer(ID) as { ok: boolean; resultat?: { ok: boolean; texte: string } };
    assert.equal(r.ok, true); assert.equal(r.resultat?.ok, true); assert.match(r.resultat?.texte ?? '', /^1 version légère/);
    assert.ok(partie('dl-dddddddddddd'), 'lancé à la main : effacée');

    // Reprise : le ménage repart tout seul.
    perimee('dl-eeeeeeeeeeee');
    await dormir(100);
    assert.ok(la('dl-eeeeeeeeeeee'), 'toujours en pause');
    assert.equal((v.automatismes.pause(ID, false) as { ok: boolean }).ok, true);
    assert.ok(await attendreQue(() => partie('dl-eeeeeeeeeeee')), 'reprise : effacée au passage suivant');

    // Vénus désactivée : le passage de l'heure ne touche pas à ses données ; réactivée, il repart.
    assert.equal((await v.activer('freyja', false)).ok, true);
    perimee('dl-ffffffffffff');
    await dormir(200);
    assert.ok(la('dl-ffffffffffff'), 'appli désactivée : rien n’est effacé');
    assert.equal((await v.activer('freyja', true)).ok, true);
    assert.ok(await attendreQue(() => partie('dl-ffffffffffff')), 'réactivée : effacée');

    // Les applis d'Odin arrêtées : la minuterie s'arrête avec elles (plus rien ne passe hors du registre).
    setValhalla(undefined);
    perimee('dl-abababababab');
    await dormir(200);
    assert.ok(la('dl-abababababab'), 'sans registre : aucun passage caché');
  } finally {
    try { v.automatismes.pause(ID, false); } catch { /* jamais inscrit */ }
    HL.reglerOutilsHorsLigne(); v.stop(); setValhalla(avant);
    for (const x of [home, media, autre]) rmSync(x, { recursive: true, force: true });
  }
});

test('sauvegarde d’Odin : les versions légères n’y partent pas ; après une restauration, une ligne « prête » sans sa vidéo est retirée et le titre se redemande', async () => {
  const home = tmp(), media = tmp(), ailleurs = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    writeFileSync(join(home, 'config.json'), '{}');
    const faux = fauxConvertisseur({ octets: 5000 });
    HL.reglerOutilsHorsLigne(outilsDe(faux));
    const t = HL.demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '720p' }) as { id: string };
    await HL.planifier(m); await HL.attendreHorsLigne();
    const pret = HL.fichierPret(m, MOI, t.id);
    assert.ok(pret && existsSync(pret.chemin) && pret.taille === 5000, 'la version légère est prête, dans le dossier de Vénus');

    // La sauvegarde : la liste des téléchargements et la bibliothèque y sont, jamais la vidéo convertie.
    const noms = backupManifest(odinPaths(home)).map((f) => f.name);
    assert.ok(noms.includes('valhalla/freyja/hors_ligne.jsonl') && noms.includes('valhalla/freyja/oeuvres.jsonl'), 'la liste et la bibliothèque de Vénus sont sauvegardées');
    assert.deepEqual(noms.filter((n) => n.endsWith('.mp4')), [], 'aucune version légère dans la sauvegarde');

    // Restaurée sur une autre machine : la ligne « prête » revient, pas sa vidéo.
    restoreBackup(odinPaths(ailleurs), createBackup(odinPaths(home), 'motdepasse-solide'), 'motdepasse-solide');
    oublierMagasins(); const m2 = magasinVenus(ailleurs, dirVenus(ailleurs));
    assert.equal(m2.get('hors_ligne', t.id)?.data.etat, 'ready', 'la ligne est revenue avec la sauvegarde');
    assert.ok(!existsSync(join(HL.dossierHorsLigne(m2), `${t.id}.mp4`)), 'pas sa vidéo');
    // « Enregistrer » sur cette ligne : un refus propre, jamais une erreur du serveur.
    let r = await appel(ailleurs, 'GET', `/venus/api/telechargements/${t.id}/fichier`);
    assert.equal(r.code, 404); assert.match(String(r.json.error), /n’est pas \(ou plus\) prêt/);
    // La liste ne montre pas un « Prêt » qui n'enregistrerait rien : la ligne est retirée.
    r = await appel(ailleurs, 'GET', '/venus/api/telechargements');
    assert.equal(r.code, 200); assert.deepEqual(r.json, []);
    assert.equal(m2.get('hors_ligne', t.id), undefined);
    // Redemandé, le titre est préparé de nouveau (une ligne neuve, pas l'ancienne rendue telle quelle).
    m2.poser('hors_ligne', t.id, { profil: MOI, cible: 'film:a', titre: 'Le Phare', quality: '720p', etat: 'ready', progress: 100, taille: 5000, cree: 1, expire: Date.now() + 3600_000 });
    const t2 = HL.demanderLegere(m2, { profil: MOI, itemId: 'film:a', quality: '720p' }) as { id: string; state: string };
    assert.notEqual(t2.id, t.id); assert.equal(t2.state, 'queued');
    await HL.planifier(m2); await HL.attendreHorsLigne();
    const l = HL.taches(m2, MOI);
    assert.deepEqual(l.map((x) => [x.id, x.state]), [[t2.id, 'ready']]);
    assert.ok(existsSync(HL.fichierPret(m2, MOI, t2.id)?.chemin ?? ''));
    // Une ligne prête qui a sa vidéo n'est jamais retirée ; la saison compte juste après une restauration.
    assert.equal(HL.taches(m2, MOI).length, 1);
    m2.poser('hors_ligne', 'dl-111111111111', { profil: MOI, cible: 'serie:s:s1e1', titre: 'Les Îles S01E01', quality: '480p', etat: 'ready', progress: 100, taille: 10, cree: 2, expire: Date.now() + 3600_000 });
    const s = HL.demanderSaison(m2, { profil: MOI, serieId: 'serie:s', saison: 1, quality: '480p' }) as Array<{ id: string; state: string }>;
    assert.ok(Array.isArray(s) && s.length === 2 && s.every((x) => x.state === 'queued' && x.id !== 'dl-111111111111'), 'l’épisode « prêt » sans vidéo est redemandé avec la saison');
  } finally { HL.reglerOutilsHorsLigne(); for (const x of [home, media, ailleurs]) rmSync(x, { recursive: true, force: true }); }
});
