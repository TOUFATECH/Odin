// Talos : un bloc web d'automatisation n'appelle jamais Odin lui-même (ni la machine d'Odin, quel que soit le port),
// avec ou sans clé, quelle que soit l'écriture de l'adresse, ni par une redirection. Les autres appareils de la
// maison et les sites restent permis. Un vrai Odin jetable écoute sur la boucle locale ; les « autres machines »
// sont de faux serveurs locaux, déclarés comme tels en remplaçant la résolution des noms (rien ne sort).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { connect, type AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { Gateway } from '../src/bifrost/gateway.ts';
import { execute, type Deps, type Workflow } from '../src/draupnir/engine.ts';
import { startDraupnir } from '../src/draupnir/odin.ts';
import { CATALOG, REFUS_VERS_ODIN, fetchFige, lookupHorsOdin, reseauOdin, versOdin } from '../src/draupnir/nodes.ts';
import { arreter, demarrer, reinitialiser, sonderMaintenant } from '../src/net/etat-internet.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { makeOdin } from './helpers.ts';

const REFUS = /n'appelle pas Odin lui-même/;
const ecoute = (s: Server) => new Promise<number>((res) => s.listen(0, '127.0.0.1', () => res((s.address() as AddressInfo).port)));
const ferme = (s: Server) => new Promise<void>((res) => s.close(() => res()));

// Réseau déclaré pour l'essai : la machine d'Odin s'appelle « poste-odin » et a l'adresse 192.168.77.10 sur la maison.
const NOMS: Record<string, string[]> = {
  'imprimante.maison': ['192.168.77.20'], 'site.exemple': ['203.0.113.5'],
  'odin-alias.maison': ['127.0.0.1'], 'odin-v6.maison': ['::ffff:127.0.0.1'], 'machine-lan.maison': ['192.168.77.10'], 'double.exemple': ['203.0.113.6', '::1'],
};
const AUTRES = new Set(['imprimante.maison', 'site.exemple']); // servis par le faux serveur local

function flux(type: string, params: Record<string, unknown>): Workflow {
  return { id: 'w', name: 'Essai', active: false, nodes: [
    { id: '1', name: 'Go', type: 'déclencheur.manuel', params: {} },
    { id: '2', name: 'Appel', type, params },
  ], connections: { Go: [[{ node: 'Appel' }]] } };
}

