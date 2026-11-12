// Víðarr, le DNS d'Odin, de A à Z : format des messages, règles et listes, serveur (cache, blocage, alias,
// noms de la maison, réglages par appareil, pause, menaces, limite), amont chiffré (HTTPS, TLS),
// résolution autonome depuis la racine, appli (actions, journal, statistiques) et lien avec le VPN Gjöll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RCODE, TYPE, dataText, ipv6Text, parse, query, rdata, readName, respond, reuse, minTtl } from '../src/valhalla/vidarr/wire.ts';
import { SERVICES, compile, judge, safeSearchFor, servicesList } from '../src/valhalla/vidarr/rules.ts';
import { DnsServer, DEFAULTS, ipMatches, type DnsSettings, type LogEntry, type Lists } from '../src/valhalla/vidarr/server.ts';
import { exchangeTcp, exchangeTls, exchangeUdp, forward, parseUpstream, recurse } from '../src/valhalla/vidarr/resolve.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { stats } from '../src/valhalla/modules/vidarr.ts';
import { setTunFactory } from '../src/valhalla/modules/gjoll.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

test('format DNS : question, réponse, noms compressés, durées de vie, adresses v6', () => {
  const q = parse(query('Exemple.FR', TYPE.AAAA, { id: 4242 }));
  assert.deepEqual([q.id, q.rd, q.qd[0].name, q.qd[0].type, q.ar[0].type], [4242, true, 'exemple.fr', TYPE.AAAA, TYPE.OPT]);
  const r = respond(q, { an: [{ name: 'exemple.fr', type: TYPE.CNAME, ttl: 300, data: rdata.name('cdn.exemple.net') }, { name: 'cdn.exemple.net', type: TYPE.AAAA, ttl: 60, data: rdata.aaaa('2001:db8::1') }] });
  const m = parse(r);
  assert.deepEqual([m.qr, m.id, m.an.length, dataText(r, m.an[0]), dataText(r, m.an[1]), minTtl(m)], [true, 4242, 2, 'cdn.exemple.net', '2001:db8::1', 60]);
  // Un nom compressé (pointeur vers la question) se lit.
  const comp = Buffer.concat([r.subarray(0, 12 + 12), Buffer.from([0xc0, 12])]);
  assert.equal(readName(comp, 24).name, 'exemple.fr');
  assert.throws(() => readName(Buffer.from([0xc0, 0]), 0), /nom invalide/, 'pointeur en boucle refusé');
  const aged = parse(reuse(r, 7, 50, 0)); assert.deepEqual([aged.id, aged.an[0].ttl, aged.an[1].ttl], [7, 250, 10]);
  assert.equal(ipv6Text(rdata.aaaa('fe80::1:2')), 'fe80::1:2');
  const nx = parse(respond(q, { rcode: RCODE.NXDOMAIN, ns: [{ name: 'fr', type: TYPE.SOA, ttl: 3600, data: rdata.soa('ns.fr', 'admin.fr', 1, 120) }] }));
  assert.equal(minTtl(nx), 120, 'réponse négative gardée le minimum du SOA');
});

