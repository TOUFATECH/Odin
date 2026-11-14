// Plage IP ajoutée (odin web reseau 192.168.1.0/24) : autorisée en plus du réseau détecté, tout de suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { Gateway } from '../src/bifrost/gateway.ts';
import { addedNetworks, addNetwork, allowedNetworks, plageAutorisable, removeNetwork } from '../src/web/access.ts';
import { WebChannel, ensureWebToken } from '../src/web/server.ts';
import { makeOdin } from './helpers.ts';

test('plage à ajouter : privée, /16 au plus, ramenée à son début', () => {
  assert.deepEqual(plageAutorisable(' 192.168.1.37/24 '), { ok: true, cidr: '192.168.1.0/24' });
  assert.deepEqual(plageAutorisable('10.0.0.0/16'), { ok: true, cidr: '10.0.0.0/16' });
  assert.deepEqual(plageAutorisable('172.20.5.0/24'), { ok: true, cidr: '172.20.5.0/24' });
  assert.deepEqual(plageAutorisable('fd12:3456:789a:1::/64'), { ok: true, cidr: 'fd12:3456:789a:1::/64' });
  for (const b of ['8.8.8.0/24', '10.0.0.0/8', '192.168.1.0', '0.0.0.0/0', '127.0.0.0/24', '2a01:e0a::/64', 'n\'importe quoi']) assert.equal(plageAutorisable(b).ok, false, b);
});

test('plages ajoutées : sans doublon, retrait, en plus du réseau détecté ou configuré', () => {
  const o = makeOdin([]);
  try {
    assert.deepEqual(addedNetworks(o.paths.home), []);
    assert.equal(addNetwork(o.paths.home, '192.168.5.0/24'), true);
    assert.equal(addNetwork(o.paths.home, '192.168.5.0/24'), false);
    assert.equal(addNetwork(o.paths.home, 'pas une plage'), false);
    assert.deepEqual(addedNetworks(o.paths.home), ['192.168.5.0/24']);
    const web = { ...o.cfg.web, allowedNetworks: ['10.1.0.0/24'] };
    assert.deepEqual(allowedNetworks(web, addedNetworks(o.paths.home)), ['10.1.0.0/24', '192.168.5.0/24']);
    assert.equal(removeNetwork(o.paths.home, '192.168.5.0/24'), true);
    assert.equal(removeNetwork(o.paths.home, '192.168.5.0/24'), false);
    assert.deepEqual(addedNetworks(o.paths.home), []);
  } finally { o.cleanup(); }
});

// Le vrai parcours depuis une adresse privée de la machine qui n'est pas dans la liste
// (ajoutée sur l'interface de bouclage pour l'essai : ip addr add 10.99.0.5/32 dev lo).
const dispo = Object.values(networkInterfaces()).flat().some((a) => a?.address === '10.99.0.5');

test('appareil hors du réseau : coupé ; plage ajoutée : accepté tout de suite, sans redémarrer', { skip: dispo ? false : 'adresse d\'essai 10.99.0.5 absente' }, async () => {
  const o = makeOdin([]);
  const p = 21000 + Math.floor(Math.random() * 20000), token = ensureWebToken(o.paths);
  const gw = new Gateway(o, { owners: { web: ['*'] } });
  gw.add(new WebChannel(o, { scanNetwork: async () => undefined }, { port: p, host: '0.0.0.0', token, access: 'lan' }));
  await gw.start();
  const appel = () => new Promise<number>((ok, ko) => {
    const r = request({ host: '10.99.0.5', localAddress: '10.99.0.5', port: p, path: '/api/state', headers: { host: `10.99.0.5:${p}` } }, (res) => { res.resume(); ok(res.statusCode!); });
    r.on('error', ko); r.end();
  });
  try {
    await assert.rejects(appel(), /ECONNRESET|socket hang up/, 'pas dans le réseau : aucune réponse (inchangé)');
    assert.equal(addNetwork(o.paths.home, '10.99.0.0/24'), true);
    assert.equal(await appel(), 401, 'plage ajoutée : passe la porte, connexion demandée');
    assert.equal(removeNetwork(o.paths.home, '10.99.0.0/24'), true);
    await assert.rejects(appel(), /ECONNRESET|socket hang up/, 'plage retirée : de nouveau coupé');
  } finally { await gw.stop(); o.cleanup(); }
});
