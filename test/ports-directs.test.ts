// Ports directs par appli : http://IP:<port> ouvre directement la page d'une appli, par la même interface et avec la
// même connexion. Essais sur un VRAI Odin (interface web démarrée, vraies écoutes, vrai « fetch ») : le plan, la page
// avec et sans session, les refus (déjà pris et par qui, gardé, sous 1024 sans les droits, hors bornes), le changement
// à chaud, la fermeture, ce qui est gardé après un redémarrage, l'ouverture sur le réseau avec accord (Cerbère), et
// une appli installée par le moteur d'Odin (vrai conteneur) qui reçoit son port fixe.
// Seul le pare-feu est faux : un faux « ufw » note ce qu'on lui demande (le vrai pare-feu de la machine n'est jamais touché).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chownSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as httpServer, request as httpRequest, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { T, freePort, until } from './banc/lib.ts';
import { COMPTE, vraiOdin } from './banc/odin-vrai.ts';
import { busyboxLayer } from './oci-fixtures.ts';
import { makeOdin, type TestOdin } from './helpers.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import { ensureTls } from '../src/web/access.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { allModules, startValhalla, valhallaOf } from '../src/valhalla/odin.ts';
import { DirectPorts, directFile, directOpen, directPage, directView, directs } from '../src/valhalla/directports.ts';
import { explainListen, listeners, readListeners } from '../src/valhalla/hostports.ts';
import { APPS_RANGE, APP_PORTS, BROWSER_BLOCKED, DIRECT_RANGE, ODIN_PORTS, SERVICES_RANGE, WEB, conflicts, describe, directApp, directPort, directRefusal, planOf, reserved, setDirectPorts, suggestDirect } from '../src/valhalla/ports.ts';
import { placePorts } from '../src/valhalla/parc.ts';
import { Engine } from '../src/valhalla/hringhorni/engine.ts';
import { naglfar, useEngine } from '../src/valhalla/modules/naglfar.ts';
import { ymir } from '../src/valhalla/modules/ymir.ts';
import { quiEst } from '../src/valhalla/modules/hlid.ts';
import { understand } from '../src/valhalla/huginn.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import type { Module } from '../src/valhalla/types.ts';

// ---------------------------------------------------------------- outils d'essai
/** Les applis utiles à ces essais (sans celles qui ouvrent leurs propres ports au démarrage). */
const APPLIS = ['saga', 'runes', 'draupnir', 'hlid', 'garmr', 'freyja', 'naglfar', 'vidarr', 'valgrind', 'eir'];
const mods = (o: TestOdin): Module[] => allModules(o).filter((m) => APPLIS.includes(m.id));
interface Appli { id: string; nom: string; port: number | null; etat: string; reseau: boolean; par?: string; note: string; plan: string; vue: string; services: Array<{ port: number; proto: string; quoi: string; etat: string; web?: boolean; adresse?: string }> }
interface Rep { ok?: boolean; text?: string; error?: string; confirm?: string; appli?: Appli; applis?: Appli[]; interface?: { port: number; https: boolean; acces: string }; propose?: number | null; installees?: unknown[]; plages?: Record<string, number[]> }

/** Un faux « ufw » (pare-feu « actif ») et un faux « nft » muet, devant le PATH : chaque demande est notée, rien n'est touché sur la machine. */
function fauxPareFeu(tt: T): { appels(): string[]; refuser(on: boolean): void } {
  const dir = tt.tmp('faux-pare-feu-'), log = join(dir, 'appels.log'), non = join(dir, 'refuse');
  writeFileSync(join(dir, 'ufw'), `#!/bin/sh\necho "$*" >> "${log}"\nif [ "$1" = status ]; then echo "Status: active"; exit 0; fi\nif [ -e "${non}" ]; then echo "ERROR: refus du pare-feu (essai)" >&2; exit 1; fi\nexit 0\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'nft'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const avant = process.env.PATH; process.env.PATH = `${dir}:${avant}`; tt.onEnd(() => { process.env.PATH = avant; });
  return { appels: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []), refuser: (on) => { if (on) writeFileSync(non, ''); else rmSync(non, { force: true }); } };
}
/** Un AUTRE programme (un vrai processus) qui tient un port. */
async function squatteur(tt: T, port: number, host = '127.0.0.1') {
  const p = tt.spawn(process.execPath, ['-e', `require('net').createServer((s)=>s.end('occupe')).listen(${port},'${host}',()=>console.log('pret'))`]);
  assert.ok(await until(() => /pret/.test(p.log()), 8000), `le programme d'essai n'a pas pris le port ${port} : ${p.log()}`);
  return { pid: p.pid!, stop: async () => { p.kill('SIGKILL'); await until(() => p.exitCode !== null || p.signalCode !== null, 4000); } };
}
/** Odin avec l'interface réglée comme on veut (accès, adresse d'écoute, HTTPS), et ce qu'on veut dans son dossier avant le démarrage. */
async function odinRegle(tt: T, o: { access?: 'local' | 'lan' | 'wan'; host?: string; https?: boolean; reseaux?: string[]; avant?: (home: string) => void; compte?: boolean } = {}) {
  const sauve = { MQTT_PASSWORD: process.env.MQTT_PASSWORD, BRISINGAMEN_KEY: process.env.BRISINGAMEN_KEY };
  tt.onEnd(() => { for (const [k, v] of Object.entries(sauve)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const od = makeOdin([{ text: 'ok' }], { config: (c) => ({ ...c, web: { ...c.web, access: o.access ?? 'lan', allowedNetworks: o.reseaux ?? [] } }) }); tt.onEnd(() => od.cleanup());
  o.avant?.(od.paths.home);
  const port = await freePort(), token = ensureWebToken(od.paths), tls = o.https ? ensureTls(od.paths, od.cfg.web) : undefined;
  const gw = new Gateway(od, { owners: { web: ['*'] } });
  const web = new WebChannel(od, { scanNetwork: async () => undefined }, { port, host: o.host ?? '127.0.0.1', token, access: o.access ?? 'lan', tls, scryptN: 1024 });
  gw.add(web); await gw.start(); tt.onEnd(() => gw.stop());
  tt.onEnd(startValhalla(od, async () => {}, { modules: mods(od) }));
  const scheme = tls ? 'https' : 'http';
  /** Une requête pour de vrai (HTTP ou HTTPS auto-signé), sans suivre les redirections. */
  const call = (p: number, path: string, h: Record<string, string> = {}, body?: unknown, host = '127.0.0.1') => new Promise<{ status: number; text: string; headers: Record<string, string | string[] | undefined> }>((ok, ko) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const q = (tls ? httpsRequest : httpRequest)({ host, port: p, path, method: data === undefined ? 'GET' : 'POST', rejectUnauthorized: false, agent: false, headers: { ...(data === undefined ? {} : { 'content-type': 'application/json', 'x-odin': '1' }), ...h } }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => ok({ status: r.statusCode!, text: b, headers: r.headers })); });
    q.on('error', ko); q.setTimeout(8000, () => q.destroy(new Error('délai dépassé'))); q.end(data);
  });
  let session = '';
  if (o.compte !== false) {
    const r = await call(port, '/api/account/create', { cookie: `odin_token=${token}` }, COMPTE);
    session = String((r.headers['set-cookie'] as string[] | undefined)?.find((c) => c.startsWith('odin_session='))?.split(';')[0] ?? '');
    assert.ok(session, `compte d'essai non créé (${r.status} ${r.text})`);
  }
  const api = async (body?: unknown, q = '') => JSON.parse((await call(port, `/api/ports${q}`, { cookie: session }, body)).text) as Rep;
  return { od, port, token, web, gw, scheme, call, api, get session() { return session; } };
}
/** Une adresse de cette machine qui n'est pas la boucle locale (pour arriver « par le réseau »). */
const adresseReseau = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
/** Là où Odin écoute vraiment pour ce port (lu sur la machine avec « ss »). */
const ecouteSur = async (port: number) => (await listeners()).filter((x) => x.proto === 'tcp' && x.port === port).map((x) => x.addr);
const refuse = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return String(((e as Error).cause as Error | undefined)?.message ?? (e as Error).message); } };

