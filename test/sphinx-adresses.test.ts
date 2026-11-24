// Sphinx · Adresses fixes et plan (maquette « Réseau » validée, lot R3). Ce qui est essayé ici :
//  - la vérification PURE d'une adresse à réserver (vidarr/dhcp.ts) : mal écrite, IPv6, 0.0.0.0, diffusion, adresse du
//    réseau, hors du réseau ; l'adresse d'Odin, de la box, du serveur DNS ; déjà réservée, déjà tenue (bail en cours),
//    retenue (appareil bloqué qui ne l'a pas lâchée), signalée « déjà utilisée » ; dans la plage distribuée : acceptée
//    et dite ;
//  - le plan de tout le réseau (la box, Odin, les adresses fixes, la plage, les retenues, les libres) ;
//  - le serveur d'adresses : une adresse réservée sort de la plage, elle n'est JAMAIS donnée à un autre ; jamais deux
//    appareils sur la même adresse ;
//  - dans Sphinx : « Réserver », changer, retirer, par les actions qui existaient déjà (`dhcp_fixe`,
//    `dhcp_retirer_fixe`, au propriétaire seul) ; un appareil bloqué garde son état ; la lecture `plan_adresses` n'écrit
//    rien ; un membre ne voit que son appareil ; tout texte venu du réseau reste nettoyé.
// AUCUN vrai paquet, AUCUN port 67/68 : la prise du serveur d'adresses est simulée. Adresses d'exemple seulement
// (192.0.2.x, 198.51.100.x, 203.0.113.x), MAC de la plage de documentation.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DhcpServer, MSG, buildPacket, ipPropre, parsePacket, planAdresses, premiereLibre, reseauDe, verifierAdresse, type DhcpConfig, type EntreeAdresses, type Lease, type MacPolicy, type Packet, type PlanAdresses, type VerdictAdresse } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL, origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import { PRISE_DHCP, dhcpServer, nomsDhcp, vidarr } from '../src/valhalla/modules/vidarr.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import { REFUS, SPHINX } from './reseau-r1-commun.ts';

const ip4 = (s: string) => Buffer.from(s.split('.').map(Number));
const BOX = '192.0.2.1', ODIN = '192.0.2.2';
const M = { box: '00:00:5e:00:53:01', odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', imp: '00:00:5e:00:53:30', tel: '02:00:5e:00:53:14', cam: '00:00:5e:00:53:31', tv: '00:00:5e:00:53:4a', dns: '00:00:5e:00:53:53' };
const T0 = Date.UTC(2026, 10, 24, 9, 0, 0), H = 3600_000;
const CFG = (plus: Partial<DhcpConfig> = {}): DhcpConfig => ({ server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [], ...plus });
const bail = (mac: string, ip: string, plus: Partial<Lease> = {}): Lease => ({ mac, ip, expires: T0 + 6 * H, first: T0 - 48 * H, since: T0 - H, seen: T0, ...plus });
const entree = (plus: Partial<EntreeAdresses> = {}): EntreeAdresses => ({ config: CFG(), leases: [], now: T0, heure: () => 'HEURE', ...plus });
type Envoi = { p: Packet; vers: string };
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string; tient?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, ciaddr: o.tient ?? '0.0.0.0', options: [[53, Buffer.from([type])], ...(o.nom !== undefined ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, ip4(o.veut)] as [number, Buffer]] : [])] });
const genre = (e?: Envoi) => e?.p.options.get(53)?.[0];

// ------------------------------------------------------------------ la règle pure
test('R3 · une adresse bien écrite : rien d\'autre que quatre nombres de 0 à 255', () => {
  for (const ok of ['192.0.2.24', '0.0.0.0', '255.255.255.255', ' 198.51.100.7\t']) assert.equal(ipPropre(ok), ok.trim(), ok);
  const pieges: unknown[] = ['', ' ', '192.0.2', '192.0.2.24.1', '192.0.2.256', '192.0.2.-1', '192.0.2.024', '0192.0.2.24', '192.0.2.24/24', '192.0.2.24:67', '192.0.2.24 ; rm', '192,0,2,24', '192.0.2.2e1', '0x7f.0.0.1', '3221225496',
    '::1', '2001:db8::24', '::ffff:192.0.2.24', '192.0.2.24\n', '192.0.2.24\u0000', '\u202e192.0.2.24', '192.0.2.24\u2028', '１９２.0.2.24', '192.0.2.٢٤', '192.0.2.24'.padEnd(60, ' '), 3221225496, null, undefined, ['192.0.2.24'], { toString: () => '192.0.2.24' }, true];
  for (const p of pieges) assert.equal(ipPropre(p), '', `refusée : ${JSON.stringify(String(p))}`);
});

test('R3 · le réseau de la maison se lit dans les réglages ; des réglages abîmés ne donnent aucun réseau', () => {
  assert.deepEqual(reseauDe(CFG()), { net: 0xc0000200, diffusion: 0xc00002ff, premiere: 0xc0000201, derniere: 0xc00002fe, prefixe: 24 });
  assert.equal(reseauDe(CFG({ mask: '255.255.255.192', router: '198.51.100.65' }))?.prefixe, 26);
  for (const mask of ['', '255.0.255.0', '255.255.255.255', '255.255.255.254', '0.0.0.0', '128.0.0.0', 'x', '255.255.255']) assert.equal(reseauDe(CFG({ mask })), undefined, `masque « ${mask} »`);
  assert.equal(reseauDe(CFG({ router: 'x', server: 'y' })), undefined);
  const abime = verifierAdresse({ ...entree({ config: CFG({ mask: '255.0.255.0' }) }), mac: M.pc, ip: '192.0.2.24' });
  assert.deepEqual([abime.ok, abime.code], [false, 'reglages']);
  assert.deepEqual([planAdresses(entree({ config: CFG({ mask: '0.0.0.0' }) })).ok, planAdresses(entree({ config: CFG({ mask: '0.0.0.0' }) })).tranches], [false, []]);
});

test('R3 · vérifier une adresse : les valeurs piégées sont refusées (mal écrite, IPv6, 0.0.0.0, diffusion, adresse du réseau, hors du réseau)', () => {
  const v = (ip: unknown, mac = M.pc) => verifierAdresse({ ...entree(), mac, ip });
  const cas: Array<[unknown, VerdictAdresse['code']]> = [
    ['192.0.2', 'ecriture'], ['192.0.2.300', 'ecriture'], ['192.0.2.024', 'ecriture'], ['192.0.2.24/24', 'ecriture'], ['', 'ecriture'], [undefined, 'ecriture'], [3221225496, 'ecriture'], ['192.0.2.24\u0000', 'ecriture'], ['<b>192.0.2.24</b>', 'ecriture'],
    ['2001:db8::24', 'ipv6'], ['::1', 'ipv6'], ['::ffff:192.0.2.24', 'ipv6'], ['fe80::1%eth0', 'ipv6'],
    ['0.0.0.0', 'nulle'], ['255.255.255.255', 'diffusion'], ['192.0.2.255', 'diffusion'], ['192.0.2.0', 'reseau'],
    ['198.51.100.24', 'hors'], ['203.0.113.24', 'hors'], ['192.0.3.24', 'hors'], ['127.0.0.1', 'hors'], ['224.0.0.1', 'hors'],
  ];
  for (const [ip, code] of cas) { const r = v(ip); assert.deepEqual([r.ok, r.code, r.ip], [false, code, ''], `${JSON.stringify(ip)} → ${code} : ${r.message}`); }
  assert.match(v('198.51.100.24').message, /^Adresse hors du réseau de la maison \(192\.0\.2\.1 à 192\.0\.2\.254\)\. Odin propose 192\.0\.2\.3\.$/);
  assert.match(v('2001:db8::24').message, /IPv6/);
  // Le message ne répète jamais ce qui a été tapé : rien de piégé n'en ressort.
  for (const [ip] of cas) assert.doesNotMatch(v(ip).message, /[<>\u0000]|db8|rm /);
  // Une adresse MAC mal écrite.
  for (const mac of ['', 'pas-une-mac', '00:00:5e:00:53', '00:00:5e:00:53:zz', '00:00:5e:00:53:23:01']) assert.deepEqual([v('192.0.2.24', mac).ok, v('192.0.2.24', mac).code], [false, 'mac'], mac);
});

