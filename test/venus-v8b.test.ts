// Vénus, la maison (lot V8, seconde part), côté Odin : les versions légères 720p et 480p préparées par Odin (une
// conversion locale à la fois, bornée, jamais un service extérieur) et la liste des téléchargements de Downloads.js
// (en attente, préparation, prêt, échec ; « Enregistrer », supprimer ; gardées 7 jours). Aucun réseau, aucun vrai
// FFmpeg : un faux convertisseur écrit le fichier ; le magasin de Vénus en fichiers ; de faux req/res.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirVenus, magasinVenus, oublierMagasins, type MagasinVenus } from '../src/valhalla/venus/base.ts';
import { venusRoute } from '../src/valhalla/venus/routes.ts';
import { argsLegere, attendreHorsLigne, demanderLegere, dossierHorsLigne, fichierPret, GARDE_MS, MAX_PAR_PROFIL, planifier, reglerOutilsHorsLigne, supprimerLegere, taches } from '../src/valhalla/venus/hors-ligne.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'venus-hors-ligne-'));
const MOI = 'moi', AWA = 'p:awa';

/** Un film (avec son vrai fichier, inventé) et une série d'un épisode. */
function bibli(m: MagasinVenus, media: string): void {
  const f = join(media, 'Le Phare (2020).mkv'); writeFileSync(f, Buffer.alloc(4096, 3));
  m.poser('oeuvres', 'film:a', { type: 'film', titre: 'Le Phare', annee: 2020, duree: 6000, fichier: f });
  const e = join(media, 'Les Iles S01E01.mkv'); writeFileSync(e, Buffer.alloc(1024, 4));
  m.poser('oeuvres', 'serie:s', { type: 'serie', titre: 'Les Îles' });
  m.poser('episodes', 'serie:s:s1e1', { oeuvre_id: 'serie:s', saison: 1, episode: 1, titre: 'Les Îles', fichier: e, duree: 2700 });
}
/** Le faux FFmpeg : il écrit le fichier de sortie (dernier argument), donne un avancement, et réussit (ou non). */
function fauxConvertisseur(o: { reussir?: boolean; octets?: number } = {}) {
  const vus: string[][] = [];
  const convertir = (args: string[], progres: (s: number) => void) => {
    vus.push(args); progres(3000);
    if (o.reussir !== false) writeFileSync(args[args.length - 1], Buffer.alloc(o.octets ?? 777, 1));
    return { fin: Promise.resolve(o.reussir !== false), tuer() {} };
  };
  return { vus, convertir };
}

test('versions légères : les arguments de FFmpeg (entrée protégée, jamais agrandie, avancement lisible, sortie MP4)', () => {
  const a = argsLegere('/m/film.mkv', '720p', '/o/x.part.mp4');
  const i = a.indexOf('-i');
  assert.deepEqual(a.slice(i - 4, i), ['-protocol_whitelist', 'file', '-format_whitelist', a[i - 1]], 'seulement le protocole « file » et des lecteurs vidéo');
  assert.equal(a[i + 1], '/m/film.mkv');
  assert.ok(a.includes('scale=-2:trunc(min(720\\,ih)/2)*2'), 'jamais plus grand que l’original');
  assert.ok(a.includes('libx264') && a.includes('aac') && a.includes('+faststart'));
  assert.deepEqual(a.slice(a.indexOf('-progress'), a.indexOf('-progress') + 2), ['-progress', 'pipe:1']);
  assert.equal(a.at(-1), '/o/x.part.mp4');
  assert.ok(argsLegere('/m/film.mkv', '480p', '/o/y.mp4').includes('scale=-2:trunc(min(480\\,ih)/2)*2'));
});

