// Vár, les identités : portail de connexion, connexion unique sur les sites du proxy, groupes, double
// authentification, en-têtes d'identité impossibles à falsifier, verrouillage, sessions coupées, graphe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { setMascot, totpOk, within } from '../src/valhalla/modules/var.ts';
import { proxyServer } from '../src/valhalla/modules/valgrind.ts';
import { totp } from '../src/valhalla/modules/brisingamen.ts';

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };
const req = (port: number, host: string, path = '/', o: { method?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<Res>((ok, ko) => {
  const q = https.request({ host: '127.0.0.1', port, path, method: o.method ?? 'GET', servername: host, rejectUnauthorized: false, headers: { host, connection: 'close', ...(o.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...o.headers } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => ok({ status: r.statusCode!, headers: r.headers, body: b })); });
  q.on('error', ko); if (o.body) q.write(o.body); q.end();
});
const cookieOf = (r: Res) => /odin_var=([^;]+)/.exec(String(r.headers['set-cookie'] ?? ''))?.[1] ?? '';

test('totp et domaine commun', () => {
  const sec = 'JBSWY3DPEHPK3PXP';
  assert.ok(totpOk(sec, totp(sec).code)); assert.ok(totpOk(sec, totp(sec, Date.now() - 30_000).code), '±30 s toléré'); assert.ok(!totpOk(sec, '000000') || totp(sec).code === '000000'); assert.ok(!totpOk(sec, 'abc'));
  assert.ok(within('nas.exemple.fr', 'exemple.fr') && within('exemple.fr', 'exemple.fr') && !within('exemple.fr.pirate.com', 'exemple.fr') && !within('pasexemple.fr', 'exemple.fr') && !within('x.fr', ''));
});

test('connexion unique : portail, groupes, identité transmise (jamais falsifiable), double authentification, verrouillage, sessions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'var-'));
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'cd'.repeat(32);
  setMascot('<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50"/></svg>');
  const seen: Array<{ user?: string; groups?: string }> = [];
  const svc = http.createServer((q, r) => { seen.push({ user: q.headers['remote-user'] as string | undefined, groups: q.headers['remote-groups'] as string | undefined }); r.writeHead(200); r.end('NAS'); });
  await new Promise<void>((ok) => svc.listen(0, '127.0.0.1', () => ok()));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const va = (a: string, i: Record<string, unknown> = {}) => v.act('var', a, i), vg = (a: string, i: Record<string, unknown> = {}) => v.act('valgrind', a, i);
  try {
    v.ctx('valgrind').saveSettings({ lanIp: '192.168.1.2' });
    await vg('demarrer', { http: 0, https: 0 }); const port = proxyServer()!.httpsPort;
    assert.equal((await va('proteger_site', { domaine: 'nas.exemple.fr' })).ok, false, 'il faut d\'abord le portail');
    assert.equal((await va('reglages', { portail: 'connexion.autre.fr', domaine: 'exemple.fr' })).ok, false, 'portail hors du domaine commun');
    assert.match((await va('reglages', { portail: 'connexion.exemple.fr', domaine: 'exemple.fr', heures: 8, double_auth: 'admins' })).text, /Portail connexion\.exemple\.fr \(sessions de 8 h, valables sur \*\.exemple\.fr\) servi par le proxy/);
    assert.match((await va('ajouter', { login: 'awa', nom: 'Awa', groupes: 'famille', mot_de_passe: 'une phrase assez longue' })).text, /Awa \(« awa », groupes famille\) ajouté\. Son mot de passe est dans le coffre/);
    assert.equal((await va('ajouter', { login: 'awa', nom: 'Autre' })).ok, false);
    assert.equal((await va('ajouter', { login: 'A B', nom: 'x' })).ok, false);
    await va('ajouter', { login: 'invite', nom: 'Invité', groupes: 'invites', mot_de_passe: 'une autre phrase longue' });
    await va('ajouter', { login: 'chef', nom: 'Chef', groupes: 'admins, famille', mot_de_passe: 'phrase du chef longue' });
    assert.doesNotMatch(JSON.stringify(v.ctx('var').settings), /une phrase assez longue/, 'jamais de mot de passe en clair');
    await vg('ajouter', { domaines: 'nas.exemple.fr', cible: `http://127.0.0.1:${(svc.address() as { port: number }).port}`, https: 'auto-signé', dns_maison: false, surveiller: false });
    assert.match((await va('proteger_site', { domaine: 'nas.exemple.fr', groupes: 'famille' })).text, /nas\.exemple\.fr demande maintenant la connexion d'Odin \(groupes famille\)/);

    // Sans connexion : renvoyé au portail (même avec un faux en-tête d'identité).
    const r1 = await req(port, 'nas.exemple.fr', '/photos', { headers: { 'remote-user': 'chef' } });
    assert.equal(r1.status, 302); assert.equal(r1.headers.location, `https://connexion.exemple.fr:${port}/?rd=${encodeURIComponent('https://nas.exemple.fr/photos')}`, 'retour au site demandé (nom tel que le navigateur l\'a donné)');
    const pg = await req(port, 'connexion.exemple.fr', `/?rd=${encodeURIComponent(`https://nas.exemple.fr:${port}/photos`)}`);
    assert.equal(pg.status, 200); assert.match(pg.body, /viewBox="0 0 120 120"[\s\S]*Connexion[\s\S]*name="login"[\s\S]*name="password"/); assert.match(String(pg.headers['content-security-policy']), /frame-ancestors 'none'/); assert.match(String(pg.headers['content-security-policy']), /form-action 'self' https:\/\/exemple\.fr:\* https:\/\/\*\.exemple\.fr:\*/, 'le retour au site après connexion est permis (sinon le navigateur bloque la redirection)'); assert.equal(pg.headers['referrer-policy'], 'same-origin');
    // Mauvais mot de passe, puis le bon : cookie sur tout le domaine, retour au site demandé.
    const rd = `?rd=${encodeURIComponent(`https://nas.exemple.fr:${port}/photos`)}`;
    assert.equal((await req(port, 'connexion.exemple.fr', `/connexion${rd}`, { method: 'POST', body: 'login=awa&password=faux' })).status, 401);
    const ok = await req(port, 'connexion.exemple.fr', `/connexion${rd}`, { method: 'POST', body: 'login=awa&password=une+phrase+assez+longue' });
    assert.equal(ok.status, 303); assert.equal(ok.headers.location, `https://nas.exemple.fr:${port}/photos`);
    assert.match(String(ok.headers['set-cookie']), /odin_var=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800; Domain=exemple\.fr; Secure/);
    const awa = cookieOf(ok);
    // Renvoi vers un site étranger refusé (pas de redirection ouverte).
    const evil = await req(port, 'connexion.exemple.fr', `/connexion?rd=${encodeURIComponent('https://pirate.com/')}`, { method: 'POST', body: 'login=awa&password=une+phrase+assez+longue' });
    assert.equal(evil.headers.location, '/');
    // Avec le cookie : le site répond, l'identité est posée par Odin (le faux en-tête est écrasé).
    const r2 = await req(port, 'nas.exemple.fr', '/', { headers: { cookie: `odin_var=${awa}`, 'remote-user': 'chef', 'x-remote-user': 'chef' } });
    assert.equal(r2.status, 200); assert.equal(r2.body, 'NAS'); assert.deepEqual(seen.at(-1), { user: 'awa', groups: 'famille' });
    // Quelqu'un qui n'est pas dans le groupe : refusé.
    const inv = cookieOf(await req(port, 'connexion.exemple.fr', '/connexion', { method: 'POST', body: 'login=invite&password=une+autre+phrase+longue' }));
    assert.equal((await req(port, 'nas.exemple.fr', '/', { headers: { cookie: `odin_var=${inv}` } })).status, 403);
    // Admins : double authentification obligatoire.
    const c1 = await req(port, 'connexion.exemple.fr', '/connexion', { method: 'POST', body: 'login=chef&password=phrase+du+chef+longue' });
    assert.equal(c1.status, 403); assert.match(c1.body, /Double authentification obligatoire/);
    const da = await va('double_auth', { login: 'chef' }); const secret = String((da.data as { conf: string }).conf).replace(/\s/g, '');
    assert.match((da.data as { svg: string }).svg, /^<svg/);
    assert.equal((await va('confirmer_double_auth', { login: 'chef', code: '123456' })).ok, totp(secret).code === '123456');
    assert.match((await va('confirmer_double_auth', { login: 'chef', code: totp(secret).code })).text, /Double authentification active pour Chef/);
    const c2 = await req(port, 'connexion.exemple.fr', '/connexion', { method: 'POST', body: 'login=chef&password=phrase+du+chef+longue' });
    assert.equal(c2.status, 200); assert.match(c2.body, /Code de vérification[\s\S]*name="code"/); assert.equal(cookieOf(c2), '', 'pas de session avant le code');
    assert.equal((await req(port, 'connexion.exemple.fr', '/connexion', { method: 'POST', body: 'login=chef&password=&code=000001' })).status, 401);
    await req(port, 'connexion.exemple.fr', '/connexion', { method: 'POST', body: 'login=chef&password=phrase+du+chef+longue' });
    const c3 = await req(port, 'connexion.exemple.fr', '/connexion', { method: 'POST', body: `login=chef&password=&code=${totp(secret).code}` });
    assert.equal(c3.status, 303); assert.ok(cookieOf(c3));
    // Formulaire envoyé depuis un autre site : refusé.
    assert.equal((await req(port, 'connexion.exemple.fr', '/connexion', { method: 'POST', body: 'login=awa&password=x', headers: { origin: 'https://pirate.com' } })).status, 403);
    // Verrouillage après 5 essais : alerte et Garmr appelé.
    for (let k = 0; k < 5; k++) await req(port, 'connexion.exemple.fr', '/connexion', { method: 'POST', body: 'login=invite&password=faux' });
    const lk = await req(port, 'connexion.exemple.fr', '/connexion', { method: 'POST', body: 'login=invite&password=une+autre+phrase+longue' });
    assert.equal(lk.status, 423); assert.match(lk.body, /verrouillé/);
    assert.ok(v.alerts({ module: 'var' }).some((a) => /Compte « invite » verrouillé 15 minutes/.test(a.title)));
    // Sessions : coupées, il faut se reconnecter.
    assert.match((await va('couper_sessions', { login: 'awa' })).text, /fermée/);
    assert.equal((await req(port, 'nas.exemple.fr', '/', { headers: { cookie: `odin_var=${awa}` } })).status, 302);
    // Page « connecté » et déconnexion.
    const ch = cookieOf(c3);
    const home2 = await req(port, 'connexion.exemple.fr', '/', { headers: { cookie: `odin_var=${ch}` } }); assert.match(home2.body, /Bonjour Chef[\s\S]*nas\.exemple\.fr[\s\S]*Se déconnecter/);
    const out = await req(port, 'connexion.exemple.fr', '/deconnexion', { method: 'POST', headers: { cookie: `odin_var=${ch}` } }); assert.equal(out.status, 303); assert.match(String(out.headers['set-cookie']), /Max-Age=0/);
    assert.match((await va('journal')).text, /❌ invite depuis 127\.0\.0\.1 \(mauvais mot de passe\)[\s\S]*✅ chef depuis 127\.0\.0\.1 \(mot de passe \+ code\)/);
    // Graphe.
    const view = await v.module('var')!.view(v.ctx('var'), new URLSearchParams());
    const g = view.sections.find((x) => x.kind === 'graph') as { nodes: Array<{ id: string; ring?: string }> };
    assert.ok(g.nodes.some((n) => n.id === 'g:famille') && g.nodes.some((n) => n.id === 's:nas.exemple.fr') && g.nodes.find((n) => n.id === 'p:chef')?.ring === '#B48CF0' && g.nodes.find((n) => n.id === 'p:invite')?.ring === '#EE6A55');
  } finally { await vg('arreter'); v.stop(); svc.close(); svc.closeAllConnections(); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; rmSync(home, { recursive: true, force: true }); }
});
