// Achille : la portée (refus de tout ce qui n'est pas à toi, revérification après DNS), la preuve d'un domaine,
// l'autorité limitée, le proxy (HTTP et HTTPS interceptés, refus notés, appareils), le journal masqué, les contrôles
// passifs, le rejeu limité, les outils. Aucun service réel : faux résolveur DNS et faux serveurs sur 127.0.0.1.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer, type Server } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect as netConnect, type AddressInfo } from 'node:net';
import { connect as tlsConnect, createServer as tlsServer } from 'node:tls';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { selfSignedCertificate } from '../src/web/access.ts';
import { dansLaPortee, verifierPreuve, type Resolveur } from '../src/valhalla/achille/portee.ts';
import { autorite } from '../src/valhalla/achille/ca.ts';
import { controler } from '../src/valhalla/achille/controles.ts';
import { comparer, decoder, encoder, lireJwt, masquerEntetes, masquerUrl } from '../src/valhalla/achille/outils.ts';
import { ProxyAchille } from '../src/valhalla/achille/proxy.ts';
import { proxyAchille, reseauAchille } from '../src/valhalla/modules/achille.ts';

const DNS: Record<string, string[]> = { 'site.maison.lan': ['10.0.0.5'], 'example.com': ['93.184.216.34'], 'faux.lan': ['8.8.8.8'], 'monsite.fr': ['203.0.113.7'], 'www.monsite.fr': ['203.0.113.7'], 'piege.lan': ['127.0.0.1'] };
const TXT: Record<string, string[]> = {};
const resoudre: Resolveur = { adresses: async (h) => { if (!DNS[h]) throw new Error('introuvable'); return DNS[h]; }, txt: async (n) => TXT[n] ?? [] };

const ecouter = async (s: Server) => { s.listen(0, '127.0.0.1'); await once(s, 'listening'); return (s.address() as AddressInfo).port; };
const PAGE = '<!doctype html><html><head><meta name="generator" content="WordPress 6.4.2"><title>Ma page</title></head><body><form method="post" action="/x"><input name="nom"></form></body></html>';
const vus: Array<Record<string, string | string[] | undefined>> = [];
const amont = httpServer((req, res) => { vus.push(req.headers); res.writeHead(200, { 'content-type': 'text/html', server: 'nginx/1.18.0', 'set-cookie': 'session=abc123; Path=/' }); res.end(PAGE); });
const tlsMat = selfSignedCertificate('site.maison.lan', ['site.maison.lan'], []);
const amontTls = httpsServer({ key: tlsMat.key, cert: tlsMat.cert }, (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('bonjour en https'); });
let pHttp = 0, pHttps = 0;
const home = mkdtempSync(join(tmpdir(), 'achille-'));
after(() => { amont.close(); amontTls.close(); proxyAchille()?.eteindre('fin'); rmSync(home, { recursive: true, force: true }); });

