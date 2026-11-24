// Sphinx · Appareils (maquette « Réseau » validée, lot R2) : « voir quelle machine récupère l'adresse IP » et « pouvoir
// bloquer les machines ». Ce qui est essayé ici :
//  - tout texte venu du réseau est nettoyé (nom d'hôte, ce que l'appareil dit de lui) : jamais de balise, jamais de
//    caractère de contrôle ;
//  - le DHCP note la date d'arrivée et « vu connecté » ; un nom donné par le propriétaire reste ;
//  - la lecture « baux_vus » : bail, fabricant (table du code), type deviné, connecté, nouveau ;
//  - bloquer : plus d'adresse ET retiré du réseau autant qu'Odin le peut (refus net au renouvellement, Internet coupé
//    par le DNS d'ici là, nom retiré du DNS), avec ce qui est fait et ce qui ne peut pas l'être dit en clair ; quand
//    la box distribue les adresses, c'est dit ;
//  - le garde-fou : jamais la box, jamais Odin, jamais l'appareil que l'on tient sans l'avoir dit ;
//  - les gestes au propriétaire seul ; un membre ne voit que l'appareil qu'il tient.
// AUCUN vrai paquet, AUCUN port 67/68 : la prise du serveur d'adresses est simulée (les paquets sont donnés à la main,
// les réponses relevées en mémoire). Adresses d'exemple seulement (192.0.2.x), MAC de la plage de documentation.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DhcpServer, MSG, buildPacket, classeAnnoncee, nomAnnonce, parsePacket, type DhcpConfig, type Lease, type MacPolicy, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL, effetsDe, gardeEtat, origineDemande, texteSur, typeDevine, vueAppareils, type Appareil, type VueAppareils } from '../src/valhalla/vidarr/appareils.ts';
import { PRISE_DHCP, coupuresBlocage, dhcpServer, nomsDhcp, reglagesServis, setRegistre, vidarr } from '../src/valhalla/modules/vidarr.ts';
import { localDay } from '../src/valhalla/vidarr/history.ts';
import { DnsServer } from '../src/valhalla/vidarr/server.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import { vendorOf } from '../src/hlidskjalf/vendors.ts';

const ip4 = (s: string) => Buffer.from(s.split('.').map(Number));
const BOX = '192.0.2.1', ODIN = '192.0.2.2';
const M = { box: '00:00:5e:00:53:01', odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', tel: '02:00:5e:00:53:14', inconnu: '00:00:5e:00:53:77', carte: 'b8:27:eb:00:53:10' };
const T0 = Date.UTC(2026, 10, 24, 9, 0, 0), MIN = 60_000, H = 3600_000;
const CFG = (): DhcpConfig => ({ server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [] });
type Envoi = { p: Packet; vers: string };
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string; classe?: string; tient?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, ciaddr: o.tient ?? '0.0.0.0', options: [[53, Buffer.from([type])], ...(o.nom !== undefined ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, ip4(o.veut)] as [number, Buffer]] : []), ...(o.classe !== undefined ? [[60, Buffer.from(o.classe, 'latin1')] as [number, Buffer]] : [])] });
const genre = (e?: Envoi) => e?.p.options.get(53)?.[0];

/** Un serveur d'adresses seul, sans prise réseau : ses réponses sont relevées en mémoire. */
function serveurSeul(policy?: MacPolicy) {
  let leases: Lease[] = []; const envois: Envoi[] = []; let now = T0; const cfg = { ...CFG(), macPolicy: policy };
  const srv = new DhcpServer({ config: () => cfg, leases: () => leases, save: (l) => { leases = l; }, now: () => now });
  (srv as unknown as { sock: unknown }).sock = { send: (b: Buffer, _port: number, vers: string) => { envois.push({ p: parsePacket(b), vers }); }, close: () => {} };
  const dit = (b: Buffer) => { const n = envois.length; srv.onMessage(b); return envois[n]; };
  /** L'appareil demande une adresse et la prend. */
  const prend = (mac: string, o: { nom?: string; classe?: string } = {}) => { const offre = dit(paquet(mac, MSG.DISCOVER, o)); assert.equal(genre(offre), MSG.OFFER, `${mac} : une offre`); const ack = dit(paquet(mac, MSG.REQUEST, { ...o, veut: offre.p.yiaddr })); assert.equal(genre(ack), MSG.ACK, `${mac} : accord`); return offre.p.yiaddr; };
  return { srv, cfg, dit, prend, envois, leases: () => leases, bail: (mac: string) => leases.find((l) => l.mac === mac), avance: (ms: number) => { now += ms; }, now: () => now };
}

