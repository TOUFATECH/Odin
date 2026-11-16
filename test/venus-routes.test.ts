// Vénus · le dispatcher des routes (src/valhalla/venus/routes.ts), piloté avec de FAUX req/res (aucun serveur, aucun
// service réel) : déclarer un dossier et lancer un scan (dossier vide → chaîne branchée), ouvrir une œuvre (épisodes),
// créer une demande native, écrire l'historique à l'ouverture d'un flux, et la garde du flux de diffusion (jeton).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { venusRoute } from '../src/valhalla/venus/routes.ts';
import { dirVenus, magasinVenus, oublierMagasins } from '../src/valhalla/venus/base.ts';
import { historique } from '../src/valhalla/venus/bibliotheque.ts';
import { jetonFlux } from '../src/valhalla/venus/cast.ts';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

function fakeReq(method: string, body?: unknown): IncomingMessage {
  const r = Readable.from(body !== undefined ? [Buffer.from(JSON.stringify(body))] : []) as unknown as IncomingMessage;
  (r as unknown as { method: string }).method = method;
  (r as unknown as { headers: Record<string, string> }).headers = {};
  return r;
}
class FakeRes extends Writable {
  code?: number;
  body = '';
  writeHead(code: number): this { this.code = code; return this; }
  _write(chunk: Buffer, _enc: string, cb: () => void): void { this.body += chunk.toString(); cb(); }
}
async function appel(home: string, method: string, pathAndQuery: string, body?: unknown, o: { proprietaire?: boolean } = {}): Promise<{ handled: boolean; code?: number; json: Record<string, unknown> }> {
  const url = new URL(`http://x${pathAndQuery}`);
  const res = new FakeRes();
  const ctx = { home, proprietaire: () => o.proprietaire !== false, fail: () => undefined, origin: 'http://odin', ip: '127.0.0.1', profil: 'moi' };
  const handled = await venusRoute(fakeReq(method, body), res as unknown as ServerResponse, url, ctx);
  // Attendre la fin de la réponse (un flux direct se diffuse après coup) avant de lire / nettoyer.
  if (!res.writableFinished) await new Promise<void>((r) => { res.once('finish', () => r()); res.once('close', () => r()); setTimeout(r, 300); });
  let parsed: Record<string, unknown> = {};
  try { parsed = res.body ? JSON.parse(res.body) as Record<string, unknown> : {}; } catch { /* flux binaire : pas du JSON */ }
  return { handled, code: res.code, json: parsed };
}

test('déclarer un dossier puis scanner (dossier vide → bilan 0, mais la chaîne est branchée)', async () => {
  const home = tmp('venus-rt-'), vide = tmp('venus-media-');
  try {
    oublierMagasins();
    let r = await appel(home, 'POST', '/venus/dossiers', { chemin: vide, categorie: 'films' });
    assert.equal(r.code, 200); assert.ok((r.json.dossiers as Array<{ chemin: string }>).some((d) => d.chemin === vide), 'dossier déclaré');
    r = await appel(home, 'GET', '/venus/dossiers');
    assert.ok((r.json.dossiers as unknown[]).length >= 1);
    r = await appel(home, 'POST', '/venus/scan');
    assert.equal(r.code, 200); assert.equal((r.json.bilan as { oeuvres: number }).oeuvres, 0, 'dossier vide : rien, mais scan branché');
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(vide, { recursive: true, force: true }); }
});

test('/venus/oeuvre rend l\'œuvre et ses épisodes (série), ou 404', async () => {
  const home = tmp('venus-rt-');
  try {
    oublierMagasins();
    const m = magasinVenus(home, dirVenus(home));
    m.poser('oeuvres', 'serie:x', { type: 'serie', titre: 'Série X' });
    m.poser('episodes', 'serie:x:s1e1', { oeuvre_id: 'serie:x', saison: 1, episode: 1, titre: 'Pilote', fichier: '/x/s1e1.mkv', duree: 1200 });
    let r = await appel(home, 'GET', '/venus/oeuvre/serie:x');
    assert.equal(r.code, 200); assert.equal((r.json.oeuvre as { titre: string }).titre, 'Série X'); assert.equal((r.json.episodes as unknown[]).length, 1);
    r = await appel(home, 'GET', '/venus/oeuvre/inconnu');
    assert.equal(r.code, 404);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('POST /venus/demandes crée une demande native (dans VENUS_ODIN)', async () => {
  const home = tmp('venus-rt-');
  try {
    oublierMagasins();
    let r = await appel(home, 'POST', '/venus/demandes', { titre: 'Un film absent', type: 'film' });
    assert.equal(r.code, 200); assert.equal((r.json.demandes as unknown[]).length, 1);
    assert.equal((r.json.demandes as Array<{ titre: string }>)[0].titre, 'Un film absent');
    r = await appel(home, 'GET', '/venus/demandes');
    assert.equal((r.json.demandes as unknown[]).length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('/venus/flux : refusé sans session ni jeton (401), accepté avec un jeton de diffusion', async () => {
  const home = tmp('venus-rt-');
  try {
    oublierMagasins();
    const m = magasinVenus(home, dirVenus(home));
    m.poser('oeuvres', 'film:z', { type: 'film', titre: 'Film Z' }); // sans fichier : on teste la garde, pas le flux réel
    let r = await appel(home, 'GET', '/venus/flux/film:z', undefined, { proprietaire: false });
    assert.equal(r.code, 401, 'sans session ni jeton : refusé');
    const j = jetonFlux(home, 'film:z');
    r = await appel(home, 'GET', `/venus/flux/film:z?cle=${encodeURIComponent(j)}`, undefined, { proprietaire: false });
    assert.equal(r.code, 404, 'jeton accepté → on atteint le flux (404 : pas de fichier ici, et non 401)');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('ouvrir un flux (fichier direct) écrit l\'historique (privé) à l\'ouverture', async () => {
  const home = tmp('venus-rt-'), media = tmp('venus-media-');
  const f = join(media, 'film.mp4');
  writeFileSync(f, Buffer.from('fake mp4 bytes for a direct stream'));
  try {
    oublierMagasins();
    const m = magasinVenus(home, dirVenus(home));
    m.poser('oeuvres', 'film:z', { type: 'film', titre: 'Film Z', fichier: f });
    await appel(home, 'GET', '/venus/flux/film:z'); // propriétaire par défaut
    assert.equal(historique(m, 'moi').length, 1, 'l\'historique est noté à l\'ouverture');
    assert.equal(historique(m, 'moi')[0].cible_id, 'film:z');
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});