test('règles : listes hosts, domaines, ||…^, exceptions, expressions, jokers, réécritures, modificateurs inconnus ignorés', () => {
  const c = compile([
    '# commentaire', '! autre commentaire', '0.0.0.0 pub.exemple.fr pixel.exemple.fr', '127.0.0.1 localhost', '0.0.0.0 0.0.0.0',
    '||traqueur.net^', '@@||ok.traqueur.net^', '/^ads[0-9]+\\./', '*.joker.fr', 'seul.fr', '||important.fr^$important', '@@||important.fr^',
    '||tiers.fr^$third-party', '||reecrit.lan^$dnsrewrite=192.168.1.5', '192.168.1.9 nas.maison',
  ].join('\n'));
  const v = (n: string) => judge(c, n, 'L');
  assert.deepEqual([v('pub.exemple.fr')?.action, v('x.pub.exemple.fr'), v('localhost'), v('exemple.fr')], ['block', undefined, undefined, undefined], 'hosts : domaine exact');
  assert.equal(v('a.b.traqueur.net')?.action, 'block'); assert.equal(v('ok.traqueur.net')?.action, 'allow'); assert.equal(v('x.ok.traqueur.net')?.action, 'allow');
  assert.equal(v('ads12.site.fr')?.rule, '/^ads[0-9]+\\./'); assert.equal(v('ads.site.fr'), undefined);
  assert.equal(v('a.joker.fr')?.action, 'block'); assert.equal(v('joker.fr'), undefined, '*.x : les sous-domaines seulement');
  assert.equal(v('seul.fr')?.action, 'block'); assert.equal(v('sous.seul.fr'), undefined);
  assert.equal(v('important.fr')?.action, 'block', '$important passe avant l\'exception');
  assert.equal(v('tiers.fr'), undefined, 'modificateur inconnu : règle ignorée plutôt que de trop bloquer');
  assert.deepEqual((v('reecrit.lan') as { to: string[] }).to, ['192.168.1.5']); assert.deepEqual((v('nas.maison') as { to: string[] }).to, ['192.168.1.9']);
  assert.equal(judge(servicesList(['tiktok']), 'v16.tiktokcdn.com', 'S')?.action, 'block');
  assert.ok(Object.keys(SERVICES).length >= 25);
  assert.equal(safeSearchFor('www.google.fr')?.to, 'forcesafesearch.google.com'); assert.equal(safeSearchFor('m.youtube.com')?.to, 'restrictmoderate.youtube.com'); assert.equal(safeSearchFor('google.evil.fr'), undefined);
  assert.ok(ipMatches('10.8.0.0/24', '10.8.0.7') && !ipMatches('10.8.0.0/24', '10.8.1.7') && ipMatches('192.168.1.5', '::ffff:192.168.1.5'));
  assert.deepEqual(parseUpstream('tls://9.9.9.9@dns.quad9.net'), { kind: 'tls', host: '9.9.9.9', port: 853, servername: 'dns.quad9.net', label: 'tls://9.9.9.9@dns.quad9.net' });
  assert.equal(parseUpstream('https://dns.quad9.net/dns-query').kind, 'https'); assert.equal(parseUpstream('1.1.1.1').port, 53); assert.equal(parseUpstream('récursif').kind, 'recursif');
  assert.throws(() => parseUpstream('pas un serveur!'), /invalide/);
});

