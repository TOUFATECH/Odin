// Essai d'intégration de Métis : réunit le lot A (lecteur GGUF) et le lot B (moteur). On fabrique un VRAI fichier GGUF
// minuscule, OCTET PAR OCTET, d'après le format public (magic « GGUF », version 3, tout en petit-boutien), on le lit
// avec lireGguf (lot A), on calcule la passe avant et une génération avec le moteur (lot B), et on compare les logits
// à une référence calculée à la main sur le même micro-modèle. AUCUN vrai service, AUCUN vrai modèle n'est contacté.
//
// Comme A et B sont codés en parallèle, ce fichier importe le lot A de façon DYNAMIQUE : tant que src/brain/metis/gguf.ts
// n'est pas livré, l'essai est « sauté » proprement (et le dit) au lieu de faire échouer toute la suite. Dès que A est
// là, l'essai tourne pour de vrai.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { creerEtat, passeAvant } from '../src/brain/metis/avant.ts';

// --- Petit encodeur GGUF (format public ggml), le strict nécessaire pour un micro-llama. ---
const GGUF_TYPE = { UINT32: 4, FLOAT32: 6, STRING: 8, ARRAY: 9, UINT64: 10 } as const;
const GGML_F32 = 0;

class Ecrivain {
  private morceaux: Buffer[] = [];
  private taille = 0;
  u32(n: number): void { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); this.pousser(b); }
  u64(n: number): void { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); this.pousser(b); }
  f32(x: number): void { const b = Buffer.alloc(4); b.writeFloatLE(x, 0); this.pousser(b); }
  chaine(s: string): void { const buf = Buffer.from(s, 'utf8'); this.u64(buf.length); this.pousser(buf); }
  brut(b: Buffer): void { this.pousser(b); }
  private pousser(b: Buffer): void { this.morceaux.push(b); this.taille += b.length; }
  get longueur(): number { return this.taille; }
  // Remplit jusqu'au multiple d'alignement (octets nuls).
  aligner(a: number): void { const reste = this.taille % a; if (reste) this.pousser(Buffer.alloc(a - reste)); }
  fin(): Buffer { return Buffer.concat(this.morceaux); }
}

function kvU32(w: Ecrivain, cle: string, val: number): void { w.chaine(cle); w.u32(GGUF_TYPE.UINT32); w.u32(val); }
function kvF32(w: Ecrivain, cle: string, val: number): void { w.chaine(cle); w.u32(GGUF_TYPE.FLOAT32); w.f32(val); }
function kvStr(w: Ecrivain, cle: string, val: string): void { w.chaine(cle); w.u32(GGUF_TYPE.STRING); w.chaine(val); }
function kvArrStr(w: Ecrivain, cle: string, vals: string[]): void { w.chaine(cle); w.u32(GGUF_TYPE.ARRAY); w.u32(GGUF_TYPE.STRING); w.u64(vals.length); for (const v of vals) w.chaine(v); }
function kvArrF32(w: Ecrivain, cle: string, vals: number[]): void { w.chaine(cle); w.u32(GGUF_TYPE.ARRAY); w.u32(GGUF_TYPE.FLOAT32); w.u64(vals.length); for (const v of vals) w.f32(v); }
function kvU64(w: Ecrivain, cle: string, val: number): void { w.chaine(cle); w.u32(GGUF_TYPE.UINT64); w.u64(val); }

interface Cfg { C: number; L: number; nTete: number; nTeteKv: number; hd: number; ff: number; V: number; eps: number; base: number; nRot: number }
const CFG: Cfg = { C: 8, L: 2, nTete: 4, nTeteKv: 2, hd: 2, ff: 12, V: 10, eps: 1e-5, base: 10000, nRot: 2 };

function prng(graine: number): () => number {
  let a = graine >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5) * 0.6; };
}

// Les poids du micro-modèle, dans l'ordre GGUF (data[in + out*K]). nom → {dims:[K,N], data}.
function poidsModele(cfg: Cfg): Map<string, { dims: number[]; data: Float32Array }> {
  const { C, L, nTete, nTeteKv, hd, ff, V } = cfg;
  const rnd = prng(0xbeef);
  const W = new Map<string, { dims: number[]; data: Float32Array }>();
  const mk = (K: number, N: number): { dims: number[]; data: Float32Array } => { const d = new Float32Array(K * N); for (let i = 0; i < d.length; i++) d[i] = rnd(); return { dims: [K, N], data: d }; };
  const vec = (n: number): { dims: number[]; data: Float32Array } => { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = 1 + rnd(); return { dims: [n], data: d }; };
  W.set('token_embd.weight', mk(C, V));
  W.set('output_norm.weight', vec(C));
  W.set('output.weight', mk(C, V));
  for (let l = 0; l < L; l++) {
    W.set(`blk.${l}.attn_norm.weight`, vec(C));
    W.set(`blk.${l}.attn_q.weight`, mk(C, nTete * hd));
    W.set(`blk.${l}.attn_k.weight`, mk(C, nTeteKv * hd));
    W.set(`blk.${l}.attn_v.weight`, mk(C, nTeteKv * hd));
    W.set(`blk.${l}.attn_output.weight`, mk(nTete * hd, C));
    W.set(`blk.${l}.ffn_norm.weight`, vec(C));
    W.set(`blk.${l}.ffn_gate.weight`, mk(C, ff));
    W.set(`blk.${l}.ffn_up.weight`, mk(C, ff));
    W.set(`blk.${l}.ffn_down.weight`, mk(ff, C));
  }
  return W;
}