// ------------------------------------------------------------------ les textes venus du réseau
test('R2 · texte venu du réseau : jamais de balise, jamais de caractère de contrôle (nom d\'hôte, ce que l\'appareil dit de lui)', () => {
  const sale = '<img src=x onerror=alert(1)>\u0000\u0007\u001b[31m\u202eTélé\u200b du salon\r\n';
  const nom = nomAnnonce(Buffer.from(sale, 'utf8'))!;
  assert.doesNotMatch(nom, /[<>&"`\\=()\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f]/u, 'nom d\'hôte : aucune balise, aucun caractère de contrôle');
  assert.match(nom, /Télé du salon/, 'les lettres restent, accents compris');
  assert.ok(nom.length <= 63);
  const classe = classeAnnoncee(Buffer.from('<script>alert(1)</script>\u0001 udhcp 1.31 "x" \'y\' `z`', 'latin1'))!;
  assert.doesNotMatch(classe, /[<>&"'`\\\u0000-\u001f\u007f-ÿ]/u, 'ce que l\'appareil dit de lui : aucune balise');
  assert.match(classe, /udhcp 1\.31/);
  assert.equal(nomAnnonce(Buffer.from('\u0000\u0001<>', 'utf8')), undefined, 'rien de lisible : pas de nom');
  assert.equal(nomAnnonce(undefined), undefined);
  // Le nettoyage de tout texte montré (aussi pour un bail enregistré avant ce lot, ou un nom tapé).
  assert.equal(texteSur('<b>PC</b>\u202e\u0007 du  bureau & "co"'), 'bPC/b du bureau co');
  assert.equal(texteSur('a\u2028b\u2029c\ufeffd'), 'a b c d');
  assert.equal([...texteSur('é'.repeat(200))].length, 63);
  assert.equal(texteSur(undefined), '');
});

// ------------------------------------------------------------------ le DHCP : date d'arrivée, « vu connecté », nom gardé
test('R2 · DHCP : la date d\'arrivée et « vu connecté » sont notés ; un nom donné par le propriétaire reste', () => {
  const w = serveurSeul();
  const ip = w.prend(M.pc, { nom: 'PC-BUREAU', classe: 'MSFT 5.0' });
  let b = w.bail(M.pc)!;
  assert.deepEqual([b.ip, b.first, b.since, b.seen, b.name, b.vendorClass], [ip, T0, T0, T0, 'PC-BUREAU', 'MSFT 5.0'], 'premier bail : arrivé maintenant, vu maintenant');
  // Un paquet 20 secondes plus tard : le signe est gardé en mémoire, rien n'est réécrit dans les baux (relecture : un
  // appareil qui redemande sans cesse n'use pas le disque).
  w.avance(20_000); w.dit(paquet(M.pc, MSG.INFORM, { tient: ip }));
  assert.equal(w.bail(M.pc)!.seen, T0, 'pas d\'écriture à chaque paquet');
  assert.equal(w.srv.dernierSigne(M.pc), T0 + 20_000, 'le signe est connu');
  // 5 minutes plus tard, il se manifeste : vu à ce moment, la date d'arrivée ne bouge pas.
  w.avance(5 * MIN); w.dit(paquet(M.pc, MSG.INFORM, { tient: ip }));
  assert.deepEqual([w.srv.dernierSigne(M.pc), w.bail(M.pc)!.since], [T0 + 20_000 + 5 * MIN, T0], 'vu connecté mis à jour, arrivée gardée');
  // Renouvellement à mi-bail : même présence, donc même date d'arrivée.
  w.avance(6 * H); assert.equal(genre(w.dit(paquet(M.pc, MSG.REQUEST, { tient: ip, nom: 'PC-BUREAU' }))), MSG.ACK);
  b = w.bail(M.pc)!; assert.deepEqual([b.since, b.first, b.seen], [T0, T0, w.now()], 'renouvelé : arrivée gardée, vu maintenant');
  // Le propriétaire lui donne un nom : le nom que l'appareil annonce ne l'écrase plus.
  const tous = w.leases(); tous.splice(0, tous.length, ...tous.map((l) => (l.mac === M.pc ? { ...l, name: 'PC du bureau', named: true } : l)));
  w.avance(H); w.dit(paquet(M.pc, MSG.REQUEST, { tient: ip, nom: 'DESKTOP-AB12' }));
  assert.deepEqual([w.bail(M.pc)!.name, w.bail(M.pc)!.named], ['PC du bureau', true], 'le nom du propriétaire reste');
  // Il part (bail fini), puis revient : nouvelle date d'arrivée, la toute première fois reste.
  w.avance(13 * H); const retour = w.now(); w.prend(M.pc, { nom: 'DESKTOP-AB12' });
  b = w.bail(M.pc)!; assert.deepEqual([b.since, b.first, b.name], [retour, T0, 'PC du bureau'], 'revenu : arrivée d\'aujourd\'hui, première fois gardée');
  // Un nom d'hôte piégé n'entre jamais tel quel dans les baux.
  w.prend(M.inconnu, { nom: '<svg/onload=alert(1)>\u0007', classe: '<b>udhcp</b>' });
  assert.doesNotMatch(JSON.stringify(w.bail(M.inconnu)), /[<>]|\\u0007/, 'bail : ni balise ni caractère de contrôle');
});

test('R2 · DHCP : un appareil bloqué qui tient encore son adresse reçoit UN refus net au renouvellement, lâche l\'adresse, puis plus rien', () => {
  const pol: MacPolicy = { mode: 'ouvert', etats: {}, attente: [] }, w = serveurSeul(pol);
  const ip = w.prend(M.inconnu, { nom: 'camera' }), ipPc = w.prend(M.pc, { nom: 'pc' });
  pol.etats[M.inconnu] = 'bloque';
  // Tant qu'il n'a pas redemandé, son adresse n'est redonnée à personne (pas deux appareils sur la même adresse).
  assert.ok(w.bail(M.inconnu)!.expires > w.now(), 'il tient encore son adresse');
  assert.equal(w.dit(paquet(M.inconnu, MSG.DISCOVER)), undefined, 'bloqué : aucune offre');
  // Il demande à garder son adresse : refus net (NAK), et son bail est fini tout de suite.
  w.avance(6 * H);
  const refus = w.dit(paquet(M.inconnu, MSG.REQUEST, { tient: ip }));
  assert.equal(genre(refus), MSG.NAK, 'refus net au renouvellement');
  assert.equal(refus!.p.yiaddr, '0.0.0.0');
  assert.equal(w.bail(M.inconnu)!.expires, w.now(), 'son bail est fini : il sort du réseau');
  // Ensuite : plus aucune réponse, quoi qu'il demande.
  assert.equal(w.dit(paquet(M.inconnu, MSG.REQUEST, { tient: ip })), undefined, 'ensuite : rien');
  assert.equal(w.dit(paquet(M.inconnu, MSG.DISCOVER)), undefined);
  // Les autres ne sont pas touchés, et une demande faite à un AUTRE serveur n'est jamais refusée par Odin.
  assert.equal(genre(w.dit(paquet(M.pc, MSG.REQUEST, { tient: ipPc }))), MSG.ACK, 'le PC garde son adresse');
  pol.etats[M.pc] = 'bloque';
  const ailleurs = buildPacket({ op: 1, xid: 9, mac: M.pc, options: [[53, Buffer.from([MSG.REQUEST])], [50, ip4(ipPc)], [54, ip4('192.0.2.9')]] });
  assert.equal(w.dit(ailleurs), undefined, 'demande adressée à un autre serveur : Odin se tait');
  // En pause : le refus net libère aussi l'adresse.
  const p2: MacPolicy = { mode: 'ouvert', etats: {}, attente: [] }, w2 = serveurSeul(p2), ip2 = w2.prend(M.tel);
  p2.etats[M.tel] = 'pause';
  assert.equal(genre(w2.dit(paquet(M.tel, MSG.REQUEST, { tient: ip2 }))), MSG.NAK);
  assert.equal(w2.bail(M.tel)!.expires, w2.now(), 'en pause : adresse lâchée au refus');
});

// ------------------------------------------------------------------ la vue (pure)
const vue = (o: Partial<Parameters<typeof vueAppareils>[0]> & { leases: Lease[] }): VueAppareils => vueAppareils({
  config: CFG(), policy: { mode: 'ouvert', etats: {}, attente: [] }, now: T0, dhcpAllume: true, dnsAllume: true, fabricant: (mac) => (mac.startsWith('00:00:5e') ? 'Fabricant B' : ''), macsOdin: [M.odin], heure: (t) => `h${(t - T0) / H}`, ...o,
});
const bail = (mac: string, ip: string, x: Partial<Lease> = {}): Lease => ({ mac, ip, expires: T0 + 6 * H, first: T0 - 9 * 24 * H, since: T0 - H, seen: T0 - MIN, ...x });
const de = (v: VueAppareils, mac: string): Appareil => v.appareils.find((d) => d.mac === mac)!;

test('R2 · vue : bail, fabricant d\'après la MAC, type deviné, connecté ou non, nouveau', () => {
  const v = vue({
    leases: [
      bail(M.pc, '192.0.2.123', { name: 'PC du bureau', vendorClass: 'MSFT 5.0' }),
      bail(M.tel, '192.0.2.114', { name: 'Telephone 1', vendorClass: 'android-dhcp-14', seen: T0 - 3 * H }),
      bail(M.inconnu, '192.0.2.177', { first: T0 - 2 * H, since: T0 - 2 * H, vendorClass: 'udhcp 1.31' }),
      bail('00:00:5e:00:53:33', '192.0.2.133', { name: 'Tablette', expires: T0 - 3 * H, seen: T0 - 15 * H }),
    ],
    dernierDns: (ip) => (ip === '192.0.2.114' ? T0 - 2 * MIN : undefined),
  });
  assert.deepEqual(v.appareils.map((d) => d.mac), [M.tel, M.pc, M.inconnu, '00:00:5e:00:53:33'], 'rangés par adresse, sans adresse à la fin');
  const pc = de(v, M.pc);
  assert.deepEqual([pc.nom, pc.ip, pc.fabricant, pc.type, pc.typeNom, pc.systeme, pc.prive], ['PC du bureau', '192.0.2.123', 'Fabricant B', 'pc', 'Ordinateur', 'Windows', false]);
  assert.deepEqual([pc.connecte, pc.presence, pc.depuis, pc.jusqua, pc.nomReseau, pc.nouveau], [true, 'vu', T0 - H, T0 + 6 * H, 'pc-du-bureau.maison', false]);
  // Le téléphone : MAC privée (pas de fabricant), vu par sa question au DNS d'Odin il y a 2 minutes.
  const tel = de(v, M.tel);
  assert.deepEqual([tel.prive, tel.fabricant, tel.type, tel.systeme, tel.connecte, tel.vu], [true, '', 'tel', 'Android 14', true, T0 - 2 * MIN], 'connecté : signe au DNS depuis moins de 10 minutes');
  // L'inconnu arrivé il y a 2 heures : nouveau, sans nom, objet deviné.
  const n = de(v, M.inconnu);
  assert.deepEqual([n.nom, n.nouveau, n.type, n.nomReseau, n.nomDonne], ['Appareil sans nom', true, 'obj', '', false]);
  // La tablette : bail fini, pas connectée, plus d'adresse.
  const tab = de(v, '00:00:5e:00:53:33');
  assert.deepEqual([tab.connecte, tab.presence, tab.ip, tab.type, tab.depuis, tab.jusqua], [false, 'absent', '', 'tab', 0, 0]);
  assert.deepEqual(v.chiffres, { connectes: 3, connus: 4, nouveaux: 1, bloques: 0 });
  // Un bail en cours sans signe récent n'est pas dit « connecté ».
  const calme = de(vue({ leases: [bail(M.pc, '192.0.2.123', { seen: T0 - 3 * H })] }), M.pc);
  assert.deepEqual([calme.connecte, calme.presence, calme.vu], [false, 'bail', T0 - 3 * H]);
  // « Nouveau » s'arrête : après un jour, ou dès que le propriétaire le connaît, ou s'il a une adresse fixe.
  assert.equal(de(vue({ leases: [bail(M.inconnu, '192.0.2.177', { first: T0 - 25 * H })] }), M.inconnu).nouveau, false);
  assert.equal(de(vue({ leases: [bail(M.inconnu, '192.0.2.177', { first: T0 - H })], policy: { mode: 'ouvert', etats: { [M.inconnu]: 'actif' }, attente: [] } }), M.inconnu).nouveau, false);
  // Liste d'autorisation : un appareil qui attend est « nouveau », sans adresse.
  const att = de(vue({ leases: [], policy: { mode: 'liste', etats: {}, attente: [M.inconnu] } }), M.inconnu);
  assert.deepEqual([att.etat, att.nouveau, att.ip, att.connecte], ['attente', true, '', false]);
  // Les types devinés (et rien d'inventé quand on ne sait pas).
  assert.deepEqual(['Imprimante-salon', 'Tele du salon', 'camera-entree', 'NAS', 'console-jeu', 'portable-1', 'x9f2'].map((nom) => typeDevine({ nom })), ['imp', 'tv', 'cam', 'srv', 'jeu', 'lap', 'inc']);
  // Le fabricant vient de la table qui est dans le code (aucun service extérieur) ; une MAC privée n'en a pas.
  assert.equal(vendorOf(M.carte), 'Raspberry Pi'); assert.equal(vendorOf(M.tel), '');
  // Un texte piégé resté dans un vieux bail ressort nettoyé.
  const sale = de(vue({ leases: [bail(M.pc, '192.0.2.123', { name: '<img src=x onerror=1>\u0007PC', vendorClass: '<script>x</script>' })] }), M.pc);
  assert.doesNotMatch(JSON.stringify(sale), /[<>]|\\u0007/, 'rien de dangereux ne sort de la vue');
});

test('R2 · vue : la box, Odin, l\'appareil que l\'on tient ; bloqué « tient encore » puis « retiré »', () => {
  const v = vue({
    config: { ...CFG(), fixed: [{ mac: M.box, ip: BOX, name: 'Box' }] },
    leases: [bail(M.odin, '192.0.2.50'), bail(M.pc, '192.0.2.123', { name: 'PC du bureau' }), bail(M.inconnu, '192.0.2.177', { name: 'camera' }), bail(M.tel, '192.0.2.114', { name: 'Telephone 1', expires: T0 - MIN })],
    policy: { mode: 'ouvert', etats: { [M.inconnu]: 'bloque', [M.tel]: 'bloque' }, attente: [] }, ici: '192.0.2.123',
  });
  assert.deepEqual([de(v, M.box).garde, de(v, M.box).type, de(v, M.odin).garde, de(v, M.odin).connecte, de(v, M.pc).garde], ['box', 'box', 'odin', true, '']);
  assert.deepEqual([de(v, M.pc).ici, de(v, M.inconnu).ici, v.origineConnue], [true, false, true]);
  // Bloqué, bail pas fini : il tient encore son adresse, Internet coupé par le DNS, plus de nom dans le DNS.
  const tient = de(v, M.inconnu);
  assert.deepEqual([tient.etat, tient.retire, tient.coupeDns, tient.ip, tient.nomReseau, tient.jusqua], ['bloque', false, true, '192.0.2.177', '', T0 + 6 * H]);
  // Bloqué, bail fini : retiré du réseau, aucune adresse.
  const sorti = de(v, M.tel);
  assert.deepEqual([sorti.retire, sorti.coupeDns, sorti.ip, sorti.connecte, sorti.presence], [true, false, '', false, 'absent']);
  assert.equal(v.chiffres.bloques, 2);
  assert.equal(vue({ leases: [] }).origineConnue, false, 'sans origine : Odin ne sait pas d\'où l\'on agit');
});

test('R2 · garde-fou : jamais la box, jamais Odin, jamais l\'appareil que l\'on tient sans l\'avoir dit ; débloquer passe toujours', () => {
  const box = { garde: 'box' as const, ici: false, nom: 'Box internet' }, odin = { garde: 'odin' as const, ici: false, nom: 'Odin (ce serveur)' };
  const mien = { garde: '' as const, ici: true, nom: 'PC du bureau' }, autre = { garde: '' as const, ici: false, nom: 'Console' };
  for (const etat of ['bloque', 'pause'] as const) {
    assert.match(gardeEtat(box, etat).refus!, /Refusé : « Box internet » est la box, la passerelle/);
    assert.match(gardeEtat(odin, etat).refus!, /Refusé : « Odin \(ce serveur\) » est Odin lui-même/);
    assert.deepEqual(gardeEtat(box, etat, { leMien: true }).code, 'box', 'la box : même en insistant');
    const g = gardeEtat(mien, etat);
    assert.equal(g.code, 'ici'); assert.match(g.refus!, /« PC du bureau » est l'appareil que tu tiens en ce moment/); assert.match(g.refus!, /Rien n'est fait/);
    assert.deepEqual(gardeEtat(mien, etat, { leMien: true }), {}, 'dit en clair : accepté');
    assert.deepEqual(gardeEtat(autre, etat), {});
  }
  for (const d of [box, odin, mien, autre, undefined]) assert.deepEqual(gardeEtat(d, 'actif'), {}, 'débloquer passe toujours');
});

test('R2 · ce que « bloquer » fait vraiment, et ce qu\'Odin ne peut pas faire (Odin distribue / la box distribue)', () => {
  const d = { ip: '192.0.2.177', vivant: true, jusqua: T0 + 6 * H, nomReseau: 'camera.maison', prive: false }, heure = (t: number) => `${(t - T0) / H} h`;
  const odin = effetsDe(d, { dhcpAllume: true, dnsAllume: true, heure });
  assert.match(odin.bloque.fait.join('\n'), /n'obtient plus d'adresse/);
  assert.match(odin.bloque.fait.join('\n'), /Il tient encore 192\.0\.2\.177 : à son prochain renouvellement Odin la lui refuse et il sort du réseau, au plus tard à la fin de son bail \(6 h\)/);
  assert.match(odin.bloque.fait.join('\n'), /Internet lui est coupé par le DNS d'Odin/);
  assert.match(odin.bloque.fait.join('\n'), /n'est redonnée à personne avant qu'il l'ait lâchée/);
  assert.match(odin.bloque.fait.join('\n'), /Son nom camera\.maison disparaît du DNS/);
  assert.match(odin.bloque.limites.join('\n'), /ne peut pas lui reprendre son adresse à la seconde/);
  assert.match(odin.bloque.limites.join('\n'), /réglé à la main .* peut encore parler sur le réseau : seuls la box ou le Wi-Fi/);
  assert.doesNotMatch(odin.bloque.limites.join('\n'), /MAC privée/);
  assert.match(effetsDe({ ...d, prive: true }, { dhcpAllume: true, dnsAllume: true, heure }).bloque.limites.join('\n'), /Adresse MAC privée : ce téléphone peut revenir avec une autre adresse MAC/);
  assert.doesNotMatch(effetsDe(d, { dhcpAllume: true, dnsAllume: false, heure }).bloque.fait.join('\n'), /DNS d'Odin \(s'il passe/, 'DNS d\'Odin éteint : Odin ne promet pas de couper Internet');
  assert.match(odin.pause.fait.join('\n'), /Son bail n'est plus renouvelé : il perd le réseau à son prochain renouvellement, au plus tard à 6 h/);
  // La box distribue les adresses : Odin dit qu'il ne peut ni retirer l'adresse ni sortir l'appareil du réseau.
  const box = effetsDe({ ...d, ip: '', vivant: false }, { dhcpAllume: false, dnsAllume: true, heure });
  assert.deepEqual(box.bloque.fait, ['C\'est noté : dès qu\'Odin distribuera les adresses, il n\'en recevra plus.']);
  assert.match(box.bloque.limites.join('\n'), /c'est la box qui distribue les adresses : Odin ne peut ni lui retirer son adresse ni le sortir du réseau/);
  assert.match(box.bloque.limites.join('\n'), /il ne peut pas non plus lui couper Internet par le DNS/);
  assert.match(box.bloque.limites.join('\n'), /bloque-le dans la box .* ou laisse Odin distribuer les adresses/);
});

// ------------------------------------------------------------------ dans Sphinx (vrai module, prise simulée)
const dossiers: string[] = [];
const PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs;
after(() => { PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

/** Un Odin d'essai avec Sphinx seul : aucune commande, aucune sortie réseau, la prise du DHCP simulée. */
async function monde(o: { allume?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-r2-')); dossiers.push(home);
  const envois: Envoi[] = []; let now = T0;
  PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer, _p: number, vers: string) => { envois.push({ p: parsePacket(b), vers }); }, close: () => {} }; };
  LOCAL.macs = () => [M.odin];
  setVerificateur(() => undefined);
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }), fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(now) });
  const ctx = v.ctx('vidarr');
  ctx.saveSettings({ dhcp: { ...CFG(), fixed: [{ mac: M.box, ip: BOX, name: 'Box' }] } });
  if (o.allume !== false) { const r = await v.act('vidarr', 'dhcp_demarrer', { forcer: true }); assert.equal(r.ok !== false, true, r.text); }
  const dit = (b: Buffer) => { const n = envois.length; dhcpServer()!.onMessage(b); return envois[n]; };
  const prend = (mac: string, x: { nom?: string; classe?: string } = {}) => { const offre = dit(paquet(mac, MSG.DISCOVER, x)); assert.equal(genre(offre), MSG.OFFER, `${mac} : une offre`); assert.equal(genre(dit(paquet(mac, MSG.REQUEST, { ...x, veut: offre.p.yiaddr }))), MSG.ACK); return offre.p.yiaddr; };
  const vus = async (opts?: Parameters<Valhalla['act']>[3]) => { const r = await v.act('vidarr', 'baux_vus', {}, opts); return { r, D: r.data as VueAppareils & { proprietaire: boolean; limite: string } }; };
  const etats = () => (ctx.settings.macPolicy as MacPolicy | undefined)?.etats ?? {};
  return { v, ctx, dit, prend, vus, etats, envois, avance: (ms: number) => { now += ms; }, now: () => now, fin: () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; } };
}

test('R2 · Sphinx : « baux_vus » montre qui a quelle adresse ; une machine inconnue reçoit une adresse et est signalée', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, { nom: 'PC-BUREAU', classe: 'MSFT 5.0' }), ipCarte = w.prend(M.carte, { nom: '<img src=x onerror=alert(1)>', classe: '<script>udhcp</script>' });
    const { r, D } = await w.vus();
    assert.equal(r.ok !== false, true, r.text);
    const a = w.v.module('vidarr')!.actions.find((x) => x.id === 'baux_vus')!;
    assert.deepEqual([a.read, a.external, a.proprietaireSeul], [true, true, undefined], 'une lecture ; sa réponse est une donnée venue du réseau, jamais un ordre');
    assert.deepEqual([D.proprietaire, D.dhcp.allume, D.dhcp.mode, D.limite], [true, true, 'ouvert', '']);
    const pc = D.appareils.find((d) => d.mac === M.pc)!, carte = D.appareils.find((d) => d.mac === M.carte)!;
    assert.deepEqual([pc.nom, pc.ip, pc.type, pc.systeme, pc.connecte, pc.nouveau, pc.depuis, pc.premier, pc.jusqua], ['PC-BUREAU', ipPc, 'pc', 'Windows', true, true, T0, T0, T0 + 12 * H], 'inconnue : elle a reçu une adresse, et elle est signalée « nouveau »');
    assert.deepEqual([carte.ip, carte.fabricant, carte.nouveau], [ipCarte, 'Raspberry Pi', true], 'fabricant d\'après l\'adresse MAC, par la table du code');
    assert.doesNotMatch(JSON.stringify(D) + r.text, /[<>]|onerror=alert\(|script>/, 'le nom piégé ne sort ni dans les données ni dans le texte');
    assert.deepEqual(D.appareils.find((d) => d.mac === M.box)!.garde, 'box');
    assert.deepEqual(D.chiffres, { connectes: 2, connus: 3, nouveaux: 2, bloques: 0 });
    assert.match(r.text, /Le DHCP d'Odin distribue les adresses \(192\.0\.2\.100 à 192\.0\.2\.199\)/);
    assert.match(r.text, /PC-BUREAU · 192\.0\.2\.\d+ · 00:00:5e:00:53:23 · Ordinateur · connecté · NOUVEAU/);
    // 11 minutes sans signe : plus « connecté », mais son bail court encore.
    w.avance(11 * MIN);
    const apres = (await w.vus()).D.appareils.find((d) => d.mac === M.pc)!;
    assert.deepEqual([apres.connecte, apres.presence], [false, 'bail']);
    // « Je le connais » (avec un nom) : plus « nouveau », le nom est gardé même si l'appareil en annonce un autre.
    const ok = await w.v.act('vidarr', 'dhcp_approuver', { mac: M.pc, nom: 'PC du <b>bureau</b>' });
    assert.equal(ok.ok !== false, true, ok.text);
    w.dit(paquet(M.pc, MSG.REQUEST, { tient: ipPc, nom: 'DESKTOP-AB12' }));
    const connu = (await w.vus()).D.appareils.find((d) => d.mac === M.pc)!;
    assert.deepEqual([connu.nom, connu.nomDonne, connu.nouveau, connu.nomReseau, connu.connecte], ['PC du bbureau/b', true, false, 'pc-du-bbureau-b.maison', true]);
  } finally { w.fin(); }
});

test('R2 · Sphinx : bloquer = plus d\'adresse ET retiré du réseau autant qu\'Odin le peut ; débloquer rend tout', async () => {
  const w = await monde();
  try {
    const ip = w.prend(M.inconnu, { nom: 'camera' }); w.prend(M.pc, { nom: 'PC-BUREAU' });
    const a = w.v.module('vidarr')!.actions.find((x) => x.id === 'dhcp_mac_etat')!;
    // La confirmation nomme l'appareil.
    // (Relecture : tant qu'Odin ne sait pas depuis quel appareil on agit, la confirmation le dit aussi.)
    const AVIS = ' ⚠ Odin ne sait pas depuis quel appareil tu agis : si c\'est celui que tu tiens, tu perds Odin avec lui.';
    assert.equal(a.grave!({ mac: M.inconnu, etat: 'bloque' }, w.ctx), `bloquer « camera » (00:00:5e:00:53:77) : il n'obtient plus d'adresse et il est retiré du réseau${AVIS}`);
    assert.equal(a.grave!({ mac: M.inconnu, etat: 'pause' }, w.ctx), `mettre en pause « camera » (00:00:5e:00:53:77) : son bail n'est plus renouvelé, il perdra le réseau${AVIS}`);
    assert.equal(a.grave!({ mac: M.inconnu, etat: 'actif' }, w.ctx), undefined, 'débloquer : pas de question');
    assert.doesNotMatch(a.grave!({ mac: M.inconnu, etat: 'bloque', nom: '<i>x</i>' }, undefined)!, /[<>]/);
    const r = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.inconnu, etat: 'bloque' });
    assert.equal(r.ok !== false, true, r.text);
    assert.match(r.text, /^⛔ camera bloqué\.\nCe qui est fait :\n- Le DHCP d'Odin ne lui répond plus : il n'obtient plus d'adresse\./);
    assert.match(r.text, new RegExp(`Il tient encore ${ip.replace(/\./g, '\\.')} : à son prochain renouvellement Odin la lui refuse et il sort du réseau`));
    assert.match(r.text, /Son nom camera\.maison disparaît du DNS/);
    assert.match(r.text, /Ce qu'Odin ne peut pas faire :\n- Odin ne peut pas lui reprendre son adresse à la seconde/);
    assert.match(r.text, /Tu peux le débloquer à tout moment\.$/);
    assert.doesNotMatch(r.text, /DNS d'Odin \(s'il passe/, 'le DNS d\'Odin est éteint dans cet essai : pas de promesse');
    assert.equal(w.etats()[M.inconnu], 'bloque');
    // D'ici là : Internet lui est coupé par le DNS d'Odin (règle qui suit le bail, rien d'écrit dans les réglages).
    assert.deepEqual(coupuresBlocage(w.ctx).map((c) => [c.ids, c.cut, c.name]), [[[ip], true, 'camera']]);
    const dns = new DnsServer({ settings: () => reglagesServis(w.ctx), lists: () => [], fetch: (async () => { throw new Error('essai'); }) as never, now: () => w.now() } as never);
    assert.equal(dns.verdict('exemple.example.org', ip)?.action, 'block', 'Internet coupé pour l\'appareil bloqué');
    assert.notEqual(dns.verdict('exemple.example.org', '192.0.2.150')?.action, 'block', 'les autres ne sont pas touchés');
    assert.equal((w.ctx.settings.dns as { clients?: unknown[] } | undefined)?.clients?.length ?? 0, 0, 'aucune règle écrite : elle ne survivra pas à l\'adresse');
    let d = (await w.vus()).D.appareils.find((x) => x.mac === M.inconnu)!;
    assert.deepEqual([d.etat, d.retire, d.ip, d.nomReseau], ['bloque', false, ip, '']);
    // Il redemande son adresse : refus net, il sort du réseau. Il peut ne pas obéir : son adresse reste retenue (et coupée
    // par le DNS) jusqu'à la fin du bail d'origine, puis tout s'arrête (relecture).
    w.avance(6 * H);
    assert.equal(genre(w.dit(paquet(M.inconnu, MSG.REQUEST, { tient: ip }))), MSG.NAK);
    d = (await w.vus()).D.appareils.find((x) => x.mac === M.inconnu)!;
    assert.deepEqual([d.retire, d.ip, d.connecte, d.coupeDns], [true, '', false, false], 'retiré du réseau');
    assert.deepEqual(coupuresBlocage(w.ctx).map((c) => c.ids), [[ip]], 'adresse retenue : encore coupée, et redonnée à personne');
    assert.equal(w.dit(paquet(M.inconnu, MSG.DISCOVER)), undefined, 'il n\'obtient plus d\'adresse');
    assert.match((await w.vus()).r.text, /camera · aucune adresse · .* · bloqué, retiré du réseau/);
    // Débloquer : il retrouve une adresse.
    const de2 = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.inconnu, etat: 'actif' });
    assert.match(de2.text, /✅ camera réactivé \(débloqué\) : il reçoit de nouveau une adresse à sa prochaine demande/);
    assert.equal(genre(w.dit(paquet(M.inconnu, MSG.DISCOVER))), MSG.OFFER, 'débloqué : une offre');
    // En pause : dit ce qui se passe, et « Fin de la pause » rend tout.
    const p = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.pc, etat: 'pause' });
    assert.match(p.text, /^⏸ PC-BUREAU en pause\.\nCe qui est fait :\n- Son bail n'est plus renouvelé : il perd le réseau à son prochain renouvellement/);
    assert.deepEqual(coupuresBlocage(w.ctx), [], 'en pause : Internet n\'est pas coupé par le DNS');
    // Chaque geste est noté « qui a fait quoi ».
    const j = await w.v.act('vidarr', 'qui_a_fait', { n: 20 });
    assert.match(j.text, /propriétaire · État DHCP d'un appareil \(mac : 00:00:5e:00:53:77 · etat : bloque\) · fait/);
  } finally { w.fin(); }
});

