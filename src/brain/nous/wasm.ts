// Noyaux de calcul de Noûs — produits de matrices et « axpy », écrits à la main en WebAssembly SIMD.
//
// Pourquoi : les produits de matrices sont l'essentiel du temps d'un Transformer. En JavaScript pur le meilleur code
// (blocs 4×4) tient quelques GFLOP/s ; le même calcul en WebAssembly SIMD (128 bits = 4 flottants à la fois) va bien
// plus vite. Garde-fou du propriétaire : aucun outil de compilation, aucun paquet. On fabrique donc les octets du
// module WebAssembly nous-mêmes (format binaire public), sans jamais recopier de code sous licence.
//
// Les fonctions du module (contrat, adresses en octets, tout en Float32) :
//   mm1(a,b,c,M,K,N)  : C[M,N] = A[M,K]·B[K,N], ligne à ligne (diffusion d'un coefficient de A, SIMD sur N). C'est le
//                       noyau d'origine, gardé tel quel comme dernier repli WebAssembly (mode « ancien »).
//   mmb4(a,b,c,M,K,N) : le même produit PAR BLOCS EN REGISTRES : 4 lignes × 8 colonnes de C restent dans 8 registres
//                       pendant toute la somme sur K ; B est lu une fois pour 4 lignes, C n'est écrit qu'à la fin.
//                       Ne traite que les lignes [0, M & ~3[ et les colonnes [0, N & ~7[ (les bords : voir plus bas).
//   mmb1(a,b,c,M,K,N) : idem avec des blocs d'UNE ligne × 8 colonnes (lignes restantes, et la génération où M = 1).
//   axpy(y,a,x,n)     : y += a·x sur n flottants.
// Deux variantes de mmb4/mmb1 : avec la multiplication-addition fusionnée de « relaxed SIMD » (f32x4.relaxed_madd,
// norme WebAssembly 3.0 : le moteur choisit fusionné ou non, toujours le même sur une machine donnée), ou sans
// (multiplication puis addition, mêmes arrondis exacts que mm1). La somme sur K se fait toujours dans le même ordre
// (k = 0, 1, …) : sans fusion, le résultat est identique bit à bit à mm1.
//
// Le choix se fait UNE fois au chargement (voir construire) : fusion si la machine la valide ET si un produit d'essai
// est juste ; sinon blocs sans fusion ; sinon l'ancien noyau ligne à ligne ; sinon JavaScript pur. On peut forcer un
// mode (essais, banc) avec fabriquerNoyaux(mode).
//
// Mémoire : une zone de travail (les opérandes recopiés à chaque produit) en bas, puis des « résidents » : des
// tenseurs de poids recopiés UNE fois et réutilisés (le réseau dit quand ses poids changent, voir calcul.ts). Faire
// grandir la mémoire détache les vues Float32Array : on refait la vue après chaque croissance.

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
  i32_eqz: 0x45, i32_ge_s: 0x4e, i32_add: 0x6a, i32_sub: 0x6b, i32_mul: 0x6c, i32_and: 0x71, i32_shl: 0x74,
  f32_add: 0x92, f32_mul: 0x94,
  simd: 0xfd, // préfixe ; le sous-code suit en LEB128 non signé
} as const;
// Sous-codes SIMD (dont relaxed_madd = 0x105, de la proposition « relaxed SIMD » entrée dans WebAssembly 3.0).
const V = { load: 0, store: 11, const: 12, splat_f32x4: 19, add_f32x4: 228, mul_f32x4: 230, relaxed_madd_f32x4: 0x105 } as const;
const F32 = 0x7d, I32 = 0x7f, V128 = 0x7b;

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

/** Adresse octet d'un flottant : base + index*4. Empile i32. */
const adrF = (baseVar: number, idxExpr: number[]): number[] => [OP.local_get, baseVar, ...idxExpr, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add];

