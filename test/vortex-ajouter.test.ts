// Vortex · « Ajouter un appareil » et son QR code, lot R8 (maquette « Réseau » validée), côté Odin :
//  - le nom nettoyé et borné, les trois accès (toute la maison, Internet par la maison, seulement certaines adresses),
//    la date de fin ;
//  - la configuration (avec la clé privée de l'appareil) rangée dans le coffre, ET SEULEMENT LÀ quand il est ouvert ;
//    remontrée sur un geste du propriétaire (noté « qui a fait quoi »), refaite avec l'adresse de la maison validée ;
//  - une clé n'est jamais dans une lecture, le journal, une alerte, une erreur, ni dans le fichier des réglages en clair ;
//  - à « Retirer », la configuration gardée au coffre part aussi ;
//  - les clés du VPN chiffrées au repos (src/prive.ts) : des réglages d'avant, en clair, se relisent et se réécrivent
//    chiffrés sans rien perdre ; coffre verrouillé, clé de la machine perdue : ce qui se passe.
// Aucune vraie commande réseau : le moteur du tunnel, la box et les commandes sont SIMULÉS ; rien n'écoute, aucun paquet.
// Adresses d'exemple : 203.0.113.x, 198.51.100.x ; maison en 10.0.0.x. Les clés sont créées pour l'essai, dans des
// dossiers temporaires neufs.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { BOX, VU, clientConf, gjoll, keypair, type Peer, type Server } from '../src/valhalla/modules/gjoll.ts';
import { brisingamen, load, store, type Item } from '../src/valhalla/modules/brisingamen.ts';
import { accesDemande, adressesSeules, finDemandee, nomAppareil } from '../src/valhalla/gjoll/ajout.ts';
import { empreinteDe } from '../src/valhalla/gjoll/coffre.ts';
import { valeursDuCoffreProprietaire } from '../src/heimdall/redact.ts';
import { encode } from '../src/valhalla/qr.ts';
import { lireMatriceQr } from '../src/valhalla/qr-lecture.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { setVerificateur } from '../src/valhalla/sso/acces.ts';
import { machineKeyFile, resetVaultCache, vaultEnable, vaultLock, vaultState, vaultUnlock } from '../src/vault.ts';
import { REFUS } from './reseau-r1-commun.ts';

const T0 = new Date(2026, 10, 24, 14, 0, 0).getTime();
const ORIGINE = { ...VU }, BOITE = { ...BOX }, CLE0 = process.env.BRISINGAMEN_KEY, dossiers: string[] = [];
after(() => { Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); if (CLE0 === undefined) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = CLE0; for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

const CLE = /[A-Za-z0-9+/]{43}=/;
const SERVEUR = () => ({ ...keypair(), net: '10.8.0', port: 51820, endpoint: '203.0.113.7', dns: '10.0.0.2', iface: 'wg-essai', lan: ['10.0.0.0/24'], nat: 'aucun' as const });

/** Un Odin d'essai : Vortex et le coffre (Thésauros). `coffre: false` : le coffre est fermé (sa clé manque). */
function monde(o: { coffre?: boolean; home?: string; adresse?: string } = {}) {
  const home = o.home ?? mkdtempSync(join(tmpdir(), 'vortex-r8-')); if (!o.home) dossiers.push(home);
  if (o.coffre === false) delete process.env.BRISINGAMEN_KEY; else process.env.BRISINGAMEN_KEY = 'ab'.repeat(32);
  const S = { now: T0, commandes: [] as string[], sorties: [] as string[] };
  VU.allume = () => false; VU.direct = () => new Map(); VU.flux = () => [];
  BOX.passerelle = async () => '10.0.0.1';
  BOX.adresse = (async () => { throw new Error('pas dans cet essai'); }) as never; BOX.ouvrir = (async () => { throw new Error('pas dans cet essai'); }) as never; BOX.fermer = (async () => { throw new Error('pas dans cet essai'); }) as never;
  setVerificateur(() => undefined);
  const v = new Valhalla(home, [gjoll, brisingamen], {
    run: async (c: string, a: string[]) => { S.commandes.push(`${c} ${a.join(' ')}`); return { code: 1, out: '', err: '' }; },
    fetch: (async (u: unknown) => { S.sorties.push(String(u)); throw new Error('aucun réseau dans les essais'); }) as never,
    notify: async () => {}, autonomy: () => 'equilibre', now: () => new Date(S.now),
  } as never);
  const g = v.ctx('gjoll'), fichier = join(home, 'valhalla', 'gjoll', 'réglages.json');
  if (!g.settings.server) g.saveSettings({ on: false, server: { ...SERVEUR(), ...(o.adresse !== undefined ? { endpoint: o.adresse } : {}) }, adresseSource: 'box' });
  const pairs = () => (g.settings.peers as Peer[] | undefined) ?? [], pair = (nom: string) => pairs().find((p) => p.name === nom)!;
  const coffre = (): Item[] => load(v.ctx('brisingamen'));
  const agir = (action: string, input: Record<string, unknown> = {}) => v.act('gjoll', action, input);
  const veille = () => gjoll.watch!.run(g);
  return { v, g, S, home, fichier, pairs, pair, coffre, agir, veille, ecrit: () => readFileSync(fichier, 'utf8'), fin: () => { v.stop(); Object.assign(VU, ORIGINE); Object.assign(BOX, BOITE); } };
}
const cleDe = (conf: unknown) => /^PrivateKey = (.+)$/m.exec(String(conf))![1];
function tousLesFichiers(d: string): string[] { const out: string[] = []; for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) out.push(...tousLesFichiers(p)); else out.push(p); } return out; }

