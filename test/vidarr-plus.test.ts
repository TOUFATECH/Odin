// Víðarr, le reste : pubs des réseaux (TikTok, YouTube, Instagram : les pubs bloquées, les vidéos passent),
// horaires, enregistrements de la maison (MX, TXT…), serveur DHCP (adresses, adresses fixes, noms servis
// par le DNS, nouvel appareil signalé), DNS chiffré pour les appareils (TLS et HTTPS) et surveillance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TYPE, dataText, parse, query, respond, rdata } from '../src/valhalla/vidarr/wire.ts';
import { SOCIAL_ADS, judge, socialAdsList } from '../src/valhalla/vidarr/rules.ts';
import { DnsServer, DEFAULTS, inSchedule, type DnsSettings } from '../src/valhalla/vidarr/server.ts';
import { exchangeTcp } from '../src/valhalla/vidarr/resolve.ts';
import { DhcpServer, MSG, buildPacket, detectDhcp, parsePacket, type DhcpConfig, type Lease } from '../src/valhalla/vidarr/dhcp.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { setDotMaterial } from '../src/valhalla/modules/vidarr.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { Gateway } from '../src/bifrost/gateway.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { makeOdin } from './helpers.ts';

async function fakeUpstream() {
  const s = dgram.createSocket('udp4'), asked: string[] = [];
  s.on('message', (m, r) => { const q = parse(m); asked.push(q.qd[0].name); s.send(respond(q, { an: q.qd[0].type === TYPE.A ? [{ name: q.qd[0].name, type: TYPE.A, ttl: 60, data: rdata.a('93.184.216.34') }] : [] }), r.port, r.address); });
  await new Promise<void>((ok) => s.bind(0, '127.0.0.1', () => ok()));
  return { asked, up: `udp://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => s.close() };
}
const askUdp = (port: number, name: string, type = TYPE.A) => new Promise<{ an: string[]; rcode: number }>((ok, ko) => {
  const c = dgram.createSocket('udp4'), t = setTimeout(() => { c.close(); ko(new Error('pas de réponse')); }, 1500);
  c.on('message', (m) => { clearTimeout(t); c.close(); const p = parse(m); ok({ an: p.an.map((r) => dataText(m, r)), rcode: p.rcode }); });
  c.send(query(name, type), port, '127.0.0.1');
});

test('pubs des réseaux : les pubs de TikTok, YouTube, Instagram sont bloquées, les vidéos et les photos passent', async () => {
  const c = socialAdsList();
  for (const ad of ['ads.tiktok.com', 'ads-api.tiktokv.com', 'pagead2.googlesyndication.com', 'x.doubleclick.net', 'imasdk.googleapis.com', 'an.facebook.com', 'ads.instagram.com', 'tr.snapchat.com'])
    assert.equal(judge(c, ad, 'P')?.action, 'block', `${ad} : pub`);
  for (const video of ['www.tiktok.com', 'v16-webapp.tiktok.com', 'v16.tiktokcdn.com', 'p16-sign.tiktokcdn-us.com', 'www.youtube.com', 'rr3---sn-a5mekn6s.googlevideo.com', 'i.ytimg.com', 'youtubei.googleapis.com',
    'www.instagram.com', 'scontent-cdg4-1.cdninstagram.com', 'graph.instagram.com', 'www.facebook.com', 'video.xx.fbcdn.net', 'web.whatsapp.com', 'www.snapchat.com', 'www.google.com', 'fonts.googleapis.com'])
    assert.equal(judge(c, video, 'P'), undefined, `${video} : contenu, doit passer`);
  assert.ok(SOCIAL_ADS.google.limit && SOCIAL_ADS.tiktok.limit && SOCIAL_ADS.meta.limit, 'Odin dit honnêtement ce qu\'un DNS ne peut pas enlever');
  // Dans le serveur : actif par défaut, on peut épargner une plateforme, et la pause n'y touche pas différemment des autres pubs.
  const up = await fakeUpstream(), st: DnsSettings = { ...DEFAULTS, upstreams: [up.up], fallback: [] };
  const d = new DnsServer({ settings: () => st, lists: () => [], log: () => {} });
  await d.start(0, ['127.0.0.1']);
  try {
    assert.deepEqual((await askUdp(d.port, 'ads.tiktok.com')).an, ['0.0.0.0']);
    assert.deepEqual((await askUdp(d.port, 'v16.tiktokcdn.com')).an, ['93.184.216.34'], 'les vidéos TikTok passent');
    assert.deepEqual((await askUdp(d.port, 'rr1---sn-x.googlevideo.com')).an, ['93.184.216.34'], 'les vidéos YouTube passent');
    assert.deepEqual((await askUdp(d.port, 'scontent.cdninstagram.com')).an, ['93.184.216.34'], 'les photos Instagram passent');
    st.socialAdsOff = ['tiktok']; d.cache.clear();
    assert.deepEqual((await askUdp(d.port, 'ads.tiktok.com')).an, ['93.184.216.34'], 'TikTok épargné à la demande');
    assert.deepEqual((await askUdp(d.port, 'an.facebook.com')).an, ['0.0.0.0'], 'les autres restent bloqués');
    st.socialAds = false; d.cache.clear(); assert.deepEqual((await askUdp(d.port, 'an.facebook.com')).an, ['93.184.216.34']);
  } finally { d.stop(); up.close(); }
});

test('horaires : plage du jour, plage qui passe minuit, jours choisis ; services coupés seulement pendant la plage', async () => {
  const school = { days: [1, 2, 3, 4, 5], from: '08:00', to: '16:30' }, night = { days: [0, 1, 2, 3, 4], from: '21:00', to: '07:00' };
  const at = (s: string) => new Date(s);
  assert.equal(inSchedule(school, at('2026-11-09T10:00:00')), true, 'lundi 10 h');
  assert.equal(inSchedule(school, at('2026-11-09T16:30:00')), false, 'la fin est exclue');
  assert.equal(inSchedule(school, at('2026-11-08T10:00:00')), false, 'dimanche');
  assert.equal(inSchedule(night, at('2026-11-08T22:00:00')), true, 'dimanche soir');
  assert.equal(inSchedule(night, at('2026-11-09T06:59:00')), true, 'lundi petit matin : suite du dimanche soir');
  assert.equal(inSchedule(night, at('2026-11-14T06:00:00')), false, 'samedi matin : vendredi n\'est pas prévu');
  assert.equal(inSchedule(night, at('2026-11-13T06:00:00')), true, 'vendredi matin : suite du jeudi');
  assert.equal(inSchedule(undefined, at('2026-11-14T06:00:00')), true, 'sans horaire : tout le temps');
  // Dans le serveur, avec une horloge choisie.
  const up = await fakeUpstream(); let now = at('2026-11-09T10:00:00');
  const st: DnsSettings = { ...DEFAULTS, upstreams: [up.up], fallback: [], services: ['tiktok'], servicesSchedule: school };
  const d = new DnsServer({ settings: () => st, lists: () => [], log: () => {}, now: () => now } as never);
  await d.start(0, ['127.0.0.1']);
  try {
    assert.deepEqual((await askUdp(d.port, 'www.tiktok.com')).an, ['0.0.0.0'], 'lundi 10 h : coupé');
    now = at('2026-11-09T18:00:00'); d.cache.clear();
    assert.deepEqual((await askUdp(d.port, 'www.tiktok.com')).an, ['93.184.216.34'], 'lundi 18 h : ouvert');
  } finally { d.stop(); up.close(); }
});

/** Un appareil DHCP simulé : il parle au serveur d'Odin sur des ports de test. */
async function device(serverPort: number) {
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: true }), inbox: ReturnType<typeof parsePacket>[] = [];
  s.on('message', (m) => inbox.push(parsePacket(m)));
  await new Promise<void>((ok) => s.bind(0, '127.0.0.1', () => ok()));
  const port = (s.address() as { port: number }).port;
  const send = async (mac: string, type: number, opts: Array<[number, Buffer]> = [], ciaddr = '0.0.0.0') => {
    const xid = Math.floor(Math.random() * 1e9), before = inbox.length;
    s.send(buildPacket({ op: 1, xid, mac, ciaddr, options: [[53, Buffer.from([type])], ...opts] }), serverPort, '127.0.0.1');
    const until = Date.now() + 800;
    while (Date.now() < until) { const r = inbox.slice(before).find((p) => p.xid === xid); if (r) return r; await new Promise((ok) => setTimeout(ok, 10)); }
    return undefined;
  };
  return { port, send, close: () => s.close() };
}
const ip4 = (s: string) => Buffer.from(s.split('.').map(Number));

test('DHCP : DISCOVER → OFFER → REQUEST → ACK, adresse fixe, refus, libération, nom de l\'appareil, autre serveur détecté', async () => {
  let leases: Lease[] = []; const seen: Array<[string, boolean]> = [];
  const cfg: DhcpConfig = { server: '127.0.0.1', start: '192.168.50.100', end: '192.168.50.102', mask: '255.255.255.0', router: '192.168.50.1', dns: ['192.168.50.2'], leaseSeconds: 3600, domain: 'maison', fixed: [{ mac: 'aa:aa:aa:aa:aa:01', ip: '192.168.50.20', name: 'Imprimante' }] };
  const srv = new DhcpServer({ config: () => cfg, leases: () => leases, save: (l) => { leases = l; }, onLease: (l, n) => seen.push([l.mac, n]) });
  // Le client écoute sur un port au hasard : le serveur lui répond là (ports de test, pas 67/68).
  const dev = await device(0);
  await srv.start(0, dev.port, '127.0.0.1');
  const sp = (srv.sock!.address() as { port: number }).port;
  const d2 = await device(sp); dev.close();
  srv.clientPort = d2.port;
  // L'appareil n'a pas encore d'adresse : la réponse part à tout le réseau (255.255.255.255) ; ici on la fait revenir en direct.
  (srv as unknown as { sock: dgram.Socket }).sock.send = ((orig) => function (this: dgram.Socket, b: Buffer, p: number, _h: string) { return (orig as (...a: unknown[]) => unknown).call(this, b, p, '127.0.0.1'); })(srv.sock!.send) as never;
  try {
    const phone = '02:11:22:33:44:55';
    const offer = await d2.send(phone, MSG.DISCOVER, [[12, Buffer.from('Téléphone de Awa')]]);
    assert.equal(offer?.options.get(53)?.[0], MSG.OFFER); assert.equal(offer?.yiaddr, '192.168.50.100');
    assert.deepEqual([...offer!.options.get(3)!], [192, 168, 50, 1], 'passerelle'); assert.deepEqual([...offer!.options.get(6)!], [192, 168, 50, 2], 'DNS');
    assert.equal(offer!.options.get(51)!.readUInt32BE(0), 3600); assert.equal(offer!.options.get(15)!.toString(), 'maison');
    const ack = await d2.send(phone, MSG.REQUEST, [[50, ip4('192.168.50.100')], [54, ip4('127.0.0.1')], [12, Buffer.from('Téléphone de Awa')]]);
    assert.equal(ack?.options.get(53)?.[0], MSG.ACK); assert.equal(ack?.yiaddr, '192.168.50.100');
    assert.deepEqual(leases.map((l) => [l.mac, l.ip, l.name]), [[phone, '192.168.50.100', 'Téléphone de Awa']]); assert.deepEqual(seen, [[phone, true]]);
    // Renouvellement : même adresse, pas « nouveau ».
    await d2.send(phone, MSG.REQUEST, [[50, ip4('192.168.50.100')]]); assert.deepEqual(seen.at(-1), [phone, false]);
    // Adresse fixe.
    const pr = await d2.send('aa:aa:aa:aa:aa:01', MSG.DISCOVER); assert.equal(pr?.yiaddr, '192.168.50.20');
    await d2.send('aa:aa:aa:aa:aa:01', MSG.REQUEST, [[50, ip4('192.168.50.20')]]); assert.equal(leases.find((l) => l.mac === 'aa:aa:aa:aa:aa:01')?.name, 'Imprimante');
    // Une adresse déjà prise par un autre : refus (NAK).
    const nak = await d2.send('02:00:00:00:00:09', MSG.REQUEST, [[50, ip4('192.168.50.100')]]); assert.equal(nak?.options.get(53)?.[0], MSG.NAK);
    // Hors plage : refus.
    assert.equal((await d2.send('02:00:00:00:00:09', MSG.REQUEST, [[50, ip4('10.0.0.5')]]))?.options.get(53)?.[0], MSG.NAK);
    // Il a choisi un autre serveur : on se tait.
    assert.equal(await d2.send('02:00:00:00:00:09', MSG.REQUEST, [[50, ip4('192.168.50.101')], [54, ip4('192.168.50.1')]]), undefined);
    // Libération : l'adresse redevient libre.
    await d2.send(phone, MSG.RELEASE, [], '192.168.50.100'); await new Promise((ok) => setTimeout(ok, 50));
    assert.ok(leases.find((l) => l.mac === phone)!.expires <= Date.now());
    assert.equal((await d2.send('02:00:00:00:00:09', MSG.DISCOVER))?.yiaddr, '192.168.50.100');
    // Détection d'un autre serveur DHCP (ports de test) : celui d'Odin répond comme le ferait la box.
    srv.clientPort = 0;
    const det = dgram.createSocket('udp4'); await new Promise<void>((ok) => det.bind(0, '127.0.0.1', () => ok())); const cp = (det.address() as { port: number }).port; det.close();
    srv.clientPort = cp;
    assert.deepEqual(await detectDhcp({ serverPort: sp, clientPort: cp, waitMs: 400, to: '127.0.0.1' }), ['127.0.0.1']);
  } finally { srv.stop(); d2.close(); }
});

test('appli Víðarr : DHCP réglé, adresses fixes, noms des appareils servis par le DNS, nouvel appareil signalé ; pubs des réseaux ; horaires ; enregistrements', async () => {
  const home = mkdtempSync(join(tmpdir(), 'vidarr-plus-')), up = await fakeUpstream();
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), {
    run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre',
  });
  const act = (a: string, i: Record<string, unknown> = {}) => v.act('vidarr', a, i);
  try {
    v.ctx('vidarr').saveSettings({ dns: { ...DEFAULTS, upstreams: [up.up], fallback: [] } });
    await act('demarrer', { port: 0 });
    // Réglages DHCP vérifiés.
    assert.equal((await act('dhcp_reglages', { debut: '192.168.1.200', fin: '192.168.1.100', passerelle: '192.168.1.1' })).ok, false);
    assert.equal((await act('dhcp_reglages', { debut: 'x', fin: '192.168.1.199', passerelle: '192.168.1.1' })).ok, false);
    assert.match((await act('dhcp_reglages', { debut: '192.168.1.100', fin: '192.168.1.199', passerelle: '192.168.1.1', dns: '', heures: 12, domaine: 'maison' })).text, /192\.168\.1\.100 → 192\.168\.1\.199, passerelle 192\.168\.1\.1, DNS .+, baux 12 h, domaine \.maison/);
    assert.match((await act('dhcp_fixe', { mac: 'AA-BB-CC-DD-EE-01', ip: '192.168.1.10', nom: 'NAS du salon' })).text, /aura toujours 192\.168\.1\.10 \(et le nom nas-du-salon\.maison\)/);
    assert.equal((await act('dhcp_fixe', { mac: 'aa:bb:cc:dd:ee:02', ip: '192.168.1.10' })).ok, false, 'adresse déjà donnée');
    assert.equal((await act('dhcp_fixe', { mac: 'pas-une-mac', ip: '192.168.1.11' })).ok, false);
    // Les baux (ici posés comme si le DHCP les avait donnés) : leurs noms répondent dans le DNS.
    v.ctx('vidarr').saveSettings({ leases: [{ mac: '02:11:22:33:44:55', ip: '192.168.1.120', name: 'Téléphone de Awa', expires: Date.now() + 3600_000 }, { mac: '02:00:00:00:00:01', ip: '192.168.1.121', name: 'Vieux PC', expires: Date.now() - 1000 }] });
    assert.match((await act('tester', { domaine: 'telephone-de-awa.maison' })).text, /192\.168\.1\.120/);
    assert.match((await act('tester', { domaine: 'telephone-de-awa' })).text, /192\.168\.1\.120/, 'le nom court aussi');
    assert.doesNotMatch((await act('tester', { domaine: 'vieux-pc.maison' })).text, /192\.168\.1\.121/, 'bail expiré : nom oublié');
    assert.match((await act('baux')).text, /192\.168\.1\.120 · Téléphone de Awa · 02:11:22:33:44:55 · jusqu'à[\s\S]*192\.168\.1\.121 · Vieux PC · .* · expiré/);
    // Pubs des réseaux : on voit les plateformes, on en épargne une.
    assert.match((await act('tester', { domaine: 'ads.tiktok.com' })).text, /bloqué.*Pubs des réseaux/);
    assert.match((await act('tester', { domaine: 'v16.tiktokcdn.com' })).text, /laissé passer/);
    { const r = (await act('pubs_reseaux', { actif: true, sauf: 'tiktok' })).text; assert.match(r, /YouTube et Google/); assert.doesNotMatch(r, /TikTok/); }
    assert.match((await act('tester', { domaine: 'ads.tiktok.com' })).text, /laissé passer/);
    await act('pubs_reseaux', { actif: true, sauf: '' });
    // Horaires : services coupés seulement à l'école.
    await act('services', { service: 'tiktok', coupe: true });
    assert.match((await act('horaires', { pour: 'maison', jours: 'lun,mar,mer,jeu,ven', de: '08:00', a: '16:30' })).text, /lun, mar, mer, jeu, ven, de 08:00 à 16:30/);
    assert.equal((await act('horaires', { pour: 'maison', jours: 'lun', de: '25:00', a: '16:30' })).ok, false);
    assert.deepEqual((v.ctx('vidarr').settings.dns as DnsSettings).servicesSchedule, { days: [1, 2, 3, 4, 5], from: '08:00', to: '16:30' });
    // Enregistrements de la maison.
    assert.match((await act('nom_local', { nom: 'maison.lan', valeur: 'MX 10 mail.maison.lan; TXT v=spf1 -all' })).text, /maison\.lan/);
    const dport = (await import('../src/valhalla/modules/vidarr.ts')).dnsServer()!.port;
    assert.deepEqual((await askUdp(dport, 'maison.lan', TYPE.TXT)).an, ['v=spf1 -all']);
    assert.match((await askUdp(dport, 'maison.lan', TYPE.MX)).an[0], /mail\.maison\.lan/);
    // Le vrai DHCP d'Odin (ports de test) : un appareil jamais vu arrive → bail, nom dans le DNS, alerte (lien DHCP → Forseti).
    const mod = await import('../src/valhalla/modules/vidarr.ts');
    const probe = dgram.createSocket('udp4'); await new Promise<void>((ok) => probe.bind(0, '127.0.0.1', () => ok())); const cp = (probe.address() as { port: number }).port; probe.close();
    v.ctx('vidarr').saveSettings({ dhcpPorts: [0, cp], dhcp: { ...(v.ctx('vidarr').settings.dhcp as object), server: '127.0.0.1' } });
    assert.match((await act('dhcp_demarrer', { forcer: true })).text, /DHCP d'Odin en marche : adresses 192\.168\.1\.100 → 192\.168\.1\.199/);
    assert.equal(v.ctx('vidarr').settings.dhcpOn, true, 'se rallume tout seul au redémarrage');
    const ds = mod.dhcpServer()!; ds.sock!.send = ((orig) => function (this: dgram.Socket, b: Buffer, p: number) { return (orig as (...a: unknown[]) => unknown).call(this, b, p, '127.0.0.1'); })(ds.sock!.send) as never;
    const dev = await device((ds.sock!.address() as { port: number }).port); ds.clientPort = dev.port;
    const mac = '02:aa:bb:cc:dd:01', o = await dev.send(mac, MSG.DISCOVER, [[12, Buffer.from('Tablette Ali')]]);
    assert.equal(o?.yiaddr, '192.168.1.100'); assert.equal([...o!.options.get(6)!].join('.'), (v.ctx('vidarr').settings.dhcp as { dns: string[] }).dns[0], 'le DNS donné aux appareils : Odin (son adresse sur le réseau)');
    await dev.send(mac, MSG.REQUEST, [[50, ip4('192.168.1.100')], [12, Buffer.from('Tablette Ali')]]); dev.close();
    assert.ok(v.alerts({ module: 'vidarr' }).some((a) => /Nouvel appareil sur le réseau : Tablette Ali/.test(a.title)));
    assert.match((await act('tester', { domaine: 'tablette-ali.maison' })).text, /192\.168\.1\.100/);
    const logged = (await act('tester', { domaine: 'exemple.fr', appareil: '192.168.1.100' })).text; void logged;
    assert.match((await act('dhcp_arreter')).text, /arrêté/); assert.equal(mod.dhcpServer(), undefined);
    // DNS chiffré : sans certificat, Odin explique quoi faire.
    setDotMaterial(undefined);
    assert.match((await act('dns_chiffre', { actif: true, port: 0 })).text, /HTTPS de l'interface/);
    assert.match((await act('arreter')).text, /arrêté/);
  } finally { v.stop(); up.close(); rmSync(home, { recursive: true, force: true }); }
});

test('DNS chiffré pour les appareils : TLS (DoT), les blocages s\'appliquent aussi', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dot-'));
  try { execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=odin.local', '-addext', 'subjectAltName=DNS:odin.local'], { stdio: 'ignore' }); }
  catch { t.diagnostic('openssl absent : DoT non essayé'); rmSync(dir, { recursive: true, force: true }); return; }
  const key = readFileSync(join(dir, 'k.pem')), cert = readFileSync(join(dir, 'c.pem'));
  const up = await fakeUpstream(), st: DnsSettings = { ...DEFAULTS, upstreams: [up.up], fallback: [], custom: ['||bloque.fr^'] };
  const d = new DnsServer({ settings: () => st, lists: () => [], log: () => {} });
  await d.start(0, ['127.0.0.1']);
  try {
    const port = await d.startTls(0, { key, cert }, '127.0.0.1');
    // Un client DoT : message DNS précédé de sa longueur, dans une connexion TLS.
    const ask = (name: string) => new Promise<string[]>((ok, ko) => {
      const s = tls.connect({ host: '127.0.0.1', port, servername: 'odin.local', ca: cert }, () => { const q = query(name, TYPE.A), len = Buffer.alloc(2); len.writeUInt16BE(q.length); s.write(Buffer.concat([len, q])); });
      let buf = Buffer.alloc(0);
      s.on('data', (c) => { buf = Buffer.concat([buf, c]); if (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) { const m = buf.subarray(2, 2 + buf.readUInt16BE(0)); s.end(); const p = parse(m); ok(p.an.map((r) => dataText(m, r))); } });
      s.on('error', ko);
    });
    assert.deepEqual(await ask('exemple.fr'), ['93.184.216.34']);
    assert.deepEqual(await ask('a.bloque.fr'), ['0.0.0.0'], 'les blocages s\'appliquent aussi en chiffré');
    void exchangeTcp;
  } finally { d.stop(); up.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('DNS en HTTPS (/dns-query) : GET et POST, refus si Víðarr est arrêté', async () => {
  const home = mkdtempSync(join(tmpdir(), 'doh-')), up = await fakeUpstream();
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 0, out: '', err: '' }), fetch: (async () => new Response('')) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre' });
  const o = makeOdin([]); const port = 21000 + Math.floor(Math.random() * 20000), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: () => gw.scanNetwork(false) }, { port, host: '127.0.0.1', token, scryptN: 1024 }));
  await gw.start();
  const B = `http://127.0.0.1:${port}/dns-query`;
  try {
    assert.equal((await fetch(`${B}?dns=${query('exemple.fr', TYPE.A).toString('base64url')}`)).status, 503, 'DNS arrêté');
    v.ctx('vidarr').saveSettings({ dns: { ...DEFAULTS, upstreams: [up.up], fallback: [], custom: ['||bloque.fr^'] } });
    await v.act('vidarr', 'demarrer', { port: 0 });
    const r1 = await fetch(`${B}?dns=${query('exemple.fr', TYPE.A).toString('base64url')}`);
    assert.equal(r1.status, 200); assert.equal(r1.headers.get('content-type'), 'application/dns-message');
    const m1 = Buffer.from(await r1.arrayBuffer()); assert.deepEqual(parse(m1).an.map((x) => dataText(m1, x)), ['93.184.216.34']);
    const r2 = await fetch(B, { method: 'POST', headers: { 'content-type': 'application/dns-message' }, body: query('a.bloque.fr', TYPE.A) });
    const m2 = Buffer.from(await r2.arrayBuffer()); assert.deepEqual(parse(m2).an.map((x) => dataText(m2, x)), ['0.0.0.0']);
    assert.equal((await fetch(`${B}?dns=!!`)).status, 400);
  } finally { await v.act('vidarr', 'arreter'); v.stop(); await gw.stop(); up.close(); rmSync(home, { recursive: true, force: true }); }
});

test('Ullr apprend les appareils jamais vus (faible poids : seul, ça ne fait pas un incident)', async () => {
  const { toSignal } = await import('../src/valhalla/ullr/incidents.ts');
  const sg = toSignal({ module: 'vidarr', type: 'dhcp_nouveau', data: { ip: '192.168.1.140', mac: '02:aa:bb:cc:dd:02', nom: 'Inconnu' } });
  assert.equal(sg?.weight, 5); assert.deepEqual(sg?.keys, ['ip:192.168.1.140']); assert.match(sg!.text, /jamais vu.*Inconnu/);
  assert.equal(toSignal({ module: 'vidarr', type: 'dhcp_nouveau', data: { mac: 'x' } }), undefined);
});
