// Sphinx · Journal en direct, blocage, serveurs (maquette « Réseau » validée, écrans « DNS · Journal », « DNS · Blocage »,
// « DNS · Serveurs » ; sa réponse pour le serveur amont : « racine »). Ce qui est essayé ici :
//  - la résolution depuis la racine, avant d'en faire le défaut : un serveur ne répond que pour sa zone (un alias vers une
//    autre zone est cherché depuis la racine, jamais cru sur parole) ; une adresse jointe hors de sa zone n'est pas crue ;
//    une délégation qui remonte ou part de côté est refusée ; une réponse à une autre question est ignorée ; en UDP, une
//    réponse venue d'une autre adresse ou d'un autre port est ignorée ;
//  - le serveur DNS : « racine » par défaut ; un nom de la maison inconnu ne part jamais sur Internet ;
//  - le secours (choix du propriétaire, 25/11 : « La racine d'abord. Si elle ne répond pas, Odin demande à un serveur
//    public ») : seulement quand la racine ne répond pas, jamais pour un nom qui n'existe pas ni pour un nom de la maison ;
//    « Racine seule » le retire et ce choix est gardé ; un Odin qui n'a jamais réglé son DNS a la racine et le secours ;
//  - dans Sphinx : la lecture « dns_vu » (journal, blocage, serveurs ; rien n'est écrit), au propriétaire en personne ; un
//    membre ne voit que les lignes de son appareil, sans geste ; le geste proposé pour chaque ligne vient du serveur ;
//    « autoriser » un site dangereux pose une question ; « tester » rend la raison et la réponse ; un nom dans toutes les
//    langues ; « reglages » ne change que ce qui est donné (choisir la racine ne retire plus le secours).
// Aucun paquet vers Internet : les serveurs de la racine, des domaines et des zones sont SIMULÉS en mémoire. Le serveur
// DNS d'essai n'écoute que sur 127.0.0.1, sur un port libre choisi par la machine. Le secours est SIMULÉ aussi (aucune
// question ne part vers un serveur public). Adresses et noms de documentation.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MSG, buildPacket, parsePacket, type DhcpConfig, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL, origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import { AMONT_RACINE, AMONT_SECOURS, PRISE_DHCP, dhcpServer, dnsServer, vidarr } from '../src/valhalla/modules/vidarr.ts';
import { exchangeUdp, recurse, type RecursiveOpts } from '../src/valhalla/vidarr/resolve.ts';
import { DEFAULTS, DnsServer, type DnsSettings, type LogEntry } from '../src/valhalla/vidarr/server.ts';
import { RCODE, TYPE, dataText, parse, query, rdata, respond, type Answer, type Message } from '../src/valhalla/vidarr/wire.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import { REFUS, SPHINX } from './reseau-r1-commun.ts';

// ------------------------------------------------------------------ un petit Internet simulé (en mémoire, aucun paquet)
const RACINE = '192.0.2.250', TLD_TEST = '198.51.100.1', SITE = '198.51.100.2', TLD_EX = '198.51.100.3', BANQUE = '198.51.100.4', PIEGE = '203.0.113.66';
// « muet.test » : délégué à un serveur que personne ne fait répondre (aucun serveur joignable pour ce nom).
const MUET = '198.51.100.7';
const A = (n: string, ip: string, ttl = 300): Answer => ({ name: n, type: TYPE.A, ttl, data: rdata.a(ip) });
const CN = (n: string, t: string): Answer => ({ name: n, type: TYPE.CNAME, ttl: 300, data: rdata.name(t) });
const NS = (z: string, ns: string): Answer => ({ name: z, type: TYPE.NS, ttl: 3600, data: rdata.name(ns) });
const renvoi = (q: Message, z: string, ns: string, glue: Array<[string, string]> = []) => respond(q, { ns: [NS(z, ns)], ar: glue.map(([n, ip]) => A(n, ip)), ra: false });
const auto = (q: Message, o: { an?: Answer[]; rcode?: number } = {}) => respond(q, { ...o, aa: true, ra: false });
const sous = (n: string, z: string) => n === z || n.endsWith(`.${z}`);
type Serveur = (q: Message) => Buffer;
function internet(plus: Record<string, Serveur> = {}) {
  const zones: Record<string, Serveur> = {
    [RACINE]: (q) => { const n = q.qd[0].name; return sous(n, 'test') ? renvoi(q, 'test', 'ns.nic.test', [['ns.nic.test', TLD_TEST]]) : sous(n, 'example') ? renvoi(q, 'example', 'ns.nic.example', [['ns.nic.example', TLD_EX]]) : auto(q, { rcode: RCODE.NXDOMAIN }); },
    [TLD_TEST]: (q) => { const n = q.qd[0].name; return sous(n, 'site.test') ? renvoi(q, 'site.test', 'ns1.site.test', [['ns1.site.test', SITE]]) : sous(n, 'piege.test') ? renvoi(q, 'piege.test', 'ns.piege.test', [['ns.piege.test', PIEGE]])
      // « leurre.test » : le serveur de « .test » joint une adresse pour un serveur de « .example » (hors de sa zone).
      : sous(n, 'leurre.test') ? renvoi(q, 'leurre.test', 'ns.banque.example', [['ns.banque.example', PIEGE]])
      : sous(n, 'muet.test') ? renvoi(q, 'muet.test', 'ns.muet.test', [['ns.muet.test', MUET]]) : auto(q, { rcode: RCODE.NXDOMAIN }); },
    [SITE]: (q) => { const n = q.qd[0].name; return n === 'www.site.test' && q.qd[0].type === TYPE.A ? auto(q, { an: [A(n, '198.51.100.61')] }) : auto(q, { rcode: RCODE.NXDOMAIN }); },
    [TLD_EX]: (q) => { const n = q.qd[0].name; return sous(n, 'banque.example') ? renvoi(q, 'banque.example', 'ns.banque.example', [['ns.banque.example', BANQUE]]) : auto(q, { rcode: RCODE.NXDOMAIN }); },
    [BANQUE]: (q) => { const n = q.qd[0].name; return n === 'banque.example' ? auto(q, { an: [A(n, '198.51.100.44')] }) : n === 'ns.banque.example' ? auto(q, { an: [A(n, BANQUE)] }) : n === 'www.leurre.test' ? auto(q, { an: [A(n, '198.51.100.45')] }) : auto(q, { rcode: RCODE.NXDOMAIN }); },
    // Le serveur piégé : il répond à tout, et glisse des réponses pour des noms qui ne sont pas à lui.
    [PIEGE]: (q) => {
      const n = q.qd[0].name;
      if (n === 'www.piege.test') return auto(q, { an: [CN(n, 'banque.example'), A('banque.example', PIEGE)] });
      if (n === 'boucle.piege.test') return renvoi(q, 'test', 'ns.nic.test', [['ns.nic.test', TLD_TEST]]);          // remonte
      if (n === 'cote.piege.test') return renvoi(q, 'banque.example', 'ns.piege.test', [['ns.piege.test', PIEGE]]); // part de côté
      return auto(q, { an: [A(n, PIEGE)] });
    },
    ...plus,
  };
  const vus: string[] = [];
  const ask = async (q: Buffer, host: string) => { vus.push(host); const f = zones[host]; if (!f) throw new Error(`personne ne répond à ${host}`); return f(parse(q)); };
  const opts: RecursiveOpts = { roots: [{ host: RACINE, port: 53 }], ask };
  return { opts, vus, ask };
}
const ip4 = (a: Answer) => [...a.data].join('.');