test('R8 · pur : le nom nettoyé et borné, les trois accès, « seulement certaines adresses » reste dans la maison, la date de fin', () => {
  assert.equal(nomAppareil('  Téléphone   3 '), 'Téléphone 3');
  assert.equal(nomAppareil('Téléphone'.normalize('NFD')), 'Téléphone', 'une seule forme pour les accents');
  for (const faux of ['', '   ', 'x'.repeat(41), '<img src=x onerror=alert(1)>', 'Tel\nEndpoint = 198.51.100.9:1', 'Tel\u0000', 'a/b', 'a;b', '....', "'-'", 'Tel [Peer]', 'PC=1']) assert.throws(() => nomAppareil(faux), /nom : lettres, chiffres, espaces, 40 au plus/, JSON.stringify(faux));
  const maison = ['10.0.0.0/24'];
  assert.deepEqual(adressesSeules('10.0.0.10, 10.0.0.20;10.0.0.16/28 10.0.0.10', maison), ['10.0.0.10/32', '10.0.0.20/32', '10.0.0.16/28']);
  assert.deepEqual(adressesSeules('10.0.0.77/24', maison), ['10.0.0.0/24'], 'un réseau est ramené à son début');
  for (const [faux, pourquoi] of [['', /au moins une adresse/], ['198.51.100.9', /pas une adresse de la maison/], ['0.0.0.0/0', /adresse attendue/], ['10.0.1.5', /aucun réseau de la maison ouvert/], ['10.0.0.0/8', /adresse attendue/], ['10.0.0.0/16', /aucun réseau de la maison ouvert/], ['10.0.0.999', /adresse attendue/], ['maison.example.org', /adresse attendue/], ['10.0.0.5\nEndpoint = x', /adresse attendue/], [Array.from({ length: 13 }, (_x, k) => `10.0.0.${k + 1}`).join(','), /12 adresses au plus/]] as Array<[string, RegExp]>) assert.throws(() => adressesSeules(faux, maison), pourquoi, faux);
  assert.throws(() => adressesSeules('10.0.0.5', []), /aucun réseau de la maison ouvert/, 'aucun réseau ouvert : rien n\'est accepté');
  assert.deepEqual(accesDemande({ acces: 'internet' }, maison), { full: true });
  assert.deepEqual(accesDemande({ acces: 'maison', tout: true }, maison), { full: false }, '« acces » passe avant « tout »');
  assert.deepEqual(accesDemande({ acces: 'adresses', adresses: '10.0.0.10' }, maison), { full: false, seules: ['10.0.0.10/32'] });
  assert.deepEqual([accesDemande({}, maison), accesDemande({ tout: false }, maison)], [{ full: true }, { full: false }], 'sans « acces » : comme avant');
  assert.throws(() => accesDemande({ acces: 'tout le monde' }, maison), /« maison », « internet » ou « adresses »/);
  assert.deepEqual([finDemandee(''), finDemandee(' 2026-12-31 ')], ['', '2026-12-31']);
  for (const faux of ['31/12/2026', '2026-02-31', '2026-13-01', 'demain', '2026-12-31 x', '2026-12-31\nEndpoint = x']) assert.throws(() => finDemandee(faux), /2026-12-31/, faux);
});

