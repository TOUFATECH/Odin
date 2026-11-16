// Lot B « répondre vite » : les vecteurs des souvenirs sont décodés UNE fois et gardés en RAM (plus de
// décodage base64 à chaque appel de nearest), et nearest rend exactement les mêmes voisins qu'avant.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CacheVecteurs, cosinus, decoder, norme } from '../src/muninn/vecteurs-ram.ts';
import { Mnemosyne } from '../src/muninn/store.ts';

const b64 = (f: Float32Array) => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');

test('decoder / norme / cosinus : exacts', () => {
  const f = Float32Array.from([3, 4]);
  assert.deepEqual([...decoder(b64(f))], [3, 4]);
  assert.equal(norme(Float32Array.from([3, 4])), 5);
  assert.equal(norme(Float32Array.from([0, 0])), 1); // jamais zéro
  const a = Float32Array.from([1, 0]), c = Float32Array.from([1, 0]);
  assert.ok(Math.abs(cosinus(a, norme(a), c, norme(c)) - 1) < 1e-6);
  const d = Float32Array.from([0, 1]);
  assert.ok(Math.abs(cosinus(a, norme(a), d, norme(d))) < 1e-6);
});

test('CacheVecteurs : décode une fois, garde en RAM, re-décode seulement si le base64 change', () => {
  const cache = new CacheVecteurs();
  const f = Float32Array.from([1, 2, 3]);
  const v1 = cache.obtenir(7, b64(f));
  const v2 = cache.obtenir(7, b64(f));
  assert.equal(v1, v2, 'même base64 : même objet rendu (aucun re-décodage)');
  assert.equal(cache.taille, 1);
  const g = Float32Array.from([4, 5, 6]);
  const v3 = cache.obtenir(7, b64(g));
  assert.notEqual(v3, v1, 'base64 changé : re-décodé');
  assert.deepEqual([...v3.f], [4, 5, 6]);
  cache.oublier(7);
  assert.equal(cache.taille, 0);
});

test('nearest() rend les mêmes voisins que le calcul direct (via le cache RAM)', () => {
  const m = new Mnemosyne(':memory:');
  const model = 'test-embed';
  const vecs: Array<{ id: number; f: Float32Array }> = [];
  const data: Array<[string, number[]]> = [
    ['le serveur de fichiers', [1, 0, 0]],
    ['le routeur du réseau', [0.9, 0.1, 0]],
    ['la recette de gâteau', [0, 1, 0]],
    ['le chat Pixel', [0, 0, 1]],
    ['le NAS de sauvegarde', [0.8, 0.2, 0.1]],
  ];
  for (const [txt, arr] of data) {
    const { id } = m.remember(txt, 'owner');
    const f = Float32Array.from(arr);
    m.setVector(id, model, f);
    vecs.push({ id, f });
  }
  const q = Float32Array.from([1, 0, 0]);
  // Référence : l'ancien calcul (cosinus sur tous, seuil 0,45, tri décroissant).
  const qn = Math.sqrt(q.reduce((s, x) => s + x * x, 0)) || 1;
  const ref = vecs.map(({ id, f }) => {
    const fn = Math.sqrt(f.reduce((s, x) => s + x * x, 0)) || 1;
    let d = 0; for (let i = 0; i < Math.min(f.length, q.length); i++) d += f[i] * q[i];
    return { id, s: d / (fn * qn) };
  }).filter((x) => x.s > 0.45).sort((a, b) => b.s - a.s).slice(0, 6).map((x) => x.id);

  const got = m.nearest(model, q, 6).map((r) => r.id);
  assert.deepEqual(got, ref, 'mêmes voisins, même ordre qu\'un cosinus direct');
  // Deuxième appel : mêmes voisins (le cache RAM ne change rien au résultat).
  assert.deepEqual(m.nearest(model, q, 6).map((r) => r.id), ref);
});