// ------------------------------------------------------------------ la résolution depuis la racine
test('Racine · un serveur ne répond que pour sa zone : un alias vers une autre zone est cherché depuis la racine, jamais cru sur parole', async () => {
  const net = internet();
  const a = await recurse('www.site.test', TYPE.A, net.opts);
  assert.deepEqual(a.an.map((x) => [x.name, ip4(x)]), [['www.site.test', '198.51.100.61']]);
  net.vus.length = 0;
  const b = await recurse('www.piege.test', TYPE.A, net.opts);
  assert.deepEqual(b.an.map((x) => [x.name, x.type]), [['www.piege.test', TYPE.CNAME], ['banque.example', TYPE.A]]);
  assert.equal(ip4(b.an[1]), '198.51.100.44', 'l\'adresse de « banque.example » vient de son propre serveur, pas du serveur piégé');
  assert.ok(net.vus.includes(BANQUE), 'le serveur de « banque.example » a été interrogé');
});

test('Racine · une adresse jointe hors de la zone du serveur qui la donne n\'est pas crue : le serveur est cherché depuis la racine', async () => {
  const net = internet();
  const r = await recurse('www.leurre.test', TYPE.A, net.opts);
  assert.deepEqual(r.an.map((x) => [x.name, ip4(x)]), [['www.leurre.test', '198.51.100.45']]);
  assert.equal(net.vus.includes(PIEGE), false, 'l\'adresse glissée par le serveur de « .test » n\'est jamais interrogée');
});

test('Racine · une délégation qui remonte ou part de côté est refusée tout de suite (pas de boucle)', async () => {
  for (const nom of ['boucle.piege.test', 'cote.piege.test']) {
    const net = internet();
    await assert.rejects(() => recurse(nom, TYPE.A, net.opts), /délégation/, nom);
    assert.ok(net.vus.length <= 4, `${nom} : ${net.vus.length} questions (au plus 4 : racine, .test, serveur piégé)`);
  }
});

test('Racine · un serveur mal réglé (son renvoi ne descend pas) est laissé de côté : un autre serveur de la même zone répond', async () => {
  // « boiteux.test » a deux serveurs : l'un répond, l'autre renvoie vers la racine. L'ordre des serveurs est tiré au hasard :
  // quarante essais, et jamais d'échec (avant : environ un sur deux).
  const BON = '198.51.100.5', BOITEUX = '198.51.100.6';
  const net = internet({
    [TLD_TEST]: (q) => (sous(q.qd[0].name, 'boiteux.test') ? respond(q, { ns: [NS('boiteux.test', 'ns1.boiteux.test'), NS('boiteux.test', 'ns2.boiteux.test')], ar: [A('ns1.boiteux.test', BON), A('ns2.boiteux.test', BOITEUX)], ra: false }) : auto(q, { rcode: RCODE.NXDOMAIN })),
    [BON]: (q) => auto(q, { an: [A(q.qd[0].name, '198.51.100.46')] }),
    [BOITEUX]: (q) => renvoi(q, '', 'a.racine.test', [['a.racine.test', RACINE]]),
  });
  let echecs = 0;
  for (let k = 0; k < 40; k++) { try { const r = await recurse('www.boiteux.test', TYPE.A, net.opts); assert.equal(ip4(r.an[0]), '198.51.100.46'); } catch { echecs++; } }
  assert.equal(echecs, 0, `${echecs} échecs sur 40`);
  // Tous les serveurs de la zone sont mal réglés : refusé, en le disant.
  const seul = internet({ [TLD_TEST]: (q) => renvoi(q, 'boiteux.test', 'ns2.boiteux.test', [['ns2.boiteux.test', BOITEUX]]), [BOITEUX]: (q) => renvoi(q, '', 'a.racine.test', [['a.racine.test', RACINE]]) });
  await assert.rejects(() => recurse('www.boiteux.test', TYPE.A, seul.opts), /délégation/);
});

test('Racine · une réponse à une autre question est ignorée', async () => {
  const net = internet({ [RACINE]: (q) => { const faux = parse(query('ailleurs.test', TYPE.A, { id: q.id, rd: false })); return respond(faux, { an: [A(q.qd[0].name, PIEGE)], aa: true, ra: false }); } });
  await assert.rejects(() => recurse('www.site.test', TYPE.A, net.opts));
});

