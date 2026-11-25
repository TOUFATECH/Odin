// Sphinx · Noms et enregistrements (maquette « Réseau » validée, écran « DNS · Noms »). Ce qui est essayé ici :
//  - la règle PURE (vidarr/noms.ts) : un nom écrit dans n'importe quelle langue que le DNS accepte (rangé sous sa forme
//    ASCII « xn-- », montré dans sa langue) ; les noms piégés refusés (espaces, caractères invisibles, sens d'écriture
//    caché, « % », « / », un nom qui est en fait une adresse) ; chaque sorte d'enregistrement (adresse, alias, joker,
//    texte) et sa valeur vérifiée ; pas de doublon ; pas de conflit avec un nom automatique (DHCP) ni avec celui d'Odin ;
//    un joker seulement sous le nom de la maison ; un nom d'Internet dit avant d'être remplacé pour la maison ;
//  - la liste des noms : automatiques (DHCP, adresse fixe), à la main, ceux d'Odin ; les sortes comptées ; l'inverse
//    (adresse → nom) donné tout seul pour les adresses de la maison ;
//  - dans Sphinx : la lecture « noms_vus » (rien n'est écrit), « nom_local » et « retirer_nom » vérifiés, au propriétaire
//    seul, avec une question avant de remplacer, de retirer ou de répondre à la place d'Internet ; « qui a fait quoi » ;
//    un membre ne voit que les noms de l'appareil qu'il tient ; le serveur DNS répond (question posée en mémoire : AUCUN
//    paquet, aucune prise réseau).
// Adresses d'exemple seulement (192.0.2.x, 198.51.100.x, 2001:db8::), MAC de la plage de documentation.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MSG, buildPacket, parsePacket, type DhcpConfig, type Packet } from '../src/valhalla/vidarr/dhcp.ts';
import { LOCAL, origineDemande } from '../src/valhalla/vidarr/appareils.ts';
import { PRISE_DHCP, dhcpServer, nomsServis, reglagesServis, vidarr } from '../src/valhalla/modules/vidarr.ts';
import { listeNoms, nomPropre, sorteDe, verifierNom, type EntreeNoms, type VerdictNom } from '../src/valhalla/vidarr/noms.ts';
import { DEFAULTS, DnsServer } from '../src/valhalla/vidarr/server.ts';
import { TYPE, RCODE, dataText, parse, query } from '../src/valhalla/vidarr/wire.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { auNomDe, setVerificateur } from '../src/valhalla/sso/acces.ts';
import { REFUS, SPHINX } from './reseau-r1-commun.ts';

const BOX = '192.0.2.1', ODIN = '192.0.2.2', H = 3600_000, T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
const M = { odin: '00:00:5e:00:53:02', scan: '00:00:5e:00:53:30', pc: '00:00:5e:00:53:23', tel: '02:00:5e:00:53:14' };
const entreeNoms = (plus: Partial<EntreeNoms> = {}): EntreeNoms => ({
  domaine: 'maison', main: { 'disque.maison': ['192.0.2.40'] },
  automatiques: [{ nom: 'scanner.maison', ip: '192.0.2.30', origine: 'fixe', qui: 'Scanner' }, { nom: 'pc-salle.maison', ip: '192.0.2.120', origine: 'dhcp', qui: 'PC salle' }, { nom: 'odin.maison', ip: ODIN, origine: 'odin', qui: 'Odin' }],
  ...plus,
});
const verif = (nom: unknown, valeur: unknown, sorte: unknown = 'a', plus: Partial<EntreeNoms> & { remplacer?: boolean } = {}): VerdictNom => verifierNom({ ...entreeNoms(plus), nom, valeur, sorte, remplacer: plus.remplacer });

// ------------------------------------------------------------------ la règle pure
test('Noms · un nom dans toutes les langues que le DNS accepte : rangé en ASCII, montré dans sa langue', () => {
  const cas: Array<[string, string, string]> = [
    ['café.maison', 'xn--caf-dma.maison', 'café.maison'], ['ДОМ.maison', 'xn--d1aqf.maison', 'дом.maison'], ['مطبخ.maison', 'xn--ngbmz9c.maison', 'مطبخ.maison'],
    ['厨房.maison', 'xn--inr825a.maison', '厨房.maison'], ['dari-la-mwana.maison', 'dari-la-mwana.maison', 'dari-la-mwana.maison'], ['Salon.Maison.', 'salon.maison', 'salon.maison'],
    ['xn--caf-dma.maison', 'xn--caf-dma.maison', 'café.maison'], ['lecteur_2', 'lecteur_2', 'lecteur_2'], ['रसोई.maison', 'xn--o1b3fya0f.maison', 'रसोई.maison'],
  ];
  for (const [tape, ascii, unicode] of cas) { const n = nomPropre(tape); assert.deepEqual([n.ok, n.ascii, n.unicode], [true, ascii, unicode], tape); }
  const j = nomPropre('*.Atelier.maison'); assert.deepEqual([j.ok, j.ascii, j.joker], [true, '*.atelier.maison', true]);
});