test('R8 · ajouter : les trois accès donnent trois configurations ; un nom ou une adresse piégés sont refusés, rien n\'est créé', async () => {
  const w = monde();
  try {
    const conf = async (nom: string) => String(((await w.agir('qr', { nom })).data as { conf: string }).conf);
    assert.equal((await w.agir('ajouter', { nom: 'Téléphone 1', acces: 'internet', dns_odin: false })).ok, true);
    assert.equal((await w.agir('ajouter', { nom: 'Portable 1', acces: 'maison', dns_odin: false })).ok, true);
    const r = await w.agir('ajouter', { nom: '  Invité   du  soir ', acces: 'adresses', adresses: '10.0.0.10, 10.0.0.16/28', fin: '2026-12-01', dns_odin: false });
    assert.equal(r.ok, true, r.text);
    assert.deepEqual(w.pairs().map((p) => [p.name, p.full, p.seules ?? null, p.expires ?? '']), [['Téléphone 1', true, null, ''], ['Portable 1', false, null, ''], ['Invité du soir', false, ['10.0.0.10/32', '10.0.0.16/28'], '2026-12-01']]);
    assert.match(await conf('Téléphone 1'), /AllowedIPs = 0\.0\.0\.0\/0, ::\/0\n/);
    assert.match(await conf('Portable 1'), /AllowedIPs = 10\.8\.0\.0\/24, 10\.0\.0\.0\/24\n/);
    assert.match(await conf('Invité du soir'), /AllowedIPs = 10\.8\.0\.1\/32, 10\.0\.0\.10\/32, 10\.0\.0\.16\/28\n/);
    // La page des appareils dit l'accès de chacun.
    assert.deepEqual(((await w.agir('appareils_vus')).data as { appareils: Array<{ acces: string }> }).appareils.map((d) => d.acces), ['tout', 'maison', 'adresses']);
    // La question posée avant de créer nomme l'appareil et dit ce qui est ouvert.
    const grave = gjoll.actions.find((a) => a.id === 'ajouter')!.grave!;
    assert.equal(grave({ nom: 'Invité 2', acces: 'adresses', adresses: '10.0.0.10', fin: '2026-12-01' }), 'ouvrir l\'accès VPN à « Invité 2 » (seulement ces adresses de la maison : 10.0.0.10, jusqu\'au 2026-12-01)');
    assert.equal(String(grave({ nom: '<b>x</b>\nTel', acces: 'internet' })).includes('\n'), false, 'un nom piégé est nettoyé dans la question');
    // Refus : rien n'est créé, rien n'entre au coffre.
    const avant = [JSON.stringify(w.pairs()), w.coffre().length];
    for (const [input, pourquoi] of [
      [{ nom: 'Tel\nEndpoint = 198.51.100.9:1' }, /nom : lettres/], [{ nom: '<img src=x onerror=alert(1)>' }, /nom : lettres/], [{ nom: 'x'.repeat(41) }, /nom : lettres/],
      [{ nom: 'Téléphone 1' }, /déjà ce nom/], [{ nom: 'téléphone  1' }, /./], [{ nom: 'Tel 9', fin: '31/12/2026' }, /2026-12-31/],
      [{ nom: 'Tel 9', acces: 'adresses', adresses: '198.51.100.9' }, /pas une adresse de la maison/], [{ nom: 'Tel 9', acces: 'adresses', adresses: '0.0.0.0/0' }, /adresse attendue/],
      [{ nom: 'Tel 9', acces: 'adresses', adresses: '' }, /au moins une adresse/], [{ nom: 'Tel 9', acces: 'partout' }, /« maison », « internet » ou « adresses »/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      const x = await w.agir('ajouter', { dns_odin: false, ...input });
      if (input.nom === 'téléphone  1') { assert.equal(x.ok, true, 'un autre nom (la casse compte) : créé'); await w.agir('revoquer', { nom: 'téléphone 1' }); continue; }
      assert.equal(x.ok, false, JSON.stringify(input)); assert.match(x.text, pourquoi); assert.doesNotMatch(x.text, CLE);
    }
    assert.deepEqual([JSON.stringify(w.pairs()), w.coffre().length], avant);
    // Deux ajouts en même temps : jamais deux appareils du même nom, jamais deux fois la même adresse.
    const jumeaux = await Promise.all([1, 2].map(() => w.agir('ajouter', { nom: 'Jumeau', dns_odin: false, montrer: false })));
    assert.deepEqual(jumeaux.map((x) => x.ok).sort(), [false, true]); assert.match(jumeaux.find((x) => !x.ok)!.text, /déjà ce nom/);
    await Promise.all(['Un', 'Deux', 'Trois'].map((nom) => w.agir('ajouter', { nom, dns_odin: false, montrer: false })));
    assert.equal(new Set(w.pairs().map((p) => p.ip)).size, w.pairs().length); assert.equal(w.pairs().length, 7);
    assert.equal(w.pairs().some((p) => p.priv !== undefined), false, "aucune clé privée ne reste dans les réglages");
    // Renommer : le nom est nettoyé comme à la création.
    assert.equal((await w.agir('modifier', { nom: 'Un', nouveau_nom: '  Un   seul ', tout: 'inchangé', maillage: 'inchangé', fin: '', dns_odin: 'inchangé' })).ok, true);
    assert.ok(w.pair('Un seul'));
    assert.deepEqual(w.S.sorties, [], 'aucune sortie réseau');
  } finally { w.fin(); }
});

test('R8 · la configuration est gardée chiffrée dans le coffre, et seulement là : ni dans les réglages de Vortex, ni dans un fichier en clair', async () => {
  const w = monde();
  try {
    const r = await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Sa configuration est rangée dans le coffre \(Thésauros\), chiffrée/);
    const d = r.data as { svg: string; conf: string; dessin: { n: number; d: string }; garde: boolean; filename: string };
    const cle = cleDe(d.conf), p = w.pair('Téléphone 3');
    assert.match(cle, CLE); assert.equal(d.garde, true); assert.equal(d.filename, 'maison-Telephone-3.conf');
    // Dans Vortex : plus de clé privée de l'appareil, ni en mémoire ni dans le fichier.
    assert.equal(p.priv, undefined, 'la clé privée de l\'appareil n\'est pas gardée par Vortex');
    assert.equal(JSON.stringify(w.g.settings).includes(cle), false);
    // Dans le coffre : une note, reconnue par la clé PUBLIQUE de l'appareil, hors du bilan des mots de passe.
    const it = w.coffre().filter((i) => i.url === `vortex:${p.pub}`);
    assert.equal(it.length, 1); assert.deepEqual([it[0].type, it[0].name, it[0].user, it[0].password], ['note', 'VPN Téléphone 3', 'Téléphone 3', undefined]);
    assert.equal(cleDe(it[0].notes), cle);
    // Sur le disque : la clé de l'appareil, la clé du tunnel et la clé partagée ne sont dans aucun fichier en clair.
    const serveur = w.g.settings.server as Server;
    for (const f of tousLesFichiers(w.home)) { const t = readFileSync(f).toString('latin1'); for (const [quoi, s] of [['clé de l\'appareil', cle], ['clé du tunnel', serveur.priv], ['clé partagée', p.psk], ['configuration', 'PrivateKey']] as const) assert.equal(t.includes(s), false, `${quoi} en clair dans ${f}`); }
    assert.match(w.ecrit(), /"priv": "odc1:/); assert.match(w.ecrit(), /"psk": "odc1:/);
    // Le coffre ne la montre pas non plus dans ses lectures.
    const ch = await w.v.act('brisingamen', 'chercher', { q: 'VPN' });
    assert.match(ch.text, /VPN Téléphone 3/); assert.doesNotMatch(JSON.stringify(ch), /PrivateKey/); assert.equal(JSON.stringify(ch).includes(cle), false);
    // Le QR code remis à la création se relit : c'est bien cette configuration.
    const lu = lireMatriceQr(encode(d.conf, 'L')); assert.equal(lu.lu && lu.texte === d.conf, true);
    assert.match(d.svg, /^<svg /); assert.match(d.dessin.d, /^(M\d+ \d+h1v1h-1z)+$/);
    // « montrer : non » (la page) : la réponse ne porte aucune clé.
    const r2 = await w.agir('ajouter', { nom: 'Tablette 2', dns_odin: false, montrer: false });
    assert.equal(r2.ok, true); assert.doesNotMatch(JSON.stringify(r2), /PrivateKey|PresharedKey|<svg|"d":/); assert.doesNotMatch(JSON.stringify(r2), CLE);
    assert.deepEqual(r2.data, { name: 'Tablette 2', ip: '10.8.0.3', garde: true, adresse: true, filename: 'maison-Tablette-2.conf' });
    assert.equal(w.coffre().filter((i) => String(i.url).startsWith('vortex:')).length, 2);
  } finally { w.fin(); }
});

test('R8 · remontrer le QR code : la clé est relue dans le coffre, la configuration refaite avec l\'adresse validée ; le geste est noté, sans secret', async () => {
  const w = monde();
  try {
    const d0 = (await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false })).data as { conf: string };
    const cle = cleDe(d0.conf);
    const q = await w.agir('qr', { nom: 'Téléphone 3' });
    assert.equal(q.ok, true, q.text);
    const d = q.data as { svg: string; conf: string; dessin: { n: number; d: string }; filename: string };
    assert.equal(d.conf, d0.conf, 'la même configuration qu\'à la création'); assert.match(d.conf, /Endpoint = 203\.0\.113\.7:51820\n/);
    // L'adresse de la maison change (écrite et validée par le propriétaire) : le QR code remontré suit, sans rien régénérer.
    assert.equal((await w.agir('adresse', { adresse: 'maison.example.org', port: 51820 })).ok, true);
    const f = await w.agir('telecharger', { nom: 'Téléphone 3' });
    const conf2 = String((f.data as { conf: string }).conf);
    assert.match(conf2, /Endpoint = maison\.example\.org:51820\n/); assert.equal(cleDe(conf2), cle, 'la même clé, relue dans le coffre');
    assert.deepEqual(Object.keys(f.data as object).sort(), ['conf', 'filename'], 'le fichier : pas de QR code avec');
    // Un appareil coupé : son QR code se montre encore, avec l'avertissement.
    await w.agir('activer', { nom: 'Téléphone 3', actif: false });
    assert.match((await w.agir('qr', { nom: 'Téléphone 3' })).text, /⚠ Son accès est coupé/);
    assert.equal((await w.agir('qr', { nom: 'Inconnu' })).ok, false);
    // « Qui a fait quoi » : chaque geste, avec le nom de l'appareil, et aucun secret.
    const j = await w.agir('qui_a_fait', { n: 50 }), actes = (j.data as { actes: Array<{ action: string; quoi: string; ok: boolean; qui: string }> }).actes;
    assert.deepEqual(actes.filter((x) => x.action === 'QR code').map((x) => [x.quoi, x.ok, x.qui]), [['nom : Inconnu', false, 'propriétaire'], ['nom : Téléphone 3', true, 'propriétaire'], ['nom : Téléphone 3', true, 'propriétaire']]);
    assert.ok(actes.some((x) => x.action === 'Fichier de configuration' && x.quoi === 'nom : Téléphone 3' && x.ok));
    const psk = w.pair('Téléphone 3').psk, serveur = (w.g.settings.server as Server).priv;
    for (const [ou, t] of [['journal', JSON.stringify(j)], ['alertes', JSON.stringify(w.v.alerts({}))], ['manips', JSON.stringify(w.v.manips({ limit: 100 }))], ['la page', JSON.stringify(await w.agir('appareils_vus'))], ['appareils', JSON.stringify(await w.agir('appareils'))]] as const) {
      assert.doesNotMatch(t, /PrivateKey|PresharedKey/, ou); for (const s of [cle, psk, serveur]) assert.equal(t.includes(s), false, `une clé dans ${ou}`);
    }
  } finally { w.fin(); }
});

