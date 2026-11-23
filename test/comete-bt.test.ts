// Comète · le moteur de partage de fichiers, SANS Internet : un petit partage fabriqué ici, un faux tracker (HTTP par
// le réseau d'essai, UDP), un faux nœud DHT et 2-3 faux pairs, tous sur 127.0.0.1 (permis par le réglage d'essai).
//   bencode piégé refusé ; chemins piégés refusés ; v2 seul refusé proprement ; téléchargement complet vérifié morceau
//   par morceau ; un pair qui envoie un morceau faux est rejeté et le morceau redemandé ; reprise après arrêt ;
//   magnet → description (vérifiée) → fichier ; trackers UDP et DHT ; adresses de la maison refusées ; réglages bornés.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ecrire, ErreurBencode, lire } from '../src/valhalla/venus/comete/bt/bencode.ts';
import { cheminSur, choisirFichier, lireMagnet, lireTorrent } from '../src/valhalla/venus/comete/bt/metainfo.ts';
import { adressePermise } from '../src/valhalla/venus/comete/bt/garde.ts';
import { lireReponseHttp } from '../src/valhalla/venus/comete/bt/tracker.ts';
import { Session, type OptionsSession } from '../src/valhalla/venus/comete/bt/session.ts';
import { chercherDht } from '../src/valhalla/venus/comete/bt/dht.ts';
import { fabriquer, fauxDht, fauxHttp, fauxPair, fauxUdp, type FauxPair } from './comete-bt-aides.ts';

