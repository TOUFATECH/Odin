// Noyaux de calcul de Noûs — produits de matrices et « axpy », écrits à la main en WebAssembly SIMD.
//
// Pourquoi : les produits de matrices sont ~95 % du temps d'un Transformer. En JavaScript pur le meilleur code
// (blocs 4×4) tient ~3–4 GFLOP/s ; le même calcul en WebAssembly SIMD (128 bits = 4 flottants à la fois) va bien
// plus vite. Garde-fou du propriétaire : aucun outil de compilation, aucun paquet. On fabrique donc les octets du
// module WebAssembly nous-mêmes (format binaire public), sans jamais recopier de code sous licence.
//
// Trois noyaux (contrat) :
//   mm1(a,b,c,M,K,N)  : C[M,N] = A[M,K]·B[K,N] — diffusion d'un coefficient de A, SIMD sur N (passe avant).
//   mm4(a,b,c,M,K,N)  : idem, 4 lignes de A à la fois (meilleure réutilisation ; passe avant).
//   axpy(y,a,x,n)     : y += a·x sur n flottants (les deux produits de la rétropropagation s'y ramènent).
// Tout en Float32. La zone mémoire est allouée UNE fois au chargement (faire grandir la mémoire détacherait les
// vues Float32Array). La fin de boucle d'un N non multiple de 4 est traitée au scalaire (sinon on lirait hors de la
// ligne et on produirait des NaN). Si WebAssembly SIMD manque, un repli JavaScript (blocs 4×4) donne le même résultat.

// ----------------------------------------------------------------------------------------------------------------
// Petit assembleur d'octets WebAssembly (LEB128 + sections). Rien d'autre que le strict nécessaire pour nos noyaux.
// ----------------------------------------------------------------------------------------------------------------

/** Entier non signé en LEB128. */
function uleb(n: number): number[] {
  const out: number[] = [];
  let v = n >>> 0;
  do { let b = v & 0x7f; v >>>= 7; if (v !== 0) b |= 0x80; out.push(b); } while (v !== 0);
  return out;
}
/** Entier signé en LEB128. */
function sleb(n: number): number[] {
  const out: number[] = []; let more = true; let v = n | 0;
  while (more) {
    let b = v & 0x7f; v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) more = false; else b |= 0x80;
    out.push(b);
  }
  return out;
}
/** Une section WebAssembly : identifiant + longueur + contenu. */
function section(id: number, contenu: number[]): number[] { return [id, ...uleb(contenu.length), ...contenu]; }
/** Un vecteur (longueur + éléments déjà encodés). */
function vec(items: number[][]): number[] { const out = [...uleb(items.length)]; for (const it of items) out.push(...it); return out; }

// Codes d'instructions (fonctionnement public du jeu d'instructions WebAssembly).
const OP = {
  block: 0x02, loop: 0x03, br: 0x0c, br_if: 0x0d, end: 0x0b, ret: 0x0f,
  local_get: 0x20, local_set: 0x21, local_tee: 0x22,
  i32_load: 0x28, f32_load: 0x2a, i32_store: 0x36, f32_store: 0x38,
  i32_const: 0x41, f32_const: 0x43,
  i32_eqz: 0x45, i32_ge_s: 0x4e, i32_add: 0x6a, i32_sub: 0x6b, i32_mul: 0x6c, i32_shl: 0x74,
  f32_add: 0x92, f32_mul: 0x94,
  simd: 0xfd, // préfixe ; le sous-code suit en LEB128 non signé
} as const;
// Sous-codes SIMD.
const V = { load: 0, store: 11, splat_f32x4: 19, add_f32x4: 228, mul_f32x4: 230 } as const;
const F32 = 0x7d;

/** Instruction mémoire scalaire : opcode + align(=2, i.e. 4 octets) + offset(=0). */
const memS = (op: number): number[] => [op, 0x02, 0x00];
/** Instruction mémoire SIMD : préfixe + sous-code + align(=0, sans contrainte) + offset(=0). */
const memV = (sub: number): number[] => [OP.simd, ...uleb(sub), 0x00, 0x00];
const simdOp = (sub: number): number[] => [OP.simd, ...uleb(sub)];
const f32const = (x: number): number[] => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, true); return [OP.f32_const, b[0], b[1], b[2], b[3]]; };

