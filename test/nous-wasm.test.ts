// Les noyaux de calcul de Noûs (src/brain/nous/wasm.ts) : le produit WebAssembly SIMD égale le produit JavaScript par
// blocs aux arrondis près, ne produit pas de NaN sur un vocabulaire non multiple de 4, et axpy est correct.
import assert from 'node:assert/strict';
import test from 'node:test';
import { axpyJS, noyaux, produitBloc } from '../src/brain/nous/wasm.ts';

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