test('R3 · vérifier une adresse : jamais celle d\'Odin, de la box ou du serveur DNS ; jamais celle d\'un autre (réservée, tenue, retenue, signalée)', () => {
  const noms: Record<string, string> = { [M.imp]: 'Imprimante', [M.tel]: 'Téléphone 1', [M.cam]: 'Caméra de l\'entrée' };
  const e = entree({
    config: CFG({ dns: [ODIN, '192.0.2.53'], fixed: [{ mac: M.imp, ip: '192.0.2.30', name: 'Imprimante' }], macPolicy: { mode: 'ouvert', etats: { [M.cam]: 'bloque' }, attente: [] } }),
    leases: [bail(M.tel, '192.0.2.114'), bail(M.cam, '192.0.2.131', { expires: T0, hold: T0 + 3 * H }), bail(M.tv, '192.0.2.140', { expires: T0 - H })],
    signalees: ['192.0.2.77'], odin: ['192.0.2.9'], nom: (m) => noms[m] ?? m,
  });
  const v = (ip: string, mac = M.pc) => verifierAdresse({ ...e, mac, ip });
  const cas: Array<[string, VerdictAdresse['code'], RegExp]> = [
    [ODIN, 'odin', /^Refusé : 192\.0\.2\.2 est l'adresse d'Odin lui-même\./], ['192.0.2.9', 'odin', /Odin lui-même/],
    [BOX, 'box', /^Refusé : 192\.0\.2\.1 est l'adresse de la box, la passerelle de toute la maison\./],
    ['192.0.2.53', 'dns', /serveur DNS de la maison/],
    ['192.0.2.30', 'reservee', /^Refusé : 192\.0\.2\.30 est déjà réservée à « Imprimante »\. Odin propose 192\.0\.2\.3\.$/],
    ['192.0.2.114', 'bail', /^Refusé : 192\.0\.2\.114 est déjà à « Téléphone 1 » \(son bail court jusqu'à HEURE\)\. Odin propose 192\.0\.2\.3\.$/],
    ['192.0.2.131', 'retenue', /^Refusé : 192\.0\.2\.131 est retenue jusqu'à HEURE : « Caméra de l'entrée », bloqué ou en pause, ne l'a peut-être pas encore lâchée\./],
    ['192.0.2.77', 'signalee', /a signalé que 192\.0\.2\.77 est déjà utilisée/],
  ];
  for (const [ip, code, mots] of cas) { const r = v(ip); assert.deepEqual([r.ok, r.code, r.ip], [false, code, ''], `${ip} → ${code}`); assert.match(r.message, mots); }
  assert.equal(v('192.0.2.30').aQui, M.imp); assert.equal(v('192.0.2.114').aQui, M.tel);
  // Un bail FINI et non retenu ne retient pas l'adresse : elle est libre (dans la plage).
  assert.deepEqual([v('192.0.2.140').ok, v('192.0.2.140').code], [true, 'plage']);
  // La sienne : son adresse fixe (rien ne change), l'adresse qu'il tient, celle qui lui est retenue.
  assert.deepEqual([v('192.0.2.30', M.imp).ok, v('192.0.2.30', M.imp).code, v('192.0.2.30', M.imp).message], [true, 'meme', 'C\'est déjà son adresse fixe.']);
  assert.deepEqual([v('192.0.2.114', M.tel).ok, v('192.0.2.114', M.tel).code], [true, 'plage']);
  assert.match(v('192.0.2.114', M.tel).avis.join(' '), /Il tient déjà cette adresse/);
  assert.equal(v('192.0.2.131', M.cam).ok, true, 'un appareil bloqué peut recevoir une réservation…');
  assert.match(v('192.0.2.131', M.cam).avis.join(' '), /Il est bloqué, et il le reste : une adresse fixe ne débloque rien/, '… et il est dit qu\'elle ne débloque rien');
  // Une réservation ancienne ou abîmée : l'adresse est « à lui » mais un autre la tient encore → refusé quand même.
  const abime = { ...e, config: { ...e.config, fixed: [{ mac: M.pc, ip: '192.0.2.114' }] } };
  assert.deepEqual([verifierAdresse({ ...abime, mac: M.pc, ip: '192.0.2.114' }).ok, verifierAdresse({ ...abime, mac: M.pc, ip: '192.0.2.114' }).code], [false, 'bail']);
  // La box, Odin et le serveur DNS : leur adresse ne se change pas d'ici.
  for (const k of ['box', 'odin', 'dns'] as const) { const r = verifierAdresse({ ...e, verrous: { [M.pc]: k }, mac: M.pc, ip: '192.0.2.24' }); assert.deepEqual([r.ok, r.code], [false, 'verrou'], k); }
});

test('R3 · vérifier une adresse : libre hors de la plage ; dans la plage distribuée elle est acceptée et retirée de la plage ; ce qu\'il faut savoir est dit', () => {
  const e = entree({ config: CFG({ fixed: [{ mac: M.pc, ip: '192.0.2.150', name: 'PC du bureau' }], macPolicy: { mode: 'liste', etats: { [M.pc]: 'actif', [M.cam]: 'pause' }, attente: [M.tv] } }), leases: [bail(M.pc, '192.0.2.150', { fixed: true }), bail(M.imp, '192.0.2.101')] });
  const libre = verifierAdresse({ ...e, mac: M.imp, ip: '192.0.2.24' });
  assert.deepEqual([libre.ok, libre.code, libre.ip, libre.message, libre.dansPlage, libre.proposee], [true, 'libre', '192.0.2.24', 'Libre.', false, '192.0.2.3']);
  assert.match(libre.avis.join('\n'), /Il tient encore 192\.0\.2\.101 : il passera à 192\.0\.2\.24 à son prochain renouvellement, au plus tard à HEURE \(ou dès qu'il se reconnecte\)\./);
  const plage = verifierAdresse({ ...e, mac: M.imp, ip: '192.0.2.160' });
  assert.deepEqual([plage.ok, plage.code, plage.dansPlage], [true, 'plage', true]);
  assert.equal(plage.message, 'Dans la plage distribuée : Odin la retire de la plage pour qu\'aucun autre appareil ne la reçoive.');
  // Changer une réservation : l'ancienne adresse redevient libre (et revient dans la plage si elle y était).
  const change = verifierAdresse({ ...e, mac: M.pc, ip: '192.0.2.23' });
  assert.equal(change.ok, true);
  assert.match(change.avis.join('\n'), /Son ancienne adresse fixe 192\.0\.2\.150 redevient libre : elle revient dans la plage distribuée\./);
  // En pause, en attente (liste d'autorisation), adresse MAC privée, box qui distribue.
  assert.match(verifierAdresse({ ...e, mac: M.cam, ip: '192.0.2.31' }).avis.join('\n'), /Il est en pause, et il le reste/);
  assert.match(verifierAdresse({ ...e, mac: M.tv, ip: '192.0.2.40' }).avis.join('\n'), /Seuls les appareils approuvés reçoivent une adresse : lui en réserver une vaut accord/);
  assert.match(verifierAdresse({ ...e, mac: M.tel, ip: '192.0.2.14' }).avis.join('\n'), /Adresse MAC privée/);
  assert.match(verifierAdresse({ ...e, allume: false, mac: M.imp, ip: '192.0.2.24' }).avis.join('\n'), /la box distribue les adresses : c'est noté/);
  assert.match(verifierAdresse({ ...e, leases: [], mac: M.imp, ip: '192.0.2.24' }).avis.join('\n'), /Prise en compte dès qu'il demandera une adresse à Odin\./);
  // Un appareil réglé à la main ne se voit que par le DNS d'Odin : c'est dit, sans refuser.
  const vue = verifierAdresse({ ...e, vues: ['192.0.2.24', '192.0.2.101'], mac: M.tv, ip: '192.0.2.24' });
  assert.equal(vue.ok, true); assert.match(vue.avis.join(' '), /Une question a été posée au DNS d'Odin depuis 192\.0\.2\.24 il y a peu : un appareil réglé à la main l'utilise peut-être déjà/);
  assert.doesNotMatch(verifierAdresse({ ...e, vues: ['192.0.2.101'], mac: M.imp, ip: '192.0.2.101' }).avis.join(' '), /réglé à la main/, 'l\'adresse qu\'il tient lui-même : rien à signaler');
  // La vérification ne change rien à ce qu'on lui donne.
  const avant = JSON.stringify(e); verifierAdresse({ ...e, mac: M.imp, ip: '192.0.2.160' }); planAdresses(e); premiereLibre(e);
  assert.equal(JSON.stringify(e), avant, 'pure : rien n\'est modifié');
});

test('R3 · la première adresse libre : hors de la plage distribuée d\'abord, jamais une adresse prise ou gardée', () => {
  assert.equal(premiereLibre(entree()), '192.0.2.3', 'après la box (.1) et Odin (.2)');
  assert.equal(premiereLibre(entree({ config: CFG({ fixed: [{ mac: M.pc, ip: '192.0.2.3' }], dns: [ODIN, '192.0.2.5'] }), leases: [bail(M.tv, '192.0.2.4')], signalees: ['192.0.2.6'] })), '192.0.2.7');
  // Toute la place hors de la plage est prise : Odin propose dans la plage (elle en sortira).
  const plein = entree({ config: CFG({ mask: '255.255.255.248', router: '192.0.2.1', start: '192.0.2.4', end: '192.0.2.6', fixed: [{ mac: M.pc, ip: '192.0.2.3' }] }), leases: [bail(M.tv, '192.0.2.4')] });
  assert.equal(premiereLibre(plein), '192.0.2.5');
  assert.equal(premiereLibre({ ...plein, leases: [bail(M.tv, '192.0.2.4'), bail(M.imp, '192.0.2.5'), bail(M.cam, '192.0.2.6')] }), '', 'plus rien de libre : rien n\'est proposé');
  assert.match(verifierAdresse({ ...plein, leases: [bail(M.tv, '192.0.2.4'), bail(M.imp, '192.0.2.5'), bail(M.cam, '192.0.2.6')], mac: M.tel, ip: '192.0.2.4' }).message, /Il ne reste aucune adresse libre\.$/);
});

const somme = (p: PlanAdresses) => p.tranches.reduce((n, t) => n + t.n, 0);
test('R3 · le plan : tout le réseau, de la première à la dernière adresse (la box, Odin, les adresses fixes, la plage, les retenues, les libres)', () => {
  const e = entree({
    config: CFG({ fixed: [{ mac: M.pc, ip: '192.0.2.23' }, { mac: M.imp, ip: '192.0.2.30' }, { mac: M.cam, ip: '192.0.2.31' }, { mac: M.tv, ip: '192.0.2.150' }] }),
    leases: [bail(M.pc, '192.0.2.23', { fixed: true }), bail(M.tel, '192.0.2.100'), bail('00:00:5e:00:53:a1', '192.0.2.101'), bail('00:00:5e:00:53:a2', '192.0.2.120', { expires: T0, hold: T0 + H }), bail('00:00:5e:00:53:a3', '192.0.2.121', { expires: T0 - H })],
  });
  const p = planAdresses(e);
  assert.deepEqual([p.ok, p.reseau, p.premiere, p.derniere, p.total, p.box, p.odin, p.proposee], [true, '192.0.2.0/24', '192.0.2.1', '192.0.2.254', 254, BOX, ODIN, '192.0.2.3']);
  assert.deepEqual(p.tranches.map((t) => `${t.de}${t.n > 1 ? `-${t.a.split('.').pop()}` : ''} ${t.sorte}`), [
    '192.0.2.1 box', '192.0.2.2 odin', '192.0.2.3-22 libre', '192.0.2.23 fixe', '192.0.2.24-29 libre', '192.0.2.30-31 fixe', '192.0.2.32-99 libre',
    '192.0.2.100-101 bail', '192.0.2.102-119 plage', '192.0.2.120 retenue', '192.0.2.121-149 plage', '192.0.2.150 fixe', '192.0.2.151-199 plage', '192.0.2.200-254 libre',
  ]);
  assert.equal(somme(p), 254, 'aucune adresse oubliée, aucune comptée deux fois');
  assert.deepEqual(p.comptes, { box: 1, odin: 1, dns: 0, fixe: 4, bail: 2, retenue: 1, plage: 96, libre: 149 });
  assert.deepEqual(p.plage, { debut: '192.0.2.100', fin: '192.0.2.199', taille: 100, prises: 2, fixes: 1, retenues: 1, libres: 96 }, 'l\'adresse fixe dans la plage en est sortie : elle n\'est plus comptée « libre »');
  // Un serveur DNS à part ; une plage à l'envers ou hors du réseau ne casse rien.
  assert.equal(planAdresses(entree({ config: CFG({ dns: ['192.0.2.53'] }) })).comptes.dns, 1);
  for (const c of [CFG({ start: '192.0.2.199', end: '192.0.2.100' }), CFG({ start: '198.51.100.10', end: '198.51.100.50' }), CFG({ start: 'x', end: 'y' })]) { const q = planAdresses(entree({ config: c })); assert.deepEqual([q.ok, q.plage.taille, somme(q), q.comptes.plage], [true, 0, 254, 0]); }
  assert.deepEqual(planAdresses(entree({ config: CFG({ start: '192.0.2.250', end: '192.0.3.20' }) })).plage, { debut: '192.0.2.250', fin: '192.0.2.254', taille: 5, prises: 0, fixes: 0, retenues: 0, libres: 5 }, 'une plage qui dépasse est ramenée dans le réseau');
  // Un grand réseau : le plan ne dépend pas de sa taille.
  const t = Date.now(), grand = planAdresses(entree({ config: CFG({ mask: '255.0.0.0', router: '10.0.0.1', server: '10.0.0.2', dns: ['10.0.0.2'], start: '10.0.1.0', end: '10.0.1.255', fixed: [{ mac: M.pc, ip: '10.200.0.7' }] }) }));
  assert.deepEqual([grand.total, somme(grand), grand.tranches.length, grand.comptes.fixe, grand.proposee], [16777214, 16777214, 7, 1, '10.0.0.3']);
  assert.ok(Date.now() - t < 1000, 'calculé tout de suite');
});

// ------------------------------------------------------------------ le serveur d'adresses (prise simulée)
function serveurSeul(cfg: DhcpConfig, depart: Lease[] = []) {
  let leases = depart; const envois: Envoi[] = []; let now = T0;
  const srv = new DhcpServer({ config: () => cfg, leases: () => leases, save: (l) => { leases = l; }, now: () => now });
  (srv as unknown as { sock: unknown }).sock = { send: (b: Buffer, _port: number, vers: string) => { envois.push({ p: parsePacket(b), vers }); }, close: () => {} };
  const dit = (b: Buffer) => { const n = envois.length; srv.onMessage(b); return envois[n]; };
  const prend = (mac: string) => { const offre = dit(paquet(mac, MSG.DISCOVER)); assert.equal(genre(offre), MSG.OFFER, `${mac} : une offre`); assert.equal(genre(dit(paquet(mac, MSG.REQUEST, { veut: offre.p.yiaddr }))), MSG.ACK, `${mac} : accord`); return offre.p.yiaddr; };
  return { srv, cfg, dit, prend, leases: () => leases, bail: (mac: string) => leases.find((l) => l.mac === mac), avance: (ms: number) => { now += ms; } };
}

test('R3 · serveur d\'adresses : une adresse réservée sort de la plage, elle n\'est jamais donnée à un autre (même à celui qui la tenait avant)', () => {
  // La télévision a tenu 192.0.2.100 (bail fini). Le propriétaire réserve cette adresse à l'imprimante.
  const s = serveurSeul(CFG({ fixed: [{ mac: M.imp, ip: '192.0.2.100', name: 'Imprimante' }] }), [bail(M.tv, '192.0.2.100', { expires: T0 - H })]);
  // Un autre appareil : jamais l'adresse réservée, même s'il la demande.
  assert.equal(s.dit(paquet(M.pc, MSG.DISCOVER, { veut: '192.0.2.100' })).p.yiaddr, '192.0.2.101');
  assert.equal(genre(s.dit(paquet(M.pc, MSG.REQUEST, { veut: '192.0.2.100' }))), MSG.NAK, 'la demander de force : refus net');
  // La télévision revient : son vieux bail ne lui rend PAS l'adresse réservée à un autre.
  const tv = s.dit(paquet(M.tv, MSG.DISCOVER));
  assert.equal(genre(tv), MSG.OFFER); assert.notEqual(tv.p.yiaddr, '192.0.2.100', 'jamais deux appareils sur la même adresse');
  assert.equal(genre(s.dit(paquet(M.tv, MSG.REQUEST, { veut: '192.0.2.100' }))), MSG.NAK);
  // L'imprimante, elle, la reçoit ; son bail est « fixe ».
  assert.equal(s.prend(M.imp), '192.0.2.100'); assert.equal(s.bail(M.imp)?.fixed, true);
  // La plage est pleine : Odin ne « reprend » jamais une adresse réservée pour un nouveau venu.
  const petit = serveurSeul(CFG({ start: '192.0.2.100', end: '192.0.2.101', fixed: [{ mac: M.imp, ip: '192.0.2.100' }] }), [bail(M.tv, '192.0.2.100', { expires: T0 - 2 * H }), bail(M.cam, '192.0.2.101')]);
  assert.equal(petit.dit(paquet(M.pc, MSG.DISCOVER)), undefined, 'plus d\'adresse libre : aucune offre, plutôt qu\'une adresse réservée');
});

test('R3 · serveur d\'adresses : jamais deux appareils sur la même adresse quand un autre tient encore l\'adresse réservée', () => {
  // Réglage ancien ou écrit à la main : 192.0.2.120 est réservée au PC alors que la caméra la tient encore.
  const s = serveurSeul(CFG({ fixed: [{ mac: M.pc, ip: '192.0.2.120' }] }), [bail(M.cam, '192.0.2.120', { expires: T0 + 2 * H })]);
  const ip = s.prend(M.pc);
  assert.notEqual(ip, '192.0.2.120', 'en attendant, une adresse de la plage'); assert.equal(s.bail(M.pc)?.fixed, undefined, 'son bail n\'est pas noté « fixe » : ce n\'est pas son adresse réservée');
  assert.equal(s.bail(M.cam)?.ip, '192.0.2.120', 'le bail de la caméra n\'a pas été écrasé');
  // La caméra a lâché l'adresse (bail fini) : au renouvellement, le PC passe à son adresse réservée.
  s.avance(3 * H);
  assert.equal(genre(s.dit(paquet(M.pc, MSG.REQUEST, { tient: ip }))), MSG.NAK, 'son adresse d\'attente n\'est pas renouvelée');
  assert.equal(s.prend(M.pc), '192.0.2.120'); assert.equal(s.bail(M.pc)?.fixed, true);
  // Une adresse retenue (appareil bloqué qui ne l'a pas encore lâchée) compte comme tenue.
  const r = serveurSeul(CFG({ fixed: [{ mac: M.pc, ip: '192.0.2.130' }] }), [bail(M.cam, '192.0.2.130', { expires: T0 - 1, hold: T0 + 2 * H })]);
  assert.notEqual(r.prend(M.pc), '192.0.2.130');
  // Une réservation abîmée qui vise l'adresse d'Odin ou de la box n'est jamais servie.
  for (const cible of [ODIN, BOX]) { const x = serveurSeul(CFG({ fixed: [{ mac: M.pc, ip: cible }] })); assert.equal(x.prend(M.pc), '192.0.2.100', `jamais ${cible}`); }
  // L'adresse du serveur DNS de la maison n'est donnée qu'à lui.
  const d = serveurSeul(CFG({ dns: ['192.0.2.100'] }), [bail(M.dns, '192.0.2.100', { expires: T0 - H })]);
  assert.equal(d.prend(M.pc), '192.0.2.101', 'pas à un autre'); assert.equal(d.prend(M.dns), '192.0.2.100', 'à lui, oui');
});

test('R3 · serveur d\'adresses : une adresse fixe signalée « déjà utilisée » n\'est plus proposée ; une réservation retirée rend l\'appareil à la plage', () => {
  const cfg = CFG({ fixed: [{ mac: M.imp, ip: '192.0.2.30', name: 'Imprimante' }] }), s = serveurSeul(cfg);
  assert.equal(s.prend(M.imp), '192.0.2.30');
  // L'imprimante trouve quelqu'un d'autre sur son adresse (réglée à la main ailleurs) et le signale.
  s.dit(paquet(M.imp, MSG.DECLINE, { veut: '192.0.2.30' }));
  assert.deepEqual(s.srv.signalees(), ['192.0.2.30']);
  assert.equal(s.dit(paquet(M.imp, MSG.DISCOVER)).p.yiaddr, '192.0.2.100', 'Odin ne lui repropose pas l\'adresse en conflit');
  assert.equal(verifierAdresse({ config: cfg, leases: s.leases(), now: T0, signalees: s.srv.signalees(), mac: M.pc, ip: '192.0.2.30' }).ok, false);
  s.avance(2 * H); assert.deepEqual(s.srv.signalees(), [], 'une heure plus tard, le signalement est oublié');
  // La réservation est retirée : il garde l'adresse hors plage jusqu'à la fin de son bail (ni rallongé, ni cassé), puis
  // elle n'est plus la sienne et il reprend une adresse de la plage.
  const t = serveurSeul(CFG({ fixed: [{ mac: M.imp, ip: '192.0.2.30' }] })); assert.equal(t.prend(M.imp), '192.0.2.30');
  t.cfg.fixed = [];
  assert.equal(t.dit(paquet(M.imp, MSG.REQUEST, { tient: '192.0.2.30' })), undefined);
  t.avance(13 * H);
  assert.equal(genre(t.dit(paquet(M.imp, MSG.REQUEST, { tient: '192.0.2.30' }))), MSG.NAK);
  assert.equal(t.prend(M.imp), '192.0.2.100');
});

// ------------------------------------------------------------------ dans Sphinx (vrai module, prise simulée)
const dossiers: string[] = [];
const PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs;
after(() => { PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
type Fixe = { mac: string; ip: string; nom: string; type: string; nomReseau: string; garde: string; etat: string; tient: string; ici: boolean };
type Donnees = { proprietaire: boolean; limite: string; plan: PlanAdresses | null; fixes: Fixe[]; appareils: Array<{ mac: string; nom: string; ip: string }>; verdict: VerdictAdresse | null };
const PIEGE = '<img src=x onerror=alert(1)>Cam';

/** Un Odin d'essai avec Sphinx seul : aucune commande, aucune sortie réseau, la prise du DHCP simulée. */
async function monde(o: { allume?: boolean; cfg?: Partial<DhcpConfig> } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-r3-')); dossiers.push(home);
  const envois: Envoi[] = []; let now = T0;
  PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer, _p: number, vers: string) => { envois.push({ p: parsePacket(b), vers }); }, close: () => {} }; };
  LOCAL.macs = () => [M.odin];
  setVerificateur(() => undefined);
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }), fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(now) });
  const ctx = v.ctx('vidarr');
  ctx.saveSettings({ dhcp: CFG(o.cfg) });
  if (o.allume !== false) { const r = await v.act('vidarr', 'dhcp_demarrer', { forcer: true }); assert.equal(r.ok !== false, true, r.text); }
  const dit = (b: Buffer) => { const n = envois.length; dhcpServer()!.onMessage(b); return envois[n]; };
  const prend = (mac: string, nom?: string) => { const offre = dit(paquet(mac, MSG.DISCOVER, { nom })); assert.equal(genre(offre), MSG.OFFER, `${mac} : une offre`); assert.equal(genre(dit(paquet(mac, MSG.REQUEST, { nom, veut: offre.p.yiaddr }))), MSG.ACK); return offre.p.yiaddr; };
  const act = (a: string, i: Record<string, unknown> = {}, opts?: Parameters<Valhalla['act']>[3]) => v.act('vidarr', a, i, opts);
  const plan = async (i: Record<string, unknown> = {}) => { const r = await act('plan_adresses', i); return { r, D: r.data as Donnees }; };
  const fixes = () => ((ctx.settings.dhcp as DhcpConfig).fixed ?? []).map((f) => `${f.mac} ${f.ip}${f.name ? ` ${f.name}` : ''}`);
  const baux = () => (ctx.settings.leases as Lease[] | undefined) ?? [];
  const etats = () => (ctx.settings.macPolicy as MacPolicy | undefined)?.etats ?? {};
  return { v, ctx, dit, prend, act, plan, fixes, baux, etats, avance: (ms: number) => { now += ms; }, fin: () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; } };
}

test('R3 · Sphinx : aucune action nouvelle qui écrit ; « plan_adresses » est une lecture, sa réponse une donnée venue du réseau', async () => {
  const w = await monde({ allume: false });
  try {
    const m = w.v.module('vidarr')!, ecrit = m.actions.filter((a) => !a.read).map((a) => a.id).filter((id) => id !== 'qui_a_fait');
    assert.deepEqual(ecrit.filter((id) => !SPHINX.includes(id)), [], 'la liste exacte du lot R1 n\'a pas bougé');
    const a = m.actions.find((x) => x.id === 'plan_adresses')!;
    assert.deepEqual([a.read, a.external, a.grave], [true, true, undefined]);
    // Une lecture, mais au propriétaire en personne (un membre connecté à l'interface n'y voit que son appareil).
    assert.equal(typeof a.proprietaireSeul === 'function' && a.proprietaireSeul({}, undefined), true);
    assert.equal(auNomDe({ login: 'nour', name: 'Nour', groups: ['famille'] }, () => (a.proprietaireSeul as () => boolean)()), false);
    for (const id of ['dhcp_fixe', 'dhcp_retirer_fixe']) assert.equal(m.actions.find((x) => x.id === id)!.proprietaireSeul, true, `${id} : propriétaire seul`);
  } finally { w.fin(); }
});

test('R3 · Sphinx : réserver une adresse fixe ; les refus n\'écrivent rien ; dans la plage, elle en sort et n\'est donnée à personne d\'autre', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-BUREAU'), ipTel = w.prend(M.tel, 'Telephone 1');
    assert.deepEqual([ipPc, ipTel], ['192.0.2.100', '192.0.2.101']);
    // Tous les refus : rien n'est écrit.
    const avant = JSON.stringify(w.ctx.settings);
    const refus: Array<[Record<string, unknown>, RegExp]> = [
      [{ mac: M.pc, ip: '192.0.2' }, /adresse mal écrite/], [{ mac: M.pc, ip: '192.0.2.024' }, /adresse mal écrite/], [{ mac: M.pc, ip: '' }, /adresse mal écrite|obligatoire|manque/i], [{ mac: M.pc, ip: '2001:db8::24' }, /IPv6/],
      [{ mac: M.pc, ip: '0.0.0.0' }, /aucune adresse/], [{ mac: M.pc, ip: '255.255.255.255' }, /diffusion/], [{ mac: M.pc, ip: '192.0.2.255' }, /diffusion/], [{ mac: M.pc, ip: '192.0.2.0' }, /adresse du réseau/],
      [{ mac: M.pc, ip: '198.51.100.24' }, /hors du réseau de la maison/], [{ mac: M.pc, ip: '203.0.113.24' }, /hors du réseau de la maison/],
      [{ mac: M.pc, ip: ODIN }, /Odin lui-même/], [{ mac: M.pc, ip: BOX }, /la box/], [{ mac: M.pc, ip: ipTel }, /déjà à « Telephone 1 »/],
      [{ mac: 'pas-une-mac', ip: '192.0.2.24' }, /adresse MAC invalide/], [{ mac: M.odin, ip: '192.0.2.24' }, /Odin lui-même/],
    ];
    for (const [i, mots] of refus) { const r = await w.act('dhcp_fixe', i); assert.equal(r.ok, false, JSON.stringify(i)); assert.match(r.text, mots, JSON.stringify(i)); }
    assert.equal(JSON.stringify(w.ctx.settings), avant, 'aucun refus n\'écrit quoi que ce soit');
    // Hors de la plage : « Libre ».
    let r = await w.act('dhcp_fixe', { mac: 'AA-BB-CC-DD-EE-01'.replace(/AA-BB-CC-DD-EE/, '00-00-5E-00-53').replace(/01$/, '30'), ip: '192.0.2.30', nom: 'Imprimante' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^📌 Imprimante aura toujours 192\.0\.2\.30 \(et le nom imprimante\.maison\)\.\n- Prise en compte dès qu'il demandera une adresse à Odin\.$/);
    assert.deepEqual(w.fixes(), [`${M.imp} 192.0.2.30 Imprimante`], 'l\'adresse MAC est rangée sous sa forme simple');
    // Déjà réservée à un autre.
    r = await w.act('dhcp_fixe', { mac: M.tv, ip: '192.0.2.30' });
    assert.equal(r.ok, false); assert.match(r.text, /192\.0\.2\.30 est déjà réservée à « Imprimante »\. Odin propose 192\.0\.2\.3\./);
    // Dans la plage : acceptée, et retirée de la plage. Le PC la tient déjà.
    r = await w.act('dhcp_fixe', { mac: M.pc, ip: ipPc, nom: 'PC du bureau' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^📌 PC du bureau aura toujours 192\.0\.2\.100 \(et le nom pc-du-bureau\.maison\)\.\n- Dans la plage distribuée : Odin la retire de la plage pour qu'aucun autre appareil ne la reçoive\.\n- Il tient déjà cette adresse : rien ne change pour lui, elle lui reste\.$/);
    assert.deepEqual([w.baux().find((l) => l.mac === M.pc)?.fixed, w.baux().find((l) => l.mac === M.pc)?.name, w.baux().find((l) => l.mac === M.pc)?.named], [true, 'PC du bureau', true]);
    assert.deepEqual(nomsDhcp(w.ctx)['pc-du-bureau.maison'], [ipPc], 'son nom est servi par le DNS');
    // Le PC s'éteint, son bail finit : un autre appareil ne reçoit JAMAIS son adresse.
    w.avance(13 * H);
    const autres = [M.tv, M.cam, '00:00:5e:00:53:a1', '00:00:5e:00:53:a2'].map((mac) => w.prend(mac));
    assert.ok(!autres.includes(ipPc), `aucun autre n'a reçu ${ipPc} : ${autres.join(', ')}`);
    assert.equal(genre(w.dit(paquet('00:00:5e:00:53:a3', MSG.REQUEST, { veut: ipPc }))), MSG.NAK);
    assert.equal(w.prend(M.pc), ipPc, 'le PC la retrouve');
    // Le plan le dit.
    const { D } = await w.plan();
    assert.equal(D.plan!.plage.fixes, 1); assert.ok(D.plan!.tranches.some((t) => t.de === ipPc && t.n === 1 && t.sorte === 'fixe'));
  } finally { w.fin(); }
});

test('R3 · Sphinx : un appareil bloqué garde son état ; une réservation ne débloque rien (ni réserver, ni changer, ni retirer)', async () => {
  const w = await monde();
  try {
    const ipCam = w.prend(M.cam, 'Camera'), ipTv = w.prend(M.tv, 'Tele');
    assert.equal((await w.act('dhcp_mac_etat', { mac: M.cam, etat: 'bloque' })).ok, true);
    assert.equal((await w.act('dhcp_mac_etat', { mac: M.tv, etat: 'pause' })).ok, true);
    let r = await w.act('dhcp_fixe', { mac: M.cam, ip: '192.0.2.31', nom: 'Caméra de l\'entrée' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Il est bloqué, et il le reste : une adresse fixe ne débloque rien/);
    assert.doesNotMatch(r.text, /et le nom/, 'un appareil bloqué n\'a pas de nom sur le réseau : la réponse ne le promet pas');
    assert.equal(w.etats()[M.cam], 'bloque');
    // Bloqué : il n'obtient toujours rien, même avec une adresse fixe.
    assert.equal(w.dit(paquet(M.cam, MSG.DISCOVER)), undefined, 'aucune offre');
    assert.equal(genre(w.dit(paquet(M.cam, MSG.REQUEST, { tient: ipCam }))), MSG.NAK, 'refus net de l\'adresse qu\'il tenait');
    assert.equal(w.dit(paquet(M.cam, MSG.REQUEST, { veut: '192.0.2.31' })), undefined, 'et rien pour son adresse fixe');
    // Changer la réservation, puis la retirer : toujours bloqué.
    r = await w.act('dhcp_fixe', { mac: M.cam, ip: '192.0.2.32' });
    assert.equal(r.ok, true, r.text); assert.equal(w.etats()[M.cam], 'bloque'); assert.deepEqual(w.fixes(), [`${M.cam} 192.0.2.32 Caméra de l'entrée`], 'le nom d\'avant est gardé');
    r = await w.act('dhcp_retirer_fixe', { mac: M.cam });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Il reste bloqué\./); assert.equal(w.etats()[M.cam], 'bloque');
    // En pause : pareil.
    r = await w.act('dhcp_fixe', { mac: M.tv, ip: '192.0.2.40' });
    assert.match(r.text, /Il est en pause, et il le reste/); assert.equal(w.etats()[M.tv], 'pause');
    assert.equal(genre(w.dit(paquet(M.tv, MSG.REQUEST, { tient: ipTv }))), MSG.NAK);
    // L'adresse d'un appareil bloqué, retenue jusqu'à la fin de son bail d'origine, ne se réserve pas pour un autre.
    r = await w.act('dhcp_fixe', { mac: M.pc, ip: ipCam });
    assert.equal(r.ok, false); assert.match(r.text, /est retenue jusqu'à/);
    w.avance(13 * H);
    assert.equal((await w.act('dhcp_fixe', { mac: M.pc, ip: ipCam })).ok, true, 'après la fin du bail d\'origine, elle est libre');
  } finally { w.fin(); }
});

test('R3 · Sphinx : changer puis retirer une réservation ; l\'appareil suit au renouvellement, l\'ancienne adresse redevient libre', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-BUREAU');
    assert.equal((await w.act('dhcp_fixe', { mac: M.pc, ip: '192.0.2.23', nom: 'PC du bureau' })).ok, true);
    assert.equal(w.baux().find((l) => l.mac === M.pc)?.fixed, undefined, 'il tient encore son adresse de la plage : son bail n\'est pas « fixe »');
    let { D } = await w.plan();
    assert.deepEqual(D.fixes.map((f) => [f.mac, f.ip, f.nom, f.tient, f.nomReseau]), [[M.pc, '192.0.2.23', 'PC du bureau', ipPc, 'pc-du-bureau.maison']], 'le plan dit qu\'il tient encore l\'autre adresse');
    // Au renouvellement : refus net de l'ancienne, puis son adresse fixe.
    assert.equal(genre(w.dit(paquet(M.pc, MSG.REQUEST, { tient: ipPc }))), MSG.NAK);
    assert.equal(w.prend(M.pc), '192.0.2.23'); assert.equal(w.baux().find((l) => l.mac === M.pc)?.fixed, true);
    // Changer : 192.0.2.23 → 192.0.2.24.
    let r = await w.act('dhcp_fixe', { mac: M.pc, ip: '192.0.2.24' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /Son ancienne adresse fixe 192\.0\.2\.23 redevient libre\./); assert.match(r.text, /Il tient encore 192\.0\.2\.23 : il passera à 192\.0\.2\.24 à son prochain renouvellement/);
    assert.deepEqual(w.fixes(), [`${M.pc} 192.0.2.24 PC du bureau`]); assert.equal(w.baux().find((l) => l.mac === M.pc)?.fixed, undefined);
    // Tant qu'il tient encore 192.0.2.23, elle ne se réserve pas pour un autre (jamais deux sur la même).
    r = await w.act('dhcp_fixe', { mac: M.imp, ip: '192.0.2.23' });
    assert.equal(r.ok, false); assert.match(r.text, /192\.0\.2\.23 est déjà à « PC du bureau »/);
    assert.equal(genre(w.dit(paquet(M.pc, MSG.REQUEST, { tient: '192.0.2.23' }))), MSG.NAK); assert.equal(w.prend(M.pc), '192.0.2.24');
    assert.equal((await w.act('dhcp_fixe', { mac: M.imp, ip: '192.0.2.23', nom: 'Imprimante' })).ok, true, 'une fois lâchée, elle est libre');
    // Deux appareils veulent le même nom : dit franchement.
    r = await w.act('dhcp_fixe', { mac: M.tv, ip: '192.0.2.41', nom: 'PC du bureau' });
    assert.equal(r.ok, true); assert.match(r.text, /Le nom pc-du-bureau\.maison est déjà porté par un autre appareil/);
    // Retirer.
    r = await w.act('dhcp_retirer_fixe', { mac: 'pas-une-mac' }); assert.equal(r.ok, false);
    r = await w.act('dhcp_retirer_fixe', { mac: M.cam }); assert.equal(r.ok, false); assert.match(r.text, /aucune adresse fixe pour cet appareil/);
    r = await w.act('dhcp_retirer_fixe', { mac: M.pc.toUpperCase().replace(/:/g, '-') });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^🗑 Adresse fixe retirée : PC du bureau n'a plus 192\.0\.2\.24 en réserve\.\n- Il la tient encore : il la garde jusqu'à la fin de son bail \(.+\), puis Odin lui donne une adresse de la plage\.\n- 192\.0\.2\.24 redevient libre dès qu'il l'aura lâchée\.$/);
    assert.equal(w.baux().find((l) => l.mac === M.pc)?.fixed, undefined, 'son bail n\'est plus « fixe »');
    assert.equal(w.dit(paquet(M.pc, MSG.REQUEST, { tient: '192.0.2.24' })), undefined, 'son bail en cours va jusqu\'au bout : ni rallongé, ni cassé');
    w.avance(13 * H);
    assert.equal(genre(w.dit(paquet(M.pc, MSG.REQUEST, { tient: '192.0.2.24' }))), MSG.NAK);
    assert.match(w.prend(M.pc), /^192\.0\.2\.1[0-9][0-9]$/, 'il reprend une adresse de la plage');
    ({ D } = await w.plan());
    assert.deepEqual(D.fixes.map((f) => f.mac).sort(), [M.imp, M.tv].sort());
  } finally { w.fin(); }
});

test('R3 · Sphinx : la box, Odin et le serveur DNS de la maison sont verrouillés ; en liste d\'autorisation une adresse fixe vaut accord, et c\'est dit', async () => {
  const w = await monde({ cfg: { dns: ['192.0.2.53'], fixed: [{ mac: M.box, ip: BOX, name: 'Box internet' }, { mac: M.dns, ip: '192.0.2.53', name: 'Serveur DNS' }] } });
  try {
    assert.equal(w.prend(M.dns), '192.0.2.53');
    for (const [mac, mots] of [[M.box, /cet appareil est la box/], [M.dns, /cet appareil est le serveur DNS de la maison/], [M.odin, /cet appareil est Odin lui-même/]] as const) {
      const r = await w.act('dhcp_fixe', { mac, ip: '192.0.2.60' }); assert.equal(r.ok, false, mac); assert.match(r.text, mots);
    }
    let r = await w.act('dhcp_fixe', { mac: M.pc, ip: '192.0.2.53' });
    assert.equal(r.ok, false); assert.match(r.text, /serveur DNS de la maison/);
    r = await w.act('dhcp_retirer_fixe', { mac: M.dns });
    assert.equal(r.ok, false); assert.match(r.text, /refusé : « Serveur DNS » est le serveur DNS de la maison/);
    assert.equal(w.fixes().length, 2, 'rien n\'a bougé');
    const { D } = await w.plan();
    assert.deepEqual(D.fixes.map((f) => [f.mac, f.garde]), [[M.box, 'box'], [M.dns, 'dns']]);
    assert.deepEqual(D.appareils, [], 'ni la box ni le serveur DNS ne sont proposés pour une réservation');
    // Liste d'autorisation : un inconnu attend ; lui réserver une adresse vaut accord, c'est dit, et il n'attend plus.
    assert.equal((await w.act('dhcp_mode', { mode: 'liste' })).ok, true);
    assert.equal(w.dit(paquet(M.tv, MSG.DISCOVER, { nom: 'Tele' })), undefined, 'inconnu : aucune offre');
    assert.deepEqual((w.ctx.settings.macPolicy as MacPolicy).attente, [M.tv]);
    r = await w.act('dhcp_fixe', { mac: M.tv, ip: '192.0.2.40', nom: 'Télévision' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Seuls les appareils approuvés reçoivent une adresse : lui en réserver une vaut accord/);
    assert.deepEqual((w.ctx.settings.macPolicy as MacPolicy).attente, []); assert.equal(w.etats()[M.tv], undefined, 'son état n\'est pas écrit : l\'accord tient à la réservation');
    assert.equal(w.prend(M.tv), '192.0.2.40');
  } finally { w.fin(); }
});

test('R3 · Sphinx : « plan_adresses » montre le plan et vérifie une adresse sans rien écrire ; un nom piégé reste nettoyé', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-BUREAU'), ipCam = w.prend(M.cam, PIEGE);
    assert.equal((await w.act('dhcp_fixe', { mac: M.imp, ip: '192.0.2.30', nom: `<script>alert(1)</script>Imprimante\u202e\u0000` })).ok, true);
    const avant = JSON.stringify(w.ctx.settings);
    let { r, D } = await w.plan();
    assert.equal(r.ok !== false, true, r.text);
    assert.deepEqual([D.proprietaire, D.limite, D.verdict], [true, '', null]);
    assert.deepEqual([D.plan!.ok, D.plan!.premiere, D.plan!.derniere, D.plan!.box, D.plan!.odin, D.plan!.proposee], [true, '192.0.2.1', '192.0.2.254', BOX, ODIN, '192.0.2.3']);
    assert.deepEqual(D.plan!.plage, { debut: '192.0.2.100', fin: '192.0.2.199', taille: 100, prises: 2, fixes: 0, retenues: 0, libres: 98 });
    assert.deepEqual(D.appareils.map((d) => [d.mac, d.ip]), [[M.pc, ipPc], [M.cam, ipCam]], 'les appareils à qui réserver : pas ceux qui ont déjà une adresse fixe');
    assert.match(r.text, /^Le réseau de la maison : 192\.0\.2\.1 à 192\.0\.2\.254 \(254 adresses\), la box 192\.0\.2\.1, Odin 192\.0\.2\.2\.\nPlage distribuée par Odin : 192\.0\.2\.100 à 192\.0\.2\.199, 2 prise\(s\), 98 libre\(s\)\.\nHors de la plage : 151 libres hors de la plage\. Première adresse libre : 192\.0\.2\.3\.\nAdresses fixes \(1\) :\n- scriptalert\(1\)\/scriptImprimante · 192\.0\.2\.30 · 00:00:5e:00:53:30$/);
    // Aucune balise, aucun caractère caché, nulle part dans la réponse.
    const tout = JSON.stringify(r);
    assert.doesNotMatch(tout, /<script|<img|onerror=|\\u202e|\\u0000/i, 'les noms venus du réseau ou tapés sont nettoyés');
    assert.equal(D.fixes[0].nom, 'scriptalert(1)/scriptImprimante');
    // La vérification avant de réserver.
    ({ r, D } = await w.plan({ mac: M.pc, ip: ipCam }));
    assert.deepEqual([D.verdict!.ok, D.verdict!.code, D.verdict!.aQui], [false, 'bail', M.cam]);
    assert.match(D.verdict!.message, /^Refusé : 192\.0\.2\.101 est déjà à « img srcx onerroralert1Cam »/, 'le nom de l\'autre appareil est nettoyé');
    assert.match(r.text, /Vérification : Refusé : 192\.0\.2\.101 est déjà à/);
    ({ D } = await w.plan({ mac: M.pc, ip: '192.0.2.150' })); assert.deepEqual([D.verdict!.ok, D.verdict!.code, D.verdict!.dansPlage], [true, 'plage', true]);
    ({ D } = await w.plan({ mac: M.pc, ip: '192.0.2.24' })); assert.deepEqual([D.verdict!.ok, D.verdict!.code, D.verdict!.message], [true, 'libre', 'Libre.']);
    ({ D } = await w.plan({ mac: M.pc, ip: '<img src=x onerror=alert(1)>' })); assert.deepEqual([D.verdict!.ok, D.verdict!.code], [false, 'ecriture']);
    ({ D } = await w.plan({ mac: '', ip: '192.0.2.24' })); assert.deepEqual([D.verdict!.ok, D.verdict!.code], [false, 'mac']);
    assert.equal(JSON.stringify(w.ctx.settings), avant, 'regarder et vérifier n\'écrivent rien');
    // La box distribue : c'est dit.
    assert.equal((await w.act('dhcp_arreter')).ok, true);
    ({ r, D } = await w.plan({ mac: M.pc, ip: '192.0.2.24' }));
    assert.match(r.text, /aujourd'hui la box distribue les adresses/); assert.match(D.verdict!.avis.join('\n'), /la box distribue les adresses : c'est noté/);
  } finally { w.fin(); }
});

test('R3 · Sphinx : réserver, changer, retirer sont au propriétaire seul ; un membre ne voit que son appareil (ni le plan, ni la vérification)', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-BUREAU'), ipTel = w.prend(M.tel, 'Telephone de Nour');
    assert.equal((await w.act('dhcp_fixe', { mac: M.tel, ip: '192.0.2.14', nom: 'Téléphone de Nour' })).ok, true);
    assert.equal((await w.act('dhcp_fixe', { mac: M.imp, ip: '192.0.2.30', nom: 'Imprimante' })).ok, true);
    const avant = JSON.stringify(w.ctx.settings);
    // Tout ce qui n'est pas le propriétaire en personne : refusé par la garde.
    for (const o of [{ qui: 'member' }, { qui: 'guest' }, { auto: true, by: 'automatisation' }, { by: 'odin' }, { qui: 'owner', marque: true }] as Array<Parameters<Valhalla['act']>[3]>) {
      for (const [a, i] of [['dhcp_fixe', { mac: M.pc, ip: '192.0.2.23' }], ['dhcp_fixe', { mac: M.tel, ip: '192.0.2.15' }], ['dhcp_retirer_fixe', { mac: M.imp }]] as const) {
        const r = await w.act(a, i, o); assert.equal(r.ok, false, `${a} ${JSON.stringify(o)}`); assert.match(r.text, REFUS);
      }
    }
    assert.equal(JSON.stringify(w.ctx.settings), avant, 'rien n\'a bougé');
    // Un membre, depuis son téléphone (il tient encore son adresse de la plage) : seulement SA réservation.
    const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
    const membre = (depuis: string, i: Record<string, unknown> = {}) => auNomDe(nour, () => origineDemande.run(depuis, () => w.act('plan_adresses', i)));
    let r = await membre(ipTel), D = r.data as Donnees;
    assert.deepEqual([D.proprietaire, D.plan, D.verdict, D.appareils], [false, null, null, []]);
    assert.deepEqual(D.fixes.map((f) => [f.mac, f.ip]), [[M.tel, '192.0.2.14']]);
    assert.match(D.limite, /au propriétaire seul/);
    const dit = JSON.stringify(r);
    for (const secret of [M.pc, M.imp, 'Imprimante', 'PC-BUREAU', ipPc, '192.0.2.30', '192.0.2.100']) assert.ok(!dit.includes(secret), `un membre n'apprend rien sur « ${secret} »`);
    // Il ne peut pas sonder quelles adresses sont prises : aucune vérification ne lui répond.
    r = await membre(ipTel, { mac: M.tel, ip: '192.0.2.30' }); D = r.data as Donnees;
    assert.equal(D.verdict, null); assert.ok(!JSON.stringify(r).includes('Imprimante'));
    // Depuis un appareil qu'Odin ne reconnaît pas, ou sans origine : rien du tout.
    for (const depuis of ['203.0.113.9', '']) { r = await membre(depuis); D = r.data as Donnees; assert.deepEqual([D.plan, D.fixes], [null, []], `depuis « ${depuis} »`); }
    assert.equal(JSON.stringify(w.ctx.settings), avant);
  } finally { w.fin(); }
});

