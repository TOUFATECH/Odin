// Sphinx · Réglages DHCP (maquette « Réseau » validée, lot R4). Ce qui est essayé ici :
//  - les règles PURES (vidarr/reglages.ts) : la plage, la passerelle, le masque, le DNS donné, le bail ; ce qu'un
//    changement fait aux appareils déjà là (changer la plage ne coupe personne) ; le filet si Odin s'éteint ; qui est
//    approuvé d'avance en passant en « seulement les appareils approuvés » ;
//  - LE GARDE-FOU, dans le vrai Sphinx : refus d'allumer tant qu'un autre serveur d'adresses répond sur la carte d'Odin,
//    revérifié chaque minute, coupure dès qu'un autre apparaît (ou que la vérification ne peut plus se faire), et JAMAIS
//    de reprise toute seule : ni à la minute suivante, ni par une simple recherche, ni au redémarrage d'Odin ;
//  - un seul serveur d'adresses d'Odin par carte : pas à côté du réseau à part de Genèse ;
//  - les actions qui existaient déjà (`dhcp_reglages`, `dhcp_demarrer`, `dhcp_arreter`, `dhcp_mode`, au propriétaire
//    seul) et la lecture `dhcp_etat`, qui n'écrit rien et n'envoie rien.
// AUCUN vrai paquet, AUCUN port 67/68 : la prise du serveur d'adresses est simulée, les cartes réseau et la recherche
// d'un autre serveur aussi (RESEAU de Genèse, remplacé). Adresses d'exemple (10.0.0.x, comme la maquette), MAC de la
// plage de documentation.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DhcpServer, MSG, buildPacket, parsePacket, type DhcpConfig, type Lease, type MacPolicy, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { dureeEnMots, filetOdin, preApprobation, raisonAutre, verifierReglages } from '../src/valhalla/vidarr/reglages.ts';
import { LOCAL, origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import * as R from '../src/valhalla/thjalfi/reseau.ts';
import { PRISE_DHCP, dhcpServer, distributionMaison, gardeDhcp, veillerDhcp, vidarr } from '../src/valhalla/modules/vidarr.ts';
import { thjalfi } from '../src/valhalla/modules/thjalfi.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import type { Module } from '../src/valhalla/types.ts';
import { REFUS, SPHINX } from './reseau-r1-commun.ts';

const ip4 = (s: string) => Buffer.from(s.split('.').map(Number));
const BOX = '10.0.0.1', ODIN = '10.0.0.2';
const M = { box: '00:00:5e:00:53:01', odin: '00:00:5e:00:53:02', pc: '00:00:5e:00:53:23', imp: '00:00:5e:00:53:30', tel: '02:00:5e:00:53:14', cam: '00:00:5e:00:53:31', tv: '00:00:5e:00:53:4a' };
const T0 = Date.UTC(2026, 10, 24, 9, 0, 0), H = 3600_000, MIN = 60_000;
const CFG = (plus: Partial<DhcpConfig> = {}): DhcpConfig => ({ server: ODIN, start: '10.0.0.100', end: '10.0.0.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [], ...plus });
const ENTREE = (plus: Record<string, unknown> = {}) => ({ debut: '10.0.0.100', fin: '10.0.0.199', passerelle: BOX, masque: '255.255.255.0', dns: '', heures: 12, domaine: 'maison', ...plus });
const bail = (mac: string, ip: string, plus: Partial<Lease> = {}): Lease => ({ mac, ip, expires: T0 + 6 * H, first: T0 - H, ...plus });
const heure = (t: number) => `${String(new Date(t).getUTCHours()).padStart(2, '0')}:${String(new Date(t).getUTCMinutes()).padStart(2, '0')}`;
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string; tient?: string; serveur?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, ...(o.tient ? { ciaddr: o.tient } : {}), options: [[53, Buffer.from([type])], ...(o.nom ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, ip4(o.veut)] as [number, Buffer]] : []), ...(o.serveur ? [[54, ip4(o.serveur)] as [number, Buffer]] : [])] });
const genre = (p?: Packet) => p?.options.get(53)?.[0];

