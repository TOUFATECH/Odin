// Vénus, l'administration, deuxième part : la page Qualité (pages/Quality.js du dépôt Venus), côté Odin et côté page.
// Chaque constat vient de ce que l'analyse d'Odin a déjà lu de chaque fichier (la taille de l'image, le codec vidéo,
// le poids, la durée) ; ce qu'Odin ne mesure pas (HDR, son 5.1, conversions des 30 derniers jours) n'a pas de ligne.
// Réservé au profil administrateur (le propriétaire) : un autre profil, un enfant, un membre n'y lisent rien ; aucun
// chemin de fichier n'est servi. « Meilleure version » n'est pas construite : Hnoss tient pour « disponible » un titre
// déjà dans la bibliothèque et ne le refait pas venir ; la page n'a donc aucune action qui écrit.
// Aucun réseau : le magasin de Vénus en fichiers, de faux req/res, la page dans un bac à sable sans navigateur.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import vm from 'node:vm';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirVenus, magasinVenus, oublierMagasins, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { venusRoute } from '../src/valhalla/venus/routes.ts';
import { ajouterDossier } from '../src/valhalla/venus/bibliotheque.ts';
import { brancherPersona } from '../src/valhalla/sso/registre.ts';
import { sha256hex } from '../src/valhalla/sso/jwt.ts';
import * as E from '../src/valhalla/venus/entretien.ts';

const tmp = (n = 'venus-v9b-qualite-') => mkdtempSync(join(tmpdir(), n));
const AN = new Date().getFullYear();
const JETON = 'b'.repeat(43);
/** Deux profils inventés : Noé (8 ans, profil enfant) et Lou (adulte, pas administrateur) ; Lou a une session de membre. */
function personaFaux(home: string): void {
  const ctx = { home, dir: home, settings: { people: [{ login: 'noe', name: 'Noé', active: true, naissance: AN - 8 }, { login: 'lou', name: 'Lou', active: true, naissance: 1990 }], sessions: [{ id: sha256hex(JETON), login: 'lou', expires: Date.now() + 3600e3, ou: 'odin', seen: Date.now() }] }, saveSettings() {} };
  brancherPersona(() => ctx as never, (t: string, c: string) => `<p>${t}${c}</p>`);
}
const sansPersona = () => brancherPersona(() => undefined, (t: string) => t);

/** Un titre piégé : du HTML et un nom très long. */
const PIEGE = `<img src=x onerror="alert(1)">${'Un titre vraiment très long '.repeat(12)}`;
/**
 * Une bibliothèque d'essai (titres et dossiers inventés), telle que l'analyse d'Odin l'aurait rangée : pour chaque
 * fichier, sa taille et ce que ffprobe en a lu (largeur, hauteur, codecs). Un film sans défaut, un 4K, trois à défauts
 * (définition basse et codec ancien, débit faible, une série en 720p), un titre piégé, un film dont l'analyse n'a rien
 * lu, et un clip (l'appli d'origine ne compte que films et épisodes).
 */