// ------------------------------------------------------------------ relecture du lot R3 (ce qui a été trouvé, puis fermé)
test('R3 · relecture : un appareil ne chasse pas les autres de leur adresse en signalant une adresse qui n\'est pas la sienne (DECLINE menteur)', () => {
  // Le serveur DNS de la maison a une adresse fixe ; le téléphone tient une adresse de la plage.
  const s = serveurSeul(CFG({ dns: [ODIN, '192.0.2.53'], fixed: [{ mac: M.dns, ip: '192.0.2.53', name: 'Serveur DNS' }] }));
  assert.equal(s.prend(M.dns), '192.0.2.53'); const tel = s.prend(M.tel);
  // Un autre appareil ment : il « signale » l'adresse du serveur DNS, celle du téléphone, celle d'Odin, celle de la box.
  for (const cible of ['192.0.2.53', tel, ODIN, BOX, '192.0.2.150']) s.dit(paquet(M.pc, MSG.DECLINE, { veut: cible }));
  s.avance(H / 4);
  assert.equal(genre(s.dit(paquet(M.dns, MSG.REQUEST, { tient: '192.0.2.53' }))), MSG.ACK, 'le serveur DNS de la maison garde son adresse');
  assert.equal(genre(s.dit(paquet(M.tel, MSG.REQUEST, { tient: tel }))), MSG.ACK, 'le téléphone garde la sienne');
  assert.equal(s.bail(M.dns)?.ip, '192.0.2.53');
  assert.deepEqual(s.srv.signalees(), [], 'un signalement ne compte que pour l\'adresse qu\'Odin a donnée ou proposée à cet appareil');
  // Un vrai signalement (l'adresse qu'Odin vient de lui proposer, ou qu'il tient) compte toujours.
  const offre = s.dit(paquet(M.cam, MSG.DISCOVER)); s.dit(paquet(M.cam, MSG.DECLINE, { veut: offre.p.yiaddr }));
  assert.deepEqual(s.srv.signalees(), [offre.p.yiaddr]);
  const autre = s.dit(paquet(M.cam, MSG.DISCOVER)); assert.notEqual(autre.p.yiaddr, offre.p.yiaddr, 'elle ne lui est pas reproposée');
  const tv = s.prend(M.tv); s.dit(paquet(M.tv, MSG.DECLINE, { veut: tv }));
  assert.ok(s.srv.signalees().includes(tv)); assert.equal(s.bail(M.tv), undefined);
});