test('R8 · le QR code et le fichier ne sont rendus qu\'au propriétaire en personne', async () => {
  const w = monde();
  try {
    await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false, montrer: false });
    const PAS_LUI: Array<[string, Parameters<Valhalla['act']>[3]]> = [
      ['une automatisation', { auto: true, by: 'automatisation' }], ['un autre assistant', { auto: true, by: 'assistant' }], ['un lien entre applis lancé sans lui', { by: 'réflexe' }],
      ['Odin seul', { by: 'odin' }], ['un membre qui parle à Odin', { qui: 'member' }], ['un invité (la clé d\'API)', { qui: 'guest' }], ['une conversation marquée', { qui: 'owner', marque: true }],
      ['une autre appli', { de: 'brisingamen', by: 'réflexe' }],
    ];
    for (const [qui, o] of PAS_LUI) for (const action of ['qr', 'telecharger', 'ajouter']) {
      const r = await w.v.act('gjoll', action, { nom: action === 'ajouter' ? 'Intrus' : 'Téléphone 3' }, o);
      assert.equal(r.ok, false, `${qui} · ${action}`); assert.match(r.text, REFUS, `${qui} · ${action}`);
      assert.doesNotMatch(JSON.stringify(r), /PrivateKey|<svg|"d":/, `${qui} · ${action}`);
    }
    assert.deepEqual(w.pairs().map((p) => p.name), ['Téléphone 3']);
    // Une phrase (sans IA) venue d'ailleurs que du propriétaire n'atteint pas non plus le QR code.
    const o = await w.v.order('qr code vpn de Téléphone 3', 'web:essai', { qui: 'guest', confirm: true });
    assert.doesNotMatch(JSON.stringify(o), /PrivateKey|<svg/);
  } finally { w.fin(); }
});

test('R8 · l\'adresse de la maison pas encore connue (ou mal écrite) : aucun QR code, aucun fichier, et c\'est dit', async () => {
  const w = monde({ adresse: '[ADRESSE PUBLIQUE OU DOMAINE]' });
  try {
    const r = await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /L'adresse de la maison n'est pas encore connue : pas de QR code pour l'instant/);
    assert.doesNotMatch(JSON.stringify(r), /PrivateKey|<svg|"d":/); assert.equal((r.data as { adresse: boolean }).adresse, false);
    for (const action of ['qr', 'telecharger']) {
      const q = await w.agir(action, { nom: 'Téléphone 3' });
      assert.equal(q.ok, false); assert.match(q.text, /L'adresse de la maison n'est pas encore connue/); assert.deepEqual(q.data, { code: 'adresse' });
    }
    // Une adresse abîmée dans les réglages (jamais passée par la validation) n'entre pas dans une configuration.
    w.g.saveSettings({ server: { ...(w.g.settings.server as Server), endpoint: '203.0.113.7\nAllowedIPs = 0.0.0.0/0' } });
    assert.deepEqual((await w.agir('qr', { nom: 'Téléphone 3' })).data, { code: 'adresse' });
    // L'adresse validée arrive : le QR code se montre, avec elle.
    assert.equal((await w.agir('adresse', { adresse: '203.0.113.7', port: 51820 })).ok, true);
    assert.match(String(((await w.agir('qr', { nom: 'Téléphone 3' })).data as { conf: string }).conf), /Endpoint = 203\.0\.113\.7:51820\n/);
  } finally { w.fin(); }
});

