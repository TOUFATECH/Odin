// Vénus · Hnoss, le calendrier des sorties (« Ajouter à mon calendrier » de l'onglet « À venir » de l'appli Venus,
// Upcoming.js) : les épisodes des séries de la bibliothèque, les films demandés et les envies (♡) d'un profil,
// lus dans les sorties GARDÉES (table `sorties` de VENUS_ODIN, repli fichiers ici), jamais inventées ; un lien personnel
// par profil (seule son empreinte sert à le retrouver, le lien lui-même est chiffré), qu'un nouveau lien remplace.
// Les routes sont pilotées avec de FAUX req/res : aucun serveur, aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { COLLECTIONS, DEF_FREYJA, dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { demander } from '../src/valhalla/venus/hnoss/index.ts';
import { garderSorties, icsCalendrier, lienCalendrier, profilDuCalendrier, sortiesDuCalendrier, sortiesGardees } from '../src/valhalla/venus/hnoss/calendrier.ts';
import { venusRoute } from '../src/valhalla/venus/routes.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-hnoss-cal-'));
const MOI = { login: 'moi', nom: '', proprietaire: true };
const LINA = { login: 'lina', nom: 'Lina', proprietaire: false };

function preparer(home: string) {
  oublierMagasins();
  const mag = magasinVenus(home, dirVenus(home));
  mag.poser('oeuvres', 'serie:station-polaire', { type: 'serie', titre: 'Station Polaire' });
  garderSorties(mag, 'show', [
    { key: 'serie:11', kind: 'show', title: 'Station Polaire', date: '2026-12-02', at: Date.parse('2026-12-02T20:00:00Z'), season: 2, episode: 8, nas: 'serie:station-polaire', pop: 90 },
    { key: 'serie:12', kind: 'show', title: 'Les Voiles', date: '2026-12-03', season: 1, episode: 1, pop: 300 },
    { key: 'serie:13', kind: 'show', title: 'Inconnue; avec, virgule', date: '2026-12-04', season: 1, episode: 2, pop: 500 },
  ]);
  garderSorties(mag, 'movie', [
    { key: 'film:21', kind: 'movie', title: 'Tard', date: '2026-12-10', year: 2026, pop: 10 },
    { key: 'film:22', kind: 'movie', title: 'Le Phare', date: '2026-12-11', year: 2026, pop: 10 },
    { key: 'film:23', kind: 'movie', title: 'Rien demandé', date: '2026-12-12', year: 2026, pop: 10 },
  ]);
  return mag;
}

test('la table `sorties` existe dans VENUS_ODIN (migration à elle, une écriture par table)', () => {
  assert.ok((COLLECTIONS as string[]).includes('sorties'));
  assert.ok(DEF_FREYJA.migrations.some((m) => /CREATE TABLE sorties \(id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL\)/.test(m.sql)));
  for (const k of ['pose_sorties', 'retire_sorties', 'vide_sorties']) assert.ok(k in DEF_FREYJA.ecritures, k);
});

