// Valgrind, le proxy inverse : routes par nom, HTTPS (certificat par nom), passage en HTTPS, HSTS, en-têtes,
// mot de passe, accès par adresses, bannis, WebSocket, redirections, flux TCP, panne du service, défi Let's
// Encrypt ; client ACME complet face à un faux serveur ACME ; appli et liens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { createPublicKey, createVerify, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProxyServer, hashPassword, checkPassword, inNet, route, type Host, type AccessLog } from '../src/valhalla/valgrind/proxy.ts';
import { csr, newKey, obtain, thumbprint } from '../src/valhalla/valgrind/acme.ts';
import { issueCertificate } from '../src/web/access.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { certInfo } from '../src/valhalla/modules/valgrind.ts';

/** Un service de la maison : renvoie ce qu'il a reçu ; sait faire un WebSocket très simple (écho). */
async function service() {
  const s = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json', 'x-service': 'oui' }); r.end(JSON.stringify({ path: q.url, host: q.headers.host, xff: q.headers['x-forwarded-for'], proto: q.headers['x-forwarded-proto'], xhost: q.headers['x-forwarded-host'] })); });
  s.on('upgrade', (q, sock) => { sock.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n'); sock.on('data', (d: Buffer) => sock.write(Buffer.concat([Buffer.from('écho:'), d]))); });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
  return { s, url: `http://127.0.0.1:${(s.address() as net.AddressInfo).port}` };
}
const get = (port: number, host: string, path = '/', o: { secure?: boolean; headers?: Record<string, string> } = {}) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; cert?: tls.PeerCertificate }>((ok, ko) => {
  const lib = o.secure ? require_https() : http;
  const q = lib.request({ host: '127.0.0.1', port, path, servername: host, headers: { host, ...o.headers }, rejectUnauthorized: false }, (r) => { const cert = o.secure ? (r.socket as tls.TLSSocket).getPeerCertificate() : undefined; let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => ok({ status: r.statusCode!, headers: r.headers, body: b, cert })); });
  q.on('error', ko); q.end();
});
import https from 'node:https';
function require_https() { return https; }