test('Racine · en UDP, une réponse venue d\'un autre port que celui du serveur interrogé est ignorée', async () => {
  // Deux prises locales (127.0.0.1) : le « serveur » et un voisin qui répond à sa place, plus vite, avec le bon identifiant.
  const lier = () => new Promise<dgram.Socket>((ok) => { const s = dgram.createSocket('udp4'); s.bind(0, '127.0.0.1', () => ok(s)); });
  const [srv, voisin] = await Promise.all([lier(), lier()]);
  srv.on('message', (m, r) => {
    const q = parse(m);
    voisin.send(respond(q, { an: [A(q.qd[0].name, PIEGE)] }), r.port, r.address);
    setTimeout(() => srv.send(respond(q, { an: [A(q.qd[0].name, '198.51.100.61')] }), r.port, r.address), 60);
  });
  try {
    const out = await exchangeUdp(query('www.site.test', TYPE.A, { id: 77 }), '127.0.0.1', (srv.address() as { port: number }).port, 2000);
    const m = parse(out); assert.equal(dataText(out, m.an[0]), '198.51.100.61');
  } finally { srv.close(); voisin.close(); }
});

// ------------------------------------------------------------------ le serveur DNS
test('Serveur · « racine » par défaut ; la racine répond : le secours ne sert pas ; « Racine seule » en panne : rien ne part ailleurs', async () => {
  assert.deepEqual(DEFAULTS.upstreams, ['récursif']);
  let horsRacine = 0;
  const net = internet(), sec = secoursSimule();
  const essai = async (o: RecursiveOpts, plus: Partial<DnsSettings> = {}) => {
    const d = new DnsServer({ settings: () => ({ ...DEFAULTS, rateLimit: 0, ...plus }), lists: () => [], recursive: o, secours: sec.f, fetch: (async () => { horsRacine++; throw new Error('aucun réseau'); }) as unknown as typeof fetch });
    const out = (await d.handle(query('www.site.test', TYPE.A, { id: 5 }), '192.0.2.150'))!; return { m: parse(out), out };
  };
  const ok = await essai(net.opts);
  assert.equal(ok.m.rcode, RCODE.NOERROR); assert.equal(dataText(ok.out, ok.m.an[0]), '198.51.100.61');
  assert.equal(net.vus[0], RACINE, 'la première question part vers la racine');
  assert.deepEqual(sec.appels, [], 'la racine a répondu : le secours n\'est pas interrogé');
  // « Racine seule » et la racine ne répond pas : pas de réponse (SERVFAIL), et aucune question ne part vers un autre service.
  const ko = await essai({ roots: [{ host: RACINE, port: 53 }], ask: async (_q, h) => { if (h !== RACINE) horsRacine++; throw new Error('aucun réseau'); } }, { fallback: [] });
  assert.equal(ko.m.rcode, RCODE.SERVFAIL);
  assert.equal(horsRacine, 0, 'aucun résolveur interrogé'); assert.deepEqual(sec.appels, []);
});

test('Serveur · un nom de la maison inconnu ne part jamais sur Internet', async () => {
  const net = internet();
  const d = new DnsServer({ settings: () => ({ ...DEFAULTS, rateLimit: 0, rewrites: { 'disque.maison': ['192.0.2.40'] } }), lists: () => [], domaine: () => 'maison', recursive: net.opts });
  const demande = async (n: string) => { const out = (await d.handle(query(n, TYPE.A, { id: 6 }), '192.0.2.150'))!; const m = parse(out); return { rcode: m.rcode, an: m.an.map((x) => dataText(out, x)) }; };
  assert.deepEqual(await demande('disque.maison'), { rcode: RCODE.NOERROR, an: ['192.0.2.40'] });
  for (const n of ['inconnu.maison', 'a.b.maison', 'maison']) assert.equal((await demande(n)).rcode, RCODE.NXDOMAIN, n);
  assert.deepEqual(net.vus, [], 'aucune question n\'est partie');
  assert.equal((await demande('www.site.test')).an[0], '198.51.100.61', 'un nom d\'Internet passe toujours');
});

// ------------------------------------------------------------------ le secours (choix du propriétaire, 25/11)
// « La racine d'abord. Si elle ne répond pas, Odin demande à un serveur public pour que la maison ne reste jamais sans Internet. »
const SECOURS_D_AVANT = ['9.9.9.9', '1.1.1.1'];   // le secours qu'Odin avait avant le lot (git : HEAD, vidarr/server.ts)
const PAR_SECOURS = '198.51.100.81';
/** Un secours simulé : il répond à tout (une adresse de documentation) et note chaque question reçue. Aucun paquet. */
function secoursSimule() {
  const appels: string[] = [];
  const f = async (_raw: Buffer, q: Message, serveurs: string[]) => { appels.push(`${q.qd[0].name}@${serveurs.join(',')}`); return { raw: respond(q, { an: [A(q.qd[0].name, PAR_SECOURS)], ra: true }), upstream: serveurs[0] }; };
  return { appels, f };
}
/** La racine en panne : délai dépassé à chaque question ; ou elle répond « panne » (SERVFAIL). */
const racineMuette = (vus: string[] = []): RecursiveOpts => ({ roots: [{ host: RACINE, port: 53 }], ask: async (_q, h) => { vus.push(h); throw new Error('délai dépassé'); } });
const racineEnPanne: RecursiveOpts = { roots: [{ host: RACINE, port: 53 }], ask: async (q) => respond(parse(q), { rcode: RCODE.SERVFAIL, ra: false }) };
function serveurAvecSecours(o: RecursiveOpts, plus: Partial<DnsSettings> = {}, domaine?: string) {
  const sec = secoursSimule(), logs: LogEntry[] = [];
  const d = new DnsServer({ settings: () => ({ ...DEFAULTS, rateLimit: 0, ...plus }), lists: () => [], recursive: o, secours: sec.f, log: (e) => logs.push(e), domaine: () => domaine, fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch });
  const demande = async (n: string) => { const out = (await d.handle(query(n, TYPE.A, { id: 7 }), '192.0.2.150'))!; const m = parse(out); return { rcode: m.rcode, an: m.an.map((x) => dataText(out, x)) }; };
  return { sec, logs, demande };
}