test('R8 · « Retirer » un appareil : sa configuration gardée au coffre est effacée avec lui ; renommé, elle le suit', async () => {
  const w = monde();
  try {
    await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false, montrer: false }); await w.agir('ajouter', { nom: 'Tablette 2', dns_odin: false, montrer: false });
    // Une entrée du coffre du propriétaire qui ressemble (même nom) et celle d'un membre : jamais touchées.
    store(w.v.ctx('brisingamen'), [...w.coffre(), { id: 'aaaaaaaaaaaa', type: 'identifiant', name: 'VPN Tablette 2', user: 'moi', password: 'un-mot-de-passe-a-moi', url: 'https://vpn.example.org', updated: '' }, { id: 'bbbbbbbbbbbb', type: 'note', name: 'VPN Tablette 2', user: 'Tablette 2', url: 'Vortex (VPN de la maison)', notes: 'x', membre: 'nour', updated: '' }]);
    const tab = w.pair('Tablette 2');
    assert.equal((await w.agir('modifier', { nom: 'Tablette 2', nouveau_nom: 'Tablette du salon', tout: 'inchangé', maillage: 'inchangé', fin: '', dns_odin: 'inchangé' })).ok, true);
    assert.deepEqual(w.coffre().filter((i) => i.url === `vortex:${tab.pub}`).map((i) => [i.name, i.user]), [['VPN Tablette du salon', 'Tablette du salon']]);
    assert.match(String(((await w.agir('qr', { nom: 'Tablette du salon' })).data as { conf: string }).conf), /PrivateKey = /);
    const r = await w.agir('revoquer', { nom: 'Tablette du salon' });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /^🗝 Accès de Tablette du salon révoqué : sa clé ne vaut plus rien\. Sa configuration gardée au coffre est effacée\.\n/);
    assert.deepEqual(w.coffre().map((i) => [i.name, i.url, i.membre ?? '']).sort(), [['VPN Tablette 2', 'Vortex (VPN de la maison)', 'nour'], ['VPN Tablette 2', 'https://vpn.example.org', ''], ['VPN Téléphone 3', `vortex:${w.pair('Téléphone 3').pub}`, '']].sort());
    assert.equal(JSON.stringify(w.g.settings).includes(tab.pub), false, 'plus aucune trace de lui dans Vortex');
    assert.equal((await w.agir('qr', { nom: 'Tablette du salon' })).ok, false);
    // Son entrée effacée à la main dans le coffre : Odin le dit, et n'invente rien.
    store(w.v.ctx('brisingamen'), w.coffre().filter((i) => !String(i.url).startsWith('vortex:')));
    const q = await w.agir('qr', { nom: 'Téléphone 3' });
    assert.equal(q.ok, false); assert.match(q.text, /n'est plus dans le coffre \(Thésauros\)/); assert.deepEqual(q.data, { code: 'absente' });
  } finally { w.fin(); }
});

test('R8 · coffre fermé : l\'appareil est créé, sa clé attend chiffrée dans les réglages, puis entre au coffre dès qu\'il est ouvert', async () => {
  const w = monde({ coffre: false });
  try {
    const r = await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /⚠ Le coffre est fermé : sa configuration attend, chiffrée, dans les réglages de Vortex/);
    const cle = cleDe((r.data as { conf: string }).conf);
    assert.equal(w.pair('Téléphone 3').priv, cle, 'elle attend dans les réglages');
    assert.equal(w.ecrit().includes(cle), false, 'mais jamais en clair sur le disque'); assert.equal(existsSync(join(w.home, 'valhalla', 'brisingamen', 'coffre.bin')), false);
    assert.equal(cleDe(((await w.agir('qr', { nom: 'Téléphone 3' })).data as { conf: string }).conf), cle, 'le QR code se remontre quand même');
    // Retiré coffre fermé, pour un appareil dont la clé n'était qu'ici : rien à dire du coffre.
    await w.agir('ajouter', { nom: 'Tablette 2', dns_odin: false, montrer: false });
    const tabPub = w.pair('Tablette 2').pub;
    assert.match((await w.agir('revoquer', { nom: 'Tablette 2' })).text, /^🗝 Accès de Tablette 2 révoqué : sa clé ne vaut plus rien\.\n/);
    // Le coffre s'ouvre : à la veille suivante, la clé y entre et quitte les réglages.
    assert.deepEqual(w.g.settings.aEffacer, [{ empreinte: empreinteDe(tabPub), nom: 'Tablette 2' }], 'noté sans bruit : une entrée plus ancienne pourrait exister à son nom');
    process.env.BRISINGAMEN_KEY = 'ab'.repeat(32);
    await w.veille();
    const p = w.pair('Téléphone 3');
    assert.equal(p.priv, undefined); assert.equal(JSON.stringify(w.g.settings).includes(cle), false);
    assert.deepEqual(w.coffre().map((i) => [i.type, i.url, cleDe(i.notes)]), [['note', `vortex:${p.pub}`, cle]]);
    assert.equal(cleDe(((await w.agir('qr', { nom: 'Téléphone 3' })).data as { conf: string }).conf), cle);
    // Le coffre se referme : le QR code ne peut plus être remontré, et c'est dit ; rien n'est régénéré.
    delete process.env.BRISINGAMEN_KEY;
    const q = await w.agir('qr', { nom: 'Téléphone 3' });
    assert.equal(q.ok, false); assert.match(q.text, /Le coffre est fermé : la configuration de « Téléphone 3 » y est gardée chiffrée/); assert.deepEqual(q.data, { code: 'coffre' });
    // Retiré coffre fermé : noté (une empreinte, jamais sa clé), effacé du coffre dès qu'il est ouvert.
    const rv = await w.agir('revoquer', { nom: 'Téléphone 3' });
    assert.match(rv.text, /Le coffre est fermé : sa configuration gardée y sera effacée dès qu'il sera ouvert/);
    assert.deepEqual(w.g.settings.aEffacer, [{ empreinte: empreinteDe(p.pub), nom: 'Téléphone 3' }], 'Tablette 2 a été traitée quand le coffre a été ouvert');
    for (const pub of [p.pub, tabPub]) assert.equal(JSON.stringify(w.g.settings).includes(pub), false, 'plus aucune clé de lui dans Vortex, même publique');
    process.env.BRISINGAMEN_KEY = 'ab'.repeat(32);
    await w.veille();
    assert.deepEqual(w.coffre(), []); assert.equal(w.g.settings.aEffacer, undefined);
  } finally { w.fin(); }
});

