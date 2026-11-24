// Vortex · Appareils et tunnel, lot R7 (le serveur) : ce que la page montre de chaque appareil du VPN (connecté ou non,
// dernière connexion, depuis où, trafic du jour) SANS JAMAIS une clé ; « couper » (réversible) et « retirer » (sa clé ne
// vaut plus rien) avec le garde-fou (jamais l'appareil que tu tiens sans que tu le dises, un avertissement quand Odin ne
// sait pas d'où tu agis) ; l'adresse de la maison LUE SUR LA BOX : plus aucun site extérieur, et si la box ne répond pas
// c'est dit et l'adresse reste à écrire à la main ; un membre ne voit que les appareils de son compte, rien du tunnel.
// Rien de vrai ici : le moteur du tunnel, la box (UPnP), les commandes et les sorties vers Internet sont SIMULÉS (aucune
// commande wg, ip ou nft, aucun paquet). Adresses d'exemple : 198.51.100.x, 203.0.113.x, 192.0.2.x ; maison en 10.0.0.x
// (comme la maquette) ; réseau du VPN par défaut 10.8.0.x.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { BOX, VU, gjoll, keypair, serverConf, type Peer, type Server } from '../src/valhalla/modules/gjoll.ts';
import { adresseBoxSure, avisOrigine, gardeVpn, hoteDe, nomVpn, ouEst, trouverPair, vueVpn, type EnDirect, type TunnelVpn, type VueVpn } from '../src/valhalla/gjoll/vue.ts';
import type { Flow } from '../src/valhalla/wireguard/engine.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import { origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import { REFUS } from './reseau-r1-commun.ts';