test('R2 · Sphinx : jamais la box, jamais Odin, jamais l\'appareil que l\'on tient sans l\'avoir dit', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, { nom: 'PC-BUREAU' });
    for (const etat of ['bloque', 'pause']) {
      const box = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.box, etat });
      assert.equal(box.ok, false); assert.match(box.text, /refusé : « Box » est la box, la passerelle de toute la maison/);
      const odin = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.odin, etat });
      assert.equal(odin.ok, false); assert.match(odin.text, /refusé : « Odin \(ce serveur\) » est Odin lui-même/);
    }
    // La machine d'Odin reconnue aussi par son adresse (un bail à l'adresse du serveur).
    w.ctx.saveSettings({ leases: [...(w.ctx.settings.leases as Lease[]), { mac: '00:00:5e:00:53:99', ip: ODIN, expires: w.now() + H, name: 'serveur' }] });
    assert.match((await w.v.act('vidarr', 'dhcp_mac_etat', { mac: '00:00:5e:00:53:99', etat: 'bloque' })).text, /est Odin lui-même/);
    assert.deepEqual(w.etats(), {}, 'rien n\'a été bloqué');
    // Le propriétaire agit depuis le PC du bureau : refus avec un avertissement clair, rien n'est fait.
    const refus = await origineDemande.run(`::ffff:${ipPc}`, () => w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.pc, etat: 'bloque' }));
    assert.equal(refus.ok, false); assert.deepEqual(refus.data, { code: 'ici' });
    assert.match(refus.text, /« PC-BUREAU » est l'appareil que tu tiens en ce moment\. Le bloquer te couperait d'Odin/);
    assert.deepEqual(w.etats(), {}, 'toujours rien');
    const vu = await origineDemande.run(ipPc, () => w.vus());
    assert.deepEqual([vu.D.origineConnue, vu.D.appareils.find((d) => d.mac === M.pc)!.ici], [true, true]);
    assert.equal((await w.vus()).D.origineConnue, false, 'sans origine connue, Odin le dit (la page prévient)');
    // Dit en clair : c'est fait.
    const oui = await origineDemande.run(ipPc, () => w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.pc, etat: 'bloque', le_mien: true }));
    assert.equal(oui.ok !== false, true, oui.text); assert.equal(w.etats()[M.pc], 'bloque');
    // Depuis un autre appareil, bloquer un tiers ne demande rien de plus.
    const ipT = w.prend(M.tel, { nom: 'Telephone 1' });
    const tiers = await origineDemande.run(ipT, () => w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.carte, etat: 'bloque', nom: 'Inconnu' }));
    assert.equal(tiers.ok !== false, true, tiers.text);
  } finally { w.fin(); }
});