test('portée : maison oui, Internet non, Odin et métadonnées jamais, revérifiée après DNS', async () => {
  const d = { domaines: [], resoudre };
  assert.equal((await dansLaPortee('site.maison.lan', d)).ok, true);
  assert.equal((await dansLaPortee('site.maison.lan', d)).adresse, '10.0.0.5');
  assert.equal((await dansLaPortee('192.168.1.20', d)).ok, true);
  assert.equal((await dansLaPortee('example.com', d)).ok, false);
  assert.equal((await dansLaPortee('8.8.8.8', d)).ok, false);
  for (const h of ['169.254.169.254', 'localhost', '127.0.0.1', '[::1]', 'metadata.google.internal']) assert.equal((await dansLaPortee(h, d)).ok, false, h);
  // Rejeu (boucle) : la boucle locale est permise, jamais le lien local ni les métadonnées.
  for (const h of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal((await dansLaPortee(h, { ...d, boucle: true })).ok, true, h);
  for (const h of ['169.254.169.254', '0.0.0.0', 'metadata.google.internal']) assert.equal((await dansLaPortee(h, { ...d, boucle: true })).ok, false, h);
  assert.match((await dansLaPortee('faux.lan', d)).raison, /mène à Internet/);
  assert.equal((await dansLaPortee('piege.lan', d)).ok, false, 'un nom qui mène à Odin lui-même');
  // Domaine déclaré : pas dans la portée avant la preuve, dedans après (sous-domaines compris).
  const dom = { nom: 'monsite.fr', jeton: 'odin-achille-123', declare: '' };
  assert.equal((await dansLaPortee('monsite.fr', { domaines: [dom], resoudre })).ok, false);
  assert.equal((await verifierPreuve(dom, { resoudre })).ok, false);
  TXT['_odin-achille.monsite.fr'] = ['odin-achille-123'];
  const p = await verifierPreuve(dom, { resoudre }); assert.equal(p.ok, true); assert.equal(p.par, 'txt');
  const prouve = { ...dom, prouve: '2026-11-16' };
  assert.equal((await dansLaPortee('www.monsite.fr', { domaines: [prouve], resoudre })).ok, true);
  assert.equal((await dansLaPortee('autremonsite.fr', { domaines: [prouve], resoudre })).ok, false);
});

test('autorité : certificat signé par Achille, et la contrainte de noms exclut un domaine non déclaré', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'achille-ca-'));
  try {
    const a = autorite(dir, dir, []);
    assert.equal(a.refaite, true);
    assert.match(readFileSync(join(dir, 'ca.json'), 'utf8'), /"cle": "odc1:/, 'clé chiffrée');
    assert.doesNotMatch(readFileSync(join(dir, 'ca.json'), 'utf8'), /PRIVATE KEY/);
    assert.equal(autorite(dir, dir, []).refaite, false);
    const essai = async (nom: string) => {
      const f = a.pour(nom), srv = tlsServer({ cert: f.cert, key: f.key }, (s) => s.end());
      srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
      try {
        return await new Promise<string>((ok) => { const c = tlsConnect({ port: (srv.address() as AddressInfo).port, host: '127.0.0.1', servername: nom, ca: a.cert, checkServerIdentity: () => undefined }); c.on('secureConnect', () => { c.end(); ok('ok'); }); c.on('error', (e) => ok((e as NodeJS.ErrnoException).code ?? e.message)); });
      } finally { srv.close(); }
    };
    assert.equal(await essai('site.maison.lan'), 'ok');
    assert.notEqual(await essai('banque.example.com'), 'ok', 'un domaine non déclaré est refusé par la contrainte de noms');
    assert.equal(autorite(dir, dir, ['monsite.fr']).refaite, true, 'nouvelle liste : autorité refaite');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('proxy dans Odin : HTTP et HTTPS de la maison, refus notés, journal masqué, rejeu limité, accord requis', async () => {
  pHttp = await ecouter(amont); pHttps = await ecouter(amontTls);
  reseauAchille({ resoudre, connecter: (_h, port) => netConnect({ host: '127.0.0.1', port: port === 443 ? pHttps : pHttp }) });
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { notify: async () => {}, autonomy: () => 'equilibre' } as never);
  const m = v.modules().find((x) => x.id === 'achille')!, ctx = v.ctx('achille');
  const evts: string[] = []; v.events.on('event', (e: { module: string; type: string }) => { if (e.module === 'achille') evts.push(e.type); });
  try {
    ctx.saveSettings({ portProxy: 0, ecoute: '127.0.0.1' });
    for (const a of ['allumer_proxy', 'declarer_domaine', 'verifier_domaine', 'ajouter_appareil', 'rejouer']) assert.ok(m.actions.find((x) => x.id === a)!.grave?.({ domaine: 'x.fr', adresse: '1.2.3.4', url: 'http://x' }, ctx), `${a} est grave`);
    assert.equal((await v.act('achille', 'allumer_proxy', {}, { auto: true })).ok, false, 'pas depuis une automatisation');
    const r = await v.act('achille', 'allumer_proxy', { duree_h: 1 }); assert.equal(r.ok, true, r.text);
    const port = (r.data as { port: number }).port;
    assert.ok(evts.includes('proxy_allume'));
    // HTTP vers la maison : transmis, secrets masqués au journal.
    const brut = async (texte: string) => { const s = netConnect({ host: '127.0.0.1', port }); s.write(texte); let out = ''; for await (const c of s) out += c; return out; };
    const ok = await brut('GET http://site.maison.lan/page?token=abc&x=1 HTTP/1.1\r\nHost: site.maison.lan\r\nAuthorization: Bearer tresSecret\r\nCookie: sid=zzz\r\nConnection: close\r\n\r\n');
    assert.match(ok, /^HTTP\/1\.1 200/); assert.match(ok, /Ma page/);
    assert.equal(vus.at(-1)!.authorization, 'Bearer tresSecret', 'la requête part telle quelle vers ton site');
    const j = readFileSync(join(ctx.dir, 'journal.jsonl'), 'utf8');
    assert.doesNotMatch(j, /tresSecret|sid=zzz|token=abc|abc123/); assert.match(j, /●●●●/);
    // Hors portée : 403, noté au journal.
    const non = await brut('GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
    assert.match(non, /^HTTP\/1\.1 403/); assert.match(non, /hors de ta portée/);
    const non2 = await brut('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
    assert.match(non2, /403/);
    const non3 = await brut('CONNECT 169.254.169.254:443 HTTP/1.1\r\nHost: 169.254.169.254:443\r\n\r\n'); assert.match(non3, /403/);
    const lignes = readFileSync(join(ctx.dir, 'journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { genre: string });
    assert.ok(lignes.filter((l) => l.genre === 'refus').length >= 3); assert.ok(evts.includes('refus_hors_portee'));
    // HTTPS intercepté : certificat signé par l'autorité d'Achille.
    const ca = autorite(ctx.dir, ctx.home, []).cert;
    const s = netConnect({ host: '127.0.0.1', port }); s.write('CONNECT site.maison.lan:443 HTTP/1.1\r\nHost: site.maison.lan:443\r\n\r\n');
    await new Promise<void>((okk) => { let b = ''; const f = (c: Buffer) => { b += c; if (b.includes('\r\n\r\n')) { s.off('data', f); assert.match(b, /^HTTP\/1\.1 200/); okk(); } }; s.on('data', f); });
    const t = tlsConnect({ socket: s, servername: 'site.maison.lan', ca });
    await once(t, 'secureConnect');
    assert.equal(t.authorized, true, String(t.authorizationError));
    assert.match(String(t.getPeerCertificate().issuer.CN), /Achille/);
    t.write('GET / HTTP/1.1\r\nHost: autre-site.com\r\nConnection: close\r\n\r\n');
    let rep = ''; for await (const c of t) rep += c;
    assert.match(rep, /bonjour en https/, 'le Host ne change pas la cible : c\'est l\'hôte du CONNECT');
    const ex = proxyAchille()!.echanges.at(-1)!;
    assert.match(ex.certInvalide ?? '', /./, 'certificat invalide d\'une adresse privée : accepté mais noté');
    assert.ok(ex.defauts.some((d) => d.code === 'certificat-invalide'));
    // Les défauts de la page HTTP ont été relevés.
    assert.ok(evts.includes('defaut_trouve'));
    // Rejeu : une requête par seconde, puis le plafond du jour.
    const premier = proxyAchille()!.echanges.find((e) => e.url.startsWith('http://site.maison.lan'))!;
    const r1 = await v.act('achille', 'rejouer', { id: premier.id }); assert.equal(r1.ok, true, r1.text);
    const r2 = await v.act('achille', 'rejouer', { id: premier.id }); assert.equal(r2.ok, false); assert.match(r2.text, /par seconde/);
    await new Promise((w) => setTimeout(w, 1100));
    ctx.saveSettings({ rejeux: { jour: new Date().toISOString().slice(0, 10), n: 300 } });
    const r3 = await v.act('achille', 'rejouer', { id: premier.id }); assert.equal(r3.ok, false); assert.match(r3.text, /Plafond/);
    ctx.saveSettings({ rejeux: undefined });
    await new Promise((w) => setTimeout(w, 1100));
    const r4 = await v.act('achille', 'rejouer', { url: 'http://example.com/' }); assert.equal(r4.ok, false); assert.match(r4.text, /hors de ta portée/);
    // Rejeu vers la machine d'Odin : un service en essai (port 3000) est permis, l'interface d'Odin (8888) jamais.
    const r5 = await v.act('achille', 'rejouer', { url: 'http://127.0.0.1:8888/' }); assert.equal(r5.ok, false); assert.match(r5.text, /interface d'Odin/);
    const r6 = await v.act('achille', 'rejouer', { url: 'http://127.0.0.1:3000/' }); assert.equal(r6.ok, true, r6.text);
    assert.equal((await dansLaPortee('127.0.0.1', { domaines: [], resoudre })).ok, false, 'le proxy d\'interception, lui, refuse toujours la boucle locale');
    // Domaine prouvé par TXT via l'appli.
    const d = await v.act('achille', 'declarer_domaine', { domaine: 'monsite.fr' });
    TXT['_odin-achille.monsite.fr'] = [(d.data as { jeton: string }).jeton];
    assert.equal((await v.act('achille', 'verifier_domaine', { domaine: 'monsite.fr' })).ok, true);
    assert.equal(ctx.settings.caAReinstaller, true, 'la page dit de réinstaller le certificat');
    // Appareils : seulement de la maison ; certificat remis en fichier.
    assert.equal((await v.act('achille', 'ajouter_appareil', { adresse: '8.8.8.8' })).ok, false);
    assert.equal((await v.act('achille', 'ajouter_appareil', { adresse: '192.168.1.20' })).ok, true);
    const c = await v.act('achille', 'certificat'); assert.equal(c.fichiers?.[0].ref, 'autorite'); assert.match(readFileSync(m.retrait!(ctx, 'autorite')!, 'utf8'), /BEGIN CERTIFICATE/);
    // La page s'affiche sans valeur cassée.
    assert.doesNotMatch(JSON.stringify(await m.view(ctx, new URLSearchParams())), /undefined|NaN|\[object Object\]/);
    assert.equal((await v.act('achille', 'eteindre_proxy')).ok, true); assert.equal(proxyAchille()!.allume, false); assert.ok(evts.includes('proxy_eteint'));
  } finally { v.stop(); reseauAchille(); }
});

test('proxy : appareil non autorisé refusé, extinction automatique', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'achille-px-')), journal: Array<{ genre: string; raison?: string }> = [];
  let arret = '';
  const px = new ProxyAchille({ port: 0, hote: '127.0.0.1', boucleLocale: false, portee: (h) => dansLaPortee(h, { domaines: [], resoudre }), appareils: () => ['192.168.1.20'], autorite: () => autorite(dir, dir, []), noter: (l) => journal.push(l), surArret: (p) => { arret = p; } });
  try {
    const port = await px.allumer(400);
    const s = netConnect({ host: '127.0.0.1', port }); s.write('GET http://site.maison.lan/ HTTP/1.1\r\nHost: site.maison.lan\r\nConnection: close\r\n\r\n');
    let out = ''; for await (const c of s) out += c;
    assert.match(out, /403/); assert.match(out, /appareil non autorisé/);
    assert.ok(journal.some((l) => l.genre === 'refus' && /appareil/.test(l.raison ?? '')));
    await new Promise((w) => setTimeout(w, 700));
    assert.equal(px.allume, false); assert.equal(arret, 'délai écoulé');
  } finally { px.eteindre(); rmSync(dir, { recursive: true, force: true }); }
});

test('contrôles passifs sur une page d\'exemple', () => {
  const d = controler({ url: 'https://site.maison.lan/', code: 200, entetes: { 'content-type': 'text/html', server: 'nginx/1.18.0', 'set-cookie': ['sid=1; Path=/; Secure'], 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' }, corps: PAGE.replace('</body>', '<script src="http://cdn.exemple/x.js"></script></body>') }, new Date('2026-11-16'));
  const codes = d.map((x) => x.code);
  for (const c of ['csp', 'hsts', 'nosniff', 'cadre', 'referrer', 'cookie:sid', 'formulaire', 'version:server', 'generator', 'mixte', 'cors']) assert.ok(codes.includes(c), c);
  assert.equal(d[0].niveau, 'haut', 'le plus grave d\'abord');
  assert.ok(d.every((x) => x.conseil.length > 20));
  const propre = controler({ url: 'https://a.lan/', code: 200, entetes: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'strict-transport-security': 'max-age=1', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }, corps: '<html><form method="post"><input type="hidden" name="csrf_token" value="x"></form></html>' });
  assert.deepEqual(propre, []);
  assert.ok(controler({ url: 'https://a.lan/', code: 200, entetes: {}, certFin: '2026-11-20T00:00:00Z' }, new Date('2026-11-16')).some((x) => x.code === 'certificat'));
});

test('outils : encodeur, décodeur, JWT non vérifié, comparaison, masquage', () => {
  for (const f of ['base64', 'base64url', 'url', 'html', 'hex'] as const) assert.equal(decoder(f, encoder(f, 'é<a href="x">&</a> ?')), 'é<a href="x">&</a> ?', f);
  assert.equal(encoder('html', '<b>'), '&lt;b&gt;');
  assert.throws(() => decoder('hex', 'zz'));
  const jwt = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"sub":"moi","exp":1800000000}').toString('base64url')}.signature`;
  const j = lireJwt(jwt); assert.deepEqual(j.charge, { sub: 'moi', exp: 1800000000 }); assert.match(j.note, /NON vérifiée/); assert.ok(j.expire);
  const d = comparer({ code: 200, entetes: { a: '1', b: '2' }, corps: 'x\ny\nz' }, { code: 404, entetes: { a: '1', c: '3' }, corps: 'x\nY\nz' });
  assert.deepEqual(d.code, [200, 404]); assert.deepEqual(d.entetes.map((e) => e.nom), ['b', 'c']);
  assert.deepEqual(d.lignes.filter((l) => l.genre !== '=').map((l) => `${l.genre}${l.texte}`), ['-y', '+Y']);
  assert.equal(comparer({ code: 200, entetes: {}, corps: 'a' }, { code: 200, entetes: {}, corps: 'a' }).identiques, true);
  assert.deepEqual(masquerEntetes({ Authorization: 'Bearer x', Cookie: 'a', 'X-Api-Key': 'k', 'X-Session-Id': 's', Accept: '*/*' }), { authorization: '●●●●', cookie: '●●●●', 'x-api-key': '●●●●', 'x-session-id': '●●●●', accept: '*/*' });
  assert.equal(masquerUrl('https://moi:pw@a.lan/x?token=abc&page=2&api_key=z'), 'https://a.lan/x?token=●●●●&page=2&api_key=●●●●');
});