const T0 = new Date(2026, 10, 24, 14, 0, 0).getTime(), MIN = 60_000;
const MAISON = '10.0.0.50', DEHORS = '198.51.100.23', PIEGE = '<img src=x onerror=alert(1)>Tel';
const ORIGINE = { ...VU }, BOITE = { ...BOX }, dossiers: string[] = [];
after(() => { Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

/** Un Odin d'essai avec Vortex seul ; le moteur, la box, les commandes et Internet sont simulés et comptés. */
function monde() {
  const home = mkdtempSync(join(tmpdir(), 'vortex-r7-')); dossiers.push(home);
  const S = { now: T0, allume: true, direct: new Map<string, EnDirect>(), flux: [] as Flow[], box: (async () => { throw new Error('aucune box ne répond en UPnP'); }) as () => Promise<{ ip: string; nom: string }>, appelsBox: 0, sorties: [] as string[], commandes: [] as string[], passerelle: '10.0.0.1', repondeur: '10.0.0.1' };
  VU.allume = () => S.allume; VU.direct = () => S.direct; VU.flux = () => S.flux;
  // La passerelle connue de la machine, et l'appareil qui répond à la place de la box (le même : c'est bien la box).
  BOX.passerelle = async () => S.passerelle;
  BOX.adresse = async () => { S.appelsBox++; return { hote: S.repondeur, ...(await S.box()) }; };
  BOX.ouvrir = (async () => { throw new Error('pas dans cet essai'); }) as never; BOX.fermer = (async () => { throw new Error('pas dans cet essai'); }) as never;
  setVerificateur(() => undefined);
  const v = new Valhalla(home, [gjoll], {
    run: async (c: string, a: string[]) => { S.commandes.push(`${c} ${a.join(' ')}`); return { code: 1, out: '', err: '' }; },
    fetch: (async (u: unknown) => { S.sorties.push(String(u)); throw new Error('aucun réseau dans les essais'); }) as never,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(S.now),
  } as never);
  const g = v.ctx('gjoll');
  g.saveSettings({ on: false, server: { ...keypair(), net: '10.8.0', port: 51820, endpoint: '[ADRESSE PUBLIQUE OU DOMAINE]', dns: '10.0.0.2', iface: 'wg-essai', lan: ['10.0.0.0/24'], nat: 'aucun' } });
  const pairs = () => (g.settings.peers as Peer[] | undefined) ?? [];
  const pair = (nom: string) => pairs().find((p) => p.name === nom)!;
  const ajouter = async (nom: string, plus: Record<string, unknown> = {}) => { const r = await v.act('gjoll', 'ajouter', { nom, dns_odin: false, ...plus }); assert.equal(r.ok, true, r.text); return pair(nom); };
  /** L'appareil vient de se connecter depuis cette adresse (ce que dirait le moteur). */
  const connecte = (nom: string, de: string, il_y_a = 12_000) => { S.direct.set(pair(nom).pub, { handshake: S.now - il_y_a, rx: 1000, tx: 2000, endpoint: `${de}:40123` }); };
  /** Une demande faite depuis cette adresse (comme la porte web la pose), « '' » : origine inconnue. */
  const depuis = <T>(adresse: string | undefined, f: () => Promise<T>): Promise<T> => (adresse === undefined ? f() : origineDemande.run(adresse, f));
  const vue = async (adresse?: string) => { const r = await depuis(adresse, () => v.act('gjoll', 'appareils_vus')); assert.equal(r.ok, true, r.text); return { r, d: r.data as VueVpn }; };
  const grave = (action: string, input: Record<string, unknown>, adresse?: string) => { const a = gjoll.actions.find((x) => x.id === action)!, f = () => a.grave?.(input, v.ctx('gjoll')); return adresse === undefined ? f() : origineDemande.run(adresse, f); };
  const secrets = () => [...pairs().flatMap((p) => [p.priv ?? '', p.psk, p.pub]), (g.settings.server as Server).priv].filter((x) => x.length > 20);
  return { v, g, S, pairs, pair, ajouter, connecte, depuis, vue, grave, secrets, fin: () => { v.stop(); Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); } };
}
const flux = (device: string, up: number, down: number): Flow => ({ device, deviceIp: '10.8.0.2', proto: 'TCP', remote: '203.0.113.80', port: 443, up, down, pkUp: 1, pkDown: 1, first: T0, last: T0 });
const TUNNEL: TunnelVpn = { allume: true, moteur: '', port: 51820, adresse: '203.0.113.7', trouvee: 'box', box: null, portBox: 'odin', reseau: '10.8.0.0/24', maison: ['10.0.0.0/24'], dns: '10.0.0.2' };

test('R7 · pur : l\'adresse vue par le tunnel, « maison » ou « dehors » sans rien demander à personne, l\'adresse que donne la box', () => {
  assert.deepEqual(['198.51.100.23:40123', '[::ffff:198.51.100.23]:51820', '[2001:db8::7]:4000', '2001:db8::7:4000', '10.0.0.50:1', '', 'pas une adresse:1', '<b>:80'].map(hoteDe), ['198.51.100.23', '198.51.100.23', '2001:db8::7', '2001:db8::7', '10.0.0.50', '', '', '']);
  assert.deepEqual(['10.0.0.50', '192.168.1.20', '172.20.1.1', '127.0.0.1', 'fe80::1', '198.51.100.23', '203.0.113.88', '2001:db8::7', ''].map(ouEst), ['maison', 'maison', 'maison', 'maison', 'maison', 'dehors', 'dehors', 'dehors', '']);
  // La box répond un texte : gardé seulement si c'est une adresse IPv4 bien écrite.
  assert.deepEqual(['203.0.113.7', ' 198.51.100.20 ', '203.0.113.7<script>', '999.1.1.1', '0.0.0.0', '127.0.0.1', '239.1.1.1', 'maison.example.org', '', undefined, '203.0.113.7\n198.51.100.1'].map(adresseBoxSure), ['203.0.113.7', '198.51.100.20', '', '', '', '', '', '', '', '', '']);
  // Un nom d'appareil est toujours nettoyé ; on retrouve l'appareil par son nom exact, ou par son nom montré s'il est seul.
  assert.equal(nomVpn(PIEGE), 'img src=x onerror=alert(1)Tel'); assert.equal(nomVpn('  '), 'Appareil sans nom'); assert.equal(nomVpn(`a${String.fromCharCode(0x2028)}b${String.fromCharCode(7)}c`), 'a b c');
  const l = [{ name: PIEGE }, { name: 'Tablette' }, { name: 'Tab<lette' }];
  assert.equal(trouverPair(l, PIEGE), l[0]); assert.equal(trouverPair(l, nomVpn(PIEGE)), l[0]); assert.equal(trouverPair(l, 'Tablette'), l[1]);
  assert.equal(trouverPair(l, 'Tab&lette'), undefined, 'deux appareils montrés sous le même nom : jamais « le premier qui ressemble »'); assert.equal(trouverPair(l, ''), undefined); assert.equal(trouverPair(l, 'Inconnu'), undefined);
});

test('R7 · pur : la vue ne contient JAMAIS une clé ; l\'appareil que tu tiens est reconnu par son adresse dans le VPN ou par l\'adresse d\'où il est connecté', () => {
  const k1 = keypair(), k2 = keypair(), psk = 'A'.repeat(43) + '=';
  const pairs = [{ name: 'Téléphone 1', ...k1, psk, ip: '10.8.0.2', created: '', enabled: true, full: true, compte: 'nour' }, { name: 'Portable 1', ...k2, psk, ip: '10.8.0.3', created: '', enabled: true, full: false, expires: '2026-11-30' }];
  const direct = new Map<string, EnDirect>([[k1.pub, { handshake: T0 - 12_000, rx: 1, tx: 2, endpoint: `${DEHORS}:40123` }], [k2.pub, { handshake: T0 - 10 * MIN, rx: 0, tx: 0, endpoint: '10.0.0.77:5' }]]);
  const base = { pairs, direct, derniers: {}, trafic: new Map([['Téléphone 1', { up: 180, down: 1200 }]]), now: T0, tunnel: TUNNEL };
  const v = vueVpn({ ...base, origine: MAISON });
  assert.deepEqual(v.appareils.map((d) => [d.nom, d.ip, d.etat, d.connecte, d.depuis, d.ou, d.recu, d.envoye, d.acces, d.fin, d.ici]), [['Téléphone 1', '10.8.0.2', 'connecte', true, DEHORS, 'dehors', 1200, 180, 'tout', '', false], ['Portable 1', '10.8.0.3', 'absent', false, '10.0.0.77', 'maison', 0, 0, 'maison', '2026-11-30', false]]);
  assert.deepEqual(v.chiffres, { connectes: 1, appareils: 2, coupes: 0, recu: 1200, envoye: 180 }); assert.deepEqual([v.proprietaire, v.origineConnue, v.limite], [true, true, '']);
  const texte = JSON.stringify(v);
  for (const s of [k1.priv, k1.pub, k2.priv, k2.pub, psk]) assert.equal(texte.includes(s), false, 'aucune clé dans la vue');
  assert.doesNotMatch(texte, /"(priv|psk|pub|compte)"/);
  // « C'est l'appareil que tu tiens » : par son adresse dans le VPN, ou par l'adresse d'où il est connecté en ce moment.
  assert.deepEqual(vueVpn({ ...base, origine: '10.8.0.3' }).appareils.map((d) => d.ici), [false, true]);
  assert.deepEqual(vueVpn({ ...base, origine: `::ffff:${DEHORS}` }).appareils.map((d) => d.ici), [true, false]);
  assert.deepEqual(vueVpn({ ...base, origine: '10.0.0.77' }).appareils.map((d) => d.ici), [false, false], 'une ancienne adresse d\'un appareil qui n\'est plus connecté ne compte pas');
  assert.deepEqual([vueVpn({ ...base, origine: '' }).origineConnue, vueVpn({ ...base, origine: '' }).appareils.some((d) => d.ici)], [false, false]);
  // Un accès terminé, un accès coupé.
  const fini = vueVpn({ ...base, origine: MAISON, now: new Date(2026, 11, 2).getTime(), pairs: [{ ...pairs[1], enabled: false }, { ...pairs[0], enabled: false }] });
  assert.deepEqual(fini.appareils.map((d) => d.etat), ['fini', 'coupe']); assert.equal(fini.chiffres.coupes, 2);
  // Un membre : ses appareils seulement, rien du tunnel.
  const m = vueVpn({ ...base, origine: MAISON, membre: 'nour' });
  assert.deepEqual([m.proprietaire, m.appareils.map((d) => d.nom), m.tunnel, m.allume], [false, ['Téléphone 1'], null, true]); assert.match(m.limite, /rattachés à ton compte/);
  assert.match(vueVpn({ ...base, origine: MAISON, membre: 'awa' }).limite, /^Aucun appareil du VPN n'est rattaché à ton compte\./);
  // Le garde-fou et l'avertissement.
  assert.deepEqual(gardeVpn({ ici: false, nom: 'Tel' }, 'couper'), {}); assert.deepEqual(gardeVpn(undefined, 'retirer'), {}); assert.deepEqual(gardeVpn({ ici: true, nom: 'Tel' }, 'retirer', { leMien: true }), {});
  assert.equal(gardeVpn({ ici: true, nom: 'Tel' }, 'couper').code, 'ici'); assert.match(gardeVpn({ ici: true, nom: 'Tel' }, 'retirer').refus!, /« Tel » est l'appareil que tu tiens en ce moment.*sa clé ne vaudrait plus rien.*Rien n'est fait/);
  assert.match(avisOrigine({ ici: true }, true), /c'est l'appareil que tu tiens/); assert.match(avisOrigine({ ici: false }, false), /Odin ne sait pas depuis quel appareil tu agis/); assert.equal(avisOrigine({ ici: false }, true), '');
});

test('R7 : la lecture de la page — chaque appareil, connecté ou non, dernière connexion, depuis où, trafic du jour ; le tunnel ; aucune clé, nulle part', async () => {
  const w = monde();
  try {
    await w.ajouter('Téléphone 1'); await w.ajouter('Portable 1', { tout: false }); await w.ajouter('Invité', { tout: false, fin: '2026-11-30' });
    w.g.saveSettings({ peers: [...w.pairs(), { name: PIEGE, ...keypair(), psk: w.pair('Invité').psk, ip: '10.8.0.9', created: '', enabled: false, full: true }] });
    w.connecte('Téléphone 1', DEHORS); w.connecte('Portable 1', '10.0.0.77', 10 * MIN);
    w.S.flux = [flux('Téléphone 1', 180, 1200), flux('Portable 1', 42, 310)];
    const { r, d } = await w.vue(MAISON);
    assert.deepEqual(d.appareils.map((x) => [x.nom, x.ip, x.etat, x.depuis, x.ou, x.recu, x.envoye, x.acces, x.fin]), [
      ['Téléphone 1', '10.8.0.2', 'connecte', DEHORS, 'dehors', 1200, 180, 'tout', ''], ['Portable 1', '10.8.0.3', 'absent', '10.0.0.77', 'maison', 310, 42, 'maison', ''],
      ['Invité', '10.8.0.4', 'jamais', '', '', 0, 0, 'maison', '2026-11-30'], ['img src=x onerror=alert(1)Tel', '10.8.0.9', 'coupe', '', '', 0, 0, 'tout', '']]);
    assert.deepEqual([d.appareils[0].vu, d.appareils[1].vu, d.appareils[2].vu], [T0 - 12_000, T0 - 10 * MIN, 0]);
    assert.deepEqual(d.chiffres, { connectes: 1, appareils: 4, coupes: 1, recu: 1510, envoye: 222 });
    assert.deepEqual(d.tunnel, { allume: true, moteur: '', port: 51820, adresse: '', trouvee: '', box: null, portBox: 'non', reseau: '10.8.0.0/24', maison: ['10.0.0.0/24'], dns: '10.0.0.2' });
    assert.deepEqual([d.proprietaire, d.origineConnue, d.limite, d.allume], [true, true, '', true]);
    assert.match(r.text, /^Tunnel allumé · adresse de la maison pas encore connue\.\n- Téléphone 1 \(10\.8\.0\.2\) · connecté · dernière connexion .* depuis 198\.51\.100\.23 · reçu 1\.2 Ko · envoyé 180 o\n/);
    assert.doesNotMatch(r.text, /[<>]/, 'un nom n\'apporte jamais de balise');
    // Aucune clé : ni dans cette lecture, ni dans les autres lectures ouvertes de Vortex.
    for (const id of ['appareils_vus', 'appareils', 'trafic']) { const x = JSON.stringify(await w.v.act('gjoll', id)); for (const s of w.secrets()) assert.equal(x.includes(s), false, `${id} : aucune clé`); assert.doesNotMatch(x, /PrivateKey|PresharedKey|"priv"|"psk"/); }
    // C'est une lecture : rien n'est écrit, rien n'est lancé, rien ne sort.
    const a = gjoll.actions.find((x) => x.id === 'appareils_vus')!; assert.deepEqual([a.read, a.external, typeof a.proprietaireSeul], [true, true, 'function']);
    const avant = JSON.stringify(w.g.settings); await w.vue(MAISON); await w.vue(MAISON); assert.equal(JSON.stringify(w.g.settings), avant, 'lire ne change rien');
    // D'où se connectent les appareils et l'adresse de la maison ne partent ni vers une automatisation, ni vers un assistant,
    // ni dans une conversation marquée : la lecture est au propriétaire en personne (ou à un membre, avec sa vue réduite).
    for (const o of [{ auto: true, by: 'automatisation' }, { auto: true, by: 'assistant' }, { by: 'réflexe' }, { by: 'odin' }, { qui: 'member' }, { qui: 'guest' }, { qui: 'owner', marque: true }] as Array<Parameters<Valhalla['act']>[3]>) {
      const r2 = await w.v.act('gjoll', 'appareils_vus', {}, o); assert.equal(r2.ok, false, JSON.stringify(o)); assert.match(r2.text, REFUS); assert.equal(r2.data, undefined);
    }
    // Et elle ne remplit pas le journal « qui a fait quoi » (la page la relit toutes les 5 secondes).
    assert.doesNotMatch(JSON.stringify((await w.v.act('gjoll', 'qui_a_fait', { n: 100 })).data), /la page/);
    assert.deepEqual([w.S.sorties, w.S.appelsBox], [[], 0]); assert.equal(w.S.commandes.some((c) => /^(wg|nft|iptables)\b/.test(c)), false);
  } finally { w.fin(); }
});

test('R7 : la dernière connexion est gardée — tunnel éteint, la carte dit encore quand et depuis où', async () => {
  const w = monde();
  try {
    await w.ajouter('Téléphone 1'); w.connecte('Téléphone 1', DEHORS);
    const r = await w.depuis(MAISON, () => w.v.act('gjoll', 'eteindre')); assert.equal(r.ok, true, r.text);
    w.S.allume = false; w.S.direct = new Map(); w.S.now += 3 * 24 * 3600_000;
    const { d } = await w.vue(MAISON);
    assert.deepEqual(d.appareils.map((x) => [x.nom, x.etat, x.connecte, x.vu, x.depuis, x.ou]), [['Téléphone 1', 'absent', false, T0 - 12_000, DEHORS, 'dehors']]); assert.equal(d.allume, false);
    assert.deepEqual(w.g.settings.derniers, { [w.pair('Téléphone 1').pub]: { t: T0 - 12_000, de: DEHORS } });
    assert.equal(w.S.commandes.some((c) => /^(wg|nft|iptables|sh)\b/.test(c)), false, 'aucune commande réseau');
  } finally { w.fin(); }
});

test('R7 : « couper » est réversible et libre quand Odin sait que ce n\'est pas l\'appareil que tu tiens ; « rouvrir » nomme l\'appareil ; un appareil inconnu n\'est jamais « fait »', async () => {
  const w = monde();
  try {
    await w.ajouter('Téléphone 1'); await w.ajouter('Portable 1'); w.connecte('Téléphone 1', DEHORS);
    assert.equal(w.grave('activer', { nom: 'Portable 1', actif: false }, MAISON), undefined, 'couper reste libre depuis la maison');
    const r = await w.depuis(MAISON, () => w.v.act('gjoll', 'activer', { nom: 'Portable 1', actif: false }));
    assert.equal(r.ok, true, r.text); assert.match(r.text, /^⏸ Désactivé : Portable 1\n/);
    assert.deepEqual(w.pairs().map((p) => [p.name, p.enabled]), [['Téléphone 1', true], ['Portable 1', false]]);
    assert.doesNotMatch(serverConf(w.g.settings.server as Server, w.pairs()), new RegExp(w.pair('Portable 1').pub.replace(/[+/=]/g, '\\$&')), 'coupé : le tunnel ne le connaît plus');
    assert.equal(w.pair('Portable 1').priv!.length > 20 && w.pair('Portable 1').psk.length > 20, true, 'sa clé est gardée : il pourra être rouvert');
    assert.equal(w.grave('activer', { nom: 'Portable 1', actif: true }, MAISON), 'rouvrir l\'accès au VPN de la maison pour l\'appareil « Portable 1 »');
    assert.equal((await w.depuis(MAISON, () => w.v.act('gjoll', 'activer', { nom: 'Portable 1', actif: true }))).ok, true); assert.equal(w.pair('Portable 1').enabled, true);
    // Inconnu : refusé (avant, c'était « fait » sans rien faire).
    for (const [a, i] of [['activer', { nom: 'Fantôme', actif: false }], ['activer', { nom: 'Fantôme', actif: true }], ['revoquer', { nom: 'Fantôme' }]] as Array<[string, Record<string, unknown>]>) { const x = await w.depuis(MAISON, () => w.v.act('gjoll', a, i)); assert.equal(x.ok, false, a); assert.match(x.text, /appareil introuvable/); }
    assert.equal(w.pairs().length, 2);
    // Un accès terminé ne se rouvre pas d'un clic : il lui faut une nouvelle date.
    w.g.saveSettings({ peers: w.pairs().map((p) => (p.name === 'Portable 1' ? { ...p, enabled: false, expires: '2026-11-01' } : p)) });
    const f = await w.depuis(MAISON, () => w.v.act('gjoll', 'activer', { nom: 'Portable 1', actif: true })); assert.equal(f.ok, false); assert.match(f.text, /est terminé depuis le 2026-11-01.*nouvelle date de fin.*Rien n'est changé/); assert.equal(w.pair('Portable 1').enabled, false);
  } finally { w.fin(); }
});

test('R7 · garde-fou : l\'appareil que tu tiens n\'est ni coupé ni retiré tant que tu ne l\'as pas dit en clair ; origine inconnue : la confirmation prévient', async () => {
  const w = monde();
  try {
    const tel = await w.ajouter('Téléphone 1'); await w.ajouter('Portable 1'); w.connecte('Téléphone 1', DEHORS);
    // Par son adresse dans le VPN, puis par l'adresse d'où il est connecté.
    for (const origine of [tel.ip, DEHORS]) {
      assert.match(w.grave('activer', { nom: 'Téléphone 1', actif: false }, origine) ?? '', /^couper l'accès au VPN de « Téléphone 1 » \(tu pourras le rouvrir\) ⚠ ATTENTION : c'est l'appareil que tu tiens en ce moment, tu vas te couper d'Odin\.$/);
      assert.match(w.grave('revoquer', { nom: 'Téléphone 1' }, origine) ?? '', /^révoquer l'accès VPN de « Téléphone 1 » : sa clé ne vaudra plus rien, il faudra l'ajouter de nouveau ⚠ ATTENTION : c'est l'appareil que tu tiens/);
      for (const [a, i] of [['activer', { nom: 'Téléphone 1', actif: false }], ['revoquer', { nom: 'Téléphone 1' }]] as Array<[string, Record<string, unknown>]>) {
        const r = await w.depuis(origine, () => w.v.act('gjoll', a, i));
        assert.equal(r.ok, false, `${a} depuis ${origine}`); assert.deepEqual(r.data, { code: 'ici' }); assert.match(r.text, /^Attention : « Téléphone 1 » est l'appareil que tu tiens en ce moment\..*Rien n'est fait\./);
      }
      assert.deepEqual(w.pairs().map((p) => [p.name, p.enabled]), [['Téléphone 1', true], ['Portable 1', true]], 'rien n\'a bougé');
      // L'autre appareil, lui, se coupe sans histoire.
      assert.equal(w.grave('activer', { nom: 'Portable 1', actif: false }, origine), undefined);
    }
    // Origine inconnue (derrière un proxy, ou hors de la page) : la confirmation prévient, pour couper comme pour retirer.
    for (const origine of ['', undefined]) {
      assert.match(w.grave('activer', { nom: 'Portable 1', actif: false }, origine) ?? '', /^couper l'accès au VPN de « Portable 1 » \(tu pourras le rouvrir\) ⚠ Odin ne sait pas depuis quel appareil tu agis : si c'est celui que tu tiens, tu perds Odin avec lui\.$/);
      assert.match(w.grave('revoquer', { nom: 'Portable 1' }, origine) ?? '', /⚠ Odin ne sait pas depuis quel appareil tu agis/);
      assert.match(w.grave('eteindre', {}, origine) ?? '', /^couper le VPN pour tous les appareils ⚠ Odin ne sait pas depuis quel appareil tu agis : si tu passes par le VPN, tu perds Odin avec lui\.$/);
    }
    assert.equal(w.grave('revoquer', { nom: 'Portable 1' }, MAISON), 'révoquer l\'accès VPN de « Portable 1 » : sa clé ne vaudra plus rien, il faudra l\'ajouter de nouveau');
    // Éteindre le tunnel : prévenu quand tu passes par lui.
    assert.equal(w.grave('eteindre', {}, MAISON), 'couper le VPN pour tous les appareils');
    for (const origine of [tel.ip, '10.8.0.200', DEHORS]) assert.match(w.grave('eteindre', {}, origine) ?? '', /⚠ ATTENTION : tu passes par le VPN en ce moment, tu vas te couper d'Odin et tu ne pourras pas le rallumer de dehors\.$/, origine);
    // Dit en clair : fait.
    const c = await w.depuis(tel.ip, () => w.v.act('gjoll', 'activer', { nom: 'Téléphone 1', actif: false, le_mien: true })); assert.equal(c.ok, true, c.text); assert.equal(w.pair('Téléphone 1').enabled, false);
    // Le nom d'une confirmation est nettoyé, même quand l'appareil n'existe pas.
    assert.doesNotMatch(w.grave('revoquer', { nom: PIEGE }, MAISON) ?? '', /[<>]/); assert.doesNotMatch(w.grave('activer', { nom: PIEGE, actif: true }, MAISON) ?? '', /[<>]/);
  } finally { w.fin(); }
});

test('R7 : « retirer » — sa clé ne vaut plus rien : le tunnel ne le connaît plus, sa dernière connexion est oubliée, l\'autre appareil n\'est pas touché', async () => {
  const w = monde();
  try {
    await w.ajouter('Téléphone 1'); const tab = await w.ajouter('Tablette 2'); w.connecte('Tablette 2', '203.0.113.88'); w.connecte('Téléphone 1', DEHORS);
    await w.depuis(MAISON, () => w.v.act('gjoll', 'eteindre')); // garde les dernières connexions
    assert.deepEqual(Object.keys(w.g.settings.derniers as object).length, 2);
    const r = await w.depuis(MAISON, () => w.v.act('gjoll', 'revoquer', { nom: 'Tablette 2' }));
    assert.equal(r.ok, true, r.text); assert.match(r.text, /^🗝 Accès de Tablette 2 révoqué : sa clé ne vaut plus rien\.\n/);
    assert.deepEqual(w.pairs().map((p) => p.name), ['Téléphone 1']);
    const tout = JSON.stringify(w.g.settings); for (const s of [tab.pub, tab.priv!, tab.psk]) assert.equal(tout.includes(s), false, 'plus aucune trace de sa clé dans Vortex');
    assert.deepEqual(Object.keys(w.g.settings.derniers as object), [w.pair('Téléphone 1').pub]);
    assert.equal(serverConf(w.g.settings.server as Server, w.pairs()).includes(tab.pub), false);
    // Retiré par son nom montré (nettoyé) quand il est seul à le porter.
    w.g.saveSettings({ peers: [...w.pairs(), { name: PIEGE, ...keypair(), psk: tab.psk, ip: '10.8.0.9', created: '', enabled: true, full: true }] });
    const p = await w.depuis(MAISON, () => w.v.act('gjoll', 'revoquer', { nom: nomVpn(PIEGE) })); assert.equal(p.ok, true, p.text); assert.deepEqual(w.pairs().map((x) => x.name), ['Téléphone 1']);
    // « Qui a fait quoi » : noté, sans aucune clé.
    const j = JSON.stringify((await w.v.act('gjoll', 'qui_a_fait', { n: 50 })).data); assert.match(j, /Révoquer/); for (const s of w.secrets()) assert.equal(j.includes(s), false);
  } finally { w.fin(); }
});

test('R7 : l\'adresse de la maison est LUE SUR LA BOX — plus aucun site extérieur ; la box muette : c\'est dit, et l\'adresse reste à la main', async () => {
  const w = monde();
  try {
    const adresse = () => (w.g.settings.server as Server).endpoint, tunnel = async () => (await w.vue(MAISON)).d.tunnel!;
    // La box ne répond pas.
    let r = await w.depuis(MAISON, () => w.v.act('gjoll', 'detecter'));
    assert.equal(r.ok, false); assert.match(r.text, /La box ne répond pas \(aucune box ne répond en UPnP\)\. Odin ne demande cette adresse à aucun site extérieur : écris-la à la main \(« Adresse de la maison » : l'adresse, ou un nom de domaine\)\. Rien n'est changé\./);
    assert.equal(adresse(), '[ADRESSE PUBLIQUE OU DOMAINE]'); assert.deepEqual(w.S.sorties, [], 'AUCUNE demande vers Internet'); assert.equal(w.S.appelsBox, 1);
    let t = await tunnel(); assert.deepEqual([t.adresse, t.trouvee, t.box?.ok, t.box?.quand], ['', '', false, T0]); assert.match(t.box!.texte, /^La box ne répond pas/);
    // À la main : c'est noté « à la main ».
    assert.equal((await w.depuis(MAISON, () => w.v.act('gjoll', 'adresse', { adresse: '198.51.100.20', port: 51820 }))).ok, true);
    t = await tunnel(); assert.deepEqual([t.adresse, t.trouvee], ['198.51.100.20', 'main']);
    // La box répond n'importe quoi, ou une adresse qui n'est pas à elle : refusé, rien n'est changé.
    for (const [rep, dit] of [['<script>alert(1)</script>', /sans adresse lisible/], ['', /sans adresse lisible/], ['100.72.1.5', /La box dit 100\.72\.1\.5 : ce n'est pas une adresse Internet à elle/], ['192.168.1.254', /ce n'est pas une adresse Internet à elle/], ['10.0.0.1', /ce n'est pas une adresse Internet à elle/]] as Array<[string, RegExp]>) {
      w.S.box = async () => ({ ip: rep, nom: 'Box' });
      r = await w.depuis(MAISON, () => w.v.act('gjoll', 'detecter')); assert.equal(r.ok, false, rep); assert.match(r.text, dit); assert.match(r.text, /Rien n'est changé\./); assert.doesNotMatch(r.text, /[<>]/);
      assert.equal(adresse(), '198.51.100.20'); assert.equal((await tunnel()).trouvee, 'main');
    }
    // La box donne l'adresse : gardée, dite « lue sur la box », et le changement est dit (les appareils déjà ajoutés).
    w.S.box = async () => ({ ip: '203.0.113.7', nom: '<b>Box</b> de la maison' }); w.S.now += MIN;
    r = await w.depuis(MAISON, () => w.v.act('gjoll', 'detecter'));
    assert.equal(r.ok, true, r.text);
    assert.match(r.text, /^🌍 Adresse de la maison lue sur la box « bBox\/b de la maison » : 203\.0\.113\.7 \(aucun site extérieur interrogé\)\. Les appareils joindront 203\.0\.113\.7:51820\. Elle a changé \(avant : 198\.51\.100\.20\) : les appareils déjà ajoutés ne joignent plus la maison tant qu'ils n'ont pas repris leur QR code ou leur fichier\./);
    assert.doesNotMatch(r.text, /[<>]/, 'le nom que la box se donne est nettoyé');
    t = await tunnel(); assert.deepEqual([adresse(), t.adresse, t.trouvee, t.box?.ok, t.box?.ip, t.box?.quand], ['203.0.113.7', '203.0.113.7', 'box', true, '203.0.113.7', T0 + MIN]);
    // La même adresse relue : rien n'a « changé ».
    r = await w.depuis(MAISON, () => w.v.act('gjoll', 'detecter')); assert.equal(r.ok, true); assert.doesNotMatch(r.text, /Elle a changé/);
    // Un nom de domaine mis à la main est gardé : la box ne l'écrase pas.
    assert.equal((await w.depuis(MAISON, () => w.v.act('gjoll', 'adresse', { adresse: 'maison.example.org', port: 51820 }))).ok, true);
    r = await w.depuis(MAISON, () => w.v.act('gjoll', 'detecter'));
    assert.equal(r.ok, true); assert.match(r.text, /Tu as mis un nom de domaine \(maison\.example\.org\) : il est gardé, rien n'est changé\./); assert.equal(adresse(), 'maison.example.org'); assert.equal((await tunnel()).trouvee, 'main');
    // Du début à la fin : pas une seule demande vers Internet, pas une commande réseau.
    assert.deepEqual(w.S.sorties, []); assert.equal(w.S.commandes.some((c) => /^(wg|nft|iptables)\b/.test(c)), false);
    // Et dans le code : plus de service d'adresse publique.
    const src = readFileSync(new URL('../src/valhalla/modules/gjoll.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/valhalla/gjoll/vue.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /ipify|ifconfig\.|icanhazip|checkip|myip|ipinfo|ip-api|geoip|ctx\.fetch\(\s*['"`]https?:/i, 'aucun site extérieur pour l\'adresse ni pour « depuis où »');
    assert.doesNotMatch(src, new RegExp(`[${String.fromCharCode(0x2028, 0x2029, 13)}]`), 'ni séparateur de ligne Unicode, ni retour chariot');
  } finally { w.fin(); }
});

test('R7 : un membre de la famille ne voit que les appareils de son compte, rien du tunnel ; il ne coupe, ne retire, n\'allume ni ne règle rien', async () => {
  const w = monde();
  try {
    await w.ajouter('Téléphone 1'); await w.ajouter('Téléphone de Nour'); w.connecte('Téléphone 1', DEHORS);
    w.g.saveSettings({ peers: w.pairs().map((p) => (p.name === 'Téléphone de Nour' ? { ...p, compte: 'nour' } : p)), adresseSource: 'main', server: { ...(w.g.settings.server as Server), endpoint: '203.0.113.7' } });
    const nour = { login: 'nour', name: 'Nour', groups: ['famille'] }, awa = { login: 'awa', name: 'Awa', groups: ['famille'] };
    const r = await auNomDe(nour, () => w.depuis(MAISON, () => w.v.act('gjoll', 'appareils_vus'))), d = r.data as VueVpn;
    assert.equal(r.ok, true, r.text);
    assert.deepEqual([d.proprietaire, d.tunnel, d.appareils.map((x) => x.nom), d.chiffres.appareils], [false, null, ['Téléphone de Nour'], 1]);
    assert.match(d.limite, /^Tu ne vois que les appareils du VPN rattachés à ton compte\./);
    const texte = JSON.stringify(r); assert.doesNotMatch(texte, /203\.0\.113\.7|198\.51\.100\.23|Téléphone 1|10\.0\.0\.0/, 'ni l\'adresse de la maison, ni les appareils des autres');
    const a = await auNomDe(awa, () => w.v.act('gjoll', 'appareils_vus')); assert.deepEqual((a.data as VueVpn).appareils, []); assert.match(a.text, /^Aucun appareil du VPN n'est rattaché à ton compte\./);
    // Les gestes : refusés, même sur son propre appareil ; rien ne bouge.
    const avant = JSON.stringify(w.g.settings);
    for (const [id, i] of [['activer', { nom: 'Téléphone de Nour', actif: false }], ['activer', { nom: 'Téléphone 1', actif: false, le_mien: true }], ['revoquer', { nom: 'Téléphone de Nour' }], ['eteindre', {}], ['detecter', {}], ['adresse', { adresse: '198.51.100.99', port: 51820 }]] as Array<[string, Record<string, unknown>]>) {
      const x = await auNomDe(nour, () => w.v.act('gjoll', id, i)); assert.equal(x.ok, false, id); assert.match(x.text, REFUS, id);
    }
    assert.equal(JSON.stringify(w.g.settings), avant); assert.equal(w.S.appelsBox, 0);
  } finally { w.fin(); }
});
