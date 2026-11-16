// Zeus — le client du serveur STRATA (contrat v1, docs/strata-contrat.md), contre un faux serveur sur 127.0.0.1.
// Jamais de valeur inventée : pas de serveur, serveur muet, calcul en cours, JSON cassé, valeur impossible → dit en clair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adresseStrataValide, etat, JOURS_MAX_ODIN, lireReponse, NE_REPOND_PAS, PAS_DE_SERVEUR, prevision } from '../src/valhalla/zeus/strata.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { allModules } from '../src/valhalla/odin.ts';
import { Valhalla } from '../src/valhalla/service.ts';
import { regionDe, setLieuCourant } from '../src/valhalla/lieu.ts';
import { joursCompares, comparaison, lieuZeus, ligneStrata } from '../src/valhalla/modules/zeus.ts';
import type { ModCtx } from '../src/valhalla/types.ts';

const LIEU = { lat: 48.8566, lon: 2.3522, fuseau: 'Europe/Paris' };
const jour = (k: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const bon = (n: number) => ({ modele: 'STRATA', version: 'essai', etat_initial: { source: 'analyse régrillée', date: '2026-11-16T00:00:00Z' }, calcule_a: '2026-11-16T03:12:00Z',
  jours: Array.from({ length: n }, (_, k) => ({ date: jour(k), temperature_max_c: 20.4, temperature_min_c: 10.1, pluie_mm: 0.2, vent_max_kmh: 28, vent_niveau: 'plus_bas_niveau_du_modele', pression_surface_hpa: 1012.3 })) });

async function fauxStrata() {
  const etatSrv = { mode: 'ok' as 'ok' | '503' | 'casse' | 'impossible' | '422' | 'gros', corps: [] as Array<Record<string, unknown>>, vus: [] as string[] };
  const srv = createServer((q, r) => {
    let b = ''; q.on('data', (d) => { b += d; }); q.on('end', () => {
      etatSrv.vus.push(`${q.method} ${q.url}`);
      const json = (code: number, o: unknown, h: Record<string, string> = {}) => { r.writeHead(code, { 'content-type': 'application/json', ...h }); r.end(typeof o === 'string' ? o : JSON.stringify(o)); };
      if (q.url === '/v1/etat') return json(200, { pret: true, modele: 'STRATA', version: 'essai', carte: 'NVIDIA H100 80GB', etat_initial: { source: 'analyse régrillée', date: '2026-11-16T00:00:00Z' }, jours_max: 5 });
      if (q.url === '/v1/prevision' && q.method === 'POST') {
        const c = JSON.parse(b) as Record<string, unknown>; etatSrv.corps.push(c);
        if (etatSrv.mode === '503') return json(503, { erreur: 'calcul en cours' }, { 'retry-after': '120' });
        if (etatSrv.mode === 'casse') return json(200, '{"jours": [');
        if (etatSrv.mode === '422') return json(422, { erreur: 'lieu hors de la grille' });
        if (etatSrv.mode === 'gros') return json(200, JSON.stringify({ ...bon(1), bourrage: 'x'.repeat(70_000) }));
        const o = bon(Number(c.jours));
        if (etatSrv.mode === 'impossible') o.jours[0].temperature_max_c = 75;
        return json(200, o);
      }
      json(400, { erreur: 'demande inconnue' });
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, s: etatSrv, fermer: () => new Promise<void>((ok) => srv.close(() => ok())) };
}

test('adresse du serveur STRATA : maison ou https public ; jamais 169.254, métadonnées, identifiants, ftp', () => {
  for (const ok of ['http://192.168.1.50:8000', 'http://127.0.0.1:9000/', 'http://strata.local:8000', 'https://strata.exemple.org', 'http://10.0.0.2']) assert.equal(adresseStrataValide(ok).ok, true, ok);
  assert.equal((adresseStrataValide('http://192.168.1.50:8000/') as { url: string }).url, 'http://192.168.1.50:8000');
  for (const ko of ['http://169.254.169.254', 'http://169.254.169.254/latest/meta-data', 'http://[fe80::1]', 'http://metadata.google.internal', 'http://100.100.100.200', 'http://user:pass@192.168.1.50', 'ftp://192.168.1.50', 'http://strata.exemple.org', 'http://0.0.0.0:8000', 'pas une adresse', '', 'http://192.168.1.50/?x=1']) assert.equal(adresseStrataValide(ko).ok, false, ko);
});

test('client STRATA : état, prévision (200), 503 avec Retry-After, JSON cassé, valeur hors bornes, 422, trop gros, serveur muet, jamais plus de 3 jours', async (tt) => {
  const f = await fauxStrata(); tt.after(() => f.fermer());
  // Pas de serveur : rien d'inventé.
  const sans = await prevision(fetch, '', LIEU, 3);
  assert.deepEqual(sans, { ok: false, couleur: 'gris', texte: PAS_DE_SERVEUR });
  assert.equal(PAS_DE_SERVEUR, 'STRATA : pas de serveur avec carte NVIDIA, prédiction non disponible');
  const e = await etat(fetch, f.url);
  assert.ok(e.ok); assert.equal(e.data.carte, 'NVIDIA H100 80GB'); assert.equal(e.data.joursMax, 5);
  // 200 : position arrondie à 0,01°, fuseau, jamais plus de 3 jours même si on en demande 10.
  const p = await prevision(fetch, f.url, LIEU, 10);
  assert.ok(p.ok);
  assert.deepEqual(f.s.corps.at(-1), { latitude: 48.86, longitude: 2.35, fuseau: 'Europe/Paris', jours: JOURS_MAX_ODIN });
  assert.equal(p.data.jours.length, 3);
  assert.deepEqual({ ...p.data.jours[0], jour: '' }, { jour: '', tmax: 20.4, tmin: 10.1, pluie: 0.2, vent: 28, pression: 1012.3, ventNiveau: 'plus_bas_niveau_du_modele', ventApproche: true });
  // 503 avec Retry-After.
  f.s.mode = '503';
  const c = await prevision(fetch, f.url, LIEU, 3);
  assert.equal(c.ok, false); assert.equal((c as { reessayerDans: number }).reessayerDans, 120); assert.match((c as { texte: string }).texte, /^Souci : le serveur STRATA calcule encore/);
  // JSON cassé.
  f.s.mode = 'casse';
  assert.deepEqual(await prevision(fetch, f.url, LIEU, 3), { ok: false, couleur: 'rouge', texte: 'Souci : réponse STRATA illisible' });
  // Valeur hors bornes.
  f.s.mode = 'impossible';
  const im = await prevision(fetch, f.url, LIEU, 3);
  assert.equal(im.ok, false); assert.match((im as { texte: string }).texte, /^Souci : valeur impossible \(température max de 75 °C/);
  // 422 : non couvert, en gris.
  f.s.mode = '422';
  const nc = await prevision(fetch, f.url, LIEU, 3);
  assert.equal((nc as { couleur: string }).couleur, 'gris'); assert.match((nc as { texte: string }).texte, /lieu hors de la grille/);
  // Plus de 64 Ko : refusé.
  f.s.mode = 'gros';
  assert.equal((await prevision(fetch, f.url, LIEU, 1)).ok, false);
  // Adresse refusée : aucun appel.
  const n = f.s.vus.length;
  const r = await prevision(fetch, 'http://169.254.169.254', LIEU, 3);
  assert.equal(r.ok, false); assert.match((r as { texte: string }).texte, /adresse du serveur STRATA refusée/); assert.equal(f.s.vus.length, n);
  // Serveur muet.
  assert.deepEqual(await prevision(fetch, 'http://127.0.0.1:1', LIEU, 3), { ok: false, couleur: 'rouge', texte: NE_REPOND_PAS });
  // Lecture pure : null gardé, jamais 0 inventé ; vent à 10 m non « approché ».
  const l = lireReponse({ jours: [{ date: '2026-11-17', temperature_max_c: null, temperature_min_c: 5, pluie_mm: null, vent_max_kmh: 10, vent_niveau: '10m', pression_surface_hpa: null }] });
  assert.ok(l.ok); assert.equal(l.data.jours[0].tmax, null); assert.equal(l.data.jours[0].pluie, null); assert.equal(l.data.jours[0].ventApproche, false);
  assert.equal(lireReponse({ jours: [{ date: '2026-11-17', temperature_max_c: 5, temperature_min_c: 9 }] }).ok, false, 'min au-dessus du max');
  assert.equal(lireReponse({ pas: 'de jours' }).ok, false);
});

test('Zeus et STRATA : non branché en gris, réglé mais muet en rouge, branché : comparé, vent approché non compté', async (tt) => {
  const f = await fauxStrata(); tt.after(() => f.fermer());
  setLieuCourant({ nom: 'Villessai', ...LIEU, region: regionDe('FR') }); tt.after(() => setLieuCourant(undefined));
  const home = mkdtempSync(join(tmpdir(), 'zeus-strata-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never)); tt.after(() => { v.stop(); rmSync(home, { recursive: true, force: true }); });
  const z = v.modules().find((m) => m.id === 'zeus')!, ctx = v.ctx('zeus') as ModCtx, act = (a: string, i: Record<string, unknown> = {}) => z.actions.find((x) => x.id === a)!.run(ctx, i);
  assert.deepEqual(ligneStrata(ctx), { titre: 'STRATA · Non branché', detail: PAS_DE_SERVEUR, tone: 'neutre', mot: 'Non branché' });
  assert.match((await act('essayer_strata')).text, /pas de serveur avec carte NVIDIA/);
  // Adresse refusée à l'enregistrement.
  const k = await act('regler_strata', { adresse: 'http://169.254.169.254' });
  assert.equal(k.ok, false); assert.equal(ctx.settings.strata, undefined);
  // Réglé mais muet : rouge.
  assert.equal((await act('regler_strata', { adresse: 'http://127.0.0.1:1' })).ok, true);
  const m = await act('essayer_strata');
  assert.equal(m.ok, false); assert.equal(ligneStrata(ctx).tone, 'mauvais'); assert.equal(ligneStrata(ctx).detail, NE_REPOND_PAS);
  // Branché : la réponse est gardée ; comparée avec l'information récupérée (faux Open-Meteo).
  const om = createServer((q, r) => { const u = new URL(q.url!, 'http://x'); const ms = (u.searchParams.get('models') ?? '').split(','); const d: Record<string, unknown> = { time: [jour(0), jour(1), jour(2)] }; for (const mo of ms) for (const [vv, x] of [['temperature_2m_max', 20], ['temperature_2m_min', 10], ['precipitation_sum', 0], ['wind_speed_10m_max', 10]] as const) d[`${vv}_${mo}`] = [x, x, x]; r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ daily: d })); });
  await new Promise<void>((ok) => om.listen(0, '127.0.0.1', () => ok())); tt.after(() => new Promise<void>((ok) => om.close(() => ok())));
  ctx.saveSettings({ adressePrevisions: `http://127.0.0.1:${(om.address() as { port: number }).port}/v1/forecast` });
  await act('regler_strata', { adresse: f.url });
  const ok = await act('essayer_strata');
  assert.equal(ok.ok, true); assert.match(ok.text, /vent approché/); assert.match(ligneStrata(ctx).titre, /Branché/);
  assert.notEqual(ligneStrata(ctx).tone, 'bon', 'la ligne STRATA ne se met jamais en vert toute seule');
  const j = joursCompares(ctx, await comparaison(ctx, lieuZeus()!, true), 3);
  const s0 = j[0].preds.find((p) => p.source === 'STRATA');
  assert.ok(s0, 'STRATA est comparé');
  assert.deepEqual(s0!.nonComptees, ['vent'], 'le vent approché (28 km/h contre 10) n\'est pas compté');
  assert.equal(j[0].verdict.mot, 'OK');
  // Le nombre d'appels : un seul /v1/prevision par essai.
  assert.equal(f.s.vus.filter((x) => x.startsWith('POST')).length, 1);
});
