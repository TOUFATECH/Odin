// La sonde Internet partagée : les quatre états, le registre des services, le retour en ligne.
// La coupure est simulée par de fausses sondes injectées : jamais en coupant le réseau de la machine.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  arreter, auRetour, demarrer, enLigne, etatInternet, marquerService,
  reinitialiser, sonderMaintenant, surChangement,
} from '../src/net/etat-internet.ts';
import type { Sondes } from '../src/net/etat-internet.ts';

function sondes(p: { passerelle: boolean | null; nom: boolean; ip: boolean }): Sondes {
  return { passerelle: async () => p.passerelle, parNom: async () => p.nom, parIp: async () => p.ip };
}

async function etatAvec(p: { passerelle: boolean | null; nom: boolean; ip: boolean }): Promise<string> {
  reinitialiser();
  demarrer({ sondes: sondes(p), intervalleMs: 1e9 });
  await sonderMaintenant();
  const r = etatInternet().reseau;
  arreter();
  return r;
}

test('Sonde : les quatre états sont bien classés', async () => {
  assert.equal(await etatAvec({ passerelle: true, nom: true, ip: true }), 'en-ligne');
  assert.equal(await etatAvec({ passerelle: false, nom: false, ip: false }), 'sans-reseau');
  assert.equal(await etatAvec({ passerelle: true, nom: false, ip: true }), 'dns-muet');
  assert.equal(await etatAvec({ passerelle: true, nom: false, ip: false }), 'reseau-sans-internet');
  // Passerelle inconnue (null) + tout échoue : réseau sans Internet (on ne force pas « sans-reseau »).
  assert.equal(await etatAvec({ passerelle: null, nom: false, ip: false }), 'reseau-sans-internet');
  assert.equal(await etatAvec({ passerelle: null, nom: true, ip: true }), 'en-ligne');
  reinitialiser();
});

test('Sonde : surChangement n\'est appelé qu\'aux vrais changements', async () => {
  reinitialiser();
  const vus: string[] = [];
  surChangement((e) => vus.push(e.reseau));
  demarrer({ sondes: sondes({ passerelle: false, nom: false, ip: false }), intervalleMs: 1e9 });
  await sonderMaintenant(); // en-ligne -> sans-reseau : un changement
  await sonderMaintenant(); // sans-reseau -> sans-reseau : rien
  assert.deepEqual(vus, ['sans-reseau']);
  arreter();
  reinitialiser();
});

test('Sonde : auRetour se déclenche quand Internet revient', async () => {
  reinitialiser();
  let coupe = true;
  demarrer({ sondes: { passerelle: async () => true, parNom: async () => !coupe, parIp: async () => !coupe }, intervalleMs: 1e9 });
  await sonderMaintenant();
  assert.equal(enLigne(), false);
  let repris = 0;
  auRetour(() => { repris++; });
  coupe = false;
  await sonderMaintenant();
  assert.equal(enLigne(), true);
  assert.equal(repris, 1);
  // Ne se redéclenche pas tout seul au passage suivant.
  await sonderMaintenant();
  assert.equal(repris, 1);
  arreter();
  reinitialiser();
});

test('Registre des services : marquerService garde depuis / dernier / motif', async () => {
  reinitialiser();
  marquerService('api.open-meteo.com', 'muet', 'ne répond pas');
  const s1 = etatInternet().services['api.open-meteo.com'];
  assert.equal(s1!.etat, 'muet');
  assert.equal(s1!.motif, 'ne répond pas');
  assert.equal(s1!.depuis, s1!.dernier);
  // Même état : « depuis » ne bouge pas, « dernier » suit.
  await new Promise((r) => setTimeout(r, 2));
  marquerService('api.open-meteo.com', 'muet', 'toujours muet');
  const s2 = etatInternet().services['api.open-meteo.com'];
  assert.equal(s2!.depuis, s1!.depuis);
  assert.ok(s2!.dernier >= s1!.dernier);
  reinitialiser();
});