test('Secours · par défaut, la racine d\'abord et le secours d\'avant ; la racine ne répond pas (délai, panne) : la réponse vient du secours, et le journal le dit', async () => {
  assert.deepEqual([DEFAULTS.upstreams, DEFAULTS.fallback], [['récursif'], SECOURS_D_AVANT]);
  for (const racine of [racineMuette(), racineEnPanne]) {
    const w = serveurAvecSecours(racine);
    assert.deepEqual(await w.demande('www.site.test'), { rcode: RCODE.NOERROR, an: [PAR_SECOURS] });
    assert.deepEqual(w.sec.appels, [`www.site.test@${SECOURS_D_AVANT.join(',')}`], 'le secours reçoit la question, une fois');
    assert.deepEqual([w.logs[0].status, w.logs[0].secours, w.logs[0].upstream], ['ok', true, '9.9.9.9'], 'le journal dit que le secours a servi');
  }
  // Aucun serveur joignable pour un nom (la racine répond, mais le serveur du domaine est muet) : le secours aussi.
  const net = internet(), w = serveurAvecSecours(net.opts);
  assert.deepEqual(await w.demande('www.muet.test'), { rcode: RCODE.NOERROR, an: [PAR_SECOURS] });
  assert.equal(net.vus[0], RACINE, 'la racine d\'abord');
});

test('Secours · un nom qui n\'existe vraiment pas (« n\'existe pas » venu de la racine) ne part jamais au secours', async () => {
  const net = internet(), w = serveurAvecSecours(net.opts);
  // Témoin : le secours est bien en place (un nom dont le serveur est muet y part).
  assert.deepEqual((await w.demande('www.muet.test')).an, [PAR_SECOURS]);
  w.sec.appels.length = 0; net.vus.length = 0;
  for (const n of ['absent.example', 'rien.site.test', 'nulle-part.invalide']) assert.deepEqual(await w.demande(n), { rcode: RCODE.NXDOMAIN, an: [] }, n);
  assert.ok(net.vus.includes(RACINE), 'la racine a bien été interrogée');
  assert.deepEqual(w.sec.appels, [], 'aucune question au secours');
});

test('Secours · un nom de la maison ne part jamais dehors, même la racine en panne et même noms privés laissés sortir', async () => {
  // Témoin : la racine en panne, un nom d'Internet part au secours.
  const vus: string[] = [], w = serveurAvecSecours(racineMuette(vus), {}, 'maison');
  assert.deepEqual((await w.demande('www.site.test')).an, [PAR_SECOURS]);
  w.sec.appels.length = 0; vus.length = 0;
  const maison = ['nas.maison', 'maison', 'imprimante', 'box.local', 'tele.home.arpa', '20.1.168.192.in-addr.arpa', '5.0.0.10.in-addr.arpa'];
  for (const n of maison) assert.notEqual((await w.demande(n)).an[0], PAR_SECOURS, n);
  assert.deepEqual(w.sec.appels, [], 'aucun nom de la maison au secours');
  assert.equal((await w.demande('nas.maison')).rcode, RCODE.NXDOMAIN, '« .maison » : répondu ici, sans rien demander');
  // Même quand le propriétaire laisse sortir les noms privés vers la racine : jamais au secours public.
  const libre = serveurAvecSecours(racineMuette(), { privateReverse: false }, 'maison');
  for (const n of maison) await libre.demande(n);
  assert.deepEqual(libre.sec.appels, [], 'aucun nom de la maison au secours, réglage ouvert compris');
});

// ------------------------------------------------------------------ dans Sphinx
const BOX = '192.0.2.1', ODIN = '192.0.2.2';
const M = { odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', tel: '02:00:5e:00:53:14' };
const dossiers: string[] = [], PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs;
const odins: Valhalla[] = [];
after(() => { for (const v of odins) v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; AMONT_RACINE.essai = undefined; AMONT_SECOURS.essai = undefined; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, options: [[53, Buffer.from([type])], ...(o.nom !== undefined ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, Buffer.from(o.veut.split('.').map(Number))] as [number, Buffer]] : [])] });
const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
type Ligne = { t: number; ip: string; machine: string; mac?: string; nom: string; ascii: string; type: string; statut: string; reponse: string; liste: string; ms: number; danger: boolean; maison: boolean; geste: string | null };

/** Un Odin d'essai avec Sphinx seul : DNS sur 127.0.0.1 (port libre), Internet simulé, prise du DHCP simulée. */
async function monde() {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-dns-')); dossiers.push(home);
  const envois: Packet[] = []; const now = Date.now(), net = internet(), sec = secoursSimule();
  PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
  LOCAL.macs = () => [M.odin]; setVerificateur(() => undefined); AMONT_RACINE.essai = net.opts; AMONT_SECOURS.essai = sec.f;
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }), fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(now) });
  odins.push(v); const ctx = v.ctx('vidarr');
  const cfg: DhcpConfig = { server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [] };
  ctx.saveSettings({ dhcp: cfg, listen: ['127.0.0.1'] });
  // Deux listes « téléchargées » (fichiers posés à la main : aucun téléchargement).
  mkdirSync(join(ctx.dir, 'listes'), { recursive: true });
  writeFileSync(join(ctx.dir, 'listes', 'pubs.txt'), '||annonces.example^\n'); writeFileSync(join(ctx.dir, 'listes', 'menaces.txt'), '0.0.0.0 hamecon.example\n');
  assert.equal((await v.act('vidarr', 'dhcp_demarrer', { forcer: true })).ok !== false, true);
  const prend = (mac: string, nom: string) => { const n = envois.length; dhcpServer()!.onMessage(paquet(mac, MSG.DISCOVER, { nom })); const ip = envois[n].yiaddr; dhcpServer()!.onMessage(paquet(mac, MSG.REQUEST, { nom, veut: ip })); return ip; };
  const act = (a: string, i: Record<string, unknown> = {}, o?: Parameters<Valhalla['act']>[3]) => v.act('vidarr', a, i, o);
  assert.equal((await act('demarrer', { port: 0 })).ok, true);
  const demande = async (nom: string, ip: string, type = TYPE.A) => { const out = (await dnsServer()!.handle(query(nom, type, { id: 9 }), ip))!; const m = parse(out); return { rcode: m.rcode, an: m.an.map((x) => dataText(out, x)) }; };
  const vu = async (i: Record<string, unknown>) => { const r = await act('dns_vu', i); return { r, D: r.data as Record<string, any> }; };
  const membre = (depuis: string, a: string, i: Record<string, unknown> = {}) => auNomDe(nour, () => origineDemande.run(depuis, () => act(a, i)));
  const dns = () => ctx.settings.dns as Record<string, any>;
  return { v, ctx, net, sec, prend, act, demande, vu, membre, dns, fin: () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; AMONT_RACINE.essai = undefined; AMONT_SECOURS.essai = undefined; } };
}

