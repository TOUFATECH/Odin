// Glaðsheimr, l'écran de la maison : thèmes, boutons vers les applis, clés de tablette (droits « maison » ou
// « complet »), météo, page /maison (sécurité : cadre autorisé seulement pour Home Assistant), API avec
// confirmation des actions graves, mascotte (heure, météo, ordres).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules, setValhalla } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { keyRights, resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';
import { maisonRoute } from '../src/web/maison-api.ts';

function world() {
  const home = mkdtempSync(join(tmpdir(), 'gladsheim-'));
  const fakeFetch = (async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith('https://geocoding-api.open-meteo.com/')) return Response.json({ results: [{ latitude: -12.78, longitude: 45.23 }] });
    if (url.startsWith('https://api.open-meteo.com/')) {
      const hours = Array.from({ length: 48 }, (_, i) => new Date(Date.now() + i * 3600_000).toISOString().slice(0, 13) + ':00');
      return Response.json({ current: { temperature_2m: 29.4, apparent_temperature: 33, relative_humidity_2m: 74, weather_code: 2, wind_speed_10m: 18, precipitation: 0 }, hourly: { time: hours, temperature_2m: hours.map((_, i) => 26 + (i % 6)) }, daily: { time: ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'], weather_code: [2, 63, 1, 0, 3, 80, 95], temperature_2m_max: [31, 30, 31, 32, 30, 29, 30], temperature_2m_min: [24, 24, 25, 24, 23, 24, 24], sunrise: ['2026-11-12T05:31'], sunset: ['2026-11-12T18:12'] } });
    }
    throw new Error('réseau coupé par le test');
  }) as typeof fetch;
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: fakeFetch, notify: async () => {}, autonomy: () => 'equilibre' });
  setValhalla(v); resetGladsheim();
  return { v, act: (a: string, i: Record<string, unknown> = {}) => v.act('gladsheim', a, i), end: () => { setValhalla(undefined); v.stop(); rmSync(home, { recursive: true, force: true }); } };
}