// ------------------------------------------------------------------ les règles pures
test('R4 · réglages : une plage, une passerelle, un masque, un DNS et un bail bien écrits sont acceptés ; vide = Odin en DNS', () => {
  const v = verifierReglages({ entree: ENTREE({ debut: '10.0.0.50', fin: '10.0.0.90', heures: 24 }), courant: CFG(), odin: ODIN, leases: [], now: T0, allume: false, heure });
  assert.equal(v.ok, true, v.message); assert.equal(v.message, 'Réglages valables.'); assert.equal(v.grave, '');
  assert.deepEqual(v.config, { start: '10.0.0.50', end: '10.0.0.90', router: BOX, mask: '255.255.255.0', dns: [ODIN], leaseSeconds: 86_400, domain: 'maison' });
  // Les réglages d'aujourd'hui, redits : rien ne change.
  const pareil = verifierReglages({ entree: ENTREE(), courant: CFG(), odin: ODIN, leases: [], now: T0, allume: true, heure });
  assert.equal(pareil.pareil, true); assert.equal(pareil.message, 'Ce sont déjà les réglages d\'aujourd\'hui.'); assert.deepEqual(pareil.avis, []);
  // « DNS de secours : la box » : la box derrière Odin, et c'est dit franchement.
  const sec = verifierReglages({ entree: ENTREE({ secours: true }), courant: CFG(), odin: ODIN, leases: [], now: T0, allume: false, heure });
  assert.deepEqual(sec.config?.dns, [ODIN, BOX]); assert.match(sec.avis.join('\n'), /DNS de secours \(10\.0\.0\.1\) : si Odin ne répond plus, les appareils demandent là\./);
  // Un autre DNS que Odin : accepté, et ce que la maison perd est dit.
  const autre = verifierReglages({ entree: ENTREE({ dns: '203.0.113.53' }), courant: CFG(), odin: ODIN, leases: [], now: T0, allume: false, heure });
  assert.deepEqual(autre.config?.dns, ['203.0.113.53']); assert.match(autre.avis.join('\n'), /Odin n'est plus le DNS donné aux appareils : les pubs ne sont plus bloquées/);
  assert.equal(dureeEnMots(1800), '30 min'); assert.equal(dureeEnMots(7200), '2 h'); assert.equal(dureeEnMots(86_400), '1 jour'); assert.equal(dureeEnMots(3 * 86_400), '3 jours'); assert.equal(dureeEnMots(36 * 3600), '1 jour et 12 h');
});

test('R4 · réglages : tout ce qui casserait le réseau est refusé, avec le champ en cause et des mots simples', () => {
  const non = (plus: Record<string, unknown>, o: { allume?: boolean; odin?: string } = {}) => { const v = verifierReglages({ entree: ENTREE(plus), courant: CFG(), odin: o.odin ?? ODIN, leases: [], now: T0, allume: Boolean(o.allume), heure }); assert.equal(v.ok, false, JSON.stringify(plus)); assert.equal(v.config, undefined); return `${v.champ} · ${v.message}`; };
  assert.match(non({ debut: 'x' }), /^debut · La première adresse est mal écrite/);
  assert.match(non({ debut: '10.0.0.999' }), /^debut · /); assert.match(non({ fin: '010.0.0.5' }), /^fin · /, 'pas de zéro devant');
  assert.match(non({ passerelle: 'fe80::1' }), /^passerelle · La passerelle est une adresse IPv6/);
  assert.match(non({ debut: '' }), /^debut · La première adresse manque/);
  assert.match(non({ masque: '255.0.255.0' }), /^masque · Le masque 255\.0\.255\.0 ne décrit pas un réseau/);
  assert.match(non({ masque: '255.255.255.255' }), /^masque · /);
  assert.match(non({ debut: '10.0.0.150', fin: '10.0.0.120' }), /^fin · La première adresse doit précéder la dernière/);
  assert.match(non({ debut: '192.168.1.100', fin: '192.168.1.199' }), /^debut · La première adresse \(192\.168\.1\.100\) n'est pas dans le réseau de la maison \(10\.0\.0\.1 à 10\.0\.0\.254\)/);
  assert.match(non({ fin: '10.0.0.255' }), /^fin · La dernière adresse \(10\.0\.0\.255\) n'est pas dans le réseau/, 'la diffusion');
  assert.match(non({ debut: '10.0.0.0' }), /^debut · /, 'l\'adresse du réseau lui-même');
  assert.match(non({ passerelle: '10.0.0.0' }), /^passerelle · /);
  assert.match(non({ masque: '255.255.0.0', debut: '10.0.0.1', fin: '10.0.9.250' }), /^fin · 1000 adresses distribuées au plus/);
  assert.match(non({ dns: 'odin.maison' }), /^dns · DNS mal écrit/); assert.match(non({ dns: '127.0.0.1' }), /^dns · 127\.0\.0\.1 ne peut pas servir de DNS/);
  assert.match(non({ dns: '0.0.0.0' }), /^dns · /); assert.match(non({ dns: '10.0.0.255' }), /^dns · /);
  assert.match(non({ dns: '10.0.0.2, 10.0.0.3, 10.0.0.4, 10.0.0.5' }), /^dns · Trois DNS au plus/);
  assert.match(non({ dns: '<img src=x onerror=alert(1)>' }), /^dns · DNS mal écrit : « img »\. /, 'ce qui est tapé ne revient jamais tel quel');
  assert.match(non({ heures: 0.05 }), /^heures · Un bail dure de 6 minutes à 30 jours/); assert.match(non({ heures: 24 * 31 }), /^heures · /); assert.match(non({ heures: 'beaucoup' }), /^heures · La durée du bail est un nombre d'heures/);
  assert.match(non({ domaine: 'ma maison !' }), /^domaine · Nom de la maison invalide/);
  // Odin lui-même hors du réseau réglé : refusé quand il distribue ; prévenu sinon (il refusera de distribuer).
  assert.match(non({ debut: '192.168.1.100', fin: '192.168.1.199', passerelle: '192.168.1.1' }, { allume: true }), /^passerelle · Refusé : Odin distribue les adresses en ce moment, et son adresse \(10\.0\.0\.2\) n'est pas dans ce réseau/);
  const eteint = verifierReglages({ entree: ENTREE({ debut: '192.168.1.100', fin: '192.168.1.199', passerelle: '192.168.1.1' }), courant: CFG(), odin: ODIN, leases: [], now: T0, allume: false, heure });
  assert.equal(eteint.ok, true); assert.match(eteint.avis[0], /L'adresse d'Odin \(10\.0\.0\.2\) n'est pas dans ce réseau .* Odin refusera de distribuer les adresses/);
});

test('R4 · réglages : changer la plage ne coupe personne, et c\'est dit ; changer la passerelle ou le DNS pendant qu\'Odin distribue demande l\'accord', () => {
  const leases = [bail(M.pc, '10.0.0.150'), bail(M.tel, '10.0.0.151', { expires: T0 + 9 * H }), bail(M.imp, '10.0.0.30', { fixed: true }), bail(M.cam, '10.0.0.160', { expires: T0 - H })];
  const courant = CFG({ fixed: [{ mac: M.imp, ip: '10.0.0.30' }] });
  const v = verifierReglages({ entree: ENTREE({ debut: '10.0.0.10', fin: '10.0.0.29' }), courant, odin: ODIN, leases, now: T0, allume: true, heure });
  assert.equal(v.ok, true); assert.equal(v.grave, '', 'changer la plage seule ne demande pas d\'accord');
  assert.equal(v.avis[0], 'Personne n\'est coupé : 2 appareils tiennent une adresse hors de cette plage. Ils la gardent jusqu\'à la fin de leur bail (au plus tard 18:00), puis reçoivent une adresse de la plage.');
  // Une plage qui contient Odin ou la box : acceptée, ces adresses ne sont jamais données.
  const large = verifierReglages({ entree: ENTREE({ debut: '10.0.0.1', fin: '10.0.0.254' }), courant, odin: ODIN, leases, now: T0, allume: true, heure });
  assert.deepEqual(large.avis.slice(0, 3), ['La plage contient l\'adresse d\'Odin (10.0.0.2) : elle n\'est jamais donnée à un appareil.', 'La plage contient l\'adresse de la box (10.0.0.1) : elle n\'est jamais donnée à un appareil.', 'Personne n\'est coupé : tous les appareils connectés tiennent déjà une adresse de cette plage, ou une adresse fixe.']);
  // Trop petite pour ceux qui sont là.
  const petite = verifierReglages({ entree: ENTREE({ debut: '10.0.0.150', fin: '10.0.0.150' }), courant, odin: ODIN, leases, now: T0, allume: true, heure });
  assert.match(petite.avis.join('\n'), /La plage compte 1 adresse à donner pour 2 appareils connectés : les derniers arrivés n'en recevront pas\./);
  // La passerelle ou le DNS changent pendant qu'Odin distribue : accord demandé, et ce qui arrive est dit.
  const p = verifierReglages({ entree: ENTREE({ passerelle: '10.0.0.254', dns: '10.0.0.53' }), courant, odin: ODIN, leases, now: T0, allume: true, heure });
  assert.equal(p.grave, 'changer la passerelle (10.0.0.254), le DNS donné (10.0.0.53) pendant qu\'Odin distribue les adresses : tous les appareils de la maison les recevront à leur prochain renouvellement, et une erreur leur coupe Internet');
  assert.match(p.avis.join('\n'), /Les appareils reçoivent la nouvelle passerelle à leur prochain renouvellement \(au plus tard 18:00\)\. Si 10\.0\.0\.254 n'est pas l'adresse de la box, ils perdent Internet\./);
  assert.equal(verifierReglages({ entree: ENTREE({ passerelle: '10.0.0.254' }), courant, odin: ODIN, leases, now: T0, allume: false, heure }).grave, '', 'la box distribue : rien de grave');
  // Le réseau change : dit, avec les adresses fixes qui tombent dehors.
  const r = verifierReglages({ entree: ENTREE({ masque: '255.255.255.128', debut: '10.0.0.100', fin: '10.0.0.120' }), courant, odin: ODIN, leases, now: T0, allume: true, heure });
  assert.match(r.avis.join('\n'), /2 appareils tiennent une adresse hors de ce réseau : à leur prochain renouvellement, Odin la leur refuse et leur en donne une nouvelle \(une courte coupure pour eux\)\./);
  assert.match(r.grave, /^changer le réseau \(masque 255\.255\.255\.128\) pendant qu'Odin distribue/);
  // Bail court, bail long : le filet est dit.
  assert.match(verifierReglages({ entree: ENTREE({ heures: 0.5 }), courant, odin: ODIN, leases, now: T0, allume: true, heure }).avis.join('\n'), /Bail court \(30 min\) : si Odin s'arrête, les appareils perdent leur adresse en 30 min au plus\./);
  assert.match(verifierReglages({ entree: ENTREE({ heures: 240 }), courant, odin: ODIN, leases, now: T0, allume: true, heure }).avis.join('\n'), /Bail long \(10 jours\)/);
});

test('R4 · le filet : ce qui se passe pour la maison si Odin distribue et s\'arrête, dit franchement', () => {
  const leases = [bail(M.pc, '10.0.0.150', { expires: T0 + 2 * H }), bail(M.tel, '10.0.0.151', { expires: T0 + 9 * H }), bail(M.cam, '10.0.0.160', { expires: T0 - H })];
  const f = filetOdin({ config: CFG(), leases, now: T0, allume: true, odin: ODIN, heure, nom: (mac) => (mac === M.pc ? 'PC du bureau' : mac) });
  assert.deepEqual(f.lignes, [
    'Les appareils déjà là gardent leur adresse jusqu\'à la fin de leur bail : 12 h au plus après leur dernier renouvellement. À mi-bail ils redemandent ; sans réponse d\'Odin, ils vont jusqu\'au bout, puis perdent le réseau.',
    'Si Odin s\'arrêtait maintenant : le premier des 2 appareils (PC du bureau) perdrait son adresse à 11:00, le dernier à 18:00.',
    'Un appareil qui arrive, ou qui se rallume, pendant qu\'Odin est arrêté ne reçoit aucune adresse : il n\'a pas de réseau.',
    'Le DNS donné aux appareils est Odin seul : sans Odin, plus aucun nom ne se trouve. Internet semble coupé tout de suite, même pour ceux qui ont encore leur adresse.',
    'Odin éteint ne peut prévenir personne. Quand il arrête lui-même de distribuer (garde-fou, ou « La box »), il te le dit et te rappelle de rallumer le serveur d\'adresses de la box.',
  ]);
  assert.deepEqual(f.conseils, ['Si Odin doit rester éteint : rallume le serveur d\'adresses (DHCP) de la box, avec la même plage (10.0.0.100 à 10.0.0.199), pour que personne ne change d\'adresse.', '« DNS de secours : la box » garde Internet aux appareils quand Odin ne répond plus.']);
  // Avec la box en secours, et un bail court : le conseil change.
  const g = filetOdin({ config: CFG({ dns: [ODIN, BOX], leaseSeconds: 7200 }), leases: [], now: T0, allume: true, odin: ODIN, heure });
  assert.match(g.lignes.join('\n'), /DNS de secours \(10\.0\.0\.1\) : sans Odin, Internet continue, mais sans le blocage des pubs ni les noms de la maison\./);
  assert.equal(g.conseils[0], 'Un bail d\'un jour laisse plus de temps pour réagir qu\'un bail de 2 h.'); assert.equal(g.conseils.length, 2);
  // La box distribue : rien ne change pour les adresses.
  assert.match(filetOdin({ config: CFG(), leases, now: T0, allume: false, odin: ODIN, heure }).lignes[0], /^La box distribue les adresses : si Odin s'éteint, les appareils de la maison gardent leur adresse/);
  assert.equal(raisonAutre([BOX], BOX), 'Refusé : ça casserait le réseau de la maison. La box (10.0.0.1) distribue encore les adresses. Deux serveurs à la fois : les téléphones, la télé et les PC n\'auraient plus Internet.');
  assert.match(raisonAutre(['10.0.0.77'], BOX), /Un autre serveur d'adresses \(10\.0\.0\.77\) répond sur la carte d'Odin\./);
  assert.match(raisonAutre([BOX, '10.0.0.77'], BOX), /D'autres serveurs d'adresses \(10\.0\.0\.1, 10\.0\.0\.77\) répondent/);
});

test('R4 · « seulement les appareils approuvés » : ceux qui ont un bail en cours sont approuvés d\'abord ; bloqué ou en pause, on le reste', () => {
  const leases = [bail(M.pc, '10.0.0.150'), bail(M.tel, '10.0.0.151'), bail(M.cam, '10.0.0.152'), bail(M.tv, '10.0.0.153'), bail(M.imp, '10.0.0.30', { fixed: true }), bail('00:00:5e:00:53:99', '10.0.0.154', { expires: T0 - 1 })];
  const policy: MacPolicy = { mode: 'ouvert', etats: { [M.cam]: 'bloque', [M.tv]: 'pause', [M.tel]: 'actif' }, attente: [] };
  const p = preApprobation({ config: CFG({ fixed: [{ mac: M.imp, ip: '10.0.0.30' }] }), leases, policy, now: T0, nom: (mac) => (mac === M.pc ? 'PC du bureau' : mac === M.cam ? 'Caméra' : mac) });
  assert.deepEqual(p.aApprouver, [{ mac: M.pc, ip: '10.0.0.150', nom: 'PC du bureau' }], 'ni le bail fini, ni l\'adresse fixe (son accord tient à la réservation), ni celui déjà approuvé');
  assert.deepEqual(p.restent, [{ mac: M.cam, nom: 'Caméra', etat: 'bloque' }, { mac: M.tv, nom: M.tv, etat: 'pause' }]);
  assert.equal(p.deja, 2);
});

// ------------------------------------------------------------------ le serveur d'adresses : deux signes
test('R4 · le serveur d\'adresses : un appareil qui choisit un AUTRE serveur le signale ; la question qu\'Odin se pose à lui-même n\'a pas de réponse', () => {
  const envois: Packet[] = [], autres: string[] = [], attente: string[] = []; let leases: Lease[] = [];
  const cfg = CFG({ macPolicy: { mode: 'liste', etats: {}, attente: [] } });
  const d = new DhcpServer({ config: () => cfg, leases: () => leases, save: (l) => { leases = l; }, now: () => T0, propres: () => [ODIN, '10.9.9.9'], onAutre: (srv, mac) => autres.push(`${mac} → ${srv}`), onPending: (mac) => attente.push(mac) });
  (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} };
  const de = (address: string) => ({ address, family: 'IPv4', port: 68, size: 300 }) as never;
  // La question d'Odin (elle part de sa propre adresse) : ni réponse, ni « en attente », ni signe de vie.
  d.onMessage(paquet('02:00:5e:00:53:aa', MSG.DISCOVER), de(ODIN)); d.onMessage(paquet('02:00:5e:00:53:ab', MSG.DISCOVER), de('10.9.9.9'));
  assert.deepEqual([envois.length, attente, d.signes.size], [0, [], 0]);
  // Un vrai appareil inconnu (il demande depuis 0.0.0.0) : noté en attente, comme avant.
  d.onMessage(paquet(M.tel, MSG.DISCOVER), de('0.0.0.0')); assert.deepEqual(attente, [M.tel]);
  // Il choisit un autre serveur : signalé, et rien ne lui est répondu.
  cfg.macPolicy = { mode: 'ouvert', etats: {}, attente: [] };
  d.onMessage(paquet(M.pc, MSG.REQUEST, { veut: '10.0.0.150', serveur: BOX }));
  assert.deepEqual(autres, [`${M.pc} → ${BOX}`]); assert.equal(envois.length, 0);
  // Il choisit Odin : rien n'est signalé.
  d.onMessage(paquet(M.pc, MSG.DISCOVER)); d.onMessage(paquet(M.pc, MSG.REQUEST, { veut: envois[0].yiaddr, serveur: ODIN }));
  assert.equal(autres.length, 1); assert.equal(genre(envois[1]), MSG.ACK);
});

// ------------------------------------------------------------------ dans Sphinx (vrai module ; prise, cartes et recherche simulées)
const dossiers: string[] = [];
const PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs, ORIGINE = { ...R.RESEAU };
after(() => { PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; Object.assign(R.RESEAU, ORIGINE); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const CARTE: R.CarteReseau = { nom: 'Ethernet', ip: ODIN, masque: '255.255.255.0', prefixe: 24, mac: M.odin, genre: 'cable' };
type Etat = { proprietaire: boolean; limite: string; mode: string; distribue: boolean; garde: R.Garde; ancienne: boolean; doute: number; carte: { nom: string; ip: string } | null; carteRefus: string; reglages: Record<string, unknown>; heuresProposees: Array<{ heures: number; mots: string }>;
  verdict: { ok: boolean; champ: string; message: string; avis: string[]; grave: string } | null; filet: { lignes: string[]; conseils: string[] }; allumer: string[]; genese: { distribue: boolean; memeCarte: boolean; crochet: boolean; texte: string };
  liste: { mode: string; attente: number; approuves: number; aApprouver: Array<{ mac: string; nom: string; ip: string; nouveau: boolean }>; aVoir: Array<{ mac: string; nom: string; ip: string; fin: string }>; origineConnue: boolean; restent: Array<{ mac: string; etat: string }>; deja: number } };

/** Une fausse appli Genèse : seulement ce que Sphinx y lit (son serveur d'adresses du réseau à part, s'il distribue). */
function fausseGenese(aPart: () => { ip: string } | undefined): Module {
  const m = { id: 'thjalfi', name: 'Genèse', family: 'Machines', what: 'essai', does: [], from: [], upstream: [], words: [], actions: [], view: () => ({ sections: [] }) } as unknown as Module;
  Object.defineProperty(m, 'reseauAPart', { value: () => { const a = aPart(); return a ? { arrete: false, sock: { address: () => ({ address: a.ip }) } } : undefined; }, enumerable: false });
  return m;
}

/** Un Odin d'essai avec Sphinx seul : aucune commande, aucune sortie ; la prise, les cartes et la recherche sont simulées. */
async function monde(o: { cfg?: Partial<DhcpConfig>; home?: string; genese?: () => { ip: string } | undefined } = {}) {
  const home = o.home ?? mkdtempSync(join(tmpdir(), 'sphinx-r4-')); if (!o.home) dossiers.push(home);
  const envois: Packet[] = [], ecoutes: Array<{ ports: number[]; hote?: string }> = [], recherches: Array<{ carte: string; serveur: number; client: number }> = [];
  const S = { now: T0, cartes: [CARTE] as R.CarteReseau[], autres: [] as string[], erreur: '', plateforme: 'win32' };
  PRISE_DHCP.ecouter = async (d, ports, hote) => { ecoutes.push({ ports, hote }); (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
  R.RESEAU.cartes = () => S.cartes; R.RESEAU.plateforme = () => S.plateforme;
  R.RESEAU.chercher = async (c, p) => { recherches.push({ carte: c.nom, ...p }); return { serveurs: [...S.autres], ...(S.erreur ? { erreur: S.erreur } : {}) }; };
  R.RESEAU.ecouter = async () => { throw new Error('essai : Genèse n\'écoute rien ici'); };
  LOCAL.macs = () => [M.odin]; setVerificateur(() => undefined);
  const mods = [vidarr(), ...(o.genese ? [fausseGenese(o.genese)] : [])];
  const v = new Valhalla(home, mods, { run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }), fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(S.now) });
  const ctx = v.ctx('vidarr');
  if (!o.home) ctx.saveSettings({ dhcp: CFG(o.cfg) });
  const act = (a: string, i: Record<string, unknown> = {}, opts?: Parameters<Valhalla['act']>[3]) => v.act('vidarr', a, i, opts);
  const dit = (b: Buffer) => { const n = envois.length; dhcpServer()!.onMessage(b); return envois[n] as Packet | undefined; };
  const prend = (mac: string, nom?: string) => { const offre = dit(paquet(mac, MSG.DISCOVER, { nom })); assert.equal(genre(offre), MSG.OFFER, `${mac} : une offre`); assert.equal(genre(dit(paquet(mac, MSG.REQUEST, { nom, veut: offre!.yiaddr }))), MSG.ACK); return offre!.yiaddr; };
  const etat = async (i: Record<string, unknown> = {}) => (await act('dhcp_etat', i)).data as Etat;
  const alertes = () => v.alerts({ module: 'vidarr' }).map((a) => `${a.level} · ${a.title}`);
  return { v, ctx, S, act, dit, prend, etat, alertes, envois, ecoutes, recherches, home, garde: () => gardeDhcp(ctx), allume: () => Boolean(dhcpServer()), minute: async (n = 1) => { for (let k = 0; k < n; k++) { S.now += MIN; await veillerDhcp(ctx); } },
    etats: () => (ctx.settings.macPolicy as MacPolicy | undefined)?.etats ?? {}, baux: () => (ctx.settings.leases as Lease[] | undefined) ?? [], reglages: () => ctx.settings.dhcp as DhcpConfig,
    fin: () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; Object.assign(R.RESEAU, ORIGINE); } };
}

test('R4 · garde-fou : REFUS d\'allumer tant qu\'un autre serveur d\'adresses répond sur la carte d\'Odin ; rien ne passe par-dessus', async () => {
  const w = await monde();
  try {
    // La box distribue encore : refusé, rien n'écoute, rien n'est noté « allumé ».
    w.S.autres = [BOX];
    let r = await w.act('dhcp_demarrer');
    assert.equal(r.ok, false);
    assert.equal(r.text, 'Refusé : ça casserait le réseau de la maison. La box (10.0.0.1) distribue encore les adresses. Deux serveurs à la fois : les téléphones, la télé et les PC n\'auraient plus Internet. Coupe d\'abord le serveur d\'adresses (DHCP) de la box : page de la box → réseau local → serveur DHCP : désactivé. Puis reviens : Odin revérifie, et s\'allume seulement si plus personne d\'autre ne distribue.');
    assert.deepEqual([w.allume(), w.ecoutes.length, w.ctx.settings.dhcpOn === true, w.garde().etat, w.garde().autres], [false, 0, false, 'occupe', [BOX]]);
    assert.deepEqual(w.recherches, [{ carte: 'Ethernet', serveur: 67, client: 68 }], 'la question est posée sur la carte d\'Odin');
    // Un autre serveur que la box : refusé pareil, et nommé.
    w.S.autres = ['10.0.0.77'];
    r = await w.act('dhcp_demarrer'); assert.equal(r.ok, false); assert.match(r.text, /Un autre serveur d'adresses \(10\.0\.0\.77\) répond sur la carte d'Odin/);
    // La vérification n'a pas pu se faire : ce n'est jamais « personne ».
    w.S.autres = []; w.S.erreur = 'la question n\'a pas pu partir (EACCES)';
    r = await w.act('dhcp_demarrer'); assert.equal(r.ok, false);
    assert.match(r.text, /Odin n'a pas pu vérifier qu'aucun autre serveur d'adresses ne répond sur Ethernet : .*EACCES.* Par prudence, il ne distribue rien\./);
    assert.deepEqual([w.allume(), w.garde().etat], [false, 'non_verifie']);
    // « Même si un autre DHCP répond » n'existe plus : dans la maison (la vraie prise, le port 67), forcer est refusé avant toute écoute.
    w.S.erreur = ''; w.S.autres = [BOX];
    const simulee = PRISE_DHCP.ecouter; PRISE_DHCP.ecouter = PRISE;
    try { r = await w.act('dhcp_demarrer', { forcer: true }); } finally { PRISE_DHCP.ecouter = simulee; }
    assert.equal(r.ok, false); assert.match(r.text, /^Refusé : Odin n'allume jamais son serveur d'adresses sans vérifier qu'aucun autre ne répond/);
    assert.deepEqual([w.allume(), w.ecoutes.length, w.ctx.settings.dhcpOn === true], [false, 0, false]);
    assert.deepEqual((w.v.module('vidarr')!.actions.find((a) => a.id === 'dhcp_demarrer')!.params ?? []).map((p) => p.key), [], 'plus de case « forcer » à cocher');
    // La carte d'Odin introuvable, un tunnel, une adresse publique : refusé avant toute question.
    const n = w.recherches.length;
    w.S.autres = []; w.S.cartes = [];
    r = await w.act('dhcp_demarrer'); assert.equal(r.ok, false); assert.match(r.text, /Odin ne trouve pas sa carte réseau : aucune carte de cette machine ne porte l'adresse 10\.0\.0\.2/);
    w.S.cartes = [{ ...CARTE, nom: 'wg0' }];
    r = await w.act('dhcp_demarrer'); assert.equal(r.ok, false); assert.match(r.text, /wg0 est un tunnel \(VPN\)/);
    w.S.cartes = [{ ...CARTE, ip: '198.51.100.7' }]; w.ctx.saveSettings({ dhcp: CFG({ server: '198.51.100.7', router: '198.51.100.1', start: '198.51.100.100', end: '198.51.100.199', dns: ['198.51.100.7'] }) });
    r = await w.act('dhcp_demarrer'); assert.equal(r.ok, false); assert.match(r.text, /n'est pas sur un réseau privé/);
    // Des réglages où Odin n'est pas dans le réseau : refusé.
    w.S.cartes = [CARTE]; w.ctx.saveSettings({ dhcp: CFG({ router: '192.168.1.1', start: '192.168.1.100', end: '192.168.1.199' }) });
    r = await w.act('dhcp_demarrer'); assert.equal(r.ok, false); assert.match(r.text, /L'adresse d'Odin \(10\.0\.0\.2\) n'est pas dans le réseau réglé \(192\.168\.1\.1 à 192\.168\.1\.254\)/);
    assert.equal(w.recherches.length, n, 'aucune question posée pour ces refus'); assert.equal(w.allume(), false); assert.equal(w.ecoutes.length, 0);
    // Plus personne d'autre : Odin s'allume, sur SA carte seulement, et le dit.
    w.ctx.saveSettings({ dhcp: CFG() });
    r = await w.act('dhcp_demarrer');
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /DHCP d'Odin en marche : adresses 10\.0\.0\.100 → 10\.0\.0\.199/); assert.match(r.text, /Aucun autre serveur d'adresses ne répond sur Ethernet\. Odin le revérifie chaque minute et s'arrête dès qu'il en apparaît un ; il ne recommence jamais tout seul\./);
    assert.deepEqual([w.allume(), w.ctx.settings.dhcpOn, w.garde().etat, w.garde().carte], [true, true, 'libre', 'Ethernet']);
    assert.deepEqual(w.ecoutes, [{ ports: [67, 68], hote: ODIN }], 'la prise est attachée à l\'adresse de la carte vérifiée');
    assert.deepEqual(distributionMaison(), { carte: 'Ethernet', ip: ODIN });
    assert.equal(w.prend(M.pc, 'PC-BUREAU'), '10.0.0.100');
    // Demander encore : une vérification tout de suite, rien n'est relancé.
    const avant = dhcpServer();
    r = await w.act('dhcp_demarrer'); assert.equal(r.ok, true); assert.match(r.text, /Odin distribue déjà les adresses\. Il vient de revérifier/); assert.equal(dhcpServer(), avant); assert.equal(w.ecoutes.length, 1);
  } finally { w.fin(); }
});

test('R4 · garde-fou : revérifié chaque minute ; un autre serveur apparaît → coupure tout de suite, alerte, et JAMAIS de reprise toute seule', async () => {
  const w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const ipPc = w.prend(M.pc, 'PC-BUREAU'); w.prend(M.tel, 'Telephone');
    const n = w.recherches.length;
    await w.minute(3);
    assert.equal(w.recherches.length, n + 3, 'une question par minute'); assert.equal(w.allume(), true); assert.equal(w.garde().verifie, w.S.now);
    assert.equal(w.v.module('vidarr')!.watch!.every, 60, 'la veille de Sphinx passe chaque minute');
    // La box se remet à distribuer : la minute suivante, Odin s'arrête.
    w.S.autres = [BOX];
    await w.minute();
    assert.equal(w.allume(), false); assert.equal(distributionMaison(), undefined);
    const g = w.garde();
    assert.deepEqual([g.etat, g.autres, g.carte], ['coupe', [BOX], 'Ethernet']);
    assert.equal(g.raison, 'Odin a arrêté de distribuer les adresses : un autre serveur d\'adresses répond sur Ethernet (10.0.0.1). Il ne recommence pas tout seul.');
    assert.equal(w.ctx.settings.dhcpOn, true, 'le choix « Odin distribue » reste noté : la page le montre coupé, pas « la box »');
    assert.deepEqual(w.alertes().filter((a) => /arrêté de distribuer/.test(a)), ['critique · Sphinx a arrêté de distribuer les adresses de la maison']);
    const detail = w.v.alerts({ module: 'vidarr' }).find((a) => /arrêté de distribuer/.test(a.title))!.detail ?? '';
    assert.match(detail, /Les 2 appareils connectés gardent leur adresse jusqu'à la fin de leur bail/); assert.match(detail, /rechoisis « Odin distribue les adresses » : Odin revérifie avant de rallumer/);
    assert.equal(w.baux().find((l) => l.mac === M.pc)?.ip, ipPc, 'les baux ne sont pas touchés : chacun va au bout du sien');
    // La box se tait de nouveau : Odin ne recommence pas tout seul. Ni à la minute, ni une heure après.
    w.S.autres = [];
    const avant = w.recherches.length;
    await w.minute(5); w.S.now += H; await w.minute(2);
    assert.equal(w.allume(), false); assert.equal(w.garde().etat, 'coupe'); assert.equal(w.recherches.length, avant, 'arrêté, il ne pose même plus la question');
    // Une simple recherche (une lecture, ouverte à une automatisation) ne rallume rien et n'efface pas la coupure.
    let r = await w.act('dhcp_chercher', {}, { auto: true, by: 'automatisation' });
    assert.equal(r.ok, true); assert.match(r.text, /Aucun autre serveur d'adresses ne répond sur Ethernet : celui d'Odin peut s'allumer/);
    assert.deepEqual([w.allume(), w.garde().etat], [false, 'coupe']);
    // Odin redémarre : il ne reprend pas, et le dit.
    w.v.stop();
    const w2 = await monde({ home: w.home });
    try {
      await w2.v.module('vidarr')!.start!(w2.ctx);
      assert.equal(w2.allume(), false); assert.equal(w2.ecoutes.length, 0); assert.equal(w2.recherches.length, 0);
      assert.deepEqual(w2.alertes().filter((a) => /ne distribue pas/.test(a)), ['haute · Odin ne distribue pas les adresses de la maison']);
      await w2.minute(3); assert.equal(w2.allume(), false);
      // Le propriétaire rallume, mais la box répond encore : refusé, et la coupure reste (pas de reprise au prochain démarrage).
      w2.S.autres = [BOX];
      r = await w2.act('dhcp_demarrer'); assert.equal(r.ok, false); assert.deepEqual([w2.allume(), w2.garde().etat, w2.garde().autres], [false, 'coupe', [BOX]]);
      // Une automatisation ne peut pas rallumer : c'est au propriétaire, avec son accord.
      w2.S.autres = [];
      r = await w2.act('dhcp_demarrer', {}, { auto: true, by: 'automatisation' }); assert.equal(r.ok, false); assert.match(r.text, REFUS); assert.equal(w2.allume(), false);
      // Lui seul rallume ; Odin revérifie d'abord.
      const k = w2.recherches.length;
      r = await w2.act('dhcp_demarrer'); assert.equal(r.ok, true, r.text);
      assert.deepEqual([w2.allume(), w2.garde().etat, w2.recherches.length], [true, 'libre', k + 1]);
    } finally { w2.fin(); }
  } finally { w.fin(); }
});

test('R4 · garde-fou : la veille de Sphinx elle-même coupe ; carte partie ou changée d\'adresse → coupure aussi ; vérification impossible → Odin se tait, et s\'arrête à la troisième de suite', async () => {
  // Par la veille (ce que le registre des automatismes appelle chaque minute).
  let w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    w.S.autres = ['10.0.0.77'];
    await w.v.module('vidarr')!.watch!.run(w.ctx);
    assert.deepEqual([w.allume(), w.garde().etat, w.garde().autres], [false, 'coupe', ['10.0.0.77']]);
  } finally { w.fin(); }
  // La vérification ne peut plus se faire : Odin ne distribue pas à l'aveugle. Il se TAIT (aucune réponse), réessaie chaque
  // minute, et s'arrête à la troisième vérification impossible de suite : une seule vérification manquée ne coupe pas la maison.
  w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const ipPc = w.prend(M.pc, 'PC-BUREAU');
    w.S.erreur = 'la recherche n\'a pas pu se faire (EADDRINUSE)';
    await w.minute();
    assert.deepEqual([w.allume(), w.garde().etat], [true, 'libre'], 'une vérification manquée ne coupe pas la maison');
    assert.equal(w.dit(paquet(M.tel, MSG.DISCOVER)), undefined, 'mais Odin ne répond plus : ni offre');
    assert.equal(w.dit(paquet(M.pc, MSG.REQUEST, { tient: ipPc })), undefined, 'ni accord, ni refus');
    assert.ok(w.alertes().some((x) => /^haute · Sphinx ne répond plus aux demandes d'adresse, le temps de vérifier$/.test(x)), w.alertes().join(' | '));
    let D = await w.etat(); assert.equal(D.doute, 1);
    let r = await w.act('dhcp_chercher'); assert.equal(r.ok, false); assert.match(r.text, /Odin n'a pas pu vérifier qu'aucun autre serveur d'adresses ne répond \(2 fois sur 3\)\. En attendant, il ne répond à aucune demande d'adresse/);
    // La vérification repasse : il répond de nouveau, et le compte repart de zéro.
    w.S.erreur = ''; await w.minute();
    assert.equal(genre(w.dit(paquet(M.tel, MSG.DISCOVER))), MSG.OFFER); D = await w.etat(); assert.equal(D.doute, 0);
    // Trois de suite : coupure, dite, et jamais de reprise toute seule.
    w.S.erreur = 'la recherche n\'a pas pu se faire (EADDRINUSE)';
    await w.minute(2); assert.equal(w.allume(), true);
    await w.minute();
    assert.deepEqual([w.allume(), w.garde().etat], [false, 'coupe']);
    assert.equal(w.garde().raison, 'Odin a arrêté de distribuer les adresses : il n\'a pas pu vérifier, 3 fois de suite, qu\'aucun autre serveur d\'adresses ne répond sur Ethernet. Il ne recommence pas tout seul.');
    w.S.erreur = ''; await w.minute(3); assert.equal(w.allume(), false);
    r = await w.act('dhcp_chercher'); assert.equal(w.allume(), false, 'chercher ne rallume rien');
  } finally { w.fin(); }
  // La carte a changé d'adresse (la prise écoute l'ancienne), ou n'est plus là.
  for (const cartes of [[{ ...CARTE, prefixe: 16, masque: '255.255.0.0' }], [{ ...CARTE, nom: 'Ethernet 2' }], []] as R.CarteReseau[][]) {
    w = await monde();
    try {
      assert.equal((await w.act('dhcp_demarrer')).ok, true);
      const n = w.recherches.length; w.S.cartes = cartes;
      await w.minute();
      assert.deepEqual([w.allume(), w.garde().etat, w.recherches.length], [false, 'coupe', n]);
      assert.match(w.garde().raison ?? '', /sa carte réseau \(Ethernet, 10\.0\.0\.2\) n'est plus là, ou a changé d'adresse/);
    } finally { w.fin(); }
  }
});

test('R4 · garde-fou : un appareil choisit un autre serveur → vérification tout de suite ; un paquet inventé ne coupe pas la maison à lui seul', async () => {
  const w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const n = w.recherches.length;
    // Personne d'autre ne répond vraiment : le paquet (peut-être inventé) déclenche la vérification, et Odin continue.
    w.dit(paquet(M.cam, MSG.REQUEST, { veut: '10.0.0.150', serveur: '10.0.0.66' }));
    await new Promise((ok) => setTimeout(ok, 20));
    assert.deepEqual([w.recherches.length, w.allume(), w.garde().etat], [n + 1, true, 'libre']);
    // Dix paquets de suite : une seule vérification de plus par quart de minute (pas une pluie de questions sur le réseau).
    for (let k = 0; k < 10; k++) w.dit(paquet(M.cam, MSG.REQUEST, { veut: '10.0.0.150', serveur: '10.0.0.66' }));
    await new Promise((ok) => setTimeout(ok, 20)); assert.equal(w.recherches.length, n + 1);
    // Cette fois un autre serveur répond pour de bon : coupure sans attendre la minute.
    w.S.now += 20_000; w.S.autres = [BOX];
    w.dit(paquet(M.tv, MSG.REQUEST, { veut: '10.0.0.151', serveur: BOX }));
    await new Promise((ok) => setTimeout(ok, 20));
    assert.deepEqual([w.allume(), w.garde().etat, w.garde().autres], [false, 'coupe', [BOX]]);
  } finally { w.fin(); }
});

test('R4 · Genèse : un seul serveur d\'adresses d\'Odin par carte (pas à côté du réseau à part), dans les deux sens que Sphinx tient', async () => {
  let genese: { ip: string } | undefined = { ip: ODIN };
  const w = await monde({ genese: () => genese });
  try {
    // Genèse distribue sur la carte d'Odin : refusé, sans même poser la question.
    let r = await w.act('dhcp_demarrer');
    assert.equal(r.ok, false); assert.match(r.text, /^Refusé : Genèse distribue déjà des adresses sur la carte Ethernet \(son réseau à part, pour le démarrage par le réseau\)\. Un seul serveur d'adresses d'Odin par carte\./);
    assert.deepEqual([w.allume(), w.recherches.length], [false, 0]);
    let D = await w.etat(); assert.deepEqual([D.genese.distribue, D.genese.memeCarte], [true, true]); assert.match(D.genese.texte, /Odin refuse d'y distribuer celles de la maison/);
    // Une adresse inconnue (prise fermée) : prudence, c'est « la même carte ».
    genese = { ip: '' }; assert.equal((await w.act('dhcp_demarrer')).ok, false);
    // Genèse distribue sur une AUTRE carte (son réseau à part) : les deux ne se gênent pas.
    genese = { ip: '10.10.0.1' };
    r = await w.act('dhcp_demarrer'); assert.equal(r.ok, true, r.text);
    D = await w.etat(); assert.deepEqual([D.genese.distribue, D.genese.memeCarte], [true, false]); assert.match(D.genese.texte, /sur une autre carte .* les deux ne se gênent pas/);
    // Genèse se met à distribuer sur la carte d'Odin pendant que Sphinx distribue : à la minute, Sphinx s'arrête.
    genese = { ip: ODIN };
    await w.minute();
    assert.deepEqual([w.allume(), w.garde().etat], [false, 'coupe']); assert.match(w.garde().raison ?? '', /Genèse distribue des adresses sur la même carte \(Ethernet\), et il ne faut qu'un seul serveur d'adresses d'Odin par carte/);
    // Genèse éteint : rien à dire de plus.
    genese = undefined;
    D = await w.etat(); assert.deepEqual([D.genese.distribue, D.genese.memeCarte], [false, false]);
  } finally { w.fin(); }
});

test('R4 · au démarrage d\'Odin : il revérifie avant de redistribuer ; un autre serveur → coupure ; carte pas prête → il réessaie dix minutes, puis s\'arrête', async () => {
  const w = await monde();
  let home = '';
  try { assert.equal((await w.act('dhcp_demarrer')).ok, true); w.prend(M.pc, 'PC-BUREAU'); home = w.home; } finally { w.v.stop(); }
  // Tout va bien : la question d'abord, puis l'écoute.
  let w2 = await monde({ home });
  try {
    await w2.v.module('vidarr')!.start!(w2.ctx);
    assert.deepEqual([w2.allume(), w2.recherches.length, w2.ecoutes.length, w2.garde().etat], [true, 1, 1, 'libre']);
  } finally { w2.v.stop(); }
  // La carte n'est pas prête au démarrage : pas d'écoute ; Odin réessaie chaque minute, et s'allume dès qu'il a pu vérifier.
  w2 = await monde({ home });
  try {
    w2.S.cartes = [];
    await w2.v.module('vidarr')!.start!(w2.ctx);
    assert.deepEqual([w2.allume(), w2.ecoutes.length], [false, 0]);
    assert.deepEqual(w2.alertes().filter((a) => /pas encore/.test(a)), ['haute · Odin ne distribue pas encore les adresses de la maison']);
    await w2.minute(2); assert.equal(w2.allume(), false);
    w2.S.cartes = [CARTE];
    await w2.minute(); assert.deepEqual([w2.allume(), w2.garde().etat], [true, 'libre']);
  } finally { w2.v.stop(); }
  // Jamais prête : au bout de dix minutes il s'arrête pour de bon, et le dit.
  w2 = await monde({ home });
  try {
    w2.S.erreur = 'la recherche n\'a pas pu se faire (EACCES)';
    await w2.v.module('vidarr')!.start!(w2.ctx);
    await w2.minute(10); assert.equal(w2.garde().etat, 'non_verifie');
    await w2.minute();
    assert.equal(w2.garde().etat, 'coupe'); assert.match(w2.garde().raison ?? '', /depuis son démarrage, il n'a pas pu vérifier en dix minutes/);
    w2.S.erreur = ''; const n = w2.recherches.length;
    await w2.minute(3); assert.deepEqual([w2.allume(), w2.recherches.length], [false, n], 'ensuite, plus de reprise toute seule');
  } finally { w2.v.stop(); }
  // Un autre serveur a pris la place pendant qu'Odin était éteint : coupure tout de suite, pas d'attente.
  w2 = await monde({ home });
  try {
    w2.ctx.saveSettings({ dhcpGarde: { etat: 'libre', carte: 'Ethernet', autres: [], verifie: T0 } });
    w2.S.autres = [BOX];
    await w2.v.module('vidarr')!.start!(w2.ctx);
    assert.deepEqual([w2.allume(), w2.ecoutes.length, w2.garde().etat, w2.garde().autres], [false, 0, 'coupe', [BOX]]);
    assert.equal(w2.garde().raison, 'Odin a arrêté de distribuer les adresses : à son démarrage, un autre serveur d\'adresses répondait (10.0.0.1). Il ne recommence pas tout seul.');
    assert.ok(w2.v.alerts({ module: 'vidarr' }).some((a) => a.level === 'critique' && a.title === 'Sphinx ne distribue plus les adresses de la maison' && /à son démarrage, un autre serveur d'adresses répondait \(10\.0\.0\.1\)/.test(a.detail ?? '')), 'le propriétaire est prévenu');
    w2.S.autres = []; await w2.minute(3); assert.equal(w2.allume(), false, 'la box se tait : Odin ne reprend pas tout seul');
  } finally { w2.fin(); }
});

test('R4 · réglages dans Sphinx : changer la plage ne coupe personne (le bail hors plage va au bout) ; un refus n\'écrit rien ; la passerelle demande l\'accord', async () => {
  const w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const ip = w.prend(M.pc, 'PC-BUREAU'); assert.equal(ip, '10.0.0.100');
    const avant = JSON.stringify(w.reglages());
    // Refusés : rien n'est écrit.
    for (const [plus, mot] of [[{ debut: '10.0.0.150', fin: '10.0.0.120' }, /refusé|précéder/], [{ debut: 'x' }, /mal écrite/], [{ fin: '10.0.1.20' }, /n'est pas dans le réseau/], [{ dns: 'box' }, /DNS mal écrit/], [{ heures: 9999 }, /6 minutes à 30 jours/],
      [{ debut: '192.168.1.100', fin: '192.168.1.199', passerelle: '192.168.1.1' }, /Odin distribue les adresses en ce moment, et son adresse \(10\.0\.0\.2\) n'est pas dans ce réseau/]] as Array<[Record<string, unknown>, RegExp]>) {
      const r = await w.act('dhcp_reglages', ENTREE(plus)); assert.equal(r.ok, false, JSON.stringify(plus)); assert.match(r.text, mot);
    }
    assert.equal(JSON.stringify(w.reglages()), avant);
    // La plage change : accepté, et dit.
    let r = await w.act('dhcp_reglages', ENTREE({ debut: '10.0.0.10', fin: '10.0.0.50', heures: 24, secours: true }));
    assert.equal(r.ok, true, r.text);
    assert.equal(r.text.split('\n')[0], '⚙️ DHCP : 10.0.0.10 → 10.0.0.50, passerelle 10.0.0.1, DNS 10.0.0.2, 10.0.0.1, baux 24 h, domaine .maison.');
    assert.match(r.text, /- Personne n'est coupé : 1 appareil tient une adresse hors de cette plage\. Il la garde jusqu'à la fin de son bail \(au plus tard .+\), puis reçoit une adresse de la plage\./);
    assert.deepEqual([w.reglages().start, w.reglages().end, w.reglages().dns, w.reglages().leaseSeconds], ['10.0.0.10', '10.0.0.50', [ODIN, BOX], 86_400]);
    assert.equal(w.allume(), true, 'le serveur continue : les réglages sont lus à chaque demande');
    // Le PC renouvelle son adresse hors plage : aucun refus net ; à la fin de son bail, une adresse de la nouvelle plage.
    assert.equal(w.dit(paquet(M.pc, MSG.REQUEST, { tient: ip })), undefined, 'ni accord ni refus : il va au bout de son bail');
    assert.equal(w.baux().find((l) => l.mac === M.pc)?.ip, ip);
    w.S.now += 13 * H - MIN; await w.minute();
    assert.equal(w.prend(M.pc, 'PC-BUREAU'), '10.0.0.10');
    // Un nouvel appareil reçoit une adresse de la nouvelle plage, avec la box en DNS de secours.
    const offre = w.dit(paquet(M.tel, MSG.DISCOVER))!;
    assert.equal(offre.yiaddr, '10.0.0.11'); assert.deepEqual([...offre.options.get(6)!], [10, 0, 0, 2, 10, 0, 0, 1]); assert.equal(offre.options.get(51)!.readUInt32BE(0), 86_400);
    // La passerelle pendant qu'Odin distribue : la question « grave » dit ce qui change (la page et la parole demandent l'accord).
    const a = w.v.module('vidarr')!.actions.find((x) => x.id === 'dhcp_reglages')!;
    assert.match(a.grave!(ENTREE({ debut: '10.0.0.10', fin: '10.0.0.50', heures: 24, secours: true, passerelle: '10.0.0.254' }), w.ctx) ?? '', /^changer la passerelle \(10\.0\.0\.254\), le DNS donné \(10\.0\.0\.2, 10\.0\.0\.254\) pendant qu'Odin distribue les adresses/);
    assert.equal(a.grave!(ENTREE({ debut: '10.0.0.20', fin: '10.0.0.60', heures: 24, secours: true }), w.ctx), undefined, 'la plage seule : pas d\'accord à demander');
    r = await w.act('dhcp_reglages', ENTREE({ debut: '10.0.0.10', fin: '10.0.0.50', heures: 24, passerelle: '10.0.0.254' }), { auto: true, by: 'automatisation' });
    assert.equal(r.ok, false); assert.match(r.text, REFUS); assert.equal(w.reglages().router, BOX);
  } finally { w.fin(); }
});

test('R4 · « seulement les appareils approuvés » : les appareils CONNUS qui ont une adresse sont approuvés d\'abord, nom par nom ; un NOUVEAU (moins d\'un jour) ne l\'est pas : il attend ton accord', async () => {
  const w = await monde();
  const INTRUS = '00:00:5e:00:53:66', INCONNU = '00:00:5e:00:53:98';
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const ipPc = w.prend(M.pc, 'PC-BUREAU'), ipTel = w.prend(M.tel, 'Telephone'), ipCam = w.prend(M.cam, 'Camera'); w.prend(M.tv, 'Tele');
    // Deux jours passent : Odin connaît ces quatre appareils. Ils renouvellent leur adresse.
    w.S.now += 2 * 24 * H - MIN; await w.minute();
    for (const [mac, ip] of [[M.pc, ipPc], [M.tel, ipTel], [M.cam, ipCam]]) assert.equal(genre(w.dit(paquet(mac, MSG.REQUEST, { tient: ip }))), MSG.ACK, mac);
    w.prend(M.tv, 'Tele');
    assert.equal((await w.act('dhcp_approuver', { mac: M.pc, nom: 'PC du bureau' })).ok, true);
    assert.equal((await w.act('dhcp_mac_etat', { mac: M.cam, etat: 'bloque', nom: 'Camera' })).ok, true);
    assert.equal((await w.act('dhcp_fixe', { mac: M.tv, ip: '10.0.0.40', nom: 'Télévision' })).ok, true);
    // Un inconnu arrive à l'instant (un voisin, un intrus) : Odin ne le connaît que depuis une minute.
    const ipIntrus = w.prend(INTRUS, 'Intrus');
    // La page le montre AVANT : qui sera approuvé, qui ne le sera PAS, qui reste comme il est.
    let D = await w.etat();
    assert.deepEqual(D.liste.aApprouver.map((a) => [a.mac, a.nom, a.ip, a.nouveau]), [[M.tel, 'Telephone', ipTel, false]]);
    assert.deepEqual(D.liste.aVoir.map((a) => [a.mac, a.nom, a.ip]), [[INTRUS, 'Intrus', ipIntrus]], 'le nouveau n\'est pas approuvé d\'avance'); assert.equal(D.liste.origineConnue, false);
    assert.deepEqual(D.liste.restent.map((x) => [x.mac, x.etat]), [[M.cam, 'bloque']]); assert.equal(D.liste.deja, 2);
    const a = w.v.module('vidarr')!.actions.find((x) => x.id === 'dhcp_mode')!;
    assert.match(a.grave!({ mode: 'liste' }, w.ctx) ?? '', /l'appareil qui a une adresse en ce moment est approuvé d'abord ; un appareil arrivé depuis moins d'un jour n'est PAS approuvé : il perdra le réseau à la fin de son bail si tu ne l'approuves pas$/); assert.equal(a.grave!({ mode: 'ouvert' }, w.ctx), undefined);
    const r = await w.act('dhcp_mode', { mode: 'liste' });
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^🔒 Liste d'autorisation : seuls les appareils approuvés/);
    assert.match(r.text, /- Approuvés d'abord, parce qu'ils ont une adresse en ce moment \(1\) : Telephone\. Sans cela, ils auraient perdu le réseau à la fin de leur bail\./);
    assert.match(r.text, /- PAS approuvé, parce qu'Odin ne le connaît que depuis moins d'un jour \(1\) : Intrus\. Il garde son adresse jusqu'à la fin de son bail \(au plus tard .+\), puis attend ton accord\. Dans « Appareils » : « Je le connais » si tu le reconnais, sinon bloque-le\./);
    assert.match(r.text, /- Odin ne sait pas quel appareil tu tiens en ce moment : s'il est dans cette liste, approuve-le maintenant\./);
    assert.match(r.text, /- Rien ne change pour Camera : il reste bloqué\./);
    assert.deepEqual(w.etats(), { [M.pc]: 'actif', [M.cam]: 'bloque', [M.tel]: 'actif' }, 'ni l\'intrus, ni la télévision (son accord tient à son adresse fixe) ne sont écrits');
    assert.deepEqual((w.ctx.settings.macPolicy as MacPolicy).attente, [INTRUS], 'l\'intrus est posé « en attente » : il se voit tout de suite dans Appareils');
    assert.deepEqual((r.data as { aVoir: string[] }).aVoir, [INTRUS]);
    // Le téléphone renouvelle : accordé (sans l'approbation d'avance, sa demande était ignorée et il perdait le réseau).
    assert.equal(genre(w.dit(paquet(M.tel, MSG.REQUEST, { tient: ipTel }))), MSG.ACK);
    assert.equal(genre(w.dit(paquet(M.pc, MSG.REQUEST, { tient: ipPc }))), MSG.ACK);
    // L'intrus ne renouvelle plus (ni accord, ni refus : il va au bout de son bail) ; « Je le connais » le laisse passer.
    assert.equal(w.dit(paquet(INTRUS, MSG.REQUEST, { tient: ipIntrus })), undefined);
    assert.equal((await w.act('dhcp_approuver', { mac: INTRUS, nom: 'Tablette de Sami' })).ok, true);
    assert.equal(genre(w.dit(paquet(INTRUS, MSG.REQUEST, { tient: ipIntrus }))), MSG.ACK);
    // La caméra reste bloquée ; un inconnu attend, sans adresse.
    assert.notEqual(genre(w.dit(paquet(M.cam, MSG.REQUEST, { tient: ipCam }))), MSG.ACK);
    assert.equal(w.dit(paquet(INCONNU, MSG.DISCOVER, { nom: 'Imprimante' })), undefined);
    assert.deepEqual((w.ctx.settings.macPolicy as MacPolicy).attente, [INCONNU]);
    D = await w.etat(); assert.deepEqual([D.liste.mode, D.liste.attente, D.liste.aApprouver.length, D.liste.aVoir.length], ['liste', 1, 0, 0]);
    // Redire « liste » : plus rien à approuver, et c'est dit.
    assert.match((await w.act('dhcp_mode', { mode: 'liste' })).text, /- Aucun appareil approuvé d'avance/);
    // Revenir à « toutes les machines » : personne n'est désapprouvé ni débloqué.
    assert.match((await w.act('dhcp_mode', { mode: 'ouvert' })).text, /^🔓 Ouvert/); assert.equal(w.etats()[M.cam], 'bloque'); assert.equal(w.etats()[M.tel], 'actif');
  } finally { w.fin(); }
});

test('R4 relecture · « seulement les appareils approuvés » : l\'appareil que le propriétaire tient est approuvé même s\'il est nouveau (il ne se coupe pas lui-même) ; les autres nouveaux attendent', async () => {
  // La règle pure.
  const leases = [bail(M.pc, '10.0.0.150'), bail(M.tel, '10.0.0.151'), bail(M.tv, '10.0.0.152')];
  const p = preApprobation({ config: CFG(), leases, policy: { mode: 'ouvert', etats: {}, attente: [] }, now: T0, nouveau: (mac) => mac !== M.pc, tenu: (mac) => mac === M.tel });
  assert.deepEqual(p.aApprouver.map((x) => x.mac), [M.pc, M.tel], 'le connu, et celui que le propriétaire tient');
  assert.deepEqual(p.aVoir, [{ mac: M.tv, ip: '10.0.0.152', nom: M.tv, jusqua: T0 + 6 * H }], 'le nouveau qu\'il ne tient pas attend son accord');
  // Dans Sphinx : deux appareils arrivés à l'instant ; la demande vient de l'adresse du premier.
  const w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const ipMien = w.prend(M.pc, 'Mon-PC'), ipAutre = w.prend(M.tel, 'Inconnu');
    const r = await origineDemande.run(ipMien, () => w.act('dhcp_mode', { mode: 'liste' }));
    assert.equal(r.ok, true, r.text);
    assert.deepEqual(w.etats(), { [M.pc]: 'actif' }); assert.deepEqual((w.ctx.settings.macPolicy as MacPolicy).attente, [M.tel]);
    assert.match(r.text, /- Approuvés d'abord, parce qu'ils ont une adresse en ce moment \(1\) : Mon-PC\./); assert.match(r.text, /- PAS approuvé, parce qu'Odin ne le connaît que depuis moins d'un jour \(1\) : Inconnu\./);
    assert.doesNotMatch(r.text, /Odin ne sait pas quel appareil tu tiens/);
    assert.equal(genre(w.dit(paquet(M.pc, MSG.REQUEST, { tient: ipMien }))), MSG.ACK); assert.equal(w.dit(paquet(M.tel, MSG.REQUEST, { tient: ipAutre })), undefined);
  } finally { w.fin(); }
});

test('R4 · la lecture `dhcp_etat` : tout ce que l\'écran montre, sans rien écrire ni rien envoyer ; au propriétaire en personne', async () => {
  const w = await monde();
  try {
    // La box distribue : le réseau de la maison n'est pas touché.
    let D = await w.etat();
    assert.deepEqual([D.proprietaire, D.mode, D.distribue, D.garde.etat, D.ancienne], [true, 'box', false, 'non_verifie', false]);
    assert.deepEqual(D.carte, { nom: 'Ethernet', ip: ODIN, prefixe: 24, genre: 'cable' });
    assert.deepEqual(D.reglages, { debut: '10.0.0.100', fin: '10.0.0.199', passerelle: BOX, masque: '255.255.255.0', dns: '', secours: false, heures: 12, domaine: 'maison', odin: ODIN });
    assert.deepEqual(D.heuresProposees, [{ heures: 2, mots: '2 h' }, { heures: 12, mots: '12 h' }, { heures: 24, mots: '1 jour' }, { heures: 72, mots: '3 jours' }]);
    assert.equal(D.verdict, null);
    assert.deepEqual(D.allumer, [
      'Odin demande d\'abord sur sa carte (Ethernet, 10.0.0.2) si un autre serveur d\'adresses répond. S\'il y en a un (la box), c\'est refusé : rien ne s\'allume.',
      'Le serveur d\'adresses (DHCP) de la box doit donc être coupé d\'abord : page de la box → réseau local → serveur DHCP : désactivé.',
      'L\'adresse d\'Odin (10.0.0.2) doit être réglée à la main sur sa machine (adresse fixe) : sans le serveur d\'adresses de la box, une adresse automatique finirait par se perdre, et le réseau de la maison avec elle.',
      'Odin distribuera 10.0.0.100 à 10.0.0.199, avec un bail de 12 h, la passerelle 10.0.0.1 et le DNS 10.0.0.2.',
      'Ensuite il repose la question chaque minute, et s\'arrête aussitôt s\'il voit un autre serveur d\'adresses. Il ne recommence jamais tout seul après s\'être arrêté.',
    ]);
    assert.equal(D.filet.lignes.length, 4); assert.match(D.filet.lignes[0], /12 h au plus après leur dernier renouvellement/);
    // Vérifier des réglages avant de les enregistrer : la réponse, le champ, les avis ; rien n'est écrit.
    const avant = JSON.stringify(w.ctx.settings);
    D = await w.etat(ENTREE({ fin: '10.0.0.300' }));
    assert.deepEqual([D.verdict?.ok, D.verdict?.champ], [false, 'fin']); assert.match(D.verdict!.message, /La dernière adresse est mal écrite/);
    D = await w.etat(ENTREE({ debut: '10.0.0.10', fin: '10.0.0.20' }));
    assert.deepEqual([D.verdict?.ok, D.verdict?.message], [true, 'Réglages valables.']); assert.equal('config' in D.verdict!, false);
    assert.equal(JSON.stringify(w.ctx.settings), avant, 'lire et vérifier n\'écrit rien'); assert.equal(w.recherches.length, 0, 'ni ne pose de question sur le réseau'); assert.equal(w.ecoutes.length, 0);
    // Pas le propriétaire en personne : refusé (noms d'appareils, adresses du réseau).
    for (const o of [{ auto: true, by: 'automatisation' }, { auto: true, by: 'assistant' }, { by: 'réflexe' }, { by: 'odin' }, { qui: 'member' }, { qui: 'guest' }, { qui: 'owner', marque: true }] as Array<Parameters<Valhalla['act']>[3]>) {
      const r = await w.act('dhcp_etat', {}, o); assert.equal(r.ok, false, JSON.stringify(o)); assert.match(r.text, REFUS);
    }
    // Un membre connecté à l'interface : seulement qui distribue.
    const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
    const m = await auNomDe(nour, () => w.act('dhcp_etat'));
    assert.equal(m.ok, true); assert.deepEqual(m.data, { proprietaire: false, limite: 'Les réglages du DHCP (qui distribue les adresses, la plage, le bail) sont au propriétaire seul.', mode: 'box', distribue: false });
    // Odin distribue : le garde-fou et sa dernière vérification ; une vérification trop vieille est dite (veille en pause).
    assert.equal((await w.act('dhcp_demarrer')).ok, true); w.prend(M.pc, 'PC-BUREAU');
    D = await w.etat();
    assert.deepEqual([D.mode, D.distribue, D.garde.etat, D.garde.verifie, D.ancienne], ['odin', true, 'libre', T0, false]);
    assert.match(D.filet.lignes[1], /^Si Odin s'arrêtait maintenant : l'appareil connecté \(PC-BUREAU\) garderait son adresse jusqu'à /);
    w.S.now += 4 * MIN; D = await w.etat(); assert.equal(D.ancienne, true);
    await w.minute(); D = await w.etat(); assert.equal(D.ancienne, false);
    // Coupé : la page a la raison, mot pour mot.
    w.S.autres = [BOX]; await w.minute(); D = await w.etat();
    assert.deepEqual([D.mode, D.distribue, D.garde.etat], ['odin', false, 'coupe']); assert.match(D.garde.raison ?? '', /Il ne recommence pas tout seul\.$/);
    // « La box » : Odin arrête, et dit franchement ce qui se passe ensuite.
    w.S.autres = []; assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const r = await w.act('dhcp_arreter');
    assert.equal(r.ok, true); assert.deepEqual(r.text.split('\n').map((l) => l.replace(/\(.*?\)/, '(…)')), ['⏹ DHCP d\'Odin arrêté. Rallume celui de la box.', '- L\'appareil connecté garde son adresse jusqu\'à la fin de son bail (…).', '- Un appareil qui arrive maintenant ne reçoit pas d\'adresse tant que la box ne distribue pas.', '- Dans la box : serveur DHCP activé, avec la même plage (…) pour que personne ne change d\'adresse.']);
    D = await w.etat(); assert.deepEqual([D.mode, D.distribue, D.garde.etat], ['box', false, 'non_verifie']);
    await w.minute(3); assert.equal(w.allume(), false);
  } finally { w.fin(); }
});

test('R4 · la liste exacte : aucune nouvelle action qui écrit ; les gestes du DHCP restent au propriétaire seul, avec son accord pour allumer', async () => {
  const m = vidarr(), ecrit = m.actions.filter((a) => !a.read).map((a) => a.id).filter((id) => id !== 'qui_a_fait');
  assert.deepEqual(ecrit.filter((id) => !SPHINX.includes(id)), [], 'toute action de Sphinx qui écrit est dans la liste du lot R1');
  assert.deepEqual(SPHINX.filter((id) => !ecrit.includes(id)), [], 'et aucune n\'a disparu');
  const a = (id: string) => m.actions.find((x) => x.id === id)!;
  for (const id of ['dhcp_reglages', 'dhcp_demarrer', 'dhcp_arreter', 'dhcp_mode']) assert.equal(a(id).proprietaireSeul, true, id);
  assert.equal(a('dhcp_etat').read, true); assert.equal(a('dhcp_etat').external, true, 'des noms d\'appareils viennent du réseau : une donnée, jamais un ordre');
  assert.match(a('dhcp_demarrer').grave!({}) ?? '', /Odin vérifie d'abord qu'aucun autre serveur d'adresses ne répond sur sa carte et refuse s'il en voit un/);
  assert.ok(a('dhcp_arreter').grave!({}));
  const w = await monde();
  try {
    for (const o of [{ auto: true, by: 'automatisation' }, { by: 'réflexe' }, { qui: 'member' }, { qui: 'owner', marque: true }] as Array<Parameters<Valhalla['act']>[3]>) {
      for (const [id, i] of [['dhcp_demarrer', {}], ['dhcp_arreter', {}], ['dhcp_reglages', ENTREE()], ['dhcp_mode', { mode: 'liste' }]] as Array<[string, Record<string, unknown>]>) { const r = await w.act(id, i, o); assert.equal(r.ok, false, `${id} ${JSON.stringify(o)}`); assert.match(r.text, REFUS); }
    }
    assert.deepEqual([w.allume(), w.recherches.length, w.ecoutes.length], [false, 0, 0]);
    // Ce que le propriétaire fait est noté « qui a fait quoi ».
    w.S.autres = [BOX]; await w.act('dhcp_demarrer'); w.S.autres = []; await w.act('dhcp_demarrer'); await w.act('dhcp_reglages', ENTREE({ heures: 24 }));
    const j = ((await w.act('qui_a_fait', { n: 10 })).data as { actes: Array<{ action: string; ok: boolean; quoi: string }> }).actes.map((x) => `${x.action} ${x.ok ? 'fait' : 'pas fait'}`);
    assert.deepEqual(j, ['Réglages DHCP fait', 'Allumer le DHCP fait', 'Allumer le DHCP pas fait']);
  } finally { w.fin(); }
});

// ------------------------------------------------------------------ relecture en adversaire (24/11)
const souffle = () => new Promise((ok) => setTimeout(ok, 20));

test('R4 relecture · réglages : la passerelle n\'est jamais Odin lui-même ; un DNS, une plage, un bail ou un nom de maison piégés sont refusés', () => {
  const non = (plus: Record<string, unknown>, allume = true) => { const v = verifierReglages({ entree: ENTREE(plus), courant: CFG(), odin: ODIN, leases: [], now: T0, allume, heure }); assert.equal(v.ok, false, JSON.stringify(plus)); assert.equal(v.config, undefined); return `${v.champ} · ${v.message}`; };
  // Odin en passerelle : toute la maison perdrait Internet au prochain renouvellement (Odin ne fait pas suivre).
  assert.match(non({ passerelle: ODIN }), /^passerelle · Refusé : 10\.0\.0\.2 est l'adresse d'Odin lui-même\. La passerelle est l'adresse de la box/);
  assert.match(non({ passerelle: ODIN }, false), /^passerelle · Refusé/, 'même quand la box distribue : ces réglages serviraient plus tard');
  // Une plage qui ne laisse rien à donner (elle ne contient qu'Odin et la box).
  assert.match(non({ debut: ODIN, fin: ODIN }), /^fin · Refusé : cette plage ne laisse aucune adresse à donner/);
  assert.match(non({ debut: BOX, fin: ODIN }), /^fin · Refusé : cette plage ne laisse aucune adresse à donner/);
  // Un DNS que personne ne peut joindre : multidiffusion, adresses réservées, secours automatique.
  for (const dns of ['224.0.0.251', '240.0.0.1', '169.254.1.1', '0.1.2.3', '127.9.9.9']) assert.match(non({ dns }), /^dns · .* ne peut pas servir de DNS/, dns);
  // Un réseau qui n'est pas un réseau de maison.
  assert.match(non({ passerelle: '127.0.0.1', debut: '127.0.0.10', fin: '127.0.0.20' }, false), /^passerelle · La passerelle 127\.0\.0\.1 n'est pas une adresse de maison/);
  assert.match(non({ passerelle: '224.0.0.1', debut: '224.0.0.10', fin: '224.0.0.20' }, false), /^passerelle · /);
  // Le bail : un nombre, ou un nombre écrit en chiffres. Ni « vrai » (1 h), ni « 0x10 » (16 h), ni « 1e2 ».
  for (const heures of [true, '0x10', '1e2', [], {}, '12 h']) assert.match(non({ heures }), /^heures · La durée du bail est un nombre d'heures/, String(heures));
  assert.equal(verifierReglages({ entree: ENTREE({ heures: '0,5' }), courant: CFG(), odin: ODIN, leases: [], now: T0, allume: false, heure }).config?.leaseSeconds, 1800);
  // Le nom de la maison : le DNS d'Odin répond « nom-de-l-appareil.nom-de-la-maison », et un appareil choisit son nom.
  // Avec « com », un appareil nommé « google » prendrait la place de google.com pour toute la maison.
  for (const domaine of ['com', 'fr', 'local', 'localhost', 'google.com', 'banque.fr', 'a.b.c.d']) assert.match(non({ domaine }), /^domaine · Refusé : « .+ » .*Un appareil de la maison pourrait y répondre à la place d'un vrai site/, domaine);
  for (const domaine of ['mai\u2028son', 'mai\u00a0son', 'm\u0430ison', 'maison\u200b', '-x', 'a'.repeat(64), '<b>']) assert.match(non({ domaine }), /^domaine · Nom de la maison invalide/, JSON.stringify(domaine));
  for (const domaine of ['lan', 'chez-nous', 'maison.lan', 'famille.home.arpa']) assert.equal(verifierReglages({ entree: ENTREE({ domaine }), courant: CFG(), odin: ODIN, leases: [], now: T0, allume: false, heure }).config?.domain, domaine);
  // Une plage qui contient Odin, la box et un DNS de la maison : acceptée, ces trois adresses ne comptent pas dans ce qui reste à donner.
  const v = verifierReglages({ entree: ENTREE({ debut: BOX, fin: '10.0.0.4', dns: '10.0.0.3' }), courant: CFG(), odin: ODIN, leases: [bail(M.pc, '10.0.0.150'), bail(M.tel, '10.0.0.151')], now: T0, allume: false, heure });
  assert.equal(v.ok, true, v.message); assert.match(v.avis.join('\n'), /La plage compte 1 adresse à donner pour 2 appareils connectés/);
});

test('R4 relecture · « forcer » : un port du DHCP mal écrit (« 67 » en texte, 67,5) ou réservé ne fait jamais passer la maison pour un banc d\'essai', async () => {
  const w = await monde();
  // La vraie écoute est rétablie, mais AUCUNE prise ne s'ouvre : `start` note seulement ce qu'on lui demande.
  const vraiStart = DhcpServer.prototype.start, ouverts: unknown[][] = [];
  DhcpServer.prototype.start = async function (this: DhcpServer, ...a: unknown[]) { ouverts.push(a); (this as unknown as { sock: unknown }).sock = { send: () => {}, close: () => {} }; } as never;
  const simulee = PRISE_DHCP.ecouter; PRISE_DHCP.ecouter = PRISE;
  try {
    w.S.autres = [BOX];
    for (const ports of [['67', 68], [67.5, 68], [67, 68], [68, 67], [1023, 68], [-1, 68], [Number.NaN, 68], [70000, 68], 'x', [[67], 68]]) {
      w.ctx.saveSettings({ dhcpPorts: ports });
      const r = await w.act('dhcp_demarrer', { forcer: true });
      assert.equal(r.ok, false, JSON.stringify(ports)); assert.match(r.text, /^Refusé : Odin n'allume jamais son serveur d'adresses sans vérifier/);
      assert.deepEqual([w.allume(), ouverts.length, w.ctx.settings.dhcpOn === true], [false, 0, false], JSON.stringify(ports));
    }
    // Le vrai banc d'essai (un port haut, où aucun appareil ne parle DHCP) : « forcer » y vaut encore.
    w.ctx.saveSettings({ dhcpPorts: [6767, 6868] });
    assert.notEqual((await w.act('dhcp_demarrer', { forcer: true })).ok, false); assert.deepEqual(ouverts, [[6767, 6868, '0.0.0.0']]);
  } finally { DhcpServer.prototype.start = vraiStart; PRISE_DHCP.ecouter = simulee; w.fin(); }
});

test('R4 relecture · pendant la vérification Odin se TAIT (jamais deux serveurs qui répondent à la fois) ; deux vérifications demandées en même temps n\'en font qu\'une', async () => {
  const w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const ipPc = w.prend(M.pc, 'PC-BUREAU'), n = w.recherches.length;
    // La recherche dure trois secondes en vrai : ici elle attend qu'on la lâche.
    let lacher = () => {};
    R.RESEAU.chercher = async (c, p) => { w.recherches.push({ carte: c.nom, ...p }); await new Promise<void>((ok) => { lacher = ok; }); return { serveurs: [...w.S.autres] }; };
    w.S.now += MIN; const v1 = veillerDhcp(w.ctx), v2 = veillerDhcp(w.ctx);
    await souffle();
    assert.equal(w.recherches.length, n + 1, 'une seule question pour deux demandes');
    assert.equal(w.dit(paquet(M.tel, MSG.DISCOVER)), undefined, 'pendant la vérification : aucune offre');
    assert.equal(w.dit(paquet(M.pc, MSG.REQUEST, { tient: ipPc })), undefined, 'ni accord, ni refus');
    lacher(); await Promise.all([v1, v2]);
    assert.equal(genre(w.dit(paquet(M.tel, MSG.DISCOVER))), MSG.OFFER, 'personne d\'autre : Odin répond de nouveau');
    // Un appareil vient de choisir la box : Odin se tait AUSSITÔT, le temps de vérifier. La box répond : coupé, sans avoir rien répondu.
    w.S.now += 20_000; w.S.autres = [BOX]; const e = w.envois.length;
    w.dit(paquet(M.tv, MSG.REQUEST, { veut: '10.0.0.151', serveur: BOX }));
    assert.equal(w.dit(paquet(M.cam, MSG.DISCOVER)), undefined, 'aucune offre pendant que la box répond peut-être');
    await souffle(); lacher(); await souffle();
    assert.deepEqual([w.allume(), w.garde().etat, w.garde().autres, w.envois.length], [false, 'coupe', [BOX], e]);
  } finally { w.fin(); }
});

test('R4 relecture · la veille de Sphinx en pause (Talos) : une vérification de plus de deux minutes et demie ne vaut plus ; Odin se tait et revérifie avant de répondre', async () => {
  // La box a été rallumée pendant que la veille ne passait plus : Odin ne lui répond pas à côté.
  let w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const n = w.recherches.length, e = w.envois.length;
    w.S.now += 10 * MIN; w.S.autres = [BOX];
    assert.equal(w.dit(paquet(M.pc, MSG.DISCOVER)), undefined, 'aucune offre sans vérification récente');
    await souffle();
    assert.deepEqual([w.recherches.length, w.allume(), w.garde().etat, w.envois.length], [n + 1, false, 'coupe', e], 'la demande a relancé la vérification, qui a coupé');
  } finally { w.fin(); }
  // Personne d'autre : la demande relance la vérification, et la demande suivante (quelques secondes plus tard) reçoit sa réponse.
  w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const n = w.recherches.length;
    w.S.now += 10 * MIN;
    assert.equal(w.dit(paquet(M.pc, MSG.DISCOVER)), undefined); assert.equal(w.dit(paquet(M.tel, MSG.DISCOVER)), undefined);
    await souffle();
    assert.deepEqual([w.recherches.length, w.allume(), w.garde().verifie], [n + 1, true, w.S.now], 'une seule vérification pour les deux demandes');
    assert.equal(genre(w.dit(paquet(M.pc, MSG.DISCOVER))), MSG.OFFER);
    // Deux minutes plus tard, sans veille : la vérification vaut encore.
    w.S.now += 2 * MIN; assert.equal(genre(w.dit(paquet(M.tel, MSG.DISCOVER))), MSG.OFFER); assert.equal(w.recherches.length, n + 1);
  } finally { w.fin(); }
});

test('R4 relecture · la veille de chaque minute n\'écrit pas le disque, et le reste de la veille de Sphinx garde son rythme de 5 minutes', async () => {
  const w = await monde();
  try {
    assert.equal((await w.act('dhcp_demarrer')).ok, true);
    const lu = () => JSON.parse(readFileSync(join(w.ctx.dir, 'réglages.json'), 'utf8')) as { dhcpGarde: R.Garde; listsAt?: string };
    const ecrit = lu().dhcpGarde.verifie;
    await w.minute(5);
    assert.equal(w.garde().verifie, w.S.now, 'en mémoire, l\'heure de la dernière vérification est à jour');
    assert.equal(lu().dhcpGarde.verifie, ecrit, 'le fichier des réglages n\'est pas réécrit chaque minute pour une heure');
    // Une coupure, elle, est écrite tout de suite (elle doit survivre à un redémarrage).
    // Le reste de la veille (historique, listes, DNS) : au premier passage, puis toutes les 5 minutes seulement.
    const veille = w.v.module('vidarr')!.watch!, VIEUX = '2000-01-01T00:00:00.000Z';
    await veille.run(w.ctx); assert.notEqual(w.ctx.settings.listsAt, undefined, 'premier passage : les listes sont regardées');
    for (let k = 0; k < 4; k++) { w.ctx.settings.listsAt = VIEUX; w.S.now += MIN; await veille.run(w.ctx); assert.equal(w.ctx.settings.listsAt, VIEUX, `minute ${k + 1} : seul le garde-fou passe`); }
    assert.equal(w.garde().verifie, w.S.now, 'le garde-fou, lui, passe chaque minute');
    w.S.now += MIN; await veille.run(w.ctx); assert.notEqual(w.ctx.settings.listsAt, VIEUX, 'cinq minutes : le reste de la veille repasse');
    w.S.autres = [BOX]; w.S.now += MIN; await veille.run(w.ctx);
    assert.equal(lu().dhcpGarde.etat, 'coupe', 'la coupure est écrite sur le disque');
  } finally { w.fin(); }
});

test('R4 relecture · hors de Windows, Odin écoute toutes les cartes : refusé s\'il y a une carte sur un autre réseau (il y répondrait à côté d\'un autre serveur)', async () => {
  const w = await monde();
  try {
    w.S.plateforme = 'linux'; w.S.cartes = [CARTE, { nom: 'virbr0', ip: '192.168.122.1', masque: '255.255.255.0', prefixe: 24, genre: 'virtuelle' }];
    let r = await w.act('dhcp_demarrer');
    assert.equal(r.ok, false); assert.match(r.text, /Sur ce système, Odin ne sait pas écouter une seule carte : il répondrait aussi sur virbr0 \(192\.168\.122\.1\), qui est sur un autre réseau/);
    assert.deepEqual([w.allume(), w.ecoutes.length, w.recherches.length], [false, 0, 0]);
    // Une seule carte : allumé, comme avant (sur toutes les cartes, faute de mieux).
    w.S.cartes = [CARTE];
    r = await w.act('dhcp_demarrer'); assert.equal(r.ok, true, r.text); assert.deepEqual(w.ecoutes, [{ ports: [67, 68], hote: undefined }]);
    // Une carte d'un autre réseau apparaît ensuite : dit par une alerte, sans couper la maison.
    w.S.cartes = [CARTE, { nom: 'usb0', ip: '192.168.42.5', masque: '255.255.255.0', prefixe: 24, genre: 'cable' }];
    await w.minute();
    assert.equal(w.allume(), true); assert.ok(w.alertes().some((x) => /^haute · Sphinx : une carte d'un autre réseau est apparue$/.test(x)), w.alertes().join(' | '));
    // Sous Windows, la prise est attachée à la carte d'Odin : une autre carte ne gêne pas.
  } finally { w.fin(); }
});

test('R4 relecture · Genèse → Sphinx : Genèse ne distribue pas sur la carte où Sphinx distribue les adresses de la maison (un seul serveur d\'adresses d\'Odin par carte)', async () => {
  // Le vrai Sphinx donne à lire, sans appel entre applis, la carte où il distribue.
  assert.equal(typeof (vidarr() as unknown as { distributionMaison?: unknown }).distributionMaison, 'function');
  const home = mkdtempSync(join(tmpdir(), 'sphinx-r4-genese-')); dossiers.push(home);
  const cle = process.env.BRISINGAMEN_KEY; process.env.BRISINGAMEN_KEY = 'ef'.repeat(32);
  const APART: R.CarteReseau = { nom: 'Ethernet 2', ip: '10.10.0.1', masque: '255.255.255.0', prefixe: 24, genre: 'cable' };
  let sphinx: { carte: string; ip: string } | undefined; const ecoutes: string[] = [];
  R.RESEAU.cartes = () => [CARTE, APART]; R.RESEAU.plateforme = () => 'win32'; R.RESEAU.chercher = async () => ({ serveurs: [] });
  R.RESEAU.ecouter = async (srv, _p, _c, host) => { ecoutes.push(host); (srv as unknown as { sock: unknown }).sock = { send: () => {}, close: () => {} }; };
  // Un faux Sphinx : seulement ce que Genèse y lit.
  const faux = { id: 'vidarr', name: 'Sphinx', family: 'Réseau', what: 'essai', does: [], from: [], upstream: [], words: [], actions: [], view: () => ({ sections: [] }) } as unknown as Module;
  Object.defineProperty(faux, 'distributionMaison', { value: () => sphinx, enumerable: false });
  const v = new Valhalla(home, [thjalfi(), faux], { run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }), fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(T0) });
  v.ctx('thjalfi').saveSettings({ ports: { http: 0, tftp: 0, dhcp: 6767, pxe: 0, client: 6868 } });
  const genese = () => v.modules().find((m) => m.id === 'thjalfi') as unknown as { reseauAPart: () => unknown; watch: { run: (c: unknown) => Promise<void> } };
  const complet = () => v.act('thjalfi', 'mode', { mode: 'complet', carte: 'Ethernet 2', debut: '10.10.0.100', fin: '10.10.0.120', bail: 7200 });
  try {
    // Sphinx distribue sur cette carte (la même, ou le même réseau) : refusé, rien n'est gardé.
    for (const s of [{ carte: 'Ethernet 2', ip: '10.10.0.1' }, { carte: 'Autre nom', ip: '10.10.0.7' }]) {
      sphinx = s;
      const r = await complet();
      assert.equal(r.ok, false, JSON.stringify(s)); assert.match(r.text, /^Refusé : Sphinx distribue déjà les adresses de la maison sur la carte Ethernet 2\. Un seul serveur d'adresses d'Odin par carte/);
      assert.notEqual(v.ctx('thjalfi').settings.mode, 'complet');
    }
    // Sphinx distribue sur l'autre carte (la maison) : le réseau à part est accepté sur la sienne.
    sphinx = { carte: 'Ethernet', ip: ODIN };
    let r = await complet(); assert.notEqual(r.ok, false, r.text);
    r = await v.act('thjalfi', 'allumer', {}); assert.notEqual(r.ok, false, r.text);
    assert.ok(genese().reseauAPart()); assert.deepEqual(ecoutes, ['10.10.0.1']);
    // Sphinx se met à distribuer sur la carte du réseau à part : à la minute, Genèse s'arrête et le dit.
    sphinx = { carte: 'Ethernet 2', ip: '10.10.0.1' };
    await genese().watch.run(v.ctx('thjalfi'));
    assert.equal(genese().reseauAPart(), undefined, 'coupé');
    assert.match(String((v.ctx('thjalfi').settings.garde as R.Garde).raison), /Sphinx distribue les adresses de la maison sur la même carte \(Ethernet 2\)/);
    assert.ok(v.alerts({ module: 'thjalfi' }).some((x) => /arrêté de distribuer les adresses/.test(x.title)));
  } finally { v.stop(); Object.assign(R.RESEAU, ORIGINE); if (cle === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = cle; }
});

test('R4 relecture · au démarrage d\'Odin, rien n\'écoute tant que la vérification n\'est pas finie (aucune fenêtre où Odin sert sans avoir vérifié)', async () => {
  const w = await monde();
  let home = '';
  try { assert.equal((await w.act('dhcp_demarrer')).ok, true); home = w.home; } finally { w.v.stop(); }
  const w2 = await monde({ home });
  try {
    let lacher = () => {};
    R.RESEAU.chercher = async (c, p) => { w2.recherches.push({ carte: c.nom, ...p }); await new Promise<void>((ok) => { lacher = ok; }); return { serveurs: [...w2.S.autres] }; };
    const depart = w2.v.module('vidarr')!.start!(w2.ctx) as Promise<void>;
    await souffle();
    assert.deepEqual([w2.recherches.length, w2.ecoutes.length, w2.allume()], [1, 0, false], 'la question est posée, rien n\'écoute encore');
    // La box répond à la question : Odin ne s'allume pas, et c'est une coupure (il ne réessaiera pas tout seul).
    w2.S.autres = [BOX]; lacher(); await depart;
    assert.deepEqual([w2.ecoutes.length, w2.allume(), w2.garde().etat], [0, false, 'coupe']);
    w2.S.autres = []; R.RESEAU.chercher = async () => ({ serveurs: [] }); await w2.minute(3);
    assert.deepEqual([w2.ecoutes.length, w2.allume()], [0, false], 'jamais de reprise toute seule');
  } finally { w2.fin(); }
});
