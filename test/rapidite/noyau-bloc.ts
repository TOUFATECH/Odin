// Banc de rapidité : MAQUETTE d'un noyau de produit de matrices « par blocs en registres » (WebAssembly SIMD), pour
// mesurer ce qu'on gagnerait sur le noyau actuel de Noûs (src/brain/nous/wasm.ts, où « mm4 » refait mm1 ligne à ligne :
// chaque multiplication-addition relit et réécrit C en mémoire). Ici, un bloc de 4 lignes × 8 colonnes de C reste dans
// 8 registres de 128 bits pendant toute la somme sur K : B est lu une fois pour 4 lignes, C n'est écrit qu'à la fin.
// Option « fma » : la multiplication-addition fusionnée de « relaxed SIMD » (f32x4.relaxed_madd), si la machine l'a.
// Rien ici n'est branché dans Odin : c'est une copie de travail, comparée au noyau actuel sur les mêmes données.
// (Depuis, le vrai noyau par blocs est dans src/brain/nous/wasm.ts — mmb4/mmb1, bords compris, avec replis ; cette
// maquette reste pour le mode « maquettes » du banc.)

function uleb(n: number): number[] { const o: number[] = []; let v = n >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; }
function sleb(n: number): number[] { const o: number[] = []; let v = n | 0, more = true; while (more) { let b = v & 0x7f; v >>= 7; if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) more = false; else b |= 0x80; o.push(b); } return o; }
const sec = (id: number, c: number[]) => [id, ...uleb(c.length), ...c];
const vec = (items: number[][]) => { const o = [...uleb(items.length)]; for (const i of items) o.push(...i); return o; };
const I32 = 0x7f, V128 = 0x7b;
// instructions
const get = (i: number) => [0x20, ...uleb(i)], set = (i: number) => [0x21, ...uleb(i)];
const ic = (n: number) => [0x41, ...sleb(n)];
const add = [0x6a], mul = [0x6c], shl = [0x74], ges = [0x4e];
const simd = (sub: number) => [0xfd, ...uleb(sub)];
const vload = (off = 0) => [0xfd, 0x00, 0x00, ...uleb(off)], vstore = (off = 0) => [0xfd, 0x0b, 0x00, ...uleb(off)];
const f32load = [0x2a, 0x02, 0x00];
const splat = simd(0x13), fadd = simd(0xe4), fmul = simd(0xe6), fma = simd(0x105);
const vzero = [0xfd, 0x0c, ...new Array(16).fill(0)];
/** « pour v de 0 tant que v < lim, pas `pas` » ; lim : instructions qui empilent la limite. */
function pour(v: number, lim: number[], pas: number, corps: number[]): number[] {
  return [...ic(0), ...set(v), 0x02, 0x40, 0x03, 0x40, ...get(v), ...lim, ...ges, 0x0d, 0x01, ...corps, ...get(v), ...ic(pas), ...add, ...set(v), 0x0c, 0x00, 0x0b, 0x0b];
}

