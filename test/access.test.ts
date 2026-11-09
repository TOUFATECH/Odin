import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { get as httpsGet } from 'node:https';
import { request } from 'node:http';
import { Gateway } from '../src/bifrost/gateway.ts';
import { loadConfig } from '../src/config.ts';
import { applySettings } from '../src/settings.ts';
import { X509Certificate } from 'node:crypto';
import { AuthThrottle, ensureTls, inCidr, localNetworks, remoteAllowed, selfSignedCertificate, servesTls, validCidr } from '../src/web/access.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { makeOdin } from './helpers.ts';

const port = () => 21000 + Math.floor(Math.random() * 20000);

test('périmètre : local = la machine, lan = ton sous-réseau seulement, wan = tout le monde', () => {
  const nets = ['192.168.1.0/24', 'fd12:3456:789a:1::/64'];
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(remoteAllowed('local', ip, nets), true, ip);
  for (const ip of ['192.168.1.20', '10.0.0.5']) assert.equal(remoteAllowed('local', ip, nets), false, ip);
  for (const ip of ['192.168.1.20', '192.168.1.254', '::ffff:192.168.1.9', 'fd12:3456:789a:1::42', '127.0.0.1']) assert.equal(remoteAllowed('lan', ip, nets), true, ip);
  for (const ip of ['192.168.2.20', '10.0.0.5', '8.8.8.8', 'fd12:3456:789a:2::1', '2a01:e0a::1', '', 'localhost']) assert.equal(remoteAllowed('lan', ip, nets), false, ip || '(vide)');
  assert.equal(remoteAllowed('wan', '8.8.8.8', nets), true);
});

test('CIDR : calculs IPv4/IPv6 et sous-réseaux détectés', () => {
  assert.equal(inCidr('10.1.2.3', '10.0.0.0/8'), true);
  assert.equal(inCidr('11.1.2.3', '10.0.0.0/8'), false);
  assert.equal(inCidr('100.101.5.6', '100.64.0.0/10'), true);
  assert.equal(inCidr('fe80::1%eth0', 'fe80::/10'), true);
  assert.equal(validCidr('192.168.1.0/24'), true);
  assert.equal(validCidr('192.168.1.0'), false);
  assert.equal(validCidr('0.0.0.0/0'), false, 'tout Internet : refusé en LAN');
  for (const n of localNetworks()) assert.equal(validCidr(n), true, n);
});

test('certificat auto-signé créé sans outil externe, lisible par Node', () => {
  const { cert, key } = selfSignedCertificate('Odin', ['localhost', 'odin.local'], ['127.0.0.1', '192.168.1.20']);
  const x = new X509Certificate(cert);
  assert.match(x.subject, /CN=Odin/);
  assert.match(x.subjectAltName!, /DNS:odin\.local/);
  assert.match(x.subjectAltName!, /IP Address:192\.168\.1\.20/);
  assert.equal(x.checkIP('192.168.1.20'), '192.168.1.20');
  assert.equal(x.verify(x.publicKey), true, 'signature valide');
  assert.ok(new Date(x.validTo).getTime() > Date.now() + 800 * 86_400_000);
  assert.match(key, /BEGIN PRIVATE KEY/);
});

test('limite d\'essais : 10 jetons faux en 10 minutes, puis blocage ; la machine jamais bloquée', () => {
  const t = new AuthThrottle(10, 600_000, 900_000);
  for (let i = 0; i < 9; i++) t.fail('203.0.113.9', 1000 + i);
  assert.equal(t.blocked('203.0.113.9', 2000), false);
  t.fail('203.0.113.9', 2000);
  assert.equal(t.blocked('203.0.113.9', 2001), true);
  assert.equal(t.blocked('203.0.113.9', 2000 + 900_001), false, 'levé au bout de 15 minutes');
  for (let i = 0; i < 50; i++) t.fail('127.0.0.1');
  assert.equal(t.blocked('127.0.0.1'), false);
});