test('proxy : noms, HTTPS par nom, passage en HTTPS, HSTS, en-têtes, mot de passe, accès, bannis, WebSocket, redirections, flux, panne', async () => {
  const svc = await service(), logs: AccessLog[] = [], fails: string[] = [];
  const certs: Record<string, { cert: string; key: string }> = { 'nas.exemple.fr': issueCertificate('nas.exemple.fr', ['nas.exemple.fr'], []) };
  const hosts: Host[] = [
    { id: 'a', domains: ['nas.exemple.fr'], target: svc.url, enabled: true, forceHttps: true, hsts: true, websocket: true, preserveHost: true, headers: { 'x-frame-options': 'DENY' }, tls: 'auto' },
    { id: 'b', domains: ['*.jeux.fr'], target: `${svc.url}/base`, enabled: true },
    { id: 'c', domains: ['prive.fr'], target: svc.url, enabled: true, auth: { awa: hashPassword('une phrase solide') } },
    { id: 'd', domains: ['maison.fr'], target: svc.url, enabled: true, allow: ['10.0.0.0/8'] },
    { id: 'e', domains: ['panne.fr'], target: 'http://127.0.0.1:9', enabled: true },
    { id: 'f', domains: ['coupe.fr'], target: svc.url, enabled: false },
  ];
  const banned = new Set<string>();
  const p = new ProxyServer({ hosts: () => hosts, redirects: () => [{ id: 'r', domain: 'ancien.fr', to: 'https://nouveau.fr', code: 301, keepPath: true }], cert: (n) => certs[n], defaultCert: () => issueCertificate('Odin', ['odin.local'], []), challenge: (t) => (t === 'jeton-de-test-123' ? 'jeton-de-test-123.empreinte' : undefined), banned: (ip) => banned.has(ip), log: (e) => logs.push(e), onAuthFail: (ip) => fails.push(ip) });
  await p.start({ http: 0, https: 0, host: '127.0.0.1' });
  try {
    // Passage en HTTPS, puis HTTPS avec le bon certificat, HSTS, en-têtes ajoutés et transmis.
    const r1 = await get(p.httpPort, 'nas.exemple.fr', '/photos?x=1');
    assert.equal(r1.status, 301); assert.equal(r1.headers.location, `https://nas.exemple.fr:${p.httpsPort}/photos?x=1`);
    const r2 = await get(p.httpsPort, 'nas.exemple.fr', '/photos?x=1', { secure: true });
    assert.equal(r2.status, 200); assert.equal(r2.cert?.subject.CN, 'nas.exemple.fr', 'certificat choisi par le nom (SNI)');
    const b2 = JSON.parse(r2.body); assert.deepEqual([b2.path, b2.host, b2.xff, b2.proto, b2.xhost], ['/photos?x=1', 'nas.exemple.fr', '127.0.0.1', 'https', 'nas.exemple.fr']);
    assert.equal(r2.headers['strict-transport-security'], 'max-age=31536000'); assert.equal(r2.headers['x-frame-options'], 'DENY'); assert.equal(r2.headers['x-service'], 'oui');
    assert.equal((await get(p.httpsPort, 'inconnu.fr', '/', { secure: true })).cert?.subject.CN, 'Odin', 'nom inconnu : certificat d\'Odin');
    // Joker et chemin de la cible.
    const r3 = JSON.parse((await get(p.httpPort, 'mario.jeux.fr', '/x')).body); assert.equal(r3.path, '/base/x'); assert.equal(r3.host, `127.0.0.1:${new URL(svc.url).port}`, 'nom de la cible transmis');
    assert.equal((await get(p.httpPort, 'jeux.fr')).status, 404, 'le joker ne couvre pas le domaine nu');
    // Rien ici, coupé, redirection, défi Let's Encrypt.
    const r4 = await get(p.httpPort, 'rien.fr'); assert.equal(r4.status, 404); assert.match(r4.body, /Rien ici/);
    assert.equal((await get(p.httpPort, 'coupe.fr')).status, 404);
    const r5 = await get(p.httpPort, 'ancien.fr', '/page'); assert.deepEqual([r5.status, r5.headers.location], [301, 'https://nouveau.fr/page']);
    assert.equal((await get(p.httpPort, 'nimporte.fr', '/.well-known/acme-challenge/jeton-de-test-123')).body, 'jeton-de-test-123.empreinte');
    // Mot de passe.
    const r6 = await get(p.httpPort, 'prive.fr'); assert.equal(r6.status, 401); assert.match(String(r6.headers['www-authenticate']), /Basic/);
    assert.equal((await get(p.httpPort, 'prive.fr', '/', { headers: { authorization: `Basic ${Buffer.from('awa:mauvais').toString('base64')}` } })).status, 401);
    assert.deepEqual(fails, ['127.0.0.1'], 'mauvais mot de passe compté');
    assert.equal((await get(p.httpPort, 'prive.fr', '/', { headers: { authorization: `Basic ${Buffer.from('awa:une phrase solide').toString('base64')}` } })).status, 200);
    // Accès par adresses, bannis.
    assert.equal((await get(p.httpPort, 'maison.fr')).status, 403);
    banned.add('127.0.0.1'); assert.equal((await get(p.httpPort, 'mario.jeux.fr')).status, 403); banned.clear();
    // Service en panne.
    const r7 = await get(p.httpPort, 'panne.fr'); assert.equal(r7.status, 502); assert.match(r7.body, /ne répond pas/);
    // WebSocket.
    const ws = await new Promise<string>((ok, ko) => { const c = tls.connect({ host: '127.0.0.1', port: p.httpsPort, servername: 'nas.exemple.fr', rejectUnauthorized: false }, () => c.write('GET /ws HTTP/1.1\r\nhost: nas.exemple.fr\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\n')); let b = ''; c.on('data', (d) => { b += d; if (b.includes('101') && !b.includes('écho')) c.write('bonjour'); if (b.includes('écho:bonjour')) { c.end(); ok(b); } }); c.on('error', ko); setTimeout(() => ko(new Error('pas de réponse')), 3000); });
    assert.match(ws, /101 Switching Protocols[\s\S]*écho:bonjour/);
    // Flux TCP.
    const port = await new Promise<number>((ok) => { const x = net.createServer(); x.listen(0, '127.0.0.1', () => { const n = (x.address() as net.AddressInfo).port; x.close(() => ok(n)); }); });
    assert.deepEqual(await p.syncStreams([{ id: 's', port, target: svc.url.replace('http://', ''), enabled: true }], '127.0.0.1'), []);
    assert.equal(JSON.parse((await get(port, 'nimporte', '/flux')).body).path, '/flux', 'le flux TCP mène au service');
    assert.ok(logs.some((e) => e.status === 502 && e.host === 'panne.fr') && logs.some((e) => e.method === 'UPGRADE' && e.status === 101));
    assert.ok(inNet('10.8.0.4', '10.0.0.0/8') && !inNet('192.168.1.4', '10.0.0.0/8') && inNet('::ffff:192.168.1.4', '192.168.1.4'));
    assert.equal(route(hosts, 'NAS.exemple.fr.')?.id, 'a'); assert.ok(checkPassword('x'.repeat(10), hashPassword('x'.repeat(10))) && !checkPassword('y', hashPassword('x')));
  } finally { p.stop(); svc.s.close(); svc.s.closeAllConnections(); }
});