test('Noms · les noms piégés sont refusés, et le message ne répète jamais ce qui a été tapé', () => {
  const pieges: unknown[] = ['', '   ', 'a b.maison', 'a/b.maison', 'ex%41mple.maison', 'foo\u200b.maison', 'dom.\u202e.maison', '\u00ad', 'a..maison', '.maison', '-a.maison', 'a-.maison',
    `${'x'.repeat(64)}.maison`, `${'abcdefghi.'.repeat(26)}maison`, '<b>x</b>.maison', 'x.maison\n', '1.2.3', '192.0.2.24', '0x7f.1', 'a.12', 'lecteur.0x1', '*', '*.', 'a.*.maison', '**.maison',
    'localhost', 'x.localhost', '24.2.0.192.in-addr.arpa', 'lecteur.local', null, undefined, 42, ['x.maison'], { toString: () => 'x.maison' }];
  for (const p of pieges) {
    const n = nomPropre(p); assert.equal(n.ok, false, `refusé : ${JSON.stringify(String(p))}`); assert.equal(n.ascii, '');
    const v = verif(p, '192.0.2.50'); assert.equal(v.ok, false, `refusé : ${JSON.stringify(String(p))}`);
    assert.doesNotMatch(v.message, /<b>|%41|0x7f|\u202e|\u200b|xxxxxxxx|abcdefghi/, v.message);
  }
  // Le nom de la maison lui-même n'est pas un nom de machine.
  for (const n of ['maison', 'Maison.']) assert.deepEqual([verif(n, '192.0.2.50').ok, verif(n, '192.0.2.50').code], [false, 'reserve'], n);
});

test('Noms · une adresse : IPv4 ou IPv6 bien écrites ; ni nulle, ni boucle locale, ni diffusion, ni multidiffusion', () => {
  for (const [ip, attendu] of [['192.0.2.50', ['192.0.2.50']], ['2001:DB8::50', ['2001:db8::50']], ['192.0.2.50, 2001:db8::50', ['192.0.2.50', '2001:db8::50']], ['198.51.100.7', ['198.51.100.7']]] as const) {
    const v = verif('lecteur.maison', ip); assert.deepEqual([v.ok, v.to], [true, attendu], `${ip} : ${v.message}`);
  }
  for (const ip of ['', '192.0.2', '192.0.2.300', '192.0.2.024', '192.0.2.50/24', '0.0.0.0', '0.1.2.3', '127.0.0.1', '224.0.0.1', '239.1.1.1', '255.255.255.255', '::', '::1', 'ff02::1', 'fe80::1%eth0', 'lecteur.maison', '192.0.2.50; rm', '１９２.0.2.50']) {
    const v = verif('lecteur.maison', ip); assert.deepEqual([v.ok, v.code], [false, 'valeur'], `${JSON.stringify(ip)} : ${v.message}`);
  }
  assert.equal(verif('lecteur.maison', Array.from({ length: 9 }, (_x, k) => `192.0.2.${50 + k}`).join(',')).ok, false, 'au plus 8 adresses');
  assert.equal(verif('v6.maison', '2001:db8::7').sorte, 'aaaa');
  assert.equal(verif('v4.maison', '192.0.2.7').sorte, 'a');
});

test('Noms · alias, joker, texte : chaque sorte et sa valeur', () => {
  let v = verif('galerie.maison', 'Disque.Maison', 'alias'); assert.deepEqual([v.ok, v.sorte, v.to], [true, 'alias', ['disque.maison']]);
  v = verif('galerie.maison', 'café.maison', 'alias'); assert.deepEqual([v.ok, v.to], [true, ['xn--caf-dma.maison']]);
  for (const x of ['galerie.maison', '192.0.2.40', '*.atelier.maison', '', 'a b']) assert.equal(verif('galerie.maison', x, 'alias').ok, false, `alias vers ${x}`);
  v = verif('*.atelier.maison', '192.0.2.50', 'joker'); assert.deepEqual([v.ok, v.sorte, v.nom, v.to], [true, 'joker', '*.atelier.maison', ['192.0.2.50']]);
  v = verif('atelier.maison', '192.0.2.50', 'joker'); assert.deepEqual([v.ok, v.nom], [true, '*.atelier.maison'], 'le « *. » est ajouté');
  for (const n of ['*.maison', '*.example.com', '*.com']) { const r = verif(n, '192.0.2.50', 'joker'); assert.deepEqual([r.ok, r.code], [false, 'joker'], n); }
  assert.equal(verif('*.atelier.maison', '192.0.2.50', 'a').ok, false, 'un joker se dit « joker »');
  v = verif('note.maison', 'clé de la maison ; rangée là', 'texte'); assert.deepEqual([v.ok, v.sorte, v.to], [true, 'texte', ['TXT clé de la maison ; rangée là']]);
  for (const t of ['', '  ', 'a\u0000b', 'x'.repeat(256), 'é'.repeat(128)]) assert.deepEqual([verif('note.maison', t, 'texte').ok, verif('note.maison', t, 'texte').code], [false, 'valeur'], `texte de ${t.length}`);
  assert.equal(verif('x.maison', '192.0.2.5', 'inconnue').code, 'sorte');
});