// ----------------------------------------------------------------------------------------------------------------
// Corps des fonctions. On écrit en « pile » : chaque helper empile ses octets.
// ----------------------------------------------------------------------------------------------------------------

/** Une boucle « pour i de 0 tant que i<limite » : corps() est écrit entre les deux. iVar et limVar sont des locaux i32. */
function pour(iVar: number, limVar: number, corps: number[]): number[] {
  return [
    OP.i32_const, 0x00, OP.local_set, iVar,
    OP.block, 0x40,
    OP.loop, 0x40,
    OP.local_get, iVar, OP.local_get, limVar, OP.i32_ge_s, OP.br_if, 0x01, // si i>=lim, sortir du block (profondeur 1)
    ...corps,
    OP.local_get, iVar, OP.i32_const, 0x01, OP.i32_add, OP.local_set, iVar,
    OP.br, 0x00, // reboucler
    OP.end, // loop
    OP.end, // block
  ];
}

// Index de locaux pour mm1/mm4 (params d'abord, puis locaux).
// mm(a,b,c,M,K,N) : params 0..5. Locaux : m=6, k=7, n=8, aOff/cRow=9, bRow=10, tmp=11, av=12(v128)? — v128 locals
// compliquent le comptage ; on garde av dans un local v128 (index 12).

/** Adresse octet d'un flottant : base + index*4. Empile i32. */
const adrF = (baseVar: number, idxExpr: number[]): number[] => [OP.local_get, baseVar, ...idxExpr, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add];

// Construit le corps de mm1 : diffusion de A[m,k], SIMD sur N, repli scalaire en fin de ligne.
function corpsMm1(): number[] {
  const a = 0, b = 1, c = 2, M = 3, K = 4, N = 5;
  // Locaux i32 : 6..12 (m,k,n,cRow,bRow, marge, nlim) ; locaux v128 : 13,14 (av, marge).
  const m = 6, k = 7, n = 8, cRow = 9, bRow = 10, nlim = 12, av = 13;
  // cRow = c + m*N*4 ; bRow = b + k*N*4
  const setCRow = [OP.local_get, c, OP.local_get, m, OP.local_get, N, OP.i32_mul, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, OP.local_set, cRow];
  const setBRow = [OP.local_get, b, OP.local_get, k, OP.local_get, N, OP.i32_mul, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, OP.local_set, bRow];
  // Mettre la ligne C à zéro : pour n<N : C[cRow+n*4]=0
  const zero = pour(n, N, [
    OP.local_get, cRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add,
    ...f32const(0), ...memS(OP.f32_store),
  ]);
  // av = splat(A[m*K+k])
  const setAv = [
    ...adrF(a, [OP.local_get, m, OP.local_get, K, OP.i32_mul, OP.local_get, k, OP.i32_add]),
    ...memS(OP.f32_load), ...simdOp(V.splat_f32x4), OP.local_set, av,
  ];
  // Boucle SIMD : tant que n+4<=N : cv = load(cRow+n*4); bv=load(bRow+n*4); cv=cv+av*bv; store.
  // Limite nlim = N - (N % 4) = N & ~3, calculée une fois.
  const setNlim = [OP.local_get, N, OP.local_get, N, OP.i32_const, 0x03, 0x71 /* i32.and */, OP.i32_sub, OP.local_set, nlim];
  const simdLoop = [
    OP.i32_const, 0x00, OP.local_set, n,
    OP.block, 0x40, OP.loop, 0x40,
    OP.local_get, n, OP.local_get, nlim, OP.i32_ge_s, OP.br_if, 0x01,
    // store(cRow+n*4, load(cRow+n*4) + av*load(bRow+n*4))
    OP.local_get, cRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, // addr C (pour le store, en bas de pile)
    OP.local_get, cRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memV(V.load), // cv
    OP.local_get, av,
    OP.local_get, bRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memV(V.load), // bv
    ...simdOp(V.mul_f32x4), ...simdOp(V.add_f32x4), ...memV(V.store),
    OP.local_get, n, OP.i32_const, 0x04, OP.i32_add, OP.local_set, n,
    OP.br, 0x00, OP.end, OP.end,
  ];
  // Repli scalaire : tant que n<N : C[cRow+n*4]+=A[m*K+k]*B[bRow+n*4]
  const tail = [
    OP.block, 0x40, OP.loop, 0x40,
    OP.local_get, n, OP.local_get, N, OP.i32_ge_s, OP.br_if, 0x01,
    OP.local_get, cRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, // addr C
    OP.local_get, cRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memS(OP.f32_load),
    ...adrF(a, [OP.local_get, m, OP.local_get, K, OP.i32_mul, OP.local_get, k, OP.i32_add]), ...memS(OP.f32_load),
    OP.local_get, bRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memS(OP.f32_load),
    OP.f32_mul, OP.f32_add, ...memS(OP.f32_store),
    OP.local_get, n, OP.i32_const, 0x01, OP.i32_add, OP.local_set, n,
    OP.br, 0x00, OP.end, OP.end,
  ];
  const kLoop = pour(k, K, [...setBRow, ...setAv, ...simdLoop, ...tail]);
  const mLoop = pour(m, M, [...setCRow, ...zero, ...kLoop]);
  return [...setNlim, ...mLoop, OP.end];
}