test('Sphinx · « dns_vu » est une lecture, au propriétaire en personne ; aucune action nouvelle qui écrit', async () => {
  const w = await monde();
  try {
    const m = w.v.module('vidarr')!, ecrit = m.actions.filter((a) => !a.read).map((a) => a.id).filter((id) => id !== 'qui_a_fait');
    assert.deepEqual(ecrit.filter((id) => !SPHINX.includes(id)), [], 'la liste exacte du lot R1 n\'a pas bougé');
    const a = m.actions.find((x) => x.id === 'dns_vu')!;
    assert.ok(a, 'la lecture « dns_vu » existe');
    assert.deepEqual([a.read, a.external, a.grave], [true, true, undefined]);
    assert.equal(typeof a.proprietaireSeul === 'function' && a.proprietaireSeul({}, undefined), true);
    assert.equal(auNomDe(nour, () => (a.proprietaireSeul as () => boolean)()), false);
    assert.match((await w.act('dns_vu', { vue: 'journal' }, { auto: true })).text, REFUS, 'une automatisation ne lit pas le journal');
    const avant = JSON.stringify(w.ctx.settings);
    for (const vue of ['journal', 'blocage', 'serveurs']) assert.equal((await w.vu({ vue })).D.vue, vue);
    assert.equal(JSON.stringify(w.ctx.settings), avant, 'rien n\'est écrit');
  } finally { w.fin(); }
});

test('Sphinx · le journal en direct : qui demande quoi, la réponse, le temps ; filtres ; le geste proposé vient du serveur ; taille bornée', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-SALLE');
    assert.equal((await w.act('nom_local', { nom: 'disque.maison', valeur: '192.0.2.40', sorte: 'a' })).ok, true);
    for (const n of ['www.site.test', 'annonces.example', 'hamecon.example', 'disque.maison', 'inconnu.maison']) await w.demande(n, ipPc);
    await w.demande('www.site.test', '192.0.2.160');
    const { D } = await w.vu({ vue: 'journal', machine: ipPc });
    assert.equal(D.proprietaire, true);
    const l = D.lignes as Ligne[], par = (n: string) => l.find((x) => x.ascii === n)!;
    assert.deepEqual(l.slice(0, 5).map((x) => x.ascii), ['inconnu.maison', 'disque.maison', 'hamecon.example', 'annonces.example', 'www.site.test'], 'les plus récentes d\'abord');
    assert.ok(l.every((x) => x.ip === ipPc), 'seulement la machine choisie');
    assert.deepEqual([par('www.site.test').statut, par('www.site.test').reponse, par('www.site.test').geste], ['ok', '198.51.100.61', 'bloquer']);
    assert.deepEqual([par('annonces.example').statut, par('annonces.example').danger, par('annonces.example').geste, par('annonces.example').liste], ['bloqué', false, 'autoriser', 'Pubs et pisteurs']);
    assert.deepEqual([par('hamecon.example').statut, par('hamecon.example').danger, par('hamecon.example').geste], ['bloqué', true, 'autoriser']);
    assert.deepEqual([par('disque.maison').maison, par('disque.maison').geste, par('disque.maison').reponse], [true, null, '192.0.2.40']);
    assert.deepEqual([par('inconnu.maison').maison, par('inconnu.maison').statut], [true, 'refusé'], 'un nom de la maison inconnu ne part pas');
    assert.equal(par('www.site.test').machine, 'PC-SALLE'); assert.equal(par('www.site.test').mac, M.pc, 'de quoi « voir la machine »');
    assert.ok(Number.isFinite(par('www.site.test').ms));
    // Filtres.
    assert.deepEqual(((await w.vu({ vue: 'journal', machine: ipPc, filtre: 'bloque' })).D.lignes as Ligne[]).map((x) => x.ascii), ['hamecon.example', 'annonces.example']);
    assert.deepEqual(((await w.vu({ vue: 'journal', machine: ipPc, filtre: 'maison' })).D.lignes as Ligne[]).map((x) => x.ascii), ['inconnu.maison', 'disque.maison']);
    const tout = (await w.vu({ vue: 'journal' })).D;
    assert.ok((tout.machines as Array<{ ip: string }>).some((x) => x.ip === '192.0.2.160') && tout.machines.some((x: { ip: string; nom: string }) => x.ip === ipPc && x.nom === 'PC-SALLE'), 'la liste des machines qui demandent');
    assert.ok(tout.chiffres.questions >= 6 && tout.chiffres.bloquees >= 2 && tout.chiffres.machines >= 2, JSON.stringify(tout.chiffres));
    // Taille bornée : jamais plus de 200 lignes rendues, et la page dit ce qui est gardé.
    for (let k = 0; k < 230; k++) await w.demande(`n${k}.site.test`, '192.0.2.170');
    const grand = (await w.vu({ vue: 'journal', n: 100000 })).D;
    assert.equal(grand.lignes.length, 200);
    assert.equal(grand.garde.max, 50000);
    assert.ok(w.net.vus.length > 0 && w.net.vus.every((h) => [RACINE, TLD_TEST, SITE, TLD_EX, BANQUE, PIEGE].includes(h)), 'seuls les serveurs simulés');
  } finally { w.fin(); }
});

