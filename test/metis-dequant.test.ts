// Déquantification de Métis (src/brain/metis/dequant.ts) : Q4_0, Q8_0, F16, BF16 et F32, octet à octet, contre des
// valeurs de référence calculées À LA MAIN. La justesse d'abord : si un seul octet est mal lu, un de ces nombres
// change. Aucun vrai modèle, aucun service.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dequantifier, f16ToF32, bf16ToF32, GGML, octetsAttendus } from '../src/brain/metis/dequant.ts';

/** fp16 (bits) d'une valeur, par la primitive native (sert à fabriquer l'entrée, pas à la décoder). */
function f16bits(x: number): number {
  const dv = new DataView(new ArrayBuffer(2)) as DataView & { setFloat16(o: number, v: number, le: boolean): void };
  dv.setFloat16(0, x, true);
  return dv.getUint16(0, true);
}
/** bf16 (bits) = les 16 bits de poids fort d'un f32. */
function bf16bits(x: number): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, x, true);
  return dv.getUint16(2, true);
}
function u16le(n: number): number[] { return [n & 0xff, (n >> 8) & 0xff]; }

test('Q4_0 : un bloc de 32, d en fp16 puis 16 octets de quartets, valeur = d·(quartet − 8)', () => {
  const d = 0.5; // exactement représentable en fp16
  const octets = new Uint8Array(18);
  octets.set(u16le(f16bits(d)), 0);
  // byte j → élément j (quartet bas) et élément j+16 (quartet haut).
  const qs = octets.subarray(2);
  qs.fill(0x88); // partout : quartets 8 et 8 → valeur 0
  qs[0] = 0x3a; // bas = 0xA = 10, haut = 0x3 = 3
  qs[15] = 0xf1; // bas = 1, haut = 0xF = 15
  const out = dequantifier(octets, GGML.Q4_0, 32);
  assert.equal(out.length, 32);
  assert.equal(out[0], 0.5 * (10 - 8)); // 1.0
  assert.equal(out[16], 0.5 * (3 - 8)); // -2.5
  assert.equal(out[15], 0.5 * (1 - 8)); // -3.5
  assert.equal(out[31], 0.5 * (15 - 8)); // 3.5
  assert.equal(out[1], 0); // quartets 8 → 0
  assert.equal(out[17], 0);
});

test('Q8_0 : un bloc de 32, d en fp16 puis 32 entiers signés, valeur = d·q', () => {
  const d = 0.5;
  const octets = new Uint8Array(34);
  octets.set(u16le(f16bits(d)), 0);
  const dv = new DataView(octets.buffer);
  for (let j = 0; j < 32; j++) dv.setInt8(2 + j, 0);
  dv.setInt8(2 + 0, 10); // 5.0
  dv.setInt8(2 + 1, -4); // -2.0
  dv.setInt8(2 + 31, 127); // 63.5
  const out = dequantifier(octets, GGML.Q8_0, 32);
  assert.equal(out.length, 32);
  assert.equal(out[0], 5);
  assert.equal(out[1], -2);
  assert.equal(out[31], 63.5);
  assert.equal(out[2], 0);
});

test('F16 : demi-précision, valeurs exactement représentables', () => {
  const vals = [1, -2, 0.5, 65504, 0, -0.25];
  const octets = new Uint8Array(vals.length * 2);
  for (let i = 0; i < vals.length; i++) octets.set(u16le(f16bits(vals[i])), i * 2);
  const out = dequantifier(octets, GGML.F16, vals.length);
  for (let i = 0; i < vals.length; i++) assert.equal(out[i], vals[i], `F16[${i}]`);
  // Le décodeur bit à bit donne la même chose que la primitive native.
  for (const v of vals) assert.equal(f16ToF32(f16bits(v)), v);
});

test('BF16 : les 16 bits de poids fort d\'un f32, valeurs exactement représentables', () => {
  const vals = [1, -2, 0.5, 3.5, 100, -0.125];
  const octets = new Uint8Array(vals.length * 2);
  for (let i = 0; i < vals.length; i++) octets.set(u16le(bf16bits(vals[i])), i * 2);
  const out = dequantifier(octets, GGML.BF16, vals.length);
  for (let i = 0; i < vals.length; i++) assert.equal(out[i], vals[i], `BF16[${i}]`);
  for (const v of vals) assert.equal(bf16ToF32(bf16bits(v)), v);
});