test('réglage de l\'accès : écrit, validé, HTTPS forcé sur Internet', () => {
  const o = makeOdin([]);
  assert.deepEqual([o.cfg.web.access, servesTls(o.cfg.web)], ['lan', true], 'par défaut : réseau local en HTTPS');
  applySettings(o.paths, o.cfg, 'access', { access: 'lan', https: false, port: 8080, networks: '192.168.1.0/24, 10.8.0.0/16' });
  let w = loadConfig(o.paths).web;
  assert.deepEqual([w.access, w.port, servesTls(w), w.allowedNetworks], ['lan', 8080, false, ['192.168.1.0/24', '10.8.0.0/16']]);
  assert.throws(() => applySettings(o.paths, o.cfg, 'access', { access: 'lan', networks: '0.0.0.0/0' }), /CIDR/);
  applySettings(o.paths, o.cfg, 'access', { access: 'wan', https: false });
  w = loadConfig(o.paths).web;
  assert.equal(servesTls(w), true, 'Internet sans HTTPS est impossible');
  applySettings(o.paths, o.cfg, 'access', { access: 'wan', behindProxy: true, publicUrl: 'https://odin.exemple.fr' });
  w = loadConfig(o.paths).web;
  assert.deepEqual([servesTls(w), w.behindProxy, w.publicUrl], [false, true, 'https://odin.exemple.fr']);
  assert.throws(() => applySettings(o.paths, o.cfg, 'access', { access: 'wan', publicUrl: 'http://pas-chiffre.fr' }), /https/);
  assert.throws(() => applySettings(o.paths, o.cfg, 'access', { access: 'lan', port: 80 }), /port/);
  assert.throws(() => applySettings(o.paths, o.cfg, 'access', { access: 'wan', cert: '/nulle/part.pem', key: '/nulle/part.key' }), /introuvable/);
  assert.equal(loadConfig(o.paths).web.enabled, true, 'les autres clés du bloc web sont conservées');
  o.cleanup();
});

test('réseau local : l\'en-tête Host n\'est plus filtré, le jeton reste exigé', async () => {
  const o = makeOdin([]);
  const p = port(), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port: p, host: '127.0.0.1', token, access: 'lan' }));
  await gw.start();
  const call = (headers: Record<string, string>) => new Promise<number>((res) => request({ host: '127.0.0.1', port: p, path: '/api/state', headers }, (r) => { r.resume(); res(r.statusCode!); }).end());
  try {
    assert.equal(await call({ host: 'odin.local:7777' }), 401, 'sans jeton : refusé');
    assert.equal(await call({ host: '192.168.1.10:7777', authorization: `Bearer ${token}` }), 200, 'nom ou IP du réseau local accepté');
  } finally { await gw.stop(); o.cleanup(); }
});

test('Internet derrière un proxy : l\'adresse réelle du visiteur est limitée', async () => {
  const o = makeOdin([], { config: (c) => ({ ...c, web: { ...c.web, access: 'wan', behindProxy: true } }) });
  const p = port(), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port: p, host: '127.0.0.1', token, access: 'wan' }));
  await gw.start();
  const call = (fwd: string, tok: string) => new Promise<number>((res) => request({ host: '127.0.0.1', port: p, path: '/api/state', headers: { 'x-forwarded-for': fwd, authorization: `Bearer ${tok}` } }, (r) => { r.resume(); res(r.statusCode!); }).end());
  try {
    for (let i = 0; i < 10; i++) assert.equal(await call('203.0.113.9', 'f'.repeat(48)), 401);
    assert.equal(await call('203.0.113.9', token), 429, 'bloqué, même avec le bon jeton');
    assert.equal(await call('198.51.100.7', token), 200, 'un autre visiteur n\'est pas touché');
  } finally { await gw.stop(); o.cleanup(); }
});