test('R3 · relecture : un bail en cours hors de la plage et sans réservation va jusqu\'à sa fin (aucun refus net à la mise à jour), puis l\'appareil reprend une adresse de la plage', () => {
  // La plage a été changée un jour (ou la réservation retirée) : l'imprimante tient encore 192.0.2.30, hors de la plage.
  const s = serveurSeul(CFG(), [bail(M.imp, '192.0.2.30', { expires: T0 + 6 * H })]);
  assert.equal(s.dit(paquet(M.imp, MSG.REQUEST, { tient: '192.0.2.30' })), undefined, 'ni refus net ni accord : son bail en cours va jusqu\'au bout');
  assert.equal(s.dit(paquet(M.imp, MSG.REQUEST, { veut: '192.0.2.30' })), undefined, 'pareil s\'il redémarre');
  assert.equal(s.bail(M.imp)?.expires, T0 + 6 * H, 'son bail n\'est pas rallongé');
  // D'ici là, son adresse n'est donnée ni réservée à personne d'autre.
  assert.equal(genre(s.dit(paquet(M.pc, MSG.REQUEST, { veut: '192.0.2.30' }))), MSG.NAK);
  assert.equal(verifierAdresse({ config: s.cfg, leases: s.leases(), now: T0, mac: M.pc, ip: '192.0.2.30' }).code, 'bail');
  // À la fin du bail : il redemande, et reçoit une adresse de la plage.
  s.avance(7 * H);
  assert.equal(genre(s.dit(paquet(M.imp, MSG.REQUEST, { tient: '192.0.2.30' }))), MSG.NAK, 'bail fini : cette adresse n\'est plus la sienne');
  assert.equal(s.prend(M.imp), '192.0.2.100');
  // Refus net tout de suite quand il le FAUT : adresse hors du réseau, adresse réservée à un autre, réservation changée par le propriétaire.
  const dehors = serveurSeul(CFG(), [bail(M.imp, '198.51.100.30')]);
  assert.equal(genre(dehors.dit(paquet(M.imp, MSG.REQUEST, { tient: '198.51.100.30' }))), MSG.NAK, 'hors du réseau de la maison');
  const pris = serveurSeul(CFG({ fixed: [{ mac: M.pc, ip: '192.0.2.30' }] }), [bail(M.imp, '192.0.2.30')]);
  assert.equal(genre(pris.dit(paquet(M.imp, MSG.REQUEST, { tient: '192.0.2.30' }))), MSG.NAK, 'réservée à un autre');
  const change = serveurSeul(CFG({ fixed: [{ mac: M.imp, ip: '192.0.2.31' }] }), [bail(M.imp, '192.0.2.30')]);
  assert.equal(genre(change.dit(paquet(M.imp, MSG.REQUEST, { tient: '192.0.2.30' }))), MSG.NAK, 'sa réservation a changé : il suit tout de suite');
  for (const garde of [ODIN, BOX]) { const g = serveurSeul(CFG(), [bail(M.imp, garde)]); assert.equal(genre(g.dit(paquet(M.imp, MSG.REQUEST, { tient: garde }))), MSG.NAK, `jamais ${garde}`); }
});

