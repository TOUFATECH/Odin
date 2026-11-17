// L'envoi de gros fichiers en morceaux : la réception d'un morceau est bornée (place du disque, taille annoncée,
// plafond du dossier des morceaux), pour qu'un envoi — même d'un client qui saute « préparer » — ne puisse pas remplir
// le disque d'Odin. La reprise au bon octet ne change pas ; un morceau rejoué n'abîme rien ; un envoi normal d'Hydre
// et de Vénus passe comme avant. Tout se passe dans des dossiers temporaires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { createServer, request, type IncomingMessage } from 'node:http';
import { fichierEnvoi, recevoirMorceau, type BornesMorceau } from '../src/web/morceaux.ts';
import { idEnvoi } from '../src/valhalla/ymir/bibliotheque.ts';
import { dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { ajouterDossier } from '../src/valhalla/venus/bibliotheque.ts';
import { preparerEnvoi } from '../src/valhalla/venus/envoi.ts';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
/** Un morceau comme l'envoie le navigateur (avec sa taille dans Content-Length). */
const navigateur = (b: Buffer) => Object.assign(Readable.from([b]), { headers: { 'content-length': String(b.length) } }) as unknown as IncomingMessage;
/** Un morceau en flux SANS taille annoncée, en plusieurs paquets (la borne joue en cours de route). */
const flux = (...b: Buffer[]) => Object.assign(Readable.from(b), { headers: {} }) as unknown as IncomingMessage;
const octets = (n: number, c = 0x41) => Buffer.alloc(n, c);
const ENVOI = 'ab'.repeat(12);
/** Un disque de 1 000 000 d'octets dont `libre` sont libres. */
const disque = (libre: number): BornesMorceau['place'] => () => ({ libre, total: 1_000_000 });
const taille = (f: string | undefined) => (f && existsSync(f) ? statSync(f).size : 0);

test('place : un morceau qui ferait tomber le disque sous 10 % libres est refusé AVANT d\'être écrit, la réponse dit pourquoi', async () => {
  const d = tmp('morceaux-place-');
  try {
    // 150 000 libres, 100 000 gardés : 50 000 passent, 50 001 non.
    const ok = await recevoirMorceau(navigateur(octets(50_000)), d, ENVOI, 0, undefined, { place: disque(150_000) });
    assert.deepEqual(ok, { ok: true, recu: 50_000 });
    const non = await recevoirMorceau(navigateur(octets(50_001)), d, ENVOI, 50_000, undefined, { place: disque(100_000) });
    assert.equal(non.ok, false); assert.equal(non.recu, 50_000);
    assert.match(String(non.error), /place insuffisante sur le disque d'Odin.*10 % du disque libres/);
    assert.doesNotMatch(String(non.error), /reprise/, 'le navigateur ne doit pas croire à une reprise (il bouclerait)');
    assert.equal(taille(fichierEnvoi(d, ENVOI)), 50_000, 'rien de plus n\'est écrit');
    // Sans taille annoncée par l'en-tête : refusé en cours de route, et le morceau entamé est retiré.
    const f2 = await recevoirMorceau(flux(octets(30_000), octets(30_000)), d, ENVOI, 50_000, undefined, { place: disque(140_000) });
    assert.equal(f2.ok, false); assert.match(String(f2.error), /place insuffisante/);
    assert.equal(f2.recu, 50_000); assert.equal(taille(fichierEnvoi(d, ENVOI)), 50_000, 'le fichier revient à ce qu\'il était');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('taille annoncée : la fiche d\'envoi borne le fichier ; au-delà, refusé (sans fiche : 64 Go au plus, comme avant)', async () => {
  const d = tmp('morceaux-annonce-');
  try {
    mkdirSync(join(d, '.morceaux'), { recursive: true });
    writeFileSync(join(d, '.morceaux', `${ENVOI}.envoi.json`), JSON.stringify({ nom: 'Film.mp4', taille: 10 }));
    assert.deepEqual(await recevoirMorceau(navigateur(octets(6)), d, ENVOI, 0), { ok: true, recu: 6 });
    const non = await recevoirMorceau(navigateur(octets(5)), d, ENVOI, 6);
    assert.equal(non.ok, false); assert.equal(non.recu, 6);
    assert.match(String(non.error), /dépasserait la taille annoncée \(10 octets\)/); assert.doesNotMatch(String(non.error), /reprise/);
    // En flux sans taille : refusé en cours de route, le morceau est retiré.
    const f2 = await recevoirMorceau(flux(octets(3), octets(3)), d, ENVOI, 6);
    assert.equal(f2.ok, false); assert.equal(taille(fichierEnvoi(d, ENVOI)), 6);
    // Jusqu'à la taille annoncée exactement : accepté.
    assert.deepEqual(await recevoirMorceau(navigateur(octets(4)), d, ENVOI, 6), { ok: true, recu: 10 });
    // Une fiche illisible : refusé, il faut préparer de nouveau.
    const autre = 'cd'.repeat(12);
    writeFileSync(join(d, '.morceaux', `${autre}.envoi.json`), '{pas du json');
    const ill = await recevoirMorceau(navigateur(octets(1)), d, autre, 0);
    assert.equal(ill.ok, false); assert.match(String(ill.error), /fiche de cet envoi illisible/); assert.ok(!existsSync(fichierEnvoi(d, autre)!));
    // Sans fiche, la borne de toujours (ici réduite à 8 octets pour l'essai) : refusée avant d'écrire.
    const sans = 'ef'.repeat(12);
    const lourd = await recevoirMorceau(navigateur(octets(9)), d, sans, 0, 8);
    assert.equal(lourd.ok, false); assert.match(String(lourd.error), /fichier trop lourd/); assert.equal(taille(fichierEnvoi(d, sans)), 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('plafond du dossier des morceaux : des identifiants sans fin ne remplissent pas le disque', async () => {
  const d = tmp('morceaux-plafond-');
  try {
    const bornes = { plafondDossier: 100 };
    const ids = ['01', '02', '03', '04', '05'].map((x) => x.repeat(12));
    for (const id of ids.slice(0, 3)) assert.deepEqual(await recevoirMorceau(navigateur(octets(30)), d, id, 0, undefined, bornes), { ok: true, recu: 30 });
    const non = await recevoirMorceau(navigateur(octets(30)), d, ids[3], 0, undefined, bornes);
    assert.equal(non.ok, false); assert.match(String(non.error), /envois en cours de cette appli occupent déjà.*plafond/); assert.doesNotMatch(String(non.error), /reprise/);
    assert.equal(taille(fichierEnvoi(d, ids[3])), 0);
    // Ce qui tient encore sous le plafond passe.
    assert.deepEqual(await recevoirMorceau(navigateur(octets(10)), d, ids[4], 0, undefined, bornes), { ok: true, recu: 10 });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('reprise inchangée : mauvais octet → « reprise : N », coupure puis suite au bon octet, morceau rejoué sans effet', async () => {
  const d = tmp('morceaux-reprise-'), tout = Buffer.from('0123456789abcdefghij');
  try {
    assert.deepEqual(await recevoirMorceau(navigateur(tout.subarray(0, 8)), d, ENVOI, 0), { ok: true, recu: 8 });
    // Rejoué (même morceau, même début) : rien n'est écrit, la réponse dit où reprendre.
    assert.deepEqual(await recevoirMorceau(navigateur(tout.subarray(0, 8)), d, ENVOI, 0), { ok: false, recu: 8, error: 'reprise : 8 octet(s) déjà reçus, envoie la suite à partir de là' });
    // Coupure : une partie seulement du morceau arrive (requête qui se rompt).
    let n = 0;
    const coupe = new Readable({ read() { if (n++ === 0) this.push(tout.subarray(8, 12)); else this.destroy(new Error('connexion coupée')); } });
    const c = await recevoirMorceau(Object.assign(coupe, { headers: { 'content-length': '8' } }) as unknown as IncomingMessage, d, ENVOI, 8);
    assert.equal(c.ok, false);
    // Ce qui est arrivé reste : le navigateur redemande (mauvais début) et apprend où reprendre.
    let ou = await recevoirMorceau(navigateur(Buffer.alloc(0)), d, ENVOI, 0);
    for (let i = 0; i < 50 && ou.recu !== 12; i++) { await new Promise((ok) => setTimeout(ok, 20)); ou = await recevoirMorceau(navigateur(Buffer.alloc(0)), d, ENVOI, 0); }
    assert.equal(ou.recu, 12, 'la reprise part de l\'octet 12'); assert.match(String(ou.error), /^reprise : 12 octet/);
    assert.deepEqual(await recevoirMorceau(navigateur(tout.subarray(12)), d, ENVOI, 12), { ok: true, recu: 20 });
    assert.deepEqual(readFileSync(fichierEnvoi(d, ENVOI)!), tout, 'le fichier est intact, au bon octet');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

/** Un morceau dont l'essai pousse lui-même les octets (pour l'envoyer EN PARALLÈLE d'un autre). */
const tuyau = (n: number) => Object.assign(new PassThrough(), { headers: { 'content-length': String(n) } });
const occupationReelle = (d: string) => readdirSync(join(d, '.morceaux')).reduce((t, n) => t + statSync(join(d, '.morceaux', n)).size, 0);

test('en parallèle, le plafond du dossier tient : trois morceaux de 80 sous un plafond de 100 → un seul passe', async () => {
  const d = tmp('morceaux-par-plafond-');
  try {
    const rs = [tuyau(80), tuyau(80), tuyau(80)], ids = ['11', '22', '33'].map((x) => x.repeat(12));
    const ps = rs.map((r, i) => recevoirMorceau(r as unknown as IncomingMessage, d, ids[i], 0, undefined, { plafondDossier: 100 }));
    for (const r of rs) r.end(octets(80));
    const res = await Promise.all(ps);
    assert.equal(res.filter((r) => r.ok).length, 1, JSON.stringify(res));
    for (const r of res.filter((x) => !x.ok)) { assert.match(String(r.error), /plafond/); assert.doesNotMatch(String(r.error), /reprise/); }
    assert.ok(occupationReelle(d) <= 100, `occupation ${occupationReelle(d)}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('en parallèle, la place tient : 200 octets à prendre, trois morceaux de 150 → un seul passe', async () => {
  const d = tmp('morceaux-par-place-');
  try {
    const place = () => ({ libre: 300, total: 1000 });
    const rs = [tuyau(150), tuyau(150), tuyau(150)], ids = ['44', '55', '66'].map((x) => x.repeat(12));
    const ps = rs.map((r, i) => recevoirMorceau(r as unknown as IncomingMessage, d, ids[i], 0, undefined, { place }));
    for (const r of rs) r.end(octets(150));
    const res = await Promise.all(ps);
    assert.equal(res.filter((r) => r.ok).length, 1, JSON.stringify(res));
    for (const r of res.filter((x) => !x.ok)) assert.match(String(r.error), /place insuffisante/);
    assert.equal(occupationReelle(d), 150);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('en parallèle, un morceau rejoué n\'abîme rien et la taille annoncée tient', async () => {
  const d = tmp('morceaux-par-rejeu-');
  try {
    mkdirSync(join(d, '.morceaux'), { recursive: true });
    writeFileSync(join(d, '.morceaux', `${ENVOI}.envoi.json`), JSON.stringify({ nom: 'Film.mp4', taille: 10 }));
    const a = tuyau(10), b = tuyau(10);
    const ps = [recevoirMorceau(a as unknown as IncomingMessage, d, ENVOI, 0), recevoirMorceau(b as unknown as IncomingMessage, d, ENVOI, 0)];
    a.end(Buffer.from('0123456789')); b.end(Buffer.from('0123456789'));
    const res = await Promise.all(ps);
    assert.equal(res.filter((r) => r.ok).length, 1, JSON.stringify(res));
    assert.deepEqual(readFileSync(fichierEnvoi(d, ENVOI)!), Buffer.from('0123456789'), 'le fichier n\'est ni doublé ni abîmé');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('coupure avec l\'ancienne requête restée ouverte : la nouvelle reprend au bon octet', async () => {
  const d = tmp('morceaux-par-coupure-'), tout = Buffer.from('ABCDEFGHIJKLMNOPQRST');
  try {
    const vieille = tuyau(20); const pv = recevoirMorceau(vieille as unknown as IncomingMessage, d, ENVOI, 0);
    vieille.write(tout.subarray(0, 5)); // puis plus rien : la connexion ne s'est pas fermée côté Odin
    for (let i = 0; i < 100 && taille(fichierEnvoi(d, ENVOI)) < 5; i++) await new Promise((ok) => setTimeout(ok, 20));
    assert.equal(taille(fichierEnvoi(d, ENVOI)), 5);
    const r = await recevoirMorceau(navigateur(tout.subarray(5)), d, ENVOI, 5);
    assert.deepEqual(r, { ok: true, recu: 20 });
    const v = await pv; assert.equal(v.ok, false); assert.doesNotMatch(String(v.error), /reprise/);
    vieille.end(octets(3)); // ce qui arriverait encore de l'ancienne requête est jeté
    assert.deepEqual(readFileSync(fichierEnvoi(d, ENVOI)!), tout);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('refus en cours de route (morceau sans taille) : la réponse claire parvient au navigateur, pas une coupure', async () => {
  const d = tmp('morceaux-http-');
  mkdirSync(join(d, '.morceaux'), { recursive: true });
  writeFileSync(join(d, '.morceaux', `${ENVOI}.envoi.json`), JSON.stringify({ nom: 'Film.mp4', taille: 10 }));
  const srv = createServer(async (req, res) => { const r = await recevoirMorceau(req, d, ENVOI, 0); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(r)); });
  try {
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as { port: number }).port;
    const rep = await new Promise<string>((ok, ko) => {
      const q = request({ host: '127.0.0.1', port, method: 'POST', path: '/' }, (res) => { let t = ''; res.setEncoding('utf8'); res.on('data', (c) => { t += c; }); res.on('end', () => ok(t)); });
      q.on('error', ko);
      q.write(octets(6)); setTimeout(() => { q.write(octets(6)); q.end(); }, 50); // en-tête « chunked » : aucune taille
    });
    const r = JSON.parse(rep) as { ok: boolean; recu: number; error?: string };
    assert.equal(r.ok, false); assert.match(String(r.error), /taille annoncée/);
    assert.ok(taille(fichierEnvoi(d, ENVOI)) <= 10);
  } finally { await new Promise((ok) => srv.close(ok)); rmSync(d, { recursive: true, force: true }); }
});

/** Un disque fictif bien assez grand : l'envoi normal ne dépend pas de la place du disque de la machine d'essai. */
const grand = disque(900_000);

test('envoi normal d\'Hydre (sans fiche) : trois morceaux de bout en bout, comme avant', async () => {
  const d = tmp('morceaux-hydre-'), iso = Buffer.alloc(300_000, 7), nom = 'systeme.iso', id = idEnvoi(nom, iso.length);
  try {
    let recu = 0;
    for (const t of [0, 100_000, 200_000]) { const r = await recevoirMorceau(navigateur(iso.subarray(t, t + 100_000)), d, id, recu, undefined, { place: grand }); assert.equal(r.ok, true, r.error); recu = r.recu; }
    assert.equal(recu, iso.length); assert.deepEqual(readFileSync(fichierEnvoi(d, id)!), iso);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('envoi normal de Vénus (préparé, fiche écrite) : de bout en bout comme avant ; un octet de trop est refusé', async () => {
  oublierMagasins();
  const home = tmp('morceaux-venus-'), medias = tmp('morceaux-venus-medias-'), dir = dirVenus(home), depot = join(dir, 'depots');
  try {
    const mag = magasinVenus(home, dir); ajouterDossier(mag, medias, 'films');
    const film = Buffer.alloc(250_000, 3);
    const p = preparerEnvoi(mag, depot, { nom: 'Le Voyage (2001).mp4', taille: film.length, dossier: medias });
    let recu = 0;
    for (const t of [0, 100_000, 200_000]) { const r = await recevoirMorceau(navigateur(film.subarray(t, t + 100_000)), depot, p.envoi, recu, undefined, { place: grand }); assert.equal(r.ok, true, r.error); recu = r.recu; }
    assert.equal(recu, film.length); assert.deepEqual(readFileSync(fichierEnvoi(depot, p.envoi)!), film);
    const trop = await recevoirMorceau(navigateur(octets(1)), depot, p.envoi, film.length, undefined, { place: grand });
    assert.equal(trop.ok, false); assert.match(String(trop.error), /taille annoncée/); assert.equal(taille(fichierEnvoi(depot, p.envoi)), film.length);
  } finally { oublierMagasins(); rmSync(home, { recursive: true, force: true }); rmSync(medias, { recursive: true, force: true }); }
});
