// Le lieu d'Odin : le village exact où il est installé. Il se règle par son nom (« ma ville est Dembéni ») ou par
// la position de l'appareil (GPS) ; la météo, le fuseau horaire et le thème automatique le suivent. Plusieurs lieux
// du même nom : celui du pays réglé d'abord. Rien ne change si le lieu est introuvable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { lieuDe, regionActuelle, resetGladsheim, supposerLieu, surLieu, type Lieu } from '../src/valhalla/modules/gladsheim.ts';
import { lieuCourant, lieuDuFuseau, lieuPourConsignes, regionDe, setLieuCourant } from '../src/valhalla/lieu.ts';

/** Ce que répond le service qui dit où sort la connexion Internet (rien : il est en panne). */
let connexion: Record<string, unknown> | undefined;
import { setValhalla } from '../src/valhalla/odin.ts';
import { offlineAct } from '../src/core/offline-act.ts';

const LIEUX: Record<string, unknown[]> = {
  dembeni: [
    { name: 'Dembeni', latitude: -11.6, longitude: 43.3, country_code: 'KM', country: 'Comores', admin1: 'Grande Comore', timezone: 'Indian/Comoro' },
    { name: 'Dembéni', latitude: -12.8436, longitude: 45.1814, country_code: 'YT', country: 'Mayotte', timezone: 'Indian/Mayotte' },
  ],
  mamoudzou: [{ name: 'Mamoudzou', latitude: -12.78, longitude: 45.23, country_code: 'YT', country: 'Mayotte', timezone: 'Indian/Mayotte' }],
  paris: [{ name: 'Paris', latitude: 48.85, longitude: 2.35, country_code: 'FR', country: 'France', admin1: 'Île-de-France', timezone: 'Europe/Paris' }, { name: 'Paris', latitude: 33.66, longitude: -95.55, country_code: 'US', country: 'États-Unis', admin1: 'Texas', timezone: 'America/Chicago' }],
};
const sans = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function banc() {
  const home = mkdtempSync(join(tmpdir(), 'odin-lieu-')), vus: string[] = [];
  const fakeFetch = (async (u: string | URL | Request, init?: RequestInit) => {
    const url = String(u); vus.push(url);
    if (url.startsWith('https://geocoding-api.open-meteo.com/')) return Response.json({ results: LIEUX[sans(decodeURIComponent(new URL(url).searchParams.get('name') ?? ''))] ?? [] });
    if (url.startsWith('https://nominatim.openstreetmap.org/reverse')) {
      assert.match(String((init?.headers as Record<string, string> | undefined)?.['user-agent']), /^Odin/, 'le service de noms reçoit un nom de client générique');
      const q = new URL(url).searchParams;
      return Response.json(Number(q.get('lat')) < -12.8 ? { address: { village: 'Tsararano', municipality: 'Dembéni', state: 'Mayotte', country: 'France', country_code: 'yt' } } : { address: {} });
    }
    if (url.startsWith('https://ipapi.co/json')) return connexion ? Response.json(connexion) : new Response('indisponible', { status: 503 });
    if (url.startsWith('https://api.open-meteo.com/')) {
      const lat = Number(new URL(url).searchParams.get('latitude'));
      return Response.json({ timezone: lat > 50 ? 'Europe/Berlin' : lat > 40 ? 'Europe/Paris' : lat > 30 ? 'America/Chicago' : 'Indian/Mayotte', current: { temperature_2m: lat > 40 ? 12 : 29, apparent_temperature: 30, relative_humidity_2m: 74, weather_code: 2, wind_speed_10m: 18, precipitation: 0 }, hourly: { time: [], temperature_2m: [] }, daily: { time: ['2026-11-15', '2026-11-16'], weather_code: [2, 61], temperature_2m_max: [31, 30], temperature_2m_min: [24, 24], sunrise: ['2026-11-15T05:30', '2026-11-16T05:30'], sunset: ['2026-11-15T18:10', '2026-11-16T18:10'] } });
    }
    throw new Error(`adresse inattendue : ${url}`);
  }) as typeof fetch;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fakeFetch, notify: async () => {}, autonomy: () => 'equilibre' });
  resetGladsheim();
  return { v, vus, ctx: () => v.ctx('gladsheim'), fin: () => { v.stop(); surLieu(undefined); rmSync(home, { recursive: true, force: true }); } };
}