test('réglages : thèmes, boutons, clés de tablette, météo, Home Assistant', async () => {
  const w = world();
  try {
    assert.match((await w.act('theme', { theme: 'braise' })).text, /Braise/);
    assert.equal((await w.act('theme', { theme: 'rose' })).ok, false);
    assert.match((await w.act('boutons')).text, /VPN : allumer → gjoll\.allumer/);
    assert.match((await w.act('bouton', { nom: 'Bloquer Awa', appli: 'var', action: 'couper_sessions', reglages: 'login=awa', icone: '🚫', couleur: '#EF4F43' })).text, /Bouton « Bloquer Awa » → Persona · Couper les sessions/);
    assert.equal((await w.act('bouton', { nom: 'X', appli: 'nimporte', action: 'y' })).ok, false);
    assert.match((await w.act('bouton', { nom: 'X', appli: 'var', action: 'voler' })).text, /action inconnue dans Persona/);
    assert.equal((await w.act('bouton', { nom: 'X', appli: 'var', action: 'personnes', couleur: 'rouge' })).ok, false);
    const tiles = w.v.ctx('gladsheim').settings.tiles as Array<{ label: string; input: Record<string, unknown> }>;
    assert.deepEqual(tiles.find((t) => t.label === 'Bloquer Awa')!.input, { login: 'awa' });
    assert.match((await w.act('retirer_bouton', { nom: 'bloquer awa' })).text, /retiré/);
    // Clé de tablette : montrée une fois, gardée en empreinte seulement.
    const k = await w.act('cle_tablette', { nom: 'Tablette entrée', droits: 'maison' }), key = (k.data as { key: string }).key;
    assert.match(key, /^gk_[A-Za-z0-9_-]{32}$/); assert.ok(!JSON.stringify(w.v.ctx('gladsheim').settings).includes(key), 'la clé n\'est pas gardée en clair');
    assert.equal(keyRights(w.v.ctx('gladsheim'), key)?.rights, 'maison'); assert.equal(keyRights(w.v.ctx('gladsheim'), `${key.slice(0, -1)}x`), undefined); assert.equal(keyRights(w.v.ctx('gladsheim'), 'nimporte'), undefined);
    assert.equal((await w.act('cle_tablette', { nom: 'tablette entrée' })).ok, false, 'nom déjà pris');
    assert.match((await w.act('meteo', { ville: 'Mamoudzou' })).text, /À Mamoudzou : 29 °C, partiellement nuageux \(min 24°, max 31°\), humidité 74 %, vent 18 km\/h\. Demain : pluie, 24° à 30°\./);
    const ha = await w.act('home_assistant', { adresse: 'https://ha.maison.fr:8123', odin: 'http://192.168.1.10:8080' });
    assert.match(ha.text, /type: iframe\n   url: http:\/\/192\.168\.1\.10:8080\/maison#cle=<ta clé>/); assert.match(ha.text, /bloquera l'écran/);
    const view = await w.v.module('gladsheim')!.view(w.v.ctx('gladsheim'), new URLSearchParams());
    assert.ok(view.sections.some((x) => x.title === 'Clés de tablette'));
    assert.match((await w.act('retirer_cle', { nom: 'Tablette entrée' })).text, /retirée/);
    assert.equal(keyRights(w.v.ctx('gladsheim'), key), undefined, 'clé retirée = plus d\'accès');
  } finally { w.end(); }
});

test('page et API /maison : session, clé de tablette, droits, confirmation, mascotte', async () => {
  const w = world();
  let authed = false, fails = 0; const asked: string[] = [];
  const srv = createServer((req, res) => { void maisonRoute(req, res, new URL(req.url!, 'http://x'), { authed, name: 'Awa', mascot: '<svg viewBox="0 0 120 120"></svg>', fail: () => { fails++; }, ask: async (t) => { asked.push(t); return `Odin a fait : ${t} [humeur:joie]`; } }).then((done) => { if (!done) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const get = (p: string, h: Record<string, string> = {}) => fetch(base + p, { headers: h });
  const post = (p: string, b: unknown, h: Record<string, string> = {}) => fetch(base + p, { method: 'POST', headers: { 'x-odin': '1', 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, ...(await r.json()) as Record<string, unknown> }) as { status: number; [k: string]: unknown });
  try {
    // La page : pas de cadre ailleurs que chez Odin… puis Home Assistant autorisé.
    let r = await get('/maison'); const html = await r.text();
    assert.match(r.headers.get('content-security-policy')!, /frame-ancestors 'self';/); assert.match(html, /<template id="mascotte"><svg/); assert.match(html, /src="\/maison\.js"/);
    await w.act('home_assistant', { adresse: 'https://ha.maison.fr:8123', odin: 'https://odin.maison.fr' });
    assert.match((await get('/maison')).headers.get('content-security-policy')!, /frame-ancestors 'self' https:\/\/ha\.maison\.fr:8123;/);
    assert.match(await (await get('/maison.js')).text(), /Glaðsheimr/);
    // Sans session ni clé : refusé ; une fausse clé compte comme un essai raté.
    assert.equal((await get('/api/maison/etat')).status, 401);
    assert.equal((await get('/api/maison/etat', { 'x-odin-maison': 'gk_faussefaussefaussefaussefaussefausse' })).status, 401); assert.equal(fails, 1);
    // Tablette « maison ».
    const key = ((await w.act('cle_tablette', { nom: 'Entrée' })).data as { key: string }).key, K = { 'x-odin-maison': key };
    const st = await (await get('/api/maison/etat', K)).json() as { rights: string; weather: { temp: number; word: string }; tiles: Array<{ id: string; label: string; grave: boolean }>; apps: unknown[]; notices: unknown[]; themes: Record<string, string> };
    assert.equal(st.rights, 'maison'); assert.equal(st.weather.temp, 29); assert.equal(st.weather.word, 'Partiellement nuageux'); assert.deepEqual(st.apps, []); assert.deepEqual(st.notices, []); assert.equal(Object.keys(st.themes).length, 31);
    const vpn = st.tiles.find((t) => t.label === 'VPN : allumer')!; assert.ok(vpn.grave);
    assert.equal((await post('/api/maison/bouton', { id: vpn.id }, { 'x-odin-maison': key, 'x-odin': '' })).status, 403, 'en-tête anti-falsification exigé');
    assert.match(String((await post('/api/maison/bouton', { id: vpn.id }, K)).text), /action grave, à lancer depuis Odin/);
    const ports = st.tiles.find((t) => t.label === 'Ports ouverts')!;
    assert.equal((await post('/api/maison/bouton', { id: ports.id }, K)).ok, true);
    assert.match(String((await post('/api/maison/theme', { theme: 'nuit' }, K)).text), /depuis Odin/);
    assert.match(String((await post('/api/maison/dire', { texte: 'quelle heure est-il ?' }, K)).text), /^Il est \d\d:\d\d, /);
    assert.match(String((await post('/api/maison/dire', { texte: 'quel temps fait-il' }, K)).text), /À Mamoudzou : 29 °C/);
    assert.match(String((await post('/api/maison/dire', { texte: 'supprime tous mes fichiers' }, K)).text), /je commande la maison/);
    assert.deepEqual(asked, [], 'une tablette « maison » ne parle pas à l\'IA');
    // Ta session : tout, avec confirmation des actions graves.
    authed = true;
    const full = await (await get('/api/maison/etat')).json() as { rights: string; apps: Array<{ id: string; name: string }> };
    assert.equal(full.rights, 'complet'); assert.ok(full.apps.some((a) => a.id === 'vordr') && !full.apps.some((a) => a.id === 'gladsheim'));
    assert.match(String((await post('/api/maison/bouton', { id: vpn.id })).confirm), /^Confirmer : allumer le VPN de la maison \?$/);
    assert.ok('text' in await post('/api/maison/bouton', { id: vpn.id, confirm: true }));
    assert.equal((await post('/api/maison/theme', { theme: 'nuit' })).ok, true); assert.equal(w.v.ctx('gladsheim').settings.theme, 'nuit');
    assert.equal((await post('/api/maison/dire', { texte: 'allume la lumière du salon' })).text, 'Odin a fait : allume la lumière du salon');
    assert.deepEqual(asked, ['allume la lumière du salon']);
    // OwnTracks : un membre envoie sa position (identifiants Basic), reçoit celles des autres ; la mascotte sait où il est.
    const nour = await w.act('membre', { nom: 'Nour', adresse: 'https://odin.maison.fr' }), sami = await w.act('membre', { nom: 'Sami' });
    const pass = /Mot de passe : (\S+)/.exec(nour.text)![1], passS = /Mot de passe : (\S+)/.exec(sami.text)![1];
    assert.match(nour.text, /Adresse : https:\/\/odin\.maison\.fr\/api\/owntracks\n- Identifiant : nour/);
    assert.ok(!JSON.stringify(w.v.ctx('gladsheim').settings).includes(pass), 'mot de passe pas gardé en clair');
    const ot = (user: string, pw: string, body: unknown) => fetch(`${base}/api/owntracks`, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${user}:${pw}`).toString('base64')}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await ot('nour', 'faux', { _type: 'location', lat: 1, lon: 1 })).status, 401);
    assert.deepEqual(await (await ot('nour', pass, { _type: 'location', lat: -12.7891234, lon: 45.2312, acc: 12, batt: 64, tst: Math.floor(Date.now() / 1000), inregions: ['École'] })).json(), []);
    const back = await (await ot('sami', passS, { _type: 'location', lat: -12.8, lon: 45.1 })).json() as Array<Record<string, unknown>>;
    assert.deepEqual(back.map((x) => x._type), ['card', 'location']); assert.equal(back[1].lat, -12.78912); assert.equal(back[1].tid, 'NO');
    assert.equal((await ot('sami', passS, { _type: 'location', lat: 200, lon: 1 })).status, 200, 'position absurde ignorée');
    assert.match(String((await post('/api/maison/dire', { texte: 'où est Nour ?' })).text), /^Nour : École il y a 1 min \(batterie 64 %\)\.$/);
    const fam = await (await get('/api/maison/etat')).json() as { people: Array<{ name: string; source: string; lat: number }> };
    assert.deepEqual(fam.people.map((x) => `${x.name}/${x.source}`).sort(), ['Nour/OwnTracks', 'Sami/OwnTracks']);
    assert.match((await w.act('positions')).text, /Nour : École, https:\/\/www\.openstreetmap\.org/);
    authed = false; assert.match(String((await post('/api/maison/dire', { texte: 'où est Nour ?' }, K)).text), /je commande la maison/, 'tablette « maison » : pas de position');
    assert.equal((await post('/api/maison/reseau', { ip: '192.168.1.20' }, K)).status, 403); assert.equal((await get('/api/maison/camera?nom=x', K)).status, 403); authed = true;
    await w.act('retirer_membre', { nom: 'Nour' }); assert.equal((await ot('nour', pass, { _type: 'location', lat: 1, lon: 1 })).status, 401);
    assert.ok(!(await w.act('positions')).text.includes('Nour'), 'positions effacées');
    // Réseau : couper Internet / la vidéo d'un appareil (Víðarr), réservé à la session.
    assert.match(String((await post('/api/maison/reseau', { ip: '192.168.1.20', nom: 'PC de Nour' })).text), /PC de Nour \(192\.168\.1\.20\) coupé d'Internet/);
    assert.match(String((await post('/api/maison/video', { ip: '192.168.1.30', nom: 'Télé' })).text), /Vidéo coupée pour Télé .*YouTube, Netflix/);
    assert.match(String((await post('/api/maison/reseau', { ip: '192.168.1.20', couper: false })).text), /retrouve Internet/);
    assert.equal((await post('/api/maison/bouton', { id: 'inconnu' })).status, 404);
    assert.equal((await fetch(`${base}/api/maison/dire`, { method: 'POST', headers: { 'x-odin': '1' }, body: 'x'.repeat(20_000) })).status, 413);
  } finally { srv.close(); w.end(); }
});