test('R2 · Sphinx : quand la box distribue les adresses, Odin dit exactement ce qu\'il ne peut pas faire', async () => {
  const w = await monde({ allume: false });
  try {
    assert.equal(dhcpServer(), undefined, 'le DHCP d\'Odin est éteint');
    const { r, D } = await w.vus();
    assert.equal(D.dhcp.allume, false);
    assert.match(r.text, /La box distribue les adresses : Odin ne voit ici que les appareils qu'il a déjà servis, et ne peut pas les sortir du réseau/);
    const b = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.inconnu, etat: 'bloque', nom: 'Appareil inconnu' });
    assert.equal(b.ok !== false, true, b.text);
    assert.match(b.text, /^⛔ Appareil inconnu bloqué\.\nCe qui est fait :\n- C'est noté : dès qu'Odin distribuera les adresses, il n'en recevra plus\./);
    assert.match(b.text, /Ce qu'Odin ne peut pas faire :\n- Aujourd'hui c'est la box qui distribue les adresses : Odin ne peut ni lui retirer son adresse ni le sortir du réseau\./);
    assert.match(b.text, /bloque-le dans la box \(Wi-Fi, filtrage par adresse MAC\), ou laisse Odin distribuer les adresses/);
    assert.doesNotMatch(b.text, /il sort du réseau|Internet lui est coupé/, 'aucune promesse qu\'Odin ne tient pas');
    const d = (await w.vus()).D.appareils.find((x) => x.mac === M.inconnu)!;
    assert.deepEqual([d.etat, d.ip, d.retire], ['bloque', '', true], 'noté bloqué, visible dans la liste pour le débloquer');
    assert.match((await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.inconnu, etat: 'actif' })).text, /dès qu'Odin distribuera les adresses/);
  } finally { w.fin(); }
});

