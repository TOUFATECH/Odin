// Sphinx, le serveur d'adresses d'Odin : une panne de la prise après le démarrage (carte débranchée, envoi impossible)
// ne fait pas tomber Odin. Le serveur arrête de servir et prévient (journal, et `onError` s'il est donné), comme le
// serveur du réseau à part de Genèse. Prise sur 127.0.0.1 et un port libre choisi par le système : aucun vrai port DHCP.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DhcpServer, type DhcpConfig, type Lease } from '../src/valhalla/vidarr/dhcp.ts';

const config: DhcpConfig = { server: '127.0.0.1', start: '10.9.0.10', end: '10.9.0.20', mask: '255.255.255.0', router: '10.9.0.1', dns: ['10.9.0.1'], leaseSeconds: 3600, fixed: [] };

test('DHCP : une erreur de la prise après le démarrage n\'est pas une exception, le serveur s\'arrête et prévient', async () => {
  let baux: Lease[] = [];
  const journal: string[] = [], erreurs: string[] = [];
  const d = new DhcpServer({ config: () => config, leases: () => baux, save: (l) => { baux = l; }, log: (l) => journal.push(l), onError: (raison) => erreurs.push(raison) });
  await d.start(0, 0, '127.0.0.1');
  const prise = d.sock!; assert.ok(prise, 'la prise est ouverte');
  let ferme = false; prise.once('close', () => { ferme = true; });
  // Avant la correction, aucune écoute des erreurs : emit('error') lance une exception (un process Odin tomberait).
  assert.doesNotThrow(() => prise.emit('error', Object.assign(new Error('send EHOSTUNREACH 255.255.255.255:68'), { code: 'EHOSTUNREACH' })));
  assert.equal(d.sock, undefined, 'le serveur ne sert plus');
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(ferme, true, 'la prise est fermée');
  assert.equal(erreurs.length, 1, 'prévenu une fois'); assert.match(erreurs[0], /EHOSTUNREACH/);
  assert.ok(journal.some((l) => /EHOSTUNREACH/.test(l)), 'noté au journal');
  // Une deuxième erreur (déjà arrêté) ne fait rien de plus.
  assert.doesNotThrow(() => prise.emit('error', new Error('encore')));
  assert.equal(erreurs.length, 1);
});

test('DHCP : sans `onError`, la panne est seulement notée au journal, sans exception', async () => {
  const journal: string[] = [];
  const d = new DhcpServer({ config: () => config, leases: () => [], save: () => {}, log: (l) => journal.push(l) });
  await d.start(0, 0, '127.0.0.1');
  const prise = d.sock!;
  assert.doesNotThrow(() => prise.emit('error', new Error('ENETDOWN')));
  assert.equal(d.sock, undefined);
  assert.ok(journal.some((l) => /ENETDOWN/.test(l)));
});
