// Vénus, l'administration, première part : le tableau de bord (pages/Dashboard.js du dépôt Venus), côté Odin. Ce que
// la page lit vient de ce qu'Odin garde déjà : la bibliothèque et ses comptes, la reprise des lectures (« En ce
// moment »), l'historique, le journal de Comète, les versions légères, les écrans connus, les dossiers des
// médiathèques, et une petite table bornée pour les analyses. Réservé au profil administrateur (le propriétaire) :
// un autre profil, un enfant, un membre n'y lisent rien. La santé n'affiche que ce qu'Odin sait lire ici, jamais un
// faux 0 %. Aucun réseau : le magasin de Vénus en fichiers, de faux req/res, des sources de santé simulées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEF_FREYJA, dirVenus, magasinVenus, oublierMagasins, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { venusRoute } from '../src/valhalla/venus/routes.ts';
import { ajouterDossier, ajouterHistorique, noterReprise } from '../src/valhalla/venus/bibliotheque.ts';
import { noter } from '../src/valhalla/venus/comete/index.ts';
import { brancherPersona } from '../src/valhalla/sso/registre.ts';
import { sha256hex } from '../src/valhalla/sso/jwt.ts';
import * as E from '../src/valhalla/venus/entretien.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-v9a-tableau-'));
const AN = new Date().getFullYear();
const JETON = 'a'.repeat(43);
/** Deux profils inventés : Noé (8 ans, profil enfant) et Lou (adulte, pas administrateur) ; Lou a une session de membre. */
function personaFaux(home: string): void {
  const ctx = { home, dir: home, settings: { people: [{ login: 'noe', name: 'Noé', active: true, naissance: AN - 8 }, { login: 'lou', name: 'Lou', active: true, naissance: 1990 }], sessions: [{ id: sha256hex(JETON), login: 'lou', expires: Date.now() + 3600e3, ou: 'odin', seen: Date.now() }] }, saveSettings() {} };
  brancherPersona(() => ctx as never, (t: string, c: string) => `<p>${t}${c}</p>`);
}
const sansPersona = () => brancherPersona(() => undefined, (t: string) => t);
/** Des sources de santé qui ne savent rien (comme une machine où Odin ne lit pas ces mesures). */
const SANTE_MUETTE = { cpus: () => [], memTotale: () => 0, memLibre: () => 0, place: () => undefined };

/**
 * Une bibliothèque d'essai : un film, une série animée de deux épisodes, un clip, leurs fichiers (tailles connues),
 * deux dossiers déclarés (l'un présent, l'autre introuvable). Titres et dossiers inventés.
 */
function bibli(m: MagasinVenus, media: string): { films: string; absent: string } {
  const films = join(media, 'films'), series = join(media, 'animes'); mkdirSync(films); mkdirSync(series);
  const absent = join(media, 'debranche');
  const fich = (chemin: string, taille: number) => { writeFileSync(chemin, Buffer.alloc(16, 1)); m.poser('fichiers', chemin.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(-199), { chemin, taille, mtime: 1 }); };
  const f = join(films, 'Le Phare (2020).mkv'); fich(f, 2_000_000_000);
  m.poser('oeuvres', 'film:a', { type: 'film', titre: 'Le Phare', annee: 2020, duree: 6000, fichier: f });
  const c = join(films, 'Chanson.mp4'); fich(c, 100_000_000);
  m.poser('oeuvres', 'film:c', { type: 'film', categorie: 'clip', titre: 'Chanson', duree: 240, fichier: c });
  m.poser('oeuvres', 'serie:s', { type: 'serie', categorie: 'anime', titre: 'Les Îles' });
  for (const ep of [1, 2]) {
    const e = join(series, `Les Iles S01E0${ep}.mkv`); fich(e, 500_000_000);
    m.poser('episodes', `serie:s:s1e${ep}`, { oeuvre_id: 'serie:s', saison: 1, episode: ep, titre: 'Les Îles', fichier: e, duree: 1440 });
  }
  ajouterDossier(m, films, 'films'); ajouterDossier(m, series, 'series'); ajouterDossier(m, absent, 'films');
  return { films, absent };
}

