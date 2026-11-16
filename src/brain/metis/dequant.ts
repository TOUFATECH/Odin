// Déquantification des tenseurs GGUF — transformer les octets rangés du fichier en flottants 32 bits prêts au calcul.
//
// Les modèles ouverts sont « quantifiés » : au lieu d'un flottant par poids, ggml range des blocs compacts (un
// facteur d'échelle partagé + de petits entiers). On reconstruit la valeur d'origine d'après le FORMAT PUBLIC de
// ggml (dispositions des blocs documentées), sans recopier de code sous licence.
//
// Priorité : la JUSTESSE d'abord. Les quantifications simples (Q4_0, Q8_0, F16, BF16, F32) sont faites et
// vérifiées avant les K-quants (Q4_K, Q6_K), qui rangent des super-blocs de 256 avec des sous-échelles 6 bits.

// Types ggml (le même entier que dans le fichier).
export const GGML = { F32: 0, F16: 1, Q4_0: 2, Q8_0: 8, Q4_K: 12, Q6_K: 14, BF16: 30 } as const;

// Tailles de bloc (éléments par bloc, octets par bloc).
const QK = 32; // bloc des quantifications simples
const QK_K = 256; // super-bloc des K-quants

// --- Demi-précision ------------------------------------------------------------------------------------------------
const _u32 = new Uint32Array(1);
const _f32 = new Float32Array(_u32.buffer);

/** fp16 (IEEE demi-précision) → f32. Gère les sous-normaux, l'infini et NaN. */
export function f16ToF32(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * 2 ** -14 * (f / 1024);
  if (e === 0x1f) return f ? Number.NaN : s ? -Infinity : Infinity;
  return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 1024);
}

/** bf16 (les 16 bits de poids fort d'un f32) → f32. */
export function bf16ToF32(h: number): number {
  _u32[0] = (h << 16) >>> 0;
  return _f32[0];
}

// --- Outils ----------------------------------------------------------------------------------------------------------
function vue(octets: Uint8Array): DataView {
  return new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
}
function exigerTaille(octets: Uint8Array, attendu: number, quoi: string): void {
  if (octets.byteLength < attendu) throw new Error(`déquantification ${quoi} : ${octets.byteLength} octets pour ${attendu} attendus`);
}
function exigerBloc(nbElem: number, bloc: number, quoi: string): void {
  if (nbElem < 0 || nbElem % bloc !== 0) throw new Error(`déquantification ${quoi} : ${nbElem} éléments ne tiennent pas en blocs de ${bloc}`);
}

// --- Quantifications simples -----------------------------------------------------------------------------------------

/** Q4_0 : blocs de 32, 18 octets (fp16 d + 16 octets de quartets). valeur = d·(quartet − 8). */
function q4_0(octets: Uint8Array, nbElem: number): Float32Array {
  exigerBloc(nbElem, QK, 'Q4_0');
  const nb = nbElem / QK;
  exigerTaille(octets, nb * 18, 'Q4_0');
  const dv = vue(octets);
  const out = new Float32Array(nbElem);
  for (let i = 0; i < nb; i++) {
    const base = i * 18;
    const d = f16ToF32(dv.getUint16(base, true));
    for (let j = 0; j < 16; j++) {
      const b = octets[base + 2 + j];
      out[i * QK + j] = ((b & 0x0f) - 8) * d;
      out[i * QK + j + 16] = ((b >> 4) - 8) * d;
    }
  }
  return out;
}

/** Q8_0 : blocs de 32, 34 octets (fp16 d + 32 entiers signés). valeur = d·q. */
function q8_0(octets: Uint8Array, nbElem: number): Float32Array {
  exigerBloc(nbElem, QK, 'Q8_0');
  const nb = nbElem / QK;
  exigerTaille(octets, nb * 34, 'Q8_0');
  const dv = vue(octets);
  const out = new Float32Array(nbElem);
  for (let i = 0; i < nb; i++) {
    const base = i * 34;
    const d = f16ToF32(dv.getUint16(base, true));
    for (let j = 0; j < QK; j++) out[i * QK + j] = dv.getInt8(base + 2 + j) * d;
  }
  return out;
}