test('R8 · un appareil d\'avant ce lot (clé dans les réglages, entrée « VPN nom » au coffre) : son QR code se remontre, puis sa clé ne reste qu\'au coffre', async () => {
  const w = monde();
  try {
    const k = keypair(), sv = w.g.settings.server as Server;
    const ancien: Peer = { name: 'Vieux portable', ...k, psk: Buffer.alloc(32, 7).toString('base64'), ip: '10.8.0.2', created: '', enabled: true, full: false };
    w.g.saveSettings({ peers: [ancien] });
    // Deux entrées du même nom laissées par des appareils retirés avant ce lot (d'autres clés), autour de la sienne,
    // rangée comme avant ce lot : la configuration dans le « mot de passe » d'une entrée du coffre.
    for (const p of [{ ...ancien, ...keypair() }, ancien, { ...ancien, ...keypair() }]) assert.equal((await w.v.act('brisingamen', 'ajouter', { nom: 'VPN Vieux portable', identifiant: 'Vieux portable', mot_de_passe: clientConf(sv, p, []), site: 'Vortex (VPN de la maison)' })).ok, true);
    // Sa clé n'est plus dans les réglages (comme si elle n'avait jamais été gardée que dans le coffre) : Odin retrouve la
    // bonne entrée, celle dont la clé privée donne bien SA clé publique, jamais « la première du même nom ».
    w.g.saveSettings({ peers: [{ ...ancien, priv: undefined }] });
    const q = await w.agir('qr', { nom: 'Vieux portable' });
    assert.equal(q.ok, true, q.text); assert.equal(cleDe((q.data as { conf: string }).conf), k.priv);
    assert.equal(w.pair('Vieux portable').priv, undefined, 'sa clé a quitté les réglages');
    assert.deepEqual(w.coffre().map((i) => [i.type, i.url, i.password, cleDe(i.notes)]), [['note', `vortex:${k.pub}`, undefined, k.priv]], 'une seule entrée, la sienne');
    assert.equal(cleDe(((await w.agir('telecharger', { nom: 'Vieux portable' })).data as { conf: string }).conf), k.priv);
  } finally { w.fin(); }
});

test('R8 · clés du VPN chiffrées au repos : des réglages d\'avant, en clair, se relisent et se réécrivent chiffrés sans rien perdre', async () => {
  const home = mkdtempSync(join(tmpdir(), 'vortex-r8-')); dossiers.push(home);
  const dir = join(home, 'valhalla', 'gjoll'), fichier = join(dir, 'réglages.json'); mkdirSync(dir, { recursive: true });
  const a = keypair(), b = keypair(), psk = (n: number) => Buffer.alloc(32, n).toString('base64');
  const avant = {
    on: false, adresseSource: 'box', portOpened: true, seen: ['Téléphone 1'],
    server: SERVEUR(),
    peers: [
      { name: 'Téléphone 1', ...a, psk: psk(1), ip: '10.8.0.2', created: '2026-11-01T10:00:00.000Z', enabled: true, full: true, mesh: false, odinDns: false },
      { name: 'Portable 1', pub: b.pub, priv: b.priv, psk: psk(2), ip: '10.8.0.3', created: '2026-11-02T10:00:00.000Z', enabled: false, full: false, expires: '2026-12-31', compte: 'nour' },
    ],
    derniers: { [a.pub]: { t: T0 - 60_000, de: '198.51.100.23' } },
  };
  writeFileSync(fichier, JSON.stringify(avant, null, 2));
  const secrets = [avant.server.priv, a.priv, b.priv, psk(1), psk(2)];
  for (const s of secrets) assert.equal(readFileSync(fichier, 'utf8').includes(s), true, 'en clair au départ');
  const w = monde({ home, coffre: false });
  try {
    // Relus : rien n'est perdu, rien n'est changé.
    assert.deepEqual(JSON.parse(JSON.stringify(w.g.settings)), avant);
    // Réécrits : les cinq clés sont chiffrées, tout le reste est resté lisible.
    const ecrit = JSON.parse(w.ecrit()) as typeof avant;
    for (const s of secrets) assert.equal(w.ecrit().includes(s), false, 'plus en clair sur le disque');
    assert.match(String(ecrit.server.priv), /^odc1:/); for (const p of ecrit.peers) { assert.match(String(p.priv), /^odc1:/); assert.match(String(p.psk), /^odc1:/); }
    assert.deepEqual({ ...ecrit, server: { ...ecrit.server, priv: '' }, peers: ecrit.peers.map((p) => ({ ...p, priv: '', psk: '' })) }, { ...avant, server: { ...avant.server, priv: '' }, peers: avant.peers.map((p) => ({ ...p, priv: '', psk: '' })) }, 'clés publiques, adresses, noms, dates : inchangés');
    // Un changement, puis un autre Odin qui relit le même dossier : toujours tout.
    assert.equal((await w.agir('activer', { nom: 'Portable 1', actif: true })).ok, true);
    w.fin();
    const w2 = monde({ home, coffre: false });
    assert.deepEqual(JSON.parse(JSON.stringify(w2.g.settings)), { ...avant, peers: [avant.peers[0], { ...avant.peers[1], enabled: true }] });
    assert.equal(cleDe(((await w2.agir('qr', { nom: 'Téléphone 1' })).data as { conf: string }).conf), a.priv, 'le tunnel et les QR codes marchent comme avant');
    for (const s of secrets) assert.equal(w2.ecrit().includes(s), false);
    w2.fin();
  } finally { w.fin(); }
});