function construireGguf(cfg: Cfg, W: Map<string, { dims: number[]; data: Float32Array }>): Buffer {
  const ALIGN = 32;
  const noms = [...W.keys()];
  // 1) En-tête + métadonnées + fiches tenseurs (offsets relatifs au début de la section données).
  const tete = new Ecrivain();
  tete.brut(Buffer.from([0x47, 0x47, 0x55, 0x46])); // « GGUF »
  tete.u32(3); // version
  tete.u64(noms.length); // nombre de tenseurs
  // métadonnées
  const metas: Array<(w: Ecrivain) => void> = [
    (w) => kvStr(w, 'general.architecture', 'llama'),
    (w) => kvU32(w, 'llama.embedding_length', cfg.C),
    (w) => kvU32(w, 'llama.block_count', cfg.L),
    (w) => kvU32(w, 'llama.feed_forward_length', cfg.ff),
    (w) => kvU32(w, 'llama.attention.head_count', cfg.nTete),
    (w) => kvU32(w, 'llama.attention.head_count_kv', cfg.nTeteKv),
    (w) => kvF32(w, 'llama.attention.layer_norm_rms_epsilon', cfg.eps),
    (w) => kvU32(w, 'llama.rope.dimension_count', cfg.hd),
    (w) => kvF32(w, 'llama.rope.freq_base', cfg.base),
    (w) => kvU32(w, 'llama.context_length', 32),
    (w) => kvStr(w, 'tokenizer.ggml.model', 'llama'),
    (w) => kvArrStr(w, 'tokenizer.ggml.tokens', Array.from({ length: cfg.V }, (_, i) => `<${i}>`)),
    (w) => kvArrF32(w, 'tokenizer.ggml.scores', Array.from({ length: cfg.V }, () => 0)),
    (w) => kvU32(w, 'tokenizer.ggml.bos_token_id', 1),
    (w) => kvU32(w, 'tokenizer.ggml.eos_token_id', 2),
    (w) => kvU32(w, 'general.alignment', ALIGN),
  ];
  tete.u64(metas.length); // nombre de métadonnées
  for (const m of metas) m(tete);
  // fiches tenseurs : nom, n_dims, dims (u64), type (u32), offset (u64)
  let offset = 0;
  const offsets: number[] = [];
  for (const nom of noms) {
    const t = W.get(nom)!;
    tete.chaine(nom);
    tete.u32(t.dims.length);
    for (const d of t.dims) tete.u64(d);
    tete.u32(GGML_F32);
    tete.u64(offset);
    offsets.push(offset);
    let oct = t.data.byteLength;
    if (oct % ALIGN) oct += ALIGN - (oct % ALIGN);
    offset += oct;
  }
  // 2) padding jusqu'à l'alignement, puis données.
  tete.aligner(ALIGN);
  const donnees = new Ecrivain();
  for (let i = 0; i < noms.length; i++) {
    const t = W.get(noms[i])!;
    const b = Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength);
    donnees.brut(Buffer.from(b)); // copie
    donnees.aligner(ALIGN);
  }
  return Buffer.concat([tete.fin(), donnees.fin()]);
}

