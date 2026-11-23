// Comète · le moteur de partage de fichiers, relu en adversaire (sans Internet ; faux pairs sur la machine d'essai) :
//   une IPv6 écrite autrement (« 0::1 », « 0:0:…:1 », mappée, NAT64, 6to4) ne mène jamais à la machine d'Odin ni à la
//   maison ; un pair qui change la taille de la description en cours de route ne remplit pas la mémoire ; un pair qui
//   demande la description en boucle ne fait pas dépasser l'envoi ; la fin du téléchargement reste sous la borne
//   mémoire ; un morceau de bord abîmé dans la vidéo est réparé à la reprise ; un bloc servi est lu seul.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adressePermise } from '../src/valhalla/venus/comete/bt/garde.ts';
import { lireReponseHttp, pairsCompacts } from '../src/valhalla/venus/comete/bt/tracker.ts';
import { ecrire } from '../src/valhalla/venus/comete/bt/bencode.ts';
import { choisirFichier, lireTorrent } from '../src/valhalla/venus/comete/bt/metainfo.ts';
import { BLOC, ID_EXT_METADONNEES } from '../src/valhalla/venus/comete/bt/pair.ts';
import { Session, type OptionsSession } from '../src/valhalla/venus/comete/bt/session.ts';
import { Stockage } from '../src/valhalla/venus/comete/bt/stockage.ts';
import { fabriquer } from './comete-bt-aides.ts';

const dossiers: string[] = [];
const dossier = () => { const d = mkdtempSync(join(tmpdir(), 'comete-bt-surete-')); dossiers.push(d); return d; };
after(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });
const options = (o: Partial<OptionsSession> = {}): OptionsSession => ({
  empreinte: Buffer.alloc(20, 9), trackers: [], pairs: [], dossier: dossier(), signal: new AbortController().signal, progression: () => undefined, tailleMax: 1e9,
  envoi: { pendant: false, debitKo: 0, ratio: 0, dureeMin: 0 }, reseau: (() => { throw new Error('aucun réseau'); }) as never, resoudre: async () => [], essai: true, maxPairs: 5, port: 6881, ...o,
});
// Un pair imaginaire (on regarde ce que la session lui envoie, rien ne sort).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fauxLui = (): { l: any; envoye: () => number } => {
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l: any = { cle: '1.2.3.4:1', champ: Buffer.alloc(0), pieces: new Map(), enVol: 0, demandes: [], ext: {}, metaServies: 0, onEtouffe: false, dernierRecu: Date.now(),
    c: { ip: '1.2.3.4', ouverte: true, enAttente: 0, envoyer: (b: Buffer) => { n += b.length; return true; }, fermer: () => { l.ferme = true; } } };
  return { l, envoye: () => n };
};

test('adresses IPv6 : toutes les écritures de la machine d\'Odin et de la maison refusées, le public permis', () => {
  for (const ip of ['::1', '0::1', '0000::1', '0:0:0:0:0:0:0:1', '::', '0:0:0:0:0:0:0:0', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1', '::ffff:c0a8:101', '0:0:0:0:0:0:7f00:1',
    '64:ff9b::c0a8:101', '64:ff9b::7f00:1', '2002:c0a8:101::1', '2002:7f00:1::1', '2001:0:4136:e378::1', 'fe80::1', 'fec0::1', 'fc00::1', 'fd12::1', 'ff02::1', '2001:db8::1', '100::1', '[0::1]']) {
    assert.equal(adressePermise(ip), false, ip);
  }
  for (const ip of ['2606:4700::1111', '2a00:1450:4007::200e', '64:ff9b::808:808', '2002:808:808::1', '8.8.8.8', '::ffff:8.8.8.8']) assert.equal(adressePermise(ip), true, ip);
  // Les pairs « compacts » IPv6 d'un tracker sont écrits en forme longue : ::1 y devient « 0:0:0:0:0:0:0:1 ».
  const b = Buffer.alloc(18); b[15] = 1; b.writeUInt16BE(6881, 16);
  assert.deepEqual(pairsCompacts(b, true), []);
  assert.deepEqual(lireReponseHttp(ecrire({ peers: [{ ip: Buffer.from('0::1'), port: 6881 }, { ip: Buffer.from('0:0:0:0:0:ffff:c0a8:1'), port: 6881 }] })).pairs, []);
});

test('sans réglage d\'essai, un pair « 0::1 » (la machine d\'Odin en IPv6) n\'est jamais contacté', async (t) => {
  let vues = 0;
  const srv = createServer((s) => { vues++; s.destroy(); });
  const ok = await new Promise<boolean>((r) => { srv.once('error', () => r(false)); srv.listen(0, '::1', () => r(true)); });
  if (!ok) { t.skip('pas d\'IPv6 sur cette machine'); return; }
  const port = (srv.address() as { port: number }).port;
  const s = new Session(options({ pairs: [{ ip: '0::1', port }, { ip: '0:0:0:0:0:0:0:1', port }], essai: false, patience: 1500 }));
  await assert.rejects(s.lancer(), /aucun pair/);
  srv.close();
  assert.equal(vues, 0);
});