function bibli(m: MagasinVenus, media: string): { films: string } {
  const films = join(media, 'films'), series = join(media, 'animes'); mkdirSync(films); mkdirSync(series);
  const fich = (chemin: string, taille: number, probe?: Record<string, unknown>) => { writeFileSync(chemin, Buffer.alloc(16, 1)); m.poser('fichiers', chemin.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(-199), { chemin, taille, mtime: 1, ...(probe ? { probe } : {}) }); };
  const film = (id: string, titre: string, annee: number, taille: number, duree: number, l: number, h: number, codec: string, extra: Record<string, unknown> = {}) => {
    const f = join(films, `${id.replace(/\W/g, '')}.mkv`); fich(f, taille, { duree, largeur: l, hauteur: h, codecs: [codec], audio: ['aac'], sousTitres: [] });
    m.poser('oeuvres', id, { type: 'film', titre, annee, duree, fichier: f, resolution: `${h}p`, codecs: [codec], ...extra });
  };
  film('film:net', 'Le Verger', 2020, 4_000_000_000, 6000, 1920, 1080, 'hevc');
  film('film:4k', 'La Montagne', 2022, 18_000_000_000, 7200, 3840, 2160, 'hevc');
  film('film:sd', 'Vieux Film', 1990, 700_000_000, 5400, 640, 480, 'mpeg4');
  film('film:faible', 'Gravier', 2018, 500_000_000, 6000, 1920, 1080, 'h264');
  film('film:piege', PIEGE, 2021, 3_000_000_000, 6000, 1920, 1080, 'h264');
  film('film:clip', 'Chanson', 2023, 50_000_000, 240, 640, 360, 'mpeg4', { categorie: 'clip' });
  const sansLecture = join(films, 'inconnu.mkv'); fich(sansLecture, 1_000_000_000);
  m.poser('oeuvres', 'film:inconnu', { type: 'film', titre: 'Sans lecture', annee: 2000, duree: 6000, fichier: sansLecture });
  m.poser('oeuvres', 'serie:s', { type: 'serie', categorie: 'anime', titre: 'Les Îles' });
  for (const ep of [1, 2]) {
    const e = join(series, `Les Iles S01E0${ep}.mkv`); fich(e, 400_000_000, { duree: 1440, largeur: 1280, hauteur: 720, codecs: ['h264'], audio: ['aac'], sousTitres: [] });
    m.poser('episodes', `serie:s:s1e${ep}`, { oeuvre_id: 'serie:s', saison: 1, episode: ep, titre: 'Les Îles', fichier: e, duree: 1440, resolution: '720p', codecs: ['h264'] });
  }
  ajouterDossier(m, films, 'films'); ajouterDossier(m, series, 'series');
  return { films };
}