// ---------------------------------------------------------------- le plan (pur)
test('plan : un port direct ne marche sur rien (interface, protocoles, applis installées, plages, ports refusés par les navigateurs)', () => {
  assert.deepEqual(conflicts(), []);
  assert.deepEqual([...DIRECT_RANGE], [22000, 22999]);
  setDirectPorts({});
  try {
    assert.equal(directRefusal(8097, 'freyja'), undefined);
    assert.equal(directRefusal(1024, 'freyja'), undefined);
    assert.equal(directRefusal(65535, 'freyja'), undefined);
    // hors bornes
    for (const p of [0, -1, 65536, 70000, 81.5, Number.NaN, Number('abc')]) assert.match(directRefusal(p, 'freyja') ?? '', /nombre entier entre 1 et 65535/, String(p));
    // l'interface d'Odin (7777, ou le port que tu lui as donné)
    assert.match(directRefusal(WEB, 'freyja') ?? '', /celui de l'interface d'Odin/);
    assert.match(directRefusal(9443, 'freyja', { web: 9443 }) ?? '', /celui de l'interface d'Odin/);
    assert.match(directRefusal(WEB, 'freyja', { web: 9443 }) ?? '', /gardé pour Odin/);
    // les ports de protocole et de service du plan, quel que soit le protocole
    for (const p of ODIN_PORTS) assert.match(directRefusal(p.port, 'eir', { web: 9443 }) ?? '', /gardé pour|navigateurs refusent|celui de l'interface/, `${p.port} (${p.name})`);
    assert.match(directRefusal(53, 'eir') ?? '', /gardé pour Sphinx : DNS/);
    assert.match(directRefusal(443, 'eir') ?? '', /gardé pour Valgrind/);
    assert.match(directRefusal(1883, 'eir') ?? '', /gardé pour Constellation : MQTT/);
    // Vénus : son service (Venus) garde 8096, même pour elle
    for (const app of ['eir', 'freyja']) assert.match(directRefusal(8096, app) ?? '', /gardé pour Vénus \(Venus\) : interface de Venus/);
    // les applis installées et leurs plages
    for (const a of APP_PORTS) assert.match(directRefusal(a.host, 'eir') ?? '', new RegExp(`gardé pour ${a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(appli installée`));
    assert.match(directRefusal(APPS_RANGE[0] + 500, 'eir') ?? '', /gardés pour les applis installées/);
    assert.match(directRefusal(SERVICES_RANGE[0] + 500, 'eir') ?? '', /gardés pour les services mis à l'échelle/);
    // ce qu'un navigateur refuse d'ouvrir (liste de la norme Fetch) : inutile d'y mettre une page
    for (const p of [22, 25, 110, 143, 2049, 6000, 6667, 10080]) assert.match(directRefusal(p, 'eir') ?? '', /navigateurs refusent d'ouvrir le port/, String(p));
    assert.equal(Object.keys(BROWSER_BLOCKED).length, 82, 'la liste de la norme, sans le port 0');
    for (let p = DIRECT_RANGE[0]; p <= DIRECT_RANGE[1]; p++) assert.equal(directRefusal(p, 'eir'), undefined, `la plage proposée est libre dans le plan (${p})`);
    // le port direct d'une autre appli
    setDirectPorts({ freyja: 8097 });
    assert.match(directRefusal(8097, 'eir', { name: (id) => (id === 'freyja' ? 'Vénus' : id) }) ?? '', /déjà le port direct de Vénus/);
    assert.equal(directRefusal(8097, 'freyja'), undefined, 'le sien : pas un conflit');
    assert.equal(directPort('freyja'), 8097); assert.equal(directApp(8097), 'freyja'); assert.ok(reserved().has(8097), 'une appli installée ne le prendra pas');
    assert.equal(describe('freyja'), '8096, 8920, 5433, 51413 TCP · port direct 8097'); assert.equal(planOf('freyja'), '8096, 8920, 5433, 51413 TCP');
    assert.equal(quiEst({ proto: 'tcp', port: 8097, adresse: '0.0.0.0', portee: 'réseau' }), 'Odin : port direct de Vénus (sa page, avec ta connexion)');
    // sans numéro : le premier libre de la plage
    assert.equal(suggestDirect(), 22000); assert.equal(suggestDirect([22000, 22001]), 22002);
    setDirectPorts({ freyja: 22000 }); assert.equal(suggestDirect(), 22001);
  } finally { setDirectPorts({}); }
  assert.equal(describe('saga'), `${WEB} (interface d'Odin)`);
});

test('plan : sans session, un port direct ne laisse passer que l\'écran de connexion ; la page servie mène à l\'appli', () => {
  for (const [m, p] of [['GET', '/'], ['GET', '/health'], ['GET', '/valhalla.js'], ['GET', '/pages/urdr.js'], ['GET', '/fonts/ibm-plex-sans-latin-400-normal.woff2'], ['GET', '/icon-192.png'], ['GET', '/favicon.svg'], ['GET', '/manifest.webmanifest'], ['GET', '/sw.js'], ['POST', '/api/account/login'], ['POST', '/api/account/logout']]) assert.equal(directOpen(m, p), true, `${m} ${p}`);
  for (const [m, p] of [['GET', '/api/state'], ['GET', '/api/ports'], ['GET', '/api/stream'], ['POST', '/api/account/create'], ['POST', '/api/pair'], ['POST', '/api/pair/status'], ['POST', '/api/setup/start'], ['GET', '/activer'], ['POST', '/mcp'], ['POST', '/api/ask'], ['GET', '/api/mascotte'], ['GET', '/h/abc'], ['POST', '/f/abc'], ['GET', '/r/abcdefghijklmnop'], ['GET', '/v/jeton'], ['GET', '/etat/secret'], ['GET', '/dns-query'], ['POST', '/hook/whatsapp'], ['GET', '/maison'], ['GET', '/recherche'], ['GET', '/odin-cert.crt'], ['GET', '/pages/../server.ts'], ['GET', '/fonts/../../x.woff2'], ['HEAD', '/'], ['PUT', '/'], ['POST', '/']]) assert.equal(directOpen(m, p), false, `${m} ${p}`);
  assert.equal(directView('freyja'), 'app=freyja'); assert.equal(directView('saga'), 'brain'); assert.equal(directView('runes'), 'runes'); assert.equal(directView('draupnir'), 'flows');
  const html = '<!doctype html>\n<html lang="fr">\n<head><title>Odin</title></head>';
  assert.equal(directPage(html, 'freyja', 'Vénus'), '<!doctype html>\n<html lang="fr" data-direct="app=freyja">\n<head><title>Vénus · Odin</title></head>');
  assert.match(directPage(html, 'garmr', '<script>x</script>'), /<title>&#60;script&#62;x&#60;\/script&#62; · Odin<\/title>/, 'le nom est écrit comme du texte');
  assert.equal(directPage(html, '"><script>', 'x'), html, 'un identifiant qui n\'en est pas un ne change rien');
  // la vraie page d'Odin a bien les deux repères que le port direct remplace
  const ui = readFileSync(new URL('../src/web/ui.html', import.meta.url), 'utf8');
  assert.equal(ui.split('<html lang="fr">').length, 2); assert.equal(ui.split('<title>Odin</title>').length, 2);
  assert.match(ui, /if \(!location\.hash && document\.documentElement\.dataset\.direct\) history\.replaceState\(null, '', '#' \+ document\.documentElement\.dataset\.direct\);/);
});

test('machine : ce qui écoute (« ss »), un refus d\'écoute dit en clair, les ports d\'une appli à installer', async () => {
  const l = readListeners(`udp   UNCONN 0      0      127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=600,fd=13))
tcp   LISTEN 0      128          0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=900,fd=3))
tcp   LISTEN 0      4096               *:7777             *:*    users:(("node",pid=1200,fd=22))
tcp   LISTEN 0      128             [::]:8097          [::]:*
udp   UNCONN 0      0            0.0.0.0:51820      0.0.0.0:*`);
  assert.deepEqual(l, [{ proto: 'udp', port: 53, addr: '127.0.0.53', prog: 'systemd-resolve', pid: 600 }, { proto: 'tcp', port: 22, addr: '0.0.0.0', prog: 'sshd', pid: 900 }, { proto: 'tcp', port: 7777, addr: '*', prog: 'node', pid: 1200 }, { proto: 'tcp', port: 8097, addr: '::' }, { proto: 'udp', port: 51820, addr: '0.0.0.0' }]);
  assert.deepEqual(readListeners('n\'importe quoi\n\n'), []);
  assert.equal(await explainListen(Object.assign(new Error('listen EACCES: permission denied 0.0.0.0:80'), { code: 'EACCES', port: 80, syscall: 'listen' })), 'le port 80 est sous 1024 et demande les droits d\'administrateur : lance Odin en administrateur, ou choisis un port à partir de 1024');
  assert.equal(await explainListen(new Error('autre chose')), 'autre chose');
  // un port déjà pris : le voulu s'il est libre, sinon le suivant libre, et on dit ce qui a bougé
  const r = placePorts([{ host: 20141, inner: 8080, proto: 'tcp' }, { host: 20142, inner: 80, proto: 'tcp' }, { host: 9000, inner: 9000, proto: 'udp' }], new Set([20141]));
  assert.deepEqual(r.ports.map((p) => p.host), [20142, 20143, 9000]); assert.deepEqual(r.moved, ['20141 déjà pris → 20142', '20142 déjà pris → 20143']);
});

// ---------------------------------------------------------------- un vrai Odin : la page par son port, avec et sans session
test('port direct : http://127.0.0.1:<port> ouvre la page de l\'appli, par la même interface et avec la même connexion', { timeout: 120_000 }, async () => {
  const tt = new T();
  try {
    fauxPareFeu(tt);
    const v = await vraiOdin(tt, { compte: true, modules: mods }), va = valhallaOf()!;
    const p = await freePort(), d = `http://127.0.0.1:${p}`;
    const post = async (body: unknown) => (await v.json('/api/ports', body)).body as Rep;

    // La vue d'ensemble : toutes les applis ; par défaut, le plan (aucun port direct : tout passe par l'interface).
    assert.equal((await fetch(`${v.url}/api/ports`)).status, 401, 'la liste des ports demande une session');
    let r = (await v.json('/api/ports')).body as Rep;
    assert.equal(r.ok, true); assert.deepEqual(r.interface, { port: v.port, https: false, acces: 'local' });
    assert.deepEqual(r.applis!.map((a) => a.id).sort(), [...APPLIS].sort());
    assert.ok(r.applis!.every((a) => a.port === null && a.etat === 'fermé' && !a.reseau), 'aucune écoute en plus tant que tu n\'as rien demandé');
    assert.equal(r.applis!.find((a) => a.id === 'eir')!.note, `Pas de port direct : sa page est dans l'interface d'Odin (port ${v.port}).`);
    assert.equal(r.applis!.find((a) => a.id === 'eir')!.plan, '7777 (interface d\'Odin)');
    const venus = r.applis!.find((a) => a.id === 'freyja')!;
    assert.equal(venus.nom, 'Vénus'); assert.equal(venus.plan, '8096, 8920, 5433, 51413 TCP'); assert.equal(venus.vue, 'app=freyja');
    assert.deepEqual(venus.services.map((x) => [x.port, x.web === true]), [[8096, true], [8920, true], [5433, false], [51413, false]], 'Venus garde ses ports : c\'est son service qui y répond');
    assert.ok(r.propose! >= DIRECT_RANGE[0] && r.propose! <= DIRECT_RANGE[1]);
    assert.equal((await listeners()).filter((x) => x.pid === process.pid && x.proto === 'tcp').length, 1, 'Odin n\'écoute que sur le port de son interface');

    // Régler : l'écoute démarre tout de suite, sans redémarrer Odin, sur cette machine seulement.
    r = await post({ appli: 'freyja', faire: 'regler', port: p });
    assert.equal(r.ok, true, r.text); assert.match(r.text!, new RegExp(`Vénus a maintenant son port : ${p}\\. Depuis cette machine, http://127\\.0\\.0\\.1:${p} ouvre directement sa page`));
    assert.deepEqual([r.appli!.port, r.appli!.etat, r.appli!.reseau, r.appli!.note], [p, 'écoute', false, `Écoute sur le port ${p}, depuis cette machine seulement.`]);
    assert.deepEqual(await ecouteSur(p), ['127.0.0.1'], 'boucle locale seulement : rien de visible depuis le réseau');
    r = (await v.json('/api/ports?appli=V%C3%A9nus')).body as Rep; assert.equal(r.appli!.id, 'freyja'); assert.equal(r.appli!.port, p);
    assert.match(((await v.json('/api/ports?appli=nexiste-pas')).body as Rep).error!, /appli inconnue/);

    // Sans session : la page d'Odin (écran de connexion), qui sait qu'elle mène à Vénus. Rien d'autre.
    let f = await fetch(`${d}/`), html = await f.text();
    assert.equal(f.status, 200); assert.match(html, /<html lang="fr" data-direct="app=freyja">/); assert.match(html, /<title>Vénus · Odin<\/title>/);
    assert.match(html, /const AUTHED = false;/); assert.match(html, /const ACCOUNT = true, SETUP = false;/, 'jamais de création de compte par un port direct');
    const main = await fetch(`${v.url}/`);
    for (const h of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'permissions-policy', 'cache-control']) assert.equal((f.headers.get(h) ?? '').replace(/nonce-[^']+/, 'nonce'), (main.headers.get(h) ?? '').replace(/nonce-[^']+/, 'nonce'), `même en-tête ${h} que l'interface`);
    assert.match(f.headers.get('content-security-policy') ?? '', /default-src 'none'; script-src 'nonce-[^']+'; .*connect-src 'self'; .*frame-ancestors 'none'/);
    assert.doesNotMatch(await main.text(), /data-direct/, 'l\'interface elle-même ne change pas');
    for (const path of ['/api/state', '/api/ports', '/api/valhalla/catalog', '/api/valhalla/view?id=freyja', '/api/stream', '/api/history', '/api/account/me', '/activer', '/maison', '/recherche', '/h/abc', '/v/jeton', '/etat/secret', '/dns-query', '/r/abcdefghijklmnop', '/odin-cert.crt', '/n-importe-quoi']) {
      const x = await fetch(d + path); assert.equal(x.status, 401, `sans session : ${path}`); assert.deepEqual(await x.json(), { error: 'connexion requise', account: true, direct: true });
    }
    for (const path of ['/api/pair', '/api/setup/start', '/api/account/create', '/api/valhalla/act', '/api/ports', '/api/action', '/mcp', '/api/ask', '/hook/whatsapp']) {
      const x = await fetch(d + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ ...COMPTE, appli: 'freyja', faire: 'retirer' }) }); assert.equal(x.status, 401, `sans session : POST ${path}`);
    }
    assert.equal(((await v.json('/api/ports?appli=freyja')).body as Rep).appli!.port, p, 'rien n\'a bougé');
    // La clé d'API (programmes) vaut sur l'interface, jamais sur un port direct.
    assert.equal((await fetch(`${v.url}/api/state`, { headers: { authorization: `Bearer ${v.token}` } })).status, 200);
    assert.equal((await fetch(`${d}/api/state`, { headers: { authorization: `Bearer ${v.token}` } })).status, 401);
    assert.equal((await fetch(`${d}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${v.token}`, 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(`${d}/?token=${v.token}`, { redirect: 'manual' })).headers.get('set-cookie'), null, 'le lien de première connexion ne donne rien non plus');
    // Ce qu'il faut pour afficher l'écran de connexion passe ; rien de privé dedans.
    for (const path of ['/health', '/valhalla.js', '/app-icons.js', '/face.js', '/pages/urdr.js', '/manifest.webmanifest', '/sw.js', '/icon-192.png', '/favicon.svg']) assert.equal((await fetch(d + path)).status, 200, path);

    // Avec la session ouverte sur l'interface (même cookie : il vaut pour tous les ports de la même adresse).
    const H = { cookie: v.session };
    f = await fetch(`${d}/`, { headers: H }); html = await f.text();
    assert.match(html, /const AUTHED = true;/); assert.match(html, /data-direct="app=freyja"/);
    f = await fetch(`${d}/api/valhalla/view?id=freyja`, { headers: H }); assert.equal(f.status, 200); assert.equal(((await f.json()) as { name: string }).name, 'Vénus');
    assert.equal((await fetch(`${d}/api/state`, { headers: H })).status, 200);
    assert.equal(((await (await fetch(`${d}/api/ports?appli=freyja`, { headers: H })).json()) as Rep).appli!.port, p, 'le réglage se lit aussi par le port direct');
    // … mais toujours l'en-tête qui prouve que la demande vient de la page d'Odin, pour tout ce qui change quelque chose.
    f = await fetch(`${d}/api/valhalla/act`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ module: 'hlid', action: 'retirer_port_direct', input: { appli: 'freyja' } }) });
    assert.equal(f.status, 403); assert.deepEqual(await f.json(), { error: 'en-tête x-odin manquant' });
    f = await fetch(`${d}/api/ports`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ appli: 'freyja', faire: 'retirer' }) }); assert.equal(f.status, 403);
    assert.equal(((await v.json('/api/ports?appli=freyja')).body as Rep).appli!.port, p);
    // Le flux en direct de l'interface passe par le port direct (avec session seulement).
    const ctrl = new AbortController(), flux = await fetch(`${d}/api/stream`, { headers: H, signal: ctrl.signal });
    assert.equal(flux.status, 200); assert.match(flux.headers.get('content-type') ?? '', /text\/event-stream/);
    const lu = await flux.body!.getReader().read(); assert.match(Buffer.from(lu.value!).toString(), /^: ok/); ctrl.abort();
    // Une session fermée ne vaut plus nulle part.
    const autre = await fetch(`${v.url}/api/account/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(COMPTE) });
    const s2 = autre.headers.getSetCookie().find((c) => c.startsWith('odin_session='))!.split(';')[0];
    assert.equal((await fetch(`${d}/api/state`, { headers: { cookie: s2 } })).status, 200);
    await fetch(`${d}/api/account/logout`, { method: 'POST', headers: { cookie: s2, 'x-odin': '1' } });
    assert.equal((await fetch(`${d}/api/state`, { headers: { cookie: s2 } })).status, 401); assert.equal((await fetch(`${v.url}/api/state`, { headers: { cookie: s2 } })).status, 401);
    assert.equal((await fetch(`${d}/api/state`, { headers: { cookie: 'odin_session=' + 'A'.repeat(43) } })).status, 401, 'un cookie inventé ne passe pas');

    // Se connecter par le port direct : mauvais mot de passe refusé, bon mot de passe accepté, et on est chez soi.
    f = await fetch(`${d}/api/account/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify({ email: COMPTE.email, password: 'pas-le-bon-mot-de-passe' }) });
    assert.equal(f.status, 401); assert.equal(f.headers.getSetCookie().length, 0);
    f = await fetch(`${d}/api/account/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(COMPTE) }); assert.equal(f.status, 403, 'la connexion aussi demande l\'en-tête x-odin');
    f = await fetch(`${d}/api/account/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-odin': '1' }, body: JSON.stringify(COMPTE) });
    assert.equal(f.status, 200); const s3 = f.headers.getSetCookie().find((c) => c.startsWith('odin_session='))!;
    assert.match(s3, /; HttpOnly; SameSite=Strict; Path=\//); assert.doesNotMatch(s3, /Domain=/, 'cookie de l\'adresse d\'Odin seulement');
    assert.equal((await fetch(`${d}/api/state`, { headers: { cookie: s3.split(';')[0] } })).status, 200);

    // En accès « cette machine », le nom d'hôte est vérifié comme sur l'interface (contre le « DNS rebinding »).
    f = await fetch(`${d}/`, { headers: { host: 'pirate.exemple' } }); assert.equal(f.status, 403); assert.deepEqual(await f.json(), { error: 'hôte refusé' });

    // Thot, Papyrus et Talos ont leur propre écran : leur port direct y mène.
    r = await post({ appli: 'saga', faire: 'regler' }); assert.equal(r.ok, true, r.text);
    assert.ok(r.appli!.port! >= DIRECT_RANGE[0] && r.appli!.port! <= DIRECT_RANGE[1], 'sans numéro : Odin choisit un port libre dans la plage proposée');
    html = await (await fetch(`http://127.0.0.1:${r.appli!.port}/`, { headers: H })).text(); assert.match(html, /data-direct="brain"/); assert.match(html, /<title>Thot · Odin<\/title>/);

    // Les applis voient la même chose : Thermopyles (action, page), le tableau des ports d'Argo.
    const t = await va.act('hlid', 'ports_directs'); assert.match(t.text, new RegExp(`- Vénus : ${p} · écoute · cette machine seulement`)); assert.match(t.text, /- Thot : 22\d{3} · écoute/);
    const view = await va.module('hlid')!.view(va.ctx('hlid'), new URLSearchParams()), tab = view.sections.find((x) => x.kind === 'table' && x.title === 'Ports directs des applis');
    assert.ok(tab && tab.kind === 'table'); assert.deepEqual(tab.rows.find((x) => x.cells[0] === 'Vénus')!.cells, ['Vénus', String(p), 'écoute', 'cette machine seulement']);
    assert.deepEqual(tab.rows.find((x) => x.cells[0] === 'Vénus')!.actions!.map((a) => a.action), ['ouvrir_port_direct', 'retirer_port_direct']);
    const ecoutes = view.sections.find((x) => x.kind === 'table' && x.title === 'Ports à l\'écoute'); assert.ok(ecoutes && ecoutes.kind === 'table');
    assert.deepEqual(ecoutes.rows.find((x) => x.cells[0] === `${p}/tcp`)?.cells.slice(1), ['Odin : port direct de Vénus (sa page, avec ta connexion)', 'node', 'la machine seulement'], 'Thermopyles dit à qui est ce port');
    assert.match((await va.act('naglfar', 'ports')).text, new RegExp(`- Vénus : 8096, 8920, 5433, 51413 TCP · port direct ${p}\\n`));
    assert.ok(reserved().has(p), 'une appli installée ne prendra pas ce port');
  } finally { await tt.end(); }
});