test('versions légères : demander, préparer (une à la fois), prêt, fichier, supprimer ; enfant, qualité, limite', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    const faux = fauxConvertisseur();
    reglerOutilsHorsLigne({ convertir: faux.convertir, ffmpegLa: async () => true, placeLibre: () => 1e15, attenteMs: 1 });
    assert.deepEqual(demanderLegere(m, { profil: 'p:noe', enfant: true, itemId: 'film:a', quality: '720p' }), { erreur: 'Un profil enfant ne télécharge pas.', code: 403 });
    assert.equal((demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '1080p' }) as { code: number }).code, 400);
    assert.equal((demanderLegere(m, { profil: MOI, itemId: 'serie:s', quality: '720p' }) as { code: number }).code, 404, 'une série entière : pas une vidéo');
    assert.equal((demanderLegere(m, { profil: MOI, itemId: 'inconnu', quality: '720p' }) as { code: number }).code, 404);
    const t1 = demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '720p' }) as { id: string; state: string; title: string };
    assert.equal(t1.state, 'queued'); assert.equal(t1.title, 'Le Phare');
    const encore = demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '720p' }) as { id: string };
    assert.equal(encore.id, t1.id, 'la même version déjà demandée n’est pas refaite');
    const t2 = demanderLegere(m, { profil: MOI, itemId: 'serie:s:s1e1', quality: '480p' }) as { id: string; title: string };
    assert.equal(t2.title, 'Les Îles S01E01');
    await planifier(m); await attendreHorsLigne();
    assert.equal(faux.vus.length, 2, 'les deux, l’une après l’autre');
    const l = taches(m, MOI);
    assert.deepEqual(l.map((x) => x.state), ['ready', 'ready']);
    const a = l.find((x) => x.id === t1.id)!;
    assert.equal(a.progress, 100); assert.equal(a.size, 777); assert.equal(a.quality, '720p'); assert.equal(a.name, 'Le Phare (720p).mp4');
    const f = fichierPret(m, MOI, t1.id)!;
    assert.ok(f && existsSync(f.chemin) && f.chemin.startsWith(dossierHorsLigne(m)));
    assert.equal(fichierPret(m, AWA, t1.id), undefined, 'un autre profil ne le voit pas');
    assert.equal(taches(m, AWA).length, 0);
    assert.equal(supprimerLegere(m, AWA, t1.id), false);
    assert.equal(supprimerLegere(m, MOI, t1.id), true);
    assert.ok(!existsSync(f.chemin), 'le fichier est effacé avec la ligne'); assert.equal(taches(m, MOI).length, 1);
    // limite par profil
    for (let k = 0; k < MAX_PAR_PROFIL; k++) m.poser('hors_ligne', `dl-${String(k).padStart(12, '0')}`, { profil: AWA, cible: 'film:a', titre: 'x', quality: k % 2 ? '720p' : '480p', etat: 'error', cree: k });
    assert.equal((demanderLegere(m, { profil: AWA, itemId: 'serie:s:s1e1', quality: '720p' }) as { code: number }).code, 409);
  } finally { reglerOutilsHorsLigne(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

test('versions légères : FFmpeg absent, conversion ratée, gardées 7 jours, reprise après un redémarrage', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    reglerOutilsHorsLigne({ convertir: fauxConvertisseur().convertir, ffmpegLa: async () => false, placeLibre: () => 1e15, attenteMs: 1 });
    const t1 = demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '720p' }) as { id: string };
    await planifier(m); await attendreHorsLigne();
    let x = taches(m, MOI)[0];
    assert.equal(x.state, 'error'); assert.equal(x.reason, 'ffmpeg'); assert.match(String(x.error), /FFmpeg est introuvable/);
    supprimerLegere(m, MOI, t1.id);
    // pas assez de place sur le disque d'Odin
    reglerOutilsHorsLigne({ convertir: fauxConvertisseur().convertir, ffmpegLa: async () => true, placeLibre: () => 1000, attenteMs: 1 });
    demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '480p' });
    await planifier(m); await attendreHorsLigne();
    x = taches(m, MOI)[0]; assert.equal(x.reason, 'place'); supprimerLegere(m, MOI, x.id);
    // FFmpeg échoue : rien de partiel ne reste
    reglerOutilsHorsLigne({ convertir: fauxConvertisseur({ reussir: false }).convertir, ffmpegLa: async () => true, placeLibre: () => 1e15, attenteMs: 1 });
    demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '720p' });
    await planifier(m); await attendreHorsLigne();
    x = taches(m, MOI)[0]; assert.equal(x.state, 'error'); assert.equal(x.reason, 'echec');
    assert.deepEqual(readdirSync(dossierHorsLigne(m)).filter((n) => n.endsWith('.part.mp4')), []);
    supprimerLegere(m, MOI, x.id);
    // prêt, puis gardé 7 jours seulement
    reglerOutilsHorsLigne({ convertir: fauxConvertisseur().convertir, ffmpegLa: async () => true, placeLibre: () => 1e15, attenteMs: 1 });
    const t3 = demanderLegere(m, { profil: MOI, itemId: 'film:a', quality: '720p' }) as { id: string };
    await planifier(m); await attendreHorsLigne();
    const chemin = fichierPret(m, MOI, t3.id)!.chemin;
    assert.equal(taches(m, MOI, Date.now() + GARDE_MS - 60_000).length, 1);
    assert.equal(taches(m, MOI, Date.now() + GARDE_MS + 60_000).length, 0, 'au-delà de 7 jours, la version légère est effacée');
    assert.ok(!existsSync(chemin));
    // une préparation coupée par un arrêt d'Odin reprend au prochain passage
    m.poser('hors_ligne', 'dl-aaaaaaaaaaaa', { profil: MOI, cible: 'film:a', titre: 'Le Phare', quality: '480p', etat: 'working', progress: 40, cree: Date.now() });
    await planifier(m); await attendreHorsLigne();
    assert.equal(taches(m, MOI).find((y) => y.id === 'dl-aaaaaaaaaaaa')?.state, 'ready');
  } finally { reglerOutilsHorsLigne(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- les routes
function fakeReq(method: string, body?: unknown, headers: Record<string, string> = { 'x-odin': '1' }): IncomingMessage {
  const r = Readable.from(body !== undefined ? [Buffer.from(JSON.stringify(body))] : []) as unknown as IncomingMessage;
  Object.assign(r, { method, headers });
  return r;
}
class FakeRes extends Writable {
  code?: number; body = ''; entetes: Record<string, string> = {};
  writeHead(code: number, h: Record<string, string> = {}): this { this.code = code; this.entetes = h; return this; }
  _write(chunk: Buffer, _e: string, cb: () => void): void { this.body += chunk.toString(); cb(); }
}
async function appel(home: string, method: string, chemin: string, body?: unknown, o: { proprietaire?: boolean; headers?: Record<string, string> } = {}) {
  const res = new FakeRes();
  const ctx = { home, proprietaire: () => o.proprietaire !== false, fail: () => undefined, origin: 'http://odin.test', ip: '127.0.0.1', profil: MOI };
  const handled = await venusRoute(fakeReq(method, body, o.headers), res as unknown as ServerResponse, new URL(`http://x${chemin}`), ctx);
  if (!res.writableFinished) await new Promise<void>((r) => { res.once('finish', () => r()); setTimeout(r, 500); });
  let json: unknown = {}; try { json = JSON.parse(res.body) as unknown; } catch { /* pas du JSON */ }
  return { handled, code: res.code, json: json as Record<string, unknown>, body: res.body, entetes: res.entetes };
}

test('routes des téléchargements : garde, en-tête x-odin, liste, « Enregistrer » (nom propre, aucun chemin), supprimer', async () => {
  const home = tmp(), media = tmp();
  try {
    oublierMagasins(); const m = magasinVenus(home, dirVenus(home)); bibli(m, media);
    reglerOutilsHorsLigne({ convertir: fauxConvertisseur({ octets: 1500 }).convertir, ffmpegLa: async () => true, placeLibre: () => 1e15, attenteMs: 1 });
    let r = await appel(home, 'GET', '/venus/api/telechargements');
    assert.equal(r.code, 200); assert.deepEqual(r.json, []);
    r = await appel(home, 'POST', '/venus/api/telechargements', { itemId: 'film:a', quality: '720p' }, { headers: {} });
    assert.equal(r.code, 403, 'une écriture sans en-tête x-odin est refusée');
    r = await appel(home, 'POST', '/venus/api/telechargements', { itemId: 'film:a', quality: '720p' });
    assert.equal(r.code, 200); const id = String(r.json.id); assert.match(id, /^dl-[0-9a-f]{12}$/);
    r = await appel(home, 'POST', '/venus/api/telechargements', { itemId: 'film:a', quality: '360p' }); assert.equal(r.code, 400);
    await attendreHorsLigne();
    r = await appel(home, 'GET', '/venus/api/telechargements');
    const l = r.json as unknown as Array<Record<string, unknown>>;
    assert.equal(l.length, 1); assert.equal(l[0].state, 'ready'); assert.equal(l[0].size, 1500);
    assert.ok(!JSON.stringify(l).includes(media) && !JSON.stringify(l).includes(home), 'aucun chemin de la machine dans la liste');
    r = await appel(home, 'GET', `/venus/api/telechargements/${id}/fichier`);
    assert.equal(r.code, 200); assert.equal(r.body.length, 1500);
    assert.match(r.entetes['content-disposition'], /^attachment; filename="Le Phare \(720p\)\.mp4"; filename\*=UTF-8''Le%20Phare%20%28720p%29\.mp4$/);
    r = await appel(home, 'GET', '/venus/api/telechargements/dl-000000000000/fichier'); assert.equal(r.code, 404);
    r = await appel(home, 'GET', '/venus/api/telechargements', undefined, { proprietaire: false }); assert.equal(r.code, 401, 'garde du propriétaire');
    r = await appel(home, 'POST', `/venus/api/telechargements/${id}`, { faire: 'supprimer' }); assert.equal(r.code, 200);
    r = await appel(home, 'GET', '/venus/api/telechargements'); assert.deepEqual(r.json, []);
    r = await appel(home, 'POST', `/venus/api/telechargements/${id}`, { faire: 'supprimer' }); assert.equal(r.code, 404);
    // le vote garde ses adresses (la troisième partie d'une adresse n'est « clore » que pour lui)
    r = await appel(home, 'POST', '/venus/api/vote/ABCD/fichier', {}); assert.equal(r.code, 404);
  } finally { reglerOutilsHorsLigne(); rmSync(home, { recursive: true, force: true }); rmSync(media, { recursive: true, force: true }); }
});