function f16Plein(octets: Uint8Array, nbElem: number): Float32Array {
  exigerTaille(octets, nbElem * 2, 'F16');
  const dv = vue(octets);
  const out = new Float32Array(nbElem);
  for (let i = 0; i < nbElem; i++) out[i] = f16ToF32(dv.getUint16(i * 2, true));
  return out;
}

function bf16Plein(octets: Uint8Array, nbElem: number): Float32Array {
  exigerTaille(octets, nbElem * 2, 'BF16');
  const dv = vue(octets);
  const out = new Float32Array(nbElem);
  for (let i = 0; i < nbElem; i++) out[i] = bf16ToF32(dv.getUint16(i * 2, true));
  return out;
}

function f32Plein(octets: Uint8Array, nbElem: number): Float32Array {
  exigerTaille(octets, nbElem * 4, 'F32');
  const dv = vue(octets);
  const out = new Float32Array(nbElem);
  for (let i = 0; i < nbElem; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}

// --- K-quants (super-blocs de 256) -----------------------------------------------------------------------------------

/** Lit la paire (échelle, minimum) sur 6 bits d'un bloc Q4_K, d'après la disposition publique de ggml. */
function echelleMinK4(j: number, sc: Uint8Array, baseSc: number): [number, number] {
  if (j < 4) return [sc[baseSc + j] & 63, sc[baseSc + j + 4] & 63];
  const d = (sc[baseSc + j + 4] & 0x0f) | ((sc[baseSc + j - 4] >> 6) << 4);
  const m = (sc[baseSc + j + 4] >> 4) | ((sc[baseSc + j] >> 6) << 4);
  return [d, m];
}

/** Q4_K : super-blocs de 256, 144 octets (fp16 d + fp16 dmin + 12 octets d'échelles + 128 octets de quartets). */
function q4_K(octets: Uint8Array, nbElem: number): Float32Array {
  exigerBloc(nbElem, QK_K, 'Q4_K');
  const nb = nbElem / QK_K;
  exigerTaille(octets, nb * 144, 'Q4_K');
  const dv = vue(octets);
  const out = new Float32Array(nbElem);
  for (let i = 0; i < nb; i++) {
    const base = i * 144;
    const d = f16ToF32(dv.getUint16(base, true));
    const dmin = f16ToF32(dv.getUint16(base + 2, true));
    const baseSc = base + 4; // 12 octets d'échelles
    const baseQ = base + 16; // 128 octets de quartets
    let is = 0;
    let y = i * QK_K;
    for (let j = 0; j < QK_K; j += 64) {
      const [sc1, m1] = echelleMinK4(is, octets, baseSc);
      const [sc2, m2] = echelleMinK4(is + 1, octets, baseSc);
      const d1 = d * sc1, min1 = dmin * m1;
      const d2 = d * sc2, min2 = dmin * m2;
      const q = baseQ + (j / 64) * 32;
      for (let l = 0; l < 32; l++) out[y++] = d1 * (octets[q + l] & 0x0f) - min1;
      for (let l = 0; l < 32; l++) out[y++] = d2 * (octets[q + l] >> 4) - min2;
      is += 2;
    }
  }
  return out;
}

/** Q6_K : super-blocs de 256, 210 octets (128 quartets bas + 64 bits hauts + 16 échelles signées + fp16 d). */
function q6_K(octets: Uint8Array, nbElem: number): Float32Array {
  exigerBloc(nbElem, QK_K, 'Q6_K');
  const nb = nbElem / QK_K;
  exigerTaille(octets, nb * 210, 'Q6_K');
  const dv = vue(octets);
  const out = new Float32Array(nbElem);
  for (let i = 0; i < nb; i++) {
    const base = i * 210;
    const baseQl = base; // 128 octets
    const baseQh = base + 128; // 64 octets
    const baseSc = base + 192; // 16 octets (int8)
    const d = f16ToF32(dv.getUint16(base + 208, true));
    let y = i * QK_K;
    for (let n = 0; n < QK_K; n += 128) {
      const ql = baseQl + (n / 128) * 64;
      const qh = baseQh + (n / 128) * 32;
      const sc = baseSc + (n / 128) * 8;
      for (let l = 0; l < 32; l++) {
        const is = l >> 4; // 0 ou 1
        const h = octets[qh + l];
        const q1 = ((octets[ql + l] & 0x0f) | (((h >> 0) & 3) << 4)) - 32;
        const q2 = ((octets[ql + l + 32] & 0x0f) | (((h >> 2) & 3) << 4)) - 32;
        const q3 = ((octets[ql + l] >> 4) | (((h >> 4) & 3) << 4)) - 32;
        const q4 = ((octets[ql + l + 32] >> 4) | (((h >> 6) & 3) << 4)) - 32;
        out[y + l] = d * dv.getInt8(sc + is) * q1;
        out[y + l + 32] = d * dv.getInt8(sc + is + 2) * q2;
        out[y + l + 64] = d * dv.getInt8(sc + is + 4) * q3;
        out[y + l + 96] = d * dv.getInt8(sc + is + 6) * q4;
      }
      y += 128;
    }
  }
  return out;
}

/** Nom lisible d'une quantification (pour le catalogue et les messages). */
export function nomQuant(type: number): string {
  switch (type) {
    case GGML.F32: return 'F32';
    case GGML.F16: return 'F16';
    case GGML.Q4_0: return 'Q4_0';
    case GGML.Q8_0: return 'Q8_0';
    case GGML.Q4_K: return 'Q4_K';
    case GGML.Q6_K: return 'Q6_K';
    case GGML.BF16: return 'BF16';
    default: return `type ${type}`;
  }
}

/** Nombre d'octets qu'occupent `nbElem` éléments d'un type donné (pour borner la lecture AVANT de lire). */
export function octetsAttendus(type: number, nbElem: number): number {
  switch (type) {
    case GGML.F32: return nbElem * 4;
    case GGML.F16:
    case GGML.BF16: return nbElem * 2;
    case GGML.Q4_0: return (nbElem / QK) * 18;
    case GGML.Q8_0: return (nbElem / QK) * 34;
    case GGML.Q4_K: return (nbElem / QK_K) * 144;
    case GGML.Q6_K: return (nbElem / QK_K) * 210;
    default: throw new Error(`type de quantification inconnu : ${type}`);
  }
}

/** Le bloc (nombre d'éléments par bloc) d'un type : sert à vérifier que les dimensions sont compatibles. */
export function blocDe(type: number): number {
  switch (type) {
    case GGML.F32:
    case GGML.F16:
    case GGML.BF16: return 1;
    case GGML.Q4_0:
    case GGML.Q8_0: return QK;
    case GGML.Q4_K:
    case GGML.Q6_K: return QK_K;
    default: throw new Error(`type de quantification inconnu : ${type}`);
  }
}

/** Déquantifie `nbElem` éléments rangés dans `octets` selon le type ggml donné. Lève une erreur claire si la
 *  taille ne colle pas (le fichier est traité comme HOSTILE : jamais de lecture hors des octets fournis). */
export function dequantifier(octets: Uint8Array, type: number, nbElem: number): Float32Array {
  switch (type) {
    case GGML.F32: return f32Plein(octets, nbElem);
    case GGML.F16: return f16Plein(octets, nbElem);
    case GGML.BF16: return bf16Plein(octets, nbElem);
    case GGML.Q4_0: return q4_0(octets, nbElem);
    case GGML.Q8_0: return q8_0(octets, nbElem);
    case GGML.Q4_K: return q4_K(octets, nbElem);
    case GGML.Q6_K: return q6_K(octets, nbElem);
    default: throw new Error(`type de quantification non pris en charge : ${type}`);
  }
}
