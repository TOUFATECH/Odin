// Vortex · relecture du lot R7 (sûreté du VPN). Ce que ces essais tiennent :
//  - la recherche de la box ne fait JAMAIS demander à Odin une page hors du réseau de la maison (ni un site d'Internet,
//    ni un service de la machine d'Odin), et l'adresse où partent les demandes reste sur la box ;
//  - un appareil de la maison qui répond à la place de la box ne change pas l'adresse de la maison : Odin ne garde tout
//    seul que la réponse de sa passerelle connue ; sinon rien n'est changé, et c'est au propriétaire de l'écrire ;
//  - une adresse réservée n'est pas une adresse de la maison ;
//  - changer le port du tunnel ou refermer le port de la box prévient (tout le monde est coupé, toi compris par le VPN) ;
//    un port mal écrit est refusé avant de toucher au tunnel ; l'ancien port ne reste pas ouvert sur la box ;
//  - une date de fin déjà passée ne coupe pas l'appareil que tu tiens sans que tu le dises.
// Rien de vrai ici : le moteur, la box et les commandes sont simulés ; la seule prise réseau est une fausse box sur la
// machine d'essai elle-même (127.0.0.1), comme dans test/upnp.test.ts. Adresses d'exemple seulement.
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { BOX, VU, gjoll, keypair, type Peer, type Server } from '../src/valhalla/modules/gjoll.ts';
import * as VUE from '../src/valhalla/gjoll/vue.ts';
import * as UPNP from '../src/valhalla/upnp.ts';
import type { EnDirect, VueVpn } from '../src/valhalla/gjoll/vue.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { setVerificateur } from '../src/valhalla/sso/acces.ts';
import { origineDemande } from '../src/valhalla/vidarr/appareils.ts';