test('R3 · relecture : toutes les adresses d\'Odin sont gardées (plusieurs cartes), jamais l\'adresse du réseau ni celle de diffusion', () => {
  // Odin a deux cartes dans la maison : 192.0.2.2 (celle des réglages) et 192.0.2.9.
  let leases: Lease[] = []; const envois: Envoi[] = [];
  const cfg = CFG({ start: '192.0.2.9', end: '192.0.2.11', fixed: [{ mac: M.pc, ip: '192.0.2.9' }] });
  const srv = new DhcpServer({ config: () => cfg, leases: () => leases, save: (l) => { leases = l; }, now: () => T0, propres: () => ['192.0.2.9', '10.0.0.5'] } as ConstructorParameters<typeof DhcpServer>[0]);
  (srv as unknown as { sock: unknown }).sock = { send: (b: Buffer, _port: number, vers: string) => { envois.push({ p: parsePacket(b), vers }); }, close: () => {} };
  const dit = (b: Buffer) => { const n = envois.length; srv.onMessage(b); return envois[n]; };
  assert.equal(dit(paquet(M.pc, MSG.DISCOVER)).p.yiaddr, '192.0.2.10', 'une réservation abîmée sur l\'autre adresse d\'Odin n\'est pas servie');
  assert.equal(dit(paquet(M.tv, MSG.DISCOVER, { veut: '192.0.2.9' })).p.yiaddr, '192.0.2.11', 'ni donnée depuis la plage');
  assert.equal(genre(dit(paquet(M.tv, MSG.REQUEST, { veut: '192.0.2.9' }))), MSG.NAK);
  // Une plage qui couvre tout le réseau : ni 192.0.2.0 (le réseau) ni 192.0.2.7 (la diffusion) ne sont données.
  const petit = serveurSeul(CFG({ mask: '255.255.255.248', start: '192.0.2.0', end: '192.0.2.7' }));
  const donnees = [M.pc, M.tv, M.cam, M.imp].map((m) => petit.prend(m));
  assert.deepEqual(donnees, ['192.0.2.3', '192.0.2.4', '192.0.2.5', '192.0.2.6']);
  assert.equal(petit.dit(paquet(M.tel, MSG.DISCOVER)), undefined, 'plus rien : ni le réseau (192.0.2.0) ni la diffusion (192.0.2.7) ne sont donnés');
});

