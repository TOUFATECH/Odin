// Vénus · la chaîne d'acquisition, relue en adversaire : le réseau (connexion à l'adresse vérifiée, jamais Odin ni la
// maison, aucune redirection suivie), un flux piégé qui ne bloque pas Odin, un serveur qui ment sur la taille, les noms
// que Windows réserve. SANS réseau : un serveur local (127.0.0.1), et le passage par lui est un réglage d'essai explicite.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fetchBorne, fetchVerifie } from '../src/valhalla/venus/reseau.ts';
import { MOTEUR_DIRECT, nomSur, reglerOutilsComete, reseauComete, reseauDelta } from '../src/valhalla/venus/comete/index.ts';
import { lireFlux, masquer } from '../src/valhalla/venus/delta/index.ts';
import { hoteInterdit } from '../src/valhalla/lien.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

let port = 0, connexions = 0, hotes: string[] = [];
const srv = createServer((req, res) => {
  connexions++; hotes.push(String(req.headers.host));
  const u = new URL(req.url!, 'http://x');
  if (u.pathname === '/redirige') { res.writeHead(302, { location: `http://127.0.0.1:${port}/ok` }); res.end(); return; }
  // Le menteur : annonce 1000 octets à la sonde, puis envoie 40 Mo quand on demande le fichier.
  if (u.pathname === '/menteur.mkv') {
    if (req.headers.range === 'bytes=0-0') { res.writeHead(206, { 'content-range': 'bytes 0-0/1000', 'content-length': 1 }); res.end(Buffer.from([0x1a])); return; }
    res.writeHead(200); let n = 0; const morceau = Buffer.alloc(64 * 1024, 1);
    const pousser = () => { while (n < 40 * 1024 * 1024) { n += morceau.length; if (!res.write(morceau)) { res.once('drain', pousser); return; } } res.end(); };
    res.on('error', () => undefined); pousser(); return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
});
const dossier = mkdtempSync(join(tmpdir(), 'venus-surete-'));
before(async () => { srv.listen(0, '127.0.0.1'); await once(srv, 'listening'); port = (srv.address() as AddressInfo).port; });
after(() => { srv.close(); reglerOutilsComete(); rmSync(dossier, { recursive: true, force: true }); });

test('le réseau : la connexion part vers l\'adresse vérifiée (un seul passage par la résolution des noms)', async () => {
  let resolutions = 0;
  // Réglage d'essai explicite : la boucle locale est permise ICI seulement (refuser = jamais).
  const f = fetchVerifie({ resoudre: async (h) => { resolutions++; return h === 'epingle.exemple.test' ? ['127.0.0.1'] : []; }, refuser: () => undefined });
  hotes = [];
  const r = await f(`http://epingle.exemple.test:${port}/ok`);
  assert.equal(r.status, 200); assert.equal(await r.text(), 'ok');
  assert.equal(resolutions, 1, 'le nom n\'est résolu qu\'une fois');
  assert.deepEqual(hotes, [`epingle.exemple.test:${port}`], 'le nom reste dans Host, la connexion va à l\'adresse vérifiée');
  const red = await f(`http://epingle.exemple.test:${port}/redirige`, { redirect: 'manual' });
  assert.equal(red.status, 302, 'aucune redirection suivie');
});

test('le réseau : la machine d\'Odin, l\'hébergeur et la maison refusés, même par un nom qui y mène, sans connexion', async () => {
  const avant = connexions;
  const delta = fetchVerifie({ resoudre: async (h) => (h === 'piege.exemple.test' ? ['93.184.216.34', '127.0.0.1'] : h === 'meta.exemple.test' ? ['169.254.169.254'] : []), refuser: (a) => (hoteInterdit(a) ? 'refusé' : undefined) });
  await assert.rejects(delta(`http://piege.exemple.test:${port}/ok`), /refusé/, 'une seule adresse interdite suffit');
  await assert.rejects(delta(`http://meta.exemple.test:${port}/ok`), /refusé/);
  reglerOutilsComete(); // les défauts : jamais la boucle locale
  for (const h of ['127.0.0.1', '[::1]', '[::ffff:127.0.0.1]', '169.254.169.254', '0.0.0.0']) {
    await assert.rejects(reseauDelta()(`http://${h}:${port}/ok`), /machine d'Odin/, `Delta : ${h}`);
    await assert.rejects(reseauComete()(`http://${h}:${port}/ok`), /refusé/, `Comète : ${h}`);
  }
  await assert.rejects(reseauComete()(`http://192.168.1.10:${port}/ok`), /ton réseau/, 'Comète : la maison');
  await assert.rejects(reseauComete()(`http://[fd00::1]:${port}/ok`), /ton réseau/);
  assert.equal(connexions, avant, 'aucune connexion n\'est partie');
});

test('un serveur qui annonce 1000 octets puis en envoie 40 Mo : arrêté à la taille annoncée, le disque ne se remplit pas', async () => {
  const local = (u: string, i?: RequestInit) => fetch(u.replace('http://fichiers.exemple.test', `http://127.0.0.1:${port}`), i);
  reglerOutilsComete({ resoudre: async () => ['93.184.216.34'], reseauEssai: local });
  const ctx = { modules: () => [] } as unknown as ModCtx;
  let max = 0;
  const p = MOTEUR_DIRECT.telecharger(ctx, 'http://fichiers.exemple.test/menteur.mkv', { nom: 'c-menteur.mkv', dossier, signal: new AbortController().signal, progression: (fait) => { max = Math.max(max, fait); }, tailleMax: 1e9 });
  await assert.rejects(p, /plus que la taille annoncée/);
  for (const f of readdirSync(dossier)) assert.ok(statSync(join(dossier, f)).size <= 1000, `${f} : ${statSync(join(dossier, f)).size} octets`);
  assert.ok(max <= 1000 + 64 * 1024, `reçu ${max} octets`);
  // Pas la place : rien ne part.
  const avant = connexions;
  await assert.rejects(MOTEUR_DIRECT.telecharger(ctx, 'http://fichiers.exemple.test/menteur.mkv', { nom: 'c-place.mkv', dossier, signal: new AbortController().signal, progression: () => undefined, tailleMax: 1e9, place: () => { throw new Error('pas assez de place'); } }), /pas assez de place/);
  assert.equal(connexions, avant + 1, 'seule la sonde est partie');
  reglerOutilsComete();
});

test('une réponse bornée : au-delà, la lecture s\'arrête en erreur', async () => {
  const r = await fetchBorne(async () => new Response('x'.repeat(5000)), 1000)('http://x/');
  await assert.rejects(r.text(), /plus que la taille annoncée/);
});

test('un flux piégé ne bloque pas Odin : « <item » sans fin, balises jamais fermées, CDATA ouverts', () => {
  const t0 = Date.now();
  assert.deepEqual(lireFlux('<item '.repeat(600_000), { id: 's', nom: 'S' }), []);
  assert.deepEqual(lireFlux(`<item>${'<title '.repeat(10_000)}${'<![CDATA['.repeat(5_000)}${'<torznab:attr '.repeat(4_000)}</item>`.repeat(50), { id: 's', nom: 'S' }), []);
  assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
  // Le flux normal se lit toujours, entités et CDATA compris.
  const l = lireFlux('<rss><channel><item><title><![CDATA[Film.2024.1080p &amp; co]]></title><enclosure url="https://exemple.test/f/film.mkv?a=1&amp;b=2" length="1234" type="video/x-matroska"/><torznab:attr name="seeders" value="7"/></item></channel></rss>', { id: 's', nom: 'S' });
  assert.equal(l.length, 1); assert.equal(l[0].titre, 'Film.2024.1080p & co'); assert.equal(l[0].lien, 'https://exemple.test/f/film.mkv?a=1&b=2');
  assert.equal(l[0].taille, 1234); assert.equal(l[0].sources, 7); assert.equal(l[0].direct, true);
});

test('les noms : jamais un nom réservé par Windows, ni caractère invisible ou de sens d\'écriture', () => {
  for (const n of ['CON', 'nul', 'Aux', 'COM1', 'lpt9', 'NUL.mkv', 'con .txt']) assert.doesNotMatch(nomSur(n), /^(con|prn|aux|nul|com\d|lpt\d)(\s*\..*)?$/i, n);
  assert.equal(nomSur('CON'), 'CON_');
  assert.equal(nomSur('Film‮vkm.exe'), 'Film vkm.exe');
  assert.equal(nomSur('Titre\u0085​'), 'Titre');
  assert.equal(nomSur('Console'), 'Console', 'un nom qui commence pareil reste');
});

test('la clé d\'une source est masquée dans un texte, telle quelle ou écrite dans une adresse', () => {
  assert.equal(masquer('x apikey=a%2Bb%2Fc y a+b/c', 'a+b/c'), 'x apikey=… y …');
});
