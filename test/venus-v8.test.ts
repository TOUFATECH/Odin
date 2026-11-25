// Vénus, la maison (lot V8), côté Odin : statistiques et rétrospective d'après la reprise gardée (jamais inventées),
// « Qui regarde ce soir ? », le vote en famille, les séances, les collections et les listes de lecture, et le
// téléchargement du fichier d'origine. Aucun réseau, aucun serveur : le magasin de Vénus en fichiers, de faux req/res.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { COLLECTIONS, DEF_FREYJA, dirVenus, magasinVenus, oublierMagasins, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { venusRoute } from '../src/valhalla/venus/routes.ts';
import { anneeDemandee, ensemble, plusLongueSerie, statistiques } from '../src/valhalla/venus/stats.ts';
import { cloreVote, codeNet, creerSalle, creerVote, lireSalle, lireVote, voter, DUREE_MS } from '../src/valhalla/venus/seance.ts';
import { changer, collection, collections, creerCollection, creerListe, liste, nomNet } from '../src/valhalla/venus/collections.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-v8-'));
const MOI = 'moi', AWA = 'p:awa';
const quand = (an: number, mois: number, jour: number, h = 21) => new Date(an, mois, jour, h, 0, 0).getTime();

/** Une petite bibliothèque : deux films, une série de 3 épisodes, un animé, avec leurs fiches (genres, distribution). */
function bibli(m: MagasinVenus): void {
  const role = (id: string, nom: string) => ({ personne: id, nom, role: '' });
  const fiche = (genres: string[], gens: string[] = []) => ({ source: 'films', genres, distribution: gens.map((g, i) => role(`pe-${String(i).padStart(24, 'a')}`.slice(0, 27), g)), equipe: [], quand: 1 });
  m.poser('oeuvres', 'film:a', { type: 'film', titre: 'Le Phare', annee: 2020, duree: 6000, fichier: 'a.mp4', fiche: fiche(['Drame'], ['Lina Moreau']) });
  m.poser('oeuvres', 'film:b', { type: 'film', titre: 'La Course', annee: 2021, duree: 5400, fichier: 'b.mp4', fiche: fiche(['Comédie', 'Aventure'], ['Lina Moreau']) });
  m.poser('oeuvres', 'film:c', { type: 'film', titre: 'Nuit Claire', annee: 2022, duree: 4800, fichier: 'c.mp4', fiche: fiche(['Comédie'], ['Lina Moreau']) });
  m.poser('oeuvres', 'serie:s', { type: 'serie', titre: 'Les Îles' , fiche: fiche(['Drame']) });
  for (let e = 1; e <= 3; e++) m.poser('episodes', `serie:s:s1e${e}`, { oeuvre_id: 'serie:s', saison: 1, episode: e, titre: 'Les Îles', fichier: `s${e}.mp4`, duree: 2700 });
  m.poser('oeuvres', 'serie:k', { type: 'serie', titre: 'Kaze', categorie: 'anime', fiche: fiche(['Animation']) });
  m.poser('episodes', 'serie:k:s1e1', { oeuvre_id: 'serie:k', saison: 1, episode: 1, titre: 'Kaze', fichier: 'k1.mp4', duree: 1440 });
}
const lu = (m: MagasinVenus, profil: string, cible: string, pos: number, duree: number, maj: number) => m.poser('reprise', `${profil}:${cible}`, { profil, cible_id: cible, type: 'video', position_s: pos, duree_s: duree, maj });

test('base : les tables seances, collections et hors_ligne existent (migration, écritures)', () => {
  for (const c of ['seances', 'collections', 'hors_ligne']) {
    assert.ok((COLLECTIONS as string[]).includes(c), c);
    assert.ok(DEF_FREYJA.migrations.some((x) => new RegExp(`CREATE TABLE ${c} \\(id text PRIMARY KEY, data jsonb NOT NULL, maj bigint NOT NULL\\)`).test(x.sql)), c);
    for (const k of [`pose_${c}`, `retire_${c}`, `vide_${c}`]) assert.ok(k in DEF_FREYJA.ecritures, k);
  }
});