test('R3 · relecture : une adresse qui parle encore (appareil réglé à la main, bail fini mais adresse encore utilisée) ne se réserve pas à un autre', () => {
  const e = entree({ leases: [bail(M.imp, '192.0.2.101'), bail(M.tv, '192.0.2.140', { expires: T0 - H })], vues: ['192.0.2.24', '192.0.2.101', '192.0.2.140'], nom: (m) => (m === M.tv ? 'Télévision' : m) });
  // L'imprimante parle depuis 192.0.2.101 ET quelqu'un parle depuis 192.0.2.24 : ce sont deux appareils.
  let r = verifierAdresse({ ...e, mac: M.imp, ip: '192.0.2.24' });
  assert.deepEqual([r.ok, r.code], [false, 'vue']); assert.match(r.message, /^Refusé : un autre appareil utilise 192\.0\.2\.24 en ce moment/);
  // Le bail de la télévision est fini, mais elle parle encore depuis son adresse.
  r = verifierAdresse({ ...e, mac: M.pc, ip: '192.0.2.140' });
  assert.deepEqual([r.ok, r.code, r.aQui], [false, 'vue', M.tv]); assert.match(r.message, /« Télévision »/);
  assert.equal(verifierAdresse({ ...e, mac: M.tv, ip: '192.0.2.140' }).ok, true, 'à elle-même : oui');
  // Dans le doute (c'est peut-être cet appareil-là, réglé à la main) : accepté, et dit.
  r = verifierAdresse({ ...e, vues: ['192.0.2.24'], mac: M.imp, ip: '192.0.2.24' });
  assert.equal(r.ok, true); assert.match(r.avis.join(' '), /réglé à la main/);
  assert.equal(verifierAdresse({ ...e, vues: [], mac: M.pc, ip: '192.0.2.140' }).ok, true, 'un bail fini qui ne parle plus : libre');
});