test('description (lien magnet) : une taille changée en cours de route est ignorée, la mémoire reste bornée', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any = new Session(options());
  const { l } = fauxLui(); s.eux.add(l);
  s.etendu(l, 0, { m: { ut_metadata: 2 }, metadata_size: 100_000 }, Buffer.alloc(0));
  assert.ok(l.meta, 'la description est demandée');
  s.etendu(l, 0, { m: { ut_metadata: 2 }, metadata_size: 1e12 }, Buffer.alloc(0)); // le pair « change d'avis »
  for (let k = 0; k < 200 && !l.ferme; k++) s.etendu(l, ID_EXT_METADONNEES, { msg_type: 1, piece: k }, Buffer.alloc(BLOC));
  assert.ok(l.ferme, 'le pair qui envoie au-delà de la taille annoncée est coupé');
  assert.ok(s.bannis.has(l.cle));
});

test('un pair qui demande la description en boucle : compté dans l\'envoi, borné, rien si l\'envoi est coupé', () => {
  for (const pendant of [true, false]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = new Session(options({ envoi: { pendant, debitKo: 100, ratio: 1, dureeMin: 0 } }));
    s.partage = { info: Buffer.alloc(8 * BLOC) }; s.stockage = { tailleFichier: 50 * 1024 * 1024 };
    const { l, envoye } = fauxLui(); l.ext = { ut_metadata: 5 }; s.eux.add(l);
    for (let k = 0; k < 10_000; k++) s.etendu(l, ID_EXT_METADONNEES, { msg_type: 0, piece: k % 8 }, Buffer.alloc(0));
    if (pendant) {
      assert.ok(envoye() <= 16 * BLOC + 10_000 * 64, `envoyé ${envoye()} octets`); // deux fois la description au plus, puis des refus courts
      assert.ok(s.envoye > 0 && s.envoye <= 16 * BLOC, 'compté dans l\'envoi');
    } else assert.equal(s.envoye, 0);
  }
});

test('fin du téléchargement : un morceau en double n\'est pas demandé quand la mémoire est pleine', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s: any = new Session(options());
  const TM = 32 * 1024 * 1024, N = 8;
  s.partage = { tailleMorceau: TM, morceaux: Array.from({ length: N }, () => Buffer.alloc(20)), total: TM * N };
  s.stockage = { premier: 0, dernier: N - 1, aLe: () => false, nbRestants: N, get restants() { return [...Array(N).keys()]; } };
  s.memoire = 64 * 1024 * 1024; const autre = {}; for (let i = 0; i < N; i++) s.assignes.set(i, new Set([autre]));
  const { l } = fauxLui(); l.champ = Buffer.from([0xff]);
  assert.equal(s.choisirMorceau(l), undefined);
  s.memoire = 0; assert.equal(s.choisirMorceau(l), 0, 'mémoire libre : le morceau est demandé aussi à ce pair');
});

test('reprise : la part d\'un morceau de bord abîmée dans la vidéo est réécrite depuis sa copie vérifiée ; un bloc servi est lu seul', async () => {
  const f = fabriquer(); const p = lireTorrent(f.torrent); const k = choisirFichier(p), d = dossier();
  const st = new Stockage(p, k, d, 'video.mkv'); await st.ouvrir();
  const i = st.premier; await st.ecrire(i, Buffer.from(f.donnees.subarray(i * f.tailleMorceau, (i + 1) * f.tailleMorceau))); await st.fermer();
  const fd = openSync(st.chemin, 'r+'); writeSync(fd, Buffer.alloc(100, 0x41), 0, 100, 0); closeSync(fd); // coupure avant l'écriture sur le disque
  const st2 = new Stockage(p, k, d, 'video.mkv'); await st2.ouvrir();
  assert.equal(await st2.reprendre(), 1);
  assert.ok(readFileSync(st2.chemin).subarray(0, 100).equals(f.video.subarray(0, 100)), 'la vidéo est réparée');
  assert.equal(st2.nbRestants, st2.dernier - st2.premier);
  const bloc = await st2.lireBloc(i, 1000, 500);
  assert.ok(bloc.equals(f.donnees.subarray(i * f.tailleMorceau + 1000, i * f.tailleMorceau + 1500)));
  await assert.rejects(st2.lireBloc(i + 1, 0, 10), /hors du morceau/); // pas encore vérifié : jamais servi
  await assert.rejects(st2.lireBloc(i, f.tailleMorceau - 10, 100), /hors du morceau/);
  await st2.fermer();
});