test('statistiques : d’après la reprise du profil seulement, rien d’inventé', () => {
  const home = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m);
    // vide : tout à zéro, aucune personne, aucun mois
    let st = statistiques(m, MOI, 2026);
    assert.equal(st.totalHours, 0); assert.equal(st.movies, 0); assert.equal(st.person, null); assert.equal(st.bestMonth, null); assert.deepEqual(st.years, []);
    lu(m, MOI, 'film:a', 6000, 6000, quand(2026, 2, 3));            // fini : 1 h 40
    lu(m, MOI, 'film:b', 1800, 5400, quand(2026, 2, 4));            // commencé : 30 min, pas « vu »
    lu(m, MOI, 'film:c', 4800, 4800, quand(2026, 2, 5, 9));         // fini
    lu(m, MOI, 'serie:s:s1e1', 2700, 2700, quand(2026, 5, 1));     // épisode fini
    lu(m, MOI, 'serie:s:s1e2', 2700, 2700, quand(2026, 5, 1, 22));
    lu(m, MOI, 'serie:k:s1e1', 1440, 1440, quand(2025, 11, 31));   // l'année d'avant
    lu(m, AWA, 'film:b', 5400, 5400, quand(2026, 2, 4));            // un autre profil : jamais compté ici
    st = statistiques(m, MOI, 2026);
    assert.equal(st.movies, 2, 'deux films vus jusqu’au bout (le commencé ne compte pas)');
    assert.equal(st.episodes, 2);
    assert.equal(st.totalHours, Math.round(((6000 + 1800 + 4800 + 2700 * 2) / 3600) * 100) / 100);
    assert.equal(st.days, 4); assert.equal(st.streak, 3, '3, 4 et 5 mars se suivent');
    assert.deepEqual(st.calendar['2026-03-03'], 100);
    assert.equal(st.bestMonth?.m, 2); assert.equal(st.months[5].hours, 1.5);
    assert.equal(st.hoursOfDay[9].hours, Math.round((4800 / 3600) * 100) / 100);
    assert.equal(st.genres[0].name, 'Drame');
    assert.equal(st.topShows[0].id, 'serie:s'); assert.equal(st.topShows[0].eps, 2); assert.equal(st.topAnime.length, 0, 'l’animé est de l’année d’avant');
    assert.deepEqual(st.lastMovies.map((x) => x.id), ['film:c', 'film:a']);
    assert.equal(st.person, 'Lina Moreau', 'dans 3 titres regardés cette année');
    assert.equal(st.completedShows.length, 0, 'un épisode des Îles n’est pas vu');
    assert.deepEqual(st.years, [2026, 2025]);
    assert.equal(st.allTimeHours, Math.round(((6000 + 1800 + 4800 + 2700 * 2 + 1440) / 3600) * 100) / 100);
    const awa = statistiques(m, AWA, 2026);
    assert.equal(awa.movies, 1); assert.equal(awa.episodes, 0); assert.equal(awa.person, null);
    // la série finie dans l'année entre dans « Terminées cette année »
    lu(m, MOI, 'serie:s:s1e3', 2700, 2700, quand(2026, 5, 2));
    assert.deepEqual(statistiques(m, MOI, 2026).completedShows.map((x) => x.id), ['serie:s']);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('statistiques : outils purs (suite de jours, année demandée)', () => {
  assert.equal(plusLongueSerie([]), 0);
  assert.equal(plusLongueSerie(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-03']), 3);
  const now = new Date(2026, 10, 25);
  assert.equal(anneeDemandee('2024', now), 2024); assert.equal(anneeDemandee('abc', now), 2026); assert.equal(anneeDemandee('99999', now), 2026); assert.equal(anneeDemandee('1800', now), 2026);
});

test('« Qui regarde ce soir ? » : ce que personne n’a commencé ; enfant présent sans âge connu : rien proposé', () => {
  const home = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m);
    const P = [{ id: MOI, name: 'Maison', isAdmin: true, avatar: 0 }, { id: AWA, name: 'Awa', avatar: 1 }, { id: 'p:noe', name: 'Noé', avatar: 2, isKids: true }];
    lu(m, MOI, 'film:a', 6000, 6000, quand(2026, 2, 3));
    lu(m, AWA, 'film:b', 600, 5400, quand(2026, 2, 3));
    const r = ensemble(m, P, [MOI, AWA], 'movie', MOI);
    assert.deepEqual(r.results.map((x) => x.item.id), ['film:c'], 'film:a vu par moi, film:b commencé par Awa');
    assert.equal(r.kids, false);
    const k = ensemble(m, P, [MOI, 'p:noe'], 'movie', MOI);
    assert.equal(k.kids, true); assert.equal(k.kidsSansAge, true); assert.equal(k.results.length, 0);
    assert.deepEqual(ensemble(m, P, ['inconnu'], 'movie', MOI).results, []);
    assert.deepEqual(ensemble(m, P, [MOI], 'show', MOI).results.map((x) => x.item.id).sort(), ['serie:k', 'serie:s']);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('vote en famille : code de 4 lettres, une voix par appareil, changer d’avis, gagnant, terminé, expiré', () => {
  const home = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m);
    assert.deepEqual(creerVote(m, MOI, 'Maison', ['film:a']), { erreur: 'Il faut au moins deux idées pour voter.' });
    assert.deepEqual(creerVote(m, MOI, 'Maison', ['film:a', 'inconnu']), { erreur: 'Il faut au moins deux idées pour voter.' });
    const v = creerVote(m, MOI, 'Maison', ['film:a', 'film:b', 'film:c']);
    assert.ok(!('erreur' in v)); if ('erreur' in v) return;
    assert.match(v.code, /^[A-HJ-NP-Z]{4}$/); assert.equal(v.items.length, 3); assert.equal(v.done, false);
    assert.equal(lireVote(m, v.code.toLowerCase())?.code, v.code, 'le code se tape en minuscules aussi');
    assert.equal(lireVote(m, 'ZZZ'), undefined);
    let st = voter(m, v.code, 'film:b', 'tel1', 'Awa'); assert.ok(!('erreur' in st));
    st = voter(m, v.code, 'film:c', 'tel2', 'Maison');
    st = voter(m, v.code, 'film:c', 'tel1', 'Awa'); // Awa change d'avis
    if ('erreur' in st) assert.fail(st.erreur);
    assert.equal(st.voters, 2); assert.deepEqual(st.items.map((x) => x.votes), [0, 0, 2]); assert.deepEqual(st.items[2].voters, ['Awa', 'Maison']);
    assert.deepEqual(voter(m, v.code, 'film:z', 'tel3', 'X'), { erreur: 'Ce titre ne fait pas partie du vote.' });
    assert.deepEqual(voter(m, v.code, 'film:a', '<>', 'X'), { erreur: 'Appareil inconnu.' });
    const fin = cloreVote(m, v.code); if ('erreur' in fin) assert.fail(fin.erreur);
    assert.equal(fin.done, true); assert.equal(fin.winner, 'film:c');
    assert.deepEqual(voter(m, v.code, 'film:a', 'tel1', 'Awa'), { erreur: 'Le vote est terminé.' });
    // égalité : l'idée proposée en premier
    const w = creerVote(m, MOI, 'Maison', ['film:a', 'film:b']); if ('erreur' in w) assert.fail(w.erreur);
    voter(m, w.code, 'film:b', 'x1', 'A'); voter(m, w.code, 'film:a', 'x2', 'B');
    const g = cloreVote(m, w.code); if ('erreur' in g) assert.fail(g.erreur); assert.equal(g.winner, 'film:a');
    // expiré : plus rien
    assert.equal(lireVote(m, w.code, Date.now() + DUREE_MS + 1), undefined);
    assert.equal(codeNet(' ab-c d9 '), 'ABCD');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('séance : une salle pour un titre de la bibliothèque, retrouvée par son code, expirée après 3 h', () => {
  const home = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m);
    assert.deepEqual(creerSalle(m, 'serie:s', 'Maison'), { erreur: 'Ce titre n’est pas (ou plus) dans la bibliothèque.' }, 'une série : il faut un épisode');
    const s = creerSalle(m, 'serie:s:s1e2', 'Maison'); if ('erreur' in s) assert.fail(s.erreur);
    assert.equal(lireSalle(m, s.code)?.itemId, 'serie:s:s1e2');
    assert.equal(lireSalle(m, 'AB'), undefined);
    assert.equal(lireSalle(m, s.code, Date.now() + DUREE_MS + 1), undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('collections et listes de lecture : propriétaire, profil, ordre, noms nettoyés', () => {
  const home = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m);
    assert.deepEqual(creerCollection(m, AWA, 'Films de Noël'), { erreur: 'Seul le propriétaire crée une collection.', code: 403 });
    assert.deepEqual(creerCollection(m, MOI, '   '), { erreur: 'Donnez un nom à la collection', code: 400 });
    const c = creerCollection(m, MOI, 'Films\u2028 de <b>Noël</b>', 'film:a'); if ('erreur' in c) assert.fail(c.erreur);
    assert.equal(c.name, 'Films de <b>Noël</b>', 'une ligne ; le texte reste du texte (la page l’échappe)');
    assert.equal(nomNet('x'.repeat(200)).length, 80);
    assert.deepEqual(changer(m, AWA, 'collection', c.id, { faire: 'ajouter', itemId: 'film:b' }), { erreur: 'Seul le propriétaire change une collection.', code: 403 });
    assert.deepEqual(changer(m, MOI, 'collection', c.id, { faire: 'ajouter', itemId: 'serie:s' }), { ok: true, added: 1 });
    assert.deepEqual(changer(m, MOI, 'collection', c.id, { faire: 'ajouter', itemId: 'serie:s:s1e1' }), { erreur: 'Ce titre n’est pas (ou plus) dans la bibliothèque.', code: 404 });
    assert.deepEqual(collection(m, AWA, c.id)?.items.map((x) => x.id), ['film:a', 'serie:s'], 'tous les profils la voient');
    assert.equal(collection(m, AWA, c.id)?.editable, false); assert.equal(collection(m, MOI, c.id)?.editable, true);
    // liste : une série donne tous ses épisodes ; un autre profil ne la voit pas
    const l = creerListe(m, AWA, 'Marathon du dimanche', 'serie:s'); if ('erreur' in l) assert.fail(l.erreur);
    assert.equal(l.added, 3);
    assert.equal(liste(m, MOI, l.id), undefined, 'la liste d’Awa n’existe pas pour un autre profil');
    assert.deepEqual(changer(m, MOI, 'liste', l.id, { faire: 'supprimer' }), { erreur: 'introuvable', code: 404 });
    assert.deepEqual(collections(m, MOI).playlists, []);
    assert.equal(collections(m, AWA).playlists[0].count, 3);
    assert.equal(collections(m, AWA).playlists[0].duration, 8100);
    assert.deepEqual(changer(m, AWA, 'liste', l.id, { faire: 'ajouter', itemId: 'film:c' }), { ok: true, added: 1 });
    assert.deepEqual(changer(m, AWA, 'liste', l.id, { faire: 'ajouter', itemId: 'film:c' }), { ok: true, added: 0 }, 'déjà dedans');
    const ids = liste(m, AWA, l.id)!.items.map((x) => x.id);
    assert.deepEqual(changer(m, AWA, 'liste', l.id, { faire: 'ordre', order: [...ids].reverse() }), { ok: true });
    assert.equal(liste(m, AWA, l.id)!.items[0].id, 'film:c');
    assert.deepEqual(changer(m, AWA, 'liste', l.id, { faire: 'ordre', order: ['film:a', ...ids.slice(1)] }), { erreur: 'Ordre invalide.', code: 400 }, 'l’ordre ne fait rien entrer');
    lu(m, AWA, 'serie:s:s1e1', 2700, 2700, Date.now());
    const it = liste(m, AWA, l.id)!.items.find((x) => x.id === 'serie:s:s1e1')!;
    assert.equal(it.showTitle, 'Les Îles'); assert.equal(it.season, 1); assert.equal(it.progress?.watched, true);
    assert.deepEqual(changer(m, AWA, 'liste', l.id, { faire: 'retirer', itemId: 'film:c' }), { ok: true });
    assert.deepEqual(changer(m, AWA, 'liste', l.id, { faire: 'renommer', name: '' }), { erreur: 'Le nom est obligatoire', code: 400 });
    assert.deepEqual(changer(m, AWA, 'liste', l.id, { faire: 'supprimer' }), { ok: true });
    assert.equal(liste(m, AWA, l.id), undefined);
    assert.ok(m.get('oeuvres', 'serie:s'), 'les vidéos restent dans Vénus');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- les routes
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
async function appel(home: string, method: string, chemin: string, body?: unknown, o: { proprietaire?: boolean; headers?: Record<string, string> } = {}) {
  const res = new FakeRes();
  const ctx = { home, proprietaire: () => o.proprietaire !== false, fail: () => undefined, origin: 'http://odin.test', ip: '127.0.0.1', profil: MOI };
  const handled = await venusRoute(fakeReq(method, body, o.headers), res as unknown as ServerResponse, new URL(`http://x${chemin}`), ctx);
  if (!res.writableFinished) await new Promise<void>((r) => { res.once('finish', () => r()); setTimeout(r, 500); });
  let json: Record<string, unknown> = {}; try { json = JSON.parse(res.body) as Record<string, unknown>; } catch { /* pas du JSON */ }
  return { handled, code: res.code, json, body: res.body, entetes: res.entetes };
}

test('routes de la maison : statistiques, vote (avec QR), séance, collections et listes ; garde et en-tête x-odin', async () => {
  const home = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m);
    lu(m, MOI, 'film:a', 6000, 6000, quand(2026, 2, 3));
    let r = await appel(home, 'GET', '/venus/api/stats?annee=2026');
    assert.equal(r.code, 200); assert.equal(r.json.movies, 1); assert.equal(r.json.year, 2026);
    r = await appel(home, 'GET', '/venus/api/stats', undefined, { proprietaire: false });
    assert.equal(r.code, 401, 'garde du propriétaire');
    r = await appel(home, 'GET', '/venus/api/ensemble?profils=moi&kind=movie');
    assert.equal(r.code, 200); assert.deepEqual((r.json.results as Array<{ item: { id: string } }>).map((x) => x.item.id).sort(), ['film:b', 'film:c']);
    // vote
    r = await appel(home, 'POST', '/venus/api/vote', { itemIds: ['film:b', 'film:c'] }, { headers: {} });
    assert.equal(r.code, 403, 'une écriture sans en-tête x-odin est refusée');
    r = await appel(home, 'POST', '/venus/api/vote', { itemIds: ['film:b', 'film:c'] });
    assert.equal(r.code, 200); const code = String(r.json.code);
    assert.match(String(r.json.qr), /^<svg[^>]*>/); assert.equal(r.json.link, `http://odin.test/venus/app/#/vote?code=${code}`);
    r = await appel(home, 'POST', `/venus/api/vote/${code}`, { itemId: 'film:c', client: 'abc123' });
    assert.equal(r.code, 200); assert.equal(r.json.voters, 1);
    r = await appel(home, 'POST', `/venus/api/vote/${code}/clore`, {});
    assert.equal(r.json.winner, 'film:c');
    r = await appel(home, 'POST', `/venus/api/vote/${code}`, { itemId: 'film:b', client: 'abc123' });
    assert.equal(r.code, 409);
    r = await appel(home, 'GET', '/venus/api/vote/QQQQ'); assert.equal(r.code, 404);
    // séance
    r = await appel(home, 'POST', '/venus/api/seance', { itemId: 'film:a' }); assert.equal(r.code, 200);
    r = await appel(home, 'GET', `/venus/api/seance/${String(r.json.code)}`); assert.equal(r.json.itemId, 'film:a');
    r = await appel(home, 'GET', '/venus/api/seance/ZZZZ'); assert.equal(r.code, 404);
    // collections et listes
    r = await appel(home, 'POST', '/venus/api/collections', { name: 'Soirées', itemId: 'film:a' }); assert.equal(r.code, 200);
    const cid = String(r.json.id);
    r = await appel(home, 'POST', `/venus/api/collections/${cid}`, { faire: 'renommer', name: 'Grandes soirées' }); assert.equal(r.code, 200);
    r = await appel(home, 'GET', `/venus/api/collections/${cid}`); assert.equal(r.json.name, 'Grandes soirées');
    r = await appel(home, 'POST', '/venus/api/listes', { name: 'À voir', itemId: 'serie:s' }); assert.equal(r.json.added, 3);
    const lid = String(r.json.id);
    r = await appel(home, 'GET', '/venus/api/collections'); assert.equal((r.json.collections as unknown[]).length, 1); assert.equal((r.json.playlists as unknown[]).length, 1);
    r = await appel(home, 'GET', `/venus/api/listes/${lid}`); assert.equal((r.json.items as unknown[]).length, 3);
    r = await appel(home, 'GET', '/venus/api/listes/l-000000000000'); assert.equal(r.code, 404);
    r = await appel(home, 'GET', '/venus/api/collections/../../etc'); assert.equal(r.code, 404);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('« Fichier d’origine » : le film est envoyé en pièce jointe, nommé par son seul nom de fichier', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home));
    const f = join(media, 'Le Phare (2020).mp4'); writeFileSync(f, Buffer.alloc(2048, 7));
    m.poser('oeuvres', 'film:a', { type: 'film', titre: 'Le Phare', duree: 60, fichier: f });
    let r = await appel(home, 'GET', '/venus/api/telecharger/film%3Aa');
    assert.equal(r.code, 200); assert.equal(r.body.length, 2048);
    assert.match(r.entetes['content-disposition'], /^attachment; filename="Le Phare \(2020\)\.mp4"; filename\*=UTF-8''Le%20Phare%20%282020%29\.mp4$/);
    assert.ok(!r.entetes['content-disposition'].includes(media), 'aucun chemin de la machine');
    r = await appel(home, 'GET', '/venus/api/telecharger/inconnu'); assert.equal(r.code, 404);
    r = await appel(home, 'GET', '/venus/api/telecharger/film%3Aa', undefined, { proprietaire: false }); assert.equal(r.code, 401);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});