test('F32 : flottants bruts petit-boutien', () => {
  const vals = [1.5, -3.25, 0, 2 ** 20];
  const octets = new Uint8Array(vals.length * 4);
  const dv = new DataView(octets.buffer);
  for (let i = 0; i < vals.length; i++) dv.setFloat32(i * 4, vals[i], true);
  const out = dequantifier(octets, GGML.F32, vals.length);
  for (let i = 0; i < vals.length; i++) assert.equal(out[i], vals[i]);
});

test('K-quants Q4_K / Q6_K : un bloc constant (tous quartets égaux) donne une valeur constante connue', () => {
  // Q4_K : super-bloc de 256. d et dmin en fp16 ; 12 octets d'échelles 6 bits ; 128 octets de quartets.
  // On choisit des échelles simples : on règle les 6 premières valeurs d'échelle à sc et les 6 mins à m, et tous
  // les quartets à une même valeur q. Chaque sortie vaut alors d·sc·q − dmin·m (constant par sous-bloc).
  {
    const d = 0.5, dmin = 0.25, sc = 1, m = 2, q = 5;
    const oct = new Uint8Array(144);
    const dv = new DataView(oct.buffer);
    dv.setUint16(0, f16bits(d), true);
    dv.setUint16(2, f16bits(dmin), true);
    // scales[0..3] & 63 = échelle ; scales[4..7] & 63 = min (les 8 premières paires d'échelle/min « basses »).
    for (let i = 0; i < 4; i++) oct[4 + i] = sc & 63;
    for (let i = 4; i < 8; i++) oct[4 + i] = m & 63;
    // scales[8..11] codent les bits hauts des échelles 4..7 : à zéro ici (on reste dans les 4 premiers sous-blocs).
    for (let i = 0; i < 128; i++) oct[16 + i] = (q & 0x0f) | ((q & 0x0f) << 4); // quartet bas = haut = q
    const out = dequantifier(oct, GGML.Q4_K, 256);
    // Premier sous-bloc (échelle 0) : d·sc·q − dmin·m.
    assert.ok(Math.abs(out[0] - (d * sc * q - dmin * m)) < 1e-6, `Q4_K out[0]=${out[0]}`);
    assert.equal(out.length, 256);
  }
  // Q6_K : super-bloc de 256. 128 quartets bas + 64 bits hauts + 16 échelles signées + fp16 d.
  {
    const d = 0.5, sc = 2;
    const oct = new Uint8Array(210);
    const dv = new DataView(oct.buffer);
    // ql : quartets bas = 0 ; qh : bits hauts = 0 ⇒ q brut = 0, moins 32 ⇒ -32.
    for (let i = 0; i < 16; i++) dv.setInt8(192 + i, sc);
    dv.setUint16(208, f16bits(d), true);
    const out = dequantifier(oct, GGML.Q6_K, 256);
    assert.ok(Math.abs(out[0] - d * sc * (0 - 32)) < 1e-6, `Q6_K out[0]=${out[0]}`); // 0.5·2·(-32) = -32
    assert.equal(out.length, 256);
  }
});

test('octetsAttendus : les tailles de bloc publiques', () => {
  assert.equal(octetsAttendus(GGML.Q4_0, 32), 18);
  assert.equal(octetsAttendus(GGML.Q8_0, 32), 34);
  assert.equal(octetsAttendus(GGML.Q4_K, 256), 144);
  assert.equal(octetsAttendus(GGML.Q6_K, 256), 210);
  assert.equal(octetsAttendus(GGML.F16, 10), 20);
  assert.equal(octetsAttendus(GGML.F32, 10), 40);
});

test('déquantification hostile : refus net si les octets ne suffisent pas, ou si le compte ne tient pas en blocs', () => {
  assert.throws(() => dequantifier(new Uint8Array(10), GGML.Q4_0, 32), /Q4_0/); // 18 octets attendus
  assert.throws(() => dequantifier(new Uint8Array(18), GGML.Q4_0, 33), /blocs de 32/);
  assert.throws(() => dequantifier(new Uint8Array(2), GGML.F16, 10), /F16/);
  assert.throws(() => dequantifier(new Uint8Array(4), 999, 1), /non pris en charge/);
});