test('Noms · pas de doublon, pas de conflit avec un nom automatique ni avec celui d\'Odin ; remplacer dit ce qui change', () => {
  let v = verif('Disque.maison', '192.0.2.41'); assert.deepEqual([v.ok, v.code, v.existe], [false, 'doublon', true]); assert.match(v.message, /existe déjà/);
  v = verif('disque.maison', '192.0.2.41', 'a', { remplacer: true }); assert.deepEqual([v.ok, v.existe], [true, true]);
  v = verif('neuf.maison', '192.0.2.41', 'a', { remplacer: true }); assert.deepEqual([v.ok, v.code], [false, 'introuvable']);
  for (const n of ['scanner.maison', 'scanner', 'PC-SALLE.maison', 'pc-salle']) { const r = verif(n, '192.0.2.99'); assert.deepEqual([r.ok, r.code], [false, 'automatique'], n); assert.match(r.message, /Appareils/); }
  assert.match(verif('scanner.maison', '192.0.2.99').message, /« Scanner »/);
  for (const n of ['odin.maison', 'odin', 'ODIN.maison.']) { const r = verif(n, '192.0.2.99'); assert.deepEqual([r.ok, r.code], [false, 'odin'], n); }
  // Changer un nom déjà ajouté à la main reste possible même si un appareil annonce depuis le même nom par le DHCP (le
  // nom à la main passe déjà avant dans le DNS : un appareil ne prend pas un nom au propriétaire) ; celui d'Odin, jamais.
  assert.equal(verif('scanner.maison', '192.0.2.99', 'a', { remplacer: true, main: { 'scanner.maison': ['192.0.2.31'] } }).ok, true);
  assert.equal(verif('scanner.maison', '192.0.2.99', 'a', { main: { 'scanner.maison': ['192.0.2.31'] } }).code, 'doublon');
  assert.equal(verif('odin.maison', '192.0.2.99', 'a', { remplacer: true, main: { 'odin.maison': ['192.0.2.31'] } }).code, 'odin');
  // Sans nom à la main du même nom : un nom automatique ne se prend toujours pas.
  assert.equal(verif('scanner.maison', '192.0.2.99', 'a', { remplacer: true }).code, 'automatique');
  // Un joker ne cache jamais un nom automatique (le DNS sert d'abord les noms exacts) : accepté.
  assert.equal(verif('*.atelier.maison', '192.0.2.50', 'joker', { automatiques: [{ nom: 'x.atelier.maison', ip: '192.0.2.60', origine: 'dhcp', qui: 'X' }] }).ok, true);
});

test('Noms · un nom d\'Internet n\'est remplacé que pour la maison, et c\'est dit avant', () => {
  let v = verif('banque.example.com', '192.0.2.66'); assert.deepEqual([v.ok, v.horsMaison], [true, true]); assert.match(v.avis.join(' '), /Internet/);
  v = verif('lecteur.maison', '192.0.2.66'); assert.deepEqual([v.ok, v.horsMaison, v.avis], [true, false, []]);
  v = verif('lecteur', '192.0.2.66'); assert.deepEqual([v.ok, v.horsMaison], [true, false], 'un nom sans point reste dans la maison');
  v = verif('x.maison.lan', '192.0.2.66', 'a', { domaine: 'maison.lan' }); assert.equal(v.horsMaison, false);
});

test('Noms · la liste : automatiques (DHCP, adresse fixe), à la main, Odin ; les sortes comptées ; l\'inverse pour les adresses de la maison', () => {
  const e = entreeNoms({ main: { 'disque.maison': ['192.0.2.40'], 'galerie.maison': ['disque.maison'], '*.atelier.maison': ['192.0.2.50'], 'note.maison': ['TXT bonjour'], 'v6.maison': ['2001:db8::6'], 'pc-salle.maison': ['192.0.2.121'], 'xn--caf-dma.maison': ['198.51.100.9'], 'mx.maison': ['MX 10 courrier.maison'] }, reseau: (ip) => ip.startsWith('192.0.2.') });
  const l = listeNoms({ ...e, derniere: (n) => (n === 'scanner.maison' ? T0 : undefined) });
  const ligne = (n: string, o?: string) => l.lignes.find((x) => x.ascii === n && (!o || x.origine === o))!;
  assert.deepEqual([ligne('scanner.maison').origine, ligne('scanner.maison').verrouille, ligne('scanner.maison').derniere, ligne('scanner.maison').qui], ['fixe', true, T0, 'Scanner']);
  assert.deepEqual([ligne('odin.maison').origine, ligne('odin.maison').verrouille], ['odin', true]);
  assert.deepEqual([ligne('disque.maison').origine, ligne('disque.maison').verrouille, ligne('disque.maison').sorte], ['main', false, 'a']);
  assert.deepEqual([ligne('galerie.maison').sorte, ligne('*.atelier.maison').sorte, ligne('note.maison').sorte, ligne('v6.maison').sorte, ligne('mx.maison').sorte], ['alias', 'joker', 'texte', 'aaaa', 'autre']);
  assert.equal(ligne('note.maison').valeur, 'bonjour');
  assert.equal(ligne('xn--caf-dma.maison').nom, 'café.maison');
  // Le nom à la main passe avant le nom automatique (comme dans le DNS) : c'est dit sur la ligne automatique.
  assert.deepEqual([ligne('pc-salle.maison', 'dhcp').remplace, ligne('pc-salle.maison', 'main').remplace], [true, false]);
  assert.deepEqual(l.comptes, { a: 5, aaaa: 1, alias: 1, joker: 1, inverse: 4, texte: 1, autre: 1 });
  // L'inverse : une adresse de la maison → un nom (Odin d'abord, puis à la main, puis adresse fixe, puis DHCP) ; jamais une adresse d'Internet.
  assert.deepEqual(l.inverses, [{ adresse: ODIN, nom: 'odin.maison' }, { adresse: '192.0.2.30', nom: 'scanner.maison' }, { adresse: '192.0.2.40', nom: 'disque.maison' }, { adresse: '192.0.2.121', nom: 'pc-salle.maison' }]);
  assert.equal(sorteDe('x.maison', ['192.0.2.1', '2001:db8::1']), 'a');
  assert.equal(sorteDe('x.maison', ['CNAME y.maison']), 'alias');
});