test('les sorties gardées : remplacées par genre, nettoyées, bornées ; rien de gardé, rien de rendu', () => {
  const home = tmp();
  try {
    oublierMagasins();
    const mag = magasinVenus(home, dirVenus(home));
    assert.deepEqual(sortiesGardees(mag), [], 'aucune sortie gardée : rien, jamais une sortie inventée');
    garderSorties(mag, 'anime', [{ key: 'anime:1', kind: 'anime', title: 'A<b>x</b>', date: '2026-12-01', episode: 3 }, { key: 'bad', title: '', date: 'pas une date' }]);
    assert.deepEqual(sortiesGardees(mag, 'anime').map((x) => x.title), ['A x'], 'balise retirée, entrée sans titre ni date écartée');
    garderSorties(mag, 'anime', [{ key: 'anime:2', kind: 'anime', title: 'B', date: '2026-12-02', episode: 1 }]);
    assert.deepEqual(sortiesGardees(mag, 'anime').map((x) => x.key), ['anime:2'], 'un nouveau relevé remplace l\'ancien du même genre');
    garderSorties(mag, 'show', Array.from({ length: 900 }, (_, i) => ({ key: `serie:${i}`, kind: 'show', title: `T${i}`, date: '2026-12-01', episode: i })));
    assert.equal(sortiesGardees(mag, 'show').length, 400, 'borné');
    assert.equal(sortiesGardees(mag, 'anime').length, 1, 'les autres genres ne bougent pas');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('le calendrier d\'un profil : séries de la bibliothèque, films demandés, envies ; pas celles des autres', () => {
  const home = tmp();
  try {
    const mag = preparer(home);
    demander(mag, { genre: 'film', titre: 'Tard', annee: 2026, qui: MOI });
    demander(mag, { genre: 'serie', titre: 'Les Voiles', qui: MOI, envie: true, cle: 'serie:12' });
    demander(mag, { genre: 'film', titre: 'Le Phare', qui: LINA, envie: true, cle: 'film:22' });
    const moi = sortiesDuCalendrier(mag, 'moi').map((x) => x.title).sort();
    assert.deepEqual(moi, ['Les Voiles', 'Station Polaire', 'Tard'], 'série de la bibliothèque, film demandé, envie ♡');
    const lina = sortiesDuCalendrier(mag, 'lina').map((x) => x.title).sort();
    assert.deepEqual(lina, ['Le Phare', 'Station Polaire'], 'Lina : son envie, et les séries de la maison ; jamais la demande du propriétaire');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('le fichier de calendrier : iCalendar valide (CRLF, lignes pliées, texte échappé), sans langue supposée', () => {
  const ics = icsCalendrier([
    { id: 's:a', key: 'serie:13', kind: 'show', title: 'Inconnue; avec, virgule\\ et un très long titre qui dépasse soixante-quinze octets à coup sûr', date: '2026-12-04', season: 1, episode: 2 },
    { id: 's:b', key: 'serie:11', kind: 'show', title: 'Station Polaire', date: '2026-12-02', at: Date.parse('2026-12-02T20:00:00Z'), season: 2, episode: 8 },
    { id: 's:c', key: 'film:21', kind: 'movie', title: 'Tard', date: '2026-12-10' },
  ], Date.parse('2026-11-25T10:00:00Z'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal(ics.split('BEGIN:VEVENT').length - 1, 3);
  assert.ok(!/[^\r]\n/.test(ics), 'toutes les fins de ligne sont CRLF');
  for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75, `ligne pliée : ${l}`);
  const deplie = ics.replace(/\r\n /g, '');
  assert.match(deplie, /SUMMARY:Inconnue\\; avec\\, virgule\\\\ et un très long titre/);
  assert.match(deplie, /SUMMARY:Station Polaire S02E08\r\n/);
  assert.match(deplie, /DTSTART:20261202T200000Z\r\n/, 'heure connue : l\'heure de diffusion');
  assert.match(deplie, /DTSTART;VALUE=DATE:20261210\r\n/, 'film : le jour de sortie');
  assert.match(deplie, /DTSTAMP:20261125T100000Z\r\n/);
  assert.doesNotMatch(deplie, /Saison|Épisode|Sortie/, 'aucun mot dans une langue supposée');
  assert.equal(icsCalendrier([], 0).split('BEGIN:VEVENT').length - 1, 0, 'rien de gardé : un calendrier vide');
});

test('le lien personnel : le même tant qu\'on n\'en demande pas un neuf ; le neuf remplace l\'ancien ; empreinte seule en clair', () => {
  const home = tmp();
  try {
    oublierMagasins();
    const mag = magasinVenus(home, dirVenus(home));
    const a = lienCalendrier(mag, home, 'moi'), b = lienCalendrier(mag, home, 'moi'), l = lienCalendrier(mag, home, 'lina');
    assert.equal(a, b); assert.notEqual(a, l);
    assert.equal(profilDuCalendrier(mag, a), 'moi'); assert.equal(profilDuCalendrier(mag, l), 'lina');
    const c = lienCalendrier(mag, home, 'moi', { nouveau: true });
    assert.notEqual(c, a); assert.equal(profilDuCalendrier(mag, a), undefined, 'l\'ancien lien ne vaut plus'); assert.equal(profilDuCalendrier(mag, c), 'moi');
    assert.equal(profilDuCalendrier(mag, 'n-importe-quoi'), undefined); assert.equal(profilDuCalendrier(mag, ''), undefined);
    for (const f of readdirSync(dirVenus(home))) assert.ok(!readFileSync(join(dirVenus(home), f), 'utf8').includes(c), `le lien n'est pas écrit en clair (${f})`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- routes (faux req/res)
function fakeReq(method: string, corps?: unknown): IncomingMessage {
  const r = Readable.from(corps === undefined ? [] : [Buffer.from(JSON.stringify(corps))]) as unknown as IncomingMessage;
  (r as unknown as { method: string }).method = method;
  (r as unknown as { headers: Record<string, string> }).headers = {};
  return r;
}
class FakeRes extends Writable {
  code?: number; headers: Record<string, string> = {}; body = '';
  writeHead(code: number, h: Record<string, string> = {}): this { this.code = code; this.headers = h; return this; }
  _write(chunk: Buffer, _e: string, cb: () => void): void { this.body += chunk.toString(); cb(); }
}
async function appel(home: string, method: string, chemin: string, proprietaire: boolean, echecs: string[] = [], o: { corps?: unknown; profil?: string } = {}) {
  const res = new FakeRes();
  const ctx = { home, proprietaire: () => proprietaire, fail: () => { echecs.push(chemin); }, origin: 'https://odin.exemple.test', ip: '127.0.0.1', profil: o.profil ?? 'moi' };
  const handled = await venusRoute(fakeReq(method, o.corps), res as unknown as ServerResponse, new URL(`http://x${chemin}`), ctx);
  if (!res.writableFinished) await new Promise<void>((r) => { res.once('finish', () => r()); setTimeout(r, 300); });
  return { handled, code: res.code, headers: res.headers, body: res.body };
}

test('routes : le lien est donné au propriétaire seul ; le calendrier se lit sans session avec le lien, un faux lien est refusé et compté', async () => {
  const home = tmp();
  try {
    const mag = preparer(home);
    demander(mag, { genre: 'film', titre: 'Tard', annee: 2026, qui: MOI });
    const refus = await appel(home, 'POST', '/venus/hnoss/calendrier', false);
    assert.equal(refus.code, 401, 'sans session : pas de lien');
    const r = await appel(home, 'POST', '/venus/hnoss/calendrier', true);
    assert.equal(r.code, 200);
    const j = JSON.parse(r.body) as { url: string; webcal: string };
    assert.match(j.url, /^https:\/\/odin\.exemple\.test\/venus\/calendrier\/[A-Za-z0-9_-]{20,}\.ics$/);
    assert.equal(j.webcal, j.url.replace(/^https:/, 'webcal:'));
    const chemin = new URL(j.url).pathname;
    const cal = await appel(home, 'GET', chemin, false);
    assert.equal(cal.code, 200); assert.match(cal.headers['content-type'] ?? '', /^text\/calendar/);
    assert.match(cal.body, /SUMMARY:Tard\r\n/); assert.match(cal.body, /SUMMARY:Station Polaire S02E08\r\n/);
    assert.doesNotMatch(cal.body, /Rien demandé|Le Phare/);
    const echecs: string[] = [];
    const faux = await appel(home, 'GET', '/venus/calendrier/AAAAAAAAAAAAAAAAAAAAAAAA.ics', false, echecs);
    assert.equal(faux.code, 404); assert.equal(echecs.length, 1, 'un faux lien compte comme un essai raté');
    const meme = await appel(home, 'POST', '/venus/hnoss/calendrier', true);
    assert.equal((JSON.parse(meme.body) as { url: string }).url, j.url, 'sans « nouveau » : le même lien, remontré');
    const neuf = await appel(home, 'POST', '/venus/hnoss/calendrier', true, [], { corps: { nouveau: true } });
    assert.equal(neuf.code, 200); assert.notEqual((JSON.parse(neuf.body) as { url: string }).url, j.url, 'un lien neuf');
    assert.equal((await appel(home, 'GET', chemin, false)).code, 404, 'l\'ancien lien ne vaut plus');
    assert.equal((await appel(home, 'PUT', '/venus/hnoss/calendrier', true)).code, 405);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- après relecture
test('le lien est un secret : GET ne le donne pas (405, rien de créé) ; seul un POST le donne, et la clé d\'accès n\'a pas de POST ici', async () => {
  const home = tmp();
  try {
    const mag = preparer(home);
    const g = await appel(home, 'GET', '/venus/hnoss/calendrier', true);
    assert.equal(g.code, 405, 'une lecture GET ne rend jamais le lien');
    assert.doesNotMatch(g.body, /calendrier\/[A-Za-z0-9_-]{20,}/);
    assert.equal(mag.liste('sorties').filter((e) => e.data.calendrier === true).length, 0, 'un GET ne crée aucun lien');
    // La clé d'accès (« lire et parler seulement ») : le POST de cette route est refusé d'office par la règle du serveur.
    const { refusDeLaCle } = await import('../src/web/cle-acces.ts');
    assert.ok(refusDeLaCle('POST', '/venus/hnoss/calendrier'), 'POST refusé à la clé');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('« Qui regarde ? » nomme un membre p:<login> : son calendrier porte SES envies (rangées sous <login>), pas celles du propriétaire', async () => {
  const home = tmp();
  try {
    const mag = preparer(home);
    demander(mag, { genre: 'film', titre: 'Tard', annee: 2026, qui: MOI });
    demander(mag, { genre: 'film', titre: 'Le Phare', qui: LINA, envie: true, cle: 'film:22' });
    assert.deepEqual(sortiesDuCalendrier(mag, 'p:lina').map((x) => x.title).sort(), ['Le Phare', 'Station Polaire']);
    const r = await appel(home, 'POST', '/venus/hnoss/calendrier', true, [], { profil: 'p:lina' });
    assert.equal(r.code, 200);
    const cal = await appel(home, 'GET', new URL((JSON.parse(r.body) as { url: string }).url).pathname, false);
    assert.match(cal.body, /SUMMARY:Le Phare\r\n/, 'l\'envie du membre est dans son calendrier');
    assert.doesNotMatch(cal.body, /SUMMARY:Tard\r\n/, 'jamais la demande du propriétaire');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('une entrée mal formée ne casse pas le fichier : jour inexistant écarté, heure hors bornes ignorée', () => {
  const home = tmp();
  try {
    oublierMagasins();
    const mag = magasinVenus(home, dirVenus(home));
    garderSorties(mag, 'show', [
      { key: 'serie:1', title: 'Février', date: '2026-02-31', episode: 1 },
      { key: 'serie:2', title: 'Treize', date: '2026-13-01', episode: 1 },
      { key: 'serie:3', title: 'Loin', date: '2026-12-05', at: 1e20, season: 1, episode: 1, nas: 'serie:loin' },
      { key: 'serie:4', title: 'Bissextile', date: '2028-02-29', episode: 1, nas: 'serie:b' },
    ]);
    assert.deepEqual(sortiesGardees(mag).map((x) => x.title).sort(), ['Bissextile', 'Loin'], 'le 31 février et le mois 13 sont écartés');
    const ics = icsCalendrier(sortiesGardees(mag), Date.parse('2026-11-25T10:00:00Z'));
    assert.doesNotMatch(ics, /NaN/);
    assert.match(ics, /DTSTART;VALUE=DATE:20261205\r\n/, 'heure illisible : le jour seul');
    assert.match(ics, /DTSTART;VALUE=DATE:20280229\r\n/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('un film demandé ne prend pas un homonyme d\'une autre année', () => {
  const home = tmp();
  try {
    oublierMagasins();
    const mag = magasinVenus(home, dirVenus(home));
    garderSorties(mag, 'movie', [
      { key: 'film:1', title: 'Le Retour', date: '2026-12-10', year: 2026 },
      { key: 'film:2', title: 'Le Retour', date: '2026-12-20', year: 1999 },
    ]);
    demander(mag, { genre: 'film', titre: 'Le Retour', annee: 2026, qui: MOI });
    assert.deepEqual(sortiesDuCalendrier(mag, 'moi').map((x) => x.key), ['film:1']);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