test('R2 · Sphinx : les gestes sont au propriétaire seul ; un membre ne voit que l\'appareil qu\'il tient', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, { nom: 'PC-BUREAU' }), ipTel = w.prend(M.tel, { nom: 'Telephone 1' });
    const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
    // Un membre, depuis le téléphone : il ne voit que le téléphone.
    const m = await origineDemande.run(ipTel, () => auNomDe(nour, () => w.vus()));
    assert.deepEqual(m.D.appareils.map((d) => d.mac), [M.tel]);
    assert.deepEqual([m.D.proprietaire, m.D.chiffres.connus], [false, 1]);
    assert.match(m.D.limite, /^Tu ne vois que l'appareil que tu tiens en ce moment\. La liste de tous les appareils de la maison, et les gestes \(bloquer, mettre en pause, débloquer\), sont au propriétaire seul\.$/);
    assert.doesNotMatch(m.r.text, /PC-BUREAU|00:00:5e:00:53:23/, 'rien des appareils des autres');
    // Sans origine connue : rien du tout, et c'est dit.
    const rien = await auNomDe(nour, () => w.vus());
    assert.deepEqual(rien.D.appareils, []); assert.match(rien.D.limite, /^Odin ne reconnaît pas l'appareil que tu tiens : il n'a rien à te montrer\./);
    assert.doesNotMatch(JSON.stringify(rien.r), /PC-BUREAU|Telephone 1|00:00:5e|02:00:5e/);
    // Les autres lectures suivent la même règle.
    const baux = await origineDemande.run(ipTel, () => auNomDe(nour, () => w.v.act('vidarr', 'baux', {})));
    assert.deepEqual((baux.data as Lease[]).map((l) => l.mac), [M.tel]);
    const fiche = await origineDemande.run(ipTel, () => auNomDe(nour, () => w.v.act('vidarr', 'recap_machine', { mac: M.pc })));
    assert.equal(fiche.ok, false); assert.match(fiche.text, /cette fiche est au propriétaire/);
    const page = await origineDemande.run(ipTel, () => auNomDe(nour, async () => JSON.stringify(await w.v.module('vidarr')!.view(w.ctx, new URLSearchParams()))));
    assert.doesNotMatch(page, /PC-BUREAU|00:00:5e:00:53:23/, 'la page générique non plus');
    assert.equal(((await w.v.act('vidarr', 'baux', {})).data as Lease[]).length, 2, 'le propriétaire voit tout');
    // Les gestes : refusés à un membre, à une automatisation, à un autre assistant, à une conversation marquée.
    const pasLui: Array<Parameters<Valhalla['act']>[3]> = [{ qui: 'member' }, { qui: 'guest' }, { auto: true, by: 'automatisation' }, { auto: true, by: 'assistant' }, { by: 'réflexe' }, { qui: 'owner', marque: true }];
    for (const etat of ['bloque', 'pause', 'actif']) {
      for (const o of pasLui) { const r = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.pc, etat }, o); assert.equal(r.ok, false, JSON.stringify(o)); assert.match(r.text, /seul le propriétaire/); }
      const r = await auNomDe(nour, () => w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.pc, etat }));
      assert.equal(r.ok, false); assert.match(r.text, /seul le propriétaire/);
    }
    const j = await auNomDe(nour, () => w.v.act('vidarr', 'dhcp_approuver', { mac: M.pc, nom: 'à moi' }));
    assert.equal(j.ok, false, '« Je le connais » aussi');
    assert.deepEqual(w.etats(), {}, 'rien n\'a changé');
    assert.equal(ipPc.startsWith('192.0.2.'), true);
  } finally { w.fin(); }
});

