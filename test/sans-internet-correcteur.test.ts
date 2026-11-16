// Sans Internet, rien ne casse — vérifications du correcteur.
//
// Quatre défauts corrigés, une preuve chacun. Aucune vraie requête réseau : le fetch est injecté et
// la coupure d'Internet est simulée (fetch qui échoue + sonde injectée), jamais en coupant le réseau.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gather } from '../src/valhalla/modules/volva.ts';
import type { ModCtx } from '../src/valhalla/types.ts';
import { weather, meteoAncienne, resetGladsheim } from '../src/valhalla/modules/gladsheim.ts';
import { fluxAvecInactivite } from '../src/net/fetch-propre.ts';
import { Talos } from '../src/draupnir/service.ts';
import type { Deps, Execution, Workflow } from '../src/draupnir/engine.ts';
import { arreter, demarrer, reinitialiser, sonderMaintenant } from '../src/net/etat-internet.ts';

// Un fetch qui échoue toujours, comme undici hors ligne (« fetch failed » + ENOTFOUND dessous).
const horsLigne = (async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }) as unknown as typeof fetch;

// ---------------------------------------------------------------- Défaut 1 : Pythie (volva)

test('Pythie : une panne de moteur devient un message français, jamais « fetch failed »', async () => {
  const ctx = { settings: {}, fetch: horsLigne, dir: mkdtempSync(join(tmpdir(), 'volva-')) } as unknown as ModCtx;
  const g = await gather(ctx, 'météo mamoudzou demain');
  assert.ok(g.errors.length > 0, 'au moins un moteur en erreur hors ligne');
  const tout = g.errors.join(' ; ');
  assert.doesNotMatch(tout, /fetch failed|ENOTFOUND|undefined/, 'aucune erreur brute montrée');
  assert.match(tout, /ne répond pas|réseau coupé|DNS en panne|introuvable/, 'un motif clair en français');
});

// ---------------------------------------------------------------- Défaut 2 : météo marquée « ancienne »

function forecast(): Response {
  const heures = Array.from({ length: 24 }, (_, i) => `2026-11-16T${String(i).padStart(2, '0')}:00`);
  return new Response(JSON.stringify({
    current: { temperature_2m: 29, apparent_temperature: 30, weather_code: 53, relative_humidity_2m: 80, wind_speed_10m: 10, precipitation: 0 },
    hourly: { time: heures, temperature_2m: heures.map(() => 28) },
    daily: { time: ['2026-11-16', '2026-11-17'], weather_code: [53, 2], temperature_2m_max: [31, 30], temperature_2m_min: [25, 24], sunrise: ['2026-11-16T05:30'], sunset: ['2026-11-16T18:10'] },
  }), { status: 200 });
}

test('Météo : le cache encore montré hors ligne est marqué « ancien »', async () => {
  resetGladsheim();
  let enPanne = false;
  const ctx = {
    settings: { lat: '1', lon: '2', ville: 'Test', villeNom: 'Test' },
    saveSettings() { /* rien */ },
    fetch: (async () => { if (enPanne) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); return forecast(); }) as unknown as typeof fetch,
  } as unknown as ModCtx;

  const frais = await weather(ctx, true);
  assert.ok(frais, 'une première mise à jour réussit');
  assert.equal(meteoAncienne().ancien, false, 'frais : pas ancien');

  enPanne = true;
  const apres = await weather(ctx, true);
  assert.ok(apres, 'le cache est toujours rendu malgré la panne');
  assert.equal(apres!.temp, 29, 'ce sont bien les dernières prévisions');
  assert.equal(meteoAncienne().ancien, true, 'maintenant marqué ancien');
  assert.ok(meteoAncienne().motif, 'un motif accompagne le marquage');
  resetGladsheim();
});

// ---------------------------------------------------------------- Défaut 4 : flux IA, inactivité et non échéance

test('Flux : un flux vivant (octets réguliers) n\'est pas coupé par une échéance', async () => {
  // Émet un octet toutes les 10 ms pendant plus longtemps que le délai d'inactivité de départ : tant que
  // ça parle, rien ne coupe (contrairement à une échéance absolue qui tomberait en plein flux sain).
  let n = 0;
  const source = new ReadableStream<Uint8Array>({
    async pull(c) { if (n++ >= 8) { c.close(); return; } await new Promise((r) => setTimeout(r, 10)); c.enqueue(new Uint8Array([65])); },
  });
  const enveloppe = fluxAvecInactivite(new Response(source, { status: 200 }), 50);
  const lecteur = enveloppe.body!.getReader();
  let recus = 0;
  for (;;) { const { done } = await lecteur.read(); if (done) break; recus++; }
  assert.equal(recus, 8, 'tous les morceaux arrivent, aucun n\'est coupé');
});

// ---------------------------------------------------------------- Défaut 3/6 : Talos reprend au retour

function fluxWeb(): Partial<Workflow> {
  return {
    name: 'Appel météo', active: true,
    nodes: [
      { name: 'Départ', type: 'déclencheur.manuel', params: {} },
      { name: 'Météo', type: 'web.requête', params: { url: 'https://api.open-meteo.com/v1/forecast', méthode: 'GET' } },
    ],
    connections: { 'Départ': [[{ node: 'Météo' }]] },
  };
}

test('Talos : la tâche en attente reprend d\'elle-même au retour d\'Internet', async () => {
  reinitialiser();
  // Hors ligne au départ.
  let coupe = true;
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => !coupe, parIp: async () => !coupe }, intervalleMs: 1e9 });
  await sonderMaintenant();

  const runs: Execution[] = [];
  const deps: Deps = { fetch: horsLigne, sleep: async () => {} };
  const home = mkdtempSync(join(tmpdir(), 'talos-'));
  const dr = new Talos(home, deps, { onRun: (ex) => runs.push(ex) });
  const wf = dr.save(fluxWeb());

  const ex = await dr.run(wf.id, [], 'déclencheur', 'Départ');
  assert.equal(ex.status, 'en-attente-internet', 'hors ligne : en attente, pas en erreur');
  assert.equal(runs.length, 1);

  // Internet revient : la sonde repasse en ligne, Talos doit relancer le flux tout seul (pas au prochain cron).
  coupe = false;
  await sonderMaintenant();
  for (let i = 0; i < 50 && runs.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(runs.length >= 2, 'le flux a été relancé au retour d\'Internet');

  arreter();
  reinitialiser();
});