test('Talos : un appel web vers Odin lui-même est refusé ; un appareil de la maison et un site restent permis', async () => {
  const sauve = { ...reseauOdin };
  reseauOdin.resoudre = async (n) => { const r = NOMS[n]; if (!r) throw Object.assign(new Error('nom inconnu'), { code: 'ENOTFOUND' }); return r; };
  reseauOdin.adressesMachine = () => ['127.0.0.1', '::1', '192.168.77.10', 'fe80::abcd%12'];
  reseauOdin.nomMachine = () => 'POSTE-ODIN';
  // En ligne : sinon un refus serait montré comme « en attente d'Internet ».
  reinitialiser();
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => true, parIp: async () => true }, intervalleMs: 1e9 });
  await sonderMaintenant();

  const o = makeOdin([]);
  const token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  const recu: Array<{ url: string; auth: string }> = [];
  const autre = createServer((req: IncomingMessage, res) => {
    recu.push({ url: req.url ?? '', auth: String(req.headers.authorization ?? req.headers['x-api-key'] ?? '') });
    const p = req.url ?? '';
    if (p.startsWith('/vers-odin-nom')) { res.writeHead(302, { location: `http://odin-alias.maison:${pO}/api/state` }); return void res.end(); }
    if (p.startsWith('/vers-odin')) { res.writeHead(307, { location: `http://127.0.0.1:${pO}/api/state` }); return void res.end(); }
    if (p.startsWith('/vers-imprimante')) { res.writeHead(302, { location: `http://imprimante.maison:${pA}/ok` }); return void res.end(); }
    if (p.startsWith('/flux')) { res.writeHead(200, { 'content-type': 'application/rss+xml' }); return void res.end('<rss><channel><item><title>Un</title><link>https://b/1</link><guid>1</guid></item></channel></rss>'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
  let pO = 0;
  const pA = await ecoute(autre);
  pO = 21000 + Math.floor(Math.random() * 20000);
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port: pO, host: '127.0.0.1', token, access: 'lan' }));
  await gw.start();
  // Le fetch du bloc : les « autres machines » sont envoyées au faux serveur ; tout le reste part tel quel (vers Odin s'il passait).
  const appels: string[] = [];
  const f = (async (u: string, init?: RequestInit) => {
    appels.push(String(u));
    const x = new URL(String(u));
    if (AUTRES.has(x.hostname)) { x.hostname = '127.0.0.1'; }
    return fetch(x.href, init);
  }) as unknown as typeof fetch;
  const deps: Deps = { fetch: f, secret: (n) => (n === 'ODIN_CLE' ? token : undefined) };
  try {
    // Odin répond bien avec sa clé (le chemin existe) : seul le bloc doit le fermer.
    assert.equal((await fetch(`http://127.0.0.1:${pO}/api/state`, { headers: { authorization: `Bearer ${token}` } })).status, 200);

    const ecritures = ['127.0.0.1', '127.0.0.2', 'localhost', 'LOCALHOST', 'localhost.', 'odin.localhost', '2130706433', '0x7f000001', '0x7f.1', '0177.0.0.1', '127.1', '0', '0.0.0.0',
      '[::1]', '[0:0:0:0:0:0:0:1]', '[::]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::127.0.0.1]', '[64:ff9b::127.0.0.1]', '[fe80::abcd]',
      'poste-odin', 'Poste-Odin.local', '192.168.77.10', '[::ffff:192.168.77.10]', 'odin-alias.maison', 'odin-v6.maison', 'machine-lan.maison', 'double.exemple'];
    const cles: Array<Record<string, unknown>> = [{ identifiant: 'ODIN_CLE' }, { identifiant: 'ODIN_CLE', authentification: 'en-tête X-API-Key' }, { identifiant: 'ODIN_CLE', authentification: 'paramètre api_key' }, {}];
    for (const h of ecritures) for (const port of [pO, pO + 1, 80]) for (const cle of cles) {
      const ex = await execute(flux('web.requête', { url: `http://${h}:${port}/api/state`, ...cle }), CATALOG, deps);
      assert.equal(ex.status, 'erreur', `${h}:${port} ${JSON.stringify(cle)}`);
      assert.match(ex.error ?? '', REFUS, `${h}:${port}`);
    }
    assert.equal(await versOdin(`https://LOCALHOST:${pO}/`), REFUS_VERS_ODIN, 'https aussi');
    // L'action réservée au propriétaire (changer la clé d'accès) ne part pas.
    const rot = await execute(flux('web.requête', { url: `http://127.0.0.1:${pO}/api/action`, méthode: 'POST', identifiant: 'ODIN_CLE', entêtes: { 'x-odin': '1', 'content-type': 'application/json' }, corps: '{"kind":"token_rotate"}' }), CATALOG, deps);
    assert.match(rot.error ?? '', REFUS);
    assert.equal(ensureWebToken(o.paths), token, 'la clé d\'accès n\'a pas changé');
    assert.deepEqual(appels, [], 'aucun appel n\'est parti vers Odin');

    // Redirection d'un site vers Odin (par son adresse, puis par un nom qui y mène) : refusée avant de la suivre.
    for (const chemin of ['vers-odin', 'vers-odin-nom']) {
      appels.length = 0;
      const ex = await execute(flux('web.requête', { url: `http://site.exemple:${pA}/${chemin}`, identifiant: 'ODIN_CLE' }), CATALOG, deps);
      assert.equal(ex.status, 'erreur', chemin); assert.match(ex.error ?? '', REFUS, chemin);
      assert.deepEqual(appels, [`http://site.exemple:${pA}/${chemin}`], `${chemin} : seul le site a été appelé`);
    }

    // Permis comme avant : un appareil de la maison (avec sa clé), un site, une redirection entre eux (la clé ne suit pas).
    recu.length = 0;
    const maison = await execute(flux('web.requête', { url: `http://imprimante.maison:${pA}/ok`, identifiant: 'ODIN_CLE' }), CATALOG, deps);
    assert.equal(maison.status, 'succès', maison.error); assert.deepEqual(maison.nodes.Appel.items[0], { ok: true });
    assert.equal(recu[0].auth, `Bearer ${token}`, 'la clé arrive à l\'appareil choisi');
    const site = await execute(flux('web.requête', { url: `http://site.exemple:${pA}/ok` }), CATALOG, deps);
    assert.equal(site.status, 'succès', site.error);
    recu.length = 0;
    const saut = await execute(flux('web.requête', { url: `http://site.exemple:${pA}/vers-imprimante`, identifiant: 'ODIN_CLE' }), CATALOG, deps);
    assert.equal(saut.status, 'succès', saut.error);
    assert.deepEqual(recu.map((r) => [r.url, r.auth]), [['/vers-imprimante', `Bearer ${token}`], ['/ok', '']], 'la redirection est suivie, sans la clé vers une autre origine');

    // Les autres blocs qui sortent : lire un flux, message Discord/Slack.
    appels.length = 0;
    for (const ex of [
      await execute(flux('web.flux', { url: `http://localhost:${pO}/api/state` }), CATALOG, deps),
      await execute(flux('web.flux', { url: `http://site.exemple:${pA}/vers-odin` }), CATALOG, deps),
      await execute(flux('odin.message', { service: 'Discord', adresse: `https://127.0.0.1:${pO}/api/state`, texte: 'x' }), CATALOG, deps),
      await execute(flux('odin.message', { service: 'Slack', adresse: `https://[::1]:${pO}/`, texte: 'x' }), CATALOG, deps),
    ]) { assert.equal(ex.status, 'erreur'); assert.match(ex.error ?? '', REFUS); }
    assert.deepEqual(appels, [`http://site.exemple:${pA}/vers-odin`]);
    const lu = await execute(flux('web.flux', { url: `http://site.exemple:${pA}/flux` }), CATALOG, deps);
    assert.equal(lu.status, 'succès', lu.error); assert.equal(lu.nodes.Appel.items[0].titre, 'Un');
  } finally {
    Object.assign(reseauOdin, sauve);
    arreter(); reinitialiser();
    await gw.stop(); await ferme(autre); o.cleanup();
  }
});