test('Sphinx · un membre ne voit que les lignes de son appareil, sans geste ; Blocage et Serveurs : la limite seulement', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-SALLE'), ipTel = w.prend(M.tel, 'Telephone-Nour');
    await w.demande('www.site.test', ipPc); await w.demande('annonces.example', ipTel); await w.demande('www.site.test', ipTel);
    const r = await w.membre(ipTel, 'dns_vu', { vue: 'journal' }), D = r.data as Record<string, any>;
    assert.equal(D.proprietaire, false); assert.ok(D.limite);
    assert.ok(D.lignes.length >= 2 && (D.lignes as Ligne[]).every((x) => x.ip === ipTel && x.geste === null && x.mac === undefined), JSON.stringify(D.lignes));
    assert.deepEqual((D.machines as Array<{ ip: string }>).map((x) => x.ip), [ipTel]);
    assert.ok(D.chiffres.machines <= 1);
    // D'un appareil qu'Odin ne reconnaît pas : rien.
    assert.deepEqual(((await w.membre('192.0.2.250', 'dns_vu', { vue: 'journal' })).data as Record<string, any>).lignes, []);
    for (const vue of ['blocage', 'serveurs']) {
      const x = (await w.membre(ipTel, 'dns_vu', { vue })).data as Record<string, any>;
      assert.deepEqual([x.proprietaire, Boolean(x.limite), x.listes, x.amont], [false, true, undefined, undefined], vue);
    }
    for (const a of ['bloquer', 'autoriser']) assert.match((await w.membre(ipTel, a, { domaine: 'annonces.example' })).text, REFUS, a);
  } finally { w.fin(); }
});

test('Sphinx · autoriser ou bloquer une ligne : propriétaire seul, noté ; un site dangereux pose une question ; un nom dans toutes les langues', async () => {
  const w = await monde();
  try {
    const m = w.v.module('vidarr')!, aut = m.actions.find((x) => x.id === 'autoriser')!;
    assert.equal(typeof aut.grave, 'function', 'autoriser a une question possible');
    assert.match(String(aut.grave!({ domaine: 'hamecon.example' }, w.ctx)), /dangereux/);
    assert.match(String(aut.grave!({ domaine: 'example' }, w.ctx)), /dangereux/, 'un nom au-dessus d\'un site dangereux aussi (il le laisserait passer)');
    assert.equal(aut.grave!({ domaine: 'www.hamecon.example' }, w.ctx), undefined, 'la liste ne bloque que « hamecon.example » lui-même : pas de question pour un nom en dessous');
    assert.equal(aut.grave!({ domaine: 'annonces.example' }, w.ctx), undefined, 'une pub : pas de question');
    assert.ok(aut.grave!({ domaine: 'annonces.example' }, undefined), 'sans contexte : grave d\'office');
    assert.equal((await w.act('bloquer', { domaine: 'www.site.test' })).ok, true);
    assert.equal((await w.act('autoriser', { domaine: 'annonces.example' })).ok, true);
    assert.equal((await w.act('bloquer', { domaine: 'Café.Example' })).ok, true, 'un nom écrit dans sa langue');
    assert.deepEqual(w.dns().custom, ['||www.site.test^', '@@||annonces.example^', '||xn--caf-dma.example^']);
    const qui = (await w.act('qui_a_fait', { n: 5 })).text;
    assert.match(qui, /Bloquer un domaine/); assert.match(qui, /Autoriser un domaine/);
    // Ce que le DNS répond maintenant.
    assert.deepEqual((await w.demande('www.site.test', '192.0.2.150')).an, ['0.0.0.0']);
    assert.equal((await w.demande('annonces.example', '192.0.2.150')).rcode, RCODE.NXDOMAIN, 'autorisé : la question part vers la racine (simulée), qui ne le connaît pas');
  } finally { w.fin(); }
});

test('Sphinx · tester un nom : ce que répond Odin et pourquoi, en données ; le geste proposé', async () => {
  const w = await monde();
  try {
    assert.equal((await w.act('nom_local', { nom: 'disque.maison', valeur: '192.0.2.40', sorte: 'a' })).ok, true);
    const t = async (domaine: string) => (await w.act('tester', { domaine })).data as Record<string, any>;
    const p = await t('hamecon.example');
    assert.deepEqual([p.verdict, p.danger, p.geste, p.reponse, p.liste], ['bloque', true, 'autoriser', '0.0.0.0', 'Sites dangereux (virus, hameçonnage)']);
    assert.ok(p.raison);
    const b = await t('annonces.example'); assert.deepEqual([b.verdict, b.danger, b.geste], ['bloque', false, 'autoriser']);
    const d = await t('disque.maison'); assert.deepEqual([d.verdict, d.reponse, d.geste], ['maison', '192.0.2.40', null]);
    const s = await t('www.site.test'); assert.deepEqual([s.verdict, s.reponse, s.geste], ['passe', '198.51.100.61', 'bloquer']);
    const c = await t('café.example'); assert.deepEqual([c.nom, c.ascii], ['café.example', 'xn--caf-dma.example']);
    // Un membre peut tester, sans geste proposé.
    const x = (await w.membre('192.0.2.150', 'tester', { domaine: 'annonces.example' })).data as Record<string, any>;
    assert.deepEqual([x.verdict, x.geste], ['bloque', null]);
  } finally { w.fin(); }
});