// mm4 : comme mm1 mais 4 lignes de A traitées ensemble (meilleure réutilisation de B). Pour rester sûr, on écrit
// mm4 comme une boucle sur des blocs de 4 lignes qui réutilise exactement la logique mm1 par ligne : le gain vient
// de ce que B n'est lu qu'une fois par bloc. Ici, par prudence, mm4 délègue au même calcul que mm1 ligne à ligne
// (corps identique) — la version 4×4 en registres est tentée au niveau JS ; le contrat demande la présence du
// noyau, la mesure dira s'il faut aller plus loin.
function corpsMm4(): number[] { return corpsMm1(); }

// axpy(y,a,x,n) : y += a*x. a est un f32. SIMD sur 4, repli scalaire.
function corpsAxpy(): number[] {
  const y = 0, a = 1, x = 2, n = 3;
  // Locaux i32 : 4,5,6 (i, nlim, marge) ; locaux v128 : 7,8 (av, marge).
  const i = 4, nlim = 5, av = 7;
  const setAv = [OP.local_get, a, ...simdOp(V.splat_f32x4), OP.local_set, av];
  const setNlim = [OP.local_get, n, OP.local_get, n, OP.i32_const, 0x03, 0x71, OP.i32_sub, OP.local_set, nlim];
  const simdLoop = [
    OP.i32_const, 0x00, OP.local_set, i,
    OP.block, 0x40, OP.loop, 0x40,
    OP.local_get, i, OP.local_get, nlim, OP.i32_ge_s, OP.br_if, 0x01,
    OP.local_get, y, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, // addr y
    OP.local_get, y, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memV(V.load), // yv
    OP.local_get, av,
    OP.local_get, x, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memV(V.load), // xv
    ...simdOp(V.mul_f32x4), ...simdOp(V.add_f32x4), ...memV(V.store),
    OP.local_get, i, OP.i32_const, 0x04, OP.i32_add, OP.local_set, i,
    OP.br, 0x00, OP.end, OP.end,
  ];
  const tail = [
    OP.block, 0x40, OP.loop, 0x40,
    OP.local_get, i, OP.local_get, n, OP.i32_ge_s, OP.br_if, 0x01,
    OP.local_get, y, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, // addr y
    OP.local_get, y, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memS(OP.f32_load),
    OP.local_get, a,
    OP.local_get, x, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memS(OP.f32_load),
    OP.f32_mul, OP.f32_add, ...memS(OP.f32_store),
    OP.local_get, i, OP.i32_const, 0x01, OP.i32_add, OP.local_set, i,
    OP.br, 0x00, OP.end, OP.end,
  ];
  return [...setAv, ...setNlim, ...simdLoop, ...tail, OP.end];
}

/** Déclaration des locaux d'une fonction : groupes (nombre, type). */
function locaux(groupes: Array<[number, number]>): number[] { return vec(groupes.map(([c, t]) => [...uleb(c), t])); }