function fakeReq(method: string, headers: Record<string, string> = { 'x-odin': '1' }, body?: unknown): IncomingMessage {
  const r = Readable.from(body !== undefined ? [Buffer.from(JSON.stringify(body))] : []) as unknown as IncomingMessage;
  Object.assign(r, { method, headers });
  return r;
}
class FakeRes extends Writable {
  code?: number; body = '';
  writeHead(code: number): this { this.code = code; return this; }
  _write(chunk: Buffer, _e: string, cb: () => void): void { this.body += chunk.toString(); cb(); }
}
async function appel(home: string, method: string, chemin: string, o: { proprietaire?: boolean; headers?: Record<string, string> } = {}) {
  const res = new FakeRes();
  const ctx = { home, proprietaire: () => o.proprietaire !== false, fail: () => undefined, origin: 'http://odin.test', ip: '10.0.0.7', profil: 'moi' };
  const handled = await venusRoute(fakeReq(method, o.headers), res as unknown as ServerResponse, new URL(`http://x${chemin}`), ctx);
  if (!res.writableFinished) await new Promise<void>((r) => { res.once('finish', () => r()); setTimeout(r, 500); });
  let json: Record<string, unknown> = {}; try { json = JSON.parse(res.body) as Record<string, unknown>; } catch { /* pas du JSON */ }
  return { handled, code: res.code, json, body: res.body };
}
const IP = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;

test('la base de Vénus a une petite table pour les analyses (journal), et elle reste bornée', () => {
  assert.ok(DEF_FREYJA.migrations.some((x) => /CREATE TABLE journal \(id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL\)/.test(x.sql)), 'table journal dans VENUS_ODIN');
  const home = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home));
    for (let i = 0; i < E.JOURNAL_MAX + 25; i++) E.noterActivite(m, { genre: 'analyse', ajoutes: i, introuvables: 0 });
    assert.equal(m.liste('journal').length, E.JOURNAL_MAX, 'les plus anciennes lignes partent');
  } finally { oublierMagasins(); rmSync(home, { recursive: true, force: true }); }
});

test('tableau : une bibliothèque vide dit zéro, et rien d’inventé', () => {
  const home = tmp();
  try {
    oublierMagasins(); sansPersona(); E.reglerSourcesSante(SANTE_MUETTE);
    const d = E.tableau(magasinVenus(home, dirVenus(home)), home);
    assert.deepEqual(d.counts, { movie: 0, show: 0, anime: 0, clip: 0, episode: 0 });
    assert.deepEqual(d.totals, { size: 0, hours: 0 }, 'rien à compter : zéro, connu');
    assert.deepEqual(d.playing, []); assert.deepEqual(d.activity, []); assert.deepEqual(d.libraries, []); assert.deepEqual(d.devices, []);
    assert.equal(d.transcodes, 0);
    assert.equal(d.tasks.scan.running, false); assert.equal(d.tasks.scan.last, undefined, 'aucune analyse notée : rien d’affirmé');
    assert.ok(d.server.uptime >= 0 && typeof d.server.zone === 'string' && d.server.zone.length > 0);
  } finally { E.reglerSourcesSante(); oublierMagasins(); rmSync(home, { recursive: true, force: true }); }
});