// ================================================================== relecture en adversaire (lot R2)
test('R2 · relecture : donner un nom à un appareil bloqué ou en pause ne le débloque pas ; un état inconnu n\'est jamais pris pour « débloquer »', async () => {
  const w = await monde();
  try {
    w.prend(M.inconnu, { nom: 'camera' }); w.prend(M.pc, { nom: 'PC-BUREAU' });
    await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.inconnu, etat: 'bloque' }); await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.pc, etat: 'pause' });
    const n = await w.v.act('vidarr', 'dhcp_approuver', { mac: M.inconnu, nom: 'Intrus du garage' });
    assert.equal(n.ok !== false, true, n.text);
    assert.equal(w.etats()[M.inconnu], 'bloque', 'toujours bloqué après « Enregistrer le nom »');
    assert.match(n.text, /reste bloqué/);
    assert.equal((await w.vus()).D.appareils.find((d) => d.mac === M.inconnu)!.nom, 'Intrus du garage', 'le nom, lui, est bien gardé');
    await w.v.act('vidarr', 'dhcp_approuver', { mac: M.pc, nom: 'PC puni' });
    assert.equal(w.etats()[M.pc], 'pause', 'toujours en pause');
    assert.equal(w.dit(paquet(M.inconnu, MSG.DISCOVER)), undefined, 'aucune offre : il est resté dehors');
    // Un état mal écrit (« bloqué », « Bloque », n'importe quoi) : jamais « actif » par défaut.
    const a = w.v.module('vidarr')!.actions.find((x) => x.id === 'dhcp_mac_etat')!;
    assert.match(a.grave!({ mac: M.carte, etat: 'bloqué' }, w.ctx) ?? '', /^bloquer /, '« bloqué » avec accent = bloquer, avec la confirmation');
    const flou = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.inconnu, etat: 'nimporte' });
    assert.equal(flou.ok, false); assert.match(flou.text, /état inconnu/);
    assert.equal(w.etats()[M.inconnu], 'bloque', 'un état inconnu ne débloque rien');
    const accent = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.carte, etat: 'Bloqué' });
    assert.equal(accent.ok !== false, true, accent.text); assert.equal(w.etats()[M.carte], 'bloque');
  } finally { w.fin(); }
});

test('R2 · relecture : un nom d\'hôte piégé ne devient jamais un nom du réseau (odin, box, wpad, nom déjà pris)', async () => {
  const w = await monde();
  try {
    const ipImp = w.prend(M.pc, { nom: 'imprimante' });
    w.avance(MIN);
    // Des appareils inconnus s'annoncent sous des noms qui comptent : aucun ne gagne ce nom dans le DNS.
    const macs = ['00:00:5e:00:53:a1', '00:00:5e:00:53:a2', '00:00:5e:00:53:a3', '00:00:5e:00:53:a4', '00:00:5e:00:53:a5', '00:00:5e:00:53:a6'];
    ['odin', 'WPAD', 'box', 'localhost', 'Passerelle', 'imprimante'].forEach((nom, i) => w.prend(macs[i], { nom }));
    const noms = nomsDhcp(w.ctx);
    for (const n of ['odin', 'odin.maison', 'wpad', 'wpad.maison', 'box', 'box.maison', 'localhost', 'localhost.maison', 'passerelle.maison']) assert.equal(noms[n], undefined, `« ${n} » n'est pas servi`);
    assert.deepEqual(noms['imprimante.maison'], [ipImp], 'le nom reste au premier arrivé : le second ne le vole pas');
    assert.deepEqual(noms.imprimante, [ipImp]);
    const D = (await w.vus()).D;
    assert.equal(D.appareils.find((d) => d.mac === M.pc)!.nomReseau, 'imprimante.maison');
    for (const m of macs) assert.equal(D.appareils.find((d) => d.mac === m)!.nomReseau, '', 'la page dit la même chose que le DNS');
    // Un nom donné par le propriétaire passe devant un nom annoncé, même arrivé avant.
    await w.v.act('vidarr', 'dhcp_approuver', { mac: macs[5], nom: 'imprimante' });
    assert.deepEqual(nomsDhcp(w.ctx)['imprimante.maison'], [(w.ctx.settings.leases as Lease[]).find((l) => l.mac === macs[5])!.ip], 'le nom choisi par le propriétaire gagne');
  } finally { w.fin(); }
});