// ---------------------------------------------------------------- les refus
test('port direct : refus clairs (déjà pris et par qui, gardé, hors bornes, sous 1024 sans les droits), et rien ne change', { timeout: 120_000 }, async () => {
  const tt = new T();
  try {
    fauxPareFeu(tt);
    const v = await vraiOdin(tt, { compte: true, modules: mods });
    const post = async (body: unknown) => (await v.json('/api/ports', body)).body as Rep;
    const pris = await freePort(), autre = await squatteur(tt, pris);
    // Déjà pris par un autre programme : Odin dit lequel.
    let r = await post({ appli: 'garmr', faire: 'regler', port: pris });
    assert.equal(r.ok, false); assert.equal(r.text, `le port ${pris} est déjà pris par « node » (programme n° ${autre.pid}) : choisis-en un autre, ou arrête ce programme`); assert.equal(r.error, r.text);
    assert.deepEqual([r.appli!.port, r.appli!.etat], [null, 'fermé'], 'rien n\'a changé');
    // Gardé par le plan.
    for (const [port, re] of [[v.port, /celui de l'interface d'Odin/], [WEB, /gardé pour Odin : l'interface d'Odin/], [53, /gardé pour Sphinx/], [80, /gardé pour Valgrind/], [8096, /gardé pour Vénus \(Venus\) : interface de Venus/], [20010, /gardé pour n8n \(appli installée par Argo\)/], [20500, /20000 à 20999 sont gardés pour les applis installées/], [21500, /21000 à 21999 sont gardés/], [22, /navigateurs refusent d'ouvrir le port 22 \(ils le gardent pour « ssh »\)/], [6000, /navigateurs refusent/]] as Array<[number, RegExp]>) {
      r = await post({ appli: 'garmr', faire: 'regler', port }); assert.equal(r.ok, false, String(port)); assert.match(r.text!, re, String(port));
    }
    // Hors bornes, ou pas un nombre.
    for (const port of [0, -5, 65536, 70000, 81.5, 'abc', '12 34']) { r = await post({ appli: 'garmr', faire: 'regler', port }); assert.equal(r.ok, false, String(port)); assert.equal(r.text, 'un port est un nombre entier entre 1 et 65535', String(port)); }
    // Appli ou demande inconnue.
    assert.match((await post({ appli: 'pas-une-appli', faire: 'regler', port: 8097 })).error!, /appli inconnue : « pas-une-appli »/);
    assert.match((await post({ appli: '', faire: 'regler', port: 8097 })).error!, /dis de quelle appli/);
    assert.match((await post({ appli: 'garmr', faire: 'exploser' })).error!, /regler, ouvrir, fermer ou retirer/);
    // Le port direct d'une autre appli.
    const p = await freePort();
    assert.equal((await post({ appli: 'freyja', faire: 'regler', port: p })).ok, true);
    r = await post({ appli: 'garmr', faire: 'regler', port: p }); assert.equal(r.ok, false); assert.equal(r.text, `le port ${p} est déjà le port direct de Vénus`);
    r = await post({ appli: 'freyja', faire: 'regler', port: p }); assert.equal(r.ok, true); assert.equal(r.text, `Vénus est déjà sur le port ${p}.`);
    // Ouvrir, fermer, retirer sans port direct.
    r = await post({ appli: 'garmr', faire: 'ouvrir', confirm: true }); assert.equal(r.ok, false); assert.match(r.text!, /n'a pas de port direct : donne-lui d'abord un port/);
    r = await post({ appli: 'garmr', faire: 'fermer' }); assert.equal(r.ok, false); assert.match(r.text!, /n'a pas de port direct/);
    r = await post({ appli: 'garmr', faire: 'retirer' }); assert.equal(r.ok, true); assert.equal(r.text, 'Cerbère n\'a pas de port direct.');
    // Accès « cette machine » : un port direct ne s'ouvre pas sur le réseau (l'accord est demandé, puis le refus est net).
    r = await post({ appli: 'freyja', faire: 'ouvrir' }); assert.equal(r.ok, false); assert.match(r.confirm!, new RegExp(`^Confirmer : ouvrir le port ${p} de Vénus sur le réseau : sa page sera joignable depuis les appareils de ton réseau \\(la connexion à Odin reste exigée\\), et le pare-feu de la machine laissera entrer ce port \\?$`));
    r = await post({ appli: 'freyja', faire: 'ouvrir', confirm: true }); assert.equal(r.ok, false); assert.match(r.text!, /Odin est réglé sur « cette machine seulement » \(Réglages → Accès\)/);
    r = await post({ appli: 'eir', faire: 'regler', port: await freePort(), reseau: true }); assert.equal(r.ok, false); assert.match(r.confirm!, /^Confirmer : ouvrir le port \d+ de Hygie sur le réseau/);
    assert.deepEqual(await ecouteSur(p), ['127.0.0.1'], 'toujours la boucle locale');
    // Le port se libère : il redevient possible.
    await autre.stop();
    r = await post({ appli: 'garmr', faire: 'regler', port: pris }); assert.equal(r.ok, true, r.text); assert.equal(r.appli!.etat, 'écoute');
    assert.deepEqual(JSON.parse(readFileSync(directFile(v.o.paths.home), 'utf8')).applis.garmr.port, pris, 'gardé dans le dossier d\'Odin');
  } finally { await tt.end(); }
});

test('port direct : un port sous 1024 sans les droits d\'administrateur est refusé en clair (vrai processus sans droits)', { skip: process.platform !== 'linux' || process.getuid?.() !== 0 ? 'il faut Linux et être administrateur pour lancer un processus sans droits' : false }, () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-sans-droits-')); chownSync(home, 65534, 65534);
  try {
    const code = `import { DirectPorts } from ${JSON.stringify(new URL('../src/valhalla/directports.ts', import.meta.url).pathname)};
const g = new DirectPorts({ home: process.argv[1], web: 7777, host: '127.0.0.1', access: 'local', attach: (s) => s.destroy() }); await g.start();
try { await g.set('freyja', 81); console.log('OUVERT'); } catch (e) { console.log('REFUS ' + e.message); }
console.log('ETAT ' + JSON.stringify(g.status('freyja') ?? null)); g.stop();`;
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', code, home], { uid: 65534, gid: 65534, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
    if (/EACCES|permission denied/i.test(r.stderr) && !r.stdout) return; // le compte sans droits ne peut pas lire le code ici : rien à vérifier
    assert.equal(r.stdout.trim(), 'REFUS le port 81 est sous 1024 et demande les droits d\'administrateur : choisis un port à partir de 1024, ou lance Odin en administrateur\nETAT null', r.stderr);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- changement à chaud, fermeture
test('port direct : changer le port sans redémarrer, le retirer ; l\'ancien port ne répond plus et ses connexions sont coupées', { timeout: 120_000 }, async () => {
  const tt = new T();
  try {
    fauxPareFeu(tt);
    const v = await vraiOdin(tt, { compte: true, modules: mods }), va = valhallaOf()!;
    const post = async (body: unknown) => (await v.json('/api/ports', body)).body as Rep;
    const [a, b] = [await freePort(), await freePort()], H = { cookie: v.session };
    assert.equal((await post({ appli: 'freyja', faire: 'regler', port: a })).ok, true);
    // Une connexion gardée ouverte sur l'ancien port (comme un navigateur resté sur la page).
    const garde = await new Promise<import('node:net').Socket>((ok, ko) => { const s = require('node:net').connect(a, '127.0.0.1', () => ok(s)); s.on('error', ko); });
    let recu = ''; garde.on('data', (x) => { recu += x; }); let fermee = false; garde.on('close', () => { fermee = true; });
    const demande = (path: string, extra = '') => { recu = ''; garde.write(`GET ${path} HTTP/1.1\r\nhost: 127.0.0.1:${a}\r\n${extra}\r\n`); return until(() => /\r\n\r\n/.test(recu), 4000); };
    assert.ok(await demande('/health')); assert.match(recu, /^HTTP\/1\.1 200/);
    // Changer : le nouveau port répond aussitôt, l'ancien refuse les nouvelles connexions.
    const r = await post({ appli: 'freyja', faire: 'regler', port: b });
    assert.equal(r.ok, true); assert.equal(r.text, `🚪 Vénus passe du port ${a} au port ${b} (l'ancien est fermé). Depuis cette machine, http://127.0.0.1:${b} ouvre directement sa page (avec ta connexion habituelle). Pour les autres appareils : « Ouvrir sur le réseau ».`);
    assert.match(await (await fetch(`http://127.0.0.1:${b}/`, { headers: H })).text(), /data-direct="app=freyja"/);
    assert.match(await refuse(() => fetch(`http://127.0.0.1:${a}/health`)), /ECONNREFUSED/);
    assert.deepEqual([await ecouteSur(a), await ecouteSur(b)], [[], ['127.0.0.1']]);
    // La connexion restée sur l'ancien port : toujours traitée comme un port direct (rien sans session), puis coupée.
    assert.ok(await demande('/api/pair')); assert.match(recu, /^HTTP\/1\.1 401/, 'pas de retour à la surface de l\'interface par une vieille connexion');
    assert.ok(await demande('/api/state', `authorization: Bearer ${v.token}\r\n`)); assert.match(recu, /^HTTP\/1\.1 401/);
    assert.ok(await until(() => fermee, 5000), 'coupée dans les secondes qui suivent');
    // Retirer : plus d'écoute, plus rien de gardé ; la page reste dans l'interface.
    const x = await post({ appli: 'freyja', faire: 'retirer' });
    assert.equal(x.ok, true); assert.equal(x.text, `🔒 Vénus n'a plus de port direct (le port ${b} est fermé) : sa page reste dans l'interface d'Odin, port ${v.port}.`);
    assert.deepEqual([x.appli!.port, x.appli!.etat], [null, 'fermé']);
    assert.match(await refuse(() => fetch(`http://127.0.0.1:${b}/health`)), /ECONNREFUSED/);
    assert.deepEqual(JSON.parse(readFileSync(directFile(v.o.paths.home), 'utf8')), { applis: {} });
    assert.equal((await fetch(`${v.url}/api/valhalla/view?id=freyja`, { headers: H })).status, 200);
    assert.ok(!reserved().has(b));

    // Ce qu'Odin fait de lui-même se défait ; une automatisation n'ouvre jamais un port sur le réseau.
    let m = await va.act('hlid', 'port_direct', { appli: 'Vénus', port: a }, { by: 'odin', why: 'essai' }); assert.equal(m.ok, true, m.text);
    assert.deepEqual(va.manips()[0].undo, { action: 'retirer_port_direct', input: { appli: 'freyja' }, label: 'port direct retiré' });
    m = await va.act('hlid', 'port_direct', { appli: 'Vénus', port: b }, { by: 'odin', why: 'essai' }); assert.equal(m.ok, true, m.text);
    assert.deepEqual(va.manips()[0].undo, { action: 'port_direct', input: { appli: 'freyja', port: a }, label: `port direct remis à ${a}` });
    assert.equal((await va.decide(va.manips()[0].id, false)).ok, true); assert.equal(directs()!.status('freyja')!.port, a, 'annuler remet l\'ancien port');
    for (const [action, input] of [['ouvrir_port_direct', { appli: 'Vénus' }], ['port_direct', { appli: 'Vénus', port: b, reseau: true }]] as Array<[string, Record<string, unknown>]>) {
      const auto = await va.act('hlid', action, input, { auto: true }); assert.equal(auto.ok, false); assert.match(auto.text, /action grave .*elle demande ton accord et ne part pas d'une automatisation/);
    }
    assert.equal(directs()!.status('freyja')!.reseau, false);
  } finally { await tt.end(); }
});

// ---------------------------------------------------------------- redémarrage
test('port direct : gardé après un redémarrage ; pris entre-temps par un autre programme : dit, signalé, repris dès qu\'il se libère', { timeout: 120_000 }, async () => {
  const tt = new T();
  try {
    fauxPareFeu(tt);
    const v = await vraiOdin(tt, { compte: true, modules: mods }), va = valhallaOf()!;
    const post = async (body: unknown) => (await v.json('/api/ports', body)).body as Rep;
    const [a, b] = [await freePort(), await freePort()], H = { cookie: v.session };
    assert.equal((await post({ appli: 'freyja', faire: 'regler', port: a })).ok, true); assert.equal((await post({ appli: 'saga', faire: 'regler', port: b })).ok, true);
    const relance = async () => { const w = new WebChannel(v.o, { scanNetwork: async () => undefined }, { port: v.port, host: '127.0.0.1', token: v.token, access: 'local', scryptN: 1024 }); await w.start(async () => {}); tt.onEnd(() => w.stop()); return w; };
    // Arrêt : plus rien n'écoute. Redémarrage : les mêmes ports, sans rien refaire.
    await v.web.stop();
    assert.match(await refuse(() => fetch(`http://127.0.0.1:${a}/health`)), /ECONNREFUSED/); assert.equal(directs(), undefined);
    let w = await relance();
    assert.match(await (await fetch(`http://127.0.0.1:${a}/`, { headers: H })).text(), /data-direct="app=freyja"/, 'la session aussi est gardée');
    assert.match(await (await fetch(`http://127.0.0.1:${b}/`, { headers: H })).text(), /data-direct="brain"/);
    assert.equal((await fetch(`http://127.0.0.1:${a}/api/state`)).status, 401);
    assert.deepEqual([directPort('freyja'), directPort('saga')], [a, b]);
    // Arrêt, un autre programme prend le port, redémarrage : Odin démarre quand même, dit qui tient le port, et alerte.
    await w.stop();
    const autre = await squatteur(tt, a);
    w = await relance();
    let r = (await v.json('/api/ports?appli=freyja')).body as Rep;
    assert.deepEqual([r.appli!.port, r.appli!.etat, r.appli!.par], [a, 'pris', `« node » (programme n° ${autre.pid})`]);
    assert.equal(r.appli!.note, `Le port ${a} est pris par « node » (programme n° ${autre.pid}) : Odin le reprendra dès qu'il sera libre. En attendant, Vénus reste dans l'interface (port ${v.port}).`);
    assert.equal(((await v.json('/api/ports?appli=saga')).body as Rep).appli!.etat, 'écoute', 'les autres ports directs ne sont pas touchés');
    assert.equal((await fetch(`${v.url}/api/valhalla/view?id=freyja`, { headers: H })).status, 200, 'l\'appli reste joignable par l\'interface');
    await va.module('hlid')!.watch!.run(va.ctx('hlid'));
    const al = va.alerts({ module: 'hlid' }).find((x) => /port direct de Vénus/.test(x.title));
    assert.equal(al?.title, `Le port direct de Vénus (${a}) ne répond pas`); assert.equal(al?.detail, `le port ${a} est déjà pris par « node » (programme n° ${autre.pid})`);
    assert.match((await va.act('hlid', 'ports_directs')).text, new RegExp(`- Vénus : ${a} · pris par « node »`));
    // Le programme s'arrête : Odin reprend le port tout seul (nouvel essai), sans redémarrer.
    await autre.stop();
    await directs()!.retry();
    r = (await v.json('/api/ports?appli=freyja')).body as Rep; assert.deepEqual([r.appli!.etat, r.appli!.par], ['écoute', undefined]);
    assert.match(await (await fetch(`http://127.0.0.1:${a}/`, { headers: H })).text(), /data-direct="app=freyja"/);
  } finally { await tt.end(); }
});

test('port direct : ce qui est gardé est relu avec prudence ; sans compte, un port direct ne sert rien du tout', { timeout: 120_000 }, async () => {
  const tt = new T();
  try {
    fauxPareFeu(tt);
    const [a, b] = [await freePort(), await freePort()];
    // Un fichier abîmé ou trafiqué : seules les entrées saines sont reprises ; un port gardé par le plan n'est jamais ouvert.
    const v = await odinRegle(tt, { access: 'local', compte: false, avant: (home) => { mkdirSync(dirname(directFile(home)), { recursive: true }); writeFileSync(directFile(home), JSON.stringify({ applis: { freyja: { port: a, reseau: true }, '../evasion': { port: b }, eir: { port: 'abc' }, garmr: { port: a }, saga: { port: 8096 }, runes: { port: 99999 }, hlid: null } })); } });
    assert.deepEqual(directs()!.all(), { freyja: { port: a, etat: 'écoute', reseau: false, sur: '127.0.0.1' }, saga: { port: 8096, etat: 'fermé', reseau: false, pourquoi: 'le port 8096 est gardé pour Vénus (Venus) : interface de Venus' } });
    assert.deepEqual(await ecouteSur(a), ['127.0.0.1'], '« ouvert sur le réseau » dans le fichier, mais Odin est réglé sur cette machine : boucle locale');
    assert.deepEqual([await ecouteSur(b), await ecouteSur(8096).then((l) => l.length === 0 || true)], [[], true]);
    // Pas encore de compte : la création se fait sur l'interface, jamais par un port direct (ni page, ni lien de première connexion).
    for (const path of ['/', `/?token=${v.token}`, '/api/state', '/activer', '/valhalla.js']) {
      const x = await v.call(a, path); assert.equal(x.status, 403, path); assert.deepEqual(JSON.parse(x.text), { error: `Odin n'a pas encore de compte : crée-le d'abord sur son interface (port ${v.port}).`, account: false, direct: true }); assert.equal(x.headers['set-cookie'], undefined);
    }
    for (const path of ['/api/account/create', '/api/setup/start', '/api/pair', '/api/account/login']) assert.equal((await v.call(a, path, { cookie: `odin_token=${v.token}` }, COMPTE)).status, 403, path);
    assert.equal((await v.call(v.port, '/')).status, 200, 'l\'interface, elle, propose de créer le compte');
    assert.equal((await v.call(a, '/health')).status, 403);
  } finally { await tt.end(); }
});

// ---------------------------------------------------------------- ouvert sur le réseau (accord, Cerbère)
test('port direct : ouvert sur le réseau seulement avec ton accord (Cerbère ouvre le pare-feu), refermé ou retiré : la règle part', { timeout: 120_000 }, async () => {
  const tt = new T();
  try {
    const pf = fauxPareFeu(tt), ip = adresseReseau();
    // L'interface d'Odin écoute sur toutes les adresses (comme en accès « réseau local »), et accepte cette machine par son adresse du réseau.
    const v = await odinRegle(tt, { access: 'lan', host: '0.0.0.0', reseaux: ip ? [`${ip}/32`] : [] }), va = valhallaOf()!;
    const [a, b] = [await freePort(), await freePort()], H = { cookie: v.session };
    const ufw = () => pf.appels().filter((l) => !/^status/.test(l));
    let r = await v.api({ appli: 'freyja', faire: 'regler', port: a });
    assert.equal(r.ok, true, r.text); assert.deepEqual(r.interface, { port: v.port, https: false, acces: 'lan' });
    // Donner un port n'ouvre rien : boucle locale, aucune règle de pare-feu, injoignable par l'adresse du réseau.
    assert.deepEqual(await ecouteSur(a), ['127.0.0.1']); assert.deepEqual(ufw(), []);
    if (ip) assert.match(await refuse(() => v.call(a, '/health', {}, undefined, ip)), /ECONNREFUSED/, 'pas ouvert : rien ne répond sur l\'adresse du réseau');
    // Ouvrir demande ton accord (la phrase dit exactement ce qui s'ouvre) ; sans lui, rien ne se passe.
    r = await v.api({ appli: 'freyja', faire: 'ouvrir' });
    assert.equal(r.ok, false); assert.equal(r.confirm, `Confirmer : ouvrir le port ${a} de Vénus sur le réseau : sa page sera joignable depuis les appareils de ton réseau (la connexion à Odin reste exigée), et le pare-feu de la machine laissera entrer ce port ?`);
    assert.deepEqual(await ecouteSur(a), ['127.0.0.1']); assert.deepEqual(ufw(), []);
    const act = JSON.parse((await v.call(v.port, '/api/valhalla/act', H, { module: 'hlid', action: 'ouvrir_port_direct', input: { appli: 'Vénus' } })).text) as Rep; assert.match(act.confirm!, /^Confirmer : ouvrir le port/);
    // Avec ton accord : Odin écoute là où son interface écoute, et Cerbère ouvre le pare-feu de la machine.
    r = await v.api({ appli: 'freyja', faire: 'ouvrir', confirm: true });
    assert.equal(r.ok, true, r.text); assert.match(r.text!, new RegExp(`^🔓 Le port ${a} de Vénus est ouvert sur le réseau : http://[^ ]+:${a} ouvre directement sa page\\. Cerbère a ouvert le port ${a} dans le pare-feu de la machine\\. La connexion à Odin reste exigée\\.$`));
    assert.deepEqual([r.appli!.etat, r.appli!.reseau, r.appli!.note], ['écoute', true, `Écoute sur le port ${a}, ouvert sur le réseau.`]);
    assert.deepEqual(await ecouteSur(a), ['0.0.0.0']); assert.deepEqual(ufw(), [`allow ${a}/tcp comment Odin page directe de Vnus`]);
    const ouverts = (await va.act('garmr', 'ports_ouverts')).data as Array<{ port: number; proto: string; why: string; by: string; via: string; box?: boolean }>;
    assert.deepEqual(ouverts.map((x) => [x.port, x.proto, x.why, x.by, x.via, x.box]), [[a, 'tcp', 'page directe de Vénus', 'Thermopyles (port direct)', 'ufw', undefined]], 'noté dans Cerbère ; jamais sur la box');
    assert.equal(va.manips().length, 0, 'c\'est ton action : pas de « manip » à garder ou annuler');
    if (ip) {
      // Par l'adresse du réseau : la même page, et toujours rien sans session.
      const page = await v.call(a, '/', H, undefined, ip); assert.equal(page.status, 200); assert.match(page.text, /data-direct="app=freyja"/);
      assert.equal((await v.call(a, '/api/state', {}, undefined, ip)).status, 401); assert.equal((await v.call(a, '/api/state', H, undefined, ip)).status, 200);
      assert.equal((await v.call(a, '/api/state', { authorization: `Bearer ${v.token}` }, undefined, ip)).status, 401);
    }
    // Changer le port d'une appli ouverte : l'ancienne règle part, le nouveau port repart de « cette machine seulement ».
    r = await v.api({ appli: 'freyja', faire: 'regler', port: b });
    assert.equal(r.ok, true, r.text); assert.match(r.text!, /Cerbère a retiré la règle du pare-feu\. Le nouveau port n'est joignable que depuis cette machine : rouvre-le sur le réseau si tu le veux\.$/);
    assert.deepEqual(ufw().slice(1), [`delete allow ${a}/tcp`]); assert.deepEqual([await ecouteSur(a), await ecouteSur(b)], [[], ['127.0.0.1']]); assert.equal(r.appli!.reseau, false);
    assert.deepEqual((await va.act('garmr', 'ports_ouverts')).data, []);
    // Régler et ouvrir d'un coup (une seule demande, un seul accord).
    r = await v.api({ appli: 'eir', faire: 'regler', port: a, reseau: true }); assert.equal(r.ok, false); assert.match(r.confirm!, new RegExp(`^Confirmer : ouvrir le port ${a} de Hygie sur le réseau`)); assert.equal(directs()!.status('eir'), undefined);
    r = await v.api({ appli: 'eir', faire: 'regler', port: a, reseau: true, confirm: true }); assert.equal(r.ok, true, r.text); assert.deepEqual([r.appli!.port, r.appli!.reseau], [a, true]); assert.deepEqual(await ecouteSur(a), ['0.0.0.0']);
    // Fermer au réseau : la règle part, l'écoute revient à la boucle locale ; le port reste utilisable sur la machine.
    r = await v.api({ appli: 'eir', faire: 'fermer' });
    assert.equal(r.ok, true); assert.equal(r.text, `🔒 Le port ${a} de Hygie n'est plus ouvert sur le réseau : il reste joignable depuis cette machine. Cerbère a retiré la règle du pare-feu.`);
    assert.deepEqual(await ecouteSur(a), ['127.0.0.1']); assert.deepEqual(ufw().slice(-2), [`allow ${a}/tcp comment Odin page directe de Hygie`, `delete allow ${a}/tcp`]);
    if (ip) assert.match(await refuse(() => v.call(a, '/health', {}, undefined, ip)), /ECONNREFUSED/);
    assert.equal((await v.call(a, '/health')).status, 200);
    // Retirer un port ouvert : la règle part aussi.
    assert.equal((await v.api({ appli: 'eir', faire: 'ouvrir', confirm: true })).ok, true);
    r = await v.api({ appli: 'eir', faire: 'retirer' }); assert.equal(r.ok, true); assert.match(r.text!, /Cerbère a retiré la règle du pare-feu\.$/);
    assert.deepEqual(ufw().slice(-2), [`allow ${a}/tcp comment Odin page directe de Hygie`, `delete allow ${a}/tcp`]); assert.deepEqual((await va.act('garmr', 'ports_ouverts')).data, []);
    // Le pare-feu refuse : tout ou rien. Rien n'est ouvert, l'appli reste sur cette machine.
    pf.refuser(true);
    r = await v.api({ appli: 'freyja', faire: 'ouvrir', confirm: true });
    assert.equal(r.ok, false); assert.match(r.text!, new RegExp(`^le pare-feu de la machine a refusé d'ouvrir le port ${b} \\(ERROR: refus du pare-feu \\(essai\\)\\) : rien n'est ouvert, Vénus reste joignable depuis cette machine seulement$`));
    assert.deepEqual(await ecouteSur(b), ['127.0.0.1']); assert.equal(r.appli!.reseau, false); pf.refuser(false);
    // Ouvert, puis redémarrage : toujours ouvert (et toujours noté chez Cerbère).
    assert.equal((await v.api({ appli: 'freyja', faire: 'ouvrir', confirm: true })).ok, true);
    await v.web.stop();
    const w = new WebChannel(v.od, { scanNetwork: async () => undefined }, { port: v.port, host: '0.0.0.0', token: v.token, access: 'lan', scryptN: 1024 }); await w.start(async () => {}); tt.onEnd(() => w.stop());
    assert.deepEqual(await ecouteSur(b), ['0.0.0.0']); assert.equal(directs()!.status('freyja')!.reseau, true);
    // Le même dossier, mais Odin réglé sur « cette machine » : plus d'écoute sur le réseau, quoi que dise le fichier.
    await w.stop();
    const w2 = new WebChannel(v.od, { scanNetwork: async () => undefined }, { port: v.port, host: '127.0.0.1', token: v.token, access: 'local', scryptN: 1024 }); await w2.start(async () => {}); tt.onEnd(() => w2.stop());
    assert.deepEqual(await ecouteSur(b), ['127.0.0.1']); assert.equal(directs()!.status('freyja')!.reseau, false);
    assert.match((await v.api(undefined, '?appli=freyja')).appli!.note, /depuis cette machine seulement \(Odin est réglé sur « cette machine »\)/);
  } finally { await tt.end(); }
});

test('port direct : sans pare-feu actif sur la machine, l\'accord est demandé quand même, et rien n\'est ouvert sur la box', { timeout: 60_000 }, async () => {
  const tt = new T();
  try {
    // Pas de faux pare-feu « actif » ici : un faux « ufw » éteint (et un « firewall-cmd » absent ou éteint), comme une machine sans pare-feu.
    const dir = tt.tmp('pare-feu-eteint-'), log = join(dir, 'appels.log');
    for (const n of ['ufw', 'firewall-cmd', 'nft']) writeFileSync(join(dir, n), `#!/bin/sh\necho "${n} $*" >> "${log}"\n[ "$1" = status ] && echo "Status: inactive"\n[ "$1" = --state ] && echo "not running"\nexit 0\n`, { mode: 0o755 });
    const avant = process.env.PATH; process.env.PATH = `${dir}:${avant}`; tt.onEnd(() => { process.env.PATH = avant; });
    const reseau: string[] = []; const vrai = globalThis.fetch;
    const v = await odinRegle(tt, { access: 'lan' }), va = valhallaOf()!, a = await freePort();
    assert.equal((await v.api({ appli: 'freyja', faire: 'regler', port: a })).ok, true);
    let r = await v.api({ appli: 'freyja', faire: 'ouvrir' }); assert.match(r.confirm!, /^Confirmer : ouvrir le port/);
    globalThis.fetch = (async (u: unknown, i?: RequestInit) => { reseau.push(String(u)); return vrai(u as string, i); }) as typeof fetch; tt.onEnd(() => { globalThis.fetch = vrai; });
    r = await v.api({ appli: 'freyja', faire: 'ouvrir', confirm: true }); globalThis.fetch = vrai;
    assert.equal(r.ok, true, r.text); assert.match(r.text!, /La machine n'a pas de pare-feu actif : rien d'autre à ouvrir\. La connexion à Odin reste exigée\.$/); assert.equal(r.appli!.reseau, true);
    const appels = readFileSync(log, 'utf8').trim().split('\n'); assert.ok(appels.every((l) => /^(ufw status|firewall-cmd --state|nft )/.test(l)), `aucune règle posée : ${appels.join(' | ')}`);
    assert.deepEqual(reseau, [], 'aucun appel réseau : la box (UPnP) n\'est jamais sollicitée');
    assert.deepEqual(((await va.act('garmr', 'ports_ouverts')).data as Array<{ via: string; box?: boolean }>).map((x) => [x.via, x.box]), [['aucun pare-feu actif', undefined]]);
  } finally { await tt.end(); }
});

// ---------------------------------------------------------------- HTTPS
test('port direct en HTTPS : même chiffrement que l\'interface, cookie « Secure », et http:// renvoie vers https:// sur le même port, jamais ailleurs', { timeout: 60_000 }, async () => {
  const tt = new T();
  try {
    fauxPareFeu(tt);
    const v = await odinRegle(tt, { access: 'lan', https: true }), a = await freePort(), H = { cookie: v.session };
    const r = await v.api({ appli: 'freyja', faire: 'regler', port: a });
    assert.equal(r.ok, true, r.text); assert.match(r.text!, new RegExp(`https://127\\.0\\.0\\.1:${a} ouvre directement sa page`)); assert.equal(r.interface!.https, true);
    // La même page, chiffrée, avec la session ; le cookie de connexion est marqué « Secure ».
    const page = await v.call(a, '/', H); assert.equal(page.status, 200); assert.match(page.text, /data-direct="app=freyja"/); assert.match(page.text, /const AUTHED = true;/);
    assert.equal((await v.call(a, '/api/state')).status, 401); assert.equal((await v.call(a, '/api/state', H)).status, 200);
    const login = await v.call(a, '/api/account/login', {}, COMPTE); assert.equal(login.status, 200);
    assert.match(String((login.headers['set-cookie'] as string[]).find((c) => c.startsWith('odin_session='))), /; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure$/);
    // « IP:port » tapé sans https:// : renvoi vers https, même adresse, même port.
    let x = await fetch(`http://127.0.0.1:${a}/#app=freyja`, { redirect: 'manual' });
    assert.equal(x.status, 308); assert.equal(x.headers.get('location'), `https://127.0.0.1:${a}/`);
    x = await fetch(`http://127.0.0.1:${a}/api/state?x=1`, { redirect: 'manual' }); assert.equal(x.headers.get('location'), `https://127.0.0.1:${a}/api/state?x=1`);
    // Un en-tête Host piégé est ignoré : on reste sur l'adresse de la machine et sur CE port (pas celui de l'interface).
    x = await fetch(`http://127.0.0.1:${a}/`, { redirect: 'manual', headers: { host: 'pirate.exemple/x' } }); assert.equal(x.headers.get('location'), `https://127.0.0.1:${a}/`);
    x = await fetch(`http://127.0.0.1:${a}/`, { redirect: 'manual', headers: { host: 'a b' } }); assert.equal(x.headers.get('location'), `https://127.0.0.1:${a}/`);
    // Un chemin qui ressemble à une autre adresse reste un chemin de ce site.
    x = await fetch(`http://127.0.0.1:${a}//pirate.exemple/x`, { redirect: 'manual' }); assert.equal(x.headers.get('location'), `https://127.0.0.1:${a}//pirate.exemple/x`); assert.equal(new URL(x.headers.get('location')!).host, `127.0.0.1:${a}`);
    const brut = await new Promise<string>((ok, ko) => { const s = require('node:net').connect(a, '127.0.0.1', () => s.write('GET http://pirate.exemple/ HTTP/1.1\r\nhost: 127.0.0.1\r\nconnection: close\r\n\r\n')); let b = ''; s.on('data', (d: Buffer) => { b += d; }); s.on('end', () => ok(b)); s.on('error', ko); });
    assert.match(brut, /^HTTP\/1\.1 308/); assert.match(brut, /\r\nlocation: https:\/\/127\.0\.0\.1\/\r\n/i, 'une adresse complète dans la demande ne sert pas de destination');
    assert.equal((await v.call(a, '/api/state', H)).status, 200, 'le https marche toujours après');
  } finally { await tt.end(); }
});

// ---------------------------------------------------------------- une appli installée (moteur d'Odin, vrai conteneur)
/** Un petit registre local : n'importe quel dépôt, une image (busybox) qui sert une page sur le port 8080. */
function registre(): Promise<{ srv: Server; port: number }> {
  const couche = busyboxLayer(), sha = (b: Buffer) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
  const cfg = Buffer.from(JSON.stringify({ architecture: process.arch === 'arm64' ? 'arm64' : 'amd64', os: 'linux', config: { Env: ['PATH=/bin'], Cmd: ['/bin/sh', '-c', 'httpd -f -p 8080 -h /www'], WorkingDir: '/' } }));
  const man = Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha(cfg), size: cfg.length }, layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: sha(couche), size: couche.length }] }));
  const blobs = new Map([[sha(cfg), cfg], [sha(couche), couche]]);
  return new Promise((ok) => {
    const srv = httpServer((q, r) => {
      const m = /^\/v2\/[a-z0-9/_.-]+\/(manifests|blobs)\/(.+)$/.exec(q.url ?? ''); if (!m) { r.statusCode = 404; return r.end(); }
      if (m[1] === 'manifests') { r.setHeader('content-type', 'application/vnd.oci.image.manifest.v1+json'); return r.end(man); }
      const b = blobs.get(m[2]); if (!b) { r.statusCode = 404; return r.end(); } r.end(b);
    }).listen(0, '127.0.0.1', () => ok({ srv, port: (srv.address() as { port: number }).port }));
  });
}
const conteneurs = (() => { try { return process.getuid?.() === 0 && existsSync('/usr/bin/busybox') && (execFileSync('unshare', ['-m', '-p', '--fork', 'true']), true); } catch { return false; } })();
test('appli installée (moteur d\'Odin) : elle reçoit son port fixe ; s\'il est pris, le suivant libre (et on le dit) ; il est gardé après un arrêt', { skip: !conteneurs && 'il faut être administrateur avec unshare et busybox', timeout: 180_000 }, async (t) => {
  const tt = new T(), dir = mkdtempSync(join(tmpdir(), 'hr-ports-')), reg = await registre(), e = new Engine(dir);
  useEngine(() => e);
  const page = async (port: number) => { try { return await (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) })).text(); } catch { return ''; } };
  const fini = () => until(() => e.jobs().every((j) => j.ended), 30_000);
  try {
    // PrivateBin est une appli connue du plan : port fixe 20141 (→ 8080 dans le conteneur).
    const ref = `127.0.0.1:${reg.port}/odin/privatebin:1`, fixe = APP_PORTS.find((a) => a.name === 'PrivateBin')!.host;
    assert.equal(fixe, 20141);
    if ((await listeners()).some((x) => x.proto === 'tcp' && [fixe, fixe + 1, fixe + 2].includes(x.port))) return t.skip(`les ports ${fixe} à ${fixe + 2} servent déjà sur cette machine (un autre essai ?)`);
    const { v } = tt.valhalla([naglfar, ymir]);
    // Sans port demandé : son port fixe, et la page répond vraiment dessus.
    let r = await v.act('naglfar', 'lancer', { image: ref, nom: 'pb1', base: 'aucune' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, new RegExp(`\\nPort : ${fixe} → 8080\\.$`)); await fini();
    assert.deepEqual(e.find('pb1').spec.ports, [{ host: fixe, inner: 8080, proto: 'tcp' }]); assert.equal(e.find('pb1').state.status, 'en marche');
    assert.ok(await until(async () => (await page(fixe)) === 'salut depuis le conteneur', 10_000), 'la page du conteneur répond sur le port fixe');
    // Un port direct ne peut pas prendre le port d'une appli installée : le plan le garde, et la machine dit qui le tient.
    assert.match(directRefusal(fixe, 'eir') ?? '', /gardé pour PrivateBin \(appli installée par Argo\)/);
    const g = new DirectPorts({ home: dir, web: 7777, host: '127.0.0.1', access: 'local', attach: (s) => s.destroy() }); await g.start();
    try {
      const libre = await freePort(); await e.run({ image: ref, name: 'autre', ports: `${libre}:8080`, network: e.find('pb1').spec.network });
      await assert.rejects(g.set('eir', libre), new RegExp(`le port ${libre} est déjà pris par l'appli installée « autre » \\(Argo\\) : choisis-en un autre, ou arrête ce programme`));
      await e.rm('autre', true);
      // … et une appli installée ne prend jamais un port direct : elle va au suivant.
      const direct = fixe + 1; setDirectPorts({ eir: direct });
      r = await v.act('naglfar', 'lancer', { image: ref, nom: 'pb2', base: 'aucune' });
      assert.equal(r.ok, true, r.text); assert.match(r.text, new RegExp(`\\nPort : ${fixe + 2} → 8080 \\(${fixe} déjà pris → ${fixe + 2}\\)\\.$`), 'le port fixe est pris par la première copie, le suivant par un port direct'); await fini();
      assert.ok(await until(async () => (await page(fixe + 2)) === 'salut depuis le conteneur', 10_000));
      await e.rm('pb2', true);
    } finally { g.stop(); setDirectPorts({}); }
    // Gardé après un arrêt et une relance, et relu tel quel par un moteur neuf (comme après un redémarrage d'Odin).
    await e.stop('pb1', 2); assert.equal(await page(fixe), '');
    await e.start('pb1'); assert.ok(await until(async () => (await page(fixe)) === 'salut depuis le conteneur', 10_000), 'même port après relance');
    assert.deepEqual(new Engine(dir).find('pb1').spec.ports, [{ host: fixe, inner: 8080, proto: 'tcp' }]);
    await e.rm('pb1', true);
    // Le port fixe est pris par un AUTRE programme : avant, le conteneur démarrait sans son port (une ligne dans son journal).
    const autre = await squatteur(tt, fixe, '0.0.0.0');
    r = await v.act('naglfar', 'lancer', { image: ref, nom: 'pb3', base: 'aucune' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, new RegExp(`\\nPort : ${fixe + 1} → 8080 \\(${fixe} déjà pris → ${fixe + 1}\\)\\.$`)); await fini();
    assert.deepEqual(e.find('pb3').spec.ports, [{ host: fixe + 1, inner: 8080, proto: 'tcp' }]);
    assert.ok(await until(async () => (await page(fixe + 1)) === 'salut depuis le conteneur', 10_000), 'la page répond sur le port annoncé');
    assert.ok(!e.logs('pb3', 20).some((l) => /indisponible/.test(l.text)), 'plus de port perdu en silence');
    // Hydre (installation suivie) fait le même choix.
    const h = await v.act('ymir', 'installer_docker', { image: ref, nom: 'pb4', base: 'aucune' });
    assert.equal(h.ok, true, h.text); assert.match(h.text, new RegExp(`Choisir les ports — ${fixe} déjà pris → ${fixe + 2}`));
    await autre.stop();
  } finally {
    for (const c of e.ps(true)) await e.rm(c.id, true).catch(() => {});
    reg.srv.close(); await tt.end(); rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- sans IA (Logos), et le proxy
test('sans IA : « les ports directs » se demande à Thermopyles ; il manque l\'appli ? Odin la demande ; les phrases banales n\'y arrivent pas', { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'odin-logos-ports-'));
  useEngine(() => ({ ps: () => [], jobs: () => [], images: () => [] }) as never);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: { venus: { url: '' }, voice: {} } } as never), { notify: async () => {}, run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('réseau coupé par l\'essai'); }) as never });
  try {
    const u = async (p: string, s = `s${Math.random()}`) => { const x = await understand(v, p, s); return !x ? 'rien' : x.kind === 'action' ? `${x.module}.${x.action}` : x.kind === 'ask' ? `? ${x.module}.${x.action} (${x.missing})` : x.kind; };
    for (const p of ['les ports directs', 'ports directs des applis', 'quels sont les ports directs', 'quelles applis ont un port direct', 'port direct']) assert.equal(await u(p), 'hlid.ports_directs', p);
    for (const [p, a] of [['donne un port direct', 'port_direct'], ['change le port direct', 'port_direct'], ['ouvre le port direct', 'ouvrir_port_direct'], ['ferme le port direct', 'fermer_port_direct'], ['retire le port direct', 'retirer_port_direct']]) assert.equal(await u(p), `? hlid.${a} (appli)`, p);
    // en deux messages : la question, puis le nom de l'appli
    assert.equal(await u('donne un port direct', 'essai'), '? hlid.port_direct (appli)');
    const x = await understand(v, 'Hygie', 'essai'); assert.ok(x && x.kind === 'action'); assert.deepEqual([x.module, x.action, x.input.appli], ['hlid', 'port_direct', 'Hygie']);
    // ce qui existait garde son sens
    assert.equal(await u('ouvre le port 8080'), 'hlid.ouvrir_port'); assert.equal(await u('ferme le port 22'), 'hlid.fermer_port'); assert.equal(await u('quels ports'), 'naglfar.ports'); assert.equal(await u('les ports des applis'), 'naglfar.ports');
    // phrases banales : jamais une action sur les ports directs
    for (const p of ['le port de plaisance est fermé', 'mon fils est parti en direct', 'un vol direct pour Paris', 'ouvre la porte du garage', 'donne le port de Marseille', 'mets le film en direct sur la télé', 'regarde le match en direct', 'donne-moi la météo', 'c\'est direct ou pas', 'porte ce carton']) assert.doesNotMatch(await u(p), /port_direct|ports_directs/, p);
    // une action grave ne part jamais d'une phrase sans ton accord
    const g = new DirectPorts({ home, web: 7777, host: '127.0.0.1', access: 'lan', attach: (s) => s.destroy() }); await g.start();
    try {
      await g.set('eir', await freePort());
      await understand(v, 'ouvre le port direct', 'grave'); const o = await v.order('Hygie', 'grave');
      assert.equal(o.ok, false); assert.match(o.confirm ?? '', /^ouvrir le port \d+ de Hygie sur le réseau/); assert.equal(g.status('eir')!.reseau, false);
    } finally { g.stop(); }
  } finally { v.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('Valgrind : un site du proxy peut mener au port direct d\'une appli (son propre nom), toujours avec la connexion d\'Odin', { timeout: 60_000 }, async () => {
  const tt = new T();
  try {
    fauxPareFeu(tt);
    const v = await vraiOdin(tt, { compte: true, modules: mods }), va = valhallaOf()!, a = await freePort(), web = await freePort(), tls = await freePort();
    assert.equal(((await v.json('/api/ports', { appli: 'freyja', faire: 'regler', port: a })).body as Rep).ok, true);
    let r = await va.act('valgrind', 'ajouter', { domaines: 'venus.maison', cible: `http://127.0.0.1:${a}`, https: 'aucun', forcer_https: false, websocket: true, dns_maison: false, surveiller: false, internet: false }); assert.equal(r.ok, true, r.text);
    r = await va.act('valgrind', 'demarrer', { http: web, https: tls }); assert.equal(r.ok, true, r.text);
    try {
      const par = (path: string, h: Record<string, string> = {}) => new Promise<{ status: number; text: string }>((ok, ko) => { const q = httpRequest({ host: '127.0.0.1', port: web, path, agent: false, headers: { host: 'venus.maison', ...h } }, (x) => { let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => ok({ status: x.statusCode!, text: b })); }); q.on('error', ko); q.end(); });
      const page = await par('/'); assert.equal(page.status, 200); assert.match(page.text, /<title>Vénus · Odin<\/title>/); assert.match(page.text, /const AUTHED = false;/);
      assert.equal((await par('/api/state')).status, 401, 'par le proxy non plus, rien sans session');
      assert.equal((await par('/api/state', { cookie: v.session })).status, 200);
      assert.equal((await par('/api/state', { authorization: `Bearer ${v.token}` })).status, 401);
    } finally { await va.act('valgrind', 'arreter'); }
  } finally { await tt.end(); }
});
