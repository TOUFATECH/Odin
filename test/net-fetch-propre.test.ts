// fetch-propre : délai maximal, délai d'inactivité, classeur d'erreurs en français, attente croissante.
// Aucune vraie requête réseau : fetch est injecté.
import assert from 'node:assert/strict';
import test from 'node:test';
import { classerErreur, fetchPropre, fluxAvecInactivite } from '../src/net/fetch-propre.ts';
import { etatInternet, reinitialiser } from '../src/net/etat-internet.ts';

test('Classeur : chaque panne devient un message français clair (jamais une erreur brute)', () => {
  assert.match(classerErreur({ code: 'ENOTFOUND' }, 'api.open-meteo.com').message, /DNS en panne/);
  assert.match(classerErreur({ code: 'ECONNREFUSED' }, 'exemple.fr').message, /refuse la connexion/);
  assert.match(classerErreur({ name: 'TimeoutError' }, 'exemple.fr').message, /ne répond pas/);
  assert.match(classerErreur({ code: 'ENETUNREACH' }, 'exemple.fr').message, /réseau coupé/);
  assert.equal(classerErreur({ name: 'TimeoutError' }, 'x').etat, 'muet');
  // Codes HTTP.
  assert.match(classerErreur(undefined, 'x', 429).message, /limite le débit/);
  assert.equal(classerErreur(undefined, 'x', 429).etat, 'limite');
  assert.match(classerErreur(undefined, 'x', 403).message, /refusé l'accès/);
  assert.match(classerErreur(undefined, 'x', 503).message, /a répondu 503/);
  // Jamais de « fetch failed » / « ENOTFOUND » bruts dans le message.
  for (const e of [{ message: 'fetch failed', cause: { code: 'ENOTFOUND' } }, { code: 'ECONNRESET' }]) {
    assert.doesNotMatch(classerErreur(e, 'x').message, /fetch failed|ENOTFOUND|ECONNRESET/);
  }
});

test('fetchPropre : ne jette jamais et rend un message propre', async () => {
  reinitialiser();
  const faux = (async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }) as unknown as typeof fetch;
  const r = await fetchPropre('https://api.open-meteo.com/x', { fetch: faux, hote: 'api.open-meteo.com' });
  assert.equal(r.ok, false);
  assert.match(r.erreur!, /DNS en panne/);
  // Le registre des services a été alimenté.
  assert.equal(etatInternet().services['api.open-meteo.com']!.etat, 'muet');
  reinitialiser();
});

test('fetchPropre : attente croissante entre les essais', async () => {
  reinitialiser();
  const attentes: number[] = [];
  const faux = (async () => { throw Object.assign(new Error('x'), { code: 'ECONNRESET' }); }) as unknown as typeof fetch;
  const r = await fetchPropre('https://exemple.fr', { fetch: faux, essais: 3, sleep: async (ms) => { attentes.push(ms); } });
  assert.equal(r.ok, false);
  // 1er échec immédiat, puis 1 s, 2 s, 4 s (plafonné à 60 s).
  assert.deepEqual(attentes, [1_000, 2_000, 4_000]);
  reinitialiser();
});

test('fetchPropre : succès rend la réponse et marque le service « ok »', async () => {
  reinitialiser();
  const faux = (async () => new Response('bonjour', { status: 200 })) as unknown as typeof fetch;
  const r = await fetchPropre('https://exemple.fr', { fetch: faux, hote: 'exemple.fr' });
  assert.equal(r.ok, true);
  assert.equal(r.statut, 200);
  assert.equal(await r.reponse!.text(), 'bonjour');
  assert.equal(etatInternet().services['exemple.fr']!.etat, 'ok');
  reinitialiser();
});

test('Flux : le délai d\'inactivité coupe un téléchargement qui gèle', async () => {
  const source = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array([1, 2, 3])); /* puis plus rien : gèle */ },
  });
  const rep = new Response(source, { status: 200 });
  const enveloppe = fluxAvecInactivite(rep, 30);
  const lecteur = enveloppe.body!.getReader();
  const premier = await lecteur.read();
  assert.equal(premier.done, false);
  await assert.rejects(() => lecteur.read(), /inactivité/);
});