function fakeReq(method: string, headers: Record<string, string> = { 'x-odin': '1' }): IncomingMessage {
  const r = Readable.from([]) as unknown as IncomingMessage;
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

/** Les données qu'un Odin jetable calcule, pour la page. */
function donnees(vide = false): E.Qualite {
  const home = tmp(), media = tmp('venus-v9b-media-');
  try {
    oublierMagasins(); sansPersona();
    const m = magasinVenus(home, dirVenus(home));
    if (!vide) bibli(m, media);
    return E.qualite(m);
  } finally { oublierMagasins(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- côté Odin
test('qualite : chaque constat vient de ce que l’analyse a lu de chaque fichier', () => {
  const d = donnees();
  assert.equal(d.summary.total, 6, 'le film sans lecture et le clip ne sont pas comptés');
  assert.deepEqual(d.summary.byRes, { SD: 1, '720p': 1, '1080p': 3, '4K': 1 });
  assert.equal(d.summary.toImprove, 3);
  assert.equal(d.summary.size, 4e9 + 18e9 + 7e8 + 5e8 + 3e9 + 2 * 4e8);
  assert.deepEqual(d.summary.codecs, [['H264', 3], ['HEVC', 2], ['MPEG4', 1]]);
  const par = new Map(d.items.map((x) => [x.id, x]));
  assert.deepEqual(par.get('film:net')!.reasons, [], 'un fichier sans défaut');
  assert.equal(par.get('film:net')!.res, '1080p'); assert.equal(par.get('film:net')!.codec, 'HEVC');
  assert.equal(par.get('film:4k')!.res, '4K');
  assert.deepEqual(par.get('film:sd')!.reasons, [{ code: 'sd' }, { code: 'codec', codec: 'MPEG4' }]);
  assert.deepEqual(par.get('film:faible')!.reasons, [{ code: 'debit' }], 'débit moyen lu du poids et de la durée');
  const s = par.get('serie:s')!;
  assert.equal(s.type, 'show'); assert.equal(s.kind, 'anime'); assert.equal(s.files, 2); assert.equal(s.res, '720p');
  assert.deepEqual(s.reasons, [{ code: '720p' }]);
  assert.equal(s.size, 8e8); assert.equal(s.sizePerHour, 8e8 / (2880 / 3600));
  assert.equal(par.get('film:piege')!.title, PIEGE.trim(), 'le titre tel quel (la page l’échappe)');
  assert.ok(!par.has('film:inconnu') && !par.has('film:clip'));
});

test('qualite : ce qu’Odin ne mesure pas n’a pas de ligne, et aucun chemin n’est servi', () => {
  const d = donnees(), j = JSON.stringify(d);
  for (const k of ['hdr', 'surround', 'bitrate', 'transcodes', 'chemin', 'fichier', 'path', 'seerr']) assert.ok(!j.includes(`"${k}"`), `pas de « ${k} »`);
  assert.ok(!/\.mkv/.test(j), 'aucun nom de fichier');
});

test('qualite : une bibliothèque vide le dit, sans rien inventer', () => {
  const d = donnees(true);
  assert.deepEqual(d.items, []);
  assert.deepEqual(d.summary, { total: 0, size: 0, byRes: { SD: 0, '720p': 0, '1080p': 0, '4K': 0 }, toImprove: 0, codecs: [] });
});

test('route de la qualité : le propriétaire seul ; un autre profil, un enfant, un membre n’y lisent rien ; lecture seule', async () => {
  const home = tmp(), media = tmp('venus-v9b-media-');
  try {
    oublierMagasins(); personaFaux(home);
    const m = magasinVenus(home, dirVenus(home)); const { films } = bibli(m, media);
    let r = await appel(home, 'GET', '/venus/api/qualite');
    assert.equal(r.code, 200); assert.equal((r.json.summary as { total: number }).total, 6);
    assert.ok(!r.body.includes(JSON.stringify(films).slice(1, -1)) && !r.body.includes('.mkv'), 'aucun chemin, même pour l’administrateur');
    for (const qui of ['p:lou', 'p:noe']) {
      r = await appel(home, 'GET', '/venus/api/qualite', { headers: { 'x-odin': '1', 'x-venus-profil': qui } });
      assert.equal(r.code, 403, `${qui} refusé`);
      assert.ok(!r.body.includes('Verger') && !r.body.includes('H264') && !r.body.includes(media.slice(3)), `${qui} : rien de la qualité`);
    }
    r = await appel(home, 'GET', '/venus/api/qualite', { headers: { 'x-odin': '1', cookie: `odin_session=${JETON}` } });
    assert.equal(r.code, 401, 'la session d’un membre n’entre pas dans Vénus');
    r = await appel(home, 'GET', '/venus/api/qualite', { proprietaire: false }); assert.equal(r.code, 401);
    r = await appel(home, 'POST', '/venus/api/qualite'); assert.equal(r.code, 405, 'lecture seule');
  } finally { sansPersona(); oublierMagasins(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- côté page (app.js, sans navigateur)
const APP = new URL('../src/valhalla/venus/app/', import.meta.url);
const SRC = { planetes: readFileSync(new URL('planetes.js', APP), 'utf8'), app: readFileSync(new URL('app.js', APP), 'utf8') };
type Fn = (...a: unknown[]) => unknown;
const attendre = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const BIENTOT = 'Cette partie de Venus arrive dans Odin avec un prochain lot.';
const ADMIN = { id: 'moi', name: 'Maison', isAdmin: true, avatar: 0 };
interface Appel { chemin: string; methode: string }
const quitter: Array<() => void> = [];
after(() => { for (const q of quitter) q(); });
async function ouvrir(o: { lang?: string; hash?: string; profils?: Array<Record<string, unknown>>; qualite?: unknown; tableau?: unknown } = {}) {
  const appels: Appel[] = [], ecouteurs: Record<string, Fn[]> = {};
  const on = (k: string, f: Fn) => { (ecouteurs[k] ??= []).push(f); };
  const app = { innerHTML: '', removeAttribute() {} };
  const elFaux = (): Record<string, unknown> => ({ className: '', style: {}, dataset: {}, classList: { add() {}, toggle() {}, remove() {} }, setAttribute() {}, addEventListener() {}, remove() {}, append() {}, querySelector: () => ({ focus() {} }), querySelectorAll: () => [], focus() {}, innerHTML: '' });
  const root = { lang: o.lang ?? 'fr', dataset: {} as Record<string, string>, style: { setProperty() {} }, classList: { toggle() {}, add() {} } };
  const location = { hash: o.hash ?? '#/', href: 'http://127.0.0.1/venus/app/' };
  const doc: Record<string, unknown> = {
    documentElement: root, body: elFaux(), title: '', styleSheets: [], cookie: '', hidden: false,
    getElementById: (id: string) => (id === 'app' ? app : null), querySelector: (s: string) => (s === '#app' ? app : null), querySelectorAll: () => [],
    createElement: elFaux, addEventListener: on, contains: () => false, activeElement: null,
  };
  const rep = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const win: Record<string, unknown> = {
    navigator: { language: o.lang ?? 'fr-FR' }, addEventListener: on, location, scrollY: 0, innerWidth: 1280, innerHeight: 800,
    history: { length: 1, replaceState: (_a: unknown, _b: unknown, h: string) => { location.hash = h; }, back() {} },
    scrollTo() {}, requestAnimationFrame: (f: Fn) => setTimeout(f, 0), matchMedia: (q: string) => ({ matches: /reduced-motion/.test(q), addEventListener() {} }),
    fetch: async (chemin: string, x: { method?: string } = {}) => {
      appels.push({ chemin, methode: x.method ?? 'GET' });
      if (chemin === '/venus/api/profils') return rep({ profils: o.profils ?? [ADMIN], actuel: String((o.profils ?? [ADMIN])[0].id), choisi: true });
      if (chemin === '/venus/api/preferences') return rep({ preferences: {} });
      if (chemin === '/venus/api/catalogue') return rep({ titres: [] });
      if (chemin === '/venus/api/qualite') return rep(o.qualite ?? {}, o.qualite ? 200 : 403);
      if (chemin === '/venus/api/tableau') return rep(o.tableau ?? {}, o.tableau ? 200 : 403);
      return rep({});
    },
  };
  const ctx = vm.createContext({ ...win, window: win, document: doc, URLSearchParams, Intl, setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} } });
  vm.runInContext(SRC.planetes, ctx); vm.runInContext(SRC.app, ctx);
  quitter.push(() => { location.hash = '#/'; for (const f of ecouteurs.hashchange ?? []) f(); });
  for (let k = 0; k < 100; k++) { await attendre(20); if (app.innerHTML && !/aria-busy="true"/.test(app.innerHTML)) break; }
  return {
    app, appels, location,
    async cliquer(data: Record<string, string>) {
      const el = { dataset: data, closest: (s: string) => (s === '[data-act]' ? el : null), getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10 }), classList: { toggle() {} }, setAttribute() {}, parentElement: { querySelector: () => null } };
      for (const f of ecouteurs.click ?? []) await f({ target: el, clientX: 80, preventDefault() {}, stopPropagation() {} });
      await attendre(120);
    },
  };
}
const texte = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\s+/g, ' ');
const lignes = (h: string) => (h.match(/class="q-row"/g) ?? []).length;

test('la page Qualité est construite : rubriques de Quality.js, mêmes classes, même ordre ; « À améliorer » d’abord', async () => {
  const p = await ouvrir({ hash: '#/qualite', qualite: donnees() });
  const h = p.app.innerHTML, t = texte(h);
  assert.ok(!h.includes(BIENTOT), 'la page existe');
  assert.match(h, /<h1 tabindex="-1">Qualité<\/h1><p class="count">/); assert.match(t, /Qualité 6 titres · 27,0 Go/);
  for (const c of ['q-summary', 'dash-box q-improve', 'q-bar', 'toolbar', 'seg', 'q-list']) assert.ok(h.includes(`class="${c}"`), c);
  let i = 0; for (const x of ['Définition', '4K', '1080p', '720p', 'SD', 'Codecs vidéo', 'H264', 'HEVC', 'MPEG4', 'titres pourraient être en meilleure qualité', 'À améliorer', 'Tout', '4K', '1080p', '720p', 'SD']) { const j = t.indexOf(x, i); assert.ok(j >= 0, `« ${x} » à sa place`); i = j; }
  assert.match(h, /class="seg-b f on" aria-pressed="true" data-act="qtab" data-v="improve">À améliorer<small> 3<\/small>/);
  assert.equal(lignes(h), 3, 'les trois titres à améliorer');
  assert.match(t, /Basse définition · Ancien codec \(MPEG4\)/); assert.match(t, /Débit faible, image compressée/); assert.match(t, /720p seulement/);
  assert.match(h, /<a class="q-main f" href="#\/titre\/serie%3As">/);
  assert.match(t, /2 épisodes · 800 Mo · 1,0 Go\/h/);
});

test('chaque rubrique rend ses vrais constats ; la rubrique tient dans l’adresse et au rechargement', async () => {
  const d = donnees();
  const p = await ouvrir({ hash: '#/qualite', qualite: d });
  const attendu: Record<string, string[]> = { all: ['Le Verger', 'La Montagne', 'Vieux Film', 'Gravier', 'Les Îles', 'Un titre vraiment'], '4K': ['La Montagne'], '1080p': ['Le Verger', 'Gravier', 'Un titre vraiment'], '720p': ['Les Îles'], SD: ['Vieux Film'] };
  for (const [v, titres] of Object.entries(attendu)) {
    await p.cliquer({ act: 'qtab', v });
    assert.equal(p.location.hash, `#/qualite?tab=${v}`);
    const h = p.app.innerHTML;
    assert.equal(lignes(h), titres.length, v);
    for (const x of titres) assert.ok(texte(h).includes(x), `${v} : ${x}`);
  }
  // Le film sans défaut n'a aucune raison écrite sous son titre.
  await p.cliquer({ act: 'qtab', v: 'all' });
  const h0 = p.app.innerHTML, ligne = h0.slice(h0.indexOf('<b title="Le Verger">'), h0.indexOf('</a>', h0.indexOf('<b title="Le Verger">')));
  assert.equal(texte(ligne).trim(), 'Le Verger 2020 · 4,0 Go · 2,4 Go/h'); assert.ok(!ligne.includes('<em>'));
  const q = await ouvrir({ hash: '#/qualite?tab=SD', qualite: d });
  assert.match(q.app.innerHTML, /class="seg-b f on" aria-pressed="true" data-act="qtab" data-v="SD"/);
  assert.equal(lignes(q.app.innerHTML), 1);
});

test('une bibliothèque vide le dit calmement ; rien n’est déclaré « en bonne qualité » par défaut', async () => {
  const p = await ouvrir({ hash: '#/qualite', qualite: donnees(true) });
  const t = texte(p.app.innerHTML);
  assert.match(t, /Aucun titre\./);
  assert.ok(!/bonne qualité/.test(t), 'aucune affirmation sans titre lu');
  assert.ok(!p.app.innerHTML.includes('q-improve'));
});

test('une bibliothèque sans défaut le dit (d’après ses vrais constats)', async () => {
  const d = donnees(), sans = { items: d.items.filter((x) => !x.reasons.length), summary: { ...d.summary, toImprove: 0 } };
  const p = await ouvrir({ hash: '#/qualite', qualite: sans });
  const t = texte(p.app.innerHTML);
  assert.match(t, /Toute la médiathèque est en bonne qualité/);
  assert.match(p.app.innerHTML, /class="seg-b f on" aria-pressed="true" data-act="qtab" data-v="all"/, 'rien à améliorer : « Tout » d’abord');
  await p.cliquer({ act: 'qtab', v: 'improve' });
  assert.match(texte(p.app.innerHTML), /Rien à améliorer : tout est en bonne qualité\./);
});

test('ce qu’Odin ne mesure pas n’a pas de ligne ; aucune action, rien n’est envoyé', async () => {
  const p = await ouvrir({ hash: '#/qualite?tab=all', qualite: donnees() });
  const h = p.app.innerHTML, t = texte(h);
  for (const x of ['HDR', '5.1', 'Conversions évitables', 'Par appareil', 'Seerr', 'Reliez', 'Meilleure version', 'Redemander', 'Demandé']) assert.ok(!t.includes(x), `pas de « ${x} »`);
  assert.ok(!/data-v="hdr"/.test(h));
  assert.ok(!/<button(?![^>]*data-act="qtab")[^>]*>/.test(h.slice(h.indexOf('<div class="page">'), h.indexOf('</main>'))), 'aucun autre bouton que les rubriques');
  for (const v of ['improve', 'all', 'SD']) await p.cliquer({ act: 'qtab', v });
  assert.ok(p.appels.every((a) => a.methode === 'GET'), 'aucun envoi');
  assert.ok(!/\.mkv|[A-Za-z]:\\|\/tmp\//.test(h), 'aucun chemin de fichier');
});

test('un titre piégé reste du texte', async () => {
  const p = await ouvrir({ hash: '#/qualite?tab=all', qualite: donnees() });
  const h = p.app.innerHTML;
  assert.ok(!h.includes('<img src=x'), 'pas de HTML injecté');
  assert.ok(h.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
});

test('un profil enfant n’a ni l’entrée ni la page ; un autre profil voit « Réservé à l’administrateur » sans rien lire', async () => {
  let p = await ouvrir({ hash: '#/qualite', profils: [{ id: 'p:noe', name: 'Noé', avatar: 2, isKids: true }] });
  assert.ok(!p.app.innerHTML.includes('#/qualite'), 'aucune entrée');
  assert.ok(!texte(p.app.innerHTML).includes('Qualité'));
  assert.ok(!p.appels.some((a) => a.chemin === '/venus/api/qualite'));
  p = await ouvrir({ hash: '#/qualite', profils: [{ id: 'p:lou', name: 'Lou', avatar: 1 }] });
  assert.match(texte(p.app.innerHTML), /Réservé à l’administrateur/);
  assert.ok(!p.appels.some((a) => a.chemin === '/venus/api/qualite'), 'rien n’est demandé à Odin');
});

test('le tableau de bord montre le lien « Qualité » dans ses outils (Sécurité et Serveur restent absents)', async () => {
  const home = tmp();
  try {
    oublierMagasins(); E.reglerSourcesSante({ cpus: () => [], memTotale: () => 0, memLibre: () => 0, place: () => undefined });
    const tb = E.tableau(magasinVenus(home, dirVenus(home)), home);
    const p = await ouvrir({ hash: '#/dashboard', tableau: tb });
    const h = p.app.innerHTML, t = texte(h);
    assert.match(h, /<a class="set-tab f" href="#\/qualite">/);
    let i = 0; for (const x of ['Outils', 'Qualité', 'Statistiques', 'Réglages']) { const j = t.indexOf(x, i); assert.ok(j >= 0, `« ${x} » à sa place`); i = j; }
    for (const x of ['Sécurité', 'Mises à jour et journaux']) assert.ok(!t.includes(x), `pas de « ${x} »`);
    assert.ok(!/#\/securite|#\/serveur/.test(h));
  } finally { E.reglerSourcesSante(); oublierMagasins(); rmSync(home, { recursive: true, force: true }); }
});

test('en anglais : les rubriques, les constats et les nombres de la page Qualité', async () => {
  const p = await ouvrir({ hash: '#/qualite', qualite: donnees(), lang: 'en' });
  const t = texte(p.app.innerHTML);
  for (const x of ['Quality', '6 titles · 27.0 GB', 'Resolution', 'Video codecs', 'titles could be in better quality', 'To improve', 'All', 'Low definition', 'Old codec (MPEG4)', 'Low bitrate, compressed picture', '720p only', '2 episodes · 800 MB · 1.0 GB/h']) assert.ok(t.includes(x), x);
  for (const x of ['Qualité', 'Définition', 'À améliorer', 'Basse définition', 'seulement', 'Débit', 'épisodes', 'Go']) assert.ok(!t.includes(x), `pas de français : ${x}`);
});