test('Internet : HTTPS avec certificat auto-signé, cookie Secure, empreinte affichée', async () => {
  const o = makeOdin([], { config: (c) => ({ ...c, web: { ...c.web, access: 'wan' } }) });
  const tls = ensureTls(o.paths, o.cfg.web);
  assert.equal(tls.selfSigned, true);
  assert.match(tls.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(ensureTls(o.paths, o.cfg.web).fingerprint, tls.fingerprint, 'généré une seule fois');
  // Stable : une adresse qui disparaît (Wi-Fi coupé) ne régénère rien ; un nom qui manque, si, en gardant les anciens.
  const namesFile = join(o.paths.home, 'tls', 'names.json');
  const names = JSON.parse(readFileSync(namesFile, 'utf8')) as { dns: string[]; ips: string[] };
  writeFileSync(namesFile, JSON.stringify({ dns: names.dns, ips: [...names.ips, '10.99.99.99'] }));
  assert.equal(ensureTls(o.paths, o.cfg.web).fingerprint, tls.fingerprint, 'adresse en trop : conservé');
  const tls2 = ensureTls(o.paths, { ...o.cfg.web, publicUrl: 'https://odin.exemple.fr' });
  assert.notEqual(tls2.fingerprint, tls.fingerprint, 'nouveau nom public : régénéré');
  const after = JSON.parse(readFileSync(namesFile, 'utf8')) as { dns: string[]; ips: string[] };
  assert.ok(after.dns.includes('odin.exemple.fr') && after.dns.includes('localhost') && after.ips.includes('10.99.99.99'), 'anciens noms gardés, nouveau ajouté');
  const p = port(), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  const web = new WebChannel(o, { scanNetwork: async () => undefined }, { port: p, host: '127.0.0.1', token, access: 'wan', tls });
  gw.add(web);
  await gw.start();
  const get = (path: string, headers: Record<string, string> = {}) => new Promise<{ code: number; cookie: string; body: string }>((res, rej) => {
    httpsGet({ host: '127.0.0.1', port: p, path, headers, rejectUnauthorized: false }, (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => res({ code: r.statusCode!, cookie: String(r.headers['set-cookie'] ?? ''), body: b })); }).on('error', rej);
  });
  try {
    assert.match(web.url, /^https:\/\/127\.0\.0\.1:/);
    const login = await get(`/?token=${token}`);
    assert.equal(login.code, 302);
    assert.match(login.cookie, /HttpOnly; SameSite=Strict; .*Secure/);
    const st = JSON.parse((await get('/api/state', { authorization: `Bearer ${token}` })).body) as { access: { mode: string; https: boolean; fingerprint: string } };
    assert.deepEqual([st.access.mode, st.access.https, st.access.fingerprint], ['wan', true, tls.fingerprint]);
    // « IP:port » tapé sans https:// : le même port renvoie vers https au lieu d'une page inaccessible.
    const plain = await fetch(`http://127.0.0.1:${p}/?token=${token}`, { redirect: 'manual' });
    assert.equal(plain.status, 308);
    assert.equal(plain.headers.get('location'), `https://127.0.0.1:${p}/?token=${token}`);
    const evil = await fetch(`http://127.0.0.1:${p}/`, { redirect: 'manual', headers: { host: 'evil.com/x' } });
    assert.equal(evil.headers.get('location'), `https://127.0.0.1:${p}/`, 'hôte piégé : ignoré');
    assert.equal((await get('/api/state', { authorization: `Bearer ${token}` })).code, 200, 'le https marche toujours après');
  } finally { await gw.stop(); o.cleanup(); }
});

test('nouveau jeton : l\'ancien ne marche plus', async () => {
  const o = makeOdin([]);
  const p = port(), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port: p, host: '127.0.0.1', token }));
  await gw.start();
  const B = `http://127.0.0.1:${p}`;
  try {
    const r = await (await fetch(`${B}/api/action`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-odin': '1', 'content-type': 'application/json' }, body: '{"kind":"token_rotate"}' })).json() as { token: string };
    assert.notEqual(r.token, token);
    assert.equal((await fetch(`${B}/api/state`, { headers: { authorization: `Bearer ${token}` } })).status, 401);
    assert.equal((await fetch(`${B}/api/state`, { headers: { authorization: `Bearer ${r.token}` } })).status, 200);
    assert.equal(ensureWebToken(o.paths), r.token, 'enregistré pour les prochains démarrages');
  } finally { await gw.stop(); o.cleanup(); }
});