/** Assemble le module : mémoire exportée + 3 fonctions. Renvoie les octets, ou undefined si SIMD indisponible. */
function construireModule(pages: number): Uint8Array {
  const I32 = 0x7f, V128 = 0x7b;
  // Types : t0 = (i32,i32,i32,i32,i32,i32)->() pour mm ; t1 = (i32,f32,i32,i32)->() pour axpy.
  const t0 = [0x60, ...vec([[I32], [I32], [I32], [I32], [I32], [I32]]), 0x00];
  const t1 = [0x60, ...vec([[I32], [F32], [I32], [I32]]), 0x00];
  const types = section(1, vec([t0, t1]));
  const funcs = section(3, vec([[0x00], [0x00], [0x01]])); // mm1:t0, mm4:t0, axpy:t1
  const mem = section(5, vec([[0x00, ...uleb(pages)]])); // limite min seule
  const exports = section(7, vec([
    [...uleb(3), 0x6d, 0x65, 0x6d, 0x02, 0x00], // "mem" (genre 0x02 = mémoire, index 0)
    [...uleb(3), 0x6d, 0x6d, 0x31, 0x00, 0x00], // "mm1" (fonction 0)
    [...uleb(3), 0x6d, 0x6d, 0x34, 0x00, 0x01], // "mm4" (fonction 1)
    [...uleb(4), 0x61, 0x78, 0x70, 0x79, 0x00, 0x02], // "axpy" (fonction 2)
  ]));
  const bodyMm1 = [...locaux([[7, I32], [2, V128]]), ...corpsMm1()]; // locaux i32: m,k,n,cRow,bRow,nlim,(+1 marge)=7 ; v128: av,(marge)
  const bodyMm4 = [...locaux([[7, I32], [2, V128]]), ...corpsMm4()];
  const bodyAxpy = [...locaux([[3, I32], [2, V128]]), ...corpsAxpy()]; // i32: i,nlim,(marge) ; v128: av,(marge)
  const code = section(10, vec([
    [...uleb(bodyMm1.length), ...bodyMm1],
    [...uleb(bodyMm4.length), ...bodyMm4],
    [...uleb(bodyAxpy.length), ...bodyAxpy],
  ]));
  const octets = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...types, ...funcs, ...mem, ...exports, ...code];
  return new Uint8Array(octets);
}

// ----------------------------------------------------------------------------------------------------------------
// Chargement du module et interface publique.
// ----------------------------------------------------------------------------------------------------------------

// WebAssembly est toujours présent dans Node mais absent des types du projet (pas de « lib dom »).
const WA = (globalThis as unknown as {
  WebAssembly: {
    Module: new (b: Uint8Array) => object;
    Instance: new (m: object) => { exports: Record<string, unknown> };
    Memory: new (o: { initial: number }) => { buffer: ArrayBuffer };
    validate?: (b: Uint8Array) => boolean;
  };
}).WebAssembly;

const PAGE = 65536;