// ------------------------------------------------------------------ dans Sphinx
const dossiers: string[] = [], PRISE = PRISE_DHCP.ecouter, MACS = LOCAL.macs;
after(() => { PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const paquet = (mac: string, type: number, o: { nom?: string; veut?: string } = {}) => buildPacket({ op: 1, xid: 7, mac, options: [[53, Buffer.from([type])], ...(o.nom !== undefined ? [[12, Buffer.from(o.nom, 'utf8')] as [number, Buffer]] : []), ...(o.veut ? [[50, Buffer.from(o.veut.split('.').map(Number))] as [number, Buffer]] : [])] });
type Donnees = { proprietaire: boolean; limite: string; domaine: string; dns: { allume: boolean }; noms: Array<{ nom: string; ascii: string; origine: string; sorte: string; valeur: string; verrouille: boolean; derniere?: number }>; inverses: Array<{ adresse: string; nom: string }>; comptes: Record<string, number>; verdict: VerdictNom | null };

/** Un Odin d'essai avec Sphinx seul : aucune commande, aucune sortie réseau, la prise du DHCP simulée. */
async function monde() {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-noms-')); dossiers.push(home);
  const envois: Packet[] = []; const now = T0;
  PRISE_DHCP.ecouter = async (d) => { (d as unknown as { sock: unknown }).sock = { send: (b: Buffer) => { envois.push(parsePacket(b)); }, close: () => {} }; };
  LOCAL.macs = () => [M.odin]; setVerificateur(() => undefined);
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }), fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(now) });
  const ctx = v.ctx('vidarr');
  const cfg: DhcpConfig = { server: ODIN, start: '192.0.2.100', end: '192.0.2.199', mask: '255.255.255.0', router: BOX, dns: [ODIN], leaseSeconds: 12 * 3600, domain: 'maison', fixed: [] };
  ctx.saveSettings({ dhcp: cfg });
  assert.equal((await v.act('vidarr', 'dhcp_demarrer', { forcer: true })).ok !== false, true);
  const prend = (mac: string, nom: string) => { const n = envois.length; dhcpServer()!.onMessage(paquet(mac, MSG.DISCOVER, { nom })); const ip = envois[n].yiaddr; dhcpServer()!.onMessage(paquet(mac, MSG.REQUEST, { nom, veut: ip })); return ip; };
  const act = (a: string, i: Record<string, unknown> = {}, o?: Parameters<Valhalla['act']>[3]) => v.act('vidarr', a, i, o);
  const noms = async (i: Record<string, unknown> = {}) => { const r = await act('noms_vus', i); return { r, D: r.data as Donnees }; };
  const reecritures = () => JSON.stringify((ctx.settings.dns as { rewrites?: unknown } | undefined)?.rewrites ?? {});
  // Un serveur DNS en mémoire, avec les mêmes réglages et les mêmes noms que Sphinx : on lui pose la question, aucune prise.
  const dns = new DnsServer({ settings: () => reglagesServis(ctx), lists: () => [], local: () => nomsServis(ctx), fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch, now: () => now });
  const demande = async (nom: string, type: number) => { const out = (await dns.handle(query(nom, type, { id: 9 }), '192.0.2.150'))!; const m = parse(out); return { rcode: m.rcode, an: m.an.map((x) => dataText(out, x)) }; };
  return { v, ctx, prend, act, noms, reecritures, demande, fin: () => { v.stop(); PRISE_DHCP.ecouter = PRISE; LOCAL.macs = MACS; } };
}

test('Sphinx · aucune action nouvelle qui écrit ; « noms_vus » est une lecture ; ajouter, changer, retirer restent au propriétaire seul', async () => {
  const w = await monde();
  try {
    const m = w.v.module('vidarr')!, ecrit = m.actions.filter((a) => !a.read).map((a) => a.id).filter((id) => id !== 'qui_a_fait');
    assert.deepEqual(ecrit.filter((id) => !SPHINX.includes(id)), [], 'la liste exacte du lot R1 n\'a pas bougé');
    const a = m.actions.find((x) => x.id === 'noms_vus')!;
    assert.deepEqual([a.read, a.external, a.grave], [true, true, undefined]);
    assert.equal(typeof a.proprietaireSeul === 'function' && a.proprietaireSeul({}, undefined), true);
    assert.equal(auNomDe({ login: 'nour', name: 'Nour', groups: ['famille'] }, () => (a.proprietaireSeul as () => boolean)()), false);
    for (const id of ['nom_local', 'retirer_nom']) { const x = m.actions.find((y) => y.id === id)!; assert.equal(x.proprietaireSeul, true, id); assert.equal(typeof x.grave, 'function', `${id} : une question avant`); }
  } finally { w.fin(); }
});