test('R2 · relecture : après le refus net, l\'adresse n\'est redonnée à personne avant la fin du bail d\'origine (jamais deux appareils sur la même adresse)', async () => {
  const pol: MacPolicy = { mode: 'ouvert', etats: {}, attente: [] }, w = serveurSeul(pol);
  const ip = w.prend(M.inconnu, { nom: 'camera' }), fin = w.bail(M.inconnu)!.expires;
  pol.etats[M.inconnu] = 'bloque';
  w.avance(H); assert.equal(genre(w.dit(paquet(M.inconnu, MSG.REQUEST, { tient: ip }))), MSG.NAK);
  // L'appareil bloqué peut ne pas obéir au refus (ou ne jamais l'avoir reçu) : un autre qui demande CETTE adresse ne l'a pas.
  const offre = w.dit(paquet(M.pc, MSG.DISCOVER, { veut: ip }));
  assert.equal(genre(offre), MSG.OFFER); assert.notEqual(offre!.p.yiaddr, ip, 'l\'adresse est retenue');
  assert.equal(genre(w.dit(paquet(M.pc, MSG.REQUEST, { veut: ip }))), MSG.NAK, 'demandée de force : refusée');
  assert.equal(w.bail(M.inconnu)!.hold, fin, 'retenue jusqu\'à la fin du bail d\'origine');
  // Passé la fin du bail d'origine, elle est libre.
  w.avance(12 * H);
  assert.equal(w.dit(paquet(M.tel, MSG.DISCOVER, { veut: ip }))!.p.yiaddr, ip, 'libre après la fin du bail d\'origine');
});

test('R2 · relecture : la coupure par le DNS dure tant que l\'adresse est retenue, et ne touche jamais Odin, la box ni le DNS de la maison', async () => {
  const w = await monde();
  try {
    const ip = w.prend(M.inconnu, { nom: 'camera' });
    await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.inconnu, etat: 'bloque' });
    w.avance(H); assert.equal(genre(w.dit(paquet(M.inconnu, MSG.REQUEST, { tient: ip }))), MSG.NAK);
    assert.deepEqual(coupuresBlocage(w.ctx).map((c) => c.ids), [[ip]], 'il peut ne pas avoir lâché l\'adresse : Internet reste coupé pour elle jusqu\'à la fin du bail d\'origine');
    w.avance(12 * H);
    assert.deepEqual(coupuresBlocage(w.ctx), [], 'bail d\'origine fini : plus de coupure, l\'adresse peut servir à un autre');
    // Un bail abîmé (ou un réglage changé après coup) qui met un appareil bloqué sur l'adresse d'Odin, de la box ou du DNS : jamais coupé.
    w.ctx.saveSettings({ macPolicy: { mode: 'ouvert', etats: { '00:00:5e:00:53:b1': 'bloque', '00:00:5e:00:53:b2': 'bloque', '00:00:5e:00:53:b3': 'bloque' }, attente: [] }, dhcp: { ...(w.ctx.settings.dhcp as object), dns: [ODIN, '192.0.2.53'] },
      leases: [{ mac: '00:00:5e:00:53:b1', ip: ODIN, expires: w.now() + H }, { mac: '00:00:5e:00:53:b2', ip: BOX, expires: w.now() + H }, { mac: '00:00:5e:00:53:b3', ip: '192.0.2.53', expires: w.now() + H }] });
    assert.deepEqual(coupuresBlocage(w.ctx), [], 'ni Odin, ni la box, ni le DNS de la maison');
  } finally { w.fin(); }
});

test('R2 · relecture : garde-fou — le DNS de la maison, la box connue par le registre, un bail fini à l\'adresse de la box ; l\'avertissement est dans la confirmation', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, { nom: 'PC-BUREAU' });
    // Le serveur DNS donné aux appareils est une autre machine de la maison : la bloquer couperait les noms à tous.
    const macDns = '00:00:5e:00:53:c1', macVieux = '00:00:5e:00:53:c2';
    w.ctx.saveSettings({ dhcp: { ...(w.ctx.settings.dhcp as object), dns: ['192.0.2.53'], fixed: [{ mac: M.box, ip: BOX, name: 'Box' }, { mac: macDns, ip: '192.0.2.53', name: 'Pi DNS' }] },
      leases: [...(w.ctx.settings.leases as Lease[]), { mac: macVieux, ip: BOX, expires: w.now() - H, name: 'vieille box' }] });
    for (const etat of ['bloque', 'pause']) {
      const r = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: macDns, etat });
      assert.equal(r.ok, false, r.text); assert.match(r.text, /serveur DNS de la maison/);
      const v = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: macVieux, etat });
      assert.equal(v.ok, false, v.text); assert.match(v.text, /est la box/);
      // Écrite autrement (majuscules, tirets, sans séparateur) : même refus.
      assert.match((await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.box.toUpperCase().replace(/:/g, '-'), etat })).text, /est la box/);
      assert.match((await w.v.act('vidarr', 'dhcp_mac_etat', { mac: ` ${M.odin.toUpperCase()} `, etat })).text, /Odin lui-même/);
      assert.match((await w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.odin.replace(/:/g, ''), etat })).text, /Odin lui-même/, 'sans séparateur : reconnue, et refusée');
      assert.match((await w.v.act('vidarr', 'dhcp_mac_etat', { mac: '0000.5e00.5301', etat })).text, /est la box/, 'écrite par groupes de quatre : reconnue, et refusée');
    }
    assert.equal((await w.vus()).D.appareils.find((d) => d.mac === macDns)!.garde, 'dns');
    assert.deepEqual(w.etats(), {}, 'rien n\'a été bloqué');
    // La box connue seulement par le registre d'Odin (Odin ne lui a jamais donné d'adresse) : refusée aussi.
    w.ctx.saveSettings({ dhcp: { ...(w.ctx.settings.dhcp as object), fixed: [] } });
    setRegistre((ip) => (ip === BOX ? { mac: 'B8:27:EB:00:53:01' } : undefined));
    try { const r = await w.v.act('vidarr', 'dhcp_mac_etat', { mac: 'b8:27:eb:00:53:01', etat: 'bloque' }); assert.equal(r.ok, false, r.text); assert.match(r.text, /est la box/); } finally { setRegistre(undefined); }
    // La confirmation elle-même prévient (elle est lue aussi hors de la page : parole, outil) : origine inconnue, ou appareil tenu.
    const a = w.v.module('vidarr')!.actions.find((x) => x.id === 'dhcp_mac_etat')!;
    assert.match(a.grave!({ mac: M.pc, etat: 'bloque' }, w.ctx)!, /Odin ne sait pas depuis quel appareil tu agis/);
    assert.match(origineDemande.run(ipPc, () => a.grave!({ mac: M.pc, etat: 'bloque', le_mien: true }, w.ctx))!, /c'est l'appareil que tu tiens en ce moment/);
    const ipT = w.prend(M.tel, { nom: 'Telephone 1' });
    assert.doesNotMatch(origineDemande.run(ipT, () => a.grave!({ mac: M.pc, etat: 'bloque' }, w.ctx))!, /Odin ne sait pas|que tu tiens/, 'origine reconnue, autre appareil : pas d\'avertissement en trop');
    // Une origine qu'Odin ne relie à aucun appareil (adresse inconnue) n'est PAS une origine connue : l'avertissement reste.
    const flou = await origineDemande.run('192.0.2.240', () => w.vus());
    assert.equal(flou.D.origineConnue, false);
    assert.match(origineDemande.run('192.0.2.240', () => a.grave!({ mac: M.pc, etat: 'bloque' }, w.ctx))!, /Odin ne sait pas depuis quel appareil tu agis/);
    assert.equal((await origineDemande.run('127.0.0.1', () => w.vus())).D.origineConnue, true, 'depuis Odin lui-même : connu');
    // « le_mien » ne vaut que dit pour de bon (vrai), jamais par une valeur floue.
    const pasDit = await origineDemande.run(ipPc, () => w.v.act('vidarr', 'dhcp_mac_etat', { mac: M.pc, etat: 'bloque', le_mien: 'non' }));
    assert.equal(pasDit.ok, false); assert.deepEqual(pasDit.data, { code: 'ici' });
    // L'appareil tenu est reconnu aussi par son adresse réservée (bail fini, ou adresse tapée à la main).
    w.ctx.saveSettings({ dhcp: { ...(w.ctx.settings.dhcp as object), fixed: [{ mac: macDns, ip: '192.0.2.53', name: 'Pi DNS' }] } });
    const res = await origineDemande.run('192.0.2.53', () => w.vus());
    assert.equal(res.D.appareils.find((d) => d.mac === macDns)!.ici, true);
  } finally { w.fin(); }
});