test('Sphinx · l\'écran Blocage : listes, tes règles (bloqués, autorisés, à horaires), pause', async () => {
  const w = await monde();
  try {
    await w.act('bloquer', { domaine: 'arcade.example' }); await w.act('autoriser', { domaine: 'magasin.example' }); await w.act('regle', { regle: '/^ads[0-9]+\\./' });
    assert.equal((await w.act('bloquer_horaires', { domaine: 'films.example', jours: 'tous', de: '21:00', a: '07:00' })).ok, true);
    let D = (await w.vu({ vue: 'blocage' })).D;
    assert.equal(D.proprietaire, true); assert.equal(D.pause, null);
    const pubs = (D.listes as Array<Record<string, any>>).find((l) => l.id === 'pubs')!;
    assert.deepEqual([pubs.nom, pubs.sorte, pubs.active], ['Pubs et pisteurs', 'blocage', true]);
    assert.ok((D.listes as Array<Record<string, any>>).some((l) => l.id === 'menaces' && l.sorte === 'menace'));
    assert.deepEqual((D.regles.bloques as Array<Record<string, string>>).map((x) => [x.regle, x.nom]), [['||arcade.example^', 'arcade.example'], ['/^ads[0-9]+\\./', '/^ads[0-9]+\\./']]);
    assert.deepEqual((D.regles.autorises as Array<Record<string, string>>).map((x) => [x.regle, x.nom]), [['@@||magasin.example^', 'magasin.example']]);
    assert.equal(D.regles.horaires[0].domaine, 'films.example'); assert.match(D.regles.horaires[0].mots, /21:00/);
    assert.equal((await w.act('pause', { minutes: 5 })).ok, true);
    D = (await w.vu({ vue: 'blocage' })).D; assert.ok(D.pause && D.pause.jusqua > Date.now() - 1000);
  } finally { w.fin(); }
});

test('Sphinx · l\'écran Serveurs : « racine » conseillée, choisie en un geste ; « reglages » ne change que ce qui est donné ; choisir la racine garde le secours', async () => {
  const w = await monde();
  try {
    let D = (await w.vu({ vue: 'serveurs' })).D;
    assert.deepEqual([D.choix, D.conseille, D.amont.map((x: { sorte: string }) => x.sorte), D.secours, D.box], ['racine', 'racine', ['recursif'], SECOURS_D_AVANT, BOX]);
    assert.deepEqual((await w.demande('www.site.test', '192.0.2.150')).an, ['198.51.100.61'], 'résolu tout seul depuis la racine (simulée)');
    // Un Odin qui avait enregistré les anciens réglages (deux résolveurs publics et deux de secours) les garde : la page le montre.
    w.ctx.saveSettings({ dns: { ...w.dns(), upstreams: ['https://dns.example/dns-query', 'tls://198.51.100.71'], fallback: ['198.51.100.9', '203.0.113.9'], parental: true, safeSearch: true, rateLimit: 30 } });
    D = (await w.vu({ vue: 'serveurs' })).D;
    assert.deepEqual([D.choix, D.secours.length, D.amont.every((x: { chiffre: boolean }) => x.chiffre)], ['chiffre', 2, true]);
    // La racine en un geste : rien d'autre ne bouge, le secours non plus.
    assert.equal((await w.act('reglages', { amont: 'récursif' })).ok, true);
    assert.deepEqual([w.dns().upstreams, w.dns().fallback, w.dns().parental, w.dns().safeSearch, w.dns().rateLimit, w.dns().strategy, w.dns().mode], [['récursif'], ['198.51.100.9', '203.0.113.9'], true, true, 30, 'rapide', 'ip_nulle']);
    assert.equal((await w.act('reglages', { amont: BOX })).ok, true); assert.equal((await w.vu({ vue: 'serveurs' })).D.choix, 'box');
    assert.equal((await w.act('reglages', { strategie: 'ordre' })).ok, true); assert.deepEqual([w.dns().upstreams, w.dns().strategy], [[BOX], 'ordre']);
    assert.equal((await w.act('reglages', { amont: 'pas un serveur !' })).ok, false, 'un serveur mal écrit est refusé');
    assert.equal((await w.act('reglages', { strategie: 'nimporte' })).ok, false);
    assert.deepEqual(w.dns().upstreams, [BOX], 'rien n\'a changé après un refus');
  } finally { w.fin(); }
});

// ------------------------------------------------------------------ après relecture
test('Sphinx · « tester » n\'écrit rien dans le journal et ne déclenche aucune alerte ; un membre ne choisit pas l\'appareil', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-SALLE'), ipTel = w.prend(M.tel, 'Telephone-Nour');
    const debut = Date.now(), lignes = async () => ((await w.vu({ vue: 'journal', n: 200 })).D.lignes as Ligne[]).filter((l) => l.t >= debut);
    const avant = (await lignes()).length, alertes = () => w.v.alerts({ module: 'vidarr' }).filter((a) => /site dangereux/.test(a.title)).length;
    assert.equal(((await w.act('tester', { domaine: 'hamecon.example' })).data as Record<string, any> | undefined)?.verdict, 'bloque');
    assert.equal(((await w.act('tester', { domaine: 'www.site.test', appareil: ipPc })).data as Record<string, any> | undefined)?.verdict, 'passe');
    assert.equal(((await w.membre(ipTel, 'tester', { domaine: 'hamecon.example', appareil: ipPc })).data as Record<string, any> | undefined)?.verdict, 'bloque');
    assert.equal((await lignes()).length, avant, 'aucune ligne écrite par « tester »');
    assert.equal(alertes(), 0, 'aucune alerte « site dangereux » au nom d\'une machine qui n\'a rien demandé');
    // Le PC est coupé d'Internet : le propriétaire le voit en testant pour lui ; un membre ne peut pas tester pour lui.
    assert.equal((await w.act('couper_machine', { ip: ipPc, nom: 'PC-SALLE' })).ok, true);
    assert.equal(((await w.act('tester', { domaine: 'www.site.test', appareil: ipPc })).data as Record<string, any> | undefined)?.verdict, 'bloque');
    assert.equal(((await w.membre(ipTel, 'tester', { domaine: 'www.site.test', appareil: ipPc })).data as Record<string, any> | undefined)?.verdict, 'passe', 'l\'appareil donné par un membre est ignoré');
    // Une vraie question d'une machine, elle, va au journal et alerte.
    await w.demande('hamecon.example', ipTel);
    assert.equal((await lignes()).length, avant + 1); assert.equal(alertes(), 1);
  } finally { w.fin(); }
});

