// Les widgets « Présence » de l'accueil (maquette validée « Accueil » : le petit chiffre « À la maison » et la carte
// « Famille ») : qui est à la maison, et rien d'autre (src/valhalla/widgets/maison-presence.ts,
// src/web/pages/widgets-maison-presence.js ; la règle pure dans src/valhalla/modules/gladsheim.ts).
// - D'abord la box : « home » = là ; un autre état lisible (« not_home », une zone) = pas là ; un état illisible = on ne
//   sait pas. Sans box, ou pour un membre que la box ne connaît pas : la dernière position que son téléphone a envoyée,
//   comparée au lieu d'Odin tel qu'il l'a réglé (« Me localiser » : à la maison près ; une ville saisie : à la ville près,
//   et c'est écrit). Un lieu supposé d'après l'horloge, trouvé par la connexion Internet, ou dont on ne sait pas comment
//   il a été réglé : rien n'est calculé. Une position trop vieille : « pas de nouvelles ».
// - La réponse ne porte, pour chaque personne, que son nom, son état, la précision de la règle et l'âge de l'information :
//   ni coordonnées, ni distance, ni zone, ni batterie.
// - Au propriétaire seul : un membre, une tablette, une clé d'accès, une requête sans session sont refusés et rien
//   n'est lu pour eux ; jamais sur l'écran de la maison.
// Les prénoms sont inventés ; les lieux d'essai sont des coordonnées quelconques.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { ARRONDI_LIEU_M, NOUVELLES_MAX_MS, RAYON_MAISON_M, RAYON_VILLE_M, TAILLE_SORTE, lieuRegle, presenceDe, recordFix, resetGladsheim, supposerLieu, type LieuRegle, type Member, type Widget } from '../src/valhalla/modules/gladsheim.ts';
import { allModules, valhallaOf } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { lieuDuFuseau } from '../src/valhalla/lieu.ts';
import { lierProprietaire, persona } from '../src/valhalla/sso/etat.ts';
import { admiseALaMaison, copiable, donneeWidget, droitDeVoir, publicDe, sorteDe, type EtatWidget, type Lecteur, type SourceWidget } from '../src/valhalla/widgets/index.ts';
import { etatBox } from '../src/valhalla/widgets/maison-presence.ts';
import { T as Banc } from './banc/lib.ts';
import { vraiOdin, type VraiOdin } from './banc/odin-vrai.ts';