const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
const dossiers: string[] = [];
const dossier = () => { const d = mkdtempSync(join(tmpdir(), 'comete-bt-')); dossiers.push(d); return d; };
const aFermer: Array<() => Promise<void> | void> = [];
after(async () => { for (const f of aFermer) await f(); for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const pairs = async (f: ReturnType<typeof fabriquer>, l: Parameters<typeof fauxPair>[1][]): Promise<FauxPair[]> => { const r = await Promise.all(l.map((o) => fauxPair(f, o))); for (const p of r) aFermer.push(() => p.fermer()); return r; };
const options = (o: Partial<OptionsSession> & Pick<OptionsSession, 'empreinte' | 'reseau'>): OptionsSession => ({
  trackers: [], pairs: [], dossier: dossier(), signal: new AbortController().signal, progression: () => undefined, tailleMax: 1e9,
  envoi: { pendant: false, debitKo: 0, ratio: 0, dureeMin: 0 }, resoudre: async () => [], essai: true, maxPairs: 10, port: 6881, patience: 4000, ...o,
});

test('bencode : lu et écrit ; piégé (profondeur, taille, éléments, nombres, clés en double) refusé', () => {
  const b = ecrire({ a: 1, b: [Buffer.from('x'), -3], c: { d: Buffer.alloc(0) } });
  assert.equal(b.toString(), 'd1:ai1e1:bl1:xi-3ee1:cd1:d0:ee');
  assert.deepEqual(lire(b).valeur, lire(Buffer.from(b)).valeur);
  assert.throws(() => lire(Buffer.from('l'.repeat(1000) + 'e'.repeat(1000))), /trop imbriqué/);
  assert.throws(() => lire(Buffer.alloc(9 * 1024 * 1024, 0x30)), /trop gros/);
  assert.throws(() => lire(Buffer.from(`l${'i1e'.repeat(300)}e`), { elements: 100 }), /trop d'éléments/);
  assert.throws(() => lire(Buffer.from('i0123e')), /zéro en tête/);
  assert.throws(() => lire(Buffer.from('i99999999999999999999e')), /trop long/);
  assert.throws(() => lire(Buffer.from('999999:abc')), /plus longue/);
  assert.throws(() => lire(Buffer.from('d1:ai1e1:ai2ee')), /double/);
  assert.throws(() => lire(Buffer.from('i1eXX')), /en trop/);
  assert.ok(lire(Buffer.from('d9:__proto__i1ee')).valeur, 'aucune pollution par __proto__');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  for (const x of ['', 'x', 'l', 'd1:a', '5:ab', 'i-0e', 'ie']) assert.throws(() => lire(Buffer.from(x)), ErreurBencode, x);
});

test('chemins piégés dans le .torrent : refusés (.., absolu, nom réservé, séparateur, contrôle)', () => {
  for (const p of [['..', 'x.mkv'], ['C:', 'x.mkv'], ['CON.mkv'], ['a/b.mkv'], ['a\\b.mkv'], ['x\u0000.mkv'], ['nul'], ['.'], ['fin.'], ['']]) {
    const f = fabriquer({ chemins: p.map((x) => Buffer.from(x)) });
    assert.throws(() => lireTorrent(f.torrent), /piégé/, JSON.stringify(p));
  }
  assert.throws(() => lireTorrent(fabriquer({ nom: '..' }).torrent), /piégé/);
  assert.throws(() => cheminSur(new Array(17).fill('a')), /profondeur/);
  // Un partage v2 seul : refus propre.
  const v2 = ecrire({ info: { name: Buffer.from('x'), 'piece length': 16384, 'meta version': 2, 'file tree': { 'x.mkv': { '': { length: 5 } } } } });
  assert.throws(() => lireTorrent(v2), /version 2/);
  assert.throws(() => lireMagnet('magnet:?xt=urn:btmh:1220' + '0'.repeat(64)), /version 2/);
  assert.throws(() => lireMagnet('magnet:?xt=urn:btih:' + '0'.repeat(40)), /nulle/);
  const m = lireMagnet('magnet:?xt=urn:btih:CIQ5LHX7GDJX6LZQ2J4NSYK3JK2YEJJG&dn=Film&tr=udp%3A%2F%2Ft.exemple.test%3A80&tr=file%3A%2F%2Fx');
  assert.equal(m.empreinte.length, 20); assert.deepEqual(m.trackers, ['udp://t.exemple.test:80'], 'un tracker « file: » est écarté');
});

test('le bon fichier : la vidéo voulue, jamais l\'extrait ni le texte', () => {
  const p = lireTorrent(fabriquer().torrent);
  assert.equal(p.fichiers.length, 3);
  assert.equal(p.fichiers[choisirFichier(p)].chemin.join('/'), 'Film Essai (2024)/Film.Essai.2024.1080p.mkv');
  assert.equal(choisirFichier(p, { saison: 1, episode: 2 }), 1, 'une seule vidéo sans numéro : prise');
  const s = lireTorrent(fabriquer({ chemins: [Buffer.from('Serie.S01E01.1080p.mkv')] }).torrent);
  assert.equal(choisirFichier(s, { saison: 1, episode: 1 }), 1);
  assert.throws(() => choisirFichier(s, { saison: 1, episode: 2 }), /n'est pas dans ce partage/);
});

test('adresses : la machine d\'Odin et la maison refusées pour les pairs ; 127.0.0.1 seulement en essai', () => {
  for (const a of ['127.0.0.1', '10.0.0.2', '192.168.1.5', '172.16.0.1', '169.254.1.1', '::1', 'fd00::1', '224.0.0.1', '255.255.255.255', '0.0.0.0', '100.64.0.1']) assert.equal(adressePermise(a), false, a);
  assert.equal(adressePermise('203.0.113.9'), true); assert.equal(adressePermise('127.0.0.1', true), true);
  const r = lireReponseHttp(ecrire({ interval: 60, peers: Buffer.from([192, 168, 1, 2, 0x1a, 0xe1, 8, 8, 8, 8, 0x1a, 0xe1, 127, 0, 0, 1, 0, 80]) }));
  assert.deepEqual(r.pairs, [{ ip: '8.8.8.8', port: 6881 }], 'la maison et la machine d\'Odin sont écartées de la liste du tracker');
});

test('téléchargement complet par un tracker HTTP et 3 pairs : chaque morceau vérifié, seule la vidéo écrite', async () => {
  const f = fabriquer(), ps = await pairs(f, [{}, {}, {}]), h = await fauxHttp({ pairs: () => ps.map((p) => p.port) }); aFermer.push(() => { h.srv.close(); });
  const p = lireTorrent(f.torrent), prog: number[] = [];
  const o = options({ empreinte: p.empreinte, partage: p, trackers: ['http://tracker.exemple.test/announce'], reseau: h.local, progression: (fait) => prog.push(fait) });
  const r = await new Session(o).lancer();
  assert.equal(sha(readFileSync(r.chemin)), sha(f.video), 'la vidéo reçue est exacte');
  assert.equal(r.taille, f.video.length); assert.equal(r.bannis.length, 0);
  assert.ok(h.annonces.some((a) => a.includes('info_hash=') && a.includes('peer_id=-OD0100-') && !/hostname|user/i.test(a)), 'annonce : empreinte et identifiant au hasard, rien de personnel');
  assert.ok(ps.filter((x) => x.demandes > 0).length >= 2, 'plusieurs pairs servent');
  assert.ok(!existsSync(join(o.dossier, 'bords')) && !existsSync(join(o.dossier, 'etat.json')), 'le travail est nettoyé');
  assert.equal(prog.at(-1), f.video.length);
});

test('un pair qui envoie un morceau faux est rejeté et le morceau redemandé ailleurs', async () => {
  const f = fabriquer(), [bon, menteur] = await pairs(f, [{ delaiUnchoke: 300 }, { mauvais: () => true }]);
  const p = lireTorrent(f.torrent), notes: string[] = [];
  const r = await new Session(options({ empreinte: p.empreinte, partage: p, pairs: [{ ip: '127.0.0.1', port: menteur.port }, { ip: '127.0.0.1', port: bon.port }], reseau: fetch, journal: (t) => notes.push(t) })).lancer();
  assert.equal(sha(readFileSync(r.chemin)), sha(f.video), 'le fichier est juste malgré le menteur');
  assert.deepEqual(r.bannis, [`127.0.0.1:${menteur.port}`]);
  assert.ok(notes.some((n) => /morceau \d+ faux/.test(n)), notes.join('\n'));
  assert.ok(menteur.demandes > 0 && bon.demandes > 0);
});

test('reprise après arrêt : les morceaux déjà vérifiés sont gardés (relus et revérifiés), seul le reste est demandé', async () => {
  const f = fabriquer({ tailleVideo: 600_000 }), [lent] = await pairs(f, [{ delaiBloc: 40 }]), p = lireTorrent(f.torrent), d = dossier();
  const ac = new AbortController(); let vu = 0;
  const s1 = new Session(options({ empreinte: p.empreinte, partage: p, pairs: [{ ip: '127.0.0.1', port: lent.port }], reseau: fetch, dossier: d, signal: ac.signal, progression: (fait) => { vu = fait; if (fait > 200_000) ac.abort(); } }));
  await assert.rejects(s1.lancer(), /arrêté/);
  assert.ok(vu > 200_000 && existsSync(join(d, 'etat.json')), 'l\'état est gardé');
  const [vite] = await pairs(f, [{}]), notes: string[] = [];
  const r = await new Session(options({ empreinte: p.empreinte, partage: p, pairs: [{ ip: '127.0.0.1', port: vite.port }], reseau: fetch, dossier: d, journal: (t) => notes.push(t) })).lancer();
  assert.equal(sha(readFileSync(r.chemin)), sha(f.video));
  assert.ok(notes.some((n) => /reprise : \d+ morceau/.test(n)), notes.join('\n'));
  const blocsTotal = Math.ceil(f.donnees.length / 16384);
  assert.ok(vite.demandes < blocsTotal - 10, `seul le reste est demandé (${vite.demandes} blocs sur ${blocsTotal})`);
});

test('magnet → description reçue d\'un pair (vérifiée par l\'empreinte ; une fausse rejetée) → fichier', async () => {
  const f = fabriquer(), [faux, bon] = await pairs(f, [{ meta: 'fausse' }, { delaiUnchoke: 0 }]), h = await fauxHttp({ pairs: () => [faux.port, bon.port] }); aFermer.push(() => { h.srv.close(); });
  const m = lireMagnet(`magnet:?xt=urn:btih:${f.empreinte.toString('hex')}&dn=Film&tr=${encodeURIComponent('http://tracker.exemple.test/announce')}`);
  let gardee: Buffer | undefined; const notes: string[] = [];
  const r = await new Session(options({ empreinte: m.empreinte, trackers: m.trackers, reseau: h.local, surPartage: (p) => { gardee = p.info; }, journal: (t) => notes.push(t) })).lancer();
  assert.equal(sha(readFileSync(r.chemin)), sha(f.video));
  assert.ok(gardee?.equals(f.info), 'la description est gardée pour la reprise');
  if (faux.metaServies > 0) assert.ok(r.bannis.includes(`127.0.0.1:${faux.port}`), 'le pair à la fausse description est rejeté');
  assert.ok(notes.some((n) => /description du partage reçue et vérifiée/.test(n)));
});

test('tracker UDP (BEP 15) puis pairs : fichier reçu', async () => {
  const f = fabriquer({ tailleVideo: 100_000 }), [a] = await pairs(f, [{}]), u = await fauxUdp(() => [a.port]); aFermer.push(() => { u.s.close(); });
  const p = lireTorrent(f.torrent);
  const r = await new Session(options({ empreinte: p.empreinte, partage: p, trackers: [`udp://127.0.0.1:${u.port}/announce`], reseau: fetch })).lancer();
  assert.equal(sha(readFileSync(r.chemin)), sha(f.video)); assert.ok(u.annonces >= 1);
});

test('DHT (BEP 5) : un nœud donne des pairs pour l\'empreinte', async () => {
  const f = fabriquer({ tailleVideo: 100_000 }), [a] = await pairs(f, [{}]), n = await fauxDht(() => [a.port]); aFermer.push(() => { n.s.close(); });
  const trouves: number[] = [], ac = new AbortController();
  chercherDht(f.empreinte, (x) => trouves.push(x.port), ac.signal, { amorces: [`127.0.0.1:${n.port}`], resoudre: async () => [], essai: true });
  for (let k = 0; k < 50 && !trouves.length; k++) await new Promise((ok) => setTimeout(ok, 50));
  ac.abort();
  assert.deepEqual([...new Set(trouves)], [a.port]);
  // Sans réglage d'essai, une amorce sur la machine d'Odin est refusée : aucune question n'est posée.
  const avant = n.questions, ac2 = new AbortController();
  chercherDht(f.empreinte, () => undefined, ac2.signal, { amorces: [`127.0.0.1:${n.port}`], resoudre: async () => [], essai: false });
  await new Promise((ok) => setTimeout(ok, 300)); ac2.abort();
  assert.equal(n.questions, avant);
});

test('sans réglage d\'essai, un pair sur la machine d\'Odin n\'est jamais contacté', async () => {
  const f = fabriquer({ tailleVideo: 50_000 }), [a] = await pairs(f, [{}]), p = lireTorrent(f.torrent);
  await assert.rejects(new Session(options({ empreinte: p.empreinte, partage: p, pairs: [{ ip: '127.0.0.1', port: a.port }], reseau: fetch, essai: false, patience: 800 })).lancer(), /plus aucun pair|aucun pair/);
  assert.equal(a.connexions, 0);
});

test('vidéo trop grosse pour la taille maximale : refusé avant tout téléchargement', async () => {
  const f = fabriquer({ tailleVideo: 100_000 }), [a] = await pairs(f, [{}]), p = lireTorrent(f.torrent);
  await assert.rejects(new Session(options({ empreinte: p.empreinte, partage: p, pairs: [{ ip: '127.0.0.1', port: a.port }], reseau: fetch, tailleMax: 50_000 })).lancer(), /trop grosse/);
  assert.equal(a.demandes, 0);
});

test('envoi aux autres : seulement pendant le téléchargement, limité, coupé à la fin ; rien si coupé', async () => {
  const { fauxDemandeur } = await import('./comete-bt-aides.ts');
  const f = fabriquer({ tailleVideo: 400_000 }), [source] = await pairs(f, [{ delaiBloc: 25 }]), p = lireTorrent(f.torrent);
  const dem = await fauxDemandeur(f); aFermer.push(() => dem.fermer());
  const t0 = Date.now();
  const r = await new Session(options({ empreinte: p.empreinte, partage: p, pairs: [{ ip: '127.0.0.1', port: source.port }, { ip: '127.0.0.1', port: dem.port }], reseau: fetch, envoi: { pendant: true, debitKo: 64, ratio: 1, dureeMin: 0 } })).lancer();
  const duree = (Date.now() - t0) / 1000;
  assert.equal(sha(readFileSync(r.chemin)), sha(f.video));
  assert.ok(dem.recu > 0, 'l\'autre pair a reçu des morceaux pendant le téléchargement');
  assert.ok(r.envoye <= 64_000 * (duree + 1.5) + 32_768, `envoi limité (${r.envoye} octets en ${duree.toFixed(1)} s)`);
  await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(dem.ferme, true, 'coupé une fois le fichier fini');
  // Envoi coupé : rien n'est envoyé.
  const dem2 = await fauxDemandeur(f), [source2] = await pairs(f, [{ delaiBloc: 10 }]); aFermer.push(() => dem2.fermer());
  const r2 = await new Session(options({ empreinte: p.empreinte, partage: p, pairs: [{ ip: '127.0.0.1', port: source2.port }, { ip: '127.0.0.1', port: dem2.port }], reseau: fetch })).lancer();
  assert.equal(r2.envoye, 0); assert.equal(dem2.recu, 0);
});