test('Sphinx · un nom de la maison enregistré avant les vérifications et qui est un nom d\'Internet ne coupe pas Internet', async () => {
  const w = await monde();
  try {
    const dhcp = w.ctx.settings.dhcp as DhcpConfig;
    w.ctx.saveSettings({ dhcp: { ...dhcp, domain: 'test' } });
    assert.deepEqual((await w.demande('www.site.test', '192.0.2.150')).an, ['198.51.100.61'], '« .test » n\'est pas un nom privé : il passe');
    assert.equal((await w.vu({ vue: 'serveurs' })).D.domaine, '', 'la page ne promet rien pour ce nom');
    w.ctx.saveSettings({ dhcp: { ...dhcp, domain: 'lan' } });
    assert.equal((await w.demande('inconnu.lan', '192.0.2.150')).rcode, RCODE.NXDOMAIN, 'un nom privé reste protégé');
    assert.equal((await w.vu({ vue: 'serveurs' })).D.domaine, 'lan');
  } finally { w.fin(); }
});

test('Sphinx · Blocage : un nom autorisé dit quelle liste le bloquait ; l\'état des pubs des réseaux', async () => {
  const w = await monde();
  try {
    await w.act('autoriser', { domaine: 'annonces.example' }); await w.act('autoriser', { domaine: 'www.site.test' });
    let D = (await w.vu({ vue: 'blocage' })).D;
    assert.deepEqual((D.regles.autorises as Array<Record<string, string>>).map((x) => [x.nom, x.etait]), [['annonces.example', 'Pubs et pisteurs'], ['www.site.test', '']]);
    assert.deepEqual(D.pubsReseaux, { actif: true, sauf: [] });
    assert.equal((await w.act('pubs_reseaux', { actif: true, sauf: 'tiktok' })).ok, true);
    D = (await w.vu({ vue: 'blocage' })).D; assert.deepEqual(D.pubsReseaux, { actif: true, sauf: ['tiktok'] });
  } finally { w.fin(); }
});

test('Sphinx · « Racine seule » : plus aucun secours, et le choix est gardé ; le remettre redonne le secours d\'Odin', async () => {
  const w = await monde();
  try {
    assert.deepEqual((await w.demande('www.muet.test', '192.0.2.150')).an, [PAR_SECOURS], 'témoin : avant, le secours répond');
    w.sec.appels.length = 0;
    assert.equal((await w.act('reglages', { secours: false })).ok, true, '« Racine seule »');
    assert.deepEqual([w.dns().upstreams, w.dns().fallback], [['récursif'], []]);
    const r = await w.demande('www.muet2.muet.test', '192.0.2.150');
    assert.deepEqual([r.rcode, w.sec.appels], [RCODE.SERVFAIL, []], 'la racine ne répond pas : rien ne part au secours');
    // Gardé : choisir la racine de nouveau, changer la façon de bloquer ou autre chose ne le remet pas.
    assert.equal((await w.act('reglages', { amont: 'récursif' })).ok, true);
    assert.equal((await w.act('reglages', { mode: 'nxdomain' })).ok, true);
    assert.equal((await w.act('bloquer', { domaine: 'arcade.example' })).ok, true);
    assert.deepEqual(w.dns().fallback, [], 'le choix « Racine seule » est gardé');
    let D = (await w.vu({ vue: 'serveurs' })).D;
    assert.deepEqual([D.choix, D.secours, D.secoursPossibles], ['racine', [], SECOURS_D_AVANT]);
    assert.equal((await w.act('reglages', { secours: 'peut-être' })).ok, false, 'oui ou non seulement');
    assert.equal((await w.act('reglages', { secours: true })).ok, true);
    D = (await w.vu({ vue: 'serveurs' })).D; assert.deepEqual(D.secours, SECOURS_D_AVANT);
  } finally { w.fin(); }
});

test('Sphinx · un Odin qui n\'a jamais réglé son DNS a la racine ET le secours ; le compte du jour dit quand le secours a servi', async () => {
  const w = await monde();
  try {
    assert.equal(w.ctx.settings.dns, undefined, 'aucun réglage DNS enregistré');
    let D = (await w.vu({ vue: 'serveurs' })).D;
    assert.deepEqual([D.choix, D.amont.map((x: { sorte: string }) => x.sorte), D.secours], ['racine', ['recursif'], SECOURS_D_AVANT]);
    const avant = D.secoursAujourdhui.n as number;   // le journal en mémoire est celui de tout l'essai : on compte ce qui s'ajoute
    assert.match((await w.vu({ vue: 'serveurs' })).r.text, /secours : 9\.9\.9\.9, 1\.1\.1\.1/);
    assert.deepEqual((await w.demande('www.site.test', '192.0.2.150')).an, ['198.51.100.61'], 'la racine répond : elle d\'abord');
    assert.deepEqual(w.sec.appels, []);
    assert.deepEqual((await w.demande('www.muet.test', '192.0.2.150')).an, [PAR_SECOURS], 'la racine ne mène à personne : le secours répond');
    assert.deepEqual(w.sec.appels, [`www.muet.test@${SECOURS_D_AVANT.join(',')}`]);
    D = (await w.vu({ vue: 'serveurs' })).D;
    assert.equal(D.secoursAujourdhui.n, avant + 1); assert.ok(D.secoursAujourdhui.dernier > 0);
    assert.equal(w.ctx.settings.dns, undefined, 'rien n\'a été écrit pour le donner');
  } finally { w.fin(); }
});