/** Un faux fournisseur DNS : il répond à tout, compte les questions, et sait servir des alias. */
async function fakeUpstream(table: Record<string, Array<{ type: number; data: Buffer; name?: string; ttl?: number }>> = {}, big = false) {
  const s = dgram.createSocket('udp4'), asked: string[] = [];
  s.on('message', (m, r) => {
    const q = parse(m), n = q.qd[0].name; asked.push(`${n}/${q.qd[0].type}`);
    const an = (table[n] ?? [{ type: TYPE.A, data: rdata.a('93.184.216.34') }]).filter((x) => x.type === q.qd[0].type || x.type === TYPE.CNAME).map((x) => ({ name: x.name ?? n, type: x.type, ttl: x.ttl ?? 120, data: x.data }));
    if (big && q.qd[0].type === TYPE.TXT) for (let i = 0; i < 20; i++) an.push({ name: n, type: TYPE.TXT, ttl: 60, data: rdata.txt('x'.repeat(100)) });
    s.send(respond(q, { an }), r.port, r.address);
  });
  await new Promise<void>((ok) => s.bind(0, '127.0.0.1', () => ok()));
  return { asked, up: `udp://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => s.close() };
}
async function server(set: Partial<DnsSettings>, lists: Lists[] = [], more: Partial<ConstructorParameters<typeof DnsServer>[0]> = {}) {
  const logs: LogEntry[] = [], threats: LogEntry[] = [], floods: string[] = [], st: DnsSettings = { ...DEFAULTS, fallback: [], ...set };
  const d = new DnsServer({ settings: () => st, lists: () => lists, log: (e) => logs.push(e), onThreat: (e) => threats.push(e), onFlood: (ip) => floods.push(ip), ...more });
  await d.start(0, ['127.0.0.1']);
  const ask = async (name: string, type = TYPE.A, o: { from?: string; tcp?: boolean; edns?: boolean } = {}) => {
    const q = query(name, type, { edns: o.edns });
    const raw = o.tcp ? await exchangeTcp(q, '127.0.0.1', d.port) : await new Promise<Buffer>((ok, ko) => {
      const c = dgram.createSocket('udp4'); const t = setTimeout(() => { c.close(); ko(new Error('pas de réponse')); }, 1500);
      c.on('message', (m) => { clearTimeout(t); c.close(); ok(m); }); c.bind(0, o.from ?? '127.0.0.1', () => c.send(q, d.port, '127.0.0.1'));
    });
    const m = parse(raw); return { m, rcode: m.rcode, tc: m.tc, an: m.an.map((r) => dataText(raw, r)) };
  };
  return { d, st, logs, threats, floods, ask, end: () => d.stop() };
}

test('serveur : réponse, cache, blocage (trois façons), alias démasqués, TCP, réponse trop longue, ANY, noms privés', async () => {
  const up = await fakeUpstream({ 'alias.exemple.fr': [{ type: TYPE.CNAME, data: rdata.name('pixel.traqueur.net') }, { name: 'pixel.traqueur.net', type: TYPE.A, data: rdata.a('5.6.7.8') }], 'gros.fr': [] }, true);
  const x = await server({ upstreams: [up.up] }, [{ name: 'Pubs', kind: 'blocage', c: compile('||traqueur.net^\n0.0.0.0 pub.fr') }]);
  try {
    assert.deepEqual((await x.ask('exemple.fr')).an, ['93.184.216.34']);
    assert.deepEqual((await x.ask('exemple.fr')).an, ['93.184.216.34']); assert.equal(up.asked.length, 1, 'la 2e fois : le cache');
    assert.deepEqual(x.logs.map((l) => l.status), ['ok', 'cache']);
    assert.deepEqual((await x.ask('pub.fr')).an, ['0.0.0.0']); assert.deepEqual((await x.ask('pub.fr', TYPE.AAAA)).an, ['::']);
    assert.deepEqual((await x.ask('alias.exemple.fr')).an, ['0.0.0.0'], 'pisteur caché derrière un alias');
    assert.match(x.logs.at(-1)!.rule!, /^alias pixel\.traqueur\.net : \|\|traqueur\.net\^$/);
    x.st.mode = 'nxdomain'; assert.equal((await x.ask('pub.fr')).rcode, RCODE.NXDOMAIN);
    x.st.mode = 'refuse'; assert.equal((await x.ask('pub.fr')).rcode, RCODE.REFUSED);
    assert.deepEqual((await x.ask('exemple.fr', TYPE.A, { tcp: true })).an, ['93.184.216.34'], 'TCP');
    const small = await x.ask('gros.fr', TYPE.TXT, { edns: false }); assert.equal(small.tc, true, 'trop long pour l\'UDP sans EDNS : tronqué');
    assert.equal((await x.ask('gros.fr', TYPE.TXT, { tcp: true })).an.length, 20, 'en TCP : tout');
    assert.equal((await x.ask('exemple.fr', TYPE.ANY)).rcode, RCODE.NOTIMP);
    assert.equal((await x.ask('nas')).rcode, RCODE.NXDOMAIN); assert.equal((await x.ask('5.1.168.192.in-addr.arpa', TYPE.PTR)).rcode, RCODE.NXDOMAIN);
    assert.ok(!up.asked.some((a) => a.startsWith('nas/') || a.includes('in-addr')), 'les noms privés ne sont jamais partis dehors');
  } finally { x.end(); up.close(); }
});

test('serveur : noms de la maison, recherche sécurisée, services, réglages par appareil, pause, menaces, limite', async () => {
  const up = await fakeUpstream({ 'forcesafesearch.google.com': [{ type: TYPE.A, data: rdata.a('216.239.38.120') }] });
  const lists: Lists[] = [{ name: 'Pubs', kind: 'blocage', c: compile('||pub.fr^') }, { name: 'Dangereux', kind: 'menace', c: compile('0.0.0.0 virus.example') }, { name: 'Adultes', kind: 'parental', c: compile('0.0.0.0 adulte.example') }];
  const x = await server({ upstreams: [up.up], rewrites: { 'nas.maison': ['192.168.1.10'], '*.labo.maison': ['192.168.1.20'], 'tele.maison': ['nas.maison'] }, rateLimit: 0 }, lists);
  try {
    assert.deepEqual((await x.ask('nas.maison')).an, ['192.168.1.10']); assert.deepEqual((await x.ask('srv.labo.maison')).an, ['192.168.1.20']);
    assert.deepEqual((await x.ask('tele.maison')).an, ['nas.maison', '192.168.1.10'], 'alias vers un nom de la maison');
    x.st.safeSearch = true; assert.deepEqual((await x.ask('www.google.fr')).an, ['forcesafesearch.google.com', '216.239.38.120']); x.st.safeSearch = false;
    x.st.services = ['tiktok']; assert.deepEqual((await x.ask('www.tiktok.com')).an, ['0.0.0.0']); x.st.services = [];
    // Appareil 127.0.0.2 : sans filtrage ; 127.0.0.3 : contrôle parental, YouTube coupé ; 127.0.0.4 : seulement l'école.
    x.st.clients = [{ id: 'pc', name: 'PC papa', ids: ['127.0.0.2'], filtering: 'non' }, { id: 'tab', name: 'Tablette', ids: ['127.0.0.3'], parental: true, services: ['youtube'] }, { id: 'ecole', name: 'Ordi école', ids: ['127.0.0.4'], onlyThese: ['education.gouv.fr'] }];
    assert.deepEqual((await x.ask('pub.fr', TYPE.A, { from: '127.0.0.2' })).an, ['93.184.216.34'], 'filtrage coupé pour cet appareil');
    assert.deepEqual((await x.ask('virus.example', TYPE.A, { from: '127.0.0.2' })).an, ['0.0.0.0'], 'les menaces restent bloquées pour tous');
    assert.deepEqual((await x.ask('adulte.example')).an, ['93.184.216.34']); assert.deepEqual((await x.ask('adulte.example', TYPE.A, { from: '127.0.0.3' })).an, ['0.0.0.0']);
    assert.deepEqual((await x.ask('youtube.com', TYPE.A, { from: '127.0.0.3' })).an, ['0.0.0.0']);
    assert.deepEqual((await x.ask('www.education.gouv.fr', TYPE.A, { from: '127.0.0.4' })).an, ['93.184.216.34']); assert.deepEqual((await x.ask('jeux.fr', TYPE.A, { from: '127.0.0.4' })).an, ['0.0.0.0']);
    assert.equal(x.logs.find((l) => l.client === '127.0.0.3')?.clientName, 'Tablette');
    // Menace : alerte (une fois par demande), avec l'appareil.
    assert.equal(x.threats.length, 1); assert.equal(x.threats[0].client, '127.0.0.2');
    // Pause : les pubs passent, les menaces non.
    x.st.pausedUntil = Date.now() + 60_000; assert.deepEqual((await x.ask('pub.fr')).an, ['93.184.216.34']); assert.deepEqual((await x.ask('virus.example')).an, ['0.0.0.0']); x.st.pausedUntil = undefined;
    // Règles perso : exception plus forte que les listes, blocage d'un domaine.
    x.st.custom = ['@@||pub.fr^', '||perso.fr^']; assert.deepEqual((await x.ask('pub.fr')).an, ['93.184.216.34']); assert.deepEqual((await x.ask('a.perso.fr')).an, ['0.0.0.0']);
    // Limite : une machine qui inonde est ignorée et signalée (une seule fois).
    x.st.rateLimit = 5; for (let i = 0; i < 12; i++) await x.ask(`n${i}.flood.fr`).catch(() => undefined);
    assert.deepEqual(x.floods, ['127.0.0.1']);
  } finally { x.end(); up.close(); }
});

test('amont : chiffré en HTTPS, chiffré en TLS, ordre de secours', async () => {
  const q = query('exemple.fr', TYPE.A), qm = parse(q);
  // HTTPS : le corps est le message DNS (application/dns-message).
  let seen = '';
  const fakeFetch = (async (url: string, init: RequestInit) => { seen = `${url} ${(init.headers as Record<string, string>)['content-type']}`; const asked = parse(Buffer.from(init.body as Uint8Array)); return new Response(new Uint8Array(respond(asked, { an: [{ name: 'exemple.fr', type: TYPE.A, ttl: 60, data: rdata.a('1.2.3.4') }] })), { status: 200 }); }) as unknown as typeof fetch;
  const h = await forward(q, qm, { strategy: 'ordre', upstreams: [parseUpstream('https://dns.exemple/dns-query')], fetch: fakeFetch });
  assert.equal(seen, 'https://dns.exemple/dns-query application/dns-message'); assert.equal(parse(h.raw).id, qm.id, 'l\'identifiant d\'origine est remis'); assert.equal(dataText(h.raw, parse(h.raw).an[0]), '1.2.3.4');
  // Secours : le premier serveur ne répond pas, le suivant si.
  const up = await fakeUpstream();
  try { const r = await forward(q, qm, { strategy: 'ordre', upstreams: [parseUpstream('udp://127.0.0.1:9'), parseUpstream(up.up)], timeoutMs: 400 }); assert.equal(r.upstream, up.up); } finally { up.close(); }
  // TLS : un vrai serveur chiffré local (certificat fait pour l'essai).
  const dir = mkdtempSync(join(tmpdir(), 'dot-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=dns.local', '-addext', 'subjectAltName=DNS:dns.local'], { stdio: 'ignore' });
  } catch { rmSync(dir, { recursive: true, force: true }); return; }
  const srv = tls.createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d: Buffer) => { buf = Buffer.concat([buf, d]); if (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) { const m = parse(buf.subarray(2, 2 + buf.readUInt16BE(0))); const out = respond(m, { an: [{ name: m.qd[0].name, type: TYPE.A, ttl: 60, data: rdata.a('9.9.9.9') }] }); const l = Buffer.alloc(2); l.writeUInt16BE(out.length); sock.write(Buffer.concat([l, out])); } });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  try {
    const port = (srv.address() as { port: number }).port, ca = readFileSync(join(dir, 'c.pem'));
    const r = parse(await exchangeTls(q, '127.0.0.1', port, 'dns.local', 3000, ca)); assert.equal(dataText(r.raw, r.an[0]), '9.9.9.9');
    await assert.rejects(exchangeTls(q, '127.0.0.1', port, 'autre.nom', 3000, ca), /altnames|Hostname|certificate/i, 'nom du certificat vérifié');
  } finally { srv.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('récursif : depuis la racine, délégations avec et sans adresses jointes, alias entre zones, nom inexistant', async () => {
  // Trois « serveurs » : racine (127.0.0.2), .fr (127.0.0.3), exemple.fr (127.0.0.4), et un pour autre.net (127.0.0.5) dont le NS n'a pas d'adresse jointe.
  const sock = dgram.createSocket('udp4'); await new Promise<void>((ok) => sock.bind(0, '127.0.0.1', () => ok()));
  const port = (sock.address() as { port: number }).port; sock.close();
  const zone = (ip: string, answer: (n: string, t: number, q: ReturnType<typeof parse>) => Buffer) => { const s = dgram.createSocket('udp4'); s.on('message', (m, r) => { const q = parse(m); assert.equal(q.rd, false, 'le résolveur ne demande pas la récursion aux serveurs'); s.send(answer(q.qd[0].name, q.qd[0].type, q), r.port, r.address); }); return new Promise<dgram.Socket>((ok) => s.bind(port, ip, () => ok(s))); };
  const ref = (q: ReturnType<typeof parse>, zoneName: string, ns: string, ip?: string) => respond(q, { ns: [{ name: zoneName, type: TYPE.NS, ttl: 3600, data: rdata.name(ns) }], ar: ip ? [{ name: ns, type: TYPE.A, ttl: 3600, data: rdata.a(ip) }] : [], ra: false });
  const servers = await Promise.all([
    zone('127.0.0.2', (n, _t, q) => (n.endsWith('.fr') || n === 'fr' ? ref(q, 'fr', 'ns.nic.fr', '127.0.0.3') : n.endsWith('autre.net') ? ref(q, 'autre.net', 'ns.exemple.fr') : respond(q, { rcode: RCODE.NXDOMAIN, aa: true, ra: false }))),
    zone('127.0.0.3', (n, _t, q) => (n.endsWith('exemple.fr') ? ref(q, 'exemple.fr', 'ns1.exemple.fr', '127.0.0.4') : respond(q, { rcode: RCODE.NXDOMAIN, aa: true, ra: false }))),
    zone('127.0.0.4', (n, t, q) => n === 'www.exemple.fr' && t === TYPE.A ? respond(q, { an: [{ name: n, type: TYPE.A, ttl: 300, data: rdata.a('203.0.113.80') }], aa: true, ra: false })
      : n === 'web.exemple.fr' ? respond(q, { an: [{ name: n, type: TYPE.CNAME, ttl: 300, data: rdata.name('site.autre.net') }], aa: true, ra: false })
      : n === 'ns.exemple.fr' ? respond(q, { an: [{ name: n, type: TYPE.A, ttl: 300, data: rdata.a('127.0.0.5') }], aa: true, ra: false })
      : respond(q, { rcode: RCODE.NXDOMAIN, aa: true, ra: false })),
    zone('127.0.0.5', (n, _t, q) => (n === 'site.autre.net' ? respond(q, { an: [{ name: n, type: TYPE.A, ttl: 300, data: rdata.a('198.51.100.9') }], aa: true, ra: false }) : respond(q, { rcode: RCODE.NXDOMAIN, aa: true, ra: false }))),
  ]);
  const o = { roots: [{ host: '127.0.0.2', port }], ask: (q: Buffer, host: string) => exchangeUdp(q, host, port, 1000) };
  try {
    const a = await recurse('www.exemple.fr', TYPE.A, o); assert.deepEqual(a.an.map((x) => [x.name, [...x.data].join('.')]), [['www.exemple.fr', '203.0.113.80']]);
    const b = await recurse('web.exemple.fr', TYPE.A, o);
    assert.deepEqual(b.an.map((x) => [x.name, x.type]), [['web.exemple.fr', TYPE.CNAME], ['site.autre.net', TYPE.A]], 'alias vers une autre zone, dont le serveur a dû être cherché');
    assert.equal(b.an.length, 2); assert.equal([...b.an[1].data].join('.'), '198.51.100.9');
    assert.equal((await recurse('rien.exemple.fr', TYPE.A, o)).rcode, RCODE.NXDOMAIN);
    // Par le serveur Víðarr, mode « récursif » : réponse complète au client.
    const x = await server({ upstreams: ['récursif'] }, [], { recursive: o });
    try { assert.deepEqual((await x.ask('web.exemple.fr')).an, ['site.autre.net', '198.51.100.9']); } finally { x.end(); }
  } finally { for (const s of servers) s.close(); }
});

test('statistiques : total, bloquées, temps moyen, classements, par heure', () => {
  const now = Date.now(), e = (min: number, name: string, status: LogEntry['status'], client = '192.168.1.5', ms = 10): LogEntry => ({ t: now - min * 60_000, client, name, type: 'A', status, ms, rcode: 'NOERROR' });
  const st = stats([e(5, 'a.fr', 'ok', undefined, 30), e(6, 'pub.fr', 'bloqué'), e(7, 'pub.fr', 'bloqué', '192.168.1.6'), e(8, 'a.fr', 'cache'), e(60 * 30, 'vieux.fr', 'ok')], now);
  assert.deepEqual([st.total, st.blocked, st.blockedPct, st.cached, st.avgMs], [4, 2, 50, 1, 30]);
  assert.deepEqual(st.topBlocked, [['pub.fr', 2]]); assert.deepEqual(st.topDomains, [['a.fr', 2]]); assert.equal(st.perHour.length, 24); assert.equal(st.perHour[23], 4);
});

test('appli Víðarr : démarrer, tester, bloquer, autoriser, listes, services, appareils, noms, pause, journal ; lien avec le VPN', async () => {
  const home = mkdtempSync(join(tmpdir(), 'vidarr-')), up = await fakeUpstream();
  setTunFactory(async () => ({ write: () => {}, onPacket: () => {}, close: () => {} }));
  const fetched: string[] = [];
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async (cmd, args) => ({ code: cmd === 'sh' && /command -v (python3|iptables)/.test(args.join(' ')) ? 0 : 0, out: '', err: '' }),
    fetch: (async (url: string) => { fetched.push(String(url)); return new Response(String(url).includes('urlhaus') ? '0.0.0.0 virus.example\n' : String(url).includes('porn') ? '0.0.0.0 adulte.example\n' : String(url).includes('vide') ? '<html>pas une liste</html>' : '||pub.fr^\n||traqueur.net^\n', { status: 200 }); }) as unknown as typeof fetch,
    notify: async () => {}, autonomy: () => 'equilibre',
  });
  const act = (a: string, i: Record<string, unknown> = {}) => v.act('vidarr', a, i);
  try {
    v.ctx('vidarr').saveSettings({ dns: { ...DEFAULTS, upstreams: [up.up], fallback: [] } });
    assert.match((await act('demarrer', { port: 0 })).text, /Víðarr répond sur le port \d+/);
    assert.match((await act('mettre_a_jour')).text, /✅ Pubs et pisteurs : 2 règles\n✅ Sites dangereux \(virus, hameçonnage\) : 1 règles\n✅ Contrôle parental \(sites pour adultes\) : 1 règles/);
    assert.match((await act('tester', { domaine: 'x.pub.fr' })).text, /^x\.pub\.fr : 🚫 bloqué par « \|\|pub\.fr\^ » \(Pubs et pisteurs\)\nRéponse : 0\.0\.0\.0$/);
    assert.match((await act('tester', { domaine: 'exemple.fr' })).text, /✅ pas de règle, laissé passer\nRéponse : 93\.184\.216\.34/);
    await act('autoriser', { domaine: 'pub.fr' }); assert.match((await act('tester', { domaine: 'pub.fr' })).text, /autorisé par « @@\|\|pub\.fr\^ »/);
    await act('bloquer', { domaine: 'perso.fr' }); assert.match((await act('tester', { domaine: 'a.perso.fr' })).text, /bloqué par « \|\|perso\.fr\^ » \(Règles perso\)/);
    assert.match((await act('regle', { regle: '/^ads[0-9]+\\./' })).text, /Règle ajoutée/); assert.equal((await act('regle', { regle: 'pas une règle !!' })).ok, false);
    const bad = await act('ajouter_liste', { nom: 'Vide', url: 'https://exemple.fr/vide.txt', type: 'blocage' }); assert.equal(bad.ok, false); assert.match(bad.text, /aucune règle comprise/);
    assert.match((await act('services', { service: 'tiktok', coupe: true })).text, /Coupé pour toute la maison : TikTok/);
    assert.match((await act('tester', { domaine: 'www.tiktok.com' })).text, /bloqué.*Services coupés/);
    assert.match((await act('appareil', { nom: 'Tablette', adresses: '192.168.1.30', filtrage: 'global', parental: true, recherche_sure: true, services: 'youtube', amont: '' })).text, /Tablette \(192\.168\.1\.30\) : filtrage global, contrôle parental, recherche sécurisée, services coupés : YouTube/);
    assert.match((await act('tester', { domaine: 'adulte.example', appareil: '192.168.1.30' })).text, /bloqué/); assert.match((await act('tester', { domaine: 'adulte.example' })).text, /laissé passer/);
    assert.equal((await act('appareil', { nom: 'X', adresses: 'pas une ip' })).ok, false);
    assert.match((await act('nom_local', { nom: 'nas.maison', valeur: '192.168.1.10' })).text, /nas\.maison → 192\.168\.1\.10/);
    assert.match((await act('tester', { domaine: 'nas.maison' })).text, /réécrit[\s\S]*Réponse : 192\.168\.1\.10/);
    assert.match((await act('pause', { minutes: 5 })).text, /Blocage en pause 5 min/); assert.match((await act('tester', { domaine: 'x.perso.fr' })).text, /laissé passer/);
    assert.match((await act('tester', { domaine: 'virus.example' })).text, /bloqué/, 'les sites dangereux restent bloqués pendant la pause');
    await act('reprendre');
    assert.match((await act('journal', { filtre: 'pub.fr', statut: 'tous' })).text, /pub\.fr/);
    const view = await v.module('vidarr')!.view(v.ctx('vidarr'), new URLSearchParams());
    assert.ok(view.kpis!.some((k) => k.label === 'Requêtes (24 h)')); assert.ok(view.sections.some((s) => s.title === 'Journal (dernières requêtes)'));
    // Lien Gjöll → Víðarr : un appareil du VPN qui passe par le DNS d'Odin.
    const g = await v.act('gjoll', 'ajouter', { nom: 'Téléphone', tout: true, dns_odin: true });
    assert.match(g.text, /Il passe par le DNS d'Odin \(Víðarr\)/);
    assert.match((g.data as { conf: string }).conf, /DNS = 10\.8\.0\.1\n/, 'le téléphone résout par Odin, à travers le tunnel');
    assert.match((await act('tester', { domaine: 'adulte.example', appareil: '10.8.0.2' })).text, /laissé passer/, 'il suit les réglages de la maison');
    const clients = (v.ctx('vidarr').settings.dns as DnsSettings).clients;
    assert.ok(clients.some((c) => c.name === 'VPN · Téléphone' && c.ids[0] === '10.8.0.2'));
    await v.act('gjoll', 'modifier', { nom: 'Téléphone', nouveau_nom: 'Tel Awa', tout: 'inchangé', maillage: 'inchangé', fin: '', dns_odin: 'inchangé' });
    assert.ok((v.ctx('vidarr').settings.dns as DnsSettings).clients.some((c) => c.name === 'VPN · Tel Awa') && !(v.ctx('vidarr').settings.dns as DnsSettings).clients.some((c) => c.name === 'VPN · Téléphone'), 'renommé des deux côtés');
    await v.act('gjoll', 'revoquer', { nom: 'Tel Awa' });
    assert.ok(!(v.ctx('vidarr').settings.dns as DnsSettings).clients.some((c) => c.name.startsWith('VPN ·')), 'révoqué : oublié de Víðarr aussi');
    assert.match((await act('arreter')).text, /arrêté/);
  } finally { v.stop(); up.close(); rmSync(home, { recursive: true, force: true }); }
});