test('R8 · coffre verrouillé par le mot de passe maître : le VPN lit toujours ses clés (clé de la machine) ; seul le QR code gardé au coffre attend', async () => {
  const w = monde();
  try {
    const cle = cleDe(((await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false })).data as { conf: string }).conf);
    const serveur = (w.g.settings.server as Server).priv, psk = w.pair('Téléphone 3').psk;
    vaultEnable(w.home, 'un-sentier-de-sable-31'); vaultLock(w.home);
    assert.equal(vaultState(w.home), 'locked');
    w.fin();
    // Odin redémarre, coffre verrouillé : les clés du tunnel se relisent, on peut couper, rouvrir, ajouter.
    const w2 = monde({ home: w.home });
    assert.equal((w2.g.settings.server as Server).priv, serveur); assert.equal(w2.pair('Téléphone 3').psk, psk);
    assert.equal((await w2.agir('activer', { nom: 'Téléphone 3', actif: false })).ok, true);
    const q = await w2.agir('qr', { nom: 'Téléphone 3' });
    assert.equal(q.ok, false); assert.match(q.text, /Le coffre est fermé/); assert.deepEqual(q.data, { code: 'coffre' });
    const r = await w2.agir('ajouter', { nom: 'Tablette 2', dns_odin: false });
    assert.equal(r.ok, true, r.text); assert.match(r.text, /Le coffre est fermé : sa configuration attend, chiffrée/);
    assert.equal(w2.ecrit().includes(cleDe((r.data as { conf: string }).conf)), false);
    // Déverrouillé : le QR code revient, la clé en attente entre au coffre.
    vaultUnlock(w.home, 'un-sentier-de-sable-31');
    assert.equal(cleDe(((await w2.agir('qr', { nom: 'Téléphone 3' })).data as { conf: string }).conf), cle);
    assert.equal(w2.pair('Tablette 2').priv, undefined);
    w2.fin();
  } finally { w.fin(); }
});

test('R8 · clé de la machine perdue : les clés du VPN sont illisibles, Odin le dit, ne réécrit rien et n\'en fabrique pas d\'autres', async () => {
  const w = monde();
  try {
    await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false, montrer: false });
    const ecrit = w.ecrit(), pub = (w.g.settings.server as Server).pub;
    w.fin();
    rmSync(machineKeyFile(w.home), { force: true }); resetVaultCache(w.home);
    const erreurs = console.error; console.error = () => {};
    let w2: ReturnType<typeof monde>;
    try { w2 = monde({ home: w.home }); } finally { console.error = erreurs; }
    assert.equal((w2.g.settings.server as Server).priv, undefined, 'illisible : absente en mémoire');
    for (const [action, input] of [['ajouter', { nom: 'Tablette 2' }], ['qr', { nom: 'Téléphone 3' }], ['telecharger', { nom: 'Téléphone 3' }], ['activer', { nom: 'Téléphone 3', actif: false }], ['revoquer', { nom: 'Téléphone 3' }], ['port', { ouvert: true }], ['allumer', {}], ['adresse', { adresse: '203.0.113.9', port: 51820 }]] as Array<[string, Record<string, unknown>]>) {
      const r = await w2.agir(action, input);
      assert.equal(r.ok, false, action); assert.match(r.text, /les clés du VPN sont illisibles \(la clé de cette machine a changé ou manque\)\. Rien n'est changé/, action);
    }
    await w2.veille();
    assert.ok(w2.v.alerts({ module: 'gjoll' }).some((x) => x.title === 'Les clés du VPN sont illisibles'));
    assert.equal(w2.ecrit(), ecrit, 'le fichier des réglages n\'est pas réécrit : les valeurs chiffrées sont gardées');
    assert.equal((w2.g.settings.server as Server).pub, pub, 'aucune nouvelle paire de clés');
    // La page se lit encore (aucune clé dedans).
    assert.equal((await w2.agir('appareils_vus')).ok, true);
    w2.fin();
  } finally { w.fin(); }
});

// ------------------------------------------------------------------ relecture du lot R8
test('R8 (relecture) · clé de la machine perdue : AUCUN chemin ne réécrit les réglages — chaque action, la page générique, le démarrage, la veille', async () => {
  const w = monde();
  try {
    await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false, montrer: false });
    const ecrit = w.ecrit(); w.fin();
    rmSync(machineKeyFile(w.home), { force: true }); resetVaultCache(w.home);
    const erreurs = console.error; console.error = () => {};
    let w2: ReturnType<typeof monde>;
    try { w2 = monde({ home: w.home }); } finally { console.error = erreurs; }
    const passe: string[] = [];
    // Toutes les actions de Vortex, avec de quoi changer quelque chose si la garde avait un trou (un réglage sans rapport compris).
    const entree = { nom: 'Téléphone 3', nouveau_nom: 'Autre', adresse: '203.0.113.9', port: 51821, ouvert: true, reseaux: '10.0.1.0/24', dns: '10.0.0.3', fin: '2027-01-01', actif: false, mtu: '1300', keepalive: 30, n: 5 };
    for (const a of gjoll.actions) {
      const r = await w2.agir(a.id, { ...entree });
      if (w2.ecrit() !== ecrit) { passe.push(`${a.id} a réécrit le fichier`); break; }
      if (r.ok !== false && !['appareils', 'appareils_vus', 'qui_a_fait'].includes(a.id)) passe.push(`${a.id} est passée : ${r.text.slice(0, 80)}`);
      assert.doesNotMatch(JSON.stringify(r), /PrivateKey|odc1:/, a.id);
    }
    await assert.rejects(async () => gjoll.view!(w2.g, new URLSearchParams()), /les clés du VPN sont illisibles/);
    await gjoll.start!(w2.g); await w2.veille(); await w2.veille();
    assert.deepEqual(passe, []);
    assert.equal(w2.ecrit(), ecrit, 'ni la page générique, ni le démarrage, ni la veille ne réécrivent le fichier');
    w2.fin();
  } finally { w.fin(); }
});