test('Sphinx · les noms : automatiques depuis les baux du DHCP, adresse fixe, celui d\'Odin ; « noms_vus » n\'écrit rien', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-SALLE');
    assert.equal((await w.act('dhcp_fixe', { mac: M.scan, ip: '192.0.2.30', nom: 'Scanner' })).ok, true);
    const avant = JSON.stringify(w.ctx.settings);
    const { r, D } = await w.noms();
    assert.equal(r.ok, true); assert.equal(D.proprietaire, true); assert.equal(D.domaine, 'maison');
    const de = (n: string) => D.noms.find((x) => x.ascii === n);
    assert.deepEqual([de('pc-salle.maison')?.origine, de('pc-salle.maison')?.valeur, de('pc-salle.maison')?.verrouille], ['dhcp', ipPc, true]);
    assert.deepEqual([de('odin.maison')?.origine, de('odin.maison')?.valeur], ['odin', ODIN]);
    assert.equal(JSON.stringify(w.ctx.settings), avant, 'une lecture n\'écrit rien');
    assert.match(r.text, /pc-salle\.maison/);
    // Le DNS répond : le nom automatique, celui d'Odin, et l'inverse d'une adresse de la maison.
    assert.deepEqual(await w.demande('pc-salle.maison', TYPE.A), { rcode: RCODE.NOERROR, an: [ipPc] });
    assert.deepEqual(await w.demande('odin.maison', TYPE.A), { rcode: RCODE.NOERROR, an: [ODIN] });
    assert.deepEqual((await w.demande(`${ipPc.split('.').reverse().join('.')}.in-addr.arpa`, TYPE.PTR)).an, ['pc-salle.maison']);
    // Une adresse privée sans nom ne part toujours pas sur Internet.
    assert.equal((await w.demande('77.2.0.10.in-addr.arpa', TYPE.PTR)).rcode, RCODE.NXDOMAIN);
  } finally { w.fin(); }
});