// Référence à la main (identique à l'essai unitaire), pour la parité des logits.
function reference(W: Map<string, { dims: number[]; data: Float32Array }>, cfg: Cfg, ids: number[]): Float32Array {
  const { C, L, nTete, nTeteKv, hd, ff, V, eps, base, nRot } = cfg;
  const grp = nTete / nTeteKv, inv = 1 / Math.sqrt(hd);
  const d = (n: string) => W.get(n)!.data;
  const rms = (x: Float32Array, w: Float32Array) => { let ss = 0; for (let i = 0; i < x.length; i++) ss += x[i] * x[i]; const r = 1 / Math.sqrt(ss / x.length + eps); const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] * r * w[i]; return o; };
  const mv = (data: Float32Array, x: Float32Array, K: number, N: number) => { const y = new Float32Array(N); for (let out = 0; out < N; out++) { let s = 0; for (let inp = 0; inp < K; inp++) s += data[inp + out * K] * x[inp]; y[out] = s; } return y; };
  const silu = (x: number) => x / (1 + Math.exp(-x));
  const rope = (arr: Float32Array, off: number, pos: number) => { const half = nRot >> 1; for (let i = 0; i < half; i++) { const th = pos * Math.pow(base, (-2 * i) / nRot); const c = Math.cos(th), s = Math.sin(th); const a = arr[off + 2 * i], b = arr[off + 2 * i + 1]; arr[off + 2 * i] = a * c - b * s; arr[off + 2 * i + 1] = a * s + b * c; } };
  const Kc: Float32Array[][] = Array.from({ length: L }, () => []);
  const Vc: Float32Array[][] = Array.from({ length: L }, () => []);
  let logits: Float32Array = new Float32Array(V);
  for (let pos = 0; pos < ids.length; pos++) {
    const id = ids[pos];
    const x = new Float32Array(C); for (let c = 0; c < C; c++) x[c] = d('token_embd.weight')[c + id * C];
    for (let l = 0; l < L; l++) {
      const a = rms(x, d(`blk.${l}.attn_norm.weight`));
      const q = mv(d(`blk.${l}.attn_q.weight`), a, C, nTete * hd);
      const k = mv(d(`blk.${l}.attn_k.weight`), a, C, nTeteKv * hd);
      const v = mv(d(`blk.${l}.attn_v.weight`), a, C, nTeteKv * hd);
      for (let h = 0; h < nTete; h++) rope(q, h * hd, pos);
      for (let h = 0; h < nTeteKv; h++) rope(k, h * hd, pos);
      Kc[l][pos] = k.slice(); Vc[l][pos] = v.slice();
      const ao = new Float32Array(nTete * hd);
      for (let h = 0; h < nTete; h++) {
        const kvh = Math.floor(h / grp), qoff = h * hd, koff = kvh * hd;
        const sc = new Float32Array(pos + 1); let mx = -Infinity;
        for (let j = 0; j <= pos; j++) { let s = 0; for (let c = 0; c < hd; c++) s += q[qoff + c] * Kc[l][j][koff + c]; s *= inv; sc[j] = s; if (s > mx) mx = s; }
        let som = 0; for (let j = 0; j <= pos; j++) { sc[j] = Math.exp(sc[j] - mx); som += sc[j]; }
        const r = 1 / som;
        for (let c = 0; c < hd; c++) { let s = 0; for (let j = 0; j <= pos; j++) s += sc[j] * r * Vc[l][j][koff + c]; ao[qoff + c] = s; }
      }
      const oo = mv(d(`blk.${l}.attn_output.weight`), ao, nTete * hd, C);
      for (let c = 0; c < C; c++) x[c] += oo[c];
      const b = rms(x, d(`blk.${l}.ffn_norm.weight`));
      const g = mv(d(`blk.${l}.ffn_gate.weight`), b, C, ff);
      const u = mv(d(`blk.${l}.ffn_up.weight`), b, C, ff);
      for (let i = 0; i < ff; i++) g[i] = silu(g[i]) * u[i];
      const f = mv(d(`blk.${l}.ffn_down.weight`), g, ff, C);
      for (let c = 0; c < C; c++) x[c] += f[c];
    }
    const y = rms(x, d('output_norm.weight'));
    logits = mv(d('output.weight'), y, C, V);
  }
  return logits;
}

async function chargerLotA(): Promise<undefined | ((chemin: string) => Promise<unknown>)> {
  try {
    const mod = await import('../src/brain/metis/gguf.ts');
    return (mod as { lireGguf?: (c: string) => Promise<unknown> }).lireGguf;
  } catch {
    return undefined;
  }
}

test('metis/intégration : faux GGUF octet par octet → lireGguf (A) → moteur (B), parité des logits', async (t) => {
  const lireGguf = await chargerLotA();
  if (!lireGguf) { t.skip('lot A (src/brain/metis/gguf.ts) pas encore livré — essai réuni sauté'); return; }
  const W = poidsModele(CFG);
  const octets = construireGguf(CFG, W);
  const dir = await mkdtemp(join(tmpdir(), 'metis-'));
  const chemin = join(dir, 'micro.gguf');
  try {
    await writeFile(chemin, octets);
    const modele = await lireGguf(chemin) as import('../src/brain/metis/types.ts').ModeleGguf;
    assert.equal(modele.arch, 'llama');
    assert.equal(modele.hyper.embeddingLength, CFG.C);
    const e = await creerEtat(modele);
    const ids = [1, 3, 5, 2];
    let logits: Float32Array = new Float32Array(CFG.V);
    for (const id of ids) logits = await passeAvant(e, id);
    const attendu = reference(W, CFG, ids);
    let maxDiff = 0;
    for (let v = 0; v < CFG.V; v++) maxDiff = Math.max(maxDiff, Math.abs(logits[v] - attendu[v]));
    assert.ok(maxDiff < 1e-3, `écart de logits : ${maxDiff}`);
    const argmax = (a: Float32Array) => { let bi = 0, bv = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > bv) { bv = a[i]; bi = i; } return bi; };
    assert.equal(argmax(logits), argmax(attendu), 'morceau déterministe identique');
    await modele.fermer();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
