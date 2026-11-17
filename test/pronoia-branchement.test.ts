// Prónoia — les greffes dans Odin : les demandes du propriétaire (passerelle) et les événements des applis (Valhalla).
// Jamais bloquantes, rien quand Prónoia est absente ou coupée, rien en mode privé, jamais une personne suivie.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Valhalla } from '../src/valhalla/service.ts';
import { pronoia, moteurPronoia, oublierMoteursPronoia } from '../src/valhalla/pronoia/index.ts';
import { noterDemandeOdin, relayerEvenement, oublierRelais, optionsOdin } from '../src/valhalla/pronoia/branchement.ts';
import type { Module } from '../src/valhalla/types.ts';

const homes: string[] = [];
after(() => { oublierMoteursPronoia(); for (const h of homes) rmSync(h, { recursive: true, force: true }); });
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const domus: Module = { id: 'domus', name: 'Domus essai', family: 'Maison', what: 'essai', does: ['essai'], from: [], upstream: [], words: ['essai'], actions: [], view: () => ({ sections: [] }) };

function monter() {
  const home = mkdtempSync(join(tmpdir(), 'pronoia-greffe-')); homes.push(home);
  const mod = pronoia(() => optionsOdin({ cfg: {} }));
  const v = new Valhalla(home, [mod, domus], { notify: async () => {} });
  mod.start?.(v.ctx('pronoia'));
  return { home, v, p: moteurPronoia(home)! };
}

test('sans Prónoia démarrée, les greffes ne font rien et ne lèvent pas', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pronoia-vide-')); homes.push(home);
  assert.doesNotThrow(() => noterDemandeOdin(home, 'quelle météo demain', false));
  assert.doesNotThrow(() => relayerEvenement(home, { module: 'domus', type: 'x', at: new Date().toISOString() }));
  assert.doesNotThrow(() => relayerEvenement(home, null as never));
  assert.equal(moteurPronoia(home), undefined);
});

test('les événements des applis rejoignent Prónoia après coup ; une personne ou un sujet inconnu, jamais', async () => {
  const { v, p } = monter();
  // hors de la liste blanche : ignoré tant que le propriétaire n'a pas ouvert la source
  v.ctx('domus').emit('porte_ouverte', { cle: 'garage' });
  await attendre(50);
  assert.equal(p.magasin.etat.evenements.length, 0, 'source pas ouverte : rien');
  p.ouvrirSource('domus/porte_ouverte'); p.ouvrirSource('domus/personne_vue'); p.ouvrirSource('domus/arrivee');
  v.ctx('domus').emit('porte_ouverte', { cle: 'garage' });
  v.ctx('domus').emit('personne_vue', { cle: 'Marie (voisine)' });
  v.ctx('domus').emit('arrivee', { cle: 'x', sujet: 'Paul' });
  assert.equal(p.magasin.etat.evenements.length, 0, 'rien dans le fil de l\'appli : après coup');
  await attendre(50);
  assert.deepEqual(p.magasin.etat.evenements.map((e) => `${e.appli}/${e.type}/${e.cle}`), ['domus/porte_ouverte/garage']);
  p.couper();
  v.ctx('domus').emit('porte_ouverte', { cle: 'garage' });
  await attendre(50);
  assert.equal(p.magasin.etat.evenements.length, 1, 'coupée : plus rien');
});

test('une demande du propriétaire est apprise (après coup) ; en mode privé ou coupée, rien', async () => {
  oublierRelais();
  const { home, p } = monter();
  noterDemandeOdin(home, 'quelle météo demain à Lyon', true);
  await attendre(20);
  assert.equal(p.magasin.etat.demandes.length, 0, 'mode privé');
  noterDemandeOdin(home, 'quelle météo demain à Lyon', false);
  await attendre(20);
  assert.equal(p.magasin.etat.demandes.length, 1);
  p.couper();
  noterDemandeOdin(home, 'quelle météo demain à Lyon', false);
  await attendre(20);
  assert.equal(p.magasin.etat.demandes.length, 1, 'coupée');
});

test('le mode privé d\'Odin vaut pour Prónoia', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pronoia-prive-')); homes.push(home);
  const mod = pronoia(() => optionsOdin({ cfg: { voice: { privacy: { privateMode: true } } } }));
  const v = new Valhalla(home, [mod, domus], { notify: async () => {} });
  mod.start?.(v.ctx('pronoia'));
  v.ctx('domus').emit('porte_ouverte', { cle: 'garage' });
  noterDemandeOdin(home, 'quelle météo demain à Lyon', false);
  await attendre(50);
  const p = moteurPronoia(home)!;
  assert.equal(p.magasin.etat.evenements.length + p.magasin.etat.demandes.length, 0);
});