test('R2 · relecture : un appareil (bloqué ou non) qui redemande sans cesse n\'use pas le disque', () => {
  const pol: MacPolicy = { mode: 'ouvert', etats: {}, attente: [] };
  let leases: Lease[] = [], ecritures = 0, evenements = 0, now = T0; const cfg = { ...CFG(), macPolicy: pol };
  const srv = new DhcpServer({ config: () => cfg, leases: () => leases, save: (l) => { leases = l; ecritures++; }, now: () => now, onEvent: () => { evenements++; } });
  (srv as unknown as { sock: unknown }).sock = { send: () => {}, close: () => {} };
  srv.onMessage(paquet(M.inconnu, MSG.DISCOVER)); srv.onMessage(paquet(M.inconnu, MSG.REQUEST, { veut: '192.0.2.100' }));
  srv.onMessage(paquet(M.pc, MSG.DISCOVER)); srv.onMessage(paquet(M.pc, MSG.REQUEST, { veut: '192.0.2.101' }));
  pol.etats[M.inconnu] = 'bloque'; ecritures = 0; evenements = 0;
  // 3 heures de demandes, une toutes les 20 secondes, par un appareil bloqué et par un appareil bavard.
  for (let i = 0; i < 540; i++) { now += 20_000; srv.onMessage(paquet(M.inconnu, MSG.DISCOVER)); srv.onMessage(paquet(M.pc, MSG.INFORM, { tient: '192.0.2.101' })); }
  assert.equal(ecritures, 0, 'aucune écriture des baux pour un simple signe de vie');
  assert.ok(evenements <= 20, `l'historique n'est pas rempli à chaque paquet (${evenements})`);
  assert.equal(srv.dernierSigne(M.pc), now, 'le signe de vie est gardé en mémoire');
  // Une pluie d'adresses MAC inventées ne fait pas grossir la mémoire sans fin.
  for (let i = 0; i < 6000; i++) srv.onMessage(paquet(`06:00:5e:${(i >> 16 & 255).toString(16).padStart(2, '0')}:${(i >> 8 & 255).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`, MSG.INFORM));
  assert.ok(srv.signes.size <= 4096);
});

test('R2 · relecture : « connecté » par le signe en mémoire ; un paquet à l\'adresse matérielle bizarre est ignoré ; les noms gardent leurs lettres', async () => {
  const w = await monde();
  try {
    const ip = w.prend(M.pc, { nom: 'PC-BUREAU' });
    w.avance(30 * MIN); w.dit(paquet(M.pc, MSG.INFORM, { tient: ip }));
    assert.equal((await w.vus()).D.appareils.find((d) => d.mac === M.pc)!.connecte, true, 'vu il y a un instant');
    // Une adresse matérielle qui n'est pas une adresse MAC (longueur 16) : ni bail, ni appareil invisible.
    const b = paquet('00:00:5e:00:53:d1', MSG.DISCOVER); b[2] = 16; b.fill(0xab, 34, 44);
    assert.equal(w.dit(b), undefined, 'ignoré');
    assert.equal((w.ctx.settings.leases as Lease[]).every((l) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(l.mac)), true);
  } finally { w.fin(); }
  // Les marques des écritures (hindi, thaï, accents décomposés) restent ; jamais un demi-caractère en fin de nom.
  assert.equal(nomAnnonce(Buffer.from('फ़ोन की', 'utf8')), 'फ़ोन की'.normalize('NFC'));
  assert.equal(nomAnnonce(Buffer.from('Télé', 'utf8')), 'Télé');
  const long = nomAnnonce(Buffer.from(`${'a'.repeat(62)}😀😀`, 'utf8'))!;
  assert.doesNotMatch(long, /[\ud800-\udfff]/, 'pas de demi-caractère');
  assert.doesNotMatch(nomAnnonce(Buffer.from(`a${'́'.repeat(40)}b`, 'utf8'))!, /[̀-ͯ]{3}/, 'pas d\'empilement de marques');
});

test('R2 · relecture : un membre ne voit ni les noms ni les adresses des autres, même quand le DNS a un journal ; la liste d\'attente est bornée', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, { nom: 'PC-BUREAU' }), ipTel = w.prend(M.tel, { nom: 'Telephone 1' });
    const jour = join(w.ctx.dir, 'journal'); mkdirSync(jour, { recursive: true });
    const ligne = (client: string, clientName: string, name: string) => JSON.stringify({ t: w.now() - MIN, client, clientName, name, type: 'A', status: 'ok', ms: 3, rcode: 'NOERROR' });
    writeFileSync(join(jour, `${localDay(w.now())}.jsonl`), `${ligne(ipPc, 'PC-BUREAU', 'secret.example.org')}\n${ligne(ipTel, 'Telephone 1', 'exemple.example.org')}\n`);
    w.ctx.saveSettings({ dns: { clients: [{ id: 'c1', name: 'PC du bureau de Papa', ids: [ipPc], cut: true }] } });
    const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
    const page = await origineDemande.run(ipTel, () => auNomDe(nour, async () => JSON.stringify(await w.v.module('vidarr')!.view(w.ctx, new URLSearchParams()))));
    assert.doesNotMatch(page, /PC-BUREAU|PC du bureau de Papa|secret\.example\.org|00:00:5e:00:53:23/, 'rien des autres');
    assert.equal(page.includes(ipPc), false, 'pas l\'adresse du PC');
    const proprio = JSON.stringify(await w.v.module('vidarr')!.view(w.ctx, new URLSearchParams()));
    assert.match(proprio, /PC-BUREAU/, 'le propriétaire, lui, voit tout');
    // Un bail enregistré avant le nettoyage des noms (ou abîmé) : aucune lecture ne le montre tel quel.
    w.ctx.saveSettings({ leases: [...(w.ctx.settings.leases as Lease[]), { mac: '00:00:5e:00:53:d9', ip: '192.0.2.190', expires: w.now() + H, name: '<img src=x onerror=alert(1)>\u202eVieux\u0007' }] });
    const vieux = [await w.v.act('vidarr', 'baux', {}), await w.v.act('vidarr', 'recap_machine', { mac: '00:00:5e:00:53:d9' })];
    for (const r of vieux) assert.doesNotMatch(JSON.stringify(r), /[<>]|\\u202e|\\u0007/, 'nom ancien : nettoyé à la lecture (ni balise, ni caractère caché)');
    assert.doesNotMatch(JSON.stringify(await w.v.module('vidarr')!.view(w.ctx, new URLSearchParams())), /<img|\\u202e/, 'la page générique non plus');
    // Une fiche demandée par un membre : la même réponse, que l'appareil existe ou non.
    const f1 = await origineDemande.run(ipTel, () => auNomDe(nour, () => w.v.act('vidarr', 'recap_machine', { mac: M.pc })));
    const f2 = await origineDemande.run(ipTel, () => auNomDe(nour, () => w.v.act('vidarr', 'recap_machine', { mac: '00:00:5e:00:53:ee' })));
    assert.equal(f1.text, f2.text, 'un membre ne peut pas sonder quelles adresses MAC existent');
    // Mode « liste » : une pluie d'adresses MAC inventées ne remplit ni les réglages ni les alertes.
    w.ctx.saveSettings({ macPolicy: { mode: 'liste', etats: {}, attente: [] } });
    for (let i = 0; i < 400; i++) w.dit(paquet(`06:00:5e:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`, MSG.DISCOVER));
    assert.ok((w.ctx.settings.macPolicy as MacPolicy).attente.length <= 100, `liste d'attente bornée (${(w.ctx.settings.macPolicy as MacPolicy).attente.length})`);
  } finally { w.fin(); }
});