const T0 = new Date(2026, 10, 24, 14, 0, 0).getTime();
const MAISON = '10.0.0.50', DEHORS = '198.51.100.23', BOITE_IP = '10.0.0.1', INTRUS = '10.0.0.66';
const ORIGINE = { ...VU }, BOITE = { ...BOX }, dossiers: string[] = [];
after(() => { Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
// Les fonctions ajoutées par la relecture, lues sans casser le chargement si elles manquent.
const hoteDeBox = (h: string, boucle?: boolean): boolean | undefined => (UPNP as unknown as { hoteDeBox?: (h: string, b?: boolean) => boolean }).hoteDeBox?.(h, boucle);
const adressePublique = (v: unknown): boolean | undefined => (VUE as unknown as { adressePublique?: (v: unknown) => boolean }).adressePublique?.(v);
const estLaBox = (h: unknown, p: string): boolean | undefined => (VUE as unknown as { estLaBox?: (h: unknown, p: string) => boolean }).estLaBox?.(h, p);

/** Un Odin d'essai avec Vortex seul ; le moteur, la box et les commandes sont simulés et comptés. */
function monde() {
  const home = mkdtempSync(join(tmpdir(), 'vortex-r7r-')); dossiers.push(home);
  const S = { now: T0, direct: new Map<string, EnDirect>(), passerelle: BOITE_IP, repondeur: BOITE_IP, box: (async () => ({ ip: '203.0.113.7', nom: 'Box' })) as () => Promise<{ ip: string; nom: string }>, portes: [] as string[], sorties: [] as string[], commandes: [] as string[], ouvre: { hote: BOITE_IP, ip: '203.0.113.7', text: 'Box : port ouvert vers Odin (essai).' } };
  VU.allume = () => false; VU.direct = () => S.direct; VU.flux = () => [];
  (BOX as unknown as { passerelle: () => Promise<string> }).passerelle = async () => S.passerelle;
  BOX.adresse = (async () => ({ hote: S.repondeur, ...(await S.box()) })) as never;
  BOX.ouvrir = (async (ports: Array<{ port: number; proto: string }>) => { S.portes.push(`ouvrir ${ports.map((p) => `${p.port}/${p.proto}`).join(',')}`); return { gw: { host: S.ouvre.hote }, ip: S.ouvre.ip, cgnat: false, lease: 0, text: S.ouvre.text }; }) as never;
  BOX.fermer = (async (ports: Array<{ port: number; proto: string }>) => { S.portes.push(`fermer ${ports.map((p) => `${p.port}/${p.proto}`).join(',')}`); return 'Box : refermé (essai).'; }) as never;
  setVerificateur(() => undefined);
  const v = new Valhalla(home, [gjoll], {
    run: async (c: string, a: string[]) => { S.commandes.push(`${c} ${a.join(' ')}`); return { code: 1, out: '', err: '' }; },
    fetch: (async (u: unknown) => { S.sorties.push(String(u)); throw new Error('aucun réseau dans les essais'); }) as never,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(S.now),
  } as never);
  const g = v.ctx('gjoll');
  g.saveSettings({ on: false, server: { ...keypair(), net: '10.8.0', port: 51820, endpoint: '[ADRESSE PUBLIQUE OU DOMAINE]', dns: '10.0.0.2', iface: 'wg-essai', lan: ['10.0.0.0/24'], nat: 'aucun' } });
  const serveur = () => g.settings.server as Server, pair = (nom: string) => ((g.settings.peers as Peer[] | undefined) ?? []).find((p) => p.name === nom)!;
  const ajouter = async (nom: string) => { const r = await v.act('gjoll', 'ajouter', { nom, dns_odin: false }); assert.equal(r.ok, true, r.text); return pair(nom); };
  const depuis = <T>(adresse: string, f: () => Promise<T>): Promise<T> => origineDemande.run(adresse, f);
  const agir = (action: string, input: Record<string, unknown> = {}, adresse = MAISON) => depuis(adresse, () => v.act('gjoll', action, input));
  const grave = (action: string, input: Record<string, unknown>, adresse: string) => origineDemande.run(adresse, () => gjoll.actions.find((x) => x.id === action)!.grave?.(input, v.ctx('gjoll')) ?? '');
  const tunnel = async () => ((await agir('appareils_vus')).data as VueVpn).tunnel!;
  return { v, g, S, serveur, pair, ajouter, agir, grave, tunnel, fin: () => { v.stop(); Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); } };
}

test('R7 · relecture · pur : ce qui peut être une box, ce qui est une adresse de la maison sur Internet, qui est la box', () => {
  // Une box : une adresse IPv4 privée écrite en chiffres. Jamais un nom, jamais une adresse d'Internet ; la machine elle-même seulement dans les essais.
  assert.deepEqual(['10.0.0.1', '192.168.1.254', '172.16.0.1', '172.31.255.254', '169.254.1.1'].map((h) => hoteDeBox(h)), [true, true, true, true, true]);
  assert.deepEqual(['203.0.113.9', '8.8.8.8', '172.32.0.1', '100.64.0.1', 'box.example.org', 'localhost', '127.0.0.1', '::1', '10.0.0.1.example.org', '10.0.0', '10.0.0.999', '0x0a.0.0.1', ''].map((h) => hoteDeBox(h)), Array(13).fill(false));
  assert.deepEqual([hoteDeBox('127.0.0.1', true), hoteDeBox('203.0.113.9', true)], [true, false]);
  // L'adresse de la maison : ni privée, ni partagée par l'opérateur, ni réservée.
  assert.deepEqual(['203.0.113.7', '198.51.100.20', '41.213.10.2', '100.128.0.1', '198.20.0.1'].map(adressePublique), [true, true, true, true, true]);
  assert.deepEqual(['10.0.0.1', '192.168.1.254', '172.20.1.1', '100.72.1.5', '169.254.10.1', '192.0.0.8', '198.18.0.5', '198.19.255.1', '127.0.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', 'maison.example.org', '<b>', ''].map(adressePublique), Array(15).fill(false));
  // La box, c'est la passerelle connue (ou la machine d'essai elle-même) ; une passerelle inconnue ne reconnaît personne.
  assert.deepEqual([estLaBox(BOITE_IP, BOITE_IP), estLaBox('127.0.0.1', ''), estLaBox(INTRUS, BOITE_IP), estLaBox(BOITE_IP, ''), estLaBox('', ''), estLaBox(undefined, BOITE_IP)], [true, true, false, false, false, false]);
});

/** Une fausse réponse à la recherche de la box, sur la machine d'essai : elle annonce l'adresse de description voulue. */
async function annonce(location: string) {
  const s = dgram.createSocket('udp4');
  s.on('message', (_m, de) => s.send(Buffer.from(`HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: ${location}\r\n\r\n`), de.port, de.address));
  await new Promise<void>((ok) => s.bind(0, '127.0.0.1', () => ok()));
  return { port: s.address().port, fin: () => s.close() };
}
const DESCRIPTION = (controle: string, base = '') => `<?xml version="1.0"?><root><device><friendlyName>Box</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>${controle}</controlURL></service></serviceList></device>${base ? `<URLBase>${base}</URLBase>` : ''}</root>`;

test('R7 · relecture : la recherche de la box ne fait demander à Odin aucune page hors du réseau de la maison, et les demandes restent sur la box', async () => {
  const chercher = async (location: string, description: string, plus: { hote?: string } = {}) => {
    const a = await annonce(location), demandes: string[] = [];
    const f = (async (u: unknown) => { demandes.push(String(u)); return new Response(description); }) as unknown as typeof fetch;
    try { const gw = await UPNP.discover({ fetch: f, timeoutMs: 150, target: { host: '127.0.0.1', port: a.port }, ...plus } as never).then((g) => g, (e: Error) => e); return { gw, demandes }; } finally { a.fin(); }
  };
  // Un site d'Internet, une adresse d'Internet, un nom à résoudre, un compte dans l'adresse : rien n'est demandé.
  for (const loc of ['http://example.org/desc.xml', 'http://203.0.113.9/desc.xml', 'https://203.0.113.9:8443/desc.xml', 'http://box.example.org:5000/desc.xml', 'http://odin:secret@127.0.0.1:9/desc.xml', 'ftp://127.0.0.1/desc.xml']) {
    const r = await chercher(loc, DESCRIPTION('/ctl'));
    assert.ok(r.gw instanceof Error, loc); assert.deepEqual(r.demandes, [], `${loc} : aucune page demandée`);
  }
  // La description envoie les demandes ailleurs (adresse complète, ou base ailleurs) : la box n'est pas retenue, rien ne part ailleurs.
  for (const d of [DESCRIPTION('http://203.0.113.9/ctl'), DESCRIPTION('/ctl', 'http://example.org/'), DESCRIPTION('//203.0.113.9/ctl')]) {
    const r = await chercher('http://127.0.0.1:9/desc.xml', d);
    assert.ok(r.gw instanceof Error); assert.deepEqual(r.demandes, ['http://127.0.0.1:9/desc.xml']);
  }
  // « Seulement la passerelle connue » : une autre adresse qui répond n'est même pas lue.
  { const r = await chercher('http://127.0.0.1:9/desc.xml', DESCRIPTION('/ctl'), { hote: BOITE_IP }); assert.ok(r.gw instanceof Error); assert.deepEqual(r.demandes, []); }
  // Une vraie box (ici la machine d'essai) : retenue, ses demandes restent chez elle.
  { const r = await chercher('http://127.0.0.1:9/desc.xml', DESCRIPTION('/ctl')); assert.ok(!(r.gw instanceof Error), String(r.gw)); assert.deepEqual([(r.gw as { host: string }).host, (r.gw as { control: string }).control], ['127.0.0.1', 'http://127.0.0.1:9/ctl']); }
});

test('R7 · relecture : un appareil de la maison qui répond à la place de la box ne change pas l\'adresse de la maison', async () => {
  const w = monde();
  try {
    const libre = '[ADRESSE PUBLIQUE OU DOMAINE]';
    // Première lecture, et c'est un autre appareil que la passerelle qui répond : rien n'est gardé, c'est dit, à toi de l'écrire.
    w.S.repondeur = INTRUS; w.S.box = async () => ({ ip: '203.0.113.66', nom: '<b>Box</b>' });
    let r = await w.agir('detecter');
    assert.equal(r.ok, false); assert.deepEqual(r.data, { code: 'a_confirmer', ip: '203.0.113.66' });
    assert.match(r.text, /^L'appareil 10\.0\.0\.66 du réseau \(« bBox\/b »\) dit que l'adresse de la maison est 203\.0\.113\.66, mais Odin ne peut pas vérifier que c'est bien ta box \(ta box est à 10\.0\.0\.1\)\. Rien n'est changé\. Si c'est la bonne adresse, écris-la toi-même/);
    assert.doesNotMatch(r.text, /[<>]/); assert.equal(w.serveur().endpoint, libre);
    let t = await w.tunnel(); assert.deepEqual([t.adresse, t.trouvee, t.box?.ok, t.box?.ip], ['', '', false, '203.0.113.66']); assert.match(t.box!.texte, /ne peut pas vérifier que c'est bien ta box/);
    // Odin ne connaît pas sa passerelle (pas sous Linux, pas de route) : même la « bonne » adresse n'est pas gardée toute seule.
    w.S.passerelle = ''; w.S.repondeur = BOITE_IP;
    r = await w.agir('detecter'); assert.equal(r.ok, false); assert.match(r.text, /^L'appareil 10\.0\.0\.1 du réseau .* mais Odin ne peut pas vérifier que c'est bien ta box\. Rien n'est changé\./); assert.equal(w.serveur().endpoint, libre);
    // Une adresse est déjà là : l'appareil qui se fait passer pour la box ne la remplace pas.
    assert.equal((await w.agir('adresse', { adresse: '198.51.100.20', port: 51820 })).ok, true);
    w.S.passerelle = BOITE_IP; w.S.repondeur = INTRUS;
    r = await w.agir('detecter'); assert.equal(r.ok, false); assert.equal(w.serveur().endpoint, '198.51.100.20'); assert.equal((await w.tunnel()).trouvee, 'main');
    // Il redit l'adresse que tu as écrite : rien à changer, et elle reste « écrite à la main ».
    w.S.box = async () => ({ ip: '198.51.100.20', nom: 'Box' });
    r = await w.agir('detecter'); assert.equal(r.ok, true, r.text); assert.doesNotMatch(r.text, /Elle a changé/); t = await w.tunnel(); assert.deepEqual([t.adresse, t.trouvee], ['198.51.100.20', 'main']);
    // La passerelle connue répond : là, l'adresse est gardée (et le changement est dit).
    w.S.repondeur = BOITE_IP; w.S.box = async () => ({ ip: '203.0.113.7', nom: 'Box' });
    r = await w.agir('detecter'); assert.equal(r.ok, true, r.text); assert.match(r.text, /Elle a changé \(avant : 198\.51\.100\.20\)/); t = await w.tunnel(); assert.deepEqual([t.adresse, t.trouvee, t.box?.ok], ['203.0.113.7', 'box', true]);
    // Une adresse réservée n'est pas une adresse de la maison, même venue de la passerelle.
    for (const ip of ['169.254.10.1', '198.18.0.5', '192.0.0.8', '100.72.1.5', '10.0.0.1']) {
      w.S.box = async () => ({ ip, nom: 'Box' });
      r = await w.agir('detecter'); assert.equal(r.ok, false, ip); assert.match(r.text, /ce n'est pas une adresse Internet à elle/, ip); assert.equal(w.serveur().endpoint, '203.0.113.7', ip);
    }
    assert.deepEqual(w.S.sorties, [], 'pas une demande vers Internet');
  } finally { w.fin(); }
});

test('R7 · relecture : « ouvrir le port » ne prend pas l\'adresse donnée par un autre appareil que la box ; ce que dit la box est nettoyé', async () => {
  const w = monde();
  try {
    const libre = '[ADRESSE PUBLIQUE OU DOMAINE]';
    w.S.ouvre = { hote: INTRUS, ip: '203.0.113.66', text: `Box « <b>Ma${String.fromCharCode(0x202e)}box</b>${String.fromCharCode(7)} » : 51820/UDP ouvert vers Odin.` };
    let r = await w.agir('ouvrir_port');
    assert.equal(r.ok, true, r.text); assert.equal(w.serveur().endpoint, libre, 'l\'adresse d\'un inconnu n\'est pas gardée');
    assert.doesNotMatch(r.text, new RegExp(`[<>${String.fromCharCode(0x202e, 7)}]`), 'ni balise, ni caractère caché');
    // Une adresse réservée, même donnée par la box : pas gardée.
    w.S.ouvre = { hote: BOITE_IP, ip: '198.18.0.5', text: 'Box : ouvert.' };
    r = await w.agir('ouvrir_port'); assert.equal(r.ok, true); assert.equal(w.serveur().endpoint, libre);
    // La box (la passerelle connue) : gardée, dite « lue sur la box ».
    w.S.ouvre = { hote: BOITE_IP, ip: '203.0.113.7', text: 'Box : ouvert.' };
    r = await w.agir('ouvrir_port'); assert.equal(r.ok, true); assert.equal(w.serveur().endpoint, '203.0.113.7'); assert.equal((await w.tunnel()).trouvee, 'box');
  } finally { w.fin(); }
});

test('R7 · relecture : changer le port ou refermer la box prévient (toi compris par le VPN) ; un port mal écrit est refusé ; l\'ancien port ne reste pas ouvert', async () => {
  const w = monde();
  try {
    const tel = await w.ajouter('Téléphone 1'); w.S.direct.set(tel.pub, { handshake: T0 - 12_000, rx: 1, tx: 2, endpoint: `${DEHORS}:40123` });
    assert.equal((await w.agir('adresse', { adresse: '203.0.113.7', port: 51820 })).ok, true);
    // Un port mal écrit éteindrait le tunnel pour tout le monde : refusé, rien n'est changé.
    for (const port of [99999, 70000, 51820.5, -4]) {
      const r = await w.agir('adresse', { adresse: '203.0.113.7', port }); assert.equal(r.ok, false, String(port)); assert.match(r.text, /port entre 1 et 65535/); assert.equal(w.serveur().port, 51820);
    }
    { const r = await w.agir('serveur', { port: 51820.5, mtu: '', keepalive: 25 }); assert.equal(r.ok, false); assert.match(r.text, /port entre 1 et 65535/); assert.equal(w.serveur().port, 51820); }
    { const r = await w.agir('adresse', { adresse: '...', port: 51820 }); assert.equal(r.ok, false); assert.match(r.text, /adresse ou domaine invalide/); assert.equal(w.serveur().endpoint, '203.0.113.7'); }
    // Changer le port : la confirmation dit que tout le monde est coupé ; et « toi » quand tu passes par le VPN ou qu'Odin ne sait pas.
    const tous = /⚠ Tous les appareils connectés sont coupés d'un coup : chacun doit reprendre son QR code ou son fichier\./;
    for (const [action, input] of [['adresse', { adresse: '203.0.113.7', port: 51999 }], ['serveur', { port: 51999, mtu: '', keepalive: 25 }]] as Array<[string, Record<string, unknown>]>) {
      assert.match(w.grave(action, input, MAISON), tous, action); assert.doesNotMatch(w.grave(action, input, MAISON), /tu passes par le VPN|ne sait pas/);
      for (const o of [tel.ip, DEHORS]) assert.match(w.grave(action, input, o), /coupés d'un coup.* ATTENTION : tu passes par le VPN en ce moment, tu vas te couper d'Odin/, `${action} depuis ${o}`);
      assert.match(w.grave(action, input, ''), /coupés d'un coup.* Odin ne sait pas depuis quel appareil tu agis/);
      assert.equal(w.grave(action, input, tel.ip).split('⚠').length, 2, 'un seul avertissement, d\'un bloc (la page le montre en rouge)');
    }
    // Le même port : pas d'alarme.
    assert.doesNotMatch(w.grave('serveur', { port: 51820, mtu: '', keepalive: 30 }, tel.ip), /⚠/); assert.equal(w.grave('adresse', { adresse: '203.0.113.7', port: 51820 }, tel.ip), '');
    // Refermer le port de la box : de dehors, tu te coupes.
    assert.equal(w.grave('fermer_port', {}, MAISON), 'refermer le port du VPN : plus d\'accès à la maison depuis l\'extérieur');
    assert.match(w.grave('fermer_port', {}, tel.ip), /⚠ ATTENTION : tu passes par le VPN en ce moment/); assert.match(w.grave('fermer_port', {}, ''), /⚠ Odin ne sait pas depuis quel appareil tu agis/);
    // Odin a ouvert 51820 sur la box ; le port du tunnel change : l'ancien est refermé, rien ne reste ouvert pour rien.
    assert.equal((await w.agir('ouvrir_port')).ok, true); assert.deepEqual(w.S.portes, ['ouvrir 51820/UDP']);
    { const r = await w.agir('eteindre'); assert.equal(r.ok, true); assert.match(r.text, /^⏹ Tunnel coupé\. Le port du VPN reste ouvert sur la box \(plus rien n'y répond\) : « Fermer le port sur la box » le referme\.$/); }
    let r = await w.agir('adresse', { adresse: '203.0.113.7', port: 51999 });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /L'ancien port 51820 est refermé sur la box\./); assert.deepEqual(w.S.portes, ['ouvrir 51820/UDP', 'fermer 51820/UDP']);
    assert.deepEqual([w.serveur().port, w.g.settings.upnp, w.g.settings.portOpened], [51999, undefined, false]); assert.equal((await w.tunnel()).portBox, 'non');
    { const x = await w.agir('eteindre'); assert.equal(x.text, '⏹ Tunnel coupé.'); }
    // La box ne répond plus au moment de refermer : c'est dit, le changement est fait quand même.
    assert.equal((await w.agir('ouvrir_port')).ok, true);
    BOX.fermer = (async () => { throw new Error('aucune box ne répond en UPnP'); }) as never;
    r = await w.agir('serveur', { port: 52000, mtu: '', keepalive: 25 });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /⚠ L'ancien port 51999 est peut-être resté ouvert sur la box \(aucune box ne répond en UPnP\) : referme-le dans l'interface de la box\./); assert.equal(w.serveur().port, 52000);
    assert.equal(w.S.commandes.some((c) => /^(wg|nft|iptables)\b/.test(c)), false); assert.deepEqual(w.S.sorties, []);
  } finally { w.fin(); }
});

test('R7 · relecture : une date de fin déjà passée ne coupe pas l\'appareil que tu tiens sans que tu le dises', async () => {
  const w = monde();
  try {
    const tel = await w.ajouter('Téléphone 1'); await w.ajouter('Portable 1'); w.S.direct.set(tel.pub, { handshake: T0 - 12_000, rx: 1, tx: 2, endpoint: `${DEHORS}:40123` });
    const hier = { nouveau_nom: '', tout: 'inchangé', maillage: 'inchangé', dns_odin: 'inchangé', fin: '2026-11-01' };
    for (const o of [tel.ip, DEHORS]) {
      const r = await w.agir('modifier', { nom: 'Téléphone 1', ...hier }, o);
      assert.equal(r.ok, false, o); assert.deepEqual(r.data, { code: 'ici' }); assert.match(r.text, /^Attention : « Téléphone 1 » est l'appareil que tu tiens en ce moment\..*Rien n'est fait\./); assert.equal(w.pair('Téléphone 1').expires, undefined);
    }
    // Une date à venir, ou un autre appareil : fait sans histoire. Dit en clair : fait.
    assert.equal((await w.agir('modifier', { nom: 'Téléphone 1', ...hier, fin: '2099-01-01' }, tel.ip)).ok, true); assert.equal(w.pair('Téléphone 1').expires, '2099-01-01');
    assert.equal((await w.agir('modifier', { nom: 'Portable 1', ...hier }, tel.ip)).ok, true); assert.equal(w.pair('Portable 1').expires, '2026-11-01');
    assert.equal((await w.agir('modifier', { nom: 'Téléphone 1', ...hier, le_mien: true }, tel.ip)).ok, true); assert.equal(w.pair('Téléphone 1').expires, '2026-11-01');
  } finally { w.fin(); }
});

test('R7 · relecture : plus aucune trace de l\'ancien service d\'adresse dans la page « hors ligne », ni dans Vortex', () => {
  const lire = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  for (const f of ['../src/web/pages/hors-ligne.js', '../src/web/pages/vortex.js', '../src/valhalla/modules/gjoll.ts', '../src/valhalla/gjoll/vue.ts', '../src/valhalla/upnp.ts']) {
    assert.doesNotMatch(lire(f), /ipify|ifconfig\.|icanhazip|checkip|myip|ipinfo|ip-api/i, f);
    assert.doesNotMatch(lire(f), new RegExp(`[${String.fromCharCode(0x2028, 0x2029, 13, 0x200b, 0x202e, 0xfeff)}]`), `${f} : ni caractère caché, ni retour chariot`);
  }
});