test('R3 · relecture : la même machine écrite autrement reste la même ; une adresse déjà réservée deux fois ne passe pas', () => {
  const e = entree({ config: CFG({ fixed: [{ mac: '00-00-5E-00-53-30', ip: '192.0.2.30', name: 'Imprimante' }] }) });
  assert.deepEqual([verifierAdresse({ ...e, mac: M.imp, ip: '192.0.2.30' }).ok, verifierAdresse({ ...e, mac: M.imp, ip: '192.0.2.30' }).code], [true, 'meme'], 'c\'est la même machine');
  assert.equal(verifierAdresse({ ...e, mac: M.pc, ip: '192.0.2.30' }).code, 'reservee');
  assert.equal(serveurSeul(e.config).prend(M.imp), '192.0.2.30', 'le serveur d\'adresses la reconnaît aussi');
  // Réglages abîmés : deux appareils sur la même adresse fixe. Ni l'un ni l'autre n'est confirmé dessus.
  const double = entree({ config: CFG({ fixed: [{ mac: M.pc, ip: '192.0.2.30' }, { mac: M.imp, ip: '192.0.2.30' }] }) });
  for (const mac of [M.pc, M.imp]) assert.deepEqual([verifierAdresse({ ...double, mac, ip: '192.0.2.30' }).ok, verifierAdresse({ ...double, mac, ip: '192.0.2.30' }).code], [false, 'reservee'], mac);
});

