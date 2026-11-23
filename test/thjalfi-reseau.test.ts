// Genèse · le serveur de démarrage côté réseau (maquette « Genèse · Systèmes », lot S8) : les cartes réseau, les façons
// de donner « où démarrer » (à côté de la box, réseau à part, Sphinx, ta box), et SURTOUT le garde-fou : Odin ne
// distribue jamais d'adresses sur une carte où un autre serveur d'adresses répond (la box), le revérifie chaque minute et
// s'arrête aussitôt s'il en apparaît un.
// SÛRETÉ : aucune vraie prise de serveur d'adresses (ni 67, ni 68, ni 69, ni 4011). Les cartes, la recherche d'un autre
// serveur et l'écoute du réseau à part sont SIMULÉES (RESEAU remplacé, prises en mémoire) ; les PC sont des paquets
// fabriqués. Le serveur HTTP et le TFTP d'allumer n'ouvrent qu'un port au hasard (0). Dossiers temporaires neufs.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildPacket, MSG, parsePacket, pxeHook } from '../src/valhalla/vidarr/dhcp.ts';
import * as R from '../src/valhalla/thjalfi/reseau.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';

const dossiers: string[] = [];
const ORIGINE = { ...R.RESEAU };
after(() => { Object.assign(R.RESEAU, ORIGINE); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const ETH: R.CarteReseau = { nom: 'Ethernet', ip: '192.168.1.20', masque: '255.255.255.0', prefixe: 24, mac: '00:11:22:33:44:55', genre: 'cable' };
const WIFI: R.CarteReseau = { nom: 'Wi-Fi', ip: '192.168.1.23', masque: '255.255.255.0', prefixe: 24, genre: 'wifi' };
const APART: R.CarteReseau = { nom: 'Ethernet 2', ip: '10.10.0.1', masque: '255.255.255.0', prefixe: 24, genre: 'cable' };
const arch = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const discover = (mac: string, o: { pxe?: boolean; giaddr?: string } = {}) => buildPacket({ op: 1, xid: 0x1234, mac, flags: 0x8000, ...(o.giaddr ? { giaddr: o.giaddr } : {}), options: [[53, Buffer.from([MSG.DISCOVER])], ...(o.pxe === false ? [] : [[60, Buffer.from('PXEClient:Arch:00007:UNDI:003016')], [93, arch(7)]] as Array<[number, Buffer]>)] });
const request = (mac: string, o: { serveur?: string; ip?: string; ciaddr?: string } = {}) => buildPacket({ op: 1, xid: 0x99, mac, ...(o.ciaddr ? { ciaddr: o.ciaddr } : {}), options: [[53, Buffer.from([MSG.REQUEST])], ...(o.serveur ? [[54, Buffer.from(o.serveur.split('.').map(Number))]] as Array<[number, Buffer]> : []), ...(o.ip ? [[50, Buffer.from(o.ip.split('.').map(Number))]] as Array<[number, Buffer]> : [])] });

// ---------------- Les règles pures ----------------
test('S8 · cartes réseau : câble conseillé d\'abord, Wi-Fi reconnu, cartes virtuelles, sans la boucle ni les adresses de secours', () => {
  assert.equal(R.genreCarte('Wi-Fi'), 'wifi'); assert.equal(R.genreCarte('wlp3s0'), 'wifi'); assert.equal(R.genreCarte('Connexion réseau sans fil'), 'wifi');
  assert.equal(R.genreCarte('vEthernet (Default Switch)'), 'virtuelle'); assert.equal(R.genreCarte('virbr0'), 'virtuelle');
  assert.equal(R.genreCarte('Ethernet'), 'cable'); assert.equal(R.genreCarte('enp2s0'), 'cable');
  const l = R.cartesReseau({
    'Wi-Fi': [{ address: '192.168.1.23', netmask: '255.255.255.0', family: 'IPv4', mac: 'aa:bb:cc:00:00:01', internal: false, cidr: '192.168.1.23/24' }],
    Ethernet: [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: 'AA:BB:CC:00:00:02', internal: false, cidr: '192.168.1.20/24' }, { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', mac: 'aa:bb:cc:00:00:02', internal: false, cidr: 'fe80::1/64', scopeid: 1 }],
    'vEthernet (Interne)': [{ address: '10.10.0.1', netmask: '255.255.0.0', family: 'IPv4', mac: 'aa:bb:cc:00:00:03', internal: false, cidr: null }],
    'Ethernet 3': [{ address: '169.254.12.3', netmask: '255.255.0.0', family: 'IPv4', mac: 'aa:bb:cc:00:00:04', internal: false, cidr: '169.254.12.3/16' }],
    lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
  } as never);
  assert.deepEqual(l.map((c) => [c.nom, c.genre, c.ip, c.prefixe]), [['Ethernet', 'cable', '192.168.1.20', 24], ['vEthernet (Interne)', 'virtuelle', '10.10.0.1', 16], ['Wi-Fi', 'wifi', '192.168.1.23', 24]]);
  assert.equal(l[0].mac, 'aa:bb:cc:00:00:02');
});

test('S8 · la plage du réseau à part : dans le réseau de la carte, sans l\'adresse d\'Odin, 1 000 au plus, bail de 5 min à 1 jour', () => {
  assert.deepEqual(R.plageParDefaut(APART), { debut: '10.10.0.100', fin: '10.10.0.199', masque: '255.255.255.0', passerelle: '10.10.0.1', dns: ['10.10.0.1'], bail: 7200 });
  const ok = R.verifierPlage(APART, { debut: '10.10.0.50', fin: '10.10.0.60', bail: 86_400 });
  assert.ok(!('refus' in ok)); assert.equal((ok as R.PlageComplet).bail, 86_400);
  const non = (i: Record<string, unknown>) => { const r = R.verifierPlage(APART, i); assert.ok('refus' in r, JSON.stringify(i)); return r.refus; };
  assert.match(non({ debut: '192.168.1.100', fin: '192.168.1.150' }), /pas sur le réseau de la carte Ethernet 2/);
  assert.match(non({ debut: '10.10.0.1', fin: '10.10.0.20' }), /contient l'adresse d'Odin/);
  assert.match(non({ debut: '10.10.0.90', fin: '10.10.0.80' }), /avant la dernière/);
  assert.match(non({ debut: '10.10.0.0', fin: '10.10.0.20' }), /pas sur le réseau/, 'l\'adresse du réseau lui-même');
  assert.match(non({ debut: '10.10.0.2', fin: '10.10.0.255' }), /pas sur le réseau/, 'la diffusion');
  assert.match(non({ debut: 'x', fin: '10.10.0.20' }), /n'est pas une adresse/);
  assert.match(non({ passerelle: '8.8.8.8' }), /passerelle/i);
  assert.match(non({ bail: 10 }), /5 minutes à 1 jour/);
  assert.match(non({ bail: 999_999 }), /5 minutes à 1 jour/);
  const grand: R.CarteReseau = { ...APART, masque: '255.255.0.0', prefixe: 16 };
  assert.match(String((R.verifierPlage(grand, { debut: '10.10.1.1', fin: '10.10.9.9' }) as { refus: string }).refus), /1000 adresses au plus/);
});

test('S8 · carte refusée pour distribuer : Wi-Fi, réseau public, et hors Windows (il ne sait pas encore écouter UNE carte)', () => {
  assert.match(R.refusCarte(undefined, 'win32')!, /Choisis d'abord la carte/);
  assert.match(R.refusCarte(WIFI, 'win32')!, /Wi-Fi.*réseau de la box/);
  assert.match(R.refusCarte({ ...APART, ip: '203.0.113.5' }, 'win32')!, /pas sur un réseau privé/);
  assert.match(R.refusCarte(APART, 'linux')!, /ne sait pas encore écouter une seule carte/);
  assert.equal(R.refusCarte(APART, 'win32'), undefined);
  assert.match(R.texteRefusBox(['192.168.1.1']), /^Refusé : ça casserait le réseau de la maison\. Un serveur d'adresses \(192\.168\.1\.1, souvent la box\) répond déjà sur cette carte/);
});

test('S8 · « ta box s\'en charge » : l\'adresse d\'Odin et le fichier selon le micrologiciel (option 93), puis le menu en HTTP', () => {
  const l = R.lignesBox('192.168.1.20', 16000);
  assert.match(l.simple.join('\n'), /Option 66.*192\.168\.1\.20/); assert.match(l.simple.join('\n'), /ipxe\.efi pour les PC en UEFI, undionly\.kpxe pour les PC en BIOS/);
  assert.match(l.dhcpd, /option arch code 93 = unsigned integer 16;/); assert.match(l.dhcpd, /next-server 192\.168\.1\.20;/);
  assert.match(l.dhcpd, /option arch = 7 or option arch = 9 \{\n  filename "ipxe\.efi";/); assert.match(l.dhcpd, /filename "http:\/\/192\.168\.1\.20:16000\/boot\.ipxe";/);
  assert.match(l.dnsmasq, /dhcp-match=set:efi64,option:client-arch,7/); assert.match(l.dnsmasq, /dhcp-boot=tag:!ipxe,tag:!efi64,tag:!efi32,tag:!arm64,undionly\.kpxe,,192\.168\.1\.20/);
});

// ---------------- La recherche d'un autre serveur, sur une prise simulée ----------------
function prise(reponses: (q: Buffer) => Array<Buffer>, o: { erreurBind?: boolean } = {}) {
  const ec: Record<string, Array<(...a: unknown[]) => void>> = {}, notes = { bind: '' as string, vers: [] as string[], ferme: false };
  const s: R.PriseUdp = {
    on: ((e: string, f: (...a: unknown[]) => void) => { (ec[e] ??= []).push(f); return s; }) as R.PriseUdp['on'],
    bind: (port, host, f) => { notes.bind = `${host}:${port}`; if (o.erreurBind) setTimeout(() => ec.error?.forEach((g) => g(new Error('EACCES'))), 1); else setTimeout(f, 1); },
    setBroadcast: () => {},
    send: (b, port, to) => { notes.vers.push(`${to}:${port}`); setTimeout(() => { for (const r of reponses(b)) ec.message?.forEach((g) => g(r, { address: '192.168.1.1', port: 67 })); }, 2); },
    close: () => { notes.ferme = true; },
  };
  return { s, notes };
}
const offre = (q: Buffer, serveur: string) => { const p = parsePacket(q); return buildPacket({ op: 2, xid: p.xid, mac: p.mac, yiaddr: '192.168.1.77', options: [[53, Buffer.from([MSG.OFFER])], [54, Buffer.from(serveur.split('.').map(Number))]] }); };

test('S8 · chercher un autre serveur sur la carte : la box est vue ; sa propre réponse ne compte pas ; une prise qui ne s\'ouvre pas = « pas vérifié »', async () => {
  const a = prise((q) => [offre(q, '192.168.1.1'), offre(q, '10.10.0.1'), buildPacket({ op: 2, xid: 1, mac: '02:00:00:00:00:01', options: [[53, Buffer.from([MSG.OFFER])], [54, Buffer.from([1, 2, 3, 4])]] })]);
  const r = await R.chercherServeurs(APART, { plateforme: 'win32', attente: 30, prise: () => a.s, portServeur: 6700, portClient: 6800 });
  assert.deepEqual(r, { serveurs: ['192.168.1.1', '1.2.3.4'] }, 'tout serveur qui répond (à notre question ou à un autre PC), sauf Odin lui-même');
  assert.equal(a.notes.bind, '10.10.0.1:6800', 'sous Windows : attachée à l\'adresse de la carte, jamais à toutes les cartes');
  assert.deepEqual(a.notes.vers, ['255.255.255.255:6700']); assert.equal(a.notes.ferme, true);
  const b = prise(() => []);
  assert.deepEqual(await R.chercherServeurs(APART, { plateforme: 'linux', attente: 30, prise: () => b.s, portServeur: 6700, portClient: 6800 }), { serveurs: [] });
  assert.equal(b.notes.bind, '0.0.0.0:6800', 'ailleurs : toute réponse compte'); assert.deepEqual(b.notes.vers, ['10.10.0.255:6700'], 'la question part vers la diffusion du réseau de la carte');
  const c = prise(() => [], { erreurBind: true });
  const rc = await R.chercherServeurs(APART, { plateforme: 'win32', attente: 30, prise: () => c.s });
  assert.deepEqual(rc.serveurs, []); assert.match(rc.erreur!, /EACCES/);
  assert.equal(R.conclure(rc, 'Ethernet 2', 1, false).etat, 'non_verifie', 'une erreur n\'est jamais « libre »');
  assert.equal(R.conclure(rc, 'Ethernet 2', 1, true).etat, 'coupe');
  assert.equal(R.conclure({ serveurs: ['192.168.1.1'] }, 'Ethernet', 1, false).etat, 'occupe');
  assert.equal(R.conclure({ serveurs: [] }, 'Ethernet 2', 1, false).etat, 'libre');
});

// ---------------- Le serveur d'adresses du réseau à part, sur une prise simulée ----------------
test('S8 · serveur du réseau à part : une adresse de la plage et le chargeur ; il s\'arrête dès qu\'un PC parle à un autre serveur', () => {
  const envoyes: Array<{ b: Buffer; to: string }> = [], alertes: string[] = [];
  let baux: Array<{ mac: string; ip: string; expires: number }> = [];
  const avant = pxeHook.get, crochetMaison = () => undefined; pxeHook.get = crochetMaison;
  try {
    const srv = new R.DhcpAPart({
      config: () => ({ server: '10.10.0.1', start: '10.10.0.100', end: '10.10.0.199', mask: '255.255.255.0', router: '10.10.0.1', dns: ['10.10.0.1'], leaseSeconds: 7200, fixed: [] }),
      leases: () => baux as never, save: (l) => { baux = l as never; }, carte: () => APART,
      demarrage: (p) => (p.options.get(60)?.toString().startsWith('PXEClient') ? { siaddr: '10.10.0.1', file: 'ipxe.efi', options: [[66, Buffer.from('10.10.0.1')], [67, Buffer.from('ipxe.efi')]] } : undefined),
      alerte: (r) => alertes.push(r),
    });
    (srv as unknown as { sock: unknown }).sock = { send: (b: Buffer, _p: number, to: string) => envoyes.push({ b, to }), close: () => {} };
    srv.onMessage(discover('52:54:00:3a:91:0c'));
    assert.equal(envoyes.length, 1); const o = parsePacket(envoyes[0].b);
    assert.equal(o.yiaddr, '10.10.0.100'); assert.equal(o.options.get(53)![0], MSG.OFFER);
    assert.equal(envoyes[0].b.subarray(108, 236).toString('latin1').replace(/\0+$/, ''), 'ipxe.efi', 'le chargeur de Genèse');
    assert.equal(pxeHook.get, crochetMaison, 'le crochet de la maison est remis tel quel');
    srv.onMessage(discover('52:54:00:3a:91:0d', { giaddr: '192.168.1.254' }));
    assert.equal(envoyes.length, 1, 'une demande relayée d\'un autre réseau : jamais de réponse');
    srv.onMessage(request('52:54:00:3a:91:0c', { serveur: '192.168.1.1', ip: '192.168.1.77' }));
    assert.equal(alertes.length, 1); assert.match(alertes[0], /demande son adresse à un autre serveur \(192\.168\.1\.1\)/);
    assert.equal(srv.arrete, true);
    srv.onMessage(discover('52:54:00:3a:91:0e'));
    assert.equal(envoyes.length, 1, 'arrêté : plus rien ne part');
    const srv2 = new R.DhcpAPart({ config: () => ({ server: '10.10.0.1', start: '10.10.0.100', end: '10.10.0.199', mask: '255.255.255.0', router: '10.10.0.1', dns: ['10.10.0.1'], leaseSeconds: 7200, fixed: [] }), leases: () => [], save: () => {}, carte: () => APART, demarrage: () => undefined, alerte: (r) => alertes.push(r) });
    (srv2 as unknown as { sock: unknown }).sock = { send: () => envoyes.push({ b: Buffer.alloc(0), to: '' }), close: () => {} };
    srv2.onMessage(request('52:54:00:3a:91:0f', { ciaddr: '192.168.1.50' }));
    assert.match(alertes[1], /a déjà une adresse d'un autre réseau \(192\.168\.1\.50\)/); assert.equal(envoyes.length, 1);
  } finally { pxeHook.get = avant; }
});

// ---------------- Avec Odin : le garde-fou de bout en bout (cartes, recherche et écoute simulées) ----------------
interface Monde { v: Valhalla; home: string; ecoutes: Array<{ port: number; client: number; host: string }>; envoyes: Array<{ b: Buffer; to: string }>; box: Set<string>; fin: () => void }
async function monde(o: { plateforme?: string } = {}): Promise<Monde> {
  const home = mkdtempSync(join(tmpdir(), 'odin-s8-')); dossiers.push(home);
  const saved = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ef'.repeat(32);
  const ecoutes: Monde['ecoutes'] = [], envoyes: Monde['envoyes'] = [], box = new Set(['Ethernet', 'Wi-Fi']);
  R.RESEAU.cartes = () => [ETH, APART, WIFI];
  R.RESEAU.plateforme = () => o.plateforme ?? 'win32';
  R.RESEAU.chercher = async (c) => (box.has(c.nom) ? { serveurs: ['192.168.1.1'] } : { serveurs: [] });
  R.RESEAU.ecouter = async (srv, port, client, host) => { ecoutes.push({ port, client, host }); (srv as unknown as { sock: unknown }).sock = { send: (b: Buffer, _p: number, to: string) => envoyes.push({ b, to }), close: () => {} }; };
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never), { run: async () => ({ code: 1, out: '', err: '' }), fetch: (async () => { throw new Error('aucun réseau'); }) as never, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(2026, 10, 23, 14, 0) } as never);
  v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 6767, pxe: 0, client: 6868 } });
  return { v, home, ecoutes, envoyes, box, fin: () => { v.stop(); Object.assign(R.RESEAU, ORIGINE); if (saved === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = saved; } };
}
const mod = (w: Monde) => w.v.modules().find((m) => m.id === 'thjalfi') as unknown as { reseauAPart: () => (R.DhcpAPart | undefined); watch: { run: (c: unknown) => Promise<void> } };
const lire = async (w: Monde) => { const r = await w.v.act('thjalfi', 'reseau', {}); assert.notEqual(r.ok, false, r.text); return r.data as Record<string, any>; };

test('S8 · garde-fou : « Odin distribue » refusé sur la carte où la box répond (et sur le Wi-Fi) ; rien n\'est gardé, rien n\'écoute', async () => {
  const w = await monde();
  try {
    const r = await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet' });
    assert.equal(r.ok, false); assert.match(r.text, /^Refusé : ça casserait le réseau de la maison\. Un serveur d'adresses \(192\.168\.1\.1, souvent la box\)/);
    const st = w.v.ctx('thjalfi').settings;
    assert.notEqual(st.mode, 'complet', 'le mode d\'avant reste'); assert.equal(st.carte, undefined, 'la carte refusée n\'est pas gardée');
    const d = await lire(w);
    assert.equal(d.garde.etat, 'occupe'); assert.deepEqual(d.garde.autres, ['192.168.1.1']); assert.equal(d.mode, 'proxy');
    assert.match((await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Wi-Fi' })).text, /Wi-Fi.*réseau de la box/);
    assert.match((await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Carte fantôme' })).text, /carte réseau introuvable/);
    // « Rester à côté de la box » : le garde-fou redevient calme.
    assert.notEqual((await w.v.act('thjalfi', 'mode', { mode: 'proxy' })).ok, false);
    assert.equal((await lire(w)).garde.etat, 'non_verifie');
    assert.equal(w.ecoutes.length, 0, 'aucun serveur d\'adresses n\'a écouté');
  } finally { w.fin(); }
});

test('S8 · réseau à part : allumé seulement sur la carte choisie (jamais toutes les cartes), coupé dès qu\'un autre serveur apparaît (chaque minute)', async () => {
  const w = await monde();
  try {
    const r = await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2', debut: '10.10.0.100', fin: '10.10.0.120', bail: 7200 });
    assert.notEqual(r.ok, false, r.text); assert.match(r.text, /sur Ethernet 2 seulement.*de 10\.10\.0\.100 à 10\.10\.0\.120/);
    const a = await w.v.act('thjalfi', 'allumer', {}); assert.notEqual(a.ok, false, a.text);
    assert.deepEqual(w.ecoutes, [{ port: 6767, client: 6868, host: '10.10.0.1' }], 'le serveur d\'adresses n\'écoute QUE l\'adresse de la carte du réseau à part');
    assert.equal(pxeHook.get, undefined, 'le serveur d\'adresses de la maison (Sphinx) n\'ajoute rien en mode réseau à part');
    const srv = mod(w).reseauAPart()!; assert.ok(srv);
    srv.onMessage(discover('52:54:00:3a:91:0c'));
    const o = parsePacket(w.envoyes[0].b); assert.equal(o.yiaddr, '10.10.0.100'); assert.equal(o.siaddr, '10.10.0.1');
    assert.match(w.envoyes[0].b.subarray(108, 236).toString('latin1'), /^ipxe\.efi/);
    let d = await lire(w); assert.equal(d.distribue, true); assert.equal(d.garde.etat, 'libre'); assert.equal(d.carte, 'Ethernet 2');
    assert.ok(d.direct.some((e: { mac: string; etape: string }) => e.mac === '52:54:00:3a:91:0c' && e.etape === 'démarrage réseau'), 'le PC est vu en direct');
    // Une minute plus tard, la box apparaît sur la carte (quelqu'un a branché le câble ailleurs) : Odin s'arrête aussitôt.
    w.box.add('Ethernet 2');
    await mod(w).watch.run(w.v.ctx('thjalfi'));
    assert.equal(mod(w).reseauAPart(), undefined, 'coupé');
    d = await lire(w); assert.equal(d.distribue, false); assert.equal(d.garde.etat, 'coupe'); assert.match(d.garde.raison, /a arrêté de distribuer les adresses : un autre serveur d'adresses répond sur Ethernet 2 \(192\.168\.1\.1\)/);
    assert.ok(w.v.alerts().some((x) => /arrêté de distribuer les adresses/.test(x.title)), 'tu es prévenu');
    const n = w.envoyes.length; srv.onMessage(discover('52:54:00:3a:91:0d')); assert.equal(w.envoyes.length, n, 'plus aucune réponse');
    // Rallumer « Odin distribue » sur cette carte : refusé tant que la box y répond.
    assert.equal((await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2' })).ok, false);
    assert.equal(w.ecoutes.length, 1);
  } finally { w.fin(); }
});

test('S8 · réseau à part : un PC qui parle à un autre serveur coupe tout de suite ; les PC autorisés seuls ; retiré = plus d\'adresse', async () => {
  const w = await monde();
  try {
    await w.v.act('thjalfi', 'autoriser', { mac: '52:54:00:3a:91:0c', nom: 'PC-01' });
    assert.notEqual((await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2', filtre: 'liste' })).ok, false);
    assert.notEqual((await w.v.act('thjalfi', 'allumer', {})).ok, false);
    const srv = mod(w).reseauAPart()!;
    srv.onMessage(discover('52:54:00:99:99:99')); assert.equal(w.envoyes.length, 0, 'un PC inconnu : ni adresse ni chargeur');
    srv.onMessage(discover('52:54:00:3a:91:0c')); assert.equal(w.envoyes.length, 1, 'le PC autorisé');
    srv.onMessage(request('52:54:00:3a:91:0c', { serveur: '10.10.0.1', ip: '10.10.0.100' }));
    assert.equal(parsePacket(w.envoyes[1].b).options.get(53)![0], MSG.ACK);
    assert.match((await w.v.act('thjalfi', 'retirer_machine', { mac: '52:54:00:3a:91:0c' })).text, /ne démarre plus par le réseau d'Odin et ne reçoit plus aucune adresse du réseau à part/);
    srv.onMessage(request('52:54:00:3a:91:0c', { serveur: '10.10.0.1', ip: '10.10.0.100' }));
    assert.equal(w.envoyes.length, 2, 'retiré : son renouvellement n\'a plus de réponse');
    srv.onMessage(request('52:54:00:3a:91:0e', { serveur: '192.168.1.1', ip: '192.168.1.40' }));
    assert.equal(mod(w).reseauAPart(), undefined, 'coupé sans attendre la minute');
    assert.match((await lire(w)).garde.raison, /demande son adresse à un autre serveur \(192\.168\.1\.1\)/);
  } finally { w.fin(); }
});

test('S8 · allumer en réseau à part : refusé (rien n\'est allumé) si la box est apparue entre-temps, ou hors Windows', async () => {
  const w = await monde();
  try {
    assert.notEqual((await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2' })).ok, false);
    w.box.add('Ethernet 2');
    const a = await w.v.act('thjalfi', 'allumer', {}); assert.equal(a.ok, false); assert.match(a.text, /Genèse reste éteint\. Refusé : ça casserait le réseau de la maison/);
    assert.equal((await lire(w)).allume, false); assert.equal(w.ecoutes.length, 0);
  } finally { w.fin(); }
  const l = await monde({ plateforme: 'linux' });
  try {
    const r = await l.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2' });
    assert.equal(r.ok, false); assert.match(r.text, /ne sait pas encore écouter une seule carte/);
    const d = await lire(l); assert.equal(d.cartes.find((c: { nom: string }) => c.nom === 'Ethernet 2').complet, false);
  } finally { l.fin(); }
});

test('S8 · gestes réservés au propriétaire : ni une automatisation, ni un membre ; « Odin distribue » demande ton accord', async () => {
  const w = await monde();
  try {
    for (const [a, i] of [['mode', { mode: 'proxy' }], ['allumer', {}], ['reseau', {}], ['autoriser', { mac: '52:54:00:00:00:09' }], ['retirer_machine', { mac: '52:54:00:00:00:09' }]] as const) {
      assert.equal((await w.v.act('thjalfi', a, i, { qui: 'member' })).ok, false, `${a} : pas un membre`);
      assert.equal((await w.v.act('thjalfi', a, i, { auto: true })).ok, false, `${a} : pas une automatisation`);
    }
    const g = w.v.modules().find((m) => m.id === 'thjalfi')!.actions.find((x) => x.id === 'mode')!.grave!;
    assert.match(g({ mode: 'complet', carte: 'Ethernet 2', debut: '10.10.0.100', fin: '10.10.0.120' })!, /distribuer des adresses sur la carte Ethernet 2.*vérifie d'abord/);
    assert.equal(g({ mode: 'proxy' }), undefined);
    const d = await lire(w);
    assert.deepEqual(d.cartes.map((c: { nom: string; complet: boolean }) => [c.nom, c.complet]), [['Ethernet', true], ['Ethernet 2', true], ['Wi-Fi', false]]);
    assert.equal(d.lignes.simple.length, 3);
  } finally { w.fin(); }
});

// ---------------- Relecture du lot S8 : les trous trouvés, prouvés ici (prises et cartes simulées) ----------------
test('S8 relecture · la carte change d\'adresse pendant qu\'Odin distribue : la veille coupe (la prise est restée sur l\'ancienne)', async () => {
  const w = await monde();
  try {
    assert.notEqual((await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2' })).ok, false);
    assert.notEqual((await w.v.act('thjalfi', 'allumer', {})).ok, false); assert.ok(mod(w).reseauAPart());
    R.RESEAU.cartes = () => [ETH, { ...APART, ip: '10.10.0.7' }, WIFI];
    await mod(w).watch.run(w.v.ctx('thjalfi'));
    assert.equal(mod(w).reseauAPart(), undefined, 'coupé : l\'adresse de la carte a changé');
    assert.equal((await lire(w)).garde.etat, 'coupe');
  } finally { w.fin(); }
});

test('S8 relecture · après une coupure, le redémarrage d\'Odin ne redistribue pas tout seul (même si la box s\'est tue)', async () => {
  const w = await monde();
  try {
    assert.notEqual((await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2' })).ok, false);
    assert.notEqual((await w.v.act('thjalfi', 'allumer', {})).ok, false);
    w.box.add('Ethernet 2'); await mod(w).watch.run(w.v.ctx('thjalfi')); assert.equal(mod(w).reseauAPart(), undefined);
    w.box.delete('Ethernet 2'); // la box redémarre : un moment, personne ne répond
    const m = w.v.modules().find((x) => x.id === 'thjalfi') as unknown as { start: (c: unknown) => Promise<void> };
    await m.start(w.v.ctx('thjalfi'));
    assert.equal(mod(w).reseauAPart(), undefined, 'pas de redistribution sans toi');
    assert.equal(w.ecoutes.length, 1);
    assert.equal((await lire(w)).garde.etat, 'coupe');
    // Toi, en le rechoisissant : Odin revérifie, et redistribue.
    assert.notEqual((await w.v.act('thjalfi', 'allumer', {})).ok, false); assert.ok(mod(w).reseauAPart());
  } finally { w.fin(); }
});

test('S8 relecture · « Odin distribue » demande ton accord même quand le mode n\'est pas redit (changer de carte en mode complet)', async () => {
  const w = await monde();
  try {
    assert.notEqual((await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2' })).ok, false);
    const g = w.v.modules().find((m) => m.id === 'thjalfi')!.actions.find((x) => x.id === 'mode')!.grave!;
    assert.match(g({ carte: 'Ethernet 2' }, w.v.ctx('thjalfi'))!, /distribuer des adresses sur la carte Ethernet 2/);
    assert.equal(g({ mode: 'proxy' }, w.v.ctx('thjalfi')), undefined);
  } finally { w.fin(); }
});

test('S8 relecture · un PC qui annonce une adresse d\'un autre réseau (même en DISCOVER) : aucune réponse envoyée vers ce réseau, arrêt', () => {
  const envoyes: string[] = [], alertes: string[] = [];
  const srv = new R.DhcpAPart({ config: () => ({ server: '10.10.0.1', start: '10.10.0.100', end: '10.10.0.199', mask: '255.255.255.0', router: '10.10.0.1', dns: ['10.10.0.1'], leaseSeconds: 7200, fixed: [] }), leases: () => [], save: () => {}, carte: () => APART, demarrage: () => undefined, alerte: (r) => alertes.push(r) });
  (srv as unknown as { sock: unknown }).sock = { send: (_b: Buffer, _p: number, to: string) => envoyes.push(to), close: () => {} };
  srv.onMessage(buildPacket({ op: 1, xid: 7, mac: '52:54:00:aa:bb:cc', ciaddr: '8.8.8.8', options: [[53, Buffer.from([MSG.DISCOVER])]] }));
  assert.deepEqual(envoyes, [], 'rien vers 8.8.8.8 (le paquet partirait par la box)');
  assert.equal(srv.arrete, true); assert.match(alertes[0], /autre réseau \(8\.8\.8\.8\)/);
});

test('S8 relecture · la prise du réseau à part : jamais toutes les cartes ; une panne de la prise coupe sans faire tomber Odin', async () => {
  const alertes: string[] = [];
  const fab = () => new R.DhcpAPart({ config: () => ({ server: '127.0.0.1', start: '127.0.0.100', end: '127.0.0.110', mask: '255.0.0.0', router: '127.0.0.1', dns: [], leaseSeconds: 7200, fixed: [] }), leases: () => [], save: () => {}, carte: () => ({ ...APART, ip: '127.0.0.1', prefixe: 8 }), demarrage: () => undefined, alerte: (r) => alertes.push(r) });
  const t = fab(); await assert.rejects(t.start(0, 0, '0.0.0.0'), /une seule carte/); t.stop();
  // (port 0 sur la boucle locale : aucun port de serveur d'adresses, aucun paquet sur le réseau)
  const s = fab(); await s.start(0, 0, '127.0.0.1');
  try {
    assert.doesNotThrow(() => s.sock!.emit('error', new Error('ENETUNREACH')), 'une erreur de la prise ne doit pas faire tomber Odin');
    assert.equal(s.arrete, true); assert.match(alertes[0], /ENETUNREACH/);
  } finally { s.stop(); }
});

test('S8 relecture · deux démarrages en même temps : un seul serveur d\'adresses reste, l\'autre est fermé', async () => {
  const w = await monde();
  try {
    assert.notEqual((await w.v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2' })).ok, false);
    const tous: R.DhcpAPart[] = [], ec = R.RESEAU.ecouter;
    R.RESEAU.ecouter = async (srv, ...r) => { tous.push(srv); await new Promise((ok) => setTimeout(ok, 20)); await ec(srv, ...r); };
    await Promise.all([w.v.act('thjalfi', 'allumer', {}), w.v.act('thjalfi', 'allumer', {})]);
    const garde = mod(w).reseauAPart();
    assert.ok(tous.length >= 2);
    for (const s of tous) if (s !== garde) assert.equal(s.arrete, true, 'un serveur orphelin écoute encore');
  } finally { w.fin(); }
});

test('S8 relecture · cartes refusées pour distribuer : VPN, deux cartes sur le même réseau, une carte à deux adresses', () => {
  assert.match(R.refusCarte({ ...APART, nom: 'WireGuard Tunnel', genre: 'virtuelle' }, 'win32')!, /VPN/);
  assert.match(R.refusCarte({ ...APART, nom: 'tun0', genre: 'virtuelle' }, 'win32')!, /VPN/);
  const autre: R.CarteReseau = { ...APART, nom: 'Ethernet 3', ip: '10.10.0.2' };
  assert.match(R.refusCarte(APART, 'win32', [ETH, APART, autre])!, /Ethernet 3 sont sur le même réseau/);
  assert.match(R.refusCarte(APART, 'win32', [ETH, APART, { ...APART, ip: '192.168.1.30' }])!, /plusieurs adresses/);
  assert.equal(R.refusCarte(APART, 'win32', [ETH, APART, WIFI]), undefined);
});

test('S8 relecture · la recherche compte aussi un serveur qui répond à un autre PC pendant l\'écoute', async () => {
  const a = prise(() => [buildPacket({ op: 2, xid: 1, mac: '02:00:00:00:00:01', options: [[53, Buffer.from([MSG.OFFER])], [54, Buffer.from([10, 10, 0, 254])]] })]);
  assert.deepEqual((await R.chercherServeurs(APART, { plateforme: 'win32', attente: 30, prise: () => a.s, portServeur: 6700, portClient: 6800 })).serveurs, ['10.10.0.254']);
});