const lire = (f: string) => { try { return readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { return ''; } };
const RENDU = lire('src/web/pages/widgets-rendu.js'), PRESENCE = lire('src/web/pages/widgets-maison-presence.js'), GRILLE = lire('src/web/pages/accueil-grille.js');
const PETIT = (o: Record<string, unknown> = {}): Widget => ({ id: 'c9e40001', kind: 'maison_presence', w: 1, c: 2, r: 1, ...o }) as unknown as Widget;
const FAM = (o: Record<string, unknown> = {}): Widget => ({ id: 'c9e40002', kind: 'maison_famille', w: 1, c: 3, r: 2, ...o }) as unknown as Widget;
const LUI: Lecteur = { qui: 'proprietaire', ecran: 'accueil' };
const MAINT = 1_800_000_000_000, MIN = 60_000;
type Etat = EtatWidget & { raison?: string; donnee?: Record<string, any>; at?: number };
const etat = async (w: Widget, l: Lecteur, src: SourceWidget) => (await donneeWidget(w, l, src)) as Etat;
type Lu = Awaited<ReturnType<NonNullable<SourceWidget['presence']>>>;
type Pos = NonNullable<Lu>['positions'][number];

// Le lieu d'Odin réglé par « Me localiser » (± 10 m) ou par une ville ; une position reçue, à quelques mètres près.
const ICI = { lat: -12.8, lon: 45.1 };
const PAR_POSITION: LieuRegle = { par: 'position', ...ICI, precision: 10 };
const PAR_VILLE: LieuRegle = { par: 'ville', ...ICI };
/** Une position à `nord` mètres au nord du lieu, `il y a` minutes, avec la précision annoncée par le téléphone. */
const pos = (nom: string, nord: number, o: { acc?: number; ilYa?: number; lat?: number; lon?: number } = {}): Pos => ({
  nom, at: MAINT - (o.ilYa ?? 5) * MIN, lat: o.lat ?? ICI.lat + nord / 111_195, lon: o.lon ?? ICI.lon, ...('acc' in o ? (o.acc === undefined ? {} : { acc: o.acc }) : { acc: 12 }) });

/** Une fausse source qui compte ses lectures ; `appli('gna')` : Ulysse est là. */
function fausse(o: { lu?: Lu | null; sansLecture?: boolean; sansUlysse?: boolean } = {}) {
  const lus = { presence: 0 };
  const src: SourceWidget = {
    appli: (id) => (id === 'gna' && !o.sansUlysse ? { id: 'gna', name: 'Ulysse', family: 'Maison' } : undefined), vue: async () => null, action: () => undefined, meteo: async () => undefined,
    lieu: () => ({ choisi: true, nom: 'Lieu A', fuseau: 'UTC', heure12: false }), maintenant: () => MAINT,
    ...(o.sansLecture ? {} : { presence: async () => { lus.presence++; return o.lu === null ? undefined : (o.lu ?? { positions: [], lieu: PAR_POSITION }); } }),
  };
  return { src, lus };
}
const noms = (e: Etat) => (e.donnee?.personnes ?? []).map((p: any) => [p.nom, p.etat, p.precision]);

// ------------------------------------------------------------------ la règle pure (gladsheim.ts)

test('la règle « à la maison » : dans le rayon d\'un lieu réglé par « Me localiser » = là ; hors du rayon = pas là ; à la limite, ou avec une précision annoncée large = on ne sait pas (jamais un faux « là »)', () => {
  assert.equal(RAYON_MAISON_M, 250); assert.equal(RAYON_VILLE_M, 10_000); assert.equal(ARRONDI_LIEU_M, 80); assert.equal(NOUVELLES_MAX_MS, 3 * 3_600_000);
  const f = (nord: number, acc?: number, ilYa = 5) => presenceDe(pos('x', nord, { acc, ilYa }), PAR_POSITION, MAINT);
  assert.equal(f(0, 12), 'la'); assert.equal(f(140, 12), 'la', '140 m + 12 + 10 + 80 de marge = 242 m : dans les 250 m');
  assert.equal(f(160, 12), 'inconnu', '160 m : peut-être à la maison, peut-être pas');
  assert.equal(f(340, 12), 'inconnu', '340 − 102 = 238 m : pas sûrement dehors'); assert.equal(f(360, 12), 'pas_la', '360 − 102 = 258 m : sûrement à plus de 250 m');
  assert.equal(f(0, 3000), 'inconnu', 'précision annoncée de 3 km : jamais « là »');
  assert.equal(f(0, undefined), 'inconnu', 'précision non annoncée : comptée large (1 km), jamais « là »');
  assert.equal(f(5000, undefined), 'pas_la', 'loin, même sans précision');
  assert.equal(f(0, 12, 3 * 60 + 1), 'ancienne', 'plus de trois heures : pas de nouvelles');
  assert.equal(f(0, 12, 3 * 60), 'la', 'trois heures tout juste : encore des nouvelles');
  // Un lieu réglé par « Me localiser » sans précision connue : compté large, jamais « là ».
  assert.equal(presenceDe(pos('x', 0), { par: 'position', ...ICI }, MAINT), 'inconnu');
  // Une ville : à la ville près (rayon de 10 km autour de son centre).
  assert.equal(presenceDe(pos('x', 8000), PAR_VILLE, MAINT), 'la');
  assert.equal(presenceDe(pos('x', 9950), PAR_VILLE, MAINT), 'inconnu', 'au bord de la ville : on ne sait pas');
  assert.equal(presenceDe(pos('x', 30_000), PAR_VILLE, MAINT), 'pas_la');
});

test('la règle aux bords : l\'antiméridien, un pôle, des coordonnées invalides, une heure à venir ; un lieu supposé, trouvé par la connexion ou inconnu ne calcule rien', () => {
  const lieu = (lat: number, lon: number): LieuRegle => ({ par: 'position', lat, lon, precision: 5 });
  // De part et d'autre de l'antiméridien : quelques dizaines de mètres, pas 40 000 km.
  assert.equal(presenceDe({ at: MAINT, lat: 0, lon: -179.9998, acc: 5 }, lieu(0, 179.9998), MAINT), 'la');
  assert.equal(presenceDe({ at: MAINT, lat: 0, lon: 179.99, acc: 5 }, lieu(0, -179.99), MAINT), 'pas_la');
  // Au pôle, la longitude ne dit rien.
  assert.equal(presenceDe({ at: MAINT, lat: 90, lon: -120, acc: 5 }, lieu(90, 60), MAINT), 'la');
  for (const [lat, lon] of [[95, 0], [0, 190], [Number.NaN, 0], [0, Number.POSITIVE_INFINITY]] as const) {
    assert.equal(presenceDe({ at: MAINT, lat, lon, acc: 5 }, PAR_POSITION, MAINT), 'inconnu', `position ${lat}, ${lon}`);
    assert.equal(presenceDe({ at: MAINT, ...ICI, acc: 5 }, lieu(lat, lon), MAINT), 'inconnu', `lieu ${lat}, ${lon}`);
  }
  assert.equal(presenceDe({ at: MAINT + 10 * MIN, ...ICI, acc: 5 }, PAR_POSITION, MAINT), 'inconnu', 'une heure à venir');
  assert.equal(presenceDe({ at: Number.NaN, ...ICI, acc: 5 }, PAR_POSITION, MAINT), 'inconnu');
  for (const par of ['suppose', 'connexion', 'inconnu', 'aucun'] as const) assert.equal(presenceDe({ at: MAINT, ...ICI, acc: 5 }, { par, ...ICI }, MAINT), 'inconnu', par);
});

test('comment le lieu a été réglé, relu dans les réglages : « Me localiser », une ville, la connexion, supposé ; un ancien réglage sans la marque', () => {
  assert.deepEqual(lieuRegle({}), { par: 'aucun' });
  assert.deepEqual(lieuRegle({ ville: 'Lieu A', lat: -12.8, lon: 45.1, lieuPar: 'position', precisionM: 12 }), { par: 'position', lat: -12.8, lon: 45.1, precision: 12 });
  assert.deepEqual(lieuRegle({ ville: 'Lieu A', lat: -12.8, lon: 45.1, lieuPar: 'ville', precisionM: '' }), { par: 'ville', lat: -12.8, lon: 45.1 });
  assert.deepEqual(lieuRegle({ ville: 'Lieu A', lat: -12.8, lon: 45.1, lieuPar: 'connexion' }), { par: 'connexion', lat: -12.8, lon: 45.1 });
  assert.deepEqual(lieuRegle({ ville: 'Lieu A', lat: '', lon: '', suppose: true, lieuPar: 'position' }), { par: 'suppose' });
  // Un réglage d'avant la marque : une précision gardée ne vient que de « Me localiser » ; sinon, on ne sait pas.
  assert.deepEqual(lieuRegle({ ville: 'Lieu A', lat: -12.8, lon: 45.1, precisionM: 30 }), { par: 'position', lat: -12.8, lon: 45.1, precision: 30 });
  assert.deepEqual(lieuRegle({ ville: 'Lieu A', lat: -12.8, lon: 45.1 }), { par: 'inconnu', lat: -12.8, lon: 45.1 });
  assert.deepEqual(lieuRegle({ ville: 'Lieu A', lat: -12.8, lon: 45.1, lieuPar: 'autre' }), { par: 'inconnu', lat: -12.8, lon: 45.1 });
  // Sans coordonnées lisibles : rien à comparer (Number('') vaut 0 : jamais pris pour l'équateur).
  assert.deepEqual(lieuRegle({ ville: 'Lieu A', lat: '', lon: '', lieuPar: 'ville' }), { par: 'ville' });
  assert.deepEqual(lieuRegle({ ville: 'Lieu A', lat: 120, lon: 45, lieuPar: 'position' }), { par: 'position' });
});

// Un Odin sans réseau : les services de lieux répondent par de faux lieux (comme test/meteo-lieu.test.ts).
function banc() {
  const home = mkdtempSync(join(tmpdir(), 'odin-presence-lieu-'));
  let connexion: Record<string, unknown> | undefined;
  const fakeFetch = (async (u: string | URL | Request) => {
    const url = String(u);
    // Reconnus par leur chemin (les adresses des services sont celles de gladsheim.ts) : la recherche de lieux, le nom d'une position, la connexion, la météo.
    if (url.includes('/v1/search?')) return Response.json({ results: [{ name: 'Ville A', latitude: -12.84, longitude: 45.18 }] });
    if (url.includes('/reverse?')) return Response.json({ address: { village: 'Village B', country_code: 'yt' } });
    if (url.endsWith('/json/')) return connexion ? Response.json(connexion) : new Response('indisponible', { status: 503 });
    if (url.includes('/v1/forecast?')) return Response.json({ current: { temperature_2m: 29, apparent_temperature: 30, relative_humidity_2m: 74, weather_code: 2, wind_speed_10m: 18, precipitation: 0 }, hourly: { time: [], temperature_2m: [] }, daily: { time: ['2026-11-15'], weather_code: [2], temperature_2m_max: [31], temperature_2m_min: [24], sunrise: ['2026-11-15T05:30'], sunset: ['2026-11-15T18:10'] } });
    throw new Error(`adresse inattendue : ${url}`);
  }) as typeof fetch;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fakeFetch, notify: async () => {}, autonomy: () => 'equilibre' });
  resetGladsheim();
  return { v, ctx: () => v.ctx('gladsheim'), connexion: (c: Record<string, unknown> | undefined) => { connexion = c; }, fin: () => { v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('Odin retient comment son lieu a été réglé : « Me localiser » (la position de l\'appareil), une ville saisie, la connexion Internet, l\'horloge', async () => {
  const b = banc();
  try {
    assert.equal((await b.v.act('gladsheim', 'lieu_position', { lat: -12.8441, lon: 45.1787, precision: 18 })).ok, true);
    assert.deepEqual(lieuRegle(b.ctx().settings), { par: 'position', lat: -12.844, lon: 45.179, precision: 18 });
    assert.equal((await b.v.act('gladsheim', 'lieu', { ville: 'Ville A' })).ok, true);
    assert.deepEqual(lieuRegle(b.ctx().settings), { par: 'ville', lat: -12.84, lon: 45.18 });
    // « Régler Odin pour ce lieu » (Réglages → Maison) : une ville saisie, ou une position saisie (sa précision : inconnue).
    assert.equal((await b.v.act('gladsheim', 'se_configurer', { ou: 'Ville A' })).ok, true);
    assert.equal(lieuRegle(b.ctx().settings).par, 'ville');
    assert.equal((await b.v.act('gladsheim', 'se_configurer', { ou: '-12.844, 45.178' })).ok, true);
    assert.deepEqual(lieuRegle(b.ctx().settings), { par: 'position', lat: -12.844, lon: 45.178 });
    b.connexion({ city: 'Ville C', country_code: 'DE', latitude: 50.11, longitude: 8.68 });
    assert.equal((await b.v.act('gladsheim', 'se_configurer', {})).ok, true);
    assert.equal(lieuRegle(b.ctx().settings).par, 'connexion', 'trouvé par la connexion Internet : approximatif');
    // L'horloge : un fuseau que la machine connaît et qui désigne un seul pays (cherché, rien d'écrit ici).
    const tz = (Intl.supportedValuesOf('timeZone') as string[]).find((x) => lieuDuFuseau(x));
    if (tz) { assert.equal(supposerLieu(b.ctx(), tz, true), true); assert.equal(lieuRegle(b.ctx().settings).par, 'suppose'); assert.equal(b.ctx().settings.lieuPar, '', 'la marque d’avant est retirée'); }
  } finally { b.fin(); }
});

// ------------------------------------------------------------------ le serveur, sans Odin

test('les deux sortes : famille « maison », l\'appli Ulysse, tailles de la maquette (2 × 1 ; 3 × 2), propriétaire seul, jamais sur l\'écran de la maison (la marque est lue par la règle)', () => {
  for (const [id, mini, r] of [['maison_presence', [2, 1], 1], ['maison_famille', [3, 2], 2]] as const) {
    const s = sorteDe(id)!;
    assert.ok(s, id); assert.equal(s.famille, 'maison'); assert.equal(s.posable, true); assert.deepEqual([...(s.applis as readonly string[])], ['gna']);
    assert.deepEqual([[...s.taille.mini], s.taille.r], [mini, r]); assert.equal(publicDe(s), 'proprietaire'); assert.equal(s.jamaisALaMaison, true);
    assert.equal(admiseALaMaison(id), false); assert.equal(copiable(id), false);
    assert.deepEqual((TAILLE_SORTE as Record<string, unknown>)[id], { mini, r }, `${id} : la taille gardée par Hestia`);
    const w = { id: 'c9e40009', kind: id } as unknown as Widget;
    assert.equal(droitDeVoir(w, { qui: 'proprietaire', ecran: 'maison' }, { appli: () => undefined })?.etat, 'refuse', `${id} : refusé à lui sur l'écran de la maison`);
    assert.equal(droitDeVoir(w, LUI, { appli: () => undefined }), undefined, `${id} : vu sur son accueil`);
  }
});

test('la box : « home » = là, « not_home » ou une zone = pas là, un état illisible = on ne sait pas ; le compte : là sur ceux dont on sait quelque chose', async () => {
  assert.deepEqual(['home', 'not_home', 'Bureau', 'unknown', 'unavailable', '', undefined, ' HOME '].map(etatBox), ['la', 'pas_la', 'pas_la', 'inconnu', 'inconnu', 'inconnu', 'inconnu', 'la']);
  const lu: Lu = { box: [{ nom: 'Aya', etat: 'home' }, { nom: 'Ilan', etat: 'not_home' }, { nom: 'Noa', etat: 'unknown' }, { nom: 'Sami', etat: 'Bureau-Essai' }, { nom: '  ', etat: 'home' }], positions: [], lieu: { par: 'aucun' } };
  const p = await etat(PETIT(), LUI, fausse({ lu }).src), f = await etat(FAM(), LUI, fausse({ lu }).src);
  assert.equal(p.etat, 'ok'); assert.equal(p.at, MAINT, 'lu à l\'instant par la box');
  assert.deepEqual([p.donnee!.la, p.donnee!.sur, p.donnee!.total], [1, 3, 4]); assert.equal('personnes' in p.donnee!, false, 'le petit chiffre ne sert aucun nom');
  assert.equal('villeSeulement' in p.donnee!, false);
  assert.deepEqual(noms(f), [['Aya', 'la', 'box'], ['Ilan', 'pas_la', 'box'], ['Noa', 'inconnu', 'box'], ['Sami', 'pas_la', 'box']]);
  assert.ok(!JSON.stringify(f).includes('Bureau-Essai'), 'le nom de la zone n\'est pas servi');
  // Un lieu à régler ne change rien pour la box ; personne d'autre n'a de position.
  assert.equal('lieuARegler' in f.donnee!, false);
});

test('sans box : la position d\'un membre comparée au lieu réglé par « Me localiser » ; un membre que la box connaît garde l\'état de la box', async () => {
  const lu: Lu = { box: [{ nom: 'Aya', etat: 'not_home' }], lieu: PAR_POSITION,
    positions: [pos('aya', 0), pos('Ilan', 30), pos('Noa', 2000), pos('Sami', 0, { acc: 4000 }), pos('Lou', 0, { ilYa: 200 })] };
  const f = await etat(FAM(), LUI, fausse({ lu }).src), p = await etat(PETIT(), LUI, fausse({ lu }).src);
  assert.deepEqual(noms(f), [['Aya', 'pas_la', 'box'], ['Ilan', 'la', 'maison'], ['Noa', 'pas_la', 'maison'], ['Sami', 'inconnu', 'maison'], ['Lou', 'sans_nouvelles', 'maison']]);
  assert.deepEqual([p.donnee!.la, p.donnee!.sur, p.donnee!.total], [1, 3, 5]);
  assert.equal(f.donnee!.personnes[1].at, MAINT - 5 * MIN, 'l\'âge de l\'information : celui de la position reçue');
  assert.equal(p.at, MAINT - 200 * MIN, 'l\'âge de la carte : celui de l\'information la plus ancienne');
});

test('l\'âge est vrai ou absent : une personne de la box n\'a pas d\'âge (jamais « à l\'instant » inventé) ; celui de la carte ne vient que des positions reçues', async () => {
  const lu: Lu = { box: [{ nom: 'Aya', etat: 'home' }, { nom: 'Noa', etat: 'not_home' }], lieu: PAR_POSITION, positions: [pos('Ilan', 0, { ilYa: 40 })] };
  const f = await etat(FAM(), LUI, fausse({ lu }).src);
  assert.deepEqual(f.donnee!.personnes.map((x: any) => [x.nom, 'at' in x]), [['Aya', false], ['Noa', false], ['Ilan', true]]);
  assert.equal(f.at, MAINT - 40 * MIN, 'l\'âge de la carte : celui de la position, pas celui de la lecture de la box');
  // La box seule : la carte garde le moment de sa lecture (la règle des autres widgets), aucune personne n'a d'âge.
  const seule = await etat(FAM(), LUI, fausse({ lu: { ...lu, positions: [] } }).src);
  assert.equal(seule.at, MAINT); assert.ok(seule.donnee!.personnes.every((x: any) => !('at' in x)));
});

test('une box qui ne répond pas : jamais « Personne n\'est suivi » ; la source est dite muette ; les membres suivis restent comptés', async () => {
  const muette: Lu = { boxMuette: true, positions: [], lieu: PAR_POSITION };
  for (const w of [PETIT(), FAM()]) assert.deepEqual(await etat(w, LUI, fausse({ lu: muette }).src), { etat: 'source_absente', raison: 'appli_muette' }, w.kind);
  // Une box muette et des membres dont le lieu est à régler : la box est dite muette, pas « lieu à régler » seul.
  for (const w of [PETIT(), FAM()]) assert.deepEqual(await etat(w, LUI, fausse({ lu: { boxMuette: true, positions: [pos('Ilan', 0)], lieu: { par: 'suppose' } } }).src), { etat: 'source_absente', raison: 'appli_muette' }, w.kind);
  const avec = await etat(FAM(), LUI, fausse({ lu: { ...muette, positions: [pos('Ilan', 0)] } }).src);
  assert.deepEqual(noms(avec), [['Ilan', 'la', 'maison']]);
});

test('un lieu réglé par une ville : jamais « à la maison » sans la réserve ; « à la ville près » est servi', async () => {
  const lu: Lu = { positions: [pos('Ilan', 3000), pos('Noa', 40_000)], lieu: PAR_VILLE };
  const f = await etat(FAM(), LUI, fausse({ lu }).src), p = await etat(PETIT(), LUI, fausse({ lu }).src);
  assert.deepEqual(noms(f), [['Ilan', 'la', 'ville'], ['Noa', 'pas_la', 'ville']]);
  assert.equal(f.donnee!.villeSeulement, true); assert.equal(p.donnee!.villeSeulement, true);
  assert.ok(f.donnee!.personnes.every((x: any) => x.precision !== 'maison'));
});

test('un lieu supposé, trouvé par la connexion, inconnu ou absent : rien n\'est calculé ; « vide » dit qu\'il faut régler le lieu ; ni box ni position : rien', async () => {
  for (const lieu of [{ par: 'suppose' }, { par: 'connexion', ...ICI }, { par: 'inconnu', ...ICI }, { par: 'aucun' }, { par: 'position' }] as LieuRegle[]) {
    const lu: Lu = { positions: [pos('Ilan', 0)], lieu };
    for (const w of [PETIT(), FAM()]) assert.deepEqual(await etat(w, LUI, fausse({ lu }).src), { etat: 'vide', raison: 'lieu_a_regler' }, `${lieu.par} : ${w.kind}`);
    // Avec la box : ses personnes, et la marque « lieu à régler » pour les autres (sans un nom).
    const avec = await etat(FAM(), LUI, fausse({ lu: { ...lu, box: [{ nom: 'Aya', etat: 'home' }] } }).src);
    assert.deepEqual(noms(avec), [['Aya', 'la', 'box']]); assert.equal(avec.donnee!.lieuARegler, true); assert.ok(!JSON.stringify(avec).includes('Ilan'));
  }
  for (const w of [PETIT(), FAM()]) {
    assert.deepEqual(await etat(w, LUI, fausse().src), { etat: 'vide', raison: 'personne' }, 'ni box ni position');
    assert.deepEqual(await etat(w, LUI, fausse({ lu: { box: [], positions: [], lieu: PAR_POSITION } }).src), { etat: 'vide', raison: 'personne' });
    assert.deepEqual(await etat(w, LUI, fausse({ lu: null }).src), { etat: 'source_absente', raison: 'appli_muette' });
    assert.deepEqual(await etat(w, LUI, fausse({ sansLecture: true }).src), { etat: 'source_absente', raison: 'pas_encore_lu' });
    assert.deepEqual(await etat(w, LUI, fausse({ sansUlysse: true }).src), { etat: 'source_absente', raison: 'appli_absente' });
  }
});

test('des positions trop vieilles : « pas de nouvelles », jamais comptées ; le petit chiffre sans personne dont on sache quelque chose : « vide », jamais « 0 / 0 »', async () => {
  const lu: Lu = { positions: [pos('Ilan', 0, { ilYa: 500 }), pos('Noa', 0, { acc: 5000 })], lieu: PAR_POSITION };
  assert.deepEqual(await etat(PETIT(), LUI, fausse({ lu }).src), { etat: 'vide', raison: 'sans_nouvelles' });
  const f = await etat(FAM(), LUI, fausse({ lu }).src);
  assert.equal(f.etat, 'ok'); assert.deepEqual([f.donnee!.la, f.donnee!.sur], [0, 0]); assert.deepEqual(noms(f).map((x: any) => x[1]), ['sans_nouvelles', 'inconnu']);
  // Personne là, mais on sait : un vrai zéro, sur combien.
  const dehors = await etat(PETIT(), LUI, fausse({ lu: { positions: [pos('Ilan', 9000)], lieu: PAR_POSITION } }).src);
  assert.deepEqual([dehors.donnee!.la, dehors.donnee!.sur], [0, 1]);
});

test('la réponse brute ne porte ni latitude, ni longitude, ni distance, ni zone, ni batterie, ni précision du téléphone ; un prénom piégé reste du texte borné', async () => {
  const PIEGE = `<img src=x onerror="alert(1)">${'x'.repeat(200)}`;
  const lu: Lu = { box: [{ nom: 'Aya', etat: 'Zone-Essai' }], lieu: PAR_POSITION, positions: [{ ...pos('Ilan', 50), acc: 17, batt: 64 } as Pos, pos(PIEGE, 0), { nom: 3, at: MAINT, lat: 0, lon: 0 } as never, null as never] };
  for (const w of [PETIT(), FAM()]) {
    const e = await etat(w, LUI, fausse({ lu }).src), brut = JSON.stringify(e);
    assert.equal(e.etat, 'ok');
    for (const interdit of ['lat', 'lon', 'acc', 'batt', 'distance', 'zone', 'place', 'Zone-Essai', '-12.8', '45.1', 'maps', 'geo:']) assert.ok(!brut.includes(interdit), `${w.kind} : « ${interdit} » absent (${brut.slice(0, 300)})`);
  }
  const f = await etat(FAM(), LUI, fausse({ lu }).src);
  // Rien d'autre par personne ; une personne de la box n'a pas d'âge (Odin ne sait pas de quand date l'état qu'elle donne).
  for (const p of f.donnee!.personnes) assert.deepEqual(Object.keys(p).sort(), p.precision === 'box' ? ['etat', 'nom', 'precision'] : ['at', 'etat', 'nom', 'precision'], 'rien d\'autre par personne');
  assert.equal(f.donnee!.personnes[2].nom, PIEGE.slice(0, 60), 'coupé à 60 signes, tel quel');
  assert.equal(f.donnee!.personnes.length, 3, 'une personne sans nom n\'est pas servie');
  // Au-delà de 24 personnes : 24 servies, et le compte entier.
  const beaucoup = await etat(FAM(), LUI, fausse({ lu: { lieu: PAR_POSITION, positions: Array.from({ length: 30 }, (_, i) => pos(`P${i}`, i % 2 ? 0 : 9000)) } }).src);
  assert.deepEqual([beaucoup.donnee!.personnes.length, beaucoup.donnee!.total, beaucoup.donnee!.la, beaucoup.donnee!.sur], [24, 30, 15, 30]);
});

test('qui voit quoi : un membre (même avec tous les droits), une tablette, l\'écran de la maison (lui compris) : refusés AVANT la lecture, sans un nom ni un état', async () => {
  const tout = new Set(['c9e40001@gna', 'c9e40002@gna']);
  const membreTout: Lecteur = { qui: 'membre', ecran: 'accueil', peutLire: () => true, ouverts: tout };
  const lu: Lu = { box: [{ nom: 'Aya', etat: 'home' }], positions: [pos('Ilan', 0)], lieu: PAR_POSITION };
  for (const [qui, l] of [['membre avec tous les droits', membreTout], ['tablette', { qui: 'maison', ecran: 'maison' } as Lecteur], ['tablette sur l\'accueil', { qui: 'maison', ecran: 'accueil' } as Lecteur],
    ['lui, sur l\'écran de la maison', { qui: 'proprietaire', ecran: 'maison' } as Lecteur], ['membre sur l\'écran de la maison', { ...membreTout, ecran: 'maison' } as Lecteur]] as const) {
    for (const w of [PETIT(), FAM()]) {
      const { src, lus } = fausse({ lu });
      const r = await etat(w, l, src);
      assert.equal(r.etat, 'refuse', `${qui} : ${w.kind}`); assert.equal(lus.presence, 0, `${qui} : rien n'est lu`);
      assert.ok(!/Aya|Ilan|"la"|pas_la/.test(JSON.stringify(r)), `${qui} : ni nom ni état`);
      // La lecture seule le redit : appelée directement pour un autre que lui, elle refuse sans rien lire.
      const direct = await sorteDe(w.kind)!.lire!(w, src, l) as Etat;
      assert.equal(direct.etat, 'refuse'); assert.equal(lus.presence, 0);
    }
  }
});

// ------------------------------------------------------------------ la page, sans navigateur

const fenetreVm = () => {
  const win: Record<string, any> = {};
  for (const src of [PRESENCE, RENDU, GRILLE]) vm.runInNewContext(src, { window: win });
  return win;
};
const ici = <X>(x: X): X => JSON.parse(JSON.stringify(x));

test('la page : les deux sortes se déclarent (propriétaire seul, jamais sur l\'écran de la maison, « Famille » rangée avec Odin) ; la grille connaît leurs tailles ; aucun lien vers un site de cartes', () => {
  const win = fenetreVm(), R = win.OdinWidgetsRendu, G = win.OdinGrille;
  const p = R.rendu('maison_presence'), f = R.rendu('maison_famille');
  assert.deepEqual(ici([p?.titre, p?.appli, p?.proprio, p?.petit, p?.jamaisALaMaison, p?.groupe]), ['À la maison', 'gna', true, true, true, '']);
  assert.deepEqual(ici([f?.titre, f?.appli, f?.proprio, f?.petit, f?.jamaisALaMaison, f?.groupe]), ['Famille', 'gna', true, false, true, 'odin']);
  assert.deepEqual(ici([p.w.c, p.w.r, f.w.c, f.w.r]), [2, 1, 3, 2], 'posées à la taille de la maquette');
  assert.deepEqual(ici(R.posables({ proprio: false, aDroit: () => true }).filter((y: any) => /^maison_(presence|famille)$/.test(y.sorte))), [], 'jamais à un membre');
  assert.equal(ici(R.posables({ proprio: true, aDroit: () => true }).filter((y: any) => /^maison_(presence|famille)$/.test(y.sorte))).length, 2, 'proposées au propriétaire');
  for (const k of ['maison_presence', 'maison_famille']) {
    assert.equal(R.copieRefusee({ kind: k, versMaison: true, privee: false }), 'maison');
    assert.deepEqual([[...G.MINI[k]], G.HAUTEUR[k]], [[...sorteDe(k)!.taille.mini], sorteDe(k)!.taille.r], `${k} : les tables de la grille suivent le serveur`);
  }
  // Le texte d'une donnée : jamais par innerHTML (seules les icônes dessinées ici le sont).
  assert.deepEqual([...PRESENCE.matchAll(/innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim()), ['icone(k)']);
  assert.ok(!new RegExp(`${'fr'}-FR|timeZone`).test(PRESENCE), 'ni langue ni fuseau écrits');
  // Aucun lien vers un site de cartes, aucune position demandée d'ici, aucune action lancée d'ici.
  assert.doesNotMatch(PRESENCE, /maps|openstreetmap|geo:|geolocation|latitude|longitude|fetch\(|\/api\//i);
  assert.doesNotMatch(PRESENCE, /au travail|rentre vers/i, 'aucune supposition sur l\'endroit où est quelqu\'un');
});

test('la page : l\'initiale, une couleur stable par prénom, un mot pour chaque état (pas la couleur seule), la réserve « à la ville près »', () => {
  const N = fenetreVm().OdinWidgetsMaisonPresence;
  assert.equal(N.initiale('aya'), 'A'); assert.equal(N.initiale('  élise '), 'É'); assert.equal(N.initiale(''), ''); assert.equal(N.initiale(3), '');
  assert.equal(N.teinte('Aya'), N.teinte('Aya'), 'stable'); assert.ok(Number.isInteger(N.teinte('Aya')) && N.teinte('Aya') >= 0 && N.teinte('Aya') < 360);
  assert.notEqual(N.teinte('Aya'), N.teinte('Ilan'));
  for (const k of ['la', 'pas_la', 'inconnu', 'sans_nouvelles']) assert.ok(N.TEXTES.etats[k], k);
  assert.equal(N.TEXTES.etats.sans_nouvelles, 'pas de nouvelles');
  assert.equal(N.sous({ etat: 'ok', donnee: { la: 2, sur: 3, total: 4 } }), '2 à la maison sur 3');
  assert.equal(N.sous({ etat: 'ok', donnee: { la: 2, sur: 3, total: 4, villeSeulement: true } }), '2 là sur 3, à la ville près');
  assert.equal(N.sous({ etat: 'ok', donnee: { la: 0, sur: 0, total: 2 } }), 'pas de nouvelles');
  for (const d of [{}, { la: 3, sur: 2 }, { la: -1, sur: 2 }]) assert.equal(N.sous({ etat: 'ok', donnee: d }), '', JSON.stringify(d));
  // Une donnée illisible : rien d'affirmé.
  const R = fenetreVm().OdinWidgetsRendu;
  assert.equal(R.dessineElleMeme(R.rendu('maison_famille'), { etat: 'vide', raison: 'lieu_a_regler', donnee: false }), true);
  assert.equal(R.dessineElleMeme(R.rendu('maison_presence'), { etat: 'vide', raison: 'sans_nouvelles', donnee: false }), true);
});

declare const document: any, window: any, getComputedStyle: any, location: any, requestAnimationFrame: any;

// ------------------------------------------------------------------ un vrai Odin d'essai
// Dans un bloc à part : il démarre après les essais d'au-dessus (dont un Odin sans réseau, arrêté à sa fin).
describe('un vrai Odin d’essai', () => {

const tt = new Banc(), orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, jeton: process.env.HA_TOKEN };
let v: VraiOdin, membreTout = '', cleMaison = '', box: Server, appelsBox = 0;
const MDP = 'une-pirogue-sur-le-lagon-calme';
const IDS = ['gladsheim', 'var', 'gna', 'midgard'];
const cookieDe = (r: Response, nom: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nom}=`))?.split(';')[0] ?? '';
async function entrer(ident: string, mdp: string): Promise<string> {
  let r = await fetch(`${v.url}/sso/odin`, { redirect: 'manual' }); assert.equal(r.status, 303);
  r = await fetch(new URL(r.headers.get('location')!, v.url), { redirect: 'manual' }); const demande = /name="demande" value="([^"]+)"/.exec(await r.text())![1];
  r = await fetch(`${v.url}/sso/autoriser`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: v.url }, body: new URLSearchParams({ demande, identifiant: ident, motdepasse: mdp }) });
  r = await fetch(r.headers.get('location')!, { redirect: 'manual' }); assert.equal(r.status, 303, 'session ouverte');
  return cookieDe(r, 'odin_session');
}
const PAGE = 'b9e40001', ID = { petit: 'c9e40011', famille: 'c9e40012', large: 'c9e40013', vide: 'c9e40014', ville: 'c9e40015', petitVille: 'c9e40016', petitVide: 'c9e40017', ville3: 'c9e40018' };
const FENETRE = () => ({ pages: [{ id: PAGE, name: 'Présence', widgets: [
  { id: ID.petit, kind: 'maison_presence', w: 1, c: 2, r: 1 }, { id: ID.famille, kind: 'maison_famille', w: 1, c: 3, r: 2 },
  { id: ID.large, kind: 'maison_famille', w: 2, c: 6, r: 2 }, { id: ID.vide, kind: 'maison_famille', w: 1, c: 3, r: 2 },
  { id: ID.ville, kind: 'maison_famille', w: 1, c: 4, r: 2 }, { id: ID.petitVille, kind: 'maison_presence', w: 1, c: 2, r: 1 }, { id: ID.petitVide, kind: 'maison_presence', w: 1, c: 2, r: 1 },
  // « Famille » à sa taille de départ (3 × 2), à la ville près, quatre personnes : la réserve et « Me localiser » y tiennent avec au moins une pastille.
  { id: ID.ville3, kind: 'maison_famille', w: 1, c: 3, r: 2 },
] }] });
type Rendue = { id: string; kind: string; etat: string; raison?: string; donnee?: Record<string, any> };
const donnees = async (h: Record<string, string> = {}) => { const r = await v.json(`/api/widgets/donnees?page=${PAGE}`, undefined, h); return { status: r.status, corps: JSON.stringify(r.body), de: (id: string) => ((r.body.widgets as Rendue[] | undefined) ?? []).find((x) => x.id === id) }; };

before(async () => {
  for (const k of ['log', 'error', 'warn', 'info'] as const) console[k] = () => {};
  // Une fausse box (Home Assistant) sur la boucle locale : trois personnes, avec la position que la box connaît.
  box = createServer((req, res) => {
    if (req.url === '/api/states') appelsBox++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url === '/api/states' ? [
      { entity_id: 'person.aya', state: 'home', attributes: { friendly_name: 'Aya', latitude: -12.7777, longitude: 45.2222 } },
      { entity_id: 'person.ilan', state: 'Bureau-Essai', attributes: { friendly_name: 'Ilan', latitude: -12.6666, longitude: 45.3333 } },
      { entity_id: 'person.noa', state: 'unavailable', attributes: { friendly_name: 'Noa' } },
    ] : []));
  });
  await new Promise<void>((ok) => box.listen(0, 'localhost', ok));
  process.env.HA_TOKEN = 'jeton-essai-box';
  v = await vraiOdin(tt, { compte: true, modules: (o) => allModules(o).filter((m) => [...IDS, 'apparence'].includes(m.id)) });
  const va = valhallaOf()!;
  va.ctx('midgard').saveSettings({ haUrl: `http://localhost:${(box.address() as AddressInfo).port}` });
  // Le lieu d'Odin par « Me localiser » (le service de noms ne répond pas ici : la position est gardée quand même).
  const l = await va.act('gladsheim', 'lieu_position', { lat: -12.8, lon: 45.1, precision: 12 }); assert.equal(l.ok, true, l.text);
  // Trois membres qui partagent leur position : Aya (la box la connaît), Sami (à la maison), Lou (loin).
  for (const nom of ['Aya', 'Sami', 'Lou']) assert.equal((await va.act('gladsheim', 'membre', { nom })).ok, true);
  const g = va.ctx('gladsheim'), m = (nom: string) => (g.settings.members as Member[]).find((x) => x.name === nom)!, t = Math.round(Date.now() / 1000);
  recordFix(g, m('Aya'), { _type: 'location', lat: -12.9, lon: 45.3, acc: 9, batt: 77, tst: t });
  recordFix(g, m('Sami'), { _type: 'location', lat: -12.8003, lon: 45.1002, acc: 9, batt: 77, tst: t, inregions: ['Zone-Secrete'] });
  recordFix(g, m('Lou'), { _type: 'location', lat: -12.95, lon: 45.25, acc: 9, batt: 77, tst: t });
  // Un membre avec le droit sur chaque appli de cet Odin.
  assert.equal((await va.act('var', 'ajouter', { login: 'membre-t', nom: 'Membre T', groupes: 'invite', mot_de_passe: MDP })).ok, true);
  for (const appli of ['odin', 'gladsheim', 'gna', 'midgard']) assert.equal((await va.act('var', 'donner_acces', { appli, qui: '@membre-t' })).ok, true);
  lierProprietaire(persona()!);
  membreTout = await entrer('membre-t', MDP); assert.ok(membreTout, 'le membre a une session');
  cleMaison = ((await va.act('gladsheim', 'cle_tablette', { nom: 'Tablette maison', droits: 'maison' })).data as { key: string }).key;
  const r = await va.act('gladsheim', 'regler_fenetre', { fenetre: JSON.stringify(FENETRE()) }); assert.equal(r.ok, true, r.text);
});
after(async () => {
  await tt.end(); Object.assign(console, { log: orig.log, error: orig.error, warn: orig.warn, info: orig.info });
  if (orig.jeton === undefined) delete process.env.HA_TOKEN; else process.env.HA_TOKEN = orig.jeton;
  await new Promise((ok) => box?.close(ok));
});

test('vrai Odin : la box et les positions des membres ; « Me localiser » : à la maison près ; la réponse brute ne porte aucune position, aucune zone, aucune batterie', async () => {
  assert.equal(lieuRegle(valhallaOf()!.ctx('gladsheim').settings).par, 'position');
  const d = await donnees();
  assert.equal(d.status, 200);
  const f = d.de(ID.famille)!, p = d.de(ID.petit)!;
  assert.equal(f.etat, 'ok', JSON.stringify(f));
  assert.deepEqual(f.donnee!.personnes.map((x: any) => [x.nom, x.etat, x.precision]), [['Aya', 'la', 'box'], ['Ilan', 'pas_la', 'box'], ['Noa', 'inconnu', 'box'], ['Sami', 'la', 'maison'], ['Lou', 'pas_la', 'maison']]);
  assert.deepEqual([p.donnee!.la, p.donnee!.sur, p.donnee!.total], [2, 4, 5]);
  for (const interdit of ['-12.7777', '45.2222', '-12.8003', '45.1002', '-12.95', 'Bureau-Essai', 'Zone-Secrete', '"lat"', '"lon"', '"acc"', '"batt"', 'latitude', 'longitude', 'distance', 'person.']) assert.ok(!d.corps.includes(interdit), `« ${interdit} » absent de la réponse`);
});

test('vrai Odin : un membre avec tous les droits, une tablette « maison », une clé d\'accès, sans session : refusés sans un nom ni un état, et la box n\'est même pas lue', async () => {
  const avant = appelsBox;
  const m = await donnees({ cookie: membreTout });
  assert.equal(m.status, 200, m.corps);
  for (const id of Object.values(ID)) { const x = m.de(id)!; assert.deepEqual([x.etat, x.donnee], ['refuse', undefined], `membre : ${id}`); }
  assert.ok(!/Aya|Ilan|Noa|Sami|Lou/.test(m.corps), 'membre : aucun nom');
  for (const [qui, h] of [['tablette', { cookie: '', 'x-odin-maison': cleMaison }], ['clé d\'accès', { cookie: '', authorization: `Bearer ${v.token}` }], ['sans session', { cookie: '' }]] as const) {
    const r = await donnees(h);
    assert.equal(r.status, 401, qui); assert.ok(!/Aya|Ilan|Noa|Sami|Lou/.test(r.corps), `${qui} : rien`);
  }
  assert.equal(appelsBox, avant, 'la box n\'a pas été lue pour eux (ni les positions, lues dans le même appel)');
  assert.equal((await donnees()).de(ID.famille)!.etat, 'ok'); assert.ok(appelsBox > avant, 'pour lui, elle l\'est');
});

// ------------------------------------------------------------------ dans un vrai navigateur (s'il y en a un)

interface Route { fetch(): Promise<{ json(): Promise<any> }>; fulfill(o: Record<string, unknown>): Promise<void> }
interface Page {
  goto(u: string): Promise<unknown>; waitForSelector(s: string, o?: Record<string, unknown>): Promise<unknown>;
  waitForFunction(f: string | ((a: any) => unknown), a?: unknown, o?: Record<string, unknown>): Promise<unknown>; evaluate<X>(f: string | ((a?: any) => X), a?: unknown): Promise<X>;
  route(u: string | RegExp, h: (r: Route) => Promise<void> | void): Promise<void>; on(e: string, f: (x: any) => void): void; screenshot(o: Record<string, unknown>): Promise<unknown>;
  keyboard: { press(k: string): Promise<void> };
}
interface Contexte { newPage(): Promise<Page>; addCookies(c: unknown[]): Promise<void>; addInitScript(f: string | (() => void)): Promise<void>; close(): Promise<void> }
interface Navigateur { newContext(o: Record<string, unknown>): Promise<Contexte>; close(): Promise<void> }
const pw = (() => { try { return createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Navigateur> } }; } catch { return undefined; } })();
const sansNav = pw ? false : 'Playwright n\'est pas installé sur cette machine';
let nav: Navigateur | undefined;
before(async () => { if (pw) nav = await pw.chromium.launch(); });
after(async () => { await nav?.close(); });
const CAPTURES = process.env.ODIN_CAPTURES;
const carte = (id: string) => `#feGrid > .fe-w[data-id="${id}"]`;
const PIEGE = `<img src=x onerror="window.__piege=1">${'x'.repeat(50)}`;
/** Les données forcées : sept personnes (un prénom piégé), ou deux à la ville près. */
const FORCEE = (id: string) => {
  const t = Date.now(), P = (nom: string, etat: string, precision = 'maison', ilYa = 4) => ({ nom, etat, precision, at: t - ilYa * MIN });
  if (id === ID.vide) return { etat: 'vide', raison: 'lieu_a_regler' };
  if (id === ID.petitVide) return { etat: 'vide', raison: 'sans_nouvelles' };
  if (id === ID.ville3) return { etat: 'ok', at: t - 4 * MIN, donnee: { la: 2, sur: 3, total: 4, villeSeulement: true, personnes: [P('Sami', 'la', 'ville'), P('Lou', 'pas_la', 'ville'), P('Eden', 'sans_nouvelles', 'ville', 240), P('Zoé', 'la', 'ville')] } };
  if (id === ID.ville || id === ID.petitVille) return { etat: 'ok', at: t - 4 * MIN, donnee: { la: 1, sur: 2, total: 2, villeSeulement: true, ...(id === ID.ville ? { personnes: [P('Ilan', 'la', 'ville'), P('Noa', 'pas_la', 'ville')] } : {}) } };
  const personnes = [P('Aya', 'la', 'box', 0), P(PIEGE, 'la'), P('Ilan', 'pas_la'), P('Noa', 'inconnu'), P('Sami', 'sans_nouvelles', 'maison', 400), P('Lou', 'la'), P('Eden', 'pas_la')];
  return { etat: 'ok', at: t - 400 * MIN, donnee: { la: 3, sur: 5, total: 7, ...(id === ID.petit ? {} : { personnes }) } };
};

async function ouvrir(largeur: number, sombre: boolean) {
  const doigt = largeur < 500;
  assert.equal((await valhallaOf()!.act('apparence', 'theme', { theme: sombre ? 'nuit' : 'glace' })).ok, true);
  const ctx = await nav!.newContext({ viewport: { width: largeur, height: doigt ? 800 : 900 }, hasTouch: doigt, isMobile: doigt, colorScheme: sombre ? 'dark' : 'light' });
  const [n, ...x] = v.session.split('='); await ctx.addCookies([{ name: n, value: x.join('='), url: v.url, httpOnly: true, sameSite: 'Strict' }]);
  await ctx.addInitScript(`try { localStorage.setItem('odin.tour', 'done'); localStorage.setItem('odin.fenetre.page', '1'); } catch { /* rien */ }`);
  const p = await ctx.newPage(), erreurs: string[] = [];
  p.on('pageerror', (e) => erreurs.push(String(e)));
  await p.route(/\/api\/widgets\/donnees/, async (r) => {
    const rep = await r.fetch(), j = await rep.json();
    if (Array.isArray(j?.widgets)) j.widgets = j.widgets.map((w: any) => (/^maison_(presence|famille)$/.test(w.kind) ? { id: w.id, kind: w.kind, page: w.page, ...FORCEE(w.id) } : w));
    await r.fulfill({ response: rep, json: j });
  });
  await p.goto(v.url + '/');
  await p.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  try { await p.waitForSelector(`${carte(ID.famille)} .wpf-p`, { timeout: 45000 }); }
  catch (e) { const vus = await p.evaluate(() => [location.hash, ...[...document.querySelectorAll('#feGrid > .fe-w')].map((c: any) => `${c.dataset.id}: ${c.textContent.slice(0, 80)}`)]); await ctx.close(); throw new Error(`${String(e).split('\n')[0]} · cartes : ${JSON.stringify(vus)} · ${erreurs.join(' | ')}`); }
  return { ctx, page: p, erreurs };
}
const vu = (p: Page) => p.evaluate(async (ids: Record<string, string>) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const vw = document.documentElement.clientWidth, txt = (n: any) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out: Record<string, any> = { deborde: document.documentElement.scrollWidth > vw + 1, piege: Boolean(window.__piege) || Boolean(document.querySelector('#feGrid img[src="x"]')) };
  for (const [nom, id] of Object.entries(ids)) {
    const c = document.querySelector(`#feGrid > .fe-w[data-id="${id}"]`); if (!c) { out[nom] = null; continue; }
    const b = c.getBoundingClientRect(), dans = (n: any) => { const r = n.getBoundingClientRect(); return r.width === 0 || (r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1); };
    const visibles = [...c.querySelectorAll('.wpf-p')].filter((n: any) => n.checkVisibility() && n.getBoundingClientRect().height > 0);
    out[nom] = {
      texte: txt(c), dedans: [...c.querySelectorAll('*')].every(dans), haut: Math.round(b.height),
      petits: [...c.querySelectorAll('button, a')].filter((n: any) => { const r = n.getBoundingClientRect(); return r.width && (r.width < 44 || r.height < 44); }).map((n: any) => n.getAttribute('aria-label') || txt(n)),
      initiales: visibles.map((n: any) => txt(n.querySelector('.wpf-av'))), mots: visibles.map((n: any) => txt(n.querySelector('.wpf-mot'))),
      dits: visibles.map((n: any) => txt(n.querySelector('.wpf-sr'))), bulles: visibles.map((n: any) => n.title),
      montres: visibles.length, plus: txt(c.querySelector('.wpf-plus')), sous: txt(c.querySelector('.wr-s')), reserve: txt(c.querySelector('.wpf-reserve')),
      boutons: [...c.querySelectorAll('.wpf-btn')].map(txt),
      // La réserve, lisible en entier : dans la zone visible du corps, pas rognée par le bas.
      reserveEntiere: (() => { const r = c.querySelector('.wpf-reserve'), f = c.querySelector('.wpf-defile'); if (!r || !f) return null; const a = r.getBoundingClientRect(), z = f.getBoundingClientRect(); return a.height > 0 && a.top >= z.top - 0.5 && a.bottom <= z.bottom + 0.5; })(),
      // Le texte qui se voit (sans les phrases pour lecteur d'écran), et une phrase vide coupée par sa limite de lignes.
      vuTexte: (() => { const k = c.cloneNode(true); k.querySelectorAll('.wpf-sr, [hidden]').forEach((n: any) => n.remove()); return txt(k); })(),
      calmeCoupe: [...c.querySelectorAll('.wpf-calme')].some((n: any) => n.scrollHeight > n.clientHeight + 1),
      // Le compte : coupé dans le sous-titre de l'en-tête ? redit, entier, sous les pastilles.
      sousCoupe: (() => { const n = c.querySelector('.wr-s'); return Boolean(n && n.scrollWidth > n.clientWidth + 1); })(),
      compte: (() => { const n = c.querySelector('.wpf-compte'); return n && getComputedStyle(n).display !== 'none' ? { t: txt(n), coupe: n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().width === 0 } : null; })(), coupe: [...c.querySelectorAll('.wpf-mot, .wpp-l, .wpp-v')].some((n: any) => n.scrollWidth > n.clientWidth + 1 && !n.title),
      ink: (() => { const s = document.createElement('i'); c.append(s); s.style.color = 'var(--ink)'; const k = getComputedStyle(s).color; s.remove(); return k; })(),
    };
  }
  return out;
}, ID);
const clarte = (rgb: string) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

for (const [largeur, sombre] of [[1280, false], [390, true], [768, true], [768, false], [1024, false], [1280, true]] as const) {
  test(`navigateur, ${largeur} px, ${sombre ? 'sombre' : 'clair'} : le compte, une pastille par personne avec un mot, le prénom piégé en texte, la réserve « à la ville près », « Me localiser » au clavier`, { skip: sansNav }, async () => {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, sombre);
    try {
      const x = await vu(p);
      assert.equal(x.deborde, false, 'rien ne déborde de la page'); assert.equal(x.piege, false, 'le prénom piégé n\'est jamais du code');
      for (const k of Object.keys(ID)) { assert.equal(x[k].dedans, true, `${k} : dans sa carte (${x[k].texte})`); assert.deepEqual(x[k].petits, [], `${k} : des cibles de 44 px`); assert.equal(x[k].coupe, false, `${k} : un texte coupé a son entier en info-bulle`); }
      // Le petit chiffre : « 3 / 5 », « À la maison » ; à la ville près : la réserve écrite.
      assert.match(x.petit.texte, /3\s*\/\s*5/); assert.match(x.petit.texte, /À la maison/);
      assert.match(x.petitVille.texte, /1\s*\/\s*2/); assert.match(x.petitVille.texte, /ville près/); assert.doesNotMatch(x.petitVille.texte, /À la maison/);
      assert.match(x.petitVide.texte, /nouvelles/); assert.doesNotMatch(x.petitVide.texte, /\d/, 'ni 0 ni 0 / 0');
      // « Famille » : l'en-tête dit le compte vrai ; chaque pastille : une initiale, un mot, la phrase entière pour le lecteur d'écran.
      assert.match(x.famille.sous, /3 à la maison sur 5/);
      assert.ok(x.famille.montres >= 1, 'au moins une pastille');
      assert.equal(x.famille.initiales[0], 'A'); assert.equal(x.famille.mots[0], 'là'); assert.match(x.famille.dits[0], /Aya/); assert.match(x.famille.dits[0], /là/);
      if (x.famille.montres > 1) { assert.equal(x.famille.initiales[1], '<'); assert.ok(x.famille.bulles[1].includes(PIEGE), 'le prénom entier en info-bulle'); }
      assert.match(x.famille.plus, /\d/, `et N de plus (${x.famille.texte})`);
      for (const k of ['famille', 'large', 'ville', 'ville3']) {
        if (x[k].sousCoupe) { assert.ok(x[k].compte, `${k} : le compte coupé dans l'en-tête est redit dans le corps`); assert.equal(x[k].compte.coupe, false, `${k} : entier`); assert.match(x[k].compte.t, /sur/); }
        else assert.equal(x[k].compte, null, `${k} : l'en-tête dit le compte en entier, il n'est pas redit (${x[k].texte})`);
      }
      // « Famille » 3 × 2 à la ville près : au moins une pastille, la réserve entière et « Me localiser ».
      assert.ok(x.ville3.montres >= 1, `ville 3 × 2 : au moins une pastille (${x.ville3.vuTexte})`);
      for (const k of ['ville', 'ville3']) assert.equal(x[k].reserveEntiere, true, `${k} : la réserve « à la ville près » se lit en entier`);
      assert.match(x.ville3.reserve, /ville près/); assert.ok(x.ville3.boutons.includes('Me localiser'));
      // Le lieu à régler : la ville est proposée dans le texte qui se voit, pas seulement en info-bulle ; la phrase n'est pas coupée.
      assert.match(x.vide.vuTexte, /ville/, `vide : ${x.vide.vuTexte}`); assert.equal(x.vide.calmeCoupe, false, 'la phrase vide se lit en entier');
      assert.deepEqual(x.large.mots.slice(0, Math.min(5, x.large.montres)), ['là', 'là', 'pas là', 'incertain', 'pas de nouvelles'].slice(0, Math.min(5, x.large.montres)));
      assert.doesNotMatch(x.large.texte, /travail|rentre vers/);
      // La ville : la réserve écrite sur la carte, et « Me localiser » proposé.
      assert.match(x.ville.reserve, /ville près/); assert.ok(x.ville.boutons.includes('Me localiser'), `Me localiser : ${x.ville.boutons}`);
      assert.match(x.vide.texte, /Me localiser/); assert.match(x.vide.texte, /ville/); assert.ok(x.vide.boutons.includes('Me localiser'));
      if (largeur > 700) assert.ok(Math.abs(x.famille.haut - 162) <= 2, `3 × 2 : ${x.famille.haut} px, la carte ne s'étire pas (${Object.keys(ID).map((k) => `${k} ${x[k].haut}`).join(', ')})`);
      assert.ok(sombre ? clarte(x.famille.ink) > 0.5 : clarte(x.famille.ink) < 0.5, `le thème ${sombre ? 'sombre' : 'clair'} est appliqué`);
      if (CAPTURES) await p.screenshot({ path: `${CAPTURES}/presence-${largeur}${sombre ? '-sombre' : '-clair'}.png`, fullPage: true });
      // « Me localiser » au clavier : le focus se voit ; Entrée ouvre les réglages du lieu.
      const btn = `${carte(ID.vide)} .wpf-btn`;
      await p.evaluate((s: string) => document.querySelector(s).focus(), btn);
      assert.notEqual(await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'le focus se voit');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => location.hash === '#settings', undefined, { timeout: 10000 });
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page');
    } finally { await ctx.close(); }
  });
}

test('navigateur, 320 et 1920 px : rien ne déborde ; en mode « Modifier », « Me localiser » ne part pas', { skip: sansNav }, async () => {
  for (const largeur of [320, 1920]) {
    const { ctx, page: p, erreurs } = await ouvrir(largeur, false);
    try {
      const x = await vu(p);
      assert.equal(x.deborde, false, `${largeur} : la page ne déborde pas`);
      for (const k of Object.keys(ID)) assert.equal(x[k].dedans, true, `${largeur} : ${k} reste dans sa carte`);
      if (largeur === 1920) {
        await p.evaluate(() => document.querySelector('#feGrid').classList.add('fe-edit'));
        await p.evaluate((s: string) => document.querySelector(s).click(), `${carte(ID.vide)} .wpf-btn`);
        await new Promise((r) => setTimeout(r, 300));
        assert.notEqual(await p.evaluate(() => location.hash), '#settings', 'rien ne part en mode « Modifier »');
      }
      assert.deepEqual(erreurs, []);
    } finally { await ctx.close(); }
  }
});
});