test('R3 · relecture : le plan et la vérification d\'une adresse ne répondent qu\'au propriétaire en personne (ni l\'outil de l\'agent pour un membre, ni une automatisation, ni un contenu extérieur)', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-BUREAU'); w.prend(M.tel, 'Telephone de Nour');
    assert.equal((await w.act('dhcp_fixe', { mac: M.imp, ip: '192.0.2.30', nom: 'Imprimante' })).ok, true);
    for (const o of [{ qui: 'member' }, { qui: 'guest' }, { auto: true, by: 'automatisation' }, { auto: true, by: 'assistant' }, { by: 'odin' }, { by: 'réflexe' }, { qui: 'owner', marque: true }] as Array<Parameters<Valhalla['act']>[3]>) {
      for (const i of [{}, { mac: M.pc, ip: '192.0.2.30' }]) {
        const r = await w.act('plan_adresses', i, o), dit = JSON.stringify(r);
        assert.equal(r.ok, false, `${JSON.stringify(o)} : ${r.text.slice(0, 80)}`); assert.match(r.text, REFUS);
        for (const secret of [M.pc, M.imp, 'Imprimante', 'PC-BUREAU', ipPc, '192.0.2.30']) assert.ok(!dit.includes(secret), `${JSON.stringify(o)} n'apprend rien sur « ${secret} »`);
      }
    }
    // Le propriétaire, lui : tout ; un membre connecté à l'interface : son appareil seulement (essai plus haut).
    assert.equal((await w.plan()).D.proprietaire, true); assert.equal((await w.act('plan_adresses', {}, { qui: 'owner' })).ok, true);
    const a = w.v.module('vidarr')!.actions.find((x) => x.id === 'plan_adresses')!;
    assert.equal(typeof a.proprietaireSeul, 'function');
    // Une lecture ne remplit pas « qui a fait quoi ».
    const actes = ((await w.act('qui_a_fait', { n: 500 })).data as { actes: Array<{ action: string }> }).actes;
    assert.ok(!actes.some((x) => /Plan des adresses/.test(x.action)), 'regarder le plan n\'est pas noté comme un changement');
  } finally { w.fin(); }
});

test('R3 · relecture : Odin dit vrai quand on retire une adresse fixe (bail fini d\'abord ; en liste d\'autorisation l\'appareil attend de nouveau ton accord) ; une autre carte d\'Odin ne se réserve pas', async () => {
  const IPS = (LOCAL as unknown as { ips?: () => string[] }).ips;
  const w = await monde();
  try {
    (LOCAL as unknown as { ips: () => string[] }).ips = () => [ODIN, '192.0.2.9', '10.0.0.5'];
    let r = await w.act('dhcp_fixe', { mac: M.pc, ip: '192.0.2.9' });
    assert.equal(r.ok, false, 'l\'autre adresse d\'Odin dans la maison'); assert.match(r.text, /Odin lui-même/);
    // Une adresse fixe hors de la plage, tenue, puis retirée : il la garde jusqu'à la fin de son bail.
    assert.equal((await w.act('dhcp_fixe', { mac: M.imp, ip: '192.0.2.30', nom: 'Imprimante' })).ok, true); assert.equal(w.prend(M.imp), '192.0.2.30');
    r = await w.act('dhcp_retirer_fixe', { mac: M.imp });
    assert.match(r.text, /- Il la tient encore : il la garde jusqu'à la fin de son bail \(.+\), puis Odin lui donne une adresse de la plage\./);
    assert.equal(w.dit(paquet(M.imp, MSG.REQUEST, { tient: '192.0.2.30' })), undefined, 'aucun refus net');
    assert.equal((await w.act('dhcp_fixe', { mac: M.pc, ip: '192.0.2.30' })).ok, false, 'et son adresse n\'est réservée à personne d\'autre d\'ici là');
    // Liste d'autorisation : l'accord tenait à la réservation ; c'est dit quand on la retire.
    assert.equal((await w.act('dhcp_mode', { mode: 'liste' })).ok, true);
    assert.equal((await w.act('dhcp_fixe', { mac: M.tv, ip: '192.0.2.40', nom: 'Télévision' })).ok, true); assert.equal(w.prend(M.tv), '192.0.2.40');
    const { D } = await w.plan();
    assert.deepEqual(D.fixes.map((f) => [f.mac, (f as unknown as { accord: boolean }).accord]), [[M.tv, false]], 'la page sait que l\'accord tient à la réservation');
    r = await w.act('dhcp_retirer_fixe', { mac: M.tv });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Seuls les appareils approuvés reçoivent une adresse : sans adresse fixe, il attendra de nouveau ton accord/);
    assert.equal(w.etats()[M.tv], undefined, 'retirer n\'approuve ni ne bloque rien');
  } finally { if (IPS) (LOCAL as unknown as { ips: () => string[] }).ips = IPS; else delete (LOCAL as unknown as { ips?: unknown }).ips; w.fin(); }
});