test('tableau : comptes, lecture en cours, activité, tâches, médiathèques et écrans, lus dans ce qu’Odin garde', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); personaFaux(home); E.reglerSourcesSante(SANTE_MUETTE);
    const m = magasinVenus(home, dirVenus(home)); const { films, absent } = bibli(m, media);
    const now = Date.now();
    // Lou regarde le film en ce moment (la reprise vient d'être notée) ; Noé a un épisode noté il y a 10 min (plus en cours) ;
    // le propriétaire a fini l'autre épisode (vu : plus en cours).
    noterReprise(m, 'p:lou', 'film:a', 600, 6000);
    noterReprise(m, 'p:noe', 'serie:s:s1e1', 300, 1440);
    const vieux = m.get('reprise', 'p:noe:serie:s:s1e1')!; m.poser('reprise', vieux.id, { ...vieux.data, maj: now - 10 * 60_000 });
    noterReprise(m, 'moi', 'serie:s:s1e2', 1440, 1440);
    ajouterHistorique(m, 'p:lou', 'film:a', 'video', 'Le Phare');
    noter(m, 'terminé', { id: 't1', titre: 'Les Îles S01E02' }, '1 octets');
    noter(m, 'échec', { id: 't2', titre: 'Un autre titre' }, 'source muette');
    m.poser('hors_ligne', 'dl-aaaaaaaaaaaa', { profil: 'moi', cible: 'film:a', titre: 'Le Phare', quality: '720p', etat: 'ready', progress: 100, cree: now - 5000, fini: now - 4000 });
    m.poser('hors_ligne', 'dl-bbbbbbbbbbbb', { profil: 'p:lou', cible: 'serie:s:s1e1', titre: 'Les Îles S01E01', quality: '480p', etat: 'working', progress: 40, cree: now - 3000 });
    m.poser('ecrans', 'media_player.salon', { nom: 'Télé de la véranda', type: 'tv', vu: now - 60_000 });
    await E.suivreAnalyse(m, async () => ({ oeuvres: 3, dossiersIntrouvables: [absent] }));

    const d = E.tableau(m, home);
    assert.deepEqual(d.counts, { movie: 1, show: 0, anime: 1, clip: 1, episode: 2 });
    assert.deepEqual(d.totals, { size: 3_100_000_000, hours: Math.round((6000 + 240 + 2 * 1440) / 3600) });

    assert.equal(d.playing.length, 1, 'seule la lecture notée à l’instant est « en ce moment »');
    const p = d.playing[0];
    assert.equal(p.title, 'Le Phare'); assert.equal(p.itemId, 'film:a'); assert.equal(p.profile, 'Lou');
    assert.equal(p.position, 600); assert.equal(p.duration, 6000);
    assert.ok(!('ip' in p) && !IP.test(JSON.stringify(d.playing)), 'jamais une adresse IP');

    const kinds = d.activity.map((a) => a.kind);
    assert.ok(kinds.includes('play') && kinds.includes('scan') && kinds.includes('seerr') && kinds.includes('legere'), kinds.join(','));
    assert.equal(d.activity.filter((a) => a.kind === 'seerr').length, 1, 'seul le téléchargement rangé est une activité');
    assert.ok(d.activity.every((a, i) => i === 0 || d.activity[i - 1].at >= a.at), 'les plus récentes d’abord');
    const scan = d.activity.find((a) => a.kind === 'scan')!; assert.equal(scan.n, 3); assert.equal(scan.missing, 1);
    assert.equal(d.activity.find((a) => a.kind === 'play')!.who, 'Lou');
    assert.equal(d.activity.find((a) => a.kind === 'legere')!.quality, '720p');

    assert.equal(d.tasks.scan.running, false); assert.equal(d.tasks.scan.last!.n, 3);
    assert.deepEqual(d.tasks.legeres, { working: 1, queued: 0, progress: 40 });
    assert.equal(typeof d.tasks.vignettes, 'number'); assert.equal(d.tasks.fiches, 0, 'sans catalogue réglé, aucune fiche attendue');

    const libs = d.libraries;
    assert.equal(libs.length, 3);
    const lf = libs.find((l) => l.path === films)!; assert.equal(lf.exists, true); assert.equal(lf.items, 2, 'le film et le clip');
    assert.equal(libs.find((l) => l.category === 'series')!.items, 1, 'la série, une fois');
    const la = libs.find((l) => l.path === absent)!; assert.equal(la.exists, false); assert.equal(la.items, 0);

    assert.deepEqual(d.devices, [{ name: 'Télé de la véranda', type: 'tv', seen: now - 60_000 }]);
  } finally { E.reglerSourcesSante(); sansPersona(); oublierMagasins(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

test('une analyse en cours se voit dans les tâches, et un échec est noté sans son message', async () => {
  const home = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home));
    let fin: () => void = () => undefined;
    const enCours = E.suivreAnalyse(m, () => new Promise<{ oeuvres: number; dossiersIntrouvables: string[] }>((ok) => { fin = () => ok({ oeuvres: 0, dossiersIntrouvables: [] }); }));
    assert.equal(E.tableau(m, home).tasks.scan.running, true);
    fin(); await enCours;
    assert.equal(E.tableau(m, home).tasks.scan.running, false);
    await assert.rejects(E.suivreAnalyse(m, async () => { throw new Error('C:/un/chemin/secret'); }));
    const t = E.tableau(m, home);
    assert.equal(t.tasks.scan.last!.error, true);
    assert.ok(!JSON.stringify(t).includes('secret'), 'le message d’erreur (qui peut porter un chemin) n’est pas gardé');
  } finally { oublierMagasins(); rmSync(home, { recursive: true, force: true }); }
});