/** Un faux serveur ACME (comme Let's Encrypt), qui vérifie les signatures, le défi HTTP-01 et la demande de certificat. */
async function fakeAcme(proxyPort: () => number) {
  let base = '', n = 0; const nonces = new Set<string>(), checks: string[] = [];
  let jwk: Record<string, string> | undefined, token = 'jeton_' + Math.random().toString(36).slice(2), authz = 'pending', order = 'pending', certPem = '';
  const nonce = () => { const x = `n${++n}`; nonces.add(x); return x; };
  const s = http.createServer(async (q, r) => {
    const send = (status: number, body: unknown, h: Record<string, string> = {}) => { r.writeHead(status, { 'replay-nonce': nonce(), 'content-type': typeof body === 'string' ? 'application/pem-certificate-chain' : 'application/json', ...h }); r.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (q.url === '/dir') return send(200, { newNonce: `${base}/nonce`, newAccount: `${base}/acct`, newOrder: `${base}/order` });
    if (q.url === '/nonce') return send(200, {});
    let raw = ''; for await (const c of q) raw += c;
    const jws = JSON.parse(raw) as { protected: string; payload: string; signature: string };
    const prot = JSON.parse(Buffer.from(jws.protected, 'base64url').toString()) as { alg: string; nonce: string; url: string; jwk?: Record<string, string>; kid?: string };
    if (!nonces.delete(prot.nonce)) return send(400, { type: 'urn:ietf:params:acme:error:badNonce' });
    if (prot.url !== `${base}${q.url}`) return send(400, { detail: 'mauvaise adresse' });
    if (prot.jwk) jwk = prot.jwk; else if (prot.kid !== `${base}/acct/1`) return send(401, { detail: 'compte inconnu' });
    const key = createPublicKey({ key: jwk!, format: 'jwk' });
    const ok = createVerify('sha256').update(`${jws.protected}.${jws.payload}`).verify({ key, dsaEncoding: 'ieee-p1363' }, Buffer.from(jws.signature, 'base64url'));
    if (!ok) return send(400, { detail: 'signature fausse' }); checks.push(`signé ${q.url}`);
    const payload = jws.payload ? JSON.parse(Buffer.from(jws.payload, 'base64url').toString()) : '';
    if (q.url === '/acct') return send(201, { status: 'valid' }, { location: `${base}/acct/1` });
    if (q.url === '/order') { if (payload.identifiers[0].value !== 'nas.exemple.fr') return send(400, { detail: 'nom' }); return send(201, { status: order, authorizations: [`${base}/authz/1`], finalize: `${base}/finalize` }, { location: `${base}/order/1` }); }
    if (q.url === '/authz/1') return send(200, { status: authz, identifier: { type: 'dns', value: 'nas.exemple.fr' }, challenges: [{ type: 'http-01', url: `${base}/chall/1`, token, status: authz }] });
    if (q.url === '/chall/1') {
      // Le défi : on va chercher la réponse sur le port 80 du proxy, sous le nom à certifier.
      const ans = await new Promise<string>((res) => http.get({ host: '127.0.0.1', port: proxyPort(), path: `/.well-known/acme-challenge/${token}`, headers: { host: 'nas.exemple.fr' } }, (x) => { let b = ''; x.on('data', (c) => { b += c; }); x.on('end', () => res(b)); }).on('error', () => res('')));
      authz = ans === `${token}.${thumbprint_(jwk!)}` ? 'valid' : 'invalid'; checks.push(`défi ${authz}`);
      return send(200, { status: 'processing' });
    }
    if (q.url === '/finalize') {
      const dir = mkdtempSync(join(tmpdir(), 'csr-')); writeFileSync(join(dir, 'r.der'), Buffer.from(payload.csr, 'base64url'));
      try { const out = execFileSync('openssl', ['req', '-inform', 'DER', '-in', join(dir, 'r.der'), '-noout', '-verify', '-text'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); checks.push(/DNS:nas\.exemple\.fr/.test(out) ? 'CSR valide' : 'CSR sans nom'); }
      catch (e) { checks.push(`CSR : ${(e as Error).message.slice(0, 80)}`); } finally { rmSync(dir, { recursive: true, force: true }); }
      // Comme une vraie autorité : le certificat porte la clé de la demande, signé par une autorité d'essai.
      const d2 = mkdtempSync(join(tmpdir(), 'ca-'));
      try {
        writeFileSync(join(d2, 'r.der'), Buffer.from(payload.csr, 'base64url')); writeFileSync(join(d2, 'ext.cnf'), 'subjectAltName=DNS:nas.exemple.fr\n');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', join(d2, 'ca-key.pem'), '-out', join(d2, 'ca.pem'), '-days', '2', '-subj', '/O=Autorite essai/CN=Essai'], { stdio: 'ignore' });
        certPem = execFileSync('openssl', ['x509', '-req', '-inform', 'DER', '-in', join(d2, 'r.der'), '-CA', join(d2, 'ca.pem'), '-CAkey', join(d2, 'ca-key.pem'), '-CAcreateserial', '-days', '90', '-extfile', join(d2, 'ext.cnf')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } finally { rmSync(d2, { recursive: true, force: true }); }
      order = 'valid';
      return send(200, { status: 'processing' });
    }
    if (q.url === '/order/1') return send(200, { status: order, authorizations: [], finalize: `${base}/finalize`, ...(order === 'valid' ? { certificate: `${base}/cert/1` } : {}) });
    if (q.url === '/cert/1') return send(200, certPem);
    send(404, {});
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
  base = `http://127.0.0.1:${(s.address() as net.AddressInfo).port}`;
  return { s, dir: `${base}/dir`, checks };
}
function thumbprint_(j: Record<string, string>) { const { createHash } = require_crypto(); return createHash('sha256').update(`{"crv":"${j.crv}","kty":"EC","x":"${j.x}","y":"${j.y}"}`).digest('base64url'); }
import * as cryptoMod from 'node:crypto';
function require_crypto() { return cryptoMod; }

test('Let\'s Encrypt (ACME) : compte, commande, défi HTTP-01 servi par le proxy, demande de certificat, chaîne', async (t) => {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { t.diagnostic('openssl absent'); return; }
  const answers = new Map<string, string>();
  const p = new ProxyServer({ hosts: () => [], redirects: () => [], cert: () => undefined, defaultCert: () => issueCertificate('Odin', [], []), challenge: (x) => answers.get(x) });
  await p.start({ http: 0, host: '127.0.0.1' });
  const acme = await fakeAcme(() => p.httpPort);
  try {
    const k = newKey();
    assert.equal(thumbprint(k).length, 43);
    const r = await obtain(['nas.exemple.fr'], { directory: acme.dir, accountKey: k, fetch, challenge: (tk, a) => { if (a) answers.set(tk, a); else answers.delete(tk); }, pollMs: 10 });
    assert.match(r.cert, /BEGIN CERTIFICATE/); assert.match(r.key, /BEGIN PRIVATE KEY/);
    assert.ok(acme.checks.includes('défi valid') && acme.checks.includes('CSR valide'), acme.checks.join(' | '));
    assert.equal(answers.size, 0, 'la réponse au défi est oubliée ensuite');
    assert.match(Buffer.from(csr(['a.fr', 'b.fr'], k)).toString('hex').slice(0, 2), /30/);
    const info = certInfo(r.cert); assert.deepEqual(info.names, ['nas.exemple.fr']); assert.ok(info.days >= 89 && info.days <= 90); assert.equal(info.issuer, 'Autorite essai');
    tls.createSecureContext({ cert: r.cert, key: r.key });
  } finally { p.stop(); acme.s.close(); acme.s.closeAllConnections(); }
});

test('appli Valgrind : démarrer, ajouter (DNS de la maison, surveillance), mot de passe dans le coffre, Let\'s Encrypt, flux, tester, graphe, bannissement', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'valgrind-')), svc = await service();
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ab'.repeat(32);
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const act = (x: string, i: Record<string, unknown> = {}) => v.act('valgrind', x, i);
  try {
    assert.match((await act('demarrer', { http: 0, https: 0 })).text, /Proxy en marche : HTTP sur le port \d+, HTTPS sur le port \d+/);
    const added = await act('ajouter', { domaines: 'nas.exemple.fr', cible: svc.url.replace('http://', ''), https: 'letsencrypt' });
    assert.match(added.text, /nas\.exemple\.fr → http:\/\/127\.0\.0\.1:\d+\.\n⚠ Let's Encrypt pas encore possible : Let's Encrypt vérifie par le port 80/, 'port 80 non utilisé : certificat auto-signé en attendant');
    assert.match(added.text, /Service surveillé par Pulsar/);
    assert.ok(((v.ctx('vordr').settings.monitors as Array<{ name: string }>) ?? []).some((m) => m.name === 'Service nas.exemple.fr'));
    assert.equal((await act('ajouter', { domaines: 'nas.exemple.fr', cible: svc.url })).ok, false, 'nom déjà pris');
    assert.equal((await act('ajouter', { domaines: 'pas un nom', cible: svc.url })).ok, false);
    // Let's Encrypt avec le faux serveur ACME (port quelconque autorisé pour l'essai).
    if (((): boolean => { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })()) {
      const port = Number(/HTTP sur le port (\d+)/.exec((await act('tester', { domaine: 'nas.exemple.fr' })).text)?.[1] ?? 0) || (await import('../src/valhalla/modules/valgrind.ts')).proxyServer()!.httpPort;
      const acme = await fakeAcme(() => port);
      v.ctx('valgrind').saveSettings({ acmeDirectory: acme.dir, acmeAnyPort: true, acmePollMs: 10 });
      try { assert.match((await act('certificat', { domaine: 'nas.exemple.fr' })).text, /Certificat .* pour nas\.exemple\.fr, valable jusqu'au \d{4}-\d{2}-\d{2}/); }
      finally { acme.s.close(); acme.s.closeAllConnections(); }
    } else t.diagnostic('openssl absent : Let\'s Encrypt non essayé ici');
    // Mot de passe : dans le coffre, le proxy ne garde que l'empreinte.
    const pr = await act('proteger', { domaine: 'nas.exemple.fr', utilisateur: 'awa', mot_de_passe: 'une phrase assez longue' });
    assert.match(pr.text, /demande maintenant un mot de passe \(identifiant « awa »\)\. Le mot de passe est dans le coffre/);
    assert.doesNotMatch(JSON.stringify(v.ctx('valgrind').settings), /une phrase assez longue/);
    // Bannissement après 5 mauvais mots de passe (lien Valgrind → Cerbère) : une adresse de la maison n'est jamais bannie.
    const srvp = (await import('../src/valhalla/modules/valgrind.ts')).proxyServer()!;
    for (let k = 0; k < 5; k++) await get(srvp.httpsPort, 'nas.exemple.fr', '/', { secure: true, headers: { authorization: `Basic ${Buffer.from('awa:faux').toString('base64')}` } });
    await new Promise((ok) => setTimeout(ok, 100));
    const tst = await act('tester', { domaine: 'nas.exemple.fr' });
    assert.match(tst.text, /Certificat : .* jour\(s\) restant\(s\)[\s\S]*Service : répond \(code 200/);
    assert.match((await act('rediriger', { domaine: 'ancien.exemple.fr', vers: 'https://nas.exemple.fr', code: '301' })).text, /ancien\.exemple\.fr → https:\/\/nas\.exemple\.fr \(définitive\)/);
    assert.match((await act('journal')).text, /nas\.exemple\.fr\/ → 401 .*mauvais mot de passe/);
    const view = await v.module('valgrind')!.view(v.ctx('valgrind'), new URLSearchParams());
    const g = view.sections.find((s) => s.kind === 'graph') as { nodes: Array<{ id: string; label: string; ring?: string }> };
    assert.ok(g.nodes.some((n) => n.id === 'internet') && g.nodes.some((n) => n.label === 'nas.exemple.fr' && n.ring === '#B48CF0') && g.nodes.some((n) => n.label === 'ancien.exemple.fr'));
    assert.match((await act('arreter')).text, /arrêté/);
    void X509Certificate;
  } finally { v.stop(); svc.s.close(); svc.s.closeAllConnections(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; rmSync(home, { recursive: true, force: true }); }
});
