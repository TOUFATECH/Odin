// Talos : un nœud qui a besoin d'Internet attend son retour au lieu d'échouer en boucle.
// La coupure est simulée (fetch injecté + sonde injectée), jamais en coupant le réseau de la machine.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execute } from '../src/draupnir/engine.ts';
import type { Deps, Workflow } from '../src/draupnir/engine.ts';
import { CATALOG } from '../src/draupnir/nodes.ts';
import { besoinInternet } from '../src/draupnir/attente-internet.ts';
import { arreter, demarrer, reinitialiser, sonderMaintenant } from '../src/net/etat-internet.ts';

function fluxWeb(): Workflow {
  return {
    id: 'w1', name: 'Appel météo', active: true,
    nodes: [
      { name: 'Départ', type: 'déclencheur.manuel', params: {} },
      { name: 'Météo', type: 'web.requête', params: { url: 'https://api.open-meteo.com/v1/forecast', méthode: 'GET' } },
    ],
    connections: { 'Départ': [[{ node: 'Météo' }]] },
  };
}

const horsLigne = (async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }) as unknown as typeof fetch;

async function couper(): Promise<void> {
  reinitialiser();
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => false, parIp: async () => false }, intervalleMs: 1e9 });
  await sonderMaintenant();
}

test('besoinInternet : reconnaît les nœuds qui parlent à l\'extérieur', () => {
  const web = { name: 'x', type: 'web.requête', params: {} };
  const local = { name: 'y', type: 'saga.lire', params: {} };
  const repondre = { name: 'z', type: 'web.répondre', params: {} };
  assert.equal(besoinInternet(web, CATALOG), true);
  assert.equal(besoinInternet(local, CATALOG), false);
  assert.equal(besoinInternet(repondre, CATALOG), false);
});

test('Hors ligne : le nœud passe « en-attente-internet », pas « erreur »', async () => {
  await couper();
  const deps: Deps = { fetch: horsLigne };
  const ex = await execute(fluxWeb(), CATALOG, deps, { node: 'Départ', mode: 'déclencheur' });
  assert.equal(ex.status, 'en-attente-internet');
  assert.equal(ex.failedNode, 'Météo');
  assert.match(ex.error!, /attend le retour d'Internet/);
  arreter();
  reinitialiser();
});

test('Retour d\'Internet : l\'automatisation est replanifiée', async () => {
  await couper();
  let coupe = true;
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => !coupe, parIp: async () => !coupe }, intervalleMs: 1e9 });
  await sonderMaintenant();
  const rejoues: string[] = [];
  const deps: Deps = { fetch: horsLigne, replanifierFlux: (id) => rejoues.push(id) };
  const ex = await execute(fluxWeb(), CATALOG, deps, { node: 'Départ', mode: 'déclencheur' });
  assert.equal(ex.status, 'en-attente-internet');
  assert.deepEqual(rejoues, []); // pas encore : toujours hors ligne
  // Internet revient : la sonde repasse en ligne, la replanification se déclenche.
  coupe = false;
  await sonderMaintenant();
  assert.deepEqual(rejoues, ['w1']);
  arreter();
  reinitialiser();
});

test('En ligne : une vraie panne reste « erreur » (on n\'avale pas tout)', async () => {
  reinitialiser();
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => true, parIp: async () => true }, intervalleMs: 1e9 });
  await sonderMaintenant();
  const deps: Deps = { fetch: horsLigne };
  const ex = await execute(fluxWeb(), CATALOG, deps, { node: 'Départ', mode: 'déclencheur' });
  assert.equal(ex.status, 'erreur');
  arreter();
  reinitialiser();
});