test('Sphinx · ajouter un nom vérifié (toutes les langues) ; les refus n\'écrivent rien ; le DNS le sert', async () => {
  const w = await monde();
  try {
    w.prend(M.pc, 'PC-SALLE');
    let r = await w.act('nom_local', { nom: 'café.maison', valeur: '192.0.2.40', sorte: 'a' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /café\.maison → 192\.0\.2\.40/);
    assert.deepEqual(await w.demande('xn--caf-dma.maison', TYPE.A), { rcode: RCODE.NOERROR, an: ['192.0.2.40'] });
    r = await w.act('nom_local', { nom: 'note.maison', valeur: 'à lire', sorte: 'texte' }); assert.equal(r.ok, true, r.text);
    assert.deepEqual((await w.demande('note.maison', TYPE.TXT)).an, ['à lire']);
    r = await w.act('nom_local', { nom: 'atelier.maison', valeur: '192.0.2.50', sorte: 'joker' }); assert.equal(r.ok, true, r.text);
    assert.deepEqual((await w.demande('poste.atelier.maison', TYPE.A)).an, ['192.0.2.50']);
    r = await w.act('nom_local', { nom: 'galerie.maison', valeur: 'café.maison', sorte: 'alias' }); assert.equal(r.ok, true, r.text);
    assert.deepEqual((await w.demande('galerie.maison', TYPE.A)).an, ['xn--caf-dma.maison', '192.0.2.40']);
    const avant = w.reecritures();
    for (const [i, re] of [
      [{ nom: 'café.maison', valeur: '192.0.2.41', sorte: 'a' }, /existe déjà/], [{ nom: 'pc-salle.maison', valeur: '192.0.2.41', sorte: 'a' }, /Appareils/],
      [{ nom: 'odin.maison', valeur: '192.0.2.41', sorte: 'a' }, /Odin/], [{ nom: '*.com', valeur: '192.0.2.41', sorte: 'joker' }, /joker/i],
      [{ nom: 'x\u202e.maison', valeur: '192.0.2.41', sorte: 'a' }, /nom/i], [{ nom: 'y.maison', valeur: '127.0.0.1', sorte: 'a' }, /adresse/i],
      [{ nom: 'y.maison', valeur: '192.0.2.41', sorte: 'a', remplacer: true }, /introuvable|n'existe pas/],
    ] as Array<[Record<string, unknown>, RegExp]>) { const x = await w.act('nom_local', i); assert.equal(x.ok, false, JSON.stringify(i)); assert.match(x.text, re); }
    assert.equal(w.reecritures(), avant, 'aucun refus n\'a écrit');
    // Comme avant : sans sorte, la valeur dit la sorte (adresses, nom, enregistrement typé).
    assert.equal((await w.act('nom_local', { nom: 'courrier.maison', valeur: 'MX 10 boite.maison; TXT v=spf1 -all' })).ok, true);
    assert.deepEqual((await w.demande('courrier.maison', TYPE.TXT)).an, ['v=spf1 -all']);
    const D = (await w.noms()).D;
    assert.deepEqual(['xn--caf-dma.maison', 'note.maison', '*.atelier.maison', 'galerie.maison', 'courrier.maison'].map((n) => D.noms.find((x) => x.ascii === n)?.sorte), ['a', 'texte', 'joker', 'alias', 'autre']);
    assert.equal(D.noms.find((x) => x.ascii === 'xn--caf-dma.maison')?.nom, 'café.maison');
  } finally { w.fin(); }
});

test('Sphinx · la vérification pendant la frappe : « noms_vus » vérifie sans rien écrire', async () => {
  const w = await monde();
  try {
    w.prend(M.pc, 'PC-SALLE');
    const avant = JSON.stringify(w.ctx.settings);
    let D = (await w.noms({ nom: 'lecteur.maison', sorte: 'a', valeur: '192.0.2.44' })).D;
    assert.deepEqual([D.verdict?.ok, D.verdict?.nom], [true, 'lecteur.maison']);
    D = (await w.noms({ nom: 'pc-salle.maison', sorte: 'a', valeur: '192.0.2.44' })).D; assert.deepEqual([D.verdict?.ok, D.verdict?.code], [false, 'automatique']);
    D = (await w.noms({ nom: 'banque.example.com', sorte: 'a', valeur: '192.0.2.44' })).D; assert.deepEqual([D.verdict?.ok, D.verdict?.horsMaison], [true, true]);
    assert.equal((await w.noms()).D.verdict, null);
    assert.equal(JSON.stringify(w.ctx.settings), avant);
  } finally { w.fin(); }
});

test('Sphinx · changer et retirer : une question avant (elle nomme ce qui change) ; un nom automatique ou celui d\'Odin ne se retire pas à la main', async () => {
  const w = await monde();
  try {
    w.prend(M.pc, 'PC-SALLE');
    assert.equal((await w.act('nom_local', { nom: 'disque.maison', valeur: '192.0.2.40', sorte: 'a' })).ok, true);
    const m = w.v.module('vidarr')!, g = (id: string, i: Record<string, unknown>) => m.actions.find((x) => x.id === id)!.grave!(i, w.ctx);
    assert.equal(g('nom_local', { nom: 'lecteur.maison', valeur: '192.0.2.44', sorte: 'a' }), undefined, 'ajouter un nom de la maison : pas de question');
    assert.match(g('nom_local', { nom: 'disque.maison', valeur: '192.0.2.41', sorte: 'a', remplacer: true }) ?? '', /disque\.maison.*192\.0\.2\.40.*192\.0\.2\.41/);
    assert.match(g('nom_local', { nom: 'banque.example.com', valeur: '192.0.2.66', sorte: 'a' }) ?? '', /banque\.example\.com.*Internet/);
    assert.match(g('retirer_nom', { nom: 'disque.maison' }) ?? '', /retirer.*disque\.maison/);
    assert.equal(g('retirer_nom', { nom: 'inconnu.maison' }), undefined, 'rien à retirer : pas de question, le refus vient ensuite');
    // Changer.
    let r = await w.act('nom_local', { nom: 'disque.maison', valeur: '192.0.2.41', sorte: 'a', remplacer: true }); assert.equal(r.ok, true, r.text);
    assert.deepEqual((await w.demande('disque.maison', TYPE.A)).an, ['192.0.2.41']);
    // Retirer.
    for (const n of ['pc-salle.maison', 'odin.maison']) { const x = await w.act('retirer_nom', { nom: n }); assert.equal(x.ok, false); assert.match(x.text, /automatique|Odin/); }
    r = await w.act('retirer_nom', { nom: 'Disque.Maison' }); assert.equal(r.ok, true, r.text);
    assert.equal((await w.noms()).D.noms.some((x) => x.ascii === 'disque.maison'), false);
    // Un nom d'une autre langue se retire écrit dans sa langue.
    assert.equal((await w.act('nom_local', { nom: 'дом.maison', valeur: '192.0.2.42', sorte: 'a' })).ok, true);
    assert.equal((await w.act('retirer_nom', { nom: 'ДОМ.maison' })).ok, true);
    // « Qui a fait quoi » : chaque changement est noté (ajouter, changer, retirer), pas les lectures.
    const actes = ((await w.act('qui_a_fait', { n: 500 })).data as { actes: Array<{ action: string; ok: boolean; quoi: string }> }).actes;
    assert.ok(actes.filter((x) => x.action === 'Nom de la maison').length >= 3);
    assert.ok(actes.some((x) => x.action === 'Retirer un nom' && x.ok && /disque\.maison/i.test(x.quoi)));
    assert.ok(!actes.some((x) => /Noms de la maison/.test(x.action)), 'regarder les noms n\'est pas noté');
  } finally { w.fin(); }
});

test('Sphinx · propriétaire seul pour écrire ; un membre ne voit que les noms de l\'appareil qu\'il tient, sans vérification', async () => {
  const w = await monde();
  try {
    const ipPc = w.prend(M.pc, 'PC-SALLE'), ipTel = w.prend(M.tel, 'Telephone-Nour');
    assert.equal((await w.act('nom_local', { nom: 'disque.maison', valeur: '192.0.2.40', sorte: 'a' })).ok, true);
    assert.equal((await w.act('nom_local', { nom: 'mon-tel.maison', valeur: ipTel, sorte: 'a' })).ok, true);
    const avant = w.reecritures();
    for (const o of [{ qui: 'member' }, { qui: 'guest' }, { auto: true, by: 'automatisation' }, { by: 'odin' }, { qui: 'owner', marque: true }] as Array<Parameters<Valhalla['act']>[3]>) {
      for (const [a, i] of [['nom_local', { nom: 'pirate.maison', valeur: '192.0.2.66', sorte: 'a' }], ['retirer_nom', { nom: 'disque.maison' }], ['noms_vus', {}]] as const) {
        const r = await w.act(a, i, o); assert.equal(r.ok, false, `${a} ${JSON.stringify(o)}`); assert.match(r.text, REFUS);
        for (const secret of ['disque.maison', 'pc-salle', ipPc]) assert.ok(!JSON.stringify(r).includes(secret), `${JSON.stringify(o)} n'apprend rien sur ${secret}`);
      }
    }
    assert.equal(w.reecritures(), avant);
    const nour = { login: 'nour', name: 'Nour', groups: ['famille'] };
    const membre = (depuis: string, i: Record<string, unknown> = {}) => auNomDe(nour, () => origineDemande.run(depuis, () => w.act('noms_vus', i)));
    let r = await membre(ipTel), D = r.data as Donnees;
    assert.equal(D.proprietaire, false); assert.match(D.limite, /propriétaire/);
    assert.deepEqual(D.noms.map((x) => x.ascii).sort(), ['mon-tel.maison', 'telephone-nour.maison']);
    for (const secret of ['disque.maison', 'pc-salle', ipPc, 'odin.maison']) assert.ok(!JSON.stringify(r).includes(secret), `un membre n'apprend rien sur ${secret}`);
    r = await membre(ipTel, { nom: 'pc-salle.maison', sorte: 'a', valeur: '192.0.2.44' }); assert.equal((r.data as Donnees).verdict, null, 'un membre ne sonde pas les noms');
    for (const depuis of ['203.0.113.9', '']) { D = (await membre(depuis)).data as Donnees; assert.deepEqual(D.noms, [], `depuis « ${depuis} »`); }
  } finally { w.fin(); }
});

test('DNS · l\'inverse d\'une adresse privée de la maison est répondu par Odin ; une adresse privée sans nom ne part toujours pas sur Internet', async () => {
  // Un réseau de maison en adresses privées (172.16.5.x) : sans nom connu, la question s'arrête là (NXDOMAIN, rien ne sort) ;
  // avec un nom connu de la maison, Odin répond lui-même.
  const l = listeNoms({ domaine: 'maison', main: { 'lecteur.maison': ['172.16.5.9'] }, automatiques: [] });
  assert.deepEqual(l.inverses, [{ adresse: '172.16.5.9', nom: 'lecteur.maison' }]);
  let sorties = 0;
  const dns = new DnsServer({ settings: () => ({ ...DEFAULTS, rewrites: { 'lecteur.maison': ['172.16.5.9'] } }), lists: () => [], local: () => ({ '9.5.16.172.in-addr.arpa': ['PTR lecteur.maison'] }), fetch: (async () => { sorties++; throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch });
  const demande = async (nom: string, type: number) => { const out = (await dns.handle(query(nom, type, { id: 3 }), '172.16.5.20'))!; const m = parse(out); return { rcode: m.rcode, an: m.an.map((x) => dataText(out, x)) }; };
  assert.deepEqual(await demande('9.5.16.172.in-addr.arpa', TYPE.PTR), { rcode: RCODE.NOERROR, an: ['lecteur.maison'] });
  assert.equal((await demande('10.5.16.172.in-addr.arpa', TYPE.PTR)).rcode, RCODE.NXDOMAIN);
  assert.equal((await demande('lecteur', TYPE.A)).rcode, RCODE.NXDOMAIN, 'un nom sans point inconnu : comme avant');
  assert.equal(sorties, 0, 'aucune question n\'est partie dehors');
});

// ------------------------------------------------------------------ après relecture
test('Noms · avec le nom de maison « home.arpa » (que les réglages du DHCP proposent), les noms de la maison sont acceptés ; les adresses inverses restent réservées', () => {
  const e: EntreeNoms = { domaine: 'home.arpa', main: {}, automatiques: [] };
  for (const n of ['serveur.home.arpa', 'serveur', 'café.home.arpa']) { const v = verifierNom({ ...e, nom: n, sorte: 'a', valeur: '192.0.2.50' }); assert.deepEqual([v.ok, v.horsMaison], [true, false], `${n} : ${v.message}`); }
  assert.equal(verifierNom({ ...e, nom: '*.atelier.home.arpa', sorte: 'joker', valeur: '192.0.2.50' }).ok, true);
  for (const n of ['arpa', 'home.arpa', 'in-addr.arpa', '24.2.0.192.in-addr.arpa', 'x.ip6.arpa', 'autre.arpa', 'x.e164.arpa']) assert.equal(verifierNom({ ...e, nom: n, sorte: 'a', valeur: '192.0.2.50' }).ok, false, n);
  assert.equal(nomPropre('serveur.home.arpa').ok, true);
});

test('Noms · un retour à la ligne (ou un autre caractère de contrôle) dans un enregistrement écrit est refusé, comme avant le lot', async () => {
  for (const val of ['MX 10\nx.maison', 'MX\n10 x.maison', 'MX 10\tx.maison', 'MX 10\u2028x.maison', 'TXT a\nb', 'SRV 0 5 5060\nsip.maison', 'A 192.0.2.5\u0000', 'CNAME x.maison; TXT a\rb']) {
    for (const sorte of ['auto', '']) { const v = verif('courrier.maison', val, sorte); assert.deepEqual([v.ok, v.code], [false, 'valeur'], JSON.stringify(val)); }
  }
  assert.equal(verif('courrier.maison', 'MX 10 boite.maison; TXT v=spf1 -all', 'auto').ok, true, 'un enregistrement bien écrit passe toujours');
  const w = await monde();
  try {
    const avant = w.reecritures();
    const r = await w.act('nom_local', { nom: 'courrier.maison', valeur: 'MX 10\nx.maison' });
    assert.equal(r.ok, false, r.text); assert.equal(w.reecritures(), avant, 'rien n\'est écrit');
  } finally { w.fin(); }
});

test('Noms · un appareil qui annonce par le DHCP un nom déjà ajouté à la main ne le prend pas au propriétaire : il le change toujours', async () => {
  const w = await monde();
  try {
    assert.equal((await w.act('nom_local', { nom: 'imprimante.maison', valeur: '192.0.2.45', sorte: 'a' })).ok, true);
    w.prend(M.pc, 'imprimante');
    const r = await w.act('nom_local', { nom: 'imprimante.maison', valeur: '192.0.2.46', sorte: 'a', remplacer: true });
    assert.equal(r.ok, true, r.text);
    assert.deepEqual((await w.demande('imprimante.maison', TYPE.A)).an, ['192.0.2.46'], 'le nom à la main passe avant');
    // Un nom ajouté à la main ne se double toujours pas sans « remplacer ».
    assert.equal((await w.act('nom_local', { nom: 'imprimante.maison', valeur: '192.0.2.47', sorte: 'a' })).ok, false);
  } finally { w.fin(); }
});

test('DNS · les noms servis ne sont recalculés qu\'après un changement (un nom, un bail) : chaque question ne refait pas tout le calcul', async () => {
  const w = await monde();
  try {
    w.prend(M.pc, 'PC-SALLE');
    const a = nomsServis(w.ctx), b = nomsServis(w.ctx);
    assert.equal(a, b, 'deux questions de suite : un seul calcul');
    assert.ok(Object.isFrozen(a), 'le résultat partagé ne se modifie pas');
    assert.equal((await w.act('nom_local', { nom: 'disque.maison', valeur: '192.0.2.40', sorte: 'a' })).ok, true);
    const c = nomsServis(w.ctx); assert.notEqual(c, a, 'un nom ajouté : recalculé'); assert.deepEqual(c['40.2.0.192.in-addr.arpa'], ['PTR disque.maison']);
    const ip = w.prend(M.tel, 'Telephone-Nour');
    const d = nomsServis(w.ctx); assert.notEqual(d, c, 'un bail donné : recalculé'); assert.deepEqual(d['telephone-nour.maison'], [ip]);
  } finally { w.fin(); }
});

test('DNS · une question « constructor », « __proto__ », « toString » reçoit une réponse ; un tel nom écrit à la main est servi', async () => {
  let sorties = 0;
  const dns = new DnsServer({ settings: () => ({ ...DEFAULTS, rewrites: { 'constructor.maison': ['192.0.2.61'] } }), lists: () => [], local: () => ({ 'pc.maison': ['192.0.2.62'] }), fetch: (async () => { sorties++; throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch });
  const demande = async (nom: string, type: number) => { const out = (await dns.handle(query(nom, type, { id: 4 }), '192.0.2.150'))!; const m = parse(out); return { rcode: m.rcode, an: m.an.map((x) => dataText(out, x)) }; };
  for (const n of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.doesNotThrow(() => dns.verdict(n), n);
    assert.equal((await demande(n, TYPE.A)).rcode, RCODE.NXDOMAIN, n);
  }
  assert.deepEqual(await demande('constructor.maison', TYPE.A), { rcode: RCODE.NOERROR, an: ['192.0.2.61'] });
  assert.equal(sorties, 0, 'aucune question n\'est partie dehors');
});

test('Sphinx · ajouter, changer ou retirer un nom compte comme grave même sans contexte (un lien entre applis ne peut pas le lancer)', async () => {
  const { estGrave } = await import('../src/draupnir/liens.ts');
  const m = vidarr();
  for (const id of ['nom_local', 'retirer_nom']) {
    const a = m.actions.find((x) => x.id === id)!;
    assert.equal(typeof a.grave!({ nom: 'x.maison', valeur: '192.0.2.5' }, undefined), 'string', id);
    assert.equal(estGrave(a, { nom: 'x.maison', valeur: '192.0.2.5' }), true, id);
  }
});

test('Noms · « odin.<maison> » ne prend qu\'une adresse d\'Odin : sans réglage et sans carte, aucune adresse inventée', async () => {
  const home = mkdtempSync(join(tmpdir(), 'sphinx-noms-o-')); dossiers.push(home);
  const IPS = LOCAL.ips; LOCAL.ips = () => [];
  const v = new Valhalla(home, [vidarr()], { run: async () => ({ code: 1, out: '', err: 'essai : aucune commande' }), fetch: (async () => { throw new Error('essai : aucune sortie réseau'); }) as unknown as typeof fetch, notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(T0) });
  try {
    const servis = nomsServis(v.ctx('vidarr'));
    assert.equal(Object.hasOwn(servis, 'odin.maison'), false, JSON.stringify(Object.keys(servis)));
    assert.equal(Object.hasOwn(servis, 'odin'), false);
    const D = (await v.act('vidarr', 'noms_vus', {})).data as Donnees;
    assert.equal(D.noms.some((x) => x.origine === 'odin'), false);
  } finally { v.stop(); LOCAL.ips = IPS; }
});