test('R8 (relecture) · un nom d\'appareil dans une écriture à signes (thaï, hindi, arabe) est accepté ; un caractère caché est refusé', async () => {
  for (const nom of ['โทรศัพท์ 1', 'फ़ोन 2', 'هاتف ٣']) assert.equal(nomAppareil(nom), nom.normalize('NFC'));
  for (const faux of ['Tel​', 'Tel‮', 'Tel⁠x', '́x', '‍Tel']) assert.throws(() => nomAppareil(faux), /nom : lettres, chiffres, espaces, 40 au plus/, JSON.stringify(faux));
  const w = monde();
  try {
    const r = await w.agir('ajouter', { nom: 'โทรศัพท์ 1', dns_odin: false });
    assert.equal(r.ok, true, r.text);
    const d = r.data as { filename: string; conf: string };
    assert.equal(d.filename, 'maison-1.conf', 'le nom du fichier reste en lettres simples');
    assert.equal((await w.agir('qr', { nom: 'โทรศัพท์ 1' })).ok, true);
  } finally { w.fin(); }
});

test('R8 (relecture) · une fin d\'accès déjà passée ne crée pas d\'appareil (il serait resté ouvert jusqu\'à la veille suivante)', async () => {
  const w = monde();
  try {
    const r = await w.agir('ajouter', { nom: 'Invité', fin: '2026-11-23', dns_odin: false, montrer: false });
    assert.equal(r.ok, false); assert.match(r.text, /la fin de l'accès \(2026-11-23\) est déjà passée .* Rien n'est créé\./);
    assert.deepEqual([w.pairs().length, w.coffre().length], [0, 0]);
    // Aujourd'hui (dernier jour) : accepté.
    assert.equal((await w.agir('ajouter', { nom: 'Invité', fin: '2026-11-24', dns_odin: false, montrer: false })).ok, true);
    assert.equal(w.pair('Invité').enabled, true);
  } finally { w.fin(); }
});

test('R8 (relecture) · un appareil retiré pendant que la veille range au coffre n\'y laisse aucune configuration', async () => {
  const w = monde({ coffre: false });
  try {
    for (const nom of ['Un', 'Deux']) assert.equal((await w.agir('ajouter', { nom, dns_odin: false, montrer: false })).ok, true);
    assert.equal(w.pairs().every((p) => Boolean(p.priv)), true, 'coffre fermé : les deux clés attendent dans les réglages');
    process.env.BRISINGAMEN_KEY = 'ab'.repeat(32);
    // La veille commence à ranger « Un » ; « Deux » est retiré pendant qu'elle attend le coffre.
    const veille = w.veille(), r = await w.agir('revoquer', { nom: 'Deux' }); await veille; await w.veille();
    assert.equal(r.ok, true, r.text);
    assert.deepEqual(w.coffre().map((i) => i.name), ['VPN Un'], 'la configuration de l\'appareil retiré n\'est pas revenue dans le coffre');
    assert.deepEqual([w.pairs().map((p) => p.name), w.pairs().map((p) => p.priv), w.g.settings.aEffacer], [['Un'], [undefined], undefined]);
  } finally { w.fin(); }
});

test('R8 (relecture) · le masqueur d\'Odin connaît les clés gardées au coffre ; elles ne peuvent pas servir de « mot de passe » à un outil', async () => {
  const w = monde();
  try {
    const r = await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false });
    const conf = (r.data as { conf: string }).conf, cle = cleDe(conf), psk = w.pair('Téléphone 3').psk;
    const it = w.coffre().find((i) => i.url === `vortex:${w.pair('Téléphone 3').pub}`)!;
    assert.deepEqual(it.champs, { 'clé privée': cle, 'clé partagée': psk });
    assert.equal(it.password, undefined, 'aucun « mot de passe » : une référence coffre:…/mot de passe ne donne rien');
    const caches = valeursDuCoffreProprietaire(w.coffre());
    assert.ok(caches.includes(cle) && caches.includes(psk), 'le masqueur cache la clé privée et la clé partagée');
    // Renommé : les clés suivent, une seule entrée.
    assert.equal((await w.agir('modifier', { nom: 'Téléphone 3', nouveau_nom: 'Téléphone 4' })).ok, true);
    const apres = w.coffre().filter((i) => String(i.url).startsWith('vortex:'));
    assert.deepEqual(apres.map((i) => [i.name, i.user, i.champs?.['clé privée']]), [['VPN Téléphone 4', 'Téléphone 4', cle]]);
    // Les lectures du coffre ne montrent toujours aucune clé.
    for (const a of ['chercher', 'bilan']) assert.equal(JSON.stringify(await w.v.act('brisingamen', a, { q: 'VPN' })).includes(cle), false, a);
    assert.equal(JSON.stringify(await brisingamen.view!(w.v.ctx('brisingamen'), new URLSearchParams())).includes(cle), false, 'la page du coffre');
  } finally { w.fin(); }
});

test('R8 (relecture) · la page générique : plus de bouton qui montre un QR code ou un fichier d\'un seul clic, et la case « Montrer tout de suite » n\'est plus cochée d\'office', async () => {
  const p = gjoll.actions.find((a) => a.id === 'ajouter')!.params!.find((x) => x.key === 'montrer')!;
  assert.equal(p.default, false);
  const w = monde();
  try {
    await w.agir('ajouter', { nom: 'Téléphone 3', dns_odin: false, montrer: false });
    // La page générique (onglet « Tout », graphe) affiche tout de suite la réponse de « qr » : ses raccourcis sont retirés.
    const vue = JSON.stringify(await gjoll.view!(w.g, new URLSearchParams()));
    assert.match(vue, /Téléphone 3/); assert.doesNotMatch(vue, /"action":"(qr|telecharger)"/);
    assert.doesNotMatch(vue, /PrivateKey|odc1:/); assert.equal(vue.includes(w.pair('Téléphone 3').psk), false);
  } finally { w.fin(); }
});