/** mm48(a,b,c,M,K,N) : C = A·B, M multiple de 4, N multiple de 8 ; adresses en octets. */
function corps(avecFma: boolean): number[] {
  const a = 0, b = 1, c = 2, M = 3, K = 4, N = 5;
  const m = 6, n = 7, k = 8, pa = [9, 10, 11, 12], pb = 13, pc = 14, N4 = 15, K4 = 16;
  const acc = [17, 18, 19, 20, 21, 22, 23, 24], b0 = 25, b1 = 26, av = 27;
  const madd = (accI: number, bI: number) => (avecFma ? [...get(av), ...get(bI), ...get(accI), ...fma, ...set(accI)] : [...get(accI), ...get(av), ...get(bI), ...fmul, ...fadd, ...set(accI)]);
  const corpsK = [
    ...get(pb), ...vload(0), ...set(b0), ...get(pb), ...vload(16), ...set(b1),
    ...[0, 1, 2, 3].flatMap((r) => [...get(pa[r]), ...f32load, ...splat, ...set(av), ...madd(acc[2 * r], b0), ...madd(acc[2 * r + 1], b1), ...get(pa[r]), ...ic(4), ...add, ...set(pa[r])]),
    ...get(pb), ...get(N4), ...add, ...set(pb),
  ];
  const corpsN = [
    ...acc.flatMap((x) => [...vzero, ...set(x)]),
    // pa0 = a + m*K*4 ; pa[r] = pa0 + r*K*4
    ...get(a), ...get(m), ...get(K4), ...mul, ...add, ...set(pa[0]),
    ...get(pa[0]), ...get(K4), ...add, ...set(pa[1]), ...get(pa[1]), ...get(K4), ...add, ...set(pa[2]), ...get(pa[2]), ...get(K4), ...add, ...set(pa[3]),
    ...get(b), ...get(n), ...ic(2), ...shl, ...add, ...set(pb),
    ...pour(k, get(K), 1, corpsK),
    // pc = c + (m*N + n)*4 ; écrire les 4 lignes
    ...get(c), ...get(m), ...get(N4), ...mul, ...add, ...get(n), ...ic(2), ...shl, ...add, ...set(pc),
    ...[0, 1, 2, 3].flatMap((r) => [...get(pc), ...get(acc[2 * r]), ...vstore(0), ...get(pc), ...get(acc[2 * r + 1]), ...vstore(16), ...get(pc), ...get(N4), ...add, ...set(pc)]),
  ];
  return [
    ...get(N), ...ic(2), ...shl, ...set(N4), ...get(K), ...ic(2), ...shl, ...set(K4),
    ...pour(m, get(M), 4, pour(n, get(N), 8, corpsN)),
    0x0b,
  ];
}

function module(pages: number, avecFma: boolean): Uint8Array {
  const t0 = [0x60, ...vec([[I32], [I32], [I32], [I32], [I32], [I32]]), 0x00];
  const body = [...vec([[...uleb(11), I32], [...uleb(11), V128]]), ...corps(avecFma)];
  const octets = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...sec(1, vec([t0])), ...sec(3, vec([[0x00]])), ...sec(5, vec([[0x00, ...uleb(pages)]])),
    ...sec(7, vec([[...uleb(3), 0x6d, 0x65, 0x6d, 0x02, 0x00], [...uleb(4), 0x6d, 0x6d, 0x34, 0x38, 0x00, 0x00]])),
    ...sec(10, vec([[...uleb(body.length), ...body]]))];
  return new Uint8Array(octets);
}

export interface NoyauBloc { fma: boolean; mm(c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void; heap: Float32Array; brut(offA: number, offB: number, offC: number, M: number, K: number, N: number): void }
/** Le noyau en maquette (avec recopie entrée/sortie comme le noyau actuel), ou undefined si la machine ne le valide pas. */
export function noyauBloc(avecFma: boolean, pages = 512): NoyauBloc | undefined {
  const WA = (globalThis as unknown as { WebAssembly: { validate(b: Uint8Array): boolean; Module: new (b: Uint8Array) => object; Instance: new (m: object) => { exports: Record<string, unknown> } } }).WebAssembly;
  const oct = module(pages, avecFma);
  if (!WA.validate(oct)) return undefined;
  const inst = new WA.Instance(new WA.Module(oct));
  const heap = new Float32Array((inst.exports.mem as { buffer: ArrayBuffer }).buffer);
  const f = inst.exports.mm48 as (a: number, b: number, c: number, M: number, K: number, N: number) => void;
  return {
    fma: avecFma, heap,
    brut: f,
    mm(c, a, b, M, K, N) {
      if (M % 4 || N % 8) throw new Error('maquette : M multiple de 4, N multiple de 8');
      const szA = M * K, szB = K * N; heap.set(a.subarray(0, szA), 0); heap.set(b.subarray(0, szB), szA);
      f(0, szA * 4, (szA + szB) * 4, M, K, N); c.set(heap.subarray(szA + szB, szA + szB + M * N));
    },
  };
}