test('santé : sans source, « absente » avec sa raison, jamais 0 % ; avec les sources, les vraies mesures', () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); ajouterDossier(m, media, 'films');
    E.reglerSourcesSante(SANTE_MUETTE);
    let s = E.tableau(m, home).system;
    assert.deepEqual(s.cpu, { absent: 'aucune' }); assert.deepEqual(s.mem, { absent: 'aucune' }); assert.deepEqual(s.disks, { absent: 'aucune' });
    assert.ok(!/"pct":0\b/.test(JSON.stringify(s)), 'jamais un 0 % faute de source');
    // Le processeur se mesure entre deux relevés : au premier, Odin le dit « en mesure », jamais 0 %.
    let tour = 0;
    const coeur = (idle: number, user: number) => ({ model: 'x', speed: 0, times: { user, nice: 0, sys: 0, idle, irq: 0 } });
    E.reglerSourcesSante({ cpus: () => (tour++ === 0 ? [coeur(100, 100), coeur(100, 100)] : [coeur(150, 250), coeur(150, 250)]), memTotale: () => 8e9, memLibre: () => 2e9, place: () => ({ total: 1e12, libre: 4e11 }) });
    s = E.tableau(m, home).system;
    assert.deepEqual(s.cpu, { absent: 'mesure' });
    assert.deepEqual(s.mem, { total: 8e9, free: 2e9 });
    assert.deepEqual(s.disks, [{ total: 1e12, free: 4e11, categories: ['films'] }]);
    s = E.tableau(m, home).system;
    assert.ok('pct' in s.cpu && Math.abs(s.cpu.pct - 75) < 1e-9, JSON.stringify(s.cpu));
    assert.equal('cores' in s.cpu && s.cpu.cores, 2);
  } finally { E.reglerSourcesSante(); oublierMagasins(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

test('route du tableau : le propriétaire seul ; un autre profil, un enfant, un membre n’y lisent rien (ni chemin, ni adresse)', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); personaFaux(home); E.reglerSourcesSante(SANTE_MUETTE);
    const m = magasinVenus(home, dirVenus(home)); const { films } = bibli(m, media);
    noterReprise(m, 'p:lou', 'film:a', 600, 6000);
    let r = await appel(home, 'GET', '/venus/api/tableau');
    assert.equal(r.code, 200); assert.equal((r.json.counts as Record<string, number>).movie, 1);
    assert.ok(r.body.includes(JSON.stringify(films).slice(1, -1)), 'le chemin des dossiers, pour l’administrateur');
    assert.ok(!IP.test(r.body), 'aucune adresse IP');
    for (const qui of ['p:lou', 'p:noe']) {
      r = await appel(home, 'GET', '/venus/api/tableau', { headers: { 'x-odin': '1', 'x-venus-profil': qui } });
      assert.equal(r.code, 403, `${qui} refusé`);
      assert.ok(!r.body.includes('films') && !r.body.includes(media.slice(3)) && !IP.test(r.body), `${qui} : rien du tableau`);
    }
    r = await appel(home, 'GET', '/venus/api/tableau', { headers: { 'x-odin': '1', cookie: `odin_session=${JETON}` } });
    assert.equal(r.code, 401, 'la session d’un membre n’entre pas dans Vénus');
    r = await appel(home, 'GET', '/venus/api/tableau', { proprietaire: false }); assert.equal(r.code, 401);
    r = await appel(home, 'POST', '/venus/api/tableau'); assert.equal(r.code, 405, 'lecture seule');
  } finally { E.reglerSourcesSante(); sansPersona(); oublierMagasins(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

test('« Analyser » passe par l’analyse qui existe (POST /venus/scan) : elle est notée dans l’activité', async () => {
  const home = tmp();
  try {
    oublierMagasins(); sansPersona(); E.reglerSourcesSante(SANTE_MUETTE);
    const m = magasinVenus(home, dirVenus(home));
    const r = await appel(home, 'POST', '/venus/scan');
    assert.equal(r.code, 200);
    const d = E.tableau(m, home);
    assert.equal(d.activity.filter((a) => a.kind === 'scan').length, 1);
    assert.equal(d.tasks.scan.last!.n, 0);
  } finally { E.reglerSourcesSante(); oublierMagasins(); rmSync(home, { recursive: true, force: true }); }
});