// Rebinding : un nom qui répond « site » au contrôle puis « boucle locale » à la connexion. Sans fetch injecté (comme en
// vrai), la connexion doit se faire sur une adresse contrôlée par la même règle. La seconde réponse du nom est donnée
// par la résolution du système, remplacée le temps de l'essai (rien ne sort : elle mène à la boucle locale).
test('Talos : un nom qui change d\'adresse entre le contrôle et la connexion n\'atteint pas Odin ; les noms publics d\'Odin sont refusés', async () => {
  const dns = createRequire(import.meta.url)('node:dns') as { lookup: (...a: unknown[]) => void };
  const sauve = { ...reseauOdin }, sauveLookup = dns.lookup;
  let tours = 0;
  const NOMS2: Record<string, string[]> = { 'imprimante.maison': ['192.168.77.20'], 'site.exemple': ['203.0.113.5'], 'odin.exemple.org': ['203.0.113.9'], 'double4-6.maison': ['192.168.77.21', 'fd00::21'] };
  reseauOdin.resoudre = async (n) => {
    if (n === 'rebond.exemple') return tours++ === 0 ? ['198.51.100.7'] : ['127.0.0.1'];
    const r = NOMS2[n]; if (!r) throw Object.assign(new Error('nom inconnu'), { code: 'ENOTFOUND' }); return r;
  };
  reseauOdin.adressesMachine = () => ['127.0.0.1', '::1', '192.168.77.10'];
  reseauOdin.nomMachine = () => 'poste-odin';
  reinitialiser();
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => true, parIp: async () => true }, intervalleMs: 1e9 });
  await sonderMaintenant();
  const o = makeOdin([]);
  const token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  const pO = 21000 + Math.floor(Math.random() * 20000);
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port: pO, host: '127.0.0.1', token, access: 'lan' }));
  await gw.start();
  const recu: Array<{ methode: string; url: string; type: string; longueur: string; corps: string }> = [];
  const local = createServer((req, res) => {
    let corps = ''; req.setEncoding('utf8'); req.on('data', (d) => { corps += d; });
    req.on('end', () => {
      const p = req.url ?? '';
      recu.push({ methode: req.method ?? '', url: p, type: String(req.headers['content-type'] ?? ''), longueur: String(req.headers['content-length'] ?? ''), corps });
      if (p === '/zip') { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); return void res.end(gzipSync('{"compresse":true}')); }
      if (p === '/saute') { res.writeHead(302, { location: '/ailleurs' }); return void res.end(); }
      if (p === '/vide') { res.writeHead(204); return void res.end(); }
      if (p === '/lent') return void setTimeout(() => { if (!res.destroyed) { res.writeHead(200); res.end('tard'); } }, 3000);
      res.writeHead(201, { 'content-type': 'application/json', 'x-essai': 'oui' }); res.end('{"ok":true}');
    });
  });
  const pL = await ecoute(local);
  const deps: Deps = { secret: (n) => (n === 'ODIN_CLE' ? token : undefined) }; // pas de fetch injecté : le chemin réel
  try {
    // 1. La connexion refuse elle-même une adresse de la machine, même si le contrôle d'avant a vu un site.
    assert.equal(await versOdin('http://rebond.exemple/'), undefined, 'au contrôle, le nom répond « site »');
    const refus = await new Promise<Error | null>((res) => lookupHorsOdin('rebond.exemple', { all: true }, (e) => res(e)));
    assert.match(refus?.message ?? '', REFUS, 'à la connexion, le nom répond « boucle locale » : refusé');
    // Un autre appareil passe, sous la forme demandée (une adresse, ou toutes ; famille choisie).
    const toutes = await new Promise<unknown>((res) => lookupHorsOdin('double4-6.maison', { all: true }, (_e, l) => res(l)));
    assert.deepEqual(toutes, [{ address: '192.168.77.21', family: 4 }, { address: 'fd00::21', family: 6 }]);
    const une = await new Promise<unknown[]>((res) => lookupHorsOdin('imprimante.maison', {}, (e, a, f) => res([e, a, f])));
    assert.deepEqual(une, [null, '192.168.77.20', 4]);
    const v6 = await new Promise<Error | null>((res) => lookupHorsOdin('imprimante.maison', { family: 6 }, (e) => res(e)));
    assert.equal((v6 as NodeJS.ErrnoException | null)?.code, 'ENOTFOUND');

    // 2. Le bloc entier, sans fetch injecté. La résolution du système donne la boucle locale (seconde réponse du nom).
    //    Un environnement d'essai qui refuse toute connexion par nom (sonde de sorties) ne peut pas jouer cette partie.
    const parNomPossible = await new Promise<boolean>((res) => {
      const boucle = (_h: string, o2: { all?: boolean }, cb: (e: null, a: unknown, f?: number) => void): void => {
        if (o2.all) cb(null, [{ address: '127.0.0.1', family: 4 }]); else cb(null, '127.0.0.1', 4);
      };
      const s = connect({ host: 'essai-nom.invalid', port: pL, lookup: boucle as never });
      s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false));
    });
    if (parNomPossible) {
      dns.lookup = (h: unknown, ...a: unknown[]) => {
        if (h !== 'rebond.exemple') return (sauveLookup as (...x: unknown[]) => void)(h, ...a);
        const cb = a.find((x) => typeof x === 'function') as (...x: unknown[]) => void, o2 = (typeof a[0] === 'object' ? a[0] : {}) as { all?: boolean };
        process.nextTick(() => (o2.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)));
      };
      tours = 0;
      const ex = await execute(flux('web.requête', { url: `http://rebond.exemple:${pO}/api/state`, identifiant: 'ODIN_CLE' }), CATALOG, deps);
      dns.lookup = sauveLookup;
      assert.equal(ex.status, 'erreur', 'le rebinding n\'atteint pas Odin');
      assert.match(ex.error ?? '', REFUS);
    } else console.log('# partie 2 non jouée : cet environnement refuse les connexions par nom (à rejouer sans la sonde)');

    // 3. Les noms publics d'Odin (adresse publique, tunnel), quelle que soit l'écriture.
    reseauOdin.nomsPublics = () => ['https://odin.exemple.org/'];
    const appels: string[] = [];
    const f = (async (u: string) => { appels.push(String(u)); return new Response('{}'); }) as unknown as typeof fetch;
    for (const h of ['odin.exemple.org', 'ODIN.Exemple.org.', 'odin.exemple.org:8443']) {
      const ex = await execute(flux('web.requête', { url: `https://${h}/api/state`, identifiant: 'ODIN_CLE' }), CATALOG, { ...deps, fetch: f });
      assert.equal(ex.status, 'erreur', h); assert.match(ex.error ?? '', REFUS, h);
    }
    assert.deepEqual(appels, []);
    const site = await execute(flux('web.requête', { url: 'https://site.exemple/ok' }), CATALOG, { ...deps, fetch: f });
    assert.equal(site.status, 'succès', site.error);

    // 4. Le fetch du chemin réel se comporte comme celui de Node (essayé sur une adresse écrite, sans résolution).
    const base = `http://127.0.0.1:${pL}`;
    const r1 = await fetchFige(`${base}/ok`);
    assert.equal(r1.status, 201); assert.equal(r1.ok, true); assert.equal(r1.headers.get('x-essai'), 'oui'); assert.deepEqual(await r1.json(), { ok: true });
    recu.length = 0;
    await (await fetchFige(`${base}/ok`, { method: 'POST', body: 'é=1' })).text();
    assert.deepEqual([recu[0].methode, recu[0].type, recu[0].longueur, recu[0].corps], ['POST', 'text/plain;charset=UTF-8', '4', 'é=1']);
    recu.length = 0;
    await (await fetchFige(`${base}/ok`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).text();
    assert.equal(recu[0].type, 'application/json', 'le type donné est gardé');
    assert.deepEqual(await (await fetchFige(`${base}/zip`)).json(), { compresse: true }, 'réponse compressée lue');
    const r3 = await fetchFige(`${base}/saute`);
    assert.equal(r3.status, 302); assert.equal(r3.headers.get('location'), '/ailleurs', 'la redirection est rendue, pas suivie');
    const r4 = await fetchFige(`${base}/vide`);
    assert.equal(r4.status, 204); assert.equal(await r4.text(), '');
    await assert.rejects(fetchFige(`${base}/lent`, { signal: AbortSignal.timeout(200) }), (e: Error) => e.name === 'TimeoutError');
    await assert.rejects(fetchFige('http://127.0.0.1:1/'), (e: Error) => e.message === 'fetch failed');
  } finally {
    dns.lookup = sauveLookup;
    Object.assign(reseauOdin, sauve);
    arreter(); reinitialiser();
    await gw.stop(); local.closeAllConnections(); await ferme(local); o.cleanup();
  }
});

