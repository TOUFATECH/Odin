// Zeus et STRATA : depuis le 17/11/2026, le serveur STRATA (modèle de recherche de NVIDIA, un modèle qui n'est pas
// celui d'Odin) n'est plus interrogé, même quand son adresse est réglée ; une ancienne réponse gardée n'est plus lue
// ni comparée. La ligne STRATA reste grise et le dit. Un faux serveur sur 127.0.0.1 vérifie qu'il ne reçoit plus rien.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as strata from '../src/valhalla/zeus/strata.ts';
import { adresseStrataValide, etat, PAS_DE_SERVEUR, PLUS_INTERROGE } from '../src/valhalla/zeus/strata.ts';
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

test('client STRATA : plus aucun appel, même avec une adresse valide ; rien d\'inventé', async (tt) => {
  const f = await fauxStrata(); tt.after(() => f.fermer());
  assert.deepEqual(await etat(fetch, ''), { ok: false, couleur: 'gris', texte: PAS_DE_SERVEUR });
  assert.deepEqual(await etat(fetch, f.url), { ok: false, couleur: 'gris', texte: PLUS_INTERROGE });
  assert.equal('prevision' in strata, false, 'plus de demande de prévision');
  assert.match(PLUS_INTERROGE, /plus interrogé[\s\S]*pas encore entraîné/);
  assert.deepEqual(f.s.vus, [], 'le serveur STRATA n\'a reçu aucune demande');
});

test('Zeus et STRATA : non branché en gris ; réglé, il reste gris et n\'est jamais appelé ; une ancienne réponse n\'est plus comparée', async (tt) => {
  const f = await fauxStrata(); tt.after(() => f.fermer());
  setLieuCourant({ nom: 'Villessai', ...LIEU, region: regionDe('FR') }); tt.after(() => setLieuCourant(undefined));
  const home = mkdtempSync(join(tmpdir(), 'zeus-strata-'));
  const v = new Valhalla(home, allModules({ paths: { home, workspace: home }, cfg: DEFAULT_CONFIG } as never)); tt.after(() => { v.stop(); rmSync(home, { recursive: true, force: true }); });
  const z = v.modules().find((m) => m.id === 'zeus')!, ctx = v.ctx('zeus') as ModCtx, act = (a: string, i: Record<string, unknown> = {}) => z.actions.find((x) => x.id === a)!.run(ctx, i);
  assert.deepEqual(ligneStrata(ctx), { titre: 'STRATA · Non branché', detail: PAS_DE_SERVEUR, tone: 'neutre', mot: 'Non branché' });
  // Adresse refusée à l'enregistrement (la vérification reste).
  const k = await act('regler_strata', { adresse: 'http://169.254.169.254' });
  assert.equal(k.ok, false); assert.equal(ctx.settings.strata, undefined);
  // Réglé : jamais appelé, la ligne reste grise et dit pourquoi.
  assert.equal((await act('regler_strata', { adresse: f.url })).ok, true);
  assert.deepEqual(ligneStrata(ctx), { titre: 'STRATA · —', detail: PLUS_INTERROGE, tone: 'neutre', mot: '—' });
  const e = await act('essayer_strata');
  assert.equal(e.ok, false); assert.equal(ligneStrata(ctx).tone, 'neutre'); assert.match(e.text, /plus interrogé/);
  assert.match((await act('regler_strata', { adresse: f.url })).text, /plus interrogé/, 'le réglage ne promet plus d\'appel quotidien');
  // Une réponse STRATA gardée d'avant le retrait : plus lue, plus comparée.
  ctx.saveSettings({ strataDernier: { at: new Date().toISOString(), ok: true, jours: [{ jour: jour(0), tmax: 20, tmin: 10, pluie: 0, vent: 10, pression: 1012, ventApproche: false }] } });
  assert.doesNotMatch(ligneStrata(ctx).titre, /Branché/);
  const om = createServer((q, r) => { const u = new URL(q.url!, 'http://x'); const ms = (u.searchParams.get('models') ?? '').split(','); const d: Record<string, unknown> = { time: [jour(0), jour(1), jour(2)] }; for (const mo of ms) for (const [vv, x] of [['temperature_2m_max', 20], ['temperature_2m_min', 10], ['precipitation_sum', 0], ['wind_speed_10m_max', 10]] as const) d[`${vv}_${mo}`] = [x, x, x]; r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify({ daily: d })); });
  await new Promise<void>((ok) => om.listen(0, '127.0.0.1', () => ok())); tt.after(() => new Promise<void>((ok) => om.close(() => ok())));
  ctx.saveSettings({ adressePrevisions: `http://127.0.0.1:${(om.address() as { port: number }).port}/v1/forecast` });
  const j = joursCompares(ctx, await comparaison(ctx, lieuZeus()!, true), 3);
  assert.equal(j[0].preds.some((p) => p.source === 'STRATA'), false, 'STRATA n\'est plus comparé');
  assert.deepEqual(f.s.vus, [], 'le serveur STRATA n\'a reçu aucune demande');
});