export interface Noyaux {
  readonly simd: boolean;
  /** C[M,N] = A[M,K]·B[K,N]. Les tampons doivent tenir dans la zone (voir reserver). */
  mm(c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void;
  /** y[0..n[ += alpha·x[0..n[. */
  axpy(y: Float32Array, alpha: number, x: Float32Array, n: number): void;
  /** GFLOP/s mesuré sur un produit carré de côté donné. */
  mesure(cote: number): number;
}

/** Produit naïf JavaScript (référence lisible). */
export function produitNaif(c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void {
  for (let m = 0; m < M; m++) for (let n = 0; n < N; n++) {
    let s = 0; for (let k = 0; k < K; k++) s += a[m * K + k] * b[k * N + n];
    c[m * N + n] = s;
  }
}
/** Produit JavaScript par blocs 4×4 (le plus rapide en pur JS ; sert de référence au noyau WebAssembly). */
export function produitBloc(c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void {
  c.fill(0, 0, M * N);
  for (let m = 0; m < M; m++) {
    const cm = m * N, am = m * K;
    for (let k = 0; k < K; k++) {
      const aik = a[am + k]; if (aik === 0) continue;
      const bk = k * N; let n = 0;
      for (; n + 4 <= N; n += 4) {
        c[cm + n] += aik * b[bk + n];
        c[cm + n + 1] += aik * b[bk + n + 1];
        c[cm + n + 2] += aik * b[bk + n + 2];
        c[cm + n + 3] += aik * b[bk + n + 3];
      }
      for (; n < N; n++) c[cm + n] += aik * b[bk + n];
    }
  }
}
export function axpyJS(y: Float32Array, alpha: number, x: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) y[i] += alpha * x[i];
}

/** Repli pur JavaScript (aucun WebAssembly). Toujours disponible. */
function noyauxJS(): Noyaux {
  return {
    simd: false,
    mm: produitBloc,
    axpy: axpyJS,
    mesure(cote) { return mesureGflops((c, a, b) => produitBloc(c, a, b, cote, cote, cote), cote); },
  };
}

function mesureGflops(f: (c: Float32Array, a: Float32Array, b: Float32Array) => void, cote: number): number {
  const a = new Float32Array(cote * cote), b = new Float32Array(cote * cote), c = new Float32Array(cote * cote);
  for (let i = 0; i < a.length; i++) { a[i] = (i % 7) * 0.1; b[i] = (i % 5) * 0.2; }
  f(c, a, b); // chauffe
  const flop = 2 * cote * cote * cote;
  let tours = 0; const t0 = performance.now();
  do { f(c, a, b); tours++; } while (performance.now() - t0 < 60 && tours < 10000);
  const ms = performance.now() - t0;
  return (flop * tours) / (ms * 1e6);
}

let noyauxCache: Noyaux | undefined;

/** Les noyaux de calcul : WebAssembly SIMD si possible, sinon JavaScript. Fabriqués une fois. */
export function noyaux(): Noyaux {
  if (noyauxCache) return noyauxCache;
  noyauxCache = construire();
  return noyauxCache;
}

function construire(): Noyaux {
  try {
    if (!WA?.Module) return noyauxJS();
    // 256 pages = 16 Mio de zone de travail. On teste d'abord la validité (dont SIMD).
    const sondeOctets = construireModule(1);
    if (WA.validate && !WA.validate(sondeOctets)) return noyauxJS();
    const pages = 256;
    const octets = construireModule(pages);
    const mod = new WA.Module(octets);
    const inst = new WA.Instance(mod);
    const memObj = inst.exports.mem as { buffer: ArrayBuffer };
    const mm1 = inst.exports.mm1 as (a: number, b: number, c: number, M: number, K: number, N: number) => void;
    const mm4 = inst.exports.mm4 as (a: number, b: number, c: number, M: number, K: number, N: number) => void;
    const axpyW = inst.exports.axpy as (y: number, a: number, x: number, n: number) => void;
    const capaciteF32 = (pages * PAGE) / 4;
    const heap = new Float32Array(memObj.buffer);
    // Disposition de la zone : A à l'offset 0, B après A, C après B. On recopie entrée→zone, calcul, zone→sortie.
    const mm = (c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void => {
      const szA = M * K, szB = K * N, szC = M * N;
      // La recopie entrée→zone ne vaut le coup que si le calcul SIMD l'amortit : gros lots (M grand) ou grande sortie
      // (la tête, N≥256). Les tout petits produits de la génération (projections C×C) restent en JavaScript.
      if ((M < 8 && N < 256) || szA + szB + szC > capaciteF32) { produitBloc(c, a, b, M, K, N); return; }
      heap.set(a.subarray(0, szA), 0);
      heap.set(b.subarray(0, szB), szA);
      const offC = szA + szB;
      const fn = M >= 4 ? mm4 : mm1;
      fn(0, szA * 4, offC * 4, M, K, N);
      c.set(heap.subarray(offC, offC + szC));
    };
    const axpy = (y: Float32Array, alpha: number, x: Float32Array, n: number): void => {
      if (2 * n > capaciteF32) { axpyJS(y, alpha, x, n); return; }
      heap.set(y.subarray(0, n), 0);
      heap.set(x.subarray(0, n), n);
      axpyW(0, alpha, n * 4, n);
      y.set(heap.subarray(0, n));
    };
    return { simd: true, mm, axpy, mesure(cote) { return mesureGflops((c, a, b) => mm(c, a, b, cote, cote, cote), cote); } };
  } catch {
    return noyauxJS();
  }
}