// Construit le corps de mm1 : diffusion de A[m,k], SIMD sur N, repli scalaire en fin de ligne. (Noyau d'origine.)
function corpsMm1(): number[] {
  const a = 0, b = 1, c = 2, M = 3, K = 4, N = 5;
  // Locaux i32 : 6..12 (m,k,n,cRow,bRow, marge, nlim) ; locaux v128 : 13,14 (av, marge).
  const m = 6, k = 7, n = 8, cRow = 9, bRow = 10, nlim = 12, av = 13;
  const setCRow = [OP.local_get, c, OP.local_get, m, OP.local_get, N, OP.i32_mul, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, OP.local_set, cRow];
  const setBRow = [OP.local_get, b, OP.local_get, k, OP.local_get, N, OP.i32_mul, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, OP.local_set, bRow];
  const zero = pour(n, N, [
    OP.local_get, cRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add,
    ...f32const(0), ...memS(OP.f32_store),
  ]);
  const setAv = [
    ...adrF(a, [OP.local_get, m, OP.local_get, K, OP.i32_mul, OP.local_get, k, OP.i32_add]),
    ...memS(OP.f32_load), ...simdOp(V.splat_f32x4), OP.local_set, av,
  ];
  const setNlim = [OP.local_get, N, OP.local_get, N, OP.i32_const, 0x03, OP.i32_and, OP.i32_sub, OP.local_set, nlim];
  const simdLoop = [
    OP.i32_const, 0x00, OP.local_set, n,
    OP.block, 0x40, OP.loop, 0x40,
    OP.local_get, n, OP.local_get, nlim, OP.i32_ge_s, OP.br_if, 0x01,
    OP.local_get, cRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add,
    OP.local_get, cRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memV(V.load),
    OP.local_get, av,
    OP.local_get, bRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memV(V.load),
    ...simdOp(V.mul_f32x4), ...simdOp(V.add_f32x4), ...memV(V.store),
    OP.local_get, n, OP.i32_const, 0x04, OP.i32_add, OP.local_set, n,
    OP.br, 0x00, OP.end, OP.end,
  ];
  const tail = [
    OP.block, 0x40, OP.loop, 0x40,
    OP.local_get, n, OP.local_get, N, OP.i32_ge_s, OP.br_if, 0x01,
    OP.local_get, cRow, OP.local_get, n, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add,
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

// --- Noyau par blocs en registres : R lignes × 8 colonnes de C (R = 4 ou 1). ---
const lget = (i: number): number[] => [OP.local_get, ...uleb(i)];
const lset = (i: number): number[] => [OP.local_set, ...uleb(i)];
const ic = (n: number): number[] => [OP.i32_const, ...sleb(n)];
const vload = (off: number): number[] => [OP.simd, ...uleb(V.load), 0x00, ...uleb(off)];
const vstore = (off: number): number[] => [OP.simd, ...uleb(V.store), 0x00, ...uleb(off)];
const vzero = [OP.simd, ...uleb(V.const), ...new Array<number>(16).fill(0)];
/** « pour v de 0 tant que v < lim (local), pas `pas` ». */
function pourPas(v: number, lim: number, pas: number, corps: number[]): number[] {
  return [...ic(0), ...lset(v), OP.block, 0x40, OP.loop, 0x40, ...lget(v), ...lget(lim), OP.i32_ge_s, OP.br_if, 0x01,
    ...corps, ...lget(v), ...ic(pas), OP.i32_add, ...lset(v), OP.br, 0x00, OP.end, OP.end];
}
/** Nombre de locaux i32 / v128 du noyau par blocs de R lignes. */
const localesBloc = (R: number): Array<[number, number]> => [[13, I32], [2 * R + 3, V128]];
function corpsBloc(R: 1 | 4, fma: boolean): number[] {
  const a = 0, b = 1, c = 2, M = 3, K = 4, N = 5;
  const m = 6, n = 7, k = 8, pa = [9, 10, 11, 12], pb = 13, pc = 14, N4 = 15, K4 = 16, ML = 17, NL = 18;
  const acc = Array.from({ length: 2 * R }, (_, i) => 19 + i), b0 = 19 + 2 * R, b1 = 20 + 2 * R, av = 21 + 2 * R;
  // acc ← acc + av·b (sans fusion : multiplication arrondie puis addition arrondie, comme mm1) ou av·b + acc fusionné.
  const madd = (accI: number, bI: number): number[] => (fma
    ? [...lget(av), ...lget(bI), ...lget(accI), ...simdOp(V.relaxed_madd_f32x4), ...lset(accI)]
    : [...lget(accI), ...lget(av), ...lget(bI), ...simdOp(V.mul_f32x4), ...simdOp(V.add_f32x4), ...lset(accI)]);
  const lignes = Array.from({ length: R }, (_, r) => r);
  const corpsK = [
    ...lget(pb), ...vload(0), ...lset(b0), ...lget(pb), ...vload(16), ...lset(b1),
    ...lignes.flatMap((r) => [...lget(pa[r]), ...memS(OP.f32_load), ...simdOp(V.splat_f32x4), ...lset(av),
      ...madd(acc[2 * r], b0), ...madd(acc[2 * r + 1], b1), ...lget(pa[r]), ...ic(4), OP.i32_add, ...lset(pa[r])]),
    ...lget(pb), ...lget(N4), OP.i32_add, ...lset(pb),
  ];
  const corpsN = [
    ...acc.flatMap((x) => [...vzero, ...lset(x)]),
    ...lget(a), ...lget(m), ...lget(K4), OP.i32_mul, OP.i32_add, ...lset(pa[0]),
    ...lignes.slice(1).flatMap((r) => [...lget(pa[r - 1]), ...lget(K4), OP.i32_add, ...lset(pa[r])]),
    ...lget(b), ...lget(n), ...ic(2), OP.i32_shl, OP.i32_add, ...lset(pb),
    ...pourPas(k, K, 1, corpsK),
    ...lget(c), ...lget(m), ...lget(N4), OP.i32_mul, OP.i32_add, ...lget(n), ...ic(2), OP.i32_shl, OP.i32_add, ...lset(pc),
    ...lignes.flatMap((r) => [...lget(pc), ...lget(acc[2 * r]), ...vstore(0), ...lget(pc), ...lget(acc[2 * r + 1]), ...vstore(16),
      ...lget(pc), ...lget(N4), OP.i32_add, ...lset(pc)]),
  ];
  return [
    ...lget(N), ...ic(2), OP.i32_shl, ...lset(N4), ...lget(K), ...ic(2), OP.i32_shl, ...lset(K4),
    ...lget(M), ...ic(-R), OP.i32_and, ...lset(ML), ...lget(N), ...ic(-8), OP.i32_and, ...lset(NL),
    ...pourPas(m, ML, R, pourPas(n, NL, 8, corpsN)),
    OP.end,
  ];
}

// axpy(y,a,x,n) : y += a*x. a est un f32. SIMD sur 4, repli scalaire.
function corpsAxpy(): number[] {
  const y = 0, a = 1, x = 2, n = 3;
  const i = 4, nlim = 5, av = 7;
  const setAv = [OP.local_get, a, ...simdOp(V.splat_f32x4), OP.local_set, av];
  const setNlim = [OP.local_get, n, OP.local_get, n, OP.i32_const, 0x03, OP.i32_and, OP.i32_sub, OP.local_set, nlim];
  const simdLoop = [
    OP.i32_const, 0x00, OP.local_set, i,
    OP.block, 0x40, OP.loop, 0x40,
    OP.local_get, i, OP.local_get, nlim, OP.i32_ge_s, OP.br_if, 0x01,
    OP.local_get, y, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add,
    OP.local_get, y, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memV(V.load),
    OP.local_get, av,
    OP.local_get, x, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add, ...memV(V.load),
    ...simdOp(V.mul_f32x4), ...simdOp(V.add_f32x4), ...memV(V.store),
    OP.local_get, i, OP.i32_const, 0x04, OP.i32_add, OP.local_set, i,
    OP.br, 0x00, OP.end, OP.end,
  ];
  const tail = [
    OP.block, 0x40, OP.loop, 0x40,
    OP.local_get, i, OP.local_get, n, OP.i32_ge_s, OP.br_if, 0x01,
    OP.local_get, y, OP.local_get, i, OP.i32_const, 0x02, OP.i32_shl, OP.i32_add,
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
const nomExport = (s: string, genre: number, index: number): number[] => [...uleb(s.length), ...Array.from(s, (ch) => ch.charCodeAt(0)), genre, index];

/** Assemble le module : mémoire exportée + mm1, axpy, mmb4, mmb1 (avec ou sans fusion). */
function construireModule(pages: number, fma: boolean): Uint8Array {
  // Types : t0 = (i32×6)->() pour les produits ; t1 = (i32,f32,i32,i32)->() pour axpy.
  const t0 = [0x60, ...vec([[I32], [I32], [I32], [I32], [I32], [I32]]), 0x00];
  const t1 = [0x60, ...vec([[I32], [F32], [I32], [I32]]), 0x00];
  const types = section(1, vec([t0, t1]));
  const funcs = section(3, vec([[0x00], [0x01], [0x00], [0x00]])); // mm1:t0, axpy:t1, mmb4:t0, mmb1:t0
  const mem = section(5, vec([[0x00, ...uleb(pages)]])); // limite min seule (la mémoire peut grandir)
  const exports = section(7, vec([
    nomExport('mem', 0x02, 0), nomExport('mm1', 0x00, 0), nomExport('axpy', 0x00, 1), nomExport('mmb4', 0x00, 2), nomExport('mmb1', 0x00, 3),
  ]));
  const corps = [
    [...locaux([[7, I32], [2, V128]]), ...corpsMm1()],
    [...locaux([[3, I32], [2, V128]]), ...corpsAxpy()],
    [...locaux(localesBloc(4)), ...corpsBloc(4, fma)],
    [...locaux(localesBloc(1)), ...corpsBloc(1, fma)],
  ];
  const code = section(10, vec(corps.map((b) => [...uleb(b.length), ...b])));
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...types, ...funcs, ...mem, ...exports, ...code]);
}

// ----------------------------------------------------------------------------------------------------------------
// Chargement du module et interface publique.
// ----------------------------------------------------------------------------------------------------------------

// WebAssembly est toujours présent dans Node mais absent des types du projet (pas de « lib dom »).
interface MemoireWA { buffer: ArrayBuffer; grow(pages: number): number }
const WA = (globalThis as unknown as {
  WebAssembly: {
    Module: new (b: Uint8Array) => object;
    Instance: new (m: object) => { exports: Record<string, unknown> };
    validate?: (b: Uint8Array) => boolean;
  };
}).WebAssembly;

const PAGE = 65536;
/** Taille maximale de la mémoire d'un noyau (zone de travail + résidents), en pages de 64 Kio : 160 Mio. */
const PAGES_MAX = 2560;
/**
 * Zone de travail la plus grande gardée d'un appel à l'autre, en flottants (16 Mio, l'ancienne mémoire fixe). Les
 * produits de Soul y tiennent largement (au plus ~1,6 M flottants pour le gabarit « grand ») ; un produit plus gros
 * (la vision) se fait dans une mémoire à part, rendue au ramasse-miettes juste après.
 */
const TRAVAIL_MAX = 1 << 22;

/** Les modes de noyau, du plus rapide au plus simple. */
export type ModeNoyau = 'fma' | 'bloc' | 'ancien' | 'js';
export const MODES_NOYAU: readonly ModeNoyau[] = ['fma', 'bloc', 'ancien', 'js'];

export interface Noyaux {
  readonly simd: boolean;
  /** Le noyau réellement utilisé (après détection et replis). */
  readonly mode: ModeNoyau;
  /** C[M,N] = A[M,K]·B[K,N]. */
  mm(c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void;
  /** y[0..n[ += alpha·x[0..n[. */
  axpy(y: Float32Array, alpha: number, x: Float32Array, n: number): void;
  /** GFLOP/s mesuré sur un produit carré de côté donné. */
  mesure(cote: number): number;
  /**
   * Un tenseur gardé dans la mémoire du noyau (modes « fma » et « bloc » seulement). Rend son adresse (en flottants),
   * recopiée par `remplir` seulement si (proprio, nom) est neuf ou si `version` a changé ; -1 si la place manque.
   */
  resident?(proprio: object, nom: string, version: number, longueur: number, remplir: (dst: Float32Array) => void): number;
  /** C[M,N] = A[M,K]·B, où B est un résident (adresse rendue par resident()). */
  mmResident?(c: Float32Array, a: Float32Array, adrB: number, M: number, K: number, N: number): void;
  /** Taille actuelle de la mémoire du noyau, en octets (modes à résidents ; sert aux essais et au banc). */
  octets?(): number;
}

/** Produit naïf JavaScript (référence lisible, sommes en double). */
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
    simd: false, mode: 'js',
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

type FnMm = (a: number, b: number, c: number, M: number, K: number, N: number) => void;
interface Instance { mem: MemoireWA; mm1: FnMm; mmb4: FnMm; mmb1: FnMm; axpy: (y: number, a: number, x: number, n: number) => void }

/** Le module compilé (une fois) ; chaque instance a sa propre mémoire. */
function compiler(fma: boolean, pages: number): object | undefined {
  if (!WA?.Module) return undefined;
  const oct = construireModule(pages, fma);
  if (WA.validate && !WA.validate(oct)) return undefined; // la machine ne connaît pas une instruction (SIMD, fusion)
  return new WA.Module(oct);
}
function instanceDe(mod: object): Instance {
  const e = new WA.Instance(mod).exports;
  return { mem: e.mem as MemoireWA, mm1: e.mm1 as FnMm, mmb4: e.mmb4 as FnMm, mmb1: e.mmb1 as FnMm, axpy: e.axpy as Instance['axpy'] };
}
function instancier(fma: boolean, pages: number): Instance | undefined {
  const mod = compiler(fma, pages);
  return mod ? instanceDe(mod) : undefined;
}

/** L'ancien chemin, à l'identique : mm1 ligne à ligne, 16 Mio fixes, recopie à chaque appel, JS pour les petits. */
function noyauxAnciens(): Noyaux | undefined {
  const inst = instancier(false, 256);
  if (!inst) return undefined;
  const capaciteF32 = (256 * PAGE) / 4;
  const heap = new Float32Array(inst.mem.buffer);
  const mm = (c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void => {
    const szA = M * K, szB = K * N, szC = M * N;
    if ((M < 8 && N < 256) || szA + szB + szC > capaciteF32) { produitBloc(c, a, b, M, K, N); return; }
    heap.set(a.subarray(0, szA), 0);
    heap.set(b.subarray(0, szB), szA);
    const offC = szA + szB;
    inst.mm1(0, szA * 4, offC * 4, M, K, N);
    c.set(heap.subarray(offC, offC + szC));
  };
  const axpy = (y: Float32Array, alpha: number, x: Float32Array, n: number): void => {
    if (2 * n > capaciteF32) { axpyJS(y, alpha, x, n); return; }
    heap.set(y.subarray(0, n), 0); heap.set(x.subarray(0, n), n);
    inst.axpy(0, alpha, n * 4, n);
    y.set(heap.subarray(0, n));
  };
  return { simd: true, mode: 'ancien', mm, axpy, mesure(cote) { return mesureGflops((c, a, b) => mm(c, a, b, cote, cote, cote), cote); } };
}

/** Le noyau par blocs (avec ou sans fusion), avec ses résidents. */
function noyauxBloc(fma: boolean): Noyaux | undefined {
  const PAGES0 = 256;
  const mod = compiler(fma, PAGES0);
  if (!mod) return undefined;
  let inst = instanceDe(mod);
  let heap = new Float32Array(inst.mem.buffer);
  let pages = PAGES0;
  /** Zone de travail : [0, travail[ ; résidents : [travail, haut[. */
  const TRAVAIL0 = 1 << 20; // 4 Mio de zone de travail au départ
  let travail = TRAVAIL0, haut = travail;
  let epoque = 0;
  const residents = new Map<string, { adr: number; longueur: number; version: number; epoque: number; id: number }>();
  const ids = new WeakMap<object, number>(); let prochainId = 1;
  const oublierResidents = (): void => { residents.clear(); epoque++; haut = travail; };
  /** Fait grandir la mémoire pour tenir `flottants` (faux si c'est au-delà du plafond). */
  const assurer = (flottants: number): boolean => {
    const besoin = Math.ceil((flottants * 4) / PAGE);
    if (besoin <= pages) return true;
    if (besoin > PAGES_MAX) return false;
    try { inst.mem.grow(besoin - pages); } catch { return false; }
    pages = besoin; heap = new Float32Array(inst.mem.buffer); // l'ancienne vue est détachée
    return true;
  };
  /**
   * Une mémoire WebAssembly ne rétrécit pas : pour rendre la place, on repart d'une instance neuve (même module
   * compilé), à la taille de la zone de travail. Les résidents sont oubliés ; ceux des réseaux vivants seront recopiés
   * au prochain usage (une copie de leurs poids, une fois).
   */
  const repartir = (): void => {
    inst = instanceDe(mod); pages = PAGES0; heap = new Float32Array(inst.mem.buffer);
    oublierResidents();
    if (!assurer(travail)) { travail = TRAVAIL0; haut = travail; assurer(travail); }
  };
  /** Les copies d'un réseau disparu (ramassé) : rendues. Appelé par le ramasse-miettes, jamais pendant un calcul. */
  let morts = 0;
  const disparus = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry<number>((id) => {
    let rendu = 0;
    for (const [cle, r] of residents) if (r.id === id) { rendu += r.longueur; residents.delete(cle); }
    if (rendu === 0) return;
    morts += rendu;
    // La place des disparus dépasse celle des vivants : on repart d'une mémoire à la bonne taille.
    let vivants = 0; for (const r of residents.values()) vivants += r.longueur;
    if (pages > PAGES0 && morts > vivants) { morts = 0; repartir(); }
  }) : undefined;
  const N8 = (N: number): number => N & ~7;
  /** C = A·B, tout déjà dans la mémoire `h` de l'instance `I` (adresses en flottants). Blocs 4×8, lignes restantes en 1×8, colonnes restantes en JS. */
  const calcul = (I: Instance, h: Float32Array, adrA: number, adrB: number, adrC: number, M: number, K: number, N: number): void => {
    const M4 = M & ~3, Nb = N8(N);
    if (Nb > 0) {
      if (M4 > 0) I.mmb4(adrA * 4, adrB * 4, adrC * 4, M4, K, N);
      if (M > M4) I.mmb1((adrA + M4 * K) * 4, adrB * 4, (adrC + M4 * N) * 4, M - M4, K, N);
    }
    if (Nb < N) {
      // Les dernières colonnes (au plus 7) : même ordre de somme, mêmes arrondis Float32 (multiplication puis addition).
      const fr = Math.fround;
      for (let m = 0; m < M; m++) {
        const am = adrA + m * K, cm = adrC + m * N;
        for (let n = Nb; n < N; n++) {
          let s = 0;
          for (let k = 0; k < K; k++) s = fr(s + fr(h[am + k] * h[adrB + k * N + n]));
          h[cm + n] = s;
        }
      }
    }
  };
  const petit = (M: number, K: number, N: number): boolean => M * K * N < 2048;
  const mm = (c: Float32Array, a: Float32Array, b: Float32Array, M: number, K: number, N: number): void => {
    const szA = M * K, szB = K * N, szC = M * N;
    if (petit(M, K, N)) { produitBloc(c, a, b, M, K, N); return; }
    const total = szA + szB + szC, offC = szA + szB;
    if (total > TRAVAIL_MAX) {
      // Très gros produit (la vision) : une mémoire à part, à sa taille, rendue au ramasse-miettes juste après. La
      // mémoire du noyau (et ses résidents) ne bouge pas.
      const besoin = Math.ceil((total * 4) / PAGE);
      if (besoin > PAGES_MAX) { produitBloc(c, a, b, M, K, N); return; }
      const I = instanceDe(mod);
      try { if (besoin > PAGES0) I.mem.grow(besoin - PAGES0); } catch { produitBloc(c, a, b, M, K, N); return; }
      const h = new Float32Array(I.mem.buffer);
      h.set(a.subarray(0, szA), 0); h.set(b.subarray(0, szB), szA);
      calcul(I, h, 0, szA, offC, M, K, N);
      c.set(h.subarray(offC, offC + szC));
      return;
    }
    if (total > travail) {
      // Zone de travail trop petite : elle grandit, jusqu'à TRAVAIL_MAX (les résidents sont oubliés, ils seront
      // recopiés au besoin).
      if (!assurer(total)) { produitBloc(c, a, b, M, K, N); return; }
      travail = total; oublierResidents();
    }
    heap.set(a.subarray(0, szA), 0);
    heap.set(b.subarray(0, szB), szA);
    calcul(inst, heap, 0, szA, offC, M, K, N);
    c.set(heap.subarray(offC, offC + szC));
  };
  const mmResident = (c: Float32Array, a: Float32Array, adrB: number, M: number, K: number, N: number): void => {
    const szA = M * K, szC = M * N;
    // Même règle que mm() pour les tout petits produits (résultat identique, résident ou pas) ; zone trop petite : on
    // sort B de la mémoire d'abord (la faire grandir détacherait la vue).
    if (petit(M, K, N) || szA + szC > travail) { mm(c, a, heap.slice(adrB, adrB + K * N), M, K, N); return; }
    heap.set(a.subarray(0, szA), 0);
    calcul(inst, heap, 0, adrB, szA, M, K, N);
    c.set(heap.subarray(szA, szA + szC));
  };
  const resident = (proprio: object, nom: string, version: number, longueur: number, remplir: (dst: Float32Array) => void): number => {
    let id = ids.get(proprio); if (id === undefined) { id = prochainId++; ids.set(proprio, id); disparus?.register(proprio, id); }
    const cle = `${id}:${nom}`;
    const r = residents.get(cle);
    if (r && r.epoque === epoque && r.longueur === longueur) {
      if (r.version !== version) { remplir(heap.subarray(r.adr, r.adr + longueur)); r.version = version; }
      return r.adr;
    }
    // Place neuve (alignée sur 4 flottants = 16 octets). Plus de place : on oublie tout et on recommence en haut de la
    // zone de travail (cas d'un autre réseau dans le même fil, ou d'une très grande taille).
    let adr = (haut + 3) & ~3;
    // Faire grandir la mémoire alors que des réseaux disparus y tiennent encore de la place : on la reprend d'abord.
    if (morts > 0 && adr + longueur > (pages * PAGE) / 4) { morts = 0; oublierResidents(); adr = (haut + 3) & ~3; }
    if (!assurer(adr + longueur)) {
      oublierResidents(); adr = (haut + 3) & ~3;
      if (!assurer(adr + longueur)) return -1;
    }
    haut = adr + longueur;
    remplir(heap.subarray(adr, adr + longueur));
    residents.set(cle, { adr, longueur, version, epoque, id });
    return adr;
  };
  const axpy = (y: Float32Array, alpha: number, x: Float32Array, n: number): void => {
    if (2 * n > travail) { axpyJS(y, alpha, x, n); return; }
    heap.set(y.subarray(0, n), 0); heap.set(x.subarray(0, n), n);
    inst.axpy(0, alpha, n * 4, n);
    y.set(heap.subarray(0, n));
  };
  // Mémoire initiale : la zone de travail doit tenir.
  if (!assurer(travail)) return undefined;
  return {
    simd: true, mode: fma ? 'fma' : 'bloc', mm, axpy, resident, mmResident, octets: () => inst.mem.buffer.byteLength,
    mesure(cote) { return mesureGflops((c, a, b) => mm(c, a, b, cote, cote, cote), cote); },
  };
}

/** Un produit d'essai : le noyau doit rendre le produit exact à la précision Float32 près (sinon on ne le prend pas). */
function produitJuste(k: Noyaux): boolean {
  try {
    for (const [M, K, N] of [[9, 37, 27], [4, 64, 16], [1, 128, 512], [130, 33, 40]] as Array<[number, number, number]>) {
      const a = new Float32Array(M * K), b = new Float32Array(K * N);
      for (let i = 0; i < a.length; i++) a[i] = Math.sin(i * 0.7) * 0.5;
      for (let i = 0; i < b.length; i++) b[i] = Math.cos(i * 0.3) * 0.5;
      const c = new Float32Array(M * N), ref = new Float32Array(M * N);
      k.mm(c, a, b, M, K, N); produitNaif(ref, a, b, M, K, N);
      let ecart = 0, max = 0;
      for (let i = 0; i < c.length; i++) { if (!Number.isFinite(c[i])) return false; ecart = Math.max(ecart, Math.abs(c[i] - ref[i])); max = Math.max(max, Math.abs(ref[i])); }
      if (ecart > 1e-5 * Math.max(1, max) * K) return false;
    }
    return true;
  } catch { return false; }
}

/** Fabrique les noyaux d'un mode précis (undefined si la machine ne le permet pas, ou si le produit d'essai est faux). */
export function fabriquerNoyaux(mode: ModeNoyau): Noyaux | undefined {
  try {
    const k = mode === 'js' ? noyauxJS() : mode === 'ancien' ? noyauxAnciens() : noyauxBloc(mode === 'fma');
    return k && produitJuste(k) ? k : undefined;
  } catch { return undefined; }
}

let noyauxCache: Noyaux | undefined;

/**
 * Les noyaux de calcul, choisis UNE fois par fil : blocs avec fusion, sinon blocs sans fusion, sinon l'ancien noyau
 * ligne à ligne, sinon JavaScript. (La variable d'environnement ODIN_NOYAU force un mode, pour les essais et le banc.)
 */
export function noyaux(): Noyaux {
  if (noyauxCache) return noyauxCache;
  const force = process.env.ODIN_NOYAU as ModeNoyau | undefined;
  const ordre: ModeNoyau[] = force && MODES_NOYAU.includes(force) ? MODES_NOYAU.slice(MODES_NOYAU.indexOf(force)) : [...MODES_NOYAU];
  for (const m of ordre) { const k = fabriquerNoyaux(m); if (k) { noyauxCache = k; return k; } }
  noyauxCache = noyauxJS();
  return noyauxCache;
}