// L'adresse publique réglée dans la configuration (web.publicUrl) : un Odin jetable démarre Talos comme en vrai
// (startDraupnir) ; un bloc web vers ce nom est refusé, sans rien envoyer, quelle que soit l'écriture du nom.
test('Talos : l\'adresse publique réglée d\'Odin est refusée aux blocs web (branchement de démarrage)', async () => {
  const sauve = { ...reseauOdin };
  reseauOdin.resoudre = async (n) => { if (n === 'odin.exemple.test') return ['203.0.113.9']; if (n === 'site.exemple') return ['203.0.113.5']; throw Object.assign(new Error('nom inconnu'), { code: 'ENOTFOUND' }); };
  reseauOdin.adressesMachine = () => ['127.0.0.1', '::1'];
  reseauOdin.nomMachine = () => 'poste-odin';
  reinitialiser();
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => true, parIp: async () => true }, intervalleMs: 1e9 });
  await sonderMaintenant();
  const o = makeOdin([], { config: (c) => ({ ...c, web: { ...c.web, publicUrl: 'https://odin.exemple.test' } }) });
  const arreterTalos = startDraupnir(o, async () => {});
  const appels: string[] = [];
  const f = (async (u: string) => { appels.push(String(u)); return new Response('{}'); }) as unknown as typeof fetch;
  try {
    for (const h of ['odin.exemple.test', 'ODIN.exemple.TEST.', 'odin.exemple.test:8443']) {
      const ex = await execute(flux('web.requête', { url: `https://${h}/api/state`, identifiant: 'ODIN_CLE' }), CATALOG, { fetch: f, secret: () => 'cle-essai' });
      assert.equal(ex.status, 'erreur', h); assert.match(ex.error ?? '', REFUS, h);
    }
    assert.deepEqual(appels, [], 'rien n\'est parti vers l\'adresse publique');
    const site = await execute(flux('web.requête', { url: 'https://site.exemple/ok' }), CATALOG, { fetch: f });
    assert.equal(site.status, 'succès', site.error);
  } finally {
    arreterTalos();
    Object.assign(reseauOdin, sauve);
    arreter(); reinitialiser(); o.cleanup();
  }
});