test('lieu par son nom : le bon Dembéni (Mayotte), son nom exact, ses coordonnées et son fuseau ; la météo suit', async () => {
  const b = banc(), recus: Lieu[] = []; surLieu((l) => recus.push(l));
  try {
    assert.equal(lieuDe(b.ctx()), undefined, 'rien de réglé au départ');
    assert.match((await b.v.act('gladsheim', 'meteo', {})).text, /^À Mamoudzou : 29 °C.*Lieu par défaut : Mamoudzou\. Pour le changer : « ma ville est … »/s);
    const r = await b.v.act('gladsheim', 'lieu', { ville: 'dembeni' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Odin est à Dembéni \(Mayotte\)\. À Dembéni : 29 °C/);
    assert.match(r.text, /D'autres lieux portent ce nom \(Grande Comore, Comores\)/, 'il dit qu\'un autre lieu porte ce nom');
    assert.deepEqual(lieuDe(b.ctx()), { nom: 'Dembéni', lat: -12.844, lon: 45.181, pays: 'YT', fuseau: 'Indian/Mayotte' });
    assert.deepEqual(recus.map((l) => l.nom), ['Dembéni'], 'le briefing du matin est prévenu');
    assert.ok(b.vus.some((u) => u.includes('latitude=-12.844') && u.includes('longitude=45.181')), 'la météo est demandée pour ces coordonnées (gardées à ~100 m)');
    assert.match((await b.v.act('gladsheim', 'meteo', {})).text, /^À Dembéni : 29 °C/);
    assert.match((await b.v.act('gladsheim', 'lieu_actuel', {})).text, /Odin est à Dembéni \(-12\.844, 45\.181\), fuseau Indian\/Mayotte/);
    // « Ville, pays » choisit un autre lieu du même nom ; le fuseau suit.
    assert.match((await b.v.act('gladsheim', 'lieu', { ville: 'Paris, Texas' })).text, /Odin est à Paris \(Texas, États-Unis\)/);
    assert.match((await b.v.act('gladsheim', 'lieu', { ville: 'Paris, France' })).text, /Odin est à Paris \(Île-de-France, France\)\. À Paris : 12 °C/);
    assert.equal(lieuDe(b.ctx())?.fuseau, 'Europe/Paris');
  } finally { b.fin(); }
});

test('lieu introuvable ou recherche en panne : rien ne change, et Odin dit quoi faire', async () => {
  const b = banc();
  try {
    await b.v.act('gladsheim', 'lieu', { ville: 'Dembéni' });
    const r = await b.v.act('gladsheim', 'lieu', { ville: 'Zzzzville' });
    assert.equal(r.ok, false); assert.match(r.text, /je ne trouve pas « Zzzzville » : vérifie l'orthographe, ou précise le pays/);
    assert.equal(lieuDe(b.ctx())?.nom, 'Dembéni', 'le lieu d\'avant est gardé');
  } finally { b.fin(); }
});

test('lieu par la position de l\'appareil : village nommé d\'après la position, précision dite, position approximative signalée', async () => {
  const b = banc();
  try {
    let r = await b.v.act('gladsheim', 'lieu_position', { lat: -12.84412345, lon: 45.17876543, precision: 18 });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Tu es à Tsararano \(Dembéni\) \(position à ± 18 m\)\. À Tsararano \(Dembéni\) : 29 °C/);
    assert.doesNotMatch(r.text, /approximative/);
    assert.deepEqual(lieuDe(b.ctx()), { nom: 'Tsararano (Dembéni)', lat: -12.844, lon: 45.179, pays: 'YT', fuseau: 'Indian/Mayotte', precision: 18 });
    // Un ordinateur sans GPS : ± 4 km, Odin prévient.
    r = await b.v.act('gladsheim', 'lieu_position', { lat: -12.95, lon: 45.2, precision: 4200 });
    assert.match(r.text, /position à ± 4,2 km/); assert.match(r.text, /position approximative : si le village n'est pas le bon/);
    // Le service de noms ne connaît pas l'endroit : la position est gardée quand même, et c'est dit.
    r = await b.v.act('gladsheim', 'lieu_position', { lat: -12.5, lon: 45.1 });
    assert.match(r.text, /Position gardée \(-12\.5, 45\.1\), mais je n'ai pas pu trouver le nom du village/);
    // Position illisible : refusée.
    r = await b.v.act('gladsheim', 'lieu_position', { lat: 120, lon: 45 });
    assert.equal(r.ok, false); assert.match(r.text, /position illisible/);
  } finally { b.fin(); }
});

test("la météo d'une autre ville ne change pas le lieu d'Odin", async () => {
  const b = banc();
  try {
    await b.v.act('gladsheim', 'lieu', { ville: 'Dembéni' });
    assert.match((await b.v.act('gladsheim', 'meteo', { ville: 'Paris, France' })).text, /^À Paris : 12 °C/);
    assert.equal(lieuDe(b.ctx())?.nom, 'Dembéni', 'Odin est toujours à Dembéni');
    assert.match((await b.v.act('gladsheim', 'meteo', {})).text, /^À Dembéni : 29 °C/);
  } finally { b.fin(); }
});

test("sans IA : « ma ville est Dembéni », « j'habite à … », « change de ville pour … » vont à Hestia, avec le nom tel qu'il est écrit", async () => {
  const b = banc(), appels: Array<Record<string, unknown>> = [];
  const run = async (name: string, input: Record<string, unknown>) => { appels.push({ name, ...input }); return { ok: true, content: 'fait' }; };
  try {
    setValhalla(b.v);
    for (const [phrase, ville] of [['ma ville est Dembéni', 'Dembéni'], ["Odin, mon village c'est Tsararano.", 'Tsararano'], ["j'habite à Bouéni", 'Bouéni'], ['change de ville pour Saint-Denis, Réunion', 'Saint-Denis, Réunion'], ['Odin est installé à Mamoudzou', 'Mamoudzou']] as const) {
      appels.length = 0;
      assert.equal(await offlineAct(phrase, run, () => true), 'fait', phrase);
      assert.deepEqual(appels, [{ name: 'valhalla', action: 'action', appli: 'gladsheim', quoi: 'lieu', entree: JSON.stringify({ ville }) }], phrase);
    }
    // Pas une ville : ces phrases ne touchent pas au lieu.
    for (const phrase of ['je suis à la maison', 'ma ville me manque beaucoup depuis que je suis parti travailler ailleurs', 'change la lumière du salon']) {
      appels.length = 0; await offlineAct(phrase, run, () => true).catch(() => undefined);
      assert.ok(!appels.some((a) => a.quoi === 'lieu'), phrase);
    }
  } finally { setValhalla(undefined); b.fin(); }
});

// ---------------- Odin se règle d'après son lieu ----------------
test('règles par pays : unités, heure, devise et fêtes ; ce que dit l\'horloge de la machine', () => {
  assert.deepEqual([regionDe('YT').unites, regionDe('YT').heure, regionDe('YT').devise, regionDe('YT').nom], ['metrique', '24h', 'EUR', 'Mayotte']);
  assert.deepEqual([regionDe('us').unites, regionDe('us').heure, regionDe('us').devise], ['imperial', '12h', 'USD']);
  assert.equal(regionDe('US').fetes.thanksgiving, true); assert.equal(regionDe('US').fetes.nationale, false);
  assert.equal(regionDe('FR').fetes.abolition, false, 'le 27 avril est propre à Mayotte');
  assert.deepEqual(regionDe('YT').fetes, {}, 'à Mayotte : les fêtes d\'origine');
  assert.deepEqual([regionDe('ZZ').unites, regionDe('ZZ').devise], ['metrique', 'EUR'], 'pays inconnu : réglages communs');
  assert.deepEqual(lieuDuFuseau('Europe/Paris'), { pays: 'FR', ville: 'Paris' });
  assert.deepEqual(lieuDuFuseau('America/New_York'), { pays: 'US', ville: 'New York' });
  assert.equal(lieuDuFuseau('UTC'), undefined, 'un serveur loué réglé sur UTC ne dit rien');
  assert.equal(lieuDuFuseau('Africa/Nairobi'), undefined, 'un fuseau partagé par plusieurs pays ne suffit pas');
});

test('aux États-Unis : Fahrenheit, miles, dollars, fêtes d\'ici ; réglage à la main gardé, puis remis en automatique en changeant de pays', async () => {
  const b = banc();
  try {
    let r = await b.v.act('gladsheim', 'lieu', { ville: 'Paris, Texas' });
    assert.match(r.text, /À Paris : 84 °F, partiellement nuageux \(min 75°, max 88°\), humidité 74 %, vent 11 mph\./);
    assert.deepEqual([lieuCourant()?.nom, lieuCourant()?.region.pays, lieuCourant()?.region.devise, lieuCourant()?.fuseau], ['Paris', 'US', 'USD', 'America/Chicago']);
    assert.match(lieuPourConsignes(), /Lieu d'Odin : Paris \(États-Unis\).*degrés Fahrenheit, miles · heure sur 12 heures · prix en USD/);
    // Les fêtes proposées suivent le pays (Aurore) ; un choix fait à la main passe avant.
    const fetes = async () => Object.fromEntries((((await b.v.act('apparence', 'evenements', {})).data as { events: Array<{ id: string; on: boolean }> }).events).map((e) => [e.id, e.on]));
    let f = await fetes(); assert.deepEqual([f.thanksgiving, f.halloween, f.nationale, f.abolition], [true, true, false, false]);
    // À la main : unités métriques, même aux États-Unis.
    r = await b.v.act('gladsheim', 'region', { unites: 'métriques (°C, km)', devise: 'eur' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /degrés Celsius et kilomètres, heure sur 12 heures, prix en EUR.*réglé à la main : unités, devise/);
    assert.match((await b.v.act('gladsheim', 'meteo', {})).text, /À Paris : 29 °C/);
    assert.equal((await b.v.act('gladsheim', 'region', { fuseau: 'Mars/Olympus' })).ok, false, 'fuseau inconnu refusé');
    assert.equal((await b.v.act('gladsheim', 'region', {})).ok, false, 'rien à changer');
    // Retour à Mayotte : tout repasse en automatique pour ce pays.
    r = await b.v.act('gladsheim', 'lieu', { ville: 'Dembéni' });
    assert.deepEqual(regionActuelle(b.ctx()).manuel, []); assert.match(r.text, /À Dembéni : 29 °C.*vent 18 km\/h/);
    f = await fetes(); assert.deepEqual([f.thanksgiving, f.nationale, f.abolition], [false, true, true]);
  } finally { setLieuCourant(undefined); b.fin(); }
});

test('« configure-toi » : pour une ville, pour une position, ou tout seul (connexion Internet, sinon horloge de la machine)', async () => {
  const b = banc();
  try {
    let r = await b.v.act('gladsheim', 'se_configurer', { ou: 'Paris, France' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Je suis réglé pour Paris \(France\) : fuseau Europe\/Paris \(il est \d{1,2}:\d{2}\), degrés Celsius et kilomètres, heure sur 24 heures, prix en EUR\. \(lieu que tu m'as donné\)\nÀ Paris : 12 °C/);
    r = await b.v.act('gladsheim', 'se_configurer', { ou: '-12.844, 45.178' });
    assert.match(r.text, /Je suis réglé pour Tsararano \(Dembéni\) \(Mayotte\)/); assert.match(r.text, /\(position -12\.844, 45\.178\)/);
    // Tout seul : la connexion Internet sort à Francfort (serveur loué).
    connexion = { city: 'Francfort', region: 'Hesse', country_code: 'DE', latitude: 50.1109, longitude: 8.6821, timezone: 'Europe/Berlin' };
    r = await b.v.act('gladsheim', 'se_configurer', {});
    assert.match(r.text, /Je suis réglé pour Francfort \(Allemagne\) : fuseau Europe\/Berlin/); assert.match(r.text, /d'après ma connexion Internet : c'est approximatif/);
    assert.deepEqual([lieuDe(b.ctx())?.nom, lieuDe(b.ctx())?.pays, lieuDe(b.ctx())?.lat], ['Francfort', 'DE', 50.111]); // position gardée à ~100 m (données privées)
    // Le service ne répond pas et l'horloge ne dit rien (UTC) : Odin le dit, rien ne change.
    connexion = undefined;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!lieuDuFuseau(tz)) { r = await b.v.act('gladsheim', 'se_configurer', {}); assert.equal(r.ok, false); assert.match(r.text, /je n'arrive pas à me localiser tout seul/); assert.equal(lieuDe(b.ctx())?.nom, 'Francfort'); }
  } finally { connexion = undefined; setLieuCourant(undefined); b.fin(); }
});

test('au démarrage, rien de réglé : le lieu est supposé d\'après l\'horloge de la machine, et Odin le dit', async () => {
  const b = banc();
  try {
    assert.equal(supposerLieu(b.ctx(), 'UTC'), false, 'UTC : pas de supposition');
    assert.equal(supposerLieu(b.ctx(), 'Europe/Paris'), true);
    assert.match((await b.v.act('gladsheim', 'meteo', {})).text, /^À Paris : 12 °C.*Je me crois à Paris d'après l'horloge de la machine\. Si ce n'est pas ça : « ma ville est … »/s);
    assert.match((await b.v.act('gladsheim', 'region_actuelle', {})).text, /Je suis réglé pour Paris \(France\), supposé d'après l'horloge de la machine/);
    assert.equal(supposerLieu(b.ctx(), 'America/New_York'), false, 'un lieu déjà là n\'est jamais remplacé par une supposition');
    await b.v.act('gladsheim', 'lieu', { ville: 'Dembéni' });
    assert.doesNotMatch((await b.v.act('gladsheim', 'meteo', {})).text, /Je me crois/);
  } finally { setLieuCourant(undefined); b.fin(); }
});
