// Les noyaux de calcul de Noûs (src/brain/nous/wasm.ts) : le produit WebAssembly SIMD égale le produit JavaScript par
// blocs aux arrondis près, ne produit pas de NaN sur un vocabulaire non multiple de 4, et axpy est correct.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { axpyJS, fabriquerNoyaux, noyaux, produitBloc, produitNaif } from '../src/brain/nous/wasm.ts';

function alea(n: number, graine = 12345): Float32Array {
  const a = new Float32Array(n); let x = graine >>> 0;
  for (let i = 0; i < n; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; a[i] = (x / 4294967296) * 2 - 1; }
  return a;
}

test('produit WebAssembly = produit JavaScript par blocs (aux arrondis près), sans NaN', () => {
  const K = noyaux();
  const cas: Array<[number, number, number]> = [[1, 1, 1], [3, 5, 7], [8, 16, 32], [5, 9, 4093], [4, 4, 4], [7, 7, 7], [2, 3, 13], [16, 48, 4096]];
  let pire = 0;
  for (const [M, Kk, N] of cas) {
    const a = alea(M * Kk, 7), b = alea(Kk * N, 9);
    const cw = new Float32Array(M * N), cj = new Float32Array(M * N);
    K.mm(cw, a, b, M, Kk, N); produitBloc(cj, a, b, M, Kk, N);
    for (let i = 0; i < M * N; i++) { assert.ok(!Number.isNaN(cw[i]), `NaN en ${M}x${Kk}x${N}[${i}]`); pire = Math.max(pire, Math.abs(cw[i] - cj[i])); }
  }
  assert.ok(pire < 1e-3, `écart maximal WebAssembly/JS ${pire.toExponential(3)}`);
});

test('vocabulaire non multiple de 4 : la fin de ligne est bien traitée (pas de NaN)', () => {
  const K = noyaux();
  for (const N of [4093, 4094, 4095, 4097, 11, 1]) {
    const a = alea(3 * 16), b = alea(16 * N);
    const c = new Float32Array(3 * N); K.mm(c, a, b, 3, 16, N);
    for (let i = 0; i < 3 * N; i++) assert.ok(!Number.isNaN(c[i]), `NaN avec N=${N}`);
  }
});

test('axpy : y += a·x égale la référence JavaScript', () => {
  const K = noyaux();
  for (const n of [1, 3, 4, 7, 4097]) {
    const y1 = alea(n, 1), y2 = Float32Array.from(y1), x = alea(n, 2), al = 0.37;
    K.axpy(y1, al, x, n); axpyJS(y2, al, x, n);
    let pire = 0; for (let i = 0; i < n; i++) pire = Math.max(pire, Math.abs(y1[i] - y2[i]));
    assert.ok(pire < 1e-4, `axpy n=${n} écart ${pire.toExponential(3)}`);
  }
});

// La mémoire du noyau redescend : copies de poids d'un réseau disparu rendues, très gros produits (vision) faits à part.
setFlagsFromString('--expose-gc');
const ramasser = runInNewContext('gc') as () => void;
async function ramasserTout(): Promise<void> { for (let i = 0; i < 4; i++) { ramasser(); await new Promise((ok) => setTimeout(ok, 10)); } }

test('mémoire du noyau : les copies des réseaux disparus sont rendues, un très gros produit ne la laisse pas grandir', async () => {
  const k = fabriquerNoyaux('bloc') ?? fabriquerNoyaux('fma');
  if (!k?.resident) return; // pas de noyau à résidents sur cette machine
  assert.ok(k.octets, 'le noyau dit la taille de sa mémoire');
  const depart = k.octets();
  // 40 « réseaux » de 2 M flottants (8 Mio) chacun, l'un après l'autre, les anciens abandonnés.
  for (let i = 0; i < 40; i++) {
    const proprio = {};
    assert.ok(k.resident(proprio, 'w', 1, 2_000_000, (d) => d.fill(i)) >= 0);
  }
  await ramasserTout();
  // Le prochain réseau trouve une mémoire revenue près du départ (sa place, rien de plus).
  const vivant = {}; const adr = k.resident(vivant, 'w', 1, 2_000_000, (d) => d.fill(1));
  assert.ok(adr >= 0);
  assert.ok(k.octets() <= depart + 2_000_000 * 4 + (1 << 20), `mémoire ${k.octets()} octets (départ ${depart})`);
  // Le résident du réseau vivant sert toujours (produit juste).
  const a = alea(4 * 2000, 3), c = new Float32Array(4 * 1000), ref = new Float32Array(4 * 1000);
  k.mmResident!(c, a, adr, 4, 2000, 1000);
  produitNaif(ref, a, new Float32Array(2_000_000).fill(1), 4, 2000, 1000);
  for (let i = 0; i < c.length; i++) assert.ok(Math.abs(c[i] - ref[i]) <= 1e-3 * Math.max(1, Math.abs(ref[i])));
  // Un très gros produit (au-delà de la zone de travail bornée) : juste, et la mémoire du noyau n'a pas bougé.
  const avant = k.octets(), M = 1200, K = 1200, N = 1200;
  const A = alea(M * K, 7), B = alea(K * N, 8), C = new Float32Array(M * N);
  k.mm(C, A, B, M, K, N);
  for (const [m, n] of [[0, 0], [599, 17], [1199, 1199]]) { let s = 0; for (let x = 0; x < K; x++) s += A[m * K + x] * B[x * N + n]; assert.ok(Math.abs(C[m * N + n] - s) <= 1e-3); }
  assert.equal(k.octets(), avant, 'mémoire du noyau inchangée après le gros produit');
  void vivant;
});
