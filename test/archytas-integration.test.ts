// Essai d'intégration de la fenêtre Script : on crée un script par l'API, puis on le retrouve dans la liste ET dans
// le suivi. Le vrai couplage est l'API HTTP /api/archytas/* : tant que le lot A (le vrai moteur et ses routes) n'est
// pas posé, on branche le moteur conforme au contrat (fauxServeur) — c'est exactement ce qu'il remplacera. Une sonde
// signale, sans échouer, quand le lot A est présent pour qu'on y rebranche.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fauxMoteur, fauxServeur, fauxNavigateur } from './archytas-fixtures.ts';

function charger() {
  const nav = fauxNavigateur();
  const ctx = vm.createContext(nav.sandbox);
  vm.runInContext(readFileSync(new URL('../src/web/pages/archytas-suivi.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(readFileSync(new URL('../src/web/pages/archytas.js', import.meta.url), 'utf8'), ctx);
  return nav;
}

test('intégration : créer un script par l\'API, le retrouver dans la liste puis dans le suivi', async () => {
  const nav = charger();
  const win = nav.window as unknown as { OdinArchytas: { monter: (h: unknown, c?: unknown) => Record<string, (...a: unknown[]) => Promise<unknown> | unknown> & { etat: Record<string, unknown> } }; OdinDialog?: unknown; OdinArchytasSuivi: unknown };
  const moteur = fauxMoteur();
  const serveur = fauxServeur(moteur);
  nav.brancherServeur(serveur.fetch);
  // Le propriétaire répond aux deux questions de création (nom tiré de la mission, puis la mission).
  const reponses = ['ranger-le-garage', 'ranger le garage le samedi'];
  win.OdinDialog = { prompt: async () => reponses.shift() ?? null, confirm: async () => true, alert: async () => {} };

  const host = nav.make('div');
  const ctrl = win.OdinArchytas.monter(host, {});
  await ctrl.recharger();
  const avant = moteur.data.length;

  await ctrl.creer();
  // Le moteur a bien reçu le nouveau script par l'API (POST /creer).
  assert.ok(serveur.journal.some((x) => x.chemin === '/creer'), 'un POST /creer a été envoyé');
  assert.equal(moteur.data.length, avant + 1, 'le moteur a un script de plus');
  assert.ok(moteur.data.some((d) => d.nom === 'ranger-le-garage'), 'le script est bien dans le moteur');

  // On le retrouve dans la LISTE.
  await ctrl.recharger();
  const texte = () => (host as unknown as { textContent: string }).textContent;
  assert.match(texte(), /ranger-le-garage/, 'le nouveau script apparaît dans la liste');

  // On le retrouve dans le SUIVI (il n'a jamais servi → section « Jamais utilisés »).
  ctrl.onglet('suivi');
  assert.match(texte(), /Jamais utilisés/, 'le suivi montre la section des scripts jamais utilisés');
  assert.match(texte(), /ranger-le-garage/, 'le nouveau script est suivi');
});

test('intégration : sonde du lot A (le vrai moteur), sans faire échouer tant qu\'il n\'est pas posé', () => {
  const dossier = new URL('../src/valhalla/archytas/', import.meta.url);
  const present = existsSync(dossier);
  if (!present) { assert.ok(true, 'lot A pas encore posé : le couplage reste l\'API HTTP (fauxServeur) — à rebrancher quand src/valhalla/archytas/ existera'); return; }
  // Quand le lot A est là, au minimum son moteur et son câblage doivent exister (noms du contrat).
  assert.ok(existsSync(new URL('scripts.ts', dossier)), 'src/valhalla/archytas/scripts.ts est posé par le lot A');
  assert.ok(existsSync(new URL('liens.ts', dossier)), 'src/valhalla/archytas/liens.ts (brancherArchytas) est posé par le lot A');
});
